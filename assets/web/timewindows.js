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
  function ranges(depart,legs){var earliest=depart.start,latest=depart.end;return legs.map(function(leg,i){var fixed=leg.window;if(fixed){earliest=Math.max(earliest,fixed.start);latest=fixed.end;}var range={start:i&&!fixed?Math.floor(earliest/HOUR)*HOUR:earliest,end:latest};earliest=range.start+leg.minMinutes*60000;latest=range.end+(leg.maxMinutes+(leg.delayMax||0))*60000;return range;});}
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
  // Only issues a person can act on block approval: a warning the AI hasn't rated yet, or a warning whose area couldn't be
  // placed. Missing forecast data (past the forecast horizon, or a source that didn't answer) can't be judged by looking
  // at the hour, so it becomes a notice on the trip (dataNotices) instead of a manual review.
  function screeningIssues(reading){return coverageIssues(reading).filter(function(x){return x.code==='rating'||x.code==='area';});}
  function dataNotices(legs){var missing=[],weather=[];(legs||[]).forEach(function(t,i){var c=coverageIssues(t.reading).map(function(x){return x.code;});if(c.indexOf('air')>=0||t.reading&&t.reading.stats&&t.reading.stats.airErrors)missing.push(i+1);if(c.indexOf('weather')>=0||c.indexOf('unavailable')>=0||c.indexOf('errors')>=0&&!(t.reading.stats&&t.reading.stats.errors<=(t.reading.stats.airErrors||0)))weather.push(i+1);});var out=[];if(weather.length)out.push('Weather forecasts don’t cover all of leg'+(weather.length>1?'s ':' ')+weather.join(', ')+' (past the forecast range, or a source didn’t answer). Hazards there could not be checked; look again closer to departure.');if(missing.length)out.push('Air-quality forecast unavailable for part of leg'+(missing.length>1?'s ':' ')+missing.join(', ')+'. Smoke and unhealthy air could not be checked everywhere.');return out;}
  function weatherScore(reading){var weights={tornado:10,tropical:8,flood:10,alert:7,storm:5,ice:6,snow:5,rain:3,fog:3,wind:4,heat:3,cold:3,air:3};return (reading&&reading.hazards||[]).reduce(function(n,h){return n+(weights[h.kind]||5)*(h.level>=2?2:1)*Math.max(1,(h.toMi||0)-(h.fromMi||0));},0)+(screeningIssues(reading).length?100000:0);}
  function approvalRules(value){var v=value&&value.version===2?value:{},list=function(x){return Array.isArray(x)?Array.from(new Set(x.filter(function(k){return typeof k==='string';}))):[];},allow=list(v.allow),endpointAllow=list(v.endpointAllow),n=v.endpointMiles==null?50:Number(v.endpointMiles),endpointMiles=Number.isFinite(n)&&n>=0?n:0;return {version:2,allow:allow,endpointAllow:endpointAllow,endpointMiles:endpointMiles,enabled:allow.length>0||endpointAllow.length>0&&endpointMiles>0};}
  function nearEndpoints(h,total,miles){if(!Number.isFinite(total)||total<=0||!(miles>0)||!Number.isFinite(h.fromMi)||!Number.isFinite(h.toMi)||h.fromMi<0||h.toMi<h.fromMi||h.toMi>total)return false;return miles*2>=total||h.toMi<=miles||h.fromMi>=total-miles;}
  function autoReasons(reading,rules,kinds,totalMi){
    var out=screeningIssues(reading);rules=approvalRules(rules);if(!rules.enabled)return out.concat([{code:'disabled',text:'Automatic approval is off.'}]);
    (reading&&reading.hazards||[]).forEach(function(h){if(!kinds[h.kind])out.push({code:'unknown',text:'An unrecognized hazard needs review.'});else if(rules.allow.indexOf(h.kind)<0&&!(rules.endpointAllow.indexOf(h.kind)>=0&&nearEndpoints(h,totalMi,rules.endpointMiles)))out.push({code:'rule',text:(Array.isArray(kinds[h.kind])?kinds[h.kind][0]:h.kind)+' needs your approval.'});});
    return out;
  }
  function signature(reading){
    if(!reading||reading.error)return stable({unknown:true,error:reading&&reading.error||'Forecast unavailable'});
    return stable({coverage:screeningIssues(reading).map(function(x){return x.code;}),hazards:(reading.hazards||[]).map(function(h){return {kind:h.kind,level:h.level,event:h.event||'',id:h.id||'',source:h.src||'',from:Math.round((+h.fromMi||0)*10)/10,to:Math.round((+h.toMi||0)*10)/10};}).sort(function(a,b){return stable(a).localeCompare(stable(b));})});
  }
  function group(rows){
    var groups=[];rows.slice().sort(function(a,b){return a.leg-b.leg||String(a.routeKey).localeCompare(String(b.routeKey))||a.depart-b.depart;}).forEach(function(row){var last=groups[groups.length-1],sig=row.signature||signature(row.reading);
      if(last&&last.leg===row.leg&&last.routeKey===row.routeKey&&last.signature===sig&&row.depart-last.end===HOUR){last.end=row.depart;last.rows.push(row);}
      else groups.push({leg:row.leg,routeKey:row.routeKey,start:row.depart,end:row.depart,signature:sig,reading:row.reading,rows:[row]});
    });return groups;
  }
  function groupDecision(g,consent){var answers=g.rows.map(function(r){return consent.decision(r,g.signature);});return answers.some(function(a){return a===false;})?false:answers.every(function(a){return a===true;})?true:undefined;}
  // User opt-in only. Incomplete forecasts and new/unclassified hazards always need review.
  function autoAllowed(reading,rules,kinds,totalMi){
    return !!reading&&Array.isArray(reading.hazards)&&autoReasons(reading,rules,kinds,totalMi).length===0;
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
  function better(a,b,priority,early){if(!a)return false;if(!b)return true;if(early&&Number.isFinite(a.depart)&&Number.isFinite(b.depart)&&a.depart!==b.depart)return a.depart<b.depart;var keys=priority==='time'?['minutes','weather','cost','waitMinutes']:['cost','weather','minutes','waitMinutes'];for(var i=0;i<keys.length;i++){var av=Number.isFinite(a[keys[i]])?a[keys[i]]:Infinity,bv=Number.isFinite(b[keys[i]])?b[keys[i]]:Infinity,d=av-bv;if(Math.abs(d)>1e-7)return d<0;}return a.depart<b.depart;}
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
        if(okay&&better(result,best,c.priority,c.earlyEnabled))best=result;return;
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
  // Rank every approved hourly route in a bounded dynamic-programming frontier.
  // This is a recommendation shortlist, not a proof of a global cost optimum.
  function rankLabel(a,b,priority,early){var keys=['penalty'].concat(early?['depart']:[]).concat(priority==='time'?['minutes','weather','cost']:['cost','weather','minutes']);for(var i=0;i<keys.length;i++){var d=(a[keys[i]]||0)-(b[keys[i]]||0);if(Math.abs(d)>1e-7)return d;}return a.depart-b.depart;}
  function keepLabels(rows,limit,priority,early){rows.sort(function(a,b){return rankLabel(a,b,priority,early);});var keep=[],used=new Set(),routes=new Set();rows.forEach(function(r){var key=r.path.map(function(x){return x.routeKey;}).join('|');if(!routes.has(key)&&keep.length<limit){routes.add(key);used.add(r);keep.push(r);}});for(var i=0;i<rows.length&&keep.length<limit;i++)if(!used.has(rows[i]))keep.push(rows[i]);return keep.sort(function(a,b){return rankLabel(a,b,priority,early);});}
  async function shortlist(c){
    var valid=c.valid||function(){return true;},previous=[],screened=0,rejected={},byLeg=[],total=c.legs.reduce(function(n,l){return n+l.filter(function(r){return c.consent.allowed(r);}).length;},0),slice=Date.now();
    for(var i=0;i<c.legs.length;i++){
      var counts={};byLeg.push(counts);function reject(why){counts[why]=(counts[why]||0)+1;rejected[why]=(rejected[why]||0)+1;}
      var next=[],rows=c.legs[i].filter(function(r){return c.consent.allowed(r);});
      for(var j=0;j<rows.length;j++){
        if(!valid())return null;if(Date.now()-slice>8){await new Promise(function(done){setTimeout(done,0);});slice=Date.now();}
        var row=rows[j],estimate=c.estimate(row),candidates=[],parents=i?previous:[{path:[],arrive:row.depart,depart:row.depart,cost:0,weather:0,penalty:0,delay:0}];
        for(var k=0;k<parents.length;k++){
          if(k%256===0&&Date.now()-slice>8){await new Promise(function(done){setTimeout(done,0);});slice=Date.now();if(!valid())return null;}var p=parents[k];if(i&&row.depart+HOUR<=p.path[p.path.length-1].depart){reject('chronology');continue;}
          var delay=(p.delay||0)+(Number.isFinite(row.trafficDelay)?row.trafficDelay:0);if(c.earlyEnabled&&!Number.isFinite(row.trafficDelay)){reject('forecast');continue;}if(c.earlyEnabled&&delay>c.delayMinutes+1e-7){reject('trafficDelay');continue;}var dw=c.departWindows&&c.departWindows[i],start=i?Math.max(p.arrive,row.depart):row.depart,arrival=start+estimate.minutes*60000,window=c.arrivals&&c.arrivals[i],wait=i?Math.max(0,start-p.arrive)/60000:0,allow=c.waits&&c.waits[i-1]||0;
          var penalty=p.penalty+Math.max(0,start-(row.depart+HOUR-1))/60000+(dw?Math.max(0,dw.start-start,start-dw.end)/60000:Math.max(0,wait-allow));if(window)penalty+=Math.max(0,window.start-arrival,arrival-window.end)/60000;
          candidates.push({path:p.path.concat([row]),depart:p.depart,arrive:arrival,cost:p.cost+estimate.cost,minutes:(arrival-p.depart)/60000,weather:p.weather+weatherScore(row.reading),penalty:penalty,delay:delay});
        }
        next=next.concat(keepLabels(candidates,c.perState||8,c.priority,c.earlyEnabled));screened++;if(c.progress)c.progress(screened,total);
      }
      previous=next;if(!previous.length)break;
    }
    return {candidates:keepLabels(previous,c.limit||48,c.priority,c.earlyEnabled),screened:screened,total:total,rejected:rejected,byLeg:byLeg,blockedLeg:previous.length?null:byLeg.length};
  }
  async function recommend(c){
    var ranked=await shortlist(c);if(!ranked)return null;var valid=c.valid||function(){return true;},best=null,verified=[],checked=0,review=[],seenPlans=new Set();
    var next=0,width=Math.max(1,Math.min(3,c.width||1)),initial=c.initial||16;
    async function lane(){while(next<ranked.candidates.length&&valid()){
      if(best&&next>=initial)break;var path=ranked.candidates[next++].path,key=c.planKey?c.planKey(path):path.map(function(r){return r.routeKey+'|'+r.depart;}).join(';');if(seenPlans.has(key))continue;seenPlans.add(key);var candidate=await c.plan(path);checked++;if(!valid())return;
      if(candidate&&candidate.review){if(!review.length)review=candidate.review;}else if(candidate){verified.push(candidate);if(better(candidate,best,c.priority,c.earlyEnabled))best=candidate;}
      if(c.planProgress)c.planProgress(checked,best,ranked.candidates.length);
    }}
    await Promise.all(Array.from({length:width},lane));
    if(!valid())return null;
    verified.sort(function(a,b){return better(a,b,c.priority,c.earlyEnabled)?-1:better(b,a,c.priority,c.earlyEnabled)?1:0;});
    if(c.refine){best=null;for(var j=0;j<Math.min(c.finalists||2,verified.length)&&valid();j++){var refined=await c.refine(verified[j].path);if(refined&&!refined.review&&better(refined,best,c.priority,c.earlyEnabled))best=refined;else if(refined&&refined.review){review=review.concat(refined.review);if(!best)break;}if(c.refineProgress)c.refineProgress(j+1);}}
    return valid()?{best:best,checked:checked,screened:ranked.screened,shortlisted:ranked.candidates.length,screening:ranked,review:best?[]:review}:null;
  }
  function count(legs,consent){var previous=[];legs.forEach(function(list,i){var rows=list.filter(function(r){return consent.allowed(r);}).slice().sort(function(a,b){return a.depart-b.depart;}),at=0,sum=0;previous=rows.map(function(row){if(!i)return {depart:row.depart,n:1};while(at<previous.length&&previous[at].depart<row.depart+HOUR)sum+=previous[at++].n;return {depart:row.depart,n:sum};});});return previous.reduce(function(n,r){return n+r.n;},0);}
  var api={HOUR:HOUR,hours:hours,ranges:ranges,coverageIssues:coverageIssues,screeningIssues:screeningIssues,dataNotices:dataNotices,weatherScore:weatherScore,approvalRules:approvalRules,autoReasons:autoReasons,autoAllowed:autoAllowed,canFit:canFit,signature:signature,group:group,groupDecision:groupDecision,create:create,readings:readings,better:better,search:search,shortlist:shortlist,recommend:recommend,count:count};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TimeWindows=api;
})(typeof window==='undefined'?globalThis:window);
