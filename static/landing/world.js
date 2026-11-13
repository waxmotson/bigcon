'use strict';
/* landing/world: the stylised 3D evidence board for landing.html.
   Builds every exhibit from the real game data (data.js) as a standing card, strings the
   red threads between them, and exposes an immediate-mode drawing API: each frame a scene
   calls begin(), declares what the board looks like at time t (owners, rubble, tokens,
   props, particles, pop-ups), then end() renders it. Nothing here knows about the rules. */
import * as THREE from 'three';
import { NODES, EDGES, TYPE_COLORS, PCOLORS, CHARS, rebuildWorld } from '../js/data.js';
import { ATLAS } from './atlas.js';

const PX = 0.01;                       // board pixels -> world units
const CW = 1.0, IH = CW * ATLAS.tileH / ATLAS.tileW, LH = 0.17, PAD = 0.04;
const FW = CW + PAD * 2, FH = IH + LH + PAD * 3, LEAN = -0.3;
/* exhibits that get a 3D model beside their card, so the layout leaves them room */
const LANDMARKS = new Set(['qantas', 'sisy', 'made', 'geo_missile', 'geo_tuvalu', 'geo_venice', 'geo_pillars', 'geo_shahed', 'barrels', 'gold']);
export const MOOD_SKY = { CALM: 0x06100f, BOOM: 0x141005, PANIC: 0x200605, FRENZY: 0x140a19 };
const MOOD_THREAD = { CALM: 0xff4a3d, BOOM: 0xffb52e, PANIC: 0xff2a1a, FRENZY: 0xe46bff };

export const rnd = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const clamp01 = v => Math.max(0, Math.min(1, v));
export const sm = (t, a, b) => { const u = clamp01((t - a) / (b - a)); return u * u * (3 - 2 * u); };
export const lerp = (a, b, u) => a + (b - a) * u;

/* ---------- layout: the canonical collage, pushed apart until nothing overlaps ---------- */
function buildLayout() {
  rebuildWorld(true);
  const pts = NODES.map(n => ({ id: n.id, x: n.x, y: n.y }));
  for (let it = 0; it < 400; it++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const A = pts[i], B = pts[j];
      const D = (LANDMARKS.has(A.id) || LANDMARKS.has(B.id)) ? 215 : 172;
      let dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
      if (d >= D) continue;
      if (d < 0.01) { dx = Math.cos(i * 2.4); dy = Math.sin(i * 2.4); d = 1; }
      const p = (D - d) / 2 + 0.5;
      A.x -= dx / d * p; A.y -= dy / d * p * 0.9; B.x += dx / d * p; B.y += dy / d * p * 0.9;
      moved = true;
    }
    for (const p of pts) { p.x = Math.max(-40, Math.min(2440, p.x)); p.y = Math.max(-30, Math.min(1590, p.y)); }
    if (!moved) break;
  }
  const pos = {};
  for (const p of pts) pos[p.id] = new THREE.Vector3((p.x - 1200) * PX, 0, (p.y - 780) * PX);
  /* the DLC pins are only threaded to each other in the canonical data (every real game
     deals fresh threads), so tie any stranded cluster to its nearest neighbour */
  const edges = EDGES.filter(e => pos[e[0]] && pos[e[1]]).map(e => e.slice());
  const adj = {};
  const link = (a, b) => { (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); };
  edges.forEach(e => link(e[0], e[1]));
  for (;;) {
    const seen = new Set(['quik']), q = ['quik'];
    while (q.length) for (const n of adj[q.shift()] || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
    const out = pts.filter(p => !seen.has(p.id));
    if (!out.length) break;
    let best = null;
    for (const o of out) for (const s of seen) {
      const d = pos[o.id].distanceTo(pos[s]);
      if (!best || d < best.d) best = { d, a: o.id, b: s };
    }
    edges.push([best.a, best.b]); link(best.a, best.b);
  }
  return { pos, edges, adj };
}

class Pool {
  constructor(scene, geo, mat, max, shadow) {
    this.m = new THREE.InstancedMesh(geo, mat, max); this.max = max; this.n = 0;
    this.m.frustumCulled = false; this.m.castShadow = !!shadow;
    this.m.setColorAt(0, new THREE.Color(1, 1, 1)); this.m.count = 0;
    scene.add(this.m);
  }
  add(o, c) { if (this.n >= this.max) return; o.updateMatrix(); this.m.setMatrixAt(this.n, o.matrix); this.m.setColorAt(this.n, c); this.n++; }
  flush() { this.m.count = this.n; this.m.instanceMatrix.needsUpdate = true; if (this.m.instanceColor) this.m.instanceColor.needsUpdate = true; this.n = 0; }
}

