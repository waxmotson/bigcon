/*
 * NODE REWORKS: NAB, WESTPAC, COMMONWEALTH BANK, ANZ, QUIKSTOP, THE GOLF CLUB, JIM CHALMERS and, on the Global Edition, BAIKONUR, ZIMBABWE,
 * THE SWISS VAULT, AREA 51, THE WALL STREET BELL, THE TURKISH LIRA, THE BAHT 1997, SRI LANKA, THE PYRAMIDS and GREENLAND.
 * Everything runs through the real engine (applyIntent / startTurn / raid). Guests are fake connections whose prompts are answered
 * from a scripted queue; bots answer through the real policy module.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, pump } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
/* run an intent to completion, advancing the virtual clock so guest prompts and flight pauses resolve */
async function run(e, pi, m) {
  let done = false;
  const p = e.f.applyIntent(pi, m).finally(() => { done = true; });
  for (let i = 0; i < 14 && !done; i++) { await settle(); e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); }
  await p; await settle();
}
async function game(t, { players = 3, world = true, geo = false, bots, goal } = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  if (bots) { e.ctx.window.__BIGCON_TEST__ = true; e.ctx.window.__BIGCON_BOT_SEED__ = 4242; await e.loadBots(); }
  if (world) { e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = true; }
  const S = await makeGame(e, players, { geo, bots, goal });
  if (bots) { S.over = true; for (let i = 0; i < 30; i++) { await pump(2); if (e.clock.pending()) e.clock.advance(25); } S.over = false; }
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = {}; S.wGame = {}; S.nTurn = {}; S.acccFiles = [];
  S.cur = 0; S.mode = null; S.phase = 'action'; S.steps = 3;
  S.players.forEach(p => { p.money = 50; p.intel = 10; p.cortisol = 0; p.pos = 'quik'; p.raided = 0; });
  return { e, S: e.acc.S, P: e.acc.S.players };
}
const act = (S, cur = 0, phase = 'action') => { S.cur = cur; S.phase = phase; S.mode = null; S.nTurn = {}; };
const logged = (S, text) => S.log.some(l => String(l).includes(text));
const withRandom = async (v, fn) => { const real = Math.random; Math.random = () => v; try { return await fn(); } finally { Math.random = real; } };
const guestAnswers = (e, seat, answers) => { e.acc.Net.conns[seat].answers = answers.slice(); };
const promptTitles = (e, seat) => e.acc.Net.conns[seat].sent.filter(m => m.t === 'prompt').map(m => m.title);

/* ───────────── CLASSIC ───────────── */
test('NAB: a rival who ENDS movement on a node you own pays $2 on top of the toll; walking through is free of the fee', async t => {
  const { e, S, P } = await game(t, { world: false });
  S.owner = { nab: 0, citi: 0 };
  const adj = e.acc.ADJ.citi[0];
  /* ends the move on citi: $1 toll + $2 NAB fee */
  S.cur = 1; S.phase = 'move'; S.steps = 1; P[1].pos = adj; P[1].money = 20; P[0].money = 0;
  await run(e, 1, { act: 'move', id: 'citi' });
  assert.equal(S.phase, 'action');
  assert.equal(P[1].money, 20 - 1 - 2, 'toll $1 + NAB fee $2');
  assert.equal(P[0].money, 3, 'the owner collects both');
  assert.ok(logged(S, 'FEE FOR NO SERVICE'));
  /* walking THROUGH a node (steps left) does not trigger it: only the toll */
  S.cur = 1; S.phase = 'move'; S.steps = 3; P[1].pos = adj; P[1].money = 20; P[0].money = 0;
  await run(e, 1, { act: 'move', id: 'citi' });
  assert.equal(S.phase, 'move');
  assert.equal(P[1].money, 19, 'only the toll while still walking');
  /* without NAB there is no fee; nor on a node nobody owns */
  S.owner = { citi: 0 }; S.phase = 'move'; S.steps = 1; P[1].pos = adj; P[1].money = 20; S.cur = 1;
  await run(e, 1, { act: 'move', id: 'citi' });
  assert.equal(P[1].money, 19, 'no NAB, no fee');
  /* the old CHART seizure discount is gone */
  S.owner = { nab: 1 };
  assert.equal(e.f.seizeListPrice(1, e.acc.NMAP.stock), e.acc.NMAP.stock.cost);
});

