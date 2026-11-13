/*
 * Economy and victory — section 5 (EC-01..EC-08) of docs/CODE_LEVEL_TEST_PLAN.md.
 * MADE payouts, Sisyphus growth, income composition/timing, the victory
 * predicate and ACCC concentration files. Randomness is controlled via value
 * sequences so every outcome is deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadEngine, makeState, withSeed, withRandomSeq, pump,
} from './helpers/harness.mjs';

async function ctx_engine(t) {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  return engine;
}
function fixture(engine, over = {}) {
  const S = makeState(engine, over);
  engine.acc.S = S;
  return S;
}

/* ================= EC-01 / EC-02 — MADE ================= */
test('EC-01 MADE pays its owner $10 and 1 Intel, and takes 15% only from rich multi-holders', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, {
    owner: { made: 0, citi: 1, commbank: 1, anz: 1 }, // P1 holds exactly three real nodes
    players: [
      { money: 0, intel: 0 },   // owner
      { money: 100, intel: 0 }, // rich + 3 nodes → pays 15% (floor of $15)
      { money: 20 },            // poor: below $50
    ],
  });
  engine.f.madePay();
  assert.equal(S.players[0].money, 10);
  assert.equal(S.players[0].intel, 1);
  assert.equal(S.players[1].money, 100 - Math.floor(100 * 0.15), 'floor(15) = $15');
  assert.equal(S.players[2].money, 20, 'poorer players do not pay');
});

test('EC-02 MADE edge cases: no owner, $49/$50, 2/3/4 nodes, maximum resources', async t => {
  const engine = await ctx_engine(t);
  // No owner: nothing happens at all.
  const S0 = fixture(engine, { players: [{ money: 100, intel: 5 }] });
  engine.f.madePay();
  assert.equal(S0.players[0].money, 100);
  assert.equal(S0.players[0].intel, 5);

  const cases = [
    { name: '$50 with exactly 3 nodes pays the floor of 15%', nodes: ['citi', 'commbank', 'anz'], money: 50, cut: 7 },
    { name: 'exactly 2 nodes never pays', nodes: ['citi', 'commbank'], money: 500, cut: 0 },
    { name: '$49 never pays even with 4 nodes', nodes: ['citi', 'commbank', 'anz', 'rba'], money: 49, cut: 0 },
    { name: 'maximum resources pay floor(15%) of the whole book', nodes: ['citi', 'commbank', 'anz'], money: 1000, cut: 150 },
  ];
  for (const c of cases) {
    const owner = { made: 1 };
    c.nodes.forEach(id => { owner[id] = 0; });
    const S = fixture(engine, { owner, players: [{ money: c.money }, { money: 0, intel: 0 }] });
    engine.f.madePay();
    assert.equal(S.players[0].money, c.money - c.cut, c.name);
  }
});

/* ================= EC-03 — Sisyphus ================= */
test('EC-03 repeated pushes double the payout and cost no Cortisol; the growth is uncapped', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, {
    owner: { sisy: 0, citi: 0, infl: 0 }, // 2+ nodes keeps the Cortisol protection satisfied
    players: [{ pos: 'sisy', money: 0, intel: 0, cortisol: 0 }],
    goal: 999,
    deck: Array.from({ length: 30 }, () => 'quiet'),
  });
  const pushes = 10;
  for (let i = 0; i < pushes; i++) {
    S.phase = 'action'; // startTurn flips the phase back to 'move' between pushes
    await engine.f.applyIntent(0, { act: 'push' });
    await pump();
    assert.equal(S.players[0].cortisol, 0, `push ${i}: no Cortisol cost`);
    assert.equal(S.sisyPayout, 10 * Math.pow(2, i + 1), `push ${i}: payout doubles exactly`);
  }
  // Uncapped growth: after 10 pushes the payout is $10,240 and nothing resets it.
  assert.equal(S.sisyPayout, 10240);
  assert.ok(!engine.consoleOut.error.length, 'no engine errors across the long run');
});

