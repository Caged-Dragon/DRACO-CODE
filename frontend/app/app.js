(function () {
  'use strict';

  const BACKEND_URL = String(window.DRACOCODE_CONFIG?.BACKEND_URL || window.DRACOSKILL_CONFIG?.BACKEND_URL || 'https://draco-code-backend.vercel.app').replace(/\/$/, '');
  const STORAGE_KEY = 'draco-code-workspace-v1';
  const MAX_PROGRAMS = 30;
  const LANGUAGES = {
    python: { label: 'Python', extension: '.py', file: 'main.py', dot: 'python', starter: 'def main():\n    print("Hello from Draco Code")\n\nif __name__ == "__main__":\n    main()\n' },
    javascript: { label: 'JavaScript', extension: '.js', file: 'main.js', dot: 'javascript', starter: 'function main() {\n  console.log("Hello from Draco Code");\n}\n\nmain();\n' },
    java: { label: 'Java', extension: '.java', file: 'Main.java', dot: 'java', starter: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Draco Code");\n    }\n}\n' },
    c: { label: 'C', extension: '.c', file: 'main.c', dot: 'c', starter: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello from Draco Code\\n");\n    return 0;\n}\n' },
    cpp: { label: 'C++', extension: '.cpp', file: 'main.cpp', dot: 'cpp', starter: '#include <iostream>\n\nint main() {\n    std::cout << "Hello from Draco Code" << std::endl;\n    return 0;\n}\n' }
  };

  const $ = (id) => document.getElementById(id);
  const editor = $('editor');
  const runButton = $('run-button');
  const runLabel = $('run-label');
  const output = $('console-output');
  const stateLabel = $('result-state');
  const connectionChip = $('connection-chip');
  const connectionLabel = $('connection-label');
  const languageSelect = $('language-select');
  let state = loadState();
  let activeProgram = null;
  let editorApi = null;
  let isRunning = false;
  let saveTimer = null;
  let toastTimer = null;
  let lastResult = null;

  function uid() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function makeProgram(language, title) {
    const meta = LANGUAGES[language] || LANGUAGES.python;
    return { id: uid(), name: title || nextFilename(meta.file), language, code: meta.starter, updatedAt: Date.now() };
  }

  function nextFilename(base) {
    const used = new Set((state?.programs || []).map((p) => p.name));
    if (!used.has(base)) return base;
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    let n = 2;
    while (used.has(`${stem}-${n}${ext}`)) n += 1;
    return `${stem}-${n}${ext}`;
  }

  function defaultState() {
    const first = makeProgram('python', 'main.py');
    return { version: 1, activeId: first.id, programs: [first] };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved?.version === 1 && Array.isArray(saved.programs) && saved.programs.length) {
        const clean = saved.programs.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && LANGUAGES[p.language] && typeof p.code === 'string').slice(0, MAX_PROGRAMS);
        if (clean.length) return { version: 1, activeId: clean.some((p) => p.id === saved.activeId) ? saved.activeId : clean[0].id, programs: clean };
      }
    } catch { /* use a clean local workspace when storage is blocked or malformed */ }
    return defaultState();
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $('save-state').textContent = 'Saved locally';
      $('save-state').className = 'save-state';
      return true;
    } catch {
      $('save-state').textContent = 'Storage full';
      $('save-state').className = 'save-state error';
      return false;
    }
  }

  function setSaving() {
    $('save-state').textContent = 'Saving…';
    $('save-state').className = 'save-state saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (activeProgram) {
        activeProgram.code = editor.value;
        activeProgram.updatedAt = Date.now();
      }
      persist();
    }, 220);
  }

  function setActive(id) {
    const program = state.programs.find((p) => p.id === id);
    if (!program) return;
    if (activeProgram && activeProgram.id !== id) activeProgram.code = editor.value;
    activeProgram = program;
    state.activeId = id;
    languageSelect.value = program.language;
    editorApi?.setLang(program.language);
    editor.value = program.code;
    $('filename').textContent = program.name;
    $('status-language').textContent = LANGUAGES[program.language].label;
    $('file-type-dot').className = `file-type-dot ${program.language}`;
    updateEditorMeta();
    clearConsole(false);
    renderProgramList();
    persist();
  }

  function renderProgramList() {
    const list = $('program-list');
    list.replaceChildren();
    state.programs.forEach((program) => {
      const item = document.createElement('div');
      item.className = 'program-item' + (program.id === state.activeId ? ' active' : '');
      item.setAttribute('role', 'listitem');
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'program-select';
      const dot = document.createElement('span');
      dot.className = `program-dot ${program.language}`;
      const name = document.createElement('span');
      name.className = 'program-item-name';
      name.textContent = program.name;
      select.append(dot, name);
      select.addEventListener('click', () => setActive(program.id));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'program-item-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Delete ${program.name}`);
      remove.title = 'Delete program';
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteProgram(program.id);
      });
      item.append(select, remove);
      list.append(item);
    });
  }

  function updateEditorMeta() {
    const lines = editor.value.split('\n').length;
    $('source-size').textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
    $('filename').textContent = activeProgram?.name || 'Untitled';
  }

  function showToast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2700);
  }

  function updateConnection(kind, label, detail) {
    connectionChip.className = `connection-chip ${kind}`;
    connectionLabel.textContent = label;
    $('backend-detail').textContent = detail || `Backend: ${label.toLowerCase()}`;
  }

  async function checkBackend() {
    updateConnection('checking', 'Connecting', 'Backend: checking');
    try {
      const response = await fetch(`${BACKEND_URL}/health`, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(6500) });
      const health = await response.json();
      if (!response.ok || health.status !== 'ok') throw new Error('Health check failed');
      updateConnection(health.databaseConfigured === false ? 'warning' : 'online', health.databaseConfigured === false ? 'Needs setup' : 'Connected', health.databaseConfigured === false ? 'Backend: database configuration missing' : 'Backend: online');
      await checkRuntimes();
    } catch {
      updateConnection('offline', navigator.onLine ? 'Unavailable' : 'Offline', 'Backend: unreachable');
      setRuntimeState(null);
    }
  }

  function setRuntimeState(sandboxes) {
    const host = $('runtime-list');
    host.replaceChildren();
    const cap = document.createElement('span');
    cap.className = 'runtime-caption';
    cap.textContent = 'RUNTIMES';
    host.append(cap);
    Object.entries(LANGUAGES).forEach(([id, meta]) => {
      const item = document.createElement('span');
      const info = sandboxes?.find((runtime) => runtime.id === id);
      const available = info?.available === true;
      item.className = `runtime-pill ${!sandboxes ? 'offline' : available ? 'ready' : 'missing'}`;
      item.textContent = meta.label;
      item.title = !sandboxes ? 'Backend unavailable' : available ? `${meta.label} runtime available` : `${meta.label} needs compiler setup`;
      host.append(item);
    });
  }

  async function checkRuntimes() {
    try {
      const response = await fetch(`${BACKEND_URL}/sandboxes`, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(6500) });
      if (!response.ok) throw new Error('Runtime check failed');
      const data = await response.json();
      const sandboxes = Array.isArray(data.sandboxes) ? data.sandboxes : [];
      setRuntimeState(sandboxes);
      const unavailable = sandboxes.filter((runtime) => runtime.available === false);
      if (unavailable.length) $('backend-detail').textContent = `${unavailable.length} runtime(s) need setup`;
      else $('backend-detail').textContent = 'All runtimes ready';
      if (data.isolation?.driver === 'vercel-sandbox') $('backend-detail').title = 'Programs run in isolated Vercel Sandbox microVMs';
    } catch {
      setRuntimeState(null);
    }
  }

  function outputBlock(label, text, extraClass) {
    if (!text) return null;
    const section = document.createElement('section');
    section.className = 'output-section';
    const name = document.createElement('span');
    name.className = 'output-section-label';
    name.textContent = label;
    const pre = document.createElement('pre');
    pre.className = 'output-text' + (extraClass ? ` ${extraClass}` : '');
    pre.textContent = text;
    section.append(name, pre);
    return section;
  }

  function setResultState(kind, label) {
    stateLabel.className = `result-state ${kind || ''}`.trim();
    const text = stateLabel.querySelector('span:last-child');
    if (text) text.textContent = label;
  }

  function clearConsole(updateStatus = true) {
    lastResult = null;
    output.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty-output';
    const mark = document.createElement('span');
    mark.className = 'empty-output-mark';
    mark.textContent = '›';
    const copy = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = 'Output will appear here';
    const p = document.createElement('p');
    p.textContent = 'Run your program to see standard output, errors and execution time.';
    copy.append(strong, p);
    empty.append(mark, copy);
    output.append(empty);
    $('console-subtitle').textContent = 'Ready when you are';
    $('execution-time').textContent = '';
    if (updateStatus) setResultState('', 'Idle');
  }

  function renderExecution(result, httpStatus) {
    lastResult = result;
    output.replaceChildren();
    const compileError = result?.compileError === true;
    const timedOut = result?.timedOut === true;
    const runtimeError = Number.isInteger(result?.exitCode) && result.exitCode !== 0 && !timedOut;
    const failed = compileError || timedOut || runtimeError || httpStatus >= 400;
    const heading = document.createElement('div');
    heading.className = `output-heading ${failed ? (timedOut ? 'warning' : 'error') : 'success'}`;
    heading.textContent = compileError ? 'Compilation failed' : timedOut ? 'Execution timed out' : runtimeError ? `Program exited with code ${result.exitCode}` : 'Execution completed';
    output.append(heading);
    const stdout = outputBlock('Standard output', result.stdout || 'Program finished without standard output.');
    const stderr = outputBlock(compileError ? 'Compiler diagnostics' : 'Standard error', result.stderr, 'stderr');
    if (stdout) output.append(stdout);
    if (stderr) output.append(stderr);
    if (result.compile && !compileError && (result.compile.stdout || result.compile.stderr)) {
      const compile = outputBlock('Compilation', [result.compile.stdout, result.compile.stderr].filter(Boolean).join('\n'));
      if (compile) output.append(compile);
    }
    const duration = Number.isFinite(Number(result.timeMs)) ? `${Math.max(0, Math.round(Number(result.timeMs)))} ms` : '—';
    $('execution-time').textContent = `Execution ${duration}${typeof result.exitCode === 'number' ? ` · exit ${result.exitCode}` : ''}`;
    $('console-subtitle').textContent = failed ? 'Completed with an issue' : 'Run successful';
    setResultState(failed ? (timedOut ? 'warning' : 'error') : 'success', compileError ? 'Compilation error' : timedOut ? 'Timed out' : runtimeError ? 'Runtime error' : 'Success');
  }

  async function runCode() {
    if (isRunning) return;
    if (!navigator.onLine) {
      clearConsole(false);
      showError('You are offline. Your edits are saved locally; reconnect to run code.');
      return;
    }
    if (!BACKEND_URL) {
      showError('The execution backend is not configured.');
      return;
    }
    const language = activeProgram.language;
    const code = editor.value;
    const stdin = $('stdin-input').value;
    if (!code.trim()) {
      showError('Add some code before running this program.');
      return;
    }
    isRunning = true;
    runButton.disabled = true;
    runLabel.textContent = 'Running';
    $('console-subtitle').textContent = language === 'java' || language === 'c' || language === 'cpp' ? 'Compiling and running…' : 'Running…';
    $('execution-time').textContent = '';
    setResultState('running', 'Running');
    output.replaceChildren();
    const progress = document.createElement('div');
    progress.className = 'empty-output';
    progress.textContent = 'Your program is running in an isolated sandbox…';
    output.append(progress);
    try {
      const response = await fetch(`${BACKEND_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, code, stdin }),
        cache: 'no-store',
        signal: AbortSignal.timeout(52_000)
      });
      const data = await response.json().catch(() => ({}));
      if (data.error && response.status !== 200) {
        showError(data.error, response.status === 429 ? 'Rate limit' : response.status === 503 ? 'Service unavailable' : 'Request failed');
        return;
      }
      renderExecution(data, response.status);
    } catch (error) {
      showError(error?.name === 'TimeoutError' ? 'The request took too long. The server may still be starting; please retry.' : 'Could not reach the compiler backend. Your source code is still saved on this device.');
      updateConnection('offline', 'Unavailable', 'Backend: request failed');
    } finally {
      isRunning = false;
      runButton.disabled = false;
      runLabel.textContent = 'Run';
    }
  }

  function showError(message, title = 'Execution unavailable') {
    output.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'output-heading error';
    heading.textContent = title;
    const block = outputBlock('Details', String(message));
    output.append(heading);
    if (block) output.append(block);
    $('console-subtitle').textContent = title;
    $('execution-time').textContent = '';
    setResultState('error', title);
  }

  function createProgram(language = languageSelect.value) {
    if (state.programs.length >= MAX_PROGRAMS) {
      showToast(`You can keep up to ${MAX_PROGRAMS} local programs in this workspace.`);
      return;
    }
    if (activeProgram) activeProgram.code = editor.value;
    const program = makeProgram(language);
    state.programs.unshift(program);
    setActive(program.id);
    editor.focus();
    showToast('New program created. It will autosave on this device.');
  }

  function deleteProgram(id) {
    const program = state.programs.find((p) => p.id === id);
    if (!program) return;
    if (!window.confirm(`Delete ${program.name}? This removes its local draft.`)) return;
    const wasActive = state.activeId === id;
    state.programs = state.programs.filter((p) => p.id !== id);
    if (!state.programs.length) state = defaultState();
    if (wasActive) setActive(state.programs[0].id);
    else {
      renderProgramList();
      persist();
    }
    showToast('Program deleted from this device.');
  }

  function setLanguage(language) {
    if (!LANGUAGES[language] || !activeProgram || activeProgram.language === language) return;
    if (!window.confirm(`Change this file to ${LANGUAGES[language].label}? Its current source will be kept as-is; it will not be translated.`)) {
      languageSelect.value = activeProgram.language;
      return;
    }
    activeProgram.language = language;
    const meta = LANGUAGES[language];
    const stem = activeProgram.name.replace(/\.[^.]+$/, '') || 'main';
    activeProgram.name = `${stem}${meta.extension}`;
    editorApi.setLang(language);
    $('status-language').textContent = meta.label;
    $('file-type-dot').className = `file-type-dot ${language}`;
    persist();
    renderProgramList();
    updateEditorMeta();
    showToast(`Language set to ${meta.label}. Source was preserved.`);
  }

  function resetProgram() {
    if (!activeProgram) return;
    if (!window.confirm('Replace this program with the language starter template?')) return;
    editor.value = LANGUAGES[activeProgram.language].starter;
    activeProgram.code = editor.value;
    setSaving();
    clearConsole();
    showToast('Starter template restored.');
  }

  function shareProgram() {
    const code = editor.value;
    if (code.length > 10_000) {
      showToast('This program is too large for a share link. Download the source file instead.');
      return;
    }
    try {
      const bytes = new TextEncoder().encode(code);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      const url = `${location.origin}${location.pathname}?lang=${encodeURIComponent(activeProgram.language)}#code=${encoded}`;
      copyText(url).then(() => showToast('Share link copied. It includes this language and source code.')).catch(() => showToast('Could not copy automatically. Check clipboard permissions.'));
    } catch {
      showToast('Could not create a share link for this source.');
    }
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText && window.isSecureContext) return navigator.clipboard.writeText(value);
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Clipboard unavailable');
  }

  function downloadProgram() {
    const blob = new Blob([editor.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeProgram?.name || LANGUAGES[activeProgram?.language || 'python'].file;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Downloaded ${link.download}.`);
  }

  function loadSharedProgram() {
    const match = location.hash.match(/(?:^#|&)code=([A-Za-z0-9_-]*)$/);
    if (!match) return false;
    try {
      const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const code = new TextDecoder().decode(bytes);
      const requestedLanguage = new URLSearchParams(location.search).get('lang');
      const language = LANGUAGES[requestedLanguage] ? requestedLanguage : 'python';
      const program = makeProgram(language);
      program.code = code;
      program.name = nextFilename(LANGUAGES[language].file);
      state.programs.unshift(program);
      state.programs = state.programs.slice(0, MAX_PROGRAMS);
      state.activeId = program.id;
      history.replaceState(null, '', `${location.pathname}?lang=${language}`);
      showToast('Shared source loaded into a new local program.');
      return true;
    } catch {
      showToast('That share link could not be decoded.');
      return false;
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    }, { once: true });
  }

  // Wire editor and controls.
  editorApi = window.DracoEditor.attach(editor, {
    lang: 'python',
    onCursor: (line, column) => { $('cursor-position').textContent = `Line ${line}, column ${column}`; }
  });

  if (loadSharedProgram()) persist();
  activeProgram = state.programs.find((p) => p.id === state.activeId) || state.programs[0];
  state.activeId = activeProgram.id;
  setActive(activeProgram.id);

  editor.addEventListener('input', () => {
    if (!activeProgram) return;
    activeProgram.code = editor.value;
    activeProgram.updatedAt = Date.now();
    updateEditorMeta();
    setSaving();
  });
  languageSelect.addEventListener('change', (event) => setLanguage(event.target.value));
  runButton.addEventListener('click', runCode);
  $('new-program-button').addEventListener('click', () => createProgram());
  $('share-button').addEventListener('click', shareProgram);
  $('download-button').addEventListener('click', downloadProgram);
  $('reset-button').addEventListener('click', resetProgram);
  $('clear-button').addEventListener('click', () => {
    if (!editor.value || window.confirm('Clear all source code in this program?')) {
      editor.value = '';
      activeProgram.code = '';
      setSaving();
      clearConsole();
      editor.focus();
    }
  });
  $('clear-output-button').addEventListener('click', () => clearConsole());
  $('toggle-input-button').addEventListener('click', () => {
    const button = $('toggle-input-button');
    const wrap = $('stdin-wrap');
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    wrap.hidden = !open;
    if (open) $('stdin-input').focus();
  });
  $('mobile-menu-button').addEventListener('click', () => {
    const sidebar = $('file-sidebar');
    const open = sidebar.classList.toggle('open');
    $('mobile-menu-button').setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runCode();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (activeProgram) activeProgram.code = editor.value;
      persist();
      showToast('Program saved on this device.');
    }
  });
  window.addEventListener('online', checkBackend);
  window.addEventListener('offline', () => {
    updateConnection('offline', 'Offline', 'Backend: offline');
    setRuntimeState(null);
    showToast('Offline mode: keep editing. Your changes are saved locally.');
  });
  window.addEventListener('pagehide', () => {
    if (activeProgram) activeProgram.code = editor.value;
    persist();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (activeProgram) activeProgram.code = editor.value;
      persist();
    }
  });

  checkBackend();
  registerServiceWorker();
})();
