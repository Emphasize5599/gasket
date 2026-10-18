// The main map with 1,500 known stations: zoomed out it draws only the cheapest few, zoomed in to a few towns all of them.
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:360,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>sessionStorage.setItem('standinRestored',JSON.stringify({s:JSON.stringify({setupDone:true,brands:{exxon:true,other:true},autoRefresh:false,hideUnpriced:true}),c:JSON.stringify({lastFetch:{lat:34.7,lng:-92.3,ts:Date.now()},g:[],o:{}})})));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href+'#restored');await p.waitForSelector('#btnLocate.live');
 await p.evaluate(()=>{const now=Date.now(),list=[];for(let i=0;i<1500;i++)list.push({id:'t'+i,brand:i%3?'other':'exxon',name:'Fuel '+i,address:i+' Main St, Testville, AR',lat:33.5+(i%50)*0.05,lng:-94+Math.floor(i/50)*0.1,google:true,prices:{regular:{price:3+((i*37)%1500)/1000,observedAt:now,source:'Google Maps web'}}});PriceHistory.observe(list);__app.map.setView([34.7,-92.5],7);});
 const bubs=()=>p.evaluate(()=>document.querySelectorAll('.mbub').length);
 await p.waitForFunction(()=>document.querySelector('.tier-note'));
 const out=await bubs();assert(out>=12&&out<=30,'zoomed out: only the cheapest few get a bubble ('+out+')');
 assert.match(await p.innerText('.tier-note'),/cheapest \d+ of \d+ stations/);
 assert(await p.evaluate(()=>document.querySelectorAll('#rows .row').length)<=200,'the list is capped');
 await p.evaluate(()=>__app.map.setView([34.7,-92.5],12));
 await p.waitForFunction(()=>!document.querySelector('.tier-note'));
 const vis=await p.evaluate(()=>{const b=__app.map.getBounds();return document.querySelectorAll('.mbub').length;});
 assert(vis>0,'zoomed in: every station in view ('+vis+')');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('Main map: '+out+' cheapest bubbles zoomed out, '+vis+' at zoom 12');
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