test('EC-03b a push pays the current doubling amount to the pusher', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, {
    owner: { sisy: 0, citi: 0, infl: 0 },
    players: [{ pos: 'sisy', money: 0, intel: 0 }],
    goal: 999,
    deck: Array.from({ length: 8 }, () => 'quiet'),
  });
  S.phase = 'action';
  const before = S.players[0].money;
  await engine.f.applyIntent(0, { act: 'push' });
  await pump();
  assert.equal(S.sisyPayout, 20, 'the next push is $20');
  assert.ok(S.log.some(l => l.includes('pushed the boulder uphill')), 'the push is recorded');
  // money: push +$10, the quiet-quarter event +$2 (x10 at this $999 table), and the automatic next turn
  // pays income (salary $4 — infl is owned — + holdings citi 3 + infl 1 + sisy 0).
  assert.equal(S.players[0].money, before + 10 + 20 + (4 + 3 + 1));
});

/* ================= EC-04 — passive income and synergies ================= */
test('EC-04a baseline salary and plain node income', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { players: [{}] });
  assert.equal(S.players[0].money, 0);
  engine.f.income(0);
  assert.equal(S.players[0].money, 3, 'salary $3');

  const S2 = fixture(engine, { owner: { oil: 0 }, players: [{}] });
  engine.f.income(0);
  assert.equal(S2.players[0].money, 3 + 8, 'oil pays $8/turn');
});

test('EC-04b the IB Diploma doubles chart income; the master chart adds $3 per extra chart', async t => {
  const engine = await ctx_engine(t);
  // ib is owned too: it is a WILD node with income 1 that does NOT double itself.
  // infl raises the salary to $4 (it is also a chart).
  const S = fixture(engine, { owner: { ib: 0, tenyear: 0, infl: 0, stock: 0 }, players: [{}] });
  engine.f.income(0);
  assert.equal(S.players[0].money, 4 + (2 * (1 + 1 + 1) + 1) + 3 * (3 - 1), 'salary 4 + doubled charts 6 + ib 1 + master 6');
});

test('EC-04c headline synergies each apply exactly once', async t => {
  const engine = await ctx_engine(t);
  const cases = [
    { owner: { citi: 0, coal: 0, quik: 0, market: 0 }, keep: 'citi $1/sp CORPORATE + anchor stores pair', expect: 3 + (3 + 3 + 2 + 2) + 3 + 2 },
    { owner: { commbank: 0, anz: 0 }, keep: 'the big four stick together', expect: 3 + (2 + 2) + 2 },
    { owner: { westpac: 0, rba: 0 }, keep: 'westpac $1/s REGULATOR', expect: 3 + (2 + 2) + 1 },
    { owner: { anz: 0, tenyear: 0, infl: 0 }, keep: 'anz reads charts + master bonus + salaried infl', expect: 4 + (2 + 1 + 1) + 2 + 3 },
    { owner: { barrels: 0, forklift: 0, oil: 0 }, keep: 'forklift $1/s COMMODITY + pair', expect: 3 + (2 + 1 + 8) + 3 + 1 },
    { owner: { market: 0, quik: 0 }, keep: 'anchor tenant pair +$2', expect: 3 + (2 + 2) + 2 },
    { owner: { rock: 0, oil: 0, citi: 0 }, keep: 'rock: $1 per DIFFERENT type', expect: 3 + (1 + 8 + 3) + 3 },
    { owner: { bessent: 0, citi: 0 }, keep: 'bessent $1/s BANK', expect: 3 + (1 + 3) + 1 },
    { owner: { watson: 0, coal: 0 }, keep: 'watson+coal pair +$2', expect: 3 + (0 + 3) + 2 },
    { owner: { mpc: 0, tenyear: 0, cash: 0 }, keep: 'mpc $1/s CHART + master bonus', expect: 3 + (1 + 1 + 1) + 2 + 3 },
  ];
  for (const c of cases) {
    const S = fixture(engine, { owner: c.owner, players: [{ money: 0 }] });
    engine.f.income(0);
    assert.equal(S.players[0].money, c.expect, c.keep);
  }
});

