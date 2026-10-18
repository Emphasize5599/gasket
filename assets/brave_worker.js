async function (reqId, args) {
  // Reads a car's fuel tank size from Brave Search's AI answer for "<car> fuel tank capacity in gallons?", in the hidden
  // window (args.bg) or on the page shown to the user. It only reads the page's text: if Brave shows a check (a CAPTCHA,
  // "unusual traffic"), the hidden read says {blocked: true} and stops; the user can open the page and do it themselves.
  // Reports back through GasketSite.result(reqId, json): {gal, text, src: 'ai' | 'results'} or {blocked} or {error}.
  // args.kind 'spare' asks about the spare tire instead: {text, src} (the AI answer's words; the app reads which kind).
  // args.kind 'trims' asks for the model's trim levels the same way: {text, src} (the app reads the names: TrimMath.parse).
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const flat = (s) => (s || '').replace(/\s+/g, ' ').trim();
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
      // how sure it's the tank's size: "tank" / "capacity" right beside it, not a reserve, warning light or amount left
      const close = s.slice(Math.max(0, m.index - 60), m.index + m[0].length + 30);
      const rank = (/tank|capacity/i.test(close) ? 2 : 0) - (/reserve|remaining|left in|low[- ]fuel|warning|light comes|refill|per\s+(mile|hour)|range/i.test(close) ? 3 : 0);
      out.push({ gal: v, text: near.trim(), near: sent, rank: rank });
    }
    return out;
  };
  // the best-ranked figure (the first of those): a "20-gallon tank, light at 4 gallons left" answer is 20, not 4
  const best = (list) => list.reduce((a, x) => (!a || x.rank > a.rank ? x : a), null);
  // the AI answer's own text, or '' (not there yet)
  const spare = !!(args && args.kind === 'spare'), trims = !!(args && args.kind === 'trims'), words = spare || trims;   // text answers, not a number
  const loc = typeof location !== 'undefined' ? location : { pathname: '', search: '' };
  const ask = loc.pathname.indexOf('/ask') === 0;
  const q = flat(new URLSearchParams(loc.search).get('q') || ''), qHead = q.slice(0, 40);
  const STEADY = ask ? 6 : 3;   // a chat answer can pause between sentences
  // Ask Brave shows our question on the page, and the spare question names every answer ("Run-flat tires, or No spare"):
  // each of its sentences is taken out before reading, so the echo alone is never taken for the answer
  const qParts = q.split(/(?<=[.?!])\s+/).map((x) => x.trim()).filter((x) => x.length >= 8).sort((a, b) => b.length - a.length);
  const lower = (x) => x.toLowerCase();
  const unask = (t) => {
    if (!ask) return t;
    // what follows the question's last sentence on the page (the chat's own labels come before it)
    const lt = lower(t);
    let cut = 0;
    [q].concat(qParts).forEach((x) => { const i = x ? lt.lastIndexOf(lower(x)) : -1; if (i >= 0) cut = Math.max(cut, i + x.length); });
    let a = t.slice(cut);
    [q].concat(qParts).forEach((x) => { let i; while (x && (i = lower(a).indexOf(lower(x))) >= 0) a = a.slice(0, i) + ' ' + a.slice(i + x.length); });
    if (spare) a = a.replace(/Start with:?\s*Full-size spare,?\s*Compact spare,?\s*Repair kit,?\s*Run-flat tires,?\s*(or\s+)?No spare\.?/gi, ' ');
    return flat(a);
  };
  const want = spare ? /spare|repair kit|inflator|run-?flat/i : trims ? /\btrims?\b/i : /gal/i;
  const aiText = () => {
    let best = null;
    document.querySelectorAll('div, section, article, aside').forEach((el) => {
      const t = el.innerText || '';
      if (!AI_END.test(t) || !want.test(unask(t))) return;
      if (!best || t.length < best.length) best = t;
    });
    if (best) return unask(flat(best));
    // Ask Brave (/ask, the chat page: it always answers): the page without our question, cut at the disclaimer
    if (!ask) return '';
    let a = text();
    const end = a.search(AI_END);
    if (end >= 0) a = a.slice(0, end);
    a = unask(a);
    return (spare ? want : trims ? want : /\d\s*(?:-|\s)?\s*gal/i).test(a) ? a : '';
  };
  // no AI answer: the search results, ones about this model year first, then the value most of them give
  const fromResults = (t) => {
    const at = Math.max(0, t.search(/fuel tank capacity in gallons/i));
    const all = matches(t.slice(at, at + 12000));
    if (!all.length) return null;
    const otherYear = (s) => (s.match(/\b(19|20)\d{2}\b/g) || []).some((y) => y !== year);
    const score = (x) => (year && x.near.includes(year) ? 2 : 0) - (/\bgen(eration)?\s*(one|two|three|four|1|2|3|4)\b|\b(1st|2nd|3rd|4th)\s+gen/i.test(x.near) ? 1 : 0) - (year && otherYear(x.near) && !x.near.includes(year) ? 1 : 0) + x.rank;
    const top = Math.max(...all.map(score)), pool = all.filter((x) => score(x) === top);
    const n = {};
    pool.forEach((x) => { n[x.gal] = (n[x.gal] || 0) + 1; });
    const pick = pool.slice().sort((a, b) => n[b.gal] - n[a.gal])[0];
    return { gal: pick.gal, text: pick.text, src: 'results' };
  };
  const bg = !!(args && args.bg);
  const t0 = Date.now(), AI_WAIT = ask ? 25000 : 20000, LIMIT = bg ? (ask ? 36000 : 30000) : 120000;   // the chat takes 5 s or more to answer
  let last = '', same = 0;
  while (Date.now() - t0 < LIMIT) {
    const t = unask(text());
    if (refused(t)) {
      if (bg) { send({ blocked: true }); return; }
    } else {
      const ai = aiText();
      if(trims&&window.TrimMath){
        const names=TrimMath.parse(ai||'',args), fallback=AI_FAILED.test(t)||Date.now()-t0>AI_WAIT;
        if(names.length){same=ai===last?same+1:0;last=ai;if(same>=STEADY){send({text:'Trims: '+names.join(', '),src:'ai'});return;}}
        else if(fallback){const list=TrimMath.parse(t,args);if(list.length){send({text:'Trims: '+list.join(', '),src:'results'});return;}}
        await sleep(400);continue;
      }
      if (words) {
        // the answer streams in: take it once it has stopped changing; no AI answer: the results' text
        if (ai) { same = ai === last ? same + 1 : 0; last = ai; if (same >= STEADY) { send({ text: ai.slice(0, 1500), src: 'ai', ask: ask }); return; } }
        else if (AI_FAILED.test(t) || Date.now() - t0 > AI_WAIT) {
          const at = t.search(trims ? /\btrim(s| levels?)\b/i : /spare tire/i);
          if (at >= 0) { send({ text: t.slice(at, at + 1500), src: 'results' }); return; }
        }
        await sleep(400); continue;
      }
      const f = ai ? best(matches(ai)) : null;
      if (f) {
        // the answer streams in: take it once it has stopped changing for a moment
        same = ai === last ? same + 1 : 0; last = ai;
        if (same >= STEADY) { send({ gal: f.gal, text: f.text, src: 'ai', ask: ask }); return; }
      } else if (AI_FAILED.test(t) || Date.now() - t0 > AI_WAIT) {
        const r = fromResults(t);
        if (r) { send(r); return; }
      }
    }
    await sleep(400);
  }
  send({ error: 'Brave Search didn\'t give ' + (spare ? 'an answer about the spare.' : trims ? 'a list of trims.' : 'a tank size.') + (bg ? ' [' + document.title + ' | ' + text().slice(0, 300) + ']' : '') });
}
