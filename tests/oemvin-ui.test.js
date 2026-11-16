// A Toyota VIN that NHTSA can't name a trim for: the app asks Toyota's parts store (siteRead toyotaparts) and locks the
// trim it names; a store that knows nothing, or a refusal, leaves the trim editable. Generic made-up VIN, mocked replies.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url'), { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  try {
    for (const mode of ['found', 'ambiguous', 'none', 'blocked']) {
      const p = await browser.newPage({ viewport: { width: 320, height: 900 } }), errors = [];
      p.on('pageerror', (e) => errors.push(e.stack));
      await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
      await p.evaluate(() => __app.S.setupDone = true); await require('./onboarding-ui')(p);
      await p.evaluate(fs.readFileSync('tests/trip_mocks.js', 'utf8'));
      await p.evaluate((mode) => {
        const menu = (xs) => ({ menuItem: xs.map((x) => ({ text: x, value: x })) });
        __mocks.epa = (url) => {
          if (url.includes('menu/year')) return menu(['2011']); if (url.includes('menu/make')) return menu(['Toyota']); if (url.includes('menu/model')) return menu(['Sienna']);
          if (url.includes('menu/options')) return { menuItem: [{ text: 'Auto 6-spd, 6 cyl, 3.5 L', value: 'test-sienna' }] };
          if (url.endsWith('/test-sienna')) return { id: 'test-sienna', year: 2011, make: 'Toyota', model: 'Sienna', displ: 3.5, cylinders: 6, trany: 'Automatic 6-spd', drive: 'Front-Wheel Drive', fuelType1: 'Regular Gasoline', city08: 18, highway08: 24, comb08: 20, VClass: 'Minivan - 2WD' };
          return { menuItem: [] };
        };
        __mocks.vpic = () => ({ Results: [{ ModelYear: '2011', Make: 'TOYOTA', Model: 'Sienna', Trim: mode === 'ambiguous' ? 'LE, XLE' : '', Trim2: 'E grade', FuelTypePrimary: 'Gasoline', DisplacementL: '3.5', EngineCylinders: '6', EngineConfiguration: 'V-Shaped', ErrorCode: '0' }] });
        const prior = __mocks.siteRead;
        __mocks.siteRead = (key, args) => {
          if (key === 'toyotaparts') {
            window.__oem = (window.__oem || []).concat([{ key, args }]);
            return mode === 'found' || mode === 'ambiguous' ? { records: [{ year: 2011, make: 'TOYOTA', model: 'SIENNA', grade: 'LE', driveline: '2WD 3.5L 6-CYL 6AT' }] }
              : mode === 'none' ? { records: [], message: 'No data found' } : { blocked: true, status: 403 };
          }
          return prior ? prior(key, args) : { error: 'offline' };
        };
      }, mode);
      await p.click('#btnTrip'); await p.click('[data-car="+"]');
      await p.fill('#gVin', '5TDAA0AA0BA000001'); await p.click('#gVinGo');
      await p.waitForFunction(() => (window.__oem || []).length > 0, null, { timeout: 15000 });
      const asked = await p.evaluate(() => __oem[0]);
      assert.equal(asked.args.url, 'https://autoparts.toyota.com/'); assert.equal(asked.args.vin, '5TDAA0AA0BA000001');
      if (mode === 'found' || mode === 'ambiguous') {
        await p.waitForFunction(() => Garage.car().trimSrc === 'vin', null, { timeout: 15000 });
        assert.equal(await p.evaluate(() => Garage.car().trim), 'LE');
        await p.waitForSelector('#gTrim[readonly]');
        assert.match(await p.$eval('#gTrim', (e) => decodeURIComponent(e.closest('label').innerHTML)), /from your VIN \(Toyota parts catalog\)/);
      } else {
        await p.waitForTimeout(400);
        assert.notEqual(await p.evaluate(() => Garage.car().trimSrc), 'vin', mode + ': trim stays editable');
        assert.equal(await p.$('#gTrim[readonly]'), null);
      }
      assert.deepEqual(errors, []);
      await p.close();
    }
    // Subaru: NHTSA's trim carries option codes ('Premium +BSD'), so Subaru's parts store (same platform as Kia's) is asked
    for (const mode of ['found', 'disagree', 'mazdabase']) {
      const p = await browser.newPage({ viewport: { width: 320, height: 900 } }), errors = [];
      p.on('pageerror', (e) => errors.push(e.stack));
      await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
      await p.evaluate(() => __app.S.setupDone = true); await require('./onboarding-ui')(p);
      await p.evaluate(fs.readFileSync('tests/trip_mocks.js', 'utf8'));
      await p.evaluate((mode) => {
        const menu = (xs) => ({ menuItem: xs.map((x) => ({ text: x, value: x })) });
        __mocks.epa = (url) => {
          if (url.includes('menu/year')) return menu(['2019']); if (url.includes('menu/make')) return menu(['Subaru']); if (url.includes('menu/model')) return menu(['Crosstrek']);
          if (url.includes('menu/options')) return { menuItem: [{ text: 'Auto(AV-S7), 4 cyl, 2.0 L', value: 'test-crosstrek' }] };
          if (url.endsWith('/test-crosstrek')) return { id: 'test-crosstrek', year: 2019, make: 'Subaru', model: 'Crosstrek', displ: 2.0, cylinders: 4, trany: 'Automatic (AV-S7)', drive: 'All-Wheel Drive', fuelType1: 'Regular Gasoline', city08: 27, highway08: 33, comb08: 29, VClass: 'Small Sport Utility Vehicle 4WD' };
          return { menuItem: [] };
        };
        if (mode === 'mazdabase') {
          const e = __mocks.epa; __mocks.epa = (url) => url.includes('menu/make') ? menu(['Mazda']) : url.includes('menu/model') ? menu(['CX-5']) : url.endsWith('/test-crosstrek') ? Object.assign(e(url), { make: 'Mazda', model: 'CX-5' }) : e(url);
        }
        __mocks.vpic = () => mode === 'mazdabase' ? { Results: [{ ModelYear: '2019', Make: 'MAZDA', Model: 'CX-5', Trim: '', Trim2: '', FuelTypePrimary: 'Gasoline', DisplacementL: '2.5', EngineCylinders: '4', ErrorCode: '0' }] } : ({ Results: [{ ModelYear: '2019', Make: 'SUBARU', Model: 'Crosstrek', Trim: 'Premium +BSD', Trim2: '', FuelTypePrimary: 'Gasoline', DisplacementL: '2.0', EngineCylinders: '4', ErrorCode: '0' }] });
        const prior = __mocks.siteRead;
        __mocks.siteRead = (key, args) => {
          if (key === 'mazdaparts') { window.__oem = (window.__oem || []).concat([{ key, args }]); return { descriptions: ['2019 CX-5 2.5L AT 4WD BASE'] }; }
          if (key === 'subaruparts') {
            window.__oem = (window.__oem || []).concat([{ key, args }]);
            return { descriptions: mode === 'found' ? ['2019 Crosstrek 2.0L CVT Premium'] : ['2019 Crosstrek 2.0L CVT Premium', '2019 Crosstrek 2.0L CVT Limited'] };
          }
          return prior ? prior(key, args) : { error: 'offline' };
        };
      }, mode);
      await p.click('#btnTrip'); await p.click('[data-car="+"]');
      await p.fill('#gVin', 'JF2GTAAC0K0000001'); await p.click('#gVinGo');
      await p.waitForFunction(() => (window.__oem || []).length > 0, null, { timeout: 15000 });
      const asked = await p.evaluate(() => __oem[0]);
      assert.equal(asked.args.url, mode === 'mazdabase' ? 'https://parts.mazdausa.com/' : 'https://parts.subaru.com/'); assert.equal(asked.args.store, 'simplepart'); assert.equal(asked.args.vin, 'JF2GTAAC0K0000001');
      if (mode === 'found') {
        await p.waitForFunction(() => Garage.car().trimSrc === 'vin', null, { timeout: 15000 });
        assert.equal(await p.evaluate(() => Garage.car().trim), 'Premium');
        await p.waitForSelector('#gTrim[readonly]');
        assert.match(await p.$eval('#gTrim', (e) => decodeURIComponent(e.closest('label').innerHTML)), /from your VIN \(Subaru parts catalog\)/);
      } else {
        await p.waitForTimeout(400);
        assert.notEqual(await p.evaluate(() => Garage.car().trimSrc), 'vin', mode + ': disagreeing descriptions or Mazda\'s BASE keep the trim editable');
        assert.equal(await p.$('#gTrim[readonly]'), null);
      }
      assert.deepEqual(errors, []);
      await p.close();
    }
    console.log('Toyota / Subaru / Mazda parts-catalog trims are asked once NHTSA has no clean one, locked when named, editable otherwise');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
