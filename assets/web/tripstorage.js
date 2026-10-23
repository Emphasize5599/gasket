/* Persist repeated inventories once. Full object identity retains vehicle tariffs. */
(function(root){'use strict';
 function pack(v){
  if(!v||(!v.stations&&!v.comparison)||v.stationPoolVersion===1)return v;
  var pool=[],seen=new Map();
  function refs(rows){return (rows||[]).map(function(st){var key=JSON.stringify(st),i=seen.get(key);if(i===undefined){i=pool.length;seen.set(key,i);pool.push(st);}return i;});}
  function inventory(s){if(!s)return s;var official=refs(s.official),google=(s.google||[]).map(function(g){var copy=Object.assign({},g,{refs:refs(g.list)});delete copy.list;return copy;});return Object.assign({},s,{official:official,google:google});}
  var copy=Object.assign({},v);if(v.stations)copy.stations=inventory(v.stations);
  if(Array.isArray(v.comparison))copy.comparison=v.comparison.map(function(c){if(!c.replay||!c.replay.stations)return c;return Object.assign({},c,{replay:Object.assign({},c.replay,{stations:inventory(c.replay.stations)})});});
  copy.stationPoolVersion=1;copy.stationPool=pool;return copy;
 }
 function unpack(v){
  if(!v||v.stationPoolVersion!==1)return v;
  var pool=v.stationPool;
  if(!Array.isArray(pool))throw Error('Invalid saved station inventory');
  function rows(refs){return (refs||[]).map(function(i){if(!Number.isInteger(i)||i<0||i>=pool.length)throw Error('Invalid saved station reference');return pool[i];});}
  function inventory(s){return Object.assign({},s,{official:rows(s.official),google:(s.google||[]).map(function(g){var copy=Object.assign({},g,{list:rows(g.refs)});delete copy.refs;return copy;})});}
  var copy=Object.assign({},v);if(v.stations)copy.stations=inventory(v.stations);
  if(Array.isArray(v.comparison))copy.comparison=v.comparison.map(function(c){if(!c.replay||!c.replay.stations)return c;return Object.assign({},c,{replay:Object.assign({},c.replay,{stations:inventory(c.replay.stations)})});});
  delete copy.stationPool;delete copy.stationPoolVersion;return copy;
 }
 root.TripStorage={pack:pack,unpack:unpack};
})(typeof window==='undefined'?globalThis:window);
