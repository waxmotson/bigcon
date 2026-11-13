/*
 * 🤖 BOT SEATS — section BT of docs/CODE_LEVEL_TEST_PLAN.md.
 *
 * A bot is a roster entry {bot:true, conn:null} driven by the host engine: every
 * mutation it causes goes through applyIntent (the same wire gate as a human
 * guest) and the only state it sees is botView() — a redacted snapshot that
 * carries nothing the wire wouldn't. The policy module (static/bots.js) is a
 * Tier-2 deterministic brain: per-seat xorshift streams seeded by
 * window.__BIGCON_BOT_SEED__ and paced-down by window.__BIGCON_TEST__.
 *
 * These tests load the shipped bot module into the same vm realm as the engine
 * and play full games on the virtual clock. An all-bot game must terminate, all
 * of its traffic must be legal, identical seeds must replay identically, and
 * the lobby must be able to seat and dismiss bots.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, makeGame, makeConn, pump, snapshot, withSeedAsync, repoRoot, CHARS8 } from './helpers/harness.mjs';

/* Boot an engine with the shipped bot module loaded into it (the page's main.js
   does the same through the `bots` hook) and instruments wrapped around the bots'
   applyIntent gate (intent ledger) and the sysTo hook (rejection ledger). */
async function botEngine(t, botSeed = 4242) {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  engine.ctx.window.__BIGCON_TEST__ = true; /* zero bot pacing */
  engine.ctx.window.__BIGCON_BOT_SEED__ = botSeed;
  const Bots = await engine.loadBots();
  const rec = { intents: [], sys: [], freezeAfter: null, pre: null };
  engine.ctx.__rec = rec;
  /* A bot reaches the rules only through the api it is handed, so wrapping
     api.applyIntent sees every bot intent — the same gate a guest's wire intent uses. */
  const wrapApi = api => ({
    ...api,
    applyIntent: async (pi, m) => {
      const S = engine.acc.S;
      if (rec.freezeAfter && rec.freezeAfter.pi === pi && !rec.freezeAfter.hit && S && S.players[pi])
        rec.pre = { money: S.players[pi].money, intel: S.players[pi].intel, cortisol: S.players[pi].cortisol };
      await api.applyIntent(pi, m);
      rec.intents.push({ pi, act: m && m.act, id: m && m.id });
      if (rec.freezeAfter && rec.freezeAfter.pi === pi && m.act === rec.freezeAfter.act && !rec.freezeAfter.hit) {
        rec.freezeAfter.hit = true;
        if (S && !S.over) S.over = true; /* the staged effect landed — re-freeze the table */
      }
    },
  });
  const takeTurn = Bots.takeTurn, answerPrompt = Bots.answerPrompt;
  Bots.takeTurn = (pi, view, api) => takeTurn(pi, view, wrapApi(api));
  Bots.answerPrompt = (pi, opt, api) => answerPrompt(pi, opt, wrapApi(api));
  const origSys = engine.hooks.sysTo;
  engine.hooks.sysTo = (pi, msg) => { rec.sys.push({ pi, msg }); return origSys(pi, msg); };
  return engine;
}

/* Drive a bot game on the virtual clock: bot turn chains yield through 0ms
   timers (pump's macrotasks) and block on projPause chains (clock.advance).
   The loop shape is part of the determinism contract in BT-02 — keep it
   identical between runs. */
async function driveToOver(engine, S, maxIters = 24000) {
  for (let i = 0; i < maxIters && !S.over; i++) {
    await pump(2);
    if (engine.clock.pending()) engine.clock.advance(25);
  }
}

/* The engine's rejection replies a bot must never provoke. */
const REJECT_RE = /(Not your turn|red threads|afford|Not enough Intel|unavailable|cannot|Walk away)/i;

test('BT-01 an all-bot table finishes the con through the same intent gate', async t => {
  const engine = await botEngine(t);
  const S = await makeGame(engine, 3, { bots: [0, 1, 2], goal: 100, seeds: [41] });
  await driveToOver(engine, S);
  assert.equal(S.over, true, 'the bot game reached a winner inside the iteration budget');

  const rec = engine.ctx.__rec;
  assert.ok(rec.intents.length > 100, 'the bots proposed a healthy number of intents (got ' + rec.intents.length + ')');
  assert.ok(rec.intents.every(it => it.pi >= 0 && it.pi < 3), 'every intent came from a seated bot');
  assert.ok(rec.intents.some(it => it.act === 'seize'), 'the bots seize nodes — they play the con, not the pass');
  assert.ok(rec.intents.some(it => it.act === 'move'), 'the bots move around the board');
  const rejects = rec.sys.filter(s => REJECT_RE.test(s.msg));
  assert.equal(rejects.length, 0, 'no engine rejections aimed at bots — got: '
    + rejects.slice(0, 4).map(r => 'seat' + r.pi + ': ' + r.msg).join(' | '));
  const botErrors = engine.consoleOut.error.filter(l => String(l).includes('bot turn error'));
  assert.equal(botErrors.length, 0, 'no bot turn crashed: ' + String(botErrors[0]).slice(0, 200));
});

test('BT-02 bot games are deterministic: same seed pair, same game', async t => {
  const run = async () => {
    const engine = await botEngine(t, 4242);
    const S = await makeGame(engine, 3, { bots: [0, 1, 2], goal: 100, seeds: [41] });
    /* the realm shares the host Math, so this seeds every gameplay roll */
    await withSeedAsync(777, () => driveToOver(engine, S));
    const snap = snapshot(engine);
    engine.dispose();
    return snap;
  };
  const a = await run();
  const b = await run();
  assert.deepStrictEqual(b, a, 'two runs with the same engine+bot seeds play identical games');
});

test('BT-03 botView is redacted: no deck order, log or chat ever leaves the engine', async t => {
  const engine = await botEngine(t);
  const S = await makeGame(engine, 3, { bots: [0, 1, 2], goal: 100, seeds: [41] });
  /* plant secrets a cheat would love to see */
  S.deck = ['quiet', 'quiet'];
  S.log.push('SECRET-LOG-MARKER');
  S.chat.push({ who: 'x', msg: 'SECRET-CHAT-MARKER' });

  const v = engine.ctx.botView(1);
  assert.ok(v, 'botView returns a view for a live game');
  for (const k of ['deck', 'log', 'chat']) assert.ok(!(k in v), k + ' is redacted from the bot view');
  const json = JSON.stringify(v);
  assert.ok(!json.includes('SECRET-LOG-MARKER'), 'the log never reaches the bot');
  assert.ok(!json.includes('SECRET-CHAT-MARKER'), 'the chat never reaches the bot');

  /* the view contract the policy module is compiled against — an engine
     refactor that drops one of these must fail here, loudly */
  for (const k of ['pi', 'curSeat', 'players', 'phase', 'steps', 'turn', 'goal', 'over', 'owner', 'bugs',
    'nodes', 'nmap', 'edges', 'cardIds', 'discardIds', 'country', 'oilIds', 'moodRate',
    'geo', 'geoUsed', 'seizePrice', 'takePrice', 'flatSeize', 'missingTypes']) {
    assert.ok(k in v, 'botView carries ' + k);
  }
  assert.equal(v.curSeat, S.cur, 'curSeat mirrors the engine cursor');
  assert.equal(v.nmap.us.id, 'us', 'nmap is keyed by node id');
  assert.ok(v.nmap.us.type, 'nmap entries carry the node type');
  assert.equal(typeof v.missingTypes(1).length, 'number', 'missingTypes helper answers');
  assert.ok(Number.isFinite(v.seizePrice(1, 'us')), 'seizePrice helper answers with a number');
});

test('BT-04 the host lobby can seat and dismiss bots', async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  const Net = engine.acc.Net;
  Net.role = 'host';
  Net.myIdx = 0;
  Net.roster = [{ name: 'HOST', playerId: 'host', conn: null, char: null }];
  const ctx = engine.ctx;

  ctx.addBotSeat();
  assert.equal(Net.roster.length, 2, 'a bot took the next empty seat');
  assert.equal(Net.roster[1].bot, true, 'the seat is flagged as a bot');
  assert.equal(Net.roster[1].conn, null, 'the bot has no connection');
  assert.ok(Net.roster[1].char, 'the bot picked a free face so the start button unlocks');

  ctx.addBotSeat();
  assert.notEqual(Net.roster[1].char, Net.roster[2].char, 'two bots never share a face');

  ctx.kickBotSeat(1);
  assert.equal(Net.roster.length, 2, 'kicking removes exactly the one bot');
  assert.ok(Net.roster[1].bot, 'the remaining bot slid into its place');

  ctx.kickBotSeat(0);
  assert.equal(Net.roster.length, 2, 'kicking a human seat is a no-op');
  ctx.kickBotSeat(9);
  assert.equal(Net.roster.length, 2, 'kicking an empty seat is a no-op');

  for (let i = 0; i < 10; i++) ctx.addBotSeat();
  assert.equal(Net.roster.length, engine.acc.MAXPLAYERS, 'the table fills to 8 and refuses more');
  const faces = new Set(Net.roster.map(e => e.char));
  assert.equal(faces.size, engine.acc.MAXPLAYERS, 'every seat at the full table has a unique face');

  /* the host face completes the roster and the start button unlocks */
  Net.roster[0].char = Net.roster[0].char || CHARS8[0];
  engine.f.broadcastLobby();
  assert.equal(engine.elems.get('btnStart').disabled, false, 'a full roster of faced seats unlocks START');
  const size = Net.roster.length;
  const kicked = Net.roster[1];
  ctx.kickBotSeat(1);
  assert.equal(Net.roster.length, size - 1, 'kicking while full frees the seat');
  assert.ok(!Net.roster.includes(kicked), 'the kicked bot is gone from the roster');
});

/* ---------- full coverage: every human action, rational play, banter ---------- */

/* The complete intent vocabulary a seated player (human or bot) can send —
   the engine's applyIntent gate. Every entry must appear in the bot module's
   dispatch, except the documented skips: 'sweep' (the engine keys bugs by
   planter, so sweeping only ever deletes the sweeper's own income streams —
   nothing rationally plays it) and 'cancel' (bots never strand a mode open). */
const PLAYER_ACTS = [
  'move', 'favor', 'slip', 'flymode', 'fly', 'endmove',
  'seize', 'bugmode', 'bug', 'leakmode', 'leak', 'auditmode', 'audit',
  'tweetmode', 'tweet', 'spin', 'roast', 'cook', 'pressure', 'budget', 'push',
  'jog', 'missilemode', 'missile', 'rebuild', 'beach', 'qantasdown', 'oilcrash',
  'venicecool', 'overmode', 'overtour', 'blockmode', 'blockade',
  'spy', 'dossier', 'sweep', 'masspanic', 'targetpanic', 'divestmade',
  'bondmageddon', 'sell', 'sellall', 'laylow',
  'marketsell', 'lobby', 'refermode', 'refer', 'dealmode', 'deal',
];
const BOT_SKIPS = ['sweep', 'cancel'];

