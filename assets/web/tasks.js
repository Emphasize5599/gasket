/* Shared status surface. Station jobs retain their own data locks; unrelated tasks never acquire them. */
(function (root) {
  'use strict';
  var tasks = new Map(), expanded = false, frame = 0, completion = null, completionTimer = 0;
  var doc = root.document;
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
  function draw() {
    if (!doc) return;
    var hub = doc.getElementById('taskHub');
    if (!hub) {
      hub = doc.createElement('div'); hub.id='taskHub'; hub.className='task-hub hidden';
      hub.innerHTML='<div class="task-top"><div id="jobBar" class="job-bar" role="status" aria-live="polite"></div><button id="taskMore" class="task-more hidden" aria-label="Show background tasks" aria-controls="taskList" aria-expanded="false">⌄</button></div><div id="taskList" class="task-list hidden" aria-label="Background tasks"></div>';
      doc.body.appendChild(hub);
      doc.getElementById('taskMore').onclick=function(){expanded=!expanded;draw();};
      hub.onclick=function(e){var b=e.target.closest('[data-cancel]');if(b)cancel(b.dataset.cancel);};
      doc.addEventListener('keydown',function(e){if(e.key==='Escape'&&expanded){expanded=false;draw();doc.getElementById('taskMore').focus();}});
    }
    var all=sorted(), visible=all.filter(function(t){return !(t.inline&&t.inline());}), multiple=all.length>1;
    var primary=visible[0]|| (multiple?all[0]:null), bar=doc.getElementById('jobBar'), more=doc.getElementById('taskMore'), list=doc.getElementById('taskList');
    // Inline progress remains sufficient for one station task; never hide other work alongside it.
    hub.classList.toggle('hidden',!primary&&!completion);
    doc.body.classList.toggle('tasks-visible',!!(primary||completion));
    more.classList.toggle('hidden',!multiple); hub.classList.toggle('multiple',multiple);
    if(!multiple)expanded=false;
    more.setAttribute('aria-expanded',String(expanded)); more.setAttribute('aria-label',(expanded?'Hide':'Show')+' background tasks ('+all.length+')');
    more.textContent=expanded?'⌃':'⌄';
    bar.className='job-bar'+(!primary&&completion?' done':'');
    if(primary){bar.innerHTML=row(primary,true);bar.setAttribute('aria-label',primary.text||'Background task');}
    else if(completion){
      bar.innerHTML='<span class="jb-t">'+esc(completion.text)+'</span>'+(completion.action?'<button class="btn primary sm jb-go">'+esc(completion.action)+'</button>':'')+'<button class="jb-x" aria-label="Close">✕</button>';
      bar.querySelector('.jb-x').onclick=function(){completion=null;queue();};
      if(completion.action)bar.querySelector('.jb-go').onclick=function(){var action=completion.onAction;completion=null;queue();if(action)action();};
    } else { bar.innerHTML=''; bar.classList.add('hidden'); }
    list.classList.toggle('hidden',!expanded);
    list.innerHTML=expanded?all.filter(function(t){return !primary||t.id!==primary.id;}).map(function(t){return '<div class="task-row">'+row(t,false)+'</div>';}).join(''):'';
    root.dispatchEvent(new Event('tasklayout'));
  }
  root.Tasks={upsert:upsert,remove:remove,draw:draw,list:sorted,cancel:cancel,back:function(){if(!expanded)return false;expanded=false;draw();return true;}};
})(typeof window!=='undefined'?window:globalThis);
