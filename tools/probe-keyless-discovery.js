// Read-only public-area smoke test. No API key, accounts, challenge bypass or private coordinates.
const fs=require('node:fs'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{
 const p=await b.newPage({viewport:{width:1280,height:900}}),route=process.argv.includes('--route');
 const url=route?(process.argv.includes('--avoid')?'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=Arkansas+State+Capitol,+Little+Rock,+AR&destination=North+Little+Rock+City+Hall,+AR&avoid=tolls':'https://www.google.com/maps/dir/Arkansas+State+Capitol,+Little+Rock,+AR/North+Little+Rock+City+Hall,+AR/'):'https://www.google.com/maps/search/gas+stations/@34.74500,-92.29000,13z?hl=en';
 await p.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
 const restricted=await p.evaluate(()=>/unusual traffic|before you continue|access denied|not a robot/i.test(document.body.innerText));if(restricted){console.log('Visible site restriction; stopped.');return;}
 await p.evaluate(()=>{window.GasketSite={result:(_,json)=>window.__result=JSON.parse(json)};});
 await p.evaluate(({code,args})=>(0,eval)('('+code+')')(1,args),{code:fs.readFileSync(route?'assets/gmaps_worker.js':'assets/gasweb_worker.js','utf8'),args:{mode:'discover',grade:'regular'}});
 const result=await p.evaluate(()=>window.__result);
 if(route){const T=require('../assets/web/trip.js');console.log(JSON.stringify({blocked:result.blocked,error:result.error,routes:(result.routes||[]).map(r=>{let mi=0;for(let i=1;i<(r.pts||[]).length;i++)mi+=T.hav({lat:r.pts[i-1][0],lng:r.pts[i-1][1]},{lat:r.pts[i][0],lng:r.pts[i][1]});return {miles:r.miles,minutes:r.minutes,points:r.pts?.length,geometryRatio:r.miles?mi/r.miles:null};})}));}
 else console.log(JSON.stringify({blocked:result.blocked,error:result.error,stations:result.stores?.length,details:result.detail}));
}finally{await b.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
