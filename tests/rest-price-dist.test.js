const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const D=require('../assets/web/restpricedist');
// Pure: checkable values, bounded storage, bins
const kv=new Map(),KV={get:(ns,k)=>kv.has(ns+'|'+k)?{v:JSON.parse(kv.get(ns+'|'+k))}:null,put:(ns,k,v)=>kv.set(ns+'|'+k,JSON.stringify(v))};
assert.equal(D.value({price:0}),0);assert.equal(D.value({feeRange:{min:10,max:25}}),25);assert.equal(D.value({price:null,priceUnverified:true}),null);assert.equal(D.value({feeRange:{min:5,max:9,extra:true}}),null,'extra fees are not a checkable rate');
assert.equal(D.sourceOf({id:'rvparky:1'}),'rvparky');assert.equal(D.sourceOf({id:'campendium:9'}),'campendium');assert.equal(D.sourceOf({id:'ridb:3'}),'ridb');assert.equal(D.sourceOf({id:'ntad:3'}),null);
D.record(KV,[{id:'rvparky:1',price:0},{id:'rvparky:2',price:22},{id:'rvparky:3',price:null,priceUnverified:true},{id:'ntad:1',price:0},{id:'campendium:1',feeRange:{min:40,max:140}}]);
let sum=D.summary(KV,'rvparky');assert.deepEqual(sum.known.sort((a,b)=>a-b),[0,22]);assert.equal(sum.unknown,1);assert.deepEqual(D.summary(KV,'campendium').known,[140]);assert.equal(D.summary(KV,'ntad').known.length,0);
D.record(KV,[{id:'rvparky:2',price:18}]);assert.deepEqual(D.summary(KV,'rvparky').known.sort((a,b)=>a-b),[0,18],'a place is counted once, with its latest rate');
D.record(KV,Array.from({length:4100},(_,i)=>({id:'rvparky:x'+i,price:i%60})));assert.equal(Object.keys(D.summary(KV,'rvparky')).length,2);const big=D.summary(KV,'rvparky');assert.equal(big.known.length+big.unknown,4000,'bounded per source');
const b=D.bins([0,0,3,5,5.01,100,101,400]);assert.equal(b.length,22);assert.equal(b[0].n,2);assert.equal(b[1].n,2);assert.equal(b[2].n,1);assert.equal(b[20].n,1);assert.equal(b[21].n,2);assert.equal(D.within([0,10,20,30],20),3);
assert.match(D.html({known:[],unknown:0},25,'RV Parky'),/Have Gasket search for some rest stops/);
(async()=>{const {chromium}=require('playwright'),browser=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const width of [320,448]){
 const p=await browser.newPage({viewport:{width,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\//,r=>r.abort());await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await require('./onboarding-ui')(p);
 await p.evaluate(()=>{__app.S.restSources={campendium:{maxNightly:30}};RestSettings.open(__app);});
 const tile='[data-rest-provider="campendium"]';await p.click(tile+' > summary');await p.waitForSelector(tile+' .rpd-chart');
 assert.match(await p.innerText(tile+' .rpd'),/No stored places yet[\s\S]*Have Gasket search for some rest stops/,'empty chart area tells you to search');
 const order=await p.evaluate(t=>{const el=document.querySelector(t),c=el.querySelector('.rpd'),r=el.querySelector('[data-night-limit]');return !!(c.compareDocumentPosition(r)&Node.DOCUMENT_POSITION_FOLLOWING);},tile);assert(order,'chart sits above the price slider');
 await p.evaluate(()=>{RestPriceDist.record(__app.KV,[0,0,12,18,25,35,45,60,140].map((v,i)=>({id:'campendium:'+i,price:v})).concat([{id:'campendium:u',price:null,priceUnverified:true}]));window.__subClose(true);RestSettings.open(__app);});
 await p.click(tile+' > summary');await p.waitForSelector(tile+' .rpd-bar.fit');
 assert.match(await p.innerText(tile+' .rpd-cap'),/5 of 9 places with a checkable rate fit \$30\.00\. 1 more have no checkable price and are hidden\./);
 const fit=await p.locator(tile+' .rpd-bar.fit[height]:not([height="0"])').count();assert.equal(fit,4,'Free, $10–15, $15–20, $20–25 bars fit $30');
 await p.locator(tile+' [data-night-limit]').evaluate(r=>{r.value='60';r.dispatchEvent(new Event('input',{bubbles:true}));});assert.match(await p.innerText(tile+' .rpd-cap'),/8 of 9 places/,'chart follows the slider while dragging');
 await p.uncheck(tile+' [data-night-enabled]');assert.match(await p.innerText(tile+' .rpd-cap'),/9 stored places with a checkable rate\. 1 more have no checkable price \(hidden once you set a limit\)/);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal scroll');assert.deepEqual(errors,[]);await p.close();}
 console.log('Rest price distribution: stored values, bounds, bins, empty prompt, chart above slider following it at 320/448');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
