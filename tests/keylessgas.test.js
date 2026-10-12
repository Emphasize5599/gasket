const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const K=require('../assets/web/keylessgas.js'),P=require('../assets/web/pricing.js');
const root=path.resolve(__dirname,'..'),script=fs.readFileSync(path.join(root,'assets/gasweb_worker.js'),'utf8');
const a=K.area(34.745,-92.29,8);
assert.equal(K.area(34.745,-92.29,30).radius,15);
for(const input of [[NaN,0,8],[90,0,8],[0,181,8],[0,0,-1]])assert.throws(()=>K.area(...input));
assert.match(decodeURIComponent(K.osmUrl(a)),/nwr\["amenity"="fuel"\]/);
const element=(type,id,lat,lon,brand)=>({type,id,lat,lon,tags:{amenity:'fuel',brand}});
const open=K.normalizeOsm({elements:[element('node',1,34.745,-92.29,'Exxon'),{...element('way',2,undefined,undefined,'Exxon'),center:{lat:34.74501,lon:-92.29001}},element('node',3,40,-92,'Exxon'),element('node',4,34.74,-92.3,'Unknown Brand')]},a,P);
assert.equal(open.length,1,'deduplicate node/way, reject outside area and unsupported brands');
assert.equal(open[0].google,false);assert.deepEqual(open[0].prices,{});
const w={id:'web:0x1:0x2',name:'Exxon',lat:34.745,lng:-92.29,prices:{regular:{price:3.123,updated:null}},source:'Google Maps web',mapsUri:'https://www.google.com/maps/place/Exxon',google:true};
const merged=K.merge(open,[w],a,P);
assert.equal(merged.length,1);assert.equal(merged[0].prices.regular.price,3.123);assert.equal(merged[0].google,true);
assert.deepEqual(open[0].prices,{},'do not mutate cached station locations');
const ambiguous=K.merge([open[0],{...open[0],id:'other',lng:-92.2901}],[w],a,P);
assert.equal(ambiguous.length,3);assert.equal(ambiguous[0].prices.regular,undefined,'never assign a price across ambiguous pumps');
const twin=K.merge(open,[w,{...w,id:'web:twin',lng:-92.2901,prices:{regular:{price:4.12,updated:null}}}],a,P);
assert.equal(twin.length,3);assert.equal(twin[0].prices.regular,undefined,'two nearby same-brand Google pumps cannot overwrite one OSM station');
console.log('Open-station normalization, bounds, deduplication, provenance and conservative matching passed');
const savedStation={...w,id:'ChIJSavedStation0001',brand:'exxon',address:'100 Main Street, Testville, AR',state:'AR',wplus:false,detourMi:1.25,detourExact:true,prices:{regular:{price:3.99,updated:'2026-10-01T00:00:00Z'},premium:{price:4.99,updated:'2026-10-01T00:00:00Z'}}};
const refreshed=K.updateKnown([savedStation],[{...w,placeId:savedStation.id,prices:{regular:{price:3.12}}},{...w,id:'unseen',lat:40}],P,123);
assert.equal(refreshed.updated,1);assert.equal(refreshed.stations.length,1,'refresh must not discover/add website-only stations');
assert.equal(refreshed.stations[0].prices.regular.price,3.12);assert.equal(refreshed.stations[0].prices.regular.updated,null);
assert.equal(refreshed.stations[0].prices.regular.observedAt,123);
assert.equal(refreshed.stations[0].prices.premium.price,4.99);assert.equal(refreshed.stations[0].wplus,false);assert.equal(refreshed.stations[0].detourMi,1.25);
assert.equal(savedStation.prices.regular.price,3.99,'do not mutate the saved input');
assert.equal(K.updateKnown([savedStation,{...savedStation,id:'other'}],[w],P,123).updated,0,'ambiguous nearby stations keep old prices');
assert.equal(P.DEFAULTS.routesMonthlyCap,9500);
const link=(id,name='Exxon',lng=-92.29)=>`<article role="article"><a aria-label="${name}" href="https://www.google.com/maps/place/${name}/data=!1s${id}!3d34.745!4d${lng}">${name}</a></article>`;
const html='<div role="feed">'+link('0x1:0x2')+link('0x3:0x4','Mobil',-92.30)+'End of the list</div>';
async function worker(pg,body,raw,status=200,args={}){
  await pg.setContent(body);
  await pg.evaluate(({raw,status})=>{
    window.answers=[];window.GasketSite={result:(_,s)=>answers.push(JSON.parse(s))};
    performance.getEntriesByType=()=>[{name:'https://www.google.com/search?tbm=map&q=gas+stations'}];
    window.fetch=async()=>({ok:status===200,status,url:'https://www.google.com/search',text:async()=>raw});
  },{raw,status});
  await pg.evaluate(({s,args})=>(0,eval)('('+s+')')(1,args),{s:script,args});
  await pg.waitForFunction(()=>answers.length);
  return pg.evaluate(()=>answers[0]);
}
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROME||undefined});
 try{
  const pg=await b.newPage();
  const targeted=await worker(pg,'<div role="feed">'+link('0x1:0x2')+'</div>',JSON.stringify(['0x1:0x2','$3.12/Regular']),200,{targets:[{featureId:'0x1:0x2'}]});
  assert.equal(targeted.detail.targetsComplete,true,'finish without waiting for end of list when all stable-ID targets are priced');
  const incomplete=await worker(pg,html,JSON.stringify(['0x1:0x2','$3.12/Regular']),200,{targets:[{featureId:'0x1:0x2'},{id:'missing'}]});
  assert.equal(incomplete.detail.targetsComplete,false,'one missing saved station prevents premature completion');
  const r=await worker(pg,html,")]}'\n"+JSON.stringify([['0x1:0x2',['$3.123/Regular','Escaped \\" ] bracket']],['0x3:0x4',['$4.56/Regular']]])+'\n/* trailing frame */');
  assert.equal(r.stores[0].prices.regular.price,3.123);assert.equal(r.stores[1].prices.regular.price,4.56);
  assert.equal(r.stores[0].prices.regular.updated,null);assert.equal(r.partial,true);
  const framed=await worker(pg,html,JSON.stringify({c:0,d:")]}'\n"+JSON.stringify([['0x1:0x2','$3.12/Regular']])})+'/*""*/');
  assert.equal(framed.stores[0].prices.regular.price,3.12,'real Maps scroll-frame envelope');
  for(const raw of [JSON.stringify(['0x1:0x2','$4.99/Premium']),JSON.stringify(['0x1:0x2','$5.12/Diesel']),JSON.stringify(['0x1:0x2','$0.01/Regular']),JSON.stringify(['0x1:0x2','0x3:0x4','$3.12/Regular'])]){
    const miss=await worker(pg,html,raw);assert.equal(miss.stores[0].prices.regular,undefined);assert.equal(miss.code,'no_prices');
  }
  assert.equal((await worker(pg,html,'bad JSON')).code,'reader');
  assert.equal((await worker(pg,html,'',429)).blocked,true);
  assert.equal((await worker(pg,'<h1>Unusual traffic</h1>','')).blocked,true);
  await pg.close();
  console.log('Actual worker: exact regular-grade parsing, per-station binding, ambiguous/missing/invalid prices and restrictions passed');
  const ui=await b.newPage({viewport:{width:320,height:800}});
  await ui.goto(pathToFileURL(path.join(root,'assets/web/index.html')).href);
  await ui.evaluate(({w})=>{
    window.__osmCalls=0;window.__webCalls=0;
    __app.N.fetchJson=(id,url)=>{__osmCalls++;setTimeout(()=>onNativeResult(id,{body:JSON.stringify({elements:[{type:'node',id:1,lat:34.745,lon:-92.29,tags:{amenity:'fuel',brand:'Exxon'}}]})}),1);};
    __app.N.siteRead=(id,key,args)=>{__webCalls++;setTimeout(()=>onNativeResult(id,{stores:[w]}),1);};
  },{w});
  const lifecycle=await ui.evaluate(async()=>{
    const first=await KeylessGas.search(34.745,-92.29,8),cached=await KeylessGas.search(34.745,-92.29,8),cooldown=await KeylessGas.search(34.755,-92.30,8);
    return {first,cached,cooldown,osmCalls:__osmCalls,webCalls:__webCalls,budget:__app.KV.get('gasmeta','osm-budget').v};
  });
  assert.equal(lifecycle.first.stations[0].prices.regular.price,3.123);
  assert.deepEqual(lifecycle.cached,lifecycle.first);
  assert.equal(lifecycle.osmCalls,1);assert.equal(lifecycle.webCalls,1);
  assert.equal(lifecycle.cooldown.errors.length,2);
  assert.equal(lifecycle.budget.calls,1);
  await ui.clock.install();await ui.clock.fastForward(30001);
  await ui.evaluate(()=>{__app.N.siteRead=()=>{};window.__hangDone=false;KeylessGas.search(34.765,-92.30,8).then(r=>{window.__hangResult=r;__hangDone=true;});});
  await ui.waitForFunction(()=>__osmCalls===2);
  await ui.clock.fastForward(46000);
  await ui.waitForFunction(()=>__hangDone);
  assert.match(await ui.evaluate(()=>__hangResult.errors.join(' ')),/timed out/);
  console.log('Actual lookup lifecycle: location/price cache reuse, cooldown, persistent source budget and lost-reply deadline passed');
  await ui.evaluate(()=>{window.__paid=0;__app.N.search=()=>__paid++;__app.S.keylessRegular=true;__app.S.brands={exxon:true};__app.S.apiKey='TEST';__app.S.radiusMi=8;window.KeylessGas.search=async()=>({stations:[{id:'k',name:'Exxon',brand:'exxon',lat:34.745,lng:-92.29,prices:{regular:{price:3.12,updated:null}},google:true,source:'Google Maps web'}],errors:[]});});
  await ui.click('#sDone');
  // Settings form overwrites S, so enable using the actual checkbox and leave the API key installed.
  await ui.click('#btnSettings');await ui.check('[data-k="keylessRegular"]');await ui.fill('#apiKey','TEST');await ui.click('#sDone');
  await ui.evaluate(()=>__app.fetchAround(34.745,-92.29));
  await ui.waitForFunction(()=>document.getElementById('status').textContent.includes('keyless'));
  assert.equal(await ui.evaluate(()=>__paid),0,'regular nearby mode must never silently consume paid lookups');
  assert.match(await ui.innerText('#rows'),/Exxon/);
  assert.match(await ui.innerText('#status'),/No paid lookup fallback/);
  await ui.evaluate(()=>{KeylessGas.search=async()=>{throw new Error('Google restricted test request');};});
  await ui.evaluate(()=>__app.fetchAround(34.745,-92.29));await ui.waitForFunction(()=>document.getElementById('status').textContent.includes('restricted test'));
  assert.equal(await ui.evaluate(()=>__paid),0,'keyless failure must not invoke a paid fallback');
  await ui.evaluate(()=>{__app.S.grade='premium';});await ui.click('#btnRefresh');await ui.click('[data-refresh="api"]');
  assert.equal(await ui.evaluate(()=>__paid),1,'other grades keep the existing explicitly keyed path');
  await ui.close();
  console.log('320px UI: keyless toggle, nearby results and zero paid Places calls passed');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
