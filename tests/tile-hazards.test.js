const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 for(const width of [320,448]){
  const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await p.click('#sDone');await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
  // A real submenu scroll container at enlarged text: stick, collide, then pass.
  await p.evaluate(()=>__app.subPage('Tile headers','<div class="card" id="testTile"><h3>First tile</h3><div style="height:700px">Contents</div></div><div class="card"><h3>Next tile</h3><div style="height:700px">More contents</div></div>',body=>{body.style.fontSize='130%';}));
  await p.waitForFunction(()=>{const page=document.querySelector('.sub-page');return parseFloat(page.style.getPropertyValue('--sub-head-h'))===page.querySelector('.sub-bar').getBoundingClientRect().height;});
  const geometry=await p.evaluate(()=>{const page=document.querySelector('.sub-page'),tile=document.querySelector('#testTile'),h=tile.querySelector('h3'),bar=page.querySelector('.sub-bar');page.style.scrollBehavior='auto';page.scrollTop=200;return new Promise(r=>requestAnimationFrame(()=>{const top=h.getBoundingClientRect().top,target=bar.getBoundingClientRect().bottom;page.scrollTop=tile.offsetTop+tile.offsetHeight-30;requestAnimationFrame(()=>r({top,target,passed:h.getBoundingClientRect().top<target-10,bounded:h.getBoundingClientRect().bottom<=tile.getBoundingClientRect().bottom+1,overflow:page.scrollWidth>page.clientWidth}));}));});
  assert.ok(Math.abs(geometry.top-geometry.target)<3,JSON.stringify(geometry));assert.ok(geometry.passed&&geometry.bounded,JSON.stringify(geometry));assert.equal(geometry.overflow,false);
  if(process.env.UI_SHOT&&width===320){await p.evaluate(()=>document.querySelector('.sub-page').scrollTop=200);await p.screenshot({path:process.env.UI_SHOT});}
  await p.click('.sub-back');
  await p.evaluate(()=>{
   const A=__app,S=A.S;S.trip.departNow=true;const alts=__mocks.route({origin:{placeId:'P-start'},destination:{placeId:'P-end'},computeAlternativeRoutes:true}).routes,m=Trip.buildRoute(alts[0],Garage.carModel());
   const saved={route:{stops:[{label:'Start',address:'100 Main St',lat:m.pts[0].lat,lng:m.pts[0].lng},{label:'End',address:'200 Main St',lat:m.pts.at(-1).lat,lng:m.pts.at(-1).lng}]},alts,altSel:0,trip:{fuel:{mode:'miles',miles:'180'},milesLeft:'180',avoid:{}},stations:{official:[],google:[]},savedT:Date.now()};
   A.KV.put('trips','trip|hazards',saved);A.KV.put('trips','index',[{id:'hazards',title:'Start → End',t:saved.savedT,mi:318,via:'Test route',n:0}]);
   delete __mocks.severity;window.__ai='loading';window.__reads=0;window.__ratings=0;
   Severity.state=()=>__ai;Severity.compare=()=>Promise.resolve({heat:.7});
   RouteWx.forRoute=async()=>{__reads++;return {hazards:[],stats:{aiPending:1},alerts:[],dense:[],forecast:[]};};
   RouteWx.rerate=()=>{__ratings++;return new Promise(r=>{window.__finishRating=()=>r({hazards:[],stats:{aiPending:0}});});};
  });
  await p.click('#btnTrip');await p.click('[data-hist="hazards"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>{__app.S.trip.departNow=true;__trip.step(4);});await p.waitForFunction(()=>__reads===2);
  await p.evaluate(()=>{const original=Date.now;Date.now=()=>original()+65000;__trip.step(4);});assert.equal(await p.evaluate(()=>__reads),2,'Now advancing one minute retains completed hazard checks');
  await p.evaluate(()=>{__ai='ready';});await p.waitForFunction(()=>__ratings===1);assert.match(await p.innerText('#tHz'),/AI rating warnings/);
  await p.evaluate(()=>__finishRating());await p.waitForFunction(()=>__ratings===2);await p.evaluate(()=>__finishRating());await p.waitForFunction(()=>!document.querySelector('#tHz').textContent.includes('AI rating warnings'));
  await p.evaluate(()=>__trip.step(4));assert.equal(await p.evaluate(()=>__reads),2,'AI rating does not repeat network checks');assert.equal(await p.evaluate(()=>__ratings),2,'each completed entry gets one AI pass');
  assert.equal(errors.length,0,errors.join('\n'));await p.close();
 }
 console.log('320/448px sticky tile boundaries, enlarged-text submenu clearance, stable Now hazards and explicit network-free one-shot AI phase passed');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
