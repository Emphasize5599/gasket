/* Gasket — trip planner screens. Import a Google Maps route, find priced stations along it,
 * pick the stops that actually save money, and send the route (with stops) back to Google Maps. */
(function () {
  'use strict';
  var A = window.__app, T = window.Trip, P = A.P, S = A.S, N = A.N, map = A.map, $ = A.$;
  var esc = A.esc, priceHtml = A.priceHtml;

  // ---------- persistent inputs ----------
  S.trip = Object.assign({ link: '', from: '', to: '', milesLeft: '', bufferMi: 40, bufferFloor: 10, fillUp: false, minSave: 1,
    arrive: 'buffer', topUpMi: 1.0, returnTrip: false, tankPrice: '', maxDetourMin: 10, altCompare: false, altMinSave: 5,
    avoid: { tolls: false, highways: false, ferries: false } }, S.trip || {});
  ['linkSliders','slowMode','maxUnder','timeValue'].forEach(function(k){delete S.trip[k];});
  // Consent is session state, never a global default or inferred from a matching route link.
  Object.defineProperty(S.trip,'routeChoices',{value:{},writable:true,configurable:true,enumerable:false});

  // ---------- native calls as promises ----------
  var nid = 900000, waiting = {};
  window.onNativeResult = function (id, res) { var f = waiting[id]; if (f) { delete waiting[id]; f(res); } };
  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve) {
      var id = ++nid, timer;
      waiting[id] = function (res) { clearTimeout(timer); resolve(res); };
      // A native WebView can fail before its page reader starts. Bound Tire Rack calls here too, and remove the waiter.
      var discovery=fn==='siteRead'&&/^gasweb(?:[2-9]|[1-4]\d|50)?$/.test(args[0])&&/"mode"\s*:\s*"discover"/.test(args[1]||'');
      var timeout = fn === 'siteRead' && args[0] === 'tirerack' ? 80000 : fn === 'siteRead' && /^gasweb(?:[2-9]|[1-4]\d|50)?$/.test(args[0]) ? (discovery?215000:45000) : fn === 'siteRead' && /^(walmart|murphy)$/.test(args[0]) ? 95000 : fn === 'fetchJson' && /^https:\/\/overpass-api\.de\//.test(args[0] || '') ? 35000 : 0;
      if (fn === 'aiGenerate') timeout = 610000;   // native ends a run itself (GPU 120 s, CPU 600 s) and the GPU can fall back to the CPU mid-request
      if(fn==='siteRead'&&args[0]==='brave')timeout=40000;if(fn==='siteRead'&&args[0]==='tesla')timeout=100000;if(fn==='siteRead'&&args[0]==='chargepoint')timeout=40000;
      if(fn==='siteShow'&&args[0]==='brave')timeout=150000;
      if (fn === 'aiCommand') timeout = 15000;
      if (fn === 'visualSnapshot') timeout = 5000;
      if (timeout) timer = setTimeout(function () {
        if (fn === 'aiGenerate') try { N.aiCommand(++nid, 'cancelAdvice'); } catch (e) { }
        window.onNativeResult(id, { error: (/^ai/.test(fn) ? 'Local AI' : args[0] === 'tirerack' ? 'Tire Rack' : 'Keyless') + ' lookup timed out', code: 'timeout' });
      }, timeout);
      try { N[fn].apply(N, [id].concat(args)); }
      catch (e) { window.onNativeResult(id, { error: String(e && e.message || e), code: 'bridge' }); }
    });
  }
  var progH = {};
  window.onNativeProgress = function (id, done, total) { var f = progH[id]; if (f) f(done, total); };
  window.onSiteProgress = function (key, id, done, total) { var f = progH[key + ':' + id]; if (f) f(done, total); };
  /** like call(), with a progress callback (done, total) */
  function callP(onProg, fn) {
    var args = Array.prototype.slice.call(arguments, 2);
    return new Promise(function (resolve) {
      var id = ++nid; waiting[id] = function (r) { delete progH[id]; resolve(r); }; progH[id] = onProg;
      N[fn].apply(N, [id].concat(args));
    });
  }
  var LG = window.FLog || { error: function () {}, warn: function () {}, info: function () {}, debug: function () {}, trace: function () {} };
  // what happened on the last trip, for the troubleshooting report
  var dbg = {};
  var siteWait = {};
  window.__tripSite = function (key, id, res) {
    var f = siteWait[key + ':' + id]; if (!f) return false;
    delete siteWait[key + ':' + id]; f(res); return true;
  };
  function site(key, args, timeoutMs, onProg) {
    var endTask=window.Tasks&&A.job&&A.job()&&/^(walmart|murphy)$/.test(key)?Tasks.begin('station-source:'+key,{parent:'stations',text:'Checking '+(key==='walmart'?'Walmart':'Murphy')+' website prices',parentLabels:key==='walmart'?['Checking Walmart website prices','Reading Walmart prices']:['Checking Murphy website prices','Reading Murphy prices'],pendingId:'trip-pending:'+key}):null;
    return new Promise(function (resolve) {
      var id = ++nid, k = key + ':' + id;
      siteWait[k] = function (r) { delete progH[k]; resolve(r); };
      if (onProg) progH[k] = onProg;
      setTimeout(function () { if (siteWait[k]) { delete siteWait[k]; delete progH[k]; LG.warn('site', key + ' timed out'); resolve({ error: 'timed out' }); } }, timeoutMs || 90000);
      N.siteSearch(key, id, JSON.stringify(args));
    }).finally(function(){if(endTask)endTask();});
  }

  // ---------- state ----------
  var route = null;      // parsed link {stops, avoid, mode}
  var model = null;      // T.buildRoute result
  var rawRoute = null;   // Routes API route
  var result = null;     // plan + candidates
  var alts = [], altSel = 0, altSure = false;   // Google's route options for this trip
  var routeReview=null,choiceComplete=false,choicePool=null,choicePlanning=false,choiceCandidates=new Map();
  function routeFlow(){return !!S.trip.altCompare&&hzLegs()>0;}
  var choiceOwner=S.carId,choiceSavedId=null,choiceChecked=false,choiceReviewedAt=0,choiceEpoch=0;
  function choiceOwnerSync(){
    if(choiceSavedId&&route&&route.histId!==choiceSavedId)resetChoices();
    if(choiceOwner===S.carId)return;
    choiceOwner=S.carId;S.trip.routeChoices={};choiceChecked=false;choiceReviewedAt=0;choiceEpoch++;
    routeReview=null;choiceComplete=false;choicePool=null;result=null;stopRecommendations();
    if($('tRememberRoutes'))$('tRememberRoutes').checked=Garage.car().rememberRouteChoices===true;
  }
  function choiceAnswers(){choiceOwnerSync();return S.trip.routeChoices||(S.trip.routeChoices={});}
  function resetChoices(savedId){S.trip.routeChoices={};choiceOwner=S.carId;choiceSavedId=savedId||null;choiceChecked=false;choiceReviewedAt=0;choiceEpoch++;routeReview=null;choiceComplete=false;choicePool=null;}
  function rememberedChoices(previous){
    var records=Object.assign({},previous||{}),c=Garage.car();
    if(c.rememberRouteChoices===true&&choiceReviewedAt&&Object.keys(choiceAnswers()).length)
      records[c.id]={answers:JSON.parse(JSON.stringify(choiceAnswers())),reviewedAt:choiceReviewedAt};
    else if(c.rememberRouteChoices!==true)delete records[c.id];
    return records;
  }
  function saveChoices(clear){
    if(!choiceSavedId)return;
    var o=A.KV.get('trips','trip|'+choiceSavedId);if(!o||!o.v)return;
    o.v.routeChoicesByVehicle=rememberedChoices(o.v.routeChoicesByVehicle);
    if(clear===true)delete o.v.routeChoicesByVehicle[S.carId];
    if(o.v.trip)delete o.v.trip.routeChoices;
    A.KV.put('trips','trip|'+choiceSavedId,o.v);
  }
  async function restoreChoices(){
    choiceOwnerSync();if(choiceChecked)return;choiceChecked=true;
    var c=Garage.car(),o=choiceSavedId&&A.KV.get('trips','trip|'+choiceSavedId),record=o&&o.v&&o.v.routeChoicesByVehicle&&o.v.routeChoicesByVehicle[c.id];
    if(c.rememberRouteChoices!==true||!record||!record.answers||!Number.isFinite(record.reviewedAt)||record.reviewedAt<=0||!Object.keys(record.answers).length)return;
    var epoch=choiceEpoch,age=Math.max(0,Date.now()-record.reviewedAt),old=age>=3600000;
    var ok=await A.confirmDel({always:true,title:'Remembered alternative routes',body:'Your alternative-route selections were remembered for this saved trip and this vehicle only.<br><br>'+(old?'<strong>These selections are over an hour old. Review them: forecasts have likely changed.</strong>':'Review these selections if it has been more than an hour; forecasts have likely changed.')+'<br><br>Fresh hazard checks still run. Remembered choices are not a safety approval.',action:'Use remembered',no:'Review again',goClass:'primary'});
    if(epoch!==choiceEpoch||c.id!==S.carId)return;
    if(ok){S.trip.routeChoices=JSON.parse(JSON.stringify(record.answers));choiceReviewedAt=record.reviewedAt;}
    else {S.trip.routeChoices={};choiceReviewedAt=0;saveChoices(true);}
    gateTabs();
  }
  function choiceLists(){return Array.from({length:hzLegs()},function(_,i){return hzAlts(i);});}
  function choiceSelections(){return choiceLists().map(function(_,i){return hzSel(i);});}
  function choiceEntries(){return RouteChoices.entries(choiceLists(),choiceSelections(),choiceAnswers());}
  function choicePending(){return routeFlow()?RouteChoices.pending(choiceLists(),choiceSelections(),choiceAnswers()):[];}
  function reviewShow(item){routeReview=item||null;if(item)hzLeg=item.leg;hzFitKey=null;renderHz();drawHaz();hzPill();navRender();tpBody().scrollTop=0;hzLoadLeg(hzLeg);return !!item;}
  function reviewStart(){return reviewShow(choicePending()[0]);}
  function reviewOrder(){return RouteChoices.pending(choiceLists(),choiceSelections(),{});}
  function reviewBack(){if(!routeReview)return;var order=reviewOrder(),at=order.findIndex(function(x){return x.key===routeReview.key;});if(at>0)reviewShow(order[at-1]);else{hzLeg=Math.max(0,hzLegs()-1);reviewShow(null);}}
  async function reviewAnswer(yes){if(!routeReview)return;var current=routeReview;if(yes&&!await hzConfirmRisk(hzAlts(current.leg)[current.k],current.leg,function(){return routeReview===current;}))return;if(routeReview!==current)return;var id=current.key,order=reviewOrder(),at=order.findIndex(function(x){return x.key===id;});choiceAnswers()[id]=Object.assign({},choiceAnswers()[id],{consider:yes});if(!choiceReviewedAt)choiceReviewedAt=Date.now();saveChoices();routeReview=null;choiceComplete=false;result=null;A.save();if(!reviewShow(order[at+1]))advance(ST_ADJ);}
  // Trip-wide, optional recommendations. Planning reuses the unique approved legs' station projections.
  var recommendationMissing={speed:0,stations:0,routes:[]},recommendationTollGaps=0, recommendations=[], recommendationBase=null, recommendationPlan=null, recommendationEpoch=0, recommendationState='idle', recommendationPage=0, recommendationDeclined=0, recommendationMaps=[], recommendationObserver=null, recommendationSpeeds=new Map();
  function choiceCost(r){var p=r&&r.plan;if(!p||!p.ok)return null;return T.account(r.startGal,startRate(p),[{stops:T.purchases(p),arriveGal:p.arriveGal}]).legs[0].cost;}
  function recommendationRaw(sel){if(!legsMode())return alts[sel[0]];return Object.assign(T.joinRoutes(route.legs.map(function(l,i){return l.alts[sel[i]];})),{_sel:sel.slice(),description:sel.map(function(k,i){return route.legs[i].alts[k].description||'Leg '+(i+1);}).join(' / ')});}
  function clearRecommendationMaps(){if(recommendationObserver)recommendationObserver.disconnect();recommendationObserver=null;recommendationMaps.forEach(function(m){m.remove();});recommendationMaps=[];}
  function stopRecommendations(){recommendationEpoch++;choicePlanning=false;if(recommendationState==='running')recommendationState='cancelled';if(window.Tasks)Tasks.remove('route-comparison');}
  function recommendationActive(){return step===ST_STOPS&&routeFlow()&&!choiceComplete;}
  var SPEED_TRIES=3;   // automatic tries per route before the comparison says it couldn't read them (and offers Try again)
  // The other routes' speed limits, one route at a time (all at once they took 30-40 s each with errors, past the old
  // 15 s wait, and every combination was skipped); each is quick alone and kept 90 days. A failed lookup is asked again by itself (SPEED_TRIES in all, 2 s / 4 s apart).
  async function prepareRecommendationSpeeds(valid,onProg,override){
    if(!valid())return;
    recommendationSpeeds.clear();var entries=override||choiceEntries(),sf=Garage.speedFn&&Garage.speedFn(),todo=[];
    entries.forEach(function(item){
      if(item.primary){var from=item.leg?(model.legEnds[item.leg-1]||0):0,to=model.legEnds[item.leg]||model.totalMi;recommendationSpeeds.set(item.key,(result.opts.model.speedRates||[]).filter(function(r){return r.to>from&&r.from<to;}).map(function(r){return {from:Math.max(from,r.from)-from,to:Math.min(to,r.to)-from,rate:r.rate};}));return;}
      var m=hzModel(item.route);if(!sf||speedOff(m)){recommendationSpeeds.set(item.key,[]);return;}
      todo.push({item:item,m:m});
    });
    for(var i=0;i<todo.length&&valid();i++){
      var m=todo[i].m;if(onProg)onProg(i,todo.length);
      for(var attempt=0;attempt<SPEED_TRIES&&valid();attempt++){
        if(m._lim&&m._lim.error){m._lim=null;await new Promise(function(r){setTimeout(r,2000*attempt);});if(!valid())return;}
        ensureLimits(m);var until=Date.now()+120000;
        while(valid()&&m._lim==='loading'&&Date.now()<until)await new Promise(function(r){setTimeout(r,100);});
        if(m._lim&&m._lim!=='loading'&&!m._lim.error)break;
      }
      if(!valid())return;
      if(!m._lim||m._lim==='loading'||m._lim.error)continue; // Do not advertise savings by dropping unknown cruising-speed costs.
      var secs=flatSecs(m);recommendationSpeeds.set(todo[i].item.key,T.speedRates(secs,secs.map(function(sc){return Garage.ruleOff(sc.limit);}),sf.f,sf.lo,sf.hi));
    }
  }
  function recommendationOpts(m,g,sel){var o=makeBaseOpts(m,g.cands,result.startGal),rates=[];choiceLists().forEach(function(list,i){var from=i?(m.legEnds[i-1]||0):0;rates=rates.concat((recommendationSpeeds.get(RouteChoices.key(i,list[sel[i]]))||[]).map(function(r){return {from:from+r.from,to:from+r.to,rate:r.rate};}));});o.model=T.withSpeeds(m,rates);o.bufferGal=result.bufMi*m.combGpm;o.arriveGal=o.bufferGal;o.maxDetourMin=result.opts.maxDetourMin;o.refPrice=result.plan.refPrice;return o;}
  async function startRecommendations(){
    if(!recommendationActive()||!result||!result.plan.ok)return;
    if(recommendationBase===result&&recommendationPlan===result.plan&&recommendationState!=='idle')return;
    stopRecommendations();var epoch=recommendationEpoch,base=result,basePlan=result.plan,owner=route,cm=carModel(),current=choiceSelections(),iterator=RouteChoices.combinations(choiceLists(),current,choiceAnswers());
    recommendations=[];recommendationPage=0;recommendationDeclined=0;recommendationBase=base;recommendationPlan=basePlan;recommendationState='running';choicePlanning=true;
    var miss={speed:0,stations:0,routes:[]};recommendationMissing=miss;
    var total=iterator.total-1,done=0,missing=0,tollGaps=0,baseCost=choiceCost(base),baseTime=routeMin({model:model,res:base}),baseTolls=tripTolls(recommendationRaw(current));
    function valid(){return epoch===recommendationEpoch&&route===owner&&result===base&&result.plan===basePlan;}
    function progress(){if(window.Tasks)Tasks.upsert('route-comparison',{text:'Comparing trips '+done+' / '+total,frac:total?done/total:1,cancel:function(){stopRecommendations();recommendationState='cancelled';renderResults();}});}
    progress();
    try{
      await breathe();
      await prepareRecommendationSpeeds(valid,function(i,n){if(window.Tasks)Tasks.upsert('route-comparison',{text:'Getting speed limits for the other routes '+i+' / '+n,frac:n?i/n:1,cancel:function(){stopRecommendations();recommendationState='cancelled';renderResults();}});});
      progress();
      // a few combinations in flight at once, one per planner worker (lazily: the product can be huge)
      var flight=[],width=window.Planner&&Planner.size?Planner.size():1;
      async function settle(job){var p=await job.p;if(!valid())return false;var sel=job.sel,m=job.m,opts=job.opts,raw=job.raw;
        // tolls count: the trip's fuel plus its tolls against yours; an unknown toll amount can't be compared
        var td=window.Tolls?Tolls.diff(tripTolls(raw),baseTolls):0;if(td==null&&p.ok){tollGaps++;done++;progress();return true;}
        if(p.ok&&!p.firstDip){var res={plan:p,startGal:base.startGal,opts:opts},saves=baseCost-choiceCost(res)-(td||0);
          if(saves>0.005&&saves+1e-8>=Math.max(0,Number(S.trip.altMinSave)||0))recommendations.push({sel:sel.slice(),saves:saves,tollDiff:td||0,extraMin:routeMin({model:m,res:res})-baseTime,delays:evDelays(p,m,opts,sel),description:raw.description||'Alternative trip'});
        }
        done++;progress();return true;}
      for(var next=iterator.next();!next.done;next=iterator.next()){
        var sel=next.value;if(sel.every(function(k,i){return k===current[i];}))continue;
        if(!valid())return;
        await breathe();var raw=recommendationRaw(sel),m=T.buildRoute(raw,cm),g=cachedChoiceCandidates(raw,m);
        if(!g||g.guessed||sel.some(function(k,i){return !recommendationSpeeds.has(RouteChoices.key(i,choiceLists()[i][k]));})){
          missing++;done++;
          // what was missing, per leg route: its stations (search them again) or its speed limits (try again)
          sel.forEach(function(k,i){var a=choiceLists()[i][k],key=RouteChoices.key(i,a),why=!choiceCandidates.has(key)||choiceCandidates.get(key).guessed?'stations':!recommendationSpeeds.has(key)?'speed':null;if(!why)return;miss[why]++;var name=(a.description||'Route')+(choiceLists().length>1?' on leg '+(i+1):'');if(why==='stations'&&miss.routes.indexOf(name)<0)miss.routes.push(name);});
          progress();continue;}
        var opts=recommendationOpts(m,g,sel);flight.push({sel:sel.slice(),m:m,opts:opts,raw:raw,p:planAsync(opts)});
        if(flight.length>=width&&!await settle(flight.shift()))return;
      }
      while(flight.length)if(!await settle(flight.shift()))return;
      if(!valid())return;
      recommendations.sort(function(a,b){return b.saves-a.saves;});recommendationState=missing?'incomplete':'done';recommendationTollGaps=tollGaps;
      LG.info('routes','Whole-trip comparison complete',{checked:done,missing:missing,tollsUnknown:tollGaps,qualifying:recommendations.length});
    }catch(e){if(valid()){recommendationState='error';LG.warn('routes','Trip comparison failed',String(e&&e.message||e));}}
    finally{if(epoch===recommendationEpoch){choicePlanning=false;if(window.Tasks)Tasks.remove('route-comparison');if(recommendationActive())renderResults();}}
  }
  function recommendationsHtml(){
    var h='<div class="card"><h3>Cheaper trips</h3><p class="lead small keep">Your buffer and maximum detour apply to the entire trip. Next keeps your current trip; choosing an alternative is optional.</p></div>';
    if(recommendationState==='running')h+=A.ldBar('Comparing approved route combinations… You can continue without waiting.');
    if(recommendationTollGaps&&recommendationState!=='running')h+='<div class="note">'+recommendationTollGaps+' trip'+(recommendationTollGaps===1?' wasn\'t':'s weren\'t')+' compared: their tolls aren\'t known. Type the amounts in Route\'s Tolls card.</div>';
    var rm=recommendationMissing;
    if(recommendationState==='incomplete'){
      if(rm.stations)h+='<div class="note">Some trips weren\'t compared: no stations were searched along '+esc(rm.routes.join(', '))+'.<div class="proposal-buttons"><button class="btn tonal" data-rec-scan>Search '+(rm.routes.length===1?'that route':'those routes')+'</button></div></div>';
      if(rm.speed)h+='<div class="note">Some trips weren\'t compared: the speed limits along '+(rm.speed===1?'one route':'some routes')+' couldn\'t be read after '+SPEED_TRIES+' tries.<div class="proposal-buttons"><button class="btn tonal" data-rec-retry>Try again</button></div></div>';
      h+='<div class="note">Your current trip is unchanged.</div>';
    }
    if(recommendationState==='error'||recommendationState==='cancelled')h+='<div class="note">Comparison '+(recommendationState==='cancelled'?'cancelled':'could not finish')+'. Your current trip is unchanged.</div>';
    if(!recommendations.length&&recommendationState==='done')h+='<div class="msg">'+(recommendationDeclined?'All recommendations declined. Next keeps your current trip.':'No approved alternative saves your requested '+money(S.trip.altMinSave||0)+'.')+'</div>';
    recommendations.slice(recommendationPage*5,recommendationPage*5+5).forEach(function(r,j){var i=recommendationPage*5+j;
      h+='<div class="card trip-proposal" data-proposal="'+i+'"><div class="proposal-delta"><span>'+(Math.round(r.extraMin)>0?'+':'')+Math.round(r.extraMin)+' min</span><b class="good">−'+money(r.saves)+'</b></div><p class="lead small keep">'+esc(r.description)+(r.tollDiff?' · '+(r.tollDiff>0?money(r.tollDiff)+' more':money(-r.tollDiff)+' less')+' in tolls, counted':'')+'</p><div class="proposal-map" id="proposalMap'+i+'" aria-label="Proposed route and hazards"></div><p class="lead small keep proposal-weather">Checking forecast timing…</p><div class="proposal-buttons"><button class="btn proposal-decline" data-decline="'+i+'">Decline</button><button class="btn tonal" data-replace="'+i+'">Replace trip</button></div></div>';
    });
    if(recommendations.length>5)h+='<div class="proposal-buttons"><button class="btn tonal" id="proposalPrev"'+(!recommendationPage?' disabled':'')+'>Previous</button><span>'+ (recommendationPage+1)+' / '+Math.ceil(recommendations.length/5)+'</span><button class="btn tonal" id="proposalNext"'+((recommendationPage+1)*5>=recommendations.length?' disabled':'')+'>More trips</button></div>';
    return h;
  }
  function bindRecommendations(){
    document.querySelectorAll('[data-rec-retry]').forEach(function(b){b.onclick=function(){recommendationState='idle';recommendationBase=null;renderResults();startRecommendations();};});
    // the routes the saved trip never searched: searched now (the others keep their saved stations); the comparison runs again after
    document.querySelectorAll('[data-rec-scan]').forEach(function(b){b.onclick=function(){b.disabled=true;LG.info('routes','Search the routes the comparison lacked',{routes:recommendationMissing.routes});stopRecommendations();recommendationState='idle';findStops('missing').then(function(){if(recommendationActive()){renderResults();startRecommendations();}});};});
    if($('proposalPrev'))$('proposalPrev').onclick=function(){recommendationPage--;renderResults();};
    if($('proposalNext'))$('proposalNext').onclick=function(){recommendationPage++;renderResults();};
    document.querySelectorAll('[data-decline]').forEach(function(b){b.onclick=function(){recommendationDeclined++;recommendations.splice(+b.dataset.decline,1);recommendationPage=Math.min(recommendationPage,Math.max(0,Math.ceil(recommendations.length/5)-1));renderResults();};});
    document.querySelectorAll('[data-replace]').forEach(function(b){b.onclick=function(){replaceRecommendation(recommendations[+b.dataset.replace]);};});
    recommendationObserver=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(!entry.isIntersecting)return;recommendationObserver.unobserve(entry.target);drawRecommendation(entry.target,+entry.target.closest('[data-proposal]').dataset.proposal);});},{root:tpBody(),rootMargin:'100px'});
    document.querySelectorAll('.proposal-map').forEach(function(el){recommendationObserver.observe(el);});
  }
  async function drawRecommendation(el,i,override){
    var proposal=override||recommendations[i],epoch=recommendationEpoch;if(!proposal||!el.isConnected)return;
    var raw=recommendationRaw(proposal.sel),m=T.buildRoute(raw,carModel()),points=m.pts.map(function(p){return [p.lat,p.lng];});
    var mini=L.map(el,{zoomControl:false,scrollWheelZoom:false,tap:false,attributionControl:true});
    recommendationMaps.push(mini);mini.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,className:'osm-tiles',attribution:'© OpenStreetMap'}).addTo(mini);
    L.polyline(points,{color:'#4285f4',weight:5,interactive:false}).addTo(mini);mini.fitBounds(L.latLngBounds(points),{padding:[16,16]});
    var label=el.parentElement.querySelector('.proposal-weather');
    try{
      // Forecasts use this combination's arrival times, not the original primary legs' times.
      var at=departAt().getTime(),warnings=0;
      for(var leg=0;leg<proposal.sel.length;leg++){
        if(epoch!==recommendationEpoch||!el.isConnected)return;
        var a=choiceLists()[leg][proposal.sel[leg]];
        if(leg&&S.trip.returnTrip&&!backAuto()&&leg===proposal.sel.length-1&&S.trip.backAt)at=Math.max(at,new Date(S.trip.backAt).getTime());
        var reading=await RouteWx.forRoute(hzModel(a),wxGet,{depart:at,stops:proposal.delays[leg],stateAt:window.Limits&&Limits.stateAt,counties:loadCounties,countyOf:function(f){return window.US_COUNTIES&&US_COUNTIES[f];}});
        if(epoch!==recommendationEpoch||!el.isConnected)return;
        var stats=reading.stats||{};warnings+=(stats.errors||0)+(stats.beyondWeather||0)+(stats.beyondAir||0);
        reading.hazards.forEach(function(x){var seg=hzSlice(a,x.fromMi,x.toMi);if(seg.length>1)L.polyline(seg,{color:RouteWx.COLORS[x.kind],weight:7,interactive:false}).addTo(mini);});
        at+=parseFloat(a.duration||0)*1000+proposal.delays[leg].reduce(function(sum,s){return sum+s.min;},0)*60000;
      }
      label.textContent=warnings?'Forecast coverage is incomplete; review Hazards before departure.':'Estimated forecast hazards · includes planned stop time. Fuel stops not shown.';
    }catch(e){if(el.isConnected)label.textContent='Some forecast hazards could not be checked. Review Hazards before departure.';}
  }
  async function replaceRecommendation(proposal){
    if(!proposal||busy)return;
    stopRecommendations();var epoch=recommendationEpoch,base=result,owner=route,previous={alts:alts,sel:altSel,raw:rawRoute,model:model,selections:choiceSelections()};choicePlanning=true;
    document.querySelectorAll('[data-replace],[data-decline]').forEach(function(b){b.disabled=true;});
    if(window.Tasks)Tasks.upsert('route-comparison',{text:'Updating selected trip…',frac:null});
    try{
      var raw=recommendationRaw(proposal.sel),m=T.buildRoute(raw,carModel()),g=proposal.candidates||cachedChoiceCandidates(raw,m);
      if(!g)throw Error('Missing saved station coverage');
      var opts=recommendationOpts(m,g,proposal.sel),p=await planAsync(opts);
      if(epoch!==recommendationEpoch||route!==owner||result!==base)return;
      if(!p.ok)throw Error('No plan meets your limits');
      // Commit only after the replacement has a valid plan; failures never change the current selection.
      // The routes it replaces were your picks, so they stay approved alternatives: without an answer Hazards asked
      // about them again (and the saved stations left them out, so the next search started over).
      var lists=choiceLists(),answers=choiceAnswers();
      previous.selections.forEach(function(k,i){if(k===proposal.sel[i]||!lists[i]||!lists[i][k])return;var id=RouteChoices.key(i,lists[i][k]);answers[id]=Object.assign({},answers[id],{consider:true});});
      saveChoices();
      if(legsMode()){route.legs.forEach(function(l,i){l.sel=proposal.sel[i];});rebuildAlts();raw=alts[0];}else altSel=proposal.sel[0];
      rawRoute=raw;model=m;result={plan:p,opts:opts,cands:g.cands,notes:g.notes,unpriced:g.unpriced,stale:g.stale,grade:g.grade,startGal:base.startGal,bufMi:base.bufMi,topMi:base.topMi,topSel:-1,planOffs:''};
      choiceComplete=true;recompute();if(choicePool){var stations=Array.from(new Map((choicePool.official||[]).concat.apply(choicePool.official||[],choicePool.google||[]).map(function(s){return [P.stationKey(s),s];})).values()),ks=[altSel].concat(altCompareList());saveTrip({official:stations.map(function(s){var c=Object.assign({},s);delete c.detourExact;delete c.detourMi;delete c.detourRange;return c;}),google:ks.map(function(){return [];}),kind:choicePool.kind||'gas'},ks);}else rememberSel();startSweep();hzPreload();
      // back to Adjustments for the new trip; its Next compares the trips once more (another replacement loops again)
      choiceComplete=false;recommendationState='idle';closeLegs();step=ST_ADJ;renderStep();
    }catch(e){if(route===owner){if(legsMode())route.legs.forEach(function(l,i){l.sel=previous.selections[i];});alts=previous.alts;altSel=previous.sel;rawRoute=previous.raw;model=previous.model;result=base;choiceComplete=false;}toastMsg('Could not replace this trip. Your original trip is unchanged.');LG.warn('routes','Trip replacement failed',String(e&&e.message||e));}
    finally{if(epoch===recommendationEpoch){choicePlanning=false;if(window.Tasks)Tasks.remove('route-comparison');if(recommendationActive())renderResults();navRender();}}
  }
  function cacheChoiceCandidates(raw,m,g){
    if(!routeFlow()&&KIND()!=='ev')return;choiceLists().forEach(function(list,i){var k=legsMode()?raw._sel[i]:alts.indexOf(raw),a=list[k];if(!a)return;var from=i?(m.legEnds[i-1]||0):0,to=m.legEnds[i]||m.totalMi;
      var take=function(cs){return (cs||[]).filter(function(c){return (c.leg||0)===i;}).map(function(c){return Object.assign({},c,{d:c.d-from});});};
      var key=RouteChoices.key(i,a),had=choiceCandidates.get(key);if(g.guessed&&had&&!had.guessed)return;   // another route's guess never replaces this leg's searched stations
      var cands=take(g.cands),unpriced=take(g.unpricedCands);choiceCandidates.set(key,{cands:cands,unpricedCands:unpriced,notes:g.notes.slice(),stale:cands.filter(function(c){return c.calc&&c.calc.stale;}).length,unpriced:unpriced.length,grade:g.grade,miles:to-from,guessed:!!g.guessed,incomplete:!!g.incomplete});
    });
  }
  function cachedChoiceCandidates(raw,m){
    var result={cands:[],unpricedCands:[],notes:[],stale:0,unpriced:0,grade:gradeOf()},ok=true;
    choiceLists().forEach(function(list,i){var k=legsMode()?raw._sel[i]:alts.indexOf(raw),g=choiceCandidates.get(RouteChoices.key(i,list[k]));if(!g){ok=false;return;}var from=i?(m.legEnds[i-1]||0):0;['cands','unpricedCands'].forEach(function(field){result[field]=result[field].concat(g[field].map(function(c){var copy=Object.assign({},c,{d:from+c.d,leg:i,id:c.station.id+(i?'@'+i:'')});delete copy.detourExact;return copy;}));});result.notes=result.notes.concat(g.notes);result.stale+=g.stale;result.unpriced+=g.unpriced;});
    result.notes=Array.from(new Set(result.notes));result.guessed=choiceLists().some(function(list,i){var k=legsMode()?raw._sel[i]:alts.indexOf(raw),g=choiceCandidates.get(RouteChoices.key(i,list[k]));return g&&g.guessed;});return ok?result:null;
  }
  var layer = L.layerGroup();
  var evRecovery=null,adjustError='';
  function evFailureNotice(){
    var r=evRecovery;if(!r||r.base!==result||r.notified||r.options.length||!onPlan(step)||!document.body.classList.contains('trip-on')||['done','error'].indexOf(r.state)<0)return;
    r.notified=true;
    A.confirmDel({always:true,singleAction:true,title:'No checked route works',body:'No checked route can meet your current charging, range, buffer and detour settings.'+(r.errors.length?' Some route data could not be verified.':'')+' Return to Parameters to adjust them.',action:'Return to Parameters',goClass:'primary'}).then(function(){if(evRecovery!==r||result!==r.base||!onPlan(step))return;step=ST_PARAMS;renderStep();});
  }
  function failedPlan(){return !busy&&(!!adjustError||!!(result&&result.plan&&!result.plan.ok));}
  function evDelays(p,m,opts,sel){return sel.map(function(_,i){var from=i?(m.legEnds[i-1]||0):0;return p.stops.filter(function(s){return (s.c.leg||0)===i;}).map(function(s){return {mi:s.c.d-from,min:T.stopDelay(opts,s)};}).concat((p.destinationCharges||[]).filter(function(c){return c.index===i;}).map(function(c){return {mi:c.d-from,min:c.minutes};}));});}
  async function startEVRecovery(){
    if(KIND()!=='ev'||busy||jobCancel||searchCancelled||!result||result.plan.ok||evRecovery&&evRecovery.base===result)return;
    var r=evRecovery={base:result,state:'running',options:[],errors:[],checked:0},owner=route,carId=S.carId,selected=choiceSelections(),lists=choiceLists(),all=[];choicePlanning=true;
    lists.forEach(function(list,i){list.forEach(function(a,k){all.push({leg:i,k:k,route:a,key:RouteChoices.key(i,a),primary:k===selected[i]});});});
    function valid(){return evRecovery===r&&result===r.base&&route===owner&&S.carId===carId&&r.state==='running'&&onPlan(step);}
    function progress(text,frac){if(window.Tasks)Tasks.upsert('ev-recovery',{text:text,frac:frac,cancel:function(){r.state='cancelled';choicePlanning=false;Tasks.remove('ev-recovery');renderResults();navRender();}});}
    try{
      progress('Checking other EV routes',0);
      for(var i=0;i<all.length&&valid();i++){
        var item=all[i],g=choiceCandidates.get(item.key);
        if(!g){
          var m=hzModel(item.route),ga=await gatherAlt([m],function(f){progress('Finding chargers on other routes',(i+f)/all.length*.6);},{},null,[item.route]);
          if(!valid())return;g=ga.per[0];
          // Recovery may discover a previously unapproved leg. Keep its raw sites
          // for the other combinations and for saving an accepted replacement.
          if(!choicePool)choicePool={official:[],google:[],kind:'ev'};
          choicePool.google=(choicePool.google||[]).concat(ga.raw.google);
          choiceCandidates.set(item.key,{cands:g.cands.map(function(c){return Object.assign({},c,{leg:item.leg});}),unpricedCands:[],notes:g.notes,stale:g.stale,unpriced:g.unpriced,grade:g.grade,miles:m.totalMi,incomplete:!!g.incomplete});
        }
        if(g.incomplete&&r.errors.indexOf('Charger discovery was incomplete.')<0)r.errors.push('Charger discovery was incomplete.');
      }
      if(!valid())return;
      // Earlier candidate snapshots predate prices learned on other legs. Rebuild
      // each leg from the complete, freshly enriched union, without more web reads.
      var known=new Map(),rows=(choicePool&&choicePool.official||[]).concat.apply(choicePool&&choicePool.official||[],choicePool&&choicePool.google||[]);
      rows.forEach(function(st){var prior=known.get(st.id),copy=Object.assign({},prior||st,st);if(prior&&prior.netPrice&&(!st.netPrice||(+prior.netPrice.t||0)>(+st.netPrice.t||0))){copy.netPrice=prior.netPrice;if(prior.netPrice.src==='flo')copy.units=prior.units;}known.set(st.id,copy);});
      var priceSnapshot={localOnly:true,skipNetworkPrices:true,google:[{list:Array.from(known.values())}]};
      for(var ci=0;ci<all.length&&valid();ci++){
        var entry=all[ci],legModel=hzModel(entry.route),fresh=await gatherAlt([legModel],function(){},{},priceSnapshot,[entry.route]);if(!valid())return;
        var cg=fresh.per[0],old=choiceCandidates.get(entry.key);
        choiceCandidates.set(entry.key,{cands:cg.cands.map(function(c){return Object.assign({},c,{leg:entry.leg});}),unpricedCands:[],notes:Array.from(new Set(cg.notes.concat(old&&old.notes||[]))),stale:cg.stale,unpriced:cg.unpriced,grade:cg.grade,miles:legModel.totalMi,incomplete:!!(old&&old.incomplete)});
      }
      if(!valid())return;
      await prepareRecommendationSpeeds(valid,function(i,n){progress('Checking other routes’ speed limits',.6+.15*i/Math.max(1,n));},all);if(!valid())return;
      var answers={};all.forEach(function(item){answers[item.key]={consider:true};});var iterator=RouteChoices.combinations(lists,selected,answers),total=iterator.total-1;
      for(var next=iterator.next();!next.done&&valid();next=iterator.next()){
        var sel=next.value;if(sel.every(function(k,i){return k===selected[i];}))continue;var raw=recommendationRaw(sel),m=T.buildRoute(raw,carModel()),g=cachedChoiceCandidates(raw,m);r.checked++;
        if(!g||sel.some(function(k,i){return !recommendationSpeeds.has(RouteChoices.key(i,lists[i][k]));})){r.errors.push('Some route data could not be checked.');continue;}
        // Match manual selection exactly: a joined route's distance scale can
        // differ slightly from separately cached legs. Reproject, never rescan.
        var exact=await gatherAlt([m],function(){},{},priceSnapshot,[raw]);if(!valid())return;exact.per[0].notes=Array.from(new Set(exact.per[0].notes.concat(g.notes)));g=exact.per[0];
        var opts=recommendationOpts(m,g,sel),p=await planAsync(opts);if(!valid())return;
        LG.info('ev','Feasible route evaluated',{selection:sel,candidates:g.cands.length,ok:!!p.ok,firstDip:!!p.firstDip,reachMi:p.reachMi,stops:p.ok?p.stops.length:0,bufferMi:r.base.bufMi,maxDetourMin:opts.maxDetourMin});
        if(p.ok&&!p.firstDip)r.options.push({sel:sel.slice(),candidates:g,description:raw.description||'Alternative route',minutes:routeMin({model:m,res:{plan:p,opts:opts}}),stops:p.stops.length,delays:evDelays(p,m,opts,sel),saves:0,extraMin:0});
        progress('Checking usable EV trips '+r.checked+' / '+total,.75+.25*r.checked/Math.max(1,total));await breathe();
      }
      if(valid()){r.options.sort(function(a,b){return a.minutes-b.minutes;});r.state='done';LG.info('ev','Usable alternative routes checked',{checked:r.checked,usable:r.options.length});}
    }catch(e){if(valid()){r.errors.push(String(e.message||e));r.state='error';LG.warn('ev','Alternative route check failed',String(e.message||e));}}
    finally{if(evRecovery===r){if(r.state==='running')r.state='cancelled';choicePlanning=false;if(window.Tasks)Tasks.remove('ev-recovery');if(onPlan(step)){renderResults();navRender();evFailureNotice();}}}
  }
  function evRecoveryHtml(){var r=evRecovery,h='<div class="card"><h3>Routes that would work</h3><p class="lead small keep">These trips meet your charging, buffer and detour settings. Review their hazards before accepting.</p></div>';if(!r||!r.options.length)return h+'<div class="msg err">No checked route works yet. Adjust your parameters, or retry if discovery was incomplete.</div>';r.options.slice(r.page*5||0,(r.page*5||0)+5).forEach(function(p,i){var at=(r.page||0)*5+i;h+='<div class="card trip-proposal" data-ev-proposal="'+at+'"><div class="proposal-delta"><span>'+fmtDur(p.minutes*60)+'</span><b>'+p.stops+' charging stops</b></div><p>'+esc(p.description)+'</p><div class="proposal-map" data-ev-map="'+at+'" aria-label="Alternative route and hazards"></div><p class="lead small keep proposal-weather">Checking forecast timing…</p><div class="proposal-buttons"><button class="btn proposal-decline" data-ev-decline="'+at+'">Decline</button><button class="btn tonal" data-ev-replace="'+at+'">Accept route</button></div></div>';});if(r.options.length>5)h+='<div class="proposal-buttons"><button class="btn tonal" id="evRecoveryPrev"'+(!r.page?' disabled':'')+'>Previous</button><button class="btn tonal" id="evRecoveryMore"'+(((r.page||0)+1)*5>=r.options.length?' disabled':'')+'>More routes</button></div>';return h;}
  function bindEVRecovery(){var r=evRecovery;if(!r)return;document.querySelectorAll('[data-ev-decline]').forEach(function(b){b.onclick=function(){r.options.splice(+b.dataset.evDecline,1);r.page=Math.min(r.page||0,Math.max(0,Math.ceil(r.options.length/5)-1));renderResults();navRender();};});if($('evRecoveryMore'))$('evRecoveryMore').onclick=function(){r.page=(r.page||0)+1;renderResults();};if($('evRecoveryPrev'))$('evRecoveryPrev').onclick=function(){r.page--;renderResults();};document.querySelectorAll('[data-ev-replace]').forEach(function(b){b.onclick=async function(){var p=r.options[+b.dataset.evReplace];b.disabled=true;var owner=route;for(var i=0;i<p.sel.length;i++)if(p.sel[i]!==hzSel(i)&&!await hzConfirmRisk(hzAlts(i)[p.sel[i]],i,function(){return route===owner&&evRecovery===r;})){b.disabled=false;return;}await replaceRecommendation(p);if(result&&result.plan.ok){evRecovery=null;hzLeg=0;step=ST_HAZ;renderStep();}else b.disabled=false;};});recommendationObserver=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(!entry.isIntersecting)return;recommendationObserver.unobserve(entry.target);drawRecommendation(entry.target,0,r.options[+entry.target.dataset.evMap]);});},{root:tpBody(),rootMargin:'100px'});document.querySelectorAll('[data-ev-map]').forEach(function(el){recommendationObserver.observe(el);});}
  var busy = false;
  var priceRefreshActive=false;
  var priceCancelRequested=false;
  function savedPriceReplay(){
    if(replay)return replay;
    if(!result||!model||!alts[altSel])return null;
    var id=histId(route),o=A.KV.get('trips','trip|'+id),v=o&&o.v;
    if(!v||!v.stations||!(v.stations.google||[]).some(function(g){return (g.sig||v.alts&&v.alts[g.k]&&altSig(v.alts[g.k]))===altSig(alts[altSel]);}))return null;
    return {id:id,t:v.savedT||o.t,stations:v.stations,alts:v.alts,partial:true};
  }
  document.addEventListener('click',function(e){
    var cancel=e.target.closest('[data-cancel-prices]');
    if(cancel){priceCancelRequested=true;KeylessGas.cancel();cancel.disabled=true;cancel.textContent='Cancelling…';return;}
    var cx=e.target.closest('[data-cancel-search]');
    if(cx){cancelSearch();document.querySelectorAll('[data-cancel-search]').forEach(function(b){b.disabled=true;});document.querySelectorAll('.prog-load .pl').forEach(function(l){l.textContent='Cancelling…';});return;}
    var dd=e.target.closest('[data-split]');
    if(dd){var menu=dd.closest('.price-refresh-card').querySelector('.split-menu'),open=menu.classList.toggle('hidden')===false;dd.setAttribute('aria-expanded',String(open));return;}
    if(!e.target.closest('.split-menu'))document.querySelectorAll('.split-menu:not(.hidden)').forEach(function(m){m.classList.add('hidden');});
    var button=e.target.closest('[data-trip-refresh]');if(!button||busy)return;
    if(button.dataset.tripRefresh==='web')findStops('web');
    else if(button.dataset.tripRefresh==='discover')findStops('discover');
    else findStops(true);
  });
  var RF_ICON='<svg class="rf-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
  function refreshCard(){
    if(KIND()!=='gas'||!model)return '';
    var saved=savedPriceReplay(),web=!!saved;
    var capped=Number(S.monthlyCap)>0&&N.callsThisMonth()>=Number(S.monthlyCap),apiUnavailable=capped||!S.apiKey;
    var known=saved?(saved.stations.official||[]).slice():[];if(saved)(saved.stations.google||[]).forEach(function(g){known=known.concat(g.list||[]);});
    web=web&&known.length>0;
    var estimate=KeylessGas.estimate(known,gradeOf()),minutes=Math.max(1,Math.ceil(estimate.seconds/60));
    var webHelp='Best for price refreshes at stations already saved with this trip. No Places or Routes calls. '+(web?'Estimated '+(estimate.seconds<60?'under a minute':'about '+minutes+' minutes')+' for '+estimate.areas+' areas with '+estimate.readers+' readers'+(estimate.measured?', based on recent scans':'; initial estimate, refined while scanning')+'. Cache reuse and website restrictions affect timing. ':'Find stations first or open a saved trip to estimate the refresh time. ')+'Only explicitly published fuel-grade prices are used; missing prices remain unchanged.';
    var apiHelp='Best for station discovery along a new route. It can also refresh prices very quickly, but uses your Places API budget. Saved route geometry is reused.'+(capped?' Your monthly Places cap is reached.':'')+(!S.apiKey?' Add the recommended API key in Settings to use this option.':'');
    return '<div class="card price-refresh-card"><h3>Refresh station prices</h3>'+
      (busy?'<div class="scan-pending" aria-busy="true"><span></span><span></span></div>':
      '<div class="scan-launches"><span class="split-btn"><button class="btn primary" data-trip-refresh="web"'+(!web?' disabled':'')+'>'+RF_ICON+'No API</button>'+
        '<button type="button" class="btn primary split-dd" data-split aria-haspopup="true" aria-expanded="false" aria-label="More No API options">▾</button></span>'+A.qBtn(webHelp)+
        '<button class="btn primary" data-trip-refresh="api"'+(apiUnavailable?' disabled':'')+'>'+RF_ICON+'API</button>'+A.qBtn(apiHelp)+
        // finding stations already ran when the trip was planned: doing it again is a "force" option, tucked under No API
        '<div class="split-menu hidden"><button type="button" class="btn primary" data-trip-refresh="discover">'+RF_ICON+'Discover stations</button>'+
        A.qBtn('Searches the whole route again for stations, without the API (it already ran when you planned the trip). Slower: overlapping website searches, '+KeylessGas.readerCount(A)+' readers (Settings), with progress and Cancel. No paid fallback; your brand filters still apply.')+'</div></div>')+'</div>';
  }
  var replay = null;     // a trip opened from history: {id, t, stations} — its saved stations are used instead of new lookups
  var loadingTrip = false;   // a saved trip is being opened (its route is read just after the panel is up)

  /** Shared top-dock progress; navigation never doubles as a loading bar. */
  function prog(frac, label) {
    if (busy && A.job && A.job() && A.job().kind === 'trip') { A.jobProg(frac, label);mapLoaded(); }
    else if(routing&&window.Tasks){Tasks.upsert('route-fetch',{text:label,frac:frac});mapLoaded();}
    else if(mapLd&&mapLd.live)mapLd.set(frac,label);
    var b=$('tGetRoutes');if(routing&&b)b.disabled=true;
    routeGate();
  }
  /**
   * While stops are worked out, keep the normal tile layout as CSS placeholders.
   */
  function skelCard(title, body) { return '<div class="card skel"><div class="sk-h">' + esc(title) + '</div>' + (body || '') + '</div>'; }
  function skelRows(n) { var h = ''; for (var i = 0; i < n; i++) h += '<div class="sk-row"><span class="sk-dot"></span><span class="sk-lines"><span></span><span></span></span><span class="sk-price"></span></div>'; return h; }
  function skelStops(label) {
    return skelCard(KIND() === 'ev' ? 'Charging stops' : 'Fuel stops', skelRows(2)) +
      '<div class="gas-tiles skel-tiles">' + skelCard(KIND() === 'ev' ? 'Charge to leave with' : 'Gas to leave with', '<div class="sk-big"></div>') +
      skelCard(KIND() === 'ev' ? 'Charge when you arrive' : 'Gas when you arrive', '<div class="sk-big"></div>') + '</div>';
  }
  function skelAdjust(label) {
    return refreshCard()+tipBox() + skelCard('Buffer for this trip', '<div class="sk-slider"></div>') +
      skelCard('Max. detour per stop', '<div class="sk-slider"></div>') + skelCard('Cruising speed', '<div class="sk-slider"></div>');
  }
  function progEnd() { if(window.Tasks)Tasks.remove('route-fetch');var b=$('tNext');if(b){b.classList.remove('busy');b._sub=null;}navRender(); }
  /** Let the screen draw (a progress bar, a tapped button) before a stretch of heavy work. */
  function paint() { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); }
  // the big map, grayed out with a progress bar while the route and stops are drawn (shows only past 0.75 s)
  var mapLd = null;
  function mapLoading(label, frac) {
    if(routing||A.job&&A.job()||$('trip')&&$('trip').classList.contains('hidden')){mapLoaded();return;}
    if(!mapLd||!mapLd.live)mapLd={live:true,set:function(f,t){if(window.Tasks)Tasks.upsert('trip-draw',{text:t||label,frac:f});},done:function(){this.live=false;if(window.Tasks)Tasks.remove('trip-draw');}};
    mapLd.set(frac==null?null:frac,label);
  }
  function mapLoaded(){if(mapLd){mapLd.done();mapLd=null;}if(window.Tasks)Tasks.remove('trip-draw');}
  var routing = false, freshRoutes = false;
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function fmtDur(sec) { var m = Math.round(sec / 60), h = Math.floor(m / 60); return h ? h + ' h ' + (m % 60) + ' min' : m + ' min'; }
  function money(v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2); }
  function gradeOf() { return window.Garage ? Garage.grade() : (S.grade || 'regular'); }
  // units of the car you're planning with: gal, kWh (EV) or kg (hydrogen)
  function UN() { return window.Garage && Garage.unit ? Garage.unit() : 'gal'; }
  function KIND() { return window.Garage && Garage.kind ? Garage.kind() : 'gas'; }
  function FW() { return { gas: 'Gas', ev: 'Charge', h2: 'Hydrogen' }[KIND()]; }
  function gradeLabel(g) { return P.GRADES[g] ? P.GRADES[g].label : g === 'electric' ? 'Electric' : g === 'hydrogen' ? 'Hydrogen' : String(g || ''); }

  // ---------- the trip planner: Garage → Route → Stops → Departure ----------
  // One panel over the map, in four steps, with Back / Next pinned at the bottom. Next checks the step's required
  // fields first and points at the first one missing (red outline for a box, a pulse for something to pick).
  var STEPS = ['Garage', 'Advisory', 'Route', 'Parameters', 'Hazards', 'Adjustments', 'Stops', 'Compare', 'Departure'], step = 1;
  var ST_GARAGE = 1, ST_ADVISORY = 2, ST_ROUTE = 3, ST_HAZ = 5, ST_PARAMS = 4, ST_ADJ = 6, ST_STOPS = 7, ST_COMPARE = 8, ST_DEPART = 9;
  var compareEntries=new Map(),compareOwner=null,compareReviewed=0,compareReviewKey=null,compareEditing=false,compareSwitching=false,compareCalculating=null;
  var compareView={sort:'cost',scope:'trip',leg:0,open:{}},compareJourney=null;
  /** Adjustments and Stops both show the plan (and the map). */
  function onPlan(k) { return k === ST_ADJ || k === ST_STOPS; }
  function tpBody() { return $('tpBody'); }
  function openTrip(st) {
    A.closeDetail();
    if (st) step = st;
    document.body.classList.add('trip-on'); A.syncMain(); A.syncMapGAttr();
    if (window.Advisory) Advisory.init(call);
    renderStep();
  }
  function initPanel(pg) {
    pg.className = 'page tpanel hidden';
    pg.innerHTML = '<div class="tp-grab" id="tpGrab"><span></span></div>' +
      '<div class="tp-head"><div class="tp-steps" id="tpSteps"></div><button class="x" id="tClose" aria-label="Close">✕</button></div>' +
      '<div class="tp-body" id="tpBody"></div><div class="tp-nav" id="tpNav"></div>';
    $('tClose').onclick = function () { leaveAsk(closeTrip); };
    A.scrollHint(tpBody());
    $('tpSteps').onclick = function (e) {
      var b = e.target.closest('[data-step]'); if (!b) return;
      var k = +b.dataset.step; if (k === step || jobLocked(k)) return;
      if(k===ST_COMPARE){collectSafe();compareCapture();step=k;renderStep();return;}
      if (k < step) { collectSafe(); step = k; renderStep(); } else advance(k);
    };
    panelDrag(pg);
  }
  // Each step stays in the page once built (hidden while you're on another), so moving between steps is instant.
  // Garage and Route are only rebuilt for a new trip; Stops when the route or plan changed; Departure every time (cheap).
  var built = {}, scrolls = {}, shown = 0;
  function stepEl(k) {
    var e = $('tpS' + k);
    if (!e) { e = document.createElement('div'); e.id = 'tpS' + k; e.className = 'tp-step hidden'; tpBody().appendChild(e); }
    return e;
  }
  /** Forget the built steps (a new or reopened trip). */
  function resetSteps() {
    STEPS.forEach(function (n, i) { var e = $('tpS' + (i + 1)); if (e) e.remove(); });
    built = {}; scrolls = {}; shown = 0;
  }
  /** Something on Advice still to tick (the spare's air, recirculate): no step past it shows until it is, however you got there. */
  function adviceDue() { return !!((window.Tires && Tires.airDue && Tires.airDue(Garage.car())) || (window.Climate && Climate.ackDue())); }
  function renderStep() {
    if(step===ST_GARAGE&&shown>ST_GARAGE)compareCapture();
    if(step===ST_COMPARE)compareCapture();else if(window.VehicleCompareUI)VehicleCompareUI.dispose();
    if(window.VisualDiagnostics)VisualDiagnostics.redraw('trip_step');
    // Going back is a new review, not implicit consent to reuse this session's answers.
    if(step===ST_HAZ&&shown>ST_HAZ&&Garage.car().rememberRouteChoices!==true){
      compareReviewed=0;compareReviewKey=null;
      S.trip.routeChoices={};choiceReviewedAt=0;routeReview=null;choiceComplete=false;result=null;
    }
    if(!recommendationActive()){stopRecommendations();clearRecommendationMaps();}
    freshModel();
    setTimeout(function () { if (A.jobDraw && A.job && A.job()) A.jobDraw(); }, 0);   // its status bar shows unless this step shows the search itself
    var held = step > ST_ADVISORY && step!==ST_COMPARE && !loadingTrip && adviceDue();
    if (held) { LG.info('trip', 'Held at Advice: ' + STEPS[step - 1] + ' waits for its tick boxes'); step = ST_ADVISORY; setTimeout(function () { ready(ST_ADVISORY); }, 350); }
    if (window.__apiCount) window.__apiCount();
    var pg = $('trip');
    if (!pg.classList.contains('tpanel')) initPanel(pg);
    show(pg, true);
    var full = step < ST_HAZ || step===ST_COMPARE || recommendationActive();
    // coming down to the map: Hazards keeps the map big (the panel at 25%); the plan's list starts at 75% (drag it
    // anywhere from there) — straight away, not as a slide a busy screen could freeze halfway
    if (step === ST_HAZ && shown !== ST_HAZ) { pg.style.setProperty('--panel-h', '25vh'); hzFitKey = null; hzLeg = shown > ST_HAZ ? Math.max(0, hzLegs() - 1) : 0; }   // from Route: the first leg; back from later: the last
    else if (!full && (!shown || shown < ST_ADJ)) pg.style.setProperty('--panel-h', '75vh');
    if(step===ST_HAZ&&routeReview){if(!reviewOrder().some(function(x){return x.key===routeReview.key;}))routeReview=null;else hzLeg=routeReview.leg;}
    if (step !== ST_DEPART && preDepartH != null) { if (!full && shown === ST_DEPART) pg.style.setProperty('--panel-h', preDepartH); preDepartH = null; }   // back from Departure: your height again
    if (!full && (pg.classList.contains('full') || !shown)) {
      pg.classList.add('snap'); requestAnimationFrame(function () { requestAnimationFrame(function () { pg.classList.remove('snap'); }); });
    }
    pg.classList.toggle('full', full); document.body.classList.toggle('trip-full', full);
    if (!full && step !== ST_HAZ && (loadingTrip || (model && !(map.hasLayer(layer) && drawn.model === model)))) mapLoading(loadingTrip ? 'Opening your trip' : 'Drawing the route');
    if (full) mapLoaded();
    $('tpSteps').innerHTML = STEPS.map(function (n, i) {
      var k = i + 1, sh = { Advisory: 'Advice', Hazards: 'Hazards', Parameters: 'Params', Adjustments: 'Adjust', Departure: 'Depart' }[n] || n;
      var attn = k === ST_ADVISORY && window.Advisory && Advisory.attention() > 0;   // something worth a look
      return '<button data-step="' + k + '" aria-label="Step '+k+': '+n+'" title="'+n+'" class="' + (k === step ? 'on' : k < step ? 'done' : '') + (k > reach() ? ' dim' : '') + (attn ? ' attn' : '') + '"><b>' + k + '</b><span class="lf">' + n + '</span><span class="ls">' + sh + '</span></button>';
    }).join('');
    requestAnimationFrame(function(){var rail=$('tpSteps'),active=rail&&rail.querySelector('.on');if(active)rail.scrollLeft+=active.getBoundingClientRect().left-rail.getBoundingClientRect().left-(rail.clientWidth-active.offsetWidth)/2;});
    navRender();
    var b = tpBody();
    if (shown) { scrolls[shown] = b.scrollTop; var old = $('tpS' + shown); if (old) old.classList.add('hidden'); }
    var e = stepEl(step), c = built[step];
    var fresh = !c || step === ST_COMPARE || step === ST_DEPART || step === ST_HAZ || step === ST_STOPS || step===ST_PARAMS&&KIND()==='ev' || c.off !== speedOff() || (onPlan(step) && (c.model !== model || c.result !== result));
    e.classList.remove('hidden'); shown = step;
    if(step===ST_PARAMS&&$('tRuleCap')&&(!S.speed.rule||S.speed.rule.capAuto||S.speed.rule.cap==null))$('tRuleCap').value=Garage.ruleCap();
    if (fresh) {
      e.innerHTML = stepHtml(step);
      built[step] = { model: model, result: result, off: speedOff() };
      bindStep(step);
      b.scrollTop = 0;
    } else {
      b.scrollTop = scrolls[step] || 0;
      if (step === ST_ADVISORY && window.Advisory && Advisory.wake) Advisory.wake();   // a car switch while it was hidden
      if(onPlan(step))renderTripSpeed();
    }
    // the big map: drawn after this frame paints, and only when its route or stops changed
    var k0 = step;
    roadSelSoon();
    requestAnimationFrame(function () { setTimeout(function () {
      if (step !== k0) return;
      if($('trip').classList.contains('hidden'))return;
      if (model && step >= ST_ADJ && step!==ST_COMPARE) { if(!recommendationActive())drawRoute();else{layer.clearLayers();drawn={};} if (!userMoved) fitRoute(false); }
      hzSync();
      fitBtn(); sheetSize();
      if (step === ST_DEPART) fitDepart();
      if (model && (step >= ST_ADJ || step === ST_HAZ) && !busy&&!choicePlanning) mapLoaded();
    }, 0); });
  }
  /** Departure: the panel only as tall as its content, and the whole route centered above it again. */
  var preDepartH = null;
  function fitDepart() {
    var pg = $('trip'), body = tpBody(), e = $('tpS' + ST_DEPART); if (!pg || !e || !body || pg.classList.contains('full')) return;
    var cs = getComputedStyle(body), pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var need = pg.getBoundingClientRect().height - body.clientHeight + e.offsetHeight + pad + 4;
    var h = Math.max(innerHeight * 0.25, Math.min(need, innerHeight * 0.94));
    if (preDepartH == null) preDepartH = pg.style.getPropertyValue('--panel-h') || '75vh';
    pg.style.setProperty('--panel-h', (h / innerHeight * 100).toFixed(2) + 'vh');
    userMoved = false;
    setTimeout(function () { if (step !== ST_DEPART) return; fitRoute(true); fitBtn(); placePinsSoon(); }, 260);
  }
  function navRender() {
    var nav = $('tpNav');nav.classList.toggle('route-review',step===ST_HAZ&&!!routeReview);
    if (loadingTrip) {   // a saved trip opening: say so where Next will be, and nothing else can be pressed yet
      nav.innerHTML = '<span></span><button class="btn primary" disabled>Next</button>';if(window.Tasks)Tasks.upsert('trip-draw',{text:'Opening your trip',frac:null});
      gateTabs(); return;
    }
    nav.innerHTML = (step > 1 ? '<button class="btn tonal" id="tBack">Back</button>' : '<span></span>') +
      (step < ST_DEPART ? '<button class="btn primary" id="tNext">Next</button>' : '<button class="btn primary" id="tOpen">' + MAPS_ICON + 'Open in Google Maps</button>');
    if(step===ST_HAZ&&routeReview){nav.insertAdjacentHTML('afterbegin','<button type="button" class="btn tonal route-review-back" id="tReviewBack" aria-label="Back to previous route"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg></button>');$('tReviewBack').onclick=reviewBack;$('tBack').textContent='No';$('tNext').textContent='Yes';$('tBack').onclick=function(){reviewAnswer(false);};$('tNext').onclick=function(){reviewAnswer(true);};routeGate();return;}
    if ($('tBack')) $('tBack').onclick = function () { if (speedMode()) { discardSpeedMode(); return; } if (step === ST_HAZ && hzLeg > 0) { hzGoLeg(hzLeg - 1); return; } var previous=step-1;while(previous>ST_ADVISORY&&jobLocked(previous))previous--;if (jobLocked(previous)) return; leaveAsk(function () { closeLegs(); collectSafe(); step=previous; renderStep(); }); };
    if ($('tNext')) $('tNext').onclick = async function () {if(onPlan(step)&&failedPlan()){if(step===ST_ADJ&&evRecovery&&evRecovery.base===result&&evRecovery.options.length)step=ST_STOPS;else step=ST_PARAMS;renderStep();return;} if (speedMode()) { leaveSpeedMode(); return; }if(recommendationActive()){stopRecommendations();choiceComplete=true;renderStep();return;} if (step === ST_HAZ && hzLeg < hzLegs() - 1) { var i=hzLeg,a=hzAlts(i)[hzSel(i)];if(await hzConfirmRisk(a,i,function(){return step===ST_HAZ&&hzLeg===i&&hzAlts(i)[hzSel(i)]===a;}))hzGoLeg(i + 1); return; } advance(step + 1); };   // Save and continue: keep the speeds, back to the stops
    if ($('tOpen')) $('tOpen').onclick = openMaps;
    backMode(); routeGate();
  }
  /** Go forward to step `to`, one step at a time, stopping at the first requirement that isn't met. */
  var jumpTo = 0;   // a step tab pressed while a saved trip was opening: gone to once it's open
  async function advance(to) {
    if (busy && loadingTrip) { jumpTo = to; return; }
    if (busy) {
      // a search runs: Advisory → Parameters (or Adjustments) still go, checking the steps between without opening them
      if (jobLocked(to) || to > ST_ADJ) return;
      collectSafe();
      for (var s0 = step; s0 < to; s0++) {
        if (s0 === ST_ADVISORY || s0 === ST_PARAMS) { if (!(await ready(s0))) return; }
        else if(s0===ST_HAZ){if(!(await ready(s0)))return;} // A background scan must not skip route-consideration questions.
        else if (s0 === ST_ROUTE && (!model || timesNeed())) return;
      }
      step = to; renderStep(); return;
    }
    collectSafe(); freshModel();
    while (step < to) {
      var ok = await ready(step);
      if (!ok) { LG.info('trip', 'Stopped at ' + STEPS[step - 1] + ' on the way to ' + STEPS[to - 1]); return; }
      step++;
      renderStep();
    }
  }
  /** Is this step done? If not, point at the first thing missing (top to bottom) and say what's needed. */
  async function ready(k) {
    if (k === ST_GARAGE) {
      var g = Garage.need && Garage.need();
      if (g) { flag(g.el, g.kind, g.msg); return false; }
      return true;
    }
    if (k === ST_ADVISORY) {
      // a spare to air up: tick it in Advisory first (it stays ticked for 30 days, saved trips included)
      if (window.Tires && Tires.tiresDue && Tires.tiresDue(Garage.car())) { flag(document.querySelector('#advTires [data-tchk="tires"]') ? document.querySelector('#advTires [data-tchk="tires"]').closest('.adv-chk') : $('advTires'), 'pick', 'Set your tires to their cold pressure, then tick it.'); return false; }
      if (window.Tires && Tires.spareDue && Tires.spareDue(Garage.car())) { flag(document.querySelector('#advTires .adv-chk') || $('advTires'), 'pick', 'Check your spare\'s air, then tick it.'); return false; }
      // recirculate's downsides: acknowledged once
      if (window.Climate && Climate.ackDue()) { flag(document.querySelector('#advClimate .adv-chk') || $('advClimate'), 'pick', 'Read about recirculate, then tick it.'); return false; }
      return true;
    }
    if (k === ST_ROUTE) {
      if (srcOf() === 'link') { if (!S.trip.link) { flag($('tLink'), 'box', 'Paste a Google Maps directions link.'); return false; } }
      else {
        if (!S.trip.from) { flag($('tFrom'), 'box', 'Where are you starting?'); return false; }
        if (!S.trip.to) { flag($('tTo'), 'box', 'Where are you going?'); return false; }
      }
      var pick = document.querySelector('#tParsed .pick button');
      if (pick) { flag(document.querySelector('#tParsed .pick'), 'pick', 'Pick the right address.'); return false; }
      var tm = timesNeed(); if (tm) { flag($(tm.id), 'box', tm.msg); return false; }
      if (!model) { flag($('tGetRoutes'), 'pick'); return false; }   // the flashing button says it
      return true;
    }
    if (k === ST_PARAMS) {
      if (FuelGauge.math.empty(fuel(), Garage.tank(), Garage.carModel().comb)) { flag($('tEmpty') || $('tFuel'), 'pick', KIND() === 'ev' ? 'Charge enough to reach a station first.' : 'Put in enough gas to reach a station first.'); return false; }
      if (!hasFuel()) { flag($('tMiles') || $('tFuelPct') || $('tGauge'), 'box', KIND() === 'ev' ? 'How charged is your battery?' : 'How much gas do you have?'); return false; }
      if(KIND()==='ev'&&window.EVCharging){var errs=EVCharging.errors(S.trip,route&&route.stops||[],Garage.car(),S.evPrice);if(errs.length){flag($('evDestinations'),'pick',errs.join(' '));return false;}}
      return true;
    }
    if(k===ST_HAZ){
      await restoreChoices();
      var owner=route;
      for(var i=0;i<hzLegs();i++){var a=hzAlts(i)[hzSel(i)];if(!await hzConfirmRisk(a,i,function(){return route===owner&&step===ST_HAZ&&hzAlts(i)[hzSel(i)]===a;}))return false;}
      if(choicePending().length){reviewStart();return false;}
      compareReviewed=Date.now();
      compareReviewKey=compareSafetyKey();
    }
    if(k===ST_COMPARE){compareCapture();var selected=compareEntries.get(S.carId);if(!compareUsable(selected)){A.toast('Review this vehicle’s setup and hazards before departure.');return false;}return true;}
    if (onPlan(k)) {
      if (!result) { await findStops(); if (!result) return false; }
      if (!result.plan.ok) { flag($('tsBufBox') || $('tsResults'), 'pick', 'No plan works with this buffer — try a smaller one.'); return false; }
      if(k===ST_ADJ){stopRecommendations();choiceComplete=false;recommendationState='idle';}
      return true;
    }
    return true;
  }
  /**
   * Routes come from one button under "Leaving": until they're in, Next and the later steps are grayed out. After,
   * it becomes "Refresh routes" (asks Google again — for a saved trip, whose routes are reused as they were).
   */
  function routeGate() {
    var el = $('tRouteGo');
    if (el && !(routing && $('tGetRoutes'))) {
      el.innerHTML = model ? '<div class="rt-ready"><span class="okc">✓</span><span>' + (multiLeg(route) ? 'Routes ready' : alts.length > 1 ? alts.length + ' routes ready' : 'Route ready') +
        (route && route.reused ? '<small class="rt-saved">from your saved trip · no lookups</small>' : '') + '</span><button type="button" class="btn tonal sm" id="tRefreshRoutes">Refresh routes</button></div>'
        : '<button type="button" class="btn primary" id="tGetRoutes">Get routes</button>';
      if ($('tGetRoutes')) $('tGetRoutes').onclick = getRoutes;
      if ($('tRefreshRoutes')) $('tRefreshRoutes').onclick = refreshRoutes;
    }
    var n = $('tNext'); if (n){n.classList.toggle('dim', step === ST_ROUTE && !model);n.disabled=loadingTrip||busy&&onPlan(step)||routing&&step===ST_ROUTE;}
    if(n&&onPlan(step)&&failedPlan()){var checking=evRecovery&&evRecovery.base===result&&evRecovery.state==='running';n.textContent=checking?'Checking other routes…':step===ST_ADJ&&evRecovery&&evRecovery.base===result&&evRecovery.options.length?'Routes that would work':'Adjust parameters';n.disabled=!!checking;}
    if($('tOpen'))$('tOpen').disabled=busy||loadingTrip;
    gateTabs();
  }
  /** The last step you can go straight to: every step before it is done (what Next checks, without pointing at
   * anything). While a saved trip opens, only the Garage. */
  function reach() {
    if (loadingTrip) return ST_GARAGE;
    if (window.Garage && Garage.ok && !Garage.ok()) return ST_GARAGE;
    if (window.Tires && Tires.airDue && Tires.airDue(Garage.car())) return ST_ADVISORY;
    if (window.Climate && Climate.ackDue()) return ST_ADVISORY;
    if (!model || document.querySelector('#tParsed .pick button') || timesNeed()) return ST_ROUTE;
    if (!hasFuel()) return ST_PARAMS;
    if(choicePending().length)return ST_HAZ;

    return ST_DEPART;
  }
  window.addEventListener('advisorychange', function () { gateTabs(); }); window.addEventListener('garagechange', function () { choiceOwnerSync();gateTabs();if(step===ST_HAZ&&document.body.classList.contains('trip-on'))renderHz(); });
  /** Step tabs past what you can reach are grayed out (pressing one still goes as far as it can and points at what's missing). */
  function gateTabs() {
    var r = reach();
    document.querySelectorAll('#tpSteps [data-step]').forEach(function (b) { b.classList.toggle('dim', +b.dataset.step > r); b.classList.toggle('job-lock', jobLocked(+b.dataset.step)); b.disabled = jobLocked(+b.dataset.step); });
    var bk = $('tBack'); if (bk) { var previous=step-1;while(previous>ST_ADVISORY&&jobLocked(previous))previous--;var lockBack = jobLocked(previous) && !speedMode() && !(step === ST_HAZ && hzLeg > 0); bk.disabled = lockBack; bk.classList.toggle('job-lock', lockBack); }
  }
  /**
   * Routes are fetched by themselves whenever the Route step has a link or both addresses and every stop is settled.
   * Changing avoid tolls / highways / ferries or round trip brings the Get routes button back (until the link or the
   * addresses change). The first start after a restore never looks anything up by itself.
   */
  var autoRoute = !A.justRestored;
  function autoRoutes() {
    if (!autoRoute || model || busy || step !== ST_ROUTE) return;
    collectSafe();
    if (srcOf() === 'link' ? !(route && S.trip.link) || parsing : !(S.trip.from && S.trip.to)) return;
    if (document.querySelector('#tParsed .pick button')) return;
    getRoutes();
  }
  async function getRoutes() {
    if (busy) return;
    hzWarm();
    collectSafe();
    if (srcOf() === 'link') { if (!S.trip.link) { flag($('tLink'), 'box', 'Paste a Google Maps directions link.'); return; } }
    else {
      if (!S.trip.from) { flag($('tFrom'), 'box', 'Where are you starting?'); return; }
      if (!S.trip.to) { flag($('tTo'), 'box', 'Where are you going?'); return; }
    }
    var pick = document.querySelector('#tParsed .pick button');
    if (pick) { flag(document.querySelector('#tParsed .pick'), 'pick', 'Pick the right address.'); return; }
    await go();
    if (!model) { var p2 = document.querySelector('#tParsed .pick'); if (p2) flag(p2, 'pick', 'Pick the right address.'); return; }
    var rp = $('tRouteInfo'); if (rp && (alts.length > 1 || multiLeg(route))) rp.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function refreshRoutes() {
    if (busy || !route) return;
    LG.info('route', 'Refreshing every route from Google');
    route.legs = null; alts = []; altSel = 0; model = null; rawRoute = null; result = null; replay = null; freshRoutes = true;
    renderInfo(); layer.clearLayers(); drawn = {};
    getRoutes();
  }
  /** Show the user what's missing: red outline on a box, a soft pulse on something to pick. */
  function flag(el, kind, msg) {   // msg: what's missing, for the log; the outline or pulse says it on screen (no popup)
    if (msg) LG.info('trip', 'Needs: ' + msg);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (kind === 'box') {
      var box = el.closest('.in-q, .in-btn') || el;
      el.classList.add('need'); box.classList.add('need');
      var clear = function () { el.classList.remove('need'); box.classList.remove('need'); el.removeEventListener('input', clear); };
      el.addEventListener('input', clear);
      setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e) { } }, 350);
    } else {
      el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
      setTimeout(function () { el.classList.remove('pulse'); }, 1900);
    }
  }
  function stepHtml(k) {
    var t = S.trip;
    if (k === ST_GARAGE) return '<div id="tGarage"></div>';
    if (k === ST_ADVISORY) return '<div id="tAdvisory"></div>';
    if (k === ST_ROUTE) {
      var src = srcOf();
      return '<div class="card">' +
      '<div class="seg2" id="tSrc"><button data-src="link" class="' + (src === 'link' ? 'on' : '') + '">Maps link</button><button data-src="typed" class="' + (src === 'typed' ? 'on' : '') + '">Addresses</button></div>' +
      '<div id="tSrcLink"' + (src === 'link' ? '' : ' class="hidden"') + '><div class="field col"><div class="lbl">Google Maps directions link<span class="req" aria-label="required">*</span><small>In Google Maps: get directions → ⋮ → <b>Share directions</b> → Gasket. Or paste the link here.</small></div>' +
      '<textarea id="tLink" rows="2" placeholder="https://maps.app.goo.gl/…" spellcheck="false">' + esc(t.link) + '</textarea></div></div>' +
      '<div id="tSrcTyped"' + (src === 'typed' ? '' : ' class="hidden"') + '>' +
      '<div class="field col"><div class="lbl">From<span class="req" aria-label="required">*</span></div><span class="in-btn"><input type="text" id="tFrom" placeholder="Address or place" value="' + esc(t.from) + '"><button type="button" id="tHere" aria-label="Use my location"><svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg></button></span></div>' +
      '<div id="tVia">' + viaHtml() + '</div>' +
      '<div class="field col"><div class="lbl">To<span class="req" aria-label="required">*</span></div><input type="text" id="tTo" placeholder="Address or place" value="' + esc(t.to) + '"></div></div>' +
      '<div id="tParsed"></div>' +
      '<div class="chips" id="tAvoid">' + ['tolls', 'highways', 'ferries'].map(function (k) {
        return '<button data-av="' + k + '" class="' + (t.avoid[k] ? 'on' : '') + '">Avoid ' + k + '</button>'; }).join('') + '</div>' +
      '<div class="field col"><div class="lbl">Leaving<span class="req" aria-label="required">*</span><small>Discounts that only apply on certain days (like Club CITGO\'s Tuesday and Friday bonuses) are counted for the day you\'ll reach each station. Now fills in this minute. Prices can change before you go.</small></div>' +
        '<div class="dt-row"><input type="datetime-local" id="tDepart" value="' + esc(S.trip.departNow ? localNow() : futureDepart() ? S.trip.depart : '') + '"><button type="button" class="btn tonal sm" id="tNow">Now</button></div></div>' +
      '<div class="field"><div class="lbl">Round trip<small>Comes back to the start. The way back is its own leg, so you pick its roads too.</small></div>' + sw('tRound', !!t.returnTrip) + '</div>' +
        '<div class="field' + (t.returnTrip ? '' : ' hidden') + '" id="tBackAutoBox"><div class="lbl">Head back right away<small>Starts the way back as soon as you arrive; the weather on that leg is worked out for then. Off: pick when you\'ll head back.</small></div>' + sw('tBackAuto', backAuto()) + '</div>' +
        '<div class="field col' + (t.returnTrip && !backAuto() ? '' : ' hidden') + '" id="tBackBox"><div class="lbl">Head back<span class="req" aria-label="required">*</span><small>When you\'ll start the way back, for the weather on that leg.</small></div>' +
        '<input type="datetime-local" id="tBackAt" value="' + esc(t.backAt || '') + '"></div>' +
        '<div id="tRouteGo"></div></div>' +
        '<div class="card"><h3>Other routes</h3><div class="field"><div class="lbl">Check Google\'s other routes too<small>After choosing your routes in Hazards, decide Yes or No for every remaining option. Only approved alternatives are searched, after your primary choices.</small></div>'+sw('tAltCmp',t.altCompare)+'</div><div class="field"><div class="lbl">Compare with and without tolls<small>Also gets each leg\'s toll-free routes, and the comparisons count each route\'s tolls. '+(S.apiKey?'Google estimates the amounts (for a car with no toll pass).':'Without the API key Google only says a route has tolls: type the amounts below once the routes are in.')+'</small></div>'+sw('tTollCmp',!!t.tollCompare)+'</div><div class="field"><div class="lbl">Remember alternative-route answers for this vehicle<small>Off by default. Saved trips only; a new trip always asks again. Forecasts change—review answers after an hour.</small></div>'+sw('tRememberRoutes',Garage.car().rememberRouteChoices===true)+'</div><div class="grid2'+(t.altCompare?'':' hidden')+'" id="tAltBox">'+num('tAltSave','Worth switching if it saves at least ($)',t.altMinSave,0.01,'for the whole trip')+'<span></span></div></div><div id="tRouteInfo"></div>';
    }
    if (k === ST_PARAMS) {
      var kd = KIND();
      return '<div class="card"><h3>' + (kd === 'ev' ? 'How charged is it?' : 'How much gas do you have?') + '</h3><div id="tFuel"></div><div id="tEmpty"></div>' +
        '<div class="grid2">' + num('tBuffer', 'Buffer (miles)', t.bufferMi, 5, 'never go below') +
        num('tTankPrice', kd === 'ev' ? 'What\'s in the battery cost ($/kWh)' : kd === 'h2' ? 'Your tank\'s hydrogen ($/kg)' : 'Your tank\'s gas ($/gal)', t[tankPriceKey()]||'', 0.01, kd === 'ev' ? 'e.g. home charging · blank = the typical rate of this route\'s chargers' : 'blank = typical price on the route') + '</div></div>' +
        '<div class="card"><h3>' + (kd === 'ev' ? 'Charging stops' : 'Fuel stops') + '</h3>' +
      (kd==='ev'?'<div id="tChargerTypes">'+[['dc','DC fast (including compatible Superchargers)'],['l2','Level 2 · slower charging'],['l1','Level 1 · very slow charging']].map(function(x){return '<label class="nf chk"><span>'+x[1]+'</span><input type="checkbox" data-charge-type="'+x[0]+'"'+(AltFuel.tripTypes(t.evChargers)[x[0]]?' checked':'')+'></label>';}).join('')+'</div><label class="nf chk"><span>'+((Garage.car().plug||'CCS')==='NACS'?'Use J1772 chargers with my AC adapter':'Use Tesla AC chargers with my AC adapter')+'</span><input type="checkbox" id="tACAdapter"'+(Garage.car().acAdapter===true?' checked':'')+'></label><p class="lead small keep">Only compatible plugs are included. Slower stops can take hours; verify access, adapters and availability before travel.</p>'+netListHtml():'')+
      '<div class="seg2" id="tMode"><button data-m="cheap" class="' + (!t.fillUp ? 'on' : '') + '">Cheapest overall</button><button data-m="fill" class="' + (t.fillUp ? 'on' : '') + '">' + (kd === 'ev' ? 'Charge to 80% each stop' : 'Fill up at each stop') + '</button></div>' +
      '<div class="sub-h">Is a stop or detour worth it?</div>' +
      '<div class="grid2">' + num('tMinSave', 'Min. savings ($)', t.minSave, 0.25, 'per stop or detour') + num('tMaxMin', 'Max. extra time (min)', t.maxDetourMin, 0.5, 'extra driving per stop') + '</div>' +
      '<div class="sub-h">When you get there <button type="button" class="qi" id="tArriveQ" aria-label="More info">?</button></div>' +
      '<div class="seg2 arrive-seg'+(kd==='ev'?' ev-arrival-selector':'')+'" id="tArrive">'+(kd==='ev'?'<button data-a="destination" class="'+(arriveNow()==='destination'?'on':'')+'">At least one of my destinations will have a charger</button>':'')+'<button data-a="buffer" class="' + (arriveNow() === 'buffer' ? 'on' : '') + '">Just keep my buffer</button><button data-a="full" class="' + (arriveNow() === 'full' ? 'on' : '') + '">Arrive with the most ' + (kd === 'ev' ? 'charge' : kd === 'h2' ? 'hydrogen' : 'gas') + '</button></div>' +
      (kd==='ev'&&window.EVCharging?EVCharging.html(t,route&&route.stops||[],Garage.car(),S.evPrice,esc):'')+

      '<div class="grid2' + (t.arrive === 'full' ? '' : ' hidden') + '" id="tTopBox">' + num('tTopMi', 'Top-up within (mi)', t.topUpMi, 0.1, 'for an optional last top-up') + '<span></span></div>' +
      '</div><div class="card"><h3>Cruising speed</h3>' +
      '<div class="field"><div class="lbl">Go over the speed limit by default<small>Off: every road starts at its limit. On: +N over the limit, but never above a top speed — roads already at that limit or higher stay at the limit.</small></div>' + sw('tRule', !!(S.speed.rule && S.speed.rule.on)) + '</div>' +
      '<div class="grid2' + (S.speed.rule && S.speed.rule.on ? '' : ' hidden') + '" id="tRuleBox">' + num('tRuleOver', 'Over the limit by (mph)', S.speed.rule&&S.speed.rule.over!=null?S.speed.rule.over:0, 1) + num('tRuleCap', '…but no faster than (mph)', Garage.ruleCap(), 1) + '</div>' +
      '<div class="field"><div class="lbl">Keep me as slow as the trucks<small>Uses the large-truck limit where a state sets one lower than for cars — e.g. 70 on Arkansas Interstates (like I-57) posted 75. From state law as compiled by IIHS; no road database lists truck limits. Not covered: Illinois\' county truck limits.</small></div>' + sw('tTruck', !!S.speed.truck) + '</div>' +
      '</div>';
    }
    if (k === ST_HAZ) return '<div id="tHz"></div>';
    if (k === ST_ADJ) return '<div id="taResults"></div>';
    if (k === ST_STOPS) return '<div id="tsResults"></div>';
    if (k === ST_COMPARE) return '<div id="tCompare"></div>';
    return departureHtml();
  }
  // another car: the route's fuel use is worked out again a moment later (a long trip takes a while), or right away
  // when a step needs it
  var modelStale = false, staleT = 0;
  function freshModel() {
    clearTimeout(staleT); if (!modelStale) return; modelStale = false;
    if (model && rawRoute) { model = T.buildRoute(rawRoute, carModel()); renderInfo(); }
  }
  function bindStep(k) {
    if (k === ST_ADVISORY) { Advisory.render($('tAdvisory'), call); return; }
    if (k === ST_GARAGE) {
      Garage.render($('tGarage'), null, function () {
        if(compareGarageChanged())return;
        compareReviewed=0;
        if (model) { modelStale = true; clearTimeout(staleT); staleT = setTimeout(freshModel, 400); }   // after the Garage has redrawn
        result = null; gateTabs();
        var e3 = $('tpS' + ST_PARAMS); if (e3 && step !== ST_PARAMS) { e3.remove(); delete built[ST_PARAMS]; }   // its labels follow the car (gal / kWh / kg)
      }, call);
      return;
    }
    if (k === ST_ROUTE) { bindRoute(); return; }
    if (k === ST_HAZ) { renderHz(); hzPreload(); return; }
    if (k === ST_PARAMS) { bindSettings(); return; }
    if (k === ST_COMPARE) { compareRender(); return; }
    if (onPlan(k)) {
      renderResults();
      built[k].result = result;
      if (model && !result && !busy && hasFuel()) findStops();
      return;
    }
    bindDeparture();
  }
  /** This minute, as a date box wants it (local time). */
  function localNow() { var d = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); }
  /** Head back right away (no time picked): on unless a time was picked and the switch turned off. */
  function backAuto() { var t = S.trip; return t.backAuto != null ? !!t.backAuto : !t.backAt; }
  function bindRoute() {
    $('tTollCmp').onchange=function(){S.trip.tollCompare=this.checked;if(this.checked&&!S.trip.altCompare){S.trip.altCompare=true;$('tAltCmp').checked=true;$('tAltBox').classList.remove('hidden');}model=null;replay=null;result=null;routeReview=null;choiceComplete=false;autoRoute=false;A.save();renderInfo();gateTabs();};
    $('tAltCmp').onchange=function(){$('tAltBox').classList.toggle('hidden',!this.checked);S.trip.altCompare=this.checked;routeReview=null;choiceComplete=false;result=null;A.save();gateTabs();};
    $('tRememberRoutes').onchange=function(){choiceOwnerSync();Garage.car().rememberRouteChoices=this.checked;saveChoices();A.save();};
    $('tAltSave').onchange=function(){S.trip.altMinSave=Math.max(0,Number(this.value)||0);A.save();};
    var t = S.trip;
    $('tLink').addEventListener('input', debounce(function () { route = null; model = null; replay = null; result = null; autoRoute = true; renderInfo(); readLink().then(autoRoutes); }, 400));
    bindVia();
    ['tFrom', 'tTo'].forEach(function (id) {
      $(id).addEventListener('input', function () { route = null; model = null; replay = null; result = null; autoRoute = true; renderInfo(); renderStops(); });
      $(id).addEventListener('change', function () { autoRoutes(); });   // done typing (left the box): fetch once both are in
    });
    var dEl = $('tDepart'), bEl = $('tBackAt'), minNow = function () { dEl.min = bEl.min = localNow(); };
    minNow(); dEl.addEventListener('focus', minNow); bEl.addEventListener('focus', minNow);
    dEl.addEventListener('change', function () {
      // sanity check: you can't leave in the past (a few minutes' slack for the time it took to pick)
      if (dEl.value && new Date(dEl.value).getTime() < Date.now() - 5 * 6e4) dEl.value = '';
      S.trip.departNow = false;      // a time you picked: it stays put
      collectSafe(); result = null; gateTabs();if(model&&futureDepart())hzPreload();
    });
    bEl.addEventListener('change', function () { collectSafe(); gateTabs();if(model&&futureDepart())hzPreload(); });
    $('tNow').onclick = function () {
      dEl.value = localNow(); dEl.classList.remove('need'); dEl.dispatchEvent(new Event('input')); collectSafe(); S.trip.departNow = true; A.save(); result = null; gateTabs();if(model)hzPreload();
    };
    $('tBackAuto').onchange = function () { collectSafe(); $('tBackBox').classList.toggle('hidden', !S.trip.returnTrip || backAuto()); gateTabs(); };
    $('tHere').onclick = function () { $('tFrom').value = 'My location'; $('tFrom').dispatchEvent(new Event('input')); };
    $('tSrc').onclick = function (e) {
      var b = e.target.closest('button'); if (!b || b.classList.contains('on')) return;
      Array.prototype.forEach.call($('tSrc').children, function (x) { x.classList.toggle('on', x === b); });
      S.trip.src = b.dataset.src; A.save();
      $('tSrcLink').classList.toggle('hidden', S.trip.src !== 'link'); $('tSrcTyped').classList.toggle('hidden', S.trip.src !== 'typed');
      route = null; model = null; replay = null; result = null; parsing = null; parsedEl().innerHTML = ''; renderInfo(); layer.clearLayers();
      if (S.trip.src === 'link' && $('tLink').value.trim()) readLink().then(autoRoutes);
    };
    $('tRound').onchange = function () {
      collectSafe(); $('tBackAutoBox').classList.toggle('hidden', !S.trip.returnTrip); $('tBackBox').classList.toggle('hidden', !S.trip.returnTrip || backAuto());
      if (route && syncReturn(route)) { model = null; replay = null; result = null; autoRoute = false; LG.info('route', S.trip.returnTrip ? 'Round trip: added the way back' : 'Round trip off'); }
      renderStops(); renderInfo();
    };
    $('tAvoid').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      b.classList.toggle('on'); collectSafe(); model = null; replay = null; result = null; autoRoute = false; renderInfo();   // changed options: Get routes again by hand
    };
    renderStops(); renderInfo();
    if (srcOf() === 'link' && t.link && !route) readLink().then(autoRoutes); else autoRoutes();
  }
  function bindSettings() {
    var again = function () { collectSafe(); result = null;adjustError=''; };
    var arriveHelp = function () {
      var full = $('tArrive').querySelector('.on').dataset.a === 'full', ev = KIND() === 'ev';
      $('tArriveQ').dataset.q = encodeURIComponent((ev ? 'A destination has a charger: tell Gasket where you can charge (and how much) when you get there, so the next leg starts with that charge. ' : '') +
        'Just keep my buffer: arrive with at least your buffer; what\'s left over is counted at the typical price. ' +
        'Arrive with the most ' + (ev ? 'charge' : 'gas') + ': your last stop ' + (ev ? 'charges up' : 'fills the tank') + ', late in the trip and as cheaply as possible (the “must save” amount drops to $0.25 so a late cheap stop isn\'t skipped); you can add a top-up close to the destination afterward.');
      show($('tTopBox'), full);
      if($('evDestinations'))show($('evDestinations'),$('tArrive').querySelector('.on').dataset.a==='destination');
    };
    var seg = function (id, after) {
      $(id).onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        Array.prototype.forEach.call($(id).children, function (x) { x.classList.toggle('on', x === b); });
        if (after) after(); collectSafe(); again();
      };
    };
    seg('tArrive', function(){S.trip.arriveSet=true;arriveHelp();}); seg('tMode');
    if($('tChargerTypes'))$('tChargerTypes').querySelectorAll('input').forEach(function(el){el.onchange=function(){var all=Array.from($('tChargerTypes').querySelectorAll('input'));if(!all.some(function(x){return x.checked;})){this.checked=true;A.toast('Keep at least one charger type selected.');return;}S.trip.evChargers={};all.forEach(function(x){S.trip.evChargers[x.dataset.chargeType]=x.checked;});result=null;choiceCandidates.clear();A.save();gateTabs();};});
    if($('tNetworks'))$('tNetworks').querySelectorAll('[data-net]').forEach(function(el){el.onchange=function(){var all=Array.from($('tNetworks').querySelectorAll('[data-net]'));if(!all.some(function(x){return x.checked;})){this.checked=true;A.toast('Keep at least one charging network selected.');return;}var o={};all.forEach(function(x){o[x.dataset.net]=!x.checked;});S.trip.evNetworksOff=o;result=null;choiceCandidates.clear();A.save();gateTabs();};});
    if($('tACAdapter'))$('tACAdapter').onchange=function(){Garage.car().acAdapter=this.checked;result=null;choiceCandidates.clear();A.save();gateTabs();};
    if($('tChargerTypes')){
      var help={dc:'DC fast chargers send power directly to the battery. They are usually fastest for road trips; Tesla Superchargers are one DC fast-charging network, not the only one. Compatibility and actual charging speed depend on the car and charger.',l2:'Level 2 uses 208–240 V AC, usually at homes, hotels or public parking. It is faster than an ordinary outlet but can still take hours. Power is limited by the car’s onboard charger.',l1:'Level 1 usually means an ordinary 120 V outlet: only a few miles of range per hour. A compatible portable charging cable is required. It is not a substitute for a fast charger on a short stop.'};
      $('tChargerTypes').querySelectorAll('input').forEach(function(el){el.closest('label').querySelector('span').insertAdjacentHTML('beforeend',' '+A.qBtn(help[el.dataset.chargeType]));});
      $('tACAdapter').closest('label').querySelector('span').insertAdjacentHTML('beforeend',' '+A.qBtn('J1772 is the common North American plug for Level 1/2 AC charging. NACS is the Tesla-shaped connector, used for both AC and DC charging. CCS combines AC contacts with larger DC contacts for fast charging. A DC fast-charge adapter does not automatically work for AC charging; only select this if you own the correct AC adapter.'));
      $('tChargerTypes').insertAdjacentHTML('beforeend','<label class="nf chk"><span>Tesla Superchargers only '+A.qBtn('Only Tesla-network DC fast chargers with a compatible connector. Tesla Destination chargers are slower AC chargers and are not Superchargers. This preference can make some routes impossible; it will never silently include another network.')+'</span><input id="tSuperchargers" type="checkbox"'+(S.trip.evChargers&&S.trip.evChargers.superchargers?' checked':'')+'></label>');
      var saveTypes=function(){var flags={superchargers:$('tSuperchargers').checked};$('tChargerTypes').querySelectorAll('[data-charge-type]').forEach(function(x){flags[x.dataset.chargeType]=x.checked;});S.trip.evChargers=flags;result=null;adjustError='';choiceCandidates.clear();A.save();gateTabs();};
      $('tSuperchargers').onchange=function(){if(this.checked)$('tChargerTypes').querySelectorAll('[data-charge-type]').forEach(function(x){x.checked=x.dataset.chargeType==='dc';});saveTypes();};
      $('tChargerTypes').querySelectorAll('[data-charge-type]').forEach(function(el){el.onchange=function(){var all=Array.from($('tChargerTypes').querySelectorAll('[data-charge-type]'));if(!all.some(function(x){return x.checked;})){this.checked=true;A.toast('Keep at least one charger type selected.');return;}if(this.dataset.chargeType!=='dc'&&this.checked)$('tSuperchargers').checked=false;saveTypes();};});
    }
    if($('evDestinations'))EVCharging.bind($('evDestinations'),S.trip,route&&route.stops||[],Garage.car(),Garage.tank(),carModel().comb?1/carModel().comb:model?model.combGpm:0,S.evPrice,function(){result=null;stopRecommendations();A.save();gateTabs();},function(i){var charges=result&&result.plan&&result.plan.destinationCharges||[],c=charges.find(function(c){return c.index===i;});return c?c.arriveGal:NaN;});
    var ruleSave = function () {
      var previous=S.speed.rule||{},autoCap=previous.capAuto===true||previous.cap==null;if(this.id==='tRuleCap')autoCap=false;
      S.speed.rule = { on: $('tRule').checked, over: Math.max(-10, Math.min(15, parseInt($('tRuleOver').value, 10) || 0)), cap: Math.max(40, Math.min(90, parseInt($('tRuleCap').value, 10) || Garage.ruleCap())),capAuto:autoCap };
      $('tRuleBox').classList.toggle('hidden', !S.speed.rule.on); A.save();
      if (result) result.speedState = null;
      again();
    };
    $('tRule').onchange = ruleSave; $('tRuleOver').onchange = ruleSave; $('tRuleCap').onchange = ruleSave;
    if (speedOff()) grayOut($('tRule').closest('.card'));
    $('tTruck').onchange = function () { S.speed.truck = this.checked; A.save(); LG.info('speed', 'Truck limits ' + (this.checked ? 'on' : 'off')); again(); };
    ['tBuffer', 'tMinSave', 'tMaxMin', 'tTopMi', 'tTankPrice', 'tMaxUnder', 'tAltSave'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('input', function () { collectSafe(); again(); });
    });
    arriveHelp();
    renderFuel();
  }
  function renderFuel() {
    FuelGauge.render($('tFuel'), { kind: KIND(), tank: Garage.tank(), mpu: Garage.carModel().comb, unit: UN(), fuel: fuel(),
      onChange: function (f) { S.trip.fuel = f;if(Garage.car().demoFuel)Garage.car().demoFuel=Object.assign({},f);syncMilesLeft(); A.save(); result = null; emptyHelp(); gateTabs(); } });
    emptyHelp();
    setTimeout(function () { try { emptyPlan(); } catch (e) { } }, 300);   // ready before the needle gets to E
  }
  /** How much is in the tank: S.trip.fuel ({mode: gauge / pct / miles, …}, see fuelgauge.js), filled in for this car. */
  function fuel() {var c=Garage.car();if(c.demoFuel&&c.power==='ev'&&!(c.demoFuelV>=2)){c.demoFuelV=2;if(c.demoFuel.mode==='pct'&&String(c.demoFuel.pct)==='100'){c.demoFuel.pct='80';if(S.trip.demoFuelCar===c.id)delete S.trip.demoFuelCar;}}   // 0.0.209: demo EVs start at 80%
    if(c.demoFuel&&S.trip.demoFuelCar!==c.id){S.trip.fuel=Object.assign({},c.demoFuel);S.trip.milesLeft='';S.trip.demoFuelCar=c.id;}else if(!c.demoFuel)delete S.trip.demoFuelCar;return (S.trip.fuel = FuelGauge.math.norm(S.trip.fuel, KIND(), S.trip.milesLeft)); }
  function fuelMiles() { return FuelGauge.math.miles(fuel(), Garage.tank(), Garage.carModel().comb); }
  function hasFuel() { var m = fuelMiles(); return m != null && m > 0; }   // an empty tank isn't an answer (see emptyHelp)
  /** Roads wind: a straight line times this is a fair guess at the miles to a station off the route. */
  var ROAD = 1.25;
  /** Stations Gasket already knows (the map's, plus this route's saved Google answers) — nothing is looked up. */
  function knownStations() {
    var out = (A.stations ? A.stations() : []).slice();
    if (model && KIND() === 'gas') try {
      googleBrands().forEach(function (b) {
        T.chunks(model, 125).forEach(function (ch) {
          var o = A.KV.get('along', P.BRANDS[b].query + '|' + ch.polyline, 30 * 864e5);
          ((o && o.v && o.v.places) || []).forEach(function (pl) { var st = P.normalize(pl); if (st && S.brands[st.brand]) out.push(st); });
        });
      });
    } catch (e) { LG.warn('plan', 'Couldn\'t read saved stations', String(e)); }
    return dedupe(out.filter(function (s) { return s && s.lat != null && s.lng != null; }));
  }
  /**
   * An empty tank: the nearest known station from the start (straight line x ROAD), and the nearest one along the route
   * (miles along it, plus the way off it). -> { near: {st, mi}, along: {st, mi} } (either may be null).
   */
  var emptyMemo = null;   // the answer for this route and these stations, worked out ahead (dragging to E must not wait on it)
  function emptyPlan() {
    var n = A.stations ? A.stations().length : 0, key = [KIND(), n, Object.keys(S.brands).filter(function (b) { return S.brands[b]; }).join()].join('|');
    if (emptyMemo && emptyMemo.model === model && emptyMemo.key === key) return emptyMemo.v;
    var v = emptyPlan0(); emptyMemo = { model: model, key: key, v: v };
    return v;
  }
  function emptyPlan0() {
    var start = model && model.pts.length ? model.pts[0] : A.me && A.me(), near = null, along = null;
    if (!start) return { near: null, along: null };
    knownStations().forEach(function (st) {
      var mi = P.haversineMi(start.lat, start.lng, st.lat, st.lng) * ROAD;
      if (!near || mi < near.mi) near = { st: st, mi: mi };
      if (model) {
        var pj = T.project(model, { lat: st.lat, lng: st.lng });
        if (pj.offset <= 1) { var am = pj.along + pj.offset * ROAD; if (!along || am < along.mi) along = { st: st, mi: am }; }
      }
    });
    return { near: near, along: along };
  }
  /** Under the gauge when it says empty: how much to put in to reach a station first (Adjustments on wait for a real amount). */
  function emptyHelp() {
    var host = $('tEmpty'); if (!host) return;
    if (!FuelGauge.math.empty(fuel(), Garage.tank(), Garage.carModel().comb)) { host.innerHTML = ''; return; }
    var ev = KIND() === 'ev', u = UN(), mpu = Garage.carModel().comb, p = emptyPlan();
    var opt = function (o, how, id) {
      var amt = FuelGauge.math.toReach(o.mi, mpu);
      return '<div class="fe-opt"><p><b>' + amt.toFixed(2) + ' ' + esc(u) + '</b> ' + how + ' <b>' + esc(o.st.name || 'a station') + '</b>' + (o.st.address ? ', ' + esc(o.st.address) : '') + ' (about ' + o.mi.toFixed(1) + ' mi).</p>' +
        '<button type="button" class="btn tonal sm" id="' + id + '" data-mi="' + (o.mi + 0.1).toFixed(2) + '">I\'ll put in ' + amt.toFixed(2) + ' ' + esc(u) + '</button></div>';
    };
    var h = '<div class="fg-empty" role="alert"><b>' + (ev ? 'Your battery is empty.' : 'Your tank is empty.') + '</b><p>' +
      (ev ? 'Charge' : 'Put in') + ' at least enough to reach a station first (0.1 mile extra is included), then set the ' + (ev ? 'charge' : 'gauge') + ' to what you have.</p>';
    if (p.near) h += opt(p.near, 'to reach the nearest station Gasket knows,', 'tEmptyNear');
    if (p.along && (!p.near || p.along.st.id !== p.near.st.id)) h += opt(p.along, 'to reach the first station along your route,', 'tEmptyAlong');
    else if (p.near && p.along) h += '<p class="fe-same">It\'s also the first station along your route.</p>';
    if (!p.near) h += '<p>Gasket doesn\'t know any stations near your start yet. Search the map there, or ' + (ev ? 'charge' : 'fill up') + ' at the closest station you know.</p>';
    host.innerHTML = h + '</div>';
    host.querySelectorAll('[data-mi]').forEach(function (b) {
      b.onclick = function () {
        S.trip.fuel = { mode: 'miles', miles: String(Math.ceil(+b.dataset.mi * 10) / 10) }; syncMilesLeft(); A.save(); result = null;
        LG.info('plan', 'Empty tank: putting in enough for ' + S.trip.fuel.miles + ' mi');
        renderFuel(); gateTabs();
      };
    });
  }
  /** Fuel in the tank at the start: a gauge or percentage is a share of the tank; dash miles use the route's mileage. */
  function startFuel(m) { var f = fuel(); return f.mode === 'miles' ? (parseFloat(f.miles) || 0) * m.combGpm : FuelGauge.math.amount(f, Garage.tank(), 1) || 0; }
  /** S.trip.milesLeft follows the fuel choice (saved trips and old exports read it). */
  function syncMilesLeft() { var m = fuelMiles(); S.trip.milesLeft = m == null ? '' : String(Math.round(m)); }
  /** Where the route comes from: a Google Maps link, or addresses you type. */
  function srcOf() { var t = S.trip; return t.src === 'typed' || t.src === 'link' ? t.src : (!t.link && (t.from || t.to) ? 'typed' : 'link'); }
  /** When you're leaving: the saved time if it's still ahead, else now. */
  /** Leaving (and, on a round trip without "right away", Head back) must be filled in, in the future, in order. */
  function timesNeed() {
    if (!futureDepart()) return { id: 'tDepart', msg: 'When are you leaving? (Now fills in this minute.)' };
    if (S.trip.returnTrip && !backAuto()) {
      var b = S.trip.backAt ? new Date(S.trip.backAt).getTime() : NaN;
      if (isNaN(b)) return { id: 'tBackAt', msg: 'When will you head back?' };
      if (b <= futureDepart().getTime()) return { id: 'tBackAt', msg: 'Head back after you leave.' };
    }
    return null;
  }
  // "Now" means leaving now, however long you look around first: kept at this minute until you pick a time yourself
  setInterval(function () {
    if (!S.trip.departNow) return;
    S.trip.depart = localNow();
    var d = $('tDepart'); if (d && document.activeElement !== d) d.value = S.trip.depart;
  }, 20000);
  function futureDepart() {
    if (S.trip.departNow) return new Date(); var d = S.trip.depart ? new Date(S.trip.depart) : null; return d && !isNaN(d) && d.getTime() > Date.now() - 600e3 ? d : null; }
  function departAt() { return futureDepart() || new Date(); }
  function isHere(x) { return /^(my|your) (current )?location$/i.test(String(x || '').trim()); }
  function sw(id, on) { return '<label class="switch"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '><span></span></label>'; }
  function num(id, label, v, step, hint) {
    return '<label class="nf"><span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span><input type="number" inputmode="decimal" id="' + id + '" step="' + step + '" value="' + esc(v) + '"></label>';
  }
  function debounce(f, ms) { var t; return function () { clearTimeout(t); t = setTimeout(f, ms); }; }
  /** Save whatever fields the current step shows (each one only if it's on screen). */
  function collectSafe() {
    var t = S.trip, v = function (id) { var e = $(id); return e ? e.value : null; }, on = function (id) { var e = $(id); return e ? e.checked : null; };
    var segOn = function (id, attr) { var e = $(id); var b = e && e.querySelector('.on'); return b ? b.dataset[attr] : null; };
    if (v('tLink') != null) t.link = v('tLink').trim();
    if (v('tFrom') != null) { t.from = v('tFrom').trim(); t.to = v('tTo').trim(); t.via = viaList(); }
    if ($('tAvoid')) Array.prototype.forEach.call($('tAvoid').children, function (b) { t.avoid[b.dataset.av] = b.classList.contains('on'); });
    if (segOn('tMode', 'm')) t.fillUp = segOn('tMode', 'm') === 'fill';
    if (segOn('tArrive', 'a')) t.arrive = segOn('tArrive', 'a');
    if($('evDestinations')&&window.EVCharging)EVCharging.collect($('evDestinations'),t,route&&route.stops||[]);
    if (v('tTopMi') != null) t.topUpMi = Math.max(0, Math.round((parseFloat(v('tTopMi')) || 0) * 10) / 10);
    if (on('tRound') != null) t.returnTrip = on('tRound');
    if (on('tBackAuto') != null) t.backAuto = on('tBackAuto');
    if (v('tBackAt') != null) t.backAt = v('tBackAt') || '';
    if (segOn('tSrc', 'src')) t.src = segOn('tSrc', 'src');
    if (v('tDepart') != null) t.depart = v('tDepart') || '';
    if (on('tTollCmp') != null) t.tollCompare = on('tTollCmp');
    if (on('tAltCmp') != null) { t.altCompare = on('tAltCmp'); t.altMinSave = Math.max(0, parseFloat(v('tAltSave')) || 0); }
    if (v('tTankPrice') != null) t[tankPriceKey()] = v('tTankPrice').trim();
    if (v('tBuffer') != null) t.bufferMi = Math.max(0, parseFloat(v('tBuffer')) || 0);
    if (v('tMinSave') != null) { t.minSave = Math.max(0, parseFloat(v('tMinSave')) || 0); var mm = parseFloat(v('tMaxMin')); t.maxDetourMin = mm >= 0 ? mm : 10; }
    A.save();
  }
  function collect() { collectSafe(); }
  function parsedEl() { return $('tParsed') || document.createElement('div'); }

  // ---------- reading the link ----------
  function readLink() {
    var text = ($('tLink') ? $('tLink').value : S.trip.link || '').trim();
    if (!text) { parsing = null; route = null; parsedEl().innerHTML = ''; return Promise.resolve(null); }
    if (parsing && parsing.text === text) return parsing.p;
    var job = parsing = { text: text, frac: 0 };
    parseBar(0.03);
    job.p = readLink0(text, job).then(function (r) {
      if (parsing === job) { parsing = null; if (r) { route = r; renderStops(); } }
      return parsing === null || parsing === job ? r : null;
    }, function (e) {
      if (parsing === job) { parsing = null; parsedEl().innerHTML = '<div class="msg err">' + esc(e.message || String(e)) + '</div>'; }
      LG.error('link', e.message || String(e)); return null;
    });
    return job.p;
  }
  async function readLink0(text, job) {
    var shared = importTrip(text);
    if (shared) { LG.info('link', 'Imported a shared trip', { stops: shared.stops.length }); previewCities(shared); return shared; }
    dbg = { linkText: text.slice(0, 2000), at: new Date().toISOString() };
    var url = T.extractUrl(text);
    LG.info('link', 'Reading link', url);
    if (!url) throw new Error('That doesn\'t look like a link.');
    if (T.isShortLink(url)) {
      parseBar(0.06);
      var r = await call('resolveLink', url);
      if (r.error || !r.url) { LG.error('link', 'Short link failed', r.error); dbg.linkError = r.error; throw new Error(r.error || 'Couldn\'t open the link.'); }
      url = r.url;
      LG.debug('link', 'Short link opened to', url);
    }
    dbg.resolvedUrl = url;
    var mapsUrl = url;
    var parsed = T.parseMapsUrl(url);
    dbg.parsed = parsed && JSON.parse(JSON.stringify(parsed));
    LG.debug('link', 'Parsed link', parsed);
    if (!parsed) throw new Error('That link isn\'t a Google Maps directions link. Open directions first, then share.');
    parseBar(0.15);
    // Phone share links name stops loosely ("100 Main St") and identify them only by Google's internal place ID.
    // Let Google Maps itself (in a hidden page) turn them into full addresses + exact coordinates and list the routes.
    if (parsed.stops.some(function (st) { return !st.current && st.lat == null; }) || parsed.routeIndex != null) {
      var stopCreep = creep(0.15, 0.5, 8);
      var g = await openInGoogleMaps(url);
      stopCreep();
      dbg.googleMapsPage = g;
      LG.debug('link', 'Hidden Google Maps page answered', g);
      if (g && g.href) {
        var exact = T.parseMapsUrl(g.href);
        if (exact && exact.stops.length === parsed.stops.length) {
          // per stop: keep whichever has coordinates, and the fuller address text
          parsed.stops.forEach(function (a, i) {
            var b = exact.stops[i];
            if (a.current || b.current) return;
            if (a.lat == null && b.lat != null) { a.lat = b.lat; a.lng = b.lng; a.fromLink = true; }
            if (b.address && (T.fullAddress(b.address) || !T.fullAddress(a.address))) { a.address = b.address; a.label = b.label; a.short = b.short; }
          });
          if (parsed.routeIndex == null && exact.routeIndex != null) parsed.routeIndex = exact.routeIndex;
          if (!parsed.avoidDetected && exact.avoidDetected) { parsed.avoid = exact.avoid; parsed.avoidDetected = true; }
        }
        if (g.routes && g.routes.length) parsed.mapsRoutes = g.routes;
      } else if (parsed.stops.some(function (st) { return !st.current && st.lat == null; })) {
        parsed.note = 'Couldn\'t open the link in Google Maps' + (g && g.error ? ' (' + g.error + ')' : '') + ', so the addresses are checked by name instead.';
      }
    }
    parsed.mapsUrl = mapsUrl;
    if (parsed.avoidDetected) {
      S.trip.avoid = Object.assign({}, S.trip.avoid, parsed.avoid);
      if ($('tAvoid')) Array.prototype.forEach.call($('tAvoid').children, function (b) { b.classList.toggle('on', !!parsed.avoid[b.dataset.av]); });
    }
    // now, at the same time: full addresses for every stop (Google) and the route options Google Maps shows
    parseBar(0.5);
    var addrF = 0, scanF = 0, both = function () { parseBar(0.5 + 0.5 * (addrF * 0.4 + scanF * 0.6)); };
    var scanCreep = setInterval(function () { scanF = Math.min(0.9, scanF + 0.04); both(); }, 400);
    await Promise.all([
      resolveStops(parsed, function (f) { addrF = f; both(); }, true).catch(function (e) { LG.warn('address', String(e)); }),
      mapsOptions(parsed).catch(function (e) { LG.warn('route', 'Route options scan failed', String(e)); })
    ]);
    clearInterval(scanCreep);
    parseBar(1);
    previewCities(parsed);
    scanLegs(parsed);
    return parsed;
  }

  // ---------- making sure every stop is the right place ----------
  // ---------- shared trips (import) ----------
  var TRIP_START = '-----GASKET TRIP-----', TRIP_END = '-----END GASKET TRIP-----';
  // markers trips are read with: ours, then the ones Fuel+ Map shared trips used
  var TRIP_MARKS = [[TRIP_START, TRIP_END], ['-----FUEL+ TRIP-----', '-----END FUEL+ TRIP-----']];
  function importTrip(text) {
    var m = TRIP_MARKS.filter(function (k) { return text.indexOf(k[0]) >= 0; })[0];
    if (!m) return null;
    var a = text.indexOf(m[0]), b = text.indexOf(m[1]);
    if (b < a) return null;
    try {
      var j = JSON.parse(text.slice(a + m[0].length, b).trim());
      if (!j || !j.stops || j.stops.length < 2) return null;
      var r = { stops: j.stops.map(function (s) { return Object.assign({}, s, { short: s.short || T.shortLabel(s.address || s.label || '') }); }),
        avoid: j.avoid || { tolls: false, highways: false, ferries: false }, avoidDetected: !!j.avoidDetected, mode: 'drive',
        routeIndex: j.routeIndex, mapsRoutes: j.mapsRoutes, note: null, imported: true };
      return r;
    } catch (e) { LG.warn('link', 'Shared trip block unreadable', String(e)); return null; }
  }
  function tripBlock() {
    if (!route) return '';
    var j = { v: 1, stops: route.stops.map(function (s) {
      return s.current ? { current: true, label: 'Your location' } : { address: s.address, label: s.label, lat: s.lat, lng: s.lng, placeId: s.placeId, fromLink: s.fromLink };
    }), avoid: S.trip.avoid, avoidDetected: !!route.avoidDetected, routeIndex: route.routeIndex, mapsRoutes: route.mapsRoutes };
    return TRIP_START + '\n' + JSON.stringify(j) + '\n' + TRIP_END;
  }

  // ---------- cities right after import (free, OpenStreetMap) ----------
  var osmLast = 0;
  async function previewCities(r) {
    if (S.osmPreview === false || !r) return;
    for (var i = 0; i < r.stops.length; i++) {
      var st = r.stops[i];
      if (st.current || st.lat == null || T.fullAddress(st.address) || st.osmPlace) continue;
      var wait = 1100 - (Date.now() - osmLast);              // OpenStreetMap asks for at most 1 lookup per second
      if (wait > 0) await new Promise(function (res) { setTimeout(res, wait); });
      osmLast = Date.now();
      var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=' + st.lat.toFixed(6) + '&lon=' + st.lng.toFixed(6);
      var res = await call('fetchJson', url);
      if (res.error) { LG.warn('osm', 'City lookup failed', res.error); continue; }
      try {
        var a = (JSON.parse(res.body).address) || {};
        var city = a.city || a.town || a.village || a.hamlet || a.municipality || a.county || '';
        var iso = a['ISO3166-2-lvl4'] || '', state = /^US-/.test(iso) ? iso.slice(3) : (a.state || '');
        var tail = [city, [state, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        if (tail) { st.osmPlace = tail; LG.debug('osm', 'City for stop ' + (i + 1), tail); }
      } catch (e) { LG.warn('osm', 'City lookup unreadable', String(e)); }
      if (route === r) renderStops();
    }
  }

  // ---------- sharing ----------
  function money2(v) { return '$' + v.toFixed(2); }
  function shareTrip() {
    var r = result, p = r && r.plan;
    var o = route.stops[0], d = route.stops[route.stops.length - 1];
    var L = ['Gasket trip: ' + stopLine(o) + ' → ' + stopLine(d), Math.round(model.totalMi) + ' mi · ' + fmtDur(model.durationSec) + ' · ' + gradeLabel(r.grade).toLowerCase()];
    if (p && p.ok) {
      p.stops.forEach(function (s, i) {
        L.push((i + 1) + '. ' + s.c.station.name + ' — ' + (s.c.station.address || '') + ' — mile ' + Math.round(s.c.d) + ' — ' + priceText(s.c.price) + '/' + UN() + ' — buy ' + s.buyGal.toFixed(1) + ' ' + UN() + ' (' + money2(s.cost) + ')');
      });
      if (r.top) L.push('Top-up: ' + r.top.c.station.name + ' — ' + priceText(r.top.c.price) + ' — ' + r.top.buyGal.toFixed(1) + ' ' + UN());
      if (r.acc) L.push('Trip cost ' + money2(r.acc.legs[0].cost) + ' · at the pump ' + money2(r.acc.legs[0].spend) + (p.savings > 0.005 ? ' · saves ' + money2(p.savings) + ' vs. easiest stops' : ''));
      if (r.acc && r.acc.legs[1]) L.push('Round trip estimate ' + money2(r.acc.legs[0].cost + r.acc.legs[1].cost));
      var ex = exports();
      if(!ex.one.tooMany)L.push('', 'Open in Google Maps: ' + ex.one.url);
      else ex.legs.forEach(function(x){L.push('', 'Leg '+(x.leg+1)+(x.parts>1?' · Part '+(x.part+1)+' of '+x.parts:'')+': '+stopLine(x.from)+' → '+stopLine(x.to),x.url);});
    }
    L.push('', 'To plan this trip in Gasket, paste this whole message into the trip link box:', tripBlock());
    N.shareText('Gasket trip', L.join('\n'));
    LG.info('share', 'Shared trip summary');
  }
  function report() {
    var safeSettings = JSON.parse(JSON.stringify(S));
    delete safeSettings.apiKey; safeSettings.hasApiKey = !!S.apiKey;
    var r = result;
    var rep = {
      gasketReport: 1, app: N.appVersion ? N.appVersion() : '', time: new Date().toString(), userAgent: navigator.userAgent,
      settings: safeSettings, lookups: { placesThisMonth: N.callsThisMonth(), routesThisMonth: N.routeCallsThisMonth ? N.routeCallsThisMonth() : null },
      link: dbg,
      stops: route && route.stops, routeOptionsFromGoogleMaps: route && route.mapsRoutes, routeIndex: route && route.routeIndex,
      routeRequest: dbg.routeBody, routeOptions: alts.map(function (a, k) { return { k: k, via: a.description, miles: Math.round((a.distanceMeters || 0) / 160.9344) / 10, duration: a.duration, picked: k === altSel }; }),
      route: model ? { miles: Math.round(model.totalMi * 10) / 10, minutes: Math.round(model.durationSec / 60), points: model.pts.length, gallons: Math.round(model.galTo(model.totalMi) * 100) / 100 } : null,
      search: dbg.search,
      candidates: r ? r.cands.map(function (c) {
        return { id: c.id, brand: c.station.brand, name: c.station.name, address: c.station.address, source: c.station.source, mile: Math.round(c.d * 10) / 10,
          offRoute: Math.round(c.offset * 100) / 100, detourMi: Math.round(c.detourMi * 100) / 100, detourMin: Math.round(c.detourMin * 10) / 10, exact: c.detourExact,
          price: c.price, posted: c.calc.base, stale: c.calc.stale };
      }) : null,
      plan: r && r.plan ? { ok: r.plan.ok, reachMi: r.plan.reachMi, tooFar: r.plan.tooFar, refPrice: r.plan.refPrice, totals: r.plan.totals, savings: r.plan.savings,
        stops: (r.plan.stops || []).map(function (s) { return { id: s.c.id, name: s.c.station.name, mile: Math.round(s.c.d * 10) / 10, price: s.c.price, buyGal: s.buyGal, arriveGal: s.arriveGal, departGal: s.departGal, why: s.why }; }),
        notes: r.notes, bufferMi: r.bufMi } : null,
      otherRoutes: r && r.routes ? compareRoutes() : null,
      speed: model && model._lim && model._lim.roads ? { stats: model._lim.stats, offsets: r && r.speedState && r.speedState.offsets, cost: r && r.speedState && r.speedState.cost,
        roads: model._lim.roads.map(function (x) { return { name: x.name, cls: x.cls, from: Math.round(x.from), to: Math.round(x.to), pieces: x.pieces.map(function (p) { return [Math.round(p.from), p.st || '', p.limit, p.src, Math.round(p.googleMph)]; }) }; }),
        instructions: model.segs.filter(function (sg) { return sg.to - sg.from > 0.5; }).slice(0, 200).map(function (sg) { return [Math.round(sg.from * 10) / 10, Math.round((sg.to - sg.from) * 10) / 10, sg.instr]; }) } : null,
      bufferSweep: r && r.sweep ? r.sweep.map(function (x) { return { mi: x.mi, ok: x.ok, net: x.net && Math.round(x.net * 100) / 100, mark: x.mark, stops: x.ok ? x.plan.stops.map(function (s) { return s.c.station.name + ' @' + Math.round(s.c.d); }) : null }; }) : null,
      log: window.FLog ? FLog.entries().slice(-300) : []
    };
    return JSON.stringify(rep, null, 1);
  }
  /** The troubleshooting report: built after the button shows it's working, then saved and shared as a file in the background. */
  async function shareReport(e) {
    var btn = e && e.target && e.target.closest ? e.target.closest('a, button') : null;
    if (btn && btn.dataset.busy) return;
    if (btn) { btn.dataset.busy = 1; btn.dataset.lbl0 = btn.textContent; btn.textContent = 'Preparing the report…'; }
    await paint();
    try {
      var text = report();
      if (text.length > 1500000) text = text.slice(0, 1500000) + '\n…(trimmed)';
      LG.info('share', 'Troubleshooting report shared', { chars: text.length });
      await window.__shareFile('gasket-report-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json', 'application/json', text, 'Gasket troubleshooting report');
    } catch (x) { toastMsg('Couldn\'t make the report: ' + (x.message || x)); }
    if (btn) { delete btn.dataset.busy; btn.textContent = btn.dataset.lbl0; }
  }
  window.__tripReport = report;

  async function openInGoogleMaps(url) {
    var u = url.replace(/^https?:\/\/(maps\.google\.com|google\.com|www\.google\.com)\/maps\//, 'https://www.google.com/maps/');
    if (!/^https:\/\/www\.google\.com\/maps\/dir\//.test(u)) return null;
    var run = gmapsChain.then(function () { return site('gmaps', { url: u }, 40000); });
    gmapsChain = run.catch(function () { });
    return run;
  }
  var gmapsChain = Promise.resolve();
  var parsing = null;      // {text, p, frac}
  function parseBar(f) {
    var el = $('tParsed'); if (!el || !parsing) return;
    parsing.frac = Math.max(parsing.frac || 0, Math.min(1, f));
    var pct = Math.round(parsing.frac * 100), bar = el.querySelector('.parse-load i');
    if (bar) { bar.style.width = pct + '%'; el.querySelector('.parse-load .pct').textContent = pct + '%'; return; }
    el.innerHTML = '<div class="parse-load"><span>Loading…</span><span class="pbar"><i style="width:' + pct + '%"></i></span><span class="pct">' + pct + '%</span></div>';
  }
  /** Creep the bar toward `to` while waiting on something that reports no progress (the hidden Google Maps page). */
  function creep(from, to, sec) {
    var t0 = Date.now(), id = setInterval(function () {
      if (!parsing) return clearInterval(id);
      var x = (Date.now() - t0) / 1000 / sec; parseBar(from + (to - from) * (1 - Math.exp(-3 * x)));
    }, 250);
    return function () { clearInterval(id); };
  }
  function stopLine(s) {
    if (s.current) return 'Your location';
    if (!T.fullAddress(s.address) && s.osmPlace) return (s.address || s.label) + ', ' + s.osmPlace;
    return s.address || s.label;
  }
  function renderStops() {
    var el = $('tParsed'); if (!el || parsing) return;
    if (!route) { el.innerHTML = ''; return; }
    var r = route;
    if (syncReturn(r) && model) { model = null; renderInfo(); }
    var h = numList(r.stops, function (s, i) {
      var x = '';
      if (s.err) x += '<div class="msg err">' + esc(s.err) + '</div>';
      if (s.choices) {
        x += '<div class="pick"><div class="pick-h">Which one?</div>' + s.choices.map(function (c, k) {
          return '<button data-stop="' + i + '" data-choice="' + k + '">' + esc(c.formattedAddress) + (c.displayName && c.displayName.text && !norm(c.displayName.text).split(' ').every(function (w) { return norm(c.formattedAddress).split(' ').indexOf(w) >= 0; }) ? '<small>' + esc(c.displayName.text) + '</small>' : '') + '</button>';
        }).join('') + '</div>';
      }
      return x;
    });
    if (r.mode && r.mode !== 'drive') h += '<div class="msg err">This link is for ' + esc(r.mode) + ' directions; fuel stops will use driving directions.</div>';
    // route options are picked after Get routes (one picker, with Google's own routes) — none before it
    var withPts = false;
    if (withPts && !model) {
      var selK = r.routeIndex != null ? Math.min(r.routeIndex, r.mapsRoutes.length - 1) : 0;
      h += '<div class="maps-opts"><div class="sub-h">Pick a route</div><div class="rmap" id="tOptMap"></div>' +
        '<div class="opt-sel">via <b>' + esc(r.mapsRoutes[selK].via) + '</b> · ' + Math.round(r.mapsRoutes[selK].miles || 0).toLocaleString() + ' mi · ' + fmtDur((r.mapsRoutes[selK].minutes || 0) * 60) + '</div></div>';
    }
    if (r.note) h += '<div class="msg err">' + esc(r.note) + '</div>';
    el.innerHTML = h;
    if ($('tOptMap')) optionsMap($('tOptMap'), r.mapsRoutes.map(function (m) {
      return { pts: m.pts, time: fmtDur((m.minutes || 0) * 60), miles: Math.round(m.miles || 0).toLocaleString() + ' mi' };
    }), r.routeIndex != null ? Math.min(r.routeIndex, r.mapsRoutes.length - 1) : 0, function (k) { r.routeIndex = k; LG.info('route', 'Picked route option ' + (k + 1) + ' on the map', r.mapsRoutes[k].via); renderStops(); });
    el.querySelectorAll('[data-choice]').forEach(function (b) {
      b.onclick = function () {
        var st = r.stops[+b.dataset.stop], c = st.choices[+b.dataset.choice];
        setPlace(st, c); st.choices = null; model = null; renderStops(); renderInfo(); autoRoutes();
      };
    });
  }
  /** The trip's places as a numbered list (1, 2, 3 …); extra(stop, i) adds anything under a place (an error, a "which one?"). */
  function numList(stops, extra) {
    return '<ol class="nlist">' + stops.map(function (st, i) {
      return '<li><span class="nn">' + (i + 1) + '</span><div class="nl-a">' + esc(stopLine(st)) + (extra ? extra(st, i) : '') + '</div></li>';
    }).join('') + '</ol>';
  }
  function pickedRoute(r) {
    if (!r || !r.mapsRoutes || !r.mapsRoutes.length) return null;
    return r.mapsRoutes[Math.min(r.routeIndex || 0, r.mapsRoutes.length - 1)];
  }
  function words(x) { return norm(String(x || '').replace(/^via\s+/i, '')).split(' ').filter(Boolean); }
  /** Which of Google's route options is the one you picked in Maps: same "via" roads, about the same length. */
  function matchRoute(list, picked) {
    var best = -1, bestScore = -1;
    var pw = words(picked.via);
    list.forEach(function (a, k) {
      var aw = words(a.description), common = pw.filter(function (w) { return aw.indexOf(w) >= 0; }).length;
      var name = pw.length + aw.length ? 2 * common / (pw.length + aw.length) : 0;
      var mi = (a.distanceMeters || 0) / 1609.344;
      var len = picked.miles ? Math.max(0, 1 - Math.abs(mi - picked.miles) / Math.max(1, picked.miles * 0.06)) : 0;
      var sc = name * 2 + len;
      if (sc > bestScore) { bestScore = sc; best = k; }
    });
    return { index: best, sure: bestScore >= 2.2 };
  }
  function setPlace(st, c) {
    st.placeId = c.id; st.address = c.formattedAddress; st.label = c.formattedAddress; st.short = T.shortLabel(c.formattedAddress);
    st.lat = c.location.latitude; st.lng = c.location.longitude; st.err = null;
  }
  function norm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  /** Does Google's top answer clearly match what was written (same ZIP, or same city/state)? */
  function clearMatch(query, results) {
    if (results.length === 1) return true;
    var zip = /\b(\d{5})\b/.exec(query);
    if (zip) { var z = results.filter(function (c) { return c.formattedAddress.indexOf(zip[1]) >= 0; }); return z.length === 1 && z[0] === results[0]; }
    var parts = query.split(',').map(norm).filter(Boolean);
    if (parts.length < 2) return false;                         // "100 Main St" alone is ambiguous
    var tail = parts.slice(1).join(' ');
    var hits = results.filter(function (c) { return norm(c.formattedAddress).indexOf(tail) >= 0 || tail.split(' ').every(function (w) { return norm(c.formattedAddress).split(' ').indexOf(w) >= 0; }); });
    return hits.length === 1 && hits[0] === results[0];
  }
  /** A stop whose exact spot we know but whose name is just a street ("500 Woodlane St"): ask Google for the place
   *  at that spot (tight 300 m circle) to get its full address. The link's coordinates are always kept. */
  /** Google place lookup, saved for a month (an address doesn't move). */
  async function findPlace(q, lat, lng, bias, radius) {
    var key = [q, (+lat).toFixed(4), (+lng).toFixed(4), bias ? 1 : 0, radius].join('|'), o = A.KV.get('find', key, 30 * 24 * 3600e3);
    if (o) return o.v;
    var res = await call('placesFind', S.apiKey, q, lat, lng, bias, radius);
    if (!res.error) A.KV.put('find', key, res);
    return res;
  }
  async function completeAddress(st) {
    try {
      var res = await findPlace(st.address, st.lat, st.lng, true, 300);
      if (res.error) return;
      var list = (JSON.parse(res.body).places || []).filter(function (c) { return c.location && c.formattedAddress; });
      var best = null, bestD = 0.25;
      list.forEach(function (c) {
        var d = T.hav({ lat: st.lat, lng: st.lng }, { lat: c.location.latitude, lng: c.location.longitude });
        if (d < bestD) { bestD = d; best = c; }
      });
      if (best) {
        var lat = st.lat, lng = st.lng;
        setPlace(st, best); st.lat = lat; st.lng = lng; st.fromLink = true;
        LG.debug('address', 'Full address near the link\'s spot', best.formattedAddress);
      } else LG.warn('address', 'No Google place within 0.25 mi of ' + st.address);
    } catch (e) { /* keep the exact spot; the street name stays as the label */ }
  }
  /** Look up every stop that has only text (typed, or a link without exact coordinates). Returns false if you need to pick. */
  async function resolveStops(r, onProg, quiet) {
    if(!S.apiKey)return true; // Maps' ordinary directions page resolves typed addresses without Places calls
    var me = A.me(), need = false, done = 0, n = r.stops.length;
    var tick = function () { done++; if (onProg) onProg(done / n); };
    // stops with an exact spot: fill in the full address, all at once
    await Promise.all(r.stops.map(function (st) {
      if (st.current || st.lat == null) return Promise.resolve();
      return (!st.placeId && !T.fullAddress(st.address) && st.address && S.apiKey ? completeAddress(st) : Promise.resolve()).then(tick);
    }));
    // text-only stops: look each one up near the stop before it (also all at once)
    await Promise.all(r.stops.map(async function (st, i) {
      if (st.current || st.lat != null) return;
      if (st.choices) { need = true; return; }
      var prev = null;
      for (var k = i - 1; k >= 0 && !prev; k--) if (r.stops[k].lat != null) prev = { lat: r.stops[k].lat, lng: r.stops[k].lng };
      var near = prev || (me ? { lat: me.lat, lng: me.lng } : null);
      var res = await findPlace(st.address, near ? near.lat : 0, near ? near.lng : 0, !!near, 50000);
      tick();
      if (res.error) { st.err = res.error; need = true; return; }
      var list = (JSON.parse(res.body).places || []).filter(function (c) { return c.location && c.formattedAddress; });
      if (!list.length) { st.err = 'Google couldn\'t find this address. Add the city and state.'; need = true; return; }
      if (clearMatch(st.address, list)) { setPlace(st, list[0]); LG.debug('address', 'Found ' + st.address); }
      else { st.choices = list.slice(0, 5); need = true; LG.info('address', 'Several matches for “' + st.address + '”', list.map(function (c) { return c.formattedAddress; })); }
    }));
    if (!quiet) renderStops();
    return !need;
  }

  function typedRoute() {
    var from = $('tFrom').value.trim(), to = $('tTo').value.trim();
    if (!to) return null;
    if (!from) return null;
    var mk = function (t) { return { address: t, label: t, short: T.shortLabel(t) }; };
    var via = viaList().filter(Boolean).map(mk);      // stops in between, in order (each its own leg, like a link's)
    return { stops: [isHere(from) ? { current: true, label: 'Your location' } : mk(from)].concat(via, [mk(to)]), avoid: {}, mode: 'drive', typed: true };
  }
  // ---------- stops in between, for typed addresses ----------
  var MAX_VIA = 8;
  function viaList() { var ins = document.querySelectorAll('#tVia .via-in'); return ins.length ? Array.prototype.map.call(ins, function (e) { return e.value.trim(); }) : (S.trip.via || []).slice(); }
  function viaHtml() {
    var v = S.trip.via || [];
    return v.map(function (x, i) {
      return '<div class="field col via-row"><div class="lbl">Stop ' + (i + 1) + '</div><span class="in-btn"><input type="text" class="via-in" data-via="' + i + '" placeholder="Address or place" value="' + esc(x) + '">' +
        '<button type="button" class="via-x" data-via-x="' + i + '" aria-label="Remove stop ' + (i + 1) + '">✕</button></span></div>';
    }).join('') + (v.length < MAX_VIA ? '<button type="button" class="btn tonal sm via-add" id="tViaAdd">+ Add a stop</button>' : '');
  }
  /** A stop added, removed or retyped: the route is looked up again (once you've left the box). */
  function viaChanged() { route = null; model = null; replay = null; result = null; autoRoute = true; renderInfo(); renderStops(); }
  function bindVia() {
    var box = $('tVia'); if (!box) return;
    box.querySelectorAll('.via-in').forEach(function (inp) {
      inp.addEventListener('input', function () { S.trip.via = viaList(); A.save(); viaChanged(); });
      inp.addEventListener('change', function () { autoRoutes(); });
    });
    box.querySelectorAll('[data-via-x]').forEach(function (b) {
      b.onclick = function () { var v = viaList(); v.splice(+b.dataset.viaX, 1); S.trip.via = v; A.save(); box.innerHTML = viaHtml(); bindVia(); viaChanged(); autoRoutes(); };
    });
    if ($('tViaAdd')) $('tViaAdd').onclick = function () {
      var v = viaList(); v.push(''); S.trip.via = v; box.innerHTML = viaHtml(); bindVia();
      var ins = box.querySelectorAll('.via-in'); if (ins.length) ins[ins.length - 1].focus();
    };
  }
  function wp(s) {
    if (s.current) {
      var me = A.me();
      if (!me) throw new Error('Your location isn\'t known yet. Turn on location, or type a starting point.');
      return { location: { latLng: { latitude: me.lat, longitude: me.lng } } };
    }
    // the exact spot from your Google Maps link wins; a place ID is used for stops you typed or picked
    if (s.fromLink && s.lat != null) return { location: { latLng: { latitude: s.lat, longitude: s.lng } } };
    if (s.placeId) return { placeId: s.placeId };
    if (s.lat != null) return { location: { latLng: { latitude: s.lat, longitude: s.lng } } };
    return { address: s.address };
  }

  // ---------- trips with stops in between ----------
  // Google Maps (and the Routes API) only offer route options for a trip from A to B. So with stops in between, each
  // leg is routed on its own — with all of its options — and the picks are joined into one trip for the fuel plan.
  /** Ends where it started (a round trip planned as legs): the "drive back" estimate would count the way home twice. */
  function loopTrip(r) {
    r = r || route;
    var a = r && r.stops[0], b = r && r.stops[r.stops.length - 1];
    if (!a || !b || a === b) return false;
    if (a.current || b.current) return !!(a.current && b.current);
    return a.lat != null && b.lat != null && T.hav(a, b) < 0.5;
  }
  /**
   * The "Round trip" switch: adds the way back to the start as a last stop (marked ret), or takes it off. Not added when
   * the trip already ends where it starts. Returns true when the stops changed.
   */
  function syncReturn(r) {
    if (!r || !r.stops || r.stops.length < 2) return false;
    // a way back that's already there stays as it is (a saved trip's; "your location" moves a little every time
    // you look, and that's no reason to throw its routes away)
    // (is it a loop without the way back? the way back itself always ends where it started)
    if (S.trip.returnTrip && !loopTrip({ stops: r.stops.filter(function (x) { return !x.ret; }) }) && r.stops.filter(function (x) { return x.ret; }).length === 1 && r.stops[r.stops.length - 1].ret) return false;
    var before = JSON.stringify(r.stops.filter(function (x) { return x.ret; }));
    r.stops = r.stops.filter(function (x) { return !x.ret; });
    if (S.trip.returnTrip && r.stops.length >= 2 && !loopTrip(r)) {
      var a = r.stops[0], back = Object.assign({}, a, { ret: true, choices: null });
      if (a.current) {
        var me = A.me();
        if (me) back = { ret: true, lat: me.lat, lng: me.lng, fromLink: true, address: me.lat.toFixed(6) + ',' + me.lng.toFixed(6), label: 'Your location', short: 'Your location' };
      }
      r.stops.push(back);
    }
    return JSON.stringify(r.stops.filter(function (x) { return x.ret; })) !== before;
  }
  function multiLeg(r) { return !!(r && r.stops && r.stops.length > 2); }
  /** "North Little Rock → Dallas" as pieces that wrap as a whole: "North Little Rock →" then "Dallas" on the next line if it doesn't fit. */
  function arrowHtml(text) {
    var parts = String(text).split(' → ');
    return '<span class="arws">' + parts.map(function (x, i) { return '<span class="arw">' + esc(x) + (i < parts.length - 1 ? ' →' : '') + '</span>'; }).join(' ') + '</span>';
  }
  function legName(r, i) { return stopName(r.stops[i]) + ' → ' + stopName(r.stops[i + 1]); }
  function legBody(a, b) {
    var avoid = S.trip.avoid;
    return Object.assign({ origin: wp(a), destination: wp(b), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', polylineQuality: 'HIGH_QUALITY', units: 'IMPERIAL',
      computeAlternativeRoutes: true, routeModifiers: { avoidTolls: !!avoid.tolls, avoidHighways: !!avoid.highways, avoidFerries: !!avoid.ferries } }, tollPair() ? { extraComputations: ['TOLLS'] } : {});
  }
  function legKey(r, i) { return [r.stops[i], r.stops[i + 1]].map(function (st) { return st.current ? 'here' : st.lat != null ? st.lat.toFixed(4) + ',' + st.lng.toFixed(4) : st.address; }).join('>') + '|' + JSON.stringify(S.trip.avoid) + (tollPair() ? '|tolls' : ''); }
  async function routeLeg(r, i) {
    var prev = r.legs && r.legs[i];
    if (prev && prev.key !== legKey(r, i)) prev = null;
    var sub = { stops: [r.stops[i], r.stops[i + 1]], avoid: r.avoid, mapsRoutes: prev && prev.mapsRoutes || null };
    if(!S.apiKey){var wa=await withTollFree(sub,await websiteRoutes(sub));return {key:legKey(r,i),alts:wa,sel:Math.min(prev&&prev.sel||0,wa.length-1),mapsRoutes:sub.mapsRoutes};}
    var body = legBody(sub.stops[0], sub.stops[1]);
    var res = await routesCall(body);
    if (res.error) throw new Error('Leg ' + (i + 1) + ' (' + legName(r, i) + '): ' + res.error);
    var j = JSON.parse(res.body);
    if (!j.routes || !j.routes.length) throw new Error('Google found no driving route for leg ' + (i + 1) + ' (' + legName(r, i) + ').');
    var cx = { alts: j.routes };
    await allMapsRoutes(sub, body, cx);
    cx.alts = await withTollFree(sub, cx.alts, body);
    // same pick as before when this leg was routed already
    var sel = 0, want = prev && prev.alts && prev.alts[prev.sel] && prev.alts[prev.sel].description;
    if (want) cx.alts.forEach(function (a, k) { if (a.description === want) sel = k; });
    // the way out of a Google Maps link made into a round trip: start on the route option picked in Maps
    else if (i === 0 && r.mapsRoutes && r.routeIndex != null && r.stops.filter(function (x) { return !x.ret; }).length === 2) sel = Math.max(0, matchRoute(cx.alts, r.mapsRoutes[Math.min(r.routeIndex, r.mapsRoutes.length - 1)]).index);
    return { key: legKey(r, i), alts: cx.alts, sel: sel, mapsRoutes: sub.mapsRoutes };
  }
  /** Prefetch each leg's route options from Google Maps while you look over the trip (free; saved for 2 hours). */
  function scanLegs(r) {
    if (!multiLeg(r)) return;
    r.stops.slice(0, -1).forEach(function (_, i) {
      var sub = { stops: [r.stops[i], r.stops[i + 1]] };
      if (sub.stops.some(function (s) { return s.current || s.lat == null; })) return;
      mapsOptions(sub).then(function (mr) { r.legs = r.legs || []; r.legs[i] = Object.assign(r.legs[i] || {}, { key: legKey(r, i), mapsRoutes: mr }); }).catch(function () { });
    });
  }
  /** The trip as picked (alts[0]) plus each single-leg swap, closest in time first (those are what "other routes" checks). */
  function rebuildAlts() {
    var cur = route.legs.map(function (L) { return L.sel; });
    var combo = function (sel, desc, leg) {
      var o = { _sel: sel, description: desc, distanceMeters: 0, duration: '0s' }, sec = 0, built = null;
      route.legs.forEach(function (L, i) { var a = L.alts[sel[i]]; o.distanceMeters += a.distanceMeters || 0; sec += parseFloat(String(a.duration || '0')); });
      o.duration = Math.round(sec) + 's';
      if (leg != null) o._leg = leg;
      var get = function () { return built || (built = T.joinRoutes(route.legs.map(function (L, i) { return L.alts[sel[i]]; }))); };
      Object.defineProperty(o, 'polyline', { get: function () { return get().polyline; }, enumerable: true });
      Object.defineProperty(o, 'legs', { get: function () { return get().legs; }, enumerable: true });
      return o;
    };
    var main = combo(cur, route.legs.map(function (L) { return L.alts[L.sel].description || ''; }).filter(Boolean).join(' / '));
    var others = [];
    route.legs.forEach(function (L, i) {
      L.alts.forEach(function (a, k) {
        if (k === L.sel) return;
        var s2 = cur.slice(); s2[i] = k;
        others.push(combo(s2, (a.description || 'route ' + (k + 1)) + ' on leg ' + (i + 1), i));
      });
    });
    var t0 = parseFloat(main.duration);
    others.sort(function (x, y) { return Math.abs(parseFloat(x.duration) - t0) - Math.abs(parseFloat(y.duration) - t0); });
    alts = [main].concat(others); altSel = 0; altSure = true;
  }
  async function pickLeg(i, k) {
    var L = route.legs[i]; if (!L || k === L.sel || picking || busy) return;
    routeReview=null;choiceComplete=false;choicePool=null;
    L.sel = k;
    document.querySelectorAll('#tRouteInfo [data-leg="' + i + '"]').forEach(function (b) { b.classList.toggle('on', +b.dataset.lk === k); });
    var rm = rmaps['tRmap' + i], ld = rm && rm._setSel ? (rm._setSel(k), A.loader(rm.getContainer(), 'Joining the legs')) : null;
    picking = true;
    await paint();
    try { rebuildAlts(); rawRoute = alts[0]; model = T.buildRoute(rawRoute, carModel()); ensureLimits(model); result = null; } finally { picking = false; if (ld) ld.done(); }
    LG.info('route', 'Leg ' + (i + 1) + ': picked via ' + (L.alts[k].description || k));
    rememberSel();
    renderInfo(true);
  }

  // ---------- step 1: route ----------
  async function go() {
    if (busy) return;
    collect();
    if (model) return;
    routeReview=null;choiceComplete=false;choicePool=null;
    busy = true; routing = true; prog(0.03, 'Reading the link');
    LG.info('route', 'Get route pressed', { miles: S.trip.milesLeft, buffer: S.trip.bufferMi, car: Garage.car() });
    try {
      if (parsing) prog(0.05, 'Reading the link');
      var r = srcOf() === 'typed' ? (route && route.typed ? route : typedRoute())
        : (parsing ? await parsing.p : route) || (S.trip.link && !route ? await readLink() : null) || route;
      if (!r) throw new Error(srcOf() === 'typed' ? 'Enter where you\'re starting and where you\'re going.' : 'Paste a Google Maps directions link.');
      route = r;
      prog(0.15, 'Checking addresses');
      if (!(await resolveStops(r, function (f) { prog(0.15 + f * 0.4, 'Checking addresses'); }))) {
        LG.warn('route', 'Waiting for you to pick addresses', r.stops.map(function (x) { return x.address; }));
        busy = false; renderInfo();
        throw new Error('Pick the right address for each stop marked “Which one?”.');
      }
      syncReturn(r);
      // the same places as a trip you saved (even from another link): its routes and stations, no lookups
      var mt = !freshRoutes && similarTrip(r);
      if (mt) {
        var v = mt.v;
        if (!r.mapsRoutes && v.route.mapsRoutes) r.mapsRoutes = v.route.mapsRoutes;
        if (multiLeg(r)) {
          if (v.route.legs && v.route.legs.length === r.stops.length - 1 && v.route.legs.every(function (L) { return L.alts && L.alts.length; })) {
            r.legs = v.route.legs.map(function (L, i) { return { key: legKey(r, i), alts: L.alts, sel: Math.min(L.sel || 0, L.alts.length - 1), mapsRoutes: null }; });
            rebuildAlts();
          } else mt = null;
        } else {
          alts = v.alts; altSure = false;
          var picked0 = pickedRoute(r);
          if (picked0 && alts.length > 1) { var m0 = matchRoute(alts, picked0); altSel = m0.index; altSure = m0.sure; }
          else altSel = r.routeIndex != null && r.routeIndex < alts.length ? r.routeIndex : Math.min(v.altSel || 0, alts.length - 1);
        }
        // a trip saved before tolls were compared (or with the switch off): its options get their toll-free ones now
        if (mt && tollPair()) { prog(0.7, 'Getting the toll-free routes'); await tollFreeForSaved(); }
        if (mt) {
          prog(0.9, 'Reading your saved trip');
          await paint();
          r.reused = mt.t; // Reuse station/route data, never the saved trip's consent identity.
          rawRoute = alts[altSel]; model = T.buildRoute(rawRoute, carModel()); ensureLimits(model);
          replay = { id: mt.id, t: mt.t, stations: v.stations, alts: v.alts, partial: true };
          LG.info('history', 'Same places as a saved trip — using its routes (no lookups)', { id: mt.id, saved: new Date(mt.t).toISOString(), options: alts.map(function (a) { return a.description; }), picked: altSel });
        }
      }
      if (model) { /* reused */ } else if (multiLeg(r)) {
        // a stop in between: Google only offers route options trip by trip, so route each leg on its own and join them
        var nL = r.stops.length - 1, doneL = 0;
        prog(0.6, 'Routing each leg (0 of ' + nL + ')');
        var legs = await Promise.all(r.stops.slice(0, -1).map(function (_, i) {
          return routeLeg(r, i).then(function (x) { doneL++; prog(0.6 + 0.3 * doneL / nL, 'Routing each leg (' + doneL + ' of ' + nL + ')'); return x; });
        }));
        r.legs = legs;
        rebuildAlts();
        rawRoute = alts[0];
        model = T.buildRoute(rawRoute, carModel());
        ensureLimits(model);
        LG.info('route', 'Route ready (' + nL + ' legs, each routed on its own)', { legs: legs.map(function (L) { return { options: L.alts.map(function (a) { return a.description; }), picked: L.sel }; }), miles: Math.round(model.totalMi) });
      } else {
        prog(0.6, 'Asking Google for the route');
        if(!S.apiKey){
          alts=await withTollFree(r,await websiteRoutes(r));altSel=r.routeIndex==null?0:alts.findIndex(function(a){return a.websiteOptionIndex===r.routeIndex;});altSure=false;
          if(altSel<0)throw new Error('The selected website route has no usable geometry. Choose another route, retry, or add the recommended API key.');
          rawRoute=alts[altSel];model=T.buildRoute(rawRoute,carModel());ensureLimits(model);
        }else{
        var avoid = S.trip.avoid;
        var body = {
          origin: wp(r.stops[0]), destination: wp(r.stops[r.stops.length - 1]),
          intermediates: r.stops.slice(1, -1).map(wp), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE',
          polylineQuality: 'HIGH_QUALITY', units: 'IMPERIAL',
          routeModifiers: { avoidTolls: !!avoid.tolls, avoidHighways: !!avoid.highways, avoidFerries: !!avoid.ferries }
        };
        if (body.intermediates.length > 10) throw new Error('Google routes allow up to 10 stops in between.');
        if (!body.intermediates.length) body.computeAlternativeRoutes = true;   // so you can pick the same one as in Google Maps
        if (tollPair()) body.extraComputations = ['TOLLS'];
        dbg.routeBody = body;
        LG.debug('route', 'Routes request', body);
        var res = await routesCall(body);
        if (res.error) { LG.error('route', 'Routes failed', res.error); throw new Error(res.error); }
        prog(0.9, 'Reading the route');
        LG.trace('route', 'Routes answer', res.body);
        var j = JSON.parse(res.body);
        if (!j.routes || !j.routes.length) throw new Error('Google found no driving route for that trip.');
        alts = j.routes;
        if (!body.intermediates.length) await allMapsRoutes(r, body);
        alts = await withTollFree(r, alts, body);
        var picked = pickedRoute(r);
        altSure = false;
        if (picked && alts.length > 1) { var mt = matchRoute(alts, picked); altSel = mt.index; altSure = mt.sure; }
        else altSel = r.routeIndex != null && r.routeIndex < alts.length ? r.routeIndex : 0;
        rawRoute = alts[altSel];
        model = T.buildRoute(rawRoute, carModel());
        ensureLimits(model);
        LG.info('route', 'Route ready', { options: alts.map(function (a) { return a.description; }), picked: altSel, sure: altSure, miles: Math.round(model.totalMi) });
        }
      }
    } catch (e) {
      LG.error('route', e.message || String(e));
      toastMsg(e.message || String(e));
    }
    busy = false; routing = false; freshRoutes = false;
    progEnd();
    renderInfo();
    if (model) hzPreload();
  }
  function carModel() { return Garage.carModel(); }

  // ---------- every route option Google Maps shows ----------
  // The Routes API often returns fewer alternatives than the Maps app. So: read the options from Google Maps itself
  // (the hidden Maps page, no lookup), and for any option the Routes API didn't return, ask for it again with a
  // pass-through point pushed off to one side of the main route until the answer matches that option's length/roads.
  function roadTokens(x) {
    var out = [], re = /\b(I|US|SR|[A-Z]{2})[-\s]?(\d{1,3}[A-Z]?)\b/gi, m;
    while ((m = re.exec(String(x || '')))) out.push(m[1].toUpperCase().replace(/^SR$/, 'ST') + m[2].toUpperCase());
    return out;
  }
  function nameSim(a, b) {
    var ta = roadTokens(a), tb = roadTokens(b);
    if (!ta.length || !tb.length) return null;
    var common = ta.filter(function (t) { return tb.indexOf(t) >= 0; }).length;
    return common / Math.max(ta.length, tb.length);
  }
  function altMiles(a) { return (a.distanceMeters || 0) / 1609.344; }
  function altMinutes(a) { return parseFloat(String(a.duration || '0')) / 60; }
  function sameAsMaps(a, m) {
    if (!m.miles) return false;
    var dmi = Math.abs(altMiles(a) - m.miles) / m.miles, ns = nameSim(a.description, m.via);
    // Maps and the Routes API sometimes name the same road differently ("via I-71 N" vs "I-64 E"): a near-identical
    // length and time means the same route even when the names disagree
    if (dmi <= 0.004 && (!m.minutes || Math.abs(altMinutes(a) - m.minutes) / m.minutes <= 0.08)) return true;
    if (ns != null) return ns >= 0.99 && dmi <= 0.03;
    return dmi <= 0.02 && (!m.minutes || Math.abs(altMinutes(a) - m.minutes) / m.minutes <= 0.06);
  }
  /** Share of route b's points that lie within 2 miles of route a (1 = same road all the way). */
  function overlap(a, b) {
    var pa = decoded(a), pb = decoded(b);
    var stepA = Math.max(1, Math.floor(pa.length / 400)), stepB = Math.max(1, Math.floor(pb.length / 60)), near = 0, n = 0;
    for (var i = 0; i < pb.length; i += stepB) {
      n++;
      for (var k = 0; k < pa.length; k += stepA) if (T.hav(pb[i], pa[k]) < 2) { near++; break; }
    }
    return n ? near / n : 0;
  }
  var scanning = {};     // Google Maps route scans in progress, by address (so a leg is never scanned twice at once)
  async function mapsOptions(r, avoidOver) {
    var avoid=avoidOver||S.trip.avoid||{};
    if (r.mapsRoutes && r.mapsRoutes.length && r.mapsRoutes[0].pts&&(S.apiKey||r.websiteAvoid===JSON.stringify(avoid))) return r.mapsRoutes;
    if (r.stops.length !== 2 || r.stops.some(function (s) { return s.current&&!A.me(); })) return r.mapsRoutes || null;
    // exact spots when known: Google Maps on a desktop page sometimes "can't find" a street-only name from a phone link
    var place = function (s) { var p=s.current?A.me():s;return p.lat != null ? p.lat.toFixed(7) + ',' + p.lng.toFixed(7) : (s.address || s.label); };
    var url = 'https://www.google.com/maps/dir/' + encodeURIComponent(place(r.stops[0])) + '/' + encodeURIComponent(place(r.stops[1])) + '/';
    var avoidNames=['tolls','highways','ferries'].filter(function(k){return avoid[k];});
    if(avoidNames.length)url='https://www.google.com/maps/dir/?api=1&travelmode=driving&origin='+encodeURIComponent(place(r.stops[0]))+'&destination='+encodeURIComponent(place(r.stops[1]))+'&avoid='+encodeURIComponent(avoidNames.join('|'));
    var o = A.KV.get('mapsopts', url, 2 * 3600e3), g;
    if (o) g = o.v;
    else {
      if (!scanning[url]) scanning[url] = openInGoogleMaps(url).then(function (x) { if (x && x.routes && x.routes.length) A.KV.put('mapsopts', url, x); delete scanning[url]; return x; });
      g = await scanning[url];
    }
    dbg.mapsOptionsPage = g && { href: g.href, title: g.title, error: g.error, routes: (g.routes || []).map(function (x) { return { via: x.via, miles: x.miles, minutes: x.minutes, pts: x.pts ? x.pts.length : 0 }; }) };
    if(g&&g.blocked)A.showSiteCheck('gmaps','Google Maps');
    LG.info('route', 'Google Maps route options', dbg.mapsOptionsPage);
    if (g && g.routes && g.routes.length){r.mapsRoutes = g.routes;r.websiteAvoid=JSON.stringify(avoid);}
    return r.mapsRoutes || null;
  }
  async function websiteRoutes(r,avoidOver){
    var options=await mapsOptions(r,avoidOver),out=[];
    (options||[]).forEach(function(m,optionIndex){
      if(!Number.isFinite(m.miles)||m.miles<=0||!Number.isFinite(m.minutes)||m.minutes<=0||!Array.isArray(m.pts)||m.pts.length<6)return;
      var pts=m.pts.filter(function(p){return Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=85&&Math.abs(p[1])<=180;}).map(function(p){return {lat:p[0],lng:p[1]};});
      var distance=0;for(var i=1;i<pts.length;i++)distance+=T.hav(pts[i-1],pts[i]);
      if(pts.length!==m.pts.length||distance/m.miles<0.8||distance/m.miles>1.2)return;
      if(r.stops.some(function(s,i){var expected=s.current?A.me():s;return expected&&expected.lat!=null&&T.hav(expected,i?pts[pts.length-1]:pts[0])>3;}))return;
      // its turn-by-turn steps (road names, each stretch's length and time), when Maps sent all of them
      var steps=Array.isArray(m.steps)?m.steps.filter(function(x){return Array.isArray(x)&&Number.isFinite(x[0])&&x[0]>=0&&Number.isFinite(x[1]);}).map(function(x){return {distanceMeters:x[0],staticDuration:Math.round(x[1])+'s',navigationInstruction:{instructions:String(x[2]||'')}};}):[];
      var legs=steps.length?[{distanceMeters:m.miles*1609.344,duration:Math.round(m.minutes*60)+'s',steps:steps}]:[];
      out.push({description:m.via||'Website route',distanceMeters:m.miles*1609.344,duration:Math.round(m.minutes*60)+'s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:legs,websiteApproximate:true,websiteSteps:steps.length>0,websiteOptionIndex:optionIndex,websiteTolls:typeof m.tolls==='boolean'?m.tolls:undefined});
    });
    if(!out.length)throw new Error('The Maps website did not provide usable route geometry. Retry, paste a full Google Maps directions link, or add the recommended API key in Settings.');
    var endpoints=T.decodePolyline(out[0].polyline.encodedPolyline);r.stops.forEach(function(s,i){if(s.lat==null){var p=i?endpoints[endpoints.length-1]:endpoints[0];s.lat=p.lat;s.lng=p.lng;}});
    return out;
  }
  /**
   * "Compare with and without tolls": with tolls allowed, each leg's options also come with tolls avoided, so the
   * toll-free roads join the alternatives (Hazards asks about them like any other) and the comparisons count each
   * option's tolls (tolls.js). With the key, Google estimates the amounts (TOLLS); without it, Maps only says a route
   * has tolls and you type the amount on Route. One more Maps page (or Routes call) per leg.
   */
  /** A whole trip option's tolls: its legs' (a joined multi-leg option keeps which option each leg is, _sel). */
  function tripTolls(raw) {
    if (!window.Tolls || !raw) return { has: null, cost: null };
    var parts = raw._sel && route && route.legs ? route.legs.map(function (l, i) { return l.alts[raw._sel[i]]; }) : [raw];
    return Tolls.ofTrip(parts, S.trip.tollAmounts);
  }
  /** Short toll text for a route tile ("no tolls", "$12.50 tolls", "tolls"), only when tolls are being compared or known. */
  function tollTag(a) {
    if (!window.Tolls) return ''; var t = tollsOf(a);
    if (!tollPair() && !t.has) return '';
    return t.has === false ? 'no tolls' : t.cost != null ? '$' + t.cost.toFixed(2) + ' tolls' : t.has ? 'tolls' : '';
  }
  /**
   * HERE toll prices (optional key in Settings → Connections), as few calls as possible: only options Maps or Google
   * say have tolls of no known amount (not ones you typed, toll-free ones or Google's own estimates), only while tolls
   * are compared, one request per distinct option (a leg's option, never per whole-trip combination), one at a time,
   * each answer kept 30 days in KV `tolls` (by the option, its ends and the vehicle) and on the saved route option;
   * a failure or a different route HERE found is kept too, so it is never asked again on its own. The monthly cap is
   * enforced natively (`fetchHere`).
   */
  var hereBusy = false, hereSeen = new WeakSet();
  function hereVehicle() {
    var t = (Garage.car() || {}).tires || {}, hooked = t.towMode ? (t.trailers || []).filter(function (x) { return x.hooked; }) : [];
    return { axles: 2, trailers: hooked.length, trailerAxles: hooked.reduce(function (n, x) { return n + Math.max(1, Math.min(3, +x.axles || 1)); }, 0) };
  }
  // tolls of no known amount, or an option nobody has said anything about (a route saved before tolls were checked:
  // HERE answers $0 for a toll-free road, so that's still one request, kept like any other)
  function hereWanted(a) { var t = tollsOf(a); return (t.has === true && t.cost == null || t.has === null) && !a.tollFree && !a.hereTolls && !hereSeen.has(a); }
  var hereSkip = null;
  async function hereTolls() {
    if (S.hereKey && window.Tolls && model && !tollPair()) {
      var why = (S.trip.avoid || {}).tolls ? 'avoiding tolls' : 'Compare with and without tolls (Route → Other routes) is off';
      if (hereSkip !== why) { hereSkip = why; LG.info('route', 'HERE toll prices not asked: ' + why); }
      return;
    }
    hereSkip = null;
    if (hereBusy || !S.hereKey || !tollPair() || !window.Tolls || !model) return;
    var todo = []; choiceLists().forEach(function (l) { l.forEach(function (a) { if (hereWanted(a) && todo.indexOf(a) < 0) todo.push(a); }); });
    if (!todo.length) return;
    hereBusy = true; var owner = route, veh = hereVehicle(), vk = veh.trailers + 't' + veh.trailerAxles, cached = 0, asked = 0;
    var end = window.Tasks ? Tasks.begin('here-tolls', { text: 'Getting toll prices from HERE' }) : function () { };
    try {
      for (var i = 0; i < todo.length && route === owner; i++) {
        var a = todo[i], pts = decoded(a), mi = (a.distanceMeters || 0) / 1609.344;
        hereSeen.add(a);
        if (pts.length < 2) continue;
        var key = 'v1|' + Tolls.sig(a) + '|' + [pts[0], pts[pts.length - 1]].map(function (p) { return p.lat.toFixed(3) + ',' + p.lng.toFixed(3); }).join('>') + '|' + vk;
        var o = A.KV.get('tolls', key, 30 * 24 * 3600e3);
        if (o) { a.hereTolls = o.v; cached++; continue; }
        asked++;
        var res = await call('fetchHere', S.hereKey, Tolls.hereQuery(pts, veh), S.hereMonthlyCap == null ? 2000 : Math.max(0, parseInt(S.hereMonthlyCap, 10) || 0));
        if (window.__apiCount) window.__apiCount();
        if (res.code === 'here_cap') { LG.warn('route', res.error); toastMsg(res.error); break; }
        var j = null; try { j = res.body ? JSON.parse(res.body) : null; } catch (e) { }
        if (res.error || !j) { a.hereTolls = { ok: false, why: res.error || 'unreadable', at: Date.now() }; LG.warn('route', 'HERE toll price failed', { via: a.description, error: res.error || 'unreadable', detail: j && (j.title || j.cause) }); continue; }
        a.hereTolls = Object.assign(Tolls.hereRead(j, mi), { at: Date.now() });
        A.KV.put('tolls', key, a.hereTolls);
      }
    } finally { hereBusy = false; end(); }
    LG.info('route', 'HERE toll prices', { options: todo.length, fromCache: cached, asked: asked, month: N.hereCallsThisMonth ? N.hereCallsThisMonth() : null,
      results: todo.map(function (a) { var h = a.hereTolls || {}; return { via: a.description, ok: !!h.ok, cost: h.cost, mi: h.mi && Math.round(h.mi), why: h.why }; }) });
    if (route !== owner) return;
    if ($('tTolls')) { var y = tpBody().scrollTop; renderInfo(); tpBody().scrollTop = y; }
    if (step === ST_HAZ) renderHz();
  }
  /**
   * Saved routes that were never compared with their toll-free ones (saved before 0.0.190, or with the switch off):
   * fetched now, once, while tolls are compared. New options are only appended, so a pick made meanwhile stays.
   */
  async function tollFreeForSaved() {
    var r = route; if (!r || !tollPair() || !window.Tolls) return false;
    var multi = !!(r.legs && r.legs.length && multiLeg(r)), lists = multi ? r.legs.map(function (L) { return L.alts; }) : [alts];
    if (tollFreeChecked([].concat.apply([], lists))) return false;
    LG.info('route', 'Saved routes were never compared with toll-free ones: getting those', { legs: lists.length });
    if (multi) {
      for (var i = 0; i < r.legs.length && route === r; i++) {
        var sub = { stops: [r.stops[i], r.stops[i + 1]], avoid: r.avoid };
        r.legs[i].alts = await withTollFree(sub, r.legs[i].alts, S.apiKey ? plainBody(legBody(sub.stops[0], sub.stops[1])) : null);
      }
      if (route !== r) return false;
      rebuildAlts(); rawRoute = alts[0];
    } else {
      var lb = plainBody(legBody(r.stops[0], r.stops[r.stops.length - 1]));
      lb.intermediates = r.stops.slice(1, -1).map(wp); if (lb.intermediates.length) delete lb.computeAlternativeRoutes;
      var got = await withTollFree(r, alts, S.apiKey ? lb : null);
      if (route !== r) return false;
      alts = got; rawRoute = alts[altSel];
    }
    return true;
  }
  /** Whether a list of options was compared with its toll-free routes (saved with the trip). */
  function tollFreeChecked(list) { return (list || []).some(function (a) { return a.tollFreeAsked; }); }
  function plainBody(b) { b = Object.assign({}, b); delete b.extraComputations; return b; }
  function tollPair() { return !!S.trip.tollCompare && !(S.trip.avoid || {}).tolls; }
  function tollsOf(a) { return window.Tolls ? Tolls.ofRoute(a, S.trip.tollAmounts) : { has: null, cost: null }; }
  async function withTollFree(r, list, body) {
    if (body && body.extraComputations) list.forEach(function (a) { a.tollsAsked = true; });
    if (!tollPair() || !window.Tolls || !list.length) return list;
    var free = [];
    try {
      if (!S.apiKey) free = await websiteRoutes({ stops: r.stops }, Object.assign({}, S.trip.avoid, { tolls: true }));
      else if (body) {
        var b2 = Object.assign({}, body, { routeModifiers: Object.assign({}, body.routeModifiers, { avoidTolls: true }) }); delete b2.extraComputations;
        var res = await routesCall(b2);
        if (res.error) throw new Error(res.error);
        free = JSON.parse(res.body).routes || [];
      }
    } catch (e) { LG.warn('route', 'Toll-free routes not found', { error: e.message || String(e) }); return list; }
    var out = Tolls.addTollFree(list, free, function (a, b) { return overlap(a, b); });
    out.forEach(function (a) { a.tollFreeAsked = true; });
    LG.info('route', 'Toll and toll-free routes', out.map(function (a) { var t = tollsOf(a); return { via: a.description, tolls: t.has, cost: t.cost, src: t.src }; }));
    return out;
  }
  /** A route's points, decoded once (long trips have 100,000+). */
  function decoded(a) {
    if (!a._pts) try { Object.defineProperty(a, '_pts', { value: T.decodePolyline(a.polyline.encodedPolyline), enumerable: false }); } catch (e) { a._pts = T.decodePolyline(a.polyline.encodedPolyline); }
    return a._pts;
  }
  /** Share of Maps' turn points that lie within 1.5 miles of a Routes API route (1 = the same route). */
  function onRoute(a, pts) {
    var pa = decoded(a), step = Math.max(1, Math.floor(pa.length / 1500)), near = 0;
    pts.forEach(function (p) {
      var q = { lat: p[0], lng: p[1] };
      for (var k = 0; k < pa.length; k += step) if (T.hav(q, pa[k]) < 1.5) { near++; break; }
    });
    return pts.length ? near / pts.length : 0;
  }
  async function allMapsRoutes(r, body, cx) {
    cx = cx || { get alts() { return alts; }, set alts(v) { alts = v; } };
    var mr = await mapsOptions(r);
    if (!mr || !mr.length) return;
    var same = function (a, m) { return m.pts && m.pts.length > 5 ? onRoute(a, m.pts) >= 0.9 : sameAsMaps(a, m); };
    var missing = mr.filter(function (m) { return !cx.alts.some(function (a) { return same(a, m); }); });
    dbg.mapsMissing = missing.map(function (m) { return m.via; });
    if (missing.length) {
      LG.info('route', 'Google Maps shows ' + mr.length + ' routes; the Routes API returned ' + cx.alts.length + '. Rebuilding: ' + missing.map(function (m) { return m.via; }).join(' / '));
      prog(0.8, 'Getting the other Google Maps routes');
      var found = await Promise.all(missing.map(async function (m) {
        if (m.pts && m.pts.length > 5) {
          // pass through 8 of Maps' own turn points, spread along the route -> Google returns that same route
          var pts = m.pts.slice(2, -2), via = [];
          for (var k = 1; k <= 8; k++) { var p = pts[Math.round(k * (pts.length - 1) / 9)]; if (p) via.push({ via: true, location: { latLng: { latitude: p[0], longitude: p[1] } } }); }
          var b2 = Object.assign({}, body, { intermediates: via }); delete b2.computeAlternativeRoutes;
          var res = await routesCall(b2);
          var cand = !res.error && (JSON.parse(res.body).routes || [])[0];
          var ok = cand && onRoute(cand, m.pts) >= 0.85 && (!m.miles || Math.abs(altMiles(cand) - m.miles) / m.miles <= 0.04);
          LG.debug('route', 'Rebuilt via ' + m.via, { ok: !!ok, error: res.error, miles: cand && Math.round(altMiles(cand)), mapsMiles: m.miles, onRoute: cand && Math.round(onRoute(cand, m.pts) * 100) / 100 });
          if (ok) return { m: m, a: cand };
        }
        var c2 = await searchVia(m, body, cx);
        return c2 ? { m: m, a: c2 } : null;
      }));
      found.forEach(function (f) { if (f) { f.a.description = f.m.via.replace(/^via\s+/i, ''); f.a.fromMaps = true; cx.alts.push(f.a); } });
      LG.info('route', 'Rebuilt ' + found.filter(Boolean).length + ' of ' + missing.length + ' missing Google Maps route(s)');
    }
    orderLikeMaps(mr, same, cx);
  }
  /** Fallback when Maps' turn points aren't available: nudge a pass-through point to either side of the main route. */
  async function searchVia(m, body, cx) {
    var base = T.buildRoute(cx.alts[0], carModel()), L = base.totalMi, tries = 0, found = null;
    var plan = [[0.5, 60], [0.5, -60], [0.5, 130], [0.5, -130], [0.35, 90], [0.35, -90], [0.65, 90], [0.65, -90], [0.5, 220], [0.5, -220]];
    for (var t = 0; t < plan.length && !found; t++) {
      var f = plan[t][0], off = plan[t][1], d = f * L;
      var p = base.pointAt(d), a = base.pointAt(Math.max(0, d - 15)), b = base.pointAt(Math.min(L, d + 15));
      var dx = (b.lng - a.lng) * Math.cos(p.lat * Math.PI / 180), dy = b.lat - a.lat, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      var via = { latitude: p.lat + ny * off / 69, longitude: p.lng + nx * off / (69 * Math.cos(p.lat * Math.PI / 180)) };
      var b2 = Object.assign({}, body, { intermediates: [{ via: true, location: { latLng: via } }] });
      delete b2.computeAlternativeRoutes;
      tries++;
      var res = await routesCall(b2);
      if (res.error) { LG.warn('route', 'Pass-through route failed', res.error); continue; }
      var cand = (JSON.parse(res.body).routes || [])[0];
      if (!cand) continue;
      var dup = cx.alts.some(function (x) { return overlap(x, cand) > 0.9; });
      LG.debug('route', 'Pass-through try ' + tries, { miles: Math.round(altMiles(cand)), dup: dup, target: m.via });
      if (!dup && sameAsMaps(cand, m)) found = cand;
    }
    dbg.passThroughLookups = (dbg.passThroughLookups || 0) + tries;
    return found;
  }
  /** Routes API call, saved for a day (same request -> same route). */
  async function routesCall(body) {
    if(!S.apiKey)return {error:'API routing needs the optional Google key.',code:'no_key'};
    var key = JSON.stringify(body), o = !freshRoutes && A.KV.get('routes2', key, 24 * 3600e3);
    if (o) return o.v;
    var cap=Number(S.routesMonthlyCap)||0,used=N.routeCallsThisMonth?N.routeCallsThisMonth():0;
    if(cap>0&&used>=cap)return {error:'Monthly Routes API cap reached ('+used+'/'+cap+'). Saved routes still work.',code:'route_cap'};
    var res = await call('computeRoute', S.apiKey, key, cap);
    if (!res.error) A.KV.put('routes2', key, res);
    return res;
  }
  /** Put the options in the same order as Google Maps (so “route option 2” means the same thing). */
  function orderLikeMaps(mr, same, cx) {
    same = same || sameAsMaps;
    var left = cx.alts.slice(), out = [];
    mr.forEach(function (m) {
      var k = -1; left.forEach(function (a, i) { if (k < 0 && same(a, m)) k = i; });
      if (k >= 0) { var a = left.splice(k, 1)[0]; a.description = m.via.replace(/^via\s+/i, ''); out.push(a); }   // name it the way Maps does
    });
    cx.alts = out.concat(left);
  }
  function official(k) { return (k === 'walmart' || k === 'murphy') && A.siteOn(k); }
  function googleBrands() {
    return Object.keys(P.BRANDS).filter(function (k) { return S.brands[k] && !official(k); });
  }
  function renderInfo(keepMaps) {
    routeGate();
    var el = $('tRouteInfo'); if (!el) return;
    if (!model) { el.innerHTML = ''; alts = []; return; }
    el.innerHTML = tollsHtml();   // the routes, their weather and the lookup notes are on Hazards and Adjustments
    bindTolls(); hereTolls();
  }
  /** Route: each option's tolls, when you compare with and without them (or any route has tolls): Google's estimate,
   *  or a box for the amount (Google Maps' website doesn't give one). Saved by the route, in S.trip.tollAmounts. */
  function tollsHtml() {
    if (!model || !window.Tolls) return '';
    var lists = choiceLists(), rows = '';
    var any = lists.some(function (l) { return l.some(function (a) { return tollsOf(a).has; }); });
    if (!tollPair() && !any) return '';
    lists.forEach(function (list, i) {
      if (lists.length > 1) rows += '<div class="sub-h">Leg ' + (i + 1) + ' · ' + esc(legName(route, i)) + '</div>';
      list.forEach(function (a) {
        var t = tollsOf(a), sg = Tolls.sig(a), mine = (S.trip.tollAmounts || {})[sg];
        rows += '<div class="field toll-row"><div class="lbl">via ' + esc(a.description || 'route') + '<small class="keep">' + esc(Tolls.text(t) || 'Tolls not known') + (t.src === 'google' && t.cost != null ? ' (Google\'s estimate)' : t.src === 'here' ? ' (HERE\'s price' + (hereVehicle().trailers ? ', with your trailer' : '') + ')' : a.hereTolls && !a.hereTolls.ok ? ' · HERE couldn\'t price it' + (a.hereTolls.why === 'different route' ? ' (it found another road)' : '') : S.hereKey && tollPair() && t.has && t.cost == null && !a.hereTolls ? ' · asking HERE…' : '') + '</small></div>' +
          (t.has === false && t.src !== 'you' ? '' : '<input type="number" inputmode="decimal" min="0" step="0.01" class="toll-in" data-toll="' + esc(sg) + '" aria-label="Tolls on this route ($)" placeholder="' + (t.cost != null ? t.cost.toFixed(2) : '$') + '" value="' + (Number.isFinite(mine) ? mine : '') + '">') + '</div>';
      });
    });
    var hereUsed = lists.some(function (l) { return l.some(function (a) { return tollsOf(a).src === 'here'; }); });
    if (hereUsed) rows += '<div class="lead small keep here-attr">Toll prices © HERE</div>';
    return '<div class="card" id="tTolls"><h3>Tolls</h3><p class="lead small keep">Counted in the route comparisons. Type an amount to use your own (a toll pass, or no price found); leave it blank for the one shown.</p>' + rows + '</div>';
  }
  function bindTolls() {
    document.querySelectorAll('#tTolls .toll-in').forEach(function (inp) {
      inp.onchange = function () {
        var v = parseFloat(inp.value), all = S.trip.tollAmounts = Object.assign({}, S.trip.tollAmounts), was = all[inp.dataset.toll];
        if (Number.isFinite(v) && v >= 0) all[inp.dataset.toll] = Math.round(v * 100) / 100; else delete all[inp.dataset.toll];
        if (all[inp.dataset.toll] === was) return;
        A.save(); stopRecommendations(); recommendationBase = null;
        // redrawn a moment later: replacing the box from inside its own change (and the blur that follows) throws
        setTimeout(function () { if (!$('tTolls')) return; var y = tpBody().scrollTop; renderInfo(); tpBody().scrollTop = y; }, 0);
      };
    });
  }
  /** A tap on a route option: highlighted at once; its route (long ones take a moment) is read right after. */
  var picking = false;
  async function pickAlt(k) {
    if (k === altSel || picking || busy) return;
    routeReview=null;choiceComplete=false;choicePool=null;
    altSel = k; rawRoute = alts[altSel];
    document.querySelectorAll('#tRouteInfo [data-alt]').forEach(function (b) { b.classList.toggle('on', +b.dataset.alt === k); });
    var rm = rmaps.tRmap, ld = rm && rm._setSel ? (rm._setSel(k), A.loader(rm.getContainer(), 'Loading this route')) : null;
    picking = true;
    await paint();
    try { model = T.buildRoute(rawRoute, carModel()); ensureLimits(model); result = null; } finally { picking = false; if (ld) ld.done(); }
    rememberSel();
    renderInfo(true);
  }
  /** A saved trip keeps the route(s) you picked last, so reopening it comes back to them. */
  function rememberSel() {
    try {
      if (!route) return;
      var id = histId(route), o = A.KV.get('trips', 'trip|' + id); if (!o || !o.v || !o.v.alts) return;
      var v = o.v; v.savedT = v.savedT || o.t;
      if (route.legs && v.route && v.route.legs) v.route.legs = route.legs.map(function (L) { return { alts: L.alts, sel: L.sel }; });
      if (alts.length === v.alts.length) { v.altSel = altSel; v.altSure = altSure; }
      if (route.legs) v.alts = alts;
      A.KV.put('trips', 'trip|' + id, v);
    } catch (e) { LG.warn('history', 'Couldn\'t remember the route pick', String(e)); }
  }
  // ---------- route options on a small map (like Google Maps) ----------
  var rmaps = {};        // one small map per element (a trip with stops in between has one per leg)
  var ROUTE_GRAY = '#8a94a6';
  /** lines: [{pts: [[lat,lng],...], time, miles, via}]; sel: index; onPick(k). */
  function optionsMap(el, lines, sel, onPick) {
    var mid0 = el && el.id || '';
    Object.keys(rmaps).forEach(function (k) {
      var m0 = rmaps[k];
      if (k === mid0 || !document.body.contains(m0.getContainer())) { try { m0.remove(); } catch (e) { } delete rmaps[k]; }
    });
    if (!el || !lines.length) return;
    var rmap = rmaps[mid0] = L.map(el, { zoomControl: false, attributionControl: true, tap: false, scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'osm-tiles', attribution: '© OpenStreetMap' }).addTo(rmap);
    var all = [], tips = [], segs = {}, order = lines.map(function (_, k) { return k; }).filter(function (k) { return k !== sel; }).concat([sel]);   // chosen one drawn on top
    rmap._onPick = onPick;
    order.forEach(function (k) {
      var ln = lines[k]; if (!ln || !ln.pts || ln.pts.length < 2) return;
      var on = k === sel;
      var halo = L.polyline(ln.pts, { color: '#ffffff', weight: on ? 9 : 7, opacity: 0.95, interactive: false }).addTo(rmap);
      var line = L.polyline(ln.pts, { color: on ? '#1a73e8' : ROUTE_GRAY, weight: on ? 6 : 5, opacity: 1 }).addTo(rmap);
      var hit = L.polyline(ln.pts, { color: '#000', weight: 22, opacity: 0.001 }).addTo(rmap).on('click', function () { rmap._onPick(k); });   // easier to tap
      line.on('click', function () { rmap._onPick(k); });
      segs[k] = { halo: halo, line: line, hit: hit };
      var cands = labelSpots(lines, k), mid = cands[0];
      tips.push({ k: k, cands: cands, tip: null, color: on ? '#1a73e8' : ROUTE_GRAY });
      var tip = tips[tips.length - 1].tip = L.tooltip({ permanent: true, direction: 'top', offset: [0, -9], className: 'rlabel' + (on ? ' on' : ''), interactive: true })
        .setLatLng(mid).setContent('<div class="rl" data-opt="' + k + '"><b>' + esc(ln.time) + '</b><span>' + esc(ln.miles) + '</span></div>').addTo(rmap);
      all = all.concat(ln.pts);
    });
    rmap._nLines = lines.length;
    /** Highlight another option in place (no redraw): blue and on top, the rest gray. */
    rmap._setSel = function (k2) {
      sel = k2;
      Object.keys(segs).forEach(function (k) {
        var on = +k === sel, sg = segs[k];
        MapVisuals.style(sg.halo,{ weight: on ? 9 : 7 }); MapVisuals.style(sg.line,{ color: on ? '#1a73e8' : ROUTE_GRAY, weight: on ? 6 : 5 });
      });
      if (segs[sel]) { segs[sel].halo.bringToFront(); segs[sel].line.bringToFront(); }
      Object.keys(segs).forEach(function (k) { segs[k].hit.bringToFront(); });
      tips.forEach(function (t) { var e = t.tip.getElement(); if (e) e.classList.toggle('on', t.k === sel); t.color = t.k === sel ? '#1a73e8' : ROUTE_GRAY; });
      placeLabels(rmap, tips, sel, lines, null, { leaders: rmap._leaders, maxCands: 12, angles: 16, dists: [10, 24, 44, 70] });
    };
    rmap.attributionControl.setPrefix(false);
    // tapping a time/miles label picks that route too
    el.onclick = null; el.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-opt]'); if (t) { e.stopPropagation(); rmap._onPick(+t.dataset.opt); } }, true);
    var a = lines[0].pts[0], b = lines[0].pts[lines[0].pts.length - 1];
    var mk = function (p, t) { L.marker(p, { icon: L.divIcon({ className: 'pin', html: '<div class="tend">' + t + '</div>', iconSize: null }), interactive: false }).addTo(rmap); };
    mk(a, 'A'); mk(b, 'B');
    rmap.fitBounds(L.latLngBounds(all), { paddingTopLeft: [36, 58], paddingBottomRight: [36, 30] });
    rmap._leaders = L.layerGroup().addTo(rmap);
    setTimeout(function () { if (rmaps[mid0] === rmap) { rmap.invalidateSize(); rmap._refit(); placeLabels(rmap, tips, sel, lines, null, { leaders: rmap._leaders, maxCands: 12, angles: 16, dists: [10, 24, 44, 70] }); } }, 60);
    rmap.on('zoomend moveend', function () { placeLabels(rmap, tips, sel, lines, null, { leaders: rmap._leaders, maxCands: 12, angles: 16, dists: [10, 24, 44, 70] }); });
    var fb = document.createElement('button'); fb.className = 'fab-fit rmap-fit'; fb.type = 'button'; fb.setAttribute('aria-label', 'Show every route');
    fb.innerHTML = FIT_ICON + '<span>Route</span>'; fb.classList.add('hidden');
    // like the big map: the button shows once you move this map yourself, and goes away when it has re-centered
    var auto = false;
    rmap._refit = function () { auto = true; rmap.fitBounds(L.latLngBounds(all), { paddingTopLeft: [36, 58], paddingBottomRight: [36, 30] }); setTimeout(function () { auto = false; }, 400); fb.classList.add('hidden'); };
    rmap.on('dragstart', function () { fb.classList.remove('hidden'); });
    rmap.on('zoomstart', function () { if (!auto) fb.classList.remove('hidden'); });
    L.DomEvent.disableClickPropagation(fb);
    fb.onclick = function (e) { e.preventDefault(); e.stopPropagation(); rmap._refit(); };
    el.appendChild(fb);
    return rmap;
  }
  /** Candidate label spots on a route, best first: points far from the other routes (where it splits off), like Google Maps. */
  function labelSpots(lines, k) {
    var me = lines[k].pts, n = me.length, out = [], others = [];
    lines.forEach(function (ln, j) { if (j !== k && ln.pts) { var st = Math.max(1, Math.floor(ln.pts.length / 120)); for (var i = 0; i < ln.pts.length; i += st) others.push(ln.pts[i]); } });
    var st2 = Math.max(1, Math.floor(n / 60));
    for (var i = Math.floor(n * 0.12); i < n * 0.88; i += st2) {
      var p = me[i], d = Infinity;
      for (var o = 0; o < others.length; o++) { var dd = T.hav({ lat: p[0], lng: p[1] }, { lat: others[o][0], lng: others[o][1] }); if (dd < d) d = dd; }
      out.push({ p: p, d: d });
    }
    out.sort(function (a, b) { return b.d - a.d; });
    return out.length ? out.map(function (x) { return x.p; }) : [me[Math.floor(n / 2)]];
  }
  /**
   * Route labels as speech bubbles beside their route (like Google Maps): the tail points at the route, and each bubble
   * goes where it covers the least of any route line and no other bubble — so every option stays visible.
   */
  function placeLabels(m, tips, sel, lines, obst, extra) {
    var size = m.getSize(), o = (obst || []).slice();
    // keep labels out from under the Route button (top right) and the map credits
    var fbEl = m.getContainer().querySelector('.rmap-fit');
    if (fbEl && fbEl.offsetWidth) o.push({ x: size.x - fbEl.offsetWidth - 14, y: 0, w: fbEl.offsetWidth + 14, h: fbEl.offsetHeight + 12 });
    o = o.concat(Labels.rectsOf(m, [m.getContainer().querySelector('.leaflet-control-attribution')], 4));
    var list = tips.slice().sort(function (a, b) { return (b.k === sel) - (a.k === sel); });
    Labels.place(m, list, Object.assign({ lines: lines, obst: o, hide: !!obst }, extra || {}));
  }
  function thinAlt(a) {
    var pts = decoded(a), out = [], step = Math.max(1, Math.floor(pts.length / 1500));
    for (var i = 0; i < pts.length; i += step) out.push([pts[i].lat, pts[i].lng]);
    var l = pts[pts.length - 1]; out.push([l.lat, l.lng]);
    return out;
  }
  function toastMsg(m) { if (window.toast) window.toast(m); }
  /** A light tick for each step of the buffer and detour sliders (and the fuel gauge): the app's only haptics for now. */
  function tick() { if (N.tick) N.tick(); }

  // ---------- step 2: stations along the route ----------
  /**
   * Stations along one or more routes with your price at each — everything at once: Google's along-route lookups
   * (run in parallel natively), Murphy USA and Walmart's own sites (a few requests at a time), all started together.
   * Answers already found for the same stretch are reused (saved searches) unless force, or older than staleHours.
   * pg(frac 0..1, label). Returns { per: [{cands, notes, unpriced, stale, grade}] per model, cachedAgeMs }.
   */
  // ---------- which Exxon / Mobil stations take Walmart+ ----------
  // ExxonMobil's own station finder tags each participating station "Walmart+" (free; no Google lookups). Stations
  // are checked a half-degree square at a time (busy squares are split so nothing is cut off), and each square's
  // answer is saved for a week. A station it lists without the tag loses the Walmart+ discount; one it can't match
  // keeps it. CITGO has no such public list, so CITGO prices say the discount isn't confirmed.
  var XOM_CELL = 0.5, XOM_DAYS = 7;
  function xomUrl(b) {
    return 'https://www.exxon.com/en/api/locator/Locations?Latitude1=' + b[0].toFixed(3) + '&Latitude2=' + b[1].toFixed(3) +
      '&Longitude1=' + b[2].toFixed(3) + '&Longitude2=' + b[3].toFixed(3) + '&DataSource=RetailGasStations&Country=US&Customsort=False';
  }
  async function xomBox(b, depth) {
    var res = await call('fetchJson', xomUrl(b));
    if (res.error || !res.body) throw new Error(res.error || 'no answer');
    var j = JSON.parse(String(res.body).replace(/[\u0000-\u001f]/g, ' '));
    var list = (j.Locations || []).map(function (x) {
      var tags = (x.StoreAmenities || []).concat(x.FeaturedItems || []);
      return [+x.Latitude, +x.Longitude, tags.some(function (a) { return a && /walmart/i.test(a.Name || a.Title || ''); }) ? 1 : 0, String(x.DisplayName || x.LocationName || '').slice(0, 60)];
    });
    if (list.length >= 100 && depth < 3) {          // the finder caps its answer: split the square and ask again
      var mLat = (b[0] + b[1]) / 2, mLng = (b[2] + b[3]) / 2, out = [];
      var parts = await Promise.all([[b[0], mLat, b[2], mLng], [b[0], mLat, mLng, b[3]], [mLat, b[1], b[2], mLng], [mLat, b[1], mLng, b[3]]].map(function (q) { return xomBox(q, depth + 1); }));
      parts.forEach(function (p) { out = out.concat(p); });
      return out;
    }
    return list;
  }
  var xomPending = {};
  function xomCell(k) {
    var o = A.KV.get('xom', k, XOM_DAYS * 24 * 3600e3); if (o) return Promise.resolve(o.v);
    if (xomPending[k]) return xomPending[k];
    var ij = k.split(':').map(Number), m = 0.01;
    var b = [ij[0] * XOM_CELL - m, (ij[0] + 1) * XOM_CELL + m, ij[1] * XOM_CELL - m, (ij[1] + 1) * XOM_CELL + m];
    return (xomPending[k] = xomBox(b, 0).then(function (list) { A.KV.put('xom', k, list); delete xomPending[k]; return list; },
      function (e) { delete xomPending[k]; xomWarn(String(e)); return null; }));
  }
  // one line per failure kind a minute (a 403 on every square was 242 identical lines in a phone log)
  var xomLast = { e: '', t: 0, n: 0 };
  function xomWarn(e) {
    if (e === xomLast.e && Date.now() - xomLast.t < 60e3) { xomLast.n++; return; }
    LG.warn('stations', 'ExxonMobil station finder', xomLast.n ? { error: e, suppressedBefore: xomLast.n } : e);
    xomLast = { e: e, t: Date.now(), n: 0 };
  }
  /** Mark each Exxon / Mobil station: wplus true (listed with Walmart+), false (listed without), or unknown. -> how many changed. */
  async function xomCheck(list) {
    if (S.xomCheck === false || !list || !list.length) return 0;
    var cells = {};
    list.forEach(function (s) {
      if ((s.brand !== 'exxon' && s.brand !== 'mobil') || s.lat == null) return;
      var k = Math.floor(s.lat / XOM_CELL) + ':' + Math.floor(s.lng / XOM_CELL);
      (cells[k] = cells[k] || []).push(s);
    });
    var changed = 0, t0 = Date.now(), not = 0;
    await Promise.all(Object.keys(cells).map(async function (k) {
      var locs = await xomCell(k); if (!locs) return;
      cells[k].forEach(function (s) {
        var best = null, bd = 1e9;
        locs.forEach(function (l) { var d = P.haversineMi(s.lat, s.lng, l[0], l[1]); if (d < bd) { bd = d; best = l; } });
        var v = best && bd <= 0.2 ? !!best[2] : undefined;
        if (best && bd <= 0.2 && best[3]) s.altName = best[3];   // the station's own name in ExxonMobil's finder
        if (v === false) not++;
        if (s.wplus !== v) { s.wplus = v; changed++; }
      });
    }));
    if (Object.keys(cells).length) LG.info('stations', 'Walmart+ at Exxon/Mobil checked', { squares: Object.keys(cells).length, notInProgram: not, ms: Date.now() - t0 });
    return changed;
  }
  window.__xom = xomCheck;

  /** EV / fuel-cell car: chargers or hydrogen stations near each route (DOE station finder) instead of gas prices. */
  function serviceMin(p,kind) { return p.stops.reduce(function (a, s) { return a + T.serviceMinutes(s,kind); }, 0)+(p.destinationCharges||[]).reduce(function(n,c){return n+c.minutes;},0); }
  /** Charging networks to use (S.trip.evNetworksOff): the ones Gasket reads prices from first, the rest dimmed but choosable; each A–Z. */
  function netListHtml(){var off=S.trip.evNetworksOff||{},row=function(x){return '<label class="nf chk"><span>'+esc(x[1])+'</span><input type="checkbox" data-net="'+x[0]+'"'+(AltFuel.netEnabled(x[0],off)?' checked':'')+'></label>';};
    return '<div class="sub-h">Charging networks '+A.qBtn('Readable networks are enabled by default. Others are opt-in: a published government price note may be available even when the network website has none. Unknown prices are excluded unless enabled in Settings → Connections. Hotel and dealership charging may be complimentary, paid, or restricted to guests/customers; verify access.')+'</div><div id="tNetworks"><div class="lead small keep">Public website prices</div>'+AltFuel.NET_PRICED.map(row).join('')+'<div class="net-unpriced"><div class="lead small keep">No reliable website price reader yet</div>'+AltFuel.NET_OTHER.map(row).join('')+'</div><div class="net-hosted"><div class="lead small keep">Potentially complimentary · verify access & price</div>'+AltFuel.NET_HOSTED.map(row).join('')+'</div></div>';}
  /** When you get there: an EV starts on "a destination has a charger" until you pick (arriveSet); gas never has that choice. */
  function arriveNow(){var t=S.trip,a=t.arrive;if(KIND()==='ev'&&!t.arriveSet){t.arrive='destination';return 'destination';}return a==='full'||a==='destination'&&KIND()==='ev'?a:'buffer';}
  /** What's already in the tank / battery cost, typed per fuel kind (a gas price is never a $/kWh). */
  function tankPriceKey(){var k=KIND();return k==='gas'?'tankPrice':k+'TankPrice';}
  function startRate(p){var tp=parseFloat(S.trip[tankPriceKey()]);return tp>0?tp:KIND()==='ev'&&evRates&&evRates.all?evRates.all:p.refPrice;}
  var evRates=null;   // this route's published charger rates (ChargerData.routeRates), for unpriced chargers and the battery's energy
  function evGuess(dc,fallback){var r=evRates;if(r&&(dc?r.dc:r.ac))return {price:dc?r.dc:r.ac,label:'Typical published '+(dc?'fast-charging':'Level 2')+' rate on this route ('+(dc?r.nDc:r.nAc)+' chargers; estimate)'};if(r&&r.all)return {price:r.all,label:'Typical published charging rate on this route ('+(r.nDc+r.nAc)+' chargers; estimate)'};return {price:fallback,label:'Your charging-price estimate'};}
  // Raw discovery, not planner candidates: changing charge/buffer/network settings
  // must re-filter and re-project. Keep each leg so switching combinations reuses it.
  var altSearches=new Map(),altPricePasses=new Map();
  async function gatherAlt(models, pg, dbgS,replay,rawRoutes,force) {
    var kd = KIND(), c = Garage.car(), plugs = kd === 'ev' ? Garage.plugs(c) : null, corridor = kd === 'ev' ? Math.min(15,Math.max(2,(+S.trip.maxDetourMin||0)*25/60/2/1.3)) : 8;
    if(kd==='ev')plugs=AltFuel.compatiblePlugs(c,plugs);
    var price = kd === 'ev' ? (+S.evPrice || 0.48) : (+S.h2Price || 36), tv = 0;
    var notes = [], per = [], raw = [], skippedPrices=0,discoveryIncomplete=false,priceKeys=[],priceReused=[];
    dbgS.started = new Date().toISOString(); dbgS.kind = kd;
    for (var mi = 0; mi < models.length; mi++) {
      var list = [], m = models[mi];
      var priceKey=JSON.stringify([kd,T.encodePolyline(m.pts),c.id,c.make,c.plug,c.adapter,c.acAdapter,c.dcKw,c.acKw,plugs,S.trip.evChargers,S.trip.evNetworksOff,S.evUseDOE,S.evUseOCM,S.evRefreshPrices,S.nrelKey,S.ocmKey,S.evNetPrices,S.evPriceAgeHours]);
      priceKeys.push(priceKey);var priced=altPricePasses.get(priceKey),reusePrices=!replay&&force!==true&&force!=='discover'&&priced&&Date.now()-priced.at<10*60e3&&priced.corridor>=corridor;
      try {
        if(reusePrices){list=priced.rows.map(function(st){return Object.assign({},st);});notes=Array.from(new Set(notes.concat(priced.notes)));priceReused[mi]=true;LG.info('stations','Reusing completed charger price pass',{stations:list.length,ageSec:Math.round((Date.now()-priced.at)/1000)});}
        else if(replay&&replay.localOnly)list=(replay.google[mi]||{}).list||[];
        else {
          var rr=rawRoutes&&rawRoutes[mi],pieces=rr&&rr._sel&&legsMode()&&(m.legEnds||[]).length>1?rr._sel.map(function(k,i){return route.legs[i].alts[k];}):[rr];
          for(var ai=0;ai<pieces.length;ai++){
            var a=pieces[ai];if(a&&a._leg!=null&&legsMode())a=route.legs[a._leg].alts[a._sel[a._leg]];
            var cm=pieces.length>1?hzModel(a):m;
            var key=JSON.stringify([kd,a&&a.polyline&&a.polyline.encodedPolyline||cm.pts,plugs,S.trip.evChargers,S.evUseDOE,S.evUseOCM,S.evRefreshPrices,S.nrelKey,S.ocmKey]);
            var hit=altSearches.get(key),reuse=force!==true&&force!=='discover'&&hit&&Date.now()-hit.at<3600e3&&hit.corridor>=corridor;
            var rows=reuse?hit.rows:await AltFuel.alongRoute(cm,kd,plugs,corridor,function(f){pg((mi+(ai+f)/pieces.length)/models.length,kd==='ev'?'Finding compatible chargers':'Finding hydrogen stations');},S.trip.evChargers);
            if(!reuse&&!jobCancel){altSearches.delete(key);altSearches.set(key,{at:Date.now(),corridor:corridor,rows:rows});while(altSearches.size>64)altSearches.delete(altSearches.keys().next().value);}
            if(reuse)LG.info('stations','Reusing completed route discovery',{kind:kd,stations:rows.length,ageSec:Math.round((Date.now()-hit.at)/1000)});
            // Website enrichment (including owner-specific Tesla tariffs and FLO
            // connector details) belongs to this run, not the raw coverage cache.
            list=list.concat(rows.map(function(st){return Object.assign({},st);}));
          }
          list=Array.from(new Map(list.map(function(st){return [st.id,st];})).values());
        }
      }
      catch (e) { discoveryIncomplete=true;list=list.concat(e.stations||[]);if (notes.indexOf(e.message) < 0) notes.push(e.message); LG.warn('stations', e.message); }
      raw.push(list);
    }
    // chargers that publish no price get what this route's chargers do publish (median paid $/kWh, fast vs slower), else your estimate
    var kinds=raw.map(function(list){return list.map(function(st){return kd==='ev'&&AltFuel.netAllowed(st)?AltFuel.charging(st,c,S.trip.evChargers,plugs):null;});});   // unticked networks: never a stop
    // the networks' own published prices (Tesla, IONNA, Blink), once per station even when routes share it
    if(kd==='ev'&&window.EVPrices&&models.some(function(_,i){return !priceReused[i];})&&!(replay&&replay.skipNetworkPrices)){var seenNet={},items=[];raw.forEach(function(list,i){if(priceReused[i])return;list.forEach(function(st,j){var ch=kinds[i][j];if(ch&&!seenNet[st.id]){seenNet[st.id]=1;items.push({st:st,dc:ch.level==='dc_fast',kw:ch.kw});}});});
      try{var np=await EVPrices.annotate(items,c,function(f,left){pg(Math.min(.99,f),'Getting charger prices from the networks'+(left?' · '+left:''));});np.notes.forEach(function(n){if(notes.indexOf(n)<0)notes.push(n);});dbgS.netPrices=np.priced;var byId={};items.forEach(function(x){if(x.st.netPrice)byId[x.st.id]=x.st.netPrice;});raw.forEach(function(list){list.forEach(function(st){if(byId[st.id])st.netPrice=byId[st.id];});});}catch(e){LG.warn('stations','Charger network prices failed: '+e.message);}}
    if(kd==='ev'&&window.EVPrices&&models.some(function(_,i){return !priceReused[i];})&&!(replay&&replay.skipNetworkPrices)){var floUnits={};items.forEach(function(x){if(x.st.netPrice&&x.st.netPrice.src==='flo')floUnits[x.st.id]=x.st.units;});raw.forEach(function(list,i){list.forEach(function(st,j){if(floUnits[st.id]){st.units=floUnits[st.id];kinds[i][j]=AltFuel.charging(st,c,S.trip.evChargers,plugs);}});});}
    evRates=kd==='ev'&&window.ChargerData&&ChargerData.routeRates?ChargerData.routeRates([].concat.apply([],raw.map(function(list,i){return list.map(function(st,j){var ch=kinds[i][j];return ch?{st:st,kw:ch.kw,dc:ch.level==='dc_fast'}:null;}).filter(Boolean);}))):null;
    for (mi = 0; mi < models.length; mi++) {
      var list = raw[mi], m = models[mi];
      var cands = [];
      for (var si = 0; si < list.length; si++) {
        var st = list[si],charging=kinds[mi][si];if(kd==='ev'&&st.netPrice&&st.netPrice.src==='flo')charging=AltFuel.charging(st,c,S.trip.evChargers,plugs);if(kd==='ev'&&!charging)continue;
        var guess=kd==='ev'?evGuess(charging.level==='dc_fast',price):{price:price,label:'Your hydrogen-price estimate'};
        var tariff=kd==='ev'&&window.ChargerData?ChargerData.tariff(st,guess.price,charging.kw):{price:price,estimated:true,label:'Your hydrogen-price estimate',updated:null};
        if(kd==='ev'&&!tariff.known&&S.evAllowUnknownPrices!==true){skippedPrices++;continue;}
        if(tariff.estimated&&tariff.price===guess.price&&tariff.label==='Your charging-price estimate')tariff.label=guess.label;
        var prs = T.projectLegs(m, { lat: st.lat, lng: st.lng }, corridor);
        for (var pi = 0; pi < prs.length; pi++) {
          var pr = prs[pi], det = 2 * pr.offset * 1.3 + (pr.offset > 0.15 ? 0.2 : 0), kw = charging?charging.kw:0;
          cands.push({ id: pr.leg ? st.id + '@' + pr.leg : st.id, d: pr.along, offset: pr.offset, detourMi: det, detourMin: det < 0.15 ? 0 : det / 25 * 60 + 1, detourExact: false,
            price: tariff.price, priceKnown:tariff.known===true, freeCharging:kd==='ev'&&tariff.known&&tariff.price===0,kw: kw, stationKw:charging&&charging.stationKw,chargeLevel:charging&&charging.level,powerShare:st.powerShare,billingBasis:st.billingBasis,timeCost: kw ? tv / kw : 0, station: st, lat: st.lat, lng: st.lng, leg: pr.leg,
            calc: { base: tariff.price, final: tariff.price, est: tariff.estimated, stale: kd==='ev'&&(!tariff.updated||Date.parse(tariff.updated)>Date.now()||Date.now()-Date.parse(tariff.updated)>(+S.evPriceAgeHours||24)*3600e3), updated: tariff.updated?Date.parse(tariff.updated)||null:null, notes: [],
              steps: [{ label: tariff.label, kind: 'base', amount: tariff.price }] } });
        }
      }
      // A faster charger nearby may exceed the detour limit or be just out of reach.
      // Keep compatible alternatives instead of discarding slower, reachable stops in 3-mile bins.
      per.push({ cands: cands, notes: notes, unpriced: 0, stale: 0, grade: Garage.grade(), unpricedCands: [],incomplete:discoveryIncomplete });
    }
    if (kd === 'ev') {if(skippedPrices)notes.push('Chargers without published prices were excluded. To include estimated costs, enable them in Settings → Connections.');notes.push('Recent published prices are preferred; older or undated rates may be needed. Rates are not live: confirm prices, access and available stalls with the network.');var fd=!S.trip.departNow&&futureDepart();if(fd&&fd.getTime()>Date.now())notes.push('Leaving '+fd.toLocaleString()+' — prices may change by then.');}
    if(kd==='ev'&&!discoveryIncomplete&&!jobCancel)raw.forEach(function(list,i){if(priceReused[i])return;altPricePasses.delete(priceKeys[i]);altPricePasses.set(priceKeys[i],{at:Date.now(),corridor:corridor,rows:list.map(function(st){return Object.assign({},st);}),notes:notes.slice()});while(altPricePasses.size>64)altPricePasses.delete(altPricePasses.keys().next().value);});
    dbgS.stations = raw.map(function (l) { return l.length; });
    pg(1, 'Choosing stops');
    return { per: per, cachedAgeMs: 0, raw: { official: [], google: raw, kind: kd } };
  }
  async function gatherAll(models, pg, dbgS, force, replay, ks,areaPlan) {
    if (KIND() !== 'gas') return gatherAlt(models, pg, dbgS,replay,(ks||[]).map(function(k){return alts[k];}),force);
    if(!(replay&&replay.localOnly)&&S.xomCheck!==false)scanPending('discounts','Checking station discount eligibility',15);
    var KV = A.KV, notes = [], official = [], siteOk = [], perModel = models.map(function () { return []; }), guessed = [];
    var webDiscovery=force==='discover'||force==='discover-cache'||force!==true&&(!S.apiKey||S.keylessRegular);
    if (replay) {
      // a saved trip: the stations (with their prices) it found then — no lookups at all
      official = window.PriceHistoryRecovery?PriceHistoryRecovery(replay.official||[]):(replay.official || []).slice();
      perModel = (ks || []).map(function (k, mi) {
        var sg = altSig(alts[k]), hit = (replay.google || []).filter(function (g) { return g.sig ? g.sig === sg : g.k === k; })[0];
        if (hit) return window.PriceHistoryRecovery?PriceHistoryRecovery(hit.list):hit.list.slice();
        if (!replay.localOnly) guessed[mi] = true;   // never searched (while your route was): the comparison asks before trusting it
        // a route it didn't check then: every station it found, with Google's exact detours dropped (they were for another route)
        var all = []; (replay.google || []).forEach(function (g) { g.list.forEach(function (st) { var c = Object.assign({}, st); delete c.detourExact; delete c.detourMi; all.push(c); }); });
        return all;
      }).map(function (list) { return P.mergeSites(P.reconcileStations(list)); });   // trips saved before 0.0.188 listed shared stations twice
      while (perModel.length < models.length) perModel.push([]);
      if (guessed[0]) guessed = [];   // your own route has no list of its own either: an older save, not one route missing
    }
    var maxAge = force===true || force==='discover' || S.alwaysRefresh ? 0 : (Number(S.staleHours) || 24) * 3600e3, oldest = 0, saved = 0;
    var use = function (o) { if (!o) return null; oldest = Math.max(oldest, Date.now() - o.t); saved++; return o.v; };
    var getKV = function (ns, key, age) { return age ? KV.get(ns, key, age) : null; };
    var part = { google: 0, murphy: 0, walmart: 0 }, weight = { google: 0, murphy: 0, walmart: 0 }, label = 'Finding stations';
    var tick = function () {
      var tw = weight.google + weight.murphy + weight.walmart;
      pg(tw ? (part.google * weight.google + part.murphy * weight.murphy + part.walmart * weight.walmart) / tw : 1, label);
    };
    var dbgSearch = dbgS; dbgSearch.started = new Date().toISOString();
    var maxOff = 3;
    var nearAny = function (lat, lng) { return models.some(function (m) { return T.project(m, { lat: lat, lng: lng }).offset <= maxOff; }); };
    var ptsUnion = function (gap) {
      var seen = {}, out = [];
      models.forEach(function (m) { T.samplePoints(m, gap).forEach(function (p) { var k = p.lat.toFixed(2) + ',' + p.lng.toFixed(2); if (!seen[k]) { seen[k] = 1; out.push(p); } }); });
      return out;
    };
    if (!replay) try {
      // --- Google, along each route ---
      var jobs = [], skippedBack = 0;
      if (S.apiKey&&!webDiscovery) {
        var gb = googleBrands();
        models.forEach(function (m, mi) {
          T.chunks(m, 125).forEach(function (ch, ci) {
            if (T.coveredBefore(m, ch)) { skippedBack++; return; }   // the way back on roads already searched on the way out
            gb.forEach(function (b) { jobs.push({ q: P.BRANDS[b].query, polyline: ch.polyline, lat: ch.start.lat, lng: ch.start.lng, chunk: ci, fromMi: ch.fromMi, toMi: ch.toMi, m: mi }); });
          });
        });
      }
      var todo = [], done = [];
      jobs.forEach(function (j, i) {
        var o = getKV('along', j.q + '|' + j.polyline, maxAge);
        if (o) done.push({ job: i, results: use(o),at:o.t }); else todo.push(i);
      });
      var takeGoogle = function (job, r, observedAt) {
        var observations=[];
        (r.places || []).forEach(function (pl, k) {
          var st = P.normalize(pl);if(st&&window.PriceHistory){PriceHistory.stamp(st,observedAt);observations.push(st);} if (!st || !S.brands[st.brand]) return;
          var sum = r.routingSummaries && r.routingSummaries[k];
          if (sum && sum.legs && sum.legs.length >= 2 && job.toMi != null) {
            // Google's road distance through the station minus the route's own distance for that piece = the detour.
            // (Travel times come from two different Google services, so minutes are derived from miles instead.)
            var mi = (sum.legs[0].distanceMeters + sum.legs[1].distanceMeters) / 1609.344 - (job.toMi - job.fromMi);
            if (mi > -0.5 && mi < 30) { st.detourMi = Math.max(0, mi); st.detourExact = true; st.detourRange = [job.fromMi, job.toMi]; }
          }
          perModel[job.m].push(st);
        });
        if(window.PriceHistory)PriceHistory.observe(observations);
      };
      done.forEach(function (d) { d.results.forEach(function (r) { takeGoogle(jobs[d.job], r,d.at); }); });
      var tasks = [];
      if(webDiscovery){
        weight.google=1;
        tasks.push(KeylessGas.discover(areaPlan||KeylessGas.discoveryAreas(models,T,P),function(f,text){part.google=f;label=text;tick();},gradeOf(),force==='discover').then(function(r){
          dbgS.keyless={areas:r.areas,completed:r.completedAreas,stations:r.stations.length,websiteLoads:r.websiteLoads,cancelled:r.cancelled,blocked:r.blocked,apiCalls:0};
          r.stations.forEach(function(s){if(!S.brands[s.brand])return;models.forEach(function(m,i){if(T.project(m,s).offset<=3)perModel[i].push(s);});});
          notes=notes.concat(r.errors||[]);if(r.cancelled)notes.push('Website discovery cancelled; completed stations kept.');
          var incomplete=r.details.filter(function(d){return !d.exhausted;}).length;
          if(incomplete)notes.push('Website discovery stopped before the list ended in '+incomplete+' areas; coverage is partial.');
          if(r.blocked)A.showSiteCheck(r.blockedSite||'gasweb',r.blockedSite==='walmart'?'Walmart':r.blockedSite==='murphy'?'Murphy USA':'Google Maps web');
          part.google=1;tick();
        }));
        if(priceCancelRequested)KeylessGas.cancel();
      }
      if (todo.length) weight.google = 0.55;
      if (!webDiscovery&&A.siteOn('murphy')) weight.murphy = 0.15;
      if (!webDiscovery&&A.siteOn('walmart')) weight.walmart = 0.3;
      dbgSearch.googleLookups = todo.length; dbgSearch.googleSaved = done.length; dbgSearch.skippedWayBack = skippedBack;
      if (skippedBack) LG.info('stations', skippedBack + ' search piece(s) on the way back skipped — same roads as the way out');
      LG.info('stations', 'Searching along ' + models.length + ' route(s)', { googleLookups: todo.length, saved: done.length, walmart: A.siteOn('walmart'), murphy: A.siteOn('murphy'), force: !maxAge });
      if (todo.length) {
        var send = todo.map(function (i) { return jobs[i]; });
        tasks.push(callP(function (d, t) { part.google = t ? d / t : 0; tick(); }, 'routeSearch', S.apiKey, JSON.stringify(send), Number(S.monthlyCap) || 0).then(function (res) {
          part.google = 1; tick();
          dbgSearch.google = { results: (res.results || []).length, errors: res.errors, places: (res.results || []).reduce(function (a, x) { return a + (x.places || []).length; }, 0) };
          LG.info('stations', 'Google along-route search done', dbgSearch.google);
          (res.errors || []).forEach(function (e) { notes.push(e); LG.warn('stations', e); });
          var byJob = {};
          (res.results || []).forEach(function (r) { (byJob[r.job] = byJob[r.job] || []).push(r); });
          var failed = (res.errors || []).join(' | ');
          send.forEach(function (job, k) {
            var list = byJob[k] || [];
            list.forEach(function (r) { takeGoogle(job, r,Date.now()); });
            // save every finished lookup, empty ones too (nothing there is an answer); skip ones that errored
            if (list.length || failed.indexOf(job.q + ':') < 0 && !/cap reached/i.test(failed))
              KV.put('along', job.q + '|' + job.polyline, list.map(function (r) { return { places: r.places, routingSummaries: r.routingSummaries }; }));
          });
        }));
      }
      // --- Murphy USA (their store finder), one pass for all routes ---
      if (!webDiscovery&&A.siteOn('murphy')) {
        var mpts = ptsUnion(50), mkey = mpts.map(function (p) { return p.lat.toFixed(2) + ',' + p.lng.toFixed(2); }).join(';');
        var mo = getKV('murphy', mkey, maxAge);
        var takeMurphy = function (stores,at) { (stores || []).forEach(function (m) { var s = P.normalizeMurphy(m); if (s){if(window.PriceHistory)PriceHistory.stamp(s,at);official.push(s);} }); };
        if (mo) { takeMurphy(use(mo),mo.t); part.murphy = 1; }
        else tasks.push(site('murphy', { points: mpts, radiusMi: 30, max: 25 }, 120000, function (d, t) { part.murphy = t ? d / t : 0; tick(); }).then(function (res) {
          part.murphy = 1; tick();
          dbgSearch.murphy = { stores: (res.stores || []).length, error: res.error, blocked: res.blocked };
          LG.info('stations', 'Murphy USA done', dbgSearch.murphy);
          if (res.error) notes.push('Murphy USA: ' + (res.blocked ? 'wants an “are you human?” check (Settings → Site checks)' : res.error));
          else { KV.put('murphy', mkey, res.stores || []); siteOk.push('Murphy USA'); }
          takeMurphy(res.stores,Date.now());
        }));
      }
      // --- Walmart: which stores have fuel (kept a month), then today's prices for the ones near a route ---
      if (!webDiscovery&&A.siteOn('walmart')) tasks.push((async function () {
        var wpts = ptsUnion(40), wkey = wpts.map(function (p) { return p.lat.toFixed(2) + ',' + p.lng.toFixed(2); }).join(';');
        var no = KV.get('wmnodes', wkey, 30 * 24 * 3600e3), nodes;
        if (no) nodes = no.v;
        else {
          var res = await site('walmart', { mode: 'nodes', points: wpts, radiusMi: 25 }, 120000, function (d, t) { part.walmart = t ? 0.4 * d / t : 0; tick(); });
          dbgSearch.walmartNodes = { nodes: (res.nodes || []).length, error: res.error, blocked: res.blocked };
          LG.info('stations', 'Walmart stores along the route', dbgSearch.walmartNodes);
          if (res.error || res.blocked) { part.walmart = 1; tick(); notes.push('Walmart: ' + (res.blocked ? 'wants a “Robot or human?” check (Settings → Site checks)' : res.error)); return; }
          nodes = res.nodes || [];
          KV.put('wmnodes', wkey, nodes);
        }
        part.walmart = 0.4; tick();
        var near = nodes.filter(function (n) { return n.geoPoint && nearAny(n.geoPoint.latitude, n.geoPoint.longitude); });
        var ask = [];
        near.forEach(function (n) { var o = getKV('wmprice', String(n.id), maxAge); if (o) { var w = P.normalizeWalmart(use(o)); if (w){if(window.PriceHistory)PriceHistory.stamp(w,o.t);official.push(w);} } else ask.push(n); });
        if (!ask.length) { part.walmart = 1; tick(); return; }
        label = 'Reading Walmart prices';
        var pr = await site('walmart', { mode: 'prices', nodes: ask }, 120000, function (d, t) { part.walmart = 0.4 + (t ? 0.6 * d / t : 0); tick(); });
        part.walmart = 1; tick();
        dbgSearch.walmartPrices = { asked: ask.length, saved: near.length - ask.length, got: (pr.stores || []).length, blocked: pr.blocked, error: pr.error };
        LG.info('stations', 'Walmart prices', dbgSearch.walmartPrices);
        if (pr.blocked) notes.push('Walmart: wants a “Robot or human?” check for some prices (Settings → Site checks)');
        (pr.stores || []).forEach(function (w) { KV.put('wmprice', String(w.id), w); var s = P.normalizeWalmart(w); if (s){if(window.PriceHistory)PriceHistory.stamp(s,Date.now());official.push(s);} });
        if ((pr.stores || []).length) siteOk.unshift('Walmart');
      })());
      tick();
      await Promise.all(tasks);
      // past the Google lookup cap: say which brands were still updated (their own sites don't use Google lookups)
      notes = notes.map(function (n) { return /cap reached/i.test(n) ? A.capMsg(n, siteOk) : n; });
    } catch (e) { notes.push(String(e && e.message || e)); LG.error('stations', String(e && e.message || e)); }
    dbgSearch.savedPieces = saved; dbgSearch.oldestSavedMin = Math.round(oldest / 60000);
    if(!replay&&window.PriceHistory){PriceHistory.observe(official);}

    finishScanPending('walmart');
    // Exxon / Mobil stations that aren't in the Walmart+ program lose that discount
    finishScanPending('discounts');
    if(!(replay&&replay.localOnly))try { var allSt = official.slice(); perModel.forEach(function (l) { allSt = allSt.concat(l); });if(S.xomCheck!==false)pg(.94,'Checking station discount eligibility');await xomCheck(allSt); } catch (e) { LG.warn('stations', 'Walmart+ check', String(e)); }
    var grade = gradeOf(), per = [], t0 = Date.now(), nowD = new Date(), goD = departAt();
    for (var mi = 0; mi < models.length; mi++) {
      var model = models[mi];
      var merged = P.mergeOfficial(dedupe(perModel[mi]), official), cands = [], unpriced = 0, stale = 0, unknownTimes=0,oldObservations=0, unp = [];
      var mkCand = function (s, pr, price, calc, extra) {
        var est = 2 * pr.offset * 1.3 + (pr.offset > 0.15 ? 0.2 : 0);
        // trust Google's detour unless it's wildly off from the straight-line estimate (then the piece was routed differently),
        // and only on the stretch it was measured for (not on the way back)
        var exact = s.detourExact && s.detourMi <= est * 3 + 2 && (!s.detourRange || (pr.along >= s.detourRange[0] - 1 && pr.along <= s.detourRange[1] + 1));
        var det = exact ? s.detourMi : est;
        var detMin = det < 0.15 ? 0 : det / 25 * 60 + 1;   // side roads ~25 mph, plus getting off and back on
        return Object.assign({ id: pr.leg ? s.id + '@' + pr.leg : s.id, d: pr.along, offset: pr.offset, detourMi: det, detourMin: detMin, detourExact: exact,
          price: price, calc: calc, station: s, lat: s.lat, lng: s.lng, leg: pr.leg }, extra || {});
      };
      for (var si = 0; si < merged.length; si++) {
        if (si % 25 === 24) await new Promise(function (r) { setTimeout(r, 0); });   // bound UI-thread chunks on big trips
        var s = merged[si];
        // once per leg it's near: on a round trip over the same roads a station is passed going and coming back
        var prs = T.projectLegs(model, { lat: s.lat, lng: s.lng }, maxOff);
        for (var pi = 0; pi < prs.length; pi++) {
          var pr = prs[pi];
          var priced = P.tripPrice(s, grade, S, nowD, rewardArrival(model,pr.along)),c=priced&&priced.calc;
          if (!c) { if (!pi) { unpriced++; unp.push({ s: s, prs: prs }); } break; }
          if(!pi){if(c.ageHours!=null&&c.stale)stale++;if(c.ageUnknown){unknownTimes++;if(c.observedAgeHours>S.staleHours)oldObservations++;}}
          cands.push(mkCand(s, pr, priced.price, c,priced));
        }
      }
      // no posted price: kept aside at an estimated price (typical on this route + 10¢), and only planned in where no
      // priced station is in reach (a $3 penalty per stop keeps them out otherwise)
      var unpricedCands = [];
      if (cands.length && unp.length) {
        var ps = cands.map(function (c) { return c.price; }).sort(function (a, b) { return a - b; });
        var estP = Math.round((ps[Math.floor(ps.length / 2)] + 0.10) * 1000) / 1000;
        unp.forEach(function (u) {
          u.prs.forEach(function (pr) {
            unpricedCands.push(mkCand(u.s, pr, estP, { base: estP, final: estP, est: true, stale: false, updated: null,
              steps: [{ label: 'No posted ' + P.GRADES[grade].label.toLowerCase() + ' price — estimated (typical on this route + 10¢)', kind: 'base', amount: estP }],
              notes: ['No price is posted for this station. It\'s only a stop because nothing with a price is in reach here.'] }, { est: true, penalty: 3 }));
          });
        });
      }
      var ageNotes=notes.slice();
      if(unknownTimes)ageNotes.push(unknownTimes+' prices have unknown pump-update times. A recent website retrieval does not establish when a price changed.');
      if(oldObservations)ageNotes.push(oldObservations+' website prices were last retrieved over '+S.staleHours+' hours ago.');
      per.push({ cands: cands, notes: ageNotes, unpriced: unpriced, stale: stale, grade: grade, unpricedCands: unpricedCands, guessed: !!guessed[per.length] });
    }
    LG.debug('stations', 'Matched stations to ' + models.length + ' route(s) in ' + (Date.now() - t0) + ' ms', per.map(function (x) { return x.cands.length; }));
    return { per: per, cachedAgeMs: saved ? oldest : 0, raw: { official: official, google: perModel } };
  }
  // ---------- other routes ----------
  function altCompareList() {
    if (!S.trip.altCompare || alts.length < 2) return [];
    var out = []; alts.forEach(function (a, k) {if(k===altSel)return;if(legsMode()){var i=a._leg,sel=a._sel&&a._sel[i];if(i!=null&&choiceAnswers()[RouteChoices.key(i,hzAlts(i)[sel])]?.consider===true)out.push(k);}else if(choiceAnswers()[RouteChoices.key(0,a)]?.consider===true)out.push(k);});return out;
  }
  function routeNet(e) {
    var p = e.res.plan; if (!p.ok) return null;
    return choiceCost(e.res);
  }
  function routeMin(e) { var p = e.res.plan; return (e.res.opts&&e.res.opts.model||e.model).durationSec / 60 + (p.ok ? p.stops.reduce(function(n,s){return n+T.stopDelay(e.res.opts,s);},0)+(p.destinationCharges||[]).reduce(function(n,c){return n+c.minutes;},0)+(e.res.top?T.stopDelay(e.res.opts,e.res.top):0) : 0); }
  /** How each other checked route compares to the one you're on (same gas price for leftover gas, same rules). */
  function compareRoutes() {
    var list = result.routes || [], cur = list.filter(function (e) { return e.k === altSel; })[0];
    if (!cur) return [];
    var nc = routeNet(cur);
    return list.filter(function (e) { return e !== cur; }).map(function (e) {
      var no = routeNet(e), a = alts[e.k];
      var c = { k: e.k, via: a.description || 'route ' + (e.k + 1), ok: e.res.plan.ok, error: e.error,
        extraMi: e.model.totalMi - cur.model.totalMi, extraMin: routeMin(e) - routeMin(cur), stops: e.res.plan.ok ? e.res.plan.stops.length : 0 };
      c.saves = no != null && nc != null ? nc - no : null;
      // tolls count too: a toll road with cheap stations can still come out ahead (or not)
      var td = window.Tolls ? Tolls.diff(tripTolls(a), tripTolls(alts[altSel])) : 0;
      c.tolls = tripTolls(a); c.tollDiff = td; c.tollUnknown = td == null;
      if (c.saves != null && td != null) c.saves -= td;
      c.worth = !c.error && c.ok && !c.tollUnknown && (nc == null || c.saves >= (S.trip.altMinSave || 0));
      return c;
    }).sort(function (x, y) { return (y.saves || -1e9) - (x.saves || -1e9); });
  }
  function switchRoute(k) {
    var list = result.routes, e = list.filter(function (x) { return x.k === k; })[0];
    if (!e || e.error) return;
    LG.info('routes', 'Switched to via ' + (alts[k].description || k));
    altSel = k; rawRoute = alts[k]; model = e.model; result = e.res; result.routes = list;
    if (alts[k]._sel && route.legs) route.legs.forEach(function (L, i) { L.sel = alts[k]._sel[i]; });   // that leg's pick changes too
    recompute(); startSweep(); showResult();
  }
  /** ", tolls included ($4.50 more in tolls)" for a comparison that counted them. */
  function tollNote(c) { return c.tollDiff ? ', counting ' + money(Math.abs(c.tollDiff)) + (c.tollDiff > 0 ? ' more' : ' less') + ' in tolls' : ''; }
  function routeBox() {
    var cs = compareRoutes(); if (!cs.length) return '';
    var h = '', best = cs.filter(function (c) { return c.worth; })[0];
    var dmi = function (v) { return Math.abs(v) < 0.5 ? 'same distance' : Math.round(Math.abs(v)) + ' mi ' + (v > 0 ? 'longer' : 'shorter'); };
    var dmin = function (v) { return Math.abs(v) < 1 ? 'about the same time' : Math.round(Math.abs(v)) + ' min ' + (v > 0 ? 'longer' : 'shorter'); };
    if (best) {
      h += '<div class="routebox good"><div class="tb-h">Cheaper route: via ' + esc(best.via) + '</div>' +
        '<div class="lead small keep">' + (best.saves != null ? 'Saves about <b>' + money(best.saves) + '</b>' + tollNote(best) : 'Works with your buffer when this one doesn\'t') + ' · ' + dmi(best.extraMi) + ' · ' + dmin(best.extraMin) +
        ' · ' + best.stops + ' stop' + (best.stops === 1 ? '' : 's') + '.</div>' +
        '<button class="btn tonal" data-route="' + best.k + '">Switch to this route</button></div>';
    }
    var rest = cs.filter(function (c) { return c !== best; });
    if (rest.length) h += '<div class="lead small keep">Also checked: ' + rest.map(function (c) {
      if (c.error) return 'via ' + esc(c.via) + ' (couldn\'t check: ' + esc(c.error) + ')';
      if (!c.ok) return 'via ' + esc(c.via) + ' (no plan keeps your buffer)';
      if (c.tollUnknown) return 'via ' + esc(c.via) + ' — ' + (c.saves > 0.005 ? money(c.saves) + ' less on fuel' : money(-c.saves) + ' more on fuel') + ', but its tolls aren\'t known (type them on Route) · <a href="#" data-route="' + c.k + '">use this route</a>';
      return 'via ' + esc(c.via) + ' — ' + (c.saves > 0.005 ? 'saves only ' + money(c.saves) + ' (your bar is ' + money(S.trip.altMinSave) + ')' : money(-c.saves) + ' more') + tollNote(c) + ', ' + dmin(c.extraMin) +
        ' · <a href="#" data-route="' + c.k + '">use this route</a>';
    }).join('; ') + '.</div>';
    return h;
  }

  // ---------- cruising speed per leg ----------
  var limCache = {},limFlight=new Map(); // shared routes also share in-flight source requests
  function warmChoiceLimits(){if(!routeFlow()||!Garage.speedFn||!Garage.speedFn())return;choiceEntries().forEach(function(item){if(!item.primary)ensureLimits(hzModel(item.route));});}
  function ensureLimits(m) {
    if (m && m._lim && m._lim.stats && m._lim.stats.off && !speedOff(m)) m._lim = null;      // a key was added: look them up now
    if (m && !m._lim && speedOff(m)) {       // cruising speed is off: no lookups, just one stand-in stretch so the (grayed) controls still show
      var tot = m.totalMi, sec = { from: 0, to: tot, mi: tot, limit: 70, truck: 70, st: null, n: 1, hpms: 0, src: 'state' };
      m._lim = { roads: [{ key: 'all', name: 'Major roads', cls: 'interstate', num: '', from: 0, to: tot, mi: tot, pieces: [sec], sections: [sec] }], stats: { off: 'no API key' } };
      return;
    }
    if (!m || (m._lim && m._lim !== 'loading')) return;
    var sig = m.pts.length + ':' + m.totalMi.toFixed(3) + ':' + m.pts[0].lat.toFixed(5);
    var hit = limCache[sig];
    if (hit) {
      if (hit.res) { m._lim = hit.res; return; }
      m._lim = 'loading';
      if (!hit.waiting.includes(m)) hit.waiting.push(m);
      return;
    }
    hit = limCache[sig] = { res: null, waiting: [m] };
    m._lim = 'loading';
    var t0 = Date.now();
    var getJson = function (url) {      // posted limits rarely change: saved for 90 days
      var o = A.KV.get('limits', url, 90 * 24 * 3600e3);
      if (o) return Promise.resolve(o.v);
      if(limFlight.has(url))return limFlight.get(url);
      var pending=call('fetchJson', url).then(function (res) { if (res.body && res.body.indexOf('"error"') < 0) A.KV.put('limits', url, res); return res; }).finally(function(){limFlight.delete(url);});limFlight.set(url,pending);return pending;
    };
    Limits.along(m, getJson, { lookup: S.limitLookup !== false, onProg: function (d, t) { hit.frac = Math.max(hit.frac || 0, t ? d / t : 1); limBars(hit.frac, sig); } }).then(function (res) {
      hit.res = res; limBars(1, sig);
      hit.waiting.forEach(function (w) { w._lim = res; });
      if (hit.waiting.indexOf(model) >= 0 && $('tsSpeed')) renderTripSpeed();
      LG.info('speed', 'Speed limits along the route in ' + (Date.now() - t0) + ' ms', res.stats);
      LG.debug('speed', 'Roads', res.roads.map(function (r) { return [r.name, Math.round(r.from), Math.round(r.to), r.pieces.map(function (p) { return p.st + ':' + p.limit + (p.src === 'hpms' ? '' : '(' + p.src + ')'); }).join(' ')]; }));
    }).catch(function (e) { delete limCache[sig]; hit.waiting.forEach(function (w) { w._lim = { roads: [], stats: {}, error: String(e) }; }); LG.error('speed', 'Speed limit lookup failed', String(e)); });
  }
  /** Every "Looking up speed limits" bar on screen. */
  /** The "speed limits" bars for one route (other routes being looked up in the background don't move them). */
  function limBars(f, sig) {
    var pct = Math.round(Math.min(1, f) * 100);
    document.querySelectorAll('.lim-load[data-sig="' + sig + '"]').forEach(function (el) {
      var i = el.querySelector('i'), p = el.querySelector('.pct');
      if (i) i.style.width = pct + '%'; if (p) p.textContent = pct + '%';
      if (pct >= 100 && el.dataset.hideDone) el.classList.add('hidden');
    });
  }
  function limSig(m) { return m ? m.pts.length + ':' + m.totalMi.toFixed(3) + ':' + m.pts[0].lat.toFixed(5) : ''; }
  function limFrac(m) { var sig = limSig(m), h = sig && limCache[sig]; return h ? (h.res ? 1 : h.frac || 0) : 0; }
  function limBar(m, label, hideDone) {
    var pct = Math.round(limFrac(m) * 100);
    return '<div class="parse-load lim-load' + (pct >= 100 && hideDone ? ' hidden' : '') + '" data-sig="' + esc(limSig(m)) + '"' + (hideDone ? ' data-hide-done="1"' : '') + '><span>' + label + '</span><span class="pbar"><i style="width:' + pct + '%"></i></span><span class="pct">' + pct + '%</span></div>';
  }
  function speedLegs() {
    var r = result, p = r.plan; if (!p.ok) return [];
    var pts = [{ name: route.stops[0].current ? 'Start' : (route.stops[0].short || 'Start'), d: 0 }], avg = r.startPrice || p.refPrice, legs = [];
    var stops = p.stops.slice().concat((p.destinationCharges||[]).map(function(c){return {c:{d:c.d,price:c.buyGal>0?c.cost/c.buyGal:0,station:{name:c.label,brand:'ev'}},arriveGal:c.arriveGal,departGal:c.departGal,buyGal:c.buyGal};})).sort(function(a,b){return a.c.d-b.c.d;});
    var gal0 = r.startGal;
    stops.forEach(function (s, i) { pts.push({ name: (i + 1) + ' · ' + P.displayName(s.c.station), d: s.c.d, s: s }); });
    var dest = route.stops[route.stops.length - 1];
    pts.push({ name: dest.short || dest.label || 'Destination', d: model.totalMi });
    for (var i = 0; i < pts.length - 1; i++) {
      var s = pts[i].s;
      if (s) { avg = s.departGal > 0 ? (s.arriveGal * avg + s.buyGal * s.c.price) / s.departGal : s.c.price; }
      var next = pts[i + 1].s;
      if(pts[i+1].d<=pts[i].d+1e-7)continue;
      legs.push({ label: pts[i].name + ' → ' + pts[i + 1].name, toName: pts[i + 1].name, a: pts[i].d, b: pts[i + 1].d, price: avg,
        arriveGal: next ? next.arriveGal : p.arriveGal, needGal: r.opts.bufferGal, mpgMix: 1 / model.combGpm });
    }
    return legs;
  }
  function speedTile(){var host=$('tpS'+step);return host&&host.querySelector('[data-trip-speed]');}
  function renderTripSpeed() {
    var el = speedTile(); if (!el || !result || !result.plan.ok) return;
    tpBody().querySelectorAll('[data-trip-speed]').forEach(function(e){e.removeAttribute('id');});el.id='tsSpeed';
    ensureLimits(model);
    if(KIND()!=='gas'){renderPropulsionSpeed(el);return;}
    var legs = speedLegs(), lim = model._lim, st = result.speedState = result.speedState || {};
    var priceAt = function (d) { var L = legs.filter(function (x) { return d >= x.a && d < x.b; })[0] || legs[legs.length - 1]; return L ? L.price : result.startPrice; };
    var roads = lim && lim.roads ? lim.roads.map(function (r) {
      var secs = (r.sections || []).map(function (sec) {
        // the section's miles, split where the gas in the tank changes (at stops), each at the section's limit
        var cuts = [sec.from].concat(legs.map(function (L) { return L.b; }).filter(function (d) { return d > sec.from && d < sec.to; })).concat([sec.to]), pieces = [];
        var lim0 = S.speed.truck && sec.truck ? Math.min(sec.limit, sec.truck) : sec.limit;   // "keep me as slow as the trucks"
        for (var k = 0; k < cuts.length - 1; k++) pieces.push({ from: cuts[k], to: cuts[k + 1], mi: cuts[k + 1] - cuts[k], limit: lim0, price: priceAt((cuts[k] + cuts[k + 1]) / 2) });
        return Object.assign({}, sec, { limit: lim0, posted: sec.limit, pieces: pieces });
      });
      return Object.assign({}, r, { sections: secs });
    }) : [];
    Garage.tripSpeed(el, { model: model, roads: roads, legs: legs, stats: lim && lim.stats, loading: !lim || lim === 'loading', loadingHtml: limBar(model, 'Looking up speed limits'), state: st, guard: speedGuard(),
      onEditRule: function () { collectSafe(); step = ST_PARAMS; renderStep(); setTimeout(function () { var f = $('tRule') && $('tRule').closest('.field'); if (f) { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); f.classList.add('pulse'); setTimeout(function () { f.classList.remove('pulse'); }, 1900); } }, 60); },
      onToggle: function (open) { sheetSize(); if (open) tpBody().scrollTop = 0; roadSelSoon(); },
      onTruck: function () { renderTripSpeed(); replan(); } });   // the truck limits change every road's limit: redraw and plan again
    if (speedOff()) grayOut(el); else { el.classList.remove('spd-off'); var on0 = el.querySelector('.spd-off-note'); if (on0) on0.remove(); }
    if (!el._selObs) { el._selObs = new MutationObserver(roadSelSoon); el._selObs.observe(el, { childList: true }); }
    roadSelSoon();
    // first time the speeds are known (speed limits just arrived, or your rule): plan the stops at those speeds
    var cx0 = speedCx();
    if (cx0 && result.planOffs == null) {
      result.planOffs = cx0.offs.join(',');
      if (cx0.offs.some(function (v) { return v; })) { replan(); return; }
    }
    if (result.sweep) refreshBufBox();      // the buffer's gray area depends on these speeds
  }


  // ---------- buffer <-> cruising speed ----------
  function renderPropulsionSpeed(el){
    var r=result,rows=r.propulsionSpeeds,limits=flatSecs(model),loading=r.propulsionSpeedBusy;
    el.innerHTML='<h3>Speed & energy estimates</h3><p class="lead small">'+(KIND()==='h2'?'Hydrogen speed estimates are unvalidated; temperature effects are unknown.':'Weather-aware estimates; unknown vehicles use their EPA/observed baseline and a generic charging curve.')+' These compare a few legal speed caps—not a proven global optimum.</p>'+(rows?rows.map(function(x,i){return '<div class="field">'+(x.offset===0?'Posted limits':'Up to '+Math.abs(x.offset)+' mph below limits')+' · '+(x.ok?money(x.cost)+' · '+Math.round(x.minutes)+' min total <button class="btn tonal sm" data-energy-speed="'+i+'">Use</button>':'not feasible with these parameters')+'</div>';}).join(''):'')+'<button class="btn tonal" data-energy-check'+(!limits.length||loading?' disabled':'')+'>'+(loading?'Comparing…':'Compare speed caps')+'</button>'+(!limits.length?'<small>Waiting for posted speed limits.</small>':'');
    el.querySelector('[data-energy-check]').onclick=async function(){
      if(r!==result||r.propulsionSpeedBusy)return;r.propulsionSpeedBusy=true;renderPropulsionSpeed(el);
      var end=window.Tasks?Tasks.begin('energy-speeds',{text:'Comparing legal speed caps using saved stations',priority:1}):function(){};
      try{
        var rows=[];for(var offset of [0,-5,-10,-15,-20]){
          if(result!==r)return;var o=makeOpts(model,r.cands,r.startGal,rawRoute);o.propulsionContext.offset=offset;o.propulsionContext.limits=limits;o.lite=true;
          var p=await planAsync(o,function(){return result===r;},1);if(p.cancelled)return;
          var cost=p.ok?T.account(r.startGal,r.startPrice,[{stops:T.purchases(p),arriveGal:p.arriveGal}]).legs[0].cost:null;
          rows.push({offset:offset,ok:p.ok,cost:cost,minutes:p.ok?o.model.durationSec/60+p.stops.reduce(function(n,s){return n+T.stopDelay(o,s);},0)+(p.destinationCharges||[]).reduce(function(n,s){return n+s.minutes;},0):null});
        }r.propulsionSpeeds=rows;
      }catch(e){A.toast('Speed comparison failed. '+e.message);}finally{r.propulsionSpeedBusy=false;end();if(result===r&&el.isConnected)renderPropulsionSpeed(el);}
    };
    el.querySelectorAll('[data-energy-speed]').forEach(function(b){b.onclick=function(){if(result!==r)return;S.trip.propulsionOffset=rows[+b.dataset.energySpeed].offset;result.opts.propulsionContext=propulsionContext(model,rawRoute);replan();};});
  }
  // Stops are planned at the speeds you choose (extra gas for driving faster counted on every stretch), so you always
  // arrive at a station — and at the end — with at least your buffer. Faster speeds or a bigger buffer both need the
  // stations closer together. Each slider stops at its infeasible gray range; neither changes the other.
  /** Every posted-limit section of the route's major roads, in order ("keep me as slow as the trucks" applied). */
  function flatSecs(m) {
    var lim = m && m._lim, out = [];
    if (!lim || lim === 'loading' || !lim.roads) return out;
    lim.roads.forEach(function (r) { (r.sections || []).forEach(function (sec) {
      out.push({ from: sec.from, to: sec.to, limit: S.speed.truck && sec.truck ? Math.min(sec.limit, sec.truck) : sec.limit, cls: r.cls });
    }); });
    return out;
  }
  // Cruising speed needs the Routes API's turn-by-turn roads: without a key it's shown grayed out and plans use the limits
  /** Cruising speed needs the roads of the route: Google's answer with a key, or without one the turn-by-turn steps the
   *  Google Maps website sent for it (it sometimes sends only part of them for an alternative). */
  function speedOff(m) { m = m || model; return !S.apiKey && !(m && m.segs && m.segs.some(function (s) { return s.instr; })); }
  var SPEED_OFF = '<div class="spd-off-note">⚠ Cruising speed is off for this route: without a Google API key it needs the turn-by-turn directions from the Google Maps website, and Maps didn\'t send them for this route. Try another route, or add a key in Settings.</div>';
  // ...and the costs are rougher without a key: say so wherever totals show (Stops, Departure)
  function costEst() { return S.apiKey || KIND()==='ev' ? '' : '<div class="spd-off-note est-note">⚠ Without a Google API key these costs are rough estimates: website routes are approximate' + (speedOff() ? ', many stations don\'t post prices online, and speeds are planned at the limits.' : ' and many stations don\'t post prices online.') + '</div>'; }
  function grayOut(el) {
    el.classList.add('spd-off');
    var h3 = el.querySelector(':scope > h3');
    var offNote=el.querySelector('.spd-off-note');
    if(KIND()==='ev'){if(offNote)offNote.remove();}
    else if (!offNote) { if (h3) h3.insertAdjacentHTML('afterend', SPEED_OFF); else el.insertAdjacentHTML('afterbegin', SPEED_OFF); }
    el.querySelectorAll('input, button, select, textarea').forEach(function (x) { x.disabled = true; });
    el.querySelectorAll('a, [tabindex]').forEach(function (x) { x.setAttribute('aria-disabled', 'true'); x.tabIndex = -1; });
    if (!el._offObs) { el._offObs = new MutationObserver(function () { if (speedOff()) grayOut(el); else { el._offObs.disconnect(); el._offObs = null; } }); el._offObs.observe(el, { childList: true, subtree: true }); }   // parts drawn later, too
  }
  function speedCx() {
    var r = result; if (!r || speedOff() || !window.Garage || !Garage.speedFn) return null;
    var secs = flatSecs(model); if (!secs.length) return null;
    var sf = Garage.speedFn(); if (!sf) return null;
    var st = r.speedState = r.speedState || {}; st.offsets = st.offsets || {};
    var offs = secs.map(function (sc, i) { return st.offsets[i] != null ? st.offsets[i] : Garage.ruleOff(sc.limit); });
    return { secs: secs, st: st, offs: offs, f: sf.f, lo: sf.lo, hi: sf.hi };
  }
  function ratesOf(cx, offs) { return T.speedRates(cx.secs, offs, cx.f, cx.lo, cx.hi); }
  /** Plan options on the plain model at buffer mi (for the quick "is there any plan" check). */
  function baseOpts(mi) {
    var o = Object.assign({}, result.opts, { model: model });
    if (mi != null) { o.bufferGal = mi * model.combGpm; o.arriveGal = mi * model.combGpm; }
    return o;
  }
  function canDo(mi, cx, offs) { return T.reachable(baseOpts(mi), ratesOf(cx, offs)); }
  /** Can the buffer slider go to this row? (rows are planned at your speeds; linked: after slowing as far as you allow) */
  /** The lowest buffer any trip may use (Adjustments' "Never below"): the slider can't go under it. */
  function bufFloor() { var f = +S.trip.bufferFloor; return f > 0 ? f : 0; }
  /** The buffer a new plan starts at: your usual one, raised to the floor. */
  function tripBuf() { return Math.max(+S.trip.bufferMi || 0, bufFloor()); }
  function bufOk(x, cx) {
    return !!(x&&x.ok&&x.mi>=bufFloor());
  }
  /** Highest offset that still has a plan — at this buffer, or (linked) at the smallest buffer. Binary search. */
  function maxOffset(cx, set) {
    var mi = result.bufMi, lo = set(null), hi = 15;
    if (!canDo(mi, cx, set(lo))) return lo;
    while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (canDo(mi, cx, set(mid))) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function speedGuard() {
    return {
      maxFor: function (i, offs) {
        var cx = speedCx(); if (!cx) return 15;
        return maxOffset(cx, function (v) { if (v == null) return offs[i]; var o = offs.slice(); o[i] = v; return o; });
      },
      maxAll: function () {
        var cx = speedCx(); if (!cx) return 15;
        var cur = cx.st.all || 0;
        return maxOffset(cx, function (v) { if (v == null) return cur; return cx.secs.map(function (sc) { return Garage.ruleOff(sc.limit, v); }); });
      },
      notes: function (mx, road) { return speedNotes(mx, road); },
      release: function () {
        replan(); // never change the selected buffer as a side effect of a speed change
      }
    };
  }
  /** Re-plan the stops at the current speeds (and buffer mi, if given): totals, buffer slider and all. */
  function replan(mi) {
    var r = result, cx = speedCx(); if (!r || !r.opts) return false;
    var o = Object.assign({}, r.opts, { model: cx ? T.withSpeeds(model, ratesOf(cx, cx.offs)) : model, lite: false });
    if (mi != null) { o.bufferGal = mi * model.combGpm; o.arriveGal = mi * model.combGpm; }
    planLater(r, o, 'Planning at these speeds', function (p) {
      if (!p.ok) { LG.warn('plan', 'No plan at these speeds', { buffer: mi != null ? mi : r.bufMi }); toastMsg('No plan works at those speeds with this buffer.'); return; }
      r.plan = p; r.opts = o; if (mi != null) r.bufMi = mi; r.topSel = -1; r.sweep = null; r.dsweep = null; r.planOffs = cx ? cx.offs.join(',') : '';
      recompute(); startSweep(); keepScroll(showResult);
    });
    return true;
  }
  // A plan of a long trip takes the phone ~20-30 s: always in the background planner pool (planner.js), never on the
  // page (the buffer slider froze the app for that long). The newest request wins; the top bar shows it working.
  var planSeq = 0, planning = 0;
  function planLater(r, opts, label, done) {
    var my = ++planSeq, end0 = window.Tasks ? Tasks.begin('trip-replan', { text: label, priority: 1 }) : function () { };
    planning++; var end = function () { planning--; end0(); };
    planAsync(opts,function(){return my===planSeq&&result===r;},100).then(function (p) { end(); if (my === planSeq && result === r) done(p); },
      function (e) { end(); if (my !== planSeq) return; LG.warn('plan', 'Background plan failed', { error: e.message }); toastMsg(e.message); });
  }
  /** Plans for several option sets side by side across the planner pool; resolves in the same order. */
  function planAll(list,valid) { return Promise.all(list.map(function (o) { return planAsync(o,valid,1); })); }
  /** The buffer the speeds allow, as warnings: "keeps this at N mi or less". */
  function bufLimits() {
    var r = result, cx = speedCx(), sw = r && r.sweep;
    if (!cx || !sw) return null;
    var any = cx.offs.some(function (v) { return v > 0; });
    var allowed = sw.filter(function (x) { return bufOk(x, cx); });
    var maxAllowed = allowed.length ? allowed[allowed.length - 1].mi : null;
    // only blame the speeds when at the limits a bigger buffer would work
    var atLim = cx.secs.map(function () { return 0; });
    var maxAtLimit = null; sw.forEach(function (x) { if (canDo(x.mi, cx, atLim)) maxAtLimit = x.mi; });
    return { maxBuf: any && maxAllowed != null && maxAtLimit != null && maxAllowed < maxAtLimit ? maxAllowed : null, cx: cx };
  }
  function offTxt(v) { return v === 0 ? 'at the limit' : (v > 0 ? '+' : '−') + Math.abs(v) + ' mph'; }
  function capTxt(v) { return v === 0 ? 'at or below the limit' : 'at ' + offTxt(v) + ' or less'; }
  function speedNotes(mx, road) {
    var out = [], b = bufLimits();
    if (b && b.maxBuf != null) out.push('⚠ This speed keeps your buffer at ' + b.maxBuf + ' mi or less.');
    if (mx < 15) out.push('⚠ Your ' + result.bufMi + '-mi buffer keeps this ' + capTxt(mx) + '.');
    return out;
  }
  function refreshBufBox() { if ($('tsBufBox')) { var y = tpBody().scrollTop; $('tsBufBox').outerHTML = bufBox(); bindBuf(); tpBody().scrollTop = y; } }
  /** Switch the trip to this buffer (the slider's quick plan -> the full one). */
  function setBuffer(x) {
    var r = result;
    var fo = Object.assign({}, x.opts, { lite: false });
    planLater(r, fo, 'Planning with a ' + x.mi + '-mile buffer', function (p) { r.plan = p; r.opts = fo; r.bufMi = x.mi; r.topSel = -1; r.dsweep = null; recompute(); keepScroll(showResult); });
  }

  // ---------- buffer slider ----------
  function startSweep() {
    var r = result;
    if(!r||!r.plan.ok)return;
    if (r.sweep || r.sweeping) return;
    r.sweeping = true;
    var top = Math.min(100, Math.max(60, Math.ceil(tripBuf() * 1.5 / 5) * 5)), list = [];
    for (var b = 5; b <= top; b += 5) list.push(b);
    [S.trip.bufferMi, tripBuf(), bufFloor(), r.bufMi].forEach(function (v) { if (v > 0 && list.indexOf(v) < 0) list.push(v); });
    list.sort(function (a, b2) { return a - b2; });
    var t0 = Date.now(), o = r.opts, opts = list.map(function (mi) { return Object.assign({}, o, { bufferGal: mi * o.model.combGpm, arriveGal: mi * o.model.combGpm, refPrice: o.refPrice, lite: true }); });
    setTimeout(function () {
      if (result !== r) { r.sweeping = false; return; }
      planAll(opts,function(){return result===r&&r.opts===o;}).then(function (plans) {
      if (result !== r) { r.sweeping = false; return; }
      // the plan changed while the sweep ran (a speed, the detour limit): these rows are for the old one
      if (r.opts !== o) { r.sweeping = false; r.sweep = null; return startSweep(); }
      // as T.bufferSweep, one buffer per worker
      var rows = plans.map(function (p, k) { return { mi: list[k], ok: p.ok, net: p.ok ? p.totals.net + (o.timeValue || 0) * (p.totals.detourMin + p.stops.length * (o.stopMinutes || 0)) / 60 : null, plan: p, opts: opts[k] }; });
      r.sweep = T.marks(rows); r.sweeping = false;
      LG.debug('plan', 'Buffer sweep in ' + (Date.now() - t0) + ' ms', rows.map(function (x) { return x.mi + ':' + (x.net == null ? '-' : x.net.toFixed(2)) + (x.mark ? '*' : ''); }).join(' '));
      if (floorUp(r)) return;
      if (result === r && $('tsBufBox')) { var el = $('tsBufBox'); el.outerHTML = bufBox(); bindBuf(); if (r.plan.ok && $('tsSpeed')) renderTripSpeed(); }
      }, function (e) { r.sweeping = false; LG.warn('plan', 'Buffer sweep failed', { error: e.message }); });
    }, 300);
  }
  // ---------- how much gas to leave with ----------
  /**
   * Read straight from the plan (so it can never disagree with the stops): when the first stop is at the start of
   * the trip, that's the gas to add before you go; otherwise leave with what you have.
   */
  function idealBox() {
    var r = result, p = r && r.plan; if (!p || !p.ok) return '';
    var m = r.opts.model || model, gpm = m.galTo(m.totalMi) / m.totalMi || model.combGpm;
    var first = p.stops[0], atStart = first && first.c.d <= 5;
    var gal = r.startGal + (atStart ? first.buyGal : 0);
    var help = 'The ' + FW().toLowerCase() + ' to have when you set off, from your plan: if its first stop is by the start (within 5 miles), you ' + (KIND() === 'ev' ? 'charge' : 'buy') + ' that much before you go. Range is at this trip\'s mileage and your speeds.';
    return '<div class="ideal" id="tsIdeal"><div class="ideal-h"><span class="nn sm">1</span>' + FW() + ' to leave with ' + A.qBtn(help) + '</div>' +
      '<div class="ideal-row"><div class="ideal-l"><div class="ideal-big">' + gal.toFixed(1) + ' ' + UN() + '</div><div class="ideal-sub">~' + Math.round(gal / gpm) + ' mi of range</div></div>' +
      '<div class="ideal-r">' + (atStart ? 'Add <b>' + first.buyGal.toFixed(1) + ' ' + UN() + '</b><small>' + esc(P.displayName(first.c.station)) + (first.c.d >= 0.5 ? ' · mile ' + first.c.d.toFixed(1) : '') + '</small>' : '<b>Nothing to add</b><small>leave with what you have</small>') + '</div></div></div>';
  }
  /** Gas in the tank at mile d of the plan (after any stop before it), and the range it gives. */
  function gasAt(d) {
    var r = result, p = r.plan, m = r.opts.model || model, gal = r.startGal, at = 0;
    T.purchases(p).forEach(function (st) { if (st.d <= d) { gal = st.arriveGal+st.buyGal; at = st.d; } });
    return gal - (m.galTo(d) - m.galTo(at));
  }
  /**
   * One tile per place after the start: the gas you'll have when you get there. Places in between (like the far end of
   * a round trip) say what that gas is enough for; the last one, on a one-way trip, whether it gets you back.
   */
  function arriveBox() {
    var r = result, p = r && r.plan; if (!p || !p.ok) return '';
    if(KIND()==='ev'&&(p.destinationCharges||[]).length)return (model.legEnds||[]).map(function(d,i){var c=p.destinationCharges.find(function(c){return c.index===i;}),arrival=c?c.arriveGal:gasAt(d),cap=Garage.tank();return '<div class="card ev-destination-summary"><h3>'+esc(stopName(route.stops[i+1]||{}))+'</h3><p>Arrive: '+Math.round(arrival/cap*100)+'%'+(c?' · After charging: '+Math.round(c.departGal/cap*100)+'%':'')+'</p>'+(c?'<p class="lead small keep">'+Math.round(c.minutes)+' min · '+c.gridKWh.toFixed(1)+' kWh · '+money(c.cost)+' (estimated)</p>':'')+'</div>';}).join('');
    var m = r.opts.model || model, gpm = m.galTo(m.totalMi) / m.totalMi || model.combGpm;
    var ends = (model.legEnds || []).slice(0, route.stops.length - 2), h = '', loop = loopTrip(route);
    ends.forEach(function (d, i) {
      var gal = gasAt(d), last = i === ends.length - 1;
      var why = loop && last ? 'Enough for the cheapest return trip' : 'Enough to reach the next fuel stop';
      h += tile(i + 2, FW() + ' at ' + stopName(route.stops[i + 1]), gal, why);
    });
    var galEnd = r.top ? r.top.endGal : p.arriveGal, miEnd = galEnd / gpm;
    var endWhy = loop ? '' : miEnd >= model.totalMi ? 'Enough for the drive back' : '';
    h += tile(route.stops.length, FW() + ' when you arrive', galEnd, endWhy);
    return h;
    function tile(n, title, gal, ok) {
      return '<div class="ideal arr" data-n="' + n + '"><div class="ideal-h"><span class="nn sm">' + n + '</span>' + esc(title) + '</div>' +
        '<div class="ideal-row"><div class="ideal-l"><div class="ideal-big">' + Math.max(0, gal).toFixed(1) + ' ' + UN() + '</div><div class="ideal-sub">~' + Math.round(Math.max(0, gal) / gpm) + ' mi of range</div></div></div>' +
        (ok ? '<div class="ok-line"><span class="okc">✓</span>' + ok + '</div>' : '') + '</div>';
    }
  }
  function swRow(mi) {
    var sw = result.sweep, best = null;
    sw.forEach(function (x) { if (!best || Math.abs(x.mi - mi) < Math.abs(best.mi - mi)) best = x; });
    return best;
  }
  /**
   * Markers on the buffer slider: gray = your usual buffer; green = where the trip gets cheaper than that, yellow =
   * where it costs more. One marker per change in cost (at the buffer nearest your usual one that gets that cost),
   * labeled with the difference, so a run of buffers that all cost the same shows once.
   */
  function bufMarks(sw, base) {
    var out = [], runs = [], prev = null;
    if (!base.ok) return out;
    sw.forEach(function (x) {
      if (!bufOk(x)) { prev = null; return; }
      var d = x.net - base.net, k = Math.abs(d) < 0.05 ? 0 : Math.round(d * 20);    // same cost to within 5¢ = one run
      if (prev && prev.k === k && (prev.mi < base.mi) === (x.mi < base.mi)) prev.rows.push(x);
      else { prev = { k: k, d: d, mi: x.mi, rows: [x] }; runs.push(prev); }
    });
    runs.forEach(function (run) {
      if (!run.k) return;
      var rows = run.rows, below = rows[0].mi < base.mi;
      var x = below ? rows[rows.length - 1] : rows[0];          // the edge nearest your usual buffer
      out.push({ mi: x.mi, d: run.d, kind: run.d < 0 ? 'good' : 'bad', row: x });
    });
    return out;
  }
  /** Room between marker labels on a slider, in % of its width (a label is ~56 px wide). */
  function markGap() { return Math.max(17, 5800 / Math.max(180, innerWidth - 100)); }
  /**
   * Give each marker a label row (up to three; the usual one and the biggest saving go first). A marker that finds no
   * room in any row isn't drawn at all, so every line on the slider says what it saves or costs. -> rows used.
   */
  function placeMarks(all, big, pos) {
    var GAP = markGap(), rows = [[], [], []];
    var free = function (row, L) { return rows[row].every(function (q) { return Math.abs(q - L) >= GAP; }); };
    all.filter(function (m) { return m.kind === 'base' || m === big; }).concat(all.filter(function (m) { return !(m.kind === 'base' || m === big); }))
      .forEach(function (m) { var L = +pos(m.mi); m.lr = free(0, L) ? 0 : free(1, L) ? 1 : free(2, L) ? 2 : -1; if (m.lr >= 0) rows[m.lr].push(L); });
    return rows[2].length ? 3 : 2;
  }
  function markHtml(m, L, attr) {
    if (m.lr < 0) return '';
    var lab = m.kind === 'base' ? 'usual' : (m.d < 0 ? '−' : '+') + money(Math.abs(m.d)).replace(/^[−-]/, '');
    return '<span class="bm ' + m.kind + (m.lr ? ' r' + (m.lr + 1) : '') + '" style="left:' + L + '%" data-snap="' + m.mi + '"' + (m.kind !== 'base' ? ' ' + attr + '="' + m.mi + '"' : '') + '><em>' + lab + '</em><i></i></span>';
  }
  /** The blue part of a buffer / detour slider's track, up to the knob (the slider is drawn by us; see app.css). */
  function fillRange(inp) { var lo = +inp.min, hi = +inp.max; inp.style.setProperty('--p', (hi > lo ? (+inp.value - lo) / (hi - lo) * 100 : 0) + '%'); }
  /** The points a slider's knob snaps to: its drawn marks (green, yellow, usual) and where it is now. */
  function snapPoints(box, cur) {
    var a = Array.prototype.map.call(box.querySelectorAll('.bm[data-snap]'), function (m) { return +m.dataset.snap; });
    if (cur != null && a.indexOf(cur) < 0) a.push(cur);
    return a.sort(function (x, y) { return x - y; });
  }
  function nearest(a, v) { var b = a[0]; a.forEach(function (x) { if (Math.abs(x - v) < Math.abs(b - v)) b = x; }); return b;
  }
  function bufBox() {
    var r = result, sw = r.sweep;
    var h = '<div class="bufbox" id="tsBufBox"><div class="tb-h">Buffer for this trip</div>' + floorRow();
    if (!sw) return h + A.ldBar('Checking other buffers') + '</div>';
    // the buffer's limits depend on your speeds, which depend on the speed limits: wait for them
    if (S.limitLookup !== false && (!model._lim || model._lim === 'loading')) return h + limBar(model, 'Waiting for speed limits') + '</div>';
    var min = sw[0].mi, max = sw[sw.length - 1].mi, cur = swRow(r.bufMi), base = swRow(tripBuf());
    if (!base.ok) base = cur;
    var pos = function (mi) { return ((mi - min) / (max - min) * 100).toFixed(2); };
    var bl = bufLimits(), warns = [];
    if (bl && bl.maxBuf != null) warns.push('⚠ Your cruising speeds keep this at ' + bl.maxBuf + ' mi or less.');
    if (bl) {
      var G0 = speedGuard(), st0 = bl.cx.st, at = st0.touched != null && st0.touched !== 'all' && bl.cx.secs[st0.touched] ? st0.touched : 'all';
      var mx0 = at === 'all' ? G0.maxAll() : G0.maxFor(at, bl.cx.offs);
      if (mx0 < 15) warns.push('⚠ This buffer keeps ' + (at === 'all' ? 'All roads' : 'that road (' + bl.cx.secs[at].limit + ' mph limit)') + ' ' + capTxt(mx0) + '.');
    }
    if (warns.length) h += '<div class="spd-warn">' + warns.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>';
    h += '<div class="buf-read"><b id="tsBufVal">' + r.bufMi + ' mi</b> <span id="tsBufCost">' + bufText(cur, base) + '</span></div>';
    var mk = bufMarks(sw, base);
    var all = mk.concat([{ mi: base.mi, kind: 'base' }]).sort(function (a2, b2) { return a2.mi - b2.mi; });
    var big = mk.filter(function (m) { return m.kind === 'good'; }).sort(function (a2, b2) { return a2.d - b2.d; })[0];
    var nRows = placeMarks(all, big, pos);
    h += '<div class="buf-track' + (nRows > 2 ? ' rows3' : '') + '"><div class="buf-marks">';
    all.forEach(function (m) { h += markHtml(m, +pos(m.mi), 'data-bm'); });
    // gray: buffers you can't use (no plan keeps that much, or your speeds would run the tank dry)
    var cx = speedCx(), band = null, bands = [], memo = {};
    for (var v = min; v <= max; v++) {
      var rw = swRow(v), okV = memo[rw.mi] != null ? memo[rw.mi] : (memo[rw.mi] = bufOk(rw, cx));
      if (!okV && !band) { band = { a: v, b: v }; bands.push(band); } else if (!okV) band.b = v; else band = null;
    }
    h += bands.map(function (bd) {
      var a = Math.max(0, (bd.a - 0.5 - min) / (max - min) * 100), b2 = Math.min(100, (bd.b + 0.5 - min) / (max - min) * 100);
      return '<span class="bgray" style="left:' + a.toFixed(2) + '%;width:' + (b2 - a).toFixed(2) + '%"></span>';
    }).join('') + '</div><input type="range" id="tsBuf" min="' + min + '" max="' + max + '" step="1" value="' + r.bufMi + '"></div>';
    h += '<div class="buf-scale"><span>' + min + ' mi</span><span>' + max + ' mi</span></div>';
    if (!bufOk(cur)) {
      var okRows = sw.filter(function (x) { return bufOk(x); }), lowOk = sw.some(function (x) { return x.ok; });
      h += '<div class="lead small keep">' + (okRows.length ? 'The highest buffer that works on this trip is ' + okRows[okRows.length - 1].mi + ' mi.' : lowOk && bufFloor() ? 'No buffer of ' + bufFloor() + ' mi or more works on this trip — lower “Never below” or check the miles left.' : 'No buffer works — check the miles left.') + '</div>';
    }
    if (r.bufMi !== tripBuf()) h += '<div class="lead small keep usual-l">Your buffer is different than usual. <a href="#" id="tsBufKeep">Make ' + r.bufMi + ' mi my usual buffer.</a></div>';
    return h + '</div>';
  }
  /** Top left of the buffer tile: the lowest buffer the slider may reach, for every trip (S.trip.bufferFloor). */
  function floorRow() {
    var help = 'The least ' + (KIND() === 'ev' ? 'charge' : 'gas') + ' you ever want left, in miles of range. The slider can\'t go below it, so trying a smaller buffer for a cheaper trip never plans you down to an almost empty tank: you reach every stop and the end with at least this much. It applies to all trips. 0 turns it off.';
    return '<div class="buf-floor"><label for="tsBufFloor">Never below</label><input type="number" id="tsBufFloor" inputmode="numeric" min="0" max="200" step="1" value="' + bufFloor() + '"><span>mi</span>' + A.qBtn(help) + '</div>';
  }
  function bindFloor() {
    var inp = $('tsBufFloor'); if (!inp) return;
    inp.onchange = function () {
      var f = Math.max(0, Math.min(200, Math.round(parseFloat(inp.value) || 0)));
      if (f === bufFloor()) { inp.value = f; return; }
      S.trip.bufferFloor = f; A.save(); LG.info('plan', 'Buffer floor: ' + f + ' mi');
      var r = result; if (!r || !r.sweep) return;
      if (r.sweep.every(function (x) { return x.mi !== f; })) { r.sweep = null; startSweep(); refreshBufBox(); return; }   // check that buffer too
      if (!floorUp(r)) refreshBufBox();
    };
  }
  /** The trip's buffer is below the floor: move it up to the lowest buffer at or above the floor that works. */
  function floorUp(r) {
    if (r !== result || !r.sweep || r.bufMi >= bufFloor()) return false;
    var up = r.sweep.filter(function (x) { return x.mi >= bufFloor() && bufOk(x); })[0];
    if (!up) return false;
    LG.info('plan', 'Buffer raised to the floor: ' + r.bufMi + ' → ' + up.mi + ' mi');
    setBuffer(up); return true;
  }
  function bufText(x, base) {
    if (!x.ok) return 'can\'t keep this much — no priced station in reach';
    var dip = x.plan.firstDip ? ' · dips below it before the first stop' : '';
    var n = x.plan.stops.length + ' stop' + (x.plan.stops.length === 1 ? '' : 's') + dip;
    if (x === base || !base.ok) return n + (x === base ? ' · your usual' : '');
    var d = x.net - base.net;
    return (Math.abs(d) < 0.05 ? 'same cost as usual' : d < 0 ? 'saves ' + money(-d) + ' vs. usual' : money(d) + ' more than usual') + ' · ' + n;
  }
  function bindBuf() {
    bindFloor();
    var inp = $('tsBuf'); if (!inp) return;
    Garage.guardRange(inp); fillRange(inp);
    var r = result, cur = swRow(r.bufMi), base = swRow(tripBuf());
    if (!base.ok) base = cur;
    var last = r.bufMi;
    // the knob snaps to the marks (and where it is now); a tick each time it lands on another one
    var snaps = snapPoints($('tsBufBox'), r.bufMi).filter(function (v) { return v === r.bufMi || bufOk(swRow(v)); });
    // no cost marks (every buffer costs the same): slide freely instead of being stuck between "usual" and here
    var snapOn = !!$('tsBufBox').querySelector('[data-bm]');
    inp.oninput = function () {
      var x = swRow(snapOn ? nearest(snaps, +inp.value) : +inp.value), v = x.mi;
      if (!bufOk(x)) { v = last; x = swRow(last); }        // can't slide into the gray
      inp.value = v; fillRange(inp);
      if (v !== last) { tick(); last = v; }
      $('tsBufVal').textContent = x.mi + ' mi'; $('tsBufCost').textContent = bufText(x, base);
    };
    $('tsBufBox').querySelectorAll('[data-bm]').forEach(function (m) { m.onclick = function () { inp.value = m.dataset.bm; inp.oninput(); inp.onchange(); }; });
    inp.onchange = function () {
      var x = swRow(+inp.value);
      if (x.mi === r.bufMi) { inp.value = x.mi; return; }
      LG.info('plan', 'Buffer slider: ' + r.bufMi + ' → ' + x.mi + ' mi', { ok: x.ok, net: x.net });
      if (!bufOk(x)) { inp.value = r.bufMi; fillRange(inp); $('tsBufVal').textContent = r.bufMi + ' mi'; $('tsBufCost').textContent = bufText(cur, base); toastMsg('No plan keeps ' + x.mi + ' mi at your speeds — the stations are too far apart.'); return; }
      setBuffer(x);
    };
    if ($('tsBufKeep')) $('tsBufKeep').onclick = function (e) { e.preventDefault(); S.trip.bufferMi = r.bufMi; A.save(); keepScroll(showResult); };
  }

  // ---------- max. detour slider ----------
  // Like the buffer slider, for the "Max. extra time" per stop: the same trip re-planned at each limit, with markers
  // where a longer (or shorter) limit makes the trip cheaper — e.g. a station that's only a few minutes farther out on
  // the way back. For this trip only, unless you make it your usual.
  var DET_STEPS = [2, 3, 4, 5, 6, 7.5, 10, 12.5, 15, 20, 25, 30];
  function detMinOf(r) { return r.opts && r.opts.maxDetourMin != null ? +r.opts.maxDetourMin : +S.trip.maxDetourMin; }
  function startDetSweep() {
    var r = result; if (!r || !r.opts || !r.plan || !r.plan.ok || r.dsweep || r.dsweeping) return;
    r.dsweeping = true;
    var list = DET_STEPS.slice();
    [+S.trip.maxDetourMin, detMinOf(r)].forEach(function (v) { if (v > 0 && list.indexOf(v) < 0) list.push(v); });
    list.sort(function (a, b) { return a - b; });
    var tv = function (p) { return (r.opts.timeValue || 0) * (p.totals.detourMin + p.stops.length * (r.opts.stopMinutes || 0)) / 60; };
    setTimeout(function () {
      if (result !== r) { r.dsweeping = false; return; }
      var o = r.opts;
      planAll(list.map(function (m) { return Object.assign({}, o, { maxDetourMin: m, lite: true }); }),function(){return result===r&&r.opts===o;}).then(function (plans) {
        r.dsweeping = false; if (result !== r) return;
        if (r.opts !== o) { r.dsweep = null; return startDetSweep(); }
        r.dsweep = plans.map(function (p, k) { return { mi: list[k], ok: p.ok, net: p.ok ? p.totals.net + tv(p) : null, plan: p }; });
        if ($('tsDetBox')) keepScroll(function () { $('tsDetBox').outerHTML = detBox(); bindDet(); });
      }, function (e) { r.dsweeping = false; LG.warn('plan', 'Detour sweep failed', { error: e.message }); });
    }, 450);
  }
  function detRow(v) { var best = null; (result.dsweep || []).forEach(function (x) { if (!best || Math.abs(x.mi - v) < Math.abs(best.mi - v)) best = x; }); return best; }
  function minTxt(v) { return (Math.round(v * 10) / 10) + ' min'; }
  function detText(x, base) {
    if (!x.ok) return 'no plan works with this limit';
    var n = x.plan.stops.length + ' stop' + (x.plan.stops.length === 1 ? '' : 's');
    if (x === base || !base.ok) return n + (x === base ? ' · your usual' : '');
    var d = x.net - base.net;
    return (Math.abs(d) < 0.05 ? 'same cost as usual' : d < 0 ? 'saves ' + money(-d) + ' vs. usual' : money(d) + ' more than usual') + ' · ' + n;
  }
  function detBox() {
    var r = result, sw = r.dsweep;
    var h = '<div class="bufbox detbox" id="tsDetBox"><div class="tb-h">Max. detour for this trip</div>';
    if (!sw) return h + A.ldBar('Checking other limits') + '</div>';
    var cur = detRow(detMinOf(r)), base = detRow(+S.trip.maxDetourMin);
    if (!base || !base.ok) base = cur;
    var n = sw.length, idx = function (v) { var k = 0; sw.forEach(function (x, i) { if (Math.abs(x.mi - v) < Math.abs(sw[k].mi - v)) k = i; }); return k; };
    var pos = function (v) { return (idx(v) / Math.max(1, n - 1) * 100).toFixed(2); };
    h += '<div class="buf-read"><b id="tsDetVal">' + minTxt(cur.mi) + '</b> <span id="tsDetCost">' + detText(cur, base) + '</span></div>';
    var mk = bufMarks(sw, base);
    var all = mk.concat([{ mi: base.mi, kind: 'base' }]).sort(function (a2, b2) { return a2.mi - b2.mi; });
    var big = mk.filter(function (m) { return m.kind === 'good'; }).sort(function (a2, b2) { return a2.d - b2.d; })[0];
    var nRows = placeMarks(all, big, pos);
    h += '<div class="buf-track' + (nRows > 2 ? ' rows3' : '') + '"><div class="buf-marks">';
    all.forEach(function (m) { h += markHtml(m, pos(m.mi), 'data-dm'); });
    // gray: limits with no workable plan
    var bands = [], band = null;
    sw.forEach(function (x, i) { if (!x.ok && !band) { band = { a: i, b: i }; bands.push(band); } else if (!x.ok) band.b = i; else band = null; });
    h += bands.map(function (bd) {
      var a = Math.max(0, (bd.a - 0.5) / Math.max(1, n - 1) * 100), b2 = Math.min(100, (bd.b + 0.5) / Math.max(1, n - 1) * 100);
      return '<span class="bgray" style="left:' + a.toFixed(2) + '%;width:' + (b2 - a).toFixed(2) + '%"></span>';
    }).join('');
    h += '</div><input type="range" id="tsDet" min="0" max="' + (n - 1) + '" step="1" value="' + idx(cur.mi) + '" aria-label="Max. detour per stop"></div>';
    h += '<div class="buf-scale"><span>' + minTxt(sw[0].mi) + '</span><span>' + minTxt(sw[n - 1].mi) + '</span></div>';
    if (Math.abs(cur.mi - S.trip.maxDetourMin) > 0.01) h += '<div class="lead small keep usual-l">Your max detour is different than usual. <a href="#" id="tsDetKeep">Make ' + minTxt(cur.mi) + ' my usual max detour.</a></div>';
    return h + '</div>';
  }
  function bindDet() {
    var inp = $('tsDet'); if (!inp) return;
    if (Garage.guardRange) Garage.guardRange(inp);
    fillRange(inp);
    var r = result, sw = r.dsweep, base = detRow(+S.trip.maxDetourMin) || detRow(detMinOf(r)), last = +inp.value;
    if (!base.ok) base = detRow(detMinOf(r));
    // the knob snaps to the marks (and where it is now); a tick each time it lands on another one
    var ix = function (mi) { for (var k = 0; k < sw.length; k++) if (Math.abs(sw[k].mi - mi) < 1e-6) return k; return -1; };
    var snaps = snapPoints($('tsDetBox') || inp.closest('.bufbox'), null).map(ix).filter(function (k) { return k >= 0 && sw[k].ok; });
    if (snaps.indexOf(last) < 0) snaps.push(last);
    snaps.sort(function (a2, b2) { return a2 - b2; });
    var snapOn = !!($('tsDetBox') || inp.closest('.bufbox')).querySelector('[data-dm]');   // as the buffer slider: free when nothing changes the cost
    inp.oninput = function () {
      var k = snapOn ? nearest(snaps, +inp.value) : +inp.value, x = sw[k];
      if (!x.ok) { k = last; x = sw[last]; }
      inp.value = k; fillRange(inp);
      if (k !== last) { tick(); last = k; }
      $('tsDetVal').textContent = minTxt(x.mi); $('tsDetCost').textContent = detText(x, base);
    };
    inp.onchange = function () {
      var x = sw[+inp.value]; if (!x || !x.ok || Math.abs(x.mi - detMinOf(r)) < 0.01) return;
      LG.info('plan', 'Max. detour slider: ' + detMinOf(r) + ' → ' + x.mi + ' min', { net: x.net });
      var fo = Object.assign({}, r.opts, { maxDetourMin: x.mi, lite: false });
      planLater(r, fo, 'Planning with a ' + minTxt(x.mi) + ' detour limit', function (p) { r.plan = p; r.opts = fo; r.topSel = -1; r.sweep = null; recompute(); startSweep(); keepScroll(showResult); });
    };
    $('tsDetBox').querySelectorAll('[data-dm]').forEach(function (m) {
      m.onclick = function () { var k = 0; sw.forEach(function (x, i) { if (Math.abs(x.mi - +m.dataset.dm) < 0.01) k = i; }); inp.value = k; inp.oninput(); inp.onchange(); };
    });
    if ($('tsDetKeep')) $('tsDetKeep').onclick = function (e) { e.preventDefault(); S.trip.maxDetourMin = detMinOf(r); A.save(); keepScroll(showResult); };
  }

  // Use segment timing rather than a fraction of total distance. Respect a later explicit return
  // departure. These remain estimates in the phone's timezone, not promises about a pump's clock.
  function rewardArrival(m,d,stops){
    var t=departAt().getTime(),seconds=m.timeTo(d),ends=m.legEnds||[],before=function(at){return (stops||[]).filter(function(s){return s.c.d<at;}).reduce(function(sum,s){return sum+T.stopDelay({fuelKind:KIND(),stopMinutes:KIND()==='ev'?5:3},s);},0)*60;};
    seconds+=before(d);
    if(S.trip.returnTrip&&!backAuto()&&S.trip.backAt&&ends.length>1){var turn=ends[ends.length-2];if(d>=turn){var wait=new Date(S.trip.backAt).getTime()-(t+(m.timeTo(turn)+before(turn))*1000);seconds+=Math.max(0,wait||0)/1000;}}
    return new Date(t+seconds*1000);
  }
  function repriceRewards(){
    if(!result)return;
    var list=[result].concat((result.routes||[]).map(function(x){return x.res;})),seen=new Set();
    var top=result,jobs=[];
    list.forEach(function(r){if(seen.has(r)||!r.opts)return;seen.add(r);var m=r.opts.model;
      r.cands.forEach(function(c){if(c.est)return;var q=P.tripPrice(c.station,r.grade,S,new Date(),rewardArrival(m,c.d));if(q){delete c.citgo;Object.assign(c,q);}});
      r.opts=Object.assign({},r.opts,{cands:r.cands});jobs.push(r);
    });
    var end0=window.Tasks?Tasks.begin('trip-replan',{text:'Pricing CITGO rewards',priority:1}):function(){};planning++;var end=function(){planning--;end0();};
    planAll(jobs.map(function(r){return r.opts;})).then(function(plans){end();if(result!==top)return;jobs.forEach(function(r,k){r.plan=plans[k];r.sweep=null;r.dsweep=null;r.topSel=-1;});recompute();keepScroll(showResult);},function(e){end();toastMsg(e.message);});
  }
  function makeOpts(model,cands,startGal,raw){
    return makeBaseOpts(model,cands,startGal,raw);
  }
  function propulsionContext(m,raw){
    var temps=[],same=raw===rawRoute||!raw&&m.pts===model.pts;
    if(same||raw&&raw._sel)for(var i=0;i<hzLegs();i++){
      var a=hzAlts(i)[raw&&raw._sel?raw._sel[i]:hzSel(i)],e=a&&hzCache.get(a),offset=i?(m.legEnds||[])[i-1]||0:0;
      ((e&&e.reading&&e.reading.temperatures)||[]).forEach(function(p){temps.push({mi:offset+p.mi,hours:p.hours});});
    }
    var ends=m.legEnds||[];
    return {weather:temps,departAt:departAt().getTime(),limits:flatSecs(m),offset:S.trip.propulsionOffset==null?null:+S.trip.propulsionOffset,waitAt:S.trip.returnTrip&&!backAuto()&&S.trip.backAt&&ends.length>1?{d:ends[ends.length-2],at:new Date(S.trip.backAt).getTime()}:null};
  }
  function makeBaseOpts(model, cands, startGal,raw) {
    var kd = KIND(), cap = Garage.tank();
    return { step: kd === 'ev' ? Math.max(0.1, Math.round(cap / 150 * 10) / 10) : kd === 'h2' ? 0.05 : 0.1, fillCap: kd === 'ev' ? cap * 0.8 : null,
      priceAgeHours:kd==='ev'?Math.max(1,Math.min(720,+S.evPriceAgeHours||24)):0,priceNow:Date.now(),requireKnownPrice:kd==='ev'&&S.evAllowUnknownPrices!==true,
      model: model, cands: cands, startGal: startGal, capGal: Garage.tank(), bufferGal: tripBuf() * model.combGpm,
      propulsion:kd==='gas'?null:Object.assign({},Garage.car().propulsion,{kind:kd,capacity:cap,dcKw:+Garage.car().dcKw||150,acKw:+Garage.car().acKw||7.2}),propulsionContext:kd==='gas'?null:propulsionContext(model,raw),
      destinationCharges:kd==='ev'&&window.EVCharging?EVCharging.policies(S.trip,route&&route.stops||[],Garage.car(),model,cap,S.evPrice):[],
      arriveGal: tripBuf() * model.combGpm, fillUp: S.trip.fillUp,
      // arriving with the most gas: a late, cheap fill-up is the point, so the "must save" bar drops to $0.25
      stopPenalty: S.trip.arrive === 'full' ? Math.min(S.trip.minSave, 0.25) : S.trip.minSave,
      detourPenalty: S.trip.arrive === 'full' ? Math.min(S.trip.minSave, 0.25) : S.trip.minSave,
      maxDetourMin: S.trip.maxDetourMin, timeValue: 0, fuelKind:kd, stopMinutes: kd === 'ev' ? 5 : 3,
      rewardDepartAt:departAt().getTime(),rewardPriceAt:function(c,m,stops){if(c.est||!c.station||c.station.brand!=='citgo')return Object.assign({},c,{rewardMonth:P.monthKey(rewardArrival(m,c.d,stops))});var q=P.tripPrice(c.station,gradeOf(),S,new Date(),rewardArrival(m,c.d,stops));return q?Object.assign({},c,q):c;},
      lastFull: S.trip.arrive === 'full' };
  }
  function breathe() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function planAsync(opts,valid,priority){
    var discounts={};['walmartPlus','samsMode','cashbackPct','citgoTier','citgoUsed','citgoHistory','blacklist','dieselRisk','staleHours'].forEach(function(k){discounts[k]=S[k];});
    return Planner.run(opts,{departAt:opts.rewardDepartAt,returnAt:S.trip.returnTrip&&!backAuto()&&S.trip.backAt?new Date(S.trip.backAt).getTime():null,grade:gradeOf(),discounts:discounts,now:Date.now(),valid:valid,priority:priority}).then(function(p){var tm=opts._plannerTiming;if(tm&&(tm.waitMs>1000||tm.runMs>3000))LG.debug('plan','Planner timing',{candidates:opts.cands.length,lite:!!opts.lite,waitMs:tm.waitMs,runMs:tm.runMs,pool:Planner.stats?Planner.stats():null});return p;});
  }
  var finding = null;   // the stop search under way (a step jump waits for it rather than stopping)
  function findStops(force) {
    if(force===true&&!S.apiKey)force='discover';
    if (busy || !model) return finding || Promise.resolve();
    return (finding = findStops1(force).finally(function () { finding = null; }));
  }
  // ---------- a station search as a job: it can run in the background, or be cancelled ----------
  var bgJob = false, jobCancel = false, searchCancelled = false;
  var scanPendingIds=new Set();
  function scanPending(id,text,order){if(jobCancel)return;var key='trip-pending:'+id;scanPendingIds.add(key);if(window.Tasks)Tasks.upsert(key,{parent:'stations',state:'pending',text:text,order:order});}
  function finishScanPending(id){var key='trip-pending:'+id;scanPendingIds.delete(key);if(window.Tasks)Tasks.remove(key);}
  function clearScanPending(){scanPendingIds.forEach(function(id){if(window.Tasks)Tasks.remove(id);});scanPendingIds.clear();}
  /** Is the trip panel showing this search's own progress (its plan steps, or Departure's price refresh)? */
  function tripShowsJob() {
    var pg = $('trip');
    return !!(pg && !pg.classList.contains('hidden') && document.body.classList.contains('trip-on') && (onPlan(step) || (step === ST_DEPART && priceRefreshActive)));
  }
  function cancelSearch() {
    if (!busy) return;
    jobCancel = true; priceCancelRequested = true; if (window.KeylessGas) KeylessGas.cancel();
      if(window.EVPrices)EVPrices.cancel();
    clearScanPending();
    LG.info('stations', 'Search cancelled');
  }
  /** Leaving the step that shows a running search (Back, the ✕): cancel it, or keep it running in the background. */
  function leaveAsk(go) {
    if (!busy || loadingTrip || !tripShowsJob()) { go(); return; }
    A.confirmDel({ always: true, three: true, title: 'Still finding stations', body: 'Cancel the search, or let it run in the background while you use the rest of the app. Anything that would change it is grayed out until it finishes.',
      no: 'Cancel search', action: 'Run in background', goClass: 'primary' }).then(function (v) {
      if (v === null) return;      // tapped outside: stay
      if (v) { bgJob = true; LG.info('stations', 'Search left running in the background'); } else cancelSearch();
      go(); if (A.jobDraw) A.jobDraw();
    });
  }
  /** Steps closed while a search runs: the ones that would change what it uses (the car, the route), and Stops and
   *  Departure, whose answers it's about to change (Adjustments shows its progress). */
  function jobLocked(k) { return busy && !loadingTrip && (k === ST_GARAGE || k === ST_ROUTE || k === ST_HAZ || k === ST_STOPS || k === ST_DEPART); }
  async function findStops1(force) {
    busy = true;adjustError=''; jobCancel = false; searchCancelled = false; bgJob = false;
    choiceCandidates.clear();      // a new search: per-leg candidates from an earlier one (and their prices) are out of date
    // the map's own search around you gives way: the trip needs the website readers
    if (A.job && A.job() && A.job().kind === 'map') {
      LG.info('stations', 'The map\'s station search stops for the trip\'s'); A.job().cancel();
      for (var w = 0; w < 100 && A.job(); w++) await new Promise(function (r) { setTimeout(r, 100); });
    }
    if (A.jobStart) A.jobStart({ kind: 'trip', label: 'Finding stations', cancel: cancelSearch, inline: tripShowsJob });
    mapLoaded();
    gateTabs();
    try { await findStops0(force); }
    catch (e) {
      if (jobCancel) { searchCancelled = true; LG.info('stations', 'Search stopped: ' + (e.message || e)); }
      else {adjustError=e.message||String(e); LG.error('plan', e.message || String(e)); toastMsg(e.message || String(e)); }
      result = null;
    }
    clearScanPending();busy = false; priceRefreshActive=false;progEnd();
    var shown = tripShowsJob();
    if (A.jobEnd) A.jobEnd(shown ? null : searchCancelled ? { text: 'Station search cancelled' } :
      result && result.plan ? { text: jobCancel ? 'Search cancelled · planned with the stations found so far' : result.plan.ok ? 'Your stops are ready' : 'Stations found; no plan works yet', action: 'Open', onAction: function () { if (document.body.classList.contains('trip-on')) { step = ST_ADJ; renderStep(); } else openTrip(ST_ADJ); } } : null);
    bgJob = false; gateTabs();
    if (!onPlan(step) || !result) mapLoaded();
    if (window.__apiCount) window.__apiCount();
    if (onPlan(step) && !result) renderResults();
    if(step===ST_COMPARE){compareCapture();compareRender();}
  }
  async function findStops0(force, noReplay) {
    scanPending('plan','Choosing stops',100);scanPending('draw','Preparing the map and trip costs',110);
    var cap=Number(S.monthlyCap)||0,exhausted=cap>0&&N.callsThisMonth()>=cap;
    var webRefresh=force==='web';
    var discovering=force==='discover'||force!==true&&(!S.apiKey||S.keylessRegular)&&(noReplay||!savedPriceReplay());
    var wmReplay=webRefresh&&(replay||savedPriceReplay()),wmKnown=wmReplay&&wmReplay.stations,wmNeeded=!webRefresh||wmKnown&&((wmKnown.official||[]).some(function(s){return s.brand==='walmart';})||(wmKnown.google||[]).some(function(g){return (g.list||[]).some(function(s){return s.brand==='walmart';});}));
    if(wmNeeded&&KIND()==='gas'&&A.siteOn('walmart')&&(webRefresh||discovering||force===true||!replay))scanPending('walmart','Checking Walmart website prices',10);
    priceRefreshActive=webRefresh||discovering;priceCancelRequested=false;
    if(step===ST_DEPART&&webRefresh)renderStep();
    if ($('tsResults')) $('tsResults').innerHTML = skelStops('Finding stations');
    if ($('taResults')) $('taResults').innerHTML = skelAdjust('Finding stations');
    prog(0.01, webRefresh?'Starting price refresh · Estimating time…':'Finding stations');
    LG.info('stations', 'Find the best stops pressed', { miles: Math.round(model.totalMi), points: model.pts.length, force: force === true });
    await new Promise(function (r) { setTimeout(r, 30); });
    var others = altCompareList();
    warmChoiceLimits(); // overlap approved-route limits with station discovery, not slider work
    dbg.search = {};
    var models = [model];
    others.forEach(function (k) { try { models.push(T.buildRoute(alts[k], carModel())); } catch (e) { models.push(null); } });
    var okModels = models.filter(Boolean), okKs = [altSel].concat(others).filter(function (k, i) { return models[i]; });
    // Saved-trip refresh is price-only, including the old refresh action after Places runs out.
    var webSummary=null;
    if(webRefresh){
      if(!replay)replay=savedPriceReplay();
      if(!replay||!replay.stations||KIND()!=='gas')throw new Error('Website price refresh needs a saved fuel trip.');
      var refreshingReplay=replay;
      var cloned=JSON.parse(JSON.stringify(replay.stations)),known=cloned.official||[];
      (cloned.google||[]).forEach(function(g){known=known.concat(g.list||[]);});
      var priority=result&&result.plan&&result.plan.stops?result.plan.stops.map(function(s){return s.c.station.id;}):[];
      var priceWork=KeylessGas.refreshKnown(known,function(f,label){prog(0.02+f*0.8,label);},priority,gradeOf());
      if(priceCancelRequested)KeylessGas.cancel();
      webSummary=await priceWork;
      if(replay!==refreshingReplay)throw new Error('The trip changed while prices were loading; no saved trip was overwritten.');
      var at=0;
      cloned.official=(cloned.official||[]).map(function(){return webSummary.stations[at++];});
      (cloned.google||[]).forEach(function(g){g.list=(g.list||[]).map(function(){return webSummary.stations[at++];});});
      cloned.priceRefresh={updated:webSummary.updated,total:webSummary.total,retained:webSummary.retained,at:webSummary.at,websiteLoads:webSummary.websiteLoads,errors:webSummary.errors,cancelled:webSummary.cancelled,grade:webSummary.grade};
      replay.stations=cloned;
      var saved=A.KV.get('trips','trip|'+replay.id);
      if(saved&&saved.v){saved.v.stations=cloned;A.KV.put('trips','trip|'+replay.id,saved.v);}
      dbg.search.keyless=cloned.priceRefresh;
      if(webSummary.blocked)A.showSiteCheck(webSummary.blockedSite||'gasweb',webSummary.blockedSite==='walmart'?'Walmart':webSummary.blockedSite==='murphy'?'Murphy USA':'Google Maps web');
    }
    var rp = (force === true||force==='discover'||noReplay)&&!webRefresh ? null : replay, rpSt = null, partialKs = null;
    if (rp && (KIND() !== 'gas' || (rp.stations.kind || 'gas') !== 'gas')) rp = null;   // saved for another kind of car (or EV stations: the finder's own cache covers them)
    if (rp) {
      // which route each saved station list was for (older saves: worked out from the saved route options)
      rpSt = { official: rp.stations.official, google: (rp.stations.google || []).map(function (g) { return Object.assign({}, g, { sig: g.sig || (rp.alts && rp.alts[g.k] ? altSig(rp.alts[g.k]) : '') }); }) };
      if ((rp.partial || force === 'missing') && !webRefresh) {
        var have = rpSt.google.map(function (g) { return g.sig; }), missKs = okKs.filter(function (k) { return have.indexOf(altSig(alts[k])) < 0; });
        if (missKs.length && missKs[0] === okKs[0]) {
          LG.info('stations', 'A different route than the saved trip used — searching it'); rp = null; rpSt = null;
        } else if (missKs.length) partialKs = missKs;   // your route was searched; only the routes it never covered are
      }
    }
    var ga = null;
    if (partialKs) {
      // the saved trip covers your route and some approved alternatives: search only the others, keep the rest
      LG.info('stations', 'Using the stations saved with this trip (' + agoText(Date.now() - rp.t) + '); searching only the ' + partialKs.length + ' route(s) it never covered');
      var keepKs = okKs.filter(function (k) { return partialKs.indexOf(k) < 0; }), modelOf = function (k) { return okModels[okKs.indexOf(k)]; };
      var kept = await gatherAll(keepKs.map(modelOf), function () { }, {}, false, rpSt, keepKs);
      var legOnly = partialKs.map(function (k) { var a = alts[k]; return legsMode() && a._leg != null ? hzModel(hzAlts(a._leg)[a._sel[a._leg]]) : modelOf(k); });
      var cover = discovering || !S.apiKey || S.keylessRegular ? KeylessGas.discoveryPhases([okModels[0]], legOnly, T, P) : null, missDebug = {};
      scanPending('alternatives', 'Searching approved alternative routes', 20); finishScanPending('alternatives');
      var found = await gatherAll(legOnly, function (f, l) { prog(.02 + f * .85, 'Approved alternatives · ' + l); }, missDebug, S.apiKey && !S.keylessRegular ? false : 'discover-cache', null, partialKs, cover && cover.alternatives);
      var pool = (rpSt.official || []).concat.apply(rpSt.official || [], rpSt.google.map(function (g) { return g.list || []; }));
      var dropX = function (s) { var c = Object.assign({}, s); delete c.detourExact; delete c.detourMi; delete c.detourRange; return c; };
      var proj = { localOnly: true, official: found.raw.official || [], google: partialKs.map(function (k, i) { var a = alts[k], shift = a._leg > 0 ? (modelOf(k).legEnds || [])[a._leg - 1] || 0 : 0;
        return { k: k, sig: altSig(a), list: P.mergeSites(P.reconcileStations(pool.map(dropX).concat((found.raw.google[i] || []).map(function (s) { var c = Object.assign({}, s); if (c.detourRange) c.detourRange = c.detourRange.map(function (d) { return d + shift; }); return c; })))) }; }) };
      var added = await gatherAll(partialKs.map(modelOf), function () { }, {}, false, proj, partialKs);
      added.per.forEach(function (g, i) { g.notes = g.notes.concat(found.per[i].notes || []); });
      var pick = function (k, field) { var i = keepKs.indexOf(k); return i >= 0 ? kept[field][i] : added[field][partialKs.indexOf(k)]; };
      ga = { per: okKs.map(function (k) { return pick(k, 'per'); }), cachedAgeMs: Date.now() - rp.t,
        raw: { official: P.reconcileStations((kept.raw.official || []).concat(added.raw.official || [])), google: okKs.map(function (k) { var i = keepKs.indexOf(k); return i >= 0 ? kept.raw.google[i] : added.raw.google[partialKs.indexOf(k)]; }), kind: 'gas' } };
      dbg.search = { alternatives: missDebug, keyless: missDebug.keyless };
      rp = null;   // saved again below with every route's stations
    }
    if (rp) LG.info('stations', 'Using the stations saved with this trip (' + agoText(Date.now() - rp.t) + ') — no lookups');
    if(!ga&&others.length&&!rpSt)scanPending('alternatives','Searching approved alternative routes',20);
    if(ga){ /* searched only the routes the saved trip never covered (above) */ }
    else if(others.length&&!rpSt){
      var firstDebug={},restDebug={};
      var extraModels=okKs.slice(1).map(function(k,i){var a=alts[k];return legsMode()&&a._leg!=null?hzModel(hzAlts(a._leg)[a._sel[a._leg]]):okModels[i+1];});
      var coverage=discovering?KeylessGas.discoveryPhases([okModels[0]],extraModels,T,P):null;
      if(coverage)LG.info('keyless','Shared primary/alternative coverage',{primaryAreas:coverage.primary.length,alternativeAreas:coverage.alternatives.length,reusedPrimaryAreas:coverage.alternatives.plan.reusedPrimaryAreas});
      var first=await gatherAll([okModels[0]],function(f,l){prog(.02+f*.45,'Primary routes · '+l);},firstDebug,force,null,[okKs[0]],coverage&&coverage.primary);
      var rest;
      if(jobCancel||firstDebug.keyless&&firstDebug.keyless.blocked){rest={per:okModels.slice(1).map(function(){return {cands:[],notes:['Alternative search not started after cancellation or restriction.'],unpriced:0,stale:0,grade:gradeOf()};}),raw:{official:[],google:okModels.slice(1).map(function(){return [];})}};}
      else {
        finishScanPending('alternatives');
        // A multi-leg alternative changes one leg, not the whole trip. Discover
        // only that changed leg, then project the saved union onto full routes.
        var searched=await gatherAll(extraModels,function(f,l){prog(.47+f*.43,'Approved alternatives · '+l);},restDebug,discovering?'discover-cache':false,null,okKs.slice(1),coverage&&coverage.alternatives);
        var baseStations=(first.raw.official||[]).concat.apply(first.raw.official||[],first.raw.google||[]);
        var drop=function(s){var c=Object.assign({},s);delete c.detourExact;delete c.detourMi;delete c.detourRange;return c;};
        // the primary's stations plus the alternatives' own: one copy each (they overlap, and were listed twice)
        var projected={localOnly:true,official:searched.raw.official||[],google:okKs.slice(1).map(function(k,i){var a=alts[k],shift=a._leg>0?(okModels[i+1].legEnds||[])[a._leg-1]||0:0;return {k:k,sig:altSig(a),list:P.mergeSites(P.reconcileStations(baseStations.map(drop).concat((searched.raw.google[i]||[]).map(function(s){var c=Object.assign({},s);if(c.detourRange)c.detourRange=c.detourRange.map(function(d){return d+shift;});return c;}))))};})};
        rest=await gatherAll(okModels.slice(1),function(){},{},false,projected,okKs.slice(1));
        rest.per.forEach(function(g,i){g.notes=g.notes.concat(searched.per[i].notes||[]);});
      }
      dbg.search={primary:firstDebug,alternatives:restDebug,keyless:restDebug.keyless||firstDebug.keyless};
      if(restDebug.keyless&&(restDebug.keyless.cancelled||restDebug.keyless.blocked))first.per[0].notes.push('Alternative discovery was '+(restDebug.keyless.blocked?'restricted':'cancelled')+'; only completed results were kept.');
      ga={per:first.per.concat(rest.per),cachedAgeMs:Math.max(first.cachedAgeMs||0,rest.cachedAgeMs||0),raw:{official:P.reconcileStations((first.raw.official||[]).concat(rest.raw.official||[])),google:first.raw.google.concat(rest.raw.google),kind:first.raw.kind}};
    }else ga=await gatherAll(okModels, function (f, l) { prog(0.02 + f * 0.9, l + (others.length ? ' (' + okModels.length + ' routes)' : '')); }, dbg.search, force, rpSt, okKs);
    choicePool=ga.raw;
    choiceCandidates.clear();ga.per.forEach(function(g,i){cacheChoiceCandidates(alts[okKs[i]],okModels[i],g);});
    // cancelled: website discovery hands back what it finished (planned with, and noted); anything else stops here
    if (jobCancel && !(dbg.search.keyless && dbg.search.keyless.cancelled) && !webRefresh) throw new Error('cancelled while finding stations');
    if (rp) ga.cachedAgeMs = Date.now() - rp.t;
    else { try { saveTrip(ga.raw, okKs); } catch (e) { LG.warn('history', 'Couldn\'t save the trip', String(e)); } }
    var g = ga.per[0];
    var refreshInfo=webSummary||rp&&rp.stations.priceRefresh;
    if(refreshInfo)g.notes.push((refreshInfo.cancelled?'Cancelled website refresh: ':'Website refresh: ')+refreshInfo.updated+'/'+refreshInfo.total+' saved stations matched'+(refreshInfo.grade?' for '+refreshInfo.grade:'')+'; '+refreshInfo.retained+' left unchanged. No new stations discovered; no Places or Routes API calls for that refresh. Website retrieval is not a pump-price update timestamp.');
    if(refreshInfo)g.notes=g.notes.concat(refreshInfo.errors||[]);
    var cands = g.cands, notes = g.notes, unpriced = g.unpriced, stale = g.stale, grade = g.grade;
    finishScanPending('plan');prog(0.93, 'Choosing stops');
    if (step >= ST_ADJ) mapLoading('Choosing stops', 0.93);
    var startGal = startFuel(model);
    var opts = makeOpts(model, cands, startGal), planOffs = null;
    var secs0 = flatSecs(model), sf0 = !speedOff() && secs0.length && Garage.speedFn ? Garage.speedFn() : null;
    if (sf0) {
      var offs0 = secs0.map(function (sc) { return Garage.ruleOff(sc.limit); });
      planOffs = offs0.join(',');
      if (offs0.some(function (v) { return v; })) opts.model = T.withSpeeds(model, T.speedRates(secs0, offs0, sf0.f, sf0.lo, sf0.hi));
    }
    await paint();
    var t0 = Date.now();
    var plan = await planAsync(opts), estUsed = 0;
    // nothing priced in reach somewhere (very rural): let stations with no posted price fill the gap, at an estimate
    if ((!plan.ok || plan.firstDip) && g.unpricedCands && g.unpricedCands.length) {
      var oEst = Object.assign({}, opts, { cands: cands.concat(g.unpricedCands) });
      var pEst = await planAsync(oEst);
      if (pEst.ok && (!plan.ok || !pEst.firstDip)) {
        plan = pEst; opts = oEst; cands = oEst.cands; estUsed = pEst.stops.filter(function (x) { return x.c.est; }).length;
        LG.info('plan', 'Used ' + estUsed + ' station(s) with no posted price (nothing priced in reach)');
      }
    }
    // the saved trip's stations can't make this route work (another route than it searched, or too few in reach):
    // find the stations along it, the same way a new trip would
    if (!plan.ok && rp && !webRefresh && !rpSt.google.some(function (g) { return g.sig === altSig(alts[altSel]); })) {
      LG.info('plan', 'The saved stations can\'t plan this route; finding stations along it', { candidates: cands.length, reachMi: plan.reachMi });
      return findStops0(force, true);
    }
    LG.info('plan', plan.ok ? 'Planned ' + plan.stops.length + ' stop(s) in ' + (Date.now() - t0) + ' ms' : 'No workable plan', {
      candidates: cands.length, unpriced: unpriced, stale: stale, tooFar: plan.tooFar, reachMi: plan.reachMi,
      stops: plan.ok ? plan.stops.map(function (s) { return { name: s.c.station.name, mile: Math.round(s.c.d), price: s.c.price, buy: Math.round(s.buyGal * 10) / 10, why: s.why }; }) : null });
    LG.debug('plan', 'Candidates', cands.map(function (c) { return [c.station.name, Math.round(c.d), c.price, Math.round(c.detourMi * 10) / 10]; }));
    result = { plan: plan, opts: opts, cands: cands, notes: notes, unpriced: unpriced, stale: stale, grade: grade, startGal: startGal,
      topMi: S.trip.topUpMi, topSel: -1, bufMi: tripBuf(), cachedAgeMs: ga.cachedAgeMs, fromHistory: !!rp, planOffs: planOffs, estUsed: estUsed };
    if(routeFlow())result.routes=[{k:altSel,model:model,res:result}];
    finishScanPending('draw');prog(0.97, 'Drawing the map');
    await paint();
    var t1 = Date.now();
    recompute();
    LG.debug('plan', 'Top-ups, trip cost and drive back in ' + (Date.now() - t1) + ' ms');
    startSweep();startDetSweep(); // don't hold primary previews behind alternative-route plans
    // other routes Google suggested: same trip, same rules, gas valued at the same price so totals compare fairly
    if (others.length) {
      result.routes = [{ k: altSel, model: model, res: result }];
      var gi = 1, jobs = [];
      // every other route planned at once across the planner pool (one after another took about a minute)
      for (var oi = 0; oi < others.length; oi++) {
        var k = others[oi], m2 = models[oi + 1];
        if (!m2) { jobs.push({ k: k, error: true }); continue; }
        var g2 = ga.per[gi++], o2 = makeOpts(m2, g2.cands, startGal,alts[k]);
        if (plan.ok) o2.refPrice = plan.refPrice;
        jobs.push({ k: k, m2: m2, g2: g2, o2: o2, p: planAsync(o2) });
      }
      for (var ji = 0; ji < jobs.length; ji++) {
        var jb = jobs[ji];
        if (jb.error) { result.routes.push({ k: jb.k, model: model, res: { plan: { ok: false } }, error: 'couldn\'t read that route' }); continue; }
        var p2 = await jb.p;
        result.routes.push({ k: jb.k, model: jb.m2, res: { plan: p2, opts: jb.o2, cands: jb.g2.cands, notes: jb.g2.notes, unpriced: jb.g2.unpriced, stale: jb.g2.stale, grade: jb.g2.grade,
          startGal: startGal, topMi: S.trip.topUpMi, topSel: -1, bufMi: tripBuf(), cachedAgeMs: ga.cachedAgeMs } });
      }
      LG.info('routes', 'Other routes checked', compareRoutes().map(function (c) { return { via: c.via, saves: c.saves && Math.round(c.saves * 100) / 100, extraMin: Math.round(c.extraMin), ok: c.ok, worth: c.worth }; }));
    }
    startSweep();
    busy = false;priceRefreshActive=false;
    progEnd();
    await breathe();
    var t2 = Date.now();
    if (step >= ST_ADJ) showResult();
    LG.debug('plan', 'Results drawn in ' + (Date.now() - t2) + ' ms');
  }
  /** Top-ups, trip cost, and the drive back — cheap to redo when you change the top-up choice. */
  function recompute() {
    var r = result, p = r.plan, o = r.opts;
    r.tops = p.ok && S.trip.arrive === 'full' ? T.topUps(Object.assign({}, o, { cands: p.cands }), p, r.topMi).slice(0, 4) : [];
    if (r.topSel >= r.tops.length) r.topSel = -1;
    var top = r.topSel >= 0 ? r.tops[r.topSel] : null;
    r.top = top;
    if (!p.ok) { r.acc = null; return; }
    var outLeg = { stops: T.purchases(p), arriveGal: p.arriveGal };
    if (top) { outLeg.stops.push({ arriveGal: top.arriveGal, buyGal: top.buyGal, price: T.purchasePrice(top) }); outLeg.arriveGal = top.endGal; }
    var legs = [outLeg];
    r.startPrice = startRate(p);
    r.acc = T.account(r.startGal, r.startPrice, legs);
  }
  function dedupe(list) { var seen = {}; return list.filter(function (s) { if (seen[s.id]) return false; seen[s.id] = 1; return true; }); }

  // ---------- step 3 (Stops): the plan ----------
  /** Redraw whatever step is showing with the current plan. */
  function showResult() {
    if ($('trip') && $('trip').classList.contains('hidden')) return;    // finished in the background: shown when the trip opens again
    document.body.classList.add('trip-on');
    if (onPlan(step) && ($('tsResults') || $('taResults'))) { renderResults(); drawSoon(); }
    else if (step === ST_DEPART) renderStep();
  }
  /** Draw the route and stops once the list is on screen (the map takes a moment on a long trip). */
  function drawSoon() {
    var r0 = result;
    requestAnimationFrame(function () { setTimeout(function () {
      if (result !== r0 || !onPlan(step)||$('trip').classList.contains('hidden')) return;
      if(!recommendationActive())drawRoute();else{layer.clearLayers();drawn={};} fitBtn(); if (!busy&&!choicePlanning) mapLoaded();
    }, 0); });
  }
  var BULB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z"/></svg>';
  function tipBox() {
    return '<div class="tipbox">' + BULB + '<div><b>Tip:</b> A <b>shorter buffer</b> gives you more range, so you can reach cheap stations right off the highway. ' +
      'A <b>longer max detour</b> lets cheaper stations farther off the route count, but only if they save more money than the extra miles cost.</div></div>';
  }
  function renderResults() {
    var el = $('tsResults'), ea = $('taResults'); if (!el && !ea) return;
    clearRecommendationMaps();
    if(recommendationActive()&&result&&result.plan.ok){startRecommendations();el.innerHTML=recommendationsHtml();bindRecommendations();return;}
    var put = function (sh, ah) { if (el) el.innerHTML = sh; if (ea) ea.innerHTML = ah == null ? sh : ah; };
    var r = result;
    if(adjustError&&!busy){put('<div class="msg err">'+esc(adjustError)+'</div>');routeGate();return;}
    [ST_ADJ, ST_STOPS].forEach(function (k) { if (built[k]) { built[k].result = result; built[k].model = model; } });
    if (!r && loadingTrip) { put(skelStops('Opening your trip'), skelAdjust('Opening your trip')); return; }
    if (!r && busy && model) { put(skelStops('Finding stations'),skelAdjust('Finding stations'));return; }
    if (!r) {
      var need = hasFuel();
      put(model ? '<div class="card empty-res">' + (need ? 'Stops appear here.' : 'Say how much is in your tank in Parameters.') + '</div>' : '',
        model ? '<div class="card empty-res">' + (searchCancelled ? 'Station search cancelled. <button class="btn primary sm" id="tFindAgain">Find stations</button>' : need ? 'Your adjustments appear here once the stops are planned.' : 'Say how much is in your tank in Parameters.') + '</div>' : '');
      if ($('tFindAgain')) $('tFindAgain').onclick = function () { searchCancelled = false; findStops(); };
      return;
    }
    var p = r.plan, h = '', ah = refreshCard()+tipBox();
    if(!p.ok&&KIND()==='ev'){startEVRecovery();evFailureNotice();if(step===ST_STOPS&&evRecovery&&evRecovery.base===result){if(el)el.innerHTML=evRecoveryHtml();bindEVRecovery();routeGate();return;}}
    // warnings first: what could go wrong on this trip
    var w = [];
    if(p.propulsion){var ef=p.propulsion.flags||[];w.push({t:KIND()==='h2'?'Hydrogen speed estimates are unvalidated; weather effects on consumption are unknown.':'EV energy, charging time and losses are estimates. '+(ef.some(function(x){return /^weather_/.test(x);})?'Hourly temperatures are missing for part of this trip; those sections use 20°C. ':'' )+'Confirm charging access and rates before travel.'});}
    if (!p.ok) {
      var gap='No plan keeps you above a '+r.bufMi+'-mile buffer. '+(p.reachMi>0?'The current station list cannot bridge the gap past mile '+Math.round(p.reachMi)+'.':'No usable stop is reachable within your current range and detour limit.');
      if(KIND()==='ev'){
        var reachable=(r.cands||[]).filter(function(c){return r.opts.model.galTo(c.d)+(c.detourMi||0)*r.opts.model.cityGpm/2<=r.startGal;}).sort(function(a,b){return a.detourMin-b.detourMin;});
        if(!p.reachMi&&reachable.length&&reachable[0].detourMin>r.opts.maxDetourMin)gap+=' A reachable charger needs about '+Math.ceil(reachable[0].detourMin)+' min of extra driving; your limit is '+r.opts.maxDetourMin+' min.';
        gap+=' Check the selected charger types in Parameters → Charging stops, the detour limit and starting charge. Discovery errors below mean coverage is incomplete—not that chargers do not exist.';
      }else gap+=' Try a smaller buffer or check the miles left.';
      var energyErrors={charge_timeout:'Charging would exceed the estimate’s time limit. Try faster chargers or another route.',charger_power_insufficient:'The selected charger cannot supply the estimated charging and cabin/cooling load. Try another charger type.',weather_reserve_violated:'Weather-adjusted energy use would breach your buffer. Review starting charge, buffer and available chargers.',energy_exhausted:'The weather-adjusted estimate runs out of energy before the next stop. Review range and chargers.'};
      w.push({err:1,t:energyErrors[p.propulsionReason]||p.propulsionReason||gap});
    }
    if (p.ok && p.firstDip && p.stops.length) w.push({ t: 'You\'ll reach stop 1 below '+('your '+r.bufMi+'-mile buffer')+' (~' + Math.round(p.stops[0].arriveGal / model.combGpm) + ' mi left).' });
    if(p.ok&&p.firstDip&&!p.stops.length&&(p.destinationCharges||[]).length)w.push({t:'The first destination is reached below your chosen buffer. Increase starting charge or adjust the route; destination charging cannot help before arrival.'});
    if(KIND()==='ev'&&p.ok&&p.priceFreshFallback&&p.stops.length)w.push({t:'Recent charger prices could not cover this trip. Some prices may be older than your '+(+S.evPriceAgeHours||24)+'-hour preference or have no price-check date.'});
    if (r.estUsed) w.push({ t: r.estUsed + ' stop' + (r.estUsed === 1 ? ' is at a station' : 's are at stations') + ' with no posted price — nothing priced is in reach there. Its price is an estimate (marked est.).' });
    if (r.stale) w.push({ t: r.stale + ' price' + (r.stale === 1 ? ' is' : 's are') + ' over ' + S.staleHours + ' hours old (marked).' });
    (r.notes||[]).concat(evRecovery&&evRecovery.base===r?Array.from(new Set(evRecovery.errors)):[]).forEach(function (n) { w.push({ t: n }); });
    var wm = $('wmCheck'); if (wm && !wm.classList.contains('hidden')) w.push({ t: $('wmCheckTitle').textContent + ' before its prices can load.', html: ' <a href="#" id="tsSiteCheck">Open</a>' });
    if (r.cachedAgeMs > 0) w.push({ t: r.fromHistory ? 'Saved trip · original discovery from ' + agoText(r.cachedAgeMs) + ' (no lookups used).' : 'Prices from ' + agoText(r.cachedAgeMs) + '.', cls: 'saved' });
    var warnHtml = w.length ? '<div class="warns pre">' + w.map(function (x) { return '<div class="' + (x.err ? 'msg err' : 'note') + (x.cls ? ' ' + x.cls : '') + '">' + esc(x.t) + (x.html || '') + '</div>'; }).join('') + '</div>' : '';
    if (!p.ok) {
      h += warnHtml + routeBox();
      ah = warnHtml + refreshCard();   // only the errors, plus a new search (it can fix them); no sliders or tips
    } else {
      var t = p.totals;
      h += warnHtml;
      if(p.rewardTimingUncertain)h+='<div class="msg">Monthly CITGO specials omitted: stop timing is too close to a date change to count them reliably.</div>';
      h += costEst();
      var whyN = r.cands.length + ' priced station' + (r.cands.length === 1 ? '' : 's') + ' along your route' +
        (p.tooFar ? '; ' + p.tooFar + ' more were over ' + S.trip.maxDetourMin + ' min out of the way' : '') +
        (r.unpriced ? '; ' + r.unpriced + ' had no ' + gradeLabel(r.grade).toLowerCase() + ' price' : '') + (p.cands.some(function(c){return c.citgo;})?'. CITGO monthly rewards and purchase quantities are weighed across the entire trip; a simple station-for-station price comparison would miss later reward changes.':'. Tap a stop for the cheaper stations it was weighed against.');
      if (p.stops.length) {
        var shut = r.stopsShut !== false;
        h += '<div class="sec-row"><button class="sec-h" id="tsStopsH" aria-expanded="' + !shut + '"><span>' + p.stops.length + ' fuel stop' + (p.stops.length === 1 ? '' : 's') +
          '<small>chosen from ' + r.cands.length.toLocaleString() + ' station' + (r.cands.length === 1 ? '' : 's') + '</small></span><span class="chev' + (shut ? '' : ' up') + '"></span></button>' + A.qBtn(whyN) + '</div>';
        if (!shut) { h += '<div class="stops-list">'; p.stops.forEach(function (s, i) { h += stopCard(s, i); }); h += '</div>'; }
      } else h += '<div class="msg ok">'+(KIND()==='ev'?'No public charging stop needed':'No stop needed')+' — checked ' + r.cands.length.toLocaleString() + ' stations.</div>';
      if(!routeFlow())h += routeBox();
      h += '<div class="gas-tiles">' + idealBox() + arriveBox() + '</div>';
      h += A.gAttr();                                   // the route, and most stations, come from Google
      // Adjustments: the buffer, max. detour and speeds (and the optional top-up)
      ah += bufBox();ah += detBox();ah += '<div class="spdbox" data-trip-speed></div>';if (S.trip.arrive === 'full') ah += topUpBox();
    }
    put(h, ah);
    var both = tpBody();
    if ($('tsRefresh')) $('tsRefresh').onclick = function (e) { e.preventDefault(); findStops(true); };
    if ($('tsWebRefresh')) $('tsWebRefresh').onclick = function (e) { e.preventDefault(); findStops('web'); };
    if ($('tsSiteCheck')) $('tsSiteCheck').onclick = function (e) { e.preventDefault(); $('wmCheckGo').click(); };
    both.querySelectorAll('[data-top]').forEach(function (b) {
      b.onclick = function () { var k = +b.dataset.top; r.topSel = r.topSel === k ? -1 : k; recompute(); keepScroll(showResult); };
    });
    if ($('tsTopMi')) $('tsTopMi').addEventListener('change', function () {
      r.topMi = Math.max(0, Math.round((parseFloat(this.value) || 0) * 10) / 10); S.trip.topUpMi = r.topMi; A.save(); r.topSel = -1; recompute(); keepScroll(showResult);
    });
    both.querySelectorAll('[data-route]').forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); switchRoute(+b.dataset.route); };
    });
    bindBuf(); bindDet();
    if (p.ok) {renderTripSpeed();startDetSweep();}
    if ($('tsStopsH')) $('tsStopsH').onclick = function () { r.stopsShut = r.stopsShut === false; keepScroll(showResult); };
    bindStops();
    if (A.qify) { if (el) A.qify(el); if (ea) A.qify(ea); }
    sheetSize();
    routeGate();
  }

  // ---------- step 4 (Departure) ----------
  function exports() {
    var r = result, p = r && r.plan; if (!p || !p.ok) return null;
    var fuelStops = p.stops.concat(r.top ? [{ c: r.top.c }] : []);
    return { one: T.exportUrl(route, fuelStops, model), legs: T.exportLegs(route, fuelStops, model) };
  }
  var MAPS_ICON = '<svg viewBox="0 0 24 24"><path d="M21.71 11.29l-9-9a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42l9 9a1 1 0 0 0 1.42 0l9-9a1 1 0 0 0 0-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>';
  var SHARE_ICON = '<svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a3.2 3.2 0 0 0 0-1.39l7.05-4.11A2.99 2.99 0 1 0 15 5c0 .24.04.47.09.7L8.04 9.81a3 3 0 1 0 0 4.38l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z"/></svg>';
  function glue(t) { return String(t).replace(/(\d) (?=[a-z])/g, '$1\u00a0'); }   // "5 h 0 min" wraps as "5 h" / "0 min", never "5 h 0" / "min"
  var departScope='trip',departLeg=0,departOwner=null;
  function departureHtml() {
    var r = result; if (!r || !model) return '<div class="card empty-res">Plan your stops first.</div>';
    if(priceRefreshActive)return skelStops('Refreshing saved prices');
    var p = r.plan;
    if(departOwner!==route){departOwner=route;departScope='trip';departLeg=0;}
    var legCount=route.stops.length-1;departLeg=Math.max(0,Math.min(legCount-1,departLeg));
    var byLeg=p.ok&&departScope==='leg'&&legCount>1,summary=byLeg?T.legSummaries(r.opts.model||model,p,r.startGal,r.startPrice,r.top,r.opts.fuelKind)[departLeg]:null;
    var chooser=legCount>1?'<div class="seg depart-scope" role="group" aria-label="Summary scope"><button type="button" data-depart-scope="trip" class="'+(departScope==='trip'?'on':'')+'">Whole trip</button><button type="button" data-depart-scope="leg" class="'+(departScope==='leg'?'on':'')+'">Per leg</button></div>'+(departScope==='leg'?'<label for="tDepartLeg">Summary for</label><select id="tDepartLeg">'+route.stops.slice(1).map(function(_,i){return '<option value="'+i+'"'+(i===departLeg?' selected':'')+'>Leg '+(i+1)+' · '+esc(legName(route,i))+'</option>';}).join('')+'</select>':''):'';
    var stops=summary?summary.stops:p.ok?p.totals.stops+(r.top?1:0):0,charging=summary?(KIND()==='ev'?summary.chargingMin:summary.refuelingMin):p.ok?serviceMin(p,r.opts.fuelKind)+(r.top?T.serviceMinutes(r.top,r.opts.fuelKind):0):0;
    var h = '<div class="card dep-route">' + numList(route.stops)+chooser+(rawRoute&&rawRoute.websiteApproximate?'<div class="lead small keep">Website route · approximate '+A.qBtn('Verify this route in Google Maps before driving. Website geometry and traffic-inclusive timing make fuel, detour and time estimates less precise than API routing.')+'</div>':'') + '</div>' +
      // the trip at a glance, as tiles between the places and the costs
      '<div class="kpis dep-facts"><div><b>' + Math.round(summary?summary.miles:model.totalMi).toLocaleString() + '</b><span>miles</span></div>' +
      '<div><b>' + glue(fmtDur(summary?summary.drivingSec:(r.opts.model||model).durationSec)) + '</b><span>driving</span></div>' +
      (p.ok ? '<div><b>' + stops + '</b><span>' + (KIND() === 'ev' ? 'charging' : 'fuel') + ' stop' + (stops === 1 ? '' : 's') + '</span></div>' : '') +
      (p.ok ? '<div><b>~' + glue(fmtDur(charging * 60)) + '</b><span>'+(KIND()==='ev'?'charging':'refueling')+' '+A.qBtn(KIND()==='ev'?'Estimated charging time, excluding queues.':'Estimated pumping time at 8 gal/min for liquid fuel or 1 kg/min for hydrogen. Trip comparisons also allow 3 minutes per stop for payment and nozzle setup, plus detours. Queues, breaks and slow equipment are not included.')+'</span></div>' : '') + '</div>';
    if (!p.ok) return h + '<div class="msg err">No plan works yet — go back to Stops.</div>';
    var t = p.totals, out = summary||r.acc.legs[0];
    var costQ = summary?'Fuel or energy used on this leg, valued at the running average cost in your tank or battery. Purchases at a destination belong to the leg arriving there.':'The ' + out.burnGal.toFixed(1) + ' ' + UN() + ' this drive uses: what\'s already in your ' + (KIND() === 'ev' ? 'battery' : 'tank') + ' at ' + priceText(r.startPrice) + '/' + UN() +
      (parseFloat(S.trip[tankPriceKey()]) > 0 ? ' (what you said it cost)' : KIND() === 'ev' && evRates && evRates.all ? ' (the typical published rate of this route\'s chargers; set yours in Parameters)' : ' (typical on this route; set yours in Parameters)') + ', plus what you buy at what you pay.';
    var saveQ = 'Compared with filling up at the typical price on this route.' +
      (p.easy && p.savings > 0.005 ? ' The easiest plan (fewest stops, closest to the road) would be ' + money(p.easy.totals.net) + ' net vs. ' + money(t.net) + ' for this one' + (t.detourMin - p.easy.totals.detourMin > 0.5 ? ', which adds ' + Math.round(t.detourMin - p.easy.totals.detourMin) + ' min of detours' : '') + '.' : '') +
      (p.minStops != null && t.stops > p.minStops ? ' You only need ' + p.minStops + ' stop' + (p.minStops === 1 ? '' : 's') + '; the extra one pays for itself with cheaper gas.' : '');
    h += '<div class="kpis four"><div><b>' + money(out.cost) + '</b><span>'+(summary?'leg':'trip')+' cost ' + A.qBtn(costQ) + '</span></div>' +
      '<div><b>' + money(out.spend) + '</b><span>' + (KIND() === 'ev' ? 'at chargers' : 'at the pump') + '</span></div>' +
      (summary?'<div><b>'+out.burnGal.toFixed(1)+' '+UN()+'</b><span>used</span></div>':'<div><b class="' + (p.savings > 0.005 ? 'good' : '') + '">' + (p.savings != null && p.savings > 0.005 ? money(p.savings) : '—') + '</b><span>saved ' + A.qBtn(saveQ) + '</span></div>') +
      '<button class="kpi-share" id="tShare" aria-label="Share trip">' + SHARE_ICON + '<span>Share</span></button></div>' + costEst();
    // only what to watch out for, briefly
    var w = [];
    var fd = !S.trip.departNow && futureDepart();
    if (fd && fd.getTime()>Date.now()) w.push('Leaving ' + fd.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' — prices may change by then.');
    var av = ['tolls', 'highways', 'ferries'].filter(function (k) { return S.trip.avoid[k]; });
    if (av.length) w.push('Turn “avoid ' + av.join('” and “avoid ') + '” back on in Google Maps.');
    var rn = window.Advisory ? Advisory.departureNote() : '';
    if (rn) w.push(rn);
    if (KIND() === 'h2') w.push('Hydrogen stations go offline often — check each one\'s live status before you count on it.');
    h += '<div class="warns">' + w.map(function (x) { return '<div class="note">' + esc(x) + '</div>'; }).join('') + '</div>';
    h += '<p class="lead small keep center"><a href="#" id="tsReport">Troubleshooting report</a></p>';
    return h;
  }

  // ---------- step 4: Hazards — each leg's route, picked on the big map with the weather and hazards along each one ----------
  // Every option for the leg is drawn; each hazard is a colored stretch where and when you'd be in it (RouteWx.forRoute),
  // labeled on the chosen route only. Departure shows the chosen routes' stretches, without labels.
  var wxFlight=new Map();
  function wxGet(url) {       // forecasts 45 min, warnings 10 min, NWS grid/zone geography 30 days
    var o = A.KV.get('wx', url, /weather\.gov\/(?:points|zones)\//.test(url) ? 30 * 864e5 : /weather\.gov\/alerts/.test(url) ? 10 * 60e3 : 45 * 60e3);
    if (o) return Promise.resolve(o.v);
    if(wxFlight.has(url))return wxFlight.get(url);
    var pending=call('fetchJson', url).then(function (r) { if (r && r.body) {var valid=true;if(/weather\.gov\/zones\//.test(url))try{var g=JSON.parse(r.body).geometry;valid=!!(g&&/^(?:Multi)?Polygon$/.test(g.type)&&g.coordinates&&g.coordinates.length);}catch(e){valid=false;}if(valid)A.KV.put('wx', url, r);} return r; }).finally(function(){wxFlight.delete(url);});wxFlight.set(url,pending);return pending;
  }
  function wxWhen(a, b) {
    var day = function (t) { return new Date(t).toDateString(); }, multi = day(a) !== day(Date.now()) || day(b) !== day(a);
    var f = function (t, wd) { return new Date(t).toLocaleString([], wd ? { weekday: 'short', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' }); };
    return b - a < 10 * 60e3 ? 'around ' + f(a, multi) : f(a, multi) + '–' + f(b, day(b) !== day(a));
  }
  var hzLeg = 0, hzLayer = L.layerGroup(), hzDepLayer = L.layerGroup(), hzLeaders = L.layerGroup(), hzTips = [], hzLines = [], hzCache = new WeakMap(), hzModels = new WeakMap(), countiesP = null;
  if (!map.getPane('hzpane')) { var hzp = map.createPane('hzpane'); hzp.style.zIndex = 420; hzp.style.pointerEvents = 'none'; }
  function legsMode() { return !!(multiLeg(route) && route.legs && route.legs.length && route.legs.every(function (L) { return L.alts; })); }
  function hzLegs() { return legsMode() ? route.legs.length : (alts.length ? 1 : 0); }
  function hzAlts(i) { return legsMode() ? (route.legs[i] || {}).alts || [] : alts; }
  function hzSel(i) { return legsMode() ? (route.legs[i] || {}).sel || 0 : altSel; }
  /** When you'd start leg i: when you leave, plus the legs before it (the way back: your "head back" time, if later). */
  function hzDepart(i) {
    var t = departAt().getTime();
    for (var j = 0; j < i; j++) { var a = hzAlts(j)[hzSel(j)]; t += parseFloat(String(a && a.duration || '0')) * 1000; }
    if(i>0){var delay=0;if(result&&result.plan.ok){delay=result.plan.stops.filter(function(s){return (s.c.leg||0)<i;}).reduce(function(n,s){return n+T.stopDelay(result.opts,s);},0)+(result.plan.destinationCharges||[]).filter(function(c){return c.index<i;}).reduce(function(n,c){return n+c.minutes;},0);}else if(KIND()==='ev'&&window.EVCharging&&model)try{delay=EVCharging.policies(S.trip,route.stops,Garage.car(),model,Garage.tank(),S.evPrice).filter(function(c){return c.index<i;}).reduce(function(n,c){return n+T.destinationCharge(c,tripBuf()*model.combGpm,Garage.tank()).minutes;},0);}catch(e){}t+=delay*60000;}
    if (i > 0 && i === hzLegs() - 1 && S.trip.returnTrip && !backAuto() && S.trip.backAt) { var b = new Date(S.trip.backAt).getTime(); if (b > t) t = b; }
    return t;
  }
  function hzModel(a) { var car=carModel(),key=JSON.stringify(car),hit=hzModels.get(a); if (!hit||hit.key!==key) { hit={key:key,model:T.buildRoute(a,car)}; hzModels.set(a,hit); } return hit.model; }
  function loadCounties() {
    if (window.US_COUNTIES) return Promise.resolve();
    if (!countiesP) countiesP = new Promise(function (ok) { var sc = document.createElement('script'); sc.src = 'counties.js'; sc.onload = ok; sc.onerror = function () { countiesP = null; ok(); }; document.head.appendChild(sc); });
    return countiesP;
  }
  // Live "Now" must not invalidate completed work every minute. Reuse for ten minutes;
  // explicitly selected departure/earlier-leg timing changes still invalidate immediately.
  function hzEntry(a, i) { var d = Math.round(hzDepart(i) / 6e4), e = hzCache.get(a), live = !!S.trip.departNow;
    var timing=[];for(var j=0;j<i;j++)timing.push(hzSel(j)+':'+String((hzAlts(j)[hzSel(j)]||{}).duration));
    var key=timing.join('|')+'|'+(S.trip.returnTrip&&!backAuto()?S.trip.backAt||'':'')+(KIND()==='ev'?'|'+JSON.stringify(S.trip.evDestinations||null)+'|'+JSON.stringify(result&&result.plan.ok?(result.plan.destinationCharges||[]).map(function(c){return Math.round(c.minutes);}):[]):'');
    if (!e || e.live !== live || e.timeKey!==key || (live ? Math.abs(e.d-d)>=10 : e.d!==d)) { e = { d: d, live:live, timeKey:key, st: null }; hzCache.set(a, e); } return e; }
  function hzWarm() { if (aiCan() && Severity.state()==='idle') Severity.compare('warm up', {a:['warm up']}); }
  async function hzPreload() { hzWarm();var owner=route,next=0,count=hzLegs();async function lane(){while(next<count&&route===owner)await hzLoadLeg(next++);}await Promise.all([lane(),lane(),lane()]); }
  async function hzLoad(a, i) {
    var e = hzEntry(a, i); if (e.st) return e.promise || e;
    e.st = 'loading'; var t0 = Date.now();
    e.promise = (async function () {
    try {
      var r = await RouteWx.forRoute(hzModel(a), wxGet, { depart: e.d * 6e4,stops:KIND()==='ev'&&result&&result.plan.ok?evDelays(result.plan,result.opts.model,result.opts,choiceSelections())[i]:[], stateAt: window.Limits && Limits.stateAt, counties: loadCounties, onProg: function (f) { e.prog = f; hzBars(); },
        countyOf: function (f) { return window.US_COUNTIES && US_COUNTIES[f]; }, compare: window.Severity && Severity.state && Severity.state() === 'ready' ? Severity.compare : null,   // never waits for the model to load
        digestMs: e.aiTry ? 60000 : null });    // the re-read once the model is ready: it may be queued behind recalls, so it gets a minute
      e.st = 'done'; e.hz = r.hazards; e.stats = r.stats; e.reading = r;
      var warningIds=new Set(r.hazards.filter(function(x){return x.src==='nws';}).map(function(x){return x.id;}));
      if(warningIds.size)LG.debug('wx','Warning locations',(r.alerts||[]).filter(function(x){return warningIds.has(x.id);}).map(function(x){return {event:x.event,area:x.area,zones:x.zones,headline:x.headline,text:x.text.slice(0,1000),location:x.polys&&x.polys.length?'warning polygon':x.zonePolys&&x.zonePolys.length?'NWS zone':x.zoneBased?'unverified county vicinity':'county'};}));
      // no model coming, or it already had its one re-read: the wording is the answer (never read again and again)
      if (!aiCan() || e.aiTry) { if (e.stats.aiPending) LG.info('wx', 'Warnings kept as read from their wording', { pending: e.stats.aiPending }); e.stats.aiPending = 0; e.hz.forEach(function (x) { x.aiPending = false; }); }
      if (e.stats.aiPending) hzAiWatch(a, i);
      LG.info('wx', 'Hazards on ' + (a.description ? 'via ' + a.description : 'a route') + ' in ' + (Date.now() - t0) + ' ms', { stats: r.stats, hazards: r.hazards.map(function (x) { return [x.kind, x.level, Math.round(x.fromMi), Math.round(x.toMi), x.event || '', x.by || '',x.areaSource||''].filter(function (v) { return v !== ''; }); }) });
    } catch (err) { e.st = 'error'; e.err = String(err && err.message || err); LG.warn('wx', 'Hazards along a route failed', e.err); }
    return e;
    })();
    return e.promise;
  }
  /** Can the on-phone model still read warnings (not failed, not missing)? */
  function aiCan() { return !!(window.Severity && Severity.state && Severity.state() !== 'failed' && !(window.__mocks && __mocks.severity)); }
  /** Routes whose warnings were read by their wording while the model was busy: read again once it's ready. */
  var hzAiWait = [], hzAiT = 0, hzAiKick = false;
  function hzAiWatch(a, i) {
    var entry=hzCache.get(a);if(!hzAiWait.some(function(w){return w.e===entry;}))hzAiWait.push({ a: a, i: i, e:entry });
    if (hzAiT) return;
    hzAiT = setInterval(async function () {
      if (!aiCan()) { clearInterval(hzAiT); hzAiT = 0; hzAiWait.forEach(function (w) { var e = hzCache.get(w.a); if (e && e.stats) { e.stats.aiPending = 0; (e.hz || []).forEach(function (x) { x.aiPending = false; }); } }); hzAiWait = []; if (step === ST_HAZ) renderHz(); return; }
      if (Severity.state() !== 'ready') { if (!hzAiKick && Severity.state() === 'idle') { hzAiKick = true; Severity.compare('warm up', { a: ['warm up'] }); } return; }
      clearInterval(hzAiT); hzAiT = 0;
      var todo = hzAiWait; hzAiWait = [];
      LG.info('wx', 'The model is ready: reading ' + todo.length + ' route(s) warnings again');
      for (var k = 0; k < todo.length; k++) {
        var e = todo[k].e; if (hzCache.get(todo[k].a)!==e || e.st !== 'done' || !e.stats.aiPending || e.aiTry) continue;
        e.aiTry=1; e.aiRating=true;
        if(step===ST_HAZ&&hzLeg===todo[k].i)renderHz();
        try { var rated=await RouteWx.rerate(e.reading,Severity.compare,window.US_COUNTIES&&function(f){return US_COUNTIES[f];},60000); e.hz=rated.hazards;e.stats=rated.stats; }
        catch(err){LG.warn('wx','AI warning rating failed; keeping wording',String(err&&err.message||err));}
        if(e.stats.aiPending)LG.info('wx','AI did not finish; keeping warnings as read from their wording',{pending:e.stats.aiPending});
        e.aiRating=false;e.stats.aiPending=0;(e.hz||[]).forEach(function(x){x.aiPending=false;});
        if (step === ST_HAZ && hzLeg === todo[k].i) { renderHz(); drawHaz(); }
      }
    }, 2000);
  }
  /** Look up every option on leg i (the chosen one first), redrawing as each comes in. */
  async function hzLoadLeg(i) {
    var list = hzAlts(i), sel = hzSel(i), order = list.map(function (_, k) { return k; }).sort(function (x, y) { return (y === sel) - (x === sel); }), q = 0;
    async function lane() {     // two at a time (the chosen one first): states asked once are cached for the rest
      while (q < order.length) {
        var a = list[order[q++]], e = hzEntry(a, i); if (e.st === 'done' || e.st === 'loading') continue;
        await hzLoad(a, i);
        if (step === ST_HAZ && hzLeg === i) { renderHz(); drawHaz(); }
      }
    }
    await Promise.all([lane(), lane()]);
  }
  /** Each route tile's own progress bar, moved in place (no redraw). */
  var hzBarT = 0;
  function hzBars() {
    if (hzBarT) return;
    hzBarT = requestAnimationFrame(function () {
      hzBarT = 0;
      document.querySelectorAll('#tHz .hz-opt[data-hzk]').forEach(function (b) {
        var a = hzAlts(hzLeg)[+b.dataset.hzk], e = a && hzCache.get(a), bar = b.querySelector('.hz-bar i'); if (!bar || !e) return;
        bar.style.width = Math.round(Math.max(0.04, e.prog || 0) * 100) + '%';
      });
    });
  }
  var hzRiskAcks = new WeakMap(), hzRiskBusy = false;
  function hzRiskState(a,i) {
    var e=hzEntry(a,i),setup=window.TirePolicy&&window.TireMath?TirePolicy.snapshot(Garage.car(),TireMath):null;
    var risk=RouteWx.tireRisk(setup,e.st==='done'?e.hz:[]);
    return {e:e,risk:risk,key:JSON.stringify([Garage.car().id,setup,risk.kinds,(e.hz||[]).filter(function(h){return risk.kinds.indexOf(h.kind)>=0;}).map(function(h){return [h.kind,h.level,h.event,h.fromMi,h.toMi,h.from,h.to];}),e.d,e.timeKey])};
  }
  function hzRiskHtml(state,a,i) {
    var risk=state.risk,groups={},setup=TirePolicy.snapshot(Garage.car(),TireMath);
    var unitKey=function(t){return t.unit==='trailer'?t.id.split(':')[0]:'car';};
    risk.tires.forEach(function(t){var key=JSON.stringify([unitKey(t),t.depth,t.measured]);(groups[key]||(groups[key]=[])).push(t);});
    var rows=Object.keys(groups).map(function(k){var ts=groups[k],t=ts[0],all=setup.tires.filter(function(x){return unitKey(x)===unitKey(t);}),name;
      if(ts.length===all.length)name=t.trailer?t.trailer+': all '+ts.length+' tires':'All '+ts.length+' car tires';
      else name=ts.map(function(x){return x.position;}).join(', ');
      return '<li>'+esc(name)+' — '+(t.measured?'measured ':'estimated ')+esc(String(t.depth))+'/32 in</li>';
    });
    return '<div class="wet-tire-warning"><p>'+esc((hzLegs()>1?'Leg '+(i+1)+' · ':'')+(a.description||'Selected route'))+'</p><p><b>'+esc(risk.kinds.map(function(k){return RouteWx.KINDS[k][0];}).join(', '))+'</b> along this route. Low tread reduces grip.</p><ul>'+rows.slice(0,3).join('')+'</ul>'+(rows.length>3?'<details><summary>More affected tires</summary><ul>'+rows.slice(3).join('')+'</ul></details>':'')+
      (risk.tires.some(function(t){return t.depth<=2;})?'<p class="warn"><b>Worn-out tires: replace before driving.</b></p>':'<p>Consider another route or postponing the trip. Check actual tread if these are estimates.</p>')+'<p class="small">Acknowledging this warning does not mean the route is safe.</p></div>';
  }
  async function hzConfirmRisk(a,i,valid) {
    if(!a)return true;
    // No known low tread: weather continues in the background, never hold navigation for this check.
    if(!RouteWx.tireRisk(TirePolicy.snapshot(Garage.car(),TireMath),[{kind:'snow'}]).tires.length)return true;
    if(hzRiskBusy)return false;
    var owner=route;hzRiskBusy=true;
    try {
      var checked=await hzLoad(a,i); // reuse the in-flight background check; never fetch it twice
      if(route!==owner||!document.body.classList.contains('trip-on')||valid&&!valid())return false;
      var state=hzRiskState(a,i);
      if(state.e!==checked){A.toast('Departure changed. Check this route again.');return false;}
      if(!state.risk.tires.length||hzRiskAcks.get(a)===state.key)return true;
      var ok=await A.confirmDel({always:true,title:'Low tread on a wet-weather route',body:hzRiskHtml(state,a,i),no:'Choose another',action:'I understand',goClass:'primary'});
      if(!ok)return false;
      if(route!==owner||!document.body.classList.contains('trip-on')||valid&&!valid()||hzRiskState(a,i).key!==state.key){A.toast('Tires or weather changed. Review this route again.');return false;}
      hzRiskAcks.set(a,state.key);LG.info('wx','Wet-weather tire warning acknowledged',{leg:i+1,kinds:state.risk.kinds,tires:state.risk.tires.map(function(t){return t.id;})});return true;
    }finally{hzRiskBusy=false;}
  }
  async function hzChoose(k) {
    var i = hzLeg; if (k === hzSel(i)) return;
    var a=hzAlts(i)[k];if(!await hzConfirmRisk(a,i,function(){return step===ST_HAZ&&hzLeg===i;}))return;
    routeReview=null;choiceComplete=false;
    if (legsMode()) await pickLeg(i, k); else await pickAlt(k);
    if (step === ST_HAZ) { renderHz(); drawHaz(); }
  }
  function hzGoLeg(j) { collectSafe(); hzLeg = j; hzFitKey = null; userMoved = false; renderHz(); drawHaz(); hzPill(); tpBody().scrollTop = 0; hzLoadLeg(j); }
  /** The part of a route between two miles, as map points. */
  function hzSlice(a, from, to) {
    var m = hzModel(a), out = [], p0 = m.pointAt(from), last = -1;
    out.push([p0.lat, p0.lng]);
    for (var k = 0; k < m.pts.length; k++) { var c = m.cum[k]; if (c <= from || c >= to) continue; if (c - last >= 0.1) { out.push([m.pts[k].lat, m.pts[k].lng]); last = c; } }
    var p1 = m.pointAt(to); out.push([p1.lat, p1.lng]);
    return out;
  }
  function hzKinds(list) { var o = {}; (list || []).forEach(function (x) { o[x.kind] = Math.max(o[x.kind] || 0, x.level); }); return RouteWx.ORDER.filter(function (k) { return o[k]; }); }
  function hzDot(k) { return '<i class="hz-dot" style="background:' + RouteWx.COLORS[k] + '" title="' + esc(RouteWx.KINDS[k][0]) + '"></i>'; }
  function hzListHtml(xs, st) {
    var c = window.Garage && Garage.car(), tt = c && c.tires || {}, e = window.TireMath ? TireMath.estimate(tt) : null;
    var profile=RouteWx.vehicleProfile(c),setup=window.TirePolicy&&window.TireMath?TirePolicy.snapshot(c||{},TireMath):null,depths=setup?setup.tires.filter(function(t){return typeof t.depth==='number'&&Number.isFinite(t.depth);}).map(function(t){return t.depth;}):[];
    var ctx = { tread: depths.length?Math.min.apply(null,depths):e ? e.depth : null, tireType: tt.type, towing: profile.towing,acUnavailable:profile.acUnavailable }, h = '';
    if (!xs.length) h += '<p class="lead small keep">' + (st.weather ? 'Nothing to watch for: no storms, rain, snow, ice, fog, strong wind, extreme heat or cold, warnings or bad air forecast where and when you\'ll be.' : 'No forecast reaches that far ahead yet.') + '</p>';
    h += xs.map(function (x) {
      var sit = RouteWx.KINDS[x.kind][1], pr = sit && window.Climate && Climate.presetFor ? Climate.presetFor(c, sit, new Date(x.from)) : null;
      var lines = RouteWx.advice(x, Object.assign({ preset: pr }, ctx));
      var where = (x.toMi - x.fromMi < 1 ? 'around mile ' + Math.round(x.fromMi) : 'miles ' + Math.round(x.fromMi) + '–' + Math.round(x.toMi)) + ' · ' + wxWhen(x.from, x.to);
      var notice = x.src === 'nws' && x.event !== RouteWx.title(x) ? '<small class="wx-ev">' + esc(x.event) + '</small>' : '';
      return '<details class="wx-x lv' + x.level + '"' + (x.level >= 2 ? ' open' : '') + '><summary><span class="wx-ic" style="--hz:' + RouteWx.COLORS[x.kind] + '">' + RouteWx.KINDS[x.kind][2] + '</span><span class="wx-t"><b>' + esc(RouteWx.title(x)) + '</b>' + (x.aiPending ? '<small class="wx-ai">AI still summarizing…</small>' : '') + notice + '<small>' + esc(where) + '</small></span></summary>' +
        '<div class="wx-a">' + lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div></details>';
    }).join('');
    if (st.aiPending) h = '<p class="lead small keep hz-ai">The on-phone AI is still summarizing ' + (st.aiPending === 1 ? 'a warning' : st.aiPending + ' warnings') + ' on this route. Until it\'s done, ' + (st.aiPending === 1 ? 'it\'s' : 'they\'re') + ' sorted by ' + (st.aiPending === 1 ? 'its' : 'their') + ' wording; this updates by itself.</p>' + h;
    var beyond = [];
    if (st.beyondWeather) beyond.push('the last ' + Math.round(st.beyondWeather / st.points * 100) + '% of the way is past the 16-day weather forecast');
    else if (st.beyondAir) beyond.push('the air forecast reaches about 5 days ahead, so the last ' + Math.round(st.beyondAir / st.points * 100) + '% of the way has no air reading yet');
    if (beyond.length) h += '<p class="lead small keep">Note: ' + esc(beyond.join('; ')) + '. Check again closer to the day.</p>';
    return h;
  }
  function renderHz() {
    hereTolls();
    var el = $('tHz'); if (!el) return;
    var n = hzLegs(); if (hzLeg >= n) hzLeg = Math.max(0, n - 1);
    var list = hzAlts(hzLeg), sel = routeReview?routeReview.k:hzSel(hzLeg);
    if (!list.length) { el.innerHTML = '<div class="card empty-res">Get your routes first.</div>'; return; }
    var car=Garage.car()||{},setup=window.TirePolicy&&window.TireMath?TirePolicy.snapshot(car,TireMath):null;
    var fit=RouteWx.rankOptions(list.map(function(a){var e=hzCache.get(a)||{};return {ready:e.st==='done',hazards:e.hz||[],stats:e.stats,miles:(a.distanceMeters||0)/1609.344};}),car,setup);
    var order=list.map(function(a,k){return k;});if(fit.complete)order.sort(function(a,b){return fit.rows[a].rank-fit.rows[b].rank||a-b;});
    var h = '<p class="hz-notice">Hazards are projections from forecasts and active warnings. They can change with little warning: check again before you go.' +
      (list[sel] && list[sel].websiteApproximate ? ' <span class="hz-approx">Website route · approximate ' + A.qBtn('Website route points and total time are not full API turn-by-turn geometry or no-traffic timing. Detours and fuel/time estimates are less precise. Verify the route in Google Maps before driving. An API key is recommended for more reliable planning.') + '</span>' : '') +
      '</p><p class="hz-profile">For this vehicle: '+esc(fit.profile.label)+A.qBtn('Relative comparison using the forecast and known vehicle details, not a safety rating. Major hazards remain important for every vehicle; no ranking permits entering floodwater. '+fit.profile.source+'. Ground clearance is not measured. Change the profile in Garage → About this car → Edit. Known low tread, hooked trailers and unavailable A/C affect the reasons shown. Rankings appear only when all options have complete weather/air checks and no pending AI classification; no route is selected automatically.')+'</p><div class="hz-opts">' + order.map(function (k) {
      var a=list[k];
      if(routeReview&&k!==sel)return '';
      var e = hzCache.get(a), mi = Math.round((a.distanceMeters || 0) / 1609.344), sec = parseFloat(String(a.duration || '0')), chips;
      if (!e || !e.st || e.st === 'loading') chips = '<span class="hz-ld">Checking the weather along it…</span><span class="hz-bar"><i style="width:' + Math.round(Math.max(0.04, e && e.prog || 0) * 100) + '%"></i></span>';
      else if (e.st === 'error') chips = '<span class="hz-ld">couldn\'t check</span>';
      else { var ks = hzKinds(e.hz); chips = ks.length ? ks.map(hzDot).join('') + '<span class="hz-n">' + e.hz.length + ' hazard' + (e.hz.length === 1 ? '' : 's') + '</span>' : '<span class="hz-ok">✓ nothing found</span>'; if(e.aiRating||e.stats.aiPending)chips+='<span class="hz-ai-note">⚠ AI still rating warnings…</span>'; }
      // which one Google Maps had (your link), as before
      var note = list.length === 1 ? 'Google\'s only route' : legsMode() ? '' : k === altSel && pickedRoute(route) ? (altSure ? '✓ same as in Google Maps' : 'closest to what you picked') : (!pickedRoute(route) && route && route.routeIndex === k ? 'matches your link' : '');
      return '<button class="hz-opt' + (k === sel ? ' on' : '') + '" data-hzk="' + k + '"><span class="hz-o1"><b>' + (a.description ? 'via ' + esc(a.description) : 'Route ' + (k + 1)) + '</b><span>' + mi.toLocaleString() + ' mi · ' + fmtDur(sec) + (tollTag(a) ? ' · ' + esc(tollTag(a)) : '') + '</span></span>' +
        (note ? '<span class="hz-note">' + esc(note) + '</span>' : '') + '<span class="hz-o2">' + chips + '</span><span class="hz-fit"><strong>'+(fit.complete?'Vehicle fit '+fit.rows[k].rank+' of '+list.length:'Not ranked — comparison incomplete')+'</strong>'+(e&&e.st==='done'?'<span>'+esc(fit.rows[k].fit.reasons.join(' · '))+'</span>':'')+'</span></button>';
    }).join('') + '</div>';
    if(routeReview)h='<div class="card"><h3>Would you consider this route if it were cheaper?</h3><p class="lead small keep">Leg '+(hzLeg+1)+' · '+esc(legName(route,hzLeg))+'. No skips its station search; Yes includes it after your primary routes.</p></div>'+h;
    var e = hzCache.get(list[sel]);
    h += '<div class="card wx-card" id="tWx"><h3>On this route</h3>';
    if (!e || !e.st || e.st === 'loading') h += A.ldBar('Checking the forecast where and when you\'ll be');
    else if (e.st === 'error') h += '<p class="lead small keep">Couldn\'t get the forecast (' + esc(e.err) + '). <a href="#" id="tHzRetry">Try again</a></p>';
    else h += hzListHtml(e.hz, e.stats);
    h += '<p class="wx-src">Weather and warnings: National Weather Service · Past its 6½-day forecast: weather data by Open-Meteo.com (CC BY 4.0; NOAA\'s National Blend of Models) · Air: Copernicus Atmosphere Monitoring Service via Open-Meteo</p></div>';
    el.innerHTML = h;
    if($('tReviewBack'))$('tReviewBack').onclick=reviewBack;
    el.querySelectorAll('[data-hzk]').forEach(function (b) { b.onclick = function () { if(!routeReview)hzChoose(+b.dataset.hzk); }; });
    if ($('tHzRetry')) $('tHzRetry').onclick = function (ev) { ev.preventDefault(); hzCache.delete(list[sel]); renderHz(); hzLoadLeg(hzLeg); };
    fitHz();
  }
  /** Like Departure: the panel just tall enough for the notice and the route tiles (the list below is a drag away). */
  var hzFitKey = null;
  function fitHz() {
    var pg = $('trip'), body = tpBody(), opts = document.querySelector('#tHz .hz-opts'); if (step !== ST_HAZ || !pg || !body || !opts || pg.classList.contains('full')) return;
    var key = hzLeg + '|' + opts.children.length + '|' + innerHeight; if (hzFitKey === key) return; hzFitKey = key;
    var need = pg.getBoundingClientRect().height - body.clientHeight + (opts.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop) + 12;
    var h = Math.max(innerHeight * 0.2, Math.min(need, innerHeight * 0.6));
    pg.style.setProperty('--panel-h', (h / innerHeight * 100).toFixed(2) + 'vh');
    userMoved = false;
    setTimeout(function () { if (step !== ST_HAZ) return; fitRoute(true); fitBtn(); placeHzSoon(); }, 260);
  }
  /** The big map on Hazards: every option for this leg, hazards on each, labels on the chosen one. */
  function drawHaz() {
    if (map.hasLayer(layer)) map.removeLayer(layer);
    hzLayer.clearLayers(); hzLeaders.clearLayers(); if (!map.hasLayer(hzLayer)) hzLayer.addTo(map); hzLayer.addLayer(hzLeaders);
    hzTips = []; hzLines = [];
    var list = hzAlts(hzLeg), sel = routeReview?routeReview.k:hzSel(hzLeg), all = [];
    if (!list.length) return;
    list.map(function (_, k) { return k; }).filter(function (k) { return k !== sel; }).concat([sel]).forEach(function (k) {
      var a = list[k], on = k === sel, pts = thinAlt(a), pick = function () { hzChoose(k); };
      hzLines.push({ pts: pts });
      L.polyline(pts, { color: '#ffffff', weight: on ? 10 : 8, opacity: 0.95, interactive: false }).addTo(hzLayer);
      L.polyline(pts, { color: on ? '#1a73e8' : ROUTE_GRAY, weight: on ? 6 : 5, opacity: 1 }).on('click', pick).addTo(hzLayer);
      var e = hzCache.get(a);
      if (e && e.st === 'done') e.hz.forEach(function (x) {
        var seg = hzSlice(a, x.fromMi, x.toMi), col = RouteWx.COLORS[x.kind]; if (seg.length < 2) return;
        L.polyline(seg, { color: col, weight: on ? 6 : 5, opacity: on ? 1 : 0.9, lineCap: 'butt' }).on('click', pick).addTo(hzLayer);
        if (!on) return;
        var cands = [0.5, 0.3, 0.7, 0.15, 0.85].map(function (f) { var q = seg[Math.min(seg.length - 1, Math.floor(f * (seg.length - 1)))]; return L.latLng(q[0], q[1]); });
        var tip = L.tooltip({ permanent: true, direction: 'top', offset: [0, -6], className: 'hzbub', interactive: false, opacity: 1 })
          .setLatLng(cands[0]).setContent('<i style="background:' + col + '"></i>' + RouteWx.KINDS[x.kind][2] + '<span>' + esc(RouteWx.title(x)) + '</span>');
        hzLayer.addLayer(tip);
        hzTips.push({ k: hzTips.length, cands: cands, tip: tip, color: col });
      });
      L.polyline(pts, { color: '#000', weight: 22, opacity: 0.001 }).on('click', pick).addTo(hzLayer);   // easier to tap
      all = all.concat(pts);
    });
    var ep = thinAlt(list[sel]), mk = function (p, t) { L.marker(p, { icon: L.divIcon({ className: 'pin', html: '<div class="tend">' + t + '</div>', iconSize: null }), interactive: false }).addTo(hzLayer); };
    mk(ep[0], 'A'); mk(ep[ep.length - 1], 'B');
    var nb = L.latLngBounds(all);
    if (!routeBounds || !routeBounds.equals(nb)) { routeBounds = nb; userMoved = false; }
    if (!userMoved) fitRoute(false);
    fitBtn(); placeHzSoon();
  }
  function placeHz() {
    if (step !== ST_HAZ || !hzTips.length || !map.hasLayer(hzLayer)) return;
    var sz = map.getSize(), cover = sheetCover(), st = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--st')) || 0;
    var tops = Labels.rectsOf(map, Array.prototype.filter.call(document.querySelectorAll('.top .bar > *, #apiCount, #hzLeg'), function (e) { return getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; }), 6);
    placeLabels(map, hzTips, -1, hzLines, [{ x: 0, y: sz.y - cover, w: sz.x, h: cover }, { x: 0, y: 0, w: sz.x, h: st + 4 }].concat(tops), { leaders: hzLeaders, leaderPane: 'tleaders' });
  }
  var hzT = 0;
  function placeHzSoon() { clearTimeout(hzT); hzT = setTimeout(placeHz, 30); }
  map.on('zoomend moveend', function () { if (step === ST_HAZ) placeHzSoon(); });
  /** Departure: the chosen routes' hazards on the route, no labels (looked up now if they weren't yet). */
  function drawDepHaz() {
    hzDepLayer.clearLayers(); if (!map.hasLayer(hzDepLayer)) hzDepLayer.addTo(map);
    for (var i = 0; i < hzLegs(); i++) (function (i) {
      var a = hzAlts(i)[hzSel(i)]; if (!a) return;
      var e = hzEntry(a, i);
      if (e.st !== 'done') { if (!e.st) hzLoad(a, i).then(function () { if (step === ST_DEPART) drawDepHaz(); }); return; }
      e.hz.forEach(function (x) { var seg = hzSlice(a, x.fromMi, x.toMi); if (seg.length > 1) L.polyline(seg, { pane: 'hzpane', color: RouteWx.COLORS[x.kind], weight: 6, opacity: 0.95, lineCap: 'butt', interactive: false }).addTo(hzDepLayer); });
    })(i);
  }
  /** "Step 1/2": which leg you're picking (round trips and trips with stops in between). */
  function hzPill() {
    var b = $('hzLeg');
    if (!b) { b = document.createElement('div'); b.id = 'hzLeg'; b.className = 'hz-leg hidden'; document.body.appendChild(b); }
    var on = step === ST_HAZ && document.body.classList.contains('trip-on') && hzLegs() > 1;
    b.classList.toggle('hidden', !on);
    if (on) b.innerHTML = 'Step ' + (hzLeg + 1) + '/' + hzLegs() + '<small>' + esc(String(legName(route, hzLeg)).replace(/<[^>]*>/g, '')) + '</small>';
  }
  /** Which hazard layers the map shows for this step (labels only while picking routes). */
  function hzSync() {
    var on = document.body.classList.contains('trip-on');
    if (on && step === ST_HAZ) drawHaz(); else { if (map.hasLayer(hzLayer)) map.removeLayer(hzLayer); hzTips = []; }
    if (on && step === ST_DEPART && model) drawDepHaz(); else if (map.hasLayer(hzDepLayer)) map.removeLayer(hzDepLayer);
    hzPill();
  }
  function bindDeparture() {
    document.querySelectorAll('[data-depart-scope]').forEach(function(b){b.onclick=function(){departScope=b.dataset.departScope;renderStep();};});
    if($('tDepartLeg'))$('tDepartLeg').onchange=function(){departLeg=+$('tDepartLeg').value;renderStep();};
    if ($('tsReport')) $('tsReport').onclick = function (e) { e.preventDefault(); shareReport(e); };
    if ($('tShare')) $('tShare').onclick = shareTrip;
    var b = $('tOpen'); if (b) b.disabled = !(result && result.plan.ok);
  }
  /**
   * The one place a trip goes to Google Maps: up to 9 stops opens in one tap. Over that, the legs slide up from the
   * button and you tap the one you're driving.
   */
  function openMaps() {
    var ex = result && result.plan.ok ? exports() : null; if (!ex) return;
    if (!ex.one.tooMany) { N.openUrl(ex.one.url); return; }
    if (closeLegs()) return;
    var pg = $('trip'), box = document.createElement('div');
    box.className = 'legs-pop'; box.id = 'tLegs';
    box.innerHTML = '<div class="lp-h">Follow these links in order. Each has at most 9 points, including its start and end.</div>' + ex.legs.map(function (x, i) {
      return (x.part===0?'<h3 class="lp-h">Leg '+(x.leg+1)+' · '+arrowHtml(legName(route,x.leg))+'</h3>':'')+'<button class="leg-link' + (opened[x.leg+':'+x.part] ? ' done' : '') + '" data-legurl="' + i + '" style="--i:' + (ex.legs.length - 1 - i) + '"><span class="leg-n">' + (x.part + 1) + '</span><span class="ll-t"><b>' + (x.parts>1?'Part '+(x.part+1)+' of '+x.parts+' · ':'')+arrowHtml(stopLine(x.from)+' → '+stopLine(x.to)) + '</b><small>' +
        Math.round(x.toMi - x.fromMi).toLocaleString() + ' mi · ' + (x.fuelStops ? x.fuelStops + ' fuel / charging stop' + (x.fuelStops === 1 ? '' : 's') : 'no fuel stops') + '</small>' +
        (x.part<x.parts-1?'<small>At this part’s last stop, open Part '+(x.part+2)+'.</small>':'')+'</span>'+
        '<svg viewBox="0 0 24 24"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3zM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z"/></svg></button>';
    }).join('');
    pg.appendChild(box); document.body.classList.add('legs-open');      // the "more below" arrow would sit on the links
    box.style.bottom = ($('tpNav').getBoundingClientRect().height + 6) + 'px';
    requestAnimationFrame(function () { box.classList.add('on'); });
    box.querySelectorAll('[data-legurl]').forEach(function (b) {
      b.onclick = function () { var x = ex.legs[+b.dataset.legurl]; opened[x.leg+':'+x.part] = true; b.classList.add('done'); N.openUrl(x.url); };
    });
    setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
  }
  var opened = {};
  function outside(e) { var box = $('tLegs'); if (!box || box.contains(e.target) || (e.target.closest && e.target.closest('#tOpen'))) return; closeLegs(); }
  function closeLegs() {
    var box = $('tLegs'); document.removeEventListener('pointerdown', outside, true);
    if (!box) return false;
    box.classList.remove('on'); setTimeout(function () { box.remove(); }, 200); document.body.classList.remove('legs-open');
    return true;
  }
  /** A price bubble on the route was tapped: open the fuel-stop list on that stop's tile (or the top-up). */
  function openStopTile(which) {
    if (!result || !result.plan.ok) return;
    if (step !== ST_STOPS) { closeLegs(); collectSafe(); step = ST_STOPS; renderStep(); }
    var r = result, k = which === 'T' ? -1 : +which - 1;
    r.stopsShut = false; r.openStops = {}; if (k >= 0) r.openStops[k] = true;
    renderResults();
    setTimeout(function () {
      var t = k >= 0 ? $('stop' + k) : document.querySelector('#tsResults .topbox');
      if (t) { t.scrollIntoView({ block: 'start', behavior: 'smooth' }); t.classList.add('pulse'); setTimeout(function () { t.classList.remove('pulse'); }, 1900); }
    }, 60);
  }
  /** Your bad-CITGO list (or a diesel own-risk choice) changed: plan again from the stations already found (no lookups). */
  function blChanged() {
    if (!result || !model) return;
    var shut = result.stopsShut;
    result = null;
    findStops().then(function () { if (result && shut === false) { result.stopsShut = false; if (onPlan(step)) renderResults(); } });
  }
  /** Stop cards: tap a header to open/close it (in place), price breakdown, navigate. */
  function bindStops() {
    var el = tpBody(), r = result, p = r.plan;
    el.querySelectorAll('[data-open]').forEach(function (b) {
      b.onclick = function () {
        var k = +b.dataset.open; r.openStops = r.openStops || {}; r.openStops[k] = !r.openStops[k];
        $('stop' + k).outerHTML = stopCard(p.stops[k], k); bindStops();
      };
    });
    el.querySelectorAll('[data-nav]').forEach(function (b) {
      b.onclick = function () { var s = b.dataset.nav === 'top' ? r.top.c : p.stops[+b.dataset.nav].c; N.navigate(s.lat, s.lng, /^(wm|mu|demo)-/.test(s.station.id) ? '' : s.station.id, s.station.name); };
    });
    el.querySelectorAll('[data-citgo-fill]').forEach(function(b){b.onclick=async function(){
      // Actual redemption is deliberately separate from planning/navigation. Never silently mark
      // a future plan's month used; only today's eligible special can be confirmed here.
      var now=new Date(),kind=P.citgoBonus(S,now);if(kind==='none')return;
      var name=kind==='tuesday'?'Triple Tuesday':'Five Cent Friday',month=P.monthKey(now);
      var ok=await A.confirmDel({always:true,title:'Record actual CITGO fill-up?',body:'Confirm you actually filled up using '+name+' today. This marks '+month+' as used and replans saved station choices without any lookups. Planning alone never uses your reward. You can undo this in Settings.',action:'Record fill-up',goClass:'primary'});
      if(!ok)return;P.setCitgoRedeemed(S,kind,month,true);A.save();repriceRewards();
    };});
    if (A.bl) (p.stops || []).forEach(function (s, i) { if (r.openStops && r.openStops[i]) A.bl.bind(s.c.station, 'ts' + i); });
    el.querySelectorAll('[data-why]').forEach(function (b) {
      b.onclick = function () { var box = $('why' + b.dataset.why); box.classList.toggle('hidden'); };
    });
  }
  function agoText(ms) { var m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; }

  // ---------- trip history ----------
  // Every planned trip is kept (route, Google's route options and the stations it found, with prices) so it can be
  // reopened later with no Google lookups at all. Same stops = same entry, replaced by the newer search.
  var HIST_MAX = 25;
  function histIndex() { var o = A.KV.get('trips', 'index'); return (o && o.v) || []; }
  /** One route option, recognizable again later: its length, time and name. */
  function altSig(a) { return a ? Math.round((a.distanceMeters || 0) / 100) + '|' + Math.round(parseFloat(String(a.duration || '0')) / 60) + '|' + (a.description || '') : ''; }
  /** A saved trip to the same places (each within ~1/4 mile), avoiding the same things — whatever link it came from. */
  function similarTrip(r) {
    if (!r || r.stops.some(function (s) { return s.current || s.lat == null; })) return null;
    var idx = histIndex();
    for (var i = 0; i < idx.length; i++) {
      var o = A.KV.get('trips', 'trip|' + idx[i].id), v = o && o.v;
      if (!v || !v.route || !v.alts || !v.alts.length || !v.stations || v.route.stops.length !== r.stops.length) continue;
      var av = (v.trip && v.trip.avoid) || {};
      if (['tolls', 'highways', 'ferries'].some(function (k) { return !!av[k] !== !!S.trip.avoid[k]; })) continue;
      var same = v.route.stops.every(function (s, k) { var t = r.stops[k]; return !s.current && s.lat != null && !!s.ret === !!t.ret && P.haversineMi(s.lat, s.lng, t.lat, t.lng) <= 0.25; });
      if (same) return { id: idx[i].id, t: o.t, v: v };
    }
    return null;
  }
  function histId(r) {
    if (r.histId) return r.histId;
    var key = r.stops.map(function (st) { return st.current ? 'here' : (st.lat != null ? st.lat.toFixed(3) + ',' + st.lng.toFixed(3) : norm(st.address || st.label)); }).join('|') +
      '|' + ['tolls', 'highways', 'ferries'].filter(function (k) { return S.trip.avoid[k]; }).join(',');
    var h = 0; for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return r.histId='t'+(h>>>0).toString(36)+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  }
  /** "North Little Rock → Dallas", or every stop for a trip with a few stops in between ("North Little Rock → Dallas → North Little Rock"). */
  function tripTitle(r) {
    var n = r.stops.map(stopName);
    return n.length <= 4 ? n.join(' → ') : n[0] + ' → … → ' + n[n.length - 1];
  }
  function stopName(st) { return st.current ? 'Your location' : (st.short || st.label || st.address || '?'); }
  function saveTrip(raw, ks) {
    if (!route || !raw) return;
    var id = histId(route), now = Date.now();
    choiceOwnerSync();var prior=choiceSavedId===id&&A.KV.get('trips','trip|'+id);
    var choices=rememberedChoices(prior&&prior.v&&prior.v.routeChoicesByVehicle);choiceSavedId=id;
    var previousComparison=A.KV.get('trips','trip|'+id);
    var google = (raw.google || []).map(function (list, i) { return { k: ks[i], sig: alts[ks[i]] ? altSig(alts[ks[i]]) : '', list: list }; });
    var keepStop = function (st) { var o = Object.assign({}, st); delete o.choices; return o; };
    A.KV.put('trips', 'trip|' + id, {
      route: { stops: route.stops.map(keepStop), avoid: route.avoid, avoidDetected: route.avoidDetected, routeIndex: route.routeIndex, mapsRoutes: route.mapsRoutes,
        legs: route.legs ? route.legs.map(function (L) { return { alts: L.alts, sel: L.sel }; }) : null },
      alts: alts, altSel: altSel, altSure: altSure,
      trip: { link: S.trip.link, from: S.trip.from, to: S.trip.to, via: (S.trip.via || []).filter(Boolean), avoid: S.trip.avoid, milesLeft: S.trip.milesLeft, fuel: S.trip.fuel,evChargers:S.trip.evChargers,evNetworksOff:S.trip.evNetworksOff,evDestinations:S.trip.evDestinations,arrive:S.trip.arrive,altCompare:S.trip.altCompare,altMinSave:S.trip.altMinSave },
      routeChoicesByVehicle:choices,
      comparison:previousComparison&&previousComparison.v&&previousComparison.v.comparison,
      stations: { official: raw.official || [], google: google, kind: raw.kind || 'gas' }, savedT: now
    });
    if(routeFlow()||(replay&&replay.id===id))replay={id:id,t:now,stations:{official:raw.official||[],google:google,kind:raw.kind||'gas'},alts:alts.slice(),partial:true};
    var idx = histIndex().filter(function (x) { return x.id !== id; });
    idx.unshift({ id: id, t: now, title: tripTitle(route), pts: route.stops.map(stopName),
      mi: Math.round(model.totalMi), via: alts[altSel] && alts[altSel].description || '', n: route.stops.length });
    idx.slice(HIST_MAX).forEach(function (x) { A.KV.put('trips', 'trip|' + x.id, null); });
    A.KV.put('trips', 'index', idx.slice(0, HIST_MAX));
    LG.info('history', 'Saved trip to history', idx[0].title);
  }
  function dayText(t) {
    var d = new Date(t), now = new Date(), days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
    var tm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return days === 0 ? 'Today ' + tm : days === 1 ? 'Yesterday ' + tm : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  /** Trip button: start a new trip or reopen a saved one (saved trips need no lookups). */
  function tripPicker() {
    var idx = histIndex(), cur = model && route;
    if (!idx.length && !cur) { newTrip(); return; }
    var bg = document.createElement('div'); bg.className = 'tpick-bg'; bg.id = 'tripPick';
    bg.innerHTML = '<div class="tpick" role="dialog" aria-label="Plan a trip"><div class="tpick-h">Plan a trip</div>' +
      '<button class="tpick-new" id="tpNew"><span class="plus">+</span><span><b>New trip</b><small>Start from scratch</small></span></button>' +
      (cur ? '<button class="tpick-new cont" id="tpCont"><span class="plus">↺</span><span><b>Continue</b>' + miniList(route.stops.map(stopName)) + '</span></button>' : '') +
      (idx.length ? '<div class="tpick-sub">Recent trips <span>no lookups</span></div><div class="tpick-list">' + idx.map(function (x) {
        return '<div class="hist-row"><button class="hist-open" data-hist="' + x.id + '">' + miniList(histPts(x)) + '<small>' + x.mi + ' mi' +
          (x.via ? ' · via ' + esc(x.via) : '') + (x.n > 2 ? ' · ' + (x.n - 2) + ' stop' + (x.n > 3 ? 's' : '') : '') + ' · ' + dayText(x.t) + '</small></button>' +
          '<button class="hist-del" data-hdel="' + x.id + '" aria-label="Remove from history">✕</button></div>';
      }).join('') + '</div>' : '') + '</div>';
    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('on'); });
    var close = function () { bg.classList.remove('on'); setTimeout(function () { bg.remove(); }, 200); };
    bg.onclick = function (e) { if (e.target === bg) close(); };
    $('tpNew').onclick = function () { close(); newTrip(); };
    if ($('tpCont')) $('tpCont').onclick = function () { close(); openTrip(); };
    bg.querySelectorAll('[data-hist]').forEach(function (b) { b.onclick = function () { close(); openSaved(b.dataset.hist); }; });
    bg.querySelectorAll('[data-hdel]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.hdel, x = histIndex().filter(function (y) { return y.id === id; })[0];
        A.confirmDel({ title: 'Remove this trip?', body: x ? esc(x.title || '') : '', action: 'Remove' }).then(function (ok) {
          if (!ok) return;
          A.KV.put('trips', 'index', histIndex().filter(function (x) { return x.id !== id; }));
          A.KV.put('trips', 'trip|' + id, null);
          var row = b.closest('.hist-row'); if (row) row.remove();
        });
      };
    });
  }
  /** A trip's places as a small numbered list. */
  function miniList(names) {
    return '<ol class="nlist sm">' + names.map(function (n, i) { return '<li><span class="nn">' + (i + 1) + '</span><div class="nl-a">' + esc(n) + '</div></li>'; }).join('') + '</ol>';
  }
  function histPts(x) {
    if (x.pts && x.pts.length) return x.pts;
    var o = A.KV.get('trips', 'trip|' + x.id), v = o && o.v;   // saved before the list kept them
    if (v && v.route && v.route.stops) return v.route.stops.map(stopName);
    return String(x.title || '').split(' → ');
  }
  function closePicker() { var bg = $('tripPick'); if (!bg) return false; bg.remove(); return true; }
  /** A fresh trip: keep the car and your settings, forget the route. */
  /** Another trip (new, saved or shared from Maps) while a search runs would pull its route away from under it. */
  function jobBlocks() { if(compareCalculating){A.toast('Wait for the vehicle recalculation to finish.');return true;}if (!busy || loadingTrip) return false; A.toast('Finish or cancel the station search first (the bar at the top).'); return true; }
  function newTrip(link) {
    if (jobBlocks()) return;
    compareReset();
    resetChoices();adjustError='';evRecovery=null;
    resetAdjust();
    route = null; model = null; rawRoute = null; result = null; replay = null; parsing = null; alts = []; altSel = 0; altSure = false;
    routeBounds = null; userMoved = false; layer.clearLayers(); drawn = {}; resetSteps(); opened = {};
    S.trip.link = link || ''; S.trip.from = ''; S.trip.to = ''; S.trip.via = []; S.trip.returnTrip = false; if (link) S.trip.src = 'link';
    if (link) autoRoute = true;   // a link shared from Google Maps: its routes come by themselves
    A.save();
    openTrip(Garage.need && Garage.need() ? ST_GARAGE : link ? ST_ROUTE : ST_GARAGE);
  }
  async function openSaved(id) {
    if (jobBlocks()) return;
    if (busy) return;
    resetAdjust();
    var o = A.KV.get('trips', 'trip|' + id), v = o && o.v;
    if (!v || !v.alts || !v.alts.length) { toastMsg('That saved trip couldn\'t be read.'); return; }
    compareReset();
    (v.comparison||[]).forEach(function(s){if(S.cars.some(function(c){return c.id===s.id;})){s.needsReview=true;s.reviewedAt=0;s.result=null;s.model=null;s.trip.routeChoices={};s.trip.depart='';s.trip.departNow=false;s.trip.backAt='';compareEntries.set(s.id,s);}});
    var draft=compareEntries.get(S.carId);
    if(draft){
      S.trip=Object.assign({},S.trip,VehicleCompare.clone(draft.trip));Object.defineProperty(S.trip,'routeChoices',{value:{},writable:true,configurable:true,enumerable:false});S.speed=VehicleCompare.clone(draft.speed);
      v=Object.assign({},v,{route:draft.route,alts:draft.alts,altSel:draft.altSel,altSure:draft.altSure,trip:draft.trip,stations:draft.replay&&draft.replay.stations||{official:[],google:[],kind:draft.kind},savedT:draft.replay&&draft.replay.t||v.savedT});
    }else if(compareEntries.size){S.trip.fuel=null;S.trip.milesLeft='';v=Object.assign({},v,{trip:Object.assign({},v.trip,{fuel:null,milesLeft:'',evDestinations:null})});}
    S.trip.depart = ''; S.trip.departNow = false; S.trip.backAt = '';   // a trip opened again: when you're leaving this time, asked again
    Object.assign(S.trip, { src: v.trip.link ? 'link' : 'typed', link: v.trip.link || '', from: v.trip.from || '', to: v.trip.to || '', via: (v.trip.via || []).slice(), avoid: Object.assign({ tolls: false, highways: false, ferries: false }, v.trip.avoid) });
    S.trip.evChargers=v.trip.evChargers||null;if(v.trip.evNetworksOff)S.trip.evNetworksOff=v.trip.evNetworksOff;S.trip.evDestinations=v.trip.evDestinations||null;S.trip.arrive=v.trip.arrive||'buffer';S.trip.arriveSet=!!v.trip.arrive;resetChoices(id);S.trip.altCompare=!!v.trip.altCompare;S.trip.altMinSave=v.trip.altMinSave==null?5:v.trip.altMinSave;
    routeReview=null;choiceComplete=false;choicePool=null;
    if (!hasFuel() && (v.trip.fuel || v.trip.milesLeft)) { S.trip.fuel = v.trip.fuel || { mode: 'miles', miles: String(v.trip.milesLeft) }; syncMilesLeft(); }
    A.save();
    route = Object.assign({},v.route,{histId:id}); alts = v.alts;
    S.trip.returnTrip = route.stops.some(function (x) { return x.ret; }); altSel = Math.min(v.altSel || 0, alts.length - 1); altSure = !!v.altSure;
    rawRoute = alts[altSel]; result = null; parsing = null;
    replay = { id: id, t: v.savedT || o.t, stations: v.stations, alts: v.alts };
    resetSteps(); routeBounds = null; userMoved = false; layer.clearLayers(); drawn = {};
    // starts at the Garage (which car this time?); the route and the stops are ready behind it
    model = null; loadingTrip = true; busy = true;
    openTrip(ST_GARAGE);
    await paint();
    try { model = T.buildRoute(rawRoute, carModel()); ensureLimits(model); }
    catch (e) { loadingTrip = false; busy = false; jumpTo = 0; mapLoaded(); renderStep(); toastMsg('That saved trip couldn\'t be read.'); LG.error('history', String(e)); return; }
    loadingTrip = false; busy = false;
    LG.info('history', 'Opened saved trip', { id: id, saved: new Date(o.t).toISOString(), miles: Math.round(model.totalMi) });
    renderStep();   // Next goes on from the Garage; entering Stops plans it from the saved stations
    var mine = route;
    tollFreeForSaved().then(function (changed) {
      if (!changed || route !== mine) return;
      if (step === ST_ROUTE) keepScroll(function () { renderInfo(); }); else if (step === ST_HAZ) renderHz(); else hereTolls();
    }).catch(function (e) { LG.warn('route', 'Toll-free routes not found', { error: e.message || String(e) }); });
    await restoreChoices();
    if (jumpTo) { var j = jumpTo; jumpTo = 0; advance(j); }
  }
  function priceText(v) { return '$' + P.fmt3(v); }
  function keepScroll(f) { var el = tpBody(); if (!el) return f(); var y = el.scrollTop; f(); el.scrollTop = y; }
  function topUpBox() {
    var r = result, last = r.plan.stops[r.plan.stops.length - 1];
    var h = '<div class="topbox"><div class="tb-h">Top up near ' + esc(route.stops[route.stops.length - 1].label) + '?</div>' +
      '<div class="tb-row">Stations within <input type="number" id="tsTopMi" step="0.1" min="0" inputmode="decimal" value="' + r.topMi.toFixed(1) + '"> mi of the destination</div>';
    if (!r.tops.length) {
      h += '<div class="lead small keep">No priced station that close' + (last ? ' after your last stop' : '') + '. Try a bigger distance.</div></div>';
      return h;
    }
    r.tops.forEach(function (t, k) {
      var br = P.brand(t.c.station.brand), on = r.topSel === k;
      h += '<div class="top-opt' + (on ? ' on' : '') + '">' + A.logoHtml(t.c.station.brand) + '<div class="mid"><b>' + esc(P.displayName(t.c.station)) + '</b> · ' + priceText(t.c.price) +
        (last ? ' <span class="' + (t.extraPerGal > 0 ? 'bad' : 'good') + '">(' + (t.extraPerGal >= 0 ? '+' : '−') + '$' + P.fmt3(Math.abs(t.extraPerGal)) + '/gal vs. stop ' + r.plan.stops.length + ')</span>' : '') +
        '<div class="sub">' + t.toDestMi.toFixed(1) + ' mi from the destination · +' + t.buyGal.toFixed(1) + ' gal for ' + money(t.cost) + ' → arrive with ~' + Math.round(t.endMi) + ' mi</div></div>' +
        '<button data-top="' + k + '">' + (on ? 'Added ✓' : 'Add') + '</button></div>';
    });
    if (r.top) h += '<div class="s-act"><button data-nav="top">Navigate to the top-up</button></div>';
    if(r.top&&r.top.c.citgo&&P.citgoBonus(S,new Date())!=='none')h+='<div class="s-act"><button data-citgo-fill="top">Record actual CITGO fill-up…</button></div>';
    return h + '</div>';
  }
  function stopCard(s, i) {
    var c = s.c, st = c.station, br = P.brand(st.brand), open = !!(result.openStops && result.openStops[i]);
    var det = c.detourMi < 0.15 ? 'on the route' : '+' + c.detourMi.toFixed(1) + ' mi detour';
    var h = '<div class="stop' + (open ? ' open' : '') + '" id="stop' + i + '"><button class="s-top" data-open="' + i + '" aria-expanded="' + open + '"><span class="num">' + (i + 1) + '</span>' + A.badgeHtml(st.brand) +
      '<span class="mid"><span class="nm">' + esc(P.displayName(st)) + '</span><span class="sub">Mile ' + Math.round(c.d) + ' · ' + (KIND() === 'ev' ? 'add ' : 'buy ') + s.buyGal.toFixed(1) + ' ' + UN() + ' · ~' + Math.max(1, Math.round(T.serviceMinutes(s,result.opts.fuelKind))) + ' min '+(KIND()==='ev'?'charging':'refueling') + (c.detourMi < 0.15 ? '' : ' · +' + c.detourMi.toFixed(1) + ' mi off') + '</span></span>' +
      '<span class="pr"><span class="f">' + priceHtml(c.price) + '</span>' + (c.calc.stale ? '<span class="o stale">stale</span>' : '') + (c.est ? '<span class="o est-tag">est.</span>' : '') + '</span><span class="chev"></span></button>';
    if (!open) return h + '</div>';
    h += '<div class="s-body"><div class="s-buy"><b>' + money(s.cost) + '</b> for ' + s.buyGal.toFixed(1) + ' ' + UN() + (s.propulsion&&s.propulsion.billedKWh!=null?' stored · ~'+s.propulsion.billedKWh.toFixed(1)+' kWh billed':'') + (KIND() === 'ev' ? (s.departGal >= Garage.tank() * 0.8 - 0.3 ? ' (to 80%)' : '') : S.trip.fillUp || s.departGal >= Garage.tank() - 0.05 ? ' (fill up)' : '') +
      ' · <b>~' + Math.max(1, Math.round(T.serviceMinutes(s,result.opts.fuelKind))) + ' min '+(KIND()==='ev'?'charging':'refueling')+'</b>'+(c.kw?' at ~'+Math.round(c.kw)+' kW average':'') + ' · ' + det + (c.detourMi >= 0.15 ? ' / +' + Math.max(1, Math.round(c.detourMin)) + ' min' : '') +
      ' · arrive with ~' + Math.round(s.arriveMi) + ' mi left · ' + fmtDur(s.etaSec) + ' in</div>';
    if (s.why) h += '<div class="why-not"><b>Why not the cheaper one?</b> ' + esc(s.why) + '</div>';
    if(c.citgo){var redemption=s.citgoRedemption;
      h+='<div class="lead small keep">'+(redemption?(redemption.kind==='tuesday'?'Triple Tuesday':'Five Cent Friday')+' · '+esc(redemption.month):'Everyday Club CITGO reward')+' '+A.qBtn('Monthly specials apply to the first planned eligible purchase, once per month. Later CITGO stops use everyday rewards. Club rewards cover up to 30 gallons; the price shown is the purchase average above that amount. Arrival dates include estimated fuel-stop time and use your phone’s timezone. Verify the reward in Club CITGO. Planning does not record a real fill-up.')+'</div>';
    }
    if (s.alts.length) {
      h += '<div class="alts">' + s.alts.map(function (a) {
        var ab = P.brand(a.c.station.brand);
        return '<div>' + A.logoHtml(a.c.station.brand) + esc(P.displayName(a.c.station)) + ' · mile ' + Math.round(a.c.d) + ' · ' + priceText(a.c.price) +
          (a.c.detourMi < 0.15 ? '' : ' · ' + a.c.detourMi.toFixed(1) + ' mi off') + ' <b class="' + (a.extra > 0 ? 'bad' : 'good') + '">' + (a.extra >= 0 ? '+' : '') + money(a.extra) + '</b></div>';
      }).join('') + '</div>';
    }
    h += '<div class="why hidden" id="why' + i + '">' + c.calc.steps.map(function (x) {
      return '<div class="ln"><span>' + esc(x.label) + '</span><span>' + (x.kind === 'base' ? priceText(x.amount) : x.kind === 'none' ? 'not counted' : x.amount === 0 ? 'included' : '−$' + P.fmt3(-x.amount)) + '</span></div>'; }).join('') +
      '<div class="ln tot"><span>You pay per ' + { gal: 'gallon', kWh: 'kWh', kg: 'kg' }[UN()] + '</span><span>' + priceText(c.price) + '</span></div>' +
      (st.network || st.dc || st.pricing || st.hours || st.source ? '<div class="af-info">' + [st.network, st.dc ? st.dc + ' fast port' + (st.dc === 1 ? '' : 's') + ' · ' + (st.kwEst ? '~' : '') + st.kw + ' kW' + (st.kwEst ? ' (typical for the network)' : '') : '', st.plugs && st.plugs.length && window.AltFuel ? st.plugs.map(AltFuel.plugName).join(', ') : '', st.pricing ? 'Published price information: ' + st.pricing : '', st.hours, [st.source,st.provider,st.license].filter(Boolean).join(' · '), (st.alternateSources||[]).map(function(p){return [p.source,p.provider,p.license].filter(Boolean).join(' · ');}).join('; ')].filter(Boolean).map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') + '</div>' : '') + '</div>';
    h += '<div class="s-act"><button data-why="' + i + '">Price breakdown</button><button data-nav="' + i + '">Navigate</button></div>';
    if(c.citgo&&P.citgoBonus(S,new Date())!=='none')h+='<div class="s-act"><button data-citgo-fill="'+i+'">Record actual CITGO fill-up…</button></div>';
    if (A.bl) h += A.bl.buttons(st, 'ts' + i, result.grade);
    h += '</div></div>';
    return h;
  }


  var dotsRenderer = null, dots = [];
  // MapVisuals sizes all fuel dots and route strokes throughout zoom gestures/animations.
  map.on('zoomend', tierDots);
  /** The other stations' dots on the trip map: zoomed out only the cheapest few percent (P.mapTier), every one at zoom 12. */
  function tierDots() {
    var t = P.mapTier(dots.map(function (d) { return d._tier; }), map.getZoom());
    dots.forEach(function (d) { var on = !dotsHidden && t.ids.has(d._tier.id); if (on && !layer.hasLayer(d)) layer.addLayer(d); else if (!on && layer.hasLayer(d)) layer.removeLayer(d); });
  }
  var drawn = {}, stopTips = [], routeLL = null, selLL = null, pinT = 0, leaderLayer = L.layerGroup();
  /** Price bubbles placed like the route labels on the small maps: off the route (and the highlighted road), off each other, and out from under the panel and the top bar. */
  function placePins() {
    if (!stopTips.length || !map.hasLayer(layer)) return;
    var lines = [{ pts: routeLL || [] }];
    if (selLL) { lines.push({ pts: selLL }); lines.push({ pts: selLL }); }   // the highlighted road counts double
    var sz = map.getSize(), cover = sheetCover();
    // only what's actually on screen up top (the lookup counter, the settings button, the phone's status bar) —
    // not the whole width of the bar, so bubbles can use the space between them
    var st = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--st')) || 0;
    var tops = Labels.rectsOf(map, Array.prototype.filter.call(document.querySelectorAll('.top .bar > *, #btnArea, #status'), function (e) { return getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; }), 6);
    if (!layer.hasLayer(leaderLayer)) layer.addLayer(leaderLayer);
    placeLabels(map, stopTips, -1, lines, [{ x: 0, y: sz.y - cover, w: sz.x, h: cover }, { x: 0, y: 0, w: sz.x, h: st + 4 }].concat(tops),
      { leaders: leaderLayer, leaderPane: 'tleaders' });
  }
  function placePinsSoon() { clearTimeout(pinT); pinT = setTimeout(placePins, 30); }
  // the bubbles keep out from under the panel: placed again whenever it changes size (drag, speed by road, …)
  if (window.ResizeObserver) { var roT = 0; new ResizeObserver(function () { clearTimeout(roT); roT = setTimeout(placePinsSoon, 120); }).observe($('trip')); }
  map.on('zoomend moveend', placePinsSoon);
  function drawRoute() {
    var r0 = result, key = { model: model, result: r0, plan: r0 && r0.plan, top: r0 && r0.top, cands: r0 && r0.cands, dep: step === ST_DEPART };
    if (map.hasLayer(layer) && Object.keys(key).every(function (x) { return drawn[x] === key[x]; })) return;
    drawn = key;
    layer.clearLayers();
    if (!map.hasLayer(layer)) layer.addTo(map);
    // long routes have 100,000+ points: draw one about every 1/20 mile (plenty at any zoom you'd use on a trip)
    var ll = [], lastD = -1;
    model.pts.forEach(function (p, i) { if (model.cum[i] - lastD >= 0.05 || i === model.pts.length - 1) { ll.push([p.lat, p.lng]); lastD = model.cum[i]; } });
    L.polyline(ll, { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(ll, { color: '#1a73e8', weight: 5, opacity: 0.95, interactive: false }).addTo(layer);
    var mk = function (p, cls, html) { return L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pin', html: '<div class="' + cls + '">' + html + '</div>', iconSize: null }), keyboard: false }); };
    mk(model.pts[0], 'tend', 'A').addTo(layer);
    mk(model.pts[model.pts.length - 1], 'tend', 'B').addTo(layer);
    if (result) {
      var chosen = {};
      if (result.plan.ok) result.plan.stops.forEach(function (s, i) { chosen[s.c.id] = i + 1; });
      // hundreds of stations on a long trip: drawn on one canvas, in a layer above the route line (like the pins)
      if (!map.getPane('tdots')) { var pn = map.createPane('tdots'); pn.style.zIndex = 590; }
      var cv = A.dotsRenderer;
      var ring = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#ffffff';
      dots = [];
      // one dot per station (a round trip passes each twice: the cheaper of its two), the cheapest few when zoomed out (tierDots)
      var seenSt = new Map(), stopSt = new Set();
      result.cands.forEach(function (c) { if (chosen[c.id]) stopSt.add(c.station.id); });
      result.cands.forEach(function (c) {
        if (chosen[c.id] || step === ST_DEPART || stopSt.has(c.station.id)) return;           // Departure: only your stops (the rest is noise by then)
        var was = seenSt.get(c.station.id); if (was && !(Number.isFinite(c.price) && (was.price == null || c.price < was.price))) return;
        if (was) { dots.splice(dots.indexOf(was.dot), 1); }
        var dot = L.circleMarker([c.lat, c.lng], { renderer: cv, pane: 'tdots', radius: 6, color: ring, weight: 2, fillColor: P.brand(c.station.brand).color, fillOpacity: 1 });
        dot._tier = { id: c.station.id, price: Number.isFinite(c.price) ? c.price : null };
        seenSt.set(c.station.id, { dot: dot, price: dot._tier.price });
        dots.push(dot);
        dot
          .bindPopup('<b>' + esc(P.displayName(c.station)) + '</b><br>' + priceText(c.price) + ' · mile ' + Math.round(c.d) +
            (c.detourMi >= 0.15 ? ' · ' + c.detourMi.toFixed(1) + ' mi detour' : ''));
      });
      tierDots();
      if (result.top) chosen[result.top.c.id] = 'T';
      // the chosen stops: a dot on the station and a price bubble beside it that moves out of the way of the roads
      stopTips = [];
      // one bubble per station: a station you stop at twice (going and coming back) shows both numbers, "3, 6"
      var groups = [], byStation = {};
      (result.plan.ok?result.plan.stops.map(function(s){return s.c;}):[]).concat(result.top?[result.top.c]:[]).forEach(function (c) {
        if (!chosen[c.id]) return;
        var key = c.station.id, g = byStation[key];
        if (!g) { g = byStation[key] = { c: c, nums: [], prices: [] }; groups.push(g); }
        g.nums.push(chosen[c.id]); g.prices.push(c.price);
      });
      groups.forEach(function (g) {
        var c = g.c;
        g.nums.sort(function (a, b) { return (a === 'T' ? 99 : a) - (b === 'T' ? 99 : b); });
        var label = g.nums.join(', '), lo = Math.min.apply(null, g.prices), hi = Math.max.apply(null, g.prices);
        L.circleMarker([c.lat, c.lng], { pane: 'tdots', renderer: cv, radius: 5, color: '#ffffff', weight: 2, fillColor: '#18a957', fillOpacity: 1, interactive: false }).addTo(layer);
        var pv = priceHtml(lo) + (hi - lo > 0.0005 ? '–' + priceHtml(hi) : '');
        var full = '<span class="b">' + label + '</span>' + A.logoHtml(c.station.brand) + '<span class="pv">' + pv + '</span>', small = '<span class="b">' + label + '</span>';
        var tip = L.tooltip({ permanent: true, direction: 'top', offset: [0, -9], className: 'stopbub', interactive: true, opacity: 1, pane: 'tooltipPane' })
          .setLatLng([c.lat, c.lng]).setContent(full);
        layer.addLayer(tip);
        (function (which) {
          var te = tip.getElement(); if (!te) return;
          L.DomEvent.disableClickPropagation(te);
          te.addEventListener('click', function () { openStopTile(which); });
        })(g.nums[0]);
        (function (tip, full, small) {
          var cur = false;
          stopTips.push({ k: stopTips.length, cands: [L.latLng(c.lat, c.lng)], tip: tip, color: '#18a957',
            compact: function (on) { if (on === cur) return; cur = on; tip.setContent(on ? small : full); var te = tip.getElement(); if (te) te.classList.toggle('mini', on); } });
        })(tip, full, small);
      });
    }
    routeLL = ll;
    placePinsSoon();
    var nb = L.latLngBounds(ll);
    if (!routeBounds || !routeBounds.equals(nb)) { routeBounds = nb; userMoved = false; }   // a new route: frame it again
    fitBtn();
  }

  // ---------- keep the whole route in view above the sheet ----------
  // The map frames the route in the part of the screen the sheet doesn't cover, and re-frames it when the sheet grows
  // or shrinks — until you pan or zoom yourself; then a button brings the route back.
  var routeBounds = null, userMoved = false, fitting = false;
  var FIT_ICON = '<svg viewBox="0 0 24 24"><path d="M5 15H3v4a2 2 0 0 0 2 2h4v-2H5v-4zM5 5h4V3H5a2 2 0 0 0-2 2v4h2V5zm14-2h-4v2h4v4h2V5a2 2 0 0 0-2-2zm0 16h-4v2h4a2 2 0 0 0 2-2v-4h-2v4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>';
  /** How much of the screen the panel covers — its target height, not mid-animation (so framing is right straight away). */
  function sheetCover() {
    var el = $('trip'); if (!el || el.classList.contains('hidden')) return 0;
    if (el.classList.contains('full')) return innerHeight;
    var v = el.style.getPropertyValue('--panel-h').trim(), px = /vh$/.test(v) ? parseFloat(v) * innerHeight / 100 : parseFloat(v);
    if (el.classList.contains('tall')) px = 0.75 * innerHeight;
    return px > 0 ? Math.min(px, innerHeight) : el.getBoundingClientRect().height;
  }
  function fitRoute(animate) {
    if (!routeBounds || !document.body.classList.contains('trip-on')) return;
    fitting = true;
    map.fitBounds(routeBounds, { paddingTopLeft: [24, 100], paddingBottomRight: [24, sheetCover() + 18], animate: animate !== false, maxZoom: 15 });
    setTimeout(function () { fitting = false; }, animate === false ? 50 : 450);
  }
  function fitBtn() {
    var b = $('btnFit');
    if (!b) {
      b = document.createElement('button'); b.id = 'btnFit'; b.className = 'fab-fit hidden'; b.setAttribute('aria-label', 'Show the whole route');
      b.innerHTML = FIT_ICON + '<span>Route</span>';
      document.body.appendChild(b);
      b.onclick = function () { userMoved = false; fitBtn(); fitRoute(true); };
    }
    var on = userMoved && routeBounds && (step >= ST_ADJ || step === ST_HAZ) && document.body.classList.contains('trip-on') && !$('trip').classList.contains('hidden');
    b.classList.toggle('hidden', !on);
    if (on) b.style.bottom = (sheetCover() + 12) + 'px';
  }
  map.on('dragstart', function () { if (!fitting) { userMoved = true; fitBtn(); } });
  map.on('zoomstart', function () { if (!fitting && routeBounds && document.body.classList.contains('trip-on')) { userMoved = true; fitBtn(); } });
  /**
   * The panel is as tall as you drag it. The one exception: with "Speed by road" open and on screen, it grows to at
   * least ~75% so the chart and the sliders fit together (and drops back to your height when you close it).
   */
  function sheetSize() {
    var el = $('trip'), sp = $('tsSpeed'), body = tpBody(); if (!el || el.classList.contains('hidden') || !body) return;
    var tall = false;
    // the per-road sliders are a submenu: open = in it (everything else on Adjustments steps aside)
    if (sp && sp.classList.contains('exp') && step === ST_ADJ) tall = true;
    else sizedInMode = false;
    inMode = tall; if (sizedInMode) tall = false;   // you dragged the panel while adjusting: your height wins until you leave
    backMode();
    if (el.classList.contains('tall') === tall) return;
    el.classList.toggle('tall', tall);
    backMode();
    setTimeout(function () { if (!userMoved) fitRoute(true); fitBtn(); placePinsSoon(); }, 260);
  }
  /** Adjusting speed by road (the panel at 75%): Back becomes an arrow that leaves that mode; then it's Back again. */
  // ---------- adjusting speed by road: a submenu ----------
  // While the per-road sliders are open and on screen, the panel sits at 75%, the step tabs make way (the chart moves
  // up beside the ✕), and the bottom buttons become Discard (back to the speeds you had when you came in) and
  // Save and continue.
  var inMode = false, sizedInMode = false, modeSnap = null;
  function speedMode() { return step === ST_ADJ && inMode && !$('trip').classList.contains('hidden'); }
  function snapSpeeds() {
    var st = result && result.speedState || {};
    return { offsets: JSON.parse(JSON.stringify(st.offsets || {})), all: st.all, bufMi: result ? result.bufMi : null };
  }
  var dotsHidden = false;
  function backMode() {
    if(step===ST_HAZ&&routeReview){var b=$('tBack'),n=$('tNext');if(b)b.textContent='No';if(n){n.classList.remove('busy');n.textContent='Yes';}return;}
    var on = speedMode(), pg = $('trip');
    // adjusting speed by road: only the route, its stretches and your stops on the map (the other stations are noise there)
    if (on !== dotsHidden) { dotsHidden = on; tierDots(); }
    if (on && !modeSnap) modeSnap = snapSpeeds();
    if (!on && !inMode) modeSnap = null;
    if (pg) pg.classList.toggle('submode', on);
    var b = $('tBack'), n = $('tNext');
    if (b && b._sub !== on) { b._sub = on; b.textContent = on ? 'Discard adjustments' : 'Back'; b.classList.toggle('discard', on); }
    if (n && !n.classList.contains('busy') && n._sub !== on) { n._sub = on; n.textContent = on ? 'Save adjustments' : 'Next'; }
  }
  /** Save and continue: keep the speeds and close the per-road sliders. */
  function leaveSpeedMode() {
    var t = $('lgTog'); if (t && $('tsSpeed') && $('tsSpeed').classList.contains('exp')) { t.click(); }
    modeSnap = null; sheetSize(); backMode();
  }
  /** Discard: back to the speeds (and buffer) you had when you opened the per-road sliders. */
  async function discardSpeedMode() {
    if(!await A.confirmDiscard())return;
    var snap = modeSnap, r = result;
    if (snap && r) {
      var st = r.speedState = r.speedState || {};
      var changed = JSON.stringify(st.offsets || {}) !== JSON.stringify(snap.offsets) || st.all !== snap.all || r.bufMi !== snap.bufMi;
      st.offsets = snap.offsets; st.all = snap.all;
      if (changed) {
        LG.info('speed', 'Speed changes discarded');
        S.speed.view = S.speed.view || {}; S.speed.view.open = false; A.save();
        modeSnap = null; replan(snap.bufMi); sheetSize(); backMode(); return;
      }
    }
    leaveSpeedMode();
  }
  function panelDrag(pg) {
    var vh = function () { return window.innerHeight; };
    pg.style.setProperty('--panel-h', '75vh');
    // drag from the handle, or from the step tabs under it (a drag there moves the panel; a tap still picks the tab)
    var y0 = 0, start = 0, dragging = false, pending = false, src = null, pid = 0, ate = false;
    var down = function (e) {
      if (pg.classList.contains('full') || e.button > 0) return;
      var b = e.target.closest('button');
      if (b && !b.closest('.tp-grab') && !b.closest('#tpSteps')) return;      // the ✕ is just a button
      pending = true; dragging = false; y0 = e.clientY; start = pg.getBoundingClientRect().height; src = e.currentTarget; pid = e.pointerId;
      // follow the finger anywhere until it lifts (it soon leaves the handle)
      document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
    };
    var begin = function () {
      dragging = true; pg.classList.add('dragging'); pg.classList.remove('tall');
    };
    var move = function (e) {
      if (!pending) return;
      if (!dragging) { if (Math.abs(e.clientY - y0) < 8) return; begin(); }
      var h = Math.max(vh() * 0.2, Math.min(vh() * 0.94, start + (y0 - e.clientY)));
      pg.style.setProperty('--panel-h', h + 'px');
      e.preventDefault();
    };
    var up = function () {
      document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true);
      pending = false;
      if (!dragging) return; dragging = false; pg.classList.remove('dragging');
      ate = true; setTimeout(function () { ate = false; }, 350);   // the tap that ends a drag doesn't also pick a tab
      var f = pg.getBoundingClientRect().height / vh();
      pg.style.setProperty('--panel-h', (f * 100) + 'vh');
      sheetSize(); if (inMode) { sizedInMode = true; sheetSize(); }   // dragged while adjusting speeds: your height wins
      if (!userMoved) fitRoute(true); fitBtn();
    };
    pg.addEventListener('click', function (e) { if (ate && e.target.closest('#tpSteps')) { e.stopPropagation(); e.preventDefault(); ate = false; } }, true);
    [$('tpGrab'), pg.querySelector('.tp-head')].forEach(function (h) {
      h.addEventListener('pointerdown', down);
    });
    $('tpBody').addEventListener('scroll', sheetSize, { passive: true });
    $('tpBody').addEventListener('scroll', roadSelSoon, { passive: true });
  }

  // ---------- speed by road: a selector that shows the road on the map ----------
  // While "Speed by road" is open, a green band sits just under the pinned chart and filters. Scroll the roads through
  // it: the stretch mostly inside the band is drawn in green on the map and the map frames it (with room around it).
  var selLayer = L.layerGroup(), selKey = null, selT = 0, selRaf = 0;
  function roadSelSoon() { if (!selRaf) selRaf = requestAnimationFrame(function () { selRaf = 0; roadSel(); }); }
  function roadSel() {
    var pg = $('trip'), sp = $('tsSpeed'), band = $('spdSel');
    var on = sp && sp.classList.contains('exp') && step === ST_ADJ && !pg.classList.contains('hidden') && sp.offsetParent;
    var tools = on && sp.querySelector('.adj-tools'), legs = on ? sp.querySelectorAll('.leg[data-mi]') : [];
    if (!on || !tools || !legs.length) { if (band) band.classList.add('hidden'); clearSel(); return; }
    if (!band) { band = document.createElement('div'); band.id = 'spdSel'; band.className = 'spd-sel'; pg.appendChild(band); }
    var pr = pg.getBoundingClientRect(), br = tpBody().getBoundingClientRect(), tr = tools.getBoundingClientRect();
    var top = Math.max(tr.bottom, br.top), H = 60;
    var last = legs[legs.length - 1].getBoundingClientRect(), first = sp.querySelector('.road-g').getBoundingClientRect();
    var vis = top + H < br.bottom && last.bottom > top && first.top < top + H;
    band.classList.toggle('hidden', !vis);
    band.style.top = (top - pr.top) + 'px'; band.style.height = H + 'px';
    if (!vis) { clearSel(); return; }
    var best = null, bestO = 0;
    legs.forEach(function (e) {
      var r = e.getBoundingClientRect(), o = Math.min(r.bottom, top + H) - Math.max(r.top, top);
      if (o > bestO) { bestO = o; best = e; }
    });
    sp.querySelectorAll('.leg.insel').forEach(function (e) { if (e !== best) e.classList.remove('insel'); });
    if (!best) { clearSel(); return; }
    best.classList.add('insel');
    var key = best.dataset.mi;
    if (key === selKey) return;
    selKey = key;
    clearTimeout(selT);
    selT = setTimeout(function () { showStretch(key); }, 140);
  }
  /** Draw miles a–b of the route in green and frame them above the panel, with more room than the Route button gives. */
  function showStretch(key) {
    if (!model || selKey !== key) return;
    var ab = key.split(',').map(Number), a = ab[0], b = ab[1], ll = [], lastD = -1;
    var step0 = Math.max(0.05, (b - a) / 800);
    for (var i = 0; i < model.pts.length; i++) {
      var d = model.cum[i]; if (d < a) continue; if (d > b) break;
      if (d - lastD >= step0) { ll.push([model.pts[i].lat, model.pts[i].lng]); lastD = d; }
    }
    if (ll.length < 2) return;
    selLayer.clearLayers(); if (!map.hasLayer(selLayer)) selLayer.addTo(map);
    selLL = ll;
    L.polyline(ll, { color: '#ffffff', weight: 13, opacity: 0.95, interactive: false }).addTo(selLayer);
    L.polyline(ll, { color: '#18a957', weight: 8, opacity: 1, interactive: false }).addTo(selLayer);
    fitting = true;
    map.flyToBounds(L.latLngBounds(ll), { paddingTopLeft: [70, 120], paddingBottomRight: [70, sheetCover() + 70], maxZoom: 13, duration: 0.45 });
    setTimeout(function () { fitting = false; }, 650);
  }
  function clearSel() {
    clearTimeout(selT);
    var had = selKey != null || selLayer.getLayers().length;
    selKey = null; selLayer.clearLayers(); selLL = null;
    var sp = $('tsSpeed'); if (sp) sp.querySelectorAll('.leg.insel').forEach(function (e) { e.classList.remove('insel'); });
    if (had && onPlan(step) && !userMoved) fitRoute(true);
  }

  // ---------- open / close ----------
  // The ✕ closes the planner; the trip stays in history (it was saved when its stations were found) and can be
  // continued from the Trip button until a new one is started.
  function closePage() { show($('trip'), false); }
  /** A trip opened, started or closed: Adjustments starts fresh (not inside speed by road, scrolled to the top). */
  function resetAdjust() {
    if (S.speed && S.speed.view && S.speed.view.open) { S.speed.view.open = false; A.save(); }
    inMode = false; sizedInMode = false; modeSnap = null;
    var pg = $('trip'); if (pg) pg.classList.remove('submode', 'tall');
  }
  function closeTrip() {
    collectSafe();compareCapture();if(window.VehicleCompareUI)VehicleCompareUI.dispose();
    hzRiskAcks=new WeakMap();
    closePage();mapLoaded();
    resetAdjust();
    closeLegs(); clearSel(); if ($('spdSel')) $('spdSel').classList.add('hidden'); collectSafe(); closePage(); closeQ(); mapLoaded();
    layer.clearLayers(); drawn = {}; if (map.hasLayer(layer)) map.removeLayer(layer);
    stopRecommendations();clearRecommendationMaps();
    document.body.classList.remove('trip-on', 'trip-full'); routeBounds = null; fitBtn(); hzSync(); requestAnimationFrame(function(){setTimeout(function(){if($('trip').classList.contains('hidden'))A.render();},0);});
    if (A.jobDraw && A.job && A.job()) A.jobDraw();
  }
  function endTrip() { closeTrip(); }
  function closeQ() { if (window.__closeQ) window.__closeQ(); }
  window.__tripBack = function () {
    if (closePicker()) return true;
    if (closeLegs()) return true;
    if (!$('trip').classList.contains('hidden')) {
      if(step===ST_HAZ&&routeReview){reviewBack();return true;}
      if (speedMode()) { leaveSpeedMode(); return true; }
      var previous=step-1;while(previous>ST_ADVISORY&&jobLocked(previous))previous--;
      if (step > 1 && !jobLocked(previous)) leaveAsk(function () { collectSafe(); step=previous; renderStep(); });
      else leaveAsk(closeTrip);     // the step before is closed while a search runs: Back leaves the trip instead
      return true;
    }
    return false;
  };
  $('btnTrip').onclick = function () { tripPicker(); };

  // Google Maps -> Share directions -> Gasket
  window.onSharedText = function (text) {
    closePicker(); newTrip(text);
  };
  if (window.__pendingShare) { var t0 = window.__pendingShare; window.__pendingShare = null; window.onSharedText(t0); }

  // the car's recalls and VIN check run in the background soon after the app starts (NHTSA, never Google), so Advisory is ready
  setTimeout(function () { if (window.Advisory) Advisory.init(call); }, 4000);
  // Vehicle plans own all mutable planner state. Only raw provider caches are shared.
  function compareReset(){compareEntries.clear();compareOwner=null;compareReviewed=0;compareReviewKey=null;compareJourney=null;compareView={sort:'cost',scope:'trip',leg:0,open:{}};if(window.VehicleCompareUI)VehicleCompareUI.dispose();}
  function compareSafetyKey(){return VehicleCompare.key([VehicleCompare.profile(Garage.car()),VehicleCompare.journey(route,S.trip),choiceLists().map(function(l,i){return altSig(l[hzSel(i)]);})]);}
  function compareSettingsKey(){return VehicleCompare.key(['walmartPlus','samsMode','cashbackPct','citgoTier','citgoUsed','citgoHistory','brands','blacklist','dieselRisk','staleHours','evPrice','evPriceAgeHours','evAllowUnknownPrices'].map(function(k){return S[k];}));}
  function compareLocked(){return !!(busy||routing||choicePlanning||hzRiskBusy||compareEditing||compareCalculating);}
  function comparePersist(){
    if(!route||!route.histId)return;var o=A.KV.get('trips','trip|'+route.histId);if(!o||!o.v)return;
    o.v.comparison=Array.from(compareEntries.values()).map(function(s){return VehicleCompare.portable(s);});A.KV.put('trips','trip|'+route.histId,o.v);
  }
  function compareCapture(){
    if(compareEditing||compareSwitching||!route||!model)return;
    if(compareOwner&&compareOwner!==S.carId)return;
    var car=Garage.car(),old=compareEntries.get(car.id),journey=VehicleCompare.journey(route,S.trip),places=VehicleCompare.key(route.stops.map(function(s){return [s.lat,s.lng,s.label||s.address];}));
    if(compareJourney&&compareJourney.places!==places){compareEntries.clear();old=null;compareReviewed=0;A.toast('Destinations changed. Vehicle comparison restarted for this trip.');}
    else if(compareJourney&&compareJourney.key!==journey){compareEntries.forEach(function(s){if(s.id!==car.id){['depart','departNow','returnTrip','backAuto','backAt'].forEach(function(k){s.trip[k]=S.trip[k];});s.result=null;s.reviewedAt=0;s.needsReview=true;s.hzCache=null;}});compareReviewed=0;}
    compareJourney={places:places,key:journey};compareOwner=car.id;
    var profile=VehicleCompare.profile(car),settingsKey=compareSettingsKey(),changed=old&&(old.profile!==profile||old.settingsKey&&old.settingsKey!==settingsKey);
    if(changed){compareReviewed=0;result=null;model=T.buildRoute(rawRoute,carModel());hzCache=new WeakMap();hzModels=new WeakMap();hzRiskAcks=new WeakMap();}
    if(compareReviewKey!==compareSafetyKey())compareReviewed=0;
    var hazards=[];for(var i=0;i<hzLegs();i++){var a=hzAlts(i)[hzSel(i)],e=a&&hzCache.get(a),offset=i&&model.legEnds?model.legEnds[i-1]:0;(e&&e.hz||[]).forEach(function(x){hazards.push(Object.assign({},x,{fromMi:x.fromMi+offset,toMi:x.toMi+offset}));});}
    var s={id:car.id,profile:profile,kind:KIND(),trip:VehicleCompare.clone(S.trip),speed:VehicleCompare.clone(S.speed),route:route,alts:alts,altSel:altSel,altSure:altSure,rawRoute:rawRoute,model:model,result:result,replay:replay,evRates:evRates,hzCache:hzCache,hzModels:hzModels,hzRiskAcks:hzRiskAcks,hzLeg:hzLeg,choiceSavedId:choiceSavedId,choiceChecked:choiceChecked,choiceReviewedAt:choiceReviewedAt,choiceComplete:choiceComplete,choicePool:choicePool,choiceCandidates:choiceCandidates,routeReview:routeReview,reviewedAt:compareReviewed,needsReview:!compareReviewed,hazards:hazards,tolls:choiceLists().map(function(l,i){return tollsOf(l[hzSel(i)]);}),startEstimated:!(+S.trip[tankPriceKey()]>0),resumeStep:step===ST_COMPARE?old&&old.resumeStep||ST_ADVISORY:Math.min(step,ST_STOPS)};
    Object.defineProperty(s.trip,'routeChoices',{value:VehicleCompare.clone(S.trip.routeChoices||{}),writable:true,configurable:true,enumerable:false});
    s.speedTiming=KIND()==='gas'&&!speedOff()?flatSecs(model).map(function(sc,i){var offsets=result&&result.speedState&&result.speedState.offsets||{};return Object.assign({},sc,{offset:offsets[i]==null?Garage.ruleOff(sc.limit):offsets[i],lo:25,hi:Math.max(80,+S.speed.max||84)});}):[];
    s.reviewKey=compareReviewKey;s.settingsKey=settingsKey;compareEntries.set(car.id,s);comparePersist();
  }
  function compareUsable(s){return !!(s&&s.result&&s.result.plan.ok&&s.reviewedAt&&Date.now()-s.reviewedAt<3600000&&s.settingsKey===compareSettingsKey()&&s.profile===VehicleCompare.profile(S.cars.find(function(c){return c.id===s.id;}))&&!s.needsReview);}
  function compareSwitch(id,restoreOnly){
    if(compareLocked())return false;if(!restoreOnly){collectSafe();compareCapture();}var s=compareEntries.get(id),car=S.cars.find(function(c){return c.id===id;});if(!car)return false;
    var seed=compareEntries.get(compareOwner);
    if(!s){if(!seed){A.toast('Plan a route first.');return false;}s=VehicleCompare.portable(seed);s.id=id;s.profile=VehicleCompare.profile(car);s.kind=null;s.trip.fuel=null;s.trip.milesLeft='';s.trip.evDestinations=null;['tankPrice','evTankPrice','h2TankPrice'].forEach(function(k){s.trip[k]='';});s.replay=null;s.reviewedAt=0;s.resumeStep=ST_ADVISORY;compareEntries.set(id,s);}
    if(seed&&seed.id!==id)['depart','departNow','returnTrip','backAuto','backAt'].forEach(function(k){s.trip[k]=seed.trip[k];});
    compareSwitching=true;stopRecommendations();clearRecommendationMaps();clearSel();resetAdjust();clearTimeout(staleT);modelStale=false;resetSteps();choiceEpoch++;
    S.carId=id;S.trip=VehicleCompare.clone(s.trip);S.speed=VehicleCompare.clone(s.speed);Object.defineProperty(S.trip,'routeChoices',{value:VehicleCompare.clone(s.trip.routeChoices||{}),writable:true,configurable:true,enumerable:false});
    route=s.route;alts=s.alts;altSel=s.altSel||0;altSure=!!s.altSure;rawRoute=s.rawRoute||alts[altSel];
    // Gas inventories contain raw prices for all available grades. Refilter/reproject for
    // this car; never share adjusted prices, fuel readings, EV connector results or plans.
    if(!s.kind&&seed&&seed.kind==='gas'&&KIND()==='gas')s.replay=VehicleCompare.clone(seed.replay);
    var changed=s.profile!==VehicleCompare.profile(car)||s.settingsKey&&s.settingsKey!==compareSettingsKey();model=!changed&&s.model||T.buildRoute(rawRoute,carModel());result=!changed?s.result||null:null;replay=s.replay||null;evRates=s.evRates||null;
    hzCache=!changed&&s.hzCache||new WeakMap();hzModels=!changed&&s.hzModels||new WeakMap();hzRiskAcks=!changed&&s.hzRiskAcks||new WeakMap();hzLeg=s.hzLeg||0;hzFitKey=null;
    choiceOwner=id;choiceSavedId=s.choiceSavedId||route.histId||null;choiceChecked=!!s.choiceChecked;choiceReviewedAt=s.choiceReviewedAt||0;choiceComplete=!!s.choiceComplete;choicePool=s.choicePool||null;choiceCandidates=s.choiceCandidates||new Map();routeReview=s.routeReview||null;
    compareOwner=id;compareReviewed=changed?0:s.reviewedAt||0;compareReviewKey=s.reviewKey||null;if(compareReviewed&&Date.now()-compareReviewed>=3600000){compareReviewed=0;hzCache=new WeakMap();hzRiskAcks=new WeakMap();}
    evRecovery=null;adjustError='';opened={};routeBounds=null;userMoved=false;layer.clearLayers();drawn={};compareSwitching=false;A.save();window.dispatchEvent(new Event('garagechange'));return true;
  }
  function compareGarageChanged(){
    if(compareEditing||compareSwitching)return true;
    if(!compareOwner||compareOwner===S.carId)return false;
    var next=S.carId;S.carId=compareOwner;compareCapture();S.carId=compareOwner;
    if(compareSwitch(next)){step=ST_GARAGE;setTimeout(renderStep,0);}return true;
  }
  function compareRows(){return Array.from(compareEntries.values()).filter(function(s){return S.cars.some(function(c){return c.id===s.id;});}).map(function(s,i){var usable=compareUsable(s),metrics=VehicleCompare.metrics(s,compareView.scope==='leg'?compareView.leg:null);metrics.ready=usable;return {id:s.id,car:S.cars.find(function(c){return c.id===s.id;}),kind:s.kind,session:s,order:i,metrics:metrics,reviewed:usable,canUse:usable,status:usable?'Ready':s.result&&s.result.plan.ok?'Review needed':'Setup needed',message:usable?(metrics.cost==null?'Some prices or tolls are unknown.':metrics.estimated?'Includes estimated energy prices.':''):'Review this vehicle’s setup and hazards before departure.',hazardsText:s.hazards&&s.hazards.length?s.hazards.length+' hazard areas. Review the Hazards step for details.':'Open Hazards for current conditions; no safety guarantee.'};});}
  function compareRender(){
    var e=$('tCompare');if(!e)return;
    VehicleCompareUI.render(e,{view:compareView,rows:compareRows,selected:function(){return S.carId;},legs:function(){return route?route.stops.slice(1).map(function(s,i){return (i+1)+': '+stopName(route.stops[i])+' → '+stopName(s);}):[];},locked:compareLocked,redraw:compareRender,edit:compareEdit,plan:function(id){if(compareSwitch(id)){step=compareUsable(compareEntries.get(id))?ST_PARAMS:ST_ADVISORY;renderStep();}},use:function(id){if(!compareUsable(compareEntries.get(id)))return;if(compareSwitch(id)){step=ST_DEPART;renderStep();}},pick:comparePick,add:compareAdd,start:function(){step=model?ST_ADVISORY:ST_GARAGE;renderStep();}});A.qify(e);
    if($('tNext'))$('tNext').disabled=compareLocked()||!compareUsable(compareEntries.get(S.carId));
  }
  function comparePick(){
    if(compareLocked())return;if(!model){step=ST_GARAGE;renderStep();return;}var cars=S.cars.filter(function(c){return !compareEntries.has(c.id);});
    if(!cars.length){A.toast('All garage vehicles are listed. Use Review setup to plan one, or Add vehicle.');return;}
    var close=A.subPage('Compare another vehicle',cars.map(function(c){return '<button class="btn tonal vc-pick" data-compare-car="'+esc(c.id)+'">'+esc(Garage.shortName(c))+'</button>';}).join(''),function(b){b.querySelectorAll('[data-compare-car]').forEach(function(el){el.onclick=function(){close();if(compareSwitch(el.dataset.compareCar)){step=ST_ADVISORY;renderStep();}};});});
  }
  function compareEdit(id){
    if(!compareSwitch(id))return;step=ST_COMPARE;renderStep();var before=VehicleCompare.profile(Garage.car()),previous=result,kind=KIND(),grade=gradeOf();compareEditing=true;
    Garage.render($('vcEditorHost'),null,function(){},call);Garage.editVehicle(function(saved){compareEditing=false;var changed=saved&&before!==VehicleCompare.profile(Garage.car());if(changed){compareReviewed=0;result=null;model=T.buildRoute(rawRoute,carModel());hzCache=new WeakMap();hzModels=new WeakMap();hzRiskAcks=new WeakMap();S.trip.routeChoices={};routeReview=null;choiceComplete=false;choicePool=null;choiceCandidates=new Map();choiceReviewedAt=0;compareEntries.delete(id);}step=ST_COMPARE;renderStep();if(changed){if(previous&&kind==='gas'&&KIND()===kind&&grade===gradeOf())compareRecalculate(previous);else A.toast('Vehicle updated. Review setup to recalculate its trip.');}});
  }
  function compareRecalculate(previous){
    // Same fuel/grade and geometry: reuse priced candidates, but recalculate consumption,
    // capacity, tire/vehicle effects and speed rates. Other connector/grade changes need discovery.
    var id=S.carId,r=Object.assign({},previous,{plan:{ok:false,stops:[]},routes:null,sweep:null,dsweep:null,top:null,topSel:-1,speedState:VehicleCompare.clone(previous.speedState)});
    r.startGal=startFuel(model);r.bufMi=tripBuf();r.opts=makeOpts(model,r.cands,r.startGal);result=r;
    var cx=speedCx();if(cx)r.opts.model=T.withSpeeds(model,ratesOf(cx,cx.offs));r.planOffs=cx?cx.offs.join(','):null;
    compareCalculating=id;var end=window.Tasks?Tasks.begin('vehicle-comparison',{text:'Recalculating this vehicle’s trip',priority:1}):function(){};compareCapture();compareRender();
    planAsync(r.opts,function(){return S.carId===id&&result===r;},100).then(function(p){if(S.carId!==id||result!==r)return;r.plan=p;recompute();LG.info('compare','Recalculated edited vehicle',{kind:KIND(),ok:p.ok,candidates:r.cands.length});},function(e){LG.warn('compare','Edited vehicle needs replanning',String(e));}).finally(function(){end();compareCalculating=null;compareCapture();if(step===ST_COMPARE)compareRender();});
  }
  function compareAdd(){
    if(compareLocked())return;compareCapture();var previous=S.carId;compareEditing=true;
    Garage.render($('vcEditorHost'),null,function(){},call);Garage.addVehicle(function(saved){compareEditing=false;var id=S.carId;if(!compareEntries.size){S.carId=saved?id:previous;compareOwner=null;step=saved?ST_ADVISORY:ST_COMPARE;A.save();renderStep();return;}S.carId=previous;if(compareSwitch(saved?id:previous,true)){step=saved?ST_ADVISORY:ST_COMPARE;renderStep();}});
  }
  window.__trip = { call: call, open: openTrip, steps:{COMPARE:ST_COMPARE,DEPART:ST_DEPART}, comparison:function(){compareCapture();return {selected:S.carId,rows:compareRows(),view:compareView};}, relogo: function () {
      drawn = {};
      if (result && onPlan(step)) keepScroll(renderResults);
      if (model && step >= ST_ADJ && map.hasLayer(layer)) drawRoute();
    }, close: closeTrip, blChanged: blChanged, discountsChanged: repriceRewards, openStopTile: openStopTile, guard: speedGuard, bufLimits: bufLimits, find: findStops,
    step: function (k) { collectSafe(); step = k; renderStep(); },
    /** For tests: the other stations' dots on the map now (not your stops). */
    otherDots: function () { return dots.filter(function (d) { return layer.hasLayer(d); }).length; },
    placeMs: function () { var t0 = performance.now(); placePins(); return Math.round(performance.now() - t0); },
    /** For tests: each stop bubble's box, its line (if any) and whether it's the short form; plus how many cover the route. */
    pins: function () {
      var cr = map.getContainer().getBoundingClientRect(), out = stopTips.map(function (t) {
        var e = t.tip.getElement(), r = e.getBoundingClientRect();
        return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height, mini: e.classList.contains('mini'), shown: e.style.visibility !== 'hidden' };
      });
      var leads = []; leaderLayer.eachLayer(function (l) { var ll = l.getLatLngs(); leads.push(ll.map(function (p) { var q = map.latLngToContainerPoint(p); return { x: q.x, y: q.y }; })); });
      var pts = (routeLL || []).map(function (p) { return map.latLngToContainerPoint(p); }), over = 0, cross = 0;
      out.forEach(function (r) { if (!r.shown) return; for (var i = 1; i < pts.length; i++) if (Labels._segRect(pts[i - 1], pts[i], r, 0)) { over++; break; } });
      for (var i = 0; i < leads.length; i++) for (var j = i + 1; j < leads.length; j++) if (Labels._segX(leads[i][0], leads[i][1], leads[j][0], leads[j][1])) cross++;
      return { pins: out, leads: leads.length, overRoute: over, crossings: cross };
    },
    tolls: function () { return choiceLists().map(function (l) { return l.map(function (a) { return { via: a.description, tolls: tollsOf(a), tag: tollTag(a) }; }); }); },
    state: function () { var nl = model ? hzLegs() : 0, no = 0; for (var i = 0; i < nl; i++) no += hzAlts(i).length; return { route: route, model: model, result: result, busy: busy || planning > 0, planning: planning, step: step, legs: nl, options: no,evRecovery:evRecovery?{state:evRecovery.state,checked:evRecovery.checked,usable:evRecovery.options.length,errors:evRecovery.errors}:null }; } };
})();
