/*
 * GLOBAL EDITION abilities, batch C: the WTO, the IMF, the Tariff Wall, the EU and BRICS trade blocs (multiplier vs WTO scrutiny), Apple, the
 * Cruise Ship (WATER travel), the Great Barrier Reef + Critical Path Analysis + Albo's blockade combo, Coral Bleaching, the 20-foot Box,
 * Woolworths, Overseas Filipino Workers, ANZCERTA (which replaced the NZ sheep) and the Doha Round. All run through the real engine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, pump } from './helpers/harness.mjs';
import * as W from '../static/js/world.js';

const QUIET = 2; /* every turn here ends on A QUIET QUARTER: everyone pockets $2 */
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

async function worldGame(t, { players = 2, geo = false, world = true } = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = world;
  const S = await makeGame(e, players, { geo });
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = {}; S.acccFiles = []; S.blockades = {};
  return { e, S: e.acc.S };
}
const arm = (S, cur = 0, phase = 'action') => { S.cur = cur; S.phase = phase; S.mode = null; S.steps = 3; };
/* run an intent, advancing the virtual clock so guest prompts auto-answer */
async function act(e, pi, m) {
  let done = false;
  const run = e.f.applyIntent(pi, m).finally(() => { done = true; });
  for (let i = 0; i < 12 && !done; i++) { await settle(); e.clock.advance(50); }
  await run; await settle();
}
const give = (S, i, ids) => ids.forEach(id => { S.owner[id] = i; });
const money = (S, i) => S.players[i].money;

/* ---------- the roster ---------- */
test('batch C: every new node exists with the right type, a witty sub, an sp and a place (or a float)', () => {
  const by = Object.fromEntries(W.WORLD_NODES.map(n => [n.id, n]));
  const want = { w_wto: 'REGULATOR', w_imf: 'REGULATOR', w_tariffwall: 'REGULATOR', w_eu: 'REGULATOR', w_brics: 'WILD', w_apple: 'CORPORATE', w_cruise: 'CORPORATE',
    w_gbr: 'WILD', w_cpa: 'CHART', w_box: 'COMMODITY', w_woolies: 'CORPORATE', w_ofw: 'WILD', w_anzcerta: 'WILD', w_doha: 'WILD' };
  for (const [id, type] of Object.entries(want)) {
    const n = by[id];
    assert.ok(n, id + ' exists');
    assert.equal(n.type, type, id + ' type');
    assert.ok(n.sub.length > 10 && n.sp.length > 40 && (!n.image || n.image.startsWith('./static/GlobalEdition/')) && !n.todo, id + ' has copy, not todo, any picture is a GE photo');
    assert.ok(n.income >= 1 && n.income <= 3 && n.cost >= 6 && n.cost <= 9, id + ' income/cost are in family: ' + n.income + '/' + n.cost);
  }
  for (const id of ['w_tariffwall', 'w_brics', 'w_cpa', 'w_box']) assert.ok(W.WORLD_FLOATING.includes(id), id + ' floats (no place)');
  for (const id of ['w_wto', 'w_imf', 'w_eu', 'w_apple', 'w_cruise', 'w_gbr', 'w_woolies', 'w_ofw', 'w_anzcerta', 'w_doha']) assert.ok(!W.WORLD_FLOATING.includes(id), id + ' is a place');
  assert.deepEqual(W.WORLD_NODES.map(n => n.id).filter(id => id.includes('sheep')), [], 'the NZ sheep is gone');
});

test('ANZCERTA replaced the NZ sheep: no w_sheep anywhere, Fonterra and Antarctica point at the treaty', () => {
  assert.ok(!W.WORLD_NODE_IDS.includes('w_sheep'));
  assert.ok(!JSON.stringify(W.WORLD_ROUTES).includes('w_sheep'), 'no route names the sheep');
  assert.ok(W.WORLD_ROUTES.some(([a, b]) => a === 'w_aq_adelie' && b === 'w_anzcerta'), 'Terre Adélie is the Christchurch gateway');
  const fon = W.WORLD_NODES.find(n => n.id === 'w_fonterra');
  assert.deepEqual(fon.fx.w, [['w_anzcerta', 2]]);
  assert.ok(/ANZCERTA/.test(fon.sp) && !/SHEEP/.test(fon.sp));
  for (const id of ['w_fonterra', 'w_rbnz', 'w_anzcerta', 'quik', 'qantas', 'w_gbr', 'w_woolies']) assert.ok(W.AUSNZ.has(id), id + ' is Australian or New Zealand');
  for (const id of ['w_hsbc', 'geo_tuvalu', 'w_fiji', 'w_cpa', 'cash', 'w_nauru']) assert.ok(!W.AUSNZ.has(id), id + ' is not');
});

test('ANZCERTA: +$1 per Australian or NZ node (cap $5), and the tolls between them are waived', async t => {
  const { e, S } = await worldGame(t);
  const N = e.acc.NMAP;
  const own = ids => ids.map(id => N[id]);
  const syn = ids => W.worldSynergy(own(ids), id => ids.includes(id), () => 0);
  assert.equal(syn(['w_anzcerta']), 1, 'the treaty counts itself');
  assert.equal(syn(['w_anzcerta', 'quik', 'qantas']), 3);
  assert.equal(syn(['w_anzcerta', 'quik', 'qantas', 'nab', 'anz', 'westpac', 'commbank', 'bhp']), 5, 'capped at $5');
  assert.equal(syn(['quik', 'qantas']), 0, 'no treaty, no bonus');
  /* the toll: a rival holds Qantas; entering it from Quikstop costs $1, free with ANZCERTA */
  S.owner = { qantas: 1 };
  S.cur = 0; S.phase = 'move'; S.steps = 3; S.players[0].pos = 'quik'; S.players[0].money = 5;
  await e.f.doMove(0, 'qantas');
  assert.equal(money(S, 0), 4, 'the usual $1 toll without the treaty');
  S.owner = { qantas: 1, w_anzcerta: 0 };
  S.cur = 0; S.phase = 'move'; S.steps = 3; S.players[0].pos = 'quik'; S.players[0].money = 5;
  await e.f.doMove(0, 'qantas');
  assert.equal(money(S, 0), 5, 'no toll between Australian nodes for the treaty owner');
  assert.ok(S.log.some(l => l.includes('ANZCERTA') && l.includes('waived')));
  /* a toll to leave the treaty area is still charged */
  S.owner = { w_hormuz: 1, w_anzcerta: 0 };
  S.cur = 0; S.phase = 'move'; S.steps = 3; S.players[0].pos = 'quik'; S.players[0].money = 5;
  await e.f.doMove(0, 'w_hormuz');
  assert.equal(money(S, 0), 3, 'a chokepoint outside the area still charges its $2');
  /* the income line */
  S.owner = { w_anzcerta: 0, quik: 0, qantas: 0 };
  e.f.income(0);
  assert.ok(S.log.some(l => l.includes('World expansion synergies: +$3.')), 'the treaty pays $1 for each of its three Australasian nodes');
});

