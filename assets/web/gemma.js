/* Optional Gemma controller. One current vehicle request, one coalesced replacement, no generation queue growth. */
(function(){
  'use strict';
  var A=window.__app, state={enabled:false,ready:false,supported:false,phase:'idle'}, running=null, desired=null;
  var cache=new Map(), attempted=new Set(), scheduled=0, revision='', lastIssue='';
  var LG=window.FLog||{info:function(){},warn:function(){}};
  function call(fn,arg){return window.__trip.call(fn,arg);}
  function current(){return window.Garage&&Garage.car();}
  function input(c){
    var pack=TirePolicy.prepare(c,TireMath),prompt=TirePolicy.prompt(pack);
    if(new TextEncoder().encode(prompt).length>27000)throw new Error('The complete setup is too large for local AI; checked notices remain available.');
    return {car:c,pack:pack,prompt:prompt,key:revision+'|'+JSON.stringify(pack)};
  }
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
    if(state.phase!==priorPhase)LG.info('ai','Local model phase: '+state.phase,{backend:state.backend||null,bytes:state.bytes||0,ready:!!state.ready,attempt:state.attempt||1,reason:state.reason||'',error:String(state.error||'').replace(/https?:\/\/\S+/g,'[download endpoint]').slice(0,220)});
    if((state.error&&state.error!==priorIssue)||(state.reason&&state.reason!==priorReason))LG.warn('ai','Local model task update',{phase:state.phase,task:state.task||priorTask||'',bytes:state.bytes||0,attempt:state.attempt||1,reason:state.reason||'',error:String(state.error||'').replace(/https?:\/\/\S+/g,'[download endpoint]').slice(0,220)});
    if(state.error&&state.error!==priorIssue&&priorTask==='download')A.toast('Model download stopped · '+(state.bytes?'partial file kept.':'not complete.')+' Resume in Settings.');
    if(state.phase!=='download')rateS=[];
    var downloading=/^(download|verify|retry)$/.test(state.phase)||state.phase==='cancelling'&&state.task==='download', generating=/^(load|generate|cancelling)$/.test(state.phase)&&!downloading;
    if(window.Tasks){
      if(downloading)Tasks.upsert('gemma-download',{text:state.phase==='cancelling'?'Pausing model download…':state.phase==='verify'?'Verifying Gemma model…':state.phase==='retry'?'Resuming model download · attempt '+(state.attempt||2)+' / 4':'Downloading Gemma · '+(Number(state.bytes||0)/1e9).toFixed(2)+' / 3.66 GB'+leftText(Number(state.bytes||0),Number(state.total||3659530240)),frac:/verify|cancelling/.test(state.phase)?null:Number(state.bytes||0)/Number(state.total||3659530240),cancel:function(){command('cancel');}});
      else Tasks.remove('gemma-download',priorTask==='download'&&!state.ready&&priorPhase!=='idle'?{text:'Model download paused · '+(state.bytes?'partial file kept':'not complete'),action:'Resume',onAction:function(){if(state.enabled&&state.supported)command('download');else A.openSettings(false);}}:null);
      if(generating)Tasks.upsert('gemma-advice',{text:state.phase==='load'?'Loading local AI…':state.phase==='cancelling'?'Cancelling local AI…':'AI: explaining your tire setup…',frac:null,cancel:function(){if(running)attempted.add(running.key);desired=null;command('cancelAdvice');}});
      else Tasks.remove('gemma-advice');
    }
    if(!state.enabled){desired=null;cache.clear();attempted.clear();}
    paintSettings();changed();if(!state.busy)schedule();
  }
  window.onGemmaStatus=status;
  async function command(action){
    LG.info('ai','Local model command',{command:action,phase:state.phase,task:state.task||'',bytes:state.bytes||0});
    var r=await call('aiCommand',action);
    if(r.error){lastIssue=r.error;paintSettings();return r;}
    lastIssue='';status(r);return r;
  }
  function schedule(){clearTimeout(scheduled);scheduled=setTimeout(prefetch,250);}
  function prefetch(){
    if(!state.enabled||!state.ready||!state.supported||!current())return;
    var next;try{next=input(current());}catch(e){lastIssue=e.message;changed();return;}
    if(!next.pack.setup.tires.some(function(t){return t.depth!=null;}))return;
    if(cache.has(next.key)||attempted.has(next.key)){desired=null;return;}
    desired=next;
    if(running){if(running.key!==next.key&&!running.cancelled){running.cancelled=true;command('cancelAdvice');}return;}
    if(!state.busy)run();
  }
  async function run(){
    if(running||!desired||state.busy||!state.enabled)return;
    var item=desired;desired=null;running=item;attempted.add(item.key);lastIssue='';
    var started=Date.now();LG.info('ai','Local tire explanation started',{positions:item.pack.setup.tires.length,facts:item.pack.facts.length,inputBytes:new TextEncoder().encode(item.prompt).length});
    // Start status immediately; native initialization happens off-thread and reports the precise phase.
    Tasks.upsert('gemma-advice',{text:'Preparing local tire advice…',frac:null,cancel:function(){command('cancelAdvice');}});changed();
    try{
      var result=await call('aiGenerate',item.prompt);
      var now=current(), live=now&&input(now);
      if(!state.enabled||item.cancelled||!live||live.key!==item.key)return;
      if(result.error){lastIssue=result.error;LG.warn('ai','Local tire explanation failed',{elapsedMs:Date.now()-started});return;}
      var checked=TirePolicy.check(result.text,item.pack),accepted=checked.ok;
      if(!accepted){lastIssue='AI explanation could not be checked. Use the checked tire notices below.';LG.warn('ai','Local explanation rejected by output guard',{elapsedMs:Date.now()-started,responseChars:String(result.text||'').length,reason:checked.reason,start:String(result.text||'').slice(0,160)});return;}
      LG.info('ai','Local tire explanation accepted',{elapsedMs:Date.now()-started});
      cache.set(item.key,{answer:accepted,pack:item.pack});
      while(cache.size>12)cache.delete(cache.keys().next().value);
    }catch(e){lastIssue='Local AI could not finish. Checked tire notices remain available.';}
    finally{running=null;Tasks.remove('gemma-advice');changed();schedule();}
  }
  function answer(c){if(!state.enabled)return null;try{return cache.get(input(c).key)||null;}catch(e){return null;}}
  function card(c){
    if(!state.enabled)return '';
    var got=answer(c),esc=A.esc;
    if(got)return '<div class="card adv-card" id="gemmaAdvice"><h3>Your tire setup · AI-written</h3><div class="gemma-answer"><p>'+esc(got.answer.summary)+'</p>'+got.answer.actions.map(function(a){var action=got.pack.actions.find(function(x){return x.id===a.id;});return '<p><b>'+esc(action.text)+'</b>'+(a.why?' '+esc(a.why):'')+'</p>';}).join('')+'</div><p class="lead small keep">AI explanation, checked against Gasket’s findings—not a tire inspection. Required notices remain below.</p></div>';
    var eligible=false;try{eligible=input(c).pack.setup.tires.some(function(t){return t.depth!=null;});}catch(e){}
    var label=state.ready?(running?'Local AI is preparing an explanation.':eligible?'Checked tire notices are available below.':'Add tire mileage and type, or measured tread, before requesting an explanation.'):'Download Gemma in Settings to enable local explanations.';
    return '<div class="card adv-card" id="gemmaAdvice"><h3>Your tire setup</h3><p class="lead small keep">'+esc(lastIssue||state.error||label)+'</p>'+(state.ready&&eligible&&!running?'<button class="btn tonal sm" id="gemmaRetry">Try AI explanation</button>':'')+'</div>';
  }
  function settingsHtml(){return '<div class="card" id="gemmaSettings"><h3>Local AI explanations · optional</h3><p class="lead small keep">Gemma 4 E4B explains complex tire setups on your phone, one task at a time. The lightweight ratings model stays in use. No API key or cloud inference.</p><div id="gemmaState" class="lead small keep"></div><p class="lead small keep">Separate 3.66 GB download. Wi-Fi recommended; allow extra storage for runtime work. Leaving the app may pause the download. Existing tire notices work without it.</p><div class="gemma-controls"><button class="btn tonal" id="gemmaEnable"></button><button class="btn primary" id="gemmaDownload">Download 3.66 GB</button><button class="btn tonal" id="gemmaCancel">Cancel task</button><button class="btn tonal" id="gemmaRemove">Remove model</button></div></div>';}
  function paintSettings(){
    var el=document.getElementById('gemmaState');if(!el)return;
    el.textContent=lastIssue||state.error||(!state.supported?'Larger-model runtime is unavailable on this device.':state.busy?'Working · '+state.phase:state.ready?'Model verified and ready'+(state.enabled?' · enabled':' · disabled'):state.bytes?'Partial download saved. Resume when ready.':'Not downloaded.');
    var enable=document.getElementById('gemmaEnable');enable.textContent=state.enabled?'Disable larger AI':'Enable larger AI';enable.disabled=!state.supported;
    var download=document.getElementById('gemmaDownload');download.disabled=!state.enabled||state.ready||state.busy;download.textContent=state.bytes?'Resume 3.66 GB download':'Download 3.66 GB';
    document.getElementById('gemmaCancel').classList.toggle('hidden',!state.busy);
    document.getElementById('gemmaRemove').disabled=state.busy||!state.ready&&!state.bytes;
  }
  function bindSettings(){
    if(!document.getElementById('gemmaSettings'))return;paintSettings();
    document.getElementById('gemmaEnable').onclick=function(){command(state.enabled?'disable':'enable');};
    document.getElementById('gemmaDownload').onclick=async function(){
      var ok=await A.confirmDel({always:true,title:'Download Gemma 4 E4B?',body:'This downloads about 3.66 GB over your current network. Wi-Fi is recommended. You can cancel and resume from Settings.',action:'Download',goClass:'primary'});
      if(ok)command('download');
    };
    document.getElementById('gemmaCancel').onclick=function(){command('cancel');};
    document.getElementById('gemmaRemove').onclick=async function(){if(await A.confirmDel({always:true,title:'Remove the local model?',body:'Deletes the model and its partial download, not your cars or tire details. Download it again to use larger AI.',action:'Remove'}))command('remove');};
  }
  function retry(){var c=current();if(c)try{attempted.delete(input(c).key);}catch(e){}lastIssue='';schedule();}
  var slot=document.getElementById('gemmaSlot');if(slot){slot.outerHTML=settingsHtml();bindSettings();}   // Settings opened before this file loaded (first-time setup)
  window.Gemma={status:function(){return state;},prefetch:schedule,answer:answer,card:card,settingsHtml:settingsHtml,bindSettings:bindSettings,retry:retry};
  window.addEventListener('garagechange',function(){if(running){var c=current();try{if(!c||input(c).key!==running.key){running.cancelled=true;command('cancelAdvice');}}catch(e){command('cancelAdvice');}}schedule();});
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&A.N.aiStatus)try{status(JSON.parse(A.N.aiStatus()));}catch(e){}});
  setTimeout(function(){if(A.N.aiStatus)try{status(JSON.parse(A.N.aiStatus()));}catch(e){lastIssue='Local model status could not be read.';}},0);
})();
