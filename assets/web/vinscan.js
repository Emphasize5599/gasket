/**
 * VIN barcode scanner (Garage → car editor → the camera button in the VIN box).
 *
 * VIN labels carry the VIN as a Code 39 barcode (driver door jamb, older windshield tags) or as a Data Matrix / QR
 * code (newer labels). Decoding is ZXing (lib/zxing.min.js, Apache-2.0), loaded on the first scan: Chrome's own
 * BarcodeDetector needs Google Play services on Android, which GrapheneOS phones don't have. The camera is the page's
 * getUserMedia (the native side grants video capture to this page only, after Android's camera permission); frames
 * are read on the phone and never sent or saved. The VIN itself is never logged.
 *
 * VinScanMath (pure, tests/vinscan.test.js): pick(text) = the VIN in what a barcode said, check(vin) = its North
 * American check digit (position 9). A reading is taken when its check digit adds up, or when two frames in a row
 * read the same 17 characters (VINs from outside North America have no check digit; Code 39 has no checksum of its own).
 */
(function (root) {
  'use strict';
  var MAP = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  var WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  function check(vin) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
    var sum = 0;
    for (var i = 0; i < 17; i++) { var ch = vin[i]; sum += (/\d/.test(ch) ? +ch : MAP[ch]) * WEIGHTS[i]; }
    var r = sum % 11;
    return vin[8] === (r === 10 ? 'X' : String(r));
  }
  /** The VIN in a barcode's text: a field of exactly 17 VIN characters, a check-digit-valid one first. Imported cars'
   * Code 39 labels often start with an extra "I" (never a VIN letter); labels with more fields separate them. Never 17
   * characters out of a longer field: about one window in 11 passes the check digit by chance. -> {vin, checked} | null */
  function pick(text) {
    var words = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, ' ').split(' ').map(function (w) { return w.length === 18 && w[0] === 'I' ? w.slice(1) : w; })
      .filter(function (w) { return /^[A-HJ-NPR-Z0-9]{17}$/.test(w); });
    var ok = words.filter(check)[0];
    return ok ? { vin: ok, checked: true } : words[0] ? { vin: words[0], checked: false } : null;
  }
  var math = { check: check, pick: pick };
  if (typeof module !== 'undefined' && module.exports) { module.exports = math; return; }
  root.VinScanMath = math;

  var A = root.__app, LG = root.FLog || { info: function () { }, warn: function () { } };
  var libP = null;
  function loadLib() {
    if (root.ZXing) return Promise.resolve(root.ZXing);
    return libP || (libP = new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = 'lib/zxing.min.js';
      s.onload = function () { root.ZXing ? ok(root.ZXing) : no(new Error('The barcode reader didn\'t load.')); };
      s.onerror = function () { libP = null; no(new Error('The barcode reader didn\'t load.')); };
      document.head.appendChild(s);
    }));
  }
  // the route button's viewfinder corners around barcode bars
  var CAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h6v2H5v4H3zm12 0h6v6h-2V5h-4zM3 15h2v4h4v2H3zm16 0h2v6h-6v-2h4z"/><path d="M7 8h1.5v8H7zm2.5 0h1v8h-1zm2 0h2v8h-2zm3 0h1v8h-1zm2 0h.5v8H16z"/></svg>';

  /** Open the camera; resolves with the VIN, or null when closed. */
  function open() {
    if (root.__vinScanClose) root.__vinScanClose();
    return new Promise(function (resolve) {
      var el = document.createElement('div');
      el.className = 'vin-scan'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Scan the VIN barcode');
      el.innerHTML = '<video playsinline muted></video><div class="vs-frame" aria-hidden="true"></div>' +
        '<div class="vs-top"><button type="button" class="vs-close" aria-label="Close the scanner"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>' +
        '<button type="button" class="vs-torch hidden" aria-label="Light" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10v3l-2 4v13H9V9L7 5z"/></svg></button></div>' +
        '<p class="vs-hint">Point at the VIN barcode: on the driver\'s door jamb, or the windshield corner on newer cars. Turn the phone so the barcode runs across the screen.</p><p class="vs-msg" aria-live="polite"></p>';
      document.body.appendChild(el);
      var video = el.querySelector('video'), msg = el.querySelector('.vs-msg'), stream = null, timer = 0, done = false, last = null, reader = null, ZX = null;
      var canvas = document.createElement('canvas'), turn = document.createElement('canvas'), n = 0;
      function finish(vin) {
        if (done) return; done = true; clearTimeout(timer); root.__vinScanClose = null;
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        el.remove(); resolve(vin || null);
      }
      root.__vinScanClose = function () { finish(null); };
      el.querySelector('.vs-close').onclick = function () { finish(null); };
      function fail(text) { msg.textContent = text; msg.classList.add('err'); }
      // one frame: the middle band (where the guide is), as is and turned a quarter (door-jamb labels stand upright)
      function frame() {
        if (done) return;
        var w = video.videoWidth, h = video.videoHeight;
        if (w && h && reader) {
          var cw = Math.round(w * 0.9), ch = Math.round(h * 0.5), sx = Math.round((w - cw) / 2), sy = Math.round((h - ch) / 2);
          var src = canvas, odd = n++ % 2;
          canvas.width = cw; canvas.height = ch; canvas.getContext('2d').drawImage(video, sx, sy, cw, ch, 0, 0, cw, ch);
          if (odd) { turn.width = ch; turn.height = cw; var t = turn.getContext('2d'); t.save(); t.translate(ch, 0); t.rotate(Math.PI / 2); t.drawImage(canvas, 0, 0); t.restore(); src = turn; }
          try {
            var res = reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.HTMLCanvasElementLuminanceSource(src))));
            var p = pick(res.getText());
            if (p && (p.checked || last === p.vin)) {
              LG.info('car', 'VIN barcode read', { format: ZX.BarcodeFormat[res.getBarcodeFormat()], checkDigit: p.checked });
              if (A && A.N && A.N.tick) A.N.tick();
              return finish(p.vin);
            }
            last = p ? p.vin : null;
            if (!p) msg.textContent = 'That barcode isn\'t a VIN. Look for the one labeled VIN.';
          } catch (e) { /* nothing readable in this frame */ } finally { if (reader) reader.reset(); }
        }
        timer = setTimeout(frame, 120);
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fail('This phone\'s camera isn\'t available here. Type the VIN instead.'); return; }
      Promise.all([loadLib(), navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })]).then(function (r) {
        ZX = r[0]; stream = r[1];
        if (done) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        var hints = new Map();
        hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.DATA_MATRIX, ZX.BarcodeFormat.QR_CODE]);
        hints.set(ZX.DecodeHintType.TRY_HARDER, true);
        reader = new ZX.MultiFormatReader(); reader.setHints(hints);
        // plain black (only Close) until the picture is there: then the guide and the hint
        video.addEventListener('playing', function () { el.classList.add('live'); }, { once: true });
        video.srcObject = stream; var pl = video.play(); if (pl && pl.catch) pl.catch(function () { });
        var track = stream.getVideoTracks()[0], caps = track && track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) {
          var tb = el.querySelector('.vs-torch'), on = false; tb.classList.remove('hidden');
          tb.onclick = function () { on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(function () { }); tb.setAttribute('aria-pressed', String(on)); tb.classList.toggle('on', on); };
        }
        frame();
      }).catch(function (e) {
        if (done) return;
        var name = e && e.name;
        LG.warn('car', 'VIN scanner could not start', { error: name || String(e && e.message || e) });
        fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'Gasket needs the camera to read the barcode. Allow it in Android\'s app settings, or type the VIN.' :
          name === 'NotFoundError' || name === 'OverconstrainedError' ? 'No camera found. Type the VIN instead.' : (e && e.message) || 'The camera didn\'t start. Type the VIN instead.');
      });
    });
  }
  var nativeBack = root.onBack;
  root.onBack = function () { if (root.__vinScanClose) { root.__vinScanClose(); return true; } return nativeBack ? nativeBack() : false; };
  root.VinScan = { open: open, icon: CAM };
})(typeof window !== 'undefined' ? window : this);
