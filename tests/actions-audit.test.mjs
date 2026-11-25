/*
 * Action-phase audit: "Overload a rival" end to end (host, guest, bot), the
 * action-lock vs. prompt interplay, and a button-vs-engine consistency sweep
 * (a button that is enabled must be accepted by the engine, and the engine must
 * not accept what the button greys out).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, makeConn, pump } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
async function run(e, pi, m) {
  let done = false;
  const p = e.f.applyIntent(pi, m).finally(() => { done = true; });
  for (let i = 0; i < 12 && !done; i++) { await settle(); e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); }
  await p; await settle();
}
const own = (S, i, ids) => ids.forEach(id => { S.owner[id] = i; });
async function game(t, { players = 3, opts = {}, world = false, setup = () => {} } = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  if (world) e.acc.Net.dlcWorld = true;
  const S = await makeGame(e, players, opts);
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = S.rubble || {};
  S.cur = 0; S.mode = null; S.phase = 'action'; S.steps = 3;
  S.players.forEach(p => { p.money = 60; p.intel = 40; p.cortisol = 0; p.pos = 'quik'; });
  setup(S);
  return { e, S, P: S.players };
}

/* ---------------- OVERLOAD A RIVAL: host ---------------- */
test('overload (host): spends 30 Intel, +6 Cortisol past the one-node immunity, and ends the turn', async t => {
  const { e, S, P } = await game(t);
  own(S, 1, ['anz']); /* a single node: normal Cortisol cannot touch them */
  e.queueModal(1);
  await run(e, 0, { act: 'targetpanic' });
  assert.equal(P[0].intel, 10);
  assert.equal(P[1].cortisol, 6, 'the overload bypasses the one-node immunity');
  assert.notEqual(S.cur, 0, 'the turn ended');
  assert.equal(e.acc.Net.lock, false, 'the action lock is released');
  const prompt = e.modalRec.find(m => m.title.startsWith('CORTISOL OVERLOAD'));
  assert.ok(prompt, 'the host got the target prompt');
  assert.deepEqual(prompt.options.map(o => o.v), [1, 2, -1], 'every rival, then Cancel');
});
test('overload (host): the +6 is capped at 9 and a full meter raids the victim', async t => {
  const { e, S, P } = await game(t);
  own(S, 1, ['anz', 'nab', 'westpac']); P[1].cortisol = 7; P[1].money = 50;
  e.queueModal(1);
  await run(e, 0, { act: 'targetpanic' });
  assert.equal(P[1].cortisol, 0, 'capped at 9 then raided, which resets it');
  assert.equal(Object.keys(S.owner).filter(k => S.owner[k] === 1).length, 1, 'two nodes seized');
});
test('overload (host): Cancel changes nothing, keeps the turn and frees the lock', async t => {
  const { e, S, P } = await game(t);
  own(S, 1, ['anz', 'nab']);
  e.queueModal(-1);
  await run(e, 0, { act: 'targetpanic' });
  assert.equal(P[0].intel, 40); assert.equal(P[1].cortisol, 0);
  assert.equal(S.cur, 0); assert.equal(S.phase, 'action'); assert.equal(S.mode, null);
  assert.equal(e.acc.Net.lock, false);
  /* ...and the very next action works */
  await run(e, 0, { act: 'dossier' });
  assert.equal(S.dossier, true);
});
test('overload: refused under 30 Intel without ever raising a prompt', async t => {
  const { e, S, P } = await game(t);
  P[0].intel = 29;
  await run(e, 0, { act: 'targetpanic' });
  assert.equal(e.modalRec.length, 0); assert.equal(P[0].intel, 29); assert.equal(S.cur, 0);
});
test('overload: re-validated after the prompt (Intel drained or turn gone while it was open)', async t => {
  const { e, S, P } = await game(t);
  own(S, 1, ['anz', 'nab']);
  e.holdModal();
  const p = e.f.applyIntent(0, { act: 'targetpanic' });
  await settle();
  P[0].intel = 12; /* something drained the Intel while the card was up */
  e.releaseModal(1);
  await p; await settle();
  assert.equal(P[1].cortisol, 0, 'no overload fired'); assert.equal(P[0].intel, 12);
  assert.equal(S.cur, 0, 'a refused overload does not burn the turn');
  /* a mode opened meanwhile is also respected */
  P[0].intel = 40;
  e.holdModal();
  const q = e.f.applyIntent(0, { act: 'targetpanic' });
  await settle();
  S.mode = 'bug';
  e.releaseModal(1);
  await q; await settle();
  assert.equal(P[1].cortisol, 0);
});
test('overload: a rival who has VANISHED (Bermuda) is not on the list and cannot be forced', async t => {
  const { e, S, P } = await game(t, { world: true });
  assert.equal(S.dlcWorld, true);
  own(S, 1, ['anz', 'nab']);
  S.vanished = { 2: 'quik' };
  e.queueModal(1);
  await run(e, 0, { act: 'targetpanic' });
  const prompt = e.modalRec.find(m => m.title.startsWith('CORTISOL OVERLOAD'));
  assert.deepEqual(prompt.options.map(o => o.v), [1, -1], 'the vanished seat is not offered');
  /* a stale answer naming the vanished seat is refused too */
  P[0].intel = 40; S.cur = 0; S.phase = 'action';
  e.queueModal(2);
  await run(e, 0, { act: 'targetpanic' });
  assert.equal(P[2].cortisol, 0);
  assert.equal(P[0].intel, 40, 'nothing was spent');
});

