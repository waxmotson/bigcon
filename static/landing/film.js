'use strict';
/* landing/film: entry module for film.html — one whole game, replayed on the 3D board.
   The game itself is data: static/landing/match.js is a recording of the real rules engine
   playing scripts/film_script.mjs (see scripts/build_film.mjs). This module only stages it:
   a timeline of beats, each drawn as a pure function of its local time, so the film can be
   scrubbed, sped up or frozen (`?kind=missile&u=0.6`, `?beat=120`, `?t=95`). */
import * as THREE from 'three';
import { createWorld, sm, lerp, rnd, clamp01 } from './world.js';
import { MATCH } from './match.js';
import { GROUPS, ACTS, chipsOf } from './acts.js';
import { CHARS, MOODS, NMAP, OIL_IDS } from '../js/data.js';

const $ = s => document.querySelector(s);
const qs = new URLSearchParams(location.search);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const up = (p, y) => p.clone().setY(y);
const bell = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin((t - a) / (b - a) * Math.PI));
const PC = CHARS.slice(0, 4).map(c => c.color);
const NAMES = MATCH.seats.map(s => s.name);
const TYPES = ['BANK', 'REGULATOR', 'CHART', 'WILD', 'CORPORATE', 'COMMODITY', 'MEDIA'];
const RED = '#ff6b5e', GOLD = '#f5c542', BLUE = '#55c1ff', GREEN = '#7fe08d', PURPLE = '#e19bff', ORANGE = '#ffa94d', WHITE = '#ffffff';

/* ---------- the timeline ---------- */
const beats = MATCH.beats;
const states = []; { let s = {}; for (const b of beats) { s = Object.assign({}, s, b.s); states.push(s); } }
const before = i => states[Math.max(0, i - 1)];
/* seconds a beat runs at 1×, and when (in seconds) its outcome lands */
const PACE = {
  turn: [0.9, 0.15], move: [0.48, 0.3], favor: [1.3, 0.3], slip: [1.5, 0.3], fly: [2.6, 2.1], seize: [1.9, 0.7], takeover: [2.6, 0.9],
  push: [2.6, 1.5], jog: [1.9, 0.7], spin: [2, 0.7], foxroast: [2.4, 1], cook: [2, 0.7], pressure: [2.6, 0.9], budget: [2.6, 0.9],
  audit: [2.4, 1], tweet: [2.4, 1], leak: [2.4, 1], bug: [2, 0.9], missile: [3.8, 2], rebuild: [2.2, 0.8], beach: [2, 0.7],
  qantasdown: [2.4, 0.8], oilcrash: [2.8, 0.8], stage5: [2.4, 1], venicecool: [2.2, 0.7], overtour: [3.4, 0.6], blockade: [2.6, 1],
  spy: [2.6, 0.3], dossier: [1.6, 0.4], sweep: [2, 0.7], masspanic: [3, 0.9], targetpanic: [3.4, 1.5], divestmade: [2.6, 1],
  bondmageddon: [7, 5.6], marketsell: [2.2, 0.8], lobby: [1.8, 0.5], refer: [2.4, 1], deal: [2.8, 1.2], sell: [1.8, 0.5],
  sellall: [1.9, 0.5], laylow: [1.7, 0.5], event: [2.2, 0.5], jtcancel: [2.6, 0.4], made: [3.2, 1], raid: [5, 2.6], ruling: [3.4, 1.2],
  probe: [2, 0.5], win: [11, 0.3], peek: [2.4, 0.3], brief: [2.2, 0.3],
};
const STAGGER = 0.34;
const HIDE_FX = /^🚨 SEIZED/;
let seenPeek = false, seenBrief = false;
const shown = [], start = [], dur = [], hitAt = [];
let total = 0;
beats.forEach((b, i) => {
  b.chips = chipsOf(b);
  b.fx = (b.fx || []).filter(f => !HIDE_FX.test(f[1]));
  let pace = PACE[b.k];
  if (b.k === 'peek') { if (seenPeek && !b.chips.includes('bury')) pace = null; seenPeek = true; }
  if (b.k === 'brief') { if (seenBrief) pace = null; seenBrief = true; }
  if (!pace) return;
  let [d, h] = pace;
  if (b.chips.includes('reflect')) { d = 6.4; h = 4.6; }
  d = Math.max(d, h + b.fx.length * STAGGER + 1.1);
  shown.push(i); start.push(total); dur.push(d); hitAt.push(h); total += d;
});
const find = T => { let lo = 0, hi = shown.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (start[m] <= T) lo = m; else hi = m - 1; } return lo; };
/* rounds, for the bar at the bottom */
const rounds = [];
shown.forEach((i, j) => { const r = states[i].turn; if (!rounds[r - 1]) rounds[r - 1] = { from: start[j], to: 0 }; rounds[r - 1].to = start[j] + dur[j]; });
/* the first beat that shows each catalogue entry */
const firstOf = {};
shown.forEach((i, j) => beats[i].chips.forEach(c => { if (!(c in firstOf)) firstOf[c] = j; }));

/* what each state means for the table, worked out once per state */
const derived = new WeakMap();
function info(S) {
  let d = derived.get(S);
  if (!d) {
    d = { rub: {}, types: [0, 1, 2, 3].map(() => new Set()), count: [0, 0, 0, 0], files: [[], [], [], []] };
    for (const id of S.rub || []) d.rub[id] = 1;
    for (const id in S.own) { const p = S.own[id]; d.count[p]++; d.types[p].add(NMAP[id].type); }
    for (const [pi, ind, s, agency] of S.files || []) d.files[pi].push(agency + ' ' + s + '/3');
    derived.set(S, d);
  }
  return d;
}

