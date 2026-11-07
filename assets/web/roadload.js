/* EV road load: which EPA-listed battery EVs have the EPA's own coast-down road-load coefficients (an established
 * efficiency curve), and the coefficients themselves. Data: evroadload-data.js (tools/gen-ev-roadload.py, EPA Test Car
 * List matched to fueleconomy.gov names). Pure; runs in Node too. */
(function (root) {
  'use strict';
  var DATA = root.EV_ROADLOAD_DATA || (typeof module !== 'undefined' && module.exports ? require('./evroadload-data.js') : []);
  function key(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  var byKey = new Map(), byYear = new Map();
  DATA.forEach(function (r) {
    var row = { year: r[0], make: r[1], model: r[2], coef: r.length > 3 ? { a: r[3], b: r[4], c: r[5] } : null, testYear: r[6] || r[0] };
    byKey.set(r[0] + '|' + key(r[1]) + '|' + key(r[2]), row);
    if (!byYear.has(r[0])) byYear.set(r[0], []);
    byYear.get(r[0]).push(row);
  });
  /** The listed EV {year, make, model, coef: {a, b, c} | null, testYear} for a year / make / model (EPA menu text), or null. */
  function of(q) {
    if (!q || !q.year || !q.make || !q.model) return null;
    return byKey.get(+q.year + '|' + key(q.make) + '|' + key(q.model)) || null;
  }
  /** Coefficients {a, b, c, testYear, label} for a car (EPA identity), or null. */
  function forCar(c) {
    var r = c && of({ year: c.year, make: c.make, model: c.model });
    return r && r.coef ? { a: r.coef.a, b: r.coef.b, c: r.coef.c, testYear: r.testYear, label: 'EPA road-load test' + (r.testYear !== r.year ? ' (' + r.testYear + ' model year)' : '') } : null;
  }
  /** Any listed EV that matches a partial {year[, make[, model]]} and the test, e.g. for filtering menus. */
  function any(q, test) {
    var rows = byYear.get(+q.year) || [];
    return rows.some(function (r) {
      if (q.make != null && key(r.make) !== key(q.make)) return false;
      if (q.model != null && key(r.model) !== key(q.model)) return false;
      return test(r);
    });
  }
  var api = { of: of, forCar: forCar, any: any, size: DATA.length };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RoadLoad = api;
})(typeof window !== 'undefined' ? window : globalThis);
