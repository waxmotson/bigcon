/*
 * JAMES BOND (bond007) — CLASSIFIED: hide any node from everyone but the filer and
 * the node's holder until the end of next round; under Fog of War the hide also
 * wipes the node from every rival's `visited` set for good.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, pump, SOURCE } from './helpers/harness.mjs';
import { BASE_NODES } from '../static/js/data.js';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
async function run(e, pi, m) {
  let done = false;
  const p = e.f.applyIntent(pi, m).finally(() => { done = true; });
  for (let i = 0; i < 12 && !done; i++) { await settle(); e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); }
  await p; await settle();
}
async function table(t, { players = 3, fog = false, geo = false, phase = 'action' } = {}) {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.fogOfWar = fog;
  const S = await makeGame(e, players, { geo });
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = []; S.owner = { bond007: 0 }; S.bugs = {}; S.rubble = {};
  S.cur = 0; S.phase = phase; S.mode = null; S.steps = 3; S.turn = 4;
  S.players.forEach(p => { p.money = 40; p.intel = 5; p.cortisol = 0; p.pos = 'quik'; p.visited = { quik: true }; });
  return { e, S, P: S.players };
}
const hide = async (e, S, nid, pay = 'intel', pi = 0) => {
  await run(e, pi, { act: 'classifiedmode', pay });
  await run(e, pi, { act: 'classified', id: nid });
};

test('JB-1 the polaroid says so, the rules say so, and "pays no tolls" stays', () => {
  const b = BASE_NODES.find(n => n.id === 'bond007');
  assert.match(b.sp, /NO tolls/);
  assert.match(b.sp, /CLASSIFIED/);
  assert.match(SOURCE, /JAMES BOND — CLASSIFIED/);
  assert.match(SOURCE, /act==='cancel'/);
});

test('JB-2 the filer pays 1 Intel (or $3), once per turn; it is a free action in both phases', async t => {
  for (const phase of ['action', 'move']) {
    const { e, S, P } = await table(t, { phase });
    await run(e, 0, { act: 'classifiedmode' });
    assert.equal(S.mode, 'classified');
    await run(e, 0, { act: 'classified', id: 'citi' });
    assert.equal(P[0].intel, 4, phase + ': 1 Intel paid');
    assert.equal(S.mode, null); assert.equal(S.phase, phase, 'the phase carries on'); assert.equal(S.cur, 0, 'the turn is not used up');
    assert.equal(S.hidden.citi.by, 0); assert.equal(S.hidden.citi.until, S.turn + 2);
    /* once per turn */
    await run(e, 0, { act: 'classifiedmode', pay: 'money' });
    assert.equal(S.mode, null, 'a second filing the same turn is refused');
    /* the cash route, next turn */
    S.classifiedUsed = false;
    await run(e, 0, { act: 'classifiedmode', pay: 'money' });
    await run(e, 0, { act: 'classified', id: 'nab' });
    assert.equal(P[0].money, 37, phase + ': $3 paid'); assert.ok(S.hidden.nab);
    e.dispose();
  }
});

test('JB-3 only the Bond owner, only with the means, never while another mode is open; Cancel backs out', async t => {
  const { e, S, P } = await table(t);
  S.owner.bond007 = 1;
  await run(e, 0, { act: 'classifiedmode' });
  assert.equal(S.mode, null, 'not the owner');
  S.owner.bond007 = 0; P[0].intel = 0; P[0].money = 2;
  await run(e, 0, { act: 'classifiedmode', pay: 'intel' });
  await run(e, 0, { act: 'classifiedmode', pay: 'money' });
  assert.equal(S.mode, null, 'no Intel and under $3');
  P[0].intel = 3;
  await run(e, 0, { act: 'classifiedmode' });
  assert.equal(S.mode, 'classified');
  await run(e, 0, { act: 'cancel' });
  assert.equal(S.mode, null); assert.equal(P[0].intel, 3, 'cancelling is free');
  await run(e, 0, { act: 'classified', id: 'citi' }); /* no mode open: ignored */
  assert.equal(S.hidden, undefined);
});

