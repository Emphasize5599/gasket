const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/web/pricing.js'),K=require('../assets/web/keylessgas.js');
const point={lat:34,lng:-92},node={id:'123',displayName:'Test Supercenter',geoPoint:{latitude:34.004,longitude:-92},address:{addressLineOne:'100 Main St',city:'Testville',state:'AR'}};
const store={id:'123',name:node.displayName,geo:node.geoPoint,address:node.address,fuel:{metadata:{dateCreated:'2026-10-12T12:00:00Z'},prices:[{name:'UNLEAD',price:2.879},{name:'PREMIUM',price:3.479},{name:'DIESEL',price:3.199}]}};
const maps={id:'web:wm',featureId:'0x1:0x2',name:'Walmart Fuel Station',brand:'walmart',...point,address:'100 Main Street, Testville, AR',prices:{regular:{price:4},midgrade:{price:4.1}}};
function setup(block){const data=new Map(),calls=[],history=[],active=new Set();const window={document:{},PriceHistory:{observe:s=>history.push(...s)},__app:{P,siteOn:k=>k==='walmart',N:{cancelSiteRead:()=>{}},KV:{get:(ns,k)=>data.get(ns+'|'+k),put:(ns,k,v)=>data.set(ns+'|'+k,{v,t:Date.now()})}},__trip:{call:async(fn,key,json)=>{
 assert.equal(fn,'siteRead','must not invoke paid APIs');assert(!active.has(key),'same source reader requests must serialize');active.add(key);const args=JSON.parse(json);calls.push({key,args});await new Promise(r=>setTimeout(r,2));active.delete(key);
 if(key==='walmart'){if(block)return {blocked:true,error:'Robot or human?'};return args.mode==='nodes'?{nodes:[node]}:{stores:[store]};}
 return {stores:[maps],detail:{exhausted:true}};
 }}};vm.runInNewContext(fs.readFileSync('assets/web/keylessgas.js','utf8'),{window,Date,setTimeout,setInterval,clearInterval});return {window,calls,data,history};}
(async()=>{
 const refresh=setup();const r=await refresh.window.KeylessGas.refreshKnown([maps],null,[],'regular');
 assert.equal(r.updated,1);assert.equal(r.stations.length,1);assert.equal(r.stations[0].id,maps.id);assert.equal(r.stations[0].lat,maps.lat);
 assert.equal(r.stations[0].wmStoreId,'123');assert.equal(r.stations[0].prices.regular.price,2.879);assert.equal(r.stations[0].prices.regular.source,'walmart.com');
 assert.equal(r.stations[0].prices.diesel.price,3.199);assert.equal(r.stations[0].prices.midgrade.price,4.1,'missing official grade retains old price');
 assert.equal(refresh.calls.filter(c=>c.key.startsWith('gasweb')).length,0,'fully supplied Walmart refresh skips Maps');
 assert(refresh.history.some(s=>s.id===maps.id&&s.prices.regular?.source==='walmart.com'));
 const linked=setup();await linked.window.KeylessGas.refreshKnown(r.stations,null,[],'regular');assert.equal(linked.calls.length,1);assert.equal(linked.calls[0].args.mode,'prices','resolved store ID avoids repeating finder search');
 const discovery=setup();const d=await discovery.window.KeylessGas.discover([K.area(34,-92,8)],null,'regular');
 assert.equal(d.stations.length,1,'store-center and pump coordinates merge without duplicate forecourts');assert.equal(d.stations[0].id,maps.id);assert.equal(d.stations[0].prices.regular.price,2.879,'official prices win over later Maps results');
 assert.equal(d.stations[0].wmStoreId,'123');assert.equal(d.apiCalls,0);
 const blocked=setup(true);const b=await blocked.window.KeylessGas.discover([K.area(34,-92,8)],null,'regular');assert.equal(b.blocked,true);assert.equal(b.blockedSite,'walmart');assert(!blocked.calls.some(c=>c.key==='walmart'&&c.args.mode==='prices'),'do not continue through a restriction');
 const ambiguous=K.updateKnown([maps,{...maps,id:'other'}],[P.normalizeWalmart(store)],P,Date.now());assert.equal(ambiguous.updated,0,'never guess between multiple nearby Walmart forecourts');
 const wrong=K.updateKnown([{...maps,wmStoreId:'999'}],[P.normalizeWalmart(store)],P,Date.now());assert.equal(wrong.updated,0,'conflicting store IDs cannot transfer prices');
 console.log('Walmart keyless discovery/regular refresh: finder ID resolution, all-grade official prices, preserved locations, cache, dedupe, no paid calls and restriction stop passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
