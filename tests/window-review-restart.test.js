// The trip's roads can change while the hazard review is open (a saved trip finds its toll-free routes in the
// background). The review used to keep the old session, so every Yes / No was silently ignored and the trip was stuck
// (owner, 0.0.327). Now a tap on a stale review starts it over with the current roads.
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:360,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);
 await p.evaluate(()=>{const A=__app,start=Date.now()+86400000,local=t=>new Date(t-new Date(t).getTimezoneOffset()*60000).toISOString().slice(0,16),model={totalMi:100,durationSec:7200};
  A.S.trip.windowPlan={enabled:true,mode:'depart',start:local(start),end:local(start+3600000),destinations:[]};
  window.__key='before';window.__roads=[{key:'road',model,name:'Test road'}];window.__done=0;
  window.__w=WindowPlanning.init(A,{key:()=>__key,routes:()=>[__roads],destinations:()=>['End'],rows:roads=>roads.map(r=>({leg:0,routeKey:r.routeKey,model,depart:start,reading:{hazards:[],stats:{points:2,weather:2,errors:0}}})),read:async r=>r.reading,canAuto:()=>true,confirm:async()=>true,reviewed:()=>__done++});__w.review();});
 await p.waitForFunction(()=>/Road 1 of 1/.test(document.querySelector('#twReview')?.textContent||''));
 // a toll-free route turns up while the question is on screen
 await p.evaluate(()=>{__key='after';__roads.push({key:'free',model:__roads[0].model,name:'Test road · no tolls'});});
 await p.click('#twYes');
 await p.waitForFunction(()=>/Road 1 of 2/.test(document.querySelector('#twReview')?.textContent||''),null,{timeout:5000});
 assert.equal(await p.locator('.time-review-page').count(),1,'one review page, started over with the current roads');
 await p.click('#twYes');await p.waitForFunction(()=>/Road 2 of 2/.test(document.querySelector('#twReview')?.textContent||''));await p.click('#twNo');
 await p.waitForFunction(()=>__done===1,null,{timeout:10000});
 assert(await p.evaluate(()=>__w.current().reviewed),'the review finishes once answered');
 assert.deepEqual(errors,[]);await p.close();
 console.log('A hazard review whose roads change while open starts over instead of ignoring taps passed');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
