const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/web/pricing.js'),K=require('../assets/web/keylessgas.js');
const T=require('../assets/web/trip.js');
const webRoute={polyline:{encodedPolyline:T.encodePolyline([{lat:34,lng:-92},{lat:34.1,lng:-92}])},websiteApproximate:true,distanceMeters:10000,duration:'600s'};
assert.equal(T.joinRoutes([webRoute,webRoute]).websiteApproximate,true,'multi-leg website routes retain the approximation label');
const base={id:'a',name:'Local Fuel',lat:34,lng:-92,address:'100 Main Street, Testville',prices:{regular:{price:3}}};
assert.equal(K.dedupeDiscovery([base,{...base,id:'b',address:'100 Main St, Testville',lng:-92.0001}],P).length,1);
assert.equal(K.dedupeDiscovery([base,{...base,id:'b',name:'Different Fuel'}],P).length,2,'unknown brands never merge just because nearby');
assert.equal(P.compute({...base,brand:'other'},'regular',P.DEFAULTS).final,3,'unknown brands never receive Walmart+ discount');
assert.equal(K.dedupeDiscovery([{...base,lat:NaN}],P).length,0);
async function scan(block){
 const data=new Map(),calls=[],active=new Set(),records=[],cancelled=[];let max=0,window;
 window={document:{},PriceHistory:{observe:s=>records.push(...s)},__app:{P,siteOn:()=>false,N:{cancelSiteRead:k=>cancelled.push(k)},KV:{get:(ns,k,age)=>data.get(ns+'|'+k),put:(ns,k,v)=>data.set(ns+'|'+k,{v,t:Date.now()})}},__trip:{call:async(fn,lane,json)=>{
  assert.equal(fn,'siteRead');assert(!active.has(lane));const args=JSON.parse(json);assert.equal(args.mode,'discover');calls.push(lane);active.add(lane);max=Math.max(max,active.size);
  await new Promise(r=>setTimeout(r,5));active.delete(lane);
  if(block)return {blocked:true,error:'Site restricted'};
  return {stores:[base],detail:{exhausted:true}};
 }}};
 vm.runInNewContext(fs.readFileSync('assets/web/keylessgas.js','utf8'),{window,Date,setTimeout,setInterval,clearInterval});
 const areas=Array.from({length:17},()=>K.area(34,-92,8));
 const result=await window.KeylessGas.discover(areas,()=>{},'regular');
 assert.equal(max,4);assert.equal(result.apiCalls,0);
 if(block){assert.equal(calls.length,4);assert.equal(result.blocked,true);return;}
 assert.equal(result.completedAreas,17);assert.equal(result.stations.length,1);assert(records.length>0);
 assert.equal(result.stations[0].brand,'other');
 const cached=await window.KeylessGas.discover(areas,null,'regular');assert.equal(cached.websiteLoads,0);
 const pending=window.KeylessGas.discover(areas,null,'diesel');window.KeylessGas.cancel();const stopped=await pending;assert.equal(stopped.cancelled,true);assert.equal(cancelled.length,6);
}
Promise.all([scan(false),scan(true)]).then(()=>console.log('Keyless discovery: four readers, no paid calls, cache, cancellation, restriction stop, all-brand registry and conservative dedupe passed')).catch(e=>{console.error(e);process.exitCode=1;});
