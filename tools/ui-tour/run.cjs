// On-demand UI tour: node tools/ui-tour/run.cjs [out-dir] [--only-core] [--tests a,b]
// Writes <out>/light and <out>/dark (index.html, viewer.html, img/) and <out>/gasket-ui-tour.zip.
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const args = process.argv.slice(2), out = path.resolve(args.find(a => !a.startsWith('--')) || path.join(ROOT, 'tmp/ui-tour'));
const onlyCore = args.includes('--only-core'), ti = args.indexOf('--tests');
// Existing UI tests reach states the demo walk can't set up by itself (planned stops, rest lists, reviews...).
const TESTS = ti >= 0 ? args[ti + 1].split(',') : ['ui-flow', 'setup-demo', 'menu-design-ui', 'car-editor-taps-ui', 'dc-curve-ui', 'dc-charging-ui', 'vehicle-catalog', 'nhtsa-catalog', 'editor-tires', 'styled-tire-flow', 'trailer-editor', 'tire-estimate-ui', 'tire-fuel-ui', 'car-photo-picker', 'recall-rating-ui', 'wet-tire-route', 'vehicle-weather-ui', 'restui', 'rest-tools-ui', 'restweather-ui', 'userrestprice-ui', 'rest-chargers-ui', 'windowplanning-ui', 'window-form-ui', 'datetimepicker', 'routechoices-ui', 'traffic-presets-ui', 'vehiclecompare-ui', 'autotrip-ui', 'ev-flow-ui', 'saved-prices', 'map-tiers-ui', 'vinscan-ui', 'onboarding-connections', 'onboarding-preferences', 'evprices-ui', 'chargerdata-ui', 'api-meter-ui', 'rest-links-prices-ui', 'hourly-approval-ui', 'planning-policy-ui', 'tolls-ui', 'overnight-ui'].filter(t => fs.existsSync(path.join(ROOT, 'tests', t + '.test.js')));
const raw = path.join(out, 'raw');
const log = (...a) => console.log('[ui-tour]', ...a);
function runTest(name) {
  return new Promise(res => {
    const t0 = Date.now(), c = spawn(process.execPath, ['--require', path.join(__dirname, 'hook.cjs'), path.join('tests', name + '.test.js')], { cwd: ROOT, env: Object.assign({}, process.env, { GASKET_UI_TOUR_RAW: raw, GASKET_UI_TOUR_SCENARIO: name }), stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; c.stderr.on('data', d => err += d);
    const kill = setTimeout(() => c.kill('SIGKILL'), 240000);
    c.on('exit', code => { clearTimeout(kill); log(name, code === 0 ? 'ok' : 'exit ' + code + ' (screens kept)', Math.round((Date.now() - t0) / 1000) + 's'); res(); });
  });
}
(async () => {
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(raw, { recursive: true });
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const t0 = Date.now();
  try { await require('./core.cjs').run(raw, browser, (...a) => log(...a)); } catch (e) { log('demo walk stopped:', e.message); } finally { await browser.close(); }
  log('demo walk', fs.readdirSync(raw).length, 'screens', Math.round((Date.now() - t0) / 1000) + 's');
  // demo screens come first in the gallery
  for (const f of fs.readdirSync(raw)) { const s = JSON.parse(fs.readFileSync(path.join(raw, f))); s.order = 0; fs.writeFileSync(path.join(raw, f), JSON.stringify(s)); }
  if (!onlyCore) {
    const lanes = Math.max(1, Math.min(4, +process.env.TOUR_JOBS || 3)), q = TESTS.slice();
    await Promise.all(Array.from({ length: lanes }, async () => { while (q.length) await runTest(q.shift()); }));
  }
  log('total', fs.readdirSync(raw).length, 'screens; rendering');
  await require('./render.cjs').render(raw, out);
  try { execFileSync('zip', ['-qr', 'gasket-ui-tour.zip', 'light', 'dark'], { cwd: out }); log('zip', path.join(out, 'gasket-ui-tour.zip')); } catch (e) { log('zip not made:', e.message); }
})().catch(e => { console.error(e); process.exit(1); });