test('JB-4 hidden until the end of NEXT round, then it lapses on its own', async t => {
  const { e, S } = await table(t);
  await hide(e, S, 'citi');
  const seen = (viewer) => !e.f.hiddenFrom || true;
  const { hiddenFrom } = e.mods.engine;
  assert.equal(hiddenFrom(1, 'citi'), true, 'rival: hidden');
  assert.equal(hiddenFrom(2, 'citi'), true);
  assert.equal(hiddenFrom(0, 'citi'), false, 'the filer sees it');
  S.turn += 1;
  assert.equal(hiddenFrom(1, 'citi'), true, 'still hidden through next round');
  S.turn += 1;
  assert.equal(hiddenFrom(1, 'citi'), false, 'gone once that round is over');
});

test('JB-5 the deed holder still sees their own node; it lapses if Bond changes hands', async t => {
  const { e, S } = await table(t);
  S.owner.citi = 2;
  await hide(e, S, 'citi');
  const { hiddenFrom } = e.mods.engine;
  assert.equal(hiddenFrom(2, 'citi'), false, 'its holder is not locked out of their own node');
  assert.equal(hiddenFrom(1, 'citi'), true);
  S.owner.bond007 = 1; /* Bond is taken over */
  assert.equal(hiddenFrom(1, 'citi'), false, 'the new Bond owner never filed it and the hide is void');
  assert.equal(hiddenFrom(2, 'citi'), false);
});

test('JB-6 Fog of War: every rival forgets it for good — except one standing on it — the filer keeps their map', async t => {
  const { e, S, P } = await table(t, { fog: true });
  assert.equal(S.fogOfWar, true);
  P.forEach(p => { p.visited = { quik: true, citi: true, nab: true }; });
  P[2].pos = 'citi';
  await hide(e, S, 'citi');
  assert.equal(P[0].visited.citi, true, 'the filer keeps it');
  assert.equal(P[1].visited.citi, undefined, 'a rival who had been there forgets it');
  assert.equal(P[2].visited.citi, true, 'a rival standing on it right now has not left');
  assert.equal(P[1].visited.nab, true, 'other nodes are untouched');
  /* permanent: it stays forgotten after the hide expires */
  S.turn += 5;
  assert.equal(e.mods.engine.hiddenFrom(1, 'citi'), false, 'the hide has lapsed');
  assert.equal(P[1].visited.citi, undefined, 'but they must visit it again');
  /* and visiting again rediscovers it */
  P[1].pos = e.acc.ADJ.citi[0]; P[1].visited[P[1].pos] = true;
  S.cur = 1; S.phase = 'move'; S.steps = 3;
  await run(e, 1, { act: 'move', id: 'citi' });
  assert.equal(P[1].visited.citi, true);
  /* no fog, no wipe */
  const n = await table(t, { fog: false });
  n.P[1].visited = { quik: true, citi: true };
  await hide(n.e, n.S, 'citi');
  assert.equal(n.P[1].visited.citi, true, 'without Fog of War nobody forgets anything');
});

