// The VIN barcode scanner in the car editor: a fake camera shows a Code 39 VIN label (the real ZXing reader decodes
// it), lengthwise and standing upright like a door jamb label; the VIN goes in the box and is looked up; the camera
// stops; a refused camera says so; phone Back closes it. 320 / 448 px, 130% text, no horizontal scroll.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const VIN='1M8GDM9AXKP042788';   // the textbook check-digit example, not a real car's
// a QR link for the tiny-code case, made here with ZXing's writer: its dots as rows of 0/1
const Z=require('../assets/web/lib/zxing.min.js'),qm=new Z.QRCodeWriter().encode('https://vin.example.test/d?vin='+VIN,Z.BarcodeFormat.QR_CODE,0,0,new Map()),QR=[];
for(let y=0;y<qm.getHeight();y++){let row='';for(let x=0;x<qm.getWidth();x++)row+=qm.get(x,y)?1:0;QR.push(row);}
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME||undefined});try{for(const [width,big] of [[320,true],[448,false]]){
 const p=await b.newPage({viewport:{width,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(pathToFileURL(path.resolve('assets/web/index.html')).href);await p.evaluate(()=>__app.S.setupDone=true);await require('./onboarding-ui')(p);await p.evaluate(fs.readFileSync('tests/trip_mocks.js','utf8'));
 if(big)await p.addStyleTag({content:'html{font-size:130%}'});
 await p.evaluate(()=>{
  const AL='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%',EN=[0x034,0x121,0x061,0x160,0x031,0x130,0x070,0x025,0x124,0x064,0x109,0x049,0x148,0x019,0x118,0x058,0x00D,0x10C,0x04C,0x01C,0x103,0x043,0x142,0x013,0x112,0x052,0x007,0x106,0x046,0x016,0x181,0x0C1,0x1C0,0x091,0x190,0x0D0,0x085,0x184,0x0C4,0x0A8,0x0A2,0x08A,0x02A];
  // a Code 39 label as bar widths (narrow 1, wide 3), the way a VIN sticker prints it
  window.__bars=t=>{const out=[];('*'+t+'*').split('').forEach(c=>{const e=c==='*'?0x094:EN[AL.indexOf(c)];for(let i=8;i>=0;i--)out.push({w:(e>>i)&1?3:1,bar:(8-i)%2===0});out.push({w:1,bar:false});});return out;};
  window.__camera=(text,upright)=>{const c=document.createElement('canvas');c.width=720;c.height=1280;const g=c.getContext('2d'),bars=__bars(text),len=bars.reduce((s,x)=>s+x.w,0);
   const paint=()=>{g.fillStyle='#fff';g.fillRect(0,0,720,1280);g.fillStyle='#000';let at=(upright?1280:720)/2-len/2;bars.forEach(x=>{if(x.bar){if(upright)g.fillRect(260,at,200,x.w);else g.fillRect(at,540,x.w,200);}at+=x.w;});};
   paint();const s=c.captureStream(15);window.__paint=setInterval(paint,60);window.__stream=s;return s;};
  window.__camMode='flat';navigator.mediaDevices.getUserMedia=async()=>{if(__camMode==='denied')throw new DOMException('denied','NotAllowedError');if(__camMode==='qr')return __qrCamera();return __camera('I'+'1M8GDM9AXKP042788',__camMode==='upright');};
  // a tiny QR in the middle (about 1.5 px a dot), on a camera that says it can zoom and focus on a point
  window.__qrCamera=()=>{const c=document.createElement('canvas');c.width=720;c.height=1280;const g=c.getContext('2d'),q=__QR,d=1.5,n=q.length*d;
   const paint=()=>{g.fillStyle='#fff';g.fillRect(0,0,720,1280);g.fillStyle='#000';q.forEach((row,y)=>[...row].forEach((b,x)=>{if(b==='1')g.fillRect(360-n/2+x*d,640-n/2+y*d,d,d);}));};
   paint();const s=c.captureStream(15);window.__paint=setInterval(paint,60);window.__stream=s;window.__applied=[];const t=s.getVideoTracks()[0];
   t.getCapabilities=()=>({zoom:{min:1,max:8,step:0.1},focusMode:['continuous','single-shot']});t.applyConstraints=c=>{__applied.push(c);return Promise.resolve();};return s;};
  const original=__app.N.fetchJson;__app.N.fetchJson=(id,url)=>{if(url.includes('DecodeVinValuesExtended')){window.__vinUrl=url;window.__vinId=id;return;}original(id,url);};
 });
 await p.evaluate(q=>{window.__QR=q;},QR);
 await p.click('#btnTrip');await p.click('[data-car="+"]');await p.waitForSelector('#gVinScan');
 // a square twin of Look up between the VIN box and it; a bit more room above the EPA / custom selector; no horizontal scroll
 const g=await p.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),box=r('#gVin'),scan=r('#gVinScan'),go=r('#gVinGo'),seg=r('#gEntryMode'),row=r('.vin-row');
  return {order:box.right<=scan.left&&scan.right<=go.left,square:Math.abs(scan.width-scan.height)<1,sameH:Math.abs(scan.height-go.height)<1,primary:document.getElementById('gVinScan').classList.contains('primary'),gap:seg.top-row.bottom,wide:document.documentElement.scrollWidth>innerWidth};});
 assert(g.order&&g.square&&g.sameH&&g.primary&&g.gap>=10&&!g.wide,'scan button placement '+JSON.stringify(g));
 // the eye and the field's (?) share the box's right end without overlapping
 assert(await p.evaluate(()=>{const r=e=>e.getBoundingClientRect(),eye=r(document.getElementById('gVinEye')),q=document.querySelector('.vin-box .qi');if(!q)return true;const qr=r(q);return eye.right<=qr.left+0.5||qr.right<=eye.left+0.5;}),'eye and (?) overlap');
 // one rounded identity tile down to the trim, in either mode (and for a custom car known by its VIN)
 const tile=()=>p.evaluate(()=>{const t=document.querySelector('details.epa.ymm');return t&&{title:t.querySelector('summary').childNodes[0].textContent,round:parseFloat(getComputedStyle(t).borderRadius)>=12,trim:!!t.querySelector('#gTrimSel,#gTrim'),open:t.open,count:document.querySelectorAll('#gTrimSel,#gTrim').length};});
 for(const mode of ['custom','epa']){await p.click('[data-entry="'+mode+'"]');await p.waitForSelector(mode==='custom'?'#gCustom':'#tEpa');const t=await tile();
  assert(t&&t.title==='Year / make / model / trim'&&t.round&&t.trim&&t.open,mode+' tile '+JSON.stringify(t));}
 for(const mode of ['flat','upright']){
  await p.evaluate(m=>{window.__camMode=m;window.__vinUrl=null;document.getElementById('gVin').value='';},mode);
  await p.click('#gVinScan');await p.waitForSelector('.vin-scan video');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'scanner fits');
  await p.waitForFunction(()=>!!window.__vinUrl,null,{timeout:15000});
  assert.equal(await p.inputValue('#gVin'),VIN,mode+': the VIN is in the box');assert(await p.evaluate(v=>__vinUrl.includes(v),VIN),mode+': and looked up');
  assert.equal(await p.locator('.vin-scan').count(),0,'the scanner closed');
  assert.equal(await p.evaluate(()=>{clearInterval(__paint);return __stream.getVideoTracks()[0].readyState;}),'ended','the camera stopped');
  await p.evaluate(()=>onNativeResult(__vinId,{error:'test: no NHTSA here'}));await p.waitForFunction(()=>!document.querySelector('#gVinGo').disabled);
 }
 // a tiny QR code in the center square: read (the square is enlarged); zoom offered, focus set on the square
 await p.evaluate(()=>{window.__camMode='qr';window.__vinUrl=null;document.getElementById('gVin').value='';});
 await p.click('#gVinScan');await p.waitForSelector('.vin-scan .vs-zoom:not(.hidden)');
 const fx=await p.evaluate(()=>__applied.find(c=>c.advanced&&c.advanced[0].focusMode));assert.deepEqual(fx.advanced[0],{focusMode:'single-shot',pointsOfInterest:[{x:0.5,y:0.5}]},'focus on the square');
 await p.waitForFunction(()=>!!window.__vinUrl,null,{timeout:15000});assert.equal(await p.inputValue('#gVin'),VIN,'the tiny QR link resolved to the VIN');
 await p.evaluate(()=>{clearInterval(__paint);onNativeResult(__vinId,{error:'test: no NHTSA here'});});await p.waitForFunction(()=>!document.querySelector('#gVinGo').disabled);
 // waiting for the camera (the permission prompt): plain black, only Close
 await p.evaluate(()=>{window.__gum=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=()=>new Promise(()=>{});});await p.click('#gVinScan');await p.waitForSelector('.vin-scan');
 assert.deepEqual(await p.evaluate(()=>['.vs-frame','.vs-hint','video'].map(s=>getComputedStyle(document.querySelector('.vin-scan '+s)).visibility).concat(document.querySelector('.vs-msg').textContent,getComputedStyle(document.querySelector('.vin-scan')).backgroundColor)),['hidden','hidden','hidden','','rgb(0, 0, 0)']);
 await p.click('.vs-close');await p.evaluate(()=>{navigator.mediaDevices.getUserMedia=__gum;});
 // a refused camera says what to do; phone Back closes the scanner, not the editor
 await p.evaluate(()=>{window.__camMode='denied';});await p.click('#gVinScan');await p.waitForSelector('.vin-scan .vs-msg.err');
 assert.match(await p.innerText('.vs-msg'),/needs the camera.*type the VIN/i);
 assert.equal(await p.evaluate(()=>window.onBack()),true);assert.equal(await p.locator('.vin-scan').count(),0);assert.equal(await p.locator('.car-edit').count(),1,'the editor stays');
 assert(!(await p.evaluate(()=>FLog.entries().map(e=>e.m+(e.d||'')).join(' '))).includes(VIN),'the VIN is never logged');
 assert.equal(errors.length,0,errors.join('\n'));await p.close();
}console.log('VIN barcode scanner: lengthwise and upright labels read, looked up, camera stopped; refusal and Back handled');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
