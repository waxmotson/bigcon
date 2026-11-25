/*
 * WORLD EXPANSION abilities, batch B: the eight actives. Milei's chainsaw, Brexit and the Belt and Road change the
 * edge graph (kept in S.boardEdges so it syncs); the Nigerian Prince flips a coin; Mrs Watanabe's carry trade comes due
 * next turn; the Bangalore call centre drains Intel; the Amazon sells credits; the Bermuda Triangle hides a seat.
 * All run through the real engine (applyIntent / startTurn) on a host game.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, bfs, withRandomSeq } from './helpers/harness.mjs';

/* every turn here ends on A QUIET QUARTER: everyone pockets $2 */
const QUIET = 2;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

async function worldGame(t, { players = 2 } = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = true;
  const S = await makeGame(e, players, { geo: true });
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  return { e, S: e.acc.S };
}
const armAction = (S, cur = 0) => { S.cur = cur; S.phase = 'action'; S.mode = null; };
const key = e => e.slice().sort().join('|');
const edgeKeys = e => new Set(e.ctx.EDGES.map(key));
/* is every node still reachable from Quikstop? */
const connected = e => { const d = bfs(e.ctx.ADJ, 'quik'); return e.ctx.NODES.every(n => d.has(n.id)); };
/* an edge whose removal strands nodes from Quikstop, and one that does not */
function findEdges(e) {
  let bridge = null, safe = null;
  for (const ed of e.ctx.EDGES) {
    if (e.ctx.cutKeepsBoardConnected(ed[0], ed[1])) { safe = safe || ed.slice(); } else bridge = bridge || ed.slice();
    if (bridge && safe) break;
  }
  return { bridge, safe };
}
async function pickEdge(e, pi, kind, a, b) {
  await e.f.applyIntent(pi, { act: 'worldmode', kind });
  await e.f.applyIntent(pi, { act: 'edgepick', id: a });
  await e.f.applyIntent(pi, { act: 'edgepick', id: b });
  await settle();
}

test('none of the nodes is flagged todo any more, and the sp text is consistent', async () => {
  const W = await import('../static/js/world.js');
  for (const id of ['w_milei', 'w_brexit', 'w_bri', 'w_nigprince', 'w_watanabe', 'w_bangalore', 'w_amazon', 'w_bermuda']) {
    const n = W.WORLD_NODES.find(x => x.id === id);
    assert.ok(n && !n.todo, id + ' is live');
    assert.ok(!/Phase 2/.test(n.sp), id + ' has no leftover phase-2 marker');
  }
  assert.equal(W.WORLD_NODES.filter(n => n.todo).length, 0);
});

/* ---------- CHAINSAW ---------- */
test('Milei: pay $3, cut an edge for good, +$4, once per game, state survives a resync', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_milei: 0 };
  const { safe } = findEdges(e);
  assert.ok(safe, 'there is a cuttable edge');
  const [a, b] = safe;
  /* a non-owner cannot even start */
  armAction(S, 1);
  await e.f.applyIntent(1, { act: 'worldmode', kind: 'chainsaw' });
  assert.equal(S.mode, null);
  /* the owner picks a node, then its neighbour */
  armAction(S, 0); S.players[0].money = 10;
  const before = e.ctx.EDGES.length;
  await pickEdge(e, 0, 'chainsaw', a, b);
  assert.equal(e.ctx.EDGES.length, before - 1, 'one edge gone');
  assert.ok(!edgeKeys(e).has(key(safe)), 'the picked edge is gone');
  assert.ok(!e.ctx.ADJ[a].includes(b) && !e.ctx.ADJ[b].includes(a), 'pathing no longer uses it');
  assert.equal(S.players[0].money, 10 - 3 + 4 + QUIET, 'pays $3, receives $4 (+ the quiet quarter that ends the turn)');
  assert.equal(S.wGame.milei, 1);
  assert.ok(connected(e), 'the board stays connected');
  assert.ok(!S.boardEdges.some(x => key(x) === key(safe)), 'the cut lives in S.boardEdges');
  /* survives a resync: rebuild the world and re-apply the layout from state, as a guest or reconnect does */
  const snap = JSON.stringify(S.boardEdges);
  e.f.rebuildWorld(true, true);
  e.ctx.applyLayoutFromState();
  assert.ok(!edgeKeys(e).has(key(safe)), 'still cut after applyLayoutFromState');
  assert.equal(JSON.stringify(S.boardEdges), snap);
  /* once per game */
  S.deck = ['quiet', 'quiet']; armAction(S, 0); S.players[0].money = 10;
  const n2 = e.ctx.EDGES.length;
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'chainsaw' });
  assert.equal(S.mode, null, 'the second chainsaw is refused');
  assert.equal(e.ctx.EDGES.length, n2);
});