/* ---------- HUD ---------- */
const ledger = $('#ledger'), moodEl = $('#mood'), cardEl = $('#eventcard');
const rows = CHARS.slice(0, 4).map((c, i) => {
  const r = document.createElement('div'); r.className = 'lrow'; r.style.setProperty('--pc', c.color);
  r.innerHTML = '<img src="./characters/' + c.file + '" alt=""><span class="ln">' + NAMES[i] + '</span><span class="lm">$<b>0</b></span><span class="li">🛈<b>0</b></span><span class="lc">' + '<i></i>'.repeat(9) + '</span><span class="lt">' + TYPES.map(t => '<i title="' + t + '"></i>').join('') + '<em></em></span>';
  ledger.appendChild(r);
  return { el: r, m: r.querySelector('.lm b'), mi: r.querySelector('.lm'), i: r.querySelector('.li b'), pips: [...r.querySelectorAll('.lc i')], lc: r.querySelector('.lc'), tp: [...r.querySelectorAll('.lt i')], note: r.querySelector('.lt em'), shown: 0, want: null, cort: -1, intel: -1, tk: '', nt: '' };
});
function setLedger(S, cur, dt, snap) {
  const d = info(S);
  S.pl.forEach(([money, intel, cort, , raided], i) => {
    const r = rows[i];
    if (r.want !== money) {
      if (r.want != null && !snap) { r.mi.classList.remove('up', 'down'); void r.mi.offsetWidth; r.mi.classList.add(money > r.want ? 'up' : 'down'); }
      r.want = money;
    }
    r.shown = snap ? money : r.shown + (money - r.shown) * Math.min(1, dt * 7);
    const txt = String(Math.round(r.shown)); if (r.m.textContent !== txt) r.m.textContent = txt;
    if (r.intel !== intel) { r.intel = intel; r.i.textContent = intel; }
    if (r.cort !== cort) { r.cort = cort; r.pips.forEach((p, k) => p.classList.toggle('on', k < cort)); r.lc.classList.toggle('max', cort >= 9); }
    const tk = TYPES.map(t => (d.types[i].has(t) ? 1 : 0)).join('');
    if (r.tk !== tk) { r.tk = tk; r.tp.forEach((p, k) => p.classList.toggle('on', tk[k] === '1')); }
    const nt = (raided ? 'UNDER CAUTION' : d.files[i].length ? '📁 ' + d.files[i].join(' · ') : d.count[i] + (d.count[i] === 1 ? ' NODE' : ' NODES'));
    if (r.nt !== nt) { r.nt = nt; r.note.textContent = nt; r.note.classList.toggle('hot', !!raided || d.files[i].length > 0); }
    r.el.classList.toggle('cur', i === cur);
  });
}
let moodNow = '';
function setMood(m) {
  if (m === moodNow) return; moodNow = m;
  const d = MOODS[m] || MOODS.CALM; moodEl.textContent = d.label + ' · ' + d.desc; moodEl.style.setProperty('--mc', d.color);
}
let cardKey = '';
function setCard(c) {
  cardEl.classList.toggle('on', !!c);
  if (c && cardKey !== c.key) { cardKey = c.key; cardEl.classList.toggle('secret', !!c.secret); cardEl.innerHTML = '<div class="ek">' + c.kick + '</div><div class="ei">' + c.icon + '</div><div class="et">' + c.title + '</div><p>' + c.text + '</p>'; }
}

/* ---------- the caption: who, what, the rule, and the engine's own record ---------- */
const now = { round: $('#nround'), phase: [...document.querySelectorAll('#nphase i')], face: $('#nface'), name: $('#nname'), what: $('#nwhat'), title: $('#ntitle'), rule: $('#nrule'), log: $('#nlog'), who: $('.nowwho') };
const nodeName = id => NMAP[id].name.join(' ').replace(/[“”"]/g, '');
const PHASE = { turn: 0, made: 0, ruling: 0, probe: 0, brief: 0, move: 1, favor: 1, slip: 1, fly: 1, peek: 1, event: 3, jtcancel: 3 };
let captionOf = -1;
function setCaption(j) {
  if (j === captionOf) return; captionOf = j;
  const i = shown[j], b = beats[i], Z = states[i];
  const table = b.k === 'event' || b.k === 'jtcancel', who = b.p != null ? b.p : Z.cur;
  now.round.textContent = b.k === 'win' ? 'THE END' : 'ROUND ' + Z.turn + ' OF ' + rounds.length;
  const ph = b.mid ? 1 : b.k in PHASE ? PHASE[b.k] : b.k === 'raid' ? (Z.phase === 'move' ? 0 : 2) : 2;
  now.phase.forEach((el, k) => el.classList.toggle('on', k === ph));
  now.who.style.setProperty('--pc', table ? '#f4f0e6' : PC[who]);
  now.face.src = table ? './static/bloomberg terminal.png' : './characters/' + CHARS[who].file;
  now.name.textContent = table ? 'The market' : NAMES[who];
  const a = ACTS[b.chips[0]] || { title: '', rule: '' };
  let what = '';
  if (b.k === 'move' || b.k === 'fly') what = '→ ' + nodeName(Z.pl[who][3]);
  else if (b.k === 'seize' || b.k === 'takeover' || b.k === 'rebuild' || b.k === 'marketsell' || b.k === 'overtour' || b.k === 'blockade' || b.k === 'bug' || b.k === 'missile' || b.k === 'deal') what = nodeName(b.id) + (b.k === 'deal' ? ' → ' + NAMES[b.target] + ', $' + b.n : b.k === 'takeover' ? ' · from ' + NAMES[b.prev] : '');
  else if (b.k === 'stage5') what = 'on ' + NAMES[Z.dec];
  else if (b.target != null && NAMES[b.target]) what = 'on ' + NAMES[b.target];
  now.what.textContent = what;
  const card = b.card && MATCH.cards[b.card];
  now.title.textContent = card ? card.title : a.title;
  now.rule.textContent = card ? card.text : a.rule + (b.mid ? ' Used mid-move, through Backroom Deals.' : '');
  now.log.innerHTML = '';
  (b.lines || []).filter(l => !/^—— TURN/.test(l)).slice(0, 3).forEach(l => { const li = document.createElement('li'); li.textContent = l; now.log.appendChild(li); });
}

/* ---------- the checklist of every action ---------- */
const actList = $('#actlist'), chipEls = {};
let chipTotal = 0;
for (const [group, list] of GROUPS) {
  const sec = document.createElement('div'); sec.className = 'actgroup'; sec.innerHTML = '<h3>' + group + '</h3>';
  for (const [id, label] of list) {
    const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'chip'; bt.textContent = label; bt.disabled = !(id in firstOf);
    bt.onclick = () => { seek(start[firstOf[id]] + 0.01); setActs(false); setPlaying(true); };
    sec.appendChild(bt); chipEls[id] = bt; chipTotal++;
  }
  actList.appendChild(sec);
}
$('#acttotal').textContent = chipTotal;
const actsEl = $('#acts'), actsBtn = $('#actsbtn');
function setActs(open) { actsEl.hidden = !open; actsBtn.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('acts-open', open); }
actsBtn.onclick = () => setActs(actsEl.hidden);
$('#actsclose').onclick = () => setActs(false);
let litCount = -1;
function setChips(j) {
  let n = 0;
  for (const id in chipEls) { const on = id in firstOf && firstOf[id] <= j; if (on) n++; chipEls[id].classList.toggle('on', on); chipEls[id].classList.toggle('live', on && firstOf[id] === j); }
  if (n !== litCount) { litCount = n; $('#actcount').textContent = n; actsBtn.classList.remove('bump'); void actsBtn.offsetWidth; if (n) actsBtn.classList.add('bump'); }
}

/* ---------- transport ---------- */
let T = 0, playing = false, started = false, speedIx = 0, world = null, needSnap = true, ended = false;
const SPEEDS = [1, 1.5, 2, 4];
const playBtn = $('#reelplay'), speedBtn = $('#speed'), nav = $('#reelnav');
const bars = rounds.map((r, k) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'tick'; b.setAttribute('aria-label', 'Round ' + (k + 1));
  b.innerHTML = '<span>' + (k + 1) + '</span><i><b></b></i>'; b.onclick = () => { seek(r.from + 0.01); setPlaying(true); };
  nav.appendChild(b); return { el: b, fill: b.querySelector('b'), v: -1 };
});
function setPlaying(on) {
  if (on && ended) { seek(0); }
  playing = on; started = started || on;
  document.body.classList.toggle('started', started);
  playBtn.classList.toggle('on', playing); playBtn.setAttribute('aria-pressed', String(playing));
  playBtn.querySelector('span').textContent = playing ? 'PAUSE' : 'PLAY';
}
function seek(t) { T = Math.max(0, Math.min(total - 0.02, t)); needSnap = true; ended = false; $('#outro').hidden = true; document.body.classList.remove('ended'); }
playBtn.onclick = () => setPlaying(!playing);
speedBtn.onclick = () => { speedIx = (speedIx + 1) % SPEEDS.length; speedBtn.textContent = SPEEDS[speedIx] + '×'; };
$('#begin').onclick = () => setPlaying(true);
$('#again').onclick = () => { seek(0); setPlaying(true); };
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('button,a,input')) { if (e.key !== 'Escape') return; }
  if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'ArrowRight') { const j = find(T); seek(start[Math.min(shown.length - 1, j + 1)] + 0.01); }
  else if (e.key === 'ArrowLeft') { const j = find(T); seek(start[Math.max(0, T - start[j] > 0.6 ? j : j - 1)] + 0.01); }
  else if (e.key === 'Escape') setActs(false);
});

