const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await browser.newPage({viewport:{width,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);
 await p.evaluate(()=>{
  const A=__app,pts=[{lat:34,lng:-92},{lat:34.2,lng:-92},{lat:34.4,lng:-92}],m=Trip.buildRoute({distanceMeters:44480,duration:'3200s',polyline:{encodedPolyline:Trip.encodePolyline(pts)},legs:[{distanceMeters:22240,duration:'1600s',steps:[]},{distanceMeters:22240,duration:'1600s',steps:[]}]},{city:30,hwy:40,comb:35}),r={stops:[{label:'Testville',...pts[0]},{label:'Capitol',...pts[1]},{label:'Testville',...pts[2]}]};
  A.S.restSources={ntad:{enabled:false},osm:{enabled:false},ridb:{enabled:false},rvparky:{enabled:false},campendium:{enabled:false}};window.__cfg={};
  const create=RestPlaces.create;RestPlaces.create=()=>({corridor:async()=>({sites:[],cells:1,asked:0,failed:0})});
  const ui=RestUI.init(A,{snapshot:()=>({model:m,route:r,depart:Date.now(),kind:'gas',maxDetourMin:30}),arrival:()=>Date.now(),access:async()=>({outSeconds:30,backSeconds:30}),call:async()=>({complete:true,places:[]}),
   restTraffic:()=>({mode:__cfg.mode==='leg'?'leg':'trip',minutes:__cfg.minutes!=null?__cfg.minutes:30,legs:__cfg.legs||{},fallback:30}),setRestTraffic:c=>{window.__cfg=c;},trafficSegments:()=>[{index:0,from:'Testville',to:'Capitol'},{index:1,from:'Capitol',to:'Testville'}],tolerance:()=>30});
  RestPlaces.create=create;const host=document.createElement('div');host.id='tol';host.innerHTML=ui.tile();document.body.appendChild(host);ui.bind(host);
 });
 await p.waitForSelector('#tol .rest-tol');await p.click('#tol .rest-tol > summary');assert.match(await p.innerText('#tol .rest-tol > summary'),/30 min/);
 assert.equal(await p.locator('#tol [data-rest-tol]').count(),1,'whole trip: one box');
 await p.selectOption('#tol [data-rest-tol-mode]','leg');await p.waitForSelector('#tol [data-rest-tol="1"]');assert.equal(await p.evaluate(()=>__cfg.mode),'leg');
 assert.match(await p.innerText('#tol .rest-tol'),/Leg 1: Testville → Capitol[\s\S]*Leg 2: Capitol → Testville/);assert.match(await p.innerText('#tol .rest-tol > summary'),/per leg/);
 await p.fill('#tol [data-rest-tol="1"]','45');await p.locator('#tol [data-rest-tol="1"]').dispatchEvent('change');await p.waitForFunction(()=>__cfg.legs&&__cfg.legs[1]===45);assert.equal(await p.getAttribute('#tol [data-rest-tol="0"]','placeholder'),'30','a blank leg shows the whole-trip value');
 await p.fill('#tol [data-rest-tol="1"]','999');await p.locator('#tol [data-rest-tol="1"]').dispatchEvent('change');assert.equal(await p.evaluate(()=>__cfg.legs[1]),45,'out-of-range is refused');
 await p.fill('#tol [data-rest-tol="1"]','');await p.locator('#tol [data-rest-tol="1"]').dispatchEvent('change');await p.waitForFunction(()=>!('1' in __cfg.legs));
 await p.selectOption('#tol [data-rest-tol-mode]','trip');await p.waitForFunction(()=>__cfg.mode==='trip');assert.equal(await p.locator('#tol [data-rest-tol]').count(),1);
 assert(!await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'fits '+width);assert.deepEqual(errors,[]);await p.close();}
 console.log('Rest traffic tolerance: whole trip or each leg, blank legs use the trip value, at 320/448px');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
