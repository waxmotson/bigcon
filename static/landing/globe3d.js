'use strict';
/* landing/globe3d: the Global Edition's 3D board is a GLOBE. board3d.js delegates to mountGlobe() whenever the snapshot
   (boardScene() in static/js/ui.js) says scene.globe. Same contract as the flat board: a plain snapshot in on every repaint,
   taps / hovers / route pins out through callbacks; the rules never know it exists.

   Every node sits at its real latitude/longitude on the sphere (cards stand on the surface, facing outward; crowded cities are
   gently spread apart on the sphere so no two cards overlap), threads are great-circle arcs lifted above the ground (long ones
   arc higher), pawns walk or fly the arcs, and missiles are arcs over the globe. The continents are the same LAND / WATER polygons
   the 2D world map uses, painted on an equirectangular canvas texture. Drag to turn the planet, wheel or pinch to zoom; the
   camera drifts to whoever is up. */
import * as THREE from 'three';
import { LAND, WATER } from '../js/world.js';
import { TYPE_COLORS } from '../js/data.js';

const R = 10;               // globe radius in world units
const CW = 1.0, CH = 1.25;  // a card
const CARD_H = 0.14;        // card plane height above the ground
const THREAD_H = 0.02;      // where a thread meets the ground (hidden under the cards)
const MIN_D = R + 3.4, MAX_D = 72;
const GOLD = 0xf5c542, BLUE = 0x55c1ff, RED = 0xff3b30, PINK = 0xff5e9c, TEAL = 0x7ff6fb;
const BIG = /RAIDED|MONOPOLY|MANIPULATION|BACKFIRE|MISSILE|SEIZED|CLAIMED|REBUILT|SOLD|BLOCKADED|GROUNDED|OVERTOURISM|DIVESTED|PLANTED|STAGE 5|DOSSIER|NO INCOME|FILE/;
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = (t, a, b) => { const u = clamp((t - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const bell = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin((t - a) / (b - a) * Math.PI));
const hex = c => new THREE.Color(c || '#ffffff').getHex();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* unit vector for a latitude / longitude (degrees). lon 0 faces +x; east is to the right seen from outside (matches SphereGeometry's u). */
function dirOf(lat, lon, out = new THREE.Vector3()) {
  const p = lat * D2R, l = (lon + 180) * D2R;
  return out.set(-Math.cos(p) * Math.cos(l), Math.sin(p), Math.cos(p) * Math.sin(l));
}
function slerp(a, b, u, out = new THREE.Vector3()) {
  const w = a.angleTo(b);
  if (w < 1e-5) return out.copy(a);
  const s = Math.sin(w);
  return out.copy(a).multiplyScalar(Math.sin((1 - u) * w) / s).addScaledVector(b, Math.sin(u * w) / s);
}
/* how high a great-circle arc between two nodes rises over the ground: long threads arc much higher */
const liftFor = w => 0.03 + 2.2 * Math.pow(w / Math.PI, 1.5);
function arcPoint(a, b, u, extra = 0, base = THREAD_H) {
  const P = slerp(a, b, u), w = a.angleTo(b);
  return P.multiplyScalar(R + base + (liftFor(w) + extra) * 4 * u * (1 - u));
}
/* east / north / up at a unit direction */
function basisAt(d) {
  const up = d, north = V(0, 1, 0).addScaledVector(d, -d.y);
  if (north.lengthSq() < 1e-6) north.set(0, 0, -1);
  north.normalize();
  return { up, north, east: new THREE.Vector3().crossVectors(north, up) };
}

/* ---------- the planet's texture ---------- */
function earthTexture(renderer) {
  const W = 4096, H = 2048, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = lon => (lon + 180) / 360 * W, Y = lat => (90 - lat) / 180 * H;
  const sea = g.createLinearGradient(0, 0, 0, H); sea.addColorStop(0, '#0a2630'); sea.addColorStop(0.5, '#08202a'); sea.addColorStop(1, '#0a2630');
  g.fillStyle = sea; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(47,209,197,0.16)'; g.lineWidth = 1.5;
  for (let lat = -75; lat <= 75; lat += 15) { g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(W, Y(lat)); g.stroke(); }
  for (let lon = -180; lon < 180; lon += 15) { g.beginPath(); g.moveTo(X(lon), 0); g.lineTo(X(lon), H); g.stroke(); }
  const ring = (r, dx) => { r.forEach((p, i) => { const x = X(p[0]) + dx, y = Y(p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); };
  g.lineJoin = 'round';
  for (const dx of [-W, 0, W]) {
    g.beginPath(); LAND.forEach(r => ring(r, dx));
    g.fillStyle = '#3b524c'; g.fill(); g.fillRect(0, Y(-84), W, H - Y(-84)); g.strokeStyle = '#3fb7ac'; g.lineWidth = 4; g.stroke();
    g.beginPath(); WATER.forEach(r => ring(r, dx));
    g.fillStyle = '#08202a'; g.fill(); g.strokeStyle = '#3fb7ac'; g.lineWidth = 3; g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t;
}

/* ---------- card faces ---------- */
const TW = 120, TH = 150;
function cardTexture(n, fog, renderer) {
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
  const col = TYPE_COLORS[n.type] || '#168388';
  if (fog) {
    g.fillStyle = '#0e1718'; g.fillRect(0, 0, TW, TH);
    g.fillStyle = '#7ff6fb'; g.font = '800 70px system-ui,sans-serif'; g.fillText('?', TW / 2, TH / 2);
  } else {
    const gr = g.createLinearGradient(0, 0, 0, TH * 0.72); gr.addColorStop(0, col); gr.addColorStop(1, '#10171a');
    g.fillStyle = gr; g.fillRect(0, 0, TW, TH * 0.72);
    g.font = '58px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; g.fillStyle = '#fff';
    g.fillText(n.icon || '•', TW / 2, TH * 0.34);
    g.fillStyle = '#0a0e0d'; g.fillRect(0, TH * 0.72, TW, TH * 0.28);
    g.fillStyle = col; g.fillRect(0, TH - 5, TW, 5);
    const words = String(n.name || n.id).replace(/[“”"]/g, '').split(/\s+/), lines = [''];
    let fs = 17; g.font = '700 ' + fs + 'px "Bricolage Grotesque",system-ui,sans-serif';
    for (const w of words) { const t = (lines[lines.length - 1] + ' ' + w).trim(); if (g.measureText(t).width > TW - 10 && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = t; }
    while (lines.length > 2 || lines.some(l => g.measureText(l).width > TW - 8)) { fs--; if (fs < 8) break; g.font = '700 ' + fs + 'px "Bricolage Grotesque",system-ui,sans-serif'; if (lines.length > 2) { lines.splice(2, lines.length, lines.slice(1).join(' ')); } }
    g.fillStyle = '#f4f0e6'; const y0 = TH * 0.72 + (TH * 0.28 - 5) / 2 - (lines.length - 1) * fs * 0.55;
    lines.forEach((l, i) => g.fillText(l, TW / 2, y0 + i * fs * 1.1));
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); return t;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function emojiSprite(ch) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.font = '44px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, 32, 36);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: t, depthWrite: false });
}
function pawnTexture(color, face) {
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d'), t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const paint = img => {
    g.clearRect(0, 0, 96, 96);
    g.fillStyle = '#000'; g.beginPath(); g.arc(48, 48, 46, 0, 7); g.fill();
    g.fillStyle = color || '#fff'; g.beginPath(); g.arc(48, 48, 41, 0, 7); g.fill();
    if (img) { g.save(); g.beginPath(); g.arc(48, 48, 33, 0, 7); g.clip(); g.drawImage(img, 15, 15, 66, 66); g.restore(); }
    else { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(48, 48, 22, 0, 7); g.fill(); }
    t.needsUpdate = true;
  };
  paint(null);
  if (face) { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => paint(im); im.src = face; }
  return t;
}

/* every node's spot on the sphere: its real lat/lon, then a gentle relaxation so crowded cities (Sydney, Europe) fit their cards */
function placeNodes(nodes) {
  const P = nodes.map(n => dirOf(n.lat, n.lon)), home = P.map(p => p.clone());
  const min = 1.34 / R, min2 = min * min, tmp = new THREE.Vector3();
  for (let it = 0; it < 420; it++) {
    const move = P.map(() => new THREE.Vector3());
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const d2 = P[i].distanceToSquared(P[j]);
      if (d2 >= min2) continue;
      const d = Math.sqrt(d2) || 1e-4, push = (min - d) * 0.5;
      tmp.copy(P[i]).sub(P[j]); if (d2 < 1e-10) tmp.set(Math.random() - .5, Math.random() - .5, Math.random() - .5);
      tmp.normalize().multiplyScalar(push); move[i].add(tmp); move[j].sub(tmp);
    }
    for (let i = 0; i < P.length; i++) {
      move[i].addScaledVector(tmp.copy(home[i]).sub(P[i]), 0.012);
      P[i].add(move[i].multiplyScalar(0.9)).normalize();
    }
  }
  return P;
}

/* a thin tube along a polyline, as raw arrays (merged into one mesh) */
function tubeInto(pos, idx, col, pts, rad, color) {
  const n = pts.length, base = pos.length / 3, SIDES = 3;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = b.clone().sub(a).normalize(), up = pts[i].clone().normalize();
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    const nrm = new THREE.Vector3().crossVectors(side, t).normalize();
    for (let k = 0; k < SIDES; k++) {
      const an = k / SIDES * Math.PI * 2, o = side.clone().multiplyScalar(Math.cos(an) * rad).addScaledVector(nrm, Math.sin(an) * rad);
      pos.push(pts[i].x + o.x, pts[i].y + o.y, pts[i].z + o.z); col.push(color.r, color.g, color.b);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < SIDES; k++) {
    const a = base + i * SIDES + k, b = base + i * SIDES + (k + 1) % SIDES, c = a + SIDES, d = b + SIDES;
    idx.push(a, b, c, b, d, c);
  }
}
const tubeMesh = (pos, idx, col, opacity = 1) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity >= 1 }));
  m.frustumCulled = false; return m;
};

/* wrap: the element the board fills. first: the opening boardScene(). api: {tap, hover, pin, unpin, fail} */
export async function mountGlobe(wrap, first, api) {
  const root = document.createElement('div'); root.className = 'b3d-root';
  const canvas = document.createElement('canvas'), overlay = document.createElement('div'), tip = document.createElement('div');
  canvas.tabIndex = -1; overlay.className = 'b3d-pops'; tip.className = 'b3d-tip';
  root.append(canvas, overlay, tip); wrap.appendChild(root);

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); } catch (e) { root.remove(); throw e; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x050c0c, 1);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, 1, 400);
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); scene.add(sun);

  /* the planet, its glow and a few stars */
  const earthTex = earthTexture(renderer);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), new THREE.MeshLambertMaterial({ map: earthTex }));
  scene.add(earth);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 vN;void main(){float i=pow(max(0.,0.62-dot(vN,vec3(0.,0.,1.))),2.6);gl_FragColor=vec4(0.25,0.85,0.8,1.)*i*1.8;}',
  })));
  { const sp = [], rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    for (let i = 0; i < 700; i++) { const u = rnd() * 2 - 1, a = rnd() * 6.283, r = Math.sqrt(1 - u * u); sp.push(Math.cos(a) * r * 190, u * 190, Math.sin(a) * r * 190); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfe9e6, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.7 }))); }

  /* shared bits */
  const glowTex = glowTexture();
  const ringGeo = new THREE.RingGeometry(0.9, 1, 48);
  const ringPool = [], glowPool = [], dynGroup = new THREE.Group(), cardGroup = new THREE.Group(), threadGroup = new THREE.Group();
  scene.add(threadGroup, cardGroup, dynGroup);
  for (let i = 0; i < 200; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })); m.visible = false; scene.add(m); ringPool.push(m);
  }
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); m.visible = false; scene.add(m); glowPool.push(m);
  }
  let ringN = 0, glowN = 0;
  const ring = (P, n, r, color, op) => {
    if (ringN >= ringPool.length) return; const m = ringPool[ringN++];
    m.visible = true; m.position.copy(P); m.quaternion.setFromUnitVectors(V(0, 0, 1), n); m.scale.setScalar(r * 0.72); m.material.color.setHex(color); m.material.opacity = clamp(op, 0, 1);
  };
  const glow = (P, size, color, op) => {
    if (glowN >= glowPool.length) return; const m = glowPool[glowN++];
    m.visible = true; m.position.copy(P); m.scale.setScalar(size); m.material.color.setHex(color); m.material.opacity = clamp(op, 0, 1);
  };
  const badgeMats = {}, badge = ch => badgeMats[ch] || (badgeMats[ch] = emojiSprite(ch));

  /* ---------- state ---------- */
  let sc = first, key = '', edgesKey = '', dead = false, last = null, byId = {}, nodes = {}, adj = {}, dirs = {}, pawns = [], tok = [];
  let fx = [], hold = {}, shownOwner = {}, shownRub = {}, seenFx = new Set(), missileSlot = 0, clock = 0;
  let cam = { lat: -10, lon: 135, dist: 34 }, fitDist = 34, focus = null, touched = -1e9;
  const faces = [], pops = new Map();
  let dynSig = '';

  const fitDistance = () => {
    const a = Math.max(0.3, (canvas.clientWidth || 1) / (canvas.clientHeight || 1)), vh = 18 * D2R, hh = Math.atan(Math.tan(vh) * a);
    return clamp(R / Math.sin(Math.min(vh, hh)) * 1.1, MIN_D + 2, MAX_D);
  };
  const nodePos = id => nodes[id] ? nodes[id].group.position : null;
  const nodeDir = id => dirs[id] || null;
  const toLatLon = d => ({ lat: Math.asin(clamp(d.y, -1, 1)) / D2R, lon: Math.atan2(d.z, -d.x) / D2R - 180 });
  const seatHex = i => hex(sc.seats[i] && sc.seats[i].color);

  /* ---------- build: everything that depends on the layout ---------- */
  function build(s) {
    for (const g of [cardGroup, threadGroup, dynGroup]) while (g.children.length) { const o = g.children.pop(); if (o.geometry) o.geometry.dispose(); }
    for (const id in nodes) { const n = nodes[id]; n.face.material.dispose(); if (n.face.material.map) n.face.material.map.dispose(); n.frame.material.dispose(); }
    for (const t of pawns) { t.material.map.dispose(); t.material.dispose(); }
    nodes = {}; dirs = {}; faces.length = 0; pawns = [];
    const P = placeNodes(s.nodes), faceGeo = new THREE.PlaneGeometry(CW, CH), frameGeo = new THREE.PlaneGeometry(CW + 0.16, CH + 0.16);
    s.nodes.forEach((n, i) => {
      const d = P[i]; dirs[n.id] = d;
      const fr = basisAt(d), g = new THREE.Group();
      g.matrixAutoUpdate = true;
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.east, fr.north, fr.up));
      g.position.copy(d).multiplyScalar(R + CARD_H + (i % 7) * 0.004);
      const face = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map: null })); face.position.z = 0.012; face.userData.id = n.id;
      const frm = new THREE.Mesh(frameGeo, new THREE.MeshBasicMaterial({ color: 0x0a0e0d })); frm.position.z = 0;
      g.add(frm, face); cardGroup.add(g); faces.push(face);
      const bd = new THREE.Sprite(badge('💥')); bd.scale.setScalar(0.55); bd.position.set(0.34, 0.5, 0.1); bd.visible = false; g.add(bd);
      nodes[n.id] = { group: g, face, frame: frm, badge: bd, tex: { known: null, fog: null }, up: fr.up, east: fr.east, north: fr.north };
    });
    /* seats */
    pawns = s.seats.map(p => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pawnTexture(p.color, p.face), depthWrite: false })); sp.scale.setScalar(0.78); sp.center.set(0.5, 0.15); sp.visible = false; sp.renderOrder = 5; scene.add(sp); return sp; });
    tok = s.seats.map(p => ({ at: p.pos, want: p.pos, q: [], seg: null }));
    shownOwner = { ...s.owner }; shownRub = { ...s.rubble }; hold = {}; fx = []; seenFx = new Set(s.fx.map(f => f.id));
    key = s.key; edgesKey = ''; dynSig = ''; last = s;
    byId = {}; for (const n of s.nodes) byId[n.id] = n;
    buildThreads(s);
    fitDist = fitDistance(); cam.dist = fitDist;
    const p = s.seats[s.cur], d = p && p.pos && dirs[p.pos]; if (d) { const ll = toLatLon(d); cam.lat = ll.lat; cam.lon = ll.lon; }
  }
  function buildThreads(s) {
    edgesKey = s.edgesKey; adj = {};
    const pos = [], idx = [], col = [], teal = new THREE.Color(0x1fb3b0), dim = new THREE.Color(0x0e6a6e);
    for (const [a, b] of s.edges) {
      (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a);
      const A = dirs[a], B = dirs[b]; if (!A || !B) continue;
      const w = A.angleTo(B), seg = Math.max(6, Math.ceil(w * 28)), pts = [];
      for (let k = 0; k <= seg; k++) pts.push(arcPoint(A, B, k / seg));
      tubeInto(pos, idx, col, pts, w > 0.5 ? 0.02 : 0.03, w > 0.5 ? dim : teal);
    }
    while (threadGroup.children.length) { const o = threadGroup.children.pop(); o.geometry.dispose(); }
    if (pos.length) threadGroup.add(tubeMesh(pos, idx, col));
  }
  /* the highlighted threads (the moves open to you, the hovered node's links, the pinned route) are rebuilt only when they change */
  function buildDyn(s) {
    const sig = JSON.stringify([s.hot, s.hover, s.path]);
    if (sig === dynSig) return; dynSig = sig;
    while (dynGroup.children.length) { const o = dynGroup.children.pop(); o.geometry.dispose(); o.material.dispose(); }
    const add = (pairs, color, rad, lift) => {
      const pos = [], idx = [], col = [], c = new THREE.Color(color);
      for (const [a, b] of pairs) {
        const A = dirs[a], B = dirs[b]; if (!A || !B) continue;
        const seg = Math.max(6, Math.ceil(A.angleTo(B) * 28)), pts = [];
        for (let k = 0; k <= seg; k++) pts.push(arcPoint(A, B, k / seg, lift, 0.22));
        tubeInto(pos, idx, col, pts, rad, c);
      }
      if (pos.length) dynGroup.add(tubeMesh(pos, idx, col));
    };
    add(s.hot, TEAL, 0.05, 0.02);
    if (s.hover) add(s.hover.links.map(v => [s.hover.id, v]), GOLD, 0.05, 0.03);
    if (s.path && s.path.length > 1) { const pr = []; for (let i = 0; i < s.path.length - 1; i++) pr.push([s.path[i], s.path[i + 1]]); add(pr, PINK, 0.07, 0.05); }
  }

  /* ---------- a new snapshot: work out what just happened ---------- */
  let building = false;
  function update(s) {
    if (dead) return;
    sc = s;
    if (s.key !== key) { build(s); }
    byId = {}; for (const n of s.nodes) byId[n.id] = n;
    if (s.edgesKey !== edgesKey) buildThreads(s);
    const now = clock, prev = last || s;
    const at = (x, y) => { for (const n of s.nodes) if (Math.abs(n.x - x) < 1 && Math.abs(n.y - y) < 1) return n.id; return null; };
    const nearest = (x, y) => { let b = null, bd = 1e9; for (const n of s.nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; b = n; } } return bd < 160 ? b : null; };
    const wasKnown = {}; for (const n of prev.nodes) wasKnown[n.id] = n.known;
    const fresh = s.fx.filter(f => !seenFx.has(f.id));
    fresh.forEach(f => seenFx.add(f.id));
    if (seenFx.size > 400) seenFx = new Set(s.fx.map(f => f.id));
    const flyTo = new Set(); let delay = 0;
    for (const f of fresh) if (f.proj) {
      const from = at(f.x0, f.y0 + 40), to = at(f.x1, f.y1 + 40);
      if (!from || !to || !byId[to].known) continue;
      if (/missile/i.test(f.img || '')) { fx.push({ k: 'missile', t0: now, from, to, slot: missileSlot++ % 6 }); hold[to] = now + 1.25; delay = 1.2; }
      else flyTo.add(to);
    }
    let stagger = 0;
    for (const f of fresh) if (!f.proj) {
      const n = nearest(f.x, f.y + 40); if (!n || !n.known) continue;
      fx.push({ k: 'pop', t0: now + delay + stagger, id: f.id, at: n.id, t: f.t, c: f.c, b: f.b }); stagger += 0.3;
    }
    s.seats.forEach((p, i) => {
      const T = tok[i] || (tok[i] = { at: p.pos, want: p.pos, q: [], seg: null });
      if (p.pos === T.want) return;
      T.want = p.pos;
      if (p.pos == null || T.at == null) { T.at = p.pos; T.q = []; T.seg = null; return; }
      T.q.push({ to: p.pos, fly: flyTo.has(p.pos) });
    });
    for (const n of s.nodes) {
      const id = n.id, was = prev.owner[id], is = s.owner[id];
      if (hold[id] > now || !wasKnown[id]) continue;
      if (is != null && is !== was) fx.push({ k: 'claim', t0: now, id, pi: is });
      else if (is == null && was != null) fx.push({ k: 'lost', t0: now, id });
      if (s.rubble[id] && !prev.rubble[id]) fx.push({ k: 'boom', t0: now, id });
    }
    if (s.cur !== prev.cur || s.turn !== prev.turn) fx.push({ k: 'turn', t0: now + 0.1, pi: s.cur });
    if (s.over && !prev.over) fx.push({ k: 'win', t0: now });
    /* gently drift to whoever is up (unless the viewer has just been steering) */
    const me = s.seats[s.cur], pp = last && last.seats[last.cur];
    if (me && me.pos && dirs[me.pos] && (s.cur !== prev.cur || (pp && pp.pos !== me.pos) || !last) && performance.now() / 1000 - touched > 4) focus = toLatLon(dirs[me.pos]);
    last = s;
  }

  /* ---------- input: drag to turn, wheel / pinch to zoom ---------- */
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height * 2 - 1));
    camera.updateMatrixWorld(); raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects([earth, ...faces], false)[0];
    return hit && hit.object.userData.id ? hit.object.userData.id : null;
  }
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
  let hoverId = null, drag = null, pinch = null;
  const pointers = new Map();
  function setHover(id, e) {
    if (id !== hoverId) { hoverId = id; api.hover && api.hover(id); }
    canvas.classList.toggle('hot', !!(id && byId[id] && byId[id].click));
    if (e) showTip(id, e);
  }
  const steer = () => { touched = performance.now() / 1000; focus = null; };
  const zoomBy = f => { steer(); cam.dist = clamp(cam.dist * f, MIN_D, MAX_D); };
  canvas.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* old browsers */ }
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cd: cam.dist }; drag = null; return; }
    drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) { steer(); cam.dist = clamp(pinch.cd * pinch.d / d, MIN_D, MAX_D); }
      return;
    }
    if (drag) {
      if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) { drag.moved = true; canvas.classList.add('pan'); tip.style.display = 'none'; }
      if (drag.moved) {
        steer();
        const k = 0.26 * clamp((cam.dist - R) / 24, 0.1, 1.3) * (900 / Math.max(450, canvas.clientHeight || 900)); /* degrees per pixel */
        cam.lon -= (e.clientX - drag.lx) * k / Math.max(0.25, Math.cos(cam.lat * D2R)); cam.lat = clamp(cam.lat + (e.clientY - drag.ly) * k, -85, 85);
        cam.lon = ((cam.lon + 540) % 360) - 180;
      }
      drag.lx = e.clientX; drag.ly = e.clientY;
      return;
    }
    if (e.pointerType === 'mouse') setHover(pickable(pick(e.clientX, e.clientY)), e);
  });
  const end = e => {
    const wasPinch = !!pinch;
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
    if (e.type === 'pointerup' && drag && !drag.moved && !wasPinch) {
      const id = pickable(pick(e.clientX, e.clientY));
      if (id) { if (e.pointerType !== 'mouse') setHover(id); api.tap && api.tap(id); } else api.unpin && api.unpin();
    }
    drag = null; canvas.classList.remove('pan');
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !drag) setHover(null, e); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.12 : 0.89); }, { passive: false });
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); const id = pickable(pick(e.clientX, e.clientY)); if (id) api.pin && api.pin(id); else api.unpin && api.unpin(); });

  /* ---------- floating text, projected from the globe ---------- */
  const seenPops = new Set(), proj = new THREE.Vector3();
  function pop(k, P, text, color, age, dur, cls) {
    seenPops.add(k);
    let el = pops.get(k);
    if (!el) { el = document.createElement('div'); el.className = 'pop' + (cls ? ' ' + cls : ''); el.textContent = text; overlay.appendChild(el); pops.set(k, el); }
    proj.copy(P); const facing = proj.clone().normalize().dot(camera.position.clone().normalize());
    proj.project(camera);
    const w = canvas.clientWidth, h = canvas.clientHeight, u = dur > 0 ? age / dur : 0;
    const vis = facing > 0.05 && proj.z < 1;
    el.style.color = color; el.style.opacity = vis ? String(dur > 0 ? Math.min(1, age * 6) * (1 - sm(u, 0.7, 1)) : 1) : '0';
    el.style.transform = 'translate(' + ((proj.x + 1) / 2 * w) + 'px,' + ((1 - proj.y) / 2 * h - 24 - u * 46) + 'px) translate(-50%,-100%)';
  }

  /* ---------- one frame ---------- */
  const faceMap = (n, nd) => {
    const fog = !nd.known, slot = nodes[nd.id] && nodes[nd.id].tex, k = fog ? 'fog' : 'known';
    return slot[k] || (slot[k] = cardTexture(nd, fog, renderer));
  };
  const pawnPos = [];
  function standAt(id, i, out) {
    const n = nodes[id], an = i * 1.9 + 0.7;
    return out.copy(n.group.position).addScaledVector(n.up, 0.14).addScaledVector(n.east, Math.cos(an) * 0.34).addScaledVector(n.north, Math.sin(an) * 0.34 - 0.12);
  }
  function draw(dt) {
    const s = sc, t = clock, pulse = 0.5 + 0.5 * Math.sin(t * 4), now = t;
    for (const id in hold) if (hold[id] <= now) delete hold[id];
    for (const n of s.nodes) if (!hold[n.id]) { shownOwner[n.id] = s.owner[n.id]; shownRub[n.id] = s.rubble[n.id]; }
    ringN = 0; glowN = 0; seenPops.clear();
    buildDyn(s);
    /* camera */
    if (focus && performance.now() / 1000 - touched > 4) {
      const k = 1 - Math.exp(-dt * 2.2);
      let dl = ((focus.lon - cam.lon + 540) % 360) - 180;
      cam.lon += dl * k; cam.lat += (focus.lat - cam.lat) * k;
      if (Math.abs(dl) + Math.abs(focus.lat - cam.lat) < 0.2) focus = null;
    }
    cam.lat = clamp(cam.lat, -85, 85); cam.lon = ((cam.lon + 540) % 360) - 180;
    dirOf(cam.lat, cam.lon, camera.position).multiplyScalar(cam.dist);
    camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0);
    sun.position.copy(camera.position).add(V(-12, 14, 6)); sun.target.position.set(0, 0, 0); sun.target.updateMatrixWorld();
    const cdir = camera.position.clone().normalize();
    const facing = id => nodes[id] && nodes[id].up.dot(cdir) > 0.12;
    /* the cards */
    for (const nd of s.nodes) {
      const N = nodes[nd.id]; if (!N) continue;
      const fm = faceMap(nd, nd); if (N.face.material.map !== fm) { N.face.material.map = fm; N.face.material.needsUpdate = true; }
      const owner = nd.known ? shownOwner[nd.id] : null, rub = nd.known && shownRub[nd.id];
      N.frame.material.color.setHex(owner != null ? seatHex(owner) : 0x0a0e0d);
      N.face.material.color.setHex(rub ? 0x555555 : 0xffffff);
      let b = null;
      if (nd.known) { if (rub) b = '💥'; else if (s.blockades.includes(nd.id)) b = '🚧'; else if (s.qg && nd.id === 'qantas') b = '⛔'; else if (s.ov === nd.id) b = '🛳️'; }
      if (b) { N.badge.material = badge(b); N.badge.visible = true; } else N.badge.visible = false;
      if (!facing(nd.id)) continue;
      const P = N.group.position, up = N.up;
      if (!nd.known) { if (nd.reach) ring(P, up, 0.95, TEAL, 0.7 + 0.4 * pulse); continue; }
      if (nd.target) ring(P, up, 1.0 + 0.05 * pulse, BLUE, 0.8 + 0.2 * pulse);
      else if (nd.reach) ring(P, up, 0.95, 0xffffff, 0.45 + 0.45 * pulse);
      else if (nd.click) ring(P, up, 0.95, GOLD, 0.45 + 0.45 * pulse);
      if (s.bugs[nd.id] != null) glow(P.clone().addScaledVector(N.east, 0.5).addScaledVector(N.north, 0.6).addScaledVector(up, 0.12), 0.45, seatHex(s.bugs[nd.id]), 0.8 + 0.2 * (Math.floor(t * 3) % 2));
    }
    if (s.hover && nodes[s.hover.id]) {
      const H = nodes[s.hover.id]; ring(H.group.position, H.up, 1.1, GOLD, 1);
      for (const v of s.hover.links) if (nodes[v]) ring(nodes[v].group.position, nodes[v].up, 0.95, GOLD, 0.7);
    }
    if (s.path && s.path.length > 1) {
      s.path.forEach((id, i) => { const N = nodes[id]; if (!N) return; ring(N.group.position, N.up, i === 0 || i === s.path.length - 1 ? 1.08 : 0.95, PINK, 1); if (i) pop('ps' + i, N.group.position.clone().addScaledVector(N.up, 0.1), String(i), '#000', 0, 0, 'step'); });
      const last = nodes[s.path[s.path.length - 1]], steps = s.path.length - 1;
      if (last) pop('pst', last.group.position.clone().addScaledVector(last.north, -0.2), steps + (steps === 1 ? ' STEP' : ' STEPS'), '#ff5e9c', 0, 0, 'tag');
    }
    s.blockades.forEach((id, k) => { if (nodes[id] && facing(id)) pop('bk' + k, nodes[id].group.position, '🚧 BLOCKADED', '#f5c542', 0, 0, 'tag'); });
    for (const nd of s.nodes) if (!nd.known && nd.reach && facing(nd.id)) pop('fog' + nd.id, nodes[nd.id].group.position, '?', '#7ff6fb', 0, 0, 'tag');
    /* effects */
    fx = fx.filter(e => {
      const age = now - e.t0; if (age < 0) return true;
      switch (e.k) {
        case 'pop': { const N = nodes[e.at]; if (!N) return false; const dur = e.b ? 2.6 : 1.9; pop('f' + e.id, N.group.position.clone().addScaledVector(N.up, 0.3), e.t, e.c, age, dur, e.b ? 'huge' : BIG.test(e.t) ? 'big' : ''); return age < dur; }
        case 'claim': { const N = nodes[e.id]; if (N && facing(e.id)) { ring(N.group.position, N.up, 0.9 + age * 2.2, seatHex(e.pi), 1 - age / 1.3); } return age < 1.3; }
        case 'lost': { const N = nodes[e.id]; if (N && facing(e.id)) ring(N.group.position, N.up, 0.9 + age * 2, BLUE, 1 - age / 1.3); return age < 1.3; }
        case 'boom': { const N = nodes[e.id]; if (N) { glow(N.group.position.clone().addScaledVector(N.up, 0.4), 2.4 * bell(age, 0, 1.2) + 0.1, 0xff8a3a, bell(age, 0, 1.2)); ring(N.group.position, N.up, 0.6 + age * 2.4, 0xffa53a, 1 - age / 2.2); } return age < 2.2; }
        case 'turn': { const T = pawnPos[e.pi]; if (T && nodes[tok[e.pi].at]) ring(T, nodes[tok[e.pi].at].up, 0.5 + age * 1.6, seatHex(e.pi), 1 - age / 1); return age < 1; }
        case 'missile': {
          const A = dirs[e.from], B = dirs[e.to]; if (!A || !B) return false;
          const u = sm(age, 0.1, 1.2), lift = 1.2 + A.angleTo(B) * 3;
          if (u > 0 && u < 1) for (let k = 0; k < 5; k++) glow(arcPoint(A, B, Math.max(0, u - k * 0.012), lift, 0.5), 0.9 - k * 0.12, k ? 0xff7a2a : 0xffe6a0, 1 - k * 0.17);
          if (age > 1.2) { const N = nodes[e.to]; if (N) { glow(N.group.position.clone().addScaledVector(N.up, 0.4), 2.8 * bell(age, 1.2, 2.4), 0xff8a3a, bell(age, 1.2, 2.4)); ring(N.group.position, N.up, 0.7 + (age - 1.2) * 2.6, 0xffa53a, 1 - (age - 1.2) / 1.2); } }
          return age < 2.5;
        }
        case 'win': {
          const i = s.winner != null ? s.winner : s.cur, p = pawnPos[i];
          if (p) for (let k = 0; k < 14; k++) { const a = (age * 0.8 + k * 0.4) % 3; glow(p.clone().multiplyScalar(1 + a * 0.05).add(V(Math.sin(k * 2.3) * a * 0.8, Math.cos(k * 1.7) * a * 0.8, Math.sin(k) * a * 0.8)), 0.4, GOLD, 1 - a / 3); }
          return age < 8;
        }
      }
      return false;
    });
    /* pawns */
    const tmp = new THREE.Vector3();
    s.seats.forEach((p, i) => {
      const T = tok[i], sp = pawns[i];
      if (!T || !T.at || !nodes[T.at] || !sp) { if (sp) sp.visible = false; pawnPos[i] = null; return; }
      if (!T.seg && T.q.length) {
        const nx = T.q.shift();
        if (!nodes[nx.to]) T.at = nx.to;
        else {
          const walk = (adj[T.at] || []).includes(nx.to), hurry = 1 + Math.min(2, T.q.length * 0.6), w = dirs[T.at].angleTo(dirs[nx.to]);
          T.seg = { from: T.at, to: nx.to, t0: t, kind: nx.fly ? 'fly' : walk ? 'walk' : 'hop', dur: (nx.fly ? 1.6 + w * 1.4 : walk ? 0.3 + w * 1.2 : 0.7 + w * 0.8) / hurry };
        }
      }
      const g = T.seg; let P = standAt(T.at, i, new THREE.Vector3()), flying = false;
      if (g) {
        const u = clamp((t - g.t0) / g.dur, 0, 1), e = u * u * (3 - 2 * u);
        const a = standAt(g.from, i, new THREE.Vector3()), z = standAt(g.to, i, new THREE.Vector3());
        const w = dirs[g.from].angleTo(dirs[g.to]);
        const da = a.clone().normalize(), dz = z.clone().normalize(), lift = g.kind === 'walk' ? liftFor(w) * 0.9 : g.kind === 'fly' ? liftFor(w) * 1.6 + 1 : 0.9 + liftFor(w);
        P = slerp(da, dz, e).multiplyScalar(R + 0.2 + lift * 4 * e * (1 - e));
        if (g.kind === 'fly' && u < 1) { flying = true; glow(P, 1.2, 0xffffff, 0.35); }
        if (u >= 1) { T.at = g.to; T.seg = null; }
      }
      pawnPos[i] = P.clone();
      sp.visible = true; sp.position.copy(P); sp.scale.setScalar(flying ? 0.95 : 0.78);
      if (i === s.cur && !s.over && !g) ring(P.clone().addScaledVector(nodes[T.at].up, -0.12), nodes[T.at].up, 0.34 + 0.04 * pulse, seatHex(i), 1);
    });
    /* sweep */
    for (let i = ringN; i < ringPool.length; i++) if (ringPool[i].visible) ringPool[i].visible = false; else break;
    for (let i = glowN; i < glowPool.length; i++) if (glowPool[i].visible) glowPool[i].visible = false; else break;
    for (const [k, el] of pops) if (!seenPops.has(k)) { el.remove(); pops.delete(k); }
  }

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); const f = fitDistance(); if (Math.abs(cam.dist - fitDist) < 0.01) cam.dist = f; fitDist = f; }
    return true;
  };

  build(first); update(first);
  fitDist = fitDistance(); cam.dist = fitDist;
  let raf = 0, prevMs = performance.now();
  const frame = ms => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ms - prevMs) / 1000); prevMs = ms;
    if (document.hidden || !root.offsetParent || !resize()) return;
    clock += dt;
    draw(dt);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    update,
    zoom(f) { zoomBy(f); },
    reset() { cam.dist = fitDist; touched = -1e9; const p = sc.seats[sc.cur]; if (p && p.pos && dirs[p.pos]) focus = toLatLon(dirs[p.pos]); },
    destroy() {
      dead = true; cancelAnimationFrame(raf);
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
      renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
      root.remove();
    },
  };
}