/* ---------- APPLE, THE 20-FOOT BOX, OVERSEAS FILIPINO WORKERS ---------- */
test('Apple pays $2 per tax haven; the Box $1 per chokepoint; the OFW $1 per region (cap $6) and −1 Cortisol', async t => {
  const { e, S } = await worldGame(t);
  const N = e.acc.NMAP;
  const syn = ids => W.worldSynergy(ids.map(id => N[id]), id => ids.includes(id), () => 0);
  assert.deepEqual(W.TAX_HAVENS.filter(id => !W.WORLD_NODE_IDS.includes(id)), [], 'every haven is a real node');
  for (const id of ['w_cayman', 'w_bvi', 'w_bermuda', 'w_swiss']) assert.ok(W.TAX_HAVENS.includes(id), id + ' is a tax haven');
  assert.equal(syn(['w_apple']), 0);
  assert.equal(syn(['w_apple', 'w_cayman']) - syn(['w_cayman']), 2, 'one haven: +$2 from Apple');
  const withHavens = syn(['w_apple', 'w_cayman', 'w_bvi', 'w_bermuda', 'w_swiss']);
  const without = syn(['w_cayman', 'w_bvi', 'w_bermuda', 'w_swiss']);
  assert.equal(withHavens - without, 8, 'four havens: +$8 from Apple');
  /* the box */
  assert.equal(syn(['w_box']), 0);
  assert.equal(syn(['w_box', 'w_panama', 'w_suez']) - syn(['w_panama', 'w_suez']), 2, '$1 per chokepoint');
  assert.equal(syn(['w_box', 'w_panama', 'w_suez', 'w_hormuz', 'w_malacca']) - syn(['w_panama', 'w_suez', 'w_hormuz', 'w_malacca']), 4);
  /* the OFW: regions */
  const reg = ids => syn(ids) - syn(ids.filter(x => x !== 'w_ofw'));
  const R = id => W.regionOf(N[id]);
  assert.equal(R('w_ofw'), 'SEA');
  assert.equal(reg(['w_ofw']), 1, 'its own region');
  assert.equal(reg(['w_ofw', 'citi', 'w_hormuz']), new Set(['w_ofw', 'citi', 'w_hormuz'].map(R)).size);
  const many = ['w_ofw', 'citi', 'w_hormuz', 'w_panama', 'w_suez', 'w_malacca', 'w_aramco', 'w_milei', 'w_zim', 'w_pboc', 'w_fiji', 'w_antarctica'];
  assert.equal(reg(many), 6, 'capped at +$6 however many regions');
  /* −1 Cortisol at the start of each turn, through the real turn start */
  S.owner = { w_ofw: 0, citi: 0 }; S.players[0].cortisol = 3; S.cur = 0;
  await e.f.startTurn(); await settle();
  assert.equal(S.players[0].cortisol, 2);
});

/* ---------- WOOLWORTHS ---------- */
test('Woolworths: seizures cost $1 less and every rival takes +1 Cortisol when you seize anything', async t => {
  const { e, S } = await worldGame(t, { players: 3 });
  const N = e.acc.NMAP, base = e.f.seizeListPrice(0, N.nab);
  S.owner = { w_woolies: 0, citi: 1, commbank: 1, anz: 2, westpac: 2 };
  assert.equal(e.f.seizeListPrice(0, N.nab), Math.max(1, base - 1), 'automation: $1 off');
  assert.equal(e.f.seizeListPrice(1, N.nab), base, 'rivals pay list price');
  arm(S, 0); S.players[0].pos = 'nab'; S.players[0].money = 40; S.players.forEach(p => { p.cortisol = 0; });
  await e.f.doSeize(0); await settle();
  assert.equal(S.owner.nab, 0, 'seized');
  assert.equal(money(S, 0), 40 - Math.max(1, base - 1) + QUIET);
  assert.equal(S.players[1].cortisol, 1); assert.equal(S.players[2].cortisol, 1);
  assert.ok(S.log.some(l => l.includes('UNEXPECTED ITEM')));
  /* no Woolworths: a quiet seizure */
  S.owner = { citi: 1, commbank: 1, anz: 2, westpac: 2 };
  arm(S, 0); S.players[0].pos = 'market'; S.players.forEach(p => { p.cortisol = 0; }); S.players[0].money = 40;
  await e.f.doSeize(0); await settle();
  assert.equal(S.players[1].cortisol, 0); assert.equal(S.players[2].cortisol, 0);
});

/* ---------- THE DOHA ROUND ---------- */
test('Doha: once per game, $2 per commodity at each of your next 3 turn starts, then it stalls', async t => {
  const { e, S } = await worldGame(t);
  const N = e.acc.NMAP;
  const comm = Object.values(N).filter(n => n.type === 'COMMODITY').slice(0, 3).map(n => n.id);
  S.owner = { w_doha: 0 }; give(S, 0, comm);
  arm(S, 0); S.players[0].money = 10;
  await act(e, 0, { act: 'doha' });
  assert.deepEqual(S.doha, { by: 0, left: 3 }, 'the round is open');
  assert.equal(S.wGame.doha, 1);
  /* three turn starts pay; the fourth does not */
  const paid = [];
  for (let k = 0; k < 4; k++) {
    S.cur = 0; S.players[0].cortisol = 0;
    const log0 = S.log.length;
    await e.f.startTurn(); await settle();
    paid.push(S.log.slice(log0).some(l => l.includes('Doha round delivers')));
  }
  assert.deepEqual(paid, [true, true, true, false]);
  assert.ok(S.log.some(l => l.includes('STALLS')), 'the talks stall');
  assert.equal(S.doha.left, 0);
  /* once per game */
  arm(S, 0); S.players[0].money = 10;
  const w = e.ctx.worldBlocked(0, 'doha');
  assert.match(w, /already been launched/);
  /* the starter must still hold the node to be paid */
  S.doha = { by: 0, left: 2 }; S.owner.w_doha = 1; S.cur = 0;
  const log1 = S.log.length;
  await e.f.startTurn(); await settle();
  assert.ok(!S.log.slice(log1).some(l => l.includes('Doha round delivers')) && S.log.slice(log1).some(l => l.includes('without its host')));
});

