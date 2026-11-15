'use strict';
/* landing/world: the stylised 3D evidence board for landing.html.
   Builds every exhibit from the real game data (data.js) as a standing card, strings the
   red threads between them, and exposes an immediate-mode drawing API: each frame a scene
   calls begin(), declares what the board looks like at time t (owners, rubble, tokens,
   props, particles, pop-ups), then end() renders it. Nothing here knows about the rules.

   Performance notes — the whole frame is a few dozen draw calls:
   · the 82 cards are five InstancedMeshes (frame, face, foot, owner ring, owner disc); each
     card's picture and name are baked into one canvas texture and a per-instance uvRect
     picks the tile;
   · static props are merged into three vertex-coloured meshes, moving props are one mesh each;
   · particles go through instanced pools that only upload the instances in use;
   · resolution adapts: it starts at ≤1.5× pixel ratio and steps down (then uses
     a smaller shadow map, then bloom) if frames run slow — see sample(). `?q=0..5` pins a tier. */
import * as THREE from 'three';
import { NMAP, TYPE_COLORS, PCOLORS, CHARS } from '../js/data.js';
import { buildLayout } from './layout.js';
import { ATLAS } from './atlas.js';

const CW = 1.0, IH = CW * ATLAS.tileH / ATLAS.tileW, LH = 0.17, PAD = 0.04;
const FW = CW + PAD * 2, FH = IH + LH + PAD * 2, LEAN = -0.3;
const LBL = Math.round(ATLAS.tileW * LH / CW);   // label strip height in texture pixels
export const MOOD_SKY = { CALM: 0x06100f, BOOM: 0x141005, PANIC: 0x200605, FRENZY: 0x140a19 };
const MOOD_THREAD = { CALM: 0xff4a3d, BOOM: 0xffb52e, PANIC: 0xff2a1a, FRENZY: 0xe46bff };
/* quality tiers, best first; the effective pixel ratio is also capped by the device's.
   Nothing here switches a shader feature on or off, so changing tier never recompiles. */
const TIERS = [
  { dpr: 2, shadow: 2048, bloom: true },
  { dpr: 1.5, shadow: 2048, bloom: true },
  { dpr: 1.25, shadow: 2048, bloom: true },
  { dpr: 1, shadow: 2048, bloom: true },
  { dpr: 0.85, shadow: 1024, bloom: true },
  { dpr: 0.7, shadow: 1024, bloom: false },
];

export const rnd = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const clamp01 = v => Math.max(0, Math.min(1, v));
export const sm = (t, a, b) => { const u = clamp01((t - a) / (b - a)); return u * u * (3 - 2 * u); };
export const lerp = (a, b, u) => a + (b - a) * u;

/* ---------- the board: the landing pages' fixed collage (see layout.js) unless the caller
   passes a live one ({nodes:[{id,x,y,rot,type,name}], edges, bounds}) in board pixels ---------- */
function defaultBoard() {
  const { pts, edges } = buildLayout();
  return { nodes: pts.map(p => ({ ...p, type: NMAP[p.id].type, name: NMAP[p.id].name.join(' ') })), edges, bounds: { x: 0, y: 0, w: 2400, h: 1560 } };
}

/* ---------- geometry baking: many small parts -> one vertex-coloured geometry ---------- */
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _c = new THREE.Color();
function bake(parts) {
  const vp = [], nor = [], col = [];
  for (const { g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, c = 0xffffff } of parts) {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    geo.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s));
    const P = geo.attributes.position, Nn = geo.attributes.normal;
    _c.set(c);
    for (let i = 0; i < P.count; i++) { vp.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i)); col.push(_c.r, _c.g, _c.b); }
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

class Pool {
  constructor(scene, geo, mat, max, shadow) {
    this.m = new THREE.InstancedMesh(geo, mat, max); this.n = 0; this.max = max;
    this.m.frustumCulled = false; this.m.castShadow = !!shadow;
    this.m.setColorAt(0, new THREE.Color(1, 1, 1)); this.m.count = 0; this.m.visible = false;
    scene.add(this.m);
  }
  add(o, c) { if (this.n >= this.max) return; o.updateMatrix(); this.m.setMatrixAt(this.n, o.matrix); this.m.setColorAt(this.n, c); this.n++; }
  flush() {
    const m = this.m, n = this.n;
    m.count = n; m.visible = n > 0; this.n = 0;
    if (!n) return;
    m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, n * 16); m.instanceMatrix.needsUpdate = true;
    m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, n * 3); m.instanceColor.needsUpdate = true;
  }
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE3 = new THREE.Color(0xffffff);
const CROWD = [0xff6b5e, 0x55c1ff, 0xf5c542, 0x7fe08d, 0xe19bff, 0xffffff, 0xffa94d];

/* board: see defaultBoard(). seats: [{color, face}] (face = image URL or null). px: world units per board pixel.
   props: false leaves out the landmark models (they would give away where fog-of-war cards stand). */
