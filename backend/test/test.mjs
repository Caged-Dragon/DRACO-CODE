import assert from 'node:assert/strict';
import { fakeFactory, created, stopped, makeFakeSetupClient } from './fake-sandbox.mjs';
globalThis.__DRACO_SANDBOX_FACTORY = fakeFactory;
const { execute } = await import('../lib/runner.js');
const { default: handler } = await import('../api/index.js');
const tc = await import('../lib/toolchain.js');
const sc = await import('../lib/selfcheck.js');
const st = await import('../lib/status.js');
const fake = await import('./fake-sandbox.mjs');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n       ', String(e.message).slice(0, 300)); }
}
async function call(method, url, body, headers = {}) {
  let status, out = ''; const hdr = {};
  const res = { setHeader(k, v) { hdr[k.toLowerCase()] = v; }, end(b) { out = b || ''; }, set statusCode(v) { status = v; }, get statusCode() { return status; } };
  await handler({ method, url, headers: { 'x-forwarded-for': '9.9.9.' + Math.floor(Math.random() * 250), ...headers }, body }, res);
  let json = null; try { json = out ? JSON.parse(out) : null; } catch { /* html page */ }
  return { status, json, headers: hdr, raw: out };
}

console.log('execute: all five languages');
const progs = {
  python: 'a,b=map(int,input().split())\nprint(a+b)',
  javascript: "const [a,b]=require('fs').readFileSync(0,'utf8').trim().split(' ').map(Number);console.log(a+b)",
  java: 'import java.util.*;\npublic class Hello { public static void main(String[] x){ Scanner s=new Scanner(System.in); System.out.println(s.nextInt()+s.nextInt()); } }',
  c: '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}',
  cpp: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;}',
};
for (const [lang, code] of Object.entries(progs)) {
  await t(`${lang} runs with stdin`, async () => {
    const [r, s] = await execute(lang, code, '2 3');
    assert.equal(s, 200, JSON.stringify(r)); assert.equal(r.stdout.trim(), '5'); assert.equal(r.exitCode, 0); assert.equal(r.compileError, false);
  });
}
console.log('failure modes');
await t('C compile error flagged', async () => {
  const [r, s] = await execute('c', 'int main(){ oops }');
  assert.equal(s, 200); assert.equal(r.compileError, true); assert.match(r.stderr, /error/);
});
await t('Java compile error flagged', async () => {
  const [r] = await execute('java', 'public class Main { void x( }');
  assert.equal(r.compileError, true);
});
await t('infinite loop times out', async () => {
  const [r] = await execute('python', 'while True: pass');
  assert.equal(r.timedOut, true); assert.equal(r.exitCode, null); assert.match(r.stderr, /timed out/);
});
await t('runtime error keeps stderr + exit code', async () => {
  const [r] = await execute('python', 'raise ValueError("boom")');
  assert.notEqual(r.exitCode, 0); assert.match(r.stderr, /boom/);
});
await t('C segfault has non-zero exit code', async () => {
  const [r] = await execute('c', 'int main(){int*p=0;*p=1;}');
  assert.ok(r.exitCode !== 0);
});
await t('output flood is capped', async () => {
  const [r] = await execute('python', "print('x'*5_000_000)");
  assert.ok(r.stdout.length <= 20000); assert.equal(r.truncated, true);
});
await t('bad language / empty / oversized input rejected', async () => {
  assert.equal((await execute('ruby', 'puts 1'))[1], 400);
  assert.equal((await execute('python', '  '))[1], 400);
  assert.equal((await execute('python', 'x'.repeat(200_001)))[1], 413);
});
await t('Java class name with shell metacharacters cannot inject', async () => {
  const [r, s] = await execute('java', 'public class A$(touch pwned) { }');
  assert.ok(s === 200 || s === 400); // either rejected or a plain compile error -- never executed
});
await t('every sandbox is stopped (no leaks)', async () => {
  const { created: c, stopped: st } = await import('./fake-sandbox.mjs');
  assert.equal(c, st, `created ${c}, stopped ${st}`);
});

