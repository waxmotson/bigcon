/*
 * GLOBAL EDITION: BIG YAHU, LOCKHEED MARTIN and JENSEN HUANG.
 * LIBERATE OIL (Big Yahu + Trump + Lockheed, once per game): every oil node is divested — the liberator's own go to the market at list price,
 * half of the rivals' (rounded up, best-paying first) go to the liberator and the rest go unowned.
 * HONEYPOT (Jensen Huang, once per game): two free Chinese nodes; no US node pays for 2 rounds; no buying in South-East Asia or the USA for 2 turns.
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
  S.owner = {}; S.bugs = {}; S.rubble = {}; S.wGame = {}; S.nTurn = {}; S.acccFiles = [];
  S.cur = 0; S.mode = null; S.phase = 'action'; S.steps = 3;
  S.players.forEach(p => { p.money = 50; p.intel = 10; p.cortisol = 0; p.pos = 'quik'; p.raided = 0; });
  return { e, S: e.acc.S, P: e.acc.S.players };
}
const act = (S, cur = 0) => { S.cur = cur; S.phase = 'action'; S.mode = null; S.nTurn = {}; };

test('the three new exhibits are on the Global Edition board at real places, with their abilities written', async t => {
  const { e } = await game(t);
  const N = e.acc.NMAP;
  for (const id of ['w_bigyahu', 'w_lockheed', 'w_jensen']) assert.ok(N[id] && N[id].geo, id + ' is on the board');
  assert.match(N.w_bigyahu.sp, /LIBERATE OIL/);
  assert.match(N.w_jensen.sp, /HONEYPOT/);
  assert.ok(e.ctx.US_NODES.includes('w_lockheed'));
});

test('LIBERATE OIL: needs all three; own oil sold at list, half of rivals’ oil taken (rounded up, best first), the rest freed; once per game', async t => {
  const { e, S, P } = await game(t);
  const N = e.acc.NMAP;
  S.owner = { w_bigyahu: 0, trump: 0, w_cushing: 0, w_aramco: 1, w_dangote: 1, w_pemex: 2, w_petrobras: 2, w_pdvsa: 1 };
  /* without Lockheed: refused */
  await run(e, 0, { act: 'liberate' });
  assert.equal(S.owner.w_aramco, 1, 'no Lockheed, no liberation');
  assert.ok(!S.wGame.liberate);
  S.owner.w_lockheed = 0; act(S, 0);
  const plan = e.ctx.liberatePlan(0);
  assert.deepEqual(plan.mine, ['w_cushing']);
  assert.equal(plan.taken.length, 3, 'half of five, rounded up');
  assert.equal(plan.taken[0], 'w_aramco', 'the best-paying oil comes first');
  const before = P[0].money;
  await run(e, 0, { act: 'liberate' });
  assert.ok(S.wGame.liberate);
  assert.equal(S.owner.w_cushing, undefined, 'my own oil is divested');
  assert.ok(P[0].money >= before + N.w_cushing.cost, 'sold at list price');
  for (const id of plan.taken) assert.equal(S.owner[id], 0, id + ' is liberated into my hands');
  for (const id of plan.freed) assert.equal(S.owner[id], undefined, id + ' is set free');
  /* once per game */
  S.owner.w_pemex = 2; act(S, 0);
  await run(e, 0, { act: 'liberate' });
  assert.equal(S.owner.w_pemex, 2);
});

test('HONEYPOT: two free Chinese nodes (unowned first), US nodes stop paying, and no buying in South-East Asia or the USA for two turns', async t => {
  const { e, S, P } = await game(t);
  S.owner = { w_jensen: 0, w_jpm: 1, w_hsbc: 2 };
  const picks = e.ctx.honeypotPicks(0);
  assert.equal(picks.length, 2);
  assert.ok(picks.every(id => S.owner[id] == null), 'unowned Chinese nodes are taken first');
  const cash = P[0].money;
  await run(e, 0, { act: 'honeypot' });
  assert.ok(S.wGame.honeypot);
  for (const id of picks) assert.equal(S.owner[id], 0, id + ' is mine for free');
  assert.ok(P[0].money >= cash, 'it cost nothing');
  assert.equal(S.owner.w_hsbc, 2, 'a rival’s node is only taken when the unowned ones run out');
  assert.ok(e.ctx.suspended('w_jpm'), 'the US market has crashed');
  /* the ban: the seat cannot seize a US node or a South-East Asian one */
  act(S, 0);
  assert.ok(e.ctx.honeypotBan(0, 'w_bell'));
  assert.ok(e.ctx.honeypotBan(0, 'w_temasek'));
  assert.equal(e.ctx.honeypotBan(0, 'w_boe'), '', 'Europe is still open');
  assert.equal(e.ctx.honeypotBan(1, 'w_bell'), '', 'only the honeypot setter is banned');
  P[0].pos = 'w_bell';
  await run(e, 0, { act: 'seize' });
  assert.equal(S.owner.w_bell, undefined, 'the seizure is refused');
  /* after two of the setter's turns the ban and the crash lapse */
  S.turn += 3;
  assert.equal(e.ctx.honeypotBan(0, 'w_bell'), '');
  assert.ok(!e.ctx.suspended('w_jpm'));
  /* once per game */
  S.owner = { w_jensen: 0 }; act(S, 0);
  await run(e, 0, { act: 'honeypot' });
  assert.ok(!Object.keys(S.owner).some(id => id !== 'w_jensen'));
});

test('HONEYPOT falls back to a rival’s Chinese node when the unowned ones run out', async t => {
  const { e, S } = await game(t);
  const china = ['w_pboc', 'w_shenzhen', 'w_baotou', 'w_bri', 'w_hsbc', 'w_hkma', 'w_evergrande'];
  S.owner = { w_jensen: 0 }; china.forEach(id => { S.owner[id] = 1; });
  delete S.owner.w_pboc;
  const picks = e.ctx.honeypotPicks(0);
  assert.equal(picks[0], 'w_pboc');
  assert.equal(S.owner[picks[1]], 1, 'the second comes from the rival');
});

test('LIBERATE OIL on screen: missiles from Trump and Big Yahu on every oil field, then F-35s out of Lockheed, staggered', async t => {
  const { e, S } = await game(t);
  S.owner = { w_bigyahu: 0, trump: 0, w_lockheed: 0, w_aramco: 1 };
  S.fx = [];
  const seen = [];
  const push = S.fx.push.bind(S.fx);
  S.fx.push = (...a) => { seen.push(...a); return push(...a); };
  await run(e, 0, { act: 'liberate' });
  assert.ok(S.wGame.liberate);
  const N = e.acc.NMAP, at = id => f => f.x0 === N[id].x && f.y0 === N[id].y - 40;
  const proj = seen.filter(f => f.proj);
  const missiles = proj.filter(f => f.img.includes('missile')), jets = proj.filter(f => f.img.includes('f35'));
  assert.ok(missiles.some(at('trump')) && missiles.some(at('w_bigyahu')), 'both launchers fire');
  assert.ok(missiles.length >= 2 * 10, 'every oil field takes a missile from each: ' + missiles.length);
  assert.ok(jets.length >= 10 && jets.every(at('w_lockheed')), 'the F-35s scramble from Lockheed: ' + jets.length);
  assert.ok(proj.length > 4, 'a bigger show than BONDMAGEDDON\'s four');
  assert.ok(new Set(proj.map(f => f.dl || 0)).size > 5, 'launches are staggered');
  assert.ok(seen.some(f => !f.proj && f.t === '💥'), 'the fields take their hits');
});
