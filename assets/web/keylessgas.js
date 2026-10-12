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
  function updateKnown(known,web,P,observedAt,grade){
    grade=grade||'regular';
    var unique=Array.from(new Map(known.map(function(s){return [knownKey(s),s];})).values()),updates=new Map();
    var candidates=web.map(function(w){
      var brand=P.detectBrand(w.name,w.website);
      var stable=unique.filter(function(s){return P.haversineMi(s.lat,s.lng,w.lat,w.lng)<=0.1&&(!brand||brand===s.brand)&&(w.placeId&&w.placeId===s.id||w.featureId&&s.featureId===w.featureId||w.id&&w.id===s.id||w.wmStoreId&&(s.wmStoreId===w.wmStoreId||s.id==='wm-'+w.wmStoreId)||w.murphyStore&&s.murphyStore===w.murphyStore);});
      if(stable.length)return stable;
      return unique.filter(function(s){
        var distance=P.haversineMi(s.lat,s.lng,w.lat,w.lng);
        if(!Number.isFinite(distance)||distance>0.1||brand&&brand!==s.brand)return false;
        if(w.placeId&&w.placeId===s.id||w.featureId&&s.featureId===w.featureId||w.id&&w.id===s.id)return true;
        if(brand!==s.brand)return false;
        var sameAddress=addressKey(s.address)&&addressKey(s.address)===addressKey(w.address);
        return sameAddress?distance<0.1:distance<0.03;
      });
    });
    web.forEach(function(w,i){
      var aliases=candidates[i].length>1&&(w.wmStoreId&&candidates[i].every(function(s){return s.wmStoreId===w.wmStoreId||s.id==='wm-'+w.wmStoreId;})||w.murphyStore&&candidates[i].every(function(s){return s.murphyStore===w.murphyStore;}));
      if(candidates[i].length!==1&&!aliases)return;
      var prices={};Object.keys(P.GRADES).forEach(function(g){var gp=w.prices&&w.prices[g];if(!gp||!Number.isFinite(gp.price)||gp.price<0.5||gp.price>20)return;prices[g]={price:gp.price,updated:gp.updated||null,observedAt:observedAt==null?(gp.observedAt||w.observedAt||null):observedAt,source:gp.source||w.source||'Google Maps web'};});
      candidates[i].forEach(function(s){var key=knownKey(s);if(candidates.filter(function(c){return c.some(function(other){return knownKey(other)===key;});}).length===1&&Object.keys(prices).length)updates.set(key,prices);});
    });
    return {updated:Array.from(updates.values()).filter(function(p){return p[grade];}).length,stations:known.map(function(s){
      var copy=Object.assign({},s,{prices:Object.assign({},s.prices)}),price=updates.get(knownKey(s));
      if(price){Object.assign(copy.prices,price);if(Object.keys(price).some(function(g){return price[g].source==='Google Maps web';}))copy.google=true;}
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
  function discoveryAreas(models,T,P){
    var groups=[];
    models.forEach(function(m){T.samplePoints(m,6).forEach(function(p){if(!groups.some(function(g){return P.haversineMi(g.lat,g.lng,p.lat,p.lng)<2;}))groups.push(area(p.lat,p.lng,8));});});
    return groups;
  }
  function dedupeDiscovery(stations,P){
    var out=[],ids=new Map(),bins=new Map();
    stations.forEach(function(s){
      if(!s||!Number.isFinite(s.lat)||!Number.isFinite(s.lng)||Math.abs(s.lat)>85||Math.abs(s.lng)>180)return;
      s=Object.assign({},s,{brand:P.detectBrand(s.name,s.website)||s.brand||'other',prices:Object.assign({},s.prices)});
      var id=s.placeId||s.featureId||s.id,x=Math.floor(s.lat*100),y=Math.floor(s.lng*100),same=id&&ids.get(id);
      if(!same)for(var dx=-1;dx<=1;dx++)for(var dy=-1;dy<=1;dy++)(bins.get((x+dx)+'|'+(y+dy))||[]).forEach(function(t){
        if(t.brand!==s.brand||(s.brand==='other'&&String(t.name).toLowerCase()!==String(s.name).toLowerCase()))return;
        if(P.haversineMi(t.lat,t.lng,s.lat,s.lng)<0.025&&(addressKey(t.address)&&addressKey(t.address)===addressKey(s.address)||P.haversineMi(t.lat,t.lng,s.lat,s.lng)<0.006))same=t;
      });
      if(same){Object.keys(s.prices).forEach(function(g){var old=same.prices[g],fresh=s.prices[g];if(!old||(fresh.observedAt||0)>(old.observedAt||0))same.prices[g]=fresh;});if(id)ids.set(id,same);return;}
      out.push(s);if(id)ids.set(id,s);var key=x+'|'+y;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(s);
    });return out;
  }
  var math={area:area,osmUrl:osmUrl,webUrl:webUrl,normalizeOsm:normalizeOsm,merge:merge,updateKnown:updateKnown,knownAreas:knownAreas,knownKey:knownKey,discoveryAreas:discoveryAreas,dedupeDiscovery:dedupeDiscovery};
  if(typeof module!=='undefined'&&module.exports)module.exports=math;
  if(!root.document)return;
  var busy=null,lastOsm=0,lastWeb=0;
  var LANES=['gasweb','gasweb2','gasweb3','gasweb4'];
  function cancel(){
    if(!busy||typeof busy!=='object')return;
    busy.cancelled=true;busy.wake.forEach(function(f){f();});
    var N=root.__app.N;
    if(N&&N.cancelSiteRead)LANES.concat(['walmart','murphy']).forEach(function(k){N.cancelSiteRead(k);});
  }
  function call(name){return root.__trip.call.apply(null,[name].concat([].slice.call(arguments,1)));}
  async function discover(areas,onProgress,grade,force){
    if(busy)throw new Error('A keyless lookup is already running');
    grade=grade||'regular';var A=root.__app,P=A.P;if(!P.GRADES[grade])throw new Error('Unsupported fuel grade');
    var control={cancelled:false,wake:[]};busy=control;
    var next=0,done=0,rows=[],errors=[],details=[],loads=0,blocked=false,started=Date.now(),timer;
    function report(){var seconds=done?Math.ceil((Date.now()-started)/1000/done*(areas.length-done)):null;var text='Discovering stations · '+done+'/'+areas.length+' areas · '+(seconds==null?'Estimating time…':seconds>=60?'~'+Math.ceil(seconds/60)+' min remaining':'~'+seconds+' sec remaining');if(onProgress)onProgress(areas.length?done/areas.length:1,text);}
    try{
      timer=setInterval(report,1000);report();
      async function lane(key){while(next<areas.length&&!blocked&&!control.cancelled){
        var a=areas[next++],cacheKey='discover-v1|'+grade+'|'+a.lat.toFixed(5)+'|'+a.lng.toFixed(5)+'|'+a.radius,cache=!force&&A.KV.get('gasweb',cacheKey,15*60000),r,wake;
        if(cache)r=cache.v;
        else{
          loads++;var stopped=new Promise(function(resolve){wake=function(){resolve({cancelled:true});};control.wake.push(wake);});
          try{r=await Promise.race([call('siteRead',key,JSON.stringify({url:webUrl(a),mode:'discover',grade:grade})),stopped]);}catch(e){r={error:e.message};}finally{control.wake=control.wake.filter(function(f){return f!==wake;});}
          if(r.cancelled){if(r.code==='renderer'){errors.push(r.error||'Website renderer stopped');cancel();}break;}
          var at=Date.now();(r.stores||[]).forEach(function(s){Object.keys(s.prices||{}).forEach(function(g){s.prices[g].observedAt=at;});});
          if(!r.blocked&&!r.error&&r.detail&&r.detail.exhausted)A.KV.put('gasweb',cacheKey,r);
        }
        if(r.blocked){blocked=true;errors.push(r.error||'Website restricted discovery');}
        if(r.error&&!r.blocked)errors.push(r.error);
        var found=dedupeDiscovery((r.stores||[]).filter(function(s){return contains(s,a,P);}),P);
        if(root.PriceHistory)root.PriceHistory.observe(found);
        rows=dedupeDiscovery(rows.concat(found),P);details.push(r.detail||{});done++;report();
      }}
      await Promise.all(LANES.map(lane));
      return {stations:rows,errors:Array.from(new Set(errors)),details:details,blocked:blocked,cancelled:control.cancelled,areas:areas.length,completedAreas:done,websiteLoads:loads,apiCalls:0,partial:true,at:Date.now()};
    }finally{clearInterval(timer);busy=null;}
  }
  async function search(lat,lng,radius){
    if(busy)throw new Error('A keyless gas lookup is already running');
    var A=root.__app,P=A.P,a=area(lat,lng,radius),key=[a.lat.toFixed(3),a.lng.toFixed(3),a.radius].join('|');
    var cached=A.KV.get('gasweb',key,15*60000);
    if(cached)return cached.v;
    busy=true;
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
    }finally{busy=null;}
  }
  async function refreshKnown(known,onProgress,priority,grade){
    grade=grade||'regular';if(!root.__app.P.GRADES[grade])throw new Error('Unsupported fuel grade');
    if(busy)throw new Error('A keyless lookup is already running');
    var control={cancelled:false,wake:[]};busy=control;
    var A=root.__app,P=A.P,groups=knownAreas(known,P,priority),rows=new Map(),errors=[],reads=0,blocked=false,start=Date.now();
    var buckets=new Map();known.forEach(function(s){var key=Math.floor(s.lat*50)+'|'+Math.floor(s.lng*50);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(s);});
    function nearby(w){var x=Math.floor(w.lat*50),y=Math.floor(w.lng*50);for(var dx=-1;dx<=1;dx++)for(var dy=-1;dy<=1;dy++){var candidates=buckets.get((x+dx)+'|'+(y+dy))||[];if(candidates.some(function(s){return P.haversineMi(s.lat,s.lng,w.lat,w.lng)<=0.1;}))return true;}return false;}
    var cached=groups.map(function(g){var key='known-v2|'+grade+'|'+[g.lat.toFixed(4),g.lng.toFixed(4)].join('|')+'|'+JSON.stringify(g.stations.map(knownKey).sort());return {g:g,key:key,cache:A.KV.get('gasweb',key,15*60000)};});
    // Four dedicated readers; never overlap requests on the same WebView.
    var ordered=cached.filter(function(x){return x.cache;}).concat(cached.filter(function(x){return !x.cache;}));
    var next=0,done=0,samples=0,totalMs=0,active=new Map();
    function report(){
      var average=samples?totalMs/samples:null,remaining=ordered.slice(next).filter(function(x){return !x.cache;}).length;
      var work=average==null?null:remaining*average;
      if(work!=null)active.forEach(function(t){work+=Math.max(1000,average-(Date.now()-t));});
      var eta=work==null?null:Math.ceil(work/Math.min(LANES.length,remaining+active.size||1)/1000);
      var text=control.cancelled?'Cancelling; keeping completed prices':'Refreshing saved prices · '+done+'/'+ordered.length+' areas';
      text+=' · '+(eta==null?'Estimating time…':eta>=60?'~'+Math.ceil(eta/60)+' min remaining':'~'+eta+' sec remaining');
      if(onProgress)onProgress(ordered.length?done/ordered.length:1,text,{completed:done,total:ordered.length,remainingSeconds:eta});
    }
    var ticker=setInterval(report,1000);
    var sourceQueues={};
    function read(key,args){if(control.cancelled||blocked)return Promise.resolve({cancelled:true});reads++;return call('siteRead',key,JSON.stringify(args));}
    function officialRead(key,args){var promise=(sourceQueues[key]||Promise.resolve()).then(function(){return read(key,args);});sourceQueues[key]=promise.catch(function(){});return promise;}
    async function areaRead(x,key){
      var official=[];
      function takeOfficial(rows,normalize){var at=Date.now(),list=rows.map(normalize).filter(Boolean);list.forEach(function(s){Object.keys(s.prices).forEach(function(g){s.prices[g].observedAt=at;});});official=Array.from(new Map(official.concat(list).map(function(s){return [s.id,s];})).values());recordObserved(updateKnown(x.g.stations,official,P,null,grade).stations);}
      if(grade!=='regular'){
        var wm=x.g.stations.filter(function(s){return s.brand==='walmart'&&(s.wmStoreId||/^wm-\d+$/.test(s.id||''));});
        if(!A.siteOn||A.siteOn('walmart'))for(var wi=0;wi<wm.length;wi+=30){
          var wr=await officialRead('walmart',{url:'https://www.walmart.com/store-finder',mode:'prices',nodes:wm.slice(wi,wi+30).map(function(s){return {id:String(s.wmStoreId||s.id.slice(3)),displayName:s.name,geoPoint:{latitude:s.lat,longitude:s.lng},address:{addressLineOne:s.address||''}};})});
          takeOfficial(wr.stores||[],P.normalizeWalmart);
          if(wr.cancelled||wr.blocked)return Object.assign({},wr,{stores:official,blockedSite:'walmart'});if(wr.error)errors.push('Walmart: '+wr.error);
        }
        var mu=x.g.stations.filter(function(s){return s.brand==='murphy';});
        if(!A.siteOn||A.siteOn('murphy'))for(var mi=0;mi<mu.length;mi+=60){
          var mr=await officialRead('murphy',{url:'https://service.murphydriverewards.com/mapmodule/',points:mu.slice(mi,mi+60).map(function(s){return {lat:s.lat,lng:s.lng};}),radiusMi:5,max:25});
          takeOfficial(mr.stores||[],P.normalizeMurphy);
          if(mr.cancelled||mr.blocked)return Object.assign({},mr,{stores:official,blockedSite:'murphy'});if(mr.error)errors.push('Murphy USA: '+mr.error);
        }
        official=Array.from(new Map(official.map(function(s){return [s.id,s];})).values());
      }
      if(control.cancelled||blocked)return {cancelled:true};
      var suppliedAt=Date.now(),complete=updateKnown(x.g.stations,official,P,suppliedAt,grade);
      if(official.length&&complete.updated===x.g.stations.length)return {stores:official};
      var gr=await read(key,{url:webUrl(area(x.g.lat,x.g.lng,8)),grade:grade,targets:x.g.stations.map(function(s){return {id:s.id,featureId:s.featureId,brand:s.brand,lat:s.lat,lng:s.lng,address:s.address};})});
      // Keep trusted official records separate; do not transfer a regular label to another grade.
      var supplied=new Set(complete.stations.filter(function(s){return s.prices&&s.prices[grade]&&s.prices[grade].observedAt===suppliedAt;}).map(knownKey));
      var google=(gr.stores||[]).filter(function(w){return !x.g.stations.some(function(s){return supplied.has(knownKey(s))&&P.haversineMi(s.lat,s.lng,w.lat,w.lng)<0.1;});});
      return Object.assign({},gr,{stores:official.concat(google),error:gr.code==='no_prices'&&official.some(function(s){return s.prices[grade];})?null:gr.error});
    }
    try{
      async function lane(key){while(next<ordered.length&&!blocked&&!control.cancelled){
        var x=ordered[next++],r,at;
        if(x.cache){r=x.cache.v;at=x.cache.t;}
        else{
          var began=Date.now(),wake;
          active.set(key,began);
          var stopped=new Promise(function(resolve){wake=function(){resolve({cancelled:true});};control.wake.push(wake);});
          try{r=await Promise.race([areaRead(x,key),stopped]);}
          catch(e){r={error:e.message};}
          finally{active.delete(key);control.wake=control.wake.filter(function(f){return f!==wake;});}
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
          var localKnown=known.filter(function(s){return added.some(function(w){return P.haversineMi(s.lat,s.lng,w.lat,w.lng)<=0.1;});});
          var localWeb=Array.from(rows.values()).filter(function(w){return localKnown.some(function(s){return P.haversineMi(s.lat,s.lng,w.lat,w.lng)<=0.1;});});
          var checkpoint=updateKnown(localKnown,localWeb,P,null,grade);
          recordObserved(checkpoint.stations);
        }
        done++;
        report();
      }}
      report();
      await Promise.all(LANES.map(lane));
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
      if(root.FLog)FLog.info('keyless','Saved trip price refresh',{updated:result.updated,total:result.total,retained:result.retained,websiteLoads:reads,areas:groups.length,readerConcurrency:LANES.length,averageAreaMs:samples?Math.round(totalMs/samples):null,blocked:blocked,errors:errors,elapsedMs:Date.now()-start});
      return result;
    }finally{clearInterval(ticker);busy=null;}
  }
  function recordObserved(stations){if(!root.PriceHistory)return;root.PriceHistory.observe(stations.map(function(s){var prices={};Object.keys(s.prices||{}).forEach(function(g){if(s.prices[g].observedAt)prices[g]=s.prices[g];});return Object.assign({},s,{prices:prices});}));}
  function estimate(known,grade){
    var A=root.__app,groups=knownAreas(known,A.P),o=A.KV.get('gasmeta','timing|'+(grade||'regular')),ms=o&&o.v.averageAreaMs||10000;
    return {areas:groups.length,seconds:Math.ceil(groups.length*ms/LANES.length/1000),measured:!!o,readers:LANES.length};
  }
  root.KeylessGas=Object.assign(math,{search:search,discover:discover,refreshKnown:refreshKnown,cancel:cancel,estimate:estimate});
})(typeof window!=='undefined'?window:globalThis);
