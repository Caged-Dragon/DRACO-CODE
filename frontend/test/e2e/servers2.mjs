import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fakeFactory } from '/home/claude/draco/backend/test/fake-sandbox.mjs';
globalThis.__DRACO_SANDBOX_FACTORY = fakeFactory;
const { executeProject, execute } = await import('/home/claude/draco/backend/lib/runner.js');
const I = await import('/home/claude/draco/backend/lib/interactive.js');
const root = '/home/claude/draco/frontend';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
// PostgREST behind a Supabase-style /rest/v1 prefix
http.createServer((req, res) => { const p = http.request({ host: '127.0.0.1', port: 3000, path: req.url.replace(/^\/rest\/v1/, ''), method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, { ...r.headers, 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); r.pipe(res); }); req.pipe(p); }).listen(3100);
// static frontend, config generated like scripts/build.mjs would
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = u.pathname === '/' ? '/index.html' : u.pathname;
  if (p === '/assets/config.js') { res.setHeader('content-type', 'text/javascript'); return res.end('window.DRACOCODE_CONFIG=Object.freeze({BACKEND_URL:"http://localhost:8787",SUPABASE_URL:"http://localhost:3100",SUPABASE_ANON_KEY:"sb_publishable_testkey_1234567890"});window.DRACOSKILL_CONFIG={BACKEND_URL:"http://localhost:8787"};'); }
  if (p === '/vendor/supabase.js') { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync('/tmp/e2e/node_modules/@supabase/supabase-js/dist/umd/supabase.js')); }
  const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(8000);
// REAL backend handler (backend/api/index.js) with Supabase redirected to local PostgREST. Only the sandbox is a stand-in.
import { createHmac } from 'node:crypto';
const HOST = 'https://gbeurqibcfvquacasofq.supabase.co';
const realFetch = globalThis.fetch;
const subOf = (auth) => { try { return JSON.parse(Buffer.from(String(auth).replace(/^Bearer /, '').split('.')[1], 'base64url').toString()).sub; } catch { return null; } };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(HOST + '/auth/v1/user')) { const sub = subOf(init?.headers?.Authorization || init?.headers?.authorization); return sub ? new Response(JSON.stringify({ id: sub, email: 'user@example.com' }), { status: 200 }) : new Response('{}', { status: 401 }); }
  if (u.startsWith(HOST)) return realFetch(u.replace(HOST, 'http://localhost:3100'), init);
  return realFetch(url, init);
};
globalThis.__DRACO_SUPABASE_FETCH = async (url) => new Response(String(url).endsWith('code_consume_run') ? JSON.stringify([{ is_allowed: true, remaining_requests: 50 }]) : 'null', { status: 200 });
Object.assign(process.env, { VERCEL: '1', SUPABASE_URL: HOST, SUPABASE_ANON_KEY: 'sb_publishable_test_key', CODE_BACKEND_SHARED_SECRET: 'backend-test-secret-that-is-over-32-chars', CODE_RATE_LIMIT_SECRET: 'rate-test-secret-that-is-over-32-characters', ALLOWED_ORIGINS: 'http://localhost:8000' });
// toggle: the file /tmp/e2e/NO_TOOLCHAIN makes compilers "not found" (a backend whose /setup was never run)
const { existsSync } = await import('node:fs');
globalThis.__DRACO_SANDBOX_FACTORY = async (o) => {
  const sb = await fakeFactory(o); const written = new Map(); const wf = sb.writeFiles.bind(sb), run = sb.runCommand.bind(sb);
  sb.update = async () => {};
  sb.writeFiles = async (files) => { for (const f of files) written.set(String(f.path).split('/').pop(), Buffer.from(f.content).toString()); return wf(files); };
  sb.runCommand = async (c) => {
    if (noSnap() && c.cmd === 'bash' && c.args && /^(w_)?(compile|run)\.sh$/.test(c.args[0]) ) { const body = written.get(c.args[0].replace(/^w_/, '')) || ''; if (/javac|gcc|g\+\+/.test(body)) return { exitCode: 127, stdout: async () => '', stderr: async () => 'javac: command not found' }; }
    return run(c);
  };
  return sb;
};
// compiler-snapshot simulation: NO_TOOLCHAIN = the backend never ran /setup; SETUP_DONE = it finished
const noSnap = () => existsSync('/tmp/e2e/NO_TOOLCHAIN') && !existsSync('/tmp/e2e/SETUP_DONE');
const setupBox = { sandbox: null };
globalThis.__DRACO_SETUP_CLIENT = {
  async findSnapshot() { return noSnap() ? null : 'snap_e2e'; },
  async getSandbox() { return setupBox.sandbox; },
  async createSandbox() { const sb = await fakeFactory(); setupBox.sandbox = sb; sb.runCommand = async () => ({}); sb.delete = async () => { setupBox.sandbox = null; }; return sb; },
};
const { default: handler } = await import('/home/claude/draco/backend/api/index.js');
http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', '*'); res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  { const now = noSnap(); if (now !== globalThis.__lastNoSnap) { (await import('/home/claude/draco/backend/lib/toolchain.js')).forgetSnapshot(); globalThis.__lastNoSnap = now; } }
  if (noSnap()) process.env.DRACO_REQUIRE_TOOLCHAIN = '1'; else delete process.env.DRACO_REQUIRE_TOOLCHAIN;
  let body = ''; for await (const c of req) body += c; try { req.body = body ? JSON.parse(body) : undefined; } catch { req.body = undefined; }
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  const wrapped = { setHeader: (k, v) => res.setHeader(k, v), end: (b) => res.end(b), set statusCode(v) { res.statusCode = v; }, get statusCode() { return res.statusCode; }, write: (b) => res.write(b) };
  try { await handler(req, wrapped); } catch (e) { console.error('handler crashed', e); res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message) })); }
}).listen(8787);
console.log('servers up (real backend handler)');
