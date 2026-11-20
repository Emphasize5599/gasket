/* Condition charts for Weather during rest, drawn with uPlot (MIT, assets/web/lib/uplot.min.js).
 * Behavior modeled on phone weather apps' hourly charts, written fresh here (no code copied):
 *  - one metric per chart, picked from a menu; temperature has Actual / Feels like;
 *  - smooth curves (monotone for UV), a soft gradient fill under lines, rounded gradient bars for chances;
 *  - the y scale breathes around the data, but zero-based quantities keep their floor and a minimum
 *    ceiling so a quiet stay looks quiet (UV on its 0/3/6/8/11 bands, chances on 0–100);
 *  - x labels on the local clock: every hour or two for short stays, every 6 h for a day,
 *    midnight (weekday, bold) and noon past that, with hairlines at local midnights;
 *  - a horizontal drag scrubs (vertical drags still scroll the page): the nearest hour is picked with a
 *    light haptic tick, a "lollipop" rule rises from the base to the value with a dot, and a white
 *    readout card floats above it, kept inside the chart; lifting the finger hides the card but keeps
 *    the hour selected for the rest of the page;
 *  - a summary row under the chart (arrival / low / high / average; UV: arrival / peak / at).
 * The pure helpers (domain, xTicks, summary, readout, available) run in Node for tests. */
