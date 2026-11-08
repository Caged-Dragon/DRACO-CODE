import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const F = require('../app/features-core.js'), P = require('../app/project-core.js');
let pass = 0; const t = (n, f) => { f(); pass++; console.log('  PASS ', n); };

t('fuzzy: contiguous beats scattered; all terms must match; no match -> null', () => {
  const a = F.fuzzy('run', 'Run program'), b = F.fuzzy('run', 'Reduce unused number');
  assert.ok(a.score > b.score); assert.deepEqual(a.idx, [0, 1, 2]);
  assert.equal(F.fuzzy('zzz', 'Run program'), null);
  assert.ok(F.fuzzy('new py', 'New Python program')); assert.equal(F.fuzzy('new rust', 'New Python program'), null);
  assert.deepEqual(F.fuzzy('', 'anything'), { score: 0, idx: [] });
});
t('rank: best match first, keeps original order when scores tie, empty query keeps order', () => {
  const items = [{ title: 'Toggle layout' }, { title: 'Run program' }, { title: 'New program' }, { title: 'Open settings', keywords: 'preferences font theme' }];
  assert.equal(F.rank(items, 'run')[0].item.title, 'Run program');
  assert.deepEqual(F.rank(items, '').map((r) => r.item.title), items.map((i) => i.title));
  assert.equal(F.rank(items, 'preferences')[0].item.title, 'Open settings');          // matches via keywords
  assert.equal(F.rank(items, 'zzzz').length, 0);
  assert.deepEqual(F.rank(items, 'prog').map((r) => r.item.title), ['Run program', 'New program']);
});
t('settings: defaults, clamping, bad input', () => {
  assert.deepEqual(F.normalizeSettings(null), { theme: 'system', fontSize: 13, tabSize: 4 });
  assert.equal(F.normalizeSettings({ fontSize: 99 }).fontSize, 20); assert.equal(F.normalizeSettings({ fontSize: 2 }).fontSize, 11);
  assert.equal(F.normalizeSettings({ fontSize: 'abc' }).fontSize, 13); assert.equal(F.normalizeSettings({ tabSize: 3 }).tabSize, 4);
  assert.equal(F.normalizeSettings({ tabSize: 2 }).tabSize, 2); assert.equal(F.normalizeSettings({ theme: 'neon' }).theme, 'system');
  assert.equal(F.normalizeSettings({ theme: 'dark' }).theme, 'dark'); assert.equal(F.lineHeightFor(13), 22); assert.equal(F.lineHeightFor(20), 34);
});
t('searchFiles: literal, case options, positions, multiple hits per line, limit', () => {
  const files = [{ path: 'b.py', content: 'x = 1\nprint(x)\nPrint(x)' }, { path: 'a.py', content: 'foo foo\nbar' }];
  const r = P.searchFiles(files, 'print'); assert.deepEqual(r.map((m) => [m.path, m.line, m.col]), [['b.py', 2, 1], ['b.py', 3, 1]]);
  assert.equal(P.searchFiles(files, 'print', { caseSensitive: true }).length, 1);
  assert.deepEqual(P.searchFiles(files, 'foo').map((m) => [m.path, m.line, m.col]), [['a.py', 1, 1], ['a.py', 1, 5]]);
  assert.equal(P.searchFiles(files, 'a.*b').length, 0, 'regex characters are literal');
  assert.equal(P.searchFiles([{ path: 'big.txt', content: 'a\n'.repeat(1000) }], 'a').length, 300);
  assert.equal(P.searchFiles(files, '').length, 0);
});
t('sanitizeUploadName / looksLikeText', () => {
  assert.equal(P.sanitizeUploadName('My File (1).py'), 'My_File_1_.py'); assert.equal(P.sanitizeUploadName('C:\\fakepath\\x.c'), 'x.c');
  assert.equal(P.sanitizeUploadName('.env'), 'env'); assert.equal(P.sanitizeUploadName('...'), null); assert.equal(P.sanitizeUploadName('../../etc/passwd'), 'passwd');
  assert.ok(P.looksLikeText('hello\nworld')); assert.ok(!P.looksLikeText('a\u0000b')); assert.ok(!P.looksLikeText('\uFFFDbinary'));
  for (const n of ['ok.py', 'a b.py', '../x', '.hidden']) { const s = P.sanitizeUploadName(n); assert.equal(P.pathError(s), '', n); }
});
t('crc32 matches the standard check value', () => assert.equal(P.crc32(new TextEncoder().encode('123456789')), 0xCBF43926));
t('makeZip: a real, valid archive (Python zipfile + unzip -t), UTF-8 names and contents, folders', () => {
  const files = [{ path: 'main.py', content: 'print("héllo ✓")\n' }, { path: 'src/util.py', content: 'x = 1\n' }, { path: 'empty.txt', content: '' }, { path: 'données/日本.txt', content: 'ok' }];
  const dir = mkdtempSync(path.join(tmpdir(), 'zip-')), file = path.join(dir, 'p.zip');
  writeFileSync(file, P.makeZip(files, new Date(2026, 10, 7, 12, 30, 10)));
  const out = execFileSync('python3', ['-c', `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(json.dumps({i.filename: z.read(i).decode('utf-8') for i in z.infolist()}, ensure_ascii=False))
print(z.infolist()[0].date_time)`, file]).toString().split('\n');
  const got = JSON.parse(out[0]); for (const f of files) assert.equal(got[f.path], f.content, f.path);
  assert.equal(out[1], '(2026, 11, 7, 12, 30, 10)');
  execFileSync('unzip', ['-tq', file]);
});
t('makeZip handles an empty project', () => { const z = P.makeZip([]); assert.equal(z.length, 22); });
t('shortcut catalogue is well-formed', () => { for (const g of F.SHORTCUTS) { assert.ok(g.group && g.rows.length); for (const [label, keys] of g.rows) assert.ok(label && keys); } });
console.log(`\n${pass} passed, 0 failed`);
