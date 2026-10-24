/* Pure, credential-free guest tariff normalization. Offers retain their port/plan/source associations. */
(function initEVTariffs(root){'use strict';
 var formatters=new Map();
 function number(v){return v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;}
 function plug(v){var s=String(v||'').toUpperCase();return /COMBO|CCS/.test(s)?'J1772COMBO':/CHADEMO/.test(s)?'CHADEMO':/NACS|J3400|TESLA/.test(s)?'TESLA':/J1772|IEC_62196_T1$|TYPE.?1/.test(s)?'J1772':null;}
 function minute(s){var m=/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(s||'').trim());if(!m)return null;var h=+m[1],n=+(m[2]||0);if(n>59||h>24||m[3]&&(h<1||h>12)||h===24&&n)return null;if(m[3])h=h%12+(/pm/i.test(m[3])?12:0);return h*60+n;}
 function period(s){var p=String(s||'').split(/\s*[-–]\s*/);if(p.length!==2)return null;var a=minute(p[0]),b=minute(p[1]);return a==null||b==null?null:{start:a,end:b};}
 function block(rate,text,extra){var v=number(rate),p=period(text);return v!=null&&v>=0?Object.assign({rate:v,uncertainPeriod:!!text&&!p},p||{},extra||{}):null;}
 function local(at,zone){if(!zone||!Number.isFinite(+at))return null;try{var formatter=formatters.get(zone);if(!formatter){formatter=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});if(formatters.size>=24)formatters.clear();formatters.set(zone,formatter);}var parts=formatter.formatToParts(new Date(+at)),o={};parts.forEach(function(p){o[p.type]=p.value;});return {minute:(+o.hour%24)*60+(+o.minute),day:o.weekday.toLowerCase(),date:o.year+'-'+o.month+'-'+o.day};}catch(e){return null;}}
 function quote(t,at){
  if(!t||t.currency!=='USD'||!t.blocks||!t.blocks.length)return null;
  var clock=local(at,t.zone),a=t.blocks.filter(function(b){return number(b.rate)!=null&&b.rate>=0&&(!clock||(!b.startDate||clock.date>=b.startDate)&&(!b.endDate||clock.date<=b.endDate)&&(!b.days||b.days.indexOf(clock.day)>=0));}),values=a.map(function(b){return b.rate;});if(!a.length)return null;
  var restricted=a.some(function(b){return b.startDate||b.endDate||b.days;}),unclear=a.some(function(b){return b.uncertainPeriod;}),flat=a.every(function(b){return b.rate===a[0].rate;})&&(!restricted||!!clock)&&!unclear,hits=clock?a.filter(function(b){var day=!b.day||b.day===clock.day;return !b.uncertainPeriod&&day&&(b.start==null&&b.end==null||b.start!=null&&b.end!=null&&(b.start===b.end||b.start<b.end&&clock.minute>=b.start&&clock.minute<b.end||b.start>b.end&&(clock.minute>=b.start||clock.minute<b.end)));}):[];
  var ranges=[];a.forEach(function(b){if(b.start==null||b.end==null)return;if(b.start===b.end)ranges.push([0,1440]);else if(b.start<b.end)ranges.push([b.start,b.end]);else ranges.push([0,b.end],[b.start,1440]);});ranges.sort(function(a,b){return a[0]-b[0];});var covered=0;ranges.forEach(function(r){if(r[0]<=covered)covered=Math.max(covered,r[1]);});var allDay=covered>=1440||a.every(function(b){return b.start==null&&b.end==null&&!b.uncertainPeriod;});
  if(!allDay&&(!clock||!hits.length))return null;
  flat=flat&&allDay;
  var exact=flat||hits.length===1,rate=flat?a[0].rate:hits.length===1?hits[0].rate:Math.max.apply(null,values);
  return {rate:rate,uom:t.uom||'kwh',fee:t.fee||0,peak:Math.max.apply(null,values),low:Math.min.apply(null,values),free:t.free===true,
   estimated:!exact||t.complete!==true,conservative:!exact,complete:t.complete===true&&(!restricted||!!clock)&&!unclear,zone:t.zone||null,blocks:a,extraFees:!!t.extraFees};
 }
 function offer(id,p,level,kw,blocks,opts){if(!p||!blocks.length)return null;return Object.assign({id:String(id),plug:p,level:level,kw:number(kw)||0,currency:'USD',uom:'kwh',fee:0,blocks:blocks,complete:true},opts||{});}
 function ea(j){if(!j||j.restricted||!j.coordinates)return [];var out=[];
  (j.evses||[]).forEach(function(e){(e.connectors||[]).forEach(function(c){var p=plug(c.standard),dc=p&&p!=='J1772';var bs=(j.pricing||[]).filter(function(b){return number(b.energy)!=null;});
   // Distinct power bands cannot be assigned using voltage*amperage. Reject rather than select a cheap band.
   var bands=new Set(bs.map(function(b){return b.minPower+'|'+b.maxPower;}));if(bands.size!==1)return;
   var fees=j.fixedFees||[],feeValues=fees.map(function(f){return number(f.fee);});if(feeValues.some(function(f){return f==null||f<0;})||new Set(feeValues).size>1)return;
   var blocks=bs.map(function(b){return block(b.energy,b.timePeriod);}).filter(Boolean),o=offer(e.id+'/'+c.id,p,dc?'dc_fast':'2',0,blocks,{fee:feeValues.length?feeValues[0]:0,complete:fees.length>0,idle:j.idleFee||null,zone:j.timeZone||j.timezone||null});if(o)out.push(o);
  });});return out;}
 function chargepoint(j){if(!j||j.accessRestriction&&j.accessRestriction!=='NONE')return [];var s=j.stationPrice||{};if(s.currencyCode!=='USD')return [];var out=[],ef=s.energyFee&&s.energyFee.fixedFee,free=s.free===true;
  if(!free&&(!ef||ef.unit!=='KWH'||number(ef.amount)==null))return [];
  var fee=number(s.serviceFee&&s.serviceFee.amount)||0,guest=number(s.guestFee&&s.guestFee.amount)||0;
  (j.portsInfo&&j.portsInfo.ports||[]).forEach(function(p){(p.connectorList||[]).forEach(function(c){var level=/^DC|L3/i.test(p.level)?'dc_fast':p.level==='L1'?'1':p.level==='L2'?'2':null;if(!level)return;var o=offer(j.deviceId+'/'+p.outletNumber+'/'+c.plugType,plug(c.plugType),level,p.powerRange&&p.powerRange.max,[{rate:free?0:+ef.amount}],{fee:fee,free:free,complete:!guest,extraFees:guest>0,zone:j.timeZone});if(o)out.push(o);});});return out;}
 function chargeway(st,j){if(!st||st.is_access_restricted||st.is_coming_soon||!j||j.station_id!==st.id||j.currency_code!=='USD'||String(j.unit).toLowerCase()!=='kwh')return [];
  var blocks=(j.blocks||[]).map(function(b){return block(b.rate,b.start_time&&b.end_time?b.start_time+'-'+b.end_time:'');}).filter(Boolean),out=[];
  (st.connectors||[]).forEach(function(c){var level=c.power_type==='DC'?'dc_fast':c.power_type==='AC'?+c.power<=2000?'1':'2':null;if(!level)return;var o=offer(c.id,plug(c.name),level,+c.power/1000,blocks,{zone:st.time_zone,complete:false,extraFees:true,updated:j.timestamps&&j.timestamps.updated_at});if(o)out.push(o);});return out;}
 function evgo(ch,j,zone){if(!j)return [];var out=[],map={1:'J1772',2:'CHADEMO',3:'J1772COMBO',5:'TESLA'};
  (j.connectorsPrice||[]).forEach(function(c){var p=map[c.vehicleConnectorId],bs=[];
   (j.touPricing||[]).forEach(function(b){if(!/kwh/i.test(b.priceUnit))return;(b.schedule||[]).forEach(function(s){var x=block(b.price,s);if(x&&x.start!=null)bs.push(x);});});
   if(!bs.length&&number(c.kwhFee)!=null)bs=[{rate:+c.kwhFee}];
   var text=String(c.altText||c.thirdPartyText||''),fee=/\$([\d.]+)\s+Session Fee/i.exec(text),max=number(j.maxSessionFee),level=ch.chargerType==='DC'?'dc_fast':ch.chargerType==='AC'?'2':null;
   var connectors=[];(ch.evses||[]).forEach(function(e){connectors=connectors.concat(e.connectors||[]);});
   var actual=connectors.filter(function(x){return plug(x.connectorType)===p;});if(!actual.length||!level)return;
   actual.forEach(function(x){var o=offer(x.altId,p,level,x.maxPower||ch.maxConnectorPower,bs,{zone:zone,fee:fee?+fee[1]:0,complete:!!fee&&max===+fee[1]&&!(+c.minuteFee>0),extraFees:+c.minuteFee>0});if(o)out.push(o);});
  });return out;}
 function select(offers,x,car,at){var allowed=root.AltFuel?root.AltFuel.compatiblePlugs(car,x.st.plugs):x.st.plugs||[],valid=(offers||[]).filter(function(o){return (o.level==='dc_fast')===!!x.dc&&allowed.indexOf(o.plug)>=0;});
  // Use an actual offer; never combine one port's price with another port's power or fees.
  return valid.map(function(o){return {offer:o,price:quote(o,at)};}).filter(function(x){return x.price&&(x.price.rate>0||x.price.free);}).sort(function(a,b){return Number(b.price.complete)-Number(a.price.complete)||b.offer.kw-a.offer.kw;})[0]||null;
 }
 function plugshare(j,networkId){if(!j||j.access!==1||j.coming_soon||j.access_restrictions&&j.access_restrictions.length)return [];var out=[];
  (j.stations||[]).filter(function(s){return +s.network_id===+networkId;}).forEach(function(s){(s.outlets||[]).forEach(function(c){
   var p=plug(c.connector_name)||({2:'J1772',3:'CHADEMO',13:'J1772COMBO',26:'TESLA'})[c.connector],level=c.power_type==='DC'||c.is_dc===true?'dc_fast':c.power_type==='AC'?+c.kilowatts<=2?'1':'2':null;if(!level)return;
   (c.prices||[]).forEach(function(t){if(t.currency!=='USD')return;var bs=[],fee=0,uncertain=false,hasDate=false;
    (t.elements||[]).forEach(function(e){var r=e.restrictions||{};hasDate=hasDate||!!(r.start_date||r.end_date);(e.price_components||[]).forEach(function(pc){
     if(pc.type==='ENERGY'){var b=block(pc.price,r.start_time&&r.end_time?r.start_time+'-'+r.end_time:'',{startDate:r.start_date||null,endDate:r.end_date||null,days:r.day_of_week&&r.day_of_week.length?r.day_of_week.map(function(d){return d.toLowerCase();}):null});if(b)bs.push(b);}
     else if(pc.type==='FLAT')fee+=Math.max(0,+pc.price||0);else if(pc.type!=='PARKING_TIME')uncertain=true;
    });});
    var text=String(s.cost_description||''),flat=/Fee:\s*\$([\d.]+)\s*Flat/i.exec(text);if(flat&&!fee)fee=+flat[1];
    // OCPI idle values in this source have known unit errors; never use them to synthesize fees.
    var chargingText=text.split(/Idle Fee|Parking/i)[0];
    var o=offer(c.id,p,level,c.kilowatts,bs,{fee:fee,complete:!uncertain&&(!/session|fee/i.test(chargingText)||!!flat||fee>0),extraFees:uncertain||/fee|tax|idle/i.test(text),updated:t.updated_at,zone:j.time_zone||null});if(o)out.push(o);
   });
   // A narrowly supported Energy section used by ChargePoint-backed Mercedes stalls.
   // Ignore parking/idle sections and ambiguous prose, never parse the location-wide summary.
   if(!(c.prices||[]).length&&/^Energy\s*\n/i.test(s.cost_description||'')){
    var energy=s.cost_description.split(/Parking|Idle/i)[0],rx=/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)\s+(\d*\.?\d+)\s+USD per kWh/gi,m,bs=[];
    while((m=rx.exec(energy))){var start=m[1].replace(/^00:00\s*AM$/i,'12:00 AM'),end=m[2].replace(/^00:00\s*AM$/i,'12:00 AM'),b=block(m[3],start+'-'+end);if(b&&b.start!=null)bs.push(b);}
    var o=offer(c.id,p,level,c.kilowatts,bs,{complete:!/session|activation|connection|minimum|maximum/i.test(s.cost_description),extraFees:/Parking|Idle/i.test(s.cost_description),zone:j.time_zone||null,updated:j.updated_at});if(o)out.push(o);
   }
  });});return out;
 }
 function sessionQuote(t,at,minutes,kwh){var q=quote(t,at);if(!q)return null;var hi=q.rate,changed=false;
  // Until billing lock-in is verified, a boundary-crossing session uses a labeled upper estimate.
  var probes=new Set([0,Math.max(0,minutes)]),clock=local(at,t.zone);
  if(clock)(t.blocks||[]).forEach(function(b){[b.start,b.end].forEach(function(m){if(m==null)return;for(var day=0;day<=Math.min(2,Math.ceil(minutes/1440));day++)[-60,0,60].forEach(function(dst){var dt=(m-clock.minute+1440)%1440+day*1440+dst;if(dt>=0&&dt<=minutes){probes.add(dt);probes.add(Math.min(minutes,dt+.01));}});});});
  for(var n of probes){var p=quote(t,+at+n*60000);if(!p)return null;if(p.rate!==q.rate)changed=true;hi=Math.max(hi,p.rate);}
  return Object.assign({},q,{rate:hi,cost:hi*Math.max(0,kwh)+(kwh>0?q.fee:0),estimated:q.estimated||changed,conservative:q.conservative||changed});
 }
 var api={plug:plug,minute:minute,period:period,quote:quote,sessionQuote:sessionQuote,select:select,ea:ea,chargepoint:chargepoint,chargeway:chargeway,evgo:evgo,plugshare:plugshare};api.workerSource='('+initEVTariffs.toString()+')(self);';root.EVTariffs=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
