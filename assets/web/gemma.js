/* Validated persistent explanations; one generation at a time across saved vehicles. */
(function(){
  'use strict';
  var A=window.__app, state={enabled:false,ready:false,supported:false,phase:'idle'}, running=null, desired=[];
  var cache=new Map(), attempted=new Set(), issues=new Map(), scheduled=0, revision='', lastIssue='';
  var scanDeferred=false,releasedForScan=false;
  var failures=new Map(),MAX_ATTEMPTS=3;
  var LG=window.FLog||{info:function(){},warn:function(){}};
  var lastStartupDiagnostics='',lastNativeSequence=0;
  function call(fn,arg){return window.__trip.call(fn,arg);}
  function current(){return window.Garage&&Garage.car();}
  function input(c){
    var pack=TirePolicy.prepare(c,TireMath),prompt=TirePolicy.prompt(pack);
    // Reserve space within native's 27 KB limit for bounded corrective retry instructions.
    if(new TextEncoder().encode(prompt).length>26500)throw new Error('The complete setup is too large for local AI; checked notices remain available.');
    return {car:c,pack:pack,prompt:prompt,key:'explanation-v2|'+TirePolicy.version+'|'+revision+'|'+JSON.stringify(pack.setup)+'|'+prompt};
  }
  function remembered(item){
    if(cache.has(item.key))return cache.get(item.key);
    var o=A.KV&&A.KV.get('aiexplanations',item.key),v=o&&o.v;
    if(v&&v.key===item.key&&typeof v.raw==='string'){var checked=TirePolicy.check(v.raw,item.pack);if(checked.ok){var got={answer:checked.ok,pack:item.pack,t:v.t};cache.set(item.key,got);return got;}}
    if(v){invalidate(item);attempted.delete(item.key);schedule();LG.warn('ai','Invalid cached explanation cleared',{carId:item.car.id});}
    return null;
  }
  function invalidate(item){cache.delete(item.key);if(A.KV)A.KV.put('aiexplanations',item.key,null);}
  function failed(item,reason){
    invalidate(item);
    var prior=failures.get(item.key),count=(prior?prior.count:0)+1;
    failures.set(item.key,{count:count,reason:reason});
    var retry=count<MAX_ATTEMPTS;
    lastIssue=retry?'AI explanation failed validation or generation. Retrying ('+(count+1)+'/'+MAX_ATTEMPTS+')…':'AI explanation could not finish after '+MAX_ATTEMPTS+' attempts. Checked tire notices remain available.';
    issues.set(item.key,lastIssue);if(retry)attempted.delete(item.key);
    LG.warn('ai','Local explanation attempt failed',{carId:item.car.id,attempt:count,maxAttempts:MAX_ATTEMPTS,reason:reason,retry:retry,answerCacheCleared:true});
  }
  function cancelGeneration(){if(running){running.cancelled=true;attempted.add(running.key);}desired=[];command('cancelAdvice');}
  function liveItem(item){return (A.S.cars||[]).some(function(c){try{return input(c).key===item.key;}catch(e){return false;}});}
  function changed(){window.dispatchEvent(new Event('gemmachange'));}
  // time left: the speed over the last 30 s of progress (a stall or a resume starts it over)
  var rateS=[];
  function leftText(bytes,total){
    var now=Date.now();if(!rateS.length||bytes<rateS[rateS.length-1].b)rateS=[];
    if(!rateS.length||bytes!==rateS[rateS.length-1].b)rateS.push({t:now,b:bytes});
    while(rateS.length>2&&now-rateS[0].t>30000)rateS.shift();
    var first=rateS[0],span=(now-first.t)/1000,rate=span>=4?(bytes-first.b)/span:0;
    if(!(rate>0))return ' · estimating time left…';
    var sec=Math.max(0,(total-bytes)/rate),min=Math.ceil(sec/60);
    return ' · '+(sec<60?'under a minute':min<60?'~'+min+' min':'~'+Math.floor(min/60)+' h '+(min%60)+' min')+' left';
  }
  function status(value){
    var priorPhase=state.phase,priorTask=state.task,priorIssue=state.error,priorReason=state.reason;
    state=Object.assign({},state,value);revision=state.revision||revision;
    if(value.startupDiagnostics){var startupKey=JSON.stringify(value.startupDiagnostics);if(startupKey!==lastStartupDiagnostics){lastStartupDiagnostics=startupKey;LG.info('ai','Android process exit and previous AI task diagnostics',value.startupDiagnostics);}}
    if(value.nativeDiagnostics&&value.nativeDiagnostics.sequence!==lastNativeSequence){lastNativeSequence=value.nativeDiagnostics.sequence;(value.nativeDiagnostics.failure?LG.warn:LG.info)('ai','Native AI stage diagnostics',value.nativeDiagnostics);}
    if(value.renderDiagnostics)LG.info('ai','Rendering during local AI',value.renderDiagnostics);
    if(state.supported&&lastIssue==='Larger AI is unavailable on this app build.')lastIssue='';
    if(state.phase!==priorPhase)LG.info('ai','Local model phase: '+state.phase,{backend:state.backend||null,cpuOnly:!!state.cpuOnly,gpuLowPriorityRequested:!!state.gpuLowPriorityRequested,gpuPatchVersion:state.gpuPatchVersion||0,bytes:state.bytes||0,ready:!!state.ready,attempt:state.attempt||1,reason:state.reason||'',error:String(state.error||'').replace(/https?:\/\/\S+/g,'[download endpoint]').slice(0,220)});
    if((state.error&&state.error!==priorIssue)||(state.reason&&state.reason!==priorReason))LG.warn('ai','Local model task update',{phase:state.phase,task:state.task||priorTask||'',bytes:state.bytes||0,attempt:state.attempt||1,reason:state.reason||'',error:String(state.error||'').replace(/https?:\/\/\S+/g,'[download endpoint]').slice(0,220)});
    if(state.error&&state.error!==priorIssue&&priorTask==='download')A.toast('Model download stopped · '+(state.bytes?'partial file kept.':'not complete.')+' Resume in Settings.');
    if(state.phase!=='download')rateS=[];
    var downloading=/^(download|verify|retry)$/.test(state.phase)||state.phase==='cancelling'&&state.task==='download', generating=/^(load|generate|cancelling)$/.test(state.phase)&&!downloading;
    if(window.Tasks){
      if(downloading)Tasks.upsert('gemma-download',{text:state.phase==='cancelling'?'Pausing model download…':state.phase==='verify'?'Verifying Gemma model…':state.phase==='retry'?'Resuming model download · attempt '+(state.attempt||2)+' / 4':'Downloading Gemma · '+(Number(state.bytes||0)/1e9).toFixed(2)+' / 3.66 GB'+leftText(Number(state.bytes||0),Number(state.total||3659530240)),frac:/verify|cancelling/.test(state.phase)?null:Number(state.bytes||0)/Number(state.total||3659530240),cancel:function(){command('cancel');}});
      else Tasks.remove('gemma-download',priorTask==='download'&&!state.ready&&priorPhase!=='idle'?{text:'Model download paused · '+(state.bytes?'partial file kept':'not complete'),action:'Resume',onAction:function(){if(state.enabled&&state.supported)command('download');else A.openSettings(false);}}:null);
      if(generating)Tasks.upsert('gemma-advice',{state:'running',text:state.phase==='load'?'Loading local AI…':state.phase==='cancelling'?'Cancelling local AI…':'AI: explaining '+(running&&(running.car.nick||running.car.name)||'tire setup')+'…',frac:null,cancel:cancelGeneration});
      else if(!running&&!desired.length)Tasks.remove('gemma-advice');
    }
    if(!state.enabled){desired=[];attempted.clear();} // opting out does not erase accepted explanations
    paintSettings();changed();if(!state.busy)schedule();
  }
  window.onGemmaStatus=status;
  async function command(action){
    if(typeof A.N.aiCommand!=='function'){lastIssue='Larger AI is unavailable on this app build.';paintSettings();return {error:lastIssue};}
    LG.info('ai','Local model command',{command:action,phase:state.phase,task:state.task||'',bytes:state.bytes||0});
    var r=await call('aiCommand',action);
    if(r.error){lastIssue=r.error;paintSettings();return r;}
    lastIssue='';status(r);return r;
  }
  function schedule(){clearTimeout(scheduled);scheduled=setTimeout(prefetch,250);}
  function deferForScan(){
    var busy=window.KeylessGas&&KeylessGas.isBusy&&KeylessGas.isBusy(),m=null;
    if(!busy){if(scanDeferred)LG.info('ai','Local explanation queue resumed after station scan');scanDeferred=false;releasedForScan=false;return false;}
    try{m=JSON.parse(A.N.memoryInfo());}catch(e){}
    if(!scanDeferred&&m&&(m.lowMemory||Number(m.availMem)<2*1024*1024*1024)){
      scanDeferred=true;LG.info('ai','Local explanation queue deferred for station scan memory headroom');
    }
    if(!scanDeferred)return false;
    // Once deferred, wait for scan completion rather than oscillating as unloading frees RAM.
    // A generation already running is allowed to finish and its validated result is retained.
    if(!running&&!state.busy&&!releasedForScan){releasedForScan=true;command('releaseIdle');}
    clearTimeout(scheduled);scheduled=setTimeout(prefetch,2000);return true;
  }
  function prefetch(){
    if(!state.enabled||!state.ready||!state.supported||state.recoveryRequired){if(!running)Tasks.remove('gemma-advice');return;}
    var c=current(),cars=(A.S.cars||[]).slice();cars.sort(function(a,b){return (b===c?1:0)-(a===c?1:0);});desired=[];
    var seen=new Set();cars.forEach(function(car){try{var next=input(car);if(seen.has(next.key))return;seen.add(next.key);if(next.pack.setup.tires.some(function(t){return t.depth!=null;})&&!remembered(next)&&!attempted.has(next.key))desired.push(next);}catch(e){if(car===c)lastIssue=e.message;}});
    if(running){if(!liveItem(running)&&!running.cancelled){running.cancelled=true;attempted.delete(running.key);command('cancelAdvice');}return;}
    if(!desired.length)Tasks.remove('gemma-advice');
    else if(!deferForScan()&&!state.busy)run();
    else Tasks.upsert('gemma-advice',{text:'Tire explanations queued…',state:'pending',frac:null,cancel:cancelGeneration});
  }
  async function run(){
    if(running||!desired.length||state.busy||!state.enabled)return;
    var item=desired.shift();running=item;attempted.add(item.key);issues.delete(item.key);lastIssue='';
    var started=Date.now();LG.info('ai','Local tire explanation started',{carId:item.car.id,positions:item.pack.setup.tires.length,facts:item.pack.facts.length,inputBytes:new TextEncoder().encode(item.prompt).length});
    // Start status immediately; native initialization happens off-thread and reports the precise phase.
    var previous=failures.get(item.key),attempt=previous?previous.count+1:1;
    var prompt=item.prompt+(previous?'\n\nCORRECTION FOR THIS FRESH ATTEMPT: The previous answer was rejected: '+previous.reason+'. Rewrite from the checked findings only. Avoid the words safe, safely, guarantee and guaranteed, including phrases like safe wet stopping. Do not give instructions or add numbers. Return only the requested JSON.':'');
    Tasks.upsert('gemma-advice',{state:'running',text:attempt>1?'Retrying local tire advice ('+attempt+'/'+MAX_ATTEMPTS+')…':'Preparing local tire advice…',frac:null,cancel:cancelGeneration});changed();
    try{
      var result=await call('aiGenerate',prompt);
      if(!state.enabled||item.cancelled||!liveItem(item)||window.__erasing)return;
      if(result.error){if(result.recoveryRequired){state.recoveryRequired=true;issues.set(item.key,'AI paused after a native failure. Use Try AI explanation to retry.');}else if(!/cancelled|canceled/i.test(result.error))failed(item,'generation error');else issues.set(item.key,'AI explanation cancelled.');return;}
      var checked=TirePolicy.check(result.text,item.pack),accepted=checked.ok;
      if(!accepted){failed(item,checked.reason||'output validation');return;}
      failures.delete(item.key);issues.delete(item.key);
      LG.info('ai','Local tire explanation accepted',{carId:item.car.id,elapsedMs:Date.now()-started});
      var saved={key:item.key,raw:result.text,t:Date.now()};if(A.KV)A.KV.put('aiexplanations',item.key,saved);
      cache.set(item.key,{answer:accepted,pack:item.pack,t:saved.t});
      while(cache.size>12)cache.delete(cache.keys().next().value);
    }catch(e){if(state.enabled&&!item.cancelled&&liveItem(item)&&!window.__erasing)failed(item,'generation exception');}
    finally{running=null;changed();schedule();} // prefetch removes the dock only when the queue is actually empty
  }
  function answer(c){if(!state.enabled)return null;try{return remembered(input(c));}catch(e){return null;}}
  function clearCache(){cache.clear();attempted.clear();failures.clear();issues.clear();desired=[];if(running){running.cancelled=true;command('cancelAdvice');}schedule();changed();}
  function card(c){
    if(!state.enabled)return '';
    var got=answer(c),esc=A.esc;
    if(!got&&!state.ready&&!state.error&&!lastIssue)return ''; // Existing accepted explanations do not require a loaded model.
    if(got){
      // the AI's summary and why its top findings matter; the checked findings themselves, folded, are the record
      var facts=got.pack.facts,find=function(id){return facts.filter(function(f){return f.id===id;})[0];};
      var top=got.answer.top.map(function(a){var f=find(a.id);return f?'<li class="'+(f.level==='warn'?'warn':'')+'"><b>'+esc(f.title)+'</b> '+esc(a.why)+'</li>':'';}).join('');
      return '<div class="card adv-card" id="gemmaAdvice"><h3>Your tire setup · AI-written</h3><div class="gemma-answer"><p>'+esc(got.answer.summary)+'</p>'+(top?'<ul class="gemma-top">'+top+'</ul>':'')+'</div>'+
        '<details class="gemma-all"><summary><span>All checked findings ('+facts.length+')</span></summary><ul>'+facts.map(function(f){return '<li class="'+(f.level==='warn'?'warn':'')+'">'+esc(f.text)+'</li>';}).join('')+'</ul></details>'+
        '<p class="lead small keep">AI summary—not a tire inspection.</p></div>';
    }
    var eligible=false;try{eligible=input(c).pack.setup.tires.some(function(t){return t.depth!=null;});}catch(e){}
    var label=state.recoveryRequired?'AI paused after an unexpected exit. Use Try AI explanation to retry.':state.ready?(running?'Local AI is preparing an explanation.':eligible?'Checked tire notices are available below.':'Add tire mileage and type, or measured tread, before requesting an explanation.'):'Download Gemma in Settings to enable local explanations.';
    var issue;try{issue=issues.get(input(c).key);}catch(e){}
    return '<div class="card adv-card" id="gemmaAdvice"><h3>Your tire setup</h3><p class="lead small keep">'+esc(issue||(!state.supported?lastIssue:'')||label)+'</p>'+(state.ready&&eligible&&!running?'<button class="btn tonal sm" id="gemmaRetry">Try AI explanation</button>':'')+'</div>';
  }
  function settingsHtml(){return '<div class="card" id="gemmaSettings"><h3>Local AI explanations · optional</h3><p class="lead small keep">Gemma 4 E4B explains complex tire setups on your phone, one task at a time. The lightweight ratings model stays in use. No API key or cloud inference.</p><div id="gemmaState" class="lead small keep"></div><p class="lead small keep">Separate 3.66 GB download. Wi-Fi recommended; allow extra storage for runtime work. Leaving the app may pause the download. Existing tire notices work without it.</p><div class="gemma-controls"><button class="btn tonal" id="gemmaEnable"></button><button class="btn primary" id="gemmaDownload">Download 3.66 GB</button><button class="btn tonal" id="gemmaCancel">Cancel task</button><button class="btn tonal" id="gemmaRemove">Remove model</button></div><div class="sub-h">AI processor</div><div class="seg2" id="gemmaProcessor" aria-label="AI processor"><button type="button" data-ai-processor="auto">Automatic (GPU)</button><button type="button" data-ai-processor="cpu">CPU only</button></div><p class="lead small keep" id="gemmaProcNote">Automatic runs the model on the GPU, which is much faster and leaves the processor free for the rest of the app. The CPU is only a fallback when the GPU won\'t start. CPU only is for troubleshooting: up to 10 min per explanation, and it slows other on-phone ratings.</p><button type="button" class="btn tonal sm" id="gemmaRecheck">Recheck current car</button></div>';}
  function paintSettings(){
    var el=document.getElementById('gemmaState');if(!el)return;
    var note=document.getElementById('gemmaProcNote');if(note&&state.gpuFallback&&!state.cpuOnly)note.textContent='The GPU wouldn\'t start last time, so the CPU stood in (slower). It tries the GPU first again each time.';
    el.textContent=lastIssue||state.error||(state.recoveryRequired?'AI paused after an unexpected exit. Use Recheck current car to retry.':!state.supported?'Larger-model runtime is unavailable on this device.':state.busy?'Working · '+state.phase:state.ready?'Model verified and ready'+(state.enabled?' · enabled':' · disabled'):state.bytes?'Partial download saved. Resume when ready.':'Not downloaded.');
    var enable=document.getElementById('gemmaEnable');enable.textContent=state.enabled?'Turn AI off':'Turn AI on';enable.disabled=!state.supported;
    var download=document.getElementById('gemmaDownload');download.disabled=!state.enabled||state.ready||state.busy;download.textContent=state.bytes?'Resume':'Get model';download.setAttribute('aria-label',state.bytes?'Resume 3.66 GB model download':'Download 3.66 GB model');
    download.classList.toggle('hidden',!!state.busy);
    document.getElementById('gemmaCancel').classList.toggle('hidden',!state.busy);
    document.getElementById('gemmaRemove').disabled=state.busy||!state.ready&&!state.bytes;document.getElementById('gemmaRemove').textContent='Delete model';
    document.querySelectorAll('[data-ai-processor]').forEach(function(b){var on=(b.dataset.aiProcessor==='cpu')===!!state.cpuOnly;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));b.disabled=!state.supported||!!state.busy;});
    var recheck=document.getElementById('gemmaRecheck');if(recheck)recheck.disabled=!state.enabled||!state.ready||!!state.busy||!current();
  }
  function bindSettings(){
    if(!document.getElementById('gemmaSettings'))return;paintSettings();
    document.getElementById('gemmaEnable').onclick=function(){A.S.largerAIChoice=!state.enabled;A.save();command(state.enabled?'disable':'enable');};
    document.querySelectorAll('[data-ai-processor]').forEach(function(b){b.onclick=function(){command(b.dataset.aiProcessor==='cpu'?'processorCpu':'processorAuto');};});
    var recheck=document.getElementById('gemmaRecheck');if(recheck)recheck.onclick=retry;
    document.getElementById('gemmaDownload').onclick=async function(){
      var ok=await A.confirmDel({always:true,title:'Download Gemma 4 E4B?',body:'This downloads about 3.66 GB over your current network. Wi-Fi is recommended. You can cancel and resume from Settings.',action:'Download',goClass:'primary'});
      if(ok)command('download');
    };
    document.getElementById('gemmaCancel').onclick=function(){command('cancel');};
    document.getElementById('gemmaRemove').onclick=async function(){if(await A.confirmDel({always:true,title:'Remove the local model?',body:'Deletes the model and its partial download, not your cars or tire details. Download it again to use larger AI.',action:'Remove'})){A.S.largerAIChoice=false;A.save();command('remove');}};
  }
  async function retry(){if(state.recoveryRequired){var resumed=await command('acknowledgeRecovery');if(resumed.error)return;}var c=current();if(c)try{var item=input(c);invalidate(item);attempted.delete(item.key);failures.delete(item.key);issues.delete(item.key);}catch(e){}lastIssue='';schedule();}
  var slot=document.getElementById('gemmaSlot');if(slot){slot.outerHTML=settingsHtml();bindSettings();}   // Settings opened before this file loaded (first-time setup)
  window.Gemma={status:function(){return state;},prefetch:schedule,answer:answer,card:card,settingsHtml:settingsHtml,bindSettings:bindSettings,retry:retry,setEnabled:function(on){return command(on?'enable':'disable');}};
  window.addEventListener('garagechange',function(){if(running&&!liveItem(running)&&!running.cancelled){running.cancelled=true;attempted.delete(running.key);command('cancelAdvice');}schedule();});
  window.addEventListener('cacheclear',clearCache);
  window.addEventListener('keylessscanchange',schedule);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&A.N.aiStatus)try{
    // Android's Clear cache can remove files while our process survives.
    if(A.KV)cache.forEach(function(_,key){if(!A.KV.get('aiexplanations',key)){cache.delete(key);attempted.delete(key);}});
    status(JSON.parse(A.N.aiStatus()));
  }catch(e){}});
  setTimeout(function(){if(A.N.aiStatus)try{
    status(JSON.parse(A.N.aiStatus()));
    // 176 onboarding saved an automatic opt-out. Establish the requested
    // default once, independently of whether onboarding was already completed.
    // Future explicit choices survive replay, upgrades and normal restarts.
    if(state.supported&&A.S.aiDefaultsVersion!==2){A.S.aiDefaultsVersion=2;A.save();if(A.S.onboardingAIInitialized&&A.S.largerAIChoice!==false&&!state.enabled)command('enable');}
  }catch(e){lastIssue='Local model status could not be read.';}},0);
})();
