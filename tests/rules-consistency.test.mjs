/*
 * Rules consistency between the public copy and the shipped behaviour —
 * section 6 (RC-01..RC-07) of docs/CODE_LEVEL_TEST_PLAN.md.
 *
 * RC-01/02/06/07 are structural (assets, deck, win types, dead references);
 * RC-03/04/05 drive the real vm actions and compare against the rules copy.
 * Known drift (baked asset typos and dead refs to the removed-node list) is
 * reported informationally.
 *
 * Behaviour tests use a controlled deck of `quiet` events (each +$2 to every
 * player) so the automatic end-of-turn chain that `finishNodeAbility` triggers
 * is fully deterministic:  chain action ⇒ quiet (+2 both) ⇒ next seat's
 * startTurn (salary 3 + owned-node income). The rival fixture owns westpac+anz
 * (income 2+2, no synergy) so its startTurn pays exactly $7, total +9.
 * Non-chain intel ops (spy/dossier) and movement actions (favor/slip/fly) have
 * no such chain and settle immediately.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, makeGame, SOURCE, repoRoot } from './helpers/harness.mjs';

const engineFor = t => { const e = loadEngine(); t.after(() => e.dispose()); return e; };

async function settle() {
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
}

const staticFile = rel => path.join(repoRoot, rel.replace(/^\.\//, ''));
const exists = p => fs.existsSync(p);

/* ================= RC-01 — node structure & shipped assets ================= */
test('RC-01 every node is structurally complete and every baked asset exists on disk', t => {
  const engine = engineFor(t);
  const NODES = engine.acc.NODES;
  const CHARS = engine.acc.CHARS;
  const TYPES = new Set(engine.acc.WIN_TYPES);
  const ids = new Set();
  const TYPOS = ['oil price increease.png', 'whistelblower.png', 'us treasury yeild.png'];
  let typoCount = 0;

  for (const n of NODES) {
    assert.ok(n.id, 'every node has an id');
    assert.ok(!ids.has(n.id), `ids unique: ${n.id}`);
    ids.add(n.id);
    assert.ok(TYPES.has(n.type), `${n.id}: type ${n.type} is one of the seven win types`);
    assert.ok(Array.isArray(n.name) && n.name.length >= 1 && n.name.every(s => typeof s === 'string'),
      `${n.id}: name lines are strings`);
    assert.equal(typeof n.income, 'number', `${n.id}: numeric income`);
    assert.equal(typeof n.cost, 'number', `${n.id}: numeric cost`);
    assert.ok(typeof n.image === 'string' && n.image.startsWith('./static/'), `${n.id}: image lives in ./static/`);
    assert.ok(exists(staticFile(n.image)), `${n.id}: ${n.image} exists on disk`);
    if (TYPOS.some(ty => n.image.endsWith(ty))) typoCount++;
  }
  /* The three baked filename typos are real files on disk; renaming them is a
     user-facing change (BUILD_COMMIT hashes index.html). Flagged, not fixed. */
  console.log(`    informational: baked filename typos shipped as real files: ${typoCount}/${TYPOS.length} found`);
  assert.equal(typoCount, TYPOS.length, 'the known typo filenames still exist on disk (update this test if they are ever renamed)');
  for (const c of CHARS) {
    if (c.url) continue; // remote-only portraits (Alexander_Lane, DJT, …)
    assert.ok(exists(path.join(repoRoot, 'characters', c.file)), `${c.id}: characters/${c.file} exists on disk`);
  }
  assert.equal(NODES.length, 70, 'help copy and live board both describe 70 exhibits');
  assert.ok(SOURCE.includes('70 exhibits'), 'the help modal uses the live exhibit count');
  assert.ok(SOURCE.includes('82 exhibits'), 'the help modal documents the Geography DLC exhibit count');
  console.log(`    informational: live node count ${NODES.length}`);
});

