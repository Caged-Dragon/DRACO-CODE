// Draco Code (Vercel) — runs ONE program in a fresh Vercel Sandbox microVM.
//
// Every run gets its own microVM with all outbound network blocked ('deny-all'),
// is never persisted, and is stopped when finished. That is stronger isolation
// than the Python backend's process-level sandbox, and it is the reason this
// backend exists.
//
// The compilers live in a SNAPSHOT you create once (scripts/make-snapshot.mjs)
// and reference with DRACO_SNAPSHOT_ID. Without it, runs use Vercel's default
// image, and any missing toolchain is reported clearly instead of crashing.
import { Sandbox } from '@vercel/sandbox';
import { findSnapshotId, startSetup } from './toolchain.js';
import { validateProject, isSource, extOf, HEADER_EXT, javaMainClass } from './project.js';

export const RUN_LANGUAGES = ['python', 'javascript', 'java', 'c', 'cpp'];
export const LABELS = { python: 'Python', javascript: 'JavaScript', java: 'Java', c: 'C', cpp: 'C++' };
export const ROOT = '/vercel/sandbox';
// System libraries a C/C++ account can add. `header` proves the library is present; names differ per distribution.
export const SYSTEM_LIBS = {
  c: {
    'libsqlite3-dev': { header: '/usr/include/sqlite3.h', apt: 'libsqlite3-dev', dnf: ['sqlite-devel'] },
    'libssl-dev': { header: '/usr/include/openssl/ssl.h', apt: 'libssl-dev', dnf: ['openssl-devel'] },
    'libcurl4-openssl-dev': { header: '/usr/include/curl/curl.h', apt: 'libcurl4-openssl-dev', dnf: ['libcurl-devel'] },
  },
  cpp: {
    'nlohmann-json3-dev': { header: '/usr/include/nlohmann/json.hpp', apt: 'nlohmann-json3-dev', dnf: ['json-devel', 'nlohmann-json-devel'] },
    'libboost-dev': { header: '/usr/include/boost/version.hpp', apt: 'libboost-dev', dnf: ['boost-devel'] },
    'libeigen3-dev': { header: '/usr/include/eigen3/Eigen/Core', apt: 'libeigen3-dev', dnf: ['eigen3-devel'] },
    'libfmt-dev': { header: '/usr/include/fmt/core.h', apt: 'libfmt-dev', dnf: ['fmt-devel'] },
  },
};
const SYSTEM_PACKAGE_DOMAINS = ['*.ubuntu.com', 'archive.ubuntu.com', 'security.ubuntu.com', 'ports.ubuntu.com', 'packages.ubuntu.com', 'cdn.amazonlinux.com', '*.amazonlinux.com', '*.amazonaws.com'];
const INSTALL_BUDGET_MS = 60_000;          // all package installs for one run share this
const PACKAGE_SANDBOX_MS = 180_000;        // a sandbox that installs packages lives longer than the default 90 s
const MAX_OUT = 20_000;
const RUN_TIMEOUT = Number(process.env.SF_TIMEOUT || 5);
const COMPILE_TIMEOUT = Number(process.env.SF_COMPILE_TIMEOUT || 25);
export const MAX_CODE = 200_000;
export const MAX_STDIN = 100_000;

const JAVA_FLAGS = '-Xmx256m -Xss1m -XX:+UseSerialGC -XX:TieredStopAtLevel=1';

// Tests replace this to run against a local stand-in instead of real microVMs.
export async function defaultFactory(opts = {}) {
  const params = { timeout: opts.timeoutMs || 90_000, persistent: false, networkPolicy: 'deny-all', resources: { vcpus: 1 }, region: process.env.DRACO_SANDBOX_REGION || 'iad1' };
  const snapshotId = await findSnapshotId(); // env override, else the snapshot made by /setup
  if (opts.name) params.name = opts.name;
  if (snapshotId) params.source = { type: 'snapshot', snapshotId };
  return Sandbox.create(params);
}
export function getFactory() {
  return globalThis.__DRACO_SANDBOX_FACTORY || defaultFactory;
}

export function snippetFile(language, code) {
  if (language === 'java') {
    const m = /public\s+(?:final\s+|abstract\s+)*(?:class|interface|enum|record)\s+(\w+)/.exec(code);
    return { file: (m ? m[1] : 'Main') + '.java', cls: m ? m[1] : 'Main' };
  }
  return { file: { python: 'main.py', javascript: 'main.js', c: 'main.c', cpp: 'main.cpp' }[language] };
}

