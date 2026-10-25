const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=require('./editor_guard')(await browser.newPage({viewport:{width,height:900}})),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 await p.evaluate(()=>{window.rotations=[];CarPics.ensure=()=>Promise.resolve();CarPics.angles=()=>['032','001','014'];CarPics.rotate=async(c,d)=>{rotations.push(d);c.picAngle=d<0?'014':'001';};CarPics.pending=()=>false;});
 await p.click('#btnTrip');await p.click('#gEdit');await p.waitForFunction(()=>!Garage.trimBusy()&&document.querySelector('#gcRotateLeft'));await p.locator('#gcPhotoRow').evaluate(e=>e.scrollIntoView({block:'center'}));
 const boxes=await p.evaluate(()=>['gcRotateLeft','gcPic','gcRotateRight'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
 assert(boxes.every(b=>b.x>=0&&b.x+b.w<=width&&b.w>=30),JSON.stringify(boxes));assert(boxes[0].x+boxes[0].w<=boxes[1].x&&boxes[1].x+boxes[1].w<=boxes[2].x);assert(Math.abs(boxes[0].y+boxes[0].h/2-boxes[2].y-boxes[2].h/2)<1);
 await p.click('#gcRotateLeft');await p.click('#gcRotateRight');assert.deepEqual(await p.evaluate(()=>rotations),[-1,1]);
 await p.evaluate(()=>{CarPics.angles=()=>['032'];dispatchEvent(new CustomEvent('carpic',{detail:Garage.car().id}));});
 // Redraw uses the same availability check as asynchronous Fuel API image events.
 await p.evaluate(()=>Garage.redraw());assert.equal(await p.locator('#gcRotateLeft').isVisible(),false);assert.equal(await p.locator('#gcRotateRight').isVisible(),false);
 assert.deepEqual(errors,[]);await p.close();
 }console.log('Vehicle image rotation controls, action wiring, single-view hiding and phone layout passed at 320/448px');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
