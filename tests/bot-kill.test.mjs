/*
 * Bots go for the kill: one node of a missing type short of the win, a seat stops
 * scheming — it walks / flies / slipstreams to the cheapest completing node it can
 * pay for AND still bank the goal on, seizes it on arrival, and hoards cash while it
 * cannot afford it yet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, pump } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
/* one node of each win type but REGULATOR */
const SIX = ['citi', 'us', 'oil', 'coal', 'press', 'back'];
const REGS = ['rba', 'asic', 'accc', 'gov'];

async function rig(t, { phase = 'move', pos = 'quik', money = 150, intel = 0, own = [], players = 2 } = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.ctx.window.__BIGCON_TEST__ = true; e.ctx.window.__BIGCON_BOT_SEED__ = 4242;
  await e.loadBots();
  const S = await makeGame(e, players, { bots: [1] });
  const bi = S.players.findIndex(p => p.bot);
  S.over = true; /* freeze every opening chain, then stage the table by hand */
  for (let i = 0; i < 30; i++) { await pump(2); if (e.clock.pending()) e.clock.advance(25); }
  S.over = false;
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = []; S.owner = {}; S.bugs = {}; S.rubble = {}; S.blockades = {};
  S.cur = bi; S.phase = phase; S.mode = null; S.steps = 3; S.turn = 5;
  S.players.forEach(p => { p.money = 30; p.intel = 0; p.cortisol = 0; p.pos = 'quik'; });
  SIX.concat(own).forEach(id => { S.owner[id] = bi; });
  Object.assign(S.players[bi], { money, intel, pos });
  return { e, S, bi, P: S.players };
}
async function botTurn(e, bi) {
  const Bots = e.ctx.window.BigConBots;
  let done = false;
  const p = Bots.takeTurn(bi, e.ctx.botView(bi), e.ctx.botAPI(e.acc.Net.gameEpoch)).finally(() => { done = true; });
  for (let i = 0; i < 120 && !done; i++) { await pump(2); e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); }
  await p; await settle();
}
/* BFS hop distances over the live board */
function dists(e, from) {
  const d = { [from]: 0 }, q = [from];
  while (q.length) { const c = q.shift(); for (const nb of e.acc.ADJ[c] || []) if (d[nb] === undefined) { d[nb] = d[c] + 1; q.push(nb); } }
  return d;
}
const cost = (e, id) => e.acc.NMAP[id].cost;
const won = (S, bi) => S.over && S.phase === 'over' && S.players[bi].money >= S.goal;

test('KILL-1 standing on the last piece with the goal in hand: it seizes it and wins', async t => {
  const { e, S, bi } = await rig(t, { phase: 'action', pos: 'asic', money: 150 });
  await botTurn(e, bi);
  assert.equal(S.owner.asic, bi, 'it seized the regulator under its feet');
  assert.ok(won(S, bi), 'and that was the win');
});

test('KILL-2 two hops away it walks straight there and seizes on arrival, ignoring a tempting buy on the way', async t => {
  const { e, S, bi } = await rig(t, { phase: 'move', pos: 'quik', money: 160, intel: 0 });
  /* stage the bot two hops from a regulator, with a juicy unowned node in between */
  const d = {};
  REGS.forEach(r => { d[r] = dists(e, r); });
  const start = Object.keys(d.asic).find(n => REGS.every(r => d[r][n] >= 2) && REGS.some(r => d[r][n] === 2) && !SIX.includes(n));
  assert.ok(start, 'a node two hops from a regulator exists');
  e.acc.S.players[bi].pos = start;
  await botTurn(e, bi);
  assert.ok(won(S, bi), 'it won this very turn: ' + S.log.slice(-6).join(' | '));
  assert.ok(REGS.some(r => S.owner[r] === bi), 'by taking a regulator');
});

test('KILL-3 it only takes a node it can still bank the goal after paying for: the cheap one, not the one under its feet', async t => {
  /* $105 = goal + $5. Standing ON the RBA ($10) it would be left at $95, short of the goal; the ASIC is one hop away at $5. */
  const { e, S, bi } = await rig(t, { phase: 'move', pos: 'rba', money: 105 });
  /* the board is dealt fresh each game: stand on whichever dear regulator has a $5 one within walking range */
  const pricey = ['rba', 'gov'].find(r => { const d = dists(e, r); return Math.min(d.asic, d.accc) <= 3; });
  assert.ok(pricey, 'a dear regulator sits within walking range of a cheap one');
  S.players[bi].pos = pricey;
  await botTurn(e, bi);
  assert.ok(won(S, bi), 'won: ' + S.log.slice(-6).join(' | '));
  assert.ok(S.owner.asic === bi || S.owner.accc === bi, 'it took a $5 regulator');
  assert.notEqual(S.owner[pricey], bi, 'and left the one under its feet alone');
});