/* ---------- small effects, all pure functions of an age in seconds ---------- */
const ringOut = (p, age, hex, k = 2, span = 1.2) => { if (age > 0 && age < span) world.ring(p, 0.7 + age * 2.4, hex, k * (1 - age / span)); };
function coins(a, b, age, n = 6, h = 0.9) {
  for (let k = 0; k < n; k++) { const u = (age - k * 0.07) / 0.75; if (u > 0 && u < 1) world.coin(world.arc(up(a, 0.5), up(b, 0.5), h, u), 0.055, age * 9 + k); }
}
function fountain(p, age, n = 9, seed = 0) {
  if (age < 0 || age > 1) return;
  for (let k = 0; k < n; k++) world.coin(v3(p.x + (rnd(k + seed) - 0.5) * 0.9 * age, p.y + 0.4 + age * (1.6 + rnd(k * 3 + seed) * 1.3) - 2.8 * age * age, p.z + (rnd(k * 7 + seed) - 0.5) * 0.6 * age), 0.06, age * 9 + k);
}
/* something nasty travelling from one pawn to another */
function zap(a, b, age, hex, span = 0.9) {
  if (age < 0 || age > span + 0.5) return;
  const u = clamp01(age / span);
  world.link(a, b, hex, 1.6 * (1 - sm(age, span, span + 0.5)), u, 0.05);
  if (u < 1) for (let k = 0; k < 6; k++) { const q = world.arc(up(a, 0.5), up(b, 0.5), 0.8, Math.max(0, u - k * 0.03)); world.glow(q, 0.11 * (1 - k / 7), hex, 2.6 * (1 - k / 6)); }
}
const flare = (p, age, hex = 0xff7a2d) => { if (age < 0 || age > 1.1) return; for (let k = 0; k < 5; k++) world.glow(v3(p.x + (rnd(k) - 0.5) * 0.3, 0.35 + age * (0.8 + rnd(k * 3) * 0.9), p.z + (rnd(k * 5) - 0.5) * 0.3), 0.13 * (1 - age / 1.1), hex, 2.6 * (1 - age / 1.1)); world.ring(p, 0.3 + age * 0.9, hex, 1.5 * (1 - age / 1.1)); };
const chill = (p, age) => { if (age < 0 || age > 1.3) return; for (let k = 0; k < 3; k++) { const u = (age / 1.3 + k / 3) % 1; world.ring(p, 1.5 * (1 - u) + 0.15, 0x6fd3ff, 1.4 * u * (1 - age / 1.3)); } for (let k = 0; k < 6; k++) world.glow(v3(p.x + Math.cos(k * 1.05 + age * 2) * 0.4, 0.3 + age * 0.9 + rnd(k) * 0.3, p.z + Math.sin(k * 1.05 + age * 2) * 0.4), 0.06, 0x9fe6ff, 2 * (1 - age / 1.3)); };
function wall(c, k) {
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * 6.283 + 0.26, p = v3(c.x + Math.cos(a) * 1.05, 0, c.z + 0.15 + Math.sin(a) * 0.82), q = sm(k, i / 30, 0.6 + i / 30);
    world.box(up(p, 0.11 * q), 0.4, 0.22 * q, 0.12, i % 2 ? 0xf5c542 : 0x23292a, -a + Math.PI / 2);
    if (i % 3 === 0) world.glow(up(p, 0.3 * q), 0.06, 0xffb020, 3 * q * (Math.floor(world.clock * 4 + i) % 2));
  }
  world.ring(c, 1.3, 0xffb020, 0.9 * k);
}
const HUES = [0xff6b5e, 0x55c1ff, 0xf5c542, 0x7fe08d, 0xe19bff, 0xffffff, 0xffa94d];
function crowd(c, n, k, seed = 0) {
  for (let i = 0; i < n; i++) {
    const a = rnd(i + seed) * 6.28, r = 0.25 + rnd(i * 3 + seed) * 0.75, p = v3(c.x + Math.cos(a) * r * 1.2, Math.abs(Math.sin(world.clock * 9 + i)) * 0.05, c.z + 0.75 + Math.sin(a) * r * 0.55);
    world.box(up(p, p.y + 0.07), 0.055 * k, 0.13 * k, 0.045 * k, HUES[i % 7]); world.ball(up(p, p.y + 0.17), 0.033 * k, 0xe7c9a5);
  }
}

