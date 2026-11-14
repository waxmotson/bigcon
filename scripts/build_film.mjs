/* Plays the scripted game in scripts/film_script.mjs through the REAL rules engine
   (static/js/engine.js) on the 3D board's layout, and records it as
   static/landing/match.js for film.html to replay.

     node scripts/build_film.mjs            write static/landing/match.js
     node scripts/build_film.mjs --check    play it, print the table, write nothing
     node scripts/build_film.mjs --out=F    write the recording to F instead
     node scripts/build_film.mjs --table    also print one line per turn
     node scripts/build_film.mjs --trace    also print the engine's record as it goes

   Nothing is simulated here: every number in the film is what the engine produced. The
   script only chooses what each seat does, which event card is on top of the deck, and
   (where the rules roll dice) what the dice say. Every intent must visibly do something,
   or the build fails with the engine's own refusal message. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../static/js/engine.js';
import * as St from '../static/js/state.js';
import * as D from '../static/js/data.js';
import { applyLayoutFromState } from '../static/js/boards.js';
import { buildLayout } from '../static/landing/layout.js';
import { GOAL, SEATS, TURNS } from './film_script.mjs';

const args = new Set(process.argv.slice(2));
const TRACE = args.has('--trace');
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

/* ---------- the dice: 0.999 unless the script queued something ---------- */
const dice = [];
Math.random = () => (dice.length ? dice.shift() : 0.999);

/* ---------- hooks: answers come from the script, timers fire at once ---------- */
let answers = {}, prompts = [], refusals = [];
E.setHooks({
  sync() {},
  sysTo(pi, msg) { if (!/YOUR TURN/.test(msg)) refusals.push(msg); },
  askPlayer: async (pi, opt) => {
    let v = opt.def;
    for (const k of Object.keys(answers)) if (opt.title.includes(k)) { v = typeof answers[k] === 'function' ? answers[k](opt) : answers[k]; break; }
    prompts.push({ t: opt.title, p: pi, v, card: opt.meta && opt.meta.card || undefined });
    return v;
  },
  announceAll() {}, revealAll: async () => {}, beginGame() {}, showGame() {}, gameOver() {},
  bots: () => null,
  setTimeout(fn, ms) { if (ms < 5000) setImmediate(fn); return 0; }   // flights land at once; watchdogs never fire, clearTimeout() {},
});

/* ---------- deal the game on the film's board ---------- */
const layout = buildLayout();
St.Net.role = 'host'; St.Net.dlcGeo = true; St.Net.goal = GOAL; St.Net.boardLayout = 'random'; St.Net.conns = []; St.Net.fogOfWar = false;
E.initGame(SEATS.map(s => ({ name: s.name, char: s.char })));
await settle();
const S = St.S;
S.quikSlot = 0;
S.boardLayout = layout.pts.map(p => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), rot: p.rot }));
S.boardEdges = layout.edges.map(e => e.slice());
applyLayoutFromState();
/* the deck, top card last: each turn's event in order (a buried card sits above the
   event that then lands; a cancelled event is still drawn from the script's point of view) */
const order = [];
for (const t of TURNS) { if (t.bury) order.push(t.bury); if (t.ev) order.push(t.ev); }
order.forEach(id => { if (!E.CARDBYID[id]) throw new Error('unknown event card: ' + id); });
S.deck = order.slice().reverse(); S.discard = [];

