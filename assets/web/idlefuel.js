/* Engine-on idle fuel from displacement and cylinders (pure; Node + browser). docs/TRAFFIC_ENERGY_HANDOFF.md section 7.
 * P_idle_warm [L/h] = k × displacement_L × (idle_rpm / 700); k 0.32 gas (0.25–0.40; fitted to Argonne's measured
 * Focus 2.0 0.30, Fusion 2.5 0.40, Crown Vic 4.6 0.32), 0.28 diesel (measured Jetta 2.0 TDI). Cylinder count only
 * picks the default idle rpm: no independent effect was found (VT-CPFM with real cylinder counts contradicts the
 * measured V6/V8 data). Every value is DERIVED unless `measured` is set; owner OBD idle logs should replace it. */
(function initIdleFuel(root) {
  'use strict';
  var L_PER_GAL = 3.785411784, KWH_REPAY_L = .1 * L_PER_GAL;   // hybrid battery repaid at ~0.1 gal/kWh (33.7 kWh/gal × ~30%)
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(x, xs, ys) { if (x <= xs[0]) return ys[0]; for (var i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[ys.length - 1]; }
  // measured rows (Argonne idling worksheet / "Which is greener"; Glastonbury police): warm no-load and with load, L/h
  var MEASURED = [
    { name: 'Ford Focus 2.0 L I4', displ: 2, cyl: 4, fuel: 'gas', warm: .61, loaded: 1.10 },
    { name: 'Ford Fusion 2.5 L I4', displ: 2.5, cyl: 4, fuel: 'gas', warm: 1.00 },
    { name: 'Ford Crown Victoria 4.6 L V8', displ: 4.6, cyl: 8, fuel: 'gas', warm: 1.48, loaded: 2.23 },
    { name: 'VW Jetta 2.0 L diesel', displ: 2, cyl: 4, fuel: 'diesel', warm: .64, loaded: 1.48 }
  ];
  /** Default idle rpm from cylinders (or displacement when cylinders are unknown). */
  function idleRpm(e) {
    var d = +e.displ || 2.5, c = +e.cyl || 0, diesel = e.fuel === 'diesel';
    if (diesel) return d <= 2.2 ? 800 : 700;
    if (c === 3) return 800; if (c === 4) return d >= 2.4 ? 700 : 750; if (c === 5) return 700; if (c === 6) return 650;
    if (c >= 8) return d >= 5.3 ? 575 : 600;
    return d < 1.3 ? 800 : d < 2.4 ? 750 : d < 3 ? 700 : d < 4.5 ? 650 : 600;
  }
  /** A/C add-on at full load by size (L/h): "with full A/C" minus warm in the derived table; diesel from the Jetta. */
  function acAdd(e) { var d = +e.displ || 2.5; return e.fuel === 'diesel' ? lerp(d, [2, 3, 6.7], [.84, .75, .9]) : lerp(d, [1.1, 1.5, 1.9, 2.45, 2.7, 3.55, 4.8, 6.3, 7], [.45, .45, .5, .55, .6, .65, .75, .8, .85]); }
  /** Warm, no-load idle (L/h) with its range. */
  function warm(e) {
    var d = +e.displ, est = !(d > 0); if (est) d = 2.5;
    var k = e.fuel === 'diesel' ? [.28, .23, .33] : [.32, .25, .40], f = d * idleRpm(Object.assign({}, e, { displ: d })) / 700;
    return { lph: k[0] * f, lo: k[1] * f, hi: k[2] * f, estimatedDispl: est };
  }
  /** Engine-on idle fuel (L/h) right now.
   *  opts: {acFrac 0..1 (climate preset: off 0, max 1), electricalLph (heavy accessories, up to ~1), cold (engine still
   *  warming below 10 °C: ×1.6 fast idle), ambientC, startStop, coldEngine, lowBattery, defrost}.
   *  Hybrids (e.hybrid): engine-off share 0.8 warm and mild, 0.5 below 0 °C, 0.6 in heat with A/C; the battery drain
   *  (~0.3 kW while the engine is off) is charged back as fuel so the trip stays charge-neutral. */
  function idle(e, opts) {
    e = e || {}; opts = opts || {}; var w = warm(e), ac = clamp(+opts.acFrac || 0, 0, 1) * acAdd(e), el = Math.max(0, +opts.electricalLph || 0), mult = opts.cold ? 1.6 : 1;
    var on = (w.lph + ac + el) * mult, lo = (w.lo + ac * .7 + el) * mult, hi = (w.hi + ac * 1.3 + el) * mult, t = +opts.ambientC;
    if (e.hybrid) {
      var off = Number.isFinite(t) && t < 0 || opts.coldEngine ? .5 : opts.acFrac > 0 && t > 25 ? .6 : .8, repay = off * .3 * KWH_REPAY_L;
      return { lph: (1 - off) * on + repay, lo: (1 - off) * lo + repay * .8, hi: (1 - off) * hi + repay * 1.2, engineOnShare: 1 - off, batteryKw: off * .3, derived: true, estimatedDispl: w.estimatedDispl };
    }
    if (e.startStop && !(opts.acFrac >= 1 || opts.defrost || opts.cold || opts.coldEngine || opts.lowBattery)) return { lph: 0, lo: 0, hi: 0, engineOnShare: 0, derived: true, startStop: true, estimatedDispl: w.estimatedDispl };
    return { lph: on, lo: lo, hi: hi, engineOnShare: 1, derived: true, estimatedDispl: w.estimatedDispl };
  }
  /** Engine facts from the app's EPA engine text, e.g. "Auto (S6), 6 cyl, 3.5 L" (the same pattern garage.js reads). */
  function fromText(text, extra) {
    var t = String(text || ''), m, e = Object.assign({}, extra || {});
    if ((m = /([\d.]+)\s*L\b/.exec(t))) e.displ = +m[1]; if ((m = /(\d+)\s*cyl/i.exec(t)) || (m = /\b[VW](\d{1,2})\b/.exec(t)) || (m = /\b(?:Inline|I|H|Flat)[\s-]?(\d)\b/i.exec(t))) e.cyl = +m[1];
    if (/diesel/i.test(t) && !e.fuel) e.fuel = 'diesel'; return e;
  }
  var api = { MEASURED: MEASURED, idleRpm: idleRpm, acAdd: acAdd, warm: warm, idle: idle, fromText: fromText, L_PER_GAL: L_PER_GAL };
  api.workerSource = '(' + initIdleFuel.toString() + ')(self);';
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.IdleFuel = api;
})(typeof window !== 'undefined' ? window : this);
