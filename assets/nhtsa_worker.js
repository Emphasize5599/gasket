async function (reqId, args) {
  // Reads the answer of NHTSA's recall lookup for one VIN (https://www.nhtsa.gov/recalls?vymm=<VIN>) from the page the
  // user is looking at. The page is shown to them, never hidden, and it does its own checks (including Google's invisible
  // reCAPTCHA) as in any browser. This only reads what the page shows, and never clicks or solves anything.
  // Reports back through GasketSite.result(reqId, json): {open, campaigns, items} or {error}.
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The answer: "0 Unrepaired Recalls associated with this VIN" (or "… Found"). The number and the words are separate
  // elements, so the page's text can run them together ("0Unrepaired Recalls"); at most two digits, so a year or date
  // just before it can't be read as the count. The help text quotes it ('you will see the message: "0 unrepaired
  // recalls ..."'), so a quoted match is skipped.
  const RESULT = /(^|[^"“\w\d])(\d{1,2})\s*unrepaired\s*recalls?\b/gi;
  const CAMPAIGN = /\b(\d{2}V\d{3}000)\b/g;
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const txt = (document.body && document.body.innerText) || '';
    if (/verify (?:that )?you(?: are|'re) human|access denied|unusual traffic/i.test(txt)) {send({blocked:true,error:'NHTSA requires a visible site check. Open its page to continue.'});return;}
    const wanted=/[?&]vymm=([^&#]+)/i.exec(args&&args.url||'');
    const vinBox=Array.from(document.querySelectorAll('input')).find(e=>/vin/i.test([e.id,e.name,e.placeholder].join(' '))&&e.value);
    if(wanted&&vinBox&&vinBox.value.toUpperCase().replace(/\s/g,'')!==decodeURIComponent(wanted[1]).toUpperCase()){await sleep(300);continue;}
    let m, found = null;
    RESULT.lastIndex = 0;
    while ((m = RESULT.exec(txt))) {
      const before = txt.slice(Math.max(0, m.index - 40), m.index + m[1].length).toLowerCase();
      if (/see the message|message:\s*$/.test(before)) continue;
      found = m; break;
    }
    if (found) {
      // what follows the count is the list of open recalls: their NHTSA campaign numbers, and a short text for each
      const rest = txt.slice(found.index, found.index + 20000);
      const cut = rest.search(/where[’']s my vin|what information will display/i);
      const block = cut > 0 ? rest.slice(0, cut) : rest.slice(0, 8000);
      const campaigns = Array.from(new Set((block.match(CAMPAIGN) || [])));
      const items = campaigns.map((id) => {
        const i = block.indexOf(id);
        return block.slice(Math.max(0, i - 160), i + 240).replace(/\s+/g, ' ').trim();
      });
      send({ open: +found[2], campaigns: campaigns, items: items });
      return;
    }
    // NHTSA's own error under the VIN box: its lookup turned the request down (in a hidden window, usually its
    // invisible reCAPTCHA deciding nobody's there). Nothing is retried or worked around; the app offers the page instead.
    if(/foreign server.*error|remote server.*error|service (?:is )?unavailable|internal server error|bad gateway|gateway timeout/i.test(txt)){send({error:'NHTSA server could not answer the lookup.',code:'server',retryable:true});return;}
    if (/an unknown error occurred/i.test(txt)) {
      send({ error: 'NHTSA couldn\'t check that VIN right now. Try again in a little while.', refused: true });
      return;
    }
    if (/vin (is )?invalid|not a valid vin/i.test(txt.replace(/where[’']s my vin[\s\S]*$/i, ''))) {   // not the help text below the form
      send({ error: 'NHTSA says that VIN isn\'t valid. Check it in the Garage.' });
      return;
    }
    await sleep(300);
  }
  // a background read (args.bg) says what the page showed instead, for the log
  const all = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' '), at = all.search(/vin lookup|search by ymm or vin/i);
  const what = args && args.bg ? ' [' + document.title + ' | ' + all.slice(Math.max(0, at), Math.max(0, at) + 400) + ']' : '';
  send({ error: 'NHTSA\'s page didn\'t show an answer. You can read it there, then tap Done.' + what });
}