test('WESTPAC: launder 1 Intel into $3, once per turn, opening and escalating a breach file; the ruling is a fine', async t => {
  const { e, S, P } = await game(t, { world: false });
  S.owner = { westpac: 0 }; P[0].money = 0; P[0].intel = 3;
  await run(e, 0, { act: 'launder', kind: 'bank' });
  assert.equal(P[0].money, 3); assert.equal(P[0].intel, 2);
  let f = e.f.findFile(0, 'bank');
  assert.ok(f && f.breach && f.agency === 'ACCC' && f.s === 1, 'a breach file opened on the BANKING book');
  assert.equal(S.phase, 'action', 'a free action: the turn is still on');
  await run(e, 0, { act: 'launder', kind: 'bank' });
  assert.equal(P[0].money, 3, 'once per turn');
  /* next turn: the other book, chosen from the prompt (ASIC) */
  S.nTurn = {};
  e.queueModal('monetary');
  await run(e, 0, { act: 'launder' });
  assert.equal(P[0].money, 6);
  const g = e.f.findFile(0, 'monetary');
  assert.ok(g && g.agency === 'ASIC' && g.s === 1, 'the ASIC file on MONETARY POLICY');
  assert.ok(e.modalRec.some(m => /23 MILLION BREACHES/.test(m.title)), 'the host was asked which book');
  /* it stays open (reconcile does not close a breach file) and escalates */
  S.nTurn = {};
  await run(e, 0, { act: 'launder', kind: 'bank' });
  assert.equal(e.f.findFile(0, 'bank').s, 2);
  e.f.acccReconcile();
  assert.ok(e.f.findFile(0, 'bank'), 'a breach file is not closed by reconcile');
  /* the ruling: 15% of cash, and the file closes */
  P[0].money = 100; f = e.f.findFile(0, 'bank'); f.s = 3;
  await e.f.acccRule(0, 'bank');
  assert.equal(P[0].money, 85, '15% fine');
  assert.equal(e.f.findFile(0, 'bank'), null);
  /* no Intel, no laundering */
  P[0].intel = 0; S.nTurn = {};
  await run(e, 0, { act: 'launder', kind: 'bank' });
  assert.equal(P[0].money, 85);
});

test('COMMONWEALTH BANK (host owner): refuses a hostile takeover once per game; the attacker keeps their money', async t => {
  const { e, S, P } = await game(t, { world: false });
  S.deck = ['tip', 'tip', 'tip', 'tip'];
  S.owner = { commbank: 0, anz: 0 }; P[1].money = 60; P[1].pos = 'anz'; S.cur = 1; S.phase = 'action';
  e.queueModal(1);
  await run(e, 1, { act: 'seize' });
  assert.equal(S.owner.anz, 0, 'the takeover failed');
  assert.equal(P[1].money, 60, 'the attacker keeps their money');
  assert.ok(S.wGame.cba, 'the refusal is spent');
  assert.notEqual(S.cur, 1, 'the attempt used their action');
  assert.ok(e.modalRec.some(m => /CAN’T BE BEAT/.test(m.title)), 'the owner was prompted');
  /* second attempt: the refusal is spent, so there is no prompt and the takeover goes through */
  const before = e.modalRec.length;
  S.cur = 1; S.phase = 'action'; S.nTurn = {};
  await run(e, 1, { act: 'seize' });
  assert.equal(S.owner.anz, 1);
  assert.ok(!e.modalRec.slice(before).some(m => /CAN’T BE BEAT/.test(m.title)), 'no second prompt');
});

test('COMMONWEALTH BANK (guest owner): the prompt goes over the wire; refuse and allow both work', async t => {
  const { e, S, P } = await game(t, { world: false });
  S.deck = ['tip', 'tip', 'tip', 'tip'];
  S.owner = { commbank: 1, anz: 1 }; P[0].money = 60; P[0].pos = 'anz';
  guestAnswers(e, 1, [0]);
  await run(e, 0, { act: 'seize' });
  assert.deepEqual(promptTitles(e, 1).filter(x => /CAN’T BE BEAT/.test(x)).length, 1, 'the guest got a private prompt');
  assert.equal(S.owner.anz, 0, 'the guest let it through, so the host owns anz now');
  assert.ok(!S.wGame.cba, 'allowing does not spend the refusal');
  /* second try on another node of theirs: this time the guest refuses */
  S.owner = { commbank: 1, nab: 1 }; P[0].money = 60; P[0].pos = 'nab'; act(S, 0);
  guestAnswers(e, 1, [1]);
  await run(e, 0, { act: 'seize' });
  assert.equal(S.owner.nab, 1, 'refused');
  assert.equal(P[0].money, 60, 'no money moved');
  assert.ok(S.wGame.cba);
  assert.ok(logged(S, 'CAN’T BE BEAT'));
});

test('COMMONWEALTH BANK (bot owner): the bot refuses a valuable node and shrugs at a cheap one', async t => {
  const { e, S } = await game(t, { world: false, bots: [1] });
  const Bots = e.ctx.window.BigConBots, api = e.ctx.botAPI(e.acc.Net.gameEpoch);
  S.owner = { commbank: 1, citi: 1, sat: 1 };
  const ask = nid => Bots.answerPrompt(1, { title: 'CAN’T BE BEAT — REFUSE THE TAKEOVER?', options: [{ v: 1 }, { v: 0 }], def: 0, meta: { kind: 'cba', node: nid, from: 0, price: 16 } }, api);
  assert.equal(await ask('citi'), 1, 'CITI TOWER ($3/turn, list $8) is valuable: refuse');
  assert.equal(await ask('sat'), 0, 'the outback satellite image is not worth the refusal');
});

test('ANZ: warned privately a turn ahead when BONDMAGEDDON is the next event (once per card), and nobody else is', async t => {
  const { e, S } = await game(t, { world: false });
  S.owner = { anz: 1 };
  S.deck = ['quiet', 'bondrevolt']; S.cur = 0; S.drawN = 0;
  await e.f.startTurn(); await settle(); e.clock.advance(50); await settle();
  assert.equal(promptTitles(e, 1).filter(x => /BOND DESK TIP-OFF/.test(x)).length, 1, 'the ANZ owner (a guest) got the tip-off');
  assert.equal(promptTitles(e, 2).filter(x => /BOND DESK TIP-OFF/.test(x)).length, 0, 'nobody else did');
  S.cur = 0; S.over = false;
  await e.f.startTurn(); await settle(); e.clock.advance(50); await settle();
  assert.equal(promptTitles(e, 1).filter(x => /BOND DESK TIP-OFF/.test(x)).length, 1, 'only once for the same card');
  /* a different next card: silence */
  S.deck = ['quiet', 'tip']; S.drawN = 5; S.cur = 0;
  await e.f.startTurn(); await settle(); e.clock.advance(50); await settle();
  assert.equal(promptTitles(e, 1).filter(x => /BOND DESK TIP-OFF/.test(x)).length, 1);
  /* and the chart income stays */
  S.owner = { anz: 0, tenyear: 0 }; S.players[0].money = 0;
  e.f.income(0);
  assert.equal(S.players[0].money, 3 + e.acc.NMAP.anz.income + e.acc.NMAP.tenyear.income + 1, 'salary + holdings + ANZ +$1 per chart (tenyear is the one chart)');
});

