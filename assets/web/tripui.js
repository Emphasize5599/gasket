/* Fuel+ Map — trip planner screens. Import a Google Maps route, find priced stations along it,
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

  /** Progress inside the Next button: frac 0..1 and what it's doing. */
  function prog(frac, label) {
    var b = $('tNext'); if (!b) return;
    var pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
    b.classList.add('busy');
    b.innerHTML = '<span class="pfill" style="width:' + pct + '%"></span><span class="plab">' + esc(label) + ' · ' + pct + '%</span>';
  }
  function progEnd() { var b = $('tNext'); if (b) { b.classList.remove('busy'); b.textContent = 'Next'; } }
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function fmtDur(sec) { var m = Math.round(sec / 60), h = Math.floor(m / 60); return h ? h + ' h ' + (m % 60) + ' min' : m + ' min'; }
  function money(v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2); }
  function gradeOf() { return window.Garage ? Garage.grade() : (S.grade || 'regular'); }

  // ---------- the trip planner: Garage → Route → Stops → Departure ----------
  // One panel over the map, in four steps, with Back / Next pinned at the bottom. Next checks the step's required
  // fields first and points at the first one missing (red outline for a box, a pulse for something to pick).
  var STEPS = ['Garage', 'Route', 'Stops', 'Departure'], step = 1;
  function tpBody() { return $('tpBody'); }
  function openTrip(st) {
    A.closeDetail();
    if (st) step = st;
    document.body.classList.add('trip-on');
    renderStep();
  }
  function initPanel(pg) {
    pg.className = 'page tpanel hidden';
    pg.innerHTML = '<div class="tp-grab" id="tpGrab"><span></span></div>' +
      '<div class="tp-head"><div class="tp-steps" id="tpSteps"></div><button class="x" id="tClose" aria-label="Close">✕</button></div>' +
      '<div class="tp-body" id="tpBody"></div><div class="tp-nav" id="tpNav"></div>';
    $('tClose').onclick = closeTrip;
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
    [1, 2, 3, 4].forEach(function (k) { var e = $('tpS' + k); if (e) e.remove(); });
    built = {}; scrolls = {}; shown = 0;
  }
  function renderStep() {
    if (window.__apiCount) window.__apiCount();
    var pg = $('trip');
    if (!pg.classList.contains('tpanel')) initPanel(pg);
    show(pg, true);
    var full = step <= 2;   // nothing to see on the map yet: Garage and Route take the whole screen
    pg.classList.toggle('full', full); document.body.classList.toggle('trip-full', full);
    $('tpSteps').innerHTML = STEPS.map(function (n, i) {
      var k = i + 1; return '<button data-step="' + k + '" class="' + (k === step ? 'on' : k < step ? 'done' : '') + '"><b>' + k + '</b><span>' + n + '</span></button>';
    }).join('');
    navRender();
    var b = tpBody();
    if (shown) { scrolls[shown] = b.scrollTop; var old = $('tpS' + shown); if (old) old.classList.add('hidden'); }
    var e = stepEl(step), c = built[step];
    var fresh = !c || step === 4 || (step === 3 && (c.model !== model || c.result !== result));
    e.classList.remove('hidden'); shown = step;
    if (fresh) {
      e.innerHTML = stepHtml(step);
      built[step] = { model: model, result: result };
      bindStep(step);
      b.scrollTop = 0;
    } else {
      b.scrollTop = scrolls[step] || 0;
      if (step === 2) refitOptionMaps();
    }
    // the big map: drawn after this frame paints, and only when its route or stops changed
    var k0 = step;
    requestAnimationFrame(function () { setTimeout(function () {
      if (step !== k0) return;
      if (model && step >= 3) { drawRoute(); if (!userMoved) fitRoute(false); }
      fitBtn(); sheetSize();
    }, 0); });
  }
  function refitOptionMaps() {
    Object.keys(rmaps).forEach(function (k) { var m = rmaps[k]; if (m._refit && document.body.contains(m.getContainer())) { m.invalidateSize(false); m._refit(); } });
  }
  function navRender() {
    var nav = $('tpNav');
    nav.innerHTML = (step > 1 ? '<button class="btn tonal" id="tBack">Back</button>' : '<span></span>') +
      (step < 4 ? '<button class="btn primary" id="tNext">Next</button>' : '<button class="btn primary" id="tShare">Share trip</button>');
    if ($('tBack')) $('tBack').onclick = function () { collectSafe(); step--; renderStep(); };
    if ($('tNext')) $('tNext').onclick = function () { advance(step + 1); };
    if ($('tShare')) $('tShare').onclick = shareTrip;
  }
  /** Go forward to step `to`, one step at a time, stopping at the first requirement that isn't met. */
  async function advance(to) {
    if (busy) return;
    collectSafe();
    while (step < to) {
      var ok = await ready(step);
      if (!ok) return;
      step++;
      renderStep();
    }
  }
  /** Is this step done? If not, point at the first thing missing (top to bottom) and say what's needed. */
  async function ready(k) {
    if (k === 1) {
      var g = Garage.need && Garage.need();
      if (g) { flag(g.el, g.kind, g.msg); return false; }
      return true;
    }
    if (k === 2) {
      if (srcOf() === 'link') { if (!S.trip.link) { flag($('tLink'), 'box', 'Paste a Google Maps directions link.'); return false; } }
      else {
        if (!S.trip.from) { flag($('tFrom'), 'box', 'Where are you starting?'); return false; }
        if (!S.trip.to) { flag($('tTo'), 'box', 'Where are you going?'); return false; }
      }
      var pick = document.querySelector('#tParsed .pick button');
      if (pick) { flag(document.querySelector('#tParsed .pick'), 'pick', 'Pick the right address.'); return false; }
      if (!model) {
        await go();
        if (!model) { var p2 = document.querySelector('#tParsed .pick'); if (p2) flag(p2, 'pick', 'Pick the right address.'); return false; }
        // more than one way to go: look before moving on
        if (alts.length > 1 || multiLeg(route)) { toastMsg('Pick your route, then Next.'); var rp = $('tRouteInfo'); if (rp) rp.scrollIntoView({ block: 'start', behavior: 'smooth' }); return false; }
      }
      return true;
    }
    if (k === 3) {
      if (!(parseFloat(S.trip.milesLeft) >= 0) || S.trip.milesLeft === '') { flag($('tMiles'), 'box', 'How many miles are left in your tank?'); return false; }
      if (!result) { await findStops(); if (!result) return false; }
      if (!result.plan.ok) { flag($('tBuffer'), 'box', 'No plan works with this buffer — try a smaller one.'); return false; }
      return true;
    }
    return true;
  }
  /** Show the user what's missing: red outline on a box, a soft pulse on something to pick. */
  function flag(el, kind, msg) {
    if (msg) toastMsg(msg);
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
    if (k === 1) return '<div class="card" id="tGarage"></div><div class="card spd" id="tSpeed"></div>';
    if (k === 2) {
      var src = srcOf();
      return '<div class="card">' +
      '<div class="seg2" id="tSrc"><button data-src="link" class="' + (src === 'link' ? 'on' : '') + '">Maps link</button><button data-src="typed" class="' + (src === 'typed' ? 'on' : '') + '">Addresses</button></div>' +
      '<div id="tSrcLink"' + (src === 'link' ? '' : ' class="hidden"') + '><div class="field col"><div class="lbl">Google Maps directions link<span class="req" aria-label="required">*</span><small>In Google Maps: get directions → ⋮ → <b>Share directions</b> → Fuel+ Map. Or paste the link here.</small></div>' +
      '<textarea id="tLink" rows="2" placeholder="https://maps.app.goo.gl/…" spellcheck="false">' + esc(t.link) + '</textarea></div></div>' +
      '<div id="tSrcTyped"' + (src === 'typed' ? '' : ' class="hidden"') + '>' +
      '<div class="field col"><div class="lbl">From<span class="req" aria-label="required">*</span></div><span class="in-btn"><input type="text" id="tFrom" placeholder="Address or place" value="' + esc(t.from) + '"><button type="button" id="tHere" aria-label="Use my location"><svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg></button></span></div>' +
      '<div class="field col"><div class="lbl">To<span class="req" aria-label="required">*</span></div><input type="text" id="tTo" placeholder="Address or place" value="' + esc(t.to) + '"></div></div>' +
      '<div id="tParsed"></div>' +
      '<div class="chips" id="tAvoid">' + ['tolls', 'highways', 'ferries'].map(function (k) {
        return '<button data-av="' + k + '" class="' + (t.avoid[k] ? 'on' : '') + '">Avoid ' + k + '</button>'; }).join('') + '</div>' +
      '<div class="field"><div class="lbl">Round trip<small>Comes back to the start. The way back is its own leg, so you pick its roads too.</small></div>' + sw('tRound', !!t.returnTrip) + '</div>' +
        '<div class="field col"><div class="lbl">Leaving<small>Discounts that only apply on certain days (like Club CITGO\'s Tuesday and Friday bonuses) are counted for the day you\'ll reach each station. Blank = now. Prices can change before you go.</small></div>' +
        '<div class="dt-row"><input type="datetime-local" id="tDepart" value="' + esc(futureDepart() ? S.trip.depart : '') + '"><button type="button" class="btn tonal sm" id="tNow">Now</button></div></div></div>' +
        '<div id="tRouteInfo"></div>';
    }
    if (k === 3) {
      return '<div class="card"><div class="grid2">' +
        num('tMiles', 'Miles left in tank<span class="req" aria-label="required">*</span>', t.milesLeft, 1, 'from your dash') + num('tBuffer', 'Buffer (miles)', t.bufferMi, 5, 'never go below') + '</div></div>' +
        '<div id="tsResults"></div>' +
        '<details class="card set-more" id="tSetMore"' + (setOpen ? ' open' : '') + '><summary>Stop settings</summary>' +
      '<div class="seg2" id="tMode"><button data-m="cheap" class="' + (!t.fillUp ? 'on' : '') + '">Cheapest overall</button><button data-m="fill" class="' + (t.fillUp ? 'on' : '') + '">Fill up at each stop</button></div>' +
      '<div class="sub-h">Is a stop or detour worth it?</div>' +
      '<div class="grid2">' + num('tMinSave', 'Min. savings ($)', t.minSave, 0.25, 'per stop or detour') + num('tMaxMin', 'Max. extra time (min)', t.maxDetourMin, 1, 'extra driving per stop') + '</div>' +
      '<details class="alt-entry more"' + (t.timeValue > 0 ? ' open' : '') + '><summary>More options</summary>' +
      '<div class="grid2">' + num('tTime', 'Your time is worth ($/hr)', t.timeValue, 5, 'optional · 0 = off') + '<span class="lead small">Adds a cost for every minute of detour and stop time, on top of the rule above.</span></div></details>' +
      '<div class="sub-h">When you get there <button type="button" class="qi" id="tArriveQ" aria-label="More info">?</button></div>' +
      '<div class="seg2" id="tArrive"><button data-a="buffer" class="' + (t.arrive !== 'full' ? 'on' : '') + '">Just keep my buffer</button><button data-a="full" class="' + (t.arrive === 'full' ? 'on' : '') + '">Arrive with the most gas</button></div>' +

      '<div class="grid2' + (t.arrive === 'full' ? '' : ' hidden') + '" id="tTopBox">' + num('tTopMi', 'Top-up within (mi)', t.topUpMi, 0.1, 'for an optional last top-up') + '<span></span></div>' +
      '<div class="grid2">' + num('tTankPrice', 'Your tank\'s gas ($/gal)', t.tankPrice, 0.01, 'blank = typical price on the route') +
      '<span></span></div>' +
      '<div class="sub-h">Cruising speed</div>' +
      '<div class="field"><div class="lbl">Go over the speed limit by default<small>Off: every road starts at its limit. On: +N over the limit, but never above a top speed — roads already at that limit or higher stay at the limit.</small></div>' + sw('tRule', !!(S.speed.rule && S.speed.rule.on)) + '</div>' +
      '<div class="grid2' + (S.speed.rule && S.speed.rule.on ? '' : ' hidden') + '" id="tRuleBox">' + num('tRuleOver', 'Over the limit by (mph)', (S.speed.rule && S.speed.rule.over) || 9, 1) + num('tRuleCap', '…but no faster than (mph)', (S.speed.rule && S.speed.rule.cap) || 70, 1) + '</div>' +
      '<div class="field"><div class="lbl">Keep me as slow as the trucks<small>Uses the large-truck limit where a state sets one lower than for cars — e.g. 70 on Arkansas Interstates (like I-57) posted 75. From state law as compiled by IIHS; no road database lists truck limits. Not covered: Illinois\' county truck limits.</small></div>' + sw('tTruck', !!S.speed.truck) + '</div>' +
      '<div class="field"><div class="lbl">Let the buffer and speed sliders adjust each other<small>On: a smaller buffer slows you down where needed, and faster speeds raise the buffer, so the tank never runs dry. Off: each slider just stops (grayed out) where the other one doesn\'t leave enough gas.</small></div>' + sw('tLinkSl', S.trip.linkSliders !== false) + '</div>' +
      '<div id="tLinkBox"' + (S.trip.linkSliders !== false ? '' : ' class="hidden"') + '><div class="sub-h">When a smaller buffer needs slower driving</div>' +
      '<div class="seg2" id="tSlowMode"><button data-sm="all" class="' + (S.trip.slowMode !== 'fastest' ? 'on' : '') + '">Slow all roads</button><button data-sm="fastest" class="' + (S.trip.slowMode === 'fastest' ? 'on' : '') + '">Fastest roads first</button></div>' +
      '<div class="grid2">' + num('tMaxUnder', 'Max. under limit (mph)', S.trip.maxUnder != null ? S.trip.maxUnder : 5, 1, 'the slider never slows you more than this') + '<span></span></div></div>' +
      '<div class="sub-h">Other routes</div>' +
      '<div class="field"><div class="lbl">Check Google\'s other routes too<small>Plans the trip on each other route Google suggests and tells you if one saves enough. Uses Google lookups for each route checked.</small></div>' + sw('tAltCmp', t.altCompare) + '</div>' +
      '<div class="grid2' + (t.altCompare ? '' : ' hidden') + '" id="tAltBox">' + num('tAltSave', 'Worth switching if it saves at least ($)', t.altMinSave, 1, 'for the whole trip') + '<span></span></div></details>';
    }
    return departureHtml();
  }
  var setOpen = false;
  function bindStep(k) {
    if (k === 1) { Garage.render($('tGarage'), $('tSpeed'), function () { if (model) { model = T.buildRoute(rawRoute, carModel()); renderInfo(); } result = null; }, call); return; }
    if (k === 2) { bindRoute(); return; }
    if (k === 3) {
      bindSettings(); renderResults();
      built[3].result = result;
      if (model && !result && !busy && parseFloat(S.trip.milesLeft) >= 0 && S.trip.milesLeft !== '') findStops();
      return;
    }
    bindDeparture();
  }
  function bindRoute() {
    var t = S.trip;
    $('tLink').addEventListener('input', debounce(function () { route = null; model = null; replay = null; result = null; renderInfo(); readLink(); }, 400));
    ['tFrom', 'tTo'].forEach(function (id) { $(id).addEventListener('input', function () { route = null; model = null; replay = null; result = null; renderInfo(); renderStops(); }); });
    $('tDepart').addEventListener('change', function () { collectSafe(); result = null; });
    $('tNow').onclick = function () { $('tDepart').value = ''; collectSafe(); result = null; };
    $('tHere').onclick = function () { $('tFrom').value = 'My location'; $('tFrom').dispatchEvent(new Event('input')); };
    $('tSrc').onclick = function (e) {
      var b = e.target.closest('button'); if (!b || b.classList.contains('on')) return;
      Array.prototype.forEach.call($('tSrc').children, function (x) { x.classList.toggle('on', x === b); });
      S.trip.src = b.dataset.src; A.save();
      $('tSrcLink').classList.toggle('hidden', S.trip.src !== 'link'); $('tSrcTyped').classList.toggle('hidden', S.trip.src !== 'typed');
      route = null; model = null; replay = null; result = null; parsing = null; parsedEl().innerHTML = ''; renderInfo(); layer.clearLayers();
      if (S.trip.src === 'link' && $('tLink').value.trim()) readLink();
    };
    $('tRound').onchange = function () {
      collectSafe();
      if (route && syncReturn(route)) { model = null; replay = null; result = null; LG.info('route', S.trip.returnTrip ? 'Round trip: added the way back' : 'Round trip off'); }
      renderStops(); renderInfo();
    };
    $('tAvoid').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      b.classList.toggle('on'); collectSafe(); model = null; replay = null; result = null; renderInfo();
    };
    renderStops(); renderInfo();
    if (srcOf() === 'link' && t.link && !route) readLink();
  }
  function bindSettings() {
    var again = debounce(function () { collectSafe(); if (model && parseFloat(S.trip.milesLeft) >= 0) findStops(); }, 700);
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
    $('tLinkSl').onchange = function () { collectSafe(); $('tLinkBox').classList.toggle('hidden', !S.trip.linkSliders); if (result) renderResults(); };
    $('tAltCmp').onchange = function () { $('tAltBox').classList.toggle('hidden', !this.checked); collectSafe(); again(); };
    $('tSetMore').addEventListener('toggle', function () { setOpen = this.open; });
    ['tMiles', 'tBuffer', 'tMinSave', 'tMaxMin', 'tTime', 'tTopMi', 'tTankPrice', 'tMaxUnder', 'tAltSave'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('input', function () { collectSafe(); again(); });
    });
    arriveHelp();
  }
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
    if (v('tMiles') != null) { t.milesLeft = v('tMiles'); t.bufferMi = Math.max(0, parseFloat(v('tBuffer')) || 0); }
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
    if (shared) { LG.info('link', 'Imported a shared Fuel+ trip', { stops: shared.stops.length }); previewCities(shared); return shared; }
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
      speed: model && model._lim && model._lim.roads ? { stats: model._lim.stats, offsets: r && r.speedState && r.speedState.offsets, cost: r && r.speedState && r.speedState.cost,
        roads: model._lim.roads.map(function (x) { return { name: x.name, cls: x.cls, from: Math.round(x.from), to: Math.round(x.to), pieces: x.pieces.map(function (p) { return [Math.round(p.from), p.st || '', p.limit, p.src, Math.round(p.googleMph)]; }) }; }),
        instructions: model.segs.filter(function (sg) { return sg.to - sg.from > 0.5; }).slice(0, 200).map(function (sg) { return [Math.round(sg.from * 10) / 10, Math.round((sg.to - sg.from) * 10) / 10, sg.instr]; }) } : null,
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
    var h = '<ol class="stops">' + r.stops.map(function (s, i) {
      var tag = i === 0 ? 'Start' : i === r.stops.length - 1 ? 'End' : 'Stop';
      var line = '<li><span class="tag">' + tag + '</span><div class="st-a">' + (s.ret ? '<span class="ret">Back to start · </span>' : '') + esc(stopLine(s));
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
    var picked = multiLeg(r) ? null : pickedRoute(r);
    var withPts = !multiLeg(r) && r.mapsRoutes && r.mapsRoutes.length > 1 && r.mapsRoutes.every(function (m) { return m.pts && m.pts.length > 1; });
    if (withPts && !model) {
      var selK = r.routeIndex != null ? Math.min(r.routeIndex, r.mapsRoutes.length - 1) : 0;
      h += '<div class="maps-opts"><div class="sub-h">Google Maps shows ' + r.mapsRoutes.length + ' routes — tap one</div><div class="rmap" id="tOptMap"></div>' +
        '<div class="opt-sel">via <b>' + esc(r.mapsRoutes[selK].via) + '</b> · ' + Math.round(r.mapsRoutes[selK].miles || 0).toLocaleString() + ' mi · ' + fmtDur((r.mapsRoutes[selK].minutes || 0) * 60) + '</div></div>';
    } else if (!multiLeg(r) && r.mapsRoutes && r.mapsRoutes.length > 1) {
      h += '<div class="msg maps-opts">' + r.mapsRoutes.length + ' routes in Google Maps' + (picked && r.routeIndex != null ? ' · you picked <b>via ' + esc(picked.via) + '</b>' : '') + '. Pick one after <b>Next</b>.</div>';
    } else if (picked) h += '<div class="msg">Route you picked in Google Maps: <b>via ' + esc(picked.via) + '</b>' + (picked.miles ? ' · ' + Math.round(picked.miles) + ' mi' : '') + (picked.minutes ? ' · ' + fmtDur(picked.minutes * 60) : '') + '</div>';
    else if (r.routeIndex && !multiLeg(r)) h += '<div class="msg">Your link says you picked route option ' + (r.routeIndex + 1) + ' in Google Maps.</div>';
    if (multiLeg(r) && !model) h += '<div class="msg">' + (r.stops.length - 1) + ' legs. Each one is routed on its own, so you can pick its route after <b>Next</b>.</div>';
    if (r.note) h += '<div class="msg err">' + esc(r.note) + '</div>';
    el.innerHTML = h;
    if ($('tOptMap')) optionsMap($('tOptMap'), r.mapsRoutes.map(function (m) {
      return { pts: m.pts, time: fmtDur((m.minutes || 0) * 60), miles: Math.round(m.miles || 0).toLocaleString() + ' mi' };
    }), r.routeIndex != null ? Math.min(r.routeIndex, r.mapsRoutes.length - 1) : 0, function (k) { r.routeIndex = k; LG.info('route', 'Picked route option ' + (k + 1) + ' on the map', r.mapsRoutes[k].via); renderStops(); });
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
  function pickLeg(i, k) {
    var L = route.legs[i]; if (!L || k === L.sel) return;
    L.sel = k; rebuildAlts(); rawRoute = alts[0]; model = T.buildRoute(rawRoute, carModel()); ensureLimits(model);
    LG.info('route', 'Leg ' + (i + 1) + ': picked via ' + (L.alts[k].description || k));
    renderInfo();
  }

  // ---------- step 1: route ----------
  async function go() {
    if (busy) return;
    collect();
    if (!S.apiKey) { A.openSettings(false); return; }
    if (model) return;
    busy = true; prog(0.03, 'Reading the link');
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
      if (multiLeg(r)) {
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
    busy = false;
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
    var key = JSON.stringify(body), o = A.KV.get('routes2', key, 24 * 3600e3);
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
    if (!model || !S.apiKey) return 0;
    var n = T.chunks(model, 125).length;
    altCompareList().forEach(function (k) { n += Math.max(1, Math.ceil((alts[k].distanceMeters || 0) / 1609.344 / 125)); });
    return n * googleBrands().length;
  }
  function renderInfo() {
    var el = $('tRouteInfo'); if (!el) return;
    if (!model) { el.innerHTML = ''; alts = []; return; }
    var need = model.galTo(model.totalMi);
    var est = estLookups(), left = (Number(S.monthlyCap) || 0) - N.callsThisMonth();
    var h = '<div class="card route-card">';
    var legView = multiLeg(route) && route.legs && route.legs.length === route.stops.length - 1 && route.legs.every(function (L) { return L.alts; });
    if (legView) {
      h += '<div class="sub-h">Each leg is routed on its own — pick a route for each</div>';
      route.legs.forEach(function (L, i) {
        h += '<div class="leg-pick"><div class="leg-pick-h"><span class="leg-n">' + (i + 1) + '</span>' + arrowHtml(legName(route, i)) + '</div>' +
          (L.alts.length > 1 ? '<div class="rmap" id="tRmap' + i + '"></div>' : '') + '<div class="alts-pick">' + L.alts.map(function (a, k) {
            var mi = (a.distanceMeters || 0) / 1609.344, sec = parseFloat(String(a.duration || '0'));
            return '<button data-leg="' + i + '" data-lk="' + k + '" class="' + (k === L.sel ? 'on' : '') + '"><b>' + (a.description ? 'via ' + esc(a.description) : 'Route ' + (k + 1)) + '</b>' +
              '<span>' + Math.round(mi) + ' mi · ' + fmtDur(sec) + (L.alts.length === 1 ? ' · Google\'s only route' : '') + '</span></button>';
          }).join('') + '</div></div>';
      });
    } else if (alts.length > 1) {
      var pk = pickedRoute(route);
      h += '<div class="sub-h">' + (pk ? 'You picked via ' + esc(pk.via) + ' in Google Maps' + (altSure ? ' — matched on the map' : ' — check the closest one') : 'Pick a route') + '</div>' +
        '<div class="rmap" id="tRmap"></div><div class="alts-pick">' + alts.map(function (a, k) {
        var mi = (a.distanceMeters || 0) / 1609.344, sec = parseFloat(String(a.duration || '0'));
        return '<button data-alt="' + k + '" class="' + (k === altSel ? 'on' : '') + '"><b>' + (a.description ? 'via ' + esc(a.description) : 'Route ' + (k + 1)) + '</b>' +
          '<span>' + Math.round(mi) + ' mi · ' + fmtDur(sec) + (k === altSel && pickedRoute(route) ? (altSure ? ' · ✓ same as in Google Maps' : ' · closest to what you picked') : (!pickedRoute(route) && route && route.routeIndex === k ? ' · matches your link' : '')) + '</span></button>';
      }).join('') + '</div>';
    } else if (route && route.routeIndex > 0 && route.stops.length > 2) {
      h += '<div class="msg">You picked another route option in Google Maps, but Google only offers options for trips without stops in between, so this is its main route.</div>';
    }
    h += limBar(model, 'Speed limits', true);
    h += '<div class="rc-top"><b>' + Math.round(model.totalMi) + ' mi</b> · ' + fmtDur(model.durationSec) +
      ' · about ' + need.toFixed(1) + ' gal</div>';
    var nOther = altCompareList().length;
    h += '<div class="lead small">Finding stations uses ' + (est ? 'about ' + est + ' Google lookups' + (nOther ? ' (your route + ' + nOther + ' other' + (nOther === 1 ? '' : 's') + ')' : '') + (S.monthlyCap ? ' (' + Math.max(0, left) + ' left this month)' : '') : 'no Google lookups') +
      (official('walmart') || official('murphy') ? '; Walmart and Murphy prices come from their own sites.' : '.') + '</div></div>';
    el.innerHTML = h;
    var pickAlt = function (k) { if (k === altSel) return; altSel = k; rawRoute = alts[altSel]; model = T.buildRoute(rawRoute, carModel()); ensureLimits(model); renderInfo(); };
    el.querySelectorAll('[data-alt]').forEach(function (b) { b.onclick = function () { pickAlt(+b.dataset.alt); }; });
    el.querySelectorAll('[data-leg]').forEach(function (b) { b.onclick = function () { N.haptic && N.haptic(); pickLeg(+b.dataset.leg, +b.dataset.lk); }; });
    if (legView) route.legs.forEach(function (L, i) {
      if ($('tRmap' + i)) optionsMap($('tRmap' + i), L.alts.map(function (a) {
        return { pts: thinAlt(a), time: fmtDur(parseFloat(String(a.duration || '0'))), miles: Math.round((a.distanceMeters || 0) / 1609.344).toLocaleString() + ' mi' };
      }), L.sel, function (k) { pickLeg(i, k); });
    });
    if ($('tRmap')) optionsMap($('tRmap'), alts.map(function (a) {
      return { pts: thinAlt(a), time: fmtDur(parseFloat(String(a.duration || '0'))), miles: Math.round((a.distanceMeters || 0) / 1609.344).toLocaleString() + ' mi' };
    }), altSel, pickAlt);
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
    var all = [], tips = [], order = lines.map(function (_, k) { return k; }).filter(function (k) { return k !== sel; }).concat([sel]);   // chosen one drawn on top
    order.forEach(function (k) {
      var ln = lines[k]; if (!ln || !ln.pts || ln.pts.length < 2) return;
      var on = k === sel;
      L.polyline(ln.pts, { color: '#ffffff', weight: on ? 9 : 7, opacity: 0.95, interactive: false }).addTo(rmap);
      var line = L.polyline(ln.pts, { color: on ? '#1a73e8' : ROUTE_GRAY, weight: on ? 6 : 5, opacity: 1 }).addTo(rmap);
      L.polyline(ln.pts, { color: '#000', weight: 22, opacity: 0.001 }).addTo(rmap).on('click', function () { onPick(k); });   // easier to tap
      line.on('click', function () { onPick(k); });
      var cands = labelSpots(lines, k), mid = cands[0];
      tips.push({ k: k, cands: cands, tip: null });
      var tip = tips[tips.length - 1].tip = L.tooltip({ permanent: true, direction: 'top', offset: [0, -9], className: 'rlabel' + (on ? ' on' : ''), interactive: true })
        .setLatLng(mid).setContent('<div class="rl" data-opt="' + k + '"><b>' + esc(ln.time) + '</b><span>' + esc(ln.miles) + '</span></div>').addTo(rmap);
      all = all.concat(ln.pts);
    });
    rmap.attributionControl.setPrefix(false);
    // tapping a time/miles label picks that route too
    el.onclick = null; el.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-opt]'); if (t) { e.stopPropagation(); onPick(+t.dataset.opt); } }, true);
    var a = lines[0].pts[0], b = lines[0].pts[lines[0].pts.length - 1];
    var mk = function (p, t) { L.marker(p, { icon: L.divIcon({ className: 'pin', html: '<div class="tend">' + t + '</div>', iconSize: null }), interactive: false }).addTo(rmap); };
    mk(a, 'A'); mk(b, 'B');
    rmap.fitBounds(L.latLngBounds(all), { paddingTopLeft: [36, 58], paddingBottomRight: [36, 30] });
    setTimeout(function () { if (rmaps[mid0] === rmap) { rmap.invalidateSize(); rmap.fitBounds(L.latLngBounds(all), { paddingTopLeft: [36, 58], paddingBottomRight: [36, 30] }); placeLabels(rmap, tips, sel, lines); } }, 60);
    rmap.on('zoomend moveend', function () { placeLabels(rmap, tips, sel, lines); });
    var fb = document.createElement('button'); fb.className = 'fab-fit rmap-fit'; fb.type = 'button'; fb.setAttribute('aria-label', 'Show every route');
    fb.innerHTML = FIT_ICON + '<span>Route</span>';
    rmap._refit = function () { rmap.fitBounds(L.latLngBounds(all), { paddingTopLeft: [36, 58], paddingBottomRight: [36, 30] }); };
    L.DomEvent.disableClickPropagation(fb);
    fb.onclick = function (e) { e.preventDefault(); e.stopPropagation(); N.haptic && N.haptic(); rmap.fitBounds(L.latLngBounds(all), { paddingTopLeft: [36, 58], paddingBottomRight: [36, 30] }); };
    el.appendChild(fb);
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
  function placeLabels(m, tips, sel, lines) {
    var size = m.getSize(), placed = [], GAP = 9, pts = [];
    (lines || []).forEach(function (ln) {
      if (!ln || !ln.pts) return;
      var st = Math.max(1, Math.floor(ln.pts.length / 500));
      for (var i = 0; i < ln.pts.length; i += st) pts.push(m.latLngToContainerPoint(ln.pts[i]));
    });
    var DIRS = [['top', 0, -GAP], ['bottom', 0, GAP], ['right', GAP, 0], ['left', -GAP, 0]];
    // keep labels out from under the Route button (top right)
    var fbEl = m.getContainer().querySelector('.rmap-fit');
    if (fbEl && fbEl.offsetWidth) placed.push({ x: size.x - fbEl.offsetWidth - 14, y: 0, w: fbEl.offsetWidth + 14, h: fbEl.offsetHeight + 12 });
    var atEl = m.getContainer().querySelector('.leaflet-control-attribution');
    if (atEl && atEl.offsetWidth) { var cr = m.getContainer().getBoundingClientRect(), ar = atEl.getBoundingClientRect(); placed.push({ x: ar.left - cr.left - 4, y: ar.top - cr.top - 4, w: ar.width + 8, h: ar.height + 8 }); }
    var hits = function (r, q) { return r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h; };
    tips.slice().sort(function (a, b) { return (b.k === sel) - (a.k === sel); }).forEach(function (t) {
      var el = t.tip.getElement && t.tip.getElement(); if (!el) return;
      var w = el.offsetWidth, h = el.offsetHeight, best = null;
      t.cands.slice(0, 30).forEach(function (c, ci) {
        var pt = m.latLngToContainerPoint(c);
        DIRS.forEach(function (d) {
          var r = d[0] === 'top' ? { x: pt.x - w / 2, y: pt.y - GAP - h } : d[0] === 'bottom' ? { x: pt.x - w / 2, y: pt.y + GAP } :
            d[0] === 'right' ? { x: pt.x + GAP, y: pt.y - h / 2 } : { x: pt.x - GAP - w, y: pt.y - h / 2 };
          r.w = w; r.h = h;
          if (r.x < 2 || r.y < 2 || r.x + w > size.x - 2 || r.y + h > size.y - 2) return;
          if (placed.some(function (q) { return hits(r, q); })) return;
          var cover = 0; for (var i = 0; i < pts.length; i++) { var p = pts[i]; if (p.x > r.x - 4 && p.x < r.x + w + 4 && p.y > r.y - 4 && p.y < r.y + h + 4) cover++; }
          var score = cover * 10 + ci * 0.6 + (d[0] === 'top' || d[0] === 'bottom' ? 0 : 0.3);
          if (!best || score < best.score) best = { score: score, c: c, d: d, r: r };
        });
      });
      if (!best) best = { c: t.cands[0], d: DIRS[0], r: { x: -99, y: -99, w: 0, h: 0 } };
      t.tip.options.direction = best.d[0]; t.tip.options.offset = L.point(best.d[1], best.d[2]);
      t.tip.setLatLng(best.c); placed.push(best.r);
    });
  }
  function thinAlt(a) {
    var pts = decoded(a), out = [], step = Math.max(1, Math.floor(pts.length / 1500));
    for (var i = 0; i < pts.length; i += step) out.push([pts[i].lat, pts[i].lng]);
    var l = pts[pts.length - 1]; out.push([l.lat, l.lng]);
    return out;
  }
  function toastMsg(m) { if (window.toast) window.toast(m); }

  // ---------- step 2: stations along the route ----------
  /**
   * Stations along one or more routes with your price at each — everything at once: Google's along-route lookups
   * (run in parallel natively), Murphy USA and Walmart's own sites (a few requests at a time), all started together.
   * Answers already found for the same stretch are reused (saved searches) unless force, or older than staleHours.
   * pg(frac 0..1, label). Returns { per: [{cands, notes, unpriced, stale, grade}] per model, cachedAgeMs }.
   */
  async function gatherAll(models, pg, dbgS, force, replay, ks) {
    var KV = A.KV, notes = [], official = [], perModel = models.map(function () { return []; });
    if (replay) {
      // a saved trip: the stations (with their prices) it found then — no lookups at all
      official = (replay.official || []).slice();
      perModel = (ks || []).map(function (k) {
        var hit = (replay.google || []).filter(function (g) { return g.k === k; })[0];
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
          else KV.put('murphy', mkey, res.stores || []);
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
      })());
      tick();
      await Promise.all(tasks);
    } catch (e) { notes.push(String(e && e.message || e)); LG.error('stations', String(e && e.message || e)); }
    dbgSearch.savedPieces = saved; dbgSearch.oldestSavedMin = Math.round(oldest / 60000);

    var grade = gradeOf(), per = [], t0 = Date.now(), nowD = new Date(), goD = departAt();
    for (var mi = 0; mi < models.length; mi++) {
      var model = models[mi];
      var merged = P.mergeOfficial(dedupe(perModel[mi]), official), cands = [], unpriced = 0, stale = 0;
      for (var si = 0; si < merged.length; si++) {
        if (si % 150 === 149) await new Promise(function (r) { setTimeout(r, 0); });   // let the screen breathe on big trips
        var s = merged[si];
        // once per leg it's near: on a round trip over the same roads a station is passed going and coming back
        var prs = T.projectLegs(model, { lat: s.lat, lng: s.lng }, maxOff);
        for (var pi = 0; pi < prs.length; pi++) {
          var pr = prs[pi];
          var c = P.compute(s, grade, S, nowD, new Date(goD.getTime() + pr.along / (model.totalMi || 1) * model.durationSec * 1000));   // day-based bonuses go by when you'll be there
          if (!c) { if (!pi) unpriced++; break; }
          if (c.stale && !pi) stale++;
          var est = 2 * pr.offset * 1.3 + (pr.offset > 0.15 ? 0.2 : 0);
          // trust Google's detour unless it's wildly off from the straight-line estimate (then the piece was routed differently),
          // and only on the stretch it was measured for (not on the way back)
          var exact = s.detourExact && s.detourMi <= est * 3 + 2 && (!s.detourRange || (pr.along >= s.detourRange[0] - 1 && pr.along <= s.detourRange[1] + 1));
          var det = exact ? s.detourMi : est;
          var detMin = det < 0.15 ? 0 : det / 25 * 60 + 1;   // side roads ~25 mph, plus getting off and back on
          cands.push({ id: pr.leg ? s.id + '@' + pr.leg : s.id, d: pr.along, offset: pr.offset, detourMi: det, detourMin: detMin, detourExact: exact,
            price: c.final, calc: c, station: s, lat: s.lat, lng: s.lng, leg: pr.leg });
        }
      }
      per.push({ cands: cands, notes: notes, unpriced: unpriced, stale: stale, grade: grade });
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
    Limits.along(m, getJson, { lookup: S.limitLookup !== false, onProg: function (d, t) { hit.frac = t ? d / t : 1; limBars(hit.frac); } }).then(function (res) {
      hit.res = res; limBars(1);
      hit.waiting.forEach(function (w) { w._lim = res; });
      if (hit.waiting.indexOf(model) >= 0 && $('tsSpeed')) renderTripSpeed();
      LG.info('speed', 'Speed limits along the route in ' + (Date.now() - t0) + ' ms', res.stats);
      LG.debug('speed', 'Roads', res.roads.map(function (r) { return [r.name, Math.round(r.from), Math.round(r.to), r.pieces.map(function (p) { return p.st + ':' + p.limit + (p.src === 'hpms' ? '' : '(' + p.src + ')'); }).join(' ')]; }));
    }).catch(function (e) { delete limCache[sig]; hit.waiting.forEach(function (w) { w._lim = { roads: [], stats: {}, error: String(e) }; }); LG.error('speed', 'Speed limit lookup failed', String(e)); });
  }
  /** Every "Looking up speed limits" bar on screen. */
  function limBars(f) {
    var pct = Math.round(Math.min(1, f) * 100);
    document.querySelectorAll('.lim-load').forEach(function (el) {
      var i = el.querySelector('i'), p = el.querySelector('.pct');
      if (i) i.style.width = pct + '%'; if (p) p.textContent = pct + '%';
      if (pct >= 100 && el.dataset.hideDone) el.classList.add('hidden');
    });
  }
  function limFrac(m) { var sig = m && m.pts.length + ':' + m.totalMi.toFixed(3) + ':' + m.pts[0].lat.toFixed(5), h = sig && limCache[sig]; return h ? (h.res ? 1 : h.frac || 0) : 0; }
  function limBar(m, label, hideDone) {
    var pct = Math.round(limFrac(m) * 100);
    return '<div class="parse-load lim-load' + (pct >= 100 && hideDone ? ' hidden' : '') + '"' + (hideDone ? ' data-hide-done="1"' : '') + '><span>' + label + '</span><span class="pbar"><i style="width:' + pct + '%"></i></span><span class="pct">' + pct + '%</span></div>';
  }
  function speedLegs() {
    var r = result, p = r.plan; if (!p.ok) return [];
    var pts = [{ name: route.stops[0].current ? 'Start' : (route.stops[0].short || 'Start'), d: 0 }], avg = r.startPrice || p.refPrice, legs = [];
    var stops = p.stops.slice();
    var gal0 = r.startGal;
    stops.forEach(function (s, i) { pts.push({ name: (i + 1) + ' · ' + s.c.station.name, d: s.c.d, s: s }); });
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
      onEditRule: function () { var d = $('tSetMore'); if (d) { d.open = true; setOpen = true; } setTimeout(function () { var f = $('tRule') && $('tRule').closest('.field'); if (f) { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); f.classList.add('pulse'); setTimeout(function () { f.classList.remove('pulse'); }, 1900); } }, 60); },
      onToggle: function () { sheetSize(); } });
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
    r.plan = p; r.opts = o; if (mi != null) r.bufMi = mi; r.topSel = -1; r.sweep = null; r.planOffs = cx ? cx.offs.join(',') : '';
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
    var fo = Object.assign({}, x.opts, { lite: false }); r.plan = T.plan(fo); r.opts = fo; r.bufMi = x.mi; r.topSel = -1;
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
    var help = 'The gas to have in the tank when you set off, from your plan: if its first stop is by the start (within 5 miles), you buy that much before you go. Range is at this trip\'s mileage and your speeds.';
    return '<div class="ideal" id="tsIdeal"><div class="ideal-h">Gas to leave with ' + A.qBtn(help) + '</div>' +
      '<div class="ideal-row"><div class="ideal-l"><div class="ideal-big">' + gal.toFixed(1) + ' gal</div><div class="ideal-sub">~' + Math.round(gal / gpm) + ' mi of range</div></div>' +
      '<div class="ideal-r">' + (atStart ? 'Add <b>' + first.buyGal.toFixed(1) + ' gal</b><small>' + esc(first.c.station.name) + (first.c.d >= 0.5 ? ' · mile ' + first.c.d.toFixed(1) : '') + '</small>' : '<b>Nothing to add</b><small>leave with what you have</small>') + '</div></div></div>';
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
  function bufBox() {
    var r = result, sw = r.sweep;
    var h = '<div class="bufbox" id="tsBufBox"><div class="tb-h">Buffer for this trip</div>';
    if (!sw) return h + '<div class="lead small keep">Checking other buffers…</div></div>';
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
    var mk = bufMarks(sw, base), GAP = 17, rows = [[], []];
    h += '<div class="buf-track"><div class="buf-marks">';
    // labels in two rows; where neither row has room the tick stays without a label.
    // The usual buffer and the biggest saving are placed first, so they always get one.
    var all = mk.concat([{ mi: base.mi, kind: 'base' }]).sort(function (a2, b2) { return a2.mi - b2.mi; });
    var big = mk.filter(function (m) { return m.kind === 'good'; }).sort(function (a2, b2) { return a2.d - b2.d; })[0];
    var free = function (row, L) { return rows[row].every(function (q) { return Math.abs(q - L) >= GAP; }); };
    var order = all.filter(function (m) { return m.kind === 'base' || m === big; }).concat(all.filter(function (m) { return !(m.kind === 'base' || m === big); }));
    order.forEach(function (m) { var L = +pos(m.mi); m.lr = free(0, L) ? 0 : free(1, L) ? 1 : -1; if (m.lr >= 0) rows[m.lr].push(L); });
    all.forEach(function (m) {
      var L = +pos(m.mi);
      var lab = m.kind === 'base' ? 'usual' : (m.d < 0 ? '−' : '+') + money(Math.abs(m.d)).replace(/^[−-]/, '');
      h += '<span class="bm ' + m.kind + (m.lr === 1 ? ' r2' : '') + '" style="left:' + L + '%"' + (m.kind !== 'base' ? ' data-bm="' + m.mi + '"' : '') + '>' + (m.lr >= 0 ? '<em>' + lab + '</em>' : '') + '<i></i></span>';
    });
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
    } else {
      var best = mk.filter(function (m) { return m.kind === 'good'; }).sort(function (a2, b2) { return a2.d - b2.d || b2.mi - a2.mi; })[0];
      if (best) {
        var hs = best.row.plan.stops.filter(function (s2) { return !base.plan.stops.some(function (c) { return c.c.id === s2.c.id; }); })[0];
        h += '<div class="lead small keep">Cheapest: ' + best.mi + ' mi saves ' + money(-best.d) + ' vs. your usual ' + base.mi + ' mi' +
          (hs ? ' — it reaches ' + esc(hs.c.station.name) + ' at mile ' + Math.round(hs.c.d) + ' (' + priceText(hs.c.price) + ')' : '') + '.</div>';
      } else h += '<div class="lead small keep">No buffer makes this trip cheaper than your usual ' + base.mi + ' mi.</div>';
      h += '<div class="lead small">Gray: your usual buffer. Green: buffers where the trip costs less than with it, and by how much. Yellow: where it costs more. Tap a marker to jump there.</div>';
    }
    if (r.bufMi !== S.trip.bufferMi) h += '<div class="lead small keep">For this trip only — your usual buffer is ' + S.trip.bufferMi + ' mi. <a href="#" id="tsBufKeep">Make ' + r.bufMi + ' mi my usual buffer</a></div>';
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
    Garage.guardRange(inp);
    var r = result, cur = swRow(r.bufMi), base = swRow(S.trip.bufferMi);
    if (!base.ok) base = cur;
    var last = r.bufMi;
    inp.oninput = function () {
      var x = swRow(+inp.value);
      if (!bufOk(x)) { inp.value = last; x = swRow(last); }        // can't slide into the gray
      else last = +inp.value;
      $('tsBufVal').textContent = x.mi + ' mi'; $('tsBufCost').textContent = bufText(x, base);
    };
    $('tsBufBox').querySelectorAll('[data-bm]').forEach(function (m) { m.onclick = function () { inp.value = m.dataset.bm; inp.oninput(); inp.onchange(); }; });
    inp.onchange = function () {
      var x = swRow(+inp.value);
      if (x.mi === r.bufMi) { inp.value = x.mi; return; }
      LG.info('plan', 'Buffer slider: ' + r.bufMi + ' → ' + x.mi + ' mi', { ok: x.ok, net: x.net });
      if (!bufOk(x)) { inp.value = r.bufMi; $('tsBufVal').textContent = r.bufMi + ' mi'; $('tsBufCost').textContent = bufText(cur, base); toastMsg('No plan keeps ' + x.mi + ' mi at your speeds — the stations are too far apart.'); return; }
      N.haptic && N.haptic();
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

  function makeOpts(model, cands, startGal) {
    return { model: model, cands: cands, startGal: startGal, capGal: Garage.tank(), bufferGal: S.trip.bufferMi * model.combGpm,
      arriveGal: S.trip.bufferMi * model.combGpm, fillUp: S.trip.fillUp,
      // arriving with the most gas: a late, cheap fill-up is the point, so the "must save" bar drops to $0.25
      stopPenalty: S.trip.arrive === 'full' ? Math.min(S.trip.minSave, 0.25) : S.trip.minSave,
      detourPenalty: S.trip.arrive === 'full' ? Math.min(S.trip.minSave, 0.25) : S.trip.minSave,
      maxDetourMin: S.trip.maxDetourMin, timeValue: S.trip.timeValue, stopMinutes: 8,
      lastFull: S.trip.arrive === 'full' };
  }
  function breathe() { return new Promise(function (r) { setTimeout(r, 0); }); }
  async function findStops(force) {
    if (busy || !model) return;
    busy = true;
    try { await findStops0(force); } catch (e) { LG.error('plan', e.message || String(e)); toastMsg(e.message || String(e)); result = null; }
    busy = false; progEnd();
    if (window.__apiCount) window.__apiCount();
    if (step === 3 && $('tsResults') && !result) renderResults();
  }
  async function findStops0(force) {
    if ($('tsResults') && step === 3) $('tsResults').innerHTML = '<div class="card finding"><div class="spin"></div><span>Finding the best stops…</span></div>';
    prog(0.01, 'Finding stations');
    LG.info('stations', 'Find the best stops pressed', { miles: Math.round(model.totalMi), points: model.pts.length, force: force === true });
    await new Promise(function (r) { setTimeout(r, 30); });
    var others = altCompareList();
    dbg.search = {};
    var models = [model];
    others.forEach(function (k) { try { models.push(T.buildRoute(alts[k], carModel())); } catch (e) { models.push(null); } });
    var okModels = models.filter(Boolean), okKs = [altSel].concat(others).filter(function (k, i) { return models[i]; });
    var rp = force === true ? null : replay;
    if (rp) LG.info('stations', 'Using the stations saved with this trip (' + agoText(Date.now() - rp.t) + ') — no lookups');
    var ga = await gatherAll(okModels, function (f, l) { prog(0.02 + f * 0.9, l + (others.length ? ' (' + okModels.length + ' routes)' : '')); }, dbg.search, force === true, rp && rp.stations, okKs);
    if (rp) ga.cachedAgeMs = Date.now() - rp.t;
    else { try { saveTrip(ga.raw, okKs); } catch (e) { LG.warn('history', 'Couldn\'t save the trip', String(e)); } }
    var g = ga.per[0];
    var cands = g.cands, notes = g.notes, unpriced = g.unpriced, stale = g.stale, grade = g.grade;
    prog(0.93, 'Choosing stops');
    var startGal = (parseFloat(S.trip.milesLeft) || 0) * model.combGpm;
    var opts = makeOpts(model, cands, startGal), planOffs = null;
    var secs0 = flatSecs(model), sf0 = secs0.length && Garage.speedFn ? Garage.speedFn() : null;
    if (sf0) {
      var offs0 = secs0.map(function (sc) { return Garage.ruleOff(sc.limit); });
      planOffs = offs0.join(',');
      if (offs0.some(function (v) { return v; })) opts.model = T.withSpeeds(model, T.speedRates(secs0, offs0, sf0.f, sf0.lo, sf0.hi));
    }
    await breathe();
    var t0 = Date.now();
    var plan = T.plan(opts);
    LG.info('plan', plan.ok ? 'Planned ' + plan.stops.length + ' stop(s) in ' + (Date.now() - t0) + ' ms' : 'No workable plan', {
      candidates: cands.length, unpriced: unpriced, stale: stale, tooFar: plan.tooFar, reachMi: plan.reachMi,
      stops: plan.ok ? plan.stops.map(function (s) { return { name: s.c.station.name, mile: Math.round(s.c.d), price: s.c.price, buy: Math.round(s.buyGal * 10) / 10, why: s.why }; }) : null });
    LG.debug('plan', 'Candidates', cands.map(function (c) { return [c.station.name, Math.round(c.d), c.price, Math.round(c.detourMi * 10) / 10]; }));
    result = { plan: plan, opts: opts, cands: cands, notes: notes, unpriced: unpriced, stale: stale, grade: grade, startGal: startGal,
      topMi: S.trip.topUpMi, topSel: -1, bufMi: S.trip.bufferMi, cachedAgeMs: ga.cachedAgeMs, fromHistory: !!rp, planOffs: planOffs };
    await breathe();
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
    if (step >= 3) showResult();
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
    if (step === 3 && $('tsResults')) { renderResults(); drawRoute(); fitBtn(); }
    else if (step === 4) renderStep();
  }
  function renderResults() {
    var el = $('tsResults'); if (!el) return;
    var r = result;
    if (built[3]) { built[3].result = result; built[3].model = model; }
    if (!r) {
      el.innerHTML = model ? '<div class="card empty-res">' + (parseFloat(S.trip.milesLeft) >= 0 && S.trip.milesLeft !== '' ? 'Stops appear here.' : 'Enter the miles left in your tank to plan stops.') + '</div>' : '';
      return;
    }
    var p = r.plan, h = '<div class="res-head"><b>' + arrowHtml(tripTitle(route)) + '</b><span>' + Math.round(model.totalMi) + ' mi · ' + fmtDur(model.durationSec) + ' · ' + r.cands.length + ' stations</span></div>';
    if (!p.ok) {
      h += '<div class="msg err">No plan keeps you above a ' + r.bufMi + '-mile buffer. ' +
        (p.reachMi > 0 ? 'Past mile ' + Math.round(p.reachMi) + ' there\'s no priced station close enough.' : 'There\'s no priced station within your current range.') +
        ' Try a smaller buffer, check the miles left, or turn on more brands.</div>';
      h += routeBox() + bufBox();
    } else {
      var t = p.totals;
      h += routeBox();
      if (p.firstDip && p.stops.length) h += '<div class="msg">You can\'t keep a ' + r.bufMi + '-mile buffer on the way to the first stop — you\'ll get there with about ' + Math.round(p.stops[0].arriveGal / model.combGpm) + ' miles left. Stop 1 is the closest workable station.</div>';
      if (!t.stops) h += '<div class="msg ok">No stop is worth it — you\'ll arrive with about ' + Math.round(p.arriveMi) + ' miles left.</div>';
      if (p.stops.length) {
        var shut = r.stopsShut !== false;
        h += '<button class="sec-h" id="tsStopsH" aria-expanded="' + !shut + '"><span>' + p.stops.length + ' fuel stop' + (p.stops.length === 1 ? '' : 's') + '</span><span class="chev' + (shut ? '' : ' up') + '"></span></button>';
        if (!shut) { h += '<div class="stops-list">'; p.stops.forEach(function (s, i) { h += stopCard(s, i); }); h += '</div>'; }
        h += '<div class="lead small keep arrive">Arrive with ~' + Math.round(p.arriveMi) + ' mi left' + (S.trip.arrive === 'full' ? ' (' + Math.round(p.arriveGal / Garage.tank() * 100) + '% of the tank)' : '') + '.</div>';
      }
      h += idealBox();
      h += bufBox();
      h += '<div class="spdbox" id="tsSpeed"></div>';
      if (S.trip.arrive === 'full') h += topUpBox();
    }
    if (r.cachedAgeMs > 0) h += '<div class="note saved">' + (r.fromHistory ? 'Saved trip · prices from ' + agoText(r.cachedAgeMs) + ' (no lookups used)' : 'Prices from ' + agoText(r.cachedAgeMs)) + ' · <a href="#" id="tsRefresh">Get fresh prices</a></div>';
    el.innerHTML = h;
    if ($('tsRefresh')) $('tsRefresh').onclick = function (e) { e.preventDefault(); findStops(true); };
    el.querySelectorAll('[data-top]').forEach(function (b) {
      b.onclick = function () { var k = +b.dataset.top; r.topSel = r.topSel === k ? -1 : k; recompute(); keepScroll(showResult); };
    });
    if ($('tsTopMi')) $('tsTopMi').addEventListener('change', function () {
      r.topMi = Math.max(0, Math.round((parseFloat(this.value) || 0) * 10) / 10); S.trip.topUpMi = r.topMi; A.save(); r.topSel = -1; recompute(); keepScroll(showResult);
    });
    el.querySelectorAll('[data-route]').forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); N.haptic && N.haptic(); switchRoute(+b.dataset.route); };
    });
    bindBuf();
    if (p.ok) renderTripSpeed();
    if ($('tsStopsH')) $('tsStopsH').onclick = function () { r.stopsShut = r.stopsShut === false; keepScroll(showResult); };
    bindStops();
    A.qify && A.qify(el);
    sheetSize();
  }

  // ---------- step 4 (Departure) ----------
  function exports() {
    var r = result, p = r && r.plan; if (!p || !p.ok) return null;
    var fuelStops = p.stops.concat(r.top ? [{ c: r.top.c }] : []);
    return { one: T.exportUrl(route, fuelStops, model), legs: T.exportLegs(route, fuelStops, model) };
  }
  function departureHtml() {
    var r = result; if (!r || !model) return '<div class="card empty-res">Plan your stops first.</div>';
    var p = r.plan, h = '<div class="res-head"><b>' + arrowHtml(tripTitle(route)) + '</b><span>' + Math.round(model.totalMi) + ' mi · ' + fmtDur(model.durationSec) +
      (p.ok ? ' · ' + p.totals.stops + ' fuel stop' + (p.totals.stops === 1 ? '' : 's') : '') + '</span></div>';
    if (!p.ok) return h + '<div class="msg err">No plan works yet — go back to Stops.</div>';
    var t = p.totals, out = r.acc.legs[0];
    h += '<div class="kpis"><div><b>' + money(out.cost) + '</b><span>trip cost</span></div>' +
      '<div><b>' + money(out.spend) + '</b><span>at the pump</span></div>' +
      '<div><b class="' + (p.savings > 0.005 ? 'good' : '') + '">' + (p.savings != null && p.savings > 0.005 ? money(p.savings) : '—') + '</b><span>saved</span></div></div>';
    // what these numbers depend on: your settings
    var w = [];
    var fd = futureDepart();
    if (fd) w.push('Leaving ' + fd.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '. Prices are today\'s and may change by then.');
    w.push('Trip cost is the ' + out.burnGal.toFixed(1) + ' gal this drive burns: gas already in your tank at ' + priceText(r.startPrice) + '/gal' +
      (S.trip.tankPrice ? ' (what you said it cost)' : ' (typical on this route — set what you paid in Stop settings)') + ', plus what you buy at what you pay.');
    if (p.easy && p.savings > 0.005) w.push('Easiest plan (fewest stops, closest to the road): ' + money(p.easy.totals.net) + ' net vs. ' + money(t.net) + ' for this one' + (t.detourMin - p.easy.totals.detourMin > 0.5 ? ', which adds ' + Math.round(t.detourMin - p.easy.totals.detourMin) + ' min of detours' : '') + '.');
    if (p.minStops != null && t.stops > p.minStops) w.push('You only need ' + p.minStops + ' stop' + (p.minStops === 1 ? '' : 's') + '; the extra one pays for itself with cheaper gas.');
    if (p.firstDip && p.stops.length) w.push('You\'ll reach stop 1 below your ' + r.bufMi + '-mile buffer (about ' + Math.round(p.stops[0].arriveGal / model.combGpm) + ' mi left).');
    if (r.stale) w.push(r.stale + ' station' + (r.stale === 1 ? ' has a price' : 's have prices') + ' older than ' + S.staleHours + ' hours.');
    if (p.tooFar) w.push(p.tooFar + ' station' + (p.tooFar === 1 ? ' was' : 's were') + ' skipped for being more than ' + S.trip.maxDetourMin + ' min out of the way.');
    if (r.unpriced) w.push(r.unpriced + ' brand station' + (r.unpriced === 1 ? '' : 's') + ' had no ' + P.GRADES[r.grade].label.toLowerCase() + ' price and were skipped.');
    r.notes.forEach(function (n) { w.push(n); });
    h += '<div class="warns">' + w.map(function (x) { return '<div class="note">' + esc(x) + '</div>'; }).join('') + '</div>';
    // links
    var ex = exports(), one = ex.one, legs = ex.legs;
    var ico = '<svg viewBox="0 0 24 24"><path d="M21.71 11.29l-9-9a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42l9 9a1 1 0 0 0 1.42 0l9-9a1 1 0 0 0 0-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>';
    h += '<div class="actions"><button class="btn primary" id="tsExport"' + (one.tooMany ? ' disabled' : '') + '>' + ico + 'Open the whole trip in one link</button>' +
      (one.tooMany ? '<div class="sub-h center">' + one.waypoints + ' stops — Google Maps takes up to 9 in one link</div>' : '') +
      '<div class="leg-links"><div class="sub-h">One link per leg</div>' + legs.map(function (x) {
        return '<button class="leg-link" data-legurl="' + x.leg + '"><span class="leg-n">' + (x.leg + 1) + '</span><span class="ll-t"><b>' + arrowHtml(legName(route, x.leg)) + '</b><small>' +
          Math.round(x.toMi - x.fromMi) + ' mi · ' + (x.fuelStops ? x.fuelStops + ' fuel stop' + (x.fuelStops === 1 ? '' : 's') : 'no fuel stops') + '</small></span>' +
          '<svg viewBox="0 0 24 24"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3zM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z"/></svg></button>';
      }).join('') + '</div></div>';
    // what Google Maps will and won't carry over
    var mw = [];
    if (route.legs && route.legs.some(function (L) { return L.sel > 0; })) mw.push('Google Maps picks its own roads between stops. If a leg opens on a different road than you picked (' + route.legs.map(function (L, i) { return L.sel > 0 ? 'leg ' + (i + 1) + ': via ' + (L.alts[L.sel].description || 'route ' + (L.sel + 1)) : ''; }).filter(Boolean).join(', ') + '), pick that option in Maps — easiest with one link per leg.');
    else if (!multiLeg(route) && altSel > 0 && !p.stops.length && !r.top) mw.push('Google Maps may open on its usual route; pick the “via ' + (alts[altSel].description || 'other road') + '” option there.');
    else if (route.routeIndex != null && altSel !== route.routeIndex && alts[altSel]) mw.push('This isn\'t the route you picked in Google Maps. Maps picks its own roads between stops — check that it goes via ' + (alts[altSel].description || 'this route') + '.');
    if (route.avoidDetected || S.trip.avoid.tolls || S.trip.avoid.highways || S.trip.avoid.ferries) mw.push('Google Maps links don\'t carry “avoid” settings — turn them on again in Maps.');
    h += '<div class="warns">' + mw.map(function (x) { return '<div class="note">' + esc(x) + '</div>'; }).join('') + '</div>';
    h += '<p class="lead small keep center"><a href="#" id="tsReport">Troubleshooting report</a></p>';
    return h;
  }
  function bindDeparture() {
    if ($('tsReport')) $('tsReport').onclick = function (e) { e.preventDefault(); shareReport(); };
    var ex = result && result.plan.ok ? exports() : null; if (!ex) return;
    $('tsExport').onclick = function () { if (ex.one.tooMany) return; N.haptic(); N.openUrl(ex.one.url); };
    tpBody().querySelectorAll('[data-legurl]').forEach(function (b) { b.onclick = function () { N.haptic(); var x = ex.legs[+b.dataset.legurl]; b.classList.add('done'); N.openUrl(x.url); }; });
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
  function histId(r) {
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
    var google = (raw.google || []).map(function (list, i) { return { k: ks[i], list: list }; });
    var keepStop = function (st) { var o = Object.assign({}, st); delete o.choices; return o; };
    A.KV.put('trips', 'trip|' + id, {
      route: { stops: route.stops.map(keepStop), avoid: route.avoid, avoidDetected: route.avoidDetected, routeIndex: route.routeIndex, mapsRoutes: route.mapsRoutes },
      alts: alts, altSel: altSel, altSure: altSure,
      trip: { link: S.trip.link, from: S.trip.from, to: S.trip.to, avoid: S.trip.avoid, milesLeft: S.trip.milesLeft },
      stations: { official: raw.official || [], google: google }
    });
    var idx = histIndex().filter(function (x) { return x.id !== id; });
    idx.unshift({ id: id, t: now, title: tripTitle(route),
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
      (cur ? '<button class="tpick-new cont" id="tpCont"><span class="plus">↺</span><span><b>Continue</b><small>' + arrowHtml(tripTitle(route)) + '</small></span></button>' : '') +
      (idx.length ? '<div class="tpick-sub">Recent trips <span>no lookups</span></div><div class="tpick-list">' + idx.map(function (x) {
        return '<div class="hist-row"><button class="hist-open" data-hist="' + x.id + '"><b>' + arrowHtml(x.title) + '</b><small>' + x.mi + ' mi' +
          (x.via ? ' · via ' + esc(x.via) : '') + (x.n > 2 ? ' · ' + (x.n - 2) + ' stop' + (x.n > 3 ? 's' : '') : '') + ' · ' + dayText(x.t) + '</small></button>' +
          '<button class="hist-del" data-hdel="' + x.id + '" aria-label="Remove from history">✕</button></div>';
      }).join('') + '</div>' : '') + '</div>';
    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('on'); });
    var close = function () { bg.classList.remove('on'); setTimeout(function () { bg.remove(); }, 200); };
    bg.onclick = function (e) { if (e.target === bg) close(); };
    $('tpNew').onclick = function () { close(); newTrip(); };
    if ($('tpCont')) $('tpCont').onclick = function () { close(); openTrip(); };
    bg.querySelectorAll('[data-hist]').forEach(function (b) { b.onclick = function () { N.haptic && N.haptic(); close(); openSaved(b.dataset.hist); }; });
    bg.querySelectorAll('[data-hdel]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.hdel;
        A.KV.put('trips', 'index', histIndex().filter(function (x) { return x.id !== id; }));
        A.KV.put('trips', 'trip|' + id, null);
        var row = b.closest('.hist-row'); if (row) row.remove();
      };
    });
  }
  function closePicker() { var bg = $('tripPick'); if (!bg) return false; bg.remove(); return true; }
  /** A fresh trip: keep the car and your settings, forget the route. */
  function newTrip(link) {
    route = null; model = null; rawRoute = null; result = null; replay = null; parsing = null; alts = []; altSel = 0; altSure = false;
    routeBounds = null; userMoved = false; layer.clearLayers(); drawn = {}; resetSteps();
    S.trip.link = link || ''; S.trip.from = ''; S.trip.to = ''; S.trip.returnTrip = false; if (link) S.trip.src = 'link';
    A.save();
    openTrip(Garage.need && Garage.need() ? 1 : link ? 2 : 1);
  }
  async function openSaved(id) {
    if (busy) return;
    var o = A.KV.get('trips', 'trip|' + id), v = o && o.v;
    if (!v || !v.alts || !v.alts.length) { toastMsg('That saved trip couldn\'t be read.'); return; }
    Object.assign(S.trip, { src: v.trip.link ? 'link' : 'typed', link: v.trip.link || '', from: v.trip.from || '', to: v.trip.to || '', avoid: Object.assign({ tolls: false, highways: false, ferries: false }, v.trip.avoid) });
    if (!(parseFloat(S.trip.milesLeft) >= 0)) S.trip.milesLeft = v.trip.milesLeft;
    A.save();
    route = v.route; alts = v.alts;
    S.trip.returnTrip = route.stops.some(function (x) { return x.ret; }); altSel = Math.min(v.altSel || 0, alts.length - 1); altSure = !!v.altSure;
    rawRoute = alts[altSel]; result = null; parsing = null;
    replay = { id: id, t: o.t, stations: v.stations };
    resetSteps();
    model = T.buildRoute(rawRoute, carModel());
    ensureLimits(model);
    LG.info('history', 'Opened saved trip', { id: id, saved: new Date(o.t).toISOString(), miles: Math.round(model.totalMi) });
    openTrip(3);
    if (!(parseFloat(S.trip.milesLeft) >= 0) || S.trip.milesLeft === '') { flag($('tMiles'), 'box', 'How many miles are left in your tank?'); return; }
    findStops();
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
      var br = P.BRANDS[t.c.station.brand], on = r.topSel === k;
      h += '<div class="top-opt' + (on ? ' on' : '') + '"><span class="dot" style="background:' + br.color + '"></span><div class="mid"><b>' + esc(t.c.station.name) + '</b> · ' + priceText(t.c.price) +
        (last ? ' <span class="' + (t.extraPerGal > 0 ? 'bad' : 'good') + '">(' + (t.extraPerGal >= 0 ? '+' : '−') + '$' + P.fmt3(Math.abs(t.extraPerGal)) + '/gal vs. stop ' + r.plan.stops.length + ')</span>' : '') +
        '<div class="sub">' + t.toDestMi.toFixed(1) + ' mi from the destination · +' + t.buyGal.toFixed(1) + ' gal for ' + money(t.cost) + ' → arrive with ~' + Math.round(t.endMi) + ' mi</div></div>' +
        '<button data-top="' + k + '">' + (on ? 'Added ✓' : 'Add') + '</button></div>';
    });
    if (r.top) h += '<div class="s-act"><button data-nav="top">Navigate to the top-up</button></div>';
    return h + '</div>';
  }
  function stopCard(s, i) {
    var c = s.c, st = c.station, br = P.BRANDS[st.brand], open = !!(result.openStops && result.openStops[i]);
    var det = c.detourMi < 0.15 ? 'on the route' : '+' + c.detourMi.toFixed(1) + ' mi detour';
    var h = '<div class="stop' + (open ? ' open' : '') + '" id="stop' + i + '"><button class="s-top" data-open="' + i + '" aria-expanded="' + open + '"><span class="num">' + (i + 1) + '</span><span class="badge" style="background:' + br.color + '">' + br.short + '</span>' +
      '<span class="mid"><span class="nm">' + esc(st.name) + '</span><span class="sub">Mile ' + Math.round(c.d) + ' · buy ' + s.buyGal.toFixed(1) + ' gal' + (c.detourMi < 0.15 ? '' : ' · +' + c.detourMi.toFixed(1) + ' mi off') + '</span></span>' +
      '<span class="pr"><span class="f">' + priceHtml(c.price) + '</span>' + (c.calc.stale ? '<span class="o stale">stale</span>' : '') + '</span><span class="chev"></span></button>';
    if (!open) return h + '</div>';
    h += '<div class="s-body"><div class="s-buy"><b>' + money(s.cost) + '</b> for ' + s.buyGal.toFixed(1) + ' gal' + (S.trip.fillUp || s.departGal >= Garage.tank() - 0.05 ? ' (fill up)' : '') + ' · ' + det + (c.detourMi >= 0.15 ? ' / +' + Math.max(1, Math.round(c.detourMin)) + ' min' : '') +
      ' · arrive with ~' + Math.round(s.arriveMi) + ' mi left · ' + fmtDur(s.etaSec) + ' in</div>';
    if (s.why) h += '<div class="why-not"><b>Why not the cheaper one?</b> ' + esc(s.why) + '</div>';
    if (s.alts.length) {
      h += '<div class="alts">' + s.alts.map(function (a) {
        var ab = P.BRANDS[a.c.station.brand];
        return '<div><span class="dot" style="background:' + ab.color + '"></span>' + esc(ab.name) + ' · mile ' + Math.round(a.c.d) + ' · ' + priceText(a.c.price) +
          (a.c.detourMi < 0.15 ? '' : ' · ' + a.c.detourMi.toFixed(1) + ' mi off') + ' <b class="' + (a.extra > 0 ? 'bad' : 'good') + '">' + (a.extra >= 0 ? '+' : '') + money(a.extra) + '</b></div>';
      }).join('') + '</div>';
    }
    h += '<div class="why hidden" id="why' + i + '">' + c.calc.steps.map(function (x) {
      return '<div class="ln"><span>' + esc(x.label) + '</span><span>' + (x.kind === 'base' ? priceText(x.amount) : x.amount === 0 ? 'included' : '−$' + P.fmt3(-x.amount)) + '</span></div>'; }).join('') +
      '<div class="ln tot"><span>You pay per gallon</span><span>' + priceText(c.price) + '</span></div></div>';
    h += '<div class="s-act"><button data-why="' + i + '">Price breakdown</button><button data-nav="' + i + '">Navigate</button></div></div></div>';
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
  var drawn = {};
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
      var cv = dotsRenderer || (dotsRenderer = L.canvas({ padding: 0.3, pane: 'tdots' }));
      var ring = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#ffffff';
      var dz = dotSize(map.getZoom());
      dots = [];
      result.cands.forEach(function (c) {
        if (chosen[c.id]) return;
        var dot = L.circleMarker([c.lat, c.lng], { renderer: cv, pane: 'tdots', radius: dz.r, color: ring, weight: dz.w, fillColor: P.BRANDS[c.station.brand].color, fillOpacity: 1 });
        dots.push(dot);
        dot
          .bindPopup('<b>' + esc(c.station.name) + '</b><br>' + priceText(c.price) + ' · mile ' + Math.round(c.d) +
            (c.detourMi >= 0.15 ? ' · ' + c.detourMi.toFixed(1) + ' mi detour' : '')).addTo(layer);
      });
      if (result.top) chosen[result.top.c.id] = 'T';
      result.cands.forEach(function (c) {
        if (!chosen[c.id]) return;
        mk(c, 'pin-in best tstop" style="--bc:#0a5c32', '<span class="b">' + chosen[c.id] + '</span>' + priceHtml(c.price)).setZIndexOffset(1000).addTo(layer);
      });
    }
    var nb = L.latLngBounds(ll);
    if (!routeBounds || !routeBounds.equals(nb)) { routeBounds = nb; userMoved = false; }   // a new route: frame it again
    fitBtn();
  }

  // ---------- keep the whole route in view above the sheet ----------
  // The map frames the route in the part of the screen the sheet doesn't cover, and re-frames it when the sheet grows
  // or shrinks — until you pan or zoom yourself; then a button brings the route back.
  var routeBounds = null, userMoved = false, fitting = false;
  var FIT_ICON = '<svg viewBox="0 0 24 24"><path d="M5 15H3v4a2 2 0 0 0 2 2h4v-2H5v-4zM5 5h4V3H5a2 2 0 0 0-2 2v4h2V5zm14-2h-4v2h4v4h2V5a2 2 0 0 0-2-2zm0 16h-4v2h4a2 2 0 0 0 2-2v-4h-2v4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>';
  function sheetCover() { var el = $('trip'); return el && !el.classList.contains('hidden') ? el.getBoundingClientRect().height : 0; }
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
      b.onclick = function () { N.haptic && N.haptic(); userMoved = false; fitBtn(); fitRoute(true); };
    }
    var on = userMoved && routeBounds && step >= 3 && document.body.classList.contains('trip-on') && !$('trip').classList.contains('hidden');
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
    if (sp && sp.classList.contains('exp')) { var a = body.getBoundingClientRect(), b = sp.getBoundingClientRect(); tall = b.top < a.bottom - 40 && b.bottom > a.top + 40; }
    if (el.classList.contains('tall') === tall) return;
    el.classList.toggle('tall', tall);
    setTimeout(function () { if (!userMoved) fitRoute(true); fitBtn(); }, 260);
  }
  function panelDrag(pg) {
    var vh = function () { return window.innerHeight; };
    var h0 = parseFloat(S.trip.panelH);
    pg.style.setProperty('--panel-h', (h0 >= 0.2 && h0 <= 0.95 ? h0 * 100 : 58) + 'vh');
    var y0 = 0, start = 0, dragging = false;
    var down = function (e) {
      if (pg.classList.contains('full')) return;
      if (e.target.closest('button') && !e.target.closest('.tp-grab')) return;
      dragging = true; y0 = e.clientY; start = pg.getBoundingClientRect().height;
      pg.classList.add('dragging'); pg.classList.remove('tall');
      try { e.target.setPointerCapture(e.pointerId); } catch (x) { }
    };
    var move = function (e) {
      if (!dragging) return;
      var h = Math.max(vh() * 0.2, Math.min(vh() * 0.94, start + (y0 - e.clientY)));
      pg.style.setProperty('--panel-h', h + 'px');
      e.preventDefault();
    };
    var up = function () {
      if (!dragging) return; dragging = false; pg.classList.remove('dragging');
      var f = pg.getBoundingClientRect().height / vh();
      S.trip.panelH = Math.round(f * 100) / 100; A.save();
      pg.style.setProperty('--panel-h', (f * 100) + 'vh');
      if (!userMoved) fitRoute(true); fitBtn(); sheetSize();
    };
    [$('tpGrab'), pg.querySelector('.tp-head')].forEach(function (h) {
      h.addEventListener('pointerdown', down); h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    $('tpBody').addEventListener('scroll', sheetSize, { passive: true });
  }

  // ---------- open / close ----------
  // The ✕ closes the planner; the trip stays in history (it was saved when its stations were found) and can be
  // continued from the Trip button until a new one is started.
  function closePage() { show($('trip'), false); }
  function closeTrip() {
    collectSafe(); closePage(); closeQ();
    layer.clearLayers(); drawn = {}; if (map.hasLayer(layer)) map.removeLayer(layer);
    document.body.classList.remove('trip-on', 'trip-full'); routeBounds = null; fitBtn(); A.render();
  }
  function endTrip() { closeTrip(); }
  function closeQ() { if (window.__closeQ) window.__closeQ(); }
  window.__tripBack = function () {
    if (closePicker()) return true;
    if (!$('trip').classList.contains('hidden')) { if (step > 1) { collectSafe(); step--; renderStep(); } else closeTrip(); return true; }
    return false;
  };
  $('btnTrip').onclick = function () { N.haptic(); tripPicker(); };

  // Google Maps -> Share directions -> Fuel+ Map
  window.onSharedText = function (text) {
    closePicker(); newTrip(text);
  };
  if (window.__pendingShare) { var t0 = window.__pendingShare; window.__pendingShare = null; window.onSharedText(t0); }

  window.__trip = { call: call, open: openTrip, guard: speedGuard, bufLimits: bufLimits, find: findStops,
    step: function (k) { collectSafe(); step = k; renderStep(); },
    state: function () { return { route: route, model: model, result: result, busy: busy, step: step }; } };
})();
