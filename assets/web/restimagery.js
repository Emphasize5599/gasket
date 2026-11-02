/* Availability only: no imagery, page credentials or full provider metadata retained. */
(function(root){'use strict';
 var DAY=86400000;
 function tile(p){var n=131072,tx=(p.lng+180)/360*n,rad=p.lat*Math.PI/180,ty=(1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*n,x=Math.min(n-1,Math.floor(tx)),y=Math.max(0,Math.min(n-1,Math.floor(ty)));return {x:x,y:y,left:(tx-x)*100,top:(ty-y)*100};}
 function point(p){return p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=85.05112878&&Math.abs(p.lng)<=180;}
 function street(body,p){
  var r=typeof body==='string'?JSON.parse(body):body;
  if(r&&r[0]&&r[0][0]===5&&r[0][2]==='Search returned no images.')return {available:false};
  var data=r&&r[1],id=data&&data[1],loc=data&&data[5]&&data[5][0]&&data[5][0][1]&&data[5][0][1][0];
  if(!r||!r[0]||r[0][0]!==0||!Array.isArray(id)||id[0]!==2||typeof id[1]!=='string'||!/^[-\w]{10,200}$/.test(id[1])||!loc||!Number.isFinite(loc[2])||!Number.isFinite(loc[3])||Math.abs(loc[2])>90||Math.abs(loc[3])>180)throw Error('Unrecognized Street View availability');
  var rad=Math.PI/180,dy=(loc[2]-p.lat)*rad,dx=(loc[3]-p.lng)*rad,a=Math.sin(dy/2)**2+Math.cos(p.lat*rad)*Math.cos(loc[2]*rad)*Math.sin(dx/2)**2;
  if(6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)))>65)throw Error('Street View is too far from this stop');
  return {available:true,pano:id[1]};
 }
 function link(p,kind,r){if(!point(p)||!r||r.available!==true)return null;var center=p.lat.toFixed(6)+','+p.lng.toFixed(6),base='https://www.google.com/maps/@?api=1&map_action=';return kind==='street'&&/^[-\w]{10,200}$/.test(r.pano||'')?base+'pano&viewpoint='+center+'&pano='+encodeURIComponent(r.pano):kind==='aerial'?base+'map&center='+center+'&zoom=17&basemap=satellite':null;}
 function create(io){
  var cache=new Map(),flights=new Map(),queue=[],active=0,timer=null,nextStart=0,pause=0,images=[];
  function key(p,kind){var t=kind==='aerial'?tile(p):null;return 'imagery-v1|'+kind+'|'+(t?'17|'+t.x+','+t.y:p.lat.toFixed(6)+','+p.lng.toFixed(6));}
  function peek(p,kind){if(!point(p))return null;var k=key(p,kind);if(!cache.has(k))cache.set(k,io.get(k,2*DAY));var r=cache.get(k);return r&&Date.now()<r.until?r:null;}
  function pump(){clearTimeout(timer);timer=null;var cap=Math.max(1,Math.min(50,Math.round(Number(io.readers())||1)));if(!queue.length||active>=cap)return;var wait=Math.max(nextStart,pause)-Date.now();if(wait>0){timer=setTimeout(pump,Math.min(wait,60000));return;}var task=queue.shift();if(!task.valid()){flights.delete(task.k);task.done(null);pump();return;}active++;nextStart=Date.now()+167;
   Promise.resolve().then(function(){return io.read(task.p,task.kind);}).then(function(r){
    if(!r||r.error||r.blocked){var e=Error(r&&r.error||'Imagery check unavailable');e.status=r&&r.status;e.retryAfter=r&&r.retryAfter;throw e;}
    var value=task.kind==='street'?street(r.body,task.p):typeof r.available==='boolean'?{available:r.available}:null;if(!value)throw Error('Unrecognized aerial availability');
    value.at=Date.now();value.until=value.at+(value.available?2*DAY:DAY);cache.set(task.k,value);io.put(task.k,Object.assign({},value));
    if(task.kind==='aerial'&&value.available&&/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(r.thumbnail||'')&&r.thumbnail.length<1400000){value.thumbnail=r.thumbnail;images=images.filter(function(k){return k!==task.k;});images.push(task.k);while(images.length>96){var old=cache.get(images.shift());if(old)delete old.thumbnail;}}
    task.done(value);
   }).catch(function(e){var now=Date.now();if(e.status===429||e.status===403){var retry=Number(e.retryAfter)*1000;if(!Number.isFinite(retry)||retry<=0)retry=Date.parse(e.retryAfter)-now;pause=Math.max(pause,now+Math.max(60000,Math.min(3600000,retry||60000)));}var r={error:String(e.message||e),until:now+300000};cache.set(task.k,r);if(io.error)io.error(task.p,task.kind,r.error);task.done(r);
   }).finally(function(){active--;flights.delete(task.k);if(io.changed&&task.valid())io.changed(task.p);pump();});pump();
  }
  function resolve(p,kind,valid){if(!point(p)||!['street','aerial'].includes(kind))return Promise.resolve(null);valid=valid||function(){return true;};var r=peek(p,kind),k=key(p,kind);if(r&&!(kind==='aerial'&&r.available&&!r.thumbnail))return Promise.resolve(r);if(flights.has(k)){var held=flights.get(k);held.owners.push(valid);return held.job;}var owners=[valid],task={p:p,kind:kind,k:k,owners:owners,valid:function(){return owners.some(function(v){return v();});}};task.job=new Promise(function(done){task.done=done;queue.push(task);});flights.set(k,task);pump();return task.job;}
  function retry(p){['street','aerial'].forEach(function(kind){if(point(p)){var k=key(p,kind),r=cache.get(k);if(r&&r.error)cache.delete(k);}});}
  return {peek:peek,resolve:resolve,retry:retry};
 }
 var api={point:point,tile:tile,street:street,link:link,create:create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RestImagery=api;
})(typeof window!=='undefined'?window:this);
