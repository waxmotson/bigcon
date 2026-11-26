/*
 * MARKET EVENTS, the second batch: 12 classic cards (BANK RUN, THE ROYAL COMMISSION, ROBODEBT, GAMESTOP SQUEEZE, FTX COLLAPSES,
 * CROWDSTRIKE BLUE SCREEN, TOILET PAPER PANIC, COVID LOCKDOWN, EOFY SALE, SWIFTONOMICS, IRON ORE CRASH, RATE CUT) and 7 Global
 * Edition cards (HOUTHIS IN THE RED SEA, SANCTIONS, CHINA BANS AUSTRALIAN COAL, THE PANAMA PAPERS, BRICS SUMMIT, EL NINO, A TARIFF WAR).
 * Every card runs through the real engine; round windows and switched-off nodes are checked at their exact edges.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame } from './helpers/harness.mjs';
import * as W from '../static/js/world.js';

const CLASSIC_IDS = ['bankrun', 'royalcomm', 'robodebt', 'gamestop', 'ftx', 'crowdstrike', 'toiletpaper', 'covid', 'eofy', 'swiftonomics', 'ironcrash', 'ratecut'];
const WORLD_IDS = ['houthis', 'sanctions', 'chinacoal', 'panamapapers', 'brics', 'elnino', 'tariffwar'];
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

async function game(t, { players = 3, world = false } = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = world;
  const S = await makeGame(e, players, {});
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = {}; S.acccFiles = []; S.blockades = {};
  S.turn = 3; S.cur = 0; S.phase = 'action'; S.mode = null;
  S.players.forEach(p => { p.money = 50; p.intel = 2; p.cortisol = 0; });
  return { e, S: e.acc.S };
}
const run = (e, id) => e.acc.CARDBYID[id].run();
const money = (S, i) => S.players[i].money;
/* what income(i) pays right now (salary included), leaving the player's cash as it was */
const incomeOf = (e, S, i) => { const b = money(S, i), m = S.mood; S.mood = 'CALM'; e.f.income(i); const d = money(S, i) - b; S.players[i].money = b; S.mood = m; return d; };
/* jump the clock to a seat of a turn (tick = turn * players + seat) */
const at = (S, turn, cur) => { S.turn = turn; S.cur = cur; };
async function act(e, pi, m) {
  let done = false;
  const r = e.f.applyIntent(pi, m).finally(() => { done = true; });
  for (let i = 0; i < 12 && !done; i++) { await settle(); e.clock.advance(50); }
  await r; await settle();
}

test('the classic deck holds the 12 new cards and the Global Edition deck the 7 more', async t => {
  const classic = await game(t, { world: false });
  const ids = classic.e.acc.CARDS.map(c => c.id);
  CLASSIC_IDS.forEach(id => assert.ok(ids.includes(id), id + ' is in the classic deck'));
  WORLD_IDS.forEach(id => assert.ok(!ids.includes(id), id + ' is not in the classic deck'));
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.equal(ids.length, 36);
  const w = await game(t, { world: true });
  const wids = w.e.ctx.WORLD_CARDS.map(c => c.id);
  WORLD_IDS.forEach(id => assert.ok(wids.includes(id), id + ' is a world card'));
  assert.equal(wids.length, 8, 'coral plus the 7');
  for (const id of CLASSIC_IDS.concat(WORLD_IDS)) {
    const c = w.e.acc.CARDBYID[id];
    assert.ok(c && c.icon && c.title && c.text.length > 40 && typeof c.run === 'function', id + ' is a complete card');
  }
  /* a fresh deal: world games deal all 44, classic games 36 */
  const fresh = await loadEngine(); t.after(() => fresh.dispose());
  fresh.acc.Net.boardLayout = 'random'; fresh.acc.Net.dlcWorld = true;
  const S2 = await makeGame(fresh, 2, {});
  assert.equal(S2.deck.length + S2.discard.length, 44);
  for (const id of CLASSIC_IDS.concat(WORLD_IDS)) assert.ok(S2.deck.includes(id), id + ' is dealt');
  const f2 = await loadEngine(); t.after(() => f2.dispose());
  f2.acc.Net.boardLayout = 'random'; f2.acc.Net.dlcWorld = false;
  const S3 = await makeGame(f2, 2, {});
  assert.equal(S3.deck.length, 36);
  WORLD_IDS.forEach(id => assert.ok(!S3.deck.includes(id)));
});

