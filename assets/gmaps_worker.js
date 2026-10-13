// Runs inside the app's hidden Google Maps page after it opens your shared directions link.
// Phone share links name each stop loosely ("100 Main St") and identify it with Google's internal place ID;
// Google Maps turns those into full addresses and exact coordinates in its own address bar, and lists the route
// options ("via I-57 and S Main St", miles, minutes) in the same order as the route number in the link (!5i).
// We wait for that, then hand back the rewritten link plus the route options. Data only; nothing is clicked.
async function (reqId, args) {
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const count = (s, re) => (s.match(re) || []).length;
  function routes() {
    const out = [];
    const leaves = [...document.querySelectorAll('h1, div, span')].filter((e) => e.children.length === 0 && /^via /.test(e.textContent.trim()));
    leaves.forEach((e) => {
      let p = e;
      for (let k = 0; k < 6 && p && !/\d+(\.\d+)?\s*(mi|miles|km)\b/.test(p.innerText || ''); k++) p = p.parentElement;
      const t = (p ? p.innerText : '').replace(/(\d),(?=\d{3}\b)/g, '$1');      // "1,324 miles" -> "1324 miles"
      const mi = /(\d+(?:\.\d+)?)\s*(?:mi|miles)\b/.exec(t);
      const km = /(\d+(?:\.\d+)?)\s*km\b/.exec(t);
      const h = /(\d+)\s*hr/.exec(t), m = /(\d+)\s*min/.exec(t);
      out.push({ via: e.textContent.trim().replace(/^via\s+/i, ''), miles: mi ? +mi[1] : km ? +km[1] * 0.621371 : null,
        minutes: (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) || null });
    });
    return out;
  }
  const hav = (a, b) => { const R = 3958.8, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dg = (b[1] - a[1]) * r;
    const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  // The page's own directions answer (already downloaded, so read from the browser cache) has every route option with
  // its turn-by-turn points in order. Hand back up to ~2,000 of them per route so the app can ask Google's Routes API for
  // exactly that route (pass-through points), instead of guessing.
  async function paths() {
    try {
      const e = performance.getEntriesByType('resource').filter((x) => /\/maps\/preview\/directions\?/.test(x.name)).pop();
      if (!e) return [];
      const t = await (await fetch(e.name, { credentials: 'include', cache: 'force-cache' })).text();
      const d = JSON.parse(t.slice(t.indexOf('\n') + 1));
      const list = (d && d[0] && d[0][1]) || [], lines = (d && d[0] && d[0][7]) || [];
      return list.map((r, idx) => {
        const head = r[0] || [];
        let pts = line(lines[idx], head);
        if (!pts) {         // no full line: the steps' own points (a few per turn)
          pts = [];
          (function walk(x) {
            if (!Array.isArray(x)) return;
            if (x.length === 4 && x[0] === null && x[1] === null && typeof x[2] === 'number' && typeof x[3] === 'number') { pts.push([x[2], x[3]]); return; }
            x.forEach(walk);
          })(r[1]);
        }
        const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
        const L = cum[cum.length - 1] || 1;
        let thin = [];
        if (pts.length > 2000 || pts.full) thin = pts;     // the full line, already simplified
        else for (let k = 0, j = 0; k <= 2000; k++) { const want = L * k / 2000; while (j < pts.length - 1 && cum[j] < want) j++; const p = pts[j]; if (p && (!thin.length || thin[thin.length - 1] !== p)) thin.push(p); }
        return { via: String(head[1] || ''), miles: head[2] ? head[2][0] / 1609.344 : null, minutes: head[3] ? head[3][0] / 60 : null,
          pts: thin.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]), steps: steps(r, head) };
      }).filter((x) => x.pts.length > 5);
    } catch (e) { return []; }
  }
  /** The route's whole line, as the page draws it: [lat × 1e7 steps, lng × 1e7 steps, …] added up point by point. Kept
   *  only when it's as long as the route, then simplified to about 10 m (a turn's shape stays, straight road thins out
   *  to a point every quarter mile), at most 25,000 points. */
  function line(g, head) {
    try {
      if (!g || !Array.isArray(g[0]) || !Array.isArray(g[1]) || g[0].length !== g[1].length || g[0].length < 10) return null;
      let la = 0, ln = 0; const pts = g[0].map((v, k) => { la += v; ln += g[1][k]; return [la / 1e7, ln / 1e7]; });
      let L = 0; for (let k = 1; k < pts.length; k++) L += hav(pts[k - 1], pts[k]);
      const want = head[2] && head[2][0] / 1609.344;
      if (!want || Math.abs(L - want) > want * 0.03) return null;
      let tol = 0.0001, out = simplify(pts, tol);
      while (out.length > 25000) { tol *= 2; out = simplify(pts, tol); }
      out = out.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]); out.full = true;
      return out;
    } catch (e) { return null; }
  }
  /** Douglas–Peucker in degrees (longitude scaled by the latitude), without recursion. */
  function simplify(pts, tol) {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const kx = Math.cos(pts[0][0] * Math.PI / 180), stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let far = -1, fd = 0;
      const ax = pts[a][1] * kx, ay = pts[a][0], dx = pts[b][1] * kx - ax, dy = pts[b][0] - ay, L2 = dx * dx + dy * dy || 1e-18;
      for (let i = a + 1; i < b; i++) {
        const px = pts[i][1] * kx - ax, py = pts[i][0] - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
        const ex = px - t * dx, ey = py - t * dy, dd = ex * ex + ey * ey;
        if (dd > fd) { fd = dd; far = i; }
      }
      if (far > 0 && fd > tol * tol) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    // and a point at least every quarter mile, so short stretches of a straight road still have points of their own
    const out = []; let since = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i) since += hav(pts[i - 1], pts[i]);
      if (keep[i] || since >= 0.25) { out.push(pts[i]); since = 0; }
    }
    return out;
  }
  /** The route's turn-by-turn steps as Maps lists them: [meters, seconds, "Take exit 143A to merge onto I-40 W…"] (the
   *  distance is what you drive after that instruction). Only when they add up to the whole route: Maps sometimes
   *  sends just the first few steps of an alternative. */
  function steps(r, head) {
    try {
      const out = [];
      ((r[1] && r[1][0] && r[1][0][1]) || []).forEach((g) => (g[1] || []).forEach((x) => {
        const s = x && x[0]; if (!s || !s[2] || typeof s[2][0] !== 'number') return;
        const text = (s[14] || []).map((p) => (p && p[1] && typeof p[1][0] === 'string' ? p[1][0] : '')).join('').trim();
        out.push([s[2][0], s[3] && typeof s[3][0] === 'number' ? s[3][0] : 0, text]);
      }));
      const m = out.reduce((a, s) => a + s[0], 0), total = head[2] && head[2][0];
      return total && out.length && Math.abs(m - total) <= total * 0.02 ? out : null;
    } catch (e) { return null; }
  }
  /** DOM list (Maps' order and names as shown) + the points from the data, matched by length. */
  async function withPaths(r) {
    const ps = await paths();
    if (!r.length) return ps;
    r.forEach((x) => {
      let best = null; ps.forEach((p) => { const dd = Math.abs(p.miles - x.miles); if (dd < x.miles * 0.01 && (!best || dd < Math.abs(best.miles - x.miles))) best = p; });
      if (best) { x.pts = best.pts; x.steps = best.steps; if (!x.minutes) x.minutes = best.minutes; }
    });
    return r;
  }
  try {
    let last = '', stable = 0;
    for (let i = 0; i < 40; i++) {                    // up to ~20 s
      const href = location.href;
      const places = count(href, /!1s0x[0-9a-f]+:0x[0-9a-f]+/g);
      const coords = count(href, /!2m2!1d-?\d/g);
      const r = routes();
      const coordsNow = coords + count(href, /!8m2!3d-?\d/g);
      // done when every stop has coordinates, or when Maps has settled (some places never get them in the address)
      stable = href === last ? stable + 1 : 0;
      const settled = stable >= 3 && i > 6;
      // the route list can take several seconds after the address bar settles (long trips especially): wait for it
      const done = /\/maps\/dir\//.test(href) && (coordsNow >= places || settled) && (r.length > 0 || i > 36);
      if (done && (stable >= 1 || settled)) { if (r.length) await pause(800); return send({ href, title: document.title, routes: await withPaths(r.length ? routes() : r) }); }
      last = href;
      await pause(500);
    }
    send({ href: location.href, title: document.title, routes: await withPaths(routes()), partial: true });
  } catch (e) {
    send({ error: String(e && e.message || e) });
  }
}
