const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await browser.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{const c=Garage.car();c.tires={size:'195/65R15',sizeSrc:'user',type:'Touring All-Season',tread:{mode:'miles',miles:38000,rotated:'no',dot:'2324'},corners:{split:false},spare:{kind:'compact',location:'inside'},list:{size:'195/65R15',catalogVersion:5,t:Date.now(),items:[]}};});
 await p.click('#btnTrip');await p.click('#gTires summary');
 assert.equal(await p.locator('#gTires #tzSpareDot').count(),0,'no spare date input in the overview');
 assert.equal(await p.locator('#gTires [data-tag="spare"] text').textContent(),'5');
 await p.click('#tzDet');assert.equal(await p.locator('#tzSpareHeading').textContent(),'Spare tire');
 for(const id of ['tzDot','tzSpareDot']){
   const bounds=await p.locator('#'+id).evaluate(e=>{const l=e.closest('label'),r=l.getBoundingClientRect(),i=e.getBoundingClientRect(),s=l.querySelector('span').getBoundingClientRect();return {w:r.width,h:r.height,ih:i.height,top:i.top,labelBottom:s.bottom,overflow:l.scrollWidth>l.clientWidth};});
   assert(bounds.w>200&&bounds.h>60&&bounds.ih>=40,JSON.stringify(bounds));assert(bounds.top>=bounds.labelBottom-1);assert(!bounds.overflow);
 }
 await p.fill('#tzSpareDot','1522');await p.dispatchEvent('#tzSpareDot','change');assert.equal(await p.evaluate(()=>Tires.editing(Garage.car()).spare.dot),'1522');
 assert.match(await p.locator('#tzSpareDot').locator('..').textContent(),/Week 15 of 2022/);
 // Every date field and the following catalog input remain separate with enlarged text.
 await p.evaluate(()=>{document.querySelectorAll('.sub-body *').forEach(e=>{const n=parseFloat(getComputedStyle(e).fontSize);if(n)e.style.fontSize=n*1.3+'px';});});
 const gap=await p.evaluate(()=>document.querySelector('.tz-pick').getBoundingClientRect().top-document.querySelector('#tzDot').closest('label').getBoundingClientRect().bottom);assert(gap>=-1,'date field must not overlap Brand');
 await p.locator('#tzDot').scrollIntoViewIfNeeded();if(process.env.UI_SHOTS)await p.screenshot({path:path.join(process.env.UI_SHOTS,'tire-dates-'+width+'.png')});
 await p.click('#tzDone');assert.equal(await p.evaluate(()=>Garage.car().tires.spare.dot),'1522');
 await p.evaluate(()=>{const t=Garage.car().tires;t.corners.dually=true;t.towMode=true;t.trailers=[{id:'tag-test',hooked:true,axles:2,per:4,size:'235/80R17'}];Garage.redraw();});
 assert.equal(await p.locator('#gTires [data-tag="spare"] text').textContent(),'15','spare follows every road tire, including trailer tires');
 const tags=await p.locator('#gTires .tz-tag text').evaluateAll(es=>es.map(e=>{const svg=e.ownerSVGElement,v=svg.viewBox.baseVal,r=e.getBBox(),scale=svg.getScreenCTM().a;return {text:e.textContent,px:parseFloat(getComputedStyle(e).fontSize)*scale,inside:r.x>=v.x&&r.x+r.width<=v.x+v.width};}));
 assert.equal(tags.length,5,'four trailer side/axle tags plus spare');assert(tags.every(t=>t.px>=12&&t.inside),JSON.stringify(tags));
 await p.locator('#gTires .tz-pic').scrollIntoViewIfNeeded();if(process.env.UI_SHOTS)await p.screenshot({path:path.join(process.env.UI_SHOTS,'tire-tags-'+width+'.png')});
 await p.click('#tzDet');await p.click('[data-same="0"]');await p.click('[data-tire="lf"]');
 assert(await p.locator('#tpDot').evaluate(e=>e.closest('label').getBoundingClientRect().width>200),'individual tire date gets the same full-width layout');
 assert.deepEqual(errors,[]);await p.close();
}console.log('Full-width tire dates, spare date location/save, and readable sequential trailer/spare tags passed at 320/448px');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
