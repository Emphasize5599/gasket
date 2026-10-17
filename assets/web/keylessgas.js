/* Experimental nearby regular-fuel lookup. Independently authored, not copied from Vela. */
(function(root){
  'use strict';
  function area(lat,lng,radius){
    lat=Number(lat);lng=Number(lng);radius=Number(radius);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>85||Math.abs(lng)>180||!Number.isFinite(radius)||radius<=0)throw new Error('Invalid search area');
    radius=Math.min(radius,15);
    var dy=radius/69,dx=radius/(69.17*Math.cos(lat*Math.PI/180));
    if(lng-dx < -180 || lng+dx > 180)throw new Error('Search crossing the date line is not supported');
    return {lat:lat,lng:lng,radius:radius,bounds:[lat-dy,lng-dx,lat+dy,lng+dx]};
  }
  function osmUrl(a){return 'https://overpass-api.de/api/interpreter?data='+encodeURIComponent('[out:json][timeout:20];nwr["amenity"="fuel"]('+a.bounds.map(function(n){return n.toFixed(5);}).join(',')+');out center tags;');}
  function mapAreas(b,P){
    if(!b||b.length!==4||!b.every(Number.isFinite)||b[0]>b[2]||b[1]>b[3]||b[0]<-85||b[2]>85||b[1]<-180||b[3]>180)throw new Error('Zoom in to a map area within supported coordinates (no date-line crossing). No search was started.');
    var rows=Math.max(1,Math.ceil((b[2]-b[0])*69/6)),out=[],lat=(b[0]+b[2])/2,lng=(b[1]+b[3])/2;
    // Midpoints of six-mile cells cover the entire rectangle, including corners
    // and wide landscape views. Eight-mile readers overlap; no centre-only cap.
    for(var y=0;y<rows;y++){
      var south=b[0]+(b[2]-b[0])*y/rows,north=b[0]+(b[2]-b[0])*(y+1)/rows;
      var nearest=south<=0&&north>=0?0:Math.min(Math.abs(south),Math.abs(north));
      var cols=Math.max(1,Math.ceil((b[3]-b[1])*69.17*Math.cos(nearest*Math.PI/180)/6));
      // Refuse an unsafe continent-scale plan explicitly, never scan a subset.
      if(out.length+cols>10000||rows>10000)throw new Error('This view needs over 10,000 search areas. Zoom in to scan the entire visible map safely. No search was started.');
      for(var x=0;x<cols;x++)out.push(area((south+north)/2,b[1]+(b[3]-b[1])*(x+0.5)/cols,8));
    }
    out.sort(function(a,c){return P.haversineMi(lat,lng,a.lat,a.lng)-P.haversineMi(lat,lng,c.lat,c.lng);});
    return out;
  }
  function webUrl(a){return 'https://www.google.com/maps/search/gas+stations/@'+a.lat.toFixed(5)+','+a.lng.toFixed(5)+',13z?hl=en';}
  function contains(s,a,P){return P.haversineMi(a.lat,a.lng,s.lat,s.lng)<=a.radius;}
  function normalizeOsm(data,a,P){
    if(!data||!Array.isArray(data.elements))throw new Error('OpenStreetMap returned an unreadable response');
    var rows=[],seen={};
    data.elements.forEach(function(e){
      var t=e.tags||{},c=e.center||e;
      if(t.amenity!=='fuel'||t.disused==='yes'||t.abandoned==='yes'||t.access==='private')return;
      var name=t.brand||t.name||t.operator||'',brand=P.detectBrand([t.brand,t.name,t.operator].filter(Boolean).join(' '),t.website);
      if(!brand||typeof c.lat!=='number'||typeof c.lon!=='number')return;
      var s={id:'osm:'+e.type+':'+e.id,name:name,brand:brand,lat:c.lat,lng:c.lon,address:[t['addr:housenumber'],t['addr:street'],t['addr:city'],t['addr:state']].filter(Boolean).join(' '),state:t['addr:state']||'',prices:{},source:'OpenStreetMap',google:false,osm:true};
      if(!contains(s,a,P)||seen[s.id])return;
      seen[s.id]=true;
      // Collapse duplicated node/way representations only within the same brand's forecourt.
      if(rows.some(function(r){return r.brand===s.brand&&P.haversineMi(r.lat,r.lng,s.lat,s.lng)<0.025;}))return;
      rows.push(s);
    });
    return rows;
  }
  function merge(open,web,a,P){
    var out=open.map(function(s){return Object.assign({},s,{prices:Object.assign({},s.prices)});});
    web.forEach(function(w){
      var brand=P.detectBrand(w.name,w.website);
      if(!brand||!contains(w,a,P))return;
      var candidates=out.filter(function(o){return o.brand===brand&&P.haversineMi(o.lat,o.lng,w.lat,w.lng)<0.06;});
      // Ambiguous matches remain distinct rather than transferring a price to the wrong pump.
      var uniqueWeb=candidates.length===1 && web.filter(function(other){return P.detectBrand(other.name,other.website)===brand&&P.haversineMi(candidates[0].lat,candidates[0].lng,other.lat,other.lng)<0.06;}).length===1;
      if(uniqueWeb){
        var o=candidates[0];
        if(w.prices&&w.prices.regular){o.prices.regular=w.prices.regular;o.source=w.source;o.google=true;}
        o.mapsUri=w.mapsUri;
      }else if(!out.some(function(o){return o.id===w.id;}))out.push(Object.assign({},w,{brand:brand}));
    });
    return out;
  }
  function knownKey(s){return (s.brand||'')+'|'+(s.id||[s.lat,s.lng,s.address].join('|'));}
  function addressKey(s){return String(s||'').split(',')[0].toLowerCase().replace(/\b(street|road|avenue|boulevard|drive|highway)\b/g,function(w){return {street:'st',road:'rd',avenue:'ave',boulevard:'blvd',drive:'dr',highway:'hwy'}[w];}).replace(/[^a-z0-9]/g,'');}
  function officialRadius(w){return w.source==='walmart.com'?0.6:w.source==='murphyusa.com'?0.35:0.1;}
  function updateKnown(known,web,P,observedAt,grade){
    grade=grade||'regular';
    var unique=Array.from(new Map(known.map(function(s){return [knownKey(s),s];})).values()),updates=new Map();
    var candidates=web.map(function(w){
      var brand=P.detectBrand(w.name,w.website);
      var stable=unique.filter(function(s){return P.haversineMi(s.lat,s.lng,w.lat,w.lng)<=officialRadius(w)&&(!brand||brand===s.brand)&&(w.placeId&&w.placeId===s.id||w.featureId&&s.featureId===w.featureId||w.id&&w.id===s.id||w.wmStoreId&&(s.wmStoreId===w.wmStoreId||s.id==='wm-'+w.wmStoreId)||w.murphyStore&&s.murphyStore===w.murphyStore);});
      if(stable.length)return stable;
      return unique.filter(function(s){
        if(w.wmStoreId&&s.wmStoreId&&String(w.wmStoreId)!==String(s.wmStoreId)||w.murphyStore&&s.murphyStore&&String(w.murphyStore)!==String(s.murphyStore))return false;
        var distance=P.haversineMi(s.lat,s.lng,w.lat,w.lng);
        if(!Number.isFinite(distance)||distance>officialRadius(w)||brand&&brand!==s.brand)return false;
        if(w.placeId&&w.placeId===s.id||w.featureId&&s.featureId===w.featureId||w.id&&w.id===s.id)return true;
        if(brand!==s.brand)return false;
        var sameAddress=addressKey(s.address)&&addressKey(s.address)===addressKey(w.address);
        return sameAddress?distance<officialRadius(w):distance<(w.source==='walmart.com'?0.6:w.source==='murphyusa.com'?0.35:0.03);
      });
    });
    web.forEach(function(w,i){
      var aliases=candidates[i].length>1&&(w.wmStoreId&&candidates[i].every(function(s){return s.wmStoreId===w.wmStoreId||s.id==='wm-'+w.wmStoreId;})||w.murphyStore&&candidates[i].every(function(s){return s.murphyStore===w.murphyStore;}));
      if(candidates[i].length!==1&&!aliases)return;
      var prices={};Object.keys(P.GRADES).forEach(function(g){var gp=w.prices&&w.prices[g];if(!gp||!Number.isFinite(gp.price)||gp.price<0.5||gp.price>20)return;prices[g]={price:gp.price,updated:gp.updated||null,observedAt:observedAt==null?(gp.observedAt||w.observedAt||null):observedAt,source:gp.source||w.source||'Google Maps web'};});
      candidates[i].forEach(function(s){var key=knownKey(s);if(candidates.filter(function(c){return c.some(function(other){return knownKey(other)===key;});}).length===1&&(Object.keys(prices).length||w.wmStoreId||w.murphyStore))updates.set(key,prices);});
    });
    return {updated:Array.from(updates.values()).filter(function(p){return p[grade];}).length,stations:known.map(function(s){
      var copy=Object.assign({},s,{prices:Object.assign({},s.prices)}),price=updates.get(knownKey(s));
      if(price){Object.assign(copy.prices,price);var linked=web.filter(function(w,i){return candidates[i].some(function(t){return knownKey(t)===knownKey(s);});});if(linked.length===1)['wmStoreId','storeName','murphyStore'].forEach(function(k){if(linked[0][k]!=null)copy[k]=linked[0][k];});if(Object.keys(price).some(function(g){return price[g].source==='Google Maps web';}))copy.google=true;}
      return copy;
    })};
  }
  function knownAreas(known,P,priority){
    var unique=Array.from(new Map(known.filter(function(s){return typeof s.lat==='number'&&typeof s.lng==='number';}).map(function(s){return [knownKey(s),s];})).values());
    unique.sort(function(a,b){return (priority||[]).includes(b.id)-(priority||[]).includes(a.id);});
    var groups=[];
    unique.forEach(function(s){var group=groups.find(function(g){return P.haversineMi(g.lat,g.lng,s.lat,s.lng)<6;});if(!group){group={lat:s.lat,lng:s.lng,radius:8,stations:[]};groups.push(group);}group.stations.push(s);});
    return groups;
  }
  // 8-mile searches every 10 miles: still overlapping (a 2,600-mile trip at 6 had 57% repeat rows and 74 areas adding nothing)
  var SPACING=10;
  function discoveryAreas(models,T,P){
    var groups=[];
    var sampled=0,miles=0;
    models.forEach(function(m){miles+=m.totalMi||0;T.samplePoints(m,SPACING).forEach(function(p){sampled++;if(!groups.some(function(g){return P.haversineMi(g.lat,g.lng,p.lat,p.lng)<2;}))groups.push(area(p.lat,p.lng,8));});});
    groups.plan={routeMi:Math.round(miles),sampled:sampled,merged:sampled-groups.length,spacingMi:SPACING,radiusMi:8};   // for the debug log
    return groups;
  }
  function discoveryPhases(primary,alternatives,T,P){
    var first=discoveryAreas(primary,T,P),union=discoveryAreas(primary.concat(alternatives),T,P),rest=union.slice(first.length);
    rest.plan=Object.assign({},union.plan,{primaryAreas:first.length,reusedPrimaryAreas:discoveryAreas(alternatives,T,P).length-rest.length});
    return {primary:first,alternatives:rest};
  }
  function dedupeDiscovery(stations,P){
    stations=P.reconcileStations(stations);
    var out=[],ids=new Map(),bins=new Map();
    stations.forEach(function(s){
      if(!s||!Number.isFinite(s.lat)||!Number.isFinite(s.lng)||Math.abs(s.lat)>85||Math.abs(s.lng)>180)return;
      s=Object.assign({},s,{brand:P.detectBrand(s.name,s.website)||s.brand||'other',prices:Object.assign({},s.prices)});
      var id=s.placeId||s.featureId||s.id,x=Math.floor(s.lat*100),y=Math.floor(s.lng*100),same=id&&ids.get(id);
      function conflict(t){return ['wmStoreId','murphyStore'].some(function(k){return t[k]!=null&&s[k]!=null&&String(t[k])!==String(s[k]);});}
      if(same&&conflict(same))same=null;
      if(!same)for(var dx=-1;dx<=1;dx++)for(var dy=-1;dy<=1;dy++)(bins.get((x+dx)+'|'+(y+dy))||[]).forEach(function(t){
        if(t.brand!==s.brand||conflict(t)||(s.brand==='other'&&String(t.name).toLowerCase()!==String(s.name).toLowerCase()))return;
        if(P.haversineMi(t.lat,t.lng,s.lat,s.lng)<0.025&&(addressKey(t.address)&&addressKey(t.address)===addressKey(s.address)||P.haversineMi(t.lat,t.lng,s.lat,s.lng)<0.006))same=t;
      });
      if(same){Object.keys(s.prices).forEach(function(g){var old=same.prices[g],fresh=s.prices[g];if(!old||(fresh.observedAt||0)>(old.observedAt||0))same.prices[g]=fresh;});['wmStoreId','murphyStore'].forEach(function(k){if(same[k]==null&&s[k]!=null)same[k]=s[k];});same.stationAliases=Array.from(new Set((same.stationAliases||[]).concat(s.stationAliases||[])));if(id)ids.set(id,same);return;}
      out.push(s);if(id)ids.set(id,s);var key=x+'|'+y;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(s);
    });return out;
  }
  /**
   * The debug log's picture of a discovery scan, from one record per area:
   * {i, lane, at (ms after the start), ms (whole read, page load included), cache, d (the reader's detail), found, added, err}.
   * Where the time went: page loads vs reading, waiting after the last new row, lanes idle at the end, overlap between areas.
   */
  function discoveryReport(recs,meta){
    var q=function(list,f){if(!list.length)return null;var v=list.slice().sort(function(a,b){return a-b;});return v[Math.min(v.length-1,Math.floor(f*v.length))];};
    var sum=function(list){return list.reduce(function(a,b){return a+b;},0);};
    var completed=recs.filter(function(r){return !r.cancelled;}),live=completed.filter(function(r){return !r.cache;}),el=meta.elapsedMs||1,lanes=meta.lanes||1;
    var ms=live.map(function(r){return r.ms;}),work=live.filter(function(r){return r.d&&r.d.elapsedMs!=null;});
    var load=work.map(function(r){return Math.max(0,r.ms-r.d.elapsedMs-(r.d.retryElapsedMs||0));}),after=work.map(function(r){return Math.max(0,r.d.elapsedMs-(r.d.lastGrowthMs||0));});
    var stops={};recs.forEach(function(r){var k=r.cancelled?'cancel':r.err?'error':r.cache?'cache':r.d&&r.d.stopReason||'?';stops[k]=(stops[k]||0)+1;});
    var lastStart=live.length?Math.max.apply(null,live.map(function(r){return r.at;})):0,read=sum(recs.map(function(r){return r.d&&r.d.read||0;}));
    var busy=sum(ms);
    return {elapsedMs:el,areas:meta.areas,done:completed.length,attempted:recs.length,cancelledAreas:recs.length-completed.length,cached:completed.length-live.length,lanes:lanes,
      laneUse:+(busy/(lanes*el)).toFixed(2),                                   // 1 = every lane busy the whole time
      tailMs:Math.max(0,el-lastStart),                                         // after the last area started: fewer lanes busy
      areaMs:{p50:q(ms,0.5),p90:q(ms,0.9),max:q(ms,1)},
      pageLoadMs:{p50:q(load,0.5),p90:q(load,0.9),total:sum(load)},           // before the reader starts (page load, injection)
      resourceRecovery:{areas:work.filter(function(r){return r.d.fullResourceRetry;}).length,totalMs:sum(work.map(function(r){return r.d.retryElapsedMs||0;})),omittedGraphics:sum(work.map(function(r){return r.d.omittedGraphics||0;})),omittedTelemetry:sum(work.map(function(r){return r.d.omittedTelemetry||0;}))},
      firstListMs:q(work.map(function(r){return r.d.firstFeedMs;}).filter(function(v){return v!=null;}),0.5),
      afterLastRowMs:{p50:q(after,0.5),total:sum(after),share:+(sum(after)/(busy||1)).toFixed(2)},   // waiting for more rows that never came
      stops:stops,scrollsAvg:work.length?+(sum(work.map(function(r){return r.d.scrolls||0;}))/work.length).toFixed(1):null,
      rowsRead:read,stations:meta.stations,overlap:read?+(1-meta.stations/read).toFixed(2):null,   // share of rows already found by another area
      areasAddingNothing:completed.filter(function(r){return !r.added;}).length,
      priced:meta.priced,officialMs:meta.officialMs,errors:meta.errors,mem:meta.mem};
  }
  function memNow(A){try{var m=JSON.parse(A.N&&A.N.memoryInfo?A.N.memoryInfo():'{}');return m.totalMem?{availMB:Math.round(m.availMem/1048576),totalMB:Math.round(m.totalMem/1048576),low:!!m.lowMemory,appHeapMB:Math.round((m.appHeapUsed||0)/1048576),appHeapMaxMB:Math.round((m.appHeapMax||0)/1048576),readerRecycles:m.readerRecycles||0,rendererLosses:m.rendererLosses||0}:null;}catch(e){return null;}}
  function autoWorkers(memory){var gb=Number(memory&&memory.totalMem)/1073741824;if(memory&&memory.lowMemory)return 4;if(!Number.isFinite(gb)||gb<=0)return 6;return gb>=15?20:gb>=11?16:gb>=7?12:gb>=5?8:gb>=3?6:4;}
  function workerWarning(memory,count){var base=autoWorkers(memory),n=Math.max(1,Math.min(50,Math.round(Number(count)||base)));return {warn:n>base&&(n>=Math.ceil(base*2.25)||n>=16||!!(memory&&memory.lowMemory)),base:base,count:n};}
  function readerCount(A){var value=Number(A.S&&A.S.keylessWorkers);if(Number.isFinite(value)&&value>=1)return Math.min(50,Math.max(1,Math.round(value)));var memory={};try{memory=JSON.parse(A.N&&A.N.memoryInfo?A.N.memoryInfo():'{}');}catch(e){}return autoWorkers(memory);}
  // One shared decision per fresh sample: a cached low-memory reading must not
  // retire every extra lane. Pause instead; gradually resume when RAM recovers.
  function poolTarget(state,m,now,max,aggressive){
    var floor=Math.min(4,max);
    if(!m){state.target=max;return max;}
    if(aggressive){
      // Aggressive mode spends headroom, but still retreats from an actual emergency.
      // Admit in chunks instead of constructing fifty WebViews in one UI-thread burst.
      var emergency=m.availMB<160||m.low&&m.availMB<300;
      if(state.target==null){state.target=Math.min(max,emergency?floor:8);state.at=now;state.cooldown=emergency?now+6000:now;}
      if(now-state.at<2000)return state.target;state.at=now;
      if(emergency){state.target=Math.max(floor,Math.floor(state.target/2));state.cooldown=now+6000;}
      else if(m.availMB>=512&&now>=state.cooldown)state.target=Math.min(max,state.target+4);
      return state.target;
    }
    if(state.target==null){state.target=Math.min(max,m.low||m.availMB<1200?floor:m.availMB>=2200?8:6);state.at=now;state.cooldown=now;}
    if(now-state.at<2000)return state.target;
    state.at=now;
    if(m.low||m.availMB<350){state.target=Math.max(floor,state.target-(m.availMB<200?Math.ceil(state.target/2):2));state.cooldown=now+4000;}
    else if(m.availMB>=850&&now>=state.cooldown)state.target=Math.min(max,state.target+(m.availMB>=1800?2:1));
    return state.target;
  }
  function readerPool(A,lanes,control,audit,more){
    var state={aggressive:!!(A.S&&A.S.keylessAggressive)},sampleAt=0,sample=null,paused=new Set();
    function target(){var now=Date.now();if(!sampleAt||now-sampleAt>=2000){sampleAt=now;sample=memNow(A);}return poolTarget(state,sample,now,lanes.length,state.aggressive);}
    control.pool=state;target();
    return {target:target,permit:async function(key){
      var index=lanes.indexOf(key);
      while(more()&&!control.cancelled&&!control.blocked){
        if(index<target()){if(paused.delete(key)&&root.FLog)root.FLog.info('keyless','Website reader resumes',{lane:index,target:state.target});return true;}
        if(!paused.has(key)){paused.add(key);audit.retire();if(A.N&&A.N.releaseGasReader)A.N.releaseGasReader(key);if(root.FLog)root.FLog.info('keyless','Website reader pauses for memory headroom',{lane:index,target:state.target});}
        await new Promise(function(resolve){var timer,wake=function(){clearTimeout(timer);control.wake=control.wake.filter(function(f){return f!==wake;});resolve();};control.wake.push(wake);timer=setTimeout(wake,500);});
      }
      return false;
    }};
  }
  // Aggregate diagnostics only: no locations, station names, URLs or credentials. A throttled checkpoint
  // survives a process restart; "unfinished" is evidence of interruption, not proof of an OOM.
  function scanAudit(A,kind,lanes,total,control){
    var started=Date.now(),id=started.toString(36),active=new Map(),last=0,sampleAt=0,sample=null,done=0,retired=0,peak=0,min=null,maxActive=0,checkpoints=0,cached=0,persistMs=0,previous=null,finished=false;
    try{previous=A.KV.get('gasmeta','last-scan');}catch(e){}
    var LG=root.FLog;
    if(previous&&previous.v&&previous.v.status==='running'&&LG)LG.info('keyless','Previous scan was unfinished',{id:previous.v.id,kind:previous.v.kind,completed:previous.v.completed,total:previous.v.total,elapsedMs:previous.v.elapsedMs});
    function sampleMemory(){sampleAt=Date.now();sample=memNow(A);if(sample){peak=Math.max(peak,sample.appHeapMB);min=min==null?sample.availMB:Math.min(min,sample.availMB);}}
    function snapshot(status){sampleMemory();var oldest=0;active.forEach(function(t){oldest=Math.max(oldest,Date.now()-t);});return {id:id,kind:kind,status:status,elapsedMs:Date.now()-started,completed:done,total:total,readers:lanes.length,manual:!!(A.S&&Number(A.S.keylessWorkers)>=1),active:active.size,maxActive:maxActive,oldestActiveMs:oldest,retired:retired,cached:cached,checkpoints:checkpoints,persistMs:persistMs,minSystemAvailableMB:min,peakAppJavaHeapMB:peak,memory:sample};}
    function write(status){var s=snapshot(status);s.targetReaders=control.pool&&control.pool.target!=null?control.pool.target:null;s.aggressive=!!(control.pool&&control.pool.aggressive);try{A.KV.put('gasmeta','last-scan',s);}catch(e){}if(LG)LG.info('keyless',status==='running'?'Scan heartbeat':'Scan diagnostics',s);return s;}
    write('running');last=Date.now();
    return {begin:function(key){active.set(key,Date.now());maxActive=Math.max(maxActive,active.size);},end:function(key){active.delete(key);},complete:function(cache){done++;if(cache)cached++;},retire:function(){retired++;},persist:function(ms){checkpoints++;persistMs+=ms;},tick:function(){if(Date.now()-sampleAt>=5000)sampleMemory();if(Date.now()-last>=15000){last=Date.now();write('running');}},finish:function(status){if(!finished){finished=true;write(status|| (control.cancelled?'cancelled':control.blocked?'restricted':'finished'));}}};
  }
  function readerKeys(count){return Array.from({length:count},function(_,i){return i?'gasweb'+(i+1):'gasweb';});}
  var math={retryable:function(r){return retryable(r);},workerWarning:workerWarning,discoveryPhases:discoveryPhases,poolTarget:poolTarget,mapAreas:mapAreas,area:area,osmUrl:osmUrl,webUrl:webUrl,normalizeOsm:normalizeOsm,merge:merge,updateKnown:updateKnown,knownAreas:knownAreas,knownKey:knownKey,discoveryAreas:discoveryAreas,dedupeDiscovery:dedupeDiscovery,discoveryReport:discoveryReport,autoWorkers:autoWorkers,readerCount:readerCount,readerKeys:readerKeys};
  if(typeof module!=='undefined'&&module.exports)module.exports=math;
  if(!root.document)return;
  var busy=null,lastOsm=0,lastWeb=0;
  function scanChanged(){if(root.dispatchEvent&&root.Event)root.dispatchEvent(new root.Event('keylessscanchange'));}
  function releaseReaders(){var N=root.__app.N;if(N&&N.releaseGasReaders)N.releaseGasReaders();}
  function cancel(){
    if(!busy||typeof busy!=='object')return;
    if(busy.pause&&root.document.getElementById){var banner=root.document.getElementById('wmCheck');if(banner)banner.classList.add('hidden');}
    busy.cancelled=true;if(busy.pause){var p=busy.pause;busy.pause=null;p.resolve();}busy.wake.forEach(function(f){f();});(busy.readWake||[]).slice().forEach(function(f){f();});
    var N=root.__app.N;
    if(N&&N.cancelSiteRead)(busy.lanes||readerKeys(readerCount(root.__app))).concat(['walmart','murphy']).forEach(function(k){N.cancelSiteRead(k);});
  }
  function call(name){return root.__trip.call.apply(null,[name].concat([].slice.call(arguments,1)));}
  function pausedText(control){return control.pause?'Paused · '+(/^gasweb/.test(control.pause.key)?'Google Maps detected unusual traffic':control.pause.key==='walmart'?'Walmart needs a check':'Murphy needs a check')+' · Open the check to continue':null;}
  function pauseScan(control,key){
    if(control.pause||control.cancelled)return;
    control.epoch=(control.epoch||0)+1;
    var resolve,promise=new Promise(function(r){resolve=r;});control.pause={key:key,promise:promise,resolve:resolve};
    // Wake native reads, not area cancellation handlers: each area keeps its place and retries after Done.
    (control.readWake||[]).slice().forEach(function(f){f({paused:true});});
    var A=root.__app,N=A.N;
    if(N&&N.cancelSiteRead)(control.lanes||[]).concat(['walmart','murphy']).forEach(function(k){N.cancelSiteRead(k);});
    if(root.FLog)root.FLog.info('keyless','Scan paused for visible website check',{site:key});
    if(control.report)control.report();A.showSiteCheck(key,/^gasweb/.test(key)?'Google Maps':key==='walmart'?'Walmart':'Murphy USA');
  }
  var RETRY_LANES=8,RETRIES=2,CALM_MS=45000;
  /** A read that failed to load and found nothing: worth reading again (not a check, a cancel, or a real empty answer). */
  function retryable(r){return !!r&&!r.blocked&&!r.cancelled&&!!r.error&&!(r.stores||[]).length&&r.code!=='no_prices'&&(/^(network|timeout|http|unreadable|reader)$/.test(r.code||'')||/timed out|could not load|could not be read/i.test(r.error));}
  function verified(key){
    var c=busy,p=c&&c.pause;if(!p||p.key!==key)return false;
    c.calmUntil=Date.now()+CALM_MS;
    c.pause=null;p.resolve();if(c.report)c.report();
    if(root.FLog)root.FLog.info('keyless','Scan resumes unfinished areas after check closed',{site:key});return true;
  }
  async function scanRead(control,key,args){
    for(;;){
      if(control.pause)await control.pause.promise;
      // a read the check interrupted waits out the calm too (lanes past the first few), or all of them reload at once
      while(control.calmUntil>Date.now()&&(control.lanes||[]).indexOf(key)>=RETRY_LANES&&!control.cancelled&&!control.pause)await new Promise(function(r){setTimeout(r,1000);});
      if(control.pause)continue;
      if(control.cancelled)return {cancelled:true};
      var epoch=control.epoch||0,wake,stop=new Promise(function(resolve){wake=resolve;}),r;
      if(!control.readWake)control.readWake=[];control.readWake.push(wake);
      try{r=await Promise.race([call('siteRead',key,JSON.stringify(args)),stop]);}
      catch(e){if(control.cancelled)return {cancelled:true};if(epoch!==(control.epoch||0))continue;throw e;}
      finally{control.readWake=control.readWake.filter(function(f){return f!==wake;});}
      if(control.cancelled)return {cancelled:true};
      if(epoch!==(control.epoch||0)||r.paused)continue; // Late results from the canceled generation never advance progress.
      if(r.blocked&&typeof root.__app.showSiteCheck==='function'){pauseScan(control,r.blockedSite||key);continue;}
      return r;
    }
  }
  function officialReader(control,onLoad,onError,onLabel){
    var A=root.__app,P=A.P,queues={},seenPrices=new Map(),seenNodes=new Map();
    function stopped(){return control.cancelled||control.blocked;}
    // A read that runs out of time (the phone busy with the gas readers) is split in half and read again, down to one
    // item, before it counts as an error: a timeout is the page being slow, not a check.
    async function readSplit(key,args,field,outField){
      var r=await read(key,args,true),list=args[field]||[];
      if(!(r&&r.code==='timeout')||list.length<2||stopped()){if(r&&r.code==='timeout'&&onError)onError((key==='walmart'?'Walmart: ':'Murphy USA: ')+r.error);return r;}
      if(root.FLog)root.FLog.info('keyless',(key==='walmart'?'Walmart':'Murphy USA')+' read timed out: trying it in two halves',{items:list.length});
      var half=Math.ceil(list.length/2),a=Object.assign({},args),b=Object.assign({},args);a[field]=list.slice(0,half);b[field]=list.slice(half);
      var ra=await readSplit(key,a,field,outField),rb=await readSplit(key,b,field,outField),both={};
      both[outField]=(ra[outField]||[]).concat(rb[outField]||[]);
      if(ra.blocked||rb.blocked)both.blocked=true;if(ra.cancelled||rb.cancelled)both.cancelled=true;
      if(ra.error&&rb.error)both.error=ra.error;
      return both;
    }
    function read(key,args,quietTimeout){
      var promise=(queues[key]||Promise.resolve()).then(async function(){
        if(stopped())return {cancelled:true};if(onLoad)onLoad();if(onLabel)onLabel(key==='walmart'?'Checking Walmart website prices':'Checking Murphy website prices');
        var endTask=root.Tasks&&A.job&&A.job()?root.Tasks.begin('station-source:'+key,{parent:'stations',text:'Checking '+(key==='walmart'?'Walmart':'Murphy')+' website prices',parentLabels:key==='walmart'?['Checking Walmart website prices','Reading Walmart prices']:['Checking Murphy website prices','Reading Murphy prices'],pendingId:'trip-pending:'+key}):null;
        var wake,stop=new Promise(function(resolve){wake=function(){resolve({cancelled:true});};control.wake.push(wake);}),r;
        try{r=await Promise.race([scanRead(control,key,args),stop]);}catch(e){r={error:e.message};}finally{control.wake=control.wake.filter(function(f){return f!==wake;});if(endTask)endTask();}
        if(r.blocked){control.blocked=true;control.blockedSite=key;}if(r.error&&onError&&!(quietTimeout&&r.code==='timeout'))onError((key==='walmart'?'Walmart: ':'Murphy USA: ')+r.error);
        return r;
      });queues[key]=promise.catch(function(){});return promise;
    }
    function stamp(stores,normalize){var at=Date.now();return stores.map(normalize).filter(Boolean).map(function(s){Object.keys(s.prices||{}).forEach(function(g){if(!P.GRADES[g]||!Number.isFinite(s.prices[g].price)||s.prices[g].price<0.5||s.prices[g].price>20){delete s.prices[g];return;}s.prices[g].source=s.source;s.prices[g].observedAt=at;});return s;});}
    return async function(known,areas,discovery,force){
      var out=[],points=discovery?areas:known.filter(function(s){return s.brand==='walmart'&&!s.wmStoreId&&!/^wm-\d+$/.test(s.id||'');}),nodes=[];
      if(!A.siteOn||A.siteOn('walmart')){
        known.filter(function(s){return s.brand==='walmart'&&(s.wmStoreId||/^wm-\d+$/.test(s.id||''));}).forEach(function(s){nodes.push({id:String(s.wmStoreId||s.id.slice(3)),displayName:s.name,geoPoint:{latitude:s.lat,longitude:s.lng},address:{addressLineOne:s.address||'',state:s.state||''}});});
        for(var pi=0;pi<points.length&&!stopped();pi+=20){
          var batch=points.slice(pi,pi+20),key='keyless-nodes-v1|'+(discovery?8:5)+'|'+batch.map(function(p){return p.lat.toFixed(4)+','+p.lng.toFixed(4);}).join(';'),cache=!force&&A.KV.get('wmnodes',key,7*864e5),r=cache?cache.v:seenNodes.get(key);
          if(!r){r=await readSplit('walmart',{url:'https://www.walmart.com/store-finder',mode:'nodes',points:batch.map(function(p){return {lat:p.lat,lng:p.lng};}),radiusMi:discovery?8:5},'points','nodes');if(!r.error&&!r.blocked&&!r.cancelled){seenNodes.set(key,r);if((r.nodes||[]).length)A.KV.put('wmnodes',key,r);}}
          nodes=nodes.concat(r.nodes||[]);
        }
        nodes=Array.from(new Map(nodes.filter(function(n){var p=n.geoPoint||n.geo;return /^\d+$/.test(String(n.id))&&p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&(discovery?areas.some(function(a){return P.haversineMi(a.lat,a.lng,p.latitude,p.longitude)<=a.radius;}):known.some(function(s){return s.brand==='walmart'&&P.haversineMi(s.lat,s.lng,p.latitude,p.longitude)<=0.6;}));}).map(function(n){return [String(n.id),n];})).values());
        var todo=[];nodes.forEach(function(n){var cached=seenPrices.get(String(n.id))||(!force&&A.KV.get('wmprice','keyless-v1|'+n.id,15*60000));if(cached)out.push(cached.v||cached);else todo.push(n);});
        for(var wi=0;wi<todo.length&&!stopped();wi+=15){
          var wb=todo.slice(wi,wi+15),wr=await readSplit('walmart',{url:'https://www.walmart.com/store-finder',mode:'prices',nodes:wb},'nodes','stores');
          var normalized=stamp(wr.stores||[],P.normalizeWalmart);out=out.concat(normalized);
          normalized.forEach(function(s){seenPrices.set(s.wmStoreId,s);if(Object.keys(s.prices).length)A.KV.put('wmprice','keyless-v1|'+s.wmStoreId,s);});
          recordObserved(discovery?normalized:updateKnown(known,normalized,P,null).stations);
        }
        if(discovery)nodes.forEach(function(n){if(!out.some(function(s){return s.wmStoreId===String(n.id);}))out.push(P.normalizeWalmart({id:n.id,name:n.displayName,address:n.address,geo:n.geoPoint||n.geo,fuel:{prices:[]}}));});
      }
      // Refresh existing Murphy rows too; discovery is scoped to Walmart here to keep this fix focused.
      var mu=known.filter(function(s){return s.brand==='murphy';});
      if(!A.siteOn||A.siteOn('murphy'))for(var mi=0;mi<mu.length&&!stopped();mi+=60){var mr=await read('murphy',{url:'https://service.murphydriverewards.com/mapmodule/',points:mu.slice(mi,mi+60).map(function(s){return {lat:s.lat,lng:s.lng};}),radiusMi:5,max:25});var ms=stamp(mr.stores||[],P.normalizeMurphy);out=out.concat(ms);recordObserved(updateKnown(known,ms,P,null).stations);}
      return out.filter(Boolean);
    };
  }
  function mergeOfficialDiscovery(known,official,P){
    var updated=updateKnown(known,official,P,null).stations;
    official.forEach(function(w){if(!updated.some(function(s){return w.wmStoreId&&s.wmStoreId===w.wmStoreId||w.murphyStore&&s.murphyStore===w.murphyStore||s.id===w.id;}))updated.push(w);});
    return dedupeDiscovery(updated,P);
  }
  async function discover(areas,onProgress,grade,force){
    if(busy)throw new Error('A keyless lookup is already running');
    grade=grade||'regular';var A=root.__app,P=A.P;if(!P.GRADES[grade])throw new Error('Unsupported fuel grade');
    var lanes=readerKeys(Math.min(readerCount(A),areas.maxLanes||50,Math.max(1,areas.length))),control={cancelled:false,wake:[],lanes:lanes};busy=control;scanChanged();
    var next=0,done=0,rows=[],errors=[],details=[],loads=0,blocked=false,started=Date.now(),timer,sourcesDone=false,chainLabel='Checking Walmart website prices';
    var recs=[],officialMs=null,mem0=memNow(A),LG=root.FLog;
    if(LG)LG.info('keyless','Discovery started',{areas:areas.length,plan:areas.plan||null,lanes:lanes.length,aggressive:!!A.S.keylessAggressive,grade:grade,force:!!force,mem:mem0});
    var audit=scanAudit(A,'discovery',lanes,areas.length,control),outcome='failed';
    function progressLog(){if(!LG||done%50)return;var recent=recs.slice(-50).filter(function(r){return !r.cache;}),el=Date.now()-started;
      LG.info('keyless','Discovery progress',{done:done,of:areas.length,elapsedS:Math.round(el/1000),areasPerMin:+(done/(el/60000)).toFixed(1),recentAreaMs:recent.length?Math.round(recent.reduce(function(a,r){return a+r.ms;},0)/recent.length):null,stations:rows.length,mem:memNow(A)});}
    function report(){var seconds=done?Math.ceil((Date.now()-started)/1000/done*(areas.length-done)):null;var text=done===areas.length&&!sourcesDone?chainLabel:!done?'Preparing… · '+areas.length+' areas to search':'Discovering stations · '+done+'/'+areas.length+' areas · '+(seconds==null?'Estimating time…':seconds>=60?'~'+Math.ceil(seconds/60)+' min remaining':'~'+seconds+' sec remaining');text=pausedText(control)||text;if(onProgress)onProgress(areas.length?done/areas.length*(sourcesDone?1:0.9):sourcesDone?1:0,text);}
    try{
      control.report=report;timer=setInterval(function(){report();audit.tick();},1000);report();
      var chain=officialReader(control,function(){loads++;},function(e){errors.push(e);},function(label){chainLabel=label;report();});
      var chainWork=chain([],areas,true,force).finally(function(){sourcesDone=true;officialMs=Date.now()-started;report();});
      // queue: area indexes still to read. A read that failed to load (network, timeout, unreadable page) and found
      // nothing goes to `again` and is read again after the pass, on a few lanes (RETRY_LANES), up to RETRIES more times:
      // a check's aftermath or a burst of 50 readers loses pages, and a lost area left a hole in the route's stations.
      var queue=areas.map(function(_,i){return i;}),again=[],tries={},round=0,retried=0;
      var pool=readerPool(A,lanes,control,audit,function(){return next<queue.length&&!blocked;});
      async function lane(key){while(next<queue.length&&!blocked&&!control.blocked&&!control.cancelled){
        if(lanes.indexOf(key)>=pool.target()&&!await pool.permit(key))break;
        // just after a check closed, only the first few lanes read: 50 pages at once would bring the check back
        while(control.calmUntil>Date.now()&&lanes.indexOf(key)>=RETRY_LANES&&!control.cancelled&&!control.pause)await new Promise(function(r){setTimeout(r,1000);});
        if(next>=queue.length||blocked||control.blocked||control.cancelled)break;
        var idx=queue[next++],a=areas[idx],cacheKey='discover-v1|'+grade+'|'+a.lat.toFixed(5)+'|'+a.lng.toFixed(5)+'|'+a.radius,cache=!force&&A.KV.get('gasweb',cacheKey,15*60000),r,wake,t0=Date.now();
        if(cache&&cache.v&&cache.v.detail&&cache.v.detail.stopReason==='quiet')cache=null; // Older readers incorrectly cached silence as complete.
        if(cache)r=cache.v;
        else{
          loads++;audit.begin(key);var stopped=new Promise(function(resolve){wake=function(){resolve({cancelled:true});};control.wake.push(wake);});
          try{r=await Promise.race([scanRead(control,key,{url:webUrl(a),mode:'discover',grade:grade}),stopped]);}catch(e){r={error:e.message};}finally{audit.end(key);control.wake=control.wake.filter(function(f){return f!==wake;});}
          if(r.cancelled){if(r.code==='renderer'){errors.push(r.error||'Website renderer stopped');cancel();}recs.push({i:idx,lane:lanes.indexOf(key),at:t0-started,ms:Date.now()-t0,cancelled:true});break;}
          var at=Date.now();(r.stores||[]).forEach(function(s){Object.keys(s.prices||{}).forEach(function(g){s.prices[g].observedAt=at;});});
          if(!r.blocked&&!r.error&&r.detail&&r.detail.exhausted)A.KV.put('gasweb',cacheKey,r);
        }
        if(!cache&&retryable(r)&&(tries[idx]||0)<RETRIES){tries[idx]=(tries[idx]||0)+1;again.push(idx);recs.push({i:idx,lane:lanes.indexOf(key),at:t0-started,ms:Date.now()-t0,d:r.detail||null,found:0,added:0,err:r.error||null,retry:true});continue;}
        if(r.blocked){blocked=true;control.blocked=true;control.blockedSite=control.blockedSite||'gasweb';errors.push(r.error||'Website restricted discovery');}
        if(r.error&&!r.blocked)errors.push(r.error);
        if(tries[idx])retried++;
        var found=dedupeDiscovery((r.stores||[]).filter(function(s){return contains(s,a,P);}),P);
        if(root.PriceHistory){var persistAt=Date.now();root.PriceHistory.observe(found);audit.persist(Date.now()-persistAt);}
        var before=rows.length;rows=dedupeDiscovery(rows.concat(found),P);details.push(r.detail||{});
        recs.push({i:idx,lane:lanes.indexOf(key),at:t0-started,ms:Date.now()-t0,cache:!!cache,d:r.detail||null,found:found.length,added:rows.length-before,err:r.error||null});
        done++;audit.complete(!!cache);report();progressLog();
      }}
      var webWork=(async function(){
        await Promise.all(lanes.map(lane));
        while(again.length&&!control.cancelled&&!blocked&&!control.blocked){
          round++;queue=again;again=[];next=0;
          if(LG)LG.info('keyless','Reading again areas that failed to load',{areas:queue.length,round:round,lanes:Math.min(RETRY_LANES,lanes.length)});
          await new Promise(function(r){setTimeout(r,2000*round);});
          await Promise.all(lanes.slice(0,RETRY_LANES).map(lane));
        }
      })();
      var finished=await Promise.all([chainWork,webWork]);
      var webRows=rows.length;rows=mergeOfficialDiscovery(rows,finished[0],P);recordObserved(rows);
      if(LG){
        var el=Date.now()-started,sum=discoveryReport(recs.filter(function(r){return !r.retry;}),{elapsedMs:el,areas:areas.length,lanes:lanes.length,stations:webRows,priced:rows.filter(function(s){return s.prices&&s.prices[grade];}).length,officialMs:officialMs,errors:Array.from(new Set(errors)).slice(0,5),mem:{start:mem0,end:memNow(A)}});
        LG.info('keyless','Discovery finished',Object.assign({withOfficial:rows.length,cancelled:control.cancelled,blocked:blocked||!!control.blocked,retriedAreas:retried,retryRounds:round,stillFailed:recs.filter(function(r){return r.err&&!r.retry&&!r.cancelled;}).length},sum));
        // one row per area, in batches that fit a log entry: where each lane spent its time
        var cols='area, lane, start s, total ms, reader ms, list shown ms, last new row ms, stop, scrolls, rows, priced, in area, new, lean, full retry, retry ms, first stop, first rows, omitted graphics, omitted telemetry, feed height, feed scroll height';
        var line=function(r){var d=r.d||{};return [r.i,r.lane,Math.round(r.at/1000),r.ms,d.elapsedMs==null?null:d.elapsedMs,d.firstFeedMs==null?null:d.firstFeedMs,d.lastGrowthMs==null?null:d.lastGrowthMs,r.cancelled?'cancel':r.retry?'retry':r.err?'error':r.cache?'cache':d.stopReason||'?',d.scrolls||0,d.read||0,d.priced||0,r.found||0,r.added||0,d.leanResources==null?null:!!d.leanResources,!!d.fullResourceRetry,d.retryElapsedMs||0,d.firstAttemptStopReason||'',d.firstAttemptRows||0,d.omittedGraphics||0,d.omittedTelemetry||0,d.feedHeight||0,d.feedScrollHeight||0];};
        for(var b=0;b<recs.length;){var from=b,block=[];while(b<recs.length){var row=line(recs[b]);if(block.length&&JSON.stringify({cols:cols,rows:block.concat([row])}).length>1800)break;block.push(row);b++;}LG.debug('keyless','Discovery areas '+(from+1)+'–'+b+' of '+recs.length,{cols:cols,rows:block});}
      }
      outcome=control.cancelled?'cancelled':blocked||control.blocked?'restricted':errors.length?'partial':'finished';
      return {stations:rows,errors:Array.from(new Set(errors)),details:details,blocked:blocked||!!control.blocked,blockedSite:control.blockedSite||'gasweb',cancelled:control.cancelled,areas:areas.length,completedAreas:done,websiteLoads:loads,apiCalls:0,partial:true,at:Date.now()};
    }finally{clearInterval(timer);audit.finish(outcome);busy=null;releaseReaders();scanChanged();}
  }
  async function search(lat,lng,radius){
    if(busy)throw new Error('A keyless gas lookup is already running');
    var A=root.__app,P=A.P,a=area(lat,lng,radius),key=[a.lat.toFixed(3),a.lng.toFixed(3),a.radius].join('|');
    var cached=A.KV.get('gasweb',key,15*60000);
    if(cached)return cached.v;
    busy=true;scanChanged();
    try{
      var errors=[],open=[],web=[],details={area:a,apiCalls:0};
      // One bounded Overpass query, cached for a week. No route-wide fanout, no automatic retries.
      var o=A.KV.get('osm-fuel',key,7*864e5);
      if(o)open=o.v;
      else if(Date.now()-lastOsm<30000)errors.push('OpenStreetMap lookup cooling down; wait 30 seconds');
      else{
        lastOsm=Date.now();
        try{
          var day=new Date().toISOString().slice(0,10), q=A.KV.get('gasmeta','osm-budget'),budget=q&&q.v&&q.v.day===day?q.v:{day:day,calls:0,bytes:0};
          if(budget.calls>=20||budget.bytes>=5e6)throw new Error('Experimental daily limit reached; cached locations remain available');
          budget.calls++;A.KV.put('gasmeta','osm-budget',budget);
          var r=await call('fetchJson',osmUrl(a));
          if(r.error)throw new Error(r.error);
          budget.bytes+=(r.body||'').length*2;A.KV.put('gasmeta','osm-budget',budget);
          if((r.body||'').length>1000000)throw new Error('Area response too large; search a smaller area');
          var data=JSON.parse(r.body);open=normalizeOsm(data,a,P);if(data.remark)errors.push('OpenStreetMap returned partial data');else A.KV.put('osm-fuel',key,open);
        }
        catch(e){errors.push('OpenStreetMap: '+e.message);}
      }
      if(Date.now()-lastWeb<30000)errors.push('Google web lookup cooling down; wait 30 seconds');
      else{
        lastWeb=Date.now();
        try{var g=await call('siteRead','gasweb',JSON.stringify({url:webUrl(a)}));web=g.stores||[];web.forEach(function(s){Object.keys(s.prices||{}).forEach(function(k){s.prices[k].observedAt=Date.now();});});details.google=g.detail||{};if(g.error)errors.push(g.error);if(g.blocked)details.blocked=true;}
        catch(e){errors.push('Google Maps web: '+e.message);}
      }
      var result={stations:merge(open,web,a,P),errors:errors,detail:details,partial:true};
      details.openStations=open.length;details.webStations=web.length;
      details.priced=result.stations.filter(function(s){return s.prices.regular;}).length;
      if(!errors.length)A.KV.put('gasweb',key,result);
      if(root.FLog)FLog.info('keyless','Nearby regular lookup',details);
      return result;
    }finally{busy=null;scanChanged();}
  }
  async function refreshKnown(known,onProgress,priority,grade){
    grade=grade||'regular';if(!root.__app.P.GRADES[grade])throw new Error('Unsupported fuel grade');
    if(busy)throw new Error('A keyless lookup is already running');
    var A=root.__app,lanes=readerKeys(readerCount(A)),control={cancelled:false,wake:[],lanes:lanes};busy=control;scanChanged();
    var P=A.P,groups=knownAreas(known,P,priority),rows=new Map(),errors=[],reads=0,blocked=false,start=Date.now();
    var buckets=new Map();known.forEach(function(s){var key=Math.floor(s.lat*50)+'|'+Math.floor(s.lng*50);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(s);});
    function nearby(w){var x=Math.floor(w.lat*50),y=Math.floor(w.lng*50);for(var dx=-1;dx<=1;dx++)for(var dy=-1;dy<=1;dy++){var candidates=buckets.get((x+dx)+'|'+(y+dy))||[];if(candidates.some(function(s){return P.haversineMi(s.lat,s.lng,w.lat,w.lng)<=officialRadius(w);}))return true;}return false;}
    var cached=groups.map(function(g){var key='known-v3|'+grade+'|'+[g.lat.toFixed(4),g.lng.toFixed(4)].join('|')+'|'+JSON.stringify(g.stations.map(knownKey).sort());return {g:g,key:key,cache:A.KV.get('gasweb',key,15*60000)};});
    // Dedicated readers; never overlap requests on the same WebView.
    var ordered=cached.filter(function(x){return x.cache;}).concat(cached.filter(function(x){return !x.cache;}));
    var next=0,done=0,samples=0,totalMs=0,active=new Map();
    var audit=scanAudit(A,'refresh',lanes,groups.length,control),outcome='failed';
    var pool=readerPool(A,lanes,control,audit,function(){return next<ordered.length&&!blocked;});
    function report(){
      var average=samples?totalMs/samples:null,remaining=ordered.slice(next).filter(function(x){return !x.cache;}).length;
      var work=average==null?null:remaining*average;
      if(work!=null)active.forEach(function(t){work+=Math.max(1000,average-(Date.now()-t));});
      var eta=work==null?null:Math.ceil(work/Math.min(pool.target(),remaining+active.size||1)/1000);
      var text=control.cancelled?'Cancelling; keeping completed prices':!done?'Preparing… · '+ordered.length+' areas to check':'Refreshing saved prices · '+done+'/'+ordered.length+' areas';
      text+=' · '+(eta==null?'Estimating time…':eta>=60?'~'+Math.ceil(eta/60)+' min remaining':'~'+eta+' sec remaining');
      text=pausedText(control)||text;if(onProgress)onProgress(ordered.length?done/ordered.length:1,text,{completed:done,total:ordered.length,remainingSeconds:eta});
    }
    control.report=report;var ticker=setInterval(function(){report();audit.tick();},1000);
    var chain=officialReader(control,function(){reads++;},function(e){errors.push(e);});
    function read(key,args){if(control.cancelled||blocked||control.blocked)return Promise.resolve({cancelled:true});reads++;return scanRead(control,key,args);}
    async function areaRead(x,key){
      var official=x.g.stations.some(function(s){return s.brand==='walmart'||s.brand==='murphy';})?await chain(x.g.stations,[],false,false):[];
      if(control.blocked)return {blocked:true,blockedSite:control.blockedSite,stores:official};
      if(control.cancelled||blocked)return {cancelled:true};
      var suppliedAt=Date.now(),complete=updateKnown(x.g.stations,official,P,suppliedAt,grade);
      if(official.length&&complete.updated===x.g.stations.length)return {stores:official};
      var gr=await read(key,{url:webUrl(area(x.g.lat,x.g.lng,8)),grade:grade,targets:x.g.stations.map(function(s){return {id:s.id,featureId:s.featureId,brand:s.brand,lat:s.lat,lng:s.lng,address:s.address};})});
      // Keep trusted official records separate; do not transfer a regular label to another grade.
      var supplied=new Set(complete.stations.filter(function(s){return s.prices&&s.prices[grade]&&s.prices[grade].observedAt===suppliedAt;}).map(knownKey));
      var google=(gr.stores||[]).filter(function(w){return !x.g.stations.some(function(s){return s.brand===(P.detectBrand(w.name,w.website)||w.brand)&&supplied.has(knownKey(s))&&P.haversineMi(s.lat,s.lng,w.lat,w.lng)<0.1;});});
      return Object.assign({},gr,{stores:official.concat(google),error:gr.code==='no_prices'&&official.some(function(s){return s.prices[grade];})?null:gr.error});
    }
    try{
      async function lane(key){while(next<ordered.length&&!blocked&&!control.blocked&&!control.cancelled){
        if(lanes.indexOf(key)>=pool.target()&&!await pool.permit(key))break;
        if(next>=ordered.length||blocked||control.blocked||control.cancelled)break;
        var x=ordered[next++],r,at;
        if(x.cache){r=x.cache.v;at=x.cache.t;}
        else{
          var began=Date.now(),wake;
          active.set(key,began);audit.begin(key);
          var stopped=new Promise(function(resolve){wake=function(){resolve({cancelled:true});};control.wake.push(wake);});
          try{r=await Promise.race([areaRead(x,key),stopped]);}
          catch(e){r={error:e.message};}
          finally{active.delete(key);audit.end(key);control.wake=control.wake.filter(function(f){return f!==wake;});}
          if(r.cancelled){if(r.code==='renderer'){errors.push(r.error||'Website renderer stopped');cancel();}break;}
          samples++;totalMs+=Date.now()-began;
          at=Date.now();
          if(r.blocked){blocked=true;control.blockedSite=r.blockedSite||'gasweb';errors.push(r.error||'Website restricted the refresh');}
          if(r.error)errors.push(r.error);
          // Cache is scoped to this exact target set, including early-complete replies.
          if((!r.error||r.code==='no_prices')&&!r.blocked)A.KV.put('gasweb',x.key,Object.assign({},r,{stores:(r.stores||[]).filter(nearby)}));
        }
        var added=(r.stores||[]).filter(nearby);
        added.forEach(function(w){var id=w.placeId||w.featureId||w.id,old=rows.get(id);if(!old||old.observedAt<=at)rows.set(id,Object.assign({},w,{observedAt:at}));});
        // Flush successful observations after each area, not after a twenty-minute batch.
        if(root.PriceHistory&&added.length){
          var persistAt=Date.now();
          var localKnown=known.filter(function(s){return added.some(function(w){return P.haversineMi(s.lat,s.lng,w.lat,w.lng)<=officialRadius(w);});});
          var localWeb=Array.from(rows.values()).filter(function(w){return localKnown.some(function(s){return P.haversineMi(s.lat,s.lng,w.lat,w.lng)<=officialRadius(w);});});
          var checkpoint=updateKnown(localKnown,localWeb,P,null,grade);
          recordObserved(checkpoint.stations);
          audit.persist(Date.now()-persistAt);
        }
        done++;audit.complete(!!x.cache);
        report();
      }}
      report();
      await Promise.all(lanes.map(lane));
      // Overlapping areas can return the same Google station. Keep one row before matching.
      var web=Array.from(rows.values());
      var result=updateKnown(known,web,P,null,grade);
      result.cancelled=control.cancelled;result.completedAreas=done;
      if(root.PriceHistory){
        root.PriceHistory.observe(result.stations.map(function(s){return Object.assign({},s,{prices:{}});}));
        recordObserved(result.stations);
      }
      result.total=new Set(known.map(knownKey)).size;result.retained=result.total-result.updated;result.errors=Array.from(new Set(errors));result.blocked=blocked;result.websiteLoads=reads;result.areas=groups.length;result.apiCalls=0;result.at=Date.now();
      result.grade=grade;
      result.blockedSite=control.blockedSite;
      if(samples)A.KV.put('gasmeta','timing|'+grade,{averageAreaMs:Math.round(totalMs/samples),samples:samples,at:Date.now()});
      if(root.FLog)FLog.info('keyless','Saved trip price refresh',{updated:result.updated,total:result.total,retained:result.retained,websiteLoads:reads,areas:groups.length,readerConcurrency:lanes.length,averageAreaMs:samples?Math.round(totalMs/samples):null,blocked:blocked,errors:errors,elapsedMs:Date.now()-start});
      outcome=control.cancelled?'cancelled':blocked||control.blocked?'restricted':errors.length?'partial':'finished';
      return result;
    }finally{clearInterval(ticker);audit.finish(outcome);busy=null;releaseReaders();scanChanged();}
  }
  function recordObserved(stations){if(!root.PriceHistory)return;root.PriceHistory.observe(stations.map(function(s){var prices={};Object.keys(s.prices||{}).forEach(function(g){if(s.prices[g].observedAt)prices[g]=s.prices[g];});return Object.assign({},s,{prices:prices});}));}
  function estimate(known,grade){
    var A=root.__app,groups=knownAreas(known,A.P),o=A.KV.get('gasmeta','timing|'+(grade||'regular')),ms=o&&o.v.averageAreaMs||10000;
    var readers=readerCount(A);return {areas:groups.length,seconds:Math.ceil(groups.length*ms/readers/1000),measured:!!o,readers:readers};
  }
  root.KeylessGas=Object.assign(math,{search:search,discover:discover,refreshKnown:refreshKnown,cancel:cancel,estimate:estimate,isBusy:function(){return !!busy;},onVerified:verified,isPaused:function(){return !!(busy&&busy.pause);}});
})(typeof window!=='undefined'?window:globalThis);
