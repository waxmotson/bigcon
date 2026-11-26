/* 🎰 PUT IT ALL ON BLACK (Monaco, Marina Bay Sands) and 🎲 THE BIG GAMBLE (Pyramids + Sisyphus + a casino), plus the tie rule:
   two players completing the con at once — the one with the most money takes it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, withRandomSeq } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
async function game(t, players = 3) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = true;
  await makeGame(e, players, {});
  const S = e.acc.S;
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = {}; S.wGame = {}; S.nTurn = {}; S.acccFiles = [];
  S.cur = 0; S.mode = null; S.phase = 'action'; S.steps = 3;
  S.players.forEach(p => { p.money = 50; p.intel = 5; p.cortisol = 0; p.pos = 'quik'; });
  return { e, S, P: S.players };
}

test('PUT IT ALL ON BLACK: needs a casino; 47% pays double, otherwise the stake is lost; once per turn', async t => {
  const { e, S, P } = await game(t);
  assert.equal(e.ctx.BLACK_ODDS, 0.47);
  await e.f.applyIntent(0, { act: 'black', n: 10 });
  assert.equal(P[0].money, 50, 'no casino, no wheel');
  S.owner.w_monaco = 0;
  await withRandomSeq([0.46], () => e.f.applyIntent(0, { act: 'black', n: 10 }));
  await settle();
  assert.equal(P[0].money, 60, 'black: the stake is paid again');
  await e.f.applyIntent(0, { act: 'black', n: 10 });
  assert.equal(P[0].money, 60, 'one spin a turn');
  S.nTurn = {}; delete S.owner.w_monaco; S.owner.w_mbs = 0;
  await withRandomSeq([0.47], () => e.f.applyIntent(0, { act: 'black', n: 25 }));
  await settle();
  assert.equal(P[0].money, 35, 'red: the house keeps it');
  S.nTurn = {};
  await e.f.applyIntent(0, { act: 'black', n: 999 });
  assert.equal(P[0].money, 35, 'cannot bet more than you have');
});

test('THE BIG GAMBLE: every owned node is dealt out again; the gambler loses the trio; nobody gets the whole trio; once per game', async t => {
  for (let round = 0; round < 15; round++) {
    const { e, S, P } = await game(t);
    const N = e.acc.NMAP;
    const ids = e.acc.NODES.filter(n => !n.id.startsWith('geo_')).map(n => n.id).filter(id => !['w_pyramids', 'sisy', 'w_monaco', 'w_mbs'].includes(id)).slice(0, 12);
    S.owner = { w_pyramids: 0, sisy: 0, w_monaco: 0 };
    ids.forEach((id, i) => { S.owner[id] = i % 3; });
    const count = j => Object.values(S.owner).filter(o => o === j).length;
    const before = [0, 1, 2].map(count);
    S.cur = 0; S.phase = 'action';
    await e.f.applyIntent(0, { act: 'biggamble' });
    await settle();
    assert.ok(S.wGame.biggamble, 'played');
    for (const id of ['w_pyramids', 'sisy', 'w_monaco']) assert.notEqual(S.owner[id], 0, id + ' leaves the gambler');
    const trioOwners = ['w_pyramids', 'sisy', 'w_monaco'].map(id => S.owner[id]);
    assert.ok(!(trioOwners[0] != null && trioOwners.every(o => o === trioOwners[0])), 'nobody is dealt the whole trio');
    assert.deepEqual([0, 1, 2].map(count), before, 'everyone keeps the same number of nodes');
    assert.ok(S.log.some(l => l.includes('THE BIG GAMBLE')));
    /* once per game */
    S.owner.w_pyramids = 0; S.owner.sisy = 0; S.owner.w_monaco = 0; S.cur = 0; S.phase = 'action'; S.mode = null;
    const snap = JSON.stringify(S.owner);
    await e.f.applyIntent(0, { act: 'biggamble' });
    assert.equal(JSON.stringify(S.owner), snap, 'only once');
    if (round > 2) break;
  }
});

test('THE BIG GAMBLE needs all three: the Pyramids, the Boulder and a casino', async t => {
  const { e, S } = await game(t);
  S.owner = { w_pyramids: 0, sisy: 0, citi: 1 };
  assert.match(e.ctx.reworkBlocked(0, 'biggamble'), /casino/);
  S.owner.w_mbs = 0;
  assert.equal(e.ctx.reworkBlocked(0, 'biggamble'), '');
  delete S.owner.sisy;
  assert.ok(e.ctx.reworkBlocked(0, 'biggamble'));
});

