// Simulates a thumb dragging an itinerary handle down (and back up) across day rows,
// and checks the drawn handle stays under the thumb at every step.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});
 try{
  for(const width of [360,448]){
   const page=await browser.newPage({viewport:{width,height:760},hasTouch:true,timezoneId:'UTC'});
   await page.route(/^https?:\/\//,route=>route.abort());
   await page.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
   await page.evaluate(()=>{
    // A scrolling page like the window form: the itinerary sits inside a scroller.
    const scroller=document.createElement('div');
    scroller.id='scroller';
    scroller.style.cssText='position:fixed;inset:0;overflow:auto;z-index:10000;background:white';
    const host=document.createElement('main');
    scroller.append(Object.assign(document.createElement('div'),{style:'height:120px'}),host,Object.assign(document.createElement('div'),{style:'height:900px'}));
    document.body.append(scroller);
    const H=3600000,day=Date.parse('2030-11-12T00:00Z');
    const windows=[{ds:day+8*H,de:day+10*H,as:day+14*H,ae:day+4*24*H+18*H}];
    window.__fixture={host,scroller,windows,day};
    window.__fixture.schedule=WindowSchedule.bind(host,{
     zone:'UTC',now:day,clock24:true,starts:[],esc:__app.esc,read:i=>({...windows[i]}),
     write:(i,id,t)=>{windows[i][id]=t;return true;},rules:()=>[],skippedNights:()=>[],skippedWaits:()=>[],
     setNight(){},setWait(){},onIssues(){},legs:[{zone:'UTC',estimate:()=>[{kind:'drive',minutes:240}]}]
    });
   });
   const cdp=await page.context().newCDPSession(page);
   const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
   const handle=()=>page.evaluate(()=>{
    const h=__fixture.host.querySelector('[data-ws-edge="as"]');if(!h)return null;
    const b=h.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,at:+h.dataset.wsAt};
   });
   const start=await handle();
   await touch('touchStart',start.x,start.y);
   let worst=0,steps=0,x=start.x,y=start.y;
   const report=[];
   const step=async(dy)=>{
    y=Math.min(745,y+dy);await touch('touchMove',x,y);
    // Measure after the app has handled the move (it redraws on the next animation frame).
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const h=await handle();steps++;
    const gap=h?Math.abs(h.y-y):Infinity;
    report.push({y:Math.round(y),handleY:h&&Math.round(h.y),gap:Math.round(gap)});
    worst=Math.max(worst,gap);
   };
   // Down slowly well past three day rows, then back up.
   for(let i=0;i<60;i++)await step(8);
   const scrolled=await page.evaluate(()=>__fixture.scroller.scrollTop);
   assert(scrolled>0,'holding the thumb near the bottom edge scrolls the itinerary');
   for(let i=0;i<60;i++)await step(-8);
   await touch('touchEnd');
   if(process.env.DEBUG_FOLLOW)console.log(width,JSON.stringify(report));
   assert(worst<80,`handle stays within half a row of the thumb at ${width}px (worst gap ${Math.round(worst)}px)`);
   await page.close();
  }
  // A rest that can't fit shows a pinned problem box under the chart with a Drive through button.
  for(const width of [320,448]){
   const page=await browser.newPage({viewport:{width,height:700},timezoneId:'UTC'});
   await page.route(/^https?:\/\//,route=>route.abort());
   await page.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
   await page.evaluate(()=>{
    const scroller=document.createElement('div');scroller.id='scroller';
    scroller.style.cssText='position:fixed;inset:0;overflow:auto;z-index:10000;background:white';
    const host=document.createElement('main');scroller.append(host);document.body.append(scroller);
    const H=3600000,day=Date.parse('2030-11-03T12:00Z'),prefs=Overnight.defaults({minimum:360,preferred:480}),where={zone:'UTC',point:{lat:30,lng:-90}};
    const windows=[{ds:day-H,de:day+H,ae:day+19*H}],skipped=new Set();
    window.__fx={host,scroller,windows,skipped,issues:[]};
    WindowSchedule.bind(host,{zone:'UTC',now:day-2*H,clock24:true,starts:[day],esc:__app.esc,read:i=>({...windows[i]}),write:()=>true,rules:()=>[],
     skippedNights:()=>[...skipped],skippedWaits:()=>[],setNight(i,date,skip){if(skip)skipped.add(date);else skipped.delete(date);},setWait(){},onIssues(x){__fx.issues=x;},
     legs:[{zone:'UTC',estimate:t=>WindowSchedule.restParts([{kind:'drive',minutes:18*60}],t,where,prefs,windows[0].ae,[...skipped])}]});
   });
   const box=page.locator('.ws-problems');
   await box.waitFor();
   assert.match(await box.innerText(),/miss your latest arrival/,'the problem says why');
   assert(await page.locator('.ws-norest').count()>0,'the stretch is red');
   assert(/latest arrival/.test((await page.evaluate(()=>__fx.issues)).join(' ')),'the same problem is listed above Save');
   const visible=await page.evaluate(()=>{const b=document.querySelector('.ws-problems').getBoundingClientRect();return b.bottom<=innerHeight&&b.top<innerHeight;});
   assert(visible,'the problem box stays on screen while the chart is scrolled to the top');
   assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||__fx.host.scrollWidth>__fx.host.clientWidth),'no sideways scrolling');
   await box.locator('[data-ws-night]').click();
   await page.waitForFunction(()=>!document.querySelector('.ws-problems'));
   assert.equal(await page.locator('.ws-norest').count(),0,'driving through clears the red stretch');
   assert.deepEqual(await page.evaluate(()=>__fx.issues),[]);
   await page.close();
  }
  console.log('Itinerary handles follow the thumb vertically across day rows');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
