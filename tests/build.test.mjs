/*
 * scripts/build.mjs produces the deployable dist/ for Render. These tests run
 * the real build (including esbuild) into temp dirs — never into dist/ — and
 * check the output the way a browser would resolve it.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { repoRoot } from './helpers/harness.mjs';

const COMMIT = 'abcdef1234567890abcdef1234567890abcdef12';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigcon-build-'));
const outA = path.join(tmp, 'a');
const outB = path.join(tmp, 'b');

function runBuild(out, env = {}) {
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/build.mjs'), '--out', out], {
    cwd: repoRoot, encoding: 'utf8', env: { ...process.env, RENDER_GIT_COMMIT: COMMIT, ...env },
  });
  assert.equal(r.status, 0, 'build failed:\n' + r.stdout + r.stderr);
  return r;
}
const walk = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(e => {
  const r = rel ? rel + '/' + e.name : e.name;
  return e.isDirectory() ? walk(dir, r) : [r];
}).sort();
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

before(() => { runBuild(outA); runBuild(outB); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const isExternal = u => /^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(u);
/* local file references written in an HTML page (src/href with plain paths) */
function htmlRefs(file) {
  const html = fs.readFileSync(file, 'utf8');
  return [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)].map(m => m[1])
    .filter(u => u && !isExternal(u) && !/["'`$+{}]/.test(u));
}
function jsImports(file) {
  const js = fs.readFileSync(file, 'utf8');
  return [...js.matchAll(/\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g)].map(m => m[1])
    .concat([...js.matchAll(/^\s*(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"'\n]+)["']/gm)].map(m => m[1]))
    .filter(u => !isExternal(u) && /^[./]/.test(u));
}
const resolve = (out, fromRel, ref) => {
  const clean = ref.replace(/[?#].*$/, '');
  return clean.startsWith('/') ? path.join(out, clean) : path.join(out, path.dirname(fromRel), clean);
};

test('BUILD_COMMIT is injected from RENDER_GIT_COMMIT (first 7 chars) into the output only', () => {
  const html = fs.readFileSync(path.join(outA, 'index.html'), 'utf8');
  assert.match(html, /const BUILD_COMMIT = 'abcdef1';/);
  assert.equal((html.match(/const BUILD_COMMIT\b/g) || []).length, 1);
  const src = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  assert.doesNotMatch(src, /BUILD_COMMIT = 'abcdef1'/, 'the source index.html is never modified');
});

test('without RENDER_GIT_COMMIT the stamp falls back to git HEAD or "dev" — always a safe token', () => {
  const out = path.join(tmp, 'fallback');
  runBuild(out, { RENDER_GIT_COMMIT: '' });
  const m = fs.readFileSync(path.join(out, 'index.html'), 'utf8').match(/const BUILD_COMMIT = '([^']*)';/);
  assert.ok(m && /^([0-9a-f]{7}|dev)$/.test(m[1]), 'got ' + (m && m[1]));
});

test('every local src/href/import in the dist HTML and JS resolves to an existing file', () => {
  const files = walk(outA);
  const pages = files.filter(f => f.endsWith('.html'));
  assert.deepEqual(pages.sort(), ['discord.html', 'exhibits.html', 'index.html', 'logs.html']);
  let checked = 0;
  for (const page of pages) {
    for (const ref of htmlRefs(path.join(outA, page))) {
      const target = resolve(outA, page, ref);
      assert.ok(fs.existsSync(target), `${page}: ${ref} does not exist in the output`);
      checked++;
    }
  }
  for (const js of files.filter(f => f.endsWith('.js'))) {
    for (const ref of jsImports(path.join(outA, js))) {
      assert.ok(fs.existsSync(resolve(outA, js, ref)), `${js}: import ${ref} does not exist in the output`);
      checked++;
    }
  }
  assert.ok(checked >= 6, 'actually checked some references (' + checked + ')');
  // the dynamic SDK import inside the game bundle must be one of them
  const main = files.find(f => /^static\/js\/main\.[0-9a-f]{10}\.js$/.test(f));
  assert.ok(main, 'the game bundle was hashed');
  assert.deepEqual(jsImports(path.join(outA, main)).map(r => path.basename(r)).filter(n => n.startsWith('discord-sdk.bundle.')).length, 1);
});

test('the game ships as ONE bundled ES module: the source modules are folded in, not published', () => {
  const files = walk(outA);
  const js = files.filter(f => f.endsWith('.js'));
  assert.deepEqual(js.map(f => f.replace(/\.[0-9a-f]{10}\.js$/, '.js')).sort(), ['static/discord-sdk.bundle.js', 'static/js/main.js']);
  for (const gone of ['static/bots', 'static/js/engine', 'static/js/net', 'static/js/ui', 'static/js/hooks', 'static/js/discord', 'static/js/data'])
    assert.ok(!files.some(f => f.startsWith(gone)), gone + ' is bundled, not shipped separately');
  const main = files.find(f => /^static\/js\/main\.[0-9a-f]{10}\.js$/.test(f));
  const text = fs.readFileSync(path.join(outA, main), 'utf8');
  for (const marker of ['function applyIntent', 'function pubState', 'function initUI', 'function initDiscord', 'BigConBots', 'function boot()'])
    assert.ok(text.includes(marker), 'the bundle contains ' + marker);
  assert.deepEqual(jsImports(path.join(outA, main)).map(r => path.basename(r)).filter(n => !n.startsWith('discord-sdk.bundle.')), [], 'no relative module imports survive: the bundle is self-contained');
  assert.match(text, /typeof BUILD_COMMIT/, 'the stamp is still read as a free identifier from the inline classic script');
  const html = fs.readFileSync(path.join(outA, 'index.html'), 'utf8');
  assert.match(html, /<script type="module" src="\.\/static\/js\/main\.[0-9a-f]{10}\.js"><\/script>/);
  assert.ok(html.indexOf("const BUILD_COMMIT = 'abcdef1';") < html.indexOf('type="module"'), 'the inline stamp comes before the module');
});

test('no unhashed local .js/.css reference remains, and no unhashed .js/.css file is shipped', () => {
  const hashed = /\.[0-9a-f]{10}\.(js|css)$/;
  const files = walk(outA);
  for (const f of files.filter(f => /\.(js|css)$/.test(f))) assert.match(f, hashed, f + ' is content-hashed');
  for (const page of files.filter(f => f.endsWith('.html'))) {
    for (const ref of htmlRefs(path.join(outA, page)).filter(r => /\.(js|css)$/.test(r.replace(/[?#].*$/, ''))))
      assert.match(ref, hashed, `${page}: ${ref} must be hashed`);
  }
  for (const js of files.filter(f => f.endsWith('.js'))) {
    for (const ref of jsImports(path.join(outA, js))) assert.match(ref.replace(/[?#].*$/, ''), hashed, `${js}: ${ref} must be hashed`);
  }
  assert.ok(!files.includes('static/discord-sdk-entry.js') && !files.includes('static/discord-sdk.bundle.js'));
  // index.html still loads everything, in the original order
  const html = fs.readFileSync(path.join(outA, 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script\b[^>]*\bsrc="\.\/static\/(?:js\/)?([a-z]+)\.[0-9a-f]{10}\.js"/g)].map(m => m[1]);
  assert.deepEqual(order, ['main']);
  assert.match(html, /<link rel="stylesheet" href="\.\/static\/css\/bigcon-ui\.[0-9a-f]{10}\.css">/);
});

test('hashes are deterministic across builds and match the file content', () => {
  const a = walk(outA), b = walk(outB);
  assert.deepEqual(a, b, 'same file names (so same hashes)');
  for (const f of a) assert.equal(sha(path.join(outA, f)), sha(path.join(outB, f)), f + ' differs between builds');
  for (const f of a.filter(f => /\.[0-9a-f]{10}\.(js|css)$/.test(f))) {
    const m = f.match(/\.([0-9a-f]{10})\.(?:js|css)$/);
    assert.equal(sha(path.join(outA, f)).slice(0, 10), m[1], f + ': name hash is the content hash');
  }
});

test('the game bundle hashes its rewritten content (a changed SDK bundle changes its name)', () => {
  const files = walk(outA);
  const bundle = files.find(f => /^static\/discord-sdk\.bundle\.[0-9a-f]{10}\.js$/.test(f));
  assert.ok(bundle, 'bundle emitted into dist');
  const bundleHash = bundle.match(/\.([0-9a-f]{10})\.js$/)[1];
  const main = files.find(f => /^static\/js\/main\.[0-9a-f]{10}\.js$/.test(f));
  assert.ok(main, 'the game bundle was hashed');
  assert.ok(fs.readFileSync(path.join(outA, main), 'utf8').includes('discord-sdk.bundle.' + bundleHash + '.js'));
  const src = fs.readFileSync(path.join(repoRoot, 'static/js/discord.js'), 'utf8');
  assert.ok(src.includes('"/static/discord-sdk.bundle.js"'), 'source keeps the plain path');
});

test('images (including names with spaces), characters and the DLC folder are copied unhashed', () => {
  const srcStatic = walk(path.join(repoRoot, 'static')).filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f));
  assert.ok(srcStatic.some(f => f.includes(' ')), 'fixture sanity: some source images have spaces');
  assert.ok(srcStatic.some(f => f.startsWith('GeographyDLC/')));
  for (const f of srcStatic) {
    const dest = path.join(outA, 'static', f);
    assert.ok(fs.existsSync(dest), 'static/' + f + ' copied');
    assert.equal(sha(dest), sha(path.join(repoRoot, 'static', f)));
  }
  for (const f of walk(path.join(repoRoot, 'characters'))) assert.ok(fs.existsSync(path.join(outA, 'characters', f)), 'characters/' + f);
  for (const f of ['favicon.ico', 'big con logo.png', 'whatsappbigcon_1.gif']) assert.ok(fs.existsSync(path.join(outA, f)), f);
});

test('dev-only folders and files are not published', () => {
  const files = walk(outA);
  for (const bad of ['tests/', 'docs/', 'cloudflare-relay/', 'node_modules/', '.github/', 'scripts/'])
    assert.ok(!files.some(f => f.startsWith(bad)), bad + ' leaked into dist');
  for (const bad of ['package.json', 'package-lock.json', 'README.md', 'render.yaml'])
    assert.ok(!files.includes(bad), bad + ' leaked into dist');
});

test('the build refuses to write over the repo root', () => {
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/build.mjs'), '--out', repoRoot], { cwd: repoRoot, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.ok(fs.existsSync(path.join(repoRoot, 'index.html')));
});

test('render.yaml describes a static site that publishes dist/ with cache headers', () => {
  const y = fs.readFileSync(path.join(repoRoot, 'render.yaml'), 'utf8');
  assert.match(y, /runtime:\s*static/);
  assert.match(y, /buildCommand:\s*npm ci\b.*&&\s*npm run build\s*$/m);
  assert.match(y, /staticPublishPath:\s*\.\/dist/);
  assert.match(y, /path:\s*\/\*\.html[\s\S]*?value:\s*no-cache/);
  assert.match(y, /path:\s*\/\*\*\/\*\.js[\s\S]*?public, max-age=31536000, immutable/);
  assert.match(y, /path:\s*\/\*\*\/\*\.css[\s\S]*?public, max-age=31536000, immutable/);
});

test('the SDK bundle is a build artifact: not committed, git-ignored, and not required at the repo root', () => {
  const ignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.match(ignore, /^dist\/$/m);
  assert.match(ignore, /^static\/discord-sdk\.bundle\.js$/m);
  assert.ok(!fs.existsSync(path.join(repoRoot, '.github/workflows/check-build-commit.yml')));
  assert.ok(!fs.existsSync(path.join(repoRoot, '.github/workflows/build-discord-sdk.yml')));
});
