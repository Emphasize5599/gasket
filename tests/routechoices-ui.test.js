const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await browser.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.click('#sDone');await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  const T=Trip,A=__app;A.S.apiKey='TEST';A.S.keylessRegular=false;A.S.trip.fuel={mode:'miles',miles:'250'};A.S.trip.milesLeft='250';A.S.trip.altCompare=true;A.S.trip.bufferMi=40;A.S.trip.altMinSave=.1;A.S.trip.tankPrice='3.50';A.S.limitLookup=false;A.S.trip.departNow=true;A.S.brands={exxon:true};A.siteOn=()=>false;
  const raw=(leg,k)=>{const points=[{lat:34+leg*.7,lng:-92},{lat:34+leg*.7+.35,lng:-92+(k*.025)},{lat:34+(leg+1)*.7,lng:-92}];return {description:'Leg '+(leg+1)+' option '+k,distanceMeters:([60,55,45][k])*1609.344,duration:(3600+k*300)+'s',polyline:{encodedPolyline:T.encodePolyline(points)},legs:[{distanceMeters:([60,55,45][k])*1609.344,duration:(3600+k*300)+'s',steps:[]}]};};
  const legs=[0,1].map(i=>({sel:0,alts:[0,1,2].map(k=>raw(i,k))})),combine=(sel,leg)=>Object.assign(T.joinRoutes(legs.map((l,i)=>l.alts[sel[i]])),{_sel:sel,_leg:leg,description:'Combined '+sel.join('/')});
  const alts=[combine([0,0]),combine([1,0],0),combine([2,0],0),combine([0,1],1),combine([0,2],1)];
  const saved={route:{stops:[{label:'Start',lat:34,lng:-92},{label:'Middle',lat:34.7,lng:-92},{label:'End',lat:35.4,lng:-92}],legs},alts,altSel:0,altSure:true,trip:{from:'100 Main St, Testville',to:'200 Main St, Testville',fuel:A.S.trip.fuel,altCompare:true,altMinSave:.1,routeChoices:{}},stations:{official:[],google:[]},savedT:Date.now()};
  A.KV.put('trips','trip|choice-test',saved);A.KV.put('trips','index',[{id:'choice-test',title:'Synthetic two-leg route',t:saved.savedT,mi:100,n:3}]);
  window.__paid=0;A.N.search=A.N.computeRoute=A.N.routeSearch=()=>__paid++;
  window.__phases=[];window.__scanGate=new Promise(r=>window.__continueScan=r);const discover=KeylessGas.discover;KeylessGas.discover=async function(...args){__phases.push('start');args[1](.1,'Discovering stations…');await __scanGate;const r=await discover(...args);__phases.push('end');return r;};
  A.N.siteRead=(id,key,json)=>{if(!/^gasweb/.test(key))return setTimeout(()=>onNativeResult(id,{stores:[]}),0);const a=JSON.parse(json),m=/@(-?[\d.]+),(-?[\d.]+)/.exec(a.url),lat=+m[1],lng=+m[2];setTimeout(()=>onNativeResult(id,{stores:[{id:'web:'+lat+':'+lng,name:'Exxon',brand:'exxon',lat,lng,address:'100 Test St',source:'Google Maps web',prices:{regular:{price:3.25}}}],detail:{exhausted:true}}),0);};
 });
 await p.click('#btnTrip');await p.click('[data-hist="choice-test"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>__app.S.trip.departNow=true);
 await p.evaluate(()=>__trip.step(4));await p.waitForSelector('#tRule');
 await p.evaluate(()=>{Tasks.upsert('layout-test',{text:'Reading hazards…'});Tasks.upsert('layout-other',{text:'Downloading model…'});});await p.waitForSelector('#taskMore:not(.hidden)');
 assert(await p.evaluate(()=>{const bar=document.querySelector('#jobBar').getBoundingClientRect(),meter=document.querySelector('#apiCount').getBoundingClientRect(),tabs=document.querySelector('.tp-head').getBoundingClientRect();return bar.left>=meter.right+7&&bar.bottom<tabs.top;}),'full-screen status respects API meter and menu selectors');
 await p.evaluate(()=>{Tasks.remove('layout-test');Tasks.remove('layout-other');});
 assert.equal(await p.locator('#tTime').count(),0,'no dollar/hour input');
 await p.evaluate(()=>__trip.step(3));await p.waitForSelector('#tAltCmp');assert.equal(await p.locator('#tpS3 #tAltCmp').count(),1);
 await p.evaluate(()=>__trip.step(5));await p.waitForSelector('[data-hzk]');
 await p.click('#tNext');await p.click('#tNext');await p.waitForFunction(()=>document.querySelector('#tBack').textContent==='No');
 assert.equal(await p.locator('#tpNav.route-review').count(),1);const halves=await p.evaluate(()=>['tBack','tNext'].map(id=>{const e=document.getElementById(id);return {width:e.getBoundingClientRect().width,color:getComputedStyle(e).backgroundColor};}));assert(Math.abs(halves[0].width-halves[1].width)<1);assert.equal(halves[0].color,'rgb(198, 40, 40)');assert.equal(halves[1].color,'rgb(24, 128, 56)');
 const firstReview=await p.locator('.hz-opt b').textContent();await p.click('#tReviewBack');assert.equal(await p.innerText('#tBack'),'Back','first review backs out to primary selection');
 await p.click('#tNext');await p.waitForSelector('#tReviewBack');assert.equal(await p.locator('.hz-opt b').textContent(),firstReview);
 await p.click('#tBack');const secondReview=await p.locator('.hz-opt b').textContent();assert.notEqual(secondReview,firstReview);
 await p.click('#tReviewBack');assert.equal(await p.locator('.hz-opt b').textContent(),firstReview,'previous answered route can be revisited');
 await p.click('#tBack');assert.equal(await p.locator('.hz-opt b').textContent(),secondReview,'forward goes to the next question without skipping answered ones');
 await p.evaluate(()=>__tripBack());assert.equal(await p.locator('.hz-opt b').textContent(),firstReview,'Android Back matches the visible Back action');
 // Simulate late search/plan completion: labels must remain review actions, not Back/Next.
 await p.evaluate(()=>{__trip.relogo();__trip.discountsChanged();});await p.waitForTimeout(80);assert.equal(await p.innerText('#tBack'),'No');assert.equal(await p.innerText('#tNext'),'Yes');
 await p.click('#tBack');await p.click('#tNext');await p.click('#tNext');await p.click('#tBack');
 await p.waitForFunction(()=>__trip.state().step===6&&!__trip.state().busy);
 await p.waitForSelector('#tsBuf');await p.waitForSelector('#tsDet');
 await p.locator('#tsBuf').evaluate(el=>{el.value='30';el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));});
 await p.waitForSelector('#tsDet');await p.locator('#tsDet').evaluate(el=>{el.value='4';el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));});
 assert.equal(await p.locator('.route-choice-adjust').count(),0,'one global adjustment screen, not per-leg settings');
 await p.evaluate(()=>{window.__projectCount=0;const original=Trip.projectLegs;Trip.projectLegs=function(...args){__projectCount++;return original(...args);};});
 await p.click('#tNext');await p.waitForFunction(()=>__trip.state().step===7);
 await p.waitForFunction(()=>document.querySelectorAll('.trip-proposal').length===3,null,{timeout:20000});
 assert.equal(await p.locator('.proposal-map').count(),3,'all combinations including changing both legs');
 assert.equal(await p.locator('.trip-proposal .stops-list,.trip-proposal .pin').count(),0,'recommendations contain no fuel stops');
 assert.match(await p.locator('.proposal-delta').first().innerText(),/min/);
 await p.click('[data-decline="0"]');assert.equal(await p.locator('.trip-proposal').count(),2);
 await p.click('#tNext');await p.waitForSelector('#tsIdeal');
 assert.deepEqual(await p.evaluate(()=>__trip.state().route.legs.map(l=>l.sel)),[0,0],'Next skips recommendations without changing the trip');
 if(width===320){
  await p.evaluate(()=>{window.__plannerRun=Planner.run;window.__holdPlan=true;Planner.run=function(o,c){if(!__holdPlan)return __plannerRun(o,c);__holdPlan=false;return new Promise(resolve=>{window.__releasePlan=()=>__plannerRun(o,c).then(resolve);});};__trip.step(6);});
  await p.click('#tNext');await p.waitForFunction(()=>typeof __releasePlan==='function');await p.click('#tNext');await p.waitForSelector('#tsIdeal');
  await p.evaluate(()=>__releasePlan());await p.waitForFunction(()=>!Tasks.list().some(t=>t.id==='route-comparison'));assert.deepEqual(await p.evaluate(()=>__trip.state().route.legs.map(l=>l.sel)),[0,0],'skipping in-flight work cannot change the selection');await p.evaluate(()=>Planner.run=__plannerRun);
 }
 await p.evaluate(()=>__trip.step(6));await p.click('#tNext');await p.waitForFunction(()=>document.querySelectorAll('.trip-proposal').length===3);
 await p.waitForSelector('.proposal-map .osm-tiles',{state:'attached',timeout:5000});   // the themed layer: dark mode inverts .osm-tiles
 const chosen=await p.evaluate(()=>{const rs=[...document.querySelectorAll('.trip-proposal')];return rs.find(r=>r.textContent.includes('option 2 / Leg 2 option 1')).dataset.proposal;});
 await p.evaluate(()=>{window.__goodRun=Planner.run;Planner.run=function(){Planner.run=__goodRun;return Promise.reject(new Error('Synthetic failure'));};});
 await p.click('[data-replace="'+chosen+'"]');await p.waitForFunction(()=>!document.querySelector('[data-replace]').disabled);assert.deepEqual(await p.evaluate(()=>__trip.state().route.legs.map(l=>l.sel)),[0,0],'failed replacement leaves the trip unchanged');
 await p.click('[data-replace="'+chosen+'"]');await p.waitForFunction(()=>__trip.state().step===6&&!Tasks.list().some(t=>t.id==='route-comparison'));
 // a replacement returns to Adjustments; its Next compares the trips once more before the stops
 await p.click('#tNext');await p.waitForFunction(()=>__trip.state().step===7&&!Tasks.list().some(t=>t.id==='route-comparison')&&!!document.querySelector('.trip-proposal,#tsResults .msg,#tsResults .note'));
 if(!await p.locator('#tsIdeal:visible').count()){await p.click('#tNext');}await p.waitForSelector('#tsIdeal',{state:'visible'});
 assert.deepEqual(await p.evaluate(()=>__trip.state().route.legs.map(l=>l.sel)),[2,1],'replacement commits the complete combination');
 assert.equal(await p.evaluate(()=>__trip.state().result.opts.timeValue),0);
 assert.equal(await p.evaluate(()=>__trip.state().result.bufMi),30);
 assert.equal(await p.evaluate(()=>__trip.state().result.opts.maxDetourMin),6);
 assert.equal(await p.evaluate(()=>__app.S.trip.bufferMi),40,'trip adjustments do not change saved defaults');
 assert.equal(await p.evaluate(()=>__projectCount),0,'combination search reuses leg station projections');
 assert.equal(await p.evaluate(()=>__paid),0,'comparison/replacement never calls paid discovery or routing');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // "Never below": the buffer can't be set (or slid) under the floor; raising it moves the trip's buffer up
 await p.evaluate(()=>__trip.step(6));await p.waitForSelector('#tsBufFloor');await p.waitForSelector('#tsBuf');
 assert.equal(await p.inputValue('#tsBufFloor'),'10','default floor');
 // snapping: with cost marks the knob lands on a mark (here buffers up to 20 mi are cheaper: a mark at 20)
 await p.evaluate(()=>{__trip.state().result.sweep.forEach(x=>{if(x.ok)x.net=x.mi<=20?-1:0;});});await p.fill('#tsBufFloor','5');await p.dispatchEvent('#tsBufFloor','change');await p.waitForSelector('#tsBufBox [data-bm="20"]',{state:'attached'});
 await p.locator('#tsBuf').evaluate(el=>{el.value='24';el.dispatchEvent(new Event('input'));});
 assert.equal(await p.inputValue('#tsBuf'),'20','the knob snaps to the nearest mark');
 await p.dispatchEvent('#tsBuf','change');await p.waitForFunction(()=>__trip.state().result.bufMi===20);
 await p.fill('#tsBufFloor','35');await p.dispatchEvent('#tsBufFloor','change');
 await p.waitForFunction(()=>__trip.state().result.bufMi>=35&&!!document.querySelector('#tsBuf'));
 assert.equal(await p.evaluate(()=>__app.S.trip.bufferFloor),35);
 await p.locator('#tsBuf').evaluate(el=>{el.value='31';el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));});await p.waitForTimeout(100);
 assert(await p.evaluate(()=>__trip.state().result.bufMi>=35),'the slider cannot go below the floor');
 assert.equal(await p.evaluate(()=>[...document.querySelectorAll('#tsBufBox .bm[data-snap]')].filter(m=>m.dataset.snap<35).length),0,'no savings marks below the floor');
 await p.fill('#tsBufFloor','0');await p.dispatchEvent('#tsBufFloor','change');await p.waitForSelector('#tsBuf');
 await p.locator('#tsBuf').evaluate(el=>{el.value='30';el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));});await p.waitForFunction(()=>__trip.state().result.bufMi===30);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.evaluate(()=>{__app.S.trip.bufferFloor=10;});
 await p.evaluate(()=>{__trip.state().route.legs.forEach((l,i)=>l.alts.forEach((a,k)=>{if(k!==l.sel)__app.S.trip.routeChoices[RouteChoices.key(i,a)]={consider:true};}));window.__pipelineSearch=__trip.find('discover');});
 await p.waitForFunction(()=>__trip.state().busy&&Tasks.list().some(t=>t.id==='trip-pending:alternatives'));
 await p.waitForSelector('#taskMore:not(.hidden)');await p.click('#taskMore');
 assert.match(await p.innerText('#jobBar'),/Primary routes/);assert.equal(await p.locator('#taskList [data-task-id="trip-draw"]').count(),0,'station progress has only one producer');
 assert.doesNotMatch(await p.innerText('#taskList'),/Discovering stations/,'primary discovery stays in its bar, never duplicated in the list');
 assert.match(await p.innerText('#taskList'),/Choosing stops/);assert.match(await p.innerText('#taskList'),/Searching approved alternative routes/);
 await p.evaluate(()=>__continueScan());await p.waitForFunction(()=>!__trip.state().busy);
 assert.equal(await p.evaluate(()=>Tasks.list().filter(t=>t.id.startsWith('trip-pending:')||t.id.startsWith('station-source:')).length),0,'completed pipeline leaves no pending or provider tasks');
 await p.evaluate(()=>__trip.close());assert.deepEqual(errors,[]);await p.close();
}console.log('320/448px global settings, optional whole-trip recommendations, decline, skip and cached replacement passed');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
