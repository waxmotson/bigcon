/*
 * The regulators' files — the ACCC/ASIC concentration rule as a visible
 * investigation, plus player-to-player node deals.
 *
 * Thresholds, the file lifecycle and rulings are pinned in tests/economy.test.mjs
 * (EC-08*). This file covers what the table can DO about a file: sell to the
 * market, lobby, refer a rival (ACCC vs ASIC), the MONOPOLY ALERT card, node
 * deals (accept / decline / validation), and the same intents arriving
 * malformed over the guest wire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

/* Fresh 3-seat base game: seat 0 = host actor, seats 1-2 are auto-answering guests. */
async function game(t, opts = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  const S = await makeGame(e, 3, opts);
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = {}; S.acccFiles = [];
  S.cur = 0; S.mode = null; S.phase = 'action'; S.lobbied = false; S.referred = false;
  S.players.forEach(p => { p.money = 60; p.intel = 10; p.cortisol = 0; p.pos = 'quik'; });
  return { e, S, P: S.players };
}
async function act(e, m, pi = 0) {
  let done = false;
  const run = e.f.applyIntent(pi, m).finally(() => { done = true; });
  for (let i = 0; i < 12 && !done; i++) { await settle(); e.clock.advance(50); }
  await run;
  await settle();
}
/* deliver an intent from a guest exactly as the wire does */
async function wire(e, pi, m) {
  e.f.onHostData(e.acc.Net.conns[pi], { t: 'intent', ...m });
  for (let i = 0; i < 12; i++) { await settle(); e.clock.advance(50); }
}
const give = (S, i, ids) => ids.forEach(id => { S.owner[id] = i; });
const open = (e, pi, ind, s = 0) => { e.f.acccReconcile(); const f = e.f.findFile(pi, ind); assert.ok(f, `a ${ind} file is open on seat ${pi}`); f.s = s; return f; };
const snap = S => JSON.stringify({ o: S.owner, p: S.players.map(p => [p.money, p.intel, p.cortisol]), f: S.acccFiles, c: S.cur, ph: S.phase });

/* ---------------- files are public state ---------------- */
test('AF-01 open files ride the public state and the bot view', async t => {
  const { e, S } = await game(t);
  give(S, 1, ['citi', 'commbank', 'nab']);
  open(e, 1, 'bank', 1);
  const wireState = e.f.pubState(false);
  assert.deepEqual(wireState.acccFiles, [{ pi: 1, ind: 'bank', s: 1, agency: 'ACCC' }], 'every client sees the file');
  const v = e.ctx.botView(2);
  assert.deepEqual(v.acccFiles, [{ pi: 1, ind: 'bank', s: 1, agency: 'ACCC' }], 'bots see the same file');
  const bank = v.industryIds.find(g => g.id === 'bank');
  assert.equal(bank.trigger, 3, 'the bot view carries each industry trigger');
  assert.equal(v.industryIds.find(g => g.id === 'media').trigger, 4);
});

/* ---------------- sell to the market ---------------- */
test('AF-02 market sale is gated to nodes in an open-file book', async t => {
  const { e, S, P } = await game(t);
  give(S, 0, ['citi', 'commbank', 'oil']);
  const before = snap(S);
  await act(e, { act: 'marketsell', id: 'citi' });
  assert.equal(snap(S), before, 'no file, no market sale');
  S.owner.nab = 0;
  open(e, 0, 'bank', 2);
  const b2 = snap(S);
  await act(e, { act: 'marketsell', id: 'oil' });
  assert.equal(snap(S), b2, 'oil is outside the filed book');
  await act(e, { act: 'marketsell', id: 'anz' });
  assert.equal(snap(S), b2, 'a node you do not own');
  await act(e, { act: 'marketsell', id: 'nab' });
  assert.equal(S.owner.nab, undefined, 'sold back to the market, unowned');
  assert.equal(P[0].money, 60 + e.acc.NMAP.nab.cost + 2, 'list price, then the quiet quarter');
  assert.equal(e.f.findFile(0, 'bank'), null, 'the file closed with the sale');
  assert.ok(S.log.some(l => l.includes('back to the market')));
});

