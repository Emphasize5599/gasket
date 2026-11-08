// 0.0.424: tires change planned mileage (gas by elasticity, EVs through the road-load curve), and an EV with an EPA
// road-load test gets the Best cruising speed curve in mi/kWh.
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{const p=await b.newPage({viewport:{width:360,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(()=>{Garage.installDemo();});
 const r=await p.evaluate(()=>{const S=__app.S,tesla=S.cars.find(c=>c.id==='demo-tesla'),prime=S.cars.find(c=>c.id==='demo-prime');const out={};
  const set=(c,type,model)=>{c.tires.type=type;c.tires.model=model||'';c.tires.brand='Test';c.tires.tread={mode:'measure',depth:TireMath.newDepth(type)};if(c.tires.corners)c.tires.corners.split=false;};
  set(prime,'Touring All-Season');out.primeTouring=Garage.carModel(prime);set(prime,'All-Terrain');out.primeAT=Garage.carModel(prime);out.primeEffect=Garage.tireEffect(prime);
  set(tesla,'Touring All-Season','Energy Saver');out.teslaEco=Garage.carModel(tesla);out.ecoA=Garage.evEnergy(tesla).roadLoad.a;
  set(tesla,'All-Terrain');out.teslaAT=Garage.carModel(tesla);out.atA=Garage.evEnergy(tesla).roadLoad.a;out.teslaEffect=Garage.tireEffect(tesla);
  const f=Garage.evSpeedFn(tesla);out.curve=f?[f(55),f(65),f(75)]:null;
  prime.obs={hwy:50};out.typed=Garage.carModel(prime).hwy;return out;});
 assert(r.primeAT.hwy<r.primeTouring.hwy&&r.primeAT.city<r.primeTouring.city,'all-terrain tires lower a gas car’s mileage');
 const atLoss=1-r.primeAT.hwy/r.primeTouring.hwy;assert(atLoss>0.025&&atLoss<0.045,'about 3% on the highway, like the measured all-terrain pair: '+atLoss);
 assert(r.teslaAT.hwy<r.teslaEco.hwy&&r.atA>r.ecoA,'an EV’s rolling term grows with all-terrain tires');
 const evCity=1-r.teslaAT.city/r.teslaEco.city,evHwy=1-r.teslaAT.hwy/r.teslaEco.hwy;assert(evCity>evHwy,'rolling counts for more at town speeds in an EV: '+evCity+' vs '+evHwy);
 assert(r.curve&&r.curve[0]>r.curve[1]&&r.curve[1]>r.curve[2],'the EV curve falls with speed');
 assert.equal(r.typed,50,'typed (logged) mileage is used as is');
 // the Garage card: an EV with an EPA road-load test gets the Best cruising speed curve in mi/kWh
 await p.evaluate(()=>{__app.S.carId='demo-tesla';});await p.click('#btnTrip');await p.evaluate(()=>__trip.step(1));await p.waitForSelector('details.spd-card',{state:'attached'});
 await p.evaluate(()=>{const d=document.querySelector('details.spd-card');d.open=true;});
 await p.waitForFunction(()=>/mi\/kWh/.test(document.querySelector('details.spd-card').textContent));
 const txt=await p.textContent('details.spd-card');assert.match(txt,/\d+\s*mph/);assert.match(txt,/kWh \/ 100 mi/);assert.match(txt,/electricity/);assert.match(await p.innerHTML('details.spd-card'),/Includes(%20| )your(%20| )tires/);
 assert.match(await p.textContent('details.spd-card .spd-pill'),/^\d+ mph$/);
 assert.equal(await p.locator('#sTime').count(),0,'no time-value setting');assert.doesNotMatch(txt,/time is worth|\/hr/i);
 assert.deepEqual(errors,[]);console.log('tire-fuel-ui ok');}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1);});
