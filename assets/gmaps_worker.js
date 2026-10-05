// Runs inside the app's hidden Google Maps page after it opens your shared directions link.
// Phone share links name each stop loosely ("100 Main St") and identify it with Google's internal place ID;
// Google Maps turns those into full addresses and exact coordinates in its own address bar, and lists the route
// options ("via I-57 and S Main St", miles, minutes) in the same order as the route number in the link (!5i).
// We wait for that, then hand back the rewritten link plus the route options. Data only; nothing is clicked.
async function (reqId, args) {
  const send = (o) => FuelPlusSite.result(reqId, JSON.stringify(o));
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
  // its turn-by-turn points in order. Hand back up to ~300 of them per route so the app can ask Google's Routes API for
  // exactly that route (pass-through points), instead of guessing.
  async function paths() {
    try {
      const e = performance.getEntriesByType('resource').filter((x) => /\/maps\/preview\/directions\?/.test(x.name)).pop();
      if (!e) return [];
      const t = await (await fetch(e.name, { credentials: 'include', cache: 'force-cache' })).text();
      const d = JSON.parse(t.slice(t.indexOf('\n') + 1));
      const list = (d && d[0] && d[0][1]) || [];
      return list.map((r) => {
        const head = r[0] || [], pts = [];
        (function walk(x) {
          if (!Array.isArray(x)) return;
          if (x.length === 4 && x[0] === null && x[1] === null && typeof x[2] === 'number' && typeof x[3] === 'number') { pts.push([x[2], x[3]]); return; }
          x.forEach(walk);
        })(r[1]);
        const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
        const L = cum[cum.length - 1] || 1, thin = [];
        for (let k = 0, j = 0; k <= 300; k++) { const want = L * k / 300; while (j < pts.length - 1 && cum[j] < want) j++; const p = pts[j]; if (p && (!thin.length || thin[thin.length - 1] !== p)) thin.push(p); }
        return { via: String(head[1] || ''), miles: head[2] ? head[2][0] / 1609.344 : null, minutes: head[3] ? head[3][0] / 60 : null,
          pts: thin.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]) };
      }).filter((x) => x.pts.length > 5);
    } catch (e) { return []; }
  }
  /** DOM list (Maps' order and names as shown) + the points from the data, matched by length. */
  async function withPaths(r) {
    const ps = await paths();
    if (!r.length) return ps;
    r.forEach((x) => {
      let best = null; ps.forEach((p) => { const dd = Math.abs(p.miles - x.miles); if (dd < x.miles * 0.01 && (!best || dd < Math.abs(best.miles - x.miles))) best = p; });
      if (best) { x.pts = best.pts; if (!x.minutes) x.minutes = best.minutes; }
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
