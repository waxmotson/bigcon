/* film.html replays a recording of the real engine. These checks keep the recording fresh,
   and keep the page's promise: every action in the game appears in it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MATCH } from '../static/landing/match.js';
import { GROUPS, ACTS, chipsOf } from '../static/landing/acts.js';
import { BASE_NODES, GEO_NODES } from '../static/js/data.js';

const root = new URL('..', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');
const lf = s => s.replace(/\r\n/g, '\n');

test('static/landing/match.js is what the engine produces today (re-run node scripts/build_film.mjs)', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'film-')), 'match.js');
  execFileSync(process.execPath, [fileURLToPath(new URL('scripts/build_film.mjs', root)), '--out=' + tmp], { stdio: 'pipe' });
  assert.equal(lf(fs.readFileSync(tmp, 'utf8')), lf(read('static/landing/match.js')));
});

test('the recorded game shows every action in the catalogue', () => {
  const seen = new Set(MATCH.beats.flatMap(chipsOf));
  assert.deepEqual(Object.keys(ACTS).filter(id => !seen.has(id)), []);
  assert.ok(GROUPS.flatMap(g => g[1]).length >= 50);
});

test('the script uses every intent the engine accepts', () => {
  const engine = read('static/js/engine.js'), script = read('scripts/film_script.mjs');
  const body = engine.slice(engine.indexOf('export async function applyIntent'), engine.indexOf('export function isRival'));
  const acts = new Set([...body.matchAll(/act==='([a-z0-9]+)'/g)].map(m => m[1]));
  assert.ok(acts.size > 40, 'found the intent list');
  const used = new Set([...script.matchAll(/act: '([a-z0-9]+)'/g)].map(m => m[1]));
  /* cancel only backs out of a targeting mode: it changes nothing on the board */
  assert.deepEqual([...acts].filter(a => !used.has(a) && a !== 'cancel'), []);
});

test('the game ends in a legal win', () => {
  const s = {}; for (const b of MATCH.beats) Object.assign(s, b.s);
  const types = new Map(BASE_NODES.concat(GEO_NODES).map(n => [n.id, n.type]));
  const mine = new Set(Object.keys(s.own).filter(id => s.own[id] === MATCH.winner).map(id => types.get(id)));
  assert.equal(mine.size, 7);
  assert.ok(s.pl[MATCH.winner][0] >= MATCH.goal);
  assert.equal(MATCH.beats.at(-1).k, 'win');
});

test('local files referenced by film.html exist', () => {
  for (const m of read('film.html').matchAll(/\b(?:src|href)="(\.\/[^"#?]+|[a-z]+\.html)"/g)) assert.ok(fs.existsSync(new URL(decodeURI(m[1]), root)), m[1]);
});