/* ================= RC-02 — the deck is complete ================= */
test('RC-02 the event deck contains every card once and initGame deals it whole', async t => {
  const engine = engineFor(t);
  const CARDS = engine.acc.CARDS;
  const ids = new Set(CARDS.map(c => c.id));
  assert.equal(ids.size, CARDS.length, 'card ids are unique');
  /* The header comment and shipped table both describe 24 cards. */
  assert.equal(CARDS.length, 24, `the deck deals ${CARDS.length} cards (update when the set changes)`);
  for (const c of CARDS) {
    assert.ok(c.title && c.icon && typeof c.text === 'string', `${c.id}: labelled for the ticker`);
    assert.equal(typeof c.run, 'function', `${c.id}: run() exists`);
    assert.ok(engine.acc.CARDBYID[c.id] === c, `${c.id}: indexed in CARDBYID`);
  }
  const S = await makeGame(engine, 2);
  assert.equal(S.deck.length, CARDS.length, 'initGame deals the whole deck');
  assert.deepEqual([...S.deck].sort(), [...engine.acc.CARDS].map(c => c.id).sort(),
    'the shuffled deck is exactly the card set');
});

/* ================= RC-02b — every card runs clean ================= */
let _cards = null;
function CARD_IDS() {
  if (_cards) return _cards;
  const e = loadEngine();
  _cards = e.acc.CARDS.map(c => c.id);
  e.dispose();
  return _cards;
}
test('RC-02b every market event card runs on a clean table without engine errors', { timeout: 120000 }, async t => {
  for (const id of CARD_IDS()) {
    const engine = engineFor(t);
    const S = await makeGame(engine, 2);
    S.deck = [id]; S.discard = [];
    S.owner = {}; // no holders — every card must cope
    const preOver = S.over;
    await kickoff(engine, engine.f.endOfTurn());
    const errors = engine.consoleOut.error.filter(e => !String(e).includes('stale action lock'));
    assert.equal(errors.length, 0, `${id}: runs without errors (${JSON.stringify(errors)})`);
    assert.deepEqual([...S.discard], [id], `${id}: consumed exactly once`);
    assert.equal(S.deck.length, 0, `${id}: the dealing deck emptied`);
    assert.equal(S.over, preOver, `${id}: no global side effects on an empty table`);
  }
});

async function kickoff(engine, flowPromise) {
  for (let i = 0; i < 20; i++) {
    const done = await Promise.race([flowPromise.then(() => true), Promise.resolve(false)]);
    if (done) break;
    engine.clock.advance(200);
    await settle();
  }
  await flowPromise;
  await settle();
}

/* ================= RC-03 — behaviour-driven action costs ================= */
async function fresh(t) {
  const e = engineFor(t);
  const S = await makeGame(e, 2);
  assert.equal(e.acc.Net.myIdx, 0);
  quietDeck(e.acc.S);
  return e;
}
const quietDeck = S => { S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = []; };
const armAction = engine => { const S = engine.acc.S; S.cur = 0; S.phase = 'action'; };
/* rival owns westpac+anz: income 2+2, no synergy ⇒ startTurn pays 3+4 = $7 */
const giveRivalBanks = S => { S.owner.westpac = 1; S.owner.anz = 1; };
const giveActorTwoNodes = S => { S.owner.citi = 0; S.owner.commbank = 0; };

test('RC-03a movement-side actions: favor 1🛈→+1 step, slip $2→+2 steps, fly $3 anywhere', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.cur = 0;

  // Favor: 1 Intel → +1 step (once per turn). No chain — settles immediately.
  S.phase = 'move'; S.steps = 3; S.players[0].intel = 2;
  const pre = S.players[0].money;
  await engine.f.applyIntent(0, { act: 'favor' });
  await settle();
  assert.equal(S.players[0].intel, 1, 'favor costs exactly 1 Intel');
  assert.equal(S.extraStep, true);
  assert.equal(S.steps, 4, '+1 step granted');
  assert.equal(S.players[0].money, pre, 'a favor is free cash-wise');
  assert.equal(S.phase, 'move', 'no end-of-turn follows a favor');

  // Slipstream: $2 → +2 steps (F1 owner only). No chain.
  S.owner.f1 = 0;
  await engine.f.applyIntent(0, { act: 'slip' });
  await settle();
  assert.equal(S.players[0].money, pre - 2, 'slipstream costs exactly $2');
  assert.equal(S.slipped, true);
  assert.equal(S.steps, 6, '+2 steps on top of the favored 4');

  // Qantas jet: $3 to land anywhere (grounded on turn 1).
  S.owner.qantas = 0;
  S.turn = 2; // grounded on the first turn
  S.players[0].money = 20;
  await engine.f.applyIntent(0, { act: 'flymode' });
  await settle();
  assert.equal(S.mode, 'fly', 'flymode needs $3 and the kangaroo');
  assert.equal(S.players[0].money, 20, 'no charge until the flight lands');
  const fly = engine.f.applyIntent(0, { act: 'fly', id: 'rba' });
  engine.clock.advance(engine.acc.PROJ_PAUSE_MS + 100); /* the jet flies before the landing */
  await fly;
  await settle();
  assert.equal(S.players[0].money, 17, 'the jet costs exactly $3');
  assert.equal(S.players[0].pos, 'rba', 'lands at the chosen node');
  assert.equal(S.steps, 0, 'the jet burns the remaining steps');
  assert.equal(S.phase, 'action', 'landing ends the movement phase');
});

