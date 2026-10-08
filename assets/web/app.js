/* Gasket — UI logic. Talks to the Android shell through window.Native. */
(function () {
  'use strict';
  var P = window.Pricing;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- native bridge (with a browser stand-in for testing) ----------
  var N = window.Native || (function () {
    var mem = {};
    // a restored backup survives the restart, as it does in the app's storage
    try { var rs = sessionStorage.getItem('standinRestored'); if (rs) { mem = JSON.parse(rs); sessionStorage.removeItem('standinRestored'); } } catch (e) { }
    return {
      loadSettings: function () { return mem.s || ''; }, saveSettings: function (j) { mem.s = j; },
      loadCache: function () { return mem.c || ''; }, saveCache: function (j) { mem.c = j; },
      callsThisMonth: function () { return 0; }, certFingerprint: function () { return 'BROWSER-TEST'; },
      packageName: function () { return 'com.bensanzone.fuelmap'; },
      locate: function () { setTimeout(function () { window.onLocation(34.7695, -92.2671, 30); }, 300); },
      haptic: function () {}, setStatusBarDark: function () {},
      pickTextFile: function (req) { setTimeout(function () { var m = window.__mocks && window.__mocks.pick; window.onNativeResult(req, m ? { body: m } : { cancelled: true }); }, 30); },
      openUrl: function (u) { window.__lastUrl = u; },
      navigate: function (lat, lng, id) { console.log('navigate', lat, lng, id); window.__lastNav = [lat, lng, id]; },
      openInOtherApp: function (lat, lng) { console.log('geo', lat, lng); },
      siteSearch: function (key, req, argsJson) {
        var a = JSON.parse(argsJson), lat = a.lat, lng = a.lng;
        if (window.__siteMock) { var mr = window.__siteMock(key, a); if (mr) { window.onSiteProgress && onSiteProgress(key, req, 1, 2); return setTimeout(function () { window.onSiteResult(key, req, mr); }, (key === 'gmaps' && window.__gmapsDelay) || 60); } }
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
      siteRead: function (req, key, args) { window.__siteRead = (window.__siteRead || []).concat([{ key: key, url: JSON.parse(args).url }]); setTimeout(function () { var m = window.__mocks && window.__mocks.siteRead; window.onNativeResult(req, m ? m(key, JSON.parse(args)) : { error: 'No Native bridge' }); }, 80); },
      siteShow: function (req, key, args) { window.__siteShown = { key: key, url: JSON.parse(args).url }; setTimeout(function () { var m = window.__mocks && window.__mocks.siteShow; window.onNativeResult(req, m ? m(key, JSON.parse(args)) : { closed: true }); }, 60); },
      saveLog: function (t) { mem.log = t; }, loadLog: function () { return mem.log || ''; },
      shareText: function (subj, t) { window.__shared = { subject: subj, text: t }; },
      saveAndShare: function (req, name, mime, t, subj) { window.__saved = { name: name, text: t }; window.__shared = { subject: subj, file: name }; setTimeout(function () { window.onNativeResult(req, { path: 'Downloads/Gasket/' + name }); }, 30); },
      backupAll: function (req, name) { window.__backupName = name; setTimeout(function () { window.onNativeResult(req, { path: 'Downloads/Gasket/' + name, prefs: 5, kv: 42 }); }, 30); },
      pickAndRestore: function (req) { setTimeout(function () { window.onNativeResult(req, window.__mocks && window.__mocks.restoreFile ? standinRestore(window.__mocks.restoreFile) : window.__restoreMock || { cancelled: true }); }, 30); },
      saveDownload: function (name, mime, t) { window.__saved = { name: name, text: t }; return 'Downloads/Gasket/' + name; },
      appVersion: function () { return 'test'; },
      kvGet: function (ns, k) { var m = window.__kv = window.__kv || {}; return m[ns + '|' + k] || ''; },
      kvPut: function (ns, k, v) { var m = window.__kv = window.__kv || {}; m[ns + '|' + k] = v; },
      kvClear: function (ns) { var m = window.__kv = window.__kv || {}, n = 0; Object.keys(m).forEach(function (x) { if (x.indexOf(ns + '|') === 0) { delete m[x]; n++; } }); return n; },
      routeCallsThisMonth: function () { return 0; },
      placesFind: function (req, key, q, lat, lng, bias, radius) { setTimeout(function () { var m = window.__mocks && window.__mocks.find; window.onNativeResult(req, m ? { body: JSON.stringify(m(q, lat, lng, radius)) } : { error: 'No find mock' }); }, 50); },
      resolveLink: function (req, url) { setTimeout(function () { window.onNativeResult(req, (window.__mocks && window.__mocks.link) || { url: url }); }, 50); },
      fetchIcon: function (req, url) { setTimeout(function () { var m = window.__mocks && window.__mocks.icon; window.onNativeResult(req, m ? m(url) : { error: 'offline' }); }, 20); },
      fetchJson: function (req, url) { setTimeout(function () { var m = window.__mocks && (/nominatim/.test(url) ? window.__mocks.osm : /geo\.dot\.gov/.test(url) ? window.__mocks.hpms : /exxon\.com/.test(url) ? window.__mocks.xom : /nlr\.gov/.test(url) ? window.__mocks.afdc : /vpic\.nhtsa/.test(url) ? window.__mocks.vpic : /api\.nhtsa/.test(url) ? window.__mocks.recalls : window.__mocks.epa); window.onNativeResult(req, m ? { body: JSON.stringify(m(url)) } : { error: 'offline' }); }, 50); },
      computeRoute: function (req, key, body) { setTimeout(function () { var m = window.__mocks && window.__mocks.route; window.onNativeResult(req, m ? { body: JSON.stringify(m(JSON.parse(body))) } : { error: 'No route mock' }); }, 80); },
      routeSearch: function (req, key, jobs) { var jl = JSON.parse(jobs); window.__progSeen = []; jl.forEach(function (_, i) { setTimeout(function () { window.onNativeProgress && onNativeProgress(req, i, jl.length); window.__progSeen.push(document.getElementById('tNext') && document.getElementById('tNext').textContent); }, 5 * i); }); setTimeout(function () { var m = window.__mocks && window.__mocks.along; window.onNativeResult(req, m ? m(JSON.parse(jobs)) : { results: [], errors: [] }); }, 5 * jl.length + 40); },
      search: function (req, key, queries, lat1, lng1, lat2, lng2) { window.__searchCalls = (window.__searchCalls || 0) + 1; setTimeout(function () { var m = window.__mocks && window.__mocks.search; window.onSearchResult(req, m ? m(JSON.parse(queries), [lat1, lng1, lat2, lng2]) : { places: [], errors: ['No Native bridge'], calls: 0 }); }, 200); }
    };
    /** What MainActivity.readBackup does, for the browser: settings and the map cache from a full-backup file (any app's). */
    function standinRestore(text) {
      var d; try { d = JSON.parse(text); } catch (e) { return { error: 'That isn\'t a full backup file.' }; }
      if (!d || d.fullBackup !== 1 || !d.prefs) return { error: 'That isn\'t a full backup file.' };
      var p = d.prefs, kv = 0; Object.keys(d.kv || {}).forEach(function (ns) { kv += Object.keys(d.kv[ns]).length; });
      mem = { s: p.settings ? p.settings.v : '', c: p.cache ? p.cache.v : '' };
      try { sessionStorage.setItem('standinRestored', JSON.stringify(mem)); } catch (e) { }
      return { prefs: Object.keys(p).length, kv: kv, from: d.fromPackage || '' };
    }
  })();

  // ---------- state ----------
  var S = Object.assign({}, P.DEFAULTS);
  try { var saved = JSON.parse(N.loadSettings() || '{}'); S = Object.assign(S, saved); S.brands = Object.assign({}, P.DEFAULTS.brands, saved.brands || {}); } catch (e) {}
  S.blacklist = (S.blacklist || []).slice(); S.dieselRisk = Object.assign({}, S.dieselRisk || {});
  function save() { if (window.__restoring) return; N.saveSettings(JSON.stringify(S)); logSetup(); }   // a restore in progress owns the settings
  // debug log: off unless turned on in Settings
  if (S.debug == null) S.debug = false;
  if (!S.logLevel) S.logLevel = 3;
  if (S.osmPreview == null) S.osmPreview = true;
  function logSetup() {
    if (P.setCents) P.setCents(S.roundCents);
    if (!window.FLog) return;
    FLog.configure(S.debug ? S.logLevel : 0, N.saveLog ? { save: function (t) { N.saveLog(t); }, load: function () { return N.loadLog(); } } : null, [S.apiKey, S.nrelKey].filter(function (k) { return k && k !== 'DEMO_KEY'; }));
  }
  logSetup();
  if (window.FLog) FLog.info('app', 'Started Gasket ' + (N.appVersion ? N.appVersion() : ''));

  var me = null;            // {lat,lng,acc}
  var stations = [];        // normalised
  var lastFetch = null;     // {ts, lat, lng, demo}
  // the first start after restoring a full backup: show the restored prices, don't search (no Google lookups)
  var justRestored = location.hash === '#restored';
  if (justRestored) try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
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
  // stations: a dot on each (one canvas, shared with the trip map) and a price bubble beside it where there's room
  if (!map.getPane('tdots')) { var dpn = map.createPane('tdots'); dpn.style.zIndex = 590; }
  var dotsRenderer = L.canvas({ padding: 0.3, pane: 'tdots', tolerance: 8 });
  if (!map.getPane('tleaders')) { var lpn = map.createPane('tleaders'); lpn.style.zIndex = 585; lpn.style.pointerEvents = 'none'; }
  var dotLayer = L.layerGroup().addTo(map), bubLayer = L.layerGroup().addTo(map), leadLayer = L.layerGroup(), bubs = {}, bubOrder = [], bubT = 0;
  // the canvas is made once, now, so the first trip doesn't pay for it
  setTimeout(function () { L.circleMarker([0, 0], { renderer: dotsRenderer, pane: 'tdots', radius: 0, opacity: 0, fillOpacity: 0, interactive: false }).addTo(map); }, 600);
  map.on('movestart', function (e) { if (e && e.originalEvent) movedByUser = true; });
  map.on('dragstart zoomstart', function () { movedByUser = true; });
  map.on('moveend', function () {
    if (!lastFetch || !movedByUser) return;
    var c = map.getCenter();
    var far = P.haversineMi(c.lat, c.lng, lastFetch.lat, lastFetch.lng) > Math.max(2, S.radiusMi * 0.45);
    $('btnArea').classList.toggle('hidden', !far);
  });
  map.on('click', function () { closeDetail(); setListOpen(false); });
  map.on('zoomend moveend resize', function () { placeBubsSoon(); });

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
  /**
   * "Still working" over a map or any box: grayed out, with a progress bar and percentage. It only shows if the work
   * takes longer than 0.75 s — a CSS delay, so it appears even while the screen is busy. h.set(frac or null, label); h.done().
   */
  function loader(host, label, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'ld-ov' + (opts.fixed ? ' fixed' : '') + (opts.now ? ' now' : '');
    el.innerHTML = '<div class="ld-card"><div class="ld-lab"></div><div class="ld-row"><span class="ld-bar"><i></i></span><b class="ld-pct"></b></div></div>';
    host.appendChild(el);
    var h = {
      el: el, live: true,
      set: function (f, lab) {
        if (!h.live) return h;
        if (lab != null) el.querySelector('.ld-lab').textContent = lab;
        if (f == null) { el.classList.add('ind'); el.querySelector('.ld-pct').textContent = ''; return h; }
        var p = Math.max(0, Math.min(100, Math.round(f * 100)));
        el.classList.remove('ind'); el.querySelector('.ld-bar i').style.transform = 'scaleX(' + (p / 100) + ')'; el.querySelector('.ld-pct').textContent = p + '%';
        return h;
      },
      done: function () { if (!h.live) return; h.live = false; el.classList.add('out'); setTimeout(function () { el.remove(); }, 220); }
    };
    return h.set(opts.frac != null ? opts.frac : null, label || 'Loading');
  }
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
    status(msg);
  }
  setInterval(refreshStatus, 30000);
  /** Google lookups used this month, always in the top-left corner. */
  function apiCount() {
    var el = $('apiCount'); if (!el) return;
    var n = N.callsThisMonth(), cap = Number(S.monthlyCap) || 0;
    el.textContent = n + ' / ' + (cap || '∞');
    el.classList.toggle('hi', cap > 0 && n >= cap * 0.85);
  }
  window.__apiCount = apiCount;
  apiCount(); setInterval(apiCount, 4000);

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
      // prices on opening only if you turned that on (each search uses Google lookups); otherwise the last prices stay up
      if (!fresh && S.autoRefresh && !justRestored && (S.apiKey || demo || Object.keys(SITES).some(siteOn))) fetchAround(lat, lng);
      else { render(); if (!fresh && !demo) status(lastFetch ? 'Prices from ' + ago(lastFetch.ts) + ' · tap ↻ for fresh ones' : 'Tap ↻ to get prices nearby'); }
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
    if (key === 'nhtsa') { window.onNativeResult && window.onNativeResult(id, res); return; }   // a page shown with siteShow (Advisory)
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
    // which Exxon / Mobil stations take Walmart+ (free, from ExxonMobil's own station finder)
    if (window.__xom && !demo) window.__xom(gStations).then(function (n) {
      if (!n) return;
      stations = P.mergeOfficial(gStations, allOfficial()).filter(function (s) { return S.brands[s.brand]; });
      N.saveCache(JSON.stringify({ lastFetch: lastFetch, g: gStations, o: official })); render();
    }, function () {});
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

  function shown(x) { return x.c || !S.hideUnpriced || x.s.id === selectedId; }
  function render() {
    syncMain();
    var list = enriched().filter(shown);
    var priced = list.filter(function (x) { return x.c; }).sort(function (a, b) { return a.c.final - b.c.final; });
    var bestIds = {}, bestVal = priced.length ? priced[0].c.final : null;
    priced.forEach(function (x) { if (x.c.final <= bestVal + 0.0005 && !x.c.stale) bestIds[x.s.id] = 1; });
    var rank = {}; priced.forEach(function (x, i) { rank[x.s.id] = i; });

    drawStations(list, bestIds, rank);

    // list sheet
    var gl = P.GRADES[S.grade].label.toLowerCase();
    if (priced.length) {
      var b = priced[0];
      $('bestLine').innerHTML = 'Best ' + gl + ' <span class="big">' + priceHtml(b.c.final) + '</span><br><b>' + esc(P.displayName(b.s)) + '</b>' +
        (b.dist != null ? ' · ' + b.dist.toFixed(1) + ' mi' : '');
    } else {
      $('bestLine').innerHTML = stations.length ? 'No ' + gl + ' prices here yet' : (S.apiKey || demo ? 'No matching stations yet' : 'Walmart only — <b>add a Google key</b> for other brands');
    }
    var rows = list.slice().sort(function (a, b) {
      if (sortBy === 'dist') return (a.dist || 0) - (b.dist || 0);
      if (!a.c) return 1; if (!b.c) return -1; return a.c.final - b.c.final;
    });
    $('rows').innerHTML = rows.length ? rows.map(function (x) {
      return '<button class="row" data-id="' + esc(x.s.id) + '">' + badgeHtml(x.s.brand) +
        '<span class="mid"><div class="nm">' + esc(P.displayName(x.s)) + '</div><div class="sub">' + (x.dist != null ? x.dist.toFixed(1) + ' mi · ' : '') + esc(shortAddr(x.s.address)) +
        (x.c && x.c.stale ? ' · <span style="color:var(--warn)">stale</span>' : '') + '</div></span>' +
        '<span class="pr">' + (x.c ? '<div class="f' + (bestIds[x.s.id] ? ' best' : '') + '">' + priceHtml(x.c.final) + '</div><div class="o">' + priceHtml(x.c.base) + '</div>' : '<div class="o" style="text-decoration:none">no price</div>') + '</span></button>';
    }).join('') + (rows.some(function (x) { return x.s.google; }) ? gAttr() : '') : '<div class="empty">Stations will appear here.</div>';
    syncMapGAttr();
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
  function setListOpen(open) { $('listSheet').classList.toggle('open', open); setTimeout(function () { sizeSheet(); placeBubsSoon(); }, 300); }
  var listDragged = false;
  $('listGrab').onclick = $('bestLine').onclick = function () { if (listDragged) { listDragged = false; return; } setListOpen(!$('listSheet').classList.contains('open')); };
  // drag the list's handle (or its header) up and down; let go anywhere — near the bottom it closes
  (function () {
    var sh = $('listSheet'), rows = $('rows'), y0 = 0, h0 = 0, on = false, moved = false;
    var down = function (e) {
      if (e.button > 0 || (e.target.closest('button') && !e.target.closest('#listGrab')) || e.target.closest('#sort')) return;
      on = true; moved = false; y0 = e.clientY; h0 = sh.classList.contains('open') ? rows.getBoundingClientRect().height : 0;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { }
    };
    var move = function (e) {
      if (!on) return;
      var dy = e.clientY - y0;
      if (!moved && Math.abs(dy) < 6) return;
      if (!moved) { moved = true; sh.classList.add('dragging'); sh.classList.add('open'); }
      rows.style.maxHeight = Math.max(0, Math.min(innerHeight * 0.75, h0 - dy)) + 'px';
      sizeSheet(); e.preventDefault();
    };
    var up = function () {
      if (!on) return; on = false;
      if (!moved) return;
      listDragged = true; setTimeout(function () { listDragged = false; }, 350);
      var h = rows.getBoundingClientRect().height;
      sh.classList.remove('dragging'); rows.style.maxHeight = '';
      if (h < 70) { sh.style.removeProperty('--rows-h'); setListOpen(false); }
      else { sh.style.setProperty('--rows-h', Math.round(h) + 'px'); setListOpen(true); }
      placeBubsSoon();
    };
    [$('listGrab'), sh.querySelector('.list-head')].forEach(function (el) {
      if (!el) return;
      el.style.touchAction = 'none';
      el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  })();
  function sizeSheet() {
    var vis = $('detail').classList.contains('hidden') ? $('listSheet') : $('detail');
    var h = vis.getBoundingClientRect().height;
    var sb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sb')) || 0;
    document.documentElement.style.setProperty('--sheet-h', Math.max(0, h - sb) + 'px');
  }
  function byId(id) { for (var i = 0; i < stations.length; i++) if (stations[i].id === id) return stations[i]; return null; }

  // ---------- the main map: dots and price bubbles ----------
  function mainOn() { return !document.body.classList.contains('trip-on'); }
  /** Main-map stations show only when the trip planner isn't open (it draws its own). */
  function syncMain() {
    var on = mainOn();
    [dotLayer, bubLayer].forEach(function (g) { if (on && !map.hasLayer(g)) g.addTo(map); if (!on && map.hasLayer(g)) map.removeLayer(g); });
    if (on) placeBubsSoon();
  }
  function drawStations(list, bestIds, rank) {
    var css = getComputedStyle(document.documentElement), ring = css.getPropertyValue('--surface').trim() || '#ffffff', acc = css.getPropertyValue('--accent').trim() || '#1a73e8';
    dotLayer.clearLayers();
    // drawn so the cheapest end up on top: no price first, then most to least expensive, the selected one last
    var order = list.slice().sort(function (a, b) {
      var sa = a.s.id === selectedId, sb = b.s.id === selectedId; if (sa !== sb) return sa ? 1 : -1;
      if (!a.c || !b.c) return (a.c ? 1 : 0) - (b.c ? 1 : 0);
      return b.c.final - a.c.final;
    });
    var keep = {};
    order.forEach(function (x) {
      var s = x.s, br = P.brand(s.brand), sel = s.id === selectedId; keep[s.id] = 1;
      L.circleMarker([s.lat, s.lng], { renderer: dotsRenderer, pane: 'tdots', radius: sel ? 8 : 6, color: sel ? acc : ring, weight: sel ? 3 : 2,
        fillColor: br.color, fillOpacity: x.c ? 1 : 0.55, bubblingMouseEvents: false })
        .on('click', function () { N.haptic(); openDetail(s.id); }).addTo(dotLayer);
      var html = logoHtml(s.brand) + '<span class="pv">' + (x.c ? priceHtml(x.c.final) : 'no price') + '</span>';
      var cls = { best: !!(x.c && bestIds[s.id]), stale: !!(x.c && x.c.stale), none: !x.c, sel: sel };
      var b = bubs[s.id];
      if (!b) {
        b = bubs[s.id] = { tip: L.tooltip({ permanent: true, direction: 'top', offset: [0, -9], className: 'mbub', interactive: true, opacity: 1 }).setLatLng([s.lat, s.lng]), html: null };
        b.tip.setContent(html); b.html = html; bubLayer.addLayer(b.tip);
        var el = b.tip.getElement();
        if (el) { el.dataset.id = s.id; el.dataset.brand = s.brand; L.DomEvent.disableClickPropagation(el); el.addEventListener('click', function () { N.haptic(); openDetail(s.id); }); }
      } else if (b.html !== html) { b.tip.setContent(html); b.html = html; }
      var e2 = b.tip.getElement(); if (e2) Object.keys(cls).forEach(function (k) { e2.classList.toggle(k, cls[k]); });
    });
    Object.keys(bubs).forEach(function (id) { if (!keep[id]) { bubLayer.removeLayer(bubs[id].tip); delete bubs[id]; } });
    // who gets a bubble first when they're crowded: the one you tapped, then cheapest to dearest, then no price
    bubOrder = list.slice().sort(function (a, b) {
      var sa = a.s.id === selectedId, sb = b.s.id === selectedId; if (sa !== sb) return sa ? -1 : 1;
      if (!a.c || !b.c) return (b.c ? 1 : 0) - (a.c ? 1 : 0);
      return (a.c.stale - b.c.stale) || a.c.final - b.c.final;
    }).map(function (x) { return x.s.id; });
    placeBubsSoon();
  }
  function placeBubsSoon() { clearTimeout(bubT); bubT = setTimeout(placeBubs, 40); }
  function placeBubs() {
    if (!mainOn() || !window.Labels) return;
    var tips = bubOrder.filter(function (id) { return bubs[id]; }).map(function (id) { var b = bubs[id]; return { cands: [b.tip.getLatLng()], tip: b.tip, color: '#8a94a6' }; });
    if (!bubLayer.hasLayer(leadLayer)) bubLayer.addLayer(leadLayer);
    var sheet = $('detail').classList.contains('hidden') ? $('listSheet') : $('detail');
    var obst = Labels.rectsOf(map, [document.querySelector('.top'), $('status'), $('btnArea'), $('wmCheck'), $('btnTrip'), $('btnLocate'), $('btnAlt'), $('afLegend'), sheet, document.querySelector('.leaflet-control-attribution')].filter(Boolean), 6);
    Labels.place(map, tips, { obst: obst, hide: true, routeFree: false, passes: 1, repair: false, sep: 6, dists: [12, 28], angles: 8, leaders: leadLayer, leaderPane: 'tleaders' });
  }

  // ---------- brand logos ----------
  // Each brand's own icon (the favicon from its website), fetched once on this phone and kept; until then — or if
  // it can't be fetched — the brand's letter on its color.
  var LOGO = {}, LOGO_SITES = { walmart: 'www.walmart.com', murphy: 'www.murphyusa.com', sams: 'www.samsclub.com', exxon: 'www.exxon.com', mobil: 'www.mobil.com', citgo: 'www.citgo.com' };
  // an icon that won't draw (a bad download) quietly falls back to the letter
  var IMG_ERR = ' onerror="this.parentNode.classList.add(\'bad\')"';
  function logoHtml(brand) {
    var br = P.brand(brand), u = LOGO[brand];
    return '<span class="lg' + (u ? ' img' : '') + '" style="--bc:' + br.color + '">' + (u ? '<img src="' + u + '" alt=""' + IMG_ERR + '><i>' + esc(br.short) + '</i>' : esc(br.short)) + '</span>';
  }
  function badgeHtml(brand, cls) {
    var br = P.brand(brand), u = LOGO[brand];
    return '<span class="badge' + (u ? ' logo' : '') + (cls ? ' ' + cls : '') + '" style="--bc:' + br.color + ';background:' + (u ? '#fff' : br.color) + '">' + (u ? '<img src="' + u + '" alt=""' + IMG_ERR + '><i>' + esc(br.short) + '</i>' : esc(br.short)) + '</span>';
  }
  /**
   * Brand icons: kept on this phone once found. Any that are missing are looked up on the internet each time the app
   * starts (Google's and DuckDuckGo's icon services, then the brand's own site) — one at a time, each with its own
   * time limit, so a failure never holds anything else up; the letters stay until an icon arrives.
   */
  var logoRun = false;
  function loadLogos(tries) {
    try { Object.keys(LOGO_SITES).forEach(function (b) { var o = KV.get('logos', b); if (o && o.v && o.v.img) LOGO[b] = o.v.img; }); } catch (e) { }
    if (!N.fetchIcon || logoRun) return;
    if (!window.__trip || !window.__trip.call) { if ((tries || 0) < 40) setTimeout(function () { loadLogos((tries || 0) + 1); }, 250); return; }
    var todo = Object.keys(LOGO_SITES).filter(function (b) { return !LOGO[b]; });
    if (!todo.length) return;
    logoRun = true;
    var ask = function (url) {
      return Promise.race([
        window.__trip.call('fetchIcon', url).catch(function (e) { return { error: String(e) }; }),
        new Promise(function (r) { setTimeout(function () { r({ error: 'timed out' }); }, 15000); })
      ]);
    };
    var check = function (src) {   // does it actually draw as an image?
      return new Promise(function (r) { var im = new Image(); im.onload = function () { r(im.naturalWidth >= 16); }; im.onerror = function () { r(false); }; im.src = src; setTimeout(function () { r(false); }, 5000); });
    };
    (async function () {
      var got = 0, fails = [];
      for (var i = 0; i < todo.length; i++) {
        var b = todo[i], site = LOGO_SITES[b], dom = site.replace(/^www\./, ''), img = null;
        var urls = ['https://www.google.com/s2/favicons?domain=' + dom + '&sz=128', 'https://icons.duckduckgo.com/ip3/' + dom + '.ico',
          'https://' + site + '/apple-touch-icon.png', 'https://' + site + '/favicon.ico', 'https://' + site + '/'];   // last: the icon the home page links to
        for (var k = 0; k < urls.length && !img; k++) {
          try {
            var r = await ask(urls[k]);
            if (r && r.body && /^data:image\//.test(r.body) && Math.max(r.w || 0, r.h || 0) >= 24 && await check(r.body)) img = r.body;
            else fails.push(b + ': ' + (r && (r.error || (r.w + 'x' + r.h))) + ' (' + urls[k].split('/')[2] + ')');
          } catch (e) { fails.push(b + ': ' + e); }
        }
        if (img) { LOGO[b] = img; got++; try { KV.put('logos', b, { img: img }); } catch (e) { } }
      }
      logoRun = false;
      if (window.FLog) { if (got) FLog.info('app', 'Brand icons saved', got); if (fails.length) FLog.debug('app', 'Brand icon lookups that failed', fails); }
      if (got) try { render(); if (selectedId) openDetail(selectedId); if (window.__trip && window.__trip.relogo) window.__trip.relogo(); } catch (e) { }
    })().catch(function () { logoRun = false; });
  }

  // ---------- detail ----------
  function money(v, sign) {
    var a = Math.abs(v), s = '$' + P.fmt3(a);
    if (sign && v < 0) return '−' + s; if (sign && v > 0) return '+' + s; return s;
  }
  function openDetail(id) {
    var s = byId(id); if (!s) return;
    selectedId = id;
    var br = P.brand(s.brand);
    var c = P.compute(s, S.grade, S, new Date());
    var ref = me || lastFetch;
    var dist = ref ? P.haversineMi(ref.lat, ref.lng, s.lat, s.lng) : null;
    var h = '<div class="grab"><span></span></div><div class="d-head">' + badgeHtml(s.brand) +
      '<div style="min-width:0"><h2>' + esc(P.displayName(s)) + '</h2><div class="sub">' + (dist != null ? dist.toFixed(1) + ' mi away · ' : '') + esc(shortAddr(s.address)) + '</div></div>' +
      '<button class="x" id="dClose" aria-label="Close">✕</button></div>';
    if (c) {
      var saved = c.base - c.final;
      h += '<div class="final"><span class="v">' + priceHtml(c.final) + '</span><span class="l">/gal ' + P.GRADES[S.grade].label.toLowerCase() + '<br>your price</span></div>';
      h += '<div class="fresh' + (c.stale ? ' stale' : '') + '">' + (c.updated ? (s.source || 'Google') + ' price updated ' + ago(c.updated.getTime()) : 'Update time unknown') + (c.stale ? ' — may be out of date' : '') + '</div>';
      h += '<div class="bd">';
      c.steps.forEach(function (st) {
        h += '<div class="ln"><div class="k">' + esc(st.label) + (st.note ? '<small>' + esc(st.note) + '</small>' : '') + '</div><div class="a' + (st.amount < 0 ? ' neg' : '') + '">' +
          (st.kind === 'base' ? money(st.amount) : st.kind === 'none' ? 'not counted' : st.amount === 0 ? 'included' : money(st.amount, true)) + '</div></div>';
      });
      var info = c.notes.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') + (S.walmartPlus ? '<p><b>How to get it:</b> ' + esc(br.howTo) + '</p>' : '') +
        (s.extra ? '<p>Also sold here: ' + esc(s.extra.label) + ' — $' + P.fmt3(s.extra.price) + ' posted.</p>' : '');
      h += '<div class="ln tot"><div class="k">You pay per gallon' + (info ? ' ' + qBtn(info) : '') + '</div><div class="a">' + money(c.final) + '</div></div></div>';
      if (saved > 0) h += '<span class="save-pill">Saves $' + (saved * 15).toFixed(2) + ' on 15 gal</span>';
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
    h += blButtons(s, 'd', S.grade);
    h += '<div class="actions"><button class="btn primary" id="dNav"><svg viewBox="0 0 24 24"><path d="M21.71 11.29l-9-9a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42l9 9a1 1 0 0 0 1.42 0l9-9a1 1 0 0 0 0-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>Directions in Google Maps</button>' +
      '<div class="btn-row"><button class="btn tonal" id="dOther">Other maps app</button><button class="btn tonal" id="dPlace">' + (s.wmStoreId ? 'Walmart store page' : 'Google listing') + '</button></div></div>';
    if (s.google) h += gAttr('in-detail');
    var d = $('detail'); d.innerHTML = h; d.classList.remove('hidden'); d.scrollTop = 0;
    $('btnLocate').classList.add('hidden'); $('btnTrip').classList.add('hidden'); if ($('btnAlt')) $('btnAlt').classList.add('hidden');
    $('listSheet').classList.add('hidden');
    $('dClose').onclick = closeDetail;
    $('dNav').onclick = function () { N.haptic(); N.navigate(s.lat, s.lng, String(s.id).indexOf('demo') === 0 ? '' : s.id, s.name); };
    $('dOther').onclick = function () { N.openInOtherApp(s.lat, s.lng, s.name); };
    bindBl(s, 'd');
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
    $('detail').classList.add('hidden'); $('listSheet').classList.remove('hidden'); $('btnLocate').classList.remove('hidden'); $('btnTrip').classList.remove('hidden'); if ($('btnAlt')) $('btnAlt').classList.remove('hidden');
    selectedId = null; render(); return true;
  }

  // ---------- bad CITGO stations ----------
  // CITGOs where Walmart+ didn't work for you: no 10¢ there from then on. Kept in settings, shown in Settings →
  // Bad CITGO stations, and shareable (export / import; imports only ever add).
  var BL = {
    list: function () { return S.blacklist || (S.blacklist = []); },
    has: function (st) { return P.isBad(st, S); },
    same: function (a, b) { return (a.id && a.id === b.id) || (a.brand === b.brand && a.lat != null && b.lat != null && P.haversineMi(a.lat, a.lng, b.lat, b.lng) < 0.05); },
    entryOf: function (st) { return { id: st.id, name: st.name, address: st.address || '', brand: st.brand, lat: st.lat, lng: st.lng, t: Date.now() }; },
    add: function (st) {
      if (BL.has(st)) return;
      var e = BL.entryOf(st);
      BL.list().push(e); save(); BL.changed();
      undoToast('Added ' + st.name + ' to your bad CITGO list', function () { S.blacklist = BL.list().filter(function (x) { return x !== e; }); save(); BL.changed(); });
    },
    remove: function (st) {
      var gone = BL.list().filter(function (x) { return BL.same(x, st); });
      if (!gone.length) return;
      S.blacklist = BL.list().filter(function (x) { return gone.indexOf(x) < 0; }); save(); BL.changed();
      undoToast('Removed ' + (gone[0].name || 'station') + ' from your bad CITGO list', function () { gone.forEach(function (x) { BL.list().push(x); }); save(); BL.changed(); });
    },
    /** Count Walmart+ on CITGO diesel at this station anyway (your own risk). */
    dieselRisk: function (st, on) { S.dieselRisk = Object.assign({}, S.dieselRisk); if (on) S.dieselRisk[st.id] = true; else delete S.dieselRisk[st.id]; save(); BL.changed(); },
    changed: function () {
      render();
      if (selectedId && !$('detail').classList.contains('hidden')) openDetail(selectedId);
      if (window.__trip && window.__trip.blChanged) window.__trip.blChanged();
      if (!$('blPage').classList.contains('hidden')) drawBlPage();
    }
  };
  /** A message with an Undo button for a few seconds. */
  var undoT;
  function undoToast(msg, undo) {
    var u = $('undoBar');
    u.innerHTML = '<span>' + esc(msg) + '</span><button id="undoBtn">Undo</button>';
    u.classList.remove('hidden', 'gone'); clearTimeout(undoT);
    $('undoBtn').onclick = function () { clearTimeout(undoT); u.classList.add('hidden'); N.haptic && N.haptic(); undo(); };
    undoT = setTimeout(function () { u.classList.add('gone'); setTimeout(function () { u.classList.add('hidden'); }, 250); }, 5000);
  }
  window.undoToast = undoToast;
  /** Buttons for a station's details: mark / unmark a bad CITGO, and count Walmart+ on its diesel at your own risk. */
  function blButtons(st, idp, grade) {
    if (st.brand !== 'citgo') return '';
    var bad = BL.has(st), h = '<div class="bl-box">';
    if (bad) h += '<div class="bl-on"><span>On your bad CITGO list — no Walmart+ here.</span><button class="btn tonal sm" id="' + idp + 'BlRm">Remove</button></div>';
    else h += '<button class="btn tonal bl-add" id="' + idp + 'BlAdd">Didn\'t get Walmart+ here</button>';
    if (!bad && grade === 'diesel' && st.prices && st.prices.diesel) {   // only when you're buying diesel
      var on = !!(S.dieselRisk && S.dieselRisk[st.id]);
      h += '<label class="bl-risk"><input type="checkbox" id="' + idp + 'BlRisk"' + (on ? ' checked' : '') + '><span>Count Walmart+ on diesel here <small>at your own risk — CITGO diesel pumps often can\'t take it</small></span></label>';
    }
    return h + '</div>';
  }
  function bindBl(st, idp) {
    if ($(idp + 'BlAdd')) $(idp + 'BlAdd').onclick = function () { N.haptic && N.haptic(); BL.add(st); };
    if ($(idp + 'BlRm')) $(idp + 'BlRm').onclick = function () { N.haptic && N.haptic(); confirmDel({ title: 'Take this CITGO off your bad list?', body: esc(st.name || 'This station') + ' will get the Walmart+ discount again.', action: 'Remove' }).then(function (ok) { if (ok) BL.remove(st); }); };
    if ($(idp + 'BlRisk')) $(idp + 'BlRisk').onchange = function () { BL.dieselRisk(st, this.checked); };
  }
  /** Settings → Bad CITGO stations: each one opens on the map; ✕ takes it off the list. */
  function openBlPage() { drawBlPage(); $('blPage').classList.remove('hidden'); $('blPage').scrollTop = 0; }
  function drawBlPage() {
    var l = BL.list().slice().sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    var h = '<div class="pg-head"><button class="x" id="blBack" aria-label="Back">←</button><h1>Bad CITGO stations</h1></div>' +
      '<p class="lead">CITGOs where Walmart+ didn\'t work. They don\'t get the 10¢ in prices or trip plans. Tap one to see it on the map.</p>';
    h += l.length ? '<div class="card bl-list">' + l.map(function (e, i) {
      return '<div class="bl-row"><button class="bl-go" data-bl="' + i + '"><b>' + esc(e.name || 'CITGO') + '</b><small>' + esc(shortAddr(e.address || '')) + (e.t ? ' · added ' + new Date(e.t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '') + '</small></button>' +
        '<button class="x sm" data-blrm="' + i + '" aria-label="Remove from the list">✕</button></div>';
    }).join('') + '</div>' : '<div class="card empty-res">No bad stations yet. Mark one from a CITGO\'s details if Walmart+ doesn\'t work there.</div>';
    h += '<div class="card"><h3>Share the list ' + qBtn('Export saves the list to Downloads/Gasket and opens the share sheet. Importing only adds stations you don\'t already have — it never removes or changes yours.') + '</h3><div class="btns wrap bl-share"><button class="btn tonal sm" id="blExp">Export list</button><button class="btn tonal sm" id="blImp">Import a list</button>' + (l.length ? '<button class="btn tonal sm danger-sm" id="blDel">Delete all</button>' : '') + '</div></div>';
    var pg = $('blPage'); pg.innerHTML = h;
    $('blBack').onclick = function () { pg.classList.add('hidden'); };
    $('blExp').onclick = function () { exportData('blacklist'); };
    $('blImp').onclick = function () { importData('blacklist'); };
    if ($('blDel')) $('blDel').onclick = function () { askDeleteBl(); };
    pg.querySelectorAll('[data-bl]').forEach(function (b) { b.onclick = function () { showBad(l[+b.dataset.bl]); }; });
    pg.querySelectorAll('[data-blrm]').forEach(function (b) { b.onclick = function () { var e = l[+b.dataset.blrm]; confirmDel({ title: 'Take this CITGO off your bad list?', body: esc(e.name || 'This station') + ' will get the Walmart+ discount again.', action: 'Remove' }).then(function (ok) { if (ok) BL.remove(e); }); }; });
  }
  // ---------- Google Maps credit: Google's terms want it wherever its Places or Routes content shows ----------
  function gAttr(extra) { return '<div class="gattr' + (extra ? ' ' + extra : '') + '" role="note" aria-label="Google Maps">Google Maps</div>'; }
  var mapGAttr = false;
  /** On the map's own credit line while Google stations, or a trip (its route comes from Google), are on the map. */
  function syncMapGAttr() {
    var on = document.body.classList.contains('trip-on') || stations.some(function (s) { return s.google; });
    if (on === mapGAttr || !map.attributionControl) return;
    var a = '<span class="gattr in-map">Google Maps</span>';
    if (on) map.attributionControl.addAttribution(a); else map.attributionControl.removeAttribution(a);
    mapGAttr = on;
  }

  // ---------- licenses & credits (Settings -> About) ----------
  /** Just enough Markdown for LICENSE.md and THIRD_PARTY_NOTICES.md: headings, paragraphs, lists, **bold**, code blocks, links. */
  function mdHtml(md) {
    var out = [], para = [], list = [], code = null;
    var inline = function (t) {
      return esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/(https?:\/\/[^\s<)]+[^\s<).,])/g, '<a href="#" data-url="$1">$1</a>');
    };
    var flush = function () {
      if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
      if (list.length) { out.push('<ul>' + list.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>'); list = []; }
    };
    String(md || '').split('\n').forEach(function (ln) {
      if (code !== null) { if (/^```/.test(ln)) { out.push('<pre class="lic-pre">' + esc(code.join('\n')) + '</pre>'); code = null; } else code.push(ln); return; }
      if (/^```/.test(ln)) { flush(); code = []; return; }
      var m = /^(#{1,3})\s+(.*)$/.exec(ln);
      if (m) { flush(); out.push('<h' + (m[1].length + 1) + '>' + inline(m[2]) + '</h' + (m[1].length + 1) + '>'); return; }
      if (/^- /.test(ln)) { if (para.length) flush(); list.push(ln.slice(2)); return; }
      if (!ln.trim()) { flush(); return; }
      if (list.length) list[list.length - 1] += ' ' + ln.trim(); else para.push(ln.trim());
    });
    flush();
    return out.join('');
  }
  function openLicPage() {
    var L = window.LEGAL || {};
    var h = '<div class="pg-head"><button class="x" id="licBack" aria-label="Back">←</button><h1>Licenses & credits</h1></div>' +
      '<p class="lead">Gasket ' + esc(N.appVersion ? N.appVersion() : '') + '. The open-source code it includes and the data it uses, with their licenses.</p>' +
      '<div class="card lic-doc">' + mdHtml(L.notices) + '</div>' +
      '<div class="card lic-doc">' + mdHtml(L.license) + '</div>';
    var pg = $('licPage'); pg.innerHTML = h; pg.classList.remove('hidden'); pg.scrollTop = 0;
    $('licBack').onclick = function () { pg.classList.add('hidden'); };
    pg.querySelectorAll('a[data-url]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); N.openUrl(a.dataset.url); }; });
  }

  /** Close everything and show a bad station on the main map (its details if it's in the current results). */
  var badMarker = null;
  function showBad(e) {
    $('blPage').classList.add('hidden'); closeSettings(false);
    if (document.body.classList.contains('trip-on') && window.__trip && window.__trip.close) window.__trip.close();
    map.setView([e.lat, e.lng], 15, { animate: false });
    if (badMarker) { map.removeLayer(badMarker); badMarker = null; }
    var hit = stations.filter(function (x) { return BL.same(e, x); })[0];
    if (hit) { openDetail(hit.id); return; }
    badMarker = L.marker([e.lat, e.lng], { icon: L.divIcon({ className: 'pin', html: '<div class="pin-in bad"><span class="b" style="background:' + P.BRANDS.citgo.color + '">C</span>✕ W+</div>', iconSize: null }) }).addTo(map);
    var h = '<div class="grab"><span></span></div><div class="d-head"><span class="badge" style="background:' + P.BRANDS.citgo.color + '">C</span>' +
      '<div style="min-width:0"><h2>' + esc(e.name || 'CITGO') + '</h2><div class="sub">' + esc(shortAddr(e.address || '')) + '</div></div><button class="x" id="dClose" aria-label="Close">✕</button></div>' +
      '<div class="bl-box"><div class="bl-on"><span>On your bad CITGO list — no Walmart+ here.</span><button class="btn tonal sm" id="dBlRm">Remove</button></div></div>' +
      '<div class="actions"><button class="btn primary" id="dNav">Directions in Google Maps</button></div>';
    var d = $('detail'); d.innerHTML = h; d.classList.remove('hidden'); d.scrollTop = 0;
    $('btnLocate').classList.add('hidden'); $('btnTrip').classList.add('hidden'); if ($('btnAlt')) $('btnAlt').classList.add('hidden'); $('listSheet').classList.add('hidden');
    $('dClose').onclick = function () { closeDetail(); if (badMarker) { map.removeLayer(badMarker); badMarker = null; } };
    $('dNav').onclick = function () { N.navigate(e.lat, e.lng, e.id || '', e.name || 'CITGO'); };
    $('dBlRm').onclick = function () { confirmDel({ title: 'Take this CITGO off your bad list?', body: esc(e.name || 'This station') + ' will get the Walmart+ discount again.', action: 'Remove' }).then(function (ok) { if (ok) { BL.remove(e); $('dClose').onclick(); } }); };
  }

  var CACHE_NS = ['along', 'murphy', 'wmnodes', 'wmprice', 'limits', 'routes', 'routes2', 'mapsopts', 'find', 'xom', 'afdc', 'vin'];
  function askDeleteBl() {
    var n = BL.list().length; if (!n) { deleteBl(); return Promise.resolve(false); }
    return confirmDel({ title: 'Delete your bad CITGO list?', body: 'All ' + n + ' station' + (n === 1 ? '' : 's') + ' will get the Walmart+ discount again.', action: 'Delete' })
      .then(function (ok) { if (ok) deleteBl(); return ok; });
  }
  /**
   * Ask before deleting anything (Settings → General → Ask before deleting). o: {title, body (html), action}.
   * -> Promise<true to go ahead>. Off: always true at once.
   */
  function confirmDel(o) {
    if (S.confirmDeletes === false && !o.always) return Promise.resolve(true);   // always: a question that isn't about deleting
    return new Promise(function (resolve) {
      var old = $('cfm'); if (old) old.remove();
      var bg = document.createElement('div'); bg.className = 'cfm-bg'; bg.id = 'cfm';
      bg.innerHTML = '<div class="cfm" role="alertdialog" aria-modal="true" aria-labelledby="cfmT"><div class="cfm-t" id="cfmT">' + esc(o.title || 'Delete?') + '</div>' +
        (o.body ? '<div class="cfm-b">' + o.body + '</div>' : '') +
        '<div class="cfm-btns"><button class="btn tonal" id="cfmNo">Cancel</button><button class="btn cfm-go" id="cfmYes">' + esc(o.action || 'Delete') + '</button></div>' +
        (o.always ? '' : '<div class="cfm-hint">Turn these off in Settings → General.</div>') + '</div>';
      document.body.appendChild(bg);
      requestAnimationFrame(function () { bg.classList.add('on'); });
      var done = function (v) { window.__cfmClose = null; bg.classList.remove('on'); setTimeout(function () { bg.remove(); }, 160); resolve(v); };
      window.__cfmClose = function () { done(false); };
      bg.onclick = function (e) { if (e.target === bg) done(false); };
      $('cfmNo').onclick = function () { done(false); };
      $('cfmYes').onclick = function () { N.haptic && N.haptic(); done(true); };
    });
  }
  /** Empty the bad CITGO list (Undo puts it all back). */
  function deleteBl() {
    var was = BL.list().slice(); if (!was.length) { toast('Your bad CITGO list is already empty.'); return; }
    S.blacklist = []; save(); BL.changed();
    undoToast('Deleted ' + was.length + ' bad CITGO station' + (was.length === 1 ? '' : 's'), function () {
      was.forEach(function (e) { if (!BL.list().some(function (y) { return BL.same(y, e); })) BL.list().push(e); }); save(); BL.changed();
      if ($('blCount2')) $('blCount2').textContent = BL.list().length + ' station' + (BL.list().length === 1 ? '' : 's');
      if ($('blCount')) $('blCount').textContent = BL.list().length + ' station' + (BL.list().length === 1 ? '' : 's');
    });
  }
  /** Back to a fresh install (keeps this month's lookup count, so the safety cap still protects you). */
  function eraseAll() {
    CACHE_NS.concat(['trips', 'logos']).forEach(function (ns) { KV.clear(ns); });
    try { N.saveCache(''); } catch (e) { }
    try { N.saveSettings(''); } catch (e) { }
    if (window.FLog) FLog.clear();
    if (window.__eraseNoReload) { window.__erased = true; return; }
    location.reload();
  }

  // ---------- your data: export / import (imports only ever add) ----------
  function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }
  function exportData(kind) {
    var d = { gasketData: 1, kind: kind, app: N.appVersion ? N.appVersion() : '', exported: new Date().toISOString(), blacklist: BL.list() };
    if (kind === 'all') {
      var st = JSON.parse(JSON.stringify(S)); delete st.apiKey; delete st.nrelKey; delete st.blacklist;   // API keys are never exported
      d.settings = st;
      var idx = (KV.get('trips', 'index') || {}).v || [];
      d.trips = idx.map(function (x) { var o = KV.get('trips', 'trip|' + x.id); return o ? { entry: x, t: o.t, trip: o.v } : null; }).filter(Boolean);
    }
    var text = JSON.stringify(d), name = 'gasket-' + (kind === 'all' ? 'data' : 'bad-citgos') + '-' + stamp() + '.json';
    var where = N.saveDownload ? N.saveDownload(name, 'application/json', text) : '';
    if (kind !== 'all' || text.length < 300000) N.shareText('Gasket ' + (kind === 'all' ? 'data' : 'bad CITGO list'), text);
    toast(where && !/^error/.test(where) ? 'Saved to ' + where : kind === 'all' ? 'Couldn\'t save the file' + (where ? ' (' + where.replace(/^error: /, '') + ')' : '') : 'Shared the list');
  }
  /** Full backup: the native side writes every setting, saved answer, trip and lookup count straight to a file. */
  function fullBackup(btn) {
    if (!N.backupAll || !window.__trip) { toast('This needs the app.'); return; }
    btn.disabled = true; var lbl = btn.textContent; btn.textContent = 'Saving…';
    window.__trip.call('backupAll', 'gasket-full-backup-' + stamp() + '.json').then(function (r) {
      btn.disabled = false; btn.textContent = lbl;
      if (!r || r.error) { toast('Couldn\'t save the backup' + (r && r.error ? ': ' + r.error : '') + '.'); return; }
      toast('Saved to ' + r.path + ' (' + r.kv + ' saved items).');
      if (window.FLog) FLog.info('data', 'Full backup saved', { prefs: r.prefs, kv: r.kv });
    });
  }
  /** Restore a full backup: replaces everything, then restarts the page so it all loads from the restored data. */
  function fullRestore(btn) {
    if (!N.pickAndRestore || !window.__trip) { toast('This needs the app.'); return; }
    confirmDel({ title: 'Replace everything with a backup?', body: 'All settings, cars, trips and saved searches in this app are replaced by the backup you pick. This month\'s lookup counts keep the higher number.', action: 'Pick backup' }).then(function (ok) {
      if (!ok) return;
      window.__trip.call('pickAndRestore').then(function (r) {
        if (!r || r.cancelled) return;
        if (r.error) { toast('Couldn\'t restore: ' + r.error); return; }
        window.__restoring = true;                    // nothing may write the old settings back over the restored ones
        toast('Restored ' + r.prefs + ' settings and ' + r.kv + ' saved items. Restarting…');
        // '#restored' tells the restarted page not to search on opening, so a restore never uses Google lookups
        setTimeout(function () { location.hash = 'restored'; location.reload(); }, 900);
      });
    });
  }
  var pickN = 0, pickWait = {};
  function importData(kind) {
    if (!N.pickTextFile) { toast('Importing needs the app.'); return; }
    var id = 'p' + (++pickN);
    if (window.__trip && window.__trip.call) window.__trip.call('pickTextFile').then(function (res) { gotImport(kind, res); });
  }
  function gotImport(kind, res) {
    if (!res || res.cancelled) return;
    if (res.error) { toast('Couldn\'t read the file: ' + res.error); return; }
    var d; try { d = JSON.parse(res.body); } catch (e) { toast('That isn\'t a Gasket data file.'); return; }
    var r = mergeData(d, kind);
    if (!r) { toast('That isn\'t a Gasket data file.'); return; }
    save(); BL.changed();
    var parts = [];
    parts.push(r.bl + ' bad station' + (r.bl === 1 ? '' : 's') + ' added' + (r.blSkip ? ' (' + r.blSkip + ' already on your list)' : ''));
    if (kind === 'all') {
      if (r.cars) parts.push(r.cars + ' car' + (r.cars === 1 ? '' : 's'));
      if (r.trips) parts.push(r.trips + ' saved trip' + (r.trips === 1 ? '' : 's'));
      if (r.settings) parts.push(r.settings + ' setting' + (r.settings === 1 ? '' : 's') + ' you hadn\'t set');
    }
    toast('Imported: ' + parts.join(', ') + '.');
    if (window.FLog) FLog.info('data', 'Imported ' + kind, r);
  }
  /** Add what's new from an exported file; never overwrite or remove anything. -> counts, or null if it isn't one. */
  function mergeData(d, kind) {
    if (!d || (d.gasketData !== 1 && d.fuelPlusData !== 1)) return null;   // fuelPlusData: exports from Fuel+ Map
    var r = { bl: 0, blSkip: 0, cars: 0, trips: 0, settings: 0 };
    (Array.isArray(d.blacklist) ? d.blacklist : []).forEach(function (e) {
      if (!e || e.lat == null || e.lng == null || typeof e.lat !== 'number' || typeof e.lng !== 'number') return;
      var x = { id: String(e.id || ''), name: String(e.name || 'CITGO').slice(0, 120), address: String(e.address || '').slice(0, 200), brand: e.brand === 'citgo' ? 'citgo' : String(e.brand || 'citgo'), lat: e.lat, lng: e.lng, t: +e.t || Date.now() };
      if (BL.list().some(function (y) { return BL.same(y, x); })) { r.blSkip++; return; }
      BL.list().push(x); r.bl++;
    });
    if (kind !== 'all') return r;
    var st = d.settings && typeof d.settings === 'object' ? d.settings : {};
    // cars: ones you don't have (same id, or same year/make/model)
    (Array.isArray(st.cars) ? st.cars : []).forEach(function (c) {
      if (!c || !c.id) return;
      var dup = (S.cars || []).some(function (y) { return y.id === c.id || (c.year && y.year === c.year && y.make === c.make && y.model === c.model); });
      if (!dup) { (S.cars = S.cars || []).push(c); r.cars++; }
    });
    // diesel own-risk stations: add any you hadn't
    Object.keys(st.dieselRisk || {}).forEach(function (k) { if (!S.dieselRisk[k]) { S.dieselRisk[k] = true; r.settings++; } });
    // other settings: only ones you've never set
    Object.keys(st).forEach(function (k) {
      if (k === 'apiKey' || k === 'nrelKey' || k === 'cars' || k === 'blacklist' || k === 'dieselRisk' || k === 'carId') return;
      if (S[k] === undefined) { S[k] = st[k]; r.settings++; }
    });
    // saved trips you don't have
    var idx = (KV.get('trips', 'index') || {}).v || [];
    (Array.isArray(d.trips) ? d.trips : []).forEach(function (x) {
      if (!x || !x.entry || !x.entry.id || !x.trip) return;
      if (idx.some(function (y) { return y.id === x.entry.id; })) return;
      KV.put('trips', 'trip|' + x.entry.id, x.trip); idx.push(x.entry); r.trips++;
    });
    if (r.trips) { idx.sort(function (a, b) { return (b.t || 0) - (a.t || 0); }); KV.put('trips', 'index', idx); }
    return r;
  }
  window.__data = { mergeData: mergeData, exportData: exportData, BL: BL };

  // ---------- settings ----------
  function sw(key, on) { return '<label class="switch"><input type="checkbox" data-k="' + key + '"' + (on ? ' checked' : '') + '><span></span></label>'; }
  function openSettings(onboarding) {
    var calls = N.callsThisMonth(), cap = Number(S.monthlyCap) || 0;
    var mk = P.monthKey();
    var used = function (k) { return (S.citgoUsed || {})[k] === mk; };
    var h = '<h1>' + (onboarding ? 'Set up Gasket' : 'Settings') + '</h1>';
    if (onboarding) h += '<p class="lead">Walmart and Murphy USA prices come straight from their own sites — no key needed. For Sam\'s, Exxon, Mobil and CITGO, add a free Google Places API key (optional), or try the demo first.</p>';
    h += '<div class="card"><h3>Google Places API key (optional)</h3>' +
      '<div class="field col"><input type="password" id="apiKey" placeholder="AIza…" autocomplete="off" spellcheck="false" value="' + esc(S.apiKey) + '"></div>' +
      '<details class="alt-entry"><summary>How to get a key</summary><ol class="steps"><li>Open <a href="#" data-url="https://console.cloud.google.com/apis/library/places.googleapis.com">Places API (New)</a> in Google Cloud and enable it (needs a billing account; 1,000 price lookups/month are free).</li>' +
      '<li><a href="#" data-url="https://console.cloud.google.com/apis/credentials">Create an API key</a>, restrict it to <b>Places API (New)</b> and to Android apps:</li></ol>' +
      '<div class="mono">package: ' + esc(N.packageName()) + '<br>SHA-1: ' + esc(fmtSha(N.certFingerprint())) + '</div></details>' +
      '<div class="field"><div class="lbl">API calls this month<small>Each refresh uses one call per brand (~6). Free tier: 1,000/month.</small><div class="meter"><i style="width:' + Math.min(100, cap ? calls / cap * 100 : 0) + '%"></i></div></div><b>' + calls + (cap ? '/' + cap : '') + '</b></div>' +
      '<div class="field"><div class="lbl">Monthly safety cap<small>Stops lookups past this count. If you and someone else share one key, split it (e.g. 450 each).</small></div><input type="number" id="monthlyCap" min="0" step="50" value="' + cap + '"></div></div>';

    h += '<div class="card"><h3>General</h3>' +
      '<div class="field"><div class="lbl">Ask before deleting<small>A confirmation before anything is deleted or removed — cars, mileage entries, saved trips, lists, the cache.</small></div>' + sw('confirmDeletes', S.confirmDeletes !== false) + '</div></div>';
    h += '<div class="card"><h3>Discounts</h3>' +
      '<div class="field"><div class="lbl">Walmart+ member<small>10¢/gal off (5¢ in Alabama) at Walmart, Murphy, Exxon, Mobil, CITGO; member pricing at Sam\'s.</small></div>' + sw('walmartPlus', S.walmartPlus) + '</div>' +
      '<div class="field"><div class="lbl">Club CITGO status<small>Stacks with Walmart+ at CITGO. Club 3¢, Premier 6¢ (12 fills of 8+ gal in a quarter).</small></div><select id="citgoTier">' +
      opt('none', 'Not a member', S.citgoTier) + opt('club', 'Club (3¢)', S.citgoTier) + opt('premier', 'Premier (6¢)', S.citgoTier) + '</select></div>' +
      '<div class="field' + (S.citgoTier === 'none' ? ' hidden' : '') + '" id="citgoBonusRow"><div class="lbl">Monthly CITGO bonus used<small>Triple Tuesday (3× your reward) and Friday Savings (+2¢) apply on their own at CITGO on a Tuesday or Friday — once a month each, on your first fill that day. Tap one after you use it so it stops for the rest of the month.</small>' +
        '<small class="keep citgo-today">' + citgoToday() + '</small></div>' +
        '<div class="chips mini" id="citgoUsed"><button data-cu="tuesday" class="' + (used('tuesday') ? 'on' : '') + '">Tue</button><button data-cu="friday" class="' + (used('friday') ? 'on' : '') + '">Fri</button></div></div>' +
      '<div class="field"><div class="lbl">Sam\'s Club price<small>Google normally shows Sam\'s member price, which Walmart+ gets you.</small></div><select id="samsMode">' +
      opt('member', 'Use as member price', S.samsMode) + opt('minus10', 'Take 10¢ off too', S.samsMode) + '</select></div>' +
      '<div class="field"><div class="lbl">Card cash back %<small>Optional; shown as its own line in the breakdown.</small></div><input type="number" id="cashbackPct" min="0" max="10" step="0.5" value="' + (S.cashbackPct || 0) + '"></div></div>';

    h += '<div class="card"><h3>Official price sources</h3>' +
      '<div class="field"><div class="lbl">Walmart (walmart.com)<small>Walmart\'s own store pages. Updated daily by Walmart.</small></div>' + sw('walmartDirect', S.walmartDirect !== false) + '</div>' +
      '<div class="field"><div class="lbl">Murphy USA (murphyusa.com)<small>Murphy\'s own store-finder map. Updated through the day.</small></div>' + sw('murphyDirect', S.murphyDirect !== false) + '</div>' +
      '<div class="field"><div class="lbl">Site checks<small>If a site asks “are you human?”, open it and complete the check yourself.</small></div>' +
      '<div class="btns"><button class="btn tonal sm" data-verify="walmart">Walmart</button><button class="btn tonal sm" data-verify="murphy">Murphy</button></div></div>' +
      '<p class="lead" style="font-size:12.5px;margin:4px 0 10px">Google fills in the other brands (needs the key above). Official prices replace Google\'s when both exist.</p></div>';
    h += '<div class="card"><h3>Prices</h3>' +
      '<div class="field"><div class="lbl">Show prices to the cent<small>Rounded up — $3.199 shows as $3.20. Only changes how prices look; savings are still worked out exactly.</small></div>' + sw('roundCents', !!S.roundCents) + '</div></div>';
    h += '<div class="card"><h3>Search</h3>' +
      '<div class="field"><div class="lbl">Search radius (miles)</div><input type="number" id="radiusMi" min="2" max="25" step="1" value="' + S.radiusMi + '"></div>' +
      '<div class="field"><div class="lbl">Mark prices stale after (hours)</div><input type="number" id="staleHours" min="1" max="168" step="1" value="' + S.staleHours + '"></div>' +
      '<div class="field"><div class="lbl">Hide stations with no price<small>Only on the map and in the list. Trips still count them: where no priced station is in reach (very rural stretches), a station with no posted price can be a stop, at an estimated price.</small></div>' + sw('hideUnpriced', !!S.hideUnpriced) + '</div>';
    Object.keys(P.BRANDS).forEach(function (k) {
      h += '<div class="field"><div class="lbl">' + esc(P.BRANDS[k].name) + '</div>' + sw('brand:' + k, S.brands[k]) + '</div>';
    });
    h += '</div>';
    h += '<div class="card"><h3>Trip planner</h3>' +
      '<div class="field"><div class="lbl">Show cities when a route is imported<small>Free lookup from OpenStreetMap using each stop\'s spot (sends those coordinates to OpenStreetMap). No Google lookups.</small></div>' + sw('osmPreview', S.osmPreview !== false) + '</div>' +
      '<div class="field"><div class="lbl">Check which Exxon and Mobil stations take Walmart+<small>Free, from ExxonMobil\'s own station finder (sends the map area or route area to exxon.com). Stations it lists without Walmart+ don\'t get the 10¢. No Google lookups.</small></div>' + sw('xomCheck', S.xomCheck !== false) + '</div>' +
      '<div class="field"><div class="lbl">Look up posted speed limits<small>Free, from the Federal Highway Administration\'s road inventory (sends points along your route to geo.dot.gov). Off = state maximums only. No Google lookups.</small></div>' + sw('limitLookup', S.limitLookup !== false) + '</div>' +
      '<div class="field"><div class="lbl">Get prices when the app opens<small>Off: the map shows the last prices you got; tap ↻ (or Search this area) for fresh ones. On: searches nearby every time you open the app — uses Google lookups each time.</small></div>' + sw('autoRefresh', !!S.autoRefresh) + '</div>' +
      '<div class="field"><div class="lbl">Always get fresh prices when finding stops<small>Off: stations and prices already found along a route are reused for up to ' + S.staleHours + ' hours (faster, fewer Google lookups). On: search again every time.</small></div>' + sw('alwaysRefresh', !!S.alwaysRefresh) + '</div>' +
      '<div class="field"><div class="lbl">Trip history<small class="keep" id="histCount">' + histCount() + '</small></div><button class="btn tonal sm" id="histClear">Clear</button></div></div>';
    h += '<div class="card"><h3>EV & hydrogen</h3>' +
      '<div class="field col"><div class="lbl">Station finder key (optional)<small>EV chargers and hydrogen stations come from the U.S. Department of Energy\'s free station finder. Blank uses the shared DEMO_KEY (about 30 lookups an hour). A free key of your own: <a href="#" data-url="https://developer.nlr.gov/signup/">sign up</a>. Never logged or exported.</small></div><input type="password" id="nrelKey" placeholder="DEMO_KEY" autocomplete="off" spellcheck="false" value="' + esc(S.nrelKey || '') + '"></div>' +
      '<div class="field"><div class="lbl">Fast-charging price ($/kWh)<small>What you expect to pay at DC fast chargers — most don\'t publish prices to the finder. Typical: $0.40–0.60.</small></div><input type="number" id="evPrice" min="0" max="2" step="0.01" value="' + (S.evPrice || 0.48) + '"></div>' +
      '<div class="field"><div class="lbl">Hydrogen price ($/kg)<small>What you expect to pay. California stations have been around $30–36.</small></div><input type="number" id="h2Price" min="0" max="100" step="0.5" value="' + (S.h2Price || 36) + '"></div></div>';
    h += '<div class="card"><h3>Bad CITGO stations</h3>' +
      '<div class="field"><div class="lbl">Where Walmart+ didn\'t work<small class="keep" id="blCount">' + BL.list().length + ' station' + (BL.list().length === 1 ? '' : 's') + '</small></div><button class="btn tonal sm" id="blOpen">Manage</button></div></div>';
    h += '<div class="card"><h3>Your data</h3>' +
      '<div class="field col"><div class="lbl">Export<small>Saves a file to Downloads/Gasket you can share. Your API key is never included.</small></div><div class="btns wrap"><button class="btn tonal sm" id="exAll">All data</button><button class="btn tonal sm" id="exBl">Bad CITGO list</button></div></div>' +
      '<div class="field col"><div class="lbl">Import<small>Adds only what\'s new — duplicates are skipped and nothing of yours is overwritten.</small></div><div class="btns wrap"><button class="btn tonal sm" id="imAll">All data</button><button class="btn tonal sm" id="imBl">Bad CITGO list</button></div></div>' +
      '<div class="field col"><div class="lbl">Full backup (moving to a new install)<small class="keep">Everything, exactly as it is: settings <b>including your API keys</b>, cars, trips, all saved searches and prices, the bad CITGO list, the debug log and this month\'s Google lookup counts. Restoring replaces everything in the app, and lookup counts never go down, so your monthly cap still holds. Uses no lookups. Keep the file private — it has your keys.</small></div>' +
        '<div class="btns wrap"><button class="btn tonal sm" id="bkSave">Save full backup</button><button class="btn tonal sm" id="bkRestore">Restore full backup</button></div></div>' +
      '<div class="field"><div class="lbl">Clear cache<small>Stations, prices, speed limits, routes and Walmart+ station checks saved from recent searches, so the same route doesn\'t use Google lookups twice. Your trips, cars and settings stay.</small></div><button class="btn tonal sm" id="kvClear">Clear</button></div>' +
      '<div class="field"><div class="lbl">Delete bad CITGO list<small class="keep" id="blCount2">' + BL.list().length + ' station' + (BL.list().length === 1 ? '' : 's') + '</small></div><button class="btn tonal sm" id="blDelAll">Delete</button></div>' +
      '<div class="field"><div class="lbl">Erase all data<small>Settings, API key, cars, mileage log, trips, the bad CITGO list and the cache — like a fresh install. This month\'s lookup count is kept so your safety cap still works.</small></div><button class="btn tonal sm danger-sm" id="eraseAll">Erase</button></div></div>';
    h += '<div class="card"><h3>Debugging</h3>' +
      '<div class="field"><div class="lbl">Debug logging<small>Keeps a log on this phone you can share for troubleshooting. Your API key is never written to it.</small></div>' + sw('debug', !!S.debug) + '</div>' +
      '<div class="field"><div class="lbl">How much detail</div><select id="logLevel">' +
      [[1, 'Errors only'], [2, 'Errors + warnings'], [3, 'Steps'], [4, 'Details'], [5, 'Everything']].map(function (o) {
        return '<option value="' + o[0] + '"' + (S.logLevel === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><div class="lbl">Log<small class="keep" id="logCount">' + (window.FLog ? FLog.entries().length : 0) + ' entries</small></div>' +
      '<div class="btns"><button class="btn tonal sm" id="sLogView">View</button><button class="btn tonal sm" id="sLogShare">Share</button><button class="btn tonal sm" id="sLogClear">Clear</button></div></div></div>';
    h += '<div class="card"><h3>About</h3><div class="field"><div class="lbl">Gasket ' + esc(N.appVersion ? N.appVersion() : '') + '<small>The code this app includes and the data it uses, with their licenses.</small></div>' +
      '<button class="btn tonal sm" id="licOpen">Licenses & credits</button></div></div>';
    h += '<button class="btn primary" id="sDone">' + (onboarding ? 'Save & find gas' : 'Done') + '</button>';
    h += '<button class="btn tonal" id="sDemo">' + (demo ? 'Turn off demo data' : 'Try with demo data') + '</button>';
    h += '<p class="lead" style="margin-top:16px;font-size:12.5px">Prices: Google Maps (crowd/partner-sourced, not guaranteed). Discount rules as published by Walmart and CITGO, Oct 2026 — the Walmart app\'s Gas Savings page is the final word on which locations participate.</p>';
    var pg = $('settings'); pg.innerHTML = h; pg.classList.remove('hidden'); pg.scrollTop = 0;
    pg.querySelectorAll('a[data-url]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); N.openUrl(a.dataset.url); }; });
    $('sDone').onclick = function () { closeSettings(true); };
    $('sLogView').onclick = function () { showLog(); };
    $('blOpen').onclick = openBlPage;
    $('licOpen').onclick = openLicPage;
    $('exAll').onclick = function () { exportData('all'); };
    $('exBl').onclick = function () { exportData('blacklist'); };
    $('imAll').onclick = function () { importData('all'); };
    $('imBl').onclick = function () { importData('blacklist'); };
    $('bkSave').onclick = function () { fullBackup(this); };
    $('bkRestore').onclick = function () { fullRestore(this); };
    $('sLogShare').onclick = function () { shareLog(); };
    $('histClear').onclick = function () {
      var o = KV.get('trips', 'index'), n = o && o.v ? o.v.length : 0;
      if (!n) { toast('No saved trips.'); return; }
      confirmDel({ title: 'Clear your trip history?', body: 'Deletes ' + n + ' saved trip' + (n === 1 ? '' : 's') + '. Reopening one later would need new lookups.', action: 'Clear' }).then(function (ok) {
        if (!ok) return; KV.clear('trips'); $('histCount').textContent = histCount(); toast('Cleared ' + n + ' saved trip' + (n === 1 ? '' : 's') + '.');
      });
    };
    $('citgoTier').onchange = function () { $('citgoBonusRow').classList.toggle('hidden', this.value === 'none'); };
    $('citgoUsed').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      b.classList.toggle('on'); S.citgoUsed = Object.assign({}, S.citgoUsed); S.citgoUsed[b.dataset.cu] = b.classList.contains('on') ? P.monthKey() : '';
      document.querySelector('.citgo-today').textContent = citgoToday();
    };
    $('kvClear').onclick = function () {
      confirmDel({ title: 'Clear the cache?', body: 'Stations, prices, speed limits and routes saved from recent searches. Searching the same places again will use lookups. Your trips, cars and settings stay.', action: 'Clear' }).then(function (ok) {
        if (!ok) return; var n = 0; CACHE_NS.forEach(function (ns) { n += KV.clear(ns); }); toast('Cleared ' + n + ' saved answers.');
      });
    };
    $('blDelAll').onclick = function () { askDeleteBl().then(function (ok) { if (ok) { $('blCount2').textContent = '0 stations'; $('blCount').textContent = '0 stations'; } }); };
    $('eraseAll').onclick = function () {
      var b = this;
      if (S.confirmDeletes !== false) {
        confirmDel({ title: 'Erase all your data?', body: 'Settings, API keys, cars, mileage log, trips, the bad CITGO list and the cache — like a fresh install. This can\'t be undone.', action: 'Erase everything' }).then(function (ok) { if (ok) eraseAll(); });
        return;
      }
      if (!b.classList.contains('armed')) {       // two taps: the first one only asks
        b.classList.add('armed'); b.textContent = 'Tap again to erase';
        setTimeout(function () { b.classList.remove('armed'); b.textContent = 'Erase'; }, 4000);
        return;
      }
      eraseAll();
    };
    $('sLogClear').onclick = function () {
      confirmDel({ title: 'Clear the debug log?', action: 'Clear' }).then(function (ok) { if (!ok) return; if (window.FLog) FLog.clear(); $('logCount').textContent = '0 entries'; toast('Log cleared.'); });
    };
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
    return 'Gasket ' + (N.appVersion ? N.appVersion() : '') + ' debug log · ' + new Date().toString() + ' · level ' + S.logLevel + '\n';
  }
  function shareLog() {
    if (!window.FLog || !FLog.entries().length) { toast(S.debug ? 'The log is empty.' : 'Turn on Debug logging first.'); return; }
    shareFile('gasket-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt', 'text/plain', logHeader() + FLog.text().slice(-300000), 'Gasket debug log');
  }
  /** Save a big text file and offer it to other apps as a file (in the background — the app never waits on it). */
  function shareFile(name, mime, text, subject, btn) {
    if (btn) { btn.disabled = true; btn.dataset.lbl = btn.dataset.lbl || btn.textContent; btn.textContent = 'Saving…'; }
    var done = function (r) {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.lbl; }
      if (r && r.error) toast('Couldn\'t save: ' + r.error); else if (r && r.path) toast('Saved to ' + r.path);
    };
    if (N.saveAndShare && window.__trip && window.__trip.call) return window.__trip.call('saveAndShare', name, mime, text, subject).then(done, function (e) { done({ error: String(e) }); });
    N.shareText(subject, text.slice(0, 100000)); done(null);   // older app: text only
  }
  window.__shareFile = shareFile;
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
      var where = N.saveDownload('gasket-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt', 'text/plain', logHeader() + (txt || ''));
      toast(/^error/.test(where) ? 'Couldn\'t save: ' + where : 'Saved to ' + where);
    };
  }
  window.__showLog = showLog;
  function histCount() { var o = KV && KV.get('trips', 'index'), n = o && o.v ? o.v.length : 0; return n ? n + ' saved trip' + (n === 1 ? '' : 's') + ' — reopen them with no lookups' : 'No saved trips yet'; }
  function citgoToday() {
    var d = new Date().getDay(), b = P.citgoBonus(S, new Date());
    if (d !== 2 && d !== 5) return '';
    var name = d === 2 ? 'Triple Tuesday' : 'Friday Savings';
    return b === 'none' ? 'Today: ' + name + ' already used.' : 'Today: ' + name + ' applies.';
  }
  function opt(v, label, cur) { return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>'; }
  function fmtSha(s) { return String(s).replace(/(..)(?!$)/g, '$1:'); }
  function closeSettings(apply) {
    var pg = $('settings'); if (pg.classList.contains('hidden')) return false;
    var hadKey = !!S.apiKey;
    S.apiKey = $('apiKey').value.trim();
    S.monthlyCap = Math.max(0, parseInt($('monthlyCap').value, 10) || 0);
    S.citgoTier = $('citgoTier').value;
    S.samsMode = $('samsMode').value;
    S.cashbackPct = Math.min(10, Math.max(0, parseFloat($('cashbackPct').value) || 0));
    S.radiusMi = Math.min(25, Math.max(2, parseFloat($('radiusMi').value) || 8));
    S.staleHours = Math.max(1, parseFloat($('staleHours').value) || 24);
    S.logLevel = parseInt($('logLevel').value, 10) || 3;
    S.nrelKey = $('nrelKey').value.trim();
    S.evPrice = Math.max(0, parseFloat($('evPrice').value) || 0.48);
    S.h2Price = Math.max(0, parseFloat($('h2Price').value) || 36);
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
  window.onBack = function () { if (window.__cfmClose) { window.__cfmClose(); return true; } if (document.querySelector('.qpop')) { window.__closeQ(); return true; } var lp = $('logPage'); if (lp && !lp.classList.contains('hidden')) { lp.classList.add('hidden'); return true; }
    if (!$('blPage').classList.contains('hidden')) { $('blPage').classList.add('hidden'); return true; }
    if (!$('licPage').classList.contains('hidden')) { $('licPage').classList.add('hidden'); return true; }
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
  setTimeout(function () { loadLogos(); }, 0);
  /** Saved answers (searches, speed limits, routes) in the app's private storage: {t: saved ms, v: value}. */
  var KV = {
    get: function (ns, key, maxAgeMs) {
      try { if (!N.kvGet) return null; var s = N.kvGet(ns, key); if (!s) return null; var o = JSON.parse(s); return maxAgeMs && Date.now() - o.t > maxAgeMs ? null : o; } catch (e) { return null; }
    },
    put: function (ns, key, v) { try { if (N.kvPut) N.kvPut(ns, key, JSON.stringify({ t: Date.now(), v: v })); } catch (e) { } },
    clear: function (ns) { try { return N.kvClear ? N.kvClear(ns) : 0; } catch (e) { return 0; } }
  };
  // ---------- quiet UI: explanations live behind a small (?) instead of filling the screen ----------
  // Hint text under labels and explanatory paragraphs become a circled ? that shows the text when tapped.
  // Warnings (.msg, .note, .warn) and anything marked .keep stay on screen.
  function qBtn(html) { return '<button type="button" class="qi" aria-label="More info" data-q="' + encodeURIComponent(html) + '">?</button>'; }
  function qify(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.lbl > small, .nf > span > small, .sub-h > small, .switch-row small').forEach(function (sm) {
      if (sm.closest('.keep') || sm.dataset.qd || !sm.textContent.trim() || /&nbsp;/.test(sm.innerHTML) && !sm.textContent.trim()) return;
      var host = sm.parentElement;
      sm.dataset.qd = 1;
      // a label over a text box: the (?) goes inside the box, on the right
      var box = host.closest('.nf, .field.col'), ctl = box && box.querySelector('input:not([type=checkbox]):not([type=range]):not([type=datetime-local]), textarea');
      if (ctl && !ctl.closest('.in-q')) {
        var wrap = document.createElement('span'); wrap.className = 'in-q' + (ctl.tagName === 'TEXTAREA' ? ' ta' : '');
        ctl.parentNode.insertBefore(wrap, ctl); wrap.appendChild(ctl);
        wrap.insertAdjacentHTML('beforeend', qBtn(sm.innerHTML));
        sm.remove(); return;
      }
      sm.insertAdjacentHTML('beforebegin', qBtn(sm.innerHTML));
      sm.remove();
      host.classList.add('has-q');
    });
    root.querySelectorAll('.lead.small:not(.keep), .disclaimer:not(.keep), p.lead.intro').forEach(function (el) {
      if (el.dataset.qd || !el.textContent.trim()) return;
      el.dataset.qd = 1;
      var prev = el.previousElementSibling, html = el.innerHTML;
      // several explanation lines in a row share one (?)
      if (prev && prev.classList.contains('qline') && !el.classList.contains('disclaimer')) {
        var qb = prev.querySelector('.qi'); qb.dataset.q = encodeURIComponent(decodeURIComponent(qb.dataset.q) + '<p>' + html + '</p>'); el.remove(); return;
      }
      html = '<p>' + html + '</p>';
      var okPrev = prev && !prev.matches('.kpis, .epa-tiles, .grid2, .grid3, .btn-row, .alts-pick, .rmap, .leaflet-container, input, select, textarea, .spd-chart, svg, .buf-track, .buf-scale, .actions, .chips, .stop, .scard, details, .leg, .road-g, .road-tog, .parse-load') && !prev.querySelector('input[type=range]');
      if (prev && prev.matches('.lead.keep') && !prev.querySelector('.qi') && !prev.querySelector('input, button')) { prev.insertAdjacentHTML('beforeend', ' ' + qBtn(html)); prev.classList.add('has-q'); el.remove(); return; }
      if (okPrev && prev.children.length < 12 && !prev.classList.contains('keep') && !prev.matches('.lead, .msg, .note')) { prev.insertAdjacentHTML('beforeend', ' ' + qBtn(html)); prev.classList.add('has-q'); el.remove(); return; }
      // otherwise: the (?) on the section's heading, so there's no extra "Details" row
      var hd = null;
      for (var sib = el.previousElementSibling, n = 0; sib && n < 25 && !hd; sib = sib.previousElementSibling, n++) {
        if (sib.matches('h3, .sub-h, .tb-h, .adj-h, .t-title, summary')) hd = sib;
        else if (sib.querySelector) hd = sib.querySelector(':scope > h3, :scope > .tb-h, :scope > .adj-h, :scope .t-title');
      }
      if (!hd && el.parentElement) hd = el.parentElement.querySelector(':scope > h3, :scope > .tb-h, :scope > .sub-h, :scope > summary');
      if (hd) {
        var q0 = hd.querySelector(':scope > .qi');
        if (q0) q0.dataset.q = encodeURIComponent(decodeURIComponent(q0.dataset.q) + html);
        else { hd.insertAdjacentHTML('beforeend', ' ' + qBtn(html)); hd.classList.add('has-q'); }
        el.remove(); return;
      }
      el.outerHTML = '<div class="qline">' + qBtn(html) + '<span>' + (el.classList.contains('disclaimer') ? 'About these estimates' : 'Details') + '</span></div>';
    });
  }
  // (?) opens a small floating card above everything (never pushes the layout around); tap anywhere or scroll to close
  var qpop = null, qFrom = null;
  function closeQ() { if (qpop) { qpop.remove(); qpop = null; } if (qFrom) { qFrom.classList.remove('on'); qFrom = null; } }
  function openQ(b) {
    closeQ();
    qpop = document.createElement('div'); qpop.className = 'qpop'; qpop.setAttribute('role', 'dialog');
    qpop.innerHTML = '<div class="qpop-in">' + decodeURIComponent(b.dataset.q || '') + '</div><i class="qpop-tail"></i>';
    document.body.appendChild(qpop); qFrom = b; b.classList.add('on');
    var r = b.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight, m = 12;
    var w = Math.min(340, W - 2 * m); qpop.style.width = w + 'px';
    var left = Math.max(m, Math.min(W - m - w, r.left + r.width / 2 - w / 2));
    var ph = qpop.offsetHeight, below = r.bottom + 10 + ph <= H - m || r.top - 10 - ph < m;
    var top = below ? r.bottom + 10 : r.top - 10 - ph;
    qpop.style.left = left + 'px'; qpop.style.top = Math.max(m, top) + 'px';
    qpop.classList.add(below ? 'below' : 'above');
    qpop.querySelector('.qpop-tail').style.left = Math.max(14, Math.min(w - 14, r.left + r.width / 2 - left)) + 'px';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.qi');
    if (!b) { if (qpop && !qpop.contains(e.target)) closeQ(); return; }
    e.preventDefault(); e.stopPropagation();
    if (qFrom === b) { closeQ(); return; }
    openQ(b);
  }, true);
  document.addEventListener('scroll', function () { closeQ(); }, true);
  window.addEventListener('resize', closeQ);
  window.__closeQ = closeQ;
  new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) qify(n.parentElement || n); }); }); })
    .observe(document.body, { childList: true, subtree: true });
  qify(document.body);

  window.__app = { gAttr: gAttr, syncMapGAttr: syncMapGAttr, bl: { buttons: blButtons, bind: bindBl, has: function (st) { return BL.has(st); } }, qBtn: qBtn, KV: KV, S: S, save: save, N: N, map: map, P: P, $: $, status: status, esc: esc, priceHtml: priceHtml, ago: ago,
    me: function () { return me; }, stations: function () { return stations; }, siteOn: siteOn, closeDetail: closeDetail, refreshStatus: refreshStatus,
    openDetail: openDetail, openSettings: openSettings, setDemo: function (v) { demo = v; }, fetchAround: fetchAround, render: render,
    logoHtml: logoHtml, badgeHtml: badgeHtml, confirmDel: confirmDel, toast: function (m) { toast(m); }, dotsRenderer: dotsRenderer, syncMain: syncMain, loader: loader, reloadLogos: function () { LOGO = {}; logoRun = false; try { KV.clear('logos'); } catch (e) { } loadLogos(); } };
})();
