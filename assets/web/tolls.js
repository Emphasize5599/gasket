/**
 * Tolls on a route option, for comparing toll and toll-free routes (pure; tests/tolls.test.js).
 *
 * Where the numbers come from:
 * - With the API key, Google's Routes API estimates each route's tolls when asked (extraComputations TOLLS):
 *   travelAdvisory.tollInfo.estimatedPrice = [{currencyCode, units, nanos}]; tollInfo without a price = tolls of an
 *   unknown amount; no tollInfo at all on a route asked about = no tolls. The estimate is for a car with no toll pass.
 * - Without a key, the Google Maps website says only "This route has tolls" (no amount; checked on the Turner
 *   Turnpike in 2026-10), so the amount is yours to enter.
 * - With the optional HERE key (free: 2,500 toll lookups a month), HERE's Routing v8 prices one route option per
 *   request: the same road, held by pass-through points along our line (hereQuery), its answer accepted only when
 *   its length matches ours within 3% (hereRead). Asked only for options Maps says have tolls of no known amount.
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
    var here = a.hereTolls;
    if (here && here.ok && Number.isFinite(here.cost)) return { has: here.cost > 0, cost: here.cost, src: 'here' };
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
  var VIA = 8;
  /**
   * HERE Routing v8 query (without the key) for one option's line pts [{lat, lng}]: its ends plus VIA pass-through
   * points spread along it (so HERE prices these roads, not its own pick), car, one route, the toll total in USD.
   * veh {axles, trailers, trailerAxles}: a hooked trailer changes what tolls cost (axles in total include the trailer's).
   */
  function hereQuery(pts, veh) {
    var n = pts.length, at = function (p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }, enc = function (k) { return k.replace(/\[/g, '%5B').replace(/\]/g, '%5D'); };
    var q = ['transportMode=car', 'origin=' + at(pts[0]), 'destination=' + at(pts[n - 1])];
    for (var k = 1; k <= VIA && n > 2; k++) q.push('via=' + at(pts[Math.round(k * (n - 1) / (VIA + 1))]) + '!passThrough=true');
    q.push('return=summary,tolls', enc('tolls[summaries]') + '=total', 'currency=USD');
    if (veh && veh.trailers > 0) q.push(enc('vehicle[axleCount]') + '=' + ((veh.axles || 2) + veh.trailerAxles), enc('vehicle[trailerCount]') + '=' + veh.trailers, enc('vehicle[trailerAxleCount]') + '=' + veh.trailerAxles);
    return q.join('&');
  }
  /**
   * HERE's answer → {ok, cost, mi}: the route's length (all sections) against ours (wantMi, 3%), the toll total in
   * USD (each section's summary.tolls.total, else each toll's cheapest fare). No tolls listed = $0. Another currency
   * or a shape we don't know = not ok (asked again never: the caller keeps the failure for this route).
   */
  function hereRead(json, wantMi) {
    var r = json && json.routes && json.routes[0];
    if (!r || !Array.isArray(r.sections) || !r.sections.length) return { ok: false, why: 'no route' };
    var m = 0, cost = 0, bad = false;
    r.sections.forEach(function (s) {
      m += (s.summary && s.summary.length) || 0;
      var tot = s.summary && s.summary.tolls && s.summary.tolls.total;
      if (tot) { if (tot.currency && tot.currency !== 'USD') bad = true; cost += Number(tot.value) || 0; return; }
      (s.tolls || []).forEach(function (t) {
        var fares = (t.fares || []).map(function (f) { var p = f.price || f.convertedPrice || {}; if (p.currency && p.currency !== 'USD') return null; return Number(p.value); }).filter(Number.isFinite);
        if (fares.length) cost += Math.min.apply(null, fares); else if ((t.fares || []).length) bad = true;
      });
    });
    var mi = m / 1609.344;
    if (bad) return { ok: false, why: 'currency', mi: mi };
    if (!(wantMi > 0) || Math.abs(mi - wantMi) > wantMi * 0.03) return { ok: false, why: 'different route', mi: mi };
    return { ok: true, cost: Math.round(cost * 100) / 100, mi: mi };
  }
  function text(t) { return t.has === false ? 'No tolls' : t.cost != null ? 'Tolls about $' + t.cost.toFixed(2) : t.has ? 'Has tolls (amount unknown)' : ''; }
  var api = { sig: sig, hereQuery: hereQuery, hereRead: hereRead, ofRoute: ofRoute, ofTrip: ofTrip, diff: diff, addTollFree: addTollFree, text: text };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Tolls = api;
})(typeof window !== 'undefined' ? window : this);
