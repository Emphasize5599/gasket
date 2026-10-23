// Opt-in real-model check, not a CI regression. Downloads the public pinned
// runtime/model variants; sends no recall text to a remote inference service.
const path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await browser.newPage();p.on('pageerror',e=>console.log('Page error:',e.message.replace(/https?:\/\/\S+/g,'[endpoint]')));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
 const capability=await p.evaluate(async()=>{const a=navigator.gpu&&await navigator.gpu.requestAdapter();return {offered:!!navigator.gpu,hardware:!!a&&!a.isFallbackAdapter&&!a.info?.isFallbackAdapter,vendor:a?.info?.vendor||'',architecture:a?.info?.architecture||''};});console.log(JSON.stringify({stage:'capability',...capability}));
 if(!capability.hardware){console.log('No hardware adapter; not claiming a GPU benchmark.');return;}
 await p.evaluate(()=>{window.__benchCpu=false;const status=Gemma.status;Gemma.status=()=>Object.assign({},status(),{cpuOnly:__benchCpu});window.__benchRecalls=Array.from({length:22},(_,i)=>({id:'synthetic-benchmark-'+i,cons:(i%3===0?'A vehicle label contains incorrect information.':i%3===1?'The rearview camera may fail and reduce rear visibility.':'A steering component may separate, causing loss of steering control.')+' '+('The manufacturer will inspect the affected component and provide a remedy. '.repeat(10)),sum:'Synthetic scheduler benchmark, not an actual recall.'}));});
 const results=[];
 for(const cpu of [false,true]){
  await p.evaluate(cpu=>{window.__benchCpu=cpu;dispatchEvent(new Event('gemmachange'));delete __app.S.recallSev;window.__benchStarted=performance.now();Severity.rate(__benchRecalls);},cpu);
  await p.waitForFunction(()=>__benchRecalls.every(r=>Severity.get(r))&&!Severity.busy(),null,{timeout:240000}).catch(async e=>{console.log(JSON.stringify(await p.evaluate(()=>({backend:Severity.info(),progress:Severity.progress(),log:FLog.text().split('\n').filter((s,i,a)=>/Lightweight|Recall rating/.test(s)||i&&/Lightweight|Recall rating/.test(a[i-1])).slice(-28)}))));throw e;});
  const result=await p.evaluate(()=>({stage:'completed',backend:Severity.info(),elapsedMs:Math.round(performance.now()-__benchStarted),ratings:__benchRecalls.map(r=>Severity.get(r).level)}));results.push(result);console.log(JSON.stringify(result));
 }
 console.log(JSON.stringify({stage:'comparison',sameRatings:results[0].ratings.filter((r,i)=>r===results[1].ratings[i]).length,total:22,warning:'Desktop hardware and synthetic inputs; includes first-load/download/setup, not a phone speed guarantee.'}));
}finally{await browser.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
