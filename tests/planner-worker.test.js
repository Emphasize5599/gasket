const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await browser.newPage();await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
 const result=await p.evaluate(async()=>{
  const total=1000,segs=Array.from({length:8000},(_,i)=>({from:i/8,to:(i+1)/8,gpm:i%2?.04:.05,t0:i*8,t1:(i+1)*8})),base=Trip.restoreModel({pts:[],cum:[],segs,totalMi:total,durationSec:64000,legEnds:[500,1000],cityGpm:.05,hwyGpm:.04,combGpm:.045});
  let maxError=0;for(let d=0;d<total;d+=7.3){let gal=0;for(const s of segs){gal+=Math.max(0,Math.min(d,s.to)-s.from)*s.gpm;if(d<=s.to)break;}maxError=Math.max(maxError,Math.abs(gal-base.galTo(d)));}
  const date=new Date(2026,9,6,12),discounts={...Pricing.DEFAULTS,citgoTier:'club',citgoUsed:{},citgoHistory:{}},reward=Pricing.tripPrice({id:'citgo',brand:'citgo',prices:{regular:{price:3,updated:date.toISOString()}}},'regular',discounts,date,date);
  const cands=Array.from({length:220},(_,i)=>({id:'s'+i,d:i*total/220,price:i%9?3.1:3,detourMi:.2,detourMin:1,...(i%9?{}:reward)})),opts={model:Trip.withSpeeds(base,[{from:0,to:500,rate:.001}]),cands,startGal:15,capGal:15,bufferGal:1,arriveGal:1,step:.1,stopPenalty:1,legPolicies:[{from:0,to:500,bufferGal:1},{from:500,to:1000,bufferGal:2}]};
  let workerCreations=0;const NativeWorker=Worker;window.Worker=function(...args){workerCreations++;return new NativeWorker(...args);};
  let ticks=0;const timer=setInterval(()=>ticks++,1),t=performance.now(),background=await Planner.run({...opts});clearInterval(timer);const workerMs=performance.now()-t;
  const before=performance.now(),direct=Trip.plan({...opts}),mainMs=performance.now()-before;
  // Calendar callback parity is checked separately with a real CITGO station.
  const station={id:'reward',brand:'citgo',prices:{regular:{price:3,updated:date.toISOString()}}},context={departAt:+date,now:+date,discounts:{citgoTier:'club',citgoUsed:{},citgoHistory:{}},grade:'regular'};
  const dated={...opts,cands:opts.cands.map(c=>({...c,station})),rewardDepartAt:+date};dated.rewardPriceAt=(c,m,stops)=>{const arrival=new Date(+date+(m.timeTo(c.d)+(stops||[]).filter(s=>s.c.d<c.d).reduce((n,s)=>n+(s.c.detourMin||0)+8,0)*60)*1000);return {...c,...Pricing.tripPrice(station,'regular',context.discounts,date,arrival)};};
  const calendar=await Planner.run({...dated},context),calendarDirect=Trip.plan({...dated});
  let fueledSame=true;
  for(const kind of ['gas','h2']){
   const fo={...dated,fuelKind:kind,stopMinutes:3};fo.rewardPriceAt=(c,m,stops)=>{const arrival=new Date(+date+(m.timeTo(c.d)+(stops||[]).filter(s=>s.c.d<c.d).reduce((n,s)=>n+Trip.stopDelay(fo,s),0)*60)*1000);return {...c,...Pricing.tripPrice(station,'regular',context.discounts,date,arrival)};};
   const fp=await Planner.run({...fo},context),direct=Trip.plan({...fo});fueledSame=fueledSame&&JSON.stringify(fp)===JSON.stringify(direct)&&fp.stops.every(s=>Number.isFinite(s.etaSec));
  }
  // several plans at once go to several workers (the buffer sweep, other routes), each the same as on the page
  const buffers=[1,2,3,4],t2=performance.now(),many=await Promise.all(buffers.map(g=>Planner.run({...opts,bufferGal:g,arriveGal:g}))),parallelMs=performance.now()-t2;
  const manySame=many.every((x,i)=>JSON.stringify(x)===JSON.stringify(Trip.plan({...opts,bufferGal:buffers[i],arriveGal:buffers[i]})));
  return {pool:Planner.workers(),size:Planner.size(),parallelMs,manySame,maxError,workerCreations,ticks,workerMs,mainMs,same:JSON.stringify(background)===JSON.stringify(direct),calendarSame:JSON.stringify(calendar)===JSON.stringify(calendarDirect),fueledSame};
 });
 assert(result.maxError<1e-8);assert(result.workerCreations>=1&&result.workerCreations<=result.size,'actual workers, at most the pool size');assert(result.manySame,'parallel plans match the page');assert(result.size<2||result.pool>1,'plans run side by side in several workers');assert(result.ticks>1,'UI timer keeps running during planner work');assert(result.same);assert(result.calendarSame);assert(result.fueledSame,'amount-based gas/hydrogen timing matches in worker and main-page planner');console.log('Worker parity, CITGO calendar, speed overrides, binary fuel integration and UI responsiveness:',JSON.stringify(result));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
