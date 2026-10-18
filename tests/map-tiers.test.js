// One gas station listed several times by Google Maps (fuel brand, store, old brand) is one station; zoomed-out maps
// show only the cheapest few percent.
const assert=require('node:assert/strict'),P=require('../assets/web/pricing.js');
const at=(lat,lng,o)=>Object.assign({source:'Google Maps web',google:true,brand:'other',prices:{},lat,lng},o);
const pr=(v,t)=>({regular:{price:v,observedAt:t||1}});

// a store and its fuel brand at one address: one station, the priced listing's identity, the brand it names
let m=P.mergeSites([
  at(34.0001,-92,{id:'web:a',featureId:'a',name:'Trimble Food Mart',address:'16610 TN-211',prices:pr(3.49)}),
  at(34.00012,-92.00001,{id:'web:b',featureId:'b',name:'Exxon',brand:'exxon',address:'16610 TN-211'}),
  at(34.0003,-92.0002,{id:'web:c',featureId:'c',name:'Barbers Market',address:'16610 TN-211'}),
]);
assert.equal(m.length,1,'three listings of one site are one station');
assert.equal(m[0].id,'web:a','the listing with the price stays');assert.equal(m[0].brand,'exxon','takes the one fuel brand named');
assert.equal(m[0].prices.regular.price,3.49);assert.equal(m[0].siteListings,3);
assert(['exxon|web:b','other|web:c'].every(k=>m[0].stationAliases.includes(k)),'the others become aliases (price history, refresh)');

// two stations really sharing a corner post different prices: kept apart
m=P.mergeSites([at(35,-91,{id:'web:d',name:'Amoco',address:'30581 US-441',prices:pr(3.50)}),at(35.0001,-91,{id:'web:e',name:'Amoco Petro Express',address:'30581 US-441',prices:pr(3.46)})]);
assert.equal(m.length,2,'different prices = different stations');
// same price twice (the same pumps listed twice): one
m=P.mergeSites([at(35,-91,{id:'web:d',name:'Shell',address:'305 Graham St',prices:pr(4.1,5)}),at(35.0001,-91,{id:'web:e',name:'Sunoco',address:'305 Graham St',prices:pr(4.1,9)})]);
assert.equal(m.length,1);assert.equal(m[0].prices.regular.observedAt,9,'the newer observation is kept');
// neighbours 0.3 mi apart, an official Walmart store beside a Maps listing, and a crowded block of 5 are left alone
assert.equal(P.mergeSites([at(36,-90,{id:'1',name:'A',address:'1 Main St'}),at(36.004,-90,{id:'2',name:'B',address:'9 Elm St'})]).length,2);
assert.equal(P.mergeSites([at(36,-90,{id:'1',name:'Walmart',brand:'walmart',address:'1 Main St'}),{id:'wm-5',brand:'walmart',source:'walmart.com',wmStoreId:5,lat:36,lng:-90,prices:pr(3.1)}]).length,2);
assert.equal(P.mergeSites(Array.from({length:5},(_,i)=>at(37,-90+i*1e-5,{id:'x'+i,name:'S'+i,address:'100 Main St'}))).length,5,'a group over four is not trusted');
// same street number, but the second listing is 0.06 mi off: two
assert.equal(P.mergeSites([at(38,-90,{id:'1',name:'A',address:'420 E Kingshighway'}),at(38.00087,-90,{id:'2',name:'B',address:'420 Kingshighway Rd'})]).length,2);

// zoom tiers
const items=Array.from({length:2000},(_,i)=>({id:'s'+i,price:i<1500?3+i/1000:null}));
const t=z=>P.mapTier(items,z);
assert.equal(t(6).shown,15,'zoomed far out: the cheapest 1% of priced stations');
assert.equal(t(8).shown,30);assert.equal(t(9).shown,75);assert.equal(t(10).shown,150);assert.equal(t(11).shown,300,'at most 300');
assert(t(6).ids.has('s0')&&!t(6).ids.has('s15'),'the cheapest');
assert.equal(t(12).shown,2000);assert.equal(t(12).all,true,'a few towns across: every station, unpriced too');
assert.equal(t(11.6).shown,300,'fractional zooms use the tier below');
assert.equal(P.mapTier(items.slice(0,50),7).shown,12,'at least twelve');
const keep=items.map(x=>x.id==='s1999'?Object.assign({},x,{keep:true}):x);assert(P.mapTier(keep,6).ids.has('s1999'),'the selected station always shows');
assert.equal(P.mapTier(items.slice(0,10),6).all,true,'few stations: all of them');
console.log('Site merging and map tiers passed');
