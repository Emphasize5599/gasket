/**
 * Tolls on a route option, for comparing toll and toll-free routes (pure; tests/tolls.test.js).
 *
 * Where the numbers come from:
 * - With the API key, Google's Routes API estimates each route's tolls when asked (extraComputations TOLLS):
 *   travelAdvisory.tollInfo.estimatedPrice = [{currencyCode, units, nanos}]; tollInfo without a price = tolls of an
 *   unknown amount; no tollInfo at all on a route asked about = no tolls. The estimate is for a car with no toll pass.
 * - Without a key, the Google Maps website says only "This route has tolls" (no amount; checked on the Turner
 *   Turnpike in 2026-10), so the amount is yours to enter.
 * - A route fetched with "avoid tolls" has none.
 * An amount you enter (by the route's signature) always wins. Unknown stays unknown: a comparison never treats an
 * unknown toll as $0.
 */
(function (root) {
  'use strict';
  function sig(a) { return a ? Math.round((a.distanceMeters || 0) / 100) + '|' + Math.round(parseFloat(String(a.duration || '0')) / 60) + '|' + String(a.description || '').replace(/ · no tolls$/, '') : ''; }
  function money(p) { return Number(p.units || 0) + Number(p.nanos || 0) / 1e9; }
  /** One route option's tolls: {has: true | false | null, cost: dollars | null, src: 'you' | 'google' | 'maps' | 'avoid' | null}. */
  function ofRoute(a, entered) {
    if (!a) return { has: null, cost: null, src: null };
    var mine = entered && entered[sig(a)];
    if (Number.isFinite(mine) && mine >= 0) return { has: mine > 0, cost: mine, src: 'you' };
    if (a.tollFree) return { has: false, cost: 0, src: 'avoid' };
    var info = a.travelAdvisory && a.travelAdvisory.tollInfo;
    if (info) {
      var usd = (info.estimatedPrice || []).filter(function (p) { return !p.currencyCode || p.currencyCode === 'USD'; });
      return usd.length ? { has: true, cost: Math.round(usd.reduce(function (s, p) { return s + money(p); }, 0) * 100) / 100, src: 'google' } : { has: true, cost: null, src: 'google' };
    }
    if (a.tollsAsked) return { has: false, cost: 0, src: 'google' };
    if (a.websiteTolls === true) return { has: true, cost: null, src: 'maps' };
    if (a.websiteTolls === false) return { has: false, cost: 0, src: 'maps' };
    return { has: null, cost: null, src: null };
  }
  /** Several legs' options together (a whole trip): the sum, null if a leg has tolls of an amount nobody knows. */
  function ofTrip(list, entered) {
    var parts = list.map(function (a) { return ofRoute(a, entered); });
    return { has: parts.some(function (t) { return t.has; }) ? true : parts.every(function (t) { return t.has === false; }) ? false : null,
      // a leg nobody asked about counts as none (tolls weren't being compared); one with tolls of no known amount = unknown
      cost: parts.some(function (t) { return t.has === true && t.cost == null; }) ? null : Math.round(parts.reduce(function (s, t) { return s + (t.cost || 0); }, 0) * 100) / 100, parts: parts };
  }
  /** What one trip costs more than another counting tolls: null when either toll amount is unknown and they differ. */
  function diff(a, b) {
    if (a.cost != null && b.cost != null) return Math.round((a.cost - b.cost) * 100) / 100;
    return null;
  }
  /**
   * Add the toll-free options (fetched with avoid tolls) to a leg's options: one Google already offered (the same
   * road, > 90% overlapping) is marked toll-free instead of listed twice; the others join as "… · no tolls".
   * overlap(a, b) = shared share of the route (0–1).
   */
  function addTollFree(list, free, overlap) {
    var out = list.slice();
    (free || []).forEach(function (f) {
      // a route known to have tolls is never "the same" as one that avoids them, however close the roads run
      var same = out.filter(function (a) { return ofRoute(a).has !== true && overlap(a, f) > 0.9 && Math.abs((a.distanceMeters || 0) - (f.distanceMeters || 0)) <= Math.max(1609, (f.distanceMeters || 0) * 0.02); })[0];
      if (same) { same.tollFree = true; return; }
      out.push(Object.assign({}, f, { tollFree: true, description: (f.description || 'Toll-free route') + ' · no tolls' }));
    });
    return out;
  }
  function text(t) { return t.has === false ? 'No tolls' : t.cost != null ? 'Tolls about $' + t.cost.toFixed(2) : t.has ? 'Has tolls (amount unknown)' : ''; }
  var api = { sig: sig, ofRoute: ofRoute, ofTrip: ofTrip, diff: diff, addTollFree: addTollFree, text: text };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Tolls = api;
})(typeof window !== 'undefined' ? window : this);