test('BT-05 the bot module covers the whole human action table', t => {
  const src = fs.readFileSync(path.join(repoRoot, 'static', 'bots.js'), 'utf8');
  const missing = PLAYER_ACTS.filter(a => BOT_SKIPS.indexOf(a) < 0
    && src.indexOf("act: '" + a + "'") < 0 && src.indexOf("act:'" + a + "'") < 0);
  assert.deepEqual(missing, [], 'actions with no bot dispatch: ' + missing.join(', '));
});

/* Boot a game, let the opening chains die down, then freeze the table so a
   rig can stage an exact board state and drive one bot turn by hand.
   Everything runs under a fixed Math seed so the frozen board is reproducible. */
async function rigGame(t, geo) {
  const engine = await botEngine(t, 4242);
  const S = await makeGame(engine, 3, { bots: [0, 1, 2], goal: 100, geo });
  S.over = true; /* freeze: every live chain aborts on the next beat */
  for (let i = 0; i < 60 && (engine.clock.pending() || i < 4); i++) {
    await pump(2);
    if (engine.clock.pending()) engine.clock.advance(25);
  }
  return engine;
}

/* Unfreeze for exactly one hand-driven bot turn. The instrument re-freezes the
   table the moment the expected act lands, so endOfTurn cannot wake the other
   seats and let a live game run over the assertions. */
async function driveBotTurn(engine, pi, expectAct) {
  const S = engine.acc.S;
  const rec = engine.ctx.__rec;
  rec.freezeAfter = { pi, act: expectAct, hit: false };
  rec.pre = null;
  S.over = false;
  S.cur = pi;
  S.phase = 'action';
  S.mode = null;
  const turn = engine.ctx.window.BigConBots.takeTurn(pi, engine.ctx.botView(pi), engine.ctx.botAPI(engine.acc.Net.gameEpoch));
  for (let i = 0; i < 60; i++) {
    await pump(2);
    if (engine.clock.pending()) engine.clock.advance(25);
    if (rec.freezeAfter.hit) break;
  }
  await turn;
  S.over = true; /* belt and braces: nothing else may mutate the board */
  await pump(2);
}

test('BT-06a bots plant bugs on adjacent rival nodes', async t => {
  await withSeedAsync(555, async () => {
    const engine = await rigGame(t, false);
    const S = engine.acc.S;
    const pos = Object.keys(engine.acc.ADJ).find(k => engine.acc.ADJ[k].indexOf('us') >= 0 && k !== 'us');
    assert.ok(pos, 'some node is adjacent to the US yields chart');
    for (let j = 0; j < 3; j++) { S.players[j].money = 40; S.players[j].intel = 5; }
    S.players[1].pos = pos;
    S.owner[pos] = 1;
    S.owner.us = 0;
    for (const id in S.owner) if (id !== 'us' && id !== pos) S.owner[id] = null; /* rivals starved of attack surface */
    await driveBotTurn(engine, 1, 'bug');
    const rec = engine.ctx.__rec;
    assert.ok(rec.intents.some(it => it.pi === 1 && it.act === 'bugmode'), 'the bot opened bug mode');
    assert.ok(rec.intents.some(it => it.pi === 1 && it.act === 'bug' && it.id === 'us'), 'the bot planted on the rival chart');
    assert.equal(S.bugs.us, 1, 'the bug landed on the engine state');
    assert.ok(rec.pre.intel >= 3, 'the bot held at least the bug cost before the plant (got ' + rec.pre.intel + ')');
    assert.equal(S.players[1].intel, rec.pre.intel - 1, 'the 1-Intel bug cost was paid');
  });
});

test('BT-06b bots fire missiles at rival holdings (geo DLC)', async t => {
  await withSeedAsync(555, async () => {
    const engine = await rigGame(t, true);
    const S = engine.acc.S;
    for (let j = 0; j < 3; j++) { S.players[j].money = 40; S.players[j].intel = 1; }
    /* one rival holding only — the best-paying standing node on the board */
    const view = engine.ctx.botView(1);
    const target = Object.keys(view.nmap).filter(id => view.nmap[id].income > 0
      && id.indexOf('geo_') !== 0 && id !== 'qantas')
      .sort((a, b) => view.nmap[b].income - view.nmap[a].income)[0];
    assert.ok(target, 'some standing base node pays income');
    for (const id in S.owner) S.owner[id] = null;
    S.owner[target] = 0;
    S.owner.geo_missile = 1;
    S.players[1].pos = 'geo_missile';
    await driveBotTurn(engine, 1, 'missile');
    const rec = engine.ctx.__rec;
    assert.ok(rec.intents.some(it => it.pi === 1 && it.act === 'missilemode'), 'the bot opened missile mode');
    assert.ok(rec.intents.some(it => it.pi === 1 && it.act === 'missile' && it.id === target), 'the bot struck the rival holding');
    assert.equal(S.rubble[target], 1, 'the strike reduced the rival holding to rubble');
    assert.equal(S.owner[target], undefined, 'the strike expropriated the rival with no payout');
    assert.equal(rec.pre.money, 40, 'the bot held $40 before the launch');
    assert.ok(S.players[1].money <= 36, 'the $4 launch was paid');
    assert.equal(S.players[1].intel, 0, 'the 1-Intel launch price was paid');
  });
});

test('BT-06c the Venice owner sends Overtourism at a rival node (geo DLC)', async t => {
  await withSeedAsync(555, async () => {
    const engine = await rigGame(t, true);
    const S = engine.acc.S;
    S.players[1].money = 40;
    S.players[1].intel = 1; /* starve spy/leak/sell so Overtourism is the play */
    S.players[1].pos = 'quik';
    for (const id in S.owner) if (S.owner[id] === 2) S.owner[id] = null; /* seat 2 left vulnerable-less */
    for (const id in S.owner) if (id.indexOf('geo_') === 0 && id !== 'geo_venice' && S.owner[id] === 1) S.owner[id] = null; /* no launcher/boeing/stage5 */
    S.owner.quik = 1;
    S.owner.geo_venice = 1;
    S.owner.us = 0;
    S.owner.japan = 0; /* the victim needs 2 holdings for the ≤1-node quirk */
    S.rubble.japan = 1; /* the US chart is the only standing rival node */
    S.players[0].money = 95; /* inside the Overtourism race gate from the first decision */
    S.players[0].cortisol = 4;
    for (const nb of engine.acc.ADJ['quik'] || []) { /* pre-bug every adjacent holding: no cheaper play */
      const o = S.owner[nb];
      if (o != null && o !== 1 && S.bugs[nb] == null) S.bugs[nb] = o;
    }
    await driveBotTurn(engine, 1, 'overtour');
    const rec = engine.ctx.__rec;
    assert.ok(rec.intents.some(it => it.pi === 1 && it.act === 'overmode'), 'the bot opened overtourism mode');
    assert.ok(rec.intents.some(it => it.pi === 1 && it.act === 'overtour' && it.id === 'us'), 'the bot sent the ships to the US chart');
    assert.ok(S.ov, 'overtourism is riding a rival node');
    assert.equal(S.ov.by, 1, 'the bot is the cruise-line operator');
    assert.equal(S.ov.nid, 'us', 'the ships anchor at the victim holding');
    assert.equal(S.ov.targetOwner, 0, 'the victim is the staged rival');
  });
});

test('BT-06d bots rebuild rubble under their feet when rich (geo DLC)', async t => {
  await withSeedAsync(555, async () => {
    const engine = await rigGame(t, true);
    const S = engine.acc.S;
    S.players[1].money = 500;
    S.players[1].intel = 0; /* no bugs, no spy, no leaks */
    S.players[1].pos = 'us';
    for (const id in S.owner) if (S.owner[id] === 1) S.owner[id] = null; /* the bot owns nothing else to do */
    S.owner.us = null;
    S.rubble.us = 1;
    await driveBotTurn(engine, 1, 'rebuild');
    const rec = engine.ctx.__rec;
    assert.ok(rec.intents.some(it => it.pi === 1 && it.act === 'rebuild'), 'the bot rebuilt the rubble it stood on');
    assert.ok(!S.rubble.us, 'the node came back from rubble');
    assert.equal(rec.pre.money, 500, 'the bot held its cash before the rebuild');
  });
});

test('BT-06e the 30-Intel Cortisol Overload targets the strongest rival', async t => {
  await withSeedAsync(555, async () => {
    const engine = await rigGame(t, false);
    const S = engine.acc.S;
    S.players[1].money = 40;
    S.players[1].intel = 30;
    S.players[0].cortisol = 4; /* +6 from the overload lands any chosen rival on 9 */
    S.players[2].cortisol = 4;
    /* a raid is priced by what it takes, so the targets need real holdings */
    const book = engine.acc.NODES.filter(n => n.id.indexOf('geo_') !== 0 && n.income >= 2);
    S.owner[book[0].id] = 0; S.owner[book[1].id] = 0;
    S.owner[book[2].id] = 2; S.owner[book[3].id] = 2;
    await driveBotTurn(engine, 1, 'targetpanic');
    const rec = engine.ctx.__rec;
    assert.ok(rec.intents.some(it => it.pi === 1 && it.act === 'targetpanic'), 'the bot unleashed the overload');
    assert.ok(S.log.some(l => l.includes('overload')), 'the engine logged the overload');
    assert.equal(rec.pre.intel, 30, 'the bot held 30 Intel before the overload');
    assert.equal(S.players[1].intel, 0, 'the 30-Intel price was paid');
    const hit = [0, 2].some(j => S.players[j].cortisol >= 9 || S.players[j].raided === 1);
    assert.ok(hit, 'the victim hit the raid threshold');
  });
});

test('BT-07 bots banter on the table chat — one line at a time, in voice', async t => {
  const engine = await botEngine(t);
  const S = await makeGame(engine, 3, { bots: [0, 1, 2], goal: 100, seeds: [41] });
  await driveToOver(engine, S);
  const botNames = new Set(S.players.filter(p => p.bot).map(p => p.name));
  const botChats = S.chat.filter(c => botNames.has(c.n));
  assert.ok(botChats.length >= 1, 'the bots said something over a full game');
  assert.equal(botChats.length, S.chat.length, 'only bots spoke (an all-bot table)');
  for (const c of botChats) assert.ok(c.t.length > 0 && c.t.length <= 140, 'chat lines are short and real');
  assert.ok(botChats.length <= S.turn * 2 + 8, 'the banter stays sparse across ' + S.turn + ' turns');
  engine.dispose();
});