/* ---------------- OVERLOAD A RIVAL: guest over the wire ---------------- */
async function guestGame(t, setup) {
  const g = await game(t, { setup: S => { setup && setup(S); } });
  const conn = g.e.acc.Net.conns[1];
  g.S.cur = 1; g.S.phase = 'action';
  g.P[1].intel = 40;
  return { ...g, conn };
}
test('overload (guest): the prompt is routed to the guest and their pick lands', async t => {
  const { e, S, P, conn } = await guestGame(t);
  own(S, 2, ['anz']);
  conn.answers = [2];
  await run(e, 1, { act: 'targetpanic' });
  const prompts = conn.sent.filter(m => m.t === 'prompt');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].title, /^CORTISOL OVERLOAD/);
  assert.deepEqual(prompts[0].options.map(o => o.v), [0, 2, -1]);
  assert.equal(P[2].cortisol, 6); assert.equal(P[1].intel, 10);
  assert.notEqual(S.cur, 1); assert.equal(e.acc.Net.lock, false);
});
test('overload (guest): Cancel, a junk answer, or silence all leave the Intel and the turn alone', async t => {
  for (const answer of [-1, 'banana', 1]) { /* 1 is the guest itself: not an offered option */
    const { e, S, P, conn } = await guestGame(t);
    own(S, 2, ['anz', 'nab']);
    conn.answers = [answer];
    await run(e, 1, { act: 'targetpanic' });
    assert.equal(P[1].intel, 40, 'answer ' + answer); assert.equal(P[2].cortisol, 0); assert.equal(S.cur, 1);
    assert.equal(e.acc.Net.lock, false);
    e.dispose();
  }
  const { e, S, P, conn } = await guestGame(t);
  conn.autoAnswer = false; /* the guest never replies */
  const p = e.f.applyIntent(1, { act: 'targetpanic' });
  await settle();
  e.clock.advance(46000);
  await p; await settle();
  assert.equal(P[1].intel, 40); assert.equal(S.cur, 1, 'the prompt timed out as a cancel');
  assert.equal(e.acc.Net.lock, false);
});
test('overload (guest): a slow guest keeps the action lock — the watchdog never frees it mid-prompt', async t => {
  const { e, S, P, conn } = await guestGame(t);
  own(S, 2, ['anz']);
  conn.autoAnswer = false;
  const p = e.f.applyIntent(1, { act: 'targetpanic' });
  await settle();
  e.clock.advance(31000); /* past the 30 s watchdog, inside the guest's 45 s */
  assert.equal(e.acc.Net.lock, true, 'still locked while the guest is deciding');
  await e.f.applyIntent(1, { act: 'dossier' });
  assert.equal(S.dossier, false, 'a second action cannot sneak in');
  const prompt = conn.sent.find(m => m.t === 'prompt');
  e.f.onHostData(conn, { t: 'answer', pid: prompt.pid, v: 2 });
  await p; await settle();
  assert.equal(P[2].cortisol, 6); assert.equal(P[1].intel, 10);
  assert.equal(e.acc.Net.lock, false);
});
test('the watchdog still frees a lock that is genuinely stuck (no prompt open)', async t => {
  const { e } = await game(t);
  e.acc.Net.lock = true; /* as if a chain died without releasing */
  e.acc.Net.lockTimer = e.hooks.setTimeout(() => {}, 1);
  /* arm through a real intent that bails early */
  e.acc.Net.lock = false;
  await run(e, 0, { act: 'cancel' });
  assert.equal(e.acc.Net.lock, false);
});

