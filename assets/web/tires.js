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
  /** The shallowest tire you measured (corners and any extra wheels), or null. */
  function worst(t) {
    var c4 = corners(t); if (!c4) return null;
    var all = CORNERS.map(function (x) { return { k: x.k, depth: c4[x.k] }; }).concat(((t.corners.extra) || []).map(function (e) { return { k: e.id, name: e.name, depth: +e.depth > 0 ? +e.depth : null }; }));
    var got = all.filter(function (x) { return x.depth != null; });
    return got.length ? got.sort(function (a, b) { return a.depth - b.depth; })[0] : null;
  }
  /**
   * Where each tire should go (depths in 32nds; drive 'fwd' | 'rwd' | 'awd' | '4wd'). The better pair goes on the rear:
   * with less grip at the back, a wet curve or a hydroplane can swing the rear out (oversteer, a spin); with the better
   * grip there, the car tends to run wide instead (understeer), which easing off fixes. A tire at 4/32 or less never moves to
   * the rear: those are replaced (on a front-wheel-drive car with worn fronts: replace the fronts, new ones on the rear).
   * -> { kind: 'even' | 'move' | 'replace', moves: [{ from, to }], replace: [keys], notes: [text], pattern } or null.
   */
  function rotation(d, drive) {
    if (!d || CORNERS.some(function (x) { return !(d[x.k] > 0); })) return null;
    drive = String(drive || '').toLowerCase();
    var keys = CORNERS.map(function (x) { return x.k; }), notes = [];
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
    CORNERS: CORNERS, corners: corners, worst: worst, rotation: rotation, fuelScore: fuelScore, parseSpare: parseSpare,
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
  var detOpen = {}, whyOpen = {};
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
    if (whyOpen[c.id] == null) whyOpen[c.id] = !e || st === 'low' || st === 'worn';
    h += '<div class="sub-h tz-h">Tread left</div>';
    h += '<details class="tz-why" id="tzWhy"' + (whyOpen[c.id] ? ' open' : '') + '><summary>Why tread matters</summary>' + stopSvg() + '</details>';
    h += '<div class="field tz-split"><div class="lbl">My tires aren\'t all the same<small>' + Q.split + '</small></div><label class="switch"><input type="checkbox" id="tzSplit"' + (C.split ? ' checked' : '') + '><span></span></label></div>';
    var deep = /mud|terrain/i.test(t.type || '') ? 15 : 12;
    if (!C.split) {
      h += '<div class="seg2" id="tzMode"><button data-mode="miles" class="' + (r.mode !== 'measure' ? 'on' : '') + '">Estimate it</button><button data-mode="measure" class="' + (r.mode === 'measure' ? 'on' : '') + '">I measured it</button></div>';
      if (r.mode === 'measure') h += '<label class="nf wide"><span>Shallowest groove' + q(Q.measure) + '</span><select id="tzDepth">' + depthOpts(r.depth, deep) + '</select></label>';
      else h += '<div class="grid2"><label class="nf"><span>Miles on these tires' + q(Q.miles) + '</span><input type="number" inputmode="numeric" min="0" step="1000" id="tzMiles" placeholder="e.g. 20000" value="' + esc(r.miles === '' || r.miles == null ? '' : r.miles) + '"></label>' +
        '<label class="nf"><span>Rotated regularly?' + q(Q.rotate) + '</span><select id="tzRot">' + [['', 'Pick…'], ['yes', 'Yes'], ['sometimes', 'Sometimes'], ['no', 'Never'], ['unsure', 'Not sure']].map(function (o) { return '<option value="' + o[0] + '"' + ((r.rotated || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label></div>';
    } else {
      // each corner around the car, then any extra wheels (duals, a trailer)
      var cell = function (k, nm) { var d = C[k] && C[k].depth, f = d ? depthGood(d) : null; return '<label class="nf tz-c"><span>' + (f != null ? '<i class="tz-dot" style="background:' + hue(f) + '"></i>' : '') + nm + '</span><select data-corner="' + k + '">' + depthOpts(d, deep, true) + '</select></label>'; };
      h += '<div class="lead small keep">The shallowest groove of each tire' + q(Q.measure) + '</div>';
      h += '<div class="tz-car">' + cell('lf', 'Driver front') + '<div class="tz-body" aria-hidden="true">' + carTopSvg() + '</div>' + cell('rf', 'Passenger front') + cell('lr', 'Driver rear') + cell('rr', 'Passenger rear') + '</div>';
      (C.extra || []).forEach(function (x) {
        h += '<div class="tz-extra" data-x="' + esc(x.id) + '"><input type="text" maxlength="30" data-xname="' + esc(x.id) + '" value="' + esc(x.name) + '" aria-label="Which wheel"><select data-xdepth="' + esc(x.id) + '">' + depthOpts(x.depth, deep, true) + '</select>' +
          '<button class="x sm" data-xdel="' + esc(x.id) + '" aria-label="Remove this wheel">✕</button></div>' + (x.kind === 'trailer' ? '<div class="lead small keep tz-xnote">Trailer tires count toward your tire warnings; trip plans don\'t include towing yet.</div>' : '');
      });
      h += '<div class="btns wrap tz-add"><button class="btn tonal sm" id="tzAddDual">+ Dual wheel</button><button class="btn tonal sm" id="tzAddTrailer">+ Trailer tire</button></div>';
      var rot = rotation(corners(t), (c.info && c.info.drive) || '');
      if (rot) {
        h += '<div class="tz-rot ' + rot.kind + '"><b>' + (rot.kind === 'replace' ? 'Replace before rotating' : rot.kind === 'move' ? 'Move these tires' : 'Where they are is fine') + '</b>' +
          (rot.moves.length ? '<ul>' + rot.moves.map(function (m) { return '<li>' + esc(cname(m.from)) + ' → ' + esc(cname(m.to)) + ' <small>(' + C[m.from].depth + '/32 in)</small></li>'; }).join('') + '</ul>' : '') +
          rot.notes.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') + (!(c.info && c.info.drive) ? '<p class="tz-xnote">Add your drive (front-, rear- or all-wheel) under About this car for advice that fits it.</p>' : '') + '</div>';
      } else h += '<div class="lead small keep">Fill in all four corners and Gasket says which tires should go where.</div>';
      h += '<details class="tz-why" id="tzBack"><summary>Why the better tires go on the back</summary>' + steerSvg() + '</details>';
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
    var x = CORNERS.filter(function (y) { return y.k === k; })[0];
    if (x) return x.name;
    var e = ((C || {}).extra || []).filter(function (y) { return y.id === k; })[0]; return e ? e.name : k;
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
    $('tzWhy').addEventListener('toggle', function () { whyOpen[c.id] = this.open; });
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
    var C = function () { t.corners = t.corners || { split: false, extra: [] }; t.corners.extra = t.corners.extra || []; return t.corners; };
    $('tzSplit').onchange = set(function () { C().split = this.checked; LG.info('car', 'Tires: ' + (this.checked ? 'each corner' : 'all the same')); });
    host.querySelectorAll('[data-corner]').forEach(function (s) { s.onchange = set(function () { C()[s.dataset.corner] = { depth: parseFloat(s.value) || '', t: Date.now() }; }); });
    var add = function (kind, name) { return set(function () { C().extra.push({ id: 'w' + Date.now(), kind: kind, name: name, depth: '' }); }); };
    if ($('tzAddDual')) $('tzAddDual').onclick = add('dual', 'Dual inner rear');
    if ($('tzAddTrailer')) $('tzAddTrailer').onclick = add('trailer', 'Trailer tire');
    var X = function (id) { return C().extra.filter(function (x) { return x.id === id; })[0]; };
    host.querySelectorAll('[data-xname]').forEach(function (i) { i.onchange = function () { var x = X(i.dataset.xname); if (x) { x.name = i.value.trim() || x.name; save(); onChange(); } }; });
    host.querySelectorAll('[data-xdepth]').forEach(function (s) { s.onchange = set(function () { var x = X(s.dataset.xdepth); if (x) x.depth = parseFloat(s.value) || ''; }); });
    host.querySelectorAll('[data-xdel]').forEach(function (b) { b.onclick = set(function () { C().extra = C().extra.filter(function (x) { return x.id !== b.dataset.xdel; }); }); });
    // the spare
    $('tzSpare').onchange = set(function () { spare(t).kind = this.value; LG.info('car', 'Spare tire: ' + (this.value || 'not sure')); });
    if ($('tzSpareYes')) $('tzSpareYes').onclick = set(function () { spare(t).kind = spare(t).lookup.guess; LG.info('car', 'Spare tire confirmed: ' + spare(t).kind); });
  }
  window.addEventListener('garagechange', function () { var c = G() && G().car(); if (c && host && host.isConnected) { lookup(c); spareLookup(c); draw(); } });

  // ---------- pictures: why tread matters, and why the better tires go on the back ----------
  /** Stopping on a wet road, new vs worn tires (Discount Tire's Treadwell Research Park figures, credited). */
  function stopSvg() {
    var X0 = 64, W = 236, ft = function (n) { return X0 + W * n / 301; };
    var row = function (y, lab, n, cls) {
      return '<text x="0" y="' + (y + 9) + '" class="il-t">' + lab + '</text><rect x="' + X0 + '" y="' + y + '" width="' + (ft(n) - X0).toFixed(1) + '" height="12" rx="3" class="' + cls + '"/>' +
        '<g transform="translate(' + (ft(n) - 1).toFixed(1) + ' ' + (y - 13) + ')" class="il-car"><path d="M0 10 L2 6 L7 5 L10 1 L17 1 L21 5 L25 6 L25 10 Z"/><circle cx="6" cy="10.5" r="2.4"/><circle cx="19.5" cy="10.5" r="2.4"/></g>' +
        '<text x="' + (ft(n) - 4).toFixed(1) + '" y="' + (y + 9.5) + '" class="il-n" text-anchor="end">' + n + ' ft</text>';
    };
    return '<figure class="il"><svg viewBox="0 0 330 118" role="img" aria-label="Stopping on a wet road: new tires stopped in 158 feet; worn tires took 226 and 301 feet.">' +
      '<line x1="' + ft(158).toFixed(1) + '" y1="6" x2="' + ft(158).toFixed(1) + '" y2="112" class="il-stop"/><text x="' + (ft(158) + 3).toFixed(1) + '" y="12" class="il-s">new tires stop here</text>' +
      row(26, 'New tires', 158, 'il-good') + row(58, 'Worn tire A', 226, 'il-bad') + row(90, 'Worn tire B', 301, 'il-bad') + '</svg>' +
      '<figcaption>The same cars braking on a wet road. With worn tires they needed <b>68 to 143 ft more</b> to stop: about 40% to 90% farther, past where the car with new tires had already stopped. Tread is what pushes water out from under the tire, so worn tires lose grip in the rain first.' +
      '<small>Source: Discount Tire, Treadwell Research Park (two tires from top-10 tire makers, new vs worn, on a wet road).</small></figcaption></figure>';
  }
  /** Understeer (the front slides: the car runs wide) vs oversteer (the rear slides out: a spin), from above. */
  function steerSvg() {
    var road = '<path d="M 112 150 C 112 92, 92 56, 26 30" class="il-road"/><path d="M 112 150 C 112 92, 92 56, 26 30" class="il-lane"/>';
    var car = function (x, y, a, cls) { return '<g transform="translate(' + x + ' ' + y + ') rotate(' + a + ')" class="' + cls + '"><rect x="-7" y="-13" width="14" height="26" rx="4"/><rect x="-5.5" y="-8" width="11" height="6" rx="1.5" class="il-glass"/></g>'; };
    var panel = function (dx, title, body) { return '<g transform="translate(' + dx + ' 0)">' + road + body + '<text x="70" y="168" class="il-h" text-anchor="middle">' + title + '</text></g>'; };
    var under = '<path d="M 112 140 C 114 110, 118 84, 124 50" class="il-path warn"/>' + car(124, 50, 10, 'il-car2 warn');
    var over = '<path d="M 112 140 C 112 112, 106 92, 96 80" class="il-path bad"/>' + car(92, 78, 70, 'il-car2 bad') + '<path d="M 104 92 C 112 92, 116 86, 116 78" class="il-arrow bad"/>';
    return '<figure class="il"><svg viewBox="0 0 330 176" role="img" aria-label="From above: understeer, the car runs wide of the curve; oversteer, the rear swings out and the car spins.">' +
      panel(0, 'Understeer: runs wide', under) + panel(170, 'Oversteer: spins', over) + '</svg>' +
      '<figcaption>On a wet road, the tires with less tread hydroplane first. If those are on the <b>back</b>, the rear loses grip before the front and swings out (oversteer): a spin, and when the tires grab again the car can roll over. With the better tires on the back, the front lets go first and the car runs wide (understeer). Easing off the gas brings it back. So the better tires always go on the rear, whatever drives the car.</figcaption></figure>';
  }
  /** A small car from above, for the corner picker. */
  function carTopSvg() {
    return '<svg viewBox="0 0 40 80"><rect x="6" y="4" width="28" height="72" rx="10" class="il-body"/><rect x="10" y="20" width="20" height="12" rx="3" class="il-glass"/><rect x="10" y="54" width="20" height="9" rx="3" class="il-glass"/>' +
      '<rect x="1" y="12" width="6" height="14" rx="2" class="il-wheel"/><rect x="33" y="12" width="6" height="14" rx="2" class="il-wheel"/><rect x="1" y="54" width="6" height="14" rx="2" class="il-wheel"/><rect x="33" y="54" width="6" height="14" rx="2" class="il-wheel"/>' +
      '<path d="M20 0 L24 6 L16 6 Z" class="il-front"/></svg>';
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
  root.Tires = { render: render, summary: summary, summaryHtml: summaryHtml, advice: advice, lookup: lookup, setAired: setAired, departureNote: departureNote, spareKind: spareKind };
})(typeof window !== 'undefined' ? window : globalThis);
