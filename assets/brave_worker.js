async function (reqId, args) {
  // Reads a car's fuel tank size from Brave Search's AI answer for "<car> fuel tank capacity in gallons?", in the hidden
  // window (args.bg) or on the page shown to the user. It only reads the page's text: if Brave shows a check (a CAPTCHA,
  // "unusual traffic"), the hidden read says {blocked: true} and stops; the user can open the page and do it themselves.
  // Reports back through GasketSite.result(reqId, json): {gal, text, src: 'ai' | 'results'} or {blocked} or {error}.
  // args.kind 'spare' asks about the spare tire instead: {text, src} (the AI answer's words; the app reads which kind).
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const flat = (s) => (s || '').replace(/\s+/g, ' ');
  const text = () => flat(document.body && document.body.innerText);
  const refused = (t) => /captcha|unusual traffic|are you a robot|verify you are (a )?human|too many requests/i.test(t + ' ' + document.title);
  // Brave ends its AI answer with this line; the answer is the smallest block of the page that holds it
  const AI_END = /AI-generated answer|verify critical facts/i;
  const AI_FAILED = /Failed to generate answer|Failed to create summary/i;
  // "11.3 gallons", "11.3-gallon", "about 11.3 gal" (a tank between 4 and 45 gallons; trucks with two tanks are rare)
  const GAL = /(\d{1,2}(?:\.\d{1,2})?)\s*(?:-|\s)?\s*(?:us\s+)?gal(?:lon)?s?\b/gi;
  const year = args && args.year ? String(args.year) : '';
  const matches = (s) => {
    const out = [];
    let m;
    GAL.lastIndex = 0;
    while ((m = GAL.exec(s))) {
      const v = parseFloat(m[1]);
      if (!(v >= 4 && v <= 45)) continue;
      const near = s.slice(Math.max(0, m.index - 160), m.index + m[0].length + 60);
      if (!/tank|capacity|fuel/i.test(near)) continue;
      // its own sentence (what a result says about which car), for telling one model year from another
      const before = s.slice(Math.max(0, m.index - 160), m.index);
      const k = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '));
      const sent = before.slice(k + 1) + s.slice(m.index, m.index + m[0].length + 60).split(/[.?!]\s/)[0];
      out.push({ gal: v, text: near.trim(), near: sent });
    }
    return out;
  };
  // the AI answer's own text, or '' (not there yet)
  const spare = !!(args && args.kind === 'spare');
  const aiText = () => {
    let best = null;
    document.querySelectorAll('div, section, article, aside').forEach((el) => {
      const t = el.innerText || '';
      if (!AI_END.test(t) || !(spare ? /spare|repair kit|inflator|run-?flat/i : /gal/i).test(t)) return;
      if (!best || t.length < best.length) best = t;
    });
    return best ? flat(best) : '';
  };
  // no AI answer: the search results, ones about this model year first, then the value most of them give
  const fromResults = (t) => {
    const at = Math.max(0, t.search(/fuel tank capacity in gallons/i));
    const all = matches(t.slice(at, at + 12000));
    if (!all.length) return null;
    const otherYear = (s) => (s.match(/\b(19|20)\d{2}\b/g) || []).some((y) => y !== year);
    const score = (x) => (year && x.near.includes(year) ? 2 : 0) - (/\bgen(eration)?\s*(one|two|three|four|1|2|3|4)\b|\b(1st|2nd|3rd|4th)\s+gen/i.test(x.near) ? 1 : 0) - (year && otherYear(x.near) && !x.near.includes(year) ? 1 : 0);
    const top = Math.max(...all.map(score)), pool = all.filter((x) => score(x) === top);
    const n = {};
    pool.forEach((x) => { n[x.gal] = (n[x.gal] || 0) + 1; });
    const pick = pool.slice().sort((a, b) => n[b.gal] - n[a.gal])[0];
    return { gal: pick.gal, text: pick.text, src: 'results' };
  };
  const bg = !!(args && args.bg);
  const t0 = Date.now(), AI_WAIT = 20000, LIMIT = bg ? 30000 : 120000;
  let last = '', same = 0;
  while (Date.now() - t0 < LIMIT) {
    const t = text();
    if (refused(t)) {
      if (bg) { send({ blocked: true }); return; }
    } else {
      const ai = aiText();
      if (spare) {
        // the answer streams in: take it once it has stopped changing; no AI answer: the results' text
        if (ai) { same = ai === last ? same + 1 : 0; last = ai; if (same >= 3) { send({ text: ai.slice(0, 1500), src: 'ai' }); return; } }
        else if (AI_FAILED.test(t) || Date.now() - t0 > AI_WAIT) {
          const at = Math.max(0, t.search(/spare tire/i));
          if (at > 0) { send({ text: t.slice(at, at + 1500), src: 'results' }); return; }
        }
        await sleep(400); continue;
      }
      const f = ai ? matches(ai)[0] : null;
      if (f) {
        // the answer streams in: take it once it has stopped changing for a moment
        same = ai === last ? same + 1 : 0; last = ai;
        if (same >= 3) { send({ gal: f.gal, text: f.text, src: 'ai' }); return; }
      } else if (AI_FAILED.test(t) || Date.now() - t0 > AI_WAIT) {
        const r = fromResults(t);
        if (r) { send(r); return; }
      }
    }
    await sleep(400);
  }
  send({ error: 'Brave Search didn\'t give ' + (spare ? 'an answer about the spare.' : 'a tank size.') + (bg ? ' [' + document.title + ' | ' + text().slice(0, 300) + ']' : '') });
}
