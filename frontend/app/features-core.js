// Draco Code features: pure logic (no DOM, no network). Loaded by the browser and by tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DracoFeaturesCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- fuzzy matching for the command palette ----------
  // Every space-separated term must match; a contiguous match beats scattered letters; word starts score extra.
  function fuzzy(query, text) {
    var q = String(query || '').toLowerCase().trim(), t = String(text || '').toLowerCase();
    if (!q) return { score: 0, idx: [] };
    var terms = q.split(/\s+/), total = 0, marks = {};
    for (var k = 0; k < terms.length; k++) {
      var term = terms[k], at = t.indexOf(term);
      if (at !== -1) {
        total += 10 + term.length * 2 + (at === 0 ? 6 : /[\s\-_:./(]/.test(t.charAt(at - 1)) ? 4 : 0);
        for (var i = 0; i < term.length; i++) marks[at + i] = true;
        continue;
      }
      var pos = 0, last = -2, s = 0, picked = [];
      for (var c = 0; c < term.length; c++) {
        var j = t.indexOf(term.charAt(c), pos);
        if (j === -1) return null;
        s += 1 + (j === 0 || /[\s\-_:./(]/.test(t.charAt(j - 1)) ? 3 : 0) + (j === last + 1 ? 2 : 0);
        picked.push(j); last = j; pos = j + 1;
      }
      total += s; picked.forEach(function (p) { marks[p] = true; });
    }
    return { score: total, idx: Object.keys(marks).map(Number).sort(function (a, b) { return a - b; }) };
  }

  // items: [{ title, keywords?, ... }] -> ranked [{ item, idx }]; empty query keeps the original order.
  function rank(items, query) {
    var out = [];
    items.forEach(function (item, order) {
      if (!String(query || '').trim()) { out.push({ item: item, idx: [], score: 0, order: order }); return; }
      var onTitle = fuzzy(query, item.title);
      var onAll = onTitle || fuzzy(query, item.title + ' ' + (item.keywords || '') + ' ' + (item.group || ''));
      if (!onAll) return;
      out.push({ item: item, idx: onTitle ? onTitle.idx : [], score: onAll.score + (onTitle ? 5 : 0), order: order });
    });
    out.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    return out;
  }

  // ---------- settings ----------
  var DEFAULT_SETTINGS = { theme: 'system', fontSize: 13, tabSize: 4 };
  function normalizeSettings(raw) {
    var s = Object.assign({}, DEFAULT_SETTINGS, raw && typeof raw === 'object' ? raw : {});
    s.theme = s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system';
    var f = Math.round(Number(s.fontSize)); s.fontSize = isFinite(f) ? Math.min(20, Math.max(11, f)) : DEFAULT_SETTINGS.fontSize;
    var t = Number(s.tabSize); s.tabSize = t === 2 || t === 8 ? t : 4;
    return s;
  }
  function lineHeightFor(fontSize) { return Math.round(fontSize * 1.7); }

  // ---------- keyboard shortcut catalogue (shown in the Shortcuts dialog) ----------
  var SHORTCUTS = [
    { group: 'Everywhere', rows: [['Command palette', 'Mod+K'], ['Run', 'Mod+Enter'], ['Save', 'Mod+S'], ['Keyboard shortcuts', '?']] },
    { group: 'Terminal', rows: [['Stop the program', 'Ctrl+C'], ['End of input', 'Ctrl+D'], ['Clear the screen', 'Ctrl+L'], ['Earlier / later input', 'Up / Down']] },
    { group: 'Editor', rows: [['Indent', 'Tab'], ['Outdent', 'Shift+Tab'], ['Leave the editor with the keyboard', 'Esc then Tab']] },
    { group: 'Project mode', rows: [['Search in files', 'Mod+Shift+F'], ['Rename selected', 'F2'], ['Delete selected', 'Delete']] }
  ];

  return { fuzzy: fuzzy, rank: rank, DEFAULT_SETTINGS: DEFAULT_SETTINGS, normalizeSettings: normalizeSettings, lineHeightFor: lineHeightFor, SHORTCUTS: SHORTCUTS };
});
