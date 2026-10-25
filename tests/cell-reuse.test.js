// Searched cells are ALWAYS reused (owner, 0.0.270): every later trip, car, grade, restart and month, only cells never
// searched are read, and with price updates off nothing else touches a website. Real route geometry and area plans
// (discoveryAreas = what a trip searches), the phone reader's reply shape (partial: true on every reply, lists that end
// quiet after scrolling), a store that survives app restarts (a fresh VM over the same files), more cells than the
// store's 64-cell memory cache, and the cancel / bad-read / neighbour-write cases that must not lose or fake coverage.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),G=require('../assets/web/stationstore'),P=require('../assets/web/pricing'),T=require('../assets/web/trip');
const files=new Map();let now=Date.parse('2026-10-25T20:00:00Z');
const copy=v=>JSON.parse(JSON.stringify(v));
const KV={get:(ns,k,age)=>{const r=files.get(ns+'|'+k);return r&&(!age||now-r.t<=age)?copy(r):null;},put:(ns,k,v)=>{files.set(ns+'|'+k,{t:now,v:copy(v)});return true;}};
// one phone reply per area: 2–4 stations around its centre (some fall into neighbouring cells, as real 8-mile reads do)
function reply(a,kind){const lat=a.lat,lng=a.lng,n=2+Math.abs(Math.round(lat*97+lng*31))%3,stores=[];
 for(let i=0;i<n;i++)stores.push({id:'web:'+lat.toFixed(4)+','+lng.toFixed(4)+':'+i,featureId:'f'+lat.toFixed(4)+lng.toFixed(4)+i,name:'Exxon',brand:'exxon',lat:lat+(i-1)*.05,lng:lng+(i%2?.06:-.06),address:i+' Main St, Testville',prices:{regular:{price:3+i/10,updated:new Date(now).toISOString()}}});
 if(kind==='end')return {stores,partial:true,code:'limited',detail:{exhausted:true,stopReason:'end',scrolls:4}};
 if(kind==='blocked')return {stores:[],blocked:true,error:'Google wants a check',code:'blocked'};
 if(kind==='unreadable')return {stores:[],partial:true,code:'unreadable',error:'Google gas results could not be read',detail:{exhausted:false,stopReason:'deadline',scrolls:0}};
 if(kind==='stalled')return {stores,partial:true,code:'pagination_stalled',detail:{exhausted:false,stopReason:'quiet',scrolls:1,paginationStalled:true}};
 return {stores,partial:true,code:'incomplete_feed',detail:{exhausted:false,stopReason:'quiet',scrolls:2+n}};}
// a fresh app: new VM, same files (the phone's storage)
const pricingSrc=fs.readFileSync('assets/web/pricing.js','utf8');
function boot(answer){const calls=[];class Clock extends Date{static now(){return now;}}
 // pricing inside the VM, so price freshness follows the test's clock
 const pc={Date:Clock,console};vm.runInNewContext(pricingSrc,pc);const w={document:{},__app:{P:pc.Pricing,S:{staleHours:24,keylessWorkers:8},siteOn:()=>false,N:{},KV}};
 w.__trip={call:async(fn,lane,json)=>{const a=JSON.parse(json);calls.push({fn,lane,mode:a.mode||'refresh'});
  if(a.mode==='discover'){const m=a.url.match(/@([\d.-]+),([\d.-]+),/);return (answer||reply)({lat:+m[1],lng:+m[2]});}
  return {stores:[],partial:true,code:'limited',detail:{stopReason:'end'}};}};
 for(const name of ['stationstore','keylessgas'])vm.runInNewContext(fs.readFileSync('assets/web/'+name+'.js','utf8'),{window:w,Date:Clock,console,setTimeout,clearTimeout,setInterval,clearInterval});
 const K=w.KeylessGas;return {w,K,S:w.StationStore,calls,reads:()=>calls.filter(c=>c.mode==='discover').length,web:()=>calls.length};}