test('QUIKSTOP: +$2 per player in the game, rivals and you included', async t => {
  for (const n of [2, 3, 4]) {
    const { e, S, P } = await game(t, { world: false, players: n });
    S.owner = { quik: 0 }; P[0].money = 0;
    e.f.income(0);
    assert.equal(P[0].money, 3 + 2 + 2 * n, n + ' players: salary 3 + base income 2 + $2 x ' + n);
  }
});

test('THE GOLF CLUB: a swap a guest accepts transfers ownership, clears bugs, keeps the turn; a decline changes nothing; once per turn', async t => {
  const { e, S, P } = await game(t, { world: false });
  S.owner = { golf: 0, citi: 0, sat: 1 }; S.bugs = { citi: 1, sat: 0 }; S.seizeCount = { sat: 1 };
  guestAnswers(e, 1, [0]);
  await run(e, 0, { act: 'golftrade', target: 1, id: 'citi', kind: 'sat', n: 0 });
  assert.equal(S.owner.citi, 0); assert.equal(S.owner.sat, 1, 'declined: nothing moves');
  assert.ok(promptTitles(e, 1).some(x => /BACK NINE/.test(x)), 'the guest was prompted');
  assert.equal(S.phase, 'action'); assert.equal(S.cur, 0, 'a free action: still my action phase');
  assert.ok(S.nTurn.golf, 'the proposal used the once-per-turn');
  /* second proposal this turn is refused outright */
  guestAnswers(e, 1, [1]);
  await run(e, 0, { act: 'golftrade', target: 1, id: 'sat', kind: 'citi', n: 0 });
  assert.equal(S.owner.sat, 1);
  /* next turn: a swap with cash, accepted */
  S.nTurn = {}; P[0].money = 20; P[1].money = 20;
  guestAnswers(e, 1, [1]);
  await run(e, 0, { act: 'golftrade', target: 1, id: 'citi', kind: 'sat', n: 3 });
  assert.equal(S.owner.citi, 1); assert.equal(S.owner.sat, 0, 'ownership swapped');
  assert.equal(P[0].money, 17); assert.equal(P[1].money, 23, 'the sweetener moved');
  assert.equal(S.bugs.citi, undefined); assert.equal(S.bugs.sat, undefined, 'bugs on both nodes are cleared');
  assert.equal(S.seizeCount.sat, 1, 'the takeover history of a node stays with the node');
  assert.equal(S.phase, 'action'); assert.equal(S.cur, 0);
  /* an ask for cash, and invalid asks */
  S.nTurn = {}; P[0].money = 5; P[1].money = 30;
  guestAnswers(e, 1, [1]);
  await run(e, 0, { act: 'golftrade', target: 1, id: 'sat', kind: 'citi', n: -4 });
  assert.equal(S.owner.sat, 1); assert.equal(S.owner.citi, 0);
  assert.equal(P[0].money, 9); assert.equal(P[1].money, 26, 'the rival paid the $4 asked');
  S.nTurn = {};
  await run(e, 0, { act: 'golftrade', target: 1, id: 'citi', kind: 'nab', n: 0 });
  assert.ok(!S.nTurn.golf, 'cannot ask for a node the rival does not own');
  await run(e, 0, { act: 'golftrade', target: 0, id: 'citi', kind: 'sat', n: 0 });
  assert.ok(!S.nTurn.golf, 'cannot swap with yourself');
  /* no Golf Club, no swap */
  S.owner.golf = 1;
  await run(e, 0, { act: 'golftrade', target: 1, id: 'citi', kind: 'sat', n: 0 });
  assert.ok(!S.nTurn.golf);
});

test('THE GOLF CLUB: rubble cannot be swapped, and the old $1 seizure discount is gone', async t => {
  const { e, S } = await game(t, { world: false });
  S.owner = { golf: 0, citi: 0, sat: 1 }; S.rubble = { sat: 1 };
  guestAnswers(e, 1, [1]);
  await run(e, 0, { act: 'golftrade', target: 1, id: 'citi', kind: 'sat', n: 0 });
  assert.equal(S.owner.citi, 0, 'a rubble node is not a node you can ask for');
  assert.equal(e.f.seizeListPrice(0, e.acc.NMAP.citi), e.acc.NMAP.citi.cost, 'no seizure discount any more');
});

