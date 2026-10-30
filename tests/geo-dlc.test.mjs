/*
 * 🌍 GEOGRAPHY DLC — section GD of docs/CODE_LEVEL_TEST_PLAN.md.
 *
 * Eleven extra island exhibits, host-toggled in the lobby. The suite runs against
 * the same engine contract as the base game: rebuildWorld flips the node set,
 * applyIntent gains ten actions, startTurn/income gain passives.
 *
 * Behaviour tests use the controlled `quiet` deck (each event +$2 to every
 * player) exactly like rules-consistency: action ⇒ quiet (+2 both) ⇒ next
 * seat's startTurn (salary 3 + owned-node income), where the chain stops —
 * the next seat is left awaiting movement, so per action the rival collects
 * one quiet + one startTurn income and the actor only pays and takes quiet.
 * Flag resets live at startTurn, so each test re-arms deterministically.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, makeGame, makeConn, makeState, withSeed, withSeedAsync, makeRng, bfs, SOURCE, repoRoot } from './helpers/harness.mjs';

const engineFor = t => { const e = loadEngine(); t.after(() => e.dispose()); return e; };
async function settle() {
  for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
}
const quietDeck = S => { S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = []; };
const armAction = engine => { const S = engine.acc.S; S.cur = 0; S.phase = 'action'; S.mode = null; };
/* Boots a host game with the DLC flag on and a quiet deck. Seat 0 = host. */
async function geoGame(t, n = 2) {
  const e = engineFor(t);
  const S = await makeGame(e, n, { geo: true });
  assert.equal(e.acc.Net.myIdx, 0);
  quietDeck(S);
  return { e, S: e.acc.S };
}

/* ================= GD-01 — the world rebuilds both ways ================= */
test('GD-01 rebuildWorld(false) mirrors the classic 70-exhibit world; (true) deals the DLC islands', t => {
  const e = engineFor(t);
  const acc = e.acc;
  assert.equal(acc.NODES.length, 70, 'the base world loads at 70');
  assert.equal(acc.WORLD_GEO, false);
  assert.ok(!acc.NMAP.geo_pillars, 'no DLC pins before the toggle');
  assert.equal(acc.HIGH_VALUE_NODE_IDS.has('geo_pillars'), false);

  e.f.rebuildWorld(true);
  assert.equal(acc.NODES.length, 82, '82 exhibits with the DLC on');
  assert.equal(acc.WORLD_GEO, true);
  for (const id of acc.GEO_NODE_IDS) assert.ok(acc.NMAP[id], `DLC pin dealt: ${id}`);
  for (const id of acc.GEO_HIGH_VALUE_IDS) assert.ok(acc.HIGH_VALUE_NODE_IDS.has(id), `${id} seeded far out`);
  const pairs = new Set(acc.EDGES.map(ed => [...ed].sort().join('|')));
  for (const [a, b] of acc.GEO_EDGES) {
    const key = [a, b].sort().join('|');
    assert.ok(pairs.has(key), `DLC edge ${key} present with the flag on`);
  }
  assert.equal(acc.WORLD_EDGES.length, acc.CLEAN_EDGES.length + acc.GEO_EDGES.length);

  e.f.rebuildWorld(false);
  assert.equal(acc.NODES.length, 70, 'the toggle backs the board down to 70');
  assert.equal(acc.WORLD_GEO, false);
  assert.ok(!acc.NMAP.geo_missile, 'the pins come back off');
  assert.equal(Object.keys(acc.NMAP).length, 70, 'NMAP rebuilt, not accumulated');
  assert.equal(acc.HIGH_VALUE_NODE_IDS.has('geo_pillars'), false, 'high-value set rebuilt, not accumulated');
});

