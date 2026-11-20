const assert=require('node:assert/strict'),K=require('../assets/web/restweatherchart');
const H=3600000,start=Date.parse('2030-06-01T20:30Z'),end=start+6*H;
const hours=[0,1,2,3,4,5].map(i=>({at:start+i*H,end:start+(i+1)*H,temp:60+i*3,feels:i===2?null:58+i*3,pop:i*10,wind:5+i,gust:i>3?20:null,humidity:50,uv:null}));
const data={start,end,hours,air:[{at:start,end:start+3*H,aqi:40,current:true}],pollen:[{at:start-H,end:start+11*H,name:'Tree pollen',value:2,max:5,category:'Low'}]};
assert.deepEqual(K.available(data).map(m=>m.id),['temp','pop','wind','humidity','aqi','pollen'],'UV has no values, so no UV chart');
for(const m of K.METRICS){const c=K.chart(data,{width:300,metric:m.id,selectedAt:start+1.5*H});assert.match(c.svg,/^<svg[\s\S]*<\/svg>$/);assert(!/NaN|undefined/.test(c.svg),m.id+' has no NaN/undefined');}
const t=K.chart(data,{width:300,metric:'temp',selectedAt:start+1.5*H});assert.match(t.svg,/linearGradient/,'temperature line uses the temperature gradient');assert.match(t.svg,/wx-line2/,'feels-like drawn dashed');
assert.equal((K.chart(data,{width:300,metric:'temp'}).svg.match(/class="wx-line wx-line2" d="(M[^"]*)"/)[1].match(/M/g)||[]).length,2,'a missing feels-like hour breaks the line instead of joining across it');
const cx=+t.svg.match(/data-wx-cursor x1="([\d.]+)"/)[1];assert(Math.abs(cx-t.x(start+1.5*H))<.1,'cursor at the selected time');assert(t.x(start-H)===t.x(start)&&t.x(end+H)===t.x(end),'x is clamped to the stay');
assert.equal(K.readout(data,'temp',start+.5*H),'60° · feels like 58°');assert.equal(K.readout(data,'aqi',start),'40 AQI (now)');assert.equal(K.readout(data,'pollen',start),'Tree Low');assert.equal(K.readout(data,'uv',start),'No forecast');
assert.match(K.chart({start,end,hours:[],air:[],pollen:[]},{width:300,metric:'pop'}).svg,/No precipitation forecast/);
assert(K.tempColor(20)!==K.tempColor(100));
console.log('Weather charts: available metrics, every chart type, gradient, gaps, cursor, clamping, readouts and empty state passed.');
