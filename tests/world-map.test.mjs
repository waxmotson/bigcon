/*
 * WORLD MAP layout + the WORLD EXPANSION (100 global nodes, ids w_*).
 * The expansion must work with every layout (random, ringworld, megaring, worldmap), alone or with the
 * Geography DLC; the worldmap layout must pin every node to its real place, keep the board connected from
 * Quikstop (in Australia), and keep overlaps low. Nodes without an image render as text cards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, withSeed, bfs } from './helpers/harness.mjs';
import * as W from '../static/js/world.js';

const REQUIRED = ['id', 'name', 'icon', 'type', 'income', 'cost', 'sub', 'sp', 'geo'];
const TYPES = ['BANK', 'REGULATOR', 'CHART', 'COMMODITY', 'CORPORATE', 'MEDIA', 'WILD'];
const BIG7 = ['citi', 'rba', 'infl', 'term', 'coal', 'oil', 'press'];
const QUIK_SLOTS = [{ x: 350, y: 430, rot: 2 }, { x: 1540, y: 1210, rot: -2 }, { x: 2060, y: 680, rot: 1 }, { x: 700, y: 280, rot: -1 }, { x: 1120, y: 1410, rot: 2 }];

function overlaps(engine, positions, pad) {
  const { NODES } = engine.acc;
  const pos = new Map(positions.map(p => [p.id, p]));
  let n = 0;
  for (let i = 0; i < NODES.length; i++) for (let j = i + 1; j < NODES.length; j++) {
    const A = pos.get(NODES[i].id), B = pos.get(NODES[j].id);
    const [aw, ah] = engine.f.nodeBox(NODES[i]), [bw, bh] = engine.f.nodeBox(NODES[j]);
    if (Math.abs(B.x - A.x) < (aw + bw) / 2 + pad && Math.abs(B.y - A.y) < (ah + bh) / 2 + pad) n++;
  }
  return n;
}

test('every world node has the required fields, a valid type, a geo and balanced numbers', async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  const { WORLD_NODES, WORLD_NODE_IDS, BASE_NODES, GEO_NODES } = engine.acc;
  assert.ok(WORLD_NODES.length >= 90, 'about a hundred new nodes: ' + WORLD_NODES.length);
  assert.equal(new Set(WORLD_NODE_IDS).size, WORLD_NODES.length, 'ids are unique');
  const taken = new Set(BASE_NODES.concat(GEO_NODES).map(n => n.id));
  for (const n of WORLD_NODES) {
    assert.ok(n.id.startsWith('w_') && !taken.has(n.id), n.id + ' is prefixed and unique');
    for (const k of REQUIRED) assert.ok(n[k] != null && n[k] !== '', n.id + ' has ' + k);
    assert.ok(Array.isArray(n.name) && n.name.length >= 1 && n.name.length <= 3 && n.name.every(l => l === l.toUpperCase()), n.id + ' name is 1-3 caps lines');
    assert.ok(TYPES.includes(n.type), n.id + ' type ' + n.type);
    assert.ok(Number.isInteger(n.income) && n.income >= 0 && n.income <= 8, n.id + ' income');
    assert.ok(Number.isInteger(n.cost) && n.cost >= 2 && n.cost <= 20, n.id + ' cost');
    assert.ok(Math.abs(n.geo[0]) <= 90 && Math.abs(n.geo[1]) <= 180, n.id + ' geo in range');
    assert.ok(!n.image, n.id + ' has no image yet (placeholder card)');
    assert.ok(n.sp.length > 10, n.id + ' has ability text');
  }
  for (const t of TYPES) assert.ok(WORLD_NODES.some(n => n.type === t), 'the expansion has ' + t);
  /* every id an ability mentions is a real node */
  const all = new Set([...taken, ...WORLD_NODE_IDS]);
  for (const n of WORLD_NODES) {
    const f = n.fx || {};
    const refs = [...(f.w || []).map(x => x[0]), ...(f.wi || []).map(x => x[0]), ...(f.i || []).flatMap(x => x[0]), ...(f.x2 ? [f.x2] : [])];
    for (const r of refs) assert.ok(all.has(r), n.id + ' references unknown ' + r);
    for (const cid of Object.keys(f.e || {})) assert.ok(engine.acc.CARDBYID[cid], n.id + ' references unknown card ' + cid);
  }
  assert.equal(WORLD_NODES.filter(n => n.todo).length, 0, "every active is wired up now, so none is flagged todo");
});

