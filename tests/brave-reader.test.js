const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),T=require('../assets/web/trims.js');
const source=fs.readFileSync('assets/brave_worker.js','utf8');
async function run({title='',text='',ai='',bg=true,kind='trims'}){let now=0,result;const ctx={document:{title,body:{innerText:text},querySelectorAll:()=>ai?[{innerText:ai}]:[]},TrimMath:T,GasketSite:{result:(_,s)=>result=JSON.parse(s)},Date:{now:()=>now},setTimeout:f=>{now+=500;f();},Promise};ctx.window=ctx;const fn=vm.runInNewContext('('+source+')',ctx);await fn(1,kind==='tank'?{year:2020,bg}:{kind:'trims',year:2024,make:'Toyota',model:'Corolla Hybrid',bg});return result;}
(async()=>{
 assert.deepEqual(await run({title:'Captcha - Brave Search'}),{blocked:true},'real locally observed challenge title');
 const text='Answer with "Trims:" then each trim name, separated by commas. The 2024 Toyota Corolla Hybrid has three trim levels: LE, SE, XLE.';
 assert.deepEqual(await run({text}),{text:'Trims: LE, SE, XLE',src:'results'},'no AI summary: query echo is not the answer');
 assert.deepEqual(await run({ai:'The 2024 Toyota Corolla Hybrid has three trim levels: LE, SE, XLE. AI-generated answer',text:'Search results'}),{text:'Trims: LE, SE, XLE',src:'ai'});
 assert.deepEqual(await run({text:'Trims: LE, SE, XLE.'}),{text:'Trims: LE, SE, XLE',src:'results'},'list at offset zero');
 assert((await run({text:'Answer with "Trims:" then each trim name, separated by commas.'})).error,'query-only pages are not successes');
 // tank size: the tank's figure, not a reserve / warning-light one that comes first (a 2020 Sienna read as 4 gal)
 let r=await run({kind:'tank',ai:'With about 4 gallons left, the low fuel warning light comes on in the 2020 Toyota Sienna LE, which has a fuel tank capacity of 20 gallons. AI-generated answer',text:'Search results'});
 assert.equal(r.gal,20,'the capacity, not the warning-light amount: '+JSON.stringify(r));assert.match(r.text,/20 gallons/);
 r=await run({kind:'tank',ai:'The 2020 Toyota Sienna LE has a 20-gallon fuel tank. AI-generated answer',text:'Search results'});assert.equal(r.gal,20);
 console.log('Actual Brave reader: CAPTCHA, natural AI summary, results-only/offset-zero list, echoed-query rejection, tank figure over a warning-light one.');
})().catch(e=>{console.error(e);process.exitCode=1;});
