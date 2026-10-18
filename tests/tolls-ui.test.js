// Keyless "Compare with and without tolls": the toll-free routes are fetched too (Maps with avoid=tolls), Route's Tolls
// card takes the amount Maps doesn't give, Hazards tags each option, and nothing paid is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>sessionStorage.setItem('standinRestored',JSON.stringify({s:JSON.stringify({setupDone:true,apiKey:''})})));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href+'#restored');await p.waitForSelector('#btnLocate.live');
 await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  window.__paid=0;['search','placesFind','computeRoute','routeSearch'].forEach(k=>__app.N[k]=()=>{__paid++;throw Error('Unexpected paid request');});
  const line=(bend)=>Array.from({length:16},(_,i)=>[34.7+i*.01,-92.29+Math.sin(i/15*Math.PI)*bend]),mi=pts=>pts.slice(1).reduce((s,q,i)=>s+Trip.hav({lat:pts[i][0],lng:pts[i][1]},{lat:q[0],lng:q[1]}),0);
  const tollPts=line(0),freePts=line(.08);
  const orig=window.__siteMock;window.__siteMock=(key,a)=>{if(key!=='gmaps')return orig(key,a);(window.__gmapsUrls=window.__gmapsUrls||[]).push(a.url);
   return /avoid=tolls/.test(a.url)?{routes:[{via:'Old Hwy 1',miles:mi(freePts),minutes:30,pts:freePts,tolls:false}]}:{routes:[{via:'Turnpike',miles:mi(tollPts),minutes:20,pts:tollPts,tolls:true}]};};
  __app.S.trip.avoid={tolls:false,highways:false,ferries:false};__app.S.trip.tollAmounts={};
 });
 await p.click('#btnTrip');await p.evaluate(()=>__trip.step(3));await p.click('#tSrc [data-src="typed"]');
 await p.evaluate(()=>{const x=document.getElementById('tTollCmp');x.checked=true;x.onchange();});
 await p.fill('#tFrom','100 Main St, Testville');await p.fill('#tTo','200 Main St, Testville');
 assert.equal(await p.evaluate(()=>__app.S.trip.tollCompare&&__app.S.trip.altCompare),true,'comparing tolls turns on the route comparison');
 await p.click('#tGetRoutes');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);
 const urls=await p.evaluate(()=>__gmapsUrls);assert(urls.some(u=>/avoid=tolls/.test(u))&&urls.some(u=>!/avoid=/.test(u)),'both the usual and the toll-free routes were asked for');
 let t=await p.evaluate(()=>__trip.tolls());
 assert.deepEqual(t[0].map(x=>x.via),['Turnpike','Old Hwy 1 · no tolls']);
 assert.equal(t[0][0].tolls.has,true);assert.equal(t[0][0].tolls.cost,null,'Maps gives no amount');assert.equal(t[0][1].tolls.has,false);
 await p.waitForSelector('#tTolls .toll-in');assert.equal(await p.locator('#tTolls .toll-in').count(),1,'an amount box for the toll road only');
 await p.fill('#tTolls .toll-in','4.75');await p.dispatchEvent('#tTolls .toll-in','change');
 t=await p.evaluate(()=>__trip.tolls());assert.equal(t[0][0].tolls.cost,4.75);assert.equal(t[0][0].tolls.src,'you');assert.equal(t[0][0].tag,'$4.75 tolls');
 assert.equal(await p.evaluate(()=>Object.values(__app.S.trip.tollAmounts)[0]),4.75,'kept with the trip settings');
 await p.evaluate(()=>__trip.step(5));await p.waitForSelector('#tHz .hz-opt');
 const tiles=await p.locator('#tHz .hz-opt').allInnerTexts();assert(tiles.some(x=>/\$4\.75 tolls/.test(x))&&tiles.some(x=>/no tolls/.test(x)),'Hazards tags each option: '+tiles.join(' | '));
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal(await p.evaluate(()=>__paid),0,'no paid lookups; HERE prices the toll road once');assert.equal(errors.length,0,errors.join('\n'));
 await p.close();
 }
 // With a HERE key: the toll road (and only it) is priced, once; the answer is reused instead of asked again
 {
 const p=await b.newPage({viewport:{width:320,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>sessionStorage.setItem('standinRestored',JSON.stringify({s:JSON.stringify({setupDone:true,apiKey:'',hereKey:'TEST_HERE_KEY_123'})})));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href+'#restored');await p.waitForSelector('#btnLocate.live');
 await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  window.__paid=0;['search','placesFind','computeRoute','routeSearch'].forEach(k=>__app.N[k]=()=>{__paid++;throw Error('Unexpected paid request');});
  const line=(bend)=>Array.from({length:16},(_,i)=>[34.7+i*.01,-92.29+Math.sin(i/15*Math.PI)*bend]),mi=pts=>pts.slice(1).reduce((s,q,i)=>s+Trip.hav({lat:pts[i][0],lng:pts[i][1]},{lat:q[0],lng:q[1]}),0);
  const tollPts=line(0),freePts=line(.08);window.__tollMi=mi(tollPts);
  const orig=window.__siteMock;window.__siteMock=(key,a)=>{if(key!=='gmaps')return orig(key,a);
   return /avoid=tolls/.test(a.url)?{routes:[{via:'Old Hwy 1',miles:mi(freePts),minutes:30,pts:freePts,tolls:false}]}:{routes:[{via:'Turnpike',miles:mi(tollPts),minutes:20,pts:tollPts,tolls:true}]};};
  window.__hereQ=[];window.__mocks.here=(q,key)=>{__hereQ.push({q,key});return {routes:[{sections:[{summary:{length:__tollMi*1609.344,tolls:{total:{type:'value',currency:'USD',value:5.75}}}}]}]};};
  __app.S.trip.avoid={tolls:false,highways:false,ferries:false};__app.S.trip.tollAmounts={};__app.S.trip.tollCompare=true;__app.S.trip.altCompare=true;
 });
 await p.click('#btnTrip');await p.evaluate(()=>__trip.step(3));await p.click('#tSrc [data-src="typed"]');
 await p.fill('#tFrom','100 Main St, Testville');await p.fill('#tTo','200 Main St, Testville');
 await p.click('#tGetRoutes');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);
 await p.waitForFunction(()=>__trip.tolls()[0][0].tolls.src==='here');
 let t=await p.evaluate(()=>__trip.tolls());assert.equal(t[0][0].tolls.cost,5.75);assert.equal(t[0][0].tag,'$5.75 tolls');
 assert.match(await p.innerText('#tTolls'),/HERE's price/);
 let q=await p.evaluate(()=>__hereQ);assert.equal(q.length,1,'one HERE request: the toll road only, not the toll-free one');
 assert(!/TEST_HERE_KEY/.test(q[0].q),'the key is passed apart from the query');assert.match(q[0].q,/passThrough=true/);
 await p.evaluate(()=>__trip.step(5));await p.waitForSelector('#tHz .hz-opt');await p.evaluate(()=>__trip.step(3));
 assert.equal(await p.evaluate(()=>__hereQ.length),1,'redrawing Route and Hazards asks nothing again');
 assert.equal(await p.evaluate(()=>__hereCalls),1,'the stand-in counted one HERE lookup');
 assert.equal(await p.evaluate(()=>__paid),0);assert.equal(errors.length,0,errors.join('\n'));
 await p.close();
 }
 console.log('Toll and toll-free routes fetched together, amounts entered on Route, tagged on Hazards, no paid lookups; HERE prices the toll road once');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