test('worldmap layout places every node (base + geo + world) at its real place, connected from an Australian Quikstop', { timeout: 60000 }, async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  for (const geo of [false, true]) {
    engine.f.rebuildWorld(geo, true);
    const { NODES, NMAP, ADJ } = engine.acc;
    assert.equal(NODES.length, 70 + (geo ? 12 : 0) + engine.acc.WORLD_NODES.length);
    const gen = engine.f.generateWorldMapBoard();
    const m = engine.f.worldMapMetrics();
    assert.equal(gen.positions.length, NODES.length, 'every node has a position');
    for (const n of NODES) assert.ok(engine.f.geoOf(n), n.id + ' has a geographic anchor');
    for (const p of gen.positions) assert.ok(p.x >= 0 && p.x <= m.w && p.y >= 0 && p.y <= m.h, p.id + ' inside the canvas');
    /* connected from quik, edges valid, no duplicates */
    const dist = bfs(ADJ, 'quik');
    for (const n of NODES) assert.ok(dist.has(n.id), n.id + ' reachable from quik');
    const seen = new Set();
    for (const [a, b] of gen.edges) { assert.ok(NMAP[a] && NMAP[b] && a !== b); const k = [a, b].sort().join('|'); assert.ok(!seen.has(k), 'dup ' + k); seen.add(k); }
    for (const id of BIG7) assert.ok(dist.has(id), id + ' reachable');
    assert.ok((ADJ.quik || []).length >= 4, 'Quikstop is a hub');
    assert.ok(Math.max(...dist.values()) <= 30, 'the world is still crossable in 30 hops');
    /* quik is the home spawn in the middle of Australia (Alice Springs) */
    const sydney = engine.f.projectGeo(-23.7, 133.9), london = engine.f.projectGeo(51.5, -0.1), nyc = engine.f.projectGeo(40.7, -74);
    const q = NMAP.quik;
    assert.ok(Math.hypot(q.x - sydney.x, q.y - sydney.y) < 700, 'quik sits in the middle of Australia');
    assert.ok(Math.hypot(q.x - london.x, q.y - london.y) > 3500 && Math.hypot(q.x - nyc.x, q.y - nyc.y) > 3500);
    /* world landmarks are where the real world has them */
    const near = (id, lat, lon, r) => { const p = engine.f.projectGeo(lat, lon); assert.ok(Math.hypot(NMAP[id].x - p.x, NMAP[id].y - p.y) < r, id + ' near its real spot'); };
    near('citi', 40.7, -74, 500); near('uk', 51.5, -0.1, 500); near('japan', 35.7, 139.7, 500); near('petronas', 3.1, 101.7, 500);
    near('wef', 46.8, 9.8, 500); near('w_aramco', 26.3, 50.1, 300); near('w_antarctica', -77.8, 166.7, 300); near('w_hormuz', 26.5, 56.2, 300);
    if (geo) { near('geo_shahed', 35.7, 51.4, 400); near('geo_tuvalu', -8.5, 179.2, 300); near('geo_kim', 39, 125.7, 500); }
    /* overlaps stay bounded: none at all in practice */
    assert.ok(overlaps(engine, gen.positions, 0) === 0, 'no node boxes overlap');
    assert.ok(overlaps(engine, gen.positions, 12) <= 4, 'near-overlaps are rare');
    /* the two Americas touch only at the canal */
    const north = ['citi', 'w_bell', 'w_pemex', 'w_hollywood'], south = ['w_vale', 'w_milei', 'w_pdvsa', 'w_petrobras'];
    for (const [a, b] of gen.edges) assert.ok(!(north.includes(a) && south.includes(b)) && !(north.includes(b) && south.includes(a)), 'no direct N-S American edge');
    assert.ok(ADJ.w_panama.includes('w_vale') || ADJ.w_panama.includes('w_pdvsa'), 'the canal links to the south');
    assert.ok(ADJ.w_panama.includes('w_pemex') || ADJ.w_panama.includes('oil'), 'and to the north');
    /* the backdrop is a lightweight inline path */
    const svg = engine.f.worldMapSVG();
    assert.ok(svg.includes('<path') && svg.length < 60000 && !svg.includes('<image'), 'backdrop is inline paths: ' + svg.length + ' bytes');
  }
});