test('BANK RUN: 25% of the cash above $40, unless you own a BANK or a REGULATOR', async t => {
  const { e, S } = await game(t);
  S.owner = { citi: 0, asic: 1 };
  S.players[0].money = 200; S.players[1].money = 200; S.players[2].money = 100;
  await run(e, 'bankrun');
  assert.equal(money(S, 0), 200, 'a bank owner is safe');
  assert.equal(money(S, 1), 200, 'a regulator owner is safe');
  assert.equal(money(S, 2), 100 - Math.floor(60 * 0.25), 'the rest lose 25% of the cash above $40');
  S.players[2].money = 30; await run(e, 'bankrun');
  assert.equal(money(S, 2), 30, 'nothing above $40 to lose');
});

test('BANK RUN: the IMF collects $3 in a Global Edition game', async t => {
  const { e, S } = await game(t, { world: true });
  S.owner = { w_imf: 1 };
  const b = money(S, 1);
  await run(e, 'bankrun');
  assert.equal(money(S, 1), b + 3);
});

test('THE ROYAL COMMISSION: every open file +2 scrutiny, every BANK owner +1 Cortisol', async t => {
  const { e, S } = await game(t);
  S.owner = { citi: 1, commbank: 1, nab: 1, hedge: 1, asic: 0 };
  e.ctx.acccReconcile();
  const files = e.ctx.acccFileList();
  assert.ok(files.length >= 1, 'a bank file is open');
  const before = files.map(f => f.s);
  await run(e, 'royalcomm');
  files.forEach((f, k) => assert.equal(f.s, before[k] + 2));
  assert.equal(S.players[1].cortisol, 1, 'the bank owner is called to give evidence');
  assert.equal(S.players[0].cortisol, 0, 'a regulator alone is not a bank');
  assert.equal(S.players[2].cortisol, 0);
});

test('ROBODEBT: everyone pays 10% of their cash to the bank, rounded', async t => {
  const { e, S } = await game(t);
  S.players[0].money = 55; S.players[1].money = 14; S.players[2].money = 4;
  const total = S.players.reduce((a, p) => a + p.money, 0);
  await run(e, 'robodebt');
  assert.deepEqual(S.players.map(p => p.money), [49, 13, 4]);
  assert.equal(S.players.reduce((a, p) => a + p.money, 0), total - 6 - 1, 'it goes to the bank, not to a player');
});

test('GAMESTOP SQUEEZE: the poorest takes 20% of the richest; the Hedge Fund pays an extra $3', async t => {
  const { e, S } = await game(t);
  S.players[0].money = 10; S.players[1].money = 100; S.players[2].money = 40;
  await run(e, 'gamestop');
  assert.deepEqual(S.players.map(p => p.money), [30, 80, 40], 'no Hedge Fund owner: just the squeeze');
  S.owner = { hedge: 2 };
  S.players[0].money = 10; S.players[1].money = 100; S.players[2].money = 40;
  await run(e, 'gamestop');
  assert.deepEqual(S.players.map(p => p.money), [10 + 20 + 3, 80, 37], 'the short is squeezed for $3 more');
  S.owner = { hedge: 0 };
  S.players[0].money = 10; S.players[1].money = 100; S.players[2].money = 40;
  await run(e, 'gamestop');
  assert.deepEqual(S.players.map(p => p.money), [30, 80, 40], 'the poorest owning the Hedge Fund pays itself nothing');
});

