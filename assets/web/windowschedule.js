/* A visual itinerary drawn from the window planner’s exact inputs. */
(function(root){
 'use strict';
 var STEP=300000, MIN=60000, H=60*MIN, DAY=24*H;
 function up(t){return Math.ceil(t/STEP)*STEP;}
 function down(t){return Math.floor(t/STEP)*STEP;}
 function num(t,fallback){return Number.isFinite(t)?t:fallback;}
 function run(leg,start,rules){
  var at=start,parts=[];
  rules=TimeWindows.noLeaveRules(rules);
  function add(kind,minutes){if(minutes>0){parts.push({kind:kind,start:at,end:at+minutes*MIN});at+=minutes*MIN;}}
  while(rules.length&&at-start<DAY&&TimeWindows.noLeave(WindowClock.wall(at,leg.zone),rules))at+=STEP;
  var blocked=!!(rules.length&&TimeWindows.noLeave(WindowClock.wall(at,leg.zone),rules));
  if(at>start)parts.push({kind:'wait',start:start,end:at});
  var departure=at;
  leg.estimate(departure).forEach(function(p){add(p.kind,p.minutes);});
  at=up(at);
  return {start:start,departure:departure,end:at,parts:parts,blocked:blocked};
 }
 function fits(row,w,prev,next){
  return !row.blocked&&(!prev||prev.end<=row.start)&&(!next||row.end<next.departure&&row.end<=next.start)&&
   row.departure>num(w.ds,-Infinity)&&row.departure<=num(w.de,Infinity)&&row.end>=num(w.as,-Infinity)&&row.end<num(w.ae,Infinity)&&
   (!next||num(w.ae,row.end)<next.departure);
 }
 function place(leg,w,from,held,rules){
  var start=up(Math.max(from,num(w.ds,from-1)+1));
  if(Number.isFinite(held)&&held>=start){
   var saved=run(leg,held,rules);
   if(fits(saved,w,null,null))return saved;
  }
  var row=run(leg,start,rules);
  // A date supplied only as a latest departure still anchors the itinerary.
  if(!Number.isFinite(w.ds)&&Number.isFinite(w.de)&&down(w.de)>start){
   var near=run(leg,down(w.de),rules);
   if(fits(near,w,null,null))return near;
  }
  for(var tries=0;tries<4&&row.end<num(w.as,-Infinity);tries++){
   var later=run(leg,up(row.start+w.as-row.end),rules);
   if(later.departure>num(w.de,Infinity)||later.end>=num(w.ae,Infinity))break;
   row=later;
  }
  return row;
 }
 function issues(row,w,next,begin){
  var out=[];
  if(row.start<begin)out.push('starts in the past.');
  if(row.blocked)out.push('has no departure outside the hours you won’t leave.');
  if(w.ds>w.de)out.push('has an earliest departure after its latest departure.');
  if(w.as>w.ae)out.push('has an earliest arrival after its latest arrival.');
  if(row.departure<=num(w.ds,-Infinity))out.push('must start after its earliest departure.');
  if(row.departure>num(w.de,Infinity))out.push('starts after its latest departure.');
  if(row.end<num(w.as,-Infinity))out.push('ends before its earliest arrival.');
  if(row.end>=num(w.ae,Infinity))out.push('must end before its latest arrival.');
  if(next&&row.end>next.start)out.push('overlaps the next leg.');
  if(next&&Number.isFinite(w.ae)&&w.ae>=next.departure)out.push('has a latest arrival that reaches or passes the next leg’s departure.');
  return out;
 }
 function sessions(legs,options){
  var cap=options.capacity, reserve=Math.min(cap*.9,Math.max(0,options.reserve||0)),ev=options.kind==='ev',curve=options.curve,
      level=Math.min(cap,num(options.start,cap)),goal=options.priority==='time'?Math.max(.8,reserve/cap+.1):.95;
  return legs.map(function(leg){
   var rows=[],drive=0;
   leg.forEach(function(p){
    var used=Math.max(0,p.energy||0),elapsed=0;
    if(cap>0&&used>0&&(!ev||curve))while(used>Math.max(0,level-reserve)+.0001){
     var distance=Math.max(0,level-reserve),minutes=p.minutes*distance/p.energy;
     drive+=minutes;elapsed+=minutes;used-=distance;
     var target=ev?Math.min(cap,Math.max(cap*goal,Math.min(cap,reserve+used)*.85,reserve+cap*.05)):cap,
         buy=target-reserve,service;
     if(ev){
      service=0;
      var steps=Math.ceil(buy/cap*100);
      for(var i=0;i<steps;i++)service+=60*buy/steps/Math.min(options.maxKw||150,ChargeCurve.at(curve,(reserve+buy*(i+.5)/steps)/cap));
     }else service=Trip.serviceMinutes({c:{},buyGal:buy},options.kind);
     if(drive>0)rows.push({kind:'drive',minutes:drive});
     rows.push({kind:ev?'charge':'fuel',minutes:service+options.stopMinutes});
     drive=0;level=target;
    }
    level=Math.max(0,level-used);drive+=p.minutes-elapsed;
    if(p.rest){if(drive>0)rows.push({kind:'drive',minutes:drive});rows.push({kind:'rest',minutes:p.rest});drive=0;}
   });
   if(drive>0)rows.push({kind:'drive',minutes:drive});
   return rows;
  });
 }
 function restParts(parts,depart,leg,c,deadline){
  if(!c)return parts;
  var out=[],at=depart,notBefore=depart,restCount=0;
  parts.forEach(function(p,i){
   var left=p.minutes;
   if(p.kind==='rest'){
    out.push(p);at+=left*MIN;
    notBefore=at;
    return;
   }
   if(p.kind==='drive'){
    var remaining=parts.slice(i+1).reduce(function(n,q){return n+q.minutes*MIN;},0);
    while(left>0&&restCount<14){
     var w=Overnight.nextWindow(Math.max(at,notBefore),leg.zone,c,leg.point);
     if(!w)break;
     var rest=Math.min(w.arrivalEnd,w.end-w.preferred*MIN);
     if(at+left*MIN+remaining<=rest)break;
     notBefore=rest+MIN;
     if(rest<at||at+left*MIN<rest||rest<w.start||rest+w.preferred*MIN<w.leaveStart)break;
     if(at+left*MIN+remaining+w.preferred*MIN>=deadline)break;
     var drive=(rest-at)/MIN;
     if(drive>0)out.push({kind:'drive',minutes:drive});
     out.push({kind:'rest',minutes:w.preferred});restCount++;
     left-=drive;at=rest+w.preferred*MIN;
    }
   }
   if(left>0)out.push({kind:p.kind,minutes:left});
   at+=left*MIN;
  });
  return out;
 }
 function bind(host,o){
  var starts=o.starts.slice(),rows=[],windows=[],rules=[],drag=null,clock=o.zone,begin=up(o.now),
      short=host.clientWidth<480,frame=0,
      marks={ds:'Earliest departure',de:'Latest departure',as:'Earliest arrival',ae:'Latest arrival',start:'Move leg from start',end:'Move leg from end'},
      dateFmt=new Intl.DateTimeFormat([], {timeZone:clock,weekday:'short',month:'short',day:'numeric'}),
      timeFmt=new Intl.DateTimeFormat([], {timeZone:clock,hour:'numeric',minute:'2-digit',hour12:!o.clock24});
  function localRules(i){var w=windows[i];return i===0||Number.isFinite(w.ds)||Number.isFinite(w.de)?rules:[];}
  function refresh(){
   var current=o.legs.map(function(_,i){return o.read(i);}),firstChanged=current.findIndex(function(w,i){return windows[i]&&JSON.stringify(w)!==JSON.stringify(windows[i]);});
   if(firstChanged>=0)starts.length=Math.min(starts.length,firstChanged);
   windows=current;rows=[];rules=o.rules();
   o.legs.forEach(function(leg,i){
    var w=windows[i],from=i?rows[i-1].end+STEP:begin+STEP;
    rows.push(place(leg,w,from,starts[i],localRules(i)));
   });
   draw();
  }
  function edges(r,w,next){
   return {ds:num(w.ds,r.start-STEP),de:num(w.de,r.departure),as:num(w.as,r.end),ae:num(w.ae,next?Math.min(r.end+30*MIN,next.departure-STEP):r.end+30*MIN)};
  }
  function draw(){
   if(!rows.length)return;
   var values=rows.map(function(r,i){return edges(r,windows[i],rows[i+1]);}),days=new Set(),html='';
   function include(from,to){
    var a=Date.parse(WindowClock.wall(from,clock).slice(0,10)+'T00:00:00Z'),
        b=Date.parse(WindowClock.wall(to,clock).slice(0,10)+'T00:00:00Z');
    if(!Number.isFinite(a)||!Number.isFinite(b))return;
    days.add(a);days.add(b);
    for(var day=Math.min(a,b),last=Math.max(a,b);day<=last&&day<=Math.min(a,b)+14*DAY;day+=DAY)days.add(day);
   }
   rows.forEach(function(r,i){var w=values[i];include(r.start,r.end);include(w.ds,w.de);include(w.as,w.ae);});
   Array.from(days).sort(function(a,b){return a-b;}).forEach(function(day){
    var ymd=new Date(day).toISOString().slice(0,10),nextDay=new Date(day+DAY).toISOString().slice(0,10),
        a=Overnight.epoch(ymd,0,clock),b=Overnight.epoch(nextDay,0,clock),content='',count=short?4:2;
    if(!Number.isFinite(a)||!Number.isFinite(b))return;
    for(var k=0;k<count;k++)content+=strip(a+(b-a)*k/count,a+(b-a)*(k+1)/count,values,b);
    if(content)html+='<section class="ws-day"><h4>'+o.esc(dateFmt.format(a))+'</h4>'+content+'</section>';
   });
   host.innerHTML=html;
   o.onIssues(rows.flatMap(function(r,i){return issues(r,windows[i],rows[i+1],begin).map(function(text){return 'Leg '+(i+1)+' '+text;});}));
  }
  function strip(a,b,values,dayEnd){
   function pc(t){return 100*(t-a)/(b-a);}
   function bar(kind,start,end){
    if(end<=start||start>=b||end<=a)return '';
    return '<span aria-hidden="true" class="ws-bar ws-'+kind+'" style="left:'+pc(Math.max(a,start))+'%;right:'+(100-pc(Math.min(b,end)))+'%"></span>';
   }
   function handle(i,id,t){
    if(t<a||t>=b&&!(t===b&&b===dayEnd&&id==='end'))return '';
    return '<button type="button" class="ws-handle ws-h-'+id+'" style="left:'+pc(t)+'%" data-ws-leg="'+i+'" data-ws-edge="'+id+'" data-ws-at="'+t+'" aria-label="'+o.esc('Leg '+(i+1)+' · '+marks[id]+' · '+dateFmt.format(t)+' '+timeFmt.format(t))+'"></button>';
   }
   var windows='',itinerary='',handles='',names='',tick='';
   for(var j=0;j<4;j++){
    var t=a+(b-a)*j/4;
    tick+='<span style="left:'+pc(t)+'%">'+o.esc(timeFmt.format(t))+'</span>';
   }
   rows.forEach(function(r,i){
    var w=values[i],times=Object.values(w);if(Math.min(r.start,...times)>=b||Math.max(r.end,...times)<a)return;
    windows+=bar('departure'+(w.ds>w.de?' ws-reversed':''),Math.min(w.ds,w.de),Math.max(w.ds,w.de))+bar('arrival'+(w.as>w.ae?' ws-reversed':''),Math.min(w.as,w.ae),Math.max(w.as,w.ae));
    itinerary+=r.parts.map(function(p){return bar(p.kind,p.start,p.end);}).join('');
    handles+=Object.keys(w).map(function(key){return handle(i,key,w[key]);}).join('')+handle(i,'start',r.start)+handle(i,'end',r.end);
    var from=Math.max(a,r.start),to=Math.min(b,r.end);
    if(pc(to)-pc(from)>=12)names+='<b style="left:'+pc(from)+'%;right:'+(100-pc(to))+'%">Leg '+(i+1)+'</b>';
   });
   return windows||itinerary||handles?'<div class="ws-strip" data-ws-from="'+a+'" data-ws-to="'+b+'"><div class="ws-axis">'+tick+'</div><div class="ws-lane"><div class="ws-track">'+windows+itinerary+names+handles+'</div></div></div>':'';
  }
  function change(i,id,t){
   var w=windows[i],row=rows[i];
   if(id==='start'||id==='end'){
    var from=id==='end'?row.start+t-row.end:t;
    if(from===row.start)return true;
    starts[i]=from;
    rows[i]=run(o.legs[i],from,localRules(i));
   }else{
    if(w[id]===t)return true;
    if(!o.write(i,id,t))return false;
    windows[i]=o.read(i);
    starts[i]=row.start;
    rows[i]=run(o.legs[i],row.start,localRules(i));
   }
   draw();return true;
  }
  function position(i,id){var r=rows[i];return id==='start'||id==='end'?r[id]:edges(r,windows[i],rows[i+1])[id];}
  function button(e){return e.target.closest('[data-ws-edge]');}
  host.addEventListener('pointerdown',function(e){
   var b=button(e);if(!b||e.button!==0)return;
   var strip=b.closest('.ws-strip'),rect=strip.querySelector('.ws-track').getBoundingClientRect();
   drag={id:e.pointerId,i:+b.dataset.wsLeg,edge:b.dataset.wsEdge,x:e.clientX,y:e.clientY,at:position(+b.dataset.wsLeg,b.dataset.wsEdge),scale:(+strip.dataset.wsTo-+strip.dataset.wsFrom)/rect.width};
   host.setPointerCapture(e.pointerId);e.preventDefault();
  });
  function move(e){
   if(!drag||e.pointerId!==drag.id)return;
   var strip=Array.from(host.querySelectorAll('.ws-strip')).find(function(s){var r=s.getBoundingClientRect();return e.clientY>=r.top&&e.clientY<r.bottom;});
   var t=drag.at+(e.clientX-drag.x)*drag.scale;
   if(strip&&Math.abs(e.clientY-drag.y)>34){
    var rect=strip.querySelector('.ws-track').getBoundingClientRect();
    t=+strip.dataset.wsFrom+(e.clientX-rect.left)/rect.width*(+strip.dataset.wsTo-+strip.dataset.wsFrom);
   }
   change(drag.i,drag.edge,Math.round(t/STEP)*STEP);
  }
  host.addEventListener('pointermove',function(e){if(!drag)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(function(){move(e);});});
  host.addEventListener('pointerup',function(e){if(drag&&drag.id===e.pointerId){cancelAnimationFrame(frame);move(e);drag=null;}});
  host.addEventListener('lostpointercapture',function(){drag=null;});
  host.addEventListener('keydown',function(e){
   var b=button(e),sign={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[e.key];if(!b||!sign)return;
   var i=+b.dataset.wsLeg,id=b.dataset.wsEdge;e.preventDefault();
   if(change(i,id,Math.round(position(i,id)/STEP)*STEP+sign*STEP))host.querySelector('[data-ws-leg="'+i+'"][data-ws-edge="'+id+'"]')?.focus({preventScroll:true});
  });
  var observer=new ResizeObserver(function(){var narrow=host.clientWidth<480;if(narrow!==short){short=narrow;draw();}});
  observer.observe(host);refresh();
  return {refresh:refresh,starts:function(){return starts.slice();},close:function(){observer.disconnect();cancelAnimationFrame(frame);}};
 }
 var api={bind:bind,sessions:sessions,restParts:restParts,run:run,fits:fits,issues:issues,place:place,step:STEP};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WindowSchedule=api;
})(typeof window==='undefined'?globalThis:window);