/* ---------------- lobby ---------------- */
test('AF-03 lobbying: 3 Intel, −1 scrutiny, once per turn, free, own files only', async t => {
  const { e, S, P } = await game(t);
  give(S, 0, ['citi', 'commbank', 'nab']);
  give(S, 1, ['coal', 'train', 'port']);
  open(e, 0, 'bank', 2); open(e, 1, 'coal', 2);
  await act(e, { act: 'lobby', kind: 'coal' });
  assert.equal(e.f.findFile(1, 'coal').s, 2, 'you cannot lobby a rival\'s file');
  await act(e, { act: 'lobby', kind: 'bank' });
  assert.equal(e.f.findFile(0, 'bank').s, 1); assert.equal(P[0].intel, 7);
  assert.equal(S.phase, 'action'); assert.equal(S.cur, 0, 'a free op — the action is still yours');
  await act(e, { act: 'lobby', kind: 'bank' });
  assert.equal(e.f.findFile(0, 'bank').s, 1, 'once per turn'); assert.equal(P[0].intel, 7);
  /* a fresh turn: the flag resets; scrutiny bottoms out at 0 */
  S.lobbied = false; e.f.findFile(0, 'bank').s = 0;
  await act(e, { act: 'lobby', kind: 'bank' });
  assert.equal(e.f.findFile(0, 'bank').s, 0); assert.equal(P[0].intel, 7, 'no Intel spent at 0 scrutiny');
  S.lobbied = false; e.f.findFile(0, 'bank').s = 2; P[0].intel = 2;
  await act(e, { act: 'lobby', kind: 'bank' });
  assert.equal(e.f.findFile(0, 'bank').s, 2, 'needs 3 Intel');
});
test('AF-04 the lobby flag resets at the next turn start', async t => {
  const { e, S } = await game(t);
  S.lobbied = true; S.referred = true;
  await act(e, { act: 'laylow', choice: 'cash' });
  assert.equal(S.cur, 1);
  assert.equal(S.lobbied, false); assert.equal(S.referred, false);
});

/* ---------------- refer ---------------- */
test('AF-05 ACCC refers non-monetary files; ASIC refers monetary files; never your own; once per turn', async t => {
  const { e, S, P } = await game(t);
  give(S, 1, ['citi', 'commbank', 'nab']);           // ACCC's file
  give(S, 2, ['rba', 'cash', 'bullock']);            // ASIC's file
  give(S, 0, ['coal', 'train', 'port']);             // my own file
  open(e, 1, 'bank', 0); open(e, 2, 'monetary', 0); open(e, 0, 'coal', 0);
  S.owner.accc = 0;
  const b = snap(S);
  await act(e, { act: 'refer', target: 2, kind: 'monetary' });
  assert.equal(snap(S), b, 'the ACCC cannot refer a monetary-policy file');
  await act(e, { act: 'refer', target: 0, kind: 'coal' });
  assert.equal(snap(S), b, 'you cannot refer your own file');
  await act(e, { act: 'refer', target: 1, kind: 'coal' });
  assert.equal(snap(S), b, 'no file there');
  S.referred = true;
  await act(e, { act: 'refer', target: 1, kind: 'bank' });
  assert.equal(snap(S), b, 'once per turn');
  S.referred = false;
  await act(e, { act: 'refer', target: 1, kind: 'bank' });
  assert.ok(S.log.some(l => l.includes('refers') && l.includes('BANKING')), 'the referral is on the record');
  assert.equal(P[0].money, 60 - 4 + 2, '$4, then the quiet quarter');
  assert.equal(e.f.findFile(1, 'bank').s, 2, '+1 from the referral, +1 at the offender\'s turn start — no ruling at 2');
  assert.equal(S.owner.citi, 1, 'a referral never rules immediately');
});
test('AF-06 ASIC owner refers a monetary file; a referral to 3 waits for the offender\'s turn start', async t => {
  const { e, S, P } = await game(t);
  give(S, 1, ['rba', 'cash', 'bullock']);
  S.owner.asic = 0;
  open(e, 1, 'monetary', 2);
  await act(e, { act: 'refermode' });
  assert.equal(S.mode, 'refer');
  /* hold seat 1's ruling prompt answer: the default keeps the best two */
  await act(e, { act: 'refer', target: 1, kind: 'monetary' });
  assert.ok(S.log.some(l => l.includes('refers') && l.includes('MONETARY POLICY') && l.includes('scrutiny 3/3')), 'referred to 3');
  const ruling = S.log.findIndex(l => l.includes('MARKET MANIPULATION!'));
  const turnLine = S.log.findIndex(l => l.includes('—— TURN') && l.includes(S.players[1].name));
  assert.ok(ruling > turnLine && turnLine >= 0, 'the ruling lands at the offender\'s turn start, not on the referral');
  assert.equal(e.f.ownedInIndustry(1, e.acc.INDBYID.monetary).length, 2);
  assert.equal(P[0].money, 60 - 4 + 2);
});

