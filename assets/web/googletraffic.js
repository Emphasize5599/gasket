/* Anonymous Maps website forecasts. Independently implements the observed public
 * response, not a Maps API/posted-speed source. Numeric cumulative time profiles
 * avoid raster color guesses. See docs/TRAFFIC_BROAD_IMPLEMENTATION.md. */
(function(root){
 'use strict';
 var node=typeof module!=='undefined'&&module.exports,T=node?require('./trip'):root.Trip,F=node?require('./traffic'):root.Traffic;
 var MI=1609.344,MINUTE=60000,DAY=86400000;
 function at(x,p){for(var i=0;i<p.length;i++){if(!Array.isArray(x))return null;x=x[p[i]];}return x;}
 function hash(s){var h=2166136261;for(var i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36);}
 function wall(t,zone){var parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)),v={};parts.forEach(function(p){v[p.type]=p.value;});return Math.floor(Date.UTC(+v.year,+v.month-1,+v.day,+v.hour%24,+v.minute,+v.second)/1000);}
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
 async function readAsync(body,clock,m){var sources=parse(body,clock),best=null;
  for(var i=0;i<sources.length;i++){var p=sources[i],projected=[];for(var k=0;k<p.pts.length;k++){projected.push(T.project(m,p.pts[k]));if(k%128===127)await new Promise(function(r){setTimeout(r,0);});}var x=match(p,m,projected);if(!best||x.coverage>best.coverage)best=x;}
  if(!best||best.coverage<.7)throw Error('Google forecast follows different roads ('+Math.round((best?best.coverage:0)*100)+'% matched)');return best;
 }
 function boundaries(m){var out=[];for(var i=1;i<m.pts.length;i++){var a=m.pts[i-1],b=m.pts[i];['lat','lng'].forEach(function(k){var lo=Math.min(a[k],b[k]),hi=Math.max(a[k],b[k]);for(var edge=Math.floor(lo)+1;edge<hi;edge++){var f=(edge-a[k])/(b[k]-a[k]);out.push(m.cum[i-1]+f*(m.cum[i]-m.cum[i-1]));}});}return out;}
 async function reuse(ob,m,t){
  if(!ob||!ob.pts||!ob.rows||!Number.isFinite(ob.depart))return null;
  var elapsed=0,segs=ob.rows.map(function(r){var s=Object.assign({},r,{t0:elapsed,t1:elapsed+r.seconds,gpm:0,mph:(r.to-r.from)/r.seconds*3600});elapsed+=r.seconds;return s;}),cached=T.restoreModel({pts:ob.pts,cum:ob.cum,segs:segs,totalMi:ob.cum[ob.cum.length-1],durationSec:elapsed,legEnds:[],cityGpm:0,hwyGpm:0,combGpm:0});
  var a=T.project(cached,m.pts[0]),b=T.project(cached,m.pts[m.pts.length-1]);if(a.offset>.015||b.offset>.015||b.along<=a.along||Math.abs(t-ob.depart-cached.timeTo(a.along)*1000)>150000)return null;
  var sub=F.slice(cached,a.along,b.along);if(sub.segs.some(function(s){return s.forecast===false;}))return null;
  var data=[[0,0]];sub.segs.forEach(function(s){data.push([s.to*MI,s.t1]);});var p={pts:sub.pts,cum:sub.cum,meters:sub.totalMi*MI,seconds:sub.durationSec,low:sub.durationSec,high:sub.durationSec,data:data},projected=[];
  for(var k=0;k<p.pts.length;k++){projected.push(T.project(m,p.pts[k]));if(k%128===127)await new Promise(function(r){setTimeout(r,0);});}var result=match(p,m,projected);return result.coverage>=.95?result:null;
 }
 function create(io){
  var active=0,queue=[],pending=new Map(),epoch=0;
  function limited(fn){return new Promise(function(resolve,reject){queue.push({fn:fn,resolve:resolve,reject:reject});pump();});}
  function pump(){while(active<2&&queue.length){var x=queue.shift();active++;(function(x){Promise.resolve().then(x.fn).then(x.resolve,x.reject).finally(function(){active--;pump();});})(x);}}
  function get(k,ttl){var r=io.get&&io.get(k,ttl);return r&&r.v||r;}
  async function piece(m,t,o){
   var valid=o.valid||function(){return true;},zone=await io.zone(m.pts[0],valid),clock=wall(Math.ceil(t/MINUTE)*MINUTE,zone),q=query(m.pts[0],m.pts[m.pts.length-1],clock,o.avoid),identity=q+'|'+T.encodePolyline(m.pts),key='google-v1|'+hash(identity),now=io.now?io.now():Date.now(),ttl=Math.abs(t-now)<3600000?10*MINUTE:6*3600000,held=get(key,ttl);
   if(held&&held.identity===identity)return Object.assign({},held.profile,{cached:true});if(!valid())throw Error('Traffic lookup cancelled');
   if(io.observations){var candidates=io.observations(m,t,ttl)||[];for(var ci=0;ci<candidates.length;ci++){var shared=await reuse(candidates[ci].observation,m,t);if(!valid())throw Error('Traffic lookup cancelled');if(shared)return Object.assign(shared,{at:candidates[ci].profile.at,depart:t,cached:true,sharedRoads:true});}}

   if(!pending.has(identity)){var generation=epoch;pending.set(identity,limited(async function(){if(!valid()||generation!==epoch)throw Error('Traffic lookup cancelled');var r=await io.fetch(q,valid);if(r.error)throw Error(r.error);var p=await readAsync(r.body||r,clock,m);p.at=now;p.depart=t;p.originZone=zone;p.cached=false;if(!valid()||generation!==epoch)throw Error('Traffic lookup cancelled');if(io.put)io.put(key,{identity:identity,profile:p,observation:{pts:m.pts,cum:m.cum,rows:p.rows,depart:t}});return p;}).finally(function(){pending.delete(identity);}));}
   var p=await pending.get(identity);if(!valid())throw Error('Traffic lookup cancelled');return p;
  }
  async function forecast(m,depart,options){
   var o=options||{},ends=(m.legEnds&&m.legEnds.length?m.legEnds:[m.totalMi]).slice(),stops=(o.stops||[]).slice().sort(function(a,b){return a.d-b.d;}),breaks=ends.concat(stops.map(function(s){return s.d;}));
   // Each source profile evaluates its own roads at arrival. Split at destinations, stops and geographic cells to
   // reuse overlapping roads. Never spread a whole-trip delay over every mile.
   for(var d=100;d<m.totalMi;d+=100)breaks.push(d);breaks=breaks.concat(boundaries(m));breaks=Array.from(new Set(breaks.filter(function(d){return d>0&&d<=m.totalMi;}))).sort(function(a,b){return a-b;});
   var rows=[],legs=[],clock=depart,start=0,oldest=Infinity,cached=true,seconds=0;
   for(var i=0;i<breaks.length;i++){
    if(o.valid&&!o.valid())throw Error('Traffic lookup cancelled');var end=breaks[i],base=F.slice(m,start,end),p=await piece(base,clock,o);if(o.progress)o.progress(i,breaks.length);
    p.rows.forEach(function(r){rows.push(Object.assign({},r,{from:r.from+start,to:r.to+start}));});legs.push({from:start,to:end,departure:clock,seconds:p.seconds,coverage:p.coverage,match:p.match});clock+=p.seconds*1000;seconds+=p.seconds;oldest=Math.min(oldest,p.at);cached=cached&&p.cached;
    stops.forEach(function(s){if(Math.abs(s.d-end)<.0001)clock+=Math.max(0,s.seconds||0)*1000;});if(o.waitAt&&Math.abs(o.waitAt.d-end)<.001){if(o.strictWait&&clock>o.waitAt.at)throw Error('Return departure is before arrival');clock=Math.max(clock,o.waitAt.at);}start=end;
   }
   if(o.progress)o.progress(breaks.length,breaks.length);return {source:'Google Maps website forecast',estimated:true,rows:rows,legs:legs,seconds:seconds,baseSeconds:m.durationSec,depart:depart,arrival:clock,at:oldest,cached:cached,coverage:rows.reduce(function(n,r){return n+(r.forecast===false?0:r.to-r.from);},0)/m.totalMi};
  }
  return {forecast:forecast,retryFailures:function(){},clear:function(){epoch++;pending.clear();}};
 }
 var api={wall:wall,query:query,parse:parse,match:match,read:read,readAsync:readAsync,reuse:reuse,boundaries:boundaries,create:create,hash:hash};if(node)module.exports=api;else root.GoogleTraffic=api;
})(typeof window!=='undefined'?window:this);
