/*
 * Dependency-free test harness for THE BIG CON.
 *
 * The game is a graph of native ES modules (index.html -> static/js/main.js).
 * This harness imports the REAL modules — nothing is concatenated or eval'd —
 * and runs them against:
 *   - fake hooks (modal recorder with queued answers, virtual-clock timers),
 *   - a virtual clock (setTimeout/setInterval are recorded and advanced by
 *     tests, so prompt timeouts, lock watchdogs and heartbeats are deterministic
 *     and can never hang the suite),
 *   - a stub DOM for the browser layer (element stubs record settable state;
 *     heavy SVG rendering is never scheduled because requestAnimationFrame is a
 *     stub),
 *   - fake PeerJS-style connections that record every outgoing message and can
 *     auto-answer private prompts or auto-ack event announcements.
 *
 * Every `await loadEngine()` gets a PRIVATE copy of the module graph (see
 * fresh-loader.mjs: a `?gen=N` query is carried through every relative import and
 * the stub environment is shadowed in per module), so several engines can live at
 * once, each with its own state, clock and DOM — like the old one-vm-per-engine.
 *
 * The DOM-free layer (hooks, util, data, state, boards, engine) needs none of
 * this: tests/engine-isolated.test.mjs imports it plain, with fake hooks only.
 *
 * Nothing here is reachable from a normal client: this file only runs under the
 * Node test runner. It adds no test hooks to production code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENV_NAMES } from './fresh-loader.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./fresh-loader.mjs', import.meta.url);
const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
export const HTML = html;

/* ---------- module graph, as the browser sees it ----------
 * index.html loads one entry module (plus the inline BUILD_COMMIT classic
 * script); the rest is whatever it statically imports. */