test('THE GOLF CLUB (bot): a bot accepts a swap that is good for it and declines one that is not', async t => {
  const { e, S, P } = await game(t, { world: false, players: 2, bots: [1] });
  assert.ok(P[1].bot, 'seat 1 is the bot');
  S.owner = { golf: 0, citi: 0, sat: 1 };
  /* the bot gives the satellite image for CITI TOWER: a gift */
  await run(e, 0, { act: 'golftrade', target: 1, id: 'citi', kind: 'sat', n: 0 });
  assert.equal(S.owner.citi, 1, 'the bot took the better node'); assert.equal(S.owner.sat, 0);
  assert.ok(logged(S, 'DEAL DONE'));
  /* the reverse: the bot is asked to give up CITI TOWER for the satellite image */
  S.nTurn = {};
  await run(e, 0, { act: 'golftrade', target: 1, id: 'sat', kind: 'citi', n: 0 });
  assert.equal(S.owner.citi, 1, 'the bot declined'); assert.equal(S.owner.sat, 0);
  assert.ok(logged(S, 'declines the swap'));
  /* the bot would not pay money it does not have */
  S.nTurn = {}; P[1].money = 0;
  await run(e, 0, { act: 'golftrade', target: 1, id: 'sat', kind: 'citi', n: -5 });
  assert.equal(S.owner.citi, 1);
});

test('JIM CHALMERS: at turn start see the next TWO events and choose which comes next; the other goes second', async t => {
  const { e, S } = await game(t, { world: false });
  S.owner = { chalmers: 0 };
  S.deck = ['tip', 'quiet', 'rates', 'oilspike'];   /* the top is the LAST: oilspike, then rates */
  S.cur = 0;
  e.queueModal('rates');
  await e.f.startTurn(); await settle();
  const rec = e.modalRec.find(m => /TREASURY BRIEF/.test(m.title));
  assert.ok(rec, 'the Treasurer was briefed');
  assert.equal(rec.options.length, 2);
  assert.deepEqual(S.deck.slice(-2), ['oilspike', 'rates'], 'rates is now drawn next, oilspike goes second');
  assert.equal(S.deck.length, 4, 'nothing lost');
  /* the default keeps the order */
  S.deck = ['tip', 'quiet', 'rates', 'oilspike']; S.cur = 0; S.over = false;
  await e.f.startTurn(); await settle();
  assert.deepEqual(S.deck.slice(-2), ['rates', 'oilspike']);
  /* a short deck is topped up from the discard, never fumbled */
  S.deck = ['oilspike']; S.discard = ['rates', 'tip']; S.cur = 0;
  await e.f.startTurn(); await settle();
  assert.equal(S.deck.length, 3); assert.equal(S.deck[S.deck.length - 1], 'oilspike');
  /* the Treasurer's income synergy stays */
  S.owner = { chalmers: 0, asic: 0 }; S.players[0].money = 0; e.f.income(0);
  assert.equal(S.players[0].money, 3 + e.acc.NMAP.chalmers.income + e.acc.NMAP.asic.income + 1, 'salary + holdings + $1 per REGULATOR');
});

test('JIM CHALMERS (bot): the bot draws the kinder of the two events', async t => {
  const { e } = await game(t, { world: false, bots: [1] });
  const Bots = e.ctx.window.BigConBots, api = e.ctx.botAPI(e.acc.Net.gameEpoch);
  const v = await Bots.answerPrompt(1, { title: 'TREASURY BRIEF — CHOOSE THE NEXT EVENT', options: [{ v: 'oilspike' }, { v: 'quiet' }], def: 'oilspike', meta: { kind: 'treasury', cards: ['oilspike', 'quiet'] } }, api);
  assert.ok(['oilspike', 'quiet'].includes(v));
  const v2 = await Bots.answerPrompt(1, { title: 'TREASURY BRIEF — CHOOSE THE NEXT EVENT', options: [{ v: 'snoop' }, { v: 'quiet' }], def: 'snoop', meta: { kind: 'treasury', cards: ['snoop', 'quiet'] } }, api);
  assert.ok(['snoop', 'quiet'].includes(v2));
});

/* ───────────── GLOBAL EDITION ───────────── */
test('BAIKONUR: ESCAPE ON THE ROCKET cancels one raid per game, launches the pawn and resets Cortisol to 5; launch and missile synergy stay; the outback sat is untouched', async t => {
  const { e, S, P } = await game(t);
  S.owner = { w_baikonur: 0, citi: 0, oil: 0 }; P[0].cortisol = 8; P[0].pos = 'citi'; P[0].money = 40;
  e.queueModal(1); /* the raid bulletin */
  e.acc.Net.role = 'host';
  e.f.addCortisol(0, 1, 'test');
  await settle();
  assert.equal(P[0].raided, 0, 'no raid');
  assert.equal(S.owner.citi, 0); assert.equal(S.owner.oil, 0, 'nothing seized');
  assert.equal(P[0].money, 40, 'no fine');
  assert.equal(P[0].pos, 'w_baikonur', 'launched to the cosmodrome');
  assert.equal(P[0].cortisol, 5, 'Cortisol resets to a moderate level');
  assert.ok(S.wGame.rocket);
  /* the second time the raid happens for real */
  P[0].cortisol = 8;
  e.f.addCortisol(0, 1, 'test');
  assert.equal(P[0].raided, 1, 'the escape is spent');
  assert.ok(Object.keys(S.owner).length < 3, 'the second raid takes assets');
  /* the other half: a node of your choice */
  S.wGame = {}; S.owner = { w_baikonur: 0, citi: 0, oil: 0 }; P[0].raided = 0; P[0].cortisol = 8; P[0].pos = 'citi';
  e.modalQueue.length = 0; e.queueModal(1); e.queueModal('pick'); e.queueModal('sat');
  e.f.addCortisol(0, 1, 'test'); await settle(); await settle();
  assert.equal(P[0].pos, 'sat', 'the owner chose where to land');
  assert.equal(P[0].cortisol, 5);
  /* the classic outback satellite image is exactly as it was */
  const sat = e.acc.NMAP.sat;
  assert.equal(sat.sp, '−1 Cortisol at the start of each of your turns (hiding out bush).');
  assert.ok(!sat.fx);
  /* the old abilities */
  const n = e.acc.NMAP.w_baikonur;
  assert.match(n.sp, /LAUNCH WINDOW/); assert.match(n.sp, /LIFTOFF/); assert.match(n.sp, /ESCAPE ON THE ROCKET/);
});

