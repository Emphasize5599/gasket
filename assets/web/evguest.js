/* Optional guest-app enrichment. Cache normalized offers only, never raw traffic/identities. */
(function(root){'use strict';var A=root.__app,S=A.S,T=root.EVTariffs,stopped=false,pending=new Map(),session=0,paused=new Set(),sourceErrors=new Set();
 var providers={ea:47,evgo:19,walmart:2457,mercedes:89,bp:1672,shell:26,rivian:1047},capabilities=null;
 function call(){return root.__trip.call.apply(null,arguments);}
 async function configure(a){var r=await call('evGuestConfig',JSON.stringify(a||{}));if(!r||r.error)throw new Error('EV source settings could not be saved');capabilities=r;return r;}
 async function request(source,action,args){if(stopped||!S.evGuestApps)throw new Error('Guest lookup cancelled');if(paused.has(source)){var stoppedError=new Error(source+': access restricted; this source is paused');stoppedError.blocked=true;throw stoppedError;}var started=Date.now(),r=await call('fetchEvGuest',source,action,JSON.stringify(args));
  if(root.FLog)root.FLog.info('stations','Guest EV source request',{source:source,phase:action,status:r&&r.status||null,ms:Date.now()-started,blocked:!!(r&&r.blocked)});
  if(!r||r.error||r.blocked){var e=new Error(source+': '+(r&&r.blocked?'access restricted; this source is paused':r&&r.status===401?'authentication expired':'guest data unavailable'));e.blocked=r&&r.blocked;if(e.blocked)paused.add(source);sourceErrors.add(e.message);throw e;}
  var j;try{j=JSON.parse(r.body);}catch(e){throw new Error(source+': unreadable station data');}if(j.errors)throw new Error(source+': unsuccessful response');return j;
 }
 function distance(a,b){return Math.hypot((+a.lat-+b.lat)*111320,(+a.lng-+b.lng)*111320*Math.cos(+a.lat*Math.PI/180));}
 function unique(st,list,coords){var matches=(list||[]).filter(function(s){return distance(st,coords(s))<=100;});return matches.length===1?matches[0]:null;}
 async function cached(key,work){var age=Math.min(24,Math.max(1,+S.evPriceAgeHours||24))*3600e3,old=A.KV.get('evguest',key,age);if(old)return old.v;
  if(pending.has(key))return pending.get(key);var run=session,p=(async function(){var v=await work();if(stopped||run!==session)return null;if(v&&v.offers.length)A.KV.put('evguest',key,v);return v;})();pending.set(key,p);try{return await p;}finally{if(pending.get(key)===p)pending.delete(key);}}
 function record(offers,source){var times=offers.map(function(o){return Date.parse(o.updated);}).filter(function(t){return Number.isFinite(t)&&t>0&&t<=Date.now();});return {offers:offers,source:source,t:times.length?Math.min.apply(null,times):Date.now()};}
 async function direct(x,group){var st=x.st,args={lat:st.lat,lng:st.lng},offers=[];
  if(group==='ea'){
   var rows=await request('ea','near',args),site=unique(st,Array.isArray(rows)?rows:[],function(s){return {lat:s.coordinates&&s.coordinates.latitude,lng:s.coordinates&&s.coordinates.longitude};});
   if(site&&!site.restricted){var j=await request('ea','detail',{id:String(site.id)});if(distance(st,{lat:j.coordinates&&j.coordinates.latitude,lng:j.coordinates&&j.coordinates.longitude})<=100)offers=T.ea(j);}
  }else if(group==='chargepoint'){
   var ids=root.EVPrices.chargePointIds(st);if(!ids.length)return null;var cp=await request('chargepoint','detail',{ids:ids.slice(0,32)});
   (cp.stations||[]).forEach(function(s){if(ids.indexOf(String(s.deviceId))>=0&&distance(st,{lat:s.latitude,lng:s.longitude})<=100)offers=offers.concat(T.chargepoint(s));});
  }else if(group==='evgo'&&capabilities.evgo){
   var near=await request('evgo','near',args),site=unique(st,near.data&&near.data.getEvgoSitesForMobile&&near.data.getEvgoSitesForMobile.edges,function(s){return {lat:s.latitude,lng:s.longitude};});
   if(site&&site.access==='PUBLIC'&&/evgo/i.test(site.networkName||'')){
    var detail=await request('evgo','site',Object.assign({id:String(site.altId)},args)),d=detail.data&&detail.data.siteForMobile;
    if(d&&d.access==='PUBLIC'&&distance(st,{lat:d.latitude,lng:d.longitude})<=100)for(var ch of (d.chargers||[]).slice(0,16)){if(stopped)break;var price=await request('evgo','price',{id:String(ch.altId)});offers=offers.concat(T.evgo(ch,price.data&&price.data.getChargerPricingForMobile,d.timeZone));}
   }
  }
  if(offers.length&&offers.some(function(o){return !o.zone;})&&capabilities.chargeway&&st.afdcId){try{
   var zones=await request('chargeway','near',args),matched=(zones.results||[]).filter(function(s){return String(s.nrel_id)===String(st.afdcId)&&distance(st,{lat:s.latitude,lng:s.longitude})<=100;});
   if(matched.length===1&&matched[0].time_zone)offers.forEach(function(o){if(!o.zone){o.zone=matched[0].time_zone;o.zoneSource='chargeway';}});
  }catch(e){/* No timezone guess: retain a labeled upper estimate. */}}
  return record(offers,group);
 }
 async function aggregate(x,group){var st=x.st,args={lat:st.lat,lng:st.lng},cw=null,ps=null,offers=[];
  if(capabilities.chargeway){try{
   var near=await request('chargeway','near',args),rows=(near.results||[]).filter(function(s){return !s.is_access_restricted&&!s.is_coming_soon&&!s.archived;});
   // Exact DOE identity is safer than co-located pins. Without it, do not borrow another operator's tariff.
   var matches=st.afdcId?rows.filter(function(s){return String(s.nrel_id)===String(st.afdcId)&&distance(st,{lat:s.latitude,lng:s.longitude})<=100;}):[];
   if(matches.length===1){cw=matches[0];if(group!=='bp'){var price=await request('chargeway','price',{id:cw.id});offers=T.chargeway(cw,price);}}
  }catch(e){sourceErrors.add(e.message);}}
  if(capabilities.plugshare&&providers[group]){
   var psrows=await request('plugshare','near',args),candidate=unique(st,(Array.isArray(psrows)?psrows:[]).filter(function(s){return (s.stations||[]).some(function(c){return +c.network_id===providers[group];});}),function(s){return {lat:s.latitude,lng:s.longitude};});
   if(candidate){ps=await request('plugshare','detail',{id:String(candidate.id)});if(distance(st,{lat:ps.latitude,lng:ps.longitude})<=100){var psOffers=T.plugshare(ps,providers[group]);
     // Never merge unrelated ports. Prefer complete per-port quotes; keep both provenances if sources disagree.
     if(cw&&cw.time_zone)psOffers.forEach(function(o){if(!o.zone)o.zone=cw.time_zone;});
     if(psOffers.length)offers=psOffers;}}
  }
  return record(offers,ps?'plugshare':cw?'chargeway':group);
 }
 async function annotate(items,car,progress){stopped=false;session++;paused.clear();sourceErrors.clear();var notes=[],count=0;if(!S.evGuestApps||!A.N.fetchEvGuest||!T)return {priced:0,notes:notes};
  var run=session;capabilities=await configure({});if(!capabilities.enabled)return {priced:0,notes:['Enable guest sources in Settings → Connections on this device.']};var todo=items.filter(function(x){var g=root.AltFuel.netGroup(x.st);return root.AltFuel.netEnabled(g)&&(['ea','chargepoint','evgo','walmart','mercedes','bp','shell','rivian'].indexOf(g)>=0);});
  var blocked=new Set();for(var i=0;i<todo.length;i++){if(stopped||run!==session)break;var x=todo[i],g=root.AltFuel.netGroup(x.st);if(blocked.has(g))continue;
   try{var data=await cached('v1|'+g+'|'+x.st.id,async function(){return ['ea','chargepoint','evgo'].indexOf(g)>=0?direct(x,g):aggregate(x,g);});
    var selected=data&&T.select(data.offers,x,car,Date.now());if(selected){var p=selected.price,o=selected.offer;
     // Incomplete mandatory fees cannot override a better public price or enter automatic planning.
     if(!p.complete){x.st.evTariffIssue='Published energy price found; fee applicability is unverified';if(x.st.netPrice)continue;}
     var sourceLabel=({ea:'Electrify America',evgo:'EVgo',chargepoint:'ChargePoint',chargeway:'Chargeway',plugshare:'PlugShare'})[data.source]||data.source;
     x.st.tariffV2={offer:o,source:data.source,sourceLabel:sourceLabel,t:data.t};x.st.netPrice=Object.assign({},p,{src:data.source,t:data.t,label:sourceLabel+' published guest rate'+(!p.complete?' · energy only; fees unverified':p.conservative?' · upper estimate; arrival-time rate unverified':'')});
     var u={charging_level:o.level,connectors:{}};u.connectors[o.plug]={port_count:1,power_kw:o.kw};x.st.units=[u];count++;
    }else x.st.evTariffIssue='No matching published guest tariff';
   }catch(e){if(e.blocked)blocked.add(g);if(notes.indexOf(e.message)<0)notes.push(e.message);}
   if(progress)progress((i+1)/todo.length,'Reading guest charger tariffs');
  }return {priced:count,notes:Array.from(new Set(notes.concat(Array.from(sourceErrors))))};
 }
 async function setEnabled(enabled){
  if(!A.N.evGuestConfig)throw new Error('Guest sources require the Android app.');
  if(enabled&&!await A.confirmDel({always:true,title:'Enable guest-app price sources?',body:'Fetches extra EV prices through unofficial app APIs and creates anonymous IDs on this phone. Sources may block requests, change, or return incomplete prices; provider data rights are not confirmed. No personal charging-account login is needed.',action:'Enable',no:'Not now',goClass:'primary'}))return false;
  await configure({enabled:!!enabled});S.evGuestApps=!!enabled;if(!enabled){stopped=true;session++;}A.save();return true;
 }
 root.EVGuest={annotate:annotate,configure:configure,setEnabled:setEnabled,cancel:function(){stopped=true;session++;},distance:distance,unique:unique};
})(window);