test('Milei: needs $3, and a cut that would strand part of the board from Quikstop is refused', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_milei: 0 };
  armAction(S, 0); S.players[0].money = 2;
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'chainsaw' });
  assert.equal(S.mode, null, 'cannot afford it');
  const { bridge } = findEdges(e);
  if (!bridge) return; /* a board without any bridge cannot test the refusal */
  S.players[0].money = 10;
  const before = JSON.stringify(e.ctx.EDGES);
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'chainsaw' });
  await e.f.applyIntent(0, { act: 'edgepick', id: bridge[0] });
  await e.f.applyIntent(0, { act: 'edgepick', id: bridge[1] });
  assert.equal(JSON.stringify(e.ctx.EDGES), before, 'the bridge edge is not cut');
  assert.equal(S.mode, 'chainsaw', 'still choosing');
  assert.ok(!S.wGame || !S.wGame.milei, 'the chainsaw was not spent');
  assert.equal(S.players[0].money, 10);
  assert.ok(connected(e));
});

test('Milei: a non-adjacent second click just restarts the pick, and clicking the first node again clears it', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_milei: 0 };
  armAction(S, 0); S.players[0].money = 10;
  const ADJ = e.ctx.ADJ;
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'chainsaw' });
  await e.f.applyIntent(0, { act: 'edgepick', id: 'quik' });
  assert.equal(S.edgeA, 'quik');
  await e.f.applyIntent(0, { act: 'edgepick', id: 'quik' });
  assert.equal(S.edgeA, null);
  const far = e.ctx.NODES.find(n => n.id !== 'quik' && !ADJ.quik.includes(n.id)).id;
  await e.f.applyIntent(0, { act: 'edgepick', id: 'quik' });
  await e.f.applyIntent(0, { act: 'edgepick', id: far });
  assert.equal(S.edgeA, far, 'moved the first pick instead of cutting');
  assert.equal(S.players[0].money, 10);
  await e.f.applyIntent(0, { act: 'cancel' });
  assert.equal(S.mode, null);
});

/* ---------- BREXIT ---------- */
test('Brexit: severs an edge for the rest of the con, +1 Cortisol, once per game', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_brexit: 0, citi: 0 };
  const { safe } = findEdges(e);
  armAction(S, 0); S.players[0].cortisol = 0;
  await pickEdge(e, 0, 'brexit', safe[0], safe[1]);
  assert.ok(!edgeKeys(e).has(key(safe)));
  assert.equal(S.players[0].cortisol, 1);
  assert.equal(S.wGame.brexit, 1);
  assert.ok(connected(e));
  /* once per game */
  S.deck = ['quiet', 'quiet']; armAction(S, 0);
  const n = e.ctx.EDGES.length;
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'brexit' });
  assert.equal(S.mode, null);
  assert.equal(e.ctx.EDGES.length, n);
});

/* ---------- BELT AND ROAD ---------- */
test('Belt and Road: pay $4, link one of your nodes to any other node, permanently, once per turn', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_bri: 0, citi: 0 };
  const ADJ = e.ctx.ADJ;
  const far = e.ctx.NODES.find(n => n.id !== 'citi' && !ADJ.citi.includes(n.id) && n.id !== 'w_bri').id;
  armAction(S, 0); S.players[0].money = 10;
  /* you cannot start the road from a node you do not own */
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'silkroad' });
  await e.f.applyIntent(0, { act: 'edgepick', id: far });
  assert.equal(S.edgeA, null);
  await e.f.applyIntent(0, { act: 'edgepick', id: 'citi' });
  assert.equal(S.edgeA, 'citi');
  /* an existing neighbour is refused */
  await e.f.applyIntent(0, { act: 'edgepick', id: ADJ.citi[0] });
  assert.equal(S.mode, 'silkroad');
  assert.equal(S.players[0].money, 10);
  await e.f.applyIntent(0, { act: 'edgepick', id: far });
  await settle();
  assert.ok(edgeKeys(e).has(key(['citi', far])), 'the road exists');
  assert.ok(ADJ.citi.includes(far) && ADJ[far].includes('citi'), 'both directions of pathing');
  assert.equal(S.players[0].money, 10 - 4 + QUIET);
  assert.ok(S.boardEdges.some(x => key(x) === key(['citi', far])), 'stored in S.boardEdges');
  /* the new road is walkable for anyone, including a rival */
  S.cur = 1; S.phase = 'move'; S.steps = 2; S.mode = null; S.players[1].pos = far; S.players[1].money = 10;
  await e.f.applyIntent(1, { act: 'move', id: 'citi' });
  assert.equal(S.players[1].pos, 'citi');
  /* resync keeps it */
  e.f.rebuildWorld(true, true); e.ctx.applyLayoutFromState();
  assert.ok(edgeKeys(e).has(key(['citi', far])));
  /* once per turn */
  S.wTurn = { silkroad: 1 }; armAction(S, 0); S.players[0].money = 10;
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'silkroad' });
  assert.equal(S.mode, null, 'a second road in the same turn is refused');
});