/* ---------- beats ---------- */
/* x: { b, t, D, hit, A (state before), Z (state after), S (state shown now), p (seat), me (its pawn) } */
const at = (S, p) => world.stand(S.pl[p][3], p);
const struck = b => b.fx.filter(f => /^💥 MISSILE/.test(f[1])).map(f => f[0]);
const DRAW = {
  turn(x) { ringOut(x.me, x.t - 0.05, PC[x.p], 2, 0.8); },
  move(x) {
    const from = x.A.pl[x.p][3], to = x.Z.pl[x.p][3];
    const pos = world.walk(x.p, [from, to], sm(x.t, 0, x.D < 0.6 ? x.D * 0.9 : 0.45), x.p); x.own = pos;
    if (x.b.chips[0] === 'toll') { const o = x.Z.own[to]; if (o != null) coins(pos, at(x.S, o), x.t - x.hit, 4); }
    if (x.b.chips[0] === 'tuvalu') { ringOut(world.N(to), x.t - x.hit, GOLD, 2.4, 1.4); world.pulse(to, bell(x.t, x.hit, x.hit + 1.2)); }
    x.cam = [world.N(from), world.N(to)];
  },
  favor(x) { ringOut(x.me, x.t - x.hit, BLUE); },
  slip(x) { ringOut(x.me, x.t - x.hit, GOLD); for (let k = 0; k < 5; k++) world.gbox(v3(x.me.x - 0.3 - k * 0.22 - ((x.t * 3) % 0.22), 0.12 + k * 0.03, x.me.z + (k % 2 ? 0.08 : -0.08)), 0.2, 0.012, 0.012, 0xf5c542, 1.6 * bell(x.t, 0.1, 1.4)); },
  fly(x) {
    const a = world.stand(x.b.from, x.p).setY(0.16), z = world.stand(x.b.id, x.p).setY(0.16), u = sm(x.t, 0.25, x.hit);
    const h = 2.6 + a.distanceTo(z) * 0.16, pos = world.arc(a, z, h, u), d = world.arc(a, z, h, Math.min(1, u + 0.01)).sub(pos);
    x.noJet = u > 0;
    if (u > 0 && u < 1) {
      world.jet(pos, d, Math.sin(u * Math.PI) * -0.35); x.own = pos; world.hideToken(x.p);
      for (let k = 1; k < 16; k++) world.glow(world.arc(a, z, h, Math.max(0, u - k * 0.012)), 0.05, 0xffffff, 0.5 * (1 - k / 16));
      x.cam = [pos]; x.camMin = lerp(8, 12, Math.sin(u * Math.PI));
    } else if (u >= 1) { world.jet(z, v3(0.4, 0, 1)); x.cam = [world.N(x.b.id)]; if (x.b.chips.includes('tuvalu')) ringOut(world.N(x.b.id), x.t - x.hit, GOLD, 2.4, 1.4); }
  },
  seize(x) { const n = world.N(x.b.id); world.pulse(x.b.id, bell(x.t, x.hit - 0.5, x.hit + 0.9)); ringOut(n, x.t - x.hit, PC[x.p]); x.cam = [n, x.me]; },
  takeover(x) { DRAW.seize(x); coins(x.me, at(x.S, x.b.prev), x.t - x.hit, 8); },
  push(x) {
    const lv = Math.min(5, Math.log2(x.Z.sisy / 10)), k = sm(x.t, 0.3, x.hit);
    const top = world.sisyphus(lerp((lv - 1) / 5, lv / 5, k), true); x.noSisy = true;
    fountain(top.clone(), x.t - x.hit, 8 + lv * 3, lv * 9);
    x.cam = [world.hillAt.clone().add(v3(1, 0, 0))]; x.camMin = 7.2;
  },
  jog(x) { chill(x.me, x.t - x.hit + 0.3); world.pulse(x.b.id, bell(x.t, 0, 1.4)); },
  beach: x => chill(x.me, x.t - x.hit + 0.3), venicecool: x => chill(x.me, x.t - x.hit + 0.3), spin: x => chill(x.me, x.t - x.hit + 0.3),
  cook(x) { flare(x.me, x.t - 0.1, 0xff8a2d); chill(x.me, x.t - x.hit); },
  laylow(x) { if (x.b.choice === 'cool') chill(x.me, x.t - x.hit + 0.3); else fountain(up(x.me, 0.2), x.t - x.hit, 3); },
  sell(x) { for (let k = 0; k < (x.b.n || 2); k++) world.glow(v3(x.me.x + Math.cos(k * 2.1) * 0.5 * (1 - sm(x.t, 0, x.hit)), 0.7, x.me.z + Math.sin(k * 2.1) * 0.5 * (1 - sm(x.t, 0, x.hit))), 0.09, 0x55c1ff, 2.5 * (x.t < x.hit)); fountain(up(x.me, 0.2), x.t - x.hit, 6); },
  sellall(x) { DRAW.sell(x); fountain(up(x.me, 0.2), x.t - x.hit - 0.2, 8, 5); },
  bug(x) { const n = world.N(x.b.id); world.link(x.me, n, BLUE, 1.8 * (1 - sm(x.t, x.hit, x.hit + 0.7)), sm(x.t, 0.15, x.hit), 0.04); ringOut(n, x.t - x.hit, BLUE, 1.6, 0.9); x.cam = [n, x.me]; },
  leak(x) { const z = at(x.S, x.b.target); zap(x.me, z, x.t - 0.15, PURPLE, x.hit - 0.15); flare(z, x.t - x.hit); x.cam = [x.me, z]; },
  audit(x) { const z = at(x.S, x.b.target); zap(x.me, z, x.t - 0.15, 0x9fb8ff, x.hit - 0.15); flare(z, x.t - x.hit); x.cam = [x.me, z]; },
  tweet(x) { const z = at(x.S, x.b.target); zap(x.me, z, x.t - 0.15, ORANGE, x.hit - 0.15); ringOut(z, x.t - x.hit, BLUE, 2, 1); x.cam = [x.me, z]; },
  foxroast(x) { const z = at(x.S, x.b.target); zap(x.me, z, x.t - 0.15, 0xff7a3a, x.hit - 0.15); flare(z, x.t - x.hit); x.cam = [x.me, z]; },
  refer(x) { const z = at(x.S, x.b.target); zap(x.me, z, x.t - 0.15, BLUE, x.hit - 0.15); ringOut(z, x.t - x.hit, BLUE, 2, 1); x.cam = [x.me, z]; },
  targetpanic(x) {
    const z = at(x.S, x.b.target);
    for (let k = 0; k < 6; k++) zap(x.me, z, x.t - 0.2 - k * 0.2, RED, 0.5);
    flare(z, x.t - x.hit); flare(z, x.t - x.hit - 0.3, 0xff2a1a); world.glow(up(z, 0.6), 0.9, 0xff2a1a, 1.2 * bell(x.t, x.hit - 0.3, x.hit + 1));
    x.cam = [x.me, z];
  },
  stage5(x) { const z = at(x.S, x.Z.dec); zap(x.me, z, x.t - 0.15, RED, x.hit - 0.15); const k = sm(x.t, x.hit, x.hit + 0.8); world.gbox(v3(z.x, 1.6 - 1.2 * k, z.z), 0.1, 1.4 * (1 - k * 0.6), 0.1, 0xff3b30, 2 * bell(x.t, x.hit, x.D)); x.cam = [x.me, z]; },
  pressure(x) { for (let k = 0; k < 3; k++) ringOut(x.me, x.t - 0.1 - k * 0.25, PURPLE, 1.6, 1.4); x.cam = []; for (let i = 0; i < 4; i++) if (i !== x.p) { const z = at(x.S, i); zap(x.me, z, x.t - 0.3, PURPLE, x.hit - 0.3); flare(z, x.t - x.hit); x.cam.push(z); } x.cam.push(x.me); },
  masspanic(x) { for (let k = 0; k < 4; k++) ringOut(x.me, x.t - 0.1 - k * 0.22, RED, 2, 1.6); x.cam = []; for (let i = 0; i < 4; i++) { const z = at(x.S, i); if (i !== x.p) zap(x.me, z, x.t - 0.3, RED, x.hit - 0.3); flare(z, x.t - x.hit, 0xff2a1a); x.cam.push(z); } },
  budget(x) { ringOut(x.me, x.t - 0.1, GREEN); x.cam = [x.me]; for (let i = 0; i < 4; i++) if (i !== x.p) { const z = at(x.S, i); coins(z, x.me, x.t - x.hit + 0.5 - i * 0.1, 3, 1.4); x.cam.push(z); } },
  missile(x) {
    const b = x.b, L = b.launcher === 'geo_missile' ? up(world.silo, 0.5) : world.N(b.launcher).clone().add(v3(0.9, 0.5, 0.3));
    world.glow(up(L, 0.3), 0.5, 0xffa53a, 2.5 * bell(x.t, 0.3, 1.2));
    if (b.id !== 'geo_tuvalu') {
      const B = world.N(b.id).clone().add(v3(0, 0.45, 0.1));
      world.flight(0, L, B, 3.5 + L.distanceTo(B) * 0.12, sm(x.t, 0.45, x.hit), 3 + b.id.length);
      world.boom(B, x.t - x.hit, 1.15, 5);
      x.cam = [world.N(b.launcher), world.N(b.id)]; return;
    }
    /* Tuvalu sends it back: out to the island, home onto the launcher, then on to something else */
    const Tv = world.N('geo_tuvalu'), Dm = Tv.clone().add(v3(0.45, 1.15, 0.15)), other = struck(b)[0];
    world.flight(0, L, Dm, 3 + L.distanceTo(Dm) * 0.1, sm(x.t, 0.45, 2), 7);
    x.shield = Math.max(0, 1 - Math.abs(x.t - 2.05) * 3);
    ringOut(up(Dm, 1), x.t - 2, 0x35e0ff, 2.5, 0.8);
    world.pop('rf', Tv, 'REFLECTED', '#35e0ff', x.t - 2, 1.5, 'huge');
    world.flight(1, Dm, L, 2.4 + L.distanceTo(Dm) * 0.08, sm(x.t, 2, 3.2), 9);
    world.boom(up(L, 0.3), x.t - 3.2, 1.2, 11);
    if (x.t > 3.2) { world.rubble(b.launcher); world.own(b.launcher, null); }
    if (other) { const B = world.N(other).clone().add(v3(0, 0.45, 0.1)); world.flight(2, Dm, B, 2.4 + Dm.distanceTo(B) * 0.08, sm(x.t, 3.4, x.hit), 13); world.boom(B, x.t - x.hit, 1.15, 15); }
    x.cam = [Tv, world.N(b.launcher)].concat(other ? [world.N(other)] : []);
  },
  bondmageddon(x) {
    const A = up(world.N('bond'), 0.7), tg = struck(x.b);
    world.pulse('bond', 1 - sm(x.t, 4, 5)); world.pulse('leak', 1 - sm(x.t, 4, 5));
    world.link(world.N('bond'), world.N('leak'), RED, 2.5 * (1 - sm(x.t, 1.2, 2.2)), sm(x.t, 0.1, 0.8), 0.12);
    world.pop('bm', world.N('bond'), 'BONDMAGEDDON', RED, x.t - 0.3, 2.2, 'huge');
    tg.forEach((id, k) => {
      const B = world.N(id).clone().add(v3(0, 0.45, 0.1)), t0 = 1 + k * 0.5, t1 = x.hit - (tg.length - 1 - k) * 0.45;
      world.flight(k, A, B, 3.5 + k * 1.1 + A.distanceTo(B) * 0.1, sm(x.t, t0, t1), 20 + k); world.boom(B, x.t - t1, 1.25, 30 + k * 9);
      world.glow(A, 0.4, 0xffa53a, 2.5 * bell(x.t, t0 - 0.1, t0 + 0.5));
      if (x.t > t1) { world.rubble(id); world.own(id, null); }
    });
    x.cam = [world.N('bond')].concat(tg.map(id => world.N(id))); x.camMin = 13;
  },
  rebuild(x) { const n = world.N(x.b.id); ringOut(n, x.t - x.hit, GREEN, 2.4, 1.3); for (let k = 0; k < 6; k++) world.glow(v3(n.x + (rnd(k) - 0.5) * 0.9, 0.2 + rnd(k * 3) * 0.8, n.z + 0.3), 0.05, 0x7fe08d, 2.5 * bell(x.t, 0.1 + k * 0.08, x.hit + 0.3)); x.cam = [n, x.me]; },
  qantasdown(x) { const q = world.N('qantas'); zap(x.me, q, x.t - 0.1, RED, x.hit - 0.1); for (let k = 0; k < 2; k++) ringOut(q, x.t - x.hit - k * 0.25, RED, 2.2, 1.2); x.cam = [q]; x.camMin = 9; },
  oilcrash(x) {
    const s = world.N('geo_scs'); for (let k = 0; k < 3; k++) ringOut(s, x.t - 0.2 - k * 0.3, RED, 2, 1.6);
    x.cam = [s]; for (const id of OIL_IDS) { world.pulse(id, bell(x.t, x.hit - 0.2, x.D)); const n = world.N(id); world.gbox(v3(n.x, 1.3 - 0.6 * sm(x.t, x.hit, x.hit + 1), n.z - 0.3), 0.08, 1.2, 0.08, 0xff3b30, 1.6 * bell(x.t, x.hit - 0.2, x.D)); x.cam.push(n); }
  },
  overtour(x) {
    const a = world.lagoon, c = world.N(x.b.id), B = c.clone().add(v3(0, 0, 0.75));
    for (let i = 0; i < 70; i++) {
      const u = clamp01((x.t - 0.4 - i * 0.022) / 1.5); if (u <= 0 || u >= 1) continue;
      const e = u * u * (3 - 2 * u), ang = rnd(i) * 6.28, r = 0.25 + rnd(i * 3) * 0.75;
      const p = v3(a.x + (rnd(i * 7) - 0.5) * 0.5, 0, a.z + (rnd(i * 11) - 0.5) * 0.5).lerp(v3(B.x + Math.cos(ang) * r * 1.2, 0, B.z + Math.sin(ang) * r * 0.55), e);
      p.y = 0.07 + Math.sin(e * Math.PI) * 2.2; world.box(p, 0.055, 0.13, 0.045, HUES[i % 7]); world.ball(up(p, p.y + 0.1), 0.033, 0xe7c9a5);
    }
    world.pulse(x.b.id, bell(x.t, 1.4, x.D)); x.cam = [world.N('geo_venice'), c];
  },
  blockade(x) { const c = world.N(x.b.id); if (x.t < x.hit) wall(c, sm(x.t, 0.25, x.hit)); zap(x.me, c, x.t - 0.1, GOLD, 0.6); x.cam = [c]; x.camMin = 9; },
  spy: x => ringOut(x.me, x.t - 0.1, BLUE), peek: x => ringOut(x.me, x.t - 0.1, BLUE), brief: x => ringOut(x.me, x.t - 0.1, BLUE),
  dossier: x => ringOut(x.me, x.t - 0.1, PURPLE), lobby: x => ringOut(x.me, x.t - 0.1, BLUE),
  sweep(x) { const mine = Object.keys(x.A.bugs).filter(id => x.A.own[id] === x.p); x.cam = [x.me]; ringOut(x.me, x.t - 0.1, GREEN); for (const id of mine) { ringOut(world.N(id), x.t - x.hit, GREEN, 2.4, 1.2); x.cam.push(world.N(id)); } },
  divestmade(x) { const m = world.N('made'), o = x.A.own.made; zap(x.me, m, x.t - 0.1, PURPLE, x.hit - 0.1); world.lift('made', 0.4 * bell(x.t, x.hit - 0.4, x.hit + 1)); if (o != null) coins(x.me, at(x.S, o), x.t - x.hit, 7, 1.6); x.cam = [m, x.me]; },
  marketsell(x) { const n = world.N(x.b.id); world.lift(x.b.id, 0.45 * bell(x.t, 0.1, x.hit + 0.5)); coins(n, x.me, x.t - x.hit, 8); x.cam = [n, x.me]; },
  deal(x) { const n = world.N(x.b.id), z = at(x.S, x.b.target); zap(x.me, z, x.t - 0.1, GOLD, 0.7); coins(z, x.me, x.t - x.hit, 9, 1.6); ringOut(n, x.t - x.hit, PC[x.b.target]); world.pulse(x.b.id, bell(x.t, 0.2, x.hit + 0.8)); x.cam = [x.me, z]; },
  event(x) {
    x.wide = true;
    x.b.fx.forEach((f, k) => { if (f[0]) world.pulse(f[0], bell(x.t, x.hit + k * STAGGER - 0.1, x.hit + k * STAGGER + 1)); });
  },
  jtcancel(x) { x.wide = true; const o = x.Z.own.jt; if (o != null) ringOut(at(x.S, o), x.t - 0.1, BLUE); world.pulse('jt', bell(x.t, 0, 1.6)); },
  made(x) {
    const M = world.N('made'), k = sm(x.t, 0.2, 1) * (1 - sm(x.t, x.D - 0.9, x.D)), m = world.madeGlow(0.25 + k); x.noMade = true;
    world.glow(m, 0.45 + k * 0.35, 0x8a2be2, k * 0.5); world.beam(up(M, 0.1), 0.42, 5, 0xa13cff, k * 0.16);
    for (let i = 0; i < 3; i++) world.ring(M, ((x.t * 0.7 + i / 3) % 1) * 3, 0xa13cff, 0.5 * k * (1 - ((x.t * 0.7 + i / 3) % 1)));
    world.pulse('made', k); x.cam = [M];
    for (let i = 0; i < 4; i++) if (i !== x.p && x.Z.pl[i][0] < x.A.pl[i][0]) { const z = at(x.S, i); for (let c = 0; c < 14; c++) { const u = (x.t - x.hit - c * 0.08) / 1.3; if (u > 0 && u < 1) world.coin(world.arc(up(z, 0.5), m, 1.4 + rnd(c) * 0.8, u), 0.06 * (1 - u * u * 0.8), x.t * 9 + c); } x.cam.push(z); }
  },
  raid(x) {
    const seized = Object.keys(x.A.own).filter(id => x.A.own[id] === x.p && x.Z.own[id] !== x.p), fl = Math.floor(x.t * 6) % 2, z = at(x.S, x.p);
    x.cam = [z];
    seized.slice(0, 2).forEach((id, i) => {
      const c = world.N(id), from = c.clone().add(v3(i ? 5 : -5, 0, 4.5)), stop = c.clone().add(v3(i ? 0.95 : -0.95, 0, 0.75)), u = sm(x.t, 0.2 + i * 0.3, 1.7 + i * 0.3);
      world.van(i, from.clone().lerp(stop, u), Math.atan2(stop.x - from.x, stop.z - from.z));
      const sweep = sm(x.t, 0.4, 1.8);
      world.beam(v3(c.x + Math.sin(x.t * 2.2 + i * 2) * (1 - sweep) * 2.2, 0.03, c.z + 0.2), 0.95, 9, fl === i ? 0xff3b30 : 0x3b7bff, 0.2 * sm(x.t, 0, 0.5) * (1 - sm(x.t, x.D - 1.2, x.D)));
      world.lift(id, 0.55 * sm(x.t, 1.8, x.hit) * (x.t < x.hit ? 1 : 1 - sm(x.t, x.hit, x.hit + 0.6)));
      world.pop('sz' + i, c, 'SEIZED BY THE REGULATORS', RED, x.t - x.hit - i * 0.25, 2, 'big');
      x.cam.push(c);
    });
    world.glow(v3(z.x, 3.5, z.z), 9, fl ? 0xff2a2a : 0x2a55ff, 0.02 * (1 - sm(x.t, x.D - 1.5, x.D)));
    world.pop('raid', up(z, 1.2), '🚨 CORTISOL 9 — RAID', RED, x.t - 0.1, 2.4, 'huge');
  },
  ruling(x) {
    const out = Object.keys(x.A.own).filter(id => x.A.own[id] === x.p && x.Z.own[id] !== x.p); x.cam = [x.me];
    for (const id of out) { world.lift(id, 0.5 * bell(x.t, 0.2, x.hit + 0.8)); ringOut(world.N(id), x.t - x.hit, BLUE, 2.2, 1.2); x.cam.push(world.N(id)); }
  },
  probe: x => { for (let k = 0; k < 2; k++) ringOut(x.me, x.t - 0.1 - k * 0.3, 0x9fb8ff, 1.8, 1.2); },
  win(x) {
    const mine = Object.keys(x.Z.own).filter(id => x.Z.own[id] === x.p), set = TYPES.map(ty => mine.find(id => NMAP[id].type === ty)).filter(Boolean);
    set.forEach((id, i) => { const k = sm(x.t, 0.6 + i * 0.6, 1.2 + i * 0.6); world.beam(up(world.N(id), 0.05), 0.42, 6, GOLD, 0.16 * k); world.pulse(id, k); world.pop('ty' + i, world.N(id), '✓ ' + NMAP[id].type, GOLD, x.t - (0.8 + i * 0.6), 0, 'tag'); });
    const done = x.t - 5.2;
    if (done > 0) for (let i = 0; i < 70; i++) { const a = (done - rnd(i) * 2.5) % 3; if (a < 0) continue; world.coin(v3(x.me.x + (rnd(i * 3) - 0.5) * 3 * a, 0.5 + (4 + rnd(i * 5) * 4) * a - 3.2 * a * a, x.me.z + (rnd(i * 7) - 0.5) * 3 * a), 0.07, x.t * 7 + i); }
    world.pop('w', up(x.me, 0.6), 'THE CON IS YOURS', GOLD, done, 0, 'huge');
    world.cam(v3(0, 0, 0.6), lerp(20, 26, sm(x.t, 0, x.D)), 0.7, lerp(-0.4, 0.4, sm(x.t, 0, x.D))); x.ownCam = true;
  },
};
const BIG = /RAIDED|MONOPOLY|MANIPULATION|BACKFIRE|MISSILE|SEIZED|CLAIMED|REBUILT|SOLD|BLOCKADED|GROUNDED|OVERTOURISM|DIVESTED|PLANTED|STAGE 5|DOSSIER|NO INCOME|FILE/;
const centre = v3(0, 0, 0.6);

