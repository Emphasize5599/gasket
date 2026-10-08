/* Pricing engine: brand detection, Google fuelOptions parsing, and the discount stack.
 * Rules (verified Oct 2026):
 *  - Walmart+: 10¢/gal at Walmart, Murphy USA/Express, Exxon, Mobil, CITGO; 5¢ in Alabama.
 *    Sam's Club: Walmart+ members get Sam's member pricing at the pump.
 *  - Exxon/Mobil: the Walmart+ discount does NOT stack with Exxon Mobil Rewards+.
 *  - CITGO: Walmart+ discount via linked Club CITGO account, and Club CITGO rewards still earn
 *    (Club 3¢, Premier 6¢; one Friday/month +2¢; one "Triple Tuesday"/month = 3x), up to 30 gal.
 */
(function (root) {
  var BRANDS = {
    walmart: { name: 'Walmart Fuel', short: 'W', color: '#0071DC', query: 'Walmart Fuel Station',
      howTo: 'Walmart app → Gas Savings → scan the QR code on the pump, then pick your grade.' },
    murphy: { name: 'Murphy USA', short: 'M', color: '#1B3C87', query: 'Murphy USA',
      howTo: 'Enter the 6‑digit discount ID from the Walmart app at the pump (or give it to the cashier).' },
    sams: { name: "Sam's Club", short: 'S', color: '#0B6FA4', query: "Sam's Club Gas Station",
      howTo: "Walmart app → scan the QR code on the Sam's pump for member pricing." },
    exxon: { name: 'Exxon', short: 'X', color: '#E01B22', query: 'Exxon',
      howTo: 'Walmart app → scan the pump QR → "Fuel up for less" → enter pump number.' },
    mobil: { name: 'Mobil', short: 'Mo', color: '#1652B5', query: 'Mobil',
      howTo: 'Walmart app → scan the pump QR → "Fuel up for less" → enter pump number.' },
    citgo: { name: 'CITGO', short: 'C', color: '#D3202F', query: 'CITGO',
      howTo: 'Link Club CITGO in the Walmart app (Gas Savings). At the pump enter your Club CITGO Alt ID (phone #); both discounts apply.' }
  };

  var GRADES = {
    regular: { label: 'Regular', types: ['REGULAR_UNLEADED', 'E10'] },
    midgrade: { label: 'Midgrade', types: ['MIDGRADE'] },
    premium: { label: 'Premium', types: ['PREMIUM', 'SP98', 'SP95', 'SP91'] },
    diesel: { label: 'Diesel', types: ['DIESEL', 'TRUCK_DIESEL'] }
  };

  var DEFAULTS = {
    apiKey: '',
    blacklist: [],               // CITGO stations where Walmart+ didn't work: [{id, name, address, brand, lat, lng, t}]
    dieselRisk: {},              // station id -> true: count Walmart+ on CITGO diesel here anyway (your own risk)
    autoRefresh: false,
    hideUnpriced: false,         // map and list only; trips still consider them (estimated) where nothing priced is in reach
    confirmDeletes: true,        // ask before deleting anything (Settings → General)
    nrelKey: '',                 // your own free key for the DOE station finder (blank = the shared DEMO_KEY); never logged or exported
    evPrice: 0.48,               // $/kWh you expect at DC fast chargers (the station finder rarely has prices)
    h2Price: 36,                 // $/kg you expect for hydrogen
    walmartPlus: true,
    samsMode: 'member',          // 'member' = Google's Sam's price is already member price; 'minus10' = take 10¢ more
    citgoTier: 'club',           // 'none' | 'club' | 'premier'
    citgoUsed: { tuesday: '', friday: '' },   // month ("2026-10") you already used that monthly bonus in
    cashbackPct: 0,              // card cash back applied to the final pump charge
    grade: 'regular',
    radiusMi: 8,
    monthlyCap: 900,
    staleHours: 30,
    walmartDirect: true,
    brands: { walmart: true, murphy: true, sams: true, exxon: true, mobil: true, citgo: true }
  };

  /** Brand from the station's name, or failing that from the brand website Google lists for it
   *  (independently owned stations are often named after the owner, e.g. "Smith Fuel", but link to exxon.com). */
  function detectBrand(name, website) {
    var n = String(name || '').toLowerCase().replace(/[’`]/g, "'");
    if (/sam'?s club/.test(n)) return 'sams';
    if (/walmart/.test(n)) return 'walmart';
    if (/murphy/.test(n)) return 'murphy';
    if (/exxon/.test(n)) return 'exxon';
    if (/\bmobil\b/.test(n)) return 'mobil';
    if (/citgo/.test(n)) return 'citgo';
    var host = '';
    try { host = String(website || '').toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].replace(/^www\./, ''); } catch (e) { }
    if (!host) return null;
    if (/(^|\.)samsclub\.com$/.test(host)) return 'sams';
    if (/(^|\.)murphy(usa|express|driverewards)\.com$/.test(host)) return 'murphy';
    if (/(^|\.)mobil\.com$/.test(host)) return 'mobil';
    if (/(^|\.)(exxon|exxonmobil|exxonmobilfuels)\.com$/.test(host)) return 'exxon';
    if (/(^|\.)citgo\.com$/.test(host)) return 'citgo';
    return null;
  }

  function moneyToNumber(p) {
    if (!p) return null;
    var u = Number(p.units || 0), n = Number(p.nanos || 0);
    var v = u + n / 1e9;
    return isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : null;
  }

  function stateOf(place) {
    var comps = place.addressComponents || [];
    for (var i = 0; i < comps.length; i++) {
      if ((comps[i].types || []).indexOf('administrative_area_level_1') >= 0) return comps[i].shortText || '';
    }
    var m = /,\s*([A-Z]{2})\s+\d{5}/.exec(place.formattedAddress || '');
    return m ? m[1] : '';
  }

  /** Normalise a Places API (New) result into our station shape (null if not a brand we track). */
  function normalize(place) {
    var name = place.displayName && place.displayName.text;
    var brand = detectBrand(name, place.websiteUri);
    if (!brand || !place.location) return null;
    if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') return null;
    var prices = {};
    var fp = (place.fuelOptions && place.fuelOptions.fuelPrices) || [];
    Object.keys(GRADES).forEach(function (g) {
      var types = GRADES[g].types;
      for (var t = 0; t < types.length; t++) {
        for (var i = 0; i < fp.length; i++) {
          if (fp[i].type === types[t]) {
            var v = moneyToNumber(fp[i].price);
            if (v != null) { prices[g] = { price: v, updated: fp[i].updateTime || null }; return; }
          }
        }
      }
    });
    return {
      id: place.id, brand: brand, name: name, address: place.formattedAddress || '',
      state: stateOf(place), lat: place.location.latitude, lng: place.location.longitude,
      mapsUri: place.googleMapsUri || '', prices: prices, source: 'Google',
      google: !/^demo/.test(place.id)          // Google Places content: shown with a "Google Maps" credit (demo stations are made up)
    };
  }

  var WM_GRADES = { UNLEAD: 'regular', MIDGRAD: 'midgrade', PREMIUM: 'premium', DIESEL: 'diesel' };

  /** Walmart's own price record for one store (from walmart.com/store/<id>) -> our station shape. */
  function normalizeWalmart(w) {
    if (!w || !w.geo || !w.fuel || !w.fuel.prices) return null;
    var prices = {}, updated = (w.fuel.metadata && w.fuel.metadata.dateCreated) || null;
    w.fuel.prices.forEach(function (p) {
      var g = WM_GRADES[p.name] || (/unlead/i.test(p.displayName) ? 'regular' : /mid/i.test(p.displayName) ? 'midgrade' :
        /prem/i.test(p.displayName) ? 'premium' : /diesel/i.test(p.displayName) ? 'diesel' : null);
      var v = Number(p.price);
      if (g && isFinite(v) && v > 0) prices[g] = { price: Math.round(v * 1000) / 1000, updated: updated };
    });
    var a = w.address || {};
    return {
      id: 'wm-' + w.id, wmStoreId: String(w.id), brand: 'walmart', name: 'Walmart Fuel Station',
      address: [a.addressLineOne, a.city, (a.state || '') + ' ' + (a.postalCode || '')].filter(Boolean).join(', '),
      state: a.state || '', lat: w.geo.latitude, lng: w.geo.longitude, mapsUri: '', prices: prices,
      source: 'walmart.com', storeName: w.name
    };
  }

  var MU_GRADES = { Regular: 'regular', Midgrade: 'midgrade', Premium: 'premium', Diesel: 'diesel' };

  /** One store from Murphy USA's store finder (api/store) -> our station shape. */
  function normalizeMurphy(m) {
    if (!m || m.latitude == null || m.longitude == null || m.closeDate) return null;
    var prices = {};
    (m.gasPrices || []).forEach(function (g) {
      var k = MU_GRADES[g.fuelType], v = Number(g.price);
      if (k && isFinite(v) && v > 0) prices[k] = { price: Math.round(v * 1000) / 1000, updated: g.lastUpdateUtc || null };
    });
    var ethanolFree = (m.gasPrices || []).filter(function (g) { return g.fuelType === 'PremiumNoEthanol'; })[0];
    return {
      id: 'mu-' + m.id, brand: 'murphy', name: m.chainName || 'Murphy USA',
      address: [m.address, m.city, (m.state || '') + ' ' + (m.zip || '')].filter(Boolean).join(', '),
      state: m.state || '', lat: Number(m.latitude), lng: Number(m.longitude), mapsUri: '', prices: prices,
      source: 'murphyusa.com', murphyStore: m.storeNumber,
      extra: ethanolFree ? { label: 'Premium ethanol-free', price: Math.round(Number(ethanolFree.price) * 1000) / 1000 } : null
    };
  }

  var MATCH_MI = { walmart: 0.6, murphy: 0.35, citgo: 0.2 };

  /** Put each chain's official prices onto the matching Google station (same brand, very close by),
   *  or add the official station if Google didn't return it. Never mutates its inputs. */
  function mergeOfficial(googleStations, official) {
    var out = googleStations.map(function (s) { return Object.assign({}, s); });
    official.forEach(function (w) {
      if (!w || !Object.keys(w.prices).length) return;
      var best = null, bestD = MATCH_MI[w.brand] || 0.3;
      out.forEach(function (s) {
        if (s.brand !== w.brand || s._official) return;
        var d = haversineMi(s.lat, s.lng, w.lat, w.lng);
        if (d < bestD) { bestD = d; best = s; }
      });
      if (best) {
        best.prices = w.prices; best.source = w.source; best._official = true;
        ['wmStoreId', 'storeName', 'murphyStore', 'extra'].forEach(function (k) { if (w[k] != null) best[k] = w[k]; });
        if (w.brand === 'murphy') best.name = w.name;
      } else out.push(Object.assign({ _official: true }, w));
    });
    return out;
  }
  function mergeWalmart(g, w) { return mergeOfficial(g, w); }

  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function monthKey(d) { d = d || new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1); }
  /**
   * Club CITGO's monthly bonuses apply on their own day: Triple Tuesday (3× the everyday reward: 9¢ Club / 18¢ Premier)
   * on a Tuesday, and Friday Savings (5¢ Club / 8¢ Premier) on a Friday — each once a month, on the first fill that day,
   * so they stop once you mark them used for the month. d = when you'll be at the pump.
   */
  function citgoBonus(s, d) {
    d = d || new Date();
    var used = s.citgoUsed || {}, day = d.getDay(), mk = monthKey(d);
    if (day === 2 && used.tuesday !== mk) return 'tuesday';
    if (day === 5 && used.friday !== mk) return 'friday';
    return 'none';
  }
  function r3(x) { return Math.round(x * 1000) / 1000; }

  /** Is this station on your bad-CITGO list? Same Google place, or the same brand within ~250 ft (lists shared between people). */
  function isBad(station, s) {
    var bl = s && s.blacklist; if (!bl || !bl.length) return false;
    for (var i = 0; i < bl.length; i++) {
      var e = bl[i];
      if (e.id && e.id === station.id) return true;
      if (e.brand === station.brand && e.lat != null && station.lat != null && haversineMi(e.lat, e.lng, station.lat, station.lng) < 0.05) return true;
    }
    return false;
  }
  /** Returns {base, final, steps:[{label, amount, note}], notes:[], updated} or null if no price for grade. */
  /** at: when you'll be at the pump (for day-based rewards); defaults to now. */
  function compute(station, grade, s, now, at) {
    var gp = station.prices[grade];
    if (!gp) return null;
    s = s || DEFAULTS;
    var steps = [{ label: 'Posted price (' + (station.source || 'Google') + ')', amount: gp.price, kind: 'base' }];
    var notes = [];
    var running = gp.price;
    var b = station.brand;
    var al = station.state === 'AL';
    var wpAmt = al ? 0.05 : 0.10;
    function add(label, amt, note) {
      if (!amt) return;
      amt = r3(amt);
      steps.push({ label: label, amount: amt, note: note || '' });
      running = r3(running + amt);
    }

    if (s.walmartPlus) {
      if (b === 'sams') {
        if (s.samsMode === 'minus10') add('Walmart+ discount', -0.10);
        else steps.push({ label: "Walmart+ → Sam's member price", amount: 0,
          note: "Google's Sam's Club price is normally the member price, which Walmart+ unlocks." });
      } else if ((b === 'exxon' || b === 'mobil') && station.wplus === false) {
        steps.push({ label: 'Walmart+ discount', amount: 0, kind: 'none', note: "This station isn't in the Walmart+ program (ExxonMobil's station finder doesn't list it)." });
        notes.push("Not a Walmart+ station: ExxonMobil's station finder lists it without Walmart+, so no 10¢ here.");
      } else if (b === 'citgo' && isBad(station, s)) {
        steps.push({ label: 'Walmart+ discount', amount: 0, kind: 'none', note: 'You marked this CITGO as not taking Walmart+ (Settings → Bad CITGO stations).' });
        notes.push('On your bad CITGO list: Walmart+ didn\'t work here, so no 10¢.');
      } else if (b === 'citgo' && grade === 'diesel' && !(s.dieselRisk && s.dieselRisk[station.id])) {
        steps.push({ label: 'Walmart+ discount', amount: 0, kind: 'none', note: 'Not counted on CITGO diesel: diesel pumps often run on a separate checkout that Club CITGO (and Walmart+) can\'t use.' });
        notes.push('Walmart+ may not work on diesel at this CITGO (separate diesel pumps). Not counted — you can count it anyway at your own risk.');
      } else {
        add('Walmart+ discount' + (al ? ' (Alabama rate)' : ''), -wpAmt);
      }
      if ((b === 'exxon' || b === 'mobil') && station.wplus !== false) notes.push("Doesn't stack with Exxon Mobil Rewards+ — no points earned on this fill." + (station.wplus === true ? ' Listed as a Walmart+ station by ExxonMobil.' : ''));
    }

    if (b === 'citgo' && s.citgoTier && s.citgoTier !== 'none') {
      var base = s.citgoTier === 'premier' ? 0.06 : 0.03;
      var bonus = citgoBonus(s, at || now);
      var rate = base, label = 'Club CITGO ' + (s.citgoTier === 'premier' ? 'Premier reward' : 'reward');
      var when = at && at.toDateString() !== (now || new Date()).toDateString() ? ' — ' + at.toLocaleDateString([], { weekday: 'short' }) + ' when you get there' : '';
      if (bonus === 'tuesday') { rate = base * 3; label += ' ×3 (Triple Tuesday' + when + ')'; }
      else if (bonus === 'friday') { rate = base + 0.02; label += ' +2¢ (Friday Savings' + when + ')'; }
      add(label, -rate, 'Applies to up to 30 gal per fill-up.');
    }

    var cb = Number(s.cashbackPct) || 0;
    if (cb > 0) add(cb + '% card cash back', -running * cb / 100, 'Paid back later by your card, not at the pump.');

    var updated = gp.updated ? new Date(gp.updated) : null;
    var ageH = updated ? ((now || new Date()) - updated) / 3.6e6 : null;
    return { base: gp.price, final: r3(running), steps: steps, notes: notes, updated: updated,
      ageHours: ageH, stale: ageH == null || ageH > (s.staleHours || 24) };
  }

  /** "$2.89⁹" style: dollars + cents, with the tenth-of-a-cent as superscript (like a pump sign). */
  // Settings → "Show prices to the cent": every price shown rounded UP to the cent ($3.199 -> $3.20). Display only.
  var centsOn = false;
  function setCents(on) { centsOn = !!on; }
  function up(v) { return Math.ceil(v * 100 - 1e-6) / 100; }
  function fmtSign(v) {
    if (centsOn) return { main: (v < 0 ? '−$' : '$') + Math.abs(up(v)).toFixed(2), tenth: '' };
    var m = Math.round(v * 1000);
    var tenth = m % 10, cents = (m - tenth) / 1000;
    return { main: '$' + cents.toFixed(2), tenth: tenth ? String(tenth) : '' };
  }
  function fmt3(v) { if (centsOn) return up(v).toFixed(2); var s = (Math.round(v * 1000) / 1000).toFixed(3); return s.slice(-1) === '0' ? s.slice(0, -1) : s; }

  function haversineMi(a, b, c, d) {
    var R = 3958.8, toR = Math.PI / 180;
    var dLat = (c - a) * toR, dLng = (d - b) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // words that only say what brand or kind of place it is ("Exxon", "Walmart Fuel Station", "Sam's Club Gas Station #4")
  var GENERIC = /\b(walmart|wal-mart|murphy|usa|sam'?s|club|exxon|mobil|exxonmobil|citgo|fuel|gas|gasoline|station|stations|center|centre|petrol|food mart|mart|the|and|of|at|store|inc|llc|co|corp|supercenter|neighborhood market|\d+)\b/gi;
  /**
   * The name to show for a station: its own name when it has one ("Quick Stop", "Murphy Express", "Kum & Go"),
   * otherwise the brand's (the logo already says which brand it is).
   */
  function displayName(st) {
    if (!st) return '';
    if (ALT[st.brand]) return st.name || ALT[st.brand].name;   // chargers and hydrogen stations: their own name
    var br = BRANDS[st.brand] || { name: '' };
    var own = function (n) {
      n = String(n || '').trim(); if (!n) return '';
      var rest = n.replace(/’/g, "'").replace(GENERIC, ' ').replace(/[#&'.,\-–—|()\/]+/g, ' ').replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();
      return /[a-z]{2}/i.test(rest) ? n : '';
    };
    return own(st.name) || own(st.altName) || br.name || st.name || '';
  }

  // not gas brands: EV chargers and hydrogen stations (DOE station finder), only for EV / fuel-cell cars
  var ALT = {
    ev: { name: 'EV charger', short: '⚡', color: '#12a150' },
    h2: { name: 'Hydrogen', short: 'H₂', color: '#0e7fc0' }
  };
  /** A gas brand, a charger / hydrogen station, or a plain gray stand-in — never undefined. */
  function brand(b) { return BRANDS[b] || ALT[b] || { name: '', short: '?', color: '#777' }; }

  var api = { BRANDS: BRANDS, ALT: ALT, brand: brand, displayName: displayName, GRADES: GRADES, DEFAULTS: DEFAULTS, detectBrand: detectBrand, normalize: normalize, normalizeWalmart: normalizeWalmart, normalizeMurphy: normalizeMurphy, mergeOfficial: mergeOfficial, mergeWalmart: mergeWalmart,
    compute: compute, isBad: isBad, fmtSign: fmtSign, fmt3: fmt3, setCents: setCents, haversineMi: haversineMi, todayKey: todayKey, monthKey: monthKey, citgoBonus: citgoBonus, moneyToNumber: moneyToNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Pricing = api;
})(this);
