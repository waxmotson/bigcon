/*
 * Every turn action, driven end-to-end through applyIntent.
 *
 * applyIntent silently ignores any act whose preconditions fail, so each
 * scenario arms the exact preconditions, fires the act, and asserts a visible
 * effect (money / intel / cortisol / ownership / flag / phase) — never just
 * "did not throw". A second test fails if a new `act` appears in the engine
 * without a scenario here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, makeGame, repoRoot } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
const covered = new Set();

/* Fresh 3-seat geo game, seat 0 = actor, quiet deck, blank slate of holdings. */
async function game(t, over = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  const S = await makeGame(e, 3, { geo: true });
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = {};
  S.cur = 0; S.mode = null; S.phase = over.phase || 'action'; S.steps = over.steps ?? 3;
  S.players.forEach(p => { p.money = 60; p.intel = 10; p.cortisol = 0; p.pos = 'quik'; });
  S.players[0].money = over.money ?? 60; S.players[0].intel = over.intel ?? 10;
  return { e, S, P: S.players };
}
/* Runs an act to completion, advancing the virtual clock so projectile / flight
   pauses and other timers resolve instead of hanging the chain. */
async function act(e, m, pi = 0) {
  let done = false;
  const run = e.f.applyIntent(pi, m).finally(() => { done = true; });
  for (let i = 0; i < 12 && !done; i++) {
    await settle();
    e.clock.advance(e.acc.PROJ_PAUSE_MS + 100);
  }
  await run;
  await settle();
}
const logged = (S, text) => S.log.some(l => String(l && l.t !== undefined ? l.t : l).includes(text));
/* A player needs 2+ nodes to be able to gain Cortisol (engine addCortisol). */
const give = (S, i, ids) => ids.forEach(id => { S.owner[id] = i; });
const TWO = { 1: ['anz', 'nab'], 2: ['commbank', 'westpac'] };
const used = (...names) => names.forEach(n => covered.add(n));
const advanced = S => S.cur !== 0 || S.turn > 1;

/* ---------------- movement phase ---------------- */
test('move: walks one thread, uses a step', async t => {
  const { e, S, P } = await game(t, { phase: 'move' });
  const to = e.acc.ADJ.quik[0];
  await act(e, { act: 'move', id: to });
  assert.equal(P[0].pos, to);
  assert.ok(S.steps < 3, 'a step was spent');
  used('move');
});
test('favor: +1 step for 1 Intel, once', async t => {
  const { e, S, P } = await game(t, { phase: 'move' });
  await act(e, { act: 'favor' });
  assert.equal(S.steps, 4); assert.equal(P[0].intel, 9); assert.equal(S.extraStep, true);
  await act(e, { act: 'favor' });
  assert.equal(S.steps, 4, 'second favor refused');
  used('favor');
});
test('endmove: ends the walk and opens the action phase', async t => {
  const { e, S } = await game(t, { phase: 'move' });
  await act(e, { act: 'endmove' });
  assert.equal(S.phase, 'action');
  used('endmove');
});
test('flymode / fly / cancel: Qantas teleports for $3 and ends the move', async t => {
  const { e, S, P } = await game(t, { phase: 'move' });
  S.owner.qantas = 0;
  await act(e, { act: 'flymode' });
  assert.equal(S.mode, 'fly');
  await act(e, { act: 'cancel' });
  assert.equal(S.mode, null);
  await act(e, { act: 'flymode' });
  const dest = e.acc.NODES.find(n => !['quik', 'qantas'].includes(n.id) && !S.rubble[n.id]).id;
  const before = P[0].money;
  await act(e, { act: 'fly', id: dest });
  assert.equal(P[0].pos, dest);
  assert.ok(P[0].money <= before - 3 + 1, 'paid the $3 fare');
  assert.equal(S.mode, null);
  used('flymode', 'fly', 'cancel');
});
test('slip: F1 slipstream = +2 steps for $2', async t => {
  const { e, S, P } = await game(t, { phase: 'move' });
  S.owner.f1 = 0;
  await act(e, { act: 'slip' });
  assert.equal(S.steps, 5); assert.equal(P[0].money, 58); assert.equal(S.slipped, true);
  used('slip');
});
test('Backroom Deals: a node ability mid-walk costs 2 steps (pressure)', async t => {
  const { e, S, P } = await game(t, { phase: 'move', steps: 3 });
  S.owner.back = 0; give(S, 1, TWO[1]);
  await act(e, { act: 'pressure' });
  assert.equal(S.steps, 1); assert.equal(S.phase, 'move'); assert.equal(S.cur, 0);
  assert.equal(P[1].cortisol, 1);
});

