/*
 * GLOBAL EDITION: DEUTSCHE BAHN and UBS.
 * DELAYS (Deutsche Bahn, $3, your action, once per turn): a rival moves 2 steps fewer on their next turn only.
 * UBS (Credit Suisse, rebuilt): $6 income, +$3 per BANK, -1 Cortisol a turn, a banking-file exemption, and the once-per-game AT1 WIPE-OUT.
 * Also: the deleted exhibits are really gone from the board and from every list.
 */
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
async function game(t, players = 3) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = true;
  const S = await makeGame(e, players, {});
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = {}; S.wGame = {}; S.nTurn = {}; S.acccFiles = []; S.delays = {};
  S.cur = 0; S.mode = null; S.phase = 'action'; S.steps = 3;
  S.players.forEach(p => { p.money = 50; p.intel = 10; p.cortisol = 0; p.pos = 'quik'; p.raided = 0; });
  return { e, S: e.acc.S, P: e.acc.S.players };
}
const act = (S, cur = 0) => { S.cur = cur; S.phase = 'action'; S.mode = null; S.nTurn = {}; };

test('the deleted exhibits are gone from the board and every id list; Deutsche Bahn replaces Deutsche Bank', async t => {
  const { e } = await game(t);
  const W = await import('../static/js/world.js');
  const gone = ['w_btp', 'w_lux', 'w_vatican', 'w_opec', 'w_adia', 'w_witz', 'w_debeers', 'w_mpesa'];
  for (const id of gone) {
    assert.ok(!e.acc.NMAP[id], id + ' is not on the board');
    assert.ok(!W.WORLD_NODE_IDS.includes(id), id + ' is not a world node');
    assert.ok(!W.TAX_HAVENS.includes(id), id + ' is not a tax haven');
    for (const b of Object.values(W.TRADE_BLOCS)) assert.ok(!b.members.includes(id), id + ' is in no bloc');
    for (const [a, b] of W.WORLD_ROUTES) assert.ok(a !== id && b !== id, id + ' is on no route');
  }
  const db = e.acc.NMAP.w_db;
  assert.deepEqual(db.name, ['DEUTSCHE', 'BAHN']);
  assert.equal(db.icon, '🚆');
  assert.match(db.sp, /DELAYS/);
  assert.ok(W.TRADE_BLOCS.w_eu.members.includes('w_db'), 'still an EU member');
  assert.match(e.acc.NMAP.w_burj.sp, /NEOM/, 'Burj Khalifa found a new partner');
});

test('DELAYS: $3, your action, once per turn; the rival moves 2 steps fewer on their next turn only, then recovers', async t => {
  const { e, S, P } = await game(t);
  S.owner = { w_db: 0 };
  /* only the owner, only on their action, only with the cash */
  act(S, 1); await run(e, 1, { act: 'delays', target: 2 });
  assert.equal(S.delays[2], undefined, 'a non-owner cannot delay');
  act(S, 0); P[0].money = 2; await run(e, 0, { act: 'delays', target: 1 });
  assert.equal(S.delays[1], undefined, 'it costs $3');
  act(S, 0); P[0].money = 50; S.phase = 'move'; await run(e, 0, { act: 'delays', target: 1 });
  assert.equal(S.delays[1], undefined, 'it is an action-phase ability');
  act(S, 0); await run(e, 0, { act: 'delays', target: 0 });
  assert.equal(S.delays[0], undefined, 'you cannot delay yourself');
  /* the real thing */
  act(S, 0); P[0].money = 50;
  assert.equal(e.ctx.reworkBlocked(0, 'delays'), '');
  await run(e, 0, { act: 'delays', target: 1 });
  /* the ability ends the owner's turn, so the delayed seat's one delayed turn has already begun */
  assert.ok(S.log.some(l => l.includes('DELAYS') && l.includes('2 steps fewer')), 'logged');
  assert.equal(S.cur, 1);
  assert.equal(S.delayedNow, true);
  assert.ok(S.steps <= 2 && S.steps >= 0, '2 steps fewer: ' + S.steps);
  assert.equal(S.delays[1], undefined, 'a single delayed turn');
  assert.ok(S.log.some(l => l.includes('DELAYED') && l.includes(P[1].name)), 'the delay is in the log');
  assert.equal(e.ctx.delayTargets(0).includes(1), true, 'the delay was spent on that one turn');
  assert.equal(e.ctx.delayTargets(0).includes(2), true);
  /* no favors, no slipstream while delayed */
  {
    const intel = P[1].intel; S.phase = 'move';
    await run(e, 1, { act: 'favor' });
    assert.ok(S.steps <= 2, 'a favor cannot buy extra steps while delayed');
    assert.equal(P[1].intel, intel);
  }
  /* the third turn is free again */
  S.cur = 1; S.phase = 'move'; S.mode = null; S.delayedNow = false;
  await e.f.startTurn(); await settle();
  assert.ok(S.steps >= 3, 'recovered: ' + S.steps);
  assert.equal(S.delayedNow, false);
  /* the owner may delay them again, but only once per turn */
  act(S, 0); P[0].money = 50; await run(e, 0, { act: 'delays', target: 1 });
  assert.equal(S.delays[1], undefined, 'delayed again (its one turn has begun)');
  assert.equal(S.delayedNow, true);
  S.cur = 0; S.phase = 'action'; S.mode = null; S.delays = {}; S.nTurn = { delays: 1 };
  assert.match(e.ctx.reworkBlocked(0, 'delays'), /already delayed someone this turn/);
});

