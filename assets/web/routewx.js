/* Weather and air along the route, at the time you'd be there.
 *  - Weather: Open-Meteo's hourly forecast (up to 16 days; NOAA's models for the U.S.), at a point every ~20 miles.
 *  - Air: Open-Meteo's air-quality forecast (Copernicus CAMS, about 5 days ahead; wildfire smoke is in it), as the U.S. AQI.
 *  - Warnings: the National Weather Service's active alerts (the same warnings Google Maps shows on a route). One ask per
 *    state on the route; points are only asked in a state that has a driving-relevant alert.
 * Each point's time = when you leave + the driving time to it + the stops before it. Pure parts run in Node for the tests.
 */
(function (root) {
  'use strict';
  var HOUR = 3600e3;

  // ---------- where you'll be, and when ----------
  /** Seconds of driving from the start to mile mi (Google's time for each step, spread over its miles). */
  function timeAt(model, mi) {
    var segs = model.segs || [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (mi <= s.to || i === segs.length - 1) return s.t0 + (s.t1 - s.t0) * Math.max(0, Math.min(1, (mi - s.from) / ((s.to - s.from) || 1)));
    }
    return 0;
  }
  /**
   * Points along the route: every ~20 miles (more apart on very long trips, at most `max`), each with when you'd be there.
   * opts: {depart (ms), stops: [{mi, min}] (time spent at each stop), everyMi, max}
   */
  function samples(model, opts) {
    opts = opts || {};
    var total = model.totalMi, step = Math.max(opts.everyMi || 20, total / (opts.max || 120)), n = Math.max(1, Math.ceil(total / step)), out = [];
    var stops = (opts.stops || []).slice().sort(function (a, b) { return a.mi - b.mi; });
    for (var i = 0; i <= n; i++) {
      var mi = total * i / n, p = model.pointAt(mi), wait = 0;
      stops.forEach(function (s) { if (s.mi < mi) wait += s.min || 0; });
      out.push({ mi: mi, lat: p.lat, lng: p.lng, eta: (opts.depart || Date.now()) + timeAt(model, mi) * 1000 + wait * 60e3 });
    }
    return out;
  }

  // ---------- what the forecast means for driving ----------
  // [key, label, the climate situation it goes with (ClimateMath.WEATHER), icon]
  var KINDS = {
    alert: ['Weather warning', null, '⚠️'], storm: ['Thunderstorms', 'storm', '⛈️'], ice: ['Freezing rain or ice', 'ice', '🧊'], snow: ['Snow', 'snow', '🌨️'],
    rain: ['Rain', 'rain', '🌧️'], fog: ['Fog', 'fog', '🌫️'], wind: ['Strong wind', null, '💨'], heat: ['Heat', 'heat', '🌡️'], cold: ['Freezing cold', 'frost', '🥶'],
    air: ['Unhealthy air', 'smoke', '😷']
  };
  var ORDER = ['alert', 'storm', 'ice', 'snow', 'rain', 'fog', 'wind', 'heat', 'cold', 'air'];
  /** One point's forecast hour -> {kind: level (1 watch, 2 bad)} plus the numbers behind it. wx/aq: that hour's values. */
  function classify(wx, aq) {
    var f = {};
    if (wx) {
      var c = +wx.code, p = +wx.precip || 0, s = +wx.snow || 0, t = wx.tF, v = wx.visM, g = +wx.gust || 0;
      if (c >= 95) f.storm = 2;
      if ([56, 57, 66, 67].indexOf(c) >= 0 || (p >= 0.01 && t != null && t <= 32 && !s && !(c >= 71 && c <= 77) && c !== 85 && c !== 86)) f.ice = 2;
      if (s >= 0.4 || c === 75 || c === 86) f.snow = 2; else if (s > 0 || [71, 73, 77, 85].indexOf(c) >= 0) f.snow = 1;
      if (!f.snow && !f.ice) { if (p >= 0.3 || c === 65 || c === 82) f.rain = 2; else if (p >= 0.02 || [61, 63, 80, 81].indexOf(c) >= 0) f.rain = 1; }
      if (c === 45 || c === 48 || (v != null && v < 400)) f.fog = v != null && v < 400 ? 2 : 1; else if (v != null && v < 1600) f.fog = 1;
      if (g >= 50) f.wind = 2; else if (g >= 40) f.wind = 1;
      if (t != null && t >= 100) f.heat = 2; else if (t != null && t >= 93) f.heat = 1;
      if (t != null && t <= 0) f.cold = 2; else if (t != null && t <= 20) f.cold = 1;
    }
    if (aq && aq.aqi != null) { if (aq.aqi >= 151) f.air = 2; else if (aq.aqi >= 101) f.air = 1; }
    return f;
  }
  /** What's in the air: smoke / fine particles, smog (ozone), or dust. */
  function airCause(aq) {
    if (!aq) return '';
    if (+aq.dust >= 50) return 'dust';
    return (+aq.ozone || 0) > (+aq.pm25 || 0) ? 'smog (ozone)' : 'smoke or fine particles';
  }
  /**
   * Stretches of the route with each condition: consecutive points (a one-point gap is bridged), each
   * {kind, level, fromMi, toMi, from, to (ms), peak: {...}, events: [alert names]}. Sorted by where they start.
   */
  function stretches(pts) {
    var out = [];
    ORDER.forEach(function (k) {
      var cur = null, gap = 0;
      pts.forEach(function (p) {
        var lv = p.flags && p.flags[k];
        if (lv) {
          if (!cur) { cur = { kind: k, level: lv, fromMi: p.mi, toMi: p.mi, from: p.eta, to: p.eta, peak: {}, events: [] }; out.push(cur); }
          cur.toMi = p.mi; cur.to = p.eta; cur.level = Math.max(cur.level, lv); gap = 0;
          var w = p.wx || {}, q = p.aq || {};
          if (k === 'air' && (cur.peak.aqi == null || q.aqi > cur.peak.aqi)) cur.peak = { aqi: q.aqi, cause: airCause(q) };
          if (k === 'heat' && !(cur.peak.tF >= w.tF)) cur.peak = { tF: w.tF };
          if (k === 'cold' && !(cur.peak.tF <= w.tF)) cur.peak = { tF: w.tF };
          if (k === 'wind' && !(cur.peak.gust >= w.gust)) cur.peak = { gust: w.gust };
          if ((k === 'rain' || k === 'storm') && !(cur.peak.precip >= w.precip)) cur.peak = { precip: w.precip };
          if (k === 'snow' && !(cur.peak.snow >= w.snow)) cur.peak = { snow: w.snow };
          if (k === 'alert') (p.alerts || []).forEach(function (a) { if (cur.events.indexOf(a.event) < 0) cur.events.push(a.event); if (a.level > cur.level) cur.level = a.level; });
        } else if (cur && ++gap > 1) { cur = null; gap = 0; }
      });
    });
    return out.sort(function (a, b) { return a.fromMi - b.fromMi || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind); });
  }

  // ---------- what to do about it ----------
  // the climate presets' own names (ClimateMath.WEATHER)
  var SIT_NAME = { storm: 'stormy', ice: 'icy', snow: 'snowy', rain: 'rainy', fog: 'foggy', heat: 'hot & sunny', cold: 'frosty', air: 'smoky or polluted' };
  function isSummerTire(type) { return /summer|performance/i.test(type || '') && !/all[- ]?season|all[- ]?weather/i.test(type || ''); }
  /**
   * Advice for one stretch: [lines]. ctx: {tread (32nds or null), tireType, towing, preset: {title, line, notes} or null
   * (your climate preset for that situation, in the season you'll be driving)}.
   */
  function advice(x, ctx) {
    ctx = ctx || {};
    var a = [], d = ctx.tread, k = x.kind, long = x.to - x.from > HOUR;
    if (k === 'alert') a.push('The National Weather Service has ' + (x.events.length > 1 ? 'these out' : 'this out') + ' where and when you\'ll be there. Check it before you go; it can change your route or your day.');
    if (k === 'air') {
      a.push('Recirculate through it' + (x.peak.aqi ? ' (AQI up to ' + x.peak.aqi + (x.peak.cause ? ', mostly ' + x.peak.cause : '') + ')' : '') + ', then back to fresh air once you\'re past it.');
      if (long) a.push('It lasts over an hour: keep the A/C on so the air doesn\'t get stuffy, and if you get drowsy take a break at a stop rather than opening up to outside air.');
    }
    if ((k === 'rain' && x.level >= 2) || k === 'storm') {
      if (d != null && d <= 4) a.push('Your tires are at ' + (d <= 2 ? 'the legal limit' : 'about ' + d + '/32 in') + ': worn tread hydroplanes easily. Slow down well below the limit and stay out of standing water.');
      else a.push('Heavy rain: slow down, leave extra room, and keep out of standing water.');
    }
    if (k === 'snow' || k === 'ice') {
      if (isSummerTire(ctx.tireType)) a.push('Summer tires have very little grip on snow and ice. Wait it out or take another route if you can.');
      else if (d != null && d <= 6) a.push('Your tread (about ' + d + '/32 in) is below the ~6/32 that snow traction needs. Go slow and brake early.');
      else a.push(k === 'ice' ? 'Ice: slow way down, brake gently and early, and leave lots of room.' : 'Snow: go slow, brake early, and leave lots of room.');
    }
    if (k === 'cold' && isSummerTire(ctx.tireType)) a.push('Summer tires harden below about 45°F and lose grip. Take it easy.');
    if (k === 'fog') a.push('Low beams (not high beams), slow down, and keep a long gap.');
    if (k === 'wind') a.push(ctx.towing ? 'Strong crosswinds with a trailer: slow down; gusts can push it around.' : 'Strong crosswinds: both hands on the wheel, extra care passing trucks.');
    if (k === 'heat') a.push('Check the coolant and tire pressure before you go, and bring water.');
    if (ctx.preset) a.push('Your “' + ctx.preset.title + '” climate preset: ' + ctx.preset.line + (ctx.preset.notes ? '. ' + ctx.preset.notes : '') + '.');
    else if (SIT_NAME[k]) a.push('Tip: set up what you\'d do “If it\'s ' + SIT_NAME[k] + '” under Climate control in the Garage.');
    return a;
  }

  // ---------- the lookups ----------
  var NOT_DRIVING = /rip current|beach|marine|small craft|gale|coastal flood|lakeshore|surf|hydrologic outlook|red flag|fire weather|frost|freeze|low water|brisk wind|hazardous seas|seas|tsunami|ashfall/i;
  /** A National Weather Service alert that matters on the road, as {event, level, from, to, headline}; null if it doesn't. */
  function alertOf(f) {
    var p = f && f.properties || f || {};
    if (!p.event || NOT_DRIVING.test(p.event)) return null;
    var from = Date.parse(p.onset || p.effective || p.sent), to = Date.parse(p.ends || p.expires);
    return { id: p.id || f.id, event: p.event, level: /extreme|severe/i.test(p.severity) || /warning/i.test(p.event) ? 2 : 1, from: isNaN(from) ? 0 : from, to: isNaN(to) ? Infinity : to, headline: p.headline || '' };
  }
  function hourIdx(times, t) {
    if (!times || !times.length) return -1;
    var t0 = Date.parse(times[0] + 'Z'), i = Math.round((t - t0) / HOUR);
    return i >= 0 && i < times.length ? i : -1;
  }
  function list(body) { var j = typeof body === 'string' ? JSON.parse(body) : body; return Array.isArray(j) ? j : [j]; }
  async function pool(items, n, fn) {
    var i = 0, ws = [];
    async function w() { while (i < items.length) { var k = i++; await fn(items[k], k); } }
    for (var q = 0; q < Math.min(n, items.length); q++) ws.push(w());
    await Promise.all(ws);
  }
  /**
   * Fill each point with its forecast hour (wx), air (aq), alerts and flags. getJson(url) -> Promise<{body}|{error}>;
   * opts.stateAt(lat, lng) -> 'AR' (for the alerts). -> {pts, stats}
   */
  async function lookup(pts, getJson, opts) {
    opts = opts || {};
    var now = Date.now(), last = Math.max.apply(null, pts.map(function (p) { return p.eta; }));
    var days = Math.max(1, Math.min(16, Math.ceil((last - now) / 864e5) + 1));
    var stats = { points: pts.length, weather: 0, air: 0, alertStates: 0, alertPoints: 0, errors: 0, beyondWeather: 0, beyondAir: 0 };
    var r2 = function (v) { return v.toFixed(2); }, groups = [];
    for (var g = 0; g < pts.length; g += 50) groups.push(pts.slice(g, g + 50));
    var coords = function (ps) { return 'latitude=' + ps.map(function (p) { return r2(p.lat); }).join(',') + '&longitude=' + ps.map(function (p) { return r2(p.lng); }).join(','); };
    var get = async function (url) { var r = await getJson(url); if (!r || !r.body) { stats.errors++; return null; } return r.body; };
    await pool(groups, 3, async function (ps) {
      var body = await get('https://api.open-meteo.com/v1/forecast?' + coords(ps) + '&hourly=weather_code,temperature_2m,precipitation,snowfall,visibility,wind_gusts_10m' +
        '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=GMT&forecast_days=' + days);
      if (!body) return;
      try {
        list(body).forEach(function (d, k) {
          var p = ps[k], h = d && d.hourly; if (!p || !h) return;
          var i = hourIdx(h.time, p.eta); if (i < 0) { stats.beyondWeather++; return; }
          // Open-Meteo's snowfall is in inches of snow (not water) when precipitation_unit=inch
          p.wx = { code: h.weather_code[i], tF: h.temperature_2m[i], precip: h.precipitation[i], snow: h.snowfall[i], visM: h.visibility ? h.visibility[i] : null, gust: h.wind_gusts_10m[i] };
          stats.weather++;
        });
      } catch (e) { stats.errors++; }
    });
    var airDays = Math.min(5, days);
    await pool(groups, 3, async function (ps) {
      var body = await get('https://air-quality-api.open-meteo.com/v1/air-quality?' + coords(ps) + '&hourly=us_aqi,us_aqi_pm2_5,us_aqi_ozone,dust&timezone=GMT&forecast_days=' + airDays);
      if (!body) return;
      try {
        list(body).forEach(function (d, k) {
          var p = ps[k], h = d && d.hourly; if (!p || !h) return;
          var i = hourIdx(h.time, p.eta);
          if (i < 0 || h.us_aqi[i] == null) { stats.beyondAir++; return; }
          p.aq = { aqi: h.us_aqi[i], pm25: h.us_aqi_pm2_5[i], ozone: h.us_aqi_ozone[i], dust: h.dust ? h.dust[i] : null };
          stats.air++;
        });
      } catch (e) { stats.errors++; }
    });
    // warnings: each state once; then the points in a state with a warning that overlaps your time there
    if (opts.stateAt) {
      var byState = {};
      pts.forEach(function (p) { var st = opts.stateAt(p.lat, p.lng); if (st) (byState[st] = byState[st] || []).push(p); });
      var states = Object.keys(byState); stats.alertStates = states.length;
      var ask = [];
      await pool(states, 4, async function (st) {
        var body = await get('https://api.weather.gov/alerts/active?area=' + st); if (!body) return;
        try {
          var ps = byState[st], a = ps[0].eta - HOUR, b = ps[ps.length - 1].eta + HOUR;
          var any = (JSON.parse(body).features || []).map(alertOf).some(function (x) { return x && x.from <= b && x.to >= a; });
          if (any) ask = ask.concat(ps);
        } catch (e) { stats.errors++; }
      });
      stats.alertPoints = ask.length;
      await pool(ask, 4, async function (p) {
        var body = await get('https://api.weather.gov/alerts/active?point=' + p.lat.toFixed(3) + ',' + p.lng.toFixed(3)); if (!body) return;
        try { p.alerts = (JSON.parse(body).features || []).map(alertOf).filter(function (x) { return x && x.from <= p.eta + HOUR && x.to >= p.eta - HOUR; }); } catch (e) { stats.errors++; }
      });
    }
    pts.forEach(function (p) { p.flags = classify(p.wx, p.aq); if (p.alerts && p.alerts.length) p.flags.alert = Math.max.apply(null, p.alerts.map(function (a) { return a.level; })); });
    return { pts: pts, stats: stats };
  }

  var api = { timeAt: timeAt, samples: samples, classify: classify, airCause: airCause, stretches: stretches, advice: advice, alertOf: alertOf, hourIdx: hourIdx, lookup: lookup, KINDS: KINDS, ORDER: ORDER, isSummerTire: isSummerTire };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RouteWx = api;
})(typeof window !== 'undefined' ? window : globalThis);