test('GD-01b every GEOGRAPHY node is structurally complete with a shipped asset', t => {
  const e = engineFor(t);
  e.f.rebuildWorld(true);
  for (const n of e.acc.GEO_NODES) {
    assert.ok(Array.isArray(n.name) && n.name.length >= 1, `${n.id}: name lines`);
    assert.equal(typeof n.income, 'number', `${n.id}: numeric income`);
    assert.equal(typeof n.cost, 'number', `${n.id}: numeric cost`);
    assert.ok(e.acc.WIN_TYPES.includes(n.type), `${n.id}: type ${n.type} is a win type`);
    assert.ok(n.image.startsWith('./static/GeographyDLC/'), `${n.id}: image lives in the DLC folder`);
    assert.ok(fs.existsSync(path.join(repoRoot, n.image.replace(/^\.\//, ''))), `${n.id}: ${n.image} exists on disk`);
    assert.ok(typeof n.sp === 'string' && n.sp.length > 40, `${n.id}: has power copy`);
  }
  assert.equal(e.acc.GEO_NODES.length, 12, 'twelve islands, no more, no fewer');
  assert.equal(new Set(e.acc.GEO_NODES.map(n => n.id)).size, 12, 'and no duplicate ids');
});

/* ================= GD-02 — the DLC world deals a connected 80-pin board ================= */
test('GD-02 with the toggle on, initGame deals 80 pins and every seed keeps the board connected', async t => {
  const seeds = [77, 78, 79, 80, 81, 82, 83, 84];
  for (const seed of seeds) {
    const e = engineFor(t);
    e.acc.Net.dlcGeo = true;
    withSeed(seed, () => e.f.initGame([{ name: 'A', char: 'markwatson' }, { name: 'B', char: 'tomkins' }]));
    const S = e.acc.S;
    assert.equal(S.dlcGeo, true, 'the flag rides with the state');
    assert.equal(e.acc.NODES.length, 82, '82 pins dealt');
    assert.equal(Object.keys(S.rubble).length, 0, 'a fresh world has no rubble');
    assert.ok(S.log.some(l => l.includes('GEOGRAPHY DLC')), 'the table is told the DLC is live');
    const reached = bfs(e.acc.ADJ, 'quik');
    for (const id of e.acc.GEO_NODE_IDS) {
      assert.ok(reached.has(id), `seed ${seed}: ${id} reachable from Quikstop`);
    }
    assert.equal(reached.size, 82, `seed ${seed}: the whole board is walkable`);
    e.dispose();
  }
});

/* ================= GD-03..GD-05 — MISSILE COMMAND ================= */
test('GD-03 the missile expropriates an owned node: no payout, rubble, once per turn', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_missile = 0;
  S.players[0].pos = 'geo_missile';      // the silo only fires from the pad
  S.owner.oil = 1;                       // the rival's prize asset
  S.players[0].money = 20; S.players[0].intel = 3;
  S.players[1].money = 40;
  armAction(e);
  await e.f.applyIntent(0, { act: 'missilemode' });
  assert.equal(S.mode, 'missile', 'the launch console arms');
  /* The launch cost is paid at the pad; the impact lands after the flight —
     the virtual clock advances the pause the host holds for the warhead, and
     the end-of-turn chain (the quiet quarter) follows the impact. */
  const strike = e.f.applyIntent(0, { act: 'missile', id: 'oil' });
  assert.equal(S.players[0].money, 20 - 4, '−$4 launch cost at the pad');
  assert.equal(S.players[0].intel, 2, '−1 Intel launch cost');
  assert.equal(S.geoMissiled, true, 'one missile per turn');
  e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); /* the flight plays, then the impact lands */
  await strike;
  await settle();
  assert.equal(S.owner.oil, undefined, 'the pin is expropriated — nobody owns it');
  assert.equal(S.rubble.oil, 1, 'and it is rubble');
  assert.ok(S.log.some(l => l.includes('expropriated with NO payout')), 'the table saw the expropriation');
  await settle();
  /* The former owner is paid nothing — their turn pays salary only + quiet. */
  assert.equal(S.players[1].money, 40 + 2 + 3, 'no payout: quiet $2 + $3 salary, the strike paid nothing');
  assert.equal(S.players[0].money, 20 - 4 + 2, 'the actor only adds the quiet quarter');
  assert.equal(S.geoMissiled, false, 'the launch slot clears at the next startTurn');
  assert.equal(e.f.canMissileNode(0, 'oil'), false, 'rubble is exactly what cannot be struck');
  assert.equal(e.f.canMissileNode(0, 'infl'), true, 'intact unowned pins remain targetable');
});

test('GD-04 missile guards: no self-strike, ESG is vulnerable, no charge on refused launches', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_missile = 0;
  S.players[0].pos = 'geo_missile';      // the silo only fires from the pad
  S.owner.geo_pillars = 1;               // the rival ESG-shields their holdings
  S.owner.sat = 1;
  S.owner.oil = 0;                       // the actor's own node
  S.players[0].money = 30; S.players[0].intel = 3;
  armAction(e);
  await e.f.applyIntent(0, { act: 'missilemode' });
  await e.f.applyIntent(0, { act: 'missile', id: 'oil' });
  await settle();
  assert.equal(S.owner.oil, 0, 'self-target refused — the node stands, owned');
  assert.equal(S.rubble.oil, undefined, 'no rubble from your own strike');
  assert.equal(S.mode, null, 'the console closed itself');
  await e.f.applyIntent(0, { act: 'missilemode' });
  await e.f.applyIntent(0, { act: 'missile', id: 'sat' });
  await settle();
  assert.equal(S.owner.sat, undefined, 'the Pillars holding can be missile-struck');
  assert.equal(S.rubble.sat, 1, 'the ESG node becomes rubble');
  assert.equal(S.players[0].money, 26, 'the successful launch costs $4');
  assert.equal(S.players[0].intel, 2, 'the successful launch costs 1 Intel');
  assert.equal(e.f.canMissileNode(0, 'sat'), false, 'rubble is not targetable');
  assert.equal(e.f.canMissileNode(0, 'infl'), true, 'unprotected unowned pins stay targetable');
});

test('GD-05 rubble: rebuild pays list price, returns UNOWNED, and the Hotel skims $2 off every rebuild', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_missile = 0;
  S.players[0].pos = 'geo_missile';      // the silo only fires from the pad
  S.owner.oil = 1;                       // strike the rival's oil pit
  S.owner.geo_pyothotel = 1;             // the rival also owns the Pyongyang Hotel
  S.players[0].money = 40; S.players[0].intel = 3;
  S.players[1].money = 10;
  /* Chain 1 — the strike (the flight pause holds the chain until the clock advances). */
  armAction(e);
  await e.f.applyIntent(0, { act: 'missilemode' });
  const strike = e.f.applyIntent(0, { act: 'missile', id: 'oil' });
  e.clock.advance(e.acc.PROJ_PAUSE_MS + 100);
  await strike;
  await settle();
  assert.equal(S.players[0].money, 40 - 4 + 2, 'actor: −$4, + quiet $2');
  assert.equal(S.players[1].money, 10 + 2 + (3 + 2), 'no payout; rival quiet + salary + hotel income');
  assert.equal(S.rubble.oil, 1, 'rubble set by the strike');
  /* The actor walks onto the rubble — no new turn needed, position is free. */
  S.players[0].pos = 'oil';
  armAction(e);
  const rebuild = e.f.applyIntent(0, { act: 'rebuild' });
  assert.equal(S.rubble.oil, undefined, 'the rubble is cleared synchronously');
  assert.equal(S.owner.oil, undefined, 'a rebuild grants NO ownership — bids from next turn');
  await rebuild;
  await settle();
  /* Chain 2: −$12 rebuild, +$2 quiet; rival: +$2 kickback, + quiet, income again. */
  assert.equal(S.players[0].money, 40 - 4 - 12 + 2 + 2, 'the rebuild costs exactly list price');
  assert.equal(S.players[1].money, 10 + 2 + 5 + 2 + 2 + 5, 'the Hotel collects $2 kickbacks on the rebuild (+ its usual $5)');
  assert.equal(S.rubble.oil, undefined, 'the rubble is cleared');
  assert.equal(S.owner.oil, undefined, 'a rebuild grants NO ownership — bids from next turn');
  assert.ok(S.log.some(l => l.includes('returns unowned')), 'the copy says it out loud');
  assert.ok(S.log.some(l => l.includes('construction kickbacks')), 'the Hotel skim is on the record');
});

/* ================= GD-06 — WONSAN RESORT beach day ================= */
test('GD-06 beach day at Wonsan: free −2 Cortisol, once per turn, on-site only', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_wonsan = 0;
  S.players[0].pos = 'geo_wonsan';
  S.players[0].cortisol = 3;
  armAction(e);
  const beach = e.f.applyIntent(0, { act: 'beach' });
  assert.equal(S.players[0].cortisol, 1, '−2 Cortisol, floored properly');
  assert.equal(S.geoBeach, true, 'once per turn');
  assert.ok(S.log.some(l => l.includes('beach day in Wonsan')), 'the table saw the beach day');
  await beach;
  await settle();
  /* Same turn again: the flag gate refuses (the flag resets only at startTurn —
     simulating the mid-turn state keeps the either/or guarantee testable). */
  S.geoBeach = true; S.cur = 0; S.phase = 'action'; S.mode = null;
  await e.f.applyIntent(0, { act: 'beach' });
  assert.equal(S.players[0].cortisol, 1, 'no double beaching');
  /* Off-site: refused even when the flag were clear. */
  S.geoBeach = false;
  S.players[0].pos = 'quik';
  await e.f.applyIntent(0, { act: 'beach' });
  assert.equal(S.geoBeach, false, 'beach day needs sand underfoot');
});

/* ================= GD-07 — PYONGYANG CITY tribute ================= */
test('GD-07 Pyongyang City pays +$1 income per GEOGRAPHY node owned', t => {
  const e = engineFor(t);
  e.f.rebuildWorld(true);
  const S = makeState(e, { dlcGeo: true, players: [{ money: 50 }] });
  e.acc.S = S;
  S.owner.geo_pyoncity = 0;
  S.owner.geo_missile = 0;   // income 0
  S.owner.geo_scs = 0;       // income 4
  S.owner.westpac = 0;       // income 2 — not a GEO node
  e.f.income(0);
  /* salary 3 + holdings 8 + synergies 4 — the $3 Pyongyang tribute, plus the
     base-game westpac/REGULATOR pairing (the missile site is a regulator). */
  assert.equal(S.players[0].money, 50 + 15, 'salary 3 + $8 income + $3 tribute + $1 westpac synergy');
  const S2 = makeState(e, { dlcGeo: true, players: [{ money: 50 }] });
  e.acc.S = S2;
  S2.owner.geo_pyoncity = 0;
  S2.owner.geo_tuvalu = 0;
  S2.owner.geo_pillars = 0;
  e.f.income(0);
  assert.equal(S2.players[0].money, 50 + 3 + (2 + 2 + 1) + 3, 'three pins held ⇒ +$3 tribute');
  const S3 = makeState(e, { dlcGeo: true, players: [{ money: 50 }] });
  e.acc.S = S3;
  S3.owner.geo_pyoncity = 0;
  S3.owner.geo_kim = 0;      // income 0 — but the Supreme Leader still counts as tribute
  e.f.income(0);
  assert.equal(S3.players[0].money, 50 + 3 + (2 + 0) + 2, 'kim rides the tribute: city + kim ⇒ +$2');
});

