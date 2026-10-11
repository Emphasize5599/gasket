async function (reqId, args) {
  // Reads Tire Rack's public pages in the hidden window (like the price sites):
  //   'models' / 'clars': Tire Rack's own names for a car, from the service behind its "select your vehicle" menus
  //     (its model names for a year and make, then each model's versions, "clarifiers"); its pages only answer to these;
  //   'size': the factory tire size for a vehicle (SelectTireSize.jsp with those names);
  //   'oesize': the same for a model with no versions, through the vehicle menu's own steps (set the vehicle, then read
  //     its tire-size panel), since SelectTireSize.jsp won't show those;
  //   'list': the tires sold in a size (TireSearchResults.jsp): brand and model, type, wear rating ("UTQG: 700 A A") and
  //     mileage warranty.
  // It reads text only, never clicks through a check; if the site refuses ("currently unavailable", a robot check) it says
  // {blocked: true}.
  // Reports back through GasketSite.result(reqId, json).
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => (document.body && document.body.innerText) || '';
  const refused = (t) => /currently unavailable|access denied|are you a robot|verify you are (a )?human|unusual traffic/i.test(t);
  const SIZE = /\b(\d{3})\/(\d{2})(?:-|\s*Z?R)(\d{2})\b/g;
  const norm = (m) => m[1] + '/' + m[2] + 'R' + m[3];
  const settle = async (ok, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = text(); if (refused(t) || ok(t)) return t; await sleep(400); } return text(); };

  // Tire Rack's vehicle picker: the same service its own "select your vehicle" menus ask, from its own page and with the
  // page's cookies (nothing gotten around). It answers in small XML lists: <models><model>…, <clarifiers><clar>….
  // Asked gently: one request at a time, a pause in between (fast bursts get "currently unavailable").
  const V = '/survey/ValidationServlet?';
  const ask = async (q) => {
    const r = await fetch(V + q, { credentials: 'include' }), body = await r.text();
    if (refused(body) || r.status === 403 || r.status === 429) { const e = new Error('blocked'); e.blocked = true; throw e; }
    if (!r.ok && r.status !== 204) throw new Error('HTTP ' + r.status);
    return body;
  };
  const tags = (xml, tag) => {
    if (!/^\s*(<\?xml[^>]*>\s*)?<[a-z]/i.test(xml || '') || /<html/i.test(xml || '')) return null;      // not one of its lists
    return Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName(tag)).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  };
  const enc = encodeURIComponent;
  const pickerStep = async () => {
    await settle((t) => t.length > 200, 15000);
    if (refused(text())) { send({ blocked: true }); return; }
    try {
      if (args.step === 'models') {
        // the make as Tire Rack spells it ("RAM", "MINI", "Mercedes-Benz"): asked only when the first try finds nothing
        let make = args.make, models = tags(await ask('autoYear=' + enc(args.year) + '&autoMake=' + enc(make) + '&newDesktop=true'), 'model');
        if (models === null) { send({ error: 'not a list' }); return; }
        if (!models.length) {
          await sleep(700);
          const makes = tags(await ask('autoMakesNeeded=true&autoYear=' + enc(args.year)), 'make') || [];
          const key = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
          const m = makes.find((x) => key(x) === key(args.make));
          if (m && m !== make) { make = m; await sleep(700); models = tags(await ask('autoYear=' + enc(args.year) + '&autoMake=' + enc(make) + '&newDesktop=true'), 'model') || []; }
        }
        send({ make: make, models: models.slice(0, 200) });
        return;
      }
      if (args.step === 'clars') {
        const out = {};
        for (const [i, model] of (args.models || []).slice(0, 3).entries()) {
          if (i) await sleep(800);
          const list = tags(await ask('autoYear=' + enc(args.year) + '&autoMake=' + enc(args.make) + '&autoModel=' + enc(model) + '&newDesktop=true'), 'clar');
          if (list === null) { send({ error: 'not a list', clars: out }); return; }
          out[model] = list.slice(0, 60);
        }
        send({ clars: out });
        return;
      }
    } catch (e) { send(e.blocked ? { blocked: true } : { error: String(e && e.message || e).slice(0, 120) }); return; }
  };
  if (args.step === 'models' || args.step === 'clars') { await pickerStep(); return; }

  // Sections start at each heading; the tab labels ("Factory Tire Size Optional Tire Sizes Custom Tire Size") are
  // headings with no sizes after them, so they add nothing. Sizes under "Factory" headings are the factory ones.
  const readSizes = (t) => {
    const HEAD = /factory tire size|optional (?:tire )?size(?:s|\(s\))?|custom tire size|need help|view results/gi;
    const marks = []; let h; HEAD.lastIndex = 0;
    while ((h = HEAD.exec(t))) marks.push({ at: h.index, end: h.index + h[0].length, kind: /factory/i.test(h[0]) ? 'f' : /optional/i.test(h[0]) ? 'o' : 'x' });
    const factory = [], optional = [];
    marks.forEach((mk, n) => {
      const seg = t.slice(mk.end, n + 1 < marks.length ? marks[n + 1].at : mk.end + 600);
      let m; SIZE.lastIndex = 0;
      while ((m = SIZE.exec(seg))) { const z = norm(m); if (mk.kind === 'f' && factory.indexOf(z) < 0) factory.push(z); else if (mk.kind === 'o' && optional.indexOf(z) < 0) optional.push(z); }
    });
    return { factory: factory, optional: optional.filter((x) => factory.indexOf(x) < 0).slice(0, 12) };
  };

  if (args.step === 'size') {
    const t = await settle((t) => /factory tire size/i.test(t) || /error=noVehicle/.test(location.href), 20000);
    if (refused(t)) { send({ blocked: true }); return; }
    if (/error=|noVehicle/i.test(location.href) || !/factory tire size/i.test(t)) { send({ unknown: true }); return; }   // Tire Rack doesn't know that model / version
    send(readSizes(t));
    return;
  }

  if (args.step === 'oesize') {
    // A model with no versions ("Mustang Coupe"): SelectTireSize.jsp only says "currently unavailable" for these, so this
    // does what Tire Rack's own vehicle menu does: set the vehicle, then read its "select your tire size" panel.
    await settle((t) => t.length > 200, 15000);
    if (refused(text())) { send({ blocked: true }); return; }
    const q = 'modClarLookUpCompleted=false&mmycPAX=false&cameFrom=vehicleSelector&performance=&search=tire&index=0&autoYear=' + enc(args.year) +
      '&autoMake=' + enc(args.make) + '&autoModel=' + enc(args.model) + '&autoModClar=' + enc(args.clar || '') + '&zip-code=';
    try {
      const r = await fetch('/SetCurrentVehicleServlet?ajax=true&' + q, { credentials: 'include' }), body = await r.text();
      if (refused(body) || r.status === 403 || r.status === 429) { send({ blocked: true }); return; }
      let j = null; try { j = JSON.parse(body); } catch (e) { /* not its answer */ }
      if (!j || j.vehicleZipSet !== 'success') { send(j && j.vehicleZipSet === 'redirect' ? { unknown: true } : { error: 'vehicle not set' }); return; }
      await sleep(900);
      const r2 = await fetch('/modalPopups/selectOETireSize.jsp?' + q, { credentials: 'include' }), html = await r2.text();
      if (refused(html) || r2.status === 403 || r2.status === 429) { send({ blocked: true }); return; }
      const t = (new DOMParser().parseFromString(html, 'text/html').body.textContent || '').replace(/\s+/g, ' ');
      // the panel names the vehicle it's for; if it isn't this one, the vehicle didn't take
      const key = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!/factory tire size/i.test(t) || key(t).indexOf(key(args.year + ' ' + args.make + ' ' + args.model)) < 0) { send({ unknown: true }); return; }
      send(readSizes(t));
    } catch (e) { send({ error: String(e && e.message || e).slice(0, 120) }); }
    return;
  }

  if (args.step === 'list') {
    const CAT = /(all-season|all season|summer|winter|snow|all-weather|all-terrain|mud-terrain|highway|touring|performance|ice)/i;
    const seen = {}, out = [];
    const readPage = (t) => {
      const L = t.split('\n').map((s) => s.trim()).filter(Boolean);
      for (let n = 0; n < L.length; n++) {
        // a product starts with its name in capitals ("CONTINENTAL SECURECONTACT AW") and then its type
        const name = L[n], cat = L[n + 1] || '';
        if (!/^[A-Z0-9][A-Z0-9 .&+'\-\/]{3,60}$/.test(name) || !/[A-Z]{3}/.test(name) || !CAT.test(cat) || cat.length > 60 || /^[A-Z0-9 \-]+$/.test(cat)) continue;
        const p = { name: name, type: cat, size: '', utqg: null, warrantyMi: 0 };
        for (let q = n + 2; q < Math.min(L.length, n + 80); q++) {
          const l = L[q];
          if (q > n + 2 && /^[A-Z0-9][A-Z0-9 .&+'\-\/]{3,60}$/.test(l) && CAT.test(L[q + 1] || '') && !/^[A-Z0-9 \-]+$/.test(L[q + 1] || '')) break;   // the next product
          let m;
          if (!p.size && (m = /^Size:\s*(\S+)/i.exec(l))) p.size = m[1];
          if (!p.utqg && (m = /^UTQG:\s*(\d{2,4})\s+(AA|A|B|C)\s+(A|B|C)\b/i.exec(l))) p.utqg = { tw: +m[1], trac: m[2].toUpperCase(), temp: m[3].toUpperCase() };
          if (!p.warrantyMi && (m = /(\d{2,3})K Mile Manufacturer/i.exec(l))) p.warrantyMi = +m[1] * 1000;
        }
        if (p.size && !seen[name]) { seen[name] = 1; out.push(p); }     // a real product always lists its size
      }
    };
    let t = await settle((t) => /UTQG:/i.test(t) || /no tires|no results/i.test(t), 25000);
    if (refused(t)) { send({ blocked: true }); return; }
    readPage(t);
    // more pages: follow "next" while there is one (at most 10 pages)
    for (let page = 2; page <= 10; page++) {
      const next = Array.from(document.querySelectorAll('a, button')).find((e) => /^(next|›|>|»)$/i.test((e.innerText || e.getAttribute('aria-label') || '').trim()) && !e.disabled && e.offsetParent);
      if (!next) break;
      const before = out.length; next.click();
      await sleep(2500); t = await settle(() => false, 1500);
      if (refused(t)) break;
      readPage(t);
      if (out.length === before) break;
    }
    send({ tires: out.slice(0, 300) });
    return;
  }
  send({ error: 'unknown step' });
}
