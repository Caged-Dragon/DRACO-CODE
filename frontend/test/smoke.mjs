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
const projectJs = await readFile(path.join(root, 'app/project.js'), 'utf8');
const referenced = new Set([...app.matchAll(/\$\('([^']+)'\)/g), ...projectJs.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
const DYNAMIC_IDS = new Set(['ide-context']); // created at runtime by project.js (right-click menu)
const missing = [...referenced].filter((id) => !ids.has(id) && !DYNAMIC_IDS.has(id));
assert.deepEqual(missing, [], `App references missing DOM IDs: ${missing.join(', ')}`);

for (const [name, content] of [['app.js', app], ['project.js', projectJs], ['project-core.js', await readFile(path.join(root, 'app/project-core.js'), 'utf8')], ['project-data.js', await readFile(path.join(root, 'app/project-data.js'), 'utf8')], ['config.js', config], ['editor.js', await readFile(path.join(root, 'assets/editor.js'), 'utf8')], ['highlight.js', await readFile(path.join(root, 'assets/highlight.js'), 'utf8')], ['theme.js', await readFile(path.join(root, 'assets/theme.js'), 'utf8')]]) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['--check', '--input-type=commonjs'], { input: content, encoding: 'utf8' });
  assert.equal(result.status, 0, `${name} syntax error: ${result.stderr}`);
}

for (const asset of ['assets/design.css', 'assets/theme.js', 'assets/highlight.js', 'assets/editor.js', 'assets/config.js', 'app/styles.css', 'app/project.css', 'app/terminal.js', 'app/project.js', 'app/project-core.js', 'app/project-data.js', 'app/app.js', 'assets/dracoskill-mark.png', 'assets/icons/favicon-32.png']) {
  await access(path.join(root, asset));
}
assert.match(config, /https:\/\/draco-code-backend\.vercel\.app/);
assert.match(html, /id="menu-button"/);
assert.match(html, /id="signin-button"/);
assert.match(html, /id="menu-project"/);
assert.match(html, /id="auth-dialog"/);
assert.match(html, /id="project-ide"/);
assert.doesNotMatch(html, /id="account-menu-button"/);
assert.match(html, /id="account-panel"/);
assert.match(app, /function canUseLanguage/);
assert.match(app, /initAccount\(\)/);
assert.match(app, /window\.DracoCore = /);
assert.match(sw, /app\/project\.js/);
assert.match(html, /app\/project\.js/);
assert.match(app, /headers.Authorization/);
assert.match(config, /http:\/\/localhost:8787/);
const vercelConfig = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const csp = vercelConfig.headers.find((entry) => entry.source === '/(.*)').headers.find((entry) => entry.key === 'Content-Security-Policy').value;
assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
assert.match(csp, /https:\/\/gbeurqibcfvquacasofq\.supabase\.co/);
assert.match(csp, /https:\/\/draco-code-backend-vercel-git-codex-draco-c-fd6fe0-caged-dragon\.vercel\.app/);

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
assert.match(html, /New users are saved in Supabase Auth/);
assert.match(html, /@supabase\/supabase-js@2\.57\.4/);
assert.match(app, /supabaseClient\.auth\.signUp/);
assert.match(app, /supabaseClient\.auth\.signInWithPassword/);
assert.match(app, /supabaseClient\.auth\.onAuthStateChange/);
assert.match(app, /supabaseClient\.auth\.getSession/);
assert.match(app, /supabaseClient\.auth\.signOut/);
assert.match(app, /persistSession: true/);
assert.match(app, /emailRedirectTo: authRedirectUrl\(\)/);
assert.match(app, /confirm your email using the link we sent/i);

assert.match(html, /id="layout-toggle-button"/);
assert.match(html, /id="layout-toggle-label">Stacked view/);
assert.match(html, /class="main-column" data-layout="stacked"/, "stacked layout is the default");
assert.match(html, /<span>Terminal<\/span>/, "console is presented as a terminal");
assert.match(html, /app\/terminal\.js/);
assert.match(sw, /app\/terminal\.js/);
assert.match(html, /aria-expanded="false" aria-controls="stdin-wrap"/); // preset input is optional, collapsed by default
assert.match(html, /id="stdin-wrap" hidden/);
assert.match(app, /const LAYOUT_STORAGE_KEY = 'draco-code-layout-v1'/);
assert.match(app, /function loadSavedLayout\(\)/);
assert.match(app, /function setLayout\(layout\)/);
assert.match(app, /function toggleLayout\(\)/);
assert.match(app, /layout-toggle-button.*toggleLayout/s);
assert.match(app, /localStorage\.setItem\(LAYOUT_STORAGE_KEY, selected\)/);
assert.match(css, /\.main-column\[data-layout="split"\]/);
assert.match(css, /\.main-column\[data-layout="stacked"\]/);

const bar = html.slice(html.indexOf('<header class="topbar">'), html.indexOf('<div class="topbar-actions">'));
assert.ok(bar.indexOf('id="menu-button"') < bar.indexOf('id="signin-button"') && bar.indexOf('id="signin-button"') < bar.indexOf('class="brand"'), 'top bar order must be menu, sign in, brand');
assert.equal((html.match(/M4 6h16M4 12h16M4 18h16/g) || []).length, 1, 'only one hamburger icon');
assert.match(html, /data-mode="project"/);
for (const ver of [/Project mode/]) assert.match(html, ver);
console.log('Project-mode shell checks passed.');
