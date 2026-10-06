/* Posted speed limits along a route.
 *  1) Federal Highway Administration HPMS 2023 road inventory (geo.dot.gov, one ArcGIS layer per state): the
 *     speed_limit states report for Interstates, freeways and other major roads. Free, no key.
 *  2) Where HPMS has no limit for a stretch: the state's maximum for that kind of road (state laws, as compiled by
 *     IIHS, Oct 2026), capped near the speed Google's own drive time implies there.
 * Which state a point is in comes from the Census Bureau's state outlines bundled in states.js (no lookup).
 */
(function (root) {
  'use strict';
  // state: [rural interstate, urban interstate, other limited-access, other roads] — passenger vehicles
  var MAX = {
    AL: [70, 70, 65, 65], AK: [65, 55, 65, 55], AZ: [75, 65, 65, 65], AR: [75, 65, 75, 65], CA: [70, 65, 70, 65], CO: [75, 65, 65, 65],
    CT: [65, 55, 65, 55], DE: [65, 55, 65, 55], DC: [55, 55, 55, 25], FL: [70, 65, 70, 65], GA: [70, 70, 65, 65], HI: [60, 60, 55, 45],
    ID: [75, 75, 70, 70], IL: [70, 55, 65, 55], IN: [70, 55, 60, 55], IA: [70, 65, 70, 65], KS: [75, 75, 75, 65], KY: [65, 65, 65, 55],
    LA: [75, 70, 70, 65], ME: [75, 75, 75, 60], MD: [70, 70, 70, 55], MA: [65, 65, 65, 55], MI: [70, 70, 70, 55], MN: [70, 65, 65, 60],
    MS: [70, 70, 70, 65], MO: [75, 60, 75, 65], MT: [80, 65, 75, 70], NE: [75, 70, 70, 65], NV: [80, 65, 70, 70], NH: [65, 65, 55, 55],
    NJ: [65, 55, 65, 55], NM: [75, 75, 65, 55], NY: [65, 65, 65, 55], NC: [70, 70, 70, 55], ND: [80, 75, 70, 65], OH: [70, 65, 70, 55],
    OK: [75, 70, 70, 70], OR: [65, 55, 65, 65], PA: [70, 70, 70, 55], RI: [65, 55, 55, 55], SC: [70, 70, 60, 55], SD: [80, 80, 70, 70],
    TN: [70, 70, 70, 65], TX: [75, 75, 75, 75], UT: [75, 70, 75, 65], VT: [65, 55, 50, 50], VA: [70, 70, 65, 55], WA: [70, 60, 60, 60],
    WV: [70, 55, 65, 55], WI: [70, 70, 70, 55], WY: [75, 75, 70, 70]
  };
  /**
   * Large-truck limits where a state sets one below the car limit (IIHS, Oct 2026). No road database (FHWA HPMS,
   * OpenStreetMap) carries these per road for the U.S. — checked on I-57 in Arkansas: posted 75, no truck tag — so
   * they come from state law: i = Interstates, la = other limited-access roads (freeways), o = other roads.
   * Not covered: Illinois' county truck limits (Cook, DuPage, Kane, Lake, Madison, McHenry, St. Clair, Will).
   */
  var TRUCK = {
    AR: { i: 70, la: 70 }, CA: { i: 55, la: 55, o: 55 }, IN: { i: 65 }, MI: { i: 65 }, MT: { i: 70 }, WA: { i: 60 },
    OR: { i: function (lim) { return lim >= 70 ? 65 : 55; } }, AZ: { o: 65 }
  };
  /** The large-truck limit on a road with car limit lim (= lim where trucks get the same). */
  function truckLimit(st, cls, fsys, lim) {
    var t = TRUCK[st]; if (!t || !(lim > 0)) return lim;
    var kind = cls === 'interstate' || +fsys === 1 ? 'i' : +fsys === 2 ? 'la' : 'o';
    var v = t[kind]; if (v == null && kind === 'la') v = null;
    if (typeof v === 'function') v = v(lim);
    return v ? Math.min(lim, v) : lim;
  }
  var boxes = null;
  function prep() {
    var US = (typeof window !== 'undefined' && window.US_STATES) || root.US_STATES;
    if (boxes || !US) return;
    boxes = [];
    Object.keys(US).forEach(function (st) {
      US[st].forEach(function (poly) {
        var r = poly[0], b = [1e9, 1e9, -1e9, -1e9];
        for (var i = 0; i < r.length; i += 2) { b[0] = Math.min(b[0], r[i]); b[2] = Math.max(b[2], r[i]); b[1] = Math.min(b[1], r[i + 1]); b[3] = Math.max(b[3], r[i + 1]); }
        boxes.push({ st: st, poly: poly, b: b });
      });
    });
  }
  function inRing(r, x, y) {
    var inside = false;
    for (var i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      var xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  /** Two-letter state for a point (null offshore / outside the U.S.). */
  function stateAt(lat, lng) {
    prep(); if (!boxes) return null;
    for (var k = 0; k < boxes.length; k++) {
      var o = boxes[k], b = o.b;
      if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
      if (!inRing(o.poly[0], lng, lat)) continue;
      var hole = false;
      for (var h = 1; h < o.poly.length; h++) if (inRing(o.poly[h], lng, lat)) { hole = true; break; }
      if (!hole) return o.st;
    }
    return null;
  }

  function hpmsUrl(st, lat, lng) {
    return 'https://geo.dot.gov/server/rest/services/Hosted/HPMS_FULL_' + st + '_2023/FeatureServer/0/query?geometry=' + lng.toFixed(6) + ',' + lat.toFixed(6) +
      '&geometryType=esriGeometryPoint&inSR=4326&distance=80&units=esriSRUnit_Meter&spatialRel=esriSpatialRelIntersects' +
      '&outFields=speed_limit,f_system,route_signing,route_number,urban_id,facility_type&returnGeometry=false&f=json';
  }
  /**
   * Choose the road the route is on from the HPMS segments near a point: skip ramps; prefer reported speed limits;
   * among those, the one closest to the speed Google's drive time implies (that avoids picking an overpass).
   */
  function pick(features, googleMph) {
    var fs = (features || []).map(function (f) { return f.attributes || f; }).filter(function (a) { return +a.facility_type !== 4; });
    var withLimit = fs.filter(function (a) { return +a.speed_limit >= 25 && +a.speed_limit <= 85; });
    if (withLimit.length) {
      withLimit.sort(function (a, b) { return Math.abs(+a.speed_limit - googleMph - 4) - Math.abs(+b.speed_limit - googleMph - 4) || (+a.f_system || 9) - (+b.f_system || 9); });
      return { limit: +withLimit[0].speed_limit, a: withLimit[0], src: 'hpms' };
    }
    fs.sort(function (a, b) { return (+a.f_system || 9) - (+b.f_system || 9); });
    return fs.length ? { limit: null, a: fs[0] } : null;
  }
  function stateMax(st, a, googleMph) {
    var m = MAX[st]; if (!m) return null;
    var rural = !a || !a.urban_id || +a.urban_id === 99999;
    var interstate = a ? (+a.f_system === 1 || +a.route_signing === 2) : false;
    var limited = a ? +a.f_system <= 2 : googleMph >= 62;
    var v = interstate || (!a && googleMph >= 66) ? (rural ? m[0] : m[1]) : limited ? m[2] : m[3];
    // Google's typical speed there says what the road really allows; don't go past it by more than ~10
    return Math.min(v, Math.max(45, Math.ceil((googleMph + 8) / 5) * 5));
  }

  /**
   * Speed-limit stretches along a route model (trip.js). Each stretch: {from, to, mi, googleMph, limit, src, st}.
   * cruise=false where Google's typical speed is under 45 mph (towns, ramps) — speed choice doesn't apply there.
   * getJson(url) -> Promise<{body}|{error}>.  onProg(done, total).
   */
  // ---------- which road each part of the route is on (from Google's turn-by-turn instructions) ----------
  var STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  var CLASS = { interstate: 'Interstate', us: 'U.S. route', state: 'State route', county: 'County road' };
  var SIGN = { interstate: 2, us: 3, state: 4, county: 6 };
  /** The numbered road an instruction puts you on: {key, name, cls, num} or null ("Turn left onto Main St"). */
  function roadOf(text) {
    var t = String(text || '').split('\n')[0].replace(/\b(toward|follow signs|signs for)\b[\s\S]*$/i, '');
    var m = /\b(?:onto|on|to stay on|for|via)\b\s+([\s\S]*)$/i.exec(t), part = m ? m[1] : t;
    var hit = find(part) || find(t);
    return hit;
    function find(x) {
      var re = /\b(I)-(\d{1,3})(?:\s+([NSEW]))?\b|\b(US)[- ](\d{1,3}[A-Z]?)(?:\s+([NSEW]))?\b|\b([A-Z]{2})-(\d{1,4}[A-Z]?)(?:\s+([NSEW]))?\b|\b(?:State (?:Hwy|Highway|Route|Rte|Road)|SR)[- ]?(\d{1,4}[A-Z]?)(?:\s+([NSEW]))?\b|\b(?:County (?:Rd|Road|Hwy|Highway|Route)|CR)[- ]?([A-Z]?\d{1,4}[A-Z]?)(?:\s+([NSEW]))?\b/g, r;
      while ((r = re.exec(x))) {
        if (r[1]) return { key: 'I-' + r[2], name: 'I-' + r[2] + (r[3] ? ' ' + r[3] : ''), cls: 'interstate', num: r[2] };
        if (r[4]) return { key: 'US-' + r[5], name: 'US-' + r[5] + (r[6] ? ' ' + r[6] : ''), cls: 'us', num: r[5] };
        if (r[7] && STATES.indexOf(r[7]) >= 0) return { key: r[7] + '-' + r[8], name: r[7] + '-' + r[8] + (r[9] ? ' ' + r[9] : ''), cls: 'state', num: r[8] };
        if (r[10]) return { key: 'SR-' + r[10], name: 'State Hwy ' + r[10] + (r[11] ? ' ' + r[11] : ''), cls: 'state', num: r[10] };
        if (r[12]) return { key: 'CR-' + r[12], name: 'County Rd ' + r[12] + (r[13] ? ' ' + r[13] : ''), cls: 'county', num: r[12] };
      }
      return null;
    }
  }
  /**
   * Major stretches of road along a route: consecutive steps on the same Interstate / U.S. / state / county route,
   * joined across short interruptions (exits, interchanges), anything else left out. [{key, name, cls, from, to, mi}]
   */
  function roads(model) {
    var out = [], cur = null;
    model.segs.forEach(function (s) {
      var r = roadOf(s.instr);
      if (!r && cur && /^(continue|keep|stay|slight)/i.test(String(s.instr || '').trim())) r = cur;   // "Continue straight" stays on the road
      if (r && cur && r.key === cur.key && s.from - cur.to < 3) { cur.to = s.to; return; }
      if (!r) { cur = null; return; }
      // short hop on another road, then back on the one before (a ramp, a bit of concurrency): one stretch
      for (var k = out.length - 1; k >= 0 && s.from - out[k].to < 3; k--) {
        if (out[k].key === r.key && out.slice(k + 1).every(function (x) { return x.to - x.from < 3; })) {
          out.splice(k + 1); out[k].to = s.to; cur = out[k]; return;
        }
      }
      cur = { key: r.key, name: r.name, cls: r.cls, num: r.num, from: s.from, to: s.to };
      out.push(cur);
    });
    out.forEach(function (x) { x.mi = x.to - x.from; });
    return out.filter(function (x) { return x.mi >= 2; });
  }
  /** Pick the HPMS segment for this road: same route number and signing if present, else the overall best guess. */
  function pickFor(features, road, googleMph) {
    var fs = (features || []).map(function (f) { return f.attributes || f; }).filter(function (a) { return +a.facility_type !== 4; });
    var same = fs.filter(function (a) { return String(a.route_number) === String(parseInt(road.num, 10)) && (+a.route_signing === SIGN[road.cls] || !a.route_signing); });
    var sameLim = same.filter(function (a) { return +a.speed_limit >= 25 && +a.speed_limit <= 85; });
    if (sameLim.length) { sameLim.sort(function (a, b) { return (+b.speed_limit) - (+a.speed_limit); }); return { limit: +sameLim[0].speed_limit, a: sameLim[0], src: 'hpms' }; }
    var p = pick(features, googleMph);
    if (same.length) return { limit: null, a: same[0] };
    return p && p.limit ? p : (p ? { limit: null, a: p.a } : null);
  }
  function fallback(st, road, a, googleMph) {
    if (!st || !MAX[st]) return null;
    var synth = a || {};
    var f = road.cls === 'interstate' ? 1 : googleMph >= 62 && road.cls !== 'county' ? 2 : 3;
    return stateMax(st, { f_system: f, route_signing: SIGN[road.cls], urban_id: synth.urban_id }, googleMph);
  }

  /**
   * Speed limits for each major road stretch, in pieces of up to ~15 miles (each piece gets its own limit, so a
   * stretch across states or from rural to city can change). getJson(url) -> Promise<{body}|{error}>.
   * -> { roads: [{key, name, cls, from, to, mi, pieces: [{from, to, mi, limit, src, st, googleMph}]}], stats }
   */
  async function along(model, getJson, opts) {
    opts = opts || {};
    var rs = roads(model), todo = [], stats = { hpms: 0, state: 0, google: 0, errors: 0 };
    rs.forEach(function (r) {
      var n = Math.max(1, Math.ceil(r.mi / 5)), w = r.mi / n;   // a check every ~5 miles, so limit changes land close to where they are
      r.pieces = [];
      for (var k = 0; k < n; k++) {
        var a = r.from + k * w, b = a + w, sec = 0, mi = 0;
        model.segs.forEach(function (s) {
          var o = Math.min(b, s.to) - Math.max(a, s.from); if (o <= 0) return;
          mi += o; sec += (s.t1 - s.t0) * o / (s.to - s.from || 1);
        });
        var pc = { from: a, to: b, mi: w, googleMph: sec > 0 ? mi / (sec / 3600) : 55, road: r };
        r.pieces.push(pc); todo.push(pc);
      }
    });
    // Coarse first (every 3rd 5-mile piece, plus each road's ends), then fill in only between readings that differ —
    // limits change rarely, so most pieces just take their neighbors' answer. 16 lookups at a time.
    var done = 0, total = 0;
    async function lookup(pc) {
      var road = pc.road, p = model.pointAt((pc.from + pc.to) / 2);
      pc.st = stateAt(p.lat, p.lng);
      var hit = null;
      if (pc.st && opts.lookup !== false) {
        var r = await getJson(hpmsUrl(pc.st, p.lat, p.lng));
        if (r && r.body) { try { var j = JSON.parse(r.body); if (j.error) stats.errors++; else hit = pickFor(j.features, road, pc.googleMph); } catch (e) { stats.errors++; } }
        else stats.errors++;
      }
      pc.fsys = hit && hit.a ? +hit.a.f_system : (road.cls === 'interstate' ? 1 : 0);
      if (hit && hit.limit) { pc.limit = hit.limit; pc.src = 'hpms'; stats.hpms++; }
      else {
        var v = fallback(pc.st, road, hit && hit.a, pc.googleMph);
        if (v) { pc.limit = v; pc.src = 'state'; stats.state++; }
        else { pc.limit = Math.max(25, Math.round(pc.googleMph / 5) * 5); pc.src = 'google'; stats.google++; }
      }
      pc.truck = truckLimit(pc.st, road.cls, pc.fsys, pc.limit);
      pc.looked = true;
      done++; if (opts.onProg) opts.onProg(done, total);
    }
    async function runAll(list, n) {
      var i = 0;
      async function worker() { while (i < list.length) await lookup(list[i++]); }
      var ws = []; for (var w = 0; w < Math.min(n, list.length); w++) ws.push(worker());
      await Promise.all(ws);
    }
    var coarse = [];
    rs.forEach(function (r) { r.pieces.forEach(function (pc, k) { if (k % 3 === 1 || k === 0 || k === r.pieces.length - 1) coarse.push(pc); }); });
    // estimate the total up front so the progress bar doesn't jump back: coarse + ~a quarter of the rest
    total = coarse.length + Math.ceil((todo.length - coarse.length) * 0.25);
    await runAll(coarse, 16);
    var fill = [];
    rs.forEach(function (r) {
      var ps = r.pieces;
      ps.forEach(function (pc, k) {
        if (pc.looked) return;
        var L = null, R = null;
        for (var a = k - 1; a >= 0 && !L; a--) if (ps[a].looked) L = ps[a];
        for (var b = k + 1; b < ps.length && !R; b++) if (ps[b].looked) R = ps[b];
        var same = L && R && L.limit === R.limit && L.st === R.st && L.src === R.src && L.truck === R.truck && L.fsys === R.fsys;
        if (same) { pc.st = L.st; pc.limit = L.limit; pc.src = L.src; pc.fsys = L.fsys; pc.truck = L.truck; pc.copied = true; stats[L.src] = (stats[L.src] || 0) + 1; }
        else fill.push(pc);
      });
    });
    total = done + fill.length;
    if (opts.onProg) opts.onProg(done, total);
    await runAll(fill, 16);
    stats.lookups = done;
    rs.forEach(function (r) { r.pieces.forEach(function (pc) { delete pc.road; delete pc.looked; }); r.sections = sections(r.pieces); });
    return { roads: rs, stats: stats };
  }
  /**
   * One section per posted limit: consecutive pieces with the same limit are joined; a single short reading that
   * differs from equal neighbors on both sides (e.g. 70 70 65 70 70 over 5-mile checks) is treated as noise.
   */
  function sections(pieces) {
    var lim = pieces.map(function (p) { return p.limit; });
    for (var i = 1; i < lim.length - 1; i++) if (lim[i] !== lim[i - 1] && lim[i - 1] === lim[i + 1] && pieces[i].mi < 6) lim[i] = lim[i - 1];
    var out = [];
    pieces.forEach(function (p, k) {
      var last = out[out.length - 1];
      var tk = p.truck != null && p.limit === lim[k] ? p.truck : lim[k];
      if (last && last.limit === lim[k]) { last.to = p.to; last.mi += p.mi; last.n++; if (p.src === 'hpms') last.hpms++; last.truck = Math.min(last.truck, tk); return; }
      out.push({ from: p.from, to: p.to, mi: p.mi, limit: lim[k], st: p.st, n: 1, hpms: p.src === 'hpms' ? 1 : 0, truck: tk });
    });
    out.forEach(function (x) { x.src = x.hpms * 2 >= x.n ? 'hpms' : 'state'; });
    return out;
  }
  function roadName(a) {
    if (!a || !a.route_number) return '';
    var sig = +a.route_signing;
    return (sig === 2 ? 'I-' : sig === 3 ? 'US-' : sig === 4 ? 'State ' : '') + a.route_number;
  }

  var api = { TRUCK: TRUCK, truckLimit: truckLimit, MAX: MAX, CLASS: CLASS, stateAt: stateAt, pick: pick, pickFor: pickFor, stateMax: stateMax, roadOf: roadOf, roads: roads, sections: sections, along: along, hpmsUrl: hpmsUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Limits = api;
})(this);
