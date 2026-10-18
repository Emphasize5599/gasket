// The tank size from Brave is shown like the spare's answer: what Brave said (quoted), That's right / See Brave's
// answer. A figure too small for the car (a warning-light amount) isn't filled in, and an old saved one is cleared.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));await p.evaluate(()=>{__app.S.debug=true;__app.S.logLevel=4;__app.save();});
 const setup=(gal,text)=>p.evaluate(([gal,text])=>{window.__mocks=window.__mocks||{};window.__asks=[];__mocks.siteRead=(k,a)=>{if(k!=='brave')return {error:'none'};if(a.kind==='trims')return {text:'Trims: LE, XLE',src:'ai'};__asks.push(a);return {gal,text,src:'ai'};};
  const c=Garage.car();Object.assign(c,{year:2020,make:'Toyota',model:'Sienna',trim:'LE',entryMode:'custom',power:'gas',type:'car',tank:'',tankSrc:'',tankLookup:null});__app.save();},[gal,text]);
 // a good answer: filled in, with Brave's words under it
 await setup(20,'the 2020 Toyota Sienna LE has a fuel tank capacity of 20 gallons');
 await p.click('#btnTrip');await p.click('#gEdit');await p.waitForSelector('.tk-guess',{timeout:10000});
 assert.equal(await p.inputValue('#gTank'),'20');
 let box=await p.innerText('.tk-guess');assert.match(box,/Brave Search says: 20 gal/);assert.match(box,/fuel tank capacity of 20 gallons/,'the sentence it came from');
 assert.equal(await p.locator('#gTankYes').count(),1);assert.equal(await p.locator('#gTankSee').count(),1);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.click('#gTankYes');await p.waitForSelector('.tk-guess',{state:'detached'});assert.match(await p.evaluate(()=>Garage.car().tankSrc),/you confirmed/);
 await p.click('#gSave');
 // too small for a minivan: not filled in, said why, with Brave's answer to look at
 await setup(4,'With about 4 gallons left, the low fuel warning light comes on');
 await p.click('#gEdit');await p.waitForSelector('.tk-guess',{timeout:10000});
 assert.equal(await p.inputValue('#gTank'),'','4 gal is not filled in');box=await p.innerText('.tk-guess');
 assert.match(box,/says 4 gal, too small for this car/);assert.match(box,/warning light/);assert.equal(await p.locator('#gTankYes').count(),0);assert.equal(await p.locator('#gTankSee').count(),1);
 await p.click('#gDiscard');await p.click('#cfmYes');await p.waitForSelector('.car-edit',{state:'detached'});
 // a 4 saved by an older version: cleared when the Garage draws, and asked again
 await p.evaluate(()=>{const c=Garage.car();Object.assign(c,{tank:4,tankSrc:"from Brave Search's AI answer · check your owner's manual",tankLookup:{key:'old',t:0,gal:4}});__mocks.siteRead=(k,a)=>k==='brave'&&a.kind!=='trims'?{gal:20,text:'a 20-gallon fuel tank',src:'ai'}:k==='brave'?{text:'Trims: LE, XLE',src:'ai'}:{error:'none'};__app.save();Garage.redraw();});
 await p.waitForFunction(()=>+Garage.car().tank===20,null,{timeout:10000});
 assert(await p.evaluate(()=>FLog.entries().some(e=>/too small for this car: 4 gal \(cleared\)/.test(e.m))),'logged');
 assert.equal(errors.length,0,errors.join('\n'));await p.close();
}console.log('Tank answer from Brave: quoted with That\'s right / See Brave\'s answer; too-small figures shown, not filled in; old ones cleared');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
