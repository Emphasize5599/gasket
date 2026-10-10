/* Gasket — Advisory (trip step 2): things worth knowing before you drive. Safety recalls (every recall on record for the
 * car's year / make / model, and, with a VIN, which are still open on this car, read from NHTSA's own page the user opens),
 * and features that save a little gas at the cost of engine wear (the app suggests turning them off).
 * Plain language: technical names only inside the (?) explanations. Never tells anyone they have a bad car. */
(function () {
  'use strict';
  var A = window.__app, S = A.S, N = A.N, $ = A.$, esc = A.esc, LG = window.FLog || { info: function () {}, warn: function () {} };
  var RECALLS = 'https://api.nhtsa.gov/recalls/recallsByVehicle';
  var VIN_PAGE = 'https://www.nhtsa.gov/recalls?vymm=';
  var RECHECK_DAYS = 90;
  var host = null, call = null;

  function G() { return window.Garage; }
  function car() { return G().car(); }
  function save() { A.save(); }
  function name(c) { return c.year + ' ' + c.make + ' ' + String(c.vpicModel || c.model || '').replace(/\s+(2WD|4WD|FWD|AWD|RWD)$/i, ''); }
  function days(t) { return (Date.now() - t) / 864e5; }

  // ---------- recalls on record (NHTSA, by year / make / model) ----------
  var busy = {};
  function recallKey(c) { return c.year && c.make && c.model ? c.year + '|' + String(c.make).toLowerCase() + '|' + String(c.vpicModel || c.model).toLowerCase() : ''; }
  function nhtsaModels(c) {
    var m = String(c.vpicModel || c.model || '').replace(/\s+(2WD|4WD|FWD|AWD|RWD)$/i, '').trim(), out = [m];
    var first = m.split(/\s+/)[0]; if (first && first !== m) out.push(first);
    return out;
  }
  async function fetchRecalls(c) {
    var key = recallKey(c); if (!key || busy[c.id] || !call) return;
    busy[c.id] = true;
    try {
      var list = [], tried = nhtsaModels(c);
      for (var i = 0; i < tried.length && !list.length; i++) {
        var r = await call('fetchJson', RECALLS + '?make=' + encodeURIComponent(c.make) + '&model=' + encodeURIComponent(tried[i]) + '&modelYear=' + c.year);
        if (r.error) throw new Error(r.error);
        list = JSON.parse(r.body).results || [];
      }
      c.recalls = { t: Date.now(), key: key, list: list.map(function (x) {
        return { id: x.NHTSACampaignNumber, date: x.ReportReceivedDate, comp: x.Component, sum: x.Summary, cons: x.Consequence, fix: x.Remedy, park: !!x.parkIt, out: !!x.parkOutSide, ota: !!x.overTheAirUpdate };
      }) };
      LG.info('car', 'Recalls on record for ' + G().shortName(c) + ': ' + list.length);
      save();
    } catch (e) { LG.warn('car', 'Recall list', String(e.message || e)); c.recalls = c.recalls && c.recalls.key === key ? c.recalls : { t: Date.now(), key: key, list: null, error: true }; }
    busy[c.id] = false;
    if (car() === c) { if (host && host.isConnected) draw(); else syncDot(); }
  }
  function onRecord(c) { c = c || car(); return c.recalls && c.recalls.list && c.recalls.key === recallKey(c) ? c.recalls.list : null; }
  /** The VIN check, if it's for this car's current VIN. */
  function vinCheck(c) { c = c || car(); return c.vin && c.recallCheck && c.recallCheck.vin === c.vin ? c.recallCheck : null; }

  // ---------- reading NHTSA's VIN page: in the background like the price sites (siteRead), or shown to you (siteShow).
  // The page does its own checks as in any browser; nothing is ever solved or got around. ----------
  var AUTO_DAYS = 7, AUTO_RETRY_H = 0.5, READER = 2, autoBusy = {};
  /** Check the VIN by itself when there's no check from the last week (and no failed try in the last few hours). */
  function autoCheck(c) {
    if (!c || !c.vin || !call || !N.siteRead || autoBusy[c.id]) return;
    var chk = vinCheck(c); if (chk && days(chk.t) < AUTO_DAYS) return;
    // only a failed try waits (half an hour) before the next. A try that never finished (the app was closed while it ran)
    // doesn't count, and neither does one from before the reader knew NHTSA's "N Unrepaired Recalls Found".
    var tried = c.recallAuto; if (tried && tried.vin === c.vin && tried.failed && tried.r === READER && Date.now() - tried.t < AUTO_RETRY_H * 3600e3) return;
    var vin = c.vin, done = false, t0 = Date.now();
    autoBusy[c.id] = true; LG.info('car', 'Checking the VIN with NHTSA in the background');
    var finish = function (r) {
      if (done) return; done = true; autoBusy[c.id] = false;
      LG.info('car', 'Background VIN check took ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
      if (!r || r.error || r.blocked || r.closed || c.vin !== vin) {
        c.recallAuto = { vin: vin, t: Date.now(), failed: true, r: READER }; save();
        LG.warn('car', 'Automatic VIN recall check got no answer', r && (r.refused ? 'NHTSA\'s lookup turned the hidden window down (its invisible reCAPTCHA): ' + r.error : r.error || (r.blocked ? 'blocked by a check on NHTSA\'s page' : r.closed ? 'closed' : '')) || 'no reply in a minute');
      } else record(c, vin, r, true);
      if (car() === c) { if (host && host.isConnected) draw(); else syncDot(); }
    };
    setTimeout(function () { finish(null); }, 60000);   // it normally answers in 5-10 s
    call('siteRead', 'nhtsa', JSON.stringify({ url: VIN_PAGE + encodeURIComponent(vin), bg: true })).then(finish);
    setTimeout(function () { if (!done && host && host.isConnected && car() === c) draw(); }, 0);   // (may be asked from inside a draw)
  }
  function record(c, vin, r, quiet) {
    c.recallCheck = { t: Date.now(), vin: vin, open: +r.open || 0, campaigns: (r.campaigns || []).slice(0, 30), items: (r.items || []).slice(0, 30) };
    c.recallAuto = { vin: vin, t: Date.now() };
    LG.info('car', 'VIN recall check' + (quiet ? ' (automatic)' : '') + ': ' + c.recallCheck.open + ' open');
    save(); changed();
  }
  // ---------- shown to you (the button) ----------
  var pendingCheck = null;
  function checkVin(c) {
    if (!c.vin) return;
    if (!N.siteShow) { N.openUrl(VIN_PAGE + encodeURIComponent(c.vin)); return; }
    pendingCheck = { carId: c.id, vin: c.vin };
    call('siteShow', 'nhtsa', JSON.stringify({ url: VIN_PAGE + encodeURIComponent(c.vin) })).then(function (r) { gotCheck(r); });
  }
  function gotCheck(r) {
    var p = pendingCheck; pendingCheck = null;
    if (!p || !r || r.closed) return;              // closed before NHTSA answered: nothing to record
    var c = (S.cars || []).filter(function (x) { return x.id === p.carId; })[0];
    if (!c || c.vin !== p.vin) return;
    if (r.error) { A.toast && A.toast(r.error); LG.warn('car', 'VIN recall check', r.error); return; }
    record(c, p.vin, r, false);
    // no popup: Advisory shows the answer
    if (car() === c) draw();
  }

  // ---------- features that trade engine life for mileage ----------
  var ADVICE = [
    { feat: 'Cylinder deactivation', title: 'Cylinder shut-off (cylinder deactivation)',
      what: 'When you cruise gently, the engine switches off some of its cylinders to save a little gas.',
      why: 'On several engines it\'s been linked to burning oil and worn valve parts over time, which can mean costly repairs.',
      how: 'Most cars have no switch for it. Driving in Sport mode, or Tow/Haul mode on a truck, usually keeps every cylinder working. A mechanic can also fit a small plug-in device that turns it off for good. Ask them about your warranty first.',
      q: '<b>Cylinder shut-off</b> (cylinder deactivation; brand names include Active Fuel Management, Dynamic Fuel Management, Multi-Displacement System and Variable Cylinder Management). It saves roughly 5–10% of gas in light cruising. Turning it off costs that back. Engines with it switch cylinders on and off thousands of times a trip, and several have had problems with oil use and the parts that open the valves (lifters). Whether yours does depends on the engine. Turning it off is a way to play it safe.' },
    { feat: 'Start-stop', title: 'Engine stop at red lights (start-stop)', skip: function (c) { return c.power === 'hybrid' || c.power === 'phev'; },
      what: 'The engine turns itself off when you stop and restarts when you lift off the brake.',
      why: 'That means many more engine starts: more wear on the starter, the battery and the engine\'s bearings. Its battery is also a special, more expensive kind.',
      how: 'Most cars have a button for it, often an "A" inside a circling arrow. Press it after you start the car. On many cars you have to press it every drive. A mechanic or a plug-in device can make it stay off.',
      q: '<b>Engine stop at red lights</b> (automatic start-stop). It saves a few percent of gas in stop-and-go driving and almost nothing on the highway. Cars that have it use a heavier-duty starter and battery, but every restart still happens before the oil is fully back up to pressure. Hybrids work differently: their engine stopping is part of how they drive, without a starter, so this doesn\'t apply to them.' }
  ];
  function adviceFor(c) {
    var f = (c.info && c.info.features) || [];
    return ADVICE.filter(function (a) { return f.indexOf(a.feat) >= 0 && !(a.skip && a.skip(c)); });
  }
  function choice(c, a) { return c.advice && c.advice[a.feat]; }

  // ---------- what needs a look (the dot on the step) ----------
  function attention(c) {
    c = c || car(); if (!c) return 0;
    var n = 0, chk = vinCheck(c), list = onRecord(c);
    if (chk) { if (chk.open > 0) n++; else if (days(chk.t) > RECHECK_DAYS) n++; }
    else if (c.vin && list && list.length) n++;
    n += adviceFor(c).filter(function (a) { return !choice(c, a); }).length;
    n += tireAdvice(c).filter(function (x) { return x.level === 'warn' && !x.nodot; }).length;   // worn tires, a spare to air up
    return n;
  }
  /** One line for the Departure step, or ''. */
  function departureNote(c) {
    c = c || car();
    var rc = recallNote(c), sp = window.Tires && Tires.departureNote ? Tires.departureNote(c) : '';
    return [rc, sp].filter(Boolean).join(' ');
  }
  function recallNote(c) {
    var chk = vinCheck(c), list = onRecord(c);
    if (chk && chk.open > 0) return 'Your ' + G().shortName(c) + ' has ' + chk.open + ' open safety recall' + (chk.open === 1 ? '' : 's') + '. A dealer fixes them for free. Worth doing before a long drive (see Advisory).';
    if (!chk && list && list.length) return 'Your ' + G().shortName(c) + ' has ' + list.length + ' safety recall' + (list.length === 1 ? '' : 's') + ' on record. Check in Advisory whether yours are fixed.';
    return '';
  }

  // ---------- page ----------
  function render(el, nativeCall) { host = el; call = nativeCall || call; autoCheck(car()); draw(); }
  var onChange = function () {};
  function changed() { syncDot(); onChange(); try { window.dispatchEvent(new Event('advisorychange')); } catch (e) { } }
  /** The dot on the Advisory step tab: something worth a look. */
  function syncDot() { var b = document.querySelector('#tpSteps [data-step="2"]'); if (b) b.classList.toggle('attn', attention() > 0); }
  var listOpen = false;
  // drawn only while it's on screen (switching cars elsewhere mustn't start rating recalls behind your back); shown again
  // later, it catches up (wake)
  var stale = false;
  function draw() {
    if (!host) return;
    if (!host.isConnected || host.closest('.hidden')) { stale = true; return; }
    stale = false;
    var c = car();
    if (!c) { host.innerHTML = ''; return; }
    var h = '<p class="lead small keep adv-lead">Things worth knowing about your ' + esc(G().shortName(c)) + ' before you drive.</p>';
    h += recallCard(c) + tireCard(c) + adviceCards(c);
    host.innerHTML = h;
    bind(c);
    syncDot();
  }
  function recallCard(c) {
    var key = recallKey(c);
    if (!key) return '<div class="card adv-card"><h3>Safety recalls</h3><div class="lead small keep">Pick your car in the Garage to see its recalls.</div></div>';
    var R = c.recalls;
    if (!R || R.key !== key || days(R.t) > 7 || (R.error && Date.now() - R.t > 3600e3)) fetchRecalls(c);
    var list = onRecord(c), chk = vinCheck(c), nm = name(c);
    rateAll(list);
    var q = A.qBtn('<b>Safety recalls</b> are problems a car maker must fix for free, at any of its dealers, for as long as you own the car. The list here is every recall on record for the ' + esc(nm) + ' from the National Highway Traffic Safety Administration. ' +
      'Checking your VIN shows which are still open on <i>your</i> car. Already-fixed recalls don\'t show up there, nor do recalls more than 15 years old or from some small manufacturers.');
    var h = '<div class="card adv-card adv-recall' + (chk && chk.open > 0 ? ' warn' : chk && !chk.open ? ' ok' : '') + '" id="advRecall"><h3>Safety recalls ' + q + '</h3>';
    var n = list ? list.length : 0;
    var park = list && list.some(function (x) { return x.park || x.out; });
    if (chk) {
      var when = A.ago(new Date(chk.t));
      if (chk.open > 0) {
        h += '<div class="adv-state bad"><b>' + chk.open + ' open recall' + (chk.open === 1 ? '' : 's') + ' on your car</b><small>Any ' + esc(c.make) + ' dealer fixes ' + (chk.open === 1 ? 'it' : 'them') + ' for free. Call one to book it, ideally before a long drive. Checked ' + esc(when) + '.</small></div>';
        var open = (list || []).filter(function (x) { return (chk.campaigns || []).indexOf(x.id) >= 0; });
        if (open.length) h += bySeverity(open).map(recallItem).join('');
        else if ((chk.items || []).length) h += chk.items.map(function (t) { return '<div class="rc"><p>' + esc(t) + '</p></div>'; }).join('');
      } else h += '<div class="adv-state good"><b>No open recalls on your car</b><small>Checked with your VIN at NHTSA ' + esc(when) + '. Gasket checks again every week.</small></div>';
      // no button: the VIN is checked again by itself in the background (weekly), so this is always fresh
    } else if (c.vin && (autoBusy[c.id] || (!(c.recallAuto && c.recallAuto.vin === c.vin && c.recallAuto.failed) && N.siteRead && (autoCheck(c), autoBusy[c.id])))) {
      h += A.ldBar('Checking your VIN with NHTSA') + '<div class="adv-state"><small>' + (n ? n + ' recall' + (n === 1 ? '' : 's') + ' on record for the ' + esc(nm) + '. Finding out which are still open on yours.' : 'Finding out whether any recalls are open on your car.') + '</small></div>';
    } else if (c.vin) {
      // only when the background check couldn't get an answer (or can't run here): NHTSA's page, shown to you
      var failed = c.recallAuto && c.recallAuto.vin === c.vin && c.recallAuto.failed;
      h += '<div class="adv-state"><b>' + (n ? n + ' recall' + (n === 1 ? '' : 's') + ' on record for the ' + esc(nm) : 'See if your car has open recalls') + '</b>' +
        '<small>' + (n ? 'Yours may already be fixed. ' : '') + (failed ? 'NHTSA didn\'t answer the automatic check. Gasket tries again in half an hour, or open its page now.' : 'NHTSA can tell from your VIN which recalls are still open on your car.') + '</small></div>' +
        '<div class="btns wrap"><button class="btn primary sm" id="advCheck">Check my car at NHTSA</button></div>';
    } else if (!list && busy[c.id]) {
      h += A.ldBar('Getting the recalls on record from NHTSA');   // the card is there right away; it fills in when they arrive
    } else {
      h += '<div class="adv-state"><b>' + (R && R.error && !list ? 'Couldn\'t reach NHTSA right now' : n ? n + ' recall' + (n === 1 ? '' : 's') + ' on record for the ' + esc(nm) : 'No recalls on record for the ' + esc(nm)) + '</b>' +
        '<small>' + (n ? 'These are for every ' + esc(nm) + '. ' : '') + 'Add your VIN in the Garage (Edit) to see whether any are still open on your car.</small></div>';
    }
    if (n && !(chk && chk.open > 0)) {
      h += '<details class="rc-list" id="advList"' + (listOpen ? ' open' : '') + '><summary>' + (chk ? 'All ' + n + ' recalls on record for this model' : 'See the recalls') + '</summary>' + bySeverity(list).map(recallItem).join('') + '</details>';
    }
    if (park && !(chk && !chk.open)) h += '<div class="lead small keep"><b>One of these says not to drive the car, or to park it outside, until it\'s fixed.</b></div>';
    return h + '</div>';
  }
  // ---------- how serious a recall is: rated on the phone by a small AI model (severity.js) ----------
  function severity(x) { return window.Severity ? Severity.get(x) : null; }   // null: not rated yet
  /** Rate what isn't rated yet (the model loads the first time), then draw again. */
  function onRated() { if (host && host.isConnected) draw(); }       // one callback (the rater calls it after each batch)
  function rateAll(list) { if (window.Severity && list && list.length) Severity.rate(list, onRated); }
  // the rater works harder while Advisory is what you're looking at
  if (window.Severity && Severity.focus) Severity.focus(function () { return !!(host && host.isConnected && !host.closest('.hidden') && !document.hidden); });
  var SEV_NAME = { 3: 'Serious', 2: 'Moderate', 1: 'Minor' };
  /** "POWER TRAIN:AXLE ASSEMBLY:HUB" -> "Power train › Axle assembly › Hub". */
  function compPlain(s) { return String(s || 'Recall').split(':').map(function (p) { p = p.trim().toLowerCase(); return p.charAt(0).toUpperCase() + p.slice(1); }).join(' › '); }
  /** NHTSA's "25/03/2021" (day / month / year) -> "Mar 25, 2021". */
  function dmy(s) { var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; }
  function datePlain(s) { var d = dmy(s); return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : String(s || ''); }
  function firstSentence(s) { s = String(s || '').replace(/\s+/g, ' ').trim(); var m = /^(.{20,140}?[.!?])\s/.exec(s + ' '); return m ? m[1] : s.slice(0, 140) + (s.length > 140 ? '…' : ''); }
  /** One recall as a tile: how serious, what part, one line; tap it for what's wrong, the risk, the fix and when it began. */
  function recallItem(x) {
    var key = x.id || x.comp || '', sec = function (title, body) {
      var k = key + '|' + title;
      return body ? '<details class="rc-sec" data-open="' + esc(k) + '"' + (rcOpen[k] ? ' open' : '') + '><summary>' + title + '</summary><p>' + esc(body) + '</p></details>' : '';
    };
    var sv = severity(x), lv = sv ? sv.level : 0;
    var pg = window.Severity && Severity.progress ? Severity.progress() : { f: 0, label: 'Rating' };
    var why = !sv ? '<span class="rc-plab">' + esc(pg.label) + '…</span>' : sv.fact ? sv.near : 'Rated ' + SEV_NAME[lv].toLowerCase() + ' by the small AI model on your phone. It reads most like: “' + sv.near + '”';
    return '<details class="rc-tile sev' + lv + '" data-open="' + esc(key) + '"' + (rcOpen[key] ? ' open' : '') + '><summary><span class="rc-sev">' + (sv ? SEV_NAME[lv] : 'Rating…') + '</span><span class="rc-t"><b>' + esc(compPlain(x.comp)) + '</b>' +
      '<small>' + esc(firstSentence(x.cons || x.sum)) + '</small></span>' +
      (sv ? '' : '<span class="rc-bar' + (pg.f ? '' : ' ind') + '"><i style="transform:scaleX(' + pg.f.toFixed(3) + ')"></i></span>') + '</summary>' +
      '<div class="rc-why">' + (sv ? esc(why) : why) + (x.ota ? ' Fixed over the air.' : '') + '</div>' +
      sec('What\'s wrong', x.sum) + sec('The risk', x.cons) + sec('The fix', x.fix) +
      sec('When it began', ((x.date ? 'Reported to NHTSA ' + datePlain(x.date) + '.' : '') + (x.id ? ' NHTSA campaign ' + x.id + '.' : '')).trim()) + '</details>';
  }
  // the bars on the tiles still being rated follow the model's progress, without redrawing the page
  if (window.Severity && Severity.onProgress) Severity.onProgress(function (p) {
    if (!host || !host.isConnected) return;
    host.querySelectorAll('.rc-bar').forEach(function (b) { b.classList.toggle('ind', !p.f); b.firstChild.style.transform = 'scaleX(' + p.f.toFixed(3) + ')'; });
    host.querySelectorAll('.rc-plab').forEach(function (l) { l.textContent = p.label + '…'; });
  });
  var rcOpen = {};   // which recall tiles and sections you've opened (kept when Advisory redraws)
  /** Most serious first, then newest. */
  function bySeverity(list) {
    var lv = function (x) { var s = severity(x); return s ? s.level : 0; };
    return list.slice().sort(function (a, b) { return lv(b) - lv(a) || ((dmy(b.date) || 0) - (dmy(a.date) || 0)); });
  }
  function tireAdvice(c) { return window.Tires ? Tires.advice(c) : []; }
  function tireCard(c) {
    var l = tireAdvice(c); if (!l.length) return '';
    return '<div class="card adv-card adv-tires' + (l.some(function (x) { return x.level === 'warn'; }) ? ' warn' : '') + '" id="advTires"><h3>Tires</h3>' +
      l.map(function (x) {
        return '<div class="adv-item' + (x.level === 'done' ? ' done' : x.level === 'warn' ? ' due' : '') + '"><div class="adv-t"><b>' + esc(x.title) + '</b></div><p>' + esc(x.text) + '</p>' +
          (x.check ? '<label class="adv-chk"><input type="checkbox" data-tchk="' + esc(x.check.id) + '"' + (x.check.on ? ' checked' : '') + '><span>' + esc(x.check.label) + '</span></label>' : '') + '</div>';
      }).join('') + '</div>';
  }
  function adviceCards(c) {
    var l = adviceFor(c);
    if (!l.length) return '<div class="card adv-card"><h3>Engine-friendly settings</h3><div class="lead small keep">Nothing to change. Your ' + esc(G().shortName(c)) + ' doesn\'t have features that trade engine life for a little gas, as far as Gasket knows. ' +
      'If it does, check them under About this car in the Garage.</div></div>';
    return '<div class="card adv-card"><h3>Worth turning off ' + A.qBtn('Some features save a little gas but put extra wear on the engine. Gasket suggests turning these off. The choice is yours, and it doesn\'t mean there\'s anything wrong with your car.') + '</h3>' +
      l.map(function (a, i) {
        var ch = choice(c, a);
        return '<div class="adv-item' + (ch ? ' done' : '') + '"><div class="adv-t"><b>' + esc(a.title) + '</b>' + A.qBtn(a.q) + (ch ? '<span class="adv-tag">' + (ch === 'off' ? 'Turned off' : 'Kept on') + '</span>' : '') + '</div>' +
          (ch ? '' : '<p>' + esc(a.what) + ' ' + esc(a.why) + '</p><p><b>How:</b> ' + esc(a.how) + '</p>') +
          '<div class="btns wrap">' + (ch ? '<button class="btn tonal sm" data-adv="' + i + '" data-v="">Change</button>' :
            '<button class="btn tonal sm" data-adv="' + i + '" data-v="off">I\'ve turned it off</button><button class="btn tonal sm" data-adv="' + i + '" data-v="keep">Keep it on</button>') + '</div></div>';
      }).join('') + '</div>';
  }
  function bind(c) {
    if ($('advCheck')) $('advCheck').onclick = function () { checkVin(c); };
    host.querySelectorAll('[data-tchk="spare"]').forEach(function (b) { b.onchange = function () { if (window.Tires) Tires.setAired(c, b.checked); syncDot(); draw(); }; });
    if ($('advList')) $('advList').addEventListener('toggle', function () { listOpen = this.open; });
    host.querySelectorAll('details[data-open]').forEach(function (d) { d.addEventListener('toggle', function (e) { if (e.target === d) rcOpen[d.dataset.open] = d.open; }); });
    host.querySelectorAll('[data-adv]').forEach(function (b) {
      b.onclick = function () {
        var a = adviceFor(c)[+b.dataset.adv]; if (!a) return;
        c.advice = Object.assign({}, c.advice); if (b.dataset.v) c.advice[a.feat] = b.dataset.v; else delete c.advice[a.feat];
        save(); draw(); changed();
      };
    });
  }
  /** Load the recalls on record for the car (NHTSA's free API, never Google) so the step dot and Departure know about
   * them before Advisory is opened. */
  function prefetch() { var c = car(); if (!c || !call) return; var R = c.recalls, key = recallKey(c);
    if (key && (!R || R.key !== key || days(R.t) > 7)) fetchRecalls(c); else syncDot();
    autoCheck(c); }
  function init(nativeCall) { call = nativeCall || call; prefetch(); }
  window.addEventListener('garagechange', function () { prefetch(); if (host && host.isConnected) draw(); });
  function wake() { if (stale) draw(); }

  window.Advisory = { init: init, render: render, wake: wake, attention: attention, departureNote: departureNote, onRecord: onRecord, vinCheck: vinCheck, ADVICE: ADVICE, adviceFor: adviceFor,
    severity: severity, onChange: function (f) { onChange = f; } };
})();
