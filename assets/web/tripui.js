/* Gasket — trip planner screens. Import a Google Maps route, find priced stations along it,
 * pick the stops that actually save money, and send the route (with stops) back to Google Maps. */
(function () {
  'use strict';
  var A = window.__app, T = window.Trip, P = A.P, S = A.S, N = A.N, map = A.map, $ = A.$;
  var esc = A.esc, priceHtml = A.priceHtml;

  // ---------- persistent inputs ----------
  S.trip = Object.assign({ link: '', from: '', to: '', milesLeft: '', bufferMi: 40, fillUp: false, minSave: 1, timeValue: 0,
    arrive: 'buffer', topUpMi: 1.0, returnTrip: false, linkSliders: true, slowMode: 'all', maxUnder: 5, tankPrice: '', maxDetourMin: 10, altCompare: false, altMinSave: 5,
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
  var replay = null;     // a trip opened from history: {id, t, stations} — its saved stations are used instead of new lookups
  var loadingTrip = false;   // a saved trip is being opened (its route is read just after the panel is up)

  /** Progress inside the Next button: frac 0..1 and what it's doing. */
  var lastProg = { pct: 0, label: '' };
  function prog(frac, label) {
    var pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
    lastProg = { pct: pct, label: label };
    var b = $(routing ? 'tGetRoutes' : 'tNext'); if (!b) return;
    b.classList.add('busy');
    b.innerHTML = '<span class="pfill" style="width:' + pct + '%"></span><span class="plab">' + esc(label) + ' · ' + pct + '%</span>';
    if (mapLd && mapLd.live) mapLd.set(frac, label);
    // and the bars inside the placeholder tiles (Adjustments, Stops) say the same
    document.querySelectorAll('.prog-load').forEach(function (el) {
      var i = el.querySelector('i'), p = el.querySelector('.pct'), l = el.querySelector('.pl');
      if (i) i.style.width = pct + '%'; if (p) p.textContent = pct + '%'; if (l) l.textContent = label;
    });
  }
  /**
   * While stops are worked out, Adjustments and Stops show their usual tiles right away, each with a loading bar
   * inside saying what it's waiting on, instead of a blank screen that fills in later.
   */
  function progBar(label) {   // starts where the work already is (prog() keeps it moving)
    var pct = busy ? lastProg.pct : 0, l = busy && lastProg.label ? lastProg.label : label;
    return '<div class="parse-load prog-load"><span class="pl">' + esc(l) + '</span><span class="pbar"><i style="width:' + pct + '%"></i></span><span class="pct">' + pct + '%</span></div>';
  }
  function skelCard(title, body) { return '<div class="card skel"><div class="sk-h">' + esc(title) + '</div>' + (body || '') + '</div>'; }
  function skelRows(n) { var h = ''; for (var i = 0; i < n; i++) h += '<div class="sk-row"><span class="sk-dot"></span><span class="sk-lines"><span></span><span></span></span><span class="sk-price"></span></div>'; return h; }
  function skelStops(label) {
    return skelCard(KIND() === 'ev' ? 'Charging stops' : 'Fuel stops', progBar(label) + skelRows(2)) +
      '<div class="gas-tiles skel-tiles">' + skelCard(KIND() === 'ev' ? 'Charge to leave with' : 'Gas to leave with', '<div class="sk-big"></div>') +
      skelCard(KIND() === 'ev' ? 'Charge when you arrive' : 'Gas when you arrive', '<div class="sk-big"></div>') + '</div>';
  }
  function skelAdjust(label) {
    return tipBox() + skelCard('Buffer for this trip', progBar(label) + '<div class="sk-slider"></div>') +
      skelCard('Max. detour per stop', '<div class="sk-slider"></div>') + skelCard('Cruising speed', '<div class="sk-slider"></div>');
  }
  function progEnd() { var b = $('tNext'); if (b) { b.classList.remove('busy'); b.textContent = 'Next'; b._sub = null; } routeGate(); if (typeof backMode === 'function') backMode(); }
  /** Let the screen draw (a progress bar, a tapped button) before a stretch of heavy work. */
  function paint() { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); }
  // the big map, grayed out with a progress bar while the route and stops are drawn (shows only past 0.75 s)
  var mapLd = null;
  function mapLoading(label, frac) {
    if (!mapLd || !mapLd.live) mapLd = A.loader(document.body, label, { fixed: true });
    mapLd.el.style.top = '0'; mapLd.el.style.bottom = Math.round(sheetCover()) + 'px';
    mapLd.set(frac == null ? null : frac, label);
  }
  function mapLoaded() { if (mapLd) { mapLd.done(); mapLd = null; } }
  var routing = false, freshRoutes = false;
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function fmtDur(sec) { var m = Math.round(sec / 60), h = Math.floor(m / 60); return h ? h + ' h ' + (m % 60) + ' min' : m + ' min'; }
  function money(v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2); }
  function gradeOf() { return window.Garage ? Garage.grade() : (S.grade || 'regular'); }
  // units of the car you're planning with: gal, kWh (EV) or kg (hydrogen)
  function UN() { return window.Garage && Garage.unit ? Garage.unit() : 'gal'; }
  function KIND() { return window.Garage && Garage.kind ? Garage.kind() : 'gas'; }
  function FW() { return { gas: 'Gas', ev: 'Charge', h2: 'Hydrogen' }[KIND()]; }
  function gradeLabel(g) { return P.GRADES[g] ? P.GRADES[g].label : g === 'electric' ? 'Electric' : g === 'hydrogen' ? 'Hydrogen' : String(g || ''); }

  // ---------- the trip planner: Garage → Route → Stops → Departure ----------
  // One panel over the map, in four steps, with Back / Next pinned at the bottom. Next checks the step's required
  // fields first and points at the first one missing (red outline for a box, a pulse for something to pick).
  var STEPS = ['Garage', 'Advisory', 'Route', 'Parameters', 'Adjustments', 'Stops', 'Departure'], step = 1;
  var ST_GARAGE = 1, ST_ADVISORY = 2, ST_ROUTE = 3, ST_PARAMS = 4, ST_ADJ = 5, ST_STOPS = 6, ST_DEPART = 7;
  /** Adjustments and Stops both show the plan (and the map). */
  function onPlan(k) { return k === ST_ADJ || k === ST_STOPS; }
  function tpBody() { return $('tpBody'); }
  function openTrip(st) {
    A.closeDetail();
    if (st) step = st;
    document.body.classList.add('trip-on'); A.syncMain(); A.syncMapGAttr();
    if (window.Advisory) Advisory.init(call);
    renderStep();
  }
  function initPanel(pg) {
    pg.className = 'page tpanel hidden';
    pg.innerHTML = '<div class="tp-grab" id="tpGrab"><span></span></div>' +
      '<div class="tp-head"><div class="tp-steps" id="tpSteps"></div><button class="x" id="tClose" aria-label="Close">✕</button></div>' +
      '<div class="tp-body" id="tpBody"></div><div class="tp-nav" id="tpNav"></div>';
    $('tClose').onclick = closeTrip;
    A.scrollHint(tpBody());
    $('tpSteps').onclick = function (e) {
      var b = e.target.closest('[data-step]'); if (!b) return;
      var k = +b.dataset.step; if (k === step) return;
      if (k < step) { collectSafe(); step = k; renderStep(); } else advance(k);
    };
    panelDrag(pg);
  }
  // Each step stays in the page once built (hidden while you're on another), so moving between steps is instant.
  // Garage and Route are only rebuilt for a new trip; Stops when the route or plan changed; Departure every time (cheap).
  var built = {}, scrolls = {}, shown = 0;
  function stepEl(k) {
    var e = $('tpS' + k);
    if (!e) { e = document.createElement('div'); e.id = 'tpS' + k; e.className = 'tp-step hidden'; tpBody().appendChild(e); }
    return e;
  }
  /** Forget the built steps (a new or reopened trip). */
  function resetSteps() {
    STEPS.forEach(function (n, i) { var e = $('tpS' + (i + 1)); if (e) e.remove(); });
    built = {}; scrolls = {}; shown = 0;
  }
  function renderStep() {
    freshModel();
    if (window.__apiCount) window.__apiCount();
    var pg = $('trip');
    if (!pg.classList.contains('tpanel')) initPanel(pg);
    show(pg, true);
    var full = step < ST_ADJ;   // nothing to see on the map yet: Garage, Route and Parameters take the whole screen
    // coming down to the map: the list starts at 75% of the screen (drag it anywhere from there) — straight away, not
    // as a slide a busy screen could freeze halfway
    if (!full && (!shown || shown < ST_ADJ)) pg.style.setProperty('--panel-h', '75vh');
    if (step !== ST_DEPART && preDepartH != null) { if (!full && shown === ST_DEPART) pg.style.setProperty('--panel-h', preDepartH); preDepartH = null; }   // back from Departure: your height again
    if (!full && (pg.classList.contains('full') || !shown)) {
      pg.classList.add('snap'); requestAnimationFrame(function () { requestAnimationFrame(function () { pg.classList.remove('snap'); }); });
    }
    pg.classList.toggle('full', full); document.body.classList.toggle('trip-full', full);
    if (!full && (loadingTrip || (model && !(map.hasLayer(layer) && drawn.model === model)))) mapLoading(loadingTrip ? 'Opening your trip' : 'Drawing the route');
    if (full) mapLoaded();
    $('tpSteps').innerHTML = STEPS.map(function (n, i) {
      var k = i + 1, sh = { Advisory: 'Advice', Parameters: 'Params', Adjustments: 'Adjust', Departure: 'Depart' }[n] || n;
      var attn = k === ST_ADVISORY && window.Advisory && Advisory.attention() > 0;   // something worth a look
      return '<button data-step="' + k + '" class="' + (k === step ? 'on' : k < step ? 'done' : '') + (k > reach() ? ' dim' : '') + (attn ? ' attn' : '') + '"><b>' + k + '</b><span class="lf">' + n + '</span><span class="ls">' + sh + '</span></button>';
    }).join('');
    navRender();
    var b = tpBody();
    if (shown) { scrolls[shown] = b.scrollTop; var old = $('tpS' + shown); if (old) old.classList.add('hidden'); }
    var e = stepEl(step), c = built[step];
    var fresh = !c || step === ST_DEPART || (onPlan(step) && (c.model !== model || c.result !== result));
    e.classList.remove('hidden'); shown = step;
    if (fresh) {
      e.innerHTML = stepHtml(step);
      built[step] = { model: model, result: result };
      bindStep(step);
      b.scrollTop = 0;
    } else {
      b.scrollTop = scrolls[step] || 0;
      if (step === ST_ROUTE) refitOptionMaps();
      if (step === ST_ADVISORY && window.Advisory && Advisory.wake) Advisory.wake();   // a car switch while it was hidden
    }
    // the big map: drawn after this frame paints, and only when its route or stops changed
    var k0 = step;
    roadSelSoon();
    requestAnimationFrame(function () { setTimeout(function () {
      if (step !== k0) return;
      if (model && step >= ST_ADJ) { drawRoute(); if (!userMoved) fitRoute(false); }
      fitBtn(); sheetSize();
      if (step === ST_DEPART) fitDepart();
      if (model && step >= ST_ADJ && !busy) mapLoaded();
    }, 0); });
  }
  /** Departure: the panel only as tall as its content, and the whole route centered above it again. */
  var preDepartH = null;
  function fitDepart() {
    var pg = $('trip'), body = tpBody(), e = $('tpS' + ST_DEPART); if (!pg || !e || !body || pg.classList.contains('full')) return;
    var cs = getComputedStyle(body), pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var need = pg.getBoundingClientRect().height - body.clientHeight + e.offsetHeight + pad + 4;
    var h = Math.max(innerHeight * 0.25, Math.min(need, innerHeight * 0.94));
    if (preDepartH == null) preDepartH = pg.style.getPropertyValue('--panel-h') || '75vh';
    pg.style.setProperty('--panel-h', (h / innerHeight * 100).toFixed(2) + 'vh');
    userMoved = false;
    setTimeout(function () { if (step !== ST_DEPART) return; fitRoute(true); fitBtn(); placePinsSoon(); }, 260);
  }
  function refitOptionMaps() {
    Object.keys(rmaps).forEach(function (k) { var m = rmaps[k]; if (m._refit && document.body.contains(m.getContainer())) { m.invalidateSize(false); m._refit(); } });
  }
  function navRender() {
    var nav = $('tpNav');
    if (loadingTrip) {   // a saved trip opening: say so where Next will be, and nothing else can be pressed yet
      nav.innerHTML = '<span></span><button class="btn primary opening" disabled>Opening your trip<span class="ob-bar"><i></i></span></button>';
      gateTabs(); return;
    }
    nav.innerHTML = (step > 1 ? '<button class="btn tonal" id="tBack">Back</button>' : '<span></span>') +
      (step < ST_DEPART ? '<button class="btn primary" id="tNext">Next</button>' : '<button class="btn primary" id="tOpen">' + MAPS_ICON + 'Open in Google Maps</button>');
    if ($('tBack')) $('tBack').onclick = function () { if (speedMode()) { discardSpeedMode(); return; } closeLegs(); collectSafe(); step--; renderStep(); };
    if ($('tNext')) $('tNext').onclick = function () { if (speedMode()) { leaveSpeedMode(); return; } advance(step + 1); };   // Save and continue: keep the speeds, back to the stops
    if ($('tOpen')) $('tOpen').onclick = openMaps;
    routeGate(); backMode();
  }
  /** Go forward to step `to`, one step at a time, stopping at the first requirement that isn't met. */
  var jumpTo = 0;   // a step tab pressed while a saved trip was opening: gone to once it's open
  async function advance(to) {
    if (busy) { if (loadingTrip) jumpTo = to; return; }
    collectSafe(); freshModel();
    while (step < to) {
      var ok = await ready(step);
      if (!ok) { LG.info('trip', 'Stopped at ' + STEPS[step - 1] + ' on the way to ' + STEPS[to - 1]); return; }
      step++;
      renderStep();
    }
  }
  /** Is this step done? If not, point at the first thing missing (top to bottom) and say what's needed. */
  async function ready(k) {
    if (k === ST_GARAGE) {
      var g = Garage.need && Garage.need();
      if (g) { flag(g.el, g.kind, g.msg); return false; }
      return true;
    }
    if (k === ST_ADVISORY) {
      // a spare to air up: tick it in Advisory first (it stays ticked for 30 days, saved trips included)
      if (window.Tires && Tires.spareDue && Tires.spareDue(Garage.car())) { flag(document.querySelector('#advTires .adv-chk') || $('advTires'), 'pick', 'Check your spare\'s air, then tick it.'); return false; }
      // recirculate's downsides: acknowledged once
      if (window.Climate && Climate.ackDue()) { flag(document.querySelector('#advClimate .adv-chk') || $('advClimate'), 'pick', 'Read about recirculate, then tick it.'); return false; }
      return true;
    }
    if (k === ST_ROUTE) {
      if (srcOf() === 'link') { if (!S.trip.link) { flag($('tLink'), 'box', 'Paste a Google Maps directions link.'); return false; } }
      else {
        if (!S.trip.from) { flag($('tFrom'), 'box', 'Where are you starting?'); return false; }
        if (!S.trip.to) { flag($('tTo'), 'box', 'Where are you going?'); return false; }
      }
      var pick = document.querySelector('#tParsed .pick button');
      if (pick) { flag(document.querySelector('#tParsed .pick'), 'pick', 'Pick the right address.'); return false; }
      if (!model) { flag($('tGetRoutes'), 'pick'); return false; }   // the flashing button says it
      return true;
    }
    if (k === ST_PARAMS) {
      if (FuelGauge.math.empty(fuel(), Garage.tank(), Garage.carModel().comb)) { flag($('tEmpty') || $('tFuel'), 'pick', KIND() === 'ev' ? 'Charge enough to reach a station first.' : 'Put in enough gas to reach a station first.'); return false; }
      if (!hasFuel()) { flag($('tMiles') || $('tFuelPct') || $('tGauge'), 'box', KIND() === 'ev' ? 'How charged is your battery?' : 'How much gas do you have?'); return false; }
      return true;
    }
    if (onPlan(k)) {
      if (!result) { await findStops(); if (!result) return false; }
      if (!result.plan.ok) { flag($('tsBufBox') || $('tsResults'), 'pick', 'No plan works with this buffer — try a smaller one.'); return false; }
      return true;
    }
    return true;
  }
  /**
   * Routes come from one button under "Leaving": until they're in, Next and the later steps are grayed out. After,
   * it becomes "Refresh routes" (asks Google again — for a saved trip, whose routes are reused as they were).
   */
  function routeGate() {
    var el = $('tRouteGo');
    if (el && !(routing && $('tGetRoutes'))) {
      el.innerHTML = model ? '<div class="rt-ready"><span class="okc">✓</span><span>' + (multiLeg(route) ? 'Routes ready' : alts.length > 1 ? alts.length + ' routes ready' : 'Route ready') +
        (route && route.reused ? '<small class="rt-saved">from your saved trip · no lookups</small>' : '') + '</span><button type="button" class="btn tonal sm" id="tRefreshRoutes">Refresh routes</button></div>'
        : '<button type="button" class="btn primary" id="tGetRoutes">Get routes</button>';
      if ($('tGetRoutes')) $('tGetRoutes').onclick = getRoutes;
      if ($('tRefreshRoutes')) $('tRefreshRoutes').onclick = refreshRoutes;
    }
    var n = $('tNext'); if (n) n.classList.toggle('dim', step === ST_ROUTE && !model);
    gateTabs();
  }
  /** The last step you can go straight to: every step before it is done (what Next checks, without pointing at
   * anything). While a saved trip opens, only the Garage. */
  function reach() {
    if (loadingTrip) return ST_GARAGE;
    if (window.Garage && Garage.ok && !Garage.ok()) return ST_GARAGE;
    if (window.Tires && Tires.spareDue && Tires.spareDue(Garage.car())) return ST_ADVISORY;
    if (window.Climate && Climate.ackDue()) return ST_ADVISORY;
    if (!model || document.querySelector('#tParsed .pick button')) return ST_ROUTE;
    if (!hasFuel()) return ST_PARAMS;
    return ST_DEPART;
  }
  window.addEventListener('advisorychange', function () { gateTabs(); }); window.addEventListener('garagechange', function () { gateTabs(); });
  /** Step tabs past what you can reach are grayed out (pressing one still goes as far as it can and points at what's missing). */
  function gateTabs() {
    var r = reach();
    document.querySelectorAll('#tpSteps [data-step]').forEach(function (b) { b.classList.toggle('dim', +b.dataset.step > r); });
  }
  /**
   * Routes are fetched by themselves whenever the Route step has a link or both addresses and every stop is settled.
   * Changing avoid tolls / highways / ferries or round trip brings the Get routes button back (until the link or the
   * addresses change). The first start after a restore never looks anything up by itself.
   */
  var autoRoute = !A.justRestored;
  function autoRoutes() {
    if (!autoRoute || model || busy || step !== ST_ROUTE || !S.apiKey) return;
    collectSafe();
    if (srcOf() === 'link' ? !(route && S.trip.link) || parsing : !(S.trip.from && S.trip.to)) return;
    if (document.querySelector('#tParsed .pick button')) return;
    getRoutes();
  }
  async function getRoutes() {
    if (busy) return;
    collectSafe();
    if (srcOf() === 'link') { if (!S.trip.link) { flag($('tLink'), 'box', 'Paste a Google Maps directions link.'); return; } }
    else {
      if (!S.trip.from) { flag($('tFrom'), 'box', 'Where are you starting?'); return; }
      if (!S.trip.to) { flag($('tTo'), 'box', 'Where are you going?'); return; }
    }
    var pick = document.querySelector('#tParsed .pick button');
    if (pick) { flag(document.querySelector('#tParsed .pick'), 'pick', 'Pick the right address.'); return; }
    await go();
    if (!model) { var p2 = document.querySelector('#tParsed .pick'); if (p2) flag(p2, 'pick', 'Pick the right address.'); return; }
    var rp = $('tRouteInfo'); if (rp && (alts.length > 1 || multiLeg(route))) rp.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function refreshRoutes() {
    if (busy || !route) return;
    LG.info('route', 'Refreshing every route from Google');
    route.legs = null; alts = []; altSel = 0; model = null; rawRoute = null; result = null; replay = null; freshRoutes = true;
    renderInfo(); layer.clearLayers(); drawn = {};
    getRoutes();
  }
  /** Show the user what's missing: red outline on a box, a soft pulse on something to pick. */
  function flag(el, kind, msg) {   // msg: what's missing, for the log; the outline or pulse says it on screen (no popup)
    if (msg) LG.info('trip', 'Needs: ' + msg);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (kind === 'box') {
      var box = el.closest('.in-q, .in-btn') || el;
      el.classList.add('need'); box.classList.add('need');
      var clear = function () { el.classList.remove('need'); box.classList.remove('need'); el.removeEventListener('input', clear); };
      el.addEventListener('input', clear);
      setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e) { } }, 350);
    } else {
      el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
      setTimeout(function () { el.classList.remove('pulse'); }, 1900);
    }
  }
  function stepHtml(k) {
    var t = S.trip;
    if (k === ST_GARAGE) return '<div id="tGarage"></div>';
    if (k === ST_ADVISORY) return '<div id="tAdvisory"></div>';
    if (k === ST_ROUTE) {
      var src = srcOf();
      return '<div class="card">' +
      '<div class="seg2" id="tSrc"><button data-src="link" class="' + (src === 'link' ? 'on' : '') + '">Maps link</button><button data-src="typed" class="' + (src === 'typed' ? 'on' : '') + '">Addresses</button></div>' +
      '<div id="tSrcLink"' + (src === 'link' ? '' : ' class="hidden"') + '><div class="field col"><div class="lbl">Google Maps directions link<span class="req" aria-label="required">*</span><small>In Google Maps: get directions → ⋮ → <b>Share directions</b> → Gasket. Or paste the link here.</small></div>' +
      '<textarea id="tLink" rows="2" placeholder="https://maps.app.goo.gl/…" spellcheck="false">' + esc(t.link) + '</textarea></div></div>' +
      '<div id="tSrcTyped"' + (src === 'typed' ? '' : ' class="hidden"') + '>' +
      '<div class="field col"><div class="lbl">From<span class="req" aria-label="required">*</span></div><span class="in-btn"><input type="text" id="tFrom" placeholder="Address or place" value="' + esc(t.from) + '"><button type="button" id="tHere" aria-label="Use my location"><svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg></button></span></div>' +
      '<div class="field col"><div class="lbl">To<span class="req" aria-label="required">*</span></div><input type="text" id="tTo" placeholder="Address or place" value="' + esc(t.to) + '"></div></div>' +
      '<div id="tParsed"></div>' +
      '<div class="chips" id="tAvoid">' + ['tolls', 'highways', 'ferries'].map(function (k) {
        return '<button data-av="' + k + '" class="' + (t.avoid[k] ? 'on' : '') + '">Avoid ' + k + '</button>'; }).join('') + '</div>' +
      '<div class="field"><div class="lbl">Round trip<small>Comes back to the start. The way back is its own leg, so you pick its roads too.</small></div>' + sw('tRound', !!t.returnTrip) + '</div>' +
        '<div class="field col"><div class="lbl">Leaving<small>Discounts that only apply on certain days (like Club CITGO\'s Tuesday and Friday bonuses) are counted for the day you\'ll reach each station. Blank = now. Prices can change before you go.</small></div>' +
        '<div class="dt-row"><input type="datetime-local" id="tDepart" value="' + esc(futureDepart() ? S.trip.depart : '') + '"><button type="button" class="btn tonal sm" id="tNow">Now</button></div></div>' +
        '<div id="tRouteGo"></div></div>' +
        '<div id="tRouteInfo"></div>';
    }
    if (k === ST_PARAMS) {
      var kd = KIND();
      return '<div class="card"><h3>' + (kd === 'ev' ? 'How charged is it?' : 'How much gas do you have?') + '</h3><div id="tFuel"></div><div id="tEmpty"></div>' +
        '<div class="grid2">' + num('tBuffer', 'Buffer (miles)', t.bufferMi, 5, 'never go below') +
        num('tTankPrice', kd === 'ev' ? 'What\'s in the battery cost ($/kWh)' : kd === 'h2' ? 'Your tank\'s hydrogen ($/kg)' : 'Your tank\'s gas ($/gal)', t.tankPrice, 0.01, kd === 'ev' ? 'e.g. home charging · blank = your fast-charging price' : 'blank = typical price on the route') + '</div></div>' +
        '<div class="card"><h3>' + (kd === 'ev' ? 'Charging stops' : 'Fuel stops') + '</h3>' +
      '<div class="seg2" id="tMode"><button data-m="cheap" class="' + (!t.fillUp ? 'on' : '') + '">Cheapest overall</button><button data-m="fill" class="' + (t.fillUp ? 'on' : '') + '">' + (kd === 'ev' ? 'Charge to 80% each stop' : 'Fill up at each stop') + '</button></div>' +
      '<div class="sub-h">Is a stop or detour worth it?</div>' +
      '<div class="grid2">' + num('tMinSave', 'Min. savings ($)', t.minSave, 0.25, 'per stop or detour') + num('tMaxMin', 'Max. extra time (min)', t.maxDetourMin, 1, 'extra driving per stop') + '</div>' +
      '<details class="alt-entry more"' + (t.timeValue > 0 ? ' open' : '') + '><summary>More options</summary>' +
      '<div class="grid2">' + num('tTime', 'Your time is worth ($/hr)', t.timeValue, 5, 'optional · 0 = off') + '<span class="lead small">Adds a cost for every minute of detour and stop time, on top of the rule above.</span></div></details>' +
      '<div class="sub-h">When you get there <button type="button" class="qi" id="tArriveQ" aria-label="More info">?</button></div>' +
      '<div class="seg2" id="tArrive"><button data-a="buffer" class="' + (t.arrive !== 'full' ? 'on' : '') + '">Just keep my buffer</button><button data-a="full" class="' + (t.arrive === 'full' ? 'on' : '') + '">Arrive with the most ' + (kd === 'ev' ? 'charge' : kd === 'h2' ? 'hydrogen' : 'gas') + '</button></div>' +

      '<div class="grid2' + (t.arrive === 'full' ? '' : ' hidden') + '" id="tTopBox">' + num('tTopMi', 'Top-up within (mi)', t.topUpMi, 0.1, 'for an optional last top-up') + '<span></span></div>' +
      '</div><div class="card"><h3>Cruising speed</h3>' +
      '<div class="field"><div class="lbl">Go over the speed limit by default<small>Off: every road starts at its limit. On: +N over the limit, but never above a top speed — roads already at that limit or higher stay at the limit.</small></div>' + sw('tRule', !!(S.speed.rule && S.speed.rule.on)) + '</div>' +
      '<div class="grid2' + (S.speed.rule && S.speed.rule.on ? '' : ' hidden') + '" id="tRuleBox">' + num('tRuleOver', 'Over the limit by (mph)', (S.speed.rule && S.speed.rule.over) || 9, 1) + num('tRuleCap', '…but no faster than (mph)', (S.speed.rule && S.speed.rule.cap) || 70, 1) + '</div>' +
      '<div class="field"><div class="lbl">Keep me as slow as the trucks<small>Uses the large-truck limit where a state sets one lower than for cars — e.g. 70 on Arkansas Interstates (like I-57) posted 75. From state law as compiled by IIHS; no road database lists truck limits. Not covered: Illinois\' county truck limits.</small></div>' + sw('tTruck', !!S.speed.truck) + '</div>' +
      '<div class="field"><div class="lbl">Let the buffer and speed sliders adjust each other<small>On: a smaller buffer slows you down where needed, and faster speeds raise the buffer, so the tank never runs dry. Off: each slider just stops (grayed out) where the other one doesn\'t leave enough gas.</small></div>' + sw('tLinkSl', S.trip.linkSliders !== false) + '</div>' +
      '<div id="tLinkBox"' + (S.trip.linkSliders !== false ? '' : ' class="hidden"') + '><div class="sub-h">When a smaller buffer needs slower driving</div>' +
      '<div class="seg2" id="tSlowMode"><button data-sm="all" class="' + (S.trip.slowMode !== 'fastest' ? 'on' : '') + '">Slow all roads</button><button data-sm="fastest" class="' + (S.trip.slowMode === 'fastest' ? 'on' : '') + '">Fastest roads first</button></div>' +
      '<div class="grid2">' + num('tMaxUnder', 'Max. under limit (mph)', S.trip.maxUnder != null ? S.trip.maxUnder : 5, 1, 'the slider never slows you more than this') + '<span></span></div></div>' +
      '</div><div class="card"><h3>Other routes</h3>' +
      '<div class="field"><div class="lbl">Check Google\'s other routes too<small>Plans the trip on each other route Google suggests and tells you if one saves enough. Uses Google lookups for each route checked.</small></div>' + sw('tAltCmp', t.altCompare) + '</div>' +
      '<div class="grid2' + (t.altCompare ? '' : ' hidden') + '" id="tAltBox">' + num('tAltSave', 'Worth switching if it saves at least ($)', t.altMinSave, 1, 'for the whole trip') + '<span></span></div></div>';
    }
    if (k === ST_ADJ) return '<div id="taResults"></div>';
    if (k === ST_STOPS) return '<div id="tsResults"></div>';
    return departureHtml();
  }
  // another car: the route's fuel use is worked out again a moment later (a long trip takes a while), or right away
  // when a step needs it
  var modelStale = false, staleT = 0;
  function freshModel() {
    clearTimeout(staleT); if (!modelStale) return; modelStale = false;
    if (model && rawRoute) { model = T.buildRoute(rawRoute, carModel()); renderInfo(); }
  }
  function bindStep(k) {
    if (k === ST_ADVISORY) { Advisory.render($('tAdvisory'), call); return; }
    if (k === ST_GARAGE) {
      Garage.render($('tGarage'), null, function () {
        if (model) { modelStale = true; clearTimeout(staleT); staleT = setTimeout(freshModel, 400); }   // after the Garage has redrawn
        result = null; gateTabs();
        var e3 = $('tpS' + ST_PARAMS); if (e3 && step !== ST_PARAMS) { e3.remove(); delete built[ST_PARAMS]; }   // its labels follow the car (gal / kWh / kg)
      }, call);
      return;
    }
    if (k === ST_ROUTE) { bindRoute(); return; }
    if (k === ST_PARAMS) { bindSettings(); return; }
    if (onPlan(k)) {
      renderResults();
      built[k].result = result;
      if (model && !result && !busy && hasFuel()) findStops();
      return;
    }
    bindDeparture();
  }
  function bindRoute() {
    var t = S.trip;
    $('tLink').addEventListener('input', debounce(function () { route = null; model = null; replay = null; result = null; autoRoute = true; renderInfo(); readLink().then(autoRoutes); }, 400));
    ['tFrom', 'tTo'].forEach(function (id) {
      $(id).addEventListener('input', function () { route = null; model = null; replay = null; result = null; autoRoute = true; renderInfo(); renderStops(); });
      $(id).addEventListener('change', function () { autoRoutes(); });   // done typing (left the box): fetch once both are in
    });
    var dEl = $('tDepart'), minNow = function () { var d = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4); dEl.min = d.toISOString().slice(0, 16); };
    minNow(); dEl.addEventListener('focus', minNow);
    dEl.addEventListener('change', function () {
      // sanity check: you can't leave in the past (a few minutes' slack for the time it took to pick)
      if (dEl.value && new Date(dEl.value).getTime() < Date.now() - 5 * 6e4) dEl.value = '';
      collectSafe(); result = null;
    });
    $('tNow').onclick = function () { $('tDepart').value = ''; collectSafe(); result = null; };
    $('tHere').onclick = function () { $('tFrom').value = 'My location'; $('tFrom').dispatchEvent(new Event('input')); };
    $('tSrc').onclick = function (e) {
      var b = e.target.closest('button'); if (!b || b.classList.contains('on')) return;
      Array.prototype.forEach.call($('tSrc').children, function (x) { x.classList.toggle('on', x === b); });
      S.trip.src = b.dataset.src; A.save();
      $('tSrcLink').classList.toggle('hidden', S.trip.src !== 'link'); $('tSrcTyped').classList.toggle('hidden', S.trip.src !== 'typed');
      route = null; model = null; replay = null; result = null; parsing = null; parsedEl().innerHTML = ''; renderInfo(); layer.clearLayers();
      if (S.trip.src === 'link' && $('tLink').value.trim()) readLink().then(autoRoutes);
    };
    $('tRound').onchange = function () {
      collectSafe();
      if (route && syncReturn(route)) { model = null; replay = null; result = null; autoRoute = false; LG.info('route', S.trip.returnTrip ? 'Round trip: added the way back' : 'Round trip off'); }
      renderStops(); renderInfo();
    };
    $('tAvoid').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      b.classList.toggle('on'); collectSafe(); model = null; replay = null; result = null; autoRoute = false; renderInfo();   // changed options: Get routes again by hand
    };
    renderStops(); renderInfo();
    if (srcOf() === 'link' && t.link && !route) readLink().then(autoRoutes); else autoRoutes();
  }
  function bindSettings() {
    var again = function () { collectSafe(); result = null; };
    var arriveHelp = function () {
      var full = $('tArrive').querySelector('.on').dataset.a === 'full';
      $('tArriveQ').dataset.q = encodeURIComponent(full ? 'Your last stop fills the tank, late in the trip and as cheaply as possible (the “must save” amount drops to $0.25 so a late cheap fill-up isn\'t skipped). You can add a top-up close to the destination afterward.'
        : 'Arrive with at least your buffer; gas left over is counted at the typical price.');
      show($('tTopBox'), full);
    };
    var seg = function (id, after) {
      $(id).onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        Array.prototype.forEach.call($(id).children, function (x) { x.classList.toggle('on', x === b); });
        if (after) after(); collectSafe(); again();
      };
    };
    seg('tArrive', arriveHelp); seg('tMode'); seg('tSlowMode');
    var ruleSave = function () {
      S.speed.rule = { on: $('tRule').checked, over: Math.max(-10, Math.min(15, parseInt($('tRuleOver').value, 10) || 0)), cap: Math.max(40, Math.min(90, parseInt($('tRuleCap').value, 10) || 70)) };
      $('tRuleBox').classList.toggle('hidden', !S.speed.rule.on); A.save();
      if (result) result.speedState = null;
      again();
    };
    $('tRule').onchange = ruleSave; $('tRuleOver').onchange = ruleSave; $('tRuleCap').onchange = ruleSave;
    $('tTruck').onchange = function () { S.speed.truck = this.checked; A.save(); LG.info('speed', 'Truck limits ' + (this.checked ? 'on' : 'off')); again(); };
    $('tLinkSl').onchange = function () { collectSafe(); $('tLinkBox').classList.toggle('hidden', !S.trip.linkSliders); };
    $('tAltCmp').onchange = function () { $('tAltBox').classList.toggle('hidden', !this.checked); collectSafe(); again(); };
    ['tBuffer', 'tMinSave', 'tMaxMin', 'tTime', 'tTopMi', 'tTankPrice', 'tMaxUnder', 'tAltSave'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('input', function () { collectSafe(); again(); });
    });
    arriveHelp();
    renderFuel();
  }
  function renderFuel() {
    FuelGauge.render($('tFuel'), { kind: KIND(), tank: Garage.tank(), mpu: Garage.carModel().comb, unit: UN(), fuel: fuel(),
      onChange: function (f) { S.trip.fuel = f; syncMilesLeft(); A.save(); result = null; emptyHelp(); gateTabs(); } });
    emptyHelp();
  }
  /** How much is in the tank: S.trip.fuel ({mode: gauge / pct / miles, …}, see fuelgauge.js), filled in for this car. */
  function fuel() { return (S.trip.fuel = FuelGauge.math.norm(S.trip.fuel, KIND(), S.trip.milesLeft)); }
  function fuelMiles() { return FuelGauge.math.miles(fuel(), Garage.tank(), Garage.carModel().comb); }
  function hasFuel() { var m = fuelMiles(); return m != null && m > 0; }   // an empty tank isn't an answer (see emptyHelp)
  /** Roads wind: a straight line times this is a fair guess at the miles to a station off the route. */
  var ROAD = 1.25;
  /** Stations Gasket already knows (the map's, plus this route's saved Google answers) — nothing is looked up. */
  function knownStations() {
    var out = (A.stations ? A.stations() : []).slice();
    if (model && KIND() === 'gas') try {
      googleBrands().forEach(function (b) {
        T.chunks(model, 125).forEach(function (ch) {
          var o = A.KV.get('along', P.BRANDS[b].query + '|' + ch.polyline, 30 * 864e5);
          ((o && o.v && o.v.places) || []).forEach(function (pl) { var st = P.normalize(pl); if (st && S.brands[st.brand]) out.push(st); });
        });
      });
    } catch (e) { LG.warn('plan', 'Couldn\'t read saved stations', String(e)); }
    return dedupe(out.filter(function (s) { return s && s.lat != null && s.lng != null; }));
  }
  /**
   * An empty tank: the nearest known station from the start (straight line x ROAD), and the nearest one along the route
   * (miles along it, plus the way off it). -> { near: {st, mi}, along: {st, mi} } (either may be null).
   */
  function emptyPlan() {
    var start = model && model.pts.length ? model.pts[0] : A.me && A.me(), near = null, along = null;
    if (!start) return { near: null, along: null };
    knownStations().forEach(function (st) {
      var mi = P.haversineMi(start.lat, start.lng, st.lat, st.lng) * ROAD;
      if (!near || mi < near.mi) near = { st: st, mi: mi };
      if (model) {
        var pj = T.project(model, { lat: st.lat, lng: st.lng });
        if (pj.offset <= 1) { var am = pj.along + pj.offset * ROAD; if (!along || am < along.mi) along = { st: st, mi: am }; }
      }
    });
    return { near: near, along: along };
  }
  /** Under the gauge when it says empty: how much to put in to reach a station first (Adjustments on wait for a real amount). */
  function emptyHelp() {
    var host = $('tEmpty'); if (!host) return;
    if (!FuelGauge.math.empty(fuel(), Garage.tank(), Garage.carModel().comb)) { host.innerHTML = ''; return; }
    var ev = KIND() === 'ev', u = UN(), mpu = Garage.carModel().comb, p = emptyPlan();
    var opt = function (o, how, id) {
      var amt = FuelGauge.math.toReach(o.mi, mpu);
      return '<div class="fe-opt"><p><b>' + amt.toFixed(2) + ' ' + esc(u) + '</b> ' + how + ' <b>' + esc(o.st.name || 'a station') + '</b>' + (o.st.address ? ', ' + esc(o.st.address) : '') + ' (about ' + o.mi.toFixed(1) + ' mi).</p>' +
        '<button type="button" class="btn tonal sm" id="' + id + '" data-mi="' + (o.mi + 0.1).toFixed(2) + '">I\'ll put in ' + amt.toFixed(2) + ' ' + esc(u) + '</button></div>';
    };
    var h = '<div class="fg-empty" role="alert"><b>' + (ev ? 'Your battery is empty.' : 'Your tank is empty.') + '</b><p>' +
      (ev ? 'Charge' : 'Put in') + ' at least enough to reach a station first (0.1 mile extra is included), then set the ' + (ev ? 'charge' : 'gauge') + ' to what you have.</p>';
    if (p.near) h += opt(p.near, 'to reach the nearest station Gasket knows,', 'tEmptyNear');
    if (p.along && (!p.near || p.along.st.id !== p.near.st.id)) h += opt(p.along, 'to reach the first station along your route,', 'tEmptyAlong');
    else if (p.near && p.along) h += '<p class="fe-same">It\'s also the first station along your route.</p>';
    if (!p.near) h += '<p>Gasket doesn\'t know any stations near your start yet. Search the map there, or ' + (ev ? 'charge' : 'fill up') + ' at the closest station you know.</p>';
    host.innerHTML = h + '</div>';
    host.querySelectorAll('[data-mi]').forEach(function (b) {
      b.onclick = function () {
        S.trip.fuel = { mode: 'miles', miles: String(Math.ceil(+b.dataset.mi * 10) / 10) }; syncMilesLeft(); A.save(); result = null;
        LG.info('plan', 'Empty tank: putting in enough for ' + S.trip.fuel.miles + ' mi');
        renderFuel(); gateTabs();
      };
    });
  }
  /** Fuel in the tank at the start: a gauge or percentage is a share of the tank; dash miles use the route's mileage. */
  function startFuel(m) { var f = fuel(); return f.mode === 'miles' ? (parseFloat(f.miles) || 0) * m.combGpm : FuelGauge.math.amount(f, Garage.tank(), 1) || 0; }
  /** S.trip.milesLeft follows the fuel choice (saved trips and old exports read it). */
  function syncMilesLeft() { var m = fuelMiles(); S.trip.milesLeft = m == null ? '' : String(Math.round(m)); }
  /** Where the route comes from: a Google Maps link, or addresses you type. */
  function srcOf() { var t = S.trip; return t.src === 'typed' || t.src === 'link' ? t.src : (!t.link && (t.from || t.to) ? 'typed' : 'link'); }
  /** When you're leaving: the saved time if it's still ahead, else now. */
  function futureDepart() { var d = S.trip.depart ? new Date(S.trip.depart) : null; return d && !isNaN(d) && d.getTime() > Date.now() - 600e3 ? d : null; }
  function departAt() { return futureDepart() || new Date(); }
  function isHere(x) { return /^(my|your) (current )?location$/i.test(String(x || '').trim()); }
  function sw(id, on) { return '<label class="switch"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '><span></span></label>'; }
  function num(id, label, v, step, hint) {
    return '<label class="nf"><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span><input type="number" inputmode="decimal" id="' + id + '" step="' + step + '" value="' + esc(v) + '"></label>';
  }
  function debounce(f, ms) { var t; return function () { clearTimeout(t); t = setTimeout(f, ms); }; }
  /** Save whatever fields the current step shows (each one only if it's on screen). */
  function collectSafe() {
    var t = S.trip, v = function (id) { var e = $(id); return e ? e.value : null; }, on = function (id) { var e = $(id); return e ? e.checked : null; };
    var segOn = function (id, attr) { var e = $(id); var b = e && e.querySelector('.on'); return b ? b.dataset[attr] : null; };
    if (v('tLink') != null) t.link = v('tLink').trim();
    if (v('tFrom') != null) { t.from = v('tFrom').trim(); t.to = v('tTo').trim(); }
    if ($('tAvoid')) Array.prototype.forEach.call($('tAvoid').children, function (b) { t.avoid[b.dataset.av] = b.classList.contains('on'); });
    if (segOn('tMode', 'm')) t.fillUp = segOn('tMode', 'm') === 'fill';
    if (segOn('tArrive', 'a')) t.arrive = segOn('tArrive', 'a');
    if (v('tTopMi') != null) t.topUpMi = Math.max(0, Math.round((parseFloat(v('tTopMi')) || 0) * 10) / 10);
    if (on('tRound') != null) t.returnTrip = on('tRound');
    if (segOn('tSrc', 'src')) t.src = segOn('tSrc', 'src');
    if (v('tDepart') != null) t.depart = v('tDepart') || '';
    if (on('tLinkSl') != null) t.linkSliders = on('tLinkSl');
    if (segOn('tSlowMode', 'sm')) t.slowMode = segOn('tSlowMode', 'sm');
    if (v('tMaxUnder') != null) t.maxUnder = Math.max(0, Math.min(10, parseInt(v('tMaxUnder'), 10) || 0));
    if (on('tAltCmp') != null) { t.altCompare = on('tAltCmp'); t.altMinSave = Math.max(0, parseFloat(v('tAltSave')) || 0); }
    if (v('tTankPrice') != null) t.tankPrice = v('tTankPrice').trim();
    if (v('tBuffer') != null) t.bufferMi = Math.max(0, parseFloat(v('tBuffer')) || 0);
    if (v('tMinSave') != null) { t.minSave = Math.max(0, parseFloat(v('tMinSave')) || 0); t.timeValue = Math.max(0, parseFloat(v('tTime')) || 0); var mm = parseFloat(v('tMaxMin')); t.maxDetourMin = mm >= 0 ? mm : 10; }
    A.save();
  }
  function collect() { collectSafe(); }
  function parsedEl() { return $('tParsed') || document.createElement('div'); }

  // ---------- reading the link ----------
  function readLink() {
    var text = ($('tLink') ? $('tLink').value : S.trip.link || '').trim();
    if (!text) { parsing = null; route = null; parsedEl().innerHTML = ''; return Promise.resolve(null); }
    if (parsing && parsing.text === text) return parsing.p;
    var job = parsing = { text: text, frac: 0 };
    parseBar(0.03);
    job.p = readLink0(text, job).then(function (r) {
      if (parsing === job) { parsing = null; if (r) { route = r; renderStops(); } }
      return parsing === null || parsing === job ? r : null;
    }, function (e) {
      if (parsing === job) { parsing = null; parsedEl().innerHTML = '<div class="msg err">' + esc(e.message || String(e)) + '</div>'; }
      LG.error('link', e.message || String(e)); return null;
    });
    return job.p;
  }
  async function readLink0(text, job) {
    var shared = importTrip(text);
    if (shared) { LG.info('link', 'Imported a shared trip', { stops: shared.stops.length }); previewCities(shared); return shared; }
    dbg = { linkText: text.slice(0, 2000), at: new Date().toISOString() };
    var url = T.extractUrl(text);
    LG.info('link', 'Reading link', url);
    if (!url) throw new Error('That doesn\'t look like a link.');
    if (T.isShortLink(url)) {
      parseBar(0.06);
      var r = await call('resolveLink', url);
      if (r.error || !r.url) { LG.error('link', 'Short link failed', r.error); dbg.linkError = r.error; throw new Error(r.error || 'Couldn\'t open the link.'); }
      url = r.url;
      LG.debug('link', 'Short link opened to', url);
    }
    dbg.resolvedUrl = url;
    var mapsUrl = url;
    var parsed = T.parseMapsUrl(url);
    dbg.parsed = parsed && JSON.parse(JSON.stringify(parsed));
    LG.debug('link', 'Parsed link', parsed);
    if (!parsed) throw new Error('That link isn\'t a Google Maps directions link. Open directions first, then share.');
    parseBar(0.15);
    // Phone share links name stops loosely ("100 Main St") and identify them only by Google's internal place ID.
    // Let Google Maps itself (in a hidden page) turn them into full addresses + exact coordinates and list the routes.
    if (parsed.stops.some(function (st) { return !st.current && st.lat == null; }) || parsed.routeIndex != null) {
      var stopCreep = creep(0.15, 0.5, 8);
      var g = await openInGoogleMaps(url);
      stopCreep();
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
    parsed.mapsUrl = mapsUrl;
    if (parsed.avoidDetected) {
      S.trip.avoid = Object.assign({}, S.trip.avoid, parsed.avoid);
      if ($('tAvoid')) Array.prototype.forEach.call($('tAvoid').children, function (b) { b.classList.toggle('on', !!parsed.avoid[b.dataset.av]); });
    }
    // now, at the same time: full addresses for every stop (Google) and the route options Google Maps shows
    parseBar(0.5);
    var addrF = 0, scanF = 0, both = function () { parseBar(0.5 + 0.5 * (addrF * 0.4 + scanF * 0.6)); };
    var scanCreep = setInterval(function () { scanF = Math.min(0.9, scanF + 0.04); both(); }, 400);
    await Promise.all([
      resolveStops(parsed, function (f) { addrF = f; both(); }, true).catch(function (e) { LG.warn('address', String(e)); }),
      mapsOptions(parsed).catch(function (e) { LG.warn('route', 'Route options scan failed', String(e)); })
    ]);
    clearInterval(scanCreep);
    parseBar(1);
    previewCities(parsed);
    scanLegs(parsed);
    return parsed;
  }

  // ---------- making sure every stop is the right place ----------
  // ---------- shared trips (import) ----------
  var TRIP_START = '-----GASKET TRIP-----', TRIP_END = '-----END GASKET TRIP-----';
  // markers trips are read with: ours, then the ones Fuel+ Map shared trips used
  var TRIP_MARKS = [[TRIP_START, TRIP_END], ['-----FUEL+ TRIP-----', '-----END FUEL+ TRIP-----']];
  function importTrip(text) {
    var m = TRIP_MARKS.filter(function (k) { return text.indexOf(k[0]) >= 0; })[0];
    if (!m) return null;
    var a = text.indexOf(m[0]), b = text.indexOf(m[1]);
    if (b < a) return null;
    try {
      var j = JSON.parse(text.slice(a + m[0].length, b).trim());
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
    var L = ['Gasket trip: ' + stopLine(o) + ' → ' + stopLine(d), Math.round(model.totalMi) + ' mi · ' + fmtDur(model.durationSec) + ' · ' + gradeLabel(r.grade).toLowerCase()];
    if (p && p.ok) {
      p.stops.forEach(function (s, i) {
        L.push((i + 1) + '. ' + s.c.station.name + ' — ' + (s.c.station.address || '') + ' — mile ' + Math.round(s.c.d) + ' — ' + priceText(s.c.price) + '/' + UN() + ' — buy ' + s.buyGal.toFixed(1) + ' ' + UN() + ' (' + money2(s.cost) + ')');
      });
      if (r.top) L.push('Top-up: ' + r.top.c.station.name + ' — ' + priceText(r.top.c.price) + ' — ' + r.top.buyGal.toFixed(1) + ' ' + UN());
      if (r.acc) L.push('Trip cost ' + money2(r.acc.legs[0].cost) + ' · at the pump ' + money2(r.acc.legs[0].spend) + (p.savings > 0.005 ? ' · saves ' + money2(p.savings) + ' vs. easiest stops' : ''));
      if (r.acc && r.acc.legs[1]) L.push('Round trip estimate ' + money2(r.acc.legs[0].cost + r.acc.legs[1].cost));
      var ex = T.exportUrl(route, p.stops.concat(r.top ? [{ c: r.top.c }] : []), model);
      L.push('', 'Open in Google Maps: ' + ex.url);
    }
    L.push('', 'To plan this trip in Gasket, paste this whole message into the trip link box:', tripBlock());
    N.shareText('Gasket trip', L.join('\n'));
    LG.info('share', 'Shared trip summary');
  }
  function report() {
    var safeSettings = JSON.parse(JSON.stringify(S));
    delete safeSettings.apiKey; safeSettings.hasApiKey = !!S.apiKey;
    var r = result;
    var rep = {
      gasketReport: 1, app: N.appVersion ? N.appVersion() : '', time: new Date().toString(), userAgent: navigator.userAgent,
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
      speed: model && model._lim && model._lim.roads ? { stats: model._lim.stats, offsets: r && r.speedState && r.speedState.offsets, cost: r && r.speedState && r.speedState.cost,
        roads: model._lim.roads.map(function (x) { return { name: x.name, cls: x.cls, from: Math.round(x.from), to: Math.round(x.to), pieces: x.pieces.map(function (p) { return [Math.round(p.from), p.st || '', p.limit, p.src, Math.round(p.googleMph)]; }) }; }),
        instructions: model.segs.filter(function (sg) { return sg.to - sg.from > 0.5; }).slice(0, 200).map(function (sg) { return [Math.round(sg.from * 10) / 10, Math.round((sg.to - sg.from) * 10) / 10, sg.instr]; }) } : null,
      bufferSweep: r && r.sweep ? r.sweep.map(function (x) { return { mi: x.mi, ok: x.ok, net: x.net && Math.round(x.net * 100) / 100, mark: x.mark, stops: x.ok ? x.plan.stops.map(function (s) { return s.c.station.name + ' @' + Math.round(s.c.d); }) : null }; }) : null,
      log: window.FLog ? FLog.entries().slice(-300) : []
    };
    return JSON.stringify(rep, null, 1);
  }
  /** The troubleshooting report: built after the button shows it's working, then saved and shared as a file in the background. */
  async function shareReport(e) {
    var btn = e && e.target && e.target.closest ? e.target.closest('a, button') : null;
    if (btn && btn.dataset.busy) return;
    if (btn) { btn.dataset.busy = 1; btn.dataset.lbl0 = btn.textContent; btn.textContent = 'Preparing the report…'; }
    await paint();
    try {
      var text = report();
      if (text.length > 1500000) text = text.slice(0, 1500000) + '\n…(trimmed)';
      LG.info('share', 'Troubleshooting report shared', { chars: text.length });
      await window.__shareFile('gasket-report-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json', 'application/json', text, 'Gasket troubleshooting report');
    } catch (x) { toastMsg('Couldn\'t make the report: ' + (x.message || x)); }
    if (btn) { delete btn.dataset.busy; btn.textContent = btn.dataset.lbl0; }
  }
  window.__tripReport = report;

  async function openInGoogleMaps(url) {
    var u = url.replace(/^https?:\/\/(maps\.google\.com|google\.com|www\.google\.com)\/maps\//, 'https://www.google.com/maps/');
    if (!/^https:\/\/www\.google\.com\/maps\/dir\//.test(u)) return null;
    var run = gmapsChain.then(function () { return site('gmaps', { url: u }, 40000); });
    gmapsChain = run.catch(function () { });
    return run;
  }
  var gmapsChain = Promise.resolve();
  var parsing = null;      // {text, p, frac}
  function parseBar(f) {
    var el = $('tParsed'); if (!el || !parsing) return;
    parsing.frac = Math.max(parsing.frac || 0, Math.min(1, f));
    var pct = Math.round(parsing.frac * 100), bar = el.querySelector('.parse-load i');
    if (bar) { bar.style.width = pct + '%'; el.querySelector('.parse-load .pct').textContent = pct + '%'; return; }
    el.innerHTML = '<div class="parse-load"><span>Loading…</span><span class="pbar"><i style="width:' + pct + '%"></i></span><span class="pct">' + pct + '%</span></div>';
  }
  /** Creep the bar toward `to` while waiting on something that reports no progress (the hidden Google Maps page). */
  function creep(from, to, sec) {
    var t0 = Date.now(), id = setInterval(function () {
      if (!parsing) return clearInterval(id);
      var x = (Date.now() - t0) / 1000 / sec; parseBar(from + (to - from) * (1 - Math.exp(-3 * x)));
    }, 250);
    return function () { clearInterval(id); };
  }
  function stopLine(s) {
    if (s.current) return 'Your location';
    if (!T.fullAddress(s.address) && s.osmPlace) return (s.address || s.label) + ', ' + s.osmPlace;
    return s.address || s.label;
  }
  function renderStops() {
    var el = $('tParsed'); if (!el || parsing) return;
    if (!route) { el.innerHTML = ''; return; }
    var r = route;
    if (syncReturn(r) && model) { model = null; renderInfo(); }
    var h = numList(r.stops, function (s, i) {
      var x = '';
      if (s.err) x += '<div class="msg err">' + esc(s.err) + '</div>';
      if (s.choices) {
        x += '<div class="pick"><div class="pick-h">Which one?</div>' + s.choices.map(function (c, k) {
          return '<button data-stop="' + i + '" data-choice="' + k + '">' + esc(c.formattedAddress) + (c.displayName && c.displayName.text && !norm(c.displayName.text).split(' ').every(function (w) { return norm(c.formattedAddress).split(' ').indexOf(w) >= 0; }) ? '<small>' + esc(c.displayName.text) + '</small>' : '') + '</button>';
        }).join('') + '</div>';
      }
      return x;
    });
    if (r.mode && r.mode !== 'drive') h += '<div class="msg err">This link is for ' + esc(r.mode) + ' directions; fuel stops will use driving directions.</div>';
    // route options are picked after Get routes (one picker, with Google's own routes) — none before it
    var withPts = false;
    if (withPts && !model) {
      var selK = r.routeIndex != null ? Math.min(r.routeIndex, r.mapsRoutes.length - 1) : 0;
      h += '<div class="maps-opts"><div class="sub-h">Pick a route</div><div class="rmap" id="tOptMap"></div>' +
        '<div class="opt-sel">via <b>' + esc(r.mapsRoutes[selK].via) + '</b> · ' + Math.round(r.mapsRoutes[selK].miles || 0).toLocaleString() + ' mi · ' + fmtDur((r.mapsRoutes[selK].minutes || 0) * 60) + '</div></div>';
    }
    if (r.note) h += '<div class="msg err">' + esc(r.note) + '</div>';
    el.innerHTML = h;
    if ($('tOptMap')) optionsMap($('tOptMap'), r.mapsRoutes.map(function (m) {
      return { pts: m.pts, time: fmtDur((m.minutes || 0) * 60), miles: Math.round(m.miles || 0).toLocaleString() + ' mi' };
    }), r.routeIndex != null ? Math.min(r.routeIndex, r.mapsRoutes.length - 1) : 0, function (k) { r.routeIndex = k; LG.info('route', 'Picked route option ' + (k + 1) + ' on the map', r.mapsRoutes[k].via); renderStops(); });
    el.querySelectorAll('[data-choice]').forEach(function (b) {
      b.onclick = function () {
        var st = r.stops[+b.dataset.stop], c = st.choices[+b.dataset.choice];
        setPlace(st, c); st.choices = null; model = null; renderStops(); renderInfo(); autoRoutes();
      };
    });
  }
  /** The trip's places as a numbered list (1, 2, 3 …); extra(stop, i) adds anything under a place (an error, a "which one?"). */
  function numList(stops, extra) {
    return '<ol class="nlist">' + stops.map(function (st, i) {
      return '<li><span class="nn">' + (i + 1) + '</span><div class="nl-a">' + esc(stopLine(st)) + (extra ? extra(st, i) : '') + '</div></li>';
    }).join('') + '</ol>';
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
  /** Google place lookup, saved for a month (an address doesn't move). */
  async function findPlace(q, lat, lng, bias, radius) {
    var key = [q, (+lat).toFixed(4), (+lng).toFixed(4), bias ? 1 : 0, radius].join('|'), o = A.KV.get('find', key, 30 * 24 * 3600e3);
    if (o) return o.v;
    var res = await call('placesFind', S.apiKey, q, lat, lng, bias, radius);
    if (!res.error) A.KV.put('find', key, res);
    return res;
  }
  async function completeAddress(st) {
    try {
      var res = await findPlace(st.address, st.lat, st.lng, true, 300);
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
  async function resolveStops(r, onProg, quiet) {
    var me = A.me(), need = false, done = 0, n = r.stops.length;
    var tick = function () { done++; if (onProg) onProg(done / n); };
    // stops with an exact spot: fill in the full address, all at once
    await Promise.all(r.stops.map(function (st) {
      if (st.current || st.lat == null) return Promise.resolve();
      return (!st.placeId && !T.fullAddress(st.address) && st.address && S.apiKey ? completeAddress(st) : Promise.resolve()).then(tick);
    }));
    // text-only stops: look each one up near the stop before it (also all at once)
    await Promise.all(r.stops.map(async function (st, i) {
      if (st.current || st.lat != null) return;
      if (st.choices) { need = true; return; }
      var prev = null;
      for (var k = i - 1; k >= 0 && !prev; k--) if (r.stops[k].lat != null) prev = { lat: r.stops[k].lat, lng: r.stops[k].lng };
      var near = prev || (me ? { lat: me.lat, lng: me.lng } : null);
      var res = await findPlace(st.address, near ? near.lat : 0, near ? near.lng : 0, !!near, 50000);
      tick();
      if (res.error) { st.err = res.error; need = true; return; }
      var list = (JSON.parse(res.body).places || []).filter(function (c) { return c.location && c.formattedAddress; });
      if (!list.length) { st.err = 'Google couldn\'t find this address. Add the city and state.'; need = true; return; }
      if (clearMatch(st.address, list)) { setPlace(st, list[0]); LG.debug('address', 'Found ' + st.address); }
      else { st.choices = list.slice(0, 5); need = true; LG.info('address', 'Several matches for “' + st.address + '”', list.map(function (c) { return c.formattedAddress; })); }
    }));
    if (!quiet) renderStops();
    return !need;
  }

  function typedRoute() {
    var from = $('tFrom').value.trim(), to = $('tTo').value.trim();
    if (!to) return null;
    if (!from) return null;
    var mk = function (t) { return { address: t, label: t, short: T.shortLabel(t) }; };
    return { stops: [isHere(from) ? { current: true, label: 'Your location' } : mk(from), mk(to)], avoid: {}, mode: 'drive', typed: true };
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

  // ---------- trips with stops in between ----------
  // Google Maps (and the Routes API) only offer route options for a trip from A to B. So with stops in between, each
  // leg is routed on its own — with all of its options — and the picks are joined into one trip for the fuel plan.
  /** Ends where it started (a round trip planned as legs): the "drive back" estimate would count the way home twice. */
  function loopTrip(r) {
    r = r || route;
    var a = r && r.stops[0], b = r && r.stops[r.stops.length - 1];
    if (!a || !b || a === b) return false;
    if (a.current || b.current) return !!(a.current && b.current);
    return a.lat != null && b.lat != null && T.hav(a, b) < 0.5;
  }
  /**
   * The "Round trip" switch: adds the way back to the start as a last stop (marked ret), or takes it off. Not added when
   * the trip already ends where it starts. Returns true when the stops changed.
   */
  function syncReturn(r) {
    if (!r || !r.stops || r.stops.length < 2) return false;
    // a way back that's already there stays as it is (a saved trip's; "your location" moves a little every time
    // you look, and that's no reason to throw its routes away)
    // (is it a loop without the way back? the way back itself always ends where it started)
    if (S.trip.returnTrip && !loopTrip({ stops: r.stops.filter(function (x) { return !x.ret; }) }) && r.stops.filter(function (x) { return x.ret; }).length === 1 && r.stops[r.stops.length - 1].ret) return false;
    var before = JSON.stringify(r.stops.filter(function (x) { return x.ret; }));
    r.stops = r.stops.filter(function (x) { return !x.ret; });
    if (S.trip.returnTrip && r.stops.length >= 2 && !loopTrip(r)) {
      var a = r.stops[0], back = Object.assign({}, a, { ret: true, choices: null });
      if (a.current) {
        var me = A.me();
        if (me) back = { ret: true, lat: me.lat, lng: me.lng, fromLink: true, address: me.lat.toFixed(6) + ',' + me.lng.toFixed(6), label: 'Your location', short: 'Your location' };
      }
      r.stops.push(back);
    }
    return JSON.stringify(r.stops.filter(function (x) { return x.ret; })) !== before;
  }
  function multiLeg(r) { return !!(r && r.stops && r.stops.length > 2); }
  /** "North Little Rock → Dallas" as pieces that wrap as a whole: "North Little Rock →" then "Dallas" on the next line if it doesn't fit. */
  function arrowHtml(text) {
    var parts = String(text).split(' → ');
    return '<span class="arws">' + parts.map(function (x, i) { return '<span class="arw">' + esc(x) + (i < parts.length - 1 ? ' →' : '') + '</span>'; }).join(' ') + '</span>';
  }
  function legName(r, i) { return stopName(r.stops[i]) + ' → ' + stopName(r.stops[i + 1]); }
  function legBody(a, b) {
    var avoid = S.trip.avoid;
    return { origin: wp(a), destination: wp(b), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', polylineQuality: 'HIGH_QUALITY', units: 'IMPERIAL',
      computeAlternativeRoutes: true, routeModifiers: { avoidTolls: !!avoid.tolls, avoidHighways: !!avoid.highways, avoidFerries: !!avoid.ferries } };
  }
  function legKey(r, i) { return [r.stops[i], r.stops[i + 1]].map(function (st) { return st.current ? 'here' : st.lat != null ? st.lat.toFixed(4) + ',' + st.lng.toFixed(4) : st.address; }).join('>') + '|' + JSON.stringify(S.trip.avoid); }
  async function routeLeg(r, i) {
    var prev = r.legs && r.legs[i];
    if (prev && prev.key !== legKey(r, i)) prev = null;
    var sub = { stops: [r.stops[i], r.stops[i + 1]], avoid: r.avoid, mapsRoutes: prev && prev.mapsRoutes || null };
    var body = legBody(sub.stops[0], sub.stops[1]);
    var res = await routesCall(body);
    if (res.error) throw new Error('Leg ' + (i + 1) + ' (' + legName(r, i) + '): ' + res.error);
    var j = JSON.parse(res.body);
    if (!j.routes || !j.routes.length) throw new Error('Google found no driving route for leg ' + (i + 1) + ' (' + legName(r, i) + ').');
    var cx = { alts: j.routes };
    await allMapsRoutes(sub, body, cx);
    // same pick as before when this leg was routed already
    var sel = 0, want = prev && prev.alts && prev.alts[prev.sel] && prev.alts[prev.sel].description;
    if (want) cx.alts.forEach(function (a, k) { if (a.description === want) sel = k; });
    // the way out of a Google Maps link made into a round trip: start on the route option picked in Maps
    else if (i === 0 && r.mapsRoutes && r.routeIndex != null && r.stops.filter(function (x) { return !x.ret; }).length === 2) sel = Math.max(0, matchRoute(cx.alts, r.mapsRoutes[Math.min(r.routeIndex, r.mapsRoutes.length - 1)]).index);
    return { key: legKey(r, i), alts: cx.alts, sel: sel, mapsRoutes: sub.mapsRoutes };
  }
  /** Prefetch each leg's route options from Google Maps while you look over the trip (free; saved for 2 hours). */
  function scanLegs(r) {
    if (!multiLeg(r)) return;
    r.stops.slice(0, -1).forEach(function (_, i) {
      var sub = { stops: [r.stops[i], r.stops[i + 1]] };
      if (sub.stops.some(function (s) { return s.current || s.lat == null; })) return;
      mapsOptions(sub).then(function (mr) { r.legs = r.legs || []; r.legs[i] = Object.assign(r.legs[i] || {}, { key: legKey(r, i), mapsRoutes: mr }); }).catch(function () { });
    });
  }
  /** The trip as picked (alts[0]) plus each single-leg swap, closest in time first (those are what "other routes" checks). */
  function rebuildAlts() {
    var cur = route.legs.map(function (L) { return L.sel; });
    var combo = function (sel, desc, leg) {
      var o = { _sel: sel, description: desc, distanceMeters: 0, duration: '0s' }, sec = 0, built = null;
      route.legs.forEach(function (L, i) { var a = L.alts[sel[i]]; o.distanceMeters += a.distanceMeters || 0; sec += parseFloat(String(a.duration || '0')); });
      o.duration = Math.round(sec) + 's';
      if (leg != null) o._leg = leg;
      var get = function () { return built || (built = T.joinRoutes(route.legs.map(function (L, i) { return L.alts[sel[i]]; }))); };
      Object.defineProperty(o, 'polyline', { get: function () { return get().polyline; }, enumerable: true });
      Object.defineProperty(o, 'legs', { get: function () { return get().legs; }, enumerable: true });
      return o;
    };
    var main = combo(cur, route.legs.map(function (L) { return L.alts[L.sel].description || ''; }).filter(Boolean).join(' / '));
    var others = [];
    route.legs.forEach(function (L, i) {
      L.alts.forEach(function (a, k) {
        if (k === L.sel) return;
        var s2 = cur.slice(); s2[i] = k;
        others.push(combo(s2, (a.description || 'route ' + (k + 1)) + ' on leg ' + (i + 1), i));
      });
    });
    var t0 = parseFloat(main.duration);
    others.sort(function (x, y) { return Math.abs(parseFloat(x.duration) - t0) - Math.abs(parseFloat(y.duration) - t0); });
    alts = [main].concat(others); altSel = 0; altSure = true;
  }
  async function pickLeg(i, k) {
    var L = route.legs[i]; if (!L || k === L.sel || picking || busy) return;
    L.sel = k;
    document.querySelectorAll('#tRouteInfo [data-leg="' + i + '"]').forEach(function (b) { b.classList.toggle('on', +b.dataset.lk === k); });
    var rm = rmaps['tRmap' + i], ld = rm && rm._setSel ? (rm._setSel(k), A.loader(rm.getContainer(), 'Joining the legs')) : null;
    picking = true;
    await paint();
    try { rebuildAlts(); rawRoute = alts[0]; model = T.buildRoute(rawRoute, carModel()); ensureLimits(model); result = null; } finally { picking = false; if (ld) ld.done(); }
    LG.info('route', 'Leg ' + (i + 1) + ': picked via ' + (L.alts[k].description || k));
    rememberSel();
    renderInfo(true);
  }

  // ---------- step 1: route ----------
  async function go() {
    if (busy) return;
    collect();
    if (!S.apiKey) { A.openSettings(false); return; }
    if (model) return;
    busy = true; routing = true; prog(0.03, 'Reading the link');
    LG.info('route', 'Get route pressed', { miles: S.trip.milesLeft, buffer: S.trip.bufferMi, car: Garage.car() });
    try {
      if (parsing) prog(0.05, 'Reading the link');
      var r = srcOf() === 'typed' ? (route && route.typed ? route : typedRoute())
        : (parsing ? await parsing.p : route) || (S.trip.link && !route ? await readLink() : null) || route;
      if (!r) throw new Error(srcOf() === 'typed' ? 'Enter where you\'re starting and where you\'re going.' : 'Paste a Google Maps directions link.');
      route = r;
      prog(0.15, 'Checking addresses');
      if (!(await resolveStops(r, function (f) { prog(0.15 + f * 0.4, 'Checking addresses'); }))) {
        LG.warn('route', 'Waiting for you to pick addresses', r.stops.map(function (x) { return x.address; }));
        busy = false; renderInfo();
        throw new Error('Pick the right address for each stop marked “Which one?”.');
      }
      syncReturn(r);
      // the same places as a trip you saved (even from another link): its routes and stations, no lookups
      var mt = !freshRoutes && similarTrip(r);
      if (mt) {
        var v = mt.v;
        if (!r.mapsRoutes && v.route.mapsRoutes) r.mapsRoutes = v.route.mapsRoutes;
        if (multiLeg(r)) {
          if (v.route.legs && v.route.legs.length === r.stops.length - 1 && v.route.legs.every(function (L) { return L.alts && L.alts.length; })) {
            r.legs = v.route.legs.map(function (L, i) { return { key: legKey(r, i), alts: L.alts, sel: Math.min(L.sel || 0, L.alts.length - 1), mapsRoutes: null }; });
            rebuildAlts();
          } else mt = null;
        } else {
          alts = v.alts; altSure = false;
          var picked0 = pickedRoute(r);
          if (picked0 && alts.length > 1) { var m0 = matchRoute(alts, picked0); altSel = m0.index; altSure = m0.sure; }
          else altSel = r.routeIndex != null && r.routeIndex < alts.length ? r.routeIndex : Math.min(v.altSel || 0, alts.length - 1);
        }
        if (mt) {
          prog(0.9, 'Reading your saved trip');
          await paint();
          r.histId = mt.id; r.reused = mt.t;
          rawRoute = alts[altSel]; model = T.buildRoute(rawRoute, carModel()); ensureLimits(model);
          replay = { id: mt.id, t: mt.t, stations: v.stations, alts: v.alts, partial: true };
          LG.info('history', 'Same places as a saved trip — using its routes (no lookups)', { id: mt.id, saved: new Date(mt.t).toISOString(), options: alts.map(function (a) { return a.description; }), picked: altSel });
        }
      }
      if (model) { /* reused */ } else if (multiLeg(r)) {
        // a stop in between: Google only offers route options trip by trip, so route each leg on its own and join them
        var nL = r.stops.length - 1, doneL = 0;
        prog(0.6, 'Routing each leg (0 of ' + nL + ')');
        var legs = await Promise.all(r.stops.slice(0, -1).map(function (_, i) {
          return routeLeg(r, i).then(function (x) { doneL++; prog(0.6 + 0.3 * doneL / nL, 'Routing each leg (' + doneL + ' of ' + nL + ')'); return x; });
        }));
        r.legs = legs;
        rebuildAlts();
        rawRoute = alts[0];
        model = T.buildRoute(rawRoute, carModel());
        ensureLimits(model);
        LG.info('route', 'Route ready (' + nL + ' legs, each routed on its own)', { legs: legs.map(function (L) { return { options: L.alts.map(function (a) { return a.description; }), picked: L.sel }; }), miles: Math.round(model.totalMi) });
      } else {
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
        var res = await routesCall(body);
        if (res.error) { LG.error('route', 'Routes failed', res.error); throw new Error(res.error); }
        prog(0.9, 'Reading the route');
        LG.trace('route', 'Routes answer', res.body);
        var j = JSON.parse(res.body);
        if (!j.routes || !j.routes.length) throw new Error('Google found no driving route for that trip.');
        alts = j.routes;
        if (!body.intermediates.length) await allMapsRoutes(r, body);
        var picked = pickedRoute(r);
        altSure = false;
        if (picked && alts.length > 1) { var mt = matchRoute(alts, picked); altSel = mt.index; altSure = mt.sure; }
        else altSel = r.routeIndex != null && r.routeIndex < alts.length ? r.routeIndex : 0;
        rawRoute = alts[altSel];
        model = T.buildRoute(rawRoute, carModel());
        ensureLimits(model);
        LG.info('route', 'Route ready', { options: alts.map(function (a) { return a.description; }), picked: altSel, sure: altSure, miles: Math.round(model.totalMi) });
      }
    } catch (e) {
      LG.error('route', e.message || String(e));
      toastMsg(e.message || String(e));
    }
    busy = false; routing = false; freshRoutes = false;
    progEnd();
    renderInfo();
  }
  function carModel() { return Garage.carModel(); }

  // ---------- every route option Google Maps shows ----------
  // The Routes API often returns fewer alternatives than the Maps app. So: read the options from Google Maps itself
  // (the hidden Maps page, no lookup), and for any option the Routes API didn't return, ask for it again with a
  // pass-through point pushed off to one side of the main route until the answer matches that option's length/roads.
  function roadTokens(x) {
    var out = [], re = /\b(I|US|SR|[A-Z]{2})[-\s]?(\d{1,3}[A-Z]?)\b/gi, m;
    while ((m = re.exec(String(x || '')))) out.push(m[1].toUpperCase().replace(/^SR$/, 'ST') + m[2].toUpperCase());
    return out;
  }
  function nameSim(a, b) {
    var ta = roadTokens(a), tb = roadTokens(b);
    if (!ta.length || !tb.length) return null;
    var common = ta.filter(function (t) { return tb.indexOf(t) >= 0; }).length;
    return common / Math.max(ta.length, tb.length);
  }
  function altMiles(a) { return (a.distanceMeters || 0) / 1609.344; }
  function altMinutes(a) { return parseFloat(String(a.duration || '0')) / 60; }
  function sameAsMaps(a, m) {
    if (!m.miles) return false;
    var dmi = Math.abs(altMiles(a) - m.miles) / m.miles, ns = nameSim(a.description, m.via);
    // Maps and the Routes API sometimes name the same road differently ("via I-71 N" vs "I-64 E"): a near-identical
    // length and time means the same route even when the names disagree
    if (dmi <= 0.004 && (!m.minutes || Math.abs(altMinutes(a) - m.minutes) / m.minutes <= 0.08)) return true;
    if (ns != null) return ns >= 0.99 && dmi <= 0.03;
    return dmi <= 0.02 && (!m.minutes || Math.abs(altMinutes(a) - m.minutes) / m.minutes <= 0.06);
  }
  /** Share of route b's points that lie within 2 miles of route a (1 = same road all the way). */
  function overlap(a, b) {
    var pa = decoded(a), pb = decoded(b);
    var stepA = Math.max(1, Math.floor(pa.length / 400)), stepB = Math.max(1, Math.floor(pb.length / 60)), near = 0, n = 0;
    for (var i = 0; i < pb.length; i += stepB) {
      n++;
      for (var k = 0; k < pa.length; k += stepA) if (T.hav(pb[i], pa[k]) < 2) { near++; break; }
    }
    return n ? near / n : 0;
  }
  var scanning = {};     // Google Maps route scans in progress, by address (so a leg is never scanned twice at once)
  async function mapsOptions(r) {
    if (r.mapsRoutes && r.mapsRoutes.length && r.mapsRoutes[0].pts) return r.mapsRoutes;
    if (r.stops.length !== 2 || r.stops.some(function (s) { return s.current; })) return r.mapsRoutes || null;
    // exact spots when known: Google Maps on a desktop page sometimes "can't find" a street-only name from a phone link
    var place = function (s) { return s.lat != null ? s.lat.toFixed(7) + ',' + s.lng.toFixed(7) : (s.address || s.label); };
    var url = 'https://www.google.com/maps/dir/' + encodeURIComponent(place(r.stops[0])) + '/' + encodeURIComponent(place(r.stops[1])) + '/';
    var o = A.KV.get('mapsopts', url, 2 * 3600e3), g;
    if (o) g = o.v;
    else {
      if (!scanning[url]) scanning[url] = openInGoogleMaps(url).then(function (x) { if (x && x.routes && x.routes.length) A.KV.put('mapsopts', url, x); delete scanning[url]; return x; });
      g = await scanning[url];
    }
    dbg.mapsOptionsPage = g && { href: g.href, title: g.title, error: g.error, routes: (g.routes || []).map(function (x) { return { via: x.via, miles: x.miles, minutes: x.minutes, pts: x.pts ? x.pts.length : 0 }; }) };
    LG.info('route', 'Google Maps route options', dbg.mapsOptionsPage);
    if (g && g.routes && g.routes.length) r.mapsRoutes = g.routes;
    return r.mapsRoutes || null;
  }
  /** A route's points, decoded once (long trips have 100,000+). */
  function decoded(a) {
    if (!a._pts) try { Object.defineProperty(a, '_pts', { value: T.decodePolyline(a.polyline.encodedPolyline), enumerable: false }); } catch (e) { a._pts = T.decodePolyline(a.polyline.encodedPolyline); }
    return a._pts;
  }
  /** Share of Maps' turn points that lie within 1.5 miles of a Routes API route (1 = the same route). */
  function onRoute(a, pts) {
    var pa = decoded(a), step = Math.max(1, Math.floor(pa.length / 1500)), near = 0;
    pts.forEach(function (p) {
      var q = { lat: p[0], lng: p[1] };
      for (var k = 0; k < pa.length; k += step) if (T.hav(q, pa[k]) < 1.5) { near++; break; }
    });
    return pts.length ? near / pts.length : 0;
  }
  async function allMapsRoutes(r, body, cx) {
    cx = cx || { get alts() { return alts; }, set alts(v) { alts = v; } };
    var mr = await mapsOptions(r);
    if (!mr || !mr.length) return;
    var same = function (a, m) { return m.pts && m.pts.length > 5 ? onRoute(a, m.pts) >= 0.9 : sameAsMaps(a, m); };
    var missing = mr.filter(function (m) { return !cx.alts.some(function (a) { return same(a, m); }); });
    dbg.mapsMissing = missing.map(function (m) { return m.via; });
    if (missing.length) {
      LG.info('route', 'Google Maps shows ' + mr.length + ' routes; the Routes API returned ' + cx.alts.length + '. Rebuilding: ' + missing.map(function (m) { return m.via; }).join(' / '));
      prog(0.8, 'Getting the other Google Maps routes');
      var found = await Promise.all(missing.map(async function (m) {
        if (m.pts && m.pts.length > 5) {
          // pass through 8 of Maps' own turn points, spread along the route -> Google returns that same route
          var pts = m.pts.slice(2, -2), via = [];
          for (var k = 1; k <= 8; k++) { var p = pts[Math.round(k * (pts.length - 1) / 9)]; if (p) via.push({ via: true, location: { latLng: { latitude: p[0], longitude: p[1] } } }); }
          var b2 = Object.assign({}, body, { intermediates: via }); delete b2.computeAlternativeRoutes;
          var res = await routesCall(b2);
          var cand = !res.error && (JSON.parse(res.body).routes || [])[0];
          var ok = cand && onRoute(cand, m.pts) >= 0.85 && (!m.miles || Math.abs(altMiles(cand) - m.miles) / m.miles <= 0.04);
          LG.debug('route', 'Rebuilt via ' + m.via, { ok: !!ok, error: res.error, miles: cand && Math.round(altMiles(cand)), mapsMiles: m.miles, onRoute: cand && Math.round(onRoute(cand, m.pts) * 100) / 100 });
          if (ok) return { m: m, a: cand };
        }
        var c2 = await searchVia(m, body, cx);
        return c2 ? { m: m, a: c2 } : null;
      }));
      found.forEach(function (f) { if (f) { f.a.description = f.m.via.replace(/^via\s+/i, ''); f.a.fromMaps = true; cx.alts.push(f.a); } });
      LG.info('route', 'Rebuilt ' + found.filter(Boolean).length + ' of ' + missing.length + ' missing Google Maps route(s)');
    }
    orderLikeMaps(mr, same, cx);
  }
  /** Fallback when Maps' turn points aren't available: nudge a pass-through point to either side of the main route. */
  async function searchVia(m, body, cx) {
    var base = T.buildRoute(cx.alts[0], carModel()), L = base.totalMi, tries = 0, found = null;
    var plan = [[0.5, 60], [0.5, -60], [0.5, 130], [0.5, -130], [0.35, 90], [0.35, -90], [0.65, 90], [0.65, -90], [0.5, 220], [0.5, -220]];
    for (var t = 0; t < plan.length && !found; t++) {
      var f = plan[t][0], off = plan[t][1], d = f * L;
      var p = base.pointAt(d), a = base.pointAt(Math.max(0, d - 15)), b = base.pointAt(Math.min(L, d + 15));
      var dx = (b.lng - a.lng) * Math.cos(p.lat * Math.PI / 180), dy = b.lat - a.lat, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      var via = { latitude: p.lat + ny * off / 69, longitude: p.lng + nx * off / (69 * Math.cos(p.lat * Math.PI / 180)) };
      var b2 = Object.assign({}, body, { intermediates: [{ via: true, location: { latLng: via } }] });
      delete b2.computeAlternativeRoutes;
      tries++;
      var res = await routesCall(b2);
      if (res.error) { LG.warn('route', 'Pass-through route failed', res.error); continue; }
      var cand = (JSON.parse(res.body).routes || [])[0];
      if (!cand) continue;
      var dup = cx.alts.some(function (x) { return overlap(x, cand) > 0.9; });
      LG.debug('route', 'Pass-through try ' + tries, { miles: Math.round(altMiles(cand)), dup: dup, target: m.via });
      if (!dup && sameAsMaps(cand, m)) found = cand;
    }
    dbg.passThroughLookups = (dbg.passThroughLookups || 0) + tries;
    return found;
  }
  /** Routes API call, saved for a day (same request -> same route). */
  async function routesCall(body) {
    var key = JSON.stringify(body), o = !freshRoutes && A.KV.get('routes2', key, 24 * 3600e3);
    if (o) return o.v;
    var res = await call('computeRoute', S.apiKey, key);
    if (!res.error) A.KV.put('routes2', key, res);
    return res;
  }
  /** Put the options in the same order as Google Maps (so “route option 2” means the same thing). */
  function orderLikeMaps(mr, same, cx) {
    same = same || sameAsMaps;
    var left = cx.alts.slice(), out = [];
    mr.forEach(function (m) {
      var k = -1; left.forEach(function (a, i) { if (k < 0 && same(a, m)) k = i; });
      if (k >= 0) { var a = left.splice(k, 1)[0]; a.description = m.via.replace(/^via\s+/i, ''); out.push(a); }   // name it the way Maps does
    });
    cx.alts = out.concat(left);
  }
  function official(k) { return (k === 'walmart' || k === 'murphy') && A.siteOn(k); }
  function googleBrands() {
    return Object.keys(P.BRANDS).filter(function (k) { return S.brands[k] && !official(k); });
  }
  function estLookups() {
    if (!model || !S.apiKey || KIND() !== 'gas') return 0;
    var n = T.chunks(model, 125).length;
    altCompareList().forEach(function (k) { n += Math.max(1, Math.ceil((alts[k].distanceMeters || 0) / 1609.344 / 125)); });
    return n * googleBrands().length;
  }
  function renderInfo(keepMaps) {
    routeGate();
    var el = $('tRouteInfo'); if (!el) return;
    var keepEls = {};
    if (keepMaps) Object.keys(rmaps).forEach(function (id) { var c = rmaps[id].getContainer(); if (c && el.contains(c)) keepEls[id] = c; });
    if (!model) { el.innerHTML = ''; alts = []; return; }
    var need = model.galTo(model.totalMi);
    var est = estLookups(), left = (Number(S.monthlyCap) || 0) - N.callsThisMonth();
    var h = '<div class="card route-card">';
    var legView = multiLeg(route) && route.legs && route.legs.length === route.stops.length - 1 && route.legs.every(function (L) { return L.alts; });
    if (legView) {
      h += '<div class="sub-h">Pick a route for each leg</div>';
      route.legs.forEach(function (L, i) {
        h += '<div class="leg-pick"><div class="leg-pick-h"><span class="leg-n">' + (i + 1) + '</span>' + arrowHtml(legName(route, i)) + '</div>' +
          (L.alts.length > 1 ? '<div class="rmap" id="tRmap' + i + '"></div>' : '') + '<div class="alts-pick">' + L.alts.map(function (a, k) {
            var mi = (a.distanceMeters || 0) / 1609.344, sec = parseFloat(String(a.duration || '0'));
            return '<button data-leg="' + i + '" data-lk="' + k + '" class="' + (k === L.sel ? 'on' : '') + '"><b>' + (a.description ? 'via ' + esc(a.description) : 'Route ' + (k + 1)) + '</b>' +
              '<span>' + Math.round(mi) + ' mi · ' + fmtDur(sec) + (L.alts.length === 1 ? ' · Google\'s only route' : '') + '</span></button>';
          }).join('') + '</div></div>';
      });
    } else if (alts.length > 1) {
      h += '<div class="sub-h">Pick a route</div>' +
        '<div class="rmap" id="tRmap"></div><div class="alts-pick">' + alts.map(function (a, k) {
        var mi = (a.distanceMeters || 0) / 1609.344, sec = parseFloat(String(a.duration || '0'));
        return '<button data-alt="' + k + '" class="' + (k === altSel ? 'on' : '') + '"><b>' + (a.description ? 'via ' + esc(a.description) : 'Route ' + (k + 1)) + '</b>' +
          '<span>' + Math.round(mi) + ' mi · ' + fmtDur(sec) + (k === altSel && pickedRoute(route) ? (altSure ? ' · ✓ same as in Google Maps' : ' · closest to what you picked') : (!pickedRoute(route) && route && route.routeIndex === k ? ' · matches your link' : '')) + '</span></button>';
      }).join('') + '</div>';
    }
    h += limBar(model, 'Speed limits', true);
    var nOther = altCompareList().length;
    h += A.gAttr('in-card') + '<div class="lead small">Finding stations: ' + (est ? 'about ' + est + ' Google lookups' + (nOther ? ' (your route + ' + nOther + ' other' + (nOther === 1 ? '' : 's') + ')' : '') : 'no Google lookups') + '.</div></div>';
    el.innerHTML = h;
    el.querySelectorAll('[data-alt]').forEach(function (b) { b.onclick = function () { pickAlt(+b.dataset.alt); }; });
    el.querySelectorAll('[data-leg]').forEach(function (b) { b.onclick = function () { pickLeg(+b.dataset.leg, +b.dataset.lk); }; });
    var lineOf = function (a) { return { pts: thinAlt(a), time: fmtDur(parseFloat(String(a.duration || '0'))), miles: Math.round((a.distanceMeters || 0) / 1609.344).toLocaleString() + ' mi' }; };
    // a map whose options didn't change is moved over as it is (just re-highlighted); the rest are drawn
    var todo = [];
    var put = function (id, list, sel, onPick) {
      var ph = $(id); if (!ph) return;
      var m0 = rmaps[id];
      if (keepEls[id] && m0 && m0._nLines === list.length && m0._alts === list[0]) { ph.replaceWith(keepEls[id]); m0._onPick = onPick; todo.push(function () { m0._setSel(sel); }); }
      else todo.push(function () { var m = optionsMap($(id), list.map(lineOf), sel, onPick); if (m) m._alts = list[0]; });
    };
    if (legView) route.legs.forEach(function (L, i) { put('tRmap' + i, L.alts, L.sel, function (k) { pickLeg(i, k); }); });
    put('tRmap', alts, altSel, pickAlt);
    todo.forEach(function (f) { f(); });
  }
  /** A tap on a route option: highlighted at once; its route (long ones take a moment) is read right after. */
  var picking = false;
  async function pickAlt(k) {
    if (k === altSel || picking || busy) return;
    altSel = k; rawRoute = alts[altSel];
    document.querySelectorAll('#tRouteInfo [data-alt]').forEach(function (b) { b.classList.toggle('on', +b.dataset.alt === k); });
    var rm = rmaps.tRmap, ld = rm && rm._setSel ? (rm._setSel(k), A.loader(rm.getContainer(), 'Loading this route')) : null;
    picking = true;
    await paint();
    try { model = T.buildRoute(rawRoute, carModel()); ensureLimits(model); result = null; } finally { picking = false; if (ld) ld.done(); }
    rememberSel();
    renderInfo(true);
  }
  /** A saved trip keeps the route(s) you picked last, so reopening it comes back to them. */
  function rememberSel() {
    try {
      if (!route) return;
      var id = histId(route), o = A.KV.get('trips', 'trip|' + id); if (!o || !o.v || !o.v.alts) return;
      var v = o.v; v.savedT = v.savedT || o.t;
      if (route.legs && v.route && v.route.legs) v.route.legs = route.legs.map(function (L) { return { alts: L.alts, sel: L.sel }; });
      if (alts.length === v.alts.length) { v.altSel = altSel; v.altSure = altSure; }
      if (route.legs) v.alts = alts;
      A.KV.put('trips', 'trip|' + id, v);
    } catch (e) { LG.warn('history', 'Couldn\'t remember the route pick', String(e)); }
  }
  // ---------- route options on a small map (like Google Maps) ----------
  var rmaps = {};        // one small map per element (a trip with stops in between has one per leg)
  var ROUTE_GRAY = '#8a94a6';
  /** lines: [{pts: [[lat,lng],...], time, miles, via}]; sel: index; onPick(k). */
  function optionsMap(el, lines, sel, onPick) {
    var mid0 = el && el.id || '';
    Object.keys(rmaps).forEach(function (k) {
      var m0 = rmaps[k];
      if (k === mid0 || !document.body.contains(m0.getContainer())) { try { m0.remove(); } catch (e) { } delete rmaps[k]; }
    });
    if (!el || !lines.length) return;
    var rmap = rmaps[mid0] = L.map(el, { zoomControl: false, attributionControl: true, tap: false, scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'osm-tiles', attribution: '© OpenStreetMap' }).addTo(rmap);
    var all = [], tips = [], segs = {}, order = lines.map(function (_, k) { return k; }).filter(function (k) { return k !== sel; }).concat([sel]);   // chosen one drawn on top
    rmap._onPick = onPick;
    order.forEach(function (k) {
      var ln = lines[k]; if (!ln || !ln.pts || ln.pts.length < 2) return;
      var on = k === sel;
      var halo = L.polyline(ln.pts, { color: '#ffffff', weight: on ? 9 : 7, opacity: 0.95, interactive: false }).addTo(rmap);
      var line = L.polyline(ln.pts, { color: on ? '#1a73e8' : ROUTE_GRAY, weight: on ? 6 : 5, opacity: 1 }).addTo(rmap);
      var hit = L.polyline(ln.pts, { color: '#000', weight: 22, opacity: 0.001 }).addTo(rmap).on('click', function () { rmap._onPick(k); });   // easier to tap
      line.on('click', function () { rmap._onPick(k); });
      segs[k] = { halo: halo, line: line, hit: hit };
      var cands = labelSpots(lines, k), mid = cands[0];
      tips.push({ k: k, cands: cands, tip: null, color: on ? '#1a73e8' : ROUTE_GRAY });
      var tip = tips[tips.length - 1].tip = L.tooltip({ permanent: true, direction: 'top', offset: [0, -9], className: 'rlabel' + (on ? ' on' : ''), interactive: true })
        .setLatLng(mid).setContent('<div class="rl" data-opt="' + k + '"><b>' + esc(ln.time) + '</b><span>' + esc(ln.miles) + '</span></div>').addTo(rmap);
      all = all.concat(ln.pts);
    });
    rmap._nLines = lines.length;
    /** Highlight another option in place (no redraw): blue and on top, the rest gray. */
    rmap._setSel = function (k2) {
      sel = k2;
      Object.keys(segs).forEach(function (k) {
        var on = +k === sel, sg = segs[k];
        sg.halo.setStyle({ weight: on ? 9 : 7 }); sg.line.setStyle({ color: on ? '#1a73e8' : ROUTE_GRAY, weight: on ? 6 : 5 });
      });
      if (segs[sel]) { segs[sel].halo.bringToFront(); segs[sel].line.bringToFront(); }
      Object.keys(segs).forEach(function (k) { segs[k].hit.bringToFront(); });
      tips.forEach(function (t) { var e = t.tip.getElement(); if (e) e.classList.toggle('on', t.k === sel); t.color = t.k === sel ? '#1a73e8' : ROUTE_GRAY; });
      placeLabels(rmap, tips, sel, lines, null, { leaders: rmap._leaders, maxCands: 12, angles: 16, dists: [10, 24, 44, 70] });
    };
    rmap.attributionControl.setPrefix(false);
    // tapping a time/miles label picks that route too
    el.onclick = null; el.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-opt]'); if (t) { e.stopPropagation(); rmap._onPick(+t.dataset.opt); } }, true);
    var a = lines[0].pts[0], b = lines[0].pts[lines[0].pts.length - 1];
    var mk = function (p, t) { L.marker(p, { icon: L.divIcon({ className: 'pin', html: '<div class="tend">' + t + '</div>', iconSize: null }), interactive: false }).addTo(rmap); };
    mk(a, 'A'); mk(b, 'B');
    rmap.fitBounds(L.latLngBounds(all), { paddingTopLeft: [36, 58], paddingBottomRight: [36, 30] });
    rmap._leaders = L.layerGroup().addTo(rmap);
    setTimeout(function () { if (rmaps[mid0] === rmap) { rmap.invalidateSize(); rmap._refit(); placeLabels(rmap, tips, sel, lines, null, { leaders: rmap._leaders, maxCands: 12, angles: 16, dists: [10, 24, 44, 70] }); } }, 60);
    rmap.on('zoomend moveend', function () { placeLabels(rmap, tips, sel, lines, null, { leaders: rmap._leaders, maxCands: 12, angles: 16, dists: [10, 24, 44, 70] }); });
    var fb = document.createElement('button'); fb.className = 'fab-fit rmap-fit'; fb.type = 'button'; fb.setAttribute('aria-label', 'Show every route');
    fb.innerHTML = FIT_ICON + '<span>Route</span>'; fb.classList.add('hidden');
    // like the big map: the button shows once you move this map yourself, and goes away when it has re-centered
    var auto = false;
    rmap._refit = function () { auto = true; rmap.fitBounds(L.latLngBounds(all), { paddingTopLeft: [36, 58], paddingBottomRight: [36, 30] }); setTimeout(function () { auto = false; }, 400); fb.classList.add('hidden'); };
    rmap.on('dragstart', function () { fb.classList.remove('hidden'); });
    rmap.on('zoomstart', function () { if (!auto) fb.classList.remove('hidden'); });
    L.DomEvent.disableClickPropagation(fb);
    fb.onclick = function (e) { e.preventDefault(); e.stopPropagation(); rmap._refit(); };
    el.appendChild(fb);
    return rmap;
  }
  /** Candidate label spots on a route, best first: points far from the other routes (where it splits off), like Google Maps. */
  function labelSpots(lines, k) {
    var me = lines[k].pts, n = me.length, out = [], others = [];
    lines.forEach(function (ln, j) { if (j !== k && ln.pts) { var st = Math.max(1, Math.floor(ln.pts.length / 120)); for (var i = 0; i < ln.pts.length; i += st) others.push(ln.pts[i]); } });
    var st2 = Math.max(1, Math.floor(n / 60));
    for (var i = Math.floor(n * 0.12); i < n * 0.88; i += st2) {
      var p = me[i], d = Infinity;
      for (var o = 0; o < others.length; o++) { var dd = T.hav({ lat: p[0], lng: p[1] }, { lat: others[o][0], lng: others[o][1] }); if (dd < d) d = dd; }
      out.push({ p: p, d: d });
    }
    out.sort(function (a, b) { return b.d - a.d; });
    return out.length ? out.map(function (x) { return x.p; }) : [me[Math.floor(n / 2)]];
  }
  /**
   * Route labels as speech bubbles beside their route (like Google Maps): the tail points at the route, and each bubble
   * goes where it covers the least of any route line and no other bubble — so every option stays visible.
   */
  function placeLabels(m, tips, sel, lines, obst, extra) {
    var size = m.getSize(), o = (obst || []).slice();
    // keep labels out from under the Route button (top right) and the map credits
    var fbEl = m.getContainer().querySelector('.rmap-fit');
    if (fbEl && fbEl.offsetWidth) o.push({ x: size.x - fbEl.offsetWidth - 14, y: 0, w: fbEl.offsetWidth + 14, h: fbEl.offsetHeight + 12 });
    o = o.concat(Labels.rectsOf(m, [m.getContainer().querySelector('.leaflet-control-attribution')], 4));
    var list = tips.slice().sort(function (a, b) { return (b.k === sel) - (a.k === sel); });
    Labels.place(m, list, Object.assign({ lines: lines, obst: o, hide: !!obst }, extra || {}));
  }
  function thinAlt(a) {
    var pts = decoded(a), out = [], step = Math.max(1, Math.floor(pts.length / 1500));
    for (var i = 0; i < pts.length; i += step) out.push([pts[i].lat, pts[i].lng]);
    var l = pts[pts.length - 1]; out.push([l.lat, l.lng]);
    return out;
  }
  function toastMsg(m) { if (window.toast) window.toast(m); }
  /** A light tick for each step of the buffer and detour sliders (and the fuel gauge): the app's only haptics for now. */
  function tick() { if (N.tick) N.tick(); }

  // ---------- step 2: stations along the route ----------
  /**
   * Stations along one or more routes with your price at each — everything at once: Google's along-route lookups
   * (run in parallel natively), Murphy USA and Walmart's own sites (a few requests at a time), all started together.
   * Answers already found for the same stretch are reused (saved searches) unless force, or older than staleHours.
   * pg(frac 0..1, label). Returns { per: [{cands, notes, unpriced, stale, grade}] per model, cachedAgeMs }.
   */
  // ---------- which Exxon / Mobil stations take Walmart+ ----------
  // ExxonMobil's own station finder tags each participating station "Walmart+" (free; no Google lookups). Stations
  // are checked a half-degree square at a time (busy squares are split so nothing is cut off), and each square's
  // answer is saved for a week. A station it lists without the tag loses the Walmart+ discount; one it can't match
  // keeps it. CITGO has no such public list, so CITGO prices say the discount isn't confirmed.
  var XOM_CELL = 0.5, XOM_DAYS = 7;
  function xomUrl(b) {
    return 'https://www.exxon.com/en/api/locator/Locations?Latitude1=' + b[0].toFixed(3) + '&Latitude2=' + b[1].toFixed(3) +
      '&Longitude1=' + b[2].toFixed(3) + '&Longitude2=' + b[3].toFixed(3) + '&DataSource=RetailGasStations&Country=US&Customsort=False';
  }
  async function xomBox(b, depth) {
    var res = await call('fetchJson', xomUrl(b));
    if (res.error || !res.body) throw new Error(res.error || 'no answer');
    var j = JSON.parse(String(res.body).replace(/[\u0000-\u001f]/g, ' '));
    var list = (j.Locations || []).map(function (x) {
      var tags = (x.StoreAmenities || []).concat(x.FeaturedItems || []);
      return [+x.Latitude, +x.Longitude, tags.some(function (a) { return a && /walmart/i.test(a.Name || a.Title || ''); }) ? 1 : 0, String(x.DisplayName || x.LocationName || '').slice(0, 60)];
    });
    if (list.length >= 100 && depth < 3) {          // the finder caps its answer: split the square and ask again
      var mLat = (b[0] + b[1]) / 2, mLng = (b[2] + b[3]) / 2, out = [];
      var parts = await Promise.all([[b[0], mLat, b[2], mLng], [b[0], mLat, mLng, b[3]], [mLat, b[1], b[2], mLng], [mLat, b[1], mLng, b[3]]].map(function (q) { return xomBox(q, depth + 1); }));
      parts.forEach(function (p) { out = out.concat(p); });
      return out;
    }
    return list;
  }
  var xomPending = {};
  function xomCell(k) {
    var o = A.KV.get('xom', k, XOM_DAYS * 24 * 3600e3); if (o) return Promise.resolve(o.v);
    if (xomPending[k]) return xomPending[k];
    var ij = k.split(':').map(Number), m = 0.01;
    var b = [ij[0] * XOM_CELL - m, (ij[0] + 1) * XOM_CELL + m, ij[1] * XOM_CELL - m, (ij[1] + 1) * XOM_CELL + m];
    return (xomPending[k] = xomBox(b, 0).then(function (list) { A.KV.put('xom', k, list); delete xomPending[k]; return list; },
      function (e) { delete xomPending[k]; LG.warn('stations', 'ExxonMobil station finder', String(e)); return null; }));
  }
  /** Mark each Exxon / Mobil station: wplus true (listed with Walmart+), false (listed without), or unknown. -> how many changed. */
  async function xomCheck(list) {
    if (S.xomCheck === false || !list || !list.length) return 0;
    var cells = {};
    list.forEach(function (s) {
      if ((s.brand !== 'exxon' && s.brand !== 'mobil') || s.lat == null) return;
      var k = Math.floor(s.lat / XOM_CELL) + ':' + Math.floor(s.lng / XOM_CELL);
      (cells[k] = cells[k] || []).push(s);
    });
    var changed = 0, t0 = Date.now(), not = 0;
    await Promise.all(Object.keys(cells).map(async function (k) {
      var locs = await xomCell(k); if (!locs) return;
      cells[k].forEach(function (s) {
        var best = null, bd = 1e9;
        locs.forEach(function (l) { var d = P.haversineMi(s.lat, s.lng, l[0], l[1]); if (d < bd) { bd = d; best = l; } });
        var v = best && bd <= 0.2 ? !!best[2] : undefined;
        if (best && bd <= 0.2 && best[3]) s.altName = best[3];   // the station's own name in ExxonMobil's finder
        if (v === false) not++;
        if (s.wplus !== v) { s.wplus = v; changed++; }
      });
    }));
    if (Object.keys(cells).length) LG.info('stations', 'Walmart+ at Exxon/Mobil checked', { squares: Object.keys(cells).length, notInProgram: not, ms: Date.now() - t0 });
    return changed;
  }
  window.__xom = xomCheck;

  /** EV / fuel-cell car: chargers or hydrogen stations near each route (DOE station finder) instead of gas prices. */
  function chargeMin(p) { return p.stops.reduce(function (a, s) { return a + (s.c.kw ? s.buyGal / s.c.kw * 60 : 0); }, 0); }
  async function gatherAlt(models, pg, dbgS) {
    var kd = KIND(), c = Garage.car(), plugs = kd === 'ev' ? Garage.plugs(c) : null, corridor = kd === 'ev' ? 2 : 8;
    var price = kd === 'ev' ? (+S.evPrice || 0.48) : (+S.h2Price || 36), tv = kd === 'ev' ? (+S.trip.timeValue > 0 ? +S.trip.timeValue : 20) : 0;
    var notes = [], per = [], raw = [];
    dbgS.started = new Date().toISOString(); dbgS.kind = kd;
    for (var mi = 0; mi < models.length; mi++) {
      var list = [], m = models[mi];
      try { list = await AltFuel.alongRoute(m, kd, plugs, corridor, function (f) { pg((mi + f) / models.length, kd === 'ev' ? 'Finding fast chargers' : 'Finding hydrogen stations'); }); }
      catch (e) { if (notes.indexOf(e.message) < 0) notes.push(e.message); LG.warn('stations', e.message); }
      raw.push(list);
      var cands = [];
      for (var si = 0; si < list.length; si++) {
        var st = list[si], prs = T.projectLegs(m, { lat: st.lat, lng: st.lng }, corridor + 1);
        for (var pi = 0; pi < prs.length; pi++) {
          var pr = prs[pi], det = 2 * pr.offset * 1.3 + (pr.offset > 0.15 ? 0.2 : 0), kw = kd === 'ev' ? AltFuel.avgKw(st, c) : 0;
          cands.push({ id: pr.leg ? st.id + '@' + pr.leg : st.id, d: pr.along, offset: pr.offset, detourMi: det, detourMin: det < 0.15 ? 0 : det / 25 * 60 + 1, detourExact: false,
            price: price, kw: kw, timeCost: kw ? tv / kw : 0, station: st, lat: st.lat, lng: st.lng, leg: pr.leg,
            calc: { base: price, final: price, est: false, stale: false, updated: null, notes: [],
              steps: [{ label: (kd === 'ev' ? 'Your fast-charging price' : 'Your hydrogen price') + ' (Settings → EV & hydrogen)', kind: 'base', amount: price }] } });
        }
      }
      if (kd === 'ev') {      // chargers a few miles apart are near-twins: keep the fastest in each 3-mile stretch
        var bins = {};
        cands.forEach(function (x) { var b = (x.leg || 0) + ':' + Math.floor(x.d / 3); if (!bins[b] || x.kw > bins[b].kw || (x.kw === bins[b].kw && x.detourMi < bins[b].detourMi)) bins[b] = x; });
        cands = Object.keys(bins).map(function (b) { return bins[b]; });
      }
      per.push({ cands: cands, notes: notes, unpriced: 0, stale: 0, grade: Garage.grade(), unpricedCands: [] });
    }
    if (kd === 'ev' && !(+S.trip.timeValue > 0)) notes.push('Charging time is counted at $20/hr so faster chargers win ties — set what your time is worth in Parameters → More options.');
    if (kd === 'ev') notes.push('Prices are your estimate (Settings → EV & hydrogen); most chargers don\'t publish theirs to the station finder.');
    dbgS.stations = raw.map(function (l) { return l.length; });
    pg(1, 'Choosing stops');
    return { per: per, cachedAgeMs: 0, raw: { official: [], google: raw, kind: kd } };
  }
  async function gatherAll(models, pg, dbgS, force, replay, ks) {
    if (KIND() !== 'gas') return gatherAlt(models, pg, dbgS);
    var KV = A.KV, notes = [], official = [], siteOk = [], perModel = models.map(function () { return []; });
    if (replay) {
      // a saved trip: the stations (with their prices) it found then — no lookups at all
      official = (replay.official || []).slice();
      perModel = (ks || []).map(function (k) {
        var sg = altSig(alts[k]), hit = (replay.google || []).filter(function (g) { return g.sig ? g.sig === sg : g.k === k; })[0];
        if (hit) return hit.list.slice();
        // a route it didn't check then: every station it found, with Google's exact detours dropped (they were for another route)
        var all = []; (replay.google || []).forEach(function (g) { g.list.forEach(function (st) { var c = Object.assign({}, st); delete c.detourExact; delete c.detourMi; all.push(c); }); });
        return all;
      });
      while (perModel.length < models.length) perModel.push([]);
    }
    var maxAge = force || S.alwaysRefresh ? 0 : (Number(S.staleHours) || 24) * 3600e3, oldest = 0, saved = 0;
    var use = function (o) { if (!o) return null; oldest = Math.max(oldest, Date.now() - o.t); saved++; return o.v; };
    var getKV = function (ns, key, age) { return age ? KV.get(ns, key, age) : null; };
    var part = { google: 0, murphy: 0, walmart: 0 }, weight = { google: 0, murphy: 0, walmart: 0 }, label = 'Finding stations';
    var tick = function () {
      var tw = weight.google + weight.murphy + weight.walmart;
      pg(tw ? (part.google * weight.google + part.murphy * weight.murphy + part.walmart * weight.walmart) / tw : 1, label);
    };
    var dbgSearch = dbgS; dbgSearch.started = new Date().toISOString();
    var maxOff = 3;
    var nearAny = function (lat, lng) { return models.some(function (m) { return T.project(m, { lat: lat, lng: lng }).offset <= maxOff; }); };
    var ptsUnion = function (gap) {
      var seen = {}, out = [];
      models.forEach(function (m) { T.samplePoints(m, gap).forEach(function (p) { var k = p.lat.toFixed(2) + ',' + p.lng.toFixed(2); if (!seen[k]) { seen[k] = 1; out.push(p); } }); });
      return out;
    };
    if (!replay) try {
      // --- Google, along each route ---
      var jobs = [], skippedBack = 0;
      if (S.apiKey) {
        var gb = googleBrands();
        models.forEach(function (m, mi) {
          T.chunks(m, 125).forEach(function (ch, ci) {
            if (T.coveredBefore(m, ch)) { skippedBack++; return; }   // the way back on roads already searched on the way out
            gb.forEach(function (b) { jobs.push({ q: P.BRANDS[b].query, polyline: ch.polyline, lat: ch.start.lat, lng: ch.start.lng, chunk: ci, fromMi: ch.fromMi, toMi: ch.toMi, m: mi }); });
          });
        });
      }
      var todo = [], done = [];
      jobs.forEach(function (j, i) {
        var o = getKV('along', j.q + '|' + j.polyline, maxAge);
        if (o) done.push({ job: i, results: use(o) }); else todo.push(i);
      });
      var takeGoogle = function (job, r) {
        (r.places || []).forEach(function (pl, k) {
          var st = P.normalize(pl); if (!st || !S.brands[st.brand]) return;
          var sum = r.routingSummaries && r.routingSummaries[k];
          if (sum && sum.legs && sum.legs.length >= 2 && job.toMi != null) {
            // Google's road distance through the station minus the route's own distance for that piece = the detour.
            // (Travel times come from two different Google services, so minutes are derived from miles instead.)
            var mi = (sum.legs[0].distanceMeters + sum.legs[1].distanceMeters) / 1609.344 - (job.toMi - job.fromMi);
            if (mi > -0.5 && mi < 30) { st.detourMi = Math.max(0, mi); st.detourExact = true; st.detourRange = [job.fromMi, job.toMi]; }
          }
          perModel[job.m].push(st);
        });
      };
      done.forEach(function (d) { d.results.forEach(function (r) { takeGoogle(jobs[d.job], r); }); });
      var tasks = [];
      if (todo.length) weight.google = 0.55;
      if (A.siteOn('murphy')) weight.murphy = 0.15;
      if (A.siteOn('walmart')) weight.walmart = 0.3;
      dbgSearch.googleLookups = todo.length; dbgSearch.googleSaved = done.length; dbgSearch.skippedWayBack = skippedBack;
      if (skippedBack) LG.info('stations', skippedBack + ' search piece(s) on the way back skipped — same roads as the way out');
      LG.info('stations', 'Searching along ' + models.length + ' route(s)', { googleLookups: todo.length, saved: done.length, walmart: A.siteOn('walmart'), murphy: A.siteOn('murphy'), force: !maxAge });
      if (todo.length) {
        var send = todo.map(function (i) { return jobs[i]; });
        tasks.push(callP(function (d, t) { part.google = t ? d / t : 0; tick(); }, 'routeSearch', S.apiKey, JSON.stringify(send), Number(S.monthlyCap) || 0).then(function (res) {
          part.google = 1; tick();
          dbgSearch.google = { results: (res.results || []).length, errors: res.errors, places: (res.results || []).reduce(function (a, x) { return a + (x.places || []).length; }, 0) };
          LG.info('stations', 'Google along-route search done', dbgSearch.google);
          (res.errors || []).forEach(function (e) { notes.push(e); LG.warn('stations', e); });
          var byJob = {};
          (res.results || []).forEach(function (r) { (byJob[r.job] = byJob[r.job] || []).push(r); });
          var failed = (res.errors || []).join(' | ');
          send.forEach(function (job, k) {
            var list = byJob[k] || [];
            list.forEach(function (r) { takeGoogle(job, r); });
            // save every finished lookup, empty ones too (nothing there is an answer); skip ones that errored
            if (list.length || failed.indexOf(job.q + ':') < 0 && !/cap reached/i.test(failed))
              KV.put('along', job.q + '|' + job.polyline, list.map(function (r) { return { places: r.places, routingSummaries: r.routingSummaries }; }));
          });
        }));
      }
      // --- Murphy USA (their store finder), one pass for all routes ---
      if (A.siteOn('murphy')) {
        var mpts = ptsUnion(50), mkey = mpts.map(function (p) { return p.lat.toFixed(2) + ',' + p.lng.toFixed(2); }).join(';');
        var mo = getKV('murphy', mkey, maxAge);
        var takeMurphy = function (stores) { (stores || []).forEach(function (m) { var s = P.normalizeMurphy(m); if (s) official.push(s); }); };
        if (mo) { takeMurphy(use(mo)); part.murphy = 1; }
        else tasks.push(site('murphy', { points: mpts, radiusMi: 30, max: 25 }, 120000, function (d, t) { part.murphy = t ? d / t : 0; tick(); }).then(function (res) {
          part.murphy = 1; tick();
          dbgSearch.murphy = { stores: (res.stores || []).length, error: res.error, blocked: res.blocked };
          LG.info('stations', 'Murphy USA done', dbgSearch.murphy);
          if (res.error) notes.push('Murphy USA: ' + (res.blocked ? 'wants an “are you human?” check (Settings → Site checks)' : res.error));
          else { KV.put('murphy', mkey, res.stores || []); siteOk.push('Murphy USA'); }
          takeMurphy(res.stores);
        }));
      }
      // --- Walmart: which stores have fuel (kept a month), then today's prices for the ones near a route ---
      if (A.siteOn('walmart')) tasks.push((async function () {
        var wpts = ptsUnion(40), wkey = wpts.map(function (p) { return p.lat.toFixed(2) + ',' + p.lng.toFixed(2); }).join(';');
        var no = KV.get('wmnodes', wkey, 30 * 24 * 3600e3), nodes;
        if (no) nodes = no.v;
        else {
          var res = await site('walmart', { mode: 'nodes', points: wpts, radiusMi: 25 }, 120000, function (d, t) { part.walmart = t ? 0.4 * d / t : 0; tick(); });
          dbgSearch.walmartNodes = { nodes: (res.nodes || []).length, error: res.error, blocked: res.blocked };
          LG.info('stations', 'Walmart stores along the route', dbgSearch.walmartNodes);
          if (res.error || res.blocked) { part.walmart = 1; tick(); notes.push('Walmart: ' + (res.blocked ? 'wants a “Robot or human?” check (Settings → Site checks)' : res.error)); return; }
          nodes = res.nodes || [];
          KV.put('wmnodes', wkey, nodes);
        }
        part.walmart = 0.4; tick();
        var near = nodes.filter(function (n) { return n.geoPoint && nearAny(n.geoPoint.latitude, n.geoPoint.longitude); });
        var ask = [];
        near.forEach(function (n) { var o = getKV('wmprice', String(n.id), maxAge); if (o) { var w = P.normalizeWalmart(use(o)); if (w) official.push(w); } else ask.push(n); });
        if (!ask.length) { part.walmart = 1; tick(); return; }
        label = 'Reading Walmart prices';
        var pr = await site('walmart', { mode: 'prices', nodes: ask }, 120000, function (d, t) { part.walmart = 0.4 + (t ? 0.6 * d / t : 0); tick(); });
        part.walmart = 1; tick();
        dbgSearch.walmartPrices = { asked: ask.length, saved: near.length - ask.length, got: (pr.stores || []).length, blocked: pr.blocked, error: pr.error };
        LG.info('stations', 'Walmart prices', dbgSearch.walmartPrices);
        if (pr.blocked) notes.push('Walmart: wants a “Robot or human?” check for some prices (Settings → Site checks)');
        (pr.stores || []).forEach(function (w) { KV.put('wmprice', String(w.id), w); var s = P.normalizeWalmart(w); if (s) official.push(s); });
        if ((pr.stores || []).length) siteOk.unshift('Walmart');
      })());
      tick();
      await Promise.all(tasks);
      // past the Google lookup cap: say which brands were still updated (their own sites don't use Google lookups)
      notes = notes.map(function (n) { return /cap reached/i.test(n) ? A.capMsg(n, siteOk) : n; });
    } catch (e) { notes.push(String(e && e.message || e)); LG.error('stations', String(e && e.message || e)); }
    dbgSearch.savedPieces = saved; dbgSearch.oldestSavedMin = Math.round(oldest / 60000);

    // Exxon / Mobil stations that aren't in the Walmart+ program lose that discount
    try { var allSt = official.slice(); perModel.forEach(function (l) { allSt = allSt.concat(l); }); await xomCheck(allSt); } catch (e) { LG.warn('stations', 'Walmart+ check', String(e)); }
    var grade = gradeOf(), per = [], t0 = Date.now(), nowD = new Date(), goD = departAt();
    for (var mi = 0; mi < models.length; mi++) {
      var model = models[mi];
      var merged = P.mergeOfficial(dedupe(perModel[mi]), official), cands = [], unpriced = 0, stale = 0, unp = [];
      var mkCand = function (s, pr, price, calc, extra) {
        var est = 2 * pr.offset * 1.3 + (pr.offset > 0.15 ? 0.2 : 0);
        // trust Google's detour unless it's wildly off from the straight-line estimate (then the piece was routed differently),
        // and only on the stretch it was measured for (not on the way back)
        var exact = s.detourExact && s.detourMi <= est * 3 + 2 && (!s.detourRange || (pr.along >= s.detourRange[0] - 1 && pr.along <= s.detourRange[1] + 1));
        var det = exact ? s.detourMi : est;
        var detMin = det < 0.15 ? 0 : det / 25 * 60 + 1;   // side roads ~25 mph, plus getting off and back on
        return Object.assign({ id: pr.leg ? s.id + '@' + pr.leg : s.id, d: pr.along, offset: pr.offset, detourMi: det, detourMin: detMin, detourExact: exact,
          price: price, calc: calc, station: s, lat: s.lat, lng: s.lng, leg: pr.leg }, extra || {});
      };
      for (var si = 0; si < merged.length; si++) {
        if (si % 150 === 149) await new Promise(function (r) { setTimeout(r, 0); });   // let the screen breathe on big trips
        var s = merged[si];
        // once per leg it's near: on a round trip over the same roads a station is passed going and coming back
        var prs = T.projectLegs(model, { lat: s.lat, lng: s.lng }, maxOff);
        for (var pi = 0; pi < prs.length; pi++) {
          var pr = prs[pi];
          var c = P.compute(s, grade, S, nowD, new Date(goD.getTime() + pr.along / (model.totalMi || 1) * model.durationSec * 1000));   // day-based bonuses go by when you'll be there
          if (!c) { if (!pi) { unpriced++; unp.push({ s: s, prs: prs }); } break; }
          if (c.stale && !pi) stale++;
          cands.push(mkCand(s, pr, c.final, c));
        }
      }
      // no posted price: kept aside at an estimated price (typical on this route + 10¢), and only planned in where no
      // priced station is in reach (a $3 penalty per stop keeps them out otherwise)
      var unpricedCands = [];
      if (cands.length && unp.length) {
        var ps = cands.map(function (c) { return c.price; }).sort(function (a, b) { return a - b; });
        var estP = Math.round((ps[Math.floor(ps.length / 2)] + 0.10) * 1000) / 1000;
        unp.forEach(function (u) {
          u.prs.forEach(function (pr) {
            unpricedCands.push(mkCand(u.s, pr, estP, { base: estP, final: estP, est: true, stale: false, updated: null,
              steps: [{ label: 'No posted ' + P.GRADES[grade].label.toLowerCase() + ' price — estimated (typical on this route + 10¢)', kind: 'base', amount: estP }],
              notes: ['No price is posted for this station. It\'s only a stop because nothing with a price is in reach here.'] }, { est: true, penalty: 3 }));
          });
        });
      }
      per.push({ cands: cands, notes: notes, unpriced: unpriced, stale: stale, grade: grade, unpricedCands: unpricedCands });
    }
    LG.debug('stations', 'Matched stations to ' + models.length + ' route(s) in ' + (Date.now() - t0) + ' ms', per.map(function (x) { return x.cands.length; }));
    return { per: per, cachedAgeMs: saved ? oldest : 0, raw: { official: official, google: perModel } };
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
    if (alts[k]._sel && route.legs) route.legs.forEach(function (L, i) { L.sel = alts[k]._sel[i]; });   // that leg's pick changes too
    recompute(); startSweep(); showResult();
  }
  function routeBox() {
    var cs = compareRoutes(); if (!cs.length) return '';
    var h = '', best = cs.filter(function (c) { return c.worth; })[0];
    var dmi = function (v) { return Math.abs(v) < 0.5 ? 'same distance' : Math.round(Math.abs(v)) + ' mi ' + (v > 0 ? 'longer' : 'shorter'); };
    var dmin = function (v) { return Math.abs(v) < 1 ? 'about the same time' : Math.round(Math.abs(v)) + ' min ' + (v > 0 ? 'longer' : 'shorter'); };
    if (best) {
      h += '<div class="routebox good"><div class="tb-h">Cheaper route: via ' + esc(best.via) + '</div>' +
        '<div class="lead small keep">' + (best.saves != null ? 'Saves about <b>' + money(best.saves) + '</b>' : 'Works with your buffer when this one doesn\'t') + ' · ' + dmi(best.extraMi) + ' · ' + dmin(best.extraMin) +
        ' · ' + best.stops + ' stop' + (best.stops === 1 ? '' : 's') + (S.trip.timeValue > 0 ? ' (your time counted)' : '') + '.</div>' +
        '<button class="btn tonal" data-route="' + best.k + '">Switch to this route</button></div>';
    }
    var rest = cs.filter(function (c) { return c !== best; });
    if (rest.length) h += '<div class="lead small keep">Also checked: ' + rest.map(function (c) {
      if (c.error) return 'via ' + esc(c.via) + ' (couldn\'t check: ' + esc(c.error) + ')';
      if (!c.ok) return 'via ' + esc(c.via) + ' (no plan keeps your buffer)';
      return 'via ' + esc(c.via) + ' — ' + (c.saves > 0.005 ? 'saves only ' + money(c.saves) + ' (your bar is ' + money(S.trip.altMinSave) + ')' : money(-c.saves) + ' more') + ', ' + dmin(c.extraMin) +
        ' · <a href="#" data-route="' + c.k + '">use this route</a>';
    }).join('; ') + '.</div>';
    return h;
  }

  // ---------- cruising speed per leg ----------
  var limCache = {};          // one lookup per route shape, shared by every model built from it
  function ensureLimits(m) {
    if (!m || (m._lim && m._lim !== 'loading')) return;
    var sig = m.pts.length + ':' + m.totalMi.toFixed(3) + ':' + m.pts[0].lat.toFixed(5);
    var hit = limCache[sig];
    if (hit) {
      if (hit.res) { m._lim = hit.res; return; }
      m._lim = 'loading';
      if (!hit.waiting.includes(m)) hit.waiting.push(m);
      return;
    }
    hit = limCache[sig] = { res: null, waiting: [m] };
    m._lim = 'loading';
    var t0 = Date.now();
    var getJson = function (url) {      // posted limits rarely change: saved for 90 days
      var o = A.KV.get('limits', url, 90 * 24 * 3600e3);
      if (o) return Promise.resolve(o.v);
      return call('fetchJson', url).then(function (res) { if (res.body && res.body.indexOf('"error"') < 0) A.KV.put('limits', url, res); return res; });
    };
    Limits.along(m, getJson, { lookup: S.limitLookup !== false, onProg: function (d, t) { hit.frac = Math.max(hit.frac || 0, t ? d / t : 1); limBars(hit.frac, sig); } }).then(function (res) {
      hit.res = res; limBars(1, sig);
      hit.waiting.forEach(function (w) { w._lim = res; });
      if (hit.waiting.indexOf(model) >= 0 && $('tsSpeed')) renderTripSpeed();
      LG.info('speed', 'Speed limits along the route in ' + (Date.now() - t0) + ' ms', res.stats);
      LG.debug('speed', 'Roads', res.roads.map(function (r) { return [r.name, Math.round(r.from), Math.round(r.to), r.pieces.map(function (p) { return p.st + ':' + p.limit + (p.src === 'hpms' ? '' : '(' + p.src + ')'); }).join(' ')]; }));
    }).catch(function (e) { delete limCache[sig]; hit.waiting.forEach(function (w) { w._lim = { roads: [], stats: {}, error: String(e) }; }); LG.error('speed', 'Speed limit lookup failed', String(e)); });
  }
  /** Every "Looking up speed limits" bar on screen. */
  /** The "speed limits" bars for one route (other routes being looked up in the background don't move them). */
  function limBars(f, sig) {
    var pct = Math.round(Math.min(1, f) * 100);
    document.querySelectorAll('.lim-load[data-sig="' + sig + '"]').forEach(function (el) {
      var i = el.querySelector('i'), p = el.querySelector('.pct');
      if (i) i.style.width = pct + '%'; if (p) p.textContent = pct + '%';
      if (pct >= 100 && el.dataset.hideDone) el.classList.add('hidden');
    });
  }
  function limSig(m) { return m ? m.pts.length + ':' + m.totalMi.toFixed(3) + ':' + m.pts[0].lat.toFixed(5) : ''; }
  function limFrac(m) { var sig = limSig(m), h = sig && limCache[sig]; return h ? (h.res ? 1 : h.frac || 0) : 0; }
  function limBar(m, label, hideDone) {
    var pct = Math.round(limFrac(m) * 100);
    return '<div class="parse-load lim-load' + (pct >= 100 && hideDone ? ' hidden' : '') + '" data-sig="' + esc(limSig(m)) + '"' + (hideDone ? ' data-hide-done="1"' : '') + '><span>' + label + '</span><span class="pbar"><i style="width:' + pct + '%"></i></span><span class="pct">' + pct + '%</span></div>';
  }
  function speedLegs() {
    var r = result, p = r.plan; if (!p.ok) return [];
    var pts = [{ name: route.stops[0].current ? 'Start' : (route.stops[0].short || 'Start'), d: 0 }], avg = r.startPrice || p.refPrice, legs = [];
    var stops = p.stops.slice();
    var gal0 = r.startGal;
    stops.forEach(function (s, i) { pts.push({ name: (i + 1) + ' · ' + P.displayName(s.c.station), d: s.c.d, s: s }); });
    var dest = route.stops[route.stops.length - 1];
    pts.push({ name: dest.short || dest.label || 'Destination', d: model.totalMi });
    for (var i = 0; i < pts.length - 1; i++) {
      var s = pts[i].s;
      if (s) { avg = s.departGal > 0 ? (s.arriveGal * avg + s.buyGal * s.c.price) / s.departGal : s.c.price; }
      var next = pts[i + 1].s;
      legs.push({ label: pts[i].name + ' → ' + pts[i + 1].name, toName: pts[i + 1].name, a: pts[i].d, b: pts[i + 1].d, price: avg,
        arriveGal: next ? next.arriveGal : p.arriveGal, needGal: r.opts.bufferGal, mpgMix: 1 / model.combGpm });
    }
    return legs;
  }
  function renderTripSpeed() {
    var el = $('tsSpeed'); if (!el || !result || !result.plan.ok) return;
    ensureLimits(model);
    var legs = speedLegs(), lim = model._lim, st = result.speedState = result.speedState || {};
    var priceAt = function (d) { var L = legs.filter(function (x) { return d >= x.a && d < x.b; })[0] || legs[legs.length - 1]; return L ? L.price : result.startPrice; };
    var roads = lim && lim.roads ? lim.roads.map(function (r) {
      var secs = (r.sections || []).map(function (sec) {
        // the section's miles, split where the gas in the tank changes (at stops), each at the section's limit
        var cuts = [sec.from].concat(legs.map(function (L) { return L.b; }).filter(function (d) { return d > sec.from && d < sec.to; })).concat([sec.to]), pieces = [];
        var lim0 = S.speed.truck && sec.truck ? Math.min(sec.limit, sec.truck) : sec.limit;   // "keep me as slow as the trucks"
        for (var k = 0; k < cuts.length - 1; k++) pieces.push({ from: cuts[k], to: cuts[k + 1], mi: cuts[k + 1] - cuts[k], limit: lim0, price: priceAt((cuts[k] + cuts[k + 1]) / 2) });
        return Object.assign({}, sec, { limit: lim0, posted: sec.limit, pieces: pieces });
      });
      return Object.assign({}, r, { sections: secs });
    }) : [];
    Garage.tripSpeed(el, { model: model, roads: roads, legs: legs, stats: lim && lim.stats, loading: !lim || lim === 'loading', loadingHtml: limBar(model, 'Looking up speed limits'), state: st, guard: speedGuard(),
      onEditRule: function () { collectSafe(); step = ST_PARAMS; renderStep(); setTimeout(function () { var f = $('tRule') && $('tRule').closest('.field'); if (f) { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); f.classList.add('pulse'); setTimeout(function () { f.classList.remove('pulse'); }, 1900); } }, 60); },
      onToggle: function (open) { sheetSize(); if (open) tpBody().scrollTop = 0; roadSelSoon(); },
      onTruck: function () { renderTripSpeed(); replan(); } });   // the truck limits change every road's limit: redraw and plan again
    if (!el._selObs) { el._selObs = new MutationObserver(roadSelSoon); el._selObs.observe(el, { childList: true }); }
    roadSelSoon();
    // first time the speeds are known (speed limits just arrived, or your rule): plan the stops at those speeds
    var cx0 = speedCx();
    if (cx0 && result.planOffs == null) {
      result.planOffs = cx0.offs.join(',');
      if (cx0.offs.some(function (v) { return v; })) { replan(); return; }
    }
    if (result.sweep) refreshBufBox();      // the buffer's gray area depends on these speeds
  }


  // ---------- buffer <-> cruising speed ----------
  // Stops are planned at the speeds you choose (extra gas for driving faster counted on every stretch), so you always
  // arrive at a station — and at the end — with at least your buffer. Faster speeds or a bigger buffer both need the
  // stations closer together, so each can rule out the other: with "let the sliders adjust each other" off, the
  // slider stops at the gray; with it on, a bigger buffer slows you down (all roads, or the fastest roads first, down
  // to your limit under the posted speed) and faster speeds lower the buffer.
  function linked() { return S.trip.linkSliders !== false; }
  function floorOff() { return -Math.max(0, Math.min(10, S.trip.maxUnder != null ? +S.trip.maxUnder : 5)); }
  /** Every posted-limit section of the route's major roads, in order ("keep me as slow as the trucks" applied). */
  function flatSecs(m) {
    var lim = m && m._lim, out = [];
    if (!lim || lim === 'loading' || !lim.roads) return out;
    lim.roads.forEach(function (r) { (r.sections || []).forEach(function (sec) {
      out.push({ from: sec.from, to: sec.to, limit: S.speed.truck && sec.truck ? Math.min(sec.limit, sec.truck) : sec.limit, cls: r.cls });
    }); });
    return out;
  }
  function speedCx() {
    var r = result; if (!r || !window.Garage || !Garage.speedFn) return null;
    var secs = flatSecs(model); if (!secs.length) return null;
    var sf = Garage.speedFn(); if (!sf) return null;
    var st = r.speedState = r.speedState || {}; st.offsets = st.offsets || {};
    var offs = secs.map(function (sc, i) { return st.offsets[i] != null ? st.offsets[i] : Garage.ruleOff(sc.limit); });
    return { secs: secs, st: st, offs: offs, f: sf.f, lo: sf.lo, hi: sf.hi };
  }
  function ratesOf(cx, offs) { return T.speedRates(cx.secs, offs, cx.f, cx.lo, cx.hi); }
  /** Plan options on the plain model at buffer mi (for the quick "is there any plan" check). */
  function baseOpts(mi) {
    var o = Object.assign({}, result.opts, { model: model });
    if (mi != null) { o.bufferGal = mi * model.combGpm; o.arriveGal = mi * model.combGpm; }
    return o;
  }
  function canDo(mi, cx, offs) { return T.reachable(baseOpts(mi), ratesOf(cx, offs)); }
  /** The planner's own answer (a quick plan) — used to confirm before the app changes your speeds or buffer for you. */
  function planOk(mi, cx, offs) {
    var o = Object.assign(baseOpts(mi), { model: T.withSpeeds(model, ratesOf(cx, offs)), lite: true });
    return T.plan(o).ok;
  }
  function smallestBuf() { var sw = result.sweep; return sw && sw.length ? sw[0].mi : 5; }
  function slowFor(mi, cx, offs) {
    return T.slowDown({ secs: cx.secs, offsets: offs, all: cx.st.all || 0, mode: S.trip.slowMode === 'fastest' ? 'fastest' : 'all', floor: floorOff(), ruleOff: Garage.ruleOff,
      ok: function (o) { return canDo(mi, cx, o) && planOk(mi, cx, o); },
      failing: function () { return [{ a: 0, b: model.totalMi }]; } });
  }
  /** Can the buffer slider go to this row? (rows are planned at your speeds; linked: after slowing as far as you allow) */
  function bufOk(x, cx) {
    if (!x) return false;
    if (x.ok) return true;
    cx = cx === undefined ? speedCx() : cx;
    return !!(cx && linked() && slowFor(x.mi, cx, cx.offs));
  }
  /** Highest offset that still has a plan — at this buffer, or (linked) at the smallest buffer. Binary search. */
  function maxOffset(cx, set) {
    var mi = linked() ? smallestBuf() : result.bufMi, lo = set(null), hi = 15;
    if (!canDo(mi, cx, set(lo))) return lo;
    while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (canDo(mi, cx, set(mid))) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function speedGuard() {
    return {
      maxFor: function (i, offs) {
        var cx = speedCx(); if (!cx) return 15;
        return maxOffset(cx, function (v) { if (v == null) return offs[i]; var o = offs.slice(); o[i] = v; return o; });
      },
      maxAll: function () {
        var cx = speedCx(); if (!cx) return 15;
        var cur = cx.st.all || 0;
        return maxOffset(cx, function (v) { if (v == null) return cur; return cx.secs.map(function (sc) { return Garage.ruleOff(sc.limit, v); }); });
      },
      notes: function (mx, road) { return speedNotes(mx, road); },
      release: function () {
        // re-plan the stops at the new speeds; too fast for this buffer -> (linked) the largest smaller buffer that works
        var cx = speedCx(), r = result; if (!cx) return;
        if (canDo(r.bufMi, cx, cx.offs)) { replan(); return; }
        if (!linked()) { replan(); return; }
        var mis = []; for (var v = r.bufMi - 1; v >= smallestBuf(); v--) mis.push(v);
        var to = mis.filter(function (v) { return canDo(v, cx, cx.offs) && planOk(v, cx, cx.offs); })[0];
        if (to == null) { replan(); return; }
        LG.info('plan', 'Faster speeds: buffer ' + r.bufMi + ' → ' + to + ' mi');
        toastMsg('Buffer lowered to ' + to + ' mi — the stations are too far apart for a bigger one at these speeds.');
        replan(to);
      }
    };
  }
  /** Re-plan the stops at the current speeds (and buffer mi, if given): totals, buffer slider and all. */
  function replan(mi) {
    var r = result, cx = speedCx(); if (!r || !r.opts) return false;
    var o = Object.assign({}, r.opts, { model: cx ? T.withSpeeds(model, ratesOf(cx, cx.offs)) : model, lite: false });
    if (mi != null) { o.bufferGal = mi * model.combGpm; o.arriveGal = mi * model.combGpm; }
    var p = T.plan(o);
    if (!p.ok) { LG.warn('plan', 'No plan at these speeds', { buffer: mi != null ? mi : r.bufMi }); toastMsg('No plan works at those speeds with this buffer.'); return false; }
    r.plan = p; r.opts = o; if (mi != null) r.bufMi = mi; r.topSel = -1; r.sweep = null; r.dsweep = null; r.planOffs = cx ? cx.offs.join(',') : '';
    recompute(); startSweep(); keepScroll(showResult);
    return true;
  }
  /** The buffer the speeds allow, as warnings: "keeps this at N mi or less". */
  function bufLimits() {
    var r = result, cx = speedCx(), sw = r && r.sweep;
    if (!cx || !sw) return null;
    var any = cx.offs.some(function (v) { return v > 0; });
    var allowed = sw.filter(function (x) { return bufOk(x, cx); });
    var maxAllowed = allowed.length ? allowed[allowed.length - 1].mi : null;
    // only blame the speeds when at the limits a bigger buffer would work
    var atLim = cx.secs.map(function () { return 0; });
    var maxAtLimit = null; sw.forEach(function (x) { if (canDo(x.mi, cx, atLim)) maxAtLimit = x.mi; });
    return { maxBuf: any && maxAllowed != null && maxAtLimit != null && maxAllowed < maxAtLimit ? maxAllowed : null, cx: cx };
  }
  function offTxt(v) { return v === 0 ? 'at the limit' : (v > 0 ? '+' : '−') + Math.abs(v) + ' mph'; }
  function capTxt(v) { return v === 0 ? 'at or below the limit' : 'at ' + offTxt(v) + ' or less'; }
  function speedNotes(mx, road) {
    var out = [], b = bufLimits();
    if (b && b.maxBuf != null) out.push('⚠ This speed keeps your buffer at ' + b.maxBuf + ' mi or less' + (linked() ? ', even slowing other roads as far as you allow' : '') + '.');
    if (mx < 15) out.push(linked() ? '⚠ Even the smallest buffer can\'t cover going faster than ' + offTxt(mx) + ' here — the stations are too far apart.' : '⚠ Your ' + result.bufMi + '-mi buffer keeps this ' + capTxt(mx) + '.');
    return out;
  }
  function refreshBufBox() { if ($('tsBufBox')) { var y = tpBody().scrollTop; $('tsBufBox').outerHTML = bufBox(); bindBuf(); tpBody().scrollTop = y; } }
  /** Switch the trip to this buffer (the slider's quick plan -> the full one). */
  function setBuffer(x) {
    var r = result;
    var fo = Object.assign({}, x.opts, { lite: false }); r.plan = T.plan(fo); r.opts = fo; r.bufMi = x.mi; r.topSel = -1; r.dsweep = null;
    recompute(); keepScroll(showResult);
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
    setTimeout(function next() {
      if (result !== r) { r.sweeping = false; return; }
      var end = Date.now() + 40;
      while (i < list.length && Date.now() < end) rows.push(T.bufferSweep(r.opts, [list[i++]], r.opts.refPrice)[0]);
      if (i < list.length) return setTimeout(next, 0);
      r.sweep = T.marks(rows); r.sweeping = false;
      LG.debug('plan', 'Buffer sweep in ' + (Date.now() - t0) + ' ms', rows.map(function (x) { return x.mi + ':' + (x.net == null ? '-' : x.net.toFixed(2)) + (x.mark ? '*' : ''); }).join(' '));
      if (result === r && $('tsBufBox')) { var el = $('tsBufBox'); el.outerHTML = bufBox(); bindBuf(); if (r.plan.ok && $('tsSpeed')) renderTripSpeed(); }
    }, 300);
  }
  // ---------- how much gas to leave with ----------
  /**
   * Read straight from the plan (so it can never disagree with the stops): when the first stop is at the start of
   * the trip, that's the gas to add before you go; otherwise leave with what you have.
   */
  function idealBox() {
    var r = result, p = r && r.plan; if (!p || !p.ok) return '';
    var m = r.opts.model || model, gpm = m.galTo(m.totalMi) / m.totalMi || model.combGpm;
    var first = p.stops[0], atStart = first && first.c.d <= 5;
    var gal = r.startGal + (atStart ? first.buyGal : 0);
    var help = 'The ' + FW().toLowerCase() + ' to have when you set off, from your plan: if its first stop is by the start (within 5 miles), you ' + (KIND() === 'ev' ? 'charge' : 'buy') + ' that much before you go. Range is at this trip\'s mileage and your speeds.';
    return '<div class="ideal" id="tsIdeal"><div class="ideal-h"><span class="nn sm">1</span>' + FW() + ' to leave with ' + A.qBtn(help) + '</div>' +
      '<div class="ideal-row"><div class="ideal-l"><div class="ideal-big">' + gal.toFixed(1) + ' ' + UN() + '</div><div class="ideal-sub">~' + Math.round(gal / gpm) + ' mi of range</div></div>' +
      '<div class="ideal-r">' + (atStart ? 'Add <b>' + first.buyGal.toFixed(1) + ' ' + UN() + '</b><small>' + esc(P.displayName(first.c.station)) + (first.c.d >= 0.5 ? ' · mile ' + first.c.d.toFixed(1) : '') + '</small>' : '<b>Nothing to add</b><small>leave with what you have</small>') + '</div></div></div>';
  }
  /** Gas in the tank at mile d of the plan (after any stop before it), and the range it gives. */
  function gasAt(d) {
    var r = result, p = r.plan, m = r.opts.model || model, gal = r.startGal, at = 0;
    p.stops.forEach(function (st) { if (st.c.d <= d) { gal = st.departGal; at = st.c.d; } });
    return gal - (m.galTo(d) - m.galTo(at));
  }
  /**
   * One tile per place after the start: the gas you'll have when you get there. Places in between (like the far end of
   * a round trip) say what that gas is enough for; the last one, on a one-way trip, whether it gets you back.
   */
  function arriveBox() {
    var r = result, p = r && r.plan; if (!p || !p.ok) return '';
    var m = r.opts.model || model, gpm = m.galTo(m.totalMi) / m.totalMi || model.combGpm;
    var ends = (model.legEnds || []).slice(0, route.stops.length - 2), h = '', loop = loopTrip(route);
    ends.forEach(function (d, i) {
      var gal = gasAt(d), last = i === ends.length - 1;
      var why = loop && last ? 'Enough for the cheapest return trip' : 'Enough to reach the next fuel stop';
      h += tile(i + 2, FW() + ' at ' + stopName(route.stops[i + 1]), gal, why);
    });
    var galEnd = r.top ? r.top.endGal : p.arriveGal, miEnd = galEnd / gpm;
    var endWhy = loop ? '' : miEnd >= model.totalMi ? 'Enough for the drive back' : '';
    h += tile(route.stops.length, FW() + ' when you arrive', galEnd, endWhy);
    return h;
    function tile(n, title, gal, ok) {
      return '<div class="ideal arr" data-n="' + n + '"><div class="ideal-h"><span class="nn sm">' + n + '</span>' + esc(title) + '</div>' +
        '<div class="ideal-row"><div class="ideal-l"><div class="ideal-big">' + Math.max(0, gal).toFixed(1) + ' ' + UN() + '</div><div class="ideal-sub">~' + Math.round(Math.max(0, gal) / gpm) + ' mi of range</div></div></div>' +
        (ok ? '<div class="ok-line"><span class="okc">✓</span>' + ok + '</div>' : '') + '</div>';
    }
  }
  function swRow(mi) {
    var sw = result.sweep, best = null;
    sw.forEach(function (x) { if (!best || Math.abs(x.mi - mi) < Math.abs(best.mi - mi)) best = x; });
    return best;
  }
  /**
   * Markers on the buffer slider: gray = your usual buffer; green = where the trip gets cheaper than that, yellow =
   * where it costs more. One marker per change in cost (at the buffer nearest your usual one that gets that cost),
   * labeled with the difference, so a run of buffers that all cost the same shows once.
   */
  function bufMarks(sw, base) {
    var out = [], runs = [], prev = null;
    if (!base.ok) return out;
    sw.forEach(function (x) {
      if (!x.ok) { prev = null; return; }
      var d = x.net - base.net, k = Math.abs(d) < 0.05 ? 0 : Math.round(d * 20);    // same cost to within 5¢ = one run
      if (prev && prev.k === k && (prev.mi < base.mi) === (x.mi < base.mi)) prev.rows.push(x);
      else { prev = { k: k, d: d, mi: x.mi, rows: [x] }; runs.push(prev); }
    });
    runs.forEach(function (run) {
      if (!run.k) return;
      var rows = run.rows, below = rows[0].mi < base.mi;
      var x = below ? rows[rows.length - 1] : rows[0];          // the edge nearest your usual buffer
      out.push({ mi: x.mi, d: run.d, kind: run.d < 0 ? 'good' : 'bad', row: x });
    });
    return out;
  }
  /** Room between marker labels on a slider, in % of its width (a label is ~56 px wide). */
  function markGap() { return Math.max(17, 5800 / Math.max(180, innerWidth - 100)); }
  /**
   * Give each marker a label row (up to three; the usual one and the biggest saving go first). A marker that finds no
   * room in any row isn't drawn at all, so every line on the slider says what it saves or costs. -> rows used.
   */
  function placeMarks(all, big, pos) {
    var GAP = markGap(), rows = [[], [], []];
    var free = function (row, L) { return rows[row].every(function (q) { return Math.abs(q - L) >= GAP; }); };
    all.filter(function (m) { return m.kind === 'base' || m === big; }).concat(all.filter(function (m) { return !(m.kind === 'base' || m === big); }))
      .forEach(function (m) { var L = +pos(m.mi); m.lr = free(0, L) ? 0 : free(1, L) ? 1 : free(2, L) ? 2 : -1; if (m.lr >= 0) rows[m.lr].push(L); });
    return rows[2].length ? 3 : 2;
  }
  function markHtml(m, L, attr) {
    if (m.lr < 0) return '';
    var lab = m.kind === 'base' ? 'usual' : (m.d < 0 ? '−' : '+') + money(Math.abs(m.d)).replace(/^[−-]/, '');
    return '<span class="bm ' + m.kind + (m.lr ? ' r' + (m.lr + 1) : '') + '" style="left:' + L + '%" data-snap="' + m.mi + '"' + (m.kind !== 'base' ? ' ' + attr + '="' + m.mi + '"' : '') + '><em>' + lab + '</em><i></i></span>';
  }
  /** The blue part of a buffer / detour slider's track, up to the knob (the slider is drawn by us; see app.css). */
  function fillRange(inp) { var lo = +inp.min, hi = +inp.max; inp.style.setProperty('--p', (hi > lo ? (+inp.value - lo) / (hi - lo) * 100 : 0) + '%'); }
  /** The points a slider's knob snaps to: its drawn marks (green, yellow, usual) and where it is now. */
  function snapPoints(box, cur) {
    var a = Array.prototype.map.call(box.querySelectorAll('.bm[data-snap]'), function (m) { return +m.dataset.snap; });
    if (cur != null && a.indexOf(cur) < 0) a.push(cur);
    return a.sort(function (x, y) { return x - y; });
  }
  function nearest(a, v) { var b = a[0]; a.forEach(function (x) { if (Math.abs(x - v) < Math.abs(b - v)) b = x; }); return b;
  }
  function bufBox() {
    var r = result, sw = r.sweep;
    var h = '<div class="bufbox" id="tsBufBox"><div class="tb-h">Buffer for this trip</div>';
    if (!sw) return h + A.ldBar('Checking other buffers') + '</div>';
    // the buffer's limits depend on your speeds, which depend on the speed limits: wait for them
    if (S.limitLookup !== false && (!model._lim || model._lim === 'loading')) return h + limBar(model, 'Waiting for speed limits') + '</div>';
    var min = sw[0].mi, max = sw[sw.length - 1].mi, cur = swRow(r.bufMi), base = swRow(S.trip.bufferMi);
    if (!base.ok) base = cur;
    var pos = function (mi) { return ((mi - min) / (max - min) * 100).toFixed(2); };
    var bl = bufLimits(), warns = [];
    if (bl && bl.maxBuf != null) warns.push('⚠ Your cruising speeds keep this at ' + bl.maxBuf + ' mi or less' + (linked() ? ', even slowing down as far as you allow (' + (-floorOff()) + ' under the limit)' : '') + '.');
    if (bl && !linked()) {
      var G0 = speedGuard(), st0 = bl.cx.st, at = st0.touched != null && st0.touched !== 'all' && bl.cx.secs[st0.touched] ? st0.touched : 'all';
      var mx0 = at === 'all' ? G0.maxAll() : G0.maxFor(at, bl.cx.offs);
      if (mx0 < 15) warns.push('⚠ This buffer keeps ' + (at === 'all' ? 'All roads' : 'that road (' + bl.cx.secs[at].limit + ' mph limit)') + ' ' + capTxt(mx0) + '.');
    }
    if (warns.length) h += '<div class="spd-warn">' + warns.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>';
    h += '<div class="buf-read"><b id="tsBufVal">' + r.bufMi + ' mi</b> <span id="tsBufCost">' + bufText(cur, base) + '</span></div>';
    var mk = bufMarks(sw, base);
    var all = mk.concat([{ mi: base.mi, kind: 'base' }]).sort(function (a2, b2) { return a2.mi - b2.mi; });
    var big = mk.filter(function (m) { return m.kind === 'good'; }).sort(function (a2, b2) { return a2.d - b2.d; })[0];
    var nRows = placeMarks(all, big, pos);
    h += '<div class="buf-track' + (nRows > 2 ? ' rows3' : '') + '"><div class="buf-marks">';
    all.forEach(function (m) { h += markHtml(m, +pos(m.mi), 'data-bm'); });
    // gray: buffers you can't use (no plan keeps that much, or your speeds would run the tank dry)
    var cx = speedCx(), band = null, bands = [], memo = {};
    for (var v = min; v <= max; v++) {
      var rw = swRow(v), okV = memo[rw.mi] != null ? memo[rw.mi] : (memo[rw.mi] = bufOk(rw, cx));
      if (!okV && !band) { band = { a: v, b: v }; bands.push(band); } else if (!okV) band.b = v; else band = null;
    }
    h += bands.map(function (bd) {
      var a = Math.max(0, (bd.a - 0.5 - min) / (max - min) * 100), b2 = Math.min(100, (bd.b + 0.5 - min) / (max - min) * 100);
      return '<span class="bgray" style="left:' + a.toFixed(2) + '%;width:' + (b2 - a).toFixed(2) + '%"></span>';
    }).join('') + '</div><input type="range" id="tsBuf" min="' + min + '" max="' + max + '" step="1" value="' + r.bufMi + '"></div>';
    h += '<div class="buf-scale"><span>' + min + ' mi</span><span>' + max + ' mi</span></div>';
    if (!cur.ok) {
      var okRows = sw.filter(function (x) { return x.ok; });
      h += '<div class="lead small keep">' + (okRows.length ? 'The highest buffer that works on this trip is ' + okRows[okRows.length - 1].mi + ' mi.' : 'No buffer works — check the miles left.') + '</div>';
    }
    if (r.bufMi !== S.trip.bufferMi) h += '<div class="lead small keep usual-l">Your buffer is different than usual. <a href="#" id="tsBufKeep">Make ' + r.bufMi + ' mi my usual buffer.</a></div>';
    return h + '</div>';
  }
  function bufText(x, base) {
    if (!x.ok) return 'can\'t keep this much — no priced station in reach';
    var dip = x.plan.firstDip ? ' · dips below it before the first stop' : '';
    var n = x.plan.stops.length + ' stop' + (x.plan.stops.length === 1 ? '' : 's') + dip;
    if (x === base || !base.ok) return n + (x === base ? ' · your usual' : '');
    var d = x.net - base.net;
    return (Math.abs(d) < 0.05 ? 'same cost as usual' : d < 0 ? 'saves ' + money(-d) + ' vs. usual' : money(d) + ' more than usual') + ' · ' + n;
  }
  function bindBuf() {
    var inp = $('tsBuf'); if (!inp) return;
    Garage.guardRange(inp); fillRange(inp);
    var r = result, cur = swRow(r.bufMi), base = swRow(S.trip.bufferMi);
    if (!base.ok) base = cur;
    var last = r.bufMi;
    // the knob snaps to the marks (and where it is now); a tick each time it lands on another one
    var snaps = snapPoints($('tsBufBox'), r.bufMi).filter(function (v) { return v === r.bufMi || bufOk(swRow(v)); });
    inp.oninput = function () {
      var v = snaps.length ? nearest(snaps, +inp.value) : +inp.value, x = swRow(v);
      if (!bufOk(x)) { v = last; x = swRow(last); }        // can't slide into the gray
      inp.value = v; fillRange(inp);
      if (v !== last) { tick(); last = v; }
      $('tsBufVal').textContent = x.mi + ' mi'; $('tsBufCost').textContent = bufText(x, base);
    };
    $('tsBufBox').querySelectorAll('[data-bm]').forEach(function (m) { m.onclick = function () { inp.value = m.dataset.bm; inp.oninput(); inp.onchange(); }; });
    inp.onchange = function () {
      var x = swRow(+inp.value);
      if (x.mi === r.bufMi) { inp.value = x.mi; return; }
      LG.info('plan', 'Buffer slider: ' + r.bufMi + ' → ' + x.mi + ' mi', { ok: x.ok, net: x.net });
      if (!bufOk(x)) { inp.value = r.bufMi; fillRange(inp); $('tsBufVal').textContent = r.bufMi + ' mi'; $('tsBufCost').textContent = bufText(cur, base); toastMsg('No plan keeps ' + x.mi + ' mi at your speeds — the stations are too far apart.'); return; }
      var cx = speedCx();
      if (!x.ok && cx) {
        // linked: slow down just enough that a plan keeps this bigger buffer
        var sd = slowFor(x.mi, cx, cx.offs);
        if (sd) {
          sd.offsets.forEach(function (v, i) { cx.st.offsets[i] = v; });
          cx.st.all = sd.all;
          var slowed = sd.offsets.filter(function (v, i) { return v !== cx.offs[i]; }).length;
          LG.info('plan', 'Smaller buffer: slowed ' + slowed + ' road section(s)', { mode: S.trip.slowMode || 'all', all: sd.all });
          toastMsg(S.trip.slowMode === 'fastest' ? 'Slowed the fastest roads so you keep a ' + x.mi + '-mi buffer.' : 'All roads set to ' + offTxt(sd.all) + ' so you keep a ' + x.mi + '-mi buffer.');
          replan(x.mi); return;
        }
      }
      setBuffer(x);
    };
    if ($('tsBufKeep')) $('tsBufKeep').onclick = function (e) { e.preventDefault(); S.trip.bufferMi = r.bufMi; A.save(); keepScroll(showResult); };
  }

  // ---------- max. detour slider ----------
  // Like the buffer slider, for the "Max. extra time" per stop: the same trip re-planned at each limit, with markers
  // where a longer (or shorter) limit makes the trip cheaper — e.g. a station that's only a few minutes farther out on
  // the way back. For this trip only, unless you make it your usual.
  var DET_STEPS = [2, 3, 4, 5, 6, 7.5, 10, 12.5, 15, 20, 25, 30];
  function detMinOf(r) { return r.opts && r.opts.maxDetourMin != null ? +r.opts.maxDetourMin : +S.trip.maxDetourMin; }
  function startDetSweep() {
    var r = result; if (!r || !r.opts || !r.plan || !r.plan.ok || r.dsweep || r.dsweeping || !r.opts.refPrice) return;
    r.dsweeping = true;
    var list = DET_STEPS.slice();
    [+S.trip.maxDetourMin, detMinOf(r)].forEach(function (v) { if (v > 0 && list.indexOf(v) < 0) list.push(v); });
    list.sort(function (a, b) { return a - b; });
    var rows = [], i = 0, tv = function (p) { return (r.opts.timeValue || 0) * (p.totals.detourMin + p.stops.length * (r.opts.stopMinutes || 0)) / 60; };
    setTimeout(function next() {
      if (result !== r) { r.dsweeping = false; return; }
      var end = Date.now() + 40;
      while (i < list.length && Date.now() < end) {
        var m = list[i++], p = T.plan(Object.assign({}, r.opts, { maxDetourMin: m, lite: true }));
        rows.push({ mi: m, ok: p.ok, net: p.ok ? p.totals.net + tv(p) : null, plan: p });
      }
      if (i < list.length) return setTimeout(next, 0);
      r.dsweep = rows; r.dsweeping = false;
      if (result === r && $('tsDetBox')) keepScroll(function () { $('tsDetBox').outerHTML = detBox(); bindDet(); });
    }, 450);
  }
  function detRow(v) { var best = null; (result.dsweep || []).forEach(function (x) { if (!best || Math.abs(x.mi - v) < Math.abs(best.mi - v)) best = x; }); return best; }
  function minTxt(v) { return (Math.round(v * 10) / 10) + ' min'; }
  function detText(x, base) {
    if (!x.ok) return 'no plan works with this limit';
    var n = x.plan.stops.length + ' stop' + (x.plan.stops.length === 1 ? '' : 's');
    if (x === base || !base.ok) return n + (x === base ? ' · your usual' : '');
    var d = x.net - base.net;
    return (Math.abs(d) < 0.05 ? 'same cost as usual' : d < 0 ? 'saves ' + money(-d) + ' vs. usual' : money(d) + ' more than usual') + ' · ' + n;
  }
  function detBox() {
    var r = result, sw = r.dsweep;
    var h = '<div class="bufbox detbox" id="tsDetBox"><div class="tb-h">Max. detour for this trip</div>';
    if (!sw) return h + A.ldBar('Checking other limits') + '</div>';
    var cur = detRow(detMinOf(r)), base = detRow(+S.trip.maxDetourMin);
    if (!base || !base.ok) base = cur;
    var n = sw.length, idx = function (v) { var k = 0; sw.forEach(function (x, i) { if (Math.abs(x.mi - v) < Math.abs(sw[k].mi - v)) k = i; }); return k; };
    var pos = function (v) { return (idx(v) / Math.max(1, n - 1) * 100).toFixed(2); };
    h += '<div class="buf-read"><b id="tsDetVal">' + minTxt(cur.mi) + '</b> <span id="tsDetCost">' + detText(cur, base) + '</span></div>';
    var mk = bufMarks(sw, base);
    var all = mk.concat([{ mi: base.mi, kind: 'base' }]).sort(function (a2, b2) { return a2.mi - b2.mi; });
    var big = mk.filter(function (m) { return m.kind === 'good'; }).sort(function (a2, b2) { return a2.d - b2.d; })[0];
    var nRows = placeMarks(all, big, pos);
    h += '<div class="buf-track' + (nRows > 2 ? ' rows3' : '') + '"><div class="buf-marks">';
    all.forEach(function (m) { h += markHtml(m, pos(m.mi), 'data-dm'); });
    // gray: limits with no workable plan
    var bands = [], band = null;
    sw.forEach(function (x, i) { if (!x.ok && !band) { band = { a: i, b: i }; bands.push(band); } else if (!x.ok) band.b = i; else band = null; });
    h += bands.map(function (bd) {
      var a = Math.max(0, (bd.a - 0.5) / Math.max(1, n - 1) * 100), b2 = Math.min(100, (bd.b + 0.5) / Math.max(1, n - 1) * 100);
      return '<span class="bgray" style="left:' + a.toFixed(2) + '%;width:' + (b2 - a).toFixed(2) + '%"></span>';
    }).join('');
    h += '</div><input type="range" id="tsDet" min="0" max="' + (n - 1) + '" step="1" value="' + idx(cur.mi) + '" aria-label="Max. detour per stop"></div>';
    h += '<div class="buf-scale"><span>' + minTxt(sw[0].mi) + '</span><span>' + minTxt(sw[n - 1].mi) + '</span></div>';
    if (Math.abs(cur.mi - S.trip.maxDetourMin) > 0.01) h += '<div class="lead small keep usual-l">Your max detour is different than usual. <a href="#" id="tsDetKeep">Make ' + minTxt(cur.mi) + ' my usual max detour.</a></div>';
    return h + '</div>';
  }
  function bindDet() {
    var inp = $('tsDet'); if (!inp) return;
    if (Garage.guardRange) Garage.guardRange(inp);
    fillRange(inp);
    var r = result, sw = r.dsweep, base = detRow(+S.trip.maxDetourMin) || detRow(detMinOf(r)), last = +inp.value;
    if (!base.ok) base = detRow(detMinOf(r));
    // the knob snaps to the marks (and where it is now); a tick each time it lands on another one
    var ix = function (mi) { for (var k = 0; k < sw.length; k++) if (Math.abs(sw[k].mi - mi) < 1e-6) return k; return -1; };
    var snaps = snapPoints($('tsDetBox') || inp.closest('.bufbox'), null).map(ix).filter(function (k) { return k >= 0 && sw[k].ok; });
    if (snaps.indexOf(last) < 0) snaps.push(last);
    snaps.sort(function (a2, b2) { return a2 - b2; });
    inp.oninput = function () {
      var k = nearest(snaps, +inp.value), x = sw[k];
      if (!x.ok) { k = last; x = sw[last]; }
      inp.value = k; fillRange(inp);
      if (k !== last) { tick(); last = k; }
      $('tsDetVal').textContent = minTxt(x.mi); $('tsDetCost').textContent = detText(x, base);
    };
    inp.onchange = function () {
      var x = sw[+inp.value]; if (!x || !x.ok || Math.abs(x.mi - detMinOf(r)) < 0.01) return;
      LG.info('plan', 'Max. detour slider: ' + detMinOf(r) + ' → ' + x.mi + ' min', { net: x.net });
      var fo = Object.assign({}, r.opts, { maxDetourMin: x.mi, lite: false });
      r.plan = T.plan(fo); r.opts = fo; r.topSel = -1; r.sweep = null;
      recompute(); startSweep(); keepScroll(showResult);
    };
    $('tsDetBox').querySelectorAll('[data-dm]').forEach(function (m) {
      m.onclick = function () { var k = 0; sw.forEach(function (x, i) { if (Math.abs(x.mi - +m.dataset.dm) < 0.01) k = i; }); inp.value = k; inp.oninput(); inp.onchange(); };
    });
    if ($('tsDetKeep')) $('tsDetKeep').onclick = function (e) { e.preventDefault(); S.trip.maxDetourMin = detMinOf(r); A.save(); keepScroll(showResult); };
  }

  function makeOpts(model, cands, startGal) {
    var kd = KIND(), cap = Garage.tank();
    return { step: kd === 'ev' ? Math.max(0.1, Math.round(cap / 150 * 10) / 10) : kd === 'h2' ? 0.05 : 0.1, fillCap: kd === 'ev' ? cap * 0.8 : null,
      model: model, cands: cands, startGal: startGal, capGal: Garage.tank(), bufferGal: S.trip.bufferMi * model.combGpm,
      arriveGal: S.trip.bufferMi * model.combGpm, fillUp: S.trip.fillUp,
      // arriving with the most gas: a late, cheap fill-up is the point, so the "must save" bar drops to $0.25
      stopPenalty: S.trip.arrive === 'full' ? Math.min(S.trip.minSave, 0.25) : S.trip.minSave,
      detourPenalty: S.trip.arrive === 'full' ? Math.min(S.trip.minSave, 0.25) : S.trip.minSave,
      maxDetourMin: S.trip.maxDetourMin, timeValue: S.trip.timeValue, stopMinutes: kd === 'ev' ? 5 : kd === 'h2' ? 10 : 8,
      lastFull: S.trip.arrive === 'full' };
  }
  function breathe() { return new Promise(function (r) { setTimeout(r, 0); }); }
  var finding = null;   // the stop search under way (a step jump waits for it rather than stopping)
  function findStops(force) {
    if (busy || !model) return finding || Promise.resolve();
    return (finding = findStops1(force).finally(function () { finding = null; }));
  }
  async function findStops1(force) {
    busy = true;
    try { await findStops0(force); } catch (e) { LG.error('plan', e.message || String(e)); toastMsg(e.message || String(e)); result = null; }
    busy = false; progEnd();
    if (!onPlan(step) || !result) mapLoaded();
    if (window.__apiCount) window.__apiCount();
    if (onPlan(step) && !result) renderResults();
  }
  async function findStops0(force) {
    if ($('tsResults')) $('tsResults').innerHTML = skelStops('Finding stations');
    if ($('taResults')) $('taResults').innerHTML = skelAdjust('Finding stations');
    prog(0.01, 'Finding stations');
    LG.info('stations', 'Find the best stops pressed', { miles: Math.round(model.totalMi), points: model.pts.length, force: force === true });
    await new Promise(function (r) { setTimeout(r, 30); });
    var others = altCompareList();
    dbg.search = {};
    var models = [model];
    others.forEach(function (k) { try { models.push(T.buildRoute(alts[k], carModel())); } catch (e) { models.push(null); } });
    var okModels = models.filter(Boolean), okKs = [altSel].concat(others).filter(function (k, i) { return models[i]; });
    var rp = force === true ? null : replay, rpSt = null;
    if (rp && (KIND() !== 'gas' || (rp.stations.kind || 'gas') !== 'gas')) rp = null;   // saved for another kind of car (or EV stations: the finder's own cache covers them)
    if (rp) {
      // which route each saved station list was for (older saves: worked out from the saved route options)
      rpSt = { official: rp.stations.official, google: (rp.stations.google || []).map(function (g) { return Object.assign({}, g, { sig: g.sig || (rp.alts && rp.alts[g.k] ? altSig(rp.alts[g.k]) : '') }); }) };
      if (rp.partial) {
        var have = rpSt.google.map(function (g) { return g.sig; });
        if (!okKs.every(function (k) { return have.indexOf(altSig(alts[k])) >= 0; })) {
          LG.info('stations', 'A different route than the saved trip used — searching it'); rp = null; rpSt = null;
        }
      }
    }
    if (rp) LG.info('stations', 'Using the stations saved with this trip (' + agoText(Date.now() - rp.t) + ') — no lookups');
    var ga = await gatherAll(okModels, function (f, l) { prog(0.02 + f * 0.9, l + (others.length ? ' (' + okModels.length + ' routes)' : '')); }, dbg.search, force === true, rpSt, okKs);
    if (rp) ga.cachedAgeMs = Date.now() - rp.t;
    else { try { saveTrip(ga.raw, okKs); } catch (e) { LG.warn('history', 'Couldn\'t save the trip', String(e)); } }
    var g = ga.per[0];
    var cands = g.cands, notes = g.notes, unpriced = g.unpriced, stale = g.stale, grade = g.grade;
    prog(0.93, 'Choosing stops');
    if (step >= ST_ADJ) mapLoading('Choosing stops', 0.93);
    var startGal = startFuel(model);
    var opts = makeOpts(model, cands, startGal), planOffs = null;
    var secs0 = flatSecs(model), sf0 = secs0.length && Garage.speedFn ? Garage.speedFn() : null;
    if (sf0) {
      var offs0 = secs0.map(function (sc) { return Garage.ruleOff(sc.limit); });
      planOffs = offs0.join(',');
      if (offs0.some(function (v) { return v; })) opts.model = T.withSpeeds(model, T.speedRates(secs0, offs0, sf0.f, sf0.lo, sf0.hi));
    }
    await paint();
    var t0 = Date.now();
    var plan = T.plan(opts), estUsed = 0;
    // nothing priced in reach somewhere (very rural): let stations with no posted price fill the gap, at an estimate
    if ((!plan.ok || plan.firstDip) && g.unpricedCands && g.unpricedCands.length) {
      var oEst = Object.assign({}, opts, { cands: cands.concat(g.unpricedCands) });
      var pEst = T.plan(oEst);
      if (pEst.ok && (!plan.ok || !pEst.firstDip)) {
        plan = pEst; opts = oEst; cands = oEst.cands; estUsed = pEst.stops.filter(function (x) { return x.c.est; }).length;
        LG.info('plan', 'Used ' + estUsed + ' station(s) with no posted price (nothing priced in reach)');
      }
    }
    LG.info('plan', plan.ok ? 'Planned ' + plan.stops.length + ' stop(s) in ' + (Date.now() - t0) + ' ms' : 'No workable plan', {
      candidates: cands.length, unpriced: unpriced, stale: stale, tooFar: plan.tooFar, reachMi: plan.reachMi,
      stops: plan.ok ? plan.stops.map(function (s) { return { name: s.c.station.name, mile: Math.round(s.c.d), price: s.c.price, buy: Math.round(s.buyGal * 10) / 10, why: s.why }; }) : null });
    LG.debug('plan', 'Candidates', cands.map(function (c) { return [c.station.name, Math.round(c.d), c.price, Math.round(c.detourMi * 10) / 10]; }));
    result = { plan: plan, opts: opts, cands: cands, notes: notes, unpriced: unpriced, stale: stale, grade: grade, startGal: startGal,
      topMi: S.trip.topUpMi, topSel: -1, bufMi: S.trip.bufferMi, cachedAgeMs: ga.cachedAgeMs, fromHistory: !!rp, planOffs: planOffs, estUsed: estUsed };
    prog(0.97, 'Drawing the map');
    await paint();
    var t1 = Date.now();
    recompute();
    LG.debug('plan', 'Top-ups, trip cost and drive back in ' + (Date.now() - t1) + ' ms');
    // other routes Google suggested: same trip, same rules, gas valued at the same price so totals compare fairly
    if (others.length) {
      result.routes = [{ k: altSel, model: model, res: result }];
      var gi = 1;
      for (var oi = 0; oi < others.length; oi++) {
        await breathe();
        var k = others[oi], m2 = models[oi + 1];
        if (!m2) { result.routes.push({ k: k, model: model, res: { plan: { ok: false } }, error: 'couldn\'t read that route' }); continue; }
        var g2 = ga.per[gi++];
        var o2 = makeOpts(m2, g2.cands, startGal);
        if (plan.ok) o2.refPrice = plan.refPrice;
        var p2 = T.plan(o2);
        result.routes.push({ k: k, model: m2, res: { plan: p2, opts: o2, cands: g2.cands, notes: g2.notes, unpriced: g2.unpriced, stale: g2.stale, grade: g2.grade,
          startGal: startGal, topMi: S.trip.topUpMi, topSel: -1, bufMi: S.trip.bufferMi, cachedAgeMs: ga.cachedAgeMs } });
      }
      LG.info('routes', 'Other routes checked', compareRoutes().map(function (c) { return { via: c.via, saves: c.saves && Math.round(c.saves * 100) / 100, extraMin: Math.round(c.extraMin), ok: c.ok, worth: c.worth }; }));
    }
    startSweep();
    busy = false;
    progEnd();
    await breathe();
    var t2 = Date.now();
    if (step >= ST_ADJ) showResult();
    LG.debug('plan', 'Results drawn in ' + (Date.now() - t2) + ' ms');
  }
  /** Top-ups, trip cost, and the drive back — cheap to redo when you change the top-up choice. */
  function recompute() {
    var r = result, p = r.plan, o = r.opts;
    r.tops = p.ok && S.trip.arrive === 'full' ? T.topUps(Object.assign({}, o, { cands: p.cands }), p, r.topMi).slice(0, 4) : [];
    if (r.topSel >= r.tops.length) r.topSel = -1;
    var top = r.topSel >= 0 ? r.tops[r.topSel] : null;
    r.top = top;
    if (!p.ok) { r.acc = null; return; }
    var outLeg = { stops: p.stops.map(function (s) { return { arriveGal: s.arriveGal, buyGal: s.buyGal, price: s.c.price }; }), arriveGal: p.arriveGal };
    if (top) { outLeg.stops.push({ arriveGal: top.arriveGal, buyGal: top.buyGal, price: top.c.price }); outLeg.arriveGal = top.endGal; }
    var legs = [outLeg];
    var tp = parseFloat(S.trip.tankPrice);
    r.startPrice = tp > 0 ? tp : p.refPrice;
    r.acc = T.account(r.startGal, r.startPrice, legs);
  }
  function dedupe(list) { var seen = {}; return list.filter(function (s) { if (seen[s.id]) return false; seen[s.id] = 1; return true; }); }

  // ---------- step 3 (Stops): the plan ----------
  /** Redraw whatever step is showing with the current plan. */
  function showResult() {
    document.body.classList.add('trip-on');
    if (onPlan(step) && ($('tsResults') || $('taResults'))) { renderResults(); drawSoon(); }
    else if (step === ST_DEPART) renderStep();
  }
  /** Draw the route and stops once the list is on screen (the map takes a moment on a long trip). */
  function drawSoon() {
    var r0 = result;
    requestAnimationFrame(function () { setTimeout(function () {
      if (result !== r0 || !onPlan(step)) return;
      drawRoute(); fitBtn(); if (!busy) mapLoaded();
    }, 0); });
  }
  var BULB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z"/></svg>';
  function tipBox() {
    return '<div class="tipbox">' + BULB + '<div><b>Tip:</b> A <b>shorter buffer</b> gives you more range, so you can reach cheap stations right off the highway. ' +
      'A <b>longer max detour</b> lets cheaper stations farther off the route count, but only if they save more money than the extra miles cost.</div></div>';
  }
  function renderResults() {
    var el = $('tsResults'), ea = $('taResults'); if (!el && !ea) return;
    var put = function (sh, ah) { if (el) el.innerHTML = sh; if (ea) ea.innerHTML = ah == null ? sh : ah; };
    var r = result;
    [ST_ADJ, ST_STOPS].forEach(function (k) { if (built[k]) { built[k].result = result; built[k].model = model; } });
    if (!r && loadingTrip) { put(skelStops('Opening your trip'), skelAdjust('Opening your trip')); return; }
    if (!r && busy && model) { put(skelStops('Finding stations'), skelAdjust('Finding stations')); return; }
    if (!r) {
      var need = hasFuel();
      put(model ? '<div class="card empty-res">' + (need ? 'Stops appear here.' : 'Say how much is in your tank in Parameters.') + '</div>' : '',
        model ? '<div class="card empty-res">' + (need ? 'Your adjustments appear here once the stops are planned.' : 'Say how much is in your tank in Parameters.') + '</div>' : '');
      return;
    }
    var p = r.plan, h = '', ah = tipBox();
    // warnings first: what could go wrong on this trip
    var w = [];
    if (!p.ok) w.push({ err: 1, t: 'No plan keeps you above a ' + r.bufMi + '-mile buffer. ' + (p.reachMi > 0 ? 'Past mile ' + Math.round(p.reachMi) + ' there\'s no priced station close enough.' : 'There\'s no priced station within your range.') + ' Try a smaller buffer or check the miles left.' });
    if (p.ok && p.firstDip && p.stops.length) w.push({ t: 'You\'ll reach stop 1 below your ' + r.bufMi + '-mile buffer (~' + Math.round(p.stops[0].arriveGal / model.combGpm) + ' mi left).' });
    if (r.estUsed) w.push({ t: r.estUsed + ' stop' + (r.estUsed === 1 ? ' is at a station' : 's are at stations') + ' with no posted price — nothing priced is in reach there. Its price is an estimate (marked est.).' });
    if (r.stale) w.push({ t: r.stale + ' price' + (r.stale === 1 ? ' is' : 's are') + ' over ' + S.staleHours + ' hours old (marked).' });
    r.notes.forEach(function (n) { w.push({ t: n }); });
    var wm = $('wmCheck'); if (wm && !wm.classList.contains('hidden')) w.push({ t: $('wmCheckTitle').textContent + ' before its prices can load.', html: ' <a href="#" id="tsSiteCheck">Open</a>' });
    if (r.cachedAgeMs > 0) w.push({ t: r.fromHistory ? 'Saved trip · prices from ' + agoText(r.cachedAgeMs) + ' (no lookups used).' : 'Prices from ' + agoText(r.cachedAgeMs) + '.', html: ' <a href="#" id="tsRefresh">Get fresh prices</a>', cls: 'saved' });
    var warnHtml = w.length ? '<div class="warns pre">' + w.map(function (x) { return '<div class="' + (x.err ? 'msg err' : 'note') + (x.cls ? ' ' + x.cls : '') + '">' + esc(x.t) + (x.html || '') + '</div>'; }).join('') + '</div>' : '';
    if (!p.ok) {
      h += warnHtml + routeBox();
      ah += '<div class="warns pre"><div class="msg err">' + esc(w[0].t) + '</div></div>' + bufBox();
    } else {
      var t = p.totals;
      h += warnHtml;
      var whyN = r.cands.length + ' priced station' + (r.cands.length === 1 ? '' : 's') + ' along your route' +
        (p.tooFar ? '; ' + p.tooFar + ' more were over ' + S.trip.maxDetourMin + ' min out of the way' : '') +
        (r.unpriced ? '; ' + r.unpriced + ' had no ' + gradeLabel(r.grade).toLowerCase() + ' price' : '') + '. Tap a stop for the cheaper stations it was weighed against.';
      if (p.stops.length) {
        var shut = r.stopsShut !== false;
        h += '<div class="sec-row"><button class="sec-h" id="tsStopsH" aria-expanded="' + !shut + '"><span>' + p.stops.length + ' fuel stop' + (p.stops.length === 1 ? '' : 's') +
          '<small>chosen from ' + r.cands.length.toLocaleString() + ' station' + (r.cands.length === 1 ? '' : 's') + '</small></span><span class="chev' + (shut ? '' : ' up') + '"></span></button>' + A.qBtn(whyN) + '</div>';
        if (!shut) { h += '<div class="stops-list">'; p.stops.forEach(function (s, i) { h += stopCard(s, i); }); h += '</div>'; }
      } else h += '<div class="msg ok">No stop needed — checked ' + r.cands.length.toLocaleString() + ' stations.</div>';
      h += routeBox();
      h += '<div class="gas-tiles">' + idealBox() + arriveBox() + '</div>';
      h += A.gAttr();                                   // the route, and most stations, come from Google
      // Adjustments: the buffer, max. detour and speeds (and the optional top-up)
      ah += bufBox();
      ah += detBox();
      ah += '<div class="spdbox" id="tsSpeed"></div>';
      if (S.trip.arrive === 'full') ah += topUpBox();
    }
    put(h, ah);
    var both = tpBody();
    if ($('tsRefresh')) $('tsRefresh').onclick = function (e) { e.preventDefault(); findStops(true); };
    if ($('tsSiteCheck')) $('tsSiteCheck').onclick = function (e) { e.preventDefault(); $('wmCheckGo').click(); };
    both.querySelectorAll('[data-top]').forEach(function (b) {
      b.onclick = function () { var k = +b.dataset.top; r.topSel = r.topSel === k ? -1 : k; recompute(); keepScroll(showResult); };
    });
    if ($('tsTopMi')) $('tsTopMi').addEventListener('change', function () {
      r.topMi = Math.max(0, Math.round((parseFloat(this.value) || 0) * 10) / 10); S.trip.topUpMi = r.topMi; A.save(); r.topSel = -1; recompute(); keepScroll(showResult);
    });
    both.querySelectorAll('[data-route]').forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); switchRoute(+b.dataset.route); };
    });
    bindBuf(); bindDet();
    if (p.ok) { renderTripSpeed(); startDetSweep(); }
    if ($('tsStopsH')) $('tsStopsH').onclick = function () { r.stopsShut = r.stopsShut === false; keepScroll(showResult); };
    bindStops();
    if (A.qify) { if (el) A.qify(el); if (ea) A.qify(ea); }
    sheetSize();
  }

  // ---------- step 4 (Departure) ----------
  function exports() {
    var r = result, p = r && r.plan; if (!p || !p.ok) return null;
    var fuelStops = p.stops.concat(r.top ? [{ c: r.top.c }] : []);
    return { one: T.exportUrl(route, fuelStops, model), legs: T.exportLegs(route, fuelStops, model) };
  }
  var MAPS_ICON = '<svg viewBox="0 0 24 24"><path d="M21.71 11.29l-9-9a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42l9 9a1 1 0 0 0 1.42 0l9-9a1 1 0 0 0 0-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>';
  var SHARE_ICON = '<svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a3.2 3.2 0 0 0 0-1.39l7.05-4.11A2.99 2.99 0 1 0 15 5c0 .24.04.47.09.7L8.04 9.81a3 3 0 1 0 0 4.38l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z"/></svg>';
  function departureHtml() {
    var r = result; if (!r || !model) return '<div class="card empty-res">Plan your stops first.</div>';
    var p = r.plan;
    var h = '<div class="card dep-route">' + numList(route.stops) + '</div>' +
      // the trip at a glance, as tiles between the places and the costs
      '<div class="kpis dep-facts"><div><b>' + Math.round(model.totalMi).toLocaleString() + '</b><span>miles</span></div>' +
      '<div><b>' + fmtDur(model.durationSec) + '</b><span>driving</span></div>' +
      (p.ok ? '<div><b>' + p.totals.stops + '</b><span>' + (KIND() === 'ev' ? 'charging' : 'fuel') + ' stop' + (p.totals.stops === 1 ? '' : 's') + '</span></div>' : '') +
      (p.ok && KIND() === 'ev' ? '<div><b>' + fmtDur(chargeMin(p) * 60) + '</b><span>charging</span></div>' : '') + '</div>';
    if (!p.ok) return h + '<div class="msg err">No plan works yet — go back to Stops.</div>';
    var t = p.totals, out = r.acc.legs[0];
    var costQ = 'The ' + out.burnGal.toFixed(1) + ' ' + UN() + ' this drive uses: what\'s already in your ' + (KIND() === 'ev' ? 'battery' : 'tank') + ' at ' + priceText(r.startPrice) + '/' + UN() +
      (S.trip.tankPrice ? ' (what you said it cost)' : ' (typical on this route; set yours in Parameters)') + ', plus what you buy at what you pay.';
    var saveQ = 'Compared with filling up at the typical price on this route.' +
      (p.easy && p.savings > 0.005 ? ' The easiest plan (fewest stops, closest to the road) would be ' + money(p.easy.totals.net) + ' net vs. ' + money(t.net) + ' for this one' + (t.detourMin - p.easy.totals.detourMin > 0.5 ? ', which adds ' + Math.round(t.detourMin - p.easy.totals.detourMin) + ' min of detours' : '') + '.' : '') +
      (p.minStops != null && t.stops > p.minStops ? ' You only need ' + p.minStops + ' stop' + (p.minStops === 1 ? '' : 's') + '; the extra one pays for itself with cheaper gas.' : '');
    h += '<div class="kpis four"><div><b>' + money(out.cost) + '</b><span>trip cost ' + A.qBtn(costQ) + '</span></div>' +
      '<div><b>' + money(out.spend) + '</b><span>' + (KIND() === 'ev' ? 'at chargers' : 'at the pump') + '</span></div>' +
      '<div><b class="' + (p.savings > 0.005 ? 'good' : '') + '">' + (p.savings != null && p.savings > 0.005 ? money(p.savings) : '—') + '</b><span>saved ' + A.qBtn(saveQ) + '</span></div>' +
      '<button class="kpi-share" id="tShare" aria-label="Share trip">' + SHARE_ICON + '<span>Share</span></button></div>';
    // only what to watch out for, briefly
    var w = [];
    var fd = futureDepart();
    if (fd) w.push('Leaving ' + fd.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' — prices may change by then.');
    if (route.legs && route.legs.some(function (L) { return L.sel > 0; })) route.legs.forEach(function (L, i) { if (L.sel > 0) w.push('Leg ' + (i + 1) + ': Google Maps may pick other roads — choose via ' + (L.alts[L.sel].description || 'route ' + (L.sel + 1)) + ' there.'); });
    else if (!multiLeg(route) && altSel > 0 && alts[altSel]) w.push('In Google Maps, pick the route via ' + (alts[altSel].description || 'route ' + (altSel + 1)) + '.');
    var av = ['tolls', 'highways', 'ferries'].filter(function (k) { return S.trip.avoid[k]; });
    if (av.length) w.push('Turn “avoid ' + av.join('” and “avoid ') + '” back on in Google Maps.');
    var rn = window.Advisory ? Advisory.departureNote() : '';
    if (rn) w.push(rn);
    if (KIND() === 'h2') w.push('Hydrogen stations go offline often — check each one\'s live status before you count on it.');
    h += '<div class="warns">' + w.map(function (x) { return '<div class="note">' + esc(x) + '</div>'; }).join('') + '</div>';
    h += '<p class="lead small keep center"><a href="#" id="tsReport">Troubleshooting report</a></p>';
    return h;
  }
  function bindDeparture() {
    if ($('tsReport')) $('tsReport').onclick = function (e) { e.preventDefault(); shareReport(e); };
    if ($('tShare')) $('tShare').onclick = shareTrip;
    var b = $('tOpen'); if (b) b.disabled = !(result && result.plan.ok);
  }
  /**
   * The one place a trip goes to Google Maps: up to 9 stops opens in one tap. Over that, the legs slide up from the
   * button and you tap the one you're driving.
   */
  function openMaps() {
    var ex = result && result.plan.ok ? exports() : null; if (!ex) return;
    if (!ex.one.tooMany) { N.openUrl(ex.one.url); return; }
    if (closeLegs()) return;
    var pg = $('trip'), box = document.createElement('div');
    box.className = 'legs-pop'; box.id = 'tLegs';
    box.innerHTML = '<div class="lp-h">Over Google\'s limit of 9 stops. Use the individual links instead.</div>' + ex.legs.map(function (x, i) {
      return '<button class="leg-link' + (opened[x.leg] ? ' done' : '') + '" data-legurl="' + x.leg + '" style="--i:' + (ex.legs.length - 1 - i) + '"><span class="leg-n">' + (x.leg + 1) + '</span><span class="ll-t"><b>' + arrowHtml(legName(route, x.leg)) + '</b><small>' +
        Math.round(x.toMi - x.fromMi).toLocaleString() + ' mi · ' + (x.fuelStops ? x.fuelStops + ' fuel stop' + (x.fuelStops === 1 ? '' : 's') : 'no fuel stops') + '</small></span>' +
        '<svg viewBox="0 0 24 24"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3zM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z"/></svg></button>';
    }).join('');
    pg.appendChild(box);
    box.style.bottom = ($('tpNav').getBoundingClientRect().height + 6) + 'px';
    requestAnimationFrame(function () { box.classList.add('on'); });
    box.querySelectorAll('[data-legurl]').forEach(function (b) {
      b.onclick = function () { var x = ex.legs[+b.dataset.legurl]; opened[x.leg] = true; b.classList.add('done'); N.openUrl(x.url); };
    });
    setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
  }
  var opened = {};
  function outside(e) { var box = $('tLegs'); if (!box || box.contains(e.target) || (e.target.closest && e.target.closest('#tOpen'))) return; closeLegs(); }
  function closeLegs() {
    var box = $('tLegs'); document.removeEventListener('pointerdown', outside, true);
    if (!box) return false;
    box.classList.remove('on'); setTimeout(function () { box.remove(); }, 200);
    return true;
  }
  /** A price bubble on the route was tapped: open the fuel-stop list on that stop's tile (or the top-up). */
  function openStopTile(which) {
    if (!result || !result.plan.ok) return;
    if (step !== ST_STOPS) { closeLegs(); collectSafe(); step = ST_STOPS; renderStep(); }
    var r = result, k = which === 'T' ? -1 : +which - 1;
    r.stopsShut = false; r.openStops = {}; if (k >= 0) r.openStops[k] = true;
    renderResults();
    setTimeout(function () {
      var t = k >= 0 ? $('stop' + k) : document.querySelector('#tsResults .topbox');
      if (t) { t.scrollIntoView({ block: 'start', behavior: 'smooth' }); t.classList.add('pulse'); setTimeout(function () { t.classList.remove('pulse'); }, 1900); }
    }, 60);
  }
  /** Your bad-CITGO list (or a diesel own-risk choice) changed: plan again from the stations already found (no lookups). */
  function blChanged() {
    if (!result || !model) return;
    var shut = result.stopsShut;
    result = null;
    findStops().then(function () { if (result && shut === false) { result.stopsShut = false; if (onPlan(step)) renderResults(); } });
  }
  /** Stop cards: tap a header to open/close it (in place), price breakdown, navigate. */
  function bindStops() {
    var el = tpBody(), r = result, p = r.plan;
    el.querySelectorAll('[data-open]').forEach(function (b) {
      b.onclick = function () {
        var k = +b.dataset.open; r.openStops = r.openStops || {}; r.openStops[k] = !r.openStops[k];
        $('stop' + k).outerHTML = stopCard(p.stops[k], k); bindStops();
      };
    });
    el.querySelectorAll('[data-nav]').forEach(function (b) {
      b.onclick = function () { var s = b.dataset.nav === 'top' ? r.top.c : p.stops[+b.dataset.nav].c; N.navigate(s.lat, s.lng, /^(wm|mu|demo)-/.test(s.station.id) ? '' : s.station.id, s.station.name); };
    });
    if (A.bl) p.stops.forEach(function (s, i) { if (r.openStops && r.openStops[i]) A.bl.bind(s.c.station, 'ts' + i); });
    el.querySelectorAll('[data-why]').forEach(function (b) {
      b.onclick = function () { var box = $('why' + b.dataset.why); box.classList.toggle('hidden'); };
    });
  }
  function agoText(ms) { var m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; }

  // ---------- trip history ----------
  // Every planned trip is kept (route, Google's route options and the stations it found, with prices) so it can be
  // reopened later with no Google lookups at all. Same stops = same entry, replaced by the newer search.
  var HIST_MAX = 25;
  function histIndex() { var o = A.KV.get('trips', 'index'); return (o && o.v) || []; }
  /** One route option, recognizable again later: its length, time and name. */
  function altSig(a) { return a ? Math.round((a.distanceMeters || 0) / 100) + '|' + Math.round(parseFloat(String(a.duration || '0')) / 60) + '|' + (a.description || '') : ''; }
  /** A saved trip to the same places (each within ~1/4 mile), avoiding the same things — whatever link it came from. */
  function similarTrip(r) {
    if (!r || r.stops.some(function (s) { return s.current || s.lat == null; })) return null;
    var idx = histIndex();
    for (var i = 0; i < idx.length; i++) {
      var o = A.KV.get('trips', 'trip|' + idx[i].id), v = o && o.v;
      if (!v || !v.route || !v.alts || !v.alts.length || !v.stations || v.route.stops.length !== r.stops.length) continue;
      var av = (v.trip && v.trip.avoid) || {};
      if (['tolls', 'highways', 'ferries'].some(function (k) { return !!av[k] !== !!S.trip.avoid[k]; })) continue;
      var same = v.route.stops.every(function (s, k) { var t = r.stops[k]; return !s.current && s.lat != null && !!s.ret === !!t.ret && P.haversineMi(s.lat, s.lng, t.lat, t.lng) <= 0.25; });
      if (same) return { id: idx[i].id, t: o.t, v: v };
    }
    return null;
  }
  function histId(r) {
    if (r.histId) return r.histId;
    var key = r.stops.map(function (st) { return st.current ? 'here' : (st.lat != null ? st.lat.toFixed(3) + ',' + st.lng.toFixed(3) : norm(st.address || st.label)); }).join('|') +
      '|' + ['tolls', 'highways', 'ferries'].filter(function (k) { return S.trip.avoid[k]; }).join(',');
    var h = 0; for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return 't' + (h >>> 0).toString(36);
  }
  /** "North Little Rock → Dallas", or every stop for a trip with a few stops in between ("North Little Rock → Dallas → North Little Rock"). */
  function tripTitle(r) {
    var n = r.stops.map(stopName);
    return n.length <= 4 ? n.join(' → ') : n[0] + ' → … → ' + n[n.length - 1];
  }
  function stopName(st) { return st.current ? 'Your location' : (st.short || st.label || st.address || '?'); }
  function saveTrip(raw, ks) {
    if (!route || !raw) return;
    var id = histId(route), now = Date.now();
    var google = (raw.google || []).map(function (list, i) { return { k: ks[i], sig: alts[ks[i]] ? altSig(alts[ks[i]]) : '', list: list }; });
    var keepStop = function (st) { var o = Object.assign({}, st); delete o.choices; return o; };
    A.KV.put('trips', 'trip|' + id, {
      route: { stops: route.stops.map(keepStop), avoid: route.avoid, avoidDetected: route.avoidDetected, routeIndex: route.routeIndex, mapsRoutes: route.mapsRoutes,
        legs: route.legs ? route.legs.map(function (L) { return { alts: L.alts, sel: L.sel }; }) : null },
      alts: alts, altSel: altSel, altSure: altSure,
      trip: { link: S.trip.link, from: S.trip.from, to: S.trip.to, avoid: S.trip.avoid, milesLeft: S.trip.milesLeft, fuel: S.trip.fuel },
      stations: { official: raw.official || [], google: google, kind: raw.kind || 'gas' }, savedT: now
    });
    var idx = histIndex().filter(function (x) { return x.id !== id; });
    idx.unshift({ id: id, t: now, title: tripTitle(route), pts: route.stops.map(stopName),
      mi: Math.round(model.totalMi), via: alts[altSel] && alts[altSel].description || '', n: route.stops.length });
    idx.slice(HIST_MAX).forEach(function (x) { A.KV.put('trips', 'trip|' + x.id, null); });
    A.KV.put('trips', 'index', idx.slice(0, HIST_MAX));
    LG.info('history', 'Saved trip to history', idx[0].title);
  }
  function dayText(t) {
    var d = new Date(t), now = new Date(), days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
    var tm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return days === 0 ? 'Today ' + tm : days === 1 ? 'Yesterday ' + tm : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  /** Trip button: start a new trip or reopen a saved one (saved trips need no lookups). */
  function tripPicker() {
    var idx = histIndex(), cur = model && route;
    if (!idx.length && !cur) { newTrip(); return; }
    var bg = document.createElement('div'); bg.className = 'tpick-bg'; bg.id = 'tripPick';
    bg.innerHTML = '<div class="tpick" role="dialog" aria-label="Plan a trip"><div class="tpick-h">Plan a trip</div>' +
      '<button class="tpick-new" id="tpNew"><span class="plus">+</span><span><b>New trip</b><small>Start from scratch</small></span></button>' +
      (cur ? '<button class="tpick-new cont" id="tpCont"><span class="plus">↺</span><span><b>Continue</b>' + miniList(route.stops.map(stopName)) + '</span></button>' : '') +
      (idx.length ? '<div class="tpick-sub">Recent trips <span>no lookups</span></div><div class="tpick-list">' + idx.map(function (x) {
        return '<div class="hist-row"><button class="hist-open" data-hist="' + x.id + '">' + miniList(histPts(x)) + '<small>' + x.mi + ' mi' +
          (x.via ? ' · via ' + esc(x.via) : '') + (x.n > 2 ? ' · ' + (x.n - 2) + ' stop' + (x.n > 3 ? 's' : '') : '') + ' · ' + dayText(x.t) + '</small></button>' +
          '<button class="hist-del" data-hdel="' + x.id + '" aria-label="Remove from history">✕</button></div>';
      }).join('') + '</div>' : '') + '</div>';
    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('on'); });
    var close = function () { bg.classList.remove('on'); setTimeout(function () { bg.remove(); }, 200); };
    bg.onclick = function (e) { if (e.target === bg) close(); };
    $('tpNew').onclick = function () { close(); newTrip(); };
    if ($('tpCont')) $('tpCont').onclick = function () { close(); openTrip(); };
    bg.querySelectorAll('[data-hist]').forEach(function (b) { b.onclick = function () { close(); openSaved(b.dataset.hist); }; });
    bg.querySelectorAll('[data-hdel]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.hdel, x = histIndex().filter(function (y) { return y.id === id; })[0];
        A.confirmDel({ title: 'Remove this trip?', body: x ? esc(x.title || '') : '', action: 'Remove' }).then(function (ok) {
          if (!ok) return;
          A.KV.put('trips', 'index', histIndex().filter(function (x) { return x.id !== id; }));
          A.KV.put('trips', 'trip|' + id, null);
          var row = b.closest('.hist-row'); if (row) row.remove();
        });
      };
    });
  }
  /** A trip's places as a small numbered list. */
  function miniList(names) {
    return '<ol class="nlist sm">' + names.map(function (n, i) { return '<li><span class="nn">' + (i + 1) + '</span><div class="nl-a">' + esc(n) + '</div></li>'; }).join('') + '</ol>';
  }
  function histPts(x) {
    if (x.pts && x.pts.length) return x.pts;
    var o = A.KV.get('trips', 'trip|' + x.id), v = o && o.v;   // saved before the list kept them
    if (v && v.route && v.route.stops) return v.route.stops.map(stopName);
    return String(x.title || '').split(' → ');
  }
  function closePicker() { var bg = $('tripPick'); if (!bg) return false; bg.remove(); return true; }
  /** A fresh trip: keep the car and your settings, forget the route. */
  function newTrip(link) {
    resetAdjust();
    route = null; model = null; rawRoute = null; result = null; replay = null; parsing = null; alts = []; altSel = 0; altSure = false;
    routeBounds = null; userMoved = false; layer.clearLayers(); drawn = {}; resetSteps(); opened = {};
    S.trip.link = link || ''; S.trip.from = ''; S.trip.to = ''; S.trip.returnTrip = false; if (link) S.trip.src = 'link';
    if (link) autoRoute = true;   // a link shared from Google Maps: its routes come by themselves
    A.save();
    openTrip(Garage.need && Garage.need() ? ST_GARAGE : link ? ST_ROUTE : ST_GARAGE);
  }
  async function openSaved(id) {
    if (busy) return;
    resetAdjust();
    var o = A.KV.get('trips', 'trip|' + id), v = o && o.v;
    if (!v || !v.alts || !v.alts.length) { toastMsg('That saved trip couldn\'t be read.'); return; }
    Object.assign(S.trip, { src: v.trip.link ? 'link' : 'typed', link: v.trip.link || '', from: v.trip.from || '', to: v.trip.to || '', avoid: Object.assign({ tolls: false, highways: false, ferries: false }, v.trip.avoid) });
    if (!hasFuel() && (v.trip.fuel || v.trip.milesLeft)) { S.trip.fuel = v.trip.fuel || { mode: 'miles', miles: String(v.trip.milesLeft) }; syncMilesLeft(); }
    A.save();
    route = v.route; alts = v.alts;
    S.trip.returnTrip = route.stops.some(function (x) { return x.ret; }); altSel = Math.min(v.altSel || 0, alts.length - 1); altSure = !!v.altSure;
    rawRoute = alts[altSel]; result = null; parsing = null;
    replay = { id: id, t: v.savedT || o.t, stations: v.stations, alts: v.alts };
    resetSteps(); routeBounds = null; userMoved = false; layer.clearLayers(); drawn = {};
    // starts at the Garage (which car this time?); the route and the stops are ready behind it
    model = null; loadingTrip = true; busy = true;
    openTrip(ST_GARAGE);
    await paint();
    try { model = T.buildRoute(rawRoute, carModel()); ensureLimits(model); }
    catch (e) { loadingTrip = false; busy = false; jumpTo = 0; mapLoaded(); renderStep(); toastMsg('That saved trip couldn\'t be read.'); LG.error('history', String(e)); return; }
    loadingTrip = false; busy = false;
    LG.info('history', 'Opened saved trip', { id: id, saved: new Date(o.t).toISOString(), miles: Math.round(model.totalMi) });
    renderStep();   // Next goes on from the Garage; entering Stops plans it from the saved stations
    if (jumpTo) { var j = jumpTo; jumpTo = 0; advance(j); }
  }
  function priceText(v) { return '$' + P.fmt3(v); }
  function keepScroll(f) { var el = tpBody(); if (!el) return f(); var y = el.scrollTop; f(); el.scrollTop = y; }
  function topUpBox() {
    var r = result, last = r.plan.stops[r.plan.stops.length - 1];
    var h = '<div class="topbox"><div class="tb-h">Top up near ' + esc(route.stops[route.stops.length - 1].label) + '?</div>' +
      '<div class="tb-row">Stations within <input type="number" id="tsTopMi" step="0.1" min="0" inputmode="decimal" value="' + r.topMi.toFixed(1) + '"> mi of the destination</div>';
    if (!r.tops.length) {
      h += '<div class="lead small keep">No priced station that close' + (last ? ' after your last stop' : '') + '. Try a bigger distance.</div></div>';
      return h;
    }
    r.tops.forEach(function (t, k) {
      var br = P.brand(t.c.station.brand), on = r.topSel === k;
      h += '<div class="top-opt' + (on ? ' on' : '') + '">' + A.logoHtml(t.c.station.brand) + '<div class="mid"><b>' + esc(P.displayName(t.c.station)) + '</b> · ' + priceText(t.c.price) +
        (last ? ' <span class="' + (t.extraPerGal > 0 ? 'bad' : 'good') + '">(' + (t.extraPerGal >= 0 ? '+' : '−') + '$' + P.fmt3(Math.abs(t.extraPerGal)) + '/gal vs. stop ' + r.plan.stops.length + ')</span>' : '') +
        '<div class="sub">' + t.toDestMi.toFixed(1) + ' mi from the destination · +' + t.buyGal.toFixed(1) + ' gal for ' + money(t.cost) + ' → arrive with ~' + Math.round(t.endMi) + ' mi</div></div>' +
        '<button data-top="' + k + '">' + (on ? 'Added ✓' : 'Add') + '</button></div>';
    });
    if (r.top) h += '<div class="s-act"><button data-nav="top">Navigate to the top-up</button></div>';
    return h + '</div>';
  }
  function stopCard(s, i) {
    var c = s.c, st = c.station, br = P.brand(st.brand), open = !!(result.openStops && result.openStops[i]);
    var det = c.detourMi < 0.15 ? 'on the route' : '+' + c.detourMi.toFixed(1) + ' mi detour';
    var h = '<div class="stop' + (open ? ' open' : '') + '" id="stop' + i + '"><button class="s-top" data-open="' + i + '" aria-expanded="' + open + '"><span class="num">' + (i + 1) + '</span>' + A.badgeHtml(st.brand) +
      '<span class="mid"><span class="nm">' + esc(P.displayName(st)) + '</span><span class="sub">Mile ' + Math.round(c.d) + ' · ' + (KIND() === 'ev' ? 'add ' : 'buy ') + s.buyGal.toFixed(1) + ' ' + UN() + (c.kw ? ' · ' + Math.max(1, Math.round(s.buyGal / c.kw * 60)) + ' min' : '') + (c.detourMi < 0.15 ? '' : ' · +' + c.detourMi.toFixed(1) + ' mi off') + '</span></span>' +
      '<span class="pr"><span class="f">' + priceHtml(c.price) + '</span>' + (c.calc.stale ? '<span class="o stale">stale</span>' : '') + (c.est ? '<span class="o est-tag">est.</span>' : '') + '</span><span class="chev"></span></button>';
    if (!open) return h + '</div>';
    h += '<div class="s-body"><div class="s-buy"><b>' + money(s.cost) + '</b> for ' + s.buyGal.toFixed(1) + ' ' + UN() + (KIND() === 'ev' ? (s.departGal >= Garage.tank() * 0.8 - 0.3 ? ' (to 80%)' : '') : S.trip.fillUp || s.departGal >= Garage.tank() - 0.05 ? ' (fill up)' : '') +
      (c.kw ? ' · <b>~' + Math.max(1, Math.round(s.buyGal / c.kw * 60)) + ' min charging</b> at ~' + Math.round(c.kw) + ' kW average' : '') + ' · ' + det + (c.detourMi >= 0.15 ? ' / +' + Math.max(1, Math.round(c.detourMin)) + ' min' : '') +
      ' · arrive with ~' + Math.round(s.arriveMi) + ' mi left · ' + fmtDur(s.etaSec) + ' in</div>';
    if (s.why) h += '<div class="why-not"><b>Why not the cheaper one?</b> ' + esc(s.why) + '</div>';
    if (s.alts.length) {
      h += '<div class="alts">' + s.alts.map(function (a) {
        var ab = P.brand(a.c.station.brand);
        return '<div>' + A.logoHtml(a.c.station.brand) + esc(P.displayName(a.c.station)) + ' · mile ' + Math.round(a.c.d) + ' · ' + priceText(a.c.price) +
          (a.c.detourMi < 0.15 ? '' : ' · ' + a.c.detourMi.toFixed(1) + ' mi off') + ' <b class="' + (a.extra > 0 ? 'bad' : 'good') + '">' + (a.extra >= 0 ? '+' : '') + money(a.extra) + '</b></div>';
      }).join('') + '</div>';
    }
    h += '<div class="why hidden" id="why' + i + '">' + c.calc.steps.map(function (x) {
      return '<div class="ln"><span>' + esc(x.label) + '</span><span>' + (x.kind === 'base' ? priceText(x.amount) : x.kind === 'none' ? 'not counted' : x.amount === 0 ? 'included' : '−$' + P.fmt3(-x.amount)) + '</span></div>'; }).join('') +
      '<div class="ln tot"><span>You pay per ' + { gal: 'gallon', kWh: 'kWh', kg: 'kg' }[UN()] + '</span><span>' + priceText(c.price) + '</span></div>' +
      (st.network || st.dc || st.pricing || st.hours ? '<div class="af-info">' + [st.network, st.dc ? st.dc + ' fast port' + (st.dc === 1 ? '' : 's') + ' · ' + (st.kwEst ? '~' : '') + st.kw + ' kW' + (st.kwEst ? ' (typical for the network)' : '') : '', st.plugs && st.plugs.length && window.AltFuel ? st.plugs.map(AltFuel.plugName).join(', ') : '', st.pricing ? 'Posted price: ' + st.pricing : '', st.hours].filter(Boolean).map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') + '</div>' : '') + '</div>';
    h += '<div class="s-act"><button data-why="' + i + '">Price breakdown</button><button data-nav="' + i + '">Navigate</button></div>';
    if (A.bl) h += A.bl.buttons(st, 'ts' + i, result.grade);
    h += '</div></div>';
    return h;
  }


  var dotsRenderer = null, dots = [];
  /**
   * Station dots: a fixed pixel size looks bigger and bigger against the map as you zoom out (a 1,300-mile trip at
   * zoom 5 turns into a solid bead chain). So they shrink gently as you zoom out — about a tenth of the map's own
   * scaling — from 6 px at street level to ~2.5 px at country level, never below a tappable-looking dot.
   */
  function dotSize(z) {
    var r = Math.max(2.4, Math.min(6, 6 - (13 - z) * 0.45));
    return { r: r, w: r > 4 ? 2 : r > 3 ? 1.5 : 1 };
  }
  map.on('zoomend', function () {
    if (!dots.length) return;
    var dz = dotSize(map.getZoom());
    dots.forEach(function (d) { d.setRadius(dz.r); d.setStyle({ weight: dz.w }); });
  });
  var drawn = {}, stopTips = [], routeLL = null, selLL = null, pinT = 0, leaderLayer = L.layerGroup();
  /** Price bubbles placed like the route labels on the small maps: off the route (and the highlighted road), off each other, and out from under the panel and the top bar. */
  function placePins() {
    if (!stopTips.length || !map.hasLayer(layer)) return;
    var lines = [{ pts: routeLL || [] }];
    if (selLL) { lines.push({ pts: selLL }); lines.push({ pts: selLL }); }   // the highlighted road counts double
    var sz = map.getSize(), cover = sheetCover();
    // only what's actually on screen up top (the lookup counter, the settings button, the phone's status bar) —
    // not the whole width of the bar, so bubbles can use the space between them
    var st = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--st')) || 0;
    var tops = Labels.rectsOf(map, Array.prototype.filter.call(document.querySelectorAll('.top .bar > *, #btnArea, #status'), function (e) { return getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; }), 6);
    if (!layer.hasLayer(leaderLayer)) layer.addLayer(leaderLayer);
    placeLabels(map, stopTips, -1, lines, [{ x: 0, y: sz.y - cover, w: sz.x, h: cover }, { x: 0, y: 0, w: sz.x, h: st + 4 }].concat(tops),
      { leaders: leaderLayer, leaderPane: 'tleaders' });
  }
  function placePinsSoon() { clearTimeout(pinT); pinT = setTimeout(placePins, 30); }
  // the bubbles keep out from under the panel: placed again whenever it changes size (drag, speed by road, …)
  if (window.ResizeObserver) { var roT = 0; new ResizeObserver(function () { clearTimeout(roT); roT = setTimeout(placePinsSoon, 120); }).observe($('trip')); }
  map.on('zoomend moveend', placePinsSoon);
  function drawRoute() {
    var r0 = result, key = { model: model, result: r0, plan: r0 && r0.plan, top: r0 && r0.top, cands: r0 && r0.cands };
    if (map.hasLayer(layer) && Object.keys(key).every(function (x) { return drawn[x] === key[x]; })) return;
    drawn = key;
    layer.clearLayers();
    if (!map.hasLayer(layer)) layer.addTo(map);
    // long routes have 100,000+ points: draw one about every 1/20 mile (plenty at any zoom you'd use on a trip)
    var ll = [], lastD = -1;
    model.pts.forEach(function (p, i) { if (model.cum[i] - lastD >= 0.05 || i === model.pts.length - 1) { ll.push([p.lat, p.lng]); lastD = model.cum[i]; } });
    L.polyline(ll, { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(ll, { color: '#1a73e8', weight: 5, opacity: 0.95, interactive: false }).addTo(layer);
    var mk = function (p, cls, html) { return L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pin', html: '<div class="' + cls + '">' + html + '</div>', iconSize: null }), keyboard: false }); };
    mk(model.pts[0], 'tend', 'A').addTo(layer);
    mk(model.pts[model.pts.length - 1], 'tend', 'B').addTo(layer);
    if (result) {
      var chosen = {};
      if (result.plan.ok) result.plan.stops.forEach(function (s, i) { chosen[s.c.id] = i + 1; });
      // hundreds of stations on a long trip: drawn on one canvas, in a layer above the route line (like the pins)
      if (!map.getPane('tdots')) { var pn = map.createPane('tdots'); pn.style.zIndex = 590; }
      var cv = A.dotsRenderer;
      var ring = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#ffffff';
      var dz = dotSize(map.getZoom());
      dots = [];
      result.cands.forEach(function (c) {
        if (chosen[c.id]) return;
        var dot = L.circleMarker([c.lat, c.lng], { renderer: cv, pane: 'tdots', radius: dz.r, color: ring, weight: dz.w, fillColor: P.brand(c.station.brand).color, fillOpacity: 1 });
        dots.push(dot);
        dot
          .bindPopup('<b>' + esc(P.displayName(c.station)) + '</b><br>' + priceText(c.price) + ' · mile ' + Math.round(c.d) +
            (c.detourMi >= 0.15 ? ' · ' + c.detourMi.toFixed(1) + ' mi detour' : '')).addTo(layer);
      });
      if (result.top) chosen[result.top.c.id] = 'T';
      // the chosen stops: a dot on the station and a price bubble beside it that moves out of the way of the roads
      stopTips = [];
      // one bubble per station: a station you stop at twice (going and coming back) shows both numbers, "3, 6"
      var groups = [], byStation = {};
      result.cands.forEach(function (c) {
        if (!chosen[c.id]) return;
        var key = c.station.id, g = byStation[key];
        if (!g) { g = byStation[key] = { c: c, nums: [], prices: [] }; groups.push(g); }
        g.nums.push(chosen[c.id]); g.prices.push(c.price);
      });
      groups.forEach(function (g) {
        var c = g.c;
        g.nums.sort(function (a, b) { return (a === 'T' ? 99 : a) - (b === 'T' ? 99 : b); });
        var label = g.nums.join(', '), lo = Math.min.apply(null, g.prices), hi = Math.max.apply(null, g.prices);
        L.circleMarker([c.lat, c.lng], { pane: 'tdots', renderer: cv, radius: 5, color: '#ffffff', weight: 2, fillColor: '#18a957', fillOpacity: 1, interactive: false }).addTo(layer);
        var pv = priceHtml(lo) + (hi - lo > 0.0005 ? '–' + priceHtml(hi) : '');
        var full = '<span class="b">' + label + '</span>' + A.logoHtml(c.station.brand) + '<span class="pv">' + pv + '</span>', small = '<span class="b">' + label + '</span>';
        var tip = L.tooltip({ permanent: true, direction: 'top', offset: [0, -9], className: 'stopbub', interactive: true, opacity: 1, pane: 'tooltipPane' })
          .setLatLng([c.lat, c.lng]).setContent(full);
        layer.addLayer(tip);
        (function (which) {
          var te = tip.getElement(); if (!te) return;
          L.DomEvent.disableClickPropagation(te);
          te.addEventListener('click', function () { openStopTile(which); });
        })(g.nums[0]);
        (function (tip, full, small) {
          var cur = false;
          stopTips.push({ k: stopTips.length, cands: [L.latLng(c.lat, c.lng)], tip: tip, color: '#18a957',
            compact: function (on) { if (on === cur) return; cur = on; tip.setContent(on ? small : full); var te = tip.getElement(); if (te) te.classList.toggle('mini', on); } });
        })(tip, full, small);
      });
    }
    routeLL = ll;
    placePinsSoon();
    var nb = L.latLngBounds(ll);
    if (!routeBounds || !routeBounds.equals(nb)) { routeBounds = nb; userMoved = false; }   // a new route: frame it again
    fitBtn();
  }

  // ---------- keep the whole route in view above the sheet ----------
  // The map frames the route in the part of the screen the sheet doesn't cover, and re-frames it when the sheet grows
  // or shrinks — until you pan or zoom yourself; then a button brings the route back.
  var routeBounds = null, userMoved = false, fitting = false;
  var FIT_ICON = '<svg viewBox="0 0 24 24"><path d="M5 15H3v4a2 2 0 0 0 2 2h4v-2H5v-4zM5 5h4V3H5a2 2 0 0 0-2 2v4h2V5zm14-2h-4v2h4v4h2V5a2 2 0 0 0-2-2zm0 16h-4v2h4a2 2 0 0 0 2-2v-4h-2v4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>';
  /** How much of the screen the panel covers — its target height, not mid-animation (so framing is right straight away). */
  function sheetCover() {
    var el = $('trip'); if (!el || el.classList.contains('hidden')) return 0;
    if (el.classList.contains('full')) return innerHeight;
    var v = el.style.getPropertyValue('--panel-h').trim(), px = /vh$/.test(v) ? parseFloat(v) * innerHeight / 100 : parseFloat(v);
    if (el.classList.contains('tall')) px = 0.75 * innerHeight;
    return px > 0 ? Math.min(px, innerHeight) : el.getBoundingClientRect().height;
  }
  function fitRoute(animate) {
    if (!routeBounds || !document.body.classList.contains('trip-on')) return;
    fitting = true;
    map.fitBounds(routeBounds, { paddingTopLeft: [24, 100], paddingBottomRight: [24, sheetCover() + 18], animate: animate !== false, maxZoom: 15 });
    setTimeout(function () { fitting = false; }, animate === false ? 50 : 450);
  }
  function fitBtn() {
    var b = $('btnFit');
    if (!b) {
      b = document.createElement('button'); b.id = 'btnFit'; b.className = 'fab-fit hidden'; b.setAttribute('aria-label', 'Show the whole route');
      b.innerHTML = FIT_ICON + '<span>Route</span>';
      document.body.appendChild(b);
      b.onclick = function () { userMoved = false; fitBtn(); fitRoute(true); };
    }
    var on = userMoved && routeBounds && step >= ST_ADJ && document.body.classList.contains('trip-on') && !$('trip').classList.contains('hidden');
    b.classList.toggle('hidden', !on);
    if (on) b.style.bottom = (sheetCover() + 12) + 'px';
  }
  map.on('dragstart', function () { if (!fitting) { userMoved = true; fitBtn(); } });
  map.on('zoomstart', function () { if (!fitting && routeBounds && document.body.classList.contains('trip-on')) { userMoved = true; fitBtn(); } });
  /**
   * The panel is as tall as you drag it. The one exception: with "Speed by road" open and on screen, it grows to at
   * least ~75% so the chart and the sliders fit together (and drops back to your height when you close it).
   */
  function sheetSize() {
    var el = $('trip'), sp = $('tsSpeed'), body = tpBody(); if (!el || el.classList.contains('hidden') || !body) return;
    var tall = false;
    // the per-road sliders are a submenu: open = in it (everything else on Adjustments steps aside)
    if (sp && sp.classList.contains('exp') && step === ST_ADJ) tall = true;
    else sizedInMode = false;
    inMode = tall; if (sizedInMode) tall = false;   // you dragged the panel while adjusting: your height wins until you leave
    backMode();
    if (el.classList.contains('tall') === tall) return;
    el.classList.toggle('tall', tall);
    backMode();
    setTimeout(function () { if (!userMoved) fitRoute(true); fitBtn(); placePinsSoon(); }, 260);
  }
  /** Adjusting speed by road (the panel at 75%): Back becomes an arrow that leaves that mode; then it's Back again. */
  // ---------- adjusting speed by road: a submenu ----------
  // While the per-road sliders are open and on screen, the panel sits at 75%, the step tabs make way (the chart moves
  // up beside the ✕), and the bottom buttons become Discard (back to the speeds you had when you came in) and
  // Save and continue.
  var inMode = false, sizedInMode = false, modeSnap = null;
  function speedMode() { return step === ST_ADJ && inMode && !$('trip').classList.contains('hidden'); }
  function snapSpeeds() {
    var st = result && result.speedState || {};
    return { offsets: JSON.parse(JSON.stringify(st.offsets || {})), all: st.all, bufMi: result ? result.bufMi : null };
  }
  function backMode() {
    var on = speedMode(), pg = $('trip');
    if (on && !modeSnap) modeSnap = snapSpeeds();
    if (!on && !inMode) modeSnap = null;
    if (pg) pg.classList.toggle('submode', on);
    var b = $('tBack'), n = $('tNext');
    if (b && b._sub !== on) { b._sub = on; b.textContent = on ? 'Discard adjustments' : 'Back'; b.classList.toggle('discard', on); }
    if (n && !n.classList.contains('busy') && n._sub !== on) { n._sub = on; n.textContent = on ? 'Save adjustments' : 'Next'; }
  }
  /** Save and continue: keep the speeds and close the per-road sliders. */
  function leaveSpeedMode() {
    var t = $('lgTog'); if (t && $('tsSpeed') && $('tsSpeed').classList.contains('exp')) { t.click(); }
    modeSnap = null; sheetSize(); backMode();
  }
  /** Discard: back to the speeds (and buffer) you had when you opened the per-road sliders. */
  function discardSpeedMode() {
    var snap = modeSnap, r = result;
    if (snap && r) {
      var st = r.speedState = r.speedState || {};
      var changed = JSON.stringify(st.offsets || {}) !== JSON.stringify(snap.offsets) || st.all !== snap.all || r.bufMi !== snap.bufMi;
      st.offsets = snap.offsets; st.all = snap.all;
      if (changed) {
        LG.info('speed', 'Speed changes discarded');
        S.speed.view = S.speed.view || {}; S.speed.view.open = false; A.save();
        modeSnap = null; replan(snap.bufMi); sheetSize(); backMode(); return;
      }
    }
    leaveSpeedMode();
  }
  function panelDrag(pg) {
    var vh = function () { return window.innerHeight; };
    pg.style.setProperty('--panel-h', '75vh');
    // drag from the handle, or from the step tabs under it (a drag there moves the panel; a tap still picks the tab)
    var y0 = 0, start = 0, dragging = false, pending = false, src = null, pid = 0, ate = false;
    var down = function (e) {
      if (pg.classList.contains('full') || e.button > 0) return;
      var b = e.target.closest('button');
      if (b && !b.closest('.tp-grab') && !b.closest('#tpSteps')) return;      // the ✕ is just a button
      pending = true; dragging = false; y0 = e.clientY; start = pg.getBoundingClientRect().height; src = e.currentTarget; pid = e.pointerId;
      // follow the finger anywhere until it lifts (it soon leaves the handle)
      document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
    };
    var begin = function () {
      dragging = true; pg.classList.add('dragging'); pg.classList.remove('tall');
    };
    var move = function (e) {
      if (!pending) return;
      if (!dragging) { if (Math.abs(e.clientY - y0) < 8) return; begin(); }
      var h = Math.max(vh() * 0.2, Math.min(vh() * 0.94, start + (y0 - e.clientY)));
      pg.style.setProperty('--panel-h', h + 'px');
      e.preventDefault();
    };
    var up = function () {
      document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true);
      pending = false;
      if (!dragging) return; dragging = false; pg.classList.remove('dragging');
      ate = true; setTimeout(function () { ate = false; }, 350);   // the tap that ends a drag doesn't also pick a tab
      var f = pg.getBoundingClientRect().height / vh();
      pg.style.setProperty('--panel-h', (f * 100) + 'vh');
      sheetSize(); if (inMode) { sizedInMode = true; sheetSize(); }   // dragged while adjusting speeds: your height wins
      if (!userMoved) fitRoute(true); fitBtn();
    };
    pg.addEventListener('click', function (e) { if (ate && e.target.closest('#tpSteps')) { e.stopPropagation(); e.preventDefault(); ate = false; } }, true);
    [$('tpGrab'), pg.querySelector('.tp-head')].forEach(function (h) {
      h.addEventListener('pointerdown', down);
    });
    $('tpBody').addEventListener('scroll', sheetSize, { passive: true });
    $('tpBody').addEventListener('scroll', roadSelSoon, { passive: true });
  }

  // ---------- speed by road: a selector that shows the road on the map ----------
  // While "Speed by road" is open, a green band sits just under the pinned chart and filters. Scroll the roads through
  // it: the stretch mostly inside the band is drawn in green on the map and the map frames it (with room around it).
  var selLayer = L.layerGroup(), selKey = null, selT = 0, selRaf = 0;
  function roadSelSoon() { if (!selRaf) selRaf = requestAnimationFrame(function () { selRaf = 0; roadSel(); }); }
  function roadSel() {
    var pg = $('trip'), sp = $('tsSpeed'), band = $('spdSel');
    var on = sp && sp.classList.contains('exp') && step === ST_ADJ && !pg.classList.contains('hidden') && sp.offsetParent;
    var tools = on && sp.querySelector('.adj-tools'), legs = on ? sp.querySelectorAll('.leg[data-mi]') : [];
    if (!on || !tools || !legs.length) { if (band) band.classList.add('hidden'); clearSel(); return; }
    if (!band) { band = document.createElement('div'); band.id = 'spdSel'; band.className = 'spd-sel'; pg.appendChild(band); }
    var pr = pg.getBoundingClientRect(), br = tpBody().getBoundingClientRect(), tr = tools.getBoundingClientRect();
    var top = Math.max(tr.bottom, br.top), H = 60;
    var last = legs[legs.length - 1].getBoundingClientRect(), first = sp.querySelector('.road-g').getBoundingClientRect();
    var vis = top + H < br.bottom && last.bottom > top && first.top < top + H;
    band.classList.toggle('hidden', !vis);
    band.style.top = (top - pr.top) + 'px'; band.style.height = H + 'px';
    if (!vis) { clearSel(); return; }
    var best = null, bestO = 0;
    legs.forEach(function (e) {
      var r = e.getBoundingClientRect(), o = Math.min(r.bottom, top + H) - Math.max(r.top, top);
      if (o > bestO) { bestO = o; best = e; }
    });
    sp.querySelectorAll('.leg.insel').forEach(function (e) { if (e !== best) e.classList.remove('insel'); });
    if (!best) { clearSel(); return; }
    best.classList.add('insel');
    var key = best.dataset.mi;
    if (key === selKey) return;
    selKey = key;
    clearTimeout(selT);
    selT = setTimeout(function () { showStretch(key); }, 140);
  }
  /** Draw miles a–b of the route in green and frame them above the panel, with more room than the Route button gives. */
  function showStretch(key) {
    if (!model || selKey !== key) return;
    var ab = key.split(',').map(Number), a = ab[0], b = ab[1], ll = [], lastD = -1;
    var step0 = Math.max(0.05, (b - a) / 800);
    for (var i = 0; i < model.pts.length; i++) {
      var d = model.cum[i]; if (d < a) continue; if (d > b) break;
      if (d - lastD >= step0) { ll.push([model.pts[i].lat, model.pts[i].lng]); lastD = d; }
    }
    if (ll.length < 2) return;
    selLayer.clearLayers(); if (!map.hasLayer(selLayer)) selLayer.addTo(map);
    selLL = ll;
    L.polyline(ll, { color: '#ffffff', weight: 13, opacity: 0.95, interactive: false }).addTo(selLayer);
    L.polyline(ll, { color: '#18a957', weight: 8, opacity: 1, interactive: false }).addTo(selLayer);
    fitting = true;
    map.flyToBounds(L.latLngBounds(ll), { paddingTopLeft: [70, 120], paddingBottomRight: [70, sheetCover() + 70], maxZoom: 13, duration: 0.45 });
    setTimeout(function () { fitting = false; }, 650);
  }
  function clearSel() {
    clearTimeout(selT);
    var had = selKey != null || selLayer.getLayers().length;
    selKey = null; selLayer.clearLayers(); selLL = null;
    var sp = $('tsSpeed'); if (sp) sp.querySelectorAll('.leg.insel').forEach(function (e) { e.classList.remove('insel'); });
    if (had && onPlan(step) && !userMoved) fitRoute(true);
  }

  // ---------- open / close ----------
  // The ✕ closes the planner; the trip stays in history (it was saved when its stations were found) and can be
  // continued from the Trip button until a new one is started.
  function closePage() { show($('trip'), false); }
  /** A trip opened, started or closed: Adjustments starts fresh (not inside speed by road, scrolled to the top). */
  function resetAdjust() {
    if (S.speed && S.speed.view && S.speed.view.open) { S.speed.view.open = false; A.save(); }
    inMode = false; sizedInMode = false; modeSnap = null;
    var pg = $('trip'); if (pg) pg.classList.remove('submode', 'tall');
  }
  function closeTrip() {
    resetAdjust();
    closeLegs(); clearSel(); if ($('spdSel')) $('spdSel').classList.add('hidden'); collectSafe(); closePage(); closeQ();
    layer.clearLayers(); drawn = {}; if (map.hasLayer(layer)) map.removeLayer(layer);
    document.body.classList.remove('trip-on', 'trip-full'); routeBounds = null; fitBtn(); A.render();
  }
  function endTrip() { closeTrip(); }
  function closeQ() { if (window.__closeQ) window.__closeQ(); }
  window.__tripBack = function () {
    if (closePicker()) return true;
    if (closeLegs()) return true;
    if (!$('trip').classList.contains('hidden')) { if (speedMode()) { leaveSpeedMode(); return true; } if (step > 1) { collectSafe(); step--; renderStep(); } else closeTrip(); return true; }
    return false;
  };
  $('btnTrip').onclick = function () { tripPicker(); };

  // Google Maps -> Share directions -> Gasket
  window.onSharedText = function (text) {
    closePicker(); newTrip(text);
  };
  if (window.__pendingShare) { var t0 = window.__pendingShare; window.__pendingShare = null; window.onSharedText(t0); }

  // the car's recalls and VIN check run in the background soon after the app starts (NHTSA, never Google), so Advisory is ready
  setTimeout(function () { if (window.Advisory) Advisory.init(call); }, 4000);
  window.__trip = { call: call, open: openTrip, relogo: function () {
      drawn = {};
      if (result && onPlan(step)) keepScroll(renderResults);
      if (model && step >= ST_ADJ && map.hasLayer(layer)) drawRoute();
    }, close: closeTrip, blChanged: blChanged, openStopTile: openStopTile, guard: speedGuard, bufLimits: bufLimits, find: findStops,
    step: function (k) { collectSafe(); step = k; renderStep(); },
    placeMs: function () { var t0 = performance.now(); placePins(); return Math.round(performance.now() - t0); },
    /** For tests: each stop bubble's box, its line (if any) and whether it's the short form; plus how many cover the route. */
    pins: function () {
      var cr = map.getContainer().getBoundingClientRect(), out = stopTips.map(function (t) {
        var e = t.tip.getElement(), r = e.getBoundingClientRect();
        return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height, mini: e.classList.contains('mini'), shown: e.style.visibility !== 'hidden' };
      });
      var leads = []; leaderLayer.eachLayer(function (l) { var ll = l.getLatLngs(); leads.push(ll.map(function (p) { var q = map.latLngToContainerPoint(p); return { x: q.x, y: q.y }; })); });
      var pts = (routeLL || []).map(function (p) { return map.latLngToContainerPoint(p); }), over = 0, cross = 0;
      out.forEach(function (r) { if (!r.shown) return; for (var i = 1; i < pts.length; i++) if (Labels._segRect(pts[i - 1], pts[i], r, 0)) { over++; break; } });
      for (var i = 0; i < leads.length; i++) for (var j = i + 1; j < leads.length; j++) if (Labels._segX(leads[i][0], leads[i][1], leads[j][0], leads[j][1])) cross++;
      return { pins: out, leads: leads.length, overRoute: over, crossings: cross };
    },
    state: function () { return { route: route, model: model, result: result, busy: busy, step: step }; } };
})();
