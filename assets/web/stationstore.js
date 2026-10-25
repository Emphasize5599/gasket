/* Durable, sparse world grid. Locations, search coverage and price observations
 * are separate facts; a known station is never proof an area was fully read. */
(function(root){'use strict';
 var NS='stationstore',STEP=10/69,VERSION=1;
 function band(y){var s=-90+y*STEP,n=Math.min(90,s+STEP),near=s<=0&&n>=0?0:Math.min(Math.abs(s),Math.abs(n));return {south:s,north:n,cols:Math.max(1,Math.ceil(360*69.17*Math.cos(near*Math.PI/180)/10))};}
 function cell(y,x){var b=band(y),west=-180+x*360/b.cols,east=-180+(x+1)*360/b.cols;return {id:'g1|'+y+'|'+x,cellId:'g1|'+y+'|'+x,lat:(b.south+b.north)/2,lng:(west+east)/2,radius:8,bounds:[b.south,west,b.north,east]};}
 function valid(p){return p&&Number.isFinite(+p.lat)&&Number.isFinite(+p.lng)&&Math.abs(+p.lat)<=85&&Math.abs(+p.lng)<=180;}
 function at(p){if(!valid(p))return null;var y=Math.floor((+p.lat+90)/STEP),b=band(y),x=Math.max(0,Math.min(b.cols-1,Math.floor((+p.lng+180)/360*b.cols)));return cell(y,x);}
 function cells(b){if(!b||b.length!==4||!b.every(Number.isFinite)||b[0]>b[2]||b[1]>b[3]||b[0]<-85||b[2]>85||b[1]<-180||b[3]>180)throw Error('Zoom in to a supported map area (no date-line crossing).');
  var out=[],y0=Math.floor((b[0]+90)/STEP),y1=Math.floor((b[2]+90)/STEP);if(y1-y0>10000)throw Error('Zoom in: more than 10,000 search cells.');
  for(var y=y0;y<=y1;y++){var row=band(y),x0=Math.max(0,Math.floor((b[1]+180)/360*row.cols)),x1=Math.min(row.cols-1,Math.floor((b[3]+180)/360*row.cols));if(out.length+x1-x0+1>10000)throw Error('Zoom in: more than 10,000 search cells.');for(var x=x0;x<=x1;x++)out.push(cell(y,x));}return out;
 }
 function routeCells(models,T,P,pad){var found=new Map(),spacing=4;pad=pad==null?8:pad;
  models.forEach(function(m){T.samplePoints(m,spacing).forEach(function(p){var r=pad+spacing/2,dy=r/69,dx=r/(69.17*Math.max(.08,Math.cos(p.lat*Math.PI/180)));
   cells([Math.max(-85,p.lat-dy),Math.max(-180,p.lng-dx),Math.min(85,p.lat+dy),Math.min(180,p.lng+dx)]).forEach(function(c){if(P.haversineMi(c.lat,c.lng,p.lat,p.lng)<=r+7.2)found.set(c.id,c);});
   if(found.size>10000)throw Error('This route needs more than 10,000 search cells. Split the trip.');
  });});return Array.from(found.values());
 }
 function create(KV,P){var memo=new Map(),index=null,rowIndex=new Map();
  function indexRows(){if(!index){var v=KV.get(NS,'index-v1');index=new Set(v&&Array.isArray(v.v)?v.v:[]);}return index;}
  function columns(y){if(!rowIndex.has(y)){var v=KV.get(NS,'row|'+y);rowIndex.set(y,new Set(v&&Array.isArray(v.v)?v.v:[]));}return rowIndex.get(y);}
  function indexCell(id){var p=id.split('|'),y=+p[1],x=+p[2],ys=indexRows(),xs=columns(y);if(!ys.has(y)){var updated=Array.from(ys).concat(y);if(KV.put(NS,'index-v1',updated)===false)return false;ys.add(y);}if(!xs.has(x)){if(KV.put(NS,'row|'+y,Array.from(xs).concat(x))===false)return false;xs.add(x);}return true;}
  function load(id){if(memo.has(id)){var r=memo.get(id);memo.delete(id);memo.set(id,r);return r;}var p=id.split('|'),o=indexRows().has(+p[1])&&columns(+p[1]).has(+p[2])?KV.get(NS,id):null,r=o&&o.v;if(r&&r.schema===VERSION&&Array.isArray(r.stations)&&r.coverage&&typeof r.coverage==='object')r.stations=r.stations.filter(valid);else r={schema:VERSION,stations:[],coverage:{}};return remember(id,r);}
  function remember(id,r){memo.set(id,r);while(memo.size>64)memo.delete(memo.keys().next().value);return r;}
  function write(id,r){if(!indexCell(id)||KV.put(NS,id,r)===false){memo.delete(id);return false;}remember(id,r);return true;}
  function clean(s){var c=JSON.parse(JSON.stringify(s));['detourExact','detourMi','detourMin','detourRange','calc','leg','_priceVariants','_kind'].forEach(function(k){delete c[k];});return c;}
  function stamp(p){return p&&(Number(p.observedAt)||Number(p.t)||Number(p.updated)||Date.parse(p.updated)||0)||0;}
  function observe(rows,kind,scope){kind=kind||'gas';var grouped=new Map();(rows||[]).filter(valid).forEach(function(s){var c=at(s);if(!grouped.has(c.id))grouped.set(c.id,[]);grouped.get(c.id).push(s);});var ok=true;
   grouped.forEach(function(list,id){var old=load(id),r={schema:VERSION,coverage:Object.assign({},old.coverage),stations:old.stations.slice()},by=new Map(r.stations.map(function(s,i){return [s._kind+'|'+String(s.id||P.stationKey(s)),i];}));
    list.forEach(function(s){var key=kind+'|'+String(s.id||P.stationKey(s)),i=by.get(key),prior=i==null?null:r.stations[i],copy=Object.assign({},prior||{},clean(s),{_kind:kind});
     if(kind==='gas'){var prices=copy.prices||{};copy.prices=Object.assign({},prior&&prior.prices);Object.keys(prices).forEach(function(g){var p=prices[g];if(!copy.prices[g]||stamp(p)>=stamp(copy.prices[g]))copy.prices[g]=p;});}
     if(kind==='ev'){
      copy._priceVariants=Object.assign({},prior&&prior._priceVariants);if(scope&&(s.netPrice||s.tariffV2)){var before=copy._priceVariants[scope],v=JSON.parse(JSON.stringify({netPrice:s.netPrice,tariffV2:s.tariffV2,units:s.units}));if(!before||Math.max(stamp(v.netPrice),stamp(v.tariffV2))>=Math.max(stamp(before.netPrice),stamp(before.tariffV2)))copy._priceVariants[scope]=v;if(prior&&prior.units)copy.units=prior.units;}
      delete copy.netPrice;delete copy.tariffV2;
     }
     if(i==null){by.set(key,r.stations.length);r.stations.push(copy);}else r.stations[i]=copy;
    });if(!write(id,r))ok=false;
   });return ok;
  }
  function rows(c,kind,scope){return load(c.cellId||c.id).stations.filter(function(s){return s._kind===(kind||'gas');}).map(function(s){var v=kind==='ev'&&s._priceVariants&&s._priceVariants[scope],copy=JSON.parse(JSON.stringify(Object.assign({},s,v||{})));delete copy._kind;delete copy._priceVariants;return copy;});}
  // A list read to its end is complete for good. A list that sat quiet at its bottom (Google Maps' usual finish on a phone:
  // no end marker, nothing new after scrolling) is a finished search but not proof of exhaustion: reused for QUIET_MS,
  // then searched again. Without it no cell was ever recorded (0.0.264 log: 329 of 329 areas quiet, every car rescanned).
  var QUIET_MS=7*24*3600e3;
  function covered(c,source,profile){var r=load(c.cellId||c.id),v=r.coverage[source+'|'+(profile||'all')];return !!(v&&v.complete&&v.version===VERSION&&(!v.quiet||Date.now()-(+v.at||0)<=QUIET_MS));}
  function complete(c,source,profile,list,time,quiet){if(!c.cellId)return false;if(!observe(list,'gas'))return false;var old=load(c.cellId),r={schema:VERSION,stations:old.stations.slice(),coverage:Object.assign({},old.coverage)},k=source+'|'+(profile||'all'),prev=r.coverage[k];
   if(quiet&&prev&&prev.complete&&!prev.quiet&&prev.version===VERSION)return true;   // an end-of-list record outranks a quiet one
   r.coverage[k]=Object.assign({complete:true,version:VERSION,at:time||Date.now()},quiet?{quiet:true}:{});return write(c.cellId,r);}
  function query(b,kind,scope){var out=[];indexRows().forEach(function(y){var row=band(y);if(row.north<b[0]||row.south>b[2])return;columns(y).forEach(function(x){var c=cell(y,x);if(c.bounds[3]<b[1]||c.bounds[1]>b[3])return;rows(c,kind,scope).forEach(function(s){if(s.lat>=b[0]&&s.lat<=b[2]&&s.lng>=b[1]&&s.lng<=b[3])out.push(s);});});});return kind&&kind!=='gas'?out:P.mergeSites(P.reconcileStations(out));}
  function routeRows(models,T,pad,kind,scope){var out=[];routeCells(models,T,P,pad).forEach(function(c){out=out.concat(rows(c,kind,scope));});return kind&&kind!=='gas'?out:P.mergeSites(P.reconcileStations(out));}
  function routeCoverage(scope){var o=KV.get(NS,'routes|'+scope);return o&&Array.isArray(o.v)?o.v:[];}
  function rememberRoute(scope,points,pad,ids){var all=routeCoverage(scope),key=JSON.stringify(points),same=all.findIndex(function(r){return r.key===key&&r.pad<=pad;});var record={key:key,points:points,pad:pad,at:Date.now()};if(ids)record.ids=ids.map(String);if(same>=0)all.splice(same,1);all.push(record);return KV.put(NS,'routes|'+scope,all)!==false;}
  function distance(p,a,b){var co=Math.cos(p.lat*Math.PI/180),dx=(b.lng-a.lng)*co,dy=b.lat-a.lat,x=(p.lng-a.lng)*co,y=p.lat-a.lat,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,(x*dx+y*dy)/d)):0;return Math.hypot(x-t*dx,y-t*dy)*69;}
  function segmentCovered(a,b,records,pad,depth){
   for(var n=0;n<records.length;n++){var r=records[n],limit=r.pad-pad+.001;if(limit<0)continue;for(var i=1;i<r.points.length;i++)if(distance(a,r.points[i-1],r.points[i])<=limit&&distance(b,r.points[i-1],r.points[i])<=limit)return true;}
   // A segment with both endpoints inside one reduced capsule is wholly inside
   // it. Subdivide across old vertices; never infer coverage from station count.
   if(depth>=10)return false;var mid={lat:(a.lat+b.lat)/2,lng:(a.lng+b.lng)/2};return segmentCovered(a,mid,records,pad,depth+1)&&segmentCovered(mid,b,records,pad,depth+1);
  }
  function routeCovered(points,records,pad){if(!records.length||points.length<2)return false;for(var i=1;i<points.length;i++)if(!segmentCovered(points[i-1],points[i],records,pad,0))return false;return true;}
  function activeRows(rows,scope){var prefix=scope==='ocm-all'?'ocm':scope.indexOf('["doe",')===0?'afdc':'',records=routeCoverage(scope).filter(function(r){return Array.isArray(r.ids);}).reverse().map(function(r){return {r:r,ids:new Set(r.ids)};});return rows.filter(function(s){if(prefix&&String(s.id).indexOf(prefix)!==0)return true;for(var n=0;n<records.length;n++){var item=records[n];if(item.ids.has(String(s.id)))return true;for(var i=1;i<item.r.points.length;i++)if(distance(s,item.r.points[i-1],item.r.points[i])<=item.r.pad)return false;}return true;});}
  function uncoveredRuns(model,T,scope,pad,force){var records=force?[]:routeCoverage(scope),runs=[];if(!records.length)return [{pts:model.pts}];
   function points(a,b){return [model.pointAt(a)].concat(model.pts.filter(function(_,i){return model.cum[i]>a&&model.cum[i]<b;}),[model.pointAt(b)]);}
   T.chunks(model,25).forEach(function(ch){if(routeCovered(points(ch.fromMi,ch.toMi),records,pad))return;var last=runs[runs.length-1];if(last&&ch.fromMi<=last.end+.01)last.end=ch.toMi;else runs.push({from:ch.fromMi,end:ch.toMi});});
   return runs.map(function(r){return {pts:points(r.from,r.end)};});
  }
  return {observe:observe,rows:rows,covered:covered,complete:complete,query:query,routeRows:routeRows,routeCoverage:routeCoverage,rememberRoute:rememberRoute,activeRows:activeRows,routeCovered:routeCovered,uncoveredRuns:uncoveredRuns,reset:function(){memo.clear();index=null;rowIndex.clear();}};
 }
 var store=null;function current(){return store||(store=create(root.__app.KV,root.__app.P));}
 var seeding=null;
 async function seedHistory(valid){if(seeding)return seeding;var A=root.__app;if(!root.PriceHistory||A.KV.get(NS,'history-import-v1'))return;
  seeding=(async function(){var old=root.PriceHistory.near([-85,-180,85,180]).filter(function(s){return s.brand!=='ev'&&s.brand!=='h2';});for(var i=0;i<old.length;i+=100){if(valid&&!valid())return;if(!current().observe(old.slice(i,i+100),'gas'))return;await new Promise(function(resolve){setTimeout(resolve,0);});}A.KV.put(NS,'history-import-v1',{stations:old.length});})();try{return await seeding;}finally{seeding=null;}
 }
 var api={cell:at,cells:cells,routeCells:routeCells,create:create,seedHistory:seedHistory,observe:function(){return current().observe.apply(null,arguments);},rows:function(){return current().rows.apply(null,arguments);},covered:function(){return current().covered.apply(null,arguments);},complete:function(){return current().complete.apply(null,arguments);},query:function(){return current().query.apply(null,arguments);},routeRows:function(){return current().routeRows.apply(null,arguments);},routeCoverage:function(){return current().routeCoverage.apply(null,arguments);},rememberRoute:function(){return current().rememberRoute.apply(null,arguments);},routeCovered:function(){return current().routeCovered.apply(null,arguments);},uncoveredRuns:function(){return current().uncoveredRuns.apply(null,arguments);},priceScope:function(c){return /tesla/i.test(c&&c.make||'')?'tesla-owner':'guest';},reset:function(){if(store)store.reset();}};
 api.activeRows=function(){return current().activeRows.apply(null,arguments);};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StationStore=api;
 if(root.addEventListener){root.addEventListener('cacheclear',api.reset);root.addEventListener('stationsreset',api.reset);}
})(typeof window!=='undefined'?window:globalThis);
