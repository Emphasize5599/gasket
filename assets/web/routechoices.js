/* Explicit per-leg alternative consent and settings. No network or vehicle data. */
(function(root){
  'use strict';
  function key(leg,a){
    var text=JSON.stringify([a.distanceMeters,a.duration,a.description,a.polyline]),h=2166136261,h2=5381;
    for(var i=0;i<text.length;i++){h=Math.imul(h^text.charCodeAt(i),16777619);h2=Math.imul(h2,33)^text.charCodeAt(i);}
    return leg+'|'+text.length+'|'+(h>>>0).toString(36)+'|'+(h2>>>0).toString(36);
  }
  function entries(legs,sel,answers){
    var primary=[],other=[];
    legs.forEach(function(list,i){list.forEach(function(a,k){var item={leg:i,k:k,key:key(i,a),route:a,primary:k===sel[i]};if(item.primary)primary.push(item);else if(answers[item.key]&&answers[item.key].consider===true)other.push(item);});});
    return primary.concat(other);
  }
  function pending(legs,sel,answers){var out=[];legs.forEach(function(list,i){list.forEach(function(a,k){var id=key(i,a);if(k!==sel[i]&&(!answers[id]||typeof answers[id].consider!=='boolean'))out.push({leg:i,k:k,key:id,route:a});});});return out;}
  function settings(item,answers,defaults){var x=answers[item.key]||{},number=function(v,f,max){return Number.isFinite(Number(v))&&v!==''&&v!=null?Math.max(0,Math.min(max,Number(v))):f;};return {bufferMi:number(x.bufferMi,defaults.bufferMi,500),maxDetourMin:number(x.maxDetourMin,defaults.maxDetourMin,120)};}
  // Lazy Cartesian product: each approved leg appears in every possible whole-trip combination.
  // Never materialize exponentially many route models or silently truncate the search.
  function combinations(legs,sel,answers){
    var lists=legs.map(function(list,i){return [sel[i]].concat(list.map(function(a,k){return k;}).filter(function(k){return k!==sel[i]&&answers[key(i,list[k])]?.consider===true;}));}),at=lists.map(function(){return 0;}),done=!lists.length;
    return {total:lists.reduce(function(n,l){return n*l.length;},1),next:function(){if(done)return {done:true};var value=lists.map(function(l,i){return l[at[i]];});for(var i=at.length-1;i>=0;i--){at[i]++;if(at[i]<lists[i].length)break;at[i]=0;if(!i)done=true;}return {done:false,value:value};}};
  }
  var api={key:key,entries:entries,pending:pending,settings:settings,combinations:combinations};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RouteChoices=api;
})(typeof window!=='undefined'?window:globalThis);