/* ---------- THE IMF ---------- */
test('IMF: lend $6 of your own money, repaid $8 at the start of the borrower’s next-but-one turn', async t => {
  const { e, S } = await worldGame(t, { players: 3 });
  S.owner = { w_imf: 0 };
  arm(S, 1); S.players[1].money = 10;
  await act(e, 1, { act: 'worldmode', kind: 'bailout' });
  assert.equal(S.mode, null, 'only the IMF owner can open it');
  arm(S, 0); S.players[0].money = 10; S.players[1].money = 0; S.players[2].money = 0;
  await act(e, 0, { act: 'worldmode', kind: 'bailout' });
  assert.equal(S.mode, 'bailout');
  await act(e, 0, { act: 'bailout', target: 0 });
  assert.equal(S.imf, undefined, 'never your own');
  await act(e, 0, { act: 'bailout', target: 1 });
  assert.equal(money(S, 0), 10 - 6 + QUIET, 'the IMF lends out of its own pocket');
  assert.equal(S.cur, 1, 'the action ended the lender’s turn: the borrower’s NEXT turn has begun');
  assert.equal(money(S, 1), 6 + QUIET + 3, 'the $6 arrived (plus the quiet quarter and the salary)');
  assert.deepEqual(S.imf[1], { by: 0, left: 1 }, 'not due yet: one more turn of the borrower’s');
  /* once per turn, and one loan per rival */
  S.wTurn = { bailout: 1 };
  assert.match(e.ctx.worldBlocked(0, 'bailout'), /already made a bailout/);
  arm(S, 0); S.players[0].money = 20; S.deck = ['quiet', 'quiet']; S.wTurn = {};
  await act(e, 0, { act: 'worldmode', kind: 'bailout' });
  await act(e, 0, { act: 'bailout', target: 1 });
  assert.deepEqual(S.imf[1], { by: 0, left: 1 }, 'a rival carries only one IMF loan at a time');
  assert.equal(S.imf[2], undefined);
  assert.equal(money(S, 0), 20, 'nothing was lent');
  await act(e, 0, { act: 'cancel' });
  const lender0 = money(S, 0);
  /* the borrower’s next-but-one turn start: repaid */
  S.owner.w_imf = 0; S.cur = 1; S.players[1].money = 20; const m0 = money(S, 1);
  await e.f.startTurn(); await settle();
  assert.equal(S.imf[1], undefined, 'settled');
  assert.equal(money(S, 1) - m0, 3 - 8, 'salary, minus the $8 repayment');
  assert.equal(money(S, 0) - lender0, 8, 'the lender collects $8');
  assert.equal(S.players[1].cortisol, 0);
  assert.ok(S.log.some(l => l.includes('repays $8')));
});

test('IMF: a borrower who cannot repay takes +2 Cortisol (austerity) and the loan is written off', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_imf: 0 };
  S.imf = { 1: { by: 0, left: 1 } };
  S.cur = 1; S.players[1].money = 0; S.players[1].cortisol = 0;
  const lender0 = money(S, 0);
  await e.f.startTurn(); await settle();
  assert.equal(S.imf[1], undefined, 'written off');
  assert.equal(S.players[1].cortisol, 2, 'austerity: +2 Cortisol');
  assert.equal(money(S, 0), lender0, 'the lender sees nothing');
  assert.ok(S.log.some(l => l.includes('austerity')));
});

/* ---------- THE TARIFF WALL ---------- */
test('Tariff Wall: a free once-per-turn change; rivals pay +$2 (to the owner) to seize a node of that type', async t => {
  const { e, S } = await worldGame(t, { players: 3 });
  const N = e.acc.NMAP, base = e.f.seizeListPrice(1, N.nab);
  assert.equal(N.nab.type, 'BANK');
  S.owner = { w_tariffwall: 0 };
  /* a non-owner cannot name a type */
  arm(S, 1); await act(e, 1, { act: 'tariff', kind: 'BANK' });
  assert.equal(S.tariffType, undefined);
  /* the owner names one: free, the phase carries on, once per turn */
  arm(S, 0); S.players[0].money = 10;
  await act(e, 0, { act: 'tariff', kind: 'BANK' });
  assert.equal(S.tariffType, 'BANK');
  assert.equal(S.cur, 0); assert.equal(S.phase, 'action', 'free: the action is still yours');
  assert.equal(money(S, 0), 10, 'free');
  await act(e, 0, { act: 'tariff', kind: 'MEDIA' });
  assert.equal(S.tariffType, 'BANK', 'once per turn');
  await act(e, 0, { act: 'tariff', kind: 'NOT A TYPE' });
  assert.equal(S.tariffType, 'BANK');
  assert.equal(e.ctx.tariffFor(1, 'nab'), 2); assert.equal(e.ctx.tariffFor(0, 'nab'), 0, 'not on the owner');
  assert.equal(e.ctx.tariffFor(1, 'bhp'), 0, 'not on another type');
  assert.equal(e.ctx.botView(1).seizePrice(1, 'nab'), base + 2, 'the bots see the surcharge');
  /* a rival seizes a BANK: pays list + $2, the $2 goes to the wall's owner */
  S.deck = ['quiet', 'quiet', 'quiet'];
  arm(S, 1); S.players[1].pos = 'nab'; S.players[1].money = 40; const w0 = money(S, 0);
  await e.f.doSeize(1); await settle();
  assert.equal(S.owner.nab, 1);
  assert.equal(money(S, 1), 40 - base - 2 + QUIET);
  assert.equal(money(S, 0) - w0, 2 + QUIET, 'the wall collects');
  /* the owner pays no surcharge on their own wall, and a non-wall type is untouched */
  arm(S, 0); S.players[0].pos = 'commbank'; S.players[0].money = 40;
  await e.f.doSeize(0); await settle();
  assert.equal(money(S, 0), 40 - e.f.seizeListPrice(0, N.commbank) + QUIET);
  /* the wall turns up on the board header and the node tip */
  const strip = e.ctx.worldStrip();
  assert.ok(strip.includes('TARIFF WALL') && strip.includes('BANK'), 'shown in the side panel');
  assert.ok(e.ctx.worldTip(N.citi).includes('TARIFF WALL'), 'and in tooltips');
  /* a takeover pays the surcharge on top of the doubled price */
  S.deck = ['quiet', 'quiet'];
  arm(S, 2); S.players[2].pos = 'nab'; S.players[2].money = 80;
  const price = e.f.takeoverCost(2, 'nab', e.f.seizeListPrice(2, N.nab)) + 2;
  await e.f.doSeize(2); await settle();
  assert.equal(S.owner.nab, 2);
  assert.equal(money(S, 2), 80 - price + QUIET);
});

