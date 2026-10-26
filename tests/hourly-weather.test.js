// Exercise the real cached hourly weather pipeline, not a mocked forRoute result.
const assert=require('node:assert/strict'),T=require('../assets/web/trip'),W=require('../assets/web/routewx');
(async()=>{
 const h=3600000,start=Math.floor(Date.now()/h)*h,pts=Array.from({length:6601},(_,i)=>({lat:35+i/6600*6,lng:-92+i/6600*19}));
 const model=T.buildRoute({distanceMeters:1320*1609.344,duration:'79200s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:[]},{city:30,hwy:40,comb:35});
 let stateReads=0,ticks=0;const timer=setInterval(()=>ticks++,1),parsed=new Map();
 const prepared=await W.prepare(model,{stateAt:()=>{stateReads++;return 'AR';}}),geographyReads=stateReads;
 const periods=Array.from({length:168},(_,i)=>({startTime:new Date(start+i*h).toISOString(),endTime:new Date(start+(i+1)*h).toISOString(),shortForecast:i===0?'Clear':'Rain',temperature:60,temperatureUnit:'F',windSpeed:'5 mph',probabilityOfPrecipitation:{value:100}}));
 const hourly=JSON.stringify({properties:{periods}}),point=JSON.stringify({properties:{forecastHourly:'https://api.weather.gov/gridpoints/TEST/1,1/forecast/hourly'}}),empty=JSON.stringify({features:[]}),airBodies=new Map();
 const get=async url=>{if(url.includes('/points/'))return {body:point};if(url.includes('/gridpoints/'))return {body:hourly};if(url.includes('/alerts/'))return {body:empty};if(url.includes('air-quality')){let body=airBodies.get(url);if(!body){const n=new URL(url).searchParams.get('latitude').split(',').length,d={hourly:{time:periods.map(p=>p.startTime),us_aqi:Array(168).fill(20),us_aqi_pm2_5:Array(168).fill(10),us_aqi_ozone:Array(168).fill(10)}};body=JSON.stringify(Array.from({length:n},()=>d));airBodies.set(url,body);}return {body};}throw Error(url);};
 let first,second;
 try{for(let hour=0;hour<12;hour++){const r=await W.forRoute(model,get,{depart:start+hour*h,prepared,parsed,stateAt:()=>{throw Error('Repeated state geometry');}});assert.equal(r.stats.weather,r.stats.points);assert.equal(r.stats.errors,0);assert.equal(r.stats.nwsErrors||0,0);if(hour===0)first=r;if(hour===1)second=r;}}
 finally{clearInterval(timer);}
 assert(ticks>0,'cached weather permits UI/input timers to run');assert.equal(stateReads,geographyReads,'route geography is reused across hours');
 assert.strictEqual(first.temperatures[0].hours,second.temperatures[0].hours,'hourly temperature series is reused');assert(parsed.size>0&&parsed.size<=256);
 assert(first.hazards.find(h=>h.kind==='rain').fromMi>0);assert.equal(second.hazards.find(h=>h.kind==='rain').fromMi,0,'each departure uses its own forecast hour');
 const withStop=await W.forRoute(model,get,{depart:start,stops:[{mi:100,min:15}],prepared,parsed});
 assert(Math.abs(withStop.temperatures[0].mi-first.temperatures[0].mi)<1e-9);assert.equal(withStop.dense.find(p=>p.mi>100).eta-first.dense.find(p=>p.mi>100).eta,15*60000,'cached geography retains stop-aware timing');
 console.log('Long-route cached hourly weather stays responsive, reuses geography/parsed forecasts/temperature series, preserves hourly hazards and stop-aware clocks.');
})().catch(e=>{console.error(e);process.exitCode=1;});
