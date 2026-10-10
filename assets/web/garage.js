/* Your cars: EPA numbers (read-only), observed mileage (+ a log with typical speed), tank / battery size, what the car
 * is (powertrain, engine, transmission, drivetrain, tires), and the best-cruising-speed card. Recalls and engine advice are in Advisory (advisory.js).
 * Gas, hybrid, plug-in hybrid, electric and hydrogen fuel-cell cars: an EV's "tank" is its usable battery (kWh) and its
 * mileage is mi/kWh; a fuel-cell car's is its hydrogen tank (kg) and mi/kg. The trip planner works in those units.
 * Loaded after tripui.js; the trip setup page calls Garage.render(...). */
(function () {
  'use strict';
  var A = window.__app, S = A.S, N = A.N, P = A.P, $ = A.$, esc = A.esc, SP = window.Speed;
  var LG = window.FLog || { info: function () {}, debug: function () {}, warn: function () {} };
  var EPA = 'https://www.fueleconomy.gov/ws/rest/vehicle/';
  var VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles/';

  // Tank sizes we could confirm from manufacturer spec sheets (no free API publishes tank capacity —
  // fueleconomy.gov and NHTSA's vPIC don't have it). Anything else: type it from the owner's manual.
  // Fuel-cell cars: hydrogen tank in kg.
  var TANKS = [
    { make: /^toyota$/i, model: /^corolla hybrid$/i, from: 2020, to: 2022, gal: 11.4, src: 'Toyota spec' },
    { make: /^toyota$/i, model: /^venza/i, from: 2009, to: 2015, gal: 17.7, src: 'Toyota spec' },
    { make: /^toyota$/i, model: /^mirai/i, from: 2016, to: 2020, gal: 5.0, src: 'Toyota spec' },
    { make: /^toyota$/i, model: /^mirai/i, from: 2021, to: 2030, gal: 5.6, src: 'Toyota spec' },
    { make: /^hyundai$/i, model: /^nexo/i, from: 2019, to: 2030, gal: 6.33, src: 'Hyundai spec' },
    { make: /^honda$/i, model: /^clarity.*fuel/i, from: 2017, to: 2021, gal: 5.46, src: 'Honda spec' },
    { make: /^honda$/i, model: /^cr-v.*fcev/i, from: 2025, to: 2030, gal: 4.3, src: 'Honda spec' }
  ];
  function tankFor(c) {
    var t = TANKS.filter(function (x) { return x.make.test(c.make || '') && x.model.test(c.model || '') && c.year >= x.from && c.year <= x.to; })[0];
    return t || null;
  }
  // U.S. DOT benefit-cost guidance (2026 update, 2024 dollars): value of time for intercity personal trips.
  var DOT_TIME = 28.2;

  // ---------- what a car is ----------
  var POWER = { gas: 'Traditional', hybrid: 'Hybrid', phev: 'Plug-in hybrid', ev: 'Electric (EV)', h2: 'Hydrogen fuel cell' };
  var ASP = { na: 'Naturally aspirated', turbo: 'Turbocharged', twinturbo: 'Twin-turbo', super: 'Supercharged', both: 'Turbo + supercharged' };
  var TRANS = { auto: 'Automatic', manual: 'Manual', cvt: 'CVT', ecvt: 'eCVT (hybrid)', dct: 'Dual-clutch (DCT)', amt: 'Automated manual', single: 'Single-speed (electric)' };
  var DRIVE = { fwd: 'Front-wheel drive', rwd: 'Rear-wheel drive', awd: 'All-wheel drive', aawd: 'Adaptive AWD (on demand)', '4wd': '4WD (part-time)', '4wdf': '4WD (full-time)' };
  // What a car has, in plain words. key: the name stored on the car (kept for older saves and Advisory); one: only one of a
  // group can be true; for: which powertrains it applies to (engine = anything that burns fuel).
  var FEATURES = [
    { key: 'Active grille shutters', label: 'Active grille shutters', for: 'any',
      q: 'Flaps behind the front grille that close at highway speed so air slips around the car instead of through it, and open when the engine needs cooling. They save a little fuel at speed. You can often see them through the lower grille.' },
    { key: 'Atkinson cycle', label: 'Atkinson-cycle engine', for: 'engine',
      q: 'An engine that holds its intake valves open a little longer, trading some power for efficiency. Common in hybrids, where the electric motor makes up the power.' },
    { key: 'Cylinder deactivation', label: 'Cylinder shut-off (cylinder deactivation)', for: 'engine',
      q: 'When cruising gently, the engine switches off some cylinders to save gas (cylinder deactivation; names include Active Fuel Management, Dynamic Fuel Management, Multi-Displacement System, Variable Cylinder Management). See Advisory for why you might turn it off.' },
    { key: 'Direct injection', label: 'Direct fuel injection (GDI)', for: 'engine',
      q: 'Fuel is sprayed straight into each cylinder. It\'s efficient and powerful. Over many miles, carbon can build up on the intake valves, because fuel no longer washes over them. Engines that also have port injection avoid most of that. (Gasoline direct injection.)' },
    { key: 'Port injection', label: 'Port fuel injection', for: 'engine',
      q: 'Fuel is sprayed into the intake just before each cylinder, where it also keeps the intake valves clean. Some engines have both port and direct injection (dual injection).' },
    { key: 'DOHC', label: 'Camshafts: two per cylinder row (DOHC)', for: 'engine', one: 'cam',
      q: 'The parts that open the valves (camshafts) sit on top of the engine, two per row of cylinders: one for the intake valves and one for the exhaust. Most modern engines are built this way (dual overhead cam).' },
    { key: 'SOHC', label: 'Camshafts: one per cylinder row (SOHC)', for: 'engine', one: 'cam',
      q: 'One camshaft on top of each row of cylinders opens both the intake and exhaust valves (single overhead cam).' },
    { key: 'Pushrod', label: 'Camshafts: one, low in the engine (pushrod, OHV)', for: 'engine', one: 'cam',
      q: 'The camshaft sits low in the engine and opens the valves through long rods. It\'s compact and simple, and common in American V8s (overhead valve).' },
    { key: 'Variable valve timing', label: 'Variable valve timing', for: 'engine',
      q: 'The engine changes when its valves open as it runs, for better power and economy across speeds. Nearly every engine since the 2000s has it.' },
    { key: 'Start-stop', label: 'Engine stop at red lights (start-stop)', for: 'engine',
      q: 'The engine shuts off when the car stops and restarts when you go (automatic start-stop). In a hybrid the engine stopping is part of normal hybrid driving. See Advisory about turning it off on a regular gas car.' },
    { key: 'Regenerative braking', label: 'Regenerative braking', for: 'electric',
      q: 'When you slow down, the electric motor works as a generator and puts energy back in the battery instead of wasting it as brake heat. Your brake pads also last much longer.' },
    { key: 'Heat pump', label: 'Heat pump for cabin heat', for: 'electric',
      q: 'Heats the cabin by moving heat in from outside, like a home heat pump. It uses much less battery than a plain electric heater, which helps winter range.' },
    { key: 'Eco mode', label: 'Eco driving mode', for: 'any',
      q: 'A button or setting that softens the gas pedal and eases off the air conditioning to save fuel. Using it is up to you; it doesn\'t affect the engine\'s life.' }
  ];
  var FEATS = FEATURES.map(function (f) { return f.key; });
  function featApplies(f, c) {
    var p = c.power || 'gas', burns = p !== 'ev', electric = p !== 'gas';
    return f.for === 'any' || (f.for === 'engine' && burns && p !== 'h2') || (f.for === 'electric' && electric);
  }
  // plain words for the tiles (the stored values stay the same codes)
  var POWER_PLAIN = { gas: 'Gas engine', hybrid: 'Hybrid (gas + electric)', phev: 'Plug-in hybrid', ev: 'Fully electric', h2: 'Hydrogen fuel cell' };
  var ASP_PLAIN = { na: 'No turbocharger (naturally aspirated)', turbo: 'Turbocharger', twinturbo: 'Two turbochargers (twin-turbo)', super: 'Supercharger', both: 'Turbocharger and supercharger' };
  var DRIVE_PLAIN = { fwd: 'Front-wheel drive (FWD)', rwd: 'Rear-wheel drive (RWD)', awd: 'All-wheel drive (AWD)', aawd: 'All-wheel drive when needed (AWD)', '4wd': 'Part-time four-wheel drive (4WD)', '4wdf': 'Full-time four-wheel drive (4WD)' };
  function transPlain(i) {
    var n = +i.transN || 0;
    return { auto: 'Automatic' + (n ? ', ' + n + ' speeds' : ''), manual: 'Manual' + (n ? ', ' + n + ' speeds' : ''), cvt: 'Automatic, no fixed gears (CVT)', ecvt: 'Hybrid automatic (eCVT)',
      dct: 'Dual-clutch automatic' + (n ? ', ' + n + ' speeds' : '') + ' (DCT)', amt: 'Automated manual' + (n ? ', ' + n + ' speeds' : ''), single: 'Single speed' }[i.trans] || '';
  }
  /** "1.8L Inline 4 Cyl (2ZR-FXE)" -> "1.8-liter 4-cylinder" (+ the engine code for the (?)). */
  function enginePlain(c) {
    var e = String((c.info || {}).engine || ''), m, code = (m = /\(([^)]+)\)/.exec(e)) ? m[1] : '';
    if (kind(c) === 'ev' || /motor/i.test(e)) return { text: e.replace(/\s*\([^)]*\)/, '') || 'Electric motor', code: code };
    var l = (m = /([\d.]+)\s*L/i.exec(e)) ? m[1] : '', cyl = (m = /(?:Inline|Flat|V|W)?\s*(\d+)\s*Cyl|V(\d+)\b|Inline (\d+)|Flat (\d+)/i.exec(e)) ? (m[1] || m[2] || m[3] || m[4]) : '';
    var shape = /\bV\d|V-?shaped|\bV\s*\d/i.test(e) ? ' V' : /flat|opposed|boxer/i.test(e) ? ' flat' : '';
    var t = l ? l + '-liter' + (cyl ? (shape === ' V' ? ' V' + cyl : ' ' + cyl + '-cylinder' + (shape === ' flat' ? ' (flat)' : '')) : '') : e.replace(/\s*\([^)]*\)/, '');
    return { text: t, code: code };
  }
  var TIRES = { allseason: 'All-season', touring: 'Touring (all-season)', lrr: 'Low rolling resistance (eco)', performance: 'Summer / performance', allterrain: 'All-terrain', mud: 'Mud-terrain', winter: 'Winter', allweather: 'All-weather (3PMSF)' };
  var PLUGS = { CCS: 'CCS (Combo 1)', NACS: 'NACS (Tesla)', CHADEMO: 'CHAdeMO' };
  var UNITS = {
    gas: { unit: 'gal', per: 'mpg', cap: 'Tank size (gal)', econ: 'Fuel economy (MPG)', fuelWord: 'Gas', price: '$/gal' },
    ev: { unit: 'kWh', per: 'mi/kWh', cap: 'Usable battery (kWh)', econ: 'Efficiency (mi/kWh)', fuelWord: 'Charge', price: '$/kWh' },
    h2: { unit: 'kg', per: 'mi/kg', cap: 'Hydrogen tank (kg)', econ: 'Fuel economy (mi/kg)', fuelWord: 'Hydrogen', price: '$/kg' }
  };
  function kind(c) { c = c || car(); return c && c.power === 'ev' ? 'ev' : c && c.power === 'h2' ? 'h2' : 'gas'; }
  function units(c) { return UNITS[kind(c)]; }
  function unit() { return units().unit; }
  /** The plugs (station-finder names) this EV can use, counting an adapter it carries. */
  function plugs(c) {
    c = c || car(); var p = c.plug || 'CCS', out = { CCS: ['J1772COMBO'], NACS: ['TESLA'], CHADEMO: ['CHADEMO'] }[p] || ['J1772COMBO'];
    if (c.adapter && p === 'CCS') out = out.concat(['TESLA']);
    if (c.adapter && p === 'NACS') out = out.concat(['J1772COMBO']);
    return out;
  }
  /** Miles on a full tank / charge at highway mileage (yours if you've logged it, else the EPA's). */
  function rangeHwy(c) { c = c || car(); return obsHwy(c) > 0 && +c.tank > 0 ? obsHwy(c) * +c.tank : 0; }
  function rangeTile(c) {
    var r = rangeHwy(c), U = units(c), mine = +c.obs.hwy > 0;
    if (!(r > 0)) return '';
    var q = '<b>Range</b>: how far a full ' + (kind(c) === 'ev' ? 'charge' : 'tank') + ' goes on the highway: ' + fmtPer(obsHwy(c)) + ' ' + U.per + ' (' + (mine ? 'your highway mileage' : 'EPA highway') + ') × ' + r2(+c.tank) + ' ' + U.unit +
      (c.tankSrc ? ' (' + esc(c.tankSrc) + ')' : '') + '. City driving and high speeds go less far.' + (kind(c) === 'ev' ? ' Trip plans charge to 80%, so a stop is planned before that.' : '');
    return '<div class="rng"><b>' + Math.round(r) + '</b><span>Range, mi</span>' + A.qBtn(q) + '</div>';
  }
  /** Miles on a full tank / charge, from your mileage (or the EPA's) and the tank size. */
  function rangeMi(c) { c = c || car(); var m = obsHwy(c) && obsCity(c) ? harm(obsCity(c), obsHwy(c)) : 0; return m > 0 && +c.tank > 0 ? m * +c.tank : (c.epa && +c.epa.range) || 0; }

  // ---------- data ----------
  function seeds() {
    return [
      { id: 'corolla20', name: '2020 Toyota Corolla Hybrid LE', year: 2020, make: 'Toyota', model: 'Corolla Hybrid', trim: 'LE', epaId: '41214',
        epa: { city: 53, hwy: 52, comb: 52, fuel: 'Regular Gasoline' }, type: 'hybrid', power: 'hybrid', grade: 'regular',
        tank: 11.4, tankSrc: TANKS[0].src, obs: {}, entries: [], info: seedInfo('corolla20') },
      { id: 'venza12', name: '2012 Toyota Venza XLE 3.5L V6 FWD', year: 2012, make: 'Toyota', model: 'Venza', trim: 'XLE', epaId: '32199',
        epa: { city: 19, hwy: 26, comb: 21, fuel: 'Regular Gasoline' }, type: 'suv', power: 'gas', grade: 'regular',
        tank: 17.7, tankSrc: TANKS[1].src, obs: {}, entries: [], info: seedInfo('venza12') }
    ];
  }
  function seedInfo(id) {
    if (id === 'corolla20') return { engine: '1.8L Inline 4 Cyl (2ZR-FXE)', asp: 'na', trans: 'ecvt', drive: 'fwd', features: ['Atkinson cycle', 'Port injection', 'Variable valve timing', 'DOHC', 'Regenerative braking'] };
    if (id === 'venza12') return { engine: '3.5L V6 (2GR-FE)', asp: 'na', trans: 'auto', transN: 6, drive: 'fwd', features: ['Port injection', 'Variable valve timing', 'DOHC'] };
    return {};
  }
  if (!Array.isArray(S.cars) || !S.cars.length) {
    S.cars = seeds();
    var old = S.car;
    if (old && old.name) {     // keep a car set up in an earlier version
      S.cars.unshift({ id: 'c' + Date.now(), name: old.name, epa: { city: old.city, hwy: old.hwy, comb: old.comb, fuel: old.epaFuel || '' },
        type: 'car', grade: old.grade || '', tank: old.tank, tankSrc: 'you entered it',
        obs: old.adjustPct && old.adjustPct !== 100 ? { city: r1(old.city * old.adjustPct / 100), hwy: r1(old.hwy * old.adjustPct / 100) } : {}, entries: [] });
    }
    S.carId = S.cars[0].id;
  }
  // cars saved before 3.25: powertrain, trim and the details tile
  S.cars.forEach(function (c) {
    c.obs = c.obs || {}; c.entries = c.entries || [];
    if (!c.power) c.power = /electric/i.test(c.epa && c.epa.fuel || '') ? 'ev' : /hydrogen/i.test(c.epa && c.epa.fuel || '') ? 'h2' : c.type === 'hybrid' ? 'hybrid' : 'gas';
    if (c.trim == null) c.trim = '';
    if (!c.info) c.info = seedInfo(c.id);
    // 0.0.51: where each detail came from (vin / epa: confirmed; user: you set it)
    if (!c.info.src) c.info.src = {};
    if (!c.info.featSrc) c.info.featSrc = {};
    // 0.0.53: the tire fields moved to their own card
    if (!c.tires && (c.info.tireType || c.info.tire)) c.tires = { type: TIRES[c.info.tireType] || '', model: c.info.tire || '', tread: { mode: 'miles', miles: '', rotated: '' } };
  });
  S.speed = Object.assign({ min: 55, max: 84, price: '' }, S.speed || {});

  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function car() { return S.cars.filter(function (c) { return c.id === S.carId; })[0] || S.cars[0]; }
  function harm(city, hwy) { return 1 / (0.55 / city + 0.45 / hwy); }
  function obsCity(c) { return +c.obs.city > 0 ? +c.obs.city : (c.epa && c.epa.city) || 0; }
  function obsHwy(c) { return +c.obs.hwy > 0 ? +c.obs.hwy : (c.epa && c.epa.hwy) || 0; }
  function hasEpa(c) { return c.epa && c.epa.city > 0 && c.epa.hwy > 0; }
  function pctOf(c) { return hasEpa(c) ? Math.round(harm(obsCity(c), obsHwy(c)) / harm(c.epa.city, c.epa.hwy) * 100) : 100; }
  /** What the trip planner uses: your observed numbers where you have them, else the EPA's (miles per gal / kWh / kg). */
  function carModel() {
    var c = car(), k = kind(c), city = obsCity(c) || (k === 'ev' ? 3.5 : k === 'h2' ? 65 : 25), hwy = obsHwy(c) || (k === 'ev' ? 3.0 : k === 'h2' ? 60 : 33);
    var comb = hasEpa(c) && c.epa.comb ? c.epa.comb * harm(city, hwy) / harm(c.epa.city, c.epa.hwy) : harm(city, hwy);
    return { city: city, hwy: hwy, comb: comb, adjustPct: 100, kind: k };
  }
  function grade() { var k = kind(); return k === 'ev' ? 'electric' : k === 'h2' ? 'hydrogen' : car().grade || S.grade || 'regular'; }
  function tank() { return +car().tank || (kind() === 'ev' ? 60 : kind() === 'h2' ? 5.6 : 14); }
  function save() { A.save(); }
  function fmtPer(v) { return kind() === 'gas' ? Math.round(v) : (Math.round(v * 10) / 10).toFixed(1); }

  // ---------- page ----------
  var host = null, speedHost = null, onChange = function () {}, editing = false, call = null, epaOpen = false;
  // the VIN is the car's identity: dots like a password until you tap the eye
  var vinShown = false;
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.3 2 2 3.3l3.1 3.1C3.4 7.8 2.2 9.8 1.5 12c1.2 2.7 5 7 10.5 7 1.8 0 3.4-.4 4.8-1.2l3.9 3.9 1.3-1.3L3.3 2zM12 16.5A4.5 4.5 0 0 1 7.5 12c0-.8.2-1.6.6-2.2l1.5 1.5c-.1.2-.1.5-.1.7a2.5 2.5 0 0 0 3.2 2.4l1.5 1.5c-.7.4-1.4.6-2.2.6zm10.5-4.5c-.7-1.6-2.2-3.7-4.4-5.2A11 11 0 0 0 12 5c-1.3 0-2.6.2-3.7.6l2.1 2.1c.5-.1 1-.2 1.6-.2a4.5 4.5 0 0 1 4.5 4.5c0 .6-.1 1.1-.3 1.6l2.9 2.9c1.6-1.3 2.8-2.9 3.4-4.5z"/></svg>';
  var epaStay = null;   // the car whose EPA lookup you have open: it stays open across redraws until you close it
  function render(carEl, speedEl, changed, nativeCall) {
    host = carEl; onChange = changed || onChange; call = nativeCall || call;
    if (speedEl && speedEl !== host && speedEl.parentNode) speedEl.remove();   // the speed card lives inside the garage now
    draw();
  }
  function changed() { save(); onChange(); drawSpeed(); try { window.dispatchEvent(new Event('garagechange')); } catch (e) { } }

  var drawing = false;
  function draw() {
    if (matching) { drawLater = true; return; }   // a VIN match is filling the pickers: redraw once it's done
    if (!host || drawing) return;
    drawing = true;
    try { settle(host); draw0(); } finally { drawing = false; }
  }
  // Your car (the buttons; details behind Edit), best cruising speed, fuel economy, observed mileage, about this car.
  var obsOpen = false, infoOpen = false, tiresOpen = false, climOpen = false;
  var EPA_Q = {
    city: '<b>EPA city</b>: a lab test of stop-and-go driving — about 11 miles averaging 21 mph (top speed 56), with frequent stops and idling. Since 2008 it\'s adjusted for A/C, cold starts and harder acceleration.',
    hwy: '<b>EPA highway</b>: a lab test of rural and interstate driving — about 10 miles averaging 48 mph (top speed 60), no stops. Steady 70+ mph cruising uses more than this.',
    comb: '<b>EPA combined</b>: 55% city and 45% highway. Trip plans start from these numbers, then use your logged mileage and the speeds on your route. Source: fueleconomy.gov.',
    ev: ' The EPA rates EVs in kWh per 100 miles (from the wall, so charging losses count): 100 ÷ that = miles per kWh. Cold weather, heat and speed change it a lot more than on a gas car.',
    h2: ' For fuel-cell cars the EPA\'s MPGe is miles per kg of hydrogen (1 kg holds about the energy of a gallon of gas).'
  };
  function draw0() {
    var c = car(), U = units(c), k = kind(c);
    var h = '<div class="card g-car"><div class="g-top"><h3>Your car</h3><button class="btn tonal sm" id="gEdit">' + (editing ? 'Done' : 'Edit') + '</button></div>' + carousel(c);
    if (editing) h += editPanel(c);
    h += '</div>';
    h += '<div class="card spd" id="tSpeed"></div>';
    h += '<div class="card g-econ"><h3>' + U.econ + '</h3>';
    if (hasEpa(c)) {
      var tile = function (v, label, q) { return '<div><b>' + fmtPer(v) + '</b><span>' + label + '</span>' + A.qBtn(q + (EPA_Q[k] || '')) + '</div>'; };
      h += '<div class="epa-tiles">' + tile(c.epa.city, 'City', EPA_Q.city) + tile(c.epa.hwy, 'Highway', EPA_Q.hwy) +
        tile(c.epa.comb || harm(c.epa.city, c.epa.hwy), 'Combined', EPA_Q.comb) + rangeTile(c) + '</div>';
      if (k === 'ev' && c.epa.kwh) h += '<div class="lead small keep">EPA: ' + c.epa.kwh.city + ' / ' + c.epa.kwh.hwy + ' / ' + c.epa.kwh.comb + ' kWh per 100 mi' + (c.epa.range ? ' · ' + c.epa.range + ' mi range' : '') + '</div>';
    } else h += '<div class="msg">No EPA numbers yet — tap Edit and look your car up' + (k === 'gas' ? '' : ', or enter your own under Observed') + '.</div>';
    h += '</div>';
    h += '<details class="card g-obs" id="gObs"' + (obsOpen ? ' open' : '') + '><summary>Observed mileage</summary>' + obsPanel(c) + '</details>';
    h += '<details class="card g-obs g-info" id="gInfo"' + (infoOpen ? ' open' : '') + '><summary><span>About this car<small>' + esc(infoLine(c)) + '</small></span></summary>' + infoPanel(c) + '</details>';
    h += '<details class="card g-obs g-tires" id="gTires"' + (tiresOpen ? ' open' : '') + '><summary><span>Tires<small id="gTiresLine">' + (window.Tires ? Tires.summaryHtml(c) : '') + '</small></span></summary><div id="gTiresIn"></div></details>';
    h += '<details class="card g-obs g-clim" id="gClimate"' + (climOpen ? ' open' : '') + '><summary><span>Climate control<small id="gClimLine">' + esc(window.Climate ? Climate.summary(c) : '') + '</small></span></summary><div id="gClimIn"></div></details>';
    host.innerHTML = h;
    restoreEMsg();
    speedHost = $('tSpeed');
    $('gObs').addEventListener('toggle', function () { obsOpen = this.open; });
    if ($('tEpa')) $('tEpa').addEventListener('toggle', function () { epaStay = this.open ? c.id : null; });
    $('gInfo').addEventListener('toggle', function () { infoOpen = this.open; });
    $('gTires').addEventListener('toggle', function () { tiresOpen = this.open; });
    $('gClimate').addEventListener('toggle', function () { climOpen = this.open; });
    if (window.Climate) Climate.render($('gClimIn'), function () { var l = $('gClimLine'); if (l) l.textContent = Climate.summary(c); try { window.dispatchEvent(new Event('garagechange')); } catch (e) { } });
    if (window.Tires) Tires.render($('gTiresIn'), call, function () { var l = $('gTiresLine'); if (l) l.innerHTML = Tires.summaryHtml(c); try { window.dispatchEvent(new Event('garagechange')); } catch (e) { } });
    bind(c);
    drawSpeed();
    setTimeout(function () { tankAuto(car()); }, 0);
  }
  // ---------- the tank size, from Brave Search's AI answer ----------
  // A gas or hybrid car with no tank size gets it looked up once, in the hidden window: Brave Search with its AI answer,
  // "<year make model trim> fuel tank capacity in gallons?". The number fills the box (marked as Brave's answer, to
  // check). If it fails (or Brave shows a check, which is never got around), the box has a ↻ and "Search Brave yourself"
  // opens the page for you; typing it in always works.
  var tankBusy = {}, TANK_SRC = 'from Brave Search\'s AI answer · check your owner\'s manual';
  // the hidden Brave Search page reads one question at a time (the tank size here, the spare in Tires)
  var braveChain = Promise.resolve();
  function braveSerial(fn) { var p = braveChain.then(fn, fn); braveChain = p.catch(function () { }); return p; }
  function tankKey(c) { return c && c.year && c.make && c.model ? [c.year, c.make, baseOf(c), c.trim || ''].join(' ').replace(/\s+/g, ' ').trim() : ''; }
  function tankUrl(c) { return 'https://search.brave.com/search?q=' + encodeURIComponent(tankKey(c) + ' fuel tank capacity in gallons?') + '&summary=1'; }
  function tankAuto(c) {
    if (!c || +c.tank > 0 || kind(c) !== 'gas' || !call || !N.siteRead || tankBusy[c.id] || matching) return;
    var key = tankKey(c); if (!key) return;
    var L = c.tankLookup; if (L && L.key === key && (!L.failed || Date.now() - L.t < 6 * 3600e3)) return;   // once per car (a failure: again after 6 h)
    tankFind(c, false);
  }
  async function tankFind(c, shown) {
    var key = tankKey(c); if (!key || tankBusy[c.id]) return;
    tankBusy[c.id] = true; draw();
    LG.info('car', 'Asking Brave Search for the tank size' + (shown ? ' (shown to you)' : ''), key);
    var ask = function () { return Promise.race([call(shown ? 'siteShow' : 'siteRead', 'brave', JSON.stringify({ url: tankUrl(c), bg: !shown, year: c.year })),
      new Promise(function (ok) { if (!shown) setTimeout(function () { ok(null); }, 40000); })]); };
    var r = await (shown ? ask() : braveSerial(ask));
    tankBusy[c.id] = false;
    if (r && r.gal >= 4 && r.gal <= 45 && c.tankSrc !== 'you entered it') {
      c.tank = r2(r.gal); c.tankSrc = TANK_SRC; c.tankLookup = { key: key, t: Date.now(), gal: r.gal };
      LG.info('car', 'Tank size from Brave Search' + (r.src === 'results' ? '\'s results (no AI answer)' : r.src === 'ai' ? '\'s AI answer' : '') + ': ' + r.gal + ' gal', r.text || '');
      changed();
    } else if (!(r && r.closed)) {
      c.tankLookup = { key: key, t: Date.now(), failed: true }; save();
      LG.warn('car', 'Tank size lookup got no answer', r ? (r.blocked ? 'a check on Brave Search\'s page' : r.error || '') : 'no reply in 40 s');
    }
    draw();
  }
  /**
   * What the trip planner still needs from the car, top to bottom: the EPA lookup (or your own city + highway mileage),
   * then the tank / battery size. Opens the editor so the missing field is on screen -> {el, kind: 'box'|'pick', msg} or null.
   */
  /** Is the car ready for a trip (mileage and tank size), without pointing at anything? */
  function tiresMissing(c) { return window.Tires && Tires.missing ? Tires.missing(c).length : 0; }
  function ok() { var c = car(); return !!c && !matching && (hasEpa(c) || (+(c.obs || {}).city > 0 && +(c.obs || {}).hwy > 0)) && +c.tank > 0 && !tiresMissing(c); }
  function need() {
    var c = car(), mpgOk = hasEpa(c) || (+c.obs.city > 0 && +c.obs.hwy > 0), tankOk = +c.tank > 0, k = kind(c);
    if (mpgOk && tankOk) {
      // tires that aren't all the same, not all filled in: fill them in, or discard the tire changes
      var nm = tiresMissing(c); if (!nm) return null;
      var gt = document.getElementById('gTires'); if (gt && !gt.open) { gt.open = true; tiresOpen = true; }
      return { el: document.getElementById('tzMiss') || gt, kind: 'pick', msg: nm + ' tire(s) missing details: fill them in or discard the tire changes.' };
    }
    if (!mpgOk && !editing && host) { editing = true; epaOpen = true; draw(); epaOpen = false; }
    if (!mpgOk) {
      var d = document.getElementById('tEpa'); if (d && !d.open) d.open = true;
      var sel = ['eYear', 'eMake', 'eModel', 'eOpt'].map(function (id) { return document.getElementById(id); }).filter(function (e) { return e && !e.value; })[0];
      return { el: sel || d, kind: 'pick', msg: 'Look up your car so trips know its ' + (k === 'gas' ? 'mileage' : 'efficiency') + '.' };
    }
    if (!editing && host) { editing = true; draw(); }
    return { el: document.getElementById('gTank'), kind: 'box', msg: k === 'ev' ? 'Enter your usable battery size.' : k === 'h2' ? 'Enter your hydrogen tank size.' : 'Enter your tank size.' };
  }
  /** "2020 Corolla Hybrid LE": year, model and (when you gave one) trim. */
  function shortName(x) {
    if (x.year && x.model) return x.year + ' ' + String(x.model).replace(/\s+(2WD|4WD|FWD|AWD|RWD)$/i, '') + (x.trim ? ' ' + x.trim : '');
    return x.name || 'New car';
  }
  function opts(map, cur, blank) {
    return (blank != null ? '<option value="">' + blank + '</option>' : '') + Object.keys(map).map(function (k) { return '<option value="' + esc(k) + '"' + (cur === k ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join('');
  }
  // ---------- your cars, one at a time: its picture, swipe or the arrows for the next ----------
  var slideIn = 0;
  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>';
  var PAINTS = [['White', '#f4f4f2'], ['Black', '#1b1c1f'], ['Silver', '#c9ccd0'], ['Gray', '#6d7178'], ['Red', '#a3161c'], ['Blue', '#1d3f8f'], ['Green', '#2f5d3a'],
    ['Brown', '#5a3d2b'], ['Beige', '#cdbb98'], ['Gold', '#b8953f'], ['Orange', '#d4631c'], ['Yellow', '#e3b81f']];
  function picHtml(c) {
    var src = window.CarPics && CarPics.src(c);
    if (src) return '<img src="' + src + '" alt="' + esc(shortName(c)) + '">';
    var p = c.pic, waiting = window.CarPics && c.year && c.model && (!p || (!p.fail && p.sig));
    return (window.CarPics ? CarPics.drawing(c) : '') + (waiting && !(p && p.fail) ? '<div class="gc-ld">' + A.ldBar('Finding a picture') + '</div>' : '');
  }
  function carousel(c) {
    var i = S.cars.indexOf(c), n = S.cars.length, many = n > 1;
    var sub = [c.paint && c.paint.name, window.CarPics && CarPics.credit(c)].filter(Boolean).join(' · ');
    var h = '<div class="gc" id="gCars"><button type="button" class="gc-nav prev" id="gcPrev" aria-label="Previous car"' + (many ? '' : ' disabled') + '>' + ARROW + '</button>' +
      '<div class="gc-stage" id="gcStage" tabindex="0" aria-roledescription="carousel" aria-label="Your cars: swipe or use the arrow keys">' +
      '<div class="gc-slide carchip on' + (slideIn ? (slideIn > 0 ? ' in-r' : ' in-l') : '') + '"><div class="gc-pic" id="gcPic">' + picHtml(c) + '</div>' +
      '<b class="gc-name">' + esc(shortName(c)) + '</b>' + (sub ? '<small class="gc-sub" id="gcSub">' + esc(sub) + '</small>' : '<small class="gc-sub" id="gcSub"></small>') + '</div></div>' +
      '<button type="button" class="gc-nav next" id="gcNext" aria-label="Next car"' + (many ? '' : ' disabled') + '>' + ARROW + '</button></div>';
    h += '<div class="gc-dots">' + S.cars.map(function (x, j) { return '<button type="button" class="gc-dot' + (j === i ? ' on' : '') + '" data-car="' + esc(x.id) + '" aria-label="' + esc(shortName(x)) + '"></button>'; }).join('') +
      '<button type="button" class="gc-add" data-car="+">+ Add car</button></div>';
    slideIn = 0;
    return h;
  }
  /** Next / previous car (wraps around), with the slide sliding. */
  function go(d) {
    var n = S.cars.length; if (n < 2) return;
    var i = S.cars.indexOf(car()), nx = S.cars[(i + d + n) % n], sl = host.querySelector('.gc-slide');
    if (sl) sl.classList.add(d > 0 ? 'out-l' : 'out-r');
    setTimeout(function () { S.carId = nx.id; editing = false; slideIn = d; LG.info('car', 'Selected ' + shortName(nx)); draw(); changed(); }, sl ? 140 : 0);
  }
  function bindCarousel(c) {
    $('gcPrev').onclick = function () { go(-1); }; $('gcNext').onclick = function () { go(1); };
    var st = $('gcStage'), x0 = null, y0 = 0, sl = st.querySelector('.gc-slide');
    st.onkeydown = function (e) { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } };
    st.addEventListener('pointerdown', function (e) { if (S.cars.length < 2) return; x0 = e.clientX; y0 = e.clientY; });
    st.addEventListener('pointermove', function (e) { if (x0 == null) return; var dx = e.clientX - x0; if (Math.abs(dx) > Math.abs(e.clientY - y0)) sl.style.transform = 'translateX(' + Math.max(-60, Math.min(60, dx * 0.5)) + 'px)'; });
    var end = function (e) { if (x0 == null) return; var dx = e.clientX - x0; x0 = null; sl.style.transform = ''; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(e.clientY - y0)) go(dx < 0 ? 1 : -1); };
    st.addEventListener('pointerup', end); st.addEventListener('pointercancel', function () { x0 = null; sl.style.transform = ''; });
    if (window.CarPics) { CarPics.ensure(c); var n = S.cars.length, i = S.cars.indexOf(c); if (n > 1) { CarPics.ensure(S.cars[(i + 1) % n]); CarPics.ensure(S.cars[(i - 1 + n) % n]); } }
  }
  // a picture came in: put it in place (no redraw)
  window.addEventListener('carpic', function (e) {
    var c = car(); if (!c || e.detail !== c.id || !host) return;
    var p = document.getElementById('gcPic'); if (p) p.innerHTML = picHtml(c);
    var s = document.getElementById('gcSub'); if (s) s.textContent = [c.paint && c.paint.name, window.CarPics && CarPics.credit(c)].filter(Boolean).join(' · ');
    var pp = document.getElementById('gPaints'); if (pp && editing) pp.outerHTML = paintHtml(c);
    if (editing) bindPaints(c);
  });
  /** The paint colors: the trim's factory colors (Fuel API), else common ones (they color the drawing). */
  function paintHtml(c) {
    var cols = window.CarPics ? CarPics.colors(c) : [], list = cols.length ? cols.map(function (x) { return [x.name, x.rgb || '#999', x.code]; }) : PAINTS.map(function (x) { return [x[0], x[1], '']; });
    var cur = c.paint || {};
    return '<div class="nf wide" id="gPaints"><span>Paint color<small>' + (cols.length ? 'your trim\'s factory colors' : 'colors the picture when there\'s no photo in your color') + '</small></span><div class="gc-paints">' +
      list.map(function (x) { var on = cur.code ? cur.code === x[2] : cur.name === x[0]; return '<button type="button" class="gc-paint' + (on ? ' on' : '') + '" data-paint="' + esc(x[0]) + '" data-code="' + esc(x[2]) + '" data-rgb="' + esc(x[1]) + '" style="background:' + esc(x[1]) + '" aria-label="' + esc(x[0]) + '" title="' + esc(x[0]) + '"></button>'; }).join('') +
      '</div>' + (cur.name ? '<small class="gc-paint-name">' + esc(cur.name) + '</small>' : '') + '</div>';
  }
  function bindPaints(c) {
    host.querySelectorAll('[data-paint]').forEach(function (b) {
      b.onclick = function () { c.paint = { name: b.dataset.paint, code: b.dataset.code || '', rgb: b.dataset.rgb || '' }; LG.info('car', 'Paint: ' + c.paint.name); save(); draw(); if (window.CarPics) CarPics.ensure(c); };
    });
  }
  function editPanel(c) {
    var k = kind(c), U = units(c);
    var auto = c.typeAuto ? ' (from the EPA: ' + SP.TYPES[c.typeAuto].label.toLowerCase() + ')' : '';
    var h = '<div class="g-edit">';
    // one menu: the VIN first (worth the trouble: exact version, open recalls, factory tires; outlined in green until the
    // car has one), then year / make / model, which a VIN lookup fills in
    var recVin = !c.vin;
    h += '<div class="vin-row' + (recVin ? ' rec' : '') + '"><label class="nf"><span>VIN' + (recVin ? '<span class="rec-tag">Recommended</span>' : '') + '<small>Gets your exact version, checks it for open recalls and finds its factory tire size. 17 characters — on your insurance card, registration, or the driver-side dashboard (through the windshield)</small></span>' +
        '<span class="vin-box"><input type="text" id="gVin" class="' + (vinShown ? '' : 'masked') + '" maxlength="20" autocapitalize="characters" autocomplete="off" spellcheck="false" value="' + esc(c.vin || '') + '">' +
        '<button type="button" class="vin-eye" id="gVinEye" aria-label="' + (vinShown ? 'Hide' : 'Show') + ' the VIN" aria-pressed="' + vinShown + '">' + (vinShown ? EYE_OFF : EYE) + '</button></span></label>' +
        '<button class="btn primary sm" id="gVinGo">Look up</button></div><div class="epa-msg" id="vMsg"></div>' +
        '<p class="lead small keep">Decoded free by NHTSA (vpic.nhtsa.dot.gov), then matched to the EPA\'s mileage, and fills in the details below.</p>';
    h += '<details class="epa" id="tEpa"' + (hasEpa(c) && !epaOpen && epaStay !== c.id ? '' : ' open') + '><summary>Year / make / model<small>' + (hasEpa(c) && c.year ? esc([c.year, c.make, c.model].join(' ')) : 'no VIN? pick your car here') + '</small></summary>' +
      '<div class="epa-grid"><select id="eYear"><option value="">Year</option></select><select id="eMake" disabled><option>Make</option></select>' +
      '<select id="eModel" disabled><option>Model</option></select><select id="eOpt" disabled><option>Engine / transmission</option></select></div>' +
      '<div class="epa-msg" id="eMsg"></div></details>';
    if (!(c.year && c.model)) h += '<label class="nf wide"><span>Name</span><input type="text" id="gName" value="' + esc(c.name || '') + '"></label>';
    h += '<label class="nf wide"><span>Trim<small>optional · shows on the car\'s button, like “' + esc((c.year || 2020) + ' ' + String(c.model || 'Corolla').replace(/\s+(2WD|4WD|FWD|AWD|RWD)$/i, '')) + ' Two”</small></span><input type="text" id="gTrim" maxlength="24" value="' + esc(c.trim || '') + '"></label>';
    h += paintHtml(c);
    var tankFindable = k === 'gas' && !!tankKey(c);
    h += '<div class="grid2 g-pair"><label class="nf"><span>' + U.cap + '<span class="req" aria-label="required">*</span><small>' + esc(c.tankSrc || (k === 'ev' ? 'what the car can use, not the gross pack' : 'from your owner\'s manual')) + '</small></span>' +
      '<span class="tk-join' + (tankFindable ? ' has-find' : '') + '"><input type="number" inputmode="decimal" step="0.1" id="gTank" value="' + esc(c.tank || '') + '">' +
      (tankFindable ? '<button type="button" class="btn primary sm tk-find" id="gTankFind" aria-label="Look the tank size up again"' + (tankBusy[c.id] ? ' disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg></button>' : '') + '</span></label>';
    // under the row, so the two boxes stay level
    var tkExtra = tankFindable && tankBusy[c.id] ? A.ldBar('Asking Brave Search') : tankFindable && c.tankLookup && c.tankLookup.failed && !(+c.tank > 0) ? '<small class="tk-fail">Couldn\'t find it. <a href="#" id="gTankShow">Search Brave yourself</a>, or type it in.</small>' : '';
    if (k === 'ev') h += '<label class="nf"><span>Fastest DC charging (kW)<small>the car\'s peak · blank = 150</small></span><input type="number" inputmode="numeric" step="1" id="gDcKw" value="' + esc(c.dcKw || '') + '"></label></div>' +
      '<div class="grid2"><label class="nf"><span>Charge port</span><select id="gPlug">' + opts(PLUGS, c.plug || 'CCS') + '</select></label>' +
      '<label class="nf chk"><span>I carry an adapter<small>' + ((c.plug || 'CCS') === 'NACS' ? 'NACS → CCS: CCS fast chargers too' : (c.plug || 'CCS') === 'CCS' ? 'CCS → NACS: Tesla Superchargers open to other cars too' : 'no common adapter') + '</small></span><input type="checkbox" id="gAdapter"' + (c.adapter ? ' checked' : '') + '></label></div>';
    else h += '<label class="nf"><span>Vehicle type<small>shapes the cruising-speed curve' + esc(auto) + '</small></span><select id="gType"' + (k === 'h2' ? ' disabled' : '') + '>' + Object.keys(SP.TYPES).map(function (t) {
      return '<option value="' + t + '"' + ((c.type || 'car') === t ? ' selected' : '') + '>' + SP.TYPES[t].label + '</option>'; }).join('') + '</select></label></div>';
    h += tkExtra + (S.cars.length > 1 ? '<button class="btn tonal danger" id="gRemove">Remove this car</button>' : '') + '</div>';
    return h;
  }
  function infoLine(c) {
    var i = c.info || {}, bits = [POWER_PLAIN[c.power] || '', enginePlain(c).text, i.drive ? DRIVE_PLAIN[i.drive] || '' : ''].filter(Boolean);
    return bits.length ? bits.join(' · ') : 'engine, transmission, features, tires';
  }
  // ---------- versions of a model (the EPA's options for the year / make / model, with its 2WD / AWD siblings) ----------
  var DRV_SUFFIX = /\s+(2WD|4WD|AWD|FWD|RWD|4x4)$/i;
  function isCustom(c) { return !c.epaId && !c.vin; }
  function baseOf(c) { return String(c.epaBase || c.model || '').replace(DRV_SUFFIX, '').trim(); }
  function variantKey(c) { return c.year && c.make && baseOf(c) ? c.year + '|' + c.make + '|' + baseOf(c) : ''; }
  /** "Auto (S6), 6 cyl, 3.5 L, Turbo" (+ the model's drive suffix) -> its parts. */
  function parseOpt(text, model) {
    var t = String(text || ''), m;
    var p = { displ: (m = /([\d.]+)\s*L\b/.exec(t)) ? m[1] : '', cyl: (m = /(\d+)\s*cyl/i.exec(t)) ? m[1] : '',
      trans: /variable gear|\bAV\b|AV-S\d|CVT/i.test(t) ? 'cvt' : /\(AM/i.test(t) ? 'dct' : /^auto/i.test(t) ? 'auto' : /^man/i.test(t) ? 'manual' : '',
      n: (m = /\((?:S|A|AM-S|AM|M|AV-S)(\d+)\)/i.exec(t)) ? +m[1] : 0,
      asp: /turbo/i.test(t) ? 'turbo' : /super/i.test(t) ? 'super' : 'na' };
    var dm = DRV_SUFFIX.exec(model || '');
    p.drive = dm ? ({ '2WD': '2wd', FWD: 'fwd', RWD: 'rwd', AWD: 'awd', '4WD': '4wd', '4X4': '4wd' }[dm[1].toUpperCase()] || '') : '';
    return p;
  }
  function variantText(p) {
    return [p.displ ? p.displ + '-liter' + (p.cyl ? ' ' + p.cyl + '-cylinder' : '') + (p.asp && p.asp !== 'na' ? ', ' + ASP_PLAIN[p.asp].toLowerCase() : '') : '',
      p.trans ? transPlain({ trans: p.trans, transN: p.n }).toLowerCase() : '',
      p.drive ? (p.drive === '2wd' ? 'two-wheel drive' : (DRIVE_PLAIN[p.drive] || '').toLowerCase()) : ''].filter(Boolean).join(' · ');
  }
  function variantList(c) { return c.variants && c.variants.key === variantKey(c) && c.variants.list ? c.variants.list : []; }
  /** Which details differ between this model's versions (nothing when the VIN says which one it is). */
  function varies(c) {
    var l = variantList(c), out = {};
    if (c.vin || l.length < 2) return out;
    ['displ', 'cyl', 'asp', 'trans', 'n', 'drive'].forEach(function (k) { var seen = {}; l.forEach(function (x) { seen[x.p[k]] = 1; }); if (Object.keys(seen).length > 1) out[k] = true; });
    return { engine: out.displ || out.cyl, asp: out.asp, trans: out.trans || out.n, drive: out.drive };
  }
  var variantBusy = {};
  async function loadVariants(c) {
    var key = variantKey(c); if (!key || !call || variantBusy[key]) return;
    variantBusy[key] = true;
    try {
      var base = baseOf(c), list = [];
      var models = items(await epaGet('menu/model?year=' + encodeURIComponent(c.year) + '&make=' + encodeURIComponent(c.make))).map(function (x) { return String(x.value); })
        .filter(function (m) { return m.replace(DRV_SUFFIX, '').trim() === base; });
      for (var j = 0; j < models.length; j++) {
        items(await epaGet('menu/options?year=' + encodeURIComponent(c.year) + '&make=' + encodeURIComponent(c.make) + '&model=' + encodeURIComponent(models[j])))
          .forEach(function (x) { list.push({ id: String(x.value), text: x.text, model: models[j], p: parseOpt(x.text, models[j]) }); });
      }
      c.variants = { key: key, t: Date.now(), list: list };
      LG.info('car', 'Versions of ' + shortName(c) + ': ' + list.length);
      save();
    } catch (e) { LG.warn('car', 'Versions', String(e.message || e)); c.variants = { key: key, t: Date.now(), list: [], error: true }; }
    variantBusy[key] = false;
    if (car() === c) draw();
  }
  async function pickVariant(c, id) {
    var x = variantList(c).filter(function (v) { return v.id === id; })[0];
    verOpen = false;
    if (!x || id === c.epaId) { draw(); return; }
    try {
      var v = JSON.parse(await epaGet(encodeURIComponent(id)));
      var r = applyEpa(c, v, id, x.text, true);
      if (r.error) { A.toast && A.toast(r.error); draw(); return; }
      LG.info('car', 'Version picked: ' + x.text);
      draw(); changed();
    } catch (e) { A.toast && A.toast('Couldn\'t reach the EPA: ' + (e.message || e)); draw(); }
  }

  // ---------- about this car ----------
  var verOpen = false, featOpen = false;
  var TILE_Q = {
    power: 'What makes the car go: a <b>gas engine</b>; a <b>hybrid</b>, with a gas engine and an electric motor that share the work and charge themselves; a <b>plug-in hybrid</b>, which also charges from the wall; <b>fully electric</b>; or a <b>hydrogen fuel cell</b>, which makes electricity from hydrogen.',
    engine: 'The engine\'s size is the total space inside its cylinders, in liters. Bigger engines and more cylinders usually mean more power and more fuel used.',
    asp: 'How air gets into the engine. With <b>no turbocharger</b>, the engine breathes on its own. A <b>turbocharger</b> uses exhaust to push in extra air, so a small engine makes big-engine power; a <b>supercharger</b> does the same, driven by the engine.',
    trans: 'How the engine\'s power reaches the wheels. An <b>automatic</b> shifts gears for you. One with <b>no fixed gears</b> changes smoothly instead (a continuously variable transmission). A <b>hybrid automatic</b> blends the engine and motor (power-split). <b>Dual-clutch</b> automatics shift very quickly.',
    drive: 'Which wheels the engine turns. <b>Front-wheel drive</b> is the most efficient. <b>All-wheel</b> and <b>four-wheel drive</b> help on snow, mud and dirt but use a little more fuel. Part-time four-wheel drive should only be on for loose or slippery ground.'
  };
  function tile(key, label, value, q, dd, missing) {
    var v = value ? esc(value) : '<span class="ac-none">Not known</span>';
    return '<div class="ac-tile' + (missing ? ' miss' : '') + '"><div class="ac-k">' + esc(label) + (q ? A.qBtn(q) : '') + '</div>' +
      (missing ? missing : dd ? '<button type="button" class="ac-v ac-dd" data-ver="' + key + '" aria-label="' + esc(label) + ': pick your version">' + v + '<i aria-hidden="true">▾</i></button>' : '<div class="ac-v">' + v + '</div>') + '</div>';
  }
  function plainOpts(map, cur) { return '<option value="">Pick…</option>' + Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); }
  function tilesPanel(c) {
    var i = c.info || {}, k = kind(c), V = varies(c), list = variantList(c), en = enginePlain(c);
    if (!c.vin && variantKey(c) && (!c.variants || c.variants.key !== variantKey(c) || Date.now() - c.variants.t > 30 * 864e5)) loadVariants(c);
    var gasLike = c.power !== 'ev' && c.power !== 'h2';
    // a detail the records don't have: you can fill it in (a little menu in the tile)
    var miss = function (key, map) { return i[key] ? '' : '<select class="ac-set" data-set="' + key + '" aria-label="Set it">' + plainOpts(map, '') + '</select>'; };
    var h = '<div class="ac-tiles">' +
      tile('power', 'Powertrain', POWER_PLAIN[c.power] || '', TILE_Q.power) +
      tile('engine', k === 'ev' ? 'Motor' : k === 'h2' ? 'Fuel cell' : 'Engine', en.text, TILE_Q.engine + (en.code ? ' Engine code: <b>' + esc(en.code) + '</b>.' : ''), V.engine) +
      (gasLike ? tile('asp', 'Air intake', ASP_PLAIN[i.asp] || '', TILE_Q.asp, V.asp, miss('asp', ASP_PLAIN)) : '') +
      tile('trans', 'Transmission', transPlain(i), TILE_Q.trans, V.trans, i.trans ? '' : miss('trans', { auto: 'Automatic', manual: 'Manual', cvt: 'Automatic, no fixed gears (CVT)', ecvt: 'Hybrid automatic (eCVT)', dct: 'Dual-clutch automatic (DCT)', amt: 'Automated manual', single: 'Single speed' })) +
      tile('drive', 'Drivetrain', DRIVE_PLAIN[i.drive] || '', TILE_Q.drive, V.drive, miss('drive', DRIVE_PLAIN)) +
      '</div>';
    if (verOpen && list.length > 1 && !c.vin) {
      h += '<div class="ac-vers" id="gVers"><div class="sub-h">Which version is yours?</div><p class="lead small keep">The EPA lists ' + list.length + ' for the ' + esc(c.year + ' ' + c.make + ' ' + baseOf(c)) + '. Your owner\'s manual or window sticker says which. Adding your VIN settles it for good.</p>' +
        list.map(function (x) { return '<button type="button" data-vid="' + esc(x.id) + '" class="' + (x.id === c.epaId ? 'on' : '') + '">' + esc(variantText(x.p) || x.text) + '</button>'; }).join('') + '</div>';
    }
    h += '<div class="lead small keep ac-src">' + (c.vin ? 'From your VIN' + (c.epaId ? ' and the EPA\'s record' : '') + '.' : 'From the EPA\'s record for this model.' + (list.length > 1 ? ' Tap ▾ if yours is another version.' : '')) + '</div>';
    return h;
  }
  function customPanel(c) {
    var i = c.info || {}, k = kind(c), gasLike = k === 'gas';
    return '<div class="lead small keep">A car you built yourself: set each part.</div>' +
      '<div class="grid2"><label class="nf"><span>Powertrain</span><select id="gPower">' + opts(POWER_PLAIN, c.power || 'gas') + '</select></label>' +
      '<label class="nf wide"><span>' + (k === 'ev' ? 'Motor(s)' : k === 'h2' ? 'Fuel cell / motor' : 'Engine') + '<small>' + (k === 'ev' ? 'e.g. Dual motor, 250 kW' : k === 'h2' ? 'e.g. 128 kW fuel cell, 134 kW motor' : 'e.g. 2.0L 4-cylinder, 6.0L V8') + '</small></span><input type="text" id="gEngine" maxlength="60" value="' + esc(i.engine || '') + '"></label></div>' +
      '<div class="grid2">' + (gasLike || c.power === 'hybrid' || c.power === 'phev' ? '<label class="nf"><span>Air intake</span><select id="gAsp">' + opts(ASP_PLAIN, i.asp, '—') + '</select></label>' : '') +
      '<label class="nf"><span>Transmission</span><select id="gTrans">' + opts({ auto: 'Automatic', manual: 'Manual', cvt: 'Automatic, no fixed gears (CVT)', ecvt: 'Hybrid automatic (eCVT)', dct: 'Dual-clutch automatic (DCT)', amt: 'Automated manual', single: 'Single speed' }, i.trans, '—') + '</select></label>' +
      (/^(auto|manual|dct|amt)$/.test(i.trans || '') ? '<label class="nf"><span>Speeds</span><input type="number" inputmode="numeric" min="2" max="12" step="1" id="gTransN" value="' + esc(i.transN || '') + '"></label>' : '') +
      '<label class="nf"><span>Drivetrain</span><select id="gDrive">' + opts(DRIVE_PLAIN, i.drive, '—') + '</select></label></div>';
  }
  function featPanel(c) {
    var i = c.info || {}, on = i.features || [], fs = i.featSrc || {};
    var fl = FEATURES.filter(function (f) { return featApplies(f, c); }).sort(function (a, b) { return a.label.localeCompare(b.label); });
    var n = fl.filter(function (f) { return on.indexOf(f.key) >= 0; }).length;
    return '<details class="ac-feats" id="gFeats"' + (featOpen ? ' open' : '') + '><summary><span>Features<small>' + n + ' checked</small></span></summary>' +
      '<div class="ac-flist">' + fl.map(function (f) {
        var chk = on.indexOf(f.key) >= 0, conf = chk && (fs[f.key] === 'vin' || fs[f.key] === 'epa');
        return '<div class="ac-f"><label><input type="checkbox" data-feat="' + esc(f.key) + '"' + (chk ? ' checked' : '') + '><span>' + esc(f.label) +
          (conf ? '<small>' + (fs[f.key] === 'vin' ? 'from your VIN' : 'from the EPA') + '</small>' : '') + '</span></label>' + A.qBtn(f.q) + '</div>';
      }).join('') + '</div><div class="lead small keep">Checked ones marked "from your VIN" or "from the EPA" are confirmed. Check anything else your car has: Advisory uses this list.</div></details>';
  }
  function infoPanel(c) {
    var i = c.info || {}, k = kind(c);
    var fuel = k === 'ev' ? '' : k === 'h2' ? '' :
      '<label class="nf"><span>Gas you buy<small>' + esc(c.epa && c.epa.fuel ? 'EPA: ' + c.epa.fuel : '&nbsp;') + '</small></span><select id="gGrade">' + Object.keys(P.GRADES).map(function (g) { return '<option value="' + g + '"' + ((c.grade || 'regular') === g ? ' selected' : '') + '>' + P.GRADES[g].label + (g === 'diesel' ? '' : ' gasoline') + '</option>'; }).join('') + '</select></label>';
    var h = '';
    h += isCustom(c) ? customPanel(c) : tilesPanel(c);
    if (fuel) h += '<div class="grid2">' + fuel + '</div>';
    h += featPanel(c);
    return h;
  }
  function obsPanel(c) {
    var hw = avg(c, 'highway'), ct = avg(c, 'city'), per = units(c).per;
    var help = '<b>What your car really gets.</b> Trip plans use the City and Highway numbers here (blank = the EPA\'s; % of EPA scales both). ' +
      'Every entry in your log counts too: the ones with a speed tune how your mileage changes with speed on each road of a trip, and “Use these” sets City and Highway from your log\'s averages.';
    var h = '<div class="obs-row"><div class="grid3">' +
      '<label class="nf"><span>City ' + per + '</span><input type="number" inputmode="decimal" step="0.1" id="oCity" placeholder="' + esc(hasEpa(c) ? fmtPer(c.epa.city) : '') + '" value="' + esc(c.obs.city || '') + '"></label>' +
      '<label class="nf"><span>Highway ' + per + '</span><input type="number" inputmode="decimal" step="0.1" id="oHwy" placeholder="' + esc(hasEpa(c) ? fmtPer(c.epa.hwy) : '') + '" value="' + esc(c.obs.hwy || '') + '"></label>' +
      '<label class="nf"><span>% of EPA</span><input type="number" inputmode="decimal" step="1" id="oPct" value="' + pctOf(c) + '"' + (hasEpa(c) ? '' : ' disabled') + '></label></div>' + A.qBtn(help) + '</div>';
    if (hw || ct) h += '<div class="lead small keep">Your log averages ' + [ct ? ct.mpg.toFixed(1) + ' city (' + ct.n + ')' : '', hw ? hw.mpg.toFixed(1) + ' highway (' + hw.n + ')' : ''].filter(Boolean).join(' · ') +
      '. <a href="#" id="oUseLog">Use these</a></div>';
    // adding an entry: its own menu
    h += '<details class="log-add" id="oAdd"' + (addOpen ? ' open' : '') + '><summary>Log mileage</summary><div class="grid2">' +
      '<label class="nf"><span>' + per + '<span class="req" aria-label="required">*</span></span><input type="number" inputmode="decimal" step="0.1" id="lMpg"></label>' +
      '<label class="nf"><span>Driving</span><select id="lKind"><option value="highway">Highway</option><option value="city">City</option><option value="mixed">Mixed</option></select></label>' +
      '<label class="nf"><span>Typical speed<small>mph you held · optional · tunes the cruising-speed curve</small></span><input type="number" inputmode="numeric" step="1" id="lSpeed"></label>' +
      '<label class="nf"><span>Date</span><input type="date" id="lDate" value="' + today() + '" max="' + today() + '"></label></div>' +
      '<button class="btn tonal" id="lAdd">Add to the log</button></details>';
    // the log: a table you can sort by any column and filter
    if (!c.entries.length) return h + '<div class="lead small keep">No logged mileage yet. Log a tank or a stretch of driving above — add the speed you held to calibrate the cruising-speed card.</div>';
    var F = logView.f;
    h += '<details class="log-filt" id="oFilt"' + (logView.open ? ' open' : '') + '><summary>Filter <small id="oCount"></small></summary>' +
      '<div class="lf-row"><span>' + per + '</span><input type="number" inputmode="decimal" data-lf="mpgLo" placeholder="from" value="' + esc(F.mpgLo) + '"><i>–</i><input type="number" inputmode="decimal" data-lf="mpgHi" placeholder="to" value="' + esc(F.mpgHi) + '"></div>' +
      '<div class="lf-row"><span>mph</span><input type="number" inputmode="numeric" data-lf="mphLo" placeholder="from" value="' + esc(F.mphLo) + '"><i>–</i><input type="number" inputmode="numeric" data-lf="mphHi" placeholder="to" value="' + esc(F.mphHi) + '"></div>' +
      '<div class="lf-row"><span>Dates</span><input type="date" data-lf="dLo" value="' + esc(F.dLo) + '"><i>–</i><input type="date" data-lf="dHi" value="' + esc(F.dHi) + '"></div>' +
      '<div class="chips mini lf-kinds">' + ['city', 'highway', 'mixed'].map(function (k) { return '<button type="button" data-lk="' + k + '" class="' + (F.kinds[k] === false ? '' : 'on') + '">' + KIND_NAME[k] + '</button>'; }).join('') +
      '<button type="button" class="lf-clear" id="oFiltClear">Clear</button></div></details>';
    return h + '<div class="log-list" id="oLog">' + logTable(c) + '</div>';
  }
  var KIND_NAME = { city: 'City', highway: 'Highway', mixed: 'Mixed' };
  var addOpen = false;
  var logView = { sort: 'date', dir: -1, open: false, f: { mpgLo: '', mpgHi: '', mphLo: '', mphHi: '', dLo: '', dHi: '', kinds: {} } };
  function logRows(c) {
    var F = logView.f, n = function (v) { return v === '' || v == null ? null : +v; };
    var rows = c.entries.filter(function (e) {
      var m = +e.mpg, sp = e.speed ? +e.speed : null;
      if (n(F.mpgLo) != null && m < n(F.mpgLo)) return false;
      if (n(F.mpgHi) != null && m > n(F.mpgHi)) return false;
      if (n(F.mphLo) != null && !(sp != null && sp >= n(F.mphLo))) return false;
      if (n(F.mphHi) != null && !(sp != null && sp <= n(F.mphHi))) return false;
      if (F.dLo && String(e.date) < F.dLo) return false;
      if (F.dHi && String(e.date) > F.dHi) return false;
      return F.kinds[e.kind] !== false;
    });
    var key = logView.sort, dir = logView.dir;
    var val = function (e) { return key === 'mpg' ? +e.mpg : key === 'speed' ? (e.speed ? +e.speed : -1) : key === 'kind' ? String(e.kind) : String(e.date) + e.id; };
    return rows.sort(function (a, b) { var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }
  function logTable(c) {
    var rows = logRows(c), per = units(c).per;
    var th = function (k, label) { return '<th><button type="button" data-sort="' + k + '" class="' + (logView.sort === k ? 'on' : '') + '">' + label + (logView.sort === k ? (logView.dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>'; };
    var h = '<table class="log-tbl"><thead><tr>' + th('date', 'Date') + th('mpg', per) + th('kind', 'Driving') + th('speed', 'mph') + '<th></th></tr></thead><tbody>';
    h += rows.map(function (e) {
      return '<tr class="log-row"><td>' + esc(fmtShort(e.date)) + '</td><td><b>' + (+e.mpg).toFixed(1) + '</b></td><td>' + esc(KIND_NAME[e.kind] || e.kind) + '</td><td>' + (e.speed ? e.speed : '—') + '</td>' +
        '<td><button class="x sm" data-del="' + esc(e.id) + '" aria-label="Delete entry">✕</button></td></tr>';
    }).join('');
    if (!rows.length) h += '<tr><td colspan="5" class="lf-none">No entries match the filter.</td></tr>';
    return h + '</tbody></table>';
  }
  function fmtShort(d) { try { var p = String(d).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }); } catch (e) { return d; } }
  /** Sorting, filtering and deleting in the log (the table alone is redrawn, so the filter boxes keep your typing). */
  function bindLog(c) {
    var box = $('oLog'); if (!box) return;
    var redo = function () { box.innerHTML = logTable(c); count(); };
    var count = function () { var el = $('oCount'), n = logRows(c).length; if (el) el.textContent = n === c.entries.length ? '· ' + n + ' entr' + (n === 1 ? 'y' : 'ies') : '· ' + n + ' of ' + c.entries.length; };
    count();
    box.onclick = function (ev) {
      var s = ev.target.closest('[data-sort]');
      if (s) { var k = s.dataset.sort; if (logView.sort === k) logView.dir = -logView.dir; else { logView.sort = k; logView.dir = k === 'kind' ? 1 : -1; } redo(); return; }
      var b = ev.target.closest('[data-del]'); if (!b) return;
      var e0 = c.entries.filter(function (e) { return e.id === b.dataset.del; })[0]; if (!e0) return;
      ask({ title: 'Delete this mileage entry?', body: esc((+e0.mpg).toFixed(1) + ' ' + units(c).per + ', ' + e0.kind + ' · ' + fmtDate(e0.date)), action: 'Delete' }).then(function (ok) {
        if (!ok) return; c.entries = c.entries.filter(function (e) { return e !== e0; }); draw(); changed();
      });
    };
    host.querySelectorAll('[data-lf]').forEach(function (i) { i.oninput = function () { logView.f[i.dataset.lf] = i.value; redo(); }; });
    host.querySelectorAll('[data-lk]').forEach(function (b) { b.onclick = function () { var k = b.dataset.lk; logView.f.kinds[k] = logView.f.kinds[k] === false; b.classList.toggle('on', logView.f.kinds[k] !== false); redo(); }; });
    if ($('oFiltClear')) $('oFiltClear').onclick = function () { logView.f = { mpgLo: '', mpgHi: '', mphLo: '', mphHi: '', dLo: '', dHi: '', kinds: {} }; draw(); };
    if ($('oFilt')) $('oFilt').addEventListener('toggle', function () { logView.open = $('oFilt').open; });
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fmtDate(d) { try { var p = String(d).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return d; } }
  function avg(c, kind) {
    var es = c.entries.filter(function (e) { return e.kind === kind && +e.mpg > 0; });
    if (!es.length) return null;
    return { mpg: es.reduce(function (a, e) { return a + +e.mpg; }, 0) / es.length, n: es.length };
  }
  function ask(o) { return A.confirmDel ? A.confirmDel(o) : Promise.resolve(true); }
  function removeCar(c) {
    return ask({ title: 'Remove ' + shortName(c) + '?', body: 'Its mileage log and details go with it.', action: 'Remove' }).then(function (ok) {
      if (!ok) return;
      S.cars = S.cars.filter(function (x) { return x !== c; });
      if (!S.cars.some(function (x) { return x.id === S.carId; })) { S.carId = S.cars[0].id; editing = false; }
      LG.info('car', 'Removed ' + shortName(c));
      draw(); changed();
    });
  }

  function bind(c) {
    bindCarousel(c);
    if (editing) bindPaints(c);
    host.querySelectorAll('[data-car]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.car === '+') {
          var nc = { id: 'c' + Date.now(), name: '', trim: '', type: 'car', power: 'gas', grade: '', tank: '', tankSrc: '', obs: {}, entries: [], epa: null, info: {} };
          S.cars.push(nc); S.carId = nc.id; editing = true;
        } else { S.carId = b.dataset.car; editing = false; }
        LG.info('car', 'Selected ' + shortName(car()));
        draw(); changed();
      };
    });
    host.querySelectorAll('[data-rmcar]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); var x = S.cars.filter(function (y) { return y.id === b.dataset.rmcar; })[0]; if (x) removeCar(x); };
    });
    $('gEdit').onclick = function () { editing = !editing; draw(); };
    if (editing) {
      if ($('gVinGo')) {
        $('gVinGo').onclick = function () { lookupVin(c, $('gVin').value); };
        $('gVinEye').onclick = function () {
          vinShown = !vinShown; $('gVin').classList.toggle('masked', !vinShown);
          this.innerHTML = vinShown ? EYE_OFF : EYE; this.setAttribute('aria-label', (vinShown ? 'Hide' : 'Show') + ' the VIN'); this.setAttribute('aria-pressed', String(vinShown));
        };
        $('gVin').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); lookupVin(c, this.value); } };
      }
      if ($('gName')) $('gName').onchange = function () { c.name = this.value.trim(); draw(); save(); };
      $('gTrim').onchange = function () { c.trim = this.value.trim(); draw(); changed(); };
      $('gTank').onchange = function () { var v = parseFloat(this.value); c.tank = v > 0 ? r2(v) : ''; c.tankSrc = v > 0 ? 'you entered it' : ''; changed(); draw(); };
      if ($('gTankFind')) $('gTankFind').onclick = function () { if (c.tankSrc === 'you entered it') c.tankSrc = ''; tankFind(c, false); };
      if ($('gTankShow')) $('gTankShow').onclick = function (e) { e.preventDefault(); tankFind(c, true); };
      if ($('gType')) $('gType').onchange = function () { c.type = this.value; changed(); draw(); };
      if ($('gDcKw')) $('gDcKw').onchange = function () { var v = parseFloat(this.value); c.dcKw = v > 0 ? Math.round(v) : ''; changed(); };
      if ($('gPlug')) $('gPlug').onchange = function () { c.plug = this.value; changed(); draw(); };
      if ($('gAdapter')) $('gAdapter').onchange = function () { c.adapter = this.checked; changed(); };
      $('tEpa').addEventListener('toggle', function () { if ($('tEpa').open && !matching && $('eYear').options.length < 2) { if (hasEpa(c) && c.year) epaPreset(c); else epaYears(c); } });
      if ($('tEpa').open && !matching) { if (hasEpa(c) && c.year) epaPreset(c); else epaYears(c); }   // (a VIN match fills them itself)
      if ($('gRemove')) $('gRemove').onclick = function () { removeCar(c); };
    }
    // about this car
    var info = c.info = c.info || {};
    var setI = function (id, k2, num) { var el = $(id); if (el) el.onchange = function () { var v = this.value.trim(); info[k2] = num ? (parseInt(v, 10) || '') : v; save(); if (id === 'gTrans') draw(); else updInfoLine(c); }; };
    setI('gEngine', 'engine'); setI('gAsp', 'asp'); setI('gTrans', 'trans'); setI('gTransN', 'transN', true); setI('gDrive', 'drive'); 
    if ($('gGrade')) $('gGrade').onchange = function () { c.grade = this.value; changed(); };
    if ($('gPower')) $('gPower').onchange = function () {
      var was = kind(c); c.power = this.value;
      if (kind(c) !== was) {    // different units: the old tank size and mileage don't mean anything now
        LG.info('car', 'Powertrain ' + POWER[c.power]);
        c.tank = ''; c.tankSrc = ''; c.obs = {};
        if (kind(c) === 'gas' && /electric|hydrogen/i.test(c.epa && c.epa.fuel || '')) c.epa = null;
        if (kind(c) !== 'gas' && !/electric|hydrogen/i.test(c.epa && c.epa.fuel || '')) c.epa = null;
        editing = true;
      }
      if (c.power === 'hybrid' && c.type !== 'hybrid') c.type = 'hybrid';
      draw(); changed();
    };
    // a part you set yourself (custom car, or a detail the records don't have)
    var markUser = function (k2) { info.src = Object.assign({}, info.src); info.src[k2] = 'user'; };
    ['gEngine', 'gAsp', 'gTrans', 'gDrive'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('change', function () { markUser({ gEngine: 'engine', gAsp: 'asp', gTrans: 'trans', gDrive: 'drive' }[id]); }); });
    host.querySelectorAll('[data-set]').forEach(function (sel) {
      sel.onchange = function () { if (!this.value) return; info[this.dataset.set] = this.value; markUser(this.dataset.set); save(); draw(); };
    });
    // versions: the ▾ on a tile opens the list; picking one loads it from the EPA
    host.querySelectorAll('[data-ver]').forEach(function (b) { b.onclick = function () { verOpen = !verOpen; draw(); if (verOpen && $('gVers')) $('gVers').scrollIntoView({ block: 'nearest' }); }; });
    host.querySelectorAll('[data-vid]').forEach(function (b) { b.onclick = function () { pickVariant(c, b.dataset.vid); }; });
    // features: a checklist; confirmed ones (from the VIN or the EPA) ask before they're unchecked; one camshaft layout only
    if ($('gFeats')) $('gFeats').addEventListener('toggle', function () { featOpen = this.open; });
    host.querySelectorAll('[data-feat]').forEach(function (cb) {
      cb.onchange = function () {
        var f = cb.dataset.feat, fs = info.featSrc = Object.assign({}, info.featSrc), l = (info.features || []).slice(), def = FEATURES.filter(function (o) { return o.key === f; })[0] || {};
        var done = function () { info.features = l; save(); draw(); try { window.dispatchEvent(new Event('garagechange')); } catch (e) { } };
        if (cb.checked) {
          var rivals = def.one ? l.filter(function (x) { var o = FEATURES.filter(function (y) { return y.key === x; })[0]; return o && o.one === def.one && x !== f; }) : [];
          var add = function () {
            l = l.filter(function (x) { if (rivals.indexOf(x) >= 0) { delete fs[x]; return false; } return true; });
            if (l.indexOf(f) < 0) l.push(f); fs[f] = 'user'; done();
          };
          var sure = rivals.filter(function (x) { return fs[x] === 'vin' || fs[x] === 'epa'; })[0];
          if (!sure) { add(); return; }
          cb.checked = false;     // a car has only one of these, and the records say it's the other
          var sd = FEATURES.filter(function (o) { return o.key === sure; })[0] || {};
          A.confirmDel({ always: true, title: 'Switch to “' + (def.label || f) + '”?', body: 'Your car\'s ' + (fs[sure] === 'vin' ? 'VIN record' : 'EPA record') + ' says it has “' + esc(sd.label || sure) + '”, and a car has only one of these.', action: 'Switch' })
            .then(function (ok) { if (ok) add(); });
          return;
        }
        var drop = function () { l = l.filter(function (x) { return x !== f; }); delete fs[f]; done(); };
        if (fs[f] === 'vin' || fs[f] === 'epa') {
          cb.checked = true;
          A.confirmDel({ always: true, title: 'Uncheck “' + (def.label || f) + '”?', body: 'Your car\'s ' + (fs[f] === 'vin' ? 'VIN record' : 'EPA record') + ' says it has this. Uncheck it only if you\'re sure yours doesn\'t.', action: 'Uncheck' })
            .then(function (ok) { if (ok) drop(); });
        } else drop();
      };
    });
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
    bindLog(c);
    if ($('oAdd')) $('oAdd').addEventListener('toggle', function () { addOpen = $('oAdd').open; });
    $('lAdd').onclick = function () {
      var mpg = parseFloat($('lMpg').value), sp = parseFloat($('lSpeed').value);
      if (!(mpg > 0 && mpg < 250)) { $('lMpg').focus(); return; }
      var d = $('lDate') && /^\d{4}-\d{2}-\d{2}$/.test($('lDate').value) && $('lDate').value <= today() ? $('lDate').value : today();
      var e = { id: 'e' + Date.now(), date: d, mpg: r1(mpg), kind: $('lKind').value };
      if (sp >= 5 && sp <= 120) e.speed = Math.round(sp);
      c.entries.push(e);
      LG.info('car', 'Logged mileage', e);
      draw(); changed();
    };
  }
  function updInfoLine(c) { var s = host && host.querySelector('#gInfo summary small'); if (s) s.textContent = infoLine(c); }
  var soonT;
  function changedSoon() { clearTimeout(soonT); soonT = setTimeout(changed, 300); }

  // ---------- EPA lookup ----------
  function items(body) { try { var j = JSON.parse(body); var m = j && j.menuItem; return !m ? [] : Array.isArray(m) ? m : [m]; } catch (e) { return []; } }
  async function epaGet(path) { var r = await call('fetchJson', EPA + path); if (r.error) throw new Error(r.error); return r.body; }
  function fill(sel, list, ph) {
    sel.innerHTML = '<option value="">' + ph + '</option>' + list.map(function (x) { return '<option value="' + esc(x.value) + '">' + esc(x.text) + '</option>'; }).join('');
    sel.disabled = !list.length;
  }
  var lastEMsg = null;   // kept across redraws (e.g. when the model's versions arrive), for the same car
  function eMsg(m, err) { lastEMsg = { car: S.carId, m: m || '', err: !!err }; var el = $('eMsg'); if (el) { el.textContent = m || ''; el.classList.toggle('err', !!err); } }
  function restoreEMsg() { var el = $('eMsg'); if (el && lastEMsg && lastEMsg.car === S.carId && lastEMsg.m && !el.textContent) { el.textContent = lastEMsg.m; el.classList.toggle('err', lastEMsg.err); } }
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
        if (opts.length === 1 && !presetting) { $('eOpt').value = opts[0].value; await $('eOpt').onchange(); }
      };
      $('eOpt').onchange = async function () {
        var id = $('eOpt').value; if (!id) return;
        eMsg('Loading…');
        var v = JSON.parse(await epaGet(encodeURIComponent(id)));
        var opt = $('eOpt').selectedOptions[0] ? $('eOpt').selectedOptions[0].text : '';
        var r = applyEpa(c, v, id, opt);
        if (r.error) { eMsg(r.error, true); return; }
        editing = true; epaOpen = true; draw(); epaOpen = false; changed();
        eMsg(r.msg);
      };
    } catch (e) { eMsg('Couldn\'t reach fueleconomy.gov: ' + e.message + '.', true); }
  }
  /** Show the car you have in the year / make / model pickers (after a VIN lookup, or opening them later). */
  var presetting = false, presetAgain = false;
  async function epaPreset(c) {
    if (presetting) { presetAgain = true; return; }   // a redraw replaced the pickers mid-way: fill the new ones after
    presetting = true;
    try {
      await epaYears(c);
      var set = async function (id, want) {
        var el = $(id); if (!el) return false;
        var o = Array.prototype.filter.call(el.options, function (x) { return x.value && (x.value === String(want) || x.text.toLowerCase() === String(want).toLowerCase()); })[0];
        if (!o) return false; el.value = o.value;
        if (id !== 'eOpt' && el.onchange) await el.onchange.call(el);   // the last one only shows your pick: re-applying it would redraw and start over
        return true;
      };
      if (await set('eYear', c.year) && await set('eMake', c.make) && await set('eModel', c.model)) await set('eOpt', c.epaId);
    } catch (e) { } finally { presetting = false; if (presetAgain) { presetAgain = false; if ($('tEpa') && $('tEpa').open) epaPreset(c); } }
  }
  /** Take a fueleconomy.gov vehicle record: mileage (or efficiency), powertrain, and any details you haven't filled in. */
  function applyEpa(c, v, id, opt, force) {
    var atv = String(v.atvType || ''), fuel = String(v.fuelType1 || v.fuelType || '');
    var ev = /^EV$/i.test(atv) || /^electricity$/i.test(fuel), fc = /FCV/i.test(atv) || /hydrogen/i.test(fuel);
    var city = +v.city08, hwy = +v.highway08, comb = +v.comb08;
    if (!(city > 0 && hwy > 0)) return { error: 'The EPA has no mileage numbers for that one.' };
    var wasKind = kind(c), wasCar = [c.year, String(c.make || '').toLowerCase(), baseOf(c).toLowerCase()].join('|');
    c.power = ev ? 'ev' : fc ? 'h2' : /plug-in/i.test(atv) ? 'phev' : /hybrid/i.test(atv) || /HEV/.test(String(v.eng_dscr || '')) ? 'hybrid' : 'gas';
    c.year = +v.year; c.make = v.make; c.model = v.model; c.epaId = String(v.id || id); if (v.baseModel) c.epaBase = String(v.baseModel);
    c.name = [v.year, v.make, v.model].join(' ') + (opt ? ' · ' + opt : '');
    if (ev) {
      // MPGe -> miles per kWh (33.705 kWh = 1 gallon-equivalent)
      var mk = function (x) { return r2(x / 33.705); };
      c.epa = { city: mk(city), hwy: mk(hwy), comb: mk(comb || harm(city, hwy)), fuel: 'Electricity', range: +v.range || 0,
        kwh: { city: Math.round(+v.cityE || 3370.5 / city), hwy: Math.round(+v.highwayE || 3370.5 / hwy), comb: Math.round(+v.combE || 3370.5 / (comb || harm(city, hwy))) } };
      if (!c.plug) c.plug = /tesla/i.test(v.make) ? 'NACS' : 'CCS';
    } else {
      c.epa = { city: city, hwy: hwy, comb: comb || Math.round(harm(city, hwy)), fuel: fuel, range: +v.range || 0 };
      if (!fc) c.grade = /premium/i.test(fuel) ? 'premium' : /midgrade/i.test(fuel) ? 'midgrade' : /diesel/i.test(fuel) ? 'diesel' : 'regular';
    }
    c.typeAuto = SP.typeFromEpa(v); c.type = c.typeAuto;
    var t = tankFor(c), msg;
    if (t) { c.tank = t.gal; c.tankSrc = t.src; }
    else if (ev && c.epa.range && c.epa.kwh.comb) { c.tank = Math.round(c.epa.range * c.epa.kwh.comb / 100); c.tankSrc = 'estimated from the EPA range × kWh per 100 mi (counts charging losses, like the trip plans do)'; }
    // a different car (or powertrain) needs its own tank size; the same car keeps the one it has
    else if (kind(c) !== wasKind || (c.tankSrc !== 'you entered it' && [c.year, String(c.make || '').toLowerCase(), baseOf(c).toLowerCase()].join('|') !== wasCar)) { c.tank = ''; c.tankSrc = ''; }
    // details: what's still blank (a VIN's answers win), or everything when you picked this version
    var i = c.info = c.info || {}, src = i.src = Object.assign({}, i.src), fsrc = i.featSrc = Object.assign({}, i.featSrc);
    var mine = function (k) { return force ? src[k] !== 'vin' : !i[k]; };
    if (force) ['engine', 'asp', 'trans', 'transN', 'drive'].forEach(function (k) { if (src[k] !== 'vin') i[k] = ''; });
    if (force) i.features = (i.features || []).filter(function (x) { if (fsrc[x] === 'epa') { delete fsrc[x]; return false; } return true; });
    var was = { engine: i.engine, asp: i.asp, trans: i.trans, drive: i.drive };
    if (!i.engine) i.engine = ev ? String(v.evMotor || '') : +v.displ > 0 ? (+v.displ).toFixed(1) + 'L ' + (+v.cylinders ? v.cylinders + ' Cyl' : '') + (fc ? '' : '') : fc ? String(v.evMotor || 'Fuel cell') : '';
    if (!i.asp && !ev && !fc) i.asp = v.tCharger === 'T' || /turbo/i.test(String(v.eng_dscr || '')) ? 'turbo' : v.sCharger === 'S' ? 'super' : 'na';
    var tr = String(v.trany || '');
    if (!i.trans) { i.trans = ev || fc ? 'single' : /variable gear|CVT|AV/i.test(tr) ? (c.power === 'hybrid' ? 'ecvt' : 'cvt') : /AM-?S?\d|AM\d/i.test(tr) ? 'dct' : /manual/i.test(tr) ? 'manual' : /auto/i.test(tr) ? 'auto' : ''; var sp = tr.match(/(\d+)/); if (sp && /^(auto|manual|dct)$/.test(i.trans)) i.transN = +sp[1]; }
    var dr = String(v.drive || '');
    if (!i.drive) i.drive = /front/i.test(dr) ? 'fwd' : /rear/i.test(dr) ? 'rwd' : /part-time/i.test(dr) ? '4wd' : /4-wheel|4wd/i.test(dr) ? '4wdf' : /all-wheel|awd/i.test(dr) ? 'awd' : '';
    ['engine', 'asp', 'trans', 'drive'].forEach(function (k) { if (i[k] && i[k] !== was[k]) src[k] = 'epa'; });
    var f = i.features = (i.features || []).slice(), add = function (x) { if (f.indexOf(x) < 0) { f.push(x); fsrc[x] = 'epa'; } else if (!fsrc[x] || fsrc[x] === 'user') fsrc[x] = 'epa'; }, ed = String(v.eng_dscr || '');
    if (/SIDI|GDI|DI\b/.test(ed)) add('Direct injection');
    if (/CYL DEACT|DEACT|MDS|AFM/i.test(ed)) add('Cylinder deactivation');
    if (v.startStop === 'Y') add('Start-stop');
    if (ev || fc || /hybrid/i.test(c.power)) add('Regenerative braking');
    if (ev) msg = 'Set from the EPA. ' + (c.tank ? 'Battery set to ' + c.tank + ' kWh so the EPA range works out — the usable pack is smaller, but the EPA\'s kWh include charging losses, so this matches what you\'ll pay for at a charger.' : 'Enter the usable battery size.') + ' Set the charge port and DC speed above.';
    else if (fc) msg = 'Set from the EPA (mi per kg of hydrogen). ' + (t ? 'Tank: ' + t.gal + ' kg (' + t.src + ').' : 'Enter the hydrogen tank size (kg).');
    else msg = t ? 'Set from the EPA; tank size from ' + t.src + '.' : 'Set from the EPA. The EPA doesn\'t publish tank sizes, so Gasket asks Brave Search; you can always type it from your owner\'s manual.';
    LG.info('car', 'EPA lookup', { id: c.epaId, name: c.name, epa: c.epa, power: c.power, type: c.type, tank: c.tank });
    return { msg: msg };
  }

  // ---------- VIN (NHTSA vPIC), then the EPA ----------
  function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|[\s\-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function vMsg(m, err) { var el = $('vMsg'); if (el) { el.innerHTML = m || ''; el.classList.toggle('err', !!err); } }
  /** -> what the VIN says, in this app's terms (pure: tests feed it vPIC's answer). */
  function fromVpic(R) {
    var g = function (k) { var v = R[k]; return v == null || v === 'Not Applicable' ? '' : String(v).trim(); };
    var el = g('ElectrificationLevel'), fuel = g('FuelTypePrimary') + ' ' + g('FuelTypeSecondary');
    var power = /FCEV|fuel cell/i.test(el) || /hydrogen/i.test(g('FuelTypePrimary')) ? 'h2' : /BEV/i.test(el) || /^electric/i.test(g('FuelTypePrimary')) ? 'ev' : /PHEV|plug-in/i.test(el) ? 'phev' : /HEV|hybrid/i.test(el) ? 'hybrid' : 'gas';
    var d = parseFloat(g('DisplacementL')), cyl = g('EngineCylinders'), cfg = g('EngineConfiguration');
    var lay = /in-line/i.test(cfg) ? 'Inline ' + cyl + ' Cyl' : /v-shaped/i.test(cfg) ? 'V' + cyl : /opposed/i.test(cfg) ? 'Flat ' + cyl : cyl ? cyl + ' Cyl' : '';
    var engine = power === 'ev' ? [g('EVDriveUnit'), g('EngineKW') ? g('EngineKW') + ' kW' : ''].filter(Boolean).join(', ') || 'Electric motor'
      : d > 0 ? (d.toFixed(1) + 'L ' + lay).trim() + (g('EngineModel') ? ' (' + g('EngineModel').split(',')[0] + ')' : '') : '';
    var oth = g('OtherEngineInfo') + ' ' + g('FuelInjectionType') + ' ' + g('ValveTrainDesign');
    var asp = power === 'ev' || power === 'h2' ? '' : /yes/i.test(g('Turbo')) ? (/twin/i.test(oth) ? 'twinturbo' : 'turbo') : /supercharg/i.test(oth) ? 'super' : engine ? 'na' : '';
    var ts = g('TransmissionStyle'), trans = /CVT|continuously/i.test(ts) ? (power === 'hybrid' ? 'ecvt' : 'cvt') : /dual-clutch|DCT/i.test(ts) ? 'dct' : /automated manual/i.test(ts) ? 'amt' : /manual/i.test(ts) ? 'manual' : /auto/i.test(ts) ? 'auto' : power === 'ev' || power === 'h2' ? 'single' : '';
    var dt = g('DriveType'), drive = /4WD|4-wheel|4x4/i.test(dt) ? '4wd' : /AWD|all-wheel/i.test(dt) ? 'awd' : /FWD|front/i.test(dt) ? 'fwd' : /RWD|rear/i.test(dt) ? 'rwd' : '';
    var feats = [];
    if (/DOHC|dual overhead/i.test(oth)) feats.push('DOHC'); else if (/SOHC|single overhead/i.test(oth)) feats.push('SOHC');
    if (/direct/i.test(oth)) feats.push('Direct injection');
    if (/\bport\b|multipoint|MPFI|sequential/i.test(oth)) feats.push('Port injection');
    if (/VVT|variable valve/i.test(oth)) feats.push('Variable valve timing');
    if (power !== 'gas') feats.push('Regenerative braking');
    var trim = g('Trim'); if (/\//.test(trim)) trim = '';     // "Two Eco/Three/Four": the VIN doesn't say which
    // dual rear wheels: the VIN's wheel count, or "DRW" in its names; a weight class of 1–2 or a passenger body rules it out
    var wheels = parseInt(g('Wheels'), 10) || 0, cls = /Class\s*(\d)/i.exec(g('GVWR')), names = [g('Series'), g('Series2'), g('Trim'), g('Trim2'), g('Model')].join(' ');
    var drw = wheels >= 6 || /\bDRW\b|dual rear/i.test(names) ? 'yes' : (cls && +cls[1] <= 2) || /sedan|coupe|hatchback|wagon|convertible|sport utility|minivan|crossover/i.test(g('BodyClass')) ? 'no' : '';
    return { year: parseInt(g('ModelYear'), 10) || 0, make: titleCase(g('Make')), model: g('Model'), trim: trim, trimHint: g('Trim'), series: g('Series'),
      power: power, diesel: /diesel/i.test(fuel), battery: parseFloat(g('BatteryKWh')) || 0,
      info: { engine: engine, asp: asp, trans: trans, transN: parseInt(g('TransmissionSpeeds'), 10) || '', drive: drive, features: feats, drw: drw },
      warn: g('ErrorCode') && !/^0/.test(g('ErrorCode')) ? g('ErrorText') : '' };
  }
  async function lookupVin(c, raw) {
    var vin = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) { vMsg('A VIN is 17 letters and numbers (never I, O or Q).', true); return; }
    vMsg('Decoding…');
    try {
      var r = await call('fetchJson', VPIC + 'DecodeVinValuesExtended/' + vin + '?format=json');
      if (r.error) throw new Error(r.error);
      var R = (JSON.parse(r.body).Results || [])[0] || {};
      var d = fromVpic(R);
      if (!d.year || !d.make || !d.model) { vMsg('NHTSA couldn\'t decode that VIN' + (R.ErrorText ? ': ' + esc(R.ErrorText) : '.'), true); return; }
      c.vin = vin; c.year = d.year; c.make = d.make; c.model = d.model; c.vpicModel = d.model;
      if (d.trim) c.trim = d.trim;
      c.power = d.power; if (d.diesel) c.grade = 'diesel';
      if (c.power === 'hybrid') c.type = 'hybrid';
      var i = c.info = c.info || {}, src = i.src = Object.assign({}, i.src), fsrc = i.featSrc = Object.assign({}, i.featSrc);
      Object.keys(d.info).forEach(function (k) {      // what the VIN says is what the car is
        if (k === 'features') {
          var f = i.features = (i.features || []).slice();
          d.info.features.forEach(function (x) {
            var g = FEATURES.filter(function (o) { return o.key === x && o.one; })[0];   // one camshaft layout only
            if (g) f = i.features = f.filter(function (y) { return y === x || !FEATURES.some(function (o) { return o.key === y && o.one === g.one; }); });
            if (f.indexOf(x) < 0) f.push(x); fsrc[x] = 'vin';
          });
        } else if (d.info[k]) { i[k] = d.info[k]; src[k] = 'vin'; }
      });
      if (d.power === 'ev' && d.battery > 0 && !(+c.tank > 0)) { c.tank = Math.round(d.battery * 0.92); c.tankSrc = 'VIN: ' + d.battery + ' kWh pack, ~92% usable'; }
      c.recalls = null;
      c.name = [c.year, c.make, c.model].join(' ');
      LG.info('car', 'VIN decoded', { year: c.year, make: c.make, model: c.model, power: c.power });
      changed();
      var note = d.warn && /check digit/i.test(d.warn) ? ' <b>Note:</b> the VIN\'s check digit doesn\'t add up — double-check you typed it right.' : '';
      var hint = !d.trim && d.trimHint ? ' The VIN can\'t tell which trim (' + esc(d.trimHint) + ') — add yours below if you like.' : '';
      // now the EPA's mileage for it: same year, make and model, then the engine / transmission
      editing = true; epaOpen = true; draw(); epaOpen = false;
      eMsg('');
      await epaMatch(c, 'Decoded: ' + c.year + ' ' + c.make + ' ' + c.model + '.' + hint + note);
    } catch (e) { vMsg('Couldn\'t reach NHTSA: ' + esc(e.message) + '.', true); }
  }
  /** Fill the EPA pickers for this year / make / model and pick what's certain; the rest is your pick. */
  var matching = false, drawLater = false;   // a VIN match is filling the pickers: a redraw mustn't replace them under it
  async function epaMatch(c, lead) {
    matching = true;
    try { await epaMatch0(c, lead); } finally { matching = false; if (drawLater) { drawLater = false; draw(); } }
  }
  async function epaMatch0(c, lead) {
    var say = function (m) { var el = $('eMsg'); if (el) { el.innerHTML = m; el.classList.remove('err'); } };
    say(esc(lead).replace(/&lt;b&gt;|&lt;\/b&gt;/g, '') + ' Matching the EPA\'s mileage…');
    try {
      await epaYears(c);
      var pick = function (sel, test) { var o = Array.prototype.filter.call(sel.options, function (x) { return x.value && test(x.text.toLowerCase(), x.value); }); return o; };
      var y = $('eYear'); if (!pick(y, function (t) { return t === String(c.year); }).length) { say(esc(lead) + ' The EPA has no ' + c.year + ' cars listed — enter your own mileage under Observed.'); return; }
      y.value = String(c.year); await y.onchange.call(y);
      var mk = $('eMake'), mm = pick(mk, function (t) { return t === String(c.make).toLowerCase(); });
      if (!mm.length) { say(esc(lead) + ' Pick the make and model below for its mileage.'); return; }
      mk.value = mm[0].value; await mk.onchange.call(mk);
      var md = $('eModel'), base = String(c.vpicModel || c.model).toLowerCase(), I = c.info || {};
      // the EPA splits a model by drive ("Charger" is two-wheel drive, "Charger AWD" all-wheel): use what the VIN says
      var starts = pick(md, function (t) { return t.indexOf(base) === 0; });
      var same = starts.filter(function (o) { return o.text.replace(DRV_SUFFIX, '').trim().toLowerCase() === base; });   // not "Corolla Cross" for "Corolla"
      var cands = same.length ? same : starts, wantAll = I.drive === 'awd' || I.drive === '4wd';
      if (I.drive && cands.length > 1) {
        var byDrive = cands.filter(function (o) { var sfx = DRV_SUFFIX.exec(o.text); return sfx ? /awd|4wd|4x4/i.test(sfx[1]) === wantAll : !wantAll; });
        if (byDrive.length) cands = byDrive;
      }
      var m = cands.length === 1 ? cands[0] : null;
      if (!m) { say(esc(lead) + ' Pick the model below' + (starts.length ? ' (' + starts.length + ' versions of the ' + esc(c.model) + ')' : '') + ' for its mileage.'); return; }
      md.value = m.value; await md.onchange.call(md);
      if (hasEpa(c) && c.epaId && $('eOpt') && $('eOpt').value) return;
      // more than one engine / transmission: the one with the VIN's engine size, cylinders (and gears, when it says)
      var eo = $('eOpt'), em = /([\d.]+)\s*L\b/.exec(I.engine || ''), cm = /\bV(\d+)|(\d+)\s*Cyl|Flat (\d+)|W(\d+)/i.exec(I.engine || '');
      var displ = em ? +em[1] : 0, cyl = cm ? +(cm[1] || cm[2] || cm[3] || cm[4]) : 0;
      var fit = eo ? Array.prototype.filter.call(eo.options, function (o) {
        if (!o.value) return false;
        var p = parseOpt(o.text, m.value);
        return (!displ || Math.abs(+p.displ - displ) < 0.05) && (!cyl || +p.cyl === cyl) && (!I.transN || !p.n || p.n === +I.transN);
      }) : [];
      if (fit.length === 1 && (displ || cyl)) { eo.value = fit[0].value; await eo.onchange.call(eo); return; }
      say(esc(lead) + ' Pick the engine / transmission below for its mileage' + (fit.length > 1 ? ' (' + fit.length + ' match your VIN\'s ' + esc(I.engine.replace(/\s*\(.*\)/, '')) + ')' : '') + '.');
    } catch (e) { say(esc(lead) + ' Couldn\'t reach fueleconomy.gov — pick the car below or enter your own mileage.'); }
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
    var c = car(); if (!hasEpa(c) || kind(c) !== 'gas') return null;
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
  var spdOpen = false, setOpen = false;
  function bindSpdOpen() { var d = speedHost.querySelector('details.spd-card'); if (d) d.addEventListener('toggle', function () { spdOpen = this.open; }); }
  function drawSpeed0() {
    settle(speedHost);
    var m = speedModel(), c = car();
    // 'toggle' fires a task later, so a redraw right after a tap would read a stale flag: take what's on screen
    var curCard = speedHost.querySelector('details.spd-card'), curSet = speedHost.querySelector('.spd-set');
    if (curCard) spdOpen = curCard.open;
    if (curSet) setOpen = curSet.open;
    var wasOpen = spdOpen;
    var h = '<details class="spd-card"' + (wasOpen ? ' open' : '') + '><summary><span class="h3">Best cruising speed</span>' +
      (m ? '<b class="spd-pill">' + m.rec.speed + ' mph</b>' : '') + '</summary>';
    if (!m) {
      speedHost.innerHTML = h + '<div class="lead small keep">' + (kind(c) === 'gas' ? 'Look your car up from the EPA (Edit) to see this.' :
        'Not worked out for ' + (kind(c) === 'ev' ? 'EVs' : 'fuel-cell cars') + ' yet. Air drag grows with the square of speed and these cars waste little else, so slowing down saves an even bigger share of their energy than on a gas car.') + '</div></details>';
      bindSpdOpen(); return;
    }
    var r = m.rec, row = r.rows[r.speed - m.min], f = mpgFn(c, m.cal), bal = SP.balanced(f, m.min, m.max);
    h += '<div class="spd-top"><div class="spd-big">' + r.speed + '<span>mph</span></div><div class="spd-sub">~' + row.mpg.toFixed(0) + ' mpg · ' + row.galPer100.toFixed(2) + ' gal/100 mi ' +
      window.__app.qBtn(r.mode === 'time' ? 'The speed where each hour saved costs about your $' + m.tv + '/hr in extra gas.' : 'Past this speed, each 1% of time saved costs more than 1% more gas.') + '</div></div>';
    h += chartSvg(r.rows, m.min, m.max, { id: 'gChart', shadeTo: bal, sel: r.speed, points: m.cal.points });
    var tripMi = lastTripMi || 500;
    h += '<div class="spd-try"><div class="spd-try-h"><span>Try a speed for a <input type="number" inputmode="numeric" id="gTripMi" value="' + Math.round(tripMi) + '">-mile trip</span></div>' +
      '<input type="range" id="gTry" min="' + m.min + '" max="' + m.max + '" step="1" value="' + r.speed + '"><div class="spd-out" id="gTryOut"></div></div>';
    if (r.mode === 'time' && r.speed === m.max) h += '<div class="lead small">At $' + m.tv + '/hr, gas never outweighs the time saved up to your ' + m.max + ' mph maximum — speed limits and safety are the real limit.</div>';
    h += '<div class="lead small">' + (m.cal.used ? 'Calibrated from ' + m.cal.used + ' of your entries (your ' + esc(shortName(c)) + ' runs ' + Math.abs(Math.round((m.cal.scale - 1) * 100)) + '% ' + (m.cal.scale >= 1 ? 'better' : 'worse') + ' than the average curve).'
      : 'Not calibrated yet — log mileage with the speed you held to fit this to your car.') +
      ' Curve: ' + esc((SP.TYPES[c.type] || SP.TYPES.car).label.toLowerCase()) + ', anchored at ' + (c.type === 'hybrid' ? '1.3 × ' : '') + 'EPA highway (' + c.epa.hwy + ' mpg) at 55 mph. Shaded: speeds where going 1% faster saves more time than it costs in gas.</div>';
    h += '<details class="spd-set"><summary>Speed settings · ' + money(m.price) + '/gal' + '</summary><div class="grid2">' +
      '<label class="nf"><span>Gas price ($/gal)<small>' + (m.near ? 'blank = cheapest near you: ' + money(m.near.price) + ' at ' + esc(m.near.name) : 'blank = cheapest on the map') + '</small></span><input type="number" inputmode="decimal" step="0.01" id="sPrice" value="' + esc(S.speed.price) + '"></label>' +
      '<label class="nf"><span>My time is worth ($/hr)<small>optional · 0 = balanced (US DOT uses ~$' + Math.round(DOT_TIME) + ' for road trips)</small></span><input type="number" inputmode="decimal" step="1" id="sTime" value="' + esc(S.trip.timeValue || 0) + '"></label>' +
      '<label class="nf"><span>Minimum speed (mph)</span><input type="number" inputmode="numeric" step="1" id="sMin" value="' + m.min + '"></label>' +
      '<label class="nf"><span>Maximum speed (mph)</span><input type="number" inputmode="numeric" step="1" id="sMax" value="' + m.max + '"></label></div></details>';
    h += disclaimer() + '</details>';
    var open = setOpen;
    speedHost.innerHTML = h;
    if (open) speedHost.querySelector('.spd-set').open = true;
    bindSpdOpen();
    speedHost.querySelector('.spd-set').addEventListener('toggle', function () { setOpen = this.open; });
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
      $('gTryOut').innerHTML = v === base ? '<b>' + v + ' mph</b> — recommended. Slide to compare.'
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
    if (v == null) { if (!rule.on) return 0; v = +rule.over || 0; }
    if (v < 0 || !capOn()) return v;
    var cap = +rule.cap || 70;
    return limit >= cap ? 0 : Math.max(0, Math.min(v, cap - limit));
  }
  /** "No faster than your top speed" (the toggle under All roads); on by default when you have a rule. */
  function capOn() { return S.speed.capOn != null ? !!S.speed.capOn : !!(S.speed.rule && S.speed.rule.on); }
  /** This car's mpg-vs-speed curve (calibrated to your log) and the speed range used for trips; null without EPA data. */
  function speedFn() {
    var c = car(); if (!hasEpa(c) || kind(c) !== 'gas') return null;
    var cal = SP.calibrate(c.type || 'car', c.epa.hwy, c.entries);
    return { f: mpgFn(c, cal), lo: 25, hi: Math.max(80, +S.speed.max || 84) };
  }
  function tripSpeed(el, ctx) {
    var c = car();
    if (!el) return;
    if (kind(c) !== 'gas') { el.innerHTML = '<div class="tb-h">Cruising speed</div><div class="lead small keep">Speed adjustments are for gas and hybrid cars for now. At highway speeds an ' + (kind(c) === 'ev' ? 'EV' : 'fuel-cell car') + ' loses even more range per extra mph — the plan assumes the speed limits.</div>'; return; }
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

    var V = S.speed.view = S.speed.view || {};
    V.hide = V.hide || {};
    var helpHtml = 'Major roads — Interstates, U.S., state and county routes — with a slider for each stretch at one speed limit. Each starts at the limit (no extra cost). ' +
      (tot ? 'Limits: ' + Math.round((stt.hpms || 0) / tot * 100) + '% from the FHWA road inventory' + (stt.state ? ', ' + Math.round(stt.state / tot * 100) + '% state maximums' : '') + (stt.google ? ', ' + Math.round(stt.google / tot * 100) + '% Google\'s typical speed' : '') + '.' : '') +
      ' Cost uses the gas in your tank on each part.' + ' Stops are planned at these speeds, so you still reach every station with at least your buffer. The All roads slider sets every road, shown or hidden.';
    h += '<div class="leg all"><div class="spd-warn hidden" id="lgWarnAll"></div><div class="leg-h"><span>All roads <b class="all-v" id="lgAllV"></b>' + ' <small>' + (rule.on ? 'rule: +' + (+rule.over || 0) + ', up to ' + (+rule.cap || 70) + ' mph · ' : '') + '<a href="#" id="lgRuleEdit">' + (rule.on ? 'change rule' : 'set a rule') + '</a></small>' + '</span><b class="leg-sub" id="lgAllSub"></b></div>' +
      '<div class="rng"><input type="range" min="-10" max="15" step="1" value="' + (st.all || 0) + '" id="lgAll" aria-label="Speed on all roads"><i class="gray" id="lgGrayAll"></i></div>' +
      '<div class="leg-scale"><span>−10 mph</span><span class="z" style="left:40%">limit</span><span>+15</span></div>' +
      // your rule's overrides, right where they apply: All roads follows them while they're on
      '<div class="chips mini spd-ov" id="lgOv"><button type="button" data-ov="cap" class="' + (capOn() ? 'on' : '') + '">No faster than ' + (+rule.cap || 70) + ' mph</button>' +
      '<button type="button" data-ov="truck" class="' + (S.speed.truck ? 'on' : '') + '">As slow as the trucks</button></div></div>';
    // the per-road sliders: collapsed until you open them; the chart, total and filters stay pinned only while open
    var nRoads = 0; (function () { var last = -1; roads.forEach(function (r) { if (r.ri !== last) { nRoads++; last = r.ri; } }); })();
    // the way into the per-road sliders (a submenu): the name, its (?), how many roads, and an arrow on the right
    var GO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z"/></svg>';
    h += '<div class="road-tog ent' + (V.open ? ' open' : '') + '"><button type="button" class="sec-h" id="lgTog" aria-expanded="' + !!V.open + '"><span>Adjust speed by road</span></button>' +
      '<button type="button" class="qi" aria-label="How these sliders work" data-q="' + encodeURIComponent(helpHtml) + '">?</button>' +
      '<span class="ent-n">' + nRoads + ' road' + (nRoads === 1 ? '' : 's') + '</span>' +
      '<button type="button" class="ent-go" id="lgGo" aria-label="' + (V.open ? 'Leave speed by road' : 'Adjust speed by road') + '">' + GO + '</button></div>';
    if (V.open) {
      // which roads to show, and in what order
      h += '<div class="adj-tools"><div class="chips mini" id="lgShow">' + ['interstate', 'us', 'state', 'county'].map(function (k) {
        return '<button data-cls="' + k + '" class="' + (V.hide[k] ? '' : 'on') + '">' + { interstate: 'Interstates', us: 'U.S.', state: 'State', county: 'County' }[k] + '</button>'; }).join('') + '</div>' +
        '<div class="adj-sort"><select id="lgSort" aria-label="Sort roads"><option value="route"' + (V.sort === 'type' || V.sort === 'limit' ? '' : ' selected') + '>Route</option><option value="type"' + (V.sort === 'type' ? ' selected' : '') + '>Type</option><option value="limit"' + (V.sort === 'limit' ? ' selected' : '') + '>Limit</option></select>' +
        '<button type="button" id="lgDir" class="dir" aria-label="' + (V.dir === 'desc' ? 'Descending' : 'Ascending') + '"' + (V.sort === 'type' || V.sort === 'limit' ? '' : ' disabled') + '>' + (V.dir === 'desc' ? '↓' : '↑') + '</button></div></div>';
      // road groups (each major road with its speed-limit sections), filtered and sorted as you chose
      var RANK = { interstate: 0, us: 1, state: 2, county: 3 };
      var groups = [];
      roads.forEach(function (r, i) { var g = groups[groups.length - 1]; if (!g || g.ri !== r.ri) groups.push(g = { ri: r.ri, road: r.road, cls: r.cls, items: [] }); g.items.push(i); });
      var shown = groups.filter(function (g) { return !V.hide[g.cls]; });
      var dir = V.dir === 'desc' ? -1 : 1, topLim = function (g) { return Math.max.apply(null, g.items.map(function (i) { return roads[i].limit; })); };
      if (V.sort === 'type') shown.sort(function (a, b) { return dir * (RANK[a.cls] - RANK[b.cls]) || a.ri - b.ri; });
      else if (V.sort === 'limit') {
        shown.sort(function (a, b) { return dir * (topLim(a) - topLim(b)) || a.ri - b.ri; });
        shown.forEach(function (g) { g.items.sort(function (x, y) { return dir * (roads[x].limit - roads[y].limit) || x - y; }); });
      }
      if (!shown.length) h += '<div class="lead small keep">No roads of the kinds you picked on this route.</div>';
      else if (shown.length < groups.length) h += '<div class="lead small keep">' + (groups.length - shown.length) + ' road' + (groups.length - shown.length === 1 ? '' : 's') + ' hidden (All roads still sets them).</div>';
      shown.forEach(function (g) {
        var rr = g.road;
        h += '<div class="road-g" data-mi="' + g.items.map(function (i) { return roads[i].from + ',' + roads[i].to; }).join(';') + '"><div class="road-h"><b class="rd rd-' + g.cls + '">' + esc(roads[g.items[0]].name) + '</b><small>mile ' + Math.round(rr.from) + '–' + Math.round(rr.to) + ' · ' + fmtMi(rr.mi) +
          (rr.sections.length > 1 ? ' · ' + rr.sections.length + ' speed limits' : '') + '</small></div>';
        g.items.forEach(function (i) {
          var r = roads[i];
          h += '<div class="leg" data-leg="' + i + '" data-mi="' + r.from + ',' + r.to + '"><div class="spd-warn hidden" id="lgWarn' + i + '"></div><div class="leg-h"><span><b class="lim' + (r.posted && r.posted !== r.limit ? ' truck' : '') + '">' + r.limit + '</b> <small>' +
            (r.posted && r.posted !== r.limit ? 'mph for trucks (' + r.posted + ' posted)' : 'mph') + (r.road.sections.length > 1 ? ' · mile ' + Math.round(r.from) + '–' + Math.round(r.to) : '') +
            (r.src !== 'hpms' ? ' · state max' : '') + '</small></span><b class="leg-sub" id="lgSub' + i + '"></b></div>' +
            '<div class="rng"><input type="range" min="-10" max="15" step="1" value="' + st.offsets[i] + '" id="lgR' + i + '" aria-label="Speed on ' + esc(r.name) + ' where the limit is ' + r.limit + '"><i class="gray" id="lgGray' + i + '"></i></div>' +
            '<div class="leg-out" id="lgOut' + i + '"></div></div>';
        });
        h += '</div>';
      });
    }
    h += disclaimer();
    el.innerHTML = h;
    function update(i, move) {
      var r = roads[i], x = cost(r, st.offsets[i]), out = $('lgOut' + i), sub = $('lgSub' + i), off = st.offsets[i];
      if (out) out.textContent = off === 0 ? '' :
        Math.round(x.avgSpeed) + ' mph (' + (off > 0 ? '+' : '−') + Math.abs(off) + ') · ' + (x.minSaved >= 0 ? fmtMin(x.minSaved) + ' sooner' : fmtMin(-x.minSaved) + ' later');
      if (sub) { sub.textContent = off === 0 ? '$0.00' : (x.cost >= 0 ? '+' : '−') + money(x.cost); sub.className = 'leg-sub' + (x.cost > 0.005 ? ' cost' : x.cost < -0.005 ? ' good' : ''); }
      moveMark($('tChart'), i, x.avgSpeed || r.limit);
      if (move) moveSel($('tChart'), x.avgSpeed || 65, 100 / f(x.avgSpeed || 65));
    }
    function total() {
      var cst = 0, mins = 0, any = false;
      roads.forEach(function (r, i) {
        if (!st.offsets[i]) return;
        any = true;
        var x = cost(r, st.offsets[i]); cst += x.cost; mins += x.minSaved;
      });
      var t = $('lgTot'); t.classList.toggle('zero', !any);
      if (!any) t.innerHTML = '<span>Time-saving cost</span><b>$0.00</b><small>at the speed limits</small>';
      else t.innerHTML = '<span>Time-saving cost</span><b class="' + (cst > 0.005 ? 'cost' : 'good') + '">' + (cst >= 0 ? '+' : '−') + money(cst) + '</b><small>' +
        (mins >= 0 ? fmtMin(mins) + ' sooner' : fmtMin(-mins) + ' later') + ' over the whole trip · <a href="#" id="lgReset">reset</a></small>';
      if ($('lgReset')) $('lgReset').onclick = function (e) { e.preventDefault(); st.offsets = {}; st.all = null; tripSpeed(el, ctx); if (ctx.onChange) ctx.onChange(); };
      var all = cost({ pieces: roads.reduce(function (a, r) { return a.concat(r.pieces); }, []) }, 0);
      $('lgAllSub').textContent = any ? (cst >= 0 ? '+' : '−') + money(cst) : '$0.00';
      st.cost = cst; st.minSaved = mins;
      return all;
    }
    var activate = function (i) { st.active = i; el.querySelectorAll('.leg[data-leg]').forEach(function (x) { x.classList.toggle('on', +x.dataset.leg === i); }); };
    roads.forEach(function (r, i) {
      update(i, false);
      var inp = $('lgR' + i);
      if (!inp) return;                       // a road you've hidden
      var mx = null, raf = 0;
      var apply = function () { raf = 0; update(i, true); total(); };
      inp.oninput = function () {
        var v = +inp.value;
        if (G) { if (mx == null) mx = G.maxFor(i, offsArr()); if (v > mx) { v = mx; inp.value = v; } }      // can't slide into the gray
        st.offsets[i] = v; st.touched = i; activate(i);
        if (!raf) raf = requestAnimationFrame(apply);      // at most once a frame; the gray areas when you let go
      };
      inp.onchange = function () {
        if (raf) { cancelAnimationFrame(raf); apply(); }
        mx = null; guards();
        LG.info('speed', r.name + ' speed offset ' + st.offsets[i], { cost: st.cost, minSaved: st.minSaved }); if (G && G.release) G.release(); if (ctx.onChange) ctx.onChange();
      };
    });
    var allLabel = function (v) { $('lgAllV').textContent = v === 0 ? 'at the limit' : (v > 0 ? '+' : '−') + Math.abs(v) + ' mph'; };
    allLabel(+st.all || 0);
    // dragging stays smooth: the most you can go is worked out once per drag, the roads and chart follow at most once a
    // frame, and the heavier checks (the gray areas) run when you let go
    var mxAll = null, allRaf = 0;
    var applyAll = function () {
      allRaf = 0; var v = st.all;
      // each road at what your rule allows it (not the slider's raw value): the line never passes the rule, even mid-drag
      var mi = 0, w = 0;
      roads.forEach(function (r, i) { st.offsets[i] = ruleOff(r.limit, v); if ($('lgR' + i)) $('lgR' + i).value = st.offsets[i]; update(i, false); var x = cost(r, st.offsets[i]); mi += x.mi; w += x.avgSpeed * x.mi; });
      var avg = mi ? w / mi : 65;
      moveSel($('tChart'), avg, 100 / f(avg));
      total();
    };
    $('lgAll').oninput = function () {
      var v = +$('lgAll').value;
      if (G) { if (mxAll == null) mxAll = G.maxAll(); if (v > mxAll) { v = mxAll; $('lgAll').value = v; } }
      st.all = v; st.touched = 'all'; allLabel(v);
      if (!allRaf) allRaf = requestAnimationFrame(applyAll);
    };
    $('lgAll').onchange = function () {
      if (allRaf) { cancelAnimationFrame(allRaf); applyAll(); }
      mxAll = null; guards();
      LG.info('speed', 'All roads speed offset ' + st.all, { cost: st.cost }); if (G && G.release) G.release(); if (ctx.onChange) ctx.onChange();
    };
    $('lgOv').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ov === 'cap') {
        S.speed.capOn = !capOn(); b.classList.toggle('on', capOn()); save();
        LG.info('speed', 'All roads: top speed ' + (capOn() ? 'kept' : 'off'));
        applyAll(); guards(); if (G && G.release) G.release(); if (ctx.onChange) ctx.onChange();
      } else if (ctx.onTruck) { S.speed.truck = !S.speed.truck; save(); LG.info('speed', 'Truck limits ' + (S.speed.truck ? 'on' : 'off')); ctx.onTruck(); }
    };
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
    if ($('lgRuleEdit')) $('lgRuleEdit').onclick = function (e) { e.preventDefault(); if (ctx.onEditRule) ctx.onEditRule(); };
    $('lgTog').onclick = function () { V.open = !V.open; save(); tripSpeed(el, ctx); if (ctx.onToggle) ctx.onToggle(V.open); };
    $('lgGo').onclick = function () { $('lgTog').click(); };
    el.classList.toggle('exp', !!V.open);
    // the pinned filters sit right under the pinned chart: measure it once it's laid out (and again as the sheet changes)
    var stick = el.querySelector('.spd-stick');
    var measure = function () { if (stick && stick.isConnected) el.style.setProperty('--stick-h', Math.floor(stick.getBoundingClientRect().height) + 'px'); };
    measure(); requestAnimationFrame(measure); setTimeout(measure, 300);
    if (stick && window.ResizeObserver) new ResizeObserver(measure).observe(stick);   // e.g. narrower in the speed-by-road submenu
    if (!el._measure) { el._measure = true; window.addEventListener('resize', function () { var s0 = el.querySelector('.spd-stick'); if (s0) el.style.setProperty('--stick-h', Math.ceil(s0.getBoundingClientRect().height) + 'px'); }); }
    el.querySelectorAll('input[type=range]').forEach(guardRange);
    if ($('lgShow')) $('lgShow').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; V.hide[b.dataset.cls] = !V.hide[b.dataset.cls]; save(); tripSpeed(el, ctx); };
    if ($('lgSort')) $('lgSort').onchange = function () { V.sort = this.value; save(); tripSpeed(el, ctx); };
    if ($('lgDir')) $('lgDir').onclick = function () { V.dir = V.dir === 'desc' ? 'asc' : 'desc'; save(); tripSpeed(el, ctx); };
    activate(act);
    total();
    // the grayed-out speeds take a moment to work out on a long trip: done just after the card is on screen
    var gtok = el._gtok = {};
    setTimeout(function () { if (el._gtok === gtok && el.isConnected) guards(); }, 120);
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

  window.Garage = { kind: kind, unit: unit, units: units, plugs: plugs, rangeMi: rangeMi, rangeHwy: rangeHwy, shortName: shortName, fromVpic: fromVpic, applyEpa: applyEpa, POWER: POWER,
    need: need, ok: ok, braveSerial: braveSerial, carKey: tankKey, ruleOff: ruleOff, speedFn: speedFn, guardRange: guardRange, tripSpeed: tripSpeed, mpgFn: mpgFn, render: render, car: car, carModel: carModel, grade: grade, tank: tank, redraw: draw, drawSpeed: drawSpeed, speedModel: speedModel, TANKS: TANKS };
})();
