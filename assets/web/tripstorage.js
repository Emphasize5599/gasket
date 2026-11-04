/* Persist repeated inventories once. Full object identity retains vehicle tariffs. */
(function(root){'use strict';
 var stops=typeof module!=='undefined'&&module.exports?require('./tripstops'):root.TripStops;
 function pack(v){
  if(stops)v=stops.reconcile(v);
  if(!v||(!v.stations&&!v.comparison)||v.stationPoolVersion===1)return v;
  var pool=[],seen=new Map();
  function refs(rows){return (rows||[]).map(function(st){var key=JSON.stringify(st),i=seen.get(key);if(i===undefined){i=pool.length;seen.set(key,i);pool.push(st);}return i;});}
  function inventory(s){if(!s)return s;var official=refs(s.official),google=(s.google||[]).map(function(g){var copy=Object.assign({},g,{refs:refs(g.list)});delete copy.list;return copy;});return Object.assign({},s,{official:official,google:google});}
  var copy=Object.assign({},v);if(v.stations)copy.stations=inventory(v.stations);
  if(Array.isArray(v.comparison))copy.comparison=v.comparison.map(function(c){if(!c.replay||!c.replay.stations)return c;return Object.assign({},c,{replay:Object.assign({},c.replay,{stations:inventory(c.replay.stations)})});});
  // Candidate projections and chosen stops reference the same full station records as inventory.
  function planned(value){if(!value)return value;function walk(v){if(Array.isArray(v))return v.map(walk);if(!v||typeof v!=='object')return v;var out={};Object.keys(v).forEach(function(k){if(k==='station'&&v[k]&&typeof v[k]==='object')out.stationRef=refs([v[k]])[0];else out[k]=walk(v[k]);});return out;}return walk(value);}
  if(copy.planned)copy.planned=planned(copy.planned);if(copy.comparison)copy.comparison=copy.comparison.map(function(c){return c.planned?Object.assign({},c,{planned:planned(c.planned)}):c;});
  copy.stationPoolVersion=1;copy.stationPool=pool;return copy;
 }
 function unpack(v){
  if(stops)v=stops.reconcile(v);
  if(!v||v.stationPoolVersion!==1)return v;
  var pool=v.stationPool;
  if(!Array.isArray(pool))throw Error('Invalid saved station inventory');
  function rows(refs){return (refs||[]).map(function(i){if(!Number.isInteger(i)||i<0||i>=pool.length)throw Error('Invalid saved station reference');return pool[i];});}
  function inventory(s){return Object.assign({},s,{official:rows(s.official),google:(s.google||[]).map(function(g){var copy=Object.assign({},g,{list:rows(g.refs)});delete copy.refs;return copy;})});}
  var copy=Object.assign({},v);if(v.stations)copy.stations=inventory(v.stations);
  if(Array.isArray(v.comparison))copy.comparison=v.comparison.map(function(c){if(!c.replay||!c.replay.stations)return c;return Object.assign({},c,{replay:Object.assign({},c.replay,{stations:inventory(c.replay.stations)})});});
  function planned(value){if(!value)return value;function walk(v){if(Array.isArray(v))return v.map(walk);if(!v||typeof v!=='object')return v;var out={};Object.keys(v).forEach(function(k){if(k==='stationRef')out.station=rows([v[k]])[0];else out[k]=walk(v[k]);});return out;}return walk(value);}
  if(copy.planned)copy.planned=planned(copy.planned);if(copy.comparison)copy.comparison=copy.comparison.map(function(c){return c.planned?Object.assign({},c,{planned:planned(c.planned)}):c;});
  delete copy.stationPool;delete copy.stationPoolVersion;return copy;
 }
 root.TripStorage={pack:pack,unpack:unpack};
})(typeof window==='undefined'?globalThis:window);
