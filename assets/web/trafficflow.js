/* Forecast orchestration and departure-window picker. Provider calls use the same
 * native HERE monthly reservation as tolls; cached answers are not trip-specific. */
(function(root){
  'use strict';
  function init(A,call,context){
    var profiles=new WeakMap(),running=new Map(),failure='',sequence=0;
    var service=Traffic.create({get:function(k,ttl){var r=A.KV.get('traffic',k,ttl);return r&&r.v;},put:function(k,v){A.KV.put('traffic',k,v);},fetch:async function(q){var r=await call('fetchHere',A.S.hereKey,q,A.S.hereMonthlyCap==null?2000:Math.max(0,parseInt(A.S.hereMonthlyCap,10)||0));if(root.__apiCount)root.__apiCount();return r;}});
    root.addEventListener('cacheclear',function(){profiles=new WeakMap();service.clear();});
    function enabled(){return A.S.trip.trafficForecast===true&&!!A.S.hereKey;}
    function identity(depart,stops,wait){return JSON.stringify([Math.floor(depart/60000),A.S.trip.avoid,stops||[],wait||null]);}
    function profile(raw,depart){var p=profiles.get(raw);return enabled()&&p&&p.time===Math.floor(depart/60000)&&p.avoid===JSON.stringify(A.S.trip.avoid)&&Date.now()-p.at<(Math.abs(depart-Date.now())<3600000?600000:21600000)?p.value:null;}
    function model(raw,base,depart){var p=profile(raw,depart);return p?Traffic.overlay(base,p):base;}
    async function prepare(raw,base,depart,options){
      if(!enabled())return base;var o=options||{},id=identity(depart,o.stops,o.waitAt),current=profiles.get(raw);if(current&&current.id===id&&profile(raw,depart))return model(raw,base,depart);
      var key=JSON.stringify([Trip.encodePolyline(base.pts),id]),valid=o.valid||function(){return true;};
      if(!running.has(key)){var end=root.Tasks&&Tasks.begin('traffic:'+ (++sequence),{text:'Forecasting traffic along selected roads',priority:20});
        running.set(key,service.forecast(base,depart,{stops:o.stops,waitAt:o.waitAt,avoid:A.S.trip.avoid,valid:valid}).finally(function(){running.delete(key);if(end)end();}));}
      try{var p=await running.get(key);if(!valid())throw Error('Traffic lookup cancelled');profiles.set(raw,{id:id,time:Math.floor(depart/60000),avoid:JSON.stringify(A.S.trip.avoid),at:p.at,value:p});failure='';if(root.FLog)FLog.debug('traffic','Forecast ready',{miles:Math.round(base.totalMi),minutes:Math.round(p.seconds/60),cached:p.cached,ageMinutes:Math.round((Date.now()-p.at)/60000),stopCount:(o.stops||[]).length});return Traffic.overlay(base,p);}
      catch(e){profiles.delete(raw);failure=String(e.message||e);if(root.FLog)FLog[e.cachedFailure?'debug':'warn']('traffic','Forecast unavailable',{reason:failure,cached:!!e.cachedFailure,details:e.details});throw e;}
    }
    function html(){return '<div class="card"><h3>Traffic &amp; departure</h3><label class="field"><span class="lbl">Forecast traffic<small>Uses the optional HERE key and its shared monthly limit. Estimates traffic when you reach each road. Energy use remains an estimate.</small></span><input type="checkbox" id="tTraffic"'+(A.S.trip.trafficForecast?' checked':'')+'></label><button type="button" class="btn tonal" id="tFindDeparture">Explore departure times…</button><p class="lead small keep">'+A.esc(!A.S.hereKey?'Add a HERE key in Settings → Connections to forecast traffic.':failure?'Forecast unavailable: '+failure:'Compare departure times within your window. Times are forecasts, not guarantees.')+'</p></div>';}
    function local(t){var d=new Date(t);return new Date(t-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    function picker(){
      var snapshot=context.snapshot();if(!snapshot||!snapshot.model){A.toast('Choose your route first.');return;}if(!A.S.hereKey){A.toast('Add your HERE key in Settings → Connections first.');return;}
      var cancel=false,owner=JSON.stringify(snapshot.key),start=Math.max(Date.now()+300000,snapshot.depart),manual=snapshot.manualReturn==null?!!snapshot.waitAt:!!snapshot.manualReturn,returnStart=manual?Math.max(start,snapshot.waitAt.at):0,selection=null;
      function field(id,label,value){return '<label class="nf">'+label+'<input id="'+id+'" type="datetime-local" value="'+(value?local(value):'')+'"></label>';}
      var html='<p class="lead small keep">Explore departure times. '+(manual?'Set outbound and return times separately.':'Each time considers the whole trip, including an immediate return when enabled.')+'</p><details id="tfWindows" open><summary>Time windows</summary>'+field('tfStart','Earliest departure',start)+field('tfEnd','Latest departure',start+8*3600000)+(manual?field('tfReturnStart','Earliest return departure',returnStart)+field('tfReturnEnd','Latest return departure',returnStart+8*3600000):'')+field('tfDeadline','Arrive home / finish by (optional)',null)+'<label class="nf">Check every<select id="tfInterval"><option value="60">Hour</option><option value="30">30 minutes</option><option value="120">2 hours</option></select></label><p class="lead small keep">Device local time · up to 25 samples per slider.</p><details><summary>Forecast details &amp; HERE usage</summary><p>Uncached forecasts use the shared HERE allowance. Repeated leg forecasts are reused. Known stop delays are included; accepting rebuilds weather, prices and stops. Road and weather warnings still need review.</p></details><button class="btn primary" id="tfSearch">Explore these windows</button></details><button class="btn tonal hidden" id="tfCancel">Cancel search</button><div id="tfAnswer"></div><button class="btn primary hidden" id="tfUse">Use these times</button>';
      var close=A.subPage('Choose departure times',html,function(b){
        b.classList.add('traffic-picker');
        var button=b.querySelector('#tfSearch'),answer=b.querySelector('#tfAnswer'),use=b.querySelector('#tfUse');
        b.querySelector('#tfCancel').onclick=function(){cancel=true;};
        button.onclick=async function(){
          var times,returns,deadline=null,deadlineText=b.querySelector('#tfDeadline').value.trim();selection=null;use.classList.add('hidden');
          try{if(deadlineText){deadline=+new Date(deadlineText);if(!Number.isFinite(deadline))throw Error('Choose a valid arrival deadline or leave it blank');}var from=+new Date(b.querySelector('#tfStart').value),to=+new Date(b.querySelector('#tfEnd').value),interval=+b.querySelector('#tfInterval').value;if(from<Date.now()-300000)throw Error('Choose a future departure');times=Traffic.times(from,to,interval);returns=manual?Traffic.times(+new Date(b.querySelector('#tfReturnStart').value),+new Date(b.querySelector('#tfReturnEnd').value),interval):[null];}catch(e){answer.textContent=e.message;return;}
          service.retryFailures();cancel=false;button.disabled=true;b.querySelector('#tfCancel').classList.remove('hidden');var failures=0,reasons={},matrix=[],end=root.Tasks&&Tasks.begin('departure-search',{text:'Comparing traffic windows',frac:0,priority:30,cancel:function(){cancel=true;}});
          function valid(){return !cancel&&b.isConnected&&JSON.stringify((context.snapshot()||{}).key)===owner;}
          try{
            for(var i=0;i<times.length;i++){matrix[i]=[];for(var j=0;j<returns.length;j++){
              if(!valid())throw Error('Search cancelled');if(root.Tasks)Tasks.upsert('departure-search',{text:'Checking departure '+(i+1)+' of '+times.length+(manual?' · return '+(j+1)+' of '+returns.length:''),frac:(i*returns.length+j)/(times.length*returns.length)});answer.textContent='Checking departure '+(i+1)+' of '+times.length+(manual?' / return '+(j+1)+' of '+returns.length:'')+'…';
              try{var wait=manual?{d:snapshot.waitAt.d,at:returns[j]}:null,p=await service.forecast(snapshot.model,times[i],{avoid:A.S.trip.avoid,stops:snapshot.stops,waitAt:wait,strictWait:manual,valid:valid});matrix[i][j]=deadline==null||p.arrival<=deadline?{seconds:p.seconds,arrival:p.arrival,at:p.at}:null;}
              catch(e){if(!valid())throw e;matrix[i][j]=null;failures++;reasons[e.message]=(reasons[e.message]||0)+1;if(/cap|401|403|429/i.test(e.message))throw e;}
            }await new Promise(function(resolve){setTimeout(resolve,0);});}
            if(!valid())throw Error('Search cancelled');if(!matrix.some(function(row){return row.some(Boolean);})){var why=Object.keys(reasons).sort(function(a,b){return reasons[b]-reasons[a];})[0];answer.textContent=failures?'Traffic forecasts could not be verified: '+why+'. Try again or change your route. An arrival deadline is optional.':deadline!=null?'No tested arrival meets your deadline. Change it or leave it blank.':'No tested outbound/return combination is available. Change the time windows.';if(root.FLog)FLog.warn('traffic','Departure windows unavailable',{samples:times.length*returns.length,failures:failures,deadlineSet:deadline!=null,reasons:reasons});return;}
            b.querySelector('#tfWindows').open=false;answer.innerHTML='<p class="lead small keep">Extra driving minutes: green ≤5 · amber ≤15 · red >15. Gray = unavailable. All traffic levels are selectable.</p><details><summary>How to read this</summary><p>Compared with the least congested tested time while the other slider stays fixed. These are forecasts; actual conditions and stop durations can change.</p></details><div id="tfSliders"></div><p id="tfSummary" class="lead keep" role="status"></p>';
            var indices=[0,0],host=answer.querySelector('#tfSliders'),summary=answer.querySelector('#tfSummary');
            function short(t){return new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}
            function score(axis,n){var p=matrix[axis===0?n:indices[0]][axis===0?indices[1]:n];return p?p.seconds/60:null;}
            function color(delta){return delta==null?'#667080':delta<=5?'#31a56a':delta<=15?'#d8a037':'#d55b53';}
            function draw(){
              var focused=document.activeElement&&document.activeElement.id;
              [times].concat(manual?[returns]:[]).forEach(function(list,axis){var values=list.map(function(_,n){return score(axis,n);}),known=values.filter(function(v){return v!=null;}),min=known.length?Math.min.apply(null,known):0,colors=values.map(function(v,n){var c=color(v==null?null:v-min);return c+' '+(n/list.length*100).toFixed(2)+'%, '+c+' '+((n+1)/list.length*100).toFixed(2)+'%';}).join(', '),id=axis?'tfReturn':'tfOutbound';
                var block=host.children[axis];if(!block){block=document.createElement('div');block.className='field col';block.innerHTML='<label class="lbl" for="'+id+'">'+(axis?'Return departure':'Departure')+' · '+A.esc(new Date(list[indices[axis]]).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))+'</label><input id="'+id+'" type="range" class="traffic-window-slider" min="0" max="'+Math.max(0,list.length-1)+'" step="1" value="'+indices[axis]+'" aria-label="'+(axis?'Return departure':'Departure')+'" style="background:linear-gradient(to right,'+colors+')"><div class="traffic-ticks" style="display:flex;justify-content:space-between;width:100%;font-size:.75em;gap:3px"></div>';host.appendChild(block);}
                block.querySelector('label').textContent=(axis?'Return departure':'Departure')+' · '+new Date(list[indices[axis]]).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});var input=block.querySelector('input');input.value=indices[axis];input.style.background='linear-gradient(to right,'+colors+')';var ticks=block.querySelector('.traffic-ticks'),major=[];ticks.replaceChildren();for(var k=0;k<Math.min(5,list.length);k++){var n=Math.round(k*(list.length-1)/Math.max(1,Math.min(5,list.length)-1));if(major.indexOf(n)<0)major.push(n);}major.forEach(function(n){var tick=document.createElement('span');tick.style.textAlign='center';tick.textContent=short(list[n]);var delta=document.createElement('div');delta.textContent=values[n]==null?'No forecast':'+'+Math.round(values[n]-min)+' min';tick.appendChild(delta);ticks.appendChild(tick);});
                block.querySelector('input').oninput=function(){indices[axis]=+this.value;draw();};
              });
              var p=matrix[indices[0]][indices[1]],bestSeconds=Math.min.apply(null,matrix.reduce(function(all,row){return all.concat(row.filter(Boolean).map(function(r){return r.seconds;}));},[]));selection=p?{depart:times[indices[0]],back:returns[indices[1]],profile:p}:null;summary.textContent=p?Math.round(p.seconds/60)+' driving minutes · +'+Math.round((p.seconds-bestSeconds)/60)+' min vs the least congested tested trip · finish about '+new Date(p.arrival).toLocaleString()+'. Known stop delays included.':manual?'This pair has no usable forecast, arrives too late, or starts the return before you reach the destination.':'No usable forecast for this time / arrival deadline.';use.disabled=!p;use.classList.remove('hidden');if(focused&&host.querySelector('#'+focused))host.querySelector('#'+focused).focus();
            }
            draw();
          }catch(e){answer.textContent=e.message;}finally{button.disabled=false;b.querySelector('#tfCancel').classList.add('hidden');if(end)end();}
        };
        use.onclick=function(){if(!selection||JSON.stringify((context.snapshot()||{}).key)!==owner)return;cancel=true;var picked=selection;close();context.accept(local(picked.depart),manual?local(picked.back):null);};
      });
    }
    function bind(){var t=document.getElementById('tTraffic'),find=document.getElementById('tFindDeparture');if(t)t.onchange=function(){A.S.trip.trafficForecast=t.checked;A.save();context.invalidate();};if(find)find.onclick=picker;}
    return {enabled:enabled,profile:profile,model:model,prepare:prepare,html:html,bind:bind,picker:picker};
  }
  root.TrafficFlow={init:init};
})(window);
