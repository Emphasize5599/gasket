/* Gasket — car pictures (Garage). With the owner's Fuel API key: the exact trim in its factory paint colors (EVOX photos).
 * Without one: NHTSA's photo of the model (the one nhtsa.gov's vehicle pages show). Neither: a drawing of the body style in
 * the car's paint color. Pictures are kept (KV 'carpics', cache) so each is downloaded once; Fuel API's links expire.
 * CarPicMath is pure and runs in Node for the tests. */
(function (root) {
  'use strict';
  var DRIVE = /\s+(2WD|4WD|AWD|FWD|RWD|4x4)$/i;
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  /** "Venza AWD" -> "Venza" (the EPA adds the drive to some model names). */
  function baseModel(m) { return String(m || '').replace(DRIVE, '').trim(); }
  function driveOf(m) { var x = DRIVE.exec(String(m || '')); return x ? x[1].toUpperCase().replace('4X4', '4WD') : ''; }
  /**
   * The Fuel API vehicle for a car: its trim word for word, else one whose trim contains yours (or yours contains it), the
   * drive breaking ties; no trim given: the first. -> { v, exact } or null.
   */
  function matchTrim(list, trim, drive) {
    if (!list || !list.length) return null;
    var t = norm(trim), d = String(drive || '').toUpperCase();
    var byDrive = function (a) { if (!d) return a; var f = a.filter(function (v) { return String(v.drivetrain || '').toUpperCase() === d; }); return f.length ? f : a; };
    if (t) {
      var ex = byDrive(list.filter(function (v) { return norm(v.trim) === t; }));
      if (ex.length) return { v: ex[0], exact: true };
      var part = byDrive(list.filter(function (v) { var n = norm(v.trim); return n && (n.indexOf(t) >= 0 || t.indexOf(n) >= 0); }));
      if (part.length) return { v: part[0], exact: false };
    }
    return { v: byDrive(list)[0], exact: false };
  }
  /** Fuel API's color assets -> [{ code, name, simple, rgb, url }] (one per paint). */
  function colorsOf(vehicle, formatCode) {
    var out = [], seen = {};
    ((vehicle && vehicle.products) || []).forEach(function (p) {
      (p.productFormats || []).forEach(function (f) {
        if (formatCode && f.code !== formatCode) return;
        (f.assets || []).forEach(function (a) {
          var c = a.shotCode && a.shotCode.color; if (!c || seen[c.code]) return; seen[c.code] = 1;
          out.push({ code: c.code, name: c.oem_name || c.simple_name || c.code, simple: c.simple_name || '', rgb: c.rgb1 ? '#' + c.rgb1 : '', url: a.url });
        });
      });
    });
    return out;
  }
  /** The paint to show: the car's own (by code, then name), else the first. */
  function pickColor(colors, paint) {
    if (!colors || !colors.length) return null;
    if (paint) {
      var m = colors.filter(function (c) { return paint.code && c.code === paint.code; })[0] || colors.filter(function (c) { return paint.name && norm(c.name) === norm(paint.name); })[0];
      if (m) return m;
    }
    return colors[0];
  }
  /** NHTSA's vehicles for a year / make / model -> the first picture's URL, or ''. */
  function nhtsaPic(res) { var r = (res && res.results) || []; for (var i = 0; i < r.length; i++) if (r[i].vehiclePicture) return r[i].vehiclePicture; return ''; }
  /** What each lookup depends on: NHTSA has one photo per model; Fuel API goes by the trim too. */
  function sig(c, src) { return [src, c.year, norm(c.make), norm(baseModel(c.model)), src === 'fuel' ? norm(c.trim) : ''].join('|'); }
  /**
   * Which picture to show: NHTSA's photo by default; Fuel API's when you've picked one of its paint colors, or when NHTSA
   * has no photo of the car (and there's a key). -> 'nhtsa' | 'fuel' | null (draw it).
   */
  function which(pic, paint, hasKey) {
    var n = pic && pic.nhtsa, f = pic && pic.fuel, fOk = hasKey && f && !f.fail && f.colors && f.colors.length;
    if (fOk && paint && paint.code && f.colors.some(function (x) { return x.code === paint.code; })) return 'fuel';
    if (n && n.url) return 'nhtsa';
    if (fOk && n && n.fail) return 'fuel';
    return null;
  }
  /** The body to draw when there's no photo. */
  function bodyOf(c) { var t = c && c.type, cls = String(c && c.epa && c.epa.vclass || ''); return t === 'truck' || /pickup|van/i.test(cls) ? 'truck' : t === 'suv' || /sport utility|minivan/i.test(cls) ? 'suv' : 'car'; }
  var CarPicMath = { baseModel: baseModel, driveOf: driveOf, matchTrim: matchTrim, colorsOf: colorsOf, pickColor: pickColor, nhtsaPic: nhtsaPic, sig: sig, which: which, bodyOf: bodyOf };
  root.CarPicMath = CarPicMath;
  if (typeof module !== 'undefined' && module.exports) module.exports = CarPicMath;
  if (!root.document) return;

  var A = root.__app, S = A.S, LG = root.FLog || { info: function () {}, warn: function () {} };
  var FORMAT = 'color_0640_032_png', FORMAT_ID = 12;      // 640 px, front three-quarter, see-through background
  var RETRY_H = 12, busy = {}, mem = {};
  function call(name) { var args = [].slice.call(arguments, 1); return root.__trip ? root.__trip.call.apply(null, [name].concat(args)) : Promise.reject(new Error('no bridge')); }
  function stored(k) { if (mem[k]) return mem[k]; try { var o = A.KV.get('carpics', k); if (o && o.v) return (mem[k] = o.v); } catch (e) { } return null; }
  function keep(k, v) { mem[k] = v; try { A.KV.put('carpics', k, v); } catch (e) { } }
  function told(c) { try { root.dispatchEvent(new CustomEvent('carpic', { detail: c.id })); } catch (e) { } }
  function P(c) { if (!c.pic || c.pic.src) c.pic = {}; return c.pic; }     // (0.0.83 kept one source: looked up again)
  function fuel(path) {
    return call('fetchFuel', path, S.fuelKey).then(function (r) {
      if (r.error) throw new Error(r.error);
      var b = JSON.parse(r.body || 'null'); if (r.status) throw new Error((b && b.message) || 'HTTP ' + r.status);
      return b;
    });
  }
  function image(url) { return call('fetchImage', url).then(function (r) { if (r.error || !r.body) throw new Error(r.error || 'no image'); return r.body; }); }
  function due(x, sg) { return !x || x.sig !== sg || (x.fail && Date.now() - x.fail > RETRY_H * 3600e3); }
  /** NHTSA's photo of the model (free, no key): looked up once per year / make / model. */
  function lookNhtsa(c) {
    var sg = sig(c, 'nhtsa'), b = 'n|' + c.id;
    if (!due(P(c).nhtsa, sg) || busy[b]) return Promise.resolve();
    busy[b] = 1;
    var u = 'https://api.nhtsa.gov/vehicles/byYmmt?modelYear=' + encodeURIComponent(c.year) + '&make=' + encodeURIComponent(c.make) + '&model=' + encodeURIComponent(baseModel(c.model)) + '&data=none&productDetail=all';
    return call('fetchJson', u).then(function (r) {
      if (r.error) throw new Error(r.error);
      var url = nhtsaPic(JSON.parse(r.body)); if (!url) throw new Error('no photo');
      P(c).nhtsa = { sig: sg, url: url, t: Date.now() }; LG.info('car', 'Picture from NHTSA');
    }).catch(function (e) { P(c).nhtsa = { sig: sg, fail: Date.now(), err: String(e && e.message || e) }; LG.info('car', 'No NHTSA photo', P(c).nhtsa.err); })
      .then(function () { delete busy[b]; A.save(); told(c); });
  }
  /** Fuel API's trim and its paint colors (needs the key): only when you open the paint colors, or NHTSA has no photo. */
  function lookFuel(c) {
    var sg = sig(c, 'fuel'), b = 'f|' + c.id;
    if (!S.fuelKey || !due(P(c).fuel, sg) || busy[b]) return Promise.resolve();
    busy[b] = 1;
    var q = 'vehicles?year=' + encodeURIComponent(c.year) + '&make=' + encodeURIComponent(c.make) + '&model=' + encodeURIComponent(baseModel(c.model));
    return fuel(q).then(function (list) {
      var m = matchTrim(list, c.trim, driveOf(c.model)); if (!m) throw new Error('not listed');
      return fuel('vehicle/' + encodeURIComponent(m.v.id) + '?productID=2&productFormatIDs=' + FORMAT_ID).then(function (v) {
        var cols = colorsOf(v, FORMAT); if (!cols.length) throw new Error('no pictures');
        mem['urls|' + m.v.id] = cols;
        P(c).fuel = { sig: sg, vid: String(m.v.id), trim: m.v.trim || '', exact: m.exact, colors: cols.map(function (x) { return { code: x.code, name: x.name, simple: x.simple, rgb: x.rgb }; }), t: Date.now() };
        LG.info('car', 'Fuel API: ' + cols.length + ' colors' + (m.exact ? '' : ' (closest trim: ' + (m.v.trim || 'base') + ')'));
      });
    }).catch(function (e) { P(c).fuel = { sig: sg, fail: Date.now(), err: String(e && e.message || e) }; LG.warn('car', 'No Fuel API pictures', P(c).fuel.err); })
      .then(function () { delete busy[b]; A.save(); told(c); });
  }
  function shown(c) { return which(c.pic, c.paint, !!S.fuelKey); }
  function imgKey(c) {
    var w = shown(c), p = c.pic || {};
    if (w === 'nhtsa') return 'nhtsa|' + p.nhtsa.url;
    if (w === 'fuel') { var col = pickColor(p.fuel.colors, c.paint); return 'fuel|' + p.fuel.vid + '|' + (col && col.code); }
    return null;
  }
  /** Makes sure the picture to show is looked up and kept: NHTSA first; Fuel API when it's wanted (see which). */
  function ensure(c) {
    if (!c || !c.year || !c.make || !c.model) return;
    lookNhtsa(c).then(function () {
      var p = c.pic || {}, wantFuel = S.fuelKey && ((c.paint && c.paint.code) || (p.nhtsa && p.nhtsa.fail));
      return wantFuel ? lookFuel(c) : null;
    }).then(function () { fetchPic(c); });
  }
  /** The trim's factory colors, for the paint picker (asks Fuel API once; needs the key). */
  function loadColors(c) { if (c && c.year && c.make && c.model && S.fuelKey) lookFuel(c); }
  function fetchPic(c) {
    var w = shown(c), k = imgKey(c); if (!k || stored(k) || busy['img|' + k]) return;
    busy['img|' + k] = 1;
    var p = c.pic, urlP;
    if (w === 'nhtsa') urlP = Promise.resolve(p.nhtsa.url);
    else {
      var want = pickColor(p.fuel.colors, c.paint), cached = mem['urls|' + p.fuel.vid];
      urlP = (cached ? Promise.resolve(cached) : fuel('vehicle/' + encodeURIComponent(p.fuel.vid) + '?productID=2&productFormatIDs=' + FORMAT_ID).then(function (v) { return (mem['urls|' + p.fuel.vid] = colorsOf(v, FORMAT)); }))
        .then(function (cols) { var m = pickColor(cols, want); if (!m) throw new Error('no picture in that color'); return m.url; });
    }
    urlP.then(image).then(function (data) { keep(k, data); delete busy['img|' + k]; told(c); })
      .catch(function (e) { delete busy['img|' + k]; LG.warn('car', 'Couldn\'t download the car\'s picture', String(e && e.message || e)); });
  }
  /** The kept picture to show (a data URL), or null while it's on its way / when there isn't one. */
  function src(c) { var k = c && imgKey(c); return k ? stored(k) : null; }
  /** Still looking (show a loading bar over the drawing). */
  function pending(c) {
    if (!c || !c.year || !c.make || !c.model) return false;
    var p = c.pic || {}; if (busy['n|' + c.id] || busy['f|' + c.id]) return true;
    if (!p.nhtsa || p.nhtsa.sig !== sig(c, 'nhtsa')) return true;
    var k = imgKey(c); return !!(k && !stored(k));
  }
  /** A drawing of the body style in the car's paint color (no photo). */
  function drawing(c) {
    var b = bodyOf(c), col = (c.paint && c.paint.rgb) || '#8a929c';
    var body = b === 'truck' ? 'M18 70 L18 52 L60 50 L74 30 L120 30 L130 50 L182 52 L184 70 Z' : b === 'suv' ? 'M16 70 L16 50 L34 46 L56 26 L150 24 L172 46 L184 50 L186 70 Z' : 'M14 70 L14 56 L40 50 L68 32 L132 32 L158 50 L184 54 L186 70 Z';
    var glass = b === 'truck' ? 'M78 34 L116 34 L124 50 L66 50 Z' : b === 'suv' ? 'M60 30 L146 28 L164 46 L44 46 Z' : 'M72 36 L128 36 L148 50 L56 50 Z';
    return '<svg class="gc-draw" viewBox="0 0 200 92" role="img" aria-label="' + (b === 'truck' ? 'Pickup' : b === 'suv' ? 'SUV' : 'Car') + ' drawing">' +
      '<ellipse cx="100" cy="82" rx="88" ry="5" class="gc-shadow"/><path d="' + body + '" fill="' + col + '" class="gc-body"/><path d="' + glass + '" class="gc-glass"/>' +
      '<circle cx="50" cy="72" r="12" class="gc-tire"/><circle cx="150" cy="72" r="12" class="gc-tire"/><circle cx="50" cy="72" r="5" class="gc-hub"/><circle cx="150" cy="72" r="5" class="gc-hub"/></svg>';
  }
  /** Where the picture came from, for the line under it. */
  function credit(c) {
    var w = c && shown(c), f = c && c.pic && c.pic.fuel;
    return w === 'fuel' ? 'Photo: EVOX via Fuel API' + (f.exact === false ? ' · closest trim: ' + (f.trim || 'base') : '') : w === 'nhtsa' ? 'Photo: NHTSA (EVOX)' : '';
  }
  function keyChanged() { (S.cars || []).forEach(function (c) { if (c.pic) { delete c.pic.fuel; delete c.pic.src; } }); LG.info('car', 'Car pictures: ' + (S.fuelKey ? 'Fuel API key set' : 'no Fuel API key')); A.save(); }
  root.CarPics = { ensure: ensure, loadColors: loadColors, src: src, pending: pending, drawing: drawing, credit: credit, keyChanged: keyChanged, shown: shown,
    hasKey: function () { return !!S.fuelKey; }, busyColors: function (c) { return !!(c && busy['f|' + c.id]); },
    colors: function (c) { var f = c && c.pic && c.pic.fuel; return S.fuelKey && f && !f.fail ? f.colors || [] : []; } };
})(typeof window !== 'undefined' ? window : globalThis);
