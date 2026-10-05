/* Trip planner: Google Maps link parsing, route geometry, a speed-based MPG model, and the fuel-stop optimizer.
 * Pure logic (no DOM, no network) so it can be unit-tested in Node.
 *
 * Model
 *  - The route is a polyline with cumulative miles. Each Routes API step has a length and a no-traffic duration;
 *    its average speed picks a gallons-per-mile between your city and highway MPG.
 *  - Candidate stations are projected onto the route: "d" = route mile where you'd leave the road,
 *    detourMi = extra miles to get to the station and back on route.
 *  - Optimizer = dynamic program over (station, fuel level in 0.1 gal steps). Cost = gas bought at each stop's
 *    final price (after your discounts) + a per-stop threshold ("a stop has to save at least $X") + optional
 *    value of your time, minus the value of gas left in the tank at the end (at the typical price on this route).
 *    Detour fuel is burned from the tank, so its cost shows up in what you have to buy.
 *  - You never arrive anywhere (station or destination) with less than your buffer.
 */
(function (root) {
  'use strict';
  var M_PER_MI = 1609.344;

  // ---------------- Google Maps links ----------------

  function extractUrl(text) {
    var m = String(text || '').match(/https?:\/\/[^\s<>"']+/);
    return m ? m[0].replace(/[).,]+$/, '') : null;
  }
  function isShortLink(url) { return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(url || ''); }

  var LATLNG = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
  function dec(s) { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return String(s); } }
  function toStop(raw) {
    var s = dec(raw).trim();
    if (!s || /^(my|your|current) ?location$/i.test(s)) return { current: true, label: 'Your location' };
    var m = LATLNG.exec(s);
    if (m) return { lat: +m[1], lng: +m[2], label: s, short: s };
    return { address: s, label: s, short: shortLabel(s) };
  }
  /** Short name for headers: "Walmart Supercenter" stays as is; a street address keeps its city ("100 Main St, Conway"). */
  function shortLabel(s) {
    var parts = String(s).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!parts.length) return s;
    return /^\d/.test(parts[0]) && parts[1] ? parts[0] + ', ' + parts[1] : parts[0];
  }

  /** Full Google Maps directions URL -> {stops:[origin, ...waypoints, destination], avoid:{...}, mode, notes:[]} */
  function parseMapsUrl(url) {
    var out = { stops: [], avoid: { tolls: false, highways: false, ferries: false }, mode: 'drive', notes: [], avoidDetected: false };
    var u;
    try { u = new URL(url); } catch (e) { return null; }
    var path = u.pathname;
    var qs = u.searchParams;
    if (/\/maps\/dir\//.test(path) && !(qs.get('api') === '1' || qs.get('destination'))) {
      var after = path.split('/maps/dir/')[1] || '';
      var parts = after.split('/');
      var data = '';
      var segs = [];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (/^@/.test(p)) continue;
        if (/^data=/.test(p)) { data = p.slice(5); continue; }
        if (/^am=/.test(p)) continue;
        segs.push(p);
      }
      while (segs.length > 2 && segs[segs.length - 1] === '') segs.pop();
      out.stops = segs.map(toStop);
      if (data) applyData(out, dec(data));
    } else if (qs.get('destination')) {
      if (qs.get('origin')) out.stops.push(toStop(qs.get('origin'))); else out.stops.push({ current: true, label: 'Your location' });
      (qs.get('waypoints') || '').split('|').filter(Boolean).forEach(function (w) { out.stops.push(toStop(w)); });
      if (qs.get('destination')) out.stops.push(toStop(qs.get('destination')));
      var tm = qs.get('travelmode'); if (tm && tm !== 'driving') out.mode = tm;
      var av = (qs.get('avoid') || '').toLowerCase();
      if (av) { out.avoidDetected = true; out.avoid = { tolls: /toll/.test(av), highways: /highway/.test(av), ferries: /ferr/.test(av) }; }
    } else if (qs.get('daddr')) {
      out.stops.push(qs.get('saddr') ? toStop(qs.get('saddr')) : { current: true, label: 'Your location' });
      qs.get('daddr').split(/\s+to:/).forEach(function (w) { out.stops.push(toStop(w)); });
    } else return null;
    if (out.stops.length < 2) return null;
    return out;
  }

  /** The data= blob carries exact coordinates for named places (!1d lng !2d lat), the travel mode (!3eN)
   *  and route options (!2m3!1b1!2b1!3b1 = avoid highways / tolls / ferries). */
  /**
   * Google's data= blob is a flattened message: tokens "!<field><type><value>", where an "m" token's value is how many
   * of the following tokens belong inside it. The directions part looks like
   *   !4m..!4m..  !1m..(stop 1)  !1m..(stop 2) ...  !2m3!1b1!2b1!3b1 (avoid)  !3e0 (mode)  !5i1 (which route you picked)
   * and each stop block may hold !2m2!1d<lng>!2d<lat>. Stop blocks are in the same order as the stops in the path.
   */
  function parseData(data) {
    var toks = String(data).split('!').filter(Boolean).map(function (t) {
      var m = /^(\d+)([a-z])(.*)$/.exec(t); return m ? { f: +m[1], t: m[2], v: m[3] } : null;
    });
    if (toks.some(function (t) { return !t; })) return null;
    var i = 0;
    function read(n) {
      var out = [];
      for (var k = 0; k < n && i < toks.length; k++) {
        var t = toks[i++];
        if (t.t === 'm') { var cnt = parseInt(t.v, 10) || 0, start = i; t.kids = read(cnt); k += i - start; }
        out.push(t);
      }
      return out;
    }
    var tree = read(toks.length);
    function find(nodes) {
      for (var a = 0; a < nodes.length; a++) {
        var n = nodes[a];
        if (n.t === 'm' && n.f === 4 && n.kids) {
          var inner = n.kids.filter(function (x) { return x.t === 'm' && x.f === 4; })[0];
          if (inner && inner.kids && inner.kids.some(function (x) { return x.f === 1 && x.t === 'm'; })) { inner.outer = n; return inner; }
        }
        if (n.kids) { var r = find(n.kids); if (r) return r; }
      }
      return null;
    }
    var dir = find(tree);
    if (!dir) return null;
    var res = { stops: [], avoid: null, mode: null, routeIndex: null };
    dir.kids.forEach(function (k) {
      if (k.f === 1 && k.t === 'm') {
        // Google writes a stop's position two ways: !2m2!1d<lng>!2d<lat> (desktop) or, nested inside the place,
        // !8m2!3d<lat>!4d<lng> (phone share links). Look for either anywhere inside this stop's block.
        var c = null;
        (function look(list) {
          (list || []).forEach(function (x) {
            if (c || x.t !== 'm' || !x.kids) return;
            var d = function (f) { return x.kids.filter(function (y) { return y.f === f && y.t === 'd'; })[0]; };
            if (x.f === 2 && d(1) && d(2)) c = { lat: +d(2).v, lng: +d(1).v };
            else if (x.f === 8 && d(3) && d(4)) c = { lat: +d(3).v, lng: +d(4).v };
            else look(x.kids);
          });
        })(k.kids);
        if (c && !(Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180)) c = null;
        res.stops.push(c);
      } else if (k.f === 2 && k.t === 'm' && k.kids && k.kids.every(function (x) { return x.t === 'b'; })) {
        var on = function (f) { return k.kids.some(function (x) { return x.f === f && x.v === '1'; }); };
        res.avoid = { highways: on(1), tolls: on(2), ferries: on(3) };
      } else if (k.f === 3 && k.t === 'e') res.mode = +k.v;
      else if (k.f === 5 && k.t === 'i') res.routeIndex = +k.v;
    });
    [dir.outer ? dir.outer.kids : [], tree].forEach(function (lvl) {
      if (res.routeIndex == null) lvl.forEach(function (k) { if (k.f === 5 && k.t === 'i') res.routeIndex = +k.v; });
    });
    return res;
  }

  function applyData(out, data) {
    var d = parseData(data);
    if (d) {
      if (d.stops.length === out.stops.length) {
        out.stops.forEach(function (s, i) { var c = d.stops[i]; if (c && !s.current) { s.lat = c.lat; s.lng = c.lng; s.fromLink = true; } });
      }
      if (d.avoid) { out.avoidDetected = true; out.avoid = d.avoid; }
      if (d.mode != null && d.mode !== 0) out.mode = ({ 1: 'bicycling', 2: 'walking', 3: 'transit' })[d.mode] || 'other';
      if (d.routeIndex != null) out.routeIndex = d.routeIndex;
      return;
    }
    // unrecognized layout: only trust travel mode / options, never guess which coordinates belong to which stop
    var mode = /!3e(\d)/.exec(data);
    if (mode && mode[1] !== '0') out.mode = ({ 1: 'bicycling', 2: 'walking', 3: 'transit' })[mode[1]] || 'other';
  }

  // ---------------- polylines & geometry ----------------

  function decodePolyline(str) {
    var pts = [], i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      var b, shift = 0, res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
      lat += (res & 1) ? ~(res >> 1) : (res >> 1);
      shift = 0; res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
      lng += (res & 1) ? ~(res >> 1) : (res >> 1);
      pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return pts;
  }
  function encodePolyline(pts) {
    var out = '', plat = 0, plng = 0;
    function enc(v) {
      v = v < 0 ? ~(v << 1) : (v << 1);
      var s = '';
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      return s + String.fromCharCode(v + 63);
    }
    pts.forEach(function (p) {
      var la = Math.round(p.lat * 1e5), ln = Math.round(p.lng * 1e5);
      out += enc(la - plat) + enc(ln - plng); plat = la; plng = ln;
    });
    return out;
  }
  function hav(a, b) {
    var R = 3958.8, r = Math.PI / 180;
    var dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function parseDur(s) { var m = /^(\d+(?:\.\d+)?)s$/.exec(String(s || '')); return m ? +m[1] : 0; }

  /** Build the route model from a Routes API route + your MPG. */
  function buildRoute(r, car) {
    var pts = decodePolyline(r.polyline.encodedPolyline);
    var cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    var totalMi = (r.distanceMeters || 0) / M_PER_MI || cum[cum.length - 1];
    var k = cum[cum.length - 1] > 0 ? totalMi / cum[cum.length - 1] : 1;   // polyline -> road miles
    for (i = 0; i < cum.length; i++) cum[i] *= k;

    var adj = (car.adjustPct || 100) / 100;
    var city = car.city * adj, hwy = car.hwy * adj;
    function gpmAt(mph) {
      var w = Math.max(0, Math.min(1, (mph - 25) / 30));        // <=25 mph city, >=55 mph highway
      return (1 - w) / city + w / hwy;
    }
    var segs = [], at = 0, tAt = 0, legEnds = [];
    (r.legs || []).forEach(function (leg) {
      (leg.steps || []).forEach(function (st) {
        var mi = (st.distanceMeters || 0) / M_PER_MI, sec = parseDur(st.staticDuration);
        if (mi <= 0) return;
        var mph = sec > 0 ? mi / (sec / 3600) : 45;
        segs.push({ from: at, to: at + mi, gpm: gpmAt(mph), t0: tAt, t1: tAt + sec, mph: mph, instr: st.navigationInstruction && st.navigationInstruction.instructions || '' });
        at += mi; tAt += sec;
      });
      legEnds.push(at);
    });
    if (!segs.length) {
      var sec0 = parseDur(r.duration) || totalMi / 50 * 3600;
      segs.push({ from: 0, to: totalMi, gpm: gpmAt(totalMi / (sec0 / 3600)), t0: 0, t1: sec0 });
      at = totalMi;
    }
    var ks = at > 0 ? totalMi / at : 1;
    segs.forEach(function (s) { s.from *= ks; s.to *= ks; });
    legEnds = legEnds.map(function (x) { return x * ks; });
    var combGpm = 1 / (car.comb ? car.comb * adj : 1 / (0.55 / city + 0.45 / hwy));
    return makeModel({ pts: pts, cum: cum, totalMi: totalMi, durationSec: parseDur(r.duration) || (segs.length ? segs[segs.length - 1].t1 : 0),
      segs: segs, legEnds: legEnds, cityGpm: 1 / city, hwyGpm: 1 / hwy, combGpm: combGpm });
  }

  function makeModel(m) {
    var pts = m.pts, cum = m.cum, segs = m.segs, totalMi = m.totalMi;
    var gal = [0];
    segs.forEach(function (s, idx) { gal.push(gal[idx] + (s.to - s.from) * s.gpm); });
    return {
      pts: pts, cum: cum, totalMi: totalMi, durationSec: m.durationSec,
      segs: segs, legEnds: m.legEnds, cityGpm: m.cityGpm, hwyGpm: m.hwyGpm, combGpm: m.combGpm,
      /** gallons burned driving the route from mile 0 to mile d */
      galTo: function (d) {
        if (d <= 0) return 0;
        for (var j = 0; j < segs.length; j++) {
          var s = segs[j];
          if (d <= s.to) return gal[j] + (d - s.from) * s.gpm;
        }
        return gal[gal.length - 1] + (d - totalMi) * segs[segs.length - 1].gpm;
      },
      /** seconds of driving to reach mile d */
      timeTo: function (d) {
        for (var j = 0; j < segs.length; j++) {
          var s = segs[j];
          if (d <= s.to) return s.t0 + (s.to > s.from ? (d - s.from) / (s.to - s.from) : 0) * (s.t1 - s.t0);
        }
        return segs.length ? segs[segs.length - 1].t1 : 0;
      },
      pointAt: function (d) {
        for (var j = 1; j < cum.length; j++) {
          if (cum[j] >= d) {
            var t = cum[j] > cum[j - 1] ? (d - cum[j - 1]) / (cum[j] - cum[j - 1]) : 0;
            return { lat: pts[j - 1].lat + (pts[j].lat - pts[j - 1].lat) * t, lng: pts[j - 1].lng + (pts[j].lng - pts[j - 1].lng) * t };
          }
        }
        return pts[pts.length - 1];
      }
    };
  }

  /** The same roads driven the other way (estimate for the drive back). */
  function reverseModel(m) {
    var L = m.totalMi, T = m.segs.length ? m.segs[m.segs.length - 1].t1 : m.durationSec;
    var pts = m.pts.slice().reverse(), cum = m.cum.map(function (c) { return L - c; }).reverse();
    var segs = m.segs.slice().reverse().map(function (s) {
      return { from: L - s.to, to: L - s.from, gpm: s.gpm, t0: T - s.t1, t1: T - s.t0, mph: s.mph };
    });
    var legEnds = m.legEnds.slice(0, -1).map(function (x) { return L - x; }).reverse().concat([L]);
    return makeModel({ pts: pts, cum: cum, totalMi: L, durationSec: m.durationSec, segs: segs, legEnds: legEnds,
      cityGpm: m.cityGpm, hwyGpm: m.hwyGpm, combGpm: m.combGpm });
  }

  /** Nearest point on the route: {along: route mile, offset: miles off the road line}. */
  /**
   * Nearest point on the route to p: {along (route miles), offset (miles off the route)}.
   * Long routes have 100,000+ points, so this uses a grid of ~3.5-mile cells built once per route and only checks the
   * pieces of road near p; points farther away fall back to a coarse pass plus a local refine.
   */
  var CELL = 0.02;
  function segDist(pts, cum, i, p, kx, ky) {
    var ax = pts[i - 1].lng * kx, ay = pts[i - 1].lat * ky, bx = pts[i].lng * kx, by = pts[i].lat * ky;
    var px = p.lng * kx, py = p.lat * ky;
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    var qx = ax + t * dx, qy = ay + t * dy;
    return { along: cum[i - 1] + t * (cum[i] - cum[i - 1]), offset: Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy)) };
  }
  /** Built once per route: the route thinned to a point every ~0.1 mile, and a grid of which pieces cross each cell. */
  function gridOf(model) {
    if (model._grid) return model._grid;
    var P = model.pts, C = model.cum, pts = [P[0]], cum = [C[0]];
    for (var i = 1; i < P.length; i++) if (C[i] - cum[cum.length - 1] >= 0.1 || i === P.length - 1) { pts.push(P[i]); cum.push(C[i]); }
    var g = {};
    for (i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var x0 = Math.floor(Math.min(a.lng, b.lng) / CELL), x1 = Math.floor(Math.max(a.lng, b.lng) / CELL);
      var y0 = Math.floor(Math.min(a.lat, b.lat) / CELL), y1 = Math.floor(Math.max(a.lat, b.lat) / CELL);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) { var k = x * 100000 + y; (g[k] || (g[k] = [])).push(i); }
    }
    var G = { pts: pts, cum: cum, cells: g, stamp: new Int32Array(pts.length), q: 0 };
    try { Object.defineProperty(model, '_grid', { value: G, enumerable: false }); } catch (e) { model._grid = G; }
    return G;
  }
  function project(model, p) {
    var best = { along: 0, offset: Infinity };
    if (model.pts.length < 2) return model.pts.length ? { along: 0, offset: hav(model.pts[0], p) } : best;
    var kx = 69.17 * Math.cos(p.lat * Math.PI / 180), ky = 69.0, i;
    if (model.pts.length < 3000) {
      for (i = 1; i < model.pts.length; i++) { var r = segDist(model.pts, model.cum, i, p, kx, ky); if (r.offset < best.offset) best = r; }
      return best;
    }
    var G = gridOf(model), pts = G.pts, cum = G.cum, cx = Math.floor(p.lng / CELL), cy = Math.floor(p.lat / CELL), q = ++G.q;
    var cellMi = CELL * Math.min(kx, ky);
    for (var ring = 0; ring <= 6; ring++) {
      for (var x = cx - ring; x <= cx + ring; x++) for (var y = cy - ring; y <= cy + ring; y++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) continue;
        var list = G.cells[x * 100000 + y]; if (!list) continue;
        for (var j = 0; j < list.length; j++) {
          var si = list[j]; if (G.stamp[si] === q) continue; G.stamp[si] = q;
          var r2 = segDist(pts, cum, si, p, kx, ky); if (r2.offset < best.offset) best = r2;
        }
      }
      if (best.offset <= ring * cellMi) return best;      // nothing in a farther ring can be closer
    }
    if (best.offset <= 6 * cellMi) return best;
    // far from the route: coarse pass over every k-th point, then the exact pieces around the closest one
    var k = Math.ceil(pts.length / 1500), bi = 0, bd = Infinity;
    for (var c = 0; c < pts.length; c += k) { var d = hav(pts[c], p); if (d < bd) { bd = d; bi = c; } }
    for (i = Math.max(1, bi - 2 * k); i < Math.min(pts.length, bi + 2 * k + 1); i++) { var r3 = segDist(pts, cum, i, p, kx, ky); if (r3.offset < best.offset) best = r3; }
    return best;
  }

  /** Split the route into ~chunkMi pieces (with a little overlap) for along-route searches. */
  function chunks(model, chunkMi) {
    var out = [], n = Math.max(1, Math.ceil(model.totalMi / chunkMi)), size = model.totalMi / n;
    for (var c = 0; c < n; c++) {
      var a = Math.max(0, c * size - 3), b = Math.min(model.totalMi, (c + 1) * size + 3), seg = [];
      for (var i = 0; i < model.pts.length; i++) if (model.cum[i] >= a && model.cum[i] <= b) seg.push(model.pts[i]);
      if (seg.length < 2) seg = [model.pointAt(a), model.pointAt(b)];
      out.push({ fromMi: a, toMi: b, start: seg[0], polyline: encodePolyline(seg) });
    }
    return out;
  }

  /** Points every stepMi along the route (for brand store-finders that search by location). */
  function samplePoints(model, stepMi) {
    var out = [], n = Math.max(1, Math.round(model.totalMi / stepMi));
    for (var i = 0; i <= n; i++) out.push(model.pointAt(model.totalMi * i / n));
    return out;
  }

  // ---------------- optimizer ----------------

  /**
   * opts: {model, cands:[{id, d, detourMi, detourMin, price, ...}], startGal, capGal, bufferGal, arriveGal,
   *        fillUp:bool, stopPenalty:$, timeValue:$/hr, stopMinutes, refPrice}
   * cost overrides for the baseline: priceFn(c), stopCostFn(c)
   */
  function optimize(o, priceFn, stopCostFn) {
    var STEP = 0.1, model = o.model;
    var LV = Math.max(1, Math.round(o.capGal / STEP));
    var cands = o.cands.slice().sort(function (a, b) { return a.d - b.d; });
    var nodes = [{ kind: 'origin', d: 0 }].concat(cands.map(function (c) { return { kind: 'stop', d: c.d, c: c }; }))
      .concat([{ kind: 'dest', d: model.totalMi }]);
    var N = nodes.length, INF = 1e18;
    var lv = function (g) { return Math.round(g / STEP); };
    var start = Math.min(LV, Math.floor(o.startGal / STEP + 1e-9));
    var buf = Math.ceil(o.bufferGal / STEP - 1e-9), arr = Math.ceil(o.arriveGal / STEP - 1e-9);
    // o.firstDip: no plan keeps the buffer on the way to the first station (you're already low), so let that
    // first hop dip toward empty instead of failing outright. plan() retries with it only when it has to.
    var firstMin = o.firstDip ? 0 : buf;
    var price = priceFn || function (c) { return c.price; };
    // Extra time has to pay for itself: every stop must save at least stopPenalty, and leaving the road for a
    // station (more than ~1.5 min of detour) must save at least detourPenalty more than staying on the route.
    var stopCost = stopCostFn || function (c) {
      return (o.stopPenalty || 0) + ((c.detourMin || 0) > 1.5 ? (o.detourPenalty || 0) : 0) +
        (o.timeValue || 0) * ((c.detourMin || 0) + (o.stopMinutes || 0)) / 60;
    };
    var detGal = function (n) { return n.kind === 'stop' ? (n.c.detourMi || 0) * model.cityGpm : 0; };
    var routeGal = nodes.map(function (n) { return model.galTo(n.d); });

    var dp = [], par = [], bestFrom = [];
    for (var i = 0; i < N; i++) { dp.push(new Float64Array(LV + 1).fill(INF)); par.push(new Int32Array(LV + 1).fill(-1)); }
    dp[0][start] = 0;
    var reachMi = 0;

    for (i = 0; i < N - 1; i++) {
      var row = dp[i], best = new Float64Array(LV + 1).fill(INF), from = new Int16Array(LV + 1).fill(-1), any = false;
      if (nodes[i].kind === 'stop') {
        var p = price(nodes[i].c), runBest = INF, runF = -1;
        if (o.fillUp) {
          for (var f = 0; f <= LV; f++) if (row[f] < INF) {
            var v = row[f] + (LV - f) * STEP * p;
            if (v < best[LV]) { best[LV] = v; from[LV] = f; }
          }
        } else {
          for (var g = 0; g <= LV; g++) {
            // min over f<=g of row[f] - f*STEP*p, then + g*STEP*p
            if (row[g] < INF && row[g] - g * STEP * p < runBest) { runBest = row[g] - g * STEP * p; runF = g; }
            if (runF >= 0) { best[g] = runBest + g * STEP * p; from[g] = runF; }
          }
        }
      } else { for (g = 0; g <= LV; g++) { best[g] = row[g]; from[g] = g; } }
      bestFrom.push(from);
      for (g = 0; g <= LV; g++) if (best[g] < INF) { any = true; break; }
      if (!any) continue;
      reachMi = Math.max(reachMi, nodes[i].d);

      for (var j = i + 1; j < N; j++) {
        if (o.lastFull && nodes[j].kind === 'dest' && N > 2 && nodes[i].kind !== 'stop') continue;   // must stop to fill
        var burnG = routeGal[j] - routeGal[i] + detGal(nodes[i]) / 2 + detGal(nodes[j]) / 2;
        var burn = Math.ceil(burnG / STEP - 1e-9);
        if (routeGal[j] - routeGal[i] > o.capGal) break;              // beyond a full tank: stop looking
        var minA = nodes[j].kind === 'dest' ? arr : (i === 0 ? firstMin : buf);
        if (LV - burn < minA) continue;
        var add = nodes[j].kind === 'stop' ? stopCost(nodes[j].c) : 0;
        var credit = nodes[j].kind === 'dest' ? (o.refPrice || 0) * STEP : 0;
        // "arrive with the most gas": you asked for the final fill-up, so it doesn't have to clear the per-stop threshold
        if (o.lastFull && nodes[j].kind === 'dest' && nodes[i].kind === 'stop') add -= (o.stopPenalty || 0);
        var dj = dp[j], pj = par[j];
        var gLo = burn + minA;
        if (o.lastFull && nodes[j].kind === 'dest' && nodes[i].kind === 'stop') gLo = LV;   // last stop fills the tank
        for (g = gLo; g <= LV; g++) {
          if (best[g] >= INF) continue;
          var f2 = g - burn, val = best[g] + add - f2 * credit;
          if (val < dj[f2]) { dj[f2] = val; pj[f2] = i * (LV + 1) + g; }
        }
      }
    }
    bestFrom.push(null);

    var last = N - 1, bestF = -1, bestV = INF;
    for (var f3 = 0; f3 <= LV; f3++) if (dp[last][f3] < bestV) { bestV = dp[last][f3]; bestF = f3; }
    if (bestF < 0) return { ok: false, reachMi: reachMi, nodes: nodes };

    // walk back
    var stops = [], cur = last, curF = bestF;
    while (cur > 0) {
      var code = par[cur][curF];
      var pi = Math.floor(code / (LV + 1)), pg = code % (LV + 1);
      var pf = bestFrom[pi][pg];
      if (nodes[pi].kind === 'stop') stops.unshift({ c: nodes[pi].c, arriveGal: pf * STEP, departGal: pg * STEP, buyGal: (pg - pf) * STEP });
      cur = pi; curF = pf;
    }
    return { ok: true, stops: stops, arriveGal: bestF * STEP, objective: bestV };
  }

  function evaluate(o, res) {
    var buy = 0, cost = 0, det = 0, detMin = 0;
    res.stops.forEach(function (s) {
      s.cost = s.buyGal * s.c.price; buy += s.buyGal; cost += s.cost; det += s.c.detourMi || 0; detMin += s.c.detourMin || 0;
    });
    var credit = res.arriveGal * (o.refPrice || 0);
    return { gallons: buy, cost: cost, detourMi: det, detourMin: detMin, leftoverGal: res.arriveGal, leftoverValue: credit,
      net: cost - credit, stops: res.stops.length };
  }

  function median(xs) { var a = xs.slice().sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : 0; }

  /** Full plan: optimized + a "convenient" baseline (fewest stops, least detour, fill up) for comparison. */
  function plan(o) {
    var tooFar = 0, farList = [];
    var cands = o.cands.filter(function (c) {
      if (!(c.price > 0 && c.d >= 0 && c.d <= o.model.totalMi)) return false;
      if (o.maxDetourMin != null && (c.detourMin || 0) > o.maxDetourMin) { tooFar++; farList.push(c); return false; }   // more extra time than you'll spend
      return true;
    });
    if (!o.refPrice) {
      o.refPrice = median(cands.map(function (c) { return c.price; }));
      // arriving full: gas in the tank at the end is worth what filling up near the destination would cost
      var near = cands.filter(function (c) { return o.model.totalMi - c.d <= 15; }).map(function (c) { return c.price; });
      if (o.lastFull && near.length) o.refPrice = Math.max(o.refPrice, Math.min.apply(null, near));
    }
    var oo = Object.assign({}, o, { cands: cands });
    var noStopGal = o.startGal - o.model.galTo(o.model.totalMi);
    var best = optimize(oo);
    if (!best.ok) { oo.firstDip = true; best = optimize(oo); }
    if (!best.ok) return { ok: false, reachMi: best.reachMi, noStopGal: noStopGal, refPrice: o.refPrice, tooFar: tooFar };
    var bestEval = evaluate(oo, best);
    if (o.lite) return { ok: true, lite: true, tooFar: tooFar, cands: cands, stops: best.stops, arriveGal: best.arriveGal, totals: bestEval, refPrice: o.refPrice, noStopGal: noStopGal,
      firstDip: !!oo.firstDip, arriveMi: best.arriveGal / o.model.combGpm };
    // baseline: what you'd do without the app -- fewest stops, closest to the road, fill up each time
    var easy = optimize(Object.assign({}, oo, { fillUp: true, refPrice: oo.refPrice * 1e-4 }),
      function (c) { return c.price * 1e-4; },
      function (c) { return 1000 + (c.detourMi || 0) * 10; });
    var easyEval = easy.ok ? evaluate(oo, easy) : null;
    var minStops = easy.ok ? easy.stops.length : null;

    best.stops.forEach(function (s) {
      s.mile = s.c.d;
      s.etaSec = o.model.timeTo(s.c.d);
      s.arriveMi = s.arriveGal / o.model.combGpm;
      s.alts = alternatives(oo, s, cands);
    });
    best.stops.forEach(function (s, k) { s.why = whyNotCheaper(oo, best.stops, k, cands, farList); });
    return { ok: true, tooFar: tooFar, cands: cands, stops: best.stops, arriveGal: best.arriveGal, totals: bestEval, easy: easy.ok ? { stops: easy.stops, totals: easyEval } : null,
      minStops: minStops, refPrice: o.refPrice, noStopGal: noStopGal, firstDip: !!oo.firstDip,
      arriveMi: best.arriveGal / o.model.combGpm, savings: easyEval ? easyEval.net - bestEval.net : null };
  }

  /**
   * When a stop isn't the cheapest station around, say why in one sentence. Looks at the cheapest station within
   * 15 route miles of the stop (the same "cluster" — somewhere you'd practically have stopped instead), between the
   * previous stop and the next one (including ones skipped for being too far out of the way) and finds the reason the
   * plan passed on it: out of your time limit, can't reach it above your buffer, or the detour/threshold eats the savings.
   */
  var CLUSTER_MI = 15;
  function whyNotCheaper(o, stops, k, cands, farList) {
    var m = o.model, s = stops[k], c0 = s.c;
    var prevD = k ? stops[k - 1].c.d : 0, nextD = k < stops.length - 1 ? stops[k + 1].c.d : m.totalMi;
    var prevDepart = k ? stops[k - 1].departGal : o.startGal, prevDet = k ? (stops[k - 1].c.detourMi || 0) : 0;
    var chosen = {}; stops.forEach(function (x) { chosen[x.c.id] = 1; });
    var pool = cands.map(function (c) { return { c: c, far: false }; }).concat((farList || []).map(function (c) { return { c: c, far: true }; }));
    var alt = null;
    pool.forEach(function (p) {
      var c = p.c;
      if (chosen[c.id] || !(c.price < c0.price - 0.0005) || c.d < prevD - 0.01 || c.d > nextD + 0.01) return;
      if (Math.abs(c.d - c0.d) > (o.clusterMi || CLUSTER_MI)) return;   // only stations you could practically have used instead
      if (!alt || c.price < alt.c.price - 0.0005 || (Math.abs(c.price - alt.c.price) < 0.0005 && Math.abs(c.d - c0.d) < Math.abs(alt.c.d - c0.d))) alt = p;
    });
    if (!alt) return null;
    var c = alt.c, cents = Math.round((c0.price - c.price) * 1000) / 10;
    var where = c.d < c0.d ? Math.round(c0.d - c.d) + ' mi earlier' : c.d > c0.d ? Math.round(c.d - c0.d) + ' mi later' : 'nearby';
    var head = (c.station && c.station.name || 'A station') + ' (' + where + ') is ' + (cents >= 1 ? Math.round(cents) + '¢' : cents.toFixed(1) + '¢') + '/gal cheaper, but ';
    var off = (c.detourMi || 0) < 0.15 ? 'on the route' : (c.detourMi || 0).toFixed(1) + ' mi off the route';
    if (alt.far) return head + 'it\'s about ' + Math.round(c.detourMin) + ' min out of the way — over your ' + o.maxDetourMin + '-minute limit.';
    var burnIn = m.galTo(c.d) - m.galTo(prevD) + (prevDet + (c.detourMi || 0)) / 2 * m.cityGpm;
    if (prevDepart - burnIn < o.bufferGal - 0.05) {
      return head + 'you\'d get there with less than your ' + Math.round(o.bufferGal / m.combGpm) + '-mile buffer' + (k ? ' after the previous stop.' : '.');
    }
    var gal = s.buyGal;
    var save = gal * (c0.price - c.price);
    var extraDet = Math.max(0, (c.detourMi || 0) - (c0.detourMi || 0));
    var detCost = extraDet * m.cityGpm * c.price;
    var pen = ((c.detourMin || 0) > 1.5 && (c0.detourMin || 0) <= 1.5) ? (o.detourPenalty || 0) : 0;
    var timeCost = (o.timeValue || 0) * Math.max(0, (c.detourMin || 0) - (c0.detourMin || 0)) / 60;
    var money = function (v) { return '$' + v.toFixed(2); };
    if (save <= detCost + 0.005) return head + 'it\'s ' + off + ': the extra ' + extraDet.toFixed(1) + ' mi burns about ' + money(detCost) + ' of gas, more than the ' + money(save) + ' it would save on ' + gal.toFixed(1) + ' gal.';
    if (pen > 0 && save - detCost <= pen + 0.005) return head + 'it\'s ' + off + ', and leaving the route has to save at least ' + money(pen) + ' — this would save about ' + money(save - detCost) + '.';
    if (timeCost > 0 && save - detCost - pen <= timeCost + 0.005) return head + 'the extra ' + Math.round((c.detourMin || 0) - (c0.detourMin || 0)) + ' min of detour is worth ' + money(timeCost) + ' at your time value, more than the ' + money(save - detCost) + ' it saves.';
    return head + 'stopping there instead throws off the rest of the trip — the plan as a whole comes out cheaper this way.';
  }

  /**
   * Re-plan the same trip at several buffers (miles you always keep). Gas left at the end is valued at the same
   * reference price for every buffer so the totals compare fairly. Returns [{mi, ok, net, plan, opts}] in ascending mi,
   * with mark=true where lowering the buffer to that point saves money vs. the next higher buffer.
   */
  function bufferSweep(o, list, refPrice) {
    var out = list.map(function (mi) {
      var oo = Object.assign({}, o, { bufferGal: mi * o.model.combGpm, arriveGal: mi * o.model.combGpm, refPrice: refPrice, lite: true });
      var p = plan(oo);
      var net = p.ok ? p.totals.net + (o.timeValue || 0) * (p.totals.detourMin + p.stops.length * (o.stopMinutes || 0)) / 60 : null;
      return { mi: mi, ok: p.ok, net: net, plan: p, opts: oo };
    });
    marks(out);
    return out;
  }
  function marks(out) {
    for (var i = 0; i < out.length; i++) {
      var a = out[i], b = out[i + 1];
      a.mark = !!(a.ok && b && b.ok && a.net < b.net - 0.2);
    }
    return out;
  }

  /** Other priced stations within +-25 route miles of a chosen stop, with what using them instead would cost. */
  function alternatives(o, stop, cands) {
    var c0 = stop.c, out = [];
    cands.forEach(function (c) {
      if (c === c0 || Math.abs(c.d - c0.d) > 25) return;
      var extra = stop.buyGal * (c.price - c0.price) + ((c.detourMi || 0) - (c0.detourMi || 0)) * o.model.cityGpm * c0.price;
      out.push({ c: c, extra: extra });
    });
    out.sort(function (a, b) { return a.extra - b.extra; });
    var onRoute = out.filter(function (a) { return (a.c.detourMi || 0) < (c0.detourMi || 0) - 0.2; }).slice(0, 1);
    var cheaper = out.slice(0, 2);
    var seen = {}, res = [];
    onRoute.concat(cheaper).forEach(function (a) { if (!seen[a.c.id]) { seen[a.c.id] = 1; res.push(a); } });
    return res.slice(0, 3);
  }

  /**
   * Stations within radiusMi of the destination (route miles left + half the detour) where you could top the tank
   * back up after the plan's last stop. Closest first (that's the most gas on arrival).
   */
  function topUps(o, p, radiusMi) {
    var model = o.model, L = model.totalMi, last = p.stops.length ? p.stops[p.stops.length - 1] : null;
    var fromD = last ? last.c.d : 0, fromGal = last ? last.departGal : o.startGal, fromDet = last ? (last.c.detourMi || 0) : 0;
    var out = [];
    o.cands.forEach(function (c) {
      if (last && c.id === last.c.id) return;
      if (c.d < fromD) return;
      var toDest = (L - c.d) + (c.detourMi || 0) / 2;
      if (toDest > radiusMi + 1e-9) return;
      var burnIn = model.galTo(c.d) - model.galTo(fromD) + (fromDet + (c.detourMi || 0)) / 2 * model.cityGpm;
      var arrive = fromGal - burnIn;
      if (arrive < 0) return;
      var buy = Math.max(0, o.capGal - arrive);
      var burnOut = model.galTo(L) - model.galTo(c.d) + (c.detourMi || 0) / 2 * model.cityGpm;
      var extraPerGal = last ? c.price - last.c.price : 0;
      out.push({ c: c, toDestMi: toDest, arriveGal: arrive, buyGal: buy, cost: buy * c.price, extraPerGal: extraPerGal,
        endGal: o.capGal - burnOut, endMi: (o.capGal - burnOut) / model.combGpm });
    });
    out.sort(function (a, b) { return a.toDestMi - b.toDestMi || a.cost - b.cost; });
    return out;
  }

  /**
   * What the gas you burn actually cost, leg by leg. Tank gas is valued at its average cost: what's in the tank at
   * the start counts at startPrice, every purchase adds at its price, and burned gallons take the running average.
   * legs: [{stops:[{arriveGal, buyGal, price}], arriveGal}]  ->  {legs:[{burnGal, cost, bought, spend}], endGal, endValue}
   */
  function account(startGal, startPrice, legs) {
    var G = startGal, V = startGal * startPrice, out = [];
    legs.forEach(function (leg) {
      var cost = 0, burnGal = 0, bought = 0, spend = 0;
      function burnTo(g) {
        var b = Math.max(0, G - g), avg = G > 0 ? V / G : startPrice;
        cost += b * avg; burnGal += b; V -= b * avg; G = g;
      }
      leg.stops.forEach(function (s) {
        burnTo(s.arriveGal);
        G += s.buyGal; V += s.buyGal * s.price; bought += s.buyGal; spend += s.buyGal * s.price;
      });
      burnTo(leg.arriveGal);
      out.push({ burnGal: burnGal, cost: cost, bought: bought, spend: spend });
    });
    return { legs: out, endGal: G, endValue: V };
  }

  /** Candidates mirrored for the drive back on the same roads. */
  function mirror(cands, L) {
    return cands.map(function (c) { return Object.assign({}, c, { d: L - c.d }); });
  }

  // ---------------- back to Google Maps ----------------

  function ll(s) { return s.lat.toFixed(6) + ',' + s.lng.toFixed(6); }
  /** A stop's text is only safe to hand to Google Maps if it's a full address (has a city); otherwise use its exact spot. */
  function fullAddress(a) { return !!a && a.indexOf(',') > 0; }
  function stopParam(s) { return fullAddress(s.address) || s.lat == null ? (s.address || ll(s)) : ll(s); }
  function stationAddress(c) { var a = c.station && c.station.address; return a && /\d/.test(a) && a.indexOf(',') > 0 ? a : ll(c); }
  function stationPlaceId(c) { return c.station && c.station.id && !/^(wm|mu|demo)-/.test(c.station.id) ? c.station.id : null; }
  /** Directions link with the original stops plus the fuel stops in route order, using full addresses (and Google
   *  place IDs when every stop has one, so Maps can't pick a same-named street elsewhere). Max 9 waypoints. */
  function exportUrl(route, planStops, model) {
    var stops = route.stops, origin = stops[0], dest = stops[stops.length - 1];
    var wps = [];
    stops.slice(1, -1).forEach(function (s, i) { wps.push({ at: model.legEnds[i] != null ? model.legEnds[i] : 0, v: stopParam(s), id: s.placeId || null }); });
    planStops.forEach(function (p) { wps.push({ at: p.c.d, v: stationAddress(p.c), id: stationPlaceId(p.c) }); });
    wps.sort(function (a, b) { return a.at - b.at; });
    var q = 'api=1&travelmode=driving';
    if (!origin.current) {
      q += '&origin=' + encodeURIComponent(stopParam(origin));
      if (origin.placeId) q += '&origin_place_id=' + encodeURIComponent(origin.placeId);
    }
    q += '&destination=' + encodeURIComponent(stopParam(dest));
    if (dest.placeId) q += '&destination_place_id=' + encodeURIComponent(dest.placeId);
    if (wps.length) {
      q += '&waypoints=' + wps.map(function (w) { return encodeURIComponent(w.v); }).join('%7C');
      if (wps.every(function (w) { return w.id; })) q += '&waypoint_place_ids=' + wps.map(function (w) { return encodeURIComponent(w.id); }).join('%7C');
    }
    return { url: 'https://www.google.com/maps/dir/?' + q, waypoints: wps.length, tooMany: wps.length > 9 };
  }

  var api = { fullAddress: fullAddress, parseData: parseData, shortLabel: shortLabel, extractUrl: extractUrl, isShortLink: isShortLink, parseMapsUrl: parseMapsUrl, decodePolyline: decodePolyline,
    encodePolyline: encodePolyline, buildRoute: buildRoute, project: project, chunks: chunks, samplePoints: samplePoints,
    optimize: optimize, plan: plan, topUps: topUps, account: account, mirror: mirror, reverseModel: reverseModel, exportUrl: exportUrl, hav: hav, bufferSweep: bufferSweep, marks: marks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Trip = api;
})(this);
