#!/usr/bin/env node
// Opt-in audit of main-thread stalls: a long saved trip (~1,200 miles, thousands of stations, a rest area every
// ~10 miles) is opened in the real UI, every trip step and the rest-stop add flow are clicked through with the CPU
// slowed (THROTTLE, default 4x, roughly a phone), and each click reports how long until the next frame painted and
// the longest blocking task that followed. Usage: node tools/ui-stall-audit.cjs [--only=rest]
'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const THROTTLE=+process.env.THROTTLE||4,ONLY=(process.argv.find(a=>a.startsWith('--only='))||'').slice(7);
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROME||undefined});
 const p=await b.newPage({viewport:{width:412,height:900}}),errors=[];p.setDefaultTimeout(120000);p.on('pageerror',e=>errors.push(e.message));
 await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
 await require('../tests/onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  const A=__app,S=A.S,pts=[];let lat=34,lng=-92;for(let k=0;k<=4800;k++){pts.push({lat,lng});lat+=.25/69*.8;lng+=.25/57*.6;}
  let mi=0;for(let i=1;i<pts.length;i++)mi+=Trip.hav(pts[i-1],pts[i]);const meters=mi*1609.344,seconds=mi/60*3600;
  const raw={description:'Generic interstate',distanceMeters:meters,duration:seconds+'s',polyline:{encodedPolyline:Trip.encodePolyline(pts)},legs:[{distanceMeters:meters,duration:seconds+'s',steps:[]}]};
  const brands=['exxon','shell','murphy','citgo','other'],stations=[];for(let i=0;i<3000;i++){const q=pts[Math.floor(i*1.6)],o=(i%7-3)*.004;stations.push({id:'ChIJStress'+i,name:'Station '+i,brand:brands[i%5],lat:q.lat+o,lng:q.lng-o,address:(100+i)+' Main St, Testville',state:'AR',google:true,source:'Google',prices:{regular:{price:3+(i%37)/100,updated:new Date(Date.now()-3600e3).toISOString()}}});}
  window.__restSites=[];for(let i=0;i<120;i++){const q=pts[i*40+20];__restSites.push({attributes:{OBJECTID:i+1,nhs_rest_stop:'Rest area '+i,state:'AR'},geometry:{x:q.lng+.002,y:q.lat}});}
  A.N.fetchGoogleTraffic=(id,pb)=>{const m=[...pb.matchAll(/!3m2!3d(-?[\d.]+)!4d(-?[\d.]+)/g)],a={lat:+m[0][1],lng:+m[0][2]},z={lat:+m[1][1],lng:+m[1][2]},d=Trip.hav(a,z)*1609.344,s=d/1609.344/55*3600,clock=+(/!3j(\d+)/.exec(pb)[1]),r=[],root=[];r[0]=[];r[0][1]='Generic road';r[0][2]=[d];r[0][10]=[[s],null,3,null,[s*.9,s*1.2]];r[3]=[[[0,0],[d,s]]];root[1]=[r];root[7]=[[[Math.round(a.lat*1e7),Math.round((z.lat-a.lat)*1e7)],[Math.round(a.lng*1e7),Math.round((z.lng-a.lng)*1e7)]]];root[11]='!8j'+clock+'!3e0';setTimeout(()=>onNativeResult(id,{body:JSON.stringify([root])}),40);};
  const fetch=A.N.fetchJson;A.N.fetchJson=(id,url)=>{let answer;if(url.includes('services.arcgis.com'))answer={features:__restSites};else if(url.includes('overpass-api.de'))answer={elements:[]};else if(url.includes('timezone=auto')){const n=new URL(url).searchParams.get('latitude').split(',').length;answer=n>1?Array.from({length:n},()=>({timezone:'America/Chicago'})):{timezone:'America/Chicago'};}if(answer)setTimeout(()=>onNativeResult(id,{body:JSON.stringify(answer)}),30);else fetch(id,url);};
  A.N.computeRoute=(id,key,text)=>{const x=JSON.parse(text),c=w=>({lat:w.location.latLng.latitude,lng:w.location.latLng.longitude}),a=c(x.origin),z=c(x.destination),d=Trip.hav(a,z)*1609.344;setTimeout(()=>onNativeResult(id,{body:JSON.stringify({routes:[{description:'Access',distanceMeters:d,duration:Math.round(d/20)+'s',polyline:{encodedPolyline:Trip.encodePolyline([a,z])},legs:[{distanceMeters:d,duration:Math.round(d/20)+'s',steps:[]}]}]})}),60);};
  A.N.siteRead=(id,key,text)=>{setTimeout(()=>onNativeResult(id,{complete:true,places:[]}),50);};
  RouteWx.forRoute=async()=>({hazards:[],stats:{points:1,weather:1,air:1,errors:0},temperatures:[]});
  S.apiKey='TEST';S.keylessRegular=false;S.limitLookup=false;S.osmPreview=false;S.xomCheck=false;S.hereTraffic=false;S.googleTraffic=true;S.trip.departNow=false;S.trip.depart=new Date(Date.now()+3600000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);S.trip.fuel={mode:'miles',miles:250};S.trip.milesLeft='250';S.trip.tankPrice=4;S.trip.bufferMi=10;S.trip.maxDetourMin=10;
  const route={stops:[{label:'Start',...pts[0]},{label:'Destination',...pts[pts.length-1]}]},trip={from:'100 Main St, Testville',to:'200 Main St, Testville',depart:S.trip.depart,departNow:false,trafficForecast:true,fuel:S.trip.fuel,tankPrice:4,bufferMi:10,maxDetourMin:10,altCompare:false};
  A.KV.put('trips','trip|stress',{route,alts:[raw],altSel:0,altSure:true,trip,stations:{kind:'gas',official:[],google:[{k:0,list:stations}]},savedT:Date.now()});A.KV.put('trips','index',[{id:'stress',t:Date.now(),mi,n:2}]);
  window.__lag=[];let last=performance.now();setInterval(()=>{const now=performance.now(),d=now-last-100;if(d>40)__lag.push(d);last=now;},100);
  window.__lt=[];new PerformanceObserver(l=>l.getEntries().forEach(e=>__lt.push({t:e.startTime,d:e.duration}))).observe({type:'longtask',buffered:true});
  document.addEventListener('click',()=>{const t=performance.now();window.__paint=null;requestAnimationFrame(()=>{window.__paint=performance.now()-t;});},true);
 });
 const cdp=await p.context().newCDPSession(p);await cdp.send('Emulation.setCPUThrottlingRate',{rate:THROTTLE});
 const rows=[];
 // self time per function (file:line), from the sampled CPU profile
 function summarize(label,profile){const byId=new Map(profile.nodes.map(n=>[n.id,n])),self=new Map(),dt=profile.timeDeltas;profile.samples.forEach((id,i)=>{const n=byId.get(id),f=n.callFrame;if(!f.url||!/assets\/web/.test(f.url))return;const k=f.functionName+' '+f.url.split('/').pop()+':'+(f.lineNumber+1);self.set(k,(self.get(k)||0)+(dt[i]||0)/1000);});
  // inclusive: walk parents
  const parent=new Map();profile.nodes.forEach(n=>(n.children||[]).forEach(c=>parent.set(c,n.id)));const incl=new Map();profile.samples.forEach((id,i)=>{const seen=new Set();for(let x=id;x!=null;x=parent.get(x)){const f=byId.get(x).callFrame;if(!f.url||!/assets\/web/.test(f.url))continue;const k=f.functionName+' '+f.url.split('/').pop()+':'+(f.lineNumber+1);if(seen.has(k))continue;seen.add(k);incl.set(k,(incl.get(k)||0)+(dt[i]||0)/1000);}});
  console.log('  profile '+label+' · self:');[...self].sort((a,b)=>b[1]-a[1]).slice(0,+process.env.TOP||12).forEach(([k,v])=>console.log('    '+Math.round(v)+' ms  '+k));console.log('  inclusive:');[...incl].sort((a,b)=>b[1]-a[1]).slice(0,+process.env.TOP||20).forEach(([k,v])=>console.log('    '+Math.round(v)+' ms  '+k));}
 async function settle(){let last=Date.now(),seen=0;const start=Date.now();for(;;){if(Date.now()-start>(+process.env.SETTLE||90000))return;await p.waitForTimeout(400);const n=await p.evaluate(()=>__lt.length);if(n!==seen){seen=n;last=Date.now();}const busy=await p.evaluate(()=>!!(window.__trip&&__trip.state().busy));if(!busy&&Date.now()-last>2500)return;if(Date.now()-last>60000)return;}}
 async function act(label,fn){await p.evaluate(()=>{__lt.length=0;__lag.length=0;window.__paint=null;});const prof=process.env.PROFILE&&process.env.PROFILE.split('|').some(x=>label.includes(x));if(prof){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start');}const t=Date.now();await fn();await settle();if(prof){const {profile}=await cdp.send('Profiler.stop');summarize(label,profile);}const r=await p.evaluate(()=>({paint:window.__paint,max:Math.max(0,...__lt.map(e=>e.d)),total:__lt.reduce((n,e)=>n+e.d,0),count:__lt.length,lag:__lag.reduce((n,d)=>n+d,0),lagMax:Math.max(0,...__lag)}));rows.push({label,paintMs:Math.round(r.paint||0),longestMs:Math.round(r.max),blockedMs:Math.round(r.total),lagMs:Math.round(r.lag),longTasks:r.count,wallMs:Date.now()-t});console.log(label.padEnd(44),'paint',String(Math.round(r.paint||0)).padStart(6),'ms  longest',String(Math.round(r.max)).padStart(6),'ms  blocked',String(Math.round(r.total)).padStart(7),'ms  tasks',r.count,' lag',Math.round(r.lag),'ms');}
 await act('Open trips list',()=>p.click('#btnTrip'));
 await act('Open saved long trip',()=>p.click('[data-hist="stress"]'));
 if(process.env.PROFILE_ALL){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');}
 if(!process.env.NO_CANCEL){
  // cancel mid-work: Stops starts the plan, then ✕ right away; then is the app usable?
  await act('Stops then ✕ after 300 ms',async()=>{await p.click('#tpSteps [data-step="7"]');await p.waitForTimeout(300);await p.click('#tClose');});
  if(await p.locator('#cfm.on #cfmNo').count())await act('Cancel search (dialog)',()=>p.click('#cfm.on #cfmNo'));
  if(await p.locator('#btnSettings').isVisible())await act('Open Settings right after',()=>p.click('#btnSettings'));
  if(await p.locator('#sDone').count())await act('Close Settings',()=>p.click('#sDone'));
  if(!await p.locator('#tClose').isVisible()){await act('Open trips list again',()=>p.click('#btnTrip'));await act('Reopen saved trip',()=>p.click('[data-hist="stress"]'));}
 }
 if(!ONLY){for(const k of [1,2,3,5,4,6,8,9]){const sel='#tpSteps [data-step="'+k+'"]';if(await p.locator(sel).count()&&!(await p.locator(sel).isDisabled()))await act('Step tab '+k,()=>p.click(sel));}}
 await p.evaluate(()=>{const t=__app.S.trip;t.departNow=true;t.from=t.from||'100 Main St, Testville';t.to=t.to||'200 Main St, Testville';});
 // walk the trip with Next like a user; a screen Next can't leave is a stuck flow
 await act('Back to Garage (step 1)',()=>p.click('#tpSteps [data-step="1"]'));
 let cancelled=false,reviewed=false;
 for(let n=0;n<16&&!await p.locator('[data-rest-leg="0"]').count();n++){const before=await p.evaluate(()=>__trip.state().step+'|'+(document.querySelector('#tNext')||{}).textContent);let ok=await p.locator('#tNext:not([disabled])').waitFor({timeout:+process.env.WAIT||120000}).then(()=>true,()=>false);if(!ok&&before.split('|')[0]==='8'&&await p.locator('[data-vc-plan]:not([disabled])').count()&&!reviewed){reviewed=true;await act('Compare: Review setup (reopened trip)',()=>p.locator('[data-vc-plan]:not([disabled])').first().click());continue;}if(!ok){console.log('STUCK: Next stays disabled on step',before,JSON.stringify(await p.evaluate(()=>(document.querySelector('#trip')||document.body).innerText.slice(0,800))));break;}if(!cancelled&&before.split('|')[0]==='8'&&!process.env.NO_CANCEL){cancelled=true;await act('Next from Compare, then ✕ after 1 s',async()=>{await p.click('#tNext');await p.waitForTimeout(1000);await p.click('#tClose');});if(await p.locator('#cfm.on #cfmNo').count())await act('Cancel search (dialog)',()=>p.click('#cfm.on #cfmNo'));await act('Tap Settings while it winds down',()=>p.click('#btnSettings'));await act('Close Settings',()=>p.click('#sDone'));await act('Reopen trips list',()=>p.click('#btnTrip'));await act('Reopen saved trip',()=>p.click('[data-hist="stress"]'));await act('Back to Compare',()=>p.click('#tpSteps [data-step="8"]'));continue;}
   await act('Next from step '+before.split('|')[0]+' ('+before.split('|')[1].trim()+')',()=>p.click('#tNext'));const after=await p.evaluate(()=>__trip.state().step+'|'+(document.querySelector('#tNext')||{}).textContent);if(after===before&&!await p.locator('[data-rest-leg="0"]').count()){console.log('STUCK: Next did nothing on step',before,JSON.stringify(await p.evaluate(()=>({screen:(document.querySelector('#trip')||document.body).innerText.slice(0,500),log:FLog.entries().slice(-6).map(e=>e.l+' '+e.a+' '+e.m+' '+String(e.d||'').slice(0,200))}))));break;}}
 if(!await p.locator('[data-rest-leg="0"]').count()&&/Cheaper trips/i.test(await p.locator('#trip').innerText()))await act('Next past cheaper trips',()=>p.click('#tNext'));
 await p.waitForSelector('[data-rest-leg="0"]',{timeout:+process.env.WAIT||120000}).catch(async e=>{console.log('STUCK on Stops:',JSON.stringify(await p.evaluate(()=>({step:__trip.state().step,busy:__trip.state().busy,text:(document.querySelector('#trip')||document.body).innerText.slice(0,1500),tasks:[...document.querySelectorAll('#taskHub, #taskList')].map(e=>e.innerText).join(' | ')}))));throw e;});
 await act('Open rest directory (leg 1)',()=>p.click('[data-rest-leg="0"]'));
 await p.waitForSelector('[data-rest-add]',{timeout:120000});
 await act('Tap + on a rest area',()=>p.locator('[data-rest-add]').nth(3).click());
 await p.check('#restPermission').catch(()=>{});
 await act('Confirm add',()=>p.click('#restAddGo'));
 if(await p.locator('#cfm.on #cfmYes').count())await act('Confirm dialog',()=>p.click('#cfm.on #cfmYes'));
 await p.waitForTimeout(500);
 if(await p.locator('[data-rest-leg="0"]').count())await act('Reopen rest directory',()=>p.click('[data-rest-leg="0"]'));
 if(await p.locator('[data-rest-add]').count()>8)await act('Tap + on a second rest area',()=>p.locator('[data-rest-add]').nth(8).click());
 if(await p.locator('#restAddGo').count()){await p.check('#restPermission').catch(()=>{});await act('Confirm second add',()=>p.click('#restAddGo'));}
 while(await p.locator('.sub-page .sub-back').count())await p.locator('.sub-page .sub-back').last().click();
 if(await p.locator('#tNext').count())await act('Next (Calculate rest timing)',()=>p.click('#tNext'));
 if(process.env.PLAN_SIZES)console.log('PLAN SIZES',JSON.stringify(await p.evaluate(()=>(window.__planSizes||[]).slice(-3))));
 if(process.env.PROFILE_ALL){const {profile}=await cdp.send('Profiler.stop');summarize('whole run',profile);}
 console.log('TOTAL blocked',rows.reduce((n,r)=>n+r.blockedMs,0),'ms over',rows.length,'actions');
 fs.writeFileSync(process.env.OUT||'/dev/null',JSON.stringify({throttle:THROTTLE,rows,errors},null,1));
 if(errors.length)console.log('page errors:',errors.slice(0,5));
 await b.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
