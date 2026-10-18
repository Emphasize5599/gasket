/* CPU-only planner workers. No network, native bridge, API keys or station discovery.
 * A pool: a long trip's plan takes ~20-30 s on a phone, and the buffer / detour sweeps, the other routes and the
 * whole-trip comparisons each run a dozen of them. One worker did them one after another (a 283 s buffer sweep in a
 * phone log); now each goes to the least busy of up to 6 workers (cores - 1), so they run side by side. */
(function(root){
  'use strict';
  var workers=[],pending=new Map(),seq=0,disabled=false;
  function boot(){
    self.onmessage=function(event){
      var d=event.data,o=d.options,c=d.context;
      try{
        o.model=Trip.restoreModel(o.model);if(d.rates)o.model=Trip.withSpeeds(o.model,d.rates);
        if(c){
          function arrival(m,at,stops){
            var before=function(x){return (stops||[]).filter(function(s){return s.c.d<x;}).reduce(function(n,s){return n+(s.c.detourMin||0)+8;},0)*60;};
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
    if(!url)url=URL.createObjectURL(new Blob([root.Trip.workerSource,root.Pricing.workerSource,'('+boot.toString()+')();'],{type:'text/javascript'}));
    var w={worker:new Worker(url),busy:0,ids:new Set()};
    w.worker.onmessage=function(e){var d=e.data,p=pending.get(d.id);w.ids.delete(d.id);w.busy=Math.max(0,w.busy-1);if(!p)return;pending.delete(d.id);if(d.error)p.reject(new Error(d.error));else{p.opts.refPrice=d.refPrice;p.resolve(d.plan);}};
    w.worker.onerror=function(){
      w.worker.terminate();workers.splice(workers.indexOf(w),1);if(!workers.length)disabled=true;
      w.ids.forEach(function(id){var p=pending.get(id);if(p){pending.delete(id);p.reject(new Error('Background planner unavailable. Please reopen this trip.'));}});
    };
    workers.push(w);return w;
  }
  // the least busy worker; a new one while all are working and the pool isn't full
  function pick(){
    if(disabled)return null;
    try{
      var free=workers.filter(function(w){return !w.busy;})[0];if(free)return free;
      if(workers.length<size())return spawn();
      return workers.slice().sort(function(a,b){return a.busy-b.busy;})[0]||null;
    }catch(e){disabled=!workers.length;return workers[0]||null;}
  }
  root.Planner={size:size,workers:function(){return workers.length;},run:async function(options,context){
    var w=pick();if(!w){await new Promise(function(r){setTimeout(r,0);});return root.Trip.plan(options);}
    var m=options.model,data={pts:[],cum:[]};
    ['totalMi','durationSec','segs','legEnds','cityGpm','hwyGpm','combGpm'].forEach(function(k){data[k]=m[k];});
    var clean=Object.assign({},options,{model:data});delete clean.rewardPriceAt;
    return new Promise(function(resolve,reject){var id=++seq;pending.set(id,{resolve:resolve,reject:reject,opts:options});w.busy++;w.ids.add(id);try{w.worker.postMessage({id:id,options:clean,rates:m.speedRates,context:context});}catch(e){pending.delete(id);w.busy--;w.ids.delete(id);reject(e);}});
  }};
})(window);
