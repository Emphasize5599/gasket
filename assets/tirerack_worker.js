async function (reqId, args) {
  // Reads Tire Rack's public pages in the hidden window (like the price sites): the factory tire size for a vehicle
  // (args.step 'size', on SelectTireSize.jsp), or the tires sold in a size (args.step 'list', on TireSearchResults.jsp):
  // brand and model, type, wear rating ("UTQG: 700 A A") and mileage warranty. It reads the visible text only, never
  // clicks through a check; if the site refuses ("currently unavailable", a robot check) it says {blocked: true}.
  // Reports back through GasketSite.result(reqId, json).
  const send = (o) => GasketSite.result(reqId, JSON.stringify(o));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => (document.body && document.body.innerText) || '';
  const refused = (t) => /currently unavailable|access denied|are you a robot|verify you are (a )?human|unusual traffic/i.test(t);
  const SIZE = /\b(\d{3})\/(\d{2})(?:-|\s*Z?R)(\d{2})\b/g;
  const norm = (m) => m[1] + '/' + m[2] + 'R' + m[3];
  const settle = async (ok, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = text(); if (refused(t) || ok(t)) return t; await sleep(400); } return text(); };

  if (args.step === 'size') {
    const t = await settle((t) => /factory tire size/i.test(t) || /error=noVehicle/.test(location.href), 20000);
    if (refused(t)) { send({ blocked: true }); return; }
    if (/error=|noVehicle/i.test(location.href) || !/factory tire size/i.test(t)) { send({ unknown: true }); return; }
    // Sections start at each heading; the tab labels ("Factory Tire Size Optional Tire Sizes Custom Tire Size") are
    // headings with no sizes after them, so they add nothing. Sizes under "Factory" headings are the factory ones.
    const HEAD = /factory tire size|optional tire sizes?|custom tire size|need help|view results/gi;
    const marks = []; let h; HEAD.lastIndex = 0;
    while ((h = HEAD.exec(t))) marks.push({ at: h.index, end: h.index + h[0].length, kind: /factory/i.test(h[0]) ? 'f' : /optional/i.test(h[0]) ? 'o' : 'x' });
    const factory = [], optional = [];
    marks.forEach((mk, n) => {
      const seg = t.slice(mk.end, n + 1 < marks.length ? marks[n + 1].at : mk.end + 600);
      let m; SIZE.lastIndex = 0;
      while ((m = SIZE.exec(seg))) { const z = norm(m); if (mk.kind === 'f' && factory.indexOf(z) < 0) factory.push(z); else if (mk.kind === 'o' && optional.indexOf(z) < 0) optional.push(z); }
    });
    send({ factory: factory, optional: optional.filter((x) => factory.indexOf(x) < 0).slice(0, 12) });
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
