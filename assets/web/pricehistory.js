/* Persistent versioned station/observation database: paged append storage, never cache. */
(function(root){
  'use strict';
  var NS='pricehistory',PAGE=128;
  function stamp(s,at){Object.keys(s.prices||{}).forEach(function(g){s.prices[g]=Object.assign({},s.prices[g],{observedAt:at});});return s;}
  function create(KV){
    function get(k,fallback){var o=KV.get(NS,k);return o&&o.v!=null?o.v:fallback;}
    function put(k,v){if(KV.put(NS,k,v)===false)throw new Error('Price history could not be saved; check available app storage.');}
    function key(s){return (s.brand||'')+'|'+String(s.id||[s.lat,s.lng,s.address].join('|'));}
    function observe(stations,observedAt){
      var index=get('index',[]),indexed=new Set(index),added=false;
      stations.forEach(function(s){
        if(!s||!s.id&&!Number.isFinite(s.lat))return;
        var id=key(s),meta=get('station|'+id,null),now=Date.now();
        if(!meta)meta={schema:1,key:id,id:s.id||null,brand:s.brand||null,firstSeenAt:now,count:0,last:{}};
        if(!indexed.has(id)){index.push(id);indexed.add(id);added=true;}
        var before=JSON.stringify(meta),pendingSeen=[];
        ['name','address','lat','lng','featureId','mapsUri'].forEach(function(k){if(s[k]!=null)meta[k]=s[k];});
        var changed=false;
        Object.keys(s.prices||{}).forEach(function(grade){
          var p=s.prices[grade];if(!p||p.est||!Number.isFinite(p.price)||p.price<0.5||p.price>20)return;
          var source=p.source||s.source||(s.google?'Google Maps':'Official station site');
          var at=p.observedAt||observedAt||null,updated=p.updated||null;
          var signature=JSON.stringify([p.price,source,updated,at]);
          if(meta.last[grade]===signature)return;
          var token=grade+'|'+signature,hash=0;
          for(var h=0;h<token.length;h++)hash=(Math.imul(hash,31)+token.charCodeAt(h))|0;
          var event='seen|'+id+'|'+(hash&63),seen=get(event,[]);
          if((at||updated)&&seen.includes(token))return;
          var page=Math.floor(meta.count/PAGE),rows=get('rows|'+id+'|'+page,[]).slice(0,meta.count%PAGE);
          rows.push({schema:1,stationKey:id,grade:grade,price:p.price,currency:'USD',unit:'US gallon',source:source,sourceUpdatedAt:updated,observedAt:at,recordedAt:now});
          put('rows|'+id+'|'+page,rows);meta.count++;meta.last[grade]=signature;changed=true;
          if(at||updated){seen.push(token);pendingSeen.push({key:event,value:seen});}
        });
        if(changed||!meta.lastSeenAt||before!==JSON.stringify(meta)){meta.lastSeenAt=observedAt||now;put('station|'+id,meta);}
        pendingSeen.forEach(function(x){put(x.key,x.value);});
      });
      if(added)put('index',index);
    }
    function stations(){return get('index',[]).map(function(id){return get('station|'+id,null);}).filter(Boolean);}
    function history(id,options){
      options=options||{};if(typeof id==='object')id=key(id);
      var meta=get('station|'+id,null),rows=[];if(!meta)return rows;
      for(var i=0;i<Math.ceil(meta.count/PAGE);i++)rows=rows.concat(get('rows|'+id+'|'+i,[]));
      rows=rows.filter(function(r){var t=r.observedAt||r.recordedAt;return (!options.grade||r.grade===options.grade)&&(!options.from||t>=options.from)&&(!options.to||t<=options.to);});
      rows.sort(function(a,b){return (b.observedAt||b.recordedAt)-(a.observedAt||a.recordedAt);});
      return options.limit?rows.slice(0,options.limit):rows;
    }
    return {schema:1,key:key,observe:observe,stations:stations,history:history,stamp:stamp};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={create:create};
  if(!root.document)return;
  var db=null;
  function current(){return db||(db=create(root.__app.KV));}
  root.PriceHistory={stamp:stamp,observe:function(s,t){if(root.__app)try{current().observe(s,t);}catch(e){if(root.FLog)root.FLog.error('history',e.message);root.__app.status(e.message,true);}},stations:function(){return current().stations();},history:function(s,o){return current().history(s,o);},reset:function(){db=null;},seed:async function(){
    var A=root.__app;if(!A)return;current().observe(A.stations(),null);
    var idx=(A.KV.get('trips','index')||{}).v||[];
    for(var i=0;i<idx.length;i++){
      var o=A.KV.get('trips','trip|'+idx[i].id),v=o&&o.v;if(!v||!v.stations)continue;
      var marker='seed|'+idx[i].id+'|'+(v.savedT||idx[i].t||0);if(A.KV.get(NS,marker))continue;
      var rows=(v.stations.official||[]).slice();(v.stations.google||[]).forEach(function(g){rows=rows.concat(g.list||[]);});
      // A saved trip's date is not necessarily the date its cached price was fetched.
      current().observe(rows);A.KV.put(NS,marker,true);
      await new Promise(function(r){setTimeout(r,0);});
    }
  }};
})(typeof window!=='undefined'?window:globalThis);
