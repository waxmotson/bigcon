/*
 * Bots use the Global Edition abilities: PUT IT ALL ON BLACK / ALL IN ON GREEN, THE BIG GAMBLE, the BANK OF JAPAN carry trade
 * (to bank the win), the CHAINSAW, the NEW SILK ROAD, THE VANISH, THE AMAZON, and never get stuck in a targeting mode.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, pump } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
/* nodes whose own actives would steal the bot's turn from the ability under test */
const AVOID = new Set(['fox', 'press', 'trump', 'asic', 'albo', 'bond007', 'bond', 'leak', 'gov', 'sisy', 'made']);
const TYPES = ['BANK', 'REGULATOR', 'CHART', 'WILD', 'CORPORATE', 'COMMODITY', 'MEDIA'];

async function rig(t, { money = 40, pos = 'quik', intel = 0, cortisol = 0, turn = 5, players = 3 } = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.ctx.window.__BIGCON_TEST__ = true; e.ctx.window.__BIGCON_BOT_SEED__ = 4242;
  await e.loadBots();
  e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = true;
  const S = await makeGame(e, players, { bots: [1], goal: 100 });
  const bi = S.players.findIndex(p => p.bot);
  S.over = true; /* freeze every opening chain, then stage the table by hand */
  for (let i = 0; i < 30; i++) { await pump(2); if (e.clock.pending()) e.clock.advance(25); }
  S.over = false;
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = {}; S.blockades = {}; S.wGame = {}; S.wTurn = {}; S.nTurn = {}; S.acccFiles = [];
  S.cur = bi; S.phase = 'action'; S.mode = null; S.steps = 3; S.turn = turn;
  S.players.forEach(p => { p.money = 30; p.intel = 0; p.cortisol = 0; p.pos = 'quik'; });
  Object.assign(S.players[bi], { money, intel, cortisol, pos });
  return { e, S, bi, P: S.players };
}
/* one node of each win type (the first on the board that is not world-only), optionally leaving some types out */
function setFor(e, skip = [], not = new Set()) {
  const out = [];
  for (const ty of TYPES) {
    if (skip.includes(ty)) continue;
    const n = e.acc.NODES.find(x => x.type === ty && !x.id.startsWith('w_') && !x.id.startsWith('geo_') && !not.has(x.id) && !AVOID.has(x.id));
    out.push(n.id);
  }
  return out;
}
const own = (S, seat, ids) => ids.forEach(id => { S.owner[id] = seat; });
/* run one bot turn, recording every intent it sends */
async function botTurn(e, bi) {
  const Bots = e.ctx.window.BigConBots, real = e.ctx.botAPI(e.acc.Net.gameEpoch), sent = [];
  const api = { ...real, applyIntent: async (pi, m) => { if (pi === bi) sent.push(m); await real.applyIntent(pi, m); } };
  let done = false;
  const p = Bots.takeTurn(bi, e.ctx.botView(bi), api).finally(() => { done = true; });
  for (let i = 0; i < 120 && !done; i++) { await pump(2); e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); }
  await p; await settle();
  return sent;
}
const acts = sent => sent.map(m => m.act);
/* the front-runner: a full set but one type, nearly the whole goal in hand */
function makeLeader(e, S, seat, { money = 95, skip = ['REGULATOR'] } = {}) {
  own(S, seat, setFor(e, skip));
  S.players[seat].money = money;
}

test('BLACK: a bot with a casino and spare cash puts a small stake on black, and the turn goes on', async t => {
  const { e, S, bi } = await rig(t, { money: 60 });
  const lead = bi === 0 ? 1 : 0;
  own(S, bi, ['w_monaco', 'citi']); S.players[bi].pos = 'citi';
  makeLeader(e, S, lead, { money: 40 });
  const sent = await botTurn(e, bi);
  const bet = sent.find(m => m.act === 'black');
  assert.ok(bet, 'a bot with Monaco bets (sent: ' + acts(sent).join(',') + ')');
  assert.notEqual(bet.color, 'green', 'a plain bet, not the zero');
  assert.ok(bet.n >= 1 && bet.n <= 25, 'a modest stake (at most 40% of the spare cash): $' + bet.n);
  assert.ok(acts(sent).length > 1, 'the spin was free: the bot still took its turn');
  assert.equal(acts(sent).filter(a => a === 'black').length, 1, 'once a turn');
  assert.equal(S.mode, null);
});

