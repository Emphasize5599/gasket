const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:320,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{const S=__app.S,c=DemoCars.create().find(c=>c.power==='ev');S.cars=[c];S.carId=c.id;S.setupDone=true;});
 await p.click('#btnTrip');await p.click('#gInfo summary');await p.click('#gInfoEdit');await p.waitForFunction(()=>!Garage.trimBusy());
 await p.locator('#gEnergyProfile').evaluate(e=>e.closest('details').open=true);assert.equal(await p.inputValue('#gEnergyProfile'),'estimate');
 assert.match(await p.locator('#gEnergyProfile option[value="tum-m3-lfp"]').innerText(),/I confirm.*CATL LFP/);
 await p.selectOption('#gEnergyProfile','tum-m3-lfp');await p.check('#gPrecondition');await p.fill('#gPackTemp','-5');await p.locator('#gPackTemp').dispatchEvent('change');
 assert.equal(await p.evaluate(()=>Garage.car().propulsion.initialTempC),-5);assert.equal(await p.evaluate(()=>Garage.car().propulsion.precondition),true);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'320px editor remains contained');
 const parity=await p.evaluate(async()=>{
  let m=Trip.restoreModel({pts:[],cum:[],totalMi:240,durationSec:14400,legEnds:[240],cityGpm:.25,hwyGpm:.25,combGpm:.25,segs:[{from:0,to:240,t0:0,t1:14400,mph:60,gpm:.25}]}),opts=()=>({model:m,cands:[{id:'one',d:120,price:.4,stationKw:150,kw:105}],startGal:48,capGal:60,fillCap:48,bufferGal:5,arriveGal:5,step:.1,fuelKind:'ev',stopMinutes:5,propulsion:{kind:'ev',capacity:60},propulsionContext:{departAt:Date.UTC(2026,9,22),weather:[]}});
  let o=opts(),q=await Planner.run(o),again=await Planner.run(o),direct=Trip.plan(opts());return {ok:q.ok,parity:JSON.stringify(q)===JSON.stringify(direct),repeat:JSON.stringify(q)===JSON.stringify(again),restored:typeof o.model.galTo==='function',ledger:Trip.account(48,.2,[{stops:Trip.purchases(q),arriveGal:q.arriveGal}]).legs[0].spend,cost:q.totals.cost};
 });assert(parity.ok);assert(parity.parity);assert(parity.repeat);assert(parity.restored);assert(Math.abs(parity.ledger-parity.cost)<1e-8);assert.deepEqual(errors,[]);
 console.log('Propulsion browser: narrow editor, explicit profile consent, per-car inputs, real worker parity, repeat projection and billing passed');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
