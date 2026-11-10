// Using a newly added language / package: robust installs, real reasons, automatic compiler setup, package check endpoint.
import assert from 'node:assert/strict';
import { fakeFactory } from './fake-sandbox.mjs';
const R = await import('../lib/runner.js');
const I = await import('../lib/interactive.js');
const T = await import('../lib/toolchain.js');
const { default: handler } = await import('../api/index.js');
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  PASS ', name); } catch (e) { fail++; console.log('  FAIL ', name, '\n       ', String(e.stack || e.message).slice(0, 450)); } }

// Sandbox whose package managers are simulated. behaviours: set of flags.
function sim(flags = {}, log = { cmds: [], updates: [] }) {
  const f = async (o) => {
    const sb = await fakeFactory(o); const run = sb.runCommand.bind(sb);
    sb.update = async (p) => { log.updates.push(p.networkPolicy); };
    const res = (exitCode, stderr = '', stdout = '') => ({ exitCode, stderr: async () => stderr, stdout: async () => stdout });
    sb.runCommand = async (c) => {
      if (c.cmd === 'mkdir' || c.cmd === 'sed') return res(0);
      if (c.cmd === 'curl') { log.cmds.push('curl ' + c.args.join(' ')); if (/get-pip/.test(c.args.join(' '))) return res(flags.getpip === false ? 22 : 0); if (flags.noCurl) return res(127, 'curl: command not found'); return /bad/.test(c.args.join(' ')) ? res(22, 'curl: (22) The requested URL returned error: 404') : res(0); }
      if (c.cmd === 'timeout') {
        const [tool, ...args] = c.args.slice(3), joined = args.join(' '); log.cmds.push(`${tool} ${joined}`);
        if (tool === 'test') return res(flags.headers || log.installed ? 0 : 1);        // "is the library header present?"
        if (tool === 'python3' && /pip --version/.test(joined)) { log.pipChecks = (log.pipChecks || 0) + 1; return res(flags.pip === 'missing' || (flags.pip === 'after-ensurepip' && !log.ensured) || (flags.pip === 'after-getpip' && !log.gotpip) ? 1 : 0, 'No module named pip'); }
        if (tool === 'python3' && /ensurepip/.test(joined)) { log.ensured = flags.pip === 'after-ensurepip'; return res(flags.pip === 'after-ensurepip' ? 0 : 1, 'ensurepip is disabled in this build'); }
        if (tool === 'python3' && /get-pip/.test(joined)) { log.gotpip = true; return res(0); }
        if (tool === 'npm' && /--version/.test(joined)) return res(flags.npm === 'missing' ? 127 : 0, 'npm: command not found');
        if (/bad/.test(joined)) return res(1, tool === 'python3' ? 'ERROR: Could not find a version that satisfies the requirement badpkg (from versions: none)\nERROR: No matching distribution found for badpkg' : 'npm ERR! 404 Not Found - GET https://registry.npmjs.org/badthing');
        if (tool === 'bash') { log.script = joined; const code = flags.sysInstall === 'fail' ? 100 : flags.sysInstall === 'nopm' ? 90 : 0; if (code === 0) log.installed = true; return res(code, flags.sysInstall === 'fail' ? 'E: Unable to locate package libfoo' : ''); }
        return res(0);
      }
      return run(c);
    };
    return sb;
  };
  return f;
}
const py = (n) => ({ name: n, version: '' });

