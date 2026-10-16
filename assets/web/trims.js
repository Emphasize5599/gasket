/* Trim names for a year / make / model, read from an answer's text. Pure: tested in Node (tests/trims.test.js). */
(function (root) {
  'use strict';
  var NOT_A_TRIM = /\b(is|are|was|were|the|with|offers?|offered|available|which|include[sd]?|including|levels?|trims?|models?|years?|version|starts?|starting|priced|msrp|price|engine|features?|comes?|option(al)?|package|lineup|range|answer|generated|verify|sources?)\b/i;
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  /**
   * The trims in an answer that starts its list with "Trims:" (what the app asks for), else after "trim levels are /
   * include". Words naming the car itself (make, model) are dropped from each name; sentences and prices are not names.
   * -> ['LX', 'Sport', 'EX-L', 'Touring'] (at most 30), or [] when the text has no such list.
   */
  function parse(text, car) {
    var t = String(text || '').replace(/\s+/g, ' ');
    var m = /\btrims?\s*:\s*/i.exec(t) || /\btrim(?: levels?)?(?: options)?\s+(?:are|include|includes)\s*:?\s*/i.exec(t);
    if (!m) return [];
    var rest = t.slice(m.index + m[0].length, m.index + m[0].length + 600).replace(/\([^)]*\)/g, ' ');   // asides first: they hold commas ($35,000)
    rest = rest.split(/\s*(?:AI[- ]generated|Please verify|verify critical facts|Sources?\b|Ask a follow|Was this helpful)/i)[0];   // Brave's own words after its answer
    rest = rest.split(/(?:\.\s+[A-Z]|\. *$|\s+[-–—]\s+[A-Z][a-z]+\s+[a-z]|\bwhile\b)/)[0];   // the list, not the sentence after it
    var drop = norm([car && car.make, car && car.model].join(' ')).split(' ').filter(function (w) { return w.length > 1 && !/^\d+$/.test(w); });
    var seen = {}, out = [];
    rest.split(/\s*(?:,|;|•|\||\/|\band\b|\bor\b)\s*/i).forEach(function (raw) {
      var s = raw.replace(/\([^)]*\)/g, ' ').replace(/^\s*(?:\d{1,2}[.)]\s+|[-*]\s*)/, '').replace(/[.:!?"“”*]+$/g, '').replace(/^["“]+/, '').trim();
      if (car && car.year) s = s.replace(new RegExp('\\b' + car.year + '\\b', 'g'), ' ');
      s = s.split(/\s+/).filter(function (w) { return drop.indexOf(norm(w)) < 0; }).join(' ').trim();
      if (!s || s.length > 28 || s.split(' ').length > 4 || !/[a-z0-9]/i.test(s) || NOT_A_TRIM.test(s) || /\$\s*\d/.test(s)) return;
      var k = norm(s); if (!k || seen[k]) return;
      seen[k] = 1; out.push(s);
    });
    return out.slice(0, 30);
  }
  /** Several sources' lists as one, each name once (the first source's spelling wins). */
  function merge() {
    var seen = {}, out = [];
    Array.prototype.forEach.call(arguments, function (list) {
      (list || []).forEach(function (s) { s = String(s || '').trim(); var k = norm(s); if (k && !seen[k]) { seen[k] = 1; out.push(s); } });
    });
    return out;
  }
  /** The list's own spelling of a trim (case and punctuation aside), or ''. */
  function find(list, trim) { var k = norm(trim); if (!k) return ''; for (var i = 0; i < (list || []).length; i++) if (norm(list[i]) === k) return list[i]; return ''; }
  var api = { parse: parse, merge: merge, find: find, norm: norm };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.TrimMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
