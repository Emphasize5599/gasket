// The car editor's DC charging curve: the automatic curve (Open EV Data for a matched car, else generic) with its
// source and graph, typed kW saved as your curve, Use the automatic curve, no horizontal scroll at 320 / 448 px.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{window.__mocks=window.__mocks||{};__mocks.siteRead=()=>({error:'none'});const c=Garage.car();Object.assign(c,{year:2024,make:'Tesla',model:'Model Y Long Range AWD',trim:'Long Range',entryMode:'custom',power:'ev',type:'car',tank:75,dcKw:250,dcKwSrc:'you entered it'});delete c.dcCurve;__app.save();});
 await p.click('#btnTrip');await p.click('#gEdit');
 await p.evaluate(()=>{document.getElementById('gEnergy').open=true;});
 await p.waitForSelector('#gDcCurve');
 assert.match(await p.innerText('#gDcCurve .dc-curve-h'),/Open EV Data: Tesla Model Y Long Range Dual Motor/);
 assert.equal(await p.locator('#gDcCurve [data-dc-pct]').count(),11);assert.equal(await p.inputValue('[data-dc-pct="50"]'),'250');assert.equal(await p.inputValue('[data-dc-pct="80"]'),'100');
 assert.equal(await p.locator('.dc-curve-svg .dc-line').count(),1);assert.equal(await p.locator('#gDcCurveReset').count(),0);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth||[...document.querySelectorAll('.car-edit .sub-body')].some(x=>x.scrollWidth>x.clientWidth+1)),false,'no horizontal scroll');
 // your Model Y figures: 150 kW at 50%, 75 at 70%
 await p.fill('[data-dc-pct="50"]','150');await p.dispatchEvent('[data-dc-pct="50"]','change');
 await p.waitForSelector('#gDcCurveReset');await p.fill('[data-dc-pct="70"]','75');await p.dispatchEvent('[data-dc-pct="70"]','change');
 const saved=await p.evaluate(()=>Garage.car().dcCurve);assert.equal(saved.length,11);assert.deepEqual(saved.find(x=>x[0]===50),[50,150]);assert.deepEqual(saved.find(x=>x[0]===70),[70,75]);
 assert.match(await p.innerText('#gDcCurve .dc-curve-h'),/Your charging curve/);assert.equal(await p.evaluate(()=>ChargeCurve.forCar(Garage.car()).src),'user');
 // a box out of range is put back, nothing saved
 await p.fill('[data-dc-pct="90"]','0');await p.dispatchEvent('[data-dc-pct="90"]','change');assert.notEqual(await p.inputValue('[data-dc-pct="90"]'),'0');assert.deepEqual(await p.evaluate(()=>Garage.car().dcCurve.find(x=>x[0]===90)),saved.find(x=>x[0]===90));
 await p.click('#gDcCurveReset');await p.waitForSelector('#gDcCurveReset',{state:'detached'});assert.equal(await p.evaluate(()=>Garage.car().dcCurve),undefined);
 // a car Open EV Data doesn't have: the generic curve, said so
 await p.evaluate(()=>{Object.assign(Garage.car(),{make:'Rivian',model:'R1T',trim:'Adventure',dcKw:220});Garage.redraw();});
 await p.evaluate(()=>{const d=document.getElementById('gEnergy');if(d)d.open=true;});
 await p.waitForFunction(()=>/A typical curve for a 220 kW peak/.test((document.querySelector('#gDcCurve .dc-curve-h')||{}).textContent||''));
 assert.equal(errors.length,0,errors.join('\n'));await p.close();
}console.log('DC charging curve editor: dataset curve with source and graph, typed kW saved, bad value restored, reset, generic for an unmatched car, 320/448 px');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
