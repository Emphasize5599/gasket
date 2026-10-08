/* Gasket — speech bubbles on a map (route labels, price bubbles) that point at their spot without covering each
 * other, the route, the controls, or the panel. Shared by the main map, the trip map and the small route-option maps.
 *
 * Each bubble first tries to sit right beside its spot with a tail (above, below, right, left). If there's no room
 * there it moves out along any of 16 directions — a thin line (at whatever angle) connects it back to the spot. Lines
 * never cross each other or another bubble, and bubbles never sit on a route line (lines may cross a route). Only when
 * no full-size spot exists anywhere does a bubble shrink to its short form, and only then, as a last resort, may it
 * overlap a route. */
(function (root) {
  'use strict';
  var GAP = 9, TAIL = 6, PAD = 3;
  var DIRS = [['top', 0, -1], ['bottom', 0, 1], ['right', 1, 0], ['left', -1, 0]];
  function hits(r, q) { return r.x - PAD < q.x + q.w && q.x < r.x + r.w + PAD && r.y - PAD < q.y + q.h && q.y < r.y + r.h + PAD; }
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
  // ---- geometry ----
  function ccw(ax, ay, bx, by, cx, cy) { return (cy - ay) * (bx - ax) - (by - ay) * (cx - ax); }
  function segX(a, b, c, d) {   // do segments ab and cd cross (touching at an end doesn't count)
    var d1 = ccw(c.x, c.y, d.x, d.y, a.x, a.y), d2 = ccw(c.x, c.y, d.x, d.y, b.x, b.y), d3 = ccw(a.x, a.y, b.x, b.y, c.x, c.y), d4 = ccw(a.x, a.y, b.x, b.y, d.x, d.y);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function inR(p, r, pad) { return p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad; }
  function segRect(a, b, r, pad) {   // does segment ab touch rectangle r (grown by pad)
    if (inR(a, r, pad) || inR(b, r, pad)) return true;
    var x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.w + pad, y1 = r.y + r.h + pad;
    if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1 || Math.max(a.y, b.y) < y0 || Math.min(a.y, b.y) > y1) return false;
    var c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    for (var i = 0; i < 4; i++) if (segX(a, b, c[i], c[(i + 1) % 4])) return true;
    return false;
  }
  /** Route lines on screen as short segments, bucketed in a grid so a box only checks the segments near it. */
  function lineGrid(m, lines, size) {
    var CELL = 40, grid = {}, n = 0;
    (lines || []).forEach(function (ln) {
      if (!ln || !ln.pts || ln.pts.length < 2) return;
      var prev = null;
      for (var i = 0; i < ln.pts.length; i++) {
        var p = m.latLngToContainerPoint(ln.pts[i]);
        if (prev && Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) < 3 && i < ln.pts.length - 1) continue;
        if (prev) {
          var lo = { x: Math.min(p.x, prev.x), y: Math.min(p.y, prev.y) }, hi = { x: Math.max(p.x, prev.x), y: Math.max(p.y, prev.y) };
          if (hi.x >= -50 && hi.y >= -50 && lo.x <= size.x + 50 && lo.y <= size.y + 50) {
            var sg = { a: prev, b: p, id: n++ };
            for (var gx = Math.floor(lo.x / CELL); gx <= Math.floor(hi.x / CELL); gx++)
              for (var gy = Math.floor(lo.y / CELL); gy <= Math.floor(hi.y / CELL); gy++) (grid[gx + ':' + gy] = grid[gx + ':' + gy] || []).push(sg);
          }
        }
        prev = p;
      }
    });
    return {
      /** how many route segments the box touches (stops counting at `stop`) */
      cover: function (r, pad, stop) {
        var seen = {}, k = 0;
        for (var gx = Math.floor((r.x - pad) / CELL); gx <= Math.floor((r.x + r.w + pad) / CELL); gx++)
          for (var gy = Math.floor((r.y - pad) / CELL); gy <= Math.floor((r.y + r.h + pad) / CELL); gy++) {
            var l = grid[gx + ':' + gy]; if (!l) continue;
            for (var i = 0; i < l.length; i++) { var s = l[i]; if (seen[s.id]) continue; seen[s.id] = 1; if (segRect(s.a, s.b, r, pad) && ++k >= stop) return k; }
          }
        return k;
      }
    };
  }
  /** Distance from a box's center to its edge in direction (ux, uy). */
  function reach(w, h, ux, uy) { return Math.min(Math.abs(ux) > 1e-6 ? w / 2 / Math.abs(ux) : 1e9, Math.abs(uy) > 1e-6 ? h / 2 / Math.abs(uy) : 1e9); }
  /**
   *   tips: [{ cands: [LatLng], tip: L.Tooltip, color?, compact?: function (on) }] — in priority order
   *   o: { lines: [{pts}], obst: [{x,y,w,h}], hide: true (no spot -> hidden), leaders: L.LayerGroup, leaderPane,
   *        dists: [px out from the spot], angles: 16, maxCands: 30, routeFree: true (never on a route unless no other way) }
   */
  function place(m, tips, o) {
    o = o || {};
    var size = m.getSize(), obst = (o.obst || []).slice();
    var grid = lineGrid(m, o.lines, size), dists = o.dists || [10, 22, 36, 54, 76, 100, 130], nA = o.angles || 24, ANG = [];
    for (var a = 0; a < nA; a++) { var th = -Math.PI / 2 + a * 2 * Math.PI / nA; ANG.push([Math.cos(th), Math.sin(th)]); }
    if (o.leaders) o.leaders.clearLayers();
    var SEP = o.sep != null ? o.sep : 18;   // bubbles keep this much room from each other when they can
    // each bubble's size, full and short (measured once)
    var items = [];
    tips.forEach(function (t, i) {
      var el = t.tip.getElement && t.tip.getElement(); if (!el) return;
      if (t.compact) t.compact(false);
      var it = { t: t, el: el, i: i, fw: el.offsetWidth, fh: el.offsetHeight };
      if (t.compact) { t.compact(true); it.mw = el.offsetWidth; it.mh = el.offsetHeight; t.compact(false); }
      items.push(it);
    });
    /** What's already on the map, from a list of decisions (minus the ones skipped). */
    var envOf = function (decs, skip) {
      var placed = obst.slice(), lead = [];
      decs.forEach(function (d) {
        if (!d.b || (skip && skip.indexOf(d) >= 0)) return;
        placed.push({ x: d.b.r.x, y: d.b.r.y, w: d.b.r.w, h: d.b.r.h, bub: true });
        if (d.b.end) lead.push({ a: d.b.pt, b: d.b.end, owner: d.it.t });
      });
      return { placed: placed, lead: lead };
    };
    var free = function (env, r, pt, end, owner, soft) {
      var placed = env.placed, lead = env.lead;
      if (r.x < 2 || r.y < 2 || r.x + r.w > size.x - 2 || r.y + r.h > size.y - 2) return -1;
      for (var q = 0; q < placed.length; q++) if (hits(r, placed[q])) return -1;
      for (var k = 0; k < lead.length; k++) if (lead[k].owner !== owner && segRect(lead[k].a, lead[k].b, r, 2)) return -1;
      if (end) {
        for (k = 0; k < lead.length; k++) if (lead[k].owner !== owner && segX(pt, end, lead[k].a, lead[k].b)) return -1;
        for (q = 0; q < placed.length; q++) if (segRect(pt, end, placed[q], 1)) return -1;
      }
      var cv = grid.cover(r, 3, soft ? 1e9 : 1);
      return !soft && cv ? -1 : cv;
    };
    // closer than SEP to another bubble costs a little: they spread out when there's room
    var crowd = function (env, r) {
      var c = 0;
      env.placed.forEach(function (q) {
        if (!q.bub) return;
        var gx = Math.max(q.x - (r.x + r.w), r.x - (q.x + q.w), 0), gy = Math.max(q.y - (r.y + r.h), r.y - (q.y + q.h), 0), g = Math.max(gx, gy);
        if (g < SEP) c += (SEP - g) * 0.12;
      });
      return c;
    };
    var search = function (env, t, w, h, soft) {
      var best = null;
      t.cands.slice(0, o.maxCands || 30).forEach(function (c, ci) {
        var pt = m.latLngToContainerPoint(c);
        if (pt.x < -40 || pt.y < -40 || pt.x > size.x + 40 || pt.y > size.y + 40) return;
        var take = function (score, b) { if (!best || score < best.score) { b.score = score; best = b; } };
        DIRS.forEach(function (d) {   // right beside it, with a tail (Leaflet adds 6 px on the tail side)
          var tg = GAP + TAIL;
          var r = d[0] === 'top' ? { x: pt.x - w / 2, y: pt.y - tg - h } : d[0] === 'bottom' ? { x: pt.x - w / 2, y: pt.y + tg } :
            d[0] === 'right' ? { x: pt.x + tg, y: pt.y - h / 2 } : { x: pt.x - tg - w, y: pt.y - h / 2 };
          r.w = w; r.h = h;
          var cv = free(env, r, null, null, t, soft); if (cv < 0) return;
          take(cv * 10 + ci * 0.6 + (d[2] ? 0 : 0.3) + crowd(env, r), { c: c, pt: pt, r: r, dir: d[0], off: [d[1] * GAP, d[2] * GAP] });
        });
        if (best && !best.end && best.score < 0.5 && ci === 0) return;   // a clean, roomy tail spot can't be beaten
        dists.forEach(function (dist) {   // farther out, at any angle, joined by a line
          ANG.forEach(function (u) {
            var rr = reach(w, h, u[0], u[1]), cx = pt.x + u[0] * (dist + rr), cy = pt.y + u[1] * (dist + rr);
            var r = { x: cx - w / 2, y: cy - h / 2, w: w, h: h }, end = { x: pt.x + u[0] * (dist + 1), y: pt.y + u[1] * (dist + 1) };
            var cv = free(env, r, pt, end, t, soft); if (cv < 0) return;
            take(cv * 10 + ci * 0.6 + 1.2 + dist * 0.035 + crowd(env, r), { c: c, pt: pt, r: r, dir: 'center', off: [cx - pt.x, cy - pt.y], end: end });
          });
        });
      });
      return best;
    };
    var choose = function (env, it) {
      var t = it.t, b = search(env, t, it.fw, it.fh, false);
      if (b) return { it: it, b: b, kind: 'full' };
      if (t.compact && (b = search(env, t, it.mw, it.mh, false))) return { it: it, b: b, kind: 'mini' };   // only when nothing full-size fits
      if (o.routeFree !== false) {
        if ((b = search(env, t, it.fw, it.fh, true))) return { it: it, b: b, kind: 'full', soft: true };          // last resort: over a route
        if (t.compact && (b = search(env, t, it.mw, it.mh, true))) return { it: it, b: b, kind: 'mini', soft: true };
      }
      return { it: it, hide: true };
    };
    var quality = function (decs) {
      var q = 0; decs.forEach(function (d) { q += d.hide ? 5000 : (d.soft ? 3000 : 0) + (d.kind === 'mini' ? 1000 : 0) + d.b.score; }); return q;
    };
    var run = function (order) {
      var decs = [];
      order.forEach(function (it) { decs.push(choose(envOf(decs), it)); });
      return decs;
    };
    // a few passes: whoever had to shrink (or had no room) goes first next time; the best pass wins
    var order = items.slice(), best = null;
    for (var pass = 0; pass < (o.passes || 4); pass++) {
      var decs = run(order), q = quality(decs);
      if (!best || q < best.q) best = { decs: decs, q: q };
      var stuck = decs.filter(function (d) { return d.hide || d.soft || d.kind === 'mini'; }).map(function (d) { return d.it; });
      if (!stuck.length) break;
      order = stuck.concat(order.filter(function (x) { return stuck.indexOf(x) < 0; }));
    }
    // then make room: a bubble that had to shrink tries again at full size while one neighbor at a time moves aside
    if (best && o.repair !== false) {
      var D = best.decs;
      D.forEach(function (d) {
        if (!(d.hide || d.soft || d.kind === 'mini')) return;
        var p0 = m.latLngToContainerPoint(d.it.t.cands[0]);
        var near = D.filter(function (n) { return n !== d && n.b; }).sort(function (x, y) { return x.b.pt.distanceTo(p0) - y.b.pt.distanceTo(p0); }).slice(0, 6);
        for (var k = 0; k < near.length; k++) {
          var n = near[k];
          var bd = search(envOf(D, [d, n]), d.it.t, d.it.fw, d.it.fh, false); if (!bd) continue;
          var trial = { it: d.it, b: bd, kind: 'full' }, D2 = D.map(function (x) { return x === d ? trial : x; });
          var env2 = envOf(D2, [n]);
          var bn = search(env2, n.it.t, n.it.fw, n.it.fh, false), kn = 'full';
          if (!bn && n.kind === 'mini') { bn = search(env2, n.it.t, n.it.mw, n.it.mh, false); kn = 'mini'; }
          if (!bn) continue;
          d.b = bd; d.kind = 'full'; d.soft = false; d.hide = false; n.b = bn; n.kind = kn;
          break;
        }
      });
    }
    (best ? best.decs : []).forEach(function (x) {
      var t = x.it.t, el = x.it.el;
      if (x.hide && o.hide !== false) { el.style.visibility = 'hidden'; t.shown = false; return; }
      var b = x.b || { c: t.cands[0], dir: 'top', off: [0, -GAP] };
      if (t.compact) t.compact(x.kind === 'mini');
      el.style.visibility = ''; t.shown = true;
      t.tip.options.direction = b.dir; t.tip.options.offset = L.point(Math.round(b.off[0]), Math.round(b.off[1]));
      t.tip.setLatLng(b.c);
      if (b.end && o.leaders) L.polyline([b.c, m.containerPointToLatLng(L.point(b.end.x, b.end.y))],
        { color: t.color || '#18a957', weight: 2.5, opacity: 0.95, interactive: false, pane: o.leaderPane || 'overlayPane' }).addTo(o.leaders);
    });
  }
  root.Labels = { place: place, rectsOf: rectsOf, GAP: GAP, _segRect: segRect, _segX: segX };
})(this);
