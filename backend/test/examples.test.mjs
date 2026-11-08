// Every shipped example must actually compile/run and print exactly what it claims, in all five languages.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeFactory } from './fake-sandbox.mjs';
globalThis.__DRACO_SANDBOX_FACTORY = fakeFactory;
const { execute } = await import('../lib/runner.js');
const I = await import('../lib/interactive.js');
const fake = await import('./fake-sandbox.mjs');
const X = createRequire(import.meta.url)('../../frontend/app/examples.js');
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  PASS ', name); } catch (e) { fail++; console.log('  FAIL ', name, '\n       ', String(e.message).slice(0, 500)); } }

await t('20 examples: 4 topics x 5 languages, unique ids, each with code and expected output', () => {
  assert.equal(X.LIST.length, 20);
  assert.equal(new Set(X.LIST.map((e) => e.id)).size, 20);
  for (const lang of ['python', 'javascript', 'java', 'c', 'cpp']) assert.equal(X.forLanguage(lang).length, 4, lang);
  for (const e of X.LIST) { assert.ok(e.code.length > 40 && e.expected && e.title && e.description, e.id); assert.ok(X.TOPICS[e.topic], e.id); }
});
for (const e of X.LIST) {
  await t(`runs: ${e.id}`, async () => {
    const [r, s] = await execute(e.language, e.code, e.stdin);
    assert.equal(s, 200, JSON.stringify(r)); assert.equal(r.compileError, false, r.stderr); assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, e.expected, `stdout was ${JSON.stringify(r.stdout)}`);
  });
}
// the same programs in the interactive terminal: the prompt appears first, then the typed answers are used
for (const lang of ['python', 'javascript', 'java', 'c', 'cpp']) {
  await t(`interactive terminal: ${lang} "Ask for input" waits for typing`, async () => {
    const e = X.byId(`${lang}-greeting`);
    const [r, s] = await I.startSession(lang, { code: e.code }, ''); assert.equal(s, 200, JSON.stringify(r));
    let text = '', off = 0, done = false;
    const pump = async () => { const [p] = await I.pollSession(r.session, off, 1200); if (p.chunk) text += Buffer.from(p.chunk, 'base64').toString(); off = p.offset ?? off; done = !!p.done; return p; };
    for (let i = 0; i < 25 && !/Your name: $/.test(text); i++) await pump();
    assert.match(text, /Your name: $/); assert.doesNotMatch(text, /Hello/);
    await I.sendInput(r.session, 'Ada\n');
    for (let i = 0; i < 25 && !/Your age: $/.test(text); i++) await pump();
    assert.match(text, /Your age: $/); await I.sendInput(r.session, '36\n');
    let last; for (let i = 0; i < 25 && !done; i++) last = await pump();
    assert.match(text, /Hello, Ada! Next year you will be 37\./); assert.equal(last.exitCode, 0);
  });
}
await t('no sandboxes leaked', async () => { await new Promise((r) => setTimeout(r, 400)); assert.equal(fake.created, fake.stopped); });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
