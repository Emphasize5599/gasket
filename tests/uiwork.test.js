const assert=require('node:assert/strict'),W=require('../assets/web/uiwork'),T=require('../assets/web/trip'),P=require('../assets/web/pricing'),G=require('../assets/web/stationstore'),K=require('../assets/web/keylessgas'),R=require('../assets/web/restplaces');
(async()=>{
 let count=0,alive=true;await assert.rejects(W.each(Array.from({length:10000}),()=>{count++;if(count===32)setTimeout(()=>alive=false,0);},()=>alive),/cancelled/);assert(count<=64,'queued input/cancellation runs before another chunk');
 const pts=[{lat:35,lng:-92},{lat:38,lng:-92},{lat:35,lng:-92}],mi=T.hav(pts[0],pts[1]),raw={distanceMeters:mi*2*1609.344,duration:'24000s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:[{distanceMeters:mi*1609.344,duration:'12000s',steps:[]},{distanceMeters:mi*1609.344,duration:'12000s',steps:[]}]},m=T.buildRoute(raw,{});
 assert.deepEqual(await R.cellsForAsync(m,5),R.cellsFor(m,5),'rest-source coverage keeps identical cells and order');
 assert.deepEqual(await G.routeCellsAsync([m],T,P),G.routeCells([m],T,P),'chunking keeps identical discovery coverage and order');
 assert.deepEqual(await K.discoveryPhasesAsync([m],[m],T,P),K.discoveryPhases([m],[m],T,P),'shared primary/alternative cells and metadata remain identical');
 const places=Array.from({length:1000},(_,i)=>({id:'ntad:'+i,name:'Place '+i,kind:'rest_area',lat:35+i*.003,lng:-92+(i%3)*.0001,direction:i%2?'N':'S',amenities:{}}));places.push({...places[100],id:'alias',lat:places[100].lat+.00001},{...places[200],lat:37.9});
 const filter={kinds:['rest_area'],freeOnly:false,radius:5},rows=places.filter(p=>R.check(p,filter).ok).flatMap(p=>T.projectLegs(m,p,5).map(x=>({site:p,d:x.along,offset:x.offset,leg:x.leg}))).sort((a,b)=>a.d-b.d),expected=[];
 let baseline=0;for(const x of rows){if(!expected.some(k=>{baseline++;const distance=T.hav(k.site,x.site);return k.leg===x.leg&&(!k.site.direction||!x.site.direction||k.site.direction===x.site.direction)&&(k.site.id===x.site.id||distance<.05&&k.site.kind===x.site.kind||distance<.2&&k.site.name.toLowerCase()===x.site.name.toLowerCase());}))expected.push(x);}
 const hav=T.hav;let indexed=0;T.hav=(...args)=>{indexed++;return hav(...args);};let actual;try{actual=await R.onRouteAsync(m,places,filter);}finally{T.hav=hav;}
 const signature=rs=>rs.map(x=>[x.site.id,x.d,x.leg]);assert.deepEqual(signature(actual),signature(expected),'spatial dedup preserves same-leg, direction, name and alias decisions');assert(indexed<baseline/10,'distance work is indexed, not a scan of every kept place');
 console.log(JSON.stringify({restCandidates:places.length,baselineDistanceChecks:baseline,indexedDistanceChecks:indexed,cooperativeCancellation:true,discoveryCoverageParity:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