/* ---------- TRADE BLOCS ---------- */
test('the bloc member lists are explicit, real, disjoint and exclude the non-members', () => {
  const ids = new Set(W.WORLD_NODE_IDS.concat(Object.keys(W.GEO_ANCHORS)));
  const eu = W.TRADE_BLOCS.w_eu.members, br = W.TRADE_BLOCS.w_brics.members;
  for (const id of eu.concat(br)) assert.ok(ids.has(id), id + ' is a real node');
  assert.equal(new Set(eu.concat(br)).size, eu.length + br.length, 'a node belongs to one bloc');
  for (const id of ['w_boe', 'w_city', 'w_brexit', 'w_norway', 'w_cs', 'w_bis', 'w_swiss', 'w_gazprom', 'w_kremlin', 'w_lira', 'w_hdi', 'w_monaco', 'w_nordstream', 'w_cruise', 'whistle', 'wef', 'ib', 'bond007'])
    assert.ok(!eu.includes(id), id + ' is not an EU member');
  for (const id of ['w_gazprom', 'w_kremlin', 'whistle', 'w_petrobras', 'w_adani', 'w_pboc', 'w_hkma', 'w_hsbc'])
    assert.ok(br.includes(id), id + ' is a BRICS member');
  for (const id of ['w_aramco', 'w_temasek', 'w_kazatom', 'w_zim', 'w_nigprince', 'w_tsmc']) assert.ok(!br.includes(id), id + ' is not');
  assert.equal(W.blocOfMember('w_ecb'), 'w_eu'); assert.equal(W.blocOfMember('w_adani'), 'w_brics'); assert.equal(W.blocOfMember('citi'), null);
  assert.deepEqual([W.BLOC_STEP, W.BLOC_MAX, W.BLOC_FREE], [0.25, 2.5, 3]);
});

test('EU bloc: the multiplier is 1 + 0.25 per member (cap ×2.5), is paid at income time and shown in the log, tooltip and status', async t => {
  const { e, S } = await worldGame(t, { players: 3 });
  const N = e.acc.NMAP;
  const members = ['w_ecb', 'w_tulip', 'w_bunds', 'w_greek', 'w_db', 'w_asml'];
  /* no members: no bonus */
  S.owner = { w_eu: 0 };
  assert.deepEqual(e.ctx.blocStatus(0).map(b => [b.k, b.mult, b.bonus]), [[0, 1, 0]]);
  for (const k of [1, 2, 3, 4, 6]) {
    S.owner = { w_eu: 0 }; give(S, 0, members.slice(0, k));
    const st = e.ctx.blocStatus(0)[0];
    const base = members.slice(0, k).reduce((a, id) => a + N[id].income, 0);
    const mult = Math.min(2.5, 1 + 0.25 * k);
    assert.equal(st.k, k); assert.equal(st.base, base); assert.equal(st.mult, mult);
    assert.equal(st.bonus, Math.round(base * (mult - 1)), k + ' members: bonus');
  }
  /* it really lands in the income, on top of the node incomes */
  const four = members.slice(0, 4);
  const incomeOf = owner => { S.owner = owner; const b = money(S, 0); e.f.income(0); return money(S, 0) - b; };
  const without = incomeOf({ ...Object.fromEntries(four.map(id => [id, 0])) });
  S.log.length = 0;
  const withEu = incomeOf({ w_eu: 0, ...Object.fromEntries(four.map(id => [id, 0])) });
  const bonus = Math.round(four.reduce((a, id) => a + N[id].income, 0) * 0.25 * 4);
  assert.ok(bonus >= 3, 'the bonus is worth having (' + bonus + ')');
  assert.equal(withEu - without, N.w_eu.income + bonus, 'EU node income + the multiplier on the members');
  assert.ok(S.log.some(l => l.includes('SINGLE MARKET') && l.includes('×2.00') && l.includes('+$' + bonus)), 'the income log shows the multiplier');
  /* visible in the tooltip and the side strip */
  S.owner = { w_eu: 0 }; give(S, 0, four);
  const tip = e.ctx.worldTip(N.w_eu);
  assert.ok(tip.includes('YOURS: 4 member nodes') && tip.includes('×2.00') && tip.includes('+$' + bonus), tip);
  assert.ok(e.ctx.worldTip(N.w_ecb).includes('MEMBER of THE EU SINGLE MARKET'), 'members say so');
  assert.ok(e.ctx.worldStrip().includes('×2.00'), 'the side strip shows it');
  /* a rival (or nobody) owning the bloc node: members are plain nodes */
  S.owner = { w_eu: 1 }; give(S, 0, four);
  assert.deepEqual(e.ctx.blocStatus(0), []);
  /* the cap */
  S.owner = { w_eu: 0 }; give(S, 0, W.TRADE_BLOCS.w_eu.members.filter(id => N[id]));
  assert.equal(e.ctx.blocStatus(0)[0].mult, 2.5, 'capped at ×2.5');
});

