// Draco Code terminal: a real, interactive console. The program keeps running in its sandbox,
// output streams in as it is printed, and what you type goes straight to the running program.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DracoTerminal = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- screen model: just enough terminal for CLI programs (CR, LF, backspace; ANSI is stripped) ----
  var ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
  function Screen() { this.cur = []; this.col = 0; this.done = ''; this.pending = ''; }
  Screen.prototype.write = function (text) {
    text = String(text).replace(ANSI, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '\n') { var line = this.cur.join('') + '\n'; this.done += line; this.pending += line; this.cur = []; this.col = 0; }
      else if (ch === '\r') this.col = 0;
      else if (ch === '\b') { if (this.col > 0) this.col--; }
      else if (ch === '\t') { do { this.cur[this.col++] = ' '; } while (this.col % 8); }
      else if (ch < ' ' && ch !== '\t') continue;
      else this.cur[this.col++] = ch;
    }
    for (var k = 0; k < this.cur.length; k++) if (this.cur[k] === undefined) this.cur[k] = ' ';
  };
  Screen.prototype.take = function () { var p = this.pending; this.pending = ''; return p; };
  Screen.prototype.line = function () { return this.cur.join(''); };
  Screen.prototype.text = function () { return this.done + this.cur.join(''); };

  function b64bytes(b64) { var s = atob(b64), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function create(host, opts) {
    opts = opts || {};
    var S = { running: false, session: null, offset: 0, screen: new Screen(), decoder: null, history: [], hist: -1, draft: '', sendChain: Promise.resolve(), t0: 0, token: 0, stoppedByUser: false, ctx: null };
    var ui = {};

    function status(kind, label) { if (opts.onStatus) opts.onStatus(kind, label); }
    function scrollDown() { host.scrollTop = host.scrollHeight; }
    function resizeInput() { ui.input.style.width = Math.max(1, ui.input.value.length + 1) + 'ch'; }

    function build() {
      host.replaceChildren(); host.classList.add('term-host');
      ui.root = el('div', 'term'); ui.pre = el('pre', 'term-pre');
      ui.done = document.createTextNode(''); ui.cur = el('span', 'term-cur'); ui.input = el('input', 'term-input');
      ui.input.type = 'text'; ui.input.autocomplete = 'off'; ui.input.autocapitalize = 'off'; ui.input.spellcheck = false;
      ui.input.setAttribute('aria-label', 'Type here to send input to the running program'); ui.input.setAttribute('enterkeyhint', 'send');
      ui.pre.append(ui.done, ui.cur, ui.input); ui.root.append(ui.pre); host.append(ui.root);
      ui.input.addEventListener('keydown', onKey); ui.input.addEventListener('input', resizeInput); ui.input.addEventListener('paste', onPaste);
      ui.root.addEventListener('mousedown', function () { setTimeout(function () { if (S.running && !String(window.getSelection())) ui.input.focus({ preventScroll: true }); }, 0); });
      ui.input.hidden = true; resizeInput();
    }
    // Move the unfinished last line into plain text so system text can follow it in the right order.
    function commitCur() {
      var line = S.screen.line(); if (!line) return;
      ui.done.appendData(line); ui.cur.textContent = ''; S.screen.done += line; S.screen.cur = []; S.screen.col = 0;
    }
    function sys(text, cls) { // dim, non-program text (prompt line, footers). Later program output goes AFTER it.
      commitCur();
      var s = el('span', 'term-sys' + (cls ? ' ' + cls : ''), text); ui.pre.insertBefore(s, ui.cur);
      ui.done = document.createTextNode(''); ui.pre.insertBefore(ui.done, ui.cur); return s;
    }
    function render() {
      var chunk = S.screen.take(); if (chunk) ui.done.appendData(chunk);
      ui.cur.textContent = S.screen.line(); scrollDown();
    }
    // program output is plain text; flush system text into the screen model first so ordering is right
    function feed(text) { S.screen.write(text); render(); }

    function api(path, body, timeoutMs) {
      var headers = Object.assign({ 'Content-Type': 'application/json' }, S.ctx.headers || {});
      return fetch(S.ctx.backendUrl + path, { method: 'POST', headers: headers, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(timeoutMs || 15000) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; }); });
    }

    // ---------- keyboard ----------
    function onKey(e) {
      if (!S.running) return;
      var k = e.key, ctrl = e.ctrlKey || e.metaKey;
      if (k === 'Enter' && !ctrl) { e.preventDefault(); submit(); }
      else if (ctrl && !e.shiftKey && (k === 'c' || k === 'C') && ui.input.selectionStart === ui.input.selectionEnd) { e.preventDefault(); ctrlC(); }
      else if (ctrl && (k === 'd' || k === 'D')) { e.preventDefault(); if (!ui.input.value) ctrlD(); }
      else if (ctrl && (k === 'l' || k === 'L')) { e.preventDefault(); clearScreen(); }
      else if (k === 'ArrowUp' && S.history.length) { e.preventDefault(); if (S.hist < 0) { S.draft = ui.input.value; S.hist = S.history.length; } if (S.hist > 0) S.hist--; ui.input.value = S.history[S.hist]; resizeInput(); }
      else if (k === 'ArrowDown' && S.hist >= 0) { e.preventDefault(); S.hist++; ui.input.value = S.hist >= S.history.length ? (S.hist = -1, S.draft) : S.history[S.hist]; resizeInput(); }
    }
    function onPaste(e) {
      if (!S.running) return; var text = (e.clipboardData || window.clipboardData).getData('text'); if (!/[\r\n]/.test(text)) return;
      e.preventDefault(); var lines = text.replace(/\r\n?/g, '\n').split('\n'), last = lines.pop();
      lines.forEach(function (l, i) { ui.input.value += l; submit(); }); ui.input.value += last; resizeInput();
    }
    function submit() {
      var line = ui.input.value; ui.input.value = ''; resizeInput();
      if (line) { S.history.push(line); } S.hist = -1;
      S.screen.write(line + '\n'); render();           // local echo, like a terminal
      sendText(line + '\n');
    }
    function sendText(text) {
      var token = S.token;
      S.sendChain = S.sendChain.then(function () { if (!S.running || token !== S.token) return; return api('/session/input', { session: S.session, text: text }, 12000).then(function (r) { if (r.status !== 200) sys('\n[input could not be delivered]\n', 'err'); }).catch(function () { sys('\n[input could not be delivered]\n', 'err'); }); });
    }
    function ctrlC() { S.screen.write('^C\n'); render(); stop(true); }
    function ctrlD() { S.screen.write('^D'); render(); api('/session/eof', { session: S.session }, 8000).catch(function () {}); }
    function clearScreen() {
      S.screen = new Screen(); ui.cur.textContent = '';
      while (ui.pre.firstChild && ui.pre.firstChild !== ui.cur) ui.pre.removeChild(ui.pre.firstChild);
      ui.done = document.createTextNode(''); ui.pre.insertBefore(ui.done, ui.cur);
    }

    // ---------- lifecycle ----------
    function finish(info) {
      if (!S.running && !info.force) return; S.running = false; S.token++;
      ui.input.hidden = true; ui.input.value = ''; resizeInput(); render();
      var ms = Date.now() - S.t0, secs = (ms / 1000).toFixed(ms < 10000 ? 2 : 1);
      var lead = S.screen.line() ? '\n' : '';  // sys() commits the partial line first
      var kind = 'success', label = 'Finished', msg;
      if (info.stopped) { kind = 'warning'; label = 'Stopped'; msg = '[Terminated]'; }
      else if (info.compileError) { kind = 'error'; label = 'Compilation failed'; msg = '[Compilation failed]'; }
      else if (info.timedOut) { kind = 'warning'; label = 'Timed out'; msg = '[Stopped: time limit reached]'; }
      else if (info.error) { kind = 'error'; label = 'Session lost'; msg = '[' + info.error + ']'; }
      else if (typeof info.exitCode === 'number' && info.exitCode !== 0) { kind = 'error'; label = 'Exit ' + info.exitCode; msg = '[Process exited with code ' + info.exitCode + ' in ' + secs + ' s]'; }
      else msg = '[Process finished with exit code 0 in ' + secs + ' s]';
      if (info.truncated) msg += '\n[Output limit reached; the rest was discarded]';
      sys(lead + msg + '\n', kind === 'success' ? '' : kind === 'error' ? 'err' : 'warn'); scrollDown();
      status(kind, label);
      if (opts.onFinish) opts.onFinish({ kind: kind, label: label, exitCode: info.exitCode, timedOut: !!info.timedOut, stopped: !!info.stopped, compileError: !!info.compileError, durationMs: ms, text: S.screen.text() });
    }
    function stop(byUser) {
      if (!S.running) return; var session = S.session;
      S.stoppedByUser = !!byUser; finish({ stopped: true });
      if (session) api('/session/stop', { session: session }, 8000).catch(function () {});
    }

    async function loop(token) {
      var failures = 0;
      while (S.running && token === S.token) {
        var r;
        try { r = await api('/session/poll', { session: S.session, offset: S.offset, wait: 2000 }, 15000); failures = 0; }
        catch (e) { if (++failures > 4) { finish({ error: 'Connection to the sandbox was lost' }); return; } await new Promise(function (res) { setTimeout(res, 600 * failures); }); continue; }
        if (!S.running || token !== S.token) return;
        if (r.status === 401 || r.json.ended) { finish({ error: r.json.error || 'The terminal session ended' }); return; }
        if (r.status !== 200) { if (++failures > 4) { finish({ error: r.json.error || 'The terminal stopped responding' }); return; } continue; }
        if (r.json.chunk) feed(S.decoder.decode(b64bytes(r.json.chunk), { stream: true }));
        if (typeof r.json.offset === 'number') S.offset = r.json.offset;
        if (r.json.done) { feed(S.decoder.decode()); finish(r.json); return; }
      }
    }

    // First use of Java / C / C++: the backend prepares the compilers by itself (about 5 minutes, once).
    // Follow its progress here, then start the program automatically.
    async function watchSetup(p, token) {
      var t0 = Date.now(), note = sys('', 'boot'), failures = 0;
      status('warning', 'Preparing\u2026');
      while (token === S.token && Date.now() - t0 < 15 * 60000) {
        await new Promise(function (resolve) { setTimeout(resolve, 6000); });
        if (token !== S.token) return;
        var j;
        try { j = await (await fetch(p.backendUrl + '/setup/status', { cache: 'no-store', signal: AbortSignal.timeout(20000) })).json(); failures = 0; }
        catch (e) { if (++failures > 6) break; continue; }
        if (j.state === 'done') { note.remove(); sys('[Ready! Starting your program\u2026]\n', 'prompt'); return run(Object.assign({}, p, { autoRetry: false })); }
        if (j.state === 'failed') { note.textContent = ''; sys('[The compiler setup failed' + (j.message ? ': ' + j.message : '') + '. Open ' + p.backendUrl + '/setup for details.]\n', 'err'); status('error', 'Setup failed'); return; }
        var mins = (Date.now() - t0) / 60000; note.textContent = 'Still preparing\u2026 ' + mins.toFixed(1) + ' min so far (usually about 5)\n';
      }
      if (token === S.token) { note.textContent = ''; sys('[This is taking longer than expected. Press Run again in a minute, or open ' + p.backendUrl + '/setup.]\n', 'warn'); status('warning', 'Still preparing'); }
    }

    // p: { backendUrl, headers, body, command, fallback }
    async function run(p) {
      if (S.running) stop(false);
      S.ctx = p; S.token++; var token = S.token; S.screen = new Screen(); S.offset = 0; S.session = null; S.decoder = new TextDecoder('utf-8'); S.stoppedByUser = false; S.sendChain = Promise.resolve();
      build(); S.running = true; S.t0 = Date.now();
      if (p.command) sys('$ ' + p.command + '\n', 'prompt');
      var boot = sys('Starting an isolated sandbox…\n', 'boot'); status('running', 'Starting…');
      var res;
      try { res = await api('/session/start', p.body, 55000); }
      catch (e) { boot.remove(); S.running = false; status('error', 'Unavailable'); sys('[Could not reach the compiler backend. Your code is still saved.]\n', 'err'); if (opts.onFinish) opts.onFinish({ kind: 'error', label: 'Unavailable', unreachable: true, text: '' }); return; }
      if (token !== S.token) return;
      boot.remove();
      if (res.status === 404 && p.fallback) { S.running = false; return p.fallback(); }   // older backend without terminal sessions
      if (res.status !== 200 || (!res.json.session && !res.json.done)) {
        S.running = false; var msg = res.json.error || 'The run could not be started.';
        if (res.json.code === 'not-configured') {   // the SERVER is missing settings: say who can fix it and how
          var gone = (res.json.missing || []).map(function (m) { return m.name; });
          sys('[' + msg + ']\n', 'err');
          sys('[Site owner: the server is missing ' + (gone.length ? gone.join(', ') : 'some settings') + '. Click "How to fix" at the top of the page for the exact steps.]\n', 'warn');
          status('error', 'Server not set up');
          if (opts.onFinish) opts.onFinish({ kind: 'error', label: 'Server not set up', httpStatus: res.status, error: msg, text: '' });
          return;
        }
        if (res.json.code === 'setup') {          // not an error: the compilers are being prepared for the first time
          sys('[' + msg + ']\n', 'warn');
          if (opts.onFinish) opts.onFinish({ kind: 'warning', label: 'Preparing', setup: true, text: '' });
          if (p.autoRetry !== false) watchSetup(p, token);
          return;
        }
        sys('[' + msg + ']\n', 'err'); status('error', res.status === 429 ? 'Rate limit' : res.status === 504 ? 'Timed out' : res.status === 503 ? 'Service unavailable' : 'Request failed');
        if (opts.onFinish) opts.onFinish({ kind: 'error', label: 'Request failed', httpStatus: res.status, error: msg, text: '' }); return;
      }
      if (res.json.done) { // compile error: nothing is running
        if (res.json.stderr) feed(res.json.stderr + (/\n$/.test(res.json.stderr) ? '' : '\n'));
        finish({ compileError: !!res.json.compileError, exitCode: res.json.exitCode, force: true }); return;
      }
      (res.json.warnings || []).forEach(function (w) { sys('[' + w + ']\n', 'warn'); });   // e.g. a package that could not be installed
      S.session = res.json.session; status('running', 'Running'); ui.input.hidden = false; resizeInput(); ui.input.focus({ preventScroll: true }); scrollDown();
      loop(token);
    }

    function reset(placeholderNode) { S.running = false; S.token++; host.classList.remove('term-host'); host.replaceChildren(placeholderNode); }
    /* text() returns the whole transcript (prompt line, output, exit line), like selecting the terminal */
    return { run: run, stop: function () { stop(true); }, isRunning: function () { return S.running; }, focus: function () { if (S.running) ui.input.focus(); }, text: function () { return ui.pre ? ui.pre.textContent : S.screen.text(); }, reset: reset, clear: function () { if (S.running) clearScreen(); } };
  }
  return { create: create, Screen: Screen };
});
