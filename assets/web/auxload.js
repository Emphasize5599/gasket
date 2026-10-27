/* Time-based auxiliary load for EVs and fuel-cell cars (pure; Node + browser). docs/TRAFFIC_ENERGY_HANDOFF.md section 5.
 * P_aux = cabin HVAC + 12 V / electronics, in kW, integrated over ELAPSED time (queueing included).
 * Pack thermal management remains in Propulsion.thermal and is never included a second time here,
 * so a crawl or a standstill costs energy per hour, not per mile. Settled values come from Argonne D3 (2019 Leaf e+,
 * 2020 Model 3), Seo 2025, ADAC standstill tests and Applied Energy 2026; the 5–15 °C band is interpolated (less
 * measured). Climate-preset scaling (setpoint gap ±40%, recirculation −15%, seat/wheel heat, defrost) is a labeled
 * fill-in. Warm-up is a STATE carried across sections: a new section never restarts it; a long parked stop does. */
(function initAuxLoad(root) {
  'use strict';
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(x, xs, ys) { if (x <= xs[0]) return ys[0]; for (var i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[ys.length - 1]; }
  // settled kW by ambient °C: [mid, low, high]; columns: heat pump (+PTC) and resistive / unknown (handoff 5.2)
  var T = [-25, -18, -8.5, 10, 15, 24, 27.5, 32.5];
  var HP = { mid: [4.2, 3.5, 1.8, .8, .25, .25, .6, 1.2], lo: [2.5, 2.5, 1.5, .5, .15, .15, .4, 1], hi: [5.9, 4.2, 2.4, 1.2, .35, .35, .9, 2] };
  var RES = { mid: [6.6, 4.2, 2.6, 1.2, .25, .25, .6, 1.2], lo: [6, 3.5, 2, .8, .15, .15, .4, 1], hi: [7.2, 5, 3, 1.6, .35, .35, .9, 2] };
  var BASE = .25;          // 12 V, blower and electronics at mild temperatures
  var PARK_COOL_S = 1200;  // a stop longer than ~20 min lets the cabin cool / heat back toward ambient
  function column(p) { return p && p.heatPump === true ? HP : RES; }   // unknown -> resistive (feasibility side)
  /** Settled auxiliary power at ambient tC, before preset scaling. which: 'mid' | 'lo' | 'hi'. */
  function settled(tC, p, which) { return lerp(+tC, T, column(p)[which || 'mid']); }
  /** Warm-up transient: extra power and how long it lasts after a cold start (Seo 2025: 250–820 s; Model 3 / ADAC). */
  function warmup(tC, p) {
    tC = +tC;
    if (tC <= 10) { var kw = p && p.heatPump === true ? lerp(tC, [-18, -8.5, 10], [4.2, 3.8, 1.2]) : lerp(tC, [-18, -8.5, 10], [5, 4, 1.6]); return { kw: kw, seconds: 60 * lerp(tC, [-18, -7, 10], [14, 10, 4]) }; }
    if (tC >= 30) return { kw: 2.3, seconds: 15 * 60 };   // hot soak + sun: 2.0–2.6 kW for the first 10–20 min
    return { kw: 0, seconds: 0 };
  }
  /** Climate preset -> multiplier on the HVAC part and fixed add-ons (fill-ins, handoff 5.2). preset: Garage climate
   *  preset fields {temp (°F or °C), unit, recirc, ac, seatHeat, wheelHeat, defrost}. */
  function presetScale(preset, tC) {
    preset = preset || {}; var sp = +preset.temp, f = 1, add = 0;
    if (preset.temp !== '' && preset.temp != null && Number.isFinite(sp)) { var spC = preset.unit === 'C' ? sp : (sp - 32) * 5 / 9, ref = Math.abs(22 - tC); if (ref > 1) f = clamp(Math.abs(spC - tC) / ref, .6, 1.4); }
    // Garage climate presets (climate.js): temp °F, ac 'on' | 'off', air 'fresh' | 'recirc', seatD 0–3, wheel, frontDef, flow
    if (preset.recirc === true || preset.air === 'recirc') f *= .85;
    if ((preset.ac === false || preset.ac === 'off') && tC > 24) f = 0;   // no cooling asked for: blower / electronics only
    if (preset.seatHeat || preset.seatD > 0) add += .075; if (preset.seatP > 0) add += .075; if (preset.wheelHeat || preset.wheel === true) add += .075; if (preset.defrost || preset.frontDef || preset.flow === 'defrost') add += .5; if (preset.rearDef) add += .15;
    return { f: f, add: add };
  }
  /** Settled power with the preset applied: base + scaled HVAC part + add-ons. */
  function power(tC, p, preset, which) {
    var s = settled(tC, p, which), sc = presetScale(preset, tC);
    return Math.max(BASE * (which === 'lo' ? .6 : 1), BASE + (s - BASE) * sc.f) + sc.add;
  }
  /** Fresh state for a drive start. preconditioned (on a plug) = no warm-up penalty. */
  function start(opts) { opts = opts || {}; return { warmLeft: opts.preconditioned ? 0 : null, parked: 0 }; }
  /** A parked stop (rest, charging, destination): long stops re-arm warm-up unless the car was preconditioned. */
  function park(state, seconds, opts) { var st = Object.assign({}, state); if (seconds >= PARK_COOL_S && !(opts && opts.preconditioned)) st.warmLeft = null; else if (opts && opts.preconditioned) st.warmLeft = 0; return st; }
  /** Energy (kWh) over a section of `seconds` elapsed at ambient tC, carrying warm-up state. Returns {kWh, lo, hi, state}. */
  function energy(state, seconds, tC, p, preset) {
    var st = Object.assign({}, state || start()), s = Math.max(0, +seconds || 0), w = warmup(tC, p);
    if (st.warmLeft == null) st.warmLeft = w.seconds;     // first section after a cold start arms the transient once
    var mid = power(tC, p, preset, 'mid'), lo = power(tC, p, preset, 'lo'), hi = power(tC, p, preset, 'hi');
    // warmup.kw is TOTAL initial power, not an extra load on top of settled demand.
    // Scale the HVAC portion by the same preset, including zero cooling when A/C is off.
    var sc = presetScale(preset, tC), peak = BASE + Math.max(0, w.kw - BASE) * sc.f + sc.add;
    var inWarm = Math.min(s, st.warmLeft), extra = inWarm * Math.max(0, peak - mid) / 3600; st.warmLeft -= inWarm;
    return { kWh: mid * s / 3600 + extra, lo: lo * s / 3600 + extra * .7, hi: hi * s / 3600 + extra * 1.3, kw: mid, state: st };
  }
  var api = { settled: settled, warmup: warmup, presetScale: presetScale, power: power, start: start, park: park, energy: energy, PARK_COOL_S: PARK_COOL_S, BASE: BASE };
  api.workerSource = '(' + initAuxLoad.toString() + ')(self);';
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AuxLoad = api;
})(typeof window !== 'undefined' ? window : this);
