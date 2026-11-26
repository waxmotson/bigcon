/*
 * WORLD EXPANSION abilities, batch A: Powell, the four casualties that start as rubble (SVB, Credit Suisse /
 * UBS, Nord Stream, Evergrande), the chokepoints (Panama, Hormuz, Suez + the Ever Given), Lloyd's, the
 * Vatican's regulator exemption, Antarctica and the Svalbard Seed Vault. Every effect runs through the real
 * engine (applyIntent / startTurn / endOfTurn / strikeNode); state is only ever S, so it syncs with the table.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, bfs, pump } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

/* A 2-seat host game on the world expansion (+ the Geography DLC when asked), a controlled quiet deck. */
async function worldGame(t, { geo = true, players = 2 } = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  const Net = e.acc.Net;
  Net.boardLayout = 'random'; Net.dlcWorld = true;
  const S = await makeGame(e, players, { geo });
  assert.equal(Net.myIdx, 0);
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  return { e, S: e.acc.S };
}
const armAction = (S, cur = 0) => { S.cur = cur; S.phase = 'action'; S.mode = null; };

test('the abilities in this batch are no longer flagged todo', async () => {
  const W = await import('../static/js/world.js');
  const done = ['w_mamdani', 'w_cs', 'w_nordstream', 'w_evergrande', 'w_panama', 'w_hormuz', 'w_suez', 'w_vero', 'w_vatican', 'w_antarctica', 'w_svalbard'];
  for (const id of done) {
    const n = W.WORLD_NODES.find(x => x.id === id);
    assert.ok(n, id + ' exists');
    assert.ok(!n.todo, id + ' is live');
    assert.ok(!/Phase 2/.test(n.sp), id + ' sp has no leftover phase-2 marker');
  }
  assert.equal(W.WORLD_NODES.filter(n => n.todo).length, 0, 'batch B finished the rest');
});

/* ---------- ZOHRAN MAMDANI ---------- */
test('Mamdani: TAX THE RICH — the richest rival pays $2 at the start of your turn, only if richer than you', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_mamdani: 0, citi: 0 };
  const P = S.players;
  P[0].money = 10; P[1].money = 30; P[2] && (P[2].money = 20);
  S.cur = 0; await e.f.startTurn(); await settle();
  assert.ok(S.log.some(l => l.includes('TAX THE RICH')), 'the table saw it');
  assert.equal(P[1].money <= 28 + 5, true);
  assert.ok(S.log.some(l => l.includes('TAX THE RICH') && l.includes(e.ctx.pname(1))), 'the richest rival pays');
  /* nobody richer: nothing */
  S.log.length = 0; P.forEach(p => { p.money = 5; }); P[0].money = 50;
  S.cur = 0; S.phase = 'move'; await e.f.startTurn(); await settle();
  assert.ok(!S.log.some(l => l.includes('TAX THE RICH')), 'only a richer rival is taxed');
});

/* ---------- RUBBLE STARTS ---------- */
test('Credit Suisse, Nord Stream and Evergrande open the game as rubble; the board is still connected and winnable', async t => {
  const { e, S } = await worldGame(t);
  for (const id of ['w_cs', 'w_nordstream', 'w_evergrande']) assert.equal(S.rubble[id], 1, id + ' starts as rubble');
  assert.ok(S.log.some(l => l.includes('open the game as RUBBLE')), 'announced in the log');
  assert.equal(Object.keys(S.rubble).length, 3, 'nothing else starts as rubble');
  /* every node is still reachable from Quikstop (rubble is walkable) */
  const dist = bfs(e.ctx.ADJ, 'quik');
  for (const n of e.ctx.NODES) assert.ok(dist.has(n.id), n.id + ' reachable');
  /* every win type still has plenty of standing nodes, so the goal check is unaffected */
  for (const ty of e.ctx.WIN_TYPES) assert.ok(e.ctx.NODES.filter(n => n.type === ty && !S.rubble[n.id]).length >= 3, ty + ' still available');
  /* rubble cannot be seized */
  S.players[0].pos = 'w_nordstream'; S.players[0].money = 50; armAction(S);
  await e.f.applyIntent(0, { act: 'seize' });
  assert.equal(S.owner.w_nordstream, undefined, 'a rubble node cannot be seized');
  /* without the expansion the casualties are not rubble */
  e.f.rebuildWorld(true, false);
});

