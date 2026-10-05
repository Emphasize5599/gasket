/* Demo data in the exact Google Places (New) response shape, so the whole pipeline can be tried
 * before an API key is set up. Prices are invented and clearly labelled DEMO in the UI. */
(function (root) {
  function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  var names = ['Walmart Fuel Station', 'Murphy USA', 'Murphy Express', "Sam's Club Gas Station", 'Exxon', 'Mobil', 'CITGO', 'Exxon', 'CITGO', 'Murphy USA', 'Mobil', 'Walmart Fuel Station', 'CITGO', 'Exxon'];
  function money(v) { var u = Math.floor(v); return { currencyCode: 'USD', units: String(u), nanos: Math.round((v - u) * 1e9) }; }
  root.demoPlaces = function (lat, lng) {
    var r = rng(Math.abs(Math.round(lat * 1000) * 31 + Math.round(lng * 1000)) % 2147483646 + 1);
    var now = Date.now(), out = [];
    for (var i = 0; i < names.length; i++) {
      var reg = 2.659 + Math.round(r() * 40) / 100;
      var age = (i === 5 ? 40 : r() * 10) * 3.6e6; // one stale price to show the warning
      var t = new Date(now - age).toISOString();
      var fp = [
        { type: 'REGULAR_UNLEADED', price: money(reg), updateTime: t },
        { type: 'MIDGRADE', price: money(reg + 0.45), updateTime: t },
        { type: 'PREMIUM', price: money(reg + 0.85), updateTime: t }
      ];
      if (r() > 0.35) fp.push({ type: 'DIESEL', price: money(reg + 0.6 + r() * 0.2), updateTime: t });
      out.push({
        id: 'demo-' + i,
        displayName: { text: names[i] },
        location: { latitude: lat + (r() - 0.5) * 0.16, longitude: lng + (r() - 0.5) * 0.2 },
        formattedAddress: (100 + Math.floor(r() * 9000)) + ' Demo Rd, Sampletown, AR 72114, USA',
        addressComponents: [{ shortText: 'AR', types: ['administrative_area_level_1', 'political'] }],
        businessStatus: 'OPERATIONAL',
        googleMapsUri: '',
        fuelOptions: { fuelPrices: fp }
      });
    }
    return out;
  };
})(this);
