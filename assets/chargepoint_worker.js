// Runs inside the app's off-screen copy of ChargePoint's public station page (driver.chargepoint.com/stations/<id>),
// signed out. The page shows the price its host set ("Prices Set by …", "Energy Rate $0.44 / kWh", fees or "Free");
// this waits for the details to draw and sends back the price part of the page's text (the app reads the figures).
// Reports {text} or {missing: true} (no such station) or {blocked: true} (a bot check: never got around) or {error}.
async function (reqId, args) {
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const flat = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const t0 = Date.now(), LIMIT = 32000;
  let failedAt = 0, challengeAt = 0, clicked = false, phase = 'loading',priceText='',priceAt=0;
  const normalized = s => flat(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const diagnostic = () => ({phase, elapsedMs:Date.now()-t0, httpStatus:window.__gasketChargePointHttpStatus||0, clickedCard:clicked, title:document.title||''});
  const visible = el => !!el && (!el.getBoundingClientRect || (el.getBoundingClientRect().width>0 && el.getBoundingClientRect().height>0 && getComputedStyle(el).visibility!=='hidden' && getComputedStyle(el).display!=='none'));
  while (Date.now() - t0 < LIMIT) {
    const panel = document.querySelector('#slideout_station_details');
    const t = flat((panel || document.body) && (panel || document.body).innerText), title = document.title || '';
    // A hidden challenge frame or a transient automatic check is not a user CAPTCHA.
    const frame=document.querySelector('iframe[src*="captcha-delivery"], iframe[src*="datadome"]');
    const challenge=visible(frame)||/captcha|access denied|request blocked|security check|unusual traffic/i.test(title)||/verify you are (a )?human|are you a robot|confirm you are human|complete the security check|unusual traffic/i.test(flat(document.body&&document.body.innerText).slice(0,1600));
    if(challenge){phase='challenge';if(!challengeAt)challengeAt=Date.now()||1;if(Date.now()-challengeAt>=8000){send({blocked:true,code:'challenge',diagnostics:diagnostic()});return;}await sleep(500);continue;}challengeAt=0;
    // Some device URLs open the map/list without opening the requested station.
    // Select only an exact ID or a unique exact station-name match, never a nearby charger.
    if(!panel&&!clicked&&document.querySelectorAll&&Date.now()-t0>=2000){
      const cards=Array.from(document.querySelectorAll('[id^="station_card_"]')),id=String(args&&args.url||'').match(/\/stations\/(\d+)/),exact=id&&cards.find(c=>c.id==='station_card_'+id[1]);
      const names=cards.filter(c=>{const h=c.querySelector('h2,h3,[role="heading"]');return args&&args.name&&h&&normalized(h.innerText)===normalized(args.name);}),card=exact||(names.length===1?names[0]:null);
      if(card){phase='opening_station';clicked=true;card.click();await sleep(500);continue;}
    }
    // "Failed to load" can be a passing refusal of the page's own data request: it must still say so 3 s later
    if (/Failed to load station details|station (?:was )?not found/i.test(t)) {
      phase='details_error';
      if (!failedAt) failedAt = Date.now();
      else if (Date.now() - failedAt >= 8000) {if(/station (?:was )?not found/i.test(t))send({missing:true,sample:t.slice(0,200),diagnostics:diagnostic()});else send({error:'ChargePoint station details could not load',code:'details_error',sample:t.slice(0,200),diagnostics:diagnostic()});return;}
      await sleep(500); continue;
    }
    failedAt = 0;
    const at = t.search(/\bPrices? Set by\b|\bEnergy Rate\b|\bPrice\b[^|]{0,40}\bFree\b/i);
    if (at >= 0 && !/Loading station details/i.test(t) && (panel || !document.querySelector('[id^="station_card_"]'))) {
      // The account service-fee section often draws before the host's tariff.
      // Wait for stable details rather than declaring that partial block priced.
      if(priceText!==t){priceText=t;priceAt=Date.now();}
      const tariffReady=/\b(?:Energy|Charging)\s*(?:Rate|Fee)\b.*?\$\s*\d|\bStation Time Rate\s+while Connected\s*\$\s*\d|\bPrice\s*[·|:]?\s*Free\b|\bFree charging\b/i.test(t);
      if(!tariffReady&&Date.now()-priceAt<6000){phase='partial_price';await sleep(500);continue;}
      await sleep(600);   // the rest of the price block (fees) draws a moment later
      const t2 = flat((panel || document.body).innerText), at2 = Math.max(0, t2.search(/\bPrices?\b/i));
      phase='priced';send({ text: t2.slice(at2, at2 + 6000),diagnostics:diagnostic() });
      return;
    }
    await sleep(500);
  }
  send({ error: 'ChargePoint station details did not load',code:'timeout',sample:flat(document.body&&document.body.innerText).slice(0,200),diagnostics:diagnostic() });
}