test('ALL IN ON GREEN: only as a desperation move, hopelessly behind late', async t => {
  const { e, S, bi } = await rig(t, { money: 2, turn: 80 });
  const lead = bi === 0 ? 1 : 0;
  own(S, bi, ['w_monaco']);
  makeLeader(e, S, lead, { money: 99 });
  const sent = await botTurn(e, bi);
  const bet = sent.find(m => m.act === 'black');
  assert.ok(bet && bet.color === 'green', 'the desperate bot goes all in on the zero (sent: ' + JSON.stringify(sent.slice(0, 3)) + ')');
  /* a comfortable bot never does */
  const r = await rig(t, { money: 60 });
  own(r.S, r.bi, ['w_monaco', 'citi']); r.S.players[r.bi].pos = 'citi';
  const sent2 = await botTurn(r.e, r.bi);
  assert.ok(!sent2.some(m => m.color === 'green'), 'no green when not desperate');
});

test('THE BIG GAMBLE: a bot far behind reshuffles the table, a leader never does', async t => {
  const a = await rig(t, { money: 25, turn: 50 });
  const lead = a.bi === 0 ? 1 : 0;
  own(a.S, a.bi, ['w_pyramids', 'sisy', 'w_monaco']); a.S.players[a.bi].pos = 'w_monaco';
  makeLeader(a.e, a.S, lead, { money: 97 });
  const sent = await botTurn(a.e, a.bi);
  assert.ok(sent.some(m => m.act === 'biggamble'), 'the loser bets the house (sent: ' + acts(sent).join(',') + ')');
  assert.ok(a.S.wGame.biggamble, 'it ran');
  assert.equal(a.S.mode, null);
  const b = await rig(t, { money: 97, turn: 50 });
  own(b.S, b.bi, ['w_pyramids', 'sisy', 'w_monaco'].concat(setFor(b.e))); b.S.players[b.bi].pos = 'w_monaco';
  const sent2 = await botTurn(b.e, b.bi);
  assert.ok(!sent2.some(m => m.act === 'biggamble'), 'the front-runner keeps what it has');
});

test('CARRY TRADE: a full set and the goal within a $50 loan: borrow it and bank the win before Tokyo collects', async t => {
  const { e, S, bi } = await rig(t, { money: 80 });
  own(S, bi, ['w_boj'].concat(setFor(e)));
  assert.equal(e.ctx.missingTypes(bi).length, 0, 'the full set');
  const sent = await botTurn(e, bi);
  const c = sent.find(m => m.act === 'carry');
  assert.ok(c, 'it borrowed (sent: ' + acts(sent).join(',') + ')');
  assert.ok(c.n >= 20 && c.n <= 50, 'sized to the gap: $' + c.n);
  assert.ok(S.over && S.players[bi].money >= 100, 'and that was the win');
  /* out of reach of one loan: it does not borrow */
  const r = await rig(t, { money: 20 });
  own(r.S, r.bi, ['w_boj'].concat(setFor(r.e)));
  const sent2 = await botTurn(r.e, r.bi);
  assert.ok(!sent2.some(m => m.act === 'carry'), 'no pointless debt');
});

test('CHAINSAW: a bot cuts a line on the front-runner’s road, once, and never sits in the mode', async t => {
  const { e, S, bi } = await rig(t, { money: 20 });
  const lead = bi === 0 ? 1 : 0;
  makeLeader(e, S, lead, { money: 80, skip: ['REGULATOR'] });
  /* the bot holds a full set of other nodes: its own roads are never at stake */
  const mine = setFor(e, [], new Set(setFor(e, ['REGULATOR']))); own(S, bi, mine.concat(['w_milei'])); S.players[bi].pos = mine[0];
  const sent = await botTurn(e, bi);
  assert.ok(sent.some(m => m.act === 'worldmode' && m.kind === 'chainsaw'), 'it enters chainsaw mode (sent: ' + acts(sent).join(',') + ')');
  const cut = sent.find(m => m.act === 'edgepick');
  assert.ok(cut && cut.a && cut.id, 'it names the thread in one call');
  assert.ok(!e.ctx.hasEdge(cut.a, cut.id), 'the line is gone');
  assert.ok(S.wGame.milei, 'the chainsaw is spent');
  assert.equal(S.mode, null, 'no mode left open');
});

