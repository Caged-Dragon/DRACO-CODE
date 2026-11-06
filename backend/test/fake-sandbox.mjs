// A LOCAL stand-in for @vercel/sandbox with the same surface our code uses
// (writeFiles / runCommand / readFileToBuffer / stop). It runs commands in a
// temp folder on this machine. It tests OUR logic -- the shell scripts, output
// handling, verdicts, routing -- not Vercel's API or its isolation.
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = '/vercel/sandbox';
export let created = 0, stopped = 0;

export const registry = new Map();            // named sandboxes, like Sandbox.get({ name })
globalThis.__DRACO_SANDBOX_GET = async (name) => registry.get(name) || null;
export async function fakeFactory(opts = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'fakesbx-'));
  created++;
  const children = [];
  const map = (p) => (p.startsWith(ROOT) ? path.join(dir, p.slice(ROOT.length)) : path.join(dir, p));
  const sandbox = {
    async writeFiles(files) {
      for (const f of files) {
        const dest = map(f.path);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, f.content);
      }
    },
    async readFileToBuffer({ path: p }) {
      try { return await readFile(map(p)); } catch { return null; }
    },
    runCommand({ cmd, args = [], cwd, detached }) {
      if (detached) { // keep running after we return, like a real detached command
        const child = execFile(cmd, args, { cwd: cwd ? map(cwd) : dir, detached: true }, () => {}); children.push(child);
        return Promise.resolve({});
      }
      return new Promise((resolve) => {
        execFile(cmd, args, { cwd: cwd ? map(cwd) : dir, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
          resolve({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: async () => stdout, stderr: async () => stderr });
        });
      });
    },
    async stop() { if (stoppedOnce) return; stoppedOnce = true; stopped++; for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } } if (opts.name) registry.delete(opts.name); await rm(dir, { recursive: true, force: true }); },
  };
  let stoppedOnce = false;
  if (opts.name) registry.set(opts.name, sandbox);
  return sandbox;
}

// Stand-in for the setup client (lib/toolchain.js): one named sandbox + one snapshot slot, in memory.
export function makeFakeSetupClient() {
  const st = { sbx: null, snap: null, creates: 0, deletes: 0 };
  return {
    st,
    findSnapshot: async () => st.snap,
    getSandbox: async () => st.sbx,
    async createSandbox() {
      st.creates++;
      const sb = await fakeFactory();
      sb.delete = async () => { st.deletes++; st.sbx = null; };
      sb.snapshot = async () => { st.snap = 'snap_fake1234567890'; return { snapshotId: st.snap }; };
      st.sbx = sb;
      return sb;
    },
  };
}
