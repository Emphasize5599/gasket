// Loaded with `node --require` into an existing UI test: after each page action, saves the screen on top
// (read-only, deduplicated) to GASKET_UI_TOUR_RAW. The test itself runs unchanged.
const dir = process.env.GASKET_UI_TOUR_RAW, scenario = process.env.GASKET_UI_TOUR_SCENARIO || 'test';
if (dir) {
  const { capture } = require('./store.cjs');
  const Module = require('module'), orig = Module.prototype.require;
  let patched = false, busy = new WeakSet();
  const snap = page => { if (!page || busy.has(page) || page.isClosed()) return; busy.add(page); return capture(page, dir, scenario).catch(() => {}).finally(() => busy.delete(page)); };
  const wrap = (proto, names, pageOf) => names.forEach(n => {
    const f = proto[n]; if (typeof f !== 'function' || f.__tour) return;
    const g = async function (...a) { const r = await f.apply(this, a); const p = pageOf(this); if (p && !busy.has(p)) await snap(p); return r; };
    g.__tour = true; proto[n] = g;
  });
  const patchPage = page => {
    if (patched) return; patched = true;
    const P = Object.getPrototypeOf(page);
    wrap(P, ['click', 'tap', 'check', 'uncheck', 'selectOption', 'fill', 'press', 'evaluate', 'goto', 'waitForFunction', 'waitForSelector', 'waitForTimeout', 'dispatchEvent', 'setChecked'], t => t);
    const L = Object.getPrototypeOf(page.locator('body'));
    wrap(L, ['click', 'tap', 'check', 'uncheck', 'selectOption', 'fill', 'press', 'dispatchEvent', 'setChecked', 'evaluate'], t => t._frame && t._frame._page);
    const M = Object.getPrototypeOf(page.mouse);
    wrap(M, ['up', 'click'], t => t._page);
  };
  const watchBrowser = b => {
    const np = b.newPage, nc = b.newContext;
    b.newPage = async function (...a) { const p = await np.apply(this, a); patchPage(p); return p; };
    b.newContext = async function (...a) { const c = await nc.apply(this, a); const cp = c.newPage; c.newPage = async function (...x) { const p = await cp.apply(this, x); patchPage(p); return p; }; return c; };
    return b;
  };
  Module.prototype.require = function (id) {
    const m = orig.apply(this, arguments);
    if ((id === 'playwright' || id === 'playwright-core') && m.chromium && !m.chromium.__tour) {
      const l = m.chromium.launch; m.chromium.launch = async function (...a) { return watchBrowser(await l.apply(this, a)); }; m.chromium.__tour = true;
    }
    return m;
  };
}
