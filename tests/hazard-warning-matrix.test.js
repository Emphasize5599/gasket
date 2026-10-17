const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const W=require('../assets/web/routewx'),wet=new Set(['rain','storm','flood','tropical','snow','ice']);
for(const kind of Object.keys(W.KINDS))assert.equal(W.tireRisk({tires:[{depth:3}]},[{kind}]).tires.length>0,wet.has(kind),kind);
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await browser.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  const A=__app;A.S.trip.departNow=false;A.S.trip.depart=new Date(Date.now()+86400000).toISOString().slice(0,16);A.S.trip.fuel={mode:'miles',miles:'180'};A.S.trip.milesLeft='180';
  Garage.car().tires={size:'195/65R15',type:'Touring All-Season',tread:{mode:'measure',depth:3,dot:'2324'},corners:{split:false},spare:{kind:'none'},aired:Date.now()};
  const alts=__mocks.route({origin:{placeId:'P-start'},destination:{placeId:'P-end'},computeAlternativeRoutes:true}).routes,m=Trip.buildRoute(alts[0],Garage.carModel());
  const saved={route:{stops:[{label:'Start',lat:m.pts[0].lat,lng:m.pts[0].lng},{label:'End',lat:m.pts.at(-1).lat,lng:m.pts.at(-1).lng}]},alts,altSel:0,trip:{fuel:A.S.trip.fuel,departNow:false,depart:A.S.trip.depart},stations:{official:[],google:[]},savedT:Date.now()};
  A.KV.put('trips','trip|matrix',saved);A.KV.put('trips','index',[{id:'matrix',title:'Hazard matrix',t:saved.savedT,mi:318,n:0}]);window.__kind='rain';
  RouteWx.forRoute=async m=>({hazards:m.totalMi>320?[{kind:__kind,level:2,fromMi:20,toMi:40,from:Date.now(),to:Date.now()+3600000,peak:{aqi:160,tF:105,gust:55,precip:.4,snow:.5,cause:'smoke'},events:['Test warning']}]:[],stats:{},alerts:[],dense:[],forecast:[]});
 });
 await p.click('#btnTrip');await p.click('[data-hist="matrix"]');await p.waitForFunction(()=>__trip.state().model&&!__trip.state().busy);
 for(const [index,kind] of Object.keys(W.KINDS).entries()){
  await p.evaluate(({kind,index})=>{window.__kind=kind;__app.S.trip.departNow=false;__app.S.trip.depart=new Date(Date.now()+(index+1)*86400000).toISOString().slice(0,16);__trip.step(5);},{kind,index});
  await p.waitForSelector('[data-hzk="1"] .hz-n');await p.click('[data-hzk="1"]');
  if(wet.has(kind)){
   await p.waitForSelector('.wet-tire-warning');assert((await p.innerText('#cfm')).includes(W.KINDS[kind][0]),kind+' has the correct hazard name');
   await p.click('#cfmNo');await p.waitForSelector('#cfm',{state:'detached'});assert.equal(await p.getAttribute('.hz-opt.on','data-hzk'),'0');
   await p.click('[data-hzk="1"]');await p.waitForSelector('.wet-tire-warning');
   if(kind==='snow')await p.locator('#cfm .cfm').evaluate(e=>{e.style.fontSize='22px';e.querySelectorAll('p,li,button').forEach(x=>x.style.fontSize='22px');});
   const bounds=await p.locator('#cfm .cfm').evaluate(e=>({overflow:e.scrollWidth>e.clientWidth,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}));assert(!bounds.overflow&&bounds.top>=0&&bounds.bottom<=900,kind+': '+JSON.stringify(bounds));
   await p.click('#cfmYes');await p.waitForSelector('#cfm',{state:'detached'});
  }
  await p.waitForFunction(()=>document.querySelector('.hz-opt.on').dataset.hzk==='1');assert.equal(await p.locator('#cfm').count(),0,kind);
  assert((await p.innerText('#tWx')).trim().length>100,kind+' renders warning/advice content');
  assert.equal(await p.locator('#tWx .wx-x').count()>0,true,kind+' has a hazard entry');
  await p.click('[data-hzk="0"]');await p.waitForFunction(()=>document.querySelector('.hz-opt.on').dataset.hzk==='0');
 }
 assert.deepEqual(errors,[]);await p.close();
}console.log('All '+Object.keys(W.KINDS).length+' hazard kinds render at 320/448px; every wet kind confirms/cancels, unrelated hazards do not trigger tread dialogs');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