/* ================= GD-08/09 — THE CORPORATE BOEING vs QANTAS ================= */
test('GD-07c Qantas starts available; only the Boeing shutdown grounds it', async t => {
  const { e, S } = await geoGame(t);
  assert.equal(S.turn, 1);
  assert.equal(e.f.qantasGrounded(), false, 'a fresh game does not silently ground Qantas');
  assert.equal(e.f.canReach('qantas'), true, 'the jet is available before a shutdown');
  S.owner.geo_boeing = 0;
  S.owner.qantas = 1;
  S.players[0].money = 10;
  armAction(e);
  const down = e.f.applyIntent(0, { act: 'qantasdown' });
  assert.equal(e.f.qantasGrounded(), true, 'the Boeing action grounds the airline immediately');
  assert.equal(e.f.canReach('qantas'), false, 'the grounded jet cannot be reached');
  await down;
  await settle();
});


test('GD-08 shutting down Qantas parks it for two full turns: no jet, no Qantas income', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_boeing = 0;
  S.owner.qantas = 1;                    // the rival's airline
  S.players[0].money = 30; S.players[0].intel = 2;
  S.players[1].money = 10;
  armAction(e);
  const down = e.f.applyIntent(0, { act: 'qantasdown' });
  assert.equal(S.players[0].money, 30 - 4 + 2, '−$4 grounding fee, + the quiet quarter already in');
  assert.equal(S.qantasGroundUntil, S.turn + 2, 'grounded through the current and next full turn');
  assert.equal(S.geoBoeing, true, 'once per turn');
  assert.ok(e.f.qantasGrounded(), 'the kangaroo is parked');
  assert.ok(S.log.some(l => l.includes('grounded for two full turns')), 'the table saw the grounding');
  await down;
  await settle();
  assert.equal(S.players[0].money, 30 - 4 + 2, 'the actor ends the chain at the same figure');
  /* The grounding bites immediately — the rival's next startTurn pays only salary. */
  assert.equal(S.players[1].money, 10 + 2 + 3, 'QANTAS paid $0 income, not its usual $2');
  /* While grounded: the jet itself is unreachable, and nobody pays for it. */
  S.players[0].pos = 'citi'; S.players[0].money = 30;
  await e.f.doFly(0, 'qantas');
  assert.equal(S.players[0].pos, 'citi', 'the jet itself is unreachable while parked');
  assert.equal(S.players[0].money, 30, 'no seat fee — the flight was refused');
  assert.equal(e.f.canReach('qantas'), false);
  /* Income stays hollowed while the Boeing blocks the runway. */
  S.turn = 2;
  assert.ok(e.f.qantasGrounded(), 'turn 2: still parked');
  const pre = S.players[1].money;
  e.f.income(1);
  assert.equal(S.players[1].money, pre + 3, 'QANTAS still pays nothing on turn 2');
  S.turn = 3;
  assert.equal(e.f.qantasGrounded(), false, 'the Boeing leaves at the start of turn 3 after two full turns');
  assert.equal(e.f.canReach('qantas'), true, 'the runway is open again');
  const pre2 = S.players[1].money;
  e.f.income(1);
  assert.equal(S.players[1].money, pre2 + 3 + 2, 'the usual $2 QANTAS income returns');
});

test('GD-09 the Boeing cannot ground the airline its owner flies', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_boeing = 0;
  S.owner.qantas = 0;                    // the actor owns both
  S.players[0].money = 30;
  armAction(e);
  await e.f.applyIntent(0, { act: 'qantasdown' });
  assert.equal(S.geoBoeing, false, 'the shutdown is refused');
  assert.equal(S.players[0].money, 30, 'no fee charged');
  assert.equal(S.qantasGroundUntil, 0, 'no grounding was ever scheduled');
});

/* ================= GD-10 — THE SOUTH CHINA SEA oil crash ================= */
test('GD-10 oil crash: PANIC mood, −$2 per oil node, Pillars exempt', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_scs = 0;
  S.owner.oil = 1; S.owner.petronas = 1;  // two oil positions for the rival
  S.players[0].money = 30; S.players[0].intel = 2;
  S.players[1].money = 20;
  armAction(e);
  const crash = e.f.applyIntent(0, { act: 'oilcrash' });
  assert.equal(S.players[0].money, 30 - 3 + 2, '−$3 to close the sea lanes, + the quiet quarter already in');
  assert.equal(S.players[1].money, 20 - 4 + 2, '−$2 × 2 oil nodes, + the quiet quarter already in');
  assert.ok(S.log.some(l => l.includes('THE MOOD SHIFTS') && l.includes('PANIC')), 'the mood turned PANIC (the quiet card calms it a breath later)');
  assert.equal(S.geoCrash, true, 'once per turn');
  assert.ok(S.log.some(l => l.includes('OIL CRASH')), 'the table saw the crash');
  await crash;
  await settle();
  assert.equal(S.mood, 'CALM', 'the quiet quarter calmed the board');
  assert.equal(S.players[0].money, 30 - 3 + 2);
  assert.equal(S.players[1].money, 20 - 4 + 2 + (3 + 8 + 3), 'then their ordinary income');

  /* Pillars exemption: the ESG holder pays nothing per oil node. */
  const { e: e2, S: S2 } = await geoGame(t);
  S2.owner.geo_scs = 0;
  S2.owner.geo_pillars = 1;
  S2.owner.barrels = 1;                  // an oil node for the shielded player
  S2.owner.oil = 1;
  S2.players[0].money = 30; S2.players[1].money = 40;
  armAction(e2);
  const crash2 = e2.f.applyIntent(0, { act: 'oilcrash' });
  assert.ok(S2.log.some(l => l.includes('THE MOOD SHIFTS') && l.includes('PANIC')), 'the crash mood lands even on a shielded table');
  assert.equal(S2.players[1].money, 40 + 2, 'the Pillars pay nothing — only the quiet quarter lands');
  await crash2;
  await settle();
  /* shielded rival: no crash losses; income = salary 3 + oil 8 + barrels 2 + the Pillars' own $1 */
  assert.equal(S2.players[1].money, 40 + 2 + (3 + 8 + 2 + 1), 'the Pillars pay nothing while their positions keep income');
  assert.ok(S2.log.some(l => l.includes('rides the crash out unscathed')), 'the shield is announced');
});

