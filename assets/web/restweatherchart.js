/* Condition charts for Weather during rest: one metric at a time over the stay, with a marker on the
 * selected hour that can be dragged. Original SVG drawing in the style of a phone weather app's
 * condition charts (no third-party chart code). chart() is pure and runs in Node for tests. */
(function(root){'use strict';
 var H=3600000;
 function fin(n){return typeof n==='number'&&Number.isFinite(n);}
 function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
 // Temperature colors (°F) for the line gradient, cold → hot.
 var TEMP=[[0,'#8fb3ff'],[32,'#6fd3ff'],[50,'#7fe0c2'],[65,'#b8e986'],[78,'#ffd36b'],[90,'#ff9f5a'],[105,'#ff6b6b']];
 function tempColor(f){if(!fin(f))return '#fff';for(var i=1;i<TEMP.length;i++)if(f<=TEMP[i][0])return f-TEMP[i-1][0]<TEMP[i][0]-f?TEMP[i-1][1]:TEMP[i][1];return TEMP[TEMP.length-1][1];}
 function aqiColor(a){return a<=50?'#7be07b':a<=100?'#ffe066':a<=150?'#ffae5c':a<=200?'#ff6b6b':a<=300?'#c792ea':'#b05a7a';}
 function uvColor(u){return u<3?'#7be07b':u<6?'#ffe066':u<8?'#ffae5c':u<11?'#ff6b6b':'#c792ea';}
 function pollenColor(f){return f<.2?'#7be07b':f<.4?'#c8e66b':f<.6?'#ffe066':f<.8?'#ffae5c':'#ff6b6b';}
 var METRICS=[
  {id:'temp',label:'Temperature',unit:'°',type:'line',get:function(h){return h.temp;},second:{label:'Feels like',get:function(h){return h.feels;}},color:tempColor},
  {id:'pop',label:'Precipitation',unit:'%',type:'bar',get:function(h){return h.pop;},min:0,max:100,color:function(){return '#7cc4ff';}},
  {id:'wind',label:'Wind',unit:' mph',type:'line',get:function(h){return h.wind;},second:{label:'Gusts',get:function(h){return h.gust;}},min:0,color:function(){return '#d9e8ff';}},
  {id:'humidity',label:'Humidity',unit:'%',type:'area',get:function(h){return h.humidity;},min:0,max:100,color:function(){return '#9fd8ff';}},
  {id:'uv',label:'UV index',unit:'',type:'bar',get:function(h){return h.uv;},min:0,max:11,color:uvColor},
  {id:'aqi',label:'Air quality',unit:' AQI',type:'bar',from:'air',get:function(h){return h.aqi;},min:0,color:aqiColor},
  {id:'pollen',label:'Pollen',unit:'',type:'pollen',from:'pollen'}
 ];
 function nice(lo,hi,m){if(m.min!=null)lo=Math.min(lo,m.min);if(m.max!=null)hi=Math.max(hi,m.max);if(m.max==null){var pad=Math.max(2,(hi-lo)*.15);hi+=pad;if(m.min==null)lo-=pad;}if(hi-lo<1)hi=lo+1;var step=[1,2,5,10,20,25,50,100].find(function(s){return (hi-lo)/s<=4;})||100;return {lo:Math.floor(lo/step)*step,hi:Math.ceil(hi/step)*step,step:step};}
 function series(data,m){
  if(m.type==='pollen'){var by=new Map();(data.pollen||[]).forEach(function(p){if(!by.has(p.name))by.set(p.name,[]);by.get(p.name).push(p);});return by;}
  var list=m.from==='air'?data.air||[]:data.hours||[];return list.map(function(h){return {at:h.at,end:h.end||h.at+H,v:m.get(h),v2:m.second?m.second.get(h):null};});
 }
 function available(data){return METRICS.filter(function(m){var s=series(data,m);if(m.type==='pollen')return s.size>0;return s.filter(function(x){return fin(x.v);}).length>=1;});}
 // opts: {width, height, metric, selectedAt, time(t)->label}
 function chart(data,opts){
  var m=METRICS.find(function(x){return x.id===opts.metric;})||METRICS[0],W=Math.max(220,Math.round(opts.width||320)),Ht=opts.height||170,padL=6,padR=34,padT=12,padB=24,iw=W-padL-padR,ih=Ht-padT-padB;
  var start=+data.start,end=+data.end,span=Math.max(1,end-start);
  function x(t){return padL+(Math.min(end,Math.max(start,t))-start)/span*iw;}
  var out=['<svg class="rest-wx-chart-svg" viewBox="0 0 '+W+' '+Ht+'" width="100%" height="'+Ht+'" role="img" aria-label="'+esc(m.label)+' during your stay">'];
  var ticks=[],hours=Math.ceil(span/H),every=hours<=6?1:hours<=12?2:hours<=24?4:hours<=72?12:24,first=Math.ceil(start/H)*H;
  for(var t=first;t<=end;t+=H){var k=Math.round((t-first)/H);if(k%every===0)ticks.push(t);}
  if(m.type==='pollen'){
   var s=series(data,m),rows=Array.from(s.keys()),rowH=ih/Math.max(1,rows.length);
   rows.forEach(function(name,r){var y=padT+r*rowH;out.push('<text class="wx-ylab" x="'+(padL+2)+'" y="'+(y+11)+'">'+esc(name)+'</text>');
    s.get(name).forEach(function(p){var a=x(p.at),b=x(p.end||p.at+12*H),f=fin(p.value)&&p.max?p.value/p.max:0;if(b<=a)return;out.push('<rect class="wx-bar" x="'+(a+1).toFixed(1)+'" y="'+(y+15).toFixed(1)+'" width="'+Math.max(2,b-a-2).toFixed(1)+'" height="'+Math.max(4,rowH-20).toFixed(1)+'" rx="4" fill="'+pollenColor(f)+'" fill-opacity="'+(.35+.65*f).toFixed(2)+'"><title>'+esc(name+': '+(p.category||p.value))+'</title></rect>');});});
  }else{
   var pts=series(data,m),vals=[];pts.forEach(function(p){if(fin(p.v))vals.push(p.v);if(fin(p.v2))vals.push(p.v2);});
   if(!vals.length){out.push('<text class="wx-empty" x="'+(W/2)+'" y="'+(Ht/2)+'" text-anchor="middle">No '+esc(m.label.toLowerCase())+' forecast for this stay</text></svg>');return {svg:out.join(''),metric:m,x:x,pad:[padL,padR]};}
   var sc=nice(Math.min.apply(null,vals),Math.max.apply(null,vals),m);function y(v){return padT+ih-(v-sc.lo)/(sc.hi-sc.lo)*ih;}
   for(var g=sc.lo;g<=sc.hi+1e-9;g+=sc.step)out.push('<line class="wx-grid" x1="'+padL+'" x2="'+(padL+iw)+'" y1="'+y(g).toFixed(1)+'" y2="'+y(g).toFixed(1)+'"/><text class="wx-ylab" x="'+(W-padR+5)+'" y="'+(y(g)+4).toFixed(1)+'">'+g+(m.unit==='°'?'°':'')+'</text>');
   var mid=function(p){return x((p.at+Math.min(end,p.end))/2);};
   if(m.type==='bar'){var bw=Math.max(3,Math.min(26,iw/Math.max(1,pts.length)-3));pts.forEach(function(p){if(!fin(p.v))return;var cx=mid(p),top=y(Math.max(sc.lo,p.v));out.push('<rect class="wx-bar" x="'+(cx-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(1,y(sc.lo)-top).toFixed(1)+'" rx="3" fill="'+m.color(p.v)+'"/>');});}
   else{
    var id='wxg'+m.id+(opts.uid||''),line=function(get){var d='',open=false;pts.forEach(function(p){var v=get(p);if(!fin(v)){open=false;return;}d+=(open?'L':'M')+mid(p).toFixed(1)+' '+y(v).toFixed(1);open=true;});return d;};
    if(m.id==='temp'){out.push('<defs><linearGradient id="'+id+'" x1="0" y1="'+y(sc.lo)+'" x2="0" y2="'+y(sc.hi)+'" gradientUnits="userSpaceOnUse">');TEMP.forEach(function(c){var o=(c[0]-sc.lo)/(sc.hi-sc.lo);out.push('<stop offset="'+Math.min(1,Math.max(0,o)).toFixed(3)+'" stop-color="'+c[1]+'"/>');});out.push('</linearGradient></defs>');}
    var main=line(function(p){return p.v;}),stroke=m.id==='temp'?'url(#'+id+')':m.color();
    if(m.type==='area'&&main){var real=pts.filter(function(p){return fin(p.v);});out.push('<path class="wx-area" d="'+main+'L'+mid(real[real.length-1]).toFixed(1)+' '+y(sc.lo).toFixed(1)+'L'+mid(real[0]).toFixed(1)+' '+y(sc.lo).toFixed(1)+'Z" fill="'+stroke+'"/>');}
    if(m.second){var sec=line(function(p){return p.v2;});if(sec)out.push('<path class="wx-line wx-line2" d="'+sec+'"/>');}
    out.push('<path class="wx-line" d="'+main+'" stroke="'+stroke+'"/>');
    pts.forEach(function(p){if(fin(p.v)&&pts.filter(function(q){return fin(q.v);}).length===1)out.push('<circle class="wx-dot" cx="'+mid(p).toFixed(1)+'" cy="'+y(p.v).toFixed(1)+'" r="4" fill="'+stroke+'"/>');});
   }
   var hi=pts.filter(function(p){return fin(p.v);}).reduce(function(a,p){return !a||p.v>a.v?p:a;},null),lo=pts.filter(function(p){return fin(p.v);}).reduce(function(a,p){return !a||p.v<a.v?p:a;},null);
   if(hi&&lo&&hi!==lo&&m.id==='temp'){out.push('<text class="wx-mark" x="'+mid(hi).toFixed(1)+'" y="'+(y(hi.v)-7).toFixed(1)+'" text-anchor="middle">H</text><text class="wx-mark" x="'+mid(lo).toFixed(1)+'" y="'+(y(lo.v)+15).toFixed(1)+'" text-anchor="middle">L</text>');}
  }
  ticks.forEach(function(t){out.push('<line class="wx-tick" x1="'+x(t).toFixed(1)+'" x2="'+x(t).toFixed(1)+'" y1="'+padT+'" y2="'+(padT+ih)+'"/><text class="wx-xlab" x="'+x(t).toFixed(1)+'" y="'+(Ht-6)+'" text-anchor="middle">'+esc(opts.time?opts.time(t):new Date(t).toISOString().slice(11,13))+'</text>');});
  if(fin(opts.selectedAt))out.push('<line class="wx-cursor" data-wx-cursor x1="'+x(opts.selectedAt).toFixed(1)+'" x2="'+x(opts.selectedAt).toFixed(1)+'" y1="'+(padT-4)+'" y2="'+(padT+ih)+'"/>');
  out.push('</svg>');return {svg:out.join(''),metric:m,x:x,pad:[padL,padR],width:W};
 }
 // Value shown above the chart for the selected time.
 function readout(data,metricId,t){var m=METRICS.find(function(x){return x.id===metricId;})||METRICS[0];
  if(m.type==='pollen'){var ps=(data.pollen||[]).filter(function(p){return p.at<=t&&t<(p.end||p.at+86400000);});return ps.length?ps.map(function(p){return p.name.replace(/ pollen$/i,'')+' '+(p.category||p.value);}).join(' · '):'No pollen forecast';}
  var list=m.from==='air'?data.air||[]:data.hours||[],h=list.find(function(x){return x.at<=t&&t<(x.end||x.at+H);});if(!h||!fin(m.get(h)))return 'No forecast';
  var s=Math.round(m.get(h))+m.unit;if(m.second&&fin(m.second.get(h)))s+=' · '+m.second.label.toLowerCase()+' '+Math.round(m.second.get(h))+m.unit;if(m.id==='aqi'&&h.current)s+=' (now)';return s;}
 var api={METRICS:METRICS,chart:chart,readout:readout,available:available,tempColor:tempColor};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;root.RestWeatherChart=api;
})(typeof window!=='undefined'?window:globalThis);
