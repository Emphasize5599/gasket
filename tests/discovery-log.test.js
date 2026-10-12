// The debug log of a website discovery scan: where the time went, in entries that fit the log.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/web/pricing.js'),K=require('../assets/web/keylessgas.js');

// the report from per-area records
const d=(elapsedMs,lastGrowthMs,stopReason,read)=>({elapsedMs,lastGrowthMs,stopReason,read,scrolls:4,firstFeedMs:900,priced:read>>1});
const rep=K.discoveryReport([
  {i:0,lane:0,at:0,ms:20000,d:d(17000,5000,'stalled',40),found:30,added:30},
  {i:1,lane:1,at:0,ms:10000,d:d(8000,7000,'end',40),found:30,added:10},
  {i:2,lane:0,at:20000,ms:4000,cache:true,found:30,added:0},
  {i:3,lane:1,at:10000,ms:15000,err:'Keyless lookup timed out',found:0,added:0}],
  {elapsedMs:25000,areas:4,lanes:2,stations:40,priced:20,officialMs:3000,errors:[]});
assert.equal(rep.cached,1);assert.equal(rep.done,4);
assert.equal(rep.laneUse,+(45000/50000).toFixed(2),'busy share of every lane over the whole scan');
assert.equal(rep.tailMs,15000,'after the last area started');
assert.equal(rep.pageLoadMs.total,3000+2000,'whole read minus the reader\'s own time');
assert.equal(rep.afterLastRowMs.total,12000+1000,'waiting after the last new row');
assert.deepEqual(rep.stops,{stalled:1,end:1,cache:1,error:1});
assert.equal(rep.rowsRead,80);assert.equal(rep.overlap,+(1-40/80).toFixed(2));
assert.equal(rep.areasAddingNothing,2);

// a whole scan: started, progress, finished, and the per-area table in entries that fit (2,000 characters at DEBUG)
(async()=>{
  const logs=[],areas=Array.from({length:120},(_,i)=>K.area(34+i*.05,-92,8));areas.plan={routeMi:720,sampled:121,merged:1,spacingMi:6,radiusMi:8};
  let t=0;
  const window={document:{},FLog:{info:(a,m,x)=>logs.push(['INFO',m,x]),debug:(a,m,x)=>logs.push(['DEBUG',m,x])},
    __app:{P,S:{keylessWorkers:4},siteOn:()=>false,N:{memoryInfo:()=>JSON.stringify({totalMem:12*2**30,availMem:5*2**30})},KV:{get:()=>null,put:()=>true}},
    __trip:{call:async(fn,key,args)=>{const a=JSON.parse(args);const m=/@(-?[\d.]+),(-?[\d.]+)/.exec(a.url)||[];t++;
      return {stores:[{id:'web:'+t,featureId:'0x'+t+':0x1',name:'Exxon',lat:+m[1]||34,lng:+m[2]||-92,prices:{regular:{price:3.1,updated:null}}}],
        detail:{read:20,priced:12,exhausted:true,stopReason:'end',scrolls:3,elapsedMs:4000,firstFeedMs:800,firstReplyMs:900,lastGrowthMs:3500,replies:4}};}}};
  vm.runInNewContext(fs.readFileSync('assets/web/keylessgas.js','utf8'),{window,Date,setInterval,clearInterval,setTimeout,Promise});
  await window.KeylessGas.discover(areas,null,'regular',true);
  const names=logs.map(l=>l[1]);
  assert.equal(names[0],'Discovery started');assert.equal(logs[0][2].plan.routeMi,720);assert.equal(logs[0][2].lanes,4);assert.equal(logs[0][2].mem.availMB,5120);
  assert.equal(names.filter(n=>n==='Discovery progress').length,2,'every 50 areas');
  const fin=logs.find(l=>l[1]==='Discovery finished')[2];
  assert.equal(fin.done,120);assert.equal(fin.stops.end,120);assert.equal(fin.rowsRead,2400);assert.ok(fin.laneUse>=0&&fin.laneUse<=1.5,fin.laneUse);
  const tables=logs.filter(l=>/^Discovery areas/.test(l[1]));
  assert.equal(tables.reduce((a,l)=>a+l[2].rows.length,0),120,'every area in the table');
  tables.forEach(l=>assert.ok(JSON.stringify(l[2]).length<2000,'fits a DEBUG entry: '+JSON.stringify(l[2]).length));
  assert.equal(JSON.stringify(tables[0][2].rows[0].slice(7,10)),JSON.stringify(['end',3,20]));
  // low on memory: readers past the first four step back (logged), and every area still gets done by the rest
  const logs2=[],win2={document:{},FLog:{info:(a,m,x)=>logs2.push([m,x]),debug:()=>{}},
    __app:{P,S:{keylessWorkers:8},siteOn:()=>false,N:{memoryInfo:()=>JSON.stringify({totalMem:8*2**30,availMem:500*2**20}),releaseGasReaders:()=>{win2.released=(win2.released||0)+1;}},KV:{get:()=>null,put:()=>true}},
    __trip:{call:async()=>({stores:[],detail:{read:0,stopReason:'quiet',elapsedMs:10}})}};
  vm.runInNewContext(fs.readFileSync('assets/web/keylessgas.js','utf8'),{window:win2,Date,setInterval,clearInterval,setTimeout,Promise});
  await win2.KeylessGas.discover(areas.slice(0,40),null,'regular',true);
  const stepped=logs2.filter(l=>l[0]==='Low memory: a website reader steps back');
  assert.equal(stepped.length,4,'readers 5-8 step back');assert.ok(win2.released>=4,'their pages are freed');
  assert.equal(logs2.find(l=>l[0]==='Discovery finished')[1].done,40,'the first four finish every area');
  console.log('Discovery log: report math, start/progress/finish entries and a '+tables.length+'-entry area table that fits passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