/* ---------- one frame ---------- */
function draw(dt, hard) {
  const j = find(T), i = shown[j], b = beats[i], t = T - start[j], D = dur[j], hit = hitAt[j];
  const A = before(i), Z = states[i], S = t < hit ? A : Z, d = info(S);
  const idle = !started;
  world.begin({ owners: S.own, rubble: d.rub, mood: S.mood }, dt);
  const p = b.p != null ? b.p : Z.cur;
  const x = { b, t, D, hit, A, Z, S, p, me: at(S, p) };
  if (!idle && DRAW[b.k]) DRAW[b.k](x);
  /* the standing furniture of the table */
  for (let k = 0; k < 4; k++) if (!(x.own && k === p)) world.token(k, at(S, k));
  if (!x.noJet) world.jetParked();
  if (!x.noSisy) world.sisyphus(Math.min(5, Math.log2(S.sisy / 10)) / 5, S.own.sisy != null && S.pl[S.own.sisy][3] === 'sisy');
  if (!x.noMade) world.madeGlow(S.own.made != null ? 0.45 + 0.25 * Math.sin(world.clock * 1.3) : 0.2);
  if (S.own.geo_tuvalu != null || x.shield) world.shield(1, x.shield || 0);
  for (let k = 0; k < 2; k++) { const a = world.clock * 0.7 + k * 3.1, g = v3(world.lagoon.x + Math.cos(a) * 0.36, 0.07, world.lagoon.z + Math.sin(a) * 0.36); world.box(g, 0.07, 0.035, 0.3, 0x15191a, -a); world.ball(up(g, 0.15), 0.035, 0xe7c9a5); }
  for (const id in S.bugs) { const n = world.N(id); world.glow(v3(n.x + 0.52, 1.05, n.z - 0.2), 0.07, PC[S.bugs[id]], 1.5 + 1.5 * (Math.floor(world.clock * 3) % 2)); }
  (S.blk || []).forEach(id => wall(world.N(id), 1));
  if (S.qg) { const q = world.N('qantas'); world.ring(q, 1.25, RED, 1 + 0.5 * Math.sin(world.clock * 4)); world.pop('qg', q, '🛫 GROUNDED', RED, 1, 0, 'tag'); }
  if (S.ov) { crowd(world.N(S.ov[0]), 16, 1, 3); world.pop('ov', world.N(S.ov[0]), '🛳️ OVERTOURISM', PURPLE, 1, 0, 'tag'); }
  (S.blk || []).forEach((id, k) => world.pop('bk' + k, world.N(id), '🚧 BLOCKADED', GOLD, 1, 0, 'tag'));
  /* the engine's own pop-ups, in the order it raised them */
  if (!idle) b.fx.forEach((f, k) => world.pop('fx' + k, f[0] ? world.N(f[0]) : centre, f[1], f[2], t - hit - k * STAGGER, f[3] ? 2.4 : 1.7, f[3] ? 'huge' : BIG.test(f[1]) ? 'big' : ''));
  /* camera */
  const drift = Math.sin(T * 0.07) * 0.35;
  if (idle) world.cam(centre, 26, 0.62, Math.sin(world.clock * 0.16) * 0.5);
  else if (x.wide) world.cam(centre, 25.5, 0.68, drift * 0.6);
  else if (!x.ownCam) {
    const pts = x.cam && x.cam.length ? x.cam : [x.me];
    const c = v3(0, 0, 0); pts.forEach(q => c.add(q)); c.multiplyScalar(1 / pts.length).setY(0.4);
    let r = 0; pts.forEach(q => { r = Math.max(r, Math.hypot(q.x - c.x, q.z - c.z)); });
    const min = x.camMin || 9;
    world.cam(c, Math.min(27, Math.max(min, min * 0.72 + r * 1.75)), 0.6, drift);
  }
  if (hard) world.snapCamera();
  world.end();
  /* everything outside the canvas */
  setLedger(S, idle ? -1 : Z.cur, dt, hard); setMood(world.moodNow());
  if (idle) { setCard(null); return; }
  setCaption(j); setChips(j);
  const peeked = (b.q || []).find(q => q.card);
  if (b.k === 'event' && t < D - 0.25) { const c = MATCH.cards[b.card]; setCard({ key: 'e' + i, kick: 'MARKET EVENT', icon: c.icon, title: c.title, text: c.text }); }
  else if (peeked && (b.k === 'spy' || b.k === 'peek' || b.k === 'brief') && t > 0.2 && t < D - 0.25) { const c = MATCH.cards[peeked.card]; setCard({ key: 'p' + i, secret: 1, kick: (peeked.v === 'bury' ? 'BURIED · ' : 'NEXT UP · ') + 'FOR ' + NAMES[peeked.p].toUpperCase() + '’S EYES ONLY', icon: c.icon, title: c.title, text: c.text }); }
  else if (b.k === 'jtcancel' && t < D - 0.25) setCard({ key: 'x' + i, secret: 1, kick: 'CANCELLED BY JTPORTAL', icon: '🌐', title: 'IT NEVER HAPPENED', text: 'The card stays on the deck. Once per game, an event can be made to have never happened.' });
  else setCard(null);
  const r = Z.turn - 1;
  bars.forEach((bar, k) => { const v = k < r ? 1 : k > r ? 0 : clamp01((T - rounds[k].from) / (rounds[k].to - rounds[k].from)); if (Math.abs(v - bar.v) > 0.002) { bar.v = v; bar.fill.style.transform = 'scaleX(' + v.toFixed(3) + ')'; } bar.el.classList.toggle('on', k === r); });
}

