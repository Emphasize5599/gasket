const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/web/gemma.js','utf8');
async function run(settings,initial){
 const calls=[],timers=[],S={...settings};let state={enabled:initial,supported:true,ready:false,phase:'idle'};
 const ctx={console,Map,Set,Promise,TextEncoder,Event:function(){},document:{getElementById:()=>null,addEventListener(){}},addEventListener(){},dispatchEvent(){},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},__app:{S,N:{aiStatus:()=>JSON.stringify(state),aiCommand(){}},save(){}},__trip:{call:async(_,cmd)=>{calls.push(cmd);if(cmd==='enable')state.enabled=true;return state;}}};ctx.window=ctx;
 vm.runInNewContext(source,ctx);timers.shift()();await new Promise(setImmediate);
 return {calls,S,enabled:ctx.Gemma.status().enabled};
}
(async()=>{
 const old=await run({setupDone:true,onboardingAIInitialized:true},false);assert.deepEqual(old.calls,['enable']);assert.equal(old.enabled,true);assert.equal(old.S.aiDefaultsVersion,2);
 assert.deepEqual((await run({},true)).calls,[],'fresh native default already enabled: no command or download');
 assert.deepEqual((await run({},false)).calls,[],'do not overwrite older explicit native opt-outs without onboarding evidence');
 assert.deepEqual((await run({largerAIChoice:false},false)).calls,[],'explicit opt-out respected');
 assert.deepEqual((await run({aiDefaultsVersion:2},false)).calls,[],'migration never repeats');
 console.log('Reproduced 176 persisted automatic opt-out; default migration once, explicit opt-out preserved, no downloads.');
})().catch(e=>{console.error(e);process.exitCode=1;});
