/* Stay-window weather. Point forecasts are shared; only overlapping hours reach the UI.
 * One primary and at most one fallback per data point (docs/WEATHER_SOURCES.md):
 * comfort US NWS → WU, elsewhere WU → AccuWeather; pollen WU → AccuWeather; air Open-Meteo/CAMS
 * hourly forecast, WU's current reading for the next 3 h when it's missing; alerts US NWS → WU, elsewhere WU.
 * WU's client key lives only in RestWeatherHttp.java. */
(function(root){'use strict';
 var H=3600000,TTL=45*60000;
 function num(v){if(v==null||v==='')return null;if(typeof v==='object')return num(v.Value!=null?v.Value:v.value);return Number.isFinite(+v)?+v:null;}
 function first(o,keys){for(var k of keys)if(o&&o[k]!=null)return o[k];return null;}
 function at(v){if(typeof v==='number')return v<1e11?v*1000:v;if(!v)return NaN;return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(v)?v:v+'Z');}
 function duration(s){var m=/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s||'');return m?(+m[1]||0)*86400000+(+m[2]||0)*H+(+m[3]||0)*60000+(+m[4]||0)*1000:NaN;}
 function intervals(v,convert){return (v&&v.values||[]).map(function(x){var s=String(x.validTime||'').split('/'),start=at(s[0]),n=num(x.value);return {at:start,end:start+duration(s[1]),value:n==null?null:convert?convert(n):n};}).filter(function(x){return Number.isFinite(x.at)&&x.end>x.at;});}
 function value(xs,t){var x=(xs||[]).find(function(x){return x.at<=t&&t<x.end;});return x?x.value:null;}
 function celsius(v){return v*9/5+32;}
 function gridSeries(p,k){var v=p&&p[k];return intervals(v,/degC|Cel/i.test(v&&v.uom||'')?celsius:null);}
 function nws(hourly,grid){var p=grid&&grid.properties||{},series={feels:gridSeries(p,'apparentTemperature'),humidity:gridSeries(p,'relativeHumidity'),dew:gridSeries(p,'dewpoint'),sky:gridSeries(p,'skyCover')};
  return (hourly&&hourly.properties&&hourly.properties.periods||[]).map(function(h){var t=at(h.startTime),wind=String(h.windSpeed||'').match(/[\d.]+/g),temp=num(h.temperature);return {at:t,end:at(h.endTime),temp:temp==null?null:h.temperatureUnit==='C'?celsius(temp):temp,feels:value(series.feels,t),humidity:value(series.humidity,t),dew:value(series.dew,t),cloud:value(series.sky,t),wind:wind?Math.max.apply(null,wind.map(Number)):null,pop:num(h.probabilityOfPrecipitation),uv:null,text:h.shortForecast||'',day:!!h.isDaytime,source:'National Weather Service'};}).filter(function(h){return Number.isFinite(h.at)&&h.end>h.at;});
 }
 function temperature(v){var n=num(v);return n==null?null:/^(C|celsius)$/i.test(v&&v.Unit||v&&v.unit||'')?celsius(n):n;}
 function speed(v){var n=num(v);return n==null?null:/km/i.test(v&&v.Unit||v&&v.unit||'')?n/1.609344:n;}
 function accu(data){var list=Array.isArray(data)?data:data&&first(data,['hourly','hourlyForecasts','HourlyForecasts','data'])||[];if(!Array.isArray(list))return [];
  return list.map(function(h){var t=at(first(h,['EpochDateTime','epochDateTime','epochDate','DateTime','dateTime','date'])),wind=first(h,['Wind','wind'])||{};return {at:t,end:t+H,temp:temperature(first(h,['Temperature','temperature'])),feels:temperature(first(h,['RealFeelTemperature','realFeelTemperature','realFeel'])),humidity:num(first(h,['RelativeHumidity','relativeHumidity','humidity'])),dew:temperature(first(h,['DewPoint','dewPoint','dewpoint'])),wind:speed(first(wind,['Speed','speed']))??speed(h.windSpeed),gust:speed(first(first(h,['WindGust','windGust']),['Speed','speed'])||first(h,['WindGust','windGust'])),pop:num(first(h,['PrecipitationProbability','precipitationProbability','precipitationChance'])),uv:num(first(h,['UVIndex','uvIndex'])),text:first(h,['IconPhrase','iconPhrase','condition','phrase'])||'',day:!!first(h,['IsDaylight','isDaylight']),source:'AccuWeather'};}).filter(function(h){return Number.isFinite(h.at);});
 }
 function pollen(data){var root0=data&&data.lifestyleIndices||data||{},xs=root0.Allergies||root0.allergies||[];return xs.filter(function(x){return /pollen|ragweed|mold/i.test(x.indexName||'')&&!/dust|dander/i.test(x.indexName||'');}).flatMap(function(x){return (x.days||[]).map(function(d){var t=at(first(d,['date','Date','dateTime','DateTime','epochDate']));return {at:t,end:t+86400000,name:x.indexName,value:num(first(d,['value','indexValue','Value'])),max:10,category:first(d,['category','indexCategory','Category'])||'',source:'AccuWeather',daily:true};});}).filter(function(x){return Number.isFinite(x.at);});}
 function cols(d){return d&&d.validTimeUtc?d:(d&&d.forecasts&&d.forecasts[0])||{};}
 function wu(data){var d=cols(data),t=d.validTimeUtc||[];return t.map(function(v,i){function c(k){return num((d[k]||[])[i]);}var at0=num(v)*1000;return {at:at0,end:at0+H,temp:c('temperature'),feels:c('temperatureFeelsLike'),humidity:c('relativeHumidity'),dew:c('temperatureDewPoint'),cloud:c('cloudCover'),wind:c('windSpeed'),gust:c('windGust'),pop:c('precipChance'),uv:c('uvIndex'),text:(d.wxPhraseLong||[])[i]||'',day:(d.dayOrNight||[])[i]==='D',source:'Weather Underground'};}).filter(function(h){return Number.isFinite(h.at);});}
 function wuPollen(data){var d=data&&data.pollenForecast12hour||{},out=[];(d.fcstValid||[]).forEach(function(v,i){var t=num(v)*1000;if(!Number.isFinite(t))return;[['tree','Tree pollen'],['grass','Grass pollen'],['ragweed','Ragweed pollen']].forEach(function(k){var n=num((d[k[0]+'PollenIndex']||[])[i]),cat=(d[k[0]+'PollenCategory']||[])[i]||'';if(n!=null||cat)out.push({at:t,end:t+12*H,name:k[1],value:n,max:5,category:cat,source:'Weather Underground'});});});return out;}
 function wuAlerts(data){return (data&&data.alerts||[]).map(function(a){return {name:a.eventDescription||'Weather alert',text:a.summaryHeadline||a.headlineText||'',start:at(a.onsetTimeLocal||a.effectiveTimeLocal),end:num(a.expireTimeUTC)!=null?num(a.expireTimeUTC)*1000:at(a.expireTimeLocal),source:a.source||'Weather Underground'};});}
 function wuAir(data,t){var g=data&&data.globalairquality;if(!g||num(g.airQualityIndex)==null)return [];var pm=g.pollutants&&g.pollutants['PM2.5'];return [{at:t,end:t+3*H,aqi:num(g.airQualityIndex),pm25:pm?num(pm.amount):null,category:g.airQualityCategory||'',current:true,source:'Weather Underground (current reading)'}];}
 function air(data){var h=data&&data.hourly||{};return (h.time||[]).map(function(t,i){return {at:at(t),end:at(t)+H,aqi:num((h.us_aqi||[])[i]),pm25:num((h.pm2_5||[])[i]),ozone:num((h.ozone||[])[i]),source:'Open-Meteo / Copernicus CAMS'};});}
 function crop(hours,start,end){return (hours||[]).filter(function(h){return h.at<end&&h.end>start;}).map(function(h){return Object.assign({},h,{at:Math.max(start,h.at),end:Math.min(end,h.end)});}).sort(function(a,b){return a.at-b.at;});}
 function coverage(hours,start,end){var until=start,ms=0;crop(hours,start,end).filter(function(h){return h.temp!=null;}).forEach(function(h){var a=Math.max(until,h.at);if(h.end>a)ms+=h.end-a;until=Math.max(until,h.end);});return Math.min(1,ms/(end-start));}
 function create(io){var now=io.now||Date.now,flights=new Map(),hot=new Map(),cool=new Map(),active=0,queue=[];
  async function slot(fn){if(active>=4)await new Promise(function(r){queue.push(r);});active++;try{return await fn();}finally{active--;var next=queue.shift();if(next)next();}}
  function json(r){if(!r||r.error||r.blocked||+r.status>=400){var e=Error(r&&r.error||'Weather source unavailable');e.status=r&&r.status;e.retryAfter=r&&r.retryAfter;throw e;}if(+r.status===204||r.body==='')return {};return typeof r.body==='string'?JSON.parse(r.body):r.body||r;}
  function cached(key,ttl,fn){var t=now(),held=hot.get(key)||io.get&&io.get(key,ttl);if(held&&held.at<=t&&t-held.at<ttl)return Promise.resolve(held.value);if(flights.has(key))return flights.get(key);var p=Promise.resolve().then(fn).then(function(v){var record={at:now(),value:v};hot.set(key,record);if(hot.size>128)hot.delete(hot.keys().next().value);if(io.put)io.put(key,record);return v;}).finally(function(){flights.delete(key);});flights.set(key,p);return p;}
  function request(provider,p,key){var group=/^wu/.test(provider)?'wu':'accu',until=cool.get(group)||0;if(until>now())return Promise.reject(Error('Weather source cooling down'));
   return slot(async function(){try{var r=await io.request(provider,p,key);if(provider==='resolve'&&r&&!r.error&&!r.blocked&&r.locationKey)return {locationKey:r.locationKey};return json(r);}catch(e){if([403,418,429].includes(+e.status))cool.set(group,now()+Math.max(900000,Math.min(86400000,(+e.retryAfter||0)*1000)));throw e;}});
  }
  async function load(point,valid,refresh){valid=valid||function(){return true;};var start=+point.start,end=+point.end;if(!Number.isFinite(point.lat)||!Number.isFinite(point.lng)||Math.abs(point.lat)>90||Math.abs(point.lng)>180||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>14*86400000)throw Error('Set a valid arrival and departure time first.');
   var p={lat:+point.lat.toFixed(3),lng:+point.lng.toFixed(3)},id=p.lat+','+p.lng,cc=String(point.country||io.country&&io.country(p)||'').toUpperCase();if(cc==='UNITED STATES'||cc==='USA')cc='US';if(cc==='CANADA')cc='CA';if(cc==='MEXICO')cc='MX';
   var notices=[],hours=[],aq=[],pol=[],alerts=[],sources=[],updated=now();
   function alive(){if(!valid())throw Error('Weather lookup cancelled');}
   async function fetchJson(url){alive();return json(await slot(function(){return io.fetch(url);}));}
   function source(s){if(!sources.includes(s))sources.push(s);}
   async function accuKey(){return cached('rest-wx-location|'+id,7*86400000,async function(){var r=await request('resolve',p);var k=r.locationKey||r.key||r.Key;if(!/^\d{1,12}$/.test(String(k||'')))throw Error('Weather location unavailable');return String(k);});}
   function forecast(key,ttl,fn){return cached(key,refresh?0:ttl,fn);}
   function merge(base,extra){var missing=extra.filter(function(h){return !base.some(function(x){return x.temp!=null&&x.at<=h.at&&x.end>=h.end;});});return base.filter(function(h){return h.temp!=null||!missing.some(function(x){return x.at<=h.at&&x.end>=h.end;});}).concat(missing);}
   async function wuHours(){var r=await forecast('rest-wx-wu|'+id,TTL,async function(){return wu(await request('wuhourly',p));});if(!r.length)throw Error('No hourly forecast');return r;}
   async function accuHours(){var k=await accuKey();var r=await forecast('rest-wx-accu|'+id,TTL,async function(){return accu(await request('hourly',p,k));});if(!r.length)throw Error('No hourly forecast');return r;}
   async function comfort(){
    var chain=cc==='US'?[['National Weather Service',nwsHours],['Weather Underground',wuHours]]:[['Weather Underground',wuHours],['AccuWeather',accuHours]];
    for(var i=0;i<chain.length;i++){if(i&&coverage(hours,start,end)>=.999)break;alive();try{hours=merge(hours,await chain[i][1]());source(chain[i][0]);}catch(e){notices.push(chain[i][0]+(i?' hourly forecast':'')+' unavailable.');}}
   }
   async function nwsHours(){return forecast('rest-wx-nws|'+id,TTL,async function(){var loc=await fetchJson('https://api.weather.gov/points/'+id),urls=loc.properties||{};if(!urls.forecastHourly||!urls.forecastGridData)throw Error('Forecast grid unavailable');var values=await Promise.all([fetchJson(urls.forecastHourly),fetchJson(urls.forecastGridData).catch(function(){return null;})]);return nws(values[0],values[1]);});}
   async function airQuality(){try{aq=await forecast('rest-wx-air|'+id,TTL,async function(){return air(await fetchJson('https://air-quality-api.open-meteo.com/v1/air-quality?latitude='+p.lat+'&longitude='+p.lng+'&hourly=us_aqi,pm2_5,ozone&timezone=GMT&forecast_days=7'));});source('Open-Meteo / Copernicus CAMS');}catch(e){notices.push('Air-quality forecast unavailable.');}
    var t=now(),soon=Math.min(end,t+3*H);if(start<soon&&!aq.some(function(x){return x.aqi!=null&&x.end>Math.max(start,t)&&x.at<soon;})){alive();try{var cur=await forecast('rest-wx-wuair|'+id,15*60000,async function(){return wuAir(await request('wuair',p),now());});if(cur.length){aq=aq.filter(function(x){return x.aqi!=null;}).concat(cur);source('Weather Underground');}}catch(e){}}}
   function pollenIn(xs){return xs.filter(function(x){return x.at<end&&(x.end||x.at+86400000)>start;});}
   async function pollens(){try{pol=pollenIn(await forecast('rest-wx-wupollen|'+id,TTL,async function(){return wuPollen(await request('wupollen',p));}));if(pol.length)source('Weather Underground');}catch(e){}
    if(!pol.length)try{var k=await accuKey();alive();pol=pollenIn(await forecast('rest-wx-pollen|'+id,TTL,async function(){return pollen(await request('pollen',p,k));}));if(pol.length)source('AccuWeather');}catch(e){}
    if(!pol.length)notices.push('Pollen forecast unavailable for this stay.');}
   async function warnings(){function keep(xs){return xs.filter(function(x){return (!Number.isFinite(x.start)||x.start<end)&&(!Number.isFinite(x.end)||x.end>start);});}
    if(cc==='US')try{var r=await forecast('rest-wx-alerts|'+id,10*60000,function(){return fetchJson('https://api.weather.gov/alerts/active?point='+id);});alerts=keep((r.features||[]).map(function(x){var p=x.properties||{};return {name:p.event||'Weather alert',text:p.headline||p.description||'',start:at(p.onset||p.effective),end:at(p.ends||p.expires),source:'National Weather Service'};}));source('National Weather Service');return;}catch(e){}
    try{alerts=keep(wuAlerts(await forecast('rest-wx-wualerts|'+id,10*60000,async function(){return request('wualerts',p);})));source('Weather Underground');}catch(e){notices.push('Weather alerts could not be checked.');}}
   await Promise.all([comfort(),airQuality(),pollens(),warnings()]);alive();var fraction=coverage(hours,start,end);if(fraction<.999)notices.unshift(fraction?'Forecast covers only part of this stay.':'No temperature forecast is available for this stay.');
   var zone=point.zone;
   return {start:start,end:end,zone:zone,country:cc,hours:crop(hours,start,end),air:crop(aq,start,end),pollen:pol,alerts:alerts,sources:sources,notices:Array.from(new Set(notices)),coverage:fraction,updatedAt:updated};
  }
  return {load:load,clear:function(){hot.clear();cool.clear();}};
 }
 var api={create:create,nws:nws,accu:accu,wu:wu,wuPollen:wuPollen,wuAlerts:wuAlerts,wuAir:wuAir,pollen:pollen,air:air,crop:crop,coverage:coverage};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.RestWeather=api;
})(typeof window!=='undefined'?window:globalThis);
