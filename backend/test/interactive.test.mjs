// Interactive terminal sessions: a program keeps running while the "browser" polls and types.
import assert from 'node:assert/strict';
import { fakeFactory } from './fake-sandbox.mjs';
globalThis.__DRACO_SANDBOX_FACTORY = fakeFactory;
process.env.DRACO_SESSION_SECONDS = '6';
const I = await import('../lib/interactive.js');
const fake = await import('./fake-sandbox.mjs');
const { default: handler } = await import('../api/index.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  PASS ', name); } catch (e) { fail++; console.log('  FAIL ', name, '\n       ', String(e.stack || e.message).slice(0, 500)); } }

// A tiny terminal: accumulates output exactly as the browser will.
class Term {
  constructor(token) { this.token = token; this.offset = 0; this.text = ''; this.done = false; this.last = null; }
  async pump(wait = 1500) { const [r] = await I.pollSession(this.token, this.offset, wait); this.last = r; if (r.chunk) this.text += Buffer.from(r.chunk, 'base64').toString(); this.offset = r.offset ?? this.offset; if (r.done) this.done = true; return r; }
  async until(re, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (re.test(this.text)) return; if (this.done) break; await this.pump(600); } assert.match(this.text, re, 'terminal text so far: ' + JSON.stringify(this.text)); }
  async type(line) { const [r] = await I.sendInput(this.token, line + '\n'); assert.equal(r.ok, true, JSON.stringify(r)); }
  async finish() { const end = Date.now() + 8000; while (!this.done && Date.now() < end) await this.pump(600); return this.last; }
}
async function start(language, source, stdin = '') { const [r, s] = await I.startSession(language, source, stdin); assert.equal(s, 200, JSON.stringify(r)); assert.ok(r.session, JSON.stringify(r)); return new Term(r.session); }

