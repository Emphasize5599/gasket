// Forecast traffic reads: lookahead reads use idle reader slots so a long route's pieces don't wait on each other, but
// never take slots other routes are waiting on; a stored piece a minute or two off is reused; in-order matching gives
// the same projection as the whole-route search. Results stay within the tolerance of the one-at-a-time reader.
const assert=require('node:assert/strict'),G=require('../assets/web/googletraffic'),T=require('../assets/web/trip');
const MI=1609.344,pts=[];for(let k=0;k<=600;k++)pts.push({lat:34.003+k*.5/69,lng:-92});
let mi=0;for(let i=1;i<pts.length;i++)mi+=T.hav(pts[i-1],pts[i]);
const route=T.buildRoute({distanceMeters:mi*MI,duration:Math.round(mi/62*3600)+'s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:[]},{city:30,hwy:40,comb:35});
const t0=Date.UTC(2027,2,1,12);
// Speeds drift slowly with the clock, so later pieces' departures depend on the earlier ones.
function mph(t){return 50+4*Math.sin(t/7200000);}
function service(o){
  const stats={requests:0,active:0,peak:0},store=new Map();
  const g=G.create({tune:o.tune,concurrency:()=>o.slots,zone:async()=>'UTC',get:k=>store.get(k),put:(k,v)=>store.set(k,v),fetch:async q=>{stats.requests++;stats.active++;stats.peak=Math.max(stats.peak,stats.active);
    const c=[...q.matchAll(/!3m2!3d(-?[\d.]+)!4d(-?[\d.]+)/g)].map(m=>({lat:+m[1],lng:+m[2]})),clock=+(/!3j(\d+)/.exec(q)[1]);
    const a=T.project(route,c[0]).along,b=T.project(route,c[1]).along,line=[route.pointAt(a)],at=[a];route.cum.forEach((d,i)=>{if(d>a+1e-6&&d<b-1e-6){line.push(route.pts[i]);at.push(d);}});line.push(route.pointAt(b));at.push(b);
    const data=[[0,0]];let s=0;for(let i=1;i<at.length;i++){s+=(at[i]-at[i-1])/mph(clock*1000+s*1000)*3600;data.push([(at[i]-a)*MI,s]);}
    const r=[],root=[];r[0]=[];r[0][1]='Generic highway';r[0][2]=[(b-a)*MI];r[0][10]=[[s],null,3,null,[s,s]];r[3]=[data];root[1]=[r];
    let la=0,ln=0;const dl=[],dg=[];line.forEach(p=>{const A=Math.round(p.lat*1e7),B=Math.round(p.lng*1e7);dl.push(A-la);dg.push(B-ln);la=A;ln=B;});root[7]=[[dl,dg]];root[11]='!8j'+clock+'!3e0';
    await new Promise(r=>setTimeout(r,15));stats.active--;return {body:JSON.stringify([root])};}});
  return {g,stats};
}
const pol={ttl:86400000};
(async()=>{
  const off={speculate:false,tolerance:0},on=undefined;   // undefined = the shipped defaults
  const one=service({tune:off,slots:8}),plain=await one.g.forecast(route,t0,{valid:()=>true,cachePolicy:pol});
  assert.equal(one.stats.peak,1,'without lookahead one route reads one piece at a time');
  const fast=service({tune:on,slots:8});let t=Date.now();const ahead=await fast.g.forecast(route,t0,{valid:()=>true,cachePolicy:pol});const ms=Date.now()-t;
  assert(fast.stats.peak>1,'lookahead reads run alongside the current piece');
  assert(ahead.lookaheadUsed>0,'and their answers are used');
  assert(fast.stats.requests<=plain.legs.length*2,'at most one extra read per piece: '+fast.stats.requests+' for '+plain.legs.length);
  assert(Math.abs(ahead.seconds-plain.seconds)<=120,'within two minutes of the one-at-a-time reader: '+(ahead.seconds-plain.seconds));
  assert.equal(ahead.legs.length,plain.legs.length);
  // Busy readers: as many routes as reader slots leave no idle slot; only the last routes to finish get a little lookahead.
  const hours=[0,1,2,3].map(h=>t0+h*3600000),timedRun=async tune=>{const x=service({tune,slots:4}),s=Date.now();await Promise.all(hours.map(h=>x.g.forecast(route,h,{valid:()=>true,cachePolicy:pol})));return {ms:Date.now()-s,requests:x.stats.requests};};
  const busyPlain=await timedRun(off),busy=await timedRun(on);
  assert(busy.requests<=busyPlain.requests+4,'routes waiting on readers leave no slot for lookahead: '+busy.requests+' vs '+busyPlain.requests);
  assert(busy.ms<=busyPlain.ms*1.25+30,'and are not slowed by it: '+busy.ms+' vs '+busyPlain.ms+' ms');
  // Nearby reuse: a departure a minute later reuses the stored pieces; five minutes later reads again.
  const near=service({tune:on,slots:1});await near.g.forecast(route,t0,{valid:()=>true,cachePolicy:pol});const n0=near.stats.requests;
  const later=await near.g.forecast(route,t0+60000,{valid:()=>true,cachePolicy:pol});assert.equal(near.stats.requests,n0,'a departure a minute off reuses every piece');assert(later.cached);
  await near.g.forecast(route,t0+5*60000,{valid:()=>true,cachePolicy:pol});assert(near.stats.requests>n0,'five minutes off reads again (rest timing samples every 5 minutes)');
  // A cancelled route drops its queued lookahead reads.
  const stop=service({tune:on,slots:2});let live=true;const job=stop.g.forecast(route,t0+7200000,{valid:()=>live,cachePolicy:pol});setTimeout(()=>{live=false;},20);await assert.rejects(job,/cancelled/);await new Promise(r=>setTimeout(r,80));assert(stop.stats.requests<=4,'no reads keep going after a cancel: '+stop.stats.requests);
  // In-order matching gives the whole-route search's answer.
  const dense=[];for(let k=0;k<=4000;k++)dense.push(route.pointAt(k*.025));const cum=[0];dense.forEach((p,i)=>{if(i)cum.push(cum[i-1]+T.hav(dense[i-1],p));});
  const fast2=await G.projectAll(route,{pts:dense,cum});dense.forEach((p,i)=>{const x=T.project(route,p);assert(Math.abs(x.along-fast2[i].along)<1e-6&&Math.abs(x.offset-fast2[i].offset)<1e-6,'point '+i);});
  console.log('Traffic lookahead: idle-slot reads, used answers, busy-reader guard, nearby reuse, cancel and in-order matching passed ('+ms+' ms vs one at a time)');
})().catch(e=>{console.error(e);process.exitCode=1;});
