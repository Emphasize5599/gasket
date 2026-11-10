const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});
 try{
  const page=await browser.newPage({viewport:{width:448,height:1160},hasTouch:true,timezoneId:'UTC'});
  await page.route(/^https?:\/\//,route=>route.abort());
  await page.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);
  await page.evaluate(()=>{
   const host=document.createElement('main');
   host.id='scheduleFixture';
   host.style.cssText='position:fixed;top:25px;left:16px;right:16px;z-index:10000;background:white';
   document.body.append(host);
   const H=3600000,day=Date.parse('2030-11-12T00:00Z');
   const windows=[{ds:day+8*H,de:day+18.5*H,ae:day+22*H}];
   window.__fixture={host,windows,day,draws:0};
   window.__fixture.schedule=WindowSchedule.bind(host,{
    zone:'UTC',now:day,clock24:true,starts:[],esc:__app.esc,read:i=>({...windows[i]}),
    write:(i,id,t)=>{windows[i][id]=t;return true;},rules:()=>[],skippedNights:()=>[],skippedWaits:()=>[],
    onIssues(){},legs:[{zone:'UTC',estimate:()=>[{kind:'drive',minutes:180}]}]
   });
   new MutationObserver(()=>__fixture.draws++).observe(host,{childList:true});
  });
  const touch=await page.context().newCDPSession(page);
  const send=(type,x,y)=>touch.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
  const geometry=await page.evaluate(()=>{
   const {host}=__fixture,handle=host.querySelector('[data-ws-edge="ds"]').getBoundingClientRect();
   const rows=[...host.querySelectorAll('.ws-strip')],track=rows[0].querySelector('.ws-track').getBoundingClientRect();
   return {startX:handle.left+handle.width/2,startY:handle.top+handle.height/2,
    x:track.left+track.width*5.1/6,y:rows.at(-1).getBoundingClientRect().bottom+17};
  });
  await send('touchStart',geometry.startX,geometry.startY);
  for(let i=0;i<8;i++){
   await send('touchMove',geometry.x+i%2,geometry.y);
   await page.waitForTimeout(45);
  }
  await send('touchEnd');
  const result=await page.evaluate(()=>({start:__fixture.windows[0].ds,end:__fixture.windows[0].de,draws:__fixture.draws}));
  assert.equal(result.start,result.end,'the handle stops at the opposite endpoint');
  assert.equal(result.draws,1,'holding below the chart redraws once');
  await page.evaluate(()=>{
   const {windows,schedule,day}=__fixture;
   windows[0]={ds:day+8*3600000,de:day+18*3600000,ae:day+4*86400000+18*3600000};
   schedule.refresh();
  });
  const drop=await page.evaluate(()=>{
   const {host}=__fixture,handle=host.querySelector('[data-ws-edge="ae"]').getBoundingClientRect();
   const row=host.querySelector('.ws-compact'),track=row.querySelector('.ws-track').getBoundingClientRect();
   return {startX:handle.left+handle.width/2,startY:handle.top+handle.height/2,x:track.left+track.width/2,
    y:track.top+track.height/2,from:+row.dataset.wsFrom,to:+row.dataset.wsTo};
  });
  assert.equal(await page.locator('.ws-compact').count(),3,'all three empty days have compact drop rows');
  await send('touchStart',drop.startX,drop.startY);
  await send('touchMove',drop.x,drop.y);
  await page.waitForTimeout(60);
  await send('touchEnd');
  const arrival=await page.evaluate(()=>__fixture.windows[0].ae);
  assert(arrival>=drop.from&&arrival<drop.to,'a handle can be dropped directly on an empty day');
  assert.equal(arrival%900000,0,'dropping on a compact day still snaps to quarter hours');
  console.log('Touch drag stays in bounds without oscillation and can land on a compact day');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
