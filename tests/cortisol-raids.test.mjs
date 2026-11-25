/*
 * Cortisol and raids — sections 4 (CR-01..CR-09) of docs/CODE_LEVEL_TEST_PLAN.md.
 *
 * The known implementation quirk documented in the plan (positive Cortisol is
 * ignored while the player owns zero or one nodes) is PINNED by CR-01/CR-02 with
 * the caveat in the test names. If the rule is ever changed deliberately, those
 * two tests must be updated together with the tooltip/help copy (RC-04).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeState, CHARS8 } from './helpers/harness.mjs';

async function ctx_engine(t) {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  return engine;
}

/* The raid is invoked from inside the engine module (addCortisol -> raid), so it
   cannot be swapped out from outside any more. Every raid ends with ONE table
   announcement, so the injected announceAll hook is the observation point: it
   counts raids without changing what they do. */
function watchRaids(engine) {
  const calls = [];
  const orig = engine.hooks.announceAll;
  engine.hooks.announceAll = (title, html) => { if (/REGULATOR RAID/.test(title)) calls.push(title); return orig(title, html); };
  return calls;
}
const cortisolLog = S => S.log.filter(l => /Cortisol \(now \d+\)/.test(l)).map(l => +/now (\d+)\)/.exec(l)[1]);

function fixture(engine, over = {}) {
  const S = makeState(engine, over);
  engine.acc.S = S;
  return S;
}

/* ---------- CR-01 / CR-02 — the ownership protection pin ---------- */
test('CR-01 positive Cortisol with zero nodes is ignored by the current implementation', async t => {
  const engine = await ctx_engine(t);
  for (const inc of [1, 2]) {
    const S = fixture(engine, {});
    const before = S.log.length;
    engine.f.addCortisol(0, inc, 'test', false);
    assert.equal(S.players[0].cortisol, 0, 'no Cortisol applied');
    assert.equal(S.log.length, before, 'nothing logged — the change never happened');
  }
});

test('CR-02 positive Cortisol with one node is ignored by the current implementation (rule decision required)', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { owner: { citi: 0 } });
  engine.f.addCortisol(0, 2, 'test', false);
  assert.equal(S.players[0].cortisol, 0, 'the one-node protection is still active');
});

test('CR-02b reduction of Cortisol is never blocked by the ownership protection', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { players: [{ cortisol: 3 }] }); // zero nodes
  engine.f.addCortisol(0, -2, 'cooling off', false);
  assert.equal(S.players[0].cortisol, 1);
});

/* ---------- CR-03 — clamping with multiple nodes ---------- */
test('CR-03 positive Cortisol with multiple nodes accumulates and can never exceed 9', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, {
    owner: { citi: 0, infl: 0 },
    players: [{ cortisol: 0 }],
  });
  engine.f.addCortisol(0, 1, 'a', false);
  engine.f.addCortisol(0, 2, 'b', false);
  assert.equal(S.players[0].cortisol, 3);
  // The clamp to 9 happens inside addCortisol and the raid observes exactly 9 —
  // a value above 9 is never observable (the log line is written before the raid runs).
  const raids = watchRaids(engine);
  engine.f.addCortisol(0, 20, 'large', false);
  assert.equal(raids.length, 1, 'the raid fired exactly once');
  assert.deepEqual(cortisolLog(S).slice(-1), [9], 'and saw the clamped value, never above 9');
  assert.equal(S.players[0].raided, 1, 'the raid applied its own state change');
});


/* ---------- CR-04 — reductions ignore the protection rule ---------- */
test('CR-04 Cortisol reductions floor at zero', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { players: [{ cortisol: 1 }] });
  engine.f.addCortisol(0, -5, 'chill', false);
  assert.equal(S.players[0].cortisol, 0);
});

/* ---------- CR-05 — event modifiers ---------- */
test('CR-05a event-sourced Cortisol is softened by one for Big Bessent or The Jim holders', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { owner: { bess: 0, citi: 0, infl: 0 }, players: [{}, {}] });
  engine.f.addCortisol(0, 3, 'front page', 'event');
  assert.equal(S.players[0].cortisol, 2, '3 − 1 softening');

  const S2 = fixture(engine, { owner: { jim: 0, citi: 0, infl: 0 }, players: [{}, {}] });
  engine.f.addCortisol(0, 3, 'front page', 'event');
  assert.equal(S2.players[0].cortisol, 2, 'The Jim softens identically');
});