test('BT-08 the host can spectate: a lobby of only bots starts and plays', async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  engine.ctx.window.__BIGCON_TEST__ = true; /* zero bot pacing on the virtual clock */
  engine.ctx.window.__BIGCON_BOT_SEED__ = 4242;
  await engine.loadBots();
  const Net = engine.acc.Net;
  Net.role = 'host'; Net.myIdx = 0; Net.playerId = 'host'; Net.goal = 100;
  Net.roster = [{ name: 'HOST', playerId: 'host', conn: null, char: null }];
  Net.conns = [null];
  const ctx = engine.ctx;

  /* hand the host seat to a bot */
  ctx.toggleSpectate();
  assert.equal(Net.roster.length, 1, 'the toggle converts the host row in place');
  assert.equal(Net.roster[0].bot, true, 'the host seat became a bot');
  assert.ok(Net.roster[0].char, 'the spectator bot picked a face');
  assert.ok(Net.roster[0].name.indexOf('BOT') === 0, 'the seat is named like a bot');
  assert.ok(Net.roster[0].spectated && Net.roster[0].spectated.name === 'HOST', 'the host identity is kept aside');

  /* the host row is not kickable — take the seat back instead */
  ctx.kickBotSeat(0);
  assert.equal(Net.roster.length, 1, 'kicking the spectator row is a no-op');
  assert.ok(Net.roster[0].bot, 'the spectator bot stayed seated');

  /* the seat comes back with name, player id and face intact */
  ctx.toggleSpectate();
  assert.equal(Net.roster[0].bot, false, 'the host took the seat back');
  assert.equal(Net.roster[0].name, 'HOST', 'the host name came back');
  assert.equal(Net.roster[0].playerId, 'host', 'the host player id came back');
  assert.equal(ctx.applyChar(0, CHARS8[0]), true, 'the host picked a face');
  ctx.toggleSpectate();
  assert.equal(Net.roster[0].bot, true, 'the host seat is a bot again');
  assert.equal(Net.roster[0].char, CHARS8[0], 'the spectator bot keeps the host face it was given');
  ctx.toggleSpectate();
  assert.equal(Net.roster[0].bot, false, 'the host took the seat back again');
  assert.equal(Net.roster[0].char, CHARS8[0], 'the host face came back');

  /* the real start path: the all-bot lobby goes straight through btnStart */
  ctx.toggleSpectate();
  ctx.addBotSeat(); ctx.addBotSeat();
  assert.equal(Net.roster.length, 3, 'two table bots joined the spectator bot');
  assert.equal(new Set(Net.roster.map(e => e.char)).size, 3, 'every face at the all-bot table is unique');
  engine.f.broadcastLobby();
  assert.equal(engine.elems.get('btnStart').disabled, false, 'an all-bot lobby unlocks START');
  assert.ok(String(engine.elems.get('btnStart').textContent).indexOf('ALL-BOT TABLE') >= 0, 'the start button announces the all-bot table');

  ctx.__toasts = [];
  const realToast = engine.hooks.toast;
  engine.hooks.toast = m => { ctx.__toasts.push(String(m)); return realToast(m); };
  const seats = Net.roster.map(e => ({ name: e.name, char: e.char, bot: !!e.bot }));
  await withSeedAsync(99, () => engine.f.initGame(seats));
  const S = engine.acc.S;
  assert.equal(Net.started, true, 'the con started');
  assert.ok(S.players.every(p => p.bot), 'every seated player is a bot — the host just watches');

  await driveToOver(engine, S);
  assert.equal(S.over, true, 'the all-bot game reached a winner');
  assert.equal(engine.ctx.__toasts.filter(x => /YOUR TURN/i.test(x)).length, 0, 'no YOUR TURN toast ever reached the spectator host');
  const errs = engine.consoleOut.error.filter(l => String(l).includes('bot turn error'));
  assert.equal(errs.length, 0, 'no bot turn crashed, including the host seat: ' + String(errs[0] || '').slice(0, 200));
});

test('BT-09 every face plays its own con — per-character strategy profiles', async t => {
  const engine = await botEngine(t);
  const bots = engine.ctx.window.BigConBots;
  const IDS = ['markwatson', 'tomkins', 'jimchalmers', 'bessock', 'calvinathanasius', 'denialswan',
    'japsnchen', 'thousandyardwax', 'Alexander_Lane', 'DJT', 'thebigag', 'thebigwegrzyn'];
  for (const id of IDS) {
    const s = bots.STRATEGIES[id];
    assert.ok(s, id + ' has a strategy profile');
    assert.ok(s.label && Array.isArray(s.nodes) && Array.isArray(s.types), id + "'s profile is shaped right");
    assert.ok(s.aggr > 0 && s.risk > 0 && s.cash > 0, id + "'s temperament knobs are positive");
  }
  /* the flavour matches the face */
  assert.ok(bots.STRATEGIES.markwatson.nodes.indexOf('coal') >= 0, 'mark watson pursues the coal industry');
  assert.ok(bots.STRATEGIES.markwatson.nodes.indexOf('watson') >= 0, 'mark watson keeps his own face on the board');
  assert.ok(bots.STRATEGIES.bessock.nodes.indexOf('rba') >= 0 && bots.STRATEGIES.bessock.types.indexOf('REGULATOR') >= 0, 'bessock goes for the RBA');
  assert.ok(bots.STRATEGIES.DJT.nodes.indexOf('trump') >= 0 && bots.STRATEGIES.DJT.nodes.indexOf('fox') >= 0, 'the tariff man buys the megaphone');
  assert.ok(bots.STRATEGIES.DJT.aggr > bots.STRATEGIES.bessock.aggr, 'DJT is angrier than the central banker');
  assert.ok(bots.STRATEGIES.tomkins.cash > 1, 'tomkins chases raw cash (the boulder)');
  assert.ok(bots.STRATEGIES.thousandyardwax.risk > 1, 'the sniper does not fear the raid threshold');
  /* lookup through a live view, including the unknown-face fallback */
  const prof = id => bots.strategyOf({ players: [{ char: id }] }, 0);
  assert.equal(prof('DJT'), bots.STRATEGIES.DJT, 'a seated DJT resolves to his profile');
  const fb = prof('nobody');
  assert.ok(fb && fb !== bots.STRATEGIES.DJT && fb.aggr === 1 && Array.isArray(fb.nodes), 'unknown faces fall back to the all-rounder');
  /* variants rescale every profile and switch back cleanly */
  bots.setVariant('aggro');
  assert.ok(engine.ctx.window.BigConBots.variant.aggr > 1, 'the aggro variant turns the table hostile');
  bots.setVariant('baseline');
  assert.equal(engine.ctx.window.BigConBots.variant.aggr, 1, 'the baseline variant restores stock temperament');
  assert.equal(prof('DJT'), bots.STRATEGIES.DJT, 'profiles survive variant churn');
});

test('BT-10 a non-baseline variant still finishes the con deterministically', async t => {
  const engine = await botEngine(t, 777);
  engine.ctx.window.BigConBots.setVariant('turtle');
  const S = await makeGame(engine, 2, { bots: [0, 1], goal: 60, seeds: [41, 42, 43, 44, 45] });
  await driveToOver(engine, S);
  assert.equal(S.over, true, 'the turtle table still reaches a winner');
});

test('BT-11 the payout does not kick the table out — the lobby re-arms for a rematch', async t => {
  const engine = await botEngine(t);
  const S = await makeGame(engine, 3, { bots: [0, 1, 2], goal: 100, seeds: [41] });
  const Net = engine.acc.Net;
  await driveToOver(engine, S);
  assert.equal(S.over, true, 'the con finished');

  /* the old behavior scheduled a page reload 400ms after the payout — dead now */
  await pump(4); engine.clock.advance(600);
  assert.equal(engine.location.reloadCount, 0, 'nobody was reloaded after the payout');
  assert.equal(Net.started, true, 'the room is still alive');
  assert.equal(Net.roster.length, 3, 'the roster is still seated');
  assert.ok(Net.conns.every(c => c == null || c.open), 'every connection is still open');

  /* the host's GAME OVER card offers the lobby, not the door */
  engine.ctx.renderSide();
  assert.ok(String(engine.elems.get('side').innerHTML).indexOf('BACK TO THE LOBBY') >= 0, 'the host sees the walk-back button');

  /* walking back keeps every face and re-arms the room; each open seat is
     told its own roster row for the lobby's YOU marker */
  const sent = [];
  Net.conns = Net.conns.map((c, i) => i === Net.myIdx ? null : { open: true, send: m => sent.push({ i, m }) });
  engine.ctx.backToLobby();
  assert.equal(Net.started, false, 'the lobby re-arms');
  assert.equal(Net.begun, false, 'the finished game is forgotten');
  assert.equal(engine.acc.S, null, 'the old game is released');
  assert.equal(Net.roster.length, 3, 'the roster survives — same faces, same room');
  assert.ok(Net.roster.every(e => e.char), 'every face is still picked');
  const told = sent.filter(x => x.m && x.m.t === 'tolobby');
  assert.equal(told.length, Net.conns.filter(c => c).length, 'every open seat was walked back');
  assert.ok(told.every(x => x.m.idx === x.i), 'each seat was told its own roster row');

  /* the next con deals straight from the re-armed lobby */
  const seats = Net.roster.map(e => ({ name: e.name, char: e.char, bot: !!e.bot }));
  await withSeedAsync(77, () => engine.f.initGame(seats));
  assert.equal(Net.started, true, 'the rematch started');
  assert.equal(engine.acc.S.over, false, 'the new game is live');
  await driveToOver(engine, engine.acc.S);
  assert.equal(engine.acc.S.over, true, 'the rematch also reaches a winner');
});

test('BT-12 a guest walked back from the payout lands in the lobby on their own row', async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  const Net = engine.acc.Net;
  Net.role = 'guest'; Net.begun = true; Net.myIdx = 4;
  engine.ctx.onGuestData({ t: 'tolobby', idx: 2 });
  assert.equal(Net.begun, false, 'the guest left game mode');
  assert.equal(Net.myIdx, 2, 'the guest was told their roster row');
  assert.equal(engine.elems.get('lobbyView').style.display, 'block', 'the guest sees the lobby');
  assert.equal(engine.elems.get('app').style.display, 'none', 'the game screen is hidden');
  assert.equal(engine.elems.get('btnStart').style.display, 'none', 'the guest does not see START');
});

test('BT-13 an all-bot table runs its market events without popup spam', async t => {
  const engine = await botEngine(t);
  const S = await makeGame(engine, 3, { bots: [0, 1, 2], goal: 100, seeds: [41] });
  await driveToOver(engine, S);
  assert.equal(S.over, true, 'the all-bot con finished');
  assert.ok(S.turn > 2, 'the game ran a real number of turns (' + S.turn + ')');
  assert.ok(S.log.some(l => l.indexOf('🎴 EVENT — ') === 0), 'market events still resolved — the record keeps them');
  assert.equal(engine.modalRec.filter(m => m.title.startsWith('MARKET EVENT')).length, 0,
    'no market-event popup was shown at a table of only bots');
});

