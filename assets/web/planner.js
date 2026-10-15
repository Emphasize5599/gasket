/* CPU-only planner worker. No network, native bridge, API keys or station discovery. */
(function(root){
  'use strict';
  var worker=null,pending=new Map(),seq=0,disabled=false;
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
  function start(){
    if(worker||disabled)return worker;
    try{
      var url=URL.createObjectURL(new Blob([root.Trip.workerSource,root.Pricing.workerSource,'('+boot.toString()+')();'],{type:'text/javascript'}));
      worker=new Worker(url);URL.revokeObjectURL(url);
      worker.onmessage=function(e){var d=e.data,p=pending.get(d.id);if(!p)return;pending.delete(d.id);if(d.error)p.reject(new Error(d.error));else{p.opts.refPrice=d.refPrice;p.resolve(d.plan);}};
      worker.onerror=function(){disabled=true;worker.terminate();worker=null;pending.forEach(function(p){p.reject(new Error('Background planner unavailable. Please reopen this trip.'));});pending.clear();};
    }catch(e){disabled=true;}
    return worker;
  }
  root.Planner={run:async function(options,context){
    var w=start();if(!w){await new Promise(function(r){setTimeout(r,0);});return root.Trip.plan(options);}
    var m=options.model,data={pts:[],cum:[]};
    ['totalMi','durationSec','segs','legEnds','cityGpm','hwyGpm','combGpm'].forEach(function(k){data[k]=m[k];});
    var clean=Object.assign({},options,{model:data});delete clean.rewardPriceAt;
    return new Promise(function(resolve,reject){var id=++seq;pending.set(id,{resolve:resolve,reject:reject,opts:options});try{w.postMessage({id:id,options:clean,rates:m.speedRates,context:context});}catch(e){pending.delete(id);reject(e);}});
  }};
})(window);
