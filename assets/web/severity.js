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
  // the model runs on the same thread as the buttons: a short pause before each sentence lets taps through
  function rest() { return new Promise(function (r) { setTimeout(r, 24); }); }
  var KV = function () { return root.__app && root.__app.KV; };
  // how far along: the download (first time only, 0–70%), working out the examples (70–95%), then ready
  var prog = { f: 0, label: 'Waiting to rate' }, listeners = [];
  function setProg(f, label) { prog = { f: Math.max(prog.f, Math.min(1, f)), label: label }; listeners.forEach(function (fn) { try { fn(prog); } catch (e) { } }); }
  /** Load the library and the model (the first time: the download); resolves to an embedding function. */
  function load() {
    if (loading) return loading;
    state = 'loading';
    loading = (async function () {
      var T = await import(LIB);
      T.env.allowLocalModels = false; T.env.useBrowserCache = false;     // the app keeps the files itself
      if (T.env.backends && T.env.backends.onnx && T.env.backends.onnx.wasm) { T.env.backends.onnx.wasm.numThreads = 1; T.env.backends.onnx.wasm.proxy = false; }
      await rest();
      var files = {};
      setProg(0.02, 'Getting the rating model ready');
      var pipe = await T.pipeline('feature-extraction', MODEL, { dtype: 'q8', progress_callback: function (p) {
        if (!p || p.status !== 'progress' || !p.total) return;
        files[p.file] = { a: p.loaded || 0, b: p.total };
        var a = 0, b = 0; Object.keys(files).forEach(function (k) { a += files[k].a; b += files[k].b; });
        setProg(0.02 + 0.68 * (a / b), 'Downloading the rating model (first time only)');
      } });
      setProg(0.7, 'Setting up the rating model');
      embed = async function (t) { await rest(); return Array.from((await pipe(t, { pooling: 'mean', normalize: true })).data); };
      // the examples' vectors are worked out once and kept (they only change with VERSION)
      var kv = KV(), ak = 'anchors|' + VERSION + '|' + MODEL, kept = kv && kv.get('ai', ak);
      if (kept && kept.v && kept.v[3] && kept.v[3].length === EXAMPLES[3].length && kept.v[1].length === EXAMPLES[1].length && kept.v[2].length === EXAMPLES[2].length) anchors = kept.v;
      else {
        var a = {};
        var nEx = EXAMPLES[1].length + EXAMPLES[2].length + EXAMPLES[3].length, done = 0;
        for (var k = 3; k >= 1; k--) { a[k] = []; for (var i = 0; i < EXAMPLES[k].length; i++) { a[k].push({ t: EXAMPLES[k][i], v: (await embed(EXAMPLES[k][i])).map(function (x) { return Math.round(x * 1e5) / 1e5; }) }); setProg(0.7 + 0.25 * (++done / nEx), 'Setting up the rating model'); } }
        anchors = a; if (kv) kv.put('ai', ak, a);
      }
      state = 'ready'; setProg(0.95, 'Rating');
      return embed;
    })().catch(function (e) { state = 'failed'; loading = null; throw e; });
    return loading;
  }
  /** Rate one recall's text -> {level 1..3, near: the closest example}. */
  async function rateText(text) {
    var v = await embed(String(text).slice(0, 600)), sc = {}, near = {};
    for (var k = 3; k >= 1; k--) {
      var s = anchors[k].map(function (a) { return { s: dot(v, a.v), t: a.t }; }).sort(function (p, q) { return q.s - p.s; });
      sc[k] = s.slice(0, TOP).reduce(function (a, b) { return a + b.s; }, 0) / TOP; near[k] = s[0].t;
    }
    var lvl = sc[3] >= sc[2] && sc[3] >= sc[1] ? 3 : sc[2] >= sc[1] ? 2 : 1;
    if (lvl === 3 && sc[3] - sc[2] < MARGIN) lvl = 2;      // serious only when it clearly reads that way
    return { level: lvl, near: near[lvl] };
  }
  function key(x) { return x.id || (x.comp || '') + '|' + String(x.cons || x.sum || '').slice(0, 40); }
  /** The rating we already have for a recall, or null (not rated yet). */
  function get(x) {
    if (x.park || x.out) return { level: 3, near: x.park ? 'NHTSA says not to drive it until it\'s fixed.' : 'NHTSA says to park it outside until it\'s fixed.', fact: true };
    var r = store()[key(x)]; return r || null;
  }
  /** Rate the recalls not rated yet (loading the model the first time); calls done() once anything new is in.
   *  One run at a time: recalls asked for while it runs join the queue (a redraw asking again adds nothing). */
  var queue = [], queued = {}, dones = [], running = false;
  function rate(list, done) {
    var todo = (list || []).filter(function (x) { return !get(x) && !queued[key(x)]; });
    todo.forEach(function (x) { queued[key(x)] = 1; queue.push(x); });
    if (done && (todo.length || running) && dones.indexOf(done) < 0) dones.push(done);
    if (running || !queue.length) return;
    running = true;
    var mock = root.__mocks && root.__mocks.severity;        // the desktop tests stand in for the model
    var finish = function () {
      running = false; queue = []; queued = {};
      if (root.__app && root.__app.save) root.__app.save();
      var d = dones; dones = []; d.forEach(function (f) { try { f(); } catch (e) { } });
    };
    (async function () {
      if (!mock) await load();
      var st = store();
      while (queue.length) {
        var x = queue.shift(), text = (String(x.cons || '') + ' ' + String(x.sum || '')).trim();
        if (!st[key(x)]) st[key(x)] = mock ? mock(text) : await rateText(text);
      }
      finish();
    })().catch(function (e) { if (root.FLog) root.FLog.warn('car', 'Couldn\'t load the recall rating model', String(e && e.message || e)); finish(); });
  }
  function busy() { return running; }
  /** How close a text reads to each group of example sentences: { group: average of its two closest } (loads the model
   *  if needed), or null when it can't (no model in the tests, or it failed). */
  function compare(text, groups) {
    if (root.__mocks && root.__mocks.severity) return Promise.resolve(null);
    return load().then(async function () {
      var v = await embed(String(text).slice(0, 300)), out = {};
      for (var g in groups) {
        var sc = [];
        for (var i = 0; i < groups[g].length; i++) sc.push(dot(v, await embed(groups[g][i])));
        sc.sort(function (a, b) { return b - a; }); out[g] = (sc[0] + (sc[1] != null ? sc[1] : sc[0])) / 2;
      }
      return out;
    }).catch(function () { return null; });
  }
  root.Severity = { get: get, rate: rate, busy: busy, compare: compare, progress: function () { return prog; }, onProgress: function (fn) { listeners.push(fn); }, state: function () { return state; }, EXAMPLES: EXAMPLES, _rateText: function (t) { return load().then(function () { return rateText(t); }); } };
})(typeof window !== 'undefined' ? window : globalThis);
