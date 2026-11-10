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
assert.deepEqual(S.restParts(drive,nightStart,where,prefs,nightStart+19*H),drive);
console.log('Schedule windows, local no-leave wait, preferred rest, charging curve and fuel carryover passed');
