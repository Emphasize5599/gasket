const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('assets/web/tripui.js','utf8'),start=source.indexOf('async function hzPreload()'),end=source.indexOf('async function hzLoad(',start);
(async()=>{let warmed=0;const starts=[],gates=new Map(),route={};const preload=Function('hzWarm','route','hzLegs','hzLoadLeg',source.slice(start,end)+';return hzPreload;')(()=>warmed++,route,()=>5,i=>{starts.push(i);return new Promise(r=>gates.set(i,r));});
 const run=preload();assert.equal(warmed,1);assert.deepEqual(starts,[0,1,2],'later legs start while the first leg is still blocked');
 gates.get(2)();gates.delete(2);await Promise.resolve();await Promise.resolve();assert.deepEqual(starts,[0,1,2,3]);assert.ok(gates.has(0),'first leg has not finished');
 for(let n=0;n<5;n++){for(const [i,r] of gates){gates.delete(i);r();}await Promise.resolve();await Promise.resolve();}await run;assert.deepEqual(starts,[0,1,2,3,4]);
 console.log('Three bounded leg queues prefetch later-leg hazards without waiting for leg 1');
})().catch(e=>{console.error(e);process.exitCode=1;});
