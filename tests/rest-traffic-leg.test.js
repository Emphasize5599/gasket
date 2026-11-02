const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),P=require('../assets/web/restplan');
// 0.0.347 (owner screenshot: "59 min over free flow over the next 2012 mi"): a rest's traffic is compared over the rest of its own leg.
const src=fs.readFileSync('assets/web/tripui.js','utf8'),fn=src.slice(src.indexOf('  function restHorizon(d){'),src.indexOf('  async function restSetTime('));
const ctx={model:{legEnds:[749.6,1320,2069,2640],totalMi:2640},windows:{enabled:()=>true,arrivals:()=>[{start:0,end:1},{start:0,end:1},{start:0,end:1},{start:0,end:1}]}};vm.createContext(ctx);vm.runInContext(fn,ctx);
let h=ctx.restHorizon(300);assert.deepEqual([h.to,h.stop,h.leg],[749.6,1,0],'leg 1 rest: to the end of leg 1 only, even with arrival windows on every destination');assert.equal(Math.round(h.mi),450);
h=ctx.restHorizon(1500);assert.deepEqual([h.to,h.stop],[2069,3],'a later leg: to its own end');
h=ctx.restHorizon(749.6);assert.equal(h.to,1320,'exactly at a stop: the next leg');
ctx.model={legEnds:[],totalMi:120};h=ctx.restHorizon(10);assert.equal(h.to,120);
// Free flow = the stretch's no-traffic time, not the sum of Google's "typically" range lows (which made every hour 59+ min "over").
const rs=fs.readFileSync('assets/web/restui.js','utf8'),free=rs.slice(rs.indexOf('  function freeOf(q)'),rs.indexOf('  function readout('));const fc={};vm.createContext(fc);vm.runInContext(free,fc);
// A 450-mi leg in light traffic: Google predicts 410 min, its typical-range lows sum to 352, the road's no-traffic time is 405.
const light={seconds:410*60,lowSeconds:352*60,baseSeconds:405*60},rush={seconds:470*60,lowSeconds:380*60,baseSeconds:405*60};
const z=P.zones([{depart:1,drivingMinutes:light.seconds/60,freeMinutes:fc.freeOf(light),coverage:1},{depart:2,drivingMinutes:rush.seconds/60,freeMinutes:fc.freeOf(rush),coverage:1}],30);
assert.equal(z[0].delayMinutes,5);assert.equal(z[0].zone,'green','light traffic is green, not 58 min over');assert.equal(z[1].delayMinutes,65);assert.equal(z[1].zone,'red');
// A sampled departure faster than the road's normal time becomes the reference (never a negative delay).
const fast=P.zones([{drivingMinutes:390,freeMinutes:405},{drivingMinutes:420,freeMinutes:405}],30);assert.equal(fast[0].delayMinutes,0);assert.equal(fast[1].delayMinutes,30);
assert.equal(fc.freeOf({seconds:100}),null);
assert(!/REST_HORIZON_MI/.test(src),'no fixed whole-trip horizon');
console.log('Rest traffic compared per leg against the leg\'s no-traffic time');
// 0.0.348: tolerance for the whole trip or each leg; a leg = between your own stops, so an added rest doesn't renumber it.
{const fn2=src.slice(src.indexOf('  function restSegments(){'),src.indexOf('  function restHorizon(d){'));
 const c={S:{trip:{}},windows:null,A:{save(){}},route:{stops:[{label:'Home',lat:34,lng:-92},{label:'Rest A',rest:{},lat:35,lng:-90},{label:'Bristol',lat:36.6,lng:-82.2},{label:'Home',lat:34,lng:-92}]},model:{legEnds:[300,749,1320],totalMi:1320}};vm.createContext(c);vm.runInContext(fn2,c);
 assert.deepEqual(c.restSegments().map(g=>g.from+'>'+g.to),['Home>Bristol','Bristol>Home'],'two legs between your own stops; the rest is inside leg 1');
 assert.equal(c.restSegmentAt(0),0);assert.equal(c.restSegmentAt(300),0,'leaving the added rest is still leg 1');assert.equal(c.restSegmentAt(749),1,'leaving Bristol = leg 2');assert.equal(c.restSegmentAt(1000),1);
 assert.equal(c.restTolerance(300),30,'unset = the old 30-min default');
 c.S.trip.restTraffic={mode:'trip',minutes:15,sig:c.restSegSig()};assert.equal(c.restTolerance(300),15);assert.equal(c.restTolerance(1000),15);
 c.S.trip.restTraffic={mode:'leg',minutes:15,legs:{1:45},sig:c.restSegSig()};assert.equal(c.restTolerance(300),15,'a blank leg uses the whole-trip value');assert.equal(c.restTolerance(1000),45);
 c.route.stops[2]={label:'Knoxville',lat:35.96,lng:-83.92};assert.equal(c.restTolerance(1000),15,'per-leg values from another trip are not applied');
 c.windows={enabled:()=>true,config:()=>({delayMinutes:20})};c.S.trip.restTraffic=null;assert.equal(c.restTolerance(10),20,'with time windows on, unset = the window traffic allowance as before');}
console.log('Rest traffic tolerance per leg or for the whole trip');