console.log('pip / npm availability');
await t('pip missing but bundled ensurepip works -> install proceeds, no warning', async () => {
  const log = { cmds: [], updates: [] }; const [r, s] = await R.execute('python', 'print("ok")', '', sim({ pip: 'after-ensurepip' }, log), { packages: [py('good')] });
  assert.equal(s, 200); assert.equal(r.stdout.trim(), 'ok'); assert.equal(r.warnings, undefined); assert.ok(log.cmds.some((c) => /ensurepip/.test(c)) && log.cmds.some((c) => /pip install/.test(c)));
});
await t('pip missing, ensurepip disabled -> official get-pip bootstrap is used (and its domain allowed only then)', async () => {
  const log = { cmds: [], updates: [] }; const [r] = await R.execute('python', 'print("ok")', '', sim({ pip: 'after-getpip' }, log), { packages: [py('good')] });
  assert.equal(r.exitCode, 0); assert.equal(r.warnings, undefined); assert.ok(log.updates.some((u) => u && u.allow && u.allow.includes('bootstrap.pypa.io')));
  assert.equal(log.updates.at(-1), 'deny-all');
});
await t('pip impossible to get -> clear message about the image, program still runs', async () => {
  const [r, s] = await R.execute('python', 'print("still")', '', sim({ pip: 'missing', getpip: false }), { packages: [py('good')] });
  assert.equal(s, 200); assert.equal(r.stdout.trim(), 'still'); assert.match(r.warnings[0], /pip is missing from the sandbox image/);
});
await t('npm missing is reported as such', async () => {
  const [r, s] = await R.execute('javascript', 'console.log("js")', '', sim({ npm: 'missing' }), { packages: [py('lodash')] });
  assert.equal(s, 200); assert.equal(r.stdout.trim(), 'js'); assert.match(r.warnings[0], /npm is missing/);
});
console.log('real failure reasons');
await t('Python: the actual pip error line is shown', async () => {
  const [r] = await R.execute('python', 'print(1)', '', sim(), { packages: [py('badpkg')] }); assert.match(r.warnings[0], /No matching distribution found for badpkg/);
});
await t('JavaScript: the npm 404 is shown', async () => {
  const [r] = await R.execute('javascript', 'console.log(1)', '', sim(), { packages: [py('badthing')] }); assert.match(r.warnings[0], /404 Not Found/);
});
await t('Java: unknown coordinates say "not found on Maven Central"; missing curl says so', async () => {
  const code = 'public class Main{public static void main(String[] a){System.out.println("j");}}';
  const [r] = await R.execute('java', code, '', sim(), { packages: [py('org.bad:lib:1.0')] }); assert.match(r.warnings[0], /not found on Maven Central/);
  const [r2] = await R.execute('java', code, '', sim({ noCurl: true }), { packages: [py('org.good:lib:1.0')] }); assert.match(r2.warnings[0], /curl is missing/);
});
console.log('C / C++ system libraries (apt AND dnf systems)');
await t('library already in the image/snapshot -> no download, no network opened', async () => {
  const log = { cmds: [], updates: [] }; const [r, s] = await R.execute('c', '#include <stdio.h>\nint main(){puts("c");}', '', sim({ headers: true }, log), { packages: [py('libsqlite3-dev')] });
  assert.equal(s, 200); assert.equal(r.warnings, undefined); assert.ok(!log.cmds.some((c) => /^bash /.test(c)), 'no install script ran');
});
await t('missing library -> one script that supports apt-get AND dnf with distro-specific names', async () => {
  const log = { cmds: [], updates: [] }; await R.execute('cpp', '#include <iostream>\nint main(){std::cout<<"x";}', '', sim({}, log), { packages: [py('libfmt-dev'), py('nlohmann-json3-dev')] });
  const sc = log.script || ''; assert.match(sc, /apt-get install -y --no-install-recommends libfmt-dev nlohmann-json3-dev/); assert.match(sc, /dnf install/); assert.match(sc, /fmt-devel/); assert.match(sc, /json-devel nlohmann-json-devel/);
  assert.ok(log.updates.some((u) => u && u.allow && u.allow.some((d) => /amazonaws|amazonlinux/.test(d)) && u.allow.some((d) => /ubuntu/.test(d))), 'both distro mirrors allowed');
});
await t('install failure reports the package manager error; image without a package manager says so', async () => {
  const [r] = await R.execute('c', '#include <stdio.h>\nint main(){puts("c");}', '', sim({ sysInstall: 'fail' }), { packages: [py('libssl-dev')] }); assert.match(r.warnings[0], /Unable to locate package/);
  const [r2] = await R.execute('c', '#include <stdio.h>\nint main(){puts("c");}', '', sim({ sysInstall: 'nopm' }), { packages: [py('libssl-dev')] }); assert.match(r2.warnings[0], /no package manager/);
});

console.log('first use of Java / C / C++: the compiler snapshot sets itself up');
const setupSandboxes = [];
function setupClient(state) {
  const calls = { find: 0, create: 0, started: 0 };
  const client = {
    calls,
    async findSnapshot() { calls.find++; return state.snapshot || null; },
    async getSandbox() { return state.sandbox || null; },
    async createSandbox() { calls.create++; if (state.createFails) throw new Error('sandbox quota'); const sb = await fakeFactory(); setupSandboxes.push(sb); state.sandbox = sb; const wf = sb.writeFiles.bind(sb); sb.writeFiles = wf; sb.runCommand = async () => { calls.started++; return {}; }; sb.delete = async () => {}; return sb; },
  };
  return client;
}
await t('no snapshot -> setup starts automatically and the user gets a clear "preparing" answer (503, code setup)', async () => {
  const client = setupClient({}); globalThis.__DRACO_SETUP_CLIENT = client; T.forgetSnapshot(); process.env.DRACO_REQUIRE_TOOLCHAIN = '1';
  const [r, s] = await R.execute('java', 'class Main{}', '', fakeFactory); assert.equal(s, 503); assert.equal(r.code, 'setup'); assert.match(r.error, /being prepared for the first time/); assert.equal(client.calls.create, 1); assert.equal(client.calls.started, 1);
  const [r2, s2] = await R.execute('cpp', 'int main(){}', '', fakeFactory); assert.equal(s2, 503); assert.equal(r2.code, 'setup'); assert.equal(client.calls.create, 1, 'setup is not started twice');
  const [rp] = await R.execute('python', 'print(1)', '', fakeFactory); assert.equal(rp.stdout.trim(), '1', 'Python/JavaScript never wait for setup');
});
await t('interactive terminals and projects get the same answer', async () => {
  const [r, s] = await I.startSession('c', { code: 'int main(){}' }, '', { factory: fakeFactory }); assert.equal(s, 503); assert.equal(r.code, 'setup');
  const [p, ps] = await R.executeProject('java', [{ path: 'Main.java', content: 'class Main{}' }], 'Main.java', '', fakeFactory); assert.equal(ps, 503); assert.equal(p.code, 'setup');
});
await t('snapshot exists -> runs normally (no setup, no message)', async () => {
  globalThis.__DRACO_SETUP_CLIENT = setupClient({ snapshot: 'snap_123' }); T.forgetSnapshot();
  const [r, s] = await R.execute('java', 'public class Main{public static void main(String[] a){System.out.println("ready");}}', '', fakeFactory); assert.equal(s, 200); assert.equal(r.stdout.trim(), 'ready');
});
await t('setup cannot be started -> falls back to the manual instruction with the reason', async () => {
  globalThis.__DRACO_SETUP_CLIENT = setupClient({ createFails: true }); T.forgetSnapshot();
  const [r, s] = await R.execute('c', 'int main(){}', '', fakeFactory); assert.equal(s, 503); assert.equal(r.code, 'setup-failed'); assert.match(r.error, /\/setup/);
});
delete process.env.DRACO_REQUIRE_TOOLCHAIN; delete globalThis.__DRACO_SETUP_CLIENT; T.forgetSnapshot();

