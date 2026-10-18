const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),T=require('../assets/web/trims.js');
const source=fs.readFileSync('assets/brave_worker.js','utf8');
async function run({title='',text='',ai='',bg=true,kind='trims',url=''}){let now=0,result;const ctx={document:{title,body:{innerText:text},querySelectorAll:()=>ai?[{innerText:ai}]:[]},TrimMath:T,GasketSite:{result:(_,s)=>result=JSON.parse(s)},Date:{now:()=>now},URLSearchParams,location:url?new URL(url):undefined,setTimeout:f=>{now+=500;f();},Promise};ctx.window=ctx;const fn=vm.runInNewContext('('+source+')',ctx);await fn(1,kind==='tank'?{year:2020,bg}:kind==='spare'?{kind:'spare',bg}:{kind:'trims',year:2024,make:'Toyota',model:'Corolla Hybrid',bg});return result;}
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
 // Ask Brave (/ask): no "AI-generated answer" block; the chat text after the echoed question, once steady
 const q='2020 Toyota Sienna LE fuel tank capacity in gallons?',url='https://search.brave.com/ask?q='+encodeURIComponent(q)+'&source=llmSuggest';
 r=await run({kind:'tank',url,text:'Ask Brave New chat '+q+' The 2020 Toyota Sienna LE has a 20-gallon fuel tank. Sources Follow-up: How far can it go on a full tank?'});
 assert.equal(r.gal,20,JSON.stringify(r));assert.equal(r.src,'ai');assert.equal(r.ask,true);
 r=await run({kind:'tank',url,text:'Ask Brave '+q+' Thinking...'});assert(!r.gal,'the echoed question alone is no answer: '+JSON.stringify(r));
 r=await run({url:'https://search.brave.com/ask?q='+encodeURIComponent('What are all the trim levels of the 2024 Toyota Corolla Hybrid? Answer with "Trims:" then each trim name, separated by commas.'),text:'What are all the trim levels of the 2024 Toyota Corolla Hybrid? Answer with "Trims:" then each trim name, separated by commas. Trims: LE, SE, XLE'});
 assert.deepEqual(r,{text:'Trims: LE, SE, XLE',src:'ai'});
 // the spare question names every answer: its echo alone (still "Thinking") is never the answer, even in another case
 const sq='Does the 2020 Toyota Sienna LE gas come with a spare tire as standard? Only this version. Start with: Full-size spare, Compact spare, Repair kit, Run-flat tires, or No spare. Then Location: inside or under vehicle. Say if a spare is optional or can be added (size).';
 const surl='https://search.brave.com/ask?q='+encodeURIComponent(sq)+'&source=llmSuggest';
 r=await run({kind:'spare',url:surl,text:'Ask Brave '+sq.toUpperCase().slice(0,60)+sq.slice(60)+' Thinking...'});
 assert(r.error&&!r.text,'echo only: '+JSON.stringify(r));
 r=await run({kind:'spare',url:surl,text:'Ask Brave '+sq+' Compact spare. The 2020 Sienna LE has a compact spare under the vehicle.'});
 assert.equal(r.src,'ai');assert.match(r.text,/^Compact spare/);assert.doesNotMatch(r.text,/Run-flat|No spare/,JSON.stringify(r));
 console.log('Actual Brave reader: CAPTCHA, natural AI summary, results-only/offset-zero list, echoed-query rejection, tank figure over a warning-light one, Ask Brave chat answers.');
})().catch(e=>{console.error(e);process.exitCode=1;});