test('trade-bloc scrutiny: 4 members open a WTO file, each member beyond 3 adds scrutiny per turn, the ruling strips to 3 and fines', async t => {
  const { e, S } = await worldGame(t, { players: 3 });
  const N = e.acc.NMAP;
  const mem = ['w_ecb', 'w_tulip', 'w_bunds', 'w_greek', 'w_db', 'w_asml'];
  /* three members: no file */
  S.owner = { w_eu: 1 }; give(S, 1, mem.slice(0, 3)); e.f.acccReconcile();
  assert.equal(e.f.findFile(1, 'bloc_eu'), null, 'three members is fine');
  /* the bloc node is what makes it a bloc book: members alone are not */
  S.owner = {}; give(S, 1, mem.slice(0, 5)); e.f.acccReconcile();
  assert.equal(e.f.findFile(1, 'bloc_eu'), null, 'no bloc node, no WTO file');
  /* four members and the node: a WTO file opens, +1 a turn */
  S.owner = { w_eu: 1 }; give(S, 1, mem.slice(0, 4)); e.f.acccReconcile();
  let f = e.f.findFile(1, 'bloc_eu');
  assert.ok(f && f.agency === 'WTO' && f.s === 0, 'a WTO file opens');
  assert.ok(S.log.some(l => l.includes('THE WTO OPENS A FILE')), 'logged');
  assert.equal(e.ctx.fileStep(f), 1);
  e.f.acccAdvance(1); assert.equal(f.s, 1, '4 members: +1');
  /* five members: +2 per turn */
  S.owner.w_db = 1; e.f.acccReconcile();
  assert.equal(e.ctx.fileStep(f), 2);
  f.s = 0; e.f.acccAdvance(1); assert.equal(f.s, 2, '5 members: +2');
  /* six members: +3 per turn, i.e. the ruling lands at the very next turn start */
  S.owner.w_asml = 1; e.f.acccReconcile();
  assert.equal(e.ctx.fileStep(f), 3);
  f.s = 0; const due = e.f.acccAdvance(1);
  assert.deepEqual(due, ['bloc_eu'], 'six members rule at once');
  /* the ruling (seat 1 is an auto-answering guest): keeps 3, divests 3 back to the market, fines 30% */
  S.players[1].money = 100; S.players[1].intel = 10;
  const held = () => mem.filter(id => S.owner[id] === 1);
  let done = false; const run = e.f.acccRule(1, 'bloc_eu').then(() => { done = true; });
  for (let i = 0; i < 20 && !done; i++) { await settle(); e.clock.advance(50); }
  await run;
  assert.equal(held().length, 3, 'stripped back to 3 members');
  assert.equal(S.players[1].money, 70, '30% fine on three divested nodes');
  assert.equal(S.players[1].intel, 7);
  assert.equal(e.f.findFile(1, 'bloc_eu'), null, 'the file is closed');
  assert.ok(S.log.some(l => l.includes('TRADE-BLOC RULING')));
  assert.ok(mem.filter(id => S.owner[id] == null).length === 3, 'divested to the market, not gifted');
  /* the multiplier is tempting: compare the ×2.0 at 4 members with what the ruling costs */
  assert.ok(N.w_eu.cost >= 8);
});

test('WTO owner can REFER a rival’s bloc file for $4; the ACCC owner cannot; no WTO, no refer; +$2 on TRUMP TWEETS TARIFFS', async t => {
  const { e, S } = await worldGame(t, { players: 3 });
  const mem = ['w_ecb', 'w_tulip', 'w_bunds', 'w_greek'];
  S.owner = { w_eu: 1, w_wto: 0, accc: 2 }; give(S, 1, mem); e.f.acccReconcile();
  const f = e.f.findFile(1, 'bloc_eu'); assert.ok(f);
  /* the ACCC owner cannot refer it */
  arm(S, 2); S.players[2].money = 20;
  await act(e, 2, { act: 'refermode' });
  assert.equal(S.mode, null, 'the ACCC owner has nothing to refer');
  /* the WTO owner can */
  arm(S, 0); S.players[0].money = 20; S.referred = false;
  await act(e, 0, { act: 'refermode' });
  assert.equal(S.mode, 'refer');
  await act(e, 0, { act: 'refer', target: 1, kind: 'bloc_eu' });
  assert.equal(f.s, 2, '+1 from the referral, +1 when the offender’s next turn starts (no ruling yet at 2)');
  assert.equal(money(S, 0), 20 - 4 + QUIET);
  assert.ok(S.log.some(l => l.includes('refers') && l.includes('WTO')));
  /* the UI knows who may refer: the rival-files helper */
  assert.equal(e.ctx.fileAuthority(f), 'w_wto');
  /* TRUMP TWEETS TARIFFS pays the WTO $2 */
  const pays = W.worldEventPays('tariffs', id => S.owner[id]);
  assert.ok(pays.some(p => p.id === 'w_wto' && p.amt === 2 && p.owner === 0));
});

test('BRICS: the same multiplier on Brazil, Russia, India, China and South Africa nodes, with its own WTO file', async t => {
  const { e, S } = await worldGame(t, { players: 3 });
  const N = e.acc.NMAP;
  const mem = ['w_petrobras', 'w_adani', 'w_pboc', 'w_hkma'];
  S.owner = { w_brics: 0 }; give(S, 0, mem);
  const st = e.ctx.blocStatus(0)[0];
  assert.equal(st.id, 'w_brics'); assert.equal(st.k, 4); assert.equal(st.mult, 2);
  assert.equal(st.bonus, mem.reduce((a, id) => a + N[id].income, 0));
  e.f.acccReconcile();
  const f = e.f.findFile(0, 'bloc_brics');
  assert.ok(f && f.agency === 'WTO');
  assert.equal(e.ctx.fileStep(f), 1, 'four members: one beyond the three allowed');
  /* EU members are not BRICS members */
  S.owner = { w_brics: 0 }; give(S, 0, ['w_ecb', 'w_db', 'w_bunds']);
  assert.equal(e.ctx.blocStatus(0)[0].k, 0);
});

