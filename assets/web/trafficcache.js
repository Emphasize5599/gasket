/* Bounded app-storage traffic forecasts, independent of trips and weather. */
(function(root){'use strict';
 function create(KV,options){var o=options||{},limit=o.limit||8192,budget=o.bytes||256*1024*1024,hotLimit=o.hot||128,entries=null,slots=new Set(),hot=new Map(),bytes=0,timer=null;
  function size(v){try{var s=JSON.stringify(v);return (/[^\x00-\x7f]/.test(s)?typeof TextEncoder!=='undefined'?new TextEncoder().encode(s).length:s.length*3:s.length)+256;}catch(e){return budget+1;}}
  function index(){if(!entries){entries=new Map();var r=KV.get('traffic','google-index');(r&&Array.isArray(r.v)?r.v:[]).forEach(function(e){if(!e||typeof e.key!=='string'||!Number.isSafeInteger(e.slot)||e.slot<0||e.slot>=limit||slots.has(e.slot)||entries.has(e.key))return;var n=Number.isFinite(e.bytes)&&e.bytes>0?e.bytes:65536;e=Object.assign({},e,{bytes:n,estimated:!(Number.isFinite(e.bytes)&&e.bytes>0)});entries.set(e.key,e);slots.add(e.slot);bytes+=n;});}return entries;}
  function flush(){clearTimeout(timer);timer=null;if(entries)KV.put('traffic','google-index',Array.from(entries.values()));}
  function schedule(){if(!timer)timer=setTimeout(flush,300);}
  function warm(k,r){hot.delete(k);hot.set(k,r);while(hot.size>hotLimit)hot.delete(hot.keys().next().value);}
  function get(k,ttl){var all=index(),e=all.get(k);if(!e)return null;var r=hot.get(k);if(!r||ttl&&Date.now()-r.t>ttl)r=KV.get('traffic','google-slot|'+e.slot,ttl);if(!r||!r.v)return null; // Full identity collision checks stay in GoogleTraffic.
   var at=r.v.profile?r.v.profile.at:r.v.at,stamp=Number.isFinite(r.t)?r.t:at;if(Number.isFinite(at))stamp=Math.min(stamp,at);if(!Number.isFinite(stamp)||ttl&&Date.now()-stamp>ttl)return null;r={v:r.v,t:stamp};if(e.estimated){var n=size(r.v);bytes+=n-e.bytes;e.bytes=n;e.estimated=false;}warm(k,r);all.delete(k);all.set(k,e);schedule();return r;}
  function put(k,v){var all=index(),n=size(v),e=all.get(k);if(n>budget)return false;if(e){all.delete(k);slots.delete(e.slot);bytes-=e.bytes;hot.delete(k);}var slot=e&&e.slot;
   while(all.size>=limit||bytes+n>budget){var first=all.keys().next().value,old=all.get(first);all.delete(first);slots.delete(old.slot);hot.delete(first);bytes-=old.bytes;KV.put('traffic','google-slot|'+old.slot,null);if(slot==null)slot=old.slot;}
   if(slot==null){slot=0;while(slots.has(slot))slot++;}if(KV.put('traffic','google-slot|'+slot,v)===false){schedule();return false;}
   e={key:k,slot:slot,bytes:n};if(v.observation){var ps=v.observation.pts;e.bounds=[Math.min.apply(null,ps.map(function(p){return p.lat;})),Math.min.apply(null,ps.map(function(p){return p.lng;})),Math.max.apply(null,ps.map(function(p){return p.lat;})),Math.max.apply(null,ps.map(function(p){return p.lng;}))];e.start=v.observation.depart;e.end=e.start+v.profile.seconds*1000;}
   all.set(k,e);slots.add(slot);bytes+=n;warm(k,{v:v,t:Date.now()});schedule();return true;}
  function clear(){clearTimeout(timer);timer=null;entries=null;slots.clear();hot.clear();bytes=0;}
  return {get:get,put:put,entries:function(){return Array.from(index().values());},flush:flush,clear:clear};
 }
 var api={create:create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TrafficCache=api;
})(typeof window==='undefined'?globalThis:window);
