/*
 * Regression tests for the bug sweep: each test reproduces a defect that used
 * to break the rules, the wire or the lobby, and pins the fixed behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, makeConn } from './helpers/harness.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
async function act(e, m, pi = 0) {
  let done = false;
  const run = e.f.applyIntent(pi, m).finally(() => { done = true; });
  for (let i = 0; i < 12 && !done; i++) { await settle(); e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); }
  await run; await settle();
}
async function game(t, n = 3, phase = 'action') {
  const e = await loadEngine();
  t.after(() => e.dispose());
  const S = await makeGame(e, n, { geo: true });
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = [];
  S.owner = {}; S.bugs = {}; S.rubble = {};
  S.cur = 0; S.mode = null; S.phase = phase; S.steps = 3;
  S.players.forEach(p => { p.money = 60; p.intel = 10; p.cortisol = 0; p.pos = 'quik'; });
  return { e, S, P: S.players, Net: e.acc.Net };
}

test('BF-01 the F1 slipstream discount survives a seizure the player cannot afford', async t => {
  const { e, S, P } = await game(t);
  S.owner.f1 = 0; S.slipped = true;
  const n = e.acc.NMAP.citi; P[0].pos = 'citi'; P[0].money = Math.max(0, n.cost - 2 - 1);
  await act(e, { act: 'seize' });
  assert.equal(S.owner.citi, undefined, 'nothing was seized');
  assert.equal(S.slipped, true, 'the $2 discount is still banked for a real deal');
});

test('BF-02 a rival-targeted ability with a bogus seat is refused before anything is paid', async t => {
  const { e, S, P } = await game(t);
  for (const target of [undefined, 7, -1, '1', 1.5, 0]) {
    S.mode = 'leak'; P[0].intel = 10;
    await act(e, { act: 'leak', target });
    assert.equal(P[0].intel, 10, 'no Intel spent on target ' + String(target));
    assert.equal(S.cur, 0, 'the turn did not move');
  }
  S.mode = 'leak';
  e.acc.S.owner.anz = 1; e.acc.S.owner.nab = 1;
  await act(e, { act: 'leak', target: 1 });
  assert.equal(P[0].intel, 8, 'a real rival can still be leaked on');
});

test('BF-03 selling a malformed Intel amount changes nothing', async t => {
  const { e, S, P } = await game(t);
  await act(e, { act: 'sell', n: undefined });
  assert.equal(P[0].intel, 10); assert.equal(P[0].money, 60); assert.equal(S.phase, 'action');
  await act(e, { act: 'sell', n: 2.7 });
  assert.equal(P[0].intel, 8, 'fractions round down to whole Intel');
  assert.ok(Number.isInteger(P[0].money));
});

test('BF-04 a Qantas flight to a node that does not exist is refused without charging', async t => {
  const { e, S, P } = await game(t, 3, 'move');
  S.owner.qantas = 0;
  await act(e, { act: 'flymode' });
  await act(e, { act: 'fly', id: 'nowhere' });
  assert.equal(P[0].pos, 'quik'); assert.equal(P[0].money, 60);
  await act(e, { act: 'fly', id: 'quik' });
  assert.equal(P[0].money, 60, 'flying to where you stand costs nothing — it is refused');
});

test('BF-05 the boulder card skips a table where nobody owns anything', async t => {
  const { e, S, P } = await game(t);
  e.acc.CARDBYID.sisyroll.run();
  assert.ok(P.every(p => p.money === 60), 'nobody paid the $2');
  S.owner.citi = 1;
  e.acc.CARDBYID.sisyroll.run();
  assert.equal(P[1].money, 58, 'the biggest stack still pays');
  assert.equal(P[0].money, 60);
});

test('BF-06 a guest answer that was never offered falls back to the default', async t => {
  const { e, S, Net } = await game(t);
  const c = Net.conns[1]; c.autoAnswer = false;
  const p = e.f.askPlayer(1, { title: 'X', options: [{ label: 'a', v: 0 }, { label: 'b', v: 2 }], def: 0 });
  const pr = c.sent.find(m => m.t === 'prompt');
  e.f.onHostData(c, { t: 'answer', pid: pr.pid, v: 1 });
  assert.equal(await p, 0, 'seat 1 (itself) is not an option');
  const p2 = e.f.askPlayer(1, { title: 'X', options: [{ label: 'a', v: 0 }, { label: 'b', v: 2 }], def: 0 });
  const pr2 = c.sent.filter(m => m.t === 'prompt').pop();
  e.f.onHostData(c, { t: 'answer', pid: pr2.pid, v: 2 });
  assert.equal(await p2, 2, 'an offered answer goes through');
});

test('BF-07 the host listens for reveal acks before sending, and guests ack the card', async t => {
  const { e, Net } = await game(t);
  /* a guest that acks synchronously, the instant the card lands */
  for (let i = 1; i < Net.conns.length; i++) {
    const c = Net.conns[i];
    const send = c.send.bind(c);
    c.send = m => { send(m); if (m && m.t === 'event') e.f.onHostData(c, { t: 'ack', eid: m.eid }); };
  }
  let done = false;
  e.f.revealAll('T', 'x').then(() => { done = true; });
  await settle();
  assert.equal(done, true, 'no 5 s stall when every guest acked at once');

  const g = await loadEngine();
  t.after(() => g.dispose());
  const sent = [];
  g.acc.Net.role = 'guest';
  g.acc.Net.conn = { open: true, send: m => sent.push(m) };
  g.ctx.onGuestData({ t: 'event', eid: 9, title: 'T', html: 'x' });
  await settle();
  assert.ok(sent.some(m => m.t === 'ack' && m.eid === 9), 'the guest acked the card once it was dismissed');
});

