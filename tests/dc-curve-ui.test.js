// Installed pack confirmation, research suggestions, and manual curves at narrow widths.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{window.BraveLookup.read=async (q,o)=>{window.packQuery=q;window.packShown=o.shown;return {text:'PACK: Panasonic 2170 | Nickel / Panasonic | 76 | 82 | 2021 | Service records | Tesla | 100,240,225,180,145,100,80,60,45,30,15 | https://example.com/trace PACK: BT37 | NCA | unknown | 77.8 | 2021 | Service records | Tesla | Charge curve cannot be confidently determined | unknown'};};const c=Garage.car();Object.assign(c,{year:2021,make:'Tesla',model:'Model 3 Long Range AWD',entryMode:'custom',power:'ev',type:'car',tank:75,dcKw:200,dcKwSrc:'you entered it',obs:{city:4,hwy:3}});delete c.dcCurve;delete c.dcPack;__app.save();});
 await p.click('#btnTrip');await p.click('#gEdit');
 await p.locator('#gEnergy > summary').click();
 await p.locator('#gDcPack').waitFor({state:'visible'});
 assert.equal(await p.inputValue('#gDcPack'),'');
 assert.equal(await p.evaluate(()=>Garage.ok()),false,'an EV with no pack cannot plan');
 await p.click('#gPackSearch');
 await p.waitForFunction(()=>document.querySelector('#gPackResearch')?.textContent.includes('Panasonic 2170'));
 assert.match(await p.locator('#gPackResearch dl').first().innerText(),/How to verify[\s\S]*Service records/);
 assert.equal(await p.evaluate(()=>packQuery.kind),'packs');
 assert.match(await p.evaluate(()=>new URL(packQuery.url).searchParams.get('q')),/2021 Tesla Model 3 Long Range AWD/);
 assert.match(await p.evaluate(()=>new URL(packQuery.url).searchParams.get('q')),/US packs.*PACK:.*usable kWh.*gross kWh.*measured same-pack.*Charge curve cannot be confidently determined.*GASKET DONE/);
 await p.click('#gPackSee');
 await p.waitForFunction(()=>document.querySelector('#gPackResearch')?.textContent.includes('Panasonic 2170'));
 assert.equal(await p.evaluate(()=>packShown),true,'open the answer in the shared visible Brave flow');
 assert.equal(await p.inputValue('#gDcPack'),'','research does not confirm the pack');
 await p.selectOption('#gDcPack','research:BT37');
 await p.locator('[data-dc-pct="50"]').waitFor({state:'visible'});
 assert.equal(await p.evaluate(()=>Garage.ok()),false,'a pack without a sourced curve needs manual measurements');
 assert.equal(await p.locator('#gPackUseCapacity').count(),0,'gross capacity cannot populate usable capacity');
 await p.selectOption('#gDcPack','research:Panasonic 2170');
 assert.equal(await p.evaluate(()=>ChargeCurve.selected(Garage.car()).peak),240);
 assert.equal(await p.evaluate(()=>Garage.car().tank),75,'selecting a pack does not replace capacity');
 await p.click('#gPackUseCapacity');
 assert.equal(await p.evaluate(()=>Garage.car().tank),76);
 await p.evaluate(()=>{delete Garage.car().packLookup;});
 assert.equal(await p.evaluate(()=>ChargeCurve.selected(Garage.car()).peak),240,'saved profile is independent of later research');
 await p.selectOption('#gDcPack','m3-lr-2021');
 await p.locator('#gDcPack').waitFor({state:'visible'});
 assert.equal(await p.evaluate(()=>Garage.ok()),true);
 assert.equal(await p.evaluate(()=>ChargeCurve.forCar(Garage.car()).peak),250,'chosen curve is not rescaled by the old peak field');
 await p.waitForSelector('.dc-curve-svg .dc-line');

 await p.selectOption('#gDcPack','manual');
 await p.locator('#gDcPackName').waitFor({state:'visible'});
 assert.equal(await p.inputValue('[data-dc-pct="50"]'),'');
 await p.fill('#gDcPackName','Documented replacement pack');
 await p.dispatchEvent('#gDcPackName','change');
 for(const pct of [0,10,20,30,40,50,60,70,80,90,100]){
  const input=p.locator('[data-dc-pct="'+pct+'"]');await input.fill(String(150-pct));await input.dispatchEvent('change');
 }
 assert.equal(await p.evaluate(()=>Garage.ok()),true);
 assert.equal(await p.evaluate(()=>ChargeCurve.forCar(Garage.car()).points[5][1]),100);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth||[...document.querySelectorAll('.car-edit .sub-body')].some(x=>x.scrollWidth>x.clientWidth+1)),false,'no horizontal scroll');
  assert.equal(errors.length,0,errors.join('\n'));await p.close();
}console.log('Required installed pack, lookup suggestions, and manual curve at 320/448 px');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