/* ---------------- action phase: ownership ---------------- */
test('seize: buy the node you stand on', async t => {
  const { e, S, P } = await game(t);
  P[0].pos = 'citi';
  await act(e, { act: 'seize' });
  assert.equal(S.owner.citi, 0);
  assert.ok(P[0].money < 60);
  used('seize');
});
test('seize: hostile takeover pays the old owner', async t => {
  const { e, S, P } = await game(t);
  P[0].pos = 'citi'; S.owner.citi = 1;
  const rival = P[1].money;
  await act(e, { act: 'seize' });
  assert.equal(S.owner.citi, 0);
  assert.ok(P[1].money > rival, 'the old owner was paid');
});
test('bugmode / bug: plants a bug on an adjacent rival node', async t => {
  const { e, S, P } = await game(t);
  const target = e.acc.ADJ.quik[0];
  S.owner[target] = 1;
  await act(e, { act: 'bugmode' });
  assert.equal(S.mode, 'bug');
  await act(e, { act: 'bug', id: target });
  assert.equal(S.bugs[target], 0);
  used('bugmode', 'bug');
});

/* ---------------- node abilities ---------------- */
test('leakmode / leak: 2 Intel, target +2 Cortisol', async t => {
  const { e, S, P } = await game(t);
  give(S, 1, TWO[1]);
  await act(e, { act: 'leakmode' });
  assert.equal(S.mode, 'leak');
  await act(e, { act: 'leak', target: 1 });
  assert.equal(P[0].intel, 8); assert.equal(P[1].cortisol, 2); assert.ok(advanced(S));
  used('leakmode', 'leak');
});
test('auditmode / audit: ASIC, $4, target +1 Cortisol', async t => {
  const { e, S, P } = await game(t);
  S.owner.asic = 0; give(S, 1, TWO[1]);
  await act(e, { act: 'auditmode' });
  assert.equal(S.mode, 'audit');
  await act(e, { act: 'audit', target: 1 });
  assert.equal(P[1].cortisol, 1); assert.ok(logged(S, 'sends the regulator')); assert.ok(advanced(S));
  used('auditmode', 'audit');
});
test('tweetmode / tweet: Trump, $2, target loses Intel', async t => {
  const { e, S, P } = await game(t);
  S.owner.trump = 0;
  await act(e, { act: 'tweetmode' });
  assert.equal(S.mode, 'tweet');
  await act(e, { act: 'tweet', target: 1 });
  assert.equal(P[1].intel, 10 - Math.max(3, Math.ceil(5)));
  assert.ok(advanced(S));
  used('tweetmode', 'tweet');
});
test('spin / roast: press spin, then roast a rival for +1 Cortisol', async t => {
  const { e, S, P } = await game(t);
  S.owner.press = 0; give(S, 1, TWO[1]);
  e.queueModal('cortisol');
  await act(e, { act: 'spin', kind: 'press' });
  assert.equal(S.mode, 'roast', 'spin opens target picking');
  await act(e, { act: 'roast', target: 1 });
  assert.equal(P[1].cortisol, 1); assert.ok(logged(S, 'roasts'));
  used('spin', 'roast');
});
test('cook: Rock cooks the books, $3, −3 Cortisol', async t => {
  const { e, S, P } = await game(t);
  S.owner.rock = 0; P[0].cortisol = 5;
  await act(e, { act: 'cook' });
  assert.equal(P[0].cortisol, 2); assert.ok(logged(S, 'cooks the books'));
  used('cook');
});
test('pressure: Backroom lean-on-the-table gives every rival +1 Cortisol', async t => {
  const { e, S, P } = await game(t);
  S.owner.back = 0; give(S, 1, TWO[1]); give(S, 2, TWO[2]);
  await act(e, { act: 'pressure' });
  assert.equal(P[1].cortisol, 1); assert.equal(P[2].cortisol, 1); assert.ok(logged(S, 'leans on the table'));
  used('pressure');
});
test('budget: Government budget night, $3, rivals pay $1, +1 Intel', async t => {
  const { e, S, P } = await game(t);
  S.owner.gov = 0; const r1 = P[1].money;
  await act(e, { act: 'budget' });
  assert.ok(logged(S, 'BUDGET NIGHT'));
  assert.equal(P[0].intel, 11, '+1 Intel');
  used('budget');
});
test('push: Sisyphus pays the stack and doubles it', async t => {
  const { e, S, P } = await game(t);
  S.owner.sisy = 0; P[0].pos = 'sisy'; S.sisyPayout = 10;
  const m0 = P[0].money;
  await act(e, { act: 'push' });
  assert.equal(S.sisyPayout, 20); assert.ok(P[0].money >= m0 + 10);
  used('push');
});
test('jog: ASICS lap, −1 Cortisol', async t => {
  const { e, S, P } = await game(t);
  S.owner.asics = 0; P[0].pos = 'asics'; P[0].cortisol = 3;
  await act(e, { act: 'jog' });
  assert.equal(P[0].cortisol, 2); assert.ok(advanced(S));
  used('jog');
});

