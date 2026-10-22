/* Comparison inputs/metrics only. No global selected vehicle, network, or fabricated prices. */
(function(root){
  'use strict';
  var T=typeof module!=='undefined'&&module.exports?require('./trip.js'):root.Trip;
  function clone(x){return x==null?x:JSON.parse(JSON.stringify(x));}
  function key(x){if(Array.isArray(x))return '['+x.map(key).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(function(k){return JSON.stringify(k)+':'+key(x[k]);}).join(',')+'}';return JSON.stringify(x);}
  function profile(c){
    var o=clone(c||{});Object.keys(o).forEach(function(k){if(/^(?:name|nick|pic.*|photo.*|image.*|entries|recalls?|ai.*|.*Lookup|rememberRouteChoices)$/i.test(k))delete o[k];});
    // Reader caches, timestamps and lazily installed empty editor defaults are not configuration.
    if(o.tires){delete o.tires.tr;if(o.tires.spare)delete o.tires.spare.lookup;if(o.tires.corners&&!o.tires.corners.split)delete o.tires.corners;if(o.tires.tread&&!o.tires.tread.miles&&!o.tires.tread.depth&&o.tires.tread.mode==='miles')delete o.tires.tread.mode;}
    function clean(v){if(Array.isArray(v))return v.map(clean);if(v&&typeof v==='object'){var out={};Object.keys(v).forEach(function(k){var x=clean(v[k]);if(x!=null&&x!==''&&!(typeof x==='object'&&!Object.keys(x).length))out[k]=x;});return out;}return v;}
    return key(clean(o));
  }
  function journey(route,trip){return key([(route&&route.stops||[]).map(function(s){return [s.lat,s.lng,s.address||s.label||'',!!s.ret];}),trip.departNow?'now':trip.depart,trip.returnTrip,trip.backAuto,trip.backAt||'']);}
  function sum(rows,k){return rows.reduce(function(n,r){return n+(r[k]||0);},0);}
  function toll(t){return t&&t.has===false?0:t&&Number.isFinite(t.cost)&&t.cost>=0?t.cost:null;}
  function metrics(s,leg,adapters){
    var r=s.result,m=r&&r.opts&&r.opts.model||s.model,p=r&&r.plan;
    if(!m||!p||!p.ok)return {cost:null,minutes:null,miles:m?m.totalMi:null,stops:null,ready:false};
    var rows=T.legSummaries(m,p,r.startGal,r.startPrice,r.top,s.kind),i=leg==null?null:Math.max(0,Math.min(rows.length-1,leg)),row=i==null?null:rows[i];
    var stops=(p.stops||[]).concat(r.top?[r.top]:[]),chosen=stops.filter(function(x){var at=rows.findIndex(function(l){return x.c.d<=l.to+1e-7;});return i==null||Math.max(0,at)===i;});
    var energy=row?row.cost:sum(rows,'cost'),spend=row?row.spend:sum(rows,'spend'),service=row?row.chargingMin+row.refuelingMin:sum(rows,'chargingMin')+sum(rows,'refuelingMin');
    var driving=(row?row.drivingSec:m.durationSec)/60,detour=chosen.reduce(function(n,x){return n+(x.c.detourMin||0);},0),setup=chosen.length*(r.opts.stopMinutes||0);
    // Clip each selected-speed road stretch to this leg; do not distribute time savings
    // from one leg over unrelated legs just because their durations are similar.
    if(s.speedTiming){var from=row?row.from:0,to=row?row.to:m.totalMi;driving-=s.speedTiming.reduce(function(n,x){var mi=Math.max(0,Math.min(to,x.to)-Math.max(from,x.from));return n+(x.offset&&x.limit>0?mi*(1/x.limit-1/Math.max(x.lo,Math.min(x.hi,x.limit+x.offset)))*60:0);},0);}
    else {var speedSaved=r.speedState&&r.speedState.minSaved||0;driving-=i==null?speedSaved:speedSaved*(m.durationSec?row.drivingSec/m.durationSec:0);}
    var overlap=0,turn=rows.length-2,back=s.trip&&s.trip.returnTrip&&!s.trip.backAuto&&Date.parse(s.trip.backAt),depart=r.opts.rewardDepartAt;
    if(back&&depart&&turn>=0&&(i==null||i===turn)){
      var before=stops.filter(function(x){return x.c.d<=rows[turn].to;}),priorCharging=(p.destinationCharges||[]).filter(function(x){return x.index<turn;}).reduce(function(n,x){return n+x.minutes;},0),arrival=depart+m.timeTo(rows[turn].to)*1000+(before.reduce(function(n,x){return n+T.stopDelay(r.opts,x);},0)+priorCharging)*60000;
      var parked=Math.max(0,(back-arrival)/60000),charging=(p.destinationCharges||[]).filter(function(x){return x.index===turn;}).reduce(function(n,x){return n+x.minutes;},0);overlap=Math.min(parked,charging);
    }
    var ts=s.tolls||[],selected=i==null?rows.map(function(_,j){return toll(ts[j]);}):[toll(ts[i])],tolls=selected.every(function(v){return v!=null;})?selected.reduce(function(a,b){return a+b;},0):null;
    var missing=chosen.some(function(x){return !Number.isFinite(x.c.price)||x.c.price<0||x.c.price===0&&!x.c.freeCharging;})||!Number.isFinite(r.startPrice);
    var estimated=!!p.propulsion||!!s.startEstimated||chosen.some(function(x){return !!(x.c.est||x.c.calc&&x.c.calc.est);});
    var quote={energy:missing?null:energy,spend:missing?null:spend,tolls:tolls,fees:0,estimated:estimated};
    if(adapters&&adapters.price)quote=adapters.price(s,i,clone(quote))||quote;
    var cost=Number.isFinite(quote.energy)&&Number.isFinite(quote.tolls)&&Number.isFinite(quote.fees)?quote.energy+quote.tolls+quote.fees:null;
    var minutes=Math.max(0,driving)+detour+setup+Math.max(0,service-overlap);
    if(adapters&&adapters.time){var time=adapters.time(s,i,minutes);if(Number.isFinite(time)&&time>=0)minutes=time;}
    return {cost:cost,energy:quote.energy,spend:quote.spend,tolls:quote.tolls,fees:quote.fees,estimated:!!quote.estimated,minutes:minutes,driving:Math.max(0,driving),detour:detour,setup:setup,service:service,overlap:overlap,miles:row?row.miles:m.totalMi,stops:chosen.length,ready:!s.needsReview&&!s.stale};
  }
  function sorted(rows,sort){var field=sort==='time'?'minutes':'cost';return rows.slice().sort(function(a,b){var av=a.metrics[field],bv=b.metrics[field],ak=a.metrics.ready&&Number.isFinite(av),bk=b.metrics.ready&&Number.isFinite(bv);return (bk?1:0)-(ak?1:0)||(ak&&bk?av-bv:0)||a.order-b.order;});}
  function portable(s,car){var t=clone(s.trip);delete t.routeChoices;return {id:s.id,trip:t,speed:clone(s.speed),route:clone(s.route),alts:clone(s.alts),altSel:s.altSel,altSure:s.altSure,replay:clone(s.replay),profile:s.profile,kind:s.kind,needsReview:true};}
  var api={clone:clone,key:key,profile:profile,journey:journey,metrics:metrics,sorted:sorted,portable:portable};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VehicleCompare=api;
})(typeof window!=='undefined'?window:globalThis);