/* ---------------- the MONOPOLY ALERT card ---------------- */
test('AF-07 MONOPOLY ALERT: every open file +1 scrutiny, no ruling, Big Short pays; empty table logs the miss', async t => {
  const { e, S, P } = await game(t);
  const card = e.acc.CARDBYID.crackdown;
  assert.ok(/scrutiny/.test(card.text), 'the card text describes the sweep');
  S.owner.bigshort = 2;
  await card.run();
  assert.ok(S.log.some(l => l.includes('no open files')), 'nothing to sweep is logged');
  assert.equal(S.mood, 'PANIC');
  give(S, 1, ['citi', 'commbank', 'nab']); give(S, 0, ['coal', 'train', 'port']);
  open(e, 1, 'bank', 2); open(e, 0, 'coal', 0);
  const m2 = P[2].money;
  await card.run();
  assert.equal(e.f.findFile(1, 'bank').s, 3); assert.equal(e.f.findFile(0, 'coal').s, 1);
  assert.equal(S.owner.citi, 1, 'no ruling from the card itself');
  assert.equal(P[2].money, m2 + 3, 'the cinema still calls it');
  const face = e.ctx.cardFace(card);
  assert.ok(face.includes('./static/accc.png'), 'the card keeps the ACCC face');
});

/* ---------------- node deals ---------------- */
test('AF-08 a deal: accept moves cash and the node, clears bugs, adds no Cortisol, keeps the takeover counter', async t => {
  const { e, S, P } = await game(t);
  give(S, 0, ['citi', 'anz']); give(S, 1, ['nab', 'westpac']);
  S.bugs.citi = 2; S.seizeCount.citi = 3;
  await act(e, { act: 'deal', id: 'citi', target: 1, n: 15 });
  assert.equal(S.owner.citi, 1);
  assert.equal(S.bugs.citi, undefined, 'bugs on the node are cleared');
  assert.equal(S.seizeCount.citi, 3, 'the hostile-takeover inflation counter is untouched');
  assert.equal(P[0].money, 60 + 15 + 2, 'seller +$15 (then the quiet quarter)');
  assert.equal(P[0].cortisol, 0, 'no Cortisol for the seller');
  assert.equal(P[1].cortisol, 0, 'no Cortisol for the buyer');
  assert.ok(S.log.some(l => l.includes('offers CITI')), 'the offer is on the record');
  assert.ok(S.log.some(l => l.includes('DEAL DONE')), 'and the outcome');
  const prompt = e.acc.Net.conns[1].sent.find(m => m.t === 'prompt');
  assert.ok(prompt && prompt.title.startsWith('DEAL OFFERED'), 'the buyer got a private prompt');
  assert.ok(!e.acc.Net.conns[2].sent.some(m => m.t === 'prompt'), 'nobody else did');
});
test('AF-09 a declined deal changes nothing but still uses the action', async t => {
  const { e, S, P } = await game(t, { answers: [0] });
  give(S, 0, ['citi', 'anz']);
  await act(e, { act: 'deal', id: 'citi', target: 1, n: 15 });
  assert.equal(S.owner.citi, 0);
  assert.equal(P[0].money, 62); assert.equal(P[1].money >= 60 + 2, true);
  assert.ok(S.log.some(l => l.includes('declines')));
  assert.equal(S.cur, 1, 'the turn moved on');
});
test('AF-10 an away buyer declines by default', async t => {
  const { e, S } = await game(t);
  give(S, 0, ['citi', 'anz']);
  e.acc.Net.conns[1].open = false; S.players[1].dc = true;
  await act(e, { act: 'deal', id: 'citi', target: 1, n: 0 });
  assert.equal(S.owner.citi, 0);
  assert.ok(S.log.some(l => l.includes('declines')));
});
test('AF-11 deal validation: rival only, own node only, whole-dollar price within the buyer\'s cash', async t => {
  const { e, S, P } = await game(t);
  give(S, 0, ['citi', 'anz']); give(S, 1, ['nab']);
  P[1].money = 20;
  const b = snap(S);
  for (const bad of [
    { id: 'citi', target: 0, n: 5 },            // yourself
    { id: 'citi', target: 7, n: 5 },            // no such seat
    { id: 'citi', target: '1', n: 5 },          // a string seat
    { id: 'nab', target: 2, n: 5 },             // not your node
    { id: 'nope', target: 1, n: 5 },            // not a node
    { id: 'citi', target: 1, n: 21 },           // more than the buyer has
    { id: 'citi', target: 1, n: -1 },           // negative
    { id: 'citi', target: 1, n: 2.5 },          // fractional
    { id: 'citi', target: 1, n: '5' },          // a string price
    { id: 'citi', target: 1 },                  // no price
  ]) {
    await act(e, { act: 'deal', ...bad });
    assert.equal(snap(S), b, 'rejected: ' + JSON.stringify(bad));
  }
  assert.ok(!e.acc.Net.conns[1].sent.some(m => m.t === 'prompt'), 'no malformed offer reached a buyer');
  await act(e, { act: 'deal', id: 'citi', target: 1, n: 20 });
  assert.equal(S.owner.citi, 1, 'the whole of the buyer\'s cash is a valid price');
});
test('AF-12 a deal that completes the buyer\'s set and cash wins on the spot', async t => {
  const { e, S, P } = await game(t);
  /* seat 1 holds one of every type but CORPORATE, and $120 */
  give(S, 1, ['nab', 'asic', 'us', 'watson', 'oil', 'press']);
  const corp = e.acc.NODES.find(n => n.type === 'CORPORATE').id;
  give(S, 0, [corp, 'anz']);
  P[1].money = 125;
  await act(e, { act: 'deal', id: corp, target: 1, n: 5 });
  assert.equal(S.over, true, 'the buyer wins at once');
});

