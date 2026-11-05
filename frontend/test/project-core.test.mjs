import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const core = createRequire(import.meta.url)('../app/project-core.js');
let pass = 0; const t = (n, f) => { f(); pass++; console.log('  PASS ', n); };
t('pathError accepts good paths, rejects bad ones', () => {
  for (const ok of ['main.py', 'src/a/b.c', 'A_b-1.2.txt']) assert.equal(core.pathError(ok), '');
  for (const bad of ['', '.env', '../x', '/abs', 'a b', 'a//b', 'a/', 'x'.repeat(201), 'a;b', '-x', 'a/b/c/d/e/f/g/h/i.txt']) assert.notEqual(core.pathError(bad), '', bad);
});
t('buildTree sorts folders first and creates implicit parents', () => {
  const tree = core.buildTree([{ path: 'z.py' }, { path: 'src/b.py' }, { path: 'src/a.py' }, { path: 'docs', is_folder: true }, { path: 'a.py' }]);
  assert.deepEqual(tree.children.map((c) => c.name), ['docs', 'src', 'a.py', 'z.py']);
  assert.deepEqual(tree.children[1].children.map((c) => c.name), ['a.py', 'b.py']);
});
t('defaultEntry prefers conventional names, else first source', () => {
  assert.equal(core.defaultEntry('python', [{ path: 'b.py' }, { path: 'main.py' }]), 'main.py');
  assert.equal(core.defaultEntry('java', [{ path: 'src/Z.java' }, { path: 'src/A.java' }]), 'src/A.java');
  assert.equal(core.defaultEntry('c', [{ path: 'x.h' }]), null);
});
t('highlightLang / isSource', () => {
  assert.equal(core.highlightLang('a/b.hpp'), 'cpp'); assert.equal(core.highlightLang('n.txt'), 'text');
  assert.ok(core.isSource('cpp', 'x.cc')); assert.ok(!core.isSource('c', 'x.h'));
});
t('parseDiagnostics: gcc, javac, python, node', () => {
  const gcc = core.parseDiagnostics('c', "./greet.c:7:5: error: expected ';' before '}' token\nmain.c:3:1: warning: unused variable 'x'\n", ['greet.c', 'main.c']);
  assert.deepEqual(gcc.map((d) => [d.file, d.line, d.col, d.severity]), [['greet.c', 7, 5, 'error'], ['main.c', 3, 1, 'warning']]);
  const jv = core.parseDiagnostics('java', "src/Main.java:4: error: ';' expected\n  foo()\n", ['src/Main.java']); assert.equal(jv[0].line, 4);
  const py = core.parseDiagnostics('python', 'Traceback (most recent call last):\n  File "main.py", line 2, in <module>\n    bad.go()\n  File "bad.py", line 2, in go\n    raise ValueError("x")\nValueError: x\n', ['main.py', 'bad.py']);
  assert.ok(py.find((d) => d.file === 'bad.py' && d.line === 2 && /ValueError/.test(d.message)));
  assert.deepEqual(core.parseDiagnostics('c', '/usr/lib/x.c:1:1: error: nope', ['main.c']), [], 'files outside the project are ignored');
});
t('every starter has an entry that exists and passes the shared path rules', () => {
  for (const l of core.LANGS) { const s = core.STARTERS[l]; assert.ok(s.files.some((f) => f.path === s.entry)); s.files.forEach((f) => assert.equal(core.pathError(f.path), '')); assert.ok(core.isSource(l, s.entry)); }
});
console.log(`\n${pass} passed, 0 failed`);
