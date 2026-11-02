/* Trip-scoped candidate screening; no provider records are deleted. */
(function(root){'use strict';
 function create(io){var now=io.now||Date.now,state=null,last=null,paused=false;
  function persist(){if(io.save)io.save(Object.assign({},state,{hidden:Array.from(state.hidden),seen:Array.from(state.seen)}));}
  function sync(sig,ids){var prior=state&&state.signature===sig?state:io.load&&io.load(),wasComplete=prior&&prior.complete,fresh=!prior||prior.signature!==sig;state=fresh?{signature:sig,hidden:new Set(),seen:new Set(),complete:false,timeoutMs:120000}:Object.assign({},prior,{hidden:new Set(prior.hidden||[]),seen:new Set(prior.seen||[])});if(state.complete&&ids.some(function(id){return !state.seen.has(id);}))state.complete=false;state.ids=ids.slice();if(!ids.length)state.complete=true;if(fresh){paused=false;last=now();}if(!state.complete&&(last==null||wasComplete))last=now();persist();return holding();}
  function holding(){return !!(state&&!state.complete);}
  function touch(){if(holding())last=now();}
  function hidden(id){return !!(state&&state.hidden.has(id));}
  function hide(id,value){if(!state)return;if(value)state.hidden.add(id);else state.hidden.delete(id);touch();persist();}
  function remaining(){return !holding()||paused?null:Math.max(0,(state.timeoutMs||120000)-(now()-last));}
  function finish(){if(!holding())return false;state.complete=true;paused=false;state.ids.forEach(function(id){state.seen.add(id);});persist();return true;}
  function tick(active){if(!holding())return false;if(!active){touch();return false;}if(!paused&&remaining()===0)return finish();return false;}
  function pause(value){paused=value;touch();}
  function restore(){if(!state)return;state.hidden.clear();touch();persist();}
  return {sync:sync,holding:holding,touch:touch,hidden:hidden,hide:hide,remaining:remaining,finish:finish,tick:tick,pause:pause,paused:function(){return paused;},restore:restore,count:function(){return state?state.hidden.size:0;}};
 }
 var api={create:create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RestScreen=api;
})(typeof window!=='undefined'?window:this);
