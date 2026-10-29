const assert=require('node:assert/strict'),T=require('../assets/web/trip');
// Exact speed integration, including unsorted, overlapping and negative-rate sections.
let reads=0;const rates=Array.from({length:12000},(_,i)=>({from:i*.25,to:(i+1)*.25,get rate(){reads++;return i%2?.001:-.0003;}}));
const base=T.restoreModel({pts:[],cum:[],segs:[{from:0,to:3000,gpm:1/45,t0:0,t1:180000}],totalMi:3000,durationSec:180000,legEnds:[1500,3000],cityGpm:1/48,hwyGpm:1/45,combGpm:1/45});
const fast=T.withSpeeds(base,rates);for(let i=0;i<6000;i++)fast.galTo(i/2);assert(reads<rates.length*8,'speed integration indexes sections once, not stations times sections');
const odd=[{from:30,to:70,rate:-.003},{from:-10,to:50,rate:.002},{from:20,to:25,rate:.01},{from:120,to:150,rate:.004}],indexed=T.withSpeeds(base,odd);
for(const d of [-10,0,1,20,24.1,25,30,50,65,70,100,130,150,170])assert(Math.abs(indexed.galTo(d)-base.galTo(d)-T.extraBetween(odd,0,d))<1e-9);
const cands=Array.from({length:4000},(_,i)=>({id:'bench'+i,d:(i+.5)*2600/4000,price:3+(i*17%61)/100,detourMi:(i%7)/10,detourMin:i%5,leg:i<2000?0:1})),o={model:base,cands,startGal:8,capGal:11.4,bufferGal:1,arriveGal:1,step:.1,stopPenalty:1,maxDetourMin:30,lite:true};
// Model/fixture endpoints agree, including the station-sparse final section.
o.model=T.restoreModel({...base,segs:[{from:0,to:2600,gpm:1/45,t0:0,t1:156000}],totalMi:2600,durationSec:156000,legEnds:[1300,2600]});
const subset=T.previewCandidates(o);assert(subset.length<cands.length/6);assert.equal(o.cands,cands,'preview does not replace the inventory');assert.deepEqual(T.previewCandidates({...o,cands:cands.slice(0,100)}),cands.slice(0,100));
let at=performance.now();const exact=T.plan({...o}),fullMs=performance.now()-at;at=performance.now();const preview=T.plan({...o,cands:subset}),previewMs=performance.now()-at;
assert(exact.ok&&preview.ok);assert(preview.totals.net<=exact.totals.net*1.02,'dense-road screening remains useful for ranking');assert(preview.stops.every(s=>s.arriveGal>=o.bufferGal-1e-7),'sampling never relaxes reserve');
const rewards=cands.map((c,i)=>i===50?{...c,citgo:{bit:1,extra:.2,cap:30}}:c);assert(T.previewCandidates({...o,cands:rewards}).includes(rewards[50]));
const chargers=cands.map((c,i)=>({...c,priceKnown:true,kw:i===123?350:50,calc:{updated:1000}}));assert(T.previewCandidates({...o,cands:chargers,fuelKind:'ev',priceNow:2000,priceAgeHours:72}).includes(chargers[123]),'fast charging option retained');
const detours=T.previewCandidates({...o,maxDetourMin:1});assert(detours.every(c=>c.detourMin<=1));
console.log(JSON.stringify({miles:2600,input:cands.length,preview:subset.length,fullMs:Math.round(fullMs),previewMs:Math.round(previewMs),speedLookupRateReads:reads}));
