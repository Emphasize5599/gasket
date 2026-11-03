// 0.0.360 (owner's 358 log, a 2005 MINI): Fuel API answered HTML, so the car's picture record had no colors, and every
// Garage redraw threw in CarPics.selectedView before the editor's buttons were bound: no-trim didn't start the tank
// lookup, Remove and Discard did nothing (a discarded new car stayed). Phone taps with that failed picture record.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const ctx=await b.newContext({viewport:{width,height:900},hasTouch:true,isMobile:true}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.stack));
 await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{window.__asked=[];__app.S.fuelKey='test-key';
  __mocks.fuel=()=>({error:"Unexpected token '<', \"<html>\" is not valid JSON"});__mocks.nhtsaPic=()=>({results:[]});__mocks.nhtsaModels=()=>({results:[{model:'COOPER'}]});
  __mocks.commons=()=>({query:{pages:{1:{title:'File:MINI Cooper S Convertible 2005.jpg',imageinfo:[{url:'https://upload.wikimedia.org/a.jpg',thumburl:'https://upload.wikimedia.org/a.jpg',extmetadata:{Artist:{value:'Test'},LicenseShortName:{value:'CC BY-SA 4.0'}}}]}}}});
  __mocks.image=()=>({body:'data:image/webp;base64,UklGRg=='});
  __mocks.siteRead=(k,a)=>{if(k!=='brave')return {error:'none'};if(a.kind==='trims'||a.kind==='spare')return {error:'none'};__asked.push(decodeURIComponent(a.url));return {gal:13.2,src:'ai'};};
  const menu=xs=>({menuItem:xs.map(x=>({text:x,value:x}))});__mocks.epa=url=>url.includes('menu/year')?menu(['2005']):url.includes('menu/make')?menu(['MINI']):url.includes('menu/model')?menu(['Cooper S Convertible']):url.includes('menu/options')?{menuItem:[{text:'Man 6-spd, 4 cyl',value:'20531'}]}:{menuItem:[]};
  const fetch=__app.N.fetchJson;__app.N.fetchJson=(id,url)=>{if(/\/20531$/.test(url)){setTimeout(()=>onNativeResult(id,{body:JSON.stringify({id:'20531',year:2005,make:'MINI',model:'Cooper S Convertible',city08:22,highway08:29,comb08:24,displ:1.6,cylinders:4,trany:'Manual 6-spd',fuelType1:'Premium Gasoline',VClass:'Minicompact Cars'})}),0);return;}fetch(id,url);};});
 await p.tap('#btnTrip');const before=await p.evaluate(()=>__app.S.cars.map(c=>c.id));await p.tap('[data-car="+"]');
 for(const [id,value] of [['eYear','2005'],['eMake','MINI'],['eModel','Cooper S Convertible'],['eOpt','20531']]){await p.waitForFunction(([id,value])=>[...document.getElementById(id).options].some(o=>o.value===value),[id,value]);await p.selectOption('#'+id,value);}
 await p.waitForFunction(()=>Garage.car().epaId==='20531');await p.waitForFunction(()=>Garage.car().pic&&Garage.car().pic.fuel,null,{timeout:5000});await p.waitForTimeout(600);
 // tick no-trim with a finger: the tank question is asked without a trim
 await p.locator('#gNoTrim').scrollIntoViewIfNeeded();await p.tap('#gNoTrim');
 await p.waitForFunction(()=>+Garage.car().tank===13.2,null,{timeout:5000});
 assert.equal(await p.evaluate(()=>__asked.at(-1).replace(/^.*q=|&source.*$/g,'')),'2005 MINI Cooper S Convertible fuel tank capacity in gallons?');
 // Discard the new car: it is gone, the garage is as before
 await p.locator('#gDiscard').scrollIntoViewIfNeeded();await p.tap('#gDiscard');await p.waitForSelector('#cfm.on #cfmYes');await p.tap('#cfm.on #cfmYes');
 await p.waitForSelector('.car-edit',{state:'detached'});assert.deepEqual(await p.evaluate(()=>__app.S.cars.map(c=>c.id)),before,'discarded new car removed');
 // a saved car with the same failed picture record: Remove works
 await p.evaluate(()=>{const c=__app.S.cars.find(x=>x.id==='corolla20');c.pic=Object.assign({},c.pic,{fuel:{failed:true,t:Date.now()}});__app.S.carId=c.id;Garage.redraw();});
 await p.tap('#gEdit');await p.waitForSelector('.car-edit #gRemove',{state:'visible'});await p.locator('#gRemove').scrollIntoViewIfNeeded();await p.tap('#gRemove');
 await p.waitForSelector('#cfm.on #cfmYes');await p.tap('#cfm.on #cfmYes');await p.waitForFunction(()=>!__app.S.cars.some(c=>c.id==='corolla20'));
 assert.deepEqual(errors,[]);await ctx.close();
}console.log('320/448px touch: failed Fuel API picture no longer breaks the editor: no-trim tank lookup, Discard of a new car, Remove');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
