/*
 * The rules engine imported PLAIN: no stub DOM, no environment shim, no fresh-
 * module loader — just `import` in Node with fake hooks and a virtual clock.
 * This is the point of the module split: the game rules (economy, cortisol,
 * raids, MADE, turns, intents, income, board generation, data) run without any
 * browser, and everything outside the rules is one injected `hooks` object.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, makeRng, makeState } from './helpers/harness.mjs';

assert.equal(typeof document, 'undefined', 'sanity: this realm has no DOM');
assert.equal(typeof window, 'undefined');
assert.equal(typeof localStorage, 'undefined');

const E = await import('../static/js/engine.js');
const St = await import('../static/js/state.js');
const D = await import('../static/js/data.js');
const B = await import('../static/js/boards.js');

const clock = makeClock();
const rec = { sync: 0, sys: [], announce: [], begin: [], show: 0, over: [], prompts: [] };
E.setHooks({
  sync: () => { rec.sync++; },
  sysTo: (pi, msg) => { rec.sys.push([pi, msg]); },
  askPlayer: async (pi, opt) => { rec.prompts.push(opt.title); return opt.def !== undefined ? opt.def : (opt.options && opt.options[0] ? opt.options[0].v : undefined); },
  announceAll: title => { rec.announce.push(title); },
  revealAll: async () => {},
  beginGame: pub => { rec.begin.push(pub); },
  showGame: () => { rec.show++; },
  gameOver: (name, char, scores) => { rec.over.push({ name, char, scores }); },
  bots: () => null,
  setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
});
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const withSeed = (seed, fn) => { const real = Math.random; Math.random = makeRng(seed); try { return fn(); } finally { Math.random = real; } };

test('the engine module graph imports and boots with no browser globals at all', () => {
  assert.equal(typeof E.applyIntent, 'function');
  assert.equal(D.NODES.length, 70);
  assert.equal(E.CARDS.length, 36);
  assert.equal(St.S, null);
  assert.equal(typeof document, 'undefined', 'importing it never conjured a DOM');
});

test('a hot-seat game: initGame -> moves -> a seizure -> the market event -> the next turn, all through hooks', async () => {
  const Net = St.Net;
  Net.role = 'host'; Net.myIdx = 0; Net.goal = 100; Net.dlcGeo = false; Net.boardLayout = 'random';
  Net.roster = [{ name: 'Ada', playerId: 'a', conn: null, char: 'markwatson' }, { name: 'Bo', playerId: 'b', conn: null, char: 'tomkins' }];
  Net.conns = [null, null];
  withSeed(41, () => E.initGame([{ name: 'Ada', char: 'markwatson' }, { name: 'Bo', char: 'tomkins' }]));
  await settle();
  const S = St.S;
  assert.ok(S && S.players.length === 2, 'the game was dealt');
  assert.equal(rec.show, 1, 'hooks.showGame fired once');
  assert.equal(rec.begin.length, 1, 'hooks.beginGame carried the opening state');
  assert.equal(rec.begin[0].players.length, 2);
  assert.ok(!('deck' in rec.begin[0]), 'the deck never leaves the engine');
  assert.ok(rec.sync > 0, 'the table was told to repaint/sync');
  assert.ok(rec.sys.some(([, m]) => /YOUR TURN/.test(m)), 'the mover was told it is their turn via hooks.sysTo');
  assert.equal(S.phase, 'move');
  assert.equal(D.NODES.length, 70);

  const first = S.cur;
  const fromQuik = D.ADJ.quik || [];
  assert.ok(fromQuik.length > 0, 'Quikstop has neighbours on the generated board');
  /* walk: pick any neighbour we can afford (tolls) and enter it */
  const pos0 = S.players[first].pos;
  const next = (D.ADJ[pos0] || []).find(id => !S.owner[id] && !E.blockaded(id));
  await E.applyIntent(first, { act: 'move', id: next });
  assert.equal(S.players[first].pos, next, 'the intent moved the pawn');
  await E.applyIntent(first, { act: 'endmove' });
  assert.equal(S.phase, 'action');
  const cash = S.players[first].money;
  const price = E.seizeListPrice(first, D.NMAP[next]);
  await E.applyIntent(first, { act: 'seize' });
  await settle();
  clock.advance(1);
  await settle();
  if (cash >= price) {
    assert.equal(S.owner[next], first, 'the node was seized');
    assert.ok(S.log.some(l => l.includes('seizes')), 'and logged');
  }
  /* seizing ends the action; the market event runs and the turn passes on */
  for (let i = 0; i < 40 && S.cur === first && !S.over; i++) { clock.advance(200); await settle(); }
  assert.notEqual(S.cur, first, 'the turn moved on to the other player');
  assert.ok(S.log.some(l => l.startsWith('🎴 EVENT')), 'a market event ran');
  assert.ok(rec.announce.some(t => /MARKET EVENT/.test(t)), 'announced through hooks.announceAll');
  /* out-of-turn intents are rejected through hooks.sysTo, not a toast */
  rec.sys.length = 0;
  await E.applyIntent(first, { act: 'endmove' });
  assert.ok(rec.sys.some(([pi, m]) => pi === first && /Not your turn/.test(m)));
});