/* ---------- recording ---------- */
const nodeAt = (x, y) => { let best = null, bd = 1e9; for (const n of D.NODES) { const d = Math.abs(n.x - x) * 4 + Math.abs(n.y - 66 - y); if (d < bd) { bd = d; best = n.id; } } return bd < 60 ? best : null; };
const snap = () => ({
  pl: S.players.map(p => [p.money, p.intel, p.cortisol, p.pos, p.raided ? 1 : 0]),
  own: { ...S.owner }, rub: Object.keys(S.rubble || {}).filter(k => S.rubble[k]).sort(), bugs: { ...S.bugs },
  blk: Object.keys(S.blockades || {}).filter(k => S.blockades[k] > S.turn).sort(),
  mood: S.mood, files: E.acccFileList().map(f => [f.pi, f.ind, f.s, f.agency]),
  qg: E.qantasGrounded() ? 1 : 0, sisy: S.sisyPayout || 10, turn: S.turn, cur: S.cur, phase: S.phase, steps: S.steps,
  ov: S.ov ? [S.ov.nid, S.ov.by] : null, dec: S.decline == null ? null : S.decline, jt: S.jtUsed ? 1 : 0, wire: S.wire,
});
const BOUNDS = [
  [/^—— TURN/, 'turn'], [/^🎴 EVENT — /, 'event'], [/^🌐 JTPortal: “Quite frankly/, 'jtcancel'], [/^🚨 REGULATOR RAID!/, 'raid'],
  [/MADE pays out — nobody knows why/, 'made'], [/The ruling is in\.$/, 'ruling'], [/closes the investigation opened after/, 'probe'], [/^🏆 /, 'win'],
  [/^📈 .*(buries the story|peeks at tomorrow)/, 'peek'], [/^🌐 JTPortal briefs/, 'brief'],
];
const beats = [];
let cur = null, lastSnap = snap(), fxSeen = 0;
const takeFx = () => { const out = []; for (const f of S.fx) { if (f.id <= fxSeen) continue; fxSeen = f.id; if (f.proj) continue; out.push([nodeAt(f.x, f.y), f.t, f.c, f.b ? 1 : 0]); } return out; };
/* a prompt answered just before the line that reports it (a peek, a cancelled event) belongs to the beat that line opens */
const carry = [];
const close = s => {
  if (!cur) return; cur.fx.push(...takeFx()); cur.s = s;
  const all = prompts.splice(0), mine = all.filter(q => !/PEEK|INTERVENES/.test(q.t));
  carry.push(...all.filter(q => /PEEK|INTERVENES/.test(q.t)));
  if (mine.length) cur.q = (cur.q || []).concat(mine);
  beats.push(cur); cur = null;
};
const open = (k, extra) => { cur = Object.assign({ k, lines: [], fx: [] }, extra); if (carry.length) cur.q = carry.splice(0); };
S.log.push = function (line) {
  const text = String(line);
  const b = BOUNDS.find(([re]) => re.test(text));
  if (b) {
    const prev = cur; close(lastSnap);
    const x = {};
    if (b[1] === 'turn') x.p = S.cur;
    if (b[1] === 'event') x.card = E.CARDS.find(c => text.endsWith(c.title)).id;
    if (b[1] === 'raid' || b[1] === 'made' || b[1] === 'ruling' || b[1] === 'probe' || b[1] === 'win') x.p = S.players.findIndex(p => text.includes(p.name));
    if (b[1] === 'made') x.p = S.owner.made;
    if (b[1] === 'ruling' || b[1] === 'peek' || b[1] === 'brief') x.p = S.cur;
    open(b[1], x); void prev;
  } else if (!cur) open('misc');
  cur.lines.push(text);
  if (TRACE) console.log('   ' + text);
  const r = Array.prototype.push.call(this, line);
  lastSnap = snap();
  return r;
};
/* the opening turn started inside initGame, before the recorder was attached */
beats.push({ k: 'turn', p: 0, lines: S.log.slice(-1), fx: takeFx().map(f => ['quik', f[1], f[2], f[3]]), s: snap() });