test('EC-04d the market mood pays — and taxes — the right node types', async t => {
  const engine = await ctx_engine(t);
  const boom = fixture(engine, { owner: { oil: 0, forklift: 0 }, mood: 'BOOM', players: [{}] });
  engine.f.income(0);
  assert.equal(boom.players[0].money, 3 + (8 + 1) + 2 + 2, 'BOOM: +$1 per commodity AND the forklift synergy');

  const frenzy = fixture(engine, { owner: { press: 0, fox: 0 }, mood: 'FRENZY', players: [{}] });
  engine.f.income(0);
  assert.equal(frenzy.players[0].money, 3 + (2 + 2) + 2, 'FRENZY: +$1 per media node');

  const panic = fixture(engine, { owner: { citi: 0, hedge: 0 }, mood: 'PANIC', players: [{}] });
  engine.f.income(0);
  assert.equal(panic.players[0].money, 3 + (3 + 2) - 2, 'PANIC: banks bleed -$1 each');

  const calm = fixture(engine, { owner: { oil: 0 }, mood: 'CALM', players: [{}] });
  engine.f.income(0);
  assert.equal(calm.players[0].money, 3 + 8 + 0, 'CALM: no modifier');
});

test('EC-04e bug skims pay $1/turn, or $2 with the World Economic Forum', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { owner: { oil: 1, gold: 1 }, bugs: { oil: 0, gold: 0 }, players: [{}, {}] });
  engine.f.income(0);
  assert.equal(S.players[0].money, 3 + 1 + 1, 'salary + two $1 skims');

  const S2 = fixture(engine, { owner: { oil: 1, wef: 0 }, bugs: { oil: 0 }, players: [{}, {}] });
  engine.f.income(0);
  assert.equal(S2.players[0].money, 3 + 2 + 2, 'salary + the WEF\'s own $2 + one $2 skim (WEF doubles)');
});

test('EC-04f inflation compensation raises the salary to $4 (and the chart itself pays)', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { owner: { infl: 0 }, players: [{}] });
  engine.f.income(0);
  assert.equal(S.players[0].money, 4 + 1);
});

/* ================= EC-05 — income timing ================= */
test('EC-05 income is paid in startTurn only: not on sync, not on adoptState, skipped under caution', async t => {
  const engine = await ctx_engine(t);
  const S = fixture(engine, { owner: { oil: 0 }, players: [{ money: 0, raided: 1 }], deck: ['quiet'] });
  engine.f.startTurn();
  await new Promise(r => setImmediate(r));
  assert.equal(S.players[0].money, 0, 'raided turn: skipped');
  assert.equal(S.caution, true);

  // Duplicated state delivery never pays again.
  const before = JSON.parse(JSON.stringify(S.players));
  engine.f.sync();
  engine.f.sync();
  engine.f.flushState();
  assert.deepEqual(JSON.parse(JSON.stringify(S.players)), before, 'sync does not award income');

  // Arrival of a (public) state on the wire does not award income either.
  const pub = engine.f.pubState(true);
  engine.f.adoptState(JSON.parse(JSON.stringify(pub)));
  assert.equal(engine.acc.S.players[0].money, S.players[0].money, 'adoptState is a transfer, not a payout');
});

/* ================= EC-06 / EC-07 — the victory predicate ================= */
const WIN_NODE_IDS = { BANK: 'citi', REGULATOR: 'rba', CHART: 'infl', WILD: 'term', CORPORATE: 'coal', COMMODITY: 'oil', MEDIA: 'press' };

function winFixture(engine, goal, params = {}) {
  const owner = {};
  for (const t of engine.acc.WIN_TYPES) {
    if (t !== params.missing) owner[WIN_NODE_IDS[t]] = params.holder ?? 0;
  }
  return fixture(engine, {
    owner,
    players: [{ money: params.money ?? goal }],
    goal,
  });
}

