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
    for(var i=1;i<=n;i++)via.push({d:m.totalMi*i/(n+1),pass:true});
    (stops||[]).forEach(function(s){if(!(s.seconds>=0&&s.seconds<50000)||!Number.isFinite(s.seconds)||!(s.d>0&&s.d<m.totalMi))throw Error('Unsupported traffic stop');if(s.seconds)via.push({d:s.d,seconds:Math.ceil(s.seconds)});});
    via=via.filter(function(p){return !p.pass||!via.some(function(s){return !s.pass&&Math.abs(s.d-p.d)<.02;});});via.sort(function(a,b){return a.d-b.d;});
    var merged=[];via.forEach(function(s){var last=merged[merged.length-1];if(last&&Math.abs(last.d-s.d)<.00001){if(s.seconds)last.seconds=(last.seconds||0)+s.seconds;last.pass=last.pass&&s.pass;}else merged.push(Object.assign({},s));});
    merged.forEach(function(s){if(s.seconds>=50000)throw Error('Unsupported traffic stop');q.push('via='+at(s.d)+(s.pass?'!passThrough=true':'!stopDuration='+s.seconds));});
    var features=[];if(avoid&&avoid.tolls)features.push('tollRoad');if(avoid&&avoid.highways)features.push('controlledAccessHighway');if(avoid&&avoid.ferries)features.push('ferry');if(features.length)q.push('avoid%5Bfeatures%5D='+features.join(','));
    var out=q.join('&');if(out.length>3900)throw Error('Too many traffic stop points');return out;
  }
  function read(json,m){
    var r=json&&json.routes&&json.routes[0],rows=[],prev=0,meters=0;
    if(!r||!r.sections||!r.sections.length)throw Error('No traffic route returned');
    r.sections.forEach(function(sec){
      if((sec.notices||[]).some(function(n){return n.severity==='critical';}))throw Error('Traffic route has a critical restriction');
      var pts=decode(sec.polyline),projections=pts.map(function(p){var x=T.project(m,p);if(!x||x.offset>.03||x.along<prev-.04)throw Error('Traffic forecast follows different roads');prev=Math.max(prev,x.along);return x.along;});
      meters+=Number(sec.summary&&sec.summary.length)||0;
      var spans=sec.spans;if(!spans||!spans.length||spans[0].offset!==0)throw Error('Incomplete traffic speeds');
      spans.forEach(function(s,i){
        var next=i+1<spans.length?spans[i+1].offset:pts.length-1;
        if(!Number.isInteger(s.offset)||!Number.isInteger(next)||s.offset<0||next<=s.offset||next>=pts.length)throw Error('Invalid traffic span');
        var a=projections[s.offset],b=projections[next],speed=s.dynamicSpeedInfo,seconds=Number(s.duration),length=Number(s.length);
        if(!(seconds>0)||!speed||!(speed.trafficSpeed>0)||!(speed.baseSpeed>0)||!Number.isFinite(speed.trafficSpeed)||!Number.isFinite(speed.baseSpeed)||!(length>0))throw Error('Missing traffic speed');
        if(b>a+.000001)rows.push({from:a,to:b,seconds:seconds,baseSeconds:length/speed.baseSpeed,trafficMph:(b-a)/seconds*3600,freeMph:speed.baseSpeed*2.2369362921});
      });
    });
    if(!rows.length||Math.abs(meters/1609.344-m.totalMi)>Math.max(.03,m.totalMi*.02)||rows[0].from>.03||m.totalMi-rows[rows.length-1].to>.03)throw Error('Traffic forecast does not cover this route');
    rows[0].from=0;rows[rows.length-1].to=m.totalMi;
    for(var j=1;j<rows.length;j++){if(Math.abs(rows[j].from-rows[j-1].to)>.04)throw Error('Gap in traffic forecast');rows[j].from=rows[j-1].to;}
    // Check both directions: matching HERE vertices alone could miss a shortcut across our line.
    var herePts=[];r.sections.forEach(function(s){herePts=herePts.concat(decode(s.polyline));});var hereCum=[0];for(var k=1;k<herePts.length;k++)hereCum.push(hereCum[k-1]+T.hav(herePts[k-1],herePts[k]));
    var line={pts:herePts,cum:hereCum,totalMi:hereCum[hereCum.length-1]};
    for(var d=0;d<m.totalMi;d+=Math.max(.1,m.totalMi/1000))if(T.project(line,m.pointAt(d)).offset>.03)throw Error('Traffic forecast skips selected roads');
    return {source:'HERE forecast',rows:rows,seconds:rows.reduce(function(n,s){return n+s.seconds;},0),baseSeconds:rows.reduce(function(n,s){return n+s.baseSeconds;},0)};
  }
  function overlay(m,p){
    if(!p||!p.rows||!p.rows.length)return m;var segs=[],time=0,j=0;
    m.segs.forEach(function(s){var at=s.from;while(at<s.to-1e-8){while(j<p.rows.length-1&&p.rows[j].to<=at+1e-8)j++;var r=p.rows[j],end=Math.min(s.to,r.to);if(end<=at)throw Error('Invalid traffic coverage');var dt=(end-at)/(r.to-r.from)*r.seconds,mph=(end-at)/dt*3600,w=Math.max(0,Math.min(1,(mph-25)/30));
      segs.push(Object.assign({},s,{from:at,to:end,t0:time,t1:time+dt,mph:mph,trafficMph:mph,gpm:m.cityGpm*(1-w)+m.hwyGpm*w}));time+=dt;at=end;}});
    var out=T.restoreModel(Object.assign({},m,{segs:segs,durationSec:time,traffic:p}));if(m._lim)out._lim=m._lim;return out;
  }
  function cuts(secs,rows){var out=[];(secs||[]).forEach(function(s,i){var points=[s.from,s.to];(rows||[]).forEach(function(r){if(r.from>s.from&&r.from<s.to)points.push(r.from);if(r.to>s.from&&r.to<s.to)points.push(r.to);});points.sort(function(a,b){return a-b;});for(var k=1;k<points.length;k++)if(points[k]>points[k-1]){var mid=(points[k]+points[k-1])/2,r=(rows||[]).filter(function(r){return mid>=r.from&&mid<r.to;})[0];out.push(Object.assign({},s,{from:points[k-1],to:points[k],index:i,trafficMph:r&&r.trafficMph}));}});return out;}
  function times(start,end,stepMinutes){if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>48*3600000)throw Error('Choose a window of up to 48 hours');var n=Math.ceil((end-start)/(stepMinutes*60000));if(!(stepMinutes>=15)||n>24)throw Error('Choose a wider sampling interval (maximum 25 times)');var out=[];for(var t=start;t<end;t+=stepMinutes*60000)out.push(t);out.push(end);return out;}
  function create(io){
    var pending=new Map(),memory=new Map(),memoryRows=0;
    function hash(s){var a=2166136261,b=5381;for(var i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}return (a>>>0).toString(36)+(b>>>0).toString(36);}
    async function leg(m,depart,stops,avoid,valid){
      // Sub-minute route clocks share a forecast; round forward so "Now" never requests a past minute.
      var q=query(m,Math.ceil(depart/60000)*60000,stops,avoid),geometry=T.encodePolyline(m.pts),identity=q+'|'+geometry,key='traffic-v1|'+hash(identity),now=io.now?io.now():Date.now(),ttl=Math.abs(depart-now)<3600000?10*60000:6*3600000;
      var held=memory.get(key),hit=held&&now-held.at<ttl?held.value:io.get&&io.get(key,ttl);if(hit&&hit.identity===identity&&hit.profile)return Object.assign({},hit.profile,{cached:true});
      if(!valid())throw Error('Traffic lookup cancelled');
      if(!pending.has(identity))pending.set(identity,(async function(){var response=await io.fetch(q);if(response.error)throw Error(response.error);var json=typeof response.body==='string'?JSON.parse(response.body):response,profile=Object.assign(read(json,m),{depart:depart,at:now}),record={identity:identity,profile:profile};if(memory.has(key))memoryRows-=memory.get(key).value.profile.rows.length;memory.set(key,{at:now,value:record});memoryRows+=profile.rows.length;while(memory.size>128||memoryRows>100000){var oldestKey=memory.keys().next().value;memoryRows-=memory.get(oldestKey).value.profile.rows.length;memory.delete(oldestKey);}if(io.put)io.put(key,record);return profile;})().finally(function(){pending.delete(identity);}));
      var p=await pending.get(identity);if(!valid())throw Error('Traffic lookup cancelled');return p;
    }
    async function forecast(m,depart,options){
      var o=options||{},valid=o.valid||function(){return true;},ends=m.legEnds&&m.legEnds.length?m.legEnds:[m.totalMi],rows=[],legs=[],at=0,clock=depart,seconds=0,base=0,cached=true,oldest=Infinity;
      ends=ends.concat((o.stops||[]).filter(function(s){return s.seconds>=49900&&s.d>0&&s.d<m.totalMi;}).map(function(s){return s.d;})).sort(function(a,b){return a-b;}).filter(function(d,i,a){return !i||d-a[i-1]>1e-7;});
      (o.stops||[]).filter(function(s){return s.d===0;}).forEach(function(s){clock+=s.seconds*1000;});
      for(var i=0;i<ends.length;i++){
        if(!valid())throw Error('Traffic lookup cancelled');var end=ends[i],part=slice(m,at,end),stops=(o.stops||[]).filter(function(s){return s.d>at&&s.d<end;}).map(function(s){return {d:s.d-at,seconds:s.seconds};});
        if(o.progress)o.progress(i,ends.length);var legStart=clock,p=await leg(part,clock,stops,o.avoid,valid);oldest=Math.min(oldest,p.at);
        p.rows.forEach(function(r){rows.push(Object.assign({},r,{from:r.from+at,to:r.to+at}));});seconds+=p.seconds;base+=p.baseSeconds;cached=cached&&!!p.cached;clock+=(p.seconds+stops.reduce(function(n,s){return n+s.seconds;},0))*1000;
        (o.stops||[]).filter(function(s){return Math.abs(s.d-end)<1e-7;}).forEach(function(s){clock+=s.seconds*1000;});
        legs.push({from:at,to:end,depart:legStart,arrival:clock,seconds:p.seconds});
        if(o.waitAt&&Math.abs(o.waitAt.d-end)<.001){if(o.strictWait&&clock>o.waitAt.at)throw Error('Return departure is before you reach the destination');clock=Math.max(clock,o.waitAt.at);}at=end;
      }
      if(o.progress)o.progress(ends.length,ends.length);
      return {source:'HERE forecast',rows:rows,legs:legs,seconds:seconds,baseSeconds:base,depart:depart,arrival:clock,at:oldest,cached:cached};
    }
    return {forecast:forecast,clear:function(){memory.clear();memoryRows=0;}};
  }
  var api={decode:decode,slice:slice,query:query,read:read,overlay:overlay,cuts:cuts,times:times,create:create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Traffic=api;
})(typeof window!=='undefined'?window:this);