/* ---------- THE BLOCKADE COMBO ---------- */
test('blockade with ONE source uses your action (it ends the turn), once per turn: Albo, the Reef, Critical Path', async t => {
  for (const src of ['albo', 'w_gbr', 'w_cpa']) {
    const { e, S } = await worldGame(t);
    S.owner = { [src]: 0, citi: 1 };
    assert.equal(e.ctx.blockSources(0).length, 1); assert.equal(e.ctx.blockadeFree(0), false);
    /* not available in the move phase */
    arm(S, 0, 'move');
    await act(e, 0, { act: 'blockmode' });
    assert.notEqual(S.mode, 'blockade', src + ': no single-source blockade while moving');
    arm(S, 0, 'action'); S.players[0].money = 10;
    await act(e, 0, { act: 'blockmode' });
    assert.equal(S.mode, 'blockade');
    await act(e, 0, { act: 'blockade', id: 'citi' });
    assert.equal(S.blockades.citi, S.turn + 2, src + ': walled for the round');
    assert.ok(S.cur !== 0 || S.phase !== 'action', src + ': the action is spent and the turn moves on');
    assert.equal(money(S, 0), 10 + QUIET, 'costs no cash');
  }
});

test('blockade COMBO: any two of Albo, the Reef and Critical Path make it FREE — usable in move or action phase, once per turn, turn and movement kept', async t => {
  for (const pair of [['albo', 'w_gbr'], ['albo', 'w_cpa'], ['w_gbr', 'w_cpa'], ['albo', 'w_gbr', 'w_cpa']]) {
    const { e, S } = await worldGame(t);
    S.owner = { citi: 1, nab: 1, oil: 1 }; give(S, 0, pair);
    assert.equal(e.ctx.blockadeFree(0), true, pair + ' is the combo');
    /* the move phase: the wall goes up, the steps stay */
    arm(S, 0, 'move'); S.steps = 3;
    await act(e, 0, { act: 'blockmode' });
    assert.equal(S.mode, 'blockade', pair + ': armed while moving');
    await act(e, 0, { act: 'blockade', id: 'citi' });
    assert.equal(S.blockades.citi, S.turn + 2);
    assert.equal(S.phase, 'move', 'the move phase carries on'); assert.equal(S.cur, 0); assert.equal(S.steps, 3, 'no movement spent');
    assert.equal(S.mode, null); assert.equal(S.blockadeUsed, true);
    /* once per turn in total: no second wall in either phase */
    await act(e, 0, { act: 'blockmode' });
    assert.equal(S.mode, null, 'one blockade per turn');
    arm(S, 0, 'action'); S.blockadeUsed = true;
    await act(e, 0, { act: 'blockmode' });
    assert.equal(S.mode, null, 'still once per turn in the action phase');
    /* a fresh turn, the action phase: free again, and the action is still yours */
    S.blockadeUsed = false; arm(S, 0, 'action'); S.players[0].money = 10;
    await act(e, 0, { act: 'blockmode' });
    await act(e, 0, { act: 'blockade', id: 'nab' });
    assert.equal(S.blockades.nab, S.turn + 2);
    assert.equal(S.cur, 0); assert.equal(S.phase, 'action', 'free: the turn did not end'); assert.equal(money(S, 0), 10, 'no cash, no quiet quarter yet');
    /* …and the action itself is still there to be spent */
    S.players[0].pos = 'oil'; S.players[0].money = 30;
    await e.f.doSeize(0); await settle();
    assert.equal(S.owner.oil, 0, 'the seizure still goes through after the free blockade');
  }
});

test('blockade combo: a bleached Reef is not a source, Albo stays one; the single versions keep to their sp', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { albo: 0, w_gbr: 0 };
  assert.equal(e.ctx.blockadeFree(0), true);
  S.bleachUntil = S.turn + 3;
  assert.equal(e.ctx.reefBleached(), true);
  assert.deepEqual(e.ctx.blockSources(0), ['albo']);
  assert.equal(e.ctx.blockadeFree(0), false, 'no combo while the reef is white');
  S.bleachUntil = 0;
  assert.equal(e.ctx.blockadeFree(0), true);
  const N = e.acc.NMAP;
  assert.ok(/uses your action/.test(N.albo.sp) && /FREE action/.test(N.albo.sp) && /BARRIER REEF/.test(N.albo.sp), 'Albo’s text mentions the combo on the Global Edition');
  assert.ok(/FREE action/.test(N.w_gbr.sp) && /FREE action/.test(N.w_cpa.sp));
  /* classic: Albo’s own text is untouched */
  e.f.rebuildWorld(false, false);
  assert.ok(/BLOCKADE \(free, once per turn\)/.test(e.acc.NMAP.albo.sp) && !/BARRIER REEF/.test(e.acc.NMAP.albo.sp), 'classic Albo text is unchanged');
  e.f.rebuildWorld(false, true);
  /* off the Global Edition, only Albo grants it */
  S.dlcWorld = false; S.owner = { albo: 0, w_gbr: 0, w_cpa: 0 };
  assert.deepEqual(e.ctx.blockSources(0), ['albo']);
  S.dlcWorld = true;
});

