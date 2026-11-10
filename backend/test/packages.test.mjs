// Package installation must never take a run (or every later run) down.
import assert from 'node:assert/strict';
import { fakeFactory } from './fake-sandbox.mjs';
const R = await import('../lib/runner.js');
const I = await import('../lib/interactive.js');
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  PASS ', name); } catch (e) { fail++; console.log('  FAIL ', name, '\n       ', String(e.stack || e.message).slice(0, 400)); } }

// A sandbox whose package managers are simulated (no network): names containing "bad" fail, "slow" times out.
function pkgFactory(log, opts = {}) {
  return async (o) => {
    log.timeouts.push(o?.timeoutMs);
    const sb = await fakeFactory(o);
    const run = sb.runCommand.bind(sb);
    sb.update = async (p) => { log.updates.push(p.networkPolicy); if (opts.allowFails && typeof p.networkPolicy === 'object') throw new Error('plan does not support network policies'); if (opts.denyFails && p.networkPolicy === 'deny-all') throw new Error('cannot close network'); };
    sb.runCommand = async (c) => {
      if (c.cmd === 'timeout') {                       // timeout -k 2 SECS <tool> args...
        const [tool, ...args] = c.args.slice(3); const joined = args.join(' ');
        log.installs.push(`${tool} ${joined}`);
        if (/slow/.test(joined)) return { exitCode: 124 };
        if (/bad/.test(joined)) return { exitCode: 1 };
        return { exitCode: 0 };
      }
      if (c.cmd === 'curl') { log.installs.push('curl ' + c.args.join(' ')); return { exitCode: /bad/.test(c.args.join(' ')) ? 22 : 0 }; }
      if (c.cmd === 'mkdir' || c.cmd === 'sed') return { exitCode: 0 };
      return run(c);
    };
    return sb;
  };
}
const fresh = () => ({ updates: [], installs: [], timeouts: [] });
const py = [{ name: 'goodpkg', version: '' }, { name: 'badpkg', version: '' }];

console.log('a bad package no longer breaks runs');
await t('Python: one bad package -> the program still runs, only the bad one is reported', async () => {
  const log = fresh(); const [r, s] = await R.execute('python', 'print("still works")', '', pkgFactory(log), { packages: py });
  assert.equal(s, 200, JSON.stringify(r)); assert.equal(r.stdout.trim(), 'still works'); assert.equal(r.exitCode, 0);
  assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /^Package badpkg:/); assert.doesNotMatch(r.warnings.join(), /goodpkg/); assert.match(r.stderr, /Package badpkg/);
});
await t('Python: all packages good -> no warnings, one install command', async () => {
  const log = fresh(); const [r, s] = await R.execute('python', 'print(1)', '', pkgFactory(log), { packages: [{ name: 'a', version: '1.0' }, { name: 'b', version: '' }] });
  assert.equal(s, 200); assert.equal(r.warnings, undefined); const real = log.installs.filter((x) => /pip install/.test(x)); assert.equal(real.length, 1); assert.match(real[0], /a==1\.0 b/);
});
await t('Python: single bad package is reported without pointless retries', async () => {
  const log = fresh(); const [r] = await R.execute('python', 'print(1)', '', pkgFactory(log), { packages: [{ name: 'badpkg', version: '' }] });
  assert.equal(r.exitCode, 0); assert.equal(r.warnings.length, 1); assert.equal(log.installs.filter((x) => /pip install/.test(x)).length, 1);
});
await t('Python: a timed-out install is reported as such', async () => {
  const log = fresh(); const [r] = await R.execute('python', 'print(1)', '', pkgFactory(log), { packages: [{ name: 'slowpkg', version: '' }] });
  assert.equal(r.exitCode, 0); assert.match(r.warnings[0], /timed out/);
});
await t('JavaScript: bad package skipped, run works', async () => {
  const [r, s] = await R.execute('javascript', 'console.log("js ok")', '', pkgFactory(fresh()), { packages: [{ name: 'lodash', version: '' }, { name: 'badthing', version: '' }] });
  assert.equal(s, 200); assert.equal(r.stdout.trim(), 'js ok'); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /badthing/);
});
await t('Java: a jar that cannot be downloaded is skipped, program still runs', async () => {
  const [r, s] = await R.execute('java', 'public class Main{public static void main(String[] a){System.out.println("java ok");}}', '', pkgFactory(fresh()), { packages: [{ name: 'org.good:lib:1.0', version: '' }, { name: 'org.bad:lib:1.0', version: '' }, { name: 'not-coordinates', version: '' }] });
  assert.equal(s, 200, JSON.stringify(r)); assert.equal(r.stdout.trim(), 'java ok'); assert.equal(r.warnings.length, 2);
});
await t('C: an unsupported system library is skipped with a warning; compile still happens', async () => {
  const [r, s] = await R.execute('c', '#include <stdio.h>\nint main(){puts("c ok");}', '', pkgFactory(fresh()), { packages: [{ name: 'libnotreal-dev', version: '' }] });
  assert.equal(s, 200); assert.equal(r.stdout.trim(), 'c ok'); assert.match(r.warnings[0], /not in the supported/);
});
await t('project runs get the same protection', async () => {
  const [r, s] = await R.executeProject('python', [{ path: 'main.py', content: 'print("proj ok")' }], 'main.py', '', pkgFactory(fresh()), { packages: py });
  assert.equal(s, 200); assert.equal(r.stdout.trim(), 'proj ok'); assert.equal(r.warnings.length, 1);
});
await t('interactive terminals report skipped packages up front', async () => {
  const [r, s] = await I.startSession('python', { code: 'print("t")' }, '', { factory: pkgFactory(fresh()), packages: py });
  assert.equal(s, 200, JSON.stringify(r)); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /badpkg/);
  await I.stopSession(r.session);
});

