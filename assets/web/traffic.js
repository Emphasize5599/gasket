/* Time-dependent routing. Independent implementation of HERE's documented formats;
 * no Google color-to-mph assumptions or Vela source code. See docs/TRAFFIC.md. */
(function(root){
  'use strict';
  var T=typeof module!=='undefined'&&module.exports?require('./trip.js'):root.Trip;
  var alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function decode(text){
    var pos=0;
    function uint(){var v=0,m=1,n=0,c;do{if(pos>=text.length||++n>10)throw Error('Invalid flexible polyline');c=alphabet.indexOf(text[pos++]);if(c<0)throw Error('Invalid flexible polyline');v+=(c%32)*m;m*=32;}while(c>=32);if(!Number.isSafeInteger(v))throw Error('Polyline overflow');return v;}
    function signed(){var v=uint();return v%2?-(v+1)/2:v/2;}
    if(typeof text!=='string'||text.length>3000000||uint()!==1)throw Error('Unsupported flexible polyline');
    var header=uint(),scale=Math.pow(10,header%16),third=Math.floor(header/16)%8,lat=0,lng=0,out=[];
    while(pos<text.length){lat+=signed();lng+=signed();if(third)signed();var p={lat:lat/scale,lng:lng/scale};if(Math.abs(p.lat)>90||Math.abs(p.lng)>180||out.length>=200000)throw Error('Invalid polyline coordinates');out.push(p);}
    if(out.length<2)throw Error('Empty flexible polyline');return out;
  }
  function slice(m,a,b){
    var pts=[m.pointAt(a)],cum=[0];m.cum.forEach(function(d,i){if(d>a&&d<b){pts.push(m.pts[i]);cum.push(d-a);}});pts.push(m.pointAt(b));cum.push(b-a);
    var secs=m.segs.filter(function(s){return s.to>a&&s.from<b;}).map(function(s){var f=Math.max(a,s.from),t=Math.min(b,s.to),z=(s.t1-s.t0)/(s.to-s.from);return Object.assign({},s,{from:f-a,to:t-a,t0:m.timeTo(f)-m.timeTo(a),t1:m.timeTo(f)-m.timeTo(a)+(t-f)*z});});
    return T.restoreModel(Object.assign({},m,{pts:pts,cum:cum,segs:secs,totalMi:b-a,legEnds:[b-a],durationSec:m.timeTo(b)-m.timeTo(a)}));
  }
  function query(m,depart,stops,avoid){
    if(!(m.totalMi>0)||!Number.isFinite(+depart))throw Error('A route and departure are required');
    function at(d){var p=m.pointAt(d);return p.lat.toFixed(6)+','+p.lng.toFixed(6);}
    var q=['transportMode=car','origin='+at(0),'destination='+at(m.totalMi),'departureTime='+encodeURIComponent(new Date(+depart).toISOString()),'return=polyline,summary','spans=length,duration,dynamicSpeedInfo'];
    var via=[],n=Math.min(32,Math.max(1,Math.ceil(m.totalMi/4)));
    for(var i=1;i<=n;i++){var want=m.totalMi*i/(n+1),best=1;for(var k=2;k<m.cum.length-1;k++)if(Math.abs(m.cum[k]-want)<Math.abs(m.cum[best]-want))best=k;if(m.cum.length>2)via.push({d:m.cum[best],pass:true});}
    (stops||[]).forEach(function(s){if(!(s.seconds>=0&&s.seconds<50000)||!Number.isFinite(s.seconds)||!(s.d>0&&s.d<m.totalMi))throw Error('Unsupported traffic stop');if(s.seconds)via.push({d:s.d,seconds:Math.ceil(s.seconds)});});
    via=via.filter(function(p){return !p.pass||!via.some(function(s){return !s.pass&&Math.abs(s.d-p.d)<.02;});});via.sort(function(a,b){return a.d-b.d;});
    var merged=[];via.forEach(function(s){var last=merged[merged.length-1];if(last&&Math.abs(last.d-s.d)<.00001){if(s.seconds)last.seconds=(last.seconds||0)+s.seconds;last.pass=last.pass&&s.pass;}else merged.push(Object.assign({},s));});
    merged.forEach(function(s){if(s.seconds>=50000)throw Error('Unsupported traffic stop');q.push('via='+at(s.d)+(s.pass?'!passThrough=true':'!stopDuration='+s.seconds));});
    var features=[];if(avoid&&avoid.tolls)features.push('tollRoad');if(avoid&&avoid.highways)features.push('controlledAccessHighway');if(avoid&&avoid.ferries)features.push('ferry');if(features.length)q.push('avoid%5Bfeatures%5D='+features.join(','));
    var out=q.join('&');if(out.length>3900)throw Error('Too many traffic stop points');return out;
  }
  // HERE's line is matched to the selected route stretch by stretch. A HERE span is used only where every one of its
  // points lies on our line (<= TOL), in order, and its length agrees with the stretch it covers; anything else (HERE
  // leaving the origin by another street, a different interchange, coarse website geometry on a curve) keeps the
  // route's own estimate there, marked forecast:false. 0.0.280 log: every long-trip forecast was rejected whole at
  // HERE's second point, 239 ft off at the start, so no traffic was ever applied.
  var TOL=.03,MIN_COVER=.5;
  function read(json,m){
    var r=json&&json.routes&&json.routes[0],used=[],prev=0,misses=0,offMax=0,firstMiss=null,spansSkipped=0,speedsMissing=0,firstMissing=null;
    if(!r||!r.sections||!r.sections.length)throw Error('No traffic route returned');
    r.sections.forEach(function(sec){
      if((sec.notices||[]).some(function(n){return n.severity==='critical';}))throw Error('Traffic route has a critical restriction');
      var pts=decode(sec.polyline),on=pts.map(function(p){var x=T.project(m,p);if(x&&x.offset<=TOL&&x.along>=prev-.04){prev=Math.max(prev,x.along);return x.along;}
        misses++;if(x&&Number.isFinite(x.offset)&&x.offset>offMax)offMax=x.offset;if(firstMiss==null)firstMiss=x&&Number.isFinite(x.along)?prev:0;return null;});
      var spans=sec.spans;if(!spans||!spans.length||spans[0].offset!==0)throw Error('Incomplete traffic speeds');
      spans.forEach(function(s,i){
        var next=i+1<spans.length?spans[i+1].offset:pts.length-1;
        if(!Number.isInteger(s.offset)||!Number.isInteger(next)||s.offset<0||next<=s.offset||next>=pts.length)throw Error('Invalid traffic span');
        var speed=s.dynamicSpeedInfo,seconds=Number(s.duration),length=Number(s.length);
        // Zero-duration connector spans and locally absent speeds must not discard an otherwise usable forecast.
        // Keep those stretches explicitly unforecast; never interpret a missing speed as free-flow or a closure.
        if(!(seconds>0)||!Number.isFinite(seconds)||!speed||!(speed.trafficSpeed>0)||!(speed.baseSpeed>0)||!Number.isFinite(speed.trafficSpeed)||!Number.isFinite(speed.baseSpeed)||!(length>0)||!Number.isFinite(length)){
          speedsMissing++;spansSkipped++;if(!firstMissing)firstMissing={offset:s.offset,length:s.length,duration:s.duration,dynamicSpeedInfo:speed||null};return;
        }
        var ok=true;for(var k=s.offset;k<=next;k++)if(on[k]==null){ok=false;break;}
        var a=on[s.offset],b=on[next],mi=length/1609.344;
        // a span whose length disagrees with the stretch it spans took another road between matching points
        if(!ok||!(b>a+.000001)||Math.abs((b-a)-mi)>Math.max(.02,mi*.1)){spansSkipped++;return;}
        used.push({from:a,to:b,seconds:seconds,baseSeconds:length/speed.baseSpeed,trafficMph:(b-a)/seconds*3600,freeMph:speed.baseSpeed*2.2369362921});
      });
    });
    used.sort(function(x,y){return x.from-y.from;});
    // the full route: HERE's matched stretches, the route's own estimate in the gaps (small gaps close up)
    var rows=[],at=0;
    function gap(from,to){if(to-from<=1e-7)return;var sec=m.timeTo(to)-m.timeTo(from);rows.push({from:from,to:to,seconds:sec,baseSeconds:sec,trafficMph:null,freeMph:null,forecast:false});}
    used.forEach(function(u){if(u.to<=at+1e-7)return;var from=Math.max(u.from,at);if(from-at<=.04){if(rows.length&&rows[rows.length-1].forecast!==false)rows[rows.length-1].to=from;else from=at;}else gap(at,from);
      var share=(u.to-from)/(u.to-u.from);rows.push(Object.assign({},u,{from:from,seconds:u.seconds*share,baseSeconds:u.baseSeconds*share}));at=u.to;});
    if(m.totalMi-at<=.04&&rows.length)rows[rows.length-1].to=m.totalMi;else gap(at,m.totalMi);
    if(rows.length)rows[0].from=0;
    var matched=rows.reduce(function(n,x){return n+(x.forecast===false?0:x.to-x.from);},0),coverage=m.totalMi>0?Math.min(1,matched/m.totalMi):0;
    var details={coverage:Math.round(coverage*1000)/1000,stretchesOff:rows.filter(function(x){return x.forecast===false;}).length,spansSkipped:spansSkipped,speedsMissing:speedsMissing,firstMissing:firstMissing,pointsOff:misses,maxOffsetFeet:Math.round(offMax*5280),firstOffMile:firstMiss==null?null:Math.round(firstMiss*10)/10,routePoints:m.pts.length};
    if(coverage+1e-6<MIN_COVER){var error=Error('Traffic forecast matched only '+Math.round(coverage*100)+'% of this route');error.details=details;throw error;}
    return {source:'HERE forecast',rows:rows,coverage:coverage,match:details,seconds:rows.reduce(function(n,x){return n+x.seconds;},0),baseSeconds:rows.reduce(function(n,x){return n+x.baseSeconds;},0)};
  }
  // Gas / diesel / hybrid in congestion (docs/TRAFFIC_ENERGY_HANDOFF.md 6.4), only with m.engine (the traffic-energy
  // setting): moving part at the EPA city/highway blend at its moving speed (never below 15 mph), plus engine-on idle
  // for the inferred stopped share (IdleFuel) and restarts (TrafficModel.restart). Estimates, labeled in the docs.
  function congestion(m,r,len,dt){
    var e=m.engine,TM=root.TrafficModel||(typeof module!=='undefined'&&module.exports?require('./trafficmodel.js'):null),IF=root.IdleFuel||(typeof module!=='undefined'&&module.exports?require('./idlefuel.js'):null);
    if(!e||!TM||!IF||!(len>0)||r.forecast===false||!(r.freeMph>0)||e.kind==='ev'||e.kind==='h2')return null;
    var c=TM.fromRatio(len/dt*3600/r.freeMph);if(c==='NORMAL'||c==='NONE')return null;
    var sp=TM.split(len,dt,r.freeMph,c,r.freeMph>=50?'freeway':'arterial'),v=Math.max(15,sp.vMoving),w=Math.max(0,Math.min(1,(v-25)/30));
    var idleGal=IF.idle(e,{acFrac:e.acFrac||0,ambientC:e.ambientC,defrost:e.defrost}).lph/IF.L_PER_GAL*sp.tStopped/3600,restartGal=sp.nStops*TM.restart(e.hybrid?'hybrid':e.fuel==='diesel'?'diesel':'gas',e.massKg||1600,v).litres/IF.L_PER_GAL;
    return {gpm:(m.cityGpm*(1-w)+m.hwyGpm*w)+(idleGal+restartGal)/len,stops:sp.nStops,stoppedSec:sp.tStopped,cat:c};
  }
  function overlay(m,p){
    if(!p||!p.rows||!p.rows.length)return m;var segs=[],time=0,j=0,stops=0;
    m.segs.forEach(function(s){var at=s.from;while(at<s.to-1e-8){while(j<p.rows.length-1&&p.rows[j].to<=at+1e-8)j++;var r=p.rows[j],end=Math.min(s.to,r.to);if(end<=at)throw Error('Invalid traffic coverage');var dt=(end-at)/(r.to-r.from)*r.seconds,mph=(end-at)/dt*3600,w=Math.max(0,Math.min(1,(mph-25)/30)),gpm=m.cityGpm*(1-w)+m.hwyGpm*w,extra=congestion(m,r,end-at,dt);if(extra){gpm=extra.gpm;stops+=extra.stops;}
      segs.push(Object.assign({},s,{from:at,to:end,t0:time,t1:time+dt,mph:mph,trafficMph:r.forecast===false?null:mph,freeMph:r.forecast===false?null:r.freeMph,gpm:gpm},extra?{stoppedSec:extra.stoppedSec,trafficCat:extra.cat}:{}));time+=dt;at=end;}});
    var out=T.restoreModel(Object.assign({},m,{segs:segs,durationSec:time,traffic:p,trafficUnavailable:null,trafficStops:stops}));if(m._lim)out._lim=m._lim;return out;
  }
  function cuts(secs,rows){var out=[];(secs||[]).forEach(function(s,i){var points=[s.from,s.to];(rows||[]).forEach(function(r){if(r.from>s.from&&r.from<s.to)points.push(r.from);if(r.to>s.from&&r.to<s.to)points.push(r.to);});points.sort(function(a,b){return a-b;});for(var k=1;k<points.length;k++)if(points[k]>points[k-1]){var mid=(points[k]+points[k-1])/2,r=(rows||[]).filter(function(r){return mid>=r.from&&mid<r.to;})[0];out.push(Object.assign({},s,{from:points[k-1],to:points[k],index:i,trafficMph:r&&r.trafficMph}));}});return out;}
  function times(start,end,stepMinutes){if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>48*3600000)throw Error('Choose a window of up to 48 hours');var n=Math.ceil((end-start)/(stepMinutes*60000));if(!(stepMinutes>=15)||n>24)throw Error('Choose a wider sampling interval (maximum 25 times)');var out=[];for(var t=start;t<end;t+=stepMinutes*60000)out.push(t);out.push(end);return out;}
  function create(io){
    var pending=new Map(),memory=new Map(),memoryRows=0,failures=new Map(),ignoreFailuresBefore=0;
    function hash(s){var a=2166136261,b=5381;for(var i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}return (a>>>0).toString(36)+(b>>>0).toString(36);}
    async function leg(m,depart,stops,avoid,valid){
      // Sub-minute route clocks share a forecast; round forward so "Now" never requests a past minute.
      var q=query(m,Math.ceil(depart/60000)*60000,stops,avoid),geometry=T.encodePolyline(m.pts),identity=q+'|'+geometry,key='traffic-v4|'+hash(identity),now=io.now?io.now():Date.now(),ttl=Math.abs(depart-now)<3600000?10*60000:6*3600000;
      var held=memory.get(key),hit=held&&now-held.at<ttl?held.value:io.get&&io.get(key,ttl);if(hit&&hit.identity===identity&&hit.profile)return Object.assign({},hit.profile,{cached:true});
      var failed=failures.get(key)||hit&&hit.identity===identity&&hit.failedAt>=ignoreFailuresBefore&&hit;if(failed&&now-failed.failedAt<300000){var cachedError=Error(failed.error);cachedError.details=failed.details;cachedError.cachedFailure=true;throw cachedError;}
      if(!valid())throw Error('Traffic lookup cancelled');
      if(!pending.has(identity))pending.set(identity,(async function(){var response=await io.fetch(q);if(response.error)throw Error(response.error);var json=typeof response.body==='string'?JSON.parse(response.body):response,profile=Object.assign(read(json,m),{depart:depart,at:now}),record={identity:identity,profile:profile};if(memory.has(key))memoryRows-=memory.get(key).value.profile.rows.length;memory.set(key,{at:now,value:record});memoryRows+=profile.rows.length;while(memory.size>128||memoryRows>100000){var oldestKey=memory.keys().next().value;memoryRows-=memory.get(oldestKey).value.profile.rows.length;memory.delete(oldestKey);}if(io.put)io.put(key,record);return profile;})().finally(function(){pending.delete(identity);}));
      var p;try{p=await pending.get(identity);}catch(e){var failure={identity:identity,error:String(e.message||e),details:e.details,failedAt:now};failures.set(key,failure);if(failures.size>128)failures.delete(failures.keys().next().value);if(io.put)io.put(key,failure);throw e;}if(!valid())throw Error('Traffic lookup cancelled');return p;
    }
    async function forecast(m,depart,options){
      var o=options||{},valid=o.valid||function(){return true;},ends=Array.from(new Set((m.legEnds&&m.legEnds.length?m.legEnds:[m.totalMi]).concat((o.waits||[]).map(function(w){return w.d;})))).sort(function(a,b){return a-b;}),rows=[],legs=[],at=0,clock=depart,seconds=0,base=0,cached=true,oldest=Infinity;
      ends=ends.concat((o.stops||[]).filter(function(s){return s.seconds>=49900&&s.d>0&&s.d<m.totalMi;}).map(function(s){return s.d;})).sort(function(a,b){return a-b;}).filter(function(d,i,a){return !i||d-a[i-1]>1e-7;});
      (o.stops||[]).filter(function(s){return s.d===0;}).forEach(function(s){clock+=s.seconds*1000;});
      for(var i=0;i<ends.length;i++){
        if(!valid())throw Error('Traffic lookup cancelled');var end=ends[i],part=slice(m,at,end),stops=(o.stops||[]).filter(function(s){return s.d>at&&s.d<end;}).map(function(s){return {d:s.d-at,seconds:s.seconds};});
        if(o.progress)o.progress(i,ends.length);var legStart=clock,p=await leg(part,clock,stops,o.avoid,valid);oldest=Math.min(oldest,p.at);
        p.rows.forEach(function(r){rows.push(Object.assign({},r,{from:r.from+at,to:r.to+at}));});seconds+=p.seconds;base+=p.baseSeconds;cached=cached&&!!p.cached;clock+=(p.seconds+stops.reduce(function(n,s){return n+s.seconds;},0))*1000;
        (o.stops||[]).filter(function(s){return Math.abs(s.d-end)<1e-7;}).forEach(function(s){clock+=s.seconds*1000;});
        legs.push({from:at,to:end,depart:legStart,arrival:clock,seconds:p.seconds,coverage:p.coverage,match:p.match});
        if(o.waitAt&&Math.abs(o.waitAt.d-end)<.001){if(o.strictWait&&clock>o.waitAt.at)throw Error('Return departure is before you reach the destination');clock=Math.max(clock,o.waitAt.at);}(o.waits||[]).forEach(function(w){if(Math.abs(w.d-end)<.001)clock=Math.max(clock,w.at);});at=end;
      }
      if(o.progress)o.progress(ends.length,ends.length);
      var matched=rows.reduce(function(n,r){return n+(r.forecast===false?0:r.to-r.from);},0);
      return {source:'HERE forecast',rows:rows,legs:legs,coverage:m.totalMi>0?Math.min(1,matched/m.totalMi):0,seconds:seconds,baseSeconds:base,depart:depart,arrival:clock,at:oldest,cached:cached};
    }
    return {forecast:forecast,retryFailures:function(){failures.clear();ignoreFailuresBefore=(io.now?io.now():Date.now())+1;},clear:function(){memory.clear();memoryRows=0;failures.clear();}};
  }
  var api={decode:decode,slice:slice,query:query,read:read,overlay:overlay,cuts:cuts,times:times,create:create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Traffic=api;
})(typeof window!=='undefined'?window:this);