test('random layout with the World Expansion deals valid connected boards across many seeds (with and without the Geography DLC)', { timeout: 240000 }, async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  let worst = 0, total = 0;
  const SEEDS = 60;
  for (const geo of [false, true]) {
    engine.f.rebuildWorld(geo, true);
    const { NODES, NMAP, ADJ } = engine.acc;
    for (let s = 0; s < SEEDS; s++) {
      let gen;
      withSeed(4000 + s, () => { gen = engine.f.generateRandomBoard(QUIK_SLOTS[s % 5]); });
      const b = engine.f.boardViewBounds ? { w: Math.round(2400 * 1.6), h: Math.round(1560 * 1.6) } : null;
      assert.equal(gen.positions.length, NODES.length);
      const dist = bfs(ADJ, 'quik');
      for (const n of NODES) assert.ok(dist.has(n.id), `seed ${s}: ${n.id} unreachable`);
      for (const id of BIG7) assert.ok(dist.has(id), 'win-type node reachable');
      for (const [x, y] of gen.edges) assert.ok(NMAP[x] && NMAP[y] && x !== y);
      for (const p of gen.positions) assert.ok(p.x >= 0 && p.x <= b.w && p.y >= 0 && p.y <= b.h, `seed ${s}: ${p.id} out of bounds`);
      const spots = new Set(gen.positions.map(p => p.x + ',' + p.y));
      assert.equal(spots.size, gen.positions.length, 'no shared positions');
      const ov = overlaps(engine, gen.positions, 16);
      worst = Math.max(worst, ov); total += ov;
      assert.ok(ov <= 20, `seed ${s}: ${ov} overlapping boxes`);
      assert.ok(Math.max(...dist.values()) <= 14, 'path length stays sane');
    }
  }
  console.log(`    random+world residual overlaps: worst ${worst}, mean ${(total / (2 * SEEDS)).toFixed(1)} per board`);
  assert.ok(total / (2 * SEEDS) <= 10, 'mean overlaps stay low');
});

test('ringworld and mega ring accept the World Expansion', { timeout: 60000 }, async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  engine.f.rebuildWorld(true, true);
  const { NODES, ADJ } = engine.acc;
  for (const gen of [engine.f.generateRingworldBoard, engine.f.generateMegaRingBoard]) {
    const g = gen();
    assert.equal(g.positions.length, NODES.length);
    assert.equal(bfs(ADJ, 'quik').size, NODES.length, 'connected');
  }
});

test('initGame: the worldmap layout forces the expansion on, logs its line and starts Quikstop in Australia', { timeout: 60000 }, async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  const Net = engine.acc.Net;
  Net.boardLayout = 'worldmap'; Net.dlcWorld = false; /* the host never ticked it */
  const S = await makeGame(engine, 2);
  assert.equal(S.dlcWorld, true);
  assert.equal(S.layoutKind, 'worldmap');
  assert.ok(S.log.some(l => l.includes('GLOBAL EDITION') && l.includes('Quikstop opens in Australia')));
  assert.ok(engine.acc.NODES.length >= 170);
  assert.equal(engine.acc.pubState === undefined, true);
  const b = engine.f.boardViewBounds();
  assert.ok(b.w > 8000, 'a big canvas: ' + b.w);
  const wire = JSON.parse(JSON.stringify(engine.f.pubState()));
  assert.equal(wire.dlcWorld, true);
  /* a guest adopting the state rebuilds the same world */
  engine.f.rebuildWorld(false, false);
  engine.f.adoptState(wire);
  assert.equal(engine.acc.WORLD_EXP, true);
  assert.equal(engine.acc.NODES.length, wire.boardLayout.length);
});

test('initGame: the expansion on a random board adds the nodes and the larger canvas; off keeps the classic board untouched', { timeout: 60000 }, async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  const Net = engine.acc.Net;
  Net.boardLayout = 'random'; Net.dlcWorld = true;
  let S = await makeGame(engine, 2);
  assert.equal(S.dlcWorld, true);
  assert.ok(engine.acc.NODES.some(n => n.id === 'w_fed'));
  assert.equal(engine.f.boardViewBounds().w, 3840);
  Net.dlcWorld = false;
  S = await makeGame(engine, 2);
  assert.equal(S.dlcWorld, false);
  assert.equal(engine.acc.NODES.length, 70);
  assert.deepEqual(engine.f.boardViewBounds(), { x: 0, y: 0, w: 2400, h: 1560 });
});