test('DELAYS needs a standing Bahn and a rival who is not already delayed', async t => {
  const { e, S } = await game(t);
  S.owner = { w_db: 0 }; act(S, 0);
  assert.equal(e.ctx.reworkBlocked(0, 'delays'), '');
  assert.equal(e.ctx.delayTargets(0).length, 2);
  S.delays = { 1: 2, 2: 1 };
  assert.match(e.ctx.reworkBlocked(0, 'delays'), /already delayed/);
  S.delays = {}; S.rubble.w_db = 1;
  assert.match(e.ctx.reworkBlocked(0, 'delays'), /control|rubble/i);
});

test('UBS: $6 income, +$3 per BANK (itself included), -1 Cortisol a turn once rebuilt; it starts as rubble', async t => {
  const { e, S, P } = await game(t);
  const W = await import('../static/js/world.js');
  const NM = e.ctx.NMAP;
  assert.ok(W.WORLD_START_RUBBLE.includes('w_cs'));
  assert.equal(NM.w_cs.income, 6);
  assert.match(NM.w_cs.sp, /UBS/); assert.match(NM.w_cs.sp, /AT1/); assert.match(NM.w_cs.sp, /TOO BIG TO FAIL/);
  const syn = ids => W.worldSynergy(ids.map(id => NM[id]), id => ids.includes(id), () => 0);
  assert.equal(syn(['w_cs']), 3, 'itself');
  const other = e.ctx.NODES.filter(n => n.type === 'BANK' && n.id !== 'w_cs' && !n.fx).slice(0, 2).map(n => n.id);
  assert.equal(syn(['w_cs', ...other]), 9, '+$3 for each of three banks');
  /* rebuilt and owned: it pays */
  S.rebuilt = { w_cs: 1 }; S.owner = { w_cs: 0 }; P[0].money = 0; S.cur = 0; S.mood = 'CALM';
  e.f.income(0);
  assert.equal(P[0].money, 3 + 6 + 3, 'salary + $6 holding + $3 for itself');
  P[0].cortisol = 4; S.cur = 0;
  await e.f.startTurn(); await settle();
  assert.equal(P[0].cortisol, 3, '-1 Cortisol at the turn start');
});

test('AT1 WIPE-OUT: once per game, UBS owner only; every rival pays $2 per BANK/CHART node (capped at their cash); it comes to you', async t => {
  const { e, S, P } = await game(t);
  const banks = e.ctx.NODES.filter(n => n.type === 'BANK' && n.id !== 'w_cs').slice(0, 3).map(n => n.id);
  const chart = e.ctx.NODES.find(n => n.type === 'CHART').id;
  S.rebuilt = { w_cs: 1 };
  S.owner = { w_cs: 0, [banks[0]]: 1, [banks[1]]: 1, [chart]: 1, [banks[2]]: 2 };
  P[2].money = 1; P[1].money = 50;
  /* not the owner / not your action */
  act(S, 1); await run(e, 1, { act: 'at1' });
  assert.ok(!S.wGame.at1, 'a non-owner cannot wipe anything');
  act(S, 0); S.phase = 'move'; await run(e, 0, { act: 'at1' });
  assert.ok(!S.wGame.at1, 'it is your action');
  act(S, 0);
  assert.deepEqual(e.ctx.at1Bill(0).map(b => [b.j, b.k, b.pay]), [[1, 3, 6], [2, 1, 1]]);
  const m0 = P[0].money;
  await run(e, 0, { act: 'at1' });
  assert.ok(S.wGame.at1, 'used');
  assert.ok(P[0].money >= m0 + 7, 'the bondholders’ money came to the owner');
  assert.ok(S.log.some(l => l.includes(P[1].name + ' pays $6 to ' + P[0].name)), 'rival 1: three nodes, $6');
  assert.ok(S.log.some(l => l.includes(P[2].name + ' pays $1 to ' + P[0].name)), 'rival 2 could only pay $1');
  assert.ok(S.log.some(l => l.includes('AT1 WIPE-OUT')));
  /* once per game */
  act(S, 0);
  assert.match(e.ctx.reworkBlocked(0, 'at1'), /once per game/);
  /* a rubble UBS cannot act */
  S.wGame = {}; S.rubble.w_cs = 1;
  assert.notEqual(e.ctx.reworkBlocked(0, 'at1'), '');
});