console.log('package check');
await t('checkPackage: good, bad (with the reason), and unsupported language', async () => {
  const [ok] = await R.checkPackage('python', py('good'), sim()); assert.equal(ok.ok, true); assert.equal(ok.reason, null);
  const [bad] = await R.checkPackage('python', py('badpkg'), sim()); assert.equal(bad.ok, false); assert.match(bad.reason, /badpkg.*No matching distribution/);
  const [u, s] = await R.checkPackage('ruby', py('x'), sim()); assert.equal(s, 400);
});
async function call(path, body, headers = {}) {
  let status, out = ''; const res = { setHeader() {}, end(b) { out = b || ''; }, set statusCode(v) { status = v; }, get statusCode() { return status; } };
  await handler({ method: 'POST', url: path, headers: { 'x-forwarded-for': '6.6.6.' + Math.floor(Math.random() * 250), ...headers }, body }, res); return { status, json: out ? JSON.parse(out) : null };
}
function withEnv(langs, fn) { return async () => {
  const keys = ['VERCEL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'CODE_BACKEND_SHARED_SECRET', 'CODE_RATE_LIMIT_SECRET']; const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]])); const original = globalThis.fetch;
  Object.assign(process.env, { VERCEL: '1', SUPABASE_URL: 'https://gbeurqibcfvquacasofq.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_test_key', CODE_BACKEND_SHARED_SECRET: 'backend-test-secret-that-is-over-32-chars', CODE_RATE_LIMIT_SECRET: 'rate-test-secret-that-is-over-32-characters' });
  globalThis.fetch = async (url) => { const u = String(url); if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u' + Math.random(), email: 'a@b.c' }), { status: 200 }); if (u.includes('/draco_user_languages')) return new Response(JSON.stringify(langs.map((language) => ({ language }))), { status: 200 }); throw new Error('unexpected ' + u); };
  globalThis.__DRACO_SUPABASE_FETCH = async (url) => new Response(String(url).endsWith('code_consume_run') ? JSON.stringify([{ is_allowed: true, remaining_requests: 9 }]) : 'null', { status: 200 });
  globalThis.__DRACO_SANDBOX_FACTORY = sim();
  try { await fn(); } finally { globalThis.fetch = original; delete globalThis.__DRACO_SUPABASE_FETCH; delete globalThis.__DRACO_SANDBOX_FACTORY; for (const k of keys) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; } }
}; }
const auth = { authorization: 'Bearer valid.jwt.token' };
await t('POST /packages/check: guests refused, bad names refused, languages must be added', withEnv(['java'], async () => {
  assert.equal((await call('/packages/check', { language: 'python', name: 'six' })).status, 401);
  assert.equal((await call('/packages/check', { language: 'python', name: 'bad name; rm -rf /' }, auth)).status, 400);
  assert.equal((await call('/packages/check', { language: 'c', name: 'libssl-dev' }, auth)).status, 403, 'C is not on this account');
  assert.equal((await call('/packages/check', { language: 'ruby', name: 'x' }, auth)).status, 400);
}));
await t('POST /packages/check: a good and a bad package get a precise answer', withEnv(['java'], async () => {
  const g = await call('/packages/check', { language: 'python', name: 'good' }, auth); assert.equal(g.status, 200); assert.equal(g.json.ok, true);
  const b = await call('/packages/check', { language: 'python', name: 'badpkg' }, auth); assert.equal(b.status, 200); assert.equal(b.json.ok, false); assert.match(b.json.reason, /No matching distribution/);
  const j = await call('/packages/check', { language: 'java', name: 'org.good:lib:1.0' }, auth); assert.equal(j.json.ok, true);
}));
await t('no sandboxes leaked', async () => { for (const sb of setupSandboxes) await sb.stop(); const f = await import('./fake-sandbox.mjs'); await new Promise((r) => setTimeout(r, 300)); assert.equal(f.created, f.stopped); });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
