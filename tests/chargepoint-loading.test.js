const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('assets/chargepoint_worker.js','utf8');
async function run(mode){
 let elapsed=0,clicked=0,result;
 const price='Price Prices Set by Example Energy Rate $0.52 / kWh',card={id:'station_card_18009231',innerText:'Example station',querySelector:()=>({innerText:'Example station'}),click:()=>clicked++};
 const body=()=>mode==='http_error'?'Failed to load station details':(mode==='map'&&!clicked||mode==='ambiguous')?'Stations Example station':elapsed<2500?'Loading…':price;
 const frame={getBoundingClientRect:()=>({width:mode==='hidden'?0:300,height:mode==='hidden'?0:200})};
 const ctx={Array,String,Date:{now:()=>100000+elapsed},Promise,getComputedStyle:()=>({visibility:'visible',display:'block'}),setTimeout:(f,ms)=>{elapsed+=ms;f();},GasketSite:{result:(_,s)=>result=JSON.parse(s)},__gasketChargePointHttpStatus:403};ctx.window=ctx;
 ctx.document={title:'ChargePoint',get body(){return {innerText:body()};},querySelector:s=>s==='#slideout_station_details'?(mode==='map'&&!clicked||mode==='ambiguous'?null:{innerText:body()}):s.startsWith('iframe')?(mode==='real_check'||mode==='hidden'||mode==='auto_check'&&elapsed<2000?frame:null):s.startsWith('[id^=')&&(mode==='map'||mode==='ambiguous')?card:null,querySelectorAll:()=>mode==='ambiguous'?[{...card,id:'station_card_111111'}, {...card,id:'station_card_222222'}]:[card]};
 await vm.runInNewContext('('+source+')',ctx)(1,{url:'https://driver.chargepoint.com/stations/18009231',name:'Example station'});return {result,elapsed,clicked};
}
(async()=>{
 for(const mode of ['auto_check','hidden']){const x=await run(mode);assert.equal(x.result.blocked,undefined,mode);assert.match(x.result.text,/0.52/);assert.equal(x.result.diagnostics.httpStatus,403,'a transient subresource error does not force a bot popup');}
 let x=await run('real_check');assert(x.result.blocked);assert(x.elapsed>=8000,'give automatic checks time to clear, then pause for a real user challenge');
 x=await run('http_error');assert.equal(x.result.code,'details_error');assert(!x.result.blocked&&!x.result.missing,'persistent data error is not a CAPTCHA or a nonexistent station');
 x=await run('map');assert.equal(x.clicked,1);assert.match(x.result.text,/0.52/);assert.equal(x.result.diagnostics.clickedCard,true);
 x=await run('ambiguous');assert.equal(x.clicked,0);assert.equal(x.result.code,'timeout','never select an ambiguous nearby station');
 console.log('ChargePoint automatic-check recovery, hidden frames, persistent challenge, HTTP errors and exact station opening passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
