/* CPU-only planner workers. No network, native bridge, API keys or station discovery.
 * A pool: a long trip's plan takes ~20-30 s on a phone, and the buffer / detour sweeps, the other routes and the
 * whole-trip comparisons each run a dozen of them. One worker did them one after another (a 283 s buffer sweep in a
 * phone log). Dispatch to idle workers (up to 6, cores - 1), prioritizing interactive changes and discarding stale queued previews. */
(function(root){
  'use strict';
  var workers=[],pending=new Map(),queue=[],seq=0,disabled=false,scheduled=false,finished=0,dropped=0;
  function stats(){return {active:workers.filter(function(w){return !!w.busy;}).length,queued:queue.length,finished:finished,dropped:dropped};}
  function requestDrain(){if(scheduled)return;scheduled=true;Promise.resolve().then(function(){scheduled=false;drain();});}
  function timing(p){Object.defineProperty(p.opts,'_plannerTiming',{configurable:true,value:{waitMs:(p.started||Date.now())-p.at,runMs:p.started?Date.now()-p.started:0}});}
  function boot(){
    self.onmessage=function(event){
      var d=event.data,o=d.options,c=d.context;
      try{
        o.model=Trip.restoreModel(o.model);if(d.rates)o.model=Trip.withSpeeds(o.model,d.rates);
        if(c){
          function arrival(m,at,stops){
            var before=function(x){return (stops||[]).filter(function(s){return s.c.d<x;}).reduce(function(n,s){return n+Trip.stopDelay(o,s);},0)*60;};
            var seconds=m.timeTo(at)+before(at),ends=m.legEnds||[];
            if(c.returnAt&&ends.length>1){var turn=ends[ends.length-2];if(at>=turn)seconds+=Math.max(0,(c.returnAt-c.departAt)/1000-m.timeTo(turn)-before(turn));}
            return new Date(c.departAt+seconds*1000);
          }
          o.rewardPriceAt=function(candidate,m,stops){var at=arrival(m,candidate.d,stops);if(candidate.est||!candidate.station||candidate.station.brand!=='citgo')return Object.assign({},candidate,{rewardMonth:Pricing.monthKey(at)});var price=Pricing.tripPrice(candidate.station,c.grade,c.discounts,new Date(c.now),at);return price?Object.assign({},candidate,price):candidate;};
        }
        var plan=Trip.plan(o);self.postMessage({id:d.id,plan:plan,refPrice:o.refPrice});
      }catch(error){self.postMessage({id:d.id,error:error.message||String(error)});}
    };
  }
  function size(){var n=Number(root.navigator&&root.navigator.hardwareConcurrency)||4;return Math.max(1,Math.min(6,n-1));}
  var url=null;
  function spawn(){
    if(!url)url=URL.createObjectURL(new Blob([root.Propulsion?root.Propulsion.workerSource:'',root.Trip.workerSource,root.Pricing.workerSource,'('+boot.toString()+')();'],{type:'text/javascript'}));
    var w={worker:new Worker(url),busy:0,ids:new Set()};
    w.worker.onmessage=function(e){var d=e.data,p=pending.get(d.id);w.ids.delete(d.id);w.busy=0;if(!p){requestDrain();return;}pending.delete(d.id);finished++;timing(p);if(d.error)p.reject(new Error(d.error));else{p.opts.refPrice=d.refPrice;if(d.plan.propulsionModel){if(!p.opts.propulsionBase){p.opts.propulsionBase={};['totalMi','durationSec','segs','legEnds','cityGpm','hwyGpm','combGpm'].forEach(function(k){p.opts.propulsionBase[k]=p.opts.model[k];});}p.opts.model=root.Trip.restoreModel(Object.assign({},p.opts.model,d.plan.propulsionModel));}p.resolve(d.plan);}requestDrain();};
    w.worker.onerror=function(){
      w.worker.terminate();workers.splice(workers.indexOf(w),1);if(!workers.length)disabled=true;
      w.ids.forEach(function(id){var p=pending.get(id);if(p){pending.delete(id);p.reject(new Error('Background planner unavailable. Please reopen this trip.'));}});
      requestDrain();
    };
    workers.push(w);return w;
  }
  // An idle worker, or a new one while the pool isn't full.
  function pick(){
    if(disabled)return null;
    try{
      var free=workers.filter(function(w){return !w.busy;})[0];if(free)return free;
      if(workers.length<size())return spawn();
      return null; // keep work in the page's priority queue, not a worker's FIFO
    }catch(e){disabled=!workers.length;return null;}
  }
  function drain(){
    queue.sort(function(a,b){return b.priority-a.priority||a.id-b.id;});
    for(var i=queue.length-1;i>=0;i--)if(queue[i].valid&&!queue[i].valid()){var old=queue.splice(i,1)[0];pending.delete(old.id);dropped++;old.resolve({ok:false,cancelled:true});}
    while(queue.length){
      var w=pick();if(!w&&!disabled)return;
      var p=queue.shift();p.started=Date.now();
      if(!w){(function(job){setTimeout(function(){try{if(job.valid&&!job.valid()){dropped++;job.resolve({ok:false,cancelled:true});}else{job.resolve(root.Trip.plan(job.opts));finished++;timing(job);}}catch(e){job.reject(e);}finally{pending.delete(job.id);}},0);})(p);continue;}
      var m=p.opts.model,data={pts:[],cum:[]};['totalMi','durationSec','segs','legEnds','cityGpm','hwyGpm','combGpm'].forEach(function(k){data[k]=m[k];});
      var clean=Object.assign({},p.opts,{model:data}),context=p.context&&Object.assign({},p.context);delete clean.rewardPriceAt;if(context){delete context.valid;delete context.priority;}
      w.busy=1;w.ids.add(p.id);try{w.worker.postMessage({id:p.id,options:clean,rates:m.speedRates,context:context});}catch(e){pending.delete(p.id);w.busy=0;w.ids.delete(p.id);p.reject(e);}
    }
  }
  root.Planner={size:size,workers:function(){return workers.length;},stats:stats,run:function(options,context){
    return new Promise(function(resolve,reject){var p={id:++seq,resolve:resolve,reject:reject,opts:options,context:context,valid:context&&context.valid,priority:context&&context.priority!=null?context.priority:options.lite?1:10,at:Date.now()};pending.set(p.id,p);queue.push(p);requestDrain();});
  }};
})(window);
