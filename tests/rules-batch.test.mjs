/*
 * Rules batch: DELAYS (-2 steps, one turn), LIBERATE OIL seizing, uncut-restricted chainsaw, the roaming Cruise Ship.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, bfs } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
async function worldmap(t, players = 2) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.boardLayout = 'worldmap'; e.acc.Net.dlcWorld = true;
  const S = await makeGame(e, players, {});
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  return { e, S: e.acc.S };
}

test('THE CRUISE SHIP sails to a new port each round: docked beside a water node, old threads gone, position in S', { timeout: 120000 }, async t => {
  const { e, S } = await worldmap(t);
  assert.equal(S.layoutKind, 'worldmap');
  assert.match(e.acc.NMAP.w_cruise.sp, /sails on|ON THE MOVE/);
  for (let round = 0; round < 3; round++) {
    const oldEdges = e.ctx.EDGES.filter(x => x[0] === 'w_cruise' || x[1] === 'w_cruise').map(x => x.slice());
    S.players[0].pos = 'w_cruise';
    S.cur = S.players.length - 1; S.log.length = 0;
    const turn = S.turn;
    e.ctx.nextTurn(); await settle();
    assert.equal(S.turn, turn + 1);
    const c = e.acc.NMAP.w_cruise;
    const mine = e.ctx.EDGES.filter(x => x[0] === 'w_cruise' || x[1] === 'w_cruise');
    assert.equal(mine.length, 2, 'a port link and one neighbour');
    const ports = mine.map(x => x[0] === 'w_cruise' ? x[1] : x[0]);
    const water = ports.filter(id => e.ctx.isWaterNode(id) && id !== 'w_cruise');
    assert.ok(water.length >= 1, 'linked to a water node: ' + ports);
    const port = e.acc.NMAP[water[0]];
    const d = Math.hypot(c.x - port.x, c.y - port.y);
    assert.ok(d < 400, 'docked near the port: ' + d);
    const keep = oldEdges.filter(x => mine.some(m => m.join() === x.join() || m.join() === x.slice().reverse().join()));
    assert.ok(!keep.length || keep.length <= 1, 'the old threads are gone (barring a repeated neighbour)');
    const row = S.boardLayout.find(p => p.id === 'w_cruise');
    assert.deepEqual([row.x, row.y], [c.x, c.y], 'S.boardLayout carries the position');
    assert.ok(S.boardEdges.some(x => x.includes('w_cruise') && x.includes(water[0])), 'S.boardEdges carries the thread');
    assert.ok(S.log.some(l => l.includes('THE CRUISE SHIP sails on to')));
    assert.equal(S.players[0].pos, 'w_cruise', 'passengers ride along');
    e.ctx.applyLayoutFromState();
    assert.equal(e.acc.NMAP.w_cruise.x, c.x, 'survives applyLayoutFromState');
  }
});

test('the Cruise Ship stays put off the world map', async t => {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = true;
  const S = await makeGame(e, 2, {});
  const x = e.acc.NMAP.w_cruise.x;
  assert.equal(e.ctx.sailCruise(), null);
  assert.equal(e.acc.NMAP.w_cruise.x, x);
  assert.ok(S);
});

test('a disconnected board does not break routing helpers', async t => {
  const { e, S } = await worldmap(t);
  const bridge = e.ctx.EDGES.find(x => !e.ctx.cutKeepsBoardConnected(x[0], x[1]));
  if (!bridge) return;
  S.owner = { w_milei: 0 }; S.cur = 0; S.phase = 'action'; S.mode = null; S.players[0].money = 10;
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'chainsaw' });
  await e.f.applyIntent(0, { act: 'edgepick', id: bridge[0] });
  await e.f.applyIntent(0, { act: 'edgepick', id: bridge[1] });
  await settle();
  assert.ok(S.wGame.milei);
  const d = bfs(e.ctx.ADJ, 'quik');
  assert.ok(d.size < e.ctx.NODES.length, 'the board is split');
});
