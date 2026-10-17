// Opt-in public-page measurements, never CI or a challenge bypass. See docs/READER_PERFORMANCE.md.
const fs=require('node:fs'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const omission=require('./reader-resource-policy');
const Pricing=require('../assets/web/pricing');
const profiles=[
  {name:'baseline'}, {name:'fast'}, {name:'lean-fast',block:true},
  {name:'native-before',native:true}, {name:'native-lite',native:true,lean:true},
  {name:'native-lite-old',native:true,lean:true,revision:'e71502e'},
  {name:'no-mapcore',block:true,mapcore:false}, {name:'no-telemetry',block:true,telemetry:false},
  {name:'reader-lite',block:true,mapcore:false,telemetry:false},
  {name:'no-graphics',block:true,mapcore:false,telemetry:false,tiles:false},
  {name:'no-chrome',block:true,mapcore:false,telemetry:false,tiles:false,chrome:false},
  {name:'no-webgl',block:true,webgl:false}, {name:'no-css',block:true,css:false}, {name:'no-js',block:true,js:false}
].filter(p=>(process.env.READER_PROFILES||'native-before,native-lite').split(',').includes(p.name));
const center=process.env.READER_CENTER||'35.2506,-91.7362,13z';
if(!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,\d{1,2}z$/.test(center))throw Error('Invalid READER_CENTER');
const grade=process.env.READER_GRADE||'regular',mode=process.env.READER_MODE||'discover';
if(!['regular','midgrade','premium','diesel'].includes(grade)||!['discover','refresh'].includes(mode))throw Error('Invalid grade/mode');
const dimensions=/^(\d{3,4})x(\d{3,4})$/.exec(process.env.READER_VIEWPORT||'1280x900');
if(!dimensions)throw Error('Invalid READER_VIEWPORT');
const viewport={width:+dimensions[1],height:+dimensions[2]},report=[];
const repeats=Math.max(1,Math.min(3,Number(process.env.READER_REPEATS)||1));
const userAgent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
async function processMemory(browser){
  if(process.platform!=='win32')return null;
  try{
    const session=await browser.newBrowserCDPSession(),info=await session.send('SystemInfo.getProcessInfo');await session.detach();
    const renderers=info.processInfo.filter(p=>p.type==='renderer').map(p=>Number(p.id)).filter(Number.isSafeInteger);
    if(!renderers.length)return null;
    // Only PIDs returned by this isolated test browser. Private bytes are committed,
    // not resident RAM; working sets include shared pages. Neither is Android PSS.
    const raw=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-Process -Id '+renderers.join(',')+' | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress'],{encoding:'utf8',timeout:10000});
    const rows=[JSON.parse(raw)].flat();return {renderers:rows.length,rendererPrivateBytes:rows.reduce((n,p)=>n+p.PrivateMemorySize64,0),rendererWorkingSetBytes:rows.reduce((n,p)=>n+p.WorkingSet64,0)};
  }catch(e){return {error:e.message.slice(0,150)};}
}
function comparable(entry,base){
  if(!entry.reader||!base||!base.reader)return null;
  const before=new Map(base.reader.stores.map(s=>[s.featureId,s]));let common=0,priceDifferences=0;
  for(const s of entry.reader.stores)if(before.has(s.featureId)){common++;if(JSON.stringify(before.get(s.featureId).prices)!==JSON.stringify(s.prices))priceDifferences++;}
  const [lat,lng]=center.split(',').map(Number),near=s=>Pricing.haversineMi(lat,lng,s.lat,s.lng)<=8;
  const localBefore=new Map(base.reader.stores.filter(near).map(s=>[s.featureId,s])),localAfter=new Map(entry.reader.stores.filter(near).map(s=>[s.featureId,s]));
  const localCommon=Array.from(localAfter.keys()).filter(id=>localBefore.has(id));
  return {against:base.profile,common,missing:before.size-common,extra:entry.reader.stores.length-common,priceDifferences,
    withinEightMiles:{before:localBefore.size,after:localAfter.size,missing:localBefore.size-localCommon.length,extra:localAfter.size-localCommon.length,priceDifferences:localCommon.filter(id=>JSON.stringify(localBefore.get(id).prices)!==JSON.stringify(localAfter.get(id).prices)).length}};
}
(async()=>{
for(let repeat=0;repeat<repeats;repeat++)for(const profile of profiles){
  const browser=await chromium.launch({headless:process.env.READER_HEADED!=='1',executablePath:process.env.CHROME||undefined});
  try{
    const p=await browser.newPage({viewport,userAgent,javaScriptEnabled:profile.js!==false}),cdp=await p.context().newCDPSession(p);
    await cdp.send('Network.enable');await cdp.send('Performance.enable');
    let bytes=0,requests=0,blocked=0,leanResources=!!profile.lean,firstAttempt=null;const byType={},traffic=new Map(),requestGroups=new Map(),errors=[],rawFrames=[],captures=[];
    if(process.env.READER_RAW_REPORT)p.on('response',response=>{const u=new URL(response.url());if(u.hostname==='www.google.com'&&u.pathname==='/search'&&u.searchParams.get('tbm')==='map')captures.push(response.text().then(body=>{if(body.length<=5000000)rawFrames.push(body);}).catch(()=>{}));});
    p.on('pageerror',e=>{if(errors.length<10)errors.push(e.message.slice(0,250));});
    cdp.on('Network.requestWillBeSent',e=>{
      try{const u=new URL(e.request.url),key=u.host+u.pathname;
        if(!traffic.has(key))traffic.set(key,{path:key,type:e.type,requests:0,bytes:0});
        traffic.get(key).requests++;requestGroups.set(e.requestId,key);
      }catch(_){}
    });
    cdp.on('Network.loadingFinished',e=>{bytes+=e.encodedDataLength||0;const group=traffic.get(requestGroups.get(e.requestId));if(group)group.bytes+=e.encodedDataLength||0;});
    p.on('request',r=>{requests++;byType[r.resourceType()]=(byType[r.resourceType()]||0)+1;});
    // Routing in both profiles holds cache conditions equal: cold-page, not warm-cache claims.
    await p.route('**/*',r=>{
      const req=r.request(),u=new URL(req.url()),host=u.hostname.toLowerCase(),path=u.pathname.toLowerCase();
      const mainFrame=req.isNavigationRequest()&&req.frame()===p.mainFrame();
      const nativeOmit=profile.native&&omission(host,path,req.method(),mainFrame,false,leanResources);
      const experimentalOmit=profile.mapcore===false&&host==='www.google.com'&&path.startsWith('/maps/_/wa/')&&path.endsWith('.wasm')
        ||profile.telemetry===false&&host==='www.google.com'&&path==='/maps/preview/log204'
        ||profile.tiles===false&&(host==='www.google.com'&&path.startsWith('/maps/vt/')||host==='www.gstatic.com'&&path.startsWith('/maps/res/compactlegend-'))
        ||profile.chrome===false&&(host==='www.gstatic.com'&&path.startsWith('/og/_/')||host==='ogads-pa.clients6.google.com');
      if(nativeOmit||experimentalOmit){blocked++;return r.fulfill({status:200,body:'',headers:{'cache-control':'no-store'},contentType:path.endsWith('.wasm')?'application/wasm':'text/plain'});}
      if((profile.block||profile.native)&&req.resourceType()==='image'||profile.block&&(['font','media'].includes(req.resourceType())||profile.css===false&&req.resourceType()==='stylesheet')){blocked++;return r.abort();}
      return r.continue();
    });
    // Rejected experiment, not a proposed Android capability change.
    if(profile.webgl===false)await p.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /^(experimental-)?webgl2?$/i.test(type)?null:get.call(this,type,...args);};});
    await p.addInitScript(lean=>{window.__gasketLeanResources=lean;window.GasketSite={result:(_,s)=>window.__readerResult=JSON.parse(s)};},!!profile.lean);
    const start=Date.now();
    await p.goto('https://www.google.com/maps/search/gas+stations/@'+center+'?hl=en',{waitUntil:'domcontentloaded',timeout:30000});
    if(profile.js!==false){
      const revision=profile.revision||(profile.name==='baseline'?(process.env.READER_BASELINE||'3cbf7e8'):null);
      const source=revision?execFileSync('git',['show',revision+':assets/gasweb_worker.js'],{encoding:'utf8'}):fs.readFileSync('assets/gasweb_worker.js','utf8');
      // Match native's one normal-resource retry, retaining partial observations,
      // cookies and one overall deadline. No restriction/grade retry.
      const until=start+(mode==='discover'?210000:40000);
      async function runReader(){let timer;try{await Promise.race([p.evaluate('window.__gasketLeanResources='+leanResources+';('+source+')(1,'+JSON.stringify({mode,grade})+')'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Reader watchdog expired')),Math.max(1,until-Date.now()));})]);}finally{clearTimeout(timer);}}
      await runReader();
      const first=await p.evaluate(()=>window.__readerResult);
      if(profile.native&&leanResources&&first&&!first.blocked&&!first.cancelled&&(first.code==='incomplete_feed'||first.code==='unreadable'&&!(first.stores||[]).length)){
        firstAttempt={code:first.code,detail:first.detail};leanResources=false;
        await p.reload({waitUntil:'domcontentloaded',timeout:Math.min(30000,Math.max(1,until-Date.now()))});await runReader();
        await p.evaluate(({previous,grade})=>{const r=window.__readerResult;if(!r||r.cancelled)return;const joined=new Map();for(const row of previous.concat(r.stores||[]))joined.set(row.featureId||row.id,row);r.stores=Array.from(joined.values());r.detail=r.detail||{};r.detail.read=r.stores.length;r.detail.priced=r.stores.filter(s=>s.prices&&s.prices[grade]).length;r.detail.fullResourceRetry=true;},{previous:first.stores||[],grade});
      }
    }else await p.waitForTimeout(4000);
    const result=await p.evaluate(()=>({title:document.title,rows:document.querySelectorAll('[role="feed"] [role="article"]').length,reader:window.__readerResult||null}));
    const elapsedMs=Date.now()-start;
    // Retained-JS-heap samples, not Android PSS, native/Wasm or graphics memory.
    await cdp.send('HeapProfiler.collectGarbage');
    const perf=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(m=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','LayoutCount','RecalcStyleCount','TaskDuration','ScriptDuration','LayoutDuration'].includes(m.name)).map(m=>[m.name,m.value]));
    const memory=await processMemory(browser),heap=await cdp.send('Runtime.getHeapUsage');
    if(process.env.READER_RAW_REPORT){await Promise.all(captures);fs.writeFileSync(process.env.READER_RAW_REPORT,JSON.stringify({center,grade,rawFrames}));}
    const entry={profile:profile.name,repeat,center,grade,mode,viewport,elapsedMs,requests,bytes,blocked,byType,...result,perf,memory,heap,firstAttempt,errors,traffic:Array.from(traffic.values()).sort((a,b)=>b.bytes-a.bytes)};
    entry.comparison=comparable(entry,report.find(r=>r.repeat===repeat));report.push(entry);
    console.log(JSON.stringify({...entry,traffic:entry.traffic.slice(0,8).map(t=>({...t,path:t.path.slice(0,120)})),reader:entry.reader?{detail:entry.reader.detail,error:entry.reader.error}:null}));
  }catch(e){const entry={profile:profile.name,repeat,error:e.message};report.push(entry);console.log(JSON.stringify(entry));process.exitCode=1;}
  finally{await browser.close();if(process.env.READER_REPORT)fs.writeFileSync(process.env.READER_REPORT,JSON.stringify({at:new Date().toISOString(),report},null,2));}
}
})().catch(e=>{console.error(e);process.exitCode=1;});