test('BT-14 a mid-game joiner is dealt in at Quikstop and takes their turns', async t => {
  const engine = await botEngine(t);
  const S = await makeGame(engine, 2, { bots: [0, 1], goal: 100, seeds: [41] });
  const Net = engine.acc.Net;
  assert.equal(S.players.length, 2, 'the game starts as a duo');

  /* the handshake: hello mid-game gets the joiner a choice, not the door */
  const c = makeConn(engine, 'pid-late');
  engine.f.handleHello(c, 'Late Larry', 'pid-late');
  const mid = c.sent.find(m => m.t === 'midjoin');
  assert.ok(mid, 'the host asked the joiner what they want');

  engine.f.onHostData(c, { t: 'joinmode', v: 'player' });
  const face = c.sent.find(m => m.t === 'joinface');
  assert.ok(face, 'a player-joiner is shown the free faces');
  const taken = new Set(S.players.map(p => p.char));
  assert.ok(face.free.every(id => !taken.has(id)), 'no taken face is offered');
  assert.ok(face.free.length >= 10, 'the full roster minus two is free');

  const char = face.free[0];
  engine.f.onHostData(c, { t: 'joinchar', char });
  assert.equal(S.players.length, 3, 'the joiner holds a live seat');
  const np = S.players[2];
  assert.equal(np.name, 'Late Larry');
  assert.equal(np.pos, 'quik', 'they spawn at Quikstop');
  assert.equal(np.money, 15, 'the same $15 every first turn gets');
  assert.equal(np.intel, 2, 'and the same 2 Intel');
  assert.equal(np.visited.quik, true, 'Quikstop counts as visited');
  assert.equal(np.dc, false, 'they are connected, not away');
  assert.equal(np.bot, false, 'they play by hand');
  const row = Net.roster[2];
  assert.ok(row && row.char === char && row.conn === c, 'the roster row carries face and connection');
  const wel = c.sent.find(m => m.t === 'welcome');
  assert.ok(wel && wel.idx === 2 && wel.s && wel.s.players.length === 3, 'the joiner was welcomed with the full live state');
  assert.ok(S.log.some(l => l.includes('Late Larry') && l.includes('Quikstop')), 'the record announces the joiner');

  /* the new seat participates: parked (away), it still takes its turns to the payout */
  np.dc = true;
  await driveToOver(engine, S);
  assert.equal(S.over, true, 'the three-seat con finishes with the late joiner in the rotation');
});

test('BT-15 a mid-game joiner can take the spectator rail and chat from it', async t => {
  const engine = await botEngine(t);
  const S = await makeGame(engine, 2, { bots: [0, 1], goal: 100, seeds: [41] });
  const Net = engine.acc.Net;

  const c = makeConn(engine, 'pid-watch');
  engine.f.handleHello(c, 'Rail Bird', 'pid-watch');
  assert.ok(c.sent.find(m => m.t === 'midjoin'), 'the host asked the joiner what they want');

  engine.f.onHostData(c, { t: 'joinmode', v: 'spect' });
  assert.equal(S.players.length, 2, 'no seat was created — the rail holds nobody');
  const row = Net.roster[2];
  assert.ok(row && row.spect === true && row.char === null && row.conn === c, 'the spectator row rides past the seated table');
  const wel = c.sent.find(m => m.t === 'welcome');
  assert.ok(wel && wel.spect === true && wel.idx === 2 && wel.s, 'the spectator was welcomed with the read-only flag and live state');

  /* the rail sees table-wide traffic: state broadcasts and bulletins */
  engine.f.sync(true);
  assert.ok(c.sent.some(m => m.t === 'state'), 'state broadcasts reach the spectator');
  engine.f.announceAll('TEST BULLETIN', 'x');
  assert.ok(c.sent.some(m => m.t === 'event' && m.title === 'TEST BULLETIN'), 'table-wide bulletins reach the spectator');

  /* spectators chat under their own name — never through a seated pname() */
  engine.f.onHostData(c, { t: 'chat', text: 'watching the wheels' });
  const last = S.chat[S.chat.length - 1];
  assert.ok(last && last.n === '👁 Rail Bird', 'the spectator chatted under their roster name');

  /* at the walk-back the spectator steps off the rail to pick a face like anyone else */
  await driveToOver(engine, S);
  engine.ctx.backToLobby();
  assert.equal(Net.roster[2].spect, false, 'the spect flag is cleared');
  assert.equal(Net.roster[2].char, null, 'they owe the lobby a face');
  assert.ok(String(engine.elems.get('btnStart').textContent).includes('pick a face'), 'the start gate waits on them, as for any guest');
});

test('BT-16 the guest client wears the spectator flag: on at a spectator welcome, off in the lobby', async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  const Net = engine.acc.Net;
  Net.role = 'guest'; Net.begun = false; Net.myIdx = 0;
  engine.ctx.onGuestData({ t: 'welcome', idx: 4, spect: true });
  assert.equal(Net.spect, true, 'the spectator welcome set the flag');
  assert.equal(Net.myIdx, 4, 'the spectator holds their roster row');
  engine.ctx.onGuestData({ t: 'tolobby', idx: 4 });
  assert.equal(Net.spect, false, 'the lobby clears the flag — they pick a face next con');
});

/* ---------- unit rigs: hand a synthetic botView straight to takeTurn ---------- */

function fakePlayer(o = {}) {
  return { name: 'P', color: '#fff', char: 'nobody', money: 50, intel: 0, cortisol: 0, pos: 'n1', bot: true, dc: false, ...o };
}
function fakeView(o = {}) {
  const view = {
    pi: 0, turn: 12, phase: 'action', curSeat: 0, over: false, goal: 100,
    mood: 'CALM', moodRate: 2, steps: 0, spun: false, audited: false, cooked: false,
    budgeted: false, dossier: false, geo: false, geoBeach: false, geoVenice: false,
    geoMissiled: false, sisyPayout: 10, blockadeUsed: false, pressured: false,
    bondmageddonUsed: false, slipped: false, extraStep: false,
    owner: {}, bugs: {}, rubble: {}, blockades: {}, edges: [],
    country: [], oilIds: [], cardIds: [], discardIds: [],
    industryIds: [{ id: 'bank', ids: ['n1', 'n2'] }],
    players: [], nmap: {}, nodes: [],
    missingTypes: () => [],
    seizePrice: () => 1, takePrice: () => 10, flatSeize: () => false,
    ...o,
  };
  return view;
}
/* Run exactly one bot decision over the rig; the first (or chosen) intent
   flips the fake view out of the action phase so takeTurn returns. `fresh`
   re-seeds the module (default); pass false to keep cross-turn memory. */
async function botDecides(t, view, stopOn, fresh = true) {
  const Bots = (await engineWithBots(t)).ctx.window.BigConBots;
  const intents = [];
  const api = {
    applyIntent: async (pi, m) => {
      intents.push(m);
      if (!stopOn || stopOn(m)) { view.phase = 'move'; view.curSeat = -1; }
    },
    viewOf: () => view,
    chat: () => {},
  };
  if (fresh) Bots.resetForGame(11);
  await Bots.takeTurn(0, view, api);
  return intents;
}
async function engineWithBots(t) {
  if (!engineWithBots.memo) {
    const engine = await loadEngine();
    engine.ctx.window.__BIGCON_TEST__ = true;
    engine.ctx.window.__BIGCON_BOT_SEED__ = 4242;
    await engine.loadBots();
    engineWithBots.memo = engine;
    t.after(() => { engineWithBots.memo.dispose(); engineWithBots.memo = null; });
  }
  return engineWithBots.memo;
}

test('BT-17 a hot bot cools instead of scheming its way into a raid', async t => {
  /* a raid costs two best nodes plus a caution turn — at cortisol 8 the cool
     must outrank even a raid-push leak against a steaming rival */
  const hot = fakeView({
    owner: { n1: 0, r1: 1, r2: 1 },
    nmap: { n1: { id: 'n1', type: 'BANK', income: 3, cost: 5 }, r1: { id: 'r1', type: 'CHART', income: 2, cost: 4 }, r2: { id: 'r2', type: 'MEDIA', income: 2, cost: 4 } },
    players: [fakePlayer({ cortisol: 8, intel: 2 }), fakePlayer({ pos: 'r1', cortisol: 6, money: 50 })],
  });
  const intents = await botDecides(t, hot);
  assert.equal(intents[0].act, 'laylow', 'the hot bot acted');
  assert.equal(intents[0].choice, 'cool', 'at cortisol 8 with a raid-push leak on the table, it still chose to cool');

  /* the same cold bot with nothing to buy passes for cash instead */
  const cold = fakeView({
    owner: { n1: 0 },
    nmap: { n1: { id: 'n1', type: 'BANK', income: 0, cost: 5 } },
    players: [fakePlayer({ cortisol: 1, money: 0, intel: 0 })],
    seizePrice: () => 60,
  });
  const intents2 = await botDecides(t, cold);
  assert.equal(intents2[0].act, 'laylow', 'the cold bot also acts');
  assert.equal(intents2[0].choice, 'cash', 'a cold bot with no plays banks the lay-low cash');
});

test('BT-18 bots aim attacks at humans over equally juicy bots', async t => {
  /* two rivals steaming at cortisol 6 with identical books — the only
     difference is one is a human seat; the leak must go to the human */
  for (const human of [1, 2]) {
    const view = fakeView({
      owner: { n1: 0, r1: 1, r2: 1, s1: 2, s2: 2 },
      nmap: {
        n1: { id: 'n1', type: 'BANK', income: 3, cost: 5 },
        r1: { id: 'r1', type: 'CHART', income: 2, cost: 4 }, r2: { id: 'r2', type: 'MEDIA', income: 2, cost: 4 },
        s1: { id: 's1', type: 'CHART', income: 2, cost: 4 }, s2: { id: 's2', type: 'MEDIA', income: 2, cost: 4 },
      },
      players: [
        fakePlayer({ intel: 2 }),
        fakePlayer({ pos: 'r1', cortisol: 6, money: 50, bot: human !== 1 }),
        fakePlayer({ pos: 's1', cortisol: 6, money: 50, bot: human !== 2 }),
      ],
    });
    const intents = await botDecides(t, view, m => m.act === 'leak');
    const leaks = intents.filter(m => m.act === 'leak');
    assert.ok(leaks.length >= 1, 'the bot fired a leak');
    assert.ok(leaks.every(m => m.target === human), 'seat ' + human + ' is human — every leak went there, never at the bot');
  }
});

test('BT-19 the win set bends acquisition: hunger scales, near-complete rivals get denied', async t => {
  /* A: the node completes my last missing type — worth the steep list price */
  const hunger = fakeView({
    nmap: { n1: { id: 'n1', type: 'BANK', income: 1, cost: 5 } },
    players: [fakePlayer({ money: 100 })],
    seizePrice: () => 60,
    missingTypes: () => ['BANK'],
  });
  assert.equal((await botDecides(t, hunger))[0].act, 'seize', 'the final set piece is seized even at $60');

  /* B: the same node of a type I already hold — income alone does not pay that */
  const meh = fakeView({
    nmap: { n1: { id: 'n1', type: 'BANK', income: 1, cost: 5 } },
    players: [fakePlayer({ money: 100 })],
    seizePrice: () => 60,
    missingTypes: () => ['CHART'],
  });
  const intentsB = await botDecides(t, meh);
  assert.equal(intentsB[0].act, 'laylow', 'a duplicate-type node at the same price is walked away from');
  assert.equal(intentsB[0].choice, 'cash', 'and the turn banks cash instead');

  /* C: the rival holds the whole set and this is their ONLY bank — take it and
     their set reopens (missingTypes follows ownership, as the engine's does) */
  const deny = fakeView({
    owner: { n1: 1 },
    nmap: { n1: { id: 'n1', type: 'BANK', income: 0, cost: 5 } },
    players: [fakePlayer(), fakePlayer({ pos: 'n1', money: 90 })],
    takePrice: () => 10,
    missingTypes: () => [],
  });
  assert.equal((await botDecides(t, deny))[0].act, 'seize', 'a full-set rival loses their only node of a type');

  /* D: same rival, but they hold a second bank — taking one leaves the set whole */
  const noDeny = fakeView({
    owner: { n1: 1, n2: 1 },
    nmap: { n1: { id: 'n1', type: 'BANK', income: 0, cost: 5 }, n2: { id: 'n2', type: 'BANK', income: 0, cost: 5 } },
    players: [fakePlayer(), fakePlayer({ pos: 'n1', money: 90 })],
    takePrice: () => 10,
    missingTypes: () => [],
  });
  assert.equal((await botDecides(t, noDeny))[0].act, 'laylow', 'a takeover that breaks nothing is not bid up');
});