export function importSpecs(text) {
  const out = [];
  for (const m of text.matchAll(/^[ \t]*(?:import|export)\b[^'"`;\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm)) out.push(m[1]);
  for (const m of text.matchAll(/^[ \t]*import\s*['"]([^'"\n]+)['"]/gm)) out.push(m[1]);
  return out;
}
export function moduleEntries() {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\btype\s*=\s*["']module["']/i.test(m[1])) continue;
    const src = m[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (src && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src[1])) out.push(src[1].replace(/^\.\//, '').replace(/[?#].*$/, ''));
  }
  return out;
}
/* Depth-first post-order: dependencies before dependents, i.e. evaluation order. */
export function moduleGraph(entries = moduleEntries()) {
  const seen = new Map(); // rel -> { file, text, imports }
  const visit = rel => {
    if (seen.has(rel)) return;
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    const imports = importSpecs(text).filter(s => s.startsWith('.')).map(s => path.posix.normalize(path.posix.join(path.posix.dirname(rel), s)));
    seen.set(rel, null);
    for (const dep of imports) visit(dep);
    seen.set(rel, { file: rel, text, imports });
  };
  entries.forEach(visit);
  // Map preserves first-insertion order (pre-order); rebuild as post-order.
  const order = [];
  const done = new Set();
  const post = rel => { if (done.has(rel)) return; done.add(rel); for (const d of seen.get(rel).imports) post(d); order.push(seen.get(rel)); };
  entries.forEach(post);
  return order;
}
export const GAME_MODULES = moduleGraph();
export const INLINE_SCRIPTS = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/\bsrc\s*=/.test(m[1]) && !/\btype\s*=\s*["']module["']/i.test(m[1])).map(m => m[2]);
export const BUILD_COMMIT_VALUE = (html.match(/const BUILD_COMMIT = '([^']*)'/) || [])[1] || 'dev';
/* Static-analysis view of the game source: the inline stamp script plus every game
 * module with its import/export keywords removed, so regex checks over the rules,
 * copy and markup read like they always did. The bot policy (static/bots.js) and
 * the Discord SDK glue are separate modules and stay out. */
export const EXCLUDED_SCRIPTS = new Set(['static/bots.js', 'static/js/discord.js']);
export const stripModuleSyntax = s => s.replace(/^import [^\n]*\n/gm, '').replace(/^export \{[^}]*\};?\n/gm, '').replace(/^export (default )?/gm, '');
export const SOURCE = INLINE_SCRIPTS.concat(GAME_MODULES.filter(m => !EXCLUDED_SCRIPTS.has(m.file)).map(m => stripModuleSyntax(m.text))).join('\n');

/* ---------- virtual clock ---------- */
export function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map(); // id -> {fn, ms, at, repeat}
  function runDueUntil(until, budget = 50000) {
    let ran = 0;
    for (;;) {
      let dueId = null, due = null;
      for (const [id, t] of timers) {
        if (t.at <= until && (dueId === null || t.at < due.at || (t.at === due.at && id < dueId))) { dueId = id; due = t; }
      }
      if (dueId === null) break;
      timers.delete(dueId);
      now = Math.max(now, due.at);
      if (due.repeat) timers.set(dueId, { fn: due.fn, ms: due.ms, at: due.at + due.ms, repeat: true });
      due.fn();
      if (++ran > budget) throw new Error('virtual clock exceeded callback budget — runaway timer?');
    }
    now = Math.max(now, until);
  }
  const clock = {
    get now() { return now; },
    pending() { return timers.size; },
    setTimeout(fn, ms = 0) { const id = ++seq; timers.set(id, { fn, ms: Math.max(0, ms), at: now + Math.max(0, ms), repeat: false }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms = 0) { const id = ++seq; timers.set(id, { fn, ms: Math.max(0, ms), at: now + Math.max(0, ms), repeat: true }); return id; },
    clearInterval(id) { timers.delete(id); },
    advance(ms) { runDueUntil(now + ms); },
    dispose() { timers.clear(); },
  };
  return clock;
}

/* ---------- stub DOM ---------- */
function makeElement(id) {
  const el = {
    id, tagName: id, style: {}, dataset: {}, children: [], classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }, toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
    },
    textContent: '', value: '', checked: false, disabled: false, scrollTop: 0, scrollHeight: 0,
    appendChild(x) { el.children.push(x); return x; },
    removeChild(x) { el.children = el.children.filter(c => c !== x); },
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, removeAttribute() {}, focus() {}, click() {}, getBoundingClientRect() {
      return { width: 2400, height: 1560, top: 0, left: 0, right: 2400, bottom: 1560 };
    },
    contains() { return false; }, querySelector() { return makeElement('q'); }, querySelectorAll() { return []; },
    closest() { return null; },
  };
  let inner = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return inner; },
    set(v) { inner = String(v); el.children = []; },
  });
  /* Event handlers are assigned as plain properties; record assignments. */
  for (const h of ['onclick', 'oninput', 'onchange', 'onkeydown', 'onsubmit']) {
    let assigned = false;
    Object.defineProperty(el, '__assigned_' + h, { get: () => assigned, configurable: true });
    Object.defineProperty(el, h, {
      get() { return el['_' + h]; },
      set(v) { assigned = v !== undefined && v !== null; el['_' + h] = v; },
      configurable: true,
    });
  }
  return el;
}

/* ---------- fake connections ---------- */
export function makeConn(engine, playerId, opts = {}) {
  const clock = engine.clock;
  const f = engine.f;
  const c = {
    __playerId: playerId, __bigconClosed: false, open: opts.open !== false,
    answers: opts.answers || null,        // scripted auto-answer queue for guest prompts
    autoAnswer: opts.autoAnswer !== false && !!f.onHostData,
    sent: [],
    send(m) {
      if (!c.open) return;
      const copy = typeof m === 'object' && m !== null ? JSON.parse(JSON.stringify(m)) : m;
      c.sent.push(copy);
      if (m && m.t === 'ping') { /* guests answer pings through the wire themselves */ }
      if (m && m.t === 'event' && c.open) {
        /* The host registers the ack watcher only after its own modal await, so
           an instant ack can beat the registration. A well-behaved client
           retries until the host is listening (capped to avoid runaway). */
        let tries = 0;
        const ack = () => {
          const N = engine.acc.Net;
          if (!c.open || !f.onHostData || tries++ > 250) return;
          if (!(N.acks && N.acks.eid === m.eid)) { engine.clock.setTimeout(ack, 2); return; }
          f.onHostData(c, { t: 'ack', eid: m.eid });
        };
        engine.clock.setTimeout(ack, 1);
      }
      if (m && m.t === 'prompt' && c.autoAnswer && c.open) {
        clock.setTimeout(() => {
          if (!c.open || !f.onHostData) return;
          const v = c.answers && c.answers.length ? c.answers.shift() : (m.options && m.options[0] ? m.options[0].v : 0);
          f.onHostData(c, { t: 'answer', pid: m.pid, v });
        }, 1);
      }
    },
    close() { c.open = false; },
  };
  return c;
}

