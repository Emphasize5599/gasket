/* Public Recreation.gov campground, rates, campsite and calendar data.
 * Keep booking and full place presentation on the provider's website. No account/key.
 * Unknown prices, reservation windows and quiet hours are never opening hours. */
(function(root){'use strict';
 var SC=typeof module!=='undefined'&&module.exports?require('./stopclock'):root.StopClock;
 var BASE='https://www.recreation.gov/api/camps/';
 function id(p){var m=/^ridb:(\d+)$/.exec(p&&p.id||'');return m&&m[1];}
 function text(s){return String(s||'').replace(/<\/(?:p|li|div|h\d)>/gi,'. ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();}
 function norm(s){return text(s).toLowerCase().trim();}
 function date(t,z){if(typeof z!=='string'||!z)return null;try{var p=new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t)),o={};p.forEach(function(x){o[x.type]=x.value;});return o.year+'-'+o.month+'-'+o.day;}catch(e){return null;}}
 function notices(f){return (f.notices||[]).filter(function(n){return n.active!==false;}).map(function(n){return text(n.notice_text);});}
 function minutes(s){var m=/(\d{1,2})(?::(\d\d))?\s*(a\.?m\.?|p\.?m\.?)/i.exec(s);if(!m)return null;var h=+m[1]%12;return h*60+(+m[2]||0)+(/^p/i.test(m[3])?720:0);}
 function hours(f){var content=notices(f).concat(Object.keys(f.facility_description_map||{}).map(function(k){return text(f.facility_description_map[k]);}));
  for(var s of content){var m=/(?:campground|park)\s+(?:gate\s+)?hours\s*(?:are|:)?\s*(\d[^.;]*?(?:[ap]\.?m\.?))\s*(?:-|to|until)\s*(\d[^.;]*?(?:[ap]\.?m\.?))/i.exec(s);if(m){var a=minutes(m[1]),b=minutes(m[2]);if(a!=null&&b!=null)return clock(a)+'-'+clock(b);}m=/(?:campground\s+)?gate\s+(?:is\s+)?closed\s+and\s+locked\s+from\s+(\d[^;]*?)(?:\.|$)/i.exec(s);if(m){var times=m[1].match(/\d{1,2}(?::\d\d)?\s*[ap]\.?m\.?/gi)||[];if(times.length===2&&!/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(s))return clock(minutes(times[1]))+'-'+clock(minutes(times[0]));}}
  return null;
 }
 function clock(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
 function closure(f,day){if(f.is_deactivated===true)return 'Campground deactivated';
  for(var s of notices(f)){
   // Facility-wide statements only. A closed office, shower, loop, road or lake
   // does not automatically mean the entire campground is closed.
   if(!/\b(?:this|the|entire|all|[A-Z][\w'-]+)?\s*(?:campgrounds?|campsite|this facility|entire park)(?:\s+(?:is|are|will be|remains|has been|is scheduled to be))?\s+(?:temporarily\s+|permanently\s+)?closed\b/i.test(s)&&!/\bcampground.{0,35}\bclosure\b/i.test(s))continue;
   if(/\b(?:if|may be|possible|check for|partial|portion|loop|some sites)\b/i.test(s))continue;
   var dates=s.match(/\b20\d\d-\d\d-\d\d\b/g);if(!dates){var named=s.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d\d)?/gi)||[];dates=named.map(function(v){var clean=v.replace(/(\d)(?:st|nd|rd|th)/,'$1');if(!/20\d\d/.test(clean))clean+=', '+day.slice(0,4);var t=Date.parse(clean+' UTC');return Number.isFinite(t)?new Date(t).toISOString().slice(0,10):null;}).filter(Boolean);}
   if(dates&&dates.length===2){if(day>=dates[0]&&day<=dates[1])return s;continue;}if(dates&&dates.length===1){if(/closed\s+(?:until|through)/i.test(s)){if(day<=dates[0])return s;continue;}if(/(?:from|starting|beginning|effective)/i.test(s)){if(day>=dates[0])return s;continue;}}
   // Unstructured construction/season dates are not guessed: withhold this
   // candidate until the agency's notice can be understood/updated.
   return s;
  }return null;
 }
 function attrs(s){var a={};(s.attributes||[]).forEach(function(x){a[x.attribute_code||x.attribute_name]=x.attribute_value;});Object.keys(s.site_details_map||{}).forEach(function(k){a[k]=s.site_details_map[k].attribute_value;});Object.keys(s.equipment_details_map||{}).forEach(function(k){a[k]=s.equipment_details_map[k].attribute_value;});return a;}
 function amenitySet(f,s){var a=new Set();[f.amenities,s&&s.amenities].forEach(function(v){if(Array.isArray(v))v.forEach(function(x){if(typeof x==='string')a.add(norm(x));});else Object.keys(v||{}).forEach(function(k){if(!/^(n|no|false)$/i.test(String(v[k])))a.add(norm(k));});});(s&&s.attributes||[]).forEach(function(x){if(/^(n|no|false|0)$/i.test(String(x.attribute_value)))return;a.add(norm(x.attribute_name));});return a;}
 var ALIASES={restrooms:/toilets|restrooms/,showers:/^showers$|accessible showers/,drinking_water:/^(accessible )?drinking water(?: \(hand pump\))?$/,electric:/electric (?:hookups|hookup)|^electricity$/,pets:/^pets allowed$/,accessible:/accessible campsites|accessible sites/,picnic_tables:/picnic tables?/,dump_station:/dump station/,sewer:/sewer hookups/,water_hookup:/water hookups/,fire_pit:/fire pit|campfire rings?/,playground:/playground/};
 function facts(f){var a=amenitySet(f),out={};Object.keys(ALIASES).forEach(function(k){if(Array.from(a).some(function(x){return !/seasonal|peak season/.test(x)&&ALIASES[k].test(x);}))out[k]=true;});return out;}
 function eligible(s,f,filter){if(s.is_deactivated||/^(closed|not available)$/i.test(s.campsite_status||'')||s.type_of_use&&s.type_of_use!=='Overnight')return false;var a=attrs(s),eq=filter.equipment;
  if(filter.siteWidthFeet>0&&!(+a.site_width>=filter.siteWidthFeet)||filter.drivewayFeet>0&&!(+a.driveway_length>=filter.drivewayFeet))return false;
  if(eq&&!(s.permitted_equipment||[]).some(function(e){return !e.is_deactivated&&norm(e.equipment_name)===norm(eq)&&(!filter.lengthFeet||+e.max_length>=filter.lengthFeet);}))return false;
  if(filter.lengthFeet>0&&!(+a.max_vehicle_length>=filter.lengthFeet))return false;
  if(filter.people>0&&!(+a.max_num_people>=filter.people)||filter.vehicles>0&&!(+a.max_num_vehicles>=filter.vehicles))return false;
  var set=amenitySet(f,s);if((filter.requireAmenities||[]).some(function(k){return !set.has(norm(k));}))return false;
  var common=Object.assign({},facts(f),facts({amenities:s.amenities}));if((filter.required||[]).some(function(k){return common[k]!==true&&!(k==='pets'&&/^(yes|domestic|y)$/i.test(a.pets_allowed||''));}))return false;
  if(Object.keys(filter.attributes||{}).some(function(k){return String(a[k]||'')!==String(filter.attributes[k]);}))return false;return true;
 }
 function rates(data,sites,day){var offers=[],extra=false;
  (data.rates.rates_list||[]).filter(function(r){return typeof r.season_start==='string'&&typeof r.season_end==='string'&&r.season_start.slice(0,10)<=day&&r.season_end.slice(0,10)>=day;}).forEach(function(r){
   sites.forEach(function(s){var template=(s.fee_templates||{})[r.season_type]||s.campsite_type,q=(r.rate_map||{})[template];if(!q)return;
    var effective=q.effective_date&&q.effective_date.slice(0,10);if(effective&&effective!=='0001-01-01'&&effective>day)return;
    if(q.future_fees||q.group_fees||q.increment_fees||q.per_person>0||q.weekend>0||q.holiday>0||q.deposit>0)extra=true;
    if(Number.isFinite(q.per_night)&&q.per_night>=0)offers.push(q.per_night);
   });
  });return {min:offers.length?Math.min.apply(null,offers):null,max:offers.length?Math.max.apply(null,offers):null,extra:extra,currency:'USD',unit:'night'};
 }
 function evaluate(data,p,when,until,filter){filter=filter||{};var f=data.facility.campground;if(!f||String(f.facility_id)!==id(p))return {ok:false,reason:'Campground identity unavailable'};
  var zone=f.facility_time_zone,day=date(when,zone);if(!day)return {ok:false,reason:'Campground timezone unavailable'};var shut=closure(f,day);if(shut)return {ok:false,reason:'Campground closed or closure requires review: '+shut};
  var gate=hours(f);if(!gate&&notices(f).some(function(s){return /\bgate.{0,50}(?:clos|lock|hours)/i.test(s)&&!/not locked|unlocked|combination code|access code/i.test(s);}))return {ok:false,reason:'Campground gate restrictions could not be verified for arrival'};if(gate&&SC.hours(gate,when,zone).state==='closed')return {ok:false,reason:'Campground gate closed at arrival'};
  var all=(data.sites.campsites||[]).filter(function(s){return eligible(s,f,filter);});if(!all.length)return {ok:false,reason:'No campsite matches your facilities, equipment or capacity requirements'};
  var calendar=data.calendar.campsites||{},days=[day],last=date(Math.max(when,(until||when)-1),zone);while(last&&days[days.length-1]<last&&days.length<32)days.push(new Date(Date.parse(days[days.length-1]+'T00:00:00Z')+86400000).toISOString().slice(0,10));
  var open=all.filter(function(s){return days.every(function(d){if(closure(f,d)||closure({notices:s.notices||[],is_deactivated:s.is_deactivated},d))return false;var row=calendar[s.campsite_id],v=row&&row.availabilities&&row.availabilities[d+'T00:00:00Z'],walk=(data.rates.rates_list||[]).some(function(r){return r.season_type==='Walk In'&&r.season_start.slice(0,10)<=d&&r.season_end.slice(0,10)>=d;});return v==='Available'||v==='Not Reservable'&&walk||filter.hasReservation&&v==='Reserved';});});
  // Reserved is not proof this user has a booking. The existing permission
  // acknowledgement remains required; the provider handles actual reservations.
  if(!open.length)return {ok:false,reason:'No matching campsite has confirmed open calendar data for arrival'};
  var verified=facts(f);(filter.required||[]).forEach(function(k){verified[k]=true;});var q=rates(data,open,day);if(filter.freeOnly&&(q.min!==0||q.extra))return {ok:false,reason:'No verified free rate'};if(filter.maxNightly!=null&&filter.maxNightly!==''&&(!Number.isFinite(q.max)||q.extra||q.max>+filter.maxNightly))return {ok:false,reason:'Nightly rate is unknown, has extra fees or exceeds your limit'};
  return {ok:true,site:Object.assign({},p,{amenities:Object.assign({},p.amenities,verified),timeZone:zone,recreation:data,recreationDay:day,gateHours:gate,hours:gate||p.hours,feeRange:q,feeText:q.min==null?text(f.facility_use_fee_description)||'Price unavailable':('$'+q.min.toFixed(2)+(q.max!==q.min?'–$'+q.max.toFixed(2):'')+'/night'+(q.extra?' + additional fees':'')),price:q.min===0&&q.max===0&&!q.extra?0:null,detailsSource:'Recreation.gov structured data',checkedAt:data.at,notices:notices(f)})};
 }
 function create(io){var pending=new Map(),reading=new Map(),queue=[],active=0;function pump(){while(active<4&&queue.length){active++;var job=queue.shift();io.fetch(job.url).then(job.resolve,job.reject).finally(function(){active--;pump();});}}function fetch(url){return new Promise(function(resolve,reject){queue.push({url:url,resolve:resolve,reject:reject});pump();});}async function load(p,when,valid){var n=id(p);if(!n)throw Error('Not a Recreation.gov campground');var f=io.get('rec-facility|'+n,3600000),zone=f&&f.campground&&f.campground.facility_time_zone;
   async function read(k,url,ttl){var hit=io.get(k,ttl);if(hit)return hit;if(!reading.has(k)){var request=fetch(url).then(function(v){var shape=k.startsWith('rec-facility|')?v&&v.campground:k.startsWith('rec-rates|')?v&&Array.isArray(v.rates_list):k.startsWith('rec-sites|')?v&&Array.isArray(v.campsites):v&&v.campsites&&!Array.isArray(v.campsites);if(!shape)throw Error('Campground response unavailable or website verification required');if(k.startsWith('rec-sites|'))v={campsites:v.campsites.map(function(s){var c={};['campsite_id','facility_id','campsite_type','type_of_use','is_deactivated','campsite_status','permitted_equipment','notices','amenities','attributes','site_details_map','equipment_details_map','fee_templates'].forEach(function(k){c[k]=s[k];});return c;})};
if(k.startsWith('rec-calendar|')){var c={};Object.keys(v.campsites).forEach(function(id){c[id]={availabilities:v.campsites[id].availabilities};});v={campsites:c};}
if(k.startsWith('rec-facility|')){var c={};['facility_id','facility_name','facility_time_zone','facility_description_map','amenities','notices','is_deactivated','facility_rules','facility_use_fee_description'].forEach(function(k){c[k]=v.campground[k];});v={campground:c};}
if(k.startsWith('rec-sites|')||k.startsWith('rec-facility|')){var catalog=io.get('rec-facets',0)||{amenities:[],attributes:{}},names=new Set(catalog.amenities),rows=k.startsWith('rec-sites|')?v.campsites:[v.campground];rows.forEach(function(s){amenitySet(s).forEach(function(n){if(!Array.from(names).some(function(x){return norm(x)===n;}))names.add(n);});(s.attributes||[]).forEach(function(a){var key=a.attribute_code||a.attribute_name,value=String(a.attribute_value==null?'':a.attribute_value);if(!key||/map_|coordinate|is_on_map/i.test(key)||!value||value.length>200)return;var r=catalog.attributes[key]||(catalog.attributes[key]={label:a.attribute_name||key,values:[]});if(!r.values.includes(value))r.values.push(value);});});catalog.amenities=Array.from(names);io.put('rec-facets',catalog);}
io.put(k,v);return v;}).finally(function(){reading.delete(k);});reading.set(k,request);}var v=await reading.get(k);if(valid&&!valid())throw Error('Rest search cancelled');return v;}
   if(!f)f=await read('rec-facility|'+n,BASE+'campgrounds/'+n,3600000);zone=f.campground&&f.campground.facility_time_zone;var day=date(when,zone);if(!day)throw Error('Campground timezone unavailable');if(closure(f.campground,day)||hours(f.campground)&&SC.hours(hours(f.campground),when,zone).state==='closed')return {facility:f,rates:{rates_list:[]},sites:{campsites:[]},calendar:{campsites:{}},at:Date.now()};var month=day.slice(0,7)+'-01',tomorrow=date(when+86400000,zone),months=Array.from(new Set([month,tomorrow.slice(0,7)+'-01'])),key=n+'|'+months.join('|');
   if(!pending.has(key)){var work=Promise.all([read('rec-rates|'+n,BASE+'campgrounds/'+n+'/rates',86400000),read('rec-sites|'+n,BASE+'campgrounds/'+n+'/campsites',3600000),Promise.all(months.map(function(m){return read('rec-calendar|'+n+'|'+m,BASE+'availability/campground/'+n+'/month?start_date='+encodeURIComponent(m+'T00:00:00.000Z'),3600000);})).then(function(parts){var camps={};parts.forEach(function(part){Object.keys(part.campsites||{}).forEach(function(k){var r=part.campsites[k];camps[k]=Object.assign({},r,{availabilities:Object.assign({},camps[k]&&camps[k].availabilities,r.availabilities)});});});return {campsites:camps};})]).then(function(v){return {facility:f,rates:v[0],sites:v[1],calendar:v[2],at:Date.now()};}).finally(function(){pending.delete(key);});pending.set(key,work);}return pending.get(key);
  }return {load:load};}
 var api={id:id,text:text,hours:hours,closure:closure,evaluate:evaluate,create:create,aliases:ALIASES};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Recreation=api;
})(typeof window==='undefined'?globalThis:window);
