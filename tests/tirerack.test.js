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
const fixtureClocks=new WeakSet();
async function start(pg, html, args, setup = '') {
  if(!fixtureClocks.has(pg)){await pg.clock.install();fixtureClocks.add(pg);}
  await pg.setContent(html);
  await pg.evaluate(setup || 'void 0');
  await pg.evaluate(() => { delete window.__gasketRead; window.answers = []; window.GasketSite = { result: (id, json) => answers.push({ id, ...JSON.parse(json) }) }; });
  await pg.evaluate(src => { (0, eval)(src); }, injection(worker, 123, JSON.stringify(args)));
}
async function result(pg) {
  for(let i=0;i<120&&!(await pg.evaluate(()=>answers.length));i++)await pg.clock.fastForward(250);
  assert((await pg.evaluate(()=>answers.length))>0,'reader must settle within its simulated deadline');
  return pg.evaluate(() => answers[0]);
}
async function run() {
  const tiresSource=fs.readFileSync(path.join(root,'assets/web/tires.js'),'utf8'),readCode=tiresSource.slice(tiresSource.indexOf('function tireRead(args)'),tiresSource.indexOf('function failure(r)'));
  for(const blocked of [false,true]){
    let attempts=0;const delays=[];
    const read=Function('trQueue','call','LG','TR_RETRY','TR_TRIES','setTimeout',readCode+';return tireRead;')(Promise.resolve(),async()=>{attempts++;return attempts===1?blocked?{blocked:true,error:'restriction',code:'blocked'}:{error:'Unverified vehicle panel',code:'unreadable'}:{factory:['205/55R16']};},{info:()=>{},warn:()=>{}},['unreadable'],[2000,6000],(f,ms)=>{delays.push(ms);f();});
    const r=await read({step:'oesize'});assert.equal(attempts,blocked?1:2);assert.deepEqual(delays,blocked?[]:[2000]);assert.equal(blocked?r.blocked:r.factory[0],blocked?true:'205/55R16');
  }
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
    await start(pg, base, picker, `window.fetch=async()=>({ok:true,status:200,text:async()=>'<error>Invalid request</error>'});`);
    assert.equal((await result(pg)).code, 'unreadable');
    console.log('HTTP, network and site restriction detection passed');

    for (const setup of [
      `window.fetch=()=>new Promise(()=>{});`,
      `window.fetch=async()=>({ok:true,status:200,text:()=>new Promise(()=>{})});`,
      `window.AbortController=undefined;window.fetch=()=>new Promise(()=>{});`
    ]) {
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
    await start(pg,'<h2>Factory Tire Size</h2><p>LT235/80R17</p><p>P275/70R18</p><h2>Optional Tire Sizes</h2><p>LT285/60R20</p>',{step:'size'});
    assert.deepEqual(await result(pg),{id:123,factory:['235/80R17','275/70R18'],optional:['285/60R20']});
    await start(pg, '<h2>Factory Tire Size</h2>', { step: 'size' });
    await pg.clock.fastForward(20500);
    assert.equal(await pg.evaluate(() => answers[0] && answers[0].code), 'unreadable');
    await pg.close(); pg = await browser.newPage();
    pg.on('pageerror', e => errors.push(e.message));
    await start(pg,base,{step:'oesize',year:2020,make:'Test',model:'Coupe'},`window.fetch=async(url)=>({ok:true,status:200,text:async()=>String(url).includes('SetCurrentVehicle')?'\u007b"vehicleZipSet":"success"\u007d':'<h2>Different vehicle</h2><h3>Factory tire size</h3><p>205/55R16</p>'});`);
    assert.equal((await result(pg)).code,'unreadable','a mismatched vehicle panel is retryable, not a terminal unknown vehicle');
    await start(pg,base,{step:'oesize',year:2020,make:'Test',model:'Coupe'},`window.fetch=async(url)=>({ok:true,status:200,text:async()=>String(url).includes('SetCurrentVehicle')?'\u007b"vehicleZipSet":"success"\u007d':'<h2>2020 Test Coupe</h2><h3>Factory tire size</h3><p>205/55R16</p>'});`);
    assert.deepEqual((await result(pg)).factory,['205/55R16']);
    await start(pg, '<p>No tires found</p>', { step: 'list' });
    assert.equal((await result(pg)).empty, true);
    const card = (brand, model, type, warranty, utqg = '680 A A', part = '', service = '') => `<article class="tire"><h2><a href="https://www.tirerack.com/tires/tires.jsp?tireMake=${encodeURIComponent(brand)}&tireModel=${encodeURIComponent(model)}${part ? '&partnum='+part : ''}"><span>${brand}</span><br><span>${model}</span></a></h2>${utqg ? `<a href="/tires/types/tiretype.jsp">${type}</a>` : `<span class="category">${type}</span>`}<ul><li>Size: <span>195/65R15</span></li>${service ? `<li>Serv. Desc: ${service}</li><li>Load Range: SL</li>` : ''}${utqg ? `<li>UTQG: <span>${utqg}</span></li>` : ''}</ul><a>${warranty}</a></article>`;
    const continental = card('Continental','SecureContact AW','Grand Touring All-Season','60K Mile Manufacturer\'s Warranty','700 A A');
    for(const type of ['Classic','Off-Road Maximum Traction','Racetrack & Autocross Only','Drag Racing','Future catalog category']){
      await start(pg,'<h1>We have 1 tire model in stock</h1>'+card('TestBrand','Test Model',type,'','600 A A'),{step:'list'});
      assert.equal((await result(pg)).tires[0].type,type,'explicit catalog categories must not be discarded by a short keyword list');
    }
    const cooper = card('Cooper','Endeavor','Grand Touring All-Season','65,000-mile<br>Manufacturer\'s Warranty');
    const winter = card('Bridgestone','Blizzak WS90','Studless Ice & Snow','',null);
    await start(pg, `<h1>We have 3 tire models in stock</h1><label>Results Per Page: <select id="resultsPerPage"><option value="10">10</option><option value="all">All</option></select></label><div id="cards">${continental}</div>`, { step:'list' }, `document.getElementById('resultsPerPage').onchange=()=>setTimeout(()=>{document.getElementById('cards').insertAdjacentHTML('beforeend',${JSON.stringify(cooper + winter)});},500);`);
    const all = await result(pg);
    assert.equal(all.tires.length, 3, JSON.stringify(all.tires));
    assert.equal(all.partial, undefined);
    const endeavor = all.tires.find(t=>t.brand==='Cooper');
    assert.equal(endeavor.model,'Endeavor');
    assert.equal(endeavor.type,'Grand Touring All-Season');
    assert.equal(endeavor.warrantyMi,65000);
    assert.deepEqual(endeavor.utqg,{tw:680,trac:'A',temp:'A'});
    assert.equal(all.tires.find(t=>t.brand==='Bridgestone').utqg,null);
    await pg.route('https://www.tirerack.com/**', r=>r.fulfill({status:200,contentType:'text/html',body:base}));
    await pg.goto('https://www.tirerack.com/tires/TireSearchResults.jsp?width=195%2F&ratio=65&diameter=15');
    await start(pg, `<h1>We have 2 tire models in stock</h1>${continental}<a rel="next" href="/tires/TireSearchResults.jsp?page=2"><span aria-hidden="true">→</span></a>`, {step:'list'}, `window.fetch=async()=>({ok:true,status:200,text:async()=>${JSON.stringify(cooper)}});`);
    const linked = await result(pg);
    assert.ok(linked.tires.find(t=>t.brand==='Cooper'),JSON.stringify(linked));
    assert.equal(linked.tires.find(t=>t.brand==='Cooper').warrantyMi,65000);
    await start(pg, `<h1>We have 2 tire models in stock</h1><div id="cards">${continental}</div><button id="more" aria-label="Show more tires">More</button>`, {step:'list'}, `document.getElementById('more').onclick=()=>setTimeout(()=>{document.getElementById('cards').insertAdjacentHTML('beforeend',${JSON.stringify(cooper)});document.getElementById('more').remove();},300);`);
    assert.equal((await result(pg)).tires.length,2);
    await start(pg, `<h1>We have 78 tire models in stock</h1>${continental}`, {step:'list'});
    assert.equal((await result(pg)).code,'incomplete');
    const ratingH = card('General','AltiMAX RT45','Grand Touring All-Season','65K Mile Manufacturer\'s Warranty','600 A A','rt45h','91H');
    const ratingT = card('General','AltiMAX RT45','Grand Touring All-Season','75K Mile Manufacturer\'s Warranty','600 A B','rt45t','91T');
    const rows67 = Array.from({length:67},(_,i)=>card('TestBrand','Test Model '+i,'Grand Touring All-Season','60K Mile Manufacturer\'s Warranty','600 A A','test'+i+'h','91H'));
    const variants10 = Array.from({length:10},(_,i)=>card('TestBrand','Test Model '+i,'Grand Touring All-Season','70K Mile Manufacturer\'s Warranty','600 A B','test'+i+'t','91T'));
    await start(pg, '<h1>We have 77 tire models in stock</h1>'+rows67.join('')+variants10.join(''), {step:'list'});
    const variants = await result(pg);
    assert.equal(variants.tires.length,77);
    assert.equal(variants.detail.uniqueModels,67);
    assert.equal(variants.partial,undefined,'duplicate model names must not produce a false incomplete warning');
    console.log('67 model names / 77 product variants retained without a false incomplete warning');
    // Prius OE cards link to other SKUs of the SAME model inside the main card.
    // These extra links used to stop climbing before we reached the size and category.
    const oe = card('Continental','ProContact TX','Grand Touring All-Season','', '500 A A', '965HR5PCTXV2','91H')
      .replace('</h2>', '</h2><aside>Other versions: <a href="/tires/tires.jsp?tireMake=Continental&tireModel=ProContact%20TX&partnum=965HR5PCTXV3">OE variant</a></aside>');
    await start(pg, '<h1>We have 1 tire models in stock</h1>' + oe, {step:'list'});
    const originalEquipment = await result(pg);
    assert.equal(originalEquipment.tires.length,1);
    assert.equal(originalEquipment.tires[0].partnum,'965HR5PCTXV2');
    assert.equal(originalEquipment.tires[0].serviceDesc,'91H');
    assert.equal(originalEquipment.partial,undefined);
    // A shared model wrapper with two real size/rating blocks is NOT a single SKU.
    await start(pg, '<h1>We have 2 tire models in stock</h1><section>'+ratingH+ratingT+'</section>', {step:'list'});
    assert.deepEqual((await result(pg)).tires.map(t=>t.warrantyMi),[65000,75000]);
    console.log('Prius OE cross-links and separate per-SKU metadata passed');
    await start(pg, `<h1>We have 2 tire models in stock</h1><div id="cards">${ratingH}</div><input id="nextImage" type="image" alt="Next page →">`, {step:'list'}, `document.getElementById('nextImage').onclick=()=>{document.getElementById('cards').insertAdjacentHTML('beforeend',${JSON.stringify(ratingT)});document.getElementById('nextImage').remove();};`);
    const rated = await result(pg);
    assert.equal(rated.tires.length,2,'next pages containing only another variant must still be retained');
    assert.deepEqual(rated.tires.map(t=>t.serviceDesc),['91H','91T']);
    console.log('split product names, results-per-page, AJAX buttons, linked pages and Cooper 65,000-mile warranty passed');
    assert.equal(errors.length, 0, errors.join('\n'));
    await pg.close();
    console.log('Sienna factory-size parsing and unreadable/empty results passed');

    // Exercise the actual Garage screen and native promise adapter, rather than a reimplementation of lookup().
    const ui = await browser.newPage({ viewport: { width: 412, height: 915 } });
    ui.on('pageerror', e => errors.push(e.message));
    await ui.goto(pathToFileURL(path.join(root, 'assets/web/index.html')).href);
    await require('./settings-ui')(ui,'connections');await ui.fill('#apiKey', 'AIzaSyTESTKEY0123456789abcdefghijklmnop');
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
      const a={id:'a',tires:{size:'195/65R15',sizeSrc:'user',list:{size:'195/65R15',t:Date.now(),items:[]}}}, b={id:'b',tires:{size:'215/55R17',sizeSrc:'user'}};
      window.__otherCars=[a,b]; Tires.lookup(a); Tires.lookup(b);
    });
    await ui.waitForFunction(() => __otherCars.every(c=>c.tires.list && c.tires.list.failed));
    assert.equal(await ui.evaluate(() => __max), 1, 'concurrent cars must serialize');
    await ui.evaluate(() => {
      const c={id:'interrupted',name:'2011 Sienna LE',year:2011,make:'Toyota',model:'Sienna 2WD',trim:'LE',info:{drive:'fwd',engine:'3.5L V6'},tires:{tr:{key:'v3|2011|Toyota|Sienna',t:Date.now(),models:[],clars:{}},sizeLookup:{key:'v3|2011|Toyota|Sienna|Sienna FWD LE V6',t:Date.now()}}};
      window.__interrupted=c; Tires.lookup(c);
    });
    await ui.waitForFunction(() => __interrupted.tires.size==='235/60R17');
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
    await ui.fill('#tzMiles','20000');await ui.dispatchEvent('#tzMiles','change');await ui.selectOption('#tzRot','yes');await ui.selectOption('#tzType','Grand Touring All-Season');await ui.fill('#tzDot','2324');await ui.dispatchEvent('#tzDot','change');
    await ui.waitForSelector('#tzRetry');await ui.click('#tzDone');await ui.click('#tzDet');
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
    // a timeout is tried again twice (2 s, then 6 s later): all three run out before the lookup stops
    for (const ms of [80001, 2001, 80001, 6001, 80001]) { await ui.clock.fastForward(ms); await new Promise(r => setTimeout(r, 150)); }
    await ui.waitForSelector('#tzLookupError');
    assert.match(await ui.innerText('#tzLookupError'), /too long.*stopped/);
    assert.equal(await ui.locator('#tzRetry').count(), 1);
    assert.equal(errors.length, 0, errors.join('\n'));
    await ui.close();
    console.log('Sienna LE V6 end-to-end selection, serialization, failure UI and retry passed');

    const catalogUI = await browser.newPage({viewport:{width:320,height:800}});
    catalogUI.on('pageerror',e=>errors.push(e.message));
    await catalogUI.goto(pathToFileURL(path.join(root,'assets/web/index.html')).href);
    await require('./settings-ui')(catalogUI,'connections');await catalogUI.fill('#apiKey','AIzaSyTESTKEY0123456789abcdefghijklmnop'); await catalogUI.click('#sDone');
    await catalogUI.evaluate(fs.readFileSync(path.join(root,'tests/trip_mocks.js'),'utf8'));
    await catalogUI.evaluate(tires=>{
      __app.S.cars.push({id:'prius-catalog',name:'2016 Prius Two',year:2016,make:'Toyota',model:'Prius',trim:'Two',info:{},obs:{},entries:[],tires:{size:'195/65R15',sizeSrc:'user',type:'grand touring all-season',brand:'Cooper',model:'Endeavor',list:{size:'195/65R15',catalogVersion:2,failed:'incomplete',t:Date.now(),items:[{brand:'Continental',model:'SecureContact AW',type:'Grand Touring All-Season'}]}}});
      window.__catalogReads=[];
      __app.N.siteRead=(id,key,json)=>{const args=JSON.parse(json); if(key==='tirerack') __catalogReads.push(args);setTimeout(()=>onNativeResult(id,key==='tirerack'?{tires:tires,catalogVersion:5}:{error:'test skip'}),100);};
    },all.tires.concat([{brand:'Test category brand',model:'Future model',type:'Future catalog category'}]));
    await catalogUI.click('#btnTrip'); if(await catalogUI.locator('#tpNew').count()) await catalogUI.click('#tpNew');
    await catalogUI.evaluate(()=>{__app.S.carId='prius-catalog';Garage.redraw();});
    await catalogUI.waitForFunction(()=>Garage.car().tires.warrantyMi===65000);
    assert.equal(await catalogUI.evaluate(()=>__catalogReads.filter(a=>a.step==='list').length),1,'old incomplete caches must refresh once');
    assert.ok(await catalogUI.evaluate(()=>!__catalogReads.find(a=>a.step==='list').url.includes('autoModel')),'replacement catalog must not inherit vehicle/OE filters');
    if(!await catalogUI.locator('#gTires[open]').count()) await catalogUI.click('#gTires summary');
    await catalogUI.click('#tzDet');
    await catalogUI.fill('#tzMiles','20000');await catalogUI.dispatchEvent('#tzMiles','change');await catalogUI.selectOption('#tzRot','yes');
    assert.equal(await catalogUI.getAttribute('#tzSame [data-same="1"]','aria-checked'),'true','unspecified tires default to all the same');
    for(const type of ['Commercial All-Terrain','Light Truck/SUV Studdable Winter / Snow','Streetable Track & Competition','Future catalog category'])assert((await catalogUI.locator('#tzType option').evaluateAll(es=>es.map(e=>e.value))).includes(type),'all baseline and live future categories stay available');
    assert.equal(await catalogUI.inputValue('#tzWarranty'),'65000');
    assert.equal(await catalogUI.inputValue('#tzType'),'Grand Touring All-Season');
    assert.equal(await catalogUI.inputValue('#tzBrand'),'Cooper');
    assert.equal(await catalogUI.inputValue('#tzModel'),'Endeavor');
    await catalogUI.selectOption('#tzBrand','Continental');
    await catalogUI.selectOption('#tzModel','SecureContact AW');
    assert.equal(await catalogUI.inputValue('#tzWarranty'),'60000');
    await catalogUI.selectOption('#tzType','Studless Ice & Snow');
    await catalogUI.selectOption('#tzBrand','Bridgestone');
    await catalogUI.selectOption('#tzModel','Blizzak WS90');
    assert.equal(await catalogUI.inputValue('#tzWarranty'),'','switching models must clear the previous automatic warranty');
    await catalogUI.selectOption('#tzType','Grand Touring All-Season');
    await catalogUI.selectOption('#tzBrand','*'); await catalogUI.click('#tzBrandCatalog');
    await catalogUI.selectOption('#tzBrand','Cooper'); await catalogUI.selectOption('#tzModel','Endeavor');
    assert.equal(await catalogUI.locator('#tzModelT').count(),0,'model is dropdown-only');
    assert.equal(await catalogUI.inputValue('#tzModel'),'Endeavor');
    assert.equal(await catalogUI.inputValue('#tzWarranty'),'65000');
    await catalogUI.fill('#tzWarranty','70000'); await catalogUI.dispatchEvent('#tzWarranty','change');
    await catalogUI.click('#tzRefresh');
    await catalogUI.waitForFunction(()=>__catalogReads.filter(a=>a.step==='list').length===2 && Garage.car().tires.list.catalogVersion===5);
    await catalogUI.waitForSelector('#tzRefresh');
    assert.equal(await catalogUI.inputValue('#tzWarranty'),'70000','refresh must preserve a manually entered warranty');
    if(await catalogUI.isDisabled('#tzDone')){await catalogUI.fill('#tzDot','2324');await catalogUI.dispatchEvent('#tzDot','change');}
    await catalogUI.click('#tzDone');
    await catalogUI.evaluate(rows=>{
      const t=Garage.car().tires;t.list.items=rows; t.type='Grand Touring All-Season';t.brand='General';t.model='AltiMAX RT45';t.warrantySrc='tirerack';t.warrantyMi=65000;
      Garage.redraw();
    },rated.tires);
    await catalogUI.click('#tzDet');
    await catalogUI.waitForSelector('#tzModel option[value="part:rt45h"]', {state:'attached'});
    assert.equal(await catalogUI.inputValue('#tzWarranty'),'65000','differing variants: the lowest listed warranty until you pick the exact rating');
    await catalogUI.selectOption('#tzModel','part:rt45h');
    assert.equal(await catalogUI.inputValue('#tzWarranty'),'65000');
    await catalogUI.selectOption('#tzModel','part:rt45t');
    assert.equal(await catalogUI.inputValue('#tzWarranty'),'75000');
    assert.equal(await catalogUI.inputValue('#tzTemp'),'B');
    assert.equal(errors.length,0,errors.join('\n'));
    await catalogUI.close();
    console.log('Prius Cooper Endeavor selectors, stale cache refresh, case matching and warranty autofill passed');
  } finally { await browser.close(); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
