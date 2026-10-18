// Tolls on route options (tolls.js): Google's estimate, Maps' "has tolls", your amounts, toll-free merging, trip sums.
const assert=require('node:assert/strict'),T=require('../assets/web/tolls.js');
const r=(desc,mi,o)=>Object.assign({description:desc,distanceMeters:mi*1609.344,duration:mi*60+'s'},o);
// Routes API: an estimate, tolls of unknown amount, none at all on a route that was asked about
const toll=r('I-44 E',103,{tollsAsked:true,travelAdvisory:{tollInfo:{estimatedPrice:[{currencyCode:'USD',units:'7',nanos:250000000},{currencyCode:'USD',units:'2'}]}}});
assert.deepEqual(T.ofRoute(toll),{has:true,cost:9.25,src:'google'});
assert.deepEqual(T.ofRoute(r('x',5,{travelAdvisory:{tollInfo:{}}})),{has:true,cost:null,src:'google'},'tolls, amount not given');
assert.deepEqual(T.ofRoute(r('x',5,{tollsAsked:true})),{has:false,cost:0,src:'google'},'asked and no tollInfo = no tolls');
assert.deepEqual(T.ofRoute(r('x',5,{})),{has:null,cost:null,src:null},'never asked: unknown, not free');
// Maps website: yes/no only; your amount wins
const web=r('I-44 E',103,{websiteTolls:true});
assert.deepEqual(T.ofRoute(web),{has:true,cost:null,src:'maps'});
assert.deepEqual(T.ofRoute(web,{[T.sig(web)]:6.5}),{has:true,cost:6.5,src:'you'});
assert.deepEqual(T.ofRoute(r('x',5,{websiteTolls:false})),{has:false,cost:0,src:'maps'});
// toll-free routes: a new road joins as "· no tolls"; the same road already listed is marked; a toll road is never "the same"
const free=r('US-66 E',118,{}),overlap=(a,b)=>a.description.replace(/ · no tolls$/,'')===b.description?1:0;
let list=T.addTollFree([web],[free],overlap);
assert.equal(list.length,2);assert.equal(list[1].description,'US-66 E · no tolls');assert.equal(T.ofRoute(list[1]).has,false);
assert.equal(T.sig(list[1]),T.sig(free),'the signature ignores the label suffix');
const plain=r('US-66 E',118,{});list=T.addTollFree([web,plain],[free],overlap);assert.equal(list.length,2);assert.equal(list[1].tollFree,true,'Google\'s own toll-free option is marked, not listed twice');
list=T.addTollFree([r('I-44 E',103,{websiteTolls:true})],[r('I-44 E',103,{})],()=>1);assert.equal(list.length,2,'overlapping but tolled: both stay');
// whole trips and comparisons: unknown stays unknown
assert.deepEqual(T.ofTrip([toll,r('b',4,{tollFree:true})]).cost,9.25);
assert.equal(T.ofTrip([toll,web]).cost,null,'a leg with tolls of unknown amount = the trip\'s tolls unknown');
assert.equal(T.ofTrip([toll,r('never asked',3,{})]).cost,9.25,'a leg nobody asked about counts as none');
assert.equal(T.diff(T.ofTrip([r('a',1,{})]),T.ofTrip([r('b',2,{})])),0,'tolls not compared: no difference (as before tolls were counted)');
assert.equal(T.diff(T.ofTrip([toll]),T.ofTrip([r('f',1,{tollFree:true})])),9.25);
assert.equal(T.diff(T.ofTrip([web]),T.ofTrip([r('f',1,{tollFree:true})])),null,'unknown amount vs none: no comparison');
assert.equal(T.diff(T.ofTrip([r('a',1,{tollFree:true})]),T.ofTrip([r('f',1,{tollFree:true})])),0);
assert.equal(T.text({has:true,cost:9.25}),'Tolls about $9.25');assert.equal(T.text({has:false,cost:0}),'No tolls');
console.log('Toll estimates, Maps toll flags, your amounts, toll-free merging and trip comparisons passed');