/* ================= GD-11 — STAGE 5 DECLINE ================= */
test('GD-11 Stage 5: the richest rival makes no income on their next turn (2 Intel, once per turn)', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_stage5 = 0;
  S.players[0].money = 30; S.players[0].intel = 3;
  S.players[1].money = 200;              // clearly the richest
  armAction(e);
  const call = e.f.applyIntent(0, { act: 'stage5' });
  assert.equal(S.players[0].intel, 1, '2 Intel spent');
  assert.equal(S.decline, 1, 'the call names the richest rival');
  assert.equal(S.geoStage5, true, 'once per turn');
  assert.ok(S.log.some(l => l.includes('STAGE 5 DECLINE')), 'the table saw the call');
  await call;
  await settle();
  /* The decline lands: the rival's next startTurn pays NOTHING. */
  assert.equal(S.players[1].money, 200 + 2, 'quiet $2 still applies — but no salary, no income');
  assert.equal(S.decline, null, 'the call is consumed');
  assert.equal(S.geoStage5, false, 'the call slot clears at the next startTurn');
  /* Their next turn after that pays normally again. */
  armAction(e);
  await e.f.applyIntent(0, { act: 'laylow', choice: 'cash' }); // +$1, chain rolls the table
  await settle();
  assert.equal(S.players[1].money, 200 + 2 + 3 + 2, 'decline gone: salary + quiet');
  assert.equal(S.players[0].money, 30 + 2 + 1 + 2, 'the actor: quiet, the laylow $1, quiet');
});

test('GD-11b Stage 5 guards: ESG-rich cannot be declined; no rival, no call', async t => {
  {
    const { e, S } = await geoGame(t);
    S.owner.geo_stage5 = 0;
    S.owner.geo_pillars = 1;
    S.players[0].intel = 3;
    S.players[1].money = 200;
    armAction(e);
    await e.f.applyIntent(0, { act: 'stage5' });
    assert.equal(S.decline, null, 'the ESG SHIELD refuses the call');
    assert.equal(S.players[0].intel, 3, 'nothing was spent');
    e.dispose();
  }
  {
    /* A solo table has nobody to decline. */
    const e = engineFor(t);
    const S0 = await makeGame(e, 1, { geo: true });
    quietDeck(S0);
    S0.owner.geo_stage5 = 0;
    S0.players[0].intel = 5;
    S0.cur = 0; S0.phase = 'action'; S0.mode = null;
    await e.f.applyIntent(0, { act: 'stage5' });
    assert.equal(S0.decline, null, 'no call on a one-seat table');
    assert.equal(S0.players[0].intel, 5, 'no spend on a one-seat table');
    e.dispose();
  }
});

/* ================= GD-12 — VENICE DI CCTV ================= */
test('GD-12 gondola therapy: free −1 Cortisol on-site, either/or with Overtourism', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_venice = 0;
  S.players[0].pos = 'geo_venice';
  S.players[0].cortisol = 2;
  armAction(e);
  const cool = e.f.applyIntent(0, { act: 'venicecool' });
  assert.equal(S.players[0].cortisol, 1, '−1 Cortisol on the gondola');
  assert.equal(S.geoVenice, true, 'the once-per-turn slot is spent');
  assert.ok(S.log.some(l => l.includes('gondola')), 'the table saw the therapy');
  await cool;
  await settle();
  /* Either/or: overtourism is off for this turn too. The flag resets at every
     startTurn, so restore it manually to exercise the same-turn gate. */
  S.geoVenice = true;
  S.cur = 0; S.phase = 'action'; S.mode = null;
  await e.f.applyIntent(0, { act: 'overmode' });
  assert.notEqual(S.mode, 'overtour', 'gondola or ships — never both');
});

test('GD-12b Overtourism: +1 Cortisol per owner-turn while Venice stays owned', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_venice = 0;
  S.owner.oil = 1; S.owner.westpac = 1;  // rival needs >1 node for cortisol to land
  S.players[0].money = 30; S.players[0].intel = 2;
  S.players[1].cortisol = 0;
  armAction(e);
  await e.f.applyIntent(0, { act: 'overmode' });
  assert.equal(S.mode, 'overtour', 'the cruise board arms');
  const tour = e.f.applyIntent(0, { act: 'overtour', id: 'westpac' });
  assert.equal(S.players[0].money, 30 - 2 + 2, '−$2 fare, + the quiet quarter already in');
  assert.equal(S.ov.nid, 'westpac', 'the ships are booked against the selected node');
  assert.equal(S.ov.by, 0, 'the Venetian player owns the effect');
  assert.equal(S.ov.targetOwner, 1, 'the effect tracks the original node owner');
  assert.equal(S.ov.expiresAt, S.turn * S.players.length + S.cur + S.players.length, 'the effect lasts one full turn cycle');
  assert.ok(S.log.some(l => l.includes('OVERTOURISM')), 'the table saw the ships');
  await tour;
  await settle();
  /* The marked owner steams on their turn. */
  assert.equal(S.players[1].cortisol, 1, '+1 Cortisol at the rival’s turn');
  assert.notEqual(S.ov, null, 'the ships keep coming');
  /* Venice changes hands — the cruise stops and is swept. */
  S.owner.geo_venice = 1;
  S.players[1].cortisol = 5; S.players[0].money = 10;
  armAction(e);
  await e.f.applyIntent(0, { act: 'laylow', choice: 'cash' }); // +$1; the chain rolls to the rival
  await settle();
  assert.equal(S.ov, null, 'overtourism clears when the Venetian sells up');
  assert.equal(S.players[1].cortisol, 5, 'no further cortisol once the ships are gone');
});

test('GD-12c Overtourism guards: ESG does not block it; rubble still does', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_venice = 0;
  S.owner.geo_pillars = 1; S.owner.westpac = 1; // the rival holds the Pillars
  S.players[0].money = 30;
  armAction(e);
  await e.f.applyIntent(0, { act: 'overmode' });
  await e.f.applyIntent(0, { act: 'overtour', id: 'westpac' });
  await settle();
  assert.notEqual(S.ov, null, 'ESG does not protect holdings from Overtourism');
  assert.equal(S.players[0].money, 28, 'the overtourism fare is charged');
  assert.equal(S.mode, null, 'the board closed');
  /* Rubble pins are out of scope too. */
  S.ov = null; S.geoVenice = false; S.owner.geo_venice = 0;
  S.owner.westpac = 1; S.owner.geo_pillars = 2;
  S.rubble.westpac = 1; S.players[0].money = 30;
  armAction(e);
  await e.f.applyIntent(0, { act: 'overmode' });
  await e.f.applyIntent(0, { act: 'overtour', id: 'westpac' });
  await settle();
  assert.equal(S.ov, null, 'no ships to rubble');
  assert.equal(S.players[0].money, 30, 'no fare for a rubble pin');
});

