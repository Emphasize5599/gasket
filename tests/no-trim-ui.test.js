// 0.0.356 (owner): some cars really have no trim. A checkbox above the trim menu says so: the trim stops being required,
// the tank lookup asks Brave without one, and unchecking brings the menu (and the requirement) back.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.stack));await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{
  window.__asked=[];
  __mocks.siteRead=(k,a)=>{if(k!=='brave')return {error:'none'};if(a.kind==='trims')return {text:'Trims: Base, Sport. The Sport adds bigger wheels.',src:'ai'};const q=decodeURIComponent(a.url);__asked.push(q);return /\b(Base|Sport)\b/.test(q)?{error:'wrong'}:{gal:13.2,src:'ai'};};
  const menu=xs=>({menuItem:xs.map(x=>({text:x,value:x}))});__mocks.epa=url=>url.includes('menu/year')?menu(['2005']):url.includes('menu/make')?menu(['Ford']):url.includes('menu/model')?menu(['Test Coupe']):url.includes('menu/options')?{menuItem:[{text:'Auto, 6 cyl, 4.0 L',value:'test-auto'}]}:{menuItem:[]};
  const fetch=__app.N.fetchJson;__app.N.fetchJson=(id,url)=>{if(/\/test-auto$/.test(url)){setTimeout(()=>onNativeResult(id,{body:JSON.stringify({id:'test-auto',year:2005,make:'Ford',model:'Test Coupe',city08:20,highway08:30,comb08:24,displ:4,cylinders:6,trany:'Automatic 5-spd',fuelType1:'Regular Gasoline'})}),0);return;}fetch(id,url);};
 });
 await p.click('#btnTrip');await p.click('[data-car="+"]');
 for(const [id,value] of [['eYear','2005'],['eMake','Ford'],['eModel','Test Coupe'],['eOpt','test-auto']]){await p.waitForFunction(([id,value])=>[...document.getElementById(id).options].some(o=>o.value===value),[id,value]);await p.selectOption('#'+id,value);}
 await p.waitForFunction(()=>Garage.car().epaId==='test-auto');await p.waitForSelector('#gTrimSel:not([disabled])');
 const box=await p.evaluate(()=>{const c=document.getElementById('gNoTrim').closest('label'),s=document.getElementById('gTrimSel');return {above:c.getBoundingClientRect().bottom<=s.getBoundingClientRect().top+1,checked:document.getElementById('gNoTrim').checked};});
 assert.deepEqual(box,{above:true,checked:false},'the checkbox sits above the trim menu, unchecked');
 assert.equal(await p.isDisabled('#gSave'),true,'trim still required');assert.equal(await p.isDisabled('#gTank'),true,'no tank before a trim');
 await p.check('#gNoTrim');await p.waitForSelector('#gTrimSel',{state:'detached'});
 await p.waitForFunction(()=>+Garage.car().tank===13.2,null,{timeout:5000});
 assert.equal(await p.evaluate(()=>__asked.at(-1).replace(/^.*q=|&source.*$/g,'')),'2005 Ford Test Coupe fuel tank capacity in gallons?','tank asked without a trim');
 assert.deepEqual(await p.evaluate(()=>[Garage.car().noTrim,Garage.car().trim]),[true,''],'saved as no trim');
 await p.waitForFunction(()=>!document.querySelector('#gSave').disabled);assert.equal(await p.isDisabled('#gTank'),false);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal scroll');
 await p.uncheck('#gNoTrim');await p.waitForSelector('#gTrimSel');
 assert.equal(await p.evaluate(()=>!!Garage.car().noTrim),false);assert.equal(await p.isDisabled('#gSave'),true,'trim required again');
 await p.check('#gNoTrim');await p.waitForFunction(()=>!document.querySelector('#gSave').disabled,null,{timeout:5000});
 await p.click('#gSave');await p.waitForSelector('.car-edit',{state:'detached'});
 await p.click('#gEdit');await p.waitForSelector('#gNoTrim:checked');assert.equal(await p.locator('#gTrimSel').count(),0,'reopened: still no trim');
 assert.deepEqual(errors,[]);await p.close();
}console.log('320/448px no-trim checkbox above the menu, tank asked without a trim, uncheck restores the requirement, saved');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