test('CR-05b softening can reduce event Cortisol to zero', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { owner: { bess: 0, citi: 0, infl: 0 }, players: [{}, {}] });
  engine.f.addCortisol(0, 1, 'small story', 'event');
  assert.equal(S.players[0].cortisol, 0);
  assert.ok(S.log.some(l => l.includes('no Cortisol at all')));
});

test('CR-05c Herald pays +1 Intel exactly once per event-sourced Cortisol on a rival', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { owner: { herald: 1, citi: 0, infl: 0 }, players: [{ intel: 0 }, { intel: 0 }] });
  engine.f.addCortisol(0, 2, 'story', 'event');
  assert.equal(S.players[1].intel, 1, 'exactly one Intel');
  assert.equal(S.players[0].cortisol, 2);
  // The Herald's own Cortisol events pay nobody.
  const S2 = fixture(engine, { owner: { herald: 1, citi: 0, infl: 0 }, players: [{ intel: 0 }, { intel: 0 }] });
  engine.f.addCortisol(1, 2, 'self story', 'event');
  assert.equal(S2.players[1].intel, 0, 'no self-payment');
});

test('CR-05d non-event Cortisol ignores the softening and Herald effects', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { owner: { bess: 0, herald: 1, citi: 0, infl: 0 }, players: [{}, { intel: 0 }] });
  engine.f.addCortisol(0, 3, 'plain stress', false);
  assert.equal(S.players[0].cortisol, 3, 'no softening without the event flag');
  assert.equal(S.players[1].intel, 0, 'no Herald Intel without the event flag');
});

/* ---------- CR-06 — raid threshold ---------- */
test('CR-06 a raid fires exactly once when Cortisol reaches 9, not earlier', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { owner: { citi: 0, infl: 0 }, players: [{ cortisol: 7 }] });
  const raids = watchRaids(engine);
  engine.f.addCortisol(0, 1, 'stress', false);
  assert.equal(S.players[0].cortisol, 8);
  assert.equal(raids.length, 0, '8 does not raid');
  engine.f.addCortisol(0, 1, 'more stress', false);
  assert.deepEqual(cortisolLog(S).slice(-1), [9], 'reached the threshold');
  assert.equal(raids.length, 1, 'exactly one raid');
  assert.equal(S.players[0].cortisol, 0, 'and the raid reset it');

  // A large jump from 0 also crosses the threshold exactly once.
  const S2 = fixture(engine, { owner: { citi: 0, infl: 0 }, players: [{ cortisol: 0 }] });
  const raids2 = watchRaids(engine);
  engine.f.addCortisol(0, 9, 'one huge beat', false);
  assert.deepEqual(cortisolLog(S2).slice(-1), [9]);
  assert.equal(raids2.length, 1);
  assert.equal(S2.players[0].cortisol, 0);
});

/* ---------- CR-07 — raid side effects ---------- */
test('CR-07 a raid seizes the two highest-income nodes (cost breaks ties), fines, burns Intel, pulls bugs and warns the table', async t => {
  const engine = await ctx_engine(t);
  vm_addFakeNodes(engine);
  const S = fixture(engine, {
    players: [{ money: 100, intel: 6, cortisol: 0 }, { money: 5 }],
    owner: { n1: 0, n2: 0, n3: 0, n4: 0 }, // exactly four owned nodes, incomes 10(5) 10(9) 8 7
    bugs: { foe1: 0, mine: 1 }, // foe1 planted by P0 (pulled); mine planted by P1 (survives)
  });
  engine.acc.Net.role = 'host'; // raids announce to the table
  const expectedFine = Math.max(5, Math.floor(100 * 0.3));
  engine.f.raid(0);
  const p = S.players[0];
  // Top two by (income desc, cost desc): n2 (10,9) then n1 (10,5)
  assert.equal(S.owner.n1, undefined, 'n1 seized');
  assert.equal(S.owner.n2, undefined, 'n2 seized');
  assert.equal(S.owner.n3, 0, 'n3 kept');
  assert.equal(S.owner.n4, 0, 'n4 kept');
  assert.equal(p.money, 100 - expectedFine, 'fine = max($5, 30% of $100) = $30');
  assert.equal(p.intel, 1, 'Intel burned down to 1');
  assert.equal(p.cortisol, 0, 'Cortisol resets to 0');
  assert.equal(p.raided, 1, 'caution flag set');
  assert.deepEqual(S.bugs, { mine: 1 }, 'only bugs planted by the raided player are pulled');
  assert.ok(engine.modalRec.some(m => m.title === '🚨 REGULATOR RAID'), 'the table was announced');
  const raidLog = S.log.find(l => l.startsWith('🚨 REGULATOR RAID'));
  assert.ok(raidLog.includes('RAIDTWO') && raidLog.includes('RAIDONE'), `seize order logs the tie-break: ${raidLog}`);
  assert.ok(raidLog.indexOf('RAIDTWO') < raidLog.indexOf('RAIDONE'), 'higher cost listed first on the income tie');
});

