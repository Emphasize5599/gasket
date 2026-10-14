const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:360,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const first={id:'known-a',brand:'exxon',name:'First Fuel',address:'1 First St, Little Rock, AR',lat:34.745,lng:-92.29,google:true,prices:{regular:{price:3.19,observedAt:Date.now(),source:'Google Maps web'}}};
 await p.addInitScript(s=>sessionStorage.setItem('standinRestored',JSON.stringify({s:JSON.stringify({setupDone:true,brands:{exxon:true},autoRefresh:false}),c:JSON.stringify({lastFetch:{lat:s.lat,lng:s.lng,ts:Date.now()},g:[s],o:{}})})),first);
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href+'#restored');await p.waitForSelector('#btnLocate.live');
 await p.evaluate(()=>{window.__paid=0;__app.N.search=()=>__paid++;PriceHistory.observe([{id:'known-b',brand:'exxon',name:'Second Fuel',address:'2 Second St, Russellville, AR',lat:35.28,lng:-93.13,google:true,prices:{regular:{price:3.39,observedAt:Date.now(),source:'Google Maps web'}}}]);__app.map.setView([35.28,-93.13],13);});
 await p.waitForFunction(()=>document.querySelector('#rows').textContent.includes('Second Fuel'));
 assert.doesNotMatch(await p.innerText('#rows'),/First Fuel/,'the list follows the visible map area');
 assert.equal(await p.locator('.leaflet-interactive').count()>0,true,'known station has a map dot');
 assert.equal(await p.evaluate(()=>__paid),0,'panning did not spend API calls');
 await p.click('#btnRefresh');assert.equal(await p.isDisabled('[data-refresh="web"]'),false,'known station can be refreshed without an API key');
 await p.evaluate(()=>{document.querySelector('#refreshMenu').remove();__app.map.setView([34.745,-92.29],13);});
 await p.waitForFunction(()=>document.querySelector('#rows').textContent.includes('First Fuel'));
 assert.doesNotMatch(await p.innerText('#rows'),/Second Fuel/);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('Panning between previously known map areas shows local stations without API calls');
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