test('expansion abilities: synergies, start-of-turn passives and event windfalls fire', { timeout: 60000 }, async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  const W = await import('../static/js/world.js');
  const Net = engine.acc.Net;
  Net.boardLayout = 'random'; Net.dlcWorld = true;
  const S = await makeGame(engine, 2);
  /* data-driven income: salary $3 + Goldman $3 + $2 per rival-owned BANK (CITI, NAB) = $10 */
  S.cur = 0; S.mood = 'CALM'; S.owner = { w_goldman: 0, citi: 1, nab: 1 }; S.players[0].money = 0;
  engine.f.income(0);
  assert.equal(S.players[0].money, 10, 'Goldman Sachs pays per rival bank');
  /* a partner node: Mar-a-Lago pays +$3 only alongside Trump */
  S.owner = { w_malago: 0 }; S.players[0].money = 0; engine.f.income(0);
  const lone = S.players[0].money;
  S.owner = { w_malago: 0, trump: 0 }; S.players[0].money = 0; engine.f.income(0);
  assert.equal(S.players[0].money - lone, 1 + 3, 'Trump adds his own $1 plus the $3 synergy');
  /* pure helpers: the Cushing windfall doubles with the Crude Oil Pit */
  assert.equal(W.worldEventPays('oilspike', id => (id === 'w_cushing' ? 0 : null))[0].amt, 5);
  assert.equal(W.worldEventPays('oilspike', id => (id === 'w_cushing' || id === 'oil' ? 0 : null)).find(x => x.id === 'w_cushing').amt, 10);
  /* the event hook pays through the real end-of-turn path (the pump price is charged first, against an empty purse) */
  S.cur = 0; S.owner = { w_cushing: 0, w_greek: 0 }; S.players[0].money = 0; S.deck = ['oilspike']; S.phase = 'action';
  await engine.f.endOfTurn();
  assert.equal(S.players[0].money, 5, 'OIL SPIKES pays the Cushing owner');
  /* start of turn: Area 51 (no passive now), Easter Island -1 Cortisol, the Greek Debt +1 Cortisol */
  S.cur = 0; S.owner = { w_area51: 0, w_easter: 0, w_greek: 0 }; S.players[0].cortisol = 3; S.players[0].intel = 0; S.players[0].raided = 0;
  await engine.f.startTurn();
  assert.equal(S.players[0].intel, 0, 'Area 51 no longer pays Intel: it abducts instead (tests/node-reworks.test.mjs)');
  assert.equal(S.players[0].cortisol, 3, 'Easter Island soothes, the Greek debt stings');
  /* JPMorgan: takeovers of its owner's nodes cost +$2 */
  S.owner = { w_jpm: 0, citi: 0 }; S.seizeCount = { citi: 1 };
  assert.equal(engine.f.takeoverCost(1, 'citi', 8), 8 * 2 + 2);
  S.owner = { citi: 0 };
  assert.equal(engine.f.takeoverCost(1, 'citi', 8), 8 * 2);
});

test('placeholder nodes render as text cards without an image; an image path takes over', { timeout: 60000 }, async t => {
  const engine = await loadEngine();
  t.after(() => engine.dispose());
  engine.f.rebuildWorld(true, true);
  const { NMAP } = engine.acc;
  const n = NMAP.w_fed;
  const svg = engine.f.nodeSVG(n, 'node');
  assert.ok(!svg.includes('<image'), 'no <image> for a placeholder node');
  assert.ok(svg.includes('THE FEDERAL RESERVE') && svg.includes(n.icon), 'name and icon are drawn');
  assert.ok(svg.includes('node-card'));
  for (const w of engine.acc.WORLD_NODES) {
    const s = engine.f.nodeSVG(w, 'node');
    assert.ok(!s.includes('<image') && s.includes('<g class="node '), w.id + ' renders');
  }
  /* classic nodes keep their pictures */
  assert.ok(engine.f.nodeSVG(NMAP.citi, 'node').includes('<image'));
  /* drop an image in later and it is used */
  n.image = './static/example.png';
  assert.ok(engine.f.nodeSVG(n, 'node').includes('href="./static/example.png"'));
  delete n.image;
});

/* ---------- the region-structured graph ---------- */
const seeded = async (t, seed, geo = true) => {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.f.rebuildWorld(geo, true);
  let gen; withSeed(seed, () => { gen = e.f.generateWorldMapBoard(); });
  return { e, gen, NODES: e.acc.NODES, NMAP: e.acc.NMAP, ADJ: e.acc.ADJ };
};
const reach = (ADJ, from, ban) => { const seen = new Set([from]), q = [from]; while (q.length) { const v = q.pop(); for (const w of ADJ[v] || []) if (!seen.has(w) && !ban.has(w)) { seen.add(w); q.push(w); } } return seen; };

