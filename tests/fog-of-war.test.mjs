import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, SOURCE, HTML } from './helpers/harness.mjs';

test('Fog of War is a host-controlled lobby option propagated to the game state', t => {
  assert.match(HTML, /id="fogToggle"/);
  assert.match(SOURCE, /fogOfWar:\!\!Net\.fogOfWar/);
  assert.match(SOURCE, /setFogUI\(!!d\.fogOfWar\)/);
  assert.match(SOURCE, /Fog of War is enabled/);
});

test('Fog of War starts each player knowing only Quikstop and reveals movement destinations individually', async t => {
  const e = loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.fogOfWar = true;
  const S = await makeGame(e, 2);
  assert.equal(S.fogOfWar, true);
  for (const p of S.players) {
    assert.deepEqual(Object.keys(p.visited).sort(), ['quik']);
  }

  const pi = S.cur;
  const from = S.players[pi].pos;
  const destination = e.acc.ADJ[from][0];
  assert.ok(destination, 'the starting node has an adjacent destination');
  await e.f.doMove(pi, destination);
  assert.equal(e.acc.S.players[pi].visited[destination], true, 'the moving player discovers the destination');
  const rival = e.acc.S.players.findIndex((_, i) => i !== pi);
  assert.equal(e.acc.S.players[rival].visited[destination], undefined, 'the rival does not inherit the discovery');
});

test('Fog of War masks unexplored map nodes, hides unseen edges and rival tokens', t => {
  assert.match(SOURCE, /class="node fog-node/);
  assert.match(SOURCE, /if\(!\(knownA&&knownB\)&&!frontier\)return/);
  assert.match(SOURCE, /S\.fogOfWar&&pi!==Net\.myIdx/);
  assert.match(SOURCE, /stroke-dasharray="7 6"/);
});