test('SILK ROAD: a bot links one of its nodes toward a far node it needs, and ends with the mode closed', async t => {
  const { e, S, bi } = await rig(t, { money: 40 });
  const A = e.acc.ADJ;
  const bfs = from => { const d = { [from]: 0 }, q = [from]; for (let h = 0; h < q.length; h++) for (const nb of A[q[h]] || []) if (d[nb] === undefined) { d[nb] = d[q[h]] + 1; q.push(nb); } return d; };
  const regs = e.acc.NODES.filter(n => n.type === 'REGULATOR').map(n => n.id);
  let found = null;
  for (const p of e.acc.NODES.map(n => n.id)) {
    const d = bfs(p);
    const o = e.acc.NODES.find(n => d[n.id] >= 1 && d[n.id] <= 2 && n.type !== 'REGULATOR' && !n.id.startsWith('geo_'));
    const far = regs.find(r => d[r] !== undefined && d[r] >= 6);
    if (o && far) { found = { p, o: o.id, far }; break; }
  }
  assert.ok(found, 'the board has a spot far from every regulator');
  /* every other regulator is rubble: the one node it needs is the far one */
  regs.forEach(r => { if (r !== found.far) S.rubble[r] = 1; });
  const set = setFor(e, ['REGULATOR']);
  own(S, bi, ['w_bri', found.o, found.p].concat(set)); /* standing on its own node: nothing to seize here */
  S.players[bi].pos = found.p;
  const sent = await botTurn(e, bi);
  const sr = sent.filter(m => m.act === 'edgepick');
  assert.ok(sent.some(m => m.act === 'worldmode' && m.kind === 'silkroad'), 'it opens the silk road (sent: ' + acts(sent).join(',') + ')');
  assert.equal(sr.length, 2, 'two clicks: my node, then the far one');
  assert.ok(e.ctx.hasEdge(sr[0].id, sr[1].id), 'the new road stands');
  assert.equal(S.mode, null);
});

test('THE VANISH: a bot at the raid wall with two armed rivals disappears', async t => {
  const { e, S, bi } = await rig(t, { money: 30, cortisol: 8, intel: 0 });
  const other = bi === 0 ? 1 : 0;
  own(S, bi, ['w_bermuda', 'citi', 'us', 'oil']); S.players[bi].pos = 'citi';
  S.players.forEach((pl, j) => { if (j !== bi) { pl.intel = 6; own(S, j, ['nab', 'anz'].slice(0, 1 + (j % 2))); } });
  const sent = await botTurn(e, bi);
  assert.ok(sent.some(m => m.act === 'vanish' || (m.act === 'worldmode' && m.kind === 'vanish')), 'it uses the Triangle (sent: ' + acts(sent).join(',') + ')');
  assert.equal(S.mode, null);
});

test('THE AMAZON: a bot sells carbon credits for its non-commodity nodes', async t => {
  const { e, S, bi } = await rig(t, { money: 30 });
  own(S, bi, ['w_amazon', 'citi', 'us', 'press', 'nab']); S.players[bi].pos = 'citi';
  const m0 = S.players[bi].money;
  const sent = await botTurn(e, bi);
  assert.ok(sent.some(m => m.act === 'carbon'), 'it sells (sent: ' + acts(sent).join(',') + ')');
  assert.ok(S.players[bi].money >= m0 + 12, 'at $3 a node');
});

test('a refused cut cancels the targeting mode instead of hanging', async t => {
  const { e, S, bi } = await rig(t, { money: 20 });
  const lead = bi === 0 ? 1 : 0;
  makeLeader(e, S, lead, { money: 80 });
  const mine = setFor(e, [], new Set(setFor(e, ['REGULATOR']))); own(S, bi, mine.concat(['w_milei'])); S.players[bi].pos = mine[0];
  /* the engine refuses every pick: edgepick is swallowed, so the mode stays open and the bot must close it */
  const Bots = e.ctx.window.BigConBots, real = e.ctx.botAPI(e.acc.Net.gameEpoch), sent = [];
  const api = { ...real, applyIntent: async (pi, m) => { if (pi === bi) sent.push(m); if (m.act === 'edgepick') return; await real.applyIntent(pi, m); } };
  let done = false;
  const p = Bots.takeTurn(bi, e.ctx.botView(bi), api).finally(() => { done = true; });
  for (let i = 0; i < 120 && !done; i++) { await pump(2); e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); }
  await p; await settle();
  assert.ok(sent.some(m => m.act === 'cancel'), 'it cancels (sent: ' + acts(sent).join(',') + ')');
  assert.equal(S.mode, null);
});