test('FTX COLLAPSES: 6+ Intel loses half', async t => {
  const { e, S } = await game(t);
  S.players[0].intel = 6; S.players[1].intel = 5; S.players[2].intel = 9;
  await run(e, 'ftx');
  assert.deepEqual(S.players.map(p => p.intel), [3, 5, 5]);
});

test('CROWDSTRIKE BLUE SCREEN: no flights, no bugs, no peeks for exactly one round', async t => {
  const { e, S } = await game(t, { world: true });
  S.owner = { qantas: 0, w_cruise: 0, w_baikonur: 0, term: 0 };
  await run(e, 'crowdstrike');
  /* the next three turns (seats 1, 2 and 0 of turn 4) are covered; the one after is not */
  at(S, 3, 1); assert.ok(e.ctx.windowOn('crowdstrike'));
  at(S, 4, 0); assert.ok(e.ctx.windowOn('crowdstrike'), 'every seat gets one covered turn');
  at(S, 4, 1); assert.ok(!e.ctx.windowOn('crowdstrike'), 'and the round is over');
  at(S, 4, 0);
  S.cur = 0; S.phase = 'move'; S.steps = 3; S.mode = null; S.players[0].money = 40; S.players[0].intel = 3;
  await act(e, 0, { act: 'flymode' });
  assert.equal(S.mode, null, 'the Qantas jet stays at the gate');
  assert.match(e.ctx.worldBlocked(0, 'cruise'), /CROWDSTRIKE/);
  assert.match(e.ctx.worldBlocked(0, 'launch'), /CROWDSTRIKE/);
  S.phase = 'action';
  await act(e, 0, { act: 'bugmode' });
  assert.equal(S.mode, null, 'no bug actions');
  /* the Terminal peek is skipped */
  S.players[0].pos = 'term'; S.deck = ['quiet', 'tip']; S.phase = 'move';
  await e.ctx.maybePeek();
  assert.ok(S.log.some(l => l.includes('no peek')), 'the Terminal shows a blue screen');
  /* once the round is over flights come back */
  at(S, 4, 1); S.phase = 'move';
  assert.equal(e.ctx.cardGate('flymode'), '');
});

test('TOILET PAPER PANIC: everyone +1 Cortisol, the Quikstop owner collects $10 from each rival', async t => {
  const { e, S } = await game(t);
  S.owner = { quik: 0, citi: 0, nab: 1, asic: 2, commbank: 2 }; /* nobody is down to one node: Cortisol is allowed */
  S.players[0].money = 20; S.players[1].money = 50; S.players[2].money = 6;
  await run(e, 'toiletpaper');
  assert.deepEqual(S.players.map(p => p.cortisol), [1, 0, 1], 'a one-node player is immune to Cortisol');
  assert.deepEqual(S.players.map(p => p.money), [36, 40, 0], 'each rival pays $10, or what they have');
  S.owner = {}; S.players.forEach(p => { p.money = 30; });
  await run(e, 'toiletpaper');
  assert.deepEqual(S.players.map(p => p.money), [30, 30, 30], 'an unowned Quikstop takes nothing');
});

test('COVID LOCKDOWN: media pays $2 now; next round everyone moves at most 1 step and cannot fly', async t => {
  const { e, S } = await game(t);
  S.owner = { fox: 1, qantas: 0 };
  const b = money(S, 1);
  await run(e, 'covid');
  assert.equal(money(S, 1), b + 2, 'MEDIA pays its owner');
  assert.ok(e.ctx.windowOn('lockdown'));
  assert.match(e.ctx.cardGate('flymode'), /LOCKDOWN/);
  assert.match(e.ctx.cardGate('favor'), /LOCKDOWN/, 'no burning favours for extra steps');
  /* the next player's turn starts with a single step */
  S.players.forEach(p => { p.pos = 'quik'; });
  S.owner.coal = 1; /* +1 step for Coal Corp: would be 4 */
  await e.f.startTurn();
  assert.equal(S.cur, 0);
  at(S, 3, 0);
  S.cur = 1; await e.f.startTurn();
  assert.equal(S.steps, 1, 'capped at one step');
  /* after the round, steps are normal again */
  at(S, 5, 1); await e.f.startTurn();
  assert.equal(S.steps, 4);
});