test('EC-06 one owned node of each type satisfies it; missing any one type blocks victory', async t => {
  const engine = await ctx_engine(t);
  engine.acc.Net.role = 'host';
  for (const missing of engine.acc.WIN_TYPES) {
    const S = winFixture(engine, 100, { missing, money: 100 });
    const missingTypes = engine.acc.WIN_TYPES.filter(t => !engine.acc.NODES.some(n => n.type === t && S.owner[n.id] === 0));
    const won = await win_run(engine, S);
    assert.equal(won, false, `missing ${missing} blocks the win`);
    assert.deepEqual([...missingTypes], [missing], `exactly ${missing} is missing`);
    assert.equal(S.over, false, `no game-over flag for ${missing}`);
  }
  // All seven types at threshold → wins.
  const S = winFixture(engine, 100, { money: 100 });
  assert.equal(await win_run(engine, S), true);
  assert.equal(S.over, true);
});

test('EC-07 cash threshold: one below fails, exactly at wins; the richest simultaneous candidate wins; post-over intents rejected', async t => {
  const engine = await ctx_engine(t);
  engine.acc.Net.role = 'host';

  const below = winFixture(engine, 100, { money: 99 });
  assert.equal(await win_run(engine, below), false);
  assert.equal(below.over, false);

  const at = winFixture(engine, 100, { money: 100 });
  assert.equal(await win_run(engine, at), true);

  // Only QUALIFYING players can win: a richer player without the full set of
  // types does not win over a poorer player who has it. There is a single
  // REGULATOR node (rba), so the full set is handed to the poorer candidate.
  const tie = fixture(engine, {
    owner: {
      citi: 0, rba: 0, infl: 0, term: 0, coal: 0, oil: 0, press: 0, // P0: full set, $120
      commbank: 1, cash: 1, school: 1, quik: 1, gold: 1, fox: 1,    // P1: six of seven types, $200
    },
    players: [{ money: 120 }, { money: 200 }],
    goal: 100,
  });
  assert.equal(await win_run(engine, tie), true);
  assert.equal(tie.over, true);
  const winnerLine = tie.log.find(l => l.startsWith('🏆'));
  assert.ok(winnerLine && winnerLine.includes('P0'), `the $120 full-set player wins: ${winnerLine}`);

  // After victory, further intents are rejected without crashing or mutating.
  const snap = JSON.parse(JSON.stringify({ m: tie.players.map(p => p.money), o: tie.owner }));
  await engine.f.applyIntent(0, { act: 'favor' });
  await pump();
  assert.deepEqual(JSON.parse(JSON.stringify({ m: tie.players.map(p => p.money), o: tie.owner })), snap,
    'no mutation after game over');

  // Divestment after near-victory blocks the automatic win.
  const S = winFixture(engine, 100, { money: 100 });
  delete S.owner.press; // lose MEDIA
  assert.equal(await win_run(engine, S), false);
});

async function win_run(engine, S) {
  return Boolean(await engine.f.winCheck());
}

/* ================= EC-08 — ACCC concentration: public files, no dice ================= */
function hostMode(engine) { engine.acc.Net.role = 'host'; }
const alerts = (engine, title = 'MONOPOLY ALERT') => engine.modalRec.filter(m => m.title === title).length;
const ofType = (engine, type) => engine.acc.NODES.filter(n => n.type === type);
const keepOrder = (a, b) => b.income - a.income || b.cost - a.cost;

test('EC-08 the trigger scales with industry size on the live board (base and Geography DLC)', async t => {
  const engine = await ctx_engine(t);
  const trig = id => engine.f.industryTrigger(engine.acc.INDBYID[id]);
  const sizes = () => Object.fromEntries(['bank', 'regulator', 'corporate', 'commodity', 'media']
    .map(id => [id, engine.f.industryNodes(engine.acc.INDBYID[id]).length]));
  for (const geo of [false, true]) {
    engine.f.rebuildWorld(geo);
    const sz = sizes();
    for (const id of Object.keys(sz)) assert.equal(trig(id), Math.max(3, Math.ceil(sz[id] / 3)), `${geo ? 'DLC' : 'base'} ${id} (${sz[id]} nodes)`);
    for (const id of ['coal', 'oil', 'education', 'jtportal', 'chalmers', 'bessent', 'monetary']) assert.equal(trig(id), 3, `themed ${id} triggers at 3`);
  }
  engine.f.rebuildWorld(true);
  assert.equal(ofType(engine, 'MEDIA').length, 12); assert.equal(trig('media'), 4, '12 media allow three, trigger at four');
  assert.equal(ofType(engine, 'COMMODITY').length, 11); assert.equal(trig('commodity'), 4, '11 commodities allow three, trigger at four');
  assert.equal(trig('bank'), 3); assert.equal(trig('regulator'), 3);
  engine.f.rebuildWorld(false);
  assert.equal(trig('media'), 4, 'base board: 11 media → 4');
  assert.equal(trig('commodity'), 4, 'base board: 10 commodities → 4');
  assert.equal(trig('regulator'), 3, 'base board: 4 regulators → 3');
});

