const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage();p.setDefaultTimeout(7000);const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);
 assert.deepEqual(await p.evaluate(()=>[__app.S.debug,__app.S.logLevel,FLog.level()]),[true,5,5]);
 // Use the real erase handler and a real reload, then build without demo data.
 await p.evaluate(()=>__app.KV.put('trims','v3|2024 Toyota Corolla Hybrid',{list:[],failed:true,t:Date.now()}));
 await require('./settings-ui')(p,'data');await p.click('#eraseAll');await p.click('#cfmYes');await p.waitForSelector('#onboarding');await require('./onboarding-ui')(p);
 await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 assert.equal(await p.evaluate(()=>__app.KV.get('trims','v3|2024 Toyota Corolla Hybrid')),null,'erase removes shared failed trim answers');
 await p.evaluate(()=>{__app.S.cars=[];__app.S.carId='';window.requests=[];
 const menu=xs=>({menuItem:xs.map(x=>({text:x,value:x}))});
 __mocks.epa=url=>url.includes('menu/year')?menu(['2024']):url.includes('menu/make')?menu(['Toyota']):url.includes('menu/model')?menu(['Corolla Hybrid (Normal/Eco modes)','Corolla Hybrid (Sport mode)']):url.includes('menu/options')?menu(['test']):{id:'test',year:2024,make:'Toyota',model:window.testModel,city08:53,highway08:46,comb08:50,atvType:'Hybrid',fuelType1:'Regular Gasoline'};
 __mocks.siteRead=(kind,a)=>{requests.push(a);if(/modes?\)/i.test(decodeURIComponent(a.url)))return {error:'EPA mode qualifier is not a consumer model'};return a.kind==='trims'?{text:'Trims: LE, SE, XLE.'}:{gal:11.3,src:'ai'};};});
 await p.click('#btnTrip');
 for(const model of ['Corolla Hybrid (Normal/Eco modes)','Corolla Hybrid (Sport mode)']){
 await p.evaluate(model=>window.testModel=model,model);await p.click('[data-car="+"]');
 for(const [id,value] of [['eYear','2024'],['eMake','Toyota'],['eModel',model]]){await p.waitForFunction(([id,value])=>[...document.getElementById(id).options].some(o=>o.value===value),[id,value]);await p.selectOption('#'+id,value);}
 await p.waitForSelector('#gTrimSel:not([disabled])');assert.deepEqual(await p.locator('#gTrimSel option').allTextContents(),['Choose your trim','LE','SE','XLE','Other (type it)']);
 await p.selectOption('#gTrimSel','LE');await p.waitForFunction(()=>+Garage.car().tank===11.3);await p.waitForFunction(()=>!document.getElementById('gSave').disabled);await p.click('#gSave');
 }
 assert.ok(await p.evaluate(()=>requests.some(a=>a.kind==='trims')));assert.ok(await p.evaluate(()=>requests.every(a=>!decodeURIComponent(a.url).includes('modes')&&!decodeURIComponent(a.url).includes('(Sport'))));assert.deepEqual(errors,[]);
 // Failed/rejected bridge replies settle; a visible Retry does not wait six hours.
 await p.evaluate(()=>{__mocks.siteRead=()=>({error:'temporary reader failure'});__mocks.epa=url=>url.includes('menu/year')?{menuItem:{text:'2025',value:'2025'}}:url.includes('menu/make')?{menuItem:{text:'Toyota',value:'Toyota'}}:url.includes('menu/model')?{menuItem:{text:'Corolla Hybrid',value:'Corolla Hybrid'}}:url.includes('menu/options')?{menuItem:{text:'Test',value:'fail'}}:{id:'fail',year:2025,make:'Toyota',model:'Corolla Hybrid',city08:53,highway08:46,atvType:'Hybrid',fuelType1:'Regular Gasoline'};});
 await p.click('[data-car="+"]');for(const [id,value] of [['eYear','2025'],['eMake','Toyota'],['eModel','Corolla Hybrid']]){await p.waitForFunction(([id,value])=>[...document.getElementById(id).options].some(o=>o.value===value),[id,value]);await p.selectOption('#'+id,value);}await p.waitForSelector('#gTrimRetry');await p.evaluate(()=>__mocks.siteRead=(k,a)=>a.kind==='trims'?{text:'Trims: LE, SE, XLE.'}:{gal:11.3});await p.click('#gTrimRetry');await p.waitForSelector('#gTrimSel:not([disabled])');assert.deepEqual(errors,[]);
 console.log('Actual erase/reload: detailed logging; fresh EPA Corolla mode variants auto-fetch trims then selected-trim tank.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