test('Europe and North America meet only through Iceland and Greenland', { timeout: 60000 }, async t => {
  for (const seed of [11, 12, 13]) {
    const { gen, NODES, NMAP, ADJ } = await seeded(t, seed);
    const reg = id => W.regionOf(NMAP[id]);
    const FLOAT = new Set(W.WORLD_FLOATING); /* a floating exhibit has no region of its own: it joins one region's nodes only */
    for (const [a, b] of gen.edges.filter(([a, b]) => !FLOAT.has(a) && !FLOAT.has(b))) assert.ok(!((reg(a) === 'EUR' && reg(b) === 'NAM') || (reg(a) === 'NAM' && reg(b) === 'EUR')), 'direct transatlantic edge ' + a + ' ' + b);
    assert.ok(!ADJ.citi.includes('uk') && !ADJ.uk.includes('citi'), 'no London to New York');
    /* the North Atlantic corridor: Europe, Iceland, Greenland and North America only (a southern route via Africa and South America is allowed) */
    const north = new Set(NODES.filter(n => !FLOAT.has(n.id) && ['EUR', 'NAM', 'ISL', 'GRL'].includes(reg(n.id))).map(n => n.id));
    const outside = new Set(NODES.filter(n => !north.has(n.id)).map(n => n.id));
    const eur = NODES.find(n => reg(n.id) === 'EUR').id, nam = NODES.find(n => reg(n.id) === 'NAM').id;
    assert.ok(reach(ADJ, eur, outside).has(nam), 'the corridor links them');
    for (const gate of ['w_hdi', 'w_greenland']) {
      const ban = new Set([...outside, gate]);
      const seen = reach(ADJ, eur, ban);
      assert.ok(NODES.filter(n => reg(n.id) === 'NAM').every(n => !seen.has(n.id)), 'without ' + gate + ' Europe cannot reach North America across the Atlantic');
    }
    assert.ok(ADJ.w_hdi.includes('uk') && ADJ.w_hdi.includes('w_greenland') && ADJ.w_greenland.includes('w_bay'));
  }
});

test('the Rock wraps the world: an edge across the date line to Fiji, a normal edge for pathing', { timeout: 60000 }, async t => {
  const { e, gen, NMAP, ADJ } = await seeded(t, 21);
  assert.ok(W.WORLD_WRAPS.some(w => w.includes('rock')), 'a wrap is declared');
  assert.ok(gen.edges.some(([a, b]) => (a === 'rock' && b === 'w_fiji') || (a === 'w_fiji' && b === 'rock')));
  assert.ok(ADJ.rock.includes('w_fiji'));
  const m = e.f.worldMapMetrics();
  assert.ok(Math.abs(NMAP.rock.x - NMAP.w_fiji.x) > m.w * 0.6, 'it really spans the whole canvas');
  assert.equal(bfs(ADJ, 'rock').get('w_fiji'), 1);
});

test('the Bond Desk is anchored in Sydney', { timeout: 60000 }, async t => {
  const { e, NMAP } = await seeded(t, 22);
  assert.ok(W.GEO_ANCHORS.bond[0] < -33 && W.GEO_ANCHORS.bond[0] > -34.5 && W.GEO_ANCHORS.bond[1] > 151 && W.GEO_ANCHORS.bond[1] < 151.5);
  const p = e.f.projectGeo(-33.87, 151.2);
  assert.ok(Math.hypot(NMAP.bond.x - p.x, NMAP.bond.y - p.y) < 700, 'bond sits in the Sydney inset');
});

test('Australia is spread across the continent', { timeout: 60000 }, async t => {
  const { NMAP } = await seeded(t, 23);
  const at = (id, lat, lon, tol = 3) => { const g = W.GEO_ANCHORS[id]; assert.ok(Math.abs(g[0] - lat) < tol && Math.abs(g[1] - lon) < tol, id + ' is where it should be'); };
  at('westpac', -21.9, 131.5); at('commbank', -19.65, 134.2); at('quik', -23.7, 133.9); at('qantas', -22.3, 136.8); at('gold', -30.7, 121.5); at('bhp', -20.3, 118.6); at('anz', -25.9, 137.6); at('aus', -34.9, 138.6);
  at('port', -21.3, 149.3); at('jt', -16.9, 145.8); at('press', -19.3, 146.8); at('mpc', -42.9, 147.3); at('nab', -29, 134.75); at('jim', -27.5, 153); at('watson', -20.7, 139.5); at('asic', -34.9, 138.6);
  at('coal', -23.8, 151.3); at('train', -22, 148.2); at('sat', -19.4, 129.6); at('forklift', -12.5, 130.8);
  assert.ok(NMAP.bhp.x < NMAP.quik.x - 400 && NMAP.bond.x > NMAP.quik.x + 600, 'Perth and Sydney are far from the middle');
});

