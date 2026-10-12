const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/web/pricing.js'),K=require('../assets/web/keylessgas.js');
const gb=1073741824;
for(const [ram,count] of [[0,4],[4,4],[8,6],[12,8],[16,12],[32,12]])assert.equal(K.autoWorkers({totalMem:ram*gb}),count);
assert.equal(K.autoWorkers({totalMem:16*gb,lowMemory:true}),4);
assert.equal(K.readerCount({S:{keylessWorkers:99}}),16);assert.equal(K.readerCount({S:{keylessWorkers:1}}),1);
assert.equal(K.readerCount({S:{},N:{memoryInfo:()=>JSON.stringify({totalMem:12*gb})}}),8);
const native=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8'),pattern=native.match(/key\.matches\("([^"]+)"\)/)[1],allowed=new RegExp('^'+pattern+'$');
K.readerKeys(16).forEach(key=>assert(allowed.test(key)));['gasweb0','gasweb1','gasweb17','gasweb99','gasweb2bad'].forEach(key=>assert(!allowed.test(key)));
assert.match(native,/ActivityManager\.MemoryInfo/);assert.match(native,/public void releaseGasReaders\(/);
async function run(count,discovery){
 const active=new Set(),pending=[],calls=[],cancelled=[],window={document:{},__app:{P,S:{keylessWorkers:count},siteOn:()=>false,N:{cancelSiteRead:k=>cancelled.push(k),releaseGasReaders:()=>{window.released=true;}},KV:{get:()=>null,put:()=>true}},__trip:{call:(fn,key,args)=>{assert.equal(fn,'siteRead');assert(allowed.test(key));assert(!active.has(key));active.add(key);calls.push(key);return new Promise(resolve=>pending.push(r=>{active.delete(key);resolve(r);}));}}};
 vm.runInNewContext(fs.readFileSync('assets/web/keylessgas.js','utf8'),{window,Date,setInterval,clearInterval,setTimeout});
 const known=Array.from({length:30},(_,i)=>({id:'s'+i,name:'Exxon',brand:'exxon',lat:34,lng:-100+i*.2,prices:{}}));
 const task=discovery?window.KeylessGas.discover(known.map(s=>K.area(s.lat,s.lng,8)),null,'regular'):window.KeylessGas.refreshKnown(known,null,[],'regular');
 assert.equal(calls.length,count,'start the configured pool before waiting for responses');
 window.__app.S.keylessWorkers=1;window.KeylessGas.cancel();const result=await task;
 assert(result.cancelled);assert.equal(cancelled.length,count+2,'cancel the starting pool, not a changed setting');assert(window.released,'idle native readers are released after scans');
}
Promise.all([run(16,true),run(16,false),run(1,false)]).then(()=>console.log('RAM defaults, manual 1–16 pools, native key bounds, snapshot cancellation and idle cleanup passed')).catch(e=>{console.error(e);process.exitCode=1;});
