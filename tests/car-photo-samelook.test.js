// 0.0.421: NHTSA photographs only crash-tested model years. A 2025 Model S borrows the 2021 photo (same exterior),
// labeled with its year; a car with no same-look table entry asks only its own year.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),M=require('../assets/web/carpics');
const source=fs.readFileSync('assets/web/carpics.js','utf8');
function boot(){const asked=[],S={cars:[]},ctx={document:{},Date,Promise,setTimeout,CustomEvent:function(t,o){this.detail=o.detail;},dispatchEvent(){},__app:{S,save(){},KV:{get(){},put(){}}},__trip:{call:async(fn,url)=>{
 if(fn==='fetchJson'&&/api\.nhtsa\.gov\/products\/vehicle\/models/.test(url))return {body:JSON.stringify({results:[{model:'MODEL S'},{model:'MODEL 3'},{model:'CAMRY'}]})};
 if(fn==='fetchJson'&&/byYmmt/.test(url)){const q=new URL(url).searchParams,y=+q.get('modelYear');asked.push(q.get('model')+' '+y);
  return {body:JSON.stringify({results:y===2021&&q.get('model')==='MODEL S'?[{vehiclePicture:'https://static.nhtsa.gov/images/vehicles/15271_st0640_046.png',trim:'5 HB',vehicleModel:'MODEL S'}]:[]})};}
 if(fn==='fetchImage')return {body:'data:image/webp;base64,AAAA'};
 return {error:'offline'};}}};ctx.window=ctx;vm.runInNewContext(source,ctx);return {C:ctx.CarPics,S,asked};}
(async()=>{
 assert.deepEqual(M.sameLookYears({make:'Tesla',model:'Model S Plaid (21in wheels)',year:2025}).slice(0,1),[2021],'the known photo year comes first');
 assert.deepEqual(M.sameLookYears({make:'Tesla',model:'Model X',year:2022})[0],2026);
 assert.deepEqual(M.sameLookYears({make:'Tesla',model:'Model S',year:2026}),[],'a span of one year has nothing to borrow');
 assert.deepEqual(M.sameLookYears({make:'Toyota',model:'Camry',year:2025}),[],'unknown models never borrow another year');
 assert(!M.sameLookYears({make:'Tesla',model:'Model S',year:2015}).includes(2021),'never across a design change');
 const x=boot(),c={id:'s25',year:2025,make:'Tesla',model:'Model S Plaid (21in wheels)',info:{},pic:{wiki:{sig:'x',fail:Date.now()}}};x.S.cars.push(c);
 await x.C.ensure(c);
 assert.equal(c.pic.nhtsa.year,2021);assert.equal(c.pic.nhtsa.sameLook,true);assert.deepEqual(x.asked,['MODEL S 2025','MODEL S 2021'],'own year first, then the known photo year');
 assert.match(x.C.credit(c).text,/NHTSA.*2021 model photo \(same look\)/);
 const y=boot(),cam={id:'cam',year:2025,make:'Toyota',model:'Camry',info:{},pic:{wiki:{sig:'x',fail:Date.now()}}};y.S.cars.push(cam);await y.C.ensure(cam);
 assert.deepEqual(y.asked,['CAMRY 2025'],'no table entry: only its own year is asked');
 console.log('Same-look NHTSA photo years: known photo year first, labeled credit, no borrowing without a table entry');
})().catch(e=>{console.error(e);process.exitCode=1;});