test('RC-03b leak: 2 Intel lands +2 Cortisol on the rival and ends the turn', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  giveRivalBanks(S);
  S.players[0].intel = 3; S.players[0].money = 20; S.players[1].cortisol = 0;
  armAction(engine);
  await engine.f.applyIntent(0, { act: 'leakmode' });
  await settle();
  assert.equal(S.mode, 'leak', 'leakmode needs 2 Intel');
  const pre0 = S.players[0].money, pre1 = S.players[1].money;
  await engine.f.applyIntent(0, { act: 'leak', target: 1 });
  await settle();
  assert.equal(S.players[0].intel, 1, 'leak costs exactly 2 Intel');
  assert.equal(S.players[1].cortisol, 2, 'leaks land +2 Cortisol');
  assert.equal(S.players[0].money, pre0 + 2, 'chain: the quiet quarter still pays');
  assert.equal(S.players[1].money, pre1 + 2 + 7, 'chain quiet + rival startTurn income');
  assert.ok(S.log.some(l => l.includes('leaks dirt on')), 'the table saw the leak');
  assert.equal(S.phase, 'move', 'the turn rolled over');
});

test('RC-03c spy: 2 Intel peeks the top card without ending the turn', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.players[0].intel = 5;
  armAction(engine);
  const pre0 = S.players[0].money, pre1 = S.players[1].money;
  await engine.f.applyIntent(0, { act: 'spy' });
  await settle();
  assert.equal(S.players[0].intel, 3, 'spy costs exactly 2 Intel');
  assert.equal(S.deck.length, 4, 'the peek does not consume the card');
  assert.equal(S.discard.length, 0);
  assert.equal(S.players[0].money, pre0, 'no money moves');
  assert.equal(S.players[1].money, pre1, 'no turn ended — the other seat gains nothing');
  assert.equal(S.phase, 'action', 'still the actor\u2019s action phase');
  assert.ok(S.log.some(l => l.includes('buys a look at tomorrow')), 'the table saw the peek');
});

test('RC-03d dossier: 3 Intel makes this turn\u2019s takeovers list price and persists (no chain)', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.players[0].intel = 3;
  armAction(engine);
  const pre0 = S.players[0].money;
  await engine.f.applyIntent(0, { act: 'dossier' });
  await settle();
  assert.equal(S.players[0].intel, 0, 'dossier costs exactly 3 Intel');
  assert.equal(S.dossier, true, 'the dossier is open for the turn');
  assert.equal(S.players[0].money, pre0, 'dossiers are free cash-wise');
  assert.equal(S.phase, 'action', 'the turn did not roll over');
  assert.ok(S.log.some(l => l.includes('THE DOSSIER')), 'the table saw the dossier open');
});

test('RC-03e mass panic: 5 Intel gives the whole table +2 Cortisol and ends the turn', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  giveRivalBanks(S); giveActorTwoNodes(S); // both seats own >1 node so cortisol can land
  S.players[0].intel = 5; S.players[0].money = 20; S.players[1].cortisol = 0;
  armAction(engine);
  const pre0 = S.players[0].money, pre1 = S.players[1].money;
  await engine.f.applyIntent(0, { act: 'masspanic' });
  await settle();
  assert.equal(S.players[0].intel, 0, 'mass panic costs exactly 5 Intel');
  assert.equal(S.players[0].cortisol, 2, 'the panicker panics too');
  assert.equal(S.players[1].cortisol, 2, 'so does everyone else');
  assert.equal(S.players[0].money, pre0 + 2, 'chain: the quiet quarter still pays');
  assert.equal(S.players[1].money, pre1 + 2 + 7, 'chain quiet + rival startTurn income');
  assert.ok(S.log.some(l => l.includes('MASS PANIC')), 'the table saw the panic');
});