console.log('HTTP handler');
await t('GET /health', async () => { const r = await call('GET', '/health'); assert.equal(r.status, 200); assert.equal(r.json.status, 'ok'); });
await t('rewrite form /api/index?path=... routes correctly', async () => {
  assert.equal((await call('GET', '/api/index?path=health')).json.status, 'ok');
  assert.equal((await call('GET', '/api/index?path=sandboxes')).status, 200);
  assert.equal((await call('GET', '/api/index?path=problems')).status, 404);   // removed feature stays removed
  assert.equal((await call('GET', '/api/index?path=')).status, 404);
});
await t('POST /execute works', async () => { const r = await call('POST', '/execute', { language: 'python', code: 'print(6*7)' }); assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.stdout.trim(), '42', JSON.stringify(r.json)); });
await t('GET /sandboxes reports exactly the five languages', async () => {
  const r = await call('GET', '/sandboxes');
  assert.equal(r.status, 200);
  const ids = r.json.sandboxes.map((s) => s.id);
  assert.deepEqual(ids, ['python', 'javascript', 'java', 'c', 'cpp']);
});
await t('removed features answer 404 (no accounts, problems, terminal, certificates)', async () => {
  for (const [m, p] of [['GET', '/problems'], ['POST', '/submit'], ['POST', '/auth/login'], ['GET', '/projects'], ['POST', '/terminal'], ['GET', '/certificates/mine']]) {
    assert.equal((await call(m, p, {})).status, 404, p);
  }
});
await t('bad JSON body -> 400; unknown path -> 404', async () => {
  assert.equal((await call('POST', '/execute', 'not json')).status, 400);
  assert.equal((await call('GET', '/nope')).status, 404);
});

