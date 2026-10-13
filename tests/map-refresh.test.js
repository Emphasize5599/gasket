const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME||undefined});
 try{
  const p=await browser.newPage({viewport:{width:320,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const s={id:'ChIJTestStation001',brand:'exxon',name:'Exxon',address:'100 Main St, Testville',lat:34.745,lng:-92.29,google:true,prices:{regular:{price:3.99,updated:null},premium:{price:4.99,updated:null}}};
  await p.addInitScript(s=>{sessionStorage.setItem('standinRestored',JSON.stringify({s:JSON.stringify({apiKey:'TEST',setupDone:true,brands:{exxon:true}}),c:JSON.stringify({lastFetch:{lat:s.lat,lng:s.lng,ts:Date.now()-100000},g:[s],o:{}})}));},s);
  await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href+'#restored');
  await p.waitForSelector('#btnLocate.live'); // finish the stand-in startup location/status callback before scanning
  assert.equal(await p.evaluate(()=>document.querySelector('#btnMode').parentElement===document.querySelector('#grades').parentElement),true,'fuel controls share the same layer');
  await p.click('#btnSettings');
  assert.equal(await p.evaluate(()=>{const r=document.querySelector('#btnMode').getBoundingClientRect();return !!document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('#settings');}),true,'settings covers the fuel pill');
  await p.click('#sDone');
  await p.evaluate(()=>{
    window.__paid=0;__app.N.search=()=>__paid++;__app.N.computeRoute=()=>__paid++;
    __app.N.siteRead=(id,key,json)=>{const s=__app.stations()[0];setTimeout(()=>onNativeResult(id,{stores:[{placeId:s.id,name:'Exxon',lat:s.lat,lng:s.lng,prices:{regular:{price:3.12}}}]}),10);};
  });
  await p.click('#btnRefresh');await p.waitForSelector('#refreshMenu');
  assert.equal(await p.isDisabled('[data-refresh="web"]'),false);
  await p.click('[data-refresh="web"]');
  await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('No API calls'));
  assert.equal(await p.evaluate(()=>__paid),0);
  assert.equal(await p.evaluate(()=>__app.stations()[0].prices.regular.price),3.12);
  assert.equal(await p.evaluate(()=>__app.stations()[0].prices.premium.price),4.99);
  const count=await p.evaluate(()=>PriceHistory.history(__app.stations()[0]).length);assert(count>=3);
  await p.evaluate(()=>{__app.KV.clear('gasweb');__app.N.siteRead=()=>{};});
  await p.click('#btnRefresh');await p.click('[data-refresh="web"]');await p.waitForSelector('#jobBar:not(.hidden) .jb-x');
  await p.click('#jobBar .jb-x');await p.waitForFunction(()=>!document.body.classList.contains('job-on'));
  assert.match(await p.innerText('#status'),/Cancelled/);
  assert.equal(await p.evaluate(()=>PriceHistory.history(__app.stations()[0]).length),count,'cancel without completed reads does not invent observations');
  await p.evaluate(()=>{__app.KV.clear('gasweb');__app.KV.clear('along');});
  assert.equal(await p.evaluate(()=>PriceHistory.history(__app.stations()[0]).length),count,'cache clear preserves price history');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.evaluate(()=>__app.S.grade='premium');await p.click('#btnRefresh');assert.equal(await p.isDisabled('[data-refresh="web"]'),false);
  // blue buttons, each with its (?) beside it; no Close: a tap elsewhere closes it
  const lay=await p.evaluate(()=>{const m=document.getElementById('refreshMenu'),bs=[...m.querySelectorAll('.btn.primary')],qs=[...m.querySelectorAll('.qi')];return {n:bs.length,q:qs.length,close:!!m.querySelector('[data-refresh="close"]'),fit:m.getBoundingClientRect().right<=innerWidth,beside:bs.every((b,i)=>{const a=b.getBoundingClientRect(),c=qs[i].getBoundingClientRect();return c.left>=a.right&&Math.abs((c.top+c.bottom)/2-(a.top+a.bottom)/2)<2;})};});
  assert.deepEqual(lay,{n:3,q:3,close:false,fit:true,beside:true});
  if(process.env.SHOT)await p.screenshot({path:process.env.SHOT+'/menu.png'});
  await p.mouse.click(40,600);await p.waitForSelector('#refreshMenu',{state:'detached'});
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('320px map pill: explicit choices, zero paid refresh, other grades, cancel, history and cache-clear retention passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
