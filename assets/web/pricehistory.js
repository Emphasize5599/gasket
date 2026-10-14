/* Persistent versioned station/observation database: paged append storage, never cache. */
(function(root){
  'use strict';
  var NS='pricehistory',PAGE=128;
  var P=root.Pricing||(typeof require==='function'?require('./pricing.js'):null);
  function stamp(s,at){Object.keys(s.prices||{}).forEach(function(g){s.prices[g]=Object.assign({},s.prices[g],{observedAt:at});});return s;}
  function create(KV){
    var stationCache=null,groupCache=null;
    function get(k,fallback){var o=KV.get(NS,k);return o&&o.v!=null?o.v:fallback;}
    function put(k,v){if(KV.put(NS,k,v)===false)throw new Error('Price history could not be saved; check available app storage.');}
    function key(s){return (s.brand||'')+'|'+String(s.id||[s.lat,s.lng,s.address].join('|'));}
    function observe(stations,observedAt){
      groupCache=null;
      var index=get('index',[]),indexed=new Set(index),added=false;
      stations.forEach(function(s){
        if(!s||!s.id&&!Number.isFinite(s.lat))return;
        var id=key(s),meta=get('station|'+id,null),now=Date.now();
        if(!meta)meta={schema:1,key:id,id:s.id||null,brand:s.brand||null,firstSeenAt:now,count:0,last:{}};
        if(!indexed.has(id)){index.push(id);indexed.add(id);added=true;}
        var before=JSON.stringify(meta),pendingSeen=[];
        ['name','address','lat','lng','featureId','mapsUri'].forEach(function(k){if(s[k]!=null)meta[k]=s[k];});
        // Keep enough of each discovered station to put it back on the map after the map's last-area cache changes.
        // The observation log remains the authority for the newest price of every grade.
        if(Number.isFinite(s.lat)&&Number.isFinite(s.lng)){
          var snapshot=Object.assign({},meta.snapshot,s);delete snapshot.prices;
          ['wmStoreId','murphyStore','featureId','placeId','mapsUri'].forEach(function(k){if(snapshot[k]==null&&meta.snapshot&&meta.snapshot[k]!=null)snapshot[k]=meta.snapshot[k];});
          snapshot.stationAliases=Array.from(new Set((meta.snapshot&&meta.snapshot.stationAliases||[]).concat(s.stationAliases||[])));
          meta.snapshot=snapshot;
        }
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
          var observation={schema:1,stationKey:id,grade:grade,price:p.price,currency:'USD',unit:'US gallon',source:source,sourceUpdatedAt:updated,observedAt:at,recordedAt:now};
          rows.push(observation);
          meta.latest=meta.latest||{};
          if(!meta.latest[grade]||(at||0)>=(meta.latest[grade].observedAt||0))meta.latest[grade]=observation;
          put('rows|'+id+'|'+page,rows);meta.count++;meta.last[grade]=signature;changed=true;
          if(at||updated){seen.push(token);pendingSeen.push({key:event,value:seen});}
        });
        if(changed||!meta.lastSeenAt||before!==JSON.stringify(meta)){meta.lastSeenAt=observedAt||now;put('station|'+id,meta);}
        if(stationCache)stationCache.set(id,meta);
        pendingSeen.forEach(function(x){put(x.key,x.value);});
      });
      if(added)put('index',index);
    }
    function stations(){if(!stationCache){stationCache=new Map();get('index',[]).forEach(function(id){var m=get('station|'+id,null);if(m)stationCache.set(id,m);});}return Array.from(stationCache.values());}
    function groups(){if(groupCache)return groupCache;groupCache=P.reconcileStations(stations().map(function(m){
      var s=Object.assign({},m.snapshot||{id:m.id,brand:m.brand,name:m.name,address:m.address,lat:m.lat,lng:m.lng,featureId:m.featureId,mapsUri:m.mapsUri});
      s.prices=Object.assign({},s.prices);
      Object.keys(m.latest||{}).forEach(function(g){var r=m.latest[g],old=s.prices[g],oldAt=old&&(old.observedAt||Date.parse(old.updated)||0)||0;if(!old||!r.observedAt||r.observedAt>=oldAt)s.prices[g]={price:r.price,source:r.source,updated:r.sourceUpdatedAt,observedAt:r.observedAt};});
      return s;
    }));return groupCache;}
    function near(bounds){return groups().filter(function(s){return Number.isFinite(s.lat)&&Number.isFinite(s.lng)&&s.lat>=bounds[0]&&s.lng>=bounds[1]&&s.lat<=bounds[2]&&s.lng<=bounds[3];}).map(function(s){return Object.assign({},s,{prices:Object.assign({},s.prices)});});}
    function history(id,options){
      options=options||{};if(typeof id==='object')id=key(id);
      var group=groups().find(function(s){return key(s)===id||(s.stationAliases||[]).includes(id);}),ids=group?group.stationAliases||[id]:[id],rows=[];
      ids.forEach(function(alias){var meta=get('station|'+alias,null);if(!meta)return;for(var i=0;i<Math.ceil(meta.count/PAGE);i++)rows=rows.concat(get('rows|'+alias+'|'+i,[]));});
      // Original pages remain intact for backup; collapse repeated observations
      // only in the unified read view, not by deleting records during migration.
      var seen=new Set();rows=rows.filter(function(r){var sig=JSON.stringify([r.grade,r.price,r.source,r.sourceUpdatedAt,r.observedAt,r.observedAt?null:r.recordedAt]);if(seen.has(sig))return false;seen.add(sig);return true;});
      rows=rows.filter(function(r){var t=r.observedAt||r.recordedAt;return (!options.grade||r.grade===options.grade)&&(!options.from||t>=options.from)&&(!options.to||t<=options.to);});
      rows.sort(function(a,b){return (b.observedAt||b.recordedAt)-(a.observedAt||a.recordedAt);});
      return options.limit?rows.slice(0,options.limit):rows;
    }
    function latest(s,grade){
      var id=key(s),group=groups().find(function(t){return key(t)===id||(t.stationAliases||[]).includes(id);}),best=null;
      (group?group.stationAliases:[id]).forEach(function(alias){var m=get('station|'+alias,null),r=m&&m.latest&&m.latest[grade],at=function(t){return t&&(t.observedAt||Date.parse(t.sourceUpdatedAt)||0)||0;};if(r&&(!best||at(r)>at(best)))best=r;});
      return best||history(s,{grade:grade,limit:1})[0]||null;
    }
    function recover(stations){return stations.map(function(s){
      var prices=Object.assign({},s.prices),changed=false,group=groups().find(function(t){return key(t)===key(s)||(t.stationAliases||[]).includes(key(s));});
      ['regular','midgrade','premium','diesel'].forEach(function(g){var gp=group&&group.prices[g],r=gp&&{price:gp.price,source:gp.source,sourceUpdatedAt:gp.updated,observedAt:gp.observedAt},old=prices[g],existing=old&&(old.observedAt||Date.parse(old.updated)||0)||0;
        if(!r||!['Google Maps web','walmart.com','murphyusa.com'].includes(r.source)||!r.observedAt||r.observedAt<=existing)return;
        prices[g]={price:r.price,source:r.source,updated:r.sourceUpdatedAt,observedAt:r.observedAt};changed=true;
      });
      return changed?Object.assign({},s,{prices:prices}):s;
    });}
    return {schema:1,key:key,observe:observe,stations:stations,near:near,history:history,stamp:stamp,latest:latest,recover:recover};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={create:create};
  if(!root.document)return;
  var db=null;
  function current(){return db||(db=create(root.__app.KV));}
  root.PriceHistoryRecovery=function(stations){return current().recover(stations);};
  root.PriceHistory={stamp:stamp,observe:function(s,t){if(root.__app)try{current().observe(s,t);}catch(e){if(root.FLog)root.FLog.error('history',e.message);root.__app.status(e.message,true);}},stations:function(){return current().stations();},near:function(b){return current().near(b);},history:function(s,o){return current().history(s,o);},reset:function(){db=null;},seed:async function(){
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
