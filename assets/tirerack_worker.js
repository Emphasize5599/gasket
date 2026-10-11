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
  let sent = false;
  const started = Date.now();
  const send = (o) => {
    if (sent) return;
    sent = true;
    if (o.error || o.blocked || o.unknown) o.detail = Object.assign({ step: args.step, url: location.href, title: document.title, elapsedMs: Date.now() - started }, o.detail || {});
    GasketSite.result(reqId, JSON.stringify(o));
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // A WebView fetch can otherwise remain pending indefinitely when Tire Rack drops a
  // vehicle-picker request.  Always answer Gasket so the lookup can be retried.
  const fetchText = async (url) => {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    let timer;
    try {
      // Cover response headers AND its body. Abort alone does not guarantee the promise settles.
      return await Promise.race([
        (async () => {
          const r = await fetch(url, { credentials: 'include', signal: controller ? controller.signal : undefined });
          const body = await r.text();
          const detail = { requestUrl: url, responseUrl: r.url || url, status: r.status, excerpt: body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 240) };
          if (refused(body) || r.status === 403 || r.status === 429) throw Object.assign(new Error('Tire Rack restricted this request'), { blocked: true, code: 'blocked', detail: detail });
          if (!r.ok && r.status !== 204) throw Object.assign(new Error('HTTP ' + r.status), { code: 'http', detail: detail });
          return body;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { reject(Object.assign(new Error('Tire Rack request timed out'), { code: 'timeout', detail: { requestUrl: url } })); if (controller) controller.abort(); }, 18000); })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const fail = (e) => send({ error: String(e && e.message || e).slice(0, 160), code: e.code || 'network', blocked: !!e.blocked, detail: e.detail });
  const text = () => (document.body && document.body.innerText) || '';
  const refused = (t) => /currently unavailable|access denied|are you a robot|verify (?:that )?you are (?:a )?human|unusual traffic|request (?:was )?(?:blocked|rejected)|automated (?:requests|access)|security (?:check|verification)|pardon our interruption|enable javascript and cookies to continue|too many requests/i.test(t);
  const pageBlocked = () => refused(text()) || /access denied|captcha|robot|just a moment|security check/i.test(document.title || '') || /\/(blocked|sorry)\//i.test(location.href);
  const SIZE = /\b(\d{3})\/(\d{2})(?:-|\s*Z?R)(\d{2})\b/g;
  const norm = (m) => m[1] + '/' + m[2] + 'R' + m[3];
  const settle = async (ok, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = text(); if (pageBlocked() || ok(t)) return t; await sleep(400); } return text(); };

  // Tire Rack's vehicle picker: the same service its own "select your vehicle" menus ask, from its own page and with the
  // page's cookies (nothing gotten around). It answers in small XML lists: <models><model>…, <clarifiers><clar>….
  // Asked gently: one request at a time, a pause in between (fast bursts get "currently unavailable").
  const V = '/survey/ValidationServlet?';
  const ask = async (q) => {
    return fetchText(V + q);
  };
  const tags = (xml, tag) => {
    if (!/^\s*(<\?xml[^>]*>\s*)?<[a-z]/i.test(xml || '') || /<html/i.test(xml || '')) return null;      // not one of its lists
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const container = { model: 'models', make: 'makes', clar: 'clarifiers' }[tag];
    if (doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagName(container).length) return null;
    return Array.from(doc.getElementsByTagName(tag)).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  };
  const enc = encodeURIComponent;
  const pickerStep = async () => {
    await settle((t) => t.length > 200, 15000);
    if (pageBlocked()) { send({ blocked: true, code: 'blocked', error: 'Tire Rack restricted this page' }); return; }
    try {
      if (args.step === 'models') {
        // the make as Tire Rack spells it ("RAM", "MINI", "Mercedes-Benz"): asked only when the first try finds nothing
        let make = args.make, models = tags(await ask('autoYear=' + enc(args.year) + '&autoMake=' + enc(make) + '&newDesktop=true'), 'model');
        if (models === null) { send({ error: 'Tire Rack model response was not a list', code: 'unreadable' }); return; }
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
          if (list === null) { send({ error: 'Tire Rack trim response was not a list', code: 'unreadable', clars: out }); return; }
          out[model] = list.slice(0, 60);
        }
        send({ clars: out });
        return;
      }
    } catch (e) { fail(e); return; }
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
    const t = await settle((t) => readSizes(t).factory.length || /error=noVehicle/.test(location.href), 20000);
    if (pageBlocked()) { send({ blocked: true, code: 'blocked', error: 'Tire Rack restricted this page' }); return; }
    if (/error=noVehicle/i.test(location.href)) { send({ unknown: true }); return; }
    const sizes = readSizes(t);
    if (!sizes.factory.length) { send({ error: 'Tire Rack did not provide a readable factory size', code: 'unreadable', detail: { excerpt: t.slice(0, 240) } }); return; }
    send(sizes);
    return;
  }

  if (args.step === 'oesize') {
    // A model with no versions ("Mustang Coupe"): SelectTireSize.jsp only says "currently unavailable" for these, so this
    // does what Tire Rack's own vehicle menu does: set the vehicle, then read its "select your tire size" panel.
    await settle((t) => t.length > 200, 15000);
    if (pageBlocked()) { send({ blocked: true, code: 'blocked', error: 'Tire Rack restricted this page' }); return; }
    const q = 'modClarLookUpCompleted=false&mmycPAX=false&cameFrom=vehicleSelector&performance=&search=tire&index=0&autoYear=' + enc(args.year) +
      '&autoMake=' + enc(args.make) + '&autoModel=' + enc(args.model) + '&autoModClar=' + enc(args.clar || '') + '&zip-code=';
    try {
      const body = await fetchText('/SetCurrentVehicleServlet?ajax=true&' + q);
      let j = null; try { j = JSON.parse(body); } catch (e) { /* not its answer */ }
      if (!j || j.vehicleZipSet !== 'success') { send(j && j.vehicleZipSet === 'redirect' ? { unknown: true } : { error: 'vehicle not set' }); return; }
      await sleep(900);
      const html = await fetchText('/modalPopups/selectOETireSize.jsp?' + q);
      const t = (new DOMParser().parseFromString(html, 'text/html').body.textContent || '').replace(/\s+/g, ' ');
      // the panel names the vehicle it's for; if it isn't this one, the vehicle didn't take
      const key = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!/factory tire size/i.test(t) || key(t).indexOf(key(args.year + ' ' + args.make + ' ' + args.model)) < 0) { send({ unknown: true }); return; }
      send(readSizes(t));
    } catch (e) { fail(e); }
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
    if (pageBlocked()) { send({ blocked: true, code: 'blocked', error: 'Tire Rack restricted this page' }); return; }
    readPage(t);
    if (!out.length && !/no tires|no results/i.test(t)) { send({ error: 'Tire Rack tire list could not be read', code: 'unreadable', detail: { excerpt: t.slice(0, 240) } }); return; }
    // more pages: follow "next" while there is one (at most 10 pages)
    let doc = document;
    const visited = new Set([location.href]);
    for (let page = 2; page <= 10 && Date.now() - started < 55000; page++) {
      const next = Array.from(doc.querySelectorAll('a')).find((e) => /^(next(?: page)?|›|>|»)$/i.test((e.textContent || e.getAttribute('aria-label') || '').trim()) && e.getAttribute('href'));
      if (!next) break;
      const url = new URL(next.getAttribute('href'), location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/tires/') || visited.has(url.href)) break;
      visited.add(url.href);
      const before = out.length;
      try {
        await sleep(800);
        doc = new DOMParser().parseFromString(await fetchText(url.href), 'text/html');
        // Preserve block boundaries as newlines, as innerText does in the live page.
        doc.querySelectorAll('p,div,li,br,h1,h2,h3').forEach((e) => e.appendChild(doc.createTextNode('\n')));
        t = doc.body.textContent || '';
      } catch (e) { send({ tires: out, partial: true, blocked: !!e.blocked, error: e.message, code: e.code, detail: e.detail }); return; }
      readPage(t);
      if (out.length === before) break;
    }
    send({ tires: out.slice(0, 300), empty: out.length === 0 });
    return;
  }
  send({ error: 'unknown step' });
}
