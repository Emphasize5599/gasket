const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await b.newPage({viewport:{width,height:900}});await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);
 await p.evaluate(()=>{
  document.body.classList.add('trip-on','trip-full');window.reads=0;window.verifies=[];window.mapFetches=0;
  __app.N.siteVerify=key=>verifies.push(key);
  __trip.call=async(fn,key,args)=>{if(fn==='siteRead'&&key==='chargepoint'){reads++;return reads===1?{blocked:true}:{text:'Price Prices Set by Testville Energy Rate $0.42 / kWh'};}return {};};
  __app.N.search=()=>mapFetches++;__app.N.siteSearch=()=>mapFetches++;
  window.items=[{st:{id:'fixture',country:'US',network:'ChargePoint',netIds:{station:['USCPIL987654']}},dc:true,kw:50}];
  window.finished=false;EVPrices.annotate(items,{}).then(()=>finished=true);
 });
 await p.waitForSelector('#wmCheck:not(.hidden)');assert.match(await p.locator('#wmCheck').innerText(),/paused/i);assert.equal(await p.evaluate(()=>reads),1);
 assert(await p.locator('#wmCheckGo').isVisible());await p.click('#wmCheckGo');assert.equal(await p.evaluate(()=>verifies[0]),'chargepoint');
 await p.evaluate(()=>onSiteVerified('chargepoint'));await p.waitForFunction(()=>finished);assert.equal(await p.evaluate(()=>items[0].st.netPrice.rate),.42);assert.equal(await p.evaluate(()=>mapFetches),0,'completing charger check must never start paid map discovery');
 assert.equal(await p.evaluate(()=>reads),2);assert(await p.locator('#wmCheck').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
 await p.close();
}}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