test('EOFY SALE: every seizure is $2 cheaper this round, never below $1', async t => {
  const { e, S } = await game(t);
  const N = e.acc.NMAP;
  const normal = id => e.ctx.seizeListPrice(0, N[id]);
  const [citi, quik, asic] = [normal('citi'), normal('quik'), normal('asic')];
  await run(e, 'eofy');
  assert.equal(e.ctx.seizeListPrice(0, N.citi), citi - 2);
  assert.equal(e.ctx.seizeListPrice(0, N.quik), Math.max(1, quik - 2));
  assert.equal(e.ctx.seizeListPrice(0, N.asic), Math.max(1, asic - 2));
  assert.ok(N.us.cost - 2 >= 0 && e.ctx.seizeListPrice(0, N.us) >= 1, 'floor of $1');
  at(S, 4, 1);
  assert.equal(e.ctx.seizeListPrice(0, N.citi), citi, 'the sale is over');
});

test('SWIFTONOMICS: Qantas, the Marketplace, the Quikstop and the tourism nodes pay $3 each', async t => {
  const { e, S } = await game(t, { world: true });
  S.owner = { qantas: 0, market: 0, quik: 1, w_monaco: 1, w_mbs: 2, citi: 2 };
  const b = S.players.map(p => p.money);
  await run(e, 'swiftonomics');
  assert.deepEqual(S.players.map((p, i) => p.money - b[i]), [6, 6, 3]);
  S.owner = { quik: 0, w_cruise: 0, geo_venice: 0 };
  S.players[0].money = 10;
  await run(e, 'swiftonomics');
  assert.ok(money(S, 0) >= 10 + 6, 'the Cruise Ship and Venice pay when they are on the board (Venice only with the DLC)');
});

test('IRON ORE CRASH: BHP, COAL Corp, Codelco, Potosi and nickel pay nothing for a round', async t => {
  const { e, S } = await game(t, { world: true });
  S.owner = { bhp: 0, coal: 0, w_codelco: 1, citi: 2 };
  const i0 = incomeOf(e, S, 0), i1 = incomeOf(e, S, 1), i2 = incomeOf(e, S, 2);
  await run(e, 'ironcrash');
  at(S, 3, 1);
  const bhp = e.acc.NMAP.bhp.income, coal = e.acc.NMAP.coal.income, vale = e.acc.NMAP.w_codelco.income;
  assert.ok(i0 - incomeOf(e, S, 0) >= bhp + coal, 'the miner loses BHP and COAL Corp holdings');
  assert.ok(i1 - incomeOf(e, S, 1) >= vale, 'Codelco pays nothing');
  assert.equal(incomeOf(e, S, 2), i2, 'a bank is untouched');
  at(S, 4, 0);
  assert.ok(e.ctx.suspended('bhp'));
  at(S, 4, 1);
  assert.ok(!e.ctx.suspended('bhp'), 'back to work after one round');
  assert.equal(incomeOf(e, S, 0), i0);
});

test('RATE CUT: everyone +$2 and -1 Cortisol', async t => {
  const { e, S } = await game(t);
  S.owner = { citi: 0, nab: 0, asic: 1, hedge: 1, commbank: 2, oil: 2 };
  S.players[0].cortisol = 3; S.players[1].cortisol = 0; S.players[2].cortisol = 1;
  await run(e, 'ratecut');
  assert.deepEqual(S.players.map(p => p.money), [52, 52, 52]);
  assert.deepEqual(S.players.map(p => p.cortisol), [2, 0, 0]);
});

