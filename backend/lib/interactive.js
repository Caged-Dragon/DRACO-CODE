// Interactive terminal sessions. The program keeps running inside ONE sandbox while the browser
// polls for output and sends keystrokes, so scanf / input() / Scanner behave like a real terminal.
//
//   start  -> create sandbox, compile, launch the program in the background (stdin follows a file)
//   poll   -> long-poll for new output (+ exit status)
//   input  -> append typed text to the program's stdin
//   eof    -> Ctrl+D: close stdin           stop -> Ctrl+C: kill the program and the sandbox
//
// A session is addressed by an HMAC-signed, expiring token, never by the raw sandbox name.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';
import {
  RunSession, ProjectSession, ROOT, getFactory, compileFailure, missingTool, missingMessage,
  isCapacityError, CAPACITY_MESSAGE, RUN_LANGUAGES, MAX_CODE, MAX_STDIN,
} from './runner.js';
import { validateProject } from './project.js';

export const SESSION_SECONDS = Number(process.env.DRACO_SESSION_SECONDS || 120); // hard cap on one program
export const MAX_TERM_BYTES = 100_000;
export const MAX_INPUT_BYTES = 4_000;
const TOKEN_TTL_MS = (SESSION_SECONDS + 45) * 1000;

function key() { return `${process.env.CODE_RATE_LIMIT_SECRET || 'local-development-only-session-key'}:terminal-session`; }
const b64u = (b) => Buffer.from(b).toString('base64url');
function mac(payload) { return createHmac('sha256', key()).update(payload).digest(); }
export function signToken(name, now = Date.now()) {
  const payload = b64u(JSON.stringify({ n: name, e: now + TOKEN_TTL_MS }));
  return `${payload}.${b64u(mac(payload))}`;
}
export function verifyToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 400) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const want = mac(payload), got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { n, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof n === 'string' && /^draco-[0-9a-f-]{36}$/.test(n) && e > now ? n : null;
  } catch { return null; }
}

// Tests replace this to reattach to a local stand-in instead of Vercel.
export async function getSandbox(name) {
  if (globalThis.__DRACO_SANDBOX_GET) return globalThis.__DRACO_SANDBOX_GET(name);
  return Sandbox.get({ name });
}

// Node keeps a never-ending stdin pipe alive after readline's rl.close(); a real terminal doesn't.
// This preload (JavaScript only, lazy, harmless to programs that never use process.stdin) fixes that.
export const NODE_PRELOAD = `// Draco terminal: release stdin when the program stops reading it (e.g. after rl.close()).
try {
  const d = Object.getOwnPropertyDescriptor(process, 'stdin');
  if (d && d.get) {
    let hooked = false;
    Object.defineProperty(process, 'stdin', { configurable: true, enumerable: d.enumerable, get() {
      const s = d.get.call(process);
      if (!hooked) { hooked = true; s.on('pause', () => { if (s._handle && s._handle.unref) s._handle.unref(); }); s.on('resume', () => { if (s._handle && s._handle.ref) s._handle.ref(); }); }
      return s;
    } });
  }
} catch (e) { /* never break the user's program */ }
`;

// The command that actually runs the program, tuned so prompts appear immediately (no output buffering).
export function interactiveCommand(session) {
  let t = session.runCommandText();
  if (session.language === 'python') t = t.replace('python3 ', 'python3 -u ');
  if (session.language === 'c' || session.language === 'cpp') {
    t = t.replace(/(\.\/app|"\$ROOTDIR\/app")\s*$/, '$SB $1');
    t = 'SB=""; command -v stdbuf >/dev/null 2>&1 && SB="stdbuf -o0 -e0"\n' + t;
  }
  if (session.language === 'javascript') t = 'DRACO_PRELOAD="$PWD/draco_preload.js"\n' + t.replace(/ node (?=\S)/, ' node -r "$DRACO_PRELOAD" ');
  return t;
}

// NOTE: dd (not head -c) copies output: head buffers when writing to a file, which would hide prompts until exit.
export function runnerScript() {
  return [
    'ulimit -f 65536 2>/dev/null',
    ': > term.out; rm -f term.code',
    'exec 3< <(tail -n +1 -f stdin.txt 2>/dev/null)',
    'echo $! > tail.pid',
    `timeout -k 1 ${SESSION_SECONDS} bash i_cmd.sh <&3 2>&1 | dd bs=1 count=${MAX_TERM_BYTES} of=term.out status=none 2>/dev/null`,
    'echo ${PIPESTATUS[0]} > term.code',
    'kill $(cat tail.pid) 2>/dev/null',
    'exec 3<&-',
    '',
  ].join('\n');
}

