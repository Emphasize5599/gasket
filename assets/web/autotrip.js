/* Bounded-memory parameter search; no speed changes or reserve-floor changes. */
(function(root){'use strict';
 function objective(car,fallback,windowPriority){var p=car&&car.planningPriority;if(!/^(cost|time)$/.test(p||''))p=/^(cost|time)$/.test(windowPriority||'')?windowPriority:car&&car.autoTripPriority;return /^(cost|time)$/.test(p||'')?p:fallback==='time'?'time':'cost';}
 function enabled(car,fallback){return car&&typeof car.autoTripEnabled==='boolean'?car.autoTripEnabled:/^(cost|time)$/.test(car&&car.autoTripPriority||fallback||'');}
 function tollInputError(policy,priority){var p=policy||{};return priority==='time'&&p.allowPaid&&p.limited&&(p.max==null||String(p.max).trim()===''||!Number.isFinite(Number(p.max))||Number(p.max)<0)?'Enter a maximum toll of $0 or more.':null;}
 function checkTolls(policy,parts,priority){
  if(priority!=='time')return {ok:true};var p=policy||{},error=tollInputError(p,priority);if(error)return {ok:false,reason:error};if(p.allowPaid&&!p.limited)return {ok:true};
  var costs=(parts||[]).map(function(t){return t&&t.has===false?0:t&&Number.isFinite(t.cost)&&t.cost>=0?t.cost:null;});
  if(!costs.length||costs.some(function(c){return c==null;}))return {ok:false,unknown:true,reason:'Toll prices are unknown. Update the routes or enter toll estimates in the Route menu.'};
  if(!p.allowPaid)return costs.some(function(c){return c>.005;})?{ok:false,reason:'This trip has paid tolls. Allow tolls or choose a toll-free route.'}:{ok:true};
  var max=Number(p.max),value=p.scope==='trip'?costs.reduce(function(n,c){return n+c;},0):Math.max.apply(null,costs);return value<=max+.005?{ok:true}:{ok:false,reason:'This trip exceeds your '+(p.scope==='trip'?'whole-trip':'per-leg')+' toll limit.'};
 }
 function better(a,b,priority){if(!a)return false;if(!b)return true;var fields=priority==='time'?['minutes','cost']:['cost','minutes'];for(var i=0;i<fields.length;i++){var av=Number.isFinite(a[fields[i]])?a[fields[i]]:Infinity,bv=Number.isFinite(b[fields[i]])?b[fields[i]]:Infinity,d=av-bv;if(Math.abs(d)>1e-7)return d<0;}return a.buffer>b.buffer;}
 function budget(c){var floor=Math.max(5,+c.floor||0),top=Math.min(100,Math.max(60,Math.ceil(c.buffer*1.5/5)*5)),buffers=new Set([floor]),first=new Set(c.detours.map(function(d){return floor+'|'+d;}));for(var b=5;b<=top;b+=5)if(b>=floor)buffers.add(b);if(c.buffer>=floor)buffers.add(c.buffer);first.add(Math.max(floor,c.buffer)+'|'+c.detour);return first.size+buffers.size-1;}
 async function search(c){var best=null,seen=new Set(),floor=Math.max(5,+c.floor||0),top=Math.min(100,Math.max(60,Math.ceil(c.buffer*1.5/5)*5)),buffers=[floor];
  for(var b=5;b<=top;b+=5)if(b>=floor&&buffers.indexOf(b)<0)buffers.push(b);
  if(c.buffer>=floor&&buffers.indexOf(c.buffer)<0)buffers.push(c.buffer);
  async function pass(points){var at=0;async function lane(){while(at<points.length&&c.valid()){var x=points[at++],key=x.buffer+'|'+x.detour;if(seen.has(key))continue;seen.add(key);var r=await c.evaluate(x);if(!c.valid())return;if(r&&Number.isFinite(r.minutes)&&Number.isFinite(r.cost)){r=Object.assign({},r,x);if(better(r,best,c.priority))best=r;}if(c.progress)c.progress(seen.size);}}await Promise.all(Array.from({length:Math.max(1,Math.min(6,c.width||1))},lane));}
  await pass(c.detours.map(function(d){return {buffer:floor,detour:d};}).concat([{buffer:Math.max(floor,c.buffer),detour:c.detour}]));
  if(best&&c.valid())await pass(buffers.map(function(b){return {buffer:b,detour:best.detour};}));
  return c.valid()?best:null;
 }
 var api={objective:objective,enabled:enabled,tollInputError:tollInputError,checkTolls:checkTolls,better:better,search:search,budget:budget};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AutoTrip=api;
})(typeof window==='undefined'?globalThis:window);