test('ZIMBABWE: PRINT MONEY once per game (20% of the goal), then every seizure costs +$1, and inflation stacks', async t => {
  const { e, S, P } = await game(t, { goal: 200 });
  const Q = e.f.cs(2);
  S.owner = { w_zim: 0 }; P[0].money = 10;
  await run(e, 0, { act: 'printmoney' });
  assert.equal(S.goal, 200);
  assert.equal(P[0].money, 10 + 40 + Q + e.f.cs(3), '20% of $200 = $40 (+ the quiet quarter that ends the turn, and ZIMBABWE’s own quiet-quarter windfall)');
  assert.equal(S.inflation, 1);
  assert.ok(S.wGame.zim);
  act(S, 0); P[0].money = 10;
  await run(e, 0, { act: 'printmoney' });
  assert.equal(P[0].money, 10, 'once per game');
  /* every seizure costs +$1: unowned and takeover alike */
  const n = e.acc.NMAP.sat;
  act(S, 1); P[1].pos = 'sat'; P[1].money = 30;
  await run(e, 1, { act: 'seize' });
  assert.equal(S.owner.sat, 1);
  assert.equal(P[1].money, 30 - n.cost - 1 + Q, 'list price + $1 inflation (+ the quiet quarter)');
  /* it stacks */
  e.ctx.addInflation(2, 'a later event');
  assert.equal(S.inflation, 3);
  assert.equal(e.ctx.inflationExtra(), 3);
  act(S, 2); P[2].pos = 'sat'; P[2].money = 100;
  await run(e, 2, { act: 'seize' });
  assert.equal(P[2].money, 100 - (n.cost * 2 + 3) + Q, 'takeover doubling + $3 inflation');
  /* the bots see the same price */
  assert.equal(e.ctx.botView(0).seizePrice(0, 'quik'), e.acc.NMAP.quik.cost + 3);
  /* shown in the UI */
  e.acc.Net.myIdx = 0;
  assert.match(e.ctx.worldStrip(), /INFLATION/);
});

test('THE SWISS VAULT: stash cash beyond raids; withdraw free once per turn; stash does not count toward the goal; losing the node keeps the money', async t => {
  const { e, S, P } = await game(t);
  S.owner = { w_swiss: 0, citi: 0, oil: 0 }; P[0].money = 50;
  await run(e, 0, { act: 'swissdeposit', n: 30 });
  assert.equal(P[0].money, 20 + 2); assert.equal(S.vault[0], 30);
  /* raids cannot touch it */
  act(S, 0); P[0].money = 20; e.f.raid(0);
  assert.equal(S.vault[0], 30, 'the raid fine only takes from cash');
  /* a bad amount is refused */
  act(S, 0); S.owner.w_swiss = 0; P[0].money = 5;
  await run(e, 0, { act: 'swissdeposit', n: 50 });
  assert.equal(S.vault[0], 30);
  /* the stash does not count toward winning: cash is below the goal, vault is above it */
  act(S, 0); P[0].money = 10; S.goal = 40;
  S.owner = { w_swiss: 0, citi: 0, oil: 0, us: 0, press: 0, coal: 0, back: 0, asic: 0 };
  assert.deepEqual(e.ctx.missingTypes(0), [], 'the full set is held');
  assert.equal(await e.f.winCheck(), false, 'vault money is not goal money');
  /* withdraw: free, once per turn, anywhere (not even on the node) */
  P[0].pos = 'quik';
  await run(e, 0, { act: 'swisswithdraw', n: 10 });
  assert.equal(P[0].money, 20); assert.equal(S.vault[0], 20);
  assert.equal(S.phase, 'action', 'a free action');
  await run(e, 0, { act: 'swisswithdraw', n: 5 });
  assert.equal(S.vault[0], 20, 'once per turn');
  /* losing the vault node: the money stays, deposits stop, withdrawals continue */
  act(S, 0); delete S.owner.w_swiss; P[0].money = 5;
  await run(e, 0, { act: 'swissdeposit', n: 1 });
  assert.equal(S.vault[0], 20, 'cannot deposit without the vault');
  await run(e, 0, { act: 'swisswithdraw' });
  assert.equal(S.vault[0], 0); assert.equal(P[0].money, 25, 'the whole balance, no node needed');
  /* withdrawing can win the game */
  S.over = false; S.vault[0] = 100; S.goal = 100; P[0].money = 0; act(S, 0);
  S.owner = { citi: 0, us: 0, press: 0, coal: 0, back: 0, asic: 0, oil: 0, sat: 0 };
  await run(e, 0, { act: 'swisswithdraw' });
  assert.ok(S.over, 'the withdrawal crossed the goal');
});