test('EC-08a below the trigger never opens a file; charts outside a themed list never count', async t => {
  const engine = await ctx_engine(t);
  hostMode(engine);
  const media = ofType(engine, 'MEDIA').map(n => n.id).filter(id => !['press', 'jim', 'herald', 'bess'].includes(id));
  const cases = [
    { keep: 'two BANK nodes', owner: { citi: 0, commbank: 0 } },
    { keep: 'four plain CHART nodes', owner: { us: 0, japan: 0, uk: 0, aus: 0 } },
    { keep: 'three MEDIA nodes (11 on the board — three are allowed)', owner: Object.fromEntries(media.slice(0, 3).map(id => [id, 0])) },
  ];
  for (const c of cases) {
    const S = fixture(engine, { owner: c.owner, players: [{ money: 100, intel: 10 }, { money: 0 }] });
    engine.f.acccReconcile();
    assert.deepEqual(S.acccFiles, [], c.keep);
    await engine.f.acccReview(0); await engine.f.acccReview(0); await engine.f.acccReview(0);
    assert.equal(S.players[0].money, 100, c.keep);
    assert.equal(alerts(engine), 0, c.keep);
  }
  const S = fixture(engine, { owner: Object.fromEntries(media.slice(0, 4).map(id => [id, 0])), players: [{ money: 100 }, { money: 0 }] });
  engine.f.acccReconcile();
  assert.equal(S.acccFiles.length, 1, 'the fourth MEDIA node opens the file');
  assert.deepEqual({ ...S.acccFiles[0] }, { pi: 0, ind: 'media', s: 0, agency: 'ACCC' });
});

test('EC-08b a file opens, advances +1 at each of the offender\'s turn starts, and rules at 3 — no dice', async t => {
  const engine = await ctx_engine(t);
  hostMode(engine);
  const S = fixture(engine, {
    owner: { citi: 0, commbank: 0, nab: 0, oil: 1 },
    players: [{ money: 100, intel: 10 }, { money: 0, intel: 0 }, { money: 0, intel: 0 }],
  });
  engine.f.acccReconcile();
  const f = engine.f.findFile(0, 'bank');
  assert.ok(f && f.s === 0 && f.agency === 'ACCC', 'three banks open a public ACCC file at scrutiny 0');
  assert.ok(S.log.some(l => l.includes('OPENS A FILE') && l.includes('BANKING')), 'the opening is on the record');
  /* every random draw is a hit under the old rule — the new one never reads it */
  await withRandomSeq([0.01], () => engine.f.acccReview(0));
  assert.equal(engine.f.findFile(0, 'bank').s, 1);
  await withRandomSeq([0.01], () => engine.f.acccReview(0));
  assert.equal(engine.f.findFile(0, 'bank').s, 2);
  assert.equal(S.owner.citi, 0, 'nothing is ruled before scrutiny 3');
  assert.ok(S.log.some(l => l.includes('advances — scrutiny 2/3')), 'the advance is on the record');
  /* a rival's turn start never touches this file */
  await engine.f.acccReview(1);
  assert.equal(engine.f.findFile(0, 'bank').s, 2, 'only the offender\'s own turn start advances it');
  await engine.f.acccReview(0);
  assert.equal(alerts(engine), 1, 'the ruling is announced to the table');
  assert.equal(engine.f.findFile(0, 'bank'), null, 'the file closes after the ruling');
  assert.equal(engine.f.ownedInIndustry(0, engine.acc.INDBYID.bank).length, 2, 'only the excess is divested');
  assert.equal(S.owner.oil, 1, 'other holdings are untouched');
});