export async function createWorld({ canvas, overlay, quality = null, board = null, seats = null, px = 0.01, props = true }) {
  board = board || defaultBoard();
  seats = seats || [0, 1, 2, 3].map(i => ({ color: PCOLORS[i], face: './characters/' + CHARS[i].file }));
  const BN = board.nodes, BB = board.bounds, bcx = BB.x + BB.w / 2, bcy = BB.y + BB.h / 2;
  const toW = (x, y, out = new THREE.Vector3()) => out.set((x - bcx) * px, 0, (y - bcy) * px);
  const pos = {};
  for (const n of BN) pos[n.id] = toW(n.x, n.y);
  let edges = [], adj = {};
  const setGraph = list => {
    edges = list.filter(e => pos[e[0]] && pos[e[1]]).map(e => [e[0], e[1]]); adj = {};
    for (const [a, b] of edges) { (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); }
  };
  setGraph(board.edges || []);
  /* the slab, and how much bigger than the landing board this one is */
  const SW = BB.w * px + 3.6, SH = BB.h * px + 3.6, SC = Math.max(1, SW / 27.6, SH / 19.2);
  const small = Math.min(window.innerWidth, window.innerHeight) < 620;
  const devDpr = window.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(MOOD_SKY.CALM);
  scene.fog = new THREE.FogExp2(MOOD_SKY.CALM, 0.021 / SC);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200 * SC);

  const hemi = new THREE.HemisphereLight(0xcfeeea, 0x0a0f0e, 1.15); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(-9 * SC, 17 * SC, 11 * SC); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -(SW / 2 + 3.2), right: SW / 2 + 3.2, top: SH / 2 + 3.4, bottom: -(SH / 2 + 3.4), near: 1, far: 50 * SC });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  scene.add(sun);

  /* ---------- post: HDR bloom, loaded lazily so a blocked CDN only costs the glow ---------- */
  let composer = null, bloom = null;
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js')]);
    /* MSAA only where the pixels are big enough to need it */
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: !small && devDpr < 1.5 ? 4 : 0 });
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
  gridTex.colorSpace = THREE.SRGBColorSpace; gridTex.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshLambertMaterial({ map: gridTex }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(SW, 0.08, SH), new THREE.MeshStandardMaterial({ color: 0x101a19, roughness: 0.85 }));
  slab.position.set(0, -0.03, 0.3); slab.receiveShadow = true; scene.add(slab);
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(SW, 0.02, SH)), new THREE.LineBasicMaterial({ color: new THREE.Color(0x2fd1c5).multiplyScalar(1.6) }));
  rim.position.set(0, 0.02, 0.3); scene.add(rim);

  /* ---------- threads ---------- */
  const threadGeo = () => {
    const tp = [];
    for (const [a, b] of edges) {
      const A = pos[a], B = pos[b], dx = B.x - A.x, dz = B.z - A.z, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * 0.014, nz = dx / l * 0.014, y = 0.03;
      tp.push(A.x - nx, y, A.z - nz, B.x - nx, y, B.z - nz, B.x + nx, y, B.z + nz, A.x - nx, y, A.z - nz, B.x + nx, y, B.z + nz, A.x + nx, y, A.z + nz);
    }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3)); return tg;
  };
  const threadMat = new THREE.MeshBasicMaterial({ color: 0xff4a3d, side: THREE.DoubleSide });
  const threads = new THREE.Mesh(threadGeo(), threadMat); threads.frustumCulled = false;
  scene.add(threads);
  const threadCol = new THREE.Color(MOOD_THREAD.CALM), threadWant = new THREE.Color();
  const skyCol = new THREE.Color(MOOD_SKY.CALM), skyWant = new THREE.Color();

  /* ---------- the card texture: every exhibit's picture with its name strip underneath ---------- */
  const atlasImg = await new Promise(res => new THREE.ImageLoader().load(new URL('./atlas.webp', import.meta.url).href, res, undefined, () => res(null)));
  try { await Promise.all([document.fonts.load('700 26px "Bricolage Grotesque"'), document.fonts.load('30px "Tomkins Display"')]); } catch (e) { /* system font */ }
  const TW = ATLAS.tileW, TH = ATLAS.tileH, CHp = TH + LBL, COLS = ATLAS.cols, ROWS = Math.ceil(BN.length / COLS);
  const cc = document.createElement('canvas'); cc.width = COLS * TW; cc.height = ROWS * CHp;
  const c2 = cc.getContext('2d'); c2.textAlign = 'center'; c2.textBaseline = 'middle';
  BN.forEach((n, i) => {
    const x = (i % COLS) * TW, y = Math.floor(i / COLS) * CHp, ai = ATLAS.ids.indexOf(n.id);
    if (atlasImg && ai >= 0) c2.drawImage(atlasImg, (ai % COLS) * TW, Math.floor(ai / COLS) * TH, TW, TH, x, y, TW, TH);
    else { c2.fillStyle = TYPE_COLORS[n.type] || '#168388'; c2.fillRect(x, y, TW, TH); }
    c2.fillStyle = '#0a0e0d'; c2.fillRect(x, y + TH, TW, LBL);
    c2.fillStyle = TYPE_COLORS[n.type] || '#168388'; c2.fillRect(x, y + CHp - 5, TW, 5);
    const name = String(n.name || n.id).replace(/[“”"]/g, '');
    let fs = 25; do { c2.font = '700 ' + fs + 'px "Bricolage Grotesque",system-ui,sans-serif'; fs--; } while (c2.measureText(name).width > TW - 14 && fs > 9);
    c2.fillStyle = '#f4f0e6'; c2.fillText(name, x + TW / 2, y + TH + LBL / 2 - 2);
  });
  const cardTex = new THREE.CanvasTexture(cc); cardTex.colorSpace = THREE.SRGBColorSpace; cardTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const idx = Object.fromEntries(BN.map((n, i) => [n.id, i]));
  /* [u0, v0, u1, v1] of a card's tile (or just its picture) in cardTex */
  const cardUV = (id, imageOnly) => {
    const i = idx[id], c = i % COLS, r = Math.floor(i / COLS), ex = 0.6 / cc.width, ey = 0.6 / cc.height;
    const top = 1 - r * CHp / cc.height, bot = 1 - (r * CHp + (imageOnly ? TH : CHp)) / cc.height;
    return [c * TW / cc.width + ex, bot + ey, (c + 1) * TW / cc.width - ex, top - ey];
  };
  const tilePlane = (w, h, u0, v0, u1, v1) => {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0); return g;
  };

  /* ---------- the exhibits: five instanced meshes for all 82 cards ---------- */
  const N = BN.length, pcol = seats.map(s => new THREE.Color(s.color || '#ffffff'));
  const frameGeo = new THREE.BoxGeometry(FW, FH, 0.05);
  const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1); glowAttr.setUsage(THREE.DynamicDrawUsage);
  frameGeo.setAttribute('glow', glowAttr);
  const frameMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 });
  frameMat.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float glow;\nvarying float vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlow = glow;');
    sh.fragmentShader = 'varying float vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor * vGlow;');
  };
  frameMat.customProgramCacheKey = () => 'card-frame';
  const frames = new THREE.InstancedMesh(frameGeo, frameMat, N);
  const faceGeo = new THREE.PlaneGeometry(CW, IH + LH);
  const uvRect = new Float32Array(N * 4);
  BN.forEach((n, i) => { const [u0, v0, u1, v1] = cardUV(n.id); uvRect.set([u0, v0, u1 - u0, v1 - v0], i * 4); });
  faceGeo.setAttribute('uvRect', new THREE.InstancedBufferAttribute(uvRect, 4));
  const faceMat = new THREE.MeshBasicMaterial({ map: cardTex });
  faceMat.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec4 uvRect;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv = uvRect.xy + uv * uvRect.zw;');
  };
  faceMat.customProgramCacheKey = () => 'card-face';
  const faces = new THREE.InstancedMesh(faceGeo, faceMat, N);
  const feet = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.07, 0.3), new THREE.MeshStandardMaterial({ color: 0x1b2524, roughness: 0.7 }), N);
  const addBlend = { blending: THREE.AdditiveBlending, depthWrite: false, transparent: true };
  const ringGeo = new THREE.RingGeometry(0.66, 0.75, 56); ringGeo.rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(0.66, 48); discGeo.rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial(addBlend), N);
  const discs = new THREE.InstancedMesh(discGeo, new THREE.MeshBasicMaterial(addBlend), N);
  frames.castShadow = feet.castShadow = true;
  for (const m of [frames, faces, feet, rings, discs]) { m.frustumCulled = false; m.setColorAt(0, _c.set(0xffffff)); scene.add(m); }
  rings.count = discs.count = 0; rings.visible = discs.visible = false;
  frames.instanceMatrix.setUsage(THREE.DynamicDrawUsage); faces.instanceMatrix.setUsage(THREE.DynamicDrawUsage); feet.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const L_FRAME = new THREE.Matrix4().makeTranslation(0, FH / 2, 0);
  const L_FACE = new THREE.Matrix4().makeTranslation(0, PAD + (IH + LH) / 2, 0.027);
  const L_FOOT = new THREE.Matrix4().makeTranslation(0, 0.035, 0);
  const M2 = new THREE.Matrix4();
  const cards = {}, cardList = [];
  BN.forEach((n, i) => {
    const G = new THREE.Matrix4().compose(pos[n.id], _q.setFromEuler(_e.set(0, -(n.rot || 0) * 0.035, 0)), _s);
    frames.setColorAt(i, _c.set(TYPE_COLORS[n.type] || '#168388'));
    const F = new THREE.Matrix4().multiplyMatrices(G, L_FOOT); feet.setMatrixAt(i, F);
    const c = { n, i, G, F, p: pos[n.id], owner: null, shown: -1, ownK: 0, rub: 0, lift: 0, pulse: 0, dOwner: null, dRub: 0, dLift: 0, dPulse: 0, dHide: 0, hidden: 0 };
    cards[n.id] = c; cardList.push(c);
  });
  feet.instanceMatrix.needsUpdate = true;

  /* ---------- immediate-mode pools ---------- */
  const lit = o => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.75, metalness: 0.05, flatShading: true }, o));
  const add = o => new THREE.MeshBasicMaterial(Object.assign({}, addBlend, o));
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

  /* ---------- props ---------- */
  const matteVC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, flatShading: true });
  const smoothVC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05 });
  const metalVC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.8 });
  const solid = (geo, mat, parent = scene) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m; };
  const WHITE = 0xf2f2ee, RED = 0xe0001b, DARK = 0x1c2222;
  const rotX = g => { g.rotateX(Math.PI / 2); return g; };
  // the jet (nose along +Z)
  const jet = solid(bake([
    { g: rotX(new THREE.CapsuleGeometry(0.105, 0.95, 6, 14)), c: WHITE },
    { g: new THREE.BoxGeometry(0.62, 0.025, 0.3), x: -0.36, y: -0.02, z: -0.02, ry: -0.42, c: WHITE },
    { g: new THREE.BoxGeometry(0.62, 0.025, 0.3), x: 0.36, y: -0.02, z: -0.02, ry: 0.42, c: WHITE },
    { g: new THREE.BoxGeometry(0.26, 0.02, 0.14), x: -0.17, y: 0.02, z: -0.52, ry: -0.4, c: WHITE },
    { g: new THREE.BoxGeometry(0.26, 0.02, 0.14), x: 0.17, y: 0.02, z: -0.52, ry: 0.4, c: WHITE },
    { g: new THREE.BoxGeometry(0.03, 0.3, 0.26), y: 0.19, z: -0.5, rx: -0.45, c: RED },
    ...[-0.27, 0.27, -0.47, 0.47].map(x => ({ g: rotX(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10)), x, y: -0.08, z: 0.04 - Math.abs(x) * 0.25, c: RED })),
  ]), smoothVC);
  // missiles (nose along +Z)
  const missileGeo = bake([
    { g: rotX(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 12)), c: WHITE },
    { g: rotX(new THREE.CylinderGeometry(0.063, 0.063, 0.09, 12)), z: 0.08, c: DARK },
    { g: rotX(new THREE.ConeGeometry(0.06, 0.2, 12)), z: 0.35, c: RED },
    ...[0, 1, 2, 3].map(k => ({ g: new THREE.BoxGeometry(0.2, 0.012, 0.13), z: -0.2, rz: k * Math.PI / 4, c: DARK })),
  ]);
  const missiles = [0, 1, 2, 3, 4, 5].map(() => { const m = solid(missileGeo, smoothVC); m.visible = false; return m; });
  // Sisyphus: a hill, a boulder, a small tired figure. Every landmark is optional: a board
  // without that exhibit (no Geography DLC) simply doesn't build it.
  const near = (id, x, z) => props && pos[id] ? pos[id].clone().add(new THREE.Vector3(x, 0, z)) : null;
  const hillAt = near('sisy', -0.05, 0.95);
  const HILL = { len: 2.5, h: 1.25 };
  const statics = { matte: [], smooth: [], metal: [] };
  if (hillAt) { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(HILL.len, 0); sh.lineTo(HILL.len, HILL.h); sh.closePath();
    const hg = new THREE.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: false }); hg.translate(0, 0, -0.35);
    statics.matte.push({ g: hg, x: hillAt.x, z: hillAt.z, c: 0xb98a4a }); }
  const bg = new THREE.IcosahedronGeometry(0.3, 1);
  { const p = bg.attributes.position; for (let i = 0; i < p.count; i++) { V.fromBufferAttribute(p, i); const k = 1 + (rnd(Math.round(V.x * 31 + V.y * 57 + V.z * 91)) - 0.5) * 0.22; p.setXYZ(i, V.x * k, V.y * k, V.z * k); } bg.computeVertexNormals(); }
  const boulder = solid(bg, lit({ color: 0x8d7b63 }));
  const pusher = solid(bake([
    { g: new THREE.CapsuleGeometry(0.05, 0.16, 4, 8), y: 0.15, rz: -0.5, c: DARK },
    { g: new THREE.SphereGeometry(0.055, 10, 8), x: 0.09, y: 0.3, c: DARK },
    { g: new THREE.BoxGeometry(0.2, 0.03, 0.03), x: 0.14, y: 0.22, rz: 0.3, c: DARK },
    { g: new THREE.BoxGeometry(0.03, 0.16, 0.03), x: -0.06, y: 0.05, rz: 0.5, c: DARK },
  ]), matteVC);
  // MADE: the unexplained purple triangle
  const made = new THREE.Group(); if (pos.made) made.position.copy(pos.made); made.position.y = 1.75; made.visible = props && !!pos.made; scene.add(made);
  const madeGeo = new THREE.ConeGeometry(0.42, 0.62, 3);
  const madeBody = solid(madeGeo, new THREE.MeshStandardMaterial({ color: 0x12061c, roughness: 0.25, metalness: 0.6, flatShading: true }), made);
  const madeEdgeMat = new THREE.LineBasicMaterial({ color: 0xa13cff });
  made.add(new THREE.LineSegments(new THREE.EdgesGeometry(madeGeo), madeEdgeMat));
  // Missile Command: the silo
  const silo = near('geo_missile', 0.95, 0.3);
  if (silo) statics.matte.push({ g: new THREE.CylinderGeometry(0.3, 0.36, 0.22, 8), x: silo.x, y: 0.11, z: silo.z, c: 0x4d5a57 },
    { g: new THREE.BoxGeometry(0.05, 0.75, 0.05), x: silo.x + 0.2, y: 0.55, z: silo.z, c: 0x7a2a22 });
  // Tuvalu: an island with a palm and (when it matters) a shield
  const isle = near('geo_tuvalu', 0.95, 0.35);
  if (isle) statics.smooth.push({ g: new THREE.CylinderGeometry(0.62, 0.72, 0.05, 20), x: isle.x, y: 0.03, z: isle.z, c: 0x1d8fc4 });
  if (isle) statics.matte.push({ g: new THREE.CylinderGeometry(0.34, 0.46, 0.1, 9), x: isle.x, y: 0.08, z: isle.z, c: 0xe8d29a },
    { g: new THREE.CylinderGeometry(0.022, 0.035, 0.5, 6), x: isle.x + 0.05, y: 0.36, z: isle.z, rz: -0.2, c: 0x7a5a36 },
    ...[0, 1, 2, 3, 4].map(k => ({ g: new THREE.ConeGeometry(0.06, 0.34, 4), x: isle.x + 0.1 + Math.cos(k * 1.26) * 0.13, y: 0.6, z: isle.z + Math.sin(k * 1.26) * 0.13, rx: Math.sin(k * 1.26) * 1.25, rz: -Math.cos(k * 1.26) * 1.25, c: 0x2f9e58 })));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), add({ color: 0x35e0ff, side: THREE.DoubleSide }));
  if (pos.geo_tuvalu) dome.position.copy(pos.geo_tuvalu).add(new THREE.Vector3(0.45, 0, 0.15)); scene.add(dome);
  // Venice: a lagoon, a campanile, gondolas (the gondolas are drawn per frame)
  const lagoon = near('geo_venice', 0.9, 0.4);
  if (lagoon) statics.smooth.push({ g: new THREE.CylinderGeometry(0.6, 0.66, 0.04, 22), x: lagoon.x, y: 0.025, z: lagoon.z, c: 0x1f8aa8 });
  if (lagoon) statics.matte.push({ g: new THREE.BoxGeometry(0.13, 0.62, 0.13), x: lagoon.x - 0.2, y: 0.33, z: lagoon.z - 0.2, c: 0xc46a4a },
    { g: new THREE.ConeGeometry(0.11, 0.2, 4), x: lagoon.x - 0.2, y: 0.74, z: lagoon.z - 0.2, ry: Math.PI / 4, c: 0x3f8f7a });
  // ESG pillars: three columns, one of them cardboard
  const pil = near('geo_pillars', 0.92, 0.3);
  if (pil) statics.matte.push(...[0x7fb24a, 0x7fb24a, 0xb89a6a].map((c, k) => ({ g: new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), x: pil.x - 0.22 + k * 0.22, y: 0.27, z: pil.z, c })),
    { g: new THREE.BoxGeometry(0.72, 0.05, 0.22), x: pil.x, y: 0.55, z: pil.z, c: 0xe6a15c },
    { g: new THREE.BoxGeometry(0.76, 0.04, 0.26), x: pil.x, y: 0.02, z: pil.z, c: 0x8ed0e6 });
  // Shahed drone: a delta wing on a stand
  if (props && pos.geo_shahed) { const d = near('geo_shahed', 0.9, 0.3), dg = rotX(new THREE.ConeGeometry(0.3, 0.5, 3)); dg.scale(1, 0.18, 1);
    statics.matte.push({ g: dg, x: d.x, y: 0.36, z: d.z, ry: 0.7, c: 0xcfd6d8 }, { g: new THREE.CylinderGeometry(0.015, 0.015, 0.34, 5), x: d.x, y: 0.17, z: d.z, c: DARK }); }
  // blue oil barrels, gold coins
  { const b = near('barrels', 0.82, 0.3), g = new THREE.CylinderGeometry(0.09, 0.09, 0.24, 10);
    if (b) statics.smooth.push(...[[0, 0.12, 0], [0.2, 0.12, 0.02], [0.1, 0.12, 0.17], [0.1, 0.36, 0.06]].map(([x, y, z]) => ({ g, x: b.x + x, y, z: b.z + z, c: 0x1b8fa3 })));
    const c = near('gold', 0.8, 0.32), cg = new THREE.CylinderGeometry(0.1, 0.1, 0.035, 14);
    if (c) for (let k = 0; k < 7; k++) statics.metal.push({ g: cg, x: c.x + (k > 3 ? 0.2 : 0), y: 0.02 + (k % 4) * 0.037, z: c.z + rnd(k) * 0.03, c: 0xf5c542 }); }
  for (const [kind, mat] of [['matte', matteVC], ['smooth', smoothVC], ['metal', metalVC]]) { if (!statics[kind].length) continue; const m = solid(bake(statics[kind]), mat); m.receiveShadow = true; }
  if (!hillAt) boulder.visible = pusher.visible = false;
  // regulator vans (nose along +Z), with the agency logo on the side
  const vanGeo = bake([
    { g: new THREE.BoxGeometry(0.3, 0.26, 0.56), y: 0.2, z: -0.04, c: 0xf1f3f2 },
    { g: new THREE.BoxGeometry(0.28, 0.16, 0.16), y: 0.15, z: 0.3, c: 0x16242c },
    ...[[-0.15, 0.2], [0.15, 0.2], [-0.15, -0.2], [0.15, -0.2]].map(([x, z]) => ({ g: new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), x, y: 0.06, z, rz: Math.PI / 2, c: DARK })),
  ]);
  const decalMat = new THREE.MeshBasicMaterial({ map: cardTex });
  const vans = ['asic', 'accc'].map(id => {
    const v = new THREE.Group(); scene.add(v); v.visible = false; solid(vanGeo, smoothVC, v);
    const dg = tilePlane(0.34, 0.22, ...(id in idx ? cardUV(id, true) : [0, 0, 0.001, 0.001]));
    for (const s of [-1, 1]) { const d = new THREE.Mesh(dg, decalMat); d.position.set(0.152 * s, 0.21, -0.06); d.rotation.y = s * Math.PI / 2; v.add(d); }
    return v;
  });
  // player pawns + portraits
  const pawnGeo = bake([
    { g: new THREE.CylinderGeometry(0.13, 0.15, 0.05, 20), y: 0.025 },
    { g: new THREE.CylinderGeometry(0.04, 0.11, 0.24, 16), y: 0.16 },
    { g: new THREE.SphereGeometry(0.075, 16, 12), y: 0.32 },
  ]);
  const tokens = seats.map((seat, i) => {
    const t = new THREE.Group(); scene.add(t);
    solid(pawnGeo, new THREE.MeshStandardMaterial({ color: pcol[i], emissive: pcol[i], emissiveIntensity: 0.45, roughness: 0.35 }), t);
    const pc = document.createElement('canvas'); pc.width = pc.height = 128;
    const tex = new THREE.CanvasTexture(pc); tex.colorSpace = THREE.SRGBColorSpace;
    const drawFace = img => { const c = pc.getContext('2d'); c.clearRect(0, 0, 128, 128); c.save(); c.beginPath(); c.arc(64, 64, 56, 0, 7); c.closePath(); c.fillStyle = '#0a0e0d'; c.fill(); c.clip();
      if (img) { const s = Math.max(128 / img.width, 128 / img.height); c.drawImage(img, 64 - img.width * s / 2, 64 - img.height * s / 2 + 4, img.width * s, img.height * s); } c.restore();
      c.lineWidth = 9; c.strokeStyle = seat.color || '#ffffff'; c.beginPath(); c.arc(64, 64, 57, 0, 7); c.stroke(); tex.needsUpdate = true; };
    drawFace(null);
    if (seat.face) { const im = new Image(); im.onload = () => drawFace(im); im.src = seat.face; }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false })); sp.scale.set(0.42, 0.42, 1); sp.position.y = 0.68; t.add(sp);
    return t;
  });

  /* ---------- pop-ups (DOM, projected; only changed styles are written) ---------- */
  const pops = new Map();
  let W = 0, H = 0, shiftX = 0, shiftY = 0, wantShiftX = 0, wantShiftY = 0, snapShift = true;
  const cam = { t: new THREE.Vector3(0, 0, 0.5), d: 30, el: 0.9, az: 0 }, want = { t: new THREE.Vector3(0, 0, 0.5), d: 30, el: 0.9, az: 0 };
  let mood = 'CALM', snap = true, clock = 0;

  /* ---------- quality ---------- */
  const eff = i => ({ dpr: Math.min(devDpr, TIERS[i].dpr), shadow: small ? Math.min(1024, TIERS[i].shadow) : TIERS[i].shadow, bloom: TIERS[i].bloom && !!composer });
  const sameTier = (a, b) => { const x = eff(a), y = eff(b); return x.dpr === y.dpr && x.shadow === y.shadow && x.bloom === y.bloom; };
  const forced = quality != null && TIERS[quality] ? quality : null;
  let tier = forced != null ? forced : TIERS.findIndex(t => t.dpr <= (small ? 1.25 : 1.5));
  /* wall-clock based, so a 5 fps device reacts as fast as a 50 fps one */
  const ad = { buf: [], sum: 0, wait: 1500, prev: null, locked: forced != null };
  function applyTier(i) {
    tier = i; const e = eff(i);
    renderer.setPixelRatio(e.dpr);
    if (W) { renderer.setSize(W, H, false); if (composer) { composer.setPixelRatio(e.dpr); composer.setSize(W, H); } }
    if (sun.shadow.mapSize.x !== e.shadow) { sun.shadow.mapSize.set(e.shadow, e.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    if (bloom) bloom.enabled = e.bloom;
  }
  applyTier(tier);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const aim = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect(); if (!r.width) return false;
    ndc.set((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera); return true;
  };
  const w = {
    pos, cards, THREE, camera, HILL, hillAt, silo, isle, lagoon, PCOLORS, SW, SH, SC,
    get adj() { return adj; }, get edges() { return edges; },
    N: id => pos[id],
    /* board pixels -> the ground under them */
    toWorld: (x, y, out) => toW(x, y, out),
    /* where pawn `slot` stands at a node (two rows of four) */
    stand(id, slot = 0, out = new THREE.Vector3()) { return out.copy(pos[id]).add(V2.set(-0.36 + (slot % 4) * 0.24, 0, 0.66 + Math.floor(slot / 4) * 0.24)); },
    /* re-thread the board (fog of war reveals threads as it goes) */
    threads(list) { setGraph(list); threads.geometry.dispose(); threads.geometry = threadGeo(); },
    /* the card under a screen point, else the one nearest where the ray meets the table */
    pick(clientX, clientY) {
      if (!aim(clientX, clientY)) return null;
      frames.computeBoundingSphere();
      const hit = ray.intersectObject(frames, false).find(h => h.instanceId != null && !cardList[h.instanceId].hidden);
      if (hit) return cardList[hit.instanceId].n.id;
      const g = ray.ray.intersectPlane(groundPlane, V);
      if (!g) return null;
      let best = null, bd = 0.85;
      for (const c of cardList) { const d = Math.hypot(c.p.x - g.x, c.p.z + 0.2 - g.z); if (d < bd) { bd = d; best = c.n.id; } }
      return best;
    },
    /* where a screen point meets the table (null if it points at the sky) */
    ground(clientX, clientY, out = new THREE.Vector3()) { return aim(clientX, clientY) ? ray.ray.intersectPlane(groundPlane, out) : null; },
    hide(id) { if (cards[id]) cards[id].dHide = 1; },
    ringOut(p, age, hex, k = 2, span = 1.2) { if (age > 0 && age < span) w.ring(p, 0.7 + age * 2.4, hex, k * (1 - age / span)); },
    /* a blockade: hazard barriers round a card, k = how far up they are */
    wall(c, k) {
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * 6.283 + 0.26, q = sm(k, i / 30, 0.6 + i / 30);
        _p.set(c.x + Math.cos(a) * 1.05, 0.11 * q, c.z + 0.15 + Math.sin(a) * 0.82);
        w.box(_p, 0.4, 0.22 * q, 0.12, i % 2 ? 0xf5c542 : 0x23292a, -a + Math.PI / 2);
        if (i % 3 === 0) { _p.y = 0.3 * q; w.glow(_p, 0.06, 0xffb020, 3 * q * (Math.floor(clock * 4 + i) % 2)); }
      }
      w.ring(c, 1.3, 0xffb020, 0.9 * k);
    },
    /* the cruise-ship crowd milling in front of a card */
    crowd(c, n, k, seed = 0) {
      for (let i = 0; i < n; i++) {
        const a = rnd(i + seed) * 6.28, r = 0.25 + rnd(i * 3 + seed) * 0.75, y = Math.abs(Math.sin(clock * 9 + i)) * 0.05;
        _p.set(c.x + Math.cos(a) * r * 1.2, y + 0.07, c.z + 0.75 + Math.sin(a) * r * 0.55);
        w.box(_p, 0.055 * k, 0.13 * k, 0.045 * k, CROWD[i % 7]); _p.y = y + 0.17; w.ball(_p, 0.033 * k, 0xe7c9a5);
      }
    },
    /* free the GPU; the caller drops the canvas afterwards */
    destroy() {
      for (const p of pops.values()) p.el.remove();
      pops.clear();
      renderer.dispose(); renderer.forceContextLoss();
    },
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
    /* feed one frame's duration (ms). Steps the quality down while frames are slow; if a
       step doesn't help (a 30 Hz cap, a busy CPU) it undoes it and stops adapting. */
    sample(ms) {
      if (ad.locked || ms > 1000) return;        // a tab switch, not a slow frame
      if (ad.wait > 0) { ad.wait -= ms; return; } // let a change (or the first shaders) settle
      ad.buf.push(ms); ad.sum += ms;
      if (ad.sum < 1200 || ad.buf.length < 8) return;
      const s = ad.buf.sort((a, b) => a - b), keep = s.slice(0, Math.ceil(s.length * 0.9));
      const avg = keep.reduce((a, b) => a + b, 0) / keep.length; ad.buf = []; ad.sum = 0;
      if (avg < 19) { ad.prev = null; return; }   // ~52 fps or better: leave it alone
      if (ad.prev && avg > ad.prev.avg * 0.92) { applyTier(ad.prev.tier); ad.locked = true; return; }
      let next = tier + 1; while (next < TIERS.length && sameTier(next, tier)) next++;
      if (next >= TIERS.length) { ad.locked = true; return; }
      ad.prev = { tier, avg }; applyTier(next); ad.wait = 700;
    },
    setShift(x, y) { wantShiftX = x; wantShiftY = y; },
    snapCamera() { snap = true; },
    begin(sc, dt) {
      clock += dt; w.dt = dt; w.clock = clock;
      for (const c of cardList) { const id = c.n.id; c.dOwner = sc.owners && id in sc.owners ? sc.owners[id] : null; c.dRub = sc.rubble && sc.rubble[id] ? 1 : 0; c.dLift = 0; c.dPulse = 0; c.dHide = 0; }
      for (const m of missiles) m.visible = false; for (const v of vans) v.visible = false;
      jet.visible = false; dome.visible = false; w.sisyphus(0, false); w.madeGlow(0.25);
      tokens.forEach((t, i) => { const at = sc.tokens && sc.tokens[i]; t.visible = !!at; if (at) w.stand(at, i, t.position); });
      for (const p of pops.values()) p.used = false;
      mood = sc.mood || 'CALM';
    },
    own(id, pi) { cards[id].dOwner = pi; }, rubble(id, k = 1) { cards[id].dRub = k; }, lift(id, y) { cards[id].dLift = y; }, pulse(id, k = 1) { cards[id].dPulse = k; },
    mood(m) { mood = m; }, moodNow: () => mood,
    stats: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, dpr: renderer.getPixelRatio(), w: W, h: H, tier, adapt: ad.locked ? 'locked' : 'watching' }),
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
        const s = w.arc(a, b, h, uu, V2), age = k / 22, r = 0.05 + 0.13 * Math.sin(age * Math.PI);
        s.x += (rnd(seed * 31 + k + Math.floor(uu * 55)) - 0.5) * 0.1 * age * 3; s.y += age * 0.12;
        put(P.ball, s.x, s.y, s.z, r, r, r, 0xc9cdd0, 1 - age * 0.5);
      }
      return p;
    },
    boom(p, age, s = 1, seed = 0) {
      if (age < 0 || age > 2.6) return;
      V2.copy(p); V2.y += 0.3; w.glow(V2, s * (0.35 + age * 2.6), 0xffb24a, 3.5 * Math.max(0, 1 - age / 0.45));
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
    jetParked() { if (!props || !pos.qantas) return; jet.visible = true; jet.position.copy(pos.qantas).add(V.set(0.95, 0.16, 0.4)); jet.rotation.set(0, 1.9, 0); },
    /* u: how far up the hill the boulder is (0 = at the bottom) */
    sisyphus(u, active = true) {
      if (!hillAt) return boulder.position;
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
    shield(k, flash = 0) { if (!props || !pos.geo_tuvalu) return; dome.visible = k > 0.01; dome.scale.setScalar(1.25 * k); dome.material.color.set(0x35e0ff).multiplyScalar(0.16 + flash * 1.4 + 0.04 * Math.sin(clock * 3)); },
    /* a floating label over a world position. age drives the rise + fade (dur<=0 = pinned) */
    pop(key, p, text, color = '#fff', age = 0, dur = 1.9, cls = '') {
      if (age < 0 || (dur > 0 && age > dur)) return;
      let e = pops.get(key);
      if (!e) { e = { el: document.createElement('div'), id: null, op: '', tf: '' }; overlay.appendChild(e.el); pops.set(key, e); }
      e.used = true;
      const id = text + '|' + cls + '|' + color;
      if (e.id !== id) { e.el.className = 'pop ' + cls; e.el.textContent = text; e.el.style.color = color; e.id = id; }
      V.copy(p); V.y += 1.25 + (dur > 0 ? age * 0.45 : 0); V.project(camera);
      const o = dur > 0 ? Math.min(1, age * 6) * clamp01((dur - age) * 2.2) : Math.min(1, age * 5);
      const s = 0.82 + 0.18 * Math.min(1, age * 7);
      const op = V.z > 1 ? '0' : o.toFixed(2);
      if (op !== e.op) { e.el.style.opacity = op; e.op = op; }
      const tf = 'translate3d(' + ((V.x * 0.5 + 0.5) * W).toFixed(1) + 'px,' + ((-V.y * 0.5 + 0.5) * H).toFixed(1) + 'px,0) translate(-50%,-50%) scale(' + s.toFixed(2) + ')';
      if (tf !== e.tf) { e.el.style.transform = tf; e.tf = tf; }
    },
    end() {
      if (canvas.clientWidth !== W || canvas.clientHeight !== H) w.resize();
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
      // cards ease toward what the scene declared, then write their instances
      const kc = 1 - Math.exp(-dt * 7);
      let nr = 0;
      for (const c of cardList) {
        if (c.dHide) {
          frames.setMatrixAt(c.i, ZERO); faces.setMatrixAt(c.i, ZERO); feet.setMatrixAt(c.i, ZERO); glowAttr.array[c.i] = 0; c.hidden = 1;
          continue;
        }
        if (c.hidden) { feet.setMatrixAt(c.i, c.F); c.hidden = 0; }
        if (c.dOwner !== c.owner) { c.owner = c.dOwner; if (c.owner != null) c.shown = c.owner; }
        c.ownK = lerp(c.ownK, c.owner != null && c.dRub < 0.5 ? 1 : 0, kc);
        c.rub = lerp(c.rub, c.dRub, kc); c.lift = lerp(c.lift, c.dLift, kc); c.pulse = lerp(c.pulse, c.dPulse, kc);
        O.position.set(0, 0.07 + c.lift, 0); O.rotation.set(lerp(LEAN, -1.47, c.rub), c.lift * 0.9, 0); O.scale.set(1, 1, 1); O.updateMatrix();
        _m.multiplyMatrices(c.G, O.matrix);
        frames.setMatrixAt(c.i, M2.multiplyMatrices(_m, L_FRAME));
        faces.setMatrixAt(c.i, M2.multiplyMatrices(_m, L_FACE));
        faces.setColorAt(c.i, C.setScalar(0.93 * (1 - c.rub * 0.8)));
        glowAttr.array[c.i] = c.pulse * 1.6;
        if (c.ownK > 0.004 && c.shown >= 0) {
          const s = 1.25 - 0.25 * c.ownK;
          rings.setMatrixAt(nr, M2.makeScale(s, 1, s).setPosition(c.p.x, 0.035, c.p.z));
          rings.setColorAt(nr, C.copy(pcol[c.shown] || WHITE3).multiplyScalar(2.1 * c.ownK));
          discs.setMatrixAt(nr, M2.makeTranslation(c.p.x, 0.032, c.p.z));
          discs.setColorAt(nr, C.copy(pcol[c.shown] || WHITE3).multiplyScalar(0.22 * c.ownK));
          nr++;
        }
        if (c.rub > 0.08) for (let j = 0; j < 9; j++) {
          const a = rnd(j + c.n.x) * 6.28, r = 0.15 + rnd(j * 5 + c.n.y) * 0.5, s = (0.1 + rnd(j * 9) * 0.16) * c.rub;
          put(P.box, c.p.x + Math.cos(a) * r, s * 0.4, c.p.z + 0.25 + Math.sin(a) * r * 0.7, s * 1.5, s, s * 1.2, j % 4 ? 0x4c5553 : 0x2b3130, 1, a, 0.3 * rnd(j), 0.3 * rnd(j + 2));
        }
      }
      frames.instanceMatrix.needsUpdate = faces.instanceMatrix.needsUpdate = faces.instanceColor.needsUpdate = glowAttr.needsUpdate = feet.instanceMatrix.needsUpdate = true;
      rings.count = discs.count = nr; rings.visible = discs.visible = nr > 0;
      if (nr) rings.instanceMatrix.needsUpdate = rings.instanceColor.needsUpdate = discs.instanceMatrix.needsUpdate = discs.instanceColor.needsUpdate = true;
      for (const k2 in P) P[k2].flush();
      for (const p of pops.values()) if (!p.used && p.op !== '0') { p.el.style.opacity = '0'; p.op = '0'; }
      renderer.info.reset();
      if (composer) composer.render(); else renderer.render(scene, camera);
    },
  };
  w.resize();
  return w;
}