/* ================= GD-13 — TUVALU, the free country ================= */
test('GD-13 Tuvalu auto-claims for the first arrival — free, no Cortisol; never for rubble', async t => {
  const { e, S } = await geoGame(t);
  S.players[0].cortisol = 0; S.players[0].money = 20;
  await e.f.doMove(0, 'geo_tuvalu');
  assert.equal(S.players[0].pos, 'geo_tuvalu');
  assert.equal(S.owner.geo_tuvalu, 0, 'first arrival claims it');
  assert.equal(S.players[0].money, 20, 'the join is free — no toll, no price');
  assert.equal(S.players[0].cortisol, 0, 'no Cortisol for the free country');
  assert.ok(S.log.some(l => l.includes('THE JOIN IS FREE')), 'the table saw the join');
  /* A later arrival does not take it — they pay the toll like anywhere else. */
  S.players[0].pos = 'quik';
  S.players[1].pos = 'citi';
  S.players[1].money = 15;
  await e.f.doMove(1, 'geo_tuvalu');
  assert.equal(S.owner.geo_tuvalu, 0, 'no second claim');
  assert.equal(S.players[1].pos, 'geo_tuvalu', 'they still stand there');
  assert.equal(S.players[1].money, 14, 'the $1 toll still applies');
  /* Rubble claims nobody. */
  const { e: e2, S: S2 } = await geoGame(t);
  e2.f.strikeNode(0, 'geo_tuvalu');
  S2.players[0].pos = 'quik';
  await e2.f.doMove(0, 'geo_tuvalu');
  assert.equal(S2.owner.geo_tuvalu, undefined, 'rubble is unclaimable');
  assert.equal(S2.rubble.geo_tuvalu, 1, 'the strike left rubble behind');
});

/* ================= GD-14 — the DLC board sweep across seeds ================= */
test('GD-14 the generated 80-pin board stays a valid collage across 30 seeds', { timeout: 60000 }, t => {
  const e = engineFor(t);
  e.f.rebuildWorld(true);
  const slots = e.acc.QUIK_SLOTS;
  for (let s = 0; s < 30; s++) {
    const seed = 3000 + s;
    const slot = slots[s % slots.length];
    let gen;
    withSeed(seed, () => { gen = e.f.generateRandomBoard(slot); });
    const posById = new Map(gen.positions.map(p => [p.id, p]));
    for (const id of e.acc.GEO_NODE_IDS) {
      assert.ok(posById.has(id), `seed ${seed}: ${id} plotted`);
    }
    const reached = bfs(e.acc.ADJ, 'quik');
    assert.equal(reached.size, 82, `seed ${seed}: fully connected`);
    /* Geo pins never share a plot with each other. */
    for (let i = 0; i < e.acc.GEO_NODE_IDS.length; i++) {
      for (let j = i + 1; j < e.acc.GEO_NODE_IDS.length; j++) {
        const a = posById.get(e.acc.GEO_NODE_IDS[i]), b = posById.get(e.acc.GEO_NODE_IDS[j]);
        assert.ok(a.x !== b.x || a.y !== b.y, `seed ${seed}: ${a.id} and ${b.id} overlap`);
      }
    }
  }
});

/* ================= GD-15 — lobby toggle: host-only, mirrored everywhere ================= */
test('GD-15 the geo flag is host-gated in the lobby and travels with every payload', async t => {
  const { e } = await geoGame(t);
  /* A third seat joins mid-lobby: the welcome payload carries the flag.
     (Mid-game, handleHello only welcomes rejoining known seats.) */
  e.acc.Net.started = false;
  const c3 = makeConn(e, 'pid9');
  e.acc.Net.conns[2] = c3;
  e.f.handleHello(c3, 'Third Chair', 'pid9');
  const welcome = c3.sent.find(m => m.t === 'welcome');
  assert.ok(welcome, 'the third seat got their welcome');
  assert.equal(welcome.dlcGeo, true, 'the welcome ships the DLC flag');
  /* broadcastLobby mirrors it too. */
  e.f.broadcastLobby();
  const lobby = c3.sent.filter(m => m.t === 'lobby').pop();
  assert.equal(lobby.dlcGeo, true, 'the lobby broadcast ships the DLC flag');
  /* The state carries it: guests rebuild their world on adopt. */
  const guest = engineFor(t);
  assert.equal(guest.acc.NODES.length, 70, 'guests start in the base world');
  guest.f.adoptState(JSON.parse(JSON.stringify(e.f.pubState(true))));
  assert.equal(guest.acc.NODES.length, 82, 'adopting a geo state rebuilds the guest world');
  assert.equal(guest.acc.WORLD_GEO, true);
  assert.ok(guest.acc.NMAP.geo_tuvalu, 'guests see every pin');
  assert.equal(JSON.parse(JSON.stringify(guest.acc.S)).dlcGeo, true);
  guest.dispose();
  /* UI gate: guests cannot flip the box; setGeoUI mirrors instead. */
  assert.ok(SOURCE.includes("gt.onchange=()=>{if(Net.role!=='host'){gt.checked=Net.dlcGeo"), 'the guest checkbox refuses to lead');
  e.f.setGeoUI(false);
  assert.equal(e.acc.Net.dlcGeo, false, 'setGeoUI flips the in-memory flag');
  e.f.setGeoUI(true);
  assert.equal(e.acc.Net.dlcGeo, true);
});

/* ================= GD-16 — help copy & the exhibit-count contract ================= */
test('GD-16 the help panel explains the DLC without breaking the base-game copy pins', t => {
  assert.ok(SOURCE.includes('The Geography DLC'), 'the help section is titled');
  assert.ok(SOURCE.includes('82 exhibits'), 'help copy says what the board becomes');
  assert.ok(SOURCE.includes('v1.9'), 'the version stamp moved');
  assert.ok(SOURCE.includes('70 exhibits'), 'the base-game exhibit copy is intact (RC-01 pin)');
  assert.ok(!SOURCE.includes('81 exhibits'), 'no stale exhibit counts');
  assert.ok(SOURCE.includes('KIM JONG UN ($6)'), 'the Supreme Leader has a help bullet');
  assert.ok(SOURCE.includes('MISSILE COMMAND or the SHAHED DRONE'), 'either strategic drone launch site is documented');
  assert.ok(SOURCE.includes('50/50 indictment'), 'the probe is documented');
  assert.ok(SOURCE.includes('REFLECTED'), 'the Tuvalu reflection is documented');
  assert.ok(SOURCE.includes('wall off literally any node'), 'the blockade is documented');
  assert.ok(SOURCE.includes('market manipulation'), 'the ASIC rebrand is documented');
});

