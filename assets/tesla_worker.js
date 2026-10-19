// Runs inside the app's off-screen copy of Tesla's own charger map (www.tesla.com/findus), signed out.
// It makes the same requests the map makes: the U.S. site list, then each Supercharger's details, whose
// `effectivePricebooks` are Tesla's published prices (Tesla cars vs other cars, per kWh or per minute, time of day).
// args: {sites: [{id, lat, lng}], tesla: true | false (is the car a Tesla), max}
// Reports {sites: {id: {rate, uom, peak, low, congestion, maxKw, open, slug}}, listed, matched} or {blocked} or {error}.
// A check on Tesla's page (Access Denied, a challenge) is never got around: the read says blocked and stops.
async function (reqId, args) {
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const refused = (t) => /access denied|captcha|are you a robot|unusual traffic|verify you are/i.test(t || '');
  if (refused(document.title) || refused(document.body && document.body.innerText.slice(0, 2000))) { send({ blocked: true }); return; }
  const get = async (path) => {
    const r = await fetch(path, { headers: { accept: 'application/json' }, credentials: 'include' });
    const txt = await r.text();
    if (r.status === 403 || r.status === 429 || refused(txt.slice(0, 600)) && txt.charAt(0) !== '{') { const e = new Error('Tesla refused'); e.blocked = true; throw e; }
    if (!r.ok) throw new Error('Tesla HTTP ' + r.status);
    return JSON.parse(txt);
  };
  const meters = (a, b) => { const R = 6371000, p = Math.PI / 180, dLat = (b.lat - a.lat) * p, dLng = (b.lng - a.lng) * p, s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
  try {
    // args.mode 'list': just the Superchargers' places (the app keeps them a week and matches its chargers itself)
    let sc = [];
    if (args.mode === 'list' || !args.slugs) {
      const list = await get('/api/findus/get-locations?country=US&view=map');
      const rows = ((list && list.data && list.data.data) || list.data || []).filter((x) => /supercharger/i.test(JSON.stringify(x.location_type || '')) && x.location_url_slug);
      sc = rows.map((x) => ({ lat: Math.round(+x.latitude * 1e5) / 1e5, lng: Math.round(+x.longitude * 1e5) / 1e5, slug: x.location_url_slug })).filter((x) => isFinite(x.lat) && isFinite(x.lng));
      if (args.mode === 'list') { send({ list: sc }); return; }
    }
    // args.slugs: {slug: [ids]} already matched by the app; else args.sites matched here
    const want = (args.sites || []).filter((s) => isFinite(s.lat) && isFinite(s.lng));
    if (!args.slugs && !want.length) { send({ sites: {}, listed: 0, matched: 0 }); return; }
    // each wanted site: the nearest Supercharger within 250 m (Tesla's pin vs DOE's can differ by a parking lot)
    const bySlug = args.slugs || {}, out = {};
    if (!args.slugs) want.forEach((w) => { let best = null, bd = 250; sc.forEach((x) => { if (Math.abs(x.lat - w.lat) > 0.01 || Math.abs(x.lng - w.lng) > 0.01) return; const d = meters(w, x); if (d < bd) { bd = d; best = x; } }); if (best) (bySlug[best.slug] = bySlug[best.slug] || []).push(w.id); });
    const slugs = Object.keys(bySlug).slice(0, Math.max(1, Math.min(80, args.max || 60)));
    const one = async (slug) => {
      let d;
      try { d = await get('/api/findus/get-charger-details?locationSlug=' + encodeURIComponent(slug) + '&programType=supercharger&locale=en-US&isInHkMoTw=false'); }
      catch (e) { if (e.blocked) { throw e; } return; }
      const data = (d && d.data && (d.data.data || d.data)) || {}, books = data.effectivePricebooks || [];
      const make = args.tesla ? 'TSLA' : 'NTSLA';
      // the car's own rows (a non-Tesla pays the non-member rate unless no such row exists), charging only
      let rows2 = books.filter((b) => b && b.feeType === 'CHARGING' && b.vehicleMakeType === make && b.currencyCode !== 'CAD');
      if (!args.tesla && rows2.some((b) => !b.isMemberPricebook)) rows2 = rows2.filter((b) => !b.isMemberPricebook);
      if (!rows2.length) return;
      const uom = /min/i.test(rows2[0].uom) ? 'min' : 'kwh', same = rows2.filter((b) => (/min/i.test(b.uom) ? 'min' : 'kwh') === uom);
      const rate = (b) => Math.max(+b.rateBase || 0, +b.rateTier1 || 0, +b.rateTier2 || 0);
      const vals = same.map(rate).filter((v) => v >= 0 && v < 5);
      if (!vals.length) return;
      const cong = books.filter((b) => b && b.feeType === 'CONGESTION').map(rate).filter((v) => v > 0);
      const info = { slug, uom, peak: Math.max(...vals), low: Math.min(...vals), tou: same.some((b) => b.isTou), congestion: cong.length ? Math.max(...cong) : 0,
        maxKw: +data.maxPowerKw || 0, open: data.openToNonTeslas !== false, currency: same[0].currencyCode || 'USD' };
      bySlug[slug].forEach((id) => { out[id] = info; });
    };
    // two sites at a time, then a pause: like a person tapping pins, about twice as fast as one by one
    for (let i = 0; i < slugs.length; i += 2) {
      try { await Promise.all(slugs.slice(i, i + 2).map(one)); }
      catch (e) { if (e.blocked) { send({ blocked: true, sites: out, listed: sc.length, matched: Object.keys(out).length }); return; } }
      await pause(700);
    }
    send({ sites: out, listed: sc.length, matched: Object.keys(out).length });
  } catch (e) {
    send(e.blocked ? { blocked: true } : { error: String(e && e.message || e) });
  }
}
