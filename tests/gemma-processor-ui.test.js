const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}});await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);
 await p.evaluate(()=>{
  window.commands=[];window.generations=[];window.ms={enabled:false,ready:true,supported:true,busy:false,phase:'idle',cpuOnly:false,revision:'processor-fixture'};
  __app.N.aiStatus=()=>JSON.stringify(ms);__app.N.aiCommand=(id,cmd)=>{commands.push(cmd);if(cmd==='enable')ms.enabled=true;if(cmd==='disable')ms.enabled=false;if(cmd==='processorCpu')ms.cpuOnly=true;if(cmd==='processorAuto')ms.cpuOnly=false;if(cmd==='acknowledgeRecovery')ms.recoveryRequired=false;onNativeResult(id,{...ms});onGemmaStatus({...ms});};
  __app.N.aiGenerate=(id,prompt)=>{generations.push({id,cpu:ms.cpuOnly});ms.busy=true;ms.phase='generate';ms.task='advice';onGemmaStatus({...ms});};
  window.finishAI=()=>{onNativeResult(generations.at(-1).id,{text:JSON.stringify({summary:'The rear tread needs attention first.',top:[{n:1,why:'Consider the checked condition and fitment together.'}]})});ms.busy=false;ms.phase='idle';ms.task='';onGemmaStatus({...ms});};
  const c={id:'processor-car',make:'Example',info:{drive:'rwd'},tires:{size:'205/55R16',type:'Touring',corners:{split:true,mode:'depth',lf:{depth:8},rf:{depth:8},lr:{depth:2},rr:{depth:2}}}};__app.S.cars=[c];__app.S.carId=c.id;onGemmaStatus({...ms});dispatchEvent(new Event('garagechange'));
 });
 await require('./settings-ui')(p,'ai');await p.click('[data-ai-processor="cpu"]');await p.waitForFunction(()=>Gemma.status().cpuOnly);assert.equal(await p.evaluate(()=>generations.length),0,'no automatic re-generation or download when choosing a processor');assert.match(await p.innerText('#gemmaProcNote'),/both AI models/);assert.match(await p.innerText('#lightweightState'),/CPU only selected/);
 await p.click('#gemmaEnable');await p.waitForFunction(()=>generations.length===1);assert(await p.isDisabled('[data-ai-processor="auto"]'),'cannot rebuild engine during a task');assert.equal(await p.evaluate(()=>generations[0].cpu),true);
 await p.evaluate(()=>finishAI());await p.waitForFunction(()=>!!Gemma.answer(Garage.car()));await p.waitForFunction(()=>!document.querySelector('[data-ai-processor="auto"]').disabled);await p.click('[data-ai-processor="auto"]');await p.waitForFunction(()=>!Gemma.status().cpuOnly);
 assert(await p.evaluate(()=>!!Gemma.answer(Garage.car())),'switching processors retains validated cached explanations');
 await p.click('#gemmaRecheck');await p.waitForFunction(()=>generations.length===2);assert.equal(await p.evaluate(()=>generations[1].cpu),false);await p.evaluate(()=>finishAI());
 assert.equal(await p.evaluate(()=>commands.includes('download')),false,'same local model; no download command');
 assert(await p.locator('#gemmaProcessor').evaluate(el=>el.getBoundingClientRect().right<=innerWidth&&el.scrollWidth<=el.clientWidth+1),'processor buttons fit narrow screens');
 await p.evaluate(()=>{ms.recoveryRequired=true;ms.cpuOnly=false;ms.gpuFallback='IllegalStateException: fixture GPU failure';onGemmaStatus({...ms});Garage.car().tires.corners.lr.depth=3;dispatchEvent(new Event('garagechange'));});
 await p.waitForTimeout(350);assert.equal(await p.evaluate(()=>generations.length),2,'interrupted work does not auto-restart');
 assert(!(await p.isDisabled('[data-ai-processor="auto"]')),'Automatic (GPU) stays choosable');assert.match(await p.innerText('#gemmaProcNote'),/GPU wouldn.t start last time/,'a CPU stand-in is said, not hidden');
 await p.click('#gemmaRecheck');await p.waitForFunction(()=>generations.length===3);assert(await p.evaluate(()=>commands.includes('acknowledgeRecovery')),'explicit retry acknowledges prior interruption');await p.evaluate(()=>finishAI());
 await p.evaluate(()=>{Severity.info=()=>({state:'ready',device:'webgpu',dtype:'fp16',adapterPath:'compatibility',cpuOnly:false});dispatchEvent(new Event('lightweightchange'));});assert.match(await p.innerText('#lightweightState'),/GPU.*compatibility/);
 await p.evaluate(()=>{Severity.info=()=>({state:'ready',device:'wasm',dtype:'q8',cpuOnly:false,gpuWhy:'compatibility: no adapter'});dispatchEvent(new Event('lightweightchange'));});assert.match(await p.innerText('#lightweightState'),/CPU fallback/);assert.equal(await p.locator('#lightweightState').getAttribute('title'),'compatibility: no adapter');
 await p.close();
}}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
