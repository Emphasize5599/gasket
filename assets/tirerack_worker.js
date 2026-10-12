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
    const CAT = /(?:all[ -]season|summer|winter|snow|all[ -]weather|all[ -]terrain|mud[ -]terrain|highway|touring|performance|ice|competition|trailer|spare)/i;
    const stateKey = '__gasketTireCatalogV4';
    let state = { id: reqId, started: Date.now(), tires: [], pages: [], expanded: false, rejected: {} };
    try { const old = JSON.parse(sessionStorage.getItem(stateKey) || 'null'); if (old && old.id === reqId) state = old; } catch (_) {}
    const identity = (p) => p.partnum ? 'part:' + p.partnum : p.name.toLowerCase() + '|' + (p.serviceDesc || '') + '|' + (p.loadRange || '');
    const out = state.tires, seen = new Map(out.map((p) => [identity(p), p]));
    let requestedSize = '';
    try {
      const u = new URL(args.url || location.href), w = (u.searchParams.get('width') || '').replace(/\D/g, ''), r = u.searchParams.get('ratio'), d = u.searchParams.get('diameter');
      if (w && r && d) requestedSize = w + '/' + r + 'R' + d;
    } catch (_) {}
    const persist = () => { try { sessionStorage.setItem(stateKey, JSON.stringify(state)); } catch (_) {} };
    const finish = (extra) => {
      try { sessionStorage.removeItem(stateKey); } catch (_) {}
      send(Object.assign({ tires: out.slice(0, 300), empty: out.length === 0, catalogVersion: 4,
        detail: { expected: count(text()), read: out.length, uniqueModels: new Set(out.map((p) => p.name.toLowerCase())).size, pages: state.pages.length,
          perPage: state.perPage || null, rejected: Object.values(state.rejected || {}).slice(0, 12) } }, extra || {}));
    };
    const pageText = (doc) => {
      if (doc === document) return text();
      const copy = doc.body.cloneNode(true);
      copy.querySelectorAll('script,style,template').forEach((e) => e.remove());
      copy.querySelectorAll('p,div,li,br,h1,h2,h3,dt,dd,td,ul,ol,article,section').forEach((e) => {
        e.before(copy.ownerDocument.createTextNode('\n'));
        e.appendChild(copy.ownerDocument.createTextNode('\n'));
      });
      return copy.textContent || '';
    };
    const metadata = (t) => {
      let m;
      const size = /\bSize\s*:\s*((?:P|LT)?\d{3}\/\d{2}(?:Z?R|-)\d{2})/i.exec(t);
      const u = /\bUTQG\s*:\s*(\d{2,4})\s*(AA|A|B|C)\s+(A|B|C)\b/i.exec(t);
      const service = /(?:Serv\.?\s*Desc\.?|Service Description)\s*:\s*(\d{2,3}(?:\/\d{2,3})?\s*\(?[A-Z]\)?)/i.exec(t);
      const load = /Load Range\s*:\s*([a-z0-9]+)/i.exec(t);
      let warranty = 0;
      if ((m = /\b(\d{2,3}(?:\.\d+)?)\s*K\s*(?:mile|mi\b)[\s\S]{0,35}?(?:warranty|manufacturer)/i.exec(t))) warranty = Math.round(+m[1] * 1000);
      else if ((m = /\b(\d{2,3},\d{3}|\d{5,6})[ -]*(?:mile|mi\b)[\s\S]{0,35}?(?:warranty|manufacturer)/i.exec(t))) warranty = +m[1].replace(/,/g, '');
      return { size: size ? size[1].replace(/^(P|LT)/i, '').replace('-', 'R').toUpperCase() : '', serviceDesc: service ? service[1].replace(/\s/g, '').toUpperCase() : '', loadRange: load ? load[1].toUpperCase() : '', utqg: u ? { tw: +u[1], trac: u[2].toUpperCase(), temp: u[3].toUpperCase() } : null, warrantyMi: warranty };
    };
    const add = (p) => {
      if (!p.size || !p.type || (requestedSize && p.size !== requestedSize)) return;
      const key = identity(p), old = seen.get(key);
      if (old) { if (!old.utqg && p.utqg) old.utqg = p.utqg; if (!old.warrantyMi && p.warrantyMi) old.warrantyMi = p.warrantyMi; return; }
      seen.set(key, p); out.push(p);
    };
    const product = (a) => {
      try {
        const u = new URL(a.getAttribute('href'), location.href);
        const brand = u.searchParams.get('tireMake'), model = u.searchParams.get('tireModel');
        return u.pathname === '/tires/tires.jsp' && brand && model ? { name: brand + ' ' + model, brand: brand, model: model, partnum: u.searchParams.get('partnum') || '' } : null;
      } catch (_) { return null; }
    };
    const readDOM = (doc) => {
      let cards = 0;
      // Read each product's own card. Link parameters supply names regardless of CSS capitals or split brand/model lines.
      doc.querySelectorAll('a[href]').forEach((a) => {
        const p = product(a); if (!p) return;
        let reason = 'No product card with a size was found', excerpt = '';
        for (let box = a.parentElement; box && box !== doc.body; box = box.parentElement) {
          const products = Array.from(box.querySelectorAll('a[href]')).map(product).filter(Boolean);
          const names = new Set(products.map((p) => p.name.toLowerCase()));
          if (names.size > 1) break; // never take a rating or warranty from a different model
          const t = doc === document ? box.innerText || box.textContent || '' : pageText({ body: box });
          if (new Set(products.map(identity)).size > 1) {
            // A primary card also links to other OE variants. Those links are not independent
            // cards. Read this card only for its heading's SKU and only when it has one size block.
            // Multiple actual variant rows must still be parsed separately, with their own ratings.
            const heading = box.querySelector('h1 a[href],h2 a[href],h3 a[href],h4 a[href]');
            const lead = heading && product(heading);
            if (!lead || identity(lead) !== identity(p) || (t.match(/\bSize\s*:/gi) || []).length !== 1) continue;
          }
          const meta = metadata(t); if (!meta.size) continue;
          if (requestedSize && meta.size !== requestedSize) { reason = 'Different size: ' + meta.size; break; }
          const categoryText = (s) => s.length < 70 && CAT.test(s) && s.toLowerCase() !== p.name.toLowerCase() && !/warranty|test|review|rating|chart|compare/i.test(s);
          let category = Array.from(box.querySelectorAll('a')).filter((e) => !product(e)).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).find(categoryText);
          if (!category) category = Array.from(box.querySelectorAll('[class*="category" i],[class*="tiretype" i],[data-category]')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).find(categoryText);
          if (!category) category = t.split('\n').map((s) => s.trim().replace(/^Tire Category\s*:\s*/i, '')).find((s) => categoryText(s) && /^(?:(?:grand|standard|crossover|highway|ultra|high|max|extreme|street|track|on[ -]road|off[ -]road|commercial|rugged|light truck|performance|studless|studdable|winter|temporary|special)|all[ -])/i.test(s));
          if (category) { cards++; add(Object.assign({}, p, meta, { type: category })); delete state.rejected[identity(p)]; break; }
          reason = 'Category missing'; excerpt = t.replace(/\s+/g, ' ').slice(0, 240);
        }
        if (!Array.from(seen.values()).some((x) => (p.partnum && x.partnum === p.partnum) || (!p.partnum && x.name.toLowerCase() === p.name.toLowerCase()))) state.rejected[identity(p)] = { name: p.name, partnum: p.partnum, reason: reason, excerpt: excerpt };
      });
      return cards;
    };
    const readPage = (t) => {
      const L = t.split('\n').map((s) => s.trim()).filter(Boolean);
      for (let n = 0; n < L.length; n++) {
        const name = L[n], cat = L[n + 1] || '';
        if (!/\s/.test(name) || name.length > 90 || !/^[a-z0-9][a-z0-9 .&+'®™\-\/]{3,89}$/i.test(name) || !CAT.test(cat) || cat.length > 70 || /chart|review|rating/i.test(cat)) continue;
        let end = n + 2;
        while (end < Math.min(L.length, n + 100)) {
          if (end > n + 2 && CAT.test(L[end + 1] || '') && /^[a-z0-9][a-z0-9 .&+'®™\-\/]{3,89}$/i.test(L[end]) && !/chart|review|rating/i.test(L[end + 1])) break;
          end++;
        }
        add(Object.assign({ name: name, type: cat }, metadata(L.slice(n + 2, end).join('\n'))));
      }
    };
    const read = (doc) => { if (!readDOM(doc)) readPage(pageText(doc)); };
    const count = (t) => { const m = /(?:we have|showing)\s+(\d+)\s+tire models|showing\s+\d+\s*[-–]\s*\d+\s+of\s+(\d+)/i.exec(t); return m ? +(m[1] || m[2]) : 0; };
    let t = await settle((t) => /\bSize\s*:\s*(?:P|LT)?\d{3}\//i.test(t) || /no tires|no results/i.test(t), 20000);
    if (pageBlocked()) { finish({ blocked: true, code: 'blocked', error: 'Tire Rack restricted this page' }); return; }
    // Use the site's actual page-size control instead of assuming all products are initially rendered.
    const perPage = Array.from(document.querySelectorAll('select')).find((e) => /results.?per.?page|items.?per.?page|page.?size|^rpp$/i.test(e.name + ' ' + e.id) || /results per page/i.test((e.parentElement && e.parentElement.textContent || '').slice(0, 300)));
    if (perPage && !state.expanded) {
      state.perPage = { name: perPage.name, id: perPage.id, value: perPage.value, options: Array.from(perPage.options).map((o) => ({ value: o.value, text: o.textContent.trim() })) };
      state.expanded = true; persist();
      const choices = Array.from(perPage.options).filter((o) => !o.disabled).sort((a, b) => (/all/i.test(b.textContent) ? 10000 : parseInt(b.textContent, 10) || 0) - (/all/i.test(a.textContent) ? 10000 : parseInt(a.textContent, 10) || 0));
      const best = choices[0];
      if (best && best.value !== perPage.value) {
        perPage.value = best.value; perPage.dispatchEvent(new Event('change', { bubbles: true }));
        const go = Array.from((perPage.parentElement || document).querySelectorAll('button,input[type="button"],input[type="submit"]')).find((e) => /^go$/i.test((e.textContent || e.value || '').trim()));
        if (go) go.click();
        await sleep(1200); // if it navigates, Android reinjects the reader and restores the per-request state
      }
    }
    read(document);
    const fingerprint = () => JSON.stringify(out);
    let stable = 0, last = fingerprint();
    // Allow lazy cards AND their metadata to arrive, including products with no UTQG (winter tires).
    while (Date.now() - state.started < 35000 && stable < (count(text()) > out.length ? 6 : 2)) {
      if (pageBlocked()) { finish({ partial: !!out.length, blocked: true, code: 'blocked', error: 'Tire Rack restricted this page' }); return; }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(600); read(document);
      const now = fingerprint(); stable = now === last ? stable + 1 : 0; last = now;
    }
    t = text();
    if (!out.length && !/no tires|no results/i.test(t)) { finish({ error: 'Tire Rack tire list could not be read', code: 'unreadable', detail: { excerpt: t.slice(0, 240) } }); return; }
    let doc = document;
    if (!state.pages.includes(location.href)) state.pages.push(location.href);
    for (let page = state.pages.length; page < 10 && Date.now() - state.started < 55000; page++) {
      const next = Array.from(doc.querySelectorAll('a,button,input[type="button"],input[type="image"]')).find((e) => !e.disabled && e.getAttribute('aria-disabled') !== 'true' && (doc !== document || e.getClientRects().length) && (/^(?:(?:go to )?next(?: page)?(?:\s*[›>»→])?|load more|show more(?: tires)?|›|>|»|→)$/i.test((e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('alt') || e.textContent || e.value || (e.querySelector('img') && e.querySelector('img').alt) || '').trim()) || e.getAttribute('rel') === 'next'));
      if (!next) break;
      const before = out.length;
      try {
        await sleep(800);
        const href = next.getAttribute('href');
        if (href && !/^#|^javascript:/i.test(href)) {
          const url = new URL(href, state.pages[state.pages.length - 1] || location.href);
          if (url.origin !== location.origin || !url.pathname.startsWith('/tires/') || state.pages.includes(url.href)) break;
          state.pages.push(url.href); persist();
          doc = new DOMParser().parseFromString(await fetchText(url.href), 'text/html'); read(doc);
        } else if (doc === document) {
          persist(); next.click();
          for (let n = 0; n < 16 && out.length === before; n++) { await sleep(500); if (pageBlocked()) throw Object.assign(new Error('Tire Rack restricted this page'), { blocked: true, code: 'blocked' }); read(document); }
        } else break;
      } catch (e) { finish({ partial: true, blocked: !!e.blocked, error: e.message, code: e.code, detail: e.detail }); return; }
      if (out.length === before) { finish({ partial: true, code: 'incomplete', error: 'Tire Rack did not load the next results' }); return; }
    }
    const expected = count(pageText(doc)) || count(text());
    const rejected = Object.values(state.rejected).filter((p) => p.reason.indexOf('Different size:') !== 0);
    finish(expected > out.length ? { partial: true, code: 'incomplete', error: 'Only ' + out.length + ' of ' + expected + ' tire options could be read' } : !expected && rejected.length ? { partial: true, code: 'incomplete', error: rejected.length + ' product cards could not be read' } : {});
    return;
  }
  send({ error: 'unknown step' });
}
