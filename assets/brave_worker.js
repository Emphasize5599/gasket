async function (reqId, args) {
  // Reads a car's fuel tank size from Brave Search's AI answer for "<car> fuel tank capacity in gallons?", in the hidden
  // window (args.bg) or on the page shown to the user. It only reads the page's text: if Brave shows a check (a CAPTCHA,
  // "unusual traffic"), the hidden read says {blocked: true} and stops; the user can open the page and do it themselves.
  // Reports back through GasketSite.result(reqId, json): {gal, text} or {blocked} or {error}.
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ');
  const refused = (t) => /captcha|unusual traffic|are you a robot|verify you are (a )?human|too many requests/i.test(t + ' ' + document.title);
  // "11.3 gallons", "11.3-gallon", "about 11.3 gal" (a tank between 4 and 45 gallons; trucks with two tanks are rare)
  const GAL = /(\d{1,2}(?:\.\d{1,2})?)\s*(?:-|\s)?\s*(?:us\s+)?gal(?:lon)?s?\b/gi;
  const find = (t) => {
    // the AI answer sits at the top of the results: read from the question onward, nearest to "tank" first
    const at = Math.max(0, t.search(/fuel tank capacity in gallons/i));
    const s = t.slice(at, at + 6000);
    let m, best = null;
    GAL.lastIndex = 0;
    while ((m = GAL.exec(s))) {
      const v = parseFloat(m[1]);
      if (!(v >= 4 && v <= 45)) continue;
      const near = s.slice(Math.max(0, m.index - 160), m.index + m[0].length + 60);
      if (!/tank|capacity|fuel/i.test(near)) continue;
      best = { gal: v, text: near.trim() };
      break;
    }
    return best;
  };
  const t0 = Date.now();
  let last = '', same = 0;
  while (Date.now() - t0 < (args && args.bg ? 30000 : 120000)) {
    const t = text();
    if (refused(t)) {
      if (args && args.bg) { send({ blocked: true }); return; }
    } else {
      const f = find(t);
      // the answer streams in: take it once the page has stopped changing for a moment
      if (f) { same = t === last ? same + 1 : 0; if (same >= 3 || Date.now() - t0 > 12000) { send(f); return; } }
    }
    last = t;
    await sleep(400);
  }
  send({ error: 'Brave Search didn\'t give a tank size.' + (args && args.bg ? ' [' + document.title + ' | ' + text().slice(0, 300) + ']' : '') });
}
