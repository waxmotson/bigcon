'use strict';
/* landing/reel: entry module for landing.html. Wires the scroll position to the reel:
   the chapter nearest the middle of the viewport picks the scene, the scene's clock loops
   (or, on autoplay, hands over to the next chapter), and the HUD mirrors what the scene
   reports. `?scene=<id>&t=<seconds>` freezes one frame — handy for checking a scene. */
import { createWorld } from './world.js';
import { SCENES } from './scenes.js';
import { CHARS, MOODS } from '../js/data.js';

const $ = s => document.querySelector(s);
const chapters = [...document.querySelectorAll('[data-scene]')];
const byId = Object.fromEntries(SCENES.map(s => [s.id, s]));
const qs = new URLSearchParams(location.search);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const frozen = qs.has('t') ? Math.max(0, parseFloat(qs.get('t')) || 0) : null;

/* ---------- HUD ---------- */
const hud = $('#hud'), ledger = $('#ledger'), moodEl = $('#mood'), cardEl = $('#eventcard'), typesEl = $('#types');
const rows = CHARS.slice(0, 4).map(c => {
  const r = document.createElement('div'); r.className = 'lrow'; r.style.setProperty('--pc', c.color);
  r.innerHTML = '<img src="./characters/' + c.file + '" alt=""><span class="ln">' + c.name + '</span><span class="lm">$<b>0</b></span><span class="li">🛈<b>0</b></span><span class="lc">' + '<i></i>'.repeat(9) + '</span>';
  ledger.appendChild(r);
  return { m: r.querySelector('.lm b'), mi: r.querySelector('.lm'), i: r.querySelector('.li b'), pips: [...r.querySelectorAll('.lc i')], lc: r.querySelector('.lc'), shown: 0, want: null, cort: -1, intel: -1 };
});
function setLedger(led, dt, snap) {
  hud.classList.toggle('on', !!led);
  if (!led) return;
  led.forEach(([money, intel, cort], i) => {
    const r = rows[i];
    if (r.want !== money) {
      if (r.want != null && !snap) { r.mi.classList.remove('up', 'down'); void r.mi.offsetWidth; r.mi.classList.add(money > r.want ? 'up' : 'down'); }
      r.want = money;
    }
    r.shown = snap ? money : r.shown + (money - r.shown) * Math.min(1, dt * 7);
    const txt = String(Math.round(r.shown)); if (r.m.textContent !== txt) r.m.textContent = txt;
    if (r.intel !== intel) { r.intel = intel; r.i.textContent = intel; }
    if (r.cort !== cort) { r.cort = cort; r.pips.forEach((p, k) => p.classList.toggle('on', k < cort)); r.lc.classList.toggle('max', cort >= 9); }
  });
}
let moodNow = '';
function setMood(m) {
  if (m === moodNow) return; moodNow = m;
  const d = MOODS[m] || MOODS.CALM; moodEl.textContent = d.label + ' · ' + d.desc; moodEl.style.setProperty('--mc', d.color);
}
let cardKey = '';
function setCard(c) {
  cardEl.classList.toggle('on', !!c && c.age < 5.5);
  if (c && cardKey !== c.title) { cardKey = c.title; cardEl.innerHTML = '<div class="ek">MARKET EVENT</div><div class="ei">' + c.icon + '</div><div class="et">' + c.title + '</div><p>' + c.text + '</p>'; }
}

/* ---------- scroll -> scene ---------- */
let active = 0, time = 0, auto = false, world = null, visible = true;
const nav = $('#reelnav'), ticks = [];
chapters.forEach((ch, i) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'tick';
  b.setAttribute('aria-label', ch.dataset.title || ch.dataset.scene); b.innerHTML = '<span>' + (ch.dataset.title || '') + '</span><i><b></b></i>';
  b.onclick = () => goTo(i); nav.appendChild(b); ticks.push(b);
});
const bars = ticks.map(t => t.querySelector('b'));
const playBtn = $('#reelplay');
function setAuto(on) {
  auto = on && !reduced; playBtn.classList.toggle('on', auto); playBtn.setAttribute('aria-pressed', String(auto));
  playBtn.querySelector('span').textContent = auto ? 'PAUSE THE REEL' : 'PLAY THE REEL';
}
playBtn.onclick = () => { setAuto(!auto); if (auto && active === 0) goTo(1); };
document.querySelectorAll('[data-play-reel]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); setAuto(true); goTo(1); }));
function goTo(i) { chapters[Math.max(0, Math.min(chapters.length - 1, i))].scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }
/* Runs at the top of every frame: layout is read here, before the frame writes any styles,
   so reading and writing never force each other. Classes change only when the answer does. */
let pastReel = null, shownActive = -1;
function pick() {
  const vh = window.innerHeight, mid = vh / 2; let best = active, bd = Infinity, last = null;
  chapters.forEach((ch, i) => { if (ch.hidden) return; const r = ch.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - mid); last = r; if (d < bd) { bd = d; best = i; } });
  visible = last.bottom > -vh * 0.2;         // the closing section covers the canvas
  const past = last.bottom < vh * 0.45;
  if (past !== pastReel) { pastReel = past; document.body.classList.toggle('past-reel', past); }
  if (best !== active) { active = best; time = 0; }
  if (shownActive !== active) {
    if (shownActive >= 0) { chapters[shownActive].classList.remove('active'); ticks[shownActive].classList.remove('on'); bars[shownActive].style.transform = ''; }
    chapters[active].classList.add('active'); ticks[active].classList.add('on'); shownActive = active;
  }
}
function layoutShift() {
  const wide = window.innerWidth >= 960;
  world.setShift(active === 0 ? 0 : wide ? 0.15 : 0, active === 0 ? -0.15 : wide ? 0 : -0.17);
}