test('rules on a handcrafted state: income, cortisol and a raid, with no environment at all', () => {
  const stub = { acc: { PCOLORS: D.PCOLORS } };
  St.setS(makeState(stub, { owner: { citi: 0, commbank: 0, infl: 0 }, players: [{ money: 0, cortisol: 7 }, {}] }));
  const S = St.S;
  St.Net.role = null; /* nothing is sent anywhere */
  E.income(0);
  assert.ok(S.players[0].money > 0, 'income paid');
  rec.announce.length = 0;
  E.addCortisol(0, 1, 'x', false);
  assert.equal(S.players[0].cortisol, 8);
  E.addCortisol(0, 1, 'x', false);
  assert.equal(S.players[0].cortisol, 0, 'the raid reset Cortisol');
  assert.equal(S.players[0].raided, 1);
  assert.ok(rec.announce.includes('🚨 REGULATOR RAID'), 'the raid was announced through the hook');
  assert.equal(Object.keys(S.owner).length, 1, 'two nodes were seized');
});

test('board generation is pure: random, ringworld and mega ring boards build with no DOM', () => {
  St.setS(makeState({ acc: { PCOLORS: D.PCOLORS } }, {}));
  D.rebuildWorld(false);
  const slot = D.QUIK_SLOTS[0];
  const random = withSeed(7, () => B.generateRandomBoard(slot));
  assert.equal(random.positions.length, D.NODES.length);
  const ring = withSeed(7, () => B.generateRingworldBoard());
  assert.equal(ring.positions.length, D.NODES.length);
  const mega = withSeed(7, () => B.generateMegaRingBoard());
  assert.ok(mega.edges.length > D.NODES.length - 1);
  assert.deepEqual(B.boardViewBounds().w > 0, true);
});

test('timers are injected: the action lock watchdog runs on the virtual clock, never a real timer', async () => {
  St.Net.role = 'host';
  St.Net.lock = false;
  St.setS(makeState({ acc: { PCOLORS: D.PCOLORS } }, { phase: 'action', players: [{ intel: 30 }, {}] }));
  let release;
  const gate = new Promise(res => { release = res; });
  const keep = E.hooks.askPlayer;
  E.setHooks({ askPlayer: () => gate });
  const before = clock.pending();
  const p = E.applyIntent(0, { act: 'targetpanic' }); /* parks on a private prompt */
  assert.equal(clock.pending(), before + 1, 'applyIntent armed its watchdog on hooks.setTimeout');
  assert.equal(St.Net.lock, true, 'the action lock is held while the prompt is open');
  release(-1); /* the player cancels */
  await p;
  assert.equal(clock.pending(), before, 'and disarmed it through hooks.clearTimeout');
  assert.equal(St.Net.lock, false);
  E.setHooks({ askPlayer: keep });
});
