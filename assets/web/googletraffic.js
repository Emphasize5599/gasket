/* Anonymous Maps website forecasts. Independently implements the observed public
 * response, not a Maps API/posted-speed source. Numeric cumulative time profiles
 * avoid raster color guesses. See docs/TRAFFIC_BROAD_IMPLEMENTATION.md. */
(function(root){
 'use strict';
 var node=typeof module!=='undefined'&&module.exports,T=node?require('./trip'):root.Trip,F=node?require('./traffic'):root.Traffic,P=node?require('./trafficpolicy'):root.TrafficPolicy;
 var MI=1609.344,MINUTE=60000,DAY=86400000;
 // A Gasket reuse policy, not a claim that Google's forecasts stay unchanged.
 function avoidKey(a){a=a||{};return [!!a.highways,!!a.tolls,!!a.ferries].join('|');}
 function cacheTtl(seconds,preset){return P.resolve(preset,seconds).ttl;}
 function at(x,p){for(var i=0;i<p.length;i++){if(!Array.isArray(x))return null;x=x[p[i]];}return x;}
 function hash(s){var h=2166136261;for(var i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36);}
 function wallValue(t,zone){var parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)),v={};parts.forEach(function(p){v[p.type]=p.value;});return Math.floor(Date.UTC(+v.year,+v.month-1,+v.day,+v.hour%24,+v.minute,+v.second)/1000);}
 // Google takes a local wall clock, so the repeated hour when daylight saving ends can't say which of the two it means;
 // it gets the wall clock anyway (traffic an hour apart in the middle of the night is nearly the same). wall.repeated tells.
 function repeated(t,zone){var value=wallValue(t,zone);return wallValue(t-3600000,zone)===value||wallValue(t+3600000,zone)===value||wallValue(t-1800000,zone)===value||wallValue(t+1800000,zone)===value;}
 function wall(t,zone){return wallValue(t,zone);}
 wall.repeated=repeated;
 // Captured request fields, with no session/auth tokens. Parent lengths count all
 // descendant fields; avoid flags and the floating origin-wall clock are explicit.
 function query(a,b,clock,avoid){
  [a,b].forEach(function(p){if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)throw Error('Invalid forecast coordinates');});
  if(!Number.isSafeInteger(clock))throw Error('Invalid forecast clock');avoid=avoid||{};
  var flags=(avoid.highways?'!1b1':'')+(avoid.tolls?'!2b1':''),nf=(avoid.highways?1:0)+(avoid.tolls?1:0),ferry=avoid.ferries?'!7b1':'';
  return [a,b].map(function(p){return '!1m4!3m2!3d'+p.lat.toFixed(6)+'!4d'+p.lng.toFixed(6)+'!6e2';}).join('')+
   '!3m12!1m3!1d1433760!2d'+((a.lng+b.lng)/2).toFixed(6)+'!3d'+((a.lat+b.lat)/2).toFixed(6)+'!2m3!1f0!2f0!3f0!3m2!1i1280!2i720!4f13.1'+
   '!6m'+(63+nf+(ferry?1:0))+'!1m5!18b1!30b1!31m1!1b1!34e1!2m'+(4+nf)+flags+'!5m1!6e2!20e3!39b1!6m27!32i1!49b1!66b1!85b1!114b1!149b1!206b1!209b1!212b1!215b1!216b1!222b1!223b1!234b1!235b1!246b1!253b1!260b1!262b1!266b1!270b1!271b1!273b1!281b1!294b1!302i300!303i100'+ferry+
   '!10b1!12b1!13b1!14b1!16b1!17m2!3e1!3e1!19m3!1e0!2e2!3j'+clock+'!20m5!1e0!2e3!5e2!6b1!14b1!46m1!1b0!96b1!97m1!2b1!99b1'+
   '!20m28!1m6!1m2!1i0!2i0!2m2!1i530!2i720!1m6!1m2!1i1230!2i0!2m2!1i1280!2i720!1m6!1m2!1i0!2i0!2m2!1i1280!2i20!1m6!1m2!1i0!2i700!2m2!1i1280!2i720!27b1!28m0!40i801!47m2!8b1!10e2!50s';
 }
 function parse(body,clock){
  if(typeof body==='string'){if(body.length>6000000)throw Error('Traffic answer too large');body=JSON.parse(body.replace(/^\)\]\}'[^\n]*\n/,''));}
  var echo=at(body,[0,11]),routes=at(body,[0,1]),lines=at(body,[0,7]);
  if(typeof echo!=='string'||!echo.includes('!8j'+clock+'!'))throw Error('Google did not confirm the requested forecast clock');
  if(!Array.isArray(routes)||!Array.isArray(lines)||routes.length>12)throw Error('Google forecast schema changed');
  var out=[];
  routes.forEach(function(r,i){
   var meters=at(r,[0,2,0]),seconds=at(r,[0,10,0,0]),low=at(r,[0,10,4,0]),high=at(r,[0,10,4,1]),data=at(r,[3,0]),g=lines[i];
   if(!(meters>0)||!(seconds>0)||!Array.isArray(data)||data.length<2||!g||!Array.isArray(g[0])||g[0].length!==g[1].length||g[0].length>120000)return;
   var pts=[],cum=[0],lat=0,lng=0,bad=false;
   g[0].forEach(function(d,k){lat+=d;lng+=g[1][k];var p={lat:lat/1e7,lng:lng/1e7};if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)bad=true;pts.push(p);if(k)cum.push(cum[k-1]+T.hav(pts[k-1],p));});
   var last=data[data.length-1],prev=[-1,-1];
   data.forEach(function(x){if(!Array.isArray(x)||!Number.isFinite(x[0])||!Number.isFinite(x[1])||x[0]<prev[0]||x[1]<prev[1])bad=true;prev=x;});
   if(bad||Math.abs(last[0]-meters)>Math.max(25,meters*.02)||Math.abs(cum[cum.length-1]*MI-meters)>Math.max(100,meters*.03)||Math.abs(last[1]-seconds)>Math.max(180,seconds*.1))return;
   out.push({pts:pts,cum:cum,meters:meters,seconds:last[1],low:low>0?low:last[1],high:high>0?high:last[1],data:data,name:at(r,[0,1])||'',zone:at(r,[1,0,4,4]),clock:clock});
  });
  if(!out.length)throw Error('No usable time-specific Google traffic profiles');return out;
 }
 function match(p,m,projected){
  // Validate intermediate geometry as well as endpoints, in route order. A
  // different carriageway/detour must not inherit the chosen road's forecast.
  var on=[],prev=-Infinity,good=0;
  p.pts.forEach(function(pt,i){var x=projected?projected[i]:T.project(m,pt),d=p.cum[i];if(x.offset<=.015&&x.along>=prev-.025){on.push({d:d,a:x.along});prev=Math.max(prev,x.along);good++;}else on.push({d:d,a:null});});
  var rows=[],j=0,total=p.cum[p.cum.length-1];
  function located(meters){var d=meters/p.meters*total;while(j<on.length-2&&on[j+1].d<d)j++;var a=on[j],b=on[j+1];if(a.a==null||b.a==null)return null;return a.a+(b.a-a.a)*Math.max(0,Math.min(1,(d-a.d)/Math.max(1e-12,b.d-a.d)));}
  var a=located(p.data[0][0]),fromIndex=0;
  for(var i=1;i<p.data.length;i++){
   var b=located(p.data[i][0]),dt=p.data[i][1]-p.data[fromIndex][1],len=(p.data[i][0]-p.data[fromIndex][0])/MI;
   if(dt<=0)continue;
   var valid=a!=null&&b!=null&&b>a&&Math.abs(b-a-len)<=Math.max(.008,len*.08);
   // Any off-route vertex inside this interval invalidates it, even if both ends match.
   var d0=p.data[fromIndex][0]/p.meters*total,d1=p.data[i][0]/p.meters*total;
   for(var k=Math.max(0,j-1);k>=0&&on[k].d>=d0;k--)if(on[k].d<=d1&&on[k].a==null)valid=false;
   if(valid){var base=m.timeTo(b)-m.timeTo(a);rows.push({from:a,to:b,seconds:dt,baseSeconds:base,trafficMph:(b-a)/dt*3600,freeMph:base>0?(b-a)/base*3600:null,forecast:true});}
   fromIndex=i;a=b;
  }
  rows.sort(function(a,b){return a.from-b.from;});var filled=[],pos=0,matched=0;
  function gap(end){if(end>pos+1e-7){var t=m.timeTo(end)-m.timeTo(pos);filled.push({from:pos,to:end,seconds:t,baseSeconds:t,forecast:false,trafficMph:null,freeMph:null});pos=end;}}
  rows.forEach(function(r){if(r.from<pos-.002||r.to<=pos)return;gap(r.from);filled.push(r);matched+=r.to-r.from;pos=r.to;});gap(m.totalMi);
  return {rows:filled,seconds:filled.reduce(function(n,r){return n+r.seconds;},0),baseSeconds:m.durationSec,coverage:matched/m.totalMi,low:p.low,high:p.high,source:'Google Maps website forecast',match:{coverage:matched/m.totalMi,pointsOff:on.length-good,routePoints:m.pts.length},clock:p.clock};
 }
 function read(body,clock,m){var best=null;parse(body,clock).forEach(function(p){var x=match(p,m);if(!best||x.coverage>best.coverage)best=x;});if(!best||best.coverage<.7){var e=Error('Google forecast follows different roads ('+Math.round((best?best.coverage:0)*100)+'% matched)');e.details=best&&best.match;throw e;}return best;}
 function mismatch(best){var e=Error('Google forecast follows different roads ('+Math.round((best?best.coverage:0)*100)+'% matched)');e.details=best&&best.match;e.mismatch=true;return e;}
 // minCover 0 keeps a partly matched profile: its unmatched stretches are already forecast:false gaps at the route's own time.
 var projections=new Map();
 // Google's points come in road order, so each is first looked for just past the last one's match; a point not on
 // that stretch (within the .015 mi the matcher uses) falls back to the whole-piece search.
 function segAt(m,along){var lo=1,hi=m.cum.length-1;while(lo<hi){var mid=(lo+hi)>>1;if(m.cum[mid]<along)lo=mid+1;else hi=mid;}return lo;}
 function follow(m,p,hint,step){var kx=69.17*Math.cos(p.lat*Math.PI/180),ky=69,px=p.lng*kx,py=p.lat*ky,best=null,limit=m.cum[hint]+step*1.5+.05;
  for(var i=Math.max(1,hint-2);i<m.pts.length&&m.cum[i-1]<=limit;i++){var a=m.pts[i-1],b=m.pts[i],ax=a.lng*kx,ay=a.lat*ky,dx=b.lng*kx-ax,dy=b.lat*ky-ay,L2=dx*dx+dy*dy,t=L2>0?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/L2)):0,qx=ax+t*dx-px,qy=ay+t*dy-py,off=Math.sqrt(qx*qx+qy*qy);if(!best||off<best.offset)best={along:m.cum[i-1]+t*(m.cum[i]-m.cum[i-1]),offset:off,seg:i};}
  return best&&best.offset<=.015?best:null;}
 async function projectShared(m,p,valid){var key=T.encodePolyline(m.pts)+'|'+m.totalMi+'|'+T.encodePolyline(p.pts),job=projections.get(key);if(!job){job=(async function(){return projectAll(m,p);})();projections.set(key,job);job.catch(function(){if(projections.get(key)===job)projections.delete(key);});while(projections.size>128)projections.delete(projections.keys().next().value);}return job;}
 async function projectAll(m,p){var rows=[],hint=-1;for(var k=0;k<p.pts.length;k++){var x=hint>0?follow(m,p.pts[k],hint,k?p.cum[k]-p.cum[k-1]:0):null;if(!x){x=T.project(m,p.pts[k]);x.seg=x.offset<=.015?segAt(m,x.along):-1;}hint=x.seg;rows.push(x);if(k%128===127)await new Promise(function(r){setTimeout(r,0);});}return rows;}
 async function readAsync(body,clock,m,valid,minCover){var sources=parse(body,clock),best=null;if(minCover==null)minCover=.7;
  for(var i=0;i<sources.length;i++){var p=sources[i],projected=await projectShared(m,p,valid);if(valid&&!valid())throw Error('Traffic lookup cancelled');var x=match(p,m,projected);if(!best||x.coverage>best.coverage)best=x;}
  if(!best||best.coverage<minCover||!(best.coverage>0))throw mismatch(best);return best;
 }
 // A stretch Google routes on other roads keeps the route's own time; the whole forecast fails only below MIN_COVER.
 var MIN_COVER=.5;
 function unmatched(m,why){var t=m.durationSec;return {rows:[{from:0,to:m.totalMi,seconds:t,baseSeconds:t,forecast:false,trafficMph:null,freeMph:null}],seconds:t,baseSeconds:t,coverage:0,low:t,high:t,source:'Google Maps website forecast',match:{coverage:0,why:why},unmatched:true};}
 function boundaries(m,cell){cell=cell||1;var out=[];for(var i=1;i<m.pts.length;i++){var a=m.pts[i-1],b=m.pts[i];['lat','lng'].forEach(function(k){var lo=Math.min(a[k],b[k]),hi=Math.max(a[k],b[k]);for(var edge=Math.floor(lo/cell)+1;edge*cell<hi;edge++){var f=(edge*cell-a[k])/(b[k]-a[k]);out.push(m.cum[i-1]+f*(m.cum[i]-m.cum[i-1]));}});}return out;}
 async function reuse(ob,m,t,valid){
  if(!ob||!ob.pts||!ob.rows||!Number.isFinite(ob.depart))return null;
  var elapsed=0,segs=ob.rows.map(function(r){var s=Object.assign({},r,{t0:elapsed,t1:elapsed+r.seconds,gpm:0,mph:(r.to-r.from)/r.seconds*3600});elapsed+=r.seconds;return s;}),cached=T.restoreModel({pts:ob.pts,cum:ob.cum,segs:segs,totalMi:ob.cum[ob.cum.length-1],durationSec:elapsed,legEnds:[],cityGpm:0,hwyGpm:0,combGpm:0});
  var a=T.project(cached,m.pts[0]),b=T.project(cached,m.pts[m.pts.length-1]);if(a.offset>.015||b.offset>.015||b.along<=a.along||Math.abs(t-ob.depart-cached.timeTo(a.along)*1000)>150000)return null;
  var sub=F.slice(cached,a.along,b.along);if(sub.segs.some(function(s){return s.forecast===false;}))return null;
  var data=[[0,0]];sub.segs.forEach(function(s){data.push([s.to*MI,s.t1]);});var p={pts:sub.pts,cum:sub.cum,meters:sub.totalMi*MI,seconds:sub.durationSec,low:sub.durationSec,high:sub.durationSec,data:data},projected=[];
  for(var k=0;k<p.pts.length;k++){if(k%128===0&&valid&&!valid())throw Error('Traffic lookup cancelled');projected.push(T.project(m,p.pts[k]));if(k%128===127)await new Promise(function(r){setTimeout(r,0);});}var result=match(p,m,projected);return result.coverage>=.95?result:null;
 }
 function create(io){
  // tune: lookahead reads (speculate) use only reader slots no route is waiting on; a piece whose real departure lands
  // within specTolerance minutes of a lookahead read uses that read. tolerance: a stored piece this many minutes off is reused.
  // Defaults chosen with tools/simulate-traffic-reads.cjs: about 1.5–2× faster for one route or rest timing, results
  // within about a minute on a 20-hour drive. Longer pieces were faster still but Google's own road choice can't be simulated.
  var tune=Object.assign({speculate:true,specTolerance:2,tolerance:2,pieceMi:100,cellDeg:1,maxSpec:1,lookahead:2},io.tune||{});
  var active=0,activeLow=0,queue=[],low=[],pending=new Map(),items=new Map(),epoch=0,chains=0;
  function cap(){return Math.max(1,Math.min(50,Math.round(io.concurrency?io.concurrency():2)||2));}
  function limited(fn,opt){var x={fn:fn,low:!!(opt&&opt.low),alive:opt&&opt.alive},pr=new Promise(function(resolve,reject){x.resolve=resolve;x.reject=reject;});(x.low?low:queue).push(x);if(opt&&opt.item)opt.item.x=x;pump();return pr;}
  function promote(x){if(!x||!x.low)return;x.low=false;var i=low.indexOf(x);if(i>=0){low.splice(i,1);queue.push(x);pump();}}
  function purge(){low=low.filter(function(x){if(x.alive&&!x.alive()){x.reject(Error('Traffic lookup cancelled'));return false;}return true;});}
  function pump(){var n=cap();while(active<n){var x=null;if(queue.length)x=queue.shift();else if(low.length&&activeLow<n-chains)x=low.shift();else break;if(x.low&&x.alive&&!x.alive()){x.reject(Error('Traffic lookup cancelled'));continue;}var wasLow=x.low;active++;if(wasLow)activeLow++;(function(x,wasLow){Promise.resolve().then(x.fn).then(x.resolve,x.reject).finally(function(){active--;if(wasLow)activeLow--;pump();});})(x,wasLow);}}
  function get(k,ttl){var r=io.get&&io.get(k,ttl);return r&&r.v||r;}
  async function piece(m,t,o){
   var valid=o.valid||function(){return true;},zone=await io.zone(m.pts[0],valid),clock=wall(Math.ceil(t/MINUTE)*MINUTE,zone),q=query(m.pts[0],m.pts[m.pts.length-1],clock,o.avoid),line=T.encodePolyline(m.pts),identity=q+'|'+line,key='google-v1|'+hash(identity),now=io.now?io.now():Date.now(),ttl=o.cachePolicy.ttl,held=get(key,ttl),fresh=o.freshAfter||0;
   function usable(hp){return hp&&Array.isArray(hp.rows)&&hp.rows.length&&Number.isFinite(hp.at)&&hp.at>=fresh&&now-hp.at<ttl&&hp.seconds>0;}
   if(!valid())throw Error('Traffic lookup cancelled');
   if(!o.force&&held&&held.identity===identity){if(held.unmatched&&Number.isFinite(held.at)&&held.at>=fresh&&now-held.at<10*MINUTE)return Object.assign(unmatched(m,held.unmatched),{at:held.at,depart:t,cached:true});var hp=held.profile;if(usable(hp))return Object.assign({},hp,{cached:true});}
   if(!o.force&&tune.tolerance>0)for(var dm=1;dm<=tune.tolerance;dm++)for(var sg=-1;sg<=1;sg+=2){var qd=query(m.pts[0],m.pts[m.pts.length-1],clock+sg*dm*60,o.avoid),hd=get('google-v1|'+hash(qd+'|'+line),ttl);if(hd&&hd.identity===qd+'|'+line&&usable(hd.profile))return Object.assign({},hd.profile,{cached:true,nearMinutes:sg*dm});}
   if(!o.force&&io.observations){var candidates=io.observations(m,t,ttl)||[];for(var ci=0;ci<candidates.length;ci++){var ob=candidates[ci].observation;if(!ob||ob.avoidKey!==avoidKey(o.avoid)||!candidates[ci].profile||candidates[ci].profile.at<fresh)continue;var shared=await reuse(ob,m,t,valid);if(!valid())throw Error('Traffic lookup cancelled');if(shared)return Object.assign(shared,{at:candidates[ci].profile.at,depart:t,cached:true,sharedRoads:true});}}

   var pendingKey=identity+(fresh?'|after|'+fresh:o.force?'|force':'');
   if(o.onQueue)o.onQueue();
   if(pending.has(pendingKey)){if(!o.low)promote(items.get(pendingKey));}
   else{var generation=epoch,slot={};pending.set(pendingKey,limited(async function(){if(o.onStart)o.onStart();if(!valid()||generation!==epoch)throw Error('Traffic lookup cancelled');var r=await io.fetch(q,valid);if(r.error)throw Error(r.error);var p,alive=function(){return generation===epoch;};try{p=await readAsync(r.body||r,clock,m,alive,0);}catch(e){if(!e.mismatch&&!/No usable time-specific/.test(e.message))throw e;var why=String(e.message).slice(0,120);if(io.put&&alive())io.put(key,{identity:identity,unmatched:why,at:now});if(!valid()||generation!==epoch)throw Error('Traffic lookup cancelled');return Object.assign(unmatched(m,why),{at:now,depart:t,cached:false});}p.at=now;p.depart=t;p.originZone=zone;p.cached=false;// A forecast that was read is kept even if the plan that asked for it was cancelled or failed: it's valid for its own road and time.
   if(io.put&&alive())io.put(key,p.coverage>=.95?{identity:identity,profile:p,observation:{pts:m.pts,cum:m.cum,rows:p.rows,depart:t,avoidKey:avoidKey(o.avoid)}}:{identity:identity,profile:p});if(!valid()||generation!==epoch)throw Error('Traffic lookup cancelled');return p;},{low:o.low,alive:o.alive,item:slot}).finally(function(){pending.delete(pendingKey);items.delete(pendingKey);}));items.set(pendingKey,slot.x);}
   var p=await pending.get(pendingKey);if(!valid())throw Error('Traffic lookup cancelled');return p;
  }
  async function forecast(m,depart,options){
   var o=Object.assign({},options||{});o.cachePolicy=io.policy?io.policy(m,o):P.resolve(o.trafficPreset,o.journeySeconds||m.durationSec);var waits=(options&&options.waits||[]).slice(),ends=(m.legEnds&&m.legEnds.length?m.legEnds:[m.totalMi]).slice(),stops=(o.stops||[]).slice().sort(function(a,b){return a.d-b.d;}),breaks=ends.concat(stops.map(function(s){return s.d;}),waits.map(function(w){return w.d;}),o.waitAt?[o.waitAt.d]:[]);
   // Each source profile evaluates its own roads at arrival. Split at destinations, stops and geographic cells to
   // reuse overlapping roads. Never spread a whole-trip delay over every mile.
   for(var d=tune.pieceMi;d<m.totalMi;d+=tune.pieceMi)breaks.push(d);breaks=breaks.concat(boundaries(m,tune.cellDeg));breaks=Array.from(new Set(breaks.map(function(d){return Math.abs(d-m.totalMi)<1e-6?m.totalMi:d;}).filter(function(d){return d>0&&d<=m.totalMi;}).concat([m.totalMi]))).sort(function(a,b){return a-b;});
   if(o.progress)o.progress(0,breaks.length);var rows=[],legs=[],clock=depart,start=0,oldest=Infinity,cached=true,cachedPieces=0,fetchedPieces=0,sharedPieces=0,seconds=0,low=0,high=0,lookahead=0,lookaheadUsed=0;
   var began=io.now?io.now():Date.now(),bases=breaks.map(function(end,i){return F.slice(m,i?breaks[i-1]:0,end);}),specs=[],done=false,tolMs=tune.specTolerance*MINUTE,baseSum=0,trafficSum=0;
   function advance(i,c,secs,real){var end=breaks[i];c+=secs*1000;stops.forEach(function(s){if(Math.abs(s.d-end)<.0001)c+=Math.max(0,s.seconds||0)*1000;});waits.forEach(function(w){if(Math.abs(w.d-end)<.0001)c=Math.max(c,w.at);});if(o.waitAt&&Math.abs(o.waitAt.d-end)<.001){if(real&&o.strictWait&&c>o.waitAt.at)throw Error('Return departure is before arrival');c=Math.max(c,o.waitAt.at);}return c;}
   // Lookahead: guess later pieces' departures from the traffic seen so far and read them in idle reader slots.
   function guess(i){var ratio=baseSum>0?trafficSum/baseSum:1,c=clock;for(var j=i;j<Math.min(breaks.length,i+1+tune.lookahead);j++){if(j>i){var list=specs[j]||(specs[j]=[]);if(!list.some(function(e){return Math.abs(e.clock-c)<=tolMs;})){var live=list.filter(function(e){return !e.dead&&!e.started;});if(live.length>=tune.maxSpec)live[0].dead=true;var e={clock:c,dead:false};e.promise=piece(bases[j],c,Object.assign({},o,{low:true,progress:null,onStart:(function(e){return function(){e.started=true;};})(e),alive:(function(e){return function(){return !e.dead&&!done;};})(e)}));e.promise.catch(function(){});list.push(e);lookahead++;}}c=advance(j,c,bases[j].durationSec*ratio,false);}}
   chains++;
   try{
   for(var i=0;i<breaks.length;i++){
    if(o.valid&&!o.valid())throw Error('Traffic lookup cancelled');var end=breaks[i],base=bases[i],hit=(specs[i]||[]).filter(function(e){return Math.abs(e.clock-clock)<=tolMs;}).sort(function(a,b){return Math.abs(a.clock-clock)-Math.abs(b.clock-clock);})[0],p=null,queued,reading=new Promise(function(r){queued=r;}),job=piece(base,hit?hit.clock:clock,Object.assign({},o,{onQueue:queued}));job.catch(function(){});
    // Read ahead only while this piece goes to Google: a stored piece answers at once and the next departure is known.
    if(tune.speculate&&i+1<breaks.length){var quick=await Promise.race([job.then(function(){return true;},function(){return true;}),reading.then(function(){return false;})]);if(!quick)guess(i);}
    if(hit){try{p=await job;lookaheadUsed++;}catch(e){if(o.valid&&!o.valid())throw e;p=null;}}
    if(!p)p=hit?await piece(base,clock,o):await job;if(p.cached&&!p.sharedRoads&&p.at>=began)p=Object.assign({},p,{cached:false});(specs[i]||[]).forEach(function(e){e.dead=true;});if(p.cached)cachedPieces++;else fetchedPieces++;if(p.sharedRoads)sharedPieces++;if(o.progress)o.progress(i+1,breaks.length,{cached:!!p.cached});
    p.rows.forEach(function(r){rows.push(Object.assign({},r,{from:r.from+start,to:r.to+start}));});legs.push({from:start,to:end,departure:clock,seconds:p.seconds,coverage:p.coverage,match:p.match});if(!p.unmatched)oldest=Math.min(oldest,p.at);baseSum+=base.durationSec;trafficSum+=p.seconds;clock=advance(i,clock,p.seconds,true);seconds+=p.seconds;low+=p.low||p.seconds;high+=p.high||p.seconds;cached=cached&&p.cached;start=end;
   }
   }finally{done=true;chains--;purge();pump();}
   if(o.progress)o.progress(breaks.length,breaks.length);var covered=rows.reduce(function(n,r){return n+(r.forecast===false?0:r.to-r.from);},0)/m.totalMi;
   if(covered+1e-6<MIN_COVER){var miss=Error('Google forecast matched only '+Math.round(covered*100)+'% of this route');miss.details={coverage:covered,pieces:legs.length,unmatchedPieces:legs.filter(function(l){return !(l.coverage>0);}).length};throw miss;}
   return {source:'Google Maps website forecast',cachePolicy:o.cachePolicy,estimated:true,rows:rows,legs:legs,lowSeconds:low,highSeconds:high,seconds:seconds,baseSeconds:m.durationSec,depart:depart,arrival:clock,at:oldest,cached:cached,cachedPieces:cachedPieces,fetchedPieces:fetchedPieces,sharedPieces:sharedPieces,lookaheadReads:lookahead,lookaheadUsed:lookaheadUsed,readMs:(io.now?io.now():Date.now())-began,coverage:rows.reduce(function(n,r){return n+(r.forecast===false?0:r.to-r.from);},0)/m.totalMi};
  }
  return {request:function(q,valid){return limited(function(){if(valid&&!valid())throw Error('Traffic lookup cancelled');return io.fetch(q,valid||function(){return true;});});},forecast:forecast,retryFailures:function(){},clear:function(){epoch++;pending.clear();items.clear();}};
 }
 var api={projectAll:projectAll,cacheTtl:cacheTtl,MIN_COVER:MIN_COVER,unmatched:unmatched,wall:wall,query:query,parse:parse,match:match,read:read,readAsync:readAsync,reuse:reuse,boundaries:boundaries,create:create,hash:hash};if(node)module.exports=api;else root.GoogleTraffic=api;
})(typeof window!=='undefined'?window:this);
