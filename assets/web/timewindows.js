/* Hourly route/time consent and itinerary search. Explicit road/hour consent, optional user-defined hazard rules,
 * and exhaustive verified itinerary search. */
(function(root){
  'use strict';
  var HOUR=3600000;
  function hours(start,end){
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw Error('Enter a valid time window');
    if(end-start>14*24*HOUR)throw Error('Choose a window of at most 14 days');
    var out=[];for(var t=start;t<=end;t+=HOUR)out.push(t);return out;
  }
  function stable(x){if(Array.isArray(x))return '['+x.map(stable).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(function(k){return JSON.stringify(k)+':'+stable(x[k]);}).join(',')+'}';return JSON.stringify(x);}
  function coverageIssues(reading){
    if(!reading||reading.error)return [{code:'unavailable',text:reading&&reading.error||'Forecast unavailable.'}];
    var s=reading.stats,out=[];
    if(!s||!(s.points>0)||!(s.weather>=s.points)||s.beyondWeather)out.push({code:'weather',text:'Weather forecasts do not cover the entire route and time.'});
    if(s&&(s.beyondAir||s.air!=null&&s.air<s.points))out.push({code:'air',text:'Air-quality forecasts do not cover the entire route and time.'});
    if(s&&s.errors)out.push({code:'errors',text:'Some forecast or warning data could not be read.'});
    if(s&&s.aiPending||(reading.hazards||[]).some(function(h){return h.aiPending;}))out.push({code:'rating',text:'A weather warning still needs its AI rating.'});
    if((reading.hazards||[]).some(function(h){return h.areaUncertain;}))out.push({code:'area',text:'A warning area could not be verified.'});
    return out;
  }
  function autoReasons(reading,rules,kinds){
    var out=coverageIssues(reading);if(!rules||rules.enabled!==true)return out.concat([{code:'disabled',text:'Automatic approval is off.'}]);
    (reading&&reading.hazards||[]).forEach(function(h){if(!kinds[h.kind])out.push({code:'unknown',text:'An unrecognized hazard needs review.'});else if(!Array.isArray(rules.ask)||rules.ask.indexOf(h.kind)>=0)out.push({code:'rule',text:(Array.isArray(kinds[h.kind])?kinds[h.kind][0]:h.kind)+' is checked in your approval rules.'});});
    return out;
  }
  function signature(reading){
    if(!reading||reading.error)return stable({unknown:true,error:reading&&reading.error||'Forecast unavailable'});
    return stable({coverage:coverageIssues(reading).map(function(x){return x.code;}),hazards:(reading.hazards||[]).map(function(h){return {kind:h.kind,level:h.level,event:h.event||'',id:h.id||'',source:h.src||'',from:Math.round((+h.fromMi||0)*10)/10,to:Math.round((+h.toMi||0)*10)/10,start:h.from,end:h.to};}).sort(function(a,b){return stable(a).localeCompare(stable(b));})});
  }
  function group(rows){
    var groups=[];rows.slice().sort(function(a,b){return a.leg-b.leg||String(a.routeKey).localeCompare(String(b.routeKey))||a.depart-b.depart;}).forEach(function(row){var last=groups[groups.length-1],sig=row.signature||signature(row.reading);
      if(last&&last.leg===row.leg&&last.routeKey===row.routeKey&&last.signature===sig&&row.depart-last.end===HOUR){last.end=row.depart;last.rows.push(row);}
      else groups.push({leg:row.leg,routeKey:row.routeKey,start:row.depart,end:row.depart,signature:sig,reading:row.reading,rows:[row]});
    });return groups;
  }
  // User opt-in only. Incomplete forecasts and new/unclassified hazards always need review.
  function autoAllowed(reading,rules,kinds){
    return !!reading&&Array.isArray(reading.hazards)&&autoReasons(reading,rules,kinds).length===0;
  }
  // A no-stop timeline is a lower bound. Reject only missed upper deadlines;
  // early arrivals and long apparent waits may still be made valid by real stops/charging.
  function canFit(earliest,path,arrivals){
    return earliest.every(function(t,i){var r=path[i],a=arrivals&&arrivals[i];return !r||!(t.depart>=r.depart+HOUR||a&&t.arrive>a.end);});
  }
  function create(){
    var roads=new Map(),answers=new Map();
    function id(row){return row.leg+'|'+row.routeKey+'|'+row.depart;}
    return {road:function(leg,key,yes){roads.set(leg+'|'+key,yes===true);},roadAllowed:function(leg,key){return roads.get(leg+'|'+key)===true;},
      answer:function(g,yes){g.rows.forEach(function(row){var a=answers.get(id(row))||new Map();a.set(g.signature,yes===true);answers.set(id(row),a);});},
      decision:function(row,sig){var a=answers.get(id(row));return a&&a.get(sig||row.signature||signature(row.reading));},
      allowed:function(row){return roads.get(row.leg+'|'+row.routeKey)===true&&this.decision(row)===true;},
      clear:function(){roads.clear();answers.clear();}};
  }
  async function readings(config){
    var out=[],next=0,jobs=config.rows.filter(function(r){return config.consent.roadAllowed(r.leg,r.routeKey);}),valid=config.valid||function(){return true;};
    async function lane(){while(next<jobs.length&&valid()){var row=jobs[next++],reading;await new Promise(function(done){setTimeout(done,0);});if(!valid())return;try{reading=await config.read(row,{valid:valid,progress:function(frac){if(config.detail)config.detail(out.length,jobs.length,row,frac);}});}catch(e){reading={error:String(e.message||e),hazards:[]};}if(!valid())return;out.push(Object.assign({},row,{reading:reading,signature:signature(reading)}));if(config.progress)config.progress(out.length,jobs.length);}}
    await Promise.all([lane(),lane()]);return valid()?out:null;
  }
  function better(a,b,priority){if(!a)return false;if(!b)return true;var keys=priority==='time'?['minutes','cost','waitMinutes']:['cost','minutes','waitMinutes'];for(var i=0;i<keys.length;i++){var av=Number.isFinite(a[keys[i]])?a[keys[i]]:Infinity,bv=Number.isFinite(b[keys[i]])?b[keys[i]]:Infinity,d=av-bv;if(Math.abs(d)>1e-7)return d<0;}return a.depart<b.depart;}
  // The evaluator must run the real fuel/charging/tariff planner and return actual leg
  // clocks. An estimate cannot become a recommendation merely because it was screened.
  async function search(c){
    var best=null,review=[],reviewKeys=new Set(),checked=0,valid=c.valid||function(){return true;},byLeg=c.legs.map(function(rows){return rows.filter(function(r){return c.consent.allowed(r);}).sort(function(a,b){return a.depart-b.depart;});});
    async function walk(index,path){
      if(!valid())return;
      if(index===byLeg.length){
        checked++;var result=await c.evaluate(path.slice());if(c.progress)c.progress(checked,best);if(!valid()||!result||c.priority!=='time'&&!Number.isFinite(result.cost)||!Number.isFinite(result.minutes)||!Array.isArray(result.legs)||result.legs.length!==path.length)return;
        var okay=true;if(c.departures&&(result.legs[0].depart<c.departures.start||result.legs[0].depart>c.departures.end))okay=false;
        result.legs.forEach(function(actual,i){var chosen=path[i],window=c.arrivals&&c.arrivals[i];if(actual.routeKey!==chosen.routeKey||!Number.isFinite(actual.depart)||!Number.isFinite(actual.arrive)||actual.arrive<actual.depart||actual.depart<chosen.depart||actual.depart>=chosen.depart+HOUR){okay=false;return;}if(i){var ready=result.legs[i-1].ready||result.legs[i-1].arrive;var dw=c.departWindows&&c.departWindows[i];if(actual.depart<ready||dw&&(actual.depart<dw.start||actual.depart>dw.end)||!dw&&actual.depart-ready>(c.waits&&c.waits[i-1]||0)*60000+1)okay=false;}if(window&&(actual.arrive<window.start||actual.arrive>window.end))okay=false;
          var decision=c.consent.decision(chosen,actual.signature);if(decision!==true){okay=false;var reviewKey=stable([i,actual.routeKey,chosen.depart,actual.signature]);if(decision==null&&!reviewKeys.has(reviewKey)){reviewKeys.add(reviewKey);review.push(Object.assign({},actual,{leg:i,depart:chosen.depart,actualDepart:actual.depart,reason:'Conditions changed after stops and waits were planned'}));}}
        });
        if(okay&&better(result,best,c.priority))best=result;return;
      }
      for(var i=0;i<byLeg[index].length&&valid();i++){
        var row=byLeg[index][i],prev=path[index-1],wait=c.waits&&c.waits[index-1]||0;
        if(prev&&row.depart+HOUR<=prev.depart)continue;
        path.push(row);await walk(index+1,path);path.pop();
      }
    }
    if(byLeg.length&&byLeg.every(function(rows){return rows.length;}))await walk(0,[]);
    return valid()?{best:best,checked:checked,review:review}:null;
  }
  function count(legs,consent){var previous=[];legs.forEach(function(list,i){var rows=list.filter(function(r){return consent.allowed(r);}).slice().sort(function(a,b){return a.depart-b.depart;}),at=0,sum=0;previous=rows.map(function(row){if(!i)return {depart:row.depart,n:1};while(at<previous.length&&previous[at].depart<row.depart+HOUR)sum+=previous[at++].n;return {depart:row.depart,n:sum};});});return previous.reduce(function(n,r){return n+r.n;},0);}
  var api={HOUR:HOUR,hours:hours,coverageIssues:coverageIssues,autoReasons:autoReasons,autoAllowed:autoAllowed,canFit:canFit,signature:signature,group:group,create:create,readings:readings,better:better,search:search,count:count};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TimeWindows=api;
})(typeof window==='undefined'?globalThis:window);
