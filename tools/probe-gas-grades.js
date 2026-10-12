// Diagnostic: public Maps pages, no API key. Never continue through a restriction.
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:1280,height:900}});
 if(process.argv.includes('--murphy')){
  await p.goto('https://service.murphydriverewards.com/mapmodule/',{waitUntil:'domcontentloaded',timeout:30000});
  const info=await p.evaluate(async()=>{if(/captcha|access denied|robot/i.test(document.body.innerText))return {blocked:true};const r=await fetch('/api/store',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({latitude:34.745,longitude:-92.29,range:5,pageSize:25})});const t=await r.text();if(!r.ok||t[0]!=='{')return {status:r.status,blocked:/captcha|access denied|robot/i.test(t)};const j=JSON.parse(t);return {status:r.status,keys:Object.keys(j),gradeLabels:Array.from(new Set((JSON.stringify(j).match(/"fuelType"\s*:\s*"[^"]+"/g)||[])))};});
  console.log(JSON.stringify(info));return;
 }
 const labels=[];
 p.on('response',async r=>{if(!/google\.com\/search\?.*tbm=map/.test(r.url()))return;try{const t=await r.text();labels.push(...(t.match(/\$\d{1,2}\.\d{2,3}[^"\n]{0,70}/g)||[]).slice(0,80));}catch(_){}});
 await p.goto('https://www.google.com/maps/search/gas+stations/@34.74500,-92.29000,13z?hl=en',{waitUntil:'domcontentloaded',timeout:30000});
 await p.waitForFunction(()=>document.querySelector('[role="feed"]')||/unusual traffic|before you continue|access denied/i.test(document.body.innerText),{timeout:20000});
 const info=await p.evaluate(()=>({blocked:/unusual traffic|before you continue|access denied/i.test(document.body.innerText),lines:document.body.innerText.split('\n').filter(s=>/\$|Regular|Midgrade|Premium|Diesel/i.test(s)).slice(0,60),link:document.querySelector('[role="feed"] a[href*="/maps/place/"]')?.href}));
 console.log(JSON.stringify({blocked:info.blocked,lines:info.lines,searchLabels:labels}));
 if(info.blocked||!info.link)return;
 await p.goto(info.link,{waitUntil:'domcontentloaded',timeout:30000});
 await p.waitForFunction(()=>document.querySelector('h1')||/unusual traffic|before you continue/i.test(document.body.innerText),{timeout:15000});
 console.log(JSON.stringify(await p.evaluate(()=>({detailLabels:document.body.innerText.split('\n').filter(s=>/\$|Regular|Midgrade|Premium|Diesel/i.test(s)).slice(0,60),fuelButtons:Array.from(document.querySelectorAll('button')).map(b=>b.getAttribute('aria-label')||b.innerText).filter(s=>/fuel|price/i.test(s))}))));
}finally{await b.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
