// An EV with no fastest-DC-charging figure asks Brave once (after the trim), fills it in marked as Brave's answer with
// That's right / See Brave's answer, never over a number you typed, and a trim change asks again.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));await p.evaluate(()=>{__app.S.debug=true;__app.S.logLevel=4;__app.save();});
 await p.evaluate(()=>{window.__mocks=window.__mocks||{};window.__asks=[];__mocks.siteRead=(k,a)=>{if(k!=='brave')return {error:'none'};if(a.kind==='trims')return {text:'Trims: Standard, Long Range',src:'ai'};if(a.kind!=='dckw')return {error:'none'};__asks.push(a.url);return {text:/Long%20Range/.test(a.url)?'The Long Range has a 75 kWh pack and a peak DC fast charging rate of 250 kW.':'The Standard charges at up to 170 kW on DC fast chargers.',src:'ai'};};
  const c=Garage.car();Object.assign(c,{year:2024,make:'Tesla',model:'Model 3',trim:'Long Range',entryMode:'custom',power:'ev',type:'car',tank:75,dcKw:'',dcKwSrc:'',dcKwLookup:null});__app.save();});
 await p.click('#btnTrip');await p.click('#gEdit');await p.waitForSelector('.dc-guess',{timeout:10000});
 assert.equal(await p.inputValue('#gDcKw'),'250');assert.match(await p.innerText('.dc-guess'),/fastest DC charging is 250 kW/);
 assert.match(decodeURIComponent((await p.evaluate(()=>__asks))[0]),/2024 Tesla Model 3 Long Range maximum DC fast charging rate in kW\?/);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal scroll');
 await p.click('#gDcYes');await p.waitForSelector('.dc-guess',{state:'detached'});assert.match(await p.evaluate(()=>Garage.car().dcKwSrc),/you confirmed/);
 // a different trim: the Brave figure is replaced by that trim's
 await p.evaluate(()=>{const s=document.getElementById('gTrimSel');if(s){s.value='Standard';s.dispatchEvent(new Event('change',{bubbles:true}));}else{const t=document.getElementById('gTrim');t.value='Standard';t.dispatchEvent(new Event('change',{bubbles:true}));}});
 await p.waitForFunction(()=>+Garage.car().dcKw===170,null,{timeout:10000});
 // a typed number is never replaced
 await p.fill('#gDcKw','200');await p.dispatchEvent('#gDcKw','change');assert.equal(await p.evaluate(()=>Garage.car().dcKwSrc),'you entered it');
 const asked=await p.evaluate(()=>__asks.length);await p.evaluate(()=>Garage.redraw());await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>__asks.length),asked,'no lookup over a typed number');assert.equal(await p.inputValue('#gDcKw'),'200');
 // no kW in the answer: nothing filled in, a way to verify on Brave's page
 await p.click('#gSave');await p.evaluate(()=>{__mocks.siteRead=(k,a)=>k==='brave'&&a.kind==='dckw'?{text:'It is a great car with a big battery.',src:'ai'}:k==='brave'&&a.kind==='trims'?{text:'Trims: Standard, Long Range',src:'ai'}:{error:'none'};Object.assign(Garage.car(),{dcKw:'',dcKwSrc:'',dcKwLookup:null});__app.save();});
 await p.click('#gEdit');await p.waitForSelector('.dc-fail',{timeout:10000});assert.equal(await p.inputValue('#gDcKw'),'');assert.equal(await p.locator('#gDcShow').count(),1);
 assert(await p.evaluate(()=>FLog.entries().some(e=>/DC charging rate lookup got no answer/.test(e.m))),'logged');
 assert.equal(errors.length,0,errors.join('\n'));await p.close();
}console.log('DC charging from Brave: filled after the trim with That\'s right / See answer, asked again for another trim, never over a typed number, no figure = not filled in');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
