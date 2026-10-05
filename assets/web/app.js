/* Fuel+ Map — UI logic. Talks to the Android shell through window.Native. */
(function () {
  'use strict';
  var P = window.Pricing;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- native bridge (with a browser stand-in for testing) ----------
  var N = window.Native || (function () {
    var mem = {};
    return {
      loadSettings: function () { return mem.s || ''; }, saveSettings: function (j) { mem.s = j; },
      loadCache: function () { return mem.c || ''; }, saveCache: function (j) { mem.c = j; },
      callsThisMonth: function () { return 0; }, certFingerprint: function () { return 'BROWSER-TEST'; },
      packageName: function () { return 'com.ben.gasmap'; },
      locate: function () { setTimeout(function () { window.onLocation(34.7695, -92.2671, 30); }, 300); },
      haptic: function () {}, setStatusBarDark: function () {},
      openUrl: function (u) { window.__lastUrl = u; },
      navigate: function (lat, lng, id) { console.log('navigate', lat, lng, id); window.__lastNav = [lat, lng, id]; },
      openInOtherApp: function (lat, lng) { console.log('geo', lat, lng); },
      siteSearch: function (key, req, argsJson) {
        var a = JSON.parse(argsJson), lat = a.lat, lng = a.lng;
        if (window.__siteMock) { var mr = window.__siteMock(key, a); if (mr) { window.onSiteProgress && onSiteProgress(key, req, 1, 2); return setTimeout(function () { window.onSiteResult(key, req, mr); }, 60); } }
        setTimeout(function () {
          if (key === 'murphy') return window.onSiteResult('murphy', req, window.__muMock || { stores: [{ id: 1111, storeNumber: 2222, chainName: 'Murphy USA',
            address: '1 Test Dr', city: 'Testville', state: 'AR', zip: '72000', latitude: lat - 0.02, longitude: lng + 0.015, closeDate: '',
            gasPrices: [{ fuelType: 'Regular', price: 2.839, lastUpdateUtc: new Date().toISOString() }, { fuelType: 'PremiumNoEthanol', price: 3.899, lastUpdateUtc: new Date().toISOString() }] }] });
          window.onSiteResult('walmart', req, window.__wmMock || { stores: [{ id: '1234', name: 'Test Supercenter', geo: { latitude: lat + 0.01, longitude: lng - 0.01 },
            address: { addressLineOne: '1 Test St', city: 'Testville', state: 'AR', postalCode: '72000' },
            fuel: { metadata: { dateCreated: new Date().toISOString() }, prices: [{ name: 'UNLEAD', displayName: 'Unleaded', price: 2.879 }, { name: 'DIESEL', displayName: 'Diesel', price: 3.599 }] } }] });
        }, 150);
      },
      siteVerify: function (k) { window.__verifyOpened = k; },
      saveLog: function (t) { mem.log = t; }, loadLog: function () { return mem.log || ''; },
      shareText: function (subj, t) { window.__shared = { subject: subj, text: t }; },
      saveDownload: function (name, mime, t) { window.__saved = { name: name, text: t }; return 'Downloads/FuelPlus/' + name; },
      appVersion: function () { return 'test'; },
      routeCallsThisMonth: function () { return 0; },
      placesFind: function (req, key, q, lat, lng, bias, radius) { setTimeout(function () { var m = window.__mocks && window.__mocks.find; window.onNativeResult(req, m ? { body: JSON.stringify(m(q, lat, lng, radius)) } : { error: 'No find mock' }); }, 50); },
      resolveLink: function (req, url) { setTimeout(function () { window.onNativeResult(req, (window.__mocks && window.__mocks.link) || { url: url }); }, 50); },
      fetchJson: function (req, url) { setTimeout(function () { var m = window.__mocks && (/nominatim/.test(url) ? window.__mocks.osm : window.__mocks.epa); window.onNativeResult(req, m ? { body: JSON.stringify(m(url)) } : { error: 'offline' }); }, 50); },
      computeRoute: function (req, key, body) { setTimeout(function () { var m = window.__mocks && window.__mocks.route; window.onNativeResult(req, m ? { body: JSON.stringify(m(JSON.parse(body))) } : { error: 'No route mock' }); }, 80); },
      routeSearch: function (req, key, jobs) { var jl = JSON.parse(jobs); window.__progSeen = []; jl.forEach(function (_, i) { setTimeout(function () { window.onNativeProgress && onNativeProgress(req, i, jl.length); window.__progSeen.push(document.getElementById('tGo') && document.getElementById('tGo').textContent); }, 5 * i); }); setTimeout(function () { var m = window.__mocks && window.__mocks.along; window.onNativeResult(req, m ? m(JSON.parse(jobs)) : { results: [], errors: [] }); }, 5 * jl.length + 40); },
      search: function (req) { setTimeout(function () { window.onSearchResult(req, { places: [], errors: ['No Native bridge'], calls: 0 }); }, 200); }
    };
  })();

  // ---------- state ----------
  var S = Object.assign({}, P.DEFAULTS);
  try { var saved = JSON.parse(N.loadSettings() || '{}'); S = Object.assign(S, saved); S.brands = Object.assign({}, P.DEFAULTS.brands, saved.brands || {}); } catch (e) {}
  function save() { N.saveSettings(JSON.stringify(S)); logSetup(); }
  // debug log: off unless turned on in Settings
  if (S.debug == null) S.debug = false;
  if (!S.logLevel) S.logLevel = 3;
  if (S.osmPreview == null) S.osmPreview = true;
  function logSetup() {
    if (!window.FLog) return;
    FLog.configure(S.debug ? S.logLevel : 0, N.saveLog ? { save: function (t) { N.saveLog(t); }, load: function () { return N.loadLog(); } } : null, [S.apiKey]);
  }
  logSetup();
  if (window.FLog) FLog.info('app', 'Started Fuel+ Map ' + (N.appVersion ? N.appVersion() : ''));

  var me = null;            // {lat,lng,acc}
  var stations = [];        // normalised
  var lastFetch = null;     // {ts, lat, lng, demo}
  var reqId = 0, pending = 0;
  var sortBy = 'price';
  var selectedId = null;
  var markers = {};
  var demo = false;

  // ---------- theme ----------
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var tiles;
  function applyTheme() {
    var dark = mq.matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    N.setStatusBarDark(dark);
    if (tiles) map.removeLayer(tiles);
    tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, className: 'osm-tiles',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
  }
  window.setInsets = function (t, b) {
    var r = document.documentElement.style;
    r.setProperty('--st', t + 'px'); r.setProperty('--sb', b + 'px');
  };

  // ---------- map ----------
  var map = L.map('map', { zoomControl: false, attributionControl: true, tap: false, zoomSnap: 0.5 }).setView([36.5, -92.5], 5);
  applyTheme();
  if (mq.addEventListener) mq.addEventListener('change', function () { applyTheme(); render(); });
  var meMarker = null, meCircle = null;
  var movedByUser = false;
  map.on('movestart', function (e) { if (e && e.originalEvent) movedByUser = true; });
  map.on('dragstart zoomstart', function () { movedByUser = true; });
  map.on('moveend', function () {
    if (!lastFetch || !movedByUser) return;
    var c = map.getCenter();
    var far = P.haversineMi(c.lat, c.lng, lastFetch.lat, lastFetch.lng) > Math.max(2, S.radiusMi * 0.45);
    $('btnArea').classList.toggle('hidden', !far);
  });
  map.on('click', function () { closeDetail(); setListOpen(false); });

  // ---------- grade selector ----------
  function buildGrades() {
    var g = $('grades'); g.innerHTML = '';
    Object.keys(P.GRADES).forEach(function (k) {
      var b = document.createElement('button');
      b.textContent = k === 'midgrade' ? 'Mid' : k === 'premium' ? 'Prem' : P.GRADES[k].label;
      b.className = S.grade === k ? 'on' : '';
      b.onclick = function () { S.grade = k; save(); buildGrades(); render(); if (selectedId) openDetail(selectedId); N.haptic(); };
      g.appendChild(b);
    });
  }

  // ---------- status / toast ----------
  function status(msg, err) { var s = $('status'); s.textContent = msg; s.classList.toggle('err', !!err); }
  var toastT;
  window.toast = function (msg) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.add('hidden'); }, 3200);
  };
  function ago(ts) {
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
  }
  function refreshStatus() {
    if (pending) return;
    if (!lastFetch) { status(me ? 'Ready' : 'Finding you…'); return; }
    var priced = stations.filter(function (s) { return s.prices[S.grade]; }).length;
    var msg = (demo ? 'DEMO data · ' : '') + stations.length + ' stations · ' + priced + ' priced · ' + ago(lastFetch.ts);
    if (!demo && S.apiKey) msg += ' · ' + N.callsThisMonth() + '/' + S.monthlyCap + ' calls';
    status(msg);
  }
  setInterval(refreshStatus, 30000);

  // ---------- location ----------
  var firstFix = true;
  window.onLocation = function (lat, lng, acc) {
    me = { lat: lat, lng: lng, acc: acc };
    $('btnLocate').classList.add('live');
    if (!meMarker) {
      meMarker = L.marker([lat, lng], { icon: L.divIcon({ className: 'pin', html: '<div class="me-dot" style="transform:translate(-50%,-50%)"></div>' }), interactive: false, zIndexOffset: -1000 }).addTo(map);
      meCircle = L.circle([lat, lng], { radius: acc, stroke: false, fillColor: '#1a73e8', fillOpacity: 0.10, interactive: false }).addTo(map);
    } else { meMarker.setLatLng([lat, lng]); meCircle.setLatLng([lat, lng]).setRadius(acc); }
    if (firstFix) {
      firstFix = false;
      movedByUser = false;
      map.setView([lat, lng], zoomForRadius(S.radiusMi));
      var fresh = lastFetch && (Date.now() - lastFetch.ts < 30 * 60000) && P.haversineMi(lat, lng, lastFetch.lat, lastFetch.lng) < 3;
      if (!fresh && (S.apiKey || demo || Object.keys(SITES).some(siteOn))) fetchAround(lat, lng);
      else render();
    } else render();
  };
  window.onLocationError = function (msg) { status(msg, true); };
  function zoomForRadius(mi) { return mi <= 3 ? 14 : mi <= 6 ? 13 : mi <= 12 ? 12 : mi <= 25 ? 11 : 10; }

  // ---------- fetching ----------
  function bbox(lat, lng, mi) {
    var dLat = mi / 69.0, dLng = mi / (69.17 * Math.cos(lat * Math.PI / 180));
    return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
  }
  // Sources, merged: Google Places (all brands) + each chain's own site (official pump prices).
  var SITES = {
    walmart: { label: 'Walmart', normalize: function (x) { return P.normalizeWalmart(x); }, max: 8 },
    murphy: { label: 'Murphy USA', normalize: function (x) { return P.normalizeMurphy(x); }, max: 25 }
  };
  function siteOn(k) { return !!S.brands[k] && S[k + 'Direct'] !== false && !!N.siteSearch; }
  var gStations = [], official = {}, errs = [];
  var pendingSources = 0, sitePending = {};
  function allOfficial() { var a = []; Object.keys(official).forEach(function (k) { a = a.concat(official[k] || []); }); return a; }
  function fetchAround(lat, lng, bounds) {
    $('btnArea').classList.add('hidden');
    $('wmCheck').classList.add('hidden');
    if (demo) { gStations = []; official = {}; receiveGoogle(window.demoPlaces(lat, lng), []); finish(lat, lng); return; }
    var sites = Object.keys(SITES).filter(siteOn);
    var useGoogle = !!S.apiKey;
    if (!useGoogle && !sites.length) { openSettings(true); return; }
    var b = bounds || bbox(lat, lng, S.radiusMi);
    var id = ++reqId; pending = id; errs = [];
    pendingSources = 0; sitePending = {};
    pendingCenter = { lat: lat, lng: lng };
    $('btnRefresh').classList.add('spin');
    status('Getting live prices…');
    if (useGoogle) {
      var queries = Object.keys(P.BRANDS).filter(function (k) { return S.brands[k]; }).map(function (k) { return P.BRANDS[k].query; });
      if (queries.length) { pendingSources++; N.search(id, S.apiKey, JSON.stringify(queries), b[0], b[1], b[2], b[3], Number(S.monthlyCap) || 0); }
    } else gStations = [];
    var radius = Math.min(Math.max(P.haversineMi(lat, lng, b[2], lng), 3), 30);
    sites.forEach(function (k) {
      pendingSources++; sitePending[k] = true;
      N.siteSearch(k, id, JSON.stringify({ lat: lat, lng: lng, radiusMi: radius, max: SITES[k].max }));
    });
    Object.keys(SITES).forEach(function (k) { if (sites.indexOf(k) < 0) official[k] = []; });
    if (!pendingSources) { finish(lat, lng); }
  }
  var pendingCenter = null;
  window.onSearchResult = function (id, res) {
    if (id !== reqId) return;
    receiveGoogle(res.places || [], res.errors || []);
    sourceDone();
  };
  window.onSiteResult = function (key, id, res) {
    if (window.__tripSite && window.__tripSite(key, id, res)) return;
    if (id !== reqId || !sitePending[key]) return;
    sitePending[key] = false;
    if (res.blocked) siteNeedsCheck(key);
    else if (res.error) errs.push(SITES[key].label + ' prices: ' + res.error);
    else official[key] = (res.stores || []).map(SITES[key].normalize).filter(Boolean);
    sourceDone();
  };
  window.onSiteBlocked = function (key) {
    if (pending && sitePending[key]) { sitePending[key] = false; siteNeedsCheck(key); sourceDone(); }
  };
  window.onSiteVerified = function () {
    var c = pendingCenter || me || map.getCenter();
    fetchAround(c.lat, c.lng);
  };
  var checkKey = null;
  function siteNeedsCheck(key) {
    errs.push(SITES[key].label + ' wants a quick “are you human?” check before showing prices.');
    checkKey = key;
    $('wmCheckTitle').textContent = SITES[key].label + ' wants a quick check';
    $('wmCheck').classList.remove('hidden');
  }
  function sourceDone() {
    pendingSources--;
    if (pendingSources > 0) { render(); return; }
    finish(pendingCenter.lat, pendingCenter.lng);
  }
  function receiveGoogle(places, errors) {
    var seen = {}, list = [];
    places.forEach(function (p) {
      var s = P.normalize(p);
      if (!s || seen[s.id] || !S.brands[s.brand]) return;
      seen[s.id] = 1; list.push(s);
    });
    if (list.length || !errors.length) gStations = list;
    errors.forEach(function (e) { errs.push(e); });
  }
  function finish(lat, lng) {
    pending = 0;
    $('btnRefresh').classList.remove('spin');
    stations = P.mergeOfficial(gStations, allOfficial()).filter(function (s) { return S.brands[s.brand]; });
    lastFetch = { ts: Date.now(), lat: lat, lng: lng, demo: demo };
    if (!demo) N.saveCache(JSON.stringify({ lastFetch: lastFetch, g: gStations, o: official }));
    movedByUser = false;
    render();
    if (errs.length) { status(errs[0], true); if (errs.length > 1) console.warn(errs); }
  }

  // ---------- computing & rendering ----------
  function enriched() {
    var ref = me || (lastFetch ? { lat: lastFetch.lat, lng: lastFetch.lng } : null);
    return stations.map(function (s) {
      var c = P.compute(s, S.grade, S, new Date());
      return { s: s, c: c, dist: ref ? P.haversineMi(ref.lat, ref.lng, s.lat, s.lng) : null };
    });
  }
  function priceHtml(v) { var f = P.fmtSign(v); return f.main + (f.tenth ? '<sup>' + f.tenth + '</sup>' : ''); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function shortAddr(a) { return String(a).split(',').slice(0, 2).join(','); }

  function render() {
    var list = enriched();
    var priced = list.filter(function (x) { return x.c; }).sort(function (a, b) { return a.c.final - b.c.final; });
    var bestIds = {}, bestVal = priced.length ? priced[0].c.final : null;
    priced.forEach(function (x) { if (x.c.final <= bestVal + 0.0005 && !x.c.stale) bestIds[x.s.id] = 1; });
    var rank = {}; priced.forEach(function (x, i) { rank[x.s.id] = i; });

    // markers
    var keep = {};
    list.forEach(function (x) {
      var s = x.s, br = P.BRANDS[s.brand]; keep[s.id] = 1;
      var cls = 'pin-in' + (x.c ? (bestIds[s.id] ? ' best' : '') + (x.c.stale ? ' stale' : '') : ' none') + (selectedId === s.id ? ' sel' : '');
      var html = '<div class="' + cls + '" style="--bc:' + br.color + '"><span class="b">' + br.short + '</span>' +
        '<span>' + (x.c ? priceHtml(x.c.final) : 'no price') + '</span></div>';
      var icon = L.divIcon({ className: 'pin', html: html, iconSize: null });
      var z = x.c ? 500 - (rank[s.id] || 0) : 0;
      if (markers[s.id]) { markers[s.id].setIcon(icon); markers[s.id].setZIndexOffset(z); }
      else {
        markers[s.id] = L.marker([s.lat, s.lng], { icon: icon, zIndexOffset: z, riseOnHover: true }).addTo(map)
          .on('click', function (e) { L.DomEvent.stopPropagation(e); N.haptic(); openDetail(s.id); });
      }
    });
    Object.keys(markers).forEach(function (id) { if (!keep[id]) { map.removeLayer(markers[id]); delete markers[id]; } });

    // list sheet
    var gl = P.GRADES[S.grade].label.toLowerCase();
    if (priced.length) {
      var b = priced[0];
      $('bestLine').innerHTML = 'Best ' + gl + ' <span class="big">' + priceHtml(b.c.final) + '</span><br><b>' + esc(P.BRANDS[b.s.brand].name) + '</b>' +
        (b.dist != null ? ' · ' + b.dist.toFixed(1) + ' mi' : '');
    } else {
      $('bestLine').innerHTML = stations.length ? 'No ' + gl + ' prices here yet' : (S.apiKey || demo ? 'No matching stations yet' : 'Walmart only — <b>add a Google key</b> for other brands');
    }
    var rows = list.slice().sort(function (a, b) {
      if (sortBy === 'dist') return (a.dist || 0) - (b.dist || 0);
      if (!a.c) return 1; if (!b.c) return -1; return a.c.final - b.c.final;
    });
    $('rows').innerHTML = rows.length ? rows.map(function (x) {
      var br = P.BRANDS[x.s.brand];
      return '<button class="row" data-id="' + esc(x.s.id) + '"><span class="badge" style="background:' + br.color + '">' + br.short + '</span>' +
        '<span class="mid"><div class="nm">' + esc(x.s.name) + '</div><div class="sub">' + (x.dist != null ? x.dist.toFixed(1) + ' mi · ' : '') + esc(shortAddr(x.s.address)) +
        (x.c && x.c.stale ? ' · <span style="color:var(--warn)">stale</span>' : '') + '</div></span>' +
        '<span class="pr">' + (x.c ? '<div class="f' + (bestIds[x.s.id] ? ' best' : '') + '">' + priceHtml(x.c.final) + '</div><div class="o">' + priceHtml(x.c.base) + '</div>' : '<div class="o" style="text-decoration:none">no price</div>') + '</span></button>';
    }).join('') : '<div class="empty">Stations will appear here.</div>';
    refreshStatus();
    sizeSheet();
  }
  $('rows').addEventListener('click', function (e) {
    var r = e.target.closest('.row'); if (!r) return;
    var s = byId(r.dataset.id); if (!s) return;
    map.setView([s.lat, s.lng], Math.max(map.getZoom(), 14));
    openDetail(s.id);
  });
  $('sort').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    sortBy = b.dataset.sort;
    Array.prototype.forEach.call($('sort').children, function (x) { x.classList.toggle('on', x === b); });
    setListOpen(true); render();
  });
  function setListOpen(open) { $('listSheet').classList.toggle('open', open); setTimeout(sizeSheet, 300); }
  $('listGrab').onclick = $('bestLine').onclick = function () { setListOpen(!$('listSheet').classList.contains('open')); };
  function sizeSheet() {
    var vis = $('detail').classList.contains('hidden') ? $('listSheet') : $('detail');
    var h = vis.getBoundingClientRect().height;
    var sb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sb')) || 0;
    document.documentElement.style.setProperty('--sheet-h', Math.max(0, h - sb) + 'px');
  }
  function byId(id) { for (var i = 0; i < stations.length; i++) if (stations[i].id === id) return stations[i]; return null; }

  // ---------- detail ----------
  function money(v, sign) {
    var a = Math.abs(v), s = '$' + P.fmt3(a);
    if (sign && v < 0) return '−' + s; if (sign && v > 0) return '+' + s; return s;
  }
  function openDetail(id) {
    var s = byId(id); if (!s) return;
    selectedId = id;
    var br = P.BRANDS[s.brand];
    var c = P.compute(s, S.grade, S, new Date());
    var ref = me || lastFetch;
    var dist = ref ? P.haversineMi(ref.lat, ref.lng, s.lat, s.lng) : null;
    var h = '<div class="grab"><span></span></div><div class="d-head"><span class="badge" style="background:' + br.color + '">' + br.short + '</span>' +
      '<div style="min-width:0"><h2>' + esc(s.name) + '</h2><div class="sub">' + (dist != null ? dist.toFixed(1) + ' mi away · ' : '') + esc(shortAddr(s.address)) + '</div></div>' +
      '<button class="x" id="dClose" aria-label="Close">✕</button></div>';
    if (c) {
      var saved = c.base - c.final;
      h += '<div class="final"><span class="v">' + priceHtml(c.final) + '</span><span class="l">/gal ' + P.GRADES[S.grade].label.toLowerCase() + '<br>your price</span></div>';
      h += '<div class="fresh' + (c.stale ? ' stale' : '') + '">' + (c.updated ? (s.source || 'Google') + ' price updated ' + ago(c.updated.getTime()) : 'Update time unknown') + (c.stale ? ' — may be out of date' : '') + '</div>';
      h += '<div class="bd">';
      c.steps.forEach(function (st) {
        h += '<div class="ln"><div class="k">' + esc(st.label) + (st.note ? '<small>' + esc(st.note) + '</small>' : '') + '</div><div class="a' + (st.amount < 0 ? ' neg' : '') + '">' +
          (st.kind === 'base' ? money(st.amount) : st.amount === 0 ? 'included' : money(st.amount, true)) + '</div></div>';
      });
      h += '<div class="ln tot"><div class="k">You pay per gallon</div><div class="a">' + money(c.final) + '</div></div></div>';
      if (saved > 0) h += '<span class="save-pill">Saves $' + (saved * 15).toFixed(2) + ' on 15 gal</span>';
      c.notes.forEach(function (n) { h += '<div class="note">' + esc(n) + '</div>'; });
      if (s.extra) h += '<div class="note">Also sold here: ' + esc(s.extra.label) + ' — $' + P.fmt3(s.extra.price) + ' posted.</div>';
    } else {
      h += '<div class="empty">No ' + P.GRADES[S.grade].label.toLowerCase() + ' price is published for this station (not on Google or the brand\'s site).</div>';
    }
    // all grades
    h += '<div class="grades">';
    Object.keys(P.GRADES).forEach(function (g) {
      var cg = P.compute(s, g, S, new Date());
      h += '<button data-g="' + g + '" class="' + (g === S.grade ? 'on' : '') + '"><div class="gl">' + P.GRADES[g].label + '</div><div class="gv">' + (cg ? priceHtml(cg.final) : '—') + '</div></button>';
    });
    h += '</div>';
    if (S.walmartPlus) h += '<div class="note"><b>How to get it:</b> ' + esc(br.howTo) + '</div>';
    h += '<div class="actions"><button class="btn primary" id="dNav"><svg viewBox="0 0 24 24"><path d="M21.71 11.29l-9-9a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42l9 9a1 1 0 0 0 1.42 0l9-9a1 1 0 0 0 0-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>Directions in Google Maps</button>' +
      '<div class="btn-row"><button class="btn tonal" id="dOther">Other maps app</button><button class="btn tonal" id="dPlace">' + (s.wmStoreId ? 'Walmart store page' : 'Google listing') + '</button></div></div>';
    var d = $('detail'); d.innerHTML = h; d.classList.remove('hidden'); d.scrollTop = 0;
    $('btnLocate').classList.add('hidden');
    $('listSheet').classList.add('hidden');
    $('dClose').onclick = closeDetail;
    $('dNav').onclick = function () { N.haptic(); N.navigate(s.lat, s.lng, String(s.id).indexOf('demo') === 0 ? '' : s.id, s.name); };
    $('dOther').onclick = function () { N.openInOtherApp(s.lat, s.lng, s.name); };
    $('dPlace').onclick = function () {
      N.openUrl(s.wmStoreId ? 'https://www.walmart.com/store/' + s.wmStoreId : (s.mapsUri || ('https://www.google.com/maps/search/?api=1&query=' + s.lat + ',' + s.lng)));
    };
    d.querySelector('.grades').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.grade = b.dataset.g; save(); buildGrades(); render(); openDetail(id);
    };
    render();
    setTimeout(sizeSheet, 250);
    // keep the pin visible above the sheet
    var pt = map.latLngToContainerPoint([s.lat, s.lng]);
    var sheetTop = window.innerHeight - d.getBoundingClientRect().height;
    if (pt.y > sheetTop - 40 || pt.y < 140) {
      var target = map.containerPointToLatLng([pt.x, pt.y]);
      var offset = (sheetTop / 2 + 40) - window.innerHeight / 2;
      var c2 = map.latLngToContainerPoint(target).subtract([0, offset]);
      map.panTo(map.containerPointToLatLng([window.innerWidth / 2, c2.y]), { animate: true });
    }
  }
  function closeDetail() {
    if ($('detail').classList.contains('hidden')) return false;
    $('detail').classList.add('hidden'); $('listSheet').classList.remove('hidden'); $('btnLocate').classList.remove('hidden');
    selectedId = null; render(); return true;
  }

  // ---------- settings ----------
  function sw(key, on) { return '<label class="switch"><input type="checkbox" data-k="' + key + '"' + (on ? ' checked' : '') + '><span></span></label>'; }
  function openSettings(onboarding) {
    var calls = N.callsThisMonth(), cap = Number(S.monthlyCap) || 0;
    var today = new Date().getDay(); // 2 = Tue, 5 = Fri
    var bonusToday = S.citgoBonusDate === P.todayKey() ? S.citgoBonus : 'none';
    var h = '<h1>' + (onboarding ? 'Set up Fuel+ Map' : 'Settings') + '</h1>';
    if (onboarding) h += '<p class="lead">Walmart and Murphy USA prices come straight from their own sites — no key needed. For Sam\'s, Exxon, Mobil and CITGO, add a free Google Places API key (optional), or try the demo first.</p>';
    h += '<div class="card"><h3>Google Places API key (optional)</h3>' +
      '<div class="field col"><input type="password" id="apiKey" placeholder="AIza…" autocomplete="off" spellcheck="false" value="' + esc(S.apiKey) + '"></div>' +
      '<ol class="steps"><li>Open <a href="#" data-url="https://console.cloud.google.com/apis/library/places.googleapis.com">Places API (New)</a> in Google Cloud and enable it (needs a billing account; 1,000 price lookups/month are free).</li>' +
      '<li><a href="#" data-url="https://console.cloud.google.com/apis/credentials">Create an API key</a>, restrict it to <b>Places API (New)</b> and to Android apps:</li></ol>' +
      '<div class="mono">package: ' + esc(N.packageName()) + '<br>SHA-1: ' + esc(fmtSha(N.certFingerprint())) + '</div>' +
      '<div class="field"><div class="lbl">API calls this month<small>Each refresh uses one call per brand (~6). Free tier: 1,000/month.</small><div class="meter"><i style="width:' + Math.min(100, cap ? calls / cap * 100 : 0) + '%"></i></div></div><b>' + calls + (cap ? '/' + cap : '') + '</b></div>' +
      '<div class="field"><div class="lbl">Monthly safety cap<small>Stops lookups past this count. If you and someone else share one key, split it (e.g. 450 each).</small></div><input type="number" id="monthlyCap" min="0" step="50" value="' + cap + '"></div></div>';

    h += '<div class="card"><h3>Discounts</h3>' +
      '<div class="field"><div class="lbl">Walmart+ member<small>10¢/gal off (5¢ in Alabama) at Walmart, Murphy, Exxon, Mobil, CITGO; member pricing at Sam\'s.</small></div>' + sw('walmartPlus', S.walmartPlus) + '</div>' +
      '<div class="field"><div class="lbl">Club CITGO status<small>Stacks with Walmart+ at CITGO. Club 3¢, Premier 6¢ (12 fills of 8+ gal in a quarter).</small></div><select id="citgoTier">' +
      opt('none', 'Not a member', S.citgoTier) + opt('club', 'Club (3¢)', S.citgoTier) + opt('premier', 'Premier (6¢)', S.citgoTier) + '</select></div>' +
      '<div class="field"><div class="lbl">CITGO bonus today<small>' + (today === 2 || today === 5 ? 'It\'s ' + (today === 2 ? 'Tuesday' : 'Friday') + ' — set this if the Club CITGO app shows today\'s bonus.' : 'Triple Tuesday / Friday Savings happen one day a month each; resets tomorrow.') + '</small></div><select id="citgoBonus">' +
      opt('none', 'None', bonusToday) + opt('friday', 'Friday +2¢', bonusToday) + opt('tuesday', 'Triple Tuesday ×3', bonusToday) + '</select></div>' +
      '<div class="field"><div class="lbl">Sam\'s Club price<small>Google normally shows Sam\'s member price, which Walmart+ gets you.</small></div><select id="samsMode">' +
      opt('member', 'Use as member price', S.samsMode) + opt('minus10', 'Take 10¢ off too', S.samsMode) + '</select></div>' +
      '<div class="field"><div class="lbl">Card cash back %<small>Optional; shown as its own line in the breakdown.</small></div><input type="number" id="cashbackPct" min="0" max="10" step="0.5" value="' + (S.cashbackPct || 0) + '"></div></div>';

    h += '<div class="card"><h3>Official price sources</h3>' +
      '<div class="field"><div class="lbl">Walmart (walmart.com)<small>Walmart\'s own store pages. Updated daily by Walmart.</small></div>' + sw('walmartDirect', S.walmartDirect !== false) + '</div>' +
      '<div class="field"><div class="lbl">Murphy USA (murphyusa.com)<small>Murphy\'s own store-finder map. Updated through the day.</small></div>' + sw('murphyDirect', S.murphyDirect !== false) + '</div>' +
      '<div class="field"><div class="lbl">Site checks<small>If a site asks “are you human?”, open it and complete the check yourself.</small></div>' +
      '<button class="btn tonal" style="width:auto;height:40px;padding:0 12px;margin:0" data-verify="walmart">Walmart</button>' +
      '<button class="btn tonal" style="width:auto;height:40px;padding:0 12px;margin:0" data-verify="murphy">Murphy</button></div>' +
      '<p class="lead" style="font-size:12.5px;margin:4px 0 10px">Google fills in the other brands (needs the key above). Official prices replace Google\'s when both exist.</p></div>';
    h += '<div class="card"><h3>Search</h3>' +
      '<div class="field"><div class="lbl">Search radius (miles)</div><input type="number" id="radiusMi" min="2" max="25" step="1" value="' + S.radiusMi + '"></div>' +
      '<div class="field"><div class="lbl">Mark prices stale after (hours)</div><input type="number" id="staleHours" min="1" max="168" step="1" value="' + S.staleHours + '"></div>';
    Object.keys(P.BRANDS).forEach(function (k) {
      h += '<div class="field"><div class="lbl">' + esc(P.BRANDS[k].name) + '</div>' + sw('brand:' + k, S.brands[k]) + '</div>';
    });
    h += '</div>';
    h += '<div class="card"><h3>Trip planner</h3>' +
      '<div class="field"><div class="lbl">Show cities when a route is imported<small>Free lookup from OpenStreetMap using each stop\'s spot (sends those coordinates to OpenStreetMap). No Google lookups.</small></div>' + sw('osmPreview', S.osmPreview !== false) + '</div></div>';
    h += '<div class="card"><h3>Debugging</h3>' +
      '<div class="field"><div class="lbl">Debug logging<small>Keeps a log on this phone you can share for troubleshooting. Your API key is never written to it.</small></div>' + sw('debug', !!S.debug) + '</div>' +
      '<div class="field"><div class="lbl">How much detail</div><select id="logLevel">' +
      [[1, 'Errors only'], [2, 'Errors + warnings'], [3, 'Steps'], [4, 'Details'], [5, 'Everything']].map(function (o) {
        return '<option value="' + o[0] + '"' + (S.logLevel === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><div class="lbl">Log<small id="logCount">' + (window.FLog ? FLog.entries().length : 0) + ' entries</small></div>' +
      '<button class="btn tonal" style="width:auto;height:40px;padding:0 12px;margin:0" id="sLogView">View</button>' +
      '<button class="btn tonal" style="width:auto;height:40px;padding:0 12px;margin:0" id="sLogShare">Share</button>' +
      '<button class="btn tonal" style="width:auto;height:40px;padding:0 12px;margin:0" id="sLogClear">Clear</button></div></div>';
    h += '<button class="btn primary" id="sDone">' + (onboarding ? 'Save & find gas' : 'Done') + '</button>';
    h += '<button class="btn tonal" id="sDemo">' + (demo ? 'Turn off demo data' : 'Try with demo data') + '</button>';
    h += '<p class="lead" style="margin-top:16px;font-size:12.5px">Prices: Google Maps (crowd/partner-sourced, not guaranteed). Discount rules as published by Walmart and CITGO, Oct 2026 — the Walmart app\'s Gas Savings page is the final word on which locations participate.</p>';
    var pg = $('settings'); pg.innerHTML = h; pg.classList.remove('hidden'); pg.scrollTop = 0;
    pg.querySelectorAll('a[data-url]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); N.openUrl(a.dataset.url); }; });
    $('sDone').onclick = function () { closeSettings(true); };
    $('sLogView').onclick = function () { showLog(); };
    $('sLogShare').onclick = function () { shareLog(); };
    $('sLogClear').onclick = function () { if (window.FLog) FLog.clear(); $('logCount').textContent = '0 entries'; toast('Log cleared.'); };
    pg.querySelectorAll('[data-verify]').forEach(function (bt) {
      bt.onclick = function () { closeSettings(false); if (N.siteVerify) N.siteVerify(bt.dataset.verify); };
    });
    $('sDemo').onclick = function () {
      demo = !demo; closeSettings(false);
      var c = me || map.getCenter(); stations = []; gStations = []; official = {}; lastFetch = null;
      if (demo) fetchAround(c.lat, c.lng); else { loadCache(); render(); }
    };
  }
  function logHeader() {
    return 'Fuel+ Map ' + (N.appVersion ? N.appVersion() : '') + ' debug log · ' + new Date().toString() + ' · level ' + S.logLevel + '\n';
  }
  function shareLog() {
    if (!window.FLog || !FLog.entries().length) { toast(S.debug ? 'The log is empty.' : 'Turn on Debug logging first.'); return; }
    N.shareText('Fuel+ Map debug log', logHeader() + FLog.text().slice(-300000));
  }
  function showLog() {
    var pg = $('logPage');
    if (!pg) { pg = document.createElement('section'); pg.id = 'logPage'; pg.className = 'page'; document.body.appendChild(pg); }
    var txt = window.FLog ? FLog.text() : '';
    pg.innerHTML = '<div class="t-head"><h1>Debug log</h1><button class="x" id="lgClose" aria-label="Close">✕</button></div>' +
      '<p class="lead small">' + (S.debug ? 'Newest at the bottom.' : 'Debug logging is off — turn it on in Settings to record.') + '</p>' +
      '<pre class="logtxt">' + esc(txt || '(empty)') + '</pre>' +
      '<div class="btn-row"><button class="btn tonal" id="lgShare">Share</button><button class="btn tonal" id="lgSave">Save to Downloads</button></div>';
    pg.classList.remove('hidden');
    var pre = pg.querySelector('.logtxt'); pre.scrollTop = pre.scrollHeight;
    $('lgClose').onclick = function () { pg.classList.add('hidden'); };
    $('lgShare').onclick = shareLog;
    $('lgSave').onclick = function () {
      var where = N.saveDownload('fuelplus-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt', 'text/plain', logHeader() + (txt || ''));
      toast(/^error/.test(where) ? 'Couldn\'t save: ' + where : 'Saved to ' + where);
    };
  }
  window.__showLog = showLog;
  function opt(v, label, cur) { return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>'; }
  function fmtSha(s) { return String(s).replace(/(..)(?!$)/g, '$1:'); }
  function closeSettings(apply) {
    var pg = $('settings'); if (pg.classList.contains('hidden')) return false;
    var hadKey = !!S.apiKey;
    S.apiKey = $('apiKey').value.trim();
    S.monthlyCap = Math.max(0, parseInt($('monthlyCap').value, 10) || 0);
    S.citgoTier = $('citgoTier').value;
    S.citgoBonus = $('citgoBonus').value; S.citgoBonusDate = P.todayKey();
    S.samsMode = $('samsMode').value;
    S.cashbackPct = Math.min(10, Math.max(0, parseFloat($('cashbackPct').value) || 0));
    S.radiusMi = Math.min(25, Math.max(2, parseFloat($('radiusMi').value) || 8));
    S.staleHours = Math.max(1, parseFloat($('staleHours').value) || 24);
    S.logLevel = parseInt($('logLevel').value, 10) || 3;
    pg.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      var k = cb.dataset.k;
      if (k.indexOf('brand:') === 0) S.brands[k.slice(6)] = cb.checked; else S[k] = cb.checked;
    });
    save();
    pg.classList.add('hidden');
    stations = stations.filter(function (s) { return S.brands[s.brand]; });
    render();
    if (selectedId) openDetail(selectedId);
    var firstSetup = !S.setupDone; S.setupDone = true; save();
    if (apply && !demo && ((S.apiKey && !hadKey) || (firstSetup && !lastFetch))) { var c = me || map.getCenter(); fetchAround(c.lat, c.lng); }
    return true;
  }

  // ---------- buttons ----------
  $('wmCheckGo').onclick = function () { $('wmCheck').classList.add('hidden'); if (checkKey && N.siteVerify) N.siteVerify(checkKey); };
  $('wmCheckX').onclick = function () { $('wmCheck').classList.add('hidden'); };
  $('btnSettings').onclick = function () { openSettings(false); };
  $('btnLocate').onclick = function () {
    N.haptic();
    if (me) { movedByUser = false; map.setView([me.lat, me.lng], Math.max(map.getZoom(), zoomForRadius(S.radiusMi))); $('btnArea').classList.add('hidden'); }
    N.locate();
  };
  $('btnRefresh').onclick = function () {
    N.haptic();
    var c = me || (lastFetch ? lastFetch : map.getCenter());
    if (movedByUser && !$('btnArea').classList.contains('hidden')) return $('btnArea').onclick();
    fetchAround(c.lat, c.lng);
  };
  $('btnArea').onclick = function () {
    var c = map.getCenter(), b = map.getBounds();
    // cap the box at ~25 mi each way so a zoomed-out map doesn't return a random sample
    var cap = bbox(c.lat, c.lng, 25);
    fetchAround(c.lat, c.lng, [Math.max(b.getSouth(), cap[0]), Math.max(b.getWest(), cap[1]), Math.min(b.getNorth(), cap[2]), Math.min(b.getEast(), cap[3])]);
  };
  window.onBack = function () { var lp = $('logPage'); if (lp && !lp.classList.contains('hidden')) { lp.classList.add('hidden'); return true; }
    return (window.__tripBack && window.__tripBack()) || closeSettings(true) || closeDetail() || (function () {
    if ($('listSheet').classList.contains('open')) { setListOpen(false); return true; } return false; })(); };

  // ---------- startup ----------
  function loadCache() {
    try {
      var c = JSON.parse(N.loadCache() || '{}');
      if (c.lastFetch && (c.g || c.o)) {
        gStations = c.g || []; official = c.o || {}; lastFetch = c.lastFetch;
        stations = P.mergeOfficial(gStations, allOfficial()).filter(function (s) { return S.brands[s.brand]; });
      }
    } catch (e) {}
  }
  buildGrades();
  loadCache();
  if (lastFetch) map.setView([lastFetch.lat, lastFetch.lng], zoomForRadius(S.radiusMi));
  render();
  if (!S.apiKey && !S.setupDone) openSettings(true);
  N.locate();
  window.addEventListener('resize', sizeSheet);
  window.__app = { S: S, save: save, N: N, map: map, P: P, $: $, status: status, esc: esc, priceHtml: priceHtml, ago: ago,
    me: function () { return me; }, siteOn: siteOn, closeDetail: closeDetail, refreshStatus: refreshStatus,
    openDetail: openDetail, openSettings: openSettings, setDemo: function (v) { demo = v; }, fetchAround: fetchAround, render: render };
})();
