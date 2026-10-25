const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),M=require('../assets/web/carpics');
const source=fs.readFileSync('assets/web/carpics.js','utf8');
const images={products:[{productFormats:['032','001','014'].map(a=>({code:'color_0640_'+a+'_png',assets:[{url:'https://fixture/'+a,shotCode:{color:{code:'R',oem_name:'Red'}}}]}))}]};
function boot(auth){const calls=[],S={fuelKey:'fixture',cars:[]},ctx={document:{},Date,Promise,setTimeout,CustomEvent:function(t,o){this.detail=o.detail;},dispatchEvent(){},__app:{S,save(){},KV:{get(){},put(){}}},__trip:{call:async(fn,path)=>{assert.equal(fn,'fetchFuel');calls.push(path);if(auth)return {status:401,body:JSON.stringify({message:'Invalid key'})};
 if(path==='modelYears/')return {body:JSON.stringify([{year:'2027'},2021,{modelYear:2023},{name:'2025'},2026,2025])};
 if(path.startsWith('vehicles?')){const q=new URLSearchParams(path.split('?')[1]);assert.equal(q.get('model'),'Model Y');const y=+q.get('year');return {body:JSON.stringify(y===2025?[{id:'250',trim:'Long Range',drivetrain:'RWD'},{id:'251',trim:'Performance',drivetrain:'AWD'}]:y===2023?[{id:'230',trim:'Long Range',drivetrain:'RWD'}]:[])};}
 return {body:JSON.stringify(path.startsWith('vehicle/230?')?images:{products:[]})};}}};ctx.window=ctx;vm.runInNewContext(source,ctx);return {C:ctx.CarPics,S,calls};}
async function load(x,c){x.S.cars.push(c);x.C.loadColors(c);while(x.C.busyColors(c))await new Promise(r=>setImmediate(r));}
const car=()=>({id:'one',year:2026,make:'Tesla',model:'Model Y Long Range RWD',trim:'Long Range',paint:{code:'R'},info:{drive:'rwd'},pic:{nhtsa:{fail:1},wiki:{fail:1}}});
const pg=(title,i)=>({title:'File:'+title,index:i,imageinfo:[{thumburl:'https://fixture/'+i,extmetadata:{Artist:{value:'Photographer'},LicenseShortName:{value:'CC BY-SA 4.0'}}}]});
(async()=>{
 for(const model of ['Model Y Long Range RWD','Model Y Performance AWD','Model Y (Long Range)','Model 3 Long Range AWD','Model S Plaid'])assert.equal(M.fuelModel({make:'Tesla',model}),model.match(/^Model [Y3S]/)[0]);
 assert.deepEqual(M.catalogYears([2027,{year:2025},{modelYear:2023},2025,null,'bad'],2026),[2025,2023]);
 const x=boot(),c=car();await load(x,c);assert.equal(c.pic.fuel.year,2023);assert.equal(c.pic.fuel.vid,'230');assert.equal(c.pic.fuel.trim,'Long Range');assert.equal(x.C.angles(c).join(','),'032,001,014');assert.match(x.C.credit(c).text,/2023 model photo/);
 assert.deepEqual(x.calls.filter(p=>p.startsWith('vehicles?')).map(p=>+new URLSearchParams(p.split('?')[1]).get('year')),[2026,2025,2023],'descending available catalog years, never future or invented years');assert(x.calls.some(p=>p.startsWith('vehicle/251?')),'try another offered trim before an older year');assert.equal(c.year,2026);assert.equal(c.model,'Model Y Long Range RWD');assert.equal(c.trim,'Long Range');
 const count=x.calls.filter(p=>p.startsWith('vehicles?')||p==='modelYears/').length;await load(x,{...car(),id:'two'});assert.equal(x.calls.filter(p=>p.startsWith('vehicles?')||p==='modelYears/').length,count,'catalog requests coalesce across vehicles');
 const denied=boot(true);await load(denied,car());assert.equal(denied.calls.length,1,'an auth failure must not trigger year probes');
 const pages=[pg('2019 Tesla Model Y front.jpg',0),pg('2024 Tesla Model Y front.jpg',1),pg('2025 Tesla Model X front.jpg',2),pg('2026 Tesla Model Y wrecked.jpg',3)],pick=M.wikiPick(pages,c);assert.equal(pick.title,'2024 Tesla Model Y front.jpg');assert(pick.approximate,'a different-year Tesla photo is labeled approximate');assert.equal(M.wikiPick(pages,{year:2026,make:'Tesla',model:'Model 3 Long Range RWD'}),null,'a Model Y is never a Model 3');
 assert.equal(M.wikiPick([pg('2005 Toyota Prius front.jpg',0)],{year:2024,make:'Toyota',model:'Prius'}),null,'generic automatic selection keeps generation protections');
 console.log('Model-only Tesla queries, latest available Fuel images/trims, source-year labels, cache sharing, auth stop, rotation and Commons identity filtering passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