console.log('network safety');
await t('network is closed again after installs (allow-list then deny-all)', async () => {
  const log = fresh(); await R.execute('python', 'print(1)', '', pkgFactory(log), { packages: py });
  assert.deepEqual(log.updates, [{ allow: ['pypi.org', 'files.pythonhosted.org'] }, 'deny-all']);
});
await t('if the network policy cannot be opened, packages are skipped and the run still works', async () => {
  const log = fresh(); const [r, s] = await R.execute('python', 'print("ok")', '', pkgFactory(log, { allowFails: true }), { packages: py });
  assert.equal(s, 200); assert.equal(r.stdout.trim(), 'ok'); assert.equal(r.warnings.length, 2); assert.equal(log.updates.at(-1), 'deny-all');
});
await t('if the network cannot be CLOSED, user code is never run (fails loudly)', async () => {
  const log = fresh(); const [r, s] = await R.execute('python', 'print("must not run")', '', pkgFactory(log, { denyFails: true }), { packages: py });
  assert.equal(s, 502); assert.doesNotMatch(JSON.stringify(r), /must not run/);
});

console.log('sandbox lifetime and error messages');
await t('a sandbox that installs packages lives longer; one without packages keeps the default', async () => {
  const a = fresh(); await R.execute('python', 'print(1)', '', pkgFactory(a), { packages: py }); assert.equal(a.timeouts[0], 180000);
  const b = fresh(); await R.execute('python', 'print(1)', '', pkgFactory(b), { packages: [] }); assert.equal(b.timeouts[0], undefined);
});
await t('timeouts are NOT reported as "free allowance used up"', () => {
  for (const m of ['Sandbox timeout exceeded', 'sandbox has exceeded its maximum duration', 'Request exceeded 60s limit', 'Sandbox stopped: out of memory limit exceeded']) { assert.equal(R.isCapacityError(new Error(m)), false, m); }
  assert.equal(R.isTimeoutError(new Error('Sandbox timeout exceeded')), true); assert.equal(R.isTimeoutError(new Error('sandbox has expired')), true);
});
await t('real allowance problems are still recognised', () => {
  for (const e of [Object.assign(new Error('x'), { status: 429 }), Object.assign(new Error('x'), { status: 402 }), new Error('Rate limit hit'), new Error('usage limit reached'), new Error('quota exhausted'), new Error('Payment required')]) assert.equal(R.isCapacityError(e), true, e.message);
});
await t('a sandbox that dies mid-install gives the timeout message (504), not the allowance one', async () => {
  const f = async (o) => { const sb = await fakeFactory(o); sb.update = async () => {}; sb.runCommand = async () => { throw new Error('Sandbox timeout exceeded'); }; return sb; };
  const [r, s] = await R.execute('python', 'print(1)', '', f, { packages: py }); assert.equal(s, 504); assert.equal(r.code, 'timeout'); assert.match(r.error, /ran out of time/);
});
await t('no sandboxes leaked', async () => { const f = await import('./fake-sandbox.mjs'); assert.equal(f.created, f.stopped); });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
