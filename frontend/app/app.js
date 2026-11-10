(function () {
  'use strict';

  const BACKEND_URL = String(window.DRACOCODE_CONFIG?.BACKEND_URL || window.DRACOSKILL_CONFIG?.BACKEND_URL || 'https://draco-code-backend.vercel.app').replace(/\/$/, '');
  const STORAGE_KEY = 'draco-code-workspace-v1';
  const LAYOUT_STORAGE_KEY = 'draco-code-layout-v1';
  const MAX_PROGRAMS = 30;
  const SUPABASE_URL = String(window.DRACOCODE_CONFIG?.SUPABASE_URL || '').trim();
  const SUPABASE_KEY = String(window.DRACOCODE_CONFIG?.SUPABASE_ANON_KEY || '').trim();
  const supabaseClient = SUPABASE_URL && SUPABASE_KEY && window.supabase?.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;
  let accountSession = null, accountUser = null, installedLanguages = new Set(), installedPackages = [], accountBusy = false;
  let authMode = 'signin', pendingMode = null, accountReady = false;
  const MODE_KEY = 'draco-code-mode-v1';
  const sessionListeners = [];
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

  function makeProgram(language, title, code) {
    const meta = LANGUAGES[language] || LANGUAGES.python;
    return { id: uid(), name: title || nextFilename(meta.file), language, code: typeof code === 'string' ? code : meta.starter, updatedAt: Date.now() };
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
    if (!canUseLanguage(program.language)) { openAccountPanel(); showToast('Sign in and add this language to use it.'); return; }
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

  let backendMissing = [];
  async function checkBackend() {
    updateConnection('checking', 'Connecting', 'Backend: checking');
    try {
      const response = await fetch(`${BACKEND_URL}/health`, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(6500) });
      const health = await response.json();
      if (!response.ok || health.status !== 'ok') throw new Error('Health check failed');
      backendMissing = Array.isArray(health.missing) ? health.missing : [];
      $('backend-help-button').hidden = health.databaseConfigured !== false;
      updateConnection(health.databaseConfigured === false ? 'warning' : 'online', health.databaseConfigured === false ? 'Needs setup' : 'Connected', health.databaseConfigured === false ? 'Backend: database configuration missing' : 'Backend: online');
      await checkRuntimes();
    } catch {
      $('backend-help-button').hidden = true;
      updateConnection('offline', navigator.onLine ? 'Unavailable' : 'Offline', 'Backend: unreachable');
      setRuntimeState(null);
    }
  }

  const runtimeInfo = {};                    // id -> { available } as reported by the backend
  function setRuntimeState(sandboxes) {
    (sandboxes || []).forEach((r) => { runtimeInfo[r.id] = r; });
    if (typeof renderInstalledLanguages === 'function') renderInstalledLanguages();
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

  const COMMANDS = { python: 'python3 main.py', javascript: 'node main.js', java: 'javac Main.java && java Main', c: 'gcc main.c -o app && ./app', cpp: 'g++ main.cpp -o app && ./app' };
  const terminal = window.DracoTerminal.create(output, {
    onStatus: (kind, label) => {
      const running = kind === 'running';
      setResultState(kind === 'warning' || kind === 'error' || kind === 'success' || running ? kind : '', label);
      $('console-subtitle').textContent = running ? (label === 'Running' ? 'Running. Type below when it asks for input.' : label) : label;
      $('stop-button').hidden = !running || label !== 'Running';
    },
    onFinish: (info) => {
      isRunning = false;
      runLabel.textContent = 'Run';
      $('stop-button').hidden = true;
      $('execution-time').textContent = info.durationMs ? `${(info.durationMs / 1000).toFixed(info.durationMs < 10000 ? 2 : 1)} s` : '';
      if (info.unreachable) updateConnection('offline', 'Unavailable', 'Backend: request failed');
    }
  });

  function clearConsole(updateStatus = true) {
    lastResult = null;
    if (terminal.isRunning()) terminal.stop();
    output.classList.remove('term-host');
    output.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty-output';
    const mark = document.createElement('span');
    mark.className = 'empty-output-mark';
    mark.textContent = '›';
    const copy = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = 'Your terminal is ready';
    const p = document.createElement('p');
    p.textContent = 'Press Run. The program starts here, and when it asks for input you can type right in this window.';
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
    if (getMode() === 'project') { window.DracoProject?.run(); return; }
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
    const headers = {};
    if (accountSession?.access_token) headers.Authorization = `Bearer ${accountSession.access_token}`;
    isRunning = true;
    runLabel.textContent = 'Restart';
    $('execution-time').textContent = '';
    $('stop-button').hidden = true;
    await terminal.run({
      backendUrl: BACKEND_URL,
      headers,
      body: { language, code, stdin },
      command: COMMANDS[language],
      // Backends that predate terminal sessions: fall back to a one-shot run so nothing breaks mid-deploy.
      fallback: () => legacyRun(language, code, stdin, headers)
    });
  }

  // One-shot run (no live terminal): used only when the backend does not offer terminal sessions yet.
  async function legacyRun(language, code, stdin, authHeaders) {
    output.classList.remove('term-host');
    runButton.disabled = true;
    runLabel.textContent = 'Running';
    $('console-subtitle').textContent = language === 'java' || language === 'c' || language === 'cpp' ? 'Compiling and running…' : 'Running…';
    setResultState('running', 'Running');
    output.replaceChildren();
    const progress = document.createElement('div');
    progress.className = 'empty-output';
    progress.textContent = 'Your program is running in an isolated sandbox…';
    output.append(progress);
    try {
      const response = await fetch(`${BACKEND_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ language, code, stdin }),
        cache: 'no-store',
        signal: AbortSignal.timeout(52_000)
      });
      const data = await response.json().catch(() => ({}));
      if (data.error && response.status !== 200) {
        showError(data.error, response.status === 429 ? 'Rate limit' : response.status === 504 ? 'Timed out' : response.status === 503 ? 'Service unavailable' : 'Request failed');
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

  // opts: { code, name } so an example (or anything else) can start a program with its own source.
  function createProgram(language = languageSelect.value, opts = {}) {
    if (!canUseLanguage(language)) { openAccountPanel(); showToast('Sign in and add this language to unlock it.'); return; }
    if (state.programs.length >= MAX_PROGRAMS) {
      showToast(`You can keep up to ${MAX_PROGRAMS} local programs in this workspace.`);
      return;
    }
    if (activeProgram) activeProgram.code = editor.value;
    const program = makeProgram(language, opts.name ? nextFilename(opts.name) : undefined, opts.code);
    state.programs.unshift(program);
    setActive(program.id);
    editor.focus();
    showToast(opts.toast || 'New program created. It will autosave on this device.');
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
    if (!canUseLanguage(language)) { languageSelect.value = activeProgram.language; openAccountPanel(); showToast('Sign in and add this language to unlock it.'); return; }
    const meta = LANGUAGES[language], previous = LANGUAGES[activeProgram.language];
    const mine = editor.value.trim();
    if (!mine || mine === previous.starter.trim()) {
      // Nothing of yours to lose: turn this program into a ready-to-run program in the new language.
      const stem = activeProgram.name.replace(/\.[^.]+$/, '') || 'main';
      activeProgram.language = language;
      activeProgram.name = `${stem}${meta.extension}`;
      activeProgram.code = meta.starter;
      setActive(activeProgram.id);
      showToast(`Switched to ${meta.label}. This is a starter program: press Run.`);
    } else {
      // Your code is kept: the new language gets its own program (Python source cannot run as Java).
      activeProgram.code = editor.value;
      createProgram(language, { toast: `Started a new ${meta.label} program. Your ${previous.label} program is still in My programs.` });
    }
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


  const PACKAGE_CATALOG = {
    python: ['numpy','pandas','matplotlib','requests','scipy','pillow','sympy','beautifulsoup4','flask','pytest'],
    javascript: ['lodash','axios','dayjs','uuid','zod','chalk','express','date-fns','cheerio','mathjs'],
    java: ['org.json:json:20240303','com.google.code.gson:gson:2.11.0'],
    c: ['libsqlite3-dev','libssl-dev','libcurl4-openssl-dev'],
    cpp: ['nlohmann-json3-dev','libboost-dev','libeigen3-dev','libfmt-dev']
  };
  const LABELS = { python:'Python', javascript:'JavaScript', java:'Java', c:'C', cpp:'C++' };
  function canUseLanguage(language) { return language === 'python' || language === 'javascript' || installedLanguages.has(language); }
  function openAccountPanel() { $('account-panel').classList.add('open');$('account-panel').removeAttribute('inert');$('account-panel').setAttribute('aria-hidden','false');$('account-panel-scrim').hidden=false;closeMenu();renderPackageControls(); }
  function closeAccountPanel() { $('account-panel').classList.remove('open');$('account-panel').setAttribute('inert','');$('account-panel').setAttribute('aria-hidden','true');$('account-panel-scrim').hidden=true; }
  function updateLanguageAccess() {
    [...languageSelect.options].forEach(option=>{option.disabled=!canUseLanguage(option.value);option.textContent=LABELS[option.value]+(option.disabled?' · Sign in to unlock':'');});
    if(activeProgram&&!canUseLanguage(activeProgram.language)){const fallback=state.programs.find(p=>canUseLanguage(p.language));if(fallback)setActive(fallback.id);}
    renderInstalledLanguages();renderPackageControls();
  }
  async function refreshAccountData() {
    if(!supabaseClient||!accountUser)return;
    const [langs,packs]=await Promise.all([supabaseClient.from('draco_user_languages').select('language').order('installed_at'),supabaseClient.from('draco_user_packages').select('language,package_name,package_version,installed_at').order('installed_at')]);
    if(langs.error)throw langs.error;if(packs.error)throw packs.error;
    installedLanguages=new Set((langs.data||[]).map(x=>x.language));installedPackages=packs.data||[];updateLanguageAccess();
  }
  // ---- is a language really usable? (compiler snapshot) ----
  const setupWatch = { active: false, language: null };
  function languageReadiness(language) {
    if (language === 'python' || language === 'javascript') return { state: 'ready', text: 'Ready' };
    if (setupWatch.active) return { state: 'preparing', text: 'Preparing the compilers (one time, about 5 minutes)' };
    if (runtimeInfo[language]?.available === false) return { state: 'missing', text: 'Needs the one-time compiler setup' };
    return { state: 'ready', text: 'Ready' };
  }
  function useLanguage(language) {
    closeAccountPanel();
    if (activeProgram?.language === language && !editor.value.trim()) { editor.focus(); return; }
    if (activeProgram?.language === language) { createProgram(language, { toast: `Started a new ${LABELS[language]} program.` }); return; }
    languageSelect.value = language;
    setLanguage(language);
  }
  // The compilers (Java, C, C++) are installed once into a saved image. Start that by itself and follow its progress.
  async function prepareRuntime(language) {
    if (!BACKEND_URL || setupWatch.active) return;
    setupWatch.active = true; setupWatch.language = language; renderInstalledLanguages();
    try {
      let status = await (await fetch(`${BACKEND_URL}/setup/start`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(30000) })).json();
      const t0 = Date.now();
      while ((status.state === 'installing' || status.state === 'saving') && Date.now() - t0 < 15 * 60_000) {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        try { status = await (await fetch(`${BACKEND_URL}/setup/status`, { cache: 'no-store', signal: AbortSignal.timeout(20000) })).json(); } catch { /* keep trying */ }
      }
      setupWatch.active = false;
      if (status.state === 'done') { await checkRuntimes(); showToast(`${LABELS[language]} is ready. Press "Use ${LABELS[language]}" in the account panel.`); }
      else showToast(`The compiler setup did not finish${status.message ? ': ' + status.message : ''}. Open ${BACKEND_URL}/setup for details.`);
    } catch { showToast('Could not reach the backend to prepare the compilers.'); }
    finally { setupWatch.active = false; renderInstalledLanguages(); }
  }
  function renderInstalledLanguages() {
    const host = $('installed-language-list'); if (!host) return; host.replaceChildren();
    ['python', 'javascript', ...installedLanguages].forEach((language) => {
      const row = document.createElement('div'); row.className = 'installed-row language-row';
      const info = document.createElement('div'); info.className = 'language-info';
      const name = document.createElement('span'); name.textContent = LABELS[language];
      const ready = languageReadiness(language), state = document.createElement('small');
      state.className = `language-state status-${ready.state}`;
      state.textContent = `${language === 'python' || language === 'javascript' ? 'Included by default' : 'Added to your account'}. ${ready.text}`;
      info.append(name, state);
      const actions = document.createElement('div'); actions.className = 'language-actions';
      const use = document.createElement('button'); use.type = 'button'; use.className = 'use-language'; use.textContent = `Use ${LABELS[language]}`;
      use.addEventListener('click', () => useLanguage(language)); actions.append(use);
      if (ready.state === 'missing') {
        const setup = document.createElement('button'); setup.type = 'button'; setup.className = 'use-language'; setup.textContent = 'Set up now';
        setup.addEventListener('click', () => prepareRuntime(language)); actions.append(setup);
      }
      row.append(info, actions); host.append(row);
    });
    document.querySelectorAll('[data-add-language]').forEach((button) => {
      const language = button.dataset.addLanguage, added = installedLanguages.has(language);
      button.disabled = added; button.querySelector('b').textContent = added ? '\u2713' : '+';
      button.querySelector('small').textContent = added ? 'Added to account' : LABELS[language] + ' compiler';
    });
  }
  function renderPackageControls() {
    const select=$('package-language');if(!select)return;const available=['python','javascript',...installedLanguages],previous=available.includes(select.value)?select.value:'python';select.replaceChildren();
    available.forEach(language=>{const option=document.createElement('option');option.value=language;option.textContent=LABELS[language];select.append(option);});select.value=previous;
    const suggestions=$('package-suggestions');suggestions.replaceChildren();
    (PACKAGE_CATALOG[select.value]||[]).forEach(name=>{const button=document.createElement('button');button.type='button';button.className='package-chip';button.textContent=name;button.addEventListener('click',()=>{$('package-name').value=name;$('package-name').focus();});suggestions.append(button);});
    renderInstalledPackages();
  }
  // ---- packages: test each one right after adding it, so a broken package is found now, not when you run code ----
  const packageStatus = new Map();           // "lang:name@version" -> { state, reason }
  const pkgKey = (p) => `${p.language}:${p.package_name}@${p.package_version || ''}`;
  async function checkInstalledPackage(p) {
    if (!BACKEND_URL || !accountSession?.access_token) return;
    const key = pkgKey(p);
    packageStatus.set(key, { state: 'checking' }); renderInstalledPackages();
    try {
      const response = await fetch(`${BACKEND_URL}/packages/check`, {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(58000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accountSession.access_token}` },
        body: JSON.stringify({ language: p.language, name: p.package_name, version: p.package_version || '' })
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 404) packageStatus.set(key, { state: 'unknown', reason: 'Testing needs the latest backend version. Deploy it, then press Test.' });
      else if (response.ok && data.ok) packageStatus.set(key, { state: 'ok' });
      else if (response.ok && data.pending) { packageStatus.set(key, { state: 'pending', reason: 'Waiting for the one-time compiler setup to finish, then test again.' }); prepareRuntime(p.language); }
      else packageStatus.set(key, { state: 'bad', reason: data.reason || data.error || 'The test could not run.' });
    } catch (error) {
      packageStatus.set(key, { state: 'unknown', reason: error?.name === 'TimeoutError' ? 'The test took too long. Try again.' : 'Could not reach the backend to test it.' });
    }
    renderInstalledPackages();
  }
  function renderInstalledPackages() {
    const host = $('installed-package-list'); if (!host) return; host.replaceChildren();
    const language = $('package-language').value, list = installedPackages.filter((p) => p.language === language);
    if (!list.length) { const empty = document.createElement('p'); empty.className = 'installed-empty'; empty.textContent = 'No packages added for this language yet.'; host.append(empty); return; }
    list.forEach((p) => {
      const row = document.createElement('div'); row.className = 'installed-row package-row';
      const info = document.createElement('div'); info.className = 'package-info';
      const name = document.createElement('span'); name.textContent = p.package_name + (p.package_version ? '@' + p.package_version : '');
      const st = packageStatus.get(pkgKey(p)), chip = document.createElement('small'); chip.setAttribute('role', 'status');
      chip.className = `package-state status-${st?.state || 'untested'}`;
      chip.textContent = !st ? 'Not tested yet' : st.state === 'checking' ? 'Testing\u2026' : st.state === 'ok' ? '\u2713 Works' : st.state === 'bad' ? `\u2717 ${st.reason} It is skipped when you run code.` : st.reason;
      info.append(name, chip);
      const actions = document.createElement('div'); actions.className = 'language-actions';
      const test = document.createElement('button'); test.type = 'button'; test.textContent = 'Test'; test.setAttribute('aria-label', `Test ${p.package_name}`); test.disabled = st?.state === 'checking';
      test.addEventListener('click', () => checkInstalledPackage(p));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${p.package_name}`);
      remove.addEventListener('click', () => removePackage(p));
      actions.append(test, remove); row.append(info, actions); host.append(row);
    });
  }
  // Turn database rule violations into plain sentences.
  function accountDbMessage(error, fallback) {
    const m = String(error?.message || '');
    if (/duplicate key|already exists/i.test(m)) return 'That is already on your account.';
    if (/valid_chk|check constraint/i.test(m)) return 'That package name or version is not supported for this language.';
    if (/row-level security|permission denied|JWT/i.test(m)) return 'Your session expired. Sign in again and retry.';
    if (/up to 20 packages|Add this language/i.test(m)) return m;
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach your account. Check your connection and retry.';
    return fallback;
  }
  async function addLanguage(language) {
    if(!accountUser){openAccountPanel();$('account-email').focus();showToast('Create an account to add languages.');return;}
    if(!['java','c','cpp'].includes(language)||accountBusy||installedLanguages.has(language))return;accountBusy=true;
    try{const {error}=await supabaseClient.from('draco_user_languages').insert({user_id:accountUser.id,language});if(error)throw error;await refreshAccountData();showToast(LABELS[language]+' added. Press "Use '+LABELS[language]+'" in the account panel to start a program.');if(runtimeInfo[language]?.available===false)prepareRuntime(language);}
    catch(e){showToast(accountDbMessage(e,'Could not add this language. Please try again.'));}finally{accountBusy=false;}
  }
  async function addPackage() {
    if(!accountUser){openAccountPanel();showToast('Sign in to save packages to your account.');return;}
    const language=$('package-language').value,name=$('package-name').value.trim(),version=$('package-version').value.trim();
    if(!name){showToast('Enter a package name.');return;}if(!canUseLanguage(language)){showToast('Add this language to your account first.');return;}
    const validName = language==='python' ? /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(name)
      : language==='javascript' ? /^(?:@[a-z0-9][a-z0-9._-]{0,49}\/)?[a-z0-9][a-z0-9._-]{0,99}$/i.test(name)
      : language==='java' ? /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(name)
      : language==='c' ? ['libsqlite3-dev','libssl-dev','libcurl4-openssl-dev'].includes(name)
      : ['nlohmann-json3-dev','libboost-dev','libeigen3-dev','libfmt-dev'].includes(name);
    if(!validName){showToast('Choose a supported package from this language catalogue.');return;}
    if(version&&!/^[A-Za-z0-9.+_-]{1,80}$/.test(version)){showToast('Version contains unsupported characters.');return;}
    if(installedPackages.some(p=>p.language===language&&p.package_name.toLowerCase()===name.toLowerCase())){showToast('That package is already on your account.');return;}
    accountBusy=true;$('account-add-package').disabled=true;
    try{const {error}=await supabaseClient.from('draco_user_packages').insert({user_id:accountUser.id,language,package_name:name,package_version:version});if(error)throw error;$('package-name').value='';$('package-version').value='';await refreshAccountData();showToast(name+' added. Testing it now\u2026'),checkInstalledPackage({language,package_name:name,package_version:version});}
    catch(e){showToast(accountDbMessage(e,'Could not add this package. Please try again.'));}finally{accountBusy=false;$('account-add-package').disabled=false;}
  }
  async function removePackage(p) {
    try{const {error}=await supabaseClient.from('draco_user_packages').delete().eq('language',p.language).eq('package_name',p.package_name);if(error)throw error;await refreshAccountData();showToast(p.package_name+' removed.');}
    catch(e){showToast(accountDbMessage(e,'Could not remove package. Please try again.'));}
  }
  function setAuthMessage(message, kind) {
    const el = $('account-auth-message');
    el.textContent = message || '';
    el.className = 'account-message' + (kind ? ' ' + kind : '');
  }

  function setAuthBusy(busy) {
    const button = $('auth-submit');
    button.disabled = busy;
    button.textContent = busy ? 'Please wait…' : (authMode === 'signup' ? 'Create account' : 'Sign in');
  }

  function authErrorText(error, fallback) {
    const message = String(error?.message || '');
    if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect. Check your details and try again.';
    if (/email not confirmed/i.test(message)) return 'Please confirm your email using the link we sent before signing in.';
    if (/rate limit|too many requests/i.test(message)) return 'Too many attempts. Please wait a little and try again.';
    if (/password.*(short|minimum|at least)/i.test(message)) return 'Choose a longer password and try again.';
    return message || fallback;
  }

  function authRedirectUrl() {
    // Keep the browser auth callback on the production app origin. This URL must be
    // present in Supabase Authentication > URL Configuration > Redirect URLs.
    return 'https://draco-code.vercel.app/';
  }

  async function handleSignIn() {
    if (!supabaseClient || accountBusy) {
      if (!supabaseClient) setAuthMessage('Account service is unavailable. Please reload the page and try again.', 'error');
      return;
    }
    const email = $('account-email').value.trim().toLowerCase();
    const password = $('account-password').value;
    if (!email || !password) {
      setAuthMessage('Enter your email address and password.', 'error');
      return;
    }

    accountBusy = true;
    setAuthBusy(true);
    setAuthMessage('Signing in securely…');
    $('account-password').autocomplete = 'current-password';
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data?.session || !data?.user) throw new Error('Supabase did not return an active session. Please try again.');
      accountSession = data.session;
      accountUser = data.user;
      await applyAccountSession();
      closeAuth();
      showToast('Signed in successfully.');
      resumePending();
    } catch (error) {
      setAuthMessage(authErrorText(error, 'Could not sign in. Please try again.'), 'error');
    } finally {
      accountBusy = false;
      setAuthBusy(false);
    }
  }

  async function handleSignUp() {
    if (!supabaseClient || accountBusy) {
      if (!supabaseClient) setAuthMessage('Account service is unavailable. Please reload the page and try again.', 'error');
      return;
    }
    const email = $('account-email').value.trim().toLowerCase();
    const password = $('account-password').value;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthMessage('Enter a valid email address to create your account.', 'error');
      return;
    }
    if (password.length < 8) {
      setAuthMessage('Choose a password with at least 8 characters.', 'error');
      return;
    }

    accountBusy = true;
    setAuthBusy(true);
    $('account-password').autocomplete = 'new-password';
    setAuthMessage('Creating your account in Supabase…');
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: authRedirectUrl() }
      });
      if (error) throw error;

      // Supabase intentionally obscures whether an email is already registered in
      // some project configurations. Never claim an account was created in that case.
      if (!data?.session) {
        const alreadyRegistered = Array.isArray(data?.user?.identities) && data.user.identities.length === 0;
        setAuthMessage(
          alreadyRegistered
            ? 'If this email can be registered, Supabase will send a confirmation message. Check your inbox.'
            : 'Your registration request was accepted. Check your email and confirm the address. After confirmation, return here and sign in.',
          'success'
        );
        return;
      }

      accountSession = data.session;
      accountUser = data.user || data.session.user;
      await applyAccountSession();
      closeAuth();
      showToast('Your account is ready. You are signed in.');
      resumePending();
    } catch (error) {
      setAuthMessage(authErrorText(error, 'Could not create your account. Please try again.'), 'error');
    } finally {
      accountBusy = false;
      setAuthBusy(false);
    }
  }

  async function applyAccountSession() {
    const signedIn = !!accountSession?.user && !!accountUser;
    $('account-guest').hidden = signedIn;
    $('account-user').hidden = !signedIn;
    if (signedIn) {
      $('account-user-email').textContent = accountUser.email || 'Signed in';
      $('account-avatar').textContent = (accountUser.email || 'D').slice(0, 1).toUpperCase();
      setAuthMessage('');
      try {
        await refreshAccountData();
      } catch (error) {
        showToast('Signed in, but account settings could not load. Please reopen the panel and retry.');
        console.error('Draco account data could not be refreshed', error);
      }
    } else {
      accountSession = null;
      accountUser = null;
      installedLanguages.clear();
      installedPackages = [];
    }
    updateLanguageAccess();
    updateAccountChrome();
    sessionListeners.forEach((listener) => { try { listener(accountUser, accountSession); } catch (error) { console.error(error); } });
  }

  async function initAccount() {
    $('menu-button').addEventListener('click', openMenu);
    $('menu-close').addEventListener('click', closeMenu);
    $('menu-scrim').addEventListener('click', closeMenu);
    $('menu-compiler').addEventListener('click', () => { closeMenu(); setMode('compiler'); });
    $('menu-project').addEventListener('click', () => { closeMenu(); setMode('project'); });
    $('menu-packages').addEventListener('click', openAccountPanel);
    $('signin-button').addEventListener('click', () => { if (accountUser) openAccountPanel(); else openAuth('signin'); });
    $('account-open-auth').addEventListener('click', () => { closeAccountPanel(); openAuth('signin'); });
    $('account-panel-close').addEventListener('click', closeAccountPanel);
    $('account-panel-scrim').addEventListener('click', closeAccountPanel);
    $('auth-close').addEventListener('click', closeAuth);
    $('auth-scrim').addEventListener('click', closeAuth);
    $('auth-tab-signin').addEventListener('click', () => setAuthMode('signin'));
    $('auth-tab-signup').addEventListener('click', () => setAuthMode('signup'));
    $('auth-pw-toggle').addEventListener('click', () => {
      const input = $('account-password'), show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('auth-pw-toggle').textContent = show ? 'Hide' : 'Show';
      $('auth-pw-toggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    $('auth-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (authMode === 'signup') handleSignUp(); else handleSignIn();
    });
    $('account-signout').addEventListener('click', async () => {
      if (!supabaseClient || accountBusy) return;
      accountBusy = true;
      $('account-signout').disabled = true;
      try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        accountSession = null;
        accountUser = null;
        await applyAccountSession();
        showToast('Signed out. Guest languages remain available.');
      } catch (error) {
        showToast(authErrorText(error, 'Could not sign out. Please try again.'));
      } finally {
        accountBusy = false;
        $('account-signout').disabled = false;
      }
    });
    $('account-add-package').addEventListener('click', addPackage);
    $('package-language').addEventListener('change', renderPackageControls);
    document.querySelectorAll('[data-add-language]').forEach(button => {
      button.addEventListener('click', () => addLanguage(button.dataset.addLanguage));
    });
    if (!supabaseClient) {
      setAuthMessage('Account sign-in could not initialize. Check the Supabase public URL/key settings and reload.', 'error');
      $('auth-submit').disabled = true;
      accountReady = true;
      finishRestore();
      return;
    }

    // Subscribe before reading storage so a confirmation-link redirect or token
    // refresh cannot be missed during startup. The SDK persists/refreshes sessions.
    supabaseClient.auth.onAuthStateChange((event, session) => {
      accountSession = session || null;
      accountUser = session?.user || null;
      setTimeout(() => {
        applyAccountSession().catch(error => {
          console.error('Draco authentication state could not be applied', error);
        });
      }, 0);
    });

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    accountSession = data?.session || null;
    accountUser = accountSession?.user || null;
    await applyAccountSession();
    accountReady = true;
    finishRestore();
  }

  const AVATAR_SVG = $('signin-avatar').innerHTML;
  function updateAccountChrome() {
    const button = $('signin-button'), avatar = $('signin-avatar'), label = $('signin-label');
    if (accountUser) {
      const email = accountUser.email || 'Account';
      label.textContent = email.split('@')[0];
      avatar.textContent = '';
      avatar.dataset.initial = email.slice(0, 1).toUpperCase();
      avatar.classList.add('has-initial');
      button.classList.add('signed-in');
      button.title = 'Account, languages and packages';
      button.setAttribute('aria-label', `${label.textContent}, open account panel`);
      $('menu-foot').textContent = `Signed in as ${email}`;
      $('menu-project-badge').hidden = true;
    } else {
      label.textContent = 'Sign in';
      avatar.innerHTML = AVATAR_SVG;
      delete avatar.dataset.initial;
      avatar.classList.remove('has-initial');
      button.classList.remove('signed-in');
      button.title = 'Sign in or create an account';
      button.setAttribute('aria-label', 'Sign in');
      $('menu-foot').textContent = 'Guest. Python and JavaScript are available without an account.';
      $('menu-project-badge').hidden = false;
    }
  }

  function setAuthMode(mode) {
    authMode = mode === 'signup' ? 'signup' : 'signin';
    const signup = authMode === 'signup';
    $('auth-tab-signin').setAttribute('aria-selected', String(!signup));
    $('auth-tab-signup').setAttribute('aria-selected', String(signup));
    $('auth-title').textContent = signup ? 'Create your Draco account' : 'Sign in to Draco Code';
    $('account-password').autocomplete = signup ? 'new-password' : 'current-password';
    $('auth-submit').textContent = signup ? 'Create account' : 'Sign in';
    setAuthMessage('');
  }
  let authReturnFocus = null;
  function openAuth(mode = 'signin', reason) {
    closeMenu();
    closeAccountPanel();
    authReturnFocus = document.activeElement;
    setAuthMode(mode);
    $('auth-sub').textContent = reason || 'Use your account to unlock more languages and keep projects.';
    $('auth-scrim').hidden = false;
    $('auth-dialog').hidden = false;
    setTimeout(() => $('account-email').focus(), 30);
  }
  function closeAuth() {
    $('auth-scrim').hidden = true;
    $('auth-dialog').hidden = true;
    pendingMode = pendingMode && accountUser ? pendingMode : null;
    if (authReturnFocus?.focus) authReturnFocus.focus();
  }
  function openMenu() {
    $('menu-drawer').classList.add('open');
    $('menu-drawer').setAttribute('aria-hidden', 'false');
    $('menu-scrim').hidden = false;
    $('menu-button').setAttribute('aria-expanded', 'true');
    $('menu-compiler').focus();
  }
  function closeMenu() {
    $('menu-drawer').classList.remove('open');
    $('menu-drawer').setAttribute('aria-hidden', 'true');
    $('menu-scrim').hidden = true;
    $('menu-button').setAttribute('aria-expanded', 'false');
  }

  function getMode() { return document.body.dataset.mode || 'compiler'; }
  function setMode(mode, options = {}) {
    if (mode === 'project' && !accountUser && !options.restoring) {
      pendingMode = 'project';
      openAuth('signin', 'Project mode keeps your multi-file projects in your account. Sign in or create one to continue.');
      return;
    }
    const next = mode === 'project' ? 'project' : 'compiler';
    document.body.dataset.mode = next;
    $('workspace').hidden = next === 'project';
    $('project-ide').hidden = next !== 'project';
    $('menu-compiler').classList.toggle('active', next === 'compiler');
    $('menu-project').classList.toggle('active', next === 'project');
    if (!options.restoring) { try { localStorage.setItem(MODE_KEY, next); } catch { /* optional */ } }
    $('page-title').textContent = next === 'project' ? 'Draco Code Project mode' : 'Draco Code online compiler';
    $('skip-link').textContent = next === 'project' ? 'Skip to the file editor' : 'Skip to the editor';
    document.dispatchEvent(new CustomEvent('draco:mode', { detail: { mode: next } }));
  }
  function resumePending() {
    if (pendingMode === 'project' && accountUser) { pendingMode = null; setMode('project'); }
  }
  // A saved "project" mode is shown immediately, then confirmed (or dropped) once the session is known.
  function finishRestore() {
    if (getMode() === 'project' && !accountUser) setMode('compiler', { restoring: true });
  }

  $('skip-link').addEventListener('click', (event) => {
    event.preventDefault();
    const target = getMode() === 'project' ? document.querySelector('.ide-editor-host.active textarea') || $('ide-tree') : editor;
    if (target) target.focus();
  });

  window.DracoCore = Object.freeze({
    client: supabaseClient,
    backendUrl: BACKEND_URL,
    user: () => accountUser,
    session: () => accountSession,
    ready: () => accountReady,
    canUseLanguage,
    toast: showToast,
    openAuth,
    openAccountPanel,
    getMode,
    setMode,
    onSession: (listener) => { sessionListeners.push(listener); },
    // used by the command palette, examples and settings
    run: () => runCode(),
    stop: () => terminal.stop(),
    isRunning: () => terminal.isRunning(),
    programs: () => state.programs.map((p) => ({ id: p.id, name: p.name, language: p.language })),
    activeProgramId: () => state.activeId,
    activateProgram: (id) => { setMode('compiler'); if (activeProgram) activeProgram.code = editor.value; setActive(id); editor.focus(); },
    newProgram: (language, opts) => { setMode('compiler'); createProgram(language, opts); },
    changeLanguage: (language) => { setMode('compiler'); languageSelect.value = language; setLanguage(language); },
    currentLanguage: () => activeProgram?.language || 'python',
    languages: () => Object.keys(LANGUAGES).map((id) => ({ id, label: LANGUAGES[id].label, available: canUseLanguage(id) })),
    toggleLayout: () => toggleLayout(),
    openMenu, closeMenu,
    recheckBackend: () => checkBackend(),
    setConnection: updateConnection
  });

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    }, { once: true });
  }

  function loadSavedLayout() {
    try {
      return localStorage.getItem(LAYOUT_STORAGE_KEY) === 'split' ? 'split' : 'stacked';
    } catch {
      return 'stacked';
    }
  }

  function setLayout(layout) {
    const selected = layout === 'stacked' ? 'stacked' : 'split';
    const mainColumn = document.querySelector('.main-column');
    if (!mainColumn) return;
    mainColumn.dataset.layout = selected;

    const button = $('layout-toggle-button');
    const label = $('layout-toggle-label');
    const split = selected === 'split';
    label.textContent = split ? 'Split view' : 'Stacked view';
    button.title = split ? 'Switch to stacked layout' : 'Switch to split layout';
    button.setAttribute('aria-label', `${label.textContent}. ${button.title}`);   // starts with the visible text
    button.setAttribute('aria-pressed', String(split));

    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, selected);
    } catch {
      // Layout still changes for this session when storage is unavailable.
    }
  }

  function toggleLayout() {
    const current = document.querySelector('.main-column')?.dataset.layout || 'stacked';
    setLayout(current === 'split' ? 'stacked' : 'split');
  }

  // Wire editor and controls.
  setLayout(loadSavedLayout());
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
  $('layout-toggle-button').addEventListener('click', toggleLayout);
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
  $('clear-output-button').addEventListener('click', () => { if (terminal.isRunning()) terminal.clear(); else clearConsole(); });
  $('stop-button').addEventListener('click', () => terminal.stop());
  $('backend-help-button').addEventListener('click', () => window.DracoFeatures?.openBackendSetup(backendMissing, BACKEND_URL));
  $('copy-output-button').addEventListener('click', async () => {
    const text = output.classList.contains('term-host') ? terminal.text() : output.innerText;
    if (!text || !text.trim() || /Your terminal is ready/.test(text)) { showToast('Nothing to copy yet. Run your program first.'); return; }
    try { await copyText(text.replace(/\n+$/, '') + '\n'); showToast('Terminal output copied.'); }
    catch { showToast('Could not copy. Select the text and press Ctrl+C instead.'); }
  });
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
    if (event.key === 'Escape') {
      if (!$('auth-dialog').hidden) closeAuth();
      else if ($('menu-drawer').classList.contains('open')) closeMenu();
      else if ($('account-panel').classList.contains('open')) closeAccountPanel();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runCode();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (getMode() === 'project') { window.DracoProject?.save(); return; }
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

  try { if (localStorage.getItem(MODE_KEY) === 'project' && supabaseClient) setMode('project', { restoring: true }); } catch { /* compiler mode */ }
  initAccount().catch(e => { console.error('Draco account initialization failed', e); accountReady = true; finishRestore(); });
  checkBackend();
  registerServiceWorker();
})();
