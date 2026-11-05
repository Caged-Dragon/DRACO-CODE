// Project mode: multi-file runs through the real runner (fake sandbox) and the HTTP handler.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeFactory, created, stopped } from './fake-sandbox.mjs';
globalThis.__DRACO_SANDBOX_FACTORY = fakeFactory;
const { executeProject } = await import('../lib/runner.js');
const { validateProject, javaMainClass } = await import('../lib/project.js');
const { default: handler } = await import('../api/index.js');
const core = createRequire(import.meta.url)('../../frontend/app/project-core.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  PASS ', name); } catch (e) { fail++; console.log('  FAIL ', name, '\n       ', String(e.message).slice(0, 400)); } }
async function call(body, headers = {}) {
  let status, out = ''; const res = { setHeader() {}, end(b) { out = b || ''; }, set statusCode(v) { status = v; }, get statusCode() { return status; } };
  await handler({ method: 'POST', url: '/execute', headers: { 'x-forwarded-for': '8.8.8.' + Math.floor(Math.random() * 250), ...headers }, body }, res);
  return { status, json: out ? JSON.parse(out) : null };
}

console.log('starter projects really run (all five languages, multi-file)');
for (const lang of core.LANGS) {
  await t(`${lang} starter compiles/runs across files`, async () => {
    const s = core.STARTERS[lang];
    const [r, st] = await executeProject(lang, s.files, s.entry, '');
    assert.equal(st, 200, JSON.stringify(r)); assert.equal(r.compileError, false, r.stderr);
    assert.equal(r.stdout, s.expected); assert.equal(r.exitCode, 0);
  });
}
console.log('project behaviour');
await t('files in sub-folders and a Python package import work', async () => {
  const files = [{ path: 'main.py', content: 'from pkg.mod import f\nprint(f())' }, { path: 'pkg/__init__.py', content: '' }, { path: 'pkg/mod.py', content: 'def f(): return "deep"' }];
  const [r] = await executeProject('python', files, 'main.py'); assert.equal(r.stdout.trim(), 'deep');
});
await t('entry in a sub-folder still imports from the project root', async () => {
  const files = [{ path: 'app/run.py', content: 'import helper\nprint(helper.X)' }, { path: 'helper.py', content: 'X = 42' }];
  const [r] = await executeProject('python', files, 'app/run.py'); assert.equal(r.stdout.trim(), '42', r.stderr);
});
await t('files can read sibling data files and stdin', async () => {
  const files = [{ path: 'main.py', content: 'print(open("data.txt").read().strip(), input())' }, { path: 'data.txt', content: 'from-file' }];
  const [r] = await executeProject('python', files, 'main.py', 'typed'); assert.equal(r.stdout.trim(), 'from-file typed');
});
await t('Java package declaration + nested source folders', async () => {
  const files = [{ path: 'src/com/acme/Main.java', content: 'package com.acme;\npublic class Main { public static void main(String[] a){ System.out.println(Util.hi()); } }' }, { path: 'src/com/acme/Util.java', content: 'package com.acme;\nclass Util { static String hi(){ return "pkg-ok"; } }' }];
  const [r, s] = await executeProject('java', files, 'src/com/acme/Main.java'); assert.equal(s, 200, JSON.stringify(r)); assert.equal(r.stdout.trim(), 'pkg-ok', r.stderr);
});
await t('C header in a sub-folder is found (-I)', async () => {
  const files = [{ path: 'main.c', content: '#include <stdio.h>\n#include "m.h"\nint main(){printf("%d\\n",sq(7));}' }, { path: 'inc/m.h', content: 'static inline int sq(int x){return x*x;}' }];
  const [r] = await executeProject('c', files, 'main.c'); assert.equal(r.stdout.trim(), '49', r.stderr);
});
await t('compile error in a non-entry file is reported with its path', async () => {
  const s = core.STARTERS.c; const files = s.files.map((f) => f.path === 'greet.c' ? { ...f, content: f.content + '\nint broken( {' } : f);
  const [r, st] = await executeProject('c', files, 'main.c'); assert.equal(st, 200); assert.equal(r.compileError, true);
  const d = core.parseDiagnostics('c', r.stderr, files.map((f) => f.path)); assert.ok(d.some((x) => x.file === 'greet.c' && x.severity === 'error'), JSON.stringify(d));
});
await t('Python traceback is parsed to file + line', async () => {
  const files = [{ path: 'main.py', content: 'import bad\nbad.go()' }, { path: 'bad.py', content: 'def go():\n    raise ValueError("nope")' }];
  const [r] = await executeProject('python', files, 'main.py'); assert.notEqual(r.exitCode, 0);
  const d = core.parseDiagnostics('python', r.stderr, ['main.py', 'bad.py']); assert.ok(d.some((x) => x.file === 'bad.py' && x.line === 2 && /nope/.test(x.message)), JSON.stringify(d));
});
await t('infinite loop in a project times out', async () => {
  const [r] = await executeProject('python', [{ path: 'main.py', content: 'while True: pass' }], 'main.py'); assert.equal(r.timedOut, true);
});
await t('project files cannot clobber runner scripts (run.sh / app / build)', async () => {
  const files = [{ path: 'main.py', content: 'print("ok")' }, { path: 'run.sh', content: 'echo hacked' }, { path: 'app', content: 'x' }, { path: 'build/x.txt', content: 'x' }, { path: 'stdin.txt', content: 'x' }];
  const [r] = await executeProject('python', files, 'main.py'); assert.equal(r.stdout.trim(), 'ok');
});
await t('no sandbox leaks', async () => { const f = await import('./fake-sandbox.mjs'); assert.equal(f.created, f.stopped); });

