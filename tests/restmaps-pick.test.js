const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
// 0.0.517: the manual Maps picker opens the coordinates' page, taps Nearby and searches the keywords once
const src=fs.readFileSync(__dirname+'/../assets/restmaps_pick.js','utf8'),java=fs.readFileSync(__dirname+'/../src/com/bensanzone/fuelmap/MainActivity.java','utf8');
assert(java.includes('asset("restmaps_pick.js")'),'native picker runs the Nearby script');
assert(/maps\/search\/%\.6f,%\.6f\?hl=en/.test(java),'native picker opens the raw coordinates');
assert(fs.readFileSync(__dirname+'/../assets/web/restui.js','utf8').includes('query:RestMaps.nearbyQueries(p)[0]'),'the app sends the keywords');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{const p=await b.newPage();
 await p.setContent('<input id="searchboxinput" placeholder="Search Google Maps"><button id="searchbox-searchbutton" aria-label="Search"></button><button aria-label="Directions"></button>');
 await p.evaluate(()=>{window.__searched=[];document.getElementById('searchbox-searchbutton').onclick=()=>__searched.push(document.getElementById('searchboxinput').value);setTimeout(()=>{const n=document.createElement('button');n.setAttribute('aria-label','Nearby');n.onclick=()=>{window.__nearby=(window.__nearby||0)+1;setTimeout(()=>document.getElementById('searchboxinput').setAttribute('placeholder','Search nearby 34°48\'10.3"N'),150);};document.body.append(n);},400);});
 const run=()=>p.evaluate('('+src+')("rest area",5)');
 await run();await p.waitForFunction(()=>__searched.length===1,null,{timeout:8000});
 assert.deepEqual(await p.evaluate(()=>[__nearby,__searched]),[1,['rest area']]);
 await run();await p.waitForTimeout(1200);assert.deepEqual(await p.evaluate(()=>[__nearby,__searched.length]),[1,1],'a reload of the same picker session searches nothing again');
 console.log('Maps picker taps Nearby on the coordinates page and searches the keywords once');}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1);});
