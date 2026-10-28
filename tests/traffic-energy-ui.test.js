const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const page=await browser.newPage({viewport:{width,height:920}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https?:\/\//,r=>r.abort());await page.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(page);
 await page.evaluate(()=>{if(window.__trip)__trip.close();window.__energyChanges=0;addEventListener('trafficsettingschange',()=>__energyChanges++);});
 await require('./settings-ui')(page,'trip');assert(await page.locator('#trafficEnergy').isChecked(),'traffic energy defaults on');await page.uncheck('#trafficEnergy');await page.click('#sDone');assert.equal(await page.evaluate(()=>__app.S.trafficEnergy),false);await require('./settings-ui')(page,'trip');
 assert(await page.locator('[data-settings-view="trip"] #trafficEnergy').count());
 await page.check('#trafficEnergy');await page.click('#sDone');assert.equal(await page.evaluate(()=>__app.S.trafficEnergy),true);assert.equal(await page.evaluate(()=>__energyChanges),2);
 await require('./settings-ui')(page,'trip');assert(await page.locator('#trafficEnergy').isChecked());
 await page.evaluate(()=>document.documentElement.style.fontSize='130%');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
 await page.screenshot({path:path.resolve('tmp/traffic-energy-'+width+'.png')});
 await page.uncheck('#trafficEnergy');await page.click('#sDone');assert.equal(await page.evaluate(()=>__app.S.trafficEnergy),false);assert.equal(await page.evaluate(()=>__energyChanges),3);
 // The desktop Native stand-in is in memory; seed its documented restore hook to model Android settings persistence.
 await page.evaluate(()=>sessionStorage.setItem('standinRestored',JSON.stringify({s:JSON.stringify(__app.S)})));
 await page.reload();await page.evaluate(()=>{if(window.__trip)__trip.close();});await require('./settings-ui')(page,'trip');assert(!await page.locator('#trafficEnergy').isChecked(),'choice persists across restart');
 assert.deepEqual(errors,[]);await page.close();
}console.log('Experimental energy: Trip settings, on by default, persistence, invalidation, narrow/large-text layout.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
