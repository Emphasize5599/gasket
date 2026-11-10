const assert=require('node:assert/strict');
Object.assign(global,{
 WindowClock:require('../assets/web/windowclock'),
 Overnight:require('../assets/web/overnight'),
 TimeWindows:require('../assets/web/timewindows'),
 Trip:require('../assets/web/trip'),
 ChargeCurve:require('../assets/web/chargecurve')
});
const S=require('../assets/web/windowschedule'),H=3600000,M=60000;
const start=Date.parse('2030-11-03T23:30:00Z'), zone='America/Chicago';
const leg={zone,estimate:()=>[{kind:'drive',minutes:60}]};
const blocked=[{from:'17:00',to:'20:00',night:'2030-11-03'}];
const row=S.run(leg,start,blocked);
assert.equal(row.departure,Date.parse('2030-11-04T02:00:00Z'));
assert.deepEqual(row.parts.map(p=>p.kind),['wait','drive']);
assert.equal(row.end,row.departure+H);
const windows={ds:start,de:row.departure,as:row.end,ae:row.end+M};
assert(S.fits(row,windows,null,null));
assert(!S.fits(row,{...windows,ds:row.departure},null,null));
assert(!S.fits(row,{...windows,de:row.departure-M},null,null));
assert(!S.fits(row,windows,null,{start:row.end+M,departure:row.end+M}));
const sample=S.run(leg,start+S.step,[]);
assert.equal(sample.end-(start+H),S.step);
const later=start+40*24*H;
assert.equal(S.place(leg,{ds:later,de:later+H},start,start,[]).departure,later+S.step,'a stale visual placement yields to a new window');
assert.equal(S.place(leg,{de:later},start,null,[]).departure,later,'a latest-only departure anchors the calendar');
assert.equal(S.place(leg,{as:later,ae:later+H},start,null,[]).end,later,'the estimate moves to an earliest arrival when the window allows it');
assert.deepEqual(S.issues(row,windows,{start:row.end-M,departure:row.end},start),['overlaps the next leg.','has a latest arrival that reaches or passes the next leg’s departure.']);
const ev={kind:'ev',capacity:70,start:70,reserve:7,curve:[[0,150],[80,100],[100,20]],maxKw:150,stopMinutes:5};
const trip=[[{minutes:450,energy:150}]];
const charging=S.sessions(trip,{...ev,priority:'time'})[0];
assert.equal(charging.filter(p=>p.kind==='charge').length,2);
assert(Math.abs(charging.filter(p=>p.kind==='drive').reduce((n,p)=>n+p.minutes,0)-450)<1e-6);
assert.notDeepEqual(charging,S.sessions(trip,{...ev,priority:'cost'})[0]);
const fuel=S.sessions([[{minutes:60,energy:4}],[{minutes:90,energy:6}]],{kind:'gas',capacity:10,start:10,reserve:2,stopMinutes:3});
assert(!fuel[0].some(p=>p.kind==='fuel'));
assert(fuel[1].some(p=>p.kind==='fuel'),'fuel remaining carries across legs');
const nightStart=Date.parse('2030-11-03T17:00Z');
const prefs=Overnight.defaults({minimum:360,preferred:480});
const drive=[{kind:'drive',minutes:18*60}],where={zone:'UTC',point:{lat:30,lng:-90}};
assert.equal(S.restParts(drive,nightStart,where,prefs,Infinity).filter(p=>p.kind==='rest')[0].minutes,480);
{const tight=S.restParts(drive,nightStart,where,prefs,nightStart+19*H),red=tight.find(p=>p.kind==='norest');
 assert(red&&red.why==='deadline','a rest that would miss the latest arrival shows red instead of vanishing');
 assert.equal(tight.filter(p=>p.kind==='drive').reduce((n,p)=>n+p.minutes,0),drive[0].minutes,'driving is unchanged');
 assert(!tight.some(p=>p.kind==='rest'));
 const roomy=S.restParts(drive,nightStart,where,prefs,nightStart+25.5*H).find(p=>p.kind==='rest');
 assert(roomy&&roomy.shortened&&roomy.minutes>=prefs.minimum&&roomy.minutes<prefs.preferred,'a tighter deadline shortens the rest first');
 const w=Overnight.nextWindow(nightStart,'UTC',prefs,where.point),late=w.end-7*H;
 const leaving=S.restParts(drive,late,where,prefs,Infinity),dep=leaving.find(p=>p.kind==='norest');
 assert(dep&&dep.why==='depart','leaving during rest hours shows red');
 assert(S.issues(S.run({zone:'UTC',estimate:()=>leaving},late,[]),{},null,0).some(x=>/nightly rest hours/.test(x)));
 assert(!S.restParts(drive,late,where,prefs,Infinity,[dep.night]).some(p=>p.kind==='norest'),'drive through clears it');
 // Sweeping the start across a day never drops a night without a rest, a red night or a drive-through.
 for(const after of [Infinity,19*H,24*H,26*H])for(let s=nightStart-17*H;s<nightStart+7*H;s+=15*M){
  const out=S.restParts(drive,s,where,prefs,s+after),seen=new Set(out.filter(p=>p.night).map(p=>p.night));
  let t=s;const spans=out.map(p=>{const r={...p,start:t,end:t+p.minutes*M};t=r.end;return r;});
  for(let x=s-24*H,k=0;k<4;k++){const n=Overnight.nextWindow(x,'UTC',prefs,where.point);if(!n)break;x=Math.min(n.arrivalEnd,n.end-n.minimum*M)+1;
   const restAt=Math.min(n.arrivalEnd,n.end-n.preferred*M);
   const driving=spans.some(p=>p.kind==='drive'&&p.start<n.end-n.minimum*M&&p.end>restAt);
   if(driving&&t>n.end-n.minimum*M)assert(seen.has(n.date),'night '+n.date+' handled for start '+new Date(s).toISOString()+' deadline +'+after/H+'h');}
 }}
