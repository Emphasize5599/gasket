// Runs inside the app's off-screen copy of exxonmobilfuels.com, signed out. It asks ExxonMobil's own station locator (the
// request exxonmobilfuels.com's station finder makes) for each square, from the page, so the site's own cookies come along:
// asked from outside the page, the locator answers "Access Denied" (0.0.269 log: HTTP 403 on 130 of 131 squares).
// args: {boxes: [[lat1, lat2, lng1, lng2], ...]} (at most 40 per read)
// Reports {boxes: [[[lat, lng, walmartPlus 0|1, name], ...] | null, ...], read} or {blocked, boxes (those read)} or {error}.
// A check on ExxonMobil's page (Access Denied, a challenge) is never got around: the read says blocked and stops.
async function (reqId, args) {
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const refused = (t) => /access denied|captcha|are you a robot|unusual traffic|verify you are|request unsuccessful/i.test(t || '');
  if (refused(document.title) || refused(document.body && document.body.innerText.slice(0, 2000))) { send({ blocked: true, boxes: [] }); return; }
  const url = (b) => '/en/api/locator/Locations?Latitude1=' + b[0].toFixed(3) + '&Latitude2=' + b[1].toFixed(3) + '&Longitude1=' + b[2].toFixed(3) +
    '&Longitude2=' + b[3].toFixed(3) + '&DataSource=RetailGasStations&Country=US&Customsort=False';
  const boxes = (args.boxes || []).slice(0, 40), out = [], started = Date.now();
  let stage = 'start';
  const detail = () => ({stage, elapsedMs:Date.now()-started, requested:boxes.length, read:out.length});
  try {
    for (let i = 0; i < boxes.length; i++) {
      if (i) await pause(350);   // one square at a time, like a person panning the finder
      // Leave a full request timeout inside the batch deadline; remaining cells continue in the next read.
      if(Date.now()-started>=19000) { send({more:true,boxes:out,detail:detail()});return; }
      stage='locator';
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(6000,25000-(Date.now()-started)));
      let r,txt;
      try {
        // Bound headers AND body; a stalled response must not hold every square for 90 seconds.
        r = await fetch(url(boxes[i]), { signal:controller.signal, headers: { accept: 'application/json, text/plain, */*' }, credentials: 'include' });
        stage='body';txt = await r.text();
      } finally { clearTimeout(timer); }

      if (r.status === 403 || r.status === 429 || (txt.charAt(0) !== '{' && refused(txt.slice(0, 800)))) { send({ blocked: true, status: r.status, boxes: out }); return; }
      if (!r.ok) { send({error:'Locator HTTP '+r.status,boxes:out,detail:detail()});return; }
      let j; try { j = JSON.parse(txt.replace(/[\u0000-\u001f]/g, ' ')); } catch (e) { send({error:'Invalid locator response',boxes:out,detail:detail()});return; }
      if(!Array.isArray(j.Locations)){send({error:'Locator locations missing',boxes:out,detail:detail()});return;}
      out.push((j.Locations || []).map((x) => {
        const tags = (x.StoreAmenities || []).concat(x.FeaturedItems || []);
        return [+x.Latitude, +x.Longitude, tags.some((a) => a && /walmart/i.test(a.Name || a.Title || '')) ? 1 : 0, String(x.DisplayName || x.LocationName || '').slice(0, 60)];
      }));
    }
    send({ boxes: out, read: out.length, detail:detail() });
  } catch (e) { send({ error: String(e && e.message || e).slice(0, 200), boxes: out, detail:detail() }); }
}
