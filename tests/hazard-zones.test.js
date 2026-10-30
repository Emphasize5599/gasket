const assert=require('node:assert/strict'),W=require('../assets/web/routewx.js');
const now=Date.now(),box=(x0,y0,x1,y1)=>({type:'Polygon',coordinates:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]}),county=W.polysOf(box(-121,34,-116,38)),mountains=box(-118.8,35,-117.8,36.5);
const zone='https://api.weather.gov/zones/forecast/CAZ999',feature={type:'Feature',geometry:null,properties:{id:'synthetic-winter',event:'Winter Weather Advisory',severity:'Moderate',onset:new Date(now-3600e3).toISOString(),ends:new Date(now+864e5).toISOString(),description:'Snow above 6000 feet in the mountains.',geocode:{SAME:['006029'],UGC:['CAZ999']},affectedZones:[zone]}};
const dense=[{lat:35.2,lng:-119.2,mi:0,eta:now+3600e3},{lat:35.2,lng:-118.4,mi:5,eta:now+3600e3}];
let zoneCalls=0,fail=false;
async function get(url){
 if(url===zone){zoneCalls++;await new Promise(r=>setTimeout(r,10));return fail?{error:'offline'}:{body:JSON.stringify({type:'Feature',geometry:mountains})};}
 if(url.includes('/alerts/active'))return {body:JSON.stringify({features:[feature]})};
 if(url.includes('/points/'))return {body:JSON.stringify({properties:{forecastHourly:'https://api.weather.gov/gridpoints/TEST/1,1/forecast/hourly'}})};
 if(url.includes('/forecast/hourly'))return {body:JSON.stringify({properties:{periods:[{startTime:new Date(now).toISOString(),endTime:new Date(now+12*3600e3).toISOString(),temperature:65,temperatureUnit:'F',windSpeed:'5 mph',shortForecast:'Sunny',probabilityOfPrecipitation:{value:0}}]}})};
 return {error:'offline'};
}
const opts={stateAt:()=> 'CA',dense,countyOf:()=>county,counties:async()=>{}};
(async()=>{
 const [a,b]=await Promise.all([W.lookup(dense.map(p=>({...p})),get,opts),W.lookup(dense.map(p=>({...p})),get,opts)]);
 assert.equal(zoneCalls,1,'concurrent routes coalesce zone geometry lookups');assert.equal(a.stats.alertZoneErrors,0);
 const stretches=W.alertStretches(dense,a.alerts,opts.countyOf);
 assert.equal(stretches.length,1);assert.equal(stretches[0].fromMi,5,'valley is not under a mountain-only warning in the same county');assert.equal(stretches[0].kind,'snow');assert.equal(stretches[0].areaSource,'NWS zone');
 fail=true;const unavailable=await W.lookup(dense.map(p=>({...p})),get,opts),nearby=W.alertStretches(dense,unavailable.alerts,opts.countyOf);
 assert.equal(unavailable.stats.alertZoneErrors,1);assert.equal(unavailable.stats.alertAreaUncertain,1);assert(nearby.length);
 assert(nearby.every(x=>x.kind==='alert'&&x.areaUncertain),'unverified county vicinity is not claimed to have snowy/icy roads');assert.match(W.advice(nearby[0],{}).join(' '),/exact area could not be verified/);
 assert(!W.advice(nearby[0],{}).join(' ').includes('where and when'),'do not contradict uncertain area advice');
 fail=false;const retry=await W.lookup(dense.map(p=>({...p})),get,opts);assert.equal(retry.stats.alertZoneErrors,0);assert.equal(W.alertStretches(dense,retry.alerts,opts.countyOf)[0].fromMi,5,'failed geometry can recover on the next check');
 const polygon=W.alertOf({...feature,geometry:box(-119.5,35,-119,36)});
 assert.equal(W.alertStretches(dense,[polygon],opts.countyOf)[0].fromMi,0,'explicit warning polygon overrides zone/county');
 const watch=W.alertOf({properties:{...feature.properties,event:'Tornado Watch',affectedZones:[],geocode:{SAME:['006029'],UGC:['CAC029']}}});
 assert.equal(W.alertStretches(dense,[watch],opts.countyOf)[0].kind,'tornado','genuine county alerts retain their footprint');
 const ugcOnly=W.alertOf({properties:{...feature.properties,affectedZones:[]}});assert.deepEqual(ugcOnly.zones,[zone]);
 const unsafe=W.alertOf({properties:{...feature.properties,geocode:{},affectedZones:['https://example.invalid/zones/forecast/CAZ999']}});assert.equal(unsafe.zones.length,0,'only official zone endpoints accepted');
 // The persistent geometry cache must not keep HTML/errors for 30 days.
 const fs=require('node:fs'),vm=require('node:vm'),src=fs.readFileSync('assets/web/tripui.js','utf8');let saved=0,ttl=0,body='<html>temporary error</html>';
 const ctx={wxFlight:new Map(),A:{KV:{get:(ns,key,age)=>{ttl=age;return null;},put:()=>saved++}},call:async()=>({body})};
 vm.runInNewContext(src.slice(src.indexOf('  var wxActive=0'),src.indexOf('  function wxWhen(')),ctx);
 await ctx.wxGet(zone);assert.equal(saved,0);body=JSON.stringify({geometry:mountains});await ctx.wxGet(zone);assert.equal(saved,1);assert.equal(ttl,30*864e5);
 console.log('NWS forecast-zone vs county footprints, concurrent lookups, explicit polygons, UGC fallback and honest unavailable-area warnings passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
