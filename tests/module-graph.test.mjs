/*
 * index.html loads the game as ONE entry module (static/js/main.js) and native
 * ES modules do the rest, straight from the repo root — no bundler needed at
 * runtime. These tests pin that layout: every referenced asset exists, every
 * import resolves and names something the target really exports, the layers
 * stay in their lanes (the rules engine never imports the browser layer), and
 * the whole graph loads and boots without load-time errors.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HTML, INLINE_SCRIPTS, GAME_MODULES, SOURCE, repoRoot, loadEngine, makeGame, moduleEntries, moduleGraph, importSpecs } from './helpers/harness.mjs';

const isRemote = u => /^[a-z][a-z0-9+.-]*:|^\/\//i.test(u);
const local = u => path.join(repoRoot, u.replace(/^\.\//, '').replace(/[?#].*$/, ''));
const byFile = new Map(GAME_MODULES.map(m => [m.file, m]));
/* The layer that must stay DOM-free, wire-free and timer-free: the rules. */
const RULES_LAYER = ['static/js/hooks.js', 'static/js/util.js', 'static/js/data.js', 'static/js/state.js', 'static/js/boards.js', 'static/js/engine.js'];
const BROWSER_LAYER = ['static/js/core.js', 'static/js/net.js', 'static/js/ui.js', 'static/js/app.js', 'static/js/discord.js', 'static/js/main.js', 'static/bots.js'];

test('every local <script src> and stylesheet referenced by index.html exists on disk', () => {
  const refs = [];
  for (const m of HTML.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) refs.push(m[1]);
  for (const m of HTML.matchAll(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi)) {
    const href = m[0].match(/\bhref\s*=\s*["']([^"']+)["']/i);
    assert.ok(href, 'stylesheet link has an href: ' + m[0]);
    refs.push(href[1]);
  }
  assert.ok(refs.some(r => r.endsWith('bigcon-ui.css')), 'game.css is linked');
  assert.ok(refs.some(r => r.endsWith('static/js/main.js')), 'main.js is referenced');
  for (const r of refs) {
    if (isRemote(r)) continue;
    assert.ok(r.startsWith('./static/'), r + ' uses the ./static/ relative style (works at / and in the Discord proxy)');
    assert.ok(fs.existsSync(local(r)), r + ' exists on disk');
  }
});

