// The real trip UI, keyless: plan a trip (cells read with the phone reader's reply shape), then throw away the saved
// trip and the 15-minute area cache and plan a NEW trip on the same route with another car on another grade: no
// discovery read at all, only the store's cells. Then a new trip with an extra stop: only the stop's new cells are read.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
 await p.addInitScript(()=>sessionStorage.setItem('standinRestored',JSON.stringify({s:JSON.stringify({setupDone:true,apiKey:''})})));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href+'#restored');await p.waitForSelector('#btnLocate.live');
 await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  window.__paid=0;window.__reads=[];
  ['search','placesFind','computeRoute','routeSearch'].forEach(k=>__app.N[k]=()=>{__paid++;throw Error('Unexpected paid request');});
  window.__route=(extra)=>{const pts=Array.from({length:40},(_,i)=>[34.7+i*.025,-92.29+i*.01]).concat(extra?Array.from({length:12},(_,i)=>[35.675+i*.02,-91.9+i*.03]):[]);let mi=0;for(let i=1;i<pts.length;i++)mi+=Trip.hav({lat:pts[i-1][0],lng:pts[i-1][1]},{lat:pts[i][0],lng:pts[i][1]});return {routes:[{via:'US-67 N',miles:mi,minutes:Math.round(mi*1.1),pts}]};};
  window.__gmapsAnswer=__route(false);
  __app.S.trip.fuel={mode:'miles',miles:'40'};__app.S.trip.milesLeft='40';__app.S.trip.bufferMi=5;__app.S.brands={exxon:true,other:true};
  // the phone's reader: every reply partial, lists end quiet after scrolling
  __app.N.siteRead=(id,key,json)=>{if(!/^gasweb\d*$/.test(key))return setTimeout(()=>onNativeResult(id,{error:'mock skip'}),1);const a=JSON.parse(json);__reads.push(a.mode||'refresh');
   const m=a.url.match(/@([\d.-]+),([\d.-]+),/),lat=+m[1],lng=+m[2];
   setTimeout(()=>onNativeResult(id,a.mode==='discover'?{stores:[0,1].map(i=>({id:'web:'+lat.toFixed(3)+','+lng.toFixed(3)+':'+i,featureId:'f'+lat.toFixed(3)+lng.toFixed(3)+i,name:'Local Fuel',lat:lat+i*.01,lng:lng-i*.01,address:i+' Main St, Testville',prices:{regular:{price:3.1+i/10}},source:'Google Maps web'})),partial:true,code:'incomplete_feed',detail:{exhausted:false,stopReason:'quiet',scrolls:3}}:{stores:[],partial:true,code:'limited',detail:{stopReason:'end'}}),5);};
 });
 const plan=async(to)=>{await p.click('#btnTrip');if(await p.locator('#tpNew').count())await p.click('#tpNew');await p.evaluate(()=>__trip.step(3));await p.click('#tSrc [data-src="typed"]');
  await p.fill('#tFrom','100 Main St, Testville');await p.fill('#tTo',to||'200 Main St, Testville');await p.click('#tGetRoutes');
  await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>{__app.S.trip.departNow=true;__trip.step(6);});
  await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy);};
 const fresh=async()=>p.evaluate(()=>{__trip.close();const m=window.__kv;Object.keys(m).forEach(k=>{if(/^(trips|gasweb|gasmeta)\|/.test(k))delete m[k];});window.__reads=[];});
 await plan();const first=await p.evaluate(()=>__reads.filter(r=>r==='discover').length);assert(first>3,'first trip reads its cells: '+first);
 const cells=await p.evaluate(()=>KeylessGas.discoveryAreas([__trip.state().model],Trip,__app.P).length);assert.equal(first,cells,'one read per cell');
 // brand-new trip, same route, the other car on premium: the saved trip and temporary caches are gone, only the store remains
 await fresh();await p.evaluate(()=>{const c=__app.S.cars[1];c.grade='premium';__app.S.carId=c.id;});
 await plan();assert.equal(await p.evaluate(()=>__reads.filter(r=>r==='discover').length),0,'new trip, other car, other grade: no discovery read');
 // a new trip that goes further: only the extension's cells are read
 await fresh();await p.evaluate(()=>{window.__gmapsAnswer=__route(true);__app.S.carId=__app.S.cars[0].id;});
 await plan('300 Main St, Testville');const ext=await p.evaluate(()=>{const all=KeylessGas.discoveryAreas([__trip.state().model],Trip,__app.P);return {reads:__reads.filter(r=>r==='discover').length,cells:all.length};});
 assert(ext.reads>0&&ext.reads<ext.cells,'extension only: '+ext.reads+' of '+ext.cells);
 assert((await p.evaluate(()=>__trip.state().result.cands.length))>0,'stored and new stations are the candidates');
 assert.equal(await p.evaluate(()=>__paid),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);await p.close();
}console.log('Cell reuse UI: a new trip on the same route (other car, other grade) reads no cells; an extended route reads only its new cells (320/448)');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