// body: { language, code } or { language, files, entry }. Returns [json, httpStatus].
export async function startSession(language, source, stdin = '', options = {}) {
  if (!RUN_LANGUAGES.includes(language)) return [{ error: 'Unsupported language.' }, 400];
  if ((stdin || '').length > MAX_STDIN) return [{ error: 'Input is too large (100 KB max).' }, 413];
  const name = `draco-${randomUUID()}`;
  const base = options.factory || getFactory();
  const factory = () => base({ name, timeoutMs: (SESSION_SECONDS + 30) * 1000 });
  const packages = Array.isArray(options.packages) ? options.packages : [];
  let s;
  if (Array.isArray(source.files)) {
    const v = validateProject(language, source.files, source.entry);
    if (v.error) return [{ error: v.error }, 400];
    s = new ProjectSession(language, v, factory, packages);
  } else {
    if (typeof source.code !== 'string' || !source.code.trim()) return [{ error: 'No code submitted' }, 400];
    if (source.code.length > MAX_CODE) return [{ error: 'Code is too large (200 KB max).' }, 413];
    s = new RunSession(language, source.code, factory, packages);
  }
  let keep = false;
  try {
    await s.open();
    const c = await s.prepare();
    if (c && c.error) return [{ error: c.error }, 400];
    if (c && c.exitCode !== 0) {
      if (missingTool(c)) return [{ error: missingMessage(language) }, 503];
      return [{ ...compileFailure(c), done: true }, 200];
    }
    await s.sb.writeFiles([
      { path: `${ROOT}/i_cmd.sh`, content: Buffer.from(interactiveCommand(s) + '\n') },
      { path: `${ROOT}/i_run.sh`, content: Buffer.from(runnerScript()) },
      { path: `${ROOT}/draco_preload.js`, content: Buffer.from(NODE_PRELOAD) },
      { path: `${ROOT}/stdin.txt`, content: Buffer.from(stdin || '', 'utf8') },
      { path: `${ROOT}/term.out`, content: Buffer.alloc(0) },   // exists from the start, so "no files yet" can never look like "session ended"
    ]);
    await s.sb.runCommand({ cmd: 'bash', args: ['i_run.sh'], cwd: ROOT, detached: true });
    keep = true;
    return [{ session: signToken(name), maxSeconds: SESSION_SECONDS, compile: c ? { stdout: c.stdout, stderr: c.stderr, timeMs: c.timeMs } : null }, 200];
  } catch (e) {
    if (isCapacityError(e)) return [{ error: CAPACITY_MESSAGE, code: 'capacity' }, 503];
    return [{ error: `The sandbox service failed: ${e?.message || e}` }, 502];
  } finally {
    if (!keep) await s.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ENDED = { done: true, ended: true, chunk: '', error: 'This terminal session has ended.' };

async function read(sb, file) {
  try { const b = await sb.readFileToBuffer({ path: `${ROOT}/${file}` }); return b || null; } catch { return null; }
}
async function finish(sb) { try { await sb.stop(); } catch { /* already stopped */ } }

export async function pollSession(token, offset = 0, waitMs = 2000) {
  const name = verifyToken(token);
  if (!name) return [{ error: 'Invalid or expired terminal session.' }, 401];
  let sb;
  try { sb = await getSandbox(name); } catch { return [ENDED, 200]; }
  if (!sb) return [ENDED, 200];
  const from = Math.max(0, Number(offset) || 0), deadline = Date.now() + Math.max(0, Math.min(Number(waitMs) || 0, 3000));
  for (;;) {
    const codeBuf = await read(sb, 'term.code');            // read the exit status FIRST so the output below is complete
    const out = await read(sb, 'term.out');
    if (!out && !codeBuf) return [ENDED, 200];              // sandbox gone (timed out or stopped)
    const bytes = out || Buffer.alloc(0);
    const finished = !!codeBuf && codeBuf.toString().trim() !== '';
    if (bytes.length > from || finished || Date.now() >= deadline) {
      const body = { chunk: bytes.subarray(from).toString('base64'), offset: bytes.length, done: finished };
      if (finished) {
        const code = parseInt(codeBuf.toString().trim(), 10);
        body.timedOut = code === 124 || code === 137;
        body.exitCode = body.timedOut || Number.isNaN(code) ? null : code;
        body.truncated = bytes.length >= MAX_TERM_BYTES;
        await finish(sb);
      }
      return [body, 200];
    }
    await sleep(250);
  }
}

export async function sendInput(token, text) {
  const name = verifyToken(token);
  if (!name) return [{ error: 'Invalid or expired terminal session.' }, 401];
  if (typeof text !== 'string' || !text.length) return [{ error: 'Nothing to send.' }, 400];
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) return [{ error: 'That line is too long.' }, 413];
  let sb;
  try { sb = await getSandbox(name); } catch { return [ENDED, 200]; }
  if (!sb) return [ENDED, 200];
  const tmp = `in-${randomUUID()}.txt`;
  try {
    await sb.writeFiles([{ path: `${ROOT}/${tmp}`, content: Buffer.from(text, 'utf8') }]);
    const r = await sb.runCommand({ cmd: 'bash', args: ['-c', 'cat "$1" >> stdin.txt && rm -f "$1"', '_', tmp], cwd: ROOT });
    return [{ ok: r.exitCode === 0 }, 200];
  } catch { return [ENDED, 200]; }
}

async function control(token, script) {
  const name = verifyToken(token);
  if (!name) return [null, [{ error: 'Invalid or expired terminal session.' }, 401]];
  let sb;
  try { sb = await getSandbox(name); } catch { return [null, [ENDED, 200]]; }
  if (!sb) return [null, [ENDED, 200]];
  if (script) { try { await sb.runCommand({ cmd: 'bash', args: ['-c', script], cwd: ROOT }); } catch { /* best effort */ } }
  return [sb, null];
}
// Ctrl+D: the program sees end-of-input
export async function sendEof(token) {
  const [, err] = await control(token, 'kill $(cat tail.pid) 2>/dev/null; true');
  return err || [{ ok: true }, 200];
}
// Ctrl+C: stopping the sandbox ends the program and everything it started
export async function stopSession(token) {
  const [sb, err] = await control(token, 'kill $(cat tail.pid) 2>/dev/null; true');
  if (err) return err;
  await finish(sb);
  return [{ ok: true, stopped: true }, 200];
}
