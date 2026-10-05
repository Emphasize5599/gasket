/* Best cruising speed: an mpg-vs-speed curve per vehicle and the speed where going faster stops being worth it.
 *
 * Curve: Oak Ridge National Lab's 74-vehicle study (Thomas et al., 2013) — mpg falls on average 12.4% from 50→60 mph,
 * 14.0% from 60→70 and 15.4% from 70→80. ORNL found no clear pattern by body style (SUVs, pickups and minivans behaved
 * like sedans); the outliers were V8s with cylinder deactivation, which lose more above 60 once all 8 cylinders run.
 * Hybrids: steady-speed dyno (INL) and owner data show similar per-band drops (≈11% / 13%, 70–80 extrapolated), but a
 * steady 55 mph gets far more than the EPA highway label, because that label is built for mixed driving. So hybrids are
 * anchored at 1.3 × EPA highway at 55 mph (2020 Corolla Hybrid: Consumer Reports measured 59 mpg at a steady 65 vs. 50 EPA hwy).
 * Each 10-mph band's drop is compounded evenly per mph. Speeds outside 50–80 continue the nearest band's rate.
 */
(function (root) {
  'use strict';
  var TYPES = {
    car: { label: 'Car', bands: [0.124, 0.140, 0.154], anchor: 1.0 },
    suv: { label: 'SUV / minivan', bands: [0.124, 0.140, 0.154], anchor: 1.0 },
    truck: { label: 'Pickup / van', bands: [0.124, 0.140, 0.154], anchor: 1.0 },
    v8deact: { label: 'V8 with cylinder shutoff', bands: [0.124, 0.165, 0.19], anchor: 1.0 },
    hybrid: { label: 'Hybrid', bands: [0.11, 0.13, 0.155], anchor: 1.3 }
  };

  /** Guess the type from a fueleconomy.gov vehicle record. */
  function typeFromEpa(v) {
    var atv = String(v.atvType || ''), cls = String(v.VClass || ''), eng = String(v.eng_dscr || '');
    if (/hybrid/i.test(atv) || /HEV/.test(eng)) return 'hybrid';
    if (+v.cylinders === 8 && /CYL DEACT|DEAC|SIDI.*DEACT|MDS|AFM/i.test(eng)) return 'v8deact';
    if (/pickup|van|special purpose/i.test(cls) && !/minivan/i.test(cls)) return 'truck';
    if (/sport utility|minivan/i.test(cls)) return 'suv';
    return 'car';
  }

  function band(v) { return v < 60 ? 0 : v < 70 ? 1 : 2; }
  /** mpg at each whole mph from lo to hi, anchored so mpg(55) = epaHwy * type anchor * scale. */
  function curve(type, epaHwy, scale, lo, hi) {
    var t = TYPES[type] || TYPES.car, r = t.bands.map(function (d) { return Math.pow(1 - d, 0.1); });
    var a = epaHwy * t.anchor * (scale || 1), out = {};
    lo = Math.min(lo || 40, 55); hi = Math.max(hi || 90, 55);
    out[55] = a;
    for (var v = 55; v < hi; v++) out[v + 1] = out[v] * r[band(v)];          // step v -> v+1 uses the band v sits in
    for (v = 55; v > lo; v--) out[v - 1] = out[v] / r[band(v - 1)];
    return out;
  }
  function at(c, v) {
    var f = Math.floor(v), x = v - f;
    if (c[f + 1] == null) return c[f];
    return c[f] * (1 - x) + c[f + 1] * x;
  }

  /**
   * Scale the curve to your logged mileage: entries with a speed (35–90 mph). Uses the geometric mean of
   * observed / predicted, so one odd tank doesn't swing it as much.
   */
  function calibrate(type, epaHwy, entries) {
    var base = curve(type, epaHwy, 1, 30, 95), used = [], s = 0;
    (entries || []).forEach(function (e) {
      var sp = +e.speed, mpg = +e.mpg;
      if (!(sp >= 35 && sp <= 90 && mpg > 0)) return;
      var r = mpg / at(base, sp); used.push({ e: e, ratio: r }); s += Math.log(r);
    });
    return { scale: used.length ? Math.exp(s / used.length) : 1, used: used.length, points: used };
  }

  /**
   * For each speed from min+1 to max: what each hour saved costs vs. 1 mph slower.
   *   cost/hr = (extra gallons per mile × price) ÷ (hours saved per mile)
   * Recommended, with a time value: the highest speed (within min..max) where every step up to it costs no more than
   * timeValue per hour saved. Without one ("balanced"): the highest speed where each 1 mph faster raises gas use by no
   * more, in percent, than it cuts driving time — past it you pay more in gas than you gain in time, proportionally.
   */
  function recommend(opts) {
    var c = curve(opts.type, opts.epaHwy, opts.scale, Math.min(opts.min, 50) - 1, Math.max(opts.max, 80) + 1);
    var min = opts.min, max = Math.max(opts.min, opts.max), price = opts.price, tv = opts.timeValue;
    var rows = [], rec = min, stop = false;
    for (var v = min; v <= max; v++) {
      var row = { mph: v, mpg: c[v], galPer100: 100 / c[v] };
      if (v > min) {
        var extra = 1 / c[v] - 1 / c[v - 1], saved = 1 / (v - 1) - 1 / v;
        row.costPerHour = extra * price / saved;
        row.ratio = (extra * c[v - 1]) / (saved * (v - 1));        // % more gas per mile ÷ % less time per mile
        var ok = tv > 0 ? row.costPerHour <= tv : row.ratio <= 1;
        if (!stop && ok) rec = v; else stop = true;
      }
      rows.push(row);
    }
    var get = function (v) { return rows[v - min]; };
    function between(a, b) {           // cost per hour saved for going from a to b mph
      var ra = get(a), rb = get(b); if (!ra || !rb || a === b) return null;
      var extra = 1 / rb.mpg - 1 / ra.mpg, saved = 1 / a - 1 / b;
      return { from: a, to: b, perHour: extra * price / saved, per100: extra * 100 * price, minPer100: saved * 100 * 60 };
    }
    var up = rec + 5 <= max ? between(rec, rec + 5) : null, down = rec - 5 >= min ? between(rec - 5, rec) : null;
    return { speed: rec, mode: tv > 0 ? 'time' : 'balanced', rows: rows, curve: c, up: up, down: down, between: between };
  }

  /**
   * One leg of a trip at "posted limit + offset" on its cruising stretches (offset can be negative).
   * stretches: [{mi, limit, cruise}] (only cruise ones count). mpg(v): the car's curve.
   * Returns minutes saved vs. driving the limit, extra gallons, and the cost at this leg's gas price.
   */
  function leg(stretches, offset, mpg, price, lo, hi) {
    var mi = 0, minSaved = 0, extraGal = 0, w0 = 0, w1 = 0;
    (stretches || []).forEach(function (s) {
      if (!s.cruise || !(s.mi > 0)) return;
      var v0 = s.limit, v1 = Math.max(lo || 40, Math.min(hi || 90, v0 + offset));
      mi += s.mi; w0 += s.mi * v0; w1 += s.mi * v1;
      minSaved += s.mi * (1 / v0 - 1 / v1) * 60;
      extraGal += s.mi * (1 / mpg(v1) - 1 / mpg(v0));
    });
    return { mi: mi, minSaved: minSaved, extraGal: extraGal, cost: extraGal * price, avgLimit: mi ? w0 / mi : 0, avgSpeed: mi ? w1 / mi : 0 };
  }
  /** Highest speed where 1 mph faster still costs less (in %) in gas than it saves (in %) in time. */
  function balanced(mpg, lo, hi) {
    var v = lo;
    for (var x = lo + 1; x <= hi; x++) {
      var extra = 1 / mpg(x) - 1 / mpg(x - 1), saved = 1 / (x - 1) - 1 / x;
      if ((extra * mpg(x - 1)) / (saved * (x - 1)) <= 1) v = x; else break;
    }
    return v;
  }

  var api = { leg: leg, balanced: balanced, TYPES: TYPES, typeFromEpa: typeFromEpa, curve: curve, at: at, calibrate: calibrate, recommend: recommend };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Speed = api;
})(this);
