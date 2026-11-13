#!/usr/bin/env node
/*
 * Static-site build for THE BIG CON (Render + Discord Activity).
 *
 *   node scripts/build.mjs [--out <dir>]      (default: dist/, or $BUILD_OUT)
 *
 * What it does, in order:
 *   1. copies the HTML pages and every asset they need into the output dir
 *      (never tests/, docs/, cloudflare-relay/, node_modules/, .github/, scripts/);
 *   2. bundles the Discord Embedded App SDK with esbuild straight into the
 *      output dir (the committed static/discord-sdk.bundle.js is not touched);
 *   3. bundles the game: the page's single entry module (static/js/main.js and
 *      everything it imports — the rules engine, net, ui, bots, Discord glue)
 *      becomes ONE ES-module file, and the individual source modules are not
 *      shipped. Only the dynamic import of the SDK bundle stays external.
 *      landing.html's reel (static/landing/reel.js) is bundled the same way,
 *      with three.js left external for the page's import map;
 *   4. stamps BUILD_COMMIT in the output's index.html from $RENDER_GIT_COMMIT,
 *      falling back to `git rev-parse HEAD`, then 'dev' (first 7 characters);
 *   5. cache-busts: every local .js/.css file becomes name.<sha256-10>.ext and
 *      every reference to it (HTML src/href, JS import()/import-from) is
 *      rewritten. Files are hashed leaves-first, so a file that imports another
 *      hashed file (the game bundle -> the SDK bundle) hashes its REWRITTEN content.
 *      Images are copied as-is, unhashed.
 *
 * It only ever writes inside the output dir, so the repo root keeps working as a
 * plain static site until Render is switched over to serve dist/.
 * The only dependency is esbuild (already a devDependency).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Root-level files that are copied (pages + root images). Everything else at the
 * root (package.json, README, tests/, docs/, ...) is deliberately left out. */
