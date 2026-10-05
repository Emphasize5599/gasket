/* Debug log. Off unless you turn on "Debug logging" in Settings.
 * Levels: 1 errors, 2 + warnings, 3 + steps, 4 + details (requests/answers, summarized), 5 + everything (raw answers, trimmed).
 * Kept in a private file on the phone (newest ~400 KB). Your Google API key is never written to it. */
(function (root) {
  'use strict';
  var LEVELS = { 1: 'ERROR', 2: 'WARN', 3: 'INFO', 4: 'DEBUG', 5: 'TRACE' };
  var level = 0, entries = [], store = null, saveT = null, MAX = 400 * 1024;
  var secret = [];

  function scrub(text) {
    secret.forEach(function (k) { if (k && k.length > 8) text = text.split(k).join('[API key]'); });
    return text.replace(/AIza[0-9A-Za-z_\-]{30,}/g, '[API key]');
  }
  function clip(v, n) {
    var t;
    try { t = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { t = String(v); }
    if (t == null) return undefined;
    t = scrub(t);
    return t.length > n ? t.slice(0, n) + '… (' + t.length + ' chars)' : t;
  }
  function size() { return entries.reduce(function (a, e) { return a + (e.m || '').length + (e.d || '').length + 40; }, 0); }
  function persist() {
    if (!store) return;
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      while (entries.length > 50 && size() > MAX) entries.splice(0, Math.ceil(entries.length / 10));
      try { store.save(JSON.stringify(entries)); } catch (e) { }
    }, 800);
  }
  function log(lvl, area, msg, data) {
    if (!level || lvl > level) return;
    var e = { t: new Date().toISOString(), l: LEVELS[lvl], a: area, m: scrub(String(msg)) };
    if (data !== undefined) e.d = clip(data, lvl >= 5 ? 20000 : 2000);
    entries.push(e);
    persist();
  }
  var api = {
    LEVELS: LEVELS,
    configure: function (lvl, st, keys) {
      level = lvl | 0; if (st) store = st; secret = (keys || []).filter(Boolean);
      if (store && !entries.length) { try { entries = JSON.parse(store.load() || '[]') || []; } catch (e) { entries = []; } }
    },
    level: function () { return level; },
    error: function (a, m, d) { log(1, a, m, d); },
    warn: function (a, m, d) { log(2, a, m, d); },
    info: function (a, m, d) { log(3, a, m, d); },
    debug: function (a, m, d) { log(4, a, m, d); },
    trace: function (a, m, d) { log(5, a, m, d); },
    entries: function () { return entries.slice(); },
    clear: function () { entries = []; if (store) store.save('[]'); },
    text: function () {
      return entries.map(function (e) { return e.t + ' ' + e.l + ' [' + e.a + '] ' + e.m + (e.d ? '\n    ' + e.d : ''); }).join('\n');
    }
  };
  root.addEventListener && root.addEventListener('error', function (ev) { log(1, 'app', 'Uncaught: ' + ev.message, (ev.filename || '') + ':' + (ev.lineno || '')); });
  root.addEventListener && root.addEventListener('unhandledrejection', function (ev) { log(1, 'app', 'Unhandled: ' + (ev.reason && ev.reason.message || ev.reason)); });
  root.FLog = api;
})(this);
