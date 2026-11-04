// Draco Code execution API. User programs run only on isolated Vercel Sandbox microVMs.
// Routes: GET /health, GET /sandboxes, GET /setup, GET /setup/status,
//        POST /setup/start, GET /selfcheck, POST /execute.
import { createHmac, randomUUID } from 'node:crypto';
import { execute } from '../lib/runner.js';
import { describe } from '../lib/status.js';
import { setupPage, startSetup, setupStatus } from '../lib/toolchain.js';
import { selfCheck } from '../lib/selfcheck.js';

const FRONTEND_ORIGIN = 'https://draco-code.vercel.app';
const EXPECTED_SUPABASE_HOST = 'gbeurqibcfvquacasofq.supabase.co';
const PREVIEW_HOST = /^(?:draco-code-frontend|dracoskill-frontend)-[a-z0-9-]+-caged-dragon\.vercel\.app$/i;
const MAX_BODY_BYTES = 400_000;
const RUN_LIMIT = 20;
const RUN_WINDOW_SECONDS = 60;
const hits = new Map();

function limited(key, max, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 2000) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  }
  return false;
}

function normalizedOrigin(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function configuredOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => normalizedOrigin(s.trim())).filter(Boolean);
  return new Set([FRONTEND_ORIGIN, ...fromEnv]);
}

function isLocalDevelopmentOrigin(origin) {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) return false;
  try {
    const u = new URL(origin);
    return ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  } catch { return false; }
}

function originAllowed(req) {
  const raw = req.headers?.origin;
  if (!raw) return true; // CORS is a browser control, not authentication for command-line clients.
  const origin = normalizedOrigin(raw);
  if (!origin) return false;
  if (configuredOrigins().has(origin) || isLocalDevelopmentOrigin(origin)) return true;

  // Preview deployments for this exact frontend Vercel project are allowed; unrelated *.vercel.app sites are not.
  try {
    const host = new URL(origin).hostname;
    if (new URL(origin).protocol === 'https:' && host.endsWith('.vercel.app') && PREVIEW_HOST.test(host)) return true;
    // The backend's own /setup page may make same-origin requests.
    const requestHost = String(req.headers?.host || '').toLowerCase();
    if (requestHost && new URL(origin).host.toLowerCase() === requestHost) return true;
  } catch { return false; }
  return false;
}

function applyCors(req, res) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  const origin = normalizedOrigin(req.headers?.origin || '');
  if (origin && originAllowed(req)) res.setHeader('Access-Control-Allow-Origin', origin);
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}

function supabaseConfigStatus() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const backendSecret = String(process.env.CODE_BACKEND_SHARED_SECRET || '').trim();
  const fingerprintSecret = String(process.env.CODE_RATE_LIMIT_SECRET || '').trim();
  let parsed;
  try { parsed = new URL(url); } catch { parsed = null; }
  const urlMatchesProject = !!parsed && parsed.protocol === 'https:' && parsed.hostname === EXPECTED_SUPABASE_HOST;
  return {
    ready: urlMatchesProject && !!anonKey && backendSecret.length >= 32 && fingerprintSecret.length >= 32,
    urlPresent: !!url,
    urlMatchesProject,
    anonKeyPresent: !!anonKey,
    backendSecretPresent: !!backendSecret,
    backendSecretLengthValid: backendSecret.length >= 32,
    rateLimitSecretPresent: !!fingerprintSecret,
    rateLimitSecretLengthValid: fingerprintSecret.length >= 32
  };
}

function supabaseConfig() {
  const status = supabaseConfigStatus();
  if (!status.ready) return null;
  const parsed = new URL(String(process.env.SUPABASE_URL).trim());
  return {
    url: parsed.origin,
    anonKey: String(process.env.SUPABASE_ANON_KEY).trim(),
    backendSecret: String(process.env.CODE_BACKEND_SHARED_SECRET).trim(),
    fingerprintSecret: String(process.env.CODE_RATE_LIMIT_SECRET).trim()
  };
}

async function callSupabaseRpc(name, args, config) {
  const fetcher = globalThis.__DRACO_SUPABASE_FETCH || fetch;
  const response = await fetcher(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) {
    // Do not return the PostgREST body; it may contain database or configuration details.
    throw new Error(`Supabase RPC ${name} failed (${response.status})`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new Error(`Supabase RPC ${name} returned invalid JSON`); }
}

function requestFingerprint(req, secret) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(req.socket?.remoteAddress || 'unknown');
  const agent = String(req.headers?.['user-agent'] || '').slice(0, 512);
  return createHmac('sha256', secret).update(`${ip}\n${agent}`).digest('hex');
}