console.log('real-terminal behaviour (prompt first, then you type, then the program continues)');
await t('Python input(): prompt shows BEFORE typing, answer is used afterwards', async () => {
  const term = await start('python', { code: 'name = input("Your name: ")\nage = int(input("Age: "))\nprint(f"Hi {name}, next year you are {age+1}")' });
  await term.until(/Your name: $/); assert.doesNotMatch(term.text, /Hi /);
  await term.type('Ada'); await term.until(/Age: $/); await term.type('36');
  await term.until(/Hi Ada, next year you are 37/); const r = await term.finish(); assert.equal(r.done, true); assert.equal(r.exitCode, 0);
});
await t('C scanf with a prompt that has NO newline appears immediately (unbuffered)', async () => {
  const term = await start('c', { code: '#include <stdio.h>\nint main(){int a,b;printf("a? ");scanf("%d",&a);printf("b? ");scanf("%d",&b);printf("sum=%d\\n",a+b);return 0;}' });
  await term.until(/a\? $/); await term.type('20'); await term.until(/b\? $/); await term.type('22'); await term.until(/sum=42/); assert.equal((await term.finish()).exitCode, 0);
});
await t('C++ cin / cout with prompt', async () => {
  const term = await start('cpp', { code: '#include <iostream>\n#include <string>\nint main(){std::string n;std::cout<<"name: "<<std::flush;std::cin>>n;std::cout<<"hello "<<n<<"\\n";}' });
  await term.until(/name: $/); await term.type('Linus'); await term.until(/hello Linus/); assert.equal((await term.finish()).exitCode, 0);
});
await t('Java Scanner loop reads several lines interactively', async () => {
  const term = await start('java', { code: 'import java.util.*;\npublic class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);int t=0;while(true){System.out.print("n> ");int n=s.nextInt();if(n==0)break;t+=n;}System.out.println("total="+t);}}' });
  await term.until(/n> $/); for (const n of ['5', '7']) { await term.type(n); await term.until(new RegExp('n> $')); } await term.type('0'); await term.until(/total=12/); assert.equal((await term.finish()).exitCode, 0);
});
await t('JavaScript readline works line by line', async () => {
  const term = await start('javascript', { code: 'const rl=require("readline").createInterface({input:process.stdin,output:process.stdout});rl.question("color? ",c=>{console.log("you like "+c);rl.close();});' });
  await term.until(/color\? $/); await term.type('teal'); await term.until(/you like teal/); assert.equal((await term.finish()).exitCode, 0);
});
await t('JavaScript rl.on("line") loop that calls rl.close() exits (stdin never hits EOF)', async () => {
  const term = await start('javascript', { code: 'const rl=require("readline").createInterface({input:process.stdin});let t=0;rl.on("line",l=>{if(l==="0"){console.log("total="+t);rl.close();}else t+=+l;});' });
  await term.type('5'); await term.type('7'); await term.type('0'); await term.until(/total=12/); assert.equal((await term.finish()).exitCode, 0);
});
await t('JavaScript fs.readFileSync(0) reads until Ctrl+D', async () => {
  const term = await start('javascript', { code: 'const n=require("fs").readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);console.log("sum="+n.reduce((a,b)=>a+b,0));' });
  await term.type('4 5'); await term.type('6'); await I.sendEof(term.token); await term.until(/sum=15/); assert.equal((await term.finish()).exitCode, 0);
});
await t('pre-filled input (the "Preset input" box) is consumed without typing', async () => {
  const term = await start('python', { code: 'print(int(input())*2)' }, '21\n'); await term.until(/42/); assert.equal((await term.finish()).exitCode, 0);
});
await t('Ctrl+D (EOF) lets a read-until-end program finish', async () => {
  const term = await start('python', { code: 'import sys\ntotal=sum(int(x) for x in sys.stdin.read().split())\nprint("total",total)' });
  await term.type('4 5'); await term.type('6'); await I.sendEof(term.token); await term.until(/total 15/); assert.equal((await term.finish()).exitCode, 0);
});
await t('stdout and stderr share one ordered stream; non-zero exit is reported', async () => {
  const term = await start('python', { code: 'import sys\nprint("out1",flush=True)\nprint("err1",file=sys.stderr,flush=True)\nprint("out2")\nsys.exit(3)' });
  const r = await term.finish(); assert.equal(r.exitCode, 3); assert.match(term.text, /out1\nerr1\nout2/);
});
await t('multi-file PROJECT sessions work too (entry + sibling module + input)', async () => {
  const [r, s] = await I.startSession('python', { files: [{ path: 'main.py', content: 'from util import twice\nprint(twice(int(input("n: "))))' }, { path: 'util.py', content: 'def twice(x): return 2*x' }], entry: 'main.py' });
  assert.equal(s, 200, JSON.stringify(r)); const term = new Term(r.session); await term.until(/n: $/); await term.type('8'); await term.until(/16/); assert.equal((await term.finish()).exitCode, 0);
});