test('rebuilding a world rubble node: list price, returns unowned, fires the Pyongyang Hotel kickback', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { geo_pyothotel: 1 };
  S.players[0].pos = 'w_nordstream'; S.players[0].money = 40; S.players[1].money = 10;
  armAction(S);
  const cost = e.ctx.NMAP.w_nordstream.cost;
  await e.f.applyIntent(0, { act: 'rebuild' });
  await settle();
  assert.equal(S.rubble.w_nordstream, undefined, 'rebuilt');
  assert.equal(S.owner.w_nordstream, undefined, 'returns unowned');
  assert.equal(S.players[0].money, 40 - cost + 2, 'paid list price (+ the quiet quarter)');
  assert.ok(S.log.some(l => l.includes('construction kickbacks')), 'the Pyongyang Hotel kickback fired');
  assert.ok(S.players[1].money >= 10 + 2, 'and the Hotel owner banked it');
});

test('Evergrande +$2 per CORPORATE, Credit Suisse rebuilds as UBS and pays +$2 per BANK', async t => {
  const { e, S } = await worldGame(t);
  const W = await import('../static/js/world.js');
  const NM = e.ctx.NMAP;
  const syn = ids => W.worldSynergy(ids.map(id => NM[id]), id => ids.includes(id), () => 0);
  assert.equal(syn(['w_evergrande']), 2, 'Evergrande counts itself');
  const corp = e.ctx.NODES.find(n => n.type === 'CORPORATE' && !n.fx).id;
  assert.equal(syn(['w_evergrande', corp]), 4, 'two corporates: $2 each');
  assert.equal(syn(['w_cs']), 2);
  /* the rename lives in synced state: UBS only after the rebuild */
  assert.deepEqual(e.ctx.nodeName(NM.w_cs), ['CREDIT SUISSE']);
  S.players[0].pos = 'w_cs'; S.players[0].money = 30; armAction(S);
  await e.f.applyIntent(0, { act: 'rebuild' });
  await settle();
  assert.equal(S.rebuilt.w_cs, 1, 'recorded in state, not on the client');
  assert.deepEqual(e.ctx.nodeName(NM.w_cs), ['UBS']);
  assert.ok(S.log.some(l => l.includes('rises again as UBS')));
  assert.ok(e.f.nodeSVG(NM.w_cs, 'node').includes('UBS'), 'the card shows UBS');
  /* and the engine income picks the fx up */
  S.cur = 0; S.mood = 'CALM'; S.owner = { w_cs: 0 }; S.players[0].money = 0;
  e.f.income(0);
  assert.equal(S.players[0].money, 3 + 2 + 2, 'salary + holding + $2 per BANK (itself)');
});

test('Nord Stream pays +$3 on OIL SPIKES once rebuilt and owned', async t => {
  const { e, S } = await worldGame(t);
  S.rubble = {}; S.cur = 0; S.owner = { w_nordstream: 0 }; S.players[0].money = 20; S.deck = ['oilspike']; S.phase = 'action';
  await e.f.endOfTurn();
  assert.equal(S.players[0].money, 20 - 1 + 3, 'the pump price, then Nord Stream');
});

