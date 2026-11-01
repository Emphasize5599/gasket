// Runs inside the app's off-screen copy of maps.campendium.com (free public camping map), signed out.
// Read the signed-out map's observed local /api/v2/tiles GeoJSON requests at its current zoom.
// Global recommendations/sponsored markers are not local search results. Only Public Land/RV Park features qualify.
// place_detail.pets is a policy flag; place_detail.price is a category, never a dollar tariff.
// Keep response-shape diagnostics to identify future provider changes. No sign-in or challenge bypass.
// args: {url, site: {lat, lng}}. Reports {places, links, requests, shapes, title} or {blocked} or {error}.
// A check on Campendium's page (Cloudflare "Just a moment", a challenge) is never got around: the read says blocked and stops.
async function (reqId, args) {
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const refused = (t) => /just a moment|attention required|checking your browser|verify you are human|captcha|access denied/i.test(t || '');
  const checkText = () => document.title + ' ' + (document.body ? document.body.innerText.slice(0, 1500) : '');
  const started = Date.now();
  // Wait for local map tiles to settle for 1 s; telemetry cannot prolong the read (25 s ceiling).
  let last = -1, steady = 0;
  while (Date.now() - started < 25000) {
    if (refused(checkText())) { send({ blocked: true, title: document.title.slice(0, 120) }); return; }
    const n = performance.getEntriesByType('resource').filter((e) => /fetch|xmlhttprequest/.test(e.initiatorType) && /\/api\/v2\/tiles\//.test(e.name)).length;
    steady = n === last ? steady + 1 : 0; last = n;
    if (n > 0 && steady >= 2) break;
    await pause(500);
  }
  const reqs = performance.getEntriesByType('resource').filter((e) => /fetch|xmlhttprequest/.test(e.initiatorType)).map((e) => {
    try { const u = new URL(e.name); return { host: u.host, path: u.pathname.slice(0, 160), params: Array.from(u.searchParams.keys()).slice(0, 20), full: e.name }; } catch (x) { return null; }
  }).filter(Boolean).filter((r) => !/google|facebook|doubleclick|analytics|mapbox\.com\/(fonts|styles)|sentry|segment|hotjar|clarity/.test(r.host + r.path));
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? +v : NaN);
  const coord = (o) => {
    if (!o || typeof o !== 'object') return null;
    const lat = num(o.lat ?? o.latitude ?? (o.location && (o.location.lat ?? o.location.latitude)) ?? (o.coordinates && o.coordinates.lat));
    const lng = num(o.lng ?? o.lon ?? o.longitude ?? (o.location && (o.location.lng ?? o.location.lon ?? o.location.longitude)) ?? (o.coordinates && (o.coordinates.lng ?? o.coordinates.lon)));
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    const g = o.geometry && o.geometry.coordinates;
    if (Array.isArray(g) && Number.isFinite(+g[0]) && Number.isFinite(+g[1])) return { lat: +g[1], lng: +g[0] };
    return null;
  };
  const places = [], shapes = [];
  const walk = (v, depth) => {
    if (!v || depth > 5) return;
    if (Array.isArray(v)) {
      const hits = v.map((o) => { const c = coord(o && (o.properties ? Object.assign({}, o.properties, { geometry: o.geometry }) : o)); const p = o && (o.properties || o); const name = p && (p.name || p.title); return c && name ? { name: String(name).slice(0, 160), lat: c.lat, lng: c.lng, url: p.path ? 'https://maps.campendium.com' + p.path : p.url || p.permalink || p.slug || null, price: null, pets: p.place_detail && typeof p.place_detail.pets === 'boolean' ? p.place_detail.pets : null, kind: p.filters_appearance && p.filters_appearance.label || null } : null; }).filter(Boolean);
      if (hits.length) places.push(...hits.filter(p => /^(Public Land|RV Park)$/.test(p.kind || '')).slice(0, 500));
      else v.slice(0, 3).forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof v === 'object') Object.keys(v).slice(0, 40).forEach((k) => walk(v[k], depth + 1));
  };
  // Only local tile data: sponsored markers and campers_choice can be anywhere in the country.
  const tiles = reqs.filter((r) => r.host === 'maps.campendium.com' && /^\/api\/v2\/tiles\/\d+\/\d+\/\d+$/.test(r.path));
  const zoom = Math.max(-1, ...tiles.map(r => +r.path.split('/')[4]));
  const own = Array.from(new Map(tiles.filter(r => +r.path.split('/')[4] === zoom).map(r => [r.full, r])).values()).slice(-12);
  let cursor = 0, blocked = false;
  await Promise.all(Array.from({length:Math.min(4,own.length)},async () => {
   while(!blocked&&cursor<own.length&&Date.now()-started<50000){ const r=own[cursor++];
    try {
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 8000);
      let res, text;try { res = await fetch(r.full, { signal: abort.signal, credentials: 'include' });text = await res.text(); } finally { clearTimeout(timer); }
      if (refused(text.slice(0, 600)) && !/^\s*[[{]/.test(text)) { if(!blocked){blocked=true;send({ blocked: true, title: document.title.slice(0, 120) });} return; }
      let j; try { j = JSON.parse(text); } catch (x) { shapes.push({ path: r.path, status: res.status, json: false, bytes: text.length }); continue; }
      if(!res.ok)continue;
      const arr = Array.isArray(j) ? j : Object.values(j).find(Array.isArray);
      shapes.push({ path: r.path, status: res.status, json: true, bytes: text.length, keys: Array.isArray(j) ? null : Object.keys(j).slice(0, 20), length: arr ? arr.length : null, itemKeys: arr && arr[0] && typeof arr[0] === 'object' ? Object.keys(arr[0]).slice(0, 30) : null, sample: arr && arr[0] ? JSON.stringify(arr[0]).slice(0, 600) : null });
      walk(j, 0);
    } catch (e) { shapes.push({ path: r.path, error: String(e && e.message || e).slice(0, 120) }); }
   }
  }));
  if(blocked)return;
  const links = Array.from(document.querySelectorAll('a[href*="/places/"]')).slice(0, 200).map((a) => ({ name: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120), url: a.href })).filter((x) => x.name);
  send({ places, links, requests: reqs.map((r) => ({ host: r.host, path: r.path, params: r.params })).slice(0, 30), shapes, title: document.title.slice(0, 120), ms: Date.now() - started });
}