/* ---------- engine loader ---------- */
globalThis.__BIGCON_ENVS = globalThis.__BIGCON_ENVS || {};
let genSeq = 0;
const GAME_MODULE_NAMES = ['hooks', 'util', 'data', 'state', 'boards', 'engine', 'core', 'net', 'ui', 'app'];
/* Names the old tests reach through `engine.acc` (live reads of module state). */
const ACC_NAMES = [
  'S', 'Net', 'NODES', 'NMAP', 'EDGES', 'ADJ', 'CLEAN_EDGES', 'BASE_EDGES', 'BASE_NODES', 'GEO_NODES', 'GEO_EDGES', 'GEO_NODE_IDS',
  'GEO_HIGH_VALUE_IDS', 'GEO_NK_IDS', 'PROJ_PAUSE_MS', 'OIL_IDS', 'WORLD_EDGES', 'WORLD_GEO', 'REMOVED_NODE_IDS', 'ORIGINAL_LAYOUT_BY_ID',
  'CARDS', 'CARDBYID', 'MOODS', 'CHARS', 'BUZZWORDS', 'INDUSTRIES', 'INDBYID', 'ACCC_RULING', 'WIN_TYPES', 'QUIK_SLOTS', 'QUIK_HOME', 'HIGH_VALUE_NODE_IDS', 'PCOLORS',
  'TYPE_COLORS', 'MAXPLAYERS', 'GOAL_MIN', 'GOAL_MAX', 'GOAL_DEF', 'COUNTRY',
];
/* …and through `engine.f` (functions). */
const F_NAMES = [
  'applyIntent','startTurn','endOfTurn','nextTurn','winCheck','initGame','income','addCortisol','raid','madePay',
  'cs','cardText','cardFace','acccReview','acccAdvance','acccRule','acccReconcile','industryTrigger','industryAllowed','findFile','filesOf','fileForNode','concentratedIndustries','ownedInIndustry','industryNodes','generateRandomBoard','generateRingworldBoard','generateMegaRingBoard','megaRingMetrics','ringworldMetrics','boardViewBounds','resetBoardView','rebuildAdj',
  'separateNodes','applyQuikSlot','nodeBox','pubState','adoptState','mergeTail','sendLogParts','adoptLogPart','flushState','sendAll','sendTo',
  'sysTo','askPlayer','announceAll','revealAll','drawCard','handleHello','onHostClose','onHostData','broadcastLobby','setGeoUI',
  'addLobbyChat','addChat','applyChar','lobbyPlayers','clampGoal','matchBuzzword','codeSlug','codeLabel','genCode',
  'shuffle','esc','showRules','setMood','giveIntel','gain','payVoid','payTo','payFee','log','fxAt','fx','pname',
  'doMove','doFly','doBug','doSpin','doSeize','endMovement','maybePeek','seizeListPrice','flatSeize','takeoverCost','priceTip',
  'canReach','qantasGrounded','qantasGroundedReason','abilityPhase','finishNodeAbility','startHostHeartbeat','sync','setNetStatus','toast',
  'rebuildWorld','strikeNode','canMissileNode','blockaded','projFx','projRig','canUseBackroomAbility',
];

