/* ✈️ GLOBAL EDITION — the Qantas jet is a real plane: parked where it lands, flown (or stolen) by whoever stands on it, with a range.
   The classic boards keep the old jet (the owner, from anywhere, to anywhere). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
async function run(e, pi, m) {
  let done = false;
  const p = e.f.applyIntent(pi, m).finally(() => { done = true; });
  for (let i = 0; i < 14 && !done; i++) { await settle(); e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); }
  await p; await settle();
}
async function game(t, world) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.boardLayout = world ? 'random' : 'classic'; e.acc.Net.dlcWorld = !!world;
  await makeGame(e, 3, {});
  const S = e.acc.S;
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = {}; S.blockades = {};
  S.players.forEach(p => { p.money = 50; p.intel = 5; p.cortisol = 0; p.pos = 'quik'; });
  return { e, S, P: S.players };
}
const moving = (S, cur) => { S.cur = cur; S.phase = 'move'; S.mode = null; S.steps = 3; };

test('Global Edition: the jet starts at QANTAS, only someone standing on it can fly, the range holds, and it stays where it lands', async t => {
  const { e, S, P } = await game(t, true);
  const c = e.ctx, N = e.acc.NMAP;
  assert.ok(S.dlcWorld);
  assert.equal(c.jetAt(), 'qantas', 'parked at the kangaroo to begin with');
  S.owner.qantas = 0;
  /* the owner, away from the jet, cannot fly it */
  P[0].pos = 'quik'; moving(S, 0);
  if ('quik' !== 'qantas') {
    await run(e, 0, { act: 'flymode' });
    assert.equal(S.mode, null, 'not standing on the jet');
  }
  /* on the jet: fly, but only within range */
  P[0].pos = 'qantas'; moving(S, 0);
  const far = e.acc.NODES.find(n => !c.inFlyRange(n.id) && !n.id.startsWith('geo_'));
  const near = e.acc.NODES.find(n => n.id !== 'qantas' && c.inFlyRange(n.id) && c.flyDist('qantas', n.id) > 600 && !e.ctx.blockaded(n.id) && n.id !== 'w_aq_mbl');
  assert.ok(far && near, 'some nodes are out of range, some in');
  assert.ok(c.flyDist('qantas', far.id) > c.QANTAS_RANGE_PX);
  await run(e, 0, { act: 'flymode' });
  assert.equal(S.mode, 'fly');
  await run(e, 0, { act: 'fly', id: far.id });
  assert.equal(P[0].pos, 'qantas', far.id + ' is out of range: no flight');
  const cash = P[0].money;
  await run(e, 0, { act: 'fly', id: near.id });
  assert.equal(P[0].pos, near.id);
  assert.equal(P[0].money, cash - 3);
  assert.equal(S.jetAt, near.id, 'the jet is parked where it landed');
  assert.equal(c.jetAt(), near.id);
  /* the owner walks off: the jet stays put */
  /* a rival who reaches the jet steals it */
  P[1].pos = near.id; moving(S, 1);
  assert.ok(c.canFly(1), 'a rival standing on the jet can take it');
  assert.ok(!c.canFly(2));
  const back = e.acc.NODES.find(n => n.id !== near.id && c.inFlyRange(n.id) && !e.ctx.blockaded(n.id) && n.id !== 'w_aq_mbl' && c.flyDist(near.id, n.id) > 300);
  await run(e, 1, { act: 'flymode' });
  await run(e, 1, { act: 'fly', id: back.id });
  assert.equal(P[1].pos, back.id);
  assert.equal(S.jetAt, back.id, 'the thief parks it at the other end');
  assert.ok(S.log.some(l => l.includes('STEALS the Qantas jet')));
  assert.equal(S.owner.qantas, 0, 'the airline itself stays with its owner');
  /* the owner, standing where the jet USED to be, cannot fly it any more */
  P[0].pos = near.id; moving(S, 0);
  assert.ok(!c.canFly(0));
});