test('JB-7 what rivals can and cannot do: walk in (tolls and all), seize blind — but never pick it as a remote target', async t => {
  const { e, S, P } = await table(t, { geo: true });
  S.owner.nab = 2; /* a rival holds it: they will want the toll */
  await hide(e, S, 'nab');
  /* walking in works and still pays the toll to the holder */
  const from = e.acc.ADJ.nab[0];
  P[1].pos = from; P[1].money = 10; S.cur = 1; S.phase = 'move'; S.steps = 3;
  await run(e, 1, { act: 'move', id: 'nab' });
  assert.equal(P[1].pos, 'nab', 'a rival can walk onto a classified node');
  assert.equal(P[1].money, 9); assert.equal(P[2].money, 41, 'the toll still reaches its holder');
  assert.ok(S.log.some(l => l.includes('moves to a CLASSIFIED site')), 'the record keeps it nameless');
  assert.ok(!S.log.slice(-6).some(l => l.includes('NAB')), 'no name leaks into the record');
  assert.ok(!S.log.slice(-6).some(l => /toll to Player/.test(l)), 'nor the holder');
  /* seizing blind works (a hostile takeover as usual) */
  S.phase = 'action'; P[1].money = 60;
  await run(e, 1, { act: 'seize' });
  assert.equal(S.owner.nab, 1, 'a blind takeover goes through');
  assert.ok(S.log.some(l => l.includes('muscles in on a CLASSIFIED site')));
  /* remote targets are refused: bug, missile, overtourism, blockade */
  const stage = (mode, pi) => { S.cur = pi; S.phase = 'action'; S.mode = mode; S.players[pi].money = 60; S.players[pi].intel = 5; };
  S.owner.nab = 2; S.owner.geo_missile = 1; S.owner.geo_venice = 1; S.owner.albo = 1; S.geoMissiled = false; S.geoVenice = false; S.blockadeUsed = false;
  P[1].pos = 'geo_missile'; S.bugs = {};
  P[1].pos = from; stage('bug', 1);
  await run(e, 1, { act: 'bug', id: 'nab' });
  assert.equal(S.bugs.nab, undefined, 'cannot bug what you cannot see');
  stage('missile', 1); P[1].pos = 'geo_missile';
  await run(e, 1, { act: 'missile', id: 'nab' });
  assert.ok(!S.rubble.nab, 'cannot missile a classified node');
  stage('overtour', 1);
  await run(e, 1, { act: 'overtour', id: 'nab' });
  assert.equal(S.ov, null, 'no overtourism on it');
  stage('blockade', 1);
  await run(e, 1, { act: 'blockade', id: 'nab' });
  assert.ok(!(S.blockades && S.blockades.nab), 'no blockade on it');
  /* the filer can still do all of that */
  S.owner.albo = 0; S.owner.bond007 = 0; S.hidden.nab = { by: 0, until: S.turn + 2 };
  S.owner.nab = 2;
  stage('blockade', 0);
  await run(e, 0, { act: 'blockade', id: 'nab' });
  assert.ok(S.blockades.nab > S.turn, 'the Bond owner can still blockade it');
});

test('JB-8 the views: rivals get a ? (name, owner and bugs gone), the filer and holder see it, bots are blinded too', async t => {
  const { e, S, P } = await table(t, { fog: false });
  S.owner.citi = 2; S.bugs.citi = 0;
  await hide(e, S, 'citi');
  /* the board scene from a rival's seat vs. the filer's */
  const sceneFor = seat => { e.acc.Net.myIdx = seat; return e.ctx.boardScene(); };
  const rival = sceneFor(1), filer = sceneFor(0), holder = sceneFor(2);
  const pick = (sc, id) => sc.nodes.find(n => n.id === id);
  assert.equal(pick(rival, 'citi').known, false, 'unknown to a rival');
  assert.equal(pick(rival, 'citi').tip, '');
  assert.equal(rival.owner.citi, undefined, 'owner hidden'); assert.equal(rival.bugs.citi, undefined, 'bug hidden');
  assert.equal(pick(filer, 'citi').known, true); assert.equal(filer.owner.citi, 2);
  assert.equal(pick(holder, 'citi').known, true);
  /* the SVG board draws an unknown card on a plain board */
  e.acc.Net.myIdx = 1;
  const svg = e.ctx.nodeSVG(e.acc.NMAP.citi, '');
  assert.match(svg, /fog-node/, 'drawn as the fog "?" card even without Fog of War');
  assert.ok(!svg.includes('node-image'), 'no art');
  e.acc.Net.myIdx = 0;
  assert.ok(e.ctx.nodeSVG(e.acc.NMAP.citi, '').includes('🗂️'), 'the filer sees it, marked as filed');
  /* a bot's view: the owner and bug are gone, and it is flagged */
  P[1].bot = true;
  const bv = e.ctx.botView(1);
  assert.equal(bv.owner.citi, undefined); assert.equal(bv.bugs.citi, undefined); assert.equal(bv.hiddenFromMe.citi, true);
  const hv = e.ctx.botView(0);
  assert.equal(hv.owner.citi, 2, 'the filer still sees the owner'); assert.equal(hv.hiddenFromMe.citi, undefined);
});

