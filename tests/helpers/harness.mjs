/*
 * Dependency-free test harness for THE BIG CON.
 *
 * Loads the real game script (the inline <script> block of index.html) into a
 * fresh `node:vm` context with:
 *   - a virtual clock (setTimeout/setInterval are recorded and advanced by
 *     tests, so prompt timeouts, lock watchdogs and heartbeats are deterministic
 *     and can never hang the suite),
 *   - a stub DOM (element stubs record settable state; heavy SVG rendering is
 *     never scheduled because requestAnimationFrame is stubbed out),
 *   - fake PeerJS-style connections that record every outgoing message and can
 *     auto-answer private prompts or auto-ack event announcements.
 *
 * Nothing here is reachable from a normal client: this file only runs under the
 * Node test runner. It adds no test hooks to production code.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

/* ---------- inline script extraction ---------- */
function inlineScript() {
  const anchor = html.indexOf("'use strict';");
  if (anchor === -1) throw new Error('could not locate the game script anchor');
  const start = html.lastIndexOf('<script>', anchor);
  const end = html.indexOf('</script>', anchor);
  if (start === -1 || end === -1) throw new Error('could not locate the inline game script');
  return html.slice(start + '<script>'.length, end);
}
export const HTML = html;
export const SOURCE = inlineScript();

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
export function loadEngine(opts = {}) {
  const clock = makeClock();
  const consoleOut = { log: [], warn: [], error: [] };
  const elems = new Map();
  const elem = id => { if (!elems.has(id)) elems.set(id, makeElement(id)); return elems.get(id); };

  const documentStub = {
    getElementById: elem,
    querySelector: () => elem('sel'),
    querySelectorAll: () => [],
    createElement: tag => elem('el:' + tag + ':' + (elems.size + 1)),
    addEventListener() {}, removeEventListener() {},
    body: elem('body'), documentElement: elem('html'), activeElement: null,
  };
  const modalRec = [];
  const activeHolds = [];
  let modalQueue = [];
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
  const locationStub = { reloadCount: 0, reload() { this.reloadCount++; } };
  const store = new Map();
  let uuidSeq = 0;
  const ctx = {
    console: {
      log: (...a) => consoleOut.log.push(a.join(' ')),
      warn: (...a) => consoleOut.warn.push(a.join(' ')),
      error: (...a) => consoleOut.error.push(a.join(' ')),
    },
    Math, Date, JSON,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    requestAnimationFrame: () => 0,
    document: documentStub, window: { addEventListener() {}, removeEventListener() {} }, location: locationStub,
    navigator: { clipboard: { writeText: async () => {} } },
    crypto: { randomUUID: () => 'pc-' + ++uuidSeq },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    __modalStub: modalStub, __broadcast: [],
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: 'index.html:inline' });
  const acc = vm.runInContext(`globalThis.__t = {
    get S(){return S}, set S(v){S=v},
    get Net(){return Net}, get NODES(){return NODES}, get NMAP(){return NMAP},
    get EDGES(){return EDGES}, set EDGES(v){EDGES=v}, get ADJ(){return ADJ},
    get CLEAN_EDGES(){return CLEAN_EDGES}, get BASE_EDGES(){return BASE_EDGES},
    get BASE_NODES(){return BASE_NODES}, set NODES(v){NODES=v},
    get GEO_NODES(){return GEO_NODES}, get GEO_EDGES(){return GEO_EDGES},
    get GEO_NODE_IDS(){return GEO_NODE_IDS}, get GEO_HIGH_VALUE_IDS(){return GEO_HIGH_VALUE_IDS},
    get GEO_NK_IDS(){return GEO_NK_IDS},
    get PROJ_PAUSE_MS(){return PROJ_PAUSE_MS},
    get OIL_IDS(){return OIL_IDS}, get WORLD_EDGES(){return WORLD_EDGES},
    get WORLD_GEO(){return WORLD_GEO},
    get REMOVED_NODE_IDS(){return REMOVED_NODE_IDS}, get ORIGINAL_LAYOUT_BY_ID(){return ORIGINAL_LAYOUT_BY_ID},
    get CARDS(){return CARDS}, get CARDBYID(){return CARDBYID}, get MOODS(){return MOODS},
    get CHARS(){return CHARS}, get BUZZWORDS(){return BUZZWORDS}, get INDUSTRIES(){return INDUSTRIES},
    get WIN_TYPES(){return WIN_TYPES}, get QUIK_SLOTS(){return QUIK_SLOTS}, get QUIK_HOME(){return QUIK_HOME},
    get HIGH_VALUE_NODE_IDS(){return HIGH_VALUE_NODE_IDS}, get PCOLORS(){return PCOLORS},
    get TYPE_COLORS(){return TYPE_COLORS}, get MAXPLAYERS(){return MAXPLAYERS},
    get GOAL_MIN(){return GOAL_MIN}, get GOAL_MAX(){return GOAL_MAX}, get GOAL_DEF(){return GOAL_DEF},
    get COUNTRY(){return COUNTRY},
  }; globalThis.__t`, ctx, { filename: 'harness-accessor' });
  /* Replace the DOM modal (which demands a real browser) with the recorder. */
  vm.runInContext('modal = __modalStub;', ctx, { filename: 'harness-rebind' });

  const engine = {
    ctx, acc, clock, consoleOut, modalRec, elems, location: locationStub, store,
    get modalQueue() { return modalQueue; },
    queueModal(v) { modalQueue.push(v); },
    /* Keep the NEXT host modal pending until releaseModal supplies the answer. */
    holdModal() { modalQueue.push({ __hold: true }); },
    releaseModal(v) {
      const i = activeHolds.findIndex(h => h.res);
      if (i >= 0) { const h = activeHolds.splice(i, 1)[0]; h.res(v); }
    },
    activeHolds,
    dispose() { clock.dispose(); activeHolds.length = 0; },
    f: {},
  };
  /* Function declarations become global properties of the vm realm. */
  const fns = [
    'applyIntent','startTurn','endOfTurn','nextTurn','winCheck','initGame','income','addCortisol','raid','madePay',
    'acccInvestigate','concentratedIndustries','ownedInIndustry','industryNodes','generateRandomBoard','rebuildAdj',
    'separateNodes','applyQuikSlot','nodeBox','pubState','adoptState','mergeTail','flushState','sendAll','sendTo',
    'sysTo','askPlayer','announceAll','revealAll','drawCard','handleHello','onHostClose','onHostData','broadcastLobby','setGeoUI',
    'addLobbyChat','addChat','applyChar','lobbyPlayers','clampGoal','matchBuzzword','codeSlug','codeLabel','genCode',
    'shuffle','esc','showRules','setMood','giveIntel','gain','payVoid','payTo','payFee','log','fxAt','fx','pname',
    'doMove','doFly','doBug','doSpin','doSeize','endMovement','maybePeek','seizeListPrice','flatSeize','takeoverCost',
    'canReach','qantasGrounded','qantasGroundedReason','abilityPhase','finishNodeAbility','startHostHeartbeat','sync','setNetStatus','toast',
    'rebuildWorld','strikeNode','canMissileNode','blockaded','projFx','projRig','canUseBackroomAbility',
  ];
  for (const n of fns) engine.f[n] = ctx[n];
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
    const conn = i === 0 ? null : makeConn(engine, 'pid' + i, opts);
    canonical.push({ name: opts.names?.[i] || ('Player ' + (i + 1)), playerId: 'pid' + i, conn, char: chars[i] });
  }
  /* initGame shuffles the seating order. Flow tests drive the host as seat 0,
     so retry seeds until the shuffle seats the host first. Everything is
     deterministic, so the retries always produce the same game. */
  for (const seed of opts.seeds || Array.from({ length: 220 }, (_, i) => 40 + i)) {
    Net.roster = canonical.map(e => ({ ...e }));
    Net.conns = canonical.map(e => e.conn);
    withSeed(seed, () => engine.f.initGame(canonical.map(e => ({ name: e.name, char: e.char }))));
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
    missileProbe: null, qantasGroundUntil: 0, decline: null,
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
   controlling probability gates like the ACCC 1-in-3 check. */
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
