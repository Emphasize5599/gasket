// Settings → Trip defaults: "Download campgrounds" (Recreation.gov RIDB) shows progress in Tasks, saves the rows in
// KV restplaces/ridb, says how many are saved, offers Update next time, and Cancel stops it. 320 / 448 px, 130% text.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(15000);await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 if(width===320)await p.addStyleTag({content:'html{font-size:130%}'});
 await p.evaluate(()=>{window.__ridb=[];__app.N.restInventory=(id,action)=>{__ridb.push(action);if(action==='cancel'){onNativeResult(id,{});if(window.__hold){const h=__hold;window.__hold=null;onNativeResult(h,{error:'Campground download cancelled'});}return;}
  if(window.__hang){window.__hold=id;return;}setTimeout(()=>{onNativeProgress(id,17*1048576,34*1048576);setTimeout(()=>onNativeResult(id,{rows:[['c1','Lake View',34.5,-92.25,1,'14 days','$20'],['c2','Pine',35,-93,0,'','']],count:2,bytes:34*1048576}),30);},30);};});
 await require('./settings-ui')(p,'trip');await p.waitForSelector('#ridbDownload');assert.equal((await p.innerText('#ridbDownload')).trim(),'Download campgrounds');
 assert.match(await p.innerText('#ridbSettings'),/data access agreement/);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.click('#ridbDownload');await p.waitForFunction(()=>/2 campgrounds saved/.test(document.querySelector('#ridbStatus').textContent));
 const kv=await p.evaluate(()=>{const r=__app.KV.get('restplaces','ridb');return r&&r.v.rows.length;});assert.equal(kv,2,'rows stored in rest storage');
 assert.equal((await p.innerText('#ridbDownload')).trim(),'Update campgrounds');assert(await p.locator('#ridbCancel').isHidden());assert.equal(await p.locator('#taskHub [data-task="ridb"], .task-row[data-id="ridb"]').count(),0,'task removed');
 // cancel while it runs keeps what was saved
 await p.evaluate(()=>{window.__hang=true;});await p.click('#ridbDownload');await p.waitForSelector('#ridbCancel:not(.hidden)');await p.click('#ridbCancel');
 await p.waitForFunction(()=>/cancelled/i.test(document.querySelector('#ridbStatus').textContent));assert.match(await p.innerText('#ridbStatus'),/2 campgrounds saved/);assert(await p.evaluate(()=>__ridb.includes('cancel')));
 assert.deepEqual(errors,[]);await p.close();
}console.log('RIDB campgrounds setting: download with progress, saved count, Update, Cancel keeps the earlier data (320 / 448, 130% text)');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