test('HOUTHIS IN THE RED SEA: every chokepoint is blockaded until the end of next round; the Tanker Fleet pays $3', async t => {
  const { e, S } = await game(t, { world: true });
  S.owner = { tanker: 2 };
  const b = money(S, 2);
  await run(e, 'houthis');
  for (const id of W.WORLD_CHOKEPOINTS) { assert.ok(e.ctx.blockaded(id), id + ' is blockaded'); assert.equal(S.blockades[id], S.turn + 2); }
  assert.equal(money(S, 2), b + 3);
  at(S, 4, 0); assert.ok(e.ctx.blockaded('w_suez'), 'still shut next round');
  at(S, 5, 0); assert.ok(!e.ctx.blockaded('w_suez'), 'open again');
});

test('SANCTIONS: the Russian, Iranian and North Korean nodes pay nothing for a round; their owners take +1 Cortisol', async t => {
  const { e, S } = await game(t, { world: true });
  S.owner = { w_gazprom: 0, w_kremlin: 0, w_nordstream: 1, citi: 0, nab: 0, asic: 1, hedge: 2, commbank: 2 };
  S.rubble = {};
  const inc0 = incomeOf(e, S, 0);
  await run(e, 'sanctions');
  assert.equal(S.players[0].cortisol, 1, 'once per owner, not once per node');
  assert.equal(S.players[1].cortisol, 1);
  assert.equal(S.players[2].cortisol, 0, 'an owner of none is untouched');
  at(S, 3, 1);
  assert.ok(incomeOf(e, S, 0) < inc0, 'Gazprom and the Kremlin stop paying');
  assert.ok(e.ctx.suspended('w_gazprom') && e.ctx.suspended('w_kremlin') && e.ctx.suspended('w_nordstream'));
  at(S, 4, 1);
  assert.ok(!e.ctx.suspended('w_gazprom'));
  assert.equal(incomeOf(e, S, 0), inc0);
});

test('CHINA BANS AUSTRALIAN COAL: the coal chain pays nothing for two rounds', async t => {
  const { e, S } = await game(t, { world: true });
  S.owner = { coal: 0, train: 0, port: 0, watson: 0, bhp: 0, citi: 1 };
  const inc = incomeOf(e, S, 0);
  await run(e, 'chinacoal');
  at(S, 3, 1);
  const lost = inc - incomeOf(e, S, 0);
  const N = e.acc.NMAP;
  assert.ok(lost >= N.coal.income + N.train.income + N.port.income + N.watson.income + N.bhp.income - 0, 'every link in the chain stops paying (lost $' + lost + ')');
  at(S, 4, 2); assert.ok(e.ctx.suspended('coal'), 'still off in the second round');
  at(S, 5, 0); assert.ok(e.ctx.suspended('coal'));
  at(S, 5, 1); assert.ok(!e.ctx.suspended('coal'), 'back after two rounds');
});

test('THE PANAMA PAPERS: +2 Cortisol per tax haven; APPLE’s owner takes an extra +1', async t => {
  const { e, S } = await game(t, { world: true });
  S.owner = { w_cayman: 0, w_bvi: 0, w_lux: 1, w_apple: 1, citi: 2, nab: 2 };
  await run(e, 'panamapapers');
  assert.equal(S.players[0].cortisol, 4, 'two havens');
  assert.equal(S.players[1].cortisol, 3, 'one haven and Apple');
  assert.equal(S.players[2].cortisol, 0, 'no havens: untouched');
  S.owner = { w_apple: 2, citi: 2, nab: 2 };
  S.players.forEach(p => { p.cortisol = 0; });
  await run(e, 'panamapapers');
  assert.equal(S.players[2].cortisol, 1, 'Apple alone is +1');
});

