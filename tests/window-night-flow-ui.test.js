const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 for(const mode of (process.env.WINDOW_NIGHT_ONLY?[process.env.WINDOW_NIGHT_ONLY]:['keep-both','skip-second','skip-first','skip-both','restore-second','return-shift'])){
 const p=await browser.newPage({viewport:{width:mode==='skip-second'?320:448,height:950},timezoneId:'UTC'}),errors=[];p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));
 await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(mode=>{
  const A=__app,S=A.S,H=3600000,M=60000,iso=t=>new Date(t).toISOString(),start=Math.ceil((Date.now()+2*86400000)/86400000)*86400000+12*H,back=start+7*86400000;
  S.limitLookup=false;S.googleTraffic=false;S.hereTraffic=false;S.speed.rule={on:false};S.apiKey='TEST';S.walmartPlus=false;S.cars.forEach(c=>c.tires={aired:Date.now(),spare:{kind:'none'}});A.siteOn=()=>false;
  window.PointZone={resolve:()=> 'UTC'};const fetch=A.N.fetchJson;A.N.fetchJson=(id,u)=>{if(u.includes('timezone=auto')){const n=new URL(u).searchParams.get('latitude').split(',').length;onNativeResult(id,{body:JSON.stringify(n===1?{timezone:'UTC'}:Array.from({length:n},()=>({timezone:'UTC'})))});}else fetch(id,u);};
  // Long deterministic route clocks isolate rest scheduling from fuel availability and provider changes.
  const pts=[{lat:34,lng:-92},{lat:34.5,lng:-92},{lat:34,lng:-92}],raw=(i,hours)=>({description:'Leg '+(i+1),tollsAsked:true,distanceMeters:30*1609.344,duration:hours*3600+'s',polyline:{encodedPolyline:Trip.encodePolyline(pts.slice(i,i+2))},legs:[{distanceMeters:30*1609.344,duration:hours*3600+'s',steps:[]}]}),roads=[raw(0,40),raw(1,20)],route={stops:pts.map((p,i)=>({...p,label:['Start','Visit','Home'][i],timeZone:'UTC'})),legs:roads.map(r=>({sel:0,alts:[r]}))},nightly=Overnight.defaults({minimum:420,preferred:480});
  const all=WindowSchedule.restParts([{kind:'drive',minutes:40*60}],start,{zone:'UTC',point:pts[0]},nightly,Infinity,[]).filter(p=>p.kind==='rest').map(p=>p.night);
  if(all.length!==2)throw Error('fixture needs two rests');
  const skip=mode==='skip-second'?[all[1]]:mode==='skip-first'?[all[0]]:mode==='skip-both'?all:[],key=TripStops.nightKey(route,TripStops.groups(route)[0]),cfg={enabled:true,clockVersion:2,planningMode:'overnight',priority:'cost',confirmedPriority:'cost',overnight:nightly,driveThroughNights:{[key]:skip},destinations:[{leaveOn:true,leaveStart:iso(back),leaveEnd:iso(back+2*H)},{}]};
  const first=WindowSchedule.restParts([{kind:'drive',minutes:40*60}],start,{zone:'UTC',point:pts[0]},nightly,Infinity,skip).reduce((n,p)=>n+p.minutes*M,start),last=WindowSchedule.restParts([{kind:'drive',minutes:20*60}],back,{zone:'UTC',point:pts[1]},nightly,Infinity,[]).reduce((n,p)=>n+p.minutes*M,back);
  cfg.windowTimes={zones:['UTC','UTC','UTC'],depart:{start:iso(start-5*M),end:iso(start+30*M)},arrival:{start:iso(last+(mode==='return-shift'?H:-30*M)),end:iso(last+3*H)}};
  Object.assign(cfg.destinations[0],{arriveOn:true,arriveStart:iso(first-30*M),arriveEnd:iso(first+H)});
  cfg.visualStarts=[start,back];const joined=Object.assign(Trip.joinRoutes(roads),{_sel:[0,0]}),trip={windowPlan:cfg,depart:iso(start),departNow:false,returnTrip:true,backAuto:false,backAt:iso(back),fuel:{mode:'pct',pct:'100'},milesLeft:'500',bufferMi:20,bufferFloor:20,minSave:0,tankPrice:4,trafficForecast:false,altCompare:false};
  A.KV.put('trips','trip|night-flow',{route,alts:[joined],altSel:0,altSure:true,trip,stations:{official:[],google:[{k:0,list:[]}],kind:'gas'},savedT:Date.now()});A.KV.put('trips','index',[{id:'night-flow',t:Date.now(),mi:60,n:3}]);
  window.__nightFixture={start,back,first,last,all,key,mode};RouteWx.forRoute=async()=>({hazards:[],stats:{points:1,weather:1,errors:0},temperatures:[]});
 },mode);
 await p.click('#btnTrip');await p.click('[data-hist="night-flow"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>__trip.step(10));await p.click('#twConfigure');await p.waitForSelector('#twSchedule .ws-drive');
 if(mode==='restore-second'){
  const night=await p.evaluate(()=>__nightFixture.all[1]);await p.locator('[data-ws-night-leg="0"][data-ws-night="'+night+'"][data-ws-skip="1"]').first().click();await p.locator('[data-ws-night-leg="0"][data-ws-night="'+night+'"][data-ws-skip="0"]').first().click();
 }
 assert(await p.isEnabled('#twSave'),mode+': '+await p.innerText('#twError'));await p.click('#twSave');
 const choices=await p.evaluate(()=>__app.S.trip.windowPlan.driveThroughNights?.[__nightFixture.key]||[]);assert.equal(choices.length,mode==='skip-both'?2:/^skip-/.test(mode)?1:0);
 await p.evaluate(()=>__trip.step(5));for(let i=0;i<2;i++){await p.waitForSelector('#twYes');await p.click('#twYes');}
 await p.waitForSelector('#tCompare');await p.click('#tNext');
 await p.waitForFunction(()=>__trip.state().result?.schedule&&!__trip.state().busy,null,{timeout:45000}).catch(async e=>{console.error(mode,await p.evaluate(()=>FLog.entries().filter(e=>e.a==='timing'||e.a==='schedule').slice(-8)));throw e;});
 const result=await p.evaluate(()=>({schedule:__trip.state().result.schedule,fixture:__nightFixture,config:__app.S.trip.windowPlan}));
 assert(Math.abs(result.schedule[0].arrive-result.fixture.first)<=5*60000,mode+': comparison uses the rest-aware arrival');
 assert(result.schedule[1].depart>=result.fixture.back&&result.schedule[1].depart<=result.fixture.back+2*3600000);
 if(mode==='return-shift'){assert(result.schedule[1].depart>=result.fixture.back+3600000,'the return departure moves within its own window');assert.equal(result.schedule[0].depart,result.fixture.start-5*60000,'return adjustment leaves the first departure anchored');}
 assert(result.schedule[1].arrive>=Date.parse(result.config.windowTimes.arrival.start)&&result.schedule[1].arrive<=Date.parse(result.config.windowTimes.arrival.end));
 if(mode==='skip-second'){
  const saved=await p.evaluate(()=>{const A=__app,index=A.KV.get('trips','index').v;return index.map(x=>({id:x.id,value:A.KV.get('trips','trip|'+x.id)?.v})).find(x=>(x.value?.planned||x.value?.draftClock)&&x.value?.trip?.windowPlan?.enabled);});
  assert(saved,'the completed rest-selection checkpoint is saved');assert.deepEqual(saved.value.trip.windowPlan.driveThroughNights[result.fixture.key],choices);
}
assert.deepEqual(errors,[]);await p.close();console.log('PASS overnight flow '+mode);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
