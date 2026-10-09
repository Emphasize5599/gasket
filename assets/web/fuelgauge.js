/* Gasket — how much is in the tank (trip step Parameters). Three ways to say it: a fuel gauge like the one on the dash
 * (drag the needle; it snaps to eighths), a percentage, or the miles left from the dash. Electric cars: percent or miles.
 * Each way nudges toward a slightly low guess: a stop planned a little early is cheap, running dry is not.
 * FuelGauge.math is pure (and tested in Node); render() draws the card and reports changes. */
(function (root) {
  var A0 = 200, SWEEP = 140, CX = 150, CY = 156, R = 118;   // the gauge's arc: E at 200°, F at 340° (SVG angles, y down)
  var FR = ['E', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞', 'F'];

  var math = {
    /** The fuel choice, filled in: {mode: 'gauge' | 'pct' | 'miles', eighths, pct, miles}. */
    norm: function (f, kind, milesLeft) {
      f = Object.assign({}, f || {});
      if (!f.mode) f.mode = milesLeft !== '' && milesLeft != null ? 'miles' : kind === 'ev' ? 'pct' : 'gauge';
      if (f.mode === 'miles' && (f.miles == null || f.miles === '') && milesLeft !== '' && milesLeft != null) f.miles = String(milesLeft);
      if (kind === 'ev' && f.mode === 'gauge') f.mode = 'pct';
      return f;
    },
    /** Share of a full tank, 0..1, or null when nothing is set yet (miles: from the mileage and tank size). */
    frac: function (f, tank, mpu) {
      if (!f) return null;
      if (f.mode === 'gauge') return f.eighths == null || f.eighths === '' ? null : Math.max(0, Math.min(8, +f.eighths)) / 8;
      if (f.mode === 'pct') { var p = parseFloat(f.pct); return isFinite(p) && f.pct !== '' ? Math.max(0, Math.min(100, p)) / 100 : null; }
      var m = parseFloat(f.miles); return isFinite(m) && f.miles !== '' && tank > 0 && mpu > 0 ? Math.max(0, m) / (tank * mpu) : null;
    },
    /** Miles the fuel lasts at the given mileage (miles per gallon / kWh / kg), or null when not set. */
    miles: function (f, tank, mpu) {
      if (!f) return null;
      if (f.mode === 'miles') { var m = parseFloat(f.miles); return isFinite(m) && f.miles !== '' ? Math.max(0, m) : null; }
      var fr = math.frac(f, tank, mpu); return fr == null || !(tank > 0 && mpu > 0) ? null : fr * tank * mpu;
    },
    /** Fuel in the tank (gallons / kWh / kg), or null. */
    amount: function (f, tank, mpu) {
      if (!f) return null;
      if (f.mode === 'miles') { var m = math.miles(f, tank, mpu); return m == null || !(mpu > 0) ? null : m / mpu; }
      var fr = math.frac(f, tank, mpu); return fr == null || !(tank > 0) ? null : fr * tank;
    },
    /** A pointer at SVG angle a (degrees, y down) -> eighths on the gauge, snapped and clamped to E..F. */
    eighthsAt: function (a) {
      a = ((a % 360) + 360) % 360;
      if (a < A0 && a > 90) a = A0;           // below the dial on the left: E
      else if (a <= 90) a = A0 + SWEEP;       // below on the right: F
      return Math.max(0, Math.min(8, Math.round((a - A0) / SWEEP * 8)));
    },
    label: function (e) { return e === 0 ? 'Empty' : e === 8 ? 'Full' : FR[e] + ' tank'; }
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pt(a, r) { var t = a * Math.PI / 180; return [CX + r * Math.cos(t), CY + r * Math.sin(t)]; }
  function arc(a1, a2, r) { var p = pt(a1, r), q = pt(a2, r); return 'M' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + 'A' + r + ' ' + r + ' 0 0 1 ' + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }

  /** The dial: a band with eighth marks, E ¼ ½ ¾ F, a red reserve zone, the needle and a low-fuel light. */
  function gaugeSvg(e) {
    var s = '<svg class="fg-svg" viewBox="0 0 300 186" role="slider" tabindex="0" aria-label="Fuel gauge: drag the needle to where yours is" aria-valuemin="0" aria-valuemax="8"' +
      (e == null ? ' aria-valuetext="not set"' : ' aria-valuenow="' + e + '" aria-valuetext="' + math.label(e) + '"') + '>';
    s += '<path class="fg-band" d="' + arc(A0, A0 + SWEEP, R) + '"/>';
    s += '<path class="fg-res" d="' + arc(A0, A0 + SWEEP / 8, R) + '"/>';
    for (var i = 0; i <= 16; i++) {
      var a = A0 + SWEEP * i / 16, major = i % 4 === 0, mid = i % 2 === 0, p = pt(a, R - 15), q = pt(a, R + (major ? 15 : mid ? 9 : 5));
      s += '<line class="fg-tick' + (major ? ' maj' : mid ? '' : ' min') + '" x1="' + p[0].toFixed(1) + '" y1="' + p[1].toFixed(1) + '" x2="' + q[0].toFixed(1) + '" y2="' + q[1].toFixed(1) + '"/>';
    }
    [[0, 'E'], [2, '¼'], [4, '½'], [6, '¾'], [8, 'F']].forEach(function (l) {
      var p = pt(A0 + SWEEP * l[0] / 8, R - 34);
      s += '<text class="fg-lbl' + (l[0] % 4 ? ' sm' : '') + '" x="' + p[0].toFixed(1) + '" y="' + (p[1] + 7).toFixed(1) + '" data-e="' + l[0] + '">' + l[1] + '</text>';
    });
    // the pump: a low-fuel light when there's an eighth or less
    s += '<g class="fg-pump' + (e != null && e <= 1 ? ' lit' : '') + '" transform="translate(137 94)"><path class="fg-pb" fill-rule="evenodd" d="M3 1h9a2 2 0 0 1 2 2v19H1V3a2 2 0 0 1 2-2zm1 3v6h7V4z"/>' +
      '<path class="fg-ph" d="M14 10h2a1.5 1.5 0 0 1 1.5 1.5v6.5a1.6 1.6 0 0 0 3.2 0V8l-3.2-3.5"/></g>';
    var deg = (e == null ? A0 - 6 : A0 + SWEEP * e / 8) - 270;
    s += '<g class="fg-needle' + (e == null ? ' unset' : '') + '" style="transform: rotate(' + deg.toFixed(1) + 'deg)"><path d="M' + (CX - 4.5) + ' ' + CY + 'L' + (CX - 1) + ' ' + (CY - R + 8) + 'L' + (CX + 1) + ' ' + (CY - R + 8) + 'L' + (CX + 4.5) + ' ' + CY + 'Z"/></g>';
    s += '<circle class="fg-cap" cx="' + CX + '" cy="' + CY + '" r="11"/><circle class="fg-cap2" cx="' + CX + '" cy="' + CY + '" r="4"/>';
    return s + '</svg>';
  }

  /** opts: { kind, tank, mpu (miles per unit), unit ('gal' | 'kWh' | 'kg'), fuel, onChange(fuel) }. */
  function render(host, o) {
    var f = o.fuel, ev = o.kind === 'ev';
    function fmt(v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
    function readout() {
      var fr = math.frac(f, o.tank, o.mpu), mi = math.miles(f, o.tank, o.mpu), amt = math.amount(f, o.tank, o.mpu);
      if (fr == null) return f.mode === 'gauge' ? 'Drag the needle to where yours is.' : f.mode === 'pct' ? 'How full is it?' : 'What does your dash say?';
      var bits = [];
      if (f.mode === 'gauge') bits.push('<b>' + math.label(+f.eighths) + '</b>');
      if (f.mode !== 'pct') bits.push(Math.round(fr * 100) + '%'); else bits.push('<b>' + Math.round(fr * 100) + '%</b>');
      if (amt != null) bits.push('about ' + fmt(amt, amt < 10 ? 1 : 0) + ' ' + o.unit);
      if (mi != null && f.mode !== 'miles') bits.push('about ' + Math.round(mi) + ' mi');
      var over = fr > 1.05 ? '<div class="fg-warn">That\'s more than a full ' + (ev ? 'charge' : 'tank') + ' at your mileage (' + Math.round(o.tank * o.mpu) + ' mi). Check your mileage and ' + (ev ? 'battery' : 'tank') + ' size in the Garage.</div>' : '';
      return bits.join(' · ') + over;
    }
    var tip = {
      gauge: 'Between two marks? Pick the lower one. Gauges aren\'t exact, and a stop planned a little early costs almost nothing.',
      pct: 'Round down a little. A few percent low is the safe guess.',
      miles: 'Use a little less than your dash shows. Its estimate follows your recent driving, and highway speeds use more.'
    };
    function draw() {
      var modes = ev ? [['pct', 'Percent'], ['miles', 'Miles left']] : [['gauge', 'Gauge'], ['pct', 'Percent'], ['miles', 'Miles left']];
      var h = '<div class="seg2 fg-modes" id="tFuelMode">' + modes.map(function (m) { return '<button type="button" data-fm="' + m[0] + '" class="' + (f.mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>';
      if (f.mode === 'gauge') h += '<div class="fg-wrap" id="tGauge">' + gaugeSvg(f.eighths == null || f.eighths === '' ? null : +f.eighths) + '</div>';
      else if (f.mode === 'pct') h += '<label class="nf fg-in"><span>' + (ev ? 'Battery' : 'Tank') + ' (%)<span class="req" aria-label="required">*</span><small>' + (ev ? 'as your car shows it' : 'if your car shows a percentage') + '</small></span><input type="number" inputmode="decimal" id="tFuelPct" min="0" max="100" step="1" value="' + esc(f.pct) + '"></label>';
      else h += '<label class="nf fg-in"><span>' + (ev ? 'Miles of range left' : 'Miles left in tank') + '<span class="req" aria-label="required">*</span><small>from your dash</small></span><input type="number" inputmode="decimal" id="tMiles" step="1" value="' + esc(f.miles) + '"></label>';
      h += '<div class="fg-read" id="tFuelRead" aria-live="polite">' + readout() + '</div><p class="fg-tip">' + tip[f.mode] + '</p>';
      host.innerHTML = h;
      bind();
    }
    function changed(redraw) {
      Array.prototype.forEach.call(host.querySelectorAll('.need'), function (x) { x.classList.remove('need'); });   // answered: drop the "missing" outline
      o.onChange(f); if (redraw) draw(); else { var r = host.querySelector('#tFuelRead'); if (r) r.innerHTML = readout(); } }
    function setE(e) {
      if (String(f.eighths) === String(e)) return;
      f.eighths = e;
      var svg = host.querySelector('.fg-svg'), nd = svg && svg.querySelector('.fg-needle');
      if (nd) {   // move the needle (CSS animates it) instead of redrawing, so it swings
        nd.classList.remove('unset'); nd.style.transform = 'rotate(' + (A0 + SWEEP * e / 8 - 270).toFixed(1) + 'deg)';
        svg.setAttribute('aria-valuenow', e); svg.setAttribute('aria-valuetext', math.label(e));
        svg.querySelector('.fg-pump').classList.toggle('lit', e <= 1);
      }
      changed(false);
    }
    function bind() {
      host.querySelector('#tFuelMode').onclick = function (ev2) {
        var b = ev2.target.closest('button'); if (!b || b.dataset.fm === f.mode) return;
        f.mode = b.dataset.fm; changed(true);
        var i = host.querySelector('#tFuelPct, #tMiles'); if (i && !i.value) i.focus();
      };
      var pIn = host.querySelector('#tFuelPct'); if (pIn) pIn.oninput = function () { f.pct = pIn.value; changed(false); };
      var mIn = host.querySelector('#tMiles'); if (mIn) mIn.oninput = function () { f.miles = mIn.value; changed(false); };
      var svg = host.querySelector('.fg-svg'); if (!svg) return;
      var dragging = false;
      function at(e2) {
        var m = svg.getScreenCTM(); if (!m) return null;
        var p = svg.createSVGPoint(); p.x = e2.clientX; p.y = e2.clientY; p = p.matrixTransform(m.inverse());
        return math.eighthsAt(Math.atan2(p.y - CY, p.x - CX) * 180 / Math.PI);
      }
      svg.addEventListener('pointerdown', function (e2) { dragging = true; try { svg.setPointerCapture(e2.pointerId); } catch (x) { } var v = at(e2); if (v != null) setE(v); e2.preventDefault(); });
      svg.addEventListener('pointermove', function (e2) { if (!dragging) return; var v = at(e2); if (v != null) setE(v); });
      svg.addEventListener('pointerup', function () { dragging = false; });
      svg.addEventListener('pointercancel', function () { dragging = false; });
      svg.addEventListener('keydown', function (e2) {
        var cur = f.eighths == null || f.eighths === '' ? -1 : +f.eighths, k = e2.key, v = null;
        if (k === 'ArrowRight' || k === 'ArrowUp') v = Math.min(8, cur + 1);
        else if (k === 'ArrowLeft' || k === 'ArrowDown') v = Math.max(0, cur < 0 ? 0 : cur - 1);
        else if (k === 'Home') v = 0; else if (k === 'End') v = 8;
        if (v != null) { setE(v); e2.preventDefault(); }
      });
    }
    draw();
  }

  root.FuelGauge = { math: math, render: render };
  if (typeof module !== 'undefined') module.exports = root.FuelGauge;
})(typeof window !== 'undefined' ? window : globalThis);