test('AREA 51: steal a rival node for $4 + 3 Intel, once per game; the coin decides rubble; the takeover guards hold', async t => {
  const { e, S, P } = await game(t, { geo: true });
  S.owner = { w_area51: 0, anz: 1, nab: 1, w_antarctica: 1 };
  P[0].money = 30; P[0].intel = 10;
  /* heads: arrives intact */
  await withRandom(0.9, () => run(e, 0, { act: 'abduct', target: 1, id: 'anz' }));
  assert.equal(S.owner.anz, 0, 'it is mine');
  assert.ok(!S.rubble.anz);
  assert.equal(P[0].intel, 7); assert.equal(P[0].money, 30 - 4 + 2);
  assert.ok(S.wGame.area51);
  /* once per game */
  act(S, 0); P[0].money = 30;
  await withRandom(0.9, () => run(e, 0, { act: 'abduct', target: 1, id: 'nab' }));
  assert.equal(S.owner.nab, 1, 'once per game');
  /* tails: rubble, nobody owns it */
  S.wGame = {}; act(S, 0); P[0].intel = 10; P[0].money = 30; S.bugs.nab = 2;
  await withRandom(0.1, () => run(e, 0, { act: 'abduct', target: 1, id: 'nab' }));
  assert.equal(S.owner.nab, undefined); assert.ok(S.rubble.nab, 'it arrives as rubble');
  assert.equal(S.bugs.nab, undefined);
  /* guards */
  const blocked = id => e.ctx.abductBlocked(0, id);
  S.wGame = {}; S.rubble = {}; S.owner = { w_area51: 0, anz: 1, nab: 1, w_antarctica: 1 };
  assert.match(blocked('w_antarctica'), /UNTOUCHABLE/, 'Antarctica');
  S.owner.made = 1; assert.match(blocked('made'), /MADE/, 'MADE');
  S.owner.commbank = 1; assert.match(blocked('anz'), /COMMONWEALTH BANK/, 'an unused CBA refusal protects its owner');
  S.wGame.cba = 1; assert.equal(blocked('anz'), '', 'once the refusal is spent the protection ends');
  S.owner.w_svalbard = 1; assert.match(blocked('anz'), /SEED VAULT/, 'Svalbard');
  delete S.owner.w_svalbard;
  S.owner.geo_pillars = 1; assert.match(blocked('anz'), /ESG/, 'the Pillars shield'); assert.equal(blocked('geo_pillars'), '');
  delete S.owner.geo_pillars;
  assert.match(blocked('citi'), /rival owns/, 'unowned nodes are not targets');
  assert.match(blocked('w_area51'), /rival owns/, 'your own node is not a target');
  /* the rules refuse when you cannot pay */
  act(S, 0); S.wGame = {}; P[0].intel = 2;
  await withRandom(0.9, () => run(e, 0, { act: 'abduct', target: 1, id: 'anz' }));
  assert.equal(S.owner.anz, 1);
});

test('THE WALL STREET BELL: $2, the next event resolves now, a rival file opens or escalates; once per turn', async t => {
  const { e, S, P } = await game(t);
  S.owner = { w_bell: 0, citi: 2, nab: 2, commbank: 2 };
  S.deck = ['quiet', 'quiet', 'tip']; /* the top is 'tip': everyone +1 Intel, rung right now */
  P[0].money = 10; const i0 = P[0].intel, i2 = P[2].intel;
  await run(e, 0, { act: 'ringbell', target: 2 });
  assert.equal(P[0].money, 10 - 2 + 2 + 2, 'cost $2 (+ the quiet quarter that ended the turn, + the Bell’s own quiet-quarter windfall)');
  assert.equal(P[2].intel, i2 + 1, 'the tip event resolved immediately, for everyone');
  assert.ok(logged(S, 'RINGS THE BELL'));
  const f = e.f.findFile(2, 'bank');
  assert.ok(f && f.s === 1 && f.breach, 'an instant investigation opened on the rival’s heaviest book');
  assert.ok(P[0].intel === i0 + 1, 'the ringer got the event too');
  /* a second ring the same turn is refused */
  act(S, 0); S.nTurn.bell = 1; P[0].money = 10;
  await run(e, 0, { act: 'ringbell', target: 2 });
  assert.equal(P[0].money, 10);
  /* an existing file escalates by +1 */
  S.nTurn = {}; S.deck = ['quiet', 'quiet', 'quiet'];
  const before = e.f.findFile(2, 'bank').s;
  act(S, 0); P[0].money = 10;
  await run(e, 0, { act: 'ringbell', target: 2 });
  assert.equal(e.f.findFile(2, 'bank').s, before + 1, 'escalated');
  /* a rival is required */
  act(S, 0); const cash = P[0].money;
  await run(e, 0, { act: 'ringbell', target: 0 });
  assert.equal(P[0].money, cash, 'no self-targeting');
  /* the node keeps its event windfalls */
  assert.deepEqual(Object.keys(e.acc.NMAP.w_bell.fx.e).sort(), ['bigscreen', 'bondrevolt', 'quiet']);
});

