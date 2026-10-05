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
  async function along(model, getJson, opts) {
    opts = opts || {};
    var L = model.totalMi, step = Math.max(10, L / 150), out = [];
    for (var a = 0; a < L - 0.01; a += step) {
      var b = Math.min(L, a + step), sec = 0, mi = 0;
      model.segs.forEach(function (s) {
        var o = Math.min(b, s.to) - Math.max(a, s.from); if (o <= 0) return;
        mi += o; sec += (s.t1 - s.t0) * o / (s.to - s.from || 1);
      });
      var g = sec > 0 ? mi / (sec / 3600) : 0;
      out.push({ from: a, to: b, mi: b - a, googleMph: g, cruise: g >= 45 });
    }
    var todo = out.filter(function (s) { return s.cruise; }), done = 0, i = 0, stats = { hpms: 0, state: 0, google: 0, errors: 0 };
    async function worker() {
      while (i < todo.length) {
        var s = todo[i++], p = model.pointAt((s.from + s.to) / 2);
        s.st = stateAt(p.lat, p.lng);
        var hit = null;
        if (s.st && opts.lookup !== false) {
          var r = await getJson(hpmsUrl(s.st, p.lat, p.lng));
          if (r && r.body) { try { var j = JSON.parse(r.body); if (j.error) stats.errors++; else hit = pick(j.features, s.googleMph); } catch (e) { stats.errors++; } }
          else stats.errors++;
        }
        if (hit && hit.limit) { s.limit = hit.limit; s.src = 'hpms'; s.road = roadName(hit.a); stats.hpms++; }
        else {
          var v = s.st ? stateMax(s.st, hit && hit.a, s.googleMph) : null;
          if (v) { s.limit = v; s.src = 'state'; s.road = roadName(hit && hit.a); stats.state++; }
          else { s.limit = Math.max(45, Math.round(s.googleMph / 5) * 5); s.src = 'google'; stats.google++; }
        }
        if (s.limit < 50) s.cruise = false;          // a 45-mph road isn't a place to pick a cruising speed
        done++; if (opts.onProg) opts.onProg(done, todo.length);
      }
    }
    var ws = []; for (var w = 0; w < Math.min(8, todo.length); w++) ws.push(worker());
    await Promise.all(ws);
    return { stretches: out, stats: stats };
  }
  function roadName(a) {
    if (!a || !a.route_number) return '';
    var sig = +a.route_signing;
    return (sig === 2 ? 'I-' : sig === 3 ? 'US-' : sig === 4 ? 'State ' : '') + a.route_number;
  }

  var api = { MAX: MAX, stateAt: stateAt, pick: pick, stateMax: stateMax, along: along, hpmsUrl: hpmsUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Limits = api;
})(this);
