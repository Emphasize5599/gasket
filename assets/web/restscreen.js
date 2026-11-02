/* Trip-scoped hidden rest candidates; no provider records are deleted.
   0.0.355 (owner): the 0.0.354 screening hold (prompt, 2-minute countdown) is gone: hiding is a per-row button,
   and nothing waits for a screening step. holding() stays for callers and is always false. */
(function(root){'use strict';
 function create(io){var state=null;
  function persist(){if(io.save&&state)io.save({signature:state.signature,hidden:Array.from(state.hidden)});}
  function sync(sig,ids){if(state&&state.signature===sig)return false;var prior=io.load&&io.load();state={signature:sig,hidden:new Set(prior&&prior.signature===sig?prior.hidden||[]:[])};persist();return false;}
  function hidden(id){return !!(state&&state.hidden.has(id));}
  function hide(id,value){if(!state)return;if(value)state.hidden.add(id);else state.hidden.delete(id);persist();}
  function restore(){if(!state)return;state.hidden.clear();persist();}
  function no(){return false;}
  return {sync:sync,holding:no,touch:function(){},hidden:hidden,hide:hide,remaining:function(){return null;},finish:no,tick:no,pause:function(){},paused:no,restore:restore,count:function(){return state?state.hidden.size:0;}};
 }
 var api={create:create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RestScreen=api;
})(typeof window!=='undefined'?window:this);