export async function createWorld({ canvas, overlay }) {
  const { pos, edges, adj } = buildLayout();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const small = Math.min(window.innerWidth, window.innerHeight) < 620;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(MOOD_SKY.CALM);
  scene.fog = new THREE.FogExp2(MOOD_SKY.CALM, 0.021);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);

  const hemi = new THREE.HemisphereLight(0xcfeeea, 0x0a0f0e, 1.15); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(-9, 17, 11); sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 13, bottom: -13, near: 1, far: 50 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  scene.add(sun);

  /* ---------- post: HDR bloom, loaded lazily so a blocked CDN only costs the glow ---------- */
  let composer = null, bloom = null;
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js')]);
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: small ? 0 : 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.62, 0.55, 1.0);
    composer.addPass(bloom); composer.addPass(new OutputPass());
  } catch (e) { composer = null; }

  /* ---------- ground + the board slab ---------- */
  const gc = document.createElement('canvas'); gc.width = gc.height = 256;
  const g2 = gc.getContext('2d');
  g2.fillStyle = '#0b1211'; g2.fillRect(0, 0, 256, 256);
  g2.strokeStyle = 'rgba(47,209,197,.13)'; g2.lineWidth = 2; g2.strokeRect(0, 0, 256, 256);
  g2.strokeStyle = 'rgba(47,209,197,.05)'; g2.lineWidth = 1;
  for (let i = 1; i < 4; i++) { g2.beginPath(); g2.moveTo(i * 64, 0); g2.lineTo(i * 64, 256); g2.moveTo(0, i * 64); g2.lineTo(256, i * 64); g2.stroke(); }
  const gridTex = new THREE.CanvasTexture(gc); gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping; gridTex.repeat.set(60, 60);
  gridTex.colorSpace = THREE.SRGBColorSpace; gridTex.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ map: gridTex, roughness: 0.92, metalness: 0.05 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(27.6, 0.08, 19.2), new THREE.MeshStandardMaterial({ color: 0x101a19, roughness: 0.85 }));
  slab.position.set(0, -0.03, 0.3); slab.receiveShadow = true; scene.add(slab);
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(27.6, 0.02, 19.2)), new THREE.LineBasicMaterial({ color: new THREE.Color(0x2fd1c5).multiplyScalar(1.6) }));
  rim.position.set(0, 0.02, 0.3); scene.add(rim);

  /* ---------- threads ---------- */
  const tp = [];
  for (const [a, b] of edges) {
    const A = pos[a], B = pos[b], dx = B.x - A.x, dz = B.z - A.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * 0.014, nz = dx / l * 0.014, y = 0.03;
    tp.push(A.x - nx, y, A.z - nz, B.x - nx, y, B.z - nz, B.x + nx, y, B.z + nz, A.x - nx, y, A.z - nz, B.x + nx, y, B.z + nz, A.x + nx, y, A.z + nz);
  }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  const threadMat = new THREE.MeshBasicMaterial({ color: 0xff4a3d, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(tg, threadMat));
  const threadCol = new THREE.Color(MOOD_THREAD.CALM), threadWant = new THREE.Color();
  const skyCol = new THREE.Color(MOOD_SKY.CALM), skyWant = new THREE.Color();

  /* ---------- textures ---------- */
  const loader = new THREE.TextureLoader();
  const atlasTex = await new Promise(res => loader.load(new URL('./atlas.webp', import.meta.url).href, res, undefined, () => res(null)));
  if (atlasTex) { atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
  try { await Promise.all([document.fonts.load('700 26px "Bricolage Grotesque"'), document.fonts.load('30px "Tomkins Display"')]); } catch (e) { /* system font */ }
  const LW = 256, LHpx = 44, lc = document.createElement('canvas');
  lc.width = ATLAS.cols * LW; lc.height = Math.ceil(NODES.length / ATLAS.cols) * LHpx;
  const l2 = lc.getContext('2d'); l2.textAlign = 'center'; l2.textBaseline = 'middle';
  NODES.forEach((n, i) => {
    const x = (i % ATLAS.cols) * LW, y = Math.floor(i / ATLAS.cols) * LHpx;
    l2.fillStyle = '#0a0e0d'; l2.fillRect(x, y, LW, LHpx);
    l2.fillStyle = TYPE_COLORS[n.type] || '#168388'; l2.fillRect(x, y + LHpx - 5, LW, 5);
    const name = n.name.join(' ').replace(/[“”"]/g, '');
    let fs = 25; do { l2.font = '700 ' + fs + 'px "Bricolage Grotesque",system-ui,sans-serif'; fs--; } while (l2.measureText(name).width > LW - 14 && fs > 9);
    l2.fillStyle = '#f4f0e6'; l2.fillText(name, x + LW / 2, y + LHpx / 2 - 2);
  });
  const labelTex = new THREE.CanvasTexture(lc); labelTex.colorSpace = THREE.SRGBColorSpace; labelTex.anisotropy = 8;

  const tilePlane = (w, h, u0, v0, u1, v1) => {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0); return g;
  };
  const atlasUV = id => {
    const i = ATLAS.ids.indexOf(id); if (i < 0 || !atlasTex) return null;
    const c = i % ATLAS.cols, r = Math.floor(i / ATLAS.cols), ex = 0.6 / (ATLAS.cols * ATLAS.tileW), ey = 0.6 / (ATLAS.rows * ATLAS.tileH);
    return [c / ATLAS.cols + ex, 1 - (r + 1) / ATLAS.rows + ey, (c + 1) / ATLAS.cols - ex, 1 - r / ATLAS.rows - ey];
  };

  /* ---------- the exhibits ---------- */
  const frameGeo = new THREE.BoxGeometry(FW, FH, 0.05);
  const footGeo = new THREE.BoxGeometry(0.46, 0.07, 0.3);
  const footMat = new THREE.MeshStandardMaterial({ color: 0x1b2524, roughness: 0.7 });
  const ringGeo = new THREE.RingGeometry(0.66, 0.75, 56); ringGeo.rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(0.66, 48); discGeo.rotateX(-Math.PI / 2);
  const pcol = PCOLORS.map(h => new THREE.Color(h));
  const cards = {};
  NODES.forEach((n, i) => {
    const g = new THREE.Group(); g.position.copy(pos[n.id]); g.rotation.y = -(n.rot || 0) * 0.035;
    const tilt = new THREE.Group(); tilt.position.y = 0.07; tilt.rotation.x = LEAN; g.add(tilt);
    const tc = new THREE.Color(TYPE_COLORS[n.type] || '#168388');
    const frameMat = new THREE.MeshStandardMaterial({ color: tc, roughness: 0.55, metalness: 0.1, emissive: tc, emissiveIntensity: 0 });
    const frame = new THREE.Mesh(frameGeo, frameMat); frame.position.y = FH / 2; frame.castShadow = true; tilt.add(frame);
    const uv = atlasUV(n.id);
    const faceMat = new THREE.MeshBasicMaterial(uv ? { map: atlasTex } : { color: tc });
    const face = new THREE.Mesh(uv ? tilePlane(CW, IH, ...uv) : new THREE.PlaneGeometry(CW, IH), faceMat);
    face.position.set(0, PAD * 2 + LH + IH / 2, 0.027); tilt.add(face);
    const lr = Math.floor(i / ATLAS.cols), lcI = i % ATLAS.cols, rows = lc.height / LHpx;
    const labMat = new THREE.MeshBasicMaterial({ map: labelTex });
    const lab = new THREE.Mesh(tilePlane(CW, LH, lcI / ATLAS.cols, 1 - (lr + 1) / rows, (lcI + 1) / ATLAS.cols, 1 - lr / rows), labMat);
    lab.position.set(0, PAD + LH / 2, 0.027); tilt.add(lab);
    const foot = new THREE.Mesh(footGeo, footMat); foot.position.y = 0.035; foot.castShadow = true; g.add(foot);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = 0.035; g.add(ring);
    const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const disc = new THREE.Mesh(discGeo, discMat); disc.position.y = 0.032; g.add(disc);
    scene.add(g);
    cards[n.id] = { n, g, tilt, frameMat, faceMat, labMat, ringMat, discMat, ring, owner: null, shown: -1, ownK: 0, rub: 0, lift: 0, pulse: 0, dOwner: null, dRub: 0, dLift: 0, dPulse: 0 };
  });

  /* ---------- immediate-mode pools ---------- */
  const lit = o => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.75, metalness: 0.05, flatShading: true }, o));
  const add = o => new THREE.MeshBasicMaterial(Object.assign({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }, o));
  const ringG = new THREE.RingGeometry(0.93, 1, 64); ringG.rotateX(-Math.PI / 2);
  const beamG = new THREE.CylinderGeometry(0.12, 1, 1, 28, 1, true); beamG.translate(0, 0.5, 0);
  const coinG = new THREE.CylinderGeometry(1, 1, 0.22, 14); coinG.rotateX(Math.PI / 2);
  const P = {
    box: new Pool(scene, new THREE.BoxGeometry(1, 1, 1), lit({}), 700, true),
    ball: new Pool(scene, new THREE.IcosahedronGeometry(1, 1), lit({}), 700, true),
    coin: new Pool(scene, coinG, lit({ metalness: 0.75, roughness: 0.3, flatShading: false }), 220, true),
    glow: new Pool(scene, new THREE.IcosahedronGeometry(1, 2), add({}), 500),
    gbox: new Pool(scene, new THREE.BoxGeometry(1, 1, 1), add({}), 300),
    ring: new Pool(scene, ringG, add({ side: THREE.DoubleSide }), 80),
    beam: new Pool(scene, beamG, add({ side: THREE.DoubleSide }), 40),
  };
  const O = new THREE.Object3D(), C = new THREE.Color(), V = new THREE.Vector3(), V2 = new THREE.Vector3();
  const col = (hex, k = 1) => C.set(hex).multiplyScalar(k);
  const put = (pool, x, y, z, sx, sy, sz, hex, k, ry = 0, rx = 0, rz = 0) => {
    O.position.set(x, y, z); O.rotation.set(rx, ry, rz); O.scale.set(sx, sy, sz); pool.add(O, col(hex, k));
  };

  /* ---------- unique props ---------- */
  const mesh = (geo, mat, x = 0, y = 0, z = 0, parent = scene) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const white = lit({ color: 0xf2f2ee, flatShading: false, roughness: 0.4 }), red = lit({ color: 0xe0001b, flatShading: false, roughness: 0.45 });
  const dark = lit({ color: 0x1c2222 });
  // the jet (nose along +Z)
  const jet = new THREE.Group(); scene.add(jet);
  { const f = new THREE.CapsuleGeometry(0.105, 0.95, 6, 14); f.rotateX(Math.PI / 2); mesh(f, white, 0, 0, 0, jet);
    const wg = new THREE.BoxGeometry(0.62, 0.025, 0.3);
    const wl = mesh(wg, white, -0.36, -0.02, -0.02, jet); wl.rotation.y = -0.42; const wr = mesh(wg, white, 0.36, -0.02, -0.02, jet); wr.rotation.y = 0.42;
    const tg2 = new THREE.BoxGeometry(0.26, 0.02, 0.14);
    mesh(tg2, white, -0.17, 0.02, -0.52, jet).rotation.y = -0.4; mesh(tg2, white, 0.17, 0.02, -0.52, jet).rotation.y = 0.4;
    const fin = mesh(new THREE.BoxGeometry(0.03, 0.3, 0.26), red, 0, 0.19, -0.5, jet); fin.rotation.x = -0.45;
    const eg = new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10); eg.rotateX(Math.PI / 2);
    for (const x of [-0.27, 0.27, -0.47, 0.47]) mesh(eg, red, x, -0.08, 0.04 - Math.abs(x) * 0.25, jet); }
  // missiles (nose along +Z)
  const missiles = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Group(); scene.add(m); m.visible = false; missiles.push(m);
    const b = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 12); b.rotateX(Math.PI / 2); mesh(b, white, 0, 0, 0, m);
    const band = new THREE.CylinderGeometry(0.063, 0.063, 0.09, 12); band.rotateX(Math.PI / 2); mesh(band, dark, 0, 0, 0.08, m);
    const nose = new THREE.ConeGeometry(0.06, 0.2, 12); nose.rotateX(Math.PI / 2); mesh(nose, red, 0, 0, 0.35, m);
    for (let k = 0; k < 4; k++) { const fn = mesh(new THREE.BoxGeometry(0.2, 0.012, 0.13), dark, 0, 0, -0.2, m); fn.rotation.z = k * Math.PI / 4; }
  }
  // Sisyphus: a hill, a boulder, a small tired figure
  const hillAt = pos.sisy.clone().add(new THREE.Vector3(-0.05, 0, 0.95));
  const HILL = { len: 2.5, h: 1.25 };
  { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(HILL.len, 0); sh.lineTo(HILL.len, HILL.h); sh.closePath();
    const hg = new THREE.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: false }); hg.translate(0, 0, -0.35);
    const hill = mesh(hg, lit({ color: 0xb98a4a }), hillAt.x, 0, hillAt.z); hill.receiveShadow = true; }
  const bg = new THREE.IcosahedronGeometry(0.3, 1);
  { const p = bg.attributes.position; for (let i = 0; i < p.count; i++) { V.fromBufferAttribute(p, i); const k = 1 + (rnd(Math.round(V.x * 31 + V.y * 57 + V.z * 91)) - 0.5) * 0.22; p.setXYZ(i, V.x * k, V.y * k, V.z * k); } bg.computeVertexNormals(); }
  const boulder = mesh(bg, lit({ color: 0x8d7b63 }));
  const pusher = new THREE.Group(); scene.add(pusher);
  { mesh(new THREE.CapsuleGeometry(0.05, 0.16, 4, 8), dark, 0, 0.15, 0, pusher).rotation.z = -0.5; mesh(new THREE.SphereGeometry(0.055, 10, 8), dark, 0.09, 0.3, 0, pusher);
    mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), dark, 0.14, 0.22, 0, pusher).rotation.z = 0.3; mesh(new THREE.BoxGeometry(0.03, 0.16, 0.03), dark, -0.06, 0.05, 0, pusher).rotation.z = 0.5; }
  // MADE: the unexplained purple triangle
  const made = new THREE.Group(); made.position.copy(pos.made).add(new THREE.Vector3(0, 1.75, 0)); scene.add(made);
  const madeGeo = new THREE.ConeGeometry(0.42, 0.62, 3);
  const madeBody = mesh(madeGeo, new THREE.MeshStandardMaterial({ color: 0x12061c, roughness: 0.25, metalness: 0.6, flatShading: true }), 0, 0, 0, made);
  const madeEdgeMat = new THREE.LineBasicMaterial({ color: 0xa13cff });
  made.add(new THREE.LineSegments(new THREE.EdgesGeometry(madeGeo), madeEdgeMat));
  // Missile Command: the silo
  const silo = pos.geo_missile.clone().add(new THREE.Vector3(0.95, 0, 0.3));
  const siloG = new THREE.Group(); siloG.position.copy(silo); scene.add(siloG);
  mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.22, 8), lit({ color: 0x4d5a57 }), 0, 0.11, 0, siloG);
  mesh(new THREE.BoxGeometry(0.05, 0.75, 0.05), lit({ color: 0x7a2a22 }), 0.2, 0.55, 0, siloG);
  // Tuvalu: an island with a palm and (when it matters) a shield
  const isle = pos.geo_tuvalu.clone().add(new THREE.Vector3(0.95, 0, 0.35));
  mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.05, 20), lit({ color: 0x1d8fc4, flatShading: false }), isle.x, 0.03, isle.z);
  mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.1, 9), lit({ color: 0xe8d29a }), isle.x, 0.08, isle.z);
  { const tr = mesh(new THREE.CylinderGeometry(0.022, 0.035, 0.5, 6), lit({ color: 0x7a5a36 }), isle.x + 0.05, 0.36, isle.z); tr.rotation.z = -0.2;
    for (let k = 0; k < 5; k++) { const lf = mesh(new THREE.ConeGeometry(0.06, 0.34, 4), lit({ color: 0x2f9e58 }), isle.x + 0.1 + Math.cos(k * 1.26) * 0.13, 0.6, isle.z + Math.sin(k * 1.26) * 0.13); lf.rotation.set(Math.sin(k * 1.26) * 1.25, 0, -Math.cos(k * 1.26) * 1.25); } }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), add({ color: 0x35e0ff, side: THREE.DoubleSide }));
  dome.position.copy(pos.geo_tuvalu).add(new THREE.Vector3(0.45, 0, 0.15)); scene.add(dome);
  // Venice: a lagoon, a campanile, gondolas (the gondolas are drawn per frame)
  const lagoon = pos.geo_venice.clone().add(new THREE.Vector3(0.9, 0, 0.4));
  mesh(new THREE.CylinderGeometry(0.6, 0.66, 0.04, 22), lit({ color: 0x1f8aa8, flatShading: false, roughness: 0.3 }), lagoon.x, 0.025, lagoon.z);
  mesh(new THREE.BoxGeometry(0.13, 0.62, 0.13), lit({ color: 0xc46a4a }), lagoon.x - 0.2, 0.33, lagoon.z - 0.2);
  mesh(new THREE.ConeGeometry(0.11, 0.2, 4), lit({ color: 0x3f8f7a }), lagoon.x - 0.2, 0.74, lagoon.z - 0.2).rotation.y = Math.PI / 4;
  // ESG pillars: three columns, one of them cardboard
  const pil = pos.geo_pillars.clone().add(new THREE.Vector3(0.92, 0, 0.3));
  [0x7fb24a, 0x7fb24a, 0xb89a6a].forEach((c, k) => mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), lit({ color: c }), pil.x - 0.22 + k * 0.22, 0.27, pil.z));
  mesh(new THREE.BoxGeometry(0.72, 0.05, 0.22), lit({ color: 0xe6a15c }), pil.x, 0.55, pil.z);
  mesh(new THREE.BoxGeometry(0.76, 0.04, 0.26), lit({ color: 0x8ed0e6 }), pil.x, 0.02, pil.z);
  // Shahed drone: a delta wing on a stand
  { const d = pos.geo_shahed.clone().add(new THREE.Vector3(0.9, 0, 0.3)); const dg = new THREE.ConeGeometry(0.3, 0.5, 3); dg.rotateX(Math.PI / 2); dg.scale(1, 0.18, 1);
    mesh(dg, lit({ color: 0xcfd6d8 }), d.x, 0.36, d.z).rotation.y = 0.7; mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.34, 5), dark, d.x, 0.17, d.z); }
  // blue oil barrels, gold coins
  { const b = pos.barrels.clone().add(new THREE.Vector3(0.82, 0, 0.3)); const g = new THREE.CylinderGeometry(0.09, 0.09, 0.24, 10);
    [[0, 0], [0.2, 0.02], [0.1, 0.17]].forEach(([x, z]) => mesh(g, lit({ color: 0x1b8fa3, flatShading: false }), b.x + x, 0.12, b.z + z)); mesh(g, lit({ color: 0x1b8fa3, flatShading: false }), b.x + 0.1, 0.36, b.z + 0.06);
    const c = pos.gold.clone().add(new THREE.Vector3(0.8, 0, 0.32)); const cg = new THREE.CylinderGeometry(0.1, 0.1, 0.035, 14);
    for (let k = 0; k < 7; k++) mesh(cg, lit({ color: 0xf5c542, metalness: 0.8, roughness: 0.3, flatShading: false }), c.x + (k > 3 ? 0.2 : 0), 0.02 + (k % 4) * 0.037, c.z + rnd(k) * 0.03); }
  // regulator vans (nose along +Z), with the agency logo on the side
  const vans = [];
  ['asic', 'accc'].forEach(id => {
    const v = new THREE.Group(); scene.add(v); v.visible = false; vans.push(v);
    mesh(new THREE.BoxGeometry(0.3, 0.26, 0.56), lit({ color: 0xf1f3f2, flatShading: false }), 0, 0.2, -0.04, v);
    mesh(new THREE.BoxGeometry(0.28, 0.16, 0.16), lit({ color: 0x16242c, flatShading: false }), 0, 0.15, 0.3, v);
    for (const [x, z] of [[-0.15, 0.2], [0.15, 0.2], [-0.15, -0.2], [0.15, -0.2]]) { const wh = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10); wh.rotateZ(Math.PI / 2); mesh(wh, dark, x, 0.06, z, v); }
    const uv = atlasUV(id);
    if (uv) for (const s of [-1, 1]) { const d = new THREE.Mesh(tilePlane(0.34, 0.22, ...uv), new THREE.MeshBasicMaterial({ map: atlasTex })); d.position.set(0.152 * s, 0.21, -0.06); d.rotation.y = s * Math.PI / 2; v.add(d); }
  });
  // player pawns + portraits
  const tokens = [];
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Group(); scene.add(t);
    const m = new THREE.MeshStandardMaterial({ color: pcol[i], emissive: pcol[i], emissiveIntensity: 0.45, roughness: 0.35 });
    mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.05, 20), m, 0, 0.025, 0, t);
    mesh(new THREE.CylinderGeometry(0.04, 0.11, 0.24, 16), m, 0, 0.16, 0, t);
    mesh(new THREE.SphereGeometry(0.075, 16, 12), m, 0, 0.32, 0, t);
    const pc = document.createElement('canvas'); pc.width = pc.height = 128;
    const tex = new THREE.CanvasTexture(pc); tex.colorSpace = THREE.SRGBColorSpace;
    const drawFace = img => { const c = pc.getContext('2d'); c.clearRect(0, 0, 128, 128); c.save(); c.beginPath(); c.arc(64, 64, 56, 0, 7); c.closePath(); c.fillStyle = '#0a0e0d'; c.fill(); c.clip();
      if (img) { const s = Math.max(128 / img.width, 128 / img.height); c.drawImage(img, 64 - img.width * s / 2, 64 - img.height * s / 2 + 4, img.width * s, img.height * s); } c.restore();
      c.lineWidth = 9; c.strokeStyle = PCOLORS[i]; c.beginPath(); c.arc(64, 64, 57, 0, 7); c.stroke(); tex.needsUpdate = true; };
    drawFace(null);
    const im = new Image(); im.onload = () => drawFace(im); im.src = './characters/' + CHARS[i].file;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false })); sp.scale.set(0.42, 0.42, 1); sp.position.y = 0.68; t.add(sp);
    tokens.push(t);
  }

  /* ---------- pop-ups (DOM, projected) ---------- */
  const pops = new Map();
  let W = 1, H = 1, shiftX = 0, shiftY = 0, wantShiftX = 0, wantShiftY = 0;
  const cam = { t: new THREE.Vector3(0, 0, 0.5), d: 30, el: 0.9, az: 0 }, want = { t: new THREE.Vector3(0, 0, 0.5), d: 30, el: 0.9, az: 0 };
  let mood = 'CALM', snap = true, clock = 0;

  const w = {
    pos, adj, edges, cards, THREE, camera, HILL, hillAt, silo, isle, lagoon, PCOLORS,
    N: id => pos[id],
    /* where pawn `slot` stands at a node */
    stand(id, slot = 0, out = new THREE.Vector3()) { return out.copy(pos[id]).add(V2.set(-0.36 + slot * 0.24, 0, 0.66)); },
    path(a, b) {
      const prev = { [a]: null }, q = [a];
      while (q.length) { const c = q.shift(); if (c === b) break; for (const n of adj[c] || []) if (!(n in prev)) { prev[n] = c; q.push(n); } }
      const out = []; for (let c = b; c != null; c = prev[c]) out.unshift(c); return out[0] === a ? out : [a, b];
    },
    resize() {
      W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
      renderer.setSize(W, H, false); camera.aspect = W / H;
      if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(W, H); }
      snapShift = true;
    },
    setShift(x, y) { wantShiftX = x; wantShiftY = y; },
    snapCamera() { snap = true; },
    begin(sc, dt) {
      clock += dt; w.dt = dt; w.clock = clock;
      for (const id in cards) { const c = cards[id]; c.dOwner = sc.owners && id in sc.owners ? sc.owners[id] : null; c.dRub = sc.rubble && sc.rubble[id] ? 1 : 0; c.dLift = 0; c.dPulse = 0; }
      for (const m of missiles) m.visible = false; for (const v of vans) v.visible = false;
      jet.visible = false; dome.visible = false; w.sisyphus(0, false); w.madeGlow(0.25);
      tokens.forEach((t, i) => { const at = sc.tokens && sc.tokens[i]; t.visible = !!at; if (at) w.stand(at, i, t.position); });
      for (const p of pops.values()) p.used = false;
      mood = sc.mood || 'CALM';
    },
    own(id, pi) { cards[id].dOwner = pi; }, rubble(id, k = 1) { cards[id].dRub = k; }, lift(id, y) { cards[id].dLift = y; }, pulse(id, k = 1) { cards[id].dPulse = k; },
    mood(m) { mood = m; }, moodNow: () => mood,
    cam(target, d, el, az) { want.t.copy(target); want.d = d + 3.4; want.el = el + 0.13; want.az = az; },
    token(i, p, hop = 0) { const t = tokens[i]; t.visible = true; t.position.set(p.x, hop, p.z); },
    hideToken(i) { tokens[i].visible = false; },
    /* walk pawn i along node ids; u in 0..steps. Returns its position. */
    walk(i, ids, u, slot = i) {
      const k = Math.max(0, Math.min(ids.length - 1.0001, u)), a = Math.floor(k), f = k - a, e = f * f * (3 - 2 * f);
      const A = w.stand(ids[a], slot), B = w.stand(ids[a + 1], slot, new THREE.Vector3());
      const p = A.lerp(B, e); w.token(i, p, Math.sin(f * Math.PI) * 0.42); return p;
    },
    box: (p, sx, sy, sz, hex, ry = 0, rx = 0, rz = 0, k = 1) => put(P.box, p.x, p.y, p.z, sx, sy, sz, hex, k, ry, rx, rz),
    ball: (p, r, hex, k = 1) => put(P.ball, p.x, p.y, p.z, r, r, r, hex, k),
    coin: (p, r, spin = 0) => put(P.coin, p.x, p.y, p.z, r, r, r, 0xf5c542, 1, spin),
    glow: (p, r, hex, k = 1) => { if (k > 0.003 && r > 0) put(P.glow, p.x, p.y, p.z, r, r, r, hex, k); },
    gbox: (p, sx, sy, sz, hex, k = 1, ry = 0) => put(P.gbox, p.x, p.y, p.z, sx, sy, sz, hex, k, ry),
    ring: (p, r, hex, k = 1) => { if (k > 0.003 && r > 0) put(P.ring, p.x, Math.max(0.05, p.y), p.z, r, 1, r, hex, k); },
    beam: (p, r, h, hex, k = 1) => { if (k > 0.003) put(P.beam, p.x, p.y, p.z, r, h, r, hex, k); },
    /* a glowing strip along the ground from a to b, revealed up to u */
    link(a, b, hex, k = 1, u = 1, wd = 0.07) {
      const dx = (b.x - a.x) * u, dz = (b.z - a.z) * u, l = Math.hypot(dx, dz); if (l < 0.01) return;
      put(P.gbox, a.x + dx / 2, 0.05, a.z + dz / 2, wd, 0.02, l, hex, k, Math.atan2(dx, dz));
    },
    arc(a, b, h, u, out = new THREE.Vector3()) { return out.lerpVectors(a, b, u).setY(lerp(a.y, b.y, u) + h * 4 * u * (1 - u)); },
    missile(i, p, dir, flame = 1) {
      const m = missiles[i]; m.visible = true; m.position.copy(p); m.lookAt(V.copy(p).add(dir));
      if (flame > 0) { V.copy(dir).normalize().multiplyScalar(-0.34).add(p); w.glow(V, 0.13 + 0.03 * Math.sin(clock * 40 + i), 0xffa53a, 3.2 * flame); }
    },
    /* a missile flying a->b: u in 0..1; draws the smoke it has left behind. Returns the position. */
    flight(i, a, b, h, u, seed = 0) {
      if (u <= 0 || u >= 1) return null;
      const p = w.arc(a, b, h, u), q = w.arc(a, b, h, Math.min(1, u + 0.01), new THREE.Vector3());
      w.missile(i, p, q.sub(p));
      for (let k = 1; k < 22; k++) {
        const uu = u - k * 0.018; if (uu <= 0) break;
        const s = w.arc(a, b, h, uu, V2), age = k / 22;
        s.x += (rnd(seed * 31 + k + Math.floor(uu * 55)) - 0.5) * 0.1 * age * 3; s.y += age * 0.12;
        put(P.ball, s.x, s.y, s.z, 0.05 + 0.13 * Math.sin(age * Math.PI), 0.05 + 0.13 * Math.sin(age * Math.PI), 0.05 + 0.13 * Math.sin(age * Math.PI), 0xc9cdd0, 1 - age * 0.5);
      }
      return p;
    },
    boom(p, age, s = 1, seed = 0) {
      if (age < 0 || age > 2.6) return;
      w.glow(p.clone().setY(p.y + 0.3), s * (0.35 + age * 2.6), 0xffb24a, 3.5 * Math.max(0, 1 - age / 0.45));
      w.ring(p, s * age * 3.4, 0xff7a3a, 0.7 * Math.max(0, 1 - age / 0.9));
      for (let k = 0; k < 7; k++) {
        const a = rnd(seed + k) * 6.28, r = 0.25 + rnd(seed + k * 3) * 0.5, up = 0.5 + rnd(seed + k * 7) * 1.2;
        V.set(p.x + Math.cos(a) * r * Math.min(1, age * 2.5) * s, p.y + 0.25 + up * age * 0.9 * s, p.z + Math.sin(a) * r * Math.min(1, age * 2.5) * s);
        w.glow(V, s * 0.3 * (1 + age), k % 2 ? 0xff5a1f : 0xffc04a, 2.4 * Math.max(0, 1 - age / 0.8));
        const sz = s * (0.1 + 0.2 * Math.min(1, age * 1.6)) * Math.max(0, 1 - Math.max(0, age - 1.5) / 1.1);
        V.y += 0.2 + age * 0.35; if (sz > 0.01) put(P.ball, V.x, V.y, V.z, sz, sz, sz, 0x3a3f41, 1);
      }
      for (let k = 0; k < 12; k++) {
        const a = rnd(seed + 40 + k) * 6.28, sp = 1.2 + rnd(seed + 60 + k) * 2.4, vy = 2.5 + rnd(seed + 80 + k) * 3;
        const y = p.y + 0.2 + vy * age - 4.9 * age * age; if (y < 0.04) continue;
        put(P.box, p.x + Math.cos(a) * sp * age * s, y, p.z + Math.sin(a) * sp * age * s, 0.09, 0.06, 0.12, k % 3 ? 0x5a6462 : 0xff8a3a, 1, age * 9 + k, age * 7, k);
      }
    },
    jet(p, dir, bank = 0) { jet.visible = true; jet.position.copy(p); jet.lookAt(V.copy(p).add(dir)); jet.rotateZ(bank); },
    jetParked() { jet.visible = true; jet.position.copy(pos.qantas).add(V.set(0.95, 0.16, 0.4)); jet.rotation.set(0, 1.9, 0); },
    /* u: how far up the hill the boulder is (0 = at the bottom) */
    sisyphus(u, active = true) {
      const x = hillAt.x + 0.25 + u * (HILL.len - 0.55), y = (0.25 + u * (HILL.len - 0.55)) / HILL.len * HILL.h, th = Math.atan2(HILL.h, HILL.len);
      boulder.position.set(x - Math.sin(th) * 0.3, y + Math.cos(th) * 0.3, hillAt.z); boulder.rotation.z = -u * 14;
      pusher.visible = active; pusher.position.set(x - 0.46, Math.max(0, y - 0.24), hillAt.z); pusher.rotation.z = th * 0.9;
      return boulder.position;
    },
    madeGlow(k) { made.rotation.y = clock * (0.5 + k * 2.2); made.position.y = 1.75 + Math.sin(clock * 1.7) * 0.06; madeEdgeMat.color.set(0xa13cff).multiplyScalar(0.8 + k * 3.2); madeBody.material.emissive.set(0x5a12a8).multiplyScalar(k); return made.position; },
    van(i, p, heading, flash = 1) {
      const v = vans[i]; v.visible = true; v.position.set(p.x, 0, p.z); v.rotation.y = heading;
      const on = Math.floor(clock * 7) % 2;
      for (const s of [-1, 1]) { V.set(s * 0.09, 0.36, -0.02).applyAxisAngle(V2.set(0, 1, 0), heading).add(v.position); w.glow(V, 0.07, (s > 0) === !!on ? 0xff2a2a : 0x2a6bff, 3.2 * flash); }
    },
    shield(k, flash = 0) { dome.visible = k > 0.01; dome.scale.setScalar(1.25 * k); dome.material.color.set(0x35e0ff).multiplyScalar(0.16 + flash * 1.4 + 0.04 * Math.sin(clock * 3)); },
    /* a floating label over a world position. age drives the rise + fade (dur<=0 = pinned) */
    pop(key, p, text, color = '#fff', age = 0, dur = 1.9, cls = '') {
      if (age < 0 || (dur > 0 && age > dur)) return;
      let e = pops.get(key);
      if (!e) { e = { el: document.createElement('div'), text: '' }; overlay.appendChild(e.el); pops.set(key, e); }
      e.used = true;
      if (e.text !== text + cls) { e.el.className = 'pop ' + cls; e.el.textContent = text; e.text = text + cls; }
      V.copy(p); V.y += 1.25 + (dur > 0 ? age * 0.45 : 0); V.project(camera);
      const o = dur > 0 ? Math.min(1, age * 6) * clamp01((dur - age) * 2.2) : Math.min(1, age * 5);
      const s = 0.82 + 0.18 * Math.min(1, age * 7);
      e.el.style.cssText = 'color:' + color + ';opacity:' + (V.z > 1 ? 0 : o.toFixed(3)) + ';transform:translate(-50%,-50%) translate(' + ((V.x * 0.5 + 0.5) * W).toFixed(1) + 'px,' + ((-V.y * 0.5 + 0.5) * H).toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
    },
    end() {
      const dt = w.dt, k = snap ? 1 : 1 - Math.exp(-dt * 2.6);
      cam.t.lerp(want.t, k); cam.d = lerp(cam.d, want.d, k); cam.el = lerp(cam.el, want.el, k); cam.az = lerp(cam.az, want.az, k);
      const ks = snap || snapShift ? 1 : 1 - Math.exp(-dt * 2); shiftX = lerp(shiftX, wantShiftX, ks); shiftY = lerp(shiftY, wantShiftY, ks);
      snap = false; snapShift = false;
      camera.position.set(cam.t.x + Math.sin(cam.az) * Math.cos(cam.el) * cam.d, cam.t.y + Math.sin(cam.el) * cam.d, cam.t.z + Math.cos(cam.az) * Math.cos(cam.el) * cam.d);
      camera.lookAt(cam.t);
      camera.setViewOffset(W, H, -shiftX * W, -shiftY * H, W, H);
      camera.updateMatrixWorld();
      // mood
      const km = 1 - Math.exp(-dt * 2.2);
      skyCol.lerp(skyWant.set(MOOD_SKY[mood] || MOOD_SKY.CALM), km); scene.background.copy(skyCol); scene.fog.color.copy(skyCol);
      threadCol.lerp(threadWant.set(MOOD_THREAD[mood] || MOOD_THREAD.CALM), km); threadMat.color.copy(threadCol).multiplyScalar(1.05);
      // cards ease toward what the scene declared
      const kc = 1 - Math.exp(-dt * 7);
      for (const id in cards) {
        const c = cards[id];
        if (c.dOwner !== c.owner) { c.owner = c.dOwner; if (c.owner != null) c.shown = c.owner; }
        c.ownK = lerp(c.ownK, c.owner != null && c.dRub < 0.5 ? 1 : 0, kc);
        if (c.ownK > 0.004 && c.shown >= 0) { c.ringMat.color.copy(pcol[c.shown]).multiplyScalar(2.1); c.discMat.color.copy(pcol[c.shown]); }
        c.ringMat.opacity = c.ownK; c.discMat.opacity = c.ownK * 0.22; c.ring.scale.setScalar(1.25 - 0.25 * c.ownK);
        c.rub = lerp(c.rub, c.dRub, kc); c.lift = lerp(c.lift, c.dLift, kc); c.pulse = lerp(c.pulse, c.dPulse, kc);
        c.tilt.rotation.x = lerp(LEAN, -1.47, c.rub); c.tilt.position.y = 0.07 + c.lift; c.tilt.rotation.y = c.lift * 0.9;
        const dim = 1 - c.rub * 0.8; c.faceMat.color.setScalar(0.93 * dim); c.labMat.color.setScalar(dim);
        c.frameMat.emissiveIntensity = c.pulse * 1.6;
        if (c.rub > 0.08) for (let j = 0; j < 9; j++) {
          const a = rnd(j + c.n.x) * 6.28, r = 0.15 + rnd(j * 5 + c.n.y) * 0.5, s = (0.1 + rnd(j * 9) * 0.16) * c.rub;
          put(P.box, c.g.position.x + Math.cos(a) * r, s * 0.4, c.g.position.z + 0.25 + Math.sin(a) * r * 0.7, s * 1.5, s, s * 1.2, j % 4 ? 0x4c5553 : 0x2b3130, 1, a, 0.3 * rnd(j), 0.3 * rnd(j + 2));
        }
      }
      for (const k2 in P) P[k2].flush();
      for (const p of pops.values()) if (!p.used && p.el.style.opacity !== '0') p.el.style.opacity = '0';
      if (composer) composer.render(); else renderer.render(scene, camera);
    },
  };
  let snapShift = true;
  w.resize();
  return w;
}
