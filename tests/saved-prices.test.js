const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const native=fs.readFileSync(path.join(root,'src/com/bensanzone/fuelmap/MainActivity.java'),'utf8');
const compute=native.slice(native.indexOf('public void computeRoute('),native.indexOf('public void routeSearch('));
assert.match(compute,/synchronized \(MainActivity\.this\)/);
assert.ok(compute.indexOf('used>=monthlyCap')<compute.indexOf('googlePost(ROUTES_URL'));
assert.ok(compute.indexOf('.commit()')<compute.indexOf('googlePost(ROUTES_URL'));
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROME||undefined});
 try{
  const p=await b.newPage({viewport:{width:320,height:900}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto(pathToFileURL(path.join(root,'assets/web/index.html')).href);
  await p.fill('#apiKey','AIzaSyTESTKEY0123456789abcdefghijklmnop');await p.click('#sDone');
  await p.evaluate(fs.readFileSync(path.join(root,'tests/trip_mocks.js'),'utf8'));
  await p.evaluate(()=>{
    const A=__app,S=A.S;S.trip.fuel={mode:'miles',miles:'180'};S.trip.milesLeft='180';S.trip.bufferMi=20;S.brands={exxon:true};
    const alts=__mocks.route({origin:{placeId:'P-start'},destination:{placeId:'P-end'},computeAlternativeRoutes:true}).routes;
    const m=Trip.buildRoute(alts[0],Garage.carModel()),points=[m.pointAt(90),m.pointAt(150)];
    const stations=points.map((point,i)=>({id:'ChIJTestSavedStation000'+i,name:'Exxon',brand:'exxon',lat:point.lat,lng:point.lng,address:(100+i)+' Main St, Testville, AR',state:'AR',wplus:true,google:true,source:'Google',prices:{regular:{price:3.99+i*.1,updated:'2026-10-01T00:00:00Z'},premium:{price:4.99,updated:'2026-10-01T00:00:00Z'}},detourMi:1.2,detourExact:true}));
    window.__originalStations=JSON.parse(JSON.stringify(stations));
    const saved={route:{stops:[{label:'Test start',address:'100 Main St',lat:m.pts[0].lat,lng:m.pts[0].lng},{label:'Test end',address:'200 Main St',lat:m.pts.at(-1).lat,lng:m.pts.at(-1).lng}]},alts,altSel:0,trip:{link:'',from:'Test start',to:'Test end',fuel:S.trip.fuel,milesLeft:'180',avoid:{}},stations:{official:[],google:[{k:0,list:stations}]},savedT:Date.now()-864e5};
    A.KV.put('trips','trip|saved-test',saved);A.KV.put('trips','index',[{id:'saved-test',title:'Test start → Test end',t:saved.savedT,mi:Math.round(m.totalMi),via:'Test route',n:2}]);
    window.__api={places:0,routes:0,web:0,other:0};
    A.N.callsThisMonth=()=>900;A.N.routeCallsThisMonth=()=>9500;
    A.N.routeSearch=()=>{__api.places++;throw new Error('Unexpected paid station discovery');};
    A.N.computeRoute=()=>{__api.routes++;throw new Error('Unexpected paid route request');};
    A.N.siteRead=(id,key,args)=>{if(!/^gasweb(?:[2-4])?$/.test(key)){__api.other++;return setTimeout(()=>onNativeResult(id,{error:'mock skip'}),1);}
      __api.web++;const s=__originalStations[0];setTimeout(()=>onNativeResult(id,{stores:[{id:'web:test',placeId:s.id,name:'Exxon',lat:s.lat,lng:s.lng,prices:{regular:{price:3.12}},source:'Google Maps web'},{id:'web:unseen',name:'Exxon',lat:0,lng:0,prices:{regular:{price:1.99}}}]}),1);
    };
  });
  await p.click('#btnTrip');await p.click('[data-hist="saved-test"]');
  await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);
  await p.evaluate(()=>__trip.step(6));
  await p.waitForSelector('#taResults [data-trip-refresh="web"]');await p.waitForFunction(()=>!__trip.state().busy);
  const routeBefore=await p.evaluate(()=>JSON.stringify(__app.KV.get('trips','trip|saved-test').v.alts));
  assert.equal(await p.locator('#taResults .price-refresh-card .note,#taResults .price-refresh-card .seg').count(),0);
  const help=await p.locator('#taResults .price-refresh-card .qi').evaluateAll(es=>es.map(e=>decodeURIComponent(e.dataset.q)));
  assert.match(help[0],/Best for price refreshes.*Estimated.*2 areas/);assert.match(help[1],/station discovery along a new route.*very quickly/);
  const layout=await p.evaluate(()=>{
    const card=document.querySelector('#taResults .price-refresh-card');card.style.fontSize='130%';
    const bounds=card.getBoundingClientRect(),buttons=[...card.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.getBoundingClientRect());   // the closed ▾ menu's item has no box
    const ok=buttons.every(b=>b.left>=bounds.left&&b.right<=bounds.right)&&card.scrollWidth<=card.clientWidth;
    card.style.fontSize='';return ok;
  });
  assert.equal(layout,true,'320px scan actions and help fit at 130% text');
  await p.click('#taResults [data-trip-refresh="web"]');
  await p.waitForFunction(()=>!__trip.state().busy&&__app.KV.get('trips','trip|saved-test').v.stations.priceRefresh);
  const first=await p.evaluate(()=>({api:__api,saved:__app.KV.get('trips','trip|saved-test').v,result:__trip.state().result}));
  assert.equal(first.api.places,0);assert.equal(first.api.routes,0);assert.equal(first.api.web,2);
  assert.equal(first.saved.stations.google[0].list.length,2);
  assert.equal(first.saved.stations.google[0].list[0].prices.regular.price,3.12);
  assert.equal(first.saved.stations.google[0].list[1].prices.regular.price,4.09);
  assert.equal(first.saved.stations.google[0].list[0].prices.premium.price,4.99);
  assert.equal(first.saved.stations.google[0].list[0].detourMi,1.2);
  assert.equal(JSON.stringify(first.saved.alts),routeBefore);
  await p.evaluate(()=>__trip.step(7));await p.waitForSelector('#tsResults');
  assert.match(await p.innerText('#tsResults'),/No new stations discovered/);
  assert.equal(await p.evaluate(()=>__trip.state().result.stale),1,'only the retained genuinely old price counts as old');
  assert.match(await p.innerText('#tsResults'),/unknown pump-update times/);
  await p.evaluate(()=>__trip.step(6));
  assert.equal(await p.isDisabled('#taResults [data-trip-refresh="api"]'),true,'explicit API choice respects its cap');
  await p.click('#taResults [data-trip-refresh="web"]');await p.waitForFunction(()=>!__trip.state().busy);
  assert.equal(await p.evaluate(()=>__api.web),2,'cached area answers avoid duplicate website loads');
  assert.equal(await p.evaluate(()=>__api.places),0);
  for(const step of [7,8]){
    await p.evaluate(step=>__trip.step(step),step);
    await p.waitForSelector('#tpS'+step);
    assert.equal(await p.locator('#tpS'+step+' .price-refresh-card').count(),0);
  }
  await p.evaluate(()=>__trip.step(6));
  await p.evaluate(()=>{__app.KV.clear('gasweb');__app.N.siteRead=(id,key,args)=>{};__app.N.cancelSiteRead=key=>{window.__cancelKey=key;};});
  await p.click('#taResults [data-trip-refresh="web"]');
  await p.waitForSelector('#taResults [data-cancel-prices]');
  await p.waitForFunction(()=>document.querySelector('#taResults').textContent.includes('Estimating time'));
  assert.match(await p.innerText('#taResults'),/Estimating time/);
  await p.click('#taResults [data-cancel-prices]');
  await p.waitForFunction(()=>!__trip.state().busy);
  assert.equal(await p.evaluate(()=>__app.KV.get('trips','trip|saved-test').v.stations.priceRefresh.cancelled),true);
  assert.equal(await p.evaluate(()=>PriceHistory.history({brand:'exxon',id:__originalStations[0].id},{grade:'regular'}).some(r=>r.price===3.12)),true);
  // Reopen the saved trip: refreshed prices and original discovery timestamp survive.
  await p.click('#tClose');await p.click('#btnTrip');await p.click('[data-hist="saved-test"]');
  await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>__trip.step(7));
  await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy);
  assert.ok(await p.evaluate(()=>__trip.state().result.cands.some(c=>c.station.prices.regular.price===3.12)));
  assert.equal(await p.evaluate(()=>__api.places+__api.routes),0);
  await p.click('#tClose');await p.click('#btnSettings');
  assert.equal(await p.inputValue('#routesMonthlyCap'),'9500');
  await p.fill('#routesMonthlyCap','9400');await p.click('#sDone');
  assert.equal(await p.evaluate(()=>__app.S.routesMonthlyCap),9400);
  assert.equal(await p.evaluate(()=>__app.S.monthlyCap),900);
  assert.equal(errors.length,0,errors.join('\n'));
  await p.close();console.log('Saved trip: zero paid calls, no added stations, preserved geometry/grades/detours, cache reuse, reopen and separate Routes setting passed');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
