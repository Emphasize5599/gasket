const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const W=require('../assets/web/routewx'),M=require('../assets/web/tires'),Policy=require('../assets/web/tirepolicy');
const setup={tires:[{id:'lf',depth:4,measured:true},{id:'rf',depth:4.1},{id:'lr',depth:null},{id:'rr',depth:5},{id:'tr:a1l',depth:2,unit:'trailer'}],spare:{depth:0}};
for(const kind of ['rain','storm','flood','tropical'])assert.deepEqual(W.tireRisk(setup,[{kind}]).tires.map(t=>t.id),['lf','tr:a1l']);
for(const kind of ['snow','ice'])assert.deepEqual(W.tireRisk(setup,[{kind}]).tires.map(t=>t.id),['lf','rf','rr','tr:a1l']);
for(const kind of ['wind','heat','cold','fog','alert'])assert.equal(W.tireRisk(setup,[{kind}]).tires.length,0);
assert.equal(W.tireRisk(setup,[]).tires.length,0);assert.equal(W.tireRisk({tires:[{depth:5.1}]},[{kind:'snow'}]).tires.length,0);
assert.equal(W.tireRisk({tires:[{depth:null},{depth:NaN},{depth:-1}]},[{kind:'rain'}]).tires.length,0);
const c={info:{drive:'fwd'},tires:{type:'Touring All-Season',tread:{mode:'miles',miles:60000,rotated:'no'},corners:{},spare:{kind:'compact'}}};
assert(W.tireRisk(Policy.snapshot(c,M),[{kind:'rain'}]).tires.some(t=>!t.measured),'same-set mileage estimates are included');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await browser.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  const A=__app;A.S.trip.departNow=true;A.S.trip.fuel={mode:'miles',miles:'180'};A.S.trip.milesLeft='180';A.S.confirmDeletes=false;
  window.__wetToasts=[];const toast=A.toast;A.toast=function(s){__wetToasts.push(s);return toast(s);};
  const c=Garage.car();c.tires={size:'195/65R15',type:'Touring All-Season',tread:{mode:'measure',depth:3,dot:'2324'},corners:{split:false},spare:{kind:'none'},aired:Date.now()};
  const alts=__mocks.route({origin:{placeId:'P-start'},destination:{placeId:'P-end'},computeAlternativeRoutes:true}).routes,m=Trip.buildRoute(alts[0],Garage.carModel());
  const saved={route:{stops:[{label:'Start',address:'100 Main St',lat:m.pts[0].lat,lng:m.pts[0].lng},{label:'End',address:'200 Main St',lat:m.pts.at(-1).lat,lng:m.pts.at(-1).lng}]},alts,altSel:0,trip:{from:'100 Main St',to:'200 Main St',fuel:A.S.trip.fuel,milesLeft:'180',departNow:true},stations:{official:[],google:[]},savedT:Date.now()};
  A.KV.put('trips','trip|wet-test',saved);A.KV.put('trips','index',[{id:'wet-test',title:'Wet route test',t:saved.savedT,mi:318,n:0}]);
  window.__weatherReads=0;window.__weatherGates=[];
  RouteWx.forRoute=async()=>{__weatherReads++;await new Promise(r=>__weatherGates.push(r));return {hazards:[{kind:'rain',level:2,fromMi:20,toMi:40,from:Date.now(),to:Date.now()+3600000,peak:{precip:.4}}],stats:{},alerts:[],dense:[],forecast:[]};};
 });
 await p.click('#btnTrip');await p.click('[data-hist="wet-test"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>{__app.S.trip.departNow=true;__trip.step(5);});await p.waitForFunction(()=>__weatherReads===2);
 // Next on the default route waits for the already-running forecast, without another request.
 await p.click('#tNext');await p.waitForTimeout(80);assert.equal(await p.locator('#cfm').count(),0);assert.equal(await p.evaluate(()=>__weatherReads),2);
 await p.evaluate(()=>__weatherGates.splice(0).forEach(r=>r()));await p.waitForSelector('.wet-tire-warning');assert.match(await p.innerText('#cfm'),/Rain|rain/);assert.match(await p.innerText('#cfm'),/All 4 car tires — measured 3\/32/);
 assert.equal(await p.innerText('#cfmYes'),'I understand','not controlled by delete-confirmation preference');
 const bounds=await p.locator('#cfm .cfm').evaluate(e=>{const r=e.getBoundingClientRect();return {fits:r.top>=0&&r.bottom<=innerHeight,overflow:e.scrollWidth>e.clientWidth};});assert(bounds.fits&&!bounds.overflow,JSON.stringify(bounds));
 if(process.env.UI_SHOTS){await p.waitForTimeout(200);await p.screenshot({path:path.join(process.env.UI_SHOTS,'wet-route-'+width+'.png')});}
 await p.click('#cfmNo');await p.waitForSelector('#cfm',{state:'detached'});assert.equal(await p.evaluate(()=>__trip.state().step),5);
 // Cancelling an alternate selection keeps the old route; explicit acknowledgment accepts it.
 await p.click('[data-hzk="1"]');await p.waitForSelector('.wet-tire-warning');await p.click('#cfmNo');await p.waitForSelector('#cfm',{state:'detached'});assert.equal(await p.getAttribute('.hz-opt.on','data-hzk'),'0');
 await p.click('[data-hzk="1"]');await p.waitForSelector('.wet-tire-warning');await p.click('#cfmYes');await p.waitForFunction(()=>document.querySelector('.hz-opt.on').dataset.hzk==='1',null,{timeout:5000}).catch(async e=>{console.error(await p.evaluate(()=>({toasts:__wetToasts,tires:Garage.car().tires,step:__trip.state().step})));throw e;});await p.waitForSelector('#cfm',{state:'detached'});
 // Explicit Now retains its checked forecast across minute boundaries, not an unset departure.
 await p.clock.setFixedTime(new Date(await p.evaluate(()=>Date.now()+61000)));
 await p.click('#tNext');await p.waitForFunction(()=>__trip.state().step===6);assert.equal(await p.locator('#cfm').count(),0,'same route/risk does not prompt twice across a minute boundary');
 await p.waitForFunction(()=>!__trip.state().busy);
 // Tire edits invalidate acknowledgment, and genuinely worn-out tires get stronger wording.
 await p.evaluate(()=>{Garage.car().tires.tread.depth=2;__trip.step(5);});await p.click('#tNext');await p.waitForSelector('.wet-tire-warning');assert.match(await p.innerText('#cfm'),/replace before driving/i);
 await p.click('#cfmYes');await p.waitForFunction(()=>__trip.state().step===6);await p.waitForSelector('#cfm',{state:'detached'});await p.waitForFunction(()=>!__trip.state().busy);
 // A new explicit departure invalidates both forecast and acknowledgment.
 await p.evaluate(()=>{__app.S.trip.departNow=false;__app.S.trip.depart=new Date(Date.now()+86400000).toISOString().slice(0,16);__trip.step(5);});
 await p.waitForFunction(()=>__weatherGates.length>0);await p.click('#tNext');await p.evaluate(()=>__weatherGates.splice(0).forEach(r=>r()));await p.waitForSelector('.wet-tire-warning');
 // An edit while the dialog is open cannot acknowledge stale data.
 await p.evaluate(()=>Garage.car().tires.tread.depth=8);await p.click('#cfmYes');await p.waitForSelector('#cfm',{state:'detached'});assert.equal(await p.evaluate(()=>__trip.state().step),5);
 // A healthy car with low estimated trailer tread still needs confirmation. Unhooked tires do not count.
 await p.evaluate(()=>{const t=Garage.car().tires;t.towMode=true;t.trailers=[{id:'wet-trailer',name:'Cargo',hooked:true,axles:1,per:2,split:true,type:'Trailer',size:'205/75R15',warrantyMi:60000}];t.corners['wet-trailer:a1l']={miles:59000,rotated:'no'};t.corners['wet-trailer:a1r']={miles:59000,rotated:'no'};});
 await p.click('#tNext');await p.waitForSelector('.wet-tire-warning');assert.match(await p.innerText('#cfm'),/Cargo: all 2 tires — estimated/);assert.doesNotMatch(await p.innerText('#cfm'),/All 4 car tires/);
 await p.click('#cfmNo');await p.waitForSelector('#cfm',{state:'detached'});await p.evaluate(()=>Garage.car().tires.towMode=false);await p.click('#tNext');await p.waitForFunction(()=>__trip.state().step===6);assert.equal(await p.locator('#cfm').count(),0);await p.waitForFunction(()=>!__trip.state().busy);
 // Considering a cheaper alternate is gated too; No can always reject it without acknowledging.
 await p.evaluate(()=>{Garage.car().tires.tread.depth=3;__app.S.trip.altCompare=true;__app.S.trip.routeChoices={};__trip.step(5);});
 await p.click('#tNext');await p.waitForSelector('.wet-tire-warning');await p.click('#cfmYes');await p.waitForFunction(()=>document.querySelector('#tBack').textContent==='No');await p.waitForSelector('#cfm',{state:'detached'});
 await p.click('#tNext');await p.waitForSelector('.wet-tire-warning');await p.click('#cfmNo');await p.waitForSelector('#cfm',{state:'detached'});assert.equal(await p.innerText('#tBack'),'No');
 await p.click('#tBack');await p.waitForFunction(()=>__trip.state().step===6);assert.equal(await p.locator('#cfm').count(),0);
 assert.deepEqual(errors,[]);await p.close();
}console.log('Wet/snow thresholds, estimated/car/trailer tires, in-flight reuse, cancel/ack, default-route gate and changed-risk invalidation passed');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