test('KILL-4 too far to walk: it flies the Qantas jet to the completing node and seizes it', async t => {
  const { e, S, bi } = await rig(t, { phase: 'move', pos: 'quik', money: 160, own: ['qantas'] });
  /* the node farthest from every regulator (and not qantas itself) */
  const d = {}; REGS.forEach(r => { d[r] = dists(e, r); });
  const far = Object.keys(d.asic).filter(n => !SIX.includes(n) && n !== 'qantas').sort((a, b) => Math.min(...REGS.map(r => d[r][b])) - Math.min(...REGS.map(r => d[r][a])))[0];
  assert.ok(Math.min(...REGS.map(r => d[r][far])) >= 3, 'out of one-step range');
  S.players[bi].pos = far; S.steps = 1; /* a one-step turn (caution) — only the jet can make it */
  await botTurn(e, bi);
  assert.ok(won(S, bi), 'it won after the flight: ' + S.log.slice(-6).join(' | '));
  assert.ok(S.log.some(l => l.includes('takes the Qantas jet')), 'it flew');
  assert.equal(S.players[bi].money >= 100, true);
});

test('KILL-5 a favor or the slipstream buys the missing step when that is the only way', async t => {
  const { e, S, bi } = await rig(t, { phase: 'move', pos: 'quik', money: 160, intel: 3, own: ['f1'] });
  const d = {}; REGS.forEach(r => { d[r] = dists(e, r); });
  const start = Object.keys(d.asic).find(n => !SIX.includes(n) && n !== 'f1' && Math.min(...REGS.map(r => d[r][n])) === 4);
  assert.ok(start, 'a node four hops from the nearest regulator exists');
  S.players[bi].pos = start;
  await botTurn(e, bi);
  assert.ok(won(S, bi), 'extra steps got it there: ' + S.log.slice(-8).join(' | '));
});

test('KILL-6 it cannot afford the kill yet: it hoards — no tempting purchases, no early set piece', async t => {
  /* $97: it needs the $100 goal + $5 for a regulator. The old brain bought whatever it stood on (a corporate, the
     boulder-adjacent filler, even the regulator itself, leaving it at $92). The killer waits for the cash. */
  for (const tempting of ['f1', 'market', 'rock', 'asic']) {
    const { e, S, bi } = await rig(t, { phase: 'action', pos: tempting, money: 97, intel: 0 });
    const before = S.players[bi].money;
    await botTurn(e, bi);
    assert.notEqual(S.owner[tempting], bi, 'it did not buy ' + tempting);
    assert.ok(S.players[bi].money >= before, tempting + ': it did not spend (' + before + ' -> ' + S.players[bi].money + ')');
    assert.equal(S.over, false);
    e.dispose();
  }
});

test('KILL-6b hoarding also steers the walk: it closes in on the completing nodes instead of chasing purchases', async t => {
  const { e, S, bi } = await rig(t, { phase: 'move', pos: 'quik', money: 97 });
  const d = {}; REGS.forEach(r => { d[r] = dists(e, r); });
  const near = n => Math.min(...REGS.map(r => d[r][n]));
  const start = Object.keys(d.asic).find(n => !SIX.includes(n) && near(n) === 3);
  assert.ok(start, 'a node three hops out exists');
  S.players[bi].pos = start;
  await botTurn(e, bi);
  assert.ok(near(S.players[bi].pos) < 3, 'it is closer to a regulator than it started: ' + start + ' -> ' + S.players[bi].pos);
  assert.ok(S.players[bi].money >= 90, 'and kept its cash');
});

test('KILL-7 the same seat two types short still plays the normal game (it buys)', async t => {
  const { e, S, bi } = await rig(t, { phase: 'action', pos: 'bhp', money: 120 });
  delete S.owner.oil; /* COMMODITY missing too, and bhp is COMMODITY */
  S.owner.bhp = undefined; delete S.owner.bhp;
  await botTurn(e, bi);
  assert.equal(S.owner.bhp, bi, 'with two types missing it just takes the commodity it stands on');
});

test('KILL-8 one type short and the cash is nowhere near: it carries on normally (no hoarding)', async t => {
  const { e, S, bi } = await rig(t, { phase: 'action', pos: 'bhp', money: 20 });
  S.owner.bhp = undefined; delete S.owner.bhp;
  await botTurn(e, bi);
  assert.equal(S.owner.bhp, bi, 'far from the goal it keeps building its book');
});

test('KILL-9 selling the Intel hoard is the finisher when that closes the gap', async t => {
  const { e, S, bi } = await rig(t, { phase: 'action', pos: 'asic', money: 96, intel: 8 });
  S.mood = 'CALM';
  const rate = e.acc.MOODS.CALM.rate;
  assert.ok(96 + 8 * rate >= 105, 'the Intel is worth enough to close the gap at this rate');
  await botTurn(e, bi);
  assert.ok(S.players[bi].intel === 0 || S.owner.asic === bi, 'it cashed the Intel in (or already won)');
  assert.ok(S.players[bi].money >= 96 + 8 * rate - 5 || S.owner.asic === bi, 'the cash arrived');
});
