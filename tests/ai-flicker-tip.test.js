const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.setDefaultTimeout(6000);p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.clock.install();
 await p.evaluate(()=>{
  window.aiTipRequests=[];window.aiTipState={enabled:true,ready:true,supported:true,busy:false,phase:'idle',cpuOnly:false,revision:'flicker-fixture'};
  __app.N.aiStatus=()=>JSON.stringify(aiTipState);__app.N.aiCommand=(id,cmd)=>onNativeResult(id,{...aiTipState});
  __app.N.aiGenerate=(id,prompt)=>{aiTipRequests.push(id);Object.assign(aiTipState,{busy:true,task:'advice',phase:'generate',backend:aiTipState.cpuOnly?'CPU':'GPU'});onGemmaStatus({...aiTipState});};
  window.completeTipAI=()=>{onNativeResult(aiTipRequests.at(-1),{text:JSON.stringify({summary:'The checked tread needs attention.',top:[{n:1,why:'Tread affects grip.'}]})});Object.assign(aiTipState,{busy:false,task:'',phase:'idle'});onGemmaStatus({...aiTipState});};
  __app.S.cars=[];onGemmaStatus({...aiTipState});
 });
 const shown=async()=>{for(let i=0;i<40;i++){if(await p.locator('#taskNotice').isVisible())return true;await p.clock.runFor(50);}return false;};
 // Native completion resolves the generation promise before the queue-drain
 // debounce runs. Wait for that observable state, not a fixed 500 ms race.
 const until=async(fn,label)=>{for(let i=0;i<80;i++){if(await p.evaluate(fn))return;await p.clock.runFor(50);}assert.fail(label+' at '+width+'px: '+JSON.stringify(await p.evaluate(()=>({requests:aiTipRequests.length,state:Gemma.status(),tasks:Tasks.list().map(x=>x.id)}))));};
 const drain=async()=>{await p.evaluate(()=>completeTipAI());await until(()=>__app.S.cars.every(c=>Gemma.answer(c))&&!Tasks.list().some(x=>x.id==='gemma-advice'),'AI batch did not drain');};
 await p.clock.runFor(400);assert(!await p.locator('#taskNotice').isVisible(),'idle enable/status is not a new AI job');
 await p.evaluate(()=>Tasks.upsert('station-tip-fixture',{text:'Discovering stations…'}));await p.clock.runFor(30);assert(!await p.locator('#taskNotice').isVisible(),'ordinary station jobs do not show AI tip');await p.evaluate(()=>Tasks.remove('station-tip-fixture'));
 await p.evaluate(()=>{__app.S.cars=[2,3].map((depth,i)=>({id:'tip-car-'+i,name:'Example car',info:{drive:'fwd'},tires:{type:'Touring',tread:{mode:'measure',depth},spare:{kind:'kit'}}}));__app.S.carId='tip-car-0';dispatchEvent(new Event('garagechange'));});
 await p.clock.runFor(400);assert.equal(await p.evaluate(()=>aiTipRequests.length),1);assert(await shown(),'notice when the AI job starts');assert.match(await p.locator('#taskNotice').innerText(),/Disable HW overlays/);
 const tip=await p.locator('#taskNotice').boundingBox(),bar=await p.locator('#jobBar').boundingBox();assert(tip.y>=bar.y+bar.height,'notice below status bar');assert(tip.x>=0&&tip.x+tip.width<=width,'notice within viewport');
 assert(!await p.locator('#visualMarker').isVisible(),'glitch marker is opt-in');assert.equal(await p.locator('#sVisualMark,#gemmaGraphics').count(),0,'failed experiment and duplicate marker removed');
 await require('./settings-ui')(p,'ai');await p.clock.runFor(50);await p.evaluate(()=>document.documentElement.style.fontSize='130%');await p.clock.runFor(50);
 assert(!await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'full menu fits enlarged text');const noticeBottom=await p.locator('#taskNotice').evaluate(e=>e.getBoundingClientRect().bottom);assert((await p.locator('#settingsTitle').boundingBox()).y>=noticeBottom,'menu moves below notice');
 await p.locator('#taskNotice button').click();await p.clock.runFor(30);assert(!await p.locator('#taskNotice').isVisible());
 await p.evaluate(()=>completeTipAI());await until(()=>aiTipRequests.length===2,'Second car did not start');assert(!await p.locator('#taskNotice').isVisible(),'dismissed tip does not return for next car');
 await drain();await p.evaluate(()=>Gemma.retry());await until(()=>aiTipRequests.length===3,'Manual job did not start');assert(await shown(),'a later manual job can show a new tip');
 await p.clock.runFor(9000);assert(await p.locator('#taskNotice').isVisible(),'tip survives nine seconds');await p.clock.runFor(1100);assert(!await p.locator('#taskNotice').isVisible(),'tip expires after ten seconds');
 await p.evaluate(()=>onGemmaStatus({...aiTipState}));await p.clock.runFor(200);assert(!await p.locator('#taskNotice').isVisible(),'progress does not reset the timeout');
 await drain();await p.evaluate(()=>{aiTipState.cpuOnly=true;onGemmaStatus({...aiTipState});Gemma.retry();});await until(()=>aiTipRequests.length===4,'CPU job did not start');assert(!await p.locator('#taskNotice').isVisible(),'CPU-only work does not show GPU workaround');
 await drain();await p.evaluate(()=>{aiTipState.cpuOnly=false;onGemmaStatus({...aiTipState});Gemma.retry();});await until(()=>aiTipRequests.length===5,'GPU job did not restart');assert(await shown(),'GPU again shows it');
 await p.evaluate(()=>{aiTipState.backend='CPU';onGemmaStatus({...aiTipState});});await p.clock.runFor(30);assert(!await p.locator('#taskNotice').isVisible(),'CPU fallback hides hint');
 assert.deepEqual(errors,[]);await p.close();
}}finally{await b.close();}
const main=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8');assert(!/AiGraphicsMode|setLayerType|onAiGraphicsStatus/.test(main),'no experimental rendering remains');
assert(!fs.existsSync('src/com/bensanzone/fuelmap/AiGraphicsMode.java'));assert(!fs.readFileSync('assets/web/app.js','utf8').includes('sVisualMark'));
console.log('AI-only tip: start, once per batch, dismiss/ten-second expiry, CPU fallback, full-menu/enlarged layout and experiment removal passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
