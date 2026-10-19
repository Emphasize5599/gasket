// The offline charger download's task row: status replies that come back late or out of order never move the bar back,
// and none puts the row back after the download ends (it sat at "96965 / 96965 99%" on the phone).
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 let tick=null,finish,statusQ=[];const rows=new Map(),seen=[];
 const ctx={Map,Set,Date,Promise,Math,Number,JSON,URLSearchParams,setTimeout:()=>{},setInterval:(f)=>{tick=f;return 1;},clearInterval:()=>{tick=null;}};ctx.window=ctx;ctx.addEventListener=()=>{};ctx.L={GridLayer:{extend:()=>function(){}}};
 ctx.Tasks={upsert:(k,o)=>{rows.set(k,o);if(o.frac!=null)seen.push(o.frac);},remove:k=>rows.delete(k)};
 ctx.__app={S:{},N:{chargerInventory(){}},P:{},KV:{get:()=>null,put:()=>true},map:{},esc:s=>String(s)};
 ctx.__trip={call:(fn,act)=>new Promise(r=>{if(act==='download')finish=r;else statusQ.push(r);})};
 for(const f of ['altfuel','chargerdata'])vm.runInNewContext(fs.readFileSync('assets/web/'+f+'.js','utf8'),ctx);
 const flush=()=>new Promise(r=>setImmediate(r)),p=ctx.ChargerData.download('DEMO_KEY');await flush();
 tick();tick();await flush();assert.equal(statusQ.length,1,'one status read at a time');
 const slow=statusQ.shift();tick();await flush();assert.equal(statusQ.length,0);
 slow({busy:true,received:50000,expected:96965});await flush();tick();await flush();
 statusQ.shift()({busy:true,received:30000,expected:96965});await flush();   // an older count
 assert.equal(Math.min(...seen.slice(1).map((f,i)=>f-seen[i])) >= 0,true,'never back: '+seen.join());
 tick();await flush();const late=statusQ.shift();
 finish({count:96965,updated:Date.now()});await p;assert.equal(rows.has('charger-inventory'),false);
 late({busy:true,received:96965,expected:96965});await flush();assert.equal(rows.has('charger-inventory'),false,'a late reply does not bring the row back');
 console.log('Charger download progress: monotonic, one read at a time, gone when done');
})().catch(e=>{console.error(e);process.exitCode=1;});