function bodyObject(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}

async function authenticatedUser(req, config) {
  const match=/^Bearer\s+([A-Za-z0-9._~-]+)$/i.exec(String(req.headers?.authorization||'')); if(!match)return null;
  const response=await fetch(`${config.url}/auth/v1/user`,{headers:{apikey:config.anonKey,Authorization:`Bearer ${match[1]}`},signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw new Error('Invalid or expired account session.'); const user=await response.json();
  return user&&typeof user.id==='string'?{user,token:match[1]}:null;
}
async function userRows(table,userId,token,config,columns){
  const url=new URL(`${config.url}/rest/v1/${table}`);url.searchParams.set('select',columns);url.searchParams.set('user_id',`eq.${userId}`);
  const response=await fetch(url,{headers:{apikey:config.anonKey,Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw new Error('Could not load account compiler settings.');return response.json();
}
function validatedPackages(language,rows){
  const py=/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/,npm=/^(?:@[a-z0-9][a-z0-9._-]{0,49}\/)?[a-z0-9][a-z0-9._-]{0,99}$/i,maven=/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;
  const c=new Set(['libsqlite3-dev','libssl-dev','libcurl4-openssl-dev']),cpp=new Set(['nlohmann-json3-dev','libboost-dev','libeigen3-dev','libfmt-dev']);
  return rows.filter(r=>{const n=String(r.package_name||''),v=String(r.package_version||'');if(v&&!/^[A-Za-z0-9.+_-]{1,80}$/.test(v))return false;if(language==='python')return py.test(n);if(language==='javascript')return npm.test(n);if(language==='java')return maven.test(n);if(language==='c')return c.has(n);if(language==='cpp')return cpp.has(n);return false;}).map(r=>({name:r.package_name,version:r.package_version||''})).slice(0,20);
}
function safeRunMetrics(body, result, status) {
  const code = typeof body.code === 'string' ? body.code : '';
  const stdin = typeof body.stdin === 'string' ? body.stdin : '';
  const stdout = typeof result?.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result?.stderr === 'string' ? result.stderr : '';
  return {
    p_http_status: status,
    p_exit_code: Number.isInteger(result?.exitCode) ? result.exitCode : null,
    p_timed_out: result?.timedOut === true,
    p_duration_ms: Math.max(0, Math.min(300_000, Math.round(Number(result?.timeMs) || 0))),
    p_code_bytes: Buffer.byteLength(code, 'utf8'),
    p_stdin_bytes: Buffer.byteLength(stdin, 'utf8'),
    p_stdout_bytes: Buffer.byteLength(stdout, 'utf8'),
    p_stderr_bytes: Buffer.byteLength(stderr, 'utf8'),
    p_compile_error: result?.compileError === true
  };
}

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const forwarded = u.searchParams.get('path');
  const raw = forwarded !== null && u.pathname.startsWith('/api') ? '/' + forwarded : u.pathname;
  const path = raw.replace(/\/+$/, '') || '/';
  const allowed = originAllowed(req);
  applyCors(req, res);

  if (!allowed) return send(res, 403, { error: 'This website is not allowed to use this server.' });
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  try {
    if (req.method === 'GET' && path === '/setup') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(setupPage());
    }
    if (path === '/selfcheck' && req.method === 'GET') {
      const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (limited('selfcheck:' + ip, 4)) return send(res, 429, { error: 'Self-check runs at most 4 times a minute.' });
      return send(res, 200, await selfCheck());
    }
    if (path === '/setup/status' && req.method === 'GET') return send(res, 200, await setupStatus());
    if (path === '/setup/start' && req.method === 'POST') {
      const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (limited('setup:' + ip, 2)) return send(res, 429, { error: 'Too many setup requests. Wait a minute.' });
      return send(res, 200, await startSetup());
    }
    if (req.method === 'GET' && path === '/health') {
      const databaseConfig = supabaseConfigStatus();
      return send(res, 200, {
        status: 'ok', service: 'draco-code-execution', backend: 'vercel-sandbox',
        databaseConfigured: databaseConfig.ready,
        databaseConfig
      });
    }
    if (req.method === 'GET' && path === '/sandboxes') {
      return send(res, 200, await describe(undefined, { probe: u.searchParams.get('probe') === '1' }));
    }
    if (req.method === 'POST' && path === '/execute') {
      const contentLength = Number(req.headers?.['content-length'] || 0);
      if (contentLength > MAX_BODY_BYTES) return send(res, 413, { error: 'Request is too large.' });
      const body = bodyObject(req);
      if (!body) return send(res, 400, { error: 'Invalid JSON body.' });
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) return send(res, 413, { error: 'Request is too large.' });
      if (typeof body.language !== 'string' || typeof body.code !== 'string' || (body.stdin !== undefined && typeof body.stdin !== 'string')) {
        return send(res, 400, { error: 'Expected language, code and optional stdin as strings.' });
      }
      if (Buffer.byteLength(body.code, 'utf8') > 200_000 || Buffer.byteLength(body.stdin || '', 'utf8') > 100_000) {
        return send(res, 413, { error: 'Code or input exceeds the supported size limit.' });
      }
      if (!['python', 'javascript', 'java', 'c', 'cpp'].includes(body.language)) {
        return send(res, 400, { error: 'Unsupported language. Choose Python, JavaScript, Java, C or C++.' });
      }

      const config = supabaseConfig();
      const production = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
      if (!config && production) return send(res, 503, { error: 'Execution service is not configured. Please contact the site operator.' });

      let userContext=null, packages=[];
      if(req.headers?.authorization){try{userContext=await authenticatedUser(req,config);}catch{return send(res,401,{error:'Your sign-in session is invalid. Please sign in again.'});}if(!userContext)return send(res,401,{error:'Sign in to use account features.'});}
      if(!['python','javascript'].includes(body.language)){if(!userContext)return send(res,401,{error:'Sign in to unlock Java, C and C++.'});try{const rows=await userRows('draco_user_languages',userContext.user.id,userContext.token,config,'language');if(!rows.some(row=>row.language===body.language))return send(res,403,{error:'Add this language to your account before running it.'});}catch{return send(res,503,{error:'Could not verify your installed languages. Please retry.'});}}
      if(userContext){try{const rows=await userRows('draco_user_packages',userContext.user.id,userContext.token,config,'language,package_name,package_version');packages=validatedPackages(body.language,rows.filter(row=>row.language===body.language));}catch{return send(res,503,{error:'Could not load your package list. Please retry.'});}}
      const requestId = randomUUID();
      const fingerprint = config
        ? requestFingerprint(req, config.fingerprintSecret)
        : requestFingerprint(req, 'local-development-only-fingerprint-key');

      if (config) {
        let quota;
        try {
          quota = await callSupabaseRpc('code_consume_run', {
            p_backend_secret: config.backendSecret,
            p_fingerprint_hash: fingerprint,
            p_limit: RUN_LIMIT,
            p_window_seconds: RUN_WINDOW_SECONDS
          }, config);
        } catch {
          return send(res, 503, { error: 'The execution service could not verify its run limit. Please retry shortly.' });
        }
        const row = Array.isArray(quota) ? quota[0] : quota;
        if (!row || row.is_allowed !== true) {
          return send(res, 429, {
            error: 'Run limit reached. Please wait before running another program.',
            remaining: Math.max(0, Number(row?.remaining_requests) || 0),
            resetAt: row?.reset_at || null
          });
        }
      } else if (limited(fingerprint, RUN_LIMIT, RUN_WINDOW_SECONDS * 1000)) {
        return send(res, 429, { error: 'Too many runs. Please wait a minute.' });
      }

      const [result, status] = await execute(body.language, body.code, body.stdin || '', undefined, {packages});
      res.setHeader('X-Request-Id', requestId);
      if (config) {
        const metrics = safeRunMetrics(body, result, status);
        try {
          await callSupabaseRpc('code_record_execution', {
            p_backend_secret: config.backendSecret,
            p_request_id: requestId,
            p_fingerprint_hash: fingerprint,
            p_language: body.language,
            ...metrics
          }, config);
        } catch {
          // Execution result takes priority; telemetry failure must not hide a correct program result.
          console.error('Draco Code: execution telemetry could not be recorded.');
        }
      }
      return send(res, status, result);
    }
    return send(res, 404, { error: 'Not found.' });
  } catch {
    return send(res, 500, { error: 'Internal server error.' });
  }
}