/* ---------------- the guest wire ---------------- */
test('AF-13 the new intents from a guest seat: valid ones apply, malformed ones change nothing', async t => {
  const { e, S, P } = await game(t);
  S.cur = 1;
  give(S, 1, ['citi', 'commbank', 'nab']); give(S, 2, ['coal', 'train', 'port']);
  S.owner.accc = 1;
  open(e, 1, 'bank', 2); open(e, 2, 'coal', 0);
  const b = snap(S);
  for (const bad of [
    { act: 'marketsell' }, { act: 'marketsell', id: 42 }, { act: 'marketsell', id: '__proto__' }, { act: 'marketsell', id: 'coal' },
    { act: 'lobby' }, { act: 'lobby', kind: { s: 0 } }, { act: 'lobby', kind: 'coal' }, { act: 'lobby', kind: 'constructor' },
    { act: 'refer' }, { act: 'refer', target: 1, kind: 'bank' }, { act: 'refer', target: 2, kind: 'bank' }, { act: 'refer', target: 2 },
    { act: 'refer', target: null, kind: 'coal' }, { act: 'refer', target: 2.5, kind: 'coal' },
    { act: 'deal', id: 'citi', target: 1, n: 1 }, { act: 'deal', id: 'citi', target: 0, n: 1e9 }, { act: 'deal', id: ['citi'], target: 0, n: 1 },
    { act: 'deal', id: 'citi', target: 0, n: null }, { act: 'deal', id: 'citi', target: 0, n: NaN },
  ]) {
    await wire(e, 1, bad);
    assert.equal(snap(S), b, 'no mutation for ' + JSON.stringify(bad));
  }
  await wire(e, 1, { act: 'lobby', kind: 'bank' });
  assert.equal(e.f.findFile(1, 'bank').s, 1, 'a well-formed lobby from the guest applies');
  await wire(e, 1, { act: 'refer', target: 2, kind: 'coal' });
  assert.ok(S.log.some(l => l.includes('refers') && l.includes('COAL')), 'a well-formed referral from the guest applies');
  assert.equal(S.cur, 2, 'and used the guest\'s action');
  /* a guest that is not in turn is told so */
  const b2 = snap(S);
  await wire(e, 1, { act: 'marketsell', id: 'citi' });
  assert.equal(snap(S), b2, 'off-turn intents are refused');
});
test('AF-14 a guest deal is offered to the host, who answers through the modal', async t => {
  const { e, S, P } = await game(t);
  S.cur = 1;
  give(S, 1, ['citi', 'anz']);
  e.queueModal(1); // the host accepts
  await wire(e, 1, { act: 'deal', id: 'citi', target: 0, n: 9 });
  assert.equal(S.owner.citi, 0, 'the host bought it');
  assert.ok(e.modalRec.some(m => m.title.startsWith('DEAL OFFERED')), 'the host saw the offer privately');
  assert.equal(P[0].money, 60 - 9 + 2);
});

