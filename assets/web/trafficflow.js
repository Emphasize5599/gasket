/* Forecast orchestration. Provider calls use the same
 * native HERE monthly reservation as tolls; cached answers are not trip-specific. */
(function(root){
  'use strict';
  function init(A,call,context){
    var profiles=new WeakMap(),running=new Map(),failure='',coverage=null,sequence=0;
    var service=Traffic.create({get:function(k,ttl){var r=A.KV.get('traffic',k,ttl);return r&&r.v;},put:function(k,v){A.KV.put('traffic',k,v);},fetch:async function(q){var r=await call('fetchHere',A.S.hereKey,q,A.S.hereMonthlyCap==null?2000:Math.max(0,parseInt(A.S.hereMonthlyCap,10)||0));if(root.__apiCount)root.__apiCount();return r;}});
    root.addEventListener('cacheclear',function(){profiles=new WeakMap();service.clear();});
    function enabled(){return A.S.trip.trafficForecast===true&&!!A.S.hereKey;}
    function identity(depart,stops,wait){return JSON.stringify([Math.floor(depart/60000),A.S.trip.avoid,stops||[],wait||null]);}
    function profile(raw,depart){var p=profiles.get(raw);return enabled()&&p&&p.time===Math.floor(depart/60000)&&p.avoid===JSON.stringify(A.S.trip.avoid)&&Date.now()-p.at<(Math.abs(depart-Date.now())<3600000?600000:21600000)?p.value:null;}
    function model(raw,base,depart){var p=profile(raw,depart);return p?Traffic.overlay(base,p):base;}
    async function prepare(raw,base,depart,options){
      if(!enabled())return base;var o=options||{},id=identity(depart,o.stops,o.waitAt),current=profiles.get(raw);if(current&&current.id===id&&profile(raw,depart))return model(raw,base,depart);
      var key=JSON.stringify([Trip.encodePolyline(base.pts),id]),valid=o.valid||function(){return true;};
      if(!running.has(key)){var end=root.Tasks&&Tasks.begin('traffic:'+ (++sequence),{text:'Forecasting traffic along selected roads',priority:20});
        running.set(key,service.forecast(base,depart,{stops:o.stops,waitAt:o.waitAt,avoid:A.S.trip.avoid,valid:valid}).finally(function(){running.delete(key);if(end)end();}));}
      try{var p=await running.get(key);if(!valid())throw Error('Traffic lookup cancelled');profiles.set(raw,{id:id,time:Math.floor(depart/60000),avoid:JSON.stringify(A.S.trip.avoid),at:p.at,value:p});failure='';coverage=p.coverage;if(root.FLog)FLog[p.cached?'debug':'info']('traffic','Forecast ready',{miles:Math.round(base.totalMi),minutes:Math.round(p.seconds/60),normalMinutes:Math.round(base.durationSec/60),coveragePct:Math.round((p.coverage||0)*100),legs:(p.legs||[]).map(function(l){return l.match;}),cached:p.cached,ageMinutes:Math.round((Date.now()-p.at)/60000),stopCount:(o.stops||[]).length});return Traffic.overlay(base,p);}
      catch(e){profiles.delete(raw);failure=String(e.message||e);coverage=null;if(root.FLog)FLog[e.cachedFailure?'debug':'warn']('traffic','Forecast unavailable',{reason:failure,cached:!!e.cachedFailure,details:e.details});throw e;}
    }
    function html(){return '<label class="field"><span class="lbl">Forecast traffic<small>Uses the optional HERE key and its shared monthly limit. Estimates traffic when you reach each road. Energy use remains an estimate.</small></span><input type="checkbox" id="tTraffic"'+(A.S.trip.trafficForecast?' checked':'')+'></label><p class="lead small keep">'+A.esc(!A.S.hereKey?'Add a HERE key in Settings → Connections to forecast traffic.':failure?'Traffic forecast not used: '+failure+'. Using normal route times.':coverage!=null&&coverage<.995?'Traffic forecast covers '+Math.round(coverage*100)+'% of this route; the rest uses normal route times.':'Traffic estimates are forecasts, not guarantees.')+'</p>';}
    function bind(){var t=document.getElementById('tTraffic');if(t)t.onchange=function(){A.S.trip.trafficForecast=t.checked;A.save();context.invalidate();};}
    return {enabled:enabled,profile:profile,model:model,prepare:prepare,html:html,bind:bind};
  }
  root.TrafficFlow={init:init};
})(window);