test('RC-03f audit: $4 pins +1 Cortisol on the rival and ends the turn', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  giveRivalBanks(S);
  S.owner.asic = 0;
  S.players[0].money = 20; S.players[1].cortisol = 0;
  armAction(engine);
  S.mode = 'audit'; // the UI opens this mode via auditmode; the net-intent only carries the strike
  const pre1 = S.players[1].money;
  await engine.f.applyIntent(0, { act: 'audit', target: 1 });
  await settle();
  assert.equal(S.players[0].money, 20 - 4 + 2, 'audit costs exactly $4 (quiet quarter pays back 2)');
  assert.equal(S.players[1].cortisol, 1, 'the audited rival takes +1 Cortisol');
  assert.equal(S.players[1].money, pre1 + 9, 'the turn rolled to the rival with quiet + income');
  assert.ok(S.log.some(l => l.includes('sends the regulator after')), 'the table saw the audit');
});

test('RC-03g tweet: $2 burns the greater of 3 or 50% of the target\u2019s Intel', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.players[0].money = 20; S.players[1].intel = 4;
  armAction(engine);
  S.mode = 'tweet'; // UI opens via tweetmode (trump holder)
  await engine.f.applyIntent(0, { act: 'tweet', target: 1 });
  await settle();
  assert.equal(S.players[0].money, 20 - 2 + 2, 'tweet costs exactly $2');
  assert.equal(S.players[1].intel, 1, '4 Intel → the greater of 3 or 2 → loses 3');
  assert.ok(S.log.some(l => l.includes('(the greater of 3 or 50%)')), 'the copy says the rule');
});

test('RC-03g2 tweet on a small cache burns it whole', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.players[0].money = 20; S.players[1].intel = 2;
  armAction(engine);
  S.mode = 'tweet';
  await engine.f.applyIntent(0, { act: 'tweet', target: 1 });
  await settle();
  assert.equal(S.players[1].intel, 0, '2 Intel → max(3, 1) is clamped to everything they had');
  assert.equal(S.players[0].money, 20, 'still $2 a tweet');
});

test('RC-03h roast: $3 in the press, $2 on the fox, +1 Cortisol, ends the turn', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  giveRivalBanks(S);
  S.players[0].money = 20; S.players[1].cortisol = 0;
  armAction(engine);
  S.mode = 'roast'; // press by default
  await engine.f.applyIntent(0, { act: 'roast', target: 1 });
  await settle();
  assert.equal(S.players[0].money, 20 - 3 + 2, 'a press roast costs exactly $3');
  assert.equal(S.players[1].cortisol, 1, 'roasts land +1 Cortisol');
  assert.ok(S.log.some(l => l.includes('roasts')), 'the table saw the roast');
});

test('RC-03i roast on the fox edition costs exactly $2', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.spinKind = 'fox';
  S.players[0].money = 20;
  armAction(engine);
  S.mode = 'roast';
  await engine.f.applyIntent(0, { act: 'roast', target: 1 });
  await settle();
  assert.equal(S.players[0].money, 20 - 2 + 2, 'a fox roast costs exactly $2');
});

test('RC-03j cook: $3 cools 3 Cortisol and ends the turn', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.owner.rock = 0;
  S.players[0].money = 20; S.players[0].cortisol = 3;
  armAction(engine);
  await engine.f.applyIntent(0, { act: 'cook' });
  await settle();
  assert.equal(S.players[0].money, 20 - 3 + 2, 'cooking costs exactly $3');
  assert.equal(S.players[0].cortisol, 0, 'a very warm kitchen cools 3 Cortisol');
  assert.ok(S.log.some(l => l.includes('cooks the books')), 'the table saw the cooking');
  assert.equal(S.phase, 'move', 'the turn rolled over');
});

test('RC-03k budget night: $3, every rival pays the Treasurer $1, +1 Intel, ends the turn', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.owner.gov = 0;
  S.players[0].money = 20; S.players[0].intel = 2; S.players[1].money = 15;
  armAction(engine);
  await engine.f.applyIntent(0, { act: 'budget' });
  await settle();
  /* payTo(i,1,pi): each rival PAYS $1 to the Treasurer — “the Treasurer collects”. */
  assert.equal(S.players[0].money, 20 - 3 + 1 + 2, '−$3 out, +$1 collected, +$2 quiet quarter');
  assert.equal(S.players[1].money, 15 - 1 + 2 + 3, '−$1 tribute, +$2 quiet, +$3 salary');
  assert.equal(S.players[0].intel, 3, 'the Treasurer saw the numbers first: +1 Intel');
  assert.ok(S.log.some(l => l.includes('BUDGET NIGHT')), 'the table saw the budget night');
});

