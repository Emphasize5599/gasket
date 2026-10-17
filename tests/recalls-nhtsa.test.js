// NHTSA's recall list: a 400 means "nothing under that name" (shorter names are tried: "Model 3 Long Range" -> "Model 3"),
// and a failure waits an hour instead of being asked again on every redraw.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
  const p=await b.newPage({viewport:{width:412,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await require('./onboarding-ui')(p);
  await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
  await p.evaluate(()=>{window.__asked=[];window.__mocks.recalls=u=>{const m=decodeURIComponent(/model=([^&]*)/.exec(u)[1]);window.__asked.push(m);
    if(window.__recallsDown)return {__error:'HTTP 503'};
    return m==='Model 3'?{Count:1,results:[{NHTSACampaignNumber:'21V000000',Component:'TEST',Summary:'A test recall.',Consequence:'',Remedy:''}]}:{__error:'HTTP 400'};};
    const c=__app.S.cars[0];Object.assign(c,{year:2021,make:'Tesla',model:'Model 3 Long Range AWD',epaId:'',recalls:null});});
  await p.click('#btnTrip');await p.waitForFunction(()=>Garage.car().recalls&&Garage.car().recalls.list);
  assert.deepEqual(await p.evaluate(()=>__asked),['Model 3 Long Range','Model 3 Long','Model 3'],'shorter names until NHTSA knows one');
  assert.equal(await p.evaluate(()=>Garage.car().recalls.list.length),1);
  // nothing under any name (NHTSA's 400 each time): zero on record, not an error
  await p.evaluate(()=>{window.__asked=[];const c=Garage.car();c.model='Prius Prime';c.make='Toyota';c.recalls=null;window.dispatchEvent(new Event('garagechange'));});
  await p.waitForFunction(()=>Garage.car().recalls&&Garage.car().recalls.key&&Garage.car().recalls.key.includes('prius'));
  assert.deepEqual(await p.evaluate(()=>[Garage.car().recalls.list,Garage.car().recalls.error||false,__asked]),[[],false,['Prius Prime','Prius']]);
  // NHTSA down, with an old list for the car: kept, and not asked again on every redraw
  await p.evaluate(()=>{window.__recallsDown=true;window.__asked=[];const c=Garage.car();c.recalls.t=Date.now()-30*864e5;window.dispatchEvent(new Event('garagechange'));});
  await p.waitForFunction(()=>Garage.car().recalls.errT);
  for(let i=0;i<10;i++){await p.evaluate(()=>{window.dispatchEvent(new Event('garagechange'));Garage.redraw();});await p.waitForTimeout(60);}
  const asked=await p.evaluate(()=>__asked.length);assert.ok(asked<=2,'asked '+asked+' times');
  assert.deepEqual(await p.evaluate(()=>Garage.car().recalls.list),[],'the earlier list stays');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('NHTSA recalls: 400 = none under that name, shorter names tried, failures wait instead of looping');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