test('THE TURKISH LIRA: once per game every rival loses 20% of their cash above $30', async t => {
  const { e, S, P } = await game(t, { players: 4 });
  S.owner = { w_lira: 0 };
  P[0].money = 200; P[2].money = 130; P[3].money = 20;
  await run(e, 0, { act: 'lira' });
  assert.equal(P[2].money, 130 - 20 + 2, '20% of the $100 above the floor');
  assert.equal(P[3].money, 20 + 2, 'nothing above $30, nothing lost');
  assert.equal(P[0].money, 200 + 2, 'the owner is untouched');
  act(S, 0); P[2].money = 130;
  await run(e, 0, { act: 'lira' });
  assert.equal(P[2].money, 130, 'once per game');
});

test('THE BAHT 1997: a raid gives +1 Cortisol to every rival of the owner with a node in the raided pawn’s region', async t => {
  const { e, S, P } = await game(t, { players: 4 });
  S.owner = { w_baht: 0, citi: 1, hedge: 1, oil: 2, us: 2, japan: 3, tenyear: 3 };
  P[1].pos = 'citi'; P[0].cortisol = 0;
  e.f.raid(1);
  assert.equal(P[2].cortisol, 1, 'a North American holder takes +1');
  assert.equal(P[3].cortisol, 0, 'a holder elsewhere does not');
  assert.equal(P[0].cortisol, 0, 'the Baht’s owner is spared');
  assert.ok(logged(S, 'CONTAGION'));
  /* without the Baht nothing spreads */
  delete S.owner.w_baht; P[2].cortisol = 0; P[1].pos = 'citi';
  e.f.raid(1);
  assert.equal(P[2].cortisol, 0);
  /* the Baht's owner raided: the rest of the table still catches it */
  S.owner.w_baht = 0; S.owner.nab = 0; S.owner.fox = 1; S.owner.leak = 1; P[0].pos = 'oil'; P[2].cortisol = 0; P[1].cortisol = 0;
  e.f.raid(0);
  assert.equal(P[2].cortisol, 1);
  assert.equal(P[1].cortisol, 1, 'a rival holding North American nodes');
});

test('SRI LANKA: DEFAULT wipes the IMF loan and the carry trade, and this turn’s tolls are free; once per game', async t => {
  const { e, S, P } = await game(t);
  S.owner = { w_srilanka: 0, citi: 1 };
  S.imf = { 0: { by: 1, left: 2 }, 2: { by: 1, left: 1 } }; S.carry = { 0: 1, 1: 1 };
  P[0].money = 10;
  await run(e, 0, { act: 'srilankadefault' });
  assert.equal(S.imf[0], undefined, 'my IMF loan is gone'); assert.ok(S.imf[2], 'a rival’s loan is untouched');
  assert.equal(S.carry[0], undefined); assert.ok(S.carry[1]);
  assert.equal(S.phase, 'action', 'a free action');
  assert.equal(S.tollFree, 0);
  /* tolls are free this turn */
  S.phase = 'move'; S.steps = 2; P[0].pos = e.acc.ADJ.citi[0];
  await run(e, 0, { act: 'move', id: 'citi' });
  assert.equal(P[0].money, 10, 'no toll');
  /* once per game */
  S.imf[0] = { by: 1, left: 2 }; act(S, 0, 'move');
  await run(e, 0, { act: 'srilankadefault' });
  assert.ok(S.imf[0], 'once per game');
  /* the waiver does not outlive the turn */
  S.cur = 0; await e.f.startTurn(); await settle();
  assert.equal(S.tollFree, null);
});

test('THE PYRAMIDS: a rival who seizes next to your nodes pays $1, then $2, $4… capped by their cash; the boulder resets it', async t => {
  const { e, S, P } = await game(t);
  S.owner = { w_pyramids: 0 };
  const adj = e.acc.ADJ.w_pyramids.filter(id => !S.owner[id]);
  assert.ok(adj.length >= 3, 'the Pyramids have neighbours');
  const seize = async (seat, nid) => { act(S, seat); S.owner[nid] = undefined; delete S.owner[nid]; P[seat].pos = nid; await run(e, seat, { act: 'seize' }); };
  P[1].money = 100; P[0].money = 0;
  const c1 = e.acc.NMAP[adj[0]].cost, c2 = e.acc.NMAP[adj[1]].cost, c3 = e.acc.NMAP[adj[2]].cost;
  await seize(1, adj[0]);
  assert.equal(P[0].money, 1 + 2, 'the first payout is $1 (+ the quiet quarter)');
  assert.equal(S.pyramid, 2);
  P[0].money = 0; const b1 = P[1].money;
  await seize(1, adj[1]);
  assert.equal(b1 - P[1].money, c2 + 2 - 2, 'the buyer paid list price + the $2 payout (net of the quiet quarter)');
  assert.equal(P[0].money, 2 + 2); assert.equal(S.pyramid, 4);
  /* capped by what the rival can pay */
  P[0].money = 0; P[1].money = c3 + 1;
  await seize(1, adj[2]);
  assert.equal(P[0].money, 1 + 2, 'only $1 left to pay');
  assert.equal(S.pyramid, 8, 'it still doubles');
  /* the node and the strip show it */
  e.acc.Net.myIdx = 0;
  assert.match(e.ctx.worldStrip(), /PYRAMID payout: <b>\$8/);
  assert.match(e.ctx.nodeTip(e.acc.NMAP.w_pyramids), /PYRAMID payout: \$8/);
  assert.match(e.ctx.nodeSVG(e.acc.NMAP.w_pyramids, ''), /🔺 \$8/);
  /* your own seizures, and seizures far from your nodes, are free */
  S.pyramid = 4; P[0].money = 0; P[1].money = 100;
  const far = e.acc.NODES.find(n => n.id !== 'w_pyramids' && !S.owner[n.id] && !(e.acc.ADJ[n.id] || []).some(q => S.owner[q] === 0));
  await seize(1, far.id);
  assert.equal(P[0].money, 2, 'not adjacent to anything of the Pyramids owner: only the quiet quarter'); assert.equal(S.pyramid, 4);
  /* THE BOULDER ROLLS BACK DOWN resets it */
  S.deck = ['quiet', 'sisyroll']; act(S, 2); S.pyramid = 16;
  await e.f.endOfTurn(); await settle();
  assert.equal(S.pyramid, 1, 'the payout is back to $1');
  /* the old +$1 per three nodes is gone */
  assert.ok(!e.acc.NMAP.w_pyramids.fx);
});

