const assert=require('node:assert/strict');
const P=require('../assets/web/pricing.js'),K=require('../assets/web/keylessgas.js'),{create}=require('../assets/web/pricehistory.js');
const official={id:'wm-99001',wmStoreId:'99001',brand:'walmart',name:'Walmart Fuel Station',address:'200 Main St, Testville',lat:34,lng:-92,source:'walmart.com',prices:{regular:{price:3,observedAt:1000,source:'walmart.com'},diesel:{price:4,observedAt:1000,source:'walmart.com'}}};
const maps={...official,id:'web:test-fuel',featureId:'test-fuel',lat:34.002,address:'101 Side Drive',source:'Google Maps web',prices:{regular:{price:3.1,observedAt:2000,source:'Google Maps web'},premium:{price:3.9,observedAt:2000,source:'Google Maps web'}}};
const before=JSON.stringify([official,maps]),joined=P.reconcileStations([maps,official]);
assert.equal(joined.length,1,'same store reconciles despite entrance/store-centre and address differences');
assert.equal(joined[0].id,maps.id);assert.equal(joined[0].prices.regular.price,3.1);assert.equal(joined[0].prices.diesel.price,4);assert.equal(joined[0].prices.premium.price,3.9);
assert.equal(JSON.stringify([official,maps]),before,'inputs not mutated');
assert.equal(K.dedupeDiscovery([maps,official],P).length,1);
assert.equal(P.reconcileStations([official,maps])[0].lat,maps.lat,'use the pump listing rather than the store-centre coordinate regardless of scan order');
const neighbor={...official,id:'wm-99002',wmStoreId:'99002',lat:34.00001};
assert.equal(K.dedupeDiscovery([official,neighbor],P).length,2,'even adjacent stores with conflicting IDs remain distinct');
assert.equal(P.reconcileStations([official,{...official,id:'wm-far',lat:35}]).length,2,'bad distant provider identity is not enough');
const data=new Map(),KV={get:(ns,k)=>data.has(ns+'|'+k)?{v:JSON.parse(data.get(ns+'|'+k))}:null,put:(ns,k,v)=>data.set(ns+'|'+k,JSON.stringify(v))};
let db=create(KV);
db.observe([official]); // official checkpoint from a cancelled scan
db=create(KV);db.observe([maps]); // later scan finds the Maps alias
assert.equal(db.near([33,-93,35,-91]).length,1);
assert.equal(db.history(maps).length,4);assert.equal(db.history(official).length,4,'both IDs query the unified history');
const oldRows=Array.from(data).filter(([k])=>k.includes('|rows|'));
db.observe([{...maps,wmStoreId:undefined,prices:{}}]);
// A price-less partial result must not erase an already-known provider identity.
assert.equal(db.near([33,-93,35,-91]).length,1);
db=create(KV);assert.equal(db.near([33,-93,35,-91]).length,1,'restart retains reconciliation');
assert.equal(db.recover([{...maps,prices:{}}])[0].prices.diesel.price,4,'recover missing grades from either alias');
for(const [k,v] of oldRows)assert.equal(data.get(k),v,'historical pages are not rewritten or deleted');
assert.equal(db.latest(official,'regular').price,3.1);
db.observe([neighbor]);assert.equal(db.near([33,-93,35,-91]).length,2);
for(const box of [[34,-94,35,-90],[34,-92,34.1,-88],[65,-150,66,-146],[-35,145,-34,146]]){
 const areas=K.mapAreas(box,P);assert(areas.length>0);
 for(let y=0;y<=16;y++)for(let x=0;x<=16;x++){
  const lat=box[0]+(box[2]-box[0])*y/16,lng=box[1]+(box[3]-box[1])*x/16;
  assert(areas.some(a=>P.haversineMi(lat,lng,a.lat,a.lng)<=a.radius),'all viewport points, edges and corners covered');
 }
}
assert(K.mapAreas([34,-94,35,-90],P).length>24,'no 24-area cutoff');
assert.throws(()=>K.mapAreas([-80,-170,80,170],P),/No search was started/,'unsafe world view is explicitly refused, never silently cropped');
assert.throws(()=>K.mapAreas([34,179,35,181],P),/No search was started/);
console.log('Full rectangle coverage and persistent cancelled-scan aliases, all grades/history, restart and conflicting-store safety passed');