/* ================= GD-17 — the silo's on-site rule ================= */
test('GD-17 the silo fires on-site only — a mid-move launch ends the walk, Kim arms it from anywhere, Backroom no longer touches the missile', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_missile = 0;
  S.owner.oil = 1;
  S.players[0].money = 20; S.players[0].intel = 3;
  /* Off-site action phase: no console. */
  S.players[0].pos = 'quik';
  armAction(e);
  await e.f.applyIntent(0, { act: 'missilemode' });
  assert.notEqual(S.mode, 'missile', 'off-site: the console refuses to arm');
  /* On the pad: it arms. */
  S.players[0].pos = 'geo_missile';
  await e.f.applyIntent(0, { act: 'missilemode' });
  assert.equal(S.mode, 'missile', 'on the pad: the console arms');
  S.mode = null;
  /* Kim exemption: off-site but holding the Supreme Leader. */
  S.owner.geo_kim = 0;
  S.players[0].pos = 'quik';
  await e.f.applyIntent(0, { act: 'missilemode' });
  assert.equal(S.mode, 'missile', 'owning Kim Jong Un arms the silo from anywhere');
  S.mode = null; S.owner.geo_kim = 1;    // hand Kim away for the next leg
  /* Backroom no longer arms the missile: mid-move off-site, even with 2 steps in
     hand, the console refuses. */
  S.owner.back = 0;
  S.cur = 0; S.phase = 'move'; S.mode = null; S.steps = 3; S.backroomAbilityUsed = false;
  S.players[0].pos = 'quik';
  await e.f.applyIntent(0, { act: 'missilemode' });
  assert.notEqual(S.mode, 'missile', 'Backroom Deals is out of the missile business');
  /* The missile is a normal option during the turn: on the pad mid-move it arms,
     the strike ends the walk (steps burn), and the action phase still follows. */
  S.players[0].pos = 'geo_missile';
  await e.f.applyIntent(0, { act: 'missilemode' });
  assert.equal(S.mode, 'missile', 'on the pad mid-move: the console arms');
  const strike = e.f.applyIntent(0, { act: 'missile', id: 'oil' });
  e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); /* the flight plays, then the impact lands mid-move */
  await strike;
  await settle();
  assert.equal(S.rubble.oil, 1, 'the strike lands mid-move');
  assert.equal(S.steps, 0, 'the launch ends the move — remaining steps burn');
  assert.equal(S.phase, 'action', 'the action phase still follows the mid-move launch');
  assert.equal(S.backroomAbilityUsed, false, 'no Backroom slot was spent');
  assert.equal(S.turn, 1, 'the turn has not rolled — the event card waits for the action');
  /* The interface pins: the missile is out of the Backroom subpanel and the
     move-phase launch button warns that it ends the move. */
  assert.ok(!SOURCE.includes('🚀 Missile — $4 + 1🛈 · 2 steps'), 'the missile left the Backroom subpanel');
  assert.ok(SOURCE.includes('(ends the move)'), 'the move-phase launch button warns the launch ends the move');
});

/* ================= GD-18 — the REGULATOR probe ================= */
test('GD-18 striking a REGULATOR schedules a next-turn investigation: 50/50 raid, +1 Cortisol either way', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_missile = 0;
  S.players[0].pos = 'geo_missile';
  S.owner.accc = 1;                      // the rival runs the regulator — for now
  S.players[0].money = 20; S.players[0].intel = 3;
  S.players[1].money = 40; S.players[1].cortisol = 0;
  armAction(e);
  await e.f.applyIntent(0, { act: 'missilemode' });
  const strike = e.f.applyIntent(0, { act: 'missile', id: 'accc' });
  e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); /* the flight plays, then the impact lands */
  await strike;
  await settle();
  assert.equal(S.missileProbe && S.missileProbe.by, 0, 'the probe is scheduled against the striker');
  assert.equal(S.rubble.accc, 1, 'the regulator burns');
  assert.equal(S.owner.accc, undefined, 'expropriated with no payout');
  assert.equal(S.players[1].money, 40 + 2 + 3, 'no payout to the regulator’s owner');
  /* The probe lands on the striker's next startTurn — seeded dice. */
  const r = makeRng(23); r();            // roll 1 picks the agency
  const indicted = r() < 0.5;            // roll 2 picks the verdict
  S.cur = 0;
  S.players[0].money = 20; S.players[0].intel = 3; S.players[0].cortisol = 0; S.players[0].raided = 0;
  S.players[0].pos = 'quik';
  S.owner.geo_missile = 0;
  await withSeedAsync(23, () => e.f.startTurn());
  assert.ok(S.log.some(l => l.includes('closes the investigation')), 'the investigation resolved out loud');
  if (indicted) {
    assert.equal(S.caution, true, 'indictment ⇒ the raid’s caution bites this same turn');
    assert.ok(S.log.some(l => l.includes('REGULATOR RAID')), 'the full raid hit the table');
    assert.equal(S.owner.geo_missile, undefined, 'the raid stripped the silo');
    assert.ok(S.log.some(l => l.includes('spends the turn with the regulators')), 'no income, one step — this turn');
    assert.equal(S.players[0].cortisol, 1, 'the raid resets Cortisol, the probe adds its +1');
    assert.equal(S.players[0].money, 20 - 6, 'the raid fined 30% of $20 (min $5)');
    assert.equal(S.players[0].intel, 1, 'Intel burned down to 1');
    assert.equal(S.rubble.geo_missile, undefined, 'a raid seizes — it does not rubble');
  } else {
    assert.equal(S.players[0].raided, 0, 'cleared — no raid');
    assert.equal(S.players[0].cortisol, 1, 'but +1 Cortisol either way');
    assert.equal(S.players[0].money, 20 + 3, 'no caution — income lands normally');
    assert.equal(S.caution, false);
  }
});

/* ================= GD-19 — Tuvalu reflects ================= */
test('GD-19 the warhead at Tuvalu reflects onto the launcher’s own board and the silo blows up', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_missile = 0;
  S.owner.oil = 0;                       // one launcher pin — a deterministic reflection target
  S.owner.geo_pyoncity = 1;              // a rival pin that must survive
  S.players[0].pos = 'geo_missile';
  S.players[0].money = 20; S.players[0].intel = 3;
  armAction(e);
  await e.f.applyIntent(0, { act: 'missilemode' });
  const strike = e.f.applyIntent(0, { act: 'missile', id: 'geo_tuvalu' });
  assert.equal(S.rubble.geo_tuvalu, undefined, 'Tuvalu itself never burns');
  assert.equal(S.owner.geo_tuvalu, undefined, 'nor changes hands');
  assert.equal(S.rubble.geo_missile, 1, 'the silo blows up in the backblast');
  assert.equal(S.owner.geo_missile, undefined, 'gone with no payout');
  assert.ok(S.log.some(l => l.includes('REFUSES it')), 'the table saw the reflection');
  e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); /* the warhead flies out to the island */
  await settle();
  e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); /* the reflected warhead flies home before the event card */
  await strike;
  await settle();
  assert.equal(S.rubble.oil, 1, 'the reflected warhead took the one launcher pin');
  assert.equal(S.owner.geo_pyoncity, 1, 'rival pins are out of the reflection’s reach');
  assert.ok(S.log.some(l => l.includes('backblast')), 'the self-destruct is on the record');
  assert.equal(S.missileProbe, null, 'no probe cascades from the reflected strike');
});