console.log('control + safety');
await t('Ctrl+C stops a running program and releases the sandbox', async () => {
  const before = fake.stopped; const term = await start('python', { code: 'import time\nwhile True:\n    time.sleep(0.1)' });
  await term.pump(300); const [r] = await I.stopSession(term.token); assert.equal(r.stopped, true); assert.equal(fake.stopped, before + 1);
  const [after] = await I.pollSession(term.token, 0, 0); assert.equal(after.done, true); assert.equal(after.ended, true);
});
await t('infinite loop hits the session time cap (timedOut)', async () => {
  const term = await start('python', { code: 'while True: pass' }); const r = await term.finish(); assert.equal(r.timedOut, true);
});
await t('output flood is truncated at the cap and the program is stopped', async () => {
  const term = await start('python', { code: 'import sys\nwhile True:\n    sys.stdout.write("x"*1000)' }); const r = await term.finish();
  assert.equal(r.done, true); assert.ok(term.offset <= I.MAX_TERM_BYTES && r.truncated === true, `offset=${term.offset}`);
});
await t('compile error returns immediately with diagnostics and no leaked sandbox', async () => {
  const before = { c: fake.created, s: fake.stopped };
  const [r, s] = await I.startSession('c', { code: 'int main(){ return x; }' }); assert.equal(s, 200); assert.equal(r.compileError, true); assert.equal(r.done, true); assert.match(r.stderr, /error/);
  assert.equal(fake.created - before.c, fake.stopped - before.s);
});
await t('finished sessions release their sandbox', async () => {
  const before = fake.stopped; const term = await start('python', { code: 'print(1)' }); await term.finish(); assert.equal(fake.stopped, before + 1);
});
await t('forged / tampered / expired tokens are rejected', async () => {
  const good = I.signToken('draco-' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12));
  assert.ok(I.verifyToken(good));
  assert.equal(I.verifyToken(good.slice(0, -2) + 'AA'), null); assert.equal(I.verifyToken('x.y'), null); assert.equal(I.verifyToken(null), null);
  const [payload] = good.split('.'); assert.equal(I.verifyToken(payload + '.' + Buffer.alloc(32).toString('base64url')), null);
  assert.equal(I.verifyToken(I.signToken('draco-' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12), Date.now() - 10 * 60 * 1000)), null);
  assert.equal(I.verifyToken(I.signToken('../../etc/passwd')), null);
  assert.equal((await I.pollSession('bogus', 0, 0))[1], 401); assert.equal((await I.sendInput('bogus', 'x'))[1], 401); assert.equal((await I.stopSession('bogus'))[1], 401);
});
await t('input limits: empty, oversize', async () => {
  const term = await start('python', { code: 'import time\ntime.sleep(3)' });
  assert.equal((await I.sendInput(term.token, ''))[1], 400); assert.equal((await I.sendInput(term.token, 'x'.repeat(5000)))[1], 413); await I.stopSession(term.token);
});
await t('shell metacharacters typed into the terminal are data, never commands', async () => {
  const term = await start('python', { code: 'print("got:", input())' }); await term.type('$(touch /tmp/pwned_draco); `id`; "quote\'s"'); await term.until(/got: \$\(touch/);
  const fs = await import('node:fs'); assert.equal(fs.existsSync('/tmp/pwned_draco'), false); await term.finish();
});

console.log('HTTP');
async function call(path, body, headers = {}) {
  let status, out = ''; const res = { setHeader() {}, end(b) { out = b || ''; }, set statusCode(v) { status = v; }, get statusCode() { return status; } };
  await handler({ method: 'POST', url: path, headers: { 'x-forwarded-for': '9.9.9.' + Math.floor(Math.random() * 250), ...headers }, body }, res);
  return { status, json: out ? JSON.parse(out) : null };
}
await t('guest can open a terminal for Python and talk to it through the HTTP API', async () => {
  const s = await call('/session/start', { language: 'python', code: 'print("hi", input("? "))' }); assert.equal(s.status, 200, JSON.stringify(s.json));
  const tok = s.json.session; let text = '', off = 0;
  const pump = async () => { const r = await call('/session/poll', { session: tok, offset: off, wait: 800 }); assert.equal(r.status, 200); text += Buffer.from(r.json.chunk || '', 'base64').toString(); off = r.json.offset ?? off; return r.json; };
  for (let i = 0; i < 10 && !/\? $/.test(text); i++) await pump();
  assert.match(text, /\? $/); assert.equal((await call('/session/input', { session: tok, text: 'bob\n' })).status, 200);
  let last; for (let i = 0; i < 10 && !(last = await pump()).done; i++);
  assert.match(text, /hi bob/); assert.equal(last.exitCode, 0);
});
await t('guest cannot start Java/C/C++ terminals (401), same rule as /execute', async () => {
  assert.equal((await call('/session/start', { language: 'java', code: 'class Main{}' })).status, 401);
});
await t('project terminals require sign-in', async () => {
  assert.equal((await call('/session/start', { language: 'python', files: [{ path: 'main.py', content: 'print(1)' }], entry: 'main.py' })).status, 401);
});
await t('bad payloads: 400/404', async () => {
  assert.equal((await call('/session/start', { language: 'python' })).status, 400); assert.equal((await call('/session/nope', {})).status, 404);
  assert.equal((await call('/session/poll', { session: 'x' })).status, 401);
});
await t('no sandboxes leaked by the whole suite', async () => { await new Promise((r) => setTimeout(r, 300)); assert.equal(fake.created, fake.stopped); });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
