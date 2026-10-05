// Runs inside the app's off-screen copy of Murphy USA's own store-finder map
// (service.murphydriverewards.com/mapmodule, the map embedded on murphyusa.com/find-a-store).
// It makes the same request the map makes when you search or tap "use my location":
//   POST /api/store  {latitude, longitude, range (miles), pageSize}
// which returns nearby Murphy USA / Murphy Express stores, each with every grade's price and update time.
// args: {lat, lng, radiusMi, max}  or, for trips, {points:[{lat,lng}], radiusMi, max}
// Reports back through FuelPlusSite.result(reqId, json).
async function (reqId, args) {
  const send = (o) => FuelPlusSite.result(reqId, JSON.stringify(o));
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
    for (let pi = 0; pi < points.length; pi++) {
      const p = points[pi];
      if (FuelPlusSite.progress) FuelPlusSite.progress(reqId, pi, points.length);
      (await near(p.lat, p.lng)).forEach((s) => {
        if (seen[s.id]) return;
        seen[s.id] = 1;
        stores.push({ id: s.id, storeNumber: s.storeNumber, chainName: s.chainName, address: s.address, city: s.city, state: s.state, zip: s.zip,
          latitude: s.latitude, longitude: s.longitude, closeDate: s.closeDate, gasPrices: s.gasPrices || [] });
      });
      if (points.length > 1) await pause(250);
    }
    send({ stores: stores });
  } catch (e) {
    send({ blocked: !!(e && e.blocked), error: String(e && e.message || e) });
  }
}