const estimated=S.restParts(drive,nightStart,where,prefs,Infinity),night=estimated.find(p=>p.kind==='rest').night;
const skipped=S.restParts(drive,nightStart,where,prefs,Infinity,[night]);
assert.equal(skipped.find(p=>p.kind==='skip-rest').night,night);
assert(!skipped.some(p=>p.kind==='rest'));
assert.equal(skipped.reduce((n,p)=>n+p.minutes,0),drive[0].minutes);
assert.deepEqual(S.restParts(drive,nightStart,where,prefs,Infinity,[]),estimated);
// A charging stop running at the planned rest time pushes the rest later instead of dropping it.
{const plain=S.restParts(drive,nightStart,where,prefs,Infinity),restAt=plain.find(p=>p.kind==='rest');
 const before=plain[0].minutes,w=Overnight.nextWindow(nightStart,'UTC',prefs,where.point);
 const charged=[{kind:'drive',minutes:before-30},{kind:'charge',minutes:60},{kind:'drive',minutes:18*60-(before-30)}];
 const shifted=S.restParts(charged,nightStart,where,prefs,Infinity),rest=shifted.find(p=>p.kind==='rest');
 assert(rest,'the rest is kept after the charge');
 assert.equal(rest.night,restAt.night);
 assert(rest.shifted);
 const restStart=nightStart+shifted.slice(0,shifted.indexOf(rest)).reduce((n,p)=>n+p.minutes*M,0);
 assert.equal(restStart,nightStart+(before+30)*M,'it starts when the charge ends');
 assert.equal(rest.minutes,Math.min(prefs.preferred,(w.end-restStart)/M),'it keeps the preferred length up to the latest rest departure');
 assert(restStart+rest.minutes*M<=w.end);
 // A charge ending so late that less than the minimum rest fits: no rest, shown red until driven through.
 const lateEnd=w.end-(prefs.minimum-30)*M,lateMin=(lateEnd-nightStart)/M-(before-30);
 const late=[{kind:'drive',minutes:before-30},{kind:'charge',minutes:lateMin},{kind:'drive',minutes:600}];
 const missed=S.restParts(late,nightStart,where,prefs,Infinity);
 assert(!missed.some(p=>p.kind==='rest'&&p.night===restAt.night),'no rest that night');
 const red=missed.find(p=>p.kind==='norest');
 assert.equal(red.night,restAt.night);assert(red.toggleNight);
 assert.equal(missed.filter(p=>p.kind!=='norest').reduce((n,p)=>n+p.minutes,0),late.reduce((n,p)=>n+p.minutes,0),'nothing else changes');
 const row=S.run({zone:'UTC',estimate:()=>missed},nightStart,[]);
 assert.deepEqual(row.missed,[{night:restAt.night,why:'stop'}]);
 const flagged=S.issues(row,{},null,0);
 assert(flagged.some(t=>/no room to rest on the night of/.test(t)),'the problem shows above Save');
 const red2=row.parts.find(p=>p.kind==='norest');
 assert.equal(red2.until,w.end,'the red stretch runs to the latest rest departure');
 // Driving through that night resolves it.
 const through=S.restParts(late,nightStart,where,prefs,Infinity,[restAt.night]);
 assert(!through.some(p=>p.kind==='norest'));
 assert(through.some(p=>p.kind==='skip-rest'&&p.night===restAt.night));
 assert.deepEqual(S.run({zone:'UTC',estimate:()=>through},nightStart,[]).missed,[]);}
console.log('Schedule windows, local no-leave wait, preferred rest, charging curve and fuel carryover passed');
