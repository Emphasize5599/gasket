const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){for(const mode of width===320?['ambiguous','unique','vin-error','epa-error','missing-engine']:['ambiguous','unique']){
 const p=await browser.newPage({viewport:{width,height:900}}),errors=[],reduced=width===448&&mode==='ambiguous';if(reduced)await p.emulateMedia({reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.stack));await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await p.click('#sDone');await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(mode=>{
  window.__mode=mode;window.__blinks={};document.addEventListener('animationstart',e=>{if(e.animationName==='needPulse'&&e.target.classList.contains('vin-lookup-pulse'))__blinks[e.target.id]=(__blinks[e.target.id]||0)+1;});
  const menu=xs=>({menuItem:xs.map(x=>({text:x,value:x}))});__mocks.epa=url=>{
   if(url.includes('menu/year'))return menu(['2005']);if(url.includes('menu/make'))return menu(['Ford']);if(url.includes('menu/model'))return menu(['Mustang']);
   if(url.includes('menu/options')){if(mode==='epa-error')return {__error:'test connection failure'};return {menuItem:[{text:'Auto 5-spd, 6 cyl, 4.0 L',value:'test-auto'},...(mode==='unique'?[]:[{text:'Man 5-spd, 6 cyl, 4.0 L',value:'test-manual'}])]};}
   if(url.endsWith('/test-auto'))return {id:'test-auto',year:2005,make:'Ford',model:'Mustang',displ:4,cylinders:6,trany:'Automatic 5-spd',drive:'Rear-Wheel Drive',fuelType1:'Regular Gasoline',city08:17,highway08:23,comb08:19,VClass:'Subcompact Cars'};
   return {menuItem:[]};
  };
  const original=__app.N.fetchJson;__app.N.fetchJson=(id,url)=>{if(url.includes('DecodeVinValuesExtended')){window.__vinRequest=id;return;}if(url.includes('menu/options'))Garage.redraw();original(id,url);};
  __app.S.debug=true;__app.S.logLevel=4;__app.save();
 },mode);
 await p.click('#btnTrip');await p.click('[data-car="+"]');await p.fill('#gVin','1FAFP00005F000001');await p.click('#gVinGo');
 await p.waitForFunction(()=>!!window.__vinRequest);assert.match(await p.innerText('#vinLookupLoading'),/Decoding VIN/);assert.equal(await p.getAttribute('#tEpa','aria-busy'),'true');assert.equal(await p.isDisabled('#gVinGo'),true);
 await p.evaluate(()=>onNativeResult(__vinRequest,__mode==='vin-error'?{error:'test connection failure'}:{body:JSON.stringify({Results:[{ModelYear:'2005',Make:'FORD',Model:'Mustang',Trim:'Test',FuelTypePrimary:'Gasoline',DisplacementL:__mode==='missing-engine'?'':'4.0',EngineCylinders:__mode==='missing-engine'?'':'6',EngineConfiguration:'V-Shaped',ErrorCode:'0',TransmissionStyle:'',TransmissionSpeeds:''}]})}));
 await p.waitForFunction(()=>!document.querySelector('#gVinGo').disabled);assert.equal(await p.innerText('#vinLookupLoading'),'');assert.equal(await p.getAttribute('#tEpa','aria-busy'),'false');assert.doesNotMatch(await p.innerText('.car-edit'),/Decoded:|All vehicles listed by the EPA|match your VIN/);
 if(mode==='vin-error'){assert.equal(await p.getAttribute('#gVin','aria-invalid'),'true');assert.equal(await p.getAttribute('#eOpt','aria-invalid'),null);}
 else if(mode==='unique'){assert.equal(await p.evaluate(()=>Garage.car().epaId),'test-auto');assert.equal(await p.getAttribute('#eOpt','aria-invalid'),null);assert.equal(await p.evaluate(()=>Garage.car().info.trans),'auto');}
 else{
  assert.equal(await p.getAttribute('#eOpt','aria-invalid'),'true');const css=await p.locator('#eOpt').evaluate(e=>{const s=getComputedStyle(e);return {outline:s.outlineStyle,color:s.outlineColor,width:s.outlineWidth,iterations:s.animationIterationCount};});assert.equal(css.outline,'solid');assert.equal(css.color,'rgb(217, 48, 37)');assert.equal(css.width,'2px');assert.equal(css.iterations,'1');
  assert.equal(await p.getAttribute('#eYear','aria-invalid'),null);assert.equal(await p.getAttribute('#eMake','aria-invalid'),null);assert.equal(await p.getAttribute('#eModel','aria-invalid'),null);
  if(mode!=='epa-error'){
   if(reduced)assert.equal(await p.locator('#eOpt').evaluate(e=>getComputedStyle(e).animationName),'none');else{await p.waitForFunction(()=>__blinks.eOpt===1,{},{timeout:5000});assert.equal(await p.evaluate(()=>__blinks.eOpt),1);}
   await p.evaluate(()=>Garage.redraw());await p.waitForFunction(()=>document.querySelector('#eOpt')&&!document.querySelector('#eOpt').disabled);assert.equal(await p.getAttribute('#eOpt','aria-invalid'),'true');assert.equal(await p.evaluate(()=>__blinks.eOpt),reduced?undefined:1,'background redraw does not replay the blink');
   // Preserve outlines on missing detail boxes too, without calling a known engine a failure.
   await p.evaluate(()=>{const d=document.querySelector('#gInfo');if(d)d.open=true;});
   if(await p.locator('#gEngine').count())assert.equal(await p.getAttribute('#gEngine','aria-invalid'),mode==='missing-engine'?'true':null);
   if(await p.locator('#gTrans').count())assert.equal(await p.getAttribute('#gTrans','aria-invalid'),'true');
   if(process.env.UI_SHOT&&width===320&&mode==='ambiguous')await p.screenshot({path:process.env.UI_SHOT});
   await p.click('#eOpt');await p.click('.app-picker [data-option="test-auto"]');await p.waitForFunction(()=>Garage.car().epaId==='test-auto');assert.equal(await p.getAttribute('#eOpt','aria-invalid'),null);
   assert.equal(await p.evaluate(()=>Garage.car().info.engine),'4.0L '+(mode==='missing-engine'?'6 Cyl':'V6'));assert.equal(await p.evaluate(()=>Garage.car().info.trans),'auto');
   assert.match(await p.evaluate(()=>FLog.text()),/EPA powertrain matching/);assert.doesNotMatch(await p.evaluate(()=>FLog.text()),/1FAFP00005F000001/);
  }
 }
 await p.evaluate(()=>{const root=document.querySelector('.car-edit');if(root){root.querySelectorAll('*').forEach(e=>{const s=parseFloat(getComputedStyle(e).fontSize);if(s)e.style.fontSize=s*1.3+'px';});}});assert.equal(await p.locator('.car-edit').evaluate(e=>e.scrollWidth>e.clientWidth),false,'no enlarged-text horizontal overflow');
 assert.equal(errors.length,0,errors.join('\n'));await p.close();
}}console.log('320/448px VIN loading, one-shot red feedback, source omissions, failed requests, manual/unique matches and private logging passed');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
