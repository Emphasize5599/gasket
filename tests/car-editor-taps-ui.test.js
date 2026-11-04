// 0.0.357 (owner, on 356): in the car editor, ticking "This car has no trim" didn't hide the trim box or start the tank
// lookup, Remove didn't work and the car couldn't be changed. Causes reproduced here: a redraw while a finger is down
// replaced the control under it (a typed trim's blur, or a background lookup's answer), and the identity tile's late
// toggle event let a redraw fold it again right after you opened it.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const seen=async(p,sel)=>{for(let i=0;;i++){try{await p.locator(sel).scrollIntoViewIfNeeded({timeout:1000});const bb=await p.locator(sel).boundingBox();if(bb)return bb;}catch(e){if(i>=20)throw e;}await p.waitForTimeout(100);}}; // the editor may redraw (background lookups) while we scroll
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const open=async()=>{const p=await b.newPage({viewport:{width,height:900}});p.errors=[];p.on('pageerror',e=>p.errors.push(e.stack));await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
  await p.evaluate(()=>{window.__asked=[];__mocks.siteRead=(k,a)=>{if(k!=='brave')return {error:'none'};if(a.kind==='trims')return {error:'none'};const q=decodeURIComponent(a.url);__asked.push(q);return /\bLE\b|XSE/.test(q)?{error:'no answer'}:{gal:11.8,src:'ai'};};});
  await p.click('#btnTrip');await p.click('#gEdit');await p.waitForSelector('.car-edit #tEpa');await p.waitForSelector('.car-edit #gSave');return p;};
 // the identity tile of a saved car is folded; open it, and a background redraw right after must not fold it again
 let p=await open();
 assert.equal(await p.isChecked('#gCommercialTruck'),false,'commercial use is explicit and off by default');await p.check('#gCommercialTruck');await p.evaluate(()=>Garage.redraw());assert.equal(await p.isChecked('#gCommercialTruck'),true);assert.equal(await p.evaluate(()=>Garage.car().commercialTruck),true);await p.uncheck('#gCommercialTruck');assert.equal(await p.evaluate(()=>Garage.car().commercialTruck===true),false);
 assert.equal(await p.evaluate(()=>document.getElementById('tEpa').open),false,'saved car: identity folded');
 await p.evaluate(()=>{document.querySelector('#tEpa > summary').click();Garage.redraw();});
 assert.equal(await p.evaluate(()=>document.getElementById('tEpa').open),true,'a redraw right after opening keeps the tile open');
 // a typed trim, then tap the checkbox: the box's blur redraws the editor, and the tap must still tick it
 await p.waitForSelector('#gTrim',{state:'visible'});await p.fill('#gTrim','XSE');await p.click('#gNoTrim');
 await p.waitForSelector('#gNoTrim:checked');assert.equal(await p.locator('#gTrim').count(),0,'trim box gone');assert.equal(await p.locator('#gTrimSel').count(),0);
 await p.waitForFunction(()=>+Garage.car().tank===11.8,null,{timeout:5000});
 assert.equal(await p.evaluate(()=>__asked.at(-1).replace(/^.*q=|&source.*$/g,'')),'2020 Toyota Corolla Hybrid fuel tank capacity in gallons?','tank asked without a trim');
 assert.deepEqual(await p.evaluate(()=>[Garage.car().noTrim,Garage.car().trim]),[true,'']);
 assert.equal(await p.evaluate(()=>document.getElementById('tEpa').open),true,'still open after ticking');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal scroll');
 assert.deepEqual(p.errors,[]);await p.close();
 // a background answer redraws the editor while your finger is on Remove: the tap still opens the confirmation
 p=await open();await p.waitForSelector('.car-edit #gRemove',{state:'visible'});
 let bb;for(let i=0;i<40;i++){const a=await seen(p,'#gRemove');await p.waitForTimeout(250);const b2=await seen(p,'#gRemove');if(JSON.stringify(a)===JSON.stringify(b2)&&await p.evaluate(([x,y])=>!!document.elementFromPoint(x,y)?.closest('#gRemove,.scroll-hint'),[b2.x+b2.width/2,b2.y+b2.height/2])){bb=b2;break;}}assert.ok(bb,'Remove settles in place');
 await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2);await p.mouse.down();
 await p.evaluate(()=>Garage.redraw());await p.mouse.up();
 await p.waitForSelector('#cfm.on #cfmYes',{timeout:3000});await p.click('#cfm.on #cfmYes');
 await p.waitForFunction(()=>!__app.S.cars.some(c=>c.id==='corolla20'));
 assert.deepEqual(p.errors,[]);await p.close();
 // Remove just scrolled into view sits under the floating ↓ arrow: a tap on the arrow there is a tap on Remove
 p=await open();await seen(p,'#gRemove');
 // Use this scroller's own arrow, reacquiring controls after asynchronous redraws.
 // Scroll geometry and the owned hint must agree on two consecutive animation frames.
 // A background redraw can relayout the editor between measuring and tapping (then the arrow is over other content and
 // correctly scrolls): measure again and retry; the tap that lands while the arrow covers Remove must open the confirmation.
 let opened=false;for(let attempt=0;attempt<4&&!opened;attempt++){const overlap=await p.waitForFunction(()=>{const sc=document.querySelector('.car-edit .sub-body'),r=document.getElementById('gRemove'),h=sc&&sc._hint;if(!sc||!r||!h||h.classList.contains('hidden'))return false;const b=h.getBoundingClientRect(),a=r.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,covered=document.elementFromPoint(x,y)?.closest('.scroll-hint')===h&&document.elementsFromPoint(x,y).some(e=>e.id==='gRemove');if(!covered){window.__removeOverlap=null;sc.scrollTop+=(a.top+a.height/2)-y;return false;}const prior=window.__removeOverlap;window.__removeOverlap={el:r,x,y};if(!prior||prior.el!==r||Math.abs(prior.x-x)>.25||Math.abs(prior.y-y)>.25)return false;delete window.__removeOverlap;return {x,y,covered:true};},null,{polling:'raf',timeout:10000});const hit=await overlap.jsonValue();
 assert.ok(hit&&hit.covered,'the arrow covers Remove in this position');
 await p.mouse.click(hit.x,hit.y);opened=await p.waitForSelector('#cfm.on #cfmYes',{timeout:1500}).then(()=>true,()=>false);}
 assert.ok(opened,'a tap on the arrow over Remove opens the confirmation');await p.click('#cfm.on #cfmYes');
 await p.waitForFunction(()=>!__app.S.cars.some(c=>c.id==='corolla20'));assert.deepEqual(p.errors,[]);await p.close();
}console.log('320/448px redraw mid-tap keeps no-trim / Remove taps, a tap on the ↓ arrow over Remove removes, identity tile stays open, tank asked without a trim');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