export async function loadEngine() {
  const gen = ++genSeq;
  const clock = makeClock();
  const consoleOut = { log: [], warn: [], error: [] };
  const elems = new Map();
  const elem = id => { if (!elems.has(id)) elems.set(id, makeElement(id)); return elems.get(id); };

  const documentStub = {
    getElementById: elem,
    querySelector: () => elem('sel'),
    querySelectorAll: () => [],
    createElement: tag => elem('el:' + tag + ':' + (elems.size + 1)),
    createElementNS: (ns, tag) => elem('el:' + tag + ':' + (elems.size + 1)),
    addEventListener() {}, removeEventListener() {},
    body: elem('body'), documentElement: elem('html'), activeElement: null,
  };
  const modalRec = [];
  const activeHolds = [];
  const modalQueue = [];
  /* A queue entry is either a plain resolved value, a hold request object
     {__hold:true} whose promise pends until released, or nothing (fall back to
     the modal's own default). */
  const modalStub = o => {
    modalRec.push({ title: o.title, html: o.html || '', body: o.body || '', options: o.options });
    if (modalQueue.length) {
      const v = modalQueue.shift();
      if (v && typeof v === 'object' && v.__hold) {
        return new Promise(res => { v.res = res; activeHolds.push(v); });
      }
      return Promise.resolve(v);
    }
    const def = o.def !== undefined ? o.def : (o.options && o.options[0] ? o.options[0].v : 0);
    return Promise.resolve(def);
  };
  const locationStub = { reloadCount: 0, reload() { this.reloadCount++; }, search: '', hostname: 'localhost' };
  const store = new Map();
  const sessionStore = new Map();
  let uuidSeq = 0;
  const env = {
    console: {
      log: (...a) => consoleOut.log.push(a.join(' ')),
      warn: (...a) => consoleOut.warn.push(a.join(' ')),
      error: (...a) => consoleOut.error.push(a.join(' ')),
    },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    requestAnimationFrame: () => 0,
    document: documentStub,
    window: { addEventListener() {}, removeEventListener() {}, focus() {}, open() { return null; } },
    location: locationStub,
    navigator: { clipboard: { writeText: async () => {} } },
    crypto: { randomUUID: () => 'pc-' + ++uuidSeq, getRandomValues: a => a },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    sessionStorage: {
      getItem: k => (sessionStore.has(k) ? sessionStore.get(k) : null),
      setItem: (k, v) => sessionStore.set(k, String(v)),
      removeItem: k => sessionStore.delete(k),
    },
    Notification: undefined, Peer: undefined, WebSocket: undefined,
    BUILD_COMMIT: BUILD_COMMIT_VALUE,
  };
  for (const n of ENV_NAMES) if (!(n in env)) throw new Error('harness env is missing ' + n);
  globalThis.__BIGCON_ENVS[gen] = env;

  /* One private copy of the game, loaded the way the browser does: the entry's
     static imports pull in the graph. app.js is the composition root. */
  const importMod = rel => import(pathToFileURL(path.join(repoRoot, rel)).href + '?gen=' + gen);
  const mods = {};
  mods.app = await importMod('static/js/app.js');
  for (const n of GAME_MODULE_NAMES) mods[n] = await importMod('static/js/' + n + '.js');
  const modList = [mods.engine, mods.state, mods.data, mods.boards, mods.net, mods.ui, mods.core, mods.util, mods.hooks, mods.app];
  const owner = n => modList.find(m => n in m);
  /* The same wiring the page does (app.js), then the test doubles on top: the
     DOM modal is replaced by the recorder and timers run on the virtual clock. */
  mods.app.installHooks();
  mods.hooks.setHooks({ modal: modalStub, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  mods.app.boot();

  const setters = { S: v => mods.state.setS(v), EDGES: v => mods.data.setEdges(v), NODES: v => mods.data.setNodes(v) };
  const acc = {};
  for (const n of ACC_NAMES) {
    if (!owner(n)) throw new Error('harness: no module exports ' + n);
    Object.defineProperty(acc, n, { get: () => owner(n)[n], set: setters[n], enumerable: true });
  }
  const f = {};
  for (const n of F_NAMES) {
    const m = owner(n);
    if (!m) throw new Error('harness: no module exports ' + n);
    f[n] = m[n];
  }
  /* `ctx` mimics the old vm global: any exported name, plus the stub browser objects. */
  const extras = {};
  const ctx = new Proxy(extras, {
    get(t, n) {
      if (typeof n === 'symbol') return undefined;
      if (n in t) return t[n];
      if (n in env) return env[n];
      const m = owner(n);
      return m ? m[n] : undefined;
    },
    set(t, n, v) { t[n] = v; return true; },
    has(t, n) { return n in t || n in env || !!owner(n); },
  });

  const engine = {
    gen, ctx, acc, f, clock, consoleOut, modalRec, elems, location: locationStub, store, env, mods,
    hooks: mods.hooks.hooks,
    get modalQueue() { return modalQueue; },
    queueModal(v) { modalQueue.push(v); },
    /* Keep the NEXT host modal pending until releaseModal supplies the answer. */
    holdModal() { modalQueue.push({ __hold: true }); },
    releaseModal(v) {
      const i = activeHolds.findIndex(h => h.res);
      if (i >= 0) { const h = activeHolds.splice(i, 1)[0]; h.res(v); }
    },
    activeHolds,
    /* Load the bot policy module into this engine, the way main.js does. Set
       env.window.__BIGCON_TEST__ / __BIGCON_BOT_SEED__ BEFORE calling it. */
    async loadBots() {
      const bots = await importMod('static/bots.js');
      mods.hooks.setHooks({ bots: () => bots.BigConBots });
      env.window.BigConBots = bots.BigConBots; /* what main.js does for devtools */
      mods.bots = bots;
      return bots.BigConBots;
    },
    dispose() { clock.dispose(); activeHolds.length = 0; delete globalThis.__BIGCON_ENVS[gen]; },
  };
  return engine;
}

/* ---------- shared fixtures ---------- */
export const CHARS8 = ['markwatson','tomkins','jimchalmers','bessock','calvinathanasius','denialswan','japsnchen','thousandyardwax'];

export function pump(n = 4) { // let pending microtasks (promises) settle
  return new Promise(r => { let i = 0; (function loop() { i++ < n ? setImmediate(loop) : r(); })(); });
}

export function snapshot(engine) {
  const S = engine.acc.S;
  return {
    players: JSON.parse(JSON.stringify(S.players)), owner: { ...S.owner }, bugs: { ...S.bugs },
    cur: S.cur, turn: S.turn, phase: S.phase, steps: S.steps, mode: S.mode, mood: S.mood,
    over: S.over, deckCount: S.deck.length, logN: S.logN, chatN: S.chatN, chatLen: S.chat.length,
    logLen: S.log.length, seized: { ...S.seizeCount }, sisyPayout: S.sisyPayout, goal: S.goal,
  };
}

/*
 * Boots a host-authoritative game with N seats. Seat 0 is the host; seats 1..N-1
 * are guests backed by fake connections (auto-acking announcements; scripted
 * answers when `answers` is provided).
 */
export async function makeGame(engine, playerCount = 2, opts = {}) {
  const chars = CHARS8.concat(CHARS8);
  const Net = engine.acc.Net;
  Net.role = 'host';
  Net.myIdx = 0;
  Net.goal = opts.goal ?? 100;
  Net.dlcGeo = !!opts.geo;
  Net.started = false;
  Net.begun = true;
  Net.started = false;
  Net.lobbyChat = [];
  Net.roster = [];
  Net.conns = [];
  const canonical = [];
  for (let i = 0; i < playerCount; i++) {
    const isBot = !!(opts.bots && opts.bots.indexOf(i) >= 0);
    const conn = (i === 0 || isBot) ? null : makeConn(engine, 'pid' + i, opts);
    canonical.push({ name: opts.names?.[i] || ('Player ' + (i + 1)), playerId: 'pid' + i, conn, char: chars[i], bot: isBot });
  }
  /* initGame shuffles the seating order. Flow tests drive the host as seat 0,
     so retry seeds until the shuffle seats the host first. Everything is
     deterministic, so the retries always produce the same game. */
  for (const seed of opts.seeds || Array.from({ length: 220 }, (_, i) => 40 + i)) {
    Net.roster = canonical.map(e => ({ ...e }));
    Net.conns = canonical.map(e => e.conn);
    withSeed(seed, () => engine.f.initGame(canonical.map(e => ({ name: e.name, char: e.char, bot: !!e.bot }))));
    await pump();
    if (Net.myIdx === 0) return engine.acc.S;
    /* Seat shuffle misfired for this seed: forget its traffic and try again. */
    canonical.forEach(e => { if (e.conn) e.conn.sent = []; });
  }
  throw new Error('no seed seated the host first — extend the attempt list');
}

/* Handcrafted state for pure-rule fixtures (CR / EC suites). */
export function makeState(engine, over = {}) {
  const nP = over.players ? over.players.length : 2;
  const defaults = i => ({
    name: 'P' + i, color: engine.acc.PCOLORS[i % 8], char: null,
    money: 0, intel: 0, cortisol: 0, raided: 0, pos: 'quik', dc: false,
  });
  const s = {
    backroomAbilityUsed: false,
    players: over.players
      ? over.players.map((p, i) => ({ ...defaults(i), ...p }))
      : Array.from({ length: nP }, (_, i) => defaults(i)),
    cur: 0, turn: 1, phase: 'move', steps: 3, goal: 100, owner: {}, bugs: {}, seizeCount: {},
    sisyPayout: 10, deck: ['quiet'], discard: [], spun: false, audited: false, cooked: false,
    budgeted: false, extraStep: false, slipped: false, caution: false, dossier: false, jtUsed: false,
    spinKind: 'press', mood: 'CALM', wire: 'all quiet on the wire… for now', fx: [], over: false, mode: null,
    log: [], chat: [], logN: 0, chatN: 0, quikSlot: 0, boardLayout: null, boardEdges: null, auditedOnce: false,
    dlcGeo: false, rubble: {}, ov: null, geoMissiled: false, geoBeach: false, geoBoeing: false,
    geoCrash: false, geoStage5: false, geoVenice: false, blockades: {}, blockadeUsed: false,
    missileProbe: null, qantasGroundUntil: 0, decline: null, acccFiles: [], lobbied: false, referred: false,
  };
  /* Overriding defaults is merged always, so fixture authors only set what they care about. */
  for (const [k, v] of Object.entries(over)) if (k !== 'players') s[k] = v;
  return s;
}

/* Deterministic RNG (mulberry32); install on Math.random and restore after. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return rng;
}

export function withSeed(seed, fn) {
  const real = Math.random.bind(Math);
  Math.random = makeRng(seed);
  try { return fn(); } finally { Math.random = real; }
}

export async function withSeedAsync(seed, fn) {
  const real = Math.random.bind(Math);
  Math.random = makeRng(seed);
  try { return await fn(); } finally { Math.random = real; }
}

/* Deterministic sequence RNG: values are consumed in order (looping). Handy for
   controlling probability gates like the MADE payout roll. */
export function withRandomSeq(values, fn) {
  const real = Math.random.bind(Math);
  let i = 0;
  Math.random = () => values[i++ % values.length];
  try { return fn(); } finally { Math.random = real; }
}

/* BFS over the live adjacency graph. */
export function bfs(adj, root) {
  const dist = new Map([[root, 0]]);
  const q = [root];
  while (q.length) {
    const v = q.shift();
    for (const w of adj[v] || []) if (!dist.has(w)) { dist.set(w, dist.get(v) + 1); q.push(w); }
  }
  return dist;
}

export function mesgsFor(engine, conn, type) {
  return conn.sent.filter(m => m.t === type);
}
