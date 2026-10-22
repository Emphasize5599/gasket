/* Weather-aware EV/H2 research integration. No network, DOM, credentials or gasoline curves.
 * TUM one-car measured profile is explicit opt-in; all other profiles remain estimates.
 * Sources/limits: docs/PROPULSION_MODELS.md and THIRD_PARTY_NOTICES.md. */
(function initPropulsion(root, DATA) {
  'use strict';
  var cs=DATA.curve.map(function(r){return r[0]/100;}),ci=DATA.curve.map(function(r){return r[1];}),cv=DATA.curve.map(function(r){return r[2];}),ct=DATA.curve.map(function(r){return r[3];}),tx=[5].concat(DATA.derate.map(function(r){return r[0];}),[46]),fy=[.1].concat(DATA.derate.map(function(r){return r[1];}),[1]);
  // The first bins include a session-start ramp, not a low-SOC acceptance dip.
  // Match the reference's reverse cumulative maximum envelope once at startup.
  for(var ai=ci.length-2;ai>=0;ai--)ci[ai]=Math.max(ci[ai],ci[ai+1]);
  function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
  function lerp(x,xs,ys){if(x<=xs[0])return ys[0];for(var i=1;i<xs.length;i++)if(x<=xs[i])return ys[i-1]+(ys[i]-ys[i-1])*(x-xs[i-1])/(xs[i]-xs[i-1]);return ys[ys.length-1];}
  function mark(flags,s){if(flags.indexOf(s)<0)flags.push(s);}
  function config(input){var p=Object.assign({kind:'ev',profile:'estimate',capacity:60,dcKw:150,acKw:7.2,precondition:false},input||{});p.capacity=Math.max(.1,+p.capacity||60);p.measured=p.kind==='ev'&&p.profile==='tum-m3-lfp';return p;}
  function weather(points,mi,at,flags){
    if(!points||!points.length){mark(flags,'weather_missing');return 20;}
    var p=points[0];points.forEach(function(x){if(Math.abs(x.mi-mi)<Math.abs(p.mi-mi))p=x;});var a=p.hours||[],i=0;
    while(i+1<a.length&&a[i+1][0]<=at)i++;
    if(!a.length||at<a[0][0]||at>=a[a.length-1][0]+3600000){mark(flags,'weather_outside_forecast');return 20;}
    return a[i][1];
  }
  function hvac(t,p){if(p.heatPump)return lerp(t,[-10,0,10,20,30,35],[1.6,1,.5,.2,.6,1]);return lerp(t,[-10,5,10,15,20,25,30,35,45],[1.8,1.8,1.1,.7,.43,.2,.6,1,1.6]);}
  function heat(p,power,t,flags){
    if(t< -8.75||t>45)mark(flags,'pack_temperature_outside_fit');if(Math.abs(power)>60)mark(flags,'heat_power_clipped');
    var q=p.measured?DATA.q:[.2,.001,0],v=Math.min(60,Math.abs(power));
    return 1000*(q[0]+q[1]*v*v+q[2]*v*v*Math.max(0,20-Math.max(-10,t)));
  }
  function thermal(p,t,ta,power,seconds,driving,extra,flags){
    var c=p.measured?479000:p.capacity*8600,ua=p.measured?(driving?DATA.ua:22.2):c/(6*3600);
    var next=t+seconds*(heat(p,power,t,flags)+(extra||0)-ua*(t-ta))/c;
    var cool=next>45?(next-45)*c/3.6e6/2:0;
    return {temperature:Math.min(next,45),cool:cool};
  }
  function drivePower(p,mph,ta,baseGpm,baseMph,flags,grade){
    if(ta< -8.5||ta>32.5)mark(flags,'ambient_outside_measured');
    var speed=Math.max(1,mph),kmh=speed*1.609344,v=kmh/3.6,base;
    if(p.kind==='h2'){
      mark(flags,'hydrogen_speed_unvalidated');mark(flags,'hydrogen_temperature_unknown');
      function h(vv){var w=vv/3.6,power=(182+2.46*w+.26*w*w)*w/900+ .4;return power/(clamp(.64-.0018*power,.45,.64)*33.32)/vv;}
      return {power:baseGpm*speed*(h(kmh)/h(Math.max(1,baseMph)*1.609344)),gpm:baseGpm*(h(kmh)/h(Math.max(1,baseMph)*1.609344))};
    }
    if(p.measured&&mph>=30){var c=DATA.poly;base=(c[0]+c[1]*v+c[2]*v*v+c[3]*v*v*v)/1000*.97*(1+.12*clamp((15-ta)/15,0,4/3))+hvac(ta,p);}
    else {
      mark(flags,'vehicle_profile_estimated');
      function road(x){var w=x*1.609344/3.6;return .4+(182+2.46*w+.26*w*w)*w/900;}
      // Preserve the existing EPA/observed baseline. Only speed changes and additional
      // weather HVAC demand modify it; EPA labels are not steady-speed test points.
      base=baseGpm*speed*road(speed)/road(Math.max(1,baseMph))+Math.max(0,hvac(ta,p)-hvac(20,p));
    }
    if(mph*1.609344<15||mph*1.609344>160)mark(flags,'speed_outside_measurements');
    var g=1750*9.81*(grade||0)*v/1000;g=g>0?g/.9:g*.8;
    return {power:base+g,gpm:(base+g)/speed};
  }
  function accept(p,soc,t,flags,level){
    if(level&&level!=='dc_fast')return Math.min(p.acKw||7.2,level==='1'?1.4:1e6)*(soc>.9?Math.max(.2,(1-soc)/.1):1);
    if(!p.measured){mark(flags,'charging_curve_estimated');if(t<10||t>35)mark(flags,'charging_temperature_response_unknown');return p.dcKw*lerp(soc,[0,.2,.3,.4,.5,.6,.7,.8,.9,1],[1,.98,.96,.91,.83,.74,.63,.5,.34,.1]);}
    var current=lerp(soc,cs,ci),voltage=lerp(soc,cs,cv),warm=lerp(soc,cs,ct);
    if(soc<.19)mark(flags,'charging_soc_extrapolated');if(soc>.83){mark(flags,'charging_soc_extrapolated');current*=Math.max(0,1-.85*(soc-.83)/.17);}
    if(t<19)mark(flags,'charging_temperature_extrapolated');
    return Math.min(p.dcKw,current*voltage/1000*Math.min(1,lerp(t,tx,fy)/lerp(warm,tx,fy)));
  }
  function charge(input){
    var p=config(input.profile),flags=[],soc=input.soc,target=input.target,t=input.temperature,seconds=0,terminal=0,auxE=0,stored=0,billed=0,cap=input.cap==null?1:input.cap;
    if(!Number.isFinite(soc)||!Number.isFinite(target)||soc<0||soc>1||target<0||target>1)return {ok:false,reason:'invalid_soc',flags:flags};
    if(target>cap+1e-8)return {ok:false,reason:'target_above_cap',flags:flags};
    var maxSeconds=input.timeout==null?14400:input.timeout,level=input.level||'dc_fast',eta=level==='dc_fast'?(p.measured?.933:.93):level==='1'?.82:.9;
    var kw=Number.isFinite(input.kw)?input.kw:50,share=input.share==null?1:clamp(input.share,0,1),cable=level==='dc_fast'?.98:1;
    if(input.basis!=='dc_meter'&&input.basis!=='ac_meter')mark(flags,'billing_basis_estimated');
    while(soc<target-1e-10){
      if(seconds>=maxSeconds-1e-8){if(input.allowPartial)break;return {ok:false,reason:'charge_timeout',flags:flags};}
      var ta=input.ambient?input.ambient(seconds,flags):20,aux=.37+hvac(ta,p),inlet=kw*share*cable,hi=Math.min(accept(p,soc,t,flags,level),Math.max(0,inlet-aux)),lo=0;
      for(var k=0;k<24;k++){var mid=(hi+lo)/2,dt=Math.min(10,maxSeconds-seconds,(target-soc)*p.capacity*3600/Math.max(mid*eta,1e-12)),th=thermal(p,t,ta,mid,dt,false,0,flags);if(mid+aux+th.cool*3600/dt<=inlet+1e-10)lo=mid;else hi=mid;}
      if(lo<1e-6)return {ok:false,reason:'charger_power_insufficient',flags:flags};
      var dt=Math.min(10,maxSeconds-seconds,(target-soc)*p.capacity*3600/(lo*eta)),th=thermal(p,t,ta,lo,dt,false,0,flags),et=lo*dt/3600,ea=aux*dt/3600+th.cool;
      t=th.temperature;terminal+=et;auxE+=ea;stored+=et*eta;soc=Math.min(target,soc+et*eta/p.capacity);seconds+=dt;
      // EPFL conversion belongs only to an explicitly AC-metered DC dispenser.
      billed+=(et+ea)/cable/(input.basis==='ac_meter'&&level==='dc_fast'?.847:1);
    }
    return {ok:true,minutes:seconds/60,terminalKWh:terminal,auxKWh:auxE,billedKWh:billed,storedKWh:stored,soc:soc,temperature:t,flags:flags,estimated:!p.measured||flags.length>0};
  }
  function project(model,spec,context,plan){
    var p=config(spec),ctx=context||{},flags=[],segments=[],events=[],at=0,seconds=0,gal=Number(ctx.startGal)||0,temperature,initialTime=ctx.departAt||Date.now(),capacity=p.capacity,limits=ctx.limits||[];
    var firstTa=weather(ctx.weather,0,initialTime,flags);temperature=Number.isFinite(p.initialTempC)?p.initialTempC:firstTa;
    if(!Number.isFinite(p.initialTempC))mark(flags,'initial_pack_temperature_estimated');
    if(p.parkHours>0&&Number.isFinite(p.previousTempC)){temperature=p.previousTempC;for(var h=0;h<p.parkHours;h+=Math.min(1,p.parkHours-h)){var dt=Math.min(1,p.parkHours-h),ta=weather(ctx.weather,0,initialTime-(p.parkHours-h)*3600000,flags);temperature=ta+(temperature-ta)*Math.exp(-dt/6);}}
    if(!p.measured)mark(flags,p.kind==='h2'?'hydrogen_speed_unvalidated':'vehicle_profile_estimated');
    (plan&&plan.stops||[]).forEach(function(s){events.push({d:s.c.d,stop:s});});
    (plan&&plan.destinationCharges||[]).forEach(function(s){events.push({d:s.d,destination:s});});
    if(ctx.waitAt)events.push({d:ctx.waitAt.d,waitUntil:ctx.waitAt.at});
    if(plan)(model.legEnds||[]).slice(0,-1).forEach(function(d){events.push({d:d,boundary:true});});
    events.sort(function(a,b){return a.d-b.d||Number(!!a.waitUntil)-Number(!!b.waitUntil);});var ei=0,ok=true,reason='',mismatch=0,stopSeconds=0,chargingMinutes=0;
    function wait(minutes,mi){for(var s=0;s<minutes*60;s+=dt){var dt=Math.min(60,minutes*60-s),ta=weather(ctx.weather,mi,initialTime+(seconds+stopSeconds+s)*1000,flags);temperature=ta+(temperature-ta)*Math.exp(-dt/(6*3600));}stopSeconds+=minutes*60;}
    function event(e){
      if(!ok)return;
      if(e.waitUntil){wait(Math.max(0,(e.waitUntil-initialTime-(seconds+stopSeconds)*1000)/60000),e.d);return;}
      if(e.boundary){if(gal<(ctx.reserve||0)-1e-7){ok=false;reason='weather_reserve_violated';}return;}
      if(e.destination){
        if(gal<(ctx.reserve||0)-1e-7&&!(plan.firstDip&&e===events[0])){ok=false;reason='weather_reserve_violated';return;}
        var d=e.destination,policy=(ctx.destinations||[]).find(function(x){return x.index===d.index;}),arrival=clamp(gal/capacity,0,1),target=policy?(policy.mode==='time'?policy.limit:Math.min(policy.limit,policy.target))/capacity:d.departGal/capacity,before=seconds+stopSeconds;
        var cr=charge({profile:p,soc:arrival,target:Math.max(arrival,Math.min(1,target)),cap:1,temperature:temperature,kw:d.kw,level:d.level==='l1'?'1':'2',basis:'ac_meter',timeout:policy&&policy.mode==='time'?policy.minutes*60:7*86400,allowPartial:!!policy&&policy.mode==='time',ambient:function(dt,f){return weather(ctx.weather,e.d,initialTime+(before+dt)*1000,f);}});
        if(!cr.ok){ok=false;reason=cr.reason;return;}
        mismatch=Math.max(mismatch,Math.abs(gal-d.arriveGal));d.arriveGal=gal;d.buyGal=cr.storedKWh;d.departGal=gal+d.buyGal;d.gridKWh=cr.billedKWh;d.cost=cr.billedKWh*d.price;d.minutes=Math.max(cr.minutes,policy&&policy.mode==='time'?policy.minutes:0);gal=d.departGal;temperature=cr.temperature;chargingMinutes+=cr.minutes;stopSeconds+=cr.minutes*60;wait(d.minutes-cr.minutes,e.d);cr.flags.forEach(function(f){mark(flags,f);});return;
      }
      var s=e.stop,det=(s.c.detourMi||0)*model.cityGpm/2;gal-=det;stopSeconds+=(s.c.detourMin||0)*30;s.etaSec=seconds+stopSeconds;mismatch=Math.max(mismatch,Math.abs(gal-s.arriveGal));
      if(plan&&gal<ctx.reserve-1e-7&&!(plan.firstDip&&e===events[0])){ok=false;reason='weather_reserve_violated';}
      if(p.kind==='h2'){var amount=Math.max(0,Math.min(capacity,s.departGal)-gal);s.arriveGal=gal;s.buyGal=amount;s.departGal=gal+amount;s.propulsion={minutes:amount,flags:['hydrogen_fill_estimated']};gal=s.departGal-det;chargingMinutes+=amount;stopSeconds+=(ctx.stopMinutes||3)*60+amount*60+(s.c.detourMin||0)*30;return;}
      var before=seconds+stopSeconds,arrival=clamp(gal/capacity,0,1),target=s.departGal/capacity;
      var r=charge({profile:p,soc:arrival,target:Math.min(1,target),cap:Math.min(1,ctx.fillCap/capacity||1),timeout:s.c.chargeLevel&&s.c.chargeLevel!=='dc_fast'?86400:14400,temperature:temperature,kw:s.c.stationKw||s.c.kw||50,level:s.c.chargeLevel||'dc_fast',share:s.c.powerShare,basis:s.c.billingBasis,ambient:function(dt,f){return weather(ctx.weather,e.d,initialTime+(before+dt)*1000,f);}});
      if(!r.ok){ok=false;reason=r.reason;s.propulsion=r;return;}
      s.arriveGal=gal;s.buyGal=r.storedKWh;s.departGal=gal+r.storedKWh;s.propulsion=r;r.price=s.c.price;r.cost=s.c.price*r.billedKWh;r.flags.forEach(function(x){mark(flags,x);});temperature=r.temperature;gal=s.departGal-det;chargingMinutes+=r.minutes;stopSeconds+=r.minutes*60+(s.buyGal>1e-8?(ctx.stopMinutes||5)*60:0)+(s.c.detourMin||0)*30;
    }
    (model.segs||[]).forEach(function(seg){
      var x=seg.from,baseMph=seg.mph||(seg.to-seg.from)/Math.max(1,(seg.t1-seg.t0))*3600;
      while(x<seg.to-1e-8){while(ei<events.length&&events[ei].d<=x+1e-8)event(events[ei++]);
        var end=Math.min(seg.to,x+1,ei<events.length?Math.max(x+1e-7,events[ei].d):Infinity),mph=Math.max(1,baseMph),lim=limits.filter(function(l){return x>=l.from-1e-7&&x<l.to-1e-7;})[0];
        if(ctx.offset!=null)limits.forEach(function(l){if(l.from>x+1e-7&&l.from<end)end=l.from;});
        if(ctx.offset!=null){if(lim&&lim.limit>0){var requested=ctx.roadOffsets&&Number.isFinite(ctx.roadOffsets[lim.road])?ctx.roadOffsets[lim.road]:ctx.offset,off=ctx.allowAbove?clamp(requested,-20,15):clamp(requested,-20,0);if(off>=0&&ctx.speedCap>0)off=lim.limit>=ctx.speedCap?0:Math.min(off,ctx.speedCap-lim.limit);var cap=Math.max(Math.min(25,lim.limit),lim.limit+off),atLimit=Math.min(mph,lim.limit);mph=Math.min(cap,1/(1/atLimit+1/cap-1/lim.limit));end=Math.min(end,lim.to);}else mark(flags,'speed_limits_missing');}
        var dt=(end-x)/mph*3600,ta=weather(ctx.weather,(x+end)/2,initialTime+(seconds+stopSeconds)*1000,flags),v=drivePower(p,mph,ta,seg.gpm,baseMph,flags,seg.grade||0),pre=0;
        var next=events.slice(ei).filter(function(e){return e.stop;})[0];if(p.precondition&&next&&(next.d-x)/mph*60<=30&&temperature<40&&p.kind==='ev'){pre=3;mark(flags,'preconditioning_estimated');}
        // Negative power is bounded by regen hardware and remaining capacity; the current
        // planner conservatively omits net regeneration (its reserve DP assumes monotone burn).
        var power=v.power+pre;if(power<0){power=-Math.min(-power,p.regenKw||50,Math.max(0,capacity-gal)*3600/dt);mark(flags,'regeneration_not_credited_to_range');}
        var th=p.kind==='ev'?thermal(p,temperature,ta,power,dt,true,pre*800,flags):{temperature:temperature,cool:0};temperature=th.temperature;
        var burn=p.kind==='ev'?Math.max(0,power*dt/3600+th.cool):Math.max(0,v.gpm*(end-x));gal-=burn;if(plan&&gal< -1e-7){ok=false;reason='energy_exhausted';}
        segments.push(Object.assign({},seg,{from:x,to:end,gpm:burn/(end-x),t0:seconds,t1:seconds+dt,mph:mph}));seconds+=dt;x=end;at=end;
      }
    });while(ei<events.length&&events[ei].d<=at+1e-7)event(events[ei++]);
    return {model:Object.assign({},model,{segs:segments,durationSec:seconds}),ok:ok,reason:reason,flags:flags,temperature:temperature,arriveGal:gal,mismatch:mismatch,stopMinutes:stopSeconds/60,chargingMinutes:chargingMinutes};
  }
  var api={config:config,weather:weather,thermal:thermal,drivePower:drivePower,charge:charge,project:project,data:DATA};
  api.workerSource='('+initPropulsion.toString()+')(self,'+JSON.stringify(DATA)+');';
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Propulsion=api;
})(typeof self!=='undefined'?self:globalThis, {"poly":[200.81489647399306,229.88894453443953,0.6664311449270052,0.31462076245578136,"P_batt[W]=p0+p1 v+p2 v^2+p3 v^3, v m/s; 15-160 km/h, no HVAC, pack 23-36 C"],"q":[0.5795146619592638,0.001318002626609009,0.00014348017899144428],"ua":67.52700904840431,"curve":[[19,117.373,350.44,34],[20,348.758,363.994,34],[21,429.083,370.184,34],[22,390.33,369.705,34.5],[23,355.074,368.787,35],[24,332.732,368.151,35.5],[25,320.784,367.858,36.25],[26,314.95,367.772,36.5],[27,312.075,367.733,37],[28,310.527,367.748,37.25],[29,309.838,367.805,37.5],[30,308.129,367.774,38],[31,306.015,367.694,38.25],[32,304.228,367.674,38.5],[33,303.005,367.613,39],[34,302.087,367.6,39.25],[35,301.33,367.593,39.625],[36,300.565,367.541,39.75],[37,300.053,367.576,40.25],[38,299.141,367.505,40.5],[39,298.49,367.509,40.75],[40,297.691,367.446,41.25],[41,296.808,367.468,41.5],[42,295.65,367.51,41.75],[43,294.237,367.41,42],[44,292.908,367.487,42.5],[45,291.047,367.383,42.75],[46,289.317,367.453,43],[47,287.522,367.325,43.5],[48,284.925,367.321,43.75],[49,282.695,367.323,44],[50,280.202,367.245,44.25],[51,277.413,367.177,44.5],[52,274.397,367.084,44.75],[53,271.401,367.056,45],[54,267.813,366.899,45.25],[55,264.41,366.885,45.5],[56,260.894,366.88,45.75],[57,257.027,366.768,46],[58,253.089,366.673,46.25],[59,248.096,366.564,46.25],[60,243.88,366.466,46.5],[61,239.09,366.329,46.75],[62,235.058,366.294,46.75],[63,230.688,366.191,47],[64,226.379,366.145,47],[65,221.54,366.007,47.25],[66,217.143,365.943,47.25],[67,213.456,365.868,47.25],[68,209.034,365.795,47.5],[69,204.772,365.675,47.5],[70,200.891,365.602,47.5],[71,196.752,365.535,47.5],[72,192.691,365.461,47.5],[73,188.65,365.38,47.5],[74,184.677,365.303,47.5],[75,180.683,365.218,47.5],[76,175.775,365.12,47.5],[77,171.795,365.05,47.5],[78,167.227,364.968,47.25],[79,162.787,364.89,47.25],[80,158.467,364.782,47],[81,153.773,364.703,47],[82,148.635,364.594,47],[83,145.312,364.508,46.75]],"derate":[[19,0.29],[20,0.325],[21,0.371],[22,0.396],[23,0.425],[24,0.449],[25,0.47],[26,0.487],[27,0.502],[28,0.521],[29,0.541],[30,0.559],[31,0.576],[32,0.596],[33,0.617],[34,0.641],[35,0.67],[36,0.691],[37,0.718],[38,0.746],[39,0.778],[40,0.791]]});
