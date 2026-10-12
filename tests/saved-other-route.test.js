// A saved trip on a route it didn't search, whose saved stations can't plan it: Adjust finds stations along it instead of breaking.
// Also: Route's "Now" empties a picked Leaving time (a new, blank box) and shows as picked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const shots=process.argv[2],p=await b.newPage({viewport:{width:320,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.click('#sDone');await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  const A=__app,S=A.S;S.apiKey='';S.trip.fuel={mode:'miles',miles:'180'};S.trip.milesLeft='180';S.trip.bufferMi=30;S.brands={exxon:true};S.speed.rule={on:true,over:5,cap:80};
  const alts=__mocks.route({origin:{placeId:'P-start'},destination:{placeId:'P-end'},computeAlternativeRoutes:true}).routes,m=Trip.buildRoute(alts[0],Garage.carModel());
  const stations=[300].map((mi,i)=>{const pt=m.pointAt(mi);return {id:'test:'+i,name:'Exxon',brand:'exxon',lat:pt.lat,lng:pt.lng,address:i+' Main St',state:'AR',google:true,prices:{regular:{price:3.1+i*.1,updated:new Date().toISOString()}},detourMi:1,detourExact:true};});
  const saved={route:{stops:[{label:'Start',address:'100 Main St',lat:m.pts[0].lat,lng:m.pts[0].lng},{label:'End',address:'200 Main St',lat:m.pts.at(-1).lat,lng:m.pts.at(-1).lng}]},alts,altSel:0,trip:{fuel:S.trip.fuel,milesLeft:'180',bufferMi:30,avoid:{}},stations:{official:[],google:[{k:0,list:stations}]},savedT:Date.now()};
  A.KV.put('trips','trip|nokey',saved);A.KV.put('trips','index',[{id:'nokey',title:'Start → End',t:saved.savedT,mi:318,via:'Test route',n:5}]);
 });
 await p.click('#btnTrip');await p.click('[data-hist="nokey"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);
 await p.evaluate(()=>__trip.step(3));await p.waitForSelector('#tDepart');
 assert.equal(await p.locator('#tRouteInfo .card').count(),0,'no route tile under the Route step');
 assert.equal(await p.getAttribute('#tNow','aria-pressed'),'true','blank = leaving now');
 const later=await p.evaluate(()=>{const d=new Date(Date.now()+864e5-new Date().getTimezoneOffset()*6e4);return d.toISOString().slice(0,16);});
 await p.fill('#tDepart',later);await p.dispatchEvent('#tDepart','change');
 assert.equal(await p.evaluate(()=>__app.S.trip.depart),later);assert.equal(await p.getAttribute('#tNow','aria-pressed'),'false');
 const old=await p.evaluate(()=>{window.__oldDt=document.getElementById('tDepart');return 1;});
 await p.click('#tNow');
 assert.deepEqual(await p.evaluate(()=>{const e=document.getElementById('tDepart');return [e.value,e!==__oldDt,__app.S.trip.depart,e.type];}),['',true,'','datetime-local'],'Now: a fresh empty box, saved as now');
 assert.equal(await p.getAttribute('#tNow','aria-pressed'),'true');
 await p.fill('#tDepart',later);await p.dispatchEvent('#tDepart','change');assert.equal(await p.evaluate(()=>__app.S.trip.depart),later,'the new box still saves');
 await p.click('#tNow');
 await p.evaluate(()=>{window.__disc=0;const o=KeylessGas.discover;KeylessGas.discover=function(){__disc++;return o.apply(this,arguments);};});
 await p.evaluate(()=>__trip.step(4));await p.waitForSelector('[data-hzk="1"]');await p.click('[data-hzk="1"]');await p.waitForFunction(()=>document.querySelector('[data-hzk="1"]').classList.contains('on'));
 await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy);
 const r=await p.evaluate(()=>({disc:__disc,card:!!document.querySelector('#taResults .price-refresh-card'),msg:(document.querySelector('#taResults .msg.err')||{}).textContent||''}));
 console.log('  Adjust:',JSON.stringify(r));
 assert.equal(r.disc,1,'the saved stations could not plan the other route: discovery along it');
 assert.ok(r.card&&/No plan keeps you/.test(r.msg),'Adjust shows its card and why, not a blank placeholder');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('Saved trip on another route: falls back to discovery; Now empties the Leaving box');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