/* ---------- ?perf: a frame-time readout (also written to <html data-perf> for scripts) ---------- */
let perf = null, jsMs = 0;
if (qs.has('perf')) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:8px;top:60px;z-index:99;font:11px/1.4 ui-monospace,Consolas,monospace;color:#7fe08d;background:#000c;padding:6px 8px;white-space:pre;pointer-events:none';
  document.body.appendChild(el);
  let buf = [], jb = [], t0 = 0;
  perf = (now, ms) => {
    buf.push(ms); jb.push(jsMs);
    if (now - t0 < 1000) return;
    t0 = now;
    const s = buf.slice(1).sort((a, b) => a - b), js = jb.reduce((a, b) => a + b, 0) / (jb.length || 1); buf = []; jb = [];
    if (!s.length) return;
    const avg = s.reduce((a, b) => a + b, 0) / s.length, p95 = s[Math.floor(s.length * 0.95)], st = world.stats();
    const o = { fps: Math.round(1000 / avg), js: +js.toFixed(2), avg: +avg.toFixed(1), p95: +p95.toFixed(1), calls: st.calls, tris: st.tris, dpr: st.dpr, px: Math.round(st.w * st.dpr) + 'x' + Math.round(st.h * st.dpr), tier: st.tier, adapt: st.adapt };
    el.textContent = Object.entries(o).map(([k, v]) => k.padEnd(6) + v).join(String.fromCharCode(10));
    document.documentElement.dataset.perf = JSON.stringify(o);
  };
}

/* ---------- boot ---------- */
async function boot() {
  try { world = await createWorld({ canvas: $('#stage'), overlay: $('#pops'), quality: qs.has('q') ? +qs.get('q') : null }); }
  catch (e) { console.error('[landing] 3D unavailable:', e); document.body.classList.add('no-gl'); return; }
  document.body.classList.add('gl-ready');
  const want = qs.get('scene') || location.hash.slice(1);
  if (want && byId[want]) {
    const ch = chapters.find(c => c.dataset.scene === want);
    /* a frozen frame shows that chapter alone, so it can be captured without scrolling */
    if (ch && frozen != null) chapters.forEach(c => { if (c !== ch) c.hidden = true; });
    else if (ch) ch.scrollIntoView({ block: 'start' });
  }
  pick();
  let last = performance.now(), first = true;
  const frame = now => {
    requestAnimationFrame(frame);
    const raw = now - last, dt = Math.min(0.05, raw / 1000); last = now;
    if (document.hidden) return;
    pick();
    if (!visible) return;
    if (!first && frozen == null && !reduced) world.sample(raw);
    const sc = byId[chapters[active].dataset.scene] || SCENES[0];
    if (frozen != null) time = Math.min(frozen, sc.dur - 0.01); else if (reduced) time = sc.still; else time += dt;
    if (time >= sc.dur) {
      if (auto && active < chapters.length - 1) { goTo(active + 1); time = sc.dur - 0.001; } else { time = 0; if (auto) setAuto(false); }
    }
    const hard = first || frozen != null;
    const js0 = performance.now();
    layoutShift();
    if (hard) world.snapCamera();
    world.begin(sc, hard ? 0.6 : dt);
    const out = sc.frame(world, time) || {};
    world.end();
    jsMs = performance.now() - js0;
    setLedger(out.led, dt, hard); setCard(out.card); setMood(world.moodNow());
    typesEl.classList.toggle('on', out.types != null);
    if (out.types != null) [...typesEl.children].forEach((el, k) => el.classList.toggle('on', k < out.types));
    bars[active].style.transform = 'scaleX(' + (time / sc.dur).toFixed(3) + ')';
    first = false;
    if (perf) perf(now, raw);
  };
  requestAnimationFrame(frame);
}
boot();