/* ---------- running the script ---------- */
const ctx = { S, D, E, adj: layout.adj };
const STAY = { k: 'endmove', m: () => [{ act: 'endmove' }] };
async function intent(pi, m) {
  refusals = [];
  const before = JSON.stringify([snap(), S.mode, S.log.length, S.dossier, S.extraStep, S.slipped]);
  await E.applyIntent(pi, m); await settle();
  if (refusals.length) throw new Error('refused: ' + refusals.join(' | '));
  if (JSON.stringify([snap(), S.mode, S.log.length, S.dossier, S.extraStep, S.slipped]) === before) throw new Error('did nothing');
}
let ti = 0;
try {
  for (const t of TURNS) {
    ti++;
    if (S.over) throw new Error('the game ended before turn ' + ti);
    if (S.cur !== t.p) throw new Error('turn ' + ti + ' is scripted for seat ' + t.p + ' but it is seat ' + S.cur + '’s turn');
    if (TRACE) console.log('\n== ' + ti + ' · round ' + S.turn + ' · ' + SEATS[t.p].name + ' · $' + S.players[t.p].money + ' ' + S.players[t.p].intel + 'i ' + S.players[t.p].cortisol + 'c @' + S.players[t.p].pos + ' steps ' + S.steps);
    const turnNo = S.turn, seat = S.cur;
    if (t.dice) dice.push(...t.dice);       // consumed in the order the rules roll them
    var queue = t.do.flat(9);
    for (let i = 0; i < queue.length; i++) {
      let step = queue[i];
      if (typeof step === 'function') { queue.splice(i, 1, ...[step(ctx)].flat(9)); i--; continue; }   // e.g. go(): the route is found when it is walked
      if (step.ph === 'action' && S.phase === 'move') { queue.splice(i, 0, STAY); i--; continue; }
      answers = { ...(t.ans || {}), ...(step.ans || {}) };
      close(snap());
      const me = S.players[t.p], ms = step.m(ctx), last = ms[ms.length - 1];
      open(step.k, { p: t.p, from: me.pos });
      for (const k of ['id', 'target', 'n', 'choice']) if (k in last) cur[k] = last[k];
      if (last.kind) cur.kd = last.kind;
      if (step.mid) cur.mid = 1;
      if (step.tgt != null) cur.target = step.tgt;
      if (last.act === 'seize') { cur.id = me.pos; if (S.owner[me.pos] != null) { cur.k = 'takeover'; cur.prev = S.owner[me.pos]; } }
      if (last.act === 'missile') cur.launcher = S.owner.geo_missile === t.p ? 'geo_missile' : 'geo_shahed';
      if (last.act === 'rebuild' || last.act === 'push' || last.act === 'jog') cur.id = me.pos;
      for (const m of ms) {
        try { await intent(t.p, m); } catch (e) { throw new Error('turn ' + ti + ' (' + SEATS[t.p].name + ', round ' + turnNo + ') step ' + (i + 1) + ' ' + step.k + ' ' + JSON.stringify(m) + ': ' + e.message + ' — state: $' + me.money + ' ' + me.intel + 'i ' + me.cortisol + 'c @' + me.pos + ' phase ' + S.phase + ' steps ' + S.steps + ' mode ' + S.mode); }
      }
    }
    close(snap());
    dice.length = 0;
    if (!S.over && S.cur === seat && S.turn === turnNo) throw new Error('turn ' + ti + ' (' + SEATS[t.p].name + ') never ended — phase ' + S.phase + ', steps ' + S.steps);
    if (t.check) t.check(ctx);
    if (args.has('--table')) console.log(String(ti).padStart(3) + ' r' + String(turnNo).padEnd(3) + SEATS[t.p].name.slice(0, 4) + ' ' + queue.map(q => q.k).filter(k => k !== 'move' && k !== 'endmove').join(',').padEnd(22) + (t.ev || '—').padEnd(11) + S.players.map((p, i) => SEATS[i].name[0] + ' $' + String(p.money).padEnd(4) + String(p.intel).padStart(2) + 'i ' + p.cortisol + 'c ' + p.pos.replace('geo_', '').slice(0, 7).padEnd(7)).join(' | ') + (E.acccFileList().length ? '  files ' + E.acccFileList().map(f => SEATS[f.pi].name[0] + ':' + f.ind + ':' + f.s).join(' ') : ''));
  }
} catch (e) {
  console.error('\n✗ ' + e.message + '\n');
  printTable();
  process.exit(1);
}
close(snap());
if (!S.over && !args.has('--partial')) { console.error('✗ the script ran out and nobody has won'); printTable(); process.exit(1); }
/* a real deck never repeats a card before it is reshuffled */
{ const drawn = TURNS.map(t => t.ev).filter(Boolean); for (let i = 0; i < drawn.length; i += 24) { const blk = drawn.slice(i, i + 24); const dup = blk.find((c, j) => blk.indexOf(c) !== j); if (dup) { console.error('✗ event card ' + dup + ' is drawn twice in deck cycle ' + (i / 24 + 1)); process.exit(1); } } }

function printTable() {
  console.log('round ' + S.turn + ' · mood ' + S.mood + ' · files ' + JSON.stringify(E.acccFileList()));
  S.players.forEach((p, i) => console.log(' ' + SEATS[i].name.padEnd(14) + ('$' + p.money).padEnd(6) + (p.intel + 'i').padEnd(5) + (p.cortisol + 'c').padEnd(4) + '@' + p.pos.padEnd(12) + D.NODES.filter(n => S.owner[n.id] === i).map(n => n.id).join(' ') + '  | missing ' + E.missingTypes(i).join(',')));
}

/* ---------- write it out: each beat stores only what changed since the one before ---------- */
const kinds = {}; beats.forEach(b => { kinds[b.k] = (kinds[b.k] || 0) + 1; });
let prevS = {};
const packed = beats.map(b => {
  const d = {};
  for (const k of Object.keys(b.s)) if (JSON.stringify(b.s[k]) !== JSON.stringify(prevS[k])) d[k] = b.s[k];
  prevS = b.s;
  const o = { k: b.k };
  for (const k of Object.keys(b)) if (k !== 'k' && k !== 's' && !(Array.isArray(b[k]) && !b[k].length)) o[k] = b[k];
  o.s = d;
  return o;
});
const out = '/* GENERATED by scripts/build_film.mjs from scripts/film_script.mjs — do not edit.\n   One real game, played through the rules engine on the 3D board. */\nexport const MATCH = ' +
  JSON.stringify({ goal: S.goal, seats: SEATS, cards: Object.fromEntries([...new Set(order)].map(id => [id, { icon: E.CARDBYID[id].icon, title: E.CARDBYID[id].title, text: E.cardText(E.CARDBYID[id]) }])), winner: S.players.findIndex((p, i) => p.money >= S.goal && !E.missingTypes(i).length), beats: packed }) + ';\n';
printTable();
console.log(beats.length + ' beats · ' + TURNS.length + ' turns · ' + S.turn + ' rounds · ' + Math.round(out.length / 1024) + ' KB');
console.log(Object.entries(kinds).sort().map(([k, n]) => k + '×' + n).join(' '));
const outArg = process.argv.slice(2).find(a => a.startsWith('--out='));
if (!args.has('--check')) fs.writeFileSync(outArg ? outArg.slice(6) : fileURLToPath(new URL('../static/landing/match.js', import.meta.url)), out);
