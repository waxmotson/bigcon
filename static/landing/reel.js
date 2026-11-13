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
  b.setAttribute('aria-label', ch.dataset.title || ch.dataset.scene); b.innerHTML = '<span>' + (ch.dataset.title || '') + '</span><i></i>';
  b.onclick = () => goTo(i); nav.appendChild(b); ticks.push(b);
});
const playBtn = $('#reelplay');
function setAuto(on) {
  auto = on && !reduced; playBtn.classList.toggle('on', auto); playBtn.setAttribute('aria-pressed', String(auto));
  playBtn.querySelector('span').textContent = auto ? 'PAUSE THE REEL' : 'PLAY THE REEL';
}
playBtn.onclick = () => { setAuto(!auto); if (auto && active === 0) goTo(1); };
document.querySelectorAll('[data-play-reel]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); setAuto(true); goTo(1); }));
function goTo(i) { chapters[Math.max(0, Math.min(chapters.length - 1, i))].scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }
function pick() {
  const mid = window.innerHeight / 2; let best = 0, bd = Infinity;
  chapters.forEach((ch, i) => { if (ch.hidden) return; const r = ch.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - mid); if (d < bd) { bd = d; best = i; } });
  const last = chapters.filter(c => !c.hidden).pop().getBoundingClientRect();
  visible = last.bottom > -window.innerHeight * 0.2;         // the closing section covers the canvas
  document.body.classList.toggle('past-reel', last.bottom < window.innerHeight * 0.45);
  if (best !== active) { active = best; time = 0; }
  chapters.forEach((c, i) => c.classList.toggle('active', i === active)); ticks.forEach((t, i) => t.classList.toggle('on', i === active));
}
function layoutShift() {
  const wide = window.innerWidth >= 960;
  world.setShift(active === 0 ? 0 : wide ? 0.15 : 0, active === 0 ? -0.15 : wide ? 0 : -0.17);
}

/* ---------- boot ---------- */
async function boot() {
  try { world = await createWorld({ canvas: $('#stage'), overlay: $('#pops') }); }
  catch (e) { console.error('[landing] 3D unavailable:', e); document.body.classList.add('no-gl'); return; }
  document.body.classList.add('gl-ready');
  window.addEventListener('resize', () => { world.resize(); pick(); });
  window.addEventListener('scroll', pick, { passive: true });
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
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!visible || document.hidden) return;
    const sc = byId[chapters[active].dataset.scene] || SCENES[0];
    if (frozen != null) time = Math.min(frozen, sc.dur - 0.01); else if (reduced) time = sc.still; else time += dt;
    if (time >= sc.dur) {
      if (auto && active < chapters.length - 1) { goTo(active + 1); time = sc.dur - 0.001; } else { time = 0; if (auto) setAuto(false); }
    }
    const hard = first || frozen != null;
    layoutShift();
    if (hard) world.snapCamera();
    world.begin(sc, hard ? 0.6 : dt);
    const out = sc.frame(world, time) || {};
    world.end();
    setLedger(out.led, dt, hard); setCard(out.card); setMood(world.moodNow());
    typesEl.classList.toggle('on', out.types != null);
    if (out.types != null) [...typesEl.children].forEach((el, k) => el.classList.toggle('on', k < out.types));
    ticks[active].style.setProperty('--p', (time / sc.dur).toFixed(4));
    first = false;
  };
  requestAnimationFrame(frame);
}
boot();