test('two players complete the con at the same moment: the one with the most money takes it', async t => {
  const { e, S, P } = await game(t);
  const goal = e.ctx.goalAmount();
  const types = ['BANK', 'REGULATOR', 'CHART', 'WILD', 'CORPORATE', 'COMMODITY', 'MEDIA'];
  const pick = (ty, k) => e.acc.NODES.filter(n => n.type === ty)[k].id;
  S.owner = {};
  types.forEach(ty => { S.owner[pick(ty, 0)] = 1; S.owner[pick(ty, 1)] = 2; });
  P[1].money = goal + 5; P[2].money = goal + 40;
  assert.ok(!e.ctx.missingTypes(1).length && !e.ctx.missingTypes(2).length);
  e.ctx.winCheck(); /* the victory reveal waits on a modal: don't await it */
  await settle();
  assert.ok(S.over, 'the con is complete');
  assert.ok(S.log.some(l => l.includes('complete the con at the same moment') && l.includes(e.ctx.pname(2))), 'the richer player takes it');
  assert.ok(S.log.some(l => l.startsWith('🏆 ' + e.ctx.pname(2))));
});

test('BACKROOM DEALS reaches the Global Edition abilities: the New Silk Road during movement, for 2 steps', async t => {
  const { e, S, P } = await game(t);
  const N = e.acc.NMAP;
  S.owner = { back: 0, w_bri: 0, citi: 0 };
  S.cur = 0; S.phase = 'move'; S.mode = null; S.steps = 3; S.backroomAbilityUsed = false; S.wTurn = {};
  P[0].pos = 'quik';
  const far = e.acc.NODES.find(n => n.id !== 'citi' && !e.ctx.hasEdge('citi', n.id) && n.id.startsWith('w_'));
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'silkroad' });
  assert.equal(S.mode, 'silkroad', 'the Silk Road opens during movement');
  await e.f.applyIntent(0, { act: 'edgepick', id: 'citi' });
  await e.f.applyIntent(0, { act: 'edgepick', id: far.id });
  await settle();
  assert.ok(e.ctx.hasEdge('citi', far.id), 'the new road is built');
  assert.equal(S.phase, 'move', 'still moving');
  assert.equal(S.steps, 1, 'it cost 2 movement steps');
  assert.ok(S.backroomAbilityUsed);
});

test('ALL IN ON GREEN: the whole stack, 1 in 37, pays 35x; shares the once-per-turn spin', async t => {
  const { e, S, P } = await game(t);
  S.owner.w_monaco = 0;
  assert.equal(e.ctx.GREEN_PAYS, 35);
  await withRandomSeq([0.01], () => e.f.applyIntent(0, { act: 'black', color: 'green', n: 5 }));
  await settle();
  assert.equal(P[0].money, 50 + 50 * 35, 'zero: the whole stack pays 35 to 1, whatever n said');
  await e.f.applyIntent(0, { act: 'black', n: 10 });
  assert.equal(P[0].money, 1800, 'the green spin was the turn’s spin');
  S.nTurn = {}; P[0].money = 40;
  await withRandomSeq([0.5], () => e.f.applyIntent(0, { act: 'black', color: 'green' }));
  await settle();
  assert.equal(P[0].money, 0, 'not the zero: everything is lost');
});

test('CHAINSAW / BREXIT: clicking the thread itself cuts it, in the action phase and through BACKROOM DEALS', async t => {
  const { e, S, P } = await game(t);
  const edge = e.ctx.EDGES.find(x => e.ctx.cutKeepsBoardConnected(x[0], x[1])).slice();
  S.owner = { w_brexit: 0 };
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'brexit' });
  await e.f.applyIntent(0, { act: 'edgepick', a: edge[0], id: edge[1] });
  await settle();
  assert.ok(!e.ctx.hasEdge(edge[0], edge[1]), 'one click on the thread severs it');
  assert.ok(S.wGame.brexit);
  /* the chainsaw, during movement via BACKROOM DEALS */
  const e2 = e.ctx.EDGES.find(x => e.ctx.cutKeepsBoardConnected(x[0], x[1])).slice();
  S.owner = { back: 0, w_milei: 0 };
  S.cur = 0; S.phase = 'move'; S.mode = null; S.steps = 3; S.backroomAbilityUsed = false; S.wTurn = {};
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'chainsaw' });
  assert.equal(S.mode, 'chainsaw');
  await e.f.applyIntent(0, { act: 'edgepick', a: e2[0], id: e2[1] });
  await settle();
  assert.ok(!e.ctx.hasEdge(e2[0], e2[1]), 'cut during movement');
  assert.equal(S.phase, 'move'); assert.equal(S.steps, 1);
  assert.ok(S.wGame.milei, 'the chainsaw is spent');
});