test('JB-9 the side panel: a rival standing on a classified node cannot read it, and the buttons are offered to the filer', async t => {
  const { e, S, P } = await table(t);
  await hide(e, S, 'citi');
  /* the filer's panel offers the two payments (once per turn) */
  e.acc.Net.myIdx = 0; S.cur = 0; S.classifiedUsed = false; P[0].pos = 'quik';
  e.ctx.renderSide();
  let html = String(e.elems.get('side').innerHTML);
  assert.match(html, /data-act="classifiedmode" data-pay="intel"/); assert.match(html, /data-act="classifiedmode" data-pay="money"/);
  S.classifiedUsed = true; e.ctx.renderSide();
  assert.match(String(e.elems.get('side').innerHTML), /data-act="classifiedmode" data-pay="intel" disabled/);
  /* a rival's turn, standing on it */
  S.cur = 1; e.acc.Net.myIdx = 1; P[1].pos = 'citi'; S.phase = 'action'; S.owner.citi = 2;
  e.ctx.renderSide();
  html = String(e.elems.get('side').innerHTML);
  assert.match(html, /CLASSIFIED/); assert.ok(!/CITIBANK|CITI TOWER|citi tower/i.test(html.split('THE SYNDICATE')[0]), 'no name in the action card');
  assert.match(html, /Seize a CLASSIFIED site blind|Seize .*blind/);
});

test('JB-10 a bot Bond owner hides the node a front-runner needs for the last type', async t => {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.ctx.window.__BIGCON_TEST__ = true; e.ctx.window.__BIGCON_BOT_SEED__ = 4242;
  await e.loadBots();
  const S = await makeGame(e, 2, { bots: [1] });
  const bi = S.players.findIndex(p => p.bot), hi = 1 - bi;
  S.over = true; for (let i = 0; i < 30; i++) { await pump(2); if (e.clock.pending()) e.clock.advance(25); }
  S.over = false;
  S.deck = ['quiet', 'quiet', 'quiet', 'quiet']; S.discard = []; S.owner = { bond007: bi }; S.bugs = {}; S.rubble = {};
  S.cur = bi; S.phase = 'action'; S.mode = null; S.turn = 6;
  S.players.forEach(p => { p.money = 30; p.intel = 0; p.cortisol = 0; p.pos = 'quik'; p.visited = { quik: true }; });
  /* the human holds six types and $110: only a REGULATOR stands between them and the win */
  ['citi', 'us', 'oil', 'coal', 'press', 'back'].forEach(id => { S.owner[id] = hi; });
  S.players[hi].money = 110;
  S.players[bi].intel = 4; S.players[bi].money = 12;
  const Bots = e.ctx.window.BigConBots;
  let done = false;
  const p = Bots.takeTurn(bi, e.ctx.botView(bi), e.ctx.botAPI(e.acc.Net.gameEpoch)).finally(() => { done = true; });
  for (let i = 0; i < 120 && !done; i++) { await pump(2); e.clock.advance(300); }
  await p; await settle();
  const hid = Object.keys(S.hidden || {}).filter(id => S.hidden[id].by === bi);
  assert.equal(hid.length, 1, 'the bot filed exactly one node: ' + S.log.slice(-6).join(' | '));
  assert.equal(e.acc.NMAP[hid[0]].type, 'REGULATOR', 'a regulator — the missing piece');
  assert.equal(S.players[bi].intel <= 3, true, 'it paid');
});