/* ---------- CORAL BLEACHING ---------- */
test('Coral Bleaching: a Global Edition event only; the reef’s blockade and income are off for 2 rounds, +1 Cortisol to its owner', async t => {
  const classic = await worldGame(t, { world: false });
  assert.equal(classic.e.acc.CARDS.length, 36, 'the classic deck is 36 cards');
  assert.ok(!classic.S.deck.includes('coral'), 'the classic deck has no coral card');
  assert.ok(!classic.e.ctx.botView(0).cardIds.includes('coral'));
  const { e, S } = await worldGame(t, { players: 3 });
  /* a fresh world deal contains it: initGame again on this engine */
  assert.ok(e.acc.CARDBYID.coral && e.acc.CARDBYID.coral.title === 'CORAL BLEACHING');
  assert.ok(e.ctx.botView(0).cardIds.includes('coral'));
  const e2 = await loadEngine(); t.after(() => e2.dispose());
  e2.acc.Net.boardLayout = 'random'; e2.acc.Net.dlcWorld = true;
  const S2 = await makeGame(e2, 2, {});
  assert.equal(S2.deck.length + S2.discard.length, 44, 'the world deck is the 36 classic cards plus coral and the 7 world-only market events');
  assert.ok(S2.deck.includes('coral'));
  /* the effect */
  S.owner = { w_gbr: 0, citi: 0, albo: 0 }; S.players[0].cortisol = 0; S.turn = 5; S.cur = 0;
  const inc0 = (() => { const b = money(S, 0); e.f.income(0); return money(S, 0) - b; })();
  await e.acc.CARDBYID.coral.run();
  assert.equal(S.bleachUntil, 8, 'next 2 rounds: this round plus two more');
  assert.equal(S.players[0].cortisol, 1, 'its owner takes +1 Cortisol');
  assert.ok(e.ctx.reefBleached());
  assert.deepEqual(e.ctx.blockSources(0), ['albo'], 'its blockade is off');
  assert.equal(e.ctx.blockadeFree(0), false);
  const inc1 = (() => { const b = money(S, 0); e.f.income(0); return money(S, 0) - b; })();
  assert.equal(inc0 - inc1, e.acc.NMAP.w_gbr.income, 'its income is off');
  assert.ok(S.log.some(l => l.includes('Reef') && l.includes('bleaches')));
  S.turn = 6; assert.ok(e.ctx.reefBleached(), 'still white next round');
  S.turn = 7; assert.ok(e.ctx.reefBleached(), 'and the one after');
  S.turn = 8; assert.ok(!e.ctx.reefBleached(), 'recovered');
  assert.deepEqual(e.ctx.blockSources(0).sort(), ['albo', 'w_gbr']);
  /* nobody owns it: nothing but the mood and the log */
  S.owner = {}; S.turn = 20; S.players[0].cortisol = 0;
  await e.acc.CARDBYID.coral.run();
  assert.equal(S.players[0].cortisol, 0);
  assert.ok(e.ctx.reefBleached());
});

/* ---------- THE CRUISE SHIP ---------- */
test('Cruise Ship: from a WATER node pay $2 to sail to any other WATER node; refused from land and to land; ends your movement', async t => {
  const { e, S } = await worldGame(t, { geo: true });
  const N = e.acc.NMAP;
  for (const id of ['w_panama', 'w_hormuz', 'w_suez', 'w_malacca', 'geo_scs', 'geo_tuvalu', 'w_fiji', 'w_nauru', 'w_cayman', 'w_bvi', 'w_bermuda', 'w_easter', 'geo_venice', 'w_svalbard', 'w_hdi', 'w_greenland', 'w_gbr', 'rock', 'w_srilanka', 'w_mbs', 'port', 'tanker', 'w_cruise'])
    assert.ok(W.WATER_NODES.has(id), id + ' is a water node');
  for (const id of ['quik', 'citi', 'w_aramco', 'w_kremlin', 'w_pyramids', 'w_hsbc']) assert.ok(!W.WATER_NODES.has(id), id + ' is land');
  S.owner = { w_cruise: 0 };
  /* standing on land: refused */
  arm(S, 0, 'move'); S.players[0].pos = 'quik'; S.players[0].money = 10;
  await act(e, 0, { act: 'worldmode', kind: 'cruise' });
  assert.equal(S.mode, null, 'quik is land');
  assert.match(e.ctx.worldBlocked(0, 'cruise'), /WATER/);
  /* standing on water: armed */
  S.players[0].pos = 'w_panama';
  await act(e, 0, { act: 'worldmode', kind: 'cruise' });
  assert.equal(S.mode, 'cruise');
  await act(e, 0, { act: 'cruise', id: 'citi' });
  assert.equal(S.players[0].pos, 'w_panama', 'the ship will not dock on land'); assert.equal(S.mode, 'cruise');
  await act(e, 0, { act: 'cruise', id: 'w_panama' });
  assert.equal(S.players[0].pos, 'w_panama', 'not the same port');
  /* a blockaded port refuses the ship */
  S.blockades = { w_malacca: S.turn + 2 };
  await act(e, 0, { act: 'cruise', id: 'w_malacca' });
  assert.equal(S.players[0].pos, 'w_panama', 'a blockaded node cannot be docked at');
  S.blockades = {};
  await act(e, 0, { act: 'cruise', id: 'w_malacca' });
  assert.equal(S.players[0].pos, 'w_malacca', 'sailed across the world');
  assert.equal(money(S, 0), 8, 'the $2 fare');
  assert.equal(S.phase, 'action', 'the voyage ends your movement'); assert.equal(S.steps, 0);
  assert.ok(S.log.some(l => l.includes('3,000-berth enclave')));
  /* the fare must be affordable, and only the owner sails */
  arm(S, 0, 'move'); S.players[0].pos = 'w_suez'; S.players[0].money = 1;
  await act(e, 0, { act: 'worldmode', kind: 'cruise' });
  assert.equal(S.mode, null, '$1 will not do');
  S.owner = { w_cruise: 1 }; S.players[0].money = 10;
  await act(e, 0, { act: 'worldmode', kind: 'cruise' });
  assert.equal(S.mode, null, 'not your ship');
});

test('Cruise Ship: +1 Cortisol at every turn start unless the owner also holds a REGULATOR', async t => {
  const { e, S } = await worldGame(t);
  S.owner = { w_cruise: 0, citi: 0 }; S.players[0].cortisol = 0; S.cur = 0;
  await e.f.startTurn(); await settle();
  assert.equal(S.players[0].cortisol, 1, 'cruise emissions');
  S.owner = { w_cruise: 0, rba: 0 }; assert.equal(e.acc.NMAP.rba.type, 'REGULATOR');
  S.players[0].cortisol = 0; S.cur = 0;
  await e.f.startTurn(); await settle();
  assert.equal(S.players[0].cortisol, 0, 'a regulator in the portfolio fixes the emissions');
});

