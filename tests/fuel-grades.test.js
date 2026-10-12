const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/web/pricing.js'),K=require('../assets/web/keylessgas.js');
const known={id:'saved',brand:'exxon',name:'Exxon',lat:34,lng:-92,prices:{regular:{price:3},midgrade:{price:3.3},premium:{price:3.6},diesel:{price:4}}};
for(const grade of Object.keys(P.GRADES)){
 const result=K.updateKnown([known],[{placeId:'saved',name:'Exxon',lat:34,lng:-92,prices:{[grade]:{price:4.12}}}],P,1000,grade);
 assert.equal(result.updated,1);assert.equal(result.stations[0].prices[grade].price,4.12);
 for(const other of Object.keys(P.GRADES).filter(g=>g!==grade))assert.equal(result.stations[0].prices[other].price,known.prices[other].price);
}
const missing=K.updateKnown([known],[{placeId:'saved',name:'Exxon',lat:34,lng:-92,prices:{regular:{price:2.9}}}],P,1000,'diesel');
assert.equal(missing.updated,0);assert.equal(missing.stations[0].prices.diesel.price,4,'regular cannot fill diesel');
const now=new Date(),fresh=P.compute({...known,prices:{regular:{price:3,updated:null,observedAt:now.getTime()}}},'regular',P.DEFAULTS,now);
assert.equal(fresh.stale,false);assert.equal(fresh.ageUnknown,true);assert.equal(fresh.updated,null,'retrieval does not invent a source update');
const stale=P.compute({...known,prices:{regular:{price:3,updated:new Date(now-48*3600e3).toISOString(),observedAt:now.getTime()}}},'regular',P.DEFAULTS,now);
assert.equal(stale.stale,true,'genuinely old source timestamps remain old after rereading');
async function official(){
 const data=new Map(),calls=[],observations=[];
 const window={document:{},PriceHistory:{observe:s=>observations.push(...s)},__app:{P,KV:{get:(ns,k)=>data.get(ns+'|'+k),put:(ns,k,v)=>data.set(ns+'|'+k,{v,t:Date.now()})}},__trip:{call:async(fn,key,json)=>{
  assert.equal(fn,'siteRead');calls.push(key);const args=JSON.parse(json);
  if(key==='walmart'){assert.equal(args.mode,'prices');assert.equal(args.nodes[0].id,'1');return {stores:[{id:'1',geo:{latitude:34,longitude:-92},fuel:{metadata:{dateCreated:new Date().toISOString()},prices:[{name:'DIESEL',price:3.89},{name:'PREMIUM',price:3.79},{name:'MIDGRAD',price:3.69},{name:'UNLEAD',price:3.59}]}}]};}
  if(key==='murphy')return {stores:[{id:2,storeNumber:22,latitude:34.01,longitude:-92,chainName:'Murphy USA',gasPrices:[{fuelType:'Diesel',price:3.77,lastUpdateUtc:new Date().toISOString()}]}]};
  throw Error('Fully covered official areas should not load Google Maps');
 }}};
 vm.runInNewContext(fs.readFileSync('assets/web/keylessgas.js','utf8'),{window,Date,setTimeout,setInterval,clearInterval});
 const list=[{...known,id:'wm-1',wmStoreId:'1',brand:'walmart',name:'Walmart Fuel Station'},{...known,id:'mu-2',brand:'murphy',name:'Murphy USA',lat:34.01}];
 const result=await window.KeylessGas.refreshKnown(list,()=>{},[],'diesel');
 assert.equal(result.updated,2);assert.equal(result.apiCalls,0);assert.deepEqual(calls,['walmart','murphy']);
 assert.equal(result.stations[0].prices.diesel.price,3.89);assert.equal(result.stations[0].prices.premium.price,3.79);assert.equal(result.stations[1].prices.diesel.price,3.77);
 assert.equal(result.stations[0].prices.diesel.source,'walmart.com');assert(observations.some(s=>s.prices.diesel&&s.prices.diesel.price===3.89));
 const cached=await window.KeylessGas.refreshKnown(list,null,[],'diesel');assert.equal(cached.websiteLoads,0);
}
official().then(()=>console.log('All four grades, no substitution, true age semantics, official multi-grade sources and zero API calls passed')).catch(e=>{console.error(e);process.exitCode=1;});