/* ================= GD-20 — the PM's blockade ================= */
test('GD-20 blockade: free, once per turn, one full rotation, and even the owner is locked out', async t => {
  const { e, S } = await geoGame(t);
  S.owner.albo = 0;
  S.owner.oil = 1;
  S.players[0].money = 10;
  const preRival = S.players[1].money;
  armAction(e);
  await e.f.applyIntent(0, { act: 'blockmode' });
  assert.equal(S.mode, 'blockade', 'the blockade console arms');
  const wall = e.f.applyIntent(0, { act: 'blockade', id: 'oil' });
  assert.equal(S.blockades.oil, S.turn + 2, 'expiry is one full rotation after placement');
  assert.equal(S.blockadeUsed, true, 'one wall per turn');
  assert.equal(S.players[0].money, 10 + 2, 'free — only the quiet quarter lands');
  assert.ok(S.log.some(l => l.includes('BLOCKADED for one full rotation')), 'the table saw the wall');
  await wall;
  await settle();
  /* The wall blocks feet, not money: the walled pin still pays its owner. */
  assert.equal(S.players[1].money, preRival + 2 + 3 + 8, 'income unaffected: quiet + salary + oil ($8)');
  /* Nobody enters: walker, jet, owner. */
  S.players[1].pos = 'citi'; S.players[1].money = 15;
  await e.f.doMove(1, 'oil');
  assert.equal(S.players[1].pos, 'citi', 'walking in is refused');
  assert.equal(S.players[1].money, 15, 'no toll — refusal comes before the toll desk');
  await e.f.doFly(1, 'oil');
  assert.equal(S.players[1].pos, 'citi', 'landing is refused too');
  assert.equal(S.players[1].money, 15, 'no seat fee for a refused flight');
  S.players[0].pos = 'quik';
  await e.f.doMove(0, 'oil');
  assert.equal(S.players[0].pos, 'quik', 'even the wall-builder stays out');
  /* Once per turn: the spent flag refuses a second wall the same turn (the flag
     clears at every startTurn, so each player's own turn gets a fresh slot). */
  assert.equal(S.blockadeUsed, false, 'the slot clears at the next startTurn');
  S.cur = 0; S.phase = 'action'; S.mode = null; S.blockadeUsed = true;
  await e.f.applyIntent(0, { act: 'blockmode' });
  assert.notEqual(S.mode, 'blockade', 'one wall per turn');
  /* The wall comes down after exactly one rotation. */
  assert.equal(e.f.blockaded('oil'), true, 'the wall holds while the rotation runs');
  S.blockades.oil = S.turn;              // the rotation has passed
  assert.equal(e.f.blockaded('oil'), false, 'expired walls open the road');
  await e.f.doMove(1, 'oil');
  assert.equal(S.players[1].pos, 'oil', 'the road is open again');
});

test('GD-20b blockade guards: rubble refused, double walls refused, move-phase refused, Tuvalu unclaimable', async t => {
  const { e, S } = await geoGame(t);
  S.owner.albo = 0;
  S.owner.oil = 0; S.rubble.oil = 1;
  armAction(e);
  await e.f.applyIntent(0, { act: 'blockmode' });
  await e.f.applyIntent(0, { act: 'blockade', id: 'oil' });
  assert.equal(S.mode, null, 'rubble cannot be walled');
  assert.equal(S.blockades.oil, undefined, 'no wall was scheduled');
  delete S.rubble.oil;
  await e.f.applyIntent(0, { act: 'blockmode' });  // re-arm after the closed console
  const wall = e.f.applyIntent(0, { act: 'blockade', id: 'oil' });
  assert.equal(S.blockades.oil, S.turn + 2, 'the standing pin is walled for one full rotation');
  S.blockadeUsed = false;                // force a second wall attempt same turn
  await e.f.applyIntent(0, { act: 'blockmode' });
  await e.f.applyIntent(0, { act: 'blockade', id: 'oil' });
  assert.equal(S.mode, null, 'already-walled refused');
  assert.equal(S.blockades.oil, S.turn + 2, 'the first expiry stands');
  /* Blockades are an action-phase power: mid-move without Backroom, no wall. */
  S.cur = 0; S.phase = 'move'; S.mode = null; S.blockadeUsed = false;
  await e.f.applyIntent(0, { act: 'blockmode' });
  assert.notEqual(S.mode, 'blockade', 'no walls from the move phase');
  /* A walled Tuvalu cannot be free-claimed. */
  const { e: e2, S: S2 } = await geoGame(t);
  S2.owner.albo = 1;
  S2.blockades.geo_tuvalu = S2.turn + 2;
  S2.players[0].cortisol = 0;
  await e2.f.doMove(0, 'geo_tuvalu');
  assert.equal(S2.owner.geo_tuvalu, undefined, 'the wall keeps the free claim out');
  assert.equal(S2.players[0].pos, 'quik', 'they never arrived');
  await wall; // the first wall's promise settles the turn chain
  await settle();
  assert.ok(SOURCE.includes("case 'blockmode'"), 'the sidebar switch dispatches the blockade console — the button cannot dead-end again');
});

/* ================= GD-21 — Kim Jong Un ================= */
test('GD-21 Kim Jong Un: a WILD pin that pays +1 Intel at every startTurn', async t => {
  const e = engineFor(t);
  e.f.rebuildWorld(true);
  const kim = e.acc.NMAP.geo_kim;
  assert.equal(kim.type, 'WILD', 'WILD like Toktimer');
  assert.equal(kim.income, 0, 'no money — information only');
  assert.equal(kim.cost, 6, 'list price $6');
  assert.ok(kim.image.endsWith('nk_kimjongun.png'), 'the converted PNG is the asset');
  assert.ok(fs.existsSync(path.join(repoRoot, 'static/GeographyDLC/nk_kimjongun.png')), 'shipped on disk');
  const S = makeState(e, { dlcGeo: true, players: [{ money: 20, intel: 0, pos: 'geo_kim' }] });
  e.acc.S = S;
  S.owner.geo_kim = 0;
  await withSeedAsync(5, () => e.f.startTurn());
  assert.equal(S.players[0].intel, 1, '+1 Intel at the start of the turn');
  assert.ok(S.log.some(l => l.includes('the Supreme Leader briefs you')), 'the passive is on the record');
  assert.equal(S.players[0].money, 20 + 3, 'salary only — the pin pays no income');
});

/* ================= GD-22 — strategic synergies spawn far apart ================= */
test('GD-22 cortisol relief and strategic drone synergies spawn far apart across seeds', { timeout: 60000 }, t => {
  const e = engineFor(t);
  e.f.rebuildWorld(true);
  const slots = e.acc.QUIK_SLOTS;
  const strategic = ['geo_missile', 'geo_shahed', 'geo_kim', 'geo_wonsan', 'geo_pillars', 'gold', 'sat', 'asics', 'rba'];
  for (let s = 0; s < 12; s++) {
    const seed = 5000 + s;
    const slot = slots[s % slots.length];
    let gen;
    withSeed(seed, () => { gen = e.f.generateRandomBoard(slot); });
    const posById = new Map(gen.positions.map(p => [p.id, p]));
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    for (const id of strategic) assert.ok(posById.has(id), `seed ${seed}: ${id} is plotted`);
    let closest = Infinity, closestPair = '';
    for (let i = 0; i < strategic.length; i++) {
      for (let j = i + 1; j < strategic.length; j++) {
        const distance = d(posById.get(strategic[i]), posById.get(strategic[j]));
        if (distance < closest) { closest = distance; closestPair = strategic[i] + ' / ' + strategic[j]; }
      }
    }
    assert.ok(closest > 150, `seed ${seed}: key synergies are spread apart (closest: ${closestPair}, ${Math.round(closest)}px)`);
    for (const id of strategic) {
      const p = posById.get(id);
      assert.ok(p.x >= 95 && p.x <= 2305 && p.y >= 95 && p.y <= 1455, `seed ${seed}: ${id} stays on the board`);
    }
  }
});

