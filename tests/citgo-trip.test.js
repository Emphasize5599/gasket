const assert=require('node:assert/strict'),P=require('../assets/web/pricing'),T=require('../assets/web/trip');
const settings=()=>Object.assign({},P.DEFAULTS,{citgoTier:'club',cashbackPct:2,citgoUsed:{},citgoHistory:{}});
const tue=new Date(2026,9,6,12),fri=new Date(2026,9,9,12),nov=new Date(2026,10,3,12);
function candidate(id,d,price,date=tue,s=settings(),brand='citgo'){
 const station={id,brand,name:brand,prices:{regular:{price,updated:tue.toISOString()}}};
 return Object.assign({id,d,station,detourMi:0,detourMin:0},P.tripPrice(station,'regular',s,tue,date));
}
const model={totalMi:140,galTo:d=>d/10,timeTo:d=>d*60,combGpm:.1,cityGpm:.1};
const opts=cs=>({model,cands:cs,startGal:4,capGal:5,bufferGal:.5,arriveGal:.5,refPrice:2.5,fillUp:true,stopPenalty:0,step:.1});
let S=settings(),before=JSON.stringify(S),cs=[20,60,100,130].map((d,i)=>candidate('s'+i,d,3,tue,S));
let p=T.plan(opts(cs));assert(p.ok);assert(p.stops.length>=3);assert.equal(p.stops.filter(s=>s.citgoRedemption).length,1);assert.equal(p.stops.find(s=>s.buyGal>0).citgoRedemption.kind,'tuesday');
assert.equal(JSON.stringify(S),before,'planning never redeems a real reward');assert.equal(cs[0].calc.final,cs[0].price,'shared candidates stay ordinary');
assert(p.stops.slice(1).some(s=>!s.citgoRedemption),'later CITGO purchases remain allowed at everyday rewards');
assert.equal(p.easy.stops.filter(s=>s.citgoRedemption).length,1,'baseline owns independent reward state');
const tops=T.topUps(opts(cs),p,40);assert(tops.every(s=>!s.citgoRedemption),'top-ups cannot spend the same reward twice');
P.setCitgoRedeemed(S,'tuesday',P.monthKey(tue),true);assert.equal(P.citgoBonus(S,tue),'none');assert.equal(P.citgoBonus(S,fri),'friday');
P.setCitgoRedeemed(S,'tuesday',P.monthKey(nov),true);assert(P.citgoRedeemed(S,'tuesday',P.monthKey(tue)),'history retains earlier months');
P.setCitgoRedeemed(S,'tuesday',P.monthKey(nov),false);assert.equal(P.citgoBonus(S,nov),'tuesday');assert.equal(P.citgoBonus(S,tue),'none');
assert.equal(P.setCitgoRedeemed(S,'x','bad',true),false);
p=T.plan(opts(cs.map(c=>candidate(c.id,c.d,3,tue,S))));assert(p.ok);assert(p.stops.every(s=>!s.citgoRedemption));
// A later month and a different weekday have independent allowances, including crossing a non-CITGO stop.
cs=[candidate('a',20,3,tue),candidate('b',60,3,tue),candidate('c',100,3,nov),candidate('d',130,3,nov)];
p=T.plan(opts(cs));assert(p.ok);assert.equal(p.stops.filter(s=>s.citgoRedemption).length,2);
cs[2]=candidate('c',100,3,fri);cs[3]=candidate('d',130,3,fri);p=T.plan(opts(cs));assert.equal(p.stops.filter(s=>s.citgoRedemption).length,2);
// 40-gallon purchase: all Club rewards cap at 30, cashback applies to post-reward spending.
let c=candidate('large',0,3);let large=T.plan({model:{...model,totalMi:400,galTo:d=>d/10},cands:[c],startGal:0,capGal:40,bufferGal:0,arriveGal:0,refPrice:0,fillUp:true});
assert(large.ok);assert.equal(large.stops[0].buyGal,40);
assert(Math.abs(large.totals.cost-((3-.1)*40-.09*30)*.98)<.025);
assert(Math.abs(large.stops[0].c.calc.steps.reduce((sum,s)=>sum+s.amount,0)-large.stops[0].c.price)<.0011);
// Zero gallons never consumes a monthly reward, even when already full at a station.
const zero=T.optimize({...opts([candidate('z',0,3)]),model:{...model,totalMi:20},startGal:5,refPrice:0});
assert(zero.ok);assert(zero.stops.every(s=>s.buyGal>0||!s.citgoRedemption));