export class RunSession {
  constructor(language, code, factory = getFactory(), packages = []) {
    this.language = language;
    this.code = code;
    this.factory = factory;
    this.packages = Array.isArray(packages) ? packages : [];
    this.sb = null;
    const f = snippetFile(language, code);
    this.file = f.file;
    this.cls = f.cls;
  }

  async open() {
    this.sb = await this.factory(this.packages.length ? { timeoutMs: PACKAGE_SANDBOX_MS } : undefined);
    await this.sb.writeFiles([{ path: `${ROOT}/${this.file}`, content: Buffer.from(this.code, 'utf8') }]);
    await this.installPackages();
  }

  // Packages are best-effort: one that cannot be installed is reported as a warning (with the real reason)
  // and skipped, it never takes the whole run (or every later run of that language) down.
  async installPackages() {
    this.warnings = [];
    if (!this.packages.length) return;
    const sb = this.sb, language = this.language;
    const specs = this.packages.map((p) => ({ name: String(p.name || ''), version: String(p.version || '') }));
    const deadline = Date.now() + INSTALL_BUDGET_MS;
    const left = () => Math.max(1, Math.floor((deadline - Date.now()) / 1000));
    const warn = (name, reason) => this.warnings.push({ name, reason });
    const warnAll = (reason) => specs.forEach((p) => warn(p.name, reason));
    // `timeout` keeps any single install from eating the sandbox's whole lifetime
    const run = (cmd, args, perSec, extra = {}) => sb.runCommand({ cmd: 'timeout', args: ['-k', '2', String(Math.min(perSec, left())), cmd, ...args], ...extra });
    const ok = async (cmd, args, perSec, extra) => { try { return (await run(cmd, args, perSec, extra)).exitCode === 0; } catch { return false; } };
    const why = async (r, what = 'could not be installed') => {
      if (r.exitCode === 124 || r.exitCode === 137) return 'timed out while installing';
      if (r.exitCode === 127) return `${what}: a required tool is missing from the sandbox image`;
      const d = await commandDetail(r);
      return d ? `${what}: ${d}` : `${what} (check the name and version)`;
    };
    const allow = async (domains) => {
      try { await sb.update({ networkPolicy: { allow: domains } }); return true; }
      catch { warnAll('package installation is not available right now'); return false; }
    };
    const perPackage = async (base, spec, tool, perSec) => {
      const all = await run(tool, [...base, ...specs.map(spec)], 45);
      if (all.exitCode === 0) return;
      if (specs.length > 1 && left() > 8) {          // find the culprit, keep the good ones
        for (const p of specs) {
          if (left() <= 3) { warn(p.name, 'skipped: install time budget used up'); continue; }
          const one = await run(tool, [...base, spec(p)], perSec);
          if (one.exitCode !== 0) warn(p.name, await why(one));
        }
      } else warnAll(await why(all));
    };
    try {
      if (language === 'python') {
        if (await allow(['pypi.org', 'files.pythonhosted.org'])) {
          let pip = await ok('python3', ['-m', 'pip', '--version'], 10);
          if (!pip) { await ok('python3', ['-m', 'ensurepip', '--user'], 25); pip = await ok('python3', ['-m', 'pip', '--version'], 10); }   // bundled with Python
          if (!pip) {                                                                                                                      // last resort: the official bootstrap script
            try { await sb.update({ networkPolicy: { allow: ['pypi.org', 'files.pythonhosted.org', 'bootstrap.pypa.io'] } }); } catch { /* handled below */ }
            const dl = await sb.runCommand({ cmd: 'curl', args: ['-fsSL', '-m', '25', 'https://bootstrap.pypa.io/get-pip.py', '-o', `${ROOT}/get-pip.py`] });
            if (dl.exitCode === 0) await run('python3', [`${ROOT}/get-pip.py`, '--user', '--no-input', '--disable-pip-version-check'], 40);
            pip = await ok('python3', ['-m', 'pip', '--version'], 10);
          }
          if (!pip) warnAll('cannot be installed because pip is missing from the sandbox image (the one-time /setup adds it)');
          else {
            const base = ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-cache-dir', '--target', `${ROOT}/.draco-python`];
            await perPackage(base, (p) => p.name + (p.version ? '==' + p.version : ''), 'python3', 15);
          }
        }
      } else if (language === 'javascript') {
        if (await allow(['registry.npmjs.org'])) {
          if (!(await ok('npm', ['--version'], 10))) warnAll('cannot be installed because npm is missing from the sandbox image');
          else await perPackage(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', `${ROOT}/.draco-node`], (p) => p.name + (p.version ? '@' + p.version : ''), 'npm', 15);
        }
      } else if (language === 'java') {
        if (await allow(['repo.maven.apache.org'])) {
          await sb.runCommand({ cmd: 'mkdir', args: ['-p', `${ROOT}/.draco-java`] });
          for (const p of specs) {
            const [group, artifact, version] = p.name.split(':');
            if (!group || !artifact || !version || ![group, artifact, version].every((x) => /^[A-Za-z0-9_.-]+$/.test(x))) { warn(p.name, 'must use group:artifact:version coordinates'); continue; }
            if (left() <= 2) { warn(p.name, 'skipped: install time budget used up'); continue; }
            const url = `https://repo.maven.apache.org/maven2/${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}.jar`;
            const r = await sb.runCommand({ cmd: 'curl', args: ['-fsSL', '-m', String(Math.min(25, left())), url, '-o', `${ROOT}/.draco-java/${artifact}-${version}.jar`] });
            if (r.exitCode !== 0) warn(p.name, r.exitCode === 22 ? 'was not found on Maven Central (check the coordinates)' : r.exitCode === 127 ? 'could not be downloaded: curl is missing from the sandbox image' : await why(r, 'could not be downloaded'));
          }
        }
      } else if (language === 'c' || language === 'cpp') {
        const catalogue = SYSTEM_LIBS[language];
        const wanted = specs.filter((p) => catalogue[p.name]);
        specs.filter((p) => !catalogue[p.name]).forEach((p) => warn(p.name, 'is not in the supported system-library catalogue'));
        // already in the toolchain snapshot (or the base image)? then nothing to download
        const missing = [];
        for (const p of wanted) { if (!(await ok('test', ['-e', catalogue[p.name].header], 5))) missing.push(p); }
        if (missing.length && await allow(SYSTEM_PACKAGE_DOMAINS)) {
          const script = [
            'if command -v apt-get >/dev/null 2>&1; then',
            '  export DEBIAN_FRONTEND=noninteractive',
            "  [ -f /etc/apt/sources.list.d/ubuntu.sources ] && sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources",
            '  apt-get update -qq || exit $?',
            `  apt-get install -y --no-install-recommends ${missing.map((p) => catalogue[p.name].apt).join(' ')}`,
            'elif command -v dnf >/dev/null 2>&1; then',
            ...missing.map((p) => `  ok=1; for n in ${catalogue[p.name].dnf.join(' ')}; do dnf install -y "$n" && { ok=0; break; }; done; [ $ok -eq 0 ] || exit 1`),
            'else echo "no apt-get or dnf found in the sandbox image" >&2; exit 90; fi',
          ].join('\n');
          const r = await run('bash', ['-c', script], 55, { sudo: true });
          for (const p of missing) {
            if (r.exitCode === 0 && await ok('test', ['-e', catalogue[p.name].header], 5)) continue;
            warn(p.name, r.exitCode === 90 ? 'cannot be installed: this sandbox image has no package manager' : await why(r));
          }
        }
      }
    } finally {
      // Never run user code with network access: if closing the network fails, this must fail loudly.
      await sb.update({ networkPolicy: 'deny-all' });
    }
  }

  async close() {
    try { await this.sb?.stop(); } catch { /* already stopped / expired */ }
  }

  // One shell phase with a hard timeout and file-size limit. Output goes to files
  // (not memory) so a flooding program can't blow up this function.
  async phase(name, command, { timeoutSec, stdin = null }) {
    const sb = this.sb;
    const files = [{ path: `${ROOT}/${name}.sh`, content: Buffer.from(command + '\n') }];
    const redirect = stdin === null ? '< /dev/null' : '< stdin.txt';
    if (stdin !== null) files.push({ path: `${ROOT}/stdin.txt`, content: Buffer.from(stdin, 'utf8') });
    files.push({
      path: `${ROOT}/w_${name}.sh`,
      content: Buffer.from(
        `ulimit -f 65536 2>/dev/null\n` +
        `timeout -k 1 ${timeoutSec} bash ${name}.sh ${redirect} > ${name}.out 2> ${name}.err\n` +
        `echo $? > ${name}.code\n`),
    });
    await sb.writeFiles(files);
    const t0 = Date.now();
    await sb.runCommand({ cmd: 'bash', args: [`w_${name}.sh`], cwd: ROOT });
    const ms = Date.now() - t0;
    const read = async (ext) => {
      const b = await sb.readFileToBuffer({ path: `${ROOT}/${name}.${ext}` });
      return b ? b.toString('utf8') : '';
    };
    const [out, err, codeTxt] = await Promise.all([read('out'), read('err'), read('code')]);
    let code = parseInt(codeTxt.trim(), 10);
    if (Number.isNaN(code)) code = null;
    const timedOut = code === 124 || (code === 137 && ms >= timeoutSec * 1000);
    return {
      stdout: out.slice(0, MAX_OUT),
      stderr: timedOut ? `${err.slice(0, MAX_OUT)}${err ? '\n' : ''}Execution timed out after ${timeoutSec}s` : err.slice(0, MAX_OUT),
      exitCode: timedOut ? null : code,
      timeMs: ms,
      timedOut,
      truncated: out.length > MAX_OUT || err.length > MAX_OUT,
    };
  }

  // Compile step (Java/C/C++). Returns null for interpreted languages, or the compile phase result.
  async prepare() {
    const l = this.language;
    if (l === 'java') {
      if (!/^[A-Za-z_]\w*$/.test(this.cls)) return { error: 'Invalid Java class name.' };
      return this.phase('compile', `mkdir -p build && javac -nowarn -encoding UTF-8 -J-Xmx256m -J-XX:+UseSerialGC -cp '.draco-java/*' -d build ${this.file}`, { timeoutSec: COMPILE_TIMEOUT });
    }
    if (l === 'c') { const flags=[]; const names=this.packages.map(p=>p.name); if(names.includes('libsqlite3-dev'))flags.push('-lsqlite3'); if(names.includes('libssl-dev'))flags.push('-lssl','-lcrypto'); if(names.includes('libcurl4-openssl-dev'))flags.push('-lcurl'); return this.phase('compile', `gcc -std=gnu17 -O1 -Wall -pipe -o app ${this.file} -lm -lpthread ${flags.join(' ')}`, { timeoutSec: COMPILE_TIMEOUT }); }
    if (l === 'cpp') { const flags=[]; const names=this.packages.map(p=>p.name); if(names.includes('libfmt-dev'))flags.push('-lfmt'); if(names.includes('libeigen3-dev'))flags.push('-I/usr/include/eigen3'); return this.phase('compile', `g++ -std=gnu++17 -O1 -Wall -pipe -o app ${this.file} -lm -lpthread ${flags.join(' ')}`, { timeoutSec: COMPILE_TIMEOUT }); }
    return null;
  }

  runCommandText() {
    switch (this.language) {
      case 'python': return `PYTHONPATH=${ROOT}/.draco-python:${'${PYTHONPATH:-}'} python3 ${this.file}`;
      case 'javascript': return `NODE_PATH=${ROOT}/.draco-node/node_modules:${'${NODE_PATH:-}'} node ${this.file}`;
      case 'java': return `java ${JAVA_FLAGS} -cp 'build:.draco-java/*' ${this.cls}`;
      default: return './app';
    }
  }

  run(stdin) {
    return this.phase('run', this.runCommandText(), { timeoutSec: RUN_TIMEOUT, stdin: stdin || '' });
  }
}

// bash reports a missing program as exit 127 + 'not found'; require both so a user program that merely exits 127 isn't misreported.
export const missingTool = (r) => r.exitCode === 127 && /not found/i.test(r.stderr || '');

export function setupUrl() {
  const configured = String(process.env.DRACO_BACKEND_URL || '').trim();
  const deploymentHost = String(process.env.VERCEL_URL || '').trim();
  const host = configured || (deploymentHost ? `https://${deploymentHost}` : 'https://draco-code-backend.vercel.app');
  try {
    const url = new URL(host.includes('://') ? host : `https://${host}`);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid backend URL');
    return `${url.origin}/setup`;
  } catch {
    return 'https://draco-code-backend.vercel.app/setup';
  }
}

export function missingMessage(language) {
  return `${LABELS[language]} isn't installed in the sandbox image yet. One-time fix: open ${setupUrl()} in your browser and click "Start setup". ` +
         `It takes a few minutes; Python and JavaScript work in the meantime.`;
}

export function compileFailure(c) {
  return {
    stdout: '', stderr: c.stderr || c.stdout || 'Compilation failed.', exitCode: c.exitCode ?? 1,
    timeMs: c.timeMs, timedOut: false, truncated: c.truncated,
    compile: { stdout: c.stdout, stderr: c.stderr, exitCode: c.exitCode, timeMs: c.timeMs },
    compileError: true,
  };
}

// Single snippet. Returns [result, httpStatus].
// "Package X could not be installed" lines, shown to the user ahead of the program's own output.
export function packageWarnings(session) {
  return (session.warnings || []).map((w) => `Package ${w.name}: ${w.reason}. It was skipped. Remove it in Menu > Languages and packages if you don't need it.`);
}
function withWarnings(result, session) {
  const w = packageWarnings(session);
  if (!w.length || !result || result.error) return result;
  return { ...result, warnings: w, stderr: w.join('\n') + '\n' + (result.stderr || '') };
}

export async function execute(language, code, stdin = '', factory = getFactory(), options = {}) {
  { const need = await toolchainGuard(language, factory); if (need) return need; }
  if (!RUN_LANGUAGES.includes(language)) return [{ error: `Unsupported language: ${language}. Supported: ${RUN_LANGUAGES.join(', ')}.` }, 400];
  if (typeof code !== 'string' || !code.trim()) return [{ error: 'No code submitted' }, 400];
  if (code.length > MAX_CODE) return [{ error: 'Code is too large (200 KB max).' }, 413];
  if ((stdin || '').length > MAX_STDIN) return [{ error: 'Input is too large (100 KB max).' }, 413];

  const packages = Array.isArray(options.packages) ? options.packages : [];
  const s = new RunSession(language, code, factory, packages);
  try {
    await s.open();
    const c = await s.prepare();
    if (c && c.error) return [{ error: c.error }, 400];
    if (c && c.exitCode !== 0) {
      if (missingTool(c)) return [{ error: missingMessage(language) }, 503];
      return [withWarnings(compileFailure(c), s), 200];
    }
    const r = await s.run(stdin);
    if (missingTool(r)) return [{ error: missingMessage(language) }, 503];
    r.compile = c ? { stdout: c.stdout, stderr: c.stderr, exitCode: c.exitCode, timeMs: c.timeMs } : null;
    r.compileError = false;
    return [withWarnings(r, s), 200];
  } catch (e) {
    if (isCapacityError(e)) return [{ error: CAPACITY_MESSAGE, code: 'capacity' }, 503];
    if (isTimeoutError(e)) return [{ error: TIMEOUT_MESSAGE, code: 'timeout' }, 504];
    return [{ error: `The sandbox service failed: ${e?.message || e}` }, 502];
  } finally {
    await s.close();
  }
}


// Multi-file project run (Project mode). Files live in ROOT/proj so user file names can never
// collide with the runner's own scripts (run.sh, app, build/, ...). Paths were validated by
// validateProject(), and source lists are passed through @argfiles, never interpolated into shell.
export class ProjectSession extends RunSession {
  constructor(language, project, factory = getFactory(), packages = []) {
    super(language, '', factory, packages);
    this.project = project;
    this.entry = project.entry;
    this.cls = language === 'java' ? javaMainClass(project.entry, project.files.find((f) => f.path === project.entry).content) : undefined;
  }
  async open() {
    this.sb = await this.factory(this.packages.length ? { timeoutMs: PACKAGE_SANDBOX_MS } : undefined);
    const sources = this.project.files.filter((f) => isSource(this.language, f.path)).map((f) => f.path);
    const files = this.project.files.map((f) => ({ path: `${ROOT}/proj/${f.path}`, content: Buffer.from(f.content, 'utf8') }));
    files.push({ path: `${ROOT}/sources.txt`, content: Buffer.from(sources.join('\n') + '\n', 'utf8') });
    await this.sb.writeFiles(files);
    await this.installPackages();
  }
  async prepare() {
    const l = this.language, names = this.packages.map((p) => p.name);
    const head = 'ROOTDIR="$PWD"\ncd proj || exit 1\n';
    if (l === 'java') {
      if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(this.cls)) return { error: 'Invalid Java class name.' };
      return this.phase('compile', `${head}mkdir -p "$ROOTDIR/build" && javac -nowarn -encoding UTF-8 -J-Xmx256m -J-XX:+UseSerialGC -cp "$ROOTDIR/.draco-java/*" -d "$ROOTDIR/build" @"$ROOTDIR/sources.txt"`, { timeoutSec: COMPILE_TIMEOUT });
    }
    if (l === 'c' || l === 'cpp') {
      const dirs = [...new Set(this.project.files.filter((f) => HEADER_EXT.includes(extOf(f.path))).map((f) => f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.'))];
      const inc = ['.', ...dirs.filter((d) => d !== '.')].map((d) => `-I${d}`).join(' ');
      const flags = [];
      if (l === 'c') { if (names.includes('libsqlite3-dev')) flags.push('-lsqlite3'); if (names.includes('libssl-dev')) flags.push('-lssl', '-lcrypto'); if (names.includes('libcurl4-openssl-dev')) flags.push('-lcurl'); }
      else { if (names.includes('libfmt-dev')) flags.push('-lfmt'); if (names.includes('libeigen3-dev')) flags.push('-I/usr/include/eigen3'); }
      const cc = l === 'c' ? 'gcc -std=gnu17' : 'g++ -std=gnu++17';
      return this.phase('compile', `${head}${cc} -O1 -Wall -pipe ${inc} -o "$ROOTDIR/app" @"$ROOTDIR/sources.txt" -lm -lpthread ${flags.join(' ')}`, { timeoutSec: COMPILE_TIMEOUT });
    }
    return null;
  }
  runCommandText() {
    const head = 'ROOTDIR="$PWD"\ncd proj || exit 1\n';
    const e = this.entry;
    switch (this.language) {
      case 'python': return `${head}PYTHONPATH="$PWD:$ROOTDIR/.draco-python:\${PYTHONPATH:-}" python3 "${e}"`;
      case 'javascript': return `${head}NODE_PATH="$PWD:$ROOTDIR/.draco-node/node_modules:\${NODE_PATH:-}" node "${e}"`;
      case 'java': return `${head}java ${JAVA_FLAGS} -cp "$ROOTDIR/build:$ROOTDIR/.draco-java/*" ${this.cls}`;
      default: return `${head}"$ROOTDIR/app"`;
    }
  }
}

// Whole project. Returns [result, httpStatus].
export async function executeProject(language, files, entry, stdin = '', factory = getFactory(), options = {}) {
  { const need = await toolchainGuard(language, factory); if (need) return need; }
  const v = validateProject(language, files, entry);
  if (v.error) return [{ error: v.error }, 400];
  if ((stdin || '').length > MAX_STDIN) return [{ error: 'Input is too large (100 KB max).' }, 413];
  const s = new ProjectSession(language, v, factory, Array.isArray(options.packages) ? options.packages : []);
  try {
    await s.open();
    const c = await s.prepare();
    if (c && c.error) return [{ error: c.error }, 400];
    if (c && c.exitCode !== 0) {
      if (missingTool(c)) return [{ error: missingMessage(language) }, 503];
      return [withWarnings(compileFailure(c), s), 200];
    }
    const r = await s.run(stdin);
    if (missingTool(r)) return [{ error: missingMessage(language) }, 503];
    r.compile = c ? { stdout: c.stdout, stderr: c.stderr, exitCode: c.exitCode, timeMs: c.timeMs } : null;
    r.compileError = false; r.entry = entry;
    return [withWarnings(r, s), 200];
  } catch (e) {
    if (isCapacityError(e)) return [{ error: CAPACITY_MESSAGE, code: 'capacity' }, 503];
    if (isTimeoutError(e)) return [{ error: TIMEOUT_MESSAGE, code: 'timeout' }, 504];
    return [{ error: `The sandbox service failed: ${e?.message || e}` }, 502];
  } finally {
    await s.close();
  }
}

// The most telling line of a failed command's error output ("No matching distribution found for x").
export async function commandDetail(r) {
  try {
    const raw = typeof r.stderr === 'function' ? await r.stderr() : (r.stderr || '');
    const out = typeof r.stdout === 'function' ? await r.stdout() : (r.stdout || '');
    const lines = `${raw}\n${out}`.split('\n').map((l) => l.trim()).filter(Boolean);
    // most informative first: "No matching distribution found for x" beats a generic "ERROR: ..."
    const tiers = [/no matching distribution|404|not found on|unable to locate|no package .* available|could not find a version/i, /could not|not found|failed|denied|resolve|unavailable/i, /error/i];
    let pick = '';
    for (const re of tiers) { pick = [...lines].reverse().find((l) => re.test(l)) || ''; if (pick) break; }
    pick = pick || lines[lines.length - 1] || '';
    return pick.replace(/\s+/g, ' ').slice(0, 160);
  } catch { return ''; }
}

// ---- Java / C / C++ need the compiler snapshot. Without it: start the one-time setup by itself and say so. ----
const NEEDS_TOOLCHAIN = new Set(['java', 'c', 'cpp']);
export async function toolchainGuard(language, factory = getFactory()) {
  if (!NEEDS_TOOLCHAIN.has(language)) return null;
  if (!(process.env.DRACO_REQUIRE_TOOLCHAIN === '1' || factory === defaultFactory)) return null;   // custom/test sandboxes bring their own toolchain
  let id = null; try { id = await findSnapshotId(); } catch { id = null; }
  if (id) return null;
  let started; try { started = await startSetup(); } catch (e) { started = { state: 'failed', message: String(e?.message || e) }; }
  if (started.state === 'done') return null;                                   // the snapshot appeared meanwhile
  if (started.state === 'failed') return [{ error: missingMessage(language), code: 'setup-failed', detail: started.message }, 503];
  return [{ error: `${LABELS[language]} is being prepared for the first time. This one-time step starts automatically and takes about 5 minutes. Keep this page open: it will start your program as soon as ${LABELS[language]} is ready.`, code: 'setup', state: started.state }, 503];
}

export const CAPACITY_MESSAGE = 'This site has used up its free run allowance for now. Please try again later.';
// The SDK's exact error shape for "over quota" is not documented in what I could verify, so match on the HTTP status
// when present and on the wording otherwise. A wrong guess only means a less friendly message, never a wrong result.
export function isCapacityError(e) {
  const status = e?.status ?? e?.statusCode ?? e?.response?.status;
  if (status === 429 || status === 402) return true;
  // Deliberately strict: words like "exceeded" also appear in ordinary timeout errors, which are NOT an allowance problem.
  return /rate.?limit|too many requests|usage limit|quota|payment required|insufficient (?:credits|funds)|\b429\b|\b402\b/i.test(String(e?.message || e));
}
export function isTimeoutError(e) {
  return e?.name === 'TimeoutError' || /time(?:d)?[ -]?out|timeout|deadline|exceeded .*(?:duration|time)|sandbox (?:has )?(?:stopped|expired)/i.test(String(e?.message || e));
}
export const TIMEOUT_MESSAGE = 'The sandbox ran out of time. Installing packages can be slow: remove heavy packages from your account (Menu > Languages and packages) or try again.';


// Try installing ONE package exactly like a run would, and report precisely what happened.
export async function checkPackage(language, pkg, factory = getFactory()) {
  if (!RUN_LANGUAGES.includes(language)) return [{ ok: false, reason: 'Unsupported language.' }, 400];
  { const need = await toolchainGuard(language, factory); if (need) return [{ ok: false, pending: true, reason: need[0].error, code: need[0].code }, 200]; }
  const t0 = Date.now();
  const s = new RunSession(language, 'x', factory, [{ name: pkg.name, version: pkg.version || '' }]);
  try {
    await s.open();
    const w = s.warnings || [];
    return [{ ok: w.length === 0, reason: w[0] ? `${w[0].name} ${w[0].reason}` : null, ms: Date.now() - t0 }, 200];
  } catch (e) {
    if (isCapacityError(e)) return [{ ok: false, error: true, reason: CAPACITY_MESSAGE }, 503];
    if (isTimeoutError(e)) return [{ ok: false, error: true, reason: TIMEOUT_MESSAGE }, 504];
    return [{ ok: false, error: true, reason: `The sandbox service failed: ${e?.message || e}` }, 502];
  } finally {
    await s.close();
  }
}
