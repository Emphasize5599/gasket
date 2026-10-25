const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),P=require('../assets/web/pricing');
(async()=>{
 let now=Date.now(),loads=0;const cache=new Map();class Clock extends Date{static now(){return now;}}
 const window={document:{},__app:{P,S:{staleHours:24,keylessWorkers:4},siteOn:()=>false,KV:{get:(ns,k,age)=>{const r=cache.get(ns+'|'+k);return r&&(!age||now-r.t<=age)?r:null;},put:(ns,k,v)=>cache.set(ns+'|'+k,{t:now,v})}},__trip:{call:async()=>{loads++;return {stores:[]};}}};
 vm.runInNewContext(fs.readFileSync('assets/web/keylessgas.js','utf8'),{window,Date:Clock,console,setTimeout,clearTimeout,setInterval,clearInterval});
 const K=window.KeylessGas,known=[{id:'old-pump',brand:'exxon',lat:35,lng:-92,prices:{regular:{price:3.2,updated:now-25*3600000}}},{id:'unknown',brand:'exxon',lat:36,lng:-92,prices:{}}];
 assert(known.every(s=>K.needsPriceRefresh(s,'regular',24)));
 const first=await K.refreshKnown(known,null,[],'regular');assert.equal(first.updated,0);assert(loads>0);const original=JSON.stringify(known);
 now+=20*60000;assert(known.every(s=>!K.needsPriceRefresh(JSON.parse(JSON.stringify(s)),'regular',24)),'another car and changed target grouping reuse station checks after the old 15-minute area cache expires');
 assert.equal(JSON.stringify(known),original,'check timestamps do not rewrite source price times');assert(!P.priceFresh(known[0].prices.regular,24,now));
 assert(K.needsPriceRefresh(known[0],'premium',24),'checks are grade specific');
 const before=loads;await K.refreshKnown(known,null,[],'regular');assert(loads>before,'an explicit refresh can still query the website');
 now+=2*3600000;assert(known.every(s=>K.needsPriceRefresh(s,'regular',1)),'a shorter global freshness preference is respected');
 now+=23*3600000;assert(known.every(s=>K.needsPriceRefresh(s,'regular',24)),'successful checks expire');
 // The phone's reader marks every refresh reply partial (search results, not a catalog); 0.0.267 recorded no checks from
 // those, so an 18-minute-old refresh read all 889 expired prices again. A page that loaded counts; one that didn't, doesn't.
 const shape={limited:{stores:[],partial:true,code:'limited',error:null},none:{stores:[],partial:true,code:'no_prices',error:'Google provided no matching regular prices; existing prices are retained'},unread:{stores:[],partial:true,code:'unreadable',error:'Google gas results could not be read'}};
 assert(K.priceChecked(shape.limited)&&K.priceChecked(shape.none)&&!K.priceChecked(shape.unread)&&!K.priceChecked({blocked:true})&&!K.priceChecked({cancelled:true}));
 for(const [name,reply,checked] of [['limited',shape.limited,true],['no_prices',shape.none,true],['unreadable',shape.unread,false]]){
  cache.clear();window.__trip.call=async()=>reply;const st=[{id:'real-'+name,brand:'exxon',lat:37,lng:-92,prices:{regular:{price:3.1,updated:Date.now()-30*24*3600000}}}];
  await K.refreshKnown(st,null,[],'regular');now+=16*60000;
  assert.equal(!K.needsPriceRefresh(st[0],'regular',24),checked,name+' reply '+(checked?'records':'does not record')+' a check');}
 assert.equal(K.skipRefresh(),false,'nothing to skip when no remembered-cell refresh runs');
 console.log('Batch price cache: station/grade scope, missing and unchanged prices, expiry, shorter preference and explicit refresh passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
