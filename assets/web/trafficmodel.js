/* Google traffic categories -> estimated speed, stopped share and stops (pure; Node + browser).
 * Google publishes categories, not speeds (docs/TRAFFIC_ENERGY_HANDOFF.md section 4). Every number here is a
 * PRIOR from published ground-truth studies (Ecuador 2020, Wagner 2020, Bangkok/Toronto idle shares) or a labeled
 * fill-in, refined only by self-calibration against Google's own durations for the selected route. Never present the
 * result as a measured speed. Owner decision D2: an uncoloured road inside a successful read is free flow. */
(function initTrafficModel(root) {
  'use strict';
  // r = speed / free-flow speed; s = stopped share of section time. [low, high, default]
  var PRIORS = {
    NORMAL: { r: [.85, 1, .92], s: [0, 0, 0] },
    NONE: { r: [.9, 1, 1], s: [0, 0, 0] },                 // uncoloured: owner D2
    SLOW: { r: [.45, .8, .65], s: [0, .1, .05] },
    TRAFFIC_JAM: { r: [.25, .5, .38], s: [.1, .3, .2] },
    TRAFFIC_JAM_HEAVY: { r: [.08, .3, .18], s: [.3, .5, .4] }
  };
  // extra stops per km in congestion (fill-in assumptions, not measured; green uses the existing city model)
  var STOPS_KM = { NORMAL: 0, NONE: 0, SLOW: .3, TRAFFIC_JAM: 1.5, TRAFFIC_JAM_HEAVY: { freeway: 3, arterial: 2 } };
  var CATS = ['NORMAL', 'SLOW', 'TRAFFIC_JAM', 'TRAFFIC_JAM_HEAVY'], CLASSES = ['freeway', 'arterial'];
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function cat(c) { c = String(c || '').toUpperCase(); return PRIORS[c] && c !== 'NONE' ? c : 'NONE'; }
  function cls(k) { return k === 'arterial' ? 'arterial' : 'freeway'; }
  /** Prior for a category on a road class. Freeways take the lower half of the slow/jam ranges (queues form there,
   *  Wagner's motorway orange was 0.46), arterials the upper half (signals already slow normal flow). */
  function prior(c, k) {
    c = cat(c); k = cls(k); var p = PRIORS[c], r = p.r[2];
    if (c === 'SLOW' || c === 'TRAFFIC_JAM') r = k === 'freeway' ? (p.r[0] + p.r[2]) / 2 : (p.r[2] + p.r[1]) / 2;
    return { cat: c, cls: k, r: r, lo: p.r[0], hi: p.r[1], s: p.s[2], sLo: p.s[0], sHi: p.s[1] };
  }
  function key(c, k) { return cat(c) + '|' + cls(k); }
  /** One route section -> timing for the energy model. len miles, vff free-flow mph (posted / derived limit).
   *  table: optional calibrated {key: {r}} from Calibration.table(). */
  function section(o, table) {
    var c = cat(o.cat), k = cls(o.cls), p = prior(c, k), cal = table && table[key(c, k)], r = clamp(cal && cal.r > 0 ? cal.r : p.r, .05, 1);
    var len = Math.max(0, +o.len || 0), vff = Math.max(1, +o.vff || 1), seconds = len / (r * vff) * 3600, s = Math.min(p.s, 1 - r);
    var tStopped = s * seconds, moving = seconds - tStopped, vMoving = moving > 0 ? len / moving * 3600 : 0;
    var per = STOPS_KM[c], perKm = typeof per === 'number' ? per : per[k];
    return { cat: c, cls: k, len: len, vff: vff, r: r, s: s, seconds: seconds, tStopped: tStopped, vMoving: vMoving, nStops: perKm * len * 1.609344, calibrated: !!(cal && cal.r > 0), estimate: true };
  }
  /** Guard rails for D2 (section 4.6): uncoloured roads count as free flow only when the read succeeded and some of
   *  the route is coloured; a route with no colours at all is "traffic unavailable", never silently free flow. */
  function coverage(sections, readOk) {
    var total = 0, coloured = 0; (sections || []).forEach(function (s) { var l = Math.max(0, +s.len || 0); total += l; if (cat(s.cat) !== 'NONE') coloured += l; });
    if (!readOk) return { ok: false, reason: 'Traffic read failed', colouredShare: 0, uncolouredShare: 0 };
    if (!(total > 0) || !(coloured > 0)) return { ok: false, reason: 'No traffic colours on this route', colouredShare: 0, uncolouredShare: total > 0 ? 1 : 0 };
    return { ok: true, colouredShare: coloured / total, uncolouredShare: 1 - coloured / total };
  }
  // ---- self-calibration against Google's own durations (section 4.3) ----
  // Each observation: {sections: [{len, vff, cat, cls}], tTraffic, tFree (seconds), coverage (0..1), matched (bool)}.
  // Unknowns x_k = 1/r_k - 1 >= 0 per (category, road class); delay = sum_k A_k x_k with A_k = sum len/vff (s).
  function check(o) {
    if (!o || !Array.isArray(o.sections) || !(o.tTraffic > 0) || !(o.tFree > 0)) return 'Missing durations';
    if (o.matched === false) return 'Google route differs from the selected route';
    if (!(o.coverage >= .5)) return 'Traffic colours cover under half the route';
    var a = 0; o.sections.forEach(function (s) { if (cat(s.cat) !== 'NONE') a += s.len / s.vff * 3600; });
    if (!(a > 0)) return 'No coloured sections';
    var x = (o.tTraffic - o.tFree) / a;   // one shared ratio for the whole route
    if (x < 1 / 1.05 - 1) return 'Needs a speed above free flow (r > 1.05)';
    if (x > 1 / .05 - 1) return 'Needs a speed under 5% of free flow (r < 0.05)';
    return null;
  }
  /** Bounded least squares with a weak prior pull (coordinate descent with clamping: exact for a box-constrained
   *  convex quadratic). Returns {table: {key: {r, lo, hi, n}}, used, rejected: [{i, reason}]}. */
  function calibrate(obs, opts) {
    opts = opts || {}; var lambda = opts.lambda == null ? .05 : opts.lambda, keys = [], rows = [], rejected = [];
    CATS.forEach(function (c) { CLASSES.forEach(function (k) { keys.push(key(c, k)); }); });
    (obs || []).forEach(function (o, i) {
      var why = check(o); if (why) { rejected.push({ i: i, reason: why }); return; }
      var a = {}; o.sections.forEach(function (s) { var c = cat(s.cat); if (c === 'NONE') return; var kk = key(c, s.cls); a[kk] = (a[kk] || 0) + s.len / s.vff * 3600; });
      rows.push({ a: a, b: o.tTraffic - o.tFree });
    });
    var x = {}, lo = {}, hi = {}, x0 = {}, scale = {}, n = {};
    keys.forEach(function (kk) { var parts = kk.split('|'), p = prior(parts[0], parts[1]); x0[kk] = 1 / p.r - 1; lo[kk] = 1 / p.hi - 1; hi[kk] = 1 / p.lo - 1; x[kk] = x0[kk]; scale[kk] = 0; n[kk] = 0; });
    rows.forEach(function (row) { Object.keys(row.a).forEach(function (kk) { scale[kk] += row.a[kk] * row.a[kk]; n[kk]++; }); });
    var used = keys.filter(function (kk) { return n[kk] > 0; });
    for (var it = 0; it < 200 && rows.length; it++) {
      var moved = 0;
      used.forEach(function (kk) {
        // minimise sum_i (a_i.x - b_i)^2 + lambda * S_k (x_k - x0_k)^2 over x_k alone
        var num = 0, den = 0, reg = lambda * Math.max(scale[kk], 1);
        rows.forEach(function (row) { var ak = row.a[kk]; if (!ak) return; var rest = row.b; Object.keys(row.a).forEach(function (j) { if (j !== kk) rest -= row.a[j] * x[j]; }); num += ak * rest; den += ak * ak; });
        var nx = clamp((num + reg * x0[kk]) / (den + reg), lo[kk], hi[kk]); moved = Math.max(moved, Math.abs(nx - x[kk])); x[kk] = nx;
      });
      if (moved < 1e-9) break;
    }
    var table = {}; used.forEach(function (kk) { var parts = kk.split('|'), p = prior(parts[0], parts[1]); table[kk] = { r: 1 / (1 + x[kk]), lo: p.lo, hi: p.hi, n: n[kk] }; });
    return { table: table, used: rows.length, rejected: rejected };
  }
  /** Running posterior across routes, hours and cached cells: a weighted mean and variance per (category, class).
   *  Bounded (8 keys), timestamped, JSON-serialisable for persistence. */
  function Calibration(saved) {
    var t = {}; if (saved && saved.t) Object.keys(saved.t).forEach(function (kk) { var v = saved.t[kk]; if (v && v.w > 0 && v.r > 0) t[kk] = { r: v.r, w: v.w, m2: v.m2 || 0, at: v.at || 0 }; });
    return {
      add: function (fit, at) { Object.keys(fit && fit.table || {}).forEach(function (kk) { var f = fit.table[kk], w = f.n || 1, cur = t[kk]; if (!cur) { t[kk] = { r: f.r, w: w, m2: 0, at: at || 0 }; return; } var W = cur.w + w, d = f.r - cur.r, r = cur.r + d * w / W; cur.m2 += w * d * (f.r - r); cur.r = r; cur.w = Math.min(W, 500); cur.at = at || cur.at; }); },
      table: function () { var out = {}; Object.keys(t).forEach(function (kk) { out[kk] = { r: t[kk].r, sd: t[kk].w > 1 ? Math.sqrt(Math.max(0, t[kk].m2) / t[kk].w) : null, w: t[kk].w, at: t[kk].at }; }); return out; },
      save: function () { return { v: 1, t: JSON.parse(JSON.stringify(t)) }; }
    };
  }
  /** Fuel or energy to bring the vehicle back to v (kinetic energy, net of regeneration). Fill-in efficiencies
   *  (section 6.4): tank-to-wheel 25% gas, 35% hybrid / diesel; regeneration 0% gas / diesel, 30% full hybrid, 60% EV.
   *  Returns litres for liquid fuel, kWh for EV. */
  function restart(kind, massKg, vMph) {
    var v = Math.max(0, +vMph || 0) * .44704, j = .5 * Math.max(0, +massKg || 1600) * v * v;
    if (kind === 'ev') return { kWh: j * (1 - .6) / .9 / 3.6e6 };
    var eff = kind === 'hybrid' || kind === 'diesel' ? .35 : .25, regen = kind === 'hybrid' ? .3 : 0, mjPerL = kind === 'diesel' ? 38.6 : 34.2;
    return { litres: j * (1 - regen) / eff / (mjPerL * 1e6) };
  }
  /** Category from a numeric forecast ratio (HERE traffic / free-flow speed): the midpoints between the default
   *  priors. An inference for stop counts and stopped share only; the forecast's own speed stays the speed. */
  function fromRatio(r) { r = +r; if (!(r > 0)) return 'NONE'; return r >= .8 ? 'NORMAL' : r >= .5 ? 'SLOW' : r >= .27 ? 'TRAFFIC_JAM' : 'TRAFFIC_JAM_HEAVY'; }
  var api = { PRIORS: PRIORS, fromRatio: fromRatio, STOPS_KM: STOPS_KM, prior: prior, key: key, section: section, coverage: coverage, check: check, calibrate: calibrate, Calibration: Calibration, restart: restart };
  api.workerSource = '(' + initTrafficModel.toString() + ')(self);';
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TrafficModel = api;
})(typeof window !== 'undefined' ? window : this);
