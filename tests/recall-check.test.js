const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/web/advisory.js','utf8'),start=source.indexOf('var AUTO_DAYS'),end=source.indexOf('// ---------- features',start);
let car={id:'test',vin:'mock-vin'},reply={error:'Lookup declined',refused:true},reads=0,shown=0,saves=0;
const timers=[],ctx={Date,Number,String,Promise,JSON,host:null,N:{siteRead:true,siteShow:true},LG:{info(){},warn(){}},A:{toast(){}},S:{cars:[car]},VIN_PAGE:'https://www.nhtsa.gov/recalls?vymm=',car:()=>car,days:t=>(Date.now()-t)/864e5,vinCheck:c=>c.recallCheck,save:()=>saves++,changed(){},preRate(){},syncDot(){},draw(){},setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout(){},call:async(name)=>{name==='siteRead'?reads++:shown++;return reply;}};
vm.createContext(ctx);vm.runInContext(source.slice(start,end)+';globalThis.api={autoCheck,checkVin,validCheck};',ctx);
(async()=>{
 ctx.api.autoCheck(car);await Promise.resolve();await Promise.resolve();assert.equal(reads,1);assert.equal(car.recallAuto.needsUser,true);assert.equal(car.recallCheck,undefined);
 car.recallAuto.t-=864e5;ctx.api.autoCheck(car);assert.equal(reads,1,'declined background lookup waits for visible check, not another hidden request');
 for(const r of [{},{open:''},{open:null},{open:false},{open:0,blocked:true},{open:0,error:'failed'},{open:0,refused:true},{open:-1},{open:100}])assert.equal(ctx.api.validCheck(r),false,JSON.stringify(r));
 reply={blocked:true};ctx.api.checkVin(car);await Promise.resolve();assert.equal(car.recallCheck,undefined,'a visible blocked check cannot become zero recalls');
 reply={open:0,campaigns:[]};ctx.api.checkVin(car);await Promise.resolve();assert.equal(car.recallCheck.open,0);assert.equal(car.recallAuto.needsUser,undefined);assert.equal(shown,2);
 ctx.api.autoCheck(car);assert.equal(reads,1,'successful visible result is reused');assert.ok(saves>0);
 console.log('Refused lookup stays unresolved, no silent hidden retry, strict recall counts and visible-check recovery passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