test('BT-20 lobby chatter: bots speak in character on seat and on a slow clock', async t => {
  const engine = (await engineWithBots(t));
  const Bots = engine.ctx.window.BigConBots;
  assert.equal(typeof Bots.lobbyLine, 'function', 'the policy exports lobbyLine');
  for (const id of CHARS8) {
    const line = Bots.lobbyLine(id);
    assert.ok(typeof line === 'string' && line.length > 0 && line.length <= 140, id + ' has in-voice lobby lines');
  }
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(Bots.lobbyLine('DJT'));
  assert.ok(seen.size >= 2, 'lobby lines rotate — not one broken record');

  const Net = engine.acc.Net;
  const ctx = engine.ctx;
  Net.role = 'host'; Net.myIdx = 0; Net.started = false;
  Net.roster = [{ name: 'HOST', playerId: 'host', conn: null, char: null }];

  ctx.addBotSeat();
  const intro = Net.lobbyChat[Net.lobbyChat.length - 1];
  assert.ok(intro && intro.n === Net.roster[1].name && intro.t.length > 0, 'a seated bot introduces itself in the lobby chat');

  const count = Net.lobbyChat.length;
  Net.lobbyChatAt = Date.now();
  ctx.broadcastLobby();
  assert.equal(Net.lobbyChat.length, count, 'the 20s gap gate holds the ambient chatter');
  assert.ok(Net.lobbyChatT, 'the ambient clock is scheduled by the lobby broadcast');
  Net.lobbyChatAt = 0;
  ctx.broadcastLobby();
  assert.equal(Net.lobbyChat.length, count + 1, 'after the gap a bot mutters again');
  assert.equal(Net.lobbyChat[Net.lobbyChat.length - 1].n, Net.roster[1].name, 'the mutter came from the bot');
});

test('BT-21 sweep clears rival bugs off your own nodes — the office really is clean', async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  const S = await makeGame(engine, 2, { seeds: [41] });
  const NM = engine.acc.NODES.filter(n => n.id.indexOf('geo_') !== 0);
  const mine = NM[0].id, rival = NM[1].id;
  S.owner[mine] = 0; S.owner[rival] = 1;
  S.bugs[mine] = 1;   /* planted by seat 1, sitting on MY node */
  S.bugs[rival] = 0;  /* my own skim on their node */
  S.cur = 0; S.phase = 'action'; S.mode = null;
  S.players[0].intel = 5;
  S.deck = Array.from({ length: 20 }, () => 'quiet');
  await engine.f.applyIntent(0, { act: 'sweep' });
  await pump();
  assert.equal(S.bugs[mine], undefined, 'the rival bug on my node is swept (the rules copy says "remove every bug on your nodes")');
  assert.equal(S.bugs[rival], undefined, 'my own skim operation is closed too');
  assert.equal(S.players[0].intel, 3, 'the sweep cost 2 Intel');
});

test('BT-22 a bugged bot pays for the office sweep instead of letting the skim run', async t => {
  const view = fakeView({
    owner: { n1: 0 },
    nmap: { n1: { id: 'n1', type: 'BANK', income: 3, cost: 5 } },
    bugs: { n1: 1 }, /* a rival bug on the bot's own node */
    players: [fakePlayer({ intel: 2 })],
  });
  const intents = await botDecides(t, view);
  assert.equal(intents[0].act, 'sweep', 'the rival skim is worth a turn — the bot swept');
});

test('BT-23 humans are prioritised by threat: a rich human outranks a broke one', async t => {
  const view = fakeView({
    owner: { n1: 0, r1: 1, r2: 1, s1: 2, s2: 2 },
    nmap: {
      n1: { id: 'n1', type: 'BANK', income: 3, cost: 5 },
      r1: { id: 'r1', type: 'CHART', income: 2, cost: 4 }, r2: { id: 'r2', type: 'MEDIA', income: 2, cost: 4 },
      s1: { id: 's1', type: 'CHART', income: 2, cost: 4 }, s2: { id: 's2', type: 'MEDIA', income: 2, cost: 4 },
    },
    players: [
      fakePlayer({ intel: 2 }),
      fakePlayer({ pos: 'r1', cortisol: 6, money: 95, bot: false }), /* human, near the bank */
      fakePlayer({ pos: 's1', cortisol: 6, money: 10, bot: false }), /* human, going nowhere */
    ],
  });
  const intents = await botDecides(t, view, m => m.act === 'leak');
  const leaks = intents.filter(m => m.act === 'leak');
  assert.ok(leaks.length >= 1, 'the bot fired a leak');
  assert.ok(leaks.every(m => m.target === 1), 'the human closest to winning is the target, not the broke one');
});

test('BT-24 bots remember a takeover: the seat that took the node becomes the target', async t => {
  const book = {
    x: { id: 'x', type: 'BANK', income: 2, cost: 5 },
    y: { id: 'y', type: 'BANK', income: 2, cost: 5 },
    n1: { id: 'n1', type: 'CHART', income: 2, cost: 5 },
    r1: { id: 'r1', type: 'CHART', income: 2, cost: 4 }, r2: { id: 'r2', type: 'MEDIA', income: 2, cost: 4 },
    s1: { id: 's1', type: 'CHART', income: 2, cost: 4 }, s2: { id: 's2', type: 'MEDIA', income: 2, cost: 4 },
  };
  const mk = (extra, turn = 12) => fakeView({
    turn,
    owner: { ...extra, n1: 0, r1: 1, r2: 1, s1: 2, s2: 2 },
    nmap: book,
    players: [
      fakePlayer({ intel: 2 }),
      fakePlayer({ pos: 'r1', cortisol: 6, money: 50 }),
      fakePlayer({ pos: 's1', cortisol: 6, money: 50 }),
    ],
  });
  const leakTargets = async (view, fresh) => (await botDecides(t, view, m => m.act === 'leak', fresh))
    .filter(m => m.act === 'leak').map(m => m.target);
  const Bots = () => engineWithBots.memo.ctx.window.BigConBots; await engineWithBots(t);

  /* control: with no theft the identical rivals tie, and the first one is picked */
  assert.deepEqual(await leakTargets(mk({ x: 0 }), true), [1], 'no grudge: the tie goes to seat 1');

  /* the thief is the seat the tie would NOT pick, so only the grudge can aim it */
  await leakTargets(mk({ x: 0 }), true);
  assert.deepEqual(await leakTargets(mk({ x: 2 }, 13), false), [2], 'one takeover is enough to redirect the leak');

  /* repeat offences stack across turns */
  await leakTargets(mk({ x: 0, y: 0 }), true);
  await leakTargets(mk({ x: 2, y: 0 }, 13), false);
  const once = Bots().memory[0].grudge[2];
  await leakTargets(mk({ x: 2, y: 2 }, 14), false);
  assert.ok(Bots().memory[0].grudge[2] > once, 'a second takeover deepens the grudge');

  /* a node bought during my turn counts: the snapshot closes the turn */
  const buying = mk({});
  const api = {
    applyIntent: async (pi, m) => { if (m.act === 'leak') { buying.owner.x = 0; buying.phase = 'move'; buying.curSeat = -1; } },
    viewOf: () => buying, chat: () => {},
  };
  Bots().resetForGame(11);
  await Bots().takeTurn(0, buying, api);
  assert.deepEqual(await leakTargets(mk({ x: 2 }, 13), false), [2], 'a node bought last turn and taken since still stings');

  /* two rivals each taking a node in one rotation both go on the list */
  await leakTargets(mk({ x: 0, y: 0 }), true);
  await leakTargets(mk({ x: 1, y: 2 }, 13), false);
  const g = Bots().memory[0].grudge;
  assert.ok(g[1] > 0 && g[2] > 0, 'simultaneous takeovers are both attributed');

  /* a regulator's ruling returns the excess to the market: nobody holds it after,
     so nobody is blamed */
  const accc = (o, turn) => { const v = mk(o, turn); v.industryIds = [{ id: 'bank', ids: ['x', 'y', 'z'], trigger: 3 }]; v.nmap = { ...book, z: { id: 'z', type: 'BANK', income: 2, cost: 5 } }; return v; };
  await leakTargets(accc({ x: 0, y: 0, z: 0 }), true);
  await leakTargets(accc({ y: 0, z: 0 }, 13), false);
  assert.deepEqual({ ...Bots().memory[0].grudge }, {}, 'nobody is blamed for a ruling');

  /* a node I sold in a deal during my own turn is not a heist either */
  const dealing = mk({ x: 0 });
  const dapi = {
    applyIntent: async (pi, m) => { if (m.act === 'leak') { dealing.owner.x = 2; dealing.phase = 'move'; dealing.curSeat = -1; } },
    viewOf: () => dealing, chat: () => {},
  };
  Bots().resetForGame(11);
  await Bots().takeTurn(0, dealing, dapi);
  await leakTargets(mk({ x: 2 }, 13), false);
  assert.equal(Bots().memory[0].grudge[2], undefined, 'a node that left during my own turn was my own doing');
});

test('BT-25 pacing: production realms pace bots like humans, test realms run instant', async t => {
  const prod = await loadEngine();
  t.after(() => prod.dispose());
  await prod.loadBots();
  assert.equal(prod.ctx.window.BigConBots.paceMs, 150, 'an unflagged realm paces at 150ms per intent');

  const fast = await loadEngine();
  t.after(() => fast.dispose());
  fast.ctx.window.__BIGCON_TEST__ = true;
  await fast.loadBots();
  assert.equal(fast.ctx.window.BigConBots.paceMs, 0, 'the test realm runs at full speed');
});

test('BT-26 the valuation weights stay in a sane band (decay guard)', async t => {
  /* The policy is hand-tuned; a decimal slip in the weight table would quietly
     wreck it without failing any behavioural pin. These are ranges, not exact
     numbers, so re-tuning stays free but decay does not. */
  const W = (await engineWithBots(t)).ctx.window.BigConBots.weights;
  assert.ok(W && typeof W === 'object', 'the weight table is exported');
  for (const k of ['money', 'intel', 'incomeTurns', 'fire', 'setBonus', 'regScarcity', 'stepNode', 'intelNode', 'raidWall']) {
    assert.ok(Number.isFinite(W[k]) && W[k] > 0, k + ' is a positive finite number');
  }
  assert.ok(W.incomeTurns >= 10 && W.incomeTurns <= 60, 'a node income term is about a game length (' + W.incomeTurns + ')');
  assert.ok(W.setBonus > 0 && W.setBonus < W.incomeTurns * 4, 'the set bonus is meaningful but not the whole economy');
  assert.ok(W.raidWall >= 50, 'the raid wall really deters');
});