test('BF-08 back to the lobby puts the host on row 0 and drops seats nobody holds', async t => {
  const { e, S, Net } = await game(t, 4);
  /* emulate a shuffled seating: the host sat third; seat 1 has gone away */
  const order = [1, 2, 0, 3];
  Net.roster = order.map(i => Net.roster[i]);
  Net.conns = order.map(i => Net.conns[i]);
  Net.myIdx = 2;
  const gone = Net.roster[1];
  Net.conns[1].open = false;
  S.over = true; S.phase = 'over';
  const hostName = Net.roster[2].name;
  e.ctx.backToLobby();
  assert.equal(Net.myIdx, 0);
  assert.equal(Net.roster[0].name, hostName, 'the host is row 0 again');
  assert.equal(Net.conns[0], null, 'the host row carries no connection');
  assert.ok(!Net.roster.includes(gone), 'the disconnected player was not kept for the next deal');
  assert.equal(Net.roster.length, 3);
  assert.ok(Net.conns.slice(1).every(c => c && c.open), 'every other row is a live guest');
  const told = [];
  Net.conns.forEach((c, i) => { if (c) told.push([i, c.sent.filter(m => m.t === 'tolobby').pop()]); });
  assert.ok(told.every(([i, m]) => m && m.idx === i), 'each guest was told their new row');
});

test('BF-09 a mid-game player joining behind a live spectator gets the seat row, not the spectator', async t => {
  const { e, S, Net } = await game(t, 2);
  const spect = makeConn(e, 'pid-spect');
  e.f.handleHello(spect, 'Rail Bird', 'pid-spect');
  e.f.onHostData(spect, { t: 'joinmode', v: 'spect' });
  assert.equal(Net.conns.indexOf(spect), 2);

  const late = makeConn(e, 'pid-late');
  e.f.handleHello(late, 'Late Larry', 'pid-late');
  e.f.onHostData(late, { t: 'joinmode', v: 'player' });
  const face = late.sent.find(m => m.t === 'joinface').free[0];
  e.f.onHostData(late, { t: 'joinchar', char: face });
  assert.equal(S.players.length, 3);
  assert.equal(Net.conns.indexOf(late), 2, 'the new seat is driven by the new player');
  assert.equal(Net.roster[2].name, 'Late Larry');
  assert.equal(Net.conns.indexOf(spect), 3, 'the spectator moved down a row');
  const w = spect.sent.filter(m => m.t === 'welcome').pop();
  assert.ok(w && w.idx === 3 && w.spect, 'the spectator was told their new row');
});

test('BF-10 a spectating host never clicks for its bot seat', async t => {
  const { e, S, P } = await game(t, 2, 'move');
  P[0].bot = true;
  e.ctx.dispatch({ act: 'endmove' });
  await settle();
  assert.equal(S.phase, 'move', 'the host UI did not act for the bot');
});