console.log('validation');
const py = (p) => ({ path: p, content: 'print(1)' });
await t('rejects traversal, absolute, dotfile, shell metacharacters, duplicates', () => {
  for (const bad of ['../x.py', '/etc/x.py', '.env.py', 'a b.py', 'a;rm -rf.py', 'a$(x).py', 'a\\b.py', 'a//b.py', 'a/../b.py'])
    assert.ok(validateProject('python', [py('main.py'), py(bad)], 'main.py').error, bad);
  assert.ok(validateProject('python', [py('main.py'), py('main.py')], 'main.py').error);
});
await t('rejects missing/non-source entry, empty list, oversize, too many files', () => {
  assert.ok(validateProject('python', [py('main.py')], 'nope.py').error);
  assert.ok(validateProject('python', [{ path: 'a.txt', content: 'x' }], 'a.txt').error);
  assert.ok(validateProject('python', [], 'main.py').error);
  assert.ok(validateProject('python', [{ path: 'main.py', content: 'x'.repeat(100001) }], 'main.py').error);
  assert.ok(validateProject('python', Array.from({ length: 101 }, (_, i) => py(`f${i}.py`)), 'f0.py').error);
  assert.ok(validateProject('python', Array.from({ length: 4 }, (_, i) => ({ path: `f${i}.py`, content: 'x'.repeat(90000) })), 'f0.py').error);
});
await t('javaMainClass reads package, ignoring comments', () => {
  assert.equal(javaMainClass('a/Main.java', '// package no;\npackage x.y;\nclass Main{}'), 'x.y.Main');
  assert.equal(javaMainClass('Main.java', 'class Main{}'), 'Main');
});

console.log('HTTP');
function withEnv(fn) { return async () => {
  const keys = ['VERCEL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'CODE_BACKEND_SHARED_SECRET', 'CODE_RATE_LIMIT_SECRET'];
  const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]])); const original = globalThis.fetch;
  Object.assign(process.env, { VERCEL: '1', SUPABASE_URL: 'https://gbeurqibcfvquacasofq.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_test_key', CODE_BACKEND_SHARED_SECRET: 'backend-test-secret-that-is-over-32-chars', CODE_RATE_LIMIT_SECRET: 'rate-test-secret-that-is-over-32-characters' });
  const log = { rpc: [] };
  globalThis.fetch = async (url) => { const u = String(url);
    if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', email: 'a@b.c' }), { status: 200 });
    if (u.includes('/draco_user_languages')) return new Response(JSON.stringify([{ language: 'java' }]), { status: 200 });
    if (u.includes('/draco_user_packages')) return new Response('[]', { status: 200 });
    throw new Error('unexpected ' + u); };
  globalThis.__DRACO_SUPABASE_FETCH = async (url, o) => { log.rpc.push([String(url), JSON.parse(o.body)]); return new Response(String(url).endsWith('code_consume_run') ? JSON.stringify([{ is_allowed: true, remaining_requests: 9 }]) : 'null', { status: 200 }); };
  try { await fn(log); } finally { globalThis.fetch = original; delete globalThis.__DRACO_SUPABASE_FETCH; for (const k of keys) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; } }
}; }
const auth = { authorization: 'Bearer valid.jwt.token' };
await t('guest cannot run a project (401) and no sandbox is created', withEnv(async () => {
  const before = (await import('./fake-sandbox.mjs')).created;
  const r = await call({ language: 'python', files: [py('main.py')], entry: 'main.py' }); assert.equal(r.status, 401);
  assert.equal((await import('./fake-sandbox.mjs')).created, before);
}));
await t('signed-in user runs a Python project; telemetry has byte counts, never source', withEnv(async (log) => {
  const r = await call({ language: 'python', files: core.STARTERS.python.files, entry: 'main.py', stdin: '' }, auth);
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.stdout, core.STARTERS.python.expected);
  const rec = log.rpc.find(([u]) => u.endsWith('code_record_execution'))[1];
  assert.ok(rec.p_code_bytes > 50); assert.doesNotMatch(JSON.stringify(rec), /greet|Draco/);
}));
await t('signed-in user runs an installed-language (Java) project', withEnv(async () => {
  const r = await call({ language: 'java', files: core.STARTERS.java.files, entry: 'Main.java' }, auth); assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.stdout, core.STARTERS.java.expected);
}));
await t('a language the account has not added is refused (403)', withEnv(async () => {
  const r = await call({ language: 'cpp', files: core.STARTERS.cpp.files, entry: 'main.cpp' }, auth); assert.equal(r.status, 403);
}));
await t('bad project payloads give 400 with a reason', withEnv(async () => {
  for (const b of [{ language: 'python', files: 'x', entry: 'a.py' }, { language: 'python', files: [py('../x.py')], entry: '../x.py' }, { language: 'python', files: [py('main.py')], entry: 'zzz.py' }]) {
    const r = await call(b, auth); assert.equal(r.status, 400, JSON.stringify(b)); assert.ok(r.json.error);
  }
}));
await t('single-file guest runs still work exactly as before', async () => {
  const r = await call({ language: 'python', code: 'print(3)' }); assert.equal(r.status, 200); assert.equal(r.json.stdout.trim(), '3');
});

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