/* a rig where missingTypes follows ownership, as the engine's does */
const SET7 = ['BANK', 'REGULATOR', 'CHART', 'WILD', 'CORPORATE', 'COMMODITY', 'MEDIA'];
function realMissing(view) {
  return seat => SET7.filter(ty => !Object.keys(view.owner).some(id => view.owner[id] === seat && view.nmap[id] && view.nmap[id].type === ty));
}
const fullSet = prefix => Object.fromEntries(SET7.map((ty, i) => [prefix + i, { id: prefix + i, type: ty, income: 1, cost: 4 }]));
const ownedBy = (nodes, seat) => Object.fromEntries(Object.keys(nodes).map(id => [id, seat]));

test('BT-27 the win race needs the set as well as the cash', async t => {
  /* seat 1: rich but missing most of the set. seat 2: poorer, but holds it all. */
  const a = { a0: { id: 'a0', type: 'BANK', income: 3, cost: 4 }, a1: { id: 'a1', type: 'CHART', income: 3, cost: 4 } };
  const b = fullSet('b');
  const view = fakeView({ owner: { n1: 0, ...ownedBy(a, 1), ...ownedBy(b, 2) }, nmap: { n1: { id: 'n1', type: 'BANK', income: 1, cost: 5 }, ...a, ...b } });
  view.players = [fakePlayer({ intel: 2 }), fakePlayer({ pos: 'a0', cortisol: 5, money: 95 }), fakePlayer({ pos: 'b0', cortisol: 5, money: 80 })];
  view.missingTypes = realMissing(view);
  const Bots = (await engineWithBots(t)).ctx.window.BigConBots;
  assert.ok(Bots.etaOf(view, 2) < Bots.etaOf(view, 1), '$80 with the set is closer to winning than $95 without it');
  assert.equal(Bots.leaderSeat(view, 0), 2, 'the full-set seat is the leader');
  const leaks = (await botDecides(t, view, m => m.act === 'leak')).filter(m => m.act === 'leak');
  assert.deepEqual(leaks.map(m => m.target), [2], 'the attack goes at the real threat');
  assert.equal(Bots.memory[0].guard, 2, 'and a rich full-set rival is on guard duty');
});

test('BT-28 the race works at any goal, and its horizon follows', async t => {
  const Bots = (await engineWithBots(t)).ctx.window.BigConBots;
  const mk = goal => {
    const nodes = fullSet('b');
    const view = fakeView({ goal, owner: ownedBy(nodes, 1), nmap: nodes });
    view.players = [fakePlayer({ money: 0 }), fakePlayer({ pos: 'b0', money: goal * 0.9 })];
    view.missingTypes = realMissing(view);
    return view;
  };
  /* 90% of the goal with the set: the same number of rounds per dollar of income */
  assert.ok(Bots.etaOf(mk(100), 1) < Bots.etaOf(mk(999), 1), 'a bigger goal is further away at the same income');
  assert.equal(Bots.leaderSeat(mk(100), 0), 1, 'a one-seat comparison still finds the leader');
  /* a one-node seat cannot be attacked, but it can still be the leader */
  const lone = { l0: { id: 'l0', type: 'BANK', income: 5, cost: 4 } };
  const junk = { j0: { id: 'j0', type: 'CHART', income: 0, cost: 1 }, j1: { id: 'j1', type: 'CHART', income: 0, cost: 1 } };
  const view = fakeView({ owner: { ...ownedBy(lone, 1), ...ownedBy(junk, 2) }, nmap: { ...lone, ...junk } });
  view.players = [fakePlayer(), fakePlayer({ pos: 'l0', money: 95 }), fakePlayer({ pos: 'j0', money: 40 })];
  view.missingTypes = () => [];
  assert.equal(Bots.leaderSeat(view, 0), 1, 'the attack filter does not hide a one-node leader');
});

test('BT-29 income projection matches the engine, and marginal income works both ways', async t => {
  const engine = await botEngine(t, 4242);
  const S = await makeGame(engine, 3, { bots: [0, 1, 2], goal: 100 });
  S.over = true;
  for (let i = 0; i < 60 && (engine.clock.pending() || i < 4); i++) { await pump(2); if (engine.clock.pending()) engine.clock.advance(25); }
  const Bots = engine.ctx.window.BigConBots;
  /* random books over every live node except MADE (its 1-in-3 is an expectation) */
  const ids = engine.acc.NODES.map(n => n.id).filter(id => id !== 'made');
  let seed = 977;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let round = 0; round < 60; round++) {
    for (const id of Object.keys(S.owner)) delete S.owner[id];
    for (const id of ids) { const r = rnd(); if (r < 0.3) S.owner[id] = 0; else if (r < 0.5) S.owner[id] = 1; }
    S.mood = ['CALM', 'BOOM', 'PANIC', 'FRENZY'][round % 4];
    S.bugs = {};
    const projected = Bots.projectIncome(engine.ctx.botView(0), 0);
    const before = S.players[0].money;
    engine.f.income(0);
    assert.equal(S.players[0].money - before, projected, 'round ' + round + ' mirrors income()');
  }
  /* a chart bought under TENYEAR picks up TENYEAR's +$3, in either buying order */
  const nmap = {
    tenyear: { id: 'tenyear', type: 'CHART', income: 1, cost: 5 },
    c1: { id: 'c1', type: 'CHART', income: 1, cost: 5 },
    citi: { id: 'citi', type: 'BANK', income: 1, cost: 5 },
    p1: { id: 'p1', type: 'CORPORATE', income: 1, cost: 5 }, p2: { id: 'p2', type: 'CORPORATE', income: 1, cost: 5 },
  };
  const held = owner => fakeView({ owner, nmap, players: [fakePlayer({ money: 10 })] });
  assert.equal(Bots.marginalIncome(held({ tenyear: 0 }), 0, 'c1'), 4, 'a follow-up chart counts the synergy it unlocks');
  assert.equal(Bots.marginalIncome(held({ c1: 0 }), 0, 'tenyear'), 4, 'so does the anchor bought second');
  /* citi over two corporates: income 1 + 2, whether or not citi is already held */
  assert.equal(Bots.marginalIncome(held({ citi: 0, p1: 0, p2: 0 }), 0, 'citi'), 3, 'a held node is not counted twice');
  assert.equal(Bots.marginalIncome(held({ p1: 0, p2: 0 }), 0, 'citi'), 3, 'and is worth the same as buying it');
});

test('BT-30 MADE only taxes the rest of the table', async t => {
  const Bots = (await engineWithBots(t)).ctx.window.BigConBots;
  const nmap = { made: { id: 'made', type: 'WILD', income: 2, cost: 7 }, a: { id: 'a', type: 'BANK', income: 0, cost: 1 }, b: { id: 'b', type: 'BANK', income: 0, cost: 1 }, c: { id: 'c', type: 'BANK', income: 0, cost: 1 } };
  const mk = madeOwner => {
    const owner = { a: 0, b: 0, c: 0 };
    if (madeOwner != null) owner.made = madeOwner;
    return fakeView({ owner, nmap, players: [fakePlayer({ money: 100 }), fakePlayer()] });
  };
  assert.equal(Bots.projectIncome(mk(null), 0), 3, 'nobody pays while MADE is unowned');
  assert.equal(Bots.projectIncome(mk(1), 0), 3 - 15 * 2 / 3, 'a rival holding MADE takes 15% about 2/3 of a time a round');
  assert.ok(Bots.projectIncome(mk(0), 0) > 3 + 2, 'its owner pays nothing and banks the expected payout');
});

test('BT-31 a roast picked is a roast done: spin stops looping and second-guessing', async t => {
  await withSeedAsync(556, async () => {
    const engine = await rigGame(t, false);
    const S = engine.acc.S;
    const book = engine.acc.NODES.filter(n => n.id.indexOf('geo_') !== 0 && n.income >= 1 && n.id !== 'fox');
    S.owner.fox = 1;
    S.owner[book[0].id] = 0; S.owner[book[1].id] = 0;
    S.owner[book[2].id] = 2; S.owner[book[3].id] = 2;
    S.players[1].pos = 'fox'; S.players[1].money = 20; S.players[1].intel = 0; S.players[1].cortisol = 0;
    S.players[0].cortisol = 7; S.players[2].cortisol = 7;
    S.players[0].money = 10; S.players[2].money = 10; /* nowhere near a home stretch */
    await driveBotTurn(engine, 1, 'roast');
    const acts = engine.ctx.__rec.intents.filter(it => it.pi === 1).map(it => it.act);
    assert.equal(acts.filter(a => a === 'spin').length, 1, 'one spin: ' + acts.join(','));
    assert.ok(acts.includes('roast'), 'and the roast it was picked for');
  });
});

test('BT-32 a refused action is struck for the turn, not retried', async t => {
  const view = fakeView({
    owner: { n1: 0 },
    nmap: { n1: { id: 'n1', type: 'BANK', income: 3, cost: 5 } },
    bugs: { n1: 1 },
    players: [fakePlayer({ intel: 2 }), fakePlayer({ pos: 'zz' })],
  });
  /* the board never changes: every intent is silently refused */
  const intents = await botDecides(t, view, () => false);
  assert.equal(intents.filter(m => m.act === 'sweep').length, 1, 'tried once: ' + intents.map(m => m.act).join(','));
  assert.ok(intents.some(m => m.act === 'laylow'), 'then it moved on to something else');
  assert.ok(intents.length < 10, 'no ten-beat stall');
});

test('BT-33 a sweep weighs the skim it would close against the one it would end', async t => {
  const mk = bugs => {
    const v = fakeView({
      owner: { n1: 0, n2: 0, r1: 1, r2: 1 },
      nmap: { n1: { id: 'n1', type: 'BANK', income: 1, cost: 5 }, n2: { id: 'n2', type: 'BANK', income: 1, cost: 5 }, r1: { id: 'r1', type: 'BANK', income: 1, cost: 5 }, r2: { id: 'r2', type: 'BANK', income: 1, cost: 5 } },
      bugs,
      players: [fakePlayer({ intel: 2 }), fakePlayer({ pos: 'r1', money: 10 })],
    });
    return v;
  };
  const first = async bugs => (await botDecides(t, mk(bugs)))[0].act;
  assert.equal(await first({ n1: 1 }), 'sweep', 'a rival bug and nothing of mine to lose');
  assert.notEqual(await first({ n1: 1, r1: 0, r2: 0 }), 'sweep', 'two live skims of mine outweigh one of theirs');
});

test('BT-34 ACCC exposure is priced per node, on the one group an investigation hits', async t => {
  const group = ['b1', 'b2', 'b3'].map(id => ({ id, type: 'BANK', income: 1, cost: 1 }));
  const other = ['c1', 'c2', 'c3'].map(id => ({ id, type: 'CHART', income: 1, cost: 1 }));
  const nmap = Object.fromEntries([...group, ...other, { id: 'x', type: 'MEDIA', income: 1, cost: 1 }].map(n => [n.id, n]));
  const industryIds = [{ id: 'bank', ids: ['b1', 'b2', 'b3'] }, { id: 'chart', ids: ['c1', 'c2', 'c3'] }];
  const act = async (owner, pos) => (await botDecides(t, fakeView({ owner, nmap, industryIds, players: [fakePlayer({ pos, money: 100 })], seizePrice: () => 1 })))[0].act;
  assert.equal(await act({ b1: 0, b2: 0 }, 'b3'), 'laylow', 'a third bank risks the whole book plus a 20% fine');
  assert.equal(await act({ b1: 0, b2: 0, b3: 0, c1: 0, c2: 0, c3: 0 }, 'x'), 'seize', 'an unrelated deal is not charged for existing exposure');
});