test('GREENLAND: with Trump, force-buy Greenland at list price once per game; the owner cannot refuse; the Trump synergy stays', async t => {
  const { e, S, P } = await game(t);
  const g = e.acc.NMAP.w_greenland;
  S.owner = { trump: 0, w_greenland: 2 }; S.bugs = { w_greenland: 0 };
  P[0].money = 20; P[2].money = 10;
  await run(e, 0, { act: 'greenbuy' });
  assert.equal(S.owner.w_greenland, 0, 'Greenland is mine');
  assert.equal(P[0].money, 20 - g.cost + 2); assert.equal(P[2].money, 10 + g.cost + 2, 'the money goes to the old owner');
  assert.equal(S.bugs.w_greenland, undefined);
  assert.ok(S.wGame.greenland);
  /* once per game */
  S.owner.w_greenland = 2; act(S, 0); P[0].money = 20;
  await run(e, 0, { act: 'greenbuy' });
  assert.equal(S.owner.w_greenland, 2);
  /* no Trump, no offer */
  S.wGame = {}; delete S.owner.trump; act(S, 0);
  await run(e, 0, { act: 'greenbuy' });
  assert.equal(S.owner.w_greenland, 2);
  /* the synergy */
  S.owner = { trump: 0, w_greenland: 0 }; P[0].money = 0; e.f.income(0);
  const both = P[0].money;
  S.owner = { w_greenland: 0 }; P[0].money = 0; e.f.income(0);
  assert.equal(both - P[0].money, 1 + 3, 'Trump’s own $1 and the +$3 synergy');
});

/* ───────────── text and UI ───────────── */
test('the sp text of every reworked node names its ability, and the rules help lists them', async t => {
  const { e } = await game(t);
  const sp = id => e.acc.NMAP[id].sp;
  const want = { nab: /FEE FOR NO SERVICE/, westpac: /23 MILLION BREACHES/, commbank: /CAN’T BE BEAT/, anz: /TIP-OFF/, quik: /THE SERVO/, golf: /BACK NINE/, chalmers: /TREASURY BRIEF/,
    w_baikonur: /ESCAPE ON THE ROCKET/, w_zim: /PRINT MONEY/, w_swiss: /NUMBERED ACCOUNT/, w_area51: /ALIEN ABDUCTION/, w_bell: /RING THE BELL/, w_lira: /ERDOĞANOMICS/,
    w_baht: /CONTAGION/, w_srilanka: /DEFAULT/, w_pyramids: /PYRAMID SCHEME/, w_greenland: /MAKE AN OFFER/ };
  for (const [id, re] of Object.entries(want)) assert.match(sp(id), re, id);
  const src = (await import('node:fs')).readFileSync(new URL('../static/js/ui.js', import.meta.url), 'utf8');
  assert.match(src, /Node reworks/);
  for (const w of ['FEE FOR NO SERVICE', '23 MILLION BREACHES', 'CAN’T BE BEAT', 'THE SERVO', 'THE BACK NINE', 'TREASURY BRIEF', 'ESCAPE ON THE ROCKET', 'PRINT MONEY', 'NUMBERED ACCOUNT', 'ALIEN ABDUCTION', 'RING THE BELL', 'CONTAGION', 'DEFAULT']) assert.ok(src.includes(w), w + ' is in the rules help');
});

test('the side panel offers each rework button to its owner, enabled exactly when the engine allows it', async t => {
  const { e, S, P } = await game(t, { geo: true });
  e.acc.Net.myIdx = 0;
  S.owner = { golf: 0, westpac: 0, citi: 1, w_zim: 0, w_swiss: 0, w_area51: 0, w_bell: 0, w_lira: 0, w_srilanka: 0, trump: 0, w_greenland: 1, anz: 1 };
  P[0].money = 30; P[0].intel = 10; S.vault = { 0: 12 };
  act(S, 0); e.ctx.renderSide();
  const html = String(e.elems.get('side').innerHTML);
  for (const a of ['launder', 'golfmode', 'printmoney', 'swissdeposit', 'swisswithdraw', 'abduct', 'ringbell', 'lira', 'srilankadefault', 'greenbuy']) {
    const m = html.match(new RegExp('<button class="act"[^>]*data-act="' + a + '"[^>]*>'));
    assert.ok(m, a + ' is drawn');
    assert.ok(!/\sdisabled/.test(m[0]), a + ' is enabled: ' + m[0]);
  }
  /* a button is disabled when the engine would refuse */
  S.wGame = { zim: 1 }; e.ctx.renderSide();
  assert.match(String(e.elems.get('side').innerHTML).match(/<button class="act"[^>]*data-act="printmoney"[^>]*>/)[0], /disabled/);
});
