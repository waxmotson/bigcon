'use strict';
/* landing/board3d: the game's optional 3D board (index.html: the 3D button in the zoom bar).
   static/js/ui.js imports it on demand. The production build bundles it on its own with
   three.js left to the page's import map, so it shares NO module state with the game:
   ui.js hands it a plain snapshot (boardScene()) on every repaint and gets taps, hovers
   and route pins back through callbacks. The rules never know it exists.

   The board is the landing pages' world (world.js) built from the live layout. Between two
   snapshots it animates what changed: pawns walk the threads (or fly Qantas), cards change
   hands, missiles fly, the regulators raid, and the engine's own pop-ups float up. */
import * as THREE from 'three';
import { createWorld, sm, clamp01 } from './world.js';

const PX = 0.01;          // world units per board pixel, as on the landing pages
const EL = 1.0;           // camera elevation (world.cam adds a little)
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const up = (p, y) => p.clone().setY(y);
const bell = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin((t - a) / (b - a) * Math.PI));
const hex = c => new THREE.Color(c || '#ffffff').getHex();
const GOLD = 0xf5c542, BLUE = 0x55c1ff, RED = 0xff3b30, PINK = 0xff5e9c, TEAL = 0x7ff6fb;
const BIG = /RAIDED|MONOPOLY|MANIPULATION|BACKFIRE|MISSILE|SEIZED|CLAIMED|REBUILT|SOLD|BLOCKADED|GROUNDED|OVERTOURISM|DIVESTED|PLANTED|STAGE 5|DOSSIER|NO INCOME|FILE/;

const STYLE = `
.b3d-root{position:absolute;inset:0;z-index:1;overflow:hidden;background:#06100f}
.b3d-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none}
.b3d-root canvas.pan{cursor:grabbing}.b3d-root canvas.hot{cursor:pointer}
.b3d-pops{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.b3d-pops .pop{position:absolute;left:0;top:0;white-space:nowrap;font-weight:800;font-size:14px;letter-spacing:.07em;text-shadow:0 2px 0 #000,0 0 14px rgba(0,0,0,.9);will-change:transform,opacity;opacity:0}
.b3d-pops .pop.big{font-size:19px}
.b3d-pops .pop.huge{font-family:"Tomkins Display",system-ui,sans-serif;font-weight:400;font-size:clamp(22px,3vw,40px);letter-spacing:.04em}
.b3d-pops .pop.tag{font-size:11px;letter-spacing:.14em;padding:3px 8px;background:rgba(6,13,12,.86);border:1px solid currentColor;text-shadow:none}
.b3d-pops .pop.step{font-size:13px;font-weight:900;padding:1px 7px;color:#000!important;background:#ff5e9c;border:2px solid #000;text-shadow:none}
.b3d-tip{position:absolute;z-index:3;max-width:330px;pointer-events:none;display:none;white-space:pre-line;background:#101418;border:1px solid #2a4a55;padding:8px 10px;font:12px/1.5 Inconsolata,ui-monospace,monospace;color:#cfe6ee;box-shadow:0 8px 30px rgba(0,0,0,.55)}
.b3d-tip b{display:block;color:#fff;font-size:13px;margin-bottom:2px}
`;