/* ---------------- geography DLC ---------------- */
test('missilemode / missile: silo strike turns a rival node to rubble', async t => {
  const { e, S, P } = await game(t);
  S.owner.geo_missile = 0; P[0].pos = 'geo_missile'; S.owner.citi = 1;
  await act(e, { act: 'missilemode' });
  assert.equal(S.mode, 'missile');
  await act(e, { act: 'missile', id: 'citi' });
  assert.equal(S.rubble.citi, 1); assert.equal(S.owner.citi, undefined);
  assert.equal(P[0].intel, 9);
  used('missilemode', 'missile');
});
test('missile fired mid-move ends the walk but the action phase still follows', async t => {
  const { e, S, P } = await game(t, { phase: 'move' });
  S.owner.geo_missile = 0; P[0].pos = 'geo_missile'; S.owner.citi = 1;
  await act(e, { act: 'missilemode' });
  await act(e, { act: 'missile', id: 'citi' });
  assert.equal(S.rubble.citi, 1); assert.equal(S.phase, 'action'); assert.equal(S.cur, 0);
});
test('rebuild: pay list price, node returns unowned', async t => {
  const { e, S, P } = await game(t);
  P[0].pos = 'citi'; S.rubble.citi = 1;
  await act(e, { act: 'rebuild' });
  assert.equal(S.rubble.citi, undefined); assert.equal(S.owner.citi, undefined);
  assert.ok(P[0].money <= 60 - e.acc.NMAP.citi.cost + 3);
  used('rebuild');
});
test('beach: Wonsan, −2 Cortisol', async t => {
  const { e, S, P } = await game(t);
  S.owner.geo_wonsan = 0; P[0].pos = 'geo_wonsan'; P[0].cortisol = 4;
  await act(e, { act: 'beach' });
  assert.equal(P[0].cortisol, 2); assert.ok(logged(S, 'beach day'));
  used('beach');
});
test('qantasdown: Boeing grounds a rival Qantas for $4', async t => {
  const { e, S, P } = await game(t);
  S.owner.geo_boeing = 0; S.owner.qantas = 1;
  await act(e, { act: 'qantasdown' });
  assert.ok(e.f.qantasGrounded()); assert.ok(logged(S, 'parks THE CORPORATE BOEING'));
  used('qantasdown');
});
test('oilcrash: South China Sea, $3, oil holders pay $2', async t => {
  const { e, S, P } = await game(t);
  S.owner.geo_scs = 0; S.owner.oil = 1;
  await act(e, { act: 'oilcrash' });
  assert.ok(logged(S, 'OIL CRASH'));
  used('oilcrash');
});
test('stage5: richest rival makes no income next turn (2 Intel)', async t => {
  const { e, S, P } = await game(t);
  S.owner.geo_stage5 = 0; P[1].money = 500;
  await act(e, { act: 'stage5' });
  assert.ok(logged(S, 'STAGE 5 DECLINE')); assert.equal(P[0].intel, 8);
  used('stage5');
});
test('venicecool: gondola, −1 Cortisol', async t => {
  const { e, S, P } = await game(t);
  S.owner.geo_venice = 0; P[0].pos = 'geo_venice'; P[0].cortisol = 3;
  await act(e, { act: 'venicecool' });
  assert.equal(P[0].cortisol, 2); assert.ok(logged(S, 'gondola'));
  used('venicecool');
});
test('overmode / overtour: Venice marks a rival node for Cortisol, $2', async t => {
  const { e, S, P } = await game(t);
  S.owner.geo_venice = 0; S.owner.citi = 1;
  await act(e, { act: 'overmode' });
  assert.equal(S.mode, 'overtour');
  await act(e, { act: 'overtour', id: 'citi' });
  assert.ok(S.ov && S.ov.nid === 'citi' && S.ov.targetOwner === 1);
  used('overmode', 'overtour');
});
test('blockmode / blockade: Albo walls off a node, free', async t => {
  const { e, S, P } = await game(t);
  S.owner.albo = 0;
  await act(e, { act: 'blockmode' });
  assert.equal(S.mode, 'blockade');
  await act(e, { act: 'blockade', id: 'citi' });
  assert.ok(e.f.blockaded('citi')); assert.ok(logged(S, 'BLOCKADED'));
  used('blockmode', 'blockade');
});

