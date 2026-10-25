const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:800,height:460}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{
  if(!sessionStorage.getItem('standinRestored'))sessionStorage.setItem('standinRestored',JSON.stringify({s:JSON.stringify({setupDone:true,keylessRegular:true,autoRefresh:false,brands:{walmart:true}}),c:JSON.stringify({lastFetch:{lat:34.745,lng:-92.29,ts:Date.now()},g:[],o:{}})}));
  window.__kv=JSON.parse(sessionStorage.getItem('test-kv')||'{}');
 });
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href+'#restored');await p.waitForSelector('#btnLocate.live');
 await p.evaluate(()=>{
  __app.map.fitBounds([[34,-93],[35,-91]],{animate:false});__app.siteOn=()=>false;
  window.__paid=0;__app.N.search=()=>__paid++;__app.N.computeRoute=()=>__paid++;
  const c=__app.map.getCenter(),b=__app.map.getBounds();
  window.__official={id:'wm-99001',wmStoreId:'99001',brand:'walmart',name:'Walmart Fuel Station',address:'200 Main St, Testville',lat:c.lat,lng:c.lng,source:'walmart.com',prices:{diesel:{price:4.1,observedAt:1000,source:'walmart.com'}}};
  window.__maps={...__official,id:'web:test-fuel',featureId:'test-fuel',lat:c.lat+0.002,address:'101 Side Drive',source:'Google Maps web',prices:{regular:{price:3.1}}};
  window.__edge={...__maps,id:'web:corner',featureId:'corner',wmStoreId:'99002',lat:b.getNorth()-0.001,lng:b.getEast()-0.001};
  window.__calls=0;window.__hold=true;
  __app.N.siteRead=(id,key,json)=>{
   if(!/^gasweb/.test(key))return setTimeout(()=>onNativeResult(id,{stores:[]}),0);
   __calls++;
   if(__hold&&__calls>1)return;
   if(__calls===1){const m=JSON.parse(json).url.match(/@([\d.-]+),([\d.-]+),/),lat=Math.max(b.getSouth()+.01,Math.min(b.getNorth()-.01,+m[1])),lng=Math.max(b.getWest()+.01,Math.min(b.getEast()-.01,+m[2]));Object.assign(__official,{lat,lng});Object.assign(__maps,{lat:lat+.002,lng});}
   // Official readers checkpoint before a later Maps identity is linked.
   PriceHistory.observe([__official]);
   setTimeout(()=>onNativeResult(id,{stores:[structuredClone(__maps),structuredClone(__edge)],detail:{exhausted:true}}),0);
  };
 });
 await p.evaluate(()=>document.querySelector('#btnArea').onclick());
 await p.waitForFunction(()=>PriceHistory.history(__maps).length>=2);
 await p.waitForSelector('#jobBar:not(.hidden) .jb-x');await p.click('#jobBar .jb-x');
 await p.waitForFunction(()=>!__app.job());
 assert.match(await p.innerText('#status'),/cancelled/i);
 await p.evaluate(()=>{window.__hold=false;__app.KV.clear('gasweb');document.querySelector('#btnArea').onclick();});
 await p.waitForFunction(()=>!__app.job());
 assert(await p.evaluate(()=>__calls)>24,'search is not cut to 24 centre areas');
 assert.equal(await p.evaluate(()=>__paid),0);
 assert.equal(await p.locator('#rows .row').count(),2,'one station per store, including viewport corner');
 assert.equal(await p.evaluate(()=>__app.stations().find(s=>s.id==='web:corner')!=null),true,'wide-view corner not circle-clipped');
 assert.equal(await p.evaluate(()=>PriceHistory.history(__official).some(r=>r.grade==='regular')),true);
 await p.evaluate(()=>{__app.map.panBy([20,0],{animate:false});});
 await p.waitForFunction(()=>document.querySelectorAll('#rows .row').length>=1);
 await p.evaluate(()=>__app.map.panBy([-20,0],{animate:false}));await p.waitForFunction(()=>document.querySelectorAll('#rows .row').length===2);
 // Persist the browser stand-in's exact native cache and KV across reopening.
 // (handed to the reloaded page by an init script: sessionStorage alone can come back empty after a file:// reload)
 const snap=await p.evaluate(()=>({s:__app.N.loadSettings()||JSON.stringify(__app.S),c:__app.N.loadCache(),kv:window.__kv}));
 await p.addInitScript(d=>{try{sessionStorage.setItem('standinRestored',JSON.stringify({s:d.s,c:d.c}));sessionStorage.setItem('test-kv',JSON.stringify(d.kv));}catch(e){}window.__kv=JSON.parse(JSON.stringify(d.kv));},snap);
 await p.reload();await p.waitForSelector('#btnLocate.live');
 const counts=await p.evaluate(()=>{const rows=PriceHistory.near([33,-95,36,-89]),store=rows.find(s=>s.wmStoreId==='99001');return {n:rows.filter(s=>s.wmStoreId==='99001').length,grades:Object.keys(store&&store.prices||{}),records:PriceHistory.stations().map(s=>({id:s.id,store:s.snapshot&&s.snapshot.wmStoreId,lat:s.lat,lng:s.lng})),savedKeys:Object.keys(JSON.parse(sessionStorage.getItem('test-kv')||'{}')).length,restoredKeys:Object.keys(window.__kv||{}).length};});
 assert.equal(counts.n,1,JSON.stringify(counts));assert(counts.grades.includes('diesel')&&counts.grades.includes('regular'),JSON.stringify(counts));
 await p.evaluate(()=>{
  __app.S.apiKey='TEST';__app.S.keylessRegular=false;__app.N.siteSearch=(key,id)=>setTimeout(()=>onSiteResult(key,id,{stores:[]}),0);
  __app.N.search=(id,key,queries,...box)=>{window.__apiBox=box.slice(0,4);setTimeout(()=>onSearchResult(id,{places:[],errors:[]}),0);};
  const b=__app.map.getBounds();window.__expectedBox=[b.getSouth(),b.getWest(),b.getNorth(),b.getEast()];document.querySelector('#btnArea').onclick();
 });
 assert.deepEqual(await p.evaluate(()=>__apiBox),await p.evaluate(()=>__expectedBox),'API receives the entire visible rectangle too, not the old 25-mile clamp');
 assert.deepEqual(errors,[]);
 console.log('Map cancel → new full-viewport search → pan → reopen: one store, preserved grades/history, zero paid calls');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
