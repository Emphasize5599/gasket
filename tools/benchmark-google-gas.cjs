// Opt-in LIVE website experiment. Never part of CI. Requires Playwright + CHROME.
// Uses a fresh anonymous browser and the native lean-resource policy mirror.
// Example: GAS_LAT=40.6433383 GAS_LNG=-73.7902427 node tools/benchmark-google-gas.cjs
const fs=require('node:fs'),cp=require('node:child_process'),{chromium}=require('playwright');
const omit=require('./reader-resource-policy'),Trip=require('../assets/web/trip');
(async()=>{
 const lat=Number(process.env.GAS_LAT||35.2506),lng=Number(process.env.GAS_LNG||-91.7362),grade=process.env.GAS_GRADE||'regular';
 if(!Number.isFinite(lat)||Math.abs(lat)>85||!Number.isFinite(lng)||Math.abs(lng)>180||!['regular','midgrade','premium','diesel'].includes(grade))throw Error('Invalid location or fuel grade');
 const baseline=cp.execFileSync('git',['show','ae998a6:assets/gasweb_worker.js'],{encoding:'utf8'}),current=fs.readFileSync('assets/gasweb_worker.js','utf8'),results=[];
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});
 try{for(const [mode,worker] of [['current',current],['baseline292',baseline]]){
  const p=await browser.newPage({viewport:{width:1280,height:900},locale:'en-US',userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'}),pending=[];let bytes=0,requests=0;
  await p.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(q.resourceType()==='image')return r.abort();if(omit(u.hostname,u.pathname,q.method(),q.isNavigationRequest()))return r.fulfill({status:200,body:'',contentType:'text/plain'});return r.continue();});
  p.on('response',r=>{const u=new URL(r.url());if(u.pathname==='/search'&&u.searchParams.get('tbm')==='map')pending.push(r.text().then(t=>{requests++;bytes+=t.length;}).catch(()=>{}));});
  const start=Date.now();await p.goto('https://www.google.com/maps/search/gas+stations/@'+lat+','+lng+',13z?hl=en',{waitUntil:'domcontentloaded',timeout:30000});
  const out=await p.evaluate(({worker,grade})=>new Promise(resolve=>{window.__gasketLeanResources=true;window.GasketSite={result:(id,s)=>resolve(JSON.parse(s))};(0,eval)('('+worker+')')(1,{mode:'discover',grade});}),{worker,grade});
  await Promise.allSettled(pending);const result={mode,elapsedMs:Date.now()-start,blocked:!!out.blocked,error:out.error,code:out.code,detail:out.detail,requests,responseCharacters:bytes,stations:(out.stores||[]).map(s=>({id:s.id,name:s.name,lat:s.lat,lng:s.lng,prices:s.prices}))};results.push(result);
  console.log(JSON.stringify({...result,stations:result.stations.length}));await p.close();if(out.blocked)break;
 }}finally{await browser.close();}
 const comparisons=results.length===2?[8,12,15].map(radius=>{const a=results[0].stations.filter(s=>Trip.hav({lat,lng},s)<=radius),b=results[1].stations.filter(s=>Trip.hav({lat,lng},s)<=radius),ids=new Map(a.map(s=>[s.id,s]));return {radius,current:a.length,baseline:b.length,missing:b.filter(s=>!ids.has(s.id)).map(s=>s.id),priceDifferences:b.filter(s=>ids.has(s.id)&&JSON.stringify(s.prices)!==JSON.stringify(ids.get(s.id).prices)).map(s=>s.id)};}):[];
 fs.mkdirSync('tmp',{recursive:true});const path='tmp/google-gas-benchmark-'+lat+','+lng+'-'+grade+'.json';fs.writeFileSync(path,JSON.stringify({lat,lng,grade,results,comparisons},null,2));console.log(JSON.stringify({saved:path,comparisons}));
})().catch(e=>{console.error(e);process.exitCode=1;});
