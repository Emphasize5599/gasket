// Runs inside the app's off-screen copy of ChargePoint's public station page (driver.chargepoint.com/stations/<id>),
// signed out. The page shows the price its host set ("Prices Set by …", "Energy Rate $0.44 / kWh", fees or "Free");
// this waits for the details to draw and sends back the price part of the page's text (the app reads the figures).
// Reports {text} or {missing: true} (no such station) or {blocked: true} (a bot check: never got around) or {error}.
async function (reqId, args) {
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const flat = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const t0 = Date.now(), LIMIT = 25000;
  let failedAt = 0;
  while (Date.now() - t0 < LIMIT) {
    const t = flat(document.body && document.body.innerText), title = document.title || '';
    // DataDome / any challenge: its iframe or page words
    if (document.querySelector('iframe[src*="captcha-delivery"], iframe[src*="datadome"]') || /captcha|verify you are (a )?human|are you a robot|access denied|blocked/i.test(title + ' ' + t.slice(0, 400))) { send({ blocked: true }); return; }
    // "Failed to load" can be a passing refusal of the page's own data request: it must still say so 3 s later
    if (/Failed to load station details|station (?:was )?not found/i.test(t)) {
      if (!failedAt) failedAt = Date.now();
      else if (Date.now() - failedAt >= 3000) { send({ missing: true, sample: t.slice(0, 200) }); return; }
      await sleep(500); continue;
    }
    failedAt = 0;
    const at = t.search(/\bPrices? Set by\b|\bEnergy Rate\b|\bPrice\b[^|]{0,40}\bFree\b/i);
    if (at >= 0 && !/Loading station details/i.test(t)) {
      await sleep(600);   // the rest of the price block (fees) draws a moment later
      const t2 = flat(document.body && document.body.innerText), at2 = Math.max(0, t2.search(/\bPrices?\b/i));
      send({ text: t2.slice(at2, at2 + 900) });
      return;
    }
    await sleep(500);
  }
  send({ error: 'ChargePoint station details did not load' + (args && args.bg !== false ? ' [' + flat(document.body && document.body.innerText).slice(0, 160) + ']' : '') });
}
