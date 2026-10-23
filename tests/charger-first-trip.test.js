const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}});await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);
 await p.evaluate(()=>{window.inventoryCalls=[];window.inventoryCount=0;__app.N.chargerInventory=(id,action,key)=>{inventoryCalls.push({action,key});onNativeResult(id,{count:inventoryCount,updated:Date.now()});};window.check=ChargerData.firstTrip();ChargerData.firstTrip();});
 await p.waitForSelector('#cfmYes');assert.match(await p.innerText('#cfm'),/DOE.*connector types/);assert.equal(await p.evaluate(()=>inventoryCalls.length),1,'concurrent screen redraws coalesce');
 await p.click('#cfmNo');await p.evaluate(()=>check);assert.equal(await p.evaluate(()=>inventoryCalls.filter(x=>x.action==='download').length),0);await p.evaluate(()=>ChargerData.firstTrip());assert.equal(await p.locator('#cfm.on').count(),0,'declining does not prompt on every step');
 await p.waitForSelector('#cfm',{state:'detached'});
 await p.evaluate(()=>{__app.S.evInventoryPrompted=false;__app.S.nrelKey='TEST-PERSONAL';window.check=ChargerData.firstTrip();});await p.waitForSelector('#cfmYes');
 await p.evaluate(()=>{__app.N.chargerInventory=(id,action,key)=>{inventoryCalls.push({action,key});if(action==='download')window.downloadId=id;else onNativeResult(id,{count:0});};});await p.click('#cfmYes');await p.waitForFunction(()=>window.downloadId);
 assert.equal(await p.evaluate(()=>inventoryCalls.find(x=>x.action==='download').key),'TEST-PERSONAL');await p.waitForSelector('#jobBar:not(.hidden)');
 await p.evaluate(()=>{inventoryCount=123;onNativeResult(downloadId,{count:123,updated:Date.now(),status:200});});await p.evaluate(()=>check);assert.equal(await p.evaluate(()=>__app.S.evInventoryPrompted),true);
 await p.waitForSelector('#cfm',{state:'detached'});await p.evaluate(()=>{__app.S.evInventoryPrompted=false;__app.N.chargerInventory=(id)=>onNativeResult(id,{count:123});});await p.evaluate(()=>ChargerData.firstTrip());assert.equal(await p.locator('#cfm.on').count(),0,'existing inventory does not need another download prompt');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.close();
 }}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