test('EC-08c the offender chooses what to keep; the fine is 10% per divested node; divested nodes return unowned', async t => {
  const engine = await ctx_engine(t);
  hostMode(engine);
  const S = fixture(engine, {
    owner: { citi: 0, commbank: 0, nab: 0, anz: 0 },
    players: [{ money: 100, intel: 10 }, { money: 0, intel: 0 }, { money: 0, intel: 0 }],
  });
  engine.f.acccReconcile();
  engine.f.findFile(0, 'bank').s = 2;
  engine.queueModal('citi'); engine.queueModal('anz'); // the offender picks both nodes to give up
  await engine.f.acccReview(0);
  const prompts = engine.modalRec.filter(m => m.title.startsWith('ACCC RULING'));
  assert.equal(prompts.length, 2, 'one private prompt per excess node');
  assert.equal(S.owner.citi, undefined, 'chosen node divested');
  assert.equal(S.owner.anz, undefined, 'chosen node divested');
  assert.equal(S.owner.commbank, 0, 'kept');
  assert.equal(S.owner.nab, 0, 'kept');
  assert.equal(S.players[0].money, 80, '2 excess → 20% cash fine');
  assert.equal(S.players[0].intel, 8, '2 excess → 20% Intel fine');
  assert.ok(!Object.values(S.owner).some(o => o === 1 || o === 2), 'nothing is gifted to rivals');
});

test('EC-08d the fine caps at 30%, and the default keeps the highest-income nodes (ties by cost)', async t => {
  const engine = await ctx_engine(t);
  hostMode(engine);
  const media = ofType(engine, 'MEDIA').slice(0, 8);
  const S = fixture(engine, {
    owner: Object.fromEntries(media.map(n => [n.id, 0])),
    players: [{ money: 100, intel: 20 }, { money: 0 }],
  });
  engine.f.acccReconcile();
  engine.f.findFile(0, 'media').s = 2;
  await engine.f.acccReview(0); // nothing queued: every prompt takes its default
  const keep = media.slice().sort(keepOrder).slice(0, 3).map(n => n.id).sort();
  const held = engine.f.ownedInIndustry(0, engine.acc.INDBYID.media).map(n => n.id).sort();
  assert.deepEqual(held, keep, 'the three highest-income MEDIA nodes are kept');
  assert.equal(S.players[0].money, 70, '5 excess nodes still fine only 30% of cash');
  assert.equal(S.players[0].intel, 14, '…and 30% of Intel');
  assert.ok(media.every(n => S.owner[n.id] === 0 || S.owner[n.id] === undefined), 'nothing gifted');
});

test('EC-08e a file closes the moment the book drops back, and reopens fresh at 0', async t => {
  const engine = await ctx_engine(t);
  hostMode(engine);
  const S = fixture(engine, { owner: { coal: 0, train: 0, port: 0 }, players: [{ money: 100, intel: 10 }, { money: 0 }] });
  engine.f.acccReconcile();
  engine.f.findFile(0, 'coal').s = 2;
  engine.f.strikeNode(1, 'port'); // a missile here; a raid, takeover or sale work the same way
  assert.equal(engine.f.findFile(0, 'coal'), null, 'the strike’s own sync reconciles the file closed — nobody had to hook it');
  assert.ok(S.log.some(l => l.includes('CASE CLOSED')), 'the closing is on the record');
  delete S.rubble.port; S.owner.port = 0;
  engine.f.acccReconcile();
  assert.equal(engine.f.findFile(0, 'coal').s, 0, 'scrutiny was discarded — a fresh file starts at 0');
});

