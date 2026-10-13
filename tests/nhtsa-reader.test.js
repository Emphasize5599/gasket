const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('assets/nhtsa_worker.js','utf8');
async function read(text,value){let answer,now=0;const ctx={GasketSite:{result:(id,json)=>answer=JSON.parse(json)},document:{title:'Recall lookup',body:{innerText:text},querySelectorAll:()=>value==null?[]:[{id:'vin',value}]},Date:{now:()=>now+=1000},setTimeout:f=>{f();}};vm.createContext(ctx);await vm.runInContext('('+code+')',ctx)(1,{url:'https://www.nhtsa.gov/recalls?vymm=mock-vin',bg:true});return answer;}
(async()=>{
 assert.equal((await read('0Unrepaired Recalls Found','mock-vin')).open,0);
 assert.equal((await read('2 Unrepaired Recalls Found\n11V123000\n12V456000','mock-vin')).campaigns.length,2);
 assert.equal((await read('0 Unrepaired Recalls Found','another-car')).open,undefined,'stale different-VIN result is not recorded');
 assert.equal((await read('You will see the message: "0 unrepaired recalls associated with this VIN"')).open,undefined,'help text is not a result');
 assert.equal((await read('An unknown error occurred')).refused,true);
 assert.equal((await read('Verify you are human')).blocked,true);
 console.log('NHTSA reader: valid counts, stale-VIN/help rejection and explicit restriction/failure results passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
