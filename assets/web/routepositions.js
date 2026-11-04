/* Geometry-only station projections survive changed prices, clocks and speed settings. */
(function(root){'use strict';var node=typeof module!=='undefined'&&module.exports,T=node?require('./trip'):root.Trip;
 function create(io){var memory=new Map();function hash(s){var a=2166136261,b=5381;for(var i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}return s.length+'|'+(a>>>0).toString(36)+(b>>>0).toString(36);}
  function forModel(m,maxOff){var proof=JSON.stringify([T.encodePolyline(m.pts),m.cum,m.legEnds,maxOff]),key='projection-v1|'+hash(proof),held=memory.get(key);if(!held){var saved=io.get(key);held=saved&&saved.proof===proof&&Array.isArray(saved.rows)?{proof:proof,rows:new Map(saved.rows)}:{proof:proof,rows:new Map()};memory.set(key,held);if(memory.size>12)memory.delete(memory.keys().next().value);}var reused=0,computed=0,dirty=false;
   return {get:function(p){var k=p.lat+','+p.lng,r=held.rows.get(k);if(r&&r.every(function(x){return Number.isFinite(x.along)&&Number.isFinite(x.offset)&&Number.isInteger(x.leg);})){reused++;return r.map(function(x){return Object.assign({},x);});}r=T.projectLegs(m,p,maxOff);held.rows.set(k,r.map(function(x){return Object.assign({},x);}));computed++;dirty=true;return r;},stats:function(){return {reused:reused,computed:computed};},flush:function(){if(dirty)io.put(key,{proof:proof,rows:Array.from(held.rows)});}};
  }return {forModel:forModel};
 }var api={create:create};if(node)module.exports=api;else root.RoutePositions=api;
})(typeof window==='undefined'?globalThis:window);