(function(root){'use strict';
 var H=3600000;
 function fin(n){return typeof n==='number'&&Number.isFinite(n);}
 function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
 // Temperature colors (°F), cold → hot, for the temperature line.
 var TEMP=[[0,'#9ab8ff'],[32,'#78d0ff'],[50,'#7fe0c2'],[65,'#bfe98a'],[78,'#ffd36b'],[90,'#ff9f5a'],[105,'#ff6b6b']];
 var UVB=[[0,'#7be07b'],[3,'#ffe066'],[6,'#ffae5c'],[8,'#ff6b6b'],[11,'#c792ea']];
 function band(stops,v){var c=stops[0][1];for(var i=0;i<stops.length;i++)if(v>=stops[i][0])c=stops[i][1];return c;}
 function tempColor(f){return fin(f)?band(TEMP,f):'#fff';}
 function aqiColor(a){return band([[0,'#7be07b'],[51,'#ffe066'],[101,'#ffae5c'],[151,'#ff6b6b'],[201,'#c792ea'],[301,'#b05a7a']],a);}
 function uvName(u){return u<3?'Low':u<6?'Moderate':u<8?'High':u<11?'Very high':'Extreme';}
 function aqiName(a){return a<=50?'Good':a<=100?'Moderate':a<=150?'Unhealthy for sensitive groups':a<=200?'Unhealthy':a<=300?'Very unhealthy':'Hazardous';}
 function round(v){return Math.round(v);}
 var METRICS=[
  {id:'temp',label:'Temperature',title:'Hourly temperature',icon:'temp',style:'line',get:function(h){return h.temp;},alt:{label:'Feels like',get:function(h){return h.feels;}},fmt:function(v){return round(v)+'°';},accent:'#ffd36b'},
  {id:'pop',label:'Precipitation',title:'Chance of precipitation',icon:'drop',style:'bar',get:function(h){return h.pop;},fmt:function(v){return round(v)+'%';},floor:0,ceil:100,fixed:true,ticks:[0,50,100],accent:'#6fb8ff'},
  {id:'wind',label:'Wind',title:'Hourly wind',icon:'wind',style:'line',get:function(h){return h.wind;},gust:true,fmt:function(v){return round(v)+' mph';},floor:0,minCeil:10,accent:'#7fc4ff'},
  {id:'humidity',label:'Humidity',title:'Hourly humidity',icon:'humid',style:'line',get:function(h){return h.humidity;},fmt:function(v){return round(v)+'%';},floor:0,ceil:100,fixed:true,ticks:[0,50,100],accent:'#6fd3c4'},
  {id:'uv',label:'UV index',title:'Hourly UV index',icon:'sun',style:'line',monotone:true,get:function(h){return h.uv;},fmt:function(v){return String(round(v));},sub:uvName,floor:0,minCeil:11,ticks:[0,3,6,8,11],accent:'#f4d03f'},
  {id:'aqi',label:'Air quality',title:'Air quality (US AQI)',icon:'air',style:'bar',from:'air',get:function(h){return h.aqi;},fmt:function(v){return String(round(v));},sub:aqiName,floor:0,minCeil:100,ticks:[0,50,100,150,200,300],accent:'#7be07b',color:aqiColor},
  {id:'pollen',label:'Pollen',title:'Pollen',icon:'pollen',style:'pollen',from:'pollen'}
 ];
 function metric(id){return METRICS.find(function(m){return m.id===id;})||METRICS[0];}
 function rows(data,m){return m.from==='air'?data.air||[]:m.from==='pollen'?data.pollen||[]:data.hours||[];}
 function mid(h){return (h.at+(h.end||h.at+H))/2;}
 function available(data){return METRICS.filter(function(m){return m.style==='pollen'?(data.pollen||[]).length>0:rows(data,m).some(function(h){return fin(m.get(h));});});}
 function niceStep(span){var raw=span/4,p=Math.pow(10,Math.floor(Math.log10(raw||1))),f=raw/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;}
 // y range [lo, hi] and gridline values for the values shown.
 function domain(m,vals){vals=vals.filter(fin);var lo,hi;
  if(m.fixed){lo=m.floor;hi=m.ceil;}
  else if(m.floor!=null){lo=m.floor;hi=Math.max(m.minCeil||0,(vals.length?Math.max.apply(null,vals):0)*1.08,lo+1);}
  else{if(!vals.length)return {lo:0,hi:1,ticks:[0,1]};var a=Math.min.apply(null,vals),b=Math.max.apply(null,vals),pad=a===b?2:Math.max(2,(b-a)*.15);lo=a-pad;hi=b+pad;}
  var ticks=m.ticks?m.ticks.filter(function(t){return t>=lo&&t<=hi+1e-9;}):null;
  if(!ticks){var st=niceStep(hi-lo);ticks=[];for(var t=Math.ceil(lo/st)*st;t<=hi+1e-9;t+=st)ticks.push(+t.toFixed(6));}
  if(m.minCeil&&!m.ticks)hi=Math.max(hi,ticks[ticks.length-1]);
  return {lo:lo,hi:hi,ticks:ticks};}
 function parts(t,zone){var o={};try{new Intl.DateTimeFormat('en-US',{timeZone:zone||'UTC',hourCycle:'h23',hour:'2-digit',minute:'2-digit',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(t).forEach(function(p){o[p.type]=p.value;});}catch(e){}return {hour:+o.hour%24,minute:+o.minute,weekday:o.weekday,day:o.year+'-'+o.month+'-'+o.day};}
 function hourText(t,zone,clock24){var p=parts(t,zone);if(clock24)return String(p.hour).padStart(2,'0');var h=p.hour%12||12;return h+(p.hour<12?' AM':' PM');}
 // Local-clock x ticks: [{t, label, strong}] plus local midnights inside the stay.
 function xTicks(start,end,zone,clock24){var span=end-start,stride=span<=6*H?1:span<=12*H?2:span<=30*H?6:12,multi=span>30*H,out=[],days=[];
  for(var t=Math.ceil(start/H)*H;t<=end;t+=H){var p=parts(t,zone);if(p.minute!==0)continue;if(p.hour===0&&t>start)days.push(t);if(p.hour%stride)continue;
   var strong=multi&&p.hour===0;out.push({t:t,label:strong?p.weekday:hourText(t,zone,clock24),strong:strong});}
  return {ticks:out,days:days};}
 function avg(v){return v.reduce(function(a,b){return a+b;},0)/v.length;}
 function summary(data,m,zone,clock24){if(m.style==='pollen')return [];var list=rows(data,m).filter(function(h){return fin(m.get(h));}),v=list.map(m.get);if(!v.length)return [];
  if(m.id==='uv'){var pk=list.reduce(function(a,h){return m.get(h)>m.get(a)?h:a;});var out=[{label:'Arrive',value:m.fmt(v[0])}];if(m.get(pk)>=.5)out.push({label:'Peak',value:m.fmt(m.get(pk))},{label:'At',value:hourText(pk.at,zone,clock24)});return out;}
  if(m.id==='pop'){var p=Math.max.apply(null,v),q=(data.hours||[]).map(function(h){return h.qpf;});var s=[{label:'Peak',value:m.fmt(p)}];if(q.length&&q.every(fin)){var tot=q.reduce(function(a,b){return a+b;},0);s.push({label:'Total',value:tot<.005?'0 in':tot.toFixed(2)+' in'});}return s;}
  return [{label:'Arrive',value:m.fmt(v[0])},{label:'Low',value:m.fmt(Math.min.apply(null,v))},{label:'High',value:m.fmt(Math.max.apply(null,v))},{label:'Avg',value:m.fmt(avg(v))}];}
 // The floating card: big value, the hour, and one supporting detail.
 function readout(data,m,i,zone,clock24,mode){var list=rows(data,m),h=list[i];if(!h)return null;var multi=data.end-data.start>20*H,cap=(multi?parts(h.at,zone).weekday+' ':'')+hourText(h.at,zone,clock24);
  var feels=m.alt&&mode==='feels',v=feels?m.alt.get(h):m.get(h);if(!fin(v))return {value:'—',caption:cap,detail:''};
  var detail=m.id==='temp'?(feels?(fin(h.temp)?'Actual '+m.fmt(h.temp):''):(fin(h.feels)&&Math.abs(h.feels-h.temp)>=1?'Feels like '+m.fmt(h.feels):''))+(fin(h.pop)&&h.pop>=10?(fin(h.feels)||feels?' · ':'')+round(h.pop)+'% rain':''):
   m.id==='wind'?(fin(h.gust)?'Gusts '+m.fmt(h.gust):''):m.id==='pop'?(fin(h.qpf)&&h.qpf>=.01?h.qpf.toFixed(2)+' in':''):m.sub?m.sub(v):'';
  return {value:m.fmt(v),caption:cap,detail:detail.replace(/^ · /,'')};}
 function nearest(list,t){var best=-1,d=Infinity;list.forEach(function(h,i){var x=Math.abs(mid(h)-t);if(x<d){d=x;best=i;}});return best;}

 /* ---------- drawing (browser only) ---------- */
 var DPR=function(){return root.devicePixelRatio||1;};
 function lin(ctx,u,stops,scale,dir){var g;var b=u.bbox;if(dir==='v'){var y0=u.valToPos(stops[0][0],scale,true),y1=u.valToPos(stops[stops.length-1][0],scale,true);if(!(y1!==y0)){y0=b.top+b.height;y1=b.top;}g=ctx.createLinearGradient(0,y0,0,y1);stops.forEach(function(s){var o=(u.valToPos(s[0],scale,true)-y0)/(y1-y0);g.addColorStop(Math.min(1,Math.max(0,o)),s[1]);});}return g;}
 function fade(u,color,top,bottom){var b=u.bbox,g=u.ctx.createLinearGradient(0,b.top,0,b.top+b.height);g.addColorStop(0,hexA(color,top));g.addColorStop(1,hexA(color,bottom));return g;}
 function hexA(hex,a){var n=parseInt(hex.slice(1),16);return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+a+')';}
 function rr(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h);ctx.lineTo(x,y+h);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}

 // render(host, data, {metric, mode, zone, clock24, selected, onSelect, tick}) → {update(sel), destroy()}
 function render(host,data,o){var U=root.uPlot,m=metric(o.metric);host.innerHTML='';
  if(m.style==='pollen')return pollenView(host,data,o);
  var list=rows(data,m).filter(function(h){return h.at<data.end&&(h.end||h.at+H)>data.start;});
  if(!U||!list.some(function(h){return fin(m.get(h));})){host.innerHTML='<p class="rest-wx-chart-empty">No '+esc(m.label.toLowerCase())+' forecast for this stay.</p>';return {update:function(){},destroy:function(){}};}
  var feels=m.alt&&o.mode==='feels',main=list.map(function(h){var v=feels?m.alt.get(h):m.get(h);return fin(v)?v:null;}),second=m.alt?list.map(function(h){var v=feels?m.get(h):m.alt.get(h);return fin(v)?v:null;}):m.gust?list.map(function(h){return fin(h.gust)?h.gust:null;}):null;
  var dom=domain(m,main.concat(second||[])),xs=list.map(mid),xt=xTicks(data.start,data.end,o.zone,o.clock24),sel=o.selected,touching=false,height=o.height||184;
  var wrap=document.createElement('div');wrap.className='rest-wx-plot';host.appendChild(wrap);var card=document.createElement('div');card.className='rest-wx-pop';card.hidden=true;card.setAttribute('aria-hidden','true');host.appendChild(card);
  var lineColor=m.id==='temp'?function(u){return lin(u.ctx,u,TEMP,'y','v');}:m.id==='uv'?function(u){return lin(u.ctx,u,UVB,'y','v');}:m.accent;
  var series=[{}];
  if(m.style==='bar')series.push({stroke:'transparent',paths:U.paths.bars({size:[.62,14],radius:.25,gap:1}),fill:m.color?null:function(u){return fade(u,m.accent,1,.25);},points:{show:false}});
  else{series.push({stroke:lineColor,width:2.5,fill:function(u){return fade(u,m.id==='temp'?'#ffffff':m.accent,m.id==='temp'?.22:.35,.02);},paths:m.monotone?U.paths.spline({interp:'monotone'}):U.paths.spline(),points:{show:false},cap:'round'});
   if(second)series.push({stroke:'rgba(255,255,255,.5)',width:1.6,dash:[4,4],paths:U.paths.spline(),points:{show:false}});}
  var opts={width:Math.max(220,host.clientWidth||300),height:height,legend:{show:false},cursor:{show:false,drag:{x:false,y:false}},select:{show:false},padding:[16,20,0,0],
   scales:{x:{time:false,range:function(){return [data.start,data.end];}},y:{range:function(){return [dom.lo,dom.hi];}}},
   axes:[{stroke:'rgba(255,255,255,.62)',font:'11px system-ui, sans-serif',size:26,gap:4,grid:{stroke:'rgba(255,255,255,.07)',width:1},ticks:{show:false},splits:function(){return xt.ticks.map(function(t){return t.t;});},values:function(){return xt.ticks.map(function(t){return t.label;});}},
    {stroke:'rgba(255,255,255,.62)',font:'11px system-ui, sans-serif',size:38,gap:4,grid:{stroke:'rgba(255,255,255,.08)',width:1},ticks:{show:false},splits:function(){return dom.ticks;},values:function(u,v){return v.map(function(x){return m.id==='temp'?round(x)+'°':m.fixed||m.id==='pop'?round(x)+(m.id==='pop'||m.id==='humidity'?'%':''):String(+x.toFixed(1));});}}],
   series:series,
   hooks:{draw:[function(u){var c=u.ctx,b=u.bbox,r=DPR();c.save();c.setLineDash([]);
    // per-bar colors for AQI
    if(m.color)list.forEach(function(h,i){var v=main[i];if(v==null)return;var w=Math.max(3*r,Math.min(14*r,b.width/list.length*.62)),x=u.valToPos(xs[i],'x',true)-w/2,y=u.valToPos(Math.max(dom.lo,v),'y',true),base=u.valToPos(dom.lo,'y',true);c.fillStyle=m.color(v);rr(c,x,y,w,Math.max(1,base-y),3*r);c.fill();});
    // precipitation underlay on the temperature chart: capsules up to 40% of the height
    if(m.id==='temp')list.forEach(function(h,i){if(!fin(h.pop)||h.pop<=0)return;var w=6*r,x=u.valToPos(xs[i],'x',true)-w/2,base=b.top+b.height,hh=b.height*.4*h.pop/100,g=c.createLinearGradient(0,base,0,base-hh);g.addColorStop(0,'rgba(127,196,255,.45)');g.addColorStop(1,'rgba(127,196,255,0)');c.fillStyle=g;rr(c,x,base-hh,w,hh,w/2);c.fill();});
    // local midnights
    c.strokeStyle='rgba(255,255,255,.28)';c.lineWidth=.8*r;xt.days.forEach(function(t){var x=Math.round(u.valToPos(t,'x',true))+.5;c.beginPath();c.moveTo(x,b.top);c.lineTo(x,b.top+b.height);c.stroke();});
    // now, when the stay has begun
    var now=Date.now();if(now>data.start&&now<data.end){var nx=u.valToPos(now,'x',true);c.setLineDash([3*r,4*r]);c.strokeStyle='rgba(255,255,255,.7)';c.lineWidth=r;c.beginPath();c.moveTo(nx,b.top);c.lineTo(nx,b.top+b.height);c.stroke();c.setLineDash([]);}
    // lollipop at the selected hour
    if(sel>=0&&sel<list.length&&main[sel]!=null){var sx=u.valToPos(xs[sel],'x',true),sy=u.valToPos(main[sel],'y',true);c.strokeStyle='rgba(255,255,255,.75)';c.lineWidth=r;c.beginPath();c.moveTo(sx,b.top+b.height);c.lineTo(sx,sy);c.stroke();if(m.style!=='bar'){c.fillStyle='#fff';c.beginPath();c.arc(sx,sy,5*r,0,7);c.fill();}}
    c.restore();placeCard(u);}]}};
  var u=new U(opts,[xs,main].concat(second?[second]:[]),wrap);
  function placeCard(uu){uu=uu||u;if(!uu||!touching||sel<0||main[sel]==null){card.hidden=true;return;}var r=readout(data,m,sel,o.zone,o.clock24,o.mode);card.innerHTML='<strong>'+esc(r.value)+'</strong><small>'+esc(r.caption)+'</small>'+(r.detail?'<em>'+esc(r.detail)+'</em>':'');card.hidden=false;
   var x=uu.valToPos(xs[sel],'x')+uu.over.offsetLeft,y=uu.valToPos(main[sel],'y')+uu.over.offsetTop,w=card.offsetWidth,h=card.offsetHeight,W=host.clientWidth;card.style.left=Math.max(0,Math.min(W-w,x-w/2))+'px';card.style.top=Math.max(0,y-h-12)+'px';}
  // Scrubbing: horizontal drags pick hours; vertical drags are left to the page (touch-action: pan-y).
  var start=null,scrub=false;function pick(e){var rc=u.over.getBoundingClientRect(),t=u.posToVal(e.clientX-rc.left,'x'),i=nearest(list,t);if(i>=0&&i!==sel){sel=i;if(o.tick)o.tick();if(o.onSelect)o.onSelect(list[i]);u.redraw(false,false);}else placeCard();}
  u.over.style.touchAction='pan-y';
  u.over.addEventListener('pointerdown',function(e){start={x:e.clientX,y:e.clientY,id:e.pointerId};scrub=e.pointerType==='mouse';if(scrub){touching=true;try{u.over.setPointerCapture(e.pointerId);}catch(x){}pick(e);}});
  u.over.addEventListener('pointermove',function(e){if(!start)return;if(!scrub){var dx=Math.abs(e.clientX-start.x),dy=Math.abs(e.clientY-start.y);if(dx>6&&dx>dy){scrub=true;touching=true;try{u.over.setPointerCapture(e.pointerId);}catch(x){}}else if(dy>8){start=null;return;}else return;}pick(e);});
  function end(e){if(start&&!scrub&&e.type==='pointerup'){touching=true;pick(e);setTimeout(function(){touching=false;placeCard();},1200);}else{touching=false;placeCard();}start=null;scrub=false;}
  u.over.addEventListener('pointerup',end);u.over.addEventListener('pointercancel',end);
  host.tabIndex=0;host.setAttribute('role','img');host.setAttribute('aria-label',m.title+' during your stay. Use the left and right arrow keys to read each hour.');
  host.onkeydown=function(e){if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();var i=Math.max(0,Math.min(list.length-1,(sel<0?0:sel)+(e.key==='ArrowRight'?1:-1)));if(i!==sel){sel=i;touching=true;if(o.onSelect)o.onSelect(list[i]);u.redraw(false,false);}};
  host.onblur=function(){touching=false;placeCard();};
  var ro=root.ResizeObserver?new ResizeObserver(function(){var w=host.clientWidth;if(w&&Math.abs(w-u.width)>1)u.setSize({width:Math.max(220,w),height:height});}):null;if(ro)ro.observe(host);
  return {update:function(at){var i=nearest(list,at);if(i!==sel){sel=i;u.redraw(false,false);}},destroy:function(){if(ro)ro.disconnect();u.destroy();},plot:u,list:list};
 }
 function pollenView(host,data,o){var by=new Map();(data.pollen||[]).forEach(function(p){if(!by.has(p.name))by.set(p.name,[]);by.get(p.name).push(p);});var span=data.end-data.start;
  host.innerHTML='<div class="rest-wx-pollen">'+Array.from(by.keys()).map(function(name){return '<div class="rest-wx-prow"><span>'+esc(name)+'</span><div class="rest-wx-pbar">'+by.get(name).map(function(p){var a=Math.max(data.start,p.at),b=Math.min(data.end,p.end||p.at+86400000);if(b<=a)return '';var f=fin(p.value)&&p.max?p.value/p.max:0;return '<i style="left:'+((a-data.start)/span*100).toFixed(2)+'%;width:'+((b-a)/span*100).toFixed(2)+'%;background:'+band([[0,'#7be07b'],[.2,'#c8e66b'],[.4,'#ffe066'],[.6,'#ffae5c'],[.8,'#ff6b6b']],f)+';opacity:'+(.45+.55*f).toFixed(2)+'" title="'+esc(p.category||p.value)+'"><b>'+esc(p.category||'')+'</b></i>';}).join('')+'</div></div>';}).join('')+'</div><p class="rest-wx-legend">'+(Array.from(by.values())[0][0].daily?'Daily outlook':'12-hour outlook')+' · not an hourly measurement</p>';
  return {update:function(){},destroy:function(){}};}
 var api={METRICS:METRICS,metric:metric,available:available,domain:domain,xTicks:xTicks,summary:summary,readout:readout,nearest:nearest,tempColor:tempColor,render:render};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;root.RestWeatherChart=api;
})(typeof window!=='undefined'?window:globalThis);
