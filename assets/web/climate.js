/* Gasket — Climate control (Garage). Your car's climate controls, and your favorite settings as presets: one per season,
 * what you'd do if it's snowy / frosty / rainy / ... (the ones that come with each season), and your own. Advice reminds you to keep it on fresh air (recirculate makes you drowsy, and
 * with the A/C on the air gets dry). ClimateMath is pure and runs in Node for the tests. */
(function (root) {
  'use strict';
  // ---------- the rules ----------
  var SEASONS = [['winter', 'Winter'], ['spring', 'Spring'], ['summer', 'Summer'], ['fall', 'Fall']];   // the year starts in winter
  var EMOJI = { spring: '🌷', summer: '☀️', fall: '🍂', winter: '❄️' };
  // what a year up north brings: [key, label, the seasons it comes with]
  var WEATHER = [['snow', 'Snowy', ['winter']], ['ice', 'Icy', ['winter']], ['frost', 'Frosty', ['fall', 'winter', 'spring']], ['fog', 'Foggy', ['fall', 'winter', 'spring']],
    ['rain', 'Rainy', ['spring', 'summer', 'fall']], ['storm', 'Stormy', ['spring', 'summer']], ['pollen', 'Full of pollen', ['spring']], ['heat', 'Hot & sunny', ['summer']],
    ['humid', 'Humid', ['summer']], ['smoke', 'Smoky or polluted', ['summer', 'fall']]];
  /** The situations that come with a season, in the order above. */
  function situations(s) { return WEATHER.filter(function (w) { return w[2].indexOf(s) >= 0; }); }
  function separateWeather(presets){
    var legacy=presets.filter(function(p){return p.kind==='weather'&&!p.season&&WEATHER.some(function(w){return w[0]===p.key;});});
    if(!legacy.length)return presets;
    var out=presets.filter(function(p){return legacy.indexOf(p)<0;});
    legacy.forEach(function(p){var w=WEATHER.filter(function(w){return w[0]===p.key;})[0];w[2].forEach(function(sk){if(!out.some(function(q){return q.kind==='weather'&&q.key===p.key&&q.season===sk;}))out.push(Object.assign(JSON.parse(JSON.stringify(p)),{id:p.id+'-'+sk,season:sk}));});});
    return out;
  }
  var FLOW = [['face', 'Face'], ['bi', 'Face & feet'], ['feet', 'Feet'], ['mix', 'Feet & windshield'], ['defrost', 'Windshield']];
  /** The season for a date (northern hemisphere, by month). */
  function season(d) { var m = (d || new Date()).getMonth(); return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'fall' : 'winter'; }
  function label(p) { var l = SEASONS.concat(WEATHER).filter(function (x) { return x[0] === p.key; })[0]; return p.kind === 'custom' ? (p.name || 'My preset') : l ? l[1] : p.key; }
  /** A preset's page title: "Winter", "If it's snowy", "Road trip". */
  function title(p) { return p.kind === 'weather' ? 'If it\'s ' + label(p).toLowerCase() : label(p); }
  function acAvailable(c) { var x=c&&c.climate||{};return !x.acBroken&&!(x.caps&&x.caps.noAc); }
  function capsFor(c) {return Object.assign({},c&&c.climate&&c.climate.caps,{acUnavailable:!acAvailable(c)});}
  // A temporary equipment failure must not overwrite the user's saved presets.
  function effective(p,caps) {if(!caps||!caps.acUnavailable&&!caps.noAc)return p;return Object.assign({},p,{ac:'off',mode:'manual',fan:p.fan==='auto'?3:p.fan,air:p.air==='auto'?'fresh':p.air});}
  /** A starting point for a new preset: fresh air throughout (smoke aside), the A/C where it clears glass or dries the air. */
  function starter(kind, key, caps) {
    caps = caps || {};
    var p = { id: 'cp' + Date.now().toString(36) + Math.floor(Math.random() * 1e3), kind: kind, key: kind === 'custom' ? '' : key, name: '',
      temp: 70, tempP: '', mode: caps.auto ? 'auto' : 'manual', fan: caps.auto ? 'auto' : 3, ac: 'off', air: 'fresh', flow: 'bi',
      frontDef: false, rearDef: false, seatD: 0, seatP: 0, coolD: 0, coolP: 0, wheel: false, rear: false, windows: 'closed', roof: 'closed', notes: '' };
    var hi = caps.fanMax || 7;
    var set = {
      summer: { ac: 'on', flow: 'face', coolD: caps.seatCool ? 2 : 0 },
      winter: { temp: 72, flow: 'mix', seatD: caps.seatHeat ? 2 : 0, wheel: !!caps.wheelHeat },
      rain: { ac: 'on', flow: 'mix' },
      storm: { ac: 'on', flow: 'mix', fan: Math.min(hi, 5), mode: 'manual', rearDef: !!caps.rearDefrost },
      ice: { temp: 74, ac: 'on', flow: 'defrost', frontDef: true, rearDef: !!caps.rearDefrost, fan: hi, mode: 'manual', seatD: caps.seatHeat ? 3 : 0, wheel: !!caps.wheelHeat },
      snow: { temp: 72, flow: 'mix', rearDef: !!caps.rearDefrost, seatD: caps.seatHeat ? 3 : 0, wheel: !!caps.wheelHeat },
      fog: { ac: 'on', flow: 'defrost', fan: Math.min(hi, 5), mode: 'manual' },
      heat: { temp: 68, ac: 'on', flow: 'face', fan: hi, mode: 'manual', coolD: caps.seatCool ? 3 : 0, notes: 'Windows down for the first minute to let the hot air out.' },
      frost: { temp: 74, ac: 'on', flow: 'defrost', frontDef: true, rearDef: !!caps.rearDefrost, fan: hi, mode: 'manual', seatD: caps.seatHeat ? 3 : 0, wheel: !!caps.wheelHeat },
      humid: { ac: 'on', flow: 'face' },
      pollen: { ac: 'on', air: 'recirc', flow: 'face', notes: 'Back to fresh air once you\'re out of it.' },
      smoke: { ac: 'on', air: 'recirc', flow: 'face', notes: 'Back to fresh air once you\'re past it.' }
    }[key] || {};
    Object.keys(set).forEach(function (k) { p[k] = set[k]; });
    if (p.mode === 'manual' && p.fan === 'auto') p.fan = 3;
    return effective(p,caps);
  }
  /** Where recirculating makes sense for a while: allergens, pollution, and heat and humidity the A/C can't keep up with. */
  var RECIRC_OK = { pollen: 1, smoke: 1, heat: 1, humid: 1 };
  function recircOk(p, caps) { return p.kind === 'weather' && !!RECIRC_OK[p.key] || !!(caps && caps.noFilter && p.kind === 'weather' && p.key !== 'fog' && p.key !== 'frost'); }
  /** Things to say about a preset: recirculate (drowsy), recirculate with the A/C on (dry air), Auto air that can switch to it. */
  function warnings(p, caps) {
    p=effective(p,caps);
    var w = [];
    if (p.air === 'recirc') w.push(recircOk(p, caps) ? 'recircShort' : 'recirc');
    if (p.air === 'recirc' && p.ac === 'on') w.push('dry');
    if (p.air === 'auto') w.push('autoAir');
    return w;
  }
  /** One line: "70° · Auto · A/C on · Fresh air · Face & feet · Heated seat 2". */
  function line(p, caps) {
    caps = caps || {};
    if(caps.noAc)caps=Object.assign({},caps,{acUnavailable:true});
    p=effective(p,caps);
    var a = [(p.temp || '—') + '°' + (caps.dual && p.tempP !== '' && p.tempP != null && +p.tempP !== +p.temp ? ' / ' + p.tempP + '°' : '')];
    if (p.mode === 'auto') a.push('Auto'); else a.push('Fan ' + p.fan);
    a.push(caps.acUnavailable ? 'No working A/C' : p.ac === 'on' ? 'A/C on' : p.ac === 'auto' ? 'A/C auto' : 'A/C off');
    a.push(p.air === 'recirc' ? 'Recirculate' : p.air === 'auto' ? 'Air auto' : 'Fresh air');
    if (p.mode !== 'auto') a.push((FLOW.filter(function (f) { return f[0] === p.flow; })[0] || ['', ''])[1]);
    if (p.frontDef) a.push(caps.acUnavailable?'Windshield airflow (no A/C drying)':'Defrost'); if (p.rearDef) a.push('Rear defrost');
    if (+p.seatD) a.push('Heated seat ' + p.seatD); if (+p.coolD) a.push('Cooled seat ' + p.coolD); if (p.wheel) a.push('Heated wheel');
    return a.filter(Boolean).join(' · ');
  }
  var ClimateMath = { situations: situations, title: title, recircOk: recircOk, season: season, starter: starter, warnings: warnings, line: line, label: label, SEASONS: SEASONS, WEATHER: WEATHER, FLOW: FLOW };
  ClimateMath.separateWeather=separateWeather;
  ClimateMath.acAvailable=acAvailable;ClimateMath.capsFor=capsFor;ClimateMath.effective=effective;
  root.ClimateMath = ClimateMath;
  if (typeof module !== 'undefined' && module.exports) module.exports = ClimateMath;
  if (!root.document) return;                                   // Node: the rules only

  // ---------- the card ----------
  var A = root.__app, $ = A.$, esc = A.esc, LG = root.FLog || { info: function () {}, warn: function () {} };
  var host = null, onChange = function () {};
  var GO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z"/></svg>';
  var CAPS = [['noAc', 'No air conditioning fitted'], ['auto', 'Automatic climate control', 'An AUTO button that sets the fan and vents itself'], ['dual', 'Dual-zone', 'Separate driver and passenger temperatures'],
    ['rear', 'Rear climate', 'Its own controls for the back seats'], ['rearDefrost', 'Rear window defroster'], ['seatHeat', 'Heated seats'], ['seatCool', 'Cooled seats'],
    ['wheelHeat', 'Heated steering wheel'], ['sunroof', 'Sunroof'], ['noFilter', 'No cabin air filter', 'Older cars and some basic trims: dust, smoke and pollen come straight in']];
  var RECIRC = 'Recirculate keeps reusing the air already in the car. With the windows up, the carbon dioxide everyone breathes out builds up and fresh oxygen runs short within minutes, and that makes you drowsy, which is dangerous behind the wheel. Keep it on fresh air.';
  var DRY = 'With the A/C on too (many cars run it even when you pick heat), the recirculated air gets very dry, which is hard on your eyes, nose and throat.';
  var SHORT = 'Recirculate makes sense here for a while. Switch back to fresh air once it passes, or you\'ll get drowsy.';
  var WHEN = 'When recirculate does make sense: harsh allergens outside, like heavy pollen; heavily polluted areas, where smells or contaminants can get past your cabin air filter (a car without a cabin air filter should use recirculate more freely); and extremely hot, humid days, when your A/C may struggle to keep up and the muggy outside air can fog the inside of your windows, which is a safety problem. Switch back to fresh air once it passes.';
  var NOFILTER = 'Your car has no cabin air filter, so recirculate whenever the air outside is dusty, smoky or full of pollen.';
  var AUTOAIR = 'Some cars\' automatic air setting switches to recirculate on its own (often with the A/C on high). If yours has a fresh-air button, use it.';
  var TEXT = { recirc: RECIRC, dry: DRY, recircShort: SHORT, autoAir: AUTOAIR };
  function G() { return root.Garage; }
  function save() { A.save(); }
  function cl(c) { c.climate = c.climate || {}; c.climate.caps = c.climate.caps || {}; c.climate.presets = c.climate.presets || [];var split=separateWeather(c.climate.presets);if(split!==c.climate.presets){c.climate.presets=split;save();} return c.climate; }
  function find(c, kind, key,sk) { return cl(c).presets.filter(function (p) { return p.kind === kind && p.key === key&&(kind!=='weather'||p.season===(sk||season())); })[0]; }
  function current(c) { return c && c.climate ? find(c, 'season', season()) : null; }
  function summary(c) {
    var x = c && c.climate, n = x && x.presets ? x.presets.length : 0, now = current(c);
    if (!n) return (!acAvailable(c)?'No working A/C · ':'')+'Your favorite settings by season and weather';
    return (!acAvailable(c)?'No working A/C · ':'')+n + ' preset' + (n === 1 ? '' : 's') + (now ? ' · Now: ' + label(now) : '');
  }
  function render(el, changed) { host = el; onChange = changed || onChange; draw(); }
  function row(id, attr, title, sub, cls) {
    return '<button type="button" class="sub-ent cl-row' + (cls ? ' ' + cls : '') + '" id="' + id + '" ' + attr + '><span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span>' + GO + '</button>';
  }
  function draw() {
    if (!host) return;
    var c = G().car(); if (!c) { host.innerHTML = ''; return; }
    var x = cl(c), now = season(), caps = capsFor(c);
    var capsOn = CAPS.filter(function (k) { return caps[k[0]]; }).map(function (k) { return k[1]; });
    var h = '<div class="field"><div class="lbl">My air conditioning is broken</div><label class="switch"><input type="checkbox" id="clAcBroken"'+(x.acBroken?' checked':'')+'><span></span></label></div>'+
      (!acAvailable(c)?'<p class="lead small keep cl-ac-note">No A/C cooling or dehumidifying. Saved settings are kept for when it works again.</p>':'')+
      '<p class="lead small keep">Your favorite settings for each season, and what you\'d do when the weather turns. Advice reminds you of the ones for this time of year.</p>';
    h += row('clCaps', '', 'Your car\'s controls', capsOn.length ? capsOn.join(', ') : 'Tell Gasket what your car has', capsOn.length ? '' : 'empty');
    h += '<h4 class="cl-h">Seasons</h4>';
    SEASONS.forEach(function (s) {
      var p = find(c, 'season', s[0]), sit = situations(s[0]), done = sit.filter(function (w) { return find(c, 'weather', w[0],s[0]); });
      h += row('clS_' + s[0], 'data-kind="season" data-key="' + s[0] + '"', EMOJI[s[0]] + ' ' + s[1] + (s[0] === now ? ' (now)' : ''), p ? line(p, caps) : 'Not set up yet', (p ? '' : 'empty') + (p && bad(p, caps) ? ' warn' : '') + (s[0] === now ? ' now' : ''));
      // under each season: what you'd do in the weather it brings (snowy, frosty, rainy…)
      h += row('clX_' + s[0], 'data-wx="' + s[0] + '"', 'Adjust for special weather conditions', done.length + ' of ' + sit.length + ' answered · ' + sit.map(function (w) { return w[1]; }).join(', '),
        'cl-wx' + (sit.some(function (w) { var q = find(c, 'weather', w[0],s[0]); return q && bad(q, caps); }) ? ' warn' : ''));
    });
    var cu = x.presets.filter(function (p) { return p.kind === 'custom'; });
    h += '<h4 class="cl-h">Custom</h4>';
    cu.forEach(function (p) { h += row('clC_' + p.id, 'data-id="' + esc(p.id) + '"', label(p), line(p, caps), bad(p, caps) ? 'warn' : ''); });
    h += '<button type="button" class="btn tonal sm cl-new" id="clAddC">+ Custom preset</button>';
    host.innerHTML = h;
    $('clAcBroken').onchange=function(){x.acBroken=this.checked;LG.info('car','A/C '+(this.checked?'marked broken':'marked working'));changed();};
    $('clCaps').onclick = function () { openCaps(c); };
    host.querySelectorAll('[data-wx]').forEach(function (b) { b.onclick = function () { openWeather(c, b.dataset.wx); }; });
    host.querySelectorAll('[data-kind]').forEach(function (b) { b.onclick = function () { var k = b.dataset.kind, p = find(c, k, b.dataset.key); if (p) openPreset(c, p.id, false); else add(c, k, b.dataset.key); }; });
    host.querySelectorAll('[data-id]').forEach(function (b) { b.onclick = function () { openPreset(c, b.dataset.id, false); }; });
    $('clAddC').onclick = function () { add(c, 'custom', ''); };
  }
  function changed() { save(); draw(); onChange(); }
  /** A season's special weather: "What would you do if it's…" each situation that season brings (answers are shared between seasons). */
  function openWeather(c, sk) {
    var x = cl(c), sn = SEASONS.filter(function (s) { return s[0] === sk; })[0], pg = null;
    var again = function () { openWeather(c, sk); };
    var fill = function () {
      var b = pg.querySelector('.sub-body'), caps = capsFor(c);
      b.innerHTML = '<p class="lead small keep">What would you do if it\'s… These answers apply only to '+esc(sn[1])+'.</p>' +
        situations(sk).map(function (w) { var p = find(c, 'weather', w[0],sk); return row('clW_' + w[0], 'data-key="' + w[0] + '"', w[1] + '…', p ? line(p, caps) : 'Tap to answer', (p ? '' : 'empty') + (p && bad(p, caps) ? ' warn' : '')); }).join('');
      b.querySelectorAll('[data-key]').forEach(function (r) { r.onclick = function () { var p = find(c, 'weather', r.dataset.key,sk); if (p) openPreset(c, p.id, false, again,sk); else add(c, 'weather', r.dataset.key, again,sk); }; });
    };
    A.subPage(EMOJI[sk] + ' ' + sn[1] + ': special weather', '', function (b) { pg = b.closest('.sub-page'); fill(); return function () { draw(); onChange(); }; });
  }
  function add(c, kind, key, back,seasonContext) {
    var x = cl(c), p = starter(kind, key, capsFor(c));
    if(kind==='weather')p.season=seasonContext||season();
    if (kind === 'custom') p.name = 'My preset' + (x.presets.filter(function (q) { return q.kind === 'custom'; }).length ? ' ' + (x.presets.filter(function (q) { return q.kind === 'custom'; }).length + 1) : '');
    x.presets.push(p); LG.info('car', 'Climate preset added: ' + label(p)); changed(); openPreset(c, p.id, true, back,seasonContext);
  }
  /** What the car's climate controls can do: decides which settings the presets show. */
  function openCaps(c) {
    var x = cl(c), pg = null;
    var fill = function () {
      var b = pg.querySelector('.sub-body'), caps = x.caps;
      b.innerHTML = '<p class="lead small keep">Turn on what your car has. Presets only show the settings your car can do.</p>' +
        CAPS.map(function (k) { return '<div class="field"><div class="lbl">' + esc(k[1]) + (k[2] ? '<small>' + esc(k[2]) + '</small>' : '') + '</div><label class="switch"><input type="checkbox" data-cap="' + k[0] + '"' + (caps[k[0]] ? ' checked' : '') + '><span></span></label></div>'; }).join('') +
        '<div class="field"><div class="lbl">Fan speeds<small>How many steps the fan has</small></div><input type="number" inputmode="numeric" min="2" max="10" id="clFanMax" value="' + (caps.fanMax || 7) + '"></div>';
      b.querySelectorAll('[data-cap]').forEach(function (i) { i.onchange = function () { caps[i.dataset.cap] = this.checked; save(); onChange(); }; });
      $('clFanMax').onchange = function () { var n = Math.max(2, Math.min(10, parseInt(this.value, 10) || 7)); caps.fanMax = n; this.value = n; x.presets.forEach(function (p) { if (+p.fan > n) p.fan = n; }); save(); };
    };
    A.subPage('Your car\'s controls', '', function (b) { pg = b.closest('.sub-page'); fill(); return function () { draw(); onChange(); }; });
  }
  function chips(k, opts, v) {
    return '<div class="chips cl-ch" data-k="' + k + '">' + opts.map(function (o) { return '<button type="button" data-v="' + esc(String(o[0])) + '" class="' + (String(v) === String(o[0]) ? 'on' : '') + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>';
  }
  function levels(max) { var a = [[0, 'Off']]; for (var i = 1; i <= max; i++) a.push([i, String(i)]); return a; }
  /** One preset, as its own page. Back keeps what you changed; at the bottom: Delete, and Discard changes (a new one goes away). */
  /** back: reopen the page this came from (a season's special weather) once it closes. */
  function openPreset(c, id, isNew, back,seasonContext) {
    var x = cl(c), p = x.presets.filter(function (q) { return q.id === id; })[0]; if (!p) return;
    var snap = JSON.stringify(p), pg = null, close = null;
    var drop = function () { x.presets = x.presets.filter(function (q) { return q !== p; }); };
    var fill = function () {
      var b = pg.querySelector('.sub-body'), caps = capsFor(c), view=effective(p,caps), h = '', top = b.scrollTop;
      if(caps.acUnavailable)h+='<p class="lead small keep cl-ac-note">A/C unavailable: blower and heat only. If the glass will not stay clear, stop safely.</p>';
      if (p.kind === 'custom') h += '<label class="nf wide"><span>Name</span><input type="text" maxlength="24" id="cpName" value="' + esc(p.name || '') + '" placeholder="e.g. Road trip"></label>';
      if(p.kind==='weather'&&seasonContext)h+='<button class="btn tonal" id="cpSeasonDefaults">Use '+esc(SEASONS.filter(function(s){return s[0]===seasonContext;})[0][1])+' defaults</button>';
      h += '<div class="cl-temps"><label class="nf wide"><span>' + (caps.dual ? 'Driver' : 'Temperature') + ' (°F)</span><input type="number" inputmode="numeric" min="55" max="90" id="cpTemp" value="' + esc(p.temp) + '"></label>' +
        (caps.dual ? '<label class="nf wide"><span>Passenger (°F)</span><input type="number" inputmode="numeric" min="55" max="90" id="cpTempP" value="' + esc(p.tempP) + '" placeholder="Same"></label>' : '') + '</div>';
      if (caps.auto&&!caps.acUnavailable) h += '<div class="nf wide"><span>Mode</span>' + chips('mode', [['auto', 'Auto'], ['manual', 'Manual']], view.mode) + '</div>';
      var fans = []; if (caps.auto && view.mode === 'auto') fans.push(['auto', 'Auto']); for (var i = 1; i <= (caps.fanMax || 7); i++) fans.push([i, String(i)]);
      if (!(caps.auto && view.mode === 'auto')) h += '<div class="nf wide"><span>Fan</span>' + chips('fan', fans, view.fan) + '</div>';
      if(!caps.acUnavailable)h += '<div class="nf wide"><span>A/C' + A.qBtn('The A/C dries the air as well as cooling it, so it clears foggy windows fastest, even with the heat on.') + '</span>' + chips('ac', [['on', 'On'], ['off', 'Off']].concat(caps.auto ? [['auto', 'Auto']] : []), view.ac) + '</div>';
      h += '<div class="nf wide"><span>Air</span>' + chips('air', [['fresh', 'Fresh air'], ['recirc', 'Recirculate']].concat(caps.auto&&!caps.acUnavailable ? [['auto', 'Auto']] : []), view.air) + '</div>';
      var w = warnings(p, caps); if (w.length) h += '<div class="cl-warn">' + w.map(function (k) { return '<p>' + esc(TEXT[k]) + '</p>'; }).join('') + '</div>';
      if (!(caps.auto && view.mode === 'auto')) h += '<div class="nf wide"><span>Vents</span>' + chips('flow', FLOW, p.flow) + '</div>';
      var sw = function (k, title, sub) { return '<div class="field"><div class="lbl">' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div><label class="switch"><input type="checkbox" data-sw="' + k + '"' + (p[k] ? ' checked' : '') + '><span></span></label></div>'; };
      h += '<div class="cl-sws">' + sw('frontDef', 'Front defrost', 'The windshield button: full fan on the glass') + (caps.rearDefrost ? sw('rearDef', 'Rear defrost') : '') +
        (caps.wheelHeat ? sw('wheel', 'Heated steering wheel') : '') + (caps.rear ? sw('rear', 'Rear climate on') : '') + '</div>';
      if (caps.seatHeat) h += '<div class="nf wide"><span>Heated seat, driver</span>' + chips('seatD', levels(3), p.seatD) + '</div><div class="nf wide"><span>Heated seat, passenger</span>' + chips('seatP', levels(3), p.seatP) + '</div>';
      if (caps.seatCool) h += '<div class="nf wide"><span>Cooled seat, driver</span>' + chips('coolD', levels(3), p.coolD) + '</div><div class="nf wide"><span>Cooled seat, passenger</span>' + chips('coolP', levels(3), p.coolP) + '</div>';
      h += '<div class="nf wide"><span>Windows</span>' + chips('windows', [['closed', 'Closed'], ['cracked', 'Cracked'], ['down', 'Down']], p.windows) + '</div>';
      if (caps.sunroof) h += '<div class="nf wide"><span>Sunroof</span>' + chips('roof', [['closed', 'Closed'], ['vent', 'Vent'], ['open', 'Open']], p.roof) + '</div>';
      h += '<label class="nf wide"><span>Notes</span><input type="text" maxlength="120" id="cpNotes" value="' + esc(p.notes || '') + '" placeholder="Anything else you like"></label>';
      h += '<div class="tz-trbtns"><button type="button" class="btn tonal sm danger-sm" id="cpDel">Delete</button><button type="button" class="btn tonal sm caution" id="cpDiscard">Discard changes</button></div>';
      b.innerHTML = h; b.scrollTop = top;
      var set = function (fn) { return function () { fn.call(this); save(); fill(); onChange(); }; };
      if($('cpSeasonDefaults'))$('cpSeasonDefaults').onclick=set(function(){
        var defaults=find(c,'season',seasonContext)||starter('season',seasonContext,caps);
        var identity={id:p.id,kind:p.kind,key:p.key,name:p.name,season:p.season};
        Object.assign(p,JSON.parse(JSON.stringify(defaults)),identity);
      });
      b.querySelectorAll('.cl-ch').forEach(function (g) {
        g.querySelectorAll('[data-v]').forEach(function (btn) { btn.onclick = set(function () { var v = btn.dataset.v, k = g.dataset.k; p[k] = /^\d+$/.test(v) ? +v : v; if (k === 'mode' && v === 'manual' && p.fan === 'auto') p.fan = 3; if (k === 'mode' && v === 'auto') p.fan = 'auto'; }); });
      });
      b.querySelectorAll('[data-sw]').forEach(function (i) { i.onchange = set(function () { p[i.dataset.sw] = this.checked; }); });
      var num = function (v) { var n = parseInt(v, 10); return isNaN(n) ? '' : Math.max(55, Math.min(90, n)); };
      $('cpTemp').onchange = set(function () { p.temp = num(this.value) || p.temp; });
      if ($('cpTempP')) $('cpTempP').onchange = set(function () { p.tempP = num(this.value); });
      if ($('cpName')) $('cpName').onchange = set(function () { p.name = this.value.trim() || p.name; pg.querySelector('.sub-bar h2').textContent = label(p); });
      $('cpNotes').onchange = function () { p.notes = this.value.trim(); save(); };
      $('cpDiscard').onclick = async function () { if(!await A.confirmDiscard())return;if (isNew) drop(); else { var o = JSON.parse(snap); Object.keys(p).forEach(function (k) { delete p[k]; }); Object.assign(p, o); } save(); close(); };
      $('cpDel').onclick = function () {
        A.confirmDel({ title: 'Delete "' + title(p) + '"?', action: 'Delete' }).then(function (ok) { if (!ok) return; drop(); LG.info('car', 'Climate preset deleted'); save(); close(); });
      };
      if (A.qify) A.qify(b);
    };
    close = A.subPage(title(p), '', function (b) { pg = b.closest('.sub-page'); fill(); return function () { draw(); onChange(); if (back) setTimeout(back, 0); }; });
  }
  /** A preset that recirculates where it shouldn't. */
  function bad(p, caps) { return p.air === 'recirc' && !recircOk(p, caps); }
  /** Recirculate's downsides haven't been acknowledged yet: Advisory's Next waits for the tick. */
  function ackDue() { return !(A.S && A.S.recircAck); }
  function setAck(on) { A.S.recircAck = on ? Date.now() : 0; LG.info('car', 'Recirculate advice ' + (on ? 'acknowledged' : 'unticked')); save(); }
  /** Advice: this season's preset, and fresh air over recirculate (louder when a preset of yours recirculates), to tick. */
  function advice(c) {
    var x = c && c.climate || {}, caps=capsFor(c), out = [], ps = x.presets || [], now = current(c);
    if(caps.acUnavailable)out.push({level:'warn',title:'No working air conditioning',paras:['No A/C cooling or dehumidifying. Plan cooler travel times and cooled rest stops in heat. Use windshield airflow and fresh air as needed; if the glass will not stay clear, stop safely. Saved A/C settings and notes are kept for when it works again.']});
    if (now) out.push({ level: 'info', title: 'This season: ' + label(now), paras: [line(now, caps) + (!caps.acUnavailable&&now.notes ? '. ' + now.notes : '')] });
    // what you said you'd do in this time of year's weather (and which ones are still open)
    var sit = situations(season()), got = sit.map(function (w) { return find(c, 'weather', w[0]); });
    if (got.some(Boolean) || ps.length) {
      var paras0 = sit.map(function (w, i) { var p = got[i]; return p ? w[1] + ': ' + line(p, caps) + (!caps.acUnavailable&&p.notes ? '. ' + p.notes : '') : null; }).filter(Boolean);
      var open = sit.filter(function (w, i) { return !got[i]; }).map(function (w) { return w[1]; });
      if (open.length) paras0.push('Not answered yet (what you\'d do if it\'s…): ' + open.join(' · ') + '. Set ' + (open.length > 1 ? 'them' : 'it') + ' up under Climate control in the Garage.');
      out.push({ level: 'info', title: 'If the weather turns', paras: paras0 });
    }
    var b = ps.filter(function (p) { return bad(p, x.caps); });
    var paras = [(b.length ? 'Your ' + b.map(label).join(', ') + ' preset' + (b.length > 1 ? 's use' : ' uses') + ' recirculate. ' : '') + RECIRC];
    if(caps.acUnavailable)paras.push('Recirculate cannot replace A/C cooling or dehumidifying. If heat or visibility becomes a concern, stop safely.');else paras.push(DRY,WHEN);
    if (x.caps && x.caps.noFilter) paras.push(NOFILTER);
    out.push({ level: b.length || ackDue() ? 'warn' : 'info', title: 'Use fresh air, not recirculate', paras: paras,
      check: { id: 'recirc', label: 'I understand when to use recirculate', on: !ackDue() } });
    return out;
  }
  window.addEventListener('garagechange', function () { if (host && host.isConnected) draw(); });
  /** Your preset for a weather situation in the season of date d (for the weather along the route): {title, line, notes} or null. */
  function presetFor(c, key, d) { if (!c || !c.climate) return null; var p = find(c, 'weather', key, season(d)),caps=capsFor(c); return p ? { title: title(p), line: line(p, caps), notes: caps.acUnavailable?'':p.notes || '' } : null; }
  root.Climate = { ackDue: ackDue, setAck: setAck, render: render, summary: summary, advice: advice, current: current, presetFor: presetFor };
})(typeof window !== 'undefined' ? window : globalThis);