/* The closest camera (in world.cam's terms) that keeps every corner of the board on screen. */
function fitCam(c, w) {
  const aspect = Math.max(0.3, (c.clientWidth || 1) / (c.clientHeight || 1)), cm = new THREE.PerspectiveCamera(36, aspect, 0.1, 500);
  const hx = (w.SW - 3.6) / 2 + 0.9, z0 = -(w.SH - 3.6) / 2 - 0.4, z1 = (w.SH - 3.6) / 2 + 1.2, P = new THREE.Vector3();
  const corners = [[-hx, 0, z0], [hx, 0, z0], [-hx, 0, z1], [hx, 0, z1], [-hx, 1, z0], [hx, 1, z0]];
  const el = EL + 0.13;
  const fits = (tz, D) => {
    cm.position.set(0, 0.3 + Math.sin(el) * D, tz + Math.cos(el) * D); cm.lookAt(0, 0.3, tz); cm.updateMatrixWorld();
    return corners.every(([x, y, z]) => { P.set(x, y, z).project(cm); return P.z < 1 && Math.abs(P.x) < 0.97 && Math.abs(P.y) < 0.95; });
  };
  let best = { x: 0, z: 0.4, d: Infinity };
  for (let tz = -4; tz <= 4; tz += 0.25) {
    let lo = 3, hi = 400;
    if (!fits(tz, hi)) continue;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (fits(tz, m)) hi = m; else lo = m; }
    if (hi - 3.4 < best.d) best = { x: 0, z: tz, d: hi - 3.4 };
  }
  if (!isFinite(best.d)) best.d = Math.max(w.SW, w.SH) * 1.4;
  return best;
}

