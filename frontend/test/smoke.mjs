import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const app = await readFile(path.join(root, 'app/app.js'), 'utf8');
const config = await readFile(path.join(root, 'assets/config.js'), 'utf8');
const css = await readFile(path.join(root, 'app/styles.css'), 'utf8');
const sw = await readFile(path.join(root, 'sw.js'), 'utf8');

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const referenced = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
const missing = [...referenced].filter((id) => !ids.has(id));
assert.deepEqual(missing, [], `App references missing DOM IDs: ${missing.join(', ')}`);

for (const [name, content] of [['app.js', app], ['config.js', config], ['editor.js', await readFile(path.join(root, 'assets/editor.js'), 'utf8')], ['highlight.js', await readFile(path.join(root, 'assets/highlight.js'), 'utf8')], ['theme.js', await readFile(path.join(root, 'assets/theme.js'), 'utf8')]]) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['--check', '--input-type=commonjs'], { input: content, encoding: 'utf8' });
  assert.equal(result.status, 0, `${name} syntax error: ${result.stderr}`);
}

for (const asset of ['assets/design.css', 'assets/theme.js', 'assets/highlight.js', 'assets/editor.js', 'assets/config.js', 'app/styles.css', 'app/app.js', 'assets/dracoskill-mark.png', 'assets/icons/favicon-32.png']) {
  await access(path.join(root, asset));
}
assert.match(config, /https:\/\/draco-code-backend\.vercel\.app/);
assert.match(html, /id="account-menu-button"/);
assert.match(html, /id="account-panel"/);
assert.match(app, /function canUseLanguage/);
assert.match(app, /initAccount\(\)/);
assert.match(app, /headers.Authorization/);
assert.match(config, /http:\/\/localhost:8787/);
for (const pwaAsset of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'maskable-512.png']) {
  await assert.rejects(access(path.join(root, 'assets/icons', pwaAsset)));
}
assert.doesNotMatch(html + app + config + sw, /beforeinstallprompt|appinstalled|manifest\.webmanifest|Install App/i);
assert.doesNotMatch(css, /\.install-button|\.install-app/i);
assert.match(app, /python: \{ label: 'Python', extension: '\.py'/);
assert.match(app, /javascript: \{ label: 'JavaScript', extension: '\.js'/);
assert.match(app, /java: \{ label: 'Java', extension: '\.java'/);
assert.match(app, /c: \{ label: 'C', extension: '\.c'/);
assert.match(app, /cpp: \{ label: 'C\+\+', extension: '\.cpp'/);

console.log(`Frontend static smoke passed: ${ids.size} DOM IDs, ${referenced.size} code references, all shell assets present, five language starters, no install/manifest code.`);

await access(path.join(root, 'scripts/build.mjs'));
assert.doesNotMatch(config, /sb_publishable_[A-Za-z0-9_-]{20,}/, 'public Supabase key should come from Vercel env at build time');
assert.match(app, /window\.DRACOCODE_CONFIG\?\.SUPABASE_URL/);
assert.match(app, /window\.DRACOCODE_CONFIG\?\.SUPABASE_ANON_KEY/);
