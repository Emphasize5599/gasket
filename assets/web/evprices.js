/* EV charging networks' own published prices, read the way their public maps read them (signed out, a few requests
 * at a time, cached): Tesla Superchargers (tesla.com/findus page reader), IONNA (one page lists every site and price),
 * Blink (its map service: sites, then each charger's host-set price). Each DOE station is matched to the network's
 * site by network and distance, and gets `netPrice` {rate, uom: kwh | min | hour, fee, peak, low, src, label, t},
 * which ChargerData.tariff prefers to DOE's free text. Not live prices; a check on a network's page is never got around. */
(function (root) {
  'use strict';
  var A = root.__app, S = A.S, KV = A.KV, LG = root.FLog || { info: function () {}, warn: function () {} };
  var HOUR = 3600e3, DAY = 24 * HOUR, WEEK = 7 * DAY, NS = 'evprices';
  var IONNA_URL = 'https://www.ionna.com/rechargeries/find-a-rechargery/', BLINK_SITES = 'https://chargermap.blinknetwork.com/v1/stations',
    BLINK_API = 'https://apigw.blinknetwork.com/';
  function call() { var t = root.__trip; return t && t.call ? t.call.apply(null, arguments) : Promise.resolve({ error: 'No Native bridge' }); }
  function meters(a, b) { var R = 6371000, p = Math.PI / 180, dLat = (b.lat - a.lat) * p, dLng = (b.lng - a.lng) * p, s = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.pow(Math.sin(dLng / 2), 2); return 2 * R * Math.asin(Math.sqrt(s)); }
  function nearest(st, list, maxM) { var best = null, bd = maxM; list.forEach(function (x) { if (Math.abs(x.lat - st.lat) > 0.01 || Math.abs(x.lng - st.lng) > 0.012) return; var d = meters(st, x); if (d < bd) { bd = d; best = x; } }); return best; }
  async function json(url) { var r = await call('fetchJson', url); if (!r || r.error) throw new Error(r && r.error || 'no answer'); return r.body; }
  function cached(key, age) { try { var o = KV.get(NS, key, age); return o ? o.v : null; } catch (e) { return null; } }
  function keep(key, v) { try { KV.put(NS, key, v); } catch (e) { } }
  /** "$0.59/kWh", "$1.00/Hour", "$0.25/min" → {v, uom} */
  function money(text) { var m = /\$\s*(\d*\.?\d+)\s*\/\s*(kwh|hour|hr|min(?:ute)?)/i.exec(String(text || '')); return m ? { v: +m[1], uom: /kwh/i.test(m[2]) ? 'kwh' : /min/i.test(m[2]) ? 'min' : 'hour' } : null; }

  // ---------- IONNA: window.allLocations on its finder page (every Rechargery, its price per kWh) ----------
  function parseIonna(html) {
    var m = /window\.allLocations\s*=\s*(\{[\s\S]*?\});\s*(?:\n|<\/script>)/.exec(String(html || '')); if (!m) return [];
    var o; try { o = JSON.parse(m[1]); } catch (e) { return []; }
    return Object.keys(o).map(function (k) { var x = o[k], p = /rechargery_price_now[^>]*>\s*\$\s*(\d*\.?\d+)/.exec(x.price || x.specs || '');
      return { lat: +x.lat, lng: +(x.lng != null ? x.lng : x.lon), rate: p ? +p[1] : null, open: x.status !== 'soon' && !/opening soon/i.test(x.note || ''), tax: /tax/i.test(x.price || ''), updated: x.price_updated || null };
    }).filter(function (x) { return isFinite(x.lat) && isFinite(x.lng) && x.rate != null; });
  }
  async function ionnaSites() { var c = cached('ionna-v1', DAY); if (c) return c; var list = parseIonna(await json(IONNA_URL)); if (list.length) keep('ionna-v1', list); return list; }

  // ---------- Blink: its map's site list, then a site's chargers, then a charger's flexi_pricing (host-set) ----------
  async function blinkSites() { var c = cached('blink-sites-v1', WEEK); if (c) return c; var j = JSON.parse(await json(BLINK_SITES)), list = (j.locations || []).map(function (x) { return { id: x.l_id, lat: +x.lat, lng: +x.long, open: x.open !== false }; }).filter(function (x) { return x.id && isFinite(x.lat) && isFinite(x.lng); }); if (list.length) keep('blink-sites-v1', list); return list; }
  function parseBlinkPrice(j) {
    var energy = [], parking = 0;
    (j && j.days || []).forEach(function (d) { (d.energySlots || []).forEach(function (s) { var q = money(s.cost); if (q) energy.push(q); }); (d.parkingSlots || []).forEach(function (s) { var q = money(s.cost); if (q && q.v > parking) parking = q.v; }); });
    if (!energy.length) return null;
    var uom = energy[0].uom, same = energy.filter(function (q) { return q.uom === uom; }).map(function (q) { return q.v; }), fee = /\$\s*(\d*\.?\d+)/.exec(j.serviceFee || '');
    return { rate: Math.max.apply(null, same), peak: Math.max.apply(null, same), low: Math.min.apply(null, same), uom: uom, fee: fee ? +fee[1] : 0, parking: parking };
  }
  async function blinkPrice(siteId, dc) {
    var key = 'blink-price-v1|' + siteId + '|' + (dc ? 'dc' : 'ac'), c = cached(key, DAY); if (c) return c.none ? null : c;
    var groups = JSON.parse(await json(BLINK_API + 'v3/locations/' + encodeURIComponent(siteId))), pick = null;
    (Array.isArray(groups) ? groups : []).forEach(function (g) { var fast = /dc|fast|level_3/i.test(g.level || ''); if (!pick || fast === !!dc) (g.chargers || []).some(function (ch) { if (ch.serialNumber) { pick = { serial: ch.serialNumber, fast: fast }; return true; } return false; }); });
    if (!pick) { keep(key, { none: true }); return null; }
    // Blink's pricing service sometimes answers all-zero ($0/kWh, $0 session) for a charger it prices on the next call
    // (3 of 8 calls on 2026-10-19): ask up to 3 times, keep a priced answer; all zeros = not trusted (no network price)
    var p = null;
    for (var i = 0; i < 3 && !(p && (p.peak > 0 || p.fee > 0)); i++) p = parseBlinkPrice(JSON.parse(await json(BLINK_API + 'pricing/api/index.php/flexi_pricing?serial_number=' + encodeURIComponent(pick.serial))));
    if (p && !(p.peak > 0 || p.fee > 0)) p = null;
    keep(key, p || { none: true }); return p;
  }

  // ---------- Tesla: the findus page reader (tesla_worker.js), cached per station ----------
  async function teslaPrices(sts, isTesla) {
    var out = {}, need = [];
    sts.forEach(function (st) { var c = cached('tesla-v1|' + (isTesla ? 't' : 'n') + '|' + st.id, DAY); if (c) { if (!c.none) out[st.id] = c; } else need.push(st); });
    for (var i = 0; i < need.length; i += 60) {
      var part = need.slice(i, i + 60), r = await call('siteRead', 'tesla', JSON.stringify({ url: 'https://www.tesla.com/findus', sites: part.map(function (s) { return { id: s.id, lat: s.lat, lng: s.lng }; }), tesla: isTesla, max: 60 }));
      if (r && r.blocked) { var e = new Error('Tesla\'s charger map asked for a check, so Supercharger prices are estimates this time.'); e.partial = out; throw e; }
      if (r && r.error === 'No Native bridge') return out;   // the desktop preview has no hidden pages
      if (!r || r.error) throw new Error('Tesla\'s charger map didn\'t answer (' + (r && r.error || 'no reply') + ').');
      part.forEach(function (st) { var x = r.sites && r.sites[st.id]; if (x && x.currency === 'USD') { out[st.id] = x; keep('tesla-v1|' + (isTesla ? 't' : 'n') + '|' + st.id, x); } else keep('tesla-v1|' + (isTesla ? 't' : 'n') + '|' + st.id, { none: true }); });
    }
    return out;
  }

  // ---------- ChargePoint: its public station page (chargepoint_worker.js), the host-set price, one station per read ----------
  /** The price part of a station page's text → {rate, peak, low, uom, fee, free} or null. "Energy Rate $0.44 / kWh", "$2.00 / hr", "Free". */
  function parseChargePoint(text) {
    var t = String(text || '').replace(/\s+/g, ' '), rates = [], m, re = /\b(?:Energy|Charging|Time)\s*(?:Rate|Fee)?\s*:?\s*\$\s*(\d*\.?\d+)\s*\/\s*(kwh|hr|hour|min(?:ute)?)/gi;
    while ((m = re.exec(t))) rates.push({ v: +m[1], uom: /kwh/i.test(m[2]) ? 'kwh' : /min/i.test(m[2]) ? 'min' : 'hour' });
    var feeM = /\b(?:Session|Flat|Connection|Plug-?in|Start)\s*(?:Rate|Fee)\s*:?\s*\$\s*(\d*\.?\d+)/i.exec(t), fee = feeM ? +feeM[1] : 0;
    if (!rates.length) return /\bFree\b/i.test(t) && !/\$\s*\d/.test(t) ? { rate: 0, peak: 0, low: 0, uom: 'kwh', fee: 0, free: true } : null;
    var uom = rates[0].uom, v = rates.filter(function (r) { return r.uom === uom; }).map(function (r) { return r.v; });
    return { rate: Math.max.apply(null, v), peak: Math.max.apply(null, v), low: Math.min.apply(null, v), uom: uom, fee: fee };
  }
  /** ChargePoint device IDs to try for a DOE station: its posts minus the port digit ("27029811" → "2702981"), then the posts. */
  function chargePointIds(st) { var posts = (st.netIds && st.netIds.posts || []).filter(function (p) { return /^\d{5,12}$/.test(p); }), out = []; posts.forEach(function (p) { var d = p.slice(0, -1); if (out.indexOf(d) < 0) out.push(d); }); posts.forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); }); return out.slice(0, 4); }
  async function chargePointPrice(st) {
    var ids = chargePointIds(st), key = 'cp-v1|' + ids.join(','), c = cached(key, DAY); if (!ids.length) return null; if (c) return c.none ? null : c;
    for (var i = 0; i < ids.length; i++) {
      var r = await call('siteRead', 'chargepoint', JSON.stringify({ url: 'https://driver.chargepoint.com/stations/' + ids[i] }));
      if (r && r.error === 'No Native bridge') return null;
      if (r && r.blocked) { var e = new Error('ChargePoint\'s station page asked for a check, so its prices are estimates this time.'); e.blocked = true; throw e; }
      if (r && r.missing) continue;
      var p = r && r.text ? parseChargePoint(r.text) : null;
      LG.info('stations', 'ChargePoint station page', { idForm: i < ids.length / 2 ? 'device' : 'post', found: !!(r && r.text), priced: !!p, error: r && r.error ? String(r.error).slice(0, 120) : undefined });
      if (r && r.text) { keep(key, p || { none: true }); return p; }
    }
    keep(key, { none: true }); return null;
  }

  /** Give each station (that a network publishes a price for) `netPrice`. items: [{st, dc, kw}]. Returns {priced, notes}. */
  async function annotate(items, car, onProg) {
    var notes = [], priced = 0, t = Date.now(), isTesla = /tesla/i.test(car && car.make || '');
    if (S.evNetPrices === false || !items.length) return { priced: 0, notes: notes };
    var by = { tesla: [], ionna: [], blink: [], chargepoint: [] };
    items.forEach(function (x) { var n = String(x.st.network || ''); if (/^tesla(?! destination)/i.test(n) && x.dc) by.tesla.push(x); else if (/ionna/i.test(n)) by.ionna.push(x); else if (/^blink/i.test(n)) by.blink.push(x); else if (/^chargepoint/i.test(n) && chargePointIds(x.st).length) by.chargepoint.push(x); });
    // ChargePoint reads one page per station: fast chargers first, at most 20 a trip (cached a day)
    by.chargepoint = by.chargepoint.sort(function (a, b) { return (b.dc ? 1 : 0) - (a.dc ? 1 : 0); }).slice(0, 20);
    var set = function (x, p, src, label) { x.st.netPrice = Object.assign({ src: src, label: label, t: t }, p); priced++; };
    var total = by.tesla.length + by.ionna.length + by.blink.length + by.chargepoint.length, done = 0, step = function () { done++; if (onProg) onProg(done / Math.max(1, total)); };
    if (by.ionna.length) try { var ion = await ionnaSites(); by.ionna.forEach(function (x) { var s = nearest(x.st, ion, 250); if (s && s.open) set(x, { rate: s.rate, peak: s.rate, low: s.rate, uom: 'kwh', fee: 0, tax: s.tax }, 'ionna', 'IONNA\'s published rate' + (s.tax ? ' plus tax' : '')); step(); }); }
      catch (e) { notes.push('IONNA\'s price list didn\'t load: ' + e.message); }
    if (by.blink.length) try {
      var bs = await blinkSites(), queue = by.blink.map(function (x) { return { x: x, s: nearest(x.st, bs, 200) }; }).filter(function (q) { return q.s; }).slice(0, 80);
      var lane = async function () { while (queue.length) { var q = queue.shift(); try { var p = await blinkPrice(q.s.id, q.x.dc); if (p) set(q.x, p, 'blink', 'The charger\'s host-set Blink rate' + (p.fee ? ' + $' + p.fee.toFixed(2) + ' session fee' : '')); } catch (e) { } step(); await new Promise(function (ok) { setTimeout(ok, 250); }); } };
      await Promise.all([lane(), lane(), lane()]);
    } catch (e) { notes.push('Blink\'s charger map didn\'t load: ' + e.message); }
    if (by.tesla.length) try { var tp = await teslaPrices(by.tesla.map(function (x) { return x.st; }), isTesla); by.tesla.forEach(function (x) { var p = tp[x.st.id]; if (p) set(x, { rate: p.peak, peak: p.peak, low: p.low, uom: p.uom, fee: 0, congestion: p.congestion, tou: p.tou }, 'tesla', 'Tesla\'s published ' + (isTesla ? 'Tesla-owner' : 'non-Tesla') + ' rate' + (p.tou && p.low < p.peak ? ' (peak; off-peak $' + p.low.toFixed(2) + ')' : '')); step(); }); }
      catch (e) { notes.push(e.message); if (e.partial) by.tesla.forEach(function (x) { var p = e.partial[x.st.id]; if (p) set(x, { rate: p.peak, peak: p.peak, low: p.low, uom: p.uom, fee: 0 }, 'tesla', 'Tesla\'s published rate'); }); }
    for (var ci = 0; ci < by.chargepoint.length; ci++) { var cx = by.chargepoint[ci]; try { var cpP = await chargePointPrice(cx.st); if (cpP) set(cx, cpP, 'chargepoint', cpP.free ? 'Free, set by the station\'s host on ChargePoint' : 'The station host\'s ChargePoint rate' + (cpP.fee ? ' + $' + cpP.fee.toFixed(2) + ' session fee' : '')); } catch (e) { if (e.blocked) { notes.push(e.message); break; } } step(); }
    LG.info('stations', 'Charger network prices', { tesla: by.tesla.length, ionna: by.ionna.length, blink: by.blink.length, chargepoint: by.chargepoint.length, priced: priced, ms: Date.now() - t });
    return { priced: priced, notes: notes };
  }
  root.EVPrices = { annotate: annotate, parseIonna: parseIonna, parseBlinkPrice: parseBlinkPrice, parseChargePoint: parseChargePoint, chargePointIds: chargePointIds, money: money };
})(window);
