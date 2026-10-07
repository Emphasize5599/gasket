/* Fuel+ Map — speech bubbles on a map (route labels, price bubbles) that point at their spot without covering each
 * other, the controls, or the panel. Shared by the main map, the trip map and the small route-option maps. */
(function (root) {
  'use strict';
  var GAP = 9;
  var DIRS = [['top', 0, -1], ['bottom', 0, 1], ['right', 1, 0], ['left', -1, 0]];
  // 3 px of air between bubbles (Leaflet rounds positions, and the tails need a little room)
  function hits(r, q) { return r.x - 3 < q.x + q.w && q.x < r.x + r.w + 3 && r.y - 3 < q.y + q.h && q.y < r.y + r.h + 3; }
  /** The on-screen box of each visible element (container coordinates of map m), padded a little. */
  function rectsOf(m, els, pad) {
    var cr = m.getContainer().getBoundingClientRect(), out = [];
    (els || []).forEach(function (e) {
      if (!e || e.classList && e.classList.contains('hidden')) return;
      var r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
      out.push({ x: r.left - cr.left - (pad || 0), y: r.top - cr.top - (pad || 0), w: r.width + 2 * (pad || 0), h: r.height + 2 * (pad || 0) });
    });
    return out;
  }
  /**
   * Place each bubble (in the order given: the first ones get the best spots) beside one of its candidate points:
   * above, below, right or left, a little farther out when it's crowded (then a thin line connects it), never over
   * another bubble or an obstacle, covering as little of the route lines as it can.
   *   tips: [{ cands: [LatLng], tip: L.Tooltip, color?, compact?: function (on) }]
   *   o: { lines: [{pts: [[lat,lng]|LatLng]}], obst: [{x,y,w,h}], rings: [0, 20, 42], hide: true (no spot -> hidden),
   *        leaders: L.LayerGroup (for the connecting lines), maxCands: 30 }
   */
  function place(m, tips, o) {
    o = o || {};
    var size = m.getSize(), placed = (o.obst || []).slice(), pts = [], rings = o.rings || [0];
    (o.lines || []).forEach(function (ln) {
      if (!ln || !ln.pts) return;
      var st = Math.max(1, Math.floor(ln.pts.length / 500));
      for (var i = 0; i < ln.pts.length; i += st) pts.push(m.latLngToContainerPoint(ln.pts[i]));
    });
    if (o.leaders) o.leaders.clearLayers();
    var tryPlace = function (t, el) {
      var w = el.offsetWidth, h = el.offsetHeight, best = null;
      t.cands.slice(0, o.maxCands || 30).forEach(function (c, ci) {
        var pt = m.latLngToContainerPoint(c);
        if (pt.x < -40 || pt.y < -40 || pt.x > size.x + 40 || pt.y > size.y + 40) return;
        rings.forEach(function (ring, ri) {
          var g = GAP + ring, tg = g + 6;   // Leaflet adds a 6 px margin on the tail side
          DIRS.forEach(function (d) {
            var r = d[0] === 'top' ? { x: pt.x - w / 2, y: pt.y - tg - h } : d[0] === 'bottom' ? { x: pt.x - w / 2, y: pt.y + tg } :
              d[0] === 'right' ? { x: pt.x + tg, y: pt.y - h / 2 } : { x: pt.x - tg - w, y: pt.y - h / 2 };
            r.w = w; r.h = h;
            if (r.x < 2 || r.y < 2 || r.x + w > size.x - 2 || r.y + h > size.y - 2) return;
            for (var q = 0; q < placed.length; q++) if (hits(r, placed[q])) return;
            var cover = 0;
            for (var i = 0; i < pts.length; i++) { var p = pts[i]; if (p.x > r.x - 4 && p.x < r.x + w + 4 && p.y > r.y - 4 && p.y < r.y + h + 4) cover++; }
            var score = cover * 10 + ci * 0.6 + (d[2] ? 0 : 0.3) + ri * 6;
            if (!best || score < best.score) best = { score: score, c: c, d: d, g: g, r: r, pt: pt };
          });
        });
      });
      return best;
    };
    tips.forEach(function (t) {
      var el = t.tip.getElement && t.tip.getElement(); if (!el) return;
      if (t.compact) t.compact(false);
      var best = tryPlace(t, el);
      if (!best && t.compact) { t.compact(true); best = tryPlace(t, el); }   // crowded: just the number
      if (!best && o.hide !== false) { el.style.visibility = 'hidden'; t.shown = false; return; }
      el.style.visibility = ''; t.shown = true;
      if (!best) best = { c: t.cands[0], d: DIRS[0], g: GAP, r: { x: -99, y: -99, w: 0, h: 0 } };
      t.tip.options.direction = best.d[0]; t.tip.options.offset = L.point(best.d[1] * best.g, best.d[2] * best.g);
      t.tip.setLatLng(best.c); placed.push(best.r);
      if (o.leaders && best.g > GAP + 1 && best.pt) {
        var end = L.point(best.pt.x + best.d[1] * (best.g + 1), best.pt.y + best.d[2] * (best.g + 1));
        L.polyline([best.c, m.containerPointToLatLng(end)], { color: t.color || '#18a957', weight: 2.5, opacity: 0.95, interactive: false, pane: o.leaderPane || 'overlayPane' }).addTo(o.leaders);
      }
    });
  }
  root.Labels = { place: place, rectsOf: rectsOf, GAP: GAP };
})(this);