/* ---------------- what the table sees ---------------- */
test('AF-15 the sidebar shows every player\'s open files and the new action buttons', async t => {
  const { e, S, P } = await game(t);
  give(S, 0, ['citi', 'commbank', 'nab']); give(S, 1, ['rba', 'cash', 'bullock']);
  S.owner.accc = 0;
  open(e, 0, 'bank', 1); open(e, 1, 'monetary', 2);
  e.ctx.renderSide();
  const html = String(e.elems.get('side').innerHTML);
  assert.ok(html.includes('🧐 ACCC file · BANKING 1/3'), 'my file is listed in the syndicate row');
  assert.ok(html.includes('⚖️ ASIC file · MONETARY POLICY 2/3'), 'a rival file is listed, with its agency');
  assert.ok(html.includes('data-act="lobby" data-kind="bank"'), 'lobby button for my file');
  assert.ok(html.includes('data-act="marketsell" data-id="nab"'), 'market-sale button for a node in the filed book');
  assert.ok(!html.includes('data-act="marketsell" data-id="rba"'), 'no market-sale button outside my filed book');
  assert.ok(html.includes('data-act="dealmode"'), 'the deal button');
  assert.ok(/data-act="refermode" disabled/.test(html), 'REFER is disabled: the ACCC cannot refer an ASIC file');
  S.owner.asic = 0; e.ctx.renderSide();
  assert.ok(/data-act="refermode" title=/.test(String(e.elems.get('side').innerHTML)), 'ASIC owner: REFER is live');
  P[0].intel = 2; e.ctx.renderSide();
  assert.ok(/data-act="lobby" data-kind="bank" disabled/.test(String(e.elems.get('side').innerHTML)), 'lobby greys out under 3 Intel');
});
test('AF-16 the help modal describes the file rule exactly — no dice, no gifting', async t => {
  const { e } = await game(t);
  e.ctx.showRules();
  const html = e.modalRec[e.modalRec.length - 1].html;
  for (const phrase of ['opens a public file', '+1 scrutiny', 'at <b>3</b> the ruling lands', 'never fewer than 3', '<b>four</b> media',
    '10% of your cash and 10% of your Intel per divested node', 'capped at 30%', 'unowned', '<b>lobby</b>', '<b>REFER</b>',
    'You can’t refer your own file', 'MONOPOLY ALERT', '<b>Offer a deal</b>', 'Mark Watson</b>', 'market manipulation']) {
    assert.ok(html.includes(phrase), 'help copy says: ' + phrase);
  }
  for (const stale of ['33% chance', 'randomly redistributed', '20% fine', 'more than two</b>']) assert.ok(!html.includes(stale), 'no stale copy: ' + stale);
  assert.ok(!/33%[^<]*(investigat|chance the regulators)/.test(html));
  const accc = e.acc.NMAP.accc.sp, asic = e.acc.NMAP.asic.sp;
  assert.ok(accc.includes('REFER') && accc.includes('$2'), 'ACCC tooltip: REFER plus the review fee');
  assert.ok(asic.includes('REFER') && asic.includes('AUDIT'), 'ASIC tooltip: REFER beside AUDIT');
});
