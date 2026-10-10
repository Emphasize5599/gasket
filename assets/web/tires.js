/* Gasket — Tires (Garage). The car's factory size (from Tire Rack for the year / make / model / trim, or typed from the door
 * sticker), the tires sold in that size (type -> brand -> model, read from Tire Rack), the wear rating, and how much tread is
 * left (measured, or estimated from miles and rotation). TireMath is pure and runs in Node for the tests; Advisory uses it. */
(function (root) {
  'use strict';
  // ---------- the math ----------
  var ROT = { yes: 1, sometimes: 0.9, no: 0.75, unsure: 0.85 };
  /** A new tire's tread depth in 32nds of an inch, by type (typical, when the maker's figure isn't known). */
  function newDepth(type) {
    var t = String(type || '').toLowerCase();
    return /mud/.test(t) ? 15 : /terrain|off/.test(t) ? 13 : /winter|snow|ice|studless/.test(t) ? 12 : /summer|ultra high|max performance/.test(t) ? 9 : 10;
  }
  /** Miles a set should last: the maker's mileage warranty, else the wear rating x 100, else 50,000. */
  function lifeMiles(t) {
    if (+t.warrantyMi > 0) return +t.warrantyMi;
    if (t.utqg && +t.utqg.tw > 0) return Math.max(25000, Math.min(90000, +t.utqg.tw * 100));
    return 50000;
  }
  /** -> { depth (32nds), measured } or null. Wear runs from new down to 2/32 over the expected life; skipped rotations wear
   *  some tires faster (the worst one is what matters). Tires that aren't all the same: the shallowest one measured. */
  function estimate(t) {
    var w = worst(t); if (w) return { depth: w.depth, measured: true, corner: w.k };
    var r = t && t.tread; if (!r) return null;
    if (r.mode === 'measure') return +r.depth > 0 ? { depth: +r.depth, measured: true } : null;
    if (r.miles === '' || r.miles == null || !(+r.miles >= 0)) return null;
    var nd = +t.newDepth || newDepth(t.type), life = lifeMiles(t), f = ROT[r.rotated] || ROT.unsure;
    var d = nd - (nd - 2) * (+r.miles) / (life * f);
    return { depth: Math.max(0, Math.round(d * 2) / 2), measured: false, life: life, factor: f, newDepth: nd };
  }
  /** good (6+/32), ok (4-5.5: plan new ones), low (above 2: replace soon), worn (2/32 or less). */
  function status(depth) { return depth >= 6 ? 'good' : depth >= 4 ? 'ok' : depth > 2 ? 'low' : 'worn'; }
  var MULTI = ['BF GOODRICH', 'MICKEY THOMPSON', 'DICK CEPEK', 'GT RADIAL', 'MASTER CRAFT'];
  var SPELL = { 'BF GOODRICH': 'BFGoodrich', BFGOODRICH: 'BFGoodrich', 'GT RADIAL': 'GT Radial', 'MASTER CRAFT': 'Mastercraft', BRIDGESTONE: 'Bridgestone', 'MICKEY THOMPSON': 'Mickey Thompson', 'DICK CEPEK': 'Dick Cepek' };
  /** "CONTINENTAL SECURECONTACT AW" -> { brand: 'Continental', model: 'SecureContact AW'-ish }. */
  function split(name) {
    var n = String(name || '').trim(), b = MULTI.filter(function (m) { return n.indexOf(m + ' ') === 0; })[0] || n.split(' ')[0];
    var tc = function (s) { return s.toLowerCase().replace(/(^|[\s\-\/])([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); }); };
    return { brand: SPELL[b] || tc(b), model: n.slice(b.length).trim() };
  }
  /** "195/65-15", "195/65 R15", "p195/65r15" -> "195/65R15" (or '' if it isn't a size). */
  function normSize(s) { var m = /(\d{3})\s*\/\s*(\d{2})\s*(?:-|Z?R)?\s*(\d{2})/i.exec(String(s || '')); return m ? m[1] + '/' + m[2] + 'R' + m[3] : ''; }
  // ---------- each corner ----------
  var CORNERS = [{ k: 'lf', name: 'Driver front', short: 'Driver front' }, { k: 'rf', name: 'Passenger front', short: 'Pass. front' },
    { k: 'lr', name: 'Driver rear', short: 'Driver rear' }, { k: 'rr', name: 'Passenger rear', short: 'Pass. rear' }];
  var CNAME = { lf: 'driver front', rf: 'passenger front', lr: 'driver rear', rr: 'passenger rear' };
  /** The four corners' depths when your tires aren't all the same: { lf, rf, lr, rr } (numbers, or null when not given). */
  function corners(t) {
    var C = t && t.corners; if (!C || !C.split) return null;
    var o = {}; CORNERS.forEach(function (x) { var d = C[x.k] && +C[x.k].depth; o[x.k] = d > 0 ? d : null; });
    return o;
  }
  /**
   * Every tire position, in order: the four corners (a dually's rear ones are the outer tires, with an inner tire beside
   * each), then a trailer's axles (2 or 4 tires each). -> [{ k, name, group }]. Older saves' "extra wheels" become these.
   */
  function positions(t) {
    var C = (t && t.corners) || {};
    upgrade(C);
    var P = [{ k: 'lf', name: 'Driver front', group: 'Front' }, { k: 'rf', name: 'Passenger front', group: 'Front' }];
    if (C.dually) P.push({ k: 'lr', name: 'Driver rear, outer', group: 'Rear' }, { k: 'lri', name: 'Driver rear, inner', group: 'Rear' }, { k: 'rri', name: 'Passenger rear, inner', group: 'Rear' }, { k: 'rr', name: 'Passenger rear, outer', group: 'Rear' });
    else P.push({ k: 'lr', name: 'Driver rear', group: 'Rear' }, { k: 'rr', name: 'Passenger rear', group: 'Rear' });
    var T = C.trailer;
    if (T && T.on) for (var a = 1; a <= T.axles; a++) {
      var g = 'Trailer axle ' + a;
      if (T.per === 4) P.push({ k: 't' + a + 'lo', name: g + ', driver side outer', group: g }, { k: 't' + a + 'li', name: g + ', driver side inner', group: g }, { k: 't' + a + 'ri', name: g + ', passenger side inner', group: g }, { k: 't' + a + 'ro', name: g + ', passenger side outer', group: g });
      else P.push({ k: 't' + a + 'l', name: g + ', driver side', group: g }, { k: 't' + a + 'r', name: g + ', passenger side', group: g });
    }
    return P;
  }
  /** 0.0.69–0.0.75 kept dual and trailer tires as a free list: those become the dually's inner tires and a trailer axle. */
  function upgrade(C) {
    if (!C || !C.extra || !C.extra.length) return;
    var duals = C.extra.filter(function (e) { return e.kind === 'dual'; }), tr = C.extra.filter(function (e) { return e.kind === 'trailer'; });
    if (duals.length) { C.dually = true; ['lri', 'rri'].forEach(function (k, i) { if (duals[i] && !C[k]) C[k] = { depth: duals[i].depth }; }); }
    if (tr.length) { C.trailer = C.trailer || { on: true, axles: Math.min(3, Math.ceil(tr.length / 2)), per: 2 }; ['t1l', 't1r', 't2l', 't2r', 't3l', 't3r'].forEach(function (k, i) { if (tr[i] && !C[k]) C[k] = { depth: tr[i].depth }; }); }
    C.extra = [];
  }
  /** The shallowest tire you measured (any position), or null. */
  function worst(t) {
    if (!corners(t)) return null;
    var got = positions(t).map(function (p) { var d = t.corners[p.k] && +t.corners[p.k].depth; return { k: p.k, name: p.name, depth: d > 0 ? d : null }; }).filter(function (x) { return x.depth != null; });
    return got.length ? got.sort(function (a, b) { return a.depth - b.depth; })[0] : null;
  }
  /**
   * Where each tire should go (depths in 32nds; drive 'fwd' | 'rwd' | 'awd' | '4wd'). The better pair goes on the rear:
   * with less grip at the back, a wet curve or a hydroplane can swing the rear out (oversteer, a spin); with the better
   * grip there, the car tends to run wide instead (understeer), which easing off fixes. A tire at 4/32 or less never moves to
   * the rear: those are replaced (on a front-wheel-drive car with worn fronts: replace the fronts, new ones on the rear).
   * -> { kind: 'even' | 'move' | 'replace', moves: [{ from, to }], replace: [keys], notes: [text], pattern } or null.
   */
  function rotation(d, drive, duals) {
    if (!d || CORNERS.some(function (x) { return !(d[x.k] > 0); })) return null;
    drive = String(drive || '').toLowerCase();
    var keys = CORNERS.map(function (x) { return x.k; }), notes = [];
    // a dually's pair on each side carries the load together: a shallower one is a smaller tire, and the deeper one does the work
    if (duals) [['lr', 'lri', 'driver'], ['rr', 'rri', 'passenger']].forEach(function (p) {
      var a = d[p[0]], b = duals[p[1]]; if (!(a > 0 && b > 0)) return;
      if (Math.abs(a - b) >= 2) notes.push('The ' + p[2] + '-side rear duals differ by ' + Math.abs(a - b) + '/32 in. Duals should match within about 2/32 in, or the bigger one carries the load and wears out fast; swap or replace to match them.');
      if (Math.min(a, b) <= 4) notes.push('A ' + p[2] + '-side rear dual is down to ' + Math.min(a, b) + '/32 in: replace it (as a matched pair).');
    });
    var min = Math.min.apply(null, keys.map(function (k) { return d[k]; })), max = Math.max.apply(null, keys.map(function (k) { return d[k]; }));
    var pattern = drive === 'fwd' ? 'front-wheel drive: the front tires go straight back, and the rear ones cross to the front' :
      drive === 'rwd' || drive === 'awd' || drive === '4wd' ? (drive === 'rwd' ? 'rear-wheel drive' : drive === 'awd' ? 'all-wheel drive' : 'four-wheel drive') + ': the rear tires go straight forward, and the front ones cross to the back' :
      'the usual pattern for your drive (front-wheel drive: fronts straight back, rears cross forward; rear- or all-wheel drive: rears straight forward, fronts cross back)';
    if (Math.abs(d.lf - d.rf) >= 2) notes.push('The front tires differ by ' + Math.abs(d.lf - d.rf) + '/32 in side to side: have the alignment checked.');
    if (Math.abs(d.lr - d.rr) >= 2) notes.push('The rear tires differ by ' + Math.abs(d.lr - d.rr) + '/32 in side to side: have the alignment checked.');
    if ((drive === 'awd' || drive === '4wd') && max - min > 2) notes.push('All- and four-wheel drive need all four tires within about 2/32 in of each other, or the drivetrain strains. When you replace, replace all four (or have a new tire shaved to match).');
    var worn = keys.filter(function (k) { return d[k] <= 4; }).sort(function (a, b) { return d[a] - d[b]; });
    if (worn.length) {
      // the worn ones are replaced (as a pair on the same axle); the new ones go on the rear
      var rep = worn.length >= 3 ? keys.slice() : (function () {
        var w = worn[0], mate = { lf: 'rf', rf: 'lf', lr: 'rr', rr: 'lr' }[w];
        return worn.length === 2 && worn.indexOf(mate) < 0 ? worn : [w, mate];
      })();
      var front = rep.indexOf('lf') >= 0 && rep.indexOf('rf') >= 0 && rep.length === 2;
      var txt = rep.length === 4 ? 'Replace all four tires.' :
        front && drive === 'fwd' ? 'Replace the two front tires instead of rotating them to the back. Put the new pair on the rear and move the rear tires to the front.' :
        'Replace the ' + rep.map(function (k) { return CNAME[k]; }).join(' and ') + ' tire' + (rep.length > 1 ? 's' : '') + '. New tires always go on the rear; the better old ones move to the front.';
      return { kind: 'replace', moves: [], replace: rep, notes: [txt].concat(notes), pattern: pattern };
    }
    if (max - min <= 1) return { kind: 'even', moves: [], replace: [], notes: ['Even wear. Keep rotating every 5,000 to 7,500 miles (' + pattern + ').'].concat(notes), pattern: pattern };
    // the two deepest to the rear, the other two to the front, each staying on its side where it can
    var byDepth = keys.slice().sort(function (a, b) { return d[b] - d[a]; });
    var place = function (pair, L, R) {
      var left = pair.filter(function (k) { return k.charAt(0) === 'l'; }), right = pair.filter(function (k) { return k.charAt(0) === 'r'; });
      if (left.length === 1) return [[left[0], L], [right[0], R]];
      return [[pair[0], L], [pair[1], R]];
    };
    var plan = place(byDepth.slice(0, 2), 'lr', 'rr').concat(place(byDepth.slice(2), 'lf', 'rf'));
    var moves = plan.filter(function (p) { return p[0] !== p[1]; }).map(function (p) { return { from: p[0], to: p[1] }; });
    if (!moves.length) return { kind: 'even', moves: [], replace: [], notes: ['The better tires are already on the rear, where they belong. Keep rotating every 5,000 to 7,500 miles (' + pattern + ').'].concat(notes), pattern: pattern };
    return { kind: 'move', moves: moves, replace: [], notes: ['Put the two best tires on the rear.'].concat(notes), pattern: pattern };
  }
  // ---------- how good: 0 (bad) .. 1 (good), and the color that says it (red -> yellow -> green) ----------
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function hue(f) { return 'hsl(' + Math.round(clamp01(f) * 120) + ', 72%, 48%)'; }
  function twGood(tw) { return +tw > 0 ? clamp01((+tw - 200) / 500) : null; }                 // 200 short .. 700+ long
  function tracGood(g) { return { AA: 1, A: 0.75, B: 0.35, C: 0 }[g]; }
  function tempGood(g) { return { A: 1, B: 0.5, C: 0 }[g]; }
  function depthGood(d) { return d == null ? null : clamp01((+d - 2) / 5); }                  // 2/32 worn .. 7/32+ plenty
  /**
   * Fuel economy out of 10, from the tire's type, its name (fuel-saving lines), treadwear and width. -> { score, base, why }.
   * (The rating model on the phone can nudge it by a point from the tire's description: nudge.)
   */
  var ECO = /ecopia|energy saver|fuel ?max|\beco|enviro|\blrr\b|low rolling|kinergy ?eco|ener ?saver|turanza eco|assurance fuel|e ?primacy|ecsta.*eco/i;
  function fuelScore(t, nudge) {
    if (!t) return null;
    var ty = String(t.type || '').toLowerCase(), name = String((t.brand || '') + ' ' + (t.model || '')), why = [];
    if (!ty && !t.model) return null;
    var b = /mud/.test(ty) ? 1 : /terrain|rugged|off/.test(ty) ? 3 : /studless|winter|snow|ice/.test(ty) && !/all-weather|all weather/.test(ty) ? 4 :
      /all-weather|all weather/.test(ty) ? 5 : /summer|max performance|ultra high/.test(ty) ? 4 : /high performance|performance all/.test(ty) ? 5 :
      /highway/.test(ty) ? 5 : /grand touring/.test(ty) ? 6 : /touring/.test(ty) ? 7 : /all-season|all season/.test(ty) ? 6 : 5;
    why.push(t.type ? t.type + ' tires' : 'a typical tire');
    var s = b;
    if (ECO.test(name)) { s += 2; why.push('a fuel-saving line'); }
    var tw = t.utqg && +t.utqg.tw;
    if (tw >= 700) { s += 0.5; why.push('a long-wearing compound'); } else if (tw > 0 && tw <= 300) { s -= 0.5; why.push('a soft, grippy compound'); }
    var w = /^(\d{3})\//.exec(String(t.size || ''));
    if (w && +w[1] >= 255) { s -= 0.5; why.push('a wide size'); } else if (w && +w[1] <= 205) { s += 0.5; why.push('a narrow size'); }
    if (nudge) s += Math.max(-1, Math.min(1, nudge));
    return { score: Math.max(1, Math.min(10, Math.round(s))), base: b, why: why };
  }
  /** Brave's answer about the spare -> 'full' | 'compact' | 'kit' | 'runflat' | 'none' | null (can't tell). */
  function parseSpare(text) {
    var t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
    if (!t) return null;
    if (/full[- ]size (matching )?spare|full-size spare|full size spare/.test(t) && !/(no|not|doesn'?t|does not)( come with| have| include)? (a )?full[- ]size spare/.test(t)) return 'full';
    if (/compact spare|temporary spare|space[- ]saver|donut|mini[- ]spare|t-type spare/.test(t)) return 'compact';
    if (/run[- ]flat/.test(t) && /(no|without|instead of a) spare/.test(t)) return 'runflat';
    if (/(repair|inflator|sealant|mobility|fix-a-flat|tire service) kit/.test(t) || /tire (sealant|inflator)/.test(t)) return 'kit';
    if (/(does not|doesn'?t|did not|didn'?t) (come with|have|include) (a )?spare|no spare tire/.test(t)) return 'none';
    return null;
  }
  var TireMath = { newDepth: newDepth, lifeMiles: lifeMiles, estimate: estimate, status: status, split: split, normSize: normSize, ROT: ROT,
    CORNERS: CORNERS, corners: corners, worst: worst, positions: positions, rotation: rotation, fuelScore: fuelScore, parseSpare: parseSpare,
    hue: hue, twGood: twGood, tracGood: tracGood, tempGood: tempGood, depthGood: depthGood };
  root.TireMath = TireMath;
  if (typeof module !== 'undefined' && module.exports) module.exports = TireMath;
  if (!root.document) return;                                   // Node: the math only

  // ---------- the card ----------
  var A = root.__app, S = A.S, N = A.N, $ = A.$, esc = A.esc, LG = root.FLog || { info: function () {}, warn: function () {} };
  var TR = 'https://www.tirerack.com/tires/';
  var TYPES = ['All-season', 'Touring all-season', 'Grand touring all-season', 'Performance all-season', 'All-weather (snow-rated)', 'Summer', 'Winter', 'All-terrain', 'Mud-terrain', 'Highway (trucks and SUVs)'];
  var RETRY_H = 6, LIST_DAYS = 30;
  var host = null, call = null, onChange = function () {}, busy = {}, open = {};
  function G() { return root.Garage; }
  function save() { A.save(); }
  function tires(c) { c.tires = c.tires || {}; if (!c.tires.tread) c.tires.tread = { mode: 'miles', miles: '', rotated: '' }; return c.tires; }
  function base(c) { return String(c.epaBase || c.vpicModel || c.model || '').replace(/\s+(2WD|4WD|AWD|FWD|RWD|4x4)$/i, '').trim(); }
  function sizeUrl(c) {
    return TR + 'SelectTireSize.jsp?autoMake=' + encodeURIComponent(c.make) + '&autoYear=' + encodeURIComponent(c.year) + '&autoModel=' + encodeURIComponent(base(c)) + '&autoModClar=' + encodeURIComponent(c.trim);
  }
  function listUrl(c, size) {
    var m = /(\d{3})\/(\d{2})R(\d{2})/.exec(size); if (!m) return '';
    return TR + 'TireSearchResults.jsp?' + (c.make && c.year && c.trim ? 'autoMake=' + encodeURIComponent(c.make) + '&autoYear=' + encodeURIComponent(c.year) + '&autoModel=' + encodeURIComponent(base(c)) + '&autoModClar=' + encodeURIComponent(c.trim) + '&' : '') +
      'width=' + m[1] + '/&ratio=' + m[2] + '&diameter=' + m[3];
  }
  function recent(x, h) { return x && Date.now() - x.t < h * 3600e3; }

  /** Tire Rack, in the background: the factory size (once per year / make / model / trim), then the tires in that size. */
  function lookup(c) {
    var t = tires(c); if (!call || !N.siteRead) return;
    if (!t.size && c.year && c.make && c.model && c.trim) {
      var key = [c.year, c.make, base(c), c.trim].join('|');
      if (busy[c.id] || (t.sizeLookup && t.sizeLookup.key === key && (t.sizeLookup.found || recent(t.sizeLookup, RETRY_H)))) return;
      busy[c.id] = 'size'; t.sizeLookup = { key: key, t: Date.now() };
      call('siteRead', 'tirerack', JSON.stringify({ url: sizeUrl(c), step: 'size' })).then(function (r) {
        busy[c.id] = false;
        r = r || {};
        if (r.factory && r.factory.length) {
          t.sizeLookup = { key: key, t: Date.now(), found: true, factory: r.factory, optional: r.optional || [] };
          if (r.factory.length === 1 && !t.size) { t.size = r.factory[0]; t.sizeSrc = 'tirerack'; }
          LG.info('car', 'Tire Rack factory size: ' + r.factory.join(', '));
        } else {
          t.sizeLookup = { key: key, t: Date.now(), failed: r.blocked ? 'blocked' : r.unknown ? 'unknown' : 'error' };
          LG.info('car', 'Tire Rack factory size not found', t.sizeLookup.failed);
        }
        save(); redraw(c); lookup(c);
      });
      redraw(c); return;
    }
    if (t.size && !busy[c.id]) {
      var L = t.list;
      if (L && L.size === t.size && (L.items && L.items.length ? Date.now() - L.t < LIST_DAYS * 864e5 : recent(L, RETRY_H))) return;
      var url = listUrl(c, t.size); if (!url) return;
      busy[c.id] = 'list'; t.list = { size: t.size, t: Date.now(), items: L && L.size === t.size ? L.items : [] };
      call('siteRead', 'tirerack', JSON.stringify({ url: url, step: 'list' })).then(function (r) {
        busy[c.id] = false; r = r || {};
        if (r.tires && r.tires.length) { t.list = { size: t.size, t: Date.now(), items: r.tires.map(function (x) { var s = split(x.name); return { name: x.name, brand: s.brand, model: s.model, type: x.type, utqg: x.utqg, warrantyMi: x.warrantyMi || 0 }; }) }; LG.info('car', 'Tire Rack: ' + r.tires.length + ' tires in ' + t.size); }
        else { t.list = { size: t.size, t: Date.now(), items: (t.list && t.list.items) || [], failed: r.blocked ? 'blocked' : 'error' }; LG.info('car', 'Tire Rack tire list not read', t.list.failed); }
        save(); redraw(c);
      });
      redraw(c);
    }
  }
  function redraw(c) { if (host && host.isConnected && G().car() === c) draw(); }

  // ---------- the spare: Brave Search's AI answer says which kind, you confirm ----------
  var spareBusy = {};
  function spare(t) { t.spare = t.spare || {}; return t.spare; }
  function spareKey(c) { return G() && G().carKey ? G().carKey(c) : [c.year, c.make, base(c), c.trim || ''].join(' ').trim(); }
  function spareUrl(c) { return 'https://search.brave.com/search?q=' + encodeURIComponent('Does the ' + spareKey(c) + ' come with a spare tire? Is it full-size, compact, or a tire repair kit?') + '&summary=1'; }
  function spareLookup(c) {
    var t = tires(c), sp = spare(t), key = spareKey(c);
    if (!call || !N.siteRead || sp.kind || !key || !c.year || spareBusy[c.id]) return;
    var L = sp.lookup; if (L && L.key === key && (L.guess || recent(L, RETRY_H))) return;
    spareBusy[c.id] = true; sp.lookup = { key: key, t: Date.now() };
    LG.info('car', 'Asking Brave Search about the spare tire', key);
    var ask = function () { return Promise.race([call('siteRead', 'brave', JSON.stringify({ url: spareUrl(c), bg: true, kind: 'spare' })), new Promise(function (ok) { setTimeout(function () { ok(null); }, 40000); })]); };
    (G().braveSerial ? G().braveSerial(ask) : ask()).then(function (r) {
      spareBusy[c.id] = false;
      var g = r && r.text ? parseSpare(r.text) : null;
      sp.lookup = { key: key, t: Date.now(), guess: g, failed: !g, src: r && r.src, text: r && r.text ? String(r.text).slice(0, 300) : '' };
      LG.info('car', g ? 'Brave Search says the spare is: ' + g : 'Couldn\'t tell the spare from Brave Search', r ? (r.blocked ? 'a check on the page' : r.error || (r.text || '').slice(0, 200)) : 'no reply in 40 s');
      save(); redraw(c); onChange();
    });
    redraw(c);
  }
  /** What the car has: what you said, else Brave's guess (marked), else ''. */
  function spareKind(t) { var sp = (t && t.spare) || {}; return sp.kind || (sp.lookup && sp.lookup.guess) || ''; }
  var SPARE_NAME = { full: 'Full-size spare', compact: 'Compact (temporary) spare', kit: 'Repair kit, no spare', runflat: 'Run-flat tires, no spare', none: 'No spare' };
  var AIR_DAYS = 30;
  function airedOk(t) { var a = t && t.spare && t.spare.aired; return a && Date.now() - a < AIR_DAYS * 864e5; }
  function setAired(c, on) { var t = tires(c), sp = spare(t); sp.aired = on ? Date.now() : 0; LG.info('car', on ? 'Spare tire aired up' : 'Spare tire air: unchecked'); save(); redraw(c); onChange(); }

  // ---------- fuel economy /10: the rules, nudged a point by the rating model from the tire's name ----------
  var nudging = {};
  var FUEL_GOOD = ['A fuel-efficient tire with low rolling resistance.', 'An eco tire made to save gas.', 'A touring tire for a quiet, efficient highway ride.'];
  var FUEL_BAD = ['An aggressive off-road tire with big tread blocks.', 'A sticky high-performance tire made for grip.', 'A heavy-duty tire for trucks and towing.'];
  function fuelKey(t) { return [t.type, t.brand, t.model].join('|'); }
  function fuel(t) { var n = t.fuelNudge && t.fuelNudge.key === fuelKey(t) ? t.fuelNudge.v : 0; return fuelScore(t, n); }
  function nudgeFuel(c) {
    var t = tires(c), k = fuelKey(t);
    if (!t.model || !root.Severity || !Severity.compare || (t.fuelNudge && t.fuelNudge.key === k) || nudging[k]) return;
    nudging[k] = 1;
    Severity.compare([t.type, t.brand, t.model].filter(Boolean).join(' '), { good: FUEL_GOOD, bad: FUEL_BAD }).then(function (r) {
      nudging[k] = 0; if (!r) return;
      var d = (r.good - r.bad) * 10; t.fuelNudge = { key: k, v: d > 0.5 ? 1 : d < -0.5 ? -1 : 0 };
      save(); redraw(c); onChange();
    });
  }

  // ---------- page ----------
  function render(el, nativeCall, changed) { host = el; call = nativeCall || call; onChange = changed || onChange; var c = G().car(); lookup(c); spareLookup(c); draw(); }
  function summary(c) { var d = document.createElement('div'); d.innerHTML = summaryHtml(c); return d.textContent; }
  /** The line under "Tires": the type, fuel economy /10, the wear rating and the tread left, each graded red -> yellow -> green. */
  function summaryHtml(c) {
    var t = tires(c), bits = [], g = function (txt, f) { return f == null ? esc(txt) : '<b class="gr" style="color:' + hue(f) + '">' + esc(txt) + '</b>'; };
    if (t.type) bits.push(esc(t.type));
    var f = fuel(t); if (f) bits.push('Fuel ' + g(f.score + '/10', (f.score - 1) / 9));
    var u = t.utqg || {};
    if (u.tw || u.trac || u.temp) bits.push('UTQG ' + [u.tw ? g(String(u.tw), twGood(u.tw)) : '', u.trac ? g(u.trac, tracGood(u.trac)) : '', u.temp ? g(u.temp, tempGood(u.temp)) : ''].filter(Boolean).join(' '));
    var e = estimate(t); if (e) bits.push(g((e.measured ? '' : '~') + e.depth + '/32 in left', depthGood(e.depth)));
    return bits.join(' · ') || 'type, fuel economy, wear rating, tread left';
  }
  function opts(list, cur, ph) {
    return '<option value="">' + esc(ph) + '</option>' + list.map(function (x) { var v = typeof x === 'string' ? x : x.v, l = typeof x === 'string' ? x : x.l; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') +
      '<option value="*"' + (cur && cur !== '*' && !list.some(function (x) { return (typeof x === 'string' ? x : x.v) === cur; }) ? ' selected' : '') + '>Other…</option>';
  }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }); }
  var Q = {
    size: 'Your tire size is printed on the tire\'s side and on the sticker inside the driver\'s door: for example <b>195/65R15</b>. 195 is the width in millimeters, 65 is the sidewall\'s height as a percent of the width, and 15 is the wheel size in inches. Gasket looks up your trim\'s factory size at Tire Rack.',
    type: '<b>All-season</b> tires work year-round where winters are mild. <b>Touring</b> ones ride quieter and last longer. <b>All-weather</b> tires carry the mountain-snowflake symbol for real snow. <b>Summer</b> tires grip best in warm weather but harden in the cold. <b>Winter</b> tires are for snow and ice.',
    utqg: 'The <b>wear rating</b> (UTQG, Uniform Tire Quality Grading) is molded on the tire\'s side, like <b>700 A A</b>. <b>Treadwear</b>: higher lasts longer (300 is short, 700+ is long). <b>Traction</b>: wet braking grip, AA (best), A, B or C. <b>Temperature</b>: how well it handles heat at speed, A (best), B or C. Gasket uses it to estimate how long your tires last.',
    fuel: 'How easy the tire rolls, which is how much gas it costs you: 10 saves the most. Gasket estimates it from the tire\'s type (touring and fuel-saving tires roll easiest; all-terrain and mud tires the least), its name, its wear rating and its width, and the small AI model on your phone can move it a point from how the tire is described. It\'s an estimate, not a test result.',
    measure: 'Use a coin. <b>Penny</b>: put it in a groove with Lincoln\'s head down. If you can see all of his head, there\'s 2/32 in or less: replace the tire now. <b>Quarter</b>: if you can see all of Washington\'s head, there\'s 4/32 in or less: plan new tires (wet and snow grip fade from here). If the tread covers part of his head, you have more than 4/32. Check the inside, middle and outside of each tire; the lowest one counts.',
    miles: 'About how many miles you\'ve driven since these tires were put on. A rough number is fine. Your car\'s trip odometer or a service receipt can help.',
    rotate: '<b>Rotating</b> tires means moving them to different corners of the car (front to back, and sometimes side to side), because front tires wear faster, especially on front-wheel-drive cars. <b>Regularly</b> means every 5,000 to 7,500 miles, or at every oil change on many cars. Skipping it lets some tires wear out sooner than the others.',
    split: 'Front and rear tires wear differently, and a tire replaced on its own starts deeper than the rest. Measure each one (the coin test, or a tread gauge) and Gasket says which tires should go where: the better pair always goes on the rear.',
    spare: 'A <b>full-size</b> spare can stay on. A <b>compact</b> (temporary) spare is for about 70 miles at no more than 50 mph, and it usually needs 60 psi. A <b>repair kit</b> (sealant and a pump) fixes small punctures in the tread, not sidewall cuts or blowouts. <b>Run-flat</b> tires keep going about 50 miles at up to 50 mph after a puncture. Check under the trunk floor (or under a truck\'s bed) to be sure.'
  };
  var detOpen = {};
  function hasDetails(t) { return !!(t.size || t.brand || t.type); }
  function depthOpts(cur, max, plain) {
    var a = []; for (var d = max || 12; d >= 1; d--) a.push(d);
    return '<option value="">Pick…</option>' + a.map(function (d) { return '<option value="' + d + '"' + (+cur === d ? ' selected' : '') + '>' + d + '/32 in' + (plain ? '' : d === 4 ? ' (quarter test)' : d === 2 ? ' (penny test)' : '') + '</option>'; }).join('');
  }
  function draw() {
    if (!host) return;
    var c = G().car(); if (!c) { host.innerHTML = ''; return; }
    var t = tires(c), L = t.list && t.list.size === t.size ? t.list.items || [] : [], q = A.qBtn;
    if (detOpen[c.id] == null) detOpen[c.id] = !hasDetails(t);      // closed once the car has its tire details
    var h = '<details class="tz-det" id="tzDet"' + (detOpen[c.id] ? ' open' : '') + '><summary><span>Tire details<small>' + esc([t.size, t.brand ? t.brand + (t.model ? ' ' + t.model : '') : ''].filter(Boolean).join(' · ') || 'size, type, brand, wear rating') + '</small></span></summary>';
    // size
    var SL = t.sizeLookup || {}, fac = SL.found ? SL.factory || [] : [];
    h += '<div class="nf wide"><span>Size' + q(Q.size) + '</span>';
    if (busy[c.id] === 'size') h += window.__app.ldBar('Looking up your factory size at Tire Rack');
    if (fac.length > 1 && !t.size) h += '<div class="chips mini wrap" id="tzPick">' + fac.map(function (z) { return '<button data-size="' + esc(z) + '">' + esc(z) + '</button>'; }).join('') + '</div>' +
      '<div class="lead small keep">Your ' + esc(c.year + ' ' + c.make + ' ' + base(c) + ' ' + c.trim) + ' came with ' + fac.length + ' sizes. Pick yours, or type it below.</div>';
    h += '<input type="text" id="tzSize" maxlength="20" autocapitalize="characters" placeholder="e.g. 195/65R15" value="' + esc(t.size || '') + '"></div>';
    if (t.size && t.sizeSrc === 'tirerack') h += '<div class="lead small keep tz-src">Factory size for the ' + esc(c.year + ' ' + c.make + ' ' + base(c) + ' ' + c.trim) + ', from Tire Rack.</div>';
    else if (!t.size && SL.failed) h += '<div class="lead small keep">' + (SL.failed === 'unknown' ? 'Tire Rack doesn\'t list "' + esc(c.trim) + '" for this model.' : 'Tire Rack didn\'t answer.') + ' Type the size from the sticker inside the driver\'s door.</div>';
    else if (!t.size && !c.trim) h += '<div class="lead small keep">Add your trim (Edit, above) to look up its factory size, or type it from the sticker inside the driver\'s door.</div>';
    // type -> brand -> model
    var types = L.length ? uniq(L.map(function (x) { return x.type; })).sort() : TYPES;
    var inType = L.filter(function (x) { return !t.type || x.type === t.type; });
    var brands = uniq(inType.map(function (x) { return x.brand; })).sort();
    var models = inType.filter(function (x) { return x.brand === t.brand; }).map(function (x) { return x.model; }).sort();
    var otherBrand = t.brand && brands.indexOf(t.brand) < 0, otherModel = t.model && models.indexOf(t.model) < 0;
    if (busy[c.id] === 'list') h += window.__app.ldBar('Finding the tires made in ' + t.size);
    h += '<div class="tz-pick"><label class="nf"><span>Type' + q(Q.type) + '</span><select id="tzType">' + opts(types, t.type, 'Type') + '</select></label>' +
      '<label class="nf"><span>Brand</span>' + (otherBrand || !brands.length ? '<input type="text" id="tzBrandT" maxlength="30" placeholder="Brand" value="' + esc(t.brand || '') + '">' : '<select id="tzBrand">' + opts(brands, t.brand, 'Brand') + '</select>') + '</label>' +
      '<label class="nf"><span>Model</span>' + (otherModel || otherBrand || !models.length ? '<input type="text" id="tzModelT" maxlength="40" placeholder="Model" value="' + esc(t.model || '') + '">' : '<select id="tzModel">' + opts(models, t.model, 'Model') + '</select>') + '</label></div>';
    if (t.size && t.list && t.list.failed && !L.length) h += '<div class="lead small keep">Couldn\'t get Tire Rack\'s list for ' + esc(t.size) + '. Type the brand and model, and the wear rating from the tire\'s side.</div>';
    // wear rating
    var u = t.utqg || {};
    h += '<div class="nf wide"><span>Wear rating' + q(Q.utqg) + '</span><div class="grid3">' +
      '<label class="nf"><span>Treadwear</span><input type="number" inputmode="numeric" min="60" max="1200" step="20" id="tzTw" placeholder="e.g. 600" value="' + esc(u.tw || '') + '"></label>' +
      '<label class="nf"><span>Traction</span><select id="tzTrac">' + ['', 'AA', 'A', 'B', 'C'].map(function (g) { return '<option value="' + g + '"' + ((u.trac || '') === g ? ' selected' : '') + '>' + (g || '—') + '</option>'; }).join('') + '</select></label>' +
      '<label class="nf"><span>Temperature</span><select id="tzTemp">' + ['', 'A', 'B', 'C'].map(function (g) { return '<option value="' + g + '"' + ((u.temp || '') === g ? ' selected' : '') + '>' + (g || '—') + '</option>'; }).join('') + '</select></label></div>' +
      (t.utqgSrc === 'tirerack' || +t.warrantyMi > 0 ? '<div class="lead small keep">' + [t.utqgSrc === 'tirerack' ? 'Wear rating from Tire Rack.' : '', +t.warrantyMi > 0 ? 'Maker\'s mileage warranty: ' + (t.warrantyMi / 1000) + ',000 miles.' : ''].filter(Boolean).join(' ') + '</div>' : '') + '</div>';
    var fs = fuel(t);
    if (fs) h += '<div class="tz-fuel"><span>Fuel economy' + q(Q.fuel) + '</span><b class="gr" style="color:' + hue((fs.score - 1) / 9) + '">' + fs.score + '/10</b><small>' + esc(fs.why.join(', ')) + '</small></div>';
    h += '</details>';
    // tread left: what keeps you safe, in the main menu
    var r = t.tread, C = t.corners || {}, e = estimate(t), st = e ? status(e.depth) : null;
    h += '<div class="sub-h tz-h">Tread left</div>';
    h += whyRow('tread', 'Why tread matters', 'How far new and worn tires take to stop in the rain');
    h += '<div class="field tz-split"><div class="lbl">My tires aren\'t all the same<small>' + Q.split + '</small></div><label class="switch"><input type="checkbox" id="tzSplit"' + (C.split ? ' checked' : '') + '><span></span></label></div>';
    var deep = /mud|terrain/i.test(t.type || '') ? 15 : 12;
    if (!C.split) {
      h += '<div class="seg2" id="tzMode"><button data-mode="miles" class="' + (r.mode !== 'measure' ? 'on' : '') + '">Estimate it</button><button data-mode="measure" class="' + (r.mode === 'measure' ? 'on' : '') + '">I measured it</button></div>';
      if (r.mode === 'measure') h += '<label class="nf wide"><span>Shallowest groove' + q(Q.measure) + '</span><select id="tzDepth">' + depthOpts(r.depth, deep) + '</select></label>';
      else h += '<div class="grid2"><label class="nf"><span>Miles on these tires' + q(Q.miles) + '</span><input type="number" inputmode="numeric" min="0" step="1000" id="tzMiles" placeholder="e.g. 20000" value="' + esc(r.miles === '' || r.miles == null ? '' : r.miles) + '"></label>' +
        '<label class="nf"><span>Rotated regularly?' + q(Q.rotate) + '</span><select id="tzRot">' + [['', 'Pick…'], ['yes', 'Yes'], ['sometimes', 'Sometimes'], ['no', 'Never'], ['unsure', 'Not sure']].map(function (o) { return '<option value="' + o[0] + '"' + ((r.rotated || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label></div>';
    } else {
      // the layout (a car, or a dually, with a trailer or not) as a picture, its wheels numbered and colored by tread,
      // then a box for each tire, by number
      var P = positions(t), canDual = duallyOk(c) || C.dually, T = C.trailer || {};
      h += '<div class="field tz-sw' + (canDual ? '' : ' off') + '"><div class="lbl">Dual rear wheels (dually)<small>' + (canDual ? 'Four tires on the rear axle, two on each side.' : 'Your ' + esc(G().shortName(c)) + ' doesn\'t have them: only some pickups and vans do.') + '</small></div>' +
        '<label class="switch"><input type="checkbox" id="tzDually"' + (C.dually ? ' checked' : '') + (canDual ? '' : ' disabled') + '><span></span></label></div>';
      h += '<div class="field tz-sw"><div class="lbl">Towing a trailer<small>Its tires count toward your tire warnings. Trip plans don\'t include towing yet.</small></div>' +
        '<label class="switch"><input type="checkbox" id="tzTrailer"' + (T.on ? ' checked' : '') + '><span></span></label></div>';
      if (T.on) h += '<div class="tz-cfg"><span>Axles</span><div class="chips mini" id="tzAxles">' + [1, 2, 3].map(function (n) { return '<button type="button" data-axles="' + n + '" class="' + (T.axles === n ? 'on' : '') + '">' + n + '</button>'; }).join('') + '</div>' +
        '<span>Tires per axle</span><div class="chips mini" id="tzPer">' + [[2, '2'], [4, '4 (dual)']].map(function (o) { return '<button type="button" data-per="' + o[0] + '" class="' + (T.per === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div>';
      h += '<div class="tz-pic" aria-hidden="true">' + wheelSvg(c, t) + '</div>';
      h += '<div class="lead small keep">The shallowest groove of each tire' + q(Q.measure) + '</div>';
      var groups = []; P.forEach(function (p, n) { p.n = n + 1; var g = groups.filter(function (x) { return x.g === p.group; })[0]; if (!g) groups.push(g = { g: p.group, l: [] }); g.l.push(p); });
      groups.forEach(function (g) {
        h += '<div class="tz-grp"><div class="tz-gh">' + esc(g.g) + '</div><div class="tz-gl">' + g.l.map(function (p) {
          var d = C[p.k] && C[p.k].depth, f = d ? depthGood(d) : null;
          return '<label class="nf tz-c"><span><b class="tz-num" style="' + (f != null ? 'background:' + hue(f) + ';color:#111' : '') + '">' + p.n + '</b>' + esc(p.name.replace(/^Trailer axle \d+, /, '')) + '</span><select data-corner="' + p.k + '" aria-label="' + esc(p.name) + '">' + depthOpts(d, deep, true) + '</select></label>';
        }).join('') + '</div></div>';
      });
      var rot = rotation(corners(t), (c.info && c.info.drive) || '', C.dually ? { lri: C.lri && +C.lri.depth, rri: C.rri && +C.rri.depth } : null);
      if (rot) {
        h += '<div class="tz-rot ' + rot.kind + '"><b>' + (rot.kind === 'replace' ? 'Replace before rotating' : rot.kind === 'move' ? 'Move these tires' : 'Where they are is fine') + '</b>' +
          (rot.moves.length ? '<ul>' + rot.moves.map(function (m) { return '<li>' + esc(cname(m.from)) + ' → ' + esc(cname(m.to)) + ' <small>(' + C[m.from].depth + '/32 in)</small></li>'; }).join('') + '</ul>' : '') +
          rot.notes.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') + (!(c.info && c.info.drive) ? '<p class="tz-xnote">Add your drive (front-, rear- or all-wheel) under About this car for advice that fits it.</p>' : '') + '</div>';
      } else h += '<div class="lead small keep">Fill in all four corners and Gasket says which tires should go where.</div>';
      h += whyRow('back', 'Why the better tires go on the back', 'Understeer vs oversteer on a wet curve');
    }
    if (e) {
      var word = { good: 'Plenty left.', ok: 'Plan new tires: wet and snow grip start to fade at 4/32 in.', low: 'Replace them soon.', worn: 'At the legal limit: replace them now.' }[st];
      h += '<div class="tz-out ' + st + '"><b>' + (e.measured ? '' : 'About ') + e.depth + '/32 in left' + (e.corner ? ' <small class="tz-on">· ' + esc(cname(e.corner, C)) + '</small>' : '') + '</b><small>' + word +
        (e.measured ? '' : ' Estimated from ' + Number(r.miles).toLocaleString() + ' miles and ' + (+t.warrantyMi > 0 ? 'the ' + (t.warrantyMi / 1000) + ',000-mile warranty' : t.utqg && t.utqg.tw ? 'the treadwear rating' : 'a typical tire life') + (r.rotated && r.rotated !== 'yes' ? ', with uneven wear from skipped rotations' : '') + '. A coin test tells you for sure.') + '</small></div>';
    }
    // the spare
    var sp = spare(t), kind = sp.kind, guess = sp.lookup && sp.lookup.guess;
    h += '<div class="sub-h tz-h">Spare tire</div>';
    if (spareBusy[c.id]) h += window.__app.ldBar('Asking Brave Search about the spare');
    if (!kind && guess) h += '<div class="tz-guess">Brave Search says: <b>' + esc(SPARE_NAME[guess]) + '</b>. <button class="btn tonal sm" id="tzSpareYes">That\'s right</button></div>';
    h += '<label class="nf wide"><span>What your car has' + q(Q.spare) + '</span><select id="tzSpare"><option value="">' + (guess && !kind ? 'Not confirmed yet' : 'Not sure') + '</option>' +
      ['full', 'compact', 'kit', 'runflat', 'none'].map(function (k) { return '<option value="' + k + '"' + (kind === k ? ' selected' : '') + '>' + SPARE_NAME[k] + '</option>'; }).join('') + '</select></label>';
    if (!kind && !guess && sp.lookup && sp.lookup.failed && !spareBusy[c.id]) h += '<div class="lead small keep">Brave Search couldn\'t tell. Look under the trunk floor (or under a truck\'s bed), or in the owner\'s manual.</div>';
    var k2 = kind || guess;
    if (k2 === 'full' || k2 === 'compact') h += '<div class="tz-air ' + (airedOk(t) ? 'ok' : 'due') + '">' + (airedOk(t) ? 'Air checked ' + new Date(sp.aired).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '. Next check by ' + new Date(sp.aired + AIR_DAYS * 864e5).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '.' :
      'Its air hasn\'t been checked this month. Check it' + (k2 === 'compact' ? ' (compact spares usually need 60 psi)' : '') + ', then tick it in Advice.') + '</div>';
    else if (k2 === 'kit' || k2 === 'none') h += '<div class="tz-air due">No spare: have a plan for a flat. Roadside assistance (your insurer or the car maker may include it), the kit\'s pump charged and working, and your phone charged.</div>';
    host.innerHTML = h;
    bind(c);
    nudgeFuel(c);
  }
  function cname(k, C) {
    var x = positions({ corners: C || (G().car().tires || {}).corners || {} }).filter(function (y) { return y.k === k; })[0];
    if (x) return x.name;
    var y = CORNERS.filter(function (z) { return z.k === k; })[0]; return y ? y.name : k;
  }
  function bind(c) {
    var t = tires(c);
    var set = function (fn) { return function () { fn.call(this); save(); draw(); onChange(); }; };
    var pickModel = function () {
      var L = t.list && t.list.size === t.size ? t.list.items || [] : [];
      var x = L.filter(function (y) { return y.brand === t.brand && y.model === t.model && (!t.type || y.type === t.type); })[0];
      if (x) { t.type = x.type; if (x.utqg) { t.utqg = Object.assign({}, x.utqg); t.utqgSrc = 'tirerack'; } t.warrantyMi = x.warrantyMi || 0; t.newDepth = 0; }
    };
    $('tzDet').addEventListener('toggle', function () { detOpen[c.id] = this.open; });
    host.querySelectorAll('[data-why]').forEach(function (b) { b.onclick = function () { openWhy(b.dataset.why); }; });
    if ($('tzPick')) host.querySelectorAll('[data-size]').forEach(function (b) { b.onclick = set(function () { t.size = b.dataset.size; t.sizeSrc = 'tirerack'; lookup(c); }); });
    $('tzSize').onchange = set(function () {
      var v = normSize(this.value);
      if (!this.value.trim()) { t.size = ''; t.sizeSrc = ''; return; }
      if (!v) { A.toast && A.toast('A tire size looks like 195/65R15.'); return; }
      if (v !== t.size) { t.size = v; t.sizeSrc = 'user'; } lookup(c);
    });
    if ($('tzType')) $('tzType').onchange = set(function () { t.type = this.value === '*' ? 'Other' : this.value; });
    if ($('tzBrand')) $('tzBrand').onchange = set(function () { if (this.value === '*') { t.brand = ' '; } else { t.brand = this.value; t.model = ''; } });
    if ($('tzBrandT')) $('tzBrandT').onchange = set(function () { t.brand = this.value.trim(); });
    if ($('tzModel')) $('tzModel').onchange = set(function () { if (this.value === '*') { t.model = ' '; return; } t.model = this.value; pickModel(); });
    if ($('tzModelT')) $('tzModelT').onchange = set(function () { t.model = this.value.trim(); });
    var u = function () { t.utqg = Object.assign({}, t.utqg); t.utqgSrc = 'user'; return t.utqg; };
    $('tzTw').onchange = set(function () { u().tw = parseInt(this.value, 10) || ''; });
    $('tzTrac').onchange = set(function () { u().trac = this.value; });
    $('tzTemp').onchange = set(function () { u().temp = this.value; });
    host.querySelectorAll('#tzMode [data-mode]').forEach(function (b) { b.onclick = set(function () { t.tread = Object.assign({}, t.tread, { mode: b.dataset.mode }); }); });
    if ($('tzDepth')) $('tzDepth').onchange = set(function () { t.tread.depth = parseFloat(this.value) || ''; t.tread.t = Date.now(); });
    if ($('tzMiles')) $('tzMiles').onchange = set(function () { t.tread.miles = this.value === '' ? '' : Math.max(0, parseInt(this.value, 10) || 0); t.tread.t = Date.now(); });
    if ($('tzRot')) $('tzRot').onchange = set(function () { t.tread.rotated = this.value; });
    // each corner, and the extra wheels
    var C = function () { t.corners = t.corners || { split: false }; return t.corners; };
    $('tzSplit').onchange = set(function () { C().split = this.checked; LG.info('car', 'Tires: ' + (this.checked ? 'each corner' : 'all the same')); });
    host.querySelectorAll('[data-corner]').forEach(function (s) { s.onchange = set(function () { C()[s.dataset.corner] = { depth: parseFloat(s.value) || '', t: Date.now() }; }); });
    if ($('tzDually')) $('tzDually').onchange = set(function () { C().dually = this.checked; LG.info('car', 'Tires: dual rear wheels ' + (this.checked ? 'on' : 'off')); });
    if ($('tzTrailer')) $('tzTrailer').onchange = set(function () { var T = C().trailer = Object.assign({ axles: 1, per: 2 }, C().trailer); T.on = this.checked; LG.info('car', 'Tires: trailer ' + (this.checked ? 'on' : 'off')); });
    host.querySelectorAll('[data-axles]').forEach(function (b) { b.onclick = set(function () { C().trailer.axles = +b.dataset.axles; }); });
    host.querySelectorAll('[data-per]').forEach(function (b) { b.onclick = set(function () { C().trailer.per = +b.dataset.per; }); });
    // the spare
    $('tzSpare').onchange = set(function () { spare(t).kind = this.value; LG.info('car', 'Spare tire: ' + (this.value || 'not sure')); });
    if ($('tzSpareYes')) $('tzSpareYes').onclick = set(function () { spare(t).kind = spare(t).lookup.guess; LG.info('car', 'Spare tire confirmed: ' + spare(t).kind); });
  }
  window.addEventListener('garagechange', function () { var c = G() && G().car(); if (c && host && host.isConnected) { lookup(c); spareLookup(c); draw(); } });

  // ---------- pictures that move: why tread matters, and why the better tires go on the back ----------
  var SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function still() { try { return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  /** Rain over a w x h area: slanted drops falling, rings where they hit the roads (lanes: [{y, h}]). -> step(dt). */
  function rain(g, w, h, lanes, n) {
    var drops = [], rings = [];
    for (var i = 0; i < n; i++) drops.push({ x: Math.random() * (w + 40), y: Math.random() * h, v: 260 + Math.random() * 120, e: el('line', { class: 'rn-drop' }, g) });
    var put = function (d) { d.e.setAttribute('x1', d.x.toFixed(1)); d.e.setAttribute('y1', d.y.toFixed(1)); d.e.setAttribute('x2', (d.x - 3).toFixed(1)); d.e.setAttribute('y2', (d.y + 9).toFixed(1)); };
    drops.forEach(put);
    return function (dt) {
      drops.forEach(function (d) {
        d.y += d.v * dt; d.x -= d.v * dt * 0.33;
        if (d.y > h) {
          var ln = lanes[Math.floor(Math.random() * lanes.length)];
          if (ln && rings.length < 14 && Math.random() < 0.6) rings.push({ x: d.x, y: ln.y + 3 + Math.random() * (ln.h - 6), r: 0.5, e: el('ellipse', { class: 'rn-ring' }, g) });
          d.y = -10 - Math.random() * 30; d.x = Math.random() * (w + 40);
        }
        put(d);
      });
      rings = rings.filter(function (r) {
        r.r += dt * 14; var o = Math.max(0, 1 - r.r / 6);
        if (o <= 0) { r.e.remove(); return false; }
        r.e.setAttribute('cx', r.x.toFixed(1)); r.e.setAttribute('cy', r.y.toFixed(1)); r.e.setAttribute('rx', r.r.toFixed(2)); r.e.setAttribute('ry', (r.r * 0.4).toFixed(2)); r.e.setAttribute('opacity', o.toFixed(2));
        return true;
      });
    };
  }
  /**
   * Plays frame(t, dt) over and over: t runs 0..cycle seconds, then starts again (the rain keeps falling throughout).
   * Off-screen pages get no frames (the browser pauses them). Reduced motion: one still at `still` seconds.
   * -> { stop(), at(t): stop and draw the moment t (for the tests) }.
   */
  function loop(cycle, frame, stillAt) {
    var t0 = null, prev = null, raf = 0, live = true;
    var step = function (ts) {
      if (!live) return;
      if (t0 == null) t0 = ts;
      var dt = prev == null ? 0 : Math.min(0.1, (ts - prev) / 1000); prev = ts;
      frame(((ts - t0) / 1000) % cycle, dt);
      raf = requestAnimationFrame(step);
    };
    var ctl = { stop: function () { live = false; cancelAnimationFrame(raf); }, at: function (t) { ctl.stop(); frame(t, 0); } };
    if (still()) { frame(stillAt, 0); return ctl; }
    raf = requestAnimationFrame(step);
    return ctl;
  }
  /** A car from the side, facing right, nose at x = 0 (so it's drawn to the left of where it is); brake light at the back. */
  function sideCar(g, cls) {
    var c = el('g', { class: 'an-car ' + (cls || '') }, g);
    var m = el('g', { transform: 'translate(-32 0) scale(-1 1)' }, c);      // drawn nose-left, turned to face right
    el('path', { d: 'M-32 -4 L-31 -9 L-24 -10.5 L-19 -16 L-9 -16 L-4 -10.5 L0 -9 L0 -4 Z', class: 'an-body' }, m);
    el('path', { d: 'M-18 -15 L-14 -15 L-14 -10.5 L-22 -10.5 Z M-12.5 -15 L-9.5 -15 L-5.5 -10.5 L-12.5 -10.5 Z', class: 'an-glass' }, m);
    el('circle', { cx: -24, cy: -3.5, r: 3.6, class: 'an-wheel' }, m); el('circle', { cx: -8, cy: -3.5, r: 3.6, class: 'an-wheel' }, m);
    el('rect', { x: -32.6, y: -9, width: 2, height: 3, class: 'an-brake' }, c);
    return c;
  }
  /**
   * Wet braking, new vs worn tires: three roads in the rain. The cars come in at the same speed and brake at the same
   * line, each slowing evenly to a stop at its tested distance (Discount Tire's 158, 226 and 301 ft), so the worn ones slide
   * past the stop sign where the car on new tires stopped. They wait a second, fade, and it starts again.
   */
  function stopAnim(host) {
    var W = 340, H = 222, S = 40, K = (W - S - 8) / 301, X = function (ft) { return S + ft * K; };
    var CARS = [{ ft: 158, lab: 'New tires', cls: 'good' }, { ft: 226, lab: 'Worn tire A', cls: 'bad' }, { ft: 301, lab: 'Worn tire B', cls: 'bad' }];
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Three cars brake from the same speed on a wet road. New tires stop at the stop sign after 158 feet; worn tires slide on to 226 and 301 feet, past the sign.' });
    host.appendChild(svg);
    var lanes = CARS.map(function (c, i) { return { y: 56 + i * 58, h: 24 }; });
    var gR = el('g', {}, svg);
    lanes.forEach(function (ln, i) {
      el('rect', { x: 0, y: ln.y, width: W, height: ln.h, class: 'an-road' }, gR);
      el('rect', { x: 0, y: ln.y + 1, width: W, height: 5, class: 'an-sheen' }, gR);
      el('line', { x1: 0, y1: ln.y + ln.h / 2, x2: W, y2: ln.y + ln.h / 2, class: 'an-lane' }, gR);
      el('text', { x: 2, y: ln.y - 6, class: 'il-t' }, gR).textContent = CARS[i].lab;
    });
    // where they all start braking (an arrow, "started braking"), and the stop sign where new tires stop
    el('line', { x1: S, y1: 48, x2: S, y2: H - 6, class: 'an-brakeline' }, gR);
    el('text', { x: S, y: 12, class: 'an-small', 'text-anchor': 'middle' }, gR).textContent = 'started braking';
    el('path', { d: 'M' + S + ' 16 L' + S + ' 34 M' + (S - 4) + ' 29 L' + S + ' 35 L' + (S + 4) + ' 29', class: 'an-arrowd' }, gR);
    var sx = X(158);
    el('line', { x1: sx, y1: 30, x2: sx, y2: H - 6, class: 'il-stop' }, gR);
    var sign = el('g', { transform: 'translate(' + sx + ' 20)' }, gR);
    el('line', { x1: 0, y1: 8, x2: 0, y2: 32, class: 'an-post' }, sign);
    var oct = []; for (var i = 0; i < 8; i++) { var a = Math.PI / 8 + i * Math.PI / 4; oct.push((Math.cos(a) * 11).toFixed(2) + ',' + (Math.sin(a) * 11).toFixed(2)); }
    el('polygon', { points: oct.join(' '), class: 'an-sign' }, sign);
    el('text', { x: 0, y: 2.8, class: 'an-signt', 'text-anchor': 'middle' }, sign).textContent = 'STOP';
    var gC = el('g', {}, svg), gN = el('g', {}, svg), gRain = el('g', { class: 'an-rain' }, svg);
    var cars = CARS.map(function (c, i) { var g = sideCar(gC, c.cls); return { c: c, g: g, y: lanes[i].y + lanes[i].h / 2 + 4 }; });
    var labels = CARS.map(function (c, i) {
      var past = c.ft - 158;
      var t = el('text', { x: W - 4, y: lanes[i].y - 6, class: 'an-n ' + c.cls, 'text-anchor': 'end', opacity: 0 }, gN);
      t.textContent = c.ft + ' ft' + (past > 0 ? ' · ' + past + ' ft past the sign' : ' · stopped at the sign'); return t;
    });
    var drops = rain(gRain, W, H, lanes, 46);
    // the same speed for all: each takes 2d / v to stop (evenly slowing), so the farther one takes longer
    var V = 2 * 158 / 1.7, PRE = 0.5, ROLL = V * K * PRE;
    var stopT = function (ft) { return 2 * ft / V; };
    var END = PRE + stopT(301), HOLD = 1.2, FADE = 0.5, CYCLE = END + HOLD + FADE;
    var ctl = loop(CYCLE, function (t, dt) {
      drops(dt);
      var fade = t > END + HOLD ? Math.max(0, 1 - (t - END - HOLD) / FADE) : 1;
      cars.forEach(function (o, i) {
        var x, braking = t >= PRE, u = 1;
        if (!braking) x = S - ROLL + V * K * t;
        else { u = Math.min(1, (t - PRE) / stopT(o.c.ft)); x = S + o.c.ft * K * (1 - (1 - u) * (1 - u)); }
        o.g.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + o.y + ')');
        o.g.setAttribute('opacity', fade.toFixed(2));
        o.g.classList.toggle('braking', braking && u < 1);
        labels[i].setAttribute('opacity', (braking && u >= 1 ? fade : 0).toFixed(2));
      });
    }, END + HOLD * 0.5);
    host.__anim = ctl;
    return ctl.stop;
  }
  /** A car from above, nose up, centered on (0, 0), with its wheels (the front ones steer); its underside shows when it's rolled over. */
  function topCar(g, cls) {
    var c = el('g', { class: 'an-tcar ' + cls }, g), r = el('g', {}, c), wh = [];
    [[-7.2, -7.5, 1], [7.2, -7.5, 1], [-7.2, 7.5, 0], [7.2, 7.5, 0]].forEach(function (p) {
      var w = el('g', { transform: 'translate(' + p[0] + ' ' + p[1] + ')' }, r); el('rect', { x: -1.6, y: -3.2, width: 3.2, height: 6.4, rx: 1, class: 'an-wheel' }, w);
      wh.push({ g: w, x: p[0], y: p[1], front: !!p[2] });
    });
    el('rect', { x: -6.5, y: -12, width: 13, height: 24, rx: 4, class: 'an-tbody' }, r);
    el('rect', { x: -5, y: -7.5, width: 10, height: 5.5, rx: 1.5, class: 'il-glass an-top' }, r);
    el('rect', { x: -5, y: 5, width: 10, height: 3.5, rx: 1.2, class: 'il-glass an-top' }, r);
    var u = el('g', { class: 'an-under' }, r);
    el('rect', { x: -6.5, y: -12, width: 13, height: 24, rx: 4, class: 'an-belly' }, u);
    [-8, 8].forEach(function (y) { el('line', { x1: -6, y1: y, x2: 6, y2: y, class: 'an-axle' }, u); el('rect', { x: -8.5, y: y - 3, width: 3, height: 6, rx: 1, class: 'an-wheel' }, u); el('rect', { x: 5.5, y: y - 3, width: 3, height: 6, rx: 1, class: 'an-wheel' }, u); });
    return { g: c, roll: r, under: u, wheels: wh };
  }
  /** A thought bubble ("Phew!") or a speech bubble ("I'm okay!"), above (x, y). */
  function bubble(g, text, kind) {
    var b = el('g', { class: 'an-bub ' + kind, opacity: 0 }, g), w = text.length * 5.4 + 14;
    b.__w = w;
    el('rect', { x: -w / 2, y: -30, width: w, height: 17, rx: 8.5, class: 'an-bubbg' }, b);
    if (kind === 'think') { el('circle', { cx: -3, cy: -10, r: 2.4, class: 'an-bubbg' }, b); el('circle', { cx: -6, cy: -5.5, r: 1.5, class: 'an-bubbg' }, b); }
    else el('path', { d: 'M -5 -13.5 L 1 -13.5 L -4 -6 Z', class: 'an-bubbg' }, b);
    el('text', { x: 0, y: -18.5, class: 'an-bubt', 'text-anchor': 'middle' }, b).textContent = text;
    return b;
  }
  /** Flames around a wreck, flickering. -> step(t). */
  function fire(g) {
    var f = el('g', { class: 'an-fire', opacity: 0 }, g), fl = [];
    [[-10, 6, 1], [9, 2, 0.9], [-4, -13, 0.8], [5, 12, 0.75], [12, -8, 0.7]].forEach(function (p, i) {
      var q = el('g', { transform: 'translate(' + p[0] + ' ' + p[1] + ')' }, f);
      el('path', { d: 'M0 4 C-5 0 -3 -6 0 -11 C1 -6 6 -4 3 1 C3 3 1 4 0 4 Z', class: 'an-flame' }, q);
      el('path', { d: 'M0 3 C-2 1 -1.5 -2 0 -5 C1 -2 2.5 -1 1.5 1.5 Z', class: 'an-flame2' }, q);
      fl.push({ q: q, x: p[0], y: p[1], s: p[2], ph: i * 1.7 });
    });
    return { g: f, step: function (t) { fl.forEach(function (o) { var k = o.s * (0.85 + 0.2 * Math.sin(t * 13 + o.ph) + 0.08 * Math.sin(t * 29 + o.ph * 2)); o.q.setAttribute('transform', 'translate(' + o.x + ' ' + o.y + ') scale(' + (k * 0.9).toFixed(3) + ' ' + k.toFixed(3) + ')'); }); } };
  }
  /**
   * Curves in the rain, from above, three ways. Understeer (the front tires let go: the car keeps going straighter than
   * the curve, front wheels turned and skidding): 1) it catches grip and stays on the road ("Phew!"); 2) it runs off onto
   * the grass but stays upright and stops ("I'm okay!"). Oversteer (the rear lets go): it spins off the road, digs in and
   * rolls onto its roof, and catches fire ("Not okay! Help!"). Then it starts again.
   */
  function steerAnim(host) {
    var W = 340, H = 248;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'From above, on wet curves: understeer, the car runs wide and grips again; understeer, the car runs onto the grass and stops upright; oversteer, the rear swings out, the car spins off the road, rolls over and catches fire.' });
    host.appendChild(svg);
    // the left column: understeer twice (stacked); the right: oversteer, as tall as both
    var PANELS = [
      { kind: 'u1', x: 2, y: 2, w: 166, h: 120, road: 'M 140 122 C 140 76, 96 52, 14 62', sc: 0.78, tb: 1, title: 'Understeer: grips again', say: 'Phew!', bub: 'think' },
      { kind: 'u2', x: 2, y: 126, w: 166, h: 120, road: 'M 140 122 C 140 76, 96 52, 14 62', sc: 0.78, tb: 1, title: 'Understeer: into a tree', say: 'I\'m okay!', bub: 'say' },
      { kind: 'over', x: 172, y: 2, w: 166, h: 244, road: 'M 120 240 C 120 160, 98 100, 22 60', sc: 1, title: 'Oversteer: spins and rolls', say: 'Not okay! Help!', bub: 'say' }];
    var P = PANELS.map(function (pn) {
      var g = el('g', { transform: 'translate(' + pn.x + ' ' + pn.y + ')' }, svg);
      var clip = 'anc' + pn.kind + Math.random().toString(36).slice(2, 7);
      var cp = el('clipPath', { id: clip }, g); el('rect', { x: 0, y: 0, width: pn.w, height: pn.h, rx: 10 }, cp);
      var inner = el('g', { 'clip-path': 'url(#' + clip + ')' }, g);
      el('rect', { x: 0, y: 0, width: pn.w, height: pn.h, class: 'an-grass' }, inner);
      el('path', { d: pn.road, class: 'il-road' }, inner); el('path', { d: pn.road, class: 'il-lane' }, inner);
      var path = el('path', { d: pn.road, fill: 'none', stroke: 'none' }, inner);
      var skids = el('g', { class: 'an-skids' }, inner);
      var trail = el('path', { d: '', class: 'il-path ' + (pn.kind === 'over' ? 'bad' : 'warn') }, inner);
      var fx = pn.kind === 'over' ? fire(inner) : null;
      var car = topCar(inner, pn.kind === 'over' ? 'bad' : 'warn');
      var bub = bubble(inner, pn.say, pn.bub);
      el('text', { x: 8, y: pn.tb ? pn.h - 8 : 14, class: 'an-title' }, inner).textContent = pn.title;
      return { pn: pn, path: path, len: path.getTotalLength(), trail: trail, skids: skids, car: car, bub: bub, fx: fx, g: inner };
    });
    var drops = rain(el('g', { class: 'an-rain' }, svg), W, H, [], 44);
    var U2D = 80;
    var at = function (p, s) { s = Math.max(0, Math.min(p.len, s)); var a = p.path.getPointAtLength(s), b = p.path.getPointAtLength(Math.min(p.len, s + 1)); return { x: a.x, y: a.y, ang: Math.atan2(b.y - a.y, b.x - a.x) }; };
    // understeer off the road still hits what's there: a tree where the second car ends up
    P.forEach(function (p) {
      if (p.pn.kind !== 'u2') return;
      var L = at(p, p.len * 0.42), dir = L.ang + 0.02, ex = L.x + Math.cos(dir) * (U2D + 14), ey = L.y + Math.sin(dir) * (U2D + 14);
      var tr = el('g', { class: 'an-tree', transform: 'translate(' + ex.toFixed(1) + ' ' + ey.toFixed(1) + ')' });
      p.g.insertBefore(tr, p.car.g);
      el('circle', { cx: 0, cy: 0, r: 9, class: 'an-canopy' }, tr); el('circle', { cx: -3, cy: -3, r: 4, class: 'an-canopy2' }, tr);
      var hit = el('g', { opacity: 0 }, p.g); p.hit = hit;
      el('path', { d: 'M0 -7 L2 -2 L7 -2 L3 1 L5 6 L0 3 L-5 6 L-3 1 L-7 -2 L-2 -2 Z', class: 'an-hit', transform: 'translate(' + (L.x + Math.cos(dir) * (U2D + 7)).toFixed(1) + ' ' + (L.y + Math.sin(dir) * (U2D + 7)).toFixed(1) + ') scale(0.9)' }, hit);
    });
    var deg = function (r) { return r * 180 / Math.PI; };
    var RUN = 5.2, HOLD = 2.0, FADE = 0.5, CYCLE = RUN + HOLD + FADE, T0 = 1.4, LEAVE = 0.42;
    var ctl = loop(CYCLE, function (t, dt) {
      drops(dt);
      var fade = t > RUN + HOLD ? Math.max(0, 1 - (t - RUN - HOLD) / FADE) : 1, tr = Math.min(t, RUN);
      P.forEach(function (p) {
        if (t < 0.05 || !p.pts) { p.pts = []; p.skL = []; p.skR = []; p.skids.innerHTML = ''; }
        var s0 = p.len * LEAVE, x, y, yaw, roll = 0, steer = 0, slideF = false, done = false;
        if (tr <= T0) { var q = at(p, s0 * tr / T0); x = q.x; y = q.y; yaw = deg(q.ang) + 90; steer = -6 * Math.min(1, tr / T0); }
        else {
          var L = at(p, s0), dir = L.ang, u = tr - T0;
          if (p.pn.kind === 'u1') {
            // the front tires slide for a moment (the car drifts toward the outside edge, front wheels turned but skidding),
            // then grip again: back in its lane, carrying on round the curve
            var k = Math.min(1, u / 3.4), s1 = s0 + (p.len * 0.93 - s0) * (1 - Math.pow(1 - k, 2)), q2 = at(p, s1);
            var wide = Math.sin(Math.PI * Math.min(1, u / 2.2)), off = 11 * wide;
            x = q2.x + Math.cos(q2.ang + Math.PI / 2) * off; y = q2.y + Math.sin(q2.ang + Math.PI / 2) * off;
            yaw = deg(q2.ang) + 90 - 8 * wide; steer = -18; slideF = u < 1.8; done = u > 2.6;
          } else if (p.pn.kind === 'u2') {
            // the front tires don't grip: the car keeps going nearly straight, off the outside of the curve onto the grass,
            // front wheels still turned, slowing to a stop the right way up
            var k2 = Math.min(1, u / 3.2), d = U2D * (1 - Math.pow(1 - k2, 2)), bend = 0.04 * k2;
            x = L.x + Math.cos(dir + bend * 0.5) * d; y = L.y + Math.sin(dir + bend * 0.5) * d; yaw = deg(dir + bend) + 90;
            steer = -22; slideF = k2 < 0.95; done = k2 >= 1;
            if (p.hit) p.hit.setAttribute('opacity', k2 >= 0.97 ? 1 : 0);
          } else {
            // the rear slides out: the car rotates as it slides off the outside of the curve, then digs in and rolls
            var slide = Math.min(1, u / 1.9), d2 = 64 * (1 - Math.pow(1 - slide, 1.6)), drift = dir + 0.55 * slide;
            x = L.x + Math.cos(drift) * d2; y = L.y + Math.sin(drift) * d2; yaw = deg(dir) + 90 - 230 * Math.pow(slide, 1.3);     // a left-hand curve: the rear swings out right, the car turns counterclockwise
            if (u > 1.9) { var r = Math.min(1, (u - 1.9) / 1.6); roll = 540 * (1 - Math.pow(1 - r, 2)); x += Math.cos(drift) * 22 * r; y += Math.sin(drift) * 22 * r; done = r >= 1; }
          }
        }
        // the car, its front wheels (steered), and rolling: from above, it narrows to its edge and shows its underside
        var c = Math.cos(roll * Math.PI / 180), sc = p.pn.sc;
        p.car.g.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + yaw.toFixed(1) + ') scale(' + sc + ')');
        p.car.roll.setAttribute('transform', 'scale(' + Math.max(0.08, Math.abs(c)).toFixed(3) + ' 1)');
        p.car.under.style.display = c >= 0 ? 'none' : '';
        p.car.wheels.forEach(function (w) { w.g.setAttribute('transform', 'translate(' + w.x + ' ' + w.y + ')' + (w.front ? ' rotate(' + steer.toFixed(1) + ')' : '')); });
        p.car.g.setAttribute('opacity', fade.toFixed(2));
        // its track, and the front tires' skid marks while they slide
        if (tr < RUN) { p.pts.push(x.toFixed(1) + ' ' + y.toFixed(1)); if (p.pts.length > 1) p.trail.setAttribute('d', 'M ' + p.pts.join(' L ')); }
        if (slideF && tr < RUN) {
          var yr = yaw * Math.PI / 180, fx0 = x + Math.sin(yr) * 7.5 * sc, fy0 = y - Math.cos(yr) * 7.5 * sc, ox = Math.cos(yr) * 7.2 * sc, oy = Math.sin(yr) * 7.2 * sc;
          p.skL.push((fx0 - ox).toFixed(1) + ' ' + (fy0 - oy).toFixed(1)); p.skR.push((fx0 + ox).toFixed(1) + ' ' + (fy0 + oy).toFixed(1));
          p.skids.innerHTML = '';
          [p.skL, p.skR].forEach(function (a) { if (a.length > 1) el('path', { d: 'M ' + a.join(' L '), class: 'an-skid' }, p.skids); });
        }
        p.trail.setAttribute('opacity', fade.toFixed(2)); p.skids.setAttribute('opacity', fade.toFixed(2));
        // how it ends: a thought or speech bubble over the car, and for the rolled car, fire
        var hw = p.bub.__w / 2 + 4, bx = Math.max(hw, Math.min(p.pn.w - hw, x)), by = Math.max(36, y - 10 * sc);
        p.bub.setAttribute('transform', 'translate(' + bx.toFixed(1) + ' ' + by.toFixed(1) + ')');
        p.bub.setAttribute('opacity', (done ? fade : 0).toFixed(2));
        if (p.fx) {
          p.fx.g.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
          var fOn = roll >= 540 - 1 ? Math.min(1, (tr - (T0 + 3.5)) / 0.4 + 1) : 0;
          p.fx.g.setAttribute('opacity', (Math.max(0, Math.min(1, fOn)) * fade).toFixed(2)); p.fx.step(t);
        }
      });
    }, RUN + HOLD * 0.5);
    host.__anim = ctl;
    return ctl.stop;
  }
  var WHY_TREAD = '<div class="an-box" id="anStop"></div><p class="an-cap">Three cars on a wet road, braking from the same speed at the same line. On new tires the car stops at the sign, in <b>158 ft</b>. On worn tires it needed <b>226 and 301 ft</b>: 68 to 143 ft more, sliding right through where the first car stopped. Tread is what pushes water out from under a tire, so worn tires lose grip in the rain first.</p>' +
    '<p class="an-src">Source: Discount Tire, Treadwell Research Park: two tires from top-10 tire makers, new vs worn, on a wet road.</p>';
  var WHY_BACK = '<div class="an-box" id="anSteer"></div><p class="an-cap">On a wet road, the tires with less tread hydroplane first. If those are on the <b>back</b>, the rear loses grip before the front and swings out: that\'s <b>oversteer</b>. The car spins, and when its tires dig into the shoulder or grass it can roll over.</p>' +
    '<p class="an-cap">With the better tires on the back, the <b>front</b> tires let go first: that\'s <b>understeer</b>. The front wheels are turned but skid, so the car keeps going straighter than the curve. Easing off the gas usually lets them grip again and the car stays in its lane. But understeer can still run you off the road, into a ditch, a pole, a tree or the next lane: it\'s the safer of the two, not a safe one. Slow down for wet curves either way. So the better tires always go on the rear, whatever wheels drive the car.</p>';
  function openWhy(which) {
    A.subPage(which === 'tread' ? 'Why tread matters' : 'Why the better tires go on the back', which === 'tread' ? WHY_TREAD : WHY_BACK, function (body) {
      return which === 'tread' ? stopAnim(body.querySelector('#anStop')) : steerAnim(body.querySelector('#anSteer'));
    });
  }
  /** A row that opens one of them (a submenu, like Adjust speed by road). */
  function whyRow(which, title, sub) {
    return '<button type="button" class="sub-ent" data-why="' + which + '"><span><b>' + title + '</b><small>' + sub + '</small></span>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z"/></svg></button>';
  }
  /** Can this car have dual rear wheels? Only pickups and vans (a car, SUV, minivan or hybrid can't). */
  function duallyOk(c) { var ty = c.type || ''; return !ty || ty === 'truck' || ty === 'v8deact'; }
  /**
   * The car from above, nose up (a dually: wider at the back, two tires a side), and a trailer behind it when you tow
   * one, with its axles. Each wheel is numbered like the boxes below and colored by its tread (gray: not measured).
   */
  function wheelSvg(c, t) {
    var C = t.corners || {}, P = positions(t), num = {}, T = C.trailer || {};
    P.forEach(function (p, n) { num[p.k] = n + 1; });
    var W = 140, du = !!C.dually, body = du ? 'M52 10 Q70 2 88 10 L90 60 L100 64 L100 104 Q70 112 40 104 L40 64 L50 60 Z' : 'M50 10 Q70 2 90 10 L92 102 Q70 110 48 102 Z';
    var h = '<path d="' + body + '" class="il-body"/><rect x="56" y="22" width="28" height="16" rx="4" class="il-glass"/><rect x="56" y="' + (du ? 46 : 74) + '" width="28" height="' + (du ? 10 : 12) + '" rx="3" class="il-glass"/>' +
      (du ? '<rect x="50" y="62" width="40" height="38" rx="3" class="tz-bed"/>' : '') + '<path d="M70 0 L75 7 L65 7 Z" class="il-front"/>';
    var wheel = function (k, x, y) {
      var d = C[k] && +C[k].depth, f = d > 0 ? depthGood(d) : null;
      return '<g class="tz-w"><rect x="' + (x - 5) + '" y="' + (y - 8) + '" width="10" height="16" rx="2.5" style="fill:' + (f != null ? hue(f) : 'var(--line)') + '"/><text x="' + x + '" y="' + (y + 3) + '" text-anchor="middle">' + num[k] + '</text></g>';
    };
    h += wheel('lf', 44, 26) + wheel('rf', 96, 26);
    if (du) h += wheel('lr', 30, 86) + wheel('lri', 42, 86) + wheel('rri', 98, 86) + wheel('rr', 110, 86);
    else h += wheel('lr', 44, 84) + wheel('rr', 96, 84);
    var H = 116;
    if (T.on) {
      var top = 124, len = 32 + T.axles * 24;
      h += '<line x1="70" y1="108" x2="70" y2="' + (top + 2) + '" class="tz-hitch"/><rect x="38" y="' + top + '" width="64" height="' + len + '" rx="4" class="il-body"/>';
      for (var a = 1; a <= T.axles; a++) {
        var y = top + len - 14 - (T.axles - a) * 24;
        h += '<line x1="' + (T.per === 4 ? 20 : 32) + '" y1="' + y + '" x2="' + (T.per === 4 ? 120 : 108) + '" y2="' + y + '" class="tz-axle"/>';
        h += T.per === 4 ? wheel('t' + a + 'lo', 20, y) + wheel('t' + a + 'li', 32, y) + wheel('t' + a + 'ri', 108, y) + wheel('t' + a + 'ro', 120, y) : wheel('t' + a + 'l', 32, y) + wheel('t' + a + 'r', 108, y);
      }
      H = top + len + 6;
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="max-height:' + Math.round(H * 1.25) + 'px">' + h + '</svg>';
  }

  /** What Advisory says about the tires: [{ level: 'warn'|'info', title, text, check? }]. */
  function advice(c) {
    var t = c && c.tires; if (!t) t = {};
    var out = [], e = estimate(t);
    if (e) {
      var st = status(e.depth), on = e.corner ? ' (' + cname(e.corner, t.corners).toLowerCase() + ')' : '';
      if (st === 'worn') out.push({ level: 'warn', title: 'Tires: replace now', text: (e.measured ? '' : 'About ') + e.depth + '/32 in of tread left' + on + ', at or below the legal limit. Worn tires take much longer to stop on wet roads.' });
      else if (st === 'low') out.push({ level: 'warn', title: 'Tires: replace soon', text: (e.measured ? '' : 'About ') + e.depth + '/32 in of tread left' + on + '. Grip on wet and snowy roads is fading.' });
      else if (st === 'ok') out.push({ level: 'info', title: 'Tires: plan new ones', text: (e.measured ? '' : 'About ') + e.depth + '/32 in of tread left' + on + '. Wet and snow grip start to fade from 4/32 in.' });
    }
    var rot = rotation(corners(t), c && c.info && c.info.drive);
    if (rot && rot.kind !== 'even') out.push({ level: rot.kind === 'replace' ? 'warn' : 'info', title: rot.kind === 'replace' ? 'Tires: replace before rotating' : 'Tires: better ones on the rear', text: rot.notes[0] + (rot.moves.length ? ' ' + rot.moves.map(function (m) { return cname(m.from) + ' → ' + cname(m.to).toLowerCase(); }).join('; ') + '.' : '') });
    if (t.tread && t.tread.mode !== 'measure' && !(t.corners && t.corners.split) && (t.tread.rotated === 'no' || t.tread.rotated === 'sometimes'))
      out.push({ level: 'info', title: 'Rotate your tires', text: 'Moving them to different corners every 5,000 to 7,500 miles makes them wear evenly and last longer.' });
    if (t.utqg && (t.utqg.trac === 'B' || t.utqg.trac === 'C')) out.push({ level: 'info', title: 'Wet roads', text: 'Your tires\' traction grade is ' + t.utqg.trac + ', below the A most tires have. Leave extra room to stop in the rain.' });
    // the spare: air it up every month (and before trips); no spare: a plan
    var k = spareKind(t);
    if (k === 'full' || k === 'compact') out.push({ level: airedOk(t) ? 'done' : 'warn', title: 'Spare tire air', text: (airedOk(t) ? 'Checked ' + new Date(t.spare.aired).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '. ' : '') +
      'A spare loses air sitting in the trunk. Check it every month and before long drives' + (k === 'compact' ? ': compact spares usually need 60 psi (it\'s on the spare\'s side), and they\'re for about 70 miles at up to 50 mph.' : ', to the same pressure as your other tires.'), check: { id: 'spare', label: 'I aired up my spare', on: !!airedOk(t) } });
    else if (k === 'kit' || k === 'none') out.push({ level: 'warn', nodot: true, title: 'No spare tire', text: (k === 'kit' ? 'Your car has a repair kit instead: it fixes small punctures in the tread, not sidewall cuts or blowouts. ' : '') + 'Have a plan for a flat: roadside assistance (your insurer or the car maker may include it), and your phone charged.' });
    else if (k === 'runflat') out.push({ level: 'info', title: 'Run-flat tires', text: 'No spare: after a puncture you can drive about 50 miles at up to 50 mph to get it fixed. Have a plan for a sidewall cut or a blowout.' });
    else out.push({ level: 'info', title: 'Spare tire', text: 'Does your car have one? Look under the trunk floor, then set it in Garage → Tires so Gasket can remind you to keep it aired up.' });
    return out;
  }
  /** One line for the Departure step about the spare, or ''. */
  function departureNote(c) {
    var t = c && c.tires || {}, k = spareKind(t);
    if ((k === 'full' || k === 'compact') && !airedOk(t)) return 'Check your spare tire\'s air before you go (it hasn\'t been checked this month).';
    if (k === 'kit' || k === 'none') return 'Your car has no spare tire: have a plan for a flat (roadside assistance, phone charged).';
    return '';
  }
  /** A spare that needs its monthly air check ticked before a trip goes on (Advisory's Next waits for it). */
  function spareDue(c) { var t = c && c.tires || {}, k = spareKind(t); return (k === 'full' || k === 'compact') && !airedOk(t); }
  root.Tires = { spareDue: spareDue, render: render, summary: summary, summaryHtml: summaryHtml, advice: advice, lookup: lookup, setAired: setAired, departureNote: departureNote, spareKind: spareKind };
})(typeof window !== 'undefined' ? window : globalThis);
