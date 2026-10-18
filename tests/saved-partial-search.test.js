// A saved trip that searched your route but not an alternative you approved later: only that alternative is searched,
// your route keeps its saved stations, and the trip is saved again with both (it used to search everything again).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:320,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  const A=__app,S=A.S;S.apiKey='';S.trip.fuel={mode:'miles',miles:'180'};S.trip.milesLeft='180';S.trip.bufferMi=30;S.brands={exxon:true};
  const alts=__mocks.route({origin:{placeId:'P-start'},destination:{placeId:'P-end'},computeAlternativeRoutes:true}).routes,m=Trip.buildRoute(alts[0],Garage.carModel());
  window.__altsSaved=alts;
  const stations=[60,150,240].map((mi,i)=>{const pt=m.pointAt(mi);return {id:'test:'+i,name:'Exxon',brand:'exxon',lat:pt.lat,lng:pt.lng,address:i+' Main St',state:'AR',google:true,prices:{regular:{price:3.1+i*.1,updated:new Date().toISOString()}},detourMi:1,detourExact:true};});
  const saved={route:{stops:[{label:'Start',address:'100 Main St',lat:m.pts[0].lat,lng:m.pts[0].lng},{label:'End',address:'200 Main St',lat:m.pts.at(-1).lat,lng:m.pts.at(-1).lng}]},alts,altSel:0,trip:{fuel:S.trip.fuel,milesLeft:'180',bufferMi:30,avoid:{},altCompare:true},stations:{official:[],google:[{k:0,list:stations}]},savedT:Date.now()};
  A.KV.put('trips','trip|part',saved);A.KV.put('trips','index',[{id:'part',title:'Start → End',t:saved.savedT,mi:318,via:'Test route',n:2}]);
 });
 await p.click('#btnTrip');await p.click('[data-hist="part"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);
 const n=await p.evaluate(()=>{const S=__app.S;S.trip.altCompare=true;__altsSaved.forEach((a,k)=>{if(k)S.trip.routeChoices[RouteChoices.key(0,a)]={consider:k===1};});
  window.__areas=[];window.__union=KeylessGas.discoveryAreas(__altsSaved.slice(0,2).map(a=>Trip.buildRoute(a,Garage.carModel())),Trip,__app.P).length;
  const o=KeylessGas.discover;KeylessGas.discover=function(areas){__areas.push(areas.length);return o.apply(this,arguments);};return __altsSaved.length;});
 assert(n>=2,'the mock offers an alternative');
 await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy,null,{timeout:20000});
 assert.equal(await p.evaluate(()=>__areas.length),0,'opening a saved trip searches nothing by itself');
 // the alternative's speed limits fail twice: asked again by itself, no Try again (that's for SPEED_TRIES failures)
 await p.evaluate(()=>{window.__limFails=2;window.__limCalls=0;const la=Limits.along;Limits.along=function(m){if(Math.abs(m.totalMi-__trip.state().model.totalMi)>0.5){__limCalls++;if(__limFails-->0)return Promise.reject(new Error('Synthetic speed limit failure'));}return la.apply(this,arguments);};});
 // Stops: the comparison doesn't trust the alternative's guessed stations; it offers to search that route
 await p.click('#tNext');await p.waitForSelector('[data-rec-scan]',{timeout:20000});
 assert.match(await p.locator('[data-rec-scan]').locator('xpath=..').locator('xpath=..').innerText(),/no stations were searched along/);
 assert.equal(await p.locator('[data-rec-retry]').count(),0,'speed limits were read on the third try: no Try again');
 assert.equal(await p.evaluate(()=>__limCalls),3,'two failures, then the third try');
 await p.click('[data-rec-scan]');await p.waitForFunction(()=>__areas.length===1&&__trip.state().result&&!__trip.state().busy,null,{timeout:20000});
 const r=await p.evaluate(()=>({areas:__areas,union:__union,saved:__app.KV.get('trips','trip|part').v.stations.google.length}));
 console.log('  partial search:',JSON.stringify(r));
 assert(r.areas[0]>0&&r.areas[0]<r.union,'only areas off your route are read ('+r.areas[0]+' of '+r.union+')');
 assert.equal(r.saved,2,'saved again with both routes\' stations');
 await p.waitForFunction(()=>!document.querySelector('[data-rec-scan]')&&!Tasks.list().some(t=>t.id==='route-comparison'),null,{timeout:20000});
 // the next search reads both from the saved trip: nothing searched
 await p.evaluate(()=>{__areas.length=0;});await p.evaluate(()=>__trip.find());await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy,null,{timeout:20000});
 assert.equal(await p.evaluate(()=>__areas.length),0,'the saved trip now covers both');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('Saved trip missing an approved alternative: the comparison asks, only that route is searched, then both are saved');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
