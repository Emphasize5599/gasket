/* Weather and air along the route, at the time you'd be there.
 *  - Weather: Open-Meteo's hourly forecast (up to 16 days; NOAA's models for the U.S.), at a point every ~20 miles.
 *  - Air: Open-Meteo's air-quality forecast (Copernicus CAMS, about 5 days ahead; wildfire smoke is in it), as the U.S. AQI.
 *  - Warnings: the National Weather Service's active alerts (the same warnings Google Maps shows on a route): one ask per
 *    state on the route, each alert placed on the route by its own outline or by its counties (counties.js), at a point
 *    every mile, at the time you'd be there. Vague ones ("Special Weather Statement") are read by the rating model so
 *    the map says what the hazard is.
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
    alert: ['Weather warning', null, '⚠️'], tornado: ['Tornado', 'storm', '🌪️'], tropical: ['Tropical storm', 'storm', '🌀'], flood: ['Flooding', 'rain', '🌊'], storm: ['Thunderstorms', 'storm', '⛈️'], ice: ['Freezing rain or ice', 'ice', '🧊'], snow: ['Snow', 'snow', '🌨️'],
    rain: ['Rain', 'rain', '🌧️'], fog: ['Fog', 'fog', '🌫️'], wind: ['Strong wind', null, '💨'], heat: ['Heat', 'heat', '🌡️'], cold: ['Freezing cold', 'frost', '🥶'],
    air: ['Unhealthy air', 'smoke', '😷']
  };
  var ORDER = ['tornado', 'tropical', 'flood', 'alert', 'storm', 'ice', 'snow', 'rain', 'fog', 'wind', 'heat', 'cold', 'air'];
  // one color per kind of hazard, the same on every route, so you can tell at a glance which route has what
  var COLORS = { tornado: '#b71c1c', tropical: '#ad1457', flood: '#004d40', alert: '#e53935', storm: '#7b1fa2', ice: '#00e5ff', snow: '#82b1ff',
    rain: '#26a69a', fog: '#bcaaa4', wind: '#c0ca33', heat: '#ef6c00', cold: '#5c6bc0', air: '#6d4c41' };   // none close to the route's blue or the other routes' gray
  /** One point's forecast hour -> {kind: level (1 watch, 2 bad)} plus the numbers behind it. wx/aq: that hour's values. */
  function classify(wx, aq) {
    var f = wx && wx.src === 'nws' ? classifyNws(wx) : {};
    if (wx && wx.src !== 'nws') {
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
          var w = p.wx || {}, q = p.aq || {}, pk = cur.peak;
          if (k === 'air' && (pk.aqi == null || q.aqi > pk.aqi)) { pk.aqi = q.aqi; pk.cause = airCause(q); }
          if (k === 'heat' && !(pk.tF >= w.tF)) pk.tF = w.tF;
          if (k === 'cold' && !(pk.tF <= w.tF)) pk.tF = w.tF;
          if (k === 'wind') { if (w.gust != null && !(pk.gust >= w.gust)) pk.gust = w.gust; if (w.wind != null && !(pk.wind >= w.wind)) pk.wind = w.wind; }
          if ((k === 'rain' || k === 'storm') && w.precip != null && !(pk.precip >= w.precip)) pk.precip = w.precip;
          if (k === 'snow' && w.snow != null && !(pk.snow >= w.snow)) pk.snow = w.snow;
          if (k !== 'air' && w.src === 'nws' && w.text && (pk.pop == null || (w.pop || 0) > pk.pop)) { pk.text = w.text; pk.pop = w.pop; }   // the NWS forecast's own words
          if (k === 'alert') (p.alerts || []).forEach(function (a) { if (cur.events.indexOf(a.event) < 0) cur.events.push(a.event); if (a.level > cur.level) cur.level = a.level; });
        } else if (cur && ++gap > 1) { cur = null; gap = 0; }
      });
    });
    return out.sort(function (a, b) { return a.fromMi - b.fromMi || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind); });
  }

  // ---------- what to do about it ----------
  /** Known wet-weather exposure + current road tires, never the stored spare.
   * Review thresholds, not promises of grip: wet 4/32, snow/ice 5/32.
   * Sources: Tire Rack, "When Should Tires Be Replaced?" / "How Much Tread Depth Is Enough?".
   */
  function tireRisk(setup, hazards) {
    var wet = {rain:1,storm:1,flood:1,tropical:1,snow:1,ice:1}, kinds = [];
    (hazards || []).forEach(function(h){if(wet[h.kind] && kinds.indexOf(h.kind)<0)kinds.push(h.kind);});
    var winter = kinds.indexOf('snow')>=0 || kinds.indexOf('ice')>=0, limit = winter ? 5 : 4;
    var tires = kinds.length ? (setup && setup.tires || []).filter(function(t){return typeof t.depth==='number' && Number.isFinite(t.depth) && t.depth>=0 && t.depth<=limit;}) : [];
    return {kinds:tires.length?kinds:[],tires:tires,limit:limit};
  }
  /** Classes are profile estimates, never clearance measurements. Only the user confirms low ride height. */
  function vehicleProfile(car) {
    car=car||{};var i=car.info||{},cl=car.climate||{},t=car.tires||{},choice=/^(normal|low|tall)$/.test(i.hazardProfile)?i.hazardProfile:'auto';
    var body=i.body||car.epa&&car.epa.vclass||car.type||'',source=i.body?'NHTSA body class':car.epa&&car.epa.vclass?'EPA vehicle class':'Vehicle type';
    var high=/\b(suvs?|trucks?|pickups?|vans?|minivans?|bus|buses|motorhomes?)\b|sport utility|multipurpose passenger/i.test(body);
    if(choice!=='auto')high=choice==='tall';
    return {high:high,low:choice==='low',source:choice==='auto'?source+' (profile estimate)':'Your profile selection',
      label:choice==='low'?'Low-riding':high?'Tall / large':'Standard / unspecified',clearanceKnown:false,lowConfirmed:choice==='low',
      acUnavailable:!!cl.acBroken||!!(cl.caps&&cl.caps.noAc),towing:!!t.towMode&&(t.trailers||[]).some(function(tr){return !!tr.hooked;})};
  }
  var FIT_WEIGHT={tornado:10,flood:10,tropical:8,alert:7,storm:5,ice:6,snow:5,rain:3,fog:3,wind:4,heat:3,cold:3,air:3};
  /** Transparent comparison heuristic, not an accident probability or a safety certification. */
  function vehicleFit(hazards,profile,setup,totalMi) {
    profile=profile||{};var byKind={},reasons=[],urgent=0,peak=0,burden=0;
    function reason(s){if(reasons.indexOf(s)<0)reasons.push(s);}
    var tires=setup&&setup.tires||[],depths=tires.filter(function(t){return typeof t.depth==='number'&&Number.isFinite(t.depth)&&t.depth>=0;}).map(function(t){return t.depth;});
    var depth=depths.length?Math.min.apply(null,depths):null,summer=tires.some(function(t){return isSummerTire(t.type);});
    (hazards||[]).forEach(function(h){if(!KINDS[h.kind])return;var level=h.level>=2?2:1;
      if(/^(tornado|flood|tropical)$/.test(h.kind)||h.kind==='alert'&&level===2)urgent=1;
      if(h.kind==='flood')reason('Flooding: never enter water over the road');
      if(h.kind==='tornado')reason('Tornado: seek sturdy shelter');
      if(h.kind==='tropical')reason('Tropical storm exposure: consider postponing');
      if(h.kind==='alert'&&level===2)reason('Severe weather warning: review before travel');
      peak=Math.max(peak,level);
      var factor=1,k=h.kind;
      if(k==='wind'||k==='tropical'||k==='tornado'||k==='storm'){
        if(profile.towing){factor+=1;reason('Crosswinds while towing');}
        else if(profile.high){factor+=.6;reason('High-profile vehicle in wind ('+(profile.source==='Your profile selection'?'your selection':'class estimate')+')');}
      }
      if(/^(rain|storm|flood|tropical)$/.test(k)){
        if(depth!=null&&depth<=4){factor+=1;reason('Low tread in wet weather');}
        if(profile.low&&(level>=2||k!=='rain')){factor+=.7;reason('Low-riding vehicle: water clearance concern');}
        if(profile.acUnavailable){factor+=.6;reason('No A/C dehumidifying in wet weather');}
      }
      if(k==='fog'&&profile.acUnavailable){factor+=.6;reason('No A/C dehumidifying in fog');}
      if(k==='heat'&&profile.acUnavailable){factor+=1;reason('Heat without working A/C');}
      if(k==='snow'||k==='ice'){
        if(depth!=null&&depth<=5){factor+=1;reason('Low tread in snow or ice');}
        if(summer){factor+=1;reason('Summer tires in snow or ice');}
      }
      var from=Number.isFinite(h.fromMi)?Math.max(0,h.fromMi):0,to=Number.isFinite(h.toMi)?Math.max(from,h.toMi):from;
      if(Number.isFinite(totalMi)){from=Math.min(from,totalMi);to=Math.min(to,totalMi);}
      (byKind[k]||(byKind[k]=[])).push({from:from,to:Math.max(from+1,to),value:FIT_WEIGHT[k]*level*factor});
    });
    Object.keys(byKind).forEach(function(k){
      var rows=byKind[k],edges=Array.from(new Set(rows.reduce(function(a,r){return a.concat(r.from,r.to);},[]))).sort(function(a,b){return a-b;}),max=0,sum=0;
      for(var j=1;j<edges.length;j++){var value=0;rows.forEach(function(r){if(r.from<edges[j]&&r.to>edges[j-1])value=Math.max(value,r.value);});max=Math.max(max,value);sum+=value*(edges[j]-edges[j-1])/20;}
      burden+=max+sum; // overlapping forecasts/alerts of the same kind count only once
    });
    if(!reasons.length)reason(Object.keys(byKind).length?'Forecast exposure; no additional known vehicle factors':'No hazards found in the checked forecast');
    return {key:[urgent,peak,Math.round(burden*1000)],reasons:reasons};
  }
  function rankOptions(entries,car,setup) {
    var profile=vehicleProfile(car),all=true;
    var rows=entries.map(function(e,i){var s=e.stats||{},complete=!!e.ready&&!s.errors&&!s.beyondWeather&&!s.beyondAir&&!s.aiPending&&(s.points==null||s.weather>=s.points);
      if(!complete)all=false;return {index:i,complete:complete,fit:vehicleFit(e.hazards,profile,setup,e.miles)};
    });
    function cmp(a,b){for(var j=0;j<3;j++){var d=a.fit.key[j]-b.fit.key[j];if(d)return d;}return 0;}
    if(all){var ordered=rows.slice().sort(function(a,b){return cmp(a,b)||a.index-b.index;});ordered.forEach(function(r,i){r.rank=i&&cmp(r,ordered[i-1])===0?ordered[i-1].rank:i+1;});}
    return {rows:rows,profile:profile,complete:all};
  }
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
    if (x.peak && x.peak.text && x.src !== 'nws') a.push('National Weather Service forecast: ' + x.peak.text + (x.peak.pop ? ' (' + x.peak.pop + '% chance)' : '') + '.');
    if (k === 'tornado') a.push('Don\'t drive into it. Wait it out in a sturdy building, or take another route.');
    if (k === 'flood') a.push('Turn around, don\'t drown: never drive into water over the road. Six inches can stall a car, a foot can float it.');
    if (k === 'tropical') a.push('Avoid it if you can: flooding, downed trees and strong gusts. If you must go, slow down and keep out of standing water.');
    if(x.areaUncertain)a.push('This warning is in a nearby county, but its exact area could not be verified. It may not affect this road; check the NWS warning.');
    if (x.src === 'nws' && k !== 'alert') a.push('National Weather Service: ' + x.event + (x.area ? ' for ' + (x.area.length > 120 ? x.area.slice(0, 117) + '…' : x.area) : '') + '.');
    if (k === 'alert'&&!x.areaUncertain) a.push('The National Weather Service has ' + (x.events.length > 1 ? 'these out' : 'this out') + ' where and when you\'ll be there. Check it before you go; it can change your route or your day.');
    if (k === 'air') {
      a.push('Recirculate through it' + (x.peak.aqi ? ' (AQI up to ' + x.peak.aqi + (x.peak.cause ? ', mostly ' + x.peak.cause : '') + ')' : '') + ', then back to fresh air once you\'re past it.');
      if (long) a.push(ctx.acUnavailable?'No working A/C: recirculate cannot cool the cabin. Consider delaying travel; plan cooled rest stops away from the pollution.':'It lasts over an hour: keep the A/C on so the air doesn\'t get stuffy, and if you get drowsy take a break at a stop rather than opening up to outside air.');
    }
    if ((k === 'rain' && x.level >= 2) || k === 'storm' || k === 'flood' || k === 'tropical') {
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
    if(ctx.acUnavailable&&/^(rain|storm|fog|snow|ice|flood|tropical)$/.test(k))a.push('No A/C dehumidifying: use fresh air and windshield airflow as needed. If the glass will not stay clear, stop safely.');
    if(ctx.acUnavailable&&k==='heat')a.push('No working A/C: consider postponing or traveling at a cooler time, and plan cooled rest stops. Ventilation is not a substitute for A/C in extreme heat.');
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
    var from = Date.parse(p.onset || p.effective || p.sent), to = Date.parse(p.ends || p.expires), d = digestKnown(p.event);
    var same = ((p.geocode && p.geocode.SAME) || []).map(function (c) { return String(c).slice(-5); });
    var ugc=(p.geocode&&p.geocode.UGC)||[],zones=(p.affectedZones||[]).filter(function(u){return /^https:\/\/api\.weather\.gov\/zones\/(?:forecast|county|fire|marine)\/[A-Z]{3}\d{3}$/i.test(u);});
    if(!zones.length)ugc.forEach(function(code){if(/^[A-Z]{2}Z\d{3}$/i.test(code))zones.push('https://api.weather.gov/zones/forecast/'+code.toUpperCase());});
    return { id: p.id || f.id, event: p.event, level: /extreme|severe/i.test(p.severity) || /warning/i.test(p.event) ? 2 : 1, from: isNaN(from) ? 0 : from, to: isNaN(to) ? Infinity : to,
      headline: p.headline || '', text: String(p.description || '').replace(/\s+/g, ' ').slice(0, 12000), area: p.areaDesc || '', counties: same, polys: polysOf(f && f.geometry),
      kind: d ? d.kind : 'alert', label: d ? d.label : p.event, vague: !d,zones:zones,zoneBased:ugc.some(function(code){return /^[A-Z]{2}Z\d{3}$/i.test(code);})||zones.some(function(u){return !/\/county\//.test(u);}) };
  }
  /** What an alert is, from its name: {kind, label}, or null when the name doesn't say ("Special Weather Statement"). */
  var KNOWN = [[/tornado/i, 'tornado', 'Tornado'], [/hurricane|typhoon/i, 'tropical', 'Hurricane'], [/tropical storm|tropical depression/i, 'tropical', 'Tropical storm'],
    [/storm surge/i, 'flood', 'Storm surge'], [/flash flood/i, 'flood', 'Flash flooding'], [/flood/i, 'flood', 'Flooding'],
    [/ice storm|freezing rain|freezing drizzle|freezing spray|freezing fog/i, 'ice', 'Ice'], [/blizzard/i, 'snow', 'Blizzard'], [/snow squall/i, 'snow', 'Snow squalls'],
    [/winter storm|heavy snow|lake effect snow|winter weather|snow/i, 'snow', 'Snow and ice'], [/dense fog|fog/i, 'fog', 'Dense fog'],
    [/dust storm|blowing dust/i, 'air', 'Dust storm'], [/dense smoke|smoke|air quality|air stagnation/i, 'air', 'Smoke or bad air'],
    [/severe thunderstorm|thunderstorm/i, 'storm', 'Severe storms'], [/extreme wind|high wind|wind advisory|wind/i, 'wind', 'High wind'],
    [/extreme heat|excessive heat|heat/i, 'heat', 'Extreme heat'], [/extreme cold|wind chill|cold/i, 'cold', 'Extreme cold']];
  function digestKnown(event) { for (var i = 0; i < KNOWN.length; i++) if (KNOWN[i][0].test(event)) return { kind: KNOWN[i][1], label: KNOWN[i][2] }; return null; }
  /** A vague alert's words, when the rating model can't read it: the first hazard its text names. */
  function digestWords(text) {
    var t = String(text || '').replace(/\bcold\s+front\b/gi,'weather front'), best = null;
    KNOWN.forEach(function (k) { var re=k[1]==='cold'?/extreme cold|dangerously cold|dangerous(?:ly)? (?:low )?wind chill|wind chills? (?:as low as|below|of)\s*-\d|frostbite|hypothermia|temperatures? (?:well )?below zero/i:k[0];var m = re.exec(t); if (m && !/\b(?:no|not|without)\b[^.!?;,]{0,35}$/i.test(t.slice(Math.max(0,m.index-45),m.index)) && (!best || m.index < best.at)) best = { at: m.index, kind: k[1], label: k[2] }; });
    if (!best && /thunder|lightning|hail/i.test(t)) best = { kind: 'storm', label: 'Strong storms' };
    if (!best && /heavy rain|downpour/i.test(t)) best = { kind: 'rain', label: 'Heavy rain' };
    return best ? { kind: best.kind, label: best.label } : null;
  }
  // examples for the rating model, per hazard (the same model that rates recalls)
  var ALERT_EX = {
    storm: ['Strong thunderstorms with gusty winds, hail and frequent lightning.', 'A line of severe storms is moving through the area.', 'Thunderstorms capable of damaging winds and large hail.'],
    tornado: ['A tornado or rotation was spotted; take shelter now.', 'Conditions are favorable for tornadoes.', 'A tornado is possible with these storms.'],
    flood: ['Heavy rain may cause flooding of roads and low-lying areas.', 'Rainfall totals of several inches could lead to flooding.', 'Flash flooding is possible; do not drive through flooded roads.'],
    tropical: ['Tropical storm or hurricane conditions are possible.', 'A hurricane will bring strong winds, heavy rain and storm surge.', 'Prepare for tropical storm force winds along the coast.'],
    rain: ['Periods of heavy rain will reduce visibility on roads.', 'Downpours and wet roads are expected.', 'Rain will be heavy at times.'],
    snow: ['Snow will make travel difficult with slick, snow-covered roads.', 'Heavy snow and blowing snow reduce visibility.', 'Snow accumulations of several inches are expected.'],
    ice: ['Freezing rain will glaze roads and bridges with ice.', 'Black ice is likely on roads and overpasses.', 'Icy roads and sleet make travel hazardous.'],
    fog: ['Dense fog will reduce visibility to a quarter mile or less.', 'Areas of fog with near-zero visibility.', 'Patchy dense fog is expected this morning.'],
    wind: ['Strong gusty winds could blow around unsecured objects and make driving difficult.', 'Gusts up to 60 mph are expected.', 'High winds will make travel difficult for high-profile vehicles.'],
    heat: ['Dangerously hot temperatures and high heat index values.', 'Heat index values over 105 degrees.', 'Extreme heat will continue through the afternoon.'],
    cold: ['Dangerously cold wind chills.', 'Temperatures will drop well below zero.', 'Frostbite can occur on exposed skin within minutes.'],
    air: ['Smoke from wildfires will reduce air quality and visibility.', 'Blowing dust will reduce visibility to near zero.', 'Air quality will be unhealthy for sensitive groups.']
  };
  var AI_LABEL = { tropical: 'Tropical storm', storm: 'Strong storms', tornado: 'Tornado threat', flood: 'Flooding', rain: 'Heavy rain', snow: 'Snow', ice: 'Ice', fog: 'Dense fog', wind: 'High wind', heat: 'Extreme heat', cold: 'Extreme cold', air: 'Smoke or dust' };
  /** Read a vague alert: compare(text, groups) -> Promise<{group: score}|null> (Severity.compare), else its words. */
  var DIGEST_MS = 4000;
  async function digest(a, compare, ms) {
    if (!a.vague) return a;
    // the model gets a few seconds at most (it may be busy rating recalls); its words read the alert otherwise
    var fullText=a.headline+'. '+a.text, words=digestWords(fullText);
    var txt = fullText.slice(0, 600), sc = compare ? await Promise.race([
      compare(txt, ALERT_EX).catch(function () { return null; }),
      new Promise(function (r) { setTimeout(function () { r(null); }, ms || DIGEST_MS); })]) : null;
    // no answer from the model (not loaded yet, busy or failed): its words for now, marked so it can be read again
    a.aiPending = !sc;
    if (sc) {
      var best = Object.keys(sc).sort(function (x, y) { return sc[y] - sc[x]; })[0];
      var runner=Object.keys(sc).filter(function(k){return k!==best;}).reduce(function(n,k){return Math.max(n,sc[k]);},0);
      // Similarity is not evidence of dangerous cold/heat. A front or seasonal temperatures alone are not an extreme alert.
      var supported=best!=='cold'||words&&words.kind==='cold';
      if(best==='heat')supported=/extreme heat|excessive heat|dangerously hot|heat index.{0,25}(?:10[5-9]|1[1-9]\d)/i.test(fullText);
      if (Number.isFinite(sc[best])&&sc[best] >= 0.35&&sc[best]-runner>=0.06&&supported) { a.kind = best; a.label = AI_LABEL[best]; a.by = 'ai'; return a; }
    }
    var w = words;
    if (w) { a.kind = w.kind; a.label = w.label; a.by = 'words'; }
    else {a.kind='alert';a.label=a.event;a.by='words';}
    return a;
  }

  // ---------- where an alert is: its outline, or its counties ----------
  /** GeoJSON Polygon / MultiPolygon -> [[ring [lng, lat, ...], holes...], ...] with a bounding box each. */
  function polysOf(g) {
    if (!g || !g.coordinates) return null;
    var ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
    return ps && ps.map(function (poly) { return poly.map(function (ring) { return [].concat.apply([], ring.map(function (c) { return [c[0], c[1]]; })); }); });
  }
  function inRing(r, x, y) {
    var inside = false;
    for (var i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      var xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function boxOf(ring) { var b = [1e9, 1e9, -1e9, -1e9]; for (var i = 0; i < ring.length; i += 2) { b[0] = Math.min(b[0], ring[i]); b[2] = Math.max(b[2], ring[i]); b[1] = Math.min(b[1], ring[i + 1]); b[3] = Math.max(b[3], ring[i + 1]); } return b; }
  /** Is the point in any of these polygons (states.js / counties.js shape)? Boxes are kept on the polygons. */
  function inPolys(polys, lat, lng) {
    for (var k = 0; k < polys.length; k++) {
      var poly = polys[k], b = poly._b || (poly._b = boxOf(poly[0]));
      if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3] || !inRing(poly[0], lng, lat)) continue;
      var hole = false; for (var h = 1; h < poly.length; h++) if (inRing(poly[h], lng, lat)) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }
  /** The polygons an alert covers: its own outline, else its counties (countyOf(fips) -> polygons). */
  function alertArea(a, countyOf) {
    if(a.zoneOutsideRoute)return [];
    if (a.polys && a.polys.length) return a.polys;
    if (a.zonePolys && a.zonePolys.length) return a.zonePolys;
    var out = []; (a.counties || []).forEach(function (f) { var c = countyOf && countyOf(f); if (c) out = out.concat(c); });
    return out;
  }
  /**
   * Stretches of the route under each alert, while it's in effect when you're there. dense: points every ~mile
   * ({mi, lat, lng, eta}). -> [{kind, level, fromMi, toMi, from, to, src: 'nws', event, label, headline, area, id}]
   */
  function alertStretches(dense, alerts, countyOf) {
    var out = [];
    alerts.forEach(function (a) {
      var area = alertArea(a, countyOf); if (!area.length) return;
      var uncertain=!!a.zoneBased&&!(a.polys&&a.polys.length)&&!(a.zonePolys&&a.zonePolys.length);
      var cur = null, gap = 0;
      dense.forEach(function (p) {
        var hit = p.eta >= a.from - HOUR && p.eta <= a.to + HOUR && inPolys(area, p.lat, p.lng);
        if (hit) {
          if (!cur) { cur = { kind: uncertain?'alert':a.kind, level: a.level, fromMi: p.mi, toMi: p.mi, from: p.eta, to: p.eta, src: 'nws', event: a.event, label: uncertain?'Nearby '+a.event+' · area unverified':a.label, headline: a.headline, area: a.area, id: a.id, by: a.by, aiPending: !!a.aiPending,areaUncertain:uncertain,areaSource:a.polys&&a.polys.length?'warning polygon':a.zonePolys&&a.zonePolys.length?'NWS zone':uncertain?'unverified county vicinity':'county', events: [a.event], peak: {} }; out.push(cur); }
          cur.toMi = p.mi; cur.to = p.eta; gap = 0;
        } else if (cur && ++gap > 2) { cur = null; gap = 0; }
      });
    });
    return out;
  }
  function hourIdx(times, t) {
    if (!times || !times.length) return -1;
    // Each hourly value covers the hour beginning at its timestamp; rounding used tomorrow's hour after :30.
    var t0 = Date.parse(times[0] + 'Z'), i = Math.floor((t - t0) / HOUR);
    return i >= 0 && i < times.length ? i : -1;
  }
  function list(body) { var j = typeof body === 'string' ? JSON.parse(body) : body; return Array.isArray(j) ? j : [j]; }
  async function pool(items, n, fn) {
    var i = 0, ws = [];
    async function w() { while (i < items.length) { var k = i++; await fn(items[k], k); } }
    for (var q = 0; q < Math.min(n, items.length); q++) ws.push(w());
    await Promise.all(ws);
  }
  /** "10 to 15 mph" -> 15 (the most it says). */
  function windMph(s) { var m = String(s || '').match(/\d+/g); return m ? Math.max.apply(null, m.map(Number)) : null; }
  /** A point's NWS hourly forecast periods: /points (which grid square, kept 30 days) then that square's hourly forecast. */
  async function nwsHourly(p, getJson, stats) {
    try {
      var r = await getJson('https://api.weather.gov/points/' + p.lat.toFixed(4) + ',' + p.lng.toFixed(4));
      var url = r && r.body && JSON.parse(r.body).properties.forecastHourly; if (!url) throw new Error('no grid');
      var h = await getJson(url); if (!h || !h.body) throw new Error('no forecast');
      return JSON.parse(h.body).properties.periods || null;
    } catch (e) { stats.nwsErrors = (stats.nwsErrors || 0) + 1; return null; }
  }
  /** The NWS forecast's words for an hour -> {kind: level}: thunderstorms, freezing rain / sleet, snow, rain, fog, wind. */
  function classifyNws(w) {
    var f = {}, t = String(w.text || '').toLowerCase(), pop = w.pop == null ? null : +w.pop;
    var some = pop == null || pop >= 30, likely = pop == null || pop >= 50 || /likely|heavy/.test(t);
    if (/thunder|t-storm/.test(t) && some) f.storm = (pop != null && pop >= 60) || /severe|likely/.test(t) ? 2 : 1;
    if (/freezing (rain|drizzle)|sleet|\bice\b/.test(t) && some) f.ice = 2;
    else if (/snow|blizzard/.test(t) && some) f.snow = /heavy snow|blizzard/.test(t) ? 2 : 1;
    if (!f.snow && !f.ice && /rain|showers|drizzle/.test(t) && likely && !(f.storm && !/heavy/.test(t))) f.rain = /heavy/.test(t) ? 2 : 1;
    if (/fog/.test(t)) f.fog = /dense/.test(t) ? 2 : 1;
    if (w.wind >= 40) f.wind = 2; else if (w.wind >= 30 || /\bwindy\b/.test(t)) f.wind = 1;
    var tF = w.tF;
    if (tF != null && tF >= 100) f.heat = 2; else if (tF != null && tF >= 93) f.heat = 1;
    if (tF != null && tF <= 0) f.cold = 2; else if (tF != null && tF <= 20) f.cold = 1;
    return f;
  }
  // Zone-based alerts' SAME codes list intersecting counties, NOT the warning's
  // exact footprint. Resolve affectedZones before falling back to a county.
  var zonePending=new Map();
  async function locateAlerts(alerts,getJson,stats,opts){
    var todo=alerts.filter(function(a){return !(a.polys&&a.polys.length)&&(a.zoneBased||!a.counties.length)&&a.zones.length;}),urls=new Set(),resolved=new Map();
    var routeBox=opts.dense&&opts.dense.length?boxOf([].concat.apply([],opts.dense.map(function(p){return [p.lng,p.lat];}))):null;
    todo=todo.filter(function(a){
      if(routeBox&&a.counties.length&&opts.countyOf){
        var known=true,overlap=false;
        a.counties.forEach(function(f){var polys=opts.countyOf(f);if(!polys||!polys.length){known=false;return;}polys.forEach(function(poly){var b=poly._b||(poly._b=boxOf(poly[0]));if(b[0]<=routeBox[2]&&b[2]>=routeBox[0]&&b[1]<=routeBox[3]&&b[3]>=routeBox[1])overlap=true;});});
        if(known&&!overlap){a.zoneOutsideRoute=true;return false;}
      }
      a.zones.forEach(function(u){urls.add(u);});return true;
    });
    stats.alertZones=urls.size;stats.alertZoneErrors=0;
    await pool(Array.from(urls),4,async function(url){
      try{
        var job=zonePending.get(url);
        if(!job){job=(async function(){var r=await getJson(url);if(!r||!r.body)throw new Error('Warning zone unavailable');var area=polysOf(JSON.parse(r.body).geometry);if(!area||!area.length)throw new Error('Warning zone has no geometry');return area;})().finally(function(){zonePending.delete(url);});zonePending.set(url,job);}
        resolved.set(url,await job);
      }catch(e){stats.alertZoneErrors++;stats.errors++;}
    });
    todo.forEach(function(a){if(a.zones.every(function(u){return resolved.has(u);}))a.zonePolys=[].concat.apply([],a.zones.map(function(u){return resolved.get(u);}));});
    stats.alertAreaUncertain=alerts.filter(function(a){return a.zoneBased&&!a.zoneOutsideRoute&&!(a.polys&&a.polys.length)&&!(a.zonePolys&&a.zonePolys.length);}).length;
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
    var done = 0, total = groups.length + 1, tell = function () { if (opts.onProg) opts.onProg(Math.min(0.97, done / total)); };
    var get = async function (url) { var r = await getJson(url); done++; tell(); if (!r || !r.body) { stats.errors++; return null; } return r.body; };
    tell();
    // weather: the National Weather Service's hourly forecast (its forecasters' own, about 6.5 days) at each point;
    // later than that, or where it fails, Open-Meteo: the National Blend of Models (what NWS starts from), else its default
    var nwsEnd = now + 156 * HOUR, near = pts.filter(function (p) { return p.eta < nwsEnd; });
    total += near.length; tell();
    stats.nws = 0;
    await pool(near, 4, async function (p) {
      var hourly = await nwsHourly(p, getJson, stats); done++; tell(); if (!hourly) return;
      var per = hourly.filter(function (x) { return Date.parse(x.startTime) <= p.eta && p.eta < Date.parse(x.endTime); })[0];
      if (!per) return;
      p.wx = { src: 'nws', text: per.shortForecast || '', pop: per.probabilityOfPrecipitation ? per.probabilityOfPrecipitation.value : null,
        tF: per.temperatureUnit === 'C' ? per.temperature * 9 / 5 + 32 : per.temperature, wind: windMph(per.windSpeed) };
      stats.weather++; stats.nws++;
    });
    var om = async function (ps, model) {
      var gs = []; for (var g2 = 0; g2 < ps.length; g2 += 50) gs.push(ps.slice(g2, g2 + 50));
      var left = [];
      await pool(gs, 3, async function (qs) {
        var body = await get('https://api.open-meteo.com/v1/forecast?' + coords(qs) + '&hourly=weather_code,temperature_2m,precipitation,snowfall,visibility,wind_gusts_10m' +
          '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' + (model ? '&models=' + model : '') + '&timezone=GMT&forecast_days=' + days);
        if (!body) { left = left.concat(qs); return; }
        try {
          list(body).forEach(function (d, k) {
            var p = qs[k], h = d && d.hourly; if (!p || !h) return;
            var i = hourIdx(h.time, p.eta);
            if (i < 0 || (h.weather_code[i] == null && h.precipitation[i] == null)) { left.push(p); return; }
            // Open-Meteo's snowfall is in inches of snow (not water) when precipitation_unit=inch
            p.wx = { src: model ? 'nbm' : 'om', code: h.weather_code[i], tF: h.temperature_2m[i], precip: h.precipitation[i], snow: h.snowfall ? h.snowfall[i] : null, visM: h.visibility ? h.visibility[i] : null, gust: h.wind_gusts_10m ? h.wind_gusts_10m[i] : null };
            stats.weather++;
          });
        } catch (e) { stats.errors++; left = left.concat(qs); }
      });
      return left;
    };
    var rest = pts.filter(function (p) { return !p.wx; });
    if (rest.length) {
      total += Math.ceil(rest.length / 50) * 2; tell();
      var stillLeft = await om(rest, 'ncep_nbm_conus');
      if (stillLeft.length) stillLeft = await om(stillLeft, null);
      stats.beyondWeather = stillLeft.length;
    }
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
    // warnings: each state once (from the points every mile), each alert placed by its outline or its counties
    var alerts = [];
    if (opts.stateAt && opts.dense) {
      var byState = {};
      opts.dense.forEach(function (p) { var st = opts.stateAt(p.lat, p.lng); if (st) (byState[st] = byState[st] || []).push(p); });
      var states = Object.keys(byState); stats.alertStates = states.length; total += states.length - 1; tell();
      var seen = {};
      await pool(states, 4, async function (st) {
        var body = await get('https://api.weather.gov/alerts/active?area=' + st); if (!body) return;
        try {
          var ps = byState[st], a = ps[0].eta - HOUR, b = ps[ps.length - 1].eta + HOUR;
          (JSON.parse(body).features || []).map(alertOf).forEach(function (x) { if (x && x.from <= b && x.to >= a && !seen[x.id]) { seen[x.id] = 1; alerts.push(x); } });
        } catch (e) { stats.errors++; }
      });
      stats.alerts = alerts.length;
      if (alerts.some(function (x) { return !(x.polys && x.polys.length); }) && opts.counties) await opts.counties();   // load the county outlines only when needed
      await locateAlerts(alerts,getJson,stats,opts);
      total += alerts.length; tell();
      for (var q = 0; q < alerts.length; q++) { await digest(alerts[q], opts.compare, opts.digestMs); done++; tell(); }
    }
    pts.forEach(function (p) { p.flags = classify(p.wx, p.aq); });
    return { pts: pts, stats: stats, alerts: alerts };
  }

  /**
   * Every hazard on one route (one leg), where and when you'd be there: the forecast's stretches (each widened by half
   * the gap between forecast points, so they cover the road between) and each alert's. opts: {depart, stops, stateAt,
   * countyOf(fips), counties() (loads them), compare (the rating model)}. -> {hazards, stats}
   */
  async function forRoute(model, getJson, opts) {
    opts = opts || {};
    var pts = samples(model, { depart: opts.depart, stops: opts.stops }), dense = samples(model, { depart: opts.depart, stops: opts.stops, everyMi: 1, max: 4000 });
    var half = pts.length > 1 ? (pts[1].mi - pts[0].mi) / 2 : 0;
    var res = await lookup(pts, getJson, Object.assign({}, opts, { dense: dense }));
    var wx = stretches(res.pts).map(function (x) { x.src = x.kind === 'air' ? 'air' : 'forecast'; x.fromMi = Math.max(0, x.fromMi - half); x.toMi = Math.min(model.totalMi, x.toMi + half); return x; });
    var al = alertStretches(dense, res.alerts || [], opts.countyOf);
    var hz = wx.concat(al).sort(function (a, b) { return a.fromMi - b.fromMi || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind); });
    res.stats.hazards = hz.length;
    res.stats.aiPending = al.filter(function (x) { return x.aiPending; }).length;   // warnings on this road the model hasn't read yet
    return { hazards: hz, stats: res.stats, alerts: res.alerts || [], dense:dense, forecast:wx };
  }
  /** Rate only retained warning text, with no forecast, air or alert requests. */
  async function rerate(reading,compare,countyOf,ms){
    var alerts=(reading.alerts||[]).map(function(a){return Object.assign({},a);});
    await pool(alerts.filter(function(a){return a.aiPending;}),2,function(a){return digest(a,compare,ms);});
    var al=alertStretches(reading.dense||[],alerts,countyOf),hz=(reading.forecast||[]).concat(al).sort(function(a,b){return a.fromMi-b.fromMi||ORDER.indexOf(a.kind)-ORDER.indexOf(b.kind);});
    return {hazards:hz,stats:Object.assign({},reading.stats,{hazards:hz.length,aiPending:al.filter(function(a){return a.aiPending;}).length})};
  }
  /** A hazard's short name for the map and the list: "Heavy rain", "Tornado", "Unhealthy air (AQI 162)". */
  function title(x) {
    var pk = x.peak || {};
    if (x.src === 'nws') return x.label || x.event;
    if (x.kind === 'air') return (x.level >= 2 ? 'Unhealthy air' : 'Air unhealthy for sensitive groups') + (pk.aqi ? ' (AQI ' + pk.aqi + ')' : '');
    if (x.kind === 'rain') return x.level >= 2 ? 'Heavy rain' : 'Rain';
    if (x.kind === 'snow') return x.level >= 2 ? 'Heavy snow' : 'Snow';
    if (x.kind === 'heat') return 'Heat' + (pk.tF != null ? ' (up to ' + Math.round(pk.tF) + '°F)' : '');
    if (x.kind === 'cold') return 'Below freezing' + (pk.tF != null ? ' (down to ' + Math.round(pk.tF) + '°F)' : '');
    if (x.kind === 'wind') return 'Strong wind' + (pk.gust ? ' (gusts to ' + Math.round(pk.gust) + ' mph)' : pk.wind ? ' (up to ' + Math.round(pk.wind) + ' mph)' : '');
    return KINDS[x.kind][0];
  }
  var api = { vehicleProfile:vehicleProfile,vehicleFit:vehicleFit,rankOptions:rankOptions,tireRisk:tireRisk, timeAt: timeAt, samples: samples, classify: classify, airCause: airCause, stretches: stretches, advice: advice, alertOf: alertOf, hourIdx: hourIdx, lookup: lookup, KINDS: KINDS, ORDER: ORDER, COLORS: COLORS, isSummerTire: isSummerTire, classifyNws: classifyNws, windMph: windMph,
    forRoute: forRoute, rerate:rerate, title: title, digest: digest, digestKnown: digestKnown, digestWords: digestWords, alertStretches: alertStretches, inPolys: inPolys, polysOf: polysOf, ALERT_EX: ALERT_EX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RouteWx = api;
})(typeof window !== 'undefined' ? window : globalThis);
