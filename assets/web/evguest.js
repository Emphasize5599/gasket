/* Optional guest-app enrichment. Cache normalized offers only, never raw traffic/identities. */
(function(root){'use strict';var A=root.__app,S=A.S,T=root.EVTariffs,failures=0,stopped=false,pending=new Map(),session=0,paused=new Set(),sourceErrors=new Set(),forcePrices=false;
 var providers={ea:47,evgo:19,walmart:2457,mercedes:89,bp:1672,shell:26,rivian:1047},capabilities=null;
 function call(){return root.__trip.call.apply(null,arguments);}
 async function configure(a){var r=await call('evGuestConfig',JSON.stringify(a||{}));if(!r||r.error)throw new Error('EV source settings could not be saved');capabilities=r;return r;}
 async function request(source,action,args){if(stopped||!S.evGuestApps)throw new Error('Guest lookup cancelled');if(paused.has(source)){var stoppedError=new Error(source+': access restricted; this source is paused');stoppedError.blocked=true;throw stoppedError;}var started=Date.now(),r=await call('fetchEvGuest',source,action,JSON.stringify(args));
  if(root.FLog)root.FLog.info('stations','Guest EV source request',Object.assign({source:source,phase:action,status:r&&r.status||null,ms:Date.now()-started,blocked:!!(r&&r.blocked),authRefreshed:!!(r&&r.authRefreshed),authDenied:!!(r&&r.authDenied),authRefreshFailed:!!(r&&r.authRefreshFailed),paused:!!(r&&r.paused)},r&&r.gqlErrors&&r.gqlErrors.length?{gqlErrors:r.gqlErrors}:{},r&&r.guestNotPermitted?{guestNotPermitted:true}:{}));
  // EVgo refuses its station-detail query to every guest identity (not an expired token): remember it for a day,
  // across restarts, and go straight to Chargeway / PlugShare for EVgo stations instead of three doomed requests a run.
  if(r&&r.guestNotPermitted&&source==='evgo'){A.KV.put('evguest','evgo-guest-denied',{t:Date.now(),scope:r.scope||action});if(root.FLog)root.FLog.warn('stations','EVgo station details need a signed-in EVgo account',{scope:r.scope||action,gqlErrors:r.gqlErrors||[]});}
  if(!r||r.error||r.blocked){failures++;var e=new Error(source+': '+(r&&r.guestNotPermitted?'station details need a signed-in EVgo account, so EVgo prices come from Chargeway / PlugShare when they have them':r&&r.authDenied?'guest access denied after token refresh; source paused (not a bot check)':r&&r.authRefreshFailed?'token refresh failed; source paused':r&&r.blocked?'access restricted; this source is paused':r&&r.status===401?'authentication expired':'guest data unavailable'));e.blocked=r&&r.blocked;if(e.blocked)paused.add(source);sourceErrors.add(e.message);throw e;}
  var j;try{j=JSON.parse(r.body);}catch(e){failures++;throw new Error(source+': unreadable station data');}if(j.errors&&j.errors.length){
   var denied=j.errors.some(function(x){return /not authorized|unauthenticated|forbidden|access denied/i.test(String(x.message||'')+' '+String(x.extensions&&x.extensions.code||''));});
   failures++;var error=new Error(source+(denied?': guest access denied; source paused (not a bot check)':': unsuccessful API response'));
   if(denied){paused.add(source);error.blocked=true;}sourceErrors.add(error.message);if(root.FLog)root.FLog.warn('stations','Guest EV API response rejected',{source:source,phase:action,denied:denied});throw error;
  }return j;
 }
 function distance(a,b){return Math.hypot((+a.lat-+b.lat)*111320,(+a.lng-+b.lng)*111320*Math.cos(+a.lat*Math.PI/180));}
 function unique(st,list,coords){var matches=(list||[]).filter(function(s){return distance(st,coords(s))<=100;});return matches.length===1?matches[0]:null;}
 // A source that answered (200) with no matching published tariff is remembered too, for EMPTY_MS (within the EV price
 // age): every pass otherwise re-asked the same unpriced chargers (0.0.264 log: 214 ChargePoint lookups again 54 min
 // later). Only when every request in the lookup answered: an error or refusal (even one aggregate() carried on past)
 // is never cached. Explicit Update prices (force) asks again.
 var EMPTY_MS=6*3600e3,EVGO_DENIED_MS=24*3600e3;
 function evgoGuestDenied(){return !forcePrices&&!!A.KV.get('evguest','evgo-guest-denied',EVGO_DENIED_MS);}
 async function cached(key,work){var age=Math.min(24,Math.max(1,+S.evPriceAgeHours||24))*3600e3,old=!forcePrices&&A.KV.get('evguest',key,age);if(old&&(old.v&&old.v.offers&&old.v.offers.length||Date.now()-(+old.v.checked||0)<=Math.min(age,EMPTY_MS)))return old.v;
  if(pending.has(key))return pending.get(key);var run=session,p=(async function(){var before=failures,v=await work();if(stopped||run!==session)return null;if(v&&v.offers.length)A.KV.put('evguest',key,v);else if(v&&failures===before)A.KV.put('evguest',key,Object.assign({},v,{offers:[],checked:Date.now()}));return v;})();pending.set(key,p);try{return await p;}finally{if(pending.get(key)===p)pending.delete(key);}}
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
 async function annotate0(items,car,progress){stopped=false;session++;paused.clear();sourceErrors.clear();var notes=[],count=0;if(!S.evGuestApps||!A.N.fetchEvGuest||!T)return {priced:0,notes:notes};
  var run=session;capabilities=await configure({});if(!capabilities.enabled)return {priced:0,notes:['Enable guest sources in Settings → Connections on this device.']};var todo=items.filter(function(x){var g=root.AltFuel.netGroup(x.st);return root.AltFuel.netEnabled(g)&&(['ea','chargepoint','evgo','walmart','mercedes','bp','shell','rivian'].indexOf(g)>=0);});
  var blocked=new Set();for(var i=0;i<todo.length;i++){if(stopped||run!==session)break;var x=todo[i],g=root.AltFuel.netGroup(x.st);if(blocked.has(g))continue;
   try{var data=await cached('v1|'+g+'|'+x.st.id,async function(){if(g==='evgo'){
     if(!paused.has('evgo')&&!evgoGuestDenied()){try{var own=await direct(x,g);if(own&&own.offers.length)return own;}catch(e){sourceErrors.add(e.message);}}
     return aggregate(x,g);
    }return ['ea','chargepoint'].indexOf(g)>=0?direct(x,g):aggregate(x,g);});
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
 async function annotate(items,car,progress,force){forcePrices=!!force;try{return await annotate0(items,car,progress);}finally{forcePrices=false;}}
 async function setEnabled(enabled){
  if(!A.N.evGuestConfig)throw new Error('Guest sources require the Android app.');
  if(enabled&&!await A.confirmDel({always:true,title:'Enable guest-app price sources?',body:'Fetches extra EV prices through unofficial app APIs and creates anonymous IDs on this phone. Sources may block requests, change, or return incomplete prices; provider data rights are not confirmed. No personal charging-account login is needed.',action:'Enable',no:'Not now',goClass:'primary'}))return false;
  await configure({enabled:!!enabled});S.evGuestApps=!!enabled;if(!enabled){stopped=true;session++;}A.save();return true;
 }
 root.EVGuest={annotate:annotate,configure:configure,setEnabled:setEnabled,cancel:function(){stopped=true;session++;},distance:distance,unique:unique};
})(window);