/* ================= GD-23 — ASIC takes the monetary book ================= */
test('GD-23 monetary-policy concentration is an ASIC market-manipulation file, not an ACCC monopoly', async t => {
  const e = engineFor(t);
  e.f.rebuildWorld(true);
  e.acc.Net.role = 'host';               // the bulletin needs a host to announce
  const S = makeState(e, { dlcGeo: false, players: [{ money: 50, intel: 10 }, { money: 30, intel: 10 }] });
  e.acc.S = S;
  S.owner.mpc = 0; S.owner.rba = 0; S.owner.cash = 0; S.owner.bullock = 0; S.owner.infl = 0;
  let fired = false;
  for (let s = 1; s <= 80 && !fired; s++) {
    withSeed(s, () => e.f.acccInvestigate(0));
    fired = S.log.some(l => l.includes('MARKET MANIPULATION'));
  }
  assert.ok(fired, 'a seed tripped the 33% gate');
  assert.ok(!S.log.some(l => l.includes('MONOPOLY ALERT!')), 'no ACCC monopoly branding on a monetary book');
  assert.ok(S.log.some(l => l.includes('ASIC market-manipulation fine (20%)')), 'the cash fine names ASIC');
  assert.ok(S.log.some(l => l.includes('pays an ASIC fine of')), 'the Intel fine names ASIC');
  assert.ok(S.owner.mpc !== 0, 'the book was divested');
  const card = e.modalRec.find(m => m.title === 'ASIC MARKET MANIPULATION');
  assert.ok(card, 'the table saw ASIC’s announcement');
  assert.ok(card.html.includes('./static/asic.png'), 'the card carries ASIC’s face');
  assert.ok(card.html.includes('MARKET-MANIPULATION'), 'the card says the crime');

  /* A plain bank book still goes to the ACCC with its own face. */
  const e2 = engineFor(t);
  e2.f.rebuildWorld(true);
  e2.acc.Net.role = 'host';
  const S2 = makeState(e2, { dlcGeo: false, players: [{ money: 50, intel: 10 }, { money: 30, intel: 10 }] });
  e2.acc.S = S2;
  S2.owner.citi = 0; S2.owner.commbank = 0; S2.owner.nab = 0;
  let fired2 = false;
  for (let s = 1; s <= 80 && !fired2; s++) {
    withSeed(s, () => e2.f.acccInvestigate(0));
    fired2 = S2.log.some(l => l.includes('MONOPOLY ALERT!'));
  }
  assert.ok(fired2, 'a seed tripped the ACCC on a bank book');
  assert.ok(e2.modalRec.some(m => m.title === 'MONOPOLY ALERT' && m.html.includes('./static/accc.png')), 'the ACCC keeps its face');
});

/* ================= GD-24 — the flight animation payload ================= */
test('GD-24 projectile fx: synced payload, nose-first rig, mirrored leftward flights', async t => {
  const e = engineFor(t);
  e.f.rebuildWorld(true);
  e.acc.Net.role = 'host';
  const S = makeState(e, { dlcGeo: true, players: [{}, {}] });
  e.acc.S = S;
  const n0 = S.fx.length;
  e.f.projFx('missile', 'geo_missile', 'geo_pyoncity'); // a rightward hop
  e.f.projFx('fly', 'geo_tuvalu', 'geo_venice');        // a long leftward flight
  e.f.projFx('missile', 'geo_scs', 'geo_scs');          // same pin — no flight
  const entries = S.fx.slice(n0).filter(f => f.proj);
  assert.equal(entries.length, 2, 'same-pin launches emit nothing');
  const [m, j] = entries;
  assert.equal(m.img, './static/GeographyDLC/missile_travelling.png', 'the warhead sprite');
  assert.equal(m.base, 45, 'the missile artwork points up-right: +45° base');
  assert.equal(m.w, 116); assert.equal(m.h, 125);
  assert.equal(m.x0, e.acc.NMAP.geo_missile.x, 'the flight starts at the silo');
  assert.equal(m.y0, e.acc.NMAP.geo_missile.y - 40, 'lifted above the pin');
  assert.equal(m.x1, e.acc.NMAP.geo_pyoncity.x);
  assert.equal(m.x, m.x0, 'the text-renderer fallback coords ride along');
  const dx = m.x1 - m.x0;
  assert.ok(dx > 0, 'the chosen hop flies right');
  assert.equal(e.f.projRig(m), 'rotate(' + (Math.atan2(m.y1 - m.y0, dx) * 180 / Math.PI + 45).toFixed(1) + ')', 'rightward flights rotate only');
  assert.equal(j.img, './static/qantas_jet_travelling.png', 'the jet sprite');
  assert.equal(j.base, 10, 'the jet artwork noses right with a ~10° tilt');
  const jdx = j.x1 - j.x0;
  assert.ok(jdx < 0, 'the chosen flight travels left');
  assert.equal(e.f.projRig(j), 'scale(-1,1) rotate(' + (Math.atan2(j.y1 - j.y0, -jdx) * 180 / Math.PI + 10).toFixed(1) + ')', 'leftward flights mirror first, then rotate');
  /* The payload rides the synced state so every mirror animates the same flight. */
  const pub = JSON.parse(JSON.stringify(e.f.pubState(true)));
  assert.ok(pub.fx.some(f => f.proj === 1), 'the flight rides pubState');
  /* The fx ring buffer still caps at 40. */
  for (let i = 0; i < 50; i++) e.f.projFx('missile', 'geo_missile', 'geo_pyoncity');
  assert.ok(S.fx.length <= 40, 'the fx cap holds under projectile spam');
});

/* ================= GD-25 — the flight plays before the popup ================= */
test('GD-25 the launch holds the turn: the warhead and the jet fly before the next screen takes over', async t => {
  const { e, S } = await geoGame(t);
  S.owner.geo_missile = 0;
  S.owner.oil = 1;
  S.players[0].pos = 'geo_missile';
  S.players[0].money = 20; S.players[0].intel = 3;
  armAction(e);
  await e.f.applyIntent(0, { act: 'missilemode' });
  const strike = e.f.applyIntent(0, { act: 'missile', id: 'oil' });
  await settle();
  assert.equal(S.phase, 'action', 'the turn is held while the warhead flies');
  assert.ok(S.fx.some(f => f.proj === 1), 'the warhead is in the air on every screen');
  assert.equal(e.modalRec.some(m => m.title.startsWith('MARKET EVENT')), false, 'no event card during the flight');
  e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); /* the flight window elapses */
  await strike;
  await settle();
  assert.ok(e.modalRec.some(m => m.title.startsWith('MARKET EVENT')), 'the market event lands only after the flight');
  assert.equal(S.phase, 'move', 'and the turn has rolled on');
  /* The jet, too: the landing (and the phase it opens) waits out the flight. */
  const flight = e.f.doFly(0, 'rba');
  await settle();
  assert.equal(S.phase, 'move', 'the jet is still in the air — the phase holds');
  assert.ok(S.fx.some(f => f.proj === 1 && f.img.includes('qantas')), 'the jet is in the air');
  assert.equal(S.players[0].pos, 'rba', 'the booking is settled at takeoff');
  e.clock.advance(e.acc.PROJ_PAUSE_MS + 100);
  await flight;
  assert.equal(S.phase, 'action', 'the action phase opens only after the jet lands');
});
