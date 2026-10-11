// Run with NODE_PATH pointing to Playwright, and CHROME pointing to Chrome/Edge if needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'assets/tirerack_worker.js'), 'utf8');
const native = fs.readFileSync(path.join(root, 'src/com/bensanzone/fuelmap/MainActivity.java'), 'utf8');
// Execute the actual expression emitted by Android, including its document/request guard and rejection handler.
const expression = native.split('\n').find(s => s.includes('w.readCall = "if(')).trim().slice('w.readCall = '.length, -1);
const injection = new Function('script', 'reqId', 'argsJson', 'return ' + expression);
const picker = { step: 'clars', make: 'Toyota', year: 2011, models: ['Sienna FWD'] };
const base = '<h1>Tire Rack</h1><p>' + 'vehicle picker '.repeat(30) + '</p>';
async function start(pg, html, args, setup = '') {
  await pg.setContent(html);
  await pg.evaluate(setup || 'void 0');
  await pg.evaluate(() => { delete window.__gasketRead; window.answers = []; window.GasketSite = { result: (id, json) => answers.push({ id, ...JSON.parse(json) }) }; });
  await pg.evaluate(src => { (0, eval)(src); }, injection(worker, 123, JSON.stringify(args)));
}
async function result(pg) {
  await pg.waitForFunction(() => answers.length > 0);
  return pg.evaluate(() => answers[0]);
}
async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true, args: ['--no-sandbox'] });
  try {
    let pg = await browser.newPage();
    const errors = [];
    pg.on('pageerror', e => errors.push(e.message));
    const okFetch = `window.fetch = async () => ({ok:true,status:200,text:async()=>'<clarifiers><clar>LE 4cyl</clar><clar>LE V6</clar></clarifiers>'});`;
    await start(pg, base, picker, okFetch);
    assert.deepEqual((await result(pg)).clars, { 'Sienna FWD': ['LE 4cyl', 'LE V6'] });
    // Critical regression: a second request on the SAME document must run; duplicate callbacks must not run it twice.
    await pg.evaluate(injection(worker, 124, JSON.stringify(picker)));
    await pg.evaluate(injection(worker, 124, JSON.stringify(picker)));
    await pg.waitForFunction(() => answers.length === 2);
    assert.equal(await pg.evaluate(() => answers[1].id), 124);
    // Reload destroys the reader. Reinject the same active request on the new document.
    await pg.setContent(base);
    await pg.evaluate('delete window.__gasketRead');
    await pg.evaluate(injection(worker, 125, JSON.stringify(picker)));
    await pg.waitForFunction(() => answers.length === 3);
    console.log('same-page requests and duplicate native callbacks passed');

    for (const setup of [
      `window.fetch=async()=>({ok:false,status:403,text:async()=>'<p>Access denied</p>'});`,
      `window.fetch=async()=>({ok:true,status:200,text:async()=>'<p>Pardon our interruption. Verify you are human.</p>'});`
    ]) {
      await start(pg, base, picker, setup);
      const r = await result(pg); assert.equal(r.blocked, true); assert.equal(r.code, 'blocked');
      assert.ok(r.detail.requestUrl.includes('Sienna%20FWD'));
    }
    await start(pg, '<title>Just a moment</title><p>Security verification</p>', { step: 'size' });
    assert.equal((await result(pg)).blocked, true);
    await start(pg, base, picker, `window.fetch=async()=>({ok:false,status:503,text:async()=>'<p>Service unavailable</p>'});`);
    assert.equal((await result(pg)).code, 'http');
    await start(pg, base, picker, `window.fetch=async()=>{throw new TypeError('Failed to fetch')};`);
    assert.equal((await result(pg)).code, 'network');
    await start(pg, base, picker, `window.fetch=async()=>({ok:true,status:200,text:async()=>'<html><body>Different page</body></html>'});`);
    assert.equal((await result(pg)).code, 'unreadable');
    console.log('HTTP, network and site restriction detection passed');

    for (const setup of [
      `window.fetch=()=>new Promise(()=>{});`,
      `window.fetch=async()=>({ok:true,status:200,text:()=>new Promise(()=>{})});`,
      `window.AbortController=undefined;window.fetch=()=>new Promise(()=>{});`
    ]) {
      await pg.clock.install();
      await start(pg, base, picker, setup);
      await pg.clock.fastForward(18001);
      assert.equal(await pg.evaluate(() => answers[0] && answers[0].code), 'timeout');
      await pg.clock.fastForward(20000);
      assert.equal(await pg.evaluate(() => answers.length), 1);
      await pg.close(); pg = await browser.newPage();
      pg.on('pageerror', e => errors.push(e.message));
    }
    console.log('stalled headers, stalled body and missing AbortController deadlines passed');

    await start(pg, '<h1>2011 Toyota Sienna FWD LE V6</h1><h2>Factory Tire Size</h2><p>235/60-17</p><h2>Optional Tire Sizes</h2><p>235/55-18</p>', { step: 'size' });
    assert.deepEqual((await result(pg)).factory, ['235/60R17']);
    await pg.clock.install();
    await start(pg, '<h2>Factory Tire Size</h2>', { step: 'size' });
    await pg.clock.fastForward(20500);
    assert.equal(await pg.evaluate(() => answers[0] && answers[0].code), 'unreadable');
    await pg.close(); pg = await browser.newPage();
    pg.on('pageerror', e => errors.push(e.message));
    await start(pg, '<p>No tires found</p>', { step: 'list' });
    assert.equal((await result(pg)).empty, true);
    assert.equal(errors.length, 0, errors.join('\n'));
    await pg.close();
    console.log('Sienna factory-size parsing and unreadable/empty results passed');

    // Exercise the actual Garage screen and native promise adapter, rather than a reimplementation of lookup().
    const ui = await browser.newPage({ viewport: { width: 412, height: 915 } });
    ui.on('pageerror', e => errors.push(e.message));
    await ui.goto(pathToFileURL(path.join(root, 'assets/web/index.html')).href);
    await ui.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop');
    await ui.click('#sDone');
    await ui.evaluate(fs.readFileSync(path.join(root, 'tests/trip_mocks.js'), 'utf8'));
    await ui.evaluate(() => {
      window.__tr = []; window.__active = 0; window.__max = 0; window.__mode = 'ok';
      window.__app.S.cars.push({id:'sienna',name:'2011 Sienna LE',year:2011,make:'Toyota',model:'Sienna 2WD',trim:'LE',info:{drive:'fwd',engine:'3.5L V6'},obs:{},entries:[]});
      window.__app.N.siteRead = (req, key, json) => {
        if(key !== 'tirerack') return setTimeout(()=>onNativeResult(req,{error:'test skip'}),10);
        const args=JSON.parse(json); __tr.push(args); __active++; __max=Math.max(__max,__active);
        if(__mode === 'hang') return;
        let r = __mode === 'blocked' ? {blocked:true,error:'Access denied'} : __mode === 'timeout' ? {error:'timed out',code:'timeout'} :
          args.step==='models' ? {models:['Sienna FWD','Sienna AWD']} : args.step==='clars' ? {clars:{'Sienna FWD':['LE 4cyl','LE V6']}} :
          args.step==='size' ? {factory:['235/60R17'],optional:['235/55R18']} : {tires:[],empty:true};
        setTimeout(()=>{__active--;onNativeResult(req,r);},100);
      };
    });
    await ui.click('#btnTrip');
    if (await ui.locator('#tpNew').count()) await ui.click('#tpNew');
    await ui.evaluate(() => { __app.S.carId='sienna'; Garage.redraw(); });
    await ui.waitForFunction(() => Garage.car().tires && Garage.car().tires.size==='235/60R17');
    await ui.waitForFunction(() => Garage.car().tires.list && Garage.car().tires.list.failed);
    assert.equal(await ui.evaluate(() => __max), 1, 'all Tire Rack requests must be serialized');
    assert.ok(await ui.evaluate(() => __tr.some(a=>a.url.includes('autoModClar=LE%20V6'))));
    if (!await ui.locator('#gTires[open]').count()) await ui.click('#gTires summary');
    await ui.click('#tzDet');
    assert.equal(await ui.inputValue('#tzSize'), '235/60R17');
    // Multiple cars must not overwrite the shared native worker or lose either completion.
    await ui.evaluate(() => {
      const a={id:'a',tires:{size:'195/65R15',sizeSrc:'user'}}, b={id:'b',tires:{size:'215/55R17',sizeSrc:'user'}};
      window.__otherCars=[a,b]; Tires.lookup(a); Tires.lookup(b);
    });
    await ui.waitForFunction(() => __otherCars.every(c=>c.tires.list && c.tires.list.failed));
    assert.equal(await ui.evaluate(() => __max), 1, 'concurrent cars must serialize');
    // Do not overwrite a manual size with the response from the version that was loading.
    await ui.evaluate(() => {
      const c=Garage.car(); window.__held=[];
      window.__previousRead=__app.N.siteRead;
      __app.N.siteRead=(id,key,json)=>{
        if(key==='tirerack' && JSON.parse(json).step==='size') __held.push(id);
        else __previousRead(id,key,json);
      };
      c.tires.size=''; c.tires.sizeSrc=''; c.tires.sizeLookup=null; Tires.lookup(c);
    });
    await ui.waitForFunction(() => __held.length===1);
    await ui.fill('#tzSize','225/60R17');
    await ui.dispatchEvent('#tzSize','change');
    await ui.evaluate(() => { __app.N.siteRead=__previousRead; onNativeResult(__held[0],{factory:['235/60R17']}); });
    await ui.waitForFunction(() => Garage.car().tires.list && Garage.car().tires.list.size==='225/60R17');
    assert.equal(await ui.evaluate(() => Garage.car().tires.size), '225/60R17');
    await ui.waitForSelector('#tzRetry');
    for (const mode of ['blocked','timeout']) {
      await ui.evaluate(m => { window.__mode=m; }, mode);
      await ui.click('#tzRetry');
      await ui.waitForSelector('#tzLookupError');
      assert.match(await ui.innerText('#tzLookupError'), mode==='blocked' ? /restricted.*security check/ : /too long.*stopped/);
      await ui.click('#tzOpenSite');
      assert.match(await ui.evaluate(() => __lastUrl), /https:\/\/www\.tirerack\.com\/tires\/TireSearchResults\.jsp/);
    }
    // Lost bridge reply must clear the UI's busy state and remove its pending promise waiter.
    await ui.clock.install();
    await ui.evaluate(() => { window.__mode='hang'; });
    await ui.click('#tzRetry');
    await ui.waitForFunction(() => __active===1);
    await ui.clock.fastForward(80001);
    await ui.waitForSelector('#tzLookupError');
    assert.match(await ui.innerText('#tzLookupError'), /too long.*stopped/);
    assert.equal(await ui.locator('#tzRetry').count(), 1);
    assert.equal(errors.length, 0, errors.join('\n'));
    await ui.close();
    console.log('Sienna LE V6 end-to-end selection, serialization, failure UI and retry passed');
  } finally { await browser.close(); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
