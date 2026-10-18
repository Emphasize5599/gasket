// Slow and fast connections, simulated in virtual time (no network, no waiting). Every website reader shares one
// link and the phone's CPU: a page needs its megabytes through the link (shared equally by the pages loading) and then
// its rendering on one of CORES cores (shared when more pages render than cores). A page not done DEADLINE_S after it
// started fails like the phone's "Search response timed out", and the bytes and work it used are lost. Page sizes and
// rendering vary by area. The phone has plenty of memory and the aggressive setting, so only the connection limits it.
// Compares the adaptive reader cap with 0.0.185's pool (memory alone) and with every fixed reader count.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/web/pricing.js');
const source=fs.readFileSync(require.resolve('../assets/web/keylessgas.js'),'utf8');
const CORES=8,DEADLINE_S=26,AREAS=150;
const oldPool=source.replace('return Math.min(poolTarget(state,sample,now,lanes.length,state.aggressive),net.cap);','return poolTarget(state,sample,now,lanes.length,state.aggressive);');
assert.notEqual(oldPool,source,'the 0.0.185 pool switch still matches keylessgas.js');

async function scan(mbps,readers,src,cpuS=4){
  let now=1e12,seq=0,rnd=12345;const timers=[],pages=[];
  const rand=()=>(rnd=(rnd*1103515245+12345)%2147483648)/2147483648;
  class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
  const setT=(fn,ms)=>{const t={at:now+Math.max(0,ms||0),fn,id:++seq};timers.push(t);return t;};
  const clearT=t=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);};
  const setI=(fn,ms)=>{const t={id:++seq};t.at=now+ms;t.fn=()=>{fn();t.at=now+ms;timers.push(t);};timers.push(t);return t;};
  let timedOut=0,loads=0,peak=0;
  const memoryInfo=()=>JSON.stringify({totalMem:16e9,availMem:8e9,lowMemory:false});
  const window={document:{},__app:{P,S:{keylessWorkers:readers,keylessAggressive:true},siteOn:()=>false,showSiteCheck:()=>{},KV:{get:()=>null,put:()=>{}},N:{memoryInfo}},
    __trip:{call:(fn,key,json)=>new Promise(resolve=>{loads++;pages.push({resolve,mb:1.2+rand()*1.2,cpu:cpuS*(1+rand()),start:now,lat:JSON.parse(json).url.match(/@([\d.-]+),/)[1]});peak=Math.max(peak,pages.length);})}};
  vm.runInNewContext(src,{window,Date:Clock,setTimeout:setT,clearTimeout:clearT,setInterval:setI,clearInterval:clearT});
  const K=window.KeylessGas,areas=Array.from({length:AREAS},(_,i)=>({lat:30+i*.2,lng:-92,radius:8}));
  let done=false;const task=K.discover(areas,null,'regular',true);task.then(()=>done=true);
  const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
  for(let guard=0;!done;guard++){
    assert(guard<3e6,'simulation runs away');await flush();if(done)break;
    const loading=pages.filter(p=>p.mb>0),rendering=pages.filter(p=>!(p.mb>0)),net=mbps/8/Math.max(1,loading.length),cpu=Math.min(1,CORES/Math.max(1,rendering.length));
    let next=Infinity;timers.forEach(t=>next=Math.min(next,t.at));
    pages.forEach(p=>next=Math.min(next,p.start+DEADLINE_S*1000,now+(p.mb>0?p.mb/net:p.cpu/cpu)*1000));
    assert(next<Infinity,'nothing left to happen');
    const dt=(next-now)/1000;
    pages.forEach(p=>{if(p.mb>0){if(now+p.mb/net*1000<=next+1e-3)p.mb=0;else p.mb-=net*dt;}else if(now+p.cpu/cpu*1000<=next+1e-3)p.cpu=0;else p.cpu-=cpu*dt;});
    now=next;
    for(const p of [...pages]){
      if(!(p.mb>0)&&!(p.cpu>0)){pages.splice(pages.indexOf(p),1);p.resolve({stores:[{placeId:'p'+p.lat,name:'Exxon',brand:'exxon',lat:+p.lat,lng:-92,prices:{regular:{price:3}}}],detail:{exhausted:true,stopReason:'end'}});}
      else if(now>=p.start+DEADLINE_S*1000){pages.splice(pages.indexOf(p),1);timedOut++;p.resolve({stores:[],error:'Search response timed out',code:'reader'});}
    }
    for(const t of timers.filter(t=>t.at<=now)){clearT(t);t.fn();}
  }
  const r=await task;
  return {min:(now-1e12)/60000,found:new Set(r.stations.map(s=>s.placeId)).size,timedOut,loads,peak};
}

(async()=>{
  const lines=[],fmt=x=>x.min.toFixed(1).padStart(5)+' min '+String(x.found).padStart(3)+' areas '+String(x.timedOut).padStart(4)+' timeouts';
  for(const [mbps,cpuS] of [[6,4],[12,4],[50,4],[200,4],[12,8],[200,8]]){
    const adaptive50=await scan(mbps,50,source,cpuS),adaptive20=await scan(mbps,20,source,cpuS),old50=await scan(mbps,50,oldPool,cpuS),old20=await scan(mbps,20,oldPool,cpuS);
    let best=null;for(const n of [4,6,8,10,12,16,20,24,32]){const x=await scan(mbps,n,oldPool,cpuS);if(x.found===AREAS&&(!best||x.min<best.min))best={...x,n};}
    const row=(mbps+' Mbps, '+cpuS*1.5+' s pages');lines.push(row.padEnd(21)+'| adaptive 50: '+fmt(adaptive50)+' | adaptive 20: '+fmt(adaptive20)+' | 0.0.185 50: '+fmt(old50)+' | 0.0.185 20: '+fmt(old20)+' | best fixed ('+best.n+'): '+best.min.toFixed(1)+' min');
    for(const [name,x] of [['adaptive 50',adaptive50],['adaptive 20',adaptive20]]){
      assert.equal(x.found,AREAS,row+', '+name+': every area read');
      assert(x.min<=best.min*1.2,row+', '+name+': within 20% of the best fixed count ('+x.min.toFixed(1)+' vs '+best.min.toFixed(1)+' min with '+best.n+')');
      assert(x.timedOut<=AREAS*0.1,row+', '+name+': few timeouts ('+x.timedOut+')');
    }
    assert(adaptive50.min<old50.min,row+': faster than 0.0.185 with 50 readers ('+adaptive50.min.toFixed(1)+' vs '+old50.min.toFixed(1)+')');
    assert(adaptive20.min<=old20.min*1.1,row+': not slower than 0.0.185 with 20 readers ('+adaptive20.min.toFixed(1)+' vs '+old20.min.toFixed(1)+')');
  }
  console.log('Simulated '+AREAS+'-area discovery:\n'+lines.join('\n'));
  console.log('Slow-link simulation passed');
})().catch(e=>{console.error(e);process.exit(1);});