test('the non-place exhibits float to open ground, never in a crowd, and not to the same place every game', { timeout: 120000 }, async t => {
  const FL = W.WORLD_FLOATING;
  assert.ok(FL.length >= 12);
  /* the drawn (warped) land, sampled finely along every edge */
  const proj = (engine, ring) => ring.flatMap(([lo, la], i) => { const [lo2, la2] = ring[(i + 1) % ring.length]; return Array.from({ length: 12 }, (_, k) => { const p = engine.f.projectGeo(la + (la2 - la) * k / 12, lo + (lo2 - lo) * k / 12); return [p.x, p.y]; }); });
  const inside = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const onLandXY = (engine, x, y) => { const land = W.LAND.map(r => proj(engine, r)), water = W.WATER.map(r => proj(engine, r)); return land.some(r => inside(x, y, r)) && !water.some(r => inside(x, y, r)); };
  const spots = [];
  for (const seed of [31, 32, 33, 34]) {
    const { e, NODES, NMAP, ADJ } = await seeded(t, seed, seed % 2 === 0);
    const floats = FL.filter(id => NMAP[id]);
    assert.ok(floats.length >= 12);
    spots.push(Object.fromEntries(floats.map(id => [id, [NMAP[id].x, NMAP[id].y]])));
    const dist = bfs(ADJ, 'quik');
    for (const id of floats) {
      const others = NODES.filter(n => n.id !== id && Math.hypot(n.x - NMAP[id].x, n.y - NMAP[id].y) < 360);
      assert.equal(others.length, 0, id + ' floats clear of every other node (seed ' + seed + ')');
      assert.ok(ADJ[id].length >= 2, id + ' has edges to its neighbours');
      assert.ok(dist.has(id), id + ' is reachable');
      assert.ok(onLandXY(e, NMAP[id].x, NMAP[id].y), id + ' floats on land, not at sea (seed ' + seed + ')');
    }
  }
  const ids = Object.keys(spots[0]);
  const moved = ids.filter(id => spots.slice(1).every(s => s[id][0] !== spots[0][id][0] || s[id][1] !== spots[0][id][1]));
  assert.ok(moved.length >= ids.length - 1, 'positions vary between seeds');
  /* and a fixed seed is reproducible (every client reads the one layout the host dealt) */
  const a = await seeded(t, 31), b = await seeded(t, 31);
  assert.deepEqual(a.gen.positions, b.gen.positions);
});

test('the chokepoints are gateways: each has neighbours in two or more regions', { timeout: 60000 }, async t => {
  for (const geo of [false, true]) {
    const { NMAP, ADJ } = await seeded(t, 41, geo);
    const regions = id => new Set(ADJ[id].map(x => W.regionOf(NMAP[x])));
    for (const id of ['w_panama', 'w_suez', 'w_hormuz', 'w_malacca', 'w_antarctica']) assert.ok(regions(id).size >= 2, id + ' joins regions: ' + [...regions(id)]);
    assert.ok(regions('w_panama').has('NAM') && regions('w_panama').has('SAM'));
    assert.ok(regions('w_suez').has('EUR') && regions('w_suez').has('ME') && regions('w_suez').has('AFR'));
    assert.ok(regions('w_hormuz').has('ME') && regions('w_hormuz').has('SAS'));
    assert.ok(regions('w_malacca').has('SAS') && regions('w_malacca').has('SEA'));
    for (const r of ['SAM', 'AFR', 'OCE']) assert.ok(regions('w_antarctica').has(r), 'Antarctica links ' + r);
  }
  assert.ok(W.WORLD_CHOKEPOINTS.includes('w_malacca'));
  const mal = W.WORLD_NODES.find(n => n.id === 'w_malacca');
  assert.equal(mal.type, 'COMMODITY');
  assert.ok(/\$2 toll/.test(mal.sp));
});

test('The Human Development Index replaced Satoshi in Iceland', { timeout: 60000 }, async t => {
  const { NMAP } = await seeded(t, 51);
  assert.ok(!NMAP.w_satoshi && !W.WORLD_NODES.some(n => n.id === 'w_satoshi'));
  assert.ok(!JSON.stringify(W.WORLD_ROUTES).includes('satoshi'));
  const hdi = NMAP.w_hdi;
  assert.ok(hdi && hdi.type === 'CHART' && hdi.name.join(' ').includes('HUMAN DEVELOPMENT INDEX'));
  assert.ok(Math.abs(hdi.geo[0] - 64.1) < 1 && Math.abs(hdi.geo[1] + 21.9) < 1, 'Reykjavik');
  assert.equal(W.regionOf(hdi), 'ISL');
  assert.equal(W.worldStartFx([hdi], () => false)[0].c, -1);
});

test('route table only names real nodes', async () => {
  const { BASE_NODES, GEO_NODES } = await import('../static/js/data.js');
  const all = new Set([...BASE_NODES, ...GEO_NODES, ...W.WORLD_NODES].map(n => n.id));
  for (const [a, b] of [...W.WORLD_ROUTES, ...W.WORLD_WRAPS]) assert.ok(all.has(a) && all.has(b), a + ' ' + b);
  assert.ok(W.WORLD_NODES.length >= 100);
});