/* ---------------- intel ops & choices ---------------- */
test('spy: 2 Intel, shows the next card, ends nothing', async t => {
  const { e, S, P } = await game(t);
  await act(e, { act: 'spy' });
  assert.equal(P[0].intel, 8); assert.equal(S.cur, 0, 'spy does not end the turn');
  used('spy');
});
test('dossier: 3 Intel, takeovers at list price', async t => {
  const { e, S, P } = await game(t);
  await act(e, { act: 'dossier' });
  assert.equal(S.dossier, true); assert.equal(P[0].intel, 7);
  used('dossier');
});
test('sweep: 2 Intel, clears bugs on your nodes, ends the turn', async t => {
  const { e, S, P } = await game(t);
  S.owner.citi = 0; S.bugs.citi = 1;
  await act(e, { act: 'sweep' });
  assert.equal(S.bugs.citi, undefined); assert.equal(P[0].intel, 8); assert.ok(advanced(S));
  used('sweep');
});
test('masspanic: 5 Intel, everyone +2 Cortisol (holders of 2+ nodes)', async t => {
  const { e, S, P } = await game(t);
  S.players.forEach((_, i) => { S.owner['citi'] = S.owner.citi ?? i; });
  ['citi', 'anz', 'nab'].forEach(id => { S.owner[id] = 1; });
  ['commbank', 'westpac'].forEach(id => { S.owner[id] = 0; });
  await act(e, { act: 'masspanic' });
  assert.equal(P[0].intel, 5); assert.equal(P[1].cortisol, 2); assert.ok(advanced(S));
  used('masspanic');
});
test('targetpanic: 30 Intel, rival +6 Cortisol', async t => {
  const { e, S, P } = await game(t, { intel: 30 });
  e.queueModal(1);
  await act(e, { act: 'targetpanic' });
  assert.equal(P[0].intel, 0); assert.equal(P[1].cortisol, 6, 'the overload bypasses the 2-node rule');
  used('targetpanic');
});
test('divestmade: 5 Intel + $7 strips MADE from its owner', async t => {
  const { e, S, P } = await game(t);
  S.owner.made = 1; const r = P[1].money;
  e.queueModal(1);
  await act(e, { act: 'divestmade' });
  assert.equal(S.owner.made, undefined); assert.equal(P[0].intel, 5);
  assert.ok(P[1].money >= r + 7);
  used('divestmade');
});
test('bondmageddon: Bond Desk + Leak, $16 + 4 Intel, four missiles', async t => {
  const { e, S, P } = await game(t, { money: 100 });
  S.owner.bond = 0; S.owner.leak = 0;
  ['citi', 'anz', 'nab', 'commbank', 'westpac'].forEach(id => { S.owner[id] = 1; });
  e.queueModal(1);
  await act(e, { act: 'bondmageddon' });
  assert.ok(logged(S, 'BONDMAGEDDON')); assert.equal(P[0].intel, 6);
  assert.ok(Object.keys(S.rubble).length >= 1, 'something was struck');
  used('bondmageddon');
});
test('sell / sellall: Intel converts to cash at the mood rate and ends the turn', async t => {
  const g1 = await game(t);
  const rate = g1.e.acc.MOODS[g1.S.mood].rate;
  await act(g1.e, { act: 'sell', n: 3 });
  assert.equal(g1.P[0].intel, 7); assert.ok(g1.P[0].money >= 60 + 3 * rate - 1); assert.ok(advanced(g1.S));
  const g2 = await game(t);
  await act(g2.e, { act: 'sellall' });
  assert.equal(g2.P[0].intel, 0);
  used('sell', 'sellall');
});
test('laylow: cash (+$1) and cool (−2 Cortisol) both end the turn', async t => {
  const a = await game(t); a.P[0].cortisol = 4;
  await act(a.e, { act: 'laylow', choice: 'cash' });
  assert.ok(a.P[0].money >= 61); assert.ok(advanced(a.S));
  const b = await game(t); b.P[0].cortisol = 4;
  await act(b.e, { act: 'laylow', choice: 'cool' });
  assert.ok(b.P[0].cortisol <= 2 + 0); assert.ok(advanced(b.S));
  used('laylow');
});

