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
      const t = p ? p.innerText : '';
      const mi = /(\d+(?:\.\d+)?)\s*(?:mi|miles)\b/.exec(t);
      const km = /(\d+(?:\.\d+)?)\s*km\b/.exec(t);
      const h = /(\d+)\s*hr/.exec(t), m = /(\d+)\s*min/.exec(t);
      out.push({ via: e.textContent.trim().replace(/^via\s+/i, ''), miles: mi ? +mi[1] : km ? +km[1] * 0.621371 : null,
        minutes: (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) || null });
    });
    return out;
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
      const done = /\/maps\/dir\//.test(href) && (coordsNow >= places || settled) && (r.length > 0 || i > 12 || settled);
      if (done && (stable >= 1 || settled)) return send({ href, title: document.title, routes: r });
      last = href;
      await pause(500);
    }
    send({ href: location.href, title: document.title, routes: routes(), partial: true });
  } catch (e) {
    send({ error: String(e && e.message || e) });
  }
}
