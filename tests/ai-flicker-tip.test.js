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
 await p.clock.runFor(400);assert(!await p.locator('#taskNotice').isVisible(),'idle enable/status is not a new AI job');
 await p.evaluate(()=>Tasks.upsert('station-tip-fixture',{text:'Discovering stations…'}));await p.clock.runFor(30);assert(!await p.locator('#taskNotice').isVisible(),'ordinary station jobs do not show AI tip');await p.evaluate(()=>Tasks.remove('station-tip-fixture'));
 await p.evaluate(()=>{__app.S.cars=[2,3].map((depth,i)=>({id:'tip-car-'+i,name:'Example car',info:{drive:'fwd'},tires:{type:'Touring',tread:{mode:'measure',depth},spare:{kind:'kit'}}}));__app.S.carId='tip-car-0';dispatchEvent(new Event('garagechange'));});
 await p.clock.runFor(400);assert.equal(await p.evaluate(()=>aiTipRequests.length),1);assert(await p.locator('#taskNotice').isVisible());assert.match(await p.locator('#taskNotice').innerText(),/Disable HW overlays/);
 const tip=await p.locator('#taskNotice').boundingBox(),bar=await p.locator('#jobBar').boundingBox();assert(tip.y>=bar.y+bar.height,'notice below status bar');assert(tip.x>=0&&tip.x+tip.width<=width,'notice within viewport');
 assert(!await p.locator('#visualMarker').isVisible(),'glitch marker is opt-in');assert.equal(await p.locator('#sVisualMark,#gemmaGraphics').count(),0,'failed experiment and duplicate marker removed');
 await require('./settings-ui')(p,'ai');await p.clock.runFor(50);await p.evaluate(()=>document.documentElement.style.fontSize='130%');await p.clock.runFor(50);
 assert(!await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'full menu fits enlarged text');const noticeBottom=await p.locator('#taskNotice').evaluate(e=>e.getBoundingClientRect().bottom);assert((await p.locator('#settingsTitle').boundingBox()).y>=noticeBottom,'menu moves below notice');
 await p.locator('#taskNotice button').click();await p.clock.runFor(30);assert(!await p.locator('#taskNotice').isVisible());
 await p.evaluate(()=>completeTipAI());await p.clock.runFor(500);assert.equal(await p.evaluate(()=>aiTipRequests.length),2);assert(!await p.locator('#taskNotice').isVisible(),'dismissed tip does not return for next car');
 await p.evaluate(()=>completeTipAI());await p.clock.runFor(500);await p.evaluate(()=>Gemma.retry());await p.clock.runFor(400);assert(await p.locator('#taskNotice').isVisible(),'a later manual job can show a new tip');
 await p.clock.runFor(9000);assert(await p.locator('#taskNotice').isVisible(),'tip survives nine seconds');await p.clock.runFor(1100);assert(!await p.locator('#taskNotice').isVisible(),'tip expires after ten seconds');
 await p.evaluate(()=>onGemmaStatus({...aiTipState}));await p.clock.runFor(200);assert(!await p.locator('#taskNotice').isVisible(),'progress does not reset the timeout');
 await p.evaluate(()=>completeTipAI());await p.clock.runFor(500);await p.evaluate(()=>{aiTipState.cpuOnly=true;onGemmaStatus({...aiTipState});Gemma.retry();});await p.clock.runFor(400);assert(!await p.locator('#taskNotice').isVisible(),'CPU-only work does not show GPU workaround');
 await p.evaluate(()=>completeTipAI());await p.clock.runFor(500);await p.evaluate(()=>{aiTipState.cpuOnly=false;onGemmaStatus({...aiTipState});Gemma.retry();});await p.clock.runFor(400);assert(await p.locator('#taskNotice').isVisible());
 await p.evaluate(()=>{aiTipState.backend='CPU';onGemmaStatus({...aiTipState});});await p.clock.runFor(30);assert(!await p.locator('#taskNotice').isVisible(),'CPU fallback hides hint');
 assert.deepEqual(errors,[]);await p.close();
}}finally{await b.close();}
const main=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8');assert(!/AiGraphicsMode|setLayerType|onAiGraphicsStatus/.test(main),'no experimental rendering remains');
assert(!fs.existsSync('src/com/bensanzone/fuelmap/AiGraphicsMode.java'));assert(!fs.readFileSync('assets/web/app.js','utf8').includes('sVisualMark'));
console.log('AI-only tip: start, once per batch, dismiss/ten-second expiry, CPU fallback, full-menu/enlarged layout and experiment removal passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
