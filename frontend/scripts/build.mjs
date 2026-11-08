import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const required = ['DRACO_BACKEND_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = required.filter((key) => !String(process.env[key] || '').trim());
if (missing.length) throw new Error(`Missing frontend build environment variables: ${missing.join(', ')}`);

const backendUrl = new URL(process.env.DRACO_BACKEND_URL);
const supabaseUrl = new URL(process.env.SUPABASE_URL);
if (backendUrl.protocol !== 'https:' || supabaseUrl.protocol !== 'https:') throw new Error('Production API and Supabase URLs must use HTTPS.');
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(process.env.SUPABASE_ANON_KEY) && process.env.SUPABASE_ANON_KEY.length < 20) throw new Error('SUPABASE_ANON_KEY does not look like a valid publishable/anon key.');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ['index.html', 'sw.js', 'favicon.ico', 'assets', 'app']) {
  await cp(resolve(root, name), resolve(dist, name), { recursive: true });
}
const config = {
  BACKEND_URL: backendUrl.origin,
  SUPABASE_URL: supabaseUrl.origin,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
};
await writeFile(resolve(dist, 'assets/config.js'),
  `// Generated during the Vercel build. Public values only.\nwindow.DRACOCODE_CONFIG = Object.freeze(${JSON.stringify(config)});\nwindow.DRACOSKILL_CONFIG = { BACKEND_URL: window.DRACOCODE_CONFIG.BACKEND_URL };\n`,
  { mode: 0o644 }
);
console.log('Draco Code frontend built with environment-based public configuration.');
