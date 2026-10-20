const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);
 await p.evaluate(()=>{
  window.graphicsCalls=[];window.graphicsState={enabled:false,ready:true,supported:true,busy:false,phase:'idle',graphicsCompatibility:true,revision:'graphics-fixture'};
  __app.N.aiStatus=()=>JSON.stringify(graphicsState);__app.N.aiCommand=(id,cmd)=>{graphicsCalls.push(cmd);if(cmd==='graphicsOn'||cmd==='graphicsOff')graphicsState.graphicsCompatibility=cmd==='graphicsOn';onNativeResult(id,{...graphicsState});onGemmaStatus({...graphicsState});};
  onGemmaStatus({...graphicsState});
 });
 await require('./settings-ui')(p,'ai');assert(await p.isChecked('#gemmaGraphics'),'on by default');
 await p.locator('.field').filter({has:p.locator('#gemmaGraphics')}).locator('.qi').click();assert.match(await p.locator('.qpop').innerText(),/Does not disable Android hardware overlays/);await p.keyboard.press('Escape');
 await p.uncheck('#gemmaGraphics');await p.waitForFunction(()=>Gemma.status().graphicsCompatibility===false);
 await p.click('#settingsBack');await p.click('[data-settings-group="ai"]');assert(!await p.isChecked('#gemmaGraphics'),'explicit off survives reopening settings');
 await p.evaluate(()=>{Object.assign(graphicsState,{busy:true,enabled:true,task:'advice',phase:'generate'});onGemmaStatus({...graphicsState});});
 assert(!await p.isDisabled('#gemmaGraphics'),'can turn off/on without cancelling the model');await p.check('#gemmaGraphics');await p.waitForFunction(()=>Gemma.status().graphicsCompatibility===true);
 await p.evaluate(()=>{graphicsState.graphicsExperiment={active:true};onGemmaStatus({...graphicsState});});assert.match(await p.innerText('#gemmaGraphicsState'),/texture layer active/);
 await p.evaluate(()=>onGemmaStatus({...graphicsState,diagnosticOnly:true,graphicsCompatibility:false,graphicsExperiment:{active:false}}));assert(await p.isChecked('#gemmaGraphics'),'late diagnostic cannot change the setting');assert.match(await p.innerText('#gemmaGraphicsState'),/texture layer active/);
 await p.evaluate(()=>onAiGraphicsStatus({active:false,memoryHold:true}));assert.match(await p.innerText('#gemmaGraphicsState'),/released to reduce memory/);assert.equal(await p.evaluate(()=>Gemma.status().phase),'generate','rendering report cannot finish the AI task');
 await p.evaluate(()=>{graphicsState.graphicsExperiment={active:true,error:'restore_IllegalStateException'};onGemmaStatus({...graphicsState});});assert.match(await p.innerText('#gemmaGraphicsState'),/Restart the app/);
 await p.evaluate(()=>{graphicsState.graphicsExperiment={active:false};graphicsState.busy=false;graphicsState.phase='idle';graphicsState.task='';onGemmaStatus({...graphicsState});});assert.match(await p.innerText('#gemmaGraphicsState'),/Normal rendering/);
 assert.deepEqual(await p.evaluate(()=>graphicsCalls),['graphicsOff','graphicsOn'],'graphics commands never download, regenerate or clear answers');
 await p.evaluate(()=>document.documentElement.style.fontSize='130%');assert(!await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'no narrow/enlarged overflow');assert.deepEqual(errors,[]);await p.close();
}}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