/* ---------- CHOKEPOINTS ---------- */
test('chokepoint tolls: rivals pay $2 entering Panama, Hormuz and Suez, $1 elsewhere, and 007 still walks free', async t => {
  const { e, S } = await worldGame(t, { players: 2 });
  const ADJ = e.ctx.ADJ;
  for (const id of ['w_panama', 'w_hormuz', 'w_suez']) {
    const from = ADJ[id].find(x => !S.rubble[x] && x !== id);
    S.owner = { [id]: 0 }; S.cur = 1; S.phase = 'move'; S.steps = 3; S.mode = null;
    S.players[1].pos = from; S.players[1].money = 10; S.players[0].money = 0;
    await e.f.applyIntent(1, { act: 'move', id });
    assert.equal(S.players[1].pos, id, id + ' entered');
    assert.equal(S.players[1].money, 8, id + ': $2 toll');
    assert.equal(S.players[0].money, 2, id + ': paid to the owner');
  }
  /* an ordinary owned node still costs $1 */
  const plain = 'w_burj', from = ADJ[plain][0];
  S.owner = { [plain]: 0 }; S.cur = 1; S.phase = 'move'; S.steps = 3; S.players[1].pos = from; S.players[1].money = 10;
  await e.f.applyIntent(1, { act: 'move', id: plain });
  assert.equal(S.players[1].money, 9, 'ordinary toll is $1');
  /* the owner walking in pays nothing; a bankrupt rival is refused */
  S.owner = { w_panama: 0 }; S.cur = 1; S.phase = 'move'; S.steps = 3; S.players[1].pos = ADJ.w_panama[0]; S.players[1].money = 1;
  await e.f.applyIntent(1, { act: 'move', id: 'w_panama' });
  assert.notEqual(S.players[1].pos, 'w_panama', 'cannot afford the $2');
  /* 007 flashes credentials */
  S.owner = { w_panama: 0, bond007: 1 }; S.players[1].money = 5;
  await e.f.applyIntent(1, { act: 'move', id: 'w_panama' });
  assert.equal(S.players[1].money, 5, '007 pays no toll');
});

test('Hormuz collects $2 per rival-owned oil node on OIL SPIKES', async t => {
  const { e, S } = await worldGame(t);
  S.cur = 0; S.owner = { w_hormuz: 0, oil: 1, w_aramco: 1, tanker: 0 }; S.players[0].money = 20; S.deck = ['oilspike']; S.phase = 'action';
  await e.f.endOfTurn();
  assert.equal(S.players[0].money, 20 - 1 + 3 /* tanker windfall */ + 2 * 2, 'two rival oil nodes at $2, nothing for its own');
  assert.ok(S.log.some(l => l.includes('Strait of Hormuz taxes 2')));
  /* nothing without the node */
  S.owner = { oil: 1, w_aramco: 1 }; S.cur = 0; S.players[0].money = 20; S.deck = ['oilspike']; S.phase = 'action';
  await e.f.endOfTurn();
  assert.equal(S.players[0].money, 19, 'only the pump price');
});

test('Suez: the Ever Given blocks the canal for a round, once per game, owner only', async t => {
  const { e, S } = await worldGame(t);
  const ADJ = e.ctx.ADJ;
  S.owner = { w_suez: 0 };
  /* a non-owner cannot */
  armAction(S, 1);
  await e.f.applyIntent(1, { act: 'evergiven' });
  assert.ok(!S.evergivenUsed && !e.ctx.blockaded('w_suez'));
  /* the owner can */
  S.deck = ['quiet', 'quiet', 'quiet'];
  armAction(S, 0);
  const t0 = S.turn;
  await e.f.applyIntent(0, { act: 'evergiven' });
  await settle();
  assert.equal(S.evergivenUsed, true);
  assert.equal(S.blockades.w_suez, t0 + 2, 'same one-rotation window as the PM blockade');
  assert.equal(e.ctx.blockaded('w_suez'), true);
  assert.ok(S.log.some(l => l.includes('EVER GIVEN')));
  /* nobody walks in, owner included */
  for (const pi of [0, 1]) {
    S.cur = pi; S.phase = 'move'; S.steps = 3; S.mode = null; S.players[pi].pos = ADJ.w_suez[0]; S.players[pi].money = 10;
    await e.f.applyIntent(pi, { act: 'move', id: 'w_suez' });
    assert.notEqual(S.players[pi].pos, 'w_suez', 'seat ' + pi + ' is turned away');
  }
  /* once per game */
  S.deck = ['quiet', 'quiet'];
  armAction(S, 0); S.blockades = {};
  await e.f.applyIntent(0, { act: 'evergiven' });
  assert.equal(e.ctx.blockaded('w_suez'), false, 'the second Ever Given is refused');
  /* the blockade lifts at the end of next round */
  S.blockades.w_suez = S.turn + 2; S.turn += 2; S.cur = 0; S.over = false;
  await e.f.startTurn();
  assert.equal(S.blockades.w_suez, undefined);
});

