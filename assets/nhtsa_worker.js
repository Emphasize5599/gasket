async function (reqId, args) {
  // Reads the answer of NHTSA's recall lookup for one VIN (https://www.nhtsa.gov/recalls?vymm=<VIN>) from the page the
  // user is looking at. The page is shown to them, never hidden, and it does its own checks (including Google's invisible
  // reCAPTCHA) as in any browser. This only reads what the page shows, and never clicks or solves anything.
  // Reports back through GasketSite.result(reqId, json): {open, campaigns, items} or {error}.
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // "1 Unrepaired Recall Associated with this VIN", "0 unrepaired recalls associated with this VIN"; the help text quotes
  // the second one ('you will see the message: "0 unrepaired recalls ..."'), so a quoted match is skipped
  const RESULT = /(^|[^"“\w])(\d+)\s+unrepaired\s+recalls?\s+associated\s+with\s+this\s+vin/gi;
  const CAMPAIGN = /\b(\d{2}V\d{3}000)\b/g;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    const txt = (document.body && document.body.innerText) || '';
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
    if (/an unknown error occurred/i.test(txt)) {
      send({ error: 'NHTSA couldn\'t check that VIN right now. Try again in a little while.', refused: true });
      return;
    }
    if (/vin (is )?invalid|not a valid vin/i.test(txt.replace(/where[’']s my vin[\s\S]*$/i, ''))) {   // not the help text below the form
      send({ error: 'NHTSA says that VIN isn\'t valid. Check it in the Garage.' });
      return;
    }
    await sleep(700);
  }
  // a background read (args.bg) says what the page showed instead, for the log
  const all = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' '), at = all.search(/vin lookup|search by ymm or vin/i);
  const what = args && args.bg ? ' [' + document.title + ' | ' + all.slice(Math.max(0, at), Math.max(0, at) + 400) + ']' : '';
  send({ error: 'NHTSA\'s page didn\'t show an answer. You can read it there, then tap Done.' + what });
}