test('BT-35 a blockade is priced on who it stops, not on the node\'s income', async t => {
  const nmap = {
    n1: { id: 'n1', type: 'BANK', income: 0, cost: 5 },
    albo: { id: 'albo', type: 'REGULATOR', income: 0, cost: 5 },
    hop: { id: 'hop', type: 'CHART', income: 0, cost: 5 },
    far: { id: 'far', type: 'MEDIA', income: 9, cost: 5 },
    r1: { id: 'r1', type: 'WILD', income: 1, cost: 5 },
    r2: { id: 'r2', type: 'WILD', income: 1, cost: 5 },
  };
  /* the rival needs only MEDIA and is rich: walling the one reachable MEDIA matters */
  const race = (edges, money) => {
    const v = fakeView({ owner: { n1: 0, albo: 0, r1: 1, r2: 1 }, nmap, edges, blockades: {} });
    v.players = [fakePlayer({ pos: 'n1' }), fakePlayer({ pos: 'r1', money })];
    v.nodes = Object.values(nmap);
    v.missingTypes = seat => (seat === 1 ? ['MEDIA'] : []);
    return v;
  };
  const walls = async v => (await botDecides(t, v, m => m.act === 'blockade')).filter(m => m.act === 'blockade').map(m => m.id);
  assert.deepEqual(await walls(race([['r1', 'hop'], ['hop', 'far']], 99)), ['far'], 'the winning node a rival can reach is walled');
  assert.deepEqual(await walls(race([['n1', 'far']], 99)), [], 'the same node out of their reach is not worth a wall');
  assert.deepEqual(await walls(race([['r1', 'hop'], ['hop', 'far']], 0)), [], 'and a rival nowhere near winning is not worth one');
});

test('BT-36 a raid is priced by what it would take', async t => {
  const Bots = (await engineWithBots(t)).ctx.window.BigConBots;
  const nmap = {
    j1: { id: 'j1', type: 'BANK', income: 0, cost: 1 }, j2: { id: 'j2', type: 'BANK', income: 0, cost: 1 },
    g1: { id: 'g1', type: 'BANK', income: 5, cost: 9 }, g2: { id: 'g2', type: 'BANK', income: 5, cost: 9 },
  };
  const mk = (owner, money, intel) => fakeView({ owner, nmap, players: [fakePlayer(), fakePlayer({ money, intel })] });
  const junk = Bots.raidValue(mk({ j1: 1, j2: 1 }, 5, 0), 1);
  const rich = Bots.raidValue(mk({ g1: 1, g2: 1 }, 90, 8), 1);
  assert.ok(junk < 40, 'two junk nodes and an empty till are cheap to lose (' + junk + ')');
  assert.ok(rich > junk * 5, 'a rich book is not (' + rich + ')');
});

test('BT-39 two seats cannot swap one prize forever', async t => {
  /* table 2, seed 37 stalled on MADE: 297 of 298 takeovers, $850 each and no set */
  const engine = await botEngine(t, 1037);
  const Net = engine.acc.Net;
  Object.assign(Net, { role: 'host', myIdx: 0, goal: 100, dlcGeo: false, started: false, begun: true, lobbyChat: [], roster: [], conns: [] });
  const defs = ['denialswan', 'thousandyardwax'].map((id, i) => ({ name: 'B' + i, playerId: 'p' + i, conn: null, char: id, bot: true }));
  await withSeedAsync(37, () => engine.f.initGame(defs));
  const S = engine.acc.S;
  await driveToOver(engine, S);
  assert.ok(S.over, 'the con finished');
  assert.ok(S.turn < 80, 'in a sane number of rounds (' + S.turn + ')');

  /* the mechanism: seat-to-seat swaps are tracked from the table-visible board,
     a node going back to the market is not a swap, and a new game starts clean */
  const Bots = (await engineWithBots(t)).ctx.window.BigConBots;
  const seenBoard = owner => {
    const v = fakeView({ owner, over: true, phase: 'over', nmap: { made: { id: 'made', type: 'WILD', income: 2, cost: 7 } } });
    v.players = [fakePlayer()];
    return Bots.takeTurn(0, v, { applyIntent: async () => {}, viewOf: () => v, chat: () => {} });
  };
  Bots.resetForGame(11);
  await seenBoard({ made: 1 });
  await seenBoard({ made: 0 });
  await seenBoard({ made: 1 });
  assert.equal(Bots.churn.made, 2, 'two swaps seen');
  await seenBoard({});
  await seenBoard({ made: 0 });
  assert.equal(Bots.churn.made, 2, 'a stint unowned is not a swap');
  Bots.resetForGame(11);
  assert.equal(Bots.churn.made, undefined, 'a fresh game has no history');
});

test('BT-40 a seat with the cash covered wants set pieces, not income', async t => {
  const nmap = {
    n1: { id: 'n1', type: 'BANK', income: 9, cost: 5 },
    own: { id: 'own', type: 'BANK', income: 0, cost: 5 },
  };
  const mk = money => {
    const v = fakeView({ owner: { own: 0 }, nmap, seizePrice: () => 40 });
    v.players = [fakePlayer({ pos: 'n1', money })];
    v.missingTypes = () => ['CHART', 'MEDIA', 'WILD'];
    return v;
  };
  assert.equal((await botDecides(t, mk(70)))[0].act, 'seize', 'short of cash, a big earner pays for itself');
  assert.equal((await botDecides(t, mk(500)))[0].act, 'laylow', 'with the cash covered, the same duplicate is not worth it');
});

test('BT-41 a boulder push is worth only the cash still needed: no parking on it rich and setless', async t => {
  const mk = (money, sisyPayout, missing) => {
    const v = fakeView({ owner: { sisy: 0 }, nmap: { sisy: { id: 'sisy', type: 'WILD', income: 0, cost: 4 } }, sisyPayout });
    v.players = [fakePlayer({ pos: 'sisy', money })];
    v.missingTypes = () => missing;
    return v;
  };
  assert.equal((await botDecides(t, mk(70, 20, [])))[0].act, 'push', 'short of the goal, the push is good cash');
  assert.notEqual((await botDecides(t, mk(5000, 1e6, ['CHART'])))[0].act, 'push', 'past the goal, even a huge payout buys nothing');
});

test('BT-42 MADE pays 2/3 of a payout a round at every table size, and bots price it the same', async t => {
  const engine = (await engineWithBots(t));
  const Bots = engine.ctx.window.BigConBots;
  const income = seats => {
    const v = fakeView({ owner: { made: 0 }, nmap: { made: { id: 'made', type: 'WILD', income: 2, cost: 7 } } });
    v.players = Array.from({ length: seats }, () => fakePlayer({ money: 10 }));
    return Bots.marginalIncome(v, 0, 'made');
  };
  assert.equal(income(8), income(2), 'owning MADE is worth the same at 2 seats and 8');
  for (const seats of [2, 3, 4, 8]) {
    const e = await botEngine(t, 4300 + seats);
    const S = await makeGame(e, seats, { bots: [0], goal: 100 });
    assert.ok(Math.abs(e.ctx.madeChance() * seats - 2 / 3) < 1e-9, seats + ' seats: chance x seats = 2/3');
    if (seats === 2) assert.ok(Math.abs(e.ctx.madeChance() - 1 / 3) < 1e-9, '2 seats keep the old 33%');
    S.over = true;
  }
});

test('BT-38 a bot in the host seat answers its own prompts: no popup for a spectating host', async t => {
  const engine = await botEngine(t, 4242);
  const S = await makeGame(engine, 2, { bots: [0, 1], goal: 100 });
  S.over = true;
  for (let i = 0; i < 60 && (engine.clock.pending() || i < 4); i++) { await pump(2); if (engine.clock.pending()) engine.clock.advance(25); }
  assert.equal(engine.acc.Net.myIdx, 0, 'seat 0 is the host');
  assert.ok(S.players[0].bot, 'and a bot sits in it');
  engine.ctx.__asked = [];
  const policy = engine.ctx.window.BigConBots, answerOnce = policy.answerPrompt;
  policy.answerPrompt = function (pi, opt, api) { engine.ctx.__asked.push(pi); return answerOnce(pi, opt, api); };
  const answer = await engine.ctx.askPlayer(0, { title: 'JTPORTAL INTERVENES?', options: [{ label: 'No', v: 0 }, { label: 'Yes', v: 1 }], def: 0 });
  assert.equal(engine.ctx.__asked.length, 1, 'the policy module got the prompt');
  assert.equal(answer, 0, 'and its answer came back');
});

test('BT-37 pacing and banter never touch the decision stream', async t => {
  const engine = (await engineWithBots(t));
  const Bots = engine.ctx.window.BigConBots;
  const run = async paceMs => {
    const view = fakeView({
      owner: { n1: 0 }, nmap: { n1: { id: 'n1', type: 'BANK', income: 3, cost: 5 } },
      players: [fakePlayer()],
    });
    const api = {
      applyIntent: async () => { view.phase = 'move'; view.curSeat = -1; },
      viewOf: () => view,
      chat: () => {},
    };
    Bots.resetForGame(11);
    Bots.lastChat[0] = -10; /* free to speak, so the banter stream is drawn */
    Bots.paceMs = paceMs;
    const turn = Bots.takeTurn(0, view, api);
    for (let i = 0; i < 40; i++) { await pump(2); if (engine.clock.pending()) engine.clock.advance(1000); }
    await turn;
    Bots.paceMs = 0;
    return { stream: Bots.streams[0], chat: Bots.chatStreams[0] };
  };
  const unpaced = await run(0);
  const paced = await run(150);
  assert.equal(paced.stream, unpaced.stream, 'the same decision stream state, paced or not');
  assert.ok(unpaced.chat !== undefined, 'banter has its own stream');
});

/* ---------- the regulators' files: rulings, outs, referrals, deals ---------- */
const BANK4 = {
  b1: { id: 'b1', type: 'BANK', income: 1, cost: 3 }, b2: { id: 'b2', type: 'BANK', income: 4, cost: 6 },
  b3: { id: 'b3', type: 'BANK', income: 2, cost: 4 }, b4: { id: 'b4', type: 'BANK', income: 3, cost: 5 },
};
const askBot = async (t, view, opt) => {
  const Bots = (await engineWithBots(t)).ctx.window.BigConBots;
  Bots.resetForGame(11);
  return Bots.answerPrompt(0, opt, { viewOf: () => view, applyIntent: async () => {}, chat: () => {} });
};
const ruling = ids => ({ title: 'ACCC RULING — DIVEST 1 OF 2', options: ids.map(id => ({ label: id, v: id })), def: ids[ids.length - 1], meta: { kind: 'ruling' } });

