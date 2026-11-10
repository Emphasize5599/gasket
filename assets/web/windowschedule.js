/* A visual itinerary drawn from the window planner’s exact inputs. */
(function(root){
 'use strict';
 var MIN=60000, STEP=5*MIN, HANDLE_STEP=15*MIN, H=60*MIN, DAY=24*H;
 var OPPOSITE={ds:'de',de:'ds',as:'ae',ae:'as'};
 // 0.0.454: civil dawn begins, sunrise ends, sunset begins, civil dusk ends (SunCalc's names), drawn as small icons.
 var SUN_KINDS=['dawn','sunriseEnd','sunsetStart','dusk'],
     SUN_NAMES={dawn:'Dawn begins',sunriseEnd:'Sunrise ends',sunsetStart:'Sunset begins',dusk:'Dusk ends'};
 function sunIcon(kind){
  var up=kind==='dawn'||kind==='sunriseEnd',full=kind==='sunriseEnd'||kind==='sunsetStart',
      arrow=up?'<path d="M8 1.5v4.5M6.2 3.3 8 1.5l1.8 1.8"/>':'<path d="M8 1.5V6M6.2 4.2 8 6l1.8-1.8"/>',
      sun=full?'<path d="M4.6 12a3.4 3.4 0 0 1 6.8 0z" fill="currentColor"/>':'<path d="M4.6 12a3.4 3.4 0 0 1 6.8 0" stroke-dasharray="1.4 1.3"/>';
  return '<svg class="ws-sun-icon ws-sun-'+kind+'" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'+sun+arrow+'<path d="M1.5 12.5h13"/></svg>';
 }
 function up(t){return Math.ceil(t/STEP)*STEP;}
 function down(t){return Math.floor(t/STEP)*STEP;}
 function num(t,fallback){return Number.isFinite(t)?t:fallback;}
 function run(leg,start,rules){
  var at=start,parts=[];
  rules=TimeWindows.noLeaveRules(rules);
  function add(p){if(p.minutes>0||p.toggleNight){parts.push({kind:p.kind,start:at,end:at+p.minutes*MIN,night:p.night,toggleNight:p.toggleNight,until:p.until==null?null:at+p.until*MIN,shifted:p.shifted,shortened:p.shortened,why:p.why});at+=p.minutes*MIN;}}
  var keys=new Set(),excluded=new Set(leg.skippedWaits?leg.skippedWaits():[]);
  function blockedRules(){
   return rules.length?TimeWindows.noLeaveOccurrences(WindowClock.wall(at,leg.zone),rules).filter(function(rule){return !excluded.has(rule.key);}):[];
  }
  var matches=blockedRules();
  while(matches.length&&at-start<DAY){
   matches.forEach(function(rule){keys.add(rule.key);});
   at+=STEP;matches=blockedRules();
  }
  var blocked=matches.length>0;
  if(at>start)parts.push({kind:'wait',start:start,end:at,waitKeys:Array.from(keys)});
  var departure=at;
  leg.estimate(departure).forEach(add);
  at=up(at);
  // A night whose rest no longer fits (a stop ran past the latest rest departure) is shown red until the user drives through it.
  parts.forEach(function(p){if(p.kind==='norest')p.until=Math.min(p.until,at);});
  return {start:start,departure:departure,end:at,parts:parts,blocked:blocked,missed:parts.filter(function(p){return p.kind==='norest';}).map(function(p){return {night:p.night,why:p.why||'stop'};})};
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
 var MISSED={
  stop:'a fuel or charging stop runs past your latest rest departure',
  deadline:'resting would make you miss your latest arrival',
  depart:'it leaves during your nightly rest hours'
 };
 function missedText(m){return 'has no room to rest on the night of '+m.night+': '+(MISSED[m.why]||MISSED.stop)+'. Tap Drive through for that night, or drag the leg or change your windows or nightly hours.';}
 function issues(row,w,next,begin){
  var out=[];
  if(row.start<begin)out.push('starts in the past.');
  if(row.blocked)out.push('has no departure outside the hours you won’t leave.');
  (row.missed||[]).forEach(function(m){out.push(missedText(m));});
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
    if(p.rest){if(drive>0)rows.push({kind:'drive',minutes:drive});rows.push({kind:'rest',minutes:p.rest,night:p.restNight});drive=0;}
   });
   if(drive>0)rows.push({kind:'drive',minutes:drive});
   return rows;
  });
 }
 function restParts(parts,depart,leg,c,deadline,skipped){
  if(!c)return parts;
  var out=[],at=depart,notBefore=depart,nights=0,skip=new Set(skipped||[]),lastStop=null,
      selected=new Set(parts.filter(function(p){return p.kind==='rest'&&p.night;}).map(function(p){return p.night;}));
  // Rest at `at` for this night: the preferred length, moved later if needed and shortened to
  // the latest rest departure and the latest arrival. Less than the minimum = no rest (shown red).
  function settle(w,after,why){
   if(skip.has(w.date)){out.push({kind:'skip-rest',minutes:0,night:w.date,toggleNight:true});return;}
   var planned=Math.min(w.arrivalEnd,w.end-w.preferred*MIN),room=(w.end-at)/MIN,stay=Math.min(w.preferred,room);
   if(at+stay*MIN<w.leaveStart)stay=Math.min(room,(w.leaveStart-at)/MIN);
   var fits=(deadline-STEP-at-after)/MIN;
   if(why!=='depart'&&Math.min(stay,fits)>=w.minimum){
    stay=Math.min(stay,fits);
    out.push({kind:'rest',minutes:stay,night:w.date,toggleNight:true,shifted:at>planned+MIN||undefined,shortened:stay<w.preferred||undefined});
    at+=stay*MIN;return;
   }
   if(why!=='depart'&&stay>=w.minimum)why='deadline';else if(why==='deadline')why='stop';
   out.push({kind:'norest',minutes:0,night:w.date,toggleNight:true,until:Math.max(0,(w.end-at)/MIN),why:why});
  }
  parts.forEach(function(p,i){
   var left=p.minutes;
   if(p.kind==='rest'){
    out.push(p);at+=left*MIN;
    notBefore=Math.max(notBefore,at);
    return;
   }
   if(p.kind==='drive'){
    var remaining=parts.slice(i+1).reduce(function(n,q){return n+q.minutes*MIN;},0);
    // A fuel or charging stop was still going at this night's rest time: rest once it ends.
    if(lastStop&&nights<14){
     var w0=Overnight.nextWindow(Math.max(lastStop.start,notBefore),leg.zone,c,leg.point),
         planned=w0&&Math.min(w0.arrivalEnd,w0.end-w0.preferred*MIN);
     if(w0&&planned>=lastStop.start&&planned<at&&planned>=w0.start&&!selected.has(w0.date)&&at<w0.end){
      nights++;notBefore=Math.max(notBefore,Math.min(w0.arrivalEnd,w0.end-w0.minimum*MIN)+1,at+1);
      settle(w0,left*MIN+remaining,'stop');
     }
    }
    lastStop=null;
    while(left>0&&nights<14){
     var w=Overnight.nextWindow(Math.max(at,notBefore),leg.zone,c,leg.point);
     if(!w)break;
     var rest=Math.min(w.arrivalEnd,w.end-w.preferred*MIN);
     if(at+left*MIN+remaining<=rest||at+left*MIN<rest)break;
     notBefore=Math.max(notBefore,Math.min(w.arrivalEnd,w.end-w.minimum*MIN)+1);nights++;
     if(rest<w.start||rest+w.preferred*MIN<w.leaveStart||selected.has(w.date))continue;
     if(rest<at||rest===at&&at===depart){
      // Leaving during this night's rest hours: no rest before it ends unless the leg is over by then.
      if(at+left*MIN+remaining<=w.end-w.minimum*MIN)continue;
      settle(w,left*MIN+remaining,out.length?'stop':'depart');
      continue;
     }
     var drive=(rest-at)/MIN;
     if(drive>0)out.push({kind:'drive',minutes:drive});
     left-=drive;at=rest;
     settle(w,left*MIN+remaining,'deadline');
    }
   }
   if(left>0)out.push({kind:p.kind,minutes:left});
   if(p.kind!=='drive'&&left>0)lastStop={start:at,end:at+left*MIN};
   at+=left*MIN;
  });
  return out;
 }
 function bind(host,o){
  var starts=o.starts.slice(),rows=[],windows=[],rules=[],drag=null,layout=[],building=null,scroller=null,drawn='',clock=o.zone,begin=up(o.now),
      width=host.clientWidth,frame=0,
      marks={ds:'Earliest departure',de:'Latest departure',as:'Earliest arrival',ae:'Latest arrival',start:'Move leg from start',end:'Move leg from end'},
      dateFmt=new Intl.DateTimeFormat([], {timeZone:clock,weekday:'short',month:'short',day:'numeric'}),
      timeFmt=new Intl.DateTimeFormat([], {timeZone:clock,hour:'numeric',minute:'2-digit',hour12:!o.clock24}),
      hourFmt=o.clock24?timeFmt:new Intl.DateTimeFormat([], {timeZone:clock,hour:'numeric',hour12:true});
  var sunMemo=new Map();
  /** Roughly where the trip is at t: a leg's start before it, its end after, a straight line by time in between. */
  function placeAt(t){
   var L=o.legs;if(!L.length||!rows.length)return null;
   function ok(p){return p&&Number.isFinite(+p.lat)&&Number.isFinite(+p.lng)?{lat:+p.lat,lng:+p.lng}:null;}
   for(var i=0;i<rows.length;i++){
    var r=rows[i],a=ok(L[i].point),b=ok(L[i].endPoint)||a;
    if(t<r.start)return (i&&ok(L[i-1].endPoint))||a;
    if(t<=r.end){if(!a)return b;var f=r.end>r.start?(t-r.start)/(r.end-r.start):0;return {lat:a.lat+(b.lat-a.lat)*f,lng:a.lng+(b.lng-a.lng)*f};}
   }
   var last=L[rows.length-1];return ok(last.endPoint)||ok(last.point);
  }
  function sunTimes(t,p){
   var key=Math.round(t/H)+'|'+p.lat.toFixed(2)+'|'+p.lng.toFixed(2),hit=sunMemo.get(key);
   if(!hit){if(sunMemo.size>400)sunMemo.clear();hit=root.SunCalc.getTimes(new Date(t),p.lat,p.lng);sunMemo.set(key,hit);}
   return hit;
  }
  /** Solar events in [a, b), each timed where the trip roughly is then. */
  function sunEvents(a,b){
   if(!root.SunCalc)return [];
   var out=[],mid=(a+b)/2;
   [-DAY,0,DAY].forEach(function(off){
    var t0=mid+off,p0=placeAt(t0);if(!p0)return;
    var first=sunTimes(t0,p0);
    SUN_KINDS.forEach(function(k){
     var t=+first[k];if(!Number.isFinite(t))return;
     var p=placeAt(t);if(p)t=+sunTimes(t0,p)[k];
     if(Number.isFinite(t)&&t>=a&&t<b&&!out.some(function(e){return e.kind===k&&Math.abs(e.at-t)<6*H;}))out.push({kind:k,at:t});
    });
   });
   return out;
  }
  function sunMarks(a,b){
   return sunEvents(a,b).map(function(e){var label=SUN_NAMES[e.kind]+' · '+timeFmt.format(e.at);
    return '<span class="ws-sun-ev" role="img" style="left:'+(100*(e.at-a)/(b-a))+'%" data-ws-sun="'+e.kind+'" aria-label="'+o.esc(label)+'" title="'+o.esc(label)+'">'+sunIcon(e.kind)+'</span>';}).join('');
  }
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
   var values=rows.map(function(r,i){return edges(r,windows[i],rows[i+1]);}),days=new Set(),shownSkips=new Set(),html='';
   function include(from,to){
    var a=Date.parse(WindowClock.wall(from,clock).slice(0,10)+'T00:00:00Z'),
        b=Date.parse(WindowClock.wall(to,clock).slice(0,10)+'T00:00:00Z');
    if(!Number.isFinite(a)||!Number.isFinite(b))return;
    days.add(a);days.add(b);
    for(var day=Math.min(a,b),last=Math.max(a,b);day<=last&&day<=Math.min(a,b)+14*DAY;day+=DAY)days.add(day);
   }
   rows.forEach(function(r,i){var w=values[i];include(r.start,r.end);include(w.ds,w.de);include(w.as,w.ae);});
   var activeDays=Array.from(days).sort(function(a,b){return a-b;});
   activeDays.forEach(function(day,i){var next=activeDays[i+1];for(var d=day+DAY;d<next&&d<=day+14*DAY;d+=DAY)days.add(d);});
   // While a handle is held, the days and rows stay exactly as they were when it was grabbed,
   // so the row under the thumb never moves (a compact day stays compact and shows the handle).
   var frozen=drag&&drag.layout,plan=frozen||[];
   if(!frozen)Array.from(days).sort(function(a,b){return a-b;}).forEach(function(day){
    var ymd=new Date(day).toISOString().slice(0,10),nextDay=new Date(day+DAY).toISOString().slice(0,10),
        a=Overnight.epoch(ymd,0,clock),b=Overnight.epoch(nextDay,0,clock),span=(width<480?6:12)*H;
    if(!Number.isFinite(a)||!Number.isFinite(b))return;
    var detailed=rows.some(function(r,i){return r.start<b&&r.end>=a||Object.values(values[i]).some(function(t){return t>=a&&t<b;});}),chunks=[];
    if(detailed)for(var t=a;t<b;t+=span)chunks.push({from:t,to:Math.min(t+span,b)});
    plan.push({a:a,b:b,chunks:chunks});
   });
   plan.forEach(function(d){
    var content='';
    d.chunks.forEach(function(c){building=c;content+=strip(c.from,c.to,values,d.b,shownSkips,frozen?c:null);});building=null;
    if(!frozen)d.chunks=d.chunks.filter(function(c){return !c.empty;});
    html+='<section class="ws-day"><h4>'+o.esc(dateFmt.format(d.a))+'</h4>'+(content||compactStrip(d.a,d.b,values,!!frozen))+'</section>';
   });
   layout=plan;
   var problems='';
   rows.forEach(function(r,i){(r.missed||[]).forEach(function(m){
    problems+='<li><span>Leg '+(i+1)+' '+o.esc(missedText(m))+'</span><button type="button" class="btn tonal sm" data-ws-night="'+o.esc(m.night)+'" data-ws-night-leg="'+i+'" data-ws-skip="1">Drive through the night of '+o.esc(m.night)+'</button></li>';
   });});
   if(problems)html+='<div class="ws-problems" role="alert"><b>Rest problem</b><ul>'+problems+'</ul></div>';
   var restore='',waits='';
   rows.forEach(function(_,i){
    o.skippedNights(i).forEach(function(date){if(!shownSkips.has(i+'|'+date))restore+=nightButton(i,date,true);});
    o.skippedWaits(i).forEach(function(key){waits+=waitButton(i,[key],false);});
   });
   if(restore)html+='<div class="ws-skipped"><p class="lead small keep">Drive-through nights outside this view</p>'+restore+'</div>';
   if(waits)html+='<div class="ws-skipped"><p class="lead small keep">Skipped departure waits</p>'+waits+'</div>';
   // An unchanged chart isn't replaced, so a tap that blurs a field (whose change redraws) still lands.
   if(html!==drawn||!host.firstChild){host.innerHTML=html;drawn=html;}
   o.onIssues(rows.flatMap(function(r,i){return issues(r,windows[i],rows[i+1],begin).map(function(text){return 'Leg '+(i+1)+' '+text;});}));
  }
  function layoutChunk(a){return building&&building.from===a?building:null;}
  function compactStrip(a,b,values,live){
   function pc(t){return (t-a)*100/(b-a);}
   var labels='',shading='',held='';
   if(live)rows.forEach(function(r,i){
    r.parts.forEach(function(p){var s=Math.max(a,p.start),e=Math.min(b,p.end);if(s<e)shading+='<span aria-hidden="true" class="ws-bar ws-'+p.kind+'" style="left:'+pc(s)+'%;right:'+(100-pc(e))+'%"></span>';});
    var w=values[i];Object.keys(w).concat(['start','end']).forEach(function(id){var t=id==='start'||id==='end'?r[id]:w[id];
     if(t>=a&&t<b)held+='<button type="button" tabindex="-1" class="ws-handle ws-h-'+id+'" style="left:'+pc(t)+'%" data-ws-leg="'+i+'" data-ws-edge="'+id+'" data-ws-at="'+t+'" aria-hidden="true"></button>';});
   });
   for(var t=a;t<b;t+=6*H)labels+='<span class="ws-compact-label" style="left:'+pc(t)+'%">'+o.esc(hourFmt.format(t))+'</span>';
   values.forEach(function(w){
    [[w.ds,w.de],[w.as,w.ae]].forEach(function(range){
     var start=Math.max(a,range[0]),end=Math.min(b,range[1]);
     if(start<end)shading+='<span class="ws-compact-shade" style="left:'+pc(start)+'%;right:'+(100-pc(end))+'%"></span>';
    });
   });
   return '<div class="ws-strip ws-compact" data-ws-from="'+a+'" data-ws-to="'+b+'"><div class="ws-track">'+shading+labels+sunMarks(a,b)+held+'</div></div>';
  }
  function waitButton(i,keys,skip,position){
   var fields=keys[0].split('|'),label=(skip?'Skip waiting':'Restore waiting')+' · Leg '+(i+1)+' · '+fields[0]+' '+fields[1]+'–'+fields[2],
       attrs=' data-ws-wait="'+o.esc(JSON.stringify(keys))+'" data-ws-night-leg="'+i+'" data-ws-skip="'+(skip?'1':'0')+'"';
   if(!skip)return '<button type="button" class="btn tonal sm"'+attrs+'>'+o.esc(label)+'</button>';
   return '<button type="button" class="ws-night ws-wait-action" style="left:clamp(12px,'+position+'%,calc(100% - 12px))"'+attrs+
    ' aria-label="'+o.esc(label)+'" title="'+o.esc(label)+'">−</button>';
  }
  function nightButton(i,date,skip,position){
   var label=(skip?'Restore rest':'Drive through')+' · Night of '+date+' · Leg '+(i+1),
       attrs=' data-ws-night="'+o.esc(date)+'" data-ws-night-leg="'+i+'" data-ws-skip="'+(skip?'0':'1')+'"';
   if(position==null)return '<button type="button" class="btn tonal sm"'+attrs+' aria-label="'+o.esc(label)+'">Restore rest · '+o.esc(date)+'</button>';
   return '<button type="button" class="ws-night'+(skip?' ws-night-skipped':'')+'" style="left:clamp(12px,'+position+'%,calc(100% - 12px))"'+attrs+
    ' aria-label="'+o.esc(label)+'" title="'+o.esc(label)+'">'+(skip?'⌃':'−')+'</button>';
  }
  function strip(a,b,values,dayEnd,shownSkips,fixed){
   function pc(t){return 100*(t-a)/(b-a);}
   function bar(kind,start,end){
    if(end<=start||start>=b||end<=a)return '';
    return '<span aria-hidden="true" class="ws-bar ws-'+kind+'" style="left:'+pc(Math.max(a,start))+'%;right:'+(100-pc(Math.min(b,end)))+'%"></span>';
   }
   function handle(i,id,t,second){
    if(t<a||t>=b&&!(t===b&&b===dayEnd&&id==='end'))return '';
    return '<button type="button" class="ws-handle ws-h-'+id+(second?' ws-h-extra':'')+'" style="left:'+pc(t)+'%" data-ws-leg="'+i+'" data-ws-edge="'+id+'" data-ws-at="'+t+'" aria-label="'+o.esc('Leg '+(i+1)+' · '+marks[id]+' · '+dateFmt.format(t)+' '+timeFmt.format(t))+'"></button>';
   }
   var windows='',itinerary='',handles='',names='',tick='',nightActions='',blue=[];
   for(var t=a;t<b;t+=H){
    var wholeHour=WindowClock.wall(t,clock).endsWith(':00');
    tick+='<span data-ws-tick="'+t+'" style="left:'+pc(t)+'%">'+o.esc((wholeHour?hourFmt:timeFmt).format(t))+'</span>';
   }
   rows.forEach(function(r,i){
    var w=values[i],times=Object.values(w);if(Math.min(r.start,...times)>=b||Math.max(r.end,...times)<a)return;
    windows+=bar('departure'+(w.ds>w.de?' ws-reversed':''),Math.min(w.ds,w.de),Math.max(w.ds,w.de))+bar('arrival'+(w.as>w.ae?' ws-reversed':''),Math.min(w.as,w.ae),Math.max(w.as,w.ae));
    r.parts.forEach(function(p){
     itinerary+=p.kind==='norest'?bar('norest',p.start,p.until):bar(p.kind,p.start,p.end);
     if(p.start<a||p.start>=b)return;
     if(p.waitKeys)nightActions+=waitButton(i,p.waitKeys,true,pc(p.start));
     if(!p.toggleNight)return;
     var skip=p.kind==='skip-rest';if(skip)shownSkips.add(i+'|'+p.night);
     nightActions+=nightButton(i,p.night,skip,pc(p.start));
    });
    Object.keys(w).forEach(function(key){if(w[key]>=a&&w[key]<b)blue.push({leg:i,edge:key,at:w[key]});});
    handles+=handle(i,'start',r.start)+handle(i,'end',r.end);
    var from=Math.max(a,r.start),to=Math.min(b,r.end);
    if(pc(to)-pc(from)>=12)names+='<b style="left:'+pc(from)+'%;right:'+(100-pc(to))+'%">Leg '+(i+1)+'</b>';
   });
   // Departure and arrival handles share the row below the bar when their hit areas fit.
   function handleLeft(h){return pc(h.at)*Math.max(1,width-32)/100-(h.edge[1]==='s'?18.75:6.25);}
   var depLeft=blue.filter(function(h){return h.edge[0]==='d';}).map(handleLeft),extra=false;
   blue.forEach(function(h){
    var second=h.edge[0]==='a'&&depLeft.some(function(x){return Math.abs(x-handleLeft(h))<25;});
    if(second)extra=true;
    handles+=handle(h.leg,h.edge,h.at,second&&(!fixed||fixed.extra));
   });
   if(fixed)extra=fixed.extra;
   var any=windows||itinerary||handles||nightActions;
   if(!fixed){
    // Remember what this row looked like, so a drag can hold it in place.
    var chunk=layoutChunk(a);if(chunk){chunk.empty=!any;chunk.extra=extra;}
   }
   return any||fixed?'<div class="ws-strip" data-ws-from="'+a+'" data-ws-to="'+b+'"><div class="ws-axis">'+tick+'</div><div class="ws-sun">'+sunMarks(a,b)+'</div><div class="ws-lane"><div class="ws-track'+(extra?' ws-track-extra':'')+'" style="--ws-hour:'+pc(a+H)+'%">'+windows+itinerary+names+handles+nightActions+'</div></div></div>':'';
  }
  function change(i,id,t){
   var w=windows[i],row=rows[i];
   if(id==='start'||id==='end'){
    var from=id==='end'?row.start+t-row.end:t;
    if(from===row.start)return true;
    starts[i]=from;
    rows[i]=run(o.legs[i],from,localRules(i));
   }else{
    var opposite=position(i,OPPOSITE[id]);
    t=id[1]==='s'?Math.min(t,opposite):Math.max(t,opposite);
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
  function stripAtTime(strips,t){
   var i=strips.findIndex(function(strip){return t>=strip.from&&t<strip.to;});
   return i<0?(t<strips[0].from?0:strips.length-1):i;
  }
  function scrollParent(){
   for(var el=host.parentElement;el;el=el.parentElement){
    var y=getComputedStyle(el).overflowY;
    if((y==='auto'||y==='scroll')&&el.scrollHeight>el.clientHeight)return el;
   }
   return document.scrollingElement||document.documentElement;
  }
  host.addEventListener('pointerdown',function(e){
   var b=button(e);if(!b||e.button!==0)return;
   var source=b.closest('.ws-strip'),i=+b.dataset.wsLeg,edge=b.dataset.wsEdge,at=position(i,edge),
       hostTop=host.getBoundingClientRect().top,hb=b.getBoundingClientRect(),handleY=hb.top+hb.height/2;
   // Row geometry relative to the itinerary, so scrolling during the drag doesn't stale it.
   var strips=Array.from(host.querySelectorAll('.ws-strip')).map(function(el){
    var box=el.getBoundingClientRect(),track=el.querySelector('.ws-track').getBoundingClientRect();
    return {el:el,from:+el.dataset.wsFrom,to:+el.dataset.wsTo,top:box.top-hostTop,trackTop:track.top-box.top,trackH:track.height,
     compact:el.classList.contains('ws-compact'),left:track.left,width:track.width};
   });
   var origin=strips.find(function(strip){return strip.el===source;}),
       peer=OPPOSITE[edge],limit=peer?stripAtTime(strips,position(i,peer)):null;
   if(!origin||!origin.width)return;
   // Where this handle's center sits inside a full row and inside a compact row.
   var line=handleY-hostTop-origin.top;
   strips.forEach(function(s){s.line=s.compact?s.trackTop+s.trackH/2:(origin.compact?s.trackTop+56:line);delete s.el;});
   drag={id:e.pointerId,i:i,edge:edge,x:e.clientX,y:e.clientY,strips:strips,grab:e.clientY-handleY,layout:layout,
    offset:e.clientX-origin.left-origin.width*(at-origin.from)/(origin.to-origin.from),
    first:peer&&edge[1]==='e'?limit:0,last:peer&&edge[1]==='s'?limit:strips.length-1};
   scroller=scrollParent();
   host.setPointerCapture(e.pointerId);e.preventDefault();
  });
  function move(e){
   if(!drag||e.pointerId!==drag.id)return;
   if(!drag.moved&&e.clientX===drag.x&&e.clientY===drag.y)return;
   drag.moved=true;drag.pointer={pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY};
   // The handle follows the thumb: pick the row whose handle line is nearest the thumb (less the grab offset).
   var strips=drag.strips,want=e.clientY-drag.grab-host.getBoundingClientRect().top,row=drag.first,best=Infinity;
   for(var k=drag.first;k<=drag.last;k++){var d=Math.abs(strips[k].top+strips[k].line-want);if(d<best){best=d;row=k;}}
   var strip=strips[row],fraction=(e.clientX-drag.offset-strip.left)/strip.width;
   if(OPPOSITE[drag.edge])fraction=Math.max(0,Math.min(1,fraction));
   var t=strip.from+fraction*(strip.to-strip.from);
   change(drag.i,drag.edge,Math.round(t/HANDLE_STEP)*HANDLE_STEP);
   autoScroll(e.clientY);
  }
  var scrollFrame=0;
  function autoScroll(y){
   cancelAnimationFrame(scrollFrame);
   if(!drag||!scroller)return;
   var view=scroller===document.scrollingElement||scroller===document.documentElement?{top:0,bottom:innerHeight}:scroller.getBoundingClientRect(),
       edge=56,speed=y<view.top+edge?-(view.top+edge-y):y>view.bottom-edge?y-(view.bottom-edge):0;
   // Stop once the furthest row the handle may reach is on screen: scrolling further only carries it away from the thumb.
   var top=host.getBoundingClientRect().top,last=drag.strips[drag.last],first=drag.strips[drag.first];
   if(speed>0&&top+last.top+last.line+24<=view.bottom-edge/2)speed=0;
   if(speed<0&&top+first.top+first.line-24>=view.top+edge/2)speed=0;
   if(!speed)return;
   scrollFrame=requestAnimationFrame(function(){
    if(!drag)return;
    var before=scroller.scrollTop;scroller.scrollTop+=Math.max(-18,Math.min(18,speed/3));
    if(scroller.scrollTop!==before&&drag.pointer)move(drag.pointer);
   });
  }
  host.addEventListener('pointermove',function(e){if(!drag)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(function(){move(e);});});
  function release(){cancelAnimationFrame(frame);cancelAnimationFrame(scrollFrame);var was=drag;drag=null;if(was)draw();}
  host.addEventListener('pointerup',function(e){if(drag&&drag.id===e.pointerId){cancelAnimationFrame(frame);move(e);release();}});
  host.addEventListener('pointercancel',function(e){if(drag&&drag.id===e.pointerId)release();});
  host.addEventListener('lostpointercapture',function(){if(drag)release();});
  host.addEventListener('click',function(e){
   var b=e.target.closest('[data-ws-night],[data-ws-wait]');if(!b)return;
   var i=+b.dataset.wsNightLeg,date=b.dataset.wsNight,keys=b.dataset.wsWait,skip=b.dataset.wsSkip==='1';
   if(keys)o.setWait(i,JSON.parse(keys),skip);else o.setNight(i,date,skip);
   starts[i]=rows[i].start;
   rows[i]=run(o.legs[i],starts[i],localRules(i));
   draw();
   var next=Array.from(host.querySelectorAll(keys?'[data-ws-wait]':'[data-ws-night]')).find(function(el){return +el.dataset.wsNightLeg===i&&(keys?JSON.parse(el.dataset.wsWait).includes(JSON.parse(keys)[0]):el.dataset.wsNight===date);});
   if(next)next.focus({preventScroll:true});
  });
  host.addEventListener('keydown',function(e){
   var b=button(e),sign={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[e.key];if(!b||!sign)return;
   var i=+b.dataset.wsLeg,id=b.dataset.wsEdge;e.preventDefault();
   var slot=position(i,id)/HANDLE_STEP,target=(sign>0?Math.floor(slot)+1:Math.ceil(slot)-1)*HANDLE_STEP;
   if(change(i,id,target))host.querySelector('[data-ws-leg="'+i+'"][data-ws-edge="'+id+'"]')?.focus({preventScroll:true});
  });
  var observer=new ResizeObserver(function(){var nextWidth=host.clientWidth;if(nextWidth!==width){width=nextWidth;draw();}});
  observer.observe(host);refresh();
  return {refresh:refresh,starts:function(){return starts.slice();},close:function(){observer.disconnect();cancelAnimationFrame(frame);}};
 }
 var api={sunIcon:sunIcon,SUN_NAMES:SUN_NAMES,bind:bind,sessions:sessions,restParts:restParts,run:run,fits:fits,issues:issues,place:place,step:STEP};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WindowSchedule=api;
})(typeof window==='undefined'?globalThis:window);
