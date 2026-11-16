// Runs inside the app's off-screen copy of Toyota's or Lexus's own parts store (autoparts.toyota.com / parts.lexus.com),
// signed out. It asks the store's "shop by VIN" lookup (the request the page's own VIN box makes) for one VIN, from the
// page, so the site's own cookies come along. NHTSA's decoder can't name most Toyota trims (Prius "One/Two", Sienna
// "E grade"); the parts catalog says the grade (LE, XSE, TRD Off-Road…).
// Subaru's and Kia's stores (parts.subaru.com / parts.kia.com) run on another platform: args.store 'simplepart' asks
// their VIN box's lookup (POST /wm.aspx/CreateVinLinks) and reports {descriptions: ['2021 Outback 2.5L Limited', …]}.
// args: {vin, store?}. Reports {records: [{year, make, model, grade, driveline}]} ({records: []} = the store doesn't know that VIN),
// or {blocked} or {error}. A check on the store's page is never got around: the read says blocked and stops.
async function (reqId, args) {
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const refused = (t) => /access denied|captcha|are you a robot|unusual traffic|verify you are|request blocked|request unsuccessful/i.test(t || '');
  if (refused(document.title) || refused(document.body && document.body.innerText.slice(0, 2000))) { send({ blocked: true }); return; }
  const vin = String(args.vin || '').toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) { send({ error: 'Invalid VIN' }); return; }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  if (args.store === 'simplepart') {
    try {
      const r = await fetch('/wm.aspx/CreateVinLinks', {
        method: 'POST', signal: controller.signal, credentials: 'include',
        headers: { 'content-type': 'application/json;charset=UTF-8', accept: 'application/json, text/plain, */*' },
        body: JSON.stringify({ VinNumber: vin, AbsolutePath: '%252Fdefault.aspx', QueryString: '' })
      });
      const txt = await r.text();
      if (r.status === 403 || r.status === 429 || (txt.charAt(0) !== '{' && refused(txt.slice(0, 800)))) { send({ blocked: true, status: r.status }); return; }
      if (!r.ok) { send({ error: 'Parts store HTTP ' + r.status }); return; }
      let list; try { const d = JSON.parse(txt).d; list = typeof d === 'string' ? (d ? JSON.parse(d) : []) : d; } catch (e) { send({ error: 'Invalid parts store response' }); return; }
      if (!Array.isArray(list)) { send({ error: 'Parts store answer missing' }); return; }
      send({ descriptions: list.filter(Boolean).slice(0, 12).map((x) => String(x.vehicleDescription || '').slice(0, 120)).filter(Boolean) });
    } catch (e) { send({ error: String(e && e.message || e).slice(0, 200) }); }
    finally { clearTimeout(timer); }
    return;
  }
  try {
    const r = await fetch('/graphql?getVehicleDataByVin', {
      method: 'POST', signal: controller.signal, credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'dealer-code': 'default' },
      body: JSON.stringify({ query: '{vehicleData(vin:"' + vin + '"){message allRecords{model_year make model_name grade driveline}}}' })
    });
    const txt = await r.text();
    if (r.status === 403 || r.status === 429 || (txt.charAt(0) !== '{' && refused(txt.slice(0, 800)))) { send({ blocked: true, status: r.status }); return; }
    if (!r.ok) { send({ error: 'Parts store HTTP ' + r.status }); return; }
    let j; try { j = JSON.parse(txt); } catch (e) { send({ error: 'Invalid parts store response' }); return; }
    const d = j && j.data && j.data.vehicleData;
    if (!d) { send({ error: 'Parts store answer missing' }); return; }
    const records = (d.allRecords || []).filter(Boolean).slice(0, 8).map((x) => ({
      year: +x.model_year || null, make: String(x.make || '').slice(0, 20), model: String(x.model_name || '').slice(0, 40),
      grade: String(x.grade || '').slice(0, 60), driveline: String(x.driveline || '').slice(0, 60)
    }));
    send({ records: records, message: String(d.message || '').slice(0, 60) });
  } catch (e) { send({ error: String(e && e.message || e).slice(0, 200) }); }
  finally { clearTimeout(timer); }
}