// Independent exhaustive oracle at a coarse grain. Verify joint station/amount/redemption optimization,
// not just post-processing the discounts on a plan produced with repeated bonuses.
function brute(o){
 const cs=o.cands.slice().sort((a,b)=>a.d-b.d),ns=[{d:0},...cs,{d:o.model.totalMi}],w=Math.round(o.capGal/o.step),arr=Math.round(o.arriveGal/o.step),buf=Math.round(o.bufferGal/o.step),memo=new Map();
 function walk(i,f,mask){const key=[i,f,mask].join('|');if(memo.has(key))return memo.get(key);if(i===ns.length-1)return -f*o.step*(o.refPrice||0);
  const c=i?ns[i]:null,r=c&&c.citgo;let best=Infinity;
  for(let g=f;g<=w;g++){if(o.fillUp&&c&&g!==w&&f!==w)continue;if(!c&&g!==f)continue;
   const buy=(g-f)*o.step,bonus=!!(r&&r.bit&&!(mask&r.bit)&&buy>0),after=bonus?mask|r.bit:mask;
   const cost=!c?0:r?buy*r.price-Math.min(buy,r.cap)*(r.ordinary+(bonus?r.extra:0)):buy*c.price;
   for(let j=i+1;j<ns.length;j++){const burn=Math.ceil((o.model.galTo(ns[j].d)-o.model.galTo(ns[i].d))/o.step-1e-9),remain=g-burn,need=j===ns.length-1?arr:buf;
    if(remain<need)continue;const next=ns[i].rewardMonth&&ns[j].rewardMonth&&ns[i].rewardMonth!==ns[j].rewardMonth?0:after;
    best=Math.min(best,cost+(j===ns.length-1?0:o.stopPenalty||0)+walk(j,remain,next));
   }
  }memo.set(key,best);return best;
 }return walk(0,Math.floor(o.startGal/o.step),0);
}
let seed=7;function rand(){seed=(seed*1664525+1013904223)>>>0;return seed/2**32;}
for(let trial=0;trial<200;trial++){
 const ordinary=trial>=100,wed=new Date(2026,9,7,12);
 const cs=[0,20,40,60,80].map((d,i)=>candidate('r'+i,d,2.5+rand(),ordinary?wed:i<3?tue:trial%3===0?nov:fri,settings(),i===2?'exxon':'citgo'));
 // Exercise the cap's two linear segments using a smaller synthetic cap as well.
 cs.forEach(c=>{if(c.citgo)c.citgo.cap=trial%2?1:30;});
 const o={...opts(cs),model:{...model,totalMi:100},step:.5,startGal:3,capGal:4,bufferGal:.5,arriveGal:.5,fillUp:trial%2===0,refPrice:2.4,stopPenalty:.15};
 const actual=T.optimize(o),expected=brute(o);assert.equal(actual.ok,Number.isFinite(expected));if(actual.ok)assert(Math.abs(actual.objective-expected)<1e-8,`${trial}: ${actual.objective} vs ${expected}`);
}
// A first stop pushes the next one past Tuesday midnight; recompute its calendar before pricing.
const depart=new Date(2026,9,6,23,0).getTime(),calendar=opts([20,60,100,130].map((d,i)=>candidate('date'+i,d,3)));
calendar.rewardDepartAt=depart;
calendar.rewardPriceAt=(c,m,stops)=>{const delay=stops.filter(s=>s.c.d<c.d).length*20*60000,at=new Date(depart+c.d*40000+delay);return {...c,...P.tripPrice(c.station,'regular',settings(),tue,at)};};
p=T.plan(calendar);assert(p.ok);for(const s of p.stops){const expected=calendar.rewardPriceAt(s.c,model,p.stops);assert.equal(s.c.citgo.bit,expected.citgo.bit);assert.equal(s.c.rewardMonth,expected.rewardMonth);assert.equal(s.c.arrivalAt,expected.arrivalAt);}
assert.equal(p.stops.filter(s=>s.citgoRedemption).length,1);
const autoRef={...calendar};delete autoRef.refPrice;const auto=T.plan(autoRef);assert(auto.ok);assert.equal(autoRef.refPrice,auto.refPrice);assert(Math.abs(auto.easy.totals.net-(auto.easy.totals.cost-auto.easy.totals.leftoverGal*auto.refPrice))<1e-8,'calendar baseline uses the same inferred leftover-fuel credit');
// A deliberately unstable boundary is conservative, not an endless replan or phantom discount.
let calls=0;const unstable={...calendar,rewardPriceAt:(c,m,stops)=>{const q=calendar.rewardPriceAt(c,m,[]);q.citgo={...q.citgo,bit:stops.length?0:1,extra:stops.length?0:.06};return q;}};
// Exercise a repeating (nonconvergent) eligibility answer independent of the chosen schedule.
unstable.rewardPriceAt=(c)=>{const phase=Math.floor(calls++/4)%2,q={...c,citgo:{...c.citgo,bit:phase?0:1,extra:phase?0:.06}};return q;};
p=T.plan(unstable);assert(p.ok);assert(p.rewardTimingUncertain);assert(p.stops.every(s=>!s.citgoRedemption));
console.log('CITGO monthly ledger, capped pricing, independent plans/top-ups, calendar boundaries and 200 exhaustive optimizer comparisons passed');
