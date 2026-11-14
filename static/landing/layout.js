'use strict';
/* landing/layout: where every exhibit stands on the 3D board, in board pixels. Pure numbers
   (no three.js), so the page and scripts/build_film.mjs — which plays a real game on this
   exact board — agree on every position and thread. */
import { NODES, EDGES, rebuildWorld } from '../js/data.js';

/* exhibits that get a 3D model beside their card, so the layout leaves them room */
export const LANDMARKS = new Set(['qantas', 'sisy', 'made', 'geo_missile', 'geo_tuvalu', 'geo_venice', 'geo_pillars', 'geo_shahed', 'barrels', 'gold']);

/* the canonical collage, pushed apart until nothing overlaps */
export function buildLayout() {
  rebuildWorld(true);
  const pts = NODES.map(n => ({ id: n.id, x: n.x, y: n.y, rot: n.rot || 0 }));
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
  const at = Object.fromEntries(pts.map(p => [p.id, p]));
  /* the DLC pins are only threaded to each other in the canonical data (every real game
     deals fresh threads), so tie any stranded cluster to its nearest neighbour */
  const edges = EDGES.filter(e => at[e[0]] && at[e[1]]).map(e => e.slice());
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
      const d = Math.hypot(at[o.id].x - at[s].x, at[o.id].y - at[s].y);
      if (!best || d < best.d) best = { d, a: o.id, b: s };
    }
    edges.push([best.a, best.b]); link(best.a, best.b);
  }
  return { pts, at, edges, adj };
}
