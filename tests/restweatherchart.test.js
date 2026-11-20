const assert=require('node:assert/strict'),K=require('../assets/web/restweatherchart');
const H=3600000,start=Date.parse('2030-06-01T20:00Z'),end=start+6*H,zone='America/Chicago';
const hours=[0,1,2,3,4,5].map(i=>({at:start+i*H,end:start+(i+1)*H,temp:60+i*3,feels:i===2?null:58+i*3,pop:i*10,qpf:.01*i,wind:5+i,gust:i>3?20:null,humidity:50,uv:null}));
const data={start,end,hours,air:[{at:start,end:start+3*H,aqi:40}],pollen:[{at:start-H,end:start+11*H,name:'Tree pollen',value:2,max:5,category:'Low'}]};
assert.deepEqual(K.available(data).map(m=>m.id),['temp','pop','wind','humidity','aqi','pollen'],'no UV values, so no UV chart');
// y scales: breathing room for temperature, floors and minimum ceilings for zero-based quantities
let d=K.domain(K.metric('temp'),[60,75]);assert(d.lo<60&&d.hi>75&&d.ticks.every(t=>t>=d.lo&&t<=d.hi));
d=K.domain(K.metric('wind'),[2,4]);assert.equal(d.lo,0);assert(d.hi>=10,'a calm stay still reads as calm');
d=K.domain(K.metric('uv'),[1,2]);assert.deepEqual([d.lo,d.ticks],[0,[0,3,6,8,11]]);assert(d.hi>=11);
d=K.domain(K.metric('pop'),[5]);assert.deepEqual([d.lo,d.hi,d.ticks],[0,100,[0,50,100]]);
d=K.domain(K.metric('temp'),[70,70]);assert(d.hi>d.lo,'flat line still has a range');
// local-clock x ticks
let x=K.xTicks(start,end,zone,false);assert.deepEqual(x.ticks.map(t=>t.label),['3 PM','4 PM','5 PM','6 PM','7 PM','8 PM','9 PM'],'short stay: every hour, local time');assert.equal(x.days.length,0);
x=K.xTicks(start,start+24*H,zone,true);assert(x.ticks.every(t=>/^(00|06|12|18)$/.test(t.label)),'a day: every 6 h, 24-hour clock');assert.equal(x.days.length,1,'one local midnight');
x=K.xTicks(start,start+60*H,zone,false);assert(x.ticks.some(t=>t.strong&&/^[A-Z][a-z]{2}$/.test(t.label)),'multi-day: midnight shows the weekday');assert(x.ticks.every(t=>t.strong||/12 PM/.test(t.label)),'multi-day: only midnight and noon');
// summaries and readouts
assert.deepEqual(K.summary(data,K.metric('temp'),zone).map(s=>s.label+' '+s.value),['Arrive 60°','Low 60°','High 75°','Avg 68°']);
assert.deepEqual(K.summary(data,K.metric('pop'),zone).map(s=>s.label+' '+s.value),['Peak 50%','Total 0.15 in']);
let r=K.readout(data,K.metric('temp'),1,zone,false,'actual');assert.equal(r.value,'63°');assert.equal(r.caption,'4 PM');assert.equal(r.detail,'Feels like 61° · 10% rain');
r=K.readout(data,K.metric('temp'),1,zone,false,'feels');assert.equal(r.value,'61°');assert.match(r.detail,/^Actual 63°/);
assert.equal(K.readout(data,K.metric('temp'),2,zone,false,'feels').value,'—','missing feels-like stays missing');
assert.equal(K.readout(data,K.metric('wind'),4,zone,false).detail,'Gusts 20 mph');assert.equal(K.readout(data,K.metric('aqi'),0,zone,false).detail,'Good');
assert.equal(K.readout({...data,end:start+30*H},K.metric('temp'),0,zone,false,'actual').caption,'Sat 3 PM','long stays name the day');
assert.deepEqual(K.summary(data,K.metric('pollen'),zone),[],'no number summary for pollen');assert.equal(K.nearest(hours,start+2.4*H),2);assert(K.tempColor(20)!==K.tempColor(100));
console.log('Weather charts: available metrics, scale floors/ceilings, local-clock ticks, summaries, readouts and nearest-hour snapping passed.');
