#!/usr/bin/env node
// Opt-in simulation of Google forecast-traffic reads (no network). A synthetic 1,300-mile route has rush-hour
// slowdowns near towns; a fake Google answers each piece with a time-dependent profile and a random delay. Compares
// the real GoogleTraffic code under different tuning: request count, wall time (scaled to phone-like delays) and
// arrival error against both the exact traffic integration and the current reader. Usage: node tools/simulate-traffic-reads.cjs
'use strict';
const G=require('../assets/web/googletraffic'),T=require('../assets/web/trip');
const MI=1609.344,SCALE=40;           // request delays are divided by SCALE in real time and reported multiplied back
let seed=+process.env.SIM_SEED||7;function rnd(){seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;}
// Route: a gentle northeast curve with a vertex every 0.5 mi.
function route(miles,lat0,lng0,bend){const pts=[{lat:lat0,lng:lng0}];let h=Math.PI/4;for(let d=.5;d<=miles;d+=.5){h+=Math.sin(d/90+bend)*.004;const p=pts[pts.length-1];pts.push({lat:p.lat+Math.cos(h)*.5/69,lng:p.lng+Math.sin(h)*.5/(69.17*Math.cos(p.lat*Math.PI/180))});}return pts;}
function model(pts){let mi=0;for(let i=1;i<pts.length;i++)mi+=T.hav(pts[i-1],pts[i]);return T.buildRoute({distanceMeters:mi*MI,duration:Math.round(mi/62*3600)+'s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:[]},{city:30,hwy:40,comb:35});}
// Traffic: towns every ~70 mi slow to 20–45 mph around 7:45 and 17:15 (local = UTC here), plus a few fixed work zones.
function field(totalMi){const towns=[];for(let m=20;m<totalMi;m+=40+rnd()*60)towns.push({m,w:2+rnd()*8,depth:.35+rnd()*.45,shift:(rnd()-.5)*40});const zones=[];for(let k=0;k<4;k++)zones.push({m:rnd()*totalMi,w:1+rnd()*2});
 return function mph(m,t){const day=((t/60000)%1440+1440)%1440;let f=1;towns.forEach(z=>{const near=Math.exp(-(((m-z.m)/z.w)**2));if(near<.01)return;const rush=Math.max(Math.exp(-(((day-465-z.shift)/45)**2)),Math.exp(-(((day-1035-z.shift)/50)**2))),night=day<300?-.05:0;f*=1-near*(z.depth*rush+night+.08);});zones.forEach(z=>{if(Math.abs(m-z.m)<z.w)f*=.6;});return 66*f;};}
function drive(mph,a,b,t,step){step=step||.1;let s=0;for(let m=a;m<b-1e-9;m+=step){const d=Math.min(step,b-m);s+=d/mph(m+d/2,t+s*1000)*3600;}return s;}
function fakeGoogle(full,mph,stats){
 return async function fetch(q){stats.requests++;const c=[...q.matchAll(/!3m2!3d(-?[\d.]+)!4d(-?[\d.]+)/g)].map(m=>({lat:+m[1],lng:+m[2]})),clock=+(/!3j(\d+)/.exec(q)[1]);
  const a=T.project(full,c[0]).along,b=T.project(full,c[1]).along,pts=[full.pointAt(a)],at=[a];full.cum.forEach((d,i)=>{if(d>a+1e-6&&d<b-1e-6){pts.push(full.pts[i]);at.push(d);}});pts.push(full.pointAt(b));at.push(b);
  const data=[[0,0]];let s=0;for(let i=1;i<at.length;i++){s+=drive(mph,at[i-1],at[i],clock*1000+s*1000);data.push([(at[i]-a)*MI,s]);}
  const meters=(b-a)*MI,r=[],root=[];r[0]=[];r[0][1]='Generic highway';r[0][2]=[meters];r[0][10]=[[s],null,3,null,[s*.9,s*1.2]];r[3]=[data];root[1]=[r];
  let la=0,ln=0;const dl=[],dg=[];pts.forEach(p=>{const A=Math.round(p.lat*1e7),B=Math.round(p.lng*1e7);dl.push(A-la);dg.push(B-ln);la=A;ln=B;});root[7]=[[dl,dg]];root[11]='!8j'+clock+'!3e0';
  stats.inflight++;stats.peak=Math.max(stats.peak,stats.inflight);const ms=(900+rnd()*1400)*(rnd()<.05?3:1);stats.delayMs+=ms;await new Promise(r=>setTimeout(r,ms/SCALE));stats.inflight--;return {body:JSON.stringify([root])};};
}
function service(full,mph,tune,slots,store){const stats={requests:0,inflight:0,peak:0,delayMs:0};const g=G.create({tune,concurrency:()=>slots,zone:async()=>'UTC',get:k=>store.get(k),put:(k,v)=>store.set(k,v),fetch:fakeGoogle(full,mph,stats)});return {g,stats};}
const pol={ttl:7*86400000,mode:'weekend'};
async function timed(fn){const t=Date.now();const v=await fn();return {v,ms:(Date.now()-t)*SCALE};}
const VARIANTS=[
 ['current',{speculate:false,tolerance:0}],
 ['shipped defaults',{}],
 ['lookahead ±1 min',{speculate:true,specTolerance:1,maxSpec:2,lookahead:8,tolerance:0}],
 ['lookahead ±2 min',{speculate:true,specTolerance:2,maxSpec:2,lookahead:8,tolerance:0}],
 ['lookahead ±5 min',{speculate:true,specTolerance:5,maxSpec:2,lookahead:8,tolerance:0}],
 ['nearby reuse ±2 min',{speculate:false,tolerance:2}],
 ['pieces 150 mi / 2°',{speculate:false,tolerance:0,pieceMi:150,cellDeg:2}],
 ['pieces 100 mi / no cells',{speculate:false,tolerance:0,cellDeg:1000}],
 ['lookahead ±2 + reuse ±2',{speculate:true,specTolerance:2,tolerance:2,maxSpec:2,lookahead:8}],
 ['lookahead ±2, 1 guess, 3 ahead',{speculate:true,specTolerance:2,maxSpec:1,lookahead:3,tolerance:0}],
 ['lookahead ±2, 1 guess, 8 ahead',{speculate:true,specTolerance:2,maxSpec:1,lookahead:8,tolerance:0}],
 ['lookahead ±2, 2 guesses, 3 ahead',{speculate:true,specTolerance:2,maxSpec:2,lookahead:3,tolerance:0}],
 ['lookahead ±2, 1 guess, 2 ahead',{speculate:true,specTolerance:2,maxSpec:1,lookahead:2,tolerance:0}],
];
async function main(){
 const pts=route(1300,34,-92,0),full=model(pts),mph=field(full.totalMi),D=Date.UTC(2027,2,1,5);
 const departs=[0,2,4,6,9,12].map(h=>D+h*3600000);
 const truth=t=>drive(mph,0,full.totalMi,t,.05);
 const exact=departs.map(truth);
 const baseline={};
 console.log('Route '+Math.round(full.totalMi)+' mi, delays 0.9–2.3 s (5% ×3), wall times are simulated phone time.\n');
 const rows=[];
 for(const [name,tune] of VARIANTS.filter(v=>!process.env.SIM_ONLY||process.env.SIM_ONLY.split('|').some(x=>v[0].includes(x)))){
  // 1. One route alone with 8 reader slots (normal planning, Depart refresh).
  let single={req:0,ms:0,err:[],vsCur:[]};
  for(let k=0;k<departs.length;k++){const store=new Map(),{g,stats}=service(full,mph,tune,8,store);const {v,ms}=await timed(()=>g.forecast(full,departs[k],{valid:()=>true,cachePolicy:pol}));single.req+=stats.requests;single.ms+=ms;single.err.push((v.seconds-exact[k])/60);if(name==='current')baseline[k]=v.seconds;else single.vsCur.push((v.seconds-baseline[k])/60);}
  // 2. Hourly screening: 12 departure hours, 8 lanes sharing 8 slots.
  let screen;{const store=new Map(),{g,stats}=service(full,mph,tune,8,store);const hours=Array.from({length:12},(_,h)=>D+h*3600000),queue=hours.slice();const {ms}=await timed(()=>Promise.all(Array.from({length:8},async()=>{while(queue.length){const t=queue.shift();await g.forecast(full,t,{valid:()=>true,cachePolicy:pol});}})));screen={req:stats.requests,ms};}
  // 3. Rest timing: 25 departures 5 minutes apart for the rest of the trip from mile 400, read one after another.
  let rest;{const store=new Map(),{g,stats}=service(full,mph,tune,8,store),Fm=require('../assets/web/traffic'),sub=Fm.slice(full,400,full.totalMi);const out=[];const {ms}=await timed(async()=>{for(let k=0;k<25;k++)out.push((await g.forecast(sub,D+6*3600000+k*300000,{valid:()=>true,cachePolicy:pol})).seconds);});
   const tr=out.map((_,k)=>drive(mph,400,full.totalMi,D+6*3600000+k*300000,.05)),err=out.map((s,k)=>(s-tr[k])/60),order=a=>a.map((x,i)=>[x,i]).sort((p,q)=>p[0]-q[0]).map(x=>x[1]);
   rest={req:stats.requests,ms,maxErr:Math.max(...err.map(Math.abs)),best:order(out)[0]===order(tr)[0],spread:(Math.max(...out)-Math.min(...out))/60};}
  // 4. Replanning after a small departure shift (0–15 min) on the same storage.
  let shift;{const store=new Map(),{g,stats}=service(full,mph,tune,8,store);await g.forecast(full,D+7*3600000,{valid:()=>true,cachePolicy:pol});const before=stats.requests;let errs=[];for(const gap of [1,3,7,12]){const t=D+7*3600000+gap*60000;const v=await g.forecast(full,t,{valid:()=>true,cachePolicy:pol});errs.push(Math.abs(v.seconds-truth(t))/60);}shift={req:stats.requests-before,maxErr:Math.max(...errs)};}
  const abs=a=>a.map(Math.abs),max=a=>a.length?Math.max(...abs(a)):0;
  rows.push({name,single,screen,rest,shift,maxErr:max(single.err),maxVsCur:max(single.vsCur)});
  process.stdout.write('.');
 }
 console.log('\n');
 const pad=(s,n)=>String(s).padEnd(n);
 console.log(pad('variant',28)+pad('1 route: s/route',18)+pad('reqs',7)+pad('err min',9)+pad('vs current',12)+pad('12 h screen s',15)+pad('reqs',7)+pad('rest 25: s',12)+pad('reqs',7)+pad('err',7)+pad('best?',7)+pad('shift reqs',11)+'shift err');
 rows.forEach(r=>console.log(pad(r.name,28)+pad((r.single.ms/departs.length/1000).toFixed(1),18)+pad(Math.round(r.single.req/departs.length),7)+pad(r.maxErr.toFixed(2),9)+pad(r.maxVsCur.toFixed(2),12)+pad((r.screen.ms/1000).toFixed(0),15)+pad(r.screen.req,7)+pad((r.rest.ms/1000).toFixed(0),12)+pad(r.rest.req,7)+pad(r.rest.maxErr.toFixed(2),7)+pad(r.rest.best?'yes':'NO',7)+pad(r.shift.req,11)+r.shift.maxErr.toFixed(2)));
 console.log('\nerr = worst |forecast − exact| trip minutes; vs current = worst difference from the current reader; rest spread '+rows[0].rest.spread.toFixed(1)+' min across the 25 departures.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
