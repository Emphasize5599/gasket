// Runs inside the app's off-screen walmart.com page (same requests the site makes for a normal visitor).
// 1) Walmart's store finder: nearby stores and which ones have a Walmart Fuel Station.
// 2) Each fuel store's page (walmart.com/store/<id>), which embeds its official pump prices.
// Modes:  default  {lat,lng,radiusMi,max}  -> stores near one spot, with prices
//         'nodes'  {points:[{lat,lng}],radiusMi} -> fuel-station stores near each point (no prices; for trips)
//         'prices' {nodes:[...]}            -> prices for those stores (the app picks the ones near your route)
// Reports back through FuelPlusSite.result(reqId, json). If Walmart shows a "Robot or human?" check,
// it reports {blocked:true} and the app asks you to complete the check yourself.
async function (reqId, args) {
  const send = (o) => FuelPlusSite.result(reqId, JSON.stringify(o));
  const isBlocked = (t) => /Robot or human|px-captcha|Access Denied/i.test(t);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const H = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'x-o-gql-query': 'query storeFinderNearbyNodesQuery',
    'x-apollo-operation-name': 'storeFinderNearbyNodesQuery',
    'x-o-platform': 'rweb', 'x-o-platform-version': 'us-web-1.0',
    'x-o-bu': 'WALMART-US', 'x-o-mart': 'B2C', 'x-o-segment': 'oaoh', 'x-o-ccm': 'server',
    'wm_mp': 'true', 'tenant-id': 'elh9ie'
  };
  const hash = 'd99972cb2bebae830d3024353653c48d935f157bb846c0980e7ab0ab4b744e98';
  async function nearby(lat, lng, radiusMi) {
    const vars = { input: { latitude: lat, longitude: lng, nodeTypes: ['STORE'], radius: Math.max(5, Math.min(50, Math.ceil(radiusMi))) } };
    const r = await fetch('/orchestra/home/graphql/storeFinderNearbyNodesQuery/' + hash + '?variables=' + encodeURIComponent(JSON.stringify(vars)),
      { headers: H, credentials: 'include' });
    const txt = await r.text();
    if (!r.ok || txt.charAt(0) !== '{') { const e = new Error('Walmart store finder returned HTTP ' + r.status); e.blocked = isBlocked(txt); throw e; }
    const data = JSON.parse(txt).data || {};
    return (data.nearByNodes && data.nearByNodes.nodes) || [];
  }
  const hasFuel = (n) => (n.capabilities || []).some((c) => c.accessPointType === 'FUEL_STATIONS') ||
    (n.services || []).some((s) => s.name === 'GAS_STATION');
  async function prices(list) {
    const stores = []; let blocked = false;
    for (let ni = 0; ni < list.length; ni++) { // one at a time, like a person opening each store page
      const n = list[ni];
      if (FuelPlusSite.progress) FuelPlusSite.progress(reqId, ni, list.length);
      try {
        const pr = await fetch('/store/' + n.id, { credentials: 'include' });
        const html = await pr.text();
        const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!m) { if (isBlocked(html)) { blocked = true; break; } continue; }
        const j = JSON.parse(m[1]);
        const init = (j.props && j.props.pageProps && j.props.pageProps.initialData) || {};
        const f = init.initialDataFuelSubgraph && init.initialDataFuelSubgraph.data && init.initialDataFuelSubgraph.data.storeFuelPrices;
        stores.push({ id: n.id, name: n.displayName || n.name, address: n.address, geo: n.geoPoint || n.geo, fuel: f || null });
        if (list.length > 6) await pause(250);
      } catch (e) { /* skip this store */ }
    }
    return { stores, blocked };
  }
  try {
    if (/\/blocked/.test(location.pathname) || isBlocked(document.title)) return send({ blocked: true });
    if (args.mode === 'nodes') {
      const seen = {}, out = [];
      const pts = (args.points || []).slice(0, 40);
      for (let pi = 0; pi < pts.length; pi++) {
        const p = pts[pi];
        if (FuelPlusSite.progress) FuelPlusSite.progress(reqId, pi, pts.length);
        const nodes = await nearby(p.lat, p.lng, args.radiusMi || 25);
        nodes.filter(hasFuel).forEach((n) => { if (!seen[n.id]) { seen[n.id] = 1; out.push({ id: n.id, displayName: n.displayName, address: n.address, geoPoint: n.geoPoint }); } });
        await pause(300);
      }
      return send({ nodes: out });
    }
    if (args.mode === 'prices') {
      const r = await prices((args.nodes || []).slice(0, 30));
      return send(r);
    }
    const nodes = await nearby(args.lat, args.lng, args.radiusMi);
    const r = await prices(nodes.filter(hasFuel).slice(0, args.max || 8));
    send({ stores: r.stores, blocked: r.blocked, nearby: nodes.length });
  } catch (e) {
    send({ blocked: !!(e && e.blocked), error: String(e && e.message || e) });
  }
}