test('RC-03l backroom pressure: free, rivals take +1 Cortisol and the turn ends', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.owner.back = 0;
  giveRivalBanks(S);
  assert.equal(engine.f.abilityPhase(0), true, 'the action phase is an ability phase');
  S.players[0].money = 20; S.players[1].cortisol = 0;
  armAction(engine);
  const pre1 = S.players[1].money;
  await engine.f.applyIntent(0, { act: 'pressure' });
  await settle();
  assert.equal(S.players[0].money, 22, 'leaning is free (quiet quarter still pays)');
  assert.equal(S.players[1].cortisol, 1, 'every other player takes +1 Cortisol');
  assert.equal(S.players[1].money, pre1 + 9, 'the turn rolled over normally');
  assert.ok(S.log.some(l => l.includes('leans on the table')), 'the table saw the pressure');
  assert.ok(engine.acc.S.log.some(l => l.includes('TURN')), 'the turn log advanced');
});

/* ================= RC-04 — cortisol / raid constants ================= */
/* The raid is heavily covered behaviourally by tests/cortisol-raids.test.mjs
   (CR-01..CR-09: seizure order, fine math, bug pulls, hedge/group kickers).
   Here we only re-pin the addCortisol entry contract against the copy. */
test('RC-04b addCortisol caps at 9 and the raid resets it to 0 (see cortisol-raids for depth)', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.owner.citi = 0; S.owner.commbank = 0; // >1 nodes required for cortisol to land
  S.players[0].money = 100; S.players[0].intel = 7; S.players[0].cortisol = 7;
  engine.f.addCortisol(0, 5, 'stress test');
  assert.ok(S.log.some(l => l.includes('(now 9)')), 'cortisol is capped at 9, not 12');
  assert.equal(S.players[0].raided, 1, 'the raid fires AT 9, not above');
  assert.equal(S.owner.citi === undefined && S.owner.commbank === undefined, true,
    'the holdings are seized');
  assert.equal(S.players[0].money, 100 - 30, 'the fine is max($5, 30%) ⇒ $30 at $100');
  assert.equal(S.players[0].intel, 1, 'the intel network burns down to 1');
  assert.equal(S.players[0].cortisol, 0, 'cortisol resets to 0 under caution');
  assert.ok(engine.modalRec.some(m => m.title.includes('REGULATOR RAID')), 'the table was told');
});

test('RC-04c small accounts take the $5 minimum fine', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.owner.citi = 0; S.owner.commbank = 0;
  S.players[0].money = 10; S.players[0].cortisol = 9;
  engine.f.addCortisol(0, 1, 'stress test');
  assert.equal(S.players[0].money, 5, 'the minimum fine is $5 (10×30% = 3 is below it)');
});

/* ================= RC-05 — MADE cash & the sisyphus boulder ================= */
test('RC-05 the sisyphus boulder pays the advertised doubling each push', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.players[0].pos = 'sisy'; S.owner.sisy = 0;
  S.players[0].money = 20;
  armAction(engine);
  await engine.f.applyIntent(0, { act: 'push' });
  await settle();
  assert.equal(S.players[0].money, 20 + 10 + 2, 'first push pays the $10 base (+ quiet)');
  assert.equal(S.sisyPayout, 20, 'the boulder doubles for the next push');
  assert.ok(S.log.some(l => l.includes('The next PUSH will pay $20')), 'the copy announces the doubling');
  armAction(engine); S.players[0].money = 30;
  await engine.f.applyIntent(0, { act: 'push' });
  await settle();
  assert.equal(S.players[0].money, 30 + 20 + 2, 'second push pays the doubled $20');
  assert.equal(S.sisyPayout, 40, 'and doubles again — uncapped');
});

