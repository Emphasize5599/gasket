const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
Object.assign(global,{Trip:require('../assets/web/trip'),WindowClock:require('../assets/web/windowclock'),TimeWindows:require('../assets/web/timewindows'),Overnight:require('../assets/web/overnight'),ChargeCurve:require('../assets/web/chargecurve'),Propulsion:require('../assets/web/propulsion')});
const S=require('../assets/web/windowschedule'),H=3600000,M=60000;
const depart=Date.parse('2026-11-12T01:30Z'),zone='America/Chicago',point={lat:35,lng:-90};
const nightly=Overnight.defaults({minimum:420,preferred:480,
 arrivalStart:{kind:'clock',time:'22:00'},arrivalEnd:{kind:'clock',time:'00:00'},
 leaveStart:{kind:'clock',time:'06:00'},leaveEnd:{kind:'clock',time:'08:00'}});
function options(hours=20){return {model:{totalMi:hours*60,legEnds:[hours*60],timeTo:d=>d*60},rewardDepartAt:depart,fuelKind:'gas',stopMinutes:3};}
const plan={stops:[]},location={zone,point,nightly,skips:[]};
for(const hours of [8,18,20,26,40])for(const skies of [false,true])for(const skips of [[],['2026-11-11']]){
 const c=skies?{...nightly,arrivalStart:{kind:'dusk'},leaveEnd:{kind:'sunriseEnd'}}:nightly;
 const parts=S.restParts([{kind:'drive',minutes:hours*60}],depart,location,c,Infinity,skips);
 const actual=S.plannedTimeline(options(hours),plan,[{...location,nightly:c,skips}])[0];
 assert.equal(actual.arrive,depart+parts.reduce((n,p)=>n+p.minutes*M,0),'calendar and final check agree, including solar hours and skipped nights');
 assert.equal(actual.restMinutes,parts.filter(p=>p.kind==='rest').reduce((n,p)=>n+p.minutes,0));
}
const normal=S.plannedTimeline(options(),plan,[location])[0];
assert.equal(normal.restMinutes,480,'use preferred rest instead of a minimum/full-night interval');
const skipped=S.plannedTimeline(options(),plan,[{...location,skips:['2026-11-11']}])[0];
assert.equal(skipped.restMinutes,0,'drive-through reaches final feasibility');
assert.equal(normal.arrive-skipped.arrive,8*H);
const changed={...nightly,overrides:[{date:'2026-11-11',minimum:420,preferred:540}]};
assert.equal(S.plannedTimeline(options(18),plan,[{...location,nightly:changed}])[0].restMinutes,540,'nightly overrides reach final feasibility');
const missed=S.plannedTimeline(options(),plan,[{...location,deadline:depart+21*H}])[0];
assert(missed.missedRests.some(r=>r.why==='deadline'),'an impossible rest remains a conflict');
// Rest time is local to each departing place, even when the device zone differs; DST belongs to the date.
const fall=Date.parse('2026-11-01T00:00Z'),dst={...options(),rewardDepartAt:fall};
assert.equal(S.plannedTimeline(dst,plan,[location])[0].arrive,fall+S.restParts([{kind:'drive',minutes:1200}],fall,location,nightly,Infinity,[]).reduce((n,p)=>n+p.minutes*M,0));
// A later fixed destination departure absorbs the earlier rest once, and stays anchored.
const two={...options(),model:{totalMi:2400,legEnds:[1200,2400],timeTo:d=>d*60},legDepartures:[depart,depart+6*24*H]};
const rows=S.plannedTimeline(two,plan,[location,location]);
assert.equal(rows[1].depart,two.legDepartures[1]);
assert.equal(rows[1].waitMinutes,(rows[1].depart-rows[0].ready)/M);
const immediate=S.plannedTimeline({...two,legDepartures:null},plan,[location,location]);
assert.equal(immediate[1].depart,immediate[0].ready,'immediate onward legs include the earlier rest');
// Actual stop durations, including detours, are placed at their driven position before estimating rests.
const stop={c:{d:180,detourMin:12},buyGal:8},withStop={stops:[stop]};
const actual=S.plannedTimeline(options(),withStop,[location])[0];
const expected=S.restParts([{kind:'drive',minutes:180},{kind:'fuel',minutes:Trip.stopDelay(options(),stop)},{kind:'drive',minutes:1020}],depart,location,nightly,Infinity,[]);
assert.equal(actual.arrive,depart+expected.reduce((n,p)=>n+p.minutes*M,0));
// Exercise the app's real final gate with an arrival window around the displayed itinerary.
const source=fs.readFileSync('assets/web/tripui.js','utf8');
const check=source.slice(source.indexOf('  function windowMiss(timeline)'),source.indexOf('  function windowTimeline(o,p)'));
const sandbox={windows:{arrivals:()=>[{start:normal.arrive-M,end:normal.arrive+M}]},windowDestination:()=>({}),windowNoLeave:()=>null};
vm.createContext(sandbox);vm.runInContext(check,sandbox);
assert.equal(sandbox.windowMiss([normal]),null,'no second rest allowance is added after the shared estimate');
assert.equal(sandbox.windowMiss([missed]).why,'rest');
const ev={kind:'ev',capacity:76,start:76,reserve:7.6,curve:[[0,150],[80,100],[100,20]],maxKw:150,stopMinutes:5,priority:'time'};
const road=[[{minutes:1200,energy:230,chargeTemperature:20}]];
const simple=S.sessions(road,ev)[0],physical=S.sessions(road,{...ev,profile:{kind:'ev',capacity:76,curve:ev.curve,dcKw:150}})[0];
assert(physical.filter(p=>p.kind==='charge').reduce((n,p)=>n+p.minutes,0)>simple.filter(p=>p.kind==='charge').reduce((n,p)=>n+p.minutes,0),'charging losses/thermal limits are included in the green estimate');
assert.equal(physical.filter(p=>p.kind==='drive').reduce((n,p)=>n+p.minutes,0),1200);
assert(S.sessions(road,{...ev,fillCap:76*.6})[0].filter(p=>p.kind==='charge').length>simple.filter(p=>p.kind==='charge').length,'charging cap changes the estimate');
console.log('Calendar/final consistency: preferred rests, skip/override/solar/DST, actual stops, return anchors and EV charging passed');
