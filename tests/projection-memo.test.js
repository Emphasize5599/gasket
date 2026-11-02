const assert=require('node:assert/strict'),T=require('../assets/web/trip');
const pts=[{lat:34,lng:-92},{lat:35,lng:-92}],cum=[0,100],m={pts,cum},p={lat:34.5,lng:-91.99};
assert.deepEqual(T.project({pts:[]},p),{along:0,offset:Infinity});assert.equal(T.project({pts:[p]},p).offset,0);
const first=T.project(m,p);assert.equal(first.along,50);assert(first.offset>0);
first.along=-123;assert.equal(T.project(m,p).along,50,'callers cannot mutate cached geometry');
assert.equal(T.project({...m,cum:[0,200]},p).along,100,'distance scaling participates in cache identity');
p.lat=34.75;assert.equal(T.project(m,p).along,75,'point coordinates, not mutable station identity');
assert.equal(T.project({pts:[{lat:34,lng:-92},{lat:36,lng:-92}],cum},p).along,37.5,'different geometry does not inherit another route projection');
assert.deepEqual(T.project(m,{lat:34.75,lng:-91.99}),T.project(m,p));
console.log('Repeated route projections preserve exact results, point changes, geometry identity, scaling and caller isolation');

// A large saved inventory must fit the memo: 4,096 slots thrashed on the owner's ~8,000 stations.
const fs=require('node:fs'),vm=require('node:vm'),ctx={module:{exports:{}},require:n=>require('../assets/web/'+n),calculations:0};vm.createContext(ctx);vm.runInContext(fs.readFileSync('assets/web/trip.js','utf8').replace('function project0(model, p) {','function project0(model, p) { calculations++;'),ctx);const big=ctx.module.exports,inventory=Array.from({length:8028},(_,i)=>({lat:34+i/10000,lng:-91.99}));inventory.forEach(p=>big.project(m,p));const initial=ctx.calculations;inventory.forEach(p=>big.project(m,p));assert.equal(ctx.calculations,initial,'second pass reuses every unchanged projection instead of repeatedly scanning the same geometry');
