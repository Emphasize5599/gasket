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

  // Tire Rack's own names for a model's versions (autoModClar=…), from the links, buttons and menus on the page; when there
  // are none, a short description of the page for the debug log (no personal data on it).
  const readTrims = (t) => {
    const out = [];
    const add = (v) => { v = String(v || '').replace(/\s+/g, ' ').trim(); if (v && v.length < 60 && !/^(select|choose|--|please)/i.test(v) && out.indexOf(v) < 0) out.push(v); };
    const base = /^https?:/.test(location.href) ? location.href : 'https://www.tirerack.com/';
    const clarOf = (u) => { try { const q = new URL(u, base).searchParams; for (const [k, v] of q) if (/modclar/i.test(k)) return v; } catch (e) { } const m = /modclar=([^&'"]+)/i.exec(u || ''); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; };
    // links and buttons that carry the version (href, onclick, data-…)
    document.querySelectorAll('a[href], [onclick], [data-href], [data-url], [data-value]').forEach((e) => {
      const s = [e.getAttribute('href'), e.getAttribute('onclick'), e.getAttribute('data-href'), e.getAttribute('data-url')].filter(Boolean).join(' ');
      if (/modclar/i.test(s)) add(clarOf(s.split(' ').filter((x) => /modclar/i.test(x))[0] || s) || e.textContent);
    });
    // menus and option lists for the version
    document.querySelectorAll('select').forEach((sel) => { if (/clar|trim|addl|additional|option|vehicle/i.test((sel.name || '') + ' ' + (sel.id || '') + ' ' + (sel.className || ''))) sel.querySelectorAll('option').forEach((o) => add(o.value && !/^\d*$/.test(o.value) ? o.value : o.textContent)); });
    document.querySelectorAll('input[type=radio], input[type=hidden]').forEach((i) => { if (/modclar/i.test(i.name || '')) add(i.value); });
    document.querySelectorAll('[data-modclar], [data-autoModClar]').forEach((e) => add(e.getAttribute('data-modclar') || e.getAttribute('data-autoModClar')));
    // nothing found: what the page looked like, for the debug log (no personal data on it)
    const debug = out.length ? null : { url: location.pathname + location.search.slice(0, 160), title: document.title.slice(0, 80), text: t.replace(/\s+/g, ' ').slice(0, 500),
      selects: [...document.querySelectorAll('select')].slice(0, 8).map((s) => (s.name || s.id || s.className || '?') + ':' + s.options.length),
      clarMentions: (document.documentElement.innerHTML.match(/modclar[^"'&<>]{0,40}/gi) || []).slice(0, 8),
      scripts: (() => { const out = []; document.querySelectorAll('script').forEach((sc) => { const x = sc.textContent || ''; let i = x.search(/vehicleSearch|modclar/i); while (i >= 0 && out.length < 4) { out.push(x.slice(Math.max(0, i - 250), i + 350).replace(/\s+/g, ' ')); const j = x.slice(i + 350).search(/vehicleSearch|modclar/i); i = j < 0 ? -1 : i + 350 + j; } }); return out; })(),
      endpoints: [...new Set((document.documentElement.innerHTML.match(/["'](\/[A-Za-z0-9_\/.-]*(?:Servlet|\.jsp|\/api\/|vehicle)[A-Za-z0-9_\/.-]*)/gi) || []).map((x) => x.slice(1)))].slice(0, 20) };
    return { trims: out.slice(0, 40), debug: debug };
  };

  if (args.step === 'size') {
    const t = await settle((t) => /factory tire size/i.test(t) || /error=noVehicle/.test(location.href), 20000);
    if (refused(t)) { send({ blocked: true }); return; }
    if (/error=|noVehicle/i.test(location.href) || !/factory tire size/i.test(t)) { const r = readTrims(t); if (!r.trims.length) { const p = await askPicker(); if (p.trims.length) r.trims = p.trims; else if (r.debug) r.debug.picker = p.note; } send({ unknown: true, trims: r.trims, debug: r.trims.length ? null : r.debug }); return; }   // the page may list the versions it does know
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

  // The vehicle picker's own service (the site's script asks it for a model's versions): same page, same cookies, nothing
  // gotten around. Reads whatever list comes back (XML, JSON or HTML options). -> { trims, note }
  const askPicker = async () => {
    if (!args.make || !args.year || !args.model) return { trims: [], note: 'no car' };
    const q = 'autoYear=' + encodeURIComponent(args.year) + '&autoMake=' + encodeURIComponent(args.make) + '&autoModel=' + encodeURIComponent(args.model);
    const notes = [], found = [];
    const add = (v) => { v = String(v || '').replace(/\s+/g, ' ').trim(); if (v && v.length < 60 && !/^(select|choose|--|please|additional)/i.test(v) && found.indexOf(v) < 0) found.push(v); };
    for (const path of ['/survey/ValidationServlet?' + q, '/survey/ValidationServlet?' + q + '&autoModClar=']) {
      try {
        const r = await fetch(path, { credentials: 'include' }); const body = await r.text();
        notes.push(path.split('?')[0] + ' ' + r.status + ' ' + (r.headers.get('content-type') || '') + ' ' + body.replace(/\s+/g, ' ').slice(0, 300));
        if (!r.ok || refused(body)) continue;
        if (/^\s*[\[{]/.test(body)) { const walk = (o, key) => { if (Array.isArray(o)) o.forEach((x) => walk(x, key)); else if (o && typeof o === 'object') Object.keys(o).forEach((k) => walk(o[k], k)); else if (typeof o === 'string' && /clar|trim|name|value|label/i.test(key || '')) add(o); }; walk(JSON.parse(body), ''); }
        else {
          const doc = new DOMParser().parseFromString(body, /<\?xml|^\s*<[a-z]+>/i.test(body) && !/<html/i.test(body) ? 'text/xml' : 'text/html');
          doc.querySelectorAll('*').forEach((e) => { if (/clar|trim/i.test(e.tagName) && !e.children.length) add(e.textContent); if (/clar/i.test(e.getAttribute && (e.getAttribute('name') || '') || '')) add(e.getAttribute('value') || e.textContent); });
          doc.querySelectorAll('option').forEach((o) => add(o.getAttribute('value') && !/^\d*$/.test(o.getAttribute('value')) ? o.getAttribute('value') : o.textContent));
        }
        if (found.length) break;
      } catch (e) { notes.push(path.split('?')[0] + ' error ' + String(e).slice(0, 80)); }
    }
    return { trims: found.slice(0, 40), note: notes.join(' | ').slice(0, 900) };
  };

  if (args.step === 'trims') {
    // The size page without a trim: Tire Rack asks which version it is. If it goes straight to the factory sizes, there's only one.
    const t = await settle((t) => /factory tire size|modclar/i.test(t + document.documentElement.innerHTML.slice(0, 200000)) || /error=noVehicle/.test(location.href), 20000);
    if (refused(t)) { send({ blocked: true }); return; }
    const r = readTrims(t);
    if (!r.trims.length) { const p = await askPicker(); if (p.trims.length) { send({ trims: p.trims, src: 'picker' }); return; } if (r.debug) r.debug.picker = p.note; }
    send({ trims: r.trims, single: !r.trims.length && /factory tire size/i.test(t), debug: r.debug });
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
