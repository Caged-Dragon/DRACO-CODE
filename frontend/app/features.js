// Draco Code features: command palette (Ctrl/Cmd+K), settings, examples gallery, shortcuts and About.
(function () {
  'use strict';
  var Core = window.DracoFeaturesCore, Ex = window.DracoExamples, App = window.DracoCore;
  if (!Core || !Ex || !App) return;

  var $ = function (id) { return document.getElementById(id); };
  var SETTINGS_KEY = 'draco-settings-v1', VERSION = '2.0';
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  var EXT = { python: '.py', javascript: '.js', java: '.java', c: '.c', cpp: '.cpp' };
  var LABEL = { python: 'Python', javascript: 'JavaScript', java: 'Java', c: 'C', cpp: 'C++' };

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var GLYPH = { Up: '↑', Down: '↓' };
  function keys(spec) {                       // "Mod+Shift+F" -> <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>F</kbd>
    var wrap = el('span', 'fx-keys');
    String(spec).split(/ then /).forEach(function (chunk, ci) {
      if (ci) wrap.appendChild(el('span', 'fx-then', 'then'));
      chunk.split('+').forEach(function (k) {
        if (k.indexOf(' / ') !== -1) { k.split(' / ').forEach(function (p, i) { if (i) wrap.appendChild(el('span', 'fx-then', '/')); wrap.appendChild(el('kbd', null, GLYPH[p] || p)); }); return; }
        wrap.appendChild(el('kbd', null, k === 'Mod' ? (IS_MAC ? '⌘' : 'Ctrl') : (GLYPH[k] || k)));
      });
    });
    return wrap;
  }
  function toast(m) { App.toast(m); }
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not remembered */ } }

  // ---------- generic modal ----------
  var current = null;
  function modal(opts) {
    if (current) current.close();
    var scrim = el('div', 'fx-scrim' + (opts.top ? '' : ' center')), box = el('div', 'fx-modal' + (opts.wide ? ' wide' : '') + (opts.className ? ' ' + opts.className : ''));
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    var body = el('div', 'fx-body');
    if (opts.title) {
      var head = el('div', 'fx-head'), h = el('h2', null, opts.title); h.id = 'fx-title'; box.setAttribute('aria-labelledby', 'fx-title');
      var x = el('button', 'icon-button fx-close', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', function () { close(); });
      head.append(h, x); box.appendChild(head);
    } else if (opts.label) box.setAttribute('aria-label', opts.label);
    box.appendChild(body); scrim.appendChild(box); document.body.appendChild(scrim);
    var previous = document.activeElement;
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {                  // keep focus inside the dialog
        var f = Array.prototype.filter.call(box.querySelectorAll('button, input, select, textarea, [tabindex="0"]'), function (n) { return !n.disabled && n.offsetParent !== null; });
        if (!f.length) return; var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    function close() { if (current !== api) return; current = null; scrim.remove(); document.removeEventListener('keydown', onKey, true); if (opts.restoreFocus !== false && previous && previous.focus && document.contains(previous)) previous.focus(); if (opts.onClose) opts.onClose(); }
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(); });
    document.addEventListener('keydown', onKey, true);
    var api = { box: box, body: body, close: close }; current = api; return api;
  }

  // ---------- settings (font size, tab width; theme lives in DracoTheme) ----------
  var settings = Core.normalizeSettings((function () { try { return JSON.parse(safeGet(SETTINGS_KEY) || 'null'); } catch (e) { return null; } })());
  function applySettings() {
    var r = document.documentElement.style;
    r.setProperty('--ed-fs', settings.fontSize + 'px'); r.setProperty('--ed-lh', Core.lineHeightFor(settings.fontSize) + 'px'); r.setProperty('--ed-tab', String(settings.tabSize));
    window.DracoEditorConfig = { indent: ' '.repeat(settings.tabSize) };
    var s = $('status-spaces'); if (s) s.textContent = 'Spaces: ' + settings.tabSize;
    var s2 = $('ide-st-spaces'); if (s2) s2.textContent = 'Spaces: ' + settings.tabSize;
    if (window.DracoEditor && window.DracoEditor.refreshAll) window.DracoEditor.refreshAll();
  }
  function saveSettings() { safeSet(SETTINGS_KEY, JSON.stringify({ fontSize: settings.fontSize, tabSize: settings.tabSize })); }

  function openSettings() {
    var m = modal({ title: 'Settings' }), b = m.body;
    function section(title, hint) { var s = el('section', 'fx-section'); s.appendChild(el('h3', null, title)); if (hint) s.appendChild(el('p', 'fx-hint', hint)); b.appendChild(s); return s; }
    // theme
    var th = section('Theme', 'Gold for light mode, purple for dark mode. System follows your device.');
    var row = el('div', 'fx-choices'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', 'Theme');
    [['system', 'System', 'sw-system'], ['light', 'Light · Gold', 'sw-gold'], ['dark', 'Dark · Purple', 'sw-purple']].forEach(function (t) {
      var btn = el('button', 'fx-choice'); btn.type = 'button'; btn.setAttribute('role', 'radio'); btn.dataset.theme = t[0];
      btn.append(el('span', 'fx-swatch ' + t[2]), el('span', null, t[1]));
      btn.addEventListener('click', function () { window.DracoTheme.set(t[0]); sync(); });
      row.appendChild(btn);
    }); th.appendChild(row);
    // font size
    var fs = section('Font size', 'For the editor and the terminal.');
    var range = el('input', 'fx-range'); range.type = 'range'; range.min = '11'; range.max = '20'; range.step = '1'; range.value = String(settings.fontSize); range.setAttribute('aria-label', 'Font size');
    var val = el('output', 'fx-value'); var line = el('div', 'fx-line'); line.append(range, val); fs.appendChild(line);
    var sample = el('pre', 'fx-sample'); sample.textContent = 'def greet(name):\n    return f"Hello, {name}!"'; fs.appendChild(sample);
    range.addEventListener('input', function () { settings.fontSize = Number(range.value); applySettings(); saveSettings(); sync(); });
    // tab width
    var tb = section('Tab width', 'Spaces inserted by the Tab key.');
    var tabs = el('div', 'fx-choices small'); tabs.setAttribute('role', 'radiogroup'); tabs.setAttribute('aria-label', 'Tab width');
    [2, 4, 8].forEach(function (n) {
      var btn = el('button', 'fx-choice'); btn.type = 'button'; btn.setAttribute('role', 'radio'); btn.dataset.tab = String(n); btn.textContent = n + ' spaces';
      btn.addEventListener('click', function () { settings.tabSize = n; applySettings(); saveSettings(); sync(); }); tabs.appendChild(btn);
    }); tb.appendChild(tabs);
    var foot = el('div', 'fx-actions'), reset = el('button', 'panel-secondary', 'Reset to defaults'); reset.type = 'button';
    reset.addEventListener('click', function () { settings = Core.normalizeSettings(null); window.DracoTheme.set('system'); applySettings(); saveSettings(); range.value = String(settings.fontSize); sync(); toast('Settings reset.'); });
    var done = el('button', 'panel-primary', 'Done'); done.type = 'button'; done.addEventListener('click', function () { m.close(); });
    foot.append(reset, done); b.appendChild(foot);
    function sync() {
      val.textContent = settings.fontSize + ' px';
      var mode = window.DracoTheme.mode();
      row.querySelectorAll('.fx-choice').forEach(function (c) { var on = c.dataset.theme === mode; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); });
      tabs.querySelectorAll('.fx-choice').forEach(function (c) { var on = Number(c.dataset.tab) === settings.tabSize; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); });
    }
    sync(); setTimeout(function () { var on = row.querySelector('.on'); if (on) on.focus(); }, 20);
  }

  // ---------- keyboard shortcuts ----------
  function openShortcuts() {
    var m = modal({ title: 'Keyboard shortcuts', wide: true }), grid = el('div', 'fx-shortcuts');
    Core.SHORTCUTS.forEach(function (g) {
      var sec = el('section', 'fx-section'); sec.appendChild(el('h3', null, g.group));
      g.rows.forEach(function (r) { var row = el('div', 'fx-srow'); row.appendChild(el('span', null, r[0])); row.appendChild(keys(r[1].replace(/ \/ /g, ' / '))); sec.appendChild(row); });
      grid.appendChild(sec);
    });
    m.body.appendChild(grid); setTimeout(function () { m.box.querySelector('.fx-close').focus(); }, 20);
  }

  // ---------- about ----------
  function openAbout() {
    var m = modal({ title: 'About' }), b = m.body;
    var hero = el('div', 'fx-about-hero');
    [['draco-code-logo.png', 'Draco Code logo', 'Draco Code', 'Online compiler and project workspace'], ['cageddragon-logo.png', 'CagedDragon logo', 'CagedDragon', 'Unleash possibilities']].forEach(function (c) {
      var card = el('div', 'fx-brand'), img = el('img'); img.src = './assets/' + c[0]; img.alt = c[1]; img.width = 96; img.height = 96;
      card.append(img, el('b', null, c[2]), el('small', null, c[3])); hero.appendChild(card);
    });
    b.appendChild(hero);
    b.appendChild(el('p', 'fx-about-text', 'Draco Code runs your programs in isolated sandboxes and gives you a real terminal for input. Python and JavaScript work without an account; sign in to add Java, C, C++, packages and multi-file projects.'));
    var facts = el('dl', 'fx-facts');
    [['Product', 'Draco Code ' + VERSION], ['Made by', 'CagedDragon'], ['Languages', 'Python, JavaScript, Java, C, C++'], ['Themes', 'Gold (light) and Purple (dark)']].forEach(function (f) { facts.append(el('dt', null, f[0]), el('dd', null, f[1])); });
    b.appendChild(facts);
    var foot = el('div', 'fx-actions'), done = el('button', 'panel-primary', 'Close'); done.type = 'button'; done.addEventListener('click', function () { m.close(); }); foot.appendChild(done); b.appendChild(foot);
    setTimeout(function () { done.focus(); }, 20);
  }

  // ---------- examples gallery ----------
  function openExample(e) {
    if (!App.languages().some(function (l) { return l.id === e.language && l.available; })) { current && current.close(); App.openAccountPanel(); toast('Sign in and add ' + LABEL[e.language] + ' to open this example.'); return; }
    current && current.close();
    App.newProgram(e.language, { code: e.code, name: e.topic + EXT[e.language], toast: 'Opened the example. Press Run, it will wait for you in the terminal.' });
  }
  function openExamples(language) {
    var pick = language || App.currentLanguage(), m = modal({ title: 'Examples', wide: true }), b = m.body;
    b.appendChild(el('p', 'fx-hint', 'Complete programs you can run right now. Each one opens as a new program, your own work is never replaced.'));
    var tabs = el('div', 'fx-choices small fx-langs'); tabs.setAttribute('role', 'tablist'); var list = el('div', 'fx-cards');
    b.append(tabs, list);
    function render() {
      var avail = {}; App.languages().forEach(function (l) { avail[l.id] = l.available; });
      tabs.replaceChildren(); list.replaceChildren();
      Object.keys(LABEL).forEach(function (id) {
        var t = el('button', 'fx-choice' + (id === pick ? ' on' : ''), LABEL[id] + (avail[id] ? '' : ' 🔒')); t.type = 'button'; t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(id === pick));
        t.addEventListener('click', function () { pick = id; render(); }); tabs.appendChild(t);
      });
      Ex.forLanguage(pick).forEach(function (e) {
        var card = el('article', 'fx-card'), h = el('h3', null, e.title); var p = el('p', null, e.description);
        var pre = el('pre', 'fx-preview'); pre.textContent = e.code.split('\n').slice(0, 7).join('\n');
        var open = el('button', 'panel-primary', avail[e.language] ? 'Open example' : 'Add ' + LABEL[e.language] + ' to open'); open.type = 'button';
        open.addEventListener('click', function () { openExample(e); });
        card.append(h, p, pre, open); list.appendChild(card);
      });
    }
    render(); setTimeout(function () { var on = tabs.querySelector('.on'); if (on) on.focus(); }, 20);
  }

  // ---------- command palette ----------
  function projectApi() { return window.DracoProject; }
  function commands() {
    var mode = App.getMode(), items = [], P = projectApi();
    function add(group, title, run, o) { items.push(Object.assign({ group: group, title: title, run: run }, o || {})); }
    var running = App.isRunning() || (P && P.isRunning && P.isRunning());
    add('Run', mode === 'project' ? 'Run project' : 'Run program', function () { App.run(); }, { hint: 'Mod+Enter', keywords: 'execute start play compile' });
    if (running) add('Run', 'Stop the running program', function () { App.stop(); if (P && P.stop) P.stop(); }, { hint: 'Ctrl+C', keywords: 'kill terminate cancel' });
    if (mode !== 'compiler') add('Go to', 'Go to Compiler', function () { App.setMode('compiler'); }, { keywords: 'single file editor' });
    if (mode !== 'project') add('Go to', 'Go to Project mode', function () { App.setMode('project'); }, { keywords: 'workspace multi file folder vscode' });
    if (mode === 'project' && P && P.commands) P.commands().forEach(function (c) { add('Project', c.title, c.run, { hint: c.hint, keywords: c.keywords }); });
    if (mode === 'compiler') {
      add('Program', 'New program', function () { App.newProgram(App.currentLanguage()); }, { keywords: 'file create add' });
      App.languages().forEach(function (l) { add('Program', 'New ' + l.label + ' program', function () { App.newProgram(l.id); }, { keywords: 'create file add language', hint: l.available ? '' : 'Add language' }); });
      App.languages().filter(function (l) { return l.id !== App.currentLanguage(); }).forEach(function (l) { add('Language', 'Change language to ' + l.label, function () { App.changeLanguage(l.id); }, { keywords: 'switch set', hint: l.available ? '' : 'Add language' }); });
      App.programs().forEach(function (p) { add('Open', 'Open ' + p.name, function () { App.activateProgram(p.id); }, { keywords: LABEL[p.language] + ' program file switch', hint: p.id === App.activeProgramId() ? 'Current' : LABEL[p.language] }); });
      add('View', 'Toggle stacked / split layout', function () { App.toggleLayout(); }, { keywords: 'terminal below beside' });
    }
    var here = App.currentLanguage();   // examples for the language you are using come first
    Ex.LIST.slice().sort(function (x, y) { return (y.language === here) - (x.language === here); }).forEach(function (e) { add('Example', 'Example: ' + e.title + ' (' + LABEL[e.language] + ')', function () { openExample(e); }, { keywords: e.description + ' ' + e.language + ' sample demo learn', hint: 'Example' }); });
    add('View', 'Theme: Light (gold)', function () { window.DracoTheme.set('light'); }, { keywords: 'appearance color' });
    add('View', 'Theme: Dark (purple)', function () { window.DracoTheme.set('dark'); }, { keywords: 'appearance color night' });
    add('View', 'Theme: Follow system', function () { window.DracoTheme.set('system'); }, { keywords: 'appearance color auto' });
    add('Settings', 'Open settings', openSettings, { keywords: 'preferences font size tab width theme' });
    add('Settings', 'Increase font size', function () { settings.fontSize = Math.min(20, settings.fontSize + 1); applySettings(); saveSettings(); toast('Font size ' + settings.fontSize + ' px'); }, { keywords: 'bigger larger zoom' });
    add('Settings', 'Decrease font size', function () { settings.fontSize = Math.max(11, settings.fontSize - 1); applySettings(); saveSettings(); toast('Font size ' + settings.fontSize + ' px'); }, { keywords: 'smaller zoom' });
    add('Help', 'Browse examples', function () { openExamples(); }, { keywords: 'samples templates learn' });
    add('Help', 'Keyboard shortcuts', openShortcuts, { hint: '?', keywords: 'keys hotkeys help' });
    add('Help', 'About Draco Code', openAbout, { keywords: 'cageddragon company version logo' });
    add('Account', 'Languages and packages', function () { App.openAccountPanel(); }, { keywords: 'java c cpp install library add' });
    if (!App.user()) add('Account', 'Sign in or create account', function () { App.openAuth('signin'); }, { keywords: 'login register' });
    return items;
  }

  function openPalette() {
    var all = commands(), query = '', results = all.map(function (i) { return { item: i, idx: [] }; }), active = 0;
    var m = modal({ top: true, label: 'Command palette', className: 'fx-palette', restoreFocus: true }), box = m.box;
    var input = el('input', 'fx-pal-input'); input.type = 'text'; input.placeholder = 'Type a command, a program or an example…'; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-controls', 'fx-pal-list'); input.setAttribute('aria-label', 'Command palette');
    var list = el('ul', 'fx-pal-list'); list.id = 'fx-pal-list'; list.setAttribute('role', 'listbox');
    var foot = el('div', 'fx-pal-foot'); foot.append(keys('Up'), keys('Down'), el('span', null, 'move'), keys('Enter'), el('span', null, 'run'), keys('Esc'), el('span', null, 'close'));
    m.body.append(input, list, foot);
    function highlight(node, text, idx) {
      if (!idx.length) { node.textContent = text; return; }
      var set = {}; idx.forEach(function (i) { set[i] = 1; }); var buf = '', on = false;
      for (var i = 0; i < text.length; i++) {
        var hit = !!set[i];
        if (hit !== on) { if (buf) node.appendChild(on ? el('mark', null, buf) : document.createTextNode(buf)); buf = ''; on = hit; }
        buf += text.charAt(i);
      }
      if (buf) node.appendChild(on ? el('mark', null, buf) : document.createTextNode(buf));
    }
    function render() {
      list.replaceChildren();
      if (!results.length) { var none = el('li', 'fx-pal-empty', 'No matching commands'); none.setAttribute('role', 'presentation'); list.appendChild(none); input.removeAttribute('aria-activedescendant'); return; }
      results.slice(0, 60).forEach(function (r, i) {
        var li = el('li', 'fx-pal-item' + (i === active ? ' active' : '')); li.id = 'fx-opt-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === active));
        var t = el('span', 'fx-pal-title'); highlight(t, r.item.title, r.idx); li.appendChild(t);
        var meta = el('span', 'fx-pal-meta'); if (r.item.hint && /\+|Enter|^\?$/.test(r.item.hint) && r.item.hint.length < 16) meta.appendChild(keys(r.item.hint)); else meta.textContent = r.item.hint || r.item.group; li.appendChild(meta);
        li.addEventListener('mousemove', function () { if (active !== i) { active = i; paintActive(); } });
        li.addEventListener('click', function () { choose(i); });
        list.appendChild(li);
      });
      input.setAttribute('aria-activedescendant', 'fx-opt-' + active);
    }
    function paintActive() { list.querySelectorAll('.fx-pal-item').forEach(function (n, i) { var on = i === active; n.classList.toggle('active', on); n.setAttribute('aria-selected', String(on)); }); input.setAttribute('aria-activedescendant', 'fx-opt-' + active); var n = list.querySelector('.active'); if (n) n.scrollIntoView({ block: 'nearest' }); }
    function choose(i) { var r = results[i]; if (!r) return; m.close(); setTimeout(function () { try { r.item.run(); } catch (e) { console.error(e); toast('That command could not run.'); } }, 0); }
    input.addEventListener('input', function () { query = input.value; results = Core.rank(all, query); active = 0; render(); });
    input.addEventListener('keydown', function (e) {
      var n = Math.min(results.length, 60);
      if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { active = (active + 1) % n; paintActive(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { active = (active - 1 + n) % n; paintActive(); } }
      else if (e.key === 'Home') { active = 0; paintActive(); }
      else if (e.key === 'End') { active = Math.max(0, n - 1); paintActive(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    });
    render(); input.focus();   // synchronously, so keystrokes typed right after Ctrl+K are never lost
  }

  // ---------- wiring ----------
  function wire() {
    function menu(id, fn) { var b = $(id); if (b) b.addEventListener('click', function () { App.closeMenu(); fn(); }); }
    menu('menu-palette', openPalette); menu('menu-examples', function () { openExamples(); }); menu('menu-settings', openSettings); menu('menu-shortcuts', openShortcuts); menu('menu-about', openAbout);
    var pb = $('palette-button'); if (pb) pb.addEventListener('click', openPalette);
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (current && current.box.classList.contains('fx-palette')) current.close(); else openPalette(); return; }
      if (mod && e.shiftKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); openPalette(); return; }
      var t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === '?' && !mod && !typing && !current) { e.preventDefault(); openShortcuts(); }
    });
  }

  applySettings();
  wire();
  window.DracoFeatures = { openPalette: openPalette, openSettings: openSettings, openExamples: openExamples, openShortcuts: openShortcuts, openAbout: openAbout, settings: function () { return Object.assign({}, settings); } };
})();
