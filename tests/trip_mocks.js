// Stand-ins for Google Routes, Places along-route, EPA, Walmart and Murphy (shapes match the real APIs)
(function () {
  const A = [34.7695, -92.2671], B = [32.7767, -96.797];   // North Little Rock AR -> Dallas TX
  const N = 1200, line = [];
  for (let i = 0; i <= N; i++) { const t = i / N; line.push({ lat: A[0] + (B[0] - A[0]) * t + Math.sin(t * 9) * 0.05, lng: A[1] + (B[1] - A[1]) * t }); }
  const total = 318;
  const lineI30 = line.map((p) => ({ lat: p.lat + 0.003, lng: p.lng }));   // a hair north, so tests can tell the two routes apart
  const enc = window.Trip.encodePolyline;
  const at = (mi) => { const t = mi / total; return { lat: A[0] + (B[0] - A[0]) * t + Math.sin(t * 9) * 0.05, lng: A[1] + (B[1] - A[1]) * t }; };
  const money = (v) => ({ currencyCode: 'USD', units: String(Math.floor(v)), nanos: Math.round((v - Math.floor(v)) * 1e9) });
  const now = new Date().toISOString();
  const steps = [];
  for (let k = 0; k < 12; k++) steps.push({ distanceMeters: total / 12 * 1609.344, staticDuration: Math.round(total / 12 / (k === 0 || k === 11 ? 35 : 66) * 3600) + 's' });
  const brandAt = { Exxon: [[38, 3.299, 0.3], [150, 3.149, 0.4], [262, 3.259, 0.2], [317.4, 3.459, 0.2]], Mobil: [[60, 3.349, 0.2], [205, 3.199, 1.6]], CITGO: [[118, 3.059, 2.4], [240, 3.329, 0.3]], "Sam's Club Gas Station": [[176, 2.999, 3.2]] };
  window.__mocks = {
    route: (body) => {
      window.__routeBody = body;
      const main = { description: 'I-30 W', routeLabels: ['DEFAULT_ROUTE'], distanceMeters: total * 1609.344, duration: '17600s', polyline: { encodedPolyline: enc(lineI30) }, legs: [{ distanceMeters: total * 1609.344, steps }] };
      const alt = Object.assign({}, main, { polyline: { encodedPolyline: enc(line) }, description: 'US-67 S and I-30 W', routeLabels: ['DEFAULT_ROUTE_ALTERNATE'], distanceMeters: (total + 12) * 1609.344, duration: '18300s' });
      return { routes: body.computeAlternativeRoutes ? [main, alt] : [main] };
    },
    find: (q, lat, lng, radius) => {
      (window.__finds = window.__finds || []).push(q);
      if (/^500 Woodlane St$/i.test(q)) return { places: [
        { id: 'P-capitol-ar-far', displayName: { text: '500 Woodlane St' }, formattedAddress: '500 Woodlane St, Elsewhere, OH 44101, USA', location: { latitude: 41.5, longitude: -81.7 } },
        { id: 'P-capitol-ar', displayName: { text: '500 Woodlane St' }, formattedAddress: '500 Woodlane St, Little Rock, AR 72201, USA', location: { latitude: 34.74648, longitude: -92.28959 } }] };
      if (/^210 Capitol Ave$/i.test(q)) return { places: [
        { id: 'P-capitol-ct', displayName: { text: '210 Capitol Ave' }, formattedAddress: '210 Capitol Ave, Hartford, CT 06106, USA', location: { latitude: 41.76404, longitude: -72.68239 } }] };
      if (/^100 Main St$/i.test(q.trim())) return { places: [
        { id: 'P-main-nlr', displayName: { text: '100 Main St' }, formattedAddress: '100 N Main St, North Little Rock, AR 72114, USA', location: { latitude: 34.770, longitude: -92.267 } },
        { id: 'P-main-conway', displayName: { text: '100 Main St' }, formattedAddress: '100 N Main St, Conway, AR 72032, USA', location: { latitude: 35.089, longitude: -92.442 } }] };
      if (/dallas/i.test(q)) return { places: [{ id: 'P-dallas', displayName: { text: 'Dallas' }, formattedAddress: 'Dallas, TX, USA', location: { latitude: 32.7767, longitude: -96.797 } }] };
      return { places: [] };
    },
    along: (jobs) => {
      window.__jobs = jobs;
      const results = [];
      jobs.forEach((j, idx) => {
        const list = (brandAt[j.q] || []).filter(([mi]) => mi >= j.fromMi && mi < j.toMi);
        if (!list.length) return;
        const places = [], sums = [];
        const onI30 = Math.abs(j.lat - lineI30[0].lat) < 0.002;
        (window.__alongRoutes = window.__alongRoutes || {})[onI30 ? 'I-30' : 'US-67'] = true;
        list.forEach(([mi, price0, det], k) => {
          const price = onI30 && window.__cheapI30 ? price0 - 0.35 : price0;
          const p = at(mi);
          const name = j.q === "Sam's Club Gas Station" ? "Sam's Club Fuel Center" : j.q;
          places.push({ id: 'g-' + name.replace(/\W/g, '') + mi, displayName: { text: name }, location: { latitude: p.lat + det / 69 / 2.6, longitude: p.lng },
            formattedAddress: mi + ' Hwy 67, Somewhere, AR 7' + mi + ', USA', addressComponents: [{ shortText: mi < 150 ? 'AR' : 'TX', types: ['administrative_area_level_1'] }],
            businessStatus: 'OPERATIONAL', fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: money(price), updateTime: now }, { type: 'PREMIUM', price: money(price + 0.8), updateTime: now }] } });
          const chunk = (j.toMi - j.fromMi) * 1609.344;
          const l0 = (mi - j.fromMi + det / 2) * 1609.344, l1 = chunk - l0 + det * 1609.344;
          sums.push({ legs: [{ distanceMeters: Math.round(l0), duration: Math.round(l0 / 29) + 's' }, { distanceMeters: Math.round(l1), duration: Math.round(l1 / 29) + 's' }] });
        });
        results.push({ job: idx, places, routingSummaries: sums });
      });
      return { results, errors: [], calls: jobs.length };
    },
    osm: (url) => {
      (window.__osm = window.__osm || []).push(url);
      if (/lat=34\.74/.test(url)) return { address: { house_number: '500', road: 'Woodlane Street', city: 'Little Rock', state: 'Arkansas', 'ISO3166-2-lvl4': 'US-AR', postcode: '72032' } };
      if (/lat=41\.76/.test(url)) return { address: { road: 'Capitol Avenue', city: 'Hartford', state: 'Connecticut', 'ISO3166-2-lvl4': 'US-CT', postcode: '06010' } };
      return { address: { town: 'North Little Rock', 'ISO3166-2-lvl4': 'US-AR', postcode: '72114' } };
    },
    epa: (url) => {
      if (/menu\/year/.test(url)) return { menuItem: [{ text: '2021', value: '2021' }, { text: '2020', value: '2020' }] };
      if (/menu\/make/.test(url)) return { menuItem: [{ text: 'Honda', value: 'Honda' }, { text: 'Toyota', value: 'Toyota' }] };
      if (/menu\/model/.test(url)) return { menuItem: [{ text: 'Accord', value: 'Accord' }, { text: 'Civic 4Dr', value: 'Civic 4Dr' }] };
      if (/menu\/options/.test(url)) return { menuItem: { text: 'Auto (AV-S7), 4 cyl, 1.5 L, Turbo', value: '43001' } };   // single item comes back as an object
      return { year: '2021', make: 'Honda', model: 'Accord', city08: '30', highway08: '38', comb08: '33', fuelType1: 'Regular Gasoline', fuelType: 'Regular' };
    }
  };
  window.__siteMock = (key, a) => {
    if (key === 'gmaps') { window.__gmapsUrl = a.url; return window.__gmapsAnswer || { error: 'no gmaps mock' }; }
    if (!a.points && !a.mode) return null;
    if (key === 'murphy') { const p = at(96); return { stores: [{ id: 501, storeNumber: 7001, chainName: 'Murphy USA', address: '96 Hwy 67', city: 'Malvern', state: 'AR', zip: '72104', latitude: p.lat, longitude: p.lng + 0.004, closeDate: '',
      gasPrices: [{ fuelType: 'Regular', price: 3.089, lastUpdateUtc: now }, { fuelType: 'Premium', price: 3.899, lastUpdateUtc: now }] }, { id: 502, chainName: 'Murphy USA', address: 'Far away', latitude: 34.0, longitude: -90.0, closeDate: '', gasPrices: [{ fuelType: 'Regular', price: 2.5, lastUpdateUtc: now }] }] }; }
    if (key === 'walmart' && a.mode === 'nodes') { const p = at(290); return { nodes: [{ id: '777', displayName: 'Texarkana-ish Supercenter', geoPoint: { latitude: p.lat + 0.01, longitude: p.lng }, address: { addressLineOne: '290 Main', city: 'Mesquite', state: 'TX', postalCode: '75150' } },
      { id: '888', displayName: 'Off-route Supercenter', geoPoint: { latitude: 33.9, longitude: -91.0 }, address: {} }] }; }
    if (key === 'walmart' && a.mode === 'prices') { window.__wmPriceIds = a.nodes.map(n => n.id); return { stores: a.nodes.map(n => ({ id: n.id, name: n.displayName, address: n.address, geo: n.geoPoint,
      fuel: { metadata: { dateCreated: now }, prices: [{ name: 'UNLEAD', displayName: 'Unleaded', price: 3.019 }, { name: 'PREMIUM', displayName: 'Premium', price: 3.769 }] } })) }; }
    return null;
  };
})();
