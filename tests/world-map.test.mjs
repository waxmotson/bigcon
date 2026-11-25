/*
 * WORLD MAP layout + the WORLD EXPANSION (100 global nodes, ids w_*).
 * The expansion must work with every layout (random, ringworld, megaring, worldmap), alone or with the
 * Geography DLC; the worldmap layout must pin every node to its real place, keep the board connected from
 * Quikstop (in Australia), and keep overlaps low. Nodes without an image render as text cards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, makeGame, withSeed, bfs } from './helpers/harness.mjs';

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
  assert.ok(WORLD_NODES.filter(n => n.todo).length >= 5, "complex actives are flagged todo");
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
    assert.ok(Math.max(...dist.values()) <= 16, 'the world is crossable in 16 hops');
    /* quik is in Australia: nearer to Sydney than to anything else on the map, and well east of Perth */
    const sydney = engine.f.projectGeo(-33.9, 151.2), london = engine.f.projectGeo(51.5, -0.1), nyc = engine.f.projectGeo(40.7, -74);
    const q = NMAP.quik;
    assert.ok(Math.hypot(q.x - sydney.x, q.y - sydney.y) < 700, 'quik sits at the Sydney inset');
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
  assert.ok(S.log.some(l => l.includes('WORLD MAP') && l.includes('Quikstop opens in Australia')));
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
  /* start of turn: Area 51 +1 Intel, Easter Island -1 Cortisol, the Greek Debt +1 Cortisol */
  S.cur = 0; S.owner = { w_area51: 0, w_easter: 0, w_greek: 0 }; S.players[0].cortisol = 3; S.players[0].intel = 0; S.players[0].raided = 0;
  await engine.f.startTurn();
  assert.equal(S.players[0].intel, 1, 'Area 51 briefs you');
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
