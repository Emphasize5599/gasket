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
 console.log('Batch price cache: station/grade scope, missing and unchanged prices, expiry, shorter preference and explicit refresh passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
