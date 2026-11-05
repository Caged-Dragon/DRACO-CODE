import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
const require = createRequire(import.meta.url);
const core = require('../../frontend/app/project-core.js');
const Data = require('../../frontend/app/project-data.js');
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => { const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${createHmac('sha256', 'super-secret-jwt-key-at-least-32-characters-long').update(`${h}.${p}`).digest('base64url')}`; };
const mk = (sub) => createClient('http://localhost:3100', 'anon-key', { global: { headers: { Authorization: `Bearer ${jwt(sub)}` } }, auth: { persistSession: false, autoRefreshToken: false } });
const A = Data.create(mk('11111111-1111-1111-1111-111111111111')), B = Data.create(mk('22222222-2222-2222-2222-222222222222'));
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('  PASS ', n); } catch (e) { fail++; console.log('  FAIL ', n, '\n      ', e.message); } };
const rejects = async (p, re) => { try { await p; } catch (e) { if (!re || re.test(e.message)) return; throw new Error('wrong error: ' + e.message); } throw new Error('expected rejection'); };

let proj, files;
for (const lang of core.LANGS) await t(`create ${lang} project from starter, files saved in DB`, async () => {
  const p = await A.createProject('P-' + lang, lang); const f = await A.loadFiles(p.id);
  assert.deepEqual(f.map((x) => x.path).sort(), core.STARTERS[lang].files.map((x) => x.path).sort());
  assert.equal(p.entry_path, core.STARTERS[lang].entry); if (lang === 'python') { proj = p; files = f; }
});
await t('list shows newest first', async () => { const l = await A.listProjects(); assert.equal(l.length, 5); assert.ok(l[0].updated_at >= l[4].updated_at); });
await t('save file persists content and bumps project updated_at', async () => {
  const before = (await A.listProjects()).find((x) => x.id === proj.id).updated_at;
  const main = files.find((x) => x.path === 'main.py'); await new Promise((r) => setTimeout(r, 20));
  await A.saveFile(main.id, 'print("saved")'); const again = await A.loadFiles(proj.id);
  assert.equal(again.find((x) => x.path === 'main.py').content, 'print("saved")');
  assert.ok((await A.listProjects()).find((x) => x.id === proj.id).updated_at > before);
});
await t('create nested file + empty folder; tree builds from rows', async () => {
  await A.createFile(proj.id, 'pkg/mod.py', 'X=1'); await A.createFolder(proj.id, 'empty');
  const tree = core.buildTree(await A.loadFiles(proj.id));
  assert.deepEqual(tree.children.map((c) => c.name), ['empty', 'pkg', 'main.py', 'utils.py']);
});
await t('rename folder moves children atomically; delete folder removes subtree', async () => {
  await A.renamePath(proj.id, 'pkg', 'lib'); let paths = (await A.loadFiles(proj.id)).map((x) => x.path);
  assert.ok(paths.includes('lib/mod.py') && !paths.includes('pkg/mod.py'));
  await A.deletePath(proj.id, 'lib'); paths = (await A.loadFiles(proj.id)).map((x) => x.path); assert.ok(!paths.some((p) => p.startsWith('lib')));
});
await t('set entry + rename project', async () => { await A.setEntry(proj.id, 'utils.py'); await A.renameProject(proj.id, 'Renamed'); const p = (await A.listProjects()).find((x) => x.id === proj.id); assert.equal(p.entry_path, 'utils.py'); assert.equal(p.name, 'Renamed'); });
await t('duplicate name gives a friendly message', async () => rejects(A.createFile(proj.id, 'main.py', ''), /already exists/));
await t('invalid path rejected by the database with a friendly message', async () => rejects(A.createFile(proj.id, '../x.py', ''), /not allowed/));
await t('oversized file rejected', async () => rejects(A.createFile(proj.id, 'big.txt', 'x'.repeat(100001)), /100 KB/));
console.log('isolation between accounts (real RLS via PostgREST)');
await t('user B sees none of user A data', async () => { assert.equal((await B.listProjects()).length, 0); assert.equal((await B.loadFiles(proj.id)).length, 0); });
await t('user B cannot write into A project', async () => rejects(B.createFile(proj.id, 'evil.py', 'x')));
await t('user B cannot save/rename/delete A data', async () => {
  await rejects(B.saveFile(files[0].id, 'hacked'), /no longer exists/);
  await B.renamePath(proj.id, 'main.py', 'stolen.py'); await B.deletePath(proj.id, 'utils.py'); await B.deleteProject(proj.id); await B.renameProject(proj.id, 'pwned');
  const now = await A.loadFiles(proj.id); assert.ok(now.some((x) => x.path === 'main.py') && now.some((x) => x.path === 'utils.py'));
  assert.equal((await A.listProjects()).find((x) => x.id === proj.id).name, 'Renamed');
});
await t('delete project removes it and its files', async () => { await A.deleteProject(proj.id); assert.equal((await A.listProjects()).length, 4); assert.equal((await A.loadFiles(proj.id)).length, 0); });
await t('anonymous (no session) client is refused', async () => {
  const anon = Data.create(createClient('http://localhost:3100', 'anon-key', { auth: { persistSession: false } })); await rejects(anon.listProjects());
});
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