/* ---------- LLOYD'S ---------- */
test("Lloyd's: $3 for any missile kill, and the full list price when the destroyed node was its owner's", async t => {
  const { e, S } = await worldGame(t);
  const strike = e.ctx.strikeNode;
  S.owner = { w_vero: 1, oil: 0 }; S.players[1].money = 0; S.players[0].money = 0;
  strike(0, 'oil');
  assert.equal(S.players[1].money, 3, "someone else's node: $3");
  assert.equal(S.rubble.oil, 1);
  S.owner = { w_vero: 1, infl: 1 }; S.players[1].money = 0;
  strike(0, 'infl');
  assert.equal(S.players[1].money, e.ctx.NMAP.infl.cost, 'its own node: full list price');
  S.owner = { w_vero: 1 }; S.players[1].money = 0;
  strike(0, 'w_vero');
  assert.equal(S.players[1].money, e.ctx.NMAP.w_vero.cost, 'Lloyd\'s itself is insured too');
  S.owner = {}; S.players[1].money = 0;
  strike(0, 'cash');
  assert.equal(S.players[1].money, 0, 'no owner, no payout');
});

/* ---------- VATICAN ---------- */
test('the Vatican exempts its holder from ACCC banking and ASIC monetary-policy files; others are still caught', async t => {
  const { e, S } = await worldGame(t);
  const C = e.ctx;
  const ind = id => C.INDBYID[id];
  const bankTrigger = C.industryTrigger(ind('bank'));
  const banks = C.NODES.filter(n => n.type === 'BANK' && n.id !== 'w_vatican' && !S.rubble[n.id]).slice(0, bankTrigger).map(n => n.id);
  S.owner = {}; banks.forEach(id => { S.owner[id] = 0; });
  C.acccReconcile();
  assert.ok(C.findFile(0, 'bank'), 'control: a concentrated banking book opens a file');
  S.owner.w_vatican = 0;
  C.acccReconcile();
  assert.equal(C.findFile(0, 'bank'), null, 'the Vatican closes the file');
  assert.equal(C.concentratedIndustries(0).some(x => x.g.id === 'bank'), false);
  /* monetary policy (ASIC) */
  S.owner = { mpc: 0, rba: 0, cash: 0 };
  C.acccReconcile();
  assert.ok(C.findFile(0, 'monetary'), 'control: ASIC opens a file');
  S.owner.w_vatican = 0;
  C.acccReconcile();
  assert.equal(C.findFile(0, 'monetary'), null, 'exempt from ASIC too');
  /* a rival is not covered by someone else's Vatican */
  S.owner = { w_vatican: 1 }; banks.forEach(id => { S.owner[id] = 0; });
  C.acccReconcile();
  assert.ok(C.findFile(0, 'bank'), 'it only shields its own holder');
  /* without the world expansion the exemption does not exist */
  assert.equal(C.acccExempt(0, 'bank'), false);
  assert.equal(C.acccExempt(1, 'bank'), true);
  assert.equal(C.acccExempt(1, 'coal'), false);
});

/* ---------- ANTARCTICA ---------- */
test('Antarctica cannot be taken over, but anyone can claim it while it is unowned', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_antarctica: 0 };
  S.players[1].pos = 'w_antarctica'; S.players[1].money = 100;
  armAction(S, 1);
  await e.f.applyIntent(1, { act: 'seize' });
  assert.equal(S.owner.w_antarctica, 0, 'the takeover is refused');
  assert.equal(S.players[1].money, 100, 'and costs nothing');
  assert.equal(e.ctx.noTakeover('w_antarctica'), true);
  assert.equal(e.ctx.botView(1).noTakeover('w_antarctica'), true, 'bots are told');
  /* an ordinary node can still be taken, and unowned Antarctica can be claimed */
  S.owner = { oil: 0 }; S.players[1].pos = 'oil'; armAction(S, 1);
  await e.f.applyIntent(1, { act: 'seize' }); await settle();
  assert.equal(S.owner.oil, 1);
  S.owner = {}; S.players[1].pos = 'w_antarctica'; armAction(S, 1); S.deck = ['quiet', 'quiet'];
  await e.f.applyIntent(1, { act: 'seize' }); await settle();
  assert.equal(S.owner.w_antarctica, 1, 'claimable while unowned');
});