/* wrap: the element the board fills. first: the opening boardScene(). api: {tap, hover, pin, unpin, fail} */
export async function mountBoard3D(wrap, first, api) {
  if (!document.getElementById('b3d-style')) { const st = document.createElement('style'); st.id = 'b3d-style'; st.textContent = STYLE; document.head.appendChild(st); }
  const root = document.createElement('div'); root.className = 'b3d-root';
  const tip = document.createElement('div'); tip.className = 'b3d-tip'; root.appendChild(tip);
  wrap.appendChild(root);

  let world = null, canvas = null, overlay = null, key = '', edgesKey = '', sc = first, building = null, dead = false;
  let fit = { x: 0, z: 0.3, d: 24 }, cam = { x: 0, z: 0.3, d: 24 }, touched = -1e9, snapNext = true;
  let byId = {}, tok = [], fx = [], hold = {}, shownOwner = {}, shownRub = {}, seenFx = new Set(), last = null, missileSlot = 0;

  async function build(s) {
    const c = document.createElement('canvas'), o = document.createElement('div');
    c.tabIndex = -1; o.className = 'b3d-pops';
    root.insertBefore(o, root.firstChild); root.insertBefore(c, o);
    let w;
    try {
      w = await createWorld({ canvas: c, overlay: o, px: PX, props: !s.fog, board: { nodes: s.nodes, edges: s.edges, bounds: s.bounds }, seats: s.seats.map(p => ({ color: p.color, face: p.face })) });
    } catch (e) { c.remove(); o.remove(); throw e; }
    if (dead) { w.destroy(); c.remove(); o.remove(); return; }
    if (world) { world.destroy(); canvas.remove(); overlay.remove(); }
    world = w; canvas = c; overlay = o; key = s.key; edgesKey = s.edgesKey;
    bindInput(c);
    fit = fitCam(c, w); cam = { ...fit }; snapNext = true;
    tok = s.seats.map(p => ({ at: p.pos, want: p.pos, q: [], seg: null }));
    shownOwner = { ...s.owner }; shownRub = { ...s.rubble }; hold = {}; fx = [];
    for (const f of s.fx) seenFx.add(f.id);
    last = s;
  }
  await build(first);

  /* ---------- a new snapshot: work out what just happened ---------- */
  function update(s) {
    if (dead) return;
    sc = s; byId = {}; for (const n of s.nodes) byId[n.id] = n;
    if (s.key !== key) {
      if (!building) building = build(s).catch(e => { console.warn('[board3d] rebuild failed', e); api.fail && api.fail(); }).finally(() => { building = null; if (sc.key !== key && !dead) update(sc); });
      return;
    }
    if (!world) return;
    if (s.edgesKey !== edgesKey) { edgesKey = s.edgesKey; world.threads(s.edges); }
    const now = world.clock || 0, prev = last || s;
    const at = (x, y) => { for (const n of s.nodes) if (Math.abs(n.x - x) < 1 && Math.abs(n.y - y) < 1) return n.id; return null; };
    /* under fog of war nothing is shown where the viewer has not been */
    const nearest = (x, y) => { let b = null, bd = 1e9; for (const n of s.nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; b = n; } } return bd < 160 ? b : null; };
    const hiddenAt = (x, y) => { const n = nearest(x, y); return !!(n && !n.known); };
    const wasKnown = {}; for (const n of prev.nodes) wasKnown[n.id] = n.known;
    /* the engine's floating fx: projectiles first, so text can wait for the bang */
    const fresh = s.fx.filter(f => !seenFx.has(f.id));
    fresh.forEach(f => seenFx.add(f.id));
    if (seenFx.size > 400) seenFx = new Set(s.fx.map(f => f.id));
    const flyTo = new Set();
    let delay = 0;
    for (const f of fresh) if (f.proj) {
      const from = at(f.x0, f.y0 + 40), to = at(f.x1, f.y1 + 40);
      if (!from || !to || !byId[to].known) continue;
      if (/missile/i.test(f.img || '')) { fx.push({ k: 'missile', t0: now, from, to, slot: missileSlot++ % 6 }); hold[to] = now + 1.25; delay = 1.2; }
      else flyTo.add(to);
    }
    let stagger = 0;
    for (const f of fresh) if (!f.proj && !hiddenAt(f.x, f.y + 40)) { fx.push({ k: 'pop', t0: now + delay + stagger, id: f.id, x: f.x, y: f.y, t: f.t, c: f.c, b: f.b }); stagger += 0.3; if (/MADE/.test(f.t)) fx.push({ k: 'made', t0: now }); }
    /* pawns */
    s.seats.forEach((p, i) => {
      const T = tok[i] || (tok[i] = { at: p.pos, want: p.pos, q: [], seg: null });
      if (p.pos === T.want) return;
      T.want = p.pos;
      if (p.pos == null || T.at == null) { T.at = p.pos; T.q = []; T.seg = null; return; }
      T.q.push({ to: p.pos, fly: flyTo.has(p.pos) });
    });
    /* cards changing hands, rubble, raids */
    const seizedFrom = {};
    for (const n of s.nodes) {
      const id = n.id, was = prev.owner[id], is = s.owner[id], held = hold[id] > now;
      if (held || !wasKnown[id]) continue;
      if (is != null && is !== was) {
        fx.push({ k: 'claim', t0: now, id, pi: is });
        if (was != null) { fx.push({ k: 'coins', t0: now + 0.3, a: is, b: was }); (seizedFrom[was] = seizedFrom[was] || []).push(id); }
      } else if (is == null && was != null) { fx.push({ k: 'lost', t0: now, id }); (seizedFrom[was] = seizedFrom[was] || []).push(id); }
      if (s.rubble[id] && !prev.rubble[id]) fx.push({ k: 'boom', t0: now, id });
    }
    s.seats.forEach((p, i) => { const q = prev.seats[i]; if (q && p.raided > q.raided) fx.push({ k: 'raid', t0: now, pi: i, ids: (seizedFrom[i] || []).slice(0, 2) }); });
    if (s.cur !== prev.cur || s.turn !== prev.turn) {
      fx.push({ k: 'turn', t0: now + 0.1, pi: s.cur });
      const p = s.seats[s.cur];
      /* zoomed in, the camera drifts to whoever is up; at the whole-board view it stays put */
      if (p && p.pos && byId[p.pos] && cam.d < fit.d * 0.8 && performance.now() / 1000 - touched > 4) { const P = world.N(p.pos); cam.x = P.x; cam.z = P.z + 0.6; clampCam(); }
    }
    if (s.over && !prev.over) fx.push({ k: 'win', t0: now });
    last = s;
  }

  /* ---------- the camera: drag to pan, wheel or pinch to zoom ---------- */
  const clampCam = () => {
    const hx = world ? world.SW / 2 : 14, hz = world ? world.SH / 2 : 10;
    cam.x = Math.max(-hx, Math.min(hx, cam.x)); cam.z = Math.max(-hz, Math.min(hz + 1, cam.z));
    cam.d = Math.max(4.5, Math.min(fit.d * 1.25, cam.d));
  };
  function zoomAbout(f, cx, cy) {
    touched = performance.now() / 1000;
    const g = cx != null && world ? world.ground(cx, cy) : null;
    const nd = Math.max(4.5, Math.min(fit.d * 1.25, cam.d * f)), k = 1 - nd / cam.d;
    if (g) { cam.x += (g.x - cam.x) * k; cam.z += (g.z - cam.z) * k; }
    cam.d = nd; clampCam();
  }
  const pointers = new Map();
  let drag = null, pinch = null, hoverId = null, lastMove = null;
  const pickable = id => { const n = id && byId[id]; return n && (n.known || n.reach) ? id : null; };
  function showTip(id, e) {
    const n = id && byId[id];
    if (!n || !n.known || !n.tip || drag) { tip.style.display = 'none'; return; }
    const lines = n.tip.split('\n');
    tip.innerHTML = ''; const b = document.createElement('b'); b.textContent = lines[0]; tip.appendChild(b); tip.appendChild(document.createTextNode(lines.slice(1).join('\n')));
    tip.style.display = 'block';
    const r = root.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
    if (x + tw > r.width - 6) x = e.clientX - r.left - tw - 16;
    if (y + th > r.height - 6) y = e.clientY - r.top - th - 16;
    tip.style.left = Math.max(6, x) + 'px'; tip.style.top = Math.max(6, y) + 'px';
  }
  function setHover(id, e) {
    if (id !== hoverId) { hoverId = id; api.hover && api.hover(id); }
    if (canvas) canvas.classList.toggle('hot', !!(id && byId[id] && byId[id].click));
    if (e) showTip(id, e);
  }
  function bindInput(c) {
    c.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { c.setPointerCapture(e.pointerId); } catch (_) { /* old browsers */ }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cd: cam.d }; drag = null; return;
      }
      drag = { x: e.clientX, y: e.clientY, moved: false, g: world && world.ground(e.clientX, e.clientY), cx: cam.x, cz: cam.z };
    });
    c.addEventListener('pointermove', e => {
      lastMove = e;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 10) { cam.d = pinch.cd * pinch.d / d; clampCam(); touched = performance.now() / 1000; snapNext = true; }
        return;
      }
      if (drag) {
        if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) { drag.moved = true; c.classList.add('pan'); tip.style.display = 'none'; }
        if (drag.moved && drag.g) {
          /* keep the grabbed point of the table under the finger */
          const g = world.ground(e.clientX, e.clientY);
          if (g) { cam.x -= g.x - drag.g.x; cam.z -= g.z - drag.g.z; clampCam(); snapNext = true; touched = performance.now() / 1000; }
        }
        return;
      }
      if (e.pointerType === 'mouse') setHover(world ? pickable(world.pick(e.clientX, e.clientY)) : null, e);
    });
    const end = e => {
      const wasPinch = !!pinch;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (e.type === 'pointerup' && drag && !drag.moved && !wasPinch && world) {
        const id = pickable(world.pick(e.clientX, e.clientY));
        if (id) { if (e.pointerType !== 'mouse') setHover(id); api.tap && api.tap(id); }
        else api.unpin && api.unpin();
      }
      drag = null; c.classList.remove('pan');
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !drag) setHover(null, e); });
    c.addEventListener('wheel', e => { e.preventDefault(); zoomAbout(e.deltaY > 0 ? 1.13 : 0.885, e.clientX, e.clientY); }, { passive: false });
    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      const id = world && pickable(world.pick(e.clientX, e.clientY));
      if (id) api.pin && api.pin(id); else api.unpin && api.unpin();
    });
  }

  /* ---------- one frame ---------- */
  const seatHex = i => hex(sc.seats[i] && sc.seats[i].color);
  const pawnAt = i => { const T = tok[i]; return T && T.at && world.pos[T.at] ? world.stand(T.at, i) : null; };
  function coins(a, b, age, n = 6, h = 0.9) {
    for (let k = 0; k < n; k++) { const u = (age - k * 0.07) / 0.75; if (u > 0 && u < 1) world.coin(world.arc(up(a, 0.5), up(b, 0.5), h, u), 0.055, age * 9 + k); }
  }
  function draw(dt) {
    const s = sc, now = world.clock + dt;
    for (const id in hold) if (hold[id] <= now) { delete hold[id]; }
    for (const n of s.nodes) if (!hold[n.id]) { shownOwner[n.id] = s.owner[n.id]; shownRub[n.id] = s.rubble[n.id]; }
    const owners = {}; for (const id in shownOwner) if (shownOwner[id] != null) owners[id] = shownOwner[id];
    world.begin({ owners, rubble: shownRub, mood: s.mood }, dt);
    const t = world.clock, pulse = 0.5 + 0.5 * Math.sin(t * 4);
    /* the board as the viewer knows it */
    for (const n of s.nodes) {
      const P = world.N(n.id);
      if (!n.known) { world.hide(n.id); if (n.reach) { world.ring(P, 0.8, TEAL, 0.7 + 0.5 * pulse); world.pop('fog' + n.id, P, '?', '#7ff6fb', 1, 0, 'tag'); } continue; }
      if (n.target) { world.ring(P, 1.02, BLUE, 0.8 + 0.7 * pulse); world.pulse(n.id, 0.25 + 0.2 * pulse); }
      else if (n.reach) { world.ring(P, 0.98, 0xffffff, 0.45 + 0.45 * pulse); world.pulse(n.id, 0.12 + 0.1 * pulse); }
      else if (n.click) { world.ring(P, 0.98, GOLD, 0.45 + 0.45 * pulse); world.pulse(n.id, 0.1 + 0.1 * pulse); }
    }
    for (const [a, b] of s.hot) if (world.pos[a] && world.pos[b]) world.link(world.N(a), world.N(b), TEAL, 0.9 + 0.4 * pulse, 1, 0.06);
    if (s.hover && world.pos[s.hover.id]) {
      const H = world.N(s.hover.id); world.ring(H, 1.08, GOLD, 1.8);
      for (const v of s.hover.links) if (world.pos[v]) { world.link(H, world.N(v), GOLD, 1.4, 1, 0.05); world.ring(world.N(v), 0.9, GOLD, 0.8); }
    }
    if (s.path && s.path.length > 1) {
      for (let i = 0; i < s.path.length - 1; i++) world.link(world.N(s.path[i]), world.N(s.path[i + 1]), PINK, 1.8, 1, 0.07);
      s.path.forEach((id, i) => { world.ring(world.N(id), i === 0 || i === s.path.length - 1 ? 1.05 : 0.9, PINK, 1.4); if (i) world.pop('ps' + i, world.N(id), String(i), '#000', 1, 0, 'step'); });
      const steps = s.path.length - 1;
      world.pop('pst', up(world.N(s.path[steps]), -0.75), steps + (steps === 1 ? ' STEP' : ' STEPS'), '#ff5e9c', 1, 0, 'tag');
    }
    /* standing furniture */
    let jetBusy = false, madeK = s.made ? 0.45 + 0.25 * Math.sin(t * 1.3) : 0.2, shieldFlash = 0;
    for (const id in s.bugs) if (world.pos[id] && byId[id] && byId[id].known) { const n = world.N(id); world.glow(v3(n.x + 0.52, 1.05, n.z - 0.2), 0.07, seatHex(s.bugs[id]), 1.5 + 1.5 * (Math.floor(t * 3) % 2)); }
    s.blockades.forEach((id, k) => { if (!world.pos[id]) return; world.wall(world.N(id), 1); world.pop('bk' + k, world.N(id), '🚧 BLOCKADED', '#f5c542', 1, 0, 'tag'); });
    if (s.qg && world.pos.qantas) { const q = world.N('qantas'); world.ring(q, 1.25, RED, 1 + 0.5 * Math.sin(t * 4)); world.pop('qg', q, '🛫 GROUNDED', '#ff6b5e', 1, 0, 'tag'); }
    if (s.ov && world.pos[s.ov]) { world.crowd(world.N(s.ov), 16, 1, 3); world.pop('ov', world.N(s.ov), '🛳️ OVERTOURISM', '#e19bff', 1, 0, 'tag'); }
    if (world.lagoon) for (let k = 0; k < 2; k++) { const a = t * 0.7 + k * 3.1, g = v3(world.lagoon.x + Math.cos(a) * 0.36, 0.07, world.lagoon.z + Math.sin(a) * 0.36); world.box(g, 0.07, 0.035, 0.3, 0x15191a, -a); world.ball(up(g, 0.15), 0.035, 0xe7c9a5); }
    /* effects */
    fx = fx.filter(e => {
      const age = now - e.t0;
      if (age < 0) return true;
      switch (e.k) {
        case 'pop': { const P = world.toWorld(e.x, e.y + 40); const dur = e.b ? 2.6 : 1.9; world.pop('f' + e.id, P, e.t, e.c, age, dur, e.b ? 'huge' : BIG.test(e.t) ? 'big' : ''); return age < dur; }
        case 'claim': { const P = world.N(e.id); world.ringOut(P, age, seatHex(e.pi), 2.2, 1.2); world.pulse(e.id, bell(age, 0, 1.3)); return age < 1.4; }
        case 'lost': { world.ringOut(world.N(e.id), age, BLUE, 2, 1.2); world.lift(e.id, 0.45 * bell(age, 0, 1.4)); return age < 1.4; }
        case 'coins': { const a = pawnAt(e.a), b = pawnAt(e.b); if (a && b) coins(a, b, age, 8); return age < 1.4; }
        case 'boom': { const P = world.N(e.id); world.boom(up(P, 0.45), age, 1.15, e.id.length); return age < 2.6; }
        case 'missile': {
          const from = e.from, L = from === 'geo_missile' && world.silo ? up(world.silo, 0.5) : world.N(from).clone().add(v3(0.9, 0.5, 0.3));
          const B = world.N(e.to).clone().add(v3(0, 0.45, 0.1)), u = sm(age, 0.1, 1.2);
          world.glow(up(L, 0.8), 0.5, 0xffa53a, 2.5 * bell(age, 0, 0.5));
          world.flight(e.slot, L, B, 3 + L.distanceTo(B) * 0.12, u, e.slot * 7);
          world.boom(B, age - 1.2, 1.15, e.slot * 11);
          if (e.to === 'geo_tuvalu') shieldFlash = Math.max(shieldFlash, bell(age, 1.0, 1.6));
          return age < 3.9;
        }
        case 'made': { madeK = 0.25 + 1.2 * bell(age, 0, 3); const M = world.N('made'); if (M) { world.beam(up(M, 0.1), 0.42, 5, 0xa13cff, 0.16 * bell(age, 0, 3)); world.pulse('made', bell(age, 0, 3)); } return age < 3; }
        case 'raid': {
          const z = pawnAt(e.pi), fl = Math.floor(t * 6) % 2;
          e.ids.forEach((id, i) => {
            if (!world.pos[id]) return;
            const c = world.N(id), from = c.clone().add(v3(i ? 5 : -5, 0, 4.5)), stop = c.clone().add(v3(i ? 0.95 : -0.95, 0, 0.75)), u = sm(age, 0.1, 1.5);
            world.van(i, from.clone().lerp(stop, u), Math.atan2(stop.x - from.x, stop.z - from.z), 1 - sm(age, 3.6, 4));
            world.beam(v3(c.x, 0.03, c.z + 0.2), 0.95, 9, fl === i ? RED : 0x3b7bff, 0.2 * bell(age, 0, 4));
          });
          if (z) world.glow(v3(z.x, 3.5, z.z), 6, fl ? 0xff2a2a : 0x2a55ff, 0.03 * bell(age, 0, 4));
          return age < 4;
        }
        case 'turn': { const p = pawnAt(e.pi); if (p) world.ringOut(p, age, seatHex(e.pi), 2, 0.9); return age < 1; }
        case 'win': {
          const i = s.winner != null ? s.winner : s.cur, p = pawnAt(i);
          if (p) for (let k = 0; k < 50; k++) { const a = (age - (k % 10) * 0.25) % 3; if (a < 0) continue; world.coin(v3(p.x + Math.sin(k * 2.3) * 1.4 * a, 0.5 + (4 + (k % 5)) * a - 3.2 * a * a, p.z + Math.cos(k * 1.7) * 1.4 * a), 0.07, t * 7 + k); }
          return age < 9;
        }
      }
      return false;
    });
    /* pawns */
    s.seats.forEach((p, i) => {
      const T = tok[i];
      if (!T || !T.at || !world.pos[T.at]) { world.hideToken(i); return; }
      if (!T.seg && T.q.length) {
        const nx = T.q.shift();
        if (!world.pos[nx.to]) { T.at = nx.to; }
        else {
          const walk = (world.adj[T.at] || []).includes(nx.to), hurry = 1 + Math.min(2, T.q.length * 0.6);
          T.seg = { from: T.at, to: nx.to, t0: t, kind: nx.fly ? 'fly' : walk ? 'walk' : 'hop', dur: (nx.fly ? 1.7 : walk ? 0.42 : 0.8) / hurry };
        }
      }
      const g = T.seg;
      if (!g) { if (world.pos[T.at]) world.token(i, world.stand(T.at, i)); }
      else {
        const u = clamp01((t - g.t0) / g.dur);
        if (g.kind === 'walk') world.walk(i, [g.from, g.to], u, i);
        else {
          const a = world.stand(g.from, i).setY(0.16), z = world.stand(g.to, i).setY(0.16), h = g.kind === 'fly' ? 2.6 + a.distanceTo(z) * 0.16 : 1.1, e = u * u * (3 - 2 * u);
          const P = world.arc(a, z, h, e);
          if (g.kind === 'fly' && u < 1) { const d = world.arc(a, z, h, Math.min(1, e + 0.01)).sub(P); world.jet(P, d, Math.sin(e * Math.PI) * -0.35); world.hideToken(i); jetBusy = true; }
          else world.token(i, P.setY(P.y - 0.16));
        }
        if (u >= 1) { T.at = g.to; T.seg = null; }
      }
      if (i === s.cur && !s.over && T.at) { const P = g ? null : world.stand(T.at, i); if (P) world.ring(P, 0.22 + 0.03 * pulse, seatHex(i), 1.6); }
    });
    if (!jetBusy) world.jetParked();
    world.sisyphus(s.sisy, s.sisyActive);
    world.madeGlow(madeK);
    if (s.tuvalu || shieldFlash) world.shield(1, shieldFlash);
    /* camera */
    world.cam(v3(cam.x, 0.3, cam.z), cam.d, EL, 0);
    if (snapNext) { world.snapCamera(); snapNext = false; }
    world.end();
  }

  let raf = 0, prevMs = performance.now();
  const frame = ms => {
    raf = requestAnimationFrame(frame);
    const raw = ms - prevMs, dt = Math.min(0.05, raw / 1000); prevMs = ms;
    if (document.hidden || !world || !root.offsetParent) return;
    world.sample(raw);
    draw(dt);
  };
  update(first);
  raf = requestAnimationFrame(frame);

  return {
    update,
    zoom(f) { const r = canvas && canvas.getBoundingClientRect(); zoomAbout(f, r ? r.left + r.width / 2 : null, r ? r.top + r.height / 2 : null); },
    reset() { cam = { ...fit }; touched = performance.now() / 1000; },
    destroy() {
      dead = true; cancelAnimationFrame(raf);
      if (world) world.destroy();
      root.remove();
    },
  };
}