const ROOT_FILE_EXT = new Set(['.html', '.ico', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
/* Directories copied wholesale, minus the SDK source files (the bundle is built
 * into the output instead). */
const ASSET_DIRS = ['static', 'characters'];
const SKIP_FILES = new Set(['static/discord-sdk-entry.js', 'static/discord-sdk.bundle.js']);
const SDK_ENTRY = 'static/discord-sdk-entry.js';
const SDK_OUT = 'static/discord-sdk.bundle.js';
/* The game entry module (index.html loads only this) and the source files that
 * are folded into its bundle and therefore not shipped on their own. */
const GAME_ENTRY = 'static/js/main.js';
const GAME_SOURCE_DIRS = ['static/js'];
const GAME_SOURCE_FILES = ['static/bots.js'];
/* landing.html's reel: bundled the same way (it imports the game's data.js), with
 * three.js left to the page's import map. Its other modules are folded in. */
const LANDING_ENTRY = 'static/landing/reel.js';
const LANDING_DIR = 'static/landing';
const LANDING_EXTERNAL = ['three', 'three/addons/*'];

const toPosix = p => p.split(path.sep).join('/');
const isExternal = u => /^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(u);
const stripQuery = u => u.replace(/[?#].*$/, '');

function walk(dir, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) out.push(...walk(dir, r));
    else if (ent.isFile()) out.push(r);
  }
  return out.sort();
}

export function resolveCommit(root = repoRoot, env = process.env) {
  let sha = (env.RENDER_GIT_COMMIT || '').trim();
  if (!sha) {
    try {
      sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
    } catch { sha = ''; }
  }
  sha = sha.slice(0, 7);
  return /^[0-9a-zA-Z]{1,7}$/.test(sha) ? sha : 'dev';
}

/* A reference as written in a page/script -> path inside the output (posix,
 * no leading slash), or null if it is external / not a plain file path. */
function resolveRef(spec, fromRel) {
  if (!spec || isExternal(spec) || /["'`$+{}]/.test(spec)) return null; // JS-built strings aren't files
  const clean = stripQuery(spec);
  if (!clean) return null;
  const joined = clean.startsWith('/')
    ? path.posix.normalize(clean.slice(1))
    : path.posix.join(path.posix.dirname(fromRel), clean);
  return joined.startsWith('..') ? null : joined;
}

/* Swap the final path segment of `spec` for the hashed file name (query/hash dropped). */
function withNewName(spec, newRel) {
  return stripQuery(spec).replace(/[^/]*$/, path.posix.basename(newRel));
}

const IMPORT_RES = [
  /(\bimport\s*\(\s*)(["'])([^"'\n]+)\2/g,                          // import("x")
  /(^|[;\n}]\s*)((?:import|export)\b[^"'`;]*?\bfrom\s*)(["'])([^"'\n]+)\3/g, // import … from "x"
  /(^|[;\n}]\s*)(import\s*)(["'])([^"'\n]+)\3/g,                    // import "x"
];

export async function build({ root = repoRoot, out, commit } = {}) {
  if (!out) throw new Error('build: an output directory is required');
  out = path.resolve(out);
  if (out === root || root.startsWith(out + path.sep)) {
    throw new Error('refusing to use ' + out + ' as the output dir (it would wipe the repo)');
  }
  commit = commit || resolveCommit(root);

  /* ---- 1. copy ---- */
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const copy = rel => {
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, rel), dest);
  };
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (ent.isFile() && !ent.name.startsWith('.') && ROOT_FILE_EXT.has(path.extname(ent.name).toLowerCase())) copy(ent.name);
  }
  for (const d of ASSET_DIRS) {
    if (!fs.existsSync(path.join(root, d))) continue;
    for (const rel of walk(root, d)) if (!SKIP_FILES.has(rel)) copy(rel);
  }

  /* ---- 2. Discord SDK bundle (into the output dir only) ---- */
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [path.join(root, SDK_ENTRY)],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
    outfile: path.join(out, SDK_OUT), logLevel: 'warning',
  });

  /* ---- 3. bundle the game into its entry module ----
   * esbuild follows the real import graph from main.js. The one thing it must NOT
   * follow is the Discord SDK: discord.js imports it dynamically by its absolute
   * served path, which step 5 later rewrites to the hashed file name. */
  const entryPath = path.join(out, GAME_ENTRY);
  const bundled = await esbuild.build({
    /* absWorkingDir keeps esbuild's `// path` comments relative to the output dir, so the
       bundle (and its content hash) is identical wherever --out points. */
    absWorkingDir: out, entryPoints: [GAME_ENTRY],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
    external: ['/' + SDK_OUT], write: false, logLevel: 'warning', legalComments: 'none',
  });
  if (bundled.outputFiles.length !== 1) throw new Error('expected one game bundle, got ' + bundled.outputFiles.length);
  const bundleText = bundled.outputFiles[0].text;
  const landing = await esbuild.build({
    absWorkingDir: out, entryPoints: [LANDING_ENTRY],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
    external: LANDING_EXTERNAL, write: false, logLevel: 'warning', legalComments: 'none',
  });
  if (landing.outputFiles.length !== 1) throw new Error('expected one landing bundle, got ' + landing.outputFiles.length);
  for (const rel of walk(out, LANDING_DIR)) if (rel.endsWith('.js')) fs.rmSync(path.join(out, rel));
  fs.writeFileSync(path.join(out, LANDING_ENTRY), landing.outputFiles[0].text);
  for (const d of GAME_SOURCE_DIRS) fs.rmSync(path.join(out, d), { recursive: true, force: true });
  for (const f of GAME_SOURCE_FILES) fs.rmSync(path.join(out, f), { force: true });
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, bundleText);

  /* ---- 4. stamp BUILD_COMMIT ---- */
  const indexPath = path.join(out, 'index.html');
  let index = fs.readFileSync(indexPath, 'utf8');
  const stampRe = /const BUILD_COMMIT = '[^']*';/g;
  if ((index.match(stampRe) || []).length !== 1) throw new Error("index.html must contain exactly one `const BUILD_COMMIT = '…';`");
  index = index.replace(stampRe, () => `const BUILD_COMMIT = '${commit}';`);
  fs.writeFileSync(indexPath, index);

  /* ---- 5. content-hash every local .js / .css, leaves first ---- */
  const hashable = new Set(walk(out).filter(r => /\.(js|css)$/i.test(r)));
  const renamed = new Map(); // original rel -> hashed rel
  const visiting = [];
  const hashFile = rel => {
    if (renamed.has(rel)) return renamed.get(rel);
    if (visiting.includes(rel)) throw new Error('import cycle between hashed files: ' + [...visiting, rel].join(' -> '));
    visiting.push(rel);
    let text = fs.readFileSync(path.join(out, rel), 'utf8');
    if (/\.js$/i.test(rel)) text = rewriteJs(text, rel);
    visiting.pop();
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 10);
    const ext = path.posix.extname(rel);
    const next = rel.slice(0, -ext.length) + '.' + hash + ext;
    fs.writeFileSync(path.join(out, next), text);
    fs.rmSync(path.join(out, rel));
    renamed.set(rel, next);
    return next;
  };
  const rewriteSpec = (spec, fromRel) => {
    const target = resolveRef(spec, fromRel);
    return target && hashable.has(target) ? withNewName(spec, hashFile(target)) : spec;
  };
  function rewriteJs(text, rel) {
    text = text.replace(IMPORT_RES[0], (_, pre, q, spec) => pre + q + rewriteSpec(spec, rel) + q);
    text = text.replace(IMPORT_RES[1], (_, lead, pre, q, spec) => lead + pre + q + rewriteSpec(spec, rel) + q);
    text = text.replace(IMPORT_RES[2], (_, lead, pre, q, spec) => lead + pre + q + rewriteSpec(spec, rel) + q);
    return text;
  }
  for (const rel of [...hashable].sort()) hashFile(rel);

  for (const rel of walk(out).filter(r => /\.html$/i.test(r))) {
    const p = path.join(out, rel);
    const html = fs.readFileSync(p, 'utf8').replace(/(\b(?:src|href)\s*=\s*)(["'])([^"']*)\2/gi,
      (m, pre, q, spec) => {
        const target = resolveRef(spec, rel);
        return target && renamed.has(target) ? pre + q + withNewName(spec, renamed.get(target)) + q : m;
      });
    fs.writeFileSync(p, html);
  }

  return { out, commit, renamed: Object.fromEntries(renamed) };
}

/* ---- CLI ---- */
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const out = (i > -1 && args[i + 1]) || process.env.BUILD_OUT || path.join(repoRoot, 'dist');
  build({ out }).then(r => {
    console.log(`built ${path.relative(process.cwd(), r.out) || r.out} (BUILD_COMMIT ${r.commit}, ${Object.keys(r.renamed).length} hashed js/css files)`);
  }).catch(e => { console.error(e); process.exit(1); });
}