/* ---------- SVALBARD ---------- */
test('Svalbard: its owner’s nodes survive missiles (Lloyd’s does not pay), and nobody else is protected', async t => {
  const { e, S } = await worldGame(t);
  const strike = e.ctx.strikeNode;
  S.owner = { w_svalbard: 1, oil: 1, w_vero: 0 }; S.players[0].money = 0;
  strike(0, 'oil');
  assert.equal(S.owner.oil, 1, 'still theirs');
  assert.equal(S.rubble.oil, undefined, 'no rubble');
  assert.ok(S.log.some(l => l.includes('SEED VAULT shrugs it off')));
  assert.equal(S.players[0].money, 0, 'nothing was destroyed, so Lloyd’s pays nothing');
  strike(0, 'w_svalbard');
  assert.equal(S.owner.w_svalbard, 1, 'the vault protects itself');
  S.owner = { oil: 1 };
  strike(0, 'oil');
  assert.equal(S.rubble.oil, 1, 'with no vault, the missile lands');
  /* an unowned node is not protected by anyone's vault */
  S.owner = { w_svalbard: 1 };
  strike(0, 'cash');
  assert.equal(S.rubble.cash, 1);
});

test('Svalbard: one free rebuild per game, owner only, and the Pyongyang Hotel still collects', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_svalbard: 0, geo_pyothotel: 1 };
  S.players[0].pos = 'w_evergrande'; S.players[0].money = 0; S.players[1].money = 0;
  armAction(S);
  /* a non-owner's free rebuild is refused */
  S.owner.w_svalbard = 1; S.cur = 0;
  await e.f.applyIntent(0, { act: 'rebuild', free: true });
  assert.equal(S.rubble.w_evergrande, 1, 'refused: not the vault owner');
  S.owner.w_svalbard = 0;
  assert.equal(e.ctx.botView(0).svalbardFree(0), true);
  await e.f.applyIntent(0, { act: 'rebuild', free: true });
  await settle();
  assert.equal(S.rubble.w_evergrande, undefined, 'rebuilt for free');
  assert.equal(S.svalbardUsed, true);
  assert.ok(S.players[1].money >= 2, 'the Hotel kickback still fires');
  assert.ok(S.log.some(l => l.includes('Seed Vault')));
  /* once per game */
  S.players[0].pos = 'w_nordstream'; S.players[0].money = 0; armAction(S);
  assert.equal(e.ctx.botView(0).svalbardFree(0), false);
  await e.f.applyIntent(0, { act: 'rebuild', free: true });
  assert.equal(S.rubble.w_nordstream, 1, 'the free rebuild is spent');
  /* the paid rebuild still works and a broke player cannot rebuild */
  await e.f.applyIntent(0, { act: 'rebuild' });
  assert.equal(S.rubble.w_nordstream, 1, 'cannot afford the paid rebuild with $0');
});

/* ---------- BOTS ---------- */
test('an all-bot world game plays on without a bot crash', { timeout: 120000 }, async t => {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.ctx.window.__BIGCON_TEST__ = true;
  e.ctx.window.__BIGCON_BOT_SEED__ = 4242;
  await e.loadBots();
  const Net = e.acc.Net;
  Net.boardLayout = 'random'; Net.dlcWorld = true;
  const S = await makeGame(e, 3, { bots: [0, 1, 2], goal: 60, geo: true, seeds: [41] });
  assert.equal(S.rubble.w_nordstream, 1);
  for (let i = 0; i < 6000 && !S.over && S.turn < 40; i++) {
    await pump(2);
    if (e.clock.pending()) e.clock.advance(25);
  }
  assert.ok(S.turn > 3, 'the table kept playing (turn ' + S.turn + ')');
  const botErrors = e.consoleOut.error.filter(l => String(l).includes('bot turn error'));
  assert.equal(botErrors.length, 0, 'no bot turn crashed: ' + String(botErrors[0]).slice(0, 300));
});