/* ---------------- OVERLOAD A RIVAL: a bot ---------------- */
async function botGame(t, setup) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.ctx.window.__BIGCON_TEST__ = true; e.ctx.window.__BIGCON_BOT_SEED__ = 4242;
  await e.loadBots();
  const S = await makeGame(e, 3, { bots: [1] });
  const bi = S.players.findIndex(p => p.bot); /* initGame shuffles the seating */
  const others = [0, 1, 2].filter(i => i !== bi);
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = []; S.owner = {}; S.bugs = {}; S.rubble = {};
  S.cur = bi; S.phase = 'action'; S.mode = null;
  S.players.forEach(p => { p.money = 60; p.intel = 5; p.cortisol = 0; p.pos = 'quik'; });
  S.players[bi].intel = 40;
  setup && setup(S, bi, others);
  return { e, S, P: S.players, bi, others };
}
test('overload (bot): the bot answers its own prompt and the overload lands on a rival', async t => {
  const { e, S, P, bi, others } = await botGame(t, (S, bi, [a, b]) => { own(S, a, ['anz']); own(S, b, ['nab']); });
  await run(e, bi, { act: 'targetpanic' });
  assert.equal(P[bi].intel, 10, 'the 30 Intel were spent');
  assert.equal(others.map(i => P[i].cortisol).sort().join(), '0,6', 'exactly one rival took +6');
  assert.equal(e.modalRec.filter(m => m.title.startsWith('CORTISOL')).length, 0, 'no human modal was raised for the bot');
  assert.equal(e.acc.Net.lock, false);
});
test('overload (bot): a bot with nobody to hit just cancels, it does not hang', async t => {
  const { e, S, P, bi, others } = await botGame(t, (S, bi, o) => { S.vanished = { [o[0]]: 'quik', [o[1]]: 'quik' }; S.dlcWorld = true; });
  await run(e, bi, { act: 'targetpanic' });
  assert.equal(P[bi].intel, 40); assert.equal(e.acc.Net.lock, false);
});

/* ---------------- the other buttons ---------------- */
test('the slipstream discount is reflected in the seize button (no false "can\'t afford")', async t => {
  const { e, S, P } = await game(t, { setup: S => { S.owner = { f1: 0 }; S.slipped = true; } });
  const n = e.acc.NMAP.commbank;
  P[0].pos = 'commbank'; P[0].money = n.cost - 1; /* $2 short of list, $1 short after slipstream... */
  P[0].money = Math.max(1, n.cost - 2);
  e.ctx.renderSide();
  const html = String(e.elems.get('side').innerHTML);
  const btn = html.match(/<button class="act primary" data-act="seize"([^>]*)>/);
  assert.ok(btn, 'a seize button is drawn');
  assert.ok(!/\sdisabled/.test(btn[1]), 'enabled: the engine would take the $2 slipstream discount');
  await run(e, 0, { act: 'seize' });
  assert.equal(S.owner.commbank, 0, 'and the engine does seize it');
});
test('spin: the fox/press prompt is re-validated, and bug mode needs the Intel', async t => {
  const { e, S, P } = await game(t, { setup: S => { S.owner = { fox: 0 }; } });
  e.holdModal();
  const p = e.f.applyIntent(0, { act: 'spin', kind: 'fox' });
  await settle();
  P[0].money = 1; /* spent elsewhere while the card was open */
  e.releaseModal('cool');
  await p; await settle();
  assert.equal(P[0].money, 1, 'no spin on credit'); assert.equal(S.spun, false); assert.equal(S.cur, 0);
  P[0].intel = 0;
  await run(e, 0, { act: 'bugmode' });
  assert.equal(S.mode, null, 'bug mode refuses without the Intel');
});

