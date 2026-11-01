/* Forecast orchestration. Provider calls use the same
 * native HERE monthly reservation as tolls; cached answers are not trip-specific. */
(function(root){
  'use strict';
  function init(A,call,context){
    var profiles=new WeakMap(),running=new Map(),failure='',coverage=null,sequence=0,settingsEpoch=0;
    function policy(m){var s=context.journeySeconds&&context.journeySeconds();return TrafficPolicy.resolve(A.S.trip.trafficPreset,s>0?s:m&&m.durationSec||0);}
    var service=Traffic.create({policy:policy,get:function(k,ttl){var r=A.KV.get('traffic',k,ttl);return r&&r.v;},put:function(k,v){A.KV.put('traffic',k,v);},fetch:async function(q){if(!enabled())throw Error('Traffic lookup cancelled');var r=await call('fetchHere',A.S.hereKey,q,A.S.hereMonthlyCap==null?2000:Math.max(0,parseInt(A.S.hereMonthlyCap,10)||0));if(root.__apiCount)root.__apiCount();return r;}});
    var browserMode=false,verifyWait=null,browserChain=Promise.resolve(),browserQueued=0,browserActive=0,nativeActive=0;
    var fixedGoogle=RestAccess.limiter({readers:function(){return browserMode?1:WorkerSettings.trafficCount(A);}});
    function readers(){return browserMode?1:WorkerSettings.trafficCount(A);}
    var cache=TrafficCache.create(A.KV),zones=new Map(),zoneFlights=new Map();
    function flush(){cache.flush();}
    root.addEventListener('pagehide',flush);root.addEventListener('visibilitychange',function(){if(document.hidden)flush();});
    function get(k,ttl){return cache.get(k,ttl);}
    function put(k,v){return cache.put(k,v);}
    var access=RestAccess.create({get:function(k,ttl){var r=get(k,ttl);return r&&r.v;},put:put}),zoneQueue=[],zoneActive=0,zoneTimer=null,zoneGeneration=0,zoneCoolUntil=0,zoneStats={zoneRequests:0,zonePoints:0,zoneCacheHits:0,zoneShared:0,zoneFailures:0};
    function zoneOK(z){try{if(!z)return false;new Intl.DateTimeFormat('en-US',{timeZone:z});return true;}catch(e){return false;}}
    function pumpZones(){zoneTimer=null;while(zoneActive<2&&zoneQueue.length){var batch=zoneQueue.splice(0,20),generation=zoneGeneration;zoneActive++;(async function(batch,generation){try{if(Date.now()<zoneCoolUntil)throw Error('Timezone service limited requests; retry later');zoneStats.zoneRequests++;zoneStats.zonePoints+=batch.length;
      var q='https://api.open-meteo.com/v1/forecast?latitude='+batch.map(function(x){return x.p.lat.toFixed(5);}).join(',')+'&longitude='+batch.map(function(x){return x.p.lng.toFixed(5);}).join(',')+'&forecast_days=1&timezone=auto',a=await (context.timezoneFetch?context.timezoneFetch(q,batch.length):call('fetchJson',q));
      if(a.error){if(a.status===429||/429/.test(a.error))zoneCoolUntil=a.retryAt||Date.now()+Math.min(300,Math.max(30,+a.retryAfter||60))*1000;throw Error(a.error);}var j=typeof a.body==='string'?JSON.parse(a.body):a,rows=Array.isArray(j)?j:[j];if(rows.length!==batch.length)throw Error('Timezone response incomplete');
      batch.forEach(function(x,i){if(generation!==zoneGeneration){x.reject(Error('Traffic lookup cancelled'));return;}var z=rows[i]&&rows[i].timezone;if(!zoneOK(z)){zoneStats.zoneFailures++;x.reject(Error('Origin timezone unavailable: invalid timezone response'));return;}zones.set(x.k,z);A.KV.put('traffic',x.k,{zone:z});A.KV.put('restplaces',x.shared,{zone:z});x.resolve(z);});
     }catch(e){zoneStats.zoneFailures+=batch.length;batch.forEach(function(x){x.reject(Error('Origin timezone unavailable: '+String(e.message).slice(0,180)));});}finally{zoneActive--;pumpZones();}})(batch,generation);}}
    async function zone(p,valid){valid=valid||function(){return true;};if(!valid())throw Error('Traffic lookup cancelled');var suffix=p.lat.toFixed(5)+'|'+p.lng.toFixed(5),k='zone|'+suffix,shared='timezone|'+suffix;
     if(zoneOK(p.timeZone)){zoneStats.zoneCacheHits++;return p.timeZone;}if(zones.has(k)){zoneStats.zoneCacheHits++;return zones.get(k);}var r=A.KV.get('restplaces',shared,180*86400000)||A.KV.get('traffic',k,180*86400000);if(r&&r.v&&zoneOK(r.v.zone)){zoneStats.zoneCacheHits++;zones.set(k,r.v.zone);return r.v.zone;}
     var task=zoneFlights.get(k);if(!task){task=new Promise(function(resolve,reject){zoneQueue.push({p:p,k:k,shared:shared,resolve:resolve,reject:reject});if(!zoneTimer)zoneTimer=setTimeout(pumpZones,0);}).finally(function(){if(zoneFlights.get(k)===task)zoneFlights.delete(k);});zoneFlights.set(k,task);}else zoneStats.zoneShared++;var z=await task;if(!valid())throw Error('Traffic lookup cancelled');return z;
    }
    function accessStats(){return Object.assign({},access.stats(),zoneStats,{zoneActive:zoneActive,zoneQueued:zoneQueue.length,zoneCooldownMs:Math.max(0,zoneCoolUntil-Date.now()),restReaders:root.WorkerSettings.restCount?WorkerSettings.restCount(A):null,trafficReaders:readers(),transport:browserMode?'browser':'native',pacing:fixedGoogle.stats(),nativeActive:nativeActive,browserQueued:browserQueued,waitingVerification:!!verifyWait});}
    async function between(a,b,t,valid){valid=valid||function(){return true;};var epoch=settingsEpoch,pv=provider(),avoid=Object.assign({},A.S.trip.avoid),alive=function(){return enabled()&&settingsEpoch===epoch&&valid();};if(!alive())throw Error('Traffic lookup cancelled');
     return access.read(RestAccess.identity(pv,a,b,t,avoid),policy().ttl,alive,async function(needed,onStart){var p;
      if(pv==='here'){if(!needed())throw Error('Rest access cancelled');onStart();var q='transportMode=car&origin='+a.lat+','+a.lng+'&destination='+b.lat+','+b.lng+'&departureTime='+encodeURIComponent(new Date(t).toISOString())+'&return=polyline,summary',r=await call('fetchHere',A.S.hereKey,q,A.S.hereMonthlyCap==null?2000:+A.S.hereMonthlyCap);if(root.__apiCount)root.__apiCount();if(r.error)throw Error(r.error);var j=typeof r.body==='string'?JSON.parse(r.body):r,sections=j.routes&&j.routes[0]&&j.routes[0].sections;if(!sections||!sections.length)throw Error('Rest access route unavailable');p={pts:[],seconds:0,meters:0};sections.forEach(function(s){p.pts=p.pts.concat(Traffic.decode(s.polyline));p.seconds+=s.summary.duration;p.meters+=s.summary.length;});
      }else{var z=await zone(a,needed),clock=GoogleTraffic.wall(t,z),r=await google.request(GoogleTraffic.query(a,b,clock,avoid),needed,onStart);if(r.error)throw Error(r.error);p=GoogleTraffic.parse(r.body,clock)[0];}
      if(!p||!p.pts||p.pts.length<2||Trip.hav(p.pts[0],a)>.15||Trip.hav(p.pts[p.pts.length-1],b)>.15)throw Error('Site access road could not be verified');return p;
     });
    }
    function verification(valid){if(!verifyWait){var resolve;var promise=new Promise(function(r){resolve=r;});verifyWait={promise:promise,resolve:resolve,end:root.Tasks&&Tasks.begin('traffic-check',{text:'Google Maps traffic paused · complete the website check',priority:40})};if(root.FLog)FLog.warn('traffic','Traffic verification required',{transport:browserMode?'browser':'native'});A.showSiteCheck('traffic','Google Maps traffic');}
      return new Promise(function(resolve,reject){var wait=verifyWait,timer=setInterval(function(){if(!valid()){clearInterval(timer);reject(Error('Traffic lookup cancelled'));}},500);wait.promise.then(function(ok){clearInterval(timer);if(ok&&valid())resolve();else reject(Error('Traffic lookup cancelled'));});});}
    root.addEventListener('trafficverified',function(){browserMode=true;if(verifyWait){var w=verifyWait;verifyWait=null;if(w.end)w.end();w.resolve(true);}});
    root.addEventListener('trafficcancel',function(){if(verifyWait){var w=verifyWait;verifyWait=null;if(w.end)w.end();w.resolve(false);}});
    async function googleFetch(q,valid,onStart){
      for(var attempt=0;attempt<3;attempt++){
       if(!valid())throw Error('Traffic lookup cancelled');if(verifyWait)await verification(valid);
       var r=await fixedGoogle.run(async function(){
        if(verifyWait)await verification(valid);if(!valid())throw Error('Traffic lookup cancelled');
        if(browserMode){browserQueued++;var run=browserChain.then(async function(){browserQueued--;if(!valid())throw Error('Traffic lookup cancelled');browserActive++;try{if(onStart)onStart();return await call('siteRead','traffic',JSON.stringify({url:'https://www.google.com/maps',pb:q}));}finally{browserActive--;}});browserChain=run.catch(function(){});return run;}
        nativeActive++;try{if(onStart)onStart();var answer=await call('fetchGoogleTraffic',q);if(answer.error){var e=Error(answer.error);e.status=answer.status;e.retryAfter=answer.retryAfter;throw e;}return answer;}finally{nativeActive--;}
       },valid);
       if(!r.blocked)return r;await verification(valid);
      }throw Error('Google traffic still needs verification; retry when ready');
    }
    // Lazy reads: a fresh matching record must not be hidden behind four expired/incompatible entries. Include
    // intersecting sections so GoogleTraffic can join several records and fetch only the gaps between them.
    function* observations(m,t,ttl,avoid){
      var box=[Infinity,Infinity,-Infinity,-Infinity],now=Date.now();avoid=avoid||A.S.trip.avoid||{};var ak=[!!avoid.highways,!!avoid.tolls,!!avoid.ferries].join('|');
      m.pts.forEach(function(p){box[0]=Math.min(box[0],p.lat);box[1]=Math.min(box[1],p.lng);box[2]=Math.max(box[2],p.lat);box[3]=Math.max(box[3],p.lng);});
      var entries=cache.entries().filter(function(e){var r=e.bounds;return r&&r[0]<=box[2]+.001&&r[2]>=box[0]-.001&&r[1]<=box[3]+.001&&r[3]>=box[1]-.001&&t<=e.end+150000&&(!Number.isFinite(e.observedAt)||now-e.observedAt<ttl)&&(e.avoidKey==null||e.avoidKey===ak);});
      entries.sort(function(a,b){return Math.abs(t-a.start)-Math.abs(t-b.start);});
      var future=new Map(),legacyProbe=false;
      for(var e of entries){
        // A profile that starts later cannot cover the current departure. Its indexed endpoints are enough to
        // find the next possible cached stretch; don't load thousands of future-hour payloads from native KV.
        if(e.start>t+150000){
          if(e.first&&e.last){var k=[e.first.lat,e.first.lng,e.last.lat,e.last.lng].join('|');if(!future.has(k))future.set(k,{gap:{first:e.first,last:e.last,depart:e.start}});continue;}
          if(legacyProbe)continue;legacyProbe=true; // lazily learn old endpoint metadata without a bulk disk scan
        }
        var r=get(e.key,ttl);if(r&&r.v)yield r.v;
      }
      yield* future.values();
    }
    var google=GoogleTraffic.create({policy:policy,concurrency:readers,get:get,put:put,observations:observations,zone:zone,fetch:googleFetch});
    function provider(){return A.S.hereTraffic===true&&A.S.hereKey?'here':A.S.googleTraffic!==false?'google':null;}
    function chosen(){return provider()==='here'?service:google;}
    root.addEventListener('cacheclear',function(){profiles=new WeakMap();cache.clear();zones.clear();zoneGeneration++;zoneFlights.clear();zoneQueue.splice(0).forEach(function(x){x.reject(Error('Traffic lookup cancelled'));});if(zoneTimer)clearTimeout(zoneTimer);zoneTimer=null;zoneCoolUntil=0;access.clear();service.clear();google.clear();});
    root.addEventListener('trafficsettingschange',function(){settingsEpoch++;profiles=new WeakMap();failure='';coverage=null;context.invalidate();});
    function enabled(){return A.S.trip.trafficForecast===true&&!!provider();}
    function identity(depart,stops,wait){return JSON.stringify([provider(),Math.floor(depart/60000),A.S.trip.avoid,stops||[],wait?[wait[0]||null,wait[1]||[]]:[null,[]]]);}
    function profile(raw,depart){var p=profiles.get(raw);return enabled()&&p&&p.time===Math.floor(depart/60000)&&p.avoid===JSON.stringify(A.S.trip.avoid)&&Date.now()-p.at<policy({durationSec:p.value.cachePolicy&&p.value.cachePolicy.seconds}).ttl?p.value:null;}
    function model(raw,base,depart){var p=profile(raw,depart);return p?Traffic.overlay(base,p):base;}
    var work=new Map(),finished=0,workTotal=0,expected=0,avgPieces=4,workTimer=null,workEnd=null,rateRecord=A.KV.get('traffic','reader-rate'),pieceMs=rateRecord&&rateRecord.v&&rateRecord.v.ms||1800;
    var workLogAt=0,workDiskStart=0;
    function workText(){if(!work.size)return;var jobs=Array.from(work.values()),reused=jobs.reduce(function(n,j){return n+(j.cachedSections||0);},0),latest=jobs[jobs.length-1],remaining=jobs.reduce(function(n,j){return n+Math.max(0,j.total-j.done);},0),serial=Math.max.apply(null,jobs.map(function(j){return Math.max(0,j.total-j.done)*(j.cached?30:pieceMs);})),waiting=Math.max(0,expected-finished-jobs.length),ms=Math.max(serial,(remaining+waiting*avgPieces)*pieceMs/Math.max(1,readers())),seconds=Math.max(1,Math.ceil(ms/1000)),queue=latest.queue;if(root.FLog&&Date.now()-workLogAt>=15000){workLogAt=Date.now();FLog.info('traffic','Forecast progress',{activeRoutes:work.size,finishedRoutes:finished,expectedRoutes:expected,piecesDone:jobs.reduce(function(n,j){return n+j.done;},0),piecesKnown:jobs.reduce(function(n,j){return n+j.total;},0),reusedSections:reused,storageReads:cache.stats().diskReads-workDiskStart,reader:google.stats(),transport:browserMode?'browser':'native',nativeActive:nativeActive,browserActive:browserActive,browserQueued:browserQueued,waitingVerification:!!verifyWait,readers:readers(),quietSeconds:Math.round((Date.now()-Math.max.apply(null,jobs.map(function(j){return j.progressAt||j.start;})))/1000)});}root.Tasks&&Tasks.upsert('traffic-work',{text:(latest.phase==='fuel-stops'?'Updating traffic for fuel-stop timing':'Reading forecast traffic')+' · '+(queue?'route '+(queue.index+1)+' / '+queue.total+' · ':'')+latest.label+' · '+finished+' / '+expected+' routes checked'+(jobs.length>1?' · '+jobs.length+' active':'')+(reused?' · '+reused+' sections reused':'')+' · ~'+(seconds<90?seconds+' sec':Math.ceil(seconds/60)+' min')+' remaining',frac:expected?(finished+jobs.reduce(function(n,j){return n+j.done/Math.max(1,j.total);},0))/expected:0,priority:20});}
    function startWork(id,raw,o){if(!work.size){workLogAt=Date.now();workDiskStart=cache.stats().diskReads;finished=0;workTotal=0;expected=0;workEnd=root.Tasks&&Tasks.begin('traffic-work',{text:'Reading forecast traffic · estimating time',priority:20});workTimer=setInterval(workText,1000);}var item={start:Date.now(),total:1,done:0,label:o.label||raw.description||'Selected roads',queue:o.queue,phase:o.phase};work.set(id,item);workTotal++;expected=Math.max(expected,workTotal,o.queue&&o.queue.total>0?finished+work.size+Math.max(0,o.queue.total-o.queue.index-1):0);workText();return function(done,total,meta){item.done=done;item.total=total;item.progressAt=Date.now();item.cached=meta&&meta.cached;item.cachedSections=meta&&meta.cachedSections||0;workText();};}
    function endWork(id){var item=work.get(id);if(!item)return;work.delete(id);finished++;if(item.total>0)avgPieces=avgPieces*.8+item.total*.2;if(item.done&&item.done>=item.total&&!item.cached){var rate=(Date.now()-item.start)/item.total;if(rate>0){pieceMs=pieceMs*.7+rate*.3;A.KV.put('traffic','reader-rate',{ms:pieceMs});}}if(!work.size){clearInterval(workTimer);workTimer=null;if(workEnd)workEnd();workEnd=null;flush();}else workText();}
    async function prepare(raw,base,depart,options){
      if(!enabled())return base;var o=options||{},id=identity(depart,o.stops,[o.waitAt,o.waits]),current=profiles.get(raw);if(!o.force&&current&&current.id===id&&current.at>=(o.freshAfter||0)&&profile(raw,depart))return model(raw,base,depart);
      var key=JSON.stringify([Trip.encodePolyline(base.pts),id,o.force||false,o.freshAfter||0]),epoch=settingsEpoch,valid=function(){return enabled()&&settingsEpoch===epoch&&(!o.valid||o.valid());};
      if(!running.has(key)){var taskId='traffic:'+(++sequence),progress=startWork(taskId,raw,o);
        running.set(key,chosen().forecast(base,depart,{force:o.force,freshAfter:o.freshAfter,stops:o.stops,waitAt:o.waitAt,waits:o.waits,avoid:A.S.trip.avoid,valid:valid,progress:progress}).finally(function(){running.delete(key);endWork(taskId);}));}

      try{var p=await running.get(key);if(!valid())throw Error('Traffic lookup cancelled');profiles.set(raw,{id:id,time:Math.floor(depart/60000),avoid:JSON.stringify(A.S.trip.avoid),at:p.at,value:p});failure='';coverage=p.coverage;var out=Traffic.overlay(base,p),use=function(m){return (m.segs||[]).reduce(function(n,s){return n+(s.to-s.from)*(s.gpm||0);},0);};if(root.FLog)FLog[p.cached?'debug':'info']('traffic','Forecast ready',{miles:Math.round(base.totalMi),minutes:Math.round(p.seconds/60),normalMinutes:Math.round(base.durationSec/60),source:p.source,coveragePct:Math.round((p.coverage||0)*100),unmatchedPieces:(p.legs||[]).filter(function(l){return !(l.coverage>0);}).length,cached:p.cached,cachePreset:p.cachePolicy&&p.cachePolicy.mode,cacheDays:p.cachePolicy&&p.cachePolicy.ttl/86400000,cachedPieces:p.cachedPieces,fetchedPieces:p.fetchedPieces,sharedPieces:p.sharedPieces,cachedSections:p.cachedSections,fetchedSections:p.fetchedSections,lookaheadReads:p.lookaheadReads,lookaheadUsed:p.lookaheadUsed,readMs:p.readMs,ageMinutes:Math.round((Date.now()-p.at)/60000),phase:o.phase||'route',stopCount:(o.stops||[]).length,waitCount:(o.waits||[]).length,legCount:(p.legs||[]).length,legs:(p.legs||[]).slice(0,6).map(function(l){return l.match;}),energyModel:A.S.trafficEnergy?{stopAndGo:Math.round(out.trafficStops||0),energy:Math.round(use(out)*1000)/1000,normalEnergy:Math.round(use(base)*1000)/1000}:'off'});return out;}
      catch(e){profiles.delete(raw);failure=String(e.message||e);coverage=null;if(root.FLog)FLog[e.cachedFailure||/cancelled/i.test(failure)?'debug':'warn']('traffic',/cancelled/i.test(failure)?'Forecast cancelled':'Forecast unavailable',{reason:failure,cached:!!e.cachedFailure,details:e.details});throw e;}
    }
    function html(){return '<label class="field"><span class="lbl">Forecast traffic<small>Uses Google Maps website forecasts without a key. Estimates traffic when you reach each road; timings and energy remain estimates. HERE traffic is optional in Settings → Connections.</small></span><input type="checkbox" id="tTraffic"'+(A.S.trip.trafficForecast?' checked':'')+'></label><p class="lead small keep">'+A.esc(!provider()?'Traffic forecasts are disabled in Settings → Connections. Toll estimates remain independent.':failure?'Traffic forecast not used: '+failure+'. Using normal route times.':coverage!=null&&coverage<.995?'Traffic forecast covers '+Math.round(coverage*100)+'% of this route; the rest uses normal route times.':(provider()==='google'?'Google Maps website forecast · © Google. ':'HERE forecast. ')+'Forecasts are estimates, not guarantees.')+'</p>'+policyHtml();}
    function policyHtml(){return '<label class="nf"><span>Traffic planning cache</span><select id="tTrafficPreset">'+[['auto','Auto · '+policy().label],['commute','Commute / short trip · 2 hours'],['weekend','Weekend / regional trip · 7 days'],['road','Vacation / road trip · 28 days']].map(function(x){return '<option value="'+x[0]+'"'+((A.S.trip.trafficPreset||'auto')===x[0]?' selected':'')+'>'+A.esc(x[1])+'</option>';}).join('')+'</select></label><p class="lead small keep">Auto uses the whole outward drive, before traffic and stops. Refresh traffic anytime in Depart.</p>';}
    function bind(){var select=document.getElementById('tTrafficPreset');if(select)select.onchange=function(){A.S.trip.trafficPreset=select.value;A.save();context.invalidate();};var t=document.getElementById('tTraffic');if(t)t.onchange=function(){A.S.trip.trafficForecast=t.checked;A.save();context.invalidate();};}
    return {enabled:enabled,profile:profile,model:model,prepare:prepare,html:html,bind:bind,forecast:async function(m,t,o){if(!enabled())throw Error('Enable Forecast traffic in Routes to compare rest times');return chosen().forecast(m,t,Object.assign({avoid:A.S.trip.avoid},o||{}));},between:between,accessStats:accessStats};
  }
  root.TrafficFlow={init:init};
})(window);