test('EC-08g Mark Watson exempts the COAL book only — and buying him closes an open coal file', async t => {
  const engine = await ctx_engine(t);
  hostMode(engine);
  const S = fixture(engine, { owner: { watson: 0, coal: 0, train: 0, port: 0 }, players: [{ money: 100, intel: 10 }, { money: 0 }] });
  engine.f.acccReconcile();
  assert.equal(engine.f.findFile(0, 'coal'), null, 'four COAL nodes with Watson: no file');
  for (let i = 0; i < 4; i++) await engine.f.acccReview(0);
  assert.equal(S.players[0].money, 100); assert.equal(alerts(engine), 0);
  delete S.owner.watson;
  engine.f.acccReconcile();
  assert.ok(engine.f.findFile(0, 'coal'), 'without Watson the coal book is filed');
  S.owner.watson = 0;
  engine.f.acccReconcile();
  assert.equal(engine.f.findFile(0, 'coal'), null, 'Watson\'s arrival closes it');
  /* Watson alone, or with other industries, is no offence and exempts nothing else */
  const S2 = fixture(engine, { owner: { watson: 0, citi: 0, commbank: 0, nab: 0 }, players: [{ money: 50 }, { money: 0 }] });
  engine.f.acccReconcile();
  assert.ok(engine.f.findFile(0, 'bank'), 'Watson does not cover BANKING');
  assert.equal(S2.acccFiles.length, 1);
});

test('EC-08f overlapping books: a ruling that drops a shared node closes the other file too', async t => {
  const engine = await ctx_engine(t);
  hostMode(engine);
  // EDUCATION = school, ib, mpc; MONETARY POLICY = mpc, rba, cash, bullock, infl
  const S = fixture(engine, { owner: { school: 0, ib: 0, mpc: 0, rba: 0, cash: 0 }, players: [{ money: 100, intel: 0 }, { money: 0 }] });
  engine.f.acccReconcile();
  assert.ok(engine.f.findFile(0, 'education') && engine.f.findFile(0, 'monetary'), 'two files, one per book');
  assert.equal(engine.f.findFile(0, 'monetary').agency, 'ASIC');
  S.acccFiles.forEach(f => { f.s = 2; });
  engine.queueModal('mpc');
  await engine.f.acccReview(0);
  assert.equal(S.owner.mpc, undefined, 'the shared node goes');
  assert.equal(alerts(engine), 1, 'one ACCC ruling');
  assert.equal(alerts(engine, 'ASIC MARKET MANIPULATION'), 0, 'the ASIC file closed with it — no second ruling');
  assert.deepEqual(S.acccFiles, []);
  assert.equal(S.players[0].money, 90, 'one excess node, 10%');
});

/* ================= EC-20 — event-card dollars scale with the goal ================= */
test('EC-20 event-card dollars scale with the table goal and never drop below $1', async t => {
  const engine = await ctx_engine(t);
  for (const c of [{ goal: 100, quiet: 2, oil: 6, pump: 1 }, { goal: 300, quiet: 6, oil: 18, pump: 3 }, { goal: 20, quiet: 1, oil: 1, pump: 1 }]) {
    const S = fixture(engine, { owner: { oil: 0 }, players: [{ money: 50 }, { money: 50 }], goal: c.goal });
    assert.equal(engine.f.cs(2), c.quiet, `goal ${c.goal}: cs(2)`);
    await engine.acc.CARDBYID.quiet.run();
    assert.deepEqual(S.players.map(p => p.money), [50 + c.quiet, 50 + c.quiet], `goal ${c.goal}: a quiet quarter pays $${c.quiet}`);
    const before = S.players.map(p => p.money);
    await engine.acc.CARDBYID.oilspike.run();
    assert.equal(S.players[0].money - before[0], c.oil - c.pump, `goal ${c.goal}: crude windfall less the pump`);
    assert.equal(S.players[1].money - before[1], -c.pump, `goal ${c.goal}: the pump charge`);
    const face = engine.f.cardFace(engine.acc.CARDBYID.rates);
    assert.ok(face.includes('everyone pays $' + engine.f.cs(2) + ','), `goal ${c.goal}: the card face quotes the scaled amount`);
  }
});