// routes: real geometry through the planner's own model and the trip's own area plan
const car={city:30,hwy:30,comb:30};
function route(points){const pts=points.map(([lat,lng])=>({lat,lng}));let mi=0;for(let i=1;i<pts.length;i++)mi+=P.haversineMi(pts[i-1].lat,pts[i-1].lng,pts[i].lat,pts[i].lng);
 return T.buildRoute({distanceMeters:mi*1609.344,duration:Math.round(mi*60)+'s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:[]},car);}
function line(a,b,n){return Array.from({length:n+1},(_,i)=>[a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n]);}
(async()=>{
 const tripA=route(line([35.0,-92.3],[36.6,-86.8],60)),mathK=require('../assets/web/keylessgas');
 const areasA=mathK.discoveryAreas([tripA],T,P);assert(areasA.length>64,'more cells than the store keeps in memory: '+areasA.length);assert(areasA.every(a=>a.cellId),'trip areas are grid cells');
 // 1. first car, first trip: every cell read once and recorded although every reply says partial and ends quiet
 let a=boot(),r=await a.K.discover(areasA,null,'regular');
 assert.equal(a.reads(),areasA.length);assert(areasA.every(c=>a.S.covered(c,'gasweb','regular')),'every quiet cell recorded');const first=r.stations.length;assert(first>areasA.length);
 // 2. app restarted (cold store, memory cache empty), same route: nothing read, same stations
 now+=3600e3;a=boot();r=await a.K.discover(areasA,null,'regular');
 assert.equal(a.web(),0,'restart: no website at all for a searched route');assert.equal(r.reusedAreas,areasA.length);assert.equal(r.stations.length,first,'every stored station comes back');
 // 3. a NEW trip from the same link: geometry rebuilt with different vertices, plus a detour leg: only never-searched cells are read
 const tripB=route(line([35.0,-92.3],[36.6,-86.8],97)),detour=route(line([36.0,-89.5],[36.9,-89.0],12));
 const areasB=mathK.discoveryAreas([tripB,detour],T,P),fresh=areasB.filter(c=>!areasA.some(x=>x.cellId===c.cellId));
 a=boot();r=await a.K.discover(areasB,null,'regular');assert.equal(a.reads(),fresh.length,'new trip: reads exactly the '+fresh.length+' new cells of '+areasB.length);assert(fresh.length>0&&fresh.length<areasB.length);
 // 4. another car on another grade: same station lists, nothing re-read (prices are the price refresh's job)
 a=boot();await a.K.discover(areasB,null,'premium');assert.equal(a.reads(),0,'a premium car reuses regular-car searches');
 // 5. months later: still used (0.0.265 expired quiet cells after a week)
 now+=400*864e5;a=boot();a.K.priceRefresh(false);r=await a.K.discover(areasB,null,'regular');
 assert.equal(a.web(),0,'400 days later with price updates off: no website at all');assert(r.stations.length>=first);
 // 6. price updates on: old prices go through the price-only refresh, still no discovery read
 a=boot();a.K.priceRefresh(true);r=await a.K.discover(areasA,null,'regular');assert.equal(a.reads(),0);assert(a.web()>0&&a.calls.every(c=>c.mode==='refresh'),'stale prices: price refresh only');
 // 7. cancelled halfway on a new route: finished cells kept, the next run reads only the rest
 const tripC=route(line([38.0,-90.2],[39.8,-84.6],70)),areasC=mathK.discoveryAreas([tripC],T,P);let n=0,c1=boot(c=>{if(++n<=Math.floor(areasC.length/2))return reply(c);setTimeout(()=>c1.K.cancel(),0);return new Promise(()=>{});});
 r=await c1.K.discover(areasC,null,'regular');assert(r.cancelled);const kept=areasC.filter(c=>c1.S.covered(c,'gasweb','regular')).length;assert(kept>0&&kept<areasC.length,'kept '+kept);
 a=boot();await a.K.discover(areasC,null,'regular');assert.equal(a.reads(),areasC.length-kept,'after a cancel only unsearched cells are read');
 // 8. reads that prove nothing never certify a cell (and are read next time); a good read later does
 for(const kind of ['blocked','unreadable','stalled']){const cs=G.cells([41+['blocked','unreadable','stalled'].indexOf(kind),-95,41.05+['blocked','unreadable','stalled'].indexOf(kind),-94.95]);const b=boot(c=>reply(c,kind));await b.K.discover(cs,null,'regular');
  assert(cs.every(c=>!b.S.covered(c,'gasweb','regular')),kind+' never certifies');const g=boot();await g.K.discover(cs,null,'regular');assert.equal(g.reads(),cs.length,kind+' cells are read again');const h=boot();await h.K.discover(cs,null,'regular');assert.equal(h.reads(),0,'then remembered');}
 // 9. later writes into covered cells (neighbouring reads, EV inventory, price refresh observations, history import) keep coverage
 a=boot();a.S.observe([{id:'ev1',lat:areasA[3].lat,lng:areasA[3].lng,network:'Tesla'}],'ev','["ev"]');a.S.observe(a.S.rows(areasA[4],'gas').map(s=>Object.assign({},s,{prices:{regular:{price:2.9,observedAt:now}}})),'gas');
 await a.K.discover(G.cells([35.02,-92.33,35.08,-92.27]),null,'regular');a=boot();await a.K.discover(areasA,null,'regular');assert.equal(a.reads(),0,'coverage survives other writes into the same cells');
 // 10. an end-of-list read is never downgraded by a later quiet one, and Rediscover reads everything again
 const endCell=G.cell({lat:44,lng:-93});a=boot(c=>reply(c,'end'));await a.K.discover([endCell],null,'regular');a=boot();a.S.complete(endCell,'gasweb','regular',a.S.rows(endCell,'gas'),now,true);
 a=boot();await a.K.discover(areasA.concat(endCell),null,'regular',true);assert.equal(a.reads(),areasA.length+1,'Rediscover (force) reads every cell');
 // 11. a fully remembered long route is quick (0.0.269 log: 640 remembered cells took 73 s)
 const big=mathK.discoveryAreas([route(line([30.5,-97.5],[40.5,-75.5],300))],T,P);a=boot();await a.K.discover(big,null,'regular');a=boot();a.K.priceRefresh(false);
 const t0=process.hrtime.bigint();r=await a.K.discover(big,null,'regular');const ms=Number(process.hrtime.bigint()-t0)/1e6;
 assert.equal(a.web(),0);assert.equal(r.reusedAreas,big.length);assert(ms<big.length*20,big.length+' remembered cells in '+ms.toFixed(0)+' ms');
 console.log('Cell reuse: '+areasA.length+'-cell route recorded and reused after restart; new trip read '+fresh.length+'/'+areasB.length+' new cells; other grade, 400 days, price updates off: no website; cancel resumes; bad reads never certify; '+big.length+' remembered cells in '+ms.toFixed(0)+' ms');
})().catch(e=>{console.error(e);process.exitCode=1;});
