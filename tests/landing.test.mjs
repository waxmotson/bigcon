/* landing.html: the page is static HTML plus one module; these checks keep it wired to
   the real game data without needing a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BASE_NODES, GEO_NODES } from '../static/js/data.js';
import { ATLAS } from '../static/landing/atlas.js';

const root = new URL('..', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('landing.html');
const scenesSrc = read('static/landing/scenes.js');
const sceneIds = [...scenesSrc.matchAll(/^\s*\{ id: '([a-z]+)', dur:/gm)].map(m => m[1]);

test('the atlas has a tile for every exhibit (re-run scripts/build_landing_atlas.py after adding a node)', () => {
  const ids = BASE_NODES.concat(GEO_NODES).map(n => n.id);
  assert.deepEqual(ids.filter(id => !ATLAS.ids.includes(id)), []);
  assert.ok(ATLAS.ids.length <= ATLAS.cols * ATLAS.rows);
  assert.ok(fs.existsSync(new URL('static/landing/atlas.webp', root)));
});

test('every chapter in landing.html has a scene, and every scene has a chapter', () => {
  const chapters = [...html.matchAll(/data-scene="([a-z]+)"/g)].map(m => m[1]);
  assert.ok(sceneIds.length >= 10, 'found the scene list');
  assert.deepEqual(chapters, sceneIds);
});

test('scenes only name exhibits that exist', () => {
  const ids = new Set(BASE_NODES.concat(GEO_NODES).map(n => n.id));
  const world = read('static/landing/world.js');
  for (const m of (scenesSrc + world).matchAll(/(?:w\.N|w\.stand|w\.own|w\.rubble|w\.pulse|w\.lift)\('([a-z0-9_]+)'/g)) assert.ok(ids.has(m[1]), m[1] + ' is not a node id');
  for (const m of world.matchAll(/\bpos\.([a-z0-9_]+)\b/g)) assert.ok(ids.has(m[1]), 'pos.' + m[1] + ' is not a node id');
});

test('local files referenced by landing.html exist', () => {
  for (const m of html.matchAll(/\b(?:src|href)="(\.\/[^"#?]+|[a-z]+\.html)"/g)) assert.ok(fs.existsSync(new URL(decodeURI(m[1]), root)), m[1]);
});
