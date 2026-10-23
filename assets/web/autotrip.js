/* Bounded-memory parameter search; no speed changes or reserve-floor changes. */
(function(root){'use strict';
 function better(a,b,priority){if(!a)return false;if(!b)return true;var fields=priority==='time'?['minutes','cost']:['cost','minutes'];for(var i=0;i<fields.length;i++){var d=a[fields[i]]-b[fields[i]];if(Math.abs(d)>1e-7)return d<0;}return a.buffer>b.buffer;}
 function budget(c){var floor=Math.max(5,+c.floor||0),top=Math.min(100,Math.max(60,Math.ceil(c.buffer*1.5/5)*5)),buffers=new Set([floor]),first=new Set(c.detours.map(function(d){return floor+'|'+d;}));for(var b=5;b<=top;b+=5)if(b>=floor)buffers.add(b);if(c.buffer>=floor)buffers.add(c.buffer);first.add(Math.max(floor,c.buffer)+'|'+c.detour);return first.size+buffers.size-1;}
 async function search(c){var best=null,seen=new Set(),floor=Math.max(5,+c.floor||0),top=Math.min(100,Math.max(60,Math.ceil(c.buffer*1.5/5)*5)),buffers=[floor];
  for(var b=5;b<=top;b+=5)if(b>=floor&&buffers.indexOf(b)<0)buffers.push(b);
  if(c.buffer>=floor&&buffers.indexOf(c.buffer)<0)buffers.push(c.buffer);
  async function pass(points){var at=0;async function lane(){while(at<points.length&&c.valid()){var x=points[at++],key=x.buffer+'|'+x.detour;if(seen.has(key))continue;seen.add(key);var r=await c.evaluate(x);if(!c.valid())return;if(r&&Number.isFinite(r.minutes)&&Number.isFinite(r.cost)){r=Object.assign({},r,x);if(better(r,best,c.priority))best=r;}if(c.progress)c.progress(seen.size);}}await Promise.all(Array.from({length:Math.max(1,Math.min(6,c.width||1))},lane));}
  await pass(c.detours.map(function(d){return {buffer:floor,detour:d};}).concat([{buffer:Math.max(floor,c.buffer),detour:c.detour}]));
  if(best&&c.valid())await pass(buffers.map(function(b){return {buffer:b,detour:best.detour};}));
  return c.valid()?best:null;
 }
 var api={better:better,search:search,budget:budget};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AutoTrip=api;
})(typeof window==='undefined'?globalThis:window);
