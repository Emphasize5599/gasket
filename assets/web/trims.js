/* Trim names for a year / make / model, read from an answer's text. Pure: tested in Node (tests/trims.test.js). */
(function (root) {
  'use strict';
  var NOT_A_TRIM = /\b(is|are|was|were|the|with|offers?|offered|available|which|include[sd]?|including|levels?|trims?|models?|years?|version|starts?|starting|priced|msrp|price|engine|features?|comes?|option(al)?|package|lineup|(?<!long\s)range|answer|generated|verify|sources?|separated|commas|then|each|following|search|question)\b/i;
  var END_MARK = /\b(?:End\s*:\s*)?(?:GASKET DONE|PACK RESEARCH COMPLETE)\b\.?/gi;
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  // Remove EPA test-mode qualifiers, not meaningful Hybrid/Prime/Cross names.
  function modelName(s) { return String(s || '').replace(/\s*\([^)]*\bmodes?\b[^)]*\)/gi, '').replace(/\s+(?:2WD|4WD|AWD|FWD|RWD|4x4)$/i, '').replace(/\s+/g, ' ').trim(); }
  /**
   * The trims in an answer that starts its list with "Trims:" (what the app asks for), else after "trim levels are /
   * include". Words naming the car itself (make, model) are dropped from each name; sentences and prices are not names.
   * -> ['LX', 'Sport', 'EX-L', 'Touring'] (at most 30), or [] when the text has no such list.
   */
  function parse(text, car) {
    var t = String(text || '').replace(/\s+/g, ' ').replace(END_MARK, ' ');   // the completion marker the app asks Brave to end with
    var m = /\btrims?\s*:\s*/i.exec(t) || /\btrim(?: levels?)?(?: options)?\s*(?::|(?:are|include[sd]?|consist of)\s*:?\s*)/i.exec(t);
    // Natural summaries do not always obey the requested "Trims:" format.
    if(!m){var offered=/\b(?:available|offered)\s+in\s+(?:the\s+)?([^.!?]{2,180}?)\s+trims?\b/i.exec(t);if(offered&&/[,]|\band\b/i.test(offered[1]))return parse('Trims: '+offered[1],car);}
    if (!m) return [];
    var rest = t.slice(m.index + m[0].length, m.index + m[0].length + 600).replace(/\([^)]*\)/g, ' ');   // asides first: they hold commas ($35,000)
    rest = rest.split(/\s*(?:AI[- ]generated|Please verify|verify critical facts|Sources?\b|Ask a follow|Was this helpful)/i)[0];   // Brave's own words after its answer
    rest = rest.split(/(?:\.\s+[A-Z]|\. *$|\s+[-–—]\s+[A-Z][a-z]+\s+[a-z]|\bwhile\b)/)[0];   // the list, not the sentence after it
    var drop = norm([car && car.make, modelName(car && car.model)].join(' ')).split(' ').filter(function (w) { return w.length > 1 && !/^\d+$/.test(w); });
    var seen = {}, out = [];
    rest.split(/\s*(?:,|;|•|\||\/|\band\b|\bor\b)\s*/i).forEach(function (raw) {
      var s = raw.replace(/\s*\bEnd\s*:?\s*$/i, '').replace(/\([^)]*\)/g, ' ').replace(/^\s*(?:\d{1,2}[.)]\s+|[-*]\s*)/, '').replace(/[.:!?"“”*]+$/g, '').replace(/^["“]+/, '').trim();
      if (car && car.year) s = s.replace(new RegExp('\\b' + car.year + '\\b', 'g'), ' ');
      s = s.split(/\s+/).filter(function (w) { return drop.indexOf(norm(w)) < 0; }).join(' ').trim();
      if (!s || s.length > 28 || s.split(' ').length > 4 || !/[a-z0-9]/i.test(s) || NOT_A_TRIM.test(s) || /\$\s*\d/.test(s)) return;
      var k = norm(s); if (!k || seen[k]) return;
      seen[k] = 1; out.push(s);
    });
    return out.length?out.slice(0, 30):parse(t.slice(m.index+m[0].length),car); // skip an echoed query, try the actual answer
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
  // Toyota's and Lexus's own parts catalogs (autoparts.toyota.com, parts.lexus.com) decode a VIN into a "grade" such as
  // "TRD OFFROAD DOUBLE CAB", "XSE SEDAN", "TWO SEDAN", "LE" or, for Lexus, "STANDARD SUV" / "BASE SUV" / "SUV". Strip the
  // body words; what's left is the trim, written the way the model's trim list spells it when it's there. Lexus sells its
  // packages (Premium, Luxury, F Sport) outside the grade, so a bare STANDARD / BASE says nothing about the trim: ''.
  var BODY = /\b(DOUBLE CAB|ACCESS CAB|REGULAR CAB|CREWMAX|CREW MAX|XTRACAB|SEDAN|HATCHBACK|LIFTBACK|COUPE|CONVERTIBLE|WAGON|SUV|VAN|MINIVAN|PICKUP|TRUCK|CAB CHASSIS|[0-9]-DOOR|[0-9]DR|[0-9]-PASSENGER|[0-9] PASSENGER)\b/g;
  function oemGrade(grade, brand, list) {
    var g = String(grade || '').toUpperCase().replace(BODY, ' ').replace(/\s+/g, ' ').trim();
    if (!g || g.length > 30 || /^(STANDARD|BASE|GRADE|N\/A|NONE)$/.test(g) && /lexus/i.test(brand || '') || /^(STANDARD|N\/A|NONE)$/.test(g)) return '';
    var have = find(list, g) || find(list, g.replace(/OFFROAD/, 'OFF-ROAD')) || find(list, g.replace(/OFFROAD/, 'OFF ROAD'));
    if (have) return have;
    return g.split(' ').map(function (w) { return /[0-9]/.test(w) || /^(LE|SE|XLE|XSE|TRD|SR|CE|GR|GT|XP|FWD|AWD|RWD|LX|GX|NX|RX|UX|TX|ES|IS|LS|LC|RC|HV|PHEV)$/.test(w) ? w : w.split('-').map(function (x) { return x.charAt(0) + x.slice(1).toLowerCase(); }).join('-'); })
      .join(' ').replace(/\bOffroad\b/, 'Off-Road');
  }
  var api = { parse: parse, merge: merge, find: find, norm: norm, modelName: modelName, oemGrade: oemGrade };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.TrimMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