/* ---------- the UI ---------- */
test('the rules help and the sidebar mention the Global Edition additions; the move phase offers the cruise and the free blockade', async t => {
  const { e, S } = await worldGame(t);
  const help = String(e.ctx.rulesHtml ? e.ctx.rulesHtml() : '');
  const src = (await import('node:fs')).readFileSync(new URL('../static/js/ui.js', import.meta.url), 'utf8');
  for (const phrase of ['TRADE BLOCS', 'CORAL BLEACHING', 'FREE action', 'WATER node', 'THE TARIFF WALL', 'BAILOUT', 'WTO file', '1 + 0.25 per member']) assert.ok(src.includes(phrase), 'help mentions ' + phrase);
  void help;
  S.owner = { w_cruise: 0, albo: 0, w_gbr: 0, w_tariffwall: 0 };
  const html = e.ctx.worldMoveButtons(0, S.players[0]);
  assert.ok(html.includes('data-act="worldmode:cruise"') && html.includes('BLOCKADE — FREE') && html.includes('data-act="tariffmode"'));
  S.owner = {};
  assert.equal(e.ctx.worldMoveButtons(0, S.players[0]), '');
});

/* ---------- the bots ---------- */
test('bots in a Global Edition game holding the new actives never crash and use the simple ones', async t => {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.ctx.window.__BIGCON_TEST__ = true; e.ctx.window.__BIGCON_BOT_SEED__ = 4242;
  const Bots = await e.loadBots();
  const used = new Set();
  const takeTurn = Bots.takeTurn;
  Bots.takeTurn = (pi, view, api) => takeTurn(pi, view, { ...api, applyIntent: async (p, m) => { used.add(m && m.act); await api.applyIntent(p, m); } });
  e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = true;
  const S = await makeGame(e, 3, { bots: [0, 1, 2], goal: 100, seeds: [42] });
  /* hand the bots every new active, and a table that needs them */
  S.owner = { w_imf: 0, w_tariffwall: 0, albo: 1, w_gbr: 1, w_cpa: 2, w_cruise: 2, w_wto: 2, w_eu: 1, w_doha: 0, w_woolies: 1, w_apple: 0, w_ofw: 2, w_anzcerta: 1, w_box: 2, w_brics: 0 };
  S.players[0].money = 40; S.players[1].money = 0; S.players[1].cortisol = 6; S.players[2].cortisol = 3;
  for (let i = 0; i < 6000 && S.turn < 14 && !S.over; i++) { await pump(2); if (e.clock.pending()) e.clock.advance(25); }
  assert.ok(S.turn >= 6 || S.over, 'the table kept playing (turn ' + S.turn + ')');
  const errs = e.consoleOut.error.filter(l => String(l).includes('bot turn error'));
  assert.equal(errs.length, 0, 'no bot turn crashed: ' + String(errs[0]).slice(0, 300));
  assert.ok(used.has('blockade') || used.has('tariff') || used.has('bailout'), 'a bot used a new active (used: ' + [...used].join(',') + ')');
});

/* ---------- THE ANTARCTIC TREATY: a bloc outside the WTO, and the end of the Peninsula disputes ---------- */
test('THE ANTARCTIC TREATY multiplies its claims like a bloc, never opens a WTO file, and settles the Peninsula disputes', async t => {
  const { e, S } = await worldGame(t, { players: 3 });
  const N = e.acc.NMAP;
  const claims = W.TRADE_BLOCS.w_antarctica.members;
  assert.equal(claims.length, 7, 'the seven territorial claims');
  assert.ok(W.TRADE_BLOCS.w_antarctica.noWto);
  for (const id of claims) assert.ok(N[id], id + ' is on the board');
  /* six claims: ×2.5, and no WTO file however many you hold */
  const mine = claims.slice(0, 6);
  S.owner = { w_antarctica: 0 }; give(S, 0, mine);
  const st = e.ctx.blocStatus(0).find(b => b.id === 'w_antarctica');
  assert.equal(st.k, 6); assert.equal(st.mult, 2.5); assert.equal(st.step, 0); assert.ok(st.noWto);
  assert.equal(st.bonus, Math.round(mine.reduce((a, id) => a + N[id].income, 0) * 1.5));
  e.f.acccReconcile();
  assert.ok(!S.acccFiles.some(f => f.pi === 0 && String(f.ind).startsWith('bloc_')), 'no WTO file on Antarctica');
  /* no cap: all seven claims multiply ×2.75 (an ordinary bloc stops at ×2.5) */
  give(S, 0, claims);
  const all = e.ctx.blocStatus(0).find(b => b.id === 'w_antarctica');
  assert.equal(all.k, 7); assert.equal(all.mult, 2.75, 'the Treaty is uncapped');
  assert.ok(W.TRADE_BLOCS.w_antarctica.noCap && !W.TRADE_BLOCS.w_eu.noCap);
  assert.equal(e.ctx.INDBYID.bloc_treaty, undefined, 'no treaty book exists');
  /* the Peninsula dispute: seat 1 holds two claims, seat 2 the third */
  const disputeHits = async treaty => {
    S.owner = treaty ? { w_antarctica: 0 } : {};
    give(S, 1, ['w_aq_chl', 'w_aq_gbr']); give(S, 2, ['w_aq_arg']);
    S.players[2].cortisol = 0; S.cur = 1;
    await e.f.startTurn(); await settle();
    return S.log.filter(l => l.includes('SOVEREIGNTY DISPUTE')).length;
  };
  const before = await disputeHits(false);
  assert.ok(before >= 1, 'without the treaty the dispute is filed');
  S.log.length = 0;
  assert.equal(await disputeHits(true), 0, 'with the treaty owned, the claims are settled');
  /* but only the Treaty's owner is recognised: anyone else holding territory takes +1 Cortisol a turn */
  const treatyHit = async (cur, owned) => {
    S.owner = { w_antarctica: 0 }; give(S, cur, owned);
    S.players[cur].cortisol = 0; S.cur = cur; S.log.length = 0;
    await e.f.startTurn(); await settle();
    return S.log.some(l => l.includes('THE ANTARCTIC TREATY:'));
  };
  assert.ok(await treatyHit(1, ['w_aq_adelie']), 'a rival claim is not recognised');
  assert.ok(!(await treatyHit(1, [])), 'no territory, no Cortisol');
  assert.ok(!(await treatyHit(0, ['w_aq_adelie'])), 'the Treaty owner is exempt');
});
