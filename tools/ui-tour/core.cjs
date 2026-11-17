// The demo walk: four demo vehicles, fixture stations on the map, and a mocked trip. On each screen it
// expands every tile, saves it, tries each option that can reveal other controls (switches, segmented
// choices, radios, short dropdowns) and walks into every submenu entrance, a few levels deep.
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const { capture } = require('./store.cjs');
const ROOT = path.resolve(__dirname, '../..'), WEB = path.join(ROOT, 'assets/web/index.html');
const ENTRANCES = '.sub-ent, [data-rest-manage], [data-rest-settings], #advTowHelp, #licOpen, [data-sub-help]';
const SKIP = '#gemmaToggle, #gemmaDownload, #gemmaRemove, [data-k="debug"], #sErase, #sClearCache, #sBackup, #sRestore, #sExport, #sImport, #evDownload, #ridbDownload, [data-k="hereTraffic"], #gRemove, .x, #tClose';
let dir, log = () => {};
const wait = (p, ms = 300) => p.waitForTimeout(ms);
const cap = (p, note) => capture(p, dir, 'demo tour', note);
// which screen is on top, as a short key
const top = p => p.evaluate(() => {
  const vis = e => e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none';
  const c = document.getElementById('cfm'); if (vis(c)) return 'cfm';
  if ([...document.querySelectorAll('.app-picker')].some(vis)) return 'picker';
  const subs = [...document.querySelectorAll('.page.sub-page')].filter(vis); if (subs.length) return 'sub' + subs.length + ':' + (subs[subs.length - 1].querySelector('h2') || {}).textContent;
  for (const id of ['onboarding', 'settings', 'blPage', 'licPage', 'trip', 'detail']) if (vis(document.getElementById(id))) return id + (id === 'settings' ? ':' + ((document.querySelector('.settings-group:not(.hidden)') || {}).dataset || {}).settingsView : '') + (id === 'trip' ? ':' + __trip.state().step : '');
  return 'map';
});
const surfaceEval = (p, fn, arg) => p.evaluate(([fn, arg]) => {
  const vis = e => e && e.isConnected && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  const order = ['#cfm', '.app-picker', '.page.sub-page', '#onboarding', '#settings', '#blPage', '#licPage', '#trip', '#detail'];
  let s = null; for (const sel of order) { const all = [...document.querySelectorAll(sel)].filter(vis); if (all.length) { s = all[all.length - 1]; break; } }
  return (0, eval)('(' + fn + ')')(s || document.body, vis, arg);
}, [String(fn), arg]);
async function expand(p) {
  await surfaceEval(p, s => { s.querySelectorAll('details:not([open])').forEach(d => { if (!d.closest('.hidden')) d.open = true; }); });
  await wait(p, 250);
}
async function back(p, before) {
  for (let i = 0; i < 4; i++) {
    const t = await top(p); if (t === before) return true;
    if (t === 'cfm') await p.evaluate(() => (document.getElementById('cfmNo') || document.getElementById('cfmYes')).click());
    else if (t === 'picker') await p.keyboard.press('Escape');
    else if (t.startsWith('sub')) await p.evaluate(() => { const b = [...document.querySelectorAll('.page.sub-page .sub-back')].pop(); if (window.__subClose) window.__subClose(true); else if (b) b.click(); });
    else if (t.startsWith('settings:') && before.startsWith('settings')) await p.evaluate(() => { const b = document.getElementById('settingsBack'); if (b) b.click(); });
    else if (t === 'blPage' || t === 'licPage') await p.evaluate(t => document.getElementById(t).classList.add('hidden'), t);
    else return false;
    await wait(p, 250);
  }
  return (await top(p)) === before;
}
// Options that may reveal other controls: try each, save, put it back.
async function variants(p, note, max = 40) {
  const list = await surfaceEval(p, (s, vis, skip) => {
    const out = [];
    s.querySelectorAll('input[type=checkbox], input[type=radio], .seg button, select').forEach((e, i) => {
      if (e.closest(skip) || e.matches(skip) || e.disabled) return;
      const shown = vis(e) || (e.closest('label') && vis(e.closest('label')));
      if (!shown) return;
      if (e.tagName === 'SELECT' && (e.options.length < 2 || e.options.length > 8)) return;
      if (e.type === 'radio' && e.checked) return;
      if (e.matches('.seg button') && (e.classList.contains('on') || e.getAttribute('aria-pressed') === 'true')) return;
      e.setAttribute('data-tour-v', String(i)); out.push(i);
    });
    return out;
  }, SKIP);
  let n = 0;
  for (const i of list.slice(0, max)) {
    const before = await top(p);
    const r = await p.evaluate(i => {
      const e = document.querySelector('[data-tour-v="' + i + '"]'); if (!e) return null;
      const count = () => [...document.querySelectorAll('input,select,button,textarea,h3,h4,summary')].filter(x => x.getClientRects().length).length;
      const c0 = count();
      if (e.tagName === 'SELECT') { const old = e.value; const opts = [...e.options].map(o => o.value).filter(v => v !== old); return { kind: 'select', old, opts, c0 }; }
      if (e.type === 'checkbox') { e.click(); return { kind: 'box', c0 }; }
      const prev = e.type === 'radio' ? [...document.querySelectorAll('input[type=radio][name="' + e.name + '"]')].find(x => x.checked) : e.parentElement.querySelector('.on, [aria-pressed="true"]');
      if (prev) prev.setAttribute('data-tour-prev', i);
      e.click(); return { kind: 'choice', c0 };
    }, i).catch(() => null);
    if (!r) continue;
    if (r.kind === 'select') {
      for (const v of r.opts) {
        await p.evaluate(([i, v]) => { const e = document.querySelector('[data-tour-v="' + i + '"]'); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } }, [i, v]).catch(() => {});
        await wait(p, 350);
        const changed = (await top(p)) !== before || await p.evaluate(c0 => [...document.querySelectorAll('input,select,button,textarea,h3,h4,summary')].filter(x => x.getClientRects().length).length !== c0, r.c0);
        if (changed && await cap(p, note + ' · option')) n++; await back(p, before);
      }
      await p.evaluate(([i, v]) => { const e = document.querySelector('[data-tour-v="' + i + '"]'); if (e) { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); } }, [i, r.old]).catch(() => {});
      await wait(p, 250); continue;
    }
    await wait(p, 400);
    const changed = (await top(p)) !== before || await p.evaluate(c0 => [...document.querySelectorAll('input,select,button,textarea,h3,h4,summary')].filter(x => x.getClientRects().length).length !== c0, r.c0);
    if (changed) { await expand(p); if (await cap(p, note + ' · option')) n++; }
    if ((await top(p)) !== before) { await back(p, before); }
    await p.evaluate(i => {
      const e = document.querySelector('[data-tour-v="' + i + '"]');
      if (e && e.type === 'checkbox') { e.click(); return; }
      const prev = document.querySelector('[data-tour-prev="' + i + '"]'); if (prev) { prev.removeAttribute('data-tour-prev'); prev.click(); }
    }, i).catch(() => {});
    await wait(p, 300);
    if ((await top(p)) !== before) await back(p, before);
  }
  return n;
}
// Save this screen, its options, then each submenu entrance (depth levels).
async function crawl(p, note, depth = 3, opts = {}) {
  await expand(p); await cap(p, note);
  if (opts.variants !== false) await variants(p, note, opts.max);
  if (depth <= 0) return;
  const here = await top(p);
  const n = await surfaceEval(p, (s, vis, sel) => { let k = 0; s.querySelectorAll(sel).forEach(e => { if (vis(e)) e.setAttribute('data-tour-e', String(k++)); }); return k; }, ENTRANCES + '|||').catch(() => 0);
  const count = n || await surfaceEval(p, (s, vis, sel) => { let k = 0; s.querySelectorAll(sel).forEach(e => { if (vis(e) && !e.closest('[data-tour-skip]')) e.setAttribute('data-tour-e', String(k++)); }); return k; }, ENTRANCES);
  for (let k = 0; k < Math.min(count, 30); k++) {
    const ok = await p.evaluate(k => { const e = document.querySelector('[data-tour-e="' + k + '"]'); if (!e) return false; e.click(); return true; }, k);
    if (!ok) continue;
    await wait(p, 500);
    const t = await top(p);
    if (t !== here) { await crawl(p, note + ' › ' + t.replace(/^sub\d+:/, ''), depth - 1, opts); await back(p, here); }
    if ((await top(p)) !== here) { log('could not return to', here, 'from', await top(p)); return; }
  }
}
async function boot(browser, fresh) {
  const p = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => log('pageerror', e.message));
  await p.route(/^https?:\/\//, r => r.abort());
  await p.addInitScript({ path: path.join(ROOT, 'tests/fixed-test-date.js') }).catch(() => {});
  await p.goto(pathToFileURL(WEB).href);
  await p.evaluate(() => { setInsets(24, 48, 0, 0); });
  await wait(p, 400);
  return p;
}
async function onboarding(p) {
  for (let i = 0; i < 8 && await p.locator('#onboarding').count(); i++) {
    await crawl(p, 'setup step ' + (i + 1), 1);
    const b = await p.evaluate(() => { const b = document.getElementById('obExplore') || document.getElementById('obNext'); if (!b || b.disabled) return false; b.click(); return true; });
    if (!b) break; await wait(p, 400);
  }
}
async function run(rawDir, browser, logger) {
  dir = rawDir; if (logger) log = logger;
  // 1. first-time setup, then the demo vehicles
  let p = await boot(browser);
  await onboarding(p);
  await p.evaluate(() => { Garage.installDemo && Garage.installDemo(); });
  await p.addScriptTag({ path: path.join(ROOT, 'tests/station-fixtures.js') });
  await p.evaluate(() => { __app.setDemo(true); const m = __app.map || window.map; const c = m && m.getCenter ? m.getCenter() : { lat: 34.75, lng: -92.29 }; __app.fetchAround(c.lat, c.lng); Tires.airDue = () => false; Climate.ackDue = () => false; });
  await wait(p, 1500);
  // 2. map, menus on it, a station's details
  await cap(p, 'main map');
  for (const sel of ['#btnMode', '#btnRefresh']) { const here = await top(p); await p.click(sel).catch(() => {}); await wait(p, 400); await cap(p, 'map menu ' + sel); await p.keyboard.press('Escape'); await p.mouse.click(200, 500); await wait(p, 300); }
  await p.evaluate(() => { const s = document.querySelector('#listSheet'); if (s) s.classList.add('open', 'full'); }); await wait(p, 300); await cap(p, 'station list');
  await p.evaluate(() => { const row = document.querySelector('#listSheet [data-id], #listSheet .row, #listSheet li'); if (row) row.click(); }); await wait(p, 600);
  if ((await top(p)) === 'detail') { await crawl(p, 'station details', 2); await p.keyboard.press('Escape'); await p.evaluate(() => { const d = document.getElementById('detail'); const x = d && d.querySelector('.x, [data-close], .close'); if (x) x.click(); }); await wait(p, 300); }
  // 3. settings, every group
  await p.click('#btnSettings'); await wait(p, 500);
  await crawl(p, 'settings', 0, { variants: false });
  const groups = await p.evaluate(() => [...document.querySelectorAll('[data-settings-group]')].map(b => b.dataset.settingsGroup));
  for (const g of groups) {
    await p.click('[data-settings-group="' + g + '"]'); await wait(p, 400);
    await crawl(p, 'settings · ' + g, 2);
    await p.evaluate(() => { const b = document.getElementById('settingsBack'); if (b) b.click(); }); await wait(p, 300);
  }
  await p.evaluate(() => { const d = document.getElementById('sDone') || document.getElementById('settingsDone'); if (d) d.click(); }); await wait(p, 400);
  if ((await top(p)).startsWith('settings')) await p.evaluate(() => __app.closeSettings && __app.closeSettings());
  await p.evaluate(() => ['licPage', 'blPage'].forEach(i => document.getElementById(i).classList.add('hidden')));
  // 4. Garage and Advisory for each demo vehicle
  await p.evaluate(() => document.getElementById('btnTrip').click()); await wait(p, 800);
  const cars = await p.evaluate(() => __app.S.cars.map(c => c.id));
  for (const id of cars) {
    await p.evaluate(id => { __app.S.carId = id; __app.save && __app.save(); document.dispatchEvent(new CustomEvent('garagechange')); __trip.step(1); }, id); await wait(p, 900);
    await crawl(p, 'garage · ' + id, 3);
    const edit = await p.evaluate(() => { const b = document.getElementById('gEdit'); if (!b) return false; b.click(); return true; });
    if (edit) { await wait(p, 800); await crawl(p, 'car editor · ' + id, 2); await p.evaluate(() => { const d = document.getElementById('gDiscard'); if (d) d.click(); }); await wait(p, 300); if ((await top(p)) === 'cfm') await p.evaluate(() => document.getElementById('cfmYes').click()); await wait(p, 400); await back(p, 'trip:1'); }
    await p.evaluate(() => __trip.step(2)); await wait(p, 900);
    await crawl(p, 'advisory · ' + id, 2);
  }
  await p.close();
  // 5. a planned trip for each kind of fuel, through every step
  for (const id of ['demo-prime', 'demo-tesla', 'demo-mirai']) await tripTour(browser, id);
}
async function tripTour(browser, carId) {
  const p = await boot(browser);
  await require(path.join(ROOT, 'tests/onboarding-ui.js'))(p);
  await p.evaluate(id => { Garage.installDemo(); __app.S.carId = id; Tires.airDue = () => false; Climate.ackDue = () => false; }, carId);
  await p.evaluate(fs.readFileSync(path.join(ROOT, 'tests/trip_mocks.js'), 'utf8'));
  await p.evaluate(() => { const A = __app; A.S.trip.fuel = { mode: 'miles', miles: '120' }; A.S.trip.milesLeft = '120'; A.S.trip.tankPrice = '3.50'; A.S.trip.evTankPrice = '.30'; A.S.trip.departNow = true; window.__skipHazardRulesStep = false; });
  await p.click('#btnTrip'); await wait(p, 600);
  await p.evaluate(() => __trip.step(3)); await wait(p, 500);
  await crawl(p, 'route (empty) · ' + carId, 1);
  await p.fill('#tFrom', '100 Main St, Testville').catch(() => {}); await p.fill('#tTo', 'Dallas, TX').catch(() => {});
  await p.click('#tGetRoutes').catch(() => {}); await wait(p, 2500);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    await p.waitForFunction(() => !__trip.state().busy, null, { timeout: 60000 }).catch(() => {});
    await wait(p, 600);
    const t = await top(p);
    const step = await p.evaluate(() => __trip.state().step);
    const key = t + '|' + await p.evaluate(() => (document.querySelector('#tNext') || {}).textContent || '');
    if (!seen.has(key)) { seen.add(key); await crawl(p, 'trip · ' + carId + ' · step ' + step, 2, { max: 25 }); }
    else await cap(p, 'trip · ' + carId);
    if (t === 'cfm') { await p.evaluate(() => document.getElementById('cfmYes').click()); continue; }
    if (t.startsWith('sub')) { await back(p, 'trip:' + step); continue; }
    if (step === 9) break;
    const moved = await p.evaluate(() => { const yes = document.querySelector('#twYes, [data-tw-yes], #hzYes'); const n = yes && yes.offsetParent ? yes : document.getElementById('tNext'); if (!n || n.disabled) return false; n.click(); return true; });
    if (!moved) { log('trip stuck at step', step, carId); break; }
    await wait(p, 900);
  }
  // visit each step directly too, so steps the flow skipped still get a look
  for (const s of [3, 4, 10, 5, 8, 6, 7, 9]) { await p.evaluate(s => __trip.step(s), s).catch(() => {}); await wait(p, 1200); await crawl(p, 'trip · ' + carId + ' · step ' + s, 1, { max: 15 }); }
  await p.close();
}
module.exports = { run, crawl, capture: cap };
