// Walmart+ at Exxon / Mobil, through the hidden exxon.com page (0.0.270): ExxonMobil's edge answers the locator asked
// from outside its pages with Access Denied (0.0.269 log: HTTP 403 on 130 of 131 squares, nothing ever marked).
// The app batches squares into the page reader (40 a read, never fetchJson), splits capped answers, stops at a refusal
// with the usual check banner, and finishing the check retries without starting a map search. The worker itself is
// run against fake locator answers (JSON, 403, Access Denied page).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:320,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{window.Native=__app.N;__app.S.xomCheck=true;__app.KV.clear('xom');window.__reads=[];window.__direct=0;window.__mode='ok';
  __app.N.fetchJson=(id)=>{__direct++;onNativeResult(id,{error:'HTTP 403'});};
  __app.N.siteRead=(id,key,json)=>{if(key!=='xom')return setTimeout(()=>onNativeResult(id,{error:'mock skip'}),1);const a=JSON.parse(json);__reads.push(a);
   setTimeout(()=>{if(__mode==='blocked')return onNativeResult(id,{blocked:true,status:403,boxes:[]});
    onNativeResult(id,{boxes:a.boxes.map(bx=>{const lat=(bx[0]+bx[1])/2,lng=(bx[2]+bx[3])/2,big=__mode==='big'&&bx[1]-bx[0]>0.4;
     return big?Array.from({length:100},(_,i)=>[bx[0]+i/1000,bx[2]+i/1000,0,'Filler']):[[lat,lng,Math.round(lat*10)%2,'Exxon '+lat.toFixed(2)]];}),read:a.boxes.length});},5);};
 });
 // 45 squares' worth of stations: two page reads (40 + 5), the exxon.com page, no direct locator request
 const marks=await p.evaluate(async()=>{const st=[];for(let i=0;i<45;i++){const lat=30.25+Math.floor(i/9)*.5,lng=-95.25+(i%9)*.5;st.push({id:'x'+i,brand:i%2?'mobil':'exxon',lat,lng,name:'Exxon'});}
  await __xom(st);return {reads:__reads.length,boxes:__reads.map(r=>r.boxes.length),urls:[...new Set(__reads.map(r=>r.url))],direct:__direct,wplus:st.filter(s=>s.wplus===true).length,not:st.filter(s=>s.wplus===false).length};});
 assert.deepEqual(marks.boxes,[40,5],'squares batched 40 a read');assert.deepEqual(marks.urls,['https://www.exxon.com/en']);assert.equal(marks.direct,0,'never the refused direct request');
 assert.equal(marks.wplus+marks.not,45,'every station marked');assert(marks.wplus>0&&marks.not>0);
 // cached for a week: asking again reads nothing
 assert.equal(await p.evaluate(async()=>{__reads=[];await __xom([{id:'again',brand:'exxon',lat:30.25,lng:-95.25}]);return __reads.length;}),0);
 // a capped (100) answer is split into four squares, read in the next batch
 const split=await p.evaluate(async()=>{__app.KV.clear('xom');__reads=[];__mode='big';const st=[{id:'big',brand:'exxon',lat:40.25,lng:-80.25}];await __xom(st);return __reads.map(r=>r.boxes.length);});
 assert.deepEqual(split,[1,4],'capped square split and asked again');
 // ExxonMobil asks for a check: the batch stops, the check banner shows, nothing else is read
 const blocked=await p.evaluate(async()=>{__app.KV.clear('xom');__reads=[];__mode='blocked';const st=[{id:'b1',brand:'exxon',lat:41.25,lng:-81.25},{id:'b2',brand:'mobil',lat:42.25,lng:-82.25}];
  await __xom(st);const first=__reads.length;await __xom([{id:'b3',brand:'exxon',lat:43.25,lng:-83.25}]);return {first,after:__reads.length,banner:!document.getElementById('wmCheck').classList.contains('hidden'),title:document.getElementById('wmCheckTitle').textContent,marked:st.some(s=>s.wplus!==undefined)};});
 assert.equal(blocked.first,1);assert.equal(blocked.after,1,'no more reads after a refusal');assert(blocked.banner);assert.match(blocked.title,/ExxonMobil wants a check/);assert.equal(blocked.marked,false,'no discount assumed either way');
 // check finished: no map search, the failed squares are asked again
 const after=await p.evaluate(async()=>{const gas=(window.__siteRead||[]).filter(r=>/^gasweb/.test(r.key)).length,searches=window.__searchCalls||0;let mapSearch=0;const N=__app.N,o=N.search;N.search=function(){mapSearch++;return o&&o.apply(this,arguments);};
  __mode='ok';__reads=[];onSiteVerified('xom');await new Promise(r=>setTimeout(r,50));await __xom([{id:'b1',brand:'exxon',lat:41.25,lng:-81.25}]);
  return {mapSearch,gas:(window.__siteRead||[]).filter(r=>/^gasweb/.test(r.key)).length-gas,reads:__reads.length};});
 assert.equal(after.mapSearch,0);assert.equal(after.gas,0,'verification never starts a station search');assert.equal(after.reads,1,'failed square asked again after the check');
 // the worker on fake locator answers
 const worker=fs.readFileSync('assets/xom_worker.js','utf8');
 const run=async(answers,title)=>p.evaluate(async([src,answers,title])=>{document.title=title||'Exxon';let i=0;const realFetch=window.fetch;window.__urls=[];
  window.fetch=async(u)=>{__urls.push(String(u));const a=answers[Math.min(i++,answers.length-1)];return {status:a.status,ok:a.status===200,text:async()=>a.body};};
  const out=await new Promise(res=>{window.GasketSite={result:(id,json)=>res(JSON.parse(json))};(0,eval)('('+src+')')(7,{boxes:[[30,30.5,-95,-94.5],[31,31.5,-96,-95.5]]});});
  window.fetch=realFetch;return {out,urls:__urls};},[worker,answers,title]);
 const ok=await run([{status:200,body:JSON.stringify({Locations:[{Latitude:30.2,Longitude:-94.8,DisplayName:'Exxon A',StoreAmenities:[{Name:'Walmart+'}]},{Latitude:30.3,Longitude:-94.7,LocationName:'Mobil B',FeaturedItems:[{Title:'Car wash'}]}]})}]);
 assert.deepEqual(ok.out.boxes[0],[[30.2,-94.8,1,'Exxon A'],[30.3,-94.7,0,'Mobil B']]);assert.equal(ok.out.read,2);assert.match(ok.urls[0],/^\/en\/api\/locator\/Locations\?Latitude1=30\.000&Latitude2=30\.500&Longitude1=-95\.000&Longitude2=-94\.500&DataSource=RetailGasStations/);
 const refused=await run([{status:200,body:'{"Locations":[]}'},{status:403,body:'<HTML><TITLE>Access Denied</TITLE>'}]);assert.equal(refused.out.blocked,true);assert.equal(refused.out.boxes.length,1,'squares read before the refusal are kept');
 const page=await run([{status:200,body:'{}'}],'Access Denied');assert.equal(page.out.blocked,true);assert.equal(page.urls.length,0,'a refused page asks nothing');
 const java=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8');assert.match(java,/"xom"\.equals\(key\) && url\.equals\("https:\/\/www\.exxon\.com\/en"\)/,'only exxon.com/en may be read by the xom reader');
 assert.deepEqual(errors,[]);
 console.log('ExxonMobil Walmart+ check through the exxon.com page: batched 40 a read, no direct request, cached, capped squares split, refusal stops with the check banner, verification retries without a station search, worker on JSON / 403 / Access Denied');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