/* ---------------- the regulators' files and node deals ---------------- */
const fileOn = (e, S, pi, ind) => { e.f.acccReconcile(); return e.f.findFile(pi, ind); };
test('marketsell: a node from an open-file book goes back to the market at list price', async t => {
  const { e, S, P } = await game(t);
  give(S, 0, ['citi', 'commbank', 'nab']);
  assert.ok(fileOn(e, S, 0, 'bank'), 'three banks open an ACCC file');
  S.bugs.nab = 1;
  await act(e, { act: 'marketsell', id: 'nab' });
  assert.equal(S.owner.nab, undefined, 'the node is unowned again');
  assert.equal(S.bugs.nab, undefined, 'bugs on it are cleared');
  assert.ok(P[0].money >= 60 + e.acc.NMAP.nab.cost, 'list price paid out');
  assert.equal(e.f.findFile(0, 'bank'), null, 'the book is back to the allowed count — the file closes');
  assert.ok(advanced(S), 'the sale is your action');
  used('marketsell');
});
test('lobby: 3 Intel, −1 scrutiny, free and once per turn', async t => {
  const { e, S, P } = await game(t);
  give(S, 0, ['citi', 'commbank', 'nab']);
  fileOn(e, S, 0, 'bank').s = 2;
  await act(e, { act: 'lobby', kind: 'bank' });
  assert.equal(e.f.findFile(0, 'bank').s, 1); assert.equal(P[0].intel, 7);
  assert.equal(S.phase, 'action', 'lobbying does not use the action');
  await act(e, { act: 'lobby', kind: 'bank' });
  assert.equal(e.f.findFile(0, 'bank').s, 1, 'second lobby refused'); assert.equal(P[0].intel, 7);
  used('lobby');
});
test('refermode / refer: the ACCC owner pays $4 for +1 scrutiny on a rival file', async t => {
  const { e, S, P } = await game(t);
  S.owner.accc = 0;
  give(S, 1, ['citi', 'commbank', 'nab']);
  fileOn(e, S, 1, 'bank');
  await act(e, { act: 'refermode' });
  assert.equal(S.mode, 'refer');
  await act(e, { act: 'refer', target: 1, kind: 'bank' });
  assert.equal(e.f.findFile(1, 'bank').s, 2, 'referral +1, then the offender’s own turn start +1');
  assert.equal(P[0].money, 60 - 4 + 2, 'the referral cost $4 (then the quiet quarter paid $2)');
  assert.ok(advanced(S), 'a referral is your action');
  used('refermode', 'refer');
});
test('dealmode / deal: sell a node to a rival for a named price', async t => {
  const { e, S, P } = await game(t);
  give(S, 0, ['citi', 'anz']);
  await act(e, { act: 'dealmode' });
  assert.equal(S.mode, 'deal');
  await act(e, { act: 'deal', id: 'citi', target: 1, n: 12 });
  assert.equal(S.owner.citi, 1, 'the guest auto-accepts (first option)');
  assert.ok(logged(S, 'DEAL DONE'), 'the deal is on the record');
  assert.ok(advanced(S));
  used('dealmode', 'deal');
});

/* ---------------- guards ---------------- */
test('acts out of phase or off-turn are ignored, not applied', async t => {
  const { e, S, P } = await game(t, { phase: 'move' });
  const before = JSON.stringify(P[0]);
  await act(e, { act: 'sell', n: 3 });     // action-only
  await act(e, { act: 'seize' });          // action-only
  await act(e, { act: 'dossier' });        // action-only
  assert.equal(JSON.stringify(P[0]), before);
  await act(e, { act: 'favor' }, 1);       // not seat 1's turn
  assert.equal(S.extraStep, false);
});

/* ---------------- coverage gate ---------------- */
test('every act handled by the engine has a scenario in this file', async () => {
  const src = fs.readFileSync(path.join(repoRoot, 'static/js/engine.js'), 'utf8');
  const body = src.slice(src.indexOf('export async function applyIntent'));
  const acts = new Set([...body.matchAll(/act==='([a-z0-9]+)'/g)].map(m => m[1]));
  /* lobby-level toggles, not turn actions */
  ['megaring', 'ringworld'].forEach(a => acts.delete(a));
  const missing = [...acts].filter(a => !covered.has(a));
  assert.deepEqual(missing, [], 'acts without a scenario: ' + missing.join(', '));
});
