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
  function updateKnown(known,web,P,observedAt){
    var unique=Array.from(new Map(known.map(function(s){return [knownKey(s),s];})).values()),updates=new Map();
    var candidates=web.map(function(w){
      var brand=P.detectBrand(w.name,w.website);
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
      var gp=w.prices&&w.prices.regular;
      if(!gp||!Number.isFinite(gp.price)||gp.price<0.5||gp.price>20||candidates[i].length!==1)return;
      var key=knownKey(candidates[i][0]);
      if(candidates.filter(function(c){return c.some(function(s){return knownKey(s)===key;});}).length!==1)return;
      updates.set(key,{price:gp.price,updated:null,observedAt:observedAt==null?(w.observedAt||null):observedAt,source:'Google Maps web'});
    });
    return {updated:updates.size,stations:known.map(function(s){
      var copy=Object.assign({},s,{prices:Object.assign({},s.prices)}),price=updates.get(knownKey(s));
      if(price){copy.prices.regular=price;copy.google=true;}
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
  var math={area:area,osmUrl:osmUrl,webUrl:webUrl,normalizeOsm:normalizeOsm,merge:merge,updateKnown:updateKnown,knownAreas:knownAreas,knownKey:knownKey};
  if(typeof module!=='undefined'&&module.exports)module.exports=math;
  if(!root.document)return;
  var busy=null,lastOsm=0,lastWeb=0;
  function call(name){return root.__trip.call.apply(null,[name].concat([].slice.call(arguments,1)));}
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
        try{var g=await call('siteRead','gasweb',JSON.stringify({url:webUrl(a)}));web=g.stores||[];details.google=g.detail||{};if(g.error)errors.push(g.error);if(g.blocked)details.blocked=true;}
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
  async function refreshKnown(known,onProgress,priority){
    if(busy)throw new Error('A keyless lookup is already running');
    busy=true;
    var A=root.__app,P=A.P,groups=knownAreas(known,P,priority),rows=[],errors=[],reads=0,blocked=false,start=Date.now();
    var cached=groups.map(function(g){var key='known|'+[g.lat.toFixed(4),g.lng.toFixed(4)].join('|');return {g:g,key:key,cache:A.KV.get('gasweb',key,15*60000)};});
    // Cached areas cost no website load. New loads are serialized and bounded per batch.
    var ordered=cached.filter(function(x){return x.cache;}).concat(cached.filter(function(x){return !x.cache;}));
    try{
      for(var i=0;i<ordered.length;i++){
        var x=ordered[i],r,at;
        if(onProgress)onProgress(i/ordered.length,'Refreshing saved prices · '+(i+1)+'/'+ordered.length+' areas');
        if(x.cache){r=x.cache.v;at=x.cache.t;}
        else{
          if(reads>=12||Date.now()-start>=180000){errors.push('Batch limit reached; some saved areas were not checked. Run another refresh to continue.');break;}
          if(reads)await new Promise(function(resolve){setTimeout(resolve,1200);});
          reads++;r=await call('siteRead','gasweb',JSON.stringify({url:webUrl(area(x.g.lat,x.g.lng,8))}));at=Date.now();
          if(r.blocked){blocked=true;errors.push(r.error||'Google restricted the refresh');break;}
          if(r.error)errors.push(r.error);
          if(!r.error)A.KV.put('gasweb',x.key,r);
        }
        (r.stores||[]).forEach(function(w){rows.push(Object.assign({},w,{observedAt:at}));});
      }
      // Overlapping areas can return the same Google station. Keep one row before matching.
      var web=Array.from(new Map(rows.map(function(w){return [w.placeId||w.featureId||w.id,w];})).values());
      var result=updateKnown(known,web,P,null);
      result.total=new Set(known.map(knownKey)).size;result.retained=result.total-result.updated;result.errors=errors;result.blocked=blocked;result.websiteLoads=reads;result.areas=groups.length;result.apiCalls=0;result.at=Date.now();
      if(root.FLog)FLog.info('keyless','Saved trip price refresh',{updated:result.updated,total:result.total,retained:result.retained,websiteLoads:reads,areas:groups.length,blocked:blocked,errors:errors,elapsedMs:Date.now()-start});
      return result;
    }finally{busy=null;}
  }
  root.KeylessGas=Object.assign(math,{search:search,refreshKnown:refreshKnown});
})(typeof window!=='undefined'?window:globalThis);
