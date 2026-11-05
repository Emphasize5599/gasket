const assert=require('node:assert/strict'),N=require('../assets/web/overnight');
const H=3600000,t=Date.parse('2026-11-02T08:00:00Z'),c=N.defaults(),m={totalMi:1000,durationSec:20*3600,timeTo:d=>d/50*3600},site=(id,d,extra={})=>({d,offset:0,site:{id,name:id,timeZone:'UTC',parkingHours:'24/7',...extra}});
(async()=>{assert.equal(N.validate(c),null);assert.match(N.validate({...c,minimum:500,preferred:400}),/preferred/i);assert.match(N.validate({...c,preferred:900}),/fit/);assert.match(N.validate({...c,overrides:[{...c,date:'bad'}]}),/date/);
const sites=[site('first',700),site('second',750),site('too-short',730,{stayMinutes:30}),site('forbidden',730,{nonCommercialOvernight:false}),site('closed',720,{hours:'08:00-18:00'})];
const plans=await N.propose(m,sites,c,{start:t,end:t+4*H,zone:'UTC'},null);assert(plans.length);assert.equal(plans[0].rests.length,1);assert.equal(plans[0].choices,2);assert.equal(plans[0].rests[0].duration,480);assert(plans.every(p=>p.rests.every(r=>r.duration>=360&&r.choices.every(x=>!['too-short','forbidden','closed'].includes(x.site.id)))));
assert((await N.propose(m,sites,c,{start:t,end:t,zone:'UTC'},{start:t+27*H,end:t+29*H})).length);assert.equal((await N.propose(m,sites,c,{start:t,end:t,zone:'UTC'},{start:t+20*H,end:t+21*H})).length,0,'final arrival cannot omit overnight dwell');
const multi={totalMi:2500,durationSec:50*3600,timeTo:d=>d/50*3600},many=[700,750,1500,1550,2300,2350].map((d,i)=>site('camp'+i,d));const all=await N.propose(multi,many,c,{start:t,end:t,zone:'UTC'},null);assert(all.length&&all[0].rests.length>=2,'repeat nights on long trips');
const override={...c,overrides:[{date:'2026-11-02',start:'20:00',end:'06:00',minimum:240,preferred:360}]};assert.equal(N.nextWindow(t,'UTC',override).minimum,240);assert.equal(N.nextWindow(t,'UTC',override).preferred,360);
assert.equal(N.nextWindow(Date.parse('2026-11-01T01:00:00Z'),'America/New_York',c).end-N.nextWindow(Date.parse('2026-11-01T01:00:00Z'),'America/New_York',c).start,11*H,'fall DST night is 11 actual hours');assert.equal(N.nextWindow(Date.parse('2027-03-14T01:00:00Z'),'America/New_York',c).end-N.nextWindow(Date.parse('2027-03-14T01:00:00Z'),'America/New_York',c).start,9*H,'spring DST night is 9 actual hours');
const short={totalMi:100,durationSec:7200,timeTo:d=>d*72};assert.equal((await N.propose(short,[],c,{start:t,end:t,zone:'UTC'},null))[0].rests.length,0);await assert.rejects(N.propose(m,sites,c,{start:t,end:t},null,{valid:()=>false}),/cancelled/);console.log('Nightly choice ranking, dwell-inclusive arrival anchors, repeated nights, overrides, hours/access/stay limits, DST and cancellation.');})().catch(e=>{console.error(e);process.exitCode=1;});

// Solar instants stay astronomical across DST; their displayed departure-local clocks shift by the date's rules.
for(const [before,after,jump] of [['2026-10-31','2026-11-01',-60],['2027-03-13','2027-03-14',60]])for(const kind of ['dawn','sunrise','sunriseEnd','sunsetStart','sunset','dusk']){const loc={lat:40.71,lng:-74},a=N.event(before,'America/New_York',{kind},loc),b=N.event(after,'America/New_York',{kind},loc);assert(Math.abs((b-a)/60000-1440)<10,kind+' UTC instant follows the sun across DST');assert(Math.abs(N.local(b,'America/New_York').minute-N.local(a,'America/New_York').minute-jump)<10,kind+' uses departure-local DST');assert.equal(N.local(b,'America/New_York').date,after);}
const az={lat:33.45,lng:-112.07};assert(Math.abs(N.local(N.event('2027-03-14','America/Phoenix',{kind:'dusk'},az),'America/Phoenix').minute-N.local(N.event('2027-03-13','America/Phoenix',{kind:'dusk'},az),'America/Phoenix').minute)<10,'non-DST locations do not get an invented clock change');

const horizon={from:0,to:2500,depart:t,clock:d=>d/50*H,location:()=>({zone:'UTC',point:{lat:35,lng:-90}}),skips:[],deadline:Infinity};
const late=N.trafficHorizon(c,horizon);
assert(late.rests.length>=2,'count successive estimated nights before forecasting later driving');
assert(late.rests.every(r=>r.at===N.windowFor(r.date,'UTC',c,{lat:35,lng:-90}).end),'use latest allowed departures');
const tight=N.trafficHorizon(c,{...horizon,to:1000,deadline:t+21*H});
assert.deepEqual(tight.rests,[],'a minimum rest would make this drive late');
assert.equal(tight.arrival,t+20*H);
assert.equal(tight.skipped.length,1);
const limited=N.trafficHorizon(N.defaults({end:"10:00",arrivalEnd:{kind:"clock",time:"00:00"}}),{...horizon,to:1000,deadline:t+27*H});
assert.equal(limited.rests.length,1);
assert.equal(limited.arrival,t+27*H,'cap the last driving hours at the deadline');
const charging=N.trafficHorizon(c,{...horizon,to:1000,deadline:t+27*H,clock:d=>d/50*H+(d>500?2*H:0)});
assert.deepEqual(charging.rests,[],'known charging dwell reduces the time available for overnight rest');
