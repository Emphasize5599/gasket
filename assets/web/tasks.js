/* Shared status surface. Station jobs retain their own data locks; unrelated tasks never acquire them. */
(function (root) {
  'use strict';
  var tasks = new Map(), expanded = false, messageExpanded=false, primaryId='', frame = 0, completion = null, completionTimer = 0;
  var doc = root.document, etaTimer=null, etaRates=null;
  var notice = null, noticeTimer = 0;
  function dismissNotice(id){if(!notice||id&&notice.id!==id)return;notice=null;clearTimeout(noticeTimer);queue();}
  function showNotice(id,text){if(notice&&notice.id===id)return;clearTimeout(noticeTimer);var current=notice={id:id,text:String(text)};noticeTimer=setTimeout(function(){if(notice===current)dismissNotice(id);},10000);queue();}
  function fullMenu(){return doc.body.classList.contains('trip-full')||!!doc.querySelector('#settings:not(.hidden),.sub-page:not(.hidden)');}
  function messageButton(){return '<button type="button" class="jb-expand hidden" aria-label="Show full status message" aria-controls="jobMessage" aria-expanded="false"><span class="chev" aria-hidden="true"></span></button>';}
  // Measuring the bar forces a layout of the whole page, so it's measured only when its size or visibility changes
  // (a ResizeObserver says so), not on every progress update.
  var insetSig='',insetValue=12,spaceDirty=true,sizeWatch=null,lastHidden=null,watched=new Set();
  function watchSize(hub){var hidden=hub.classList.contains('hidden')+'|'+messageExpanded;if(hidden!==lastHidden){lastHidden=hidden;spaceDirty=true;}if(!root.ResizeObserver){spaceDirty=true;return;}if(!sizeWatch)sizeWatch=new ResizeObserver(function(){spaceDirty=true;layout();});[hub.querySelector('.task-top'),doc.getElementById('taskNotice'),doc.getElementById('visualMarkerRow')].forEach(function(el){if(el&&!watched.has(el)){watched.add(el);sizeWatch.observe(el);spaceDirty=true;}});}
  function layout(){
    if(!doc)return;var hub=doc.getElementById('taskHub'),meter=doc.getElementById('apiCount'),inset=12;
    var tripFull=hub&&doc.body.classList.contains('trip-full')&&doc.body.classList.contains('trip-on')&&meter,sig=[!!tripFull,root.innerWidth,meter&&meter.className,meter&&meter.textContent].join('|');if(sig!==insetSig){insetSig=sig;insetValue=12;if(tripFull){var r=meter.getBoundingClientRect();if(r.width&&r.height)insetValue=Math.min(Math.ceil(r.right)+8,Math.max(12,root.innerWidth-180));}}inset=insetValue;
    if(hub){hub.style.left=inset+'px';var list=doc.getElementById('taskList');if(list)list.style.marginLeft=(12-inset)+'px';var full=fullMenu(),bar=doc.getElementById('jobBar'),button=bar.querySelector('.jb-expand');if(!full)messageExpanded=false;
      hub.classList.toggle('compact',full);hub.classList.toggle('full-message',full&&messageExpanded);
      if(button){button.classList.toggle('hidden',!full);button.setAttribute('aria-expanded',String(messageExpanded));button.setAttribute('aria-label',messageExpanded?'Collapse status message':'Show full status message');button.querySelector('.chev').classList.toggle('up',messageExpanded);}
      var label=bar.querySelector('.jb-t'),text=bar.dataset.fullText||'';if(label)label.textContent=full&&!messageExpanded&&root.__app&&root.__app.jobShort?root.__app.jobShort(text):text;
      watchSize(hub);if(!spaceDirty)return;spaceDirty=false;var hint=doc.getElementById('taskNotice'),marker=doc.getElementById('visualMarkerRow');var space=hub.classList.contains('hidden')?0:Math.ceil(hub.querySelector('.task-top').getBoundingClientRect().height)+(hint&&!hint.classList.contains('hidden')?Math.ceil(hint.getBoundingClientRect().height)+4:0)+(marker&&!marker.classList.contains('hidden')?Math.ceil(marker.getBoundingClientRect().height):0)+10;
      if(doc.body.style.getPropertyValue('--task-space')!==space+'px')doc.body.style.setProperty('--task-space',space+'px');
    }
  }
  if(doc){root.addEventListener('resize',layout);new MutationObserver(function(changes){if(changes.some(function(c){return c.oldValue!==doc.body.className;}))queue();}).observe(doc.body,{attributes:true,attributeFilter:['class'],attributeOldValue:true});}
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  // progress-only updates redraw at most ~4 times a second: each redraw measures the bar (a forced layout of the whole page), and progress updates
  // arrive every frame while work runs (1.6 s of an 8x-throttled rest-stop session went here)
  var lastDraw=0,later=0;
  function queue(progressOnly) { if (!doc || frame) return; if (!progressOnly) { if (later) { clearTimeout(later); later = 0; } } else if (later) return; var wait=progressOnly?250-(Date.now()-lastDraw):0; if (wait>0) { later=setTimeout(function(){later=0;queue();},wait); return; } frame = root.requestAnimationFrame(function () { frame = 0; lastDraw=Date.now(); draw(); }); }
  function etaKey(t){return t.etaKey||String(t.id).replace(/\d+/g,'*');}
  function rates(){if(etaRates)return etaRates;try{var r=root.__app&&root.__app.KV.get('traffic','task-durations');etaRates=r&&r.v||{};}catch(e){etaRates={};}return etaRates;}
  // Time left only from evidence: the task's own progress (after a few seconds and some of it done) or how long the
  // same kind of task took before. Never a made-up default, and nothing once a task outlasts what it took last time.
  function taskText(t){var text=t.cancelling?'Cancelling…':t.text||'Working…';if(t.cancelling||/remaining|\bleft\b|estimated total|about (?:a|\d)|~\d|waiting for.*verif|paused|pending/i.test(text))return text;
    var elapsed=Math.max(0,Date.now()-t.started),prior=Number.isFinite(t.estimateMs)?t.estimateMs:rates()[etaKey(t)],ms=null;
    if(t.state==='pending'){if(prior>0)return text+' · about '+span(prior)+' once started';return text;}
    if(Number.isFinite(t.frac)&&t.frac>=.05&&t.frac<1&&elapsed>=3000)ms=elapsed/t.frac*(1-t.frac);else if(prior>0&&elapsed<prior)ms=prior-elapsed;
    return ms==null||ms<1500?text:text+' · about '+span(ms)+' left';}
  function span(ms){var sec=Math.ceil(ms/1000);return sec<90?sec+' s':Math.round(sec/60)+' min';}
  function upsert(id, value) {
    var fresh=!tasks.has(id);if (fresh) tasks.set(id, { id: id, started: Date.now() });
    var t=tasks.get(id),same=!fresh&&value&&Object.keys(value).every(function(k){return /^(frac|text|estimateMs|detail)$/.test(k)||t[k]===value[k];});Object.assign(t, value); completion = null; clearTimeout(completionTimer); queue(same);
    if(root.VisualDiagnostics)VisualDiagnostics.redraw('task_status_update');
  }
  function remove(id, done) {
    var task=tasks.get(id);if(task&&task.state!=='pending'&&!task.cancelling&&Date.now()-task.started>100){var key=etaKey(task),r=rates(),elapsed=Date.now()-task.started;r[key]=r[key]?r[key]*.7+elapsed*.3:elapsed;try{if(root.__app)root.__app.KV.put('traffic','task-durations',r);}catch(e){}}tasks.delete(id);
    if (done && done.text && !tasks.size) { completion = done; clearTimeout(completionTimer); completionTimer = setTimeout(function(){completion=null;queue();}, 10000); }
    queue();
  }
  function sorted() { return Array.from(tasks.values()).sort(function(a,b){return (a.state==='pending')-(b.state==='pending')||(b.priority||0)-(a.priority||0)||(a.order||0)-(b.order||0)||a.started-b.started;}); }
  // Several readers may use one provider concurrently: show one real task until the last read ends.
  function begin(id,value) {
    if(value.pendingId)remove(value.pendingId);
    var t=tasks.get(id),count=(t&&t.readers||0)+1;
    upsert(id,Object.assign({},value,{state:'running',readers:count}));
    var ended=false;return function(){if(ended)return;ended=true;var current=tasks.get(id);if(!current)return;if(current.readers>1)upsert(id,{readers:current.readers-1});else remove(id);};
  }
  function visible() {return sorted().filter(function(t){var parent=tasks.get(t.parent);return !(t.mirrorOf&&tasks.has(t.mirrorOf))&&!(parent&&t.state!=='pending'&&(t.parentLabels||[t.text]).some(function(label){return label&&String(parent.text||'').indexOf(label)>=0;}));});}
  function cancel(id) {
    var t = tasks.get(id); if (!t || !t.cancel || t.cancelling) return;
    t.cancelling = true; t.text = 'Cancelling…'; queue(); t.cancel();
  }
  function row(t, main) {
    var progress = Number.isFinite(t.frac) ? Math.max(0,Math.min(1,t.frac)) : null;
    var text = taskText(t);
    if (main && (doc.body.classList.contains('trip-full') || doc.querySelector('#settings:not(.hidden),.sub-page')) && root.__app && root.__app.jobShort) text = root.__app.jobShort(text);
    return (main?messageButton():'')+'<span class="jb-t"'+(main?' id="jobMessage"':'')+'>'+esc(text)+'</span><span class="pbar'+(progress==null?' indeterminate':'')+'" role="progressbar" aria-label="'+esc(text)+'" aria-valuemin="0" aria-valuemax="100"'+(progress==null?'':' aria-valuenow="'+Math.round(progress*100)+'"')+'><i style="width:'+(progress==null?'35':Math.round(progress*100))+'%"></i></span>'+
      '<span class="pct">'+(progress==null?'':Math.round(progress*100)+'%')+'</span>'+(t.cancel?'<button class="jb-x" data-cancel="'+esc(t.id)+'" aria-label="Cancel '+esc(text)+'"'+(t.cancelling?' disabled':'')+'>✕</button>':'');
  }
  function paintRow(el,t,main) {
    if(t.state==='pending'){
      el.dataset.taskId=t.id;el.dataset.taskState='pending';el.dataset.fullText=t.text||'Pending';
      el.innerHTML=(main?messageButton():'')+'<span class="jb-t"'+(main?' id="jobMessage"':'')+'>'+esc(taskText(t))+'</span><span class="task-state">Pending</span>';return;
    }
    el.dataset.taskState='running';
    if(el.dataset.taskId!==t.id||!el.querySelector('.pbar')||!!el.querySelector('.jb-x')!==!!t.cancel){el.innerHTML=row(t,main);el.dataset.taskId=t.id;}
    var progress=Number.isFinite(t.frac)?Math.max(0,Math.min(1,t.frac)):null;
    var text=taskText(t);
    if(main&&(doc.body.classList.contains('trip-full')||doc.querySelector('#settings:not(.hidden),.sub-page'))&&root.__app&&root.__app.jobShort)text=root.__app.jobShort(text);
    var label=el.querySelector('.jb-t');if(label.textContent!==text)label.textContent=text;
    var bar=el.querySelector('.pbar');bar.classList.toggle('indeterminate',progress==null);bar.setAttribute('aria-label',text);
    if(progress==null)bar.removeAttribute('aria-valuenow');else bar.setAttribute('aria-valuenow',String(Math.round(progress*100)));
    bar.querySelector('i').style.width=(progress==null?35:Math.round(progress*100))+'%';
    el.querySelector('.pct').textContent=progress==null?'':Math.round(progress*100)+'%';
    var cancelButton=el.querySelector('.jb-x');if(cancelButton){cancelButton.disabled=!!t.cancelling;cancelButton.setAttribute('aria-label','Cancel '+text);}
    el.title=t.text||'Background task';
    if(main)el.dataset.fullText=taskText(t);
  }
  function draw() {
    if(root.VisualDiagnostics)VisualDiagnostics.redraw('task_draw');
    if (!doc) return;
    var hub = doc.getElementById('taskHub');
    if (!hub) {
      hub = doc.createElement('div'); hub.id='taskHub'; hub.className='task-hub hidden';
      hub.innerHTML='<div class="task-top"><div id="jobBar" class="job-bar" role="status" aria-live="polite"></div><button id="taskMore" class="task-more hidden" aria-label="Show background tasks" aria-controls="taskList" aria-expanded="false"><span class="chev" aria-hidden="true"></span></button></div><div id="taskList" class="task-list hidden" aria-label="Background tasks"></div>';
      doc.body.appendChild(hub);
      if(root.ResizeObserver)new ResizeObserver(layout).observe(hub.querySelector('.task-top'));
      doc.getElementById('taskMore').onclick=function(){expanded=!expanded;draw();};
      hub.onclick=function(e){if(e.target.closest('.jb-expand')){messageExpanded=!messageExpanded;layout();return;}var b=e.target.closest('[data-cancel]');if(b)cancel(b.dataset.cancel);};
      // The other-statuses button and its list keep the expanded message open.
      doc.addEventListener('click',function(e){if(messageExpanded&&!e.target.closest('.jb-expand,#taskMore,#taskList')){messageExpanded=false;layout();}},true);
      doc.addEventListener('keydown',function(e){if(e.key==='Escape'&&messageExpanded){messageExpanded=false;layout();var b=doc.querySelector('.jb-expand');if(b)b.focus();}else if(e.key==='Escape'&&expanded){expanded=false;draw();doc.getElementById('taskMore').focus();}});
    }
    var all=visible(), multiple=all.length>1;if(all.length&&!etaTimer)etaTimer=setInterval(queue,1000);else if(!all.length&&etaTimer){clearInterval(etaTimer);etaTimer=null;}
    var hint=doc.getElementById('taskNotice');if(!hint){hint=doc.createElement('div');hint.id='taskNotice';hint.className='task-notice hidden';hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');hint.innerHTML='<span></span><button type="button" aria-label="Dismiss screen flicker tip">✕</button>';hub.insertBefore(hint,doc.getElementById('taskList'));hint.querySelector('button').onclick=function(){dismissNotice(hint.dataset.noticeId);};if(root.ResizeObserver)new ResizeObserver(layout).observe(hint);}
    hint.classList.toggle('hidden',!notice);if(notice){hint.dataset.noticeId=notice.id;var noticeText=hint.querySelector('span');if(noticeText.textContent!==notice.text)noticeText.textContent=notice.text;}
    var marker=doc.getElementById('visualMarkerRow');if(!marker){marker=doc.createElement('div');marker.id='visualMarkerRow';marker.className='hidden';marker.innerHTML='<button type="button" class="btn tonal sm" id="visualMarker">Mark visual glitch</button>';hub.insertBefore(marker,doc.getElementById('taskList'));marker.querySelector('button').onclick=function(){if(root.VisualDiagnostics)VisualDiagnostics.mark();};if(root.ResizeObserver)new ResizeObserver(layout).observe(marker);}marker.classList.toggle('hidden',!(root.VisualDiagnostics&&VisualDiagnostics.wantMarker()));
    var primary=all[0], bar=doc.getElementById('jobBar'), more=doc.getElementById('taskMore'), list=doc.getElementById('taskList');
    var nextId=primary?primary.id:completion?'completion':'';if(nextId!==primaryId){messageExpanded=false;primaryId=nextId;}
    // One dock stays visible on every screen, even when a tile also offers inline progress.
    hub.classList.toggle('hidden',!primary&&!completion);
    doc.body.classList.toggle('tasks-visible',!!(primary||completion));
    more.classList.toggle('hidden',!multiple); hub.classList.toggle('multiple',multiple);
    if(!multiple)expanded=false;
    more.setAttribute('aria-expanded',String(expanded)); more.setAttribute('aria-label',(expanded?'Hide':'Show')+' background tasks ('+all.length+')');
    more.querySelector('.chev').classList.toggle('up',expanded);
    bar.className='job-bar'+(!primary&&completion?' done':'');
    if(primary){paintRow(bar,primary,true);bar.setAttribute('aria-label',primary.text||'Background task');}
    else if(completion){
      bar.dataset.fullText=completion.text;bar.innerHTML=messageButton()+'<span class="jb-t" id="jobMessage">'+esc(completion.text)+'</span>'+(completion.action?'<button class="btn primary sm jb-go">'+esc(completion.action)+'</button>':'')+'<button class="jb-x" aria-label="Close">✕</button>';
      bar.querySelector('.jb-x').onclick=function(){completion=null;queue();};
      if(completion.action)bar.querySelector('.jb-go').onclick=function(){var action=completion.onAction;completion=null;queue();if(action)action();};
    } else { bar.innerHTML=''; bar.classList.add('hidden'); }
    list.classList.toggle('hidden',!expanded);
    if(!expanded)list.innerHTML='';
    else {
      var rest=all.filter(function(t){return !primary||t.id!==primary.id;}),keep=new Set(rest.map(function(t){return t.id;}));
      Array.from(list.children).forEach(function(el){if(!keep.has(el.dataset.taskId))el.remove();});
      rest.forEach(function(t,index){
        var el=Array.from(list.children).find(function(child){return child.dataset.taskId===t.id;});
        if(!el){el=doc.createElement('div');el.className='task-row';}
        paintRow(el,t,false);if(list.children[index]!==el)list.insertBefore(el,list.children[index]||null);
      });
    }
    layout();root.dispatchEvent(new Event('tasklayout'));
  }
  root.Tasks={begin:begin,upsert:upsert,remove:remove,draw:draw,layout:layout,list:sorted,cancel:cancel,notice:showNotice,dismissNotice:dismissNotice,back:function(){if(messageExpanded){messageExpanded=false;layout();return true;}if(!expanded)return false;expanded=false;draw();return true;}};
})(typeof window!=='undefined'?window:globalThis);
