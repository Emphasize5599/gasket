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
  /** What a car's picture depends on (a new year / model / trim / key = look again). */
  function sig(c, hasKey) { return [hasKey ? 'fuel' : 'nhtsa', c.year, norm(c.make), norm(baseModel(c.model)), hasKey ? norm(c.trim) : ''].join('|'); }
  /** The body to draw when there's no photo. */
  function bodyOf(c) { var t = c && c.type, cls = String(c && c.epa && c.epa.vclass || ''); return t === 'truck' || /pickup|van/i.test(cls) ? 'truck' : t === 'suv' || /sport utility|minivan/i.test(cls) ? 'suv' : 'car'; }
  var CarPicMath = { baseModel: baseModel, driveOf: driveOf, matchTrim: matchTrim, colorsOf: colorsOf, pickColor: pickColor, nhtsaPic: nhtsaPic, sig: sig, bodyOf: bodyOf };
  root.CarPicMath = CarPicMath;
  if (typeof module !== 'undefined' && module.exports) module.exports = CarPicMath;
  if (!root.document) return;

  var A = root.__app, S = A.S, N = A.N, LG = root.FLog || { info: function () {}, warn: function () {} };
  var FORMAT = 'color_0640_032_png', FORMAT_ID = 12;      // 640 px, front three-quarter, see-through background
  var RETRY_H = 12, busy = {}, mem = {};
  function call(name) { var args = [].slice.call(arguments, 1); return root.__trip ? root.__trip.call.apply(null, [name].concat(args)) : Promise.reject(new Error('no bridge')); }
  function kvKey(c, color) { return (c.pic && c.pic.src) + '|' + (c.pic && (c.pic.vid || c.pic.url)) + '|' + (color || ''); }
  function stored(k) { if (mem[k]) return mem[k]; try { var o = A.KV.get('carpics', k); if (o && o.v) return (mem[k] = o.v); } catch (e) { } return null; }
  function keep(k, v) { mem[k] = v; try { A.KV.put('carpics', k, v); } catch (e) { } }
  function told(c) { try { root.dispatchEvent(new CustomEvent('carpic', { detail: c.id })); } catch (e) { } }
  function fuel(path) {
    return call('fetchFuel', path, S.fuelKey).then(function (r) {
      if (r.error) throw new Error(r.error);
      var b = JSON.parse(r.body || 'null'); if (r.status) throw new Error((b && b.message) || 'HTTP ' + r.status);
      return b;
    });
  }
  function image(url) { return call('fetchImage', url).then(function (r) { if (r.error || !r.body) throw new Error(r.error || 'no image'); return r.body; }); }
  /** Looks the car up (once per year / model / trim / key), then makes sure its picture in its paint is kept. */
  function ensure(c) {
    if (!c || !c.year || !c.make || !c.model) return;
    var key = !!S.fuelKey, sg = sig(c, key), p = c.pic;
    if (busy[c.id]) return;
    if (p && p.sig === sg) {
      if (p.fail && Date.now() - p.fail < RETRY_H * 3600e3) return;
      if (!p.fail) return fetchPic(c);
    }
    busy[c.id] = 1;
    var done = function () { delete busy[c.id]; A.save(); told(c); fetchPic(c); };
    var fail = function (src, e) { delete busy[c.id]; c.pic = { sig: sg, src: src, fail: Date.now(), err: String(e && e.message || e) }; LG.warn('car', 'No picture from ' + src, c.pic.err); A.save(); told(c); };
    if (key) {
      var q = 'vehicles?year=' + encodeURIComponent(c.year) + '&make=' + encodeURIComponent(c.make) + '&model=' + encodeURIComponent(baseModel(c.model));
      fuel(q).then(function (list) {
        var m = matchTrim(list, c.trim, driveOf(c.model));
        if (!m) throw new Error('not listed');
        return fuel('vehicle/' + encodeURIComponent(m.v.id) + '?productID=2&productFormatIDs=' + FORMAT_ID).then(function (v) {
          var cols = colorsOf(v, FORMAT); if (!cols.length) throw new Error('no pictures');
          c.pic = { sig: sg, src: 'fuel', vid: String(m.v.id), trim: m.v.trim || '', exact: m.exact, colors: cols.map(function (x) { return { code: x.code, name: x.name, simple: x.simple, rgb: x.rgb }; }), t: Date.now() };
          mem['urls|' + c.pic.vid] = cols;
          LG.info('car', 'Pictures from Fuel API: ' + cols.length + ' colors' + (m.exact ? '' : ' (closest trim: ' + (m.v.trim || 'base') + ')'));
          done();
        });
      }).catch(function (e) { fail('fuel', e); });
    } else {
      var u = 'https://api.nhtsa.gov/vehicles/byYmmt?modelYear=' + encodeURIComponent(c.year) + '&make=' + encodeURIComponent(c.make) + '&model=' + encodeURIComponent(baseModel(c.model)) + '&data=none&productDetail=all';
      call('fetchJson', u).then(function (r) {
        if (r.error) throw new Error(r.error);
        var url = nhtsaPic(JSON.parse(r.body)); if (!url) throw new Error('no photo');
        c.pic = { sig: sg, src: 'nhtsa', url: url, t: Date.now() };
        LG.info('car', 'Picture from NHTSA');
        done();
      }).catch(function (e) { fail('nhtsa', e); });
    }
  }
  /** Downloads the picture in the car's paint (Fuel API) or the one photo (NHTSA), unless it's kept already. */
  function fetchPic(c) {
    var p = c.pic; if (!p || p.fail) return;
    var col = p.src === 'fuel' ? pickColor(p.colors, c.paint) : null, k = kvKey(c, col && col.code);
    if (stored(k) || busy['img|' + k]) return;
    busy['img|' + k] = 1;
    var urlP;
    if (p.src === 'nhtsa') urlP = Promise.resolve(p.url);
    else {
      var cached = mem['urls|' + p.vid];
      urlP = cached ? Promise.resolve(cached) : fuel('vehicle/' + encodeURIComponent(p.vid) + '?productID=2&productFormatIDs=' + FORMAT_ID).then(function (v) { return (mem['urls|' + p.vid] = colorsOf(v, FORMAT)); });
      urlP = urlP.then(function (cols) { var m = pickColor(cols, col); if (!m) throw new Error('no picture in that color'); return m.url; });
    }
    urlP.then(image).then(function (data) { keep(k, data); delete busy['img|' + k]; told(c); })
      .catch(function (e) { delete busy['img|' + k]; LG.warn('car', 'Couldn\'t download the car\'s picture', String(e && e.message || e)); });
  }
  /** The car's kept picture (a data URL), or null while it's on its way / when there isn't one. */
  function src(c) {
    var p = c && c.pic; if (!p || p.fail) return null;
    var col = p.src === 'fuel' ? pickColor(p.colors, c.paint) : null;
    return stored(kvKey(c, col && col.code));
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
    var p = c && c.pic; if (!p || p.fail) return '';
    return p.src === 'fuel' ? 'Photo: EVOX via Fuel API' + (p.exact === false ? ' · closest trim: ' + (p.trim || 'base') : '') : 'Photo: NHTSA (EVOX)';
  }
  function keyChanged() { (S.cars || []).forEach(function (c) { if (c.pic) delete c.pic; }); LG.info('car', 'Car pictures: ' + (S.fuelKey ? 'Fuel API key set' : 'no Fuel API key (NHTSA photos)')); A.save(); }
  root.CarPics = { ensure: ensure, src: src, drawing: drawing, credit: credit, keyChanged: keyChanged, colors: function (c) { return c && c.pic && c.pic.src === 'fuel' ? c.pic.colors || [] : []; } };
})(typeof window !== 'undefined' ? window : globalThis);
