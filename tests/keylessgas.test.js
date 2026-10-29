const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const K=require('../assets/web/keylessgas.js'),P=require('../assets/web/pricing.js');
const root=path.resolve(__dirname,'..'),script=fs.readFileSync(path.join(root,'assets/gasweb_worker.js'),'utf8');
const nativeScript='async function(reqId,args){\n'+fs.readFileSync(path.join(root,'assets/web/pricing.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'assets/web/keylessgas.js'),'utf8')+'\nreturn ('+script+')(reqId,args);}';
const a=K.area(34.745,-92.29,8);
assert.equal(K.area(34.745,-92.29,30).radius,15);
for(const input of [[NaN,0,8],[90,0,8],[0,181,8],[0,0,-1]])assert.throws(()=>K.area(...input));
assert.match(decodeURIComponent(K.osmUrl(a)),/nwr\["amenity"="fuel"\]/);
const element=(type,id,lat,lon,brand)=>({type,id,lat,lon,tags:{amenity:'fuel',brand}});
const open=K.normalizeOsm({elements:[element('node',1,34.745,-92.29,'Exxon'),{...element('way',2,undefined,undefined,'Exxon'),center:{lat:34.74501,lon:-92.29001}},element('node',3,40,-92,'Exxon'),element('node',4,34.74,-92.3,'Unknown Brand')]},a,P);
assert.equal(open.length,1,'deduplicate node/way, reject outside area and unsupported brands');
assert.equal(open[0].google,false);assert.deepEqual(open[0].prices,{});
const w={id:'web:0x1:0x2',name:'Exxon',lat:34.745,lng:-92.29,prices:{regular:{price:3.123,updated:null}},source:'Google Maps web',mapsUri:'https://www.google.com/maps/place/Exxon',google:true};
const merged=K.merge(open,[w],a,P);
assert.equal(merged.length,1);assert.equal(merged[0].prices.regular.price,3.123);assert.equal(merged[0].google,true);
assert.deepEqual(open[0].prices,{},'do not mutate cached station locations');
const ambiguous=K.merge([open[0],{...open[0],id:'other',lng:-92.2901}],[w],a,P);
assert.equal(ambiguous.length,3);assert.equal(ambiguous[0].prices.regular,undefined,'never assign a price across ambiguous pumps');
const twin=K.merge(open,[w,{...w,id:'web:twin',lng:-92.2901,prices:{regular:{price:4.12,updated:null}}}],a,P);
assert.equal(twin.length,3);assert.equal(twin[0].prices.regular,undefined,'two nearby same-brand Google pumps cannot overwrite one OSM station');
console.log('Open-station normalization, bounds, deduplication, provenance and conservative matching passed');
const savedStation={...w,id:'ChIJSavedStation0001',brand:'exxon',address:'100 Main Street, Testville, AR',state:'AR',wplus:false,detourMi:1.25,detourExact:true,prices:{regular:{price:3.99,updated:'2026-10-01T00:00:00Z'},premium:{price:4.99,updated:'2026-10-01T00:00:00Z'}}};
const refreshed=K.updateKnown([savedStation],[{...w,placeId:savedStation.id,prices:{regular:{price:3.12}}},{...w,id:'unseen',lat:40}],P,123);
assert.equal(refreshed.updated,1);assert.equal(refreshed.stations.length,1,'refresh must not discover/add website-only stations');
assert.equal(refreshed.stations[0].prices.regular.price,3.12);assert.equal(refreshed.stations[0].prices.regular.updated,null);
assert.equal(refreshed.stations[0].prices.regular.observedAt,123);
assert.equal(refreshed.stations[0].prices.premium.price,4.99);assert.equal(refreshed.stations[0].wplus,false);assert.equal(refreshed.stations[0].detourMi,1.25);
assert.equal(savedStation.prices.regular.price,3.99,'do not mutate the saved input');
assert.equal(K.updateKnown([savedStation,{...savedStation,id:'other'}],[w],P,123).updated,0,'ambiguous nearby stations keep old prices');
assert.equal(P.DEFAULTS.routesMonthlyCap,9500);
const link=(id,name='Exxon',lng=-92.29)=>`<article role="article"><a aria-label="${name}" href="https://www.google.com/maps/place/${name}/data=!1s${id}!3d34.745!4d${lng}">${name}</a></article>`;
const html='<div role="feed">'+link('0x1:0x2')+link('0x3:0x4','Mobil',-92.30)+'End of the list</div>';
async function worker(pg,body,raw,status=200,args={},realMs=0){
  if(!pg.__fixtureClock){await pg.clock.install();pg.__fixtureClock=true;}
  await pg.setContent(body);
  await pg.evaluate(({raw,status})=>{
    window.commandUrls=[];window.answers=[];window.GasketSite={result:(_,s)=>answers.push(JSON.parse(s))};
    performance.getEntriesByType=()=>[{name:raw&&raw.bulk?'https://www.google.com/search?tbm=map&q=gas+stations&pb=!4m8!1m3!1d1000!2d-92.29!3d34.745!3m2!1i1280!2i900!4f13.1!7i20!10b1!12m1!1b1':'https://www.google.com/search?tbm=map&q=gas+stations'}];
    window.fetch=async u=>{commandUrls.push(String(u));const offset=+(new URL(u).searchParams.get('pb')?.match(/!8i(\d+)/)?.[1]||0),code=raw&&raw.bulk&&raw.statuses&&raw.statuses[offset]||status,body=raw&&raw.bulk?JSON.stringify(raw.pages[offset]||raw.pages[0]):raw;return {ok:code===200,status:code,url:'https://www.google.com/search',text:async()=>body};};
  },{raw,status});
  await pg.evaluate(({s,args})=>{(0,eval)('('+s+')')(1,args);},{s:nativeScript,args});
  for(let i=0;i<650&&!(await pg.evaluate(()=>answers.length));i++){await pg.clock.fastForward(300);if(realMs)await pg.waitForTimeout(realMs);}   // realMs: Chrome delivers scroll events on real frames, not the fake clock
  assert((await pg.evaluate(()=>answers.length))>0,'worker must settle within its simulated deadline');
  return pg.evaluate(()=>answers[0]);
}
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROME||undefined});
 try{
  const pg=await b.newPage();
  const paged='<div role="feed" style="height:120px;overflow:auto">'+link('0x1:0x2')+'<button onclick="window.pages=(window.pages||0)+1;var a=document.createElement(\'article\');a.setAttribute(\'role\',\'article\');a.innerHTML=\'<a aria-label=&quot;Exxon&quot; href=&quot;https://www.google.com/maps/place/Exxon/data=!1s0x1:0x\'+(pages+2).toString(16)+\'!3d34.745!4d-92.29&quot;>Exxon</a>\';this.before(a);if(pages===5){this.after(document.createTextNode(\'End of the list\'));this.remove();}">Load more results</button></div>';
  const discovery=await worker(pg,paged,JSON.stringify([]),200,{mode:'discover',targets:[{featureId:'0x1:0x2'}]});
  assert.equal(discovery.stores.length,6,'discovery loads all five additional pages, even with a matched target');
  assert(discovery.detail.scrolls>=5);assert.equal(discovery.detail.exhausted,true);assert.equal(discovery.error,null,'unpriced stations are valid discovery results');
  // A full first page without pagination merits recovery; ordinary short quiet lists do not.
  const firstPage='<div role="feed" style="height:180px;overflow:auto">'+Array.from({length:20},(_,i)=>link('0x'+(i+1).toString(16)+':0xff')).join('')+'</div>';
  const stalledPage=await worker(pg,firstPage,JSON.stringify([]),200,{mode:'discover'});
  assert.equal(stalledPage.code,'pagination_stalled');assert.equal(stalledPage.detail.paginationStalled,true);assert.equal(stalledPage.detail.exhausted,false);
  // a short list with no end marker: done once it's at the bottom and quiet for 4 s, not after the full 12 s
  const short=await worker(pg,'<div role="feed">'+link('0x1:0x2')+link('0x3:0x4','Mobil',-92.30)+'</div>',JSON.stringify([]),200,{mode:'discover'});
  assert.equal(short.code,'incomplete_feed');assert.equal(short.detail.paginationStalled,false);assert.equal(short.detail.stopReason,'quiet');assert.ok(short.detail.elapsedMs<7000,'quiet list: '+short.detail.elapsedMs+' ms');assert.equal(short.stores.length,2);assert.equal(short.detail.exhausted,false,'silence is not proof of exhaustion and must not cache a possibly stalled list');
  const late='<div role="feed" style="height:100px;overflow:auto"><div style="height:400px">'+link('0x1:0x2')+'</div></div><script>setTimeout(()=>{document.querySelector(\'[role="feed"]\').onscroll=function(){if(this.scrollTop+this.clientHeight<this.scrollHeight-4)return;this.insertAdjacentHTML(\'beforeend\',\'<div>End of the list</div>\');this.onscroll=null;};},1500);</script>';
  const lateScroll=await worker(pg,late,JSON.stringify([]),200,{mode:'discover'},20);
  assert.equal(lateScroll.detail.stopReason,'end','late pagination listener receives a fresh bottom scroll event');
  assert.equal(lateScroll.detail.exhausted,true);
  function bulkPage(start,n,closed){const tree=[];tree[64]=Array.from({length:n},(_,j)=>{const i=start+j,r=[];r[9]=[null,null,34.745,-92.29];r[10]='0xaa:0x'+(i+1).toString(16);r[11]='Exxon '+i;r[13]=['Gas station'];r[39]='100 Main Street';r[78]='ChIJSyntheticStation'+i;r[88]=[i===closed?'Permanently closed':'$3.19/Regular'];return [null,r];});return tree;}
  const terminal=Array(72).fill(null);terminal[0]=['gas stations'];terminal[1]=[[1000,-92.29,34.745]];terminal[58]=[0];terminal[71]=[1];
  const protocolBody='<div role="feed">'+link('0xaa:0x1')+'</div>',pages={0:bulkPage(0,100),100:bulkPage(100,2,101),200:terminal};
  const bulk=await worker(pg,protocolBody,{bulk:true,pages},200,{mode:'discover'});assert.equal(bulk.detail.stopReason,'command_end');assert.equal(bulk.detail.bulkPages,3);assert.equal(bulk.detail.scrolls,0,'commands finish without scrolling');assert.equal(bulk.stores.length,101,'all command pages merge and explicitly closed station is excluded');assert(bulk.stores.every(s=>s.prices.regular.price===3.19&&s.placeId),'typed identities and explicit prices retained');
  assert(bulk.detail.commandReusable,'explicit command end can retain its page');
  const moved=bulkPage(0,2);moved[64].forEach(x=>{x[1][9][2]=35.745;x[1][9][3]=-93.29;});
  const reuseArgs={mode:'discover',grade:'regular',reuseCommands:true,url:'https://www.google.com/maps/search/gas+stations/@35.74500,-93.29000,12z?hl=en',area:{lat:35.745,lng:-93.29,radius:8}};
  const reused=await worker(pg,protocolBody,{bulk:true,pages:{0:moved,100:terminal}},200,reuseArgs);
  assert.equal(reused.stores.length,2);assert(reused.detail.commandReused&&reused.detail.commandReusable);assert(reused.stores.every(s=>s.lat===35.745),'never leak old DOM stations into a new cell');
  const command=await pg.evaluate(()=>new URL(commandUrls[0]).searchParams.get('pb'));assert.match(command,/!2d-93.29!3d35.745/);assert.match(command,/!4f12\.1/);assert.equal(reused.detail.cardsParsed,0,'warm document needs neither DOM scan nor rendering');
  const reuseBad=await worker(pg,protocolBody,{bulk:true,pages:{0:['changed schema']}},200,reuseArgs);assert.equal(reuseBad.code,'command_reload');assert.equal(reuseBad.stores.length,0);assert.equal(K.searched(reuseBad),null,'failed command reuse cannot mark a cell covered');
  const reuseBlocked=await worker(pg,protocolBody,{bulk:true,pages:{0:moved},statuses:{0:429}},200,reuseArgs);assert(reuseBlocked.blocked,'warm pages must surface bot checks');
  const clippedPages=JSON.parse(JSON.stringify(pages));clippedPages[0][64][0][1][9][2]=35;const clipped=await worker(pg,protocolBody,{bulk:true,pages:clippedPages},200,{mode:'discover',area:{lat:34.745,lng:-92.29,radius:.005}});assert(clipped.stores.every(s=>P.haversineMi(34.745,-92.29,s.lat,s.lng)<=.005),'command records outside the search cell are rejected inside the reader');assert(clipped.detail.bulkOutside>0);assert(clipped.detail.priceLabels<=clipped.stores.length+1,'out-of-cell records must not allocate price-evidence collections');
  const smallPages={0:bulkPage(0,20),20:bulkPage(20,2),40:terminal};const small=await worker(pg,protocolBody,{bulk:true,pages:smallPages},200,{mode:'discover',searchMethod:'commands20'});assert.equal(small.stores.length,22);assert.equal(small.detail.bulkPageSize,20);
  const scrollOnly=await worker(pg,protocolBody+'End of the list',JSON.stringify([]),200,{mode:'discover',searchMethod:'scroll'});assert.equal(scrollOnly.detail.bulkPages,0);
  const commandNoFeed=await worker(pg,'<p>Map loading</p>',{bulk:true,pages},200,{mode:'discover'});assert.equal(commandNoFeed.error,null,'valid command results do not require a rendered feed');assert.equal(commandNoFeed.code,'limited');assert.equal(commandNoFeed.detail.exhausted,true);assert.equal(commandNoFeed.stores.length,101);assert.equal(K.searched(commandNoFeed),'end','a command-complete reply with no rendered feed certifies its cell for StationStore');
  const denied=await worker(pg,protocolBody,{bulk:true,pages,statuses:{100:429}},200,{mode:'discover'});assert.equal(denied.blocked,true,'bulk requests stop for site checks');
  const malformed=bulkPage(0,1);malformed[64][0][1][9][2]=95;const fallback=await worker(pg,protocolBody+'End of the list',{bulk:true,pages:{0:malformed}},200,{mode:'discover'});assert.match(fallback.detail.bulkFallback,/identity schema/);assert.equal(fallback.stores.length,1,'invalid command coordinates cannot enter the station list');
  const changing='<div role="feed">'+link('0x1:0x2')+'</div><script>const card=document.querySelector("article");card.insertAdjacentHTML("beforeend","<p>Regular</p><p>$3.12</p>");setTimeout(()=>{card.remove();card.querySelector("p:last-child").textContent="$4.12";document.querySelector("[role=feed]").appendChild(card);},450);setTimeout(()=>document.querySelector("[role=feed]").append("End of the list"),1000);</script>';
  const changed=await worker(pg,changing,JSON.stringify([]),200,{mode:'discover'});assert.equal(changed.stores[0].prices.regular.price,4.12,'reinserted/changed cards invalidate incremental parsing');assert(changed.detail.cardsSkipped>0,'unchanged cards avoid repeated layout/text parsing');assert(lateScroll.detail.scrollEvents>0,'bottom pagination is explicitly signaled');
  for(const grade of ['regular','midgrade','premium','diesel']){
    const label={regular:'Regular',midgrade:'Midgrade',premium:'Premium',diesel:'Diesel'}[grade];
    const r=await worker(pg,html,JSON.stringify(['0x1:0x2','$4.12/'+label]),200,{grade});
    assert.equal(r.stores[0].prices[grade].price,4.12);assert.notEqual(r.code,'no_prices');
  }
  const all=await worker(pg,html,JSON.stringify(['0x1:0x2',['Regular','$3.12'],['Midgrade','$3.42'],['Premium','$3.72'],['Diesel','$3.89']]),200,{grade:'diesel'});
  assert.equal(all.stores[0].prices.diesel.price,3.89);assert.equal(all.stores[0].prices.premium.price,3.72);
  const sparse=await worker(pg,html,JSON.stringify([Array.from({length:10000},(_,i)=>[i,null,false,'unrelated label']),['0x1:0x2',['Regular','$3.12'],['Diesel','$3.89']],['0x3:0x4',['Regular','$4.12']]]),200,{grade:'diesel'});
  assert.equal(sparse.stores[0].prices.diesel.price,3.89);assert.equal(sparse.stores[1].prices.regular.price,4.12,'allocation-light traversal preserves evidence across unrelated leaves');
  const invalidGrade=await worker(pg,html,JSON.stringify(['0x1:0x2',['constructor','$3.12'],['__proto__','$4.12']]));
  assert.deepEqual(invalidGrade.stores[0].prices,{},'only explicit supported grades are evidence');
  const different=await worker(pg,html,JSON.stringify([['0x1:0x2','$3.12/Regular'],['0x3:0x4','$3.89/Diesel']]),200,{grade:'diesel'});
  assert.equal(different.stores[0].prices.diesel,undefined,'never borrow the neighboring station\'s diesel price');
  assert.equal(different.stores[1].prices.diesel.price,3.89);
  const matched=await worker(pg,html,JSON.stringify(['0x1:0x2','$3.12/Regular']),200,{targets:[{id:'ApiIdNotInDom',brand:'exxon',lat:34.745,lng:-92.29}]});
  assert.equal(matched.detail.targetsComplete,true,'reuse exact final matcher when Maps omits the saved place ID');
  const duplicateHtml='<div role="feed">'+link('0x1:0x2')+link('0x3:0x4','Exxon',-92.29001)+'End of the list</div>';
  const ambiguousMatch=await worker(pg,duplicateHtml,JSON.stringify([['0x1:0x2','$3.12/Regular'],['0x3:0x4','$3.14/Regular']]),200,{targets:[{id:'ApiIdNotInDom',brand:'exxon',lat:34.745,lng:-92.29}]});
  assert.equal(ambiguousMatch.detail.targetsComplete,false,'ambiguous coordinates cannot shorten the scan');
  const exhausted=await worker(pg,'<div role="feed">'+link('0x1:0x2')+'</div>',JSON.stringify(['0x1:0x2','$3.12/Regular']));
  assert.equal(exhausted.stores.length,1);assert(exhausted.detail.elapsedMs<3000,'non-scrollable feed needs no repeated dummy scrolling');
  console.log('Exhausted-feed reader '+exhausted.detail.elapsedMs+' ms simulated time; conservative coordinate completion passed');
  await pg.evaluate(()=>window.__gasketLeanResources=true);
  const noFeed=await worker(pg,'<div>You are seeing a limited view of Google Maps.</div>',JSON.stringify([]),200,{mode:'discover'});
  assert.equal(noFeed.code,'unreadable');assert.equal(noFeed.detail.stopReason,'no_feed');assert.equal(noFeed.detail.limitedView,true);
  assert(noFeed.detail.elapsedMs>=8000&&noFeed.detail.elapsedMs<10000,'lean unreadable page yields promptly for the one normal-resource retry');
  const restricted=await worker(pg,'<div>Verify that you are human</div>',JSON.stringify([]),200,{mode:'discover'});
  assert.equal(restricted.blocked,true,'a restriction must not be turned into a normal-resource retry');
  await pg.evaluate(()=>delete window.__gasketLeanResources);
  const targeted=await worker(pg,'<div role="feed">'+link('0x1:0x2')+'</div>',JSON.stringify(['0x1:0x2','$3.12/Regular']),200,{targets:[{featureId:'0x1:0x2'}]});
  assert.equal(targeted.detail.targetsComplete,true,'finish without waiting for end of list when all stable-ID targets are priced');
  for(const [grade,label]of [['regular','Regular'],['midgrade','Midgrade'],['premium','Premium'],['diesel','Diesel']]){
    const card=link('0x1:0x2').replace('</article>','<div>$3.12</div><div>'+label+'</div></article>');
    const direct=await worker(pg,'<div role="feed">'+card+'</div>','bad JSON',200,{grade,targets:[{featureId:'0x1:0x2'}]});
    assert.equal(direct.detail.targetsComplete,true);assert.equal(direct.detail.replies,0,'fully priced DOM targets need no duplicate response download');assert.equal(direct.stores[0].prices[grade].price,3.12);
  }
  const incomplete=await worker(pg,html,JSON.stringify(['0x1:0x2','$3.12/Regular']),200,{targets:[{featureId:'0x1:0x2'},{id:'missing'}]});
  assert.equal(incomplete.detail.targetsComplete,false,'one missing saved station prevents premature completion');
  const r=await worker(pg,html,")]}'\n"+JSON.stringify([['0x1:0x2',['$3.123/Regular','Escaped \\" ] bracket']],['0x3:0x4',['$4.56/Regular']]])+'\n/* trailing frame */');
  assert.equal(r.stores[0].prices.regular.price,3.123);assert.equal(r.stores[1].prices.regular.price,4.56);
  assert.equal(r.stores[0].prices.regular.updated,null);assert.equal(r.partial,true);
  const framed=await worker(pg,html,JSON.stringify({c:0,d:")]}'\n"+JSON.stringify([['0x1:0x2','$3.12/Regular']])})+'/*""*/');
  assert.equal(framed.stores[0].prices.regular.price,3.12,'real Maps scroll-frame envelope');
  for(const raw of [JSON.stringify(['0x1:0x2','$4.99/Premium']),JSON.stringify(['0x1:0x2','$5.12/Diesel']),JSON.stringify(['0x1:0x2','$0.01/Regular']),JSON.stringify(['0x1:0x2','0x3:0x4','$3.12/Regular'])]){
    const miss=await worker(pg,html,raw);assert.equal(miss.stores[0].prices.regular,undefined);assert.equal(miss.code,'no_prices');
  }
  assert.equal((await worker(pg,html,'bad JSON')).code,'reader');
  assert.equal((await worker(pg,html,'',429)).blocked,true);
  assert.equal((await worker(pg,'<h1>Unusual traffic</h1>','')).blocked,true);
  await pg.close();
  console.log('Actual worker: exact regular-grade parsing, per-station binding, ambiguous/missing/invalid prices and restrictions passed');
  const ui=await b.newPage({viewport:{width:320,height:800}});
  await ui.goto(pathToFileURL(path.join(root,'assets/web/index.html')).href);
  await ui.evaluate(({w})=>{
    window.__osmCalls=0;window.__webCalls=0;
    __app.N.fetchJson=(id,url)=>{__osmCalls++;setTimeout(()=>onNativeResult(id,{body:JSON.stringify({elements:[{type:'node',id:1,lat:34.745,lon:-92.29,tags:{amenity:'fuel',brand:'Exxon'}}]})}),1);};
    __app.N.siteRead=(id,key,args)=>{__webCalls++;setTimeout(()=>onNativeResult(id,{stores:[w]}),1);};
  },{w});
  const lifecycle=await ui.evaluate(async()=>{
    const first=await KeylessGas.search(34.745,-92.29,8),cached=await KeylessGas.search(34.745,-92.29,8),cooldown=await KeylessGas.search(34.755,-92.30,8);
    return {first,cached,cooldown,osmCalls:__osmCalls,webCalls:__webCalls,budget:__app.KV.get('gasmeta','osm-budget').v};
  });
  assert.equal(lifecycle.first.stations[0].prices.regular.price,3.123);
  assert.deepEqual(lifecycle.cached,lifecycle.first);
  assert.equal(lifecycle.osmCalls,1);assert.equal(lifecycle.webCalls,1);
  assert.equal(lifecycle.cooldown.errors.length,2);
  assert.equal(lifecycle.budget.calls,1);
  await ui.clock.install();await ui.clock.fastForward(30001);
  await ui.evaluate(()=>{__app.N.siteRead=()=>{window.__readStarted=true;};window.__readStarted=false;window.__hangDone=false;KeylessGas.search(34.765,-92.30,8).then(r=>{window.__hangResult=r;__hangDone=true;});});
  await ui.waitForFunction(()=>__osmCalls===2&&__readStarted);   // the reader's deadline is set before the read starts
  await ui.clock.fastForward(46000);
  await ui.waitForFunction(()=>__hangDone);
  assert.match(await ui.evaluate(()=>__hangResult.errors.join(' ')),/timed out/);
  console.log('Actual lookup lifecycle: location/price cache reuse, cooldown, persistent source budget and lost-reply deadline passed');
  await ui.evaluate(()=>{window.__paid=0;window.__xom=async()=>0;__app.S.setupDone=true;__app.N.search=()=>__paid++;__app.S.keylessRegular=true;__app.S.brands={exxon:true};__app.S.apiKey='TEST';__app.S.radiusMi=8;window.KeylessGas.discover=async()=>({stations:[{id:'k',name:'Exxon',brand:'exxon',lat:34.745,lng:-92.29,prices:{regular:{price:3.12,updated:null}},google:true,source:'Google Maps web'}],errors:[],details:[{exhausted:false}]});});
  await require('./onboarding-ui')(ui);
  // Settings form overwrites S, so enable using the actual checkbox and leave the API key installed.
  await ui.click('#btnSettings');await require('./settings-ui')(ui,'map');await ui.check('[data-k="keylessRegular"]');await require('./settings-ui')(ui,'connections');await ui.fill('#apiKey','TEST');await require('./onboarding-ui')(ui);
  await ui.evaluate(()=>__app.fetchAround(34.745,-92.29));
  // Capture one settled frame: the clock-driven map redraw can replace this message between separate reads.
  const discovered=await (await ui.waitForFunction(()=>{const status=document.getElementById('status').textContent,rows=document.getElementById('rows').textContent;return status.includes('Website discovery')&&rows.includes('Exxon')?{status,rows}:false;})).jsonValue();
  assert.equal(await ui.evaluate(()=>__paid),0,'regular nearby mode must never silently consume paid lookups');
  assert.match(discovered.rows,/Exxon/);
  assert.match(discovered.status,/partial/);
  await ui.evaluate(()=>{KeylessGas.discover=async()=>{throw new Error('Google restricted test request');};});
  await ui.evaluate(()=>__app.fetchAround(34.745,-92.29));await ui.waitForFunction(()=>document.getElementById('status').textContent.includes('restricted test'));
  assert.equal(await ui.evaluate(()=>__paid),0,'keyless failure must not invoke a paid fallback');
  await ui.evaluate(()=>{__app.S.grade='premium';});await ui.click('#btnRefresh');await ui.click('[data-refresh="api"]');
  assert.equal(await ui.evaluate(()=>__paid),1,'other grades keep the existing explicitly keyed path');
  await ui.close();
  console.log('320px UI: keyless toggle, nearby results and zero paid Places calls passed');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
