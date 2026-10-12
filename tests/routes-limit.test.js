const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../assets/web/tripui.js'),'utf8');
const fn=source.match(/async function routesCall\(body\) \{[\s\S]*?\n  \}/)[0];
const make=new Function('A','N','S','call','freshRoutes','return ('+fn+');');
(async()=>{
 let used=9499,sent=0,saved=null;
 const A={KV:{get:()=>saved,put:(_ns,_key,r)=>{saved={v:r};}}},N={routeCallsThisMonth:()=>used},S={routesMonthlyCap:9500,apiKey:'TEST'};
 const call=async(fn,key,body,cap)=>{assert.equal(fn,'computeRoute');assert.equal(cap,9500);sent++;used++;return {body:'{"routes":[]}'};};
 const route=make(A,N,S,call,false);
 assert.equal((await route({origin:'test'})).error,undefined);assert.equal(sent,1);assert.equal(used,9500);
 assert.equal((await route({origin:'test'})).error,undefined,'cached route must remain usable at cap');assert.equal(sent,1);
 saved=null;assert.equal((await route({origin:'other'})).code,'route_cap');assert.equal(sent,1);
 S.routesMonthlyCap=0;
 const unlimited=make(A,N,S,async(fn,key,body,cap)=>{assert.equal(cap,0);sent++;return {body:'{"routes":[]}'};},false);
 await unlimited({origin:'test'});assert.equal(sent,2);
 console.log('Actual Routes adapter: cap boundary, blocked uncached request, cached route at cap and explicit unlimited passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
