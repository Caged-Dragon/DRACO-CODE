// Draco Code Project mode: a VS Code-style workspace for account holders.
// Projects and files live in Supabase (row-level security); runs go to the execution backend.
(function () {
  'use strict';
  var core = window.DracoProjectCore, Data = window.DracoProjectData, App = window.DracoCore;
  if (!core || !Data || !App || !App.client) return; // Supabase not configured: the compiler still works.

  var $ = function (id) { return document.getElementById(id); };
  var db = Data.create(App.client);
  var LAST_KEY = 'draco-project-last:', PANEL_KEY = 'draco-ide-panel-h';
  var SAVE_DELAY = 1200;

  var S = {
    projects: [], project: null, files: new Map(), tabs: [], active: null, expanded: new Set(),
    selected: null, creating: null, renaming: null, panel: 'output', side: 'explorer',
    problems: [], running: false, loading: false, loaded: false, saveTimer: null, lastSaveError: ''
  };

  // ---------- small helpers ----------
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function svg(path, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); if (cls) s.setAttribute('class', cls);
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', path); s.appendChild(p); return s;
  }
  var ICON = {
    rename: 'M4 20h4L19 9l-4-4L4 16Zm9-13 4 4', trash: 'M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12', entry: 'M7 4.5v15l12-7.5Z',
    close: 'm6 6 12 12M18 6 6 18', error: 'M12 7v6m0 3.5v.01', warn: 'M12 8v5m0 3v.01', file: 'M6 3.5h8l4 4V20.5H6Z'
  };
  function toast(m) { App.toast(m); }
  function dirtyTabs() { return S.tabs.filter(isDirty); }
  function fileOf(path) { return S.files.get(path); }
  function isDirty(tab) { var f = fileOf(tab.path); return !!f && tab.ta.value !== f.content; }
  function projectLang() { return S.project ? S.project.language : 'python'; }
  function rowsList() { return Array.from(S.files.values()); }

  // ---------- dialogs ----------
  function dialog(opts) {
    return new Promise(function (resolve) {
      var scrim = el('div', 'ide-modal-scrim'), box = el('div', 'ide-modal'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
      var title = el('h3', null, opts.title); title.id = 'ide-modal-title'; box.setAttribute('aria-labelledby', 'ide-modal-title'); box.appendChild(title);
      if (opts.text) box.appendChild(el('p', 'ide-modal-text', opts.text));
      var form = el('form'); var inputs = {};
      (opts.fields || []).forEach(function (f) {
        var label = el('label', null, f.label); label.setAttribute('for', 'ide-f-' + f.name); form.appendChild(label);
        var input;
        if (f.options) {
          input = el('select'); f.options.forEach(function (o) { var op = el('option', null, o.label); op.value = o.value; op.disabled = !!o.disabled; input.appendChild(op); });
        } else { input = el('input'); input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; if (f.placeholder) input.placeholder = f.placeholder; }
        input.id = 'ide-f-' + f.name; input.value = f.value || ''; if (f.maxLength) input.maxLength = f.maxLength;
        inputs[f.name] = input; form.appendChild(input);
        if (f.hint) form.appendChild(el('small', 'ide-modal-hint', f.hint));
      });
      var msg = el('p', 'ide-modal-error'); msg.setAttribute('role', 'alert'); form.appendChild(msg);
      var row = el('div', 'ide-modal-actions'), cancel = el('button', 'panel-secondary', 'Cancel'), ok = el('button', 'panel-primary ' + (opts.danger ? 'danger' : ''), opts.confirm || 'OK');
      cancel.type = 'button'; ok.type = 'submit'; row.append(cancel, ok); form.appendChild(row); box.appendChild(form); scrim.appendChild(box); document.body.appendChild(scrim);
      var previous = document.activeElement;
      function done(v) { scrim.remove(); document.removeEventListener('keydown', onKey, true); if (previous && previous.focus) previous.focus(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done(null); } }
      document.addEventListener('keydown', onKey, true);
      cancel.addEventListener('click', function () { done(null); });
      scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) done(null); });
      form.addEventListener('submit', function (e) {
        e.preventDefault(); var values = {}; Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value.trim(); });
        var err = opts.validate ? opts.validate(values) : ''; if (err) { msg.textContent = err; return; } done(values);
      });
      var first = Object.keys(inputs)[0]; setTimeout(function () { (first ? inputs[first] : ok).focus(); if (first && inputs[first].select) inputs[first].select(); }, 20);
    });
  }

  // ---------- projects ----------
  async function loadProjects(preferId) {
    S.loading = true; renderGate();
    try {
      S.projects = await db.listProjects(); S.loaded = true;
      renderProjects();
      var last = preferId || safeGet(LAST_KEY + (App.user() || {}).id);
      var pick = S.projects.find(function (p) { return p.id === last; }) || S.projects[0];
      if (pick) await openProject(pick.id); else { clearProject(); renderAll(); }
    } catch (e) { toast(e.message); setConn('Database unavailable', true); }
    finally { S.loading = false; renderGate(); }
  }
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* optional */ } }

  function clearProject() {
    S.tabs.forEach(function (t) { t.host.remove(); }); S.tabs = []; S.active = null; S.project = null; S.files = new Map();
    S.expanded = new Set(); S.selected = null; S.problems = []; S.creating = null; S.renaming = null;
  }

  async function openProject(id) {
    await flushSaves();
    var meta = S.projects.find(function (p) { return p.id === id; }); if (!meta) return;
    try {
      var rows = await db.loadFiles(id);
      clearProject(); S.project = Object.assign({}, meta);
      rows.forEach(function (r) { S.files.set(r.path, r); });
      rows.forEach(function (r) { var d = core.parentPath(r.path); while (d) { S.expanded.add(d); d = core.parentPath(d); } });
      safeSet(LAST_KEY + (App.user() || {}).id, id);
      var entry = S.project.entry_path && S.files.has(S.project.entry_path) ? S.project.entry_path : core.defaultEntry(S.project.language, rows);
      if (entry) openFile(entry);
      renderAll(); showSide('explorer', true);
    } catch (e) { toast(e.message); }
  }

  async function newProject() {
    if (S.projects.length >= core.LIMITS.projects) { toast('You can keep up to ' + core.LIMITS.projects + ' projects. Delete one to add another.'); return; }
    var options = core.LANGS.map(function (l) { var ok = App.canUseLanguage(l); return { value: l, label: core.LABELS[l] + (ok ? '' : ' (add in Languages and packages)'), disabled: !ok }; });
    var v = await dialog({
      title: 'New project', confirm: 'Create project',
      fields: [{ name: 'name', label: 'Project name', placeholder: 'my-first-project', maxLength: core.LIMITS.nameLength, value: '' }, { name: 'language', label: 'Language', options: options, value: 'python' }],
      validate: function (x) { return x.name ? '' : 'Give the project a name.'; }
    });
    if (!v) return;
    try {
      var p = await db.createProject(v.name, v.language);
      S.projects.unshift(p); renderProjects(); await openProject(p.id); toast('Created ' + p.name + ' with starter files.');
    } catch (e) { toast(e.message); }
  }

  async function renameProject(p) {
    var v = await dialog({ title: 'Rename project', confirm: 'Rename', fields: [{ name: 'name', label: 'Project name', value: p.name, maxLength: core.LIMITS.nameLength }], validate: function (x) { return x.name ? '' : 'Enter a name.'; } });
    if (!v || v.name === p.name) return;
    try { await db.renameProject(p.id, v.name); p.name = v.name; if (S.project && S.project.id === p.id) S.project.name = v.name; renderProjects(); renderHeader(); } catch (e) { toast(e.message); }
  }

  async function deleteProject(p) {
    var v = await dialog({ title: 'Delete project', text: 'Delete ' + p.name + ' and all of its files? This cannot be undone.', confirm: 'Delete project', danger: true });
    if (!v) return;
    try {
      await db.deleteProject(p.id); S.projects = S.projects.filter(function (x) { return x.id !== p.id; });
      if (S.project && S.project.id === p.id) { clearProject(); if (S.projects[0]) await openProject(S.projects[0].id); }
      renderAll(); toast('Project deleted.');
    } catch (e) { toast(e.message); }
  }

  // ---------- tabs and editors ----------
  function openFile(path, line, col, fromTree) {
    var f = fileOf(path); if (!f || f.is_folder) return;
    var tab = S.tabs.find(function (t) { return t.path === path; });
    if (!tab) {
      var host = el('div', 'editor-host ide-editor-host'), ta = el('textarea', 'editor'); ta.setAttribute('aria-label', 'Editor for ' + path); host.appendChild(ta);
      $('ide-editors').appendChild(host);
      tab = { path: path, host: host, ta: ta, api: null, scroll: 0, sel: [0, 0] };
      tab.api = window.DracoEditor.attach(ta, { lang: core.highlightLang(path), onCursor: function (l, c) { if (S.active === tab.path) { S.pos = [l, c]; renderStatus(); } }, onChange: function () { onEdit(tab); } });
      ta.value = f.content; S.tabs.push(tab);
    }
    activate(path, fromTree); if (line) gotoLine(tab, line, col);
  }
  function activate(path, keepTreeFocus) {
    var cur = S.tabs.find(function (t) { return t.path === S.active; });
    if (cur) { cur.scroll = cur.ta.scrollTop; cur.sel = [cur.ta.selectionStart, cur.ta.selectionEnd]; }
    S.active = path; S.selected = path; S.focusTree = !!keepTreeFocus;
    S.tabs.forEach(function (t) { t.host.classList.toggle('active', t.path === path); });
    var tab = S.tabs.find(function (t) { return t.path === path; });
    $('ide-welcome').hidden = !!tab;
    if (tab) { tab.api.refresh(); tab.ta.scrollTop = tab.scroll; tab.ta.setSelectionRange(tab.sel[0], tab.sel[1]); if (!keepTreeFocus) tab.api.focus(); }
    renderTabs(); renderTree(); renderCrumbs(); renderStatus();
  }
  function gotoLine(tab, line, col) {
    var lines = tab.ta.value.split('\n'), off = 0, i;
    for (i = 0; i < Math.min(line - 1, lines.length - 1); i++) off += lines[i].length + 1;
    off += Math.min((col || 1) - 1, (lines[line - 1] || '').length);
    tab.ta.focus(); tab.ta.setSelectionRange(off, off); tab.ta.scrollTop = Math.max(0, (line - 6) * 22);
  }
  async function closeTab(path) {
    var tab = S.tabs.find(function (t) { return t.path === path; }); if (!tab) return;
    if (isDirty(tab)) { var ok = await saveTab(tab); if (!ok) { toast('Could not save ' + core.baseName(path) + '. Fix the connection and try again.'); return; } }
    var idx = S.tabs.indexOf(tab); tab.host.remove(); S.tabs.splice(idx, 1);
    if (S.active === path) { var next = S.tabs[Math.min(idx, S.tabs.length - 1)]; S.active = null; if (next) activate(next.path); else { renderTabs(); renderCrumbs(); renderStatus(); $('ide-welcome').hidden = false; } } else renderTabs();
  }

  // ---------- saving ----------
  function onEdit(tab) {
    renderTabs(); setSaveState(); clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(function () { flushSaves(); }, SAVE_DELAY);
  }
  var saving = new Map();
  async function saveTab(tab) {
    var f = fileOf(tab.path); if (!f) return true;
    if (saving.has(tab.path)) return saving.get(tab.path);
    var value = tab.ta.value; if (value === f.content) return true;
    var p = (async function () {
      try {
        if (new Blob([value]).size > core.LIMITS.fileBytes) throw new Error(tab.path + ' is larger than 100 KB.');
        await db.saveFile(f.id, value); f.content = value; S.lastSaveError = ''; return true;
      } catch (e) { S.lastSaveError = e.message; toast(e.message); return false; }
      finally { saving.delete(tab.path); renderTabs(); setSaveState(); }
    })();
    saving.set(tab.path, p); setSaveState(); return p;
  }
  async function flushSaves() {
    clearTimeout(S.saveTimer); var results = await Promise.all(S.tabs.filter(isDirty).map(saveTab)); return results.every(Boolean);
  }
  function setSaveState() {
    var n = dirtyTabs().length, st = $('ide-st-save');
    st.className = ''; if (S.lastSaveError && n) { st.textContent = 'Save failed'; st.className = 'bad'; }
    else if (saving.size) { st.textContent = 'Saving…'; st.className = 'busy'; }
    else if (n) { st.textContent = 'Unsaved changes'; st.className = 'busy'; } else st.textContent = 'Saved';
  }

  // ---------- file operations ----------
  function targetDir() {
    var sel = S.selected; if (!sel) return '';
    var f = fileOf(sel); if (f && f.is_folder) return sel; if (!f && S.expanded.has(sel)) return sel; return core.parentPath(sel);
  }
  function startCreate(kind) {
    if (!S.project) { toast('Create or open a project first.'); return; }
    showSide('explorer'); var dir = targetDir(); if (dir) S.expanded.add(dir);
    S.creating = { kind: kind, dir: dir }; S.renaming = null; renderTree();
  }
  function startRename(path) { S.renaming = path; S.creating = null; renderTree(); }
  function folderExists(path) { return rowsList().some(function (r) { return r.path === path && r.is_folder || r.path.indexOf(path + '/') === 0; }); }

  async function commitCreate(name) {
    var c = S.creating; S.creating = null;
    var path = core.joinPath(c.dir, name), err = core.pathError(path);
    if (err) { toast(err); renderTree(); return; }
    if (S.files.has(path) || folderExists(path)) { toast('A file or folder with that name already exists.'); renderTree(); return; }
    if (S.files.size >= core.LIMITS.entries) { toast('A project can hold at most ' + core.LIMITS.entries + ' files and folders.'); renderTree(); return; }
    try {
      var row = c.kind === 'folder' ? await db.createFolder(S.project.id, path) : await db.createFile(S.project.id, path, '');
      S.files.set(row.path, row); var d = core.parentPath(path); while (d) { S.expanded.add(d); d = core.parentPath(d); }
      if (c.kind === 'folder') { S.expanded.add(path); S.selected = path; } // next new file goes inside it
      renderTree(); if (c.kind === 'file') openFile(path);
      if (c.kind === 'file' && !S.project.entry_path && core.isSource(S.project.language, path)) setEntry(path, true);
    } catch (e) { toast(e.message); renderTree(); }
  }

  async function commitRename(oldPath, name) {
    S.renaming = null; var newPath = core.joinPath(core.parentPath(oldPath), name);
    if (newPath === oldPath) { renderTree(); return; }
    var err = core.pathError(newPath); if (err) { toast(err); renderTree(); return; }
    if (S.files.has(newPath) || folderExists(newPath)) { toast('A file or folder with that name already exists.'); renderTree(); return; }
    await flushSaves();
    try {
      await db.renamePath(S.project.id, oldPath, newPath);
      var moved = [];
      S.files.forEach(function (r, p) { if (p === oldPath || p.indexOf(oldPath + '/') === 0) moved.push([p, newPath + p.slice(oldPath.length)]); });
      moved.forEach(function (m) { var r = S.files.get(m[0]); S.files.delete(m[0]); r.path = m[1]; S.files.set(m[1], r); });
      S.tabs.forEach(function (t) { var m = moved.find(function (x) { return x[0] === t.path; }); if (m) { t.path = m[1]; t.api.setLang(core.highlightLang(m[1])); } });
      if (S.active) { var a = moved.find(function (x) { return x[0] === S.active; }); if (a) S.active = a[1]; }
      if (S.expanded.has(oldPath)) { S.expanded.delete(oldPath); S.expanded.add(newPath); }
      S.selected = newPath;
      var entry = S.project.entry_path, mm = entry && moved.find(function (x) { return x[0] === entry; });
      if (mm) await setEntry(mm[1], true);
      renderAll();
    } catch (e) { toast(e.message); renderTree(); }
  }

  async function deleteEntry(path) {
    var f = fileOf(path), isFolder = f ? f.is_folder : true, name = core.baseName(path);
    var v = await dialog({ title: 'Delete ' + (isFolder ? 'folder' : 'file'), text: 'Delete ' + name + (isFolder ? ' and everything inside it' : '') + '? This cannot be undone.', confirm: 'Delete', danger: true });
    if (!v) return;
    try {
      await db.deletePath(S.project.id, path);
      var gone = []; S.files.forEach(function (r, p) { if (p === path || p.indexOf(path + '/') === 0) gone.push(p); });
      gone.forEach(function (p) { S.files.delete(p); });
      S.tabs.filter(function (t) { return gone.indexOf(t.path) !== -1; }).forEach(function (t) { t.host.remove(); S.tabs.splice(S.tabs.indexOf(t), 1); });
      if (gone.indexOf(S.active) !== -1) { S.active = null; if (S.tabs[0]) activate(S.tabs[0].path); }
      if (S.selected && gone.indexOf(S.selected) !== -1) S.selected = null;
      if (gone.indexOf(S.project.entry_path) !== -1) await setEntry(core.defaultEntry(S.project.language, rowsList().filter(function (r) { return !r.is_folder; })), true);
      renderAll();
    } catch (e) { toast(e.message); }
  }

  async function setEntry(path, quiet) {
    try {
      await db.setEntry(S.project.id, path); S.project.entry_path = path;
      var m = S.projects.find(function (p) { return p.id === S.project.id; }); if (m) m.entry_path = path;
      renderTree(); renderStatus(); if (!quiet) toast((path ? core.baseName(path) : 'No file') + ' is now the entry file.');
    } catch (e) { toast(e.message); }
  }

  // ---------- running ----------
  async function run() {
    if (S.running) return;
    if (!S.project) { toast('Create or open a project first.'); return; }
    var lang = S.project.language, entry = S.project.entry_path;
    if (!App.canUseLanguage(lang)) { App.openAccountPanel(); toast('Add ' + core.LABELS[lang] + ' to your account to run this project.'); return; }
    if (!entry || !S.files.has(entry)) { toast('Choose an entry file: right-click a file, or use the ▶ icon in the explorer.'); return; }
    if (!(await flushSaves())) { toast('Save failed, so the run was cancelled. Check your connection.'); return; }
    var files = rowsList().filter(function (r) { return !r.is_folder; }).map(function (r) { return { path: r.path, content: r.content }; });
    var session = App.session(); if (!session || !session.access_token) { App.openAuth('signin', 'Your session ended. Sign in to run projects.'); return; }
    S.running = true; renderRunState('Running'); showPanel('output');
    var out = $('panel-output'); out.replaceChildren(el('div', 'ide-empty', 'Running ' + entry + ' in an isolated sandbox…'));
    S.problems = []; renderProblems();
    var t0 = performance.now();
    try {
      var res = await fetch(App.backendUrl + '/execute', { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(58000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ language: lang, files: files, entry: entry, stdin: $('ide-stdin').value }) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok && data.error) { renderRunError(data.error, res.status); }
      else renderResult(data, res.status, Math.round(performance.now() - t0));
    } catch (e) {
      renderRunError(e && e.name === 'TimeoutError' ? 'The run took too long. The server may be starting up; try again.' : 'Could not reach the compiler backend. Your files are saved.', 0);
    } finally { S.running = false; renderRunState(); }
  }

  function outBlock(label, text, cls) {
    var s = el('section', 'ide-out-block'); s.appendChild(el('span', 'ide-out-label', label)); s.appendChild(el('pre', 'ide-out-pre' + (cls ? ' ' + cls : ''), text)); return s;
  }
  function renderRunError(message, status) {
    var out = $('panel-output'); out.replaceChildren();
    out.appendChild(el('div', 'ide-out-head error', status === 429 ? 'Run limit reached' : status === 401 ? 'Sign-in needed' : status === 403 ? 'Language not added' : 'Could not run'));
    out.appendChild(outBlock('Details', message)); $('ide-run-meta').textContent = '';
    if (status === 401) App.openAuth('signin', 'Your session ended. Sign in to run projects.');
  }
  function renderResult(r, status, wallMs) {
    var out = $('panel-output'); out.replaceChildren();
    var compileError = r.compileError === true, timedOut = r.timedOut === true, runtimeError = Number.isInteger(r.exitCode) && r.exitCode !== 0 && !timedOut;
    var failed = compileError || timedOut || runtimeError;
    out.appendChild(el('div', 'ide-out-head ' + (failed ? (timedOut ? 'warning' : 'error') : 'success'), compileError ? 'Compilation failed' : timedOut ? 'Execution timed out' : runtimeError ? 'Program exited with code ' + r.exitCode : 'Execution completed'));
    out.appendChild(el('div', 'ide-out-cmd', '$ run ' + (r.entry || S.project.entry_path)));
    if (!compileError) out.appendChild(outBlock('Standard output', r.stdout || 'Program finished without standard output.'));
    if (r.stderr) out.appendChild(outBlock(compileError ? 'Compiler diagnostics' : 'Standard error', r.stderr, 'stderr'));
    var ms = Number.isFinite(Number(r.timeMs)) ? Math.round(Number(r.timeMs)) + ' ms' : (wallMs + ' ms');
    $('ide-run-meta').textContent = ms + (typeof r.exitCode === 'number' ? ' · exit ' + r.exitCode : '');
    S.problems = core.parseDiagnostics(S.project.language, r.stderr || '', rowsList().filter(function (x) { return !x.is_folder; }).map(function (x) { return x.path; }));
    renderProblems();
    renderRunState(compileError ? 'Compile error' : timedOut ? 'Timed out' : runtimeError ? 'Runtime error' : 'Success', failed ? (timedOut ? 'warn' : 'bad') : 'ok');
    if (S.problems.length) showPanel('problems');
  }

  // ---------- rendering ----------
  function renderAll() { renderGate(); renderProjects(); renderHeader(); renderTree(); renderTabs(); renderCrumbs(); renderStatus(); renderProblems(); }
  function renderGate() {
    var user = App.user(), gate = $('ide-gate'), body = $('ide-body');
    var show = !user || (S.loading && !S.loaded);
    gate.hidden = !show; body.hidden = show;
    if (show) {
      $('ide-gate-title').textContent = user ? 'Loading your projects…' : 'Project mode is for account holders';
      $('ide-gate-text').textContent = user ? 'One moment.' : 'Sign in to keep multi-file projects in your account and open them from any device.';
      $('ide-gate-signin').hidden = !!user;
    }
  }
  function renderHeader() {
    $('ide-project-name').textContent = S.project ? S.project.name : 'No project';
    $('ide-project-lang').textContent = S.project ? core.LABELS[S.project.language] : '';
  }
  function renderProjects() {
    var host = $('ide-projects'); host.replaceChildren();
    if (!S.projects.length) {
      var e = el('div', 'ide-side-empty'); e.appendChild(el('p', null, 'You have no projects yet.')); var b = el('button', 'panel-primary', 'Create your first project'); b.type = 'button'; b.addEventListener('click', newProject); e.appendChild(b); host.appendChild(e); return;
    }
    S.projects.forEach(function (p) {
      var row = el('div', 'ide-proj' + (S.project && S.project.id === p.id ? ' active' : '')), open = el('button', 'ide-proj-open'); open.type = 'button';
      open.appendChild(el('span', 'program-dot ' + p.language)); var t = el('span', 'ide-proj-text'); t.appendChild(el('b', null, p.name)); t.appendChild(el('small', null, core.LABELS[p.language])); open.appendChild(t);
      open.addEventListener('click', function () { openProject(p.id); });
      var acts = el('span', 'ide-row-actions');
      acts.appendChild(iconBtn('Rename project', ICON.rename, function () { renameProject(p); })); acts.appendChild(iconBtn('Delete project', ICON.trash, function () { deleteProject(p); }, true));
      row.append(open, acts); host.appendChild(row);
    });
  }
  function iconBtn(label, path, fn, danger) {
    var b = el('button', danger ? 'danger' : ''); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.appendChild(svg(path));
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(); }); return b;
  }

  function inlineInput(depth, initial, onCommit, onCancel, icon) {
    var row = el('div', 'tree-row editing'); row.style.setProperty('--depth', depth); row.appendChild(el('span', 'tree-caret')); row.appendChild(icon || el('span', 'tree-dot'));
    var input = el('input', 'tree-input'); input.type = 'text'; input.value = initial || ''; input.spellcheck = false; input.autocomplete = 'off'; input.maxLength = 120; input.setAttribute('aria-label', 'Name');
    var finished = false;
    function finish(commit) { if (finished) return; finished = true; var v = input.value.trim(); if (commit && v) onCommit(v); else onCancel(); }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', function () { finish(!!input.value.trim()); });
    row.appendChild(input);
    setTimeout(function () { input.focus(); var dot = (initial || '').lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : (initial || '').length); }, 0);
    return row;
  }
  function renderTree() {
    var host = $('ide-tree'); host.replaceChildren();
    if (!S.project) { host.appendChild(el('div', 'ide-side-empty', 'Open the Projects view to create or choose a project.')); return; }
    var tree = core.buildTree(rowsList()), entry = S.project.entry_path;
    function walk(node, depth) {
      if (S.creating && S.creating.dir === node.path) {
        var ic = S.creating.kind === 'folder' ? el('span', 'tree-folder') : el('span', 'tree-dot');
        host.appendChild(inlineInput(depth, '', commitCreate, function () { S.creating = null; renderTree(); }, ic));
      }
      node.children.forEach(function (c) {
        if (S.renaming === c.path) { host.appendChild(inlineInput(depth, c.name, function (v) { commitRename(c.path, v); }, function () { S.renaming = null; renderTree(); }, c.folder ? el('span', 'tree-folder') : el('span', 'tree-dot ' + core.highlightLang(c.path)))); if (c.folder && S.expanded.has(c.path)) walk(c, depth + 1); return; }
        var row = el('div', 'tree-row' + (S.selected === c.path ? ' selected' : '') + (S.active === c.path ? ' active' : '')); row.style.setProperty('--depth', depth);
        row.setAttribute('role', 'treeitem'); row.tabIndex = -1; row.dataset.path = c.path;
        if (c.folder) row.setAttribute('aria-expanded', String(S.expanded.has(c.path)));
        row.appendChild(el('span', 'tree-caret', c.folder ? (S.expanded.has(c.path) ? '⌄' : '›') : ''));
        row.appendChild(c.folder ? el('span', 'tree-folder') : el('span', 'tree-dot ' + core.highlightLang(c.path)));
        row.appendChild(el('span', 'tree-name', c.name));
        if (!c.folder && c.path === entry) { var badge = el('span', 'tree-entry', 'entry'); badge.title = 'Run starts here'; row.appendChild(badge); }
        var acts = el('span', 'ide-row-actions');
        if (!c.folder && core.isSource(S.project.language, c.path) && c.path !== entry) acts.appendChild(iconBtn('Set as entry file', ICON.entry, function () { setEntry(c.path); }));
        acts.appendChild(iconBtn('Rename (F2)', ICON.rename, function () { startRename(c.path); })); acts.appendChild(iconBtn('Delete', ICON.trash, function () { deleteEntry(c.path); }, true));
        row.appendChild(acts);
        row.addEventListener('click', function () {
          S.selected = c.path;
          if (c.folder) { S.focusTree = true; if (S.expanded.has(c.path)) S.expanded.delete(c.path); else S.expanded.add(c.path); renderTree(); } else openFile(c.path, 0, 0, true);
        });
        row.addEventListener('contextmenu', function (e) { e.preventDefault(); S.selected = c.path; showContext(e.clientX, e.clientY, c); });
        host.appendChild(row);
        if (c.folder && S.expanded.has(c.path)) walk(c, depth + 1);
      });
    }
    walk(tree, 0);
    if (S.focusTree && S.selected && !S.creating && !S.renaming) { var sel = host.querySelector('.tree-row[data-path="' + S.selected.replace(/"/g, '') + '"]'); if (sel) sel.focus({ preventScroll: true }); }
    if (!tree.children.length && !S.creating) host.appendChild(el('div', 'ide-side-empty', 'This project is empty. Use the + icons above to add a file or folder.'));
  }
  function showContext(x, y, node) {
    hideContext(); var m = el('div', 'ide-context'); m.id = 'ide-context'; m.setAttribute('role', 'menu');
    function item(label, fn) { var b = el('button', null, label); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.addEventListener('click', function () { hideContext(); fn(); }); m.appendChild(b); }
    if (node.folder) { item('New file here', function () { S.selected = node.path; S.expanded.add(node.path); startCreate('file'); }); item('New folder here', function () { S.selected = node.path; S.expanded.add(node.path); startCreate('folder'); }); }
    else if (core.isSource(S.project.language, node.path)) item('Set as entry file', function () { setEntry(node.path); });
    item('Rename', function () { startRename(node.path); }); item('Delete', function () { deleteEntry(node.path); });
    m.style.left = Math.min(x, window.innerWidth - 190) + 'px'; m.style.top = Math.min(y, window.innerHeight - 170) + 'px'; document.body.appendChild(m); m.querySelector('button').focus();
  }
  function hideContext() { var m = $('ide-context'); if (m) m.remove(); }

  function renderTabs() {
    var host = $('ide-tabs'); host.replaceChildren();
    S.tabs.forEach(function (t) {
      var same = S.tabs.filter(function (o) { return core.baseName(o.path) === core.baseName(t.path); }).length > 1;
      var tab = el('div', 'ide-tab' + (t.path === S.active ? ' active' : '')); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(t.path === S.active)); tab.tabIndex = 0; tab.title = t.path;
      tab.appendChild(el('span', 'tree-dot ' + core.highlightLang(t.path))); tab.appendChild(el('span', 'ide-tab-name', core.baseName(t.path)));
      if (same && core.parentPath(t.path)) tab.appendChild(el('span', 'ide-tab-dir', core.parentPath(t.path)));
      var x = el('button', 'ide-tab-close' + (isDirty(t) ? ' dirty' : '')); x.type = 'button'; x.setAttribute('aria-label', 'Close ' + t.path); x.appendChild(svg(ICON.close));
      x.addEventListener('click', function (e) { e.stopPropagation(); closeTab(t.path); });
      tab.appendChild(x);
      tab.addEventListener('click', function () { activate(t.path); });
      tab.addEventListener('auxclick', function (e) { if (e.button === 1) { e.preventDefault(); closeTab(t.path); } });
      tab.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t.path); } });
      host.appendChild(tab);
    });
    setSaveState();
  }
  function renderCrumbs() {
    var host = $('ide-crumbs'); host.replaceChildren(); host.hidden = !S.active; if (!S.active) return;
    var parts = S.active.split('/'), entry = S.project && S.project.entry_path === S.active;
    parts.forEach(function (p, i) { if (i) host.appendChild(el('span', 'crumb-sep', '›')); host.appendChild(el('span', i === parts.length - 1 ? 'crumb-last' : 'crumb', p)); });
    if (S.project && core.isSource(S.project.language, S.active) && !entry) { var b = el('button', 'crumb-entry', 'Set as entry file'); b.type = 'button'; b.addEventListener('click', function () { setEntry(S.active); }); host.appendChild(b); }
  }
  function setConn(label, bad) { var c = $('ide-st-conn'); c.textContent = label; c.className = bad ? 'bad' : ''; }
  function renderStatus() {
    $('ide-st-pos').textContent = S.active && S.pos ? 'Ln ' + S.pos[0] + ', Col ' + S.pos[1] : '';
    $('ide-st-lang').textContent = S.active ? ({ python: 'Python', javascript: 'JavaScript', java: 'Java', c: 'C', cpp: 'C++', text: 'Plain text' }[core.highlightLang(S.active)]) : '';
    $('ide-st-entry').textContent = S.project && S.project.entry_path ? 'Entry: ' + S.project.entry_path : S.project ? 'No entry file' : '';
    setSaveState();
  }
  function renderRunState(label, kind) {
    var st = $('ide-st-run'); st.textContent = S.running ? 'Running…' : (label || 'Idle'); st.className = 'ide-st-run ' + (S.running ? 'busy' : (kind || ''));
    $('ide-main').classList.toggle('is-running', S.running); $('ide-run').disabled = S.running; $('act-run').disabled = S.running; $('run-label').textContent = S.running ? 'Running' : 'Run';
  }
  function renderProblems() {
    var host = $('panel-problems'), n = S.problems.length, count = $('problems-count'); host.replaceChildren();
    count.hidden = !n; count.textContent = String(n);
    if (!n) { host.appendChild(el('div', 'ide-empty', 'No problems detected.')); return; }
    S.problems.forEach(function (p) {
      var row = el('button', 'ide-problem ' + p.severity); row.type = 'button';
      row.appendChild(el('span', 'ide-problem-icon', p.severity === 'warning' ? '▲' : '●')); row.appendChild(el('span', 'ide-problem-msg', p.message));
      row.appendChild(el('span', 'ide-problem-loc', p.file + ' [Ln ' + p.line + ', Col ' + p.col + ']'));
      row.addEventListener('click', function () { openFile(p.file, p.line, p.col); }); host.appendChild(row);
    });
  }

  // ---------- panel, side bar, resizing ----------
  function showPanel(name) {
    S.panel = name; document.querySelectorAll('.ide-panel-tabs button').forEach(function (b) { var on = b.dataset.panel === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    ['output', 'problems', 'input'].forEach(function (k) { $('panel-' + k).hidden = k !== name; });
    $('ide-panel').classList.remove('collapsed');
  }
  function showSide(view, keepState) {
    S.side = view; $('view-explorer').hidden = view !== 'explorer'; $('view-projects').hidden = view !== 'projects';
    $('act-explorer').classList.toggle('active', view === 'explorer'); $('act-projects').classList.toggle('active', view === 'projects'); if (!keepState) $('project-ide').dataset.side = 'open';
  }
  function toggleSide(view) { if ($('project-ide').dataset.side === 'open' && S.side === view) $('project-ide').dataset.side = 'closed'; else showSide(view); }
  function initResizer() {
    var main = $('ide-main'), handle = $('ide-resizer'), saved = parseInt(safeGet(PANEL_KEY), 10);
    if (saved >= 90) main.style.setProperty('--panel-h', saved + 'px');
    function setH(h) { var max = main.clientHeight - 150; h = Math.max(90, Math.min(h, max)); main.style.setProperty('--panel-h', h + 'px'); return h; }
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault(); handle.setPointerCapture(e.pointerId); handle.classList.add('drag');
      function move(ev) { var r = main.getBoundingClientRect(); setH(r.bottom - ev.clientY - 0); }
      function up(ev) { handle.classList.remove('drag'); handle.releasePointerCapture(ev.pointerId); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); safeSet(PANEL_KEY, String(parseInt(getComputedStyle(main).getPropertyValue('--panel-h'), 10) || 240)); }
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('keydown', function (e) {
      var cur = parseInt(getComputedStyle(main).getPropertyValue('--panel-h'), 10) || 240;
      if (e.key === 'ArrowUp') { e.preventDefault(); safeSet(PANEL_KEY, String(setH(cur + 30))); } else if (e.key === 'ArrowDown') { e.preventDefault(); safeSet(PANEL_KEY, String(setH(cur - 30))); }
    });
  }

  // ---------- wiring ----------
  function init() {
    $('act-explorer').addEventListener('click', function () { toggleSide('explorer'); });
    $('act-projects').addEventListener('click', function () { toggleSide('projects'); });
    $('act-run').addEventListener('click', run); $('ide-run').addEventListener('click', run);
    $('act-packages').addEventListener('click', App.openAccountPanel);
    $('ide-save').addEventListener('click', function () { api.save(true); });
    $('project-new').addEventListener('click', newProject);
    $('tree-new-file').addEventListener('click', function () { startCreate('file'); });
    $('tree-new-folder').addEventListener('click', function () { startCreate('folder'); });
    $('tree-collapse').addEventListener('click', function () { S.expanded.clear(); renderTree(); });
    $('ide-gate-signin').addEventListener('click', function () { App.openAuth('signin', 'Project mode keeps your multi-file projects in your account.'); });
    $('ide-project-title').addEventListener('click', function () { showSide('projects'); });
    document.querySelectorAll('.ide-panel-tabs button').forEach(function (b) { b.addEventListener('click', function () { showPanel(b.dataset.panel); }); });
    $('panel-clear').addEventListener('click', function () {
      if (S.panel === 'input') $('ide-stdin').value = ''; else { $('panel-output').replaceChildren(el('div', 'ide-empty', 'Run the project to see its output here.')); S.problems = []; renderProblems(); $('ide-run-meta').textContent = ''; }
    });
    $('panel-toggle').addEventListener('click', function () { $('ide-panel').classList.toggle('collapsed'); });
    $('ide-tree').addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return; if (!S.selected) return;
      if (e.key === 'F2') { e.preventDefault(); startRename(S.selected); } else if (e.key === 'Delete') { e.preventDefault(); deleteEntry(S.selected); }
    });
    document.addEventListener('keydown', function (e) {
      if (App.getMode() !== 'project') return;
      if (e.key === 'F2' && S.selected && document.activeElement && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); startRename(S.selected); }
      if (e.key === 'Escape') hideContext();
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('#ide-context')) hideContext(); });
    window.addEventListener('beforeunload', function (e) { if (dirtyTabs().length) { flushSaves(); e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && S.project) flushSaves(); });
    window.addEventListener('offline', function () { setConn('Offline', true); }); window.addEventListener('online', function () { setConn('Connected', false); if (S.project) flushSaves(); });
    initResizer();
    if (window.matchMedia && window.matchMedia('(max-width: 720px)').matches) $('project-ide').dataset.side = 'closed'; else $('project-ide').dataset.side = 'open';
    showPanel('output');
    App.onSession(onSession);
    document.addEventListener('draco:mode', function (e) { if (e.detail.mode === 'project') enter(); });
    if (App.getMode() === 'project') { renderGate(); if (App.ready()) enter(); }
  }
  function enter() { renderGate(); if (App.user() && !S.loaded && !S.loading) loadProjects(); }
  function onSession(user) {
    if (!user) { clearProject(); S.projects = []; S.loaded = false; renderAll(); return; }
    if (App.getMode() === 'project' && !S.loaded && !S.loading) loadProjects();
    else if (S.loaded) { renderProjects(); renderGate(); }
  }

  var api = {
    run: run,
    save: function (loud) { flushSaves().then(function (ok) { if (loud || !ok) toast(ok ? 'All changes saved to your account.' : 'Could not save. Check your connection.'); }); },
    state: function () { return { project: S.project, files: rowsList(), tabs: S.tabs.map(function (t) { return t.path; }), active: S.active }; }
  };
  window.DracoProject = api;
  init();
})();