test('the game is one module entry; only PeerJS and the BUILD_COMMIT stamp are classic scripts', () => {
  const tags = [...HTML.matchAll(/<script\b([^>]*)>/gi)].map(m => m[1]);
  const classic = tags.filter(a => !/type\s*=\s*["']module["']/.test(a));
  const mods = tags.filter(a => /type\s*=\s*["']module["']/.test(a));
  assert.equal(mods.length, 1, 'exactly one module entry');
  assert.match(mods[0], /src\s*=\s*["']\.\/static\/js\/main\.js["']/);
  assert.equal(tags.indexOf(mods[0]), tags.length - 1, 'the module is the last script (the stamp const exists before it runs)');
  for (const a of classic) assert.ok(!/\bsrc\s*=\s*["']\.\/static\//.test(a), 'no classic script still loads game code: ' + a);
  assert.deepEqual(moduleEntries(), ['static/js/main.js']);
});

test('BUILD_COMMIT stays inline in index.html as a placeholder the build stamps; modules read it as a free identifier', () => {
  assert.match(HTML, /const BUILD_COMMIT = 'dev';/);
  assert.equal(INLINE_SCRIPTS.filter(s => /const BUILD_COMMIT\b/.test(s)).length, 1);
  assert.equal(GAME_MODULES.filter(m => /const BUILD_COMMIT\b/.test(m.text)).length, 0, 'no module re-declares it');
  assert.ok(byFile.get('static/js/core.js').text.includes("typeof BUILD_COMMIT==='string'"), 'core.js reads it defensively');
});

test('the module graph: main.js reaches every game module, in dependency order', () => {
  const files = GAME_MODULES.map(m => m.file);
  assert.deepEqual([...files].sort(), [
    'static/bots.js', 'static/js/app.js', 'static/js/boards.js', 'static/js/core.js', 'static/js/data.js', 'static/js/discord.js',
    'static/js/engine.js', 'static/js/hooks.js', 'static/js/main.js', 'static/js/net.js', 'static/js/state.js', 'static/js/ui.js', 'static/js/util.js',
  ]);
  assert.equal(files[files.length - 1], 'static/js/main.js', 'the entry evaluates last');
  for (const m of GAME_MODULES) for (const dep of m.imports) assert.ok(files.indexOf(dep) < files.indexOf(m.file), m.file + ' evaluates after ' + dep);
});

test('every relative import resolves, and every named import is a real export of its target', () => {
  const exportsOf = text => {
    const names = new Set();
    for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s+([\w$]+)/gm)) names.add(m[1]);
    for (const m of text.matchAll(/^export\s+(?:const|let|var)\s+([^;\n]*)/gm)) for (const n of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g)) names.add(n[1]);
    for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const n of m[1].split(',')) names.add(n.trim().split(/\s+as\s+/).pop());
    return names;
  };
  let checked = 0;
  for (const m of GAME_MODULES) {
    for (const im of m.text.matchAll(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(m.file), im[2]));
      assert.ok(byFile.has(target), `${m.file}: ${im[2]} is part of the graph`);
      const have = exportsOf(byFile.get(target).text);
      for (const raw of im[1].split(',').map(s => s.trim()).filter(Boolean)) {
        const name = raw.split(/\s+as\s+/)[0];
        assert.ok(have.has(name), `${m.file} imports ${name}, which ${target} does not export`);
        checked++;
      }
    }
  }
  assert.ok(checked > 100, 'a healthy number of named imports were checked (' + checked + ')');
});

test('the import graph has no cycles — module evaluation order never depends on luck', () => {
  const state = new Map();
  const visit = (file, trail) => {
    if (state.get(file) === 'done') return;
    assert.notEqual(state.get(file), 'open', 'import cycle: ' + [...trail, file].join(' -> '));
    state.set(file, 'open');
    for (const dep of byFile.get(file).imports) visit(dep, [...trail, file]);
    state.set(file, 'done');
  };
  for (const m of GAME_MODULES) visit(m.file, []);
});

test('the rules layer never imports the browser layer, and holds no DOM / timer / UI references', () => {
  for (const file of RULES_LAYER) {
    const m = byFile.get(file);
    assert.ok(m, file + ' is in the graph');
    for (const dep of m.imports) assert.ok(!BROWSER_LAYER.includes(dep), `${file} must not import ${dep}`);
    if (file === 'static/js/hooks.js') continue; /* it DECLARES the interface (and defaults to globalThis timers) */
    /* strip comments and quoted strings so prose cannot trip the scan */
    const code = m.text
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
    const banned = [
      [/\bdocument\b/, 'document'], [/\bwindow\b/, 'window'], [/(?<![\w.])\$\(/, '$()'], [/\blocalStorage\b|\bsessionStorage\b/, 'web storage'],
      [/\brequestAnimationFrame\b/, 'requestAnimationFrame'], [/\bNotification\b/, 'Notification'], [/\blocation\b/, 'location'],
      [/(?<![.\w])(?:toast|modal|render|renderBoard|renderSide|scheduleRender|showRules)\(/, 'a UI function'],
      [/(?<![.\w])(?:setTimeout|clearTimeout|setInterval|clearInterval)\(/, 'a global timer'],
      [/\bPresence\b/, 'Presence'], [/\bnavigator\b/, 'navigator'],
    ];
    for (const [re, label] of banned) assert.ok(!re.test(code), `${file} must not use ${label} directly (go through hooks)`);
  }
});

test('hooks: setHooks swaps implementations in place and rejects typos', async () => {
  const { hooks, setHooks } = await import('../static/js/hooks.js');
  assert.deepEqual(Object.keys(hooks).sort(), [
    'announceAll', 'askPlayer', 'beginGame', 'botSeed', 'bots', 'clearTimeout', 'gameOver', 'modal', 'render', 'revealAll', 'setTimeout',
    'showGame', 'sync', 'sysTo', 'toast',
  ].sort(), 'the documented interface is exactly this list');
  assert.throws(() => setHooks({ synk() {} }), /unknown hook/);
  assert.throws(() => setHooks({ sync: 1 }), /must be a function/);
  const orig = hooks.toast;
  let got = null;
  setHooks({ toast: m => { got = m; } });
  hooks.toast('x');
  assert.equal(got, 'x');
  setHooks({ toast: orig });
});

test('modules load one by one against the stub browser without load-time errors', async () => {
  const engine = await loadEngine();
  assert.deepEqual(engine.consoleOut.error, []);
  assert.equal(engine.acc.NODES.length, 70);
  assert.equal(engine.acc.CARDS.length, 24);
  for (const fn of ['applyIntent', 'startTurn', 'generateRandomBoard', 'pubState', 'adoptState', 'showRules', 'handleHello'])
    assert.equal(typeof engine.f[fn], 'function', fn + ' is an exported function');
  assert.equal(engine.elems.get('buildStamp').textContent, 'COMMIT ' + engine.env.BUILD_COMMIT, 'boot() stamped the build commit');
  assert.equal(engine.ctx.IS_DISCORD_ACTIVITY, false);
  assert.equal(engine.env.window.__BIGCON_DISCORD_ACTIVITY__, undefined);
  engine.dispose();
});

test('private engines are really private: state, clock and DOM never leak between loads', async () => {
  const a = await loadEngine(), b = await loadEngine();
  const Sa = await makeGame(a, 2);
  assert.equal(b.acc.S, null, 'the second engine has no game');
  assert.notEqual(a.acc.Net, b.acc.Net);
  assert.notEqual(a.acc.NODES, b.acc.NODES);
  a.clock.setTimeout(() => {}, 5);
  assert.equal(b.clock.pending(), 0, 'its clock is its own');
  assert.equal(Sa.players.length, 2);
  a.dispose(); b.dispose();
});

test('a game starts through the full module wiring (late-graph functions are reachable)', async () => {
  const engine = await loadEngine();
  const S = await makeGame(engine, 2);
  assert.equal(S.players.length, 2);
  assert.ok(S.players.every(p => typeof p.money === 'number'));
  assert.equal(engine.elems.get('setup').style.display, 'none', 'hooks.showGame left the setup screen');
  assert.equal(engine.elems.get('app').style.display, 'flex');
  engine.dispose();
});

test('SOURCE (the import-stripped module text) still reads like one script for the copy and markup pins', () => {
  assert.ok(SOURCE.includes('function addCortisol('));
  assert.ok(!/^import |^export /m.test(SOURCE), 'no module syntax left');
  assert.ok(SOURCE.includes("const BUILD_COMMIT = '"));
  assert.equal(importSpecs("import { a } from './x.js';\nexport { a } from './y.js';").length, 2);
  assert.equal(moduleGraph().length, GAME_MODULES.length);
});
