/* Shared status surface. Station jobs retain their own data locks; unrelated tasks never acquire them. */
(function (root) {
  'use strict';
  var tasks = new Map(), expanded = false, frame = 0, completion = null, completionTimer = 0;
  var doc = root.document;
  function layout(){
    if(!doc)return;var hub=doc.getElementById('taskHub'),meter=doc.getElementById('apiCount'),inset=12;
    if(hub&&doc.body.classList.contains('trip-full')&&doc.body.classList.contains('trip-on')&&meter){var r=meter.getBoundingClientRect();if(r.width&&r.height)inset=Math.min(Math.ceil(r.right)+8,Math.max(12,root.innerWidth-180));}
    if(hub)hub.style.left=inset+'px';
  }
  if(doc){root.addEventListener('resize',layout);new MutationObserver(function(changes){if(changes.some(function(c){return c.oldValue!==doc.body.className;}))queue();}).observe(doc.body,{attributes:true,attributeFilter:['class'],attributeOldValue:true});}
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function queue() { if (!doc || frame) return; frame = root.requestAnimationFrame(function () { frame = 0; draw(); }); }
  function upsert(id, value) {
    if (!tasks.has(id)) tasks.set(id, { id: id, started: Date.now() });
    Object.assign(tasks.get(id), value); completion = null; clearTimeout(completionTimer); queue();
  }
  function remove(id, done) {
    tasks.delete(id);
    if (done && done.text && !tasks.size) { completion = done; clearTimeout(completionTimer); completionTimer = setTimeout(function(){completion=null;queue();}, 10000); }
    queue();
  }
  function sorted() { return Array.from(tasks.values()).sort(function(a,b){return (b.priority||0)-(a.priority||0)||a.started-b.started;}); }
  function cancel(id) {
    var t = tasks.get(id); if (!t || !t.cancel || t.cancelling) return;
    t.cancelling = true; t.text = 'Cancelling…'; queue(); t.cancel();
  }
  function row(t, main) {
    var progress = Number.isFinite(t.frac) ? Math.max(0,Math.min(1,t.frac)) : null;
    var text = t.cancelling ? 'Cancelling…' : t.text || 'Working…';
    if (main && (doc.body.classList.contains('trip-full') || doc.querySelector('#settings:not(.hidden),.sub-page')) && root.__app && root.__app.jobShort) text = root.__app.jobShort(text);
    return '<span class="jb-t">'+esc(text)+'</span><span class="pbar'+(progress==null?' indeterminate':'')+'" role="progressbar" aria-label="'+esc(text)+'" aria-valuemin="0" aria-valuemax="100"'+(progress==null?'':' aria-valuenow="'+Math.round(progress*100)+'"')+'><i style="width:'+(progress==null?'35':Math.round(progress*100))+'%"></i></span>'+
      '<span class="pct">'+(progress==null?'':Math.round(progress*100)+'%')+'</span>'+(t.cancel?'<button class="jb-x" data-cancel="'+esc(t.id)+'" aria-label="Cancel '+esc(text)+'"'+(t.cancelling?' disabled':'')+'>✕</button>':'');
  }
  function paintRow(el,t,main) {
    if(el.dataset.taskId!==t.id||!el.querySelector('.pbar')||!!el.querySelector('.jb-x')!==!!t.cancel){el.innerHTML=row(t,main);el.dataset.taskId=t.id;}
    var progress=Number.isFinite(t.frac)?Math.max(0,Math.min(1,t.frac)):null;
    var text=t.cancelling?'Cancelling…':t.text||'Working…';
    if(main&&(doc.body.classList.contains('trip-full')||doc.querySelector('#settings:not(.hidden),.sub-page'))&&root.__app&&root.__app.jobShort)text=root.__app.jobShort(text);
    var label=el.querySelector('.jb-t');if(label.textContent!==text)label.textContent=text;
    var bar=el.querySelector('.pbar');bar.classList.toggle('indeterminate',progress==null);bar.setAttribute('aria-label',text);
    if(progress==null)bar.removeAttribute('aria-valuenow');else bar.setAttribute('aria-valuenow',String(Math.round(progress*100)));
    bar.querySelector('i').style.width=(progress==null?35:Math.round(progress*100))+'%';
    el.querySelector('.pct').textContent=progress==null?'':Math.round(progress*100)+'%';
    var cancelButton=el.querySelector('.jb-x');if(cancelButton){cancelButton.disabled=!!t.cancelling;cancelButton.setAttribute('aria-label','Cancel '+text);}
    el.title=t.text||'Background task';
  }
  function draw() {
    if (!doc) return;
    var hub = doc.getElementById('taskHub');
    if (!hub) {
      hub = doc.createElement('div'); hub.id='taskHub'; hub.className='task-hub hidden';
      hub.innerHTML='<div class="task-top"><div id="jobBar" class="job-bar" role="status" aria-live="polite"></div><button id="taskMore" class="task-more hidden" aria-label="Show background tasks" aria-controls="taskList" aria-expanded="false"><span class="chev" aria-hidden="true"></span></button></div><div id="taskList" class="task-list hidden" aria-label="Background tasks"></div>';
      doc.body.appendChild(hub);
      doc.getElementById('taskMore').onclick=function(){expanded=!expanded;draw();};
      hub.onclick=function(e){var b=e.target.closest('[data-cancel]');if(b)cancel(b.dataset.cancel);};
      doc.addEventListener('keydown',function(e){if(e.key==='Escape'&&expanded){expanded=false;draw();doc.getElementById('taskMore').focus();}});
    }
    var all=sorted(), multiple=all.length>1;
    var primary=all[0], bar=doc.getElementById('jobBar'), more=doc.getElementById('taskMore'), list=doc.getElementById('taskList');
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
      bar.innerHTML='<span class="jb-t">'+esc(completion.text)+'</span>'+(completion.action?'<button class="btn primary sm jb-go">'+esc(completion.action)+'</button>':'')+'<button class="jb-x" aria-label="Close">✕</button>';
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
  root.Tasks={upsert:upsert,remove:remove,draw:draw,layout:layout,list:sorted,cancel:cancel,back:function(){if(!expanded)return false;expanded=false;draw();return true;}};
})(typeof window!=='undefined'?window:globalThis);
