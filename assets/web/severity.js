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
  // background worker when the phone allows one (the screen stays smooth however long it takes); otherwise here, one
  // sentence at a time with a pause before each.
  function rest(ms) { return new Promise(function (r) { setTimeout(r, ms == null ? 24 : ms); }); }
  var KV = function () { return root.__app && root.__app.KV; };
  // how far along: the download (first time only, 0–70%), working out the examples (70–95%), then ready
  var prog = { f: 0, label: 'Waiting to rate' }, listeners = [];
  function setProg(f, label) { prog = { f: Math.max(prog.f, Math.min(1, f)), label: label }; listeners.forEach(function (fn) { try { fn(prog); } catch (e) { } }); }
  var files = {};
  function onFile(p) {
    if (!p || !p.total) return;
    files[p.file] = { a: p.loaded || 0, b: p.total };
    var a = 0, b = 0; Object.keys(files).forEach(function (k) { a += files[k].a; b += files[k].b; });
    setProg(0.02 + 0.68 * (a / b), 'Downloading the rating model (first time only)');
  }
  var WORKER = [
    'var pipe = null;',
    'self.onmessage = async function (e) { var m = e.data; try {',
    '  if (m.type === "init") {',
    '    var T = await import(m.lib); T.env.allowLocalModels = false; T.env.useBrowserCache = false;',
    '    if (T.env.backends && T.env.backends.onnx && T.env.backends.onnx.wasm) { T.env.backends.onnx.wasm.numThreads = 1; T.env.backends.onnx.wasm.proxy = false; }',
    '    pipe = await T.pipeline("feature-extraction", m.model, { dtype: "q8", progress_callback: function (p) { if (p && p.status === "progress" && p.total) self.postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total }); } });',
    '    self.postMessage({ type: "ready" });',
    '  } else if (m.type === "embed") {',
    '    var o = await pipe(m.texts, { pooling: "mean", normalize: true });',
    '    self.postMessage({ type: "emb", id: m.id, data: Array.from(o.data), n: m.texts.length });',
    '  }',
    '} catch (err) { self.postMessage({ type: "error", id: m.id, msg: String(err && err.message || err) }); } };'].join('\n');
  var mode = '';      // 'worker' | 'page'
  /** The model in a background worker -> embedMany(texts) -> [vector per text]. Rejects if the phone won't run one. */
  function startWorker() {
    return new Promise(function (ok, no) {
      var w, seq = 0, pend = {}, ready = false, dog = 0;
      var fail = function (why) { clearTimeout(dog); try { w && w.terminate(); } catch (e) { } Object.keys(pend).forEach(function (k) { pend[k].no(new Error(why)); }); if (!ready) no(new Error(why)); };
      var watch = function () { clearTimeout(dog); if (!ready) dog = setTimeout(function () { fail('the worker went quiet'); }, 30000); };
      try { w = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }))); } catch (e) { return no(e); }   // a classic worker (a module one won't start from the app's page); it imports the library itself
      w.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); fail(e && e.message || 'worker error'); };
      w.onmessage = function (e) {
        var m = e.data || {}; watch();
        if (m.type === 'progress') onFile(m);
        else if (m.type === 'ready') { ready = true; clearTimeout(dog); ok(function (texts) {
          return new Promise(function (r, j) { var id = ++seq; pend[id] = { ok: r, no: j }; w.postMessage({ type: 'embed', id: id, texts: texts }); });
        }); }
        else if (m.type === 'emb') {
          var p = pend[m.id]; delete pend[m.id]; if (!p) return;
          var dim = m.data.length / m.n, rows = []; for (var i = 0; i < m.n; i++) rows.push(m.data.slice(i * dim, (i + 1) * dim)); p.ok(rows);
        } else if (m.type === 'error') { if (m.id && pend[m.id]) { pend[m.id].no(new Error(m.msg)); delete pend[m.id]; } else fail(m.msg); }
      };
      watch();
      w.postMessage({ type: 'init', lib: LIB, model: MODEL });
    });
  }
  /** The model here, in the page (the fallback): one sentence at a time, with a pause before each so taps get through. */
  async function startPage() {
    var T = await import(LIB);
    T.env.allowLocalModels = false; T.env.useBrowserCache = false;     // the app keeps the files itself
    if (T.env.backends && T.env.backends.onnx && T.env.backends.onnx.wasm) { T.env.backends.onnx.wasm.numThreads = 1; T.env.backends.onnx.wasm.proxy = false; }
    await rest();
    var pipe = await T.pipeline('feature-extraction', MODEL, { dtype: 'q8', progress_callback: function (p) { if (p && p.status === 'progress') onFile(p); } });
    return async function (texts) { var out = []; for (var i = 0; i < texts.length; i++) { await rest(60); out.push(Array.from((await pipe(texts[i], { pooling: 'mean', normalize: true })).data)); } return out; };
  }
  /** Load the library and the model (the first time: the download); resolves to embedMany(texts). */
  function load() {
    if (loading) return loading;
    state = 'loading';
    loading = (async function () {
      setProg(0.02, 'Getting the rating model ready');
      try { embed = await startWorker(); mode = 'worker'; }
      catch (e) { if (root.FLog) root.FLog.info('car', 'Recall rating runs in the page (no background worker)', String(e && e.message || e)); embed = await startPage(); mode = 'page'; }
      setProg(0.7, 'Setting up the rating model');
      // the examples' vectors are worked out once and kept (they only change with VERSION)
      var kv = KV(), ak = 'anchors|' + VERSION + '|' + MODEL, kept = kv && kv.get('ai', ak);
      if (kept && kept.v && kept.v[3] && kept.v[3].length === EXAMPLES[3].length && kept.v[1].length === EXAMPLES[1].length && kept.v[2].length === EXAMPLES[2].length) anchors = kept.v;
      else {
        var a = {};
        for (var k = 3; k >= 1; k--) {
          var vs = await embed(EXAMPLES[k]);
          a[k] = EXAMPLES[k].map(function (t, i) { return { t: t, v: Array.from(vs[i]).map(function (x) { return Math.round(x * 1e5) / 1e5; }) }; });
          setProg(0.7 + 0.25 * (4 - k) / 3, 'Setting up the rating model');
        }
        anchors = a; if (kv) kv.put('ai', ak, a);
      }
      state = 'ready'; setProg(0.95, 'Rating');
      if (root.FLog) root.FLog.info('car', 'Recall rating model ready (' + (mode === 'worker' ? 'background worker' : 'in the page') + ')');
      return embed;
    })().catch(function (e) { state = 'failed'; loading = null; throw e; });
    return loading;
  }
  function score(v) {
    var sc = {}, near = {};
    for (var k = 3; k >= 1; k--) {
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
   *  background worker, a few at once and straight on while Advisory is on screen (a pause between groups when it
   *  isn't); in the page, one at a time with a pause (a long one when Advisory isn't on screen). */
  var queue = [], queued = {}, dones = [], running = false;
  var watching = function () { return true; };    // Advisory says whether it's on screen (focus)
  function rate(list, done) {
    var todo = (list || []).filter(function (x) { return !get(x) && !queued[key(x)]; });
    todo.forEach(function (x) { queued[key(x)] = 1; queue.push(x); });
    if (done && (todo.length || running) && dones.indexOf(done) < 0) dones.push(done);
    if (running || !queue.length) return;
    running = true;
    var mock = root.__mocks && root.__mocks.severity;        // the desktop tests stand in for the model
    var tell = function () { var d = dones.slice(); d.forEach(function (f) { try { f(); } catch (e) { } }); };
    var finish = function () { running = false; queue = []; queued = {}; if (root.__app && root.__app.save) root.__app.save(); var d = dones; dones = []; d.forEach(function (f) { try { f(); } catch (e) { } }); };
    (async function () {
      if (!mock) await load();
      var st = store();
      while (queue.length) {
        var n = mock ? queue.length : mode === 'worker' ? 4 : 1;
        var group = queue.splice(0, n).filter(function (x) { return !st[key(x)]; });
        if (!group.length) continue;
        var r = mock ? group.map(function (x) { return mock(text(x)); }) : await rateTexts(group.map(text));
        group.forEach(function (x, i) { st[key(x)] = r[i]; });
        if (!queue.length || mock) break;
        if (root.__app && root.__app.save) root.__app.save();
        tell();                                                                           // show the ones done so far
        await rest(mode === 'worker' ? (watching() ? 0 : 2500) : (watching() ? 250 : 6000));
      }
      finish();
    })().catch(function (e) { if (root.FLog) root.FLog.warn('car', 'Couldn\'t load the recall rating model', String(e && e.message || e)); finish(); });
  }
  function busy() { return running; }
  /** How close a text reads to each group of example sentences: { group: average of its two closest } (loads the model
   *  if needed), or null when it can't (no model in the tests, or it failed). */
  function compare(txt, groups) {
    if (root.__mocks && root.__mocks.severity) return Promise.resolve(null);
    return load().then(async function () {
      var names = Object.keys(groups), all = [String(txt).slice(0, 300)];
      names.forEach(function (g) { all = all.concat(groups[g]); });
      var vs = await embed(all), v = vs[0], at = 1, out = {};
      names.forEach(function (g) {
        var sc = groups[g].map(function () { return dot(v, vs[at++]); }).sort(function (a, b) { return b - a; });
        out[g] = (sc[0] + (sc[1] != null ? sc[1] : sc[0])) / 2;
      });
      return out;
    }).catch(function () { return null; });
  }
  root.Severity = { get: get, rate: rate, busy: busy, focus: function (fn) { watching = fn; }, compare: compare, progress: function () { return prog; }, onProgress: function (fn) { listeners.push(fn); }, state: function () { return state; }, EXAMPLES: EXAMPLES, mode: function () { return mode; }, _rateText: function (t) { return load().then(function () { return rateTexts([t]); }).then(function (r) { return r[0]; }); } };
})(typeof window !== 'undefined' ? window : globalThis);
