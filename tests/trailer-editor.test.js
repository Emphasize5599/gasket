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
    assert.equal(await p.locator('[data-tr-axle] .tz-drag-arrows').count(),3);
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
    const move=await p.evaluate(()=>{const tr=Garage.car().tires.trailers[0],g=TireMath.trailerGeometry(tr,Garage.car().tires.corners),width=document.querySelector('.tz-tr-diagram').clientWidth,z=g.geometry;return {p:tr.axlePositions[0],travel:g.travel,scale:.8*Math.min((width-52)/(z.leftFt+z.rightFt+g.leftReach+g.rightReach),340/z.lengthFt)};});
    assert.ok(Math.abs(move.p-(.4-24/move.travel/move.scale))<.001);
    // Clamp to the neighbour, keep identities. A second touch cancelling must restore the preview without committing it.
    let b=await first.boundingBox();await touch('touchStart',b.x+100,b.y+22);await touch('touchMove',b.x+100,b.y+222);await frame(p);await touch('touchEnd');
    const pos=await p.evaluate(()=>Garage.car().tires.trailers[0].axlePositions.slice());assert.ok(pos[0]<pos[1]);
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
    const halves=await sides.evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,top:e.getBoundingClientRect().top})));
    for(let i=0;i<halves.length;i+=2){assert.ok(halves[i].right<halves[i+1].x);assert.ok(Math.abs(halves[i].top-halves[i+1].top)<1);}
    const pairs=await sides.evaluateAll(es=>es.map(e=>Array.from(e.querySelectorAll('button')).map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})));
    assert.ok(pairs.every(pair=>Math.abs(pair[0].y-pair[1].y)<1&&pair[0].x+pair[0].width<pair[1].x&&pair.every(r=>r.width>=44&&r.height>=44)));
    await sides.nth(1).locator('button').first().click();await p.waitForSelector('#tpMiles');assert.match(await p.innerText('.sub-bar h2'),/passenger side outer/);
    await p.click('.sub-back');await p.waitForSelector('#ttSame');assert.deepEqual(await p.evaluate(()=>Garage.car().tires.trailers[0].axlePositions),pos);
    // One consistent content gutter, no sideways overflow, and the last actions/hint clear a simulated 48px nav bar.
    await p.evaluate(()=>{const es=Array.from(document.querySelectorAll('.tz-tr-tires,.tz-tr-tires *')),sizes=es.map(e=>parseFloat(getComputedStyle(e).fontSize));es.forEach((e,i)=>e.style.fontSize=sizes[i]*1.3+'px');});
    const enlargedPairs=await p.locator('.tz-tr-side').evaluateAll(es=>es.map(e=>Array.from(e.querySelectorAll('button')).map(b=>({y:b.getBoundingClientRect().y,overflow:b.scrollWidth>b.clientWidth}))));assert.ok(enlargedPairs.every(pair=>Math.abs(pair[0].y-pair[1].y)<1&&!pair.some(b=>b.overflow)),'horizontal buttons fit at enlarged text');
    const gutters=await p.evaluate(()=>Array.from(document.querySelectorAll('.trailer-form > *')).filter(e=>e.getBoundingClientRect().width>0).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})));
    assert.ok(gutters.every(r=>Math.abs(r.left-16)<1&&Math.abs(r.right-(width-16))<1),JSON.stringify(gutters));
    await p.locator('.sub-body').evaluate(e=>e.scrollTop=e.scrollHeight);await frame(p);
    const last=await p.locator('#ttDiscard').boundingBox();assert.ok(last.y+last.height<=900-48-44,'all footer buttons clear nav and scroll hint');
    const hint=await p.locator('.sub-body').evaluate(e=>{const r=e._hint.getBoundingClientRect();return {top:r.top,bottom:r.bottom,visible:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===e._hint||e._hint.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};});assert.ok(hint.bottom<=900-48);assert.ok(last.y+last.height<=hint.top);assert.ok(hint.visible,'scroll hint is above the submenu layer');
    assert.equal(await p.locator('.sub-body').evaluate(e=>e.scrollWidth>e.clientWidth),false);
    await p.evaluate(()=>{const t=Garage.car().tires;TireMath.positions(t).filter(p=>p.trailer==='trExample').forEach(p=>t.corners[p.k]=Object.assign({},t.corners[p.k],{size:'205/75R15'}));});
    await p.locator('[data-tr-tire="trExample:a2li"]').click();await p.waitForSelector('#tpSizeEdit');await p.click('#tpSizeEdit');await p.fill('#tpSize','445/95R26');await p.dispatchEvent('#tpSize','change');
    const individual=await p.evaluate(()=>{const t=Garage.car().tires,g=TireMath.trailerGeometry(t.trailers[0],t.corners);return {diameters:g.axles.map(a=>a.diameter),length:t.trailers[0].geometry.lengthFt,min:g.minLength};});assert.ok(individual.diameters[1]>individual.diameters[0]);assert.ok(individual.length>=individual.min-1e-8);
    await p.click('.sub-back');await p.waitForSelector('#ttSame');
    await p.locator('.sub-body').evaluate(e=>e.scrollTop=e.scrollHeight);await frame(p);
    if(process.env.TRAILER_SHOT&&width===320)await p.screenshot({path:process.env.TRAILER_SHOT});
    await p.locator('.sub-body').evaluate(e=>e.scrollTop=0);await frame(p);
    if(process.env.TRAILER_TOP_SHOT&&width===320)await p.screenshot({path:process.env.TRAILER_TOP_SHOT});
    // Body resize defaults to symmetric; asymmetric mode keeps the other side unchanged.
    assert.equal(await p.isChecked('#ttSymmetrical'),true);assert.equal(await p.inputValue('#ttWidth'),'6');
    const resize=async(kind,dx,dy)=>{const handle=p.locator('[data-tr-resize="'+kind+'"]');await handle.evaluate(e=>e.scrollIntoView({block:'center'}));const r=await handle.boundingBox();await touch('touchStart',r.x+22,r.y+22);await touch('touchMove',r.x+22+dx,r.y+22+dy);await frame(p);await touch('touchEnd');await frame(p);};
    await resize('left',-12,0);let z=await p.evaluate(()=>Garage.car().tires.trailers[0].geometry);assert.ok(z.leftFt>3);assert.equal(z.leftFt,z.rightFt);
    await p.uncheck('#ttSymmetrical');const left=z.leftFt;await resize('right',12,0);z=await p.evaluate(()=>Garage.car().tires.trailers[0].geometry);assert.equal(z.leftFt,left);assert.ok(z.rightFt>left);
    const length=z.lengthFt;assert.equal(await p.isDisabled('#ttLength'),true);assert.equal(await p.isDisabled('[data-tr-resize="length"]'),true);assert.equal(await p.locator('#ttLengthLock').getAttribute('aria-label'),'Unlock trailer length');
    await p.click('#ttLengthLock');assert.equal(await p.isDisabled('#ttLength'),false);await resize('length',0,15);assert.ok(+(await p.inputValue('#ttLength'))>length);assert.equal(await p.evaluate(()=>Garage.car().tires.trailers[0].geometry.lengthFt),length,'unlocked length is not saved on release');
    await p.click('#ttLengthLock');z=await p.evaluate(()=>Garage.car().tires.trailers[0].geometry);assert.ok(z.lengthFt>length);assert.equal(await p.isDisabled('#ttLength'),true);
    const savedLength=z.lengthFt;await p.click('#ttLengthLock');await p.fill('#ttLength',String(savedLength+2));await p.dispatchEvent('#ttLength','change');assert.equal(await p.evaluate(()=>Garage.car().tires.trailers[0].geometry.lengthFt),savedLength);
    await p.click('.sub-back');await p.click('[data-sub="tr:trExample"]');assert.equal(await p.isDisabled('#ttLength'),true);assert.ok(Math.abs(+(await p.inputValue('#ttLength'))-savedLength)<.01,'leaving discards unlocked length preview');
    assert.match(await p.locator('.tz-ruler').textContent(),/ft/);
    await p.click('#ttLengthLock');await p.fill('#ttLength','3');await p.dispatchEvent('#ttLength','change');assert.match(await p.innerText('#ttGeometryNote'),/increased/);await p.click('#ttLengthLock');
    await p.evaluate(()=>{const tr=Garage.car().tires.trailers[0];tr.axlePositions=[0,0,0];});
    await p.click('[data-tr-split="false"]');await p.fill('input[id$="_Size"]','395/95R24');await p.dispatchEvent('input[id$="_Size"]','change');
    const grown=await p.evaluate(()=>{const tr=Garage.car().tires.trailers[0],g=TireMath.trailerGeometry(tr,Garage.car().tires.corners);return {length:tr.geometry.lengthFt,min:g.minLength,gaps:g.gaps,centers:g.centers,positions:tr.axlePositions};});
    assert.ok(grown.length>=grown.min-1e-8&&grown.length>12);for(let i=1;i<3;i++)assert.ok(grown.centers[i]-grown.centers[i-1]>=grown.gaps[i]-1e-8);
    await frame(p);
    const wheel=await p.locator('[data-wheel]').first().evaluate(e=>({width:+e.getAttribute('width'),height:+e.getAttribute('height')})),ratio=wheel.width/wheel.height;
    const drawn=await p.evaluate(()=>({size:Garage.car().tires.trailers[0].size,split:Garage.car().tires.trailers[0].split}));
    assert.ok(Math.abs(ratio-(395/(24*25.4+2*395*.95)))<1e-6,JSON.stringify({wheel,ratio,drawn}));
    await p.click('[data-tr-split="true"]');assert.deepEqual(await p.locator('[data-tr-tire]').evaluateAll(es=>es.map(e=>e.dataset.trTire)),keys);
    assert.equal(await p.locator('.sub-body').evaluate(e=>e.scrollWidth>e.clientWidth),false);
    // Background text swipes still scroll: only the drag handles lock touch action.
    await p.locator('.sub-body').evaluate(e=>e.scrollTop=0);const bg=await p.locator('.trailer-form > p:not(#ttGeometryNote)').first().boundingBox();
    await touch('touchStart',bg.x+20,bg.y+bg.height/2);for(const dy of [-30,-60,-100]){await touch('touchMove',bg.x+20,bg.y+bg.height/2+dy);await frame(p);}await touch('touchEnd');
    await p.waitForFunction(()=>document.querySelector('.sub-body').scrollTop>30,undefined,{timeout:3000});
    const preserved=await p.evaluate(()=>JSON.stringify([Garage.car().tires.trailers[0].geometry,Garage.car().tires.corners]));await p.click('.sub-back');await p.click('[data-tr-unhook="trExample"]');assert.equal(await p.locator('.sub-page').count(),0);assert.equal(await p.evaluate(()=>Garage.car().tires.trailers[0].hooked),false);assert.equal(await p.locator('#tzSaved').count(),1);assert.equal(await p.evaluate(()=>JSON.stringify([Garage.car().tires.trailers[0].geometry,Garage.car().tires.corners])),preserved);
    // First size defaults only this new trailer's blank tires, not the already saved trailer or car.
    await p.click('#tzAddTr');await p.click('[data-per="4"]');await p.click('[data-tr-split="true"]');
    await p.locator('[data-tr-tire]').first().click();await p.waitForSelector('#tpSize');assert.equal(await p.inputValue('#tpSize'),'');assert.match(await p.innerText('#tpLook summary'),/Look this tire up \(recommended\)/);assert.equal(await p.locator('#tpLook .rec-tag').count(),0);
    await p.click('#tpSizeEdit');await p.fill('#tpSize','205/75R15');await p.dispatchEvent('#tpSize','change');
    const defaults=await p.evaluate(()=>{const t=Garage.car().tires,tr=t.trailers[1];return {keys:TireMath.positions(t).filter(p=>p.trailer===tr.id).map(p=>t.corners[p.k]),id:tr.id,others:JSON.stringify({geometry:t.trailers[0].geometry,corners:Object.fromEntries(Object.entries(t.corners).filter(([k])=>k.startsWith('trExample:')))})};});assert.ok(defaults.keys.every(x=>x.size==='205/75R15'));assert.ok(defaults.keys.slice(1).every(x=>Object.keys(x).length===1));assert.equal(defaults.others,JSON.stringify({geometry:JSON.parse(preserved)[0],corners:Object.fromEntries(Object.entries(JSON.parse(preserved)[1]).filter(([k])=>k.startsWith('trExample:')))}));
    await p.click('.sub-back');await p.waitForSelector('#ttSame');await p.locator('[data-tr-tire]').nth(1).click();await p.waitForSelector('#tpSize');assert.equal(await p.inputValue('#tpSize'),'205/75R15');assert.equal(await p.inputValue('#tpMiles'),'');assert.equal(await p.inputValue('#tpWarranty'),'');await p.click('.sub-back');await p.waitForSelector('#ttSame');await p.click('.sub-back');
    const shortcuts=p.locator('.tz-tr-shortcuts').last(),positions=await shortcuts.locator('button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().top));assert.ok(positions[1]>positions[0]);
    assert.equal(await p.locator('.tz-tr-entry').last().evaluate(e=>e.scrollWidth>e.clientWidth),false);
    await p.evaluate(()=>__app.S.confirmDeletes=false);await p.click('[data-tr-delete="'+defaults.id+'"]');await p.waitForSelector('#cfm.on');await p.click('#cfmNo');assert.equal(await p.evaluate(()=>Garage.car().tires.trailers.length),2);
    await p.click('[data-tr-delete="'+defaults.id+'"]');await p.waitForSelector('#cfm.on');await p.click('#cfmYes');assert.equal(await p.evaluate(()=>Garage.car().tires.trailers.length),1);assert.equal(await p.evaluate(id=>Object.keys(Garage.car().tires.corners).some(k=>k.startsWith(id+':')),defaults.id),false);
    assert.equal(errors.length,0,errors.join('\n'));await cdp.detach();await p.close();
  }} finally {await browser.close();}
  console.log('Trailer touch dragging, smooth tracking, cancel/clamp, dual labels, gutters and three-button nav clearance passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
