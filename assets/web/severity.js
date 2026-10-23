/* Gasket — how serious a recall is, rated on the phone by a small AI model (no AI service; recall text never leaves the
 * phone). The model is all-MiniLM-L6-v2 (a ~23 MB sentence model) run by transformers.js. It turns a recall's wording into
 * a "meaning" vector and compares it with short example descriptions of serious, moderate and minor recalls; the closest
 * group wins (by the average of its three nearest examples, and "serious" has to win clearly). The model and its runtime
 * download once, the first time a recall needs rating; the app keeps the files (MainActivity caches them on the phone).
 * Ratings are kept by recall number, so each recall is rated once.
 * NHTSA's own "don't drive it" / "park it outside" flags are facts, not a guess: those are serious without the model. */
(function (root) {
  var LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1/dist/transformers.min.js';
  var MODEL = 'Xenova/all-MiniLM-L6-v2', VERSION = 1, TOP = 3, MARGIN = 0.03;
  var EXAMPLES = {
    3: ['The vehicle can crash without warning.', 'A wheel or axle hub can separate from the vehicle while driving, causing a crash.',
      'The steering shaft can separate, and the driver loses steering control.', 'A suspension ball joint can break, and the driver can lose control of the front wheels.',
      'The brakes can fail, and the driver cannot stop the vehicle.', 'The vehicle can lose drive power at highway speed, increasing the risk of a crash.',
      'The vehicle can catch fire while parked or driving.', 'A fuel leak near an ignition source can cause a fire.', 'An electrical short can cause a fire.',
      'The air bag may not deploy in a crash, increasing the risk of injury.', 'The air bag inflator can rupture and send metal fragments into the occupants.',
      'The seat belt may not restrain the occupant in a crash.', 'The vehicle can move or roll away unexpectedly and strike someone.',
      'The vehicle can accelerate or brake unexpectedly, causing a crash.', 'The driver can lose control of the vehicle.'],
    2: ['The engine may stall while driving, increasing the risk of a crash.', 'Reduced rear visibility from a blank rearview camera increases the risk of a crash.',
      'A light may not work, making the vehicle harder to see.', 'The windshield wipers may not work, reducing visibility.',
      'Several systems such as the wipers, defroster, camera or lights may stop working.', 'A part may detach and become a road hazard for other drivers.',
      'A door may open while driving, increasing the risk of injury.', 'A trim panel may come loose and injure an occupant.',
      'The brakes may drag, causing noise, vibration and a warning lamp.', 'A warning lamp may not illuminate.', 'Increased stopping distance increases the risk of a crash.',
      'The spare tire may fall from its carrier.'],
    1: ['The label has incorrect information.', 'The vehicle placard lists incorrect tire or load information.', 'The owner\'s manual is missing required information.',
      'The vehicle does not comply with a labeling requirement.', 'The trunk lid may not latch.', 'A cosmetic part may be loose.', 'A warning light may come on unnecessarily.',
      'A child seat anchor label is missing.', 'The driver may overload the vehicle because of an inaccurate label.']
  };
  // the closest example, said the way a person would ("most like: …") — the example itself is plain enough
  var state = 'idle', loading = null, embed = null, anchors = null, waiting = [];
  var S = function () { return root.__app && root.__app.S; };
  function store() { var s = S(); if (!s) return {}; if (!s.recallSev || s.recallSev.v !== VERSION) s.recallSev = { v: VERSION, r: {} }; return s.recallSev.r; }
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  // In the main thread the model would share the thread that draws the screen and takes your taps. So it runs in a
  // background worker. Hazard callers can use wording rules on failure; recalls
  // stay explicitly unrated until retry succeeds. Inference never uses the UI thread.
  function rest(ms) { return new Promise(function (r) { setTimeout(r, ms == null ? 24 : ms); }); }
  var KV = function () { return root.__app && root.__app.KV; };
  // how far along: the download (first time only, 0–70%), working out the examples (70–95%), then ready
  var prog = { f: 0, label: 'Waiting to rate' }, listeners = [];
  var comparing = 0, failedAt = 0, groupVectors = new Map();
  var recallDone=0,recallTotal=0,recallFailures=0,failedRatings=new Map();
  var workerStop=null,workerCPUOnly=null,gpuFailed=false,backendInfo={state:'idle',device:'',dtype:'',gpuWhy:'',adapterPath:''};
  function cpuOnly(){try{var a=root.__app,st=root.Gemma&&root.Gemma.status&&root.Gemma.status();if(st&&typeof st.cpuOnly==='boolean')return st.cpuOnly;if(a&&a.N&&a.N.aiStatus)return !!JSON.parse(a.N.aiStatus()).cpuOnly;}catch(e){}return false;}
  function notifyBackend(){backendInfo.state=state;backendInfo.cpuOnly=cpuOnly();if(root.dispatchEvent&&root.Event)root.dispatchEvent(new root.Event('lightweightchange'));}
  if(root.addEventListener)root.addEventListener('gemmachange',function(){if(workerCPUOnly!==null&&workerCPUOnly!==cpuOnly()){gpuFailed=false;if(workerStop)workerStop('AI processor setting changed',true);}});
  function log(level,message,details){if(root.FLog&&root.FLog[level])root.FLog[level]('ai',message,details);}
  function taskStatus() {
    if (!root.Tasks) return;
    if (state === 'loading' || running || comparing) root.Tasks.upsert('lightweight-ai', { state:'running',text: state === 'loading' ? prog.label : running && comparing ? 'AI: rating recalls and route hazards…' : running ? 'AI: rating recalls · '+recallDone+'/'+recallTotal : 'AI: reading route hazards…', frac: running&&!comparing&&state!=='loading'&&recallTotal?recallDone/recallTotal:null });
    else if(retryTimer&&queue.length)root.Tasks.upsert('lightweight-ai',{state:'pending',text:'AI: '+queue.length+' recall ratings waiting to retry',frac:null});
    else root.Tasks.remove('lightweight-ai');
  }
  function setProg(f, label) { prog = { f: Math.max(prog.f, Math.min(1, f)), label: label }; taskStatus(); listeners.forEach(function (fn) { try { fn(prog); } catch (e) { } }); }
  var files = {};
  function onFile(p) {
    if (!p || !p.total) return;
    files[p.file] = { a: p.loaded || 0, b: p.total };
    var a = 0, b = 0; Object.keys(files).forEach(function (k) { a += files[k].a; b += files[k].b; });
    setProg(0.02 + 0.68 * (a / b), 'Downloading the rating model (first time only)');
  }
  var WORKER = [
    'var initializeBackend = '+root.LightweightGPU.initialize.toString()+';',
    'var pipe = null;',
    'self.onmessage = async function (e) { var m = e.data; try {',
    '  if (m.type === "init") {',
    '    var T = await import(m.lib); T.env.allowLocalModels = false; T.env.useBrowserCache = false;',
    '    if (T.env.backends && T.env.backends.onnx && T.env.backends.onnx.wasm) { T.env.backends.onnx.wasm.numThreads = 1; T.env.backends.onnx.wasm.proxy = false; }',
    '    var prog = function (p) { if (p && p.status === "progress" && p.total) self.postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total }); };',
    '    var backend = await initializeBackend(T,self.navigator,{model:m.model,cpuOnly:m.cpuOnly,cpuReason:m.cpuReason,progress:prog},function(info){self.postMessage({type:"backend",info:info});}); pipe=backend.pipe;',
    '    self.postMessage({ type: "ready", device: backend.device, dtype: backend.dtype, gpuWhy: backend.gpuWhy, adapterPath:backend.adapterPath, attempts:backend.attempts });',
    '  } else if (m.type === "embed") {',
    '    var o = await pipe(m.texts, { pooling: "mean", normalize: true });',
    '    self.postMessage({ type: "emb", id: m.id, data: Array.from(o.data), n: m.texts.length });',
    '  }',
    '} catch (err) { self.postMessage({ type: "error", id: m.id, msg: String(err && err.message || err) }); } };'].join('\n');
  var mode = '', device = '', dtype = '';      // 'worker' | 'page'; 'webgpu' | 'wasm'; the model's number format
  /** The model in a background worker -> embedMany(texts) -> [vector per text]. Rejects if the phone won't run one. */
  function startWorker() {
    workerCPUOnly=cpuOnly();
    return new Promise(function (ok, no) {
      var w, url, seq = 0, pend = {}, ready = false, dog = 0, dead = false, active = 0, queue = [];
      var fail = function (why,changed) { if(dead)return;dead=true;workerStop=null;clearTimeout(dog);var current=pend[active],error=new Error(why);error.processorChanged=!!changed;log(changed?'info':'warn','Lightweight inference '+(changed?'processor changed':'failed'),{reason:why,device:device||'initializing',dtype:dtype,active:active,count:current&&current.texts.length||0,elapsedMs:current?Date.now()-current.startedAt:0,queued:queue.length});try { w && w.terminate(); URL.revokeObjectURL(url); } catch (e) { }
        if(!changed&&!workerCPUOnly&&(ready&&device==='webgpu'||!ready&&/^(gpu-|adapter-probe)/.test(backendInfo.phase||'')))gpuFailed=true;
        Object.keys(pend).forEach(function (k) { pend[k].no(error); });pend={};queue=[];
        if(changed){state='idle';failedAt=0;loading=null;groupVectors.clear();notifyBackend();taskStatus();if(!ready)no(error);return;}
        if(ready){state='failed';failedAt=Date.now();loading=null;groupVectors.clear();notifyBackend();taskStatus();log('warn','Lightweight model stopped; unfinished recall ratings will be retried',why);}else no(new Error(why)); };
      function pump(){if(dead||active||!queue.length)return;active=queue.shift();var p=pend[active];p.startedAt=Date.now();var timeout=device==='webgpu'?45000:60000;log('debug','Lightweight inference started',{id:active,device:device,dtype:dtype,count:p.texts.length,chars:p.texts.reduce(function(n,t){return n+t.length;},0),queueMs:p.startedAt-p.queuedAt,timeoutMs:timeout});try{w.postMessage({type:'embed',id:active,texts:p.texts});dog=setTimeout(function(){fail('Rating request timed out');},timeout);}catch(e){fail('Rating worker unavailable');}}
      var watch = function () { clearTimeout(dog); if (!ready) dog = setTimeout(function () { fail('the worker went quiet'); }, workerCPUOnly?60000:120000); };
      try { url=URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })); w = new Worker(url); } catch (e) { if(url)URL.revokeObjectURL(url);return no(e); }   // a classic worker; imports the library itself
      w.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); fail(e && e.message || 'worker error'); };
      w.onmessage = function (e) {
        var m = e.data || {}; if(dead)return;if(!ready)watch();
        if(m.type==='backend'){backendInfo=Object.assign({},backendInfo,{phase:m.info&&m.info.phase,attempt:m.info});log('debug','Lightweight GPU initialization',m.info);setProg(prog.f,m.info&&m.info.phase==='cpu-fallback'?'Preparing the rating model on CPU':'Checking the rating model GPU');notifyBackend();return;}
        if(m.type==='ready'){backendInfo=Object.assign({},backendInfo,{device:m.device||'wasm',dtype:m.dtype||'q8',gpuWhy:m.gpuWhy||'',adapterPath:m.adapterPath||'',attempts:m.attempts||[]});notifyBackend();log('info','Lightweight backend selected',backendInfo);}
        if (m.type === 'progress') onFile(m);
        else if (m.type === 'ready') { ready = true; clearTimeout(dog); device = m.device || 'wasm'; dtype = m.dtype || 'q8'; if (root.FLog) root.FLog[device === 'webgpu' ? 'info' : 'warn']('car', 'Recall rating model on ' + (device === 'webgpu' ? 'the GPU (WebGPU, ' + dtype + ')' : 'the CPU' + (m.gpuWhy ? ': ' + m.gpuWhy : '')), {}); ok(async function (texts) {
          var rows=[],batch=device==='webgpu'?4:1;
          for(var at=0;at<texts.length;at+=batch){var part=texts.slice(at,at+batch);rows=rows.concat(await new Promise(function (r, j) { if(dead)return j(new Error('Rating worker stopped'));var id = ++seq; pend[id] = { ok: r, no: j, texts:part,queuedAt:Date.now() }; queue.push(id);pump(); }));}
          return rows;
        }); }
        else if (m.type === 'emb') {
          var p = pend[m.id]; if (!p||m.id!==active) return;
          if(!Array.isArray(m.data)||!m.data.length||m.n!==p.texts.length||!m.n||m.data.length%m.n||!m.data.every(Number.isFinite)){fail('Invalid rating result');return;}
          log('debug','Lightweight inference completed',{id:m.id,device:device,count:m.n,elapsedMs:Date.now()-p.startedAt,queued:queue.length});delete pend[m.id];clearTimeout(dog);active=0;
          var dim = m.data.length / m.n, rows = []; for (var i = 0; i < m.n; i++) rows.push(m.data.slice(i * dim, (i + 1) * dim)); p.ok(rows);pump();
        } else if (m.type === 'error') fail('Rating worker error: '+String(m.msg||'unknown').slice(0,160));
      };
      workerStop=fail;watch();
      w.postMessage({ type: 'init', lib: LIB, model: MODEL,cpuOnly:workerCPUOnly||gpuFailed,cpuReason:!workerCPUOnly&&gpuFailed?'Previous GPU inference failed; CPU fallback':'' });
    });
  }
  /** Load the library and the model (the first time: the download); resolves to embedMany(texts). */
  function load() {
    if (loading) return loading;
    if(failedAt&&Date.now()-failedAt<60000)return Promise.reject(new Error('Rating model cooling down'));
    state = 'loading';
    loading = (async function () {
      setProg(0.02, 'Getting the rating model ready');
      embed = await startWorker(); mode = 'worker';
      setProg(0.7, 'Setting up the rating model');
      // the examples' vectors are worked out once and kept (they only change with VERSION)
      var kv = KV(), ak = 'anchors|' + VERSION + '|' + MODEL + (dtype && dtype !== 'q8' ? '|' + dtype : ''), kept = kv && kv.get('ai', ak);
      if (kept && kept.v && [3,2,1].every(function(k){return Array.isArray(kept.v[k])&&kept.v[k].length===EXAMPLES[k].length&&kept.v[k].every(function(a){return a&&typeof a.t==='string'&&Array.isArray(a.v)&&a.v.length&&a.v.every(Number.isFinite);});})) anchors = kept.v;
      else {
        var a = {};
        for (var k = 3; k >= 1; k--) {
          var vs = await embed(EXAMPLES[k]);
          a[k] = EXAMPLES[k].map(function (t, i) { return { t: t, v: Array.from(vs[i]).map(function (x) { return Math.round(x * 1e5) / 1e5; }) }; });
          setProg(0.7 + 0.25 * (4 - k) / 3, 'Setting up the rating model');
        }
        anchors = a; if (kv) kv.put('ai', ak, a);
      }
      state = 'ready';notifyBackend(); setProg(0.95, 'Rating');
      if (root.FLog) root.FLog.info('car', 'Recall rating model ready (' + (mode === 'worker' ? 'background worker' : 'in the page') + (device ? ', ' + (device === 'webgpu' ? 'GPU' : 'CPU') : '') + ')');
      return embed;
    })().catch(function (e) { state = e.processorChanged?'idle':'failed'; failedAt=e.processorChanged?0:Date.now();loading = null;groupVectors.clear();notifyBackend(); taskStatus(); throw e; });
    return loading;
  }
  function score(v) {
    var sc = {}, near = {};
    for (var k = 3; k >= 1; k--) {
      if(anchors[k].some(function(a){return a.v.length!==v.length;}))throw Error('Rating vector dimensions do not match the cached examples');
      var s = anchors[k].map(function (a) { return { s: dot(v, a.v), t: a.t }; }).sort(function (p, q) { return q.s - p.s; });
      sc[k] = s.slice(0, TOP).reduce(function (a, b) { return a + b.s; }, 0) / TOP; near[k] = s[0].t;
    }
    var lvl = sc[3] >= sc[2] && sc[3] >= sc[1] ? 3 : sc[2] >= sc[1] ? 2 : 1;
    if (lvl === 3 && sc[3] - sc[2] < MARGIN) lvl = 2;      // serious only when it clearly reads that way
    return { level: lvl, near: near[lvl] };
  }
  /** Rate recalls' texts -> [{level 1..3, near: the closest example}]. */
  async function rateTexts(texts) { var vs = await embed(texts.map(function (t) { return String(t).slice(0, 600); })); return vs.map(score); }
  function text(x) { return (String(x.cons || '') + ' ' + String(x.sum || '')).trim(); }
  function key(x) { return x.id || (x.comp || '') + '|' + String(x.cons || x.sum || '').slice(0, 40); }
  /** The rating we already have for a recall, or null (not rated yet). */
  function get(x) {
    if (x.park || x.out) return { level: 3, near: x.park ? 'NHTSA says not to drive it until it\'s fixed.' : 'NHTSA says to park it outside until it\'s fixed.', fact: true };
    var r = store()[key(x)]; return r || null;
  }
  /** Rate the recalls not rated yet (loading the model the first time); calls done() after each group that's in.
   *  One run at a time: recalls asked for while it runs join the queue (a redraw asking again adds nothing). In the
   *  background worker, CPU singles or small GPU batches without foreground-only delays. */
  var queue = [], queued = {}, dones = [], running = false, retryTimer = 0;
  var watching = function () { return true; };    // Advisory says whether it's on screen (focus)
  function ratingProgress(label){prog={f:recallTotal?recallDone/recallTotal:0,label:label||'Rating recalls · '+recallDone+'/'+recallTotal};taskStatus();listeners.forEach(function(fn){try{fn(prog);}catch(e){}});}
  function scheduleRetry(){if(retryTimer||!queue.length)return;var wait=Math.max(0,60000-(Date.now()-failedAt));retryTimer=setTimeout(function(){retryTimer=0;rate([],null);},wait+50);ratingProgress('Recall ratings paused · retrying automatically');}
  function rate(list, done) {
    var todo = (list || []).filter(function (x) { return !get(x) && !queued[key(x)]&&!failedRatings.has(key(x)); });
    if(!running&&!queue.length&&todo.length){recallDone=0;recallTotal=0;recallFailures=0;}
    recallTotal+=todo.length;
    todo.forEach(function (x) { queued[key(x)] = 1; queue.push(x); });
    if (done && (todo.length || running) && dones.indexOf(done) < 0) dones.push(done);
    if (running || !queue.length) return;
    // After a failure the model rests a minute. Failing each ask at once made the screen redraw, which asked again
    // (2,848 "cooling down" warnings in two minutes in the 0.0.217 log): wait once for the rest to end instead.
    var coolLeft = failedAt && !(root.__mocks && root.__mocks.severity) ? 60000 - (Date.now() - failedAt) : 0;
    if (coolLeft > 0) { scheduleRetry();return; }
    running = true;
    taskStatus();
    var mock = root.__mocks && root.__mocks.severity;        // the desktop tests stand in for the model
    var tell = function () { var d = dones.slice(); d.forEach(function (f) { try { f(); } catch (e) { } }); };
    var group=[];
    var finish = function () { running = false;queue = []; queued = {};taskStatus(); if (root.__app && root.__app.save) root.__app.save(); var d = dones; dones = []; d.forEach(function (f) { try { f(); } catch (e) { } }); };
    (async function () {
      if (!mock) await load();
      var st = store();
      ratingProgress();
      while (queue.length) {
        var n = mock ? queue.length : device==='webgpu'?4:1;
        group = queue.splice(0, n).filter(function (x) { return !st[key(x)]; });
        if (!group.length) continue;
        var r = mock ? group.map(function (x) { return mock(text(x)); }) : await rateTexts(group.map(text));
        group.forEach(function (x, i) { st[key(x)] = r[i]; });
        recallDone+=group.length;recallFailures=0;log('info','Recall rating batch completed',{device:device,batch:group.length,completed:recallDone,total:recallTotal,pending:queue.length});group=[];ratingProgress();
        if (!queue.length || mock) break;
        if (root.__app && root.__app.save) root.__app.save();
        tell();                                                                           // show the ones done so far
        await rest(mode === 'worker' ? 0 : 250); // worker batches continue in the background; page fallback still yields
      }
      finish();
    })().catch(function (e) {
      var why=String(e&&e.message||e);running=false;
      queue=group.filter(function(x){return !get(x);}).concat(queue);group=[];
      if(e.processorChanged){ratingProgress('Switching the rating model processor');setTimeout(function(){rate([],null);},0);return;}
      recallFailures++;
      log('warn','Recall rating pass interrupted',{reason:why,completed:recallDone,total:recallTotal,pending:queue.length,consecutiveFailures:recallFailures});
      if(root.__app&&root.__app.save)root.__app.save();
      if(recallFailures<2&&queue.length){if(!failedAt)failedAt=Date.now();scheduleRetry();tell();}
      else {queue.forEach(function(x){failedRatings.set(key(x),{recall:x,reason:why});});ratingProgress('AI recall ratings unavailable · retry in Advice');finish();}
    });
  }
  function retry(){clearTimeout(retryTimer);retryTimer=0;var pending=Array.from(failedRatings.values()).map(function(x){return x.recall;});failedRatings.clear();recallFailures=0;failedAt=0;if(state==='failed')loading=null;rate(pending,null);}
  function busy() { return running; }
  /** How close a text reads to each group of example sentences: { group: average of its two closest } (loads the model
   *  if needed), or null when it can't (no model in the tests, or it failed). */
  function compare(txt, groups) {
    if (root.__mocks && root.__mocks.severity) return Promise.resolve(null);
    comparing++; taskStatus();
    return load().then(async function () {
      var names = Object.keys(groups), id=JSON.stringify(groups), pending=groupVectors.get(id);
      if(!pending){var all=[];names.forEach(function(g){all=all.concat(groups[g]);});pending=(async function(){var rows=[];for(var i=0;i<all.length;i+=4)rows=rows.concat(await embed(all.slice(i,i+4)));return rows;})();if(groupVectors.size>=8)groupVectors.delete(groupVectors.keys().next().value);groupVectors.set(id,pending);pending.catch(function(){if(groupVectors.get(id)===pending)groupVectors.delete(id);});}
      var vs = await pending, v = (await embed([String(txt).slice(0, 600)]))[0], at = 0, out = {};
      names.forEach(function (g) {
        var sc = groups[g].map(function () { return dot(v, vs[at++]); }).sort(function (a, b) { return b - a; });
        out[g] = (sc[0] + (sc[1] != null ? sc[1] : sc[0])) / 2;
      });
      return out;
    }).catch(function () { return null; }).finally(function () { comparing--; taskStatus(); });
  }
  root.Severity = { get: get, rate: rate, busy: busy,retry:retry,failure:function(x){return failedRatings.get(key(x))||null;},info:function(){return Object.assign({},backendInfo,{state:state,cpuOnly:cpuOnly()});}, focus: function (fn) { watching = fn; }, compare: compare, progress: function () { return prog; }, onProgress: function (fn) { listeners.push(fn); }, state: function () { return state; }, EXAMPLES: EXAMPLES, mode: function () { return mode; }, device: function () { return device; }, _rateText: function (t) { return load().then(function () { return rateTexts([t]); }).then(function (r) { return r[0]; }); } };
})(typeof window !== 'undefined' ? window : globalThis);
