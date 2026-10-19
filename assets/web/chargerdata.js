/* Offline charger inventory + optional, route-scoped provider updates. No invented live tariffs. */
(function(root){'use strict';
 var A=root.__app,S=A.S,N=A.N,KV=A.KV,esc=A.esc,HOUR=3600e3,DAY=24*HOUR,pending=new Map(),downloadPromise=null;
 function call(){return root.__trip.call.apply(null,arguments);}
 function params(o){return Object.keys(o).map(function(k){return k+'='+encodeURIComponent(o[k]);}).join('&');}
 function identity(provider,key){var h=2166136261;for(var i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,16777619);}return provider+'|'+(h>>>0).toString(16);}
 function usage(provider,key){var o=KV.get('chargerusage',identity(provider,key));return o&&o.v||{attempts:[]};}
 function before(provider,key){var u=usage(provider,key),now=Date.now();u.attempts=(u.attempts||[]).filter(function(t){return now-t<DAY;});
  var demo=provider==='doe'&&key==='DEMO_KEY',hour=u.attempts.filter(function(t){return now-t<HOUR;});
  if(u.until>now||(demo&&(u.attempts.length>=49||hour.length>=29)))throw new Error(provider==='ocm'?'Open Charge Map provider limit: using saved data while requests are paused.':'Charger provider limit: using saved data. DEMO_KEY allows 30/hour and 50/day per public IP; a free personal key raises the allowance.');
  u.attempts.push(now);KV.put('chargerusage',identity(provider,key),u);if(root.__apiCount)root.__apiCount();
 }
 function after(provider,key,r){var u=usage(provider,key);u.remaining=r.remaining==null?u.remaining:r.remaining;u.limit=r.limit==null?u.limit:r.limit;u.checked=Date.now();if(r.remaining!=null)u.reportedAt=u.checked;
  // A 429 does not identify which demo allowance was exhausted. Do not claim an exact reset time.
  if(r.status===429||/\b429\b/.test(r.error||''))u.until=Date.now()+(key==='DEMO_KEY'?DAY:HOUR);
  KV.put('chargerusage',identity(provider,key),u);if(root.__apiCount)root.__apiCount();
 }
 function meterRows(){var now=Date.now(),key=String(S.nrelKey||'').trim()||'DEMO_KEY',demo=key==='DEMO_KEY',u=usage('doe',key),day=(u.attempts||[]).filter(function(t){return now-t<DAY;}),hour=day.filter(function(t){return now-t<HOUR;}),rows=[],doe=(S.evUseDOE!==false&&(key!=='DEMO_KEY'||day.length||S.fuelMode==='ev'))||S.fuelMode==='h2';
  if(doe){var cap=demo?30:(+u.limit>0&&+u.limit<1e7?+u.limit:1000),near=now-(u.reportedAt||0)<HOUR&&u.remaining!=null&&+u.remaining<=cap*.15;rows.push({provider:'doe',tag:'DOE',text:hour.length+' / '+cap+' h',title:'DOE requests on this phone in the last rolling hour; '+(demo?'demo allowance is per public IP, shared with other devices':u.limit?'provider-reported personal-key allowance':'default personal-key allowance')+'.'+(u.remaining!=null?' Provider last reported '+u.remaining+' remaining.':''),high:hour.length>=cap*.85||u.until>now||near});if(demo)rows.push({provider:'doe',tag:'DOE',text:day.length+' / 50 d',title:'DOE demo requests on this phone in the last rolling 24 hours; 50/day per public IP. Other devices may also use this allowance.',high:day.length>=50*.85||u.until>now});}
  if(S.evUseOCM&&String(S.ocmKey||'').trim()){var o=usage('ocm',String(S.ocmKey).trim()),n=(o.attempts||[]).filter(function(t){return now-t<DAY;}).length;rows.push({provider:'ocm',tag:'OCM',text:n+' · 24h',title:'Open Charge Map requests on this phone in the last rolling 24 hours. No fixed public allowance is advertised; fair-use restrictions apply.'+(o.remaining!=null?' Provider last reported '+o.remaining+' remaining.':''),high:o.until>now});}
  return rows;
 }
 function quotaText(){var key=String(S.nrelKey||'').trim()||'DEMO_KEY',u=usage('doe',key),now=Date.now(),day=(u.attempts||[]).filter(function(t){return now-t<DAY;}),hour=day.filter(function(t){return now-t<HOUR;});return 'DOE requests on this phone: '+hour.length+' in the last hour · '+day.length+' in 24 hours.'+(u.remaining!=null?' Provider last reported '+u.remaining+' remaining.':'')+' Other devices on your network may also use the demo allowance.';}
 async function inventory(boxes){if(!N.chargerInventory)return null;var r=await call('chargerInventory','query',JSON.stringify(boxes));if(r.error)throw new Error(r.error);return r.count>0?r:null;}
 function boxes(points,mi){var result=[];for(var start=0;start<points.length-1;start+=16){var group=points.slice(start,start+17),lat=group.map(function(p){return p.lat;}),lng=group.map(function(p){return p.lng;}),south=Math.min.apply(null,lat),north=Math.max.apply(null,lat),west=Math.min.apply(null,lng),east=Math.max.apply(null,lng),pad=mi/69,dx=pad/Math.max(.05,Math.cos(Math.max(Math.abs(south),Math.abs(north))*Math.PI/180));if(east-west>180)throw new Error('Offline charger lookup across the date line is not supported yet.');result.push([south-pad,north+pad,west-dx,east+dx]);}return result;}
 async function localRoute(model,mi){return inventory(boxes(root.AltFuel.routePoints(model.pts||[]),mi+.2));}
 async function localNear(lat,lng,mi){var pad=mi/69,dx=pad/Math.max(.05,Math.cos(lat*Math.PI/180));return inventory([[lat-pad,lat+pad,lng-dx,lng+dx]]);}
 function encode(points){var prev=[0,0],s='';points.forEach(function(p){[p.lat,p.lng].forEach(function(v,i){var n=Math.round(v*1e5),d=n-prev[i];prev[i]=n;d=d<0?~(d<<1):d<<1;while(d>=32){s+=String.fromCharCode((32|(d&31))+63);d>>=5;}s+=String.fromCharCode(d+63);});});return s;}
 function normOCM(o){
  var ad=o.AddressInfo||{},status=o.StatusType||{},usage=o.UsageType||{};
  if(!Number.isSafeInteger(+o.ID)||+o.ID<=0||!Number.isFinite(ad.Latitude)||!Number.isFinite(ad.Longitude)||Math.abs(ad.Latitude)>90||Math.abs(ad.Longitude)>180||status.IsOperational!==true||usage.IsAccessKeyRequired===true||usage.IsMembershipRequired===true)return null;
  // Unknown/private usage is not a public-road-trip stop. 1=public, 4=public membership, 5=public pay-at-location.
  if([1,4,5].indexOf(+o.UsageTypeID)<0)return null;
  var units=[],plugs=[],counts={dc_fast:0,'2':0,'1':0};
  (o.Connections||[]).forEach(function(c){var p={1:'J1772',2:'CHADEMO',27:'TESLA',32:'J1772COMBO'}[c.ConnectionTypeID],lv=c.CurrentTypeID===30?'dc_fast':c.LevelID===1?'1':c.LevelID===2?'2':null;
   if(!p||!lv||c.StatusType&&c.StatusType.IsOperational===false)return;var n=Math.max(1,+c.Quantity||1),kw=+c.PowerKW||0,conn={};conn[p]={port_count:n,power_kw:kw};units.push({charging_level:lv,connectors:conn});counts[lv]+=n;if(plugs.indexOf(p)<0)plugs.push(p);
  });
  if(!units.length)return null;
  var powers=units.filter(function(u){return !counts.dc_fast||u.charging_level==='dc_fast';}).map(function(u){return Math.max.apply(null,Object.keys(u.connectors).map(function(p){return u.connectors[p].power_kw;}));}),best=Math.max.apply(null,powers);
  return {id:'ocm'+o.ID,brand:'ev',name:ad.Title||'EV charger',lat:ad.Latitude,lng:ad.Longitude,country:ad.Country&&ad.Country.ISOCode||(+ad.CountryID===2?'US':''),address:[ad.AddressLine1,ad.Town,ad.StateOrProvince,ad.Postcode].filter(Boolean).join(', '),network:o.OperatorInfo&&o.OperatorInfo.Title||'',dc:counts.dc_fast,l2:counts['2'],l1:counts['1'],units:units,plugs:plugs,kw:best||50,kwEst:!best,pricing:String(o.UsageCost||'').trim(),hours:ad.AccessComments||'',status:'E',phone:ad.ContactTelephone1||'',prices:{},confirmed:o.DateLastVerified||'',source:'Open Charge Map',sourceUrl:'https://openchargemap.org/site/poi/details/'+o.ID,provider:o.DataProvider&&o.DataProvider.Title||'Open Charge Map',license:o.DataProvider&&o.DataProvider.License||'',dataUpdated:o.DateLastStatusUpdate||''};
 }
 function merge(base,extra){var out=base.slice(),cells=new Map(),byId=new Map();function cell(s){return Math.floor(s.lat*500)+','+Math.floor(s.lng*500);}function network(s){return String(s.network||'').toLowerCase().replace(/supercharger|network|charging/g,'').replace(/[^a-z0-9]/g,'');}out.forEach(function(s){byId.set(s.id,s);var k=cell(s);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(s);});
  extra.forEach(function(s){var match=byId.get(s.id),x=Math.floor(s.lat*500),y=Math.floor(s.lng*500);
   if(!match)for(var i=-1;i<=1;i++)for(var j=-1;j<=1;j++)(cells.get((x+i)+','+(y+j))||[]).forEach(function(t){var close=A.P.haversineMi(t.lat,t.lng,s.lat,s.lng)<.035,address=String(t.address||'').toLowerCase().replace(/[^a-z0-9]/g,''),sameAddress=address&&address===String(s.address||'').toLowerCase().replace(/[^a-z0-9]/g,''),name=String(t.name||'').toLowerCase().replace(/[^a-z0-9]/g,''),nt=network(t),ns=network(s);if(close&&(!nt||!ns||nt===ns)&&(sameAddress||name&&name===String(s.name||'').toLowerCase().replace(/[^a-z0-9]/g,''))&&(t.plugs||[]).some(function(p){return s.plugs.indexOf(p)>=0;}))match=t;});
   // Do not add port counts across catalogs: these can be the same physical ports. Preserve alternate evidence.
   if(match){if(match.id===s.id)Object.assign(match,s);else{match.alternateSources=(match.alternateSources||[]).concat([{source:s.source,provider:s.provider,license:s.license,url:s.sourceUrl,pricing:s.pricing,updated:s.dataUpdated}]);if(!match.pricing&&s.pricing){match.pricing=s.pricing;match.pricingSource=s.source;match.pricingUpdated=s.dataUpdated;}}}
   else{out.push(s);byId.set(s.id,s);var k=cell(s);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(s);}
  });return out;
 }
 function tariff(st,fallback){var text=String(st.pricing||'').trim(),m=st.country==='US'&&/^(?:US)?\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*kwh[.;]?$/i.exec(text),free=(st.pricingSource||st.source)==='DOE AFDC'?/^free(?: charging)?[.;]?$/i.test(text):/^free charging[.;]?$/i.test(text);return m||free?{price:free?0:+m[1],estimated:false,label:'Published charger rate (not live)',updated:st.pricingUpdated||st.dataUpdated||null}:{price:fallback,estimated:true,label:'Your charging-price estimate',updated:null};}
 async function ocmRoute(model,mi){var key=String(S.ocmKey||'').trim();if(!key)throw new Error('Open Charge Map is enabled but needs its free personal key in Settings → Connections.');
  var line=encode(root.AltFuel.routePoints(model.pts||[])),ck='ocm-route-v1|'+mi+'|'+line,cached=KV.get('afdc',ck,DAY);if(cached)return cached.v;
  if(pending.has(ck))return pending.get(ck);
  var task=(async function(){var all=[],last=0;for(var page=0;page<20;page++){
   before('ocm',key);var r=await call('fetchChargerApi','ocm',key,params({output:'json',polyline:line,distance:mi+.2,distanceunit:'Miles',maxresults:1000,sortby:'id_asc',greaterthanid:last,opendata:true,verbose:true,compact:false,includecomments:false,client:'Gasket'}));after('ocm',key,r);if(r.error){var e=new Error('Open Charge Map update failed ('+(r.status||'connection')+'); saved chargers remain available.');e.stations=all;throw e;}
   var rows;try{rows=JSON.parse(r.body);}catch(e){throw new Error('Open Charge Map sent an unreadable answer.');}if(!Array.isArray(rows))throw new Error('Open Charge Map sent an unsuccessful answer.');
   all=all.concat(rows.map(normOCM).filter(Boolean));if(rows.length<1000){KV.put('afdc',ck,all);return all;}var next=Math.max.apply(null,rows.map(function(s){return +s.ID||0;}));if(next<=last)break;last=next;
  }var e=new Error('Open Charge Map coverage is incomplete; more results remain.');e.stations=all;throw e;})();pending.set(ck,task);try{return await task;}finally{pending.delete(ck);}
 }
 function settingsHtml(){return '<div class="field col" id="chargerSettings"><label for="nrelKey">DOE station-finder key (optional)</label><input type="password" id="nrelKey" placeholder="DEMO_KEY" autocomplete="off" spellcheck="false" value="'+esc(S.nrelKey||'')+'">'+
  '<details class="settings-help"><summary>Get a free DOE key</summary><ol class="steps"><li>Open <a href="#" data-url="https://developer.nlr.gov/signup/">DOE key signup</a> and complete the form.</li><li>Copy your API key into the box above, then tap Done.</li></ol><p>Demo: 30 requests/hour and 50/day per public IP. Personal keys normally allow 1,000/hour. No Google Cloud setup. Keys are excluded from ordinary exports and logs.</p></details>'+
  '<label for="ocmKey">Open Charge Map key (optional)</label><input type="password" id="ocmKey" autocomplete="off" spellcheck="false" value="'+esc(S.ocmKey||'')+'">'+
  '<details class="settings-help"><summary>Get a free Open Charge Map key</summary><ol class="steps"><li><a href="#" data-url="https://openchargemap.org/profile">Sign in or register</a>.</li><li>Open My profile → My apps → Register an application.</li><li>Copy the API key here, then tap Done.</li></ol><p>Optional additional coverage. Fair-use limits apply; this is not an unlimited live-price service.</p></details>'+
  '<label><input type="checkbox" id="evUseDOE"'+(S.evUseDOE!==false?' checked':'')+'> Use DOE for route updates</label><label><input type="checkbox" id="evUseOCM"'+(S.evUseOCM?' checked':'')+'> Use Open Charge Map for additional coverage</label><label><input type="checkbox" id="evRefreshPrices"'+(S.evRefreshPrices!==false?' checked':'')+'> Update route pricing information online</label>'+
  '<details class="settings-help"><summary>Offline charger data</summary><p>Download all public, operating DOE chargers in the U.S. and Canada. This can be a large download; Wi-Fi is recommended. Discovery then works locally, without repeated API searches. Update the inventory periodically for new or closed sites.</p><p>Online updates only cover your route. Neither source guarantees current prices or available stalls. Unknown costs use your charging-price estimate.</p></details>'+
  '<div class="btns"><button type="button" class="btn tonal sm" id="evDownload">Download U.S. + Canada chargers</button><button type="button" class="btn tonal sm hidden" id="evCancelDownload">Cancel</button></div><div id="evInventoryStatus" role="status"></div><small id="evQuotaStatus">'+esc(quotaText())+'</small></div>';}
 async function download(key){if(downloadPromise)return downloadPromise;before('doe',key);var timer;
  downloadPromise=(async function(){try{if(root.Tasks)Tasks.upsert('charger-inventory',{text:'Downloading U.S. + Canada chargers',frac:null,cancel:function(){call('chargerInventory','cancel','');}});
   timer=setInterval(async function(){var r=await call('chargerInventory','status','');if(root.Tasks&&r.busy)Tasks.upsert('charger-inventory',{text:'Downloading chargers · '+r.received+(r.expected?' / '+r.expected:' received'),frac:r.expected?Math.min(.99,r.received/r.expected):null});},1500);
   var r=await call('chargerInventory','download',key);after('doe',key,r);if(r.error)throw new Error(r.error);return r;
  }finally{clearInterval(timer);if(root.Tasks)Tasks.remove('charger-inventory');downloadPromise=null;}})();return downloadPromise;
 }
 function attach(pg){var button=pg.querySelector('#evDownload'),cancel=pg.querySelector('#evCancelDownload'),info=pg.querySelector('#evInventoryStatus');if(!button)return;
  function show(r){info.textContent=r.error?r.error:r.count?Number(r.count).toLocaleString()+' chargers saved · '+new Date(r.updated).toLocaleDateString():'No offline charger inventory downloaded yet.';var q=pg.querySelector('#evQuotaStatus');if(q)q.textContent=quotaText();}
  button.disabled=!N.chargerInventory;if(N.chargerInventory)call('chargerInventory','status','').then(show);else info.textContent='Offline downloads are available in the Android app.';
  button.onclick=async function(){button.disabled=true;cancel.classList.remove('hidden');try{show(await download(pg.querySelector('#nrelKey').value.trim()||'DEMO_KEY'));}catch(e){show({error:e.message});}finally{button.disabled=false;cancel.classList.add('hidden');}};cancel.onclick=function(){call('chargerInventory','cancel','');};
 }
 root.ChargerData={before:before,after:after,meterRows:meterRows,quotaText:quotaText,localRoute:localRoute,localNear:localNear,ocmRoute:ocmRoute,normOCM:normOCM,merge:merge,tariff:tariff,settingsHtml:settingsHtml,attach:attach,boxes:boxes,encode:encode};
 if(root.__apiCount)root.__apiCount();
})(window);