test('RC-05b divest MADE costs 5 Intel + $7 compensation to the former owner', async t => {
  const engine = await fresh(t);
  const S = engine.acc.S;
  S.owner.made = 1;
  S.players[0].intel = 5; S.players[0].money = 20; S.players[1].money = 10;
  engine.queueModal(1); // confirm the divestment when asked
  armAction(engine);
  await engine.f.applyIntent(0, { act: 'divestmade' });
  await settle();
  const madePaidDuringTurn = S.log.some(l => l.includes('MADE pays out'));
  assert.equal(S.players[0].intel, madePaidDuringTurn ? 1 : 0, 'divestment spends 5 Intel; the ordinary MADE payout may return 1');
  assert.equal(S.players[0].money, 20 - 7 + 2, 'exactly $7 out (+ quiet quarter)');
  assert.equal(S.players[1].money, 10 + 7 + 2 + 3, 'the former owner pockets the $7 compensation (+ turn income)');
  assert.equal(S.owner.made, undefined, 'MADE is removed from all ownership');
  assert.ok(S.log.some(l => l.includes('paying $7 compensation')), 'the table saw the divestment');
});

/* ================= RC-06 — win types & the goal clamp ================= */
test('RC-06 exactly seven win types exist and the goal clamps 20..999 with default 100', t => {
  const engine = engineFor(t);
  assert.deepEqual([...engine.acc.WIN_TYPES], ['BANK', 'REGULATOR', 'CHART', 'WILD', 'CORPORATE', 'COMMODITY', 'MEDIA']);
  assert.equal(engine.acc.GOAL_MIN, 20);
  assert.equal(engine.acc.GOAL_MAX, 999);
  assert.equal(engine.acc.GOAL_DEF, 100);
  assert.equal(engine.f.clampGoal(5), 20, 'the floor is $20');
  assert.equal(engine.f.clampGoal(5000), 999, 'the ceiling is $999');
  assert.equal(engine.f.clampGoal(0), 100, 'garbage falls back to the default');
  assert.equal(engine.f.clampGoal(120), 120);
  const raw = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  assert.ok(raw.includes('type="number" min="20" max="999" step="5" value="100"'),
    'the lobby goal input exposes the same 20..999/100 contract');
});

/* ================= RC-07 — dead reference audit ================= */
test('RC-07 every S.owner/own() node reference maps to a real node or a known removal', t => {
  const engine = engineFor(t);
  /* Base world at load (DLC off) plus the DLC id list — the DLC world is
     rebuilt on demand, so the static audit unions its ids explicitly. */
  const nodeIds = new Set(engine.acc.NODES.map(n => n.id));
  engine.acc.GEO_NODE_IDS.forEach(id => nodeIds.add(id));
  const removedMatch = SOURCE.match(/REMOVED_NODE_IDS=new Set\(\[([^\]]+)\]/);
  assert.ok(removedMatch, 'the removed-node list exists in the source');
  const removed = new Set([...removedMatch[1].matchAll(/'(\w+)'/g)].map(m => m[1]));

  const refs = new Set();
  for (const m of SOURCE.matchAll(/S\.owner\.(\w+)/g)) refs.add(m[1]);
  for (const m of SOURCE.matchAll(/own\('(\w+)'\)/g)) refs.add(m[1]);
  const dead = [...refs].filter(id => !nodeIds.has(id) && !removed.has(id));
  assert.deepEqual(dead, [], `no unreconciled node references: ${dead.join(', ') || 'none'}`);

  /* Informational: references into removed nodes are known drift, not failures. */
  const toRemoved = [...refs].filter(id => removed.has(id)).sort();
  console.log(`    informational: ${toRemoved.length} reference(s) inside the removed-node set: ${toRemoved.join(', ') || 'none'}`);
  assert.ok(SOURCE.includes('Mark Watson</b>') && SOURCE.includes('COAL industry'), 'help copy describes Watson\'s COAL exemption');
  assert.ok(SOURCE.includes('pays 15% of their cash. No Cortisol is added.'), 'MADE tooltip matches the 15% cash-cut mechanic');
  assert.ok(!SOURCE.includes('data-act="scrub"') && !SOURCE.includes('case \'scrub\'') && !SOURCE.includes('Scrub</b>'), 'unreachable Scrub action is removed from engine, UI and help');
  assert.ok(SOURCE.includes('LOW CORTISOL') && !SOURCE.includes('HORNSBY HEIGHTS'), 'room-code examples come from the buzzword pool');
  assert.ok(SOURCE.includes('Sell intel</b> (your action, anywhere)'), 'sell Intel copy matches its global action');
  assert.ok(SOURCE.includes('the CASH-RATE and INFLATION charts'), 'chart exception copy describes the monetary-policy exception');
});
