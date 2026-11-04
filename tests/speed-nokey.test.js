// No Google API key and a website route without turn-by-turn steps: cruising speed is shown but grayed out, with a short
// warning, and stops are planned at the limits. With the steps (the Maps website sent them), it works without a key.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const shots=process.argv[2],p=await b.newPage({viewport:{width:320,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  const A=__app,S=A.S;S.apiKey='';S.trip.fuel={mode:'miles',miles:'180'};S.trip.milesLeft='180';S.trip.bufferMi=30;S.brands={exxon:true};S.speed.rule={on:true,over:5,cap:80};
  const withSteps=__mocks.route({origin:{placeId:'P-start'},destination:{placeId:'P-end'},computeAlternativeRoutes:true}).routes;
  const alts=JSON.parse(JSON.stringify(withSteps)).map(a=>Object.assign(a,{legs:[],websiteApproximate:true})),m=Trip.buildRoute(alts[0],Garage.carModel());
  const stations=[60,120,180,240,300].map((mi,i)=>{const pt=m.pointAt(mi);return {id:'test:'+i,name:'Exxon',brand:'exxon',lat:pt.lat,lng:pt.lng,address:i+' Main St',state:'AR',google:true,prices:{regular:{price:3.1+i*.1,updated:new Date().toISOString()}},detourMi:1,detourExact:true};});
  const saved={route:{stops:[{label:'Start',address:'100 Main St',lat:m.pts[0].lat,lng:m.pts[0].lng},{label:'End',address:'200 Main St',lat:m.pts.at(-1).lat,lng:m.pts.at(-1).lng}]},alts,altSel:0,trip:{fuel:S.trip.fuel,milesLeft:'180',bufferMi:30,avoid:{}},stations:{official:[],google:[{k:0,list:stations}]},savedT:Date.now()};
  A.KV.put('trips','trip|nokey',saved);
  const saved2=Object.assign({},saved,{alts:withSteps.map(a=>Object.assign({},a,{websiteApproximate:true,websiteSteps:true}))});A.KV.put('trips','trip|steps',saved2);
  A.KV.put('trips','index',[{id:'nokey',title:'Start → End',t:saved.savedT,mi:318,via:'Test route',n:5},{id:'steps',title:'Start → End (steps)',t:saved.savedT-1,mi:318,via:'Test route',n:5}]);
 });
 await p.click('#btnTrip');await p.click('[data-hist="nokey"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);
 await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy);
 await p.waitForSelector('#tsSpeed');assert.equal(await p.locator('#tsSpeed.spd-off, #tsSpeed .spd-off-note').count(),0,'geometry-based limits keep speed controls enabled without a key or turn text');assert(await p.evaluate(()=>__trip.state().model._lim.stats.geometry&&__trip.state().model._lim.roads.length>0));assert(await p.evaluate(()=>__hpms.length>0),'free HPMS geometry lookup is requested');assert(await p.evaluate(()=>/[1-9]/.test(__trip.state().result.planOffs)),'the default +5 rule participates in planning');
 await p.evaluate(()=>__trip.step(4));await p.waitForSelector('#tRule');assert.equal(await p.locator('#tRule').evaluate(e=>e.closest('.card').classList.contains('spd-off')),false);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // the totals say they're rough: Stops and Departure
 await p.evaluate(()=>__trip.step(7));await p.waitForSelector('#tsResults .est-note');
 assert.match(await p.innerText('#tsResults .est-note'),/rough estimates/);
 await p.evaluate(()=>__trip.step(__trip.steps.DEPART));await p.waitForSelector('.kpis.four + .est-note');
 if(shots)await p.screenshot({path:shots+'/nokey-depart.png'});
 // with a key: everything works again
 await p.evaluate(()=>{__app.S.apiKey='TEST';});await p.evaluate(()=>__trip.step(6));await p.waitForSelector('#tsSpeed');
 assert.equal(await p.locator('#tsSpeed.spd-off, #tsSpeed .spd-off-note').count(),0,'a key turns it back on');
 await p.evaluate(()=>__trip.step(__trip.steps.DEPART));assert.doesNotMatch((await p.locator('#tpS'+await p.evaluate(()=>__trip.steps.DEPART)+' .est-note').allTextContents()).join(' '),/Without a Google API key.*rough estimates/,'no no-key cost warning with a key');
 // Advice's tick boxes hold every later step until they're ticked
 await p.evaluate(()=>{__app.S.recircAck=0;__trip.step(7);});await p.waitForFunction(()=>__trip.state().step===2);
 await p.evaluate(()=>{__app.S.recircAck=Date.now();__trip.step(7);});await p.waitForFunction(()=>__trip.state().step===7);
 // no key, but the website sent the turn-by-turn steps: cruising speed works
 await p.evaluate(()=>{__app.S.apiKey='';});await p.click('#tClose').catch(()=>{});await p.click('#btnTrip');await p.click('[data-hist="steps"]');
 await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy&&__trip.state().model.segs.some(s=>s.instr));
 await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy);await p.waitForSelector('#tsSpeed');
 assert.equal(await p.locator('#tsSpeed.spd-off, #tsSpeed .spd-off-note').count(),0,'steps from the website: cruising speed on without a key');
 await p.evaluate(()=>__trip.step(__trip.steps.DEPART));assert.match(await p.innerText('.est-note'),/rough estimates/);assert.doesNotMatch(await p.innerText('.est-note'),/planned at the limits/);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('No API key or turn text: geometry-based speed limits and default speed settings work; existing instructions/key paths remain supported');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