test('BT-36 at a ruling the bot gives up what it values least — income first, but never a lone set piece', async t => {
  const view = fakeView({
    owner: { b1: 0, b2: 0, b3: 0, b4: 0 }, nmap: BANK4,
    industryIds: [{ id: 'bank', ids: ['b1', 'b2', 'b3', 'b4'], trigger: 3 }],
    acccFiles: [{ pi: 0, ind: 'bank', s: 3, agency: 'ACCC' }],
    players: [fakePlayer({ pos: 'b2' })],
  });
  assert.equal(await askBot(t, view, ruling(['b2', 'b4', 'b3', 'b1'])), 'b1', 'the $1 bank goes first');
  assert.equal(await askBot(t, view, ruling(['b2', 'b4', 'b3'])), 'b3', 'then the $2 bank — the two best are kept');
  /* a themed book mixes types: the lone WILD is a win-set piece, worth more than its $0 */
  const coal = {
    c1: { id: 'c1', type: 'COMMODITY', income: 3, cost: 5 }, c2: { id: 'c2', type: 'COMMODITY', income: 2, cost: 5 },
    c3: { id: 'c3', type: 'WILD', income: 0, cost: 6 },
  };
  const v2 = fakeView({ owner: { c1: 0, c2: 0, c3: 0 }, nmap: coal, industryIds: [{ id: 'coal', ids: ['c1', 'c2', 'c3'], trigger: 3 }], players: [fakePlayer({ pos: 'c1' })] });
  assert.equal(await askBot(t, v2, ruling(['c1', 'c2', 'c3'])), 'c2', 'the duplicate commodity goes, the only WILD stays');
});

test('BT-37 with a ruling at the next turn start the bot takes an out; earlier it waits', async t => {
  const mk = s => fakeView({
    owner: { b1: 0, b2: 0, b3: 0 }, nmap: BANK4,
    industryIds: [{ id: 'bank', ids: ['b1', 'b2', 'b3', 'b4'], trigger: 3 }],
    acccFiles: [{ pi: 0, ind: 'bank', s, agency: 'ACCC' }],
    players: [fakePlayer({ pos: 'b2', money: 100 })],
  });
  const first = (await botDecides(t, mk(2)))[0];
  assert.equal(first.act, 'marketsell', 'a ruling is imminent: sell back to the market instead of eating the fine');
  assert.equal(first.id, 'b1', 'the node a ruling would take anyway');
  assert.notEqual((await botDecides(t, mk(0)))[0].act, 'marketsell', 'two rounds out, the excess still pays — no hurry');
  /* an excess that pays more a round than 3 Intel is worth: lobby, keep it paying */
  const rich = mk(2); rich.players[0].intel = 3;
  rich.nmap = { b1: { id: 'b1', type: 'BANK', income: 8, cost: 9 }, b2: { id: 'b2', type: 'BANK', income: 9, cost: 9 }, b3: { id: 'b3', type: 'BANK', income: 10, cost: 9 }, b4: BANK4.b4 };
  const acts = (await botDecides(t, rich, m => m.act !== 'lobby')).map(m => m.act);
  assert.equal(acts[0], 'lobby', 'an $8/turn excess is worth 3 Intel to keep a round');
  assert.ok(!acts.includes('marketsell'), 'and the lobby replaces the sale: ' + acts.join(','));
});

test('BT-38 a deal offer: the bot declines an overpriced node and buys one it needs', async t => {
  const nmap = { x: { id: 'x', type: 'MEDIA', income: 1, cost: 4 }, h: { id: 'h', type: 'BANK', income: 1, cost: 4 } };
  const view = fakeView({ owner: { x: 1, h: 0 }, nmap, players: [fakePlayer({ pos: 'h', money: 60 }), fakePlayer({ pos: 'x', money: 20 })] });
  const offer = price => ({ title: 'DEAL OFFERED — X FOR $' + price, options: [{ label: 'Accept', v: 1 }, { label: 'Decline', v: 0 }], def: 0, meta: { kind: 'deal', node: 'x', price, from: 1 } });
  assert.equal(await askBot(t, view, offer(55)), 0, 'a $1/turn duplicate is not worth $55');
  view.missingTypes = seat => (seat === 0 ? ['MEDIA'] : []);
  assert.equal(await askBot(t, view, offer(5)), 1, 'a missing win-set type at near list price is bought');
  assert.equal(await askBot(t, view, offer(61)), 0, 'never more than the bot holds');
});

test('BT-39 the ACCC owner refers a rival file — the leader’s first', async t => {
  const nmap = { accc: { id: 'accc', type: 'REGULATOR', income: 1, cost: 5 } };
  ['p1', 'p2', 'p3', 'q1', 'q2', 'q3'].forEach(id => { nmap[id] = { id, type: 'BANK', income: 2, cost: 4 }; });
  const view = fakeView({
    owner: { accc: 0, p1: 1, p2: 1, p3: 1, q1: 2, q2: 2, q3: 2 }, nmap,
    industryIds: [{ id: 'bank', ids: ['p1', 'p2', 'p3', 'q1', 'q2', 'q3'], trigger: 3 }],
    acccFiles: [{ pi: 1, ind: 'bank', s: 0, agency: 'ACCC' }, { pi: 2, ind: 'bank', s: 0, agency: 'ACCC' }],
    players: [fakePlayer({ pos: 'accc', money: 40 }), fakePlayer({ pos: 'p1', money: 60 }), fakePlayer({ pos: 'q1', money: 95 })],
  });
  const intents = await botDecides(t, view, m => m.act === 'refer');
  const refer = intents.find(m => m.act === 'refer');
  assert.ok(refer, 'the bot refers: ' + intents.map(m => m.act).join(','));
  assert.equal(refer.target, 2, 'the seat closest to winning');
  assert.equal(refer.kind, 'bank');
  /* never its own file, and ASIC files are not the ACCC's to refer */
  view.acccFiles = [{ pi: 0, ind: 'bank', s: 0, agency: 'ACCC' }, { pi: 2, ind: 'monetary', s: 0, agency: 'ASIC' }];
  view.phase = 'action'; view.curSeat = 0;
  assert.ok(!(await botDecides(t, view)).some(m => m.act === 'refer'), 'nothing referable');
});

test('BT-40 a bot sheds an excess node to a non-leading rival who wants it, at or above list', async t => {
  const nmap = { ...BANK4, m1: { id: 'm1', type: 'MEDIA', income: 2, cost: 4 }, m2: { id: 'm2', type: 'MEDIA', income: 2, cost: 4 } };
  const view = fakeView({
    owner: { b1: 0, b2: 0, b3: 0, m1: 1, m2: 2 }, nmap,
    industryIds: [{ id: 'bank', ids: ['b1', 'b2', 'b3', 'b4'], trigger: 3 }],
    acccFiles: [{ pi: 0, ind: 'bank', s: 2, agency: 'ACCC' }],
    players: [fakePlayer({ pos: 'b2', money: 30 }), fakePlayer({ pos: 'm1', money: 99 }), fakePlayer({ pos: 'm2', money: 20 })],
  });
  view.missingTypes = seat => (seat === 2 ? ['BANK'] : []);
  const intents = await botDecides(t, view, m => m.act === 'deal' || m.act === 'marketsell');
  const deal = intents.find(m => m.act === 'deal');
  assert.ok(deal, 'a deal beats a plain market sale here: ' + intents.map(m => m.act).join(','));
  assert.equal(deal.target, 2, 'to the rival who is not winning');
  assert.equal(deal.id, 'b1');
  assert.ok(deal.n >= nmap.b1.cost && deal.n <= 20, 'at or above list, within their cash (' + deal.n + ')');
});

test('BT-41 MONOPOLY ALERT is priced on my open files, not on cortisol', async t => {
  const Bots = (await engineWithBots(t)).ctx.window.BigConBots;
  const view = fakeView({
    owner: { b1: 0, b2: 0, b3: 0 }, nmap: BANK4,
    industryIds: [{ id: 'bank', ids: ['b1', 'b2', 'b3', 'b4'], trigger: 3 }],
    players: [fakePlayer({ money: 100, cortisol: 8 }), fakePlayer({ cortisol: 0 })],
  });
  assert.equal(Bots.cardEV('crackdown', view, 0).money, 0, 'no file: the sweep costs nothing, however hot');
  view.acccFiles = [{ pi: 0, ind: 'bank', s: 1, agency: 'ACCC' }];
  assert.ok(Bots.cardEV('crackdown', view, 0).money < 0, 'an open file: the sweep brings the ruling closer');
  assert.equal(Bots.cardEV('crackdown', view, 0).mood, 'PANIC');
});

test('BT-42 an all-bot table with the regulators’ files still finishes cleanly', async t => {
  const engine = await botEngine(t, 9191);
  const S = await makeGame(engine, 4, { bots: [0, 1, 2, 3], goal: 100 });
  await driveToOver(engine, S);
  assert.equal(S.over, true, 'the con ends');
  const rec = engine.ctx.__rec;
  const rejects = rec.sys.filter(s => REJECT_RE.test(s.msg));
  assert.equal(rejects.length, 0, 'no rejections: ' + rejects.slice(0, 3).map(r => r.msg).join(' | '));
  assert.ok(!engine.consoleOut.error.some(l => String(l).includes('bot turn error')), 'no bot turn crashed');
});

test('BT-43 bots leave MADE alone unless they are losing badly', async t => {
  const Bots = (await engineWithBots(t)).ctx.window.BigConBots;
  const W = Bots.weights;
  const made = { id: 'made', type: 'WILD', income: 0, cost: 8 };
  const rig = (turn, moneys, extra = {}, rivalSet = true) => {
    const b = fullSet('b');
    const view = fakeView({ turn, owner: { ...(rivalSet ? ownedBy(b, 1) : {}), ...extra }, nmap: { made, ...b } });
    view.players = moneys.map(money => fakePlayer({ money }));
    view.missingTypes = realMissing(view);
    return view;
  };
  /* off spawn: level table, nobody is desperate */
  const spawn = rig(1, [15, 15, 15], {}, false);
  assert.equal(Bots.madeAppetite(spawn, 0), W.madeTruce, 'off spawn the truce holds');
  /* mid-game, seat 0 is far behind a rival with the full set and the cash */
  const losing = rig(12, [5, 90, 40]);
  assert.equal(Bots.madeAppetite(losing, 0), 1, 'the seat with nothing to lose goes for it');
  assert.equal(Bots.madeAppetite(losing, 1), W.madeTruce, 'the front-runner keeps the truce');
  /* the same losing position in round 1 is not yet desperation */
  assert.equal(Bots.madeAppetite(rig(1, [5, 90, 40]), 0), W.madeTruce, 'nobody is desperate in the opening rounds');
  /* a rival already holds it: the truce is broken, the appetite recovers part-way */
  assert.equal(Bots.madeAppetite(rig(12, [50, 50, 50], { made: 2 }), 1), W.madeBrokenTruce, 'a broken truce is fair game, somewhat');
  assert.ok(W.madeTruce > 0 && W.madeTruce < W.madeBrokenTruce && W.madeBrokenTruce < 1, 'appetite bands are ordered');
  /* and the valuation itself moves with it */
  const calm = Bots.nodeOwnValue(spawn, 0, 'made'), wild = Bots.nodeOwnValue(losing, 0, 'made');
  assert.ok(calm > 0 && wild > calm * 3, 'MADE is worth several times more to the desperate seat (' + calm.toFixed(1) + ' vs ' + wild.toFixed(1) + ')');
});
