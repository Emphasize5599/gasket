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
  var math={area:area,osmUrl:osmUrl,webUrl:webUrl,normalizeOsm:normalizeOsm,merge:merge};
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
  root.KeylessGas=Object.assign(math,{search:search});
})(typeof window!=='undefined'?window:globalThis);
