/* Fuel+ Map — trip planner screens. Import a Google Maps route, find priced stations along it,
 * pick the stops that actually save money, and send the route (with stops) back to Google Maps. */
(function () {
  'use strict';
  var A = window.__app, T = window.Trip, P = A.P, S = A.S, N = A.N, map = A.map, $ = A.$;
  var esc = A.esc, priceHtml = A.priceHtml;

  // ---------- persistent inputs ----------
  S.car = Object.assign({ name: '', city: 25, hwy: 33, comb: 28, tank: 14, adjustPct: 100, grade: '', epaFuel: '' }, S.car || {});
  S.trip = Object.assign({ link: '', from: '', to: '', milesLeft: '', bufferMi: 40, fillUp: false, minSave: 1, timeValue: 0,
    arrive: 'buffer', topUpMi: 1.0, roundTrip: true, tankPrice: '', maxDetourMin: 10, altCompare: false, altMinSave: 5,
    avoid: { tolls: false, highways: false, ferries: false } }, S.trip || {});

  // ---------- native calls as promises ----------
  var nid = 900000, waiting = {};
  window.onNativeResult = function (id, res) { var f = waiting[id]; if (f) { delete waiting[id]; f(res); } };
  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve) {
      var id = ++nid; waiting[id] = resolve;
      N[fn].apply(N, [id].concat(args));
    });
  }
  var progH = {};
  window.onNativeProgress = function (id, done, total) { var f = progH[id]; if (f) f(done, total); };
  window.onSiteProgress = function (key, id, done, total) { var f = progH[key + ':' + id]; if (f) f(done, total); };
  /** like call(), with a progress callback (done, total) */
  function callP(onProg, fn) {
    var args = Array.prototype.slice.call(arguments, 2);
    return new Promise(function (resolve) {
      var id = ++nid; waiting[id] = function (r) { delete progH[id]; resolve(r); }; progH[id] = onProg;
      N[fn].apply(N, [id].concat(args));
    });
  }
  var LG = window.FLog || { error: function () {}, warn: function () {}, info: function () {}, debug: function () {}, trace: function () {} };
  // what happened on the last trip, for the troubleshooting report
  var dbg = {};
  var siteWait = {};
  window.__tripSite = function (key, id, res) {
    var f = siteWait[key + ':' + id]; if (!f) return false;
    delete siteWait[key + ':' + id]; f(res); return true;
  };
  function site(key, args, timeoutMs, onProg) {
    return new Promise(function (resolve) {
      var id = ++nid, k = key + ':' + id;
      siteWait[k] = function (r) { delete progH[k]; resolve(r); };
      if (onProg) progH[k] = onProg;
      setTimeout(function () { if (siteWait[k]) { delete siteWait[k]; delete progH[k]; LG.warn('site', key + ' timed out'); resolve({ error: 'timed out' }); } }, timeoutMs || 90000);
      N.siteSearch(key, id, JSON.stringify(args));
    });
  }

  // ---------- state ----------
  var route = null;      // parsed link {stops, avoid, mode}
  var model = null;      // T.buildRoute result
  var rawRoute = null;   // Routes API route
  var result = null;     // plan + candidates
  var alts = [], altSel = 0, altSure = false;   // Google's route options for this trip
  var layer = L.layerGroup();
  var busy = false;

  /** Progress inside the Get route / Find stops button: frac 0..1 and what it's doing. */
  function prog(frac, label) {
    var b = $('tGo'); if (!b) return;
    var pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
    b.classList.add('busy');
    b.innerHTML = '<span class="pfill" style="width:' + pct + '%"></span><span class="plab">' + esc(label) + ' · ' + pct + '%</span>';
  }
  function progEnd() { var b = $('tGo'); if (b) b.classList.remove('busy'); }
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function fmtDur(sec) { var m = Math.round(sec / 60), h = Math.floor(m / 60); return h ? h + ' h ' + (m % 60) + ' min' : m + ' min'; }
  function money(v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2); }
  function gradeOf() { return S.car.grade || S.grade || 'regular'; }

  // ---------- setup page ----------
  function openTrip() {
    A.closeDetail();
    var pg = $('trip');
    var c = S.car, t = S.trip;
    var h = '<div class="t-head"><h1>Plan fuel stops</h1><button class="x" id="tClose" aria-label="Close">✕</button></div>' +
      '<p class="lead">Bring in a Google Maps route, and Fuel+ picks the stops that save money — counting detours — then sends the route back with the stops added.</p>';

    h += '<div class="card"><h3>1 · Route</h3>' +
      '<div class="field col"><div class="lbl">Google Maps directions link<small>In Google Maps: get directions → ⋮ → <b>Share directions</b> → Fuel+ Map. Or copy the link and paste it here.</small></div>' +
      '<textarea id="tLink" rows="2" placeholder="https://maps.app.goo.gl/…" spellcheck="false">' + esc(t.link) + '</textarea></div>' +
      '<div id="tParsed"></div>' +
      '<details class="alt-entry"' + (!t.link && (t.from || t.to) ? ' open' : '') + '><summary>…or type it</summary>' +
      '<div class="field col"><div class="lbl">From</div><input type="text" id="tFrom" placeholder="Your location" value="' + esc(t.from) + '"></div>' +
      '<div class="field col"><div class="lbl">To</div><input type="text" id="tTo" placeholder="City, address or place" value="' + esc(t.to) + '"></div></details>' +
      '<div class="chips" id="tAvoid">' + ['tolls', 'highways', 'ferries'].map(function (k) {
        return '<button data-av="' + k + '" class="' + (t.avoid[k] ? 'on' : '') + '">Avoid ' + k + '</button>'; }).join('') + '</div></div>';

    h += '<div class="card"><h3>2 · Your car</h3>' +
      '<div class="car-sum" id="tCarSum"></div>' +
      '<details class="epa" id="tEpa"><summary>Look up EPA mileage by year / make / model</summary>' +
      '<div class="epa-grid"><select id="eYear"><option value="">Year</option></select><select id="eMake" disabled><option>Make</option></select>' +
      '<select id="eModel" disabled><option>Model</option></select><select id="eOpt" disabled><option>Engine / transmission</option></select></div>' +
      '<div class="epa-msg" id="eMsg"></div></details>' +
      '<div class="grid2">' +
      num('cCity', 'City MPG', c.city, 1) + num('cHwy', 'Highway MPG', c.hwy, 1) + num('cTank', 'Tank size (gal)', c.tank, 0.5) +
      num('cAdj', 'Your MPG vs EPA (%)', c.adjustPct, 5) + '</div>' +
      '<div class="field"><div class="lbl">Fuel grade</div><select id="cGrade">' + Object.keys(P.GRADES).map(function (g) {
        return '<option value="' + g + '"' + (gradeOf() === g ? ' selected' : '') + '>' + P.GRADES[g].label + '</option>'; }).join('') + '</select></div></div>';

    h += '<div class="card"><h3>3 · This trip</h3><div class="grid2">' +
      num('tMiles', 'Miles left in tank now', t.milesLeft, 1, 'from your dash') + num('tBuffer', 'Keep at least (miles)', t.bufferMi, 5, 'never go below') + '</div>' +
      '<div class="seg2" id="tMode"><button data-m="cheap" class="' + (!t.fillUp ? 'on' : '') + '">Cheapest overall</button><button data-m="fill" class="' + (t.fillUp ? 'on' : '') + '">Fill up at each stop</button></div>' +
      '<div class="sub-h">Is a stop or detour worth it?</div>' +
      '<div class="grid2">' + num('tMinSave', 'Only if it saves at least ($)', t.minSave, 0.25, 'per stop or detour') + num('tMaxMin', '…and adds no more than (min)', t.maxDetourMin, 1, 'extra driving per stop') + '</div>' +
      '<details class="alt-entry more"' + (t.timeValue > 0 ? ' open' : '') + '><summary>More options</summary>' +
      '<div class="grid2">' + num('tTime', 'Your time is worth ($/hr)', t.timeValue, 5, 'optional · 0 = off') + '<span class="lead small">Adds a cost for every minute of detour and stop time, on top of the rule above.</span></div></details>' +
      '<div class="sub-h">When you get there</div>' +
      '<div class="seg2" id="tArrive"><button data-a="buffer" class="' + (t.arrive !== 'full' ? 'on' : '') + '">Just keep my buffer</button><button data-a="full" class="' + (t.arrive === 'full' ? 'on' : '') + '">Arrive with the most gas</button></div>' +
      '<div class="lead small" id="tArriveHelp"></div>' +
      '<div class="grid2' + (t.arrive === 'full' ? '' : ' hidden') + '" id="tTopBox">' + num('tTopMi', 'Top-up station within (mi of destination)', t.topUpMi, 0.1, 'for an optional last top-up') + '<span></span></div>' +
      '<div class="grid2">' + num('tTankPrice', 'Gas in your tank cost ($/gal)', t.tankPrice, 0.01, 'blank = typical price on the route') +
      '<label class="nf"><span>Drive back too?<small>same roads, today\'s prices</small></span><span class="chips one"><button id="tRound" class="' + (t.roundTrip ? 'on' : '') + '">Estimate round trip</button></span></label></div>' +
      '<div class="sub-h">Other routes</div>' +
      '<div class="field"><div class="lbl">Check Google\'s other routes too<small>Plans the trip on each other route Google suggests and tells you if one saves enough. Uses Google lookups for each route checked.</small></div>' + sw('tAltCmp', t.altCompare) + '</div>' +
      '<div class="grid2' + (t.altCompare ? '' : ' hidden') + '" id="tAltBox">' + num('tAltSave', 'Worth switching if it saves at least ($)', t.altMinSave, 1, 'for the whole trip') + '<span></span></div></div>';

    h += '<div id="tRouteInfo"></div><button class="btn primary" id="tGo">Get route</button>' +
      '<p class="lead small" id="tCost"></p>' +
      '<p class="lead small"><a href="#" id="tReport">Send a troubleshooting report</a> · <a href="#" id="tLog">Debug log</a></p>';
    pg.innerHTML = h; show(pg, true); pg.scrollTop = 0;

    $('tClose').onclick = closeTrip;
    $('tLink').addEventListener('input', debounce(function () { route = null; model = null; renderInfo(); readLink(); }, 400));
    ['tFrom', 'tTo'].forEach(function (id) { $(id).addEventListener('input', function () { route = null; model = null; renderInfo(); renderStops(); }); });
    $('tAvoid').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      b.classList.toggle('on'); model = null; renderInfo();
    };
    var arriveHelp = function () {
      var full = $('tArrive').querySelector('.on').dataset.a === 'full';
      $('tArriveHelp').textContent = full ? 'Your last stop fills the tank, late in the trip and as cheaply as possible (the “must save” amount drops to $0.25 so a late cheap fill-up isn\'t skipped). You can add a top-up close to the destination afterward.'
        : 'Arrive with at least your buffer; gas left over is counted at the typical price.';
      show($('tTopBox'), full);
    };
    $('tArrive').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call($('tArrive').children, function (x) { x.classList.toggle('on', x === b); });
      arriveHelp();
    };
    $('tRound').onclick = function () { this.classList.toggle('on'); };
    $('tAltCmp').onchange = function () { $('tAltBox').classList.toggle('hidden', !this.checked); collect(); renderInfo(); };
    $('tAltSave').addEventListener('change', function () { collect(); });
    arriveHelp();
    $('tMode').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call($('tMode').children, function (x) { x.classList.toggle('on', x === b); });
    };
    ['cCity', 'cHwy'].forEach(function (id) { $(id).addEventListener('input', function () { S.car.name = ''; S.car.epaFuel = ''; carSum(); }); });
    $('tGo').onclick = go;
    $('tReport').onclick = function (e) { e.preventDefault(); collect(); shareReport(); };
    $('tLog').onclick = function (e) { e.preventDefault(); if (window.__showLog) window.__showLog(); };
    ['tMiles', 'tBuffer', 'cCity', 'cHwy', 'cAdj', 'cTank'].forEach(function (id) {
      $(id).addEventListener('input', debounce(function () { collect(); if (model) { model = T.buildRoute(rawRoute, carModel()); renderInfo(); } }, 300));
    });
    $('tEpa').addEventListener('toggle', function () { if ($('tEpa').open && $('eYear').options.length < 2) epaYears(); });
    carSum(); renderInfo(); costLine();
    if (t.link && !route) readLink();
  }
  function sw(id, on) { return '<label class="switch"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '><span></span></label>'; }
  function num(id, label, v, step, hint) {
    return '<label class="nf"><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span><input type="number" inputmode="decimal" id="' + id + '" step="' + step + '" value="' + esc(v) + '"></label>';
  }
  function debounce(f, ms) { var t; return function () { clearTimeout(t); t = setTimeout(f, ms); }; }
  function carSum() {
    var c = S.car;
    $('tCarSum').innerHTML = c.name ? '<b>' + esc(c.name) + '</b><br><span>EPA ' + c.city + ' city / ' + c.hwy + ' hwy / ' + c.comb + ' combined' +
      (c.epaFuel ? ' · ' + esc(c.epaFuel) : '') + '</span>' : '<span>Enter your MPG below, or look it up from the EPA.</span>';
  }
  function collect() {
    var t = S.trip, c = S.car;
    t.link = $('tLink').value.trim(); t.from = $('tFrom').value.trim(); t.to = $('tTo').value.trim();
    Array.prototype.forEach.call($('tAvoid').children, function (b) { t.avoid[b.dataset.av] = b.classList.contains('on'); });
    t.fillUp = $('tMode').querySelector('.on').dataset.m === 'fill';
    t.arrive = $('tArrive').querySelector('.on').dataset.a;
    t.topUpMi = Math.max(0, Math.round((parseFloat($('tTopMi').value) || 0) * 10) / 10);
    t.roundTrip = $('tRound').classList.contains('on');
    t.altCompare = $('tAltCmp').checked; t.altMinSave = Math.max(0, parseFloat($('tAltSave').value) || 0);
    t.tankPrice = $('tTankPrice').value.trim();
    t.milesLeft = $('tMiles').value; t.bufferMi = Math.max(0, parseFloat($('tBuffer').value) || 0);
    t.minSave = Math.max(0, parseFloat($('tMinSave').value) || 0); t.timeValue = Math.max(0, parseFloat($('tTime').value) || 0);
    var mm = parseFloat($('tMaxMin').value); t.maxDetourMin = mm >= 0 ? mm : 10;
    c.city = parseFloat($('cCity').value) || c.city; c.hwy = parseFloat($('cHwy').value) || c.hwy;
    if (!c.name) c.comb = Math.round(1 / (0.55 / c.city + 0.45 / c.hwy));
    c.tank = parseFloat($('cTank').value) || c.tank; c.adjustPct = parseFloat($('cAdj').value) || 100;
    c.grade = $('cGrade').value;
    A.save();
  }
  function costLine() {
    var used = N.callsThisMonth(), cap = Number(S.monthlyCap) || 0;
    $('tCost').textContent = S.apiKey ? 'Google lookups this month: ' + used + (cap ? ' of ' + cap : '') + ' (Places) · ' + (N.routeCallsThisMonth ? N.routeCallsThisMonth() : 0) + ' routes.'
      : 'Add your Google API key in Settings — routes come from Google.';
  }

  // ---------- reading the link ----------
  async function readLink() {
    var text = $('tLink').value.trim();
    if (!text) { route = null; $('tParsed').innerHTML = ''; return null; }
    var shared = importTrip(text);
    if (shared) { route = shared; LG.info('link', 'Imported a shared Fuel+ trip', { stops: shared.stops.length }); renderStops(); previewCities(route); return route; }
    dbg = { linkText: text.slice(0, 2000), at: new Date().toISOString() };
    var url = T.extractUrl(text);
    LG.info('link', 'Reading link', url);
    if (!url) { $('tParsed').innerHTML = '<div class="msg err">That doesn\'t look like a link.</div>'; return null; }
    if (T.isShortLink(url)) {
      $('tParsed').innerHTML = '<div class="msg">Opening the link…</div>';
      var r = await call('resolveLink', url);
      if (r.error || !r.url) { LG.error('link', 'Short link failed', r.error); dbg.linkError = r.error; $('tParsed').innerHTML = '<div class="msg err">' + esc(r.error || 'Couldn\'t open the link.') + '</div>'; return null; }
      url = r.url;
      LG.debug('link', 'Short link opened to', url);
    }
    dbg.resolvedUrl = url;
    var parsed = T.parseMapsUrl(url);
    dbg.parsed = parsed && JSON.parse(JSON.stringify(parsed));
    LG.debug('link', 'Parsed link', parsed);
    if (!parsed) { $('tParsed').innerHTML = '<div class="msg err">That link isn\'t a Google Maps directions link. Open directions first, then share.</div>'; return null; }
    // Phone share links name stops loosely ("100 Main St") and identify them only by Google's internal place ID.
    // Let Google Maps itself (in a hidden page) turn them into full addresses + exact coordinates and list the routes.
    if (parsed.stops.some(function (st) { return !st.current && st.lat == null; }) || parsed.routeIndex != null) {
      $('tParsed').innerHTML = '<div class="msg">Opening the link in Google Maps to get the exact stops…</div>';
      var g = await openInGoogleMaps(url);
      dbg.googleMapsPage = g;
      LG.debug('link', 'Hidden Google Maps page answered', g);
      if (g && g.href) {
        var exact = T.parseMapsUrl(g.href);
        if (exact && exact.stops.length === parsed.stops.length) {
          // per stop: keep whichever has coordinates, and the fuller address text
          parsed.stops.forEach(function (a, i) {
            var b = exact.stops[i];
            if (a.current || b.current) return;
            if (a.lat == null && b.lat != null) { a.lat = b.lat; a.lng = b.lng; a.fromLink = true; }
            if (b.address && (T.fullAddress(b.address) || !T.fullAddress(a.address))) { a.address = b.address; a.label = b.label; a.short = b.short; }
          });
          if (parsed.routeIndex == null && exact.routeIndex != null) parsed.routeIndex = exact.routeIndex;
          if (!parsed.avoidDetected && exact.avoidDetected) { parsed.avoid = exact.avoid; parsed.avoidDetected = true; }
        }
        if (g.routes && g.routes.length) parsed.mapsRoutes = g.routes;
      } else if (parsed.stops.some(function (st) { return !st.current && st.lat == null; })) {
        parsed.note = 'Couldn\'t open the link in Google Maps' + (g && g.error ? ' (' + g.error + ')' : '') + ', so the addresses are checked by name instead.';
      }
    }
    route = parsed;
    previewCities(parsed);
    if (parsed.avoidDetected) {
      Array.prototype.forEach.call($('tAvoid').children, function (b) { b.classList.toggle('on', !!parsed.avoid[b.dataset.av]); });
    }
    renderStops();
    return parsed;
  }

  // ---------- making sure every stop is the right place ----------
  // ---------- shared trips (import) ----------
  var TRIP_START = '-----FUEL+ TRIP-----', TRIP_END = '-----END FUEL+ TRIP-----';
  function importTrip(text) {
    var a = text.indexOf(TRIP_START), b = text.indexOf(TRIP_END);
    if (a < 0 || b < a) return null;
    try {
      var j = JSON.parse(text.slice(a + TRIP_START.length, b).trim());
      if (!j || !j.stops || j.stops.length < 2) return null;
      var r = { stops: j.stops.map(function (s) { return Object.assign({}, s, { short: s.short || T.shortLabel(s.address || s.label || '') }); }),
        avoid: j.avoid || { tolls: false, highways: false, ferries: false }, avoidDetected: !!j.avoidDetected, mode: 'drive',
        routeIndex: j.routeIndex, mapsRoutes: j.mapsRoutes, note: null, imported: true };
      return r;
    } catch (e) { LG.warn('link', 'Shared trip block unreadable', String(e)); return null; }
  }
  function tripBlock() {
    if (!route) return '';
    var j = { v: 1, stops: route.stops.map(function (s) {
      return s.current ? { current: true, label: 'Your location' } : { address: s.address, label: s.label, lat: s.lat, lng: s.lng, placeId: s.placeId, fromLink: s.fromLink };
    }), avoid: S.trip.avoid, avoidDetected: !!route.avoidDetected, routeIndex: route.routeIndex, mapsRoutes: route.mapsRoutes };
    return TRIP_START + '\n' + JSON.stringify(j) + '\n' + TRIP_END;
  }

  // ---------- cities right after import (free, OpenStreetMap) ----------
  var osmLast = 0;
  async function previewCities(r) {
    if (S.osmPreview === false || !r) return;
    for (var i = 0; i < r.stops.length; i++) {
      var st = r.stops[i];
      if (st.current || st.lat == null || T.fullAddress(st.address) || st.osmPlace) continue;
      var wait = 1100 - (Date.now() - osmLast);              // OpenStreetMap asks for at most 1 lookup per second
      if (wait > 0) await new Promise(function (res) { setTimeout(res, wait); });
      osmLast = Date.now();
      var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=' + st.lat.toFixed(6) + '&lon=' + st.lng.toFixed(6);
      var res = await call('fetchJson', url);
      if (res.error) { LG.warn('osm', 'City lookup failed', res.error); continue; }
      try {
        var a = (JSON.parse(res.body).address) || {};
        var city = a.city || a.town || a.village || a.hamlet || a.municipality || a.county || '';
        var iso = a['ISO3166-2-lvl4'] || '', state = /^US-/.test(iso) ? iso.slice(3) : (a.state || '');
        var tail = [city, [state, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        if (tail) { st.osmPlace = tail; LG.debug('osm', 'City for stop ' + (i + 1), tail); }
      } catch (e) { LG.warn('osm', 'City lookup unreadable', String(e)); }
      if (route === r) renderStops();
    }
  }

  // ---------- sharing ----------
  function money2(v) { return '$' + v.toFixed(2); }
  function shareTrip() {
    var r = result, p = r && r.plan;
    var o = route.stops[0], d = route.stops[route.stops.length - 1];
    var L = ['Fuel+ trip: ' + stopLine(o) + ' → ' + stopLine(d), Math.round(model.totalMi) + ' mi · ' + fmtDur(model.durationSec) + ' · ' + P.GRADES[r.grade].label.toLowerCase()];
    if (p && p.ok) {
      p.stops.forEach(function (s, i) {
        L.push((i + 1) + '. ' + s.c.station.name + ' — ' + (s.c.station.address || '') + ' — mile ' + Math.round(s.c.d) + ' — ' + priceText(s.c.price) + '/gal — buy ' + s.buyGal.toFixed(1) + ' gal (' + money2(s.cost) + ')');
      });
      if (r.top) L.push('Top-up: ' + r.top.c.station.name + ' — ' + priceText(r.top.c.price) + ' — ' + r.top.buyGal.toFixed(1) + ' gal');
      if (r.acc) L.push('Trip cost ' + money2(r.acc.legs[0].cost) + ' · at the pump ' + money2(r.acc.legs[0].spend) + (p.savings > 0.005 ? ' · saves ' + money2(p.savings) + ' vs. easiest stops' : ''));
      if (r.acc && r.acc.legs[1]) L.push('Round trip estimate ' + money2(r.acc.legs[0].cost + r.acc.legs[1].cost));
      var ex = T.exportUrl(route, p.stops.concat(r.top ? [{ c: r.top.c }] : []), model);
      L.push('', 'Open in Google Maps: ' + ex.url);
    }
    L.push('', 'To plan this trip in Fuel+ Map, paste this whole message into the trip link box:', tripBlock());
    N.shareText('Fuel+ trip', L.join('\n'));
    LG.info('share', 'Shared trip summary');
  }
  function report() {
    var safeSettings = JSON.parse(JSON.stringify(S));
    delete safeSettings.apiKey; safeSettings.hasApiKey = !!S.apiKey;
    var r = result;
    var rep = {
      fuelPlusReport: 1, app: N.appVersion ? N.appVersion() : '', time: new Date().toString(), userAgent: navigator.userAgent,
      settings: safeSettings, lookups: { placesThisMonth: N.callsThisMonth(), routesThisMonth: N.routeCallsThisMonth ? N.routeCallsThisMonth() : null },
      link: dbg,
      stops: route && route.stops, routeOptionsFromGoogleMaps: route && route.mapsRoutes, routeIndex: route && route.routeIndex,
      routeRequest: dbg.routeBody, routeOptions: alts.map(function (a, k) { return { k: k, via: a.description, miles: Math.round((a.distanceMeters || 0) / 160.9344) / 10, duration: a.duration, picked: k === altSel }; }),
      route: model ? { miles: Math.round(model.totalMi * 10) / 10, minutes: Math.round(model.durationSec / 60), points: model.pts.length, gallons: Math.round(model.galTo(model.totalMi) * 100) / 100 } : null,
      search: dbg.search,
      candidates: r ? r.cands.map(function (c) {
        return { id: c.id, brand: c.station.brand, name: c.station.name, address: c.station.address, source: c.station.source, mile: Math.round(c.d * 10) / 10,
          offRoute: Math.round(c.offset * 100) / 100, detourMi: Math.round(c.detourMi * 100) / 100, detourMin: Math.round(c.detourMin * 10) / 10, exact: c.detourExact,
          price: c.price, posted: c.calc.base, stale: c.calc.stale };
      }) : null,
      plan: r && r.plan ? { ok: r.plan.ok, reachMi: r.plan.reachMi, tooFar: r.plan.tooFar, refPrice: r.plan.refPrice, totals: r.plan.totals, savings: r.plan.savings,
        stops: (r.plan.stops || []).map(function (s) { return { id: s.c.id, name: s.c.station.name, mile: Math.round(s.c.d * 10) / 10, price: s.c.price, buyGal: s.buyGal, arriveGal: s.arriveGal, departGal: s.departGal, why: s.why }; }),
        notes: r.notes, bufferMi: r.bufMi } : null,
      otherRoutes: r && r.routes ? compareRoutes() : null,
      bufferSweep: r && r.sweep ? r.sweep.map(function (x) { return { mi: x.mi, ok: x.ok, net: x.net && Math.round(x.net * 100) / 100, mark: x.mark, stops: x.ok ? x.plan.stops.map(function (s) { return s.c.station.name + ' @' + Math.round(s.c.d); }) : null }; }) : null,
      log: window.FLog ? FLog.entries().slice(-300) : []
    };
    return JSON.stringify(rep, null, 1);
  }
  function shareReport() {
    var text = report();
    if (text.length > 400000) text = text.slice(0, 400000) + '\n…(trimmed)';
    var where = N.saveDownload ? N.saveDownload('fuelplus-report-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json', 'application/json', text) : '';
    N.shareText('Fuel+ Map troubleshooting report', text);
    if (where && !/^error/.test(where)) toastMsg('Also saved to ' + where);
    LG.info('share', 'Troubleshooting report shared', { chars: text.length, saved: where });
  }
  window.__tripReport = report;

  async function openInGoogleMaps(url) {
    var u = url.replace(/^https?:\/\/(maps\.google\.com|google\.com|www\.google\.com)\/maps\//, 'https://www.google.com/maps/');
    if (!/^https:\/\/www\.google\.com\/maps\/dir\//.test(u)) return null;
    return site('gmaps', { url: u }, 25000);
  }
  function stopLine(s) {
    if (s.current) return 'Your location';
    if (!T.fullAddress(s.address) && s.osmPlace) return (s.address || s.label) + ', ' + s.osmPlace;
    return s.address || s.label;
  }
  function renderStops() {
    var el = $('tParsed'); if (!el) return;
    if (!route) { el.innerHTML = ''; return; }
    var r = route;
    var h = '<ol class="stops">' + r.stops.map(function (s, i) {
      var tag = i === 0 ? 'Start' : i === r.stops.length - 1 ? 'End' : 'Stop';
      var line = '<li><span class="tag">' + tag + '</span><div class="st-a">' + esc(stopLine(s));
      if (s.lat != null || s.current) line += s.placeId || s.fromLink ? ' <span class="ok-mark" title="exact">✓</span>' : '';
      if (s.err) line += '<div class="msg err">' + esc(s.err) + '</div>';
      if (s.choices) {
        line += '<div class="pick"><div class="pick-h">Which one?</div>' + s.choices.map(function (c, k) {
          return '<button data-stop="' + i + '" data-choice="' + k + '">' + esc(c.formattedAddress) + (c.displayName && c.displayName.text && !norm(c.displayName.text).split(' ').every(function (w) { return norm(c.formattedAddress).split(' ').indexOf(w) >= 0; }) ? '<small>' + esc(c.displayName.text) + '</small>' : '') + '</button>';
        }).join('') + '</div>';
      }
      return line + '</div></li>';
    }).join('') + '</ol>';
    if (r.mode && r.mode !== 'drive') h += '<div class="msg err">This link is for ' + esc(r.mode) + ' directions; fuel stops will use driving directions.</div>';
    if (r.avoidDetected) h += '<div class="msg">Route options from your link: ' + (['tolls', 'highways', 'ferries'].filter(function (k) { return r.avoid[k]; }).map(function (k) { return 'avoid ' + k; }).join(', ') || 'none') + '.</div>';
    var picked = pickedRoute(r);
    if (picked) h += '<div class="msg">Route you picked in Google Maps: <b>via ' + esc(picked.via) + '</b>' + (picked.miles ? ' · ' + picked.miles + ' mi' : '') + (picked.minutes ? ' · ' + fmtDur(picked.minutes * 60) : '') + '</div>';
    else if (r.routeIndex) h += '<div class="msg">Your link says you picked route option ' + (r.routeIndex + 1) + ' in Google Maps.</div>';
    if (r.note) h += '<div class="msg err">' + esc(r.note) + '</div>';
    el.innerHTML = h;
    el.querySelectorAll('[data-choice]').forEach(function (b) {
      b.onclick = function () {
        var st = r.stops[+b.dataset.stop], c = st.choices[+b.dataset.choice];
        setPlace(st, c); st.choices = null; model = null; renderStops(); renderInfo();
      };
    });
  }
  function pickedRoute(r) {
    if (!r || !r.mapsRoutes || !r.mapsRoutes.length) return null;
    return r.mapsRoutes[Math.min(r.routeIndex || 0, r.mapsRoutes.length - 1)];
  }
  function words(x) { return norm(String(x || '').replace(/^via\s+/i, '')).split(' ').filter(Boolean); }
  /** Which of Google's route options is the one you picked in Maps: same "via" roads, about the same length. */
  function matchRoute(list, picked) {
    var best = -1, bestScore = -1;
    var pw = words(picked.via);
    list.forEach(function (a, k) {
      var aw = words(a.description), common = pw.filter(function (w) { return aw.indexOf(w) >= 0; }).length;
      var name = pw.length + aw.length ? 2 * common / (pw.length + aw.length) : 0;
      var mi = (a.distanceMeters || 0) / 1609.344;
      var len = picked.miles ? Math.max(0, 1 - Math.abs(mi - picked.miles) / Math.max(1, picked.miles * 0.06)) : 0;
      var sc = name * 2 + len;
      if (sc > bestScore) { bestScore = sc; best = k; }
    });
    return { index: best, sure: bestScore >= 2.2 };
  }
  function setPlace(st, c) {
    st.placeId = c.id; st.address = c.formattedAddress; st.label = c.formattedAddress; st.short = T.shortLabel(c.formattedAddress);
    st.lat = c.location.latitude; st.lng = c.location.longitude; st.err = null;
  }
  function norm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  /** Does Google's top answer clearly match what was written (same ZIP, or same city/state)? */
  function clearMatch(query, results) {
    if (results.length === 1) return true;
    var zip = /\b(\d{5})\b/.exec(query);
    if (zip) { var z = results.filter(function (c) { return c.formattedAddress.indexOf(zip[1]) >= 0; }); return z.length === 1 && z[0] === results[0]; }
    var parts = query.split(',').map(norm).filter(Boolean);
    if (parts.length < 2) return false;                         // "100 Main St" alone is ambiguous
    var tail = parts.slice(1).join(' ');
    var hits = results.filter(function (c) { return norm(c.formattedAddress).indexOf(tail) >= 0 || tail.split(' ').every(function (w) { return norm(c.formattedAddress).split(' ').indexOf(w) >= 0; }); });
    return hits.length === 1 && hits[0] === results[0];
  }
  /** A stop whose exact spot we know but whose name is just a street ("500 Woodlane St"): ask Google for the place
   *  at that spot (tight 300 m circle) to get its full address. The link's coordinates are always kept. */
  async function completeAddress(st) {
    try {
      var res = await call('placesFind', S.apiKey, st.address, st.lat, st.lng, true, 300);
      if (res.error) return;
      var list = (JSON.parse(res.body).places || []).filter(function (c) { return c.location && c.formattedAddress; });
      var best = null, bestD = 0.25;
      list.forEach(function (c) {
        var d = T.hav({ lat: st.lat, lng: st.lng }, { lat: c.location.latitude, lng: c.location.longitude });
        if (d < bestD) { bestD = d; best = c; }
      });
      if (best) {
        var lat = st.lat, lng = st.lng;
        setPlace(st, best); st.lat = lat; st.lng = lng; st.fromLink = true;
        LG.debug('address', 'Full address near the link\'s spot', best.formattedAddress);
      } else LG.warn('address', 'No Google place within 0.25 mi of ' + st.address);
    } catch (e) { /* keep the exact spot; the street name stays as the label */ }
  }
  /** Look up every stop that has only text (typed, or a link without exact coordinates). Returns false if you need to pick. */
  async function resolveStops(r, onProg) {
    var me = A.me(), near = me ? { lat: me.lat, lng: me.lng } : null, need = false;
    for (var i = 0; i < r.stops.length; i++) {
      var st = r.stops[i];
      if (onProg) onProg(i / r.stops.length);
      if (st.current) continue;
      if (st.lat != null) {
        near = { lat: st.lat, lng: st.lng };
        if (!st.placeId && !T.fullAddress(st.address) && st.address) await completeAddress(st);
        continue;
      }
      if (st.choices) { need = true; continue; }
      var res = await call('placesFind', S.apiKey, st.address, near ? near.lat : 0, near ? near.lng : 0, !!near, 50000);
      if (res.error) { st.err = res.error; need = true; continue; }
      var list = (JSON.parse(res.body).places || []).filter(function (c) { return c.location && c.formattedAddress; });
      if (!list.length) { st.err = 'Google couldn\'t find this address. Add the city and state.'; need = true; continue; }
      if (clearMatch(st.address, list)) { setPlace(st, list[0]); near = { lat: st.lat, lng: st.lng }; LG.debug('address', 'Found ' + st.address); }
      else { st.choices = list.slice(0, 5); need = true; LG.info('address', 'Several matches for “' + st.address + '”', list.map(function (c) { return c.formattedAddress; })); }
    }
    renderStops();
    return !need;
  }


  function typedRoute() {
    var from = $('tFrom').value.trim(), to = $('tTo').value.trim();
    if (!to) return null;
    var mk = function (t) { return { address: t, label: t, short: T.shortLabel(t) }; };
    return { stops: [from ? mk(from) : { current: true, label: 'Your location' }, mk(to)], avoid: {}, mode: 'drive' };
  }
  function wp(s) {
    if (s.current) {
      var me = A.me();
      if (!me) throw new Error('Your location isn\'t known yet. Turn on location, or type a starting point.');
      return { location: { latLng: { latitude: me.lat, longitude: me.lng } } };
    }
    // the exact spot from your Google Maps link wins; a place ID is used for stops you typed or picked
    if (s.fromLink && s.lat != null) return { location: { latLng: { latitude: s.lat, longitude: s.lng } } };
    if (s.placeId) return { placeId: s.placeId };
    if (s.lat != null) return { location: { latLng: { latitude: s.lat, longitude: s.lng } } };
    return { address: s.address };
  }

  // ---------- step 1: route ----------
  async function go() {
    if (busy) return;
    collect();
    if (!S.apiKey) { A.openSettings(false); return; }
    if (model) { model = T.buildRoute(rawRoute, carModel()); return findStops(); }
    var milesLeft = parseFloat(S.trip.milesLeft);
    if (!(milesLeft >= 0)) { A.$('tMiles').focus(); toastMsg('Enter how many miles are left in your tank.'); return; }
    busy = true; prog(0.03, 'Reading the link');
    LG.info('route', 'Get route pressed', { miles: S.trip.milesLeft, buffer: S.trip.bufferMi, car: S.car });
    try {
      var r = route || (S.trip.link ? await readLink() : null) || typedRoute();
      if (!r) throw new Error('Paste a Google Maps directions link, or type where you\'re going.');
      route = r;
      prog(0.15, 'Checking addresses');
      if (!(await resolveStops(r, function (f) { prog(0.15 + f * 0.4, 'Checking addresses'); }))) {
        LG.warn('route', 'Waiting for you to pick addresses', r.stops.map(function (x) { return x.address; }));
        busy = false; renderInfo();
        $('tParsed').scrollIntoView({ block: 'center' });
        throw new Error('Pick the right address for each stop marked “Which one?”.');
      }
      prog(0.6, 'Asking Google for the route');
      var avoid = S.trip.avoid;
      var body = {
        origin: wp(r.stops[0]), destination: wp(r.stops[r.stops.length - 1]),
        intermediates: r.stops.slice(1, -1).map(wp), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE',
        polylineQuality: 'HIGH_QUALITY', units: 'IMPERIAL',
        routeModifiers: { avoidTolls: !!avoid.tolls, avoidHighways: !!avoid.highways, avoidFerries: !!avoid.ferries }
      };
      if (body.intermediates.length > 10) throw new Error('Google routes allow up to 10 stops in between.');
      if (!body.intermediates.length) body.computeAlternativeRoutes = true;   // so you can pick the same one as in Google Maps
      dbg.routeBody = body;
      LG.debug('route', 'Routes request', body);
      var res = await call('computeRoute', S.apiKey, JSON.stringify(body));
      if (res.error) { LG.error('route', 'Routes failed', res.error); throw new Error(res.error); }
      prog(0.9, 'Reading the route');
      LG.trace('route', 'Routes answer', res.body);
      var j = JSON.parse(res.body);
      if (!j.routes || !j.routes.length) throw new Error('Google found no driving route for that trip.');
      alts = j.routes;
      var picked = pickedRoute(r);
      altSure = false;
      if (picked && alts.length > 1) { var mt = matchRoute(alts, picked); altSel = mt.index; altSure = mt.sure; }
      else altSel = r.routeIndex != null && r.routeIndex < alts.length ? r.routeIndex : 0;
      rawRoute = alts[altSel];
      model = T.buildRoute(rawRoute, carModel());
      LG.info('route', 'Route ready', { options: alts.map(function (a) { return a.description; }), picked: altSel, sure: altSure, miles: Math.round(model.totalMi) });
    } catch (e) {
      LG.error('route', e.message || String(e));
      toastMsg(e.message || String(e));
    }
    busy = false;
    progEnd();
    renderInfo();
  }
  function carModel() { var c = S.car; return { city: c.city, hwy: c.hwy, comb: c.comb, adjustPct: c.adjustPct }; }
  function official(k) { return (k === 'walmart' || k === 'murphy') && A.siteOn(k); }
  function googleBrands() {
    return Object.keys(P.BRANDS).filter(function (k) { return S.brands[k] && !official(k); });
  }
  function estLookups() {
    if (!model || !S.apiKey) return 0;
    var n = T.chunks(model, 125).length;
    altCompareList().forEach(function (k) { n += Math.max(1, Math.ceil((alts[k].distanceMeters || 0) / 1609.344 / 125)); });
    return n * googleBrands().length;
  }
  function renderInfo() {
    var el = $('tRouteInfo'); if (!el) return;
    if (!model) { el.innerHTML = ''; alts = []; $('tGo').textContent = 'Get route'; return; }
    var startGal = (parseFloat(S.trip.milesLeft) || 0) * model.combGpm;
    var need = model.galTo(model.totalMi), bufGal = S.trip.bufferMi * model.combGpm;
    var spare = (startGal - need) / model.combGpm;
    var est = estLookups(), left = (Number(S.monthlyCap) || 0) - N.callsThisMonth();
    var h = '<div class="card route-card">';
    if (alts.length > 1) {
      var pk = pickedRoute(route);
      h += '<div class="sub-h">' + (pk ? 'You picked via ' + esc(pk.via) + ' in Google Maps' + (altSure ? ' — matched below' : ' — check the closest one below') : 'Which route? Pick the one you chose in Google Maps') + '</div><div class="alts-pick">' + alts.map(function (a, k) {
        var mi = (a.distanceMeters || 0) / 1609.344, sec = parseFloat(String(a.duration || '0'));
        return '<button data-alt="' + k + '" class="' + (k === altSel ? 'on' : '') + '"><b>' + (a.description ? 'via ' + esc(a.description) : 'Route ' + (k + 1)) + '</b>' +
          '<span>' + Math.round(mi) + ' mi · ' + fmtDur(sec) + (k === altSel && pickedRoute(route) ? (altSure ? ' · ✓ same as in Google Maps' : ' · closest to what you picked') : (!pickedRoute(route) && route && route.routeIndex === k ? ' · matches your link' : '')) + '</span></button>';
      }).join('') + '</div>';
    } else if (route && route.routeIndex > 0 && route.stops.length > 2) {
      h += '<div class="msg">You picked another route option in Google Maps, but Google only offers options for trips without stops in between, so this is its main route.</div>';
    }
    h += '<div class="rc-top"><b>' + Math.round(model.totalMi) + ' mi</b> · ' + fmtDur(model.durationSec) +
      ' · about ' + need.toFixed(1) + ' gal</div>';
    if (startGal - need >= bufGal) h += '<div class="msg ok">No stop needed — you\'d arrive with about ' + Math.round(spare) + ' miles left.</div>';
    else {
      var range = Math.max(0, (startGal - bufGal) / model.combGpm);
      h += '<div class="msg">You\'ll need gas within about ' + Math.round(range) + ' miles (keeping your ' + S.trip.bufferMi + '-mile buffer).</div>';
    }
    var nOther = altCompareList().length;
    h += '<div class="lead small">Finding stations uses ' + (est ? 'about ' + est + ' Google lookups' + (nOther ? ' (your route + ' + nOther + ' other' + (nOther === 1 ? '' : 's') + ')' : '') + (S.monthlyCap ? ' (' + Math.max(0, left) + ' left this month)' : '') : 'no Google lookups') +
      (official('walmart') || official('murphy') ? '; Walmart and Murphy prices come from their own sites.' : '.') + '</div></div>';
    el.innerHTML = h;
    el.querySelectorAll('[data-alt]').forEach(function (b) {
      b.onclick = function () { altSel = +b.dataset.alt; rawRoute = alts[altSel]; model = T.buildRoute(rawRoute, carModel()); renderInfo(); };
    });
    $('tGo').textContent = startGal - need >= bufGal ? 'Look for a cheaper fill-up anyway' : 'Find the best stops';
  }
  function toastMsg(m) { if (window.toast) window.toast(m); }

  // ---------- step 2: stations along the route ----------
  /**
   * Stations along one route with your price at each (Google along the route + Walmart's and Murphy's own sites).
   * pg(frac 0..1, label) reports progress; dbgS collects what happened for the troubleshooting report.
   */
  async function gather(model, pg, dbgS) {
    var notes = [], stations = [], official = [];
    // overall progress = weighted parts that run at the same time
    var part = { google: 0, murphy: 0, walmart: 0 }, weight = { google: 0, murphy: 0, walmart: 0 }, label = 'Finding stations';
    var tick = function () {
      var tw = weight.google + weight.murphy + weight.walmart;
      var f = tw ? (part.google * weight.google + part.murphy * weight.murphy + part.walmart * weight.walmart) / tw : 1;
      pg(f, label);
    };
    var progress = function (m) { label = m; tick(); };
    var dbgSearch = dbgS; dbgSearch.started = new Date().toISOString();
    tick();
    var maxOff = 3;
    try {
      var jobs = [];
      if (S.apiKey) {
        var gb = googleBrands();
        T.chunks(model, 125).forEach(function (ch, ci) {
          gb.forEach(function (b) { jobs.push({ q: P.BRANDS[b].query, polyline: ch.polyline, lat: ch.start.lat, lng: ch.start.lng, chunk: ci, fromMi: ch.fromMi, toMi: ch.toMi }); });
        });
      }
      var tasks = [];
      if (jobs.length) weight.google = 0.6;
      if (A.siteOn('murphy')) weight.murphy = 0.15;
      if (A.siteOn('walmart')) weight.walmart = 0.25;
      dbgSearch.googleLookups = jobs.length;
      LG.info('stations', 'Searching along the route', { googleLookups: jobs.length, walmart: A.siteOn('walmart'), murphy: A.siteOn('murphy') });
      if (jobs.length) tasks.push(callP(function (d, t) { part.google = t ? d / t : 0; tick(); }, 'routeSearch', S.apiKey, JSON.stringify(jobs), Number(S.monthlyCap) || 0).then(function (res) {
        part.google = 1; tick();
        dbgSearch.google = { results: (res.results || []).length, errors: res.errors, places: (res.results || []).reduce(function (a, x) { return a + (x.places || []).length; }, 0) };
        LG.info('stations', 'Google along-route search done', dbgSearch.google);
        (res.errors || []).forEach(function (e) { notes.push(e); LG.warn('stations', e); });
        (res.results || []).forEach(function (r) {
          var job = jobs[r.job] || {};
          (r.places || []).forEach(function (pl, k) {
            var st = P.normalize(pl); if (!st || !S.brands[st.brand]) return;
            var sum = r.routingSummaries && r.routingSummaries[k];
            if (sum && sum.legs && sum.legs.length >= 2 && job.toMi != null) {
              // Google's road distance through the station minus the route's own distance for that piece = the detour.
              // (Travel times come from two different Google services, so minutes are derived from miles instead.)
              var mi = (sum.legs[0].distanceMeters + sum.legs[1].distanceMeters) / 1609.344 - (job.toMi - job.fromMi);
              if (mi > -0.5 && mi < 30) { st.detourMi = Math.max(0, mi); st.detourExact = true; }
            }
            stations.push(st);
          });
        });
      }));
      var pts40 = T.samplePoints(model, 40);
      if (A.siteOn('murphy')) tasks.push(site('murphy', { points: T.samplePoints(model, 50), radiusMi: 30, max: 25 }, 90000, function (d, t) { part.murphy = t ? d / t : 0; tick(); }).then(function (res) {
        part.murphy = 1; tick();
        dbgSearch.murphy = { stores: (res.stores || []).length, error: res.error, blocked: res.blocked };
        LG.info('stations', 'Murphy USA done', dbgSearch.murphy);
        if (res.error) notes.push('Murphy USA: ' + (res.blocked ? 'wants an “are you human?” check (Settings → Site checks)' : res.error));
        (res.stores || []).forEach(function (m) { var s = P.normalizeMurphy(m); if (s) official.push(s); });
      }));
      if (A.siteOn('walmart')) tasks.push(site('walmart', { mode: 'nodes', points: pts40, radiusMi: 25 }, 90000, function (d, t) { part.walmart = t ? 0.5 * d / t : 0; tick(); }).then(async function (res) {
        part.walmart = 0.5; tick();
        dbgSearch.walmartNodes = { nodes: (res.nodes || []).length, error: res.error, blocked: res.blocked };
        LG.info('stations', 'Walmart stores along the route', dbgSearch.walmartNodes);
        if (res.error || res.blocked) { part.walmart = 1; tick(); notes.push('Walmart: ' + (res.blocked ? 'wants a “Robot or human?” check (Settings → Site checks)' : res.error)); return; }
        var near = (res.nodes || []).filter(function (n) {
          return n.geoPoint && T.project(model, { lat: n.geoPoint.latitude, lng: n.geoPoint.longitude }).offset <= maxOff;
        });
        if (!near.length) { part.walmart = 1; tick(); return; }
        progress('Reading Walmart prices');
        var pr = await site('walmart', { mode: 'prices', nodes: near }, 90000, function (d, t) { part.walmart = 0.5 + (t ? 0.5 * d / t : 0); tick(); });
        part.walmart = 1; tick();
        dbgSearch.walmartPrices = { asked: near.length, got: (pr.stores || []).length, blocked: pr.blocked, error: pr.error };
        LG.info('stations', 'Walmart prices', dbgSearch.walmartPrices);
        if (pr.blocked) notes.push('Walmart: wants a “Robot or human?” check for some prices (Settings → Site checks)');
        (pr.stores || []).forEach(function (w) { var s = P.normalizeWalmart(w); if (s) official.push(s); });
      }));
      await Promise.all(tasks);
    } catch (e) { notes.push(String(e && e.message || e)); LG.error('stations', String(e && e.message || e)); }


    var merged = P.mergeOfficial(dedupe(stations), official);
    var grade = gradeOf(), cands = [], unpriced = 0, stale = 0;
    merged.forEach(function (s) {
      var pr = T.project(model, { lat: s.lat, lng: s.lng });
      if (pr.offset > maxOff) return;
      var c = P.compute(s, grade, S, new Date());
      if (!c) { unpriced++; return; }
      if (c.stale) stale++;
      var est = 2 * pr.offset * 1.3 + (pr.offset > 0.15 ? 0.2 : 0);
      // trust Google's detour unless it's wildly off from the straight-line estimate (then the piece was routed differently)
      var exact = s.detourExact && s.detourMi <= est * 3 + 2;
      var det = exact ? s.detourMi : est;
      var detMin = det < 0.15 ? 0 : det / 25 * 60 + 1;   // side roads ~25 mph, plus getting off and back on
      cands.push({ id: s.id, d: pr.along, offset: pr.offset, detourMi: det, detourMin: detMin, detourExact: exact,
        price: c.final, calc: c, station: s, lat: s.lat, lng: s.lng });
    });
    return { cands: cands, notes: notes, unpriced: unpriced, stale: stale, grade: grade };
  }
  // ---------- other routes ----------
  function altCompareList() {
    if (!S.trip.altCompare || alts.length < 2) return [];
    var out = []; alts.forEach(function (a, k) { if (k !== altSel) out.push(k); }); return out.slice(0, 2);
  }
  function routeNet(e) {
    var p = e.res.plan; if (!p.ok) return null;
    return p.totals.net + (S.trip.timeValue || 0) * routeMin(e) / 60;
  }
  function routeMin(e) { var p = e.res.plan; return e.model.durationSec / 60 + (p.ok ? p.totals.detourMin + p.stops.length * 8 : 0); }
  /** How each other checked route compares to the one you're on (same gas price for leftover gas, same rules). */
  function compareRoutes() {
    var list = result.routes || [], cur = list.filter(function (e) { return e.k === altSel; })[0];
    if (!cur) return [];
    var nc = routeNet(cur);
    return list.filter(function (e) { return e !== cur; }).map(function (e) {
      var no = routeNet(e), a = alts[e.k];
      var c = { k: e.k, via: a.description || 'route ' + (e.k + 1), ok: e.res.plan.ok, error: e.error,
        extraMi: e.model.totalMi - cur.model.totalMi, extraMin: routeMin(e) - routeMin(cur), stops: e.res.plan.ok ? e.res.plan.stops.length : 0 };
      c.saves = no != null && nc != null ? nc - no : null;
      c.worth = !c.error && c.ok && (nc == null || c.saves >= (S.trip.altMinSave || 0));
      return c;
    }).sort(function (x, y) { return (y.saves || -1e9) - (x.saves || -1e9); });
  }
  function switchRoute(k) {
    var list = result.routes, e = list.filter(function (x) { return x.k === k; })[0];
    if (!e || e.error) return;
    LG.info('routes', 'Switched to via ' + (alts[k].description || k));
    altSel = k; rawRoute = alts[k]; model = e.model; result = e.res; result.routes = list;
    recompute(); startSweep(); showResult();
  }
  function routeBox() {
    var cs = compareRoutes(); if (!cs.length) return '';
    var h = '', best = cs.filter(function (c) { return c.worth; })[0];
    var dmi = function (v) { return Math.abs(v) < 0.5 ? 'same distance' : Math.round(Math.abs(v)) + ' mi ' + (v > 0 ? 'longer' : 'shorter'); };
    var dmin = function (v) { return Math.abs(v) < 1 ? 'about the same time' : Math.round(Math.abs(v)) + ' min ' + (v > 0 ? 'longer' : 'shorter'); };
    if (best) {
      h += '<div class="routebox good"><div class="tb-h">Cheaper route: via ' + esc(best.via) + '</div>' +
        '<div class="lead small">' + (best.saves != null ? 'Saves about <b>' + money(best.saves) + '</b>' : 'Works with your buffer when this one doesn\'t') + ' · ' + dmi(best.extraMi) + ' · ' + dmin(best.extraMin) +
        ' · ' + best.stops + ' stop' + (best.stops === 1 ? '' : 's') + (S.trip.timeValue > 0 ? ' (your time counted)' : '') + '.</div>' +
        '<button class="btn tonal" data-route="' + best.k + '">Switch to this route</button></div>';
    }
    var rest = cs.filter(function (c) { return c !== best; });
    if (rest.length) h += '<div class="lead small">Also checked: ' + rest.map(function (c) {
      if (c.error) return 'via ' + esc(c.via) + ' (couldn\'t check: ' + esc(c.error) + ')';
      if (!c.ok) return 'via ' + esc(c.via) + ' (no plan keeps your buffer)';
      return 'via ' + esc(c.via) + ' — ' + (c.saves > 0.005 ? 'saves only ' + money(c.saves) + ' (your bar is ' + money(S.trip.altMinSave) + ')' : money(-c.saves) + ' more') + ', ' + dmin(c.extraMin) +
        ' · <a href="#" data-route="' + c.k + '">use this route</a>';
    }).join('; ') + '.</div>';
    return h;
  }

  // ---------- buffer slider ----------
  function startSweep() {
    var r = result;
    if (r.sweep || r.sweeping || !r.opts.refPrice) return;
    r.sweeping = true;
    var top = Math.min(100, Math.max(60, Math.ceil(S.trip.bufferMi * 1.5 / 5) * 5)), list = [];
    for (var b = 5; b <= top; b += 5) list.push(b);
    [S.trip.bufferMi, r.bufMi].forEach(function (v) { if (v >= 0 && list.indexOf(v) < 0) list.push(v); });
    list.sort(function (a, b2) { return a - b2; });
    var rows = [], i = 0, t0 = Date.now();
    (function next() {
      if (result !== r) { r.sweeping = false; return; }
      var end = Date.now() + 40;
      while (i < list.length && Date.now() < end) rows.push(T.bufferSweep(r.opts, [list[i++]], r.opts.refPrice)[0]);
      if (i < list.length) return setTimeout(next, 0);
      r.sweep = T.marks(rows); r.sweeping = false;
      LG.debug('plan', 'Buffer sweep in ' + (Date.now() - t0) + ' ms', rows.map(function (x) { return x.mi + ':' + (x.net == null ? '-' : x.net.toFixed(2)) + (x.mark ? '*' : ''); }).join(' '));
      if (result === r && $('tsBufBox')) { var el = $('tsBufBox'); el.outerHTML = bufBox(); bindBuf(); }
    })();
  }
  function swRow(mi) {
    var sw = result.sweep, best = null;
    sw.forEach(function (x) { if (!best || Math.abs(x.mi - mi) < Math.abs(best.mi - mi)) best = x; });
    return best;
  }
  function bufBox() {
    var r = result, sw = r.sweep;
    var h = '<div class="bufbox" id="tsBufBox"><div class="tb-h">Buffer for this trip</div>';
    if (!sw) return h + '<div class="lead small">Checking what other buffers would cost…</div></div>';
    var min = sw[0].mi, max = sw[sw.length - 1].mi, cur = swRow(r.bufMi);
    h += '<div class="buf-read"><b id="tsBufVal">' + r.bufMi + ' mi</b> <span id="tsBufCost">' + bufText(cur, cur) + '</span></div>';
    h += '<div class="buf-track"><div class="buf-marks">' + sw.filter(function (x) { return x.mark; }).map(function (x) {
      var d = cur.ok ? cur.net - x.net : null;
      return '<span class="bm" style="left:' + ((x.mi - min) / (max - min) * 100).toFixed(2) + '%"><i></i>' + (d != null && d >= 0.05 ? '−' + money(d) : x.mi) + '</span>';
    }).join('') + sw.filter(function (x) { return !x.ok; }).slice(0, 1).map(function (x) {
      return '<span class="bno" style="left:' + ((x.mi - min) / (max - min) * 100).toFixed(2) + '%"></span>';
    }).join('') + '</div><input type="range" id="tsBuf" min="' + min + '" max="' + max + '" step="1" value="' + r.bufMi + '"></div>';
    h += '<div class="buf-scale"><span>' + min + ' mi</span><span>' + max + ' mi</span></div>';
    var lower = sw.filter(function (x) { return x.mark && x.mi < r.bufMi && cur.ok && cur.net - x.net >= 0.05; });
    var hint = lower.length ? lower[lower.length - 1] : null;
    if (!cur.ok) {
      var okRows = sw.filter(function (x) { return x.ok; });
      h += '<div class="lead small">' + (okRows.length ? 'The highest buffer that works on this trip is ' + okRows[okRows.length - 1].mi + ' mi.' : 'No buffer works — check the miles left.') + '</div>';
    } else if (hint) {
      var hs = hint.plan.stops.filter(function (s) { return !cur.plan.stops.some(function (c) { return c.c.id === s.c.id; }); })[0];
      h += '<div class="lead small">Marks show where a smaller buffer saves money. Down to ' + hint.mi + ' mi saves ' + money(cur.net - hint.net) +
        (hs ? ' — it can reach ' + esc(hs.c.station.name) + ' at mile ' + Math.round(hs.c.d) + ' (' + priceText(hs.c.price) + ')' : '') + '.</div>';
    } else h += '<div class="lead small">A smaller buffer wouldn\'t save anything on this trip.</div>';
    if (r.bufMi !== S.trip.bufferMi) h += '<div class="lead small">For this trip only — your usual buffer is ' + S.trip.bufferMi + ' mi. <a href="#" id="tsBufKeep">Make ' + r.bufMi + ' mi my usual buffer</a></div>';
    return h + '</div>';
  }
  function bufText(x, cur) {
    if (!x.ok) return 'can\'t keep this much — no priced station in reach';
    var dip = x.plan.firstDip ? ' · dips below it before the first stop' : '';
    if (x === cur || !cur.ok) return x.plan.stops.length + ' stop' + (x.plan.stops.length === 1 ? '' : 's') + dip;
    var d = x.net - cur.net;
    return (Math.abs(d) < 0.05 ? 'same cost' : d < 0 ? 'saves ' + money(-d) : money(d) + ' more') + ' · ' + x.plan.stops.length + ' stop' + (x.plan.stops.length === 1 ? '' : 's') + dip;
  }
  function bindBuf() {
    var inp = $('tsBuf'); if (!inp) return;
    var r = result, cur = swRow(r.bufMi);
    inp.oninput = function () { var x = swRow(+inp.value); $('tsBufVal').textContent = x.mi + ' mi'; $('tsBufCost').textContent = bufText(x, cur); };
    inp.onchange = function () {
      var x = swRow(+inp.value);
      if (x.mi === r.bufMi) { inp.value = x.mi; return; }
      LG.info('plan', 'Buffer slider: ' + r.bufMi + ' → ' + x.mi + ' mi', { ok: x.ok, net: x.net });
      if (!x.ok) { inp.value = r.bufMi; $('tsBufVal').textContent = r.bufMi + ' mi'; $('tsBufCost').textContent = bufText(cur, cur); toastMsg('No plan can keep ' + x.mi + ' mi on this trip.'); return; }
      N.haptic && N.haptic();
      r.plan = x.plan; r.opts = x.opts; r.bufMi = x.mi; r.topSel = -1;
      recompute(); keepScroll(showResult);
    };
    if ($('tsBufKeep')) $('tsBufKeep').onclick = function (e) { e.preventDefault(); S.trip.bufferMi = r.bufMi; A.save(); keepScroll(showResult); };
  }

  function makeOpts(model, cands, startGal) {
    return { model: model, cands: cands, startGal: startGal, capGal: S.car.tank, bufferGal: S.trip.bufferMi * model.combGpm,
      arriveGal: S.trip.bufferMi * model.combGpm, fillUp: S.trip.fillUp,
      // arriving with the most gas: a late, cheap fill-up is the point, so the "must save" bar drops to $0.25
      stopPenalty: S.trip.arrive === 'full' ? Math.min(S.trip.minSave, 0.25) : S.trip.minSave,
      detourPenalty: S.trip.arrive === 'full' ? Math.min(S.trip.minSave, 0.25) : S.trip.minSave,
      maxDetourMin: S.trip.maxDetourMin, timeValue: S.trip.timeValue, stopMinutes: 8,
      lastFull: S.trip.arrive === 'full' };
  }
  async function findStops() {
    busy = true;
    var go = $('tGo');
    var others = altCompareList();
    var share = others.length ? 0.9 / (others.length + 1) : 0.9;
    dbg.search = {};
    var g = await gather(model, function (f, l) { prog(0.02 + f * share, l + (others.length ? ' (your route)' : '')); }, dbg.search);
    var cands = g.cands, notes = g.notes, unpriced = g.unpriced, stale = g.stale, grade = g.grade;
    var label = 'Choosing stops'; prog(0.02 + share, label);
    var startGal = (parseFloat(S.trip.milesLeft) || 0) * model.combGpm;
    var opts = makeOpts(model, cands, startGal);
    var t0 = Date.now();
    var plan = T.plan(opts);
    LG.info('plan', plan.ok ? 'Planned ' + plan.stops.length + ' stop(s) in ' + (Date.now() - t0) + ' ms' : 'No workable plan', {
      candidates: cands.length, unpriced: unpriced, stale: stale, tooFar: plan.tooFar, reachMi: plan.reachMi,
      stops: plan.ok ? plan.stops.map(function (s) { return { name: s.c.station.name, mile: Math.round(s.c.d), price: s.c.price, buy: Math.round(s.buyGal * 10) / 10, why: s.why }; }) : null });
    LG.debug('plan', 'Candidates', cands.map(function (c) { return [c.station.name, Math.round(c.d), c.price, Math.round(c.detourMi * 10) / 10]; }));
    result = { plan: plan, opts: opts, cands: cands, notes: notes, unpriced: unpriced, stale: stale, grade: grade, startGal: startGal,
      topMi: S.trip.topUpMi, topSel: -1, bufMi: S.trip.bufferMi };
    recompute();
    // other routes Google suggested: same trip, same rules, gas valued at the same price so totals compare fairly
    if (others.length) {
      result.routes = [{ k: altSel, model: model, res: result }];
      for (var oi = 0; oi < others.length; oi++) {
        var k = others[oi], base = 0.02 + share * (oi + 1), via = alts[k].description || 'route ' + (k + 1);
        try {
          var m2 = T.buildRoute(alts[k], carModel());
          dbg['search_route' + k] = {};
          var g2 = await gather(m2, function (f, l) { prog(base + f * share, l + ' (via ' + via + ')'); }, dbg['search_route' + k]);
          var o2 = makeOpts(m2, g2.cands, startGal);
          if (plan.ok) o2.refPrice = plan.refPrice;
          var p2 = T.plan(o2);
          result.routes.push({ k: k, model: m2, res: { plan: p2, opts: o2, cands: g2.cands, notes: g2.notes, unpriced: g2.unpriced, stale: g2.stale, grade: g2.grade,
            startGal: startGal, topMi: S.trip.topUpMi, topSel: -1, bufMi: S.trip.bufferMi } });
        } catch (e) { LG.error('routes', 'Checking via ' + via + ' failed', String(e && e.message || e)); result.routes.push({ k: k, model: model, res: { plan: { ok: false } }, error: String(e && e.message || e) }); }
      }
      LG.info('routes', 'Other routes checked', compareRoutes().map(function (c) { return { via: c.via, saves: c.saves && Math.round(c.saves * 100) / 100, extraMin: Math.round(c.extraMin), ok: c.ok, worth: c.worth }; }));
    }
    startSweep();
    busy = false;
    prog(1, 'Done'); progEnd();
    go.textContent = 'Find the best stops';
    closePage();
    showResult();
  }
  /** Top-ups, trip cost, and the drive back — cheap to redo when you change the top-up choice. */
  function recompute() {
    var r = result, p = r.plan, o = r.opts;
    r.tops = p.ok && S.trip.arrive === 'full' ? T.topUps(Object.assign({}, o, { cands: p.cands }), p, r.topMi).slice(0, 4) : [];
    if (r.topSel >= r.tops.length) r.topSel = -1;
    var top = r.topSel >= 0 ? r.tops[r.topSel] : null;
    r.top = top;
    if (!p.ok) { r.acc = null; r.back = null; return; }
    var outLeg = { stops: p.stops.map(function (s) { return { arriveGal: s.arriveGal, buyGal: s.buyGal, price: s.c.price }; }), arriveGal: p.arriveGal };
    if (top) { outLeg.stops.push({ arriveGal: top.arriveGal, buyGal: top.buyGal, price: top.c.price }); outLeg.arriveGal = top.endGal; }
    var legs = [outLeg];
    r.back = null;
    if (S.trip.roundTrip) {
      var rm = T.reverseModel(model);
      var bo = Object.assign({}, o, { model: rm, cands: T.mirror(r.cands, model.totalMi), startGal: outLeg.arriveGal, lastFull: false, refPrice: 0, stopPenalty: S.trip.minSave, detourPenalty: S.trip.minSave });   // typical price, recomputed for the drive back
      var bp = T.plan(bo);
      bp.stops && bp.stops.forEach(function (s) { s.c = Object.assign({}, s.c); });
      r.back = { plan: bp, model: rm, startGal: outLeg.arriveGal };
      if (bp.ok) legs.push({ stops: bp.stops.map(function (s) { return { arriveGal: s.arriveGal, buyGal: s.buyGal, price: s.c.price }; }), arriveGal: bp.arriveGal });
    }
    var tp = parseFloat(S.trip.tankPrice);
    r.startPrice = tp > 0 ? tp : p.refPrice;
    r.acc = T.account(r.startGal, r.startPrice, legs);
  }
  function dedupe(list) { var seen = {}; return list.filter(function (s) { if (seen[s.id]) return false; seen[s.id] = 1; return true; }); }

  // ---------- results ----------
  function showResult() {
    document.body.classList.add('trip-on');
    drawRoute();
    var r = result, p = r.plan, el = $('tripSheet');
    var g = P.GRADES[r.grade].label.toLowerCase();
    var dest = route.stops[route.stops.length - 1], orig = route.stops[0];
    var h = '<div class="grab"><span></span></div><div class="t-head"><div><div class="t-title">' + esc(orig.current ? 'Your location' : (orig.short || orig.label)) + ' → ' + esc(dest.short || dest.label) + '</div>' +
      '<div class="sub">' + Math.round(model.totalMi) + ' mi · ' + fmtDur(model.durationSec) + ' · ' + g + ' · ' + r.cands.length + ' priced stations along the way</div></div>' +
      '<button class="x" id="tsClose" aria-label="Close trip">✕</button></div>';

    if (!p.ok) {
      h += '<div class="msg err">No plan keeps you above a ' + r.bufMi + '-mile buffer. ' +
        (p.reachMi > 0 ? 'Past mile ' + Math.round(p.reachMi) + ' there\'s no priced station close enough.' : 'There\'s no priced station within your current range.') +
        ' Try a smaller buffer, check the miles left, or turn on more brands.</div>';
      h += routeBox() + bufBox();
    } else {
      var t = p.totals, out = r.acc.legs[0];
      h += '<div class="kpis"><div><b>' + money(out.cost) + '</b><span>trip cost</span></div>' +
        '<div><b>' + money(out.spend) + '</b><span>at the pump · ' + out.bought.toFixed(1) + ' gal</span></div>' +
        '<div><b class="' + (p.savings > 0.005 ? 'good' : '') + '">' + (p.savings != null && p.savings > 0.005 ? money(p.savings) : '—') + '</b><span>saved vs. easiest</span></div></div>';
      h += routeBox();
      h += '<div class="lead small">Trip cost is the ' + out.burnGal.toFixed(1) + ' gal this drive burns: gas already in your tank at ' + priceText(r.startPrice) + '/gal' +
        (S.trip.tankPrice ? ' (what you said it cost)' : ' (typical on this route — set what you paid in Edit trip)') + ', plus what you buy at what you pay. ' +
        (t.stops ? t.stops + ' stop' + (t.stops === 1 ? '' : 's') + '.' : 'No stops.') + '</div>';
      h += '<div class="lead small">Your rule: a stop or detour has to save at least ' + money(S.trip.arrive === 'full' ? Math.min(S.trip.minSave, 0.25) : S.trip.minSave) +
        ' and add no more than ' + S.trip.maxDetourMin + ' min of driving' + (S.trip.timeValue > 0 ? '; your time counts at $' + S.trip.timeValue + '/hr' : '') + '.</div>';
      if (p.easy && p.savings > 0.005) {
        h += '<div class="lead small">Easiest plan (fewest stops, closest to the road, fill up): ' + p.easy.stops.map(function (s) { return esc(P.BRANDS[s.c.station.brand].name) + ' at mile ' + Math.round(s.c.d) + ' (' + priceText(s.c.price) + ')'; }).join(', ') +
          ' — ' + money(p.easy.totals.net) + ' net. This plan: ' + money(t.net) + ' net' + (t.detourMin - p.easy.totals.detourMin > 0.5 ? ', ' + Math.round(t.detourMin - p.easy.totals.detourMin) + ' more min of detours' : '') + '.</div>';
      } else if (p.easy && t.stops) h += '<div class="lead small">The easiest stops are also the cheapest here.</div>';
      if (p.minStops != null && t.stops > p.minStops) h += '<div class="lead small">You only need ' + p.minStops + ' stop' + (p.minStops === 1 ? '' : 's') + '; the extra one pays for itself with cheaper gas.</div>';
      if (p.firstDip && p.stops.length) h += '<div class="msg">You can\'t keep a ' + r.bufMi + '-mile buffer on the way to the first stop — you\'ll get there with about ' + Math.round(p.stops[0].arriveGal / model.combGpm) + ' miles left. Stop 1 is the closest workable station.</div>';
      if (!t.stops) h += '<div class="msg ok">No stop is worth it — you\'ll arrive with about ' + Math.round(p.arriveMi) + ' miles left.</div>';
      p.stops.forEach(function (s, i) { h += stopCard(s, i); });
      if (t.stops) h += '<div class="lead small">Arrive with about ' + Math.round(p.arriveMi) + ' miles left' + (S.trip.arrive === 'full' ? ' (' + Math.round(p.arriveGal / S.car.tank * 100) + '% of the tank)' : '') +
        '. When choosing stops, gas left at the end is counted at ' + priceText(p.refPrice) + '/gal, the typical price along this route.</div>';
      h += bufBox();
      if (S.trip.arrive === 'full') h += topUpBox();
      if (r.back) h += backBox();
    }
    var notes = r.notes.slice();
    if (r.stale) notes.push(r.stale + ' station' + (r.stale === 1 ? ' has a price' : 's have prices') + ' older than ' + S.staleHours + ' hours (marked).');
    if (p.tooFar) notes.push(p.tooFar + ' station' + (p.tooFar === 1 ? ' was' : 's were') + ' skipped for being more than ' + S.trip.maxDetourMin + ' min out of the way.');
    if (r.unpriced) notes.push(r.unpriced + ' brand station' + (r.unpriced === 1 ? '' : 's') + ' along the way had no ' + g + ' price and were skipped.');
    notes.forEach(function (n) { h += '<div class="note">' + esc(n) + '</div>'; });
    var ex = p.ok ? T.exportUrl(route, p.stops.concat(r.top ? [{ c: r.top.c }] : []), model) : null;
    h += '<div class="actions">' + (ex ? '<button class="btn primary" id="tsExport"><svg viewBox="0 0 24 24"><path d="M21.71 11.29l-9-9a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42l9 9a1 1 0 0 0 1.42 0l9-9a1 1 0 0 0 0-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>Open in Google Maps' + (p.stops.length ? ' with stops' : '') + '</button>' : '') +
      '<div class="btn-row"><button class="btn tonal" id="tsShare">Share trip</button><button class="btn tonal" id="tsReport">Troubleshooting report</button></div>' +
      '<div class="btn-row"><button class="btn tonal" id="tsEdit">Edit trip</button><button class="btn tonal" id="tsDone">Done</button></div></div>';
    if (ex && altSel > 0 && !p.stops.length && !r.top) h += '<div class="note">Google Maps may open on its usual route; pick the “via ' + esc(alts[altSel].description || 'other road') + '” option there.</div>';
    else if (ex && route.routeIndex != null && altSel !== route.routeIndex && alts[altSel]) h += '<div class="note">This isn\'t the route you picked in Google Maps. Maps picks its own roads between stops — check that it goes via ' + esc(alts[altSel].description || 'this route') + '.</div>';
    if (ex && ex.tooMany) h += '<div class="note">Google Maps takes up to 9 stops in a shared route; this trip has ' + ex.waypoints + '. Remove a stop in Maps if it complains.</div>';
    if (route.avoidDetected || S.trip.avoid.tolls || S.trip.avoid.highways || S.trip.avoid.ferries) h += '<div class="note">Google Maps links can\'t carry “avoid” options — turn them back on in Maps (Route options).</div>';
    el.innerHTML = h; show(el, true); el.scrollTop = 0;
    $('tsClose').onclick = $('tsDone').onclick = endTrip;
    $('tsEdit').onclick = function () { show(el, false); openTrip(); };
    $('tsShare').onclick = shareTrip;
    $('tsReport').onclick = shareReport;
    if (ex) $('tsExport').onclick = function () { N.haptic(); N.openUrl(ex.url); };
    el.querySelectorAll('[data-top]').forEach(function (b) {
      b.onclick = function () { var k = +b.dataset.top; r.topSel = r.topSel === k ? -1 : k; recompute(); keepScroll(showResult); };
    });
    if ($('tsTopMi')) $('tsTopMi').addEventListener('change', function () {
      r.topMi = Math.max(0, Math.round((parseFloat(this.value) || 0) * 10) / 10); S.trip.topUpMi = r.topMi; A.save(); r.topSel = -1; recompute(); keepScroll(showResult);
    });
    el.querySelectorAll('[data-nav]').forEach(function (b) {
      b.onclick = function () { var s = b.dataset.nav === 'top' ? r.top.c : p.stops[+b.dataset.nav].c; N.navigate(s.lat, s.lng, /^(wm|mu|demo)-/.test(s.id) ? '' : s.id, s.station.name); };
    });
    el.querySelectorAll('[data-why]').forEach(function (b) {
      b.onclick = function () { var box = $('why' + b.dataset.why); box.classList.toggle('hidden'); };
    });
    el.querySelectorAll('[data-route]').forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); N.haptic && N.haptic(); switchRoute(+b.dataset.route); };
    });
    bindBuf();
    el.querySelectorAll('[data-fly]').forEach(function (b) {
      b.onclick = function () { var s = p.stops[+b.dataset.fly].c; map.setView([s.lat, s.lng], 14); };
    });
  }
  function priceText(v) { return '$' + P.fmt3(v); }
  function keepScroll(f) { var el = $('tripSheet'), y = el.scrollTop; f(); el.scrollTop = y; }
  function topUpBox() {
    var r = result, last = r.plan.stops[r.plan.stops.length - 1];
    var h = '<div class="topbox"><div class="tb-h">Top up near ' + esc(route.stops[route.stops.length - 1].label) + '?</div>' +
      '<div class="tb-row">Stations within <input type="number" id="tsTopMi" step="0.1" min="0" inputmode="decimal" value="' + r.topMi.toFixed(1) + '"> mi of the destination</div>';
    if (!r.tops.length) {
      h += '<div class="lead small">No priced station that close' + (last ? ' after your last stop' : '') + '. Try a bigger distance.</div></div>';
      return h;
    }
    r.tops.forEach(function (t, k) {
      var br = P.BRANDS[t.c.station.brand], on = r.topSel === k;
      h += '<div class="top-opt' + (on ? ' on' : '') + '"><span class="dot" style="background:' + br.color + '"></span><div class="mid"><b>' + esc(t.c.station.name) + '</b> · ' + priceText(t.c.price) +
        (last ? ' <span class="' + (t.extraPerGal > 0 ? 'bad' : 'good') + '">(' + (t.extraPerGal >= 0 ? '+' : '−') + '$' + P.fmt3(Math.abs(t.extraPerGal)) + '/gal vs. stop ' + r.plan.stops.length + ')</span>' : '') +
        '<div class="sub">' + t.toDestMi.toFixed(1) + ' mi from the destination · +' + t.buyGal.toFixed(1) + ' gal for ' + money(t.cost) + ' → arrive with ~' + Math.round(t.endMi) + ' mi</div></div>' +
        '<button data-top="' + k + '">' + (on ? 'Added ✓' : 'Add') + '</button></div>';
    });
    if (r.top) h += '<div class="s-act"><button data-nav="top">Navigate to the top-up</button></div>';
    return h + '</div>';
  }
  function backBox() {
    var r = result, b = r.back, bp = b.plan, acc = r.acc;
    var h = '<div class="topbox"><div class="tb-h">Round trip estimate</div>';
    if (!bp.ok) {
      return h + '<div class="lead small">Couldn\'t plan the drive back on these roads with your buffer (starting with ~' + Math.round(b.startGal / model.combGpm) + ' mi of gas).</div></div>';
    }
    var there = acc.legs[0], back = acc.legs[1];
    h += '<div class="kpis two"><div><b>' + money(there.cost + back.cost) + '</b><span>round trip cost</span></div><div><b>' + money(there.spend + back.spend) + '</b><span>at the pump both ways</span></div></div>';
    h += '<div class="lead small">There ' + money(there.cost) + ' + back ' + money(back.cost) + '. The drive back starts with what\'s left when you arrive (~' + Math.round(b.startGal / model.combGpm) + ' mi)' +
      (bp.stops.length ? ' and stops at ' + bp.stops.map(function (s) {
        return esc(P.BRANDS[s.c.station.brand].name) + ' ' + Math.round(s.c.d) + ' mi into the drive back (' + s.buyGal.toFixed(1) + ' gal, ' + priceText(s.c.price) + ')'; }).join(', ')
        : ' — no stop needed') + '. Home with ~' + Math.round(bp.arriveMi) + ' mi left. Same roads in reverse at today\'s prices; plan it for real before you head back.</div>';
    return h + '</div>';
  }
  function stopCard(s, i) {
    var c = s.c, st = c.station, br = P.BRANDS[st.brand];
    var h = '<div class="stop"><div class="s-top" data-fly="' + i + '"><span class="num">' + (i + 1) + '</span><span class="badge" style="background:' + br.color + '">' + br.short + '</span>' +
      '<div class="mid"><div class="nm">' + esc(st.name) + '</div><div class="sub">Mile ' + Math.round(c.d) + ' · about ' + fmtDur(s.etaSec) + ' in · arrive with ~' + Math.round(s.arriveMi) + ' mi left</div></div>' +
      '<div class="pr"><div class="f">' + priceHtml(c.price) + '</div><div class="o">' + (c.calc.stale ? '<span class="stale">stale</span>' : 'your price') + '</div></div></div>';
    h += '<div class="s-buy">Buy <b>' + s.buyGal.toFixed(1) + ' gal</b>' + (S.trip.fillUp ? ' (fill up)' : s.departGal >= S.car.tank - 0.05 ? ' (fill up — cheapest gas on this route)' : ' (just enough to reach the next good price)') + ' · <b>' + money(s.cost) + '</b> · ' +
      (c.detourMi < 0.15 ? 'right on the route' : 'detour +' + c.detourMi.toFixed(1) + ' mi / +' + Math.max(1, Math.round(c.detourMin)) + ' min' + (c.detourExact ? '' : ' (est.)')) + '</div>';
    if (s.why) h += '<div class="why-not"><b>Why not the cheaper one?</b> ' + esc(s.why) + '</div>';
    if (s.alts.length) {
      h += '<div class="alts">' + s.alts.map(function (a) {
        var ab = P.BRANDS[a.c.station.brand];
        return '<div><span class="dot" style="background:' + ab.color + '"></span>' + esc(ab.name) + ' at mile ' + Math.round(a.c.d) + ', ' + priceText(a.c.price) +
          (a.c.detourMi < 0.15 ? ' on route' : ', ' + a.c.detourMi.toFixed(1) + ' mi off') + ' → <b class="' + (a.extra > 0 ? 'bad' : 'good') + '">' + (a.extra >= 0 ? '+' : '') + money(a.extra) + '</b></div>';
      }).join('') + '</div>';
    }
    h += '<div class="why hidden" id="why' + i + '">' + c.calc.steps.map(function (x) {
      return '<div class="ln"><span>' + esc(x.label) + '</span><span>' + (x.kind === 'base' ? priceText(x.amount) : x.amount === 0 ? 'included' : '−$' + P.fmt3(-x.amount)) + '</span></div>'; }).join('') +
      '<div class="ln tot"><span>You pay per gallon</span><span>' + priceText(c.price) + '</span></div></div>';
    h += '<div class="s-act"><button data-why="' + i + '">How this price</button><button data-nav="' + i + '">Navigate here</button></div></div>';
    return h;
  }

  function drawRoute() {
    layer.clearLayers();
    if (!map.hasLayer(layer)) layer.addTo(map);
    var ll = model.pts.map(function (p) { return [p.lat, p.lng]; });
    L.polyline(ll, { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(ll, { color: '#1a73e8', weight: 5, opacity: 0.95, interactive: false }).addTo(layer);
    var mk = function (p, cls, html) { return L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pin', html: '<div class="' + cls + '">' + html + '</div>', iconSize: null }), keyboard: false }); };
    mk(model.pts[0], 'tend', 'A').addTo(layer);
    mk(model.pts[model.pts.length - 1], 'tend', 'B').addTo(layer);
    if (result) {
      var chosen = {};
      if (result.plan.ok) result.plan.stops.forEach(function (s, i) { chosen[s.c.id] = i + 1; });
      result.cands.forEach(function (c) {
        if (chosen[c.id]) return;
        mk(c, 'tdot" style="--bc:' + P.BRANDS[c.station.brand].color, '').setZIndexOffset(-100)
          .bindPopup('<b>' + esc(c.station.name) + '</b><br>' + priceText(c.price) + ' · mile ' + Math.round(c.d) +
            (c.detourMi >= 0.15 ? ' · ' + c.detourMi.toFixed(1) + ' mi detour' : '')).addTo(layer);
      });
      if (result.top) chosen[result.top.c.id] = 'T';
      result.cands.forEach(function (c) {
        if (!chosen[c.id]) return;
        mk(c, 'pin-in best tstop" style="--bc:#0a5c32', '<span class="b">' + chosen[c.id] + '</span>' + priceHtml(c.price)).setZIndexOffset(1000).addTo(layer);
      });
    }
    var b = L.latLngBounds(ll);
    var sheetH = Math.min(window.innerHeight * 0.55, 420);
    map.fitBounds(b, { paddingTopLeft: [24, 110], paddingBottomRight: [24, sheetH + 20] });
  }

  // ---------- open / close ----------
  function closePage() { show($('trip'), false); }
  function closeTrip() { collect(); closePage(); if (!result) document.body.classList.remove('trip-on'); }
  function endTrip() {
    show($('tripSheet'), false); layer.clearLayers(); map.removeLayer(layer);
    document.body.classList.remove('trip-on'); result = null; A.render();
  }
  window.__tripBack = function () {
    if (!$('trip').classList.contains('hidden')) { closeTrip(); if (result) show($('tripSheet'), true); return true; }
    if (!$('tripSheet').classList.contains('hidden')) { endTrip(); return true; }
    return false;
  };
  $('btnTrip').onclick = function () { N.haptic(); show($('tripSheet'), false); openTrip(); };

  // Google Maps -> Share directions -> Fuel+ Map
  window.onSharedText = function (text) {
    S.trip.link = text; A.save(); route = null; model = null; result = null;
    show($('tripSheet'), false); openTrip();
  };
  if (window.__pendingShare) { var t0 = window.__pendingShare; window.__pendingShare = null; window.onSharedText(t0); }

  // ---------- EPA (fueleconomy.gov) ----------
  var EPA = 'https://www.fueleconomy.gov/ws/rest/vehicle/';
  function items(body) { try { var j = JSON.parse(body); var m = j && j.menuItem; return !m ? [] : Array.isArray(m) ? m : [m]; } catch (e) { return []; } }
  async function epaGet(path) { var r = await call('fetchJson', EPA + path); if (r.error) throw new Error(r.error); return r.body; }
  function fill(sel, list, ph) {
    sel.innerHTML = '<option value="">' + ph + '</option>' + list.map(function (x) { return '<option value="' + esc(x.value) + '">' + esc(x.text) + '</option>'; }).join('');
    sel.disabled = !list.length;
  }
  function eMsg(m, err) { var el = $('eMsg'); if (el) { el.textContent = m || ''; el.classList.toggle('err', !!err); } }
  async function epaYears() {
    try {
      eMsg('Loading…');
      fill($('eYear'), items(await epaGet('menu/year')), 'Year'); eMsg('');
      $('eYear').onchange = async function () {
        var y = this.value; fill($('eMake'), [], 'Make'); fill($('eModel'), [], 'Model'); fill($('eOpt'), [], 'Engine / transmission'); if (!y) return;
        fill($('eMake'), items(await epaGet('menu/make?year=' + encodeURIComponent(y))), 'Make');
      };
      $('eMake').onchange = async function () {
        var y = $('eYear').value, mk = this.value; fill($('eModel'), [], 'Model'); fill($('eOpt'), [], 'Engine / transmission'); if (!mk) return;
        fill($('eModel'), items(await epaGet('menu/model?year=' + encodeURIComponent(y) + '&make=' + encodeURIComponent(mk))), 'Model');
      };
      $('eModel').onchange = async function () {
        var y = $('eYear').value, mk = $('eMake').value, md = this.value; fill($('eOpt'), [], 'Engine / transmission'); if (!md) return;
        var opts = items(await epaGet('menu/options?year=' + encodeURIComponent(y) + '&make=' + encodeURIComponent(mk) + '&model=' + encodeURIComponent(md)));
        fill($('eOpt'), opts, 'Engine / transmission');
        if (opts.length === 1) { $('eOpt').value = opts[0].value; $('eOpt').onchange(); }
      };
      $('eOpt').onchange = async function () {
        var id = $('eOpt').value; if (!id) return;
        eMsg('Loading…');
        var v = JSON.parse(await epaGet(encodeURIComponent(id)));
        var city = +v.city08, hwy = +v.highway08, comb = +v.comb08;
        if (!(city > 0 && hwy > 0)) { eMsg('The EPA has no gas mileage for that one (electric?).', true); return; }
        var fuel = String(v.fuelType1 || v.fuelType || '');
        var grade = /premium/i.test(fuel) ? 'premium' : /midgrade/i.test(fuel) ? 'midgrade' : /diesel/i.test(fuel) ? 'diesel' : 'regular';
        S.car.name = [v.year, v.make, v.model].join(' ') + ($('eOpt').selectedOptions[0] ? ' · ' + $('eOpt').selectedOptions[0].text : '');
        S.car.city = city; S.car.hwy = hwy; S.car.comb = comb || Math.round(1 / (0.55 / city + 0.45 / hwy)); S.car.epaFuel = fuel; S.car.grade = grade;
        $('cCity').value = city; $('cHwy').value = hwy; $('cGrade').value = grade;
        A.save(); carSum(); eMsg('Set from the EPA. Enter your tank size below — the EPA doesn\'t list it.');
        model = null; renderInfo();
      };
    } catch (e) { eMsg('Couldn\'t reach fueleconomy.gov: ' + e.message + '. You can type your MPG instead.', true); }
  }

  window.__trip = { open: openTrip, state: function () { return { route: route, model: model, result: result }; } };
})();
