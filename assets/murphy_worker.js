// Runs inside the app's off-screen copy of Murphy USA's own store-finder map
// (service.murphydriverewards.com/mapmodule, the map embedded on murphyusa.com/find-a-store).
// It makes the same request the map makes when you search or tap "use my location":
//   POST /api/store  {latitude, longitude, range (miles), pageSize}
// which returns nearby Murphy USA / Murphy Express stores, each with every grade's price and update time.
// args: {lat, lng, radiusMi, max}  or, for trips, {points:[{lat,lng}], radiusMi, max}
// Reports back through GasketSite.result(reqId, json).
async function (reqId, args) {
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  async function near(lat, lng) {
    const body = { pageSize: args.max || 25, range: Math.max(5, Math.min(50, Math.ceil(args.radiusMi))), latitude: lat, longitude: lng };
    const r = await fetch('/api/store', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(body)
    });
    const txt = await r.text();
    if (!r.ok || txt.charAt(0) !== '{') {
      const e = new Error('Murphy store finder returned HTTP ' + r.status);
      e.blocked = /captcha|incapsula|access denied|robot/i.test(txt);
      throw e;
    }
    const j = JSON.parse(txt);
    return (j.data && j.data.stores) || [];
  }
  try {
    const points = args.points ? args.points.slice(0, 40) : [{ lat: args.lat, lng: args.lng }];
    const seen = {}, stores = [];
    // a few lookups at a time, like the map does when you pan around
    let done = 0;
    const one = async (p) => {
      (await near(p.lat, p.lng)).forEach((s) => {
        if (seen[s.id]) return;
        seen[s.id] = 1;
        stores.push({ id: s.id, storeNumber: s.storeNumber, chainName: s.chainName, address: s.address, city: s.city, state: s.state, zip: s.zip,
          latitude: s.latitude, longitude: s.longitude, closeDate: s.closeDate, gasPrices: s.gasPrices || [], at: p.key });
      });
      done++; if (GasketSite.progress) GasketSite.progress(reqId, done, points.length);
    };
    for (let i = 0; i < points.length; i += 4) {
      await Promise.all(points.slice(i, i + 4).map(one));
      if (i + 4 < points.length) await pause(150);
    }
    send({ stores: stores });
  } catch (e) {
    send({ blocked: !!(e && e.blocked), error: String(e && e.message || e) });
  }
}