test('THE BAIKONUR COSMODROME: launch to anywhere once per game, and it pays alongside a missile launcher', { timeout: 60000 }, async t => {
  const e = await loadEngine();
  t.after(() => e.dispose());
  e.acc.Net.boardLayout = 'random'; e.acc.Net.dlcWorld = true;
  const S = await makeGame(e, 2, { geo: true });
  const n = e.acc.NMAP.w_baikonur;
  assert.ok(n && n.type === 'REGULATOR' && n.icon && n.sub && n.sp.includes('LAUNCH'));
  assert.ok(!n.image, 'a text placeholder like the other w_ nodes');
  S.cur = 0; S.mood = 'CALM'; S.owner = { geo_missile: 0 }; S.players[0].money = 0; e.f.income(0);
  const base = S.players[0].money;
  S.owner = { w_baikonur: 0, geo_missile: 0 }; S.players[0].money = 0; e.f.income(0);
  assert.equal(S.players[0].money - base, n.income + 2, 'Baikonur adds its own income plus $2 with MISSILE COMMAND');
  S.owner = { w_baikonur: 0 }; S.cur = 0; S.phase = 'move'; S.steps = 3; S.mode = null; S.players[0].pos = 'quik'; S.players[0].money = 10; S.wGame = {};
  await e.f.applyIntent(0, { act: 'worldmode', kind: 'launch' });
  assert.equal(S.mode, 'launch');
  const flight = e.f.applyIntent(0, { act: 'launch', id: 'w_hdi' });
  e.clock.advance(e.acc.PROJ_PAUSE_MS + 100); /* the rocket flies before the landing */
  await flight;
  for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
  assert.equal(S.players[0].pos, 'w_hdi', 'launched to Iceland');
  assert.equal(S.wGame.baikonur, 1);
  assert.match(e.ctx.worldBlocked(0, 'launch'), /once per game|MOVE phase/);
  S.owner = {}; S.wGame = {}; S.phase = 'move'; S.cur = 0; S.mode = null;
  assert.match(e.ctx.worldBlocked(0, 'launch'), /do not control/);
  S.owner = { w_baikonur: 0 }; S.players[0].money = 2;
  assert.match(e.ctx.worldBlocked(0, 'launch'), /\$3/);
});

test('New Zealand sits across the Tasman Sea: east of every Australian node, with a gap of open water', { timeout: 60000 }, async t => {
  const { e, NODES, NMAP } = await seeded(t, 24);
  const nz = ['w_fonterra', 'w_rbnz', 'w_anzcerta'];
  const aus = NODES.filter(n => !W.WORLD_FLOATING.includes(n.id)).filter(n => { const g = e.f.geoOf(n); return g && g[0] < -9 && g[0] > -44 && g[1] > 112 && g[1] < 154; });
  assert.ok(aus.length >= 25, 'plenty of Australian nodes: ' + aus.length);
  const eastEdge = Math.max(...aus.map(n => n.x + 88));
  for (const id of nz) assert.ok(NMAP[id].x - 88 > eastEdge + 40, id + ' is clear of every Australian card (gap ' + (NMAP[id].x - 88 - eastEdge) + 'px)');
  /* and their pins land on the New Zealand outline, not on the mainland one */
  const akl = e.f.projectGeo(-36.8, 174.8), syd = e.f.projectGeo(-33.9, 151.2);
  assert.ok(akl.x - syd.x > 500, 'Auckland is far east of Sydney on the board');
});

