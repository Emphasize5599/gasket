const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await browser.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.click('#sDone');await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  const T=Trip,A=__app;A.S.apiKey='TEST';A.S.keylessRegular=false;A.S.trip.fuel={mode:'miles',miles:'250'};A.S.trip.milesLeft='250';A.S.trip.altCompare=true;A.S.trip.bufferMi=40;A.S.trip.departNow=true;A.S.brands={exxon:true};A.siteOn=()=>false;
  const raw=(leg,k)=>{const points=[{lat:34+leg*.7,lng:-92},{lat:34+leg*.7+.35,lng:-92+(k*.025)},{lat:34+(leg+1)*.7,lng:-92}];return {description:'Leg '+(leg+1)+' option '+k,distanceMeters:(50+k*5)*1609.344,duration:(3600+k*300)+'s',polyline:{encodedPolyline:T.encodePolyline(points)},legs:[{distanceMeters:(50+k*5)*1609.344,duration:(3600+k*300)+'s',steps:[]}]};};
  const legs=[0,1].map(i=>({sel:0,alts:[0,1,2].map(k=>raw(i,k))})),combine=(sel,leg)=>Object.assign(T.joinRoutes(legs.map((l,i)=>l.alts[sel[i]])),{_sel:sel,_leg:leg,description:'Combined '+sel.join('/')});
  const alts=[combine([0,0]),combine([1,0],0),combine([2,0],0),combine([0,1],1),combine([0,2],1)];
  const saved={route:{stops:[{label:'Start',lat:34,lng:-92},{label:'Middle',lat:34.7,lng:-92},{label:'End',lat:35.4,lng:-92}],legs},alts,altSel:0,altSure:true,trip:{from:'100 Main St, Testville',to:'200 Main St, Testville',fuel:A.S.trip.fuel,altCompare:true,routeChoices:{}},stations:{official:[],google:[]},savedT:Date.now()};
  A.KV.put('trips','trip|choice-test',saved);A.KV.put('trips','index',[{id:'choice-test',title:'Synthetic two-leg route',t:saved.savedT,mi:100,n:3}]);
  window.__paid=0;A.N.search=A.N.computeRoute=A.N.routeSearch=()=>__paid++;
  window.__phases=[];const discover=KeylessGas.discover;KeylessGas.discover=async function(...args){__phases.push('start');const r=await discover(...args);__phases.push('end');return r;};
  A.N.siteRead=(id,key,json)=>{if(!/^gasweb/.test(key))return setTimeout(()=>onNativeResult(id,{stores:[]}),0);const a=JSON.parse(json),m=/@(-?[\d.]+),(-?[\d.]+)/.exec(a.url),lat=+m[1],lng=+m[2];setTimeout(()=>onNativeResult(id,{stores:[{id:'web:'+lat+':'+lng,name:'Exxon',brand:'exxon',lat,lng,address:'100 Test St',source:'Google Maps web',prices:{regular:{price:3.25}}}],detail:{exhausted:true}}),0);};
 });
 await p.click('#btnTrip');await p.click('[data-hist="choice-test"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);await p.evaluate(()=>__app.S.trip.departNow=true);
 await p.evaluate(()=>__trip.step(3));await p.waitForSelector('#tAltCmp');assert.equal(await p.locator('#tpS3 #tAltCmp').count(),1,'route comparison switch lives in Route');
 await p.evaluate(()=>__trip.step(4));await p.waitForSelector('[data-hzk]');
 await p.click('#tNext');await p.click('#tNext');await p.waitForFunction(()=>document.querySelector('#tBack').textContent==='No');
 assert.match(await p.innerText('#tHz'),/consider this route/i);assert.equal(await p.locator('#tHz [data-hzk]').count(),1);
 await p.click('#tBack');await p.click('#tNext');await p.click('#tNext');await p.click('#tBack'); // No/Yes, Yes/No
 await p.waitForFunction(()=>__trip.state().step===5);
 assert.equal(await p.locator('#tpS5 #tAltCmp').count(),0,'not repeated in Parameters');
 await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy,{},{timeout:20000});
 await p.click('#taResults [data-split]');await p.click('#taResults [data-trip-refresh="discover"]');await p.waitForFunction(()=>__phases.length===4&&!__trip.state().busy,{},{timeout:20000});
 assert.equal(await p.evaluate(()=>__paid),0,'explicit no-API discovery must not become paid discovery when a key exists');
 assert.deepEqual(await p.evaluate(()=>__phases),['start','end','start','end'],'primary search completes before approved alternatives start');
 for(const [i,buffer] of [15,25,35,45].entries()){
  assert.match(await p.innerText('.route-choice-adjust h3'),new RegExp('route '+(i+1)+' of 4','i'));
  await p.fill('#choiceBuffer',String(buffer));await p.locator('#choiceBuffer').dispatchEvent('change');await p.waitForFunction(()=>!document.querySelector('#tNext').disabled);
  if(i<3)await p.click('#tNext');
 }
 assert.deepEqual(await p.evaluate(()=>__trip.state().result.opts.legPolicies.map(x=>Math.round(x.bufferGal/__trip.state().model.combGpm))),[15,25],'alternative changes do not leak to primary or the other leg');
 await p.click('#tNext');await p.waitForSelector('.route-choice-compare');assert.match(await p.innerText('.route-choice-compare h3'),/leg 1 of 2/i);
 assert.equal(await p.locator('[data-choice-route]').count(),2,'rejected route is not compared');
 await p.click('[data-choice-route="2"]');await p.waitForFunction(()=>!document.querySelector('#tNext').disabled);await p.click('#tNext');
 assert.match(await p.innerText('.route-choice-compare h3'),/leg 2 of 2/i);
 await p.click('[data-choice-route="1"]');await p.waitForFunction(()=>!document.querySelector('#tNext').disabled);
 assert.deepEqual(await p.evaluate(()=>__trip.state().result.opts.legPolicies.map(x=>Math.round(x.bufferGal/__trip.state().model.combGpm))),[35,45]);
 assert.deepEqual(await p.evaluate(()=>__trip.state().route.legs.map(l=>l.sel)),[2,1]);
 assert.equal(await p.evaluate(()=>__paid),0);assert.equal(await p.evaluate(()=>__phases.length),4,'combining leg choices does not discover or route again');
 assert.equal(await p.evaluate(()=>__app.S.trip.bufferMi),40,'global defaults are unchanged');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 if(width===320){await p.screenshot({path:path.resolve('../..','outputs','route-choice-compare.png')});}
 await p.click('#tNext');await p.waitForFunction(()=>__trip.state().step===7);
 assert.equal(await p.evaluate(()=>{const id=__app.KV.get('trips','index').v[0].id,v=__app.KV.get('trips','trip|'+id).v;return v.trip.altCompare&&v.route.legs[0].sel===2&&v.route.legs[1].sel===1&&Object.values(v.trip.routeChoices).some(c=>c.bufferMi===45);}),true,'saved trips retain explicit choices and per-leg settings');
 await p.evaluate(()=>__trip.step(3));await p.uncheck('#tAltCmp');await p.check('#tAltCmp');await p.evaluate(()=>{__app.S.trip.routeChoices={};__trip.step(4);});
 await p.click('#tNext');await p.click('#tNext');for(let i=0;i<4;i++)await p.click('#tBack');
 await p.waitForFunction(()=>__trip.state().step===5);await p.evaluate(()=>__trip.step(6));await p.waitForFunction(()=>__trip.state().result&&!__trip.state().busy);
 await p.click('#tNext');await p.click('#tNext');await p.waitForSelector('.route-choice-compare');
 assert.equal(await p.locator('[data-choice-route]').count(),1,'all-No keeps a valid primary-only comparison');assert.equal(await p.locator('[data-choice-route]').isDisabled(),false);
 if(width===448){await p.evaluate(()=>{const es=[...document.querySelectorAll('#trip *')],sizes=es.map(e=>parseFloat(getComputedStyle(e).fontSize));es.forEach((e,i)=>{if(sizes[i])e.style.fontSize=sizes[i]*1.3+'px';});});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 assert.equal(await p.evaluate(()=>__paid),0);assert.deepEqual(errors,[]);await p.close();
}console.log('320/448px explicit Yes/No, primary-first discovery, per-leg route adjustments, leg comparison and keyless local recombination passed');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
