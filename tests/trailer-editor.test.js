// Real touch input (CDP), not only mouse/synthetic pointer events: scrolling must not steal an axle drag.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const frame=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});
  try {for(const width of [320,448]) {
    const p=await browser.newPage({viewport:{width,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2}),errors=[];
    p.on('pageerror',e=>errors.push(e.message));
    await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
    await p.evaluate(()=>__app.S.setupDone=true);await p.click('#sDone');
    await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));await p.click('#btnTrip');await p.click('#gEdit');
    await p.evaluate(()=>{
      setInsets(24,48,0,0);document.querySelector(':root').dataset.theme='dark';
      const c=Garage.car();c.tires={size:'195/65R15',sizeSrc:'user',list:{size:'195/65R15',items:[{brand:'Example',model:'Touring',type:'Touring',warrantyMi:40000}]},towMode:true,corners:{},spare:{kind:'none'},
        trailers:[{id:'trExample',name:'Trailer',hooked:true,axles:3,per:4,split:true,axlePositions:[.4,.6,.8],warrantyMi:40000}]};
      Garage.redraw();
    });
    await p.click('#gTires summary');await p.click('[data-sub="tr:trExample"]');
    // Inflate every descendant, including fixed-pixel labels, like Android's enlarged-text UI tests.
    await p.evaluate(()=>document.querySelectorAll('.sub-page *').forEach(e=>{const n=parseFloat(getComputedStyle(e).fontSize);if(n)e.style.fontSize=n*1.3+'px';}));
    const first=p.locator('[data-tr-axle="0"]');await first.evaluate(e=>e.scrollIntoView({block:'center'}));await frame(p);
    assert.equal(await first.evaluate(e=>e.tagName),'BUTTON');assert.ok((await first.boundingBox()).height>=44);
    assert.equal(await first.evaluate(e=>getComputedStyle(e).touchAction),'none');
    assert.equal(await p.locator('.tz-drag-arrows').count(),3);
    const keys=await p.locator('[data-tr-tire]').evaluateAll(es=>es.map(e=>e.dataset.trTire));
    const cdp=await p.context().newCDPSession(p);
    const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:1,radiusX:5,radiusY:5,force:1}]});
    const box=await first.boundingBox(),x=box.x+box.width*.3,y=box.y+8;
    const top=await p.locator('.sub-body').evaluate(e=>e.scrollTop);
    const before=await first.boundingBox();await touch('touchStart',x,y);await frame(p);
    assert.ok(Math.abs((await first.boundingBox()).y-before.y)<1,'grabbing off center does not jump');
    for(const dy of [-6,-12,-18,-24]) {
      await touch('touchMove',x,y+dy);await frame(p);
      assert.ok(Math.abs((await first.boundingBox()).y-(before.y+dy))<1.5,'axle follows finger smoothly, without rounding/lag');
      assert.equal(await p.evaluate(()=>Garage.car().tires.trailers[0].axlePositions[0]),.4,'no saved-state write mid-drag');
      assert.equal(await p.locator('.sub-body').evaluate(e=>e.scrollTop),top,'drag does not scroll the submenu');
    }
    await touch('touchEnd');await frame(p);
    assert.ok(Math.abs((await p.evaluate(()=>Garage.car().tires.trailers[0].axlePositions[0]))-.32)<.001);
    // Clamp to the neighbour, keep identities. A second touch cancelling must restore the preview without committing it.
    let b=await first.boundingBox();await touch('touchStart',b.x+100,b.y+22);await touch('touchMove',b.x+100,b.y+222);await frame(p);await touch('touchEnd');
    const pos=await p.evaluate(()=>Garage.car().tires.trailers[0].axlePositions.slice());assert.ok(pos[0]<=pos[1]-.149);
    b=await first.boundingBox();await touch('touchStart',b.x+100,b.y+22);await touch('touchMove',b.x+100,b.y-25);await frame(p);await touch('touchCancel');await frame(p);
    assert.deepEqual(await p.evaluate(()=>Garage.car().tires.trailers[0].axlePositions),pos);
    assert.ok(Math.abs((await first.boundingBox()).y-b.y)<1);
    assert.deepEqual(await p.locator('[data-tr-tire]').evaluateAll(es=>es.map(e=>e.dataset.trTire)),keys);
    // Grabbing an axle while an edited Name field blurs must defer redraw, not detach the pointer target.
    await p.fill('input[id$="_Name"]','Test trailer');await first.evaluate(e=>e.scrollIntoView({block:'center'}));
    b=await first.boundingBox();await touch('touchStart',b.x+100,b.y+22);await frame(p);
    assert.equal(await p.locator('[data-dragging]').count(),1);assert.equal(await p.evaluate(()=>Garage.car().tires.trailers[0].name),'Test trailer');
    await touch('touchMove',b.x+100,b.y+2);await frame(p);await touch('touchCancel');await frame(p);
    assert.deepEqual(await p.evaluate(()=>Garage.car().tires.trailers[0].axlePositions),pos);
    await p.fill('input[id$="_Name"]','Trailer');await p.dispatchEvent('input[id$="_Name"]','change');
    // Parent side heading + Outer/Inner children; passenger Outer maps to ro, not ri.
    const sides=p.locator('.tz-tr-side');assert.equal(await sides.count(),6);
    assert.equal(await sides.first().locator('.tz-tr-side-label').innerText(),'Trailer, axle 1, driver side');
    assert.deepEqual((await sides.first().locator('.nf > span').allTextContents()).map(s=>s.replace('*','')),['Outer','Inner']);
    assert.deepEqual((await sides.first().locator('button').allTextContents()).map(s=>s.trim()),['Specify','Specify']);
    assert.deepEqual(await sides.nth(1).locator('button').evaluateAll(es=>es.map(e=>e.dataset.trTire)),['trExample:a1ro','trExample:a1ri']);
    await sides.nth(1).locator('button').first().click();await p.waitForSelector('#tpMiles');assert.match(await p.innerText('.sub-bar h2'),/passenger side outer/);
    await p.click('.sub-back');await p.waitForSelector('#ttSame');assert.deepEqual(await p.evaluate(()=>Garage.car().tires.trailers[0].axlePositions),pos);
    // One consistent content gutter, no sideways overflow, and the last actions/hint clear a simulated 48px nav bar.
    const gutters=await p.evaluate(()=>Array.from(document.querySelectorAll('.trailer-form > *')).filter(e=>e.getBoundingClientRect().width>0).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})));
    assert.ok(gutters.every(r=>Math.abs(r.left-16)<1&&Math.abs(r.right-(width-16))<1),JSON.stringify(gutters));
    await p.locator('.sub-body').evaluate(e=>e.scrollTop=e.scrollHeight);await frame(p);
    const last=await p.locator('#ttDiscard').boundingBox();assert.ok(last.y+last.height<=900-48-44,'all footer buttons clear nav and scroll hint');
    const hint=await p.locator('.sub-body').evaluate(e=>{const r=e._hint.getBoundingClientRect();return {top:r.top,bottom:r.bottom,visible:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===e._hint||e._hint.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};});assert.ok(hint.bottom<=900-48);assert.ok(last.y+last.height<=hint.top);assert.ok(hint.visible,'scroll hint is above the submenu layer');
    assert.equal(await p.locator('.sub-body').evaluate(e=>e.scrollWidth>e.clientWidth),false);
    if(process.env.TRAILER_SHOT&&width===320)await p.screenshot({path:process.env.TRAILER_SHOT});
    await p.locator('.sub-body').evaluate(e=>e.scrollTop=0);await frame(p);
    if(process.env.TRAILER_TOP_SHOT&&width===320)await p.screenshot({path:process.env.TRAILER_TOP_SHOT});
    // Background swipes still scroll: only the axle handles lock touch action.
    await touch('touchStart',width-24,700);await touch('touchMove',width-24,500);await touch('touchEnd');
    await p.waitForFunction(()=>document.querySelector('.sub-body').scrollTop>30);
    assert.equal(errors.length,0,errors.join('\n'));await cdp.detach();await p.close();
  }} finally {await browser.close();}
  console.log('Trailer touch dragging, smooth tracking, cancel/clamp, dual labels, gutters and three-button nav clearance passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
