/* Your cars: EPA numbers (read-only), observed mileage (+ a log with typical speed), tank size, and the
 * best-cruising-speed card. Loaded after tripui.js; the trip setup page calls Garage.render(...). */
(function () {
  'use strict';
  var A = window.__app, S = A.S, N = A.N, P = A.P, $ = A.$, esc = A.esc, SP = window.Speed;
  var LG = window.FLog || { info: function () {}, debug: function () {}, warn: function () {} };
  var EPA = 'https://www.fueleconomy.gov/ws/rest/vehicle/';

  // Tank sizes we could confirm from manufacturer spec sheets (no free API publishes tank capacity —
  // fueleconomy.gov and NHTSA's vPIC don't have it). Anything else: type it from the owner's manual.
  var TANKS = [
    { make: /^toyota$/i, model: /^corolla$/i, from: 2016, to: 2016, gal: 11.3, src: 'Toyota spec (via Edmunds, new-cars.com)' },
    { make: /^toyota$/i, model: /^venza/i, from: 2011, to: 2011, gal: 20.0, src: 'Toyota spec (via Cars.com, CarsDirect)' }
  ];
  function tankFor(c) {
    var t = TANKS.filter(function (x) { return x.make.test(c.make || '') && x.model.test(c.model || '') && c.year >= x.from && c.year <= x.to; })[0];
    return t || null;
  }
  // U.S. DOT benefit-cost guidance (2026 update, 2024 dollars): value of time for intercity personal trips.
  var DOT_TIME = 28.2;

  // ---------- data ----------
  function seeds() {
    return [
      { id: 'corolla20', name: '2020 Toyota Corolla Hybrid LE', year: 2016, make: 'Toyota', model: 'Corolla Hybrid', epaId: '41214',
        epa: { city: 54, hwy: 50, comb: 52, fuel: 'Regular Gasoline' }, type: 'hybrid', grade: 'regular',
        tank: 11.3, tankSrc: TANKS[0].src, obs: {}, entries: [] },
      { id: 'venza12', name: '2012 Toyota Venza XLE 3.5L V6 FWD', year: 2011, make: 'Toyota', model: 'Venza',
        epa: { city: 18, hwy: 24, comb: 20, fuel: 'Regular Gasoline' }, type: 'suv', grade: 'regular',
        tank: 20, tankSrc: TANKS[1].src, obs: {}, entries: [] }
    ];
  }
  if (!Array.isArray(S.cars) || !S.cars.length) {
    S.cars = seeds();
    var old = S.car;
    if (old && old.name && !/corolla|venza/i.test(old.name)) {     // keep a car set up in an earlier version
      S.cars.unshift({ id: 'c' + Date.now(), name: old.name, epa: { city: old.city, hwy: old.hwy, comb: old.comb, fuel: old.epaFuel || '' },
        type: 'car', grade: old.grade || '', tank: old.tank, tankSrc: 'you entered it',
        obs: old.adjustPct && old.adjustPct !== 100 ? { city: r1(old.city * old.adjustPct / 100), hwy: r1(old.hwy * old.adjustPct / 100) } : {}, entries: [] });
    }
    S.carId = S.cars[0].id;
  }
  S.speed = Object.assign({ min: 55, max: 84, price: '' }, S.speed || {});

  function r1(v) { return Math.round(v * 10) / 10; }
  function car() { return S.cars.filter(function (c) { return c.id === S.carId; })[0] || S.cars[0]; }
  function harm(city, hwy) { return 1 / (0.55 / city + 0.45 / hwy); }
  function obsCity(c) { return +c.obs.city > 0 ? +c.obs.city : (c.epa && c.epa.city) || 0; }
  function obsHwy(c) { return +c.obs.hwy > 0 ? +c.obs.hwy : (c.epa && c.epa.hwy) || 0; }
  function hasEpa(c) { return c.epa && c.epa.city > 0 && c.epa.hwy > 0; }
  function pctOf(c) { return hasEpa(c) ? Math.round(harm(obsCity(c), obsHwy(c)) / harm(c.epa.city, c.epa.hwy) * 100) : 100; }
  /** What the trip planner uses: your observed numbers where you have them, else the EPA's. */
  function carModel() {
    var c = car(), city = obsCity(c) || 25, hwy = obsHwy(c) || 33;
    var comb = hasEpa(c) && c.epa.comb ? c.epa.comb * harm(city, hwy) / harm(c.epa.city, c.epa.hwy) : harm(city, hwy);
    return { city: city, hwy: hwy, comb: comb, adjustPct: 100 };
  }
  function grade() { return car().grade || S.grade || 'regular'; }
  function tank() { return +car().tank || 14; }
  function save() { A.save(); }

  // ---------- page ----------
  var host = null, speedHost = null, onChange = function () {}, editing = false, call = null, epaOpen = false;
  function render(carEl, speedEl, changed, nativeCall) {
    host = carEl; speedHost = speedEl; onChange = changed || onChange; call = nativeCall || call;
    draw();
  }
  function changed() { save(); onChange(); drawSpeed(); }

  var drawing = false;
  function draw() {
    if (!host || drawing) return;
    drawing = true;
    try { settle(host); draw0(); } finally { drawing = false; }
  }
  function draw0() {
    var c = car();
    var h = '<h3>2 · Your car</h3><div class="chips cars" id="gCars">' + S.cars.map(function (x) {
      return '<button data-car="' + esc(x.id) + '" class="' + (x.id === c.id ? 'on' : '') + '">' + esc(shortName(x)) + '</button>';
    }).join('') + '<button data-car="+">+ Add car</button></div>';
    h += '<div class="g-head"><div><b>' + esc(c.name || 'New car') + '</b><span>' + esc((SP.TYPES[c.type] || SP.TYPES.car).label) + ' · ' +
      esc((P.GRADES[grade()] || {}).label || grade()) + ' · ' + (c.tank ? c.tank + ' gal tank' : 'tank size not set') + '</span></div>' +
      '<button class="btn tonal sm" id="gEdit">' + (editing ? 'Done' : 'Edit') + '</button></div>';
    if (hasEpa(c)) {
      h += '<div class="epa-tiles"><div><b>' + c.epa.city + '</b><span>EPA city</span></div><div><b>' + c.epa.hwy + '</b><span>EPA highway</span></div>' +
        '<div><b>' + (c.epa.comb || Math.round(harm(c.epa.city, c.epa.hwy))) + '</b><span>EPA combined</span></div></div>' +
        '<details class="epa-note"><summary>How the EPA got these</summary><p>Lab tests on a dynamometer. <b>City</b>: stop-and-go, averaging 21 mph (top 56 mph). ' +
        '<b>Highway</b>: averaging 48 mph (top 60 mph). Since 2008 the label is also adjusted with a faster, harder test (averaging 48 mph, up to 80 mph), ' +
        'A/C on a hot day and a 20°F cold start — so it already reads lower than the raw lab runs, but steady 70+ mph cruising still uses more.</p>' +
        '<p class="src">Source: fueleconomy.gov' + (c.epaId ? ' · vehicle ' + esc(c.epaId) : '') + '</p></details>';
    } else h += '<div class="msg">No EPA numbers yet — tap Edit and look your car up.</div>';
    if (editing) h += editPanel(c);
    h += obsPanel(c);
    host.innerHTML = h;
    bind(c);
    drawSpeed();
  }
  function shortName(x) {
    if (x.year && x.model) return x.year + ' ' + String(x.model).replace(/\s+(2WD|4WD|FWD|AWD)$/i, '');
    return x.name || 'New car';
  }
  function editPanel(c) {
    var auto = c.typeAuto ? ' (from the EPA: ' + SP.TYPES[c.typeAuto].label.toLowerCase() + ')' : '';
    return '<div class="g-edit">' +
      '<label class="nf wide"><span>Name</span><input type="text" id="gName" value="' + esc(c.name || '') + '"></label>' +
      '<div class="grid2"><label class="nf"><span>Tank size (gal)<span class="req" aria-label="required">*</span><small>' + esc(c.tankSrc || 'from your owner\'s manual') + '</small></span>' +
      '<input type="number" inputmode="decimal" step="0.1" id="gTank" value="' + esc(c.tank || '') + '"></label>' +
      '<label class="nf"><span>Fuel grade<small>' + esc(c.epa && c.epa.fuel ? 'EPA: ' + c.epa.fuel : '&nbsp;') + '</small></span><select id="gGrade">' + Object.keys(P.GRADES).map(function (g) {
        return '<option value="' + g + '"' + (grade() === g ? ' selected' : '') + '>' + P.GRADES[g].label + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="nf wide"><span>Vehicle type<small>shapes the cruising-speed curve' + esc(auto) + '</small></span><select id="gType">' + Object.keys(SP.TYPES).map(function (k) {
        return '<option value="' + k + '"' + ((c.type || 'car') === k ? ' selected' : '') + '>' + SP.TYPES[k].label + '</option>'; }).join('') + '</select></label>' +
      '<details class="epa" id="tEpa"' + (hasEpa(c) && !epaOpen ? '' : ' open') + '><summary>' + (hasEpa(c) ? 'Change car (EPA lookup)' : 'Look up EPA mileage by year / make / model') + '</summary>' +
      '<div class="epa-grid"><select id="eYear"><option value="">Year</option></select><select id="eMake" disabled><option>Make</option></select>' +
      '<select id="eModel" disabled><option>Model</option></select><select id="eOpt" disabled><option>Engine / transmission</option></select></div>' +
      '<div class="epa-msg" id="eMsg"></div></details>' +
      (S.cars.length > 1 ? '<button class="btn tonal danger" id="gRemove">Remove this car</button>' : '') + '</div>';
  }
  function obsPanel(c) {
    var hw = avg(c, 'highway'), ct = avg(c, 'city');
    var h = '<div class="sub-h">Observed mileage<small>What your car really gets. Trip plans use these; blank = EPA.</small></div>' +
      '<div class="grid3">' +
      '<label class="nf"><span>City mpg</span><input type="number" inputmode="decimal" step="0.1" id="oCity" placeholder="' + esc(hasEpa(c) ? c.epa.city : '') + '" value="' + esc(c.obs.city || '') + '"></label>' +
      '<label class="nf"><span>Highway mpg</span><input type="number" inputmode="decimal" step="0.1" id="oHwy" placeholder="' + esc(hasEpa(c) ? c.epa.hwy : '') + '" value="' + esc(c.obs.hwy || '') + '"></label>' +
      '<label class="nf"><span>% of EPA</span><input type="number" inputmode="decimal" step="1" id="oPct" value="' + pctOf(c) + '"' + (hasEpa(c) ? '' : ' disabled') + '></label></div>';
    if (hw || ct) h += '<div class="lead small keep">Your log averages ' + [ct ? ct.mpg.toFixed(1) + ' city (' + ct.n + ')' : '', hw ? hw.mpg.toFixed(1) + ' highway (' + hw.n + ')' : ''].filter(Boolean).join(' · ') +
      '. <a href="#" id="oUseLog">Use these</a></div>';
    h += '<div class="log-list">' + (c.entries.length ? c.entries.slice().reverse().map(function (e) {
      return '<div class="log-row"><b>' + (+e.mpg).toFixed(1) + ' mpg</b><span>' + esc(e.kind) + (e.speed ? ' · at ' + e.speed + ' mph' : '') + ' · ' + esc(fmtDate(e.date)) + '</span>' +
        '<button class="x sm" data-del="' + esc(e.id) + '" aria-label="Delete entry">✕</button></div>';
    }).join('') : '<div class="lead small">No logged mileage yet. Log a tank or a stretch of driving below — add the speed you held to calibrate the cruising-speed card.</div>') + '</div>';
    h += '<div class="log-add"><div class="grid3">' +
      '<label class="nf"><span>mpg<span class="req" aria-label="required">*</span></span><input type="number" inputmode="decimal" step="0.1" id="lMpg"></label>' +
      '<label class="nf"><span>Driving</span><select id="lKind"><option value="highway">Highway</option><option value="city">City</option><option value="mixed">Mixed</option></select></label>' +
      '<label class="nf"><span>Typical speed when observed<small>mph · optional</small></span><input type="number" inputmode="numeric" step="1" id="lSpeed"></label></div>' +
      '<button class="btn tonal" id="lAdd">Log mileage</button></div>';
    return h;
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fmtDate(d) { try { var p = String(d).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return d; } }
  function avg(c, kind) {
    var es = c.entries.filter(function (e) { return e.kind === kind && +e.mpg > 0; });
    if (!es.length) return null;
    return { mpg: es.reduce(function (a, e) { return a + +e.mpg; }, 0) / es.length, n: es.length };
  }

  function bind(c) {
    host.querySelectorAll('[data-car]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.car === '+') {
          var nc = { id: 'c' + Date.now(), name: '', type: 'car', grade: '', tank: '', tankSrc: '', obs: {}, entries: [], epa: null };
          S.cars.push(nc); S.carId = nc.id; editing = true;
        } else { S.carId = b.dataset.car; editing = false; }
        LG.info('car', 'Selected ' + (car().name || 'new car'));
        draw(); changed();
      };
    });
    $('gEdit').onclick = function () { editing = !editing; draw(); };
    if (editing) {
      $('gName').onchange = function () { c.name = this.value.trim(); draw(); save(); };
      $('gTank').onchange = function () { var v = parseFloat(this.value); c.tank = v > 0 ? r1(v) : ''; c.tankSrc = v > 0 ? 'you entered it' : ''; changed(); draw(); };
      $('gGrade').onchange = function () { c.grade = this.value; changed(); draw(); };
      $('gType').onchange = function () { c.type = this.value; changed(); draw(); };
      $('tEpa').addEventListener('toggle', function () { if ($('tEpa').open && $('eYear').options.length < 2) epaYears(c); });
      if ($('tEpa').open && !hasEpa(c)) epaYears(c);
      if ($('gRemove')) $('gRemove').onclick = function () {
        S.cars = S.cars.filter(function (x) { return x !== c; }); S.carId = S.cars[0].id; editing = false; draw(); changed();
      };
    }
    // observed mileage <-> % of EPA
    var oc = $('oCity'), oh = $('oHwy'), op = $('oPct');
    var fromNums = function () {
      c.obs.city = parseFloat(oc.value) > 0 ? r1(parseFloat(oc.value)) : null;
      c.obs.hwy = parseFloat(oh.value) > 0 ? r1(parseFloat(oh.value)) : null;
      op.value = pctOf(c); changedSoon();
    };
    oc.oninput = oh.oninput = fromNums;
    op.oninput = function () {
      var p = parseFloat(op.value); if (!(p > 0) || !hasEpa(c)) return;
      c.obs.city = p === 100 ? null : r1(c.epa.city * p / 100); c.obs.hwy = p === 100 ? null : r1(c.epa.hwy * p / 100);
      oc.value = c.obs.city || ''; oh.value = c.obs.hwy || ''; changedSoon();
    };
    if ($('oUseLog')) $('oUseLog').onclick = function (e) {
      e.preventDefault(); var hw = avg(c, 'highway'), ct = avg(c, 'city');
      if (ct) c.obs.city = r1(ct.mpg); if (hw) c.obs.hwy = r1(hw.mpg); draw(); changed();
    };
    host.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { c.entries = c.entries.filter(function (e) { return e.id !== b.dataset.del; }); draw(); changed(); };
    });
    $('lAdd').onclick = function () {
      var mpg = parseFloat($('lMpg').value), sp = parseFloat($('lSpeed').value);
      if (!(mpg > 0 && mpg < 250)) { $('lMpg').focus(); return; }
      var e = { id: 'e' + Date.now(), date: today(), mpg: r1(mpg), kind: $('lKind').value };
      if (sp >= 5 && sp <= 120) e.speed = Math.round(sp);
      c.entries.push(e);
      LG.info('car', 'Logged mileage', e);
      draw(); changed();
    };
  }
  var soonT;
  function changedSoon() { clearTimeout(soonT); soonT = setTimeout(changed, 300); }

  // ---------- EPA lookup ----------
  function items(body) { try { var j = JSON.parse(body); var m = j && j.menuItem; return !m ? [] : Array.isArray(m) ? m : [m]; } catch (e) { return []; } }
  async function epaGet(path) { var r = await call('fetchJson', EPA + path); if (r.error) throw new Error(r.error); return r.body; }
  function fill(sel, list, ph) {
    sel.innerHTML = '<option value="">' + ph + '</option>' + list.map(function (x) { return '<option value="' + esc(x.value) + '">' + esc(x.text) + '</option>'; }).join('');
    sel.disabled = !list.length;
  }
  function eMsg(m, err) { var el = $('eMsg'); if (el) { el.textContent = m || ''; el.classList.toggle('err', !!err); } }
  async function epaYears(c) {
    try {
      var had = $('eMsg') && $('eMsg').textContent;
      if (!had) eMsg('Loading…');
      fill($('eYear'), items(await epaGet('menu/year')), 'Year'); if (!had) eMsg('');
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
        var opt = $('eOpt').selectedOptions[0] ? $('eOpt').selectedOptions[0].text : '';
        c.name = [v.year, v.make, v.model].join(' ') + (opt ? ' · ' + opt : '');
        c.year = +v.year; c.make = v.make; c.model = v.model; c.epaId = String(v.id || id);
        c.epa = { city: city, hwy: hwy, comb: comb || Math.round(harm(city, hwy)), fuel: fuel };
        c.grade = /premium/i.test(fuel) ? 'premium' : /midgrade/i.test(fuel) ? 'midgrade' : /diesel/i.test(fuel) ? 'diesel' : 'regular';
        c.typeAuto = SP.typeFromEpa(v); c.type = c.typeAuto;
        var t = tankFor(c);
        if (t) { c.tank = t.gal; c.tankSrc = t.src; } else if (c.tankSrc !== 'you entered it') { c.tank = ''; c.tankSrc = ''; }
        LG.info('car', 'EPA lookup', { id: c.epaId, name: c.name, epa: c.epa, type: c.type, tank: c.tank });
        editing = true; epaOpen = true; draw(); epaOpen = false; changed();
        eMsg(t ? 'Set from the EPA; tank size from ' + t.src + '.' : 'Set from the EPA. Enter your tank size — the EPA doesn\'t publish it (owner\'s manual or fuel-door sticker).');
      };
    } catch (e) { eMsg('Couldn\'t reach fueleconomy.gov: ' + e.message + '.', true); }
  }

  // ---------- best cruising speed ----------
  function nearbyCheapest() {
    var g = grade(), best = null, now = new Date();
    (A.stations ? A.stations() : []).forEach(function (s) {
      var c = P.compute(s, g, S, now);
      if (c && !c.stale && c.final > 0 && (!best || c.final < best.price)) best = { price: c.final, name: s.name };
    });
    return best;
  }
  function speedModel() {
    var c = car(); if (!hasEpa(c)) return null;
    var cal = SP.calibrate(c.type || 'car', c.epa.hwy, c.entries);
    var near = nearbyCheapest(), over = parseFloat(S.speed.price);
    var price = over > 0 ? over : near ? near.price : 3.0;
    var tv = +S.trip.timeValue || 0;
    var min = Math.max(25, Math.round(+S.speed.min || 55)), max = Math.max(min + 5, Math.round(+S.speed.max || 84));
    var rec = SP.recommend({ type: c.type || 'car', epaHwy: c.epa.hwy, scale: cal.scale, min: min, max: max, price: price, timeValue: tv });
    return { c: c, cal: cal, near: near, price: price, priceSrc: over > 0 ? 'yours' : near ? 'near' : 'default', tv: tv, min: min, max: max, rec: rec };
  }
  function mpgFn(c, cal) {
    var cv = SP.curve(c.type || 'car', c.epa.hwy, cal.scale, 30, 95);
    return function (v) { return SP.at(cv, Math.max(30, Math.min(95, v))); };
  }
  var lastTripMi = 0;
  var drawingSpeed = false;
  function drawSpeed() {
    if (!speedHost || drawingSpeed) return;
    drawingSpeed = true;
    try { drawSpeed0(); } finally { drawingSpeed = false; }
  }
  function settle(el) {   // commit a focused input inside el before replacing it (its change event would re-render mid-way)
    var ae = document.activeElement;
    if (ae && el.contains(ae) && ae.blur) ae.blur();
  }
  function drawSpeed0() {
    settle(speedHost);
    var m = speedModel(), c = car();
    var wasOpen = speedHost.querySelector('details.spd-card') && speedHost.querySelector('details.spd-card').open;
    var h = '<details class="spd-card"' + (wasOpen ? ' open' : '') + '><summary><span class="h3">Best cruising speed · ' + esc(shortName(c)) + '</span>' +
      (m ? '<b class="spd-pill">' + m.rec.speed + ' mph</b>' : '') + '</summary>';
    if (!m) { speedHost.innerHTML = h + '<div class="lead small keep">Look your car up from the EPA (Edit) to see this.</div></details>'; return; }
    var r = m.rec, row = r.rows[r.speed - m.min], f = mpgFn(c, m.cal), bal = SP.balanced(f, m.min, m.max);
    h += '<div class="spd-top"><div class="spd-big">' + r.speed + '<span>mph</span></div><div class="spd-sub">about ' + row.mpg.toFixed(0) + ' mpg · ' + row.galPer100.toFixed(2) + ' gal per 100 mi<br>' +
      (r.mode === 'time' ? 'where an hour saved costs about your $' + m.tv + '/hr' : 'past this, each 1% of time saved costs more than 1% more gas') + '</div></div>';
    h += chartSvg(r.rows, m.min, m.max, { id: 'gChart', shadeTo: bal, sel: r.speed, points: m.cal.points });
    var tripMi = lastTripMi || 500;
    h += '<div class="spd-try"><div class="spd-try-h"><span>Try a speed for a <input type="number" inputmode="numeric" id="gTripMi" value="' + Math.round(tripMi) + '">-mile trip</span></div>' +
      '<input type="range" id="gTry" min="' + m.min + '" max="' + m.max + '" step="1" value="' + r.speed + '"><div class="spd-out" id="gTryOut"></div></div>';
    if (r.mode === 'time' && r.speed === m.max) h += '<div class="lead small">At $' + m.tv + '/hr, gas never outweighs the time saved up to your ' + m.max + ' mph maximum — speed limits and safety are the real limit.</div>';
    h += '<div class="lead small">' + (m.cal.used ? 'Calibrated from ' + m.cal.used + ' of your entries (your ' + esc(shortName(c)) + ' runs ' + Math.abs(Math.round((m.cal.scale - 1) * 100)) + '% ' + (m.cal.scale >= 1 ? 'better' : 'worse') + ' than the average curve).'
      : 'Not calibrated yet — log mileage with the speed you held to fit this to your car.') +
      ' Curve: ' + esc((SP.TYPES[c.type] || SP.TYPES.car).label.toLowerCase()) + ', anchored at ' + (c.type === 'hybrid' ? '1.3 × ' : '') + 'EPA highway (' + c.epa.hwy + ' mpg) at 55 mph. Shaded: speeds where going 1% faster saves more time than it costs in gas.</div>';
    h += '<details class="spd-set"><summary>Speed settings · gas ' + money(m.price) + (m.priceSrc === 'near' ? ' (cheapest near you)' : m.priceSrc === 'yours' ? ' (yours)' : ' (no prices loaded)') + '</summary><div class="grid2">' +
      '<label class="nf"><span>Gas price ($/gal)<small>' + (m.near ? 'blank = cheapest near you: ' + money(m.near.price) + ' at ' + esc(m.near.name) : 'blank = cheapest on the map') + '</small></span><input type="number" inputmode="decimal" step="0.01" id="sPrice" value="' + esc(S.speed.price) + '"></label>' +
      '<label class="nf"><span>My time is worth ($/hr)<small>optional · 0 = balanced (US DOT uses ~$' + Math.round(DOT_TIME) + ' for road trips)</small></span><input type="number" inputmode="decimal" step="1" id="sTime" value="' + esc(S.trip.timeValue || 0) + '"></label>' +
      '<label class="nf"><span>Minimum speed (mph)</span><input type="number" inputmode="numeric" step="1" id="sMin" value="' + m.min + '"></label>' +
      '<label class="nf"><span>Maximum speed (mph)</span><input type="number" inputmode="numeric" step="1" id="sMax" value="' + m.max + '"></label></div></details>';
    h += disclaimer() + '</details>';
    var open = speedHost.querySelector('.spd-set') && speedHost.querySelector('.spd-set').open;
    speedHost.innerHTML = h;
    if (open) speedHost.querySelector('.spd-set').open = true;
    var upd = function () {
      S.speed.price = $('sPrice').value.trim();
      S.trip.timeValue = Math.max(0, parseFloat($('sTime').value) || 0);
      if ($('tTime')) $('tTime').value = S.trip.timeValue;
      var a = parseInt($('sMin').value, 10), b = parseInt($('sMax').value, 10);
      if (a >= 25 && a <= 100) S.speed.min = a; if (b >= 30 && b <= 110) S.speed.max = b;
      save(); drawSpeed();
    };
    ['sPrice', 'sTime', 'sMin', 'sMax'].forEach(function (id) { $(id).onchange = upd; });
    var tryOut = function () {
      var v = +$('gTry').value, mi = Math.max(1, parseFloat($('gTripMi').value) || 500), base = r.speed;
      var t = mi * (1 / base - 1 / v) * 60, gal = mi * (1 / f(v) - 1 / f(base)), cost = gal * m.price;
      moveSel($('gChart'), v, 100 / f(v));
      $('gTryOut').innerHTML = v === base ? '<b>' + v + ' mph</b> — the recommended speed. Slide to see what going faster or slower costs over ' + fmtMi(mi) + '.'
        : '<b>' + v + ' mph</b> instead of ' + base + ': ' + (t > 0 ? '<b>' + fmtMin(t) + ' sooner</b> for <b class="cost">+' + money(cost) + '</b> in gas'
          : '<b>' + fmtMin(-t) + ' later</b>, <b class="good">saves ' + money(-cost) + '</b> in gas') + ' over ' + fmtMi(mi) + ' (at ' + money(m.price) + '/gal).';
    };
    $('gTry').oninput = tryOut; guardRange($('gTry'));
    $('gTripMi').onchange = function () { lastTripMi = parseFloat(this.value) || 500; tryOut(); };
    tryOut();
  }
  function disclaimer() {
    return '<p class="disclaimer">Estimates based on average vehicle behavior (Oak Ridge National Lab, 74 vehicles; hybrid steady-speed tests). Wind, hills, A/C, tires and load change real results. Always drive within the speed limit.</p>';
  }
  function money(v) { return '$' + Math.abs(v).toFixed(2); }
  function fmtMin(m) { m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }
  function fmtMi(mi) { return Math.round(mi).toLocaleString() + ' mi'; }

  /** gal/100 mi vs speed; shaded where 1% faster saves more time than it costs in gas; a movable selection line. */
  function chartSvg(rows, min, max, o) {
    var W = 320, H = 136, L = 34, R = 10, T = 14, B = 22;
    var ys = rows.map(function (r) { return r.galPer100; }), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var pad = (y1 - y0) * 0.12 || 0.2; y0 = Math.max(0, y0 - pad); y1 += pad;
    var X = function (v) { return L + (v - min) / (max - min) * (W - L - R); }, Y = function (g) { return T + (1 - (g - y0) / (y1 - y0)) * (H - T - B); };
    var d = rows.map(function (r, i) { return (i ? 'L' : 'M') + X(r.mph).toFixed(1) + ' ' + Y(r.galPer100).toFixed(1); }).join(' ');
    var s = '<svg class="spd-chart" id="' + o.id + '" viewBox="0 0 ' + W + ' ' + H + '" data-g="' + [min, max, L, R, T, B, W, H, y0, y1].join(',') + '" role="img" aria-label="Gallons per 100 miles by speed">';
    if (o.shadeTo > min) {
      s += '<rect class="zone" x="' + X(min) + '" y="' + T + '" width="' + (X(Math.min(max, o.shadeTo)) - X(min)) + '" height="' + (H - T - B) + '"/>' +
        '<text class="zt" x="' + (X(min) + 4) + '" y="' + (T + 11) + '">time gain &gt; gas cost</text>';
    }
    for (var k = 0; k <= 2; k++) { var gv = y0 + (y1 - y0) * k / 2; s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(gv) + '" y2="' + Y(gv) + '"/><text class="ax" x="' + (L - 4) + '" y="' + (Y(gv) + 3) + '" text-anchor="end">' + gv.toFixed(1) + '</text>'; }
    for (var v = Math.ceil(min / 5) * 5; v <= max; v += 5) s += '<text class="ax" x="' + X(v) + '" y="' + (H - 6) + '" text-anchor="middle">' + v + '</text>';
    (o.marks || []).forEach(function (mk, i) { s += '<line class="mk" data-i="' + i + '" x1="' + X(mk) + '" x2="' + X(mk) + '" y1="' + T + '" y2="' + (H - B) + '"/>'; });
    s += '<path class="ln" d="' + d + '"/>';
    (o.points || []).forEach(function (p) { var sp = +p.e.speed; if (sp >= min && sp <= max) s += '<circle class="obs" cx="' + X(sp) + '" cy="' + Y(100 / p.e.mpg) + '" r="3"/>'; });
    var sv = Math.max(min, Math.min(max, o.sel)), sr = rows[Math.round(sv) - min] || rows[0];
    s += '<line class="rec sel-l" x1="' + X(sv) + '" x2="' + X(sv) + '" y1="' + T + '" y2="' + (H - B) + '"/><circle class="dot sel-d" cx="' + X(sv) + '" cy="' + Y(sr.galPer100) + '" r="4.5"/>' +
      '<text class="ax sel-t" x="' + X(sv) + '" y="' + (T - 4) + '" text-anchor="middle">' + Math.round(sv) + '</text>';
    s += '<text class="ax unit" x="' + (W - R) + '" y="' + (T - 4) + '" text-anchor="end">gal / 100 mi</text></svg>';
    return s;
  }
  /** Move one road section's faint marker line on the chart to its current speed. */
  function moveMark(svg, i, mph) {
    if (!svg) return;
    var l = svg.querySelector('.mk[data-i="' + i + '"]'); if (!l) return;
    var g = svg.getAttribute('data-g').split(',').map(Number), min = g[0], max = g[1], L = g[2], R = g[3], W = g[6];
    var x = L + (Math.max(min, Math.min(max, mph)) - min) / (max - min) * (W - L - R);
    l.setAttribute('x1', x); l.setAttribute('x2', x);
  }
  /**
   * Sliders that only move when you grab the knob: a touch that starts away from the knob (scrolling past, or a stray
   * tap) leaves the value alone, so scrolling the list can't knock a setting.
   */
  function guardRange(inp) {
    if (!inp || inp._guarded) return;
    inp._guarded = true;
    var far = false, startVal = null;
    inp.addEventListener('pointerdown', function (e) {
      var r = inp.getBoundingClientRect(), min = +inp.min, max = +inp.max, f = (+inp.value - min) / ((max - min) || 1);
      var thumbX = r.left + 14 + f * (r.width - 28);
      far = Math.abs(e.clientX - thumbX) > 30; startVal = inp.value;
    }, true);
    var hold = function (e) { if (far) { inp.value = startVal; e.stopImmediatePropagation(); e.preventDefault(); } };
    inp.addEventListener('input', hold, true);
    inp.addEventListener('change', hold, true);
    var end = function () { setTimeout(function () { far = false; }, 0); };
    inp.addEventListener('pointerup', end); inp.addEventListener('pointercancel', end);
  }
  function moveSel(svg, mph, gal) {
    if (!svg) return;
    var g = svg.getAttribute('data-g').split(',').map(Number), min = g[0], max = g[1], L = g[2], R = g[3], T = g[4], B = g[5], W = g[6], H = g[7], y0 = g[8], y1 = g[9];
    var v = Math.max(min, Math.min(max, mph)), x = L + (v - min) / (max - min) * (W - L - R), y = T + (1 - (gal - y0) / (y1 - y0)) * (H - T - B);
    var l = svg.querySelector('.sel-l'), d = svg.querySelector('.sel-d'), t = svg.querySelector('.sel-t');
    l.setAttribute('x1', x); l.setAttribute('x2', x); d.setAttribute('cx', x); d.setAttribute('cy', Math.max(T, Math.min(H - B, y)));
    t.setAttribute('x', x); t.textContent = Math.round(mph);
  }

  // ---------- cruising speed for this trip ----------
  /**
   * ctx: {model, roads:[{name, cls, from, to, mi, pieces:[{mi, limit, price, from, to}]}], legs:[{a, b, arriveGal, needGal, mpgMix, toName}],
   *       stats, loading, state: {offsets:{}, all, active}, onChange}
   * One chart; one slider per major road (posted limit + offset on every piece of it), subtotal each; one "all roads"
   * slider; the total pinned with the chart.
   */
  /** Your default offset on a road with this limit: the limit, or "+N over but never above M mph". v = an "All roads" value. */
  function ruleOff(limit, v) {
    var rule = S.speed.rule || {};
    if (!rule.on) return v == null ? 0 : v;
    var over = v == null ? +rule.over || 0 : v, cap = +rule.cap || 70;
    if (over < 0) return over;
    return limit >= cap ? 0 : Math.max(0, Math.min(over, cap - limit));
  }
  /** This car's mpg-vs-speed curve (calibrated to your log) and the speed range used for trips; null without EPA data. */
  function speedFn() {
    var c = car(); if (!hasEpa(c)) return null;
    var cal = SP.calibrate(c.type || 'car', c.epa.hwy, c.entries);
    return { f: mpgFn(c, cal), lo: 25, hi: Math.max(80, +S.speed.max || 84) };
  }
  function tripSpeed(el, ctx) {
    var c = car();
    if (!el) return;
    if (!hasEpa(c)) { el.innerHTML = '<div class="tb-h">Cruising speed</div><div class="lead small keep">Look your car up from the EPA to plan speeds.</div>'; return; }
    var cal = SP.calibrate(c.type || 'car', c.epa.hwy, c.entries), f = mpgFn(c, cal);
    var lo = 25, hi = Math.max(80, +S.speed.max || 84);
    var rows = []; for (var v = 45; v <= hi; v++) rows.push({ mph: v, galPer100: 100 / f(v) });
    var bal = SP.balanced(f, 45, hi);
    var h = '<div class="spd-stick"><div class="tb-h">Cruising speed for this trip</div>';
    if (ctx.loading) { el.innerHTML = h + '</div>' + (ctx.loadingHtml || '<div class="lead small keep">Looking up speed limits along the route…</div>'); return; }
    var roadList = ctx.roads || [];
    // one slider per posted-limit section of each major road
    var roads = [];
    roadList.forEach(function (r, ri) { (r.sections || []).forEach(function (sec, si) { roads.push({ road: r, ri: ri, si: si, name: r.name, cls: r.cls, from: sec.from, to: sec.to, mi: sec.mi, limit: sec.limit, posted: sec.posted, src: sec.src, pieces: sec.pieces }); }); });
    if (!roads.length) { el.innerHTML = h + '</div><div class="lead small keep">No Interstate, U.S., state or county route stretches found on this route.</div>'; return; }
    var st = ctx.state; st.offsets = st.offsets || {};
    // your default: the limit, or "+N over the limit but never above M mph" (roads already at/above M stay at the limit)
    var rule = S.speed.rule || {}, G = ctx.guard || null;
    roads.forEach(function (r, i) { if (st.offsets[i] == null) st.offsets[i] = ruleOff(r.limit); });
    if (st.all == null) st.all = rule.on ? +rule.over || 0 : 0;
    var cost = function (r, off) {          // each piece at its own limit and at the gas price in the tank there
      var o = { mi: 0, minSaved: 0, extraGal: 0, cost: 0, w0: 0, w1: 0 };
      r.pieces.forEach(function (pc) {
        var x = SP.leg([{ mi: pc.mi, limit: pc.limit, cruise: true }], off, f, pc.price, lo, hi);
        o.mi += x.mi; o.minSaved += x.minSaved; o.extraGal += x.extraGal; o.cost += x.cost; o.w0 += x.avgLimit * x.mi; o.w1 += x.avgSpeed * x.mi;
      });
      o.avgLimit = o.mi ? o.w0 / o.mi : 0; o.avgSpeed = o.mi ? o.w1 / o.mi : 0;
      return o;
    };
    var act = st.active || 0, a0 = cost(roads[act], st.offsets[act]);
    h += chartSvg(rows, 45, hi, { id: 'tChart', shadeTo: bal, sel: a0.avgSpeed || 65, marks: roads.map(function (r, i) { return cost(r, st.offsets[i]).avgSpeed; }) });
    h += '<div class="leg-total" id="lgTot"></div></div>';
    var stt = ctx.stats || {}, tot = (stt.hpms || 0) + (stt.state || 0) + (stt.google || 0);
    h += '<div class="lead small">Major roads — Interstates, U.S., state and county routes — with a slider for each stretch at one speed limit. Each starts at the limit (no extra cost). ' +
      (tot ? 'Limits: ' + Math.round((stt.hpms || 0) / tot * 100) + '% from the FHWA road inventory' + (stt.state ? ', ' + Math.round(stt.state / tot * 100) + '% state maximums' : '') + (stt.google ? ', ' + Math.round(stt.google / tot * 100) + '% Google\'s typical speed' : '') + '.' : '') +
      ' Cost uses the gas in your tank on each part.</div>';
    if (rule.on) h += '<div class="lead small keep rule-line">Your rule: <b>+' + (+rule.over || 0) + ' over the limit, never above ' + (+rule.cap || 70) + ' mph</b> (roads at ' + (+rule.cap || 70) + '+ stay at the limit). <a href="#" id="lgRule">Back to my rule</a></div>';
    h += '<div class="leg all"><div class="spd-warn hidden" id="lgWarnAll"></div><div class="leg-h"><span>All roads <b class="all-v" id="lgAllV"></b>' + (rule.on ? ' <small>up to ' + (+rule.cap || 70) + ' mph</small>' : '') + '</span><b class="leg-sub" id="lgAllSub"></b></div>' +
      '<div class="rng"><input type="range" min="-10" max="15" step="1" value="' + (st.all || 0) + '" id="lgAll" aria-label="Speed on all roads"><i class="gray" id="lgGrayAll"></i></div>' +
      '<div class="leg-scale"><span>−10 mph</span><span class="z" style="left:40%">limit</span><span>+15</span></div></div>';
    var lastRi = -1;
    roads.forEach(function (r, i) {
      if (r.ri !== lastRi) {
        if (lastRi >= 0) h += '</div>';
        var rr = r.road;
        h += '<div class="road-g"><div class="road-h"><b class="rd rd-' + r.cls + '">' + esc(r.name) + '</b><small>mile ' + Math.round(rr.from) + '–' + Math.round(rr.to) + ' · ' + fmtMi(rr.mi) +
          (rr.sections.length > 1 ? ' · ' + rr.sections.length + ' speed limits' : '') + '</small></div>';
        lastRi = r.ri;
      }
      h += '<div class="leg" data-leg="' + i + '"><div class="spd-warn hidden" id="lgWarn' + i + '"></div><div class="leg-h"><span><b class="lim' + (r.posted && r.posted !== r.limit ? ' truck' : '') + '">' + r.limit + '</b> <small>' +
        (r.posted && r.posted !== r.limit ? 'mph truck limit (' + r.posted + ' posted)' : 'mph limit') + ' · mile ' + Math.round(r.from) + '–' + Math.round(r.to) + ' · ' + fmtMi(r.mi) +
        (r.src !== 'hpms' ? ' · state max' : '') + '</small></span><b class="leg-sub" id="lgSub' + i + '"></b></div>' +
        '<div class="rng"><input type="range" min="-10" max="15" step="1" value="' + st.offsets[i] + '" id="lgR' + i + '" aria-label="Speed on ' + esc(r.name) + ' where the limit is ' + r.limit + '"><i class="gray" id="lgGray' + i + '"></i></div>' +
        '<div class="leg-out" id="lgOut' + i + '"></div></div>';
    });
    if (lastRi >= 0) h += '</div>';
    h += disclaimer();
    el.innerHTML = h;
    function update(i, move) {
      var r = roads[i], x = cost(r, st.offsets[i]), out = $('lgOut' + i), sub = $('lgSub' + i), off = st.offsets[i];
      if (out) out.textContent = off === 0 ? 'At the limit — ' + r.limit + ' mph' :
        Math.round(x.avgSpeed) + ' mph (' + (off > 0 ? '+' : '−') + Math.abs(off) + ') · ' + (x.minSaved >= 0 ? fmtMin(x.minSaved) + ' sooner' : fmtMin(-x.minSaved) + ' later');
      if (sub) { sub.textContent = off === 0 ? '$0.00' : (x.cost >= 0 ? '+' : '−') + money(x.cost); sub.className = 'leg-sub' + (x.cost > 0.005 ? ' cost' : x.cost < -0.005 ? ' good' : ''); }
      moveMark($('tChart'), i, x.avgSpeed || r.limit);
      if (move) moveSel($('tChart'), x.avgSpeed || 65, 100 / f(x.avgSpeed || 65));
    }
    function total() {
      var cst = 0, mins = 0, any = false, extraAt = [];
      roads.forEach(function (r, i) {
        if (!st.offsets[i]) return;
        any = true;
        var x = cost(r, st.offsets[i]); cst += x.cost; mins += x.minSaved;
        r.pieces.forEach(function (pc) { var y = SP.leg([{ mi: pc.mi, limit: pc.limit, cruise: true }], st.offsets[i], f, pc.price, lo, hi); extraAt.push({ d: (pc.from + pc.to) / 2, gal: y.extraGal }); });
      });
      // would the extra gas use bring you into a stop (or the end) under your buffer?
      var warn = [];
      (ctx.legs || []).forEach(function (L) {
        var g = extraAt.filter(function (e) { return e.d >= L.a && e.d < L.b; }).reduce(function (s0, e) { return s0 + e.gal; }, 0);
        if (g > 0 && L.arriveGal != null && (L.needGal - (L.arriveGal - g)) * L.mpgMix > 1)
          warn.push('reach ' + esc(L.toName) + ' with about ' + Math.max(0, Math.round((L.arriveGal - g) * L.mpgMix)) + ' mi left');
      });
      var t = $('lgTot'); t.classList.toggle('zero', !any);
      if (!any) t.innerHTML = '<span>Time-saving cost</span><b>$0.00</b><small>at the speed limits</small>';
      else t.innerHTML = '<span>Time-saving cost</span><b class="' + (cst > 0.005 ? 'cost' : 'good') + '">' + (cst >= 0 ? '+' : '−') + money(cst) + '</b><small>' +
        (mins >= 0 ? fmtMin(mins) + ' sooner' : fmtMin(-mins) + ' later') + ' over the whole trip · <a href="#" id="lgReset">reset</a>' +
        (warn.length ? '<br><span class="warn">These speeds use some of your buffer: you\'d ' + warn.join('; ') + '.</span>' : '') + '</small>';
      if ($('lgReset')) $('lgReset').onclick = function (e) { e.preventDefault(); st.offsets = {}; roads.forEach(function (r, i) { st.offsets[i] = 0; }); st.all = 0; tripSpeed(el, ctx); if (ctx.onChange) ctx.onChange(); };
      var all = cost({ pieces: roads.reduce(function (a, r) { return a.concat(r.pieces); }, []) }, 0);
      $('lgAllSub').textContent = any ? (cst >= 0 ? '+' : '−') + money(cst) : '$0.00';
      st.cost = cst; st.minSaved = mins;
      return all;
    }
    var activate = function (i) { st.active = i; el.querySelectorAll('.leg[data-leg]').forEach(function (x) { x.classList.toggle('on', +x.dataset.leg === i); }); };
    roads.forEach(function (r, i) {
      update(i, false);
      var inp = $('lgR' + i);
      inp.oninput = function () {
        var v = +inp.value;
        if (G) { var mx = G.maxFor(i, offsArr()); if (v > mx) { v = mx; inp.value = v; } }      // can't slide into the gray
        st.offsets[i] = v; st.touched = i; activate(i); update(i, true); total(); guards();
      };
      inp.onchange = function () { LG.info('speed', r.name + ' speed offset ' + st.offsets[i], { cost: st.cost, minSaved: st.minSaved }); if (G && G.release) G.release(); if (ctx.onChange) ctx.onChange(); };
    });
    var allLabel = function (v) { $('lgAllV').textContent = v === 0 ? 'at the limit' : (v > 0 ? '+' : '−') + Math.abs(v) + ' mph'; };
    allLabel(+st.all || 0);
    $('lgAll').oninput = function () {
      var v = +$('lgAll').value;
      if (G) { var mx = G.maxAll(); if (v > mx) { v = mx; $('lgAll').value = v; } }
      st.all = v; st.touched = 'all'; allLabel(v);
      roads.forEach(function (r, i) { st.offsets[i] = ruleOff(r.limit, v); $('lgR' + i).value = st.offsets[i]; update(i, false); });
      var all = cost({ pieces: roads.reduce(function (a, r) { return a.concat(r.pieces); }, []) }, v);
      moveSel($('tChart'), all.avgSpeed || 65, 100 / f(all.avgSpeed || 65));
      total(); guards();
    };
    $('lgAll').onchange = function () { LG.info('speed', 'All roads speed offset ' + st.all, { cost: st.cost }); if (G && G.release) G.release(); if (ctx.onChange) ctx.onChange(); };
    /** Gray out speeds the gas in the tank can't cover, and say why — above the slider that's limited or doing the limiting. */
    function offsArr() { return roads.map(function (r, i) { return st.offsets[i] || 0; }); }
    function grayAt(id, mx) {
      var g = $(id); if (!g) return;
      if (mx >= 15) { g.style.display = 'none'; return; }
      g.style.display = ''; g.style.setProperty('--g', ((mx + 0.5 - -10) / 25).toFixed(4));
    }
    function guards() {
      if (!G) return;
      var o = offsArr();
      roads.forEach(function (r, i) { grayAt('lgGray' + i, G.maxFor(i, o)); });
      var mxAll = G.maxAll(); grayAt('lgGrayAll', mxAll);
      var at = st.touched != null && st.touched !== 'all' && $('lgWarn' + st.touched) ? st.touched : 'all';
      el.querySelectorAll('.spd-warn').forEach(function (w) { w.classList.add('hidden'); w.textContent = ''; });
      var notes = G.notes(at === 'all' ? mxAll : G.maxFor(at, o), at === 'all' ? null : roads[at]) || [];
      var w = $(at === 'all' ? 'lgWarnAll' : 'lgWarn' + at);
      if (w && notes.length) { w.innerHTML = notes.map(function (n) { return '<span>' + n + '</span>'; }).join(''); w.classList.remove('hidden'); }
    }
    if ($('lgRule')) $('lgRule').onclick = function (e) { e.preventDefault(); st.offsets = {}; st.all = null; tripSpeed(el, ctx); if (ctx.onChange) ctx.onChange(); };
    el.querySelectorAll('input[type=range]').forEach(guardRange);
    activate(act);
    total(); guards();
    lastTripMi = ctx.model.totalMi;
  }
  /** The part of each stretch that falls between route miles a and b. */
  function clip(stretches, a, b) {
    var out = [];
    (stretches || []).forEach(function (s) {
      var o = Math.min(b, s.to) - Math.max(a, s.from);
      if (o > 0.01) out.push(Object.assign({}, s, { mi: o }));
    });
    return out;
  }

  window.Garage = { ruleOff: ruleOff, speedFn: speedFn, guardRange: guardRange, tripSpeed: tripSpeed, mpgFn: mpgFn, render: render, car: car, carModel: carModel, grade: grade, tank: tank, redraw: draw, drawSpeed: drawSpeed, speedModel: speedModel, TANKS: TANKS };
})();
