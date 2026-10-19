const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// The networks' own published prices: the shapes their public maps answered with on 2026-10-19 (IONNA's finder page,
// Blink's map service; Tesla's findus fields from a signed-out desktop browser). Generic places only.
function setup(answers){
 const shared=new Map(),calls=[],ctx={Map,Set,Date,Promise,Math,Number,JSON,Object,Array,String,RegExp,Error,isFinite,encodeURIComponent,setTimeout:(f)=>{f();return 0;},clearTimeout(){}};ctx.window=ctx;
 ctx.__app={S:{},N:{},KV:{get:(n,k,age)=>{const o=shared.get(n+'|'+k);return o&&(!age||Date.now()-o.t<=age)?o:null;},put:(n,k,v)=>{shared.set(n+'|'+k,{v:JSON.parse(JSON.stringify(v)),t:Date.now()});return true;}},esc:s=>String(s)};
 ctx.__trip={call:async(fn,...args)=>{calls.push([fn,...args]);return answers(fn,...args);}};
 vm.runInNewContext(fs.readFileSync('assets/web/chargerdata.js','utf8'),ctx);vm.runInNewContext(fs.readFileSync('assets/web/evprices.js','utf8'),ctx);
 return {E:ctx.EVPrices,C:ctx.ChargerData,S:ctx.__app.S,calls,shared};
}
const ionnaPage='<script>\nwindow.allLocations = {"6007":{"title":"Testville, AR Rechargery","status":"open","note":"","price":"<span class=\\"rechargery_price_now\\">$0.39<\\/span>\\/kWh Plus tax","price_updated":null,"speed":"400","lat":"34.7465","lon":"-92.2896"},"6008":{"title":"Soon","status":"soon","note":"Opening Soon","price":"<span class=\\"rechargery_price_now\\">$0.35<\\/span>\\/kWh","lat":"35.2","lon":"-92.5"}};\n</script>';
const flexi=(cost,fee)=>({serviceFee:fee,days:['sunday','monday'].map(day=>({day,parkingSlots:[{start:'12:00 AM',end:'12:00 AM',cost:'$1.00/Hour'}],energySlots:[{start:'12:00 AM',end:'4:00 PM',cost},{start:'4:00 PM',end:'12:00 AM',cost:'$0.45/kWh'}]}))});
(async()=>{
 const {E,C}=setup(()=>({}));
 const ion=E.parseIonna(ionnaPage);assert.equal(ion.length,2);assert.equal(ion[0].rate,.39);assert.equal(ion[0].tax,true);assert.equal(ion[1].open,false,'an Opening Soon site is not a price for a charger you can use');
 const bp=E.parseBlinkPrice(flexi('$0.59/kWh','$0.49/Session'));assert.equal(bp.peak,.59);assert.equal(bp.low,.45);assert.equal(bp.uom,'kwh');assert.equal(bp.fee,.49);assert.equal(bp.parking,1);
 assert.equal(E.parseBlinkPrice(flexi('$0.00/kWh','$0/Session')).low,0);
 // tariff: a network price wins over DOE text; per-minute / per-hour rates become $/kWh at the charger's speed (estimates)
 const st={country:'US',source:'DOE AFDC',pricing:'$0.30 per kWh'};
 let t=C.tariff({...st,netPrice:{rate:.57,uom:'kwh',fee:0,label:'Tesla\'s published non-Tesla rate',src:'tesla'}},.48,150);assert.equal(t.price,.57);assert.equal(t.estimated,false);assert.equal(t.network,'tesla');
 t=C.tariff({...st,netPrice:{rate:.59,uom:'kwh',fee:.49,label:'Blink',src:'blink'}},.48,7);assert.equal(t.price,.59);assert.equal(t.estimated,true,'a session fee is not in the per-kWh figure');
 t=C.tariff({...st,netPrice:{rate:.25,uom:'min',fee:0,label:'Tesla',src:'tesla'}},.48,150);assert.equal(t.price,.125);assert.equal(t.estimated,true);
 t=C.tariff({...st,netPrice:{rate:1,uom:'hour',fee:0,label:'Blink',src:'blink'}},.48,6.25);assert.equal(t.price,.2);
 assert.equal(C.tariff(st,.48,150).price,.3,'no network price: DOE text as before');
 assert.equal(C.routeRates([{st:{...st,netPrice:{rate:.6,uom:'kwh',label:'x rate'}},dc:true},{st:{...st,netPrice:{rate:.5,uom:'kwh',label:'x rate'}},dc:true},{st:{...st,netPrice:{rate:.7,uom:'kwh',label:'x rate'}},dc:true}]).dc,.6,'network prices count toward the route\'s typical rate');

 // annotate: IONNA by distance, Blink site → chargers → flexi price, Tesla through the findus page reader; cached for a day
 const blinkSites={locations:[{l_id:'B1',lat:34.7470,long:-92.2900,open:true}]};
 const answer=(fn,a,b)=>{if(fn==='fetchJson'&&/ionna/.test(a))return {body:ionnaPage};if(fn==='fetchJson'&&/v1\/stations/.test(a))return {body:JSON.stringify(blinkSites)};
  if(fn==='fetchJson'&&/v3\/locations\/B1/.test(a))return {body:JSON.stringify([{level:'LEVEL_2',chargers:[{serialNumber:'SN-1'}]}])};if(fn==='fetchJson'&&/flexi_pricing\?serial_number=SN-1/.test(a))return {body:JSON.stringify(flexi('$0.59/kWh','$0.49/Session'))};
  if(fn==='siteRead'&&a==='tesla'){const q=JSON.parse(b);assert.equal(q.url,'https://www.tesla.com/findus');if(q.mode==='list')return {list:[{lat:34.7001,lng:-92.3001,slug:'testville-sc'}]};return {sites:Object.fromEntries(Object.values(q.slugs).flat().map(id=>[id,{peak:q.tesla?.42:.57,low:q.tesla?.31:.45,uom:'kwh',tou:true,currency:'USD'}]))};}return {error:'unexpected '+fn+' '+a};};
 const z=setup(answer),items=()=>[{st:{id:'i1',network:'IONNA',lat:34.7466,lng:-92.2897},dc:true,kw:400},{st:{id:'b1',network:'Blink',lat:34.7471,lng:-92.2901},dc:false,kw:7},{st:{id:'t1',network:'Tesla Supercharger',lat:34.70,lng:-92.30},dc:true,kw:250},{st:{id:'d1',network:'Tesla Destination',lat:34.70,lng:-92.30},dc:false,kw:11},{st:{id:'x1',network:'Electrify America',lat:34.70,lng:-92.30},dc:true,kw:150}];
 let it=items(),r=await z.E.annotate(it,{make:'Toyota'});assert.equal(r.priced,3);assert.equal(r.notes.length,0,r.notes.join(' '));
 assert.equal(it[0].st.netPrice.rate,.39);assert.match(it[0].st.netPrice.label,/IONNA.*tax/);assert.equal(it[1].st.netPrice.rate,.59);assert.equal(it[1].st.netPrice.fee,.49);
 assert.equal(it[2].st.netPrice.rate,.57,'a non-Tesla pays the non-Tesla rate (peak)');assert.match(it[2].st.netPrice.label,/non-Tesla.*off-peak \$0\.45/);assert.equal(it[3].st.netPrice,undefined,'Destination chargers are not Superchargers');assert.equal(it[4].st.netPrice,undefined,'Electrify America publishes no price signed out');
 // Blink's all-zero glitch: asked again; a charger that only ever answers zero gets no network price (never "free")
 let flips=0;const flaky=setup((fn,a,b)=>/flexi_pricing/.test(a||'')?{body:JSON.stringify(++flips<3?{serviceFee:'$0/Session',days:[{energySlots:[{cost:'$0.00/kWh'}]}]}:flexi('$0.59/kWh','$0.49/Session'))}:answer(fn,a,b));
 it=items();await flaky.E.annotate(it,{make:'Toyota'});assert.equal(it[1].st.netPrice.rate,.59);assert.equal(flips,3);
 const zero=setup((fn,a,b)=>/flexi_pricing/.test(a||'')?{body:JSON.stringify({serviceFee:'$0/Session',days:[{energySlots:[{cost:'$0.00/kWh'}]}]})}:answer(fn,a,b));
 it=items();await zero.E.annotate(it,{make:'Toyota'});assert.equal(it[1].st.netPrice,undefined);assert.equal(zero.calls.filter(c=>/flexi/.test(c[1])).length,3);
 const before=z.calls.length;it=items();await z.E.annotate(it,{make:'Toyota'});assert.equal(z.calls.length,before,'a second trip the same day asks nothing');assert.equal(it[1].st.netPrice.rate,.59);
 const tz=setup(answer);it=items();await tz.E.annotate(it,{make:'Tesla'});assert.equal(it[2].st.netPrice.rate,.42,'a Tesla pays the Tesla-owner rate');
 const off=setup(answer);off.S.evNetPrices=false;assert.equal((await off.E.annotate(items(),{make:'Toyota'})).priced,0);assert.equal(off.calls.length,0,'switched off: no network requests');
 const blocked=setup((fn,a)=>fn==='siteRead'?{blocked:true}:answer(fn,a));r=await blocked.E.annotate(items(),{make:'Toyota'});assert.match(r.notes.join(' '),/asked for a check/);assert.equal(r.priced,2,'a Tesla check never stops the other networks');

 // the Tesla reader itself, on a fake findus page: nearest Supercharger within 250 m, the car's rows, a refusal stops it
 const src=fs.readFileSync('assets/tesla_worker.js','utf8');
 async function worker(args,routes,title='Find Us | Tesla'){let out;const ctx={document:{title,body:{innerText:'Find us'}},GasketSite:{result:(_,s)=>out=JSON.parse(s)},setTimeout:f=>f(),Promise,JSON,Math,isFinite,encodeURIComponent,
   fetch:async u=>{const k=Object.keys(routes).find(p=>u.includes(p));const v=routes[k];return {ok:!!v&&!v.status,status:v&&v.status||200,text:async()=>typeof v==='string'?v:JSON.stringify(v)};}};ctx.window=ctx;await vm.runInNewContext('('+src+')',ctx)(1,args);return out;}
 const routes={'get-locations':{data:{data:[{latitude:34.7001,longitude:-92.3001,location_type:['supercharger'],location_url_slug:'testville-sc'},{latitude:34.7001,longitude:-92.3001,location_type:['destination charger'],location_url_slug:'dest'}]}},
  'get-charger-details':{data:{data:{maxPowerKw:250,openToNonTeslas:true,effectivePricebooks:[{feeType:'CHARGING',vehicleMakeType:'TSLA',rateBase:.42,uom:'kwh',currencyCode:'USD',isTou:true},{feeType:'CHARGING',vehicleMakeType:'TSLA',rateBase:.31,uom:'kwh',currencyCode:'USD',isTou:true},{feeType:'CHARGING',vehicleMakeType:'NTSLA',rateBase:.57,uom:'kwh',currencyCode:'USD',isMemberPricebook:false},{feeType:'CHARGING',vehicleMakeType:'NTSLA',rateBase:.44,uom:'kwh',currencyCode:'USD',isMemberPricebook:true},{feeType:'CONGESTION',vehicleMakeType:'NTSLA',rateBase:.5,uom:'min',currencyCode:'USD'}]}}}};
 let w=await worker({sites:[{id:'t1',lat:34.70,lng:-92.30},{id:'far',lat:35.5,lng:-92.3}],tesla:false},routes);assert.equal(w.matched,1);assert.equal(w.sites.t1.peak,.57,'non-member non-Tesla row, not the member one');assert.equal(w.sites.t1.congestion,.5);assert.equal(w.sites.far,undefined);
 w=await worker({sites:[{id:'t1',lat:34.70,lng:-92.30}],tesla:true},routes);assert.equal(w.sites.t1.peak,.42);assert.equal(w.sites.t1.low,.31);assert.equal(w.sites.t1.tou,true);
 const lw=await worker({mode:'list'},routes);assert.equal(lw.list.length,1,'the list is Superchargers only');assert.equal(lw.list[0].slug,'testville-sc');
 w=await worker({slugs:{'testville-sc':['t1','t1b']},tesla:false},routes);assert.equal(w.sites.t1.peak,.57);assert.equal(w.sites.t1b.peak,.57,'one Supercharger, two DOE records');
 assert.deepEqual(await worker({sites:[{id:'t1',lat:34.7,lng:-92.3}]},routes,'Access Denied'),{blocked:true});
 assert.equal((await worker({sites:[{id:'t1',lat:34.7,lng:-92.3}]},{'get-locations':{status:403}})).blocked,true,'a 403 from Tesla is a check, not an empty answer');
 // ChargePoint: the host's price as its station page writes it; the station's IDs come with DOE's record
 assert.deepEqual({...E.parseChargePoint('Price · Prices Set by NEXCOM · Energy Rate $0.44 / kWh · Ports')},{rate:.44,peak:.44,low:.44,uom:'kwh',fee:0});
 assert.equal(E.parseChargePoint('Prices Set by Testville City · Energy Rate $2.00 / hr · Session Fee $1.00').uom,'hour');assert.equal(E.parseChargePoint('Prices Set by Testville City · Energy Rate $2.00 / hr · Session Fee $1.00').fee,1);
 assert.equal(E.parseChargePoint('Price · Free · Ports').free,true);assert.equal(E.parseChargePoint('Price · Energy Rate $0.30 / kWh 9am-5pm · Energy Rate $0.18 / kWh').low,.18);assert.equal(E.parseChargePoint('Price · Contact host'),null);
 assert.deepEqual([...E.chargePointIds({netIds:{posts:['27029811','27029821']}})],['2702981','2702982','27029811','27029821']);
 const cpPages={'2702981':{text:'Prices Set by NEXCOM · Energy Rate $0.44 / kWh'},'5551':{missing:true},'55512':{text:'Price · Free'}};
 const cp=setup((fn,a,b)=>fn==='siteRead'&&a==='chargepoint'?(cpPages[JSON.parse(b).url.split('/').pop()]||{missing:true}):answer(fn,a,b));
 it=[{st:{id:'c1',network:'ChargePoint',netIds:{posts:['27029811']},lat:34.7,lng:-92.3},dc:false,kw:7},{st:{id:'c2',network:'ChargePoint',netIds:{posts:['55512']},lat:34.7,lng:-92.3},dc:false,kw:7},{st:{id:'c3',network:'ChargePoint',lat:34.7,lng:-92.3},dc:false,kw:7}];
 r=await cp.E.annotate(it,{make:'Toyota'});assert.equal(it[0].st.netPrice.rate,.44);assert.equal(it[1].st.netPrice.free,true,'a missing device form falls back to the post ID');assert.equal(it[2].st.netPrice,undefined,'no IDs, no page read');
 assert.equal(cp.calls.filter(c=>c[1]==='chargepoint').length,3);assert.equal(C.tariff({country:'US',...it[1].st},.48,7).price,0);assert.equal(C.tariff({country:'US',...it[1].st},.48,7).estimated,false,'a host who says Free is free');
 const cpBlocked=setup((fn,a,b)=>fn==='siteRead'&&a==='chargepoint'?{blocked:true}:answer(fn,a,b));r=await cpBlocked.E.annotate(it.map(x=>({...x,st:{...x.st,netPrice:undefined}})),{make:'Toyota'});assert.match(r.notes.join(' '),/ChargePoint.*check/);assert.equal(cpBlocked.calls.filter(c=>c[1]==='chargepoint').length,1,'a check stops further ChargePoint reads');
 // the page reader on a fake station page
 const cpSrc=fs.readFileSync('assets/chargepoint_worker.js','utf8');
 async function cpWorker(text,title='ChargePoint - Station Map',iframe=false){let out;const ctx={document:{title,body:{innerText:text},querySelector:()=>iframe?{}:null},GasketSite:{result:(_,s)=>out=JSON.parse(s)},setTimeout:f=>f(),Date,Promise};ctx.window=ctx;await vm.runInNewContext('('+cpSrc+')',ctx)(1,{});return out;}
 assert.match((await cpWorker('Map | Testville Library | Price | Prices Set by Testville | Energy Rate $0.44 / kWh | Ports')).text,/Energy Rate \$0\.44/);
 assert.equal((await cpWorker('Back | Failed to load station details. Please try again later.')).missing,true);assert.equal((await cpWorker('x','x',true)).blocked,true,'DataDome\'s challenge frame = blocked');
 console.log('Network charger prices: IONNA page, Blink host-set rates and fees, Tesla owner / non-Tesla / time-of-day rates, per-minute conversion, daily cache, off switch, Tesla checks stop only Tesla, ChargePoint host rates by DOE station IDs.');
})().catch(e=>{console.error(e);process.exitCode=1;});