/* ---------- CR-08 — raid with nothing (or one node) to seize ---------- */
test('CR-08 a raid completes on a player who owns nothing worth seizing', async t => {
  const engine = await ctx_engine(t);
  vm_addFakeNodes(engine);
  const S = fixture(engine, { players: [{ money: 10, intel: 2 }] });
  engine.acc.Net.role = 'host';
  assert.doesNotThrow(() => engine.f.raid(0));
  const expectedFine = Math.max(5, Math.floor(10 * 0.3));
  assert.equal(S.players[0].money, 10 - expectedFine, 'fine still applies');
  assert.equal(S.players[0].intel, 1);
  assert.equal(S.players[0].raided, 1);
  assert.equal(S.players[0].cortisol, 0);
  assert.ok(S.log.some(l => l.includes('owns nothing worth seizing')), 'the log explains there was nothing to take');
  assert.ok(engine.modalRec.some(m => m.title === '🚨 REGULATOR RAID'));
});

test('CR-08b a raid on a single owned node takes exactly that node without crash', async t => {
  const engine = await ctx_engine(t);
  vm_addFakeNodes(engine);
  const S = fixture(engine, { players: [{ money: 20, intel: 4, cortisol: 5 }], owner: { n3: 0 } });
  assert.doesNotThrow(() => engine.f.raid(0));
  assert.equal(S.owner.n3, undefined, 'the single node was taken');
  const p = S.players[0];
  assert.equal(p.money, 20 - Math.max(5, Math.floor(20 * 0.3)));
  assert.equal(p.intel, 1);
  assert.equal(p.raided, 1);
  assert.ok(S.log.some(l => !l.includes('owns nothing worth seizing') && l.includes('REGULATOR RAID')));
});


/* ---------- CR-09 — the recovery turn ---------- */
test('CR-09 the turn after a raid pays no income and one step; the turn after that is normal', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, {
    owner: { oil: 0, quik: 0 }, // income 8 + 2 → holdings 10; salary 3
    players: [{ money: 0, intel: 0, cortisol: 0, raided: 1 }],
    deck: ['quiet', 'quiet'],
  });
  engine.f.startTurn();
  await new Promise(r => setImmediate(r));
  const p = S.players[0];
  assert.equal(p.money, 0, 'no income under caution');
  assert.equal(S.steps, 1, 'a single movement step');
  assert.equal(p.raided, 0, 'caution cleared after the turn starts');
  assert.equal(S.caution, true, 'the turn is flagged as under caution');

  // The next turn is a normal one: salary $3 + holdings $10 (oil 8 + Quikstop 2).
  // (Market events are drawn at endOfTurn, not in startTurn, so no +2 here.)
  S.over = false;
  S.cur = 0;
  engine.f.startTurn();
  await new Promise(r => setImmediate(r));
  assert.equal(S.caution, false);
  assert.equal(p.money, 3 + 10 + 2, 'salary $3 + holdings $10 + the Servo ($2 x 1 player)');
  assert.equal(S.steps, 3, 'three base steps with no movement synergies');
});

/* helper: append fake raid-target nodes for the CR-07/CR-08 fixtures.
   NODES/NMAP are live exports of the data module, so pushing real objects into
   the arrays is all it takes. */
function vm_addFakeNodes(engine) {
  const { NODES, NMAP } = engine.acc;
  if (NMAP.n1) return;
  const fakes = [
    { id: 'n1', name: ['RAIDONE'], type: 'WILD', income: 10, cost: 5, x: 100, y: 100, rot: 0 },
    { id: 'n2', name: ['RAIDTWO'], type: 'WILD', income: 10, cost: 9, x: 100, y: 100, rot: 0 },
    { id: 'n3', name: ['RAIDTHREE'], type: 'WILD', income: 8, cost: 3, x: 100, y: 100, rot: 0 },
    { id: 'n4', name: ['RAIDFOUR'], type: 'WILD', income: 7, cost: 5, x: 100, y: 100, rot: 0 },
    { id: 'abund', name: ['UNSEIZABLE'], type: 'WILD', income: 11, cost: 1, x: 100, y: 100, rot: 0 },
  ];
  for (const n of fakes) { NODES.push(n); NMAP[n.id] = n; }
}
