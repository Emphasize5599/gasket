/* Gasket — Tires (Garage). The car's factory size (from Tire Rack for the year / make / model / trim, or typed from the door
 * sticker), the tires sold in that size (type -> brand -> model, read from Tire Rack), the wear rating, and how much tread is
 * left (measured, or estimated from miles and rotation). TireMath is pure and runs in Node for the tests; Advisory uses it. */
(function (root) {
  'use strict';
  // ---------- the math ----------
  var ROT = { yes: 1, sometimes: 0.9, no: 0.75, unsure: 0.85 };
  /** A new tire's tread depth in 32nds of an inch, by type (typical, when the maker's figure isn't known). */
  function newDepth(type) {
    var t = String(type || '').toLowerCase();
    return /mud/.test(t) ? 15 : /terrain|off/.test(t) ? 13 : /winter|snow|ice|studless/.test(t) ? 12 : /summer|ultra high|max performance/.test(t) ? 9 : 10;
  }
  /** Miles a set should last: the maker's mileage warranty, else the wear rating x 100, else 50,000. */
  function lifeMiles(t) {
    if (+t.warrantyMi > 0) return +t.warrantyMi;
    if (t.utqg && +t.utqg.tw > 0) return Math.max(25000, Math.min(90000, +t.utqg.tw * 100));
    return 50000;
  }
  /** -> { depth (32nds), measured } or null. Wear runs from new down to 2/32 over the expected life; skipped rotations wear
   *  some tires faster (the worst one is what matters). */
  function estimate(t) {
    var r = t && t.tread; if (!r) return null;
    if (r.mode === 'measure') return +r.depth > 0 ? { depth: +r.depth, measured: true } : null;
    if (r.miles === '' || r.miles == null || !(+r.miles >= 0)) return null;
    var nd = +t.newDepth || newDepth(t.type), life = lifeMiles(t), f = ROT[r.rotated] || ROT.unsure;
    var d = nd - (nd - 2) * (+r.miles) / (life * f);
    return { depth: Math.max(0, Math.round(d * 2) / 2), measured: false, life: life, factor: f, newDepth: nd };
  }
  /** good (6+/32), ok (4-5.5: plan new ones), low (above 2: replace soon), worn (2/32 or less). */
  function status(depth) { return depth >= 6 ? 'good' : depth >= 4 ? 'ok' : depth > 2 ? 'low' : 'worn'; }
  var MULTI = ['BF GOODRICH', 'MICKEY THOMPSON', 'DICK CEPEK', 'GT RADIAL', 'MASTER CRAFT'];
  var SPELL = { 'BF GOODRICH': 'BFGoodrich', BFGOODRICH: 'BFGoodrich', 'GT RADIAL': 'GT Radial', 'MASTER CRAFT': 'Mastercraft', BRIDGESTONE: 'Bridgestone', 'MICKEY THOMPSON': 'Mickey Thompson', 'DICK CEPEK': 'Dick Cepek' };
  /** "CONTINENTAL SECURECONTACT AW" -> { brand: 'Continental', model: 'SecureContact AW'-ish }. */
  function split(name) {
    var n = String(name || '').trim(), b = MULTI.filter(function (m) { return n.indexOf(m + ' ') === 0; })[0] || n.split(' ')[0];
    var tc = function (s) { return s.toLowerCase().replace(/(^|[\s\-\/])([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); }); };
    return { brand: SPELL[b] || tc(b), model: n.slice(b.length).trim() };
  }
  /** "195/65-15", "195/65 R15", "p195/65r15" -> "195/65R15" (or '' if it isn't a size). */
  function normSize(s) { var m = /(\d{3})\s*\/\s*(\d{2})\s*(?:-|Z?R)?\s*(\d{2})/i.exec(String(s || '')); return m ? m[1] + '/' + m[2] + 'R' + m[3] : ''; }
  var TireMath = { newDepth: newDepth, lifeMiles: lifeMiles, estimate: estimate, status: status, split: split, normSize: normSize, ROT: ROT };
  root.TireMath = TireMath;
  if (typeof module !== 'undefined' && module.exports) module.exports = TireMath;
  if (!root.document) return;                                   // Node: the math only

  // ---------- the card ----------
  var A = root.__app, S = A.S, N = A.N, $ = A.$, esc = A.esc, LG = root.FLog || { info: function () {}, warn: function () {} };
  var TR = 'https://www.tirerack.com/tires/';
  var TYPES = ['All-season', 'Touring all-season', 'Grand touring all-season', 'Performance all-season', 'All-weather (snow-rated)', 'Summer', 'Winter', 'All-terrain', 'Mud-terrain', 'Highway (trucks and SUVs)'];
  var RETRY_H = 6, LIST_DAYS = 30;
  var host = null, call = null, onChange = function () {}, busy = {}, open = {};
  function G() { return root.Garage; }
  function save() { A.save(); }
  function tires(c) { c.tires = c.tires || {}; if (!c.tires.tread) c.tires.tread = { mode: 'miles', miles: '', rotated: '' }; return c.tires; }
  function base(c) { return String(c.epaBase || c.vpicModel || c.model || '').replace(/\s+(2WD|4WD|AWD|FWD|RWD|4x4)$/i, '').trim(); }
  function sizeUrl(c) {
    return TR + 'SelectTireSize.jsp?autoMake=' + encodeURIComponent(c.make) + '&autoYear=' + encodeURIComponent(c.year) + '&autoModel=' + encodeURIComponent(base(c)) + '&autoModClar=' + encodeURIComponent(c.trim);
  }
  function listUrl(c, size) {
    var m = /(\d{3})\/(\d{2})R(\d{2})/.exec(size); if (!m) return '';
    return TR + 'TireSearchResults.jsp?' + (c.make && c.year && c.trim ? 'autoMake=' + encodeURIComponent(c.make) + '&autoYear=' + encodeURIComponent(c.year) + '&autoModel=' + encodeURIComponent(base(c)) + '&autoModClar=' + encodeURIComponent(c.trim) + '&' : '') +
      'width=' + m[1] + '/&ratio=' + m[2] + '&diameter=' + m[3];
  }
  function recent(x, h) { return x && Date.now() - x.t < h * 3600e3; }

  /** Tire Rack, in the background: the factory size (once per year / make / model / trim), then the tires in that size. */
  function lookup(c) {
    var t = tires(c); if (!call || !N.siteRead) return;
    if (!t.size && c.year && c.make && c.model && c.trim) {
      var key = [c.year, c.make, base(c), c.trim].join('|');
      if (busy[c.id] || (t.sizeLookup && t.sizeLookup.key === key && (t.sizeLookup.found || recent(t.sizeLookup, RETRY_H)))) return;
      busy[c.id] = 'size'; t.sizeLookup = { key: key, t: Date.now() };
      call('siteRead', 'tirerack', JSON.stringify({ url: sizeUrl(c), step: 'size' })).then(function (r) {
        busy[c.id] = false;
        r = r || {};
        if (r.factory && r.factory.length) {
          t.sizeLookup = { key: key, t: Date.now(), found: true, factory: r.factory, optional: r.optional || [] };
          if (r.factory.length === 1 && !t.size) { t.size = r.factory[0]; t.sizeSrc = 'tirerack'; }
          LG.info('car', 'Tire Rack factory size: ' + r.factory.join(', '));
        } else {
          t.sizeLookup = { key: key, t: Date.now(), failed: r.blocked ? 'blocked' : r.unknown ? 'unknown' : 'error' };
          LG.info('car', 'Tire Rack factory size not found', t.sizeLookup.failed);
        }
        save(); redraw(c); lookup(c);
      });
      redraw(c); return;
    }
    if (t.size && !busy[c.id]) {
      var L = t.list;
      if (L && L.size === t.size && (L.items && L.items.length ? Date.now() - L.t < LIST_DAYS * 864e5 : recent(L, RETRY_H))) return;
      var url = listUrl(c, t.size); if (!url) return;
      busy[c.id] = 'list'; t.list = { size: t.size, t: Date.now(), items: L && L.size === t.size ? L.items : [] };
      call('siteRead', 'tirerack', JSON.stringify({ url: url, step: 'list' })).then(function (r) {
        busy[c.id] = false; r = r || {};
        if (r.tires && r.tires.length) { t.list = { size: t.size, t: Date.now(), items: r.tires.map(function (x) { var s = split(x.name); return { name: x.name, brand: s.brand, model: s.model, type: x.type, utqg: x.utqg, warrantyMi: x.warrantyMi || 0 }; }) }; LG.info('car', 'Tire Rack: ' + r.tires.length + ' tires in ' + t.size); }
        else { t.list = { size: t.size, t: Date.now(), items: (t.list && t.list.items) || [], failed: r.blocked ? 'blocked' : 'error' }; LG.info('car', 'Tire Rack tire list not read', t.list.failed); }
        save(); redraw(c);
      });
      redraw(c);
    }
  }
  function redraw(c) { if (host && host.isConnected && G().car() === c) draw(); }

  // ---------- page ----------
  function render(el, nativeCall, changed) { host = el; call = nativeCall || call; onChange = changed || onChange; lookup(G().car()); draw(); }
  function summary(c) {
    var t = tires(c), e = estimate(t), bits = [t.size, t.brand ? t.brand + (t.model ? ' ' + t.model : '') : ''];
    if (e) bits.push((e.measured ? '' : '~') + e.depth + '/32 in left');
    return bits.filter(Boolean).join(' · ') || 'size, brand, tread left';
  }
  function opts(list, cur, ph) {
    return '<option value="">' + esc(ph) + '</option>' + list.map(function (x) { var v = typeof x === 'string' ? x : x.v, l = typeof x === 'string' ? x : x.l; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') +
      '<option value="*"' + (cur && cur !== '*' && !list.some(function (x) { return (typeof x === 'string' ? x : x.v) === cur; }) ? ' selected' : '') + '>Other…</option>';
  }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }); }
  var Q = {
    size: 'Your tire size is printed on the tire\'s side and on the sticker inside the driver\'s door: for example <b>195/65R15</b>. 195 is the width in millimeters, 65 is the sidewall\'s height as a percent of the width, and 15 is the wheel size in inches. Gasket looks up your trim\'s factory size at Tire Rack.',
    type: '<b>All-season</b> tires work year-round where winters are mild. <b>Touring</b> ones ride quieter and last longer. <b>All-weather</b> tires carry the mountain-snowflake symbol for real snow. <b>Summer</b> tires grip best in warm weather but harden in the cold. <b>Winter</b> tires are for snow and ice.',
    utqg: 'The <b>wear rating</b> (UTQG, Uniform Tire Quality Grading) is molded on the tire\'s side, like <b>700 A A</b>. <b>Treadwear</b>: higher lasts longer (300 is short, 700+ is long). <b>Traction</b>: wet braking grip, AA (best), A, B or C. <b>Temperature</b>: how well it handles heat at speed, A (best), B or C. Gasket uses it to estimate how long your tires last.',
    measure: 'Use a coin. <b>Penny</b>: put it in a groove with Lincoln\'s head down. If you can see all of his head, there\'s 2/32 in or less: replace the tire now. <b>Quarter</b>: if you can see all of Washington\'s head, there\'s 4/32 in or less: plan new tires (wet and snow grip fade from here). If the tread covers part of his head, you have more than 4/32. Check the inside, middle and outside of each tire; the lowest one counts.',
    miles: 'About how many miles you\'ve driven since these tires were put on. A rough number is fine. Your car\'s trip odometer or a service receipt can help.',
    rotate: '<b>Rotating</b> tires means moving them to different corners of the car (front to back, and sometimes side to side), because front tires wear faster, especially on front-wheel-drive cars. <b>Regularly</b> means every 5,000 to 7,500 miles, or at every oil change on many cars. Skipping it lets some tires wear out sooner than the others.'
  };
  function draw() {
    if (!host) return;
    var c = G().car(); if (!c) { host.innerHTML = ''; return; }
    var t = tires(c), L = t.list && t.list.size === t.size ? t.list.items || [] : [], q = A.qBtn;
    var h = '';
    // size
    var SL = t.sizeLookup || {}, fac = SL.found ? SL.factory || [] : [];
    h += '<div class="nf wide"><span>Size' + q(Q.size) + '</span>';
    if (busy[c.id] === 'size') h += '<div class="lead small keep"><span class="ldspin sm" aria-hidden="true"></span> Looking up your factory size…</div>';
    if (fac.length > 1 && !t.size) h += '<div class="chips mini wrap" id="tzPick">' + fac.map(function (z) { return '<button data-size="' + esc(z) + '">' + esc(z) + '</button>'; }).join('') + '</div>' +
      '<div class="lead small keep">Your ' + esc(c.year + ' ' + c.make + ' ' + base(c) + ' ' + c.trim) + ' came with ' + fac.length + ' sizes. Pick yours, or type it below.</div>';
    h += '<input type="text" id="tzSize" maxlength="20" autocapitalize="characters" placeholder="e.g. 195/65R15" value="' + esc(t.size || '') + '"></div>';
    if (t.size && t.sizeSrc === 'tirerack') h += '<div class="lead small keep tz-src">Factory size for the ' + esc(c.year + ' ' + c.make + ' ' + base(c) + ' ' + c.trim) + ', from Tire Rack.</div>';
    else if (!t.size && SL.failed) h += '<div class="lead small keep">' + (SL.failed === 'unknown' ? 'Tire Rack doesn\'t list "' + esc(c.trim) + '" for this model.' : 'Tire Rack didn\'t answer.') + ' Type the size from the sticker inside the driver\'s door.</div>';
    else if (!t.size && !c.trim) h += '<div class="lead small keep">Add your trim (Edit, above) to look up its factory size, or type it from the sticker inside the driver\'s door.</div>';
    // type -> brand -> model
    var types = L.length ? uniq(L.map(function (x) { return x.type; })).sort() : TYPES;
    var inType = L.filter(function (x) { return !t.type || x.type === t.type; });
    var brands = uniq(inType.map(function (x) { return x.brand; })).sort();
    var models = inType.filter(function (x) { return x.brand === t.brand; }).map(function (x) { return x.model; }).sort();
    var otherBrand = t.brand && brands.indexOf(t.brand) < 0, otherModel = t.model && models.indexOf(t.model) < 0;
    if (busy[c.id] === 'list') h += '<div class="lead small keep"><span class="ldspin sm" aria-hidden="true"></span> Finding the tires made in ' + esc(t.size) + '…</div>';
    h += '<div class="tz-pick"><label class="nf"><span>Type' + q(Q.type) + '</span><select id="tzType">' + opts(types, t.type, 'Type') + '</select></label>' +
      '<label class="nf"><span>Brand</span>' + (otherBrand || !brands.length ? '<input type="text" id="tzBrandT" maxlength="30" placeholder="Brand" value="' + esc(t.brand || '') + '">' : '<select id="tzBrand">' + opts(brands, t.brand, 'Brand') + '</select>') + '</label>' +
      '<label class="nf"><span>Model</span>' + (otherModel || otherBrand || !models.length ? '<input type="text" id="tzModelT" maxlength="40" placeholder="Model" value="' + esc(t.model || '') + '">' : '<select id="tzModel">' + opts(models, t.model, 'Model') + '</select>') + '</label></div>';
    if (t.size && t.list && t.list.failed && !L.length) h += '<div class="lead small keep">Couldn\'t get Tire Rack\'s list for ' + esc(t.size) + '. Type the brand and model, and the wear rating from the tire\'s side.</div>';
    // wear rating
    var u = t.utqg || {};
    h += '<div class="nf wide"><span>Wear rating' + q(Q.utqg) + '</span><div class="grid3">' +
      '<label class="nf"><span>Treadwear</span><input type="number" inputmode="numeric" min="60" max="1200" step="20" id="tzTw" placeholder="e.g. 600" value="' + esc(u.tw || '') + '"></label>' +
      '<label class="nf"><span>Traction</span><select id="tzTrac">' + ['', 'AA', 'A', 'B', 'C'].map(function (g) { return '<option value="' + g + '"' + ((u.trac || '') === g ? ' selected' : '') + '>' + (g || '—') + '</option>'; }).join('') + '</select></label>' +
      '<label class="nf"><span>Temperature</span><select id="tzTemp">' + ['', 'A', 'B', 'C'].map(function (g) { return '<option value="' + g + '"' + ((u.temp || '') === g ? ' selected' : '') + '>' + (g || '—') + '</option>'; }).join('') + '</select></label></div>' +
      (t.utqgSrc === 'tirerack' || +t.warrantyMi > 0 ? '<div class="lead small keep">' + [t.utqgSrc === 'tirerack' ? 'Wear rating from Tire Rack.' : '', +t.warrantyMi > 0 ? 'Maker\'s mileage warranty: ' + (t.warrantyMi / 1000) + ',000 miles.' : ''].filter(Boolean).join(' ') + '</div>' : '') + '</div>';
    // tread left
    var r = t.tread, e = estimate(t);
    h += '<div class="nf wide"><span>Tread left</span><div class="seg2" id="tzMode"><button data-mode="miles" class="' + (r.mode !== 'measure' ? 'on' : '') + '">Estimate it</button><button data-mode="measure" class="' + (r.mode === 'measure' ? 'on' : '') + '">I measured it</button></div></div>';
    if (r.mode === 'measure') {
      h += '<label class="nf wide"><span>Shallowest groove' + q(Q.measure) + '</span><select id="tzDepth"><option value="">Pick…</option>' +
        [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(function (d) { return '<option value="' + d + '"' + (+r.depth === d ? ' selected' : '') + '>' + d + '/32 in' + (d === 4 ? ' (quarter test)' : d === 2 ? ' (penny test)' : '') + '</option>'; }).join('') + '</select></label>';
    } else {
      h += '<div class="grid2"><label class="nf"><span>Miles on these tires' + q(Q.miles) + '</span><input type="number" inputmode="numeric" min="0" step="1000" id="tzMiles" placeholder="e.g. 20000" value="' + esc(r.miles === '' || r.miles == null ? '' : r.miles) + '"></label>' +
        '<label class="nf"><span>Rotated regularly?' + q(Q.rotate) + '</span><select id="tzRot">' + [['', 'Pick…'], ['yes', 'Yes'], ['sometimes', 'Sometimes'], ['no', 'Never'], ['unsure', 'Not sure']].map(function (o) { return '<option value="' + o[0] + '"' + ((r.rotated || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label></div>';
    }
    if (e) {
      var st = status(e.depth), word = { good: 'Plenty left.', ok: 'Plan new tires: wet and snow grip start to fade at 4/32 in.', low: 'Replace them soon.', worn: 'At the legal limit: replace them now.' }[st];
      h += '<div class="tz-out ' + st + '"><b>' + (e.measured ? '' : 'About ') + e.depth + '/32 in left</b><small>' + word +
        (e.measured ? '' : ' Estimated from ' + Number(r.miles).toLocaleString() + ' miles and ' + (+t.warrantyMi > 0 ? 'the ' + (t.warrantyMi / 1000) + ',000-mile warranty' : t.utqg && t.utqg.tw ? 'the treadwear rating' : 'a typical tire life') + (r.rotated && r.rotated !== 'yes' ? ', with uneven wear from skipped rotations' : '') + '. A coin test tells you for sure.') + '</small></div>';
    }
    host.innerHTML = h;
    bind(c);
  }
  function bind(c) {
    var t = tires(c);
    var set = function (fn) { return function () { fn.call(this); save(); draw(); onChange(); }; };
    var pickModel = function () {
      var L = t.list && t.list.size === t.size ? t.list.items || [] : [];
      var x = L.filter(function (y) { return y.brand === t.brand && y.model === t.model && (!t.type || y.type === t.type); })[0];
      if (x) { t.type = x.type; if (x.utqg) { t.utqg = Object.assign({}, x.utqg); t.utqgSrc = 'tirerack'; } t.warrantyMi = x.warrantyMi || 0; t.newDepth = 0; }
    };
    if ($('tzPick')) host.querySelectorAll('[data-size]').forEach(function (b) { b.onclick = set(function () { t.size = b.dataset.size; t.sizeSrc = 'tirerack'; lookup(c); }); });
    $('tzSize').onchange = set(function () {
      var v = normSize(this.value);
      if (!this.value.trim()) { t.size = ''; t.sizeSrc = ''; return; }
      if (!v) { A.toast && A.toast('A tire size looks like 195/65R15.'); return; }
      if (v !== t.size) { t.size = v; t.sizeSrc = 'user'; } lookup(c);
    });
    if ($('tzType')) $('tzType').onchange = set(function () { t.type = this.value === '*' ? 'Other' : this.value; });
    if ($('tzBrand')) $('tzBrand').onchange = set(function () { if (this.value === '*') { t.brand = ' '; } else { t.brand = this.value; t.model = ''; } });
    if ($('tzBrandT')) $('tzBrandT').onchange = set(function () { t.brand = this.value.trim(); });
    if ($('tzModel')) $('tzModel').onchange = set(function () { if (this.value === '*') { t.model = ' '; return; } t.model = this.value; pickModel(); });
    if ($('tzModelT')) $('tzModelT').onchange = set(function () { t.model = this.value.trim(); });
    var u = function () { t.utqg = Object.assign({}, t.utqg); t.utqgSrc = 'user'; return t.utqg; };
    $('tzTw').onchange = set(function () { u().tw = parseInt(this.value, 10) || ''; });
    $('tzTrac').onchange = set(function () { u().trac = this.value; });
    $('tzTemp').onchange = set(function () { u().temp = this.value; });
    host.querySelectorAll('#tzMode [data-mode]').forEach(function (b) { b.onclick = set(function () { t.tread = Object.assign({}, t.tread, { mode: b.dataset.mode }); }); });
    if ($('tzDepth')) $('tzDepth').onchange = set(function () { t.tread.depth = parseFloat(this.value) || ''; t.tread.t = Date.now(); });
    if ($('tzMiles')) $('tzMiles').onchange = set(function () { t.tread.miles = this.value === '' ? '' : Math.max(0, parseInt(this.value, 10) || 0); t.tread.t = Date.now(); });
    if ($('tzRot')) $('tzRot').onchange = set(function () { t.tread.rotated = this.value; });
  }
  window.addEventListener('garagechange', function () { var c = G() && G().car(); if (c && host && host.isConnected) { lookup(c); draw(); } });

  /** What Advisory says about the tires: [{ level: 'warn'|'info', text }]. */
  function advice(c) {
    var t = c && c.tires; if (!t) return [];
    var out = [], e = estimate(t);
    if (e) {
      var st = status(e.depth);
      if (st === 'worn') out.push({ level: 'warn', title: 'Tires: replace now', text: (e.measured ? '' : 'About ') + e.depth + '/32 in of tread left, at or below the legal limit. Worn tires take much longer to stop on wet roads.' });
      else if (st === 'low') out.push({ level: 'warn', title: 'Tires: replace soon', text: (e.measured ? '' : 'About ') + e.depth + '/32 in of tread left. Grip on wet and snowy roads is fading.' });
      else if (st === 'ok') out.push({ level: 'info', title: 'Tires: plan new ones', text: (e.measured ? '' : 'About ') + e.depth + '/32 in of tread left. Wet and snow grip start to fade from 4/32 in.' });
    }
    if (t.tread && t.tread.mode !== 'measure' && (t.tread.rotated === 'no' || t.tread.rotated === 'sometimes'))
      out.push({ level: 'info', title: 'Rotate your tires', text: 'Moving them to different corners every 5,000 to 7,500 miles makes them wear evenly and last longer.' });
    if (t.utqg && (t.utqg.trac === 'B' || t.utqg.trac === 'C')) out.push({ level: 'info', title: 'Wet roads', text: 'Your tires\' traction grade is ' + t.utqg.trac + ', below the A most tires have. Leave extra room to stop in the rain.' });
    return out;
  }
  root.Tires = { render: render, summary: summary, advice: advice, lookup: lookup };
})(typeof window !== 'undefined' ? window : globalThis);