console.log('one-time toolchain setup (/setup)');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OK_INSTALL = 'mkdir -p .draco\nsleep 1\necho "toolchains present" > .draco/install.log\necho 0 > .draco/install.code\n';
await t('idle before start, then installing, then done with a snapshot id', async () => {
  const c = makeFakeSetupClient(); tc.forgetSnapshot();
  assert.equal((await tc.setupStatus(c)).state, 'idle');
  const s1 = await tc.startSetup(c, { installScript: OK_INSTALL });
  assert.equal(s1.state, 'installing');
  assert.equal((await tc.setupStatus(c)).state, 'installing');     // install.sh still running
  let s; for (let i = 0; i < 40; i++) { await wait(500); s = await tc.setupStatus(c); if (s.state === 'done') break; }
  assert.equal(s.state, 'done', JSON.stringify(s));                 // smoke tests ran the real compilers, then snapshot
  assert.equal(s.snapshotId, 'snap_fake1234567890');
});
await t('after setup, runs discover the snapshot automatically (no env var)', async () => {
  const c = makeFakeSetupClient(); tc.forgetSnapshot(); globalThis.__DRACO_SETUP_CLIENT = c;
  assert.equal(await tc.findSnapshotId(), null);
  c.st.snap = 'snap_abc'; tc.forgetSnapshot();
  assert.equal(await tc.findSnapshotId(), 'snap_abc');
  process.env.DRACO_SNAPSHOT_ID = 'snap_override'; assert.equal(await tc.findSnapshotId(), 'snap_override'); delete process.env.DRACO_SNAPSHOT_ID;
  delete globalThis.__DRACO_SETUP_CLIENT; tc.forgetSnapshot();
});
await t('start when already set up does not create another sandbox', async () => {
  const c = makeFakeSetupClient(); c.st.snap = 'snap_x'; tc.forgetSnapshot();
  const r = await tc.startSetup(c, { installScript: OK_INSTALL });
  assert.equal(r.state, 'done'); assert.equal(c.st.creates, 0);
});
await t('failed install reports failed + log', async () => {
  const c = makeFakeSetupClient(); tc.forgetSnapshot();
  await tc.startSetup(c, { installScript: 'mkdir -p .draco\necho "E: no space left" > .draco/install.log\necho 100 > .draco/install.code\n' });
  let s; for (let i = 0; i < 20; i++) { await wait(400); s = await tc.setupStatus(c); if (s.state === 'failed') break; }
  assert.equal(s.state, 'failed'); assert.match(s.log, /no space left/); assert.equal(c.st.snap, null);
});
await t('GET /setup serves the HTML page; /setup/status answers JSON', async () => {
  globalThis.__DRACO_SETUP_CLIENT = makeFakeSetupClient(); tc.forgetSnapshot();
  let status, body = '', ct;
  await handler({ method: 'GET', url: '/api/index?path=setup', headers: {} }, { setHeader(k, v) { if (k === 'Content-Type') ct = v; }, end(b) { body = b; }, set statusCode(v) { status = v; }, get statusCode() { return status; } });
  assert.equal(status, 200); assert.match(ct, /text\/html/); assert.match(body, /Start setup/);
  const r = await call('GET', '/setup/status'); assert.equal(r.status, 200); assert.equal(r.json.state, 'idle');
  delete globalThis.__DRACO_SETUP_CLIENT; tc.forgetSnapshot();
});
await t('the "not installed" message tells the user exactly what to open', async () => {
  const { setupUrl } = await import('../lib/runner.js');
  const priorHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const priorEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'stale-project-host.invalid';
  assert.equal(setupUrl(), 'https://draco-code-backend.vercel.app/setup');
  if (priorHost === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL; else process.env.VERCEL_PROJECT_PRODUCTION_URL = priorHost;
  if (priorEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = priorEnv;
});

console.log('the /setup page itself');
await t('inline page script is valid JavaScript (and survives the template string)', async () => {
  const html = tc.setupPage('');
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'no inline script found');
  assert.doesNotThrow(() => new Function(m[1]), 'page script has a syntax error');
});

console.log('live self-check');
await t('self-check: all five languages really compute n*n+7 from a fresh random input', async () => {
  globalThis.__DRACO_SETUP_CLIENT = makeFakeSetupClient(); tc.forgetSnapshot();
  const r = await sc.selfCheck(fakeFactory);
  delete globalThis.__DRACO_SETUP_CLIENT; tc.forgetSnapshot();
  assert.equal(r.ok, true, JSON.stringify(r.results.filter((x) => !x.verified)));
  assert.equal(r.results.length, 5);
  for (const x of r.results) { assert.equal(x.verified, true, x.language); assert.ok(x.version.length > 3, x.language + ' version'); }
  assert.equal(r.expectedFormula, 'n*n+7');
  assert.equal(r.results[0].expected, String(BigInt(r.input) * BigInt(r.input) + 7n));
  assert.equal(typeof r.networkBlocked === 'boolean' || r.networkBlocked === null, true);
});
await t('verifyOutput unit cases', async () => {
  assert.deepEqual(sc.verifyOutput('49', '49\nPython 3.12.3\n'), { verified: true, actual: '49', version: 'Python 3.12.3' });
  assert.equal(sc.verifyOutput('49', '50\nx').verified, false);
  assert.equal(sc.verifyOutput('49', '').verified, false);
});
await t('default /sandboxes creates NO sandbox (page loads cost nothing)', async () => {
  st.forgetVersions(); tc.forgetSnapshot(); globalThis.__DRACO_SETUP_CLIENT = makeFakeSetupClient();
  const before = fake.created;
  const r = await call('GET', '/sandboxes');
  assert.equal(fake.created, before, 'a sandbox was created just to answer /sandboxes');
  const by = Object.fromEntries(r.json.sandboxes.map((x) => [x.id, x]));
  assert.equal(by.python.available, true); assert.equal(by.javascript.available, true);
  assert.equal(by.java.available, false); assert.equal(by.c.available, false);   // no snapshot yet
  assert.equal(by.python.verified, false); assert.equal(r.json.isolation.inferred, true);
  delete globalThis.__DRACO_SETUP_CLIENT; tc.forgetSnapshot();
});
await t('with the setup snapshot, all five are reported ready (still without creating a sandbox)', async () => {
  st.forgetVersions(); const c = makeFakeSetupClient(); c.st.snap = 'snap_ok'; globalThis.__DRACO_SETUP_CLIENT = c; tc.forgetSnapshot();
  const before = fake.created;
  const r = await call('GET', '/sandboxes');
  assert.equal(fake.created, before);
  assert.ok(r.json.sandboxes.every((x) => x.available));
  assert.equal(r.json.isolation.snapshot, true);
  delete globalThis.__DRACO_SETUP_CLIENT; tc.forgetSnapshot();
});
await t('?probe=1 really measures (one sandbox) and returns verified versions', async () => {
  st.forgetVersions(); const before = fake.created;
  const r = await call('GET', '/api/index?path=sandboxes&probe=1');
  assert.equal(fake.created, before + 1);
  assert.ok(r.json.sandboxes.every((x) => x.verified && x.available && x.version));
  const again = await call('GET', '/sandboxes');                 // cached for 15 minutes
  assert.equal(fake.created, before + 1); assert.ok(again.json.sandboxes[0].version);
});
const SITE = 'https://draco-code.vercel.app';
await t('default CORS allows the official frontend, approved Vercel previews, and rejects unrelated sites', async () => {
  delete process.env.ALLOWED_ORIGINS;
  const official = await call('GET', '/health', undefined, { origin: SITE });
  assert.equal(official.status, 200); assert.equal(official.headers['access-control-allow-origin'], SITE);
  for (const previewOrigin of [
    'https://draco-code-frontend-git-codex-feature-caged-dragon.vercel.app',
    'https://dracoskill-frontend-feature-test-caged-dragon.vercel.app'
  ]) {
    const preview = await call('GET', '/health', undefined, { origin: previewOrigin });
    assert.equal(preview.status, 200); assert.equal(preview.headers['access-control-allow-origin'], previewOrigin);
  }
  const refused = await call('POST', '/execute', { language: 'python', code: 'print(1)' }, { origin: 'https://anything.example' });
  assert.equal(refused.status, 403); assert.equal(refused.headers['access-control-allow-origin'], undefined);
});
await t('with ALLOWED_ORIGINS: your site works and is echoed back (not *)', async () => {
  process.env.ALLOWED_ORIGINS = SITE + ',http://localhost:8000';
  const r = await call('POST', '/execute', { language: 'python', code: 'print(7)' }, { origin: SITE });
  assert.equal(r.status, 200); assert.equal(r.headers['access-control-allow-origin'], SITE); assert.equal(r.headers['vary'], 'Origin');
});
await t('with ALLOWED_ORIGINS: another website is refused BEFORE any sandbox is created', async () => {
  process.env.ALLOWED_ORIGINS = SITE; const before = fake.created;
  for (const [m, p, b] of [['POST', '/execute', { language: 'python', code: 'print(1)' }], ['GET', '/selfcheck'], ['GET', '/api/index?path=sandboxes&probe=1'], ['POST', '/setup/start', {}]]) {
    const r = await call(m, p, b, { origin: 'https://evil.example' });
    assert.equal(r.status, 403, m + ' ' + p); assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(fake.created, before, 'a sandbox was created for a refused website');
});
await t('with ALLOWED_ORIGINS: same-origin calls (the /setup page) and header-less calls still work', async () => {
  process.env.ALLOWED_ORIGINS = SITE;
  const same = await call('GET', '/setup/status', undefined, { origin: 'https://api.example.com', host: 'api.example.com' });
  assert.equal(same.status, 200);
  const noOrigin = await call('GET', '/health');
  assert.equal(noOrigin.status, 200);
});
await t('preflight from a refused website is rejected without a permission header', async () => {
  process.env.ALLOWED_ORIGINS = SITE;
  const r = await call('OPTIONS', '/execute', undefined, { origin: 'https://evil.example' });
  assert.equal(r.status, 403); assert.equal(r.headers['access-control-allow-origin'], undefined);
  delete process.env.ALLOWED_ORIGINS;
});

await t('production refuses execution when the required Supabase backend credentials are missing', async () => {
  const prior = { vercel: process.env.VERCEL, url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY, backend: process.env.CODE_BACKEND_SHARED_SECRET, rate: process.env.CODE_RATE_LIMIT_SECRET };
  process.env.VERCEL = '1';
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
  delete process.env.CODE_BACKEND_SHARED_SECRET; delete process.env.CODE_RATE_LIMIT_SECRET;
  const r = await call('POST', '/execute', { language: 'python', code: 'print(1)' });
  assert.equal(r.status, 503); assert.match(r.json.error, /not configured/i);
  if (prior.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = prior.vercel;
  if (prior.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prior.url;
  if (prior.anon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = prior.anon;
  if (prior.backend === undefined) delete process.env.CODE_BACKEND_SHARED_SECRET; else process.env.CODE_BACKEND_SHARED_SECRET = prior.backend;
  if (prior.rate === undefined) delete process.env.CODE_RATE_LIMIT_SECRET; else process.env.CODE_RATE_LIMIT_SECRET = prior.rate;
});
await t('production execution consumes the Supabase quota and records execution metadata without source code', async () => {
  const keys = ['VERCEL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'CODE_BACKEND_SHARED_SECRET', 'CODE_RATE_LIMIT_SECRET'];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.VERCEL = '1';
  process.env.SUPABASE_URL = 'https://gbeurqibcfvquacasofq.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.CODE_BACKEND_SHARED_SECRET = 'backend-test-secret-that-is-over-32-chars';
  process.env.CODE_RATE_LIMIT_SECRET = 'rate-test-secret-that-is-over-32-characters';
  const requests = [];
  globalThis.__DRACO_SUPABASE_FETCH = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    if (url.endsWith('/code_consume_run')) return new Response(JSON.stringify([{ is_allowed: true, remaining_requests: 19, reset_at: new Date(Date.now() + 60000).toISOString() }]), { status: 200 });
    return new Response(null, { status: 204 });
  };
  try {
    const r = await call('POST', '/execute', { language: 'python', code: 'print("db-integrated")', stdin: '' }, { origin: SITE });
    assert.equal(r.status, 200); assert.equal(r.json.stdout.trim(), 'db-integrated');
    assert.equal(requests.length, 2);
    assert.ok(requests[0].url.endsWith('/rpc/code_consume_run'));
    assert.equal(requests[0].body.p_backend_secret, process.env.CODE_BACKEND_SHARED_SECRET);
    assert.equal(requests[0].body.p_limit, 20); assert.equal(requests[0].body.p_window_seconds, 60);
    assert.ok(requests[1].url.endsWith('/rpc/code_record_execution'));
    assert.equal(requests[1].body.p_language, 'python');
    assert.equal(requests[1].body.p_http_status, 200);
    assert.equal(requests[1].body.p_code_bytes, Buffer.byteLength('print("db-integrated")'));
    assert.equal('code' in requests[1].body, false, 'source code must not be recorded in the analytics table');
    assert.equal(requests[1].options.headers.apikey, 'test-anon-key');
    assert.equal(requests[1].options.headers.Authorization, undefined, 'publishable API keys must not be sent as bearer JWTs');
  } finally {
    delete globalThis.__DRACO_SUPABASE_FETCH;
    for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; }
  }
});
await t('Supabase quota denial blocks execution before sandbox allocation', async () => {
  const keys = ['VERCEL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'CODE_BACKEND_SHARED_SECRET', 'CODE_RATE_LIMIT_SECRET'];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.VERCEL = '1';
  process.env.SUPABASE_URL = 'https://gbeurqibcfvquacasofq.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.CODE_BACKEND_SHARED_SECRET = 'backend-test-secret-that-is-over-32-chars';
  process.env.CODE_RATE_LIMIT_SECRET = 'rate-test-secret-that-is-over-32-characters';
  let requests = 0;
  globalThis.__DRACO_SUPABASE_FETCH = async () => {
    requests += 1;
    return new Response(JSON.stringify([{ is_allowed: false, remaining_requests: 0, reset_at: new Date(Date.now() + 60000).toISOString() }]), { status: 200 });
  };
  const before = fake.created;
  try {
    const r = await call('POST', '/execute', { language: 'python', code: 'print(1)' }, { origin: SITE });
    assert.equal(r.status, 429); assert.equal(requests, 1); assert.equal(fake.created, before);
  } finally {
    delete globalThis.__DRACO_SUPABASE_FETCH;
    for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; }
  }
});

await t('a used-up allowance becomes a friendly 503, not a crash', async () => {
  for (const err of [Object.assign(new Error('boom'), { status: 429 }), new Error('Rate limit exceeded'), new Error('Request failed with status code 402')]) {
    const [r, status] = await execute('python', 'print(1)', '', async () => { throw err; });
    assert.equal(status, 503); assert.equal(r.code, 'capacity'); assert.match(r.error, /free run allowance/);
  }
  const [r2, s2] = await execute('python', 'print(1)', '', async () => { throw new Error('socket hang up'); });
  assert.equal(s2, 502); assert.match(r2.error, /sandbox service failed/);          // other failures stay honest
});
await t('oversized request body is refused with 413', async () => {
  const r = await call('POST', '/execute', { language: 'python', code: 'x' }, { 'content-length': '500000' });
  assert.equal(r.status, 413);
});


await t('guest execution is blocked for account-only languages before sandbox allocation', async () => {
  const keys=['VERCEL','SUPABASE_URL','SUPABASE_ANON_KEY','CODE_BACKEND_SHARED_SECRET','CODE_RATE_LIMIT_SECRET'];
  const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  process.env.VERCEL='1';process.env.SUPABASE_URL='https://gbeurqibcfvquacasofq.supabase.co';process.env.SUPABASE_ANON_KEY='anon-test-key';process.env.CODE_BACKEND_SHARED_SECRET='backend-test-secret-that-is-over-32-chars';process.env.CODE_RATE_LIMIT_SECRET='rate-test-secret-that-is-over-32-characters';
  const before=fake.created;
  try {const r=await call('POST','/execute',{language:'java',code:'public class Main {}'});assert.equal(r.status,401);assert.equal(fake.created,before);}
  finally {for(const k of keys){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}}
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
