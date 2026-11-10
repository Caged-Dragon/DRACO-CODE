// A backend with missing/invalid settings must say exactly WHICH settings (names only), on /health and on every refused run.
import assert from 'node:assert/strict';
const { default: handler } = await import('../api/index.js');
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  PASS ', name); } catch (e) { fail++; console.log('  FAIL ', name, '\n       ', String(e.stack || e.message).slice(0, 400)); } }
async function call(method, path, body) {
  let status, out = ''; const res = { setHeader() {}, end(b) { out = b || ''; }, set statusCode(v) { status = v; }, get statusCode() { return status; } };
  await handler({ method, url: path, headers: { 'x-forwarded-for': '5.5.5.' + Math.floor(Math.random() * 250) }, body }, res); return { status, json: out ? JSON.parse(out) : null };
}
const GOOD = { SUPABASE_URL: 'https://gbeurqibcfvquacasofq.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_test_key', CODE_BACKEND_SHARED_SECRET: 'backend-test-secret-that-is-over-32-chars', CODE_RATE_LIMIT_SECRET: 'rate-test-secret-that-is-over-32-characters' };
function withEnv(env, fn) { return async () => { const keys = ['VERCEL', ...Object.keys(GOOD)]; const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]])); for (const k of keys) delete process.env[k]; Object.assign(process.env, { VERCEL: '1' }, env); try { await fn(); } finally { for (const k of keys) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; } } }; }
const names = (r) => r.json.missing.map((m) => m.name);

await t('nothing configured: a guest Python run is refused with all four settings named', withEnv({}, async () => {
  const r = await call('POST', '/execute', { language: 'python', code: 'print(1)' });
  assert.equal(r.status, 503); assert.equal(r.json.code, 'not-configured'); assert.match(r.json.error, /not configured/);
  assert.deepEqual(names(r), ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'CODE_BACKEND_SHARED_SECRET', 'CODE_RATE_LIMIT_SECRET']);
}));
await t('only one setting missing: only that one is named', withEnv({ ...GOOD, CODE_BACKEND_SHARED_SECRET: undefined }, async () => {
  delete process.env.CODE_BACKEND_SHARED_SECRET; const r = await call('POST', '/execute', { language: 'javascript', code: 'console.log(1)' }); assert.equal(r.status, 503); assert.deepEqual(names(r), ['CODE_BACKEND_SHARED_SECRET']);
}));
await t('short secrets and a wrong Supabase URL are explained', withEnv({ ...GOOD, CODE_RATE_LIMIT_SECRET: 'short', SUPABASE_URL: 'https://other.supabase.co' }, async () => {
  const r = await call('POST', '/session/start', { language: 'python', code: 'print(1)' }); assert.equal(r.status, 503);
  const m = Object.fromEntries(r.json.missing.map((x) => [x.name, x.problem])); assert.match(m.CODE_RATE_LIMIT_SECRET, /at least 32/); assert.match(m.SUPABASE_URL, /gbeurqibcfvquacasofq\.supabase\.co/);
}));
await t('package tests report the same thing', withEnv({}, async () => { const r = await call('POST', '/packages/check', { language: 'python', name: 'six' }); assert.equal(r.status, 503); assert.equal(r.json.code, 'not-configured'); }));
await t('/health lists what is missing, and never leaks values', withEnv({ ...GOOD, CODE_RATE_LIMIT_SECRET: 'abc' }, async () => {
  const r = await call('GET', '/health'); assert.equal(r.status, 200); assert.equal(r.json.databaseConfigured, false); assert.deepEqual(names(r), ['CODE_RATE_LIMIT_SECRET']);
  const text = JSON.stringify(r.json); for (const v of Object.values(GOOD)) assert.ok(!text.includes(v), 'a secret value leaked'); assert.ok(!text.includes('abc'));
}));
await t('fully configured: /health is clean and has an empty missing list', withEnv(GOOD, async () => {
  const r = await call('GET', '/health'); assert.equal(r.json.databaseConfigured, true); assert.deepEqual(r.json.missing, []);
}));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