test('BRICS SUMMIT: BRICS members pay x2 and American nodes half for one round', async t => {
  const { e, S } = await game(t, { world: true });
  const N = e.acc.NMAP;
  const bricsId = W.TRADE_BLOCS.w_brics.members.find(id => N[id] && N[id].income >= 2);
  S.owner = { [bricsId]: 0, oil: 1 };
  const i0 = incomeOf(e, S, 0), i1 = incomeOf(e, S, 1);
  await run(e, 'brics');
  at(S, 3, 1);
  assert.equal(incomeOf(e, S, 0) - i0, N[bricsId].income, 'a BRICS member pays double');
  assert.equal(i1 - incomeOf(e, S, 1), N.oil.income - Math.floor(N.oil.income / 2), 'Texas oil pays half');
  at(S, 4, 1);
  assert.equal(incomeOf(e, S, 0), i0, 'the summit ends after one round');
  assert.equal(incomeOf(e, S, 1), i1);
});

test('EL NINO: the agricultural nodes pay nothing for a round and the Reef bleaches', async t => {
  const { e, S } = await game(t, { world: true });
  S.owner = { w_fonterra: 0, w_tulip: 0, w_gbr: 1, citi: 1 };
  const inc0 = incomeOf(e, S, 0);
  await run(e, 'elnino');
  assert.ok(e.ctx.reefBleached(), 'the reef is white');
  assert.equal(S.bleachUntil, S.turn + 3, 'exactly the CORAL BLEACHING effect');
  assert.equal(S.players[1].cortisol, 1, 'the Reef owner takes +1 Cortisol, as with coral bleaching');
  at(S, 3, 1);
  assert.ok(incomeOf(e, S, 0) < inc0, 'Fonterra and the Tulip Bulb stop paying');
  at(S, 4, 1);
  assert.ok(!e.ctx.suspended('w_fonterra'));
  assert.equal(incomeOf(e, S, 0), inc0);
});

test('A TARIFF WAR: the Tariff Wall surcharge doubles until the end of next round; the WTO owner gets $3', async t => {
  const { e, S } = await game(t, { world: true });
  S.owner = { w_tariffwall: 0, w_wto: 1 };
  S.tariffType = 'BANK';
  assert.equal(e.ctx.tariffFor(2, 'citi'), 2);
  const b = money(S, 1);
  await run(e, 'tariffwar');
  assert.equal(money(S, 1), b + 3);
  assert.equal(e.ctx.tariffFor(2, 'citi'), 4, 'doubled');
  assert.equal(e.ctx.tariffFor(0, 'citi'), 0, 'the wall owner still pays nothing');
  at(S, 4, 0); assert.equal(e.ctx.tariffFor(2, 'citi'), 4, 'still doubled next round');
  at(S, 5, 0); assert.equal(e.ctx.tariffFor(2, 'citi'), 2, 'back to normal');
});

test('the new cards resolve in a full end-of-turn, all of them, without bots or ticks throwing', async t => {
  for (const world of [false, true]) {
    const { e, S } = await game(t, { world });
    const ids = world ? CLASSIC_IDS.concat(WORLD_IDS) : CLASSIC_IDS;
    S.owner = { citi: 0, nab: 1, quik: 2, bhp: 0, oil: 1, hedge: 2 };
    for (const id of ids) {
      S.deck = [id]; S.discard = []; S.phase = 'action'; S.over = false;
      const turn0 = S.turn;
      await e.f.endOfTurn();
      for (let i = 0; i < 20; i++) { await settle(); e.clock.advance(100); }
      assert.ok(S.discard.includes(id) || S.deck.includes(id), id + ' was drawn');
      assert.ok(S.turn >= turn0, id);
      assert.ok(S.players.every(p => Number.isFinite(p.money) && p.money >= 0 && p.cortisol >= 0), id + ': sane numbers');
    }
    assert.equal(e.consoleOut.error.filter(l => String(l).includes('Error')).length, 0, 'no errors logged');
  }
});
