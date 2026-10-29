/* Location-local clocks and conservative regular opening hours. Unsupported
 * holiday/seasonal/prose rules are unknown, never guessed open or closed. */
(function(root){'use strict';
 var DAY=['Su','Mo','Tu','We','Th','Fr','Sa'],formatters=new Map(),validZones=new Set();
 function zoneOK(z){try{if(!z||typeof z!=='string')return false;if(validZones.has(z))return true;new Intl.DateTimeFormat('en-US',{timeZone:z});validZones.add(z);return true;}catch(e){return false;}}
 function parts(t,z){if(!Number.isFinite(t)||!zoneOK(z))return null;var f=formatters.get(z);if(!f){f=new Intl.DateTimeFormat('en-US',{timeZone:z,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formatters.set(z,f);}var p={};f.formatToParts(t).forEach(function(x){p[x.type]=x.value;});return {day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday),minute:+p.hour*60+(+p.minute)};}
 function label(t,z){if(!Number.isFinite(t)||!zoneOK(z))return null;var clock24=!!(root.__app&&root.__app.S.clock24),d=formatters.get('date|'+z),h=formatters.get('time|'+z+'|'+clock24);if(!d||!h){d=new Intl.DateTimeFormat('en-US',{timeZone:z,month:'short',day:'numeric'});h=new Intl.DateTimeFormat('en-US',{timeZone:z,hour:'numeric',minute:'2-digit',timeZoneName:'short',hour12:!clock24});formatters.set('date|'+z,d);formatters.set('time|'+z+'|'+clock24,h);}return {date:d.format(t),time:h.format(t)};}

 function parse(text){text=String(text||'').trim();if(text==='24/7')return {always:true};if(text==='off'||text==='closed')return {days:Array.from({length:7},function(){return [];})};if(!text||text.length>500)return null;
  var days=Array.from({length:7},function(){return [];}),assigned=new Set(),rules=text.split(';');
  for(var r=0;r<rules.length;r++){var m=/^\s*(?:((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+)?(off|closed|\d{2}:\d{2}-\d{2}:\d{2}(?:\s*,\s*\d{2}:\d{2}-\d{2}:\d{2})*)\s*$/.exec(rules[r]);if(!m)return null;
   var selected=[];if(!m[1])selected=[0,1,2,3,4,5,6];else m[1].replace(/\s/g,'').split(',').forEach(function(s){var p=s.split('-'),a=DAY.indexOf(p[0]),b=DAY.indexOf(p[1]||p[0]);for(var d=a;;d=(d+1)%7){if(!selected.includes(d))selected.push(d);if(d===b)break;}});
   if(selected.some(function(d){return assigned.has(d);}))return null;selected.forEach(function(d){assigned.add(d);});if(m[2]==='off'||m[2]==='closed'){selected.forEach(function(d){days[d]=[];});continue;}
   var ranges=m[2].split(',');for(var i=0;i<ranges.length;i++){var a=ranges[i].trim().split('-'),n=a.map(function(v){var p=v.split(':');return +p[0]*60+(+p[1]);});if(a.some(function(v){var p=v.split(':');return +p[0]>24||+p[1]>59||+p[0]===24&&+p[1]!==0;})||n[0]>=1440||n[0]===n[1])return null;
    selected.forEach(function(d){if(n[1]>n[0])days[d].push(n);else {days[d].push([n[0],1440]);days[(d+1)%7].push([0,n[1]]);}});
   }
  }return {days:days};
 }
 function hours(text,at,zone,until){var p=parse(text);if(!p||!Number.isFinite(at)||until!=null&&(!Number.isFinite(until)||until<at||until-at>86400000))return {state:'unknown'};if(p.always)return {state:'open'};if(!zoneOK(zone))return {state:'unknown'};
  function open(t){var v=parts(t,zone);return p.days[v.day].some(function(r){return v.minute>=r[0]&&v.minute<r[1];});}
  if(!open(at))return {state:'closed',at:at};if(until!=null&&until>at){for(var t=Math.floor(at/60000)*60000+60000;t<until;t+=60000)if(!open(t))return {state:'closed',at:t};if(!open(until-1))return {state:'closed',at:until-1};}return {state:'open'};
 }
 function key(p){return 'timezone|'+(+p.lat).toFixed(5)+'|'+(+p.lng).toFixed(5);}
 function create(io){var zones=new Map(),pending=new Map();
  function get(p){if(zoneOK(p.timeZone))return p.timeZone;var k=key(p),v=zones.get(k)||io.get(k);if(v&&zoneOK(v.zone||v)){zones.set(k,v.zone||v);return v.zone||v;}return null;}
  async function load(points,valid){valid=valid||function(){return true;};var missing=[],seen=new Set();points.forEach(function(p){var k=key(p);if(!get(p)&&!seen.has(k)){seen.add(k);missing.push(p);}});var jobs=[];
   for(var start=0;start<missing.length;start+=20){var group=missing.slice(start,start+20),id=group.map(key).join(';');if(!pending.has(id)){var task=(async function(ps){if(!valid())return;try{var q=new URLSearchParams({latitude:ps.map(function(p){return (+p.lat).toFixed(5);}).join(','),longitude:ps.map(function(p){return (+p.lng).toFixed(5);}).join(','),timezone:'auto',forecast_days:1}),j=await io.fetch('https://api.open-meteo.com/v1/forecast?'+q),rows=Array.isArray(j)?j:[j];if(rows.length!==ps.length)throw Error('Timezone response incomplete');rows.forEach(function(r,i){if(zoneOK(r.timezone)){var k=key(ps[i]);zones.set(k,r.timezone);io.put(k,{zone:r.timezone});}});}catch(e){if(io.error)io.error(e);} })(group).finally((function(k){return function(){pending.delete(k);};})(id));pending.set(id,task);}jobs.push(pending.get(id));if(jobs.length===2){await Promise.all(jobs);jobs=[];if(!valid())return;}}
   await Promise.all(jobs);
  }return {get:get,load:load};
 }
 var api={label:label,hours:hours,create:create,parts:parts};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StopClock=api;
})(typeof window!=='undefined'?window:this);
