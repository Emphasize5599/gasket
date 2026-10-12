// Read-only public-area website probe. Stop on restrictions; never use API credentials.
const fs=require('node:fs'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:1280,height:900}});await p.goto('https://www.walmart.com/store-finder',{waitUntil:'domcontentloaded',timeout:30000});
 await p.evaluate(()=>{window.GasketSite={result:(_,json)=>window.__result=JSON.parse(json),progress:()=>{}};});
 const code=fs.readFileSync('assets/walmart_worker.js','utf8');
 await p.evaluate(({code})=>(0,eval)('('+code+')')(1,{mode:'nodes',points:[{lat:34.745,lng:-92.29}],radiusMi:8}),{code});
 let r=await p.evaluate(()=>__result);console.log(JSON.stringify({mode:'nodes',blocked:r.blocked,error:r.error,nodes:r.nodes?.length}));if(r.blocked||r.error||!r.nodes?.length)return;
 await p.evaluate(({code,nodes})=>(0,eval)('('+code+')')(2,{mode:'prices',nodes}),{code,nodes:r.nodes.slice(0,3)});
 r=await p.evaluate(()=>__result);console.log(JSON.stringify({mode:'prices',blocked:r.blocked,error:r.error,stores:(r.stores||[]).map(s=>({id:s.id,grades:s.fuel?.prices?.map(g=>g.name)}))}));
}finally{await b.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