/* ---------- ?perf ---------- */
let perf = null;
if (qs.has('perf')) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:8px;top:60px;z-index:99;font:11px/1.4 ui-monospace,Consolas,monospace;color:#7fe08d;background:#000c;padding:6px 8px;white-space:pre;pointer-events:none';
  document.body.appendChild(el);
  let buf = [], t0 = 0;
  perf = (nowMs, ms) => {
    buf.push(ms); if (nowMs - t0 < 1000) return; t0 = nowMs;
    const s = buf.slice(1).sort((a, b) => a - b); buf = []; if (!s.length) return;
    const avg = s.reduce((a, b) => a + b, 0) / s.length, st = world.stats();
    const o = { fps: Math.round(1000 / avg), avg: +avg.toFixed(1), calls: st.calls, tris: st.tris, dpr: st.dpr, tier: st.tier, adapt: st.adapt, T: +T.toFixed(1), total: +total.toFixed(1) };
    el.textContent = Object.entries(o).map(([k, v]) => k.padEnd(6) + v).join(String.fromCharCode(10));
    document.documentElement.dataset.perf = JSON.stringify(o);
  };
}

/* ---------- boot ---------- */
async function boot() {
  try { world = await createWorld({ canvas: $('#stage'), overlay: $('#pops'), quality: qs.has('q') ? +qs.get('q') : null }); }
  catch (e) { console.error('[film] 3D unavailable:', e); document.body.classList.add('no-gl'); return; }
  document.body.classList.add('gl-ready');
  /* a frozen frame, for checking one beat: ?kind=missile&u=0.6 · ?chip=reflect · ?beat=120 · ?t=95 */
  let frozen = false;
  const pick = qs.get('chip') ? firstOf[qs.get('chip')] : qs.get('kind') ? shown.findIndex(i => beats[i].k === qs.get('kind')) : qs.has('beat') ? shown.findIndex(i => i >= +qs.get('beat')) : -1;
  if (pick >= 0) { T = start[pick] + dur[pick] * (qs.has('u') ? clamp01(+qs.get('u')) : 0.5); frozen = true; }
  else if (qs.has('t')) { T = Math.min(total - 0.02, +qs.get('t') || 0); frozen = true; }
  if (frozen) { started = true; document.body.classList.add('started'); }
  const fit = () => { const wide = window.innerWidth >= 960; world.setShift(started && wide ? 0.13 : 0, wide ? 0 : -0.14); };
  let last = performance.now(), first = true;
  const frame = nowMs => {
    requestAnimationFrame(frame);
    const raw = nowMs - last, dt = Math.min(0.05, raw / 1000); last = nowMs;
    if (document.hidden) return;
    if (!first && !frozen && !reduced) world.sample(raw);
    const sp = SPEEDS[speedIx];
    if (playing && !frozen) {
      T += dt * sp;
      if (T >= total - 0.02) { T = total - 0.02; setPlaying(false); ended = true; document.body.classList.add('ended'); $('#outro').hidden = false; }
    }
    fit();
    const hard = first || frozen || needSnap; needSnap = false;
    draw(hard ? 0.6 : dt * Math.min(sp, 2.5), hard);
    first = false;
    if (perf) perf(nowMs, raw);
  };
  requestAnimationFrame(frame);
}
$('#ogoal').textContent = MATCH.goal;
$('#owho').textContent = NAMES[MATCH.winner].toUpperCase();
$('#ocash').textContent = '$' + states[states.length - 1].pl[MATCH.winner][0];
boot();