/* ---------- the connection graph: rich local webs, few and slow ways between regions ---------- */
test('connections: long journeys, a handful of inter-region links, rich local webs, tidy edges', { timeout: 240000 }, async t => {
  const FLOAT = new Set(W.WORLD_FLOATING);
  const CORRIDOR = new Set(['w_hdi', 'w_greenland', 'w_antarctica', 'w_petrobras', 'w_kazatom']); /* the corridor, the southern route, the South Atlantic and the steppe: allowed to be long */
  let worstInter = 0, worstQL = 99, worstSN = 99, worstEU = 99, worstDeg = 9, crossings = 0;
  for (const geo of [false, true]) for (const seed of [61, 62, 63, 64]) {
    const { e, gen, NODES, NMAP, ADJ } = await seeded(t, seed, geo);
    const reg = id => W.regionOf(NMAP[id]);
    const len = (a, b) => Math.hypot(NMAP[a].x - NMAP[b].x, NMAP[a].y - NMAP[b].y);
    const m = e.f.worldMapMetrics();
    const dist = bfs(ADJ, 'quik');
    for (const n of NODES) assert.ok(dist.has(n.id), n.id + ' reachable from quik (seed ' + seed + ')');
    /* long journeys, in hops on the walking graph (no flights) */
    const ql = dist.get('uk'), sn = bfs(ADJ, 'bond').get('citi'), eu = bfs(ADJ, 'uk').get('japan');
    assert.ok(ql >= 10, 'Quikstop to London takes ' + ql); assert.ok(sn >= 12, 'Sydney to New York takes ' + sn); assert.ok(eu >= 6, 'London to Tokyo overland takes ' + eu);
    assert.ok(Math.max(...dist.values()) <= 30, 'but the world stays crossable');
    worstQL = Math.min(worstQL, ql); worstSN = Math.min(worstSN, sn); worstEU = Math.min(worstEU, eu);
    /* few inter-region links, none of them long except the declared lanes */
    const inter = gen.edges.filter(([a, b]) => !FLOAT.has(a) && !FLOAT.has(b) && reg(a) !== reg(b));
    assert.ok(inter.length <= 25, 'inter-region edges: ' + inter.length);
    for (const [a, b] of inter) {
      const wrapped = Math.abs(NMAP[a].x - NMAP[b].x) > m.w * 0.6;
      if (!wrapped && !CORRIDOR.has(a) && !CORRIDOR.has(b)) assert.ok(len(a, b) <= 1100, 'inter-region edge ' + a + ' ' + b + ' is ' + Math.round(len(a, b)) + 'px');
      worstInter = Math.max(worstInter, wrapped ? 0 : len(a, b));
    }
    /* no kangaroo route */
    for (const id of ['qantas']) assert.ok(ADJ[id].every(o => reg(o) === 'OCE'), id + ' has local links only');
    assert.ok(!ADJ.gold.includes('w_witz'));
    /* local webs: degree and edge length */
    const regions = {};
    NODES.forEach(n => { if (!FLOAT.has(n.id) && !W.GATEWAY_REGIONS.includes(reg(n.id))) (regions[reg(n.id)] = regions[reg(n.id)] || []).push(n.id); });
    let sum = 0, cnt = 0;
    for (const [r, ids] of Object.entries(regions)) {
      const degs = ids.map(id => ADJ[id].filter(o => !FLOAT.has(o) && reg(o) === r).length);
      sum += degs.reduce((a, b) => a + b, 0); cnt += ids.length;
      if (ids.length >= 15) { const avg = degs.reduce((a, b) => a + b, 0) / ids.length; assert.ok(avg >= 3, r + ' average local degree ' + avg.toFixed(2)); worstDeg = Math.min(worstDeg, avg); }
    }
    assert.ok(sum / cnt >= 3, 'average in-region degree ' + (sum / cnt).toFixed(2));
    for (const [a, b] of gen.edges) if (!FLOAT.has(a) && !FLOAT.has(b) && reg(a) === reg(b) && !W.GATEWAY_REGIONS.includes(reg(a))) assert.ok(len(a, b) <= 1500, 'local edge ' + a + ' ' + b + ' is long');
    /* tidiness: crossings among the non-floating edges stay rare (the date-line edge is excluded) */
    const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
    const E = gen.edges.filter(([a, b]) => !FLOAT.has(a) && !FLOAT.has(b) && Math.abs(NMAP[a].x - NMAP[b].x) < m.w * 0.6);
    let cr = 0;
    for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
      const [a, b] = E[i], [c, d] = E[j];
      if (a === c || a === d || b === c || b === d) continue;
      const A = NMAP[a], B = NMAP[b], C = NMAP[c], D = NMAP[d];
      if (ccw(A, C, D) * ccw(B, C, D) < 0 && ccw(A, B, C) * ccw(A, B, D) < 0) cr++;
    }
    assert.ok(cr <= 3, 'crossing edges: ' + cr);
    crossings = Math.max(crossings, cr);
  }
  console.log('    connections: min hops quik-uk ' + worstQL + ', bond-citi ' + worstSN + ', uk-japan ' + worstEU + '; longest inter-region ' + Math.round(worstInter) + 'px; worst crossings ' + crossings);
});

test('connections: the board is connected over many seeds, with and without the Geography DLC', { timeout: 280000 }, async t => {
  const e = await loadEngine();
  t.after(() => e.dispose());
  for (const geo of [false, true]) {
    e.f.rebuildWorld(geo, true);
    for (let s = 0; s < 10; s++) {
      withSeed(7000 + s, () => e.f.generateWorldMapBoard());
      const { NODES, ADJ } = e.acc;
      assert.equal(bfs(ADJ, 'quik').size, NODES.length, 'seed ' + s + ' geo ' + geo + ' is connected');
      assert.ok(ADJ.quik.length >= 4);
    }
  }
});
