// Adding a rest stop splits a leg, so every later leg's number moves up by one. Road answers (alternatives reviewed
// in Hazards) are kept per leg, so they must move with their leg: otherwise the trip believes the later leg was never
// reviewed, every step past Hazards turns gray and Stops can't be finished (owner report, 0.0.322).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:360,height:900}}),errors=[];p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  const A=__app,S=A.S,P=[{lat:34,lng:-92},{lat:34.4,lng:-92},{lat:34.8,lng:-92}];
  function raw(pts,label){let m=0;for(let i=1;i<pts.length;i++)m+=Trip.hav(pts[i-1],pts[i])*1609.344;const s=m/1609.344/50*3600;return {description:label,distanceMeters:m,duration:s+'s',polyline:{encodedPolyline:Trip.encodePolyline(pts)},legs:[{distanceMeters:m,duration:s+'s',steps:[]}]};}
  const leg1=raw([P[0],{lat:34.2,lng:-92},P[1]],'Generic road'),leg2=raw([P[1],{lat:34.6,lng:-92},P[2]],'Generic road'),leg2b=raw([P[1],{lat:34.6,lng:-91.95},P[2]],'Other road');
  A.N.fetchJson=(id,url)=>{let answer;if(url.includes('services.arcgis.com'))answer={features:[{attributes:{OBJECTID:1,nhs_rest_stop:'Generic rest area',state:'AR'},geometry:{x:-91.999,y:34.2}}]};else if(url.includes('overpass-api.de'))answer={elements:[]};else if(url.includes('timezone=auto')){const n=new URL(url).searchParams.get('latitude').split(',').length;answer=n>1?Array.from({length:n},()=>({timezone:'America/Chicago'})):{timezone:'America/Chicago'};}else answer={};setTimeout(()=>onNativeResult(id,{body:JSON.stringify(answer)}),0);};
  A.N.computeRoute=(id,key,text)=>{const x=JSON.parse(text),c=w=>({lat:w.location.latLng.latitude,lng:w.location.latLng.longitude});setTimeout(()=>onNativeResult(id,{body:JSON.stringify({routes:[raw([c(x.origin),c(x.destination)],'Access')]})}),0);};
  A.N.siteRead=(id)=>setTimeout(()=>onNativeResult(id,{complete:true,places:[]}),0);
  RouteWx.forRoute=async()=>({hazards:[],stats:{points:1,weather:1,air:1,errors:0},temperatures:[]});
  S.apiKey='TEST';S.keylessRegular=false;S.limitLookup=false;S.osmPreview=false;S.xomCheck=false;S.hereTraffic=false;S.googleTraffic=false;S.trip.altCompare=true;S.trip.departNow=false;S.trip.depart=new Date(Date.now()+3600000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);S.trip.fuel={mode:'miles',miles:250};S.trip.milesLeft='250';S.trip.tankPrice=4;S.trip.maxDetourMin=10;
  const route={stops:[{label:'Start',...P[0]},{label:'Middle',...P[1]},{label:'End',...P[2]}],legs:[{alts:[leg1],sel:0},{alts:[leg2,leg2b],sel:0}]},trip={depart:S.trip.depart,departNow:false,fuel:S.trip.fuel,tankPrice:4,bufferMi:10,maxDetourMin:10,altCompare:true};
  A.KV.put('trips','trip|legs',{route,alts:[Trip.joinRoutes([leg1,leg2])],altSel:0,altSure:true,trip,stations:{kind:'gas',official:[],google:[]},savedT:Date.now()});A.KV.put('trips','index',[{id:'legs',t:Date.now(),mi:55,n:3}]);
  window.__leg2b=leg2b;
 });
 await p.click('#btnTrip');await p.click('[data-hist="legs"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);
 // the second leg's alternative was reviewed (No) in Hazards
 await p.evaluate(()=>{__app.S.trip.departNow=true;__app.S.trip.routeChoices[RouteChoices.key(1,__leg2b)]={consider:false,goal:'cost'};__trip.step(7);});
 const dim=()=>p.evaluate(()=>[...document.querySelectorAll('#tpSteps [data-step].dim')].map(b=>+b.dataset.step));
 assert.deepEqual(await dim(),[],'reviewed trip: nothing grayed out');
 await p.waitForFunction(()=>!__trip.state().busy&&/Cheaper trips|Rest stops/i.test(document.querySelector('#trip').innerText));if(!await p.locator('[data-rest-leg="0"]').count()&&/Cheaper trips/i.test(await p.locator('#trip').innerText()))await p.click('#tNext');await p.waitForSelector('[data-rest-leg="0"]');await p.click('[data-rest-leg="0"]');await p.waitForSelector('[data-rest-add]');await p.locator('[data-rest-add]').first().click();await p.check('#restPermission');await p.click('#restAddGo');
 await p.waitForFunction(()=>__trip.state().route.stops.length===4);await p.waitForFunction(()=>!__trip.state().busy);
 assert(await p.evaluate(()=>__app.S.trip.routeChoices[RouteChoices.key(2,__leg2b)]&&__app.S.trip.routeChoices[RouteChoices.key(2,__leg2b)].consider===false),'the answer moved to the leg\'s new number');
 assert.deepEqual(await dim(),[],'after adding a rest the later steps stay open');
 // Stops always offers every leg's directory, even one with nothing found
 assert.equal(await p.locator('[data-rest-leg]').count(),3,'one entrance per leg, including the new ones');
 assert.deepEqual(errors,[]);await p.close();
 console.log('Rest stop insertion keeps later legs\' road answers and every leg\'s directory passed');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
