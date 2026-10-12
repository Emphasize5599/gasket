/* Alternative fuels: EV fast chargers and hydrogen stations from the U.S. Department of Energy's free station finder
 * (Alternative Fuels Data Center, developer.nlr.gov). A shared DEMO_KEY works for light use (about 30 lookups an hour
 * per phone); Settings → Alternative fuels takes your own free key. Never logged or exported.
 *
 * - Main map: a ⚡ button opens the alt-fuel panel: fetch every hydrogen station, show them, and shade where a
 *   fuel-cell car can't make it (yellow: no station within half its range, so no way back; gray: none within its
 *   whole range). EV fast chargers in the map area, filtered to your car's plug.
 * - Trips (EV / fuel-cell car): chargers or hydrogen stations along each route option become the stops.
 * Loaded after tripui.js. */
(function () {
  'use strict';
  var A = window.__app, S = A.S, P = A.P, $ = A.$, esc = A.esc, KV = A.KV, N = A.N, map = A.map;
  var LG = window.FLog || { info: function () {}, debug: function () {}, warn: function () {}, error: function () {} };
  var BASE = 'https://developer.nlr.gov/api/alt-fuel-stations/v1';
  var WEEK = 7 * 24 * 3600e3;
  var ROAD = 1.3;             // roads are ~30% longer than a straight line (typical detour index)
  S.alt = Object.assign({ h2Cov: true, h2Range: '', evSpeed: 'dc', h2Press: 'all' }, S.alt || {});
  // the fuel mode (the top bar's pill, app.js) decides what's on the map: chargers in ⚡, hydrogen stations in H₂
  function evOn() { return S.fuelMode === 'ev'; }
  function h2On() { return S.fuelMode === 'h2'; }
  var LEVEL = { dc: 'dc_fast', l2: '2', all: 'all' };

  function key() { return String(S.nrelKey || '').trim() || 'DEMO_KEY'; }
  function call() { return window.__trip.call.apply(null, arguments); }
  function unitOf(kind) { return kind === 'ev' ? 'kWh' : kind === 'h2' ? 'kg' : 'gal'; }

  /** One request to the station finder -> parsed JSON (throws a readable message). The key never reaches the log. */
  async function get(path, params) {
    var q = Object.keys(params).filter(function (k) { return params[k] !== '' && params[k] != null; })
      .map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    var url = BASE + path + '?api_key=' + encodeURIComponent(key()) + '&' + q;
    LG.debug('altfuel', 'Station finder ' + path, params.fuel_type || '');
    var r = await call('fetchJson', url);
    if (r.error) {
      var m = String(r.error);
      if (/429/.test(m)) throw new Error(key() === 'DEMO_KEY' ? 'The shared DEMO_KEY is out of lookups for now (about 30 an hour). Add your own free key in Settings → Alternative fuels.' : 'Your station-finder key is out of lookups for now. Try again in an hour.');
      if (/40[13]/.test(m)) throw new Error('The station finder didn\'t accept the key. Check it in Settings → Alternative fuels.');
      if (/not allowed/i.test(m)) throw new Error('This version of the app can\'t reach the station finder yet.');
      throw new Error('Couldn\'t reach the station finder (' + m + ').');
    }
    try { return JSON.parse(r.body); } catch (e) { throw new Error('The station finder sent something unreadable.'); }
  }

  // Charging speed: the finder lists ports, not always power. Where it gives power per connector we use the most;
  // otherwise a typical figure for the network (marked as an estimate).
  var NET_KW = [[/tesla/i, 250], [/ionna/i, 350], [/electrify america/i, 150], [/rivian/i, 200], [/francis/i, 150], [/evgo/i, 100], [/mercedes/i, 300], [/walmart/i, 150], [/chargepoint/i, 62], [/./, 50]];
  function powerOf(f) {
    var best = 0;
    (function walk(o, d) {
      if (!o || typeof o !== 'object' || d > 5) return;
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (/power_kw/i.test(k) && +v > best) best = +v;
        else if (typeof v === 'object') walk(v, d + 1);
      });
    })(f.ev_charging_units, 0);
    if (best > 0) return { kw: Math.round(best), est: false };
    var net = String(f.ev_network || '');
    for (var i = 0; i < NET_KW.length; i++) if (NET_KW[i][0].test(net)) return { kw: NET_KW[i][1], est: true };
    return { kw: 50, est: true };
  }
  var NETS = { 'Tesla': 'Tesla Supercharger', 'Tesla Destination': 'Tesla Destination', 'eVgo Network': 'EVgo', 'Electrify America': 'Electrify America',
    'ChargePoint Network': 'ChargePoint', 'Blink Network': 'Blink', 'EV Connect': 'EV Connect', 'FLO': 'FLO', 'RIVIAN_ADVENTURE': 'Rivian Adventure', 'Non-Networked': '' };
  function norm(f) {
    if (!f || f.latitude == null || f.longitude == null) return null;
    var ev = f.fuel_type_code === 'ELEC', pw = ev ? powerOf(f) : null;
    return {
      id: 'afdc' + f.id, afdcId: f.id, brand: ev ? 'ev' : 'h2', name: String(f.station_name || (ev ? 'EV charger' : 'Hydrogen station')).trim(),
      network: ev ? (NETS[f.ev_network] != null ? NETS[f.ev_network] : String(f.ev_network || '')) : '',
      address: [f.street_address, f.city, [f.state, f.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), state: f.state || '',
      lat: +f.latitude, lng: +f.longitude, dc: +f.ev_dc_fast_num || 0, l2: +f.ev_level2_evse_num || 0, plugs: f.ev_connector_types || [],
      kw: pw ? pw.kw : 0, kwEst: pw ? pw.est : false, pricing: String(f.ev_pricing || '').trim(),
      hours: String(f.access_days_time || '').trim(), status: f.status_code || 'E', phone: f.station_phone || '',
      hyPress: f.hy_pressures || [], hyLink: f.hy_status_link || '', retail: f.hy_is_retail, confirmed: f.date_last_confirmed || '',
      off: f.distance != null ? +f.distance : null, prices: {}
    };
  }

  /** Every open, public hydrogen station (US and Canada), kept a week. force: fetch again now. */
  async function hydrogenAll(force) {
    var o = !force && KV.get('afdc', 'hy-all', WEEK);
    if (o) return { list: o.v.map(norm).filter(Boolean), t: o.t };
    var j = await get('.json', { fuel_type: 'HY', status: 'E', access: 'public', country: 'all', limit: 'all' });
    var raw = j.fuel_stations || [];
    KV.put('afdc', 'hy-all', raw);
    LG.info('altfuel', 'Fetched ' + raw.length + ' hydrogen stations');
    return { list: raw.map(norm).filter(Boolean), t: Date.now() };
  }
  function plugParam(plugs) { return plugs && plugs.length ? plugs.join(',') : 'J1772COMBO,TESLA,CHADEMO'; }
  /** DC fast chargers within radius miles of a point that take one of these plugs, kept a week. */
  async function evNear(lat, lng, radiusMi, plugs, speed) {
    var lvl = LEVEL[speed] || 'dc_fast';
    var k = 'ev|' + lat.toFixed(2) + ',' + lng.toFixed(2) + '|' + Math.round(radiusMi) + '|' + plugParam(plugs) + (lvl === 'dc_fast' ? '' : '|' + lvl);
    var o = KV.get('afdc', k, WEEK);
    if (o) return o.v.map(norm).filter(Boolean);
    var j = await get('/nearest.json', { latitude: lat.toFixed(5), longitude: lng.toFixed(5), radius: Math.min(500, Math.round(radiusMi)), fuel_type: 'ELEC',
      ev_charging_level: lvl, ev_connector_type: lvl === 'dc_fast' ? plugParam(plugs) : (plugs && plugs.length ? plugParam(plugs.concat(['J1772'])) : ''), status: 'E', access: 'public', limit: 200 });
    var raw = j.fuel_stations || [];
    KV.put('afdc', k, raw);
    return raw.map(norm).filter(Boolean);
  }
  /**
   * Stations within corridorMi of a route, for a trip: the route goes to the finder as a simplified line (a few hundred
   * miles per lookup), each piece kept a week. kind 'ev' | 'h2'. -> stations (deduped)
   */
  async function alongRoute(model, kind, plugs, corridorMi, onProg) {
    var L = model.totalMi, PIECE = 400, out = {}, n = Math.max(1, Math.ceil(L / PIECE));
    for (var k = 0; k < n; k++) {
      var a = k * L / n, b = (k + 1) * L / n, pts = [];
      var step = Math.max(1, (b - a) / 80);
      for (var d = a; d < b + step / 2; d += step) pts.push(model.pointAt(Math.min(b, d)));
      pts = pts.filter(Boolean);
      if (pts.length < 2) continue;
      var line = 'LINESTRING(' + pts.map(function (p) { return p.lng.toFixed(4) + ' ' + p.lat.toFixed(4); }).join(', ') + ')';
      var params = { route: line, distance: corridorMi, fuel_type: kind === 'ev' ? 'ELEC' : 'HY', status: 'E', access: 'public', limit: 'all' };
      if (kind === 'ev') { params.ev_charging_level = 'dc_fast'; params.ev_connector_type = plugParam(plugs); }
      var ck = kind + '|' + corridorMi + '|' + (params.ev_connector_type || '') + '|' + line;
      var o = KV.get('afdc', ck, WEEK), raw;
      if (o) raw = o.v;
      else { var j = await get('/nearby-route.json', params); raw = j.fuel_stations || []; KV.put('afdc', ck, raw); }
      raw.forEach(function (f) { var s = norm(f); if (s) out[s.id] = s; });
      if (onProg) onProg((k + 1) / n);
    }
    var list = Object.keys(out).map(function (id) { return out[id]; });
    LG.info('altfuel', list.length + ' ' + (kind === 'ev' ? 'fast chargers' : 'hydrogen stations') + ' along the route');
    return list;
  }

  /** For an EV stop: average charging power (kW) between ~10% and 80% — the peak tapers, so about 70% of the
   *  lower of the car's and the charger's maximum. */
  function avgKw(st, car) {
    var carKw = +(car && car.dcKw) || 150, stKw = st.kw || 50;
    return Math.max(10, 0.7 * Math.min(carKw, stKw));
  }

  // ---------- main map: markers, coverage, the panel ----------
  var cov = null, h2Layer = null, evLayer = null, h2List = [], evList = [], h2T = 0, renderer = null;
  function panes() {
    if (!map.getPane('afcov')) { map.createPane('afcov'); map.getPane('afcov').style.zIndex = 350; map.getPane('afcov').style.pointerEvents = 'none'; }
    if (!map.getPane('afdots')) { map.createPane('afdots'); map.getPane('afdots').style.zIndex = 620; }
    if (!renderer) renderer = L.canvas({ pane: 'afdots', padding: 0.3 });
  }
  /** What a station's popup says. */
  function stationHtml(s) {
    var h = '<div class="af-pop"><b>' + esc(s.name) + '</b>' + (s.network ? '<small>' + esc(s.network) + '</small>' : '') +
      '<div>' + esc(s.address) + '</div>';
    if (s.brand === 'ev') h += '<div>' + s.dc + ' fast port' + (s.dc === 1 ? '' : 's') + ' · ' + (s.kwEst ? '~' : '') + s.kw + ' kW' + (s.kwEst ? ' (typical for the network)' : '') + '</div>' +
      '<div>' + esc(s.plugs.map(plugName).join(', ')) + '</div>';
    else h += '<div>' + (s.hyPress.length ? esc(s.hyPress.join(', ')) + ' bar' : 'Hydrogen') + '</div>';
    if (s.pricing) h += '<div class="af-sm">' + esc(s.pricing) + '</div>';
    if (s.hours) h += '<div class="af-sm">' + esc(s.hours) + '</div>';
    h += '<div class="af-act"><button data-afnav="' + esc(s.id) + '">Navigate</button>' + (s.hyLink ? '<button data-afurl="' + esc(s.hyLink) + '">Live status</button>' : '') + '</div></div>';
    return h;
  }
  function plugName(p) { return { J1772COMBO: 'CCS', TESLA: 'NACS (Tesla)', CHADEMO: 'CHAdeMO', J1772: 'J1772', J3271: 'MCS' }[p] || p; }
  var marks = {};
  function drawDots(list, layer, color) {
    layer.clearLayers();
    list.forEach(function (s) {
      var m = marks[s.id] = L.circleMarker([s.lat, s.lng], { renderer: renderer, radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 });
      m.bindPopup(stationHtml(s), { className: 'af-popup', maxWidth: 260 });
      m.on('popupopen', function (e) {
        var el = e.popup.getElement(); if (!el) return;
        el.querySelectorAll('[data-afnav]').forEach(function (b) { b.onclick = function () { N.navigate(s.lat, s.lng, '', s.name); }; });
        el.querySelectorAll('[data-afurl]').forEach(function (b) { b.onclick = function () { N.openUrl(b.dataset.afurl); }; });
      });
      layer.addLayer(m);
    });
  }
  /** The range to shade for: your fuel-cell car's (selected first), else what you typed, else 350 mi. */
  function h2Range() {
    var typed = parseFloat(S.alt.h2Range);
    if (typed > 0) return { mi: typed, src: 'you entered it' };
    var G = window.Garage, cars = (S.cars || []).filter(function (c) { return G && G.kind(c) === 'h2'; });
    var sel = cars.filter(function (c) { return c.id === S.carId; })[0] || cars[0];
    var r = sel && G.rangeMi(sel);
    if (r > 0) return { mi: Math.round(r), src: 'your ' + G.shortName(sel) };
    return { mi: 350, src: 'a typical fuel-cell car' };
  }
  var Cov = L.GridLayer.extend({
    createTile: function (c) {
      var sz = this.getTileSize(), t = document.createElement('canvas'); t.width = sz.x; t.height = sz.y;
      var ctx = t.getContext('2d'), B = 4, R = this.options.rangeMi, half = R / 2, st = this.options.st;
      var nx = Math.ceil(sz.x / B), ny = Math.ceil(sz.y / B), lats = [], lngs = [], x0 = c.x * sz.x, y0 = c.y * sz.y;
      for (var i = 0; i < nx; i++) lngs.push(map.unproject(L.point(x0 + i * B + B / 2, y0), c.z).lng);
      for (var j = 0; j < ny; j++) lats.push(map.unproject(L.point(x0, y0 + j * B + B / 2), c.z).lat);
      var GRAY = 'rgba(55, 60, 70, .46)', YEL = 'rgba(255, 196, 32, .40)';
      for (j = 0; j < ny; j++) {
        var la = lats[j], kx = Math.cos(la * Math.PI / 180) * 69.17, run = null, runX = 0;
        for (i = 0; i <= nx; i++) {
          var col = null;
          if (i < nx) {
            var lo = lngs[i], best = 1e9;
            for (var k = 0; k < st.length; k++) {
              var dy = (la - st[k].lat) * 69.0, dx = (lo - st[k].lng) * kx, d2 = dx * dx + dy * dy;
              if (d2 < best) best = d2;
            }
            var d = Math.sqrt(best) * ROAD;
            col = d > R ? GRAY : d > half ? YEL : null;
          }
          if (col !== run) { if (run) { ctx.fillStyle = run; ctx.fillRect(runX * B, j * B, (i - runX) * B, B); } run = col; runX = i; }
        }
      }
      return t;
    }
  });
  function drawCoverage() {
    if (cov) { map.removeLayer(cov); cov = null; }
    if (!h2On() || !S.alt.h2Cov || !h2List.length) { legend(); return; }
    panes();
    cov = new Cov({ pane: 'afcov', rangeMi: h2Range().mi, st: h2List.map(function (s) { return { lat: s.lat, lng: s.lng }; }), updateWhenZooming: false, keepBuffer: 1 });
    cov.addTo(map);
    legend();
  }
  function legend() {
    var el = $('afLegend');
    var on = h2On() && S.alt.h2Cov && h2List.length;
    if (!on) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'afLegend'; el.className = 'af-legend'; document.body.appendChild(el); }
    var r = h2Range();
    el.innerHTML = '<span><i class="y"></i>No H₂ within ' + Math.round(r.mi / 2) + ' mi — can\'t get back</span><span><i class="g"></i>None within ' + r.mi + ' mi — out of range</span>';
  }
  function showH2() {
    panes();
    if (!h2Layer) h2Layer = L.layerGroup().addTo(map);
    if (h2On()) drawDots(h2Shown(), h2Layer, P.ALT.h2.color); else h2Layer.clearLayers();
    drawCoverage();
  }
  function showEv() {
    panes();
    if (!evLayer) evLayer = L.layerGroup().addTo(map);
    if (evOn()) drawDots(evList, evLayer, P.ALT.ev.color); else evLayer.clearLayers();
  }
  function carPlugs() { var G = window.Garage, c = G && G.car(); return c && G.kind(c) === 'ev' ? G.plugs(c) : null; }

  function openPanel() {
    var old = $('afPick'); if (old) old.remove();
    var bg = document.createElement('div'); bg.className = 'tpick-bg'; bg.id = 'afPick';
    var r = h2Range(), plugs = carPlugs();
    var ago = h2T ? A.ago(new Date(h2T)) : '';
    bg.innerHTML = '<div class="tpick af" role="dialog" aria-label="Alternative fuels"><div class="tpick-h af-h"><span>EV & hydrogen</span><button class="x" id="afX" aria-label="Close">✕</button></div>' +
      '<div class="af-sec"><div class="af-t"><span class="af-ic h2">H₂</span><b>Hydrogen (fuel cell)</b></div>' +
      '<button class="btn tonal" id="afH2Get">' + (h2List.length ? 'Fetch all hydrogen stations again' : 'Fetch all hydrogen stations') + '</button>' +
      '<div class="af-msg" id="afH2Msg">' + (h2List.length ? h2List.length + ' open public stations' + (ago ? ' · fetched ' + esc(ago) : '') : 'Every open public station in the U.S. and Canada — one free lookup.') + '</div>' +

      '<div class="field"><div class="lbl">Shade what\'s out of reach<small>Yellow: no station within half your range — you couldn\'t get back. Gray: none within your whole range. Straight-line distance × 1.3 for roads, so it\'s a rough guide.</small></div>' + swHtml('afH2Cov', S.alt.h2Cov) + '</div>' +
      '<div class="field"><div class="lbl">Range on a full tank (mi)<small id="afRangeSrc">blank = ' + esc(r.src) + (parseFloat(S.alt.h2Range) > 0 ? '' : ' (' + r.mi + ' mi)') + '</small></div><input type="number" inputmode="numeric" id="afRange" min="50" max="900" step="10" value="' + esc(S.alt.h2Range || '') + '" placeholder="' + r.mi + '"></div></div>' +
      '<div class="af-sec"><div class="af-t"><span class="af-ic ev">⚡</span><b>EV fast chargers</b></div>' +
      '<button class="btn tonal" id="afEvGet">Find chargers in this area</button>' +
      '<div class="af-msg" id="afEvMsg">' + (evList.length ? evList.length + ' found' : 'DC fast chargers (Level 3) around the middle of the map') + ' · ' + (plugs ? 'plugs your car takes: ' + esc(plugs.map(plugName).join(', ')) : 'any plug') + '</div>' +
      '</div>' +
      '<p class="lead small keep">From the U.S. Department of Energy\'s station finder (Alternative Fuels Data Center). Stations can be down without notice — hydrogen especially; check the live status before you go.</p></div>';
    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('on'); });
    var close = function () { bg.classList.remove('on'); setTimeout(function () { bg.remove(); }, 200); };
    bg.onclick = function (e) { if (e.target === bg) close(); };
    $('afX').onclick = close;
    var sw = function (id, k, fn) { bg.querySelector('[data-af="' + id + '"]').onchange = function () { S.alt[k] = this.checked; A.save(); fn(); }; };
    sw('afH2Cov', 'h2Cov', drawCoverage);
    $('afRange').onchange = function () { var v = parseFloat(this.value); S.alt.h2Range = v > 0 ? String(Math.round(v)) : ''; A.save(); drawCoverage(); };
    $('afH2Get').onclick = async function () {
      var b = this; b.disabled = true; $('afH2Msg').textContent = 'Fetching…'; $('afH2Msg').classList.remove('err');
      try {
        var res = await hydrogenAll(true); h2List = res.list; h2T = res.t;
        A.setMode('h2');
        $('afH2Msg').textContent = h2List.length + ' open public stations · just now';
        showH2(); A.rebuild();
        if (h2List.length) { close(); map.fitBounds(L.latLngBounds(h2List.map(function (s) { return [s.lat, s.lng]; })).pad(0.1)); }
      } catch (e) { $('afH2Msg').textContent = e.message; $('afH2Msg').classList.add('err'); }
      b.disabled = false; b.textContent = 'Fetch all hydrogen stations again';
    };
    $('afEvGet').onclick = async function () {
      var b = this, c = map.getCenter(), bd = map.getBounds(), rad = Math.max(10, Math.min(150, P.haversineMi(c.lat, c.lng, bd.getNorth(), bd.getEast())));
      b.disabled = true; $('afEvMsg').textContent = 'Finding…'; $('afEvMsg').classList.remove('err');
      try {
        evList = await evNear(c.lat, c.lng, rad, carPlugs(), S.alt.evSpeed); evArea = { lat: c.lat, lng: c.lng };
        A.setMode('ev');
        $('afEvMsg').textContent = evList.length + ' fast charger' + (evList.length === 1 ? '' : 's') + ' within ' + Math.round(rad) + ' mi';
        showEv(); A.rebuild(); if (evList.length) close();
      } catch (e) { $('afEvMsg').textContent = e.message; $('afEvMsg').classList.add('err'); }
      b.disabled = false;
    };
  }
  function swHtml(id, on) { return '<label class="switch"><input type="checkbox" data-af="' + id + '"' + (on ? ' checked' : '') + '><span></span></label>'; }

  // ---------- the fuel mode's part of the main screen: the top bar's selector, the list, refresh ----------
  var evArea = null, busy = false;
  function h2Shown() { return S.alt.h2Press === 'all' ? h2List : h2List.filter(function (s) { return (s.hyPress || []).join(' ').indexOf(S.alt.h2Press) >= 0; }); }
  /** The top bar's selector in ⚡ / H₂ mode: charger speed, or hydrogen pressure. */
  function seg(el) {
    var ev = evOn(), opts = ev ? [['dc', 'Fast'], ['l2', 'Level 2'], ['all', 'All']] : [['all', 'All'], ['H70', 'H70'], ['H35', 'H35']], cur = ev ? S.alt.evSpeed : S.alt.h2Press;
    el.innerHTML = '';
    opts.forEach(function (o) {
      var b = document.createElement('button'); b.textContent = o[1]; b.className = cur === o[0] ? 'on' : '';
      b.setAttribute('aria-label', ev ? (o[0] === 'dc' ? 'DC fast chargers' : o[0] === 'l2' ? 'Level 2 chargers' : 'All chargers') : (o[0] === 'all' ? 'All hydrogen stations' : o[1] + ' (' + (o[0] === 'H70' ? '700' : '350') + ' bar)'));
      b.onclick = function () {
        if (ev) { if (S.alt.evSpeed === o[0]) return; S.alt.evSpeed = o[0]; A.save(); A.rebuild(); refresh(false); }
        else { S.alt.h2Press = o[0]; A.save(); showH2(); A.rebuild(); }
      };
      el.appendChild(b);
    });
  }
  function here() { var me = A.me && A.me(); return me ? { lat: me.lat, lng: me.lng } : map.getCenter(); }
  /** Refresh: chargers around you (area: around the middle of the map, as far as it shows, 10–150 mi), or every hydrogen station again. */
  async function refresh(area) {
    if (busy) return; busy = true;
    var rb = $('btnRefresh'); if (rb) rb.classList.add('spin');
    try {
      if (evOn()) {
        var c = area ? map.getCenter() : here(), bd = map.getBounds();
        var rad = area ? Math.max(10, Math.min(150, P.haversineMi(c.lat, c.lng, bd.getNorth(), bd.getEast()))) : 25;
        A.status && A.status('Finding chargers…');
        evList = await evNear(c.lat, c.lng, rad, carPlugs(), S.alt.evSpeed); evArea = { lat: c.lat, lng: c.lng };
        LG.info('altfuel', 'Chargers: ' + evList.length + ' (' + S.alt.evSpeed + ')');
        showEv();
      } else if (h2On()) {
        A.status && A.status('Fetching hydrogen stations…');
        var res = await hydrogenAll(h2List.length > 0);   // a week's list is used first; ↻ with stations shown fetches again
        h2List = res.list; h2T = res.t;
        showH2();
      }
    } catch (e) { A.status && A.status(e.message); LG.warn('altfuel', 'Station finder', e.message); }
    busy = false; if (rb) rb.classList.remove('spin');
    A.rebuild();
  }
  /** The bottom line and list in ⚡ / H₂ mode: nearest first. */
  function renderList(best, rows) {
    var ev = evOn(), list = ev ? evList : h2Shown(), c = here();
    var withD = list.map(function (s) { return { s: s, d: P.haversineMi(c.lat, c.lng, s.lat, s.lng) }; }).sort(function (a, b) { return a.d - b.d; });
    var what = ev ? (S.alt.evSpeed === 'dc' ? 'fast charger' : S.alt.evSpeed === 'l2' ? 'Level 2 charger' : 'charger') : 'hydrogen station';
    if (withD.length) best.innerHTML = 'Nearest ' + what + ' <span class="big">' + withD[0].d.toFixed(1) + ' mi</span><br><b>' + esc(withD[0].s.name) + '</b> · ' + withD.length + ' ' + (ev ? 'here' : 'open');
    else best.innerHTML = busy ? 'Finding ' + what + 's…' : ev ? 'No ' + what + 's here yet. Tap ↻ to look around you' : 'Tap ↻ to fetch every hydrogen station';
    rows.innerHTML = withD.length ? withD.slice(0, 120).map(function (x) {
      var s = x.s, sub = ev ? [s.network, s.dc ? s.dc + ' fast · ' + (s.kwEst ? '~' : '') + s.kw + ' kW' : s.l2 ? s.l2 + ' Level 2' : ''].filter(Boolean).join(' · ') : ((s.hyPress || []).join(' · ') || 'hydrogen');
      return '<button class="row" data-af="' + esc(s.id) + '"><span class="af-ic ' + (ev ? 'ev' : 'h2') + '">' + (ev ? '⚡' : 'H₂') + '</span>' +
        '<span class="mid"><div class="nm">' + esc(s.name) + '</div><div class="sub">' + x.d.toFixed(1) + ' mi · ' + esc(sub) + '</div></span>' +
        '<span class="pr"><div class="o" style="text-decoration:none">' + esc(ev && s.pricing ? (s.pricing.length > 18 ? s.pricing.slice(0, 17) + '…' : s.pricing) : '') + '</div></span></button>';
    }).join('') + '<div class="af-src">Stations: U.S. Department of Energy (AFDC)</div>' : '<div class="empty">' + (ev ? 'Chargers' : 'Hydrogen stations') + ' will appear here.</div>';
  }
  function focus(id) {
    var m = marks[id]; if (!m) return;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 13)); setTimeout(function () { m.openPopup(); }, 250);
  }
  /** The mode changed (the pill): show its stations, fetching once if there are none yet (a free lookup). */
  function modeChanged() {
    showEv(); showH2();
    if (evOn() && !evList.length) refresh(false);
    else if (h2On() && !h2List.length) refresh(false);
  }
  // a car of another kind picked in the Garage: the mode follows it (⚡ for an EV, H₂ for a fuel cell, ⛽ otherwise)
  var lastKind = null;
  window.addEventListener('garagechange', function () {
    var G = window.Garage, c = G && G.car(); if (!c) return;
    var k = G.kind(c), m = k === 'ev' ? 'ev' : k === 'h2' ? 'h2' : 'gas';
    if (lastKind !== null && lastKind !== m) A.setMode(m);
    lastKind = m;
  });

  // stations already fetched come back on the map at start (no lookup)
  try {
    var o = KV.get('afdc', 'hy-all');
    if (o && o.v) { h2List = o.v.map(norm).filter(Boolean); h2T = o.t; }
  } catch (e) { }
  window.addEventListener('garagechange', function () { if (h2On()) drawCoverage(); });
  // at start: the mode the app was left in (its stations, the selector)
  setTimeout(function () { var G = window.Garage, c = G && G.car(); if (c) { var k = G.kind(c); lastKind = k === 'ev' ? 'ev' : k === 'h2' ? 'h2' : 'gas'; } if (A.altMode()) { showEv(); showH2(); A.rebuild(); } }, 0);

  window.AltFuel = { hydrogenAll: hydrogenAll, evNear: evNear, alongRoute: alongRoute, norm: norm, avgKw: avgKw, plugName: plugName, unitOf: unitOf,
    open: openPanel, seg: seg, renderList: renderList, refresh: refresh, focus: focus, modeChanged: modeChanged, h2Range: h2Range, coverage: function () { return cov; }, h2: function () { return h2List; }, stationHtml: stationHtml, ROAD: ROAD };
})();
