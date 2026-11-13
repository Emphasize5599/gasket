/* Translate dependent clocks only when every original window moves by the same whole days.
 * Forecast samples and provider observation dates are never made fresh by translating a trip. */
(function(root){'use strict';
 var node=typeof module!=='undefined'&&module.exports,Stops=node?require('./tripstops'):root.TripStops,Over=node?require('./overnight'):root.Overnight,Places=node?require('./restplaces'):root.RestPlaces,DAY=86400000;
 function shiftedDate(date,delta){return new Date(Date.parse(date+'T12:00:00Z')+delta).toISOString().slice(0,10);}
 function delta(route,before,after){
  if(!before||!after||before.clockVersion!==2||after.clockVersion!==2||!before.enabled||!after.enabled||before.planningMode!==after.planningMode)return null;
  var differences=[],okay=true;
  function pair(a,b){if(!a&&!b)return;if(!a||!b){okay=false;return;}var x=Date.parse(a),y=Date.parse(b);if(!Number.isFinite(x)||!Number.isFinite(y)){okay=false;return;}differences.push(y-x);}
  ['depart','arrival'].forEach(function(k){['start','end'].forEach(function(e){pair(before.windowTimes&&before.windowTimes[k]&&before.windowTimes[k][e],after.windowTimes&&after.windowTimes[k]&&after.windowTimes[k][e]);});});
  (route.stops||[]).slice(1).forEach(function(p,i){if(Stops.isRest(p))return;var a=(before.destinations||[])[i]||{},b=(after.destinations||[])[i]||{};if(!!a.arriveOn!==!!b.arriveOn||!!a.leaveOn!==!!b.leaveOn||(+a.wait||0)!==(+b.wait||0))okay=false;['arriveStart','arriveEnd','leaveStart','leaveEnd'].forEach(function(k){pair(a[k],b[k]);});});
  var d=differences[0];if(!okay||!d||d%DAY||!differences.every(function(x){return x===d;}))return null;
  function nightly(c,shift){var n=JSON.parse(JSON.stringify(c||{}));(n.overrides||[]).forEach(function(o){if(o.date&&shift)o.date=shiftedDate(o.date,d);});return JSON.stringify(n);}
  if(nightly(before.overnight,false)!==nightly(after.overnight,false)&&nightly(before.overnight,true)!==nightly(after.overnight,false))return null;
  return d;
 }
 function apply(route,trip,before,after){var d=delta(route,before,after);if(d==null)return null;
  function stamp(v){var t=Date.parse(v);return Number.isFinite(t)?new Date(t+d).toISOString():v;}
  ['depart','backAt'].forEach(function(k){if(trip[k])trip[k]=stamp(trip[k]);});
  if(Array.isArray(trip.legDepartures))trip.legDepartures=trip.legDepartures.map(function(t){return Number.isFinite(t)?t+d:t;});
  ['driveThroughNights','noLeaveSkips'].forEach(function(k){var old=before[k];if(!old||JSON.stringify(old)!==JSON.stringify(after[k]))return;after[k]={};Object.keys(old).forEach(function(key){after[k][key]=old[key].map(function(s){return shiftedDate(s.slice(0,10),d)+s.slice(10);});});});
  if(JSON.stringify(before.noLeave||[])===JSON.stringify(after.noLeave||[]))after.noLeave=(after.noLeave||[]).map(function(r){return r.night?Object.assign({},r,{night:shiftedDate(r.night,d)}):r;});
  if(JSON.stringify(before.overnight&&before.overnight.overrides||[])===JSON.stringify(after.overnight&&after.overnight.overrides||[])&&after.overnight)after.overnight.overrides=(after.overnight.overrides||[]).map(function(r){return r.date?Object.assign({},r,{date:shiftedDate(r.date,d)}):r;});
  route.stops.forEach(function(p,i){if(!p.rest)return;var r=Object.assign({},p.rest);['leaveAt','parkingCloses','nightStart','nightEnd','nightArrivalEnd','leaveEarliest'].forEach(function(k){if(Number.isFinite(r[k]))r[k]+=d;});if(r.nightDate)r.nightDate=shiftedDate(r.nightDate,d);r.samples=[];r.timingRefresh=false;
   var z=r.site&&r.site.timeZone||p.timeZone;if(r.overnight&&z&&after.overnight&&r.nightDate){var w=Over.windowFor(r.nightDate,z,Over.defaults(after.overnight),r.site||p);if(!w.invalid){r.nightStart=w.start;r.nightEnd=w.end;r.nightArrivalEnd=w.arrivalEnd;r.leaveEarliest=w.leaveStart;r.parkingCloses=w.end;}if(w.invalid||r.leaveAt<r.leaveEarliest||r.leaveAt>r.nightEnd)r.pendingTiming=true;}
   r=Places.translatedPermissions(p.rest,r);p.rest=r;after.destinations=after.destinations||[];after.destinations[i-1]=r.pendingTiming?{arriveOn:false,leaveOn:false,wait:0}:{arriveOn:false,leaveOn:true,leaveStart:new Date(r.leaveAt).toISOString(),leaveEnd:new Date(r.leaveAt).toISOString(),wait:0};
  });
  route.restRecords=Stops.seal(route).restRecords;
  if(route.restStartAdjustment){var meta=Object.assign({},route.restStartAdjustment);['originalDepart','adjustedDepart'].forEach(function(k){if(meta[k])meta[k]=stamp(meta[k]);});['originalFirst','originalOvernightDepart'].forEach(function(k){if(Number.isFinite(meta[k]))meta[k]+=d;});route.restStartAdjustment=meta;}
  return d;
 }
 var api={delta:delta,apply:apply};if(node)module.exports=api;else root.TripDates=api;
})(typeof window==='undefined'?globalThis:window);