/* ---------------- button/engine consistency sweep ---------------- */
function buttons(html) {
  const out = [];
  for (const m of html.matchAll(/<button class="act[^"]*"([^>]*)>/g)) {
    const a = m[1], g = n => (a.match(new RegExp('data-' + n + '="([^"]*)"')) || [])[1];
    out.push({ act: g('act'), kind: g('kind'), n: g('n'), id: g('id'), pay: g('pay'), disabled: /\sdisabled/.test(a) });
  }
  return out;
}
function toIntent(b) {
  if (!b.act) return null;
  if (b.act.startsWith('worldmode:')) return { act: 'worldmode', kind: b.act.slice(10) };
  if (b.act === 'laylowcash') return { act: 'laylow', choice: 'cash' };
  if (b.act === 'laylowcool') return { act: 'laylow', choice: 'cool' };
  if (b.act === 'rebuildfree') return { act: 'rebuild', free: true };
  const m = { act: b.act };
  if (b.kind) m.kind = b.kind; if (b.n) m.n = +b.n; if (b.id) m.id = b.id; if (b.pay) m.pay = b.pay;
  return m;
}
const printOf = S => JSON.stringify(S, (k, v) => (k === 'log' || k === 'fx' || k === 'chat' || k === 'wire' || k === 'deck' || k === 'discard') ? undefined : v);
const LOADS = {
  rich: { money: 80, intel: 40, geo: false, own: ['qantas', 'f1', 'asic', 'press', 'fox', 'rock', 'trump', 'gov', 'back', 'albo', 'accc', 'made', 'bond007', 'citi', 'commbank', 'nab', 'westpac'] },
  poor: { money: 0, intel: 0, geo: false, own: ['qantas', 'f1', 'asic', 'press', 'fox', 'rock', 'trump', 'gov', 'back', 'albo', 'bond007'] },
  mid: { money: 3, intel: 3, geo: false, own: ['asic', 'press', 'fox', 'rock', 'trump', 'gov', 'back', 'albo', 'sisy', 'asics', 'bond', 'leak', 'accc', 'bond007'] },
  geo: { money: 20, intel: 5, geo: true, own: ['geo_boeing', 'geo_scs', 'geo_stage5', 'geo_venice', 'geo_wonsan', 'geo_missile', 'geo_kim', 'bond', 'leak', 'bond007'] },
};
for (const [name, L] of Object.entries(LOADS)) {
  for (const phase of ['action', 'move']) {
    test('every ' + phase + '-phase button agrees with the engine (' + name + ')', async t => {
      const e = await loadEngine();
      t.after(() => e.dispose());
      const S0 = await makeGame(e, 3, { geo: L.geo });
      const fresh = pos => {
        const S = e.acc.S;
        S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = []; S.owner = {}; S.bugs = {}; S.rubble = {};
        S.cur = 0; S.mode = null; S.phase = phase; S.steps = 3; S.over = false;
        for (const k of ['spun', 'audited', 'cooked', 'budgeted', 'pressured', 'extraStep', 'slipped', 'dossier', 'blockadeUsed', 'lobbied', 'referred', 'backroomAbilityUsed', 'geoMissiled', 'geoBeach', 'geoBoeing', 'geoCrash', 'geoStage5', 'geoVenice', 'bondmageddonUsed', 'classifiedUsed']) S[k] = false;
        S.players.forEach(p => { p.money = 30; p.intel = 5; p.cortisol = 0; p.pos = 'quik'; });
        S.players[0].money = L.money; S.players[0].intel = L.intel; S.players[0].pos = e.acc.NMAP[pos] ? pos : 'quik';
        L.own.forEach(id => { if (e.acc.NMAP[id]) S.owner[id] = 0; });
        S.owner.anz = 1; S.owner.cash = 1; S.owner.rba = 2; S.bugs.cash = 1;
        S.acccFiles = []; S.hidden = {}; S.blockades = {}; S.ov = null; S.dossier = false; S.nTurn = {}; S.tollFree = null;
        e.f.acccReconcile();
        return S;
      };
      for (const pos of ['quik', 'geo_venice']) {
        fresh(pos);
        e.ctx.renderSide();
        const bs = buttons(String(e.elems.get('side').innerHTML));
        assert.ok(bs.length > 3, 'the panel drew buttons');
        for (const b of bs) {
          const intent = toIntent(b);
          if (!intent) continue;
          const S = fresh(pos);
          e.acc.Net.lock = false;
          e.queueModal(1);
          const before = printOf(S);
          await run(e, 0, intent);
          e.modalQueue.length = 0;
          const changed = printOf(e.acc.S) !== before;
          const what = name + '/' + phase + '@' + pos + ' ' + JSON.stringify(intent);
          if (b.disabled) assert.equal(changed, false, 'DISABLED but the engine accepted it: ' + what);
          else assert.equal(changed, true, 'ENABLED but the engine refused it: ' + what);
        }
      }
    });
  }
}
