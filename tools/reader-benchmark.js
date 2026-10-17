// Opt-in live measurement, never CI: normal public Maps pages, no challenge bypass.
const fs=require('node:fs'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{const profiles=[{name:'baseline'},{name:'fast'},{name:'lean-fast',block:true},{name:'no-css',block:true,css:false},{name:'no-js',block:true,js:false}].filter(p=>!process.env.READER_PROFILES||process.env.READER_PROFILES.split(',').includes(p.name)),report=[];
for(const profile of profiles){const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{const p=await browser.newPage({viewport:{width:1280,height:900},javaScriptEnabled:profile.js!==false}),cdp=await p.context().newCDPSession(p);await cdp.send('Network.enable');let bytes=0,requests=0,blocked=0;const byType={};cdp.on('Network.loadingFinished',e=>bytes+=e.encodedDataLength||0);p.on('request',r=>{requests++;byType[r.resourceType()]=(byType[r.resourceType()]||0)+1;});
// Same routing/cache conditions in every profile; compare cold loads, not warm-cache claims.
await p.route('**/*',r=>profile.block&&(['image','font','media'].includes(r.request().resourceType())||profile.css===false&&r.request().resourceType()==='stylesheet')?(blocked++,r.abort()):r.continue());
await p.addInitScript(()=>{window.GasketSite={result:(_,s)=>window.__readerResult=JSON.parse(s)};});const start=Date.now();
await p.goto('https://www.google.com/maps/search/gas+stations/@35.2506,-91.7362,13z?hl=en',{waitUntil:'domcontentloaded',timeout:30000});
if(profile.js!==false){const source=profile.name==='baseline'?execFileSync('git',['show',(process.env.READER_BASELINE||'3cbf7e8')+':assets/gasweb_worker.js'],{encoding:'utf8'}):fs.readFileSync('assets/gasweb_worker.js','utf8');await p.evaluate('('+source+')(1,{mode:"discover",grade:'+JSON.stringify(process.env.READER_GRADE||'regular')+'})');}else await p.waitForTimeout(4000);
const result=await p.evaluate(()=>({title:document.title,rows:document.querySelectorAll('[role="feed"] [role="article"]').length,reader:window.__readerResult||null,capabilities:{canvas:!!window.CanvasRenderingContext2D,fetch:!!window.fetch,storage:!!window.localStorage}}));
const entry={profile:profile.name,elapsedMs:Date.now()-start,requests,bytes,blocked,byType,...result};report.push(entry);console.log(JSON.stringify({...entry,reader:entry.reader?{detail:entry.reader.detail,error:entry.reader.error}:null}));
}catch(e){report.push({profile:profile.name,error:e.message});console.log(JSON.stringify(report.at(-1)));}finally{await browser.close();}}
if(process.env.READER_REPORT)fs.writeFileSync(process.env.READER_REPORT,JSON.stringify({at:new Date().toISOString(),report},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