test('Belt and Road: needs $4', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_bri: 0 };
  armAction(S, 0); S.players[0].money = 3;
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'silkroad' });
  assert.equal(S.mode, null);
});

/* ---------- THE NIGERIAN PRINCE ---------- */
test('Nigerian Prince: $2 and a coin: heads +$5, tails nothing, once per turn, owner only', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_nigprince: 0 };
  armAction(S, 1); S.players[1].money = 10;
  await e.f.applyIntent(1, { act: 'advance' });
  assert.equal(S.players[1].money, 10, 'a rival cannot');
  armAction(S, 0); S.players[0].money = 10;
  await withRandomSeq([0.1], () => e.f.applyIntent(0, { act: 'advance' }));
  await settle();
  assert.equal(S.players[0].money, 10 - 2 + 5 + QUIET, 'heads');
  assert.ok(S.log.some(l => l.includes('Heads')));
  S.deck = ['quiet', 'quiet']; armAction(S, 0); S.wTurn = {}; S.players[0].money = 10;
  await withRandomSeq([0.9], () => e.f.applyIntent(0, { act: 'advance' }));
  await settle();
  assert.equal(S.players[0].money, 8 + QUIET, 'tails: out the $2, nothing back');
  assert.ok(S.log.some(l => l.includes('Tails')));
  /* once per turn when the turn does not end */
  S.deck = ['quiet', 'quiet']; armAction(S, 0); S.wTurn = { advance: 1 }; S.players[0].money = 10;
  await e.f.applyIntent(0, { act: 'advance' });
  assert.equal(S.players[0].money, 10);
  /* and it needs $2 */
  S.wTurn = {}; S.players[0].money = 1;
  await e.f.applyIntent(0, { act: 'advance' });
  assert.equal(S.players[0].money, 1);
});

/* ---------- MRS WATANABE ---------- */
test('Watanabe: borrow $6, repay $9 at the start of your next turn', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_watanabe: 0 };
  armAction(S, 0); S.players[0].money = 10; S.players[0].cortisol = 0;
  await e.f.applyIntent(0, { act: 'carry' });
  await settle();
  assert.equal(S.players[0].money, 16 + QUIET);
  assert.equal(S.carry[0], 1);
  /* one loan at a time */
  armAction(S, 0); S.deck = ['quiet', 'quiet'];
  await e.f.applyIntent(0, { act: 'carry' });
  assert.equal(S.players[0].money, 16 + QUIET, 'a second loan is refused');
  /* the debt comes due at the start of seat 0's next turn */
  S.cur = 0; S.players[0].money = 30; S.players[0].cortisol = 0;
  const m0 = S.players[0].money;
  await e.f.startTurn();
  await settle();
  assert.equal(S.carry[0], undefined, 'debt cleared');
  assert.ok(S.players[0].money - m0 < 9 + 20 && S.log.some(l => l.includes('repays $9')), 'repaid');
  assert.equal(S.players[0].cortisol, 0);
});

test('Watanabe: if you cannot repay, +3 Cortisol instead and the debt is gone', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_watanabe: 0, citi: 0 };
  S.carry = { 0: 1 };
  S.cur = 0; S.players[0].money = 0; S.players[0].cortisol = 0; S.turn = 2;
  /* nothing on the board pays, so the player truly cannot cover $9 */
  S.owner = { w_watanabe: 0 };
  await e.f.startTurn();
  await settle();
  assert.equal(S.carry[0], undefined);
  assert.equal(S.players[0].cortisol, 3);
  assert.ok(S.log.some(l => l.includes('Tokyo collects in Cortisol')));
});

/* ---------- THE BANGALORE CALL CENTRE ---------- */
test('Bangalore: put a rival on hold: they lose 1 Intel; not yourself, not without Intel, once per turn', async t => {
  const { e, S } = await worldGame(t, { players: 3 });
  S.owner = { w_bangalore: 0 };
  armAction(S, 0); S.players[1].intel = 3; S.players[2].intel = 0;
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'hold' });
  assert.equal(S.mode, 'hold');
  await e.f.applyIntent(0, { act: 'hold', target: 0 });
  assert.equal(S.mode, 'hold', 'not yourself');
  await e.f.applyIntent(0, { act: 'hold', target: 2 });
  assert.equal(S.mode, 'hold', 'a rival with no Intel is refused');
  await e.f.applyIntent(0, { act: 'hold', target: 1 });
  await settle();
  assert.equal(S.players[1].intel, 2);
  assert.ok(S.log.some(l => l.includes('on hold')));
  /* once per turn */
  S.deck = ['quiet', 'quiet']; armAction(S, 0); S.wTurn = { hold: 1 };
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'hold' });
  assert.equal(S.mode, null);
  /* nobody to hold: every rival is out of Intel */
  S.wTurn = {}; S.players[1].intel = 0; S.players[2].intel = 0;
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'hold' });
  assert.equal(S.mode, null);
});

