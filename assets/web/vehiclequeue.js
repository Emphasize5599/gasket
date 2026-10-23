/* Serial vehicle jobs, bounded state and explicit recovery. Never persists safety consent. */
(function(root){'use strict';
 function create(a){var running=false,pause=false,cancelled=false,jobs=[],epoch=0;
  function state(){return {running:running,paused:pause,jobs:jobs.map(function(j){return Object.assign({},j);})};}
  function changed(){a.changed(state());}
  return {state:state,load:function(rows){if(running)return; jobs=(rows||[]).map(function(j){return {id:j.id,status:'Needs review',error:'Review setup and hazards after reopening.'};});changed();},
   select:function(ids){if(running)return;jobs=Array.from(new Set(ids)).map(function(id){return jobs.find(function(j){return j.id===id;})||{id:id,status:'Queued'};});changed();},
   pause:function(){pause=true;changed();},cancel:function(){cancelled=true;pause=true;if(a.cancel)a.cancel();changed();},
   start:async function(){if(running)return;running=true;pause=false;cancelled=false;var mine=++epoch;changed();
    try{for(var i=0;i<jobs.length&&!pause;i++){var j=jobs[i];if((j.status==='Ready'||j.status==='Adjustments ready')&&a.eligible(j.id)&&(!a.complete||a.complete(j.id)))continue;
      if(!a.eligible(j.id)){j.status='Needs input';changed();continue;}
      j.status='Working';j.error='';changed();
      try{var status=await a.run(j.id,function(){return mine===epoch&&!cancelled;});j.status=cancelled?'Paused':status||'Ready';if(!cancelled&&a.notify)a.notify(j);}
      catch(e){j.status=cancelled?'Paused':'Needs input';j.error=String(e.message||e).slice(0,200);if(a.failed)a.failed(j);}
      finally{try{await a.restore();}catch(e){pause=true;j.status='Needs input';j.error='Could not restore the selected vehicle. Reopen the comparison before continuing.';if(a.failed)a.failed(j);}changed();}
    }}finally{running=false;changed();if(a.finished)a.finished(state());}
   }
  };
 }
 var api={create:create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VehicleQueue=api;
})(typeof window==='undefined'?globalThis:window);