test('the range wraps across the date line, and the bot view lists only nodes within range', async t => {
  const { e, S } = await game(t, true);
  const c = e.ctx, N = e.acc.NMAP, w = e.f.worldMapMetrics().w;
  /* the distance is measured the short way round: across the date-line seam when that is shorter */
  const ids = e.acc.NODES.map(n => n.id);
  const L = ids.reduce((a, b) => N[a].x < N[b].x ? a : b), R = ids.reduce((a, b) => N[a].x > N[b].x ? a : b);
  const dx = Math.abs(N[L].x - N[R].x), dy = Math.abs(N[L].y - N[R].y);
  assert.ok(Math.abs(c.flyDist(L, R) - Math.hypot(Math.min(dx, w - dx), dy)) < 1);
  N.__a = { x: 100, y: 1000 }; N.__b = { x: w - 100, y: 1000 };
  assert.ok(c.flyDist('__a', '__b') < 250, 'two points either side of the seam are neighbours');
  delete N.__a; delete N.__b;
  const view = e.ctx.botView ? e.ctx.botView(0) : null;
  if (view && view.jet) {
    assert.equal(view.jet.at, 'qantas');
    assert.ok(view.jet.reach.every(id => c.inFlyRange(id)));
  }
});

test('classic board: the owner still flies from anywhere, to anywhere', async t => {
  const { e, S, P } = await game(t, false);
  assert.ok(!S.dlcWorld);
  S.owner.qantas = 0; P[0].pos = 'quik'; moving(S, 0);
  assert.equal(e.ctx.jetAt(), null);
  assert.ok(e.ctx.canFly(0) && !e.ctx.canFly(1));
  await run(e, 0, { act: 'flymode' });
  await run(e, 0, { act: 'fly', id: 'rba' });
  assert.equal(P[0].pos, 'rba');
  assert.equal(S.jetAt, undefined);
});

test('Global Edition: two flights in a row by the same player send the jet home for MAINTENANCE', async t => {
  const { e, S, P } = await game(t, true);
  const c = e.ctx;
  const hops = e.acc.NODES.filter(n => n.id !== 'qantas' && c.flyDist('qantas', n.id) < c.QANTAS_RANGE_PX * 0.45).map(n => n.id);
  assert.ok(hops.length >= 2);
  const [a, b] = hops;
  /* flight 1: qantas -> a; the jet stays at a */
  P[0].pos = 'qantas'; moving(S, 0);
  await run(e, 0, { act: 'flymode' }); await run(e, 0, { act: 'fly', id: a });
  assert.equal(c.jetAt(), a);
  /* flight 2 by the same player: lands at b, then the jet goes home */
  P[0].pos = a; moving(S, 0);
  await run(e, 0, { act: 'flymode' }); await run(e, 0, { act: 'fly', id: b });
  assert.equal(P[0].pos, b, 'the passenger is dropped off');
  assert.equal(c.jetAt(), 'qantas', 'the jet is home for a service');
  assert.ok(S.log.some(l => l.includes('MAINTENANCE')));
  /* a different player in between resets the count */
  P[1].pos = 'qantas'; moving(S, 1);
  await run(e, 1, { act: 'flymode' }); await run(e, 1, { act: 'fly', id: a });
  P[0].pos = a; moving(S, 0);
  await run(e, 0, { act: 'flymode' }); await run(e, 0, { act: 'fly', id: b });
  assert.equal(c.jetAt(), b, 'one flight each: no maintenance yet');
});

test('Global Edition: the QANTAS owner summons the jet to their square at the end of their turn (free, once per turn)', async t => {
  const { e, S, P } = await game(t, true);
  const c = e.ctx;
  S.jetAt = 'qantas';
  P[1].pos = 'citi'; S.cur = 1; S.phase = 'action'; S.mode = null;
  await run(e, 1, { act: 'summon' });
  assert.equal(c.jetAt(), 'qantas', 'only the owner can summon it');
  S.owner.qantas = 1;
  await run(e, 1, { act: 'summon' });
  assert.equal(c.jetAt(), 'citi', 'the jet is parked on the owner’s square');
  assert.equal(S.phase, 'action', 'free: the action phase carries on');
  P[1].pos = 'quik';
  await run(e, 1, { act: 'summon' });
  assert.equal(c.jetAt(), 'citi', 'once per turn');
  /* not during movement */
  S.nTurn = {}; S.phase = 'move'; S.steps = 3;
  await run(e, 1, { act: 'summon' });
  assert.equal(c.jetAt(), 'citi');
});