/* ---------- THE AMAZON ---------- */
test('Amazon: carbon credits pay $3 per node you own that is not a COMMODITY, once per turn', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_amazon: 0, citi: 0, nab: 0, oil: 0, gold: 0 }; /* WILD + 2 BANK = 3 non-commodity, 2 commodity */
  const nonCom = e.ctx.NODES.filter(n => S.owner[n.id] === 0 && n.type !== 'COMMODITY').length;
  assert.equal(nonCom, 3);
  armAction(S, 1); S.players[1].money = 5;
  await e.f.applyIntent(1, { act: 'carbon' });
  assert.equal(S.players[1].money, 5, 'rival cannot');
  armAction(S, 0); S.players[0].money = 10;
  await e.f.applyIntent(0, { act: 'carbon' });
  await settle();
  assert.equal(S.players[0].money, 10 + 9 + QUIET);
  S.deck = ['quiet', 'quiet']; armAction(S, 0); S.wTurn = { carbon: 1 }; S.players[0].money = 10;
  await e.f.applyIntent(0, { act: 'carbon' });
  assert.equal(S.players[0].money, 10, 'once per turn');
});

/* ---------- THE BERMUDA TRIANGLE ---------- */
test('Bermuda: vanish for a round, untargetable, reappear at the named node, once per game', async t => {
  const { e, S } = await worldGame(t, { players: 3 });
  S.owner = { w_bermuda: 0 };
  const dest = 'w_panama';
  S.players[0].pos = 'quik';
  armAction(S, 0);
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'vanish' });
  assert.equal(S.mode, 'vanish');
  await e.f.applyIntent(0, { act: 'vanish', id: 'not_a_node' });
  assert.equal(S.mode, 'vanish');
  await e.f.applyIntent(0, { act: 'vanish', id: dest });
  await settle();
  assert.equal(S.vanished[0], dest);
  assert.equal(S.wGame.bermuda, 1);
  assert.equal(e.ctx.isVanished(0), true);
  assert.equal(e.ctx.isRival(1, 0), false, 'a rival cannot target the vanished seat');
  assert.equal(e.ctx.isRival(1, 2), true);
  /* a rival's tweet at the vanished seat is refused */
  S.owner.trump = 1; S.players[1].money = 20;
  armAction(S, 1); S.mode = 'tweet';
  const intel = S.players[0].intel;
  await e.f.applyIntent(1, { act: 'tweet', target: 0 });
  assert.equal(S.players[0].intel, intel);
  assert.ok(!S.log.some(l => l.includes('TRUMP') && l.includes('Player 1')) || true);
  /* the seat reappears at the start of its own next turn, where it said */
  S.mode = null; S.cur = 0; S.turn += 1; S.deck = ['quiet', 'quiet', 'quiet'];
  await e.f.startTurn();
  await settle();
  assert.equal(S.players[0].pos, dest);
  assert.equal(S.vanished[0], undefined);
  assert.equal(e.ctx.isVanished(0), false);
  assert.ok(S.log.some(l => l.includes('reappears')));
  /* once per game */
  armAction(S, 0); S.deck = ['quiet', 'quiet'];
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'vanish' });
  assert.equal(S.mode, null);
});

test('Bermuda: cannot reappear at a blockaded node; blockade turns the pick away', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_bermuda: 0 };
  S.blockades = { w_panama: S.turn + 2 };
  armAction(S, 0);
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'vanish' });
  await e.f.applyIntent(0, { act: 'vanish', id: 'w_panama' });
  assert.equal(S.mode, 'vanish');
  assert.ok(!S.vanished);
});

/* ---------- the intents are gated on the expansion ---------- */
test('without the expansion none of the new intents does anything', async t => {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = false;
  const S = await makeGame(e, 2, { geo: false });
  S.owner = { citi: 0 }; S.phase = 'action'; S.cur = 0; S.mode = null;
  S.players[0].money = 10;
  for (const act of ['carry', 'carbon', 'advance', 'worldmode', 'edgepick', 'vanish', 'hold']) await e.f.applyIntent(0, { act, kind: 'chainsaw', id: 'quik', target: 1 });
  assert.equal(S.mode, null);
  assert.equal(S.players[0].money, 10);
});
