'use strict';
/* landing/scenes: the highlight reel. Each scene is a pure function of its local time t:
   frame(w, t) declares the whole board (see world.js) and returns the HUD state
   { led: [[cash, intel, cortisol] x4], card?: {icon,title,text,age} }.
   Cast: 0 Mark Watson (gold) · 1 Tomkins (blue) · 2 Jim Chalmers (purple) · 3 Bessock (green).
   The eleven scenes tell one continuous game, so every number carries into the next. */
import * as THREE from 'three';
import { sm, lerp, rnd, clamp01 } from './world.js';

const GOLD = '#f5c542', RED = '#ff6b5e', BLUE = '#55c1ff', PURPLE = '#e19bff', GREEN = '#7fe08d', WHITE = '#ffffff';
const st = (t, t0, a, b) => (t >= t0 ? b : a);       // a value that steps at t0
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const up = (p, y) => p.clone().setY(y);
const mid = (...ps) => ps.reduce((a, p) => a.add(p), v3(0, 0, 0)).multiplyScalar(1 / ps.length);

/* who holds what as the story goes on */
const O1 = { port: 0, hedge: 0, leak: 0, geo_venice: 0, qantas: 1, f1: 1, citi: 1, sisy: 2, press: 2, fox: 2, group: 2, made: 3, albo: 3, jt: 3, oil: 3, bullock: 3 };
const O2 = { ...O1, geo_missile: 1 };
const O5 = { ...O2, jt: 2, press: undefined, fox: undefined }; delete O5.press; delete O5.fox;
const O7 = { ...O5 }; delete O7.port;
const O8 = { ...O7, geo_tuvalu: 0 }; delete O8.geo_missile;
const O10 = { ...O8, bond: 0 };
const O11 = { bond: 0, hedge: 0, leak: 0, geo_venice: 0, geo_tuvalu: 0, asic: 0, tenyear: 0, coal: 0, gold: 0, qantas: 1, f1: 1, citi: 1, sisy: 2, group: 2, jt: 2 };

export const SCENES = [
  { id: 'board', dur: 40, still: 6, owners: O2, tokens: { 0: 'leak', 1: 'geo_missile', 2: 'sisy', 3: 'made' },
    frame(w, t) {
      w.cam(v3(0, 0, 0.6), 27, 0.62, Math.sin(t * 0.16) * 0.5); w.jetParked(); w.madeGlow(0.5 + 0.5 * Math.sin(t * 1.3));
      const ids = Object.keys(w.cards), k = Math.floor(t / 0.9), id = ids[Math.floor(rnd(k) * ids.length)];
      w.pulse(id, Math.sin(((t / 0.9) % 1) * Math.PI));
      return { led: null };
    } },

  { id: 'seize', dur: 14, still: 6.2, owners: {}, tokens: { 0: 'quik', 1: 'quik', 2: 'quik', 3: 'quik' },
    frame(w, t) {
      const route = ['quik', 'coal', 'train', 'port'], P = w.N('port');
      w.cam(mid(w.N('quik'), w.N('port'), w.N('train')), lerp(12.5, 10, sm(t, 0, 6)), 0.72, lerp(-0.25, 0.2, sm(t, 0, 12)));
      const a = w.walk(0, route, sm(t, 1, 2) + sm(t, 2.1, 3.1) + sm(t, 3.2, 4.2));
      for (let i = 0; i < 3; i++) { w.link(w.N(route[i]), w.N(route[i + 1]), GOLD, 1.6 * (1 - sm(t, 5, 6)), sm(t, 1 + i * 1.1, 2 + i * 1.1)); w.pop('s' + i, w.N(route[i + 1]), 'STEP ' + (i + 1), GOLD, t - (1.9 + i * 1.1), 0.9); }
      if (t > 5) w.own('port', 0);
      w.ring(P, 0.7 + (t - 5) * 2.4, GOLD, 2 * (1 - sm(t, 5, 6.2)) * (t > 5));
      w.pop('sz', P, 'SEIZED  −$7  🔥+1', GOLD, t - 5, 2.2, 'big');
      const b = w.walk(1, route, sm(t, 7, 7.8) + sm(t, 7.9, 8.7) + sm(t, 8.8, 9.6));
      w.pop('toll', P, 'TOLL  $1 → WATSON', BLUE, t - 9.6, 1.8);
      for (let k = 0; k < 4; k++) w.coin(w.arc(up(b, 0.5), up(a, 0.5), 0.6, clamp01((t - 9.6 - k * 0.08) / 0.6)).clone(), 0.05 * (t > 9.6 && t < 10.3), t * 9);
      const ev = t - 11;
      if (ev > 0) { w.mood('BOOM'); for (const id of ['port', 'train', 'coal', 'bhp', 'tanker', 'forklift']) w.pulse(id, 0.5 + 0.5 * Math.sin(t * 5)); w.pop('cr', P, '+$4  COAL RUSH', GOLD, ev - 0.8, 2); }
      return { led: [[st(t, 5, 15, 8) + st(t, 9.7, 0, 1) + st(t, 11.8, 0, 4), 2, st(t, 5, 0, 1)], [st(t, 9.7, 15, 14), 2, 0], [15, 2, 0], [15, 2, 0]],
        card: ev > 0 ? { icon: '🚃', title: 'COAL RUSH', text: 'Demand for black rock goes nuclear. Everything on rails and water makes money. Mood: BOOM.', age: ev } : null };
    } },

  { id: 'qantas', dur: 11, still: 4.6, owners: O1, tokens: { 0: 'leak', 1: 'f1', 2: 'sisy', 3: 'made' },
    frame(w, t) {
      const A = w.N('qantas').clone().add(v3(0.95, 0.16, 0.4)), B = w.N('geo_missile').clone().add(v3(-0.3, 0.16, 0.9)), u = sm(t, 1.6, 7);
      const p = w.arc(A, B, 4.2, u), d = w.arc(A, B, 4.2, Math.min(1, u + 0.01), v3()).sub(p);
      if (u <= 0) w.jetParked(); else if (u < 1) { w.jet(p, d, Math.sin(u * Math.PI) * -0.35); w.hideToken(1); for (let k = 1; k < 16; k++) { const q = w.arc(A, B, 4.2, Math.max(0, u - k * 0.012), v3()); w.glow(q, 0.05, 0xffffff, 0.5 * (1 - k / 16)); } } else { w.jet(B, v3(0.4, 0, 1)); w.token(1, w.stand('geo_missile', 1)); }
      w.cam(u <= 0 ? w.N('qantas') : u < 1 ? p : w.N('geo_missile'), lerp(7.5, 10.5, Math.sin(u * Math.PI)), 0.5, lerp(0.35, -0.3, u));
      w.pop('fly', w.N('qantas'), 'FLY THE JET  −$3', BLUE, t - 0.7, 2, 'big');
      w.pop('land', w.N('geo_missile'), 'LANDED · MOVE OVER', BLUE, t - 7, 1.4);
      if (t > 8.6) w.own('geo_missile', 1);
      w.ring(w.N('geo_missile'), 0.7 + (t - 8.6) * 2.4, BLUE, 2 * (1 - sm(t, 8.6, 9.8)) * (t > 8.6));
      w.pop('sz', w.N('geo_missile'), 'SEIZED  −$8  🔥+1', BLUE, t - 8.6, 2, 'big');
      return { led: [[34, 5, 2], [st(t, 0.7, 31, 28) - st(t, 8.6, 0, 8), 4, st(t, 8.6, 1, 2)], [12, 2, 3], [40, 5, 1]] };
    } },

  { id: 'sisyphus', dur: 12.5, still: 6.4, owners: O2, tokens: { 0: 'leak', 1: 'geo_missile', 2: 'sisy', 3: 'made' },
    frame(w, t) {
      const pay = [10, 20, 40, 80]; let u = 0, cash = 12;
      for (let i = 0; i < 4; i++) { u = Math.max(u, sm(t, 0.8 + i * 2, 2.2 + i * 2) * (i + 1) / 4); if (t > 2.2 + i * 2) cash += pay[i]; }
      const gone = sm(t, 9.6, 10.4), fall = sm(t, 10.2, 11.4);
      const b = w.sisyphus(u * (1 - fall * fall), gone < 0.5);
      w.jetParked();
      w.cam(w.hillAt.clone().add(v3(1.0, 0.5, 0)), 6.4, 0.42, lerp(-0.35, 0.15, sm(t, 0, 12)));
      for (let i = 0; i < 4; i++) { const a = t - (2.2 + i * 2); w.pop('p' + i, b, '+$' + pay[i], PURPLE, a, 1.7, 'big'); if (a > 0 && a < 0.9) for (let k = 0; k < 6; k++) w.coin(v3(b.x + (rnd(k + i) - 0.5) * 0.7, b.y + 0.3 + a * (1.4 + rnd(k) * 1.2) - 2.6 * a * a, b.z + (rnd(k * 3) - 0.5) * 0.5), 0.06, t * 8 + k); }
      if (gone > 0) w.walk(2, ['sisy', 'group'], gone);
      w.pop('rs', w.N('sisy'), 'WALKED OFF · BACK TO $10', RED, t - 10.6, 1.8);
      return { led: [[34, 5, 2], [20, 4, 2], [cash, 2, 3], [40, 5, 1]] };
    } },

  { id: 'made', dur: 10, still: 4.8, owners: O2, tokens: { 0: 'leak', 1: 'geo_missile', 2: 'group', 3: 'made' },
    frame(w, t) {
      const k = sm(t, 0.4, 2.2) * (1 - sm(t, 8, 9.6)), m = w.madeGlow(0.25 + k), M = w.N('made'), G = w.stand('group', 2);
      w.cam(mid(M, M, w.N('group')).setY(0.7), lerp(6, 8.6, sm(t, 2.4, 4.5)), 0.4, lerp(0.3, -0.2, sm(t, 0, 10)));
      w.glow(m, 0.45 + k * 0.35, 0x8a2be2, k * 0.5); w.beam(up(M, 0.1), 0.42, 5, 0xa13cff, k * 0.16);
      for (let i = 0; i < 3; i++) w.ring(M, ((t * 0.7 + i / 3) % 1) * 3, 0xa13cff, 0.5 * k * (1 - ((t * 0.7 + i / 3) % 1)));
      w.pulse('made', k);
      w.pop('pay', M, '+$10  🛈+1', GREEN, t - 2.6, 2, 'big');
      for (let i = 0; i < 26; i++) { const u = (t - 3.4 - i * 0.09) / 1.5; if (u > 0 && u < 1) w.coin(w.arc(up(G, 0.5), m, 1.4 + rnd(i) * 0.8, u).add(v3((rnd(i * 3) - 0.5) * 0.3, 0, (rnd(i * 7) - 0.5) * 0.3)), 0.06 * (1 - u * u * 0.8), t * 9 + i); }
      w.pop('tax', w.N('group'), '−$24  (15%) → THE VOID', RED, t - 3.6, 2.4, 'big');
      w.pop('why', M, 'NOBODY KNOWS WHY. NOBODY.', PURPLE, t - 6.6, 2.6);
      return { led: [[34, 5, 2], [20, 4, 2], [st(t, 4.4, 162, 138), 2, 3], [st(t, 2.6, 40, 50), st(t, 2.6, 5, 6), 1]] };
    } },

  { id: 'raid', dur: 12.5, still: 6.6, owners: O2, tokens: { 0: 'leak', 1: 'geo_missile', 2: 'press', 3: 'made' },
    frame(w, t) {
      const J = w.N('jt'), Pr = w.N('press'), F = w.N('fox'), raid = t - 3.6;
      w.cam(mid(J, Pr, F, Pr, F), lerp(11.5, 9.5, sm(t, 3, 6)), 0.62, lerp(0.3, -0.15, sm(t, 0, 12)));
      w.walk(2, ['press', 'jt'], sm(t, 0.5, 1.5));
      if (t > 2.1) w.own('jt', 2);
      w.ring(J, 0.7 + (t - 2.1) * 2.4, PURPLE, 2 * (1 - sm(t, 2.1, 3.3)) * (t > 2.1));
      w.pop('ht', J, 'HOSTILE TAKEOVER  −$18  🔥+2', PURPLE, t - 2.1, 2.2, 'big');
      if (raid > 0) {
        const fl = Math.floor(t * 6) % 2;
        [Pr, F].forEach((T, i) => {
          const from = T.clone().add(v3(i ? 5 : -5, 0, 4.5)), stop = T.clone().add(v3(i ? 0.95 : -0.95, 0, 0.75)), u = sm(raid, 0.2 + i * 0.3, 1.9 + i * 0.3);
          const hd = Math.atan2(stop.x - from.x, stop.z - from.z);
          w.van(i, from.lerp(stop, u), hd);
          const sweep = sm(raid, 0.4, 2), ax = Math.sin(t * 2.2 + i * 2) * (1 - sweep) * 2.2;
          w.beam(v3(T.x + ax, 0.03, T.z + 0.2), 0.95, 9, fl === i ? 0xff3b30 : 0x3b7bff, 0.2 * sm(raid, 0, 0.5) * (1 - sm(raid, 6.4, 7.6)));
          const grab = sm(raid, 2.6, 3.6);
          w.lift(i ? 'fox' : 'press', grab * 0.55 + Math.sin(t * 3 + i) * 0.04 * grab);
          if (raid > 3.3) w.own(i ? 'fox' : 'press', null);
          w.pop('sz' + i, T, 'SEIZED BY THE REGULATORS', RED, raid - 3.3 - i * 0.25, 2.2);
        });
        w.glow(v3(Pr.x, 3.5, Pr.z), 9, fl ? 0xff2a2a : 0x2a55ff, 0.022 * (1 - sm(raid, 6, 7.5)));
        w.pop('raid', mid(Pr, F).setY(1.2), '🚨 CORTISOL 9 — RAID', RED, raid, 2.6, 'huge');
        w.pop('fine', w.stand('jt', 2), 'FINE −$36 (30%) · INTEL BURNED', RED, raid - 4.6, 2.4, 'big');
        w.pop('hf', w.N('hedge'), '+$3 · SOMEBODY WAS SHORT', GOLD, raid - 6.2, 2.4);
        if (raid > 6.2) w.pulse('hedge', 1 - sm(raid, 7.4, 8.6));
      }
      return { led: [[st(raid, 6.2, 34, 37), 5, 2], [20, 4, 2], [138 - st(t, 2.1, 0, 18) - st(raid, 4.6, 0, 36), st(raid, 4.6, 2, 1), raid > 4.6 ? 0 : st(t, 2.1, 7, 9)], [st(t, 2.1, 50, 59), 6, 1]] };
    } },

  { id: 'venice', dur: 11, still: 5.4, owners: O5, tokens: { 0: 'geo_venice', 1: 'geo_missile', 2: 'jt', 3: 'made' },
    frame(w, t) {
      const A = w.lagoon, Q = w.N('qantas'), B = Q.clone().add(v3(0, 0, 0.75));
      w.jetParked();
      w.cam(mid(A, B).setY(0.3), lerp(8.5, 7.4, sm(t, 0, 9)), 0.55, lerp(-0.3, 0.25, sm(t, 0, 11)));
      for (let i = 0; i < 2; i++) { const a = t * 0.7 + i * 3.1, g = v3(A.x + Math.cos(a) * 0.36, 0.07, A.z + Math.sin(a) * 0.36); w.box(g, 0.07, 0.035, 0.3, 0x15191a, -a); w.ball(up(g, 0.15), 0.035, 0xe7c9a5); }
      w.pop('ot', w.N('geo_venice'), 'OVERTOURISM  −$2', GOLD, t - 0.8, 2, 'big');
      const hues = [0xff6b5e, 0x55c1ff, 0xf5c542, 0x7fe08d, 0xe19bff, 0xffffff, 0xffa94d];
      for (let i = 0; i < 90; i++) {
        const u = clamp01((t - 1.6 - i * 0.05) / 3.2), fade = 1 - sm(t, 9.4, 10.6);
        if (u <= 0 || fade <= 0) continue;
        const e = u * u * (3 - 2 * u), a = rnd(i) * 6.28, r = 0.25 + rnd(i * 3) * 0.75;
        const end = v3(B.x + Math.cos(a) * r * 1.25, 0, B.z + Math.sin(a) * r * 0.6), s = v3(A.x + (rnd(i * 7) - 0.5) * 0.5, 0, A.z + (rnd(i * 11) - 0.5) * 0.5);
        const p = s.lerp(end, e); p.x += Math.sin(e * 9 + i) * 0.16 * (1 - e); p.y = Math.abs(Math.sin(t * 9 + i)) * 0.05 * fade;
        w.box(up(p, p.y + 0.07), 0.055 * fade, 0.13 * fade, 0.045 * fade, hues[i % 7]); w.ball(up(p, p.y + 0.17), 0.033 * fade, 0xe7c9a5);
        if (u >= 1 && rnd(i + Math.floor(t * 5)) > 0.93) w.glow(up(p, 0.26), 0.07, 0xffffff, 3 * fade);
      }
      w.pulse('qantas', sm(t, 4.5, 6) * (0.5 + 0.5 * Math.sin(t * 6)) * (1 - sm(t, 9.4, 10.4)));
      w.pop('c', Q, '🔥+1 AT THEIR NEXT TURN', RED, t - 6.6, 2.6, 'big');
      return { led: [[st(t, 0.8, 37, 35), 5, 2], [20, 4, st(t, 6.6, 2, 3)], [84, 1, 0], [59, 6, 1]] };
    } },

  { id: 'missile', dur: 10.5, still: 4.2, owners: O5, tokens: { 0: 'geo_venice', 1: 'geo_missile', 2: 'jt', 3: 'made' },
    frame(w, t) {
      const A = up(w.silo, 0.5), T = w.N('port'), B = T.clone().add(v3(0, 0.45, 0.1)), u = sm(t, 1.4, 5.6), hit = t - 5.6;
      const p = w.flight(0, A, B, 5.2, u, 3);
      if (u <= 0) w.missile(0, A, v3(0, 1, 0), 0);
      w.glow(up(w.silo, 0.3), 0.5, 0xffa53a, 2.5 * sm(t, 1.2, 1.5) * (1 - sm(t, 1.6, 2.6)));
      w.cam(p || (u <= 0 ? w.N('geo_missile') : T), u > 0 && u < 1 ? 9.5 : lerp(7, 8.4, sm(hit, 0, 3)), 0.5, lerp(-0.45, 0.3, sm(t, 0.5, 6.5)));
      w.pop('l', w.N('geo_missile'), 'LAUNCH  −$4  🛈−1', BLUE, t - 0.9, 1.9, 'big');
      w.boom(B, hit, 1.15, 5);
      if (hit > 0) { w.rubble('port'); w.own('port', null); }
      w.pop('x', T, 'EXPROPRIATED · NO PAYOUT', RED, hit - 0.5, 2.6, 'big');
      w.pop('r', T, 'RUBBLE — REBUILD FOR $7', WHITE, hit - 3, 0, 'tag');
      return { led: [[35, 5, 2], [st(t, 0.9, 20, 16), st(t, 0.9, 4, 3), 3], [84, 1, 0], [59, 6, 1]] };
    } },

  { id: 'tuvalu', dur: 11, still: 6.1, owners: O7, rubble: { port: 1 }, tokens: { 0: 'geo_scs', 1: 'geo_missile', 2: 'jt', 3: 'made' },
    frame(w, t) {
      const Tv = w.N('geo_tuvalu'), A = up(w.silo, 0.5), D = Tv.clone().add(v3(0.45, 1.15, 0.15)), u1 = sm(t, 3.6, 5.3), u2 = sm(t, 5.3, 6.9), back = t - 6.9;
      w.cam(mid(Tv, w.N('geo_missile')).setY(0.6), 8.6, 0.46, lerp(0.3, -0.25, sm(t, 0, 11)));
      w.walk(0, ['geo_scs', 'geo_tuvalu'], sm(t, 0.5, 1.5));
      if (t > 1.5) w.own('geo_tuvalu', 0);
      w.ring(Tv, 0.7 + (t - 1.5) * 2.4, GOLD, 2 * (1 - sm(t, 1.5, 2.7)) * (t > 1.5));
      w.pop('free', Tv, 'THE JOIN IS FREE  $0', GOLD, t - 1.5, 2, 'big');
      w.shield(sm(t, 1.6, 2.6), Math.max(0, 1 - Math.abs(t - 5.35) * 3));
      w.pop('l', w.N('geo_missile'), 'LAUNCH  −$4  🛈−1', BLUE, t - 3.1, 1.6, 'big');
      if (t < 3.6) w.missile(0, A, v3(0, 1, 0), 0);
      w.flight(0, A, D, 3.2, u1, 7); w.flight(1, D, A, 2.4, u2, 9);
      w.ring(up(D, 1.0), (t - 5.3) * 3, 0x35e0ff, 2.5 * (1 - sm(t, 5.3, 6.1)) * (t > 5.3));
      w.pop('rf', Tv, 'REFLECTED', '#35e0ff', t - 5.3, 1.6, 'huge');
      w.boom(up(w.silo, 0.3), back, 1.2, 11);
      if (back > 0) { w.rubble('geo_missile'); w.own('geo_missile', null); }
      w.pop('bb', w.N('geo_missile'), 'SILO DESTROYED IN THE BACKBLAST', RED, back - 0.5, 2.8, 'big');
      return { led: [[35, 5, 2], [st(t, 3.1, 16, 12), st(t, 3.1, 3, 2), 3], [84, 1, 0], [59, 6, 1]] };
    } },

  { id: 'blockade', dur: 12, still: 4.6, owners: O8, rubble: { port: 1, geo_missile: 1 }, tokens: { 0: 'back', 1: 'f1', 2: 'jt', 3: 'made' },
    frame(w, t) {
      const Al = w.N('albo'), Bd = w.N('bond'), wall = sm(t, 2.2, 3.2), sweep = sm(t, 0.9, 2.4);
      w.cam(v3().lerpVectors(Al, Bd, sm(t, 1, 3)).setY(0.4), lerp(6.5, 7.8, sm(t, 1, 3)), 0.55, lerp(0.35, -0.2, sm(t, 0, 12)));
      w.pulse('albo', 1 - sm(t, 1.6, 2.6)); w.pop('a', Al, 'BLOCKADE — FREE', GREEN, t - 0.5, 1.8, 'big');
      w.link(Al, Bd, GREEN, 2 * (1 - sm(t, 2.6, 3.4)), sweep, 0.1);
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * 6.283 + 0.26, p = v3(Bd.x + Math.cos(a) * 1.05, 0, Bd.z + 0.15 + Math.sin(a) * 0.82), k = sm(wall, i / 30, 0.6 + i / 30);
        w.box(up(p, 0.11 * k), 0.4, 0.22 * k, 0.12, i % 2 ? 0xf5c542 : 0x23292a, -a + Math.PI / 2);
        if (i % 3 === 0) w.glow(up(p, 0.3 * k), 0.06, 0xffb020, 3 * k * (Math.floor(t * 4 + i) % 2));
      }
      w.ring(Bd, 1.3, 0xffb020, 0.9 * wall);
      w.pop('b', Bd, '🚧 BLOCKADED UNTIL THE END OF NEXT ROUND', GOLD, t - 3, 0, 'tag');
      const bump = t - 4.2, f = clamp01(bump / 0.7), g = clamp01((bump - 0.7) / 0.6), s0 = w.stand('back', 0), s1 = w.stand('bond', 0, v3());
      if (bump > 0) w.token(0, s0.lerp(s1, 0.62 * (f - g)), Math.sin(clamp01(bump / 1.3) * Math.PI) * 0.35);
      w.pop('no', w.N('back'), 'NOBODY WALKS IN', RED, bump - 0.7, 1.7, 'big');
      const u = sm(t, 6.6, 10.2), Q = w.N('qantas').clone().add(v3(0.95, 0.16, 0.4)), X = Bd.clone().add(v3(-1.6, 2.2, 1.6)), Y = Bd.clone().add(v3(7, 5, -9));
      if (u > 0 && u < 1) { const h = u < 0.55 ? u / 0.55 : (u - 0.55) / 0.45, p = u < 0.55 ? w.arc(Q, X, 2.2, h) : w.arc(X, Y, 1, h), q = (u < 0.55 ? w.arc(Q, X, 2.2, Math.min(1, h + 0.02), v3()) : w.arc(X, Y, 1, Math.min(1, h + 0.02), v3())).sub(p); w.jet(p, q, u > 0.5 ? -0.7 * Math.sin((u - 0.5) * 2 * Math.PI) : 0); }
      w.pop('nl', w.N('back'), 'NOBODY LANDS', RED, t - 8.3, 1.8, 'big');
      return { led: [[35, 5, 2], [st(t, 6.6, 12, 9), 2, 3], [84, 1, 0], [59, 6, 1]] };
    } },

  { id: 'bondmageddon', dur: 13, still: 4.6, owners: O10, rubble: { port: 1, geo_missile: 1 }, tokens: { 0: 'bond', 1: 'f1', 2: 'jt', 3: 'made' },
    frame(w, t) {
      const A = up(w.N('bond'), 0.7), tg = ['bullock', 'oil', 'albo', 'made'], ev = t - 8.2;
      w.cam(v3(1, 0, 0.5), lerp(17, 24, sm(t, 0.5, 4)), lerp(0.5, 0.66, sm(t, 0.5, 4)), lerp(-0.3, 0.25, sm(t, 0, 13)));
      w.pulse('bond', 1 - sm(t, 6, 7)); w.pulse('leak', 1 - sm(t, 6, 7)); w.link(w.N('bond'), w.N('leak'), RED, 2.5 * (1 - sm(t, 1.5, 2.6)), sm(t, 0.2, 1.1), 0.12);
      w.pop('go', w.N('bond'), 'BONDMAGEDDON  −$16  🛈−4', RED, t - 1.1, 2.4, 'huge');
      tg.forEach((id, i) => {
        const B = w.N(id).clone().add(v3(0, 0.45, 0.1)), t0 = 2 + i * 0.4, t1 = t0 + 2.6 + i * 0.25;
        w.flight(i, A, B, 4 + i * 1.3, sm(t, t0, t1), 20 + i); w.boom(B, t - t1, 1.25, 30 + i * 9);
        w.glow(A, 0.4, 0xffa53a, 2.5 * sm(t, t0 - 0.1, t0 + 0.1) * (1 - sm(t, t0 + 0.1, t0 + 0.6)));
        if (t > t1) { w.rubble(id); w.own(id, null); w.pop('r' + i, w.N(id), 'RUBBLE', WHITE, t - t1 - 0.4, 0, 'tag'); }
      });
      if (t > 4.6) w.mood('PANIC');
      if (ev > 0) for (const id of ['us', 'japan', 'uk', 'aus', 'tenyear']) { const N = w.N(id); w.gbox(v3(N.x, 0.9 + 2.2 * sm(ev, 0.3, 1.6), N.z - 0.3), 0.08, 4.4 * sm(ev, 0.3, 1.6), 0.08, 0xff3b30, 2); w.pulse(id, 1); }
      w.pop('y', w.N('tenyear'), 'YIELDS GO VERTICAL', RED, ev - 1.2, 2.6, 'big');
      w.pop('c', w.N('bond'), '+$4  THE DESK COLLECTS', GOLD, ev - 2, 2.4);
      return { led: [[st(t, 1.1, 35, 19) + st(ev, 2, 0, 4), st(t, 1.1, 5, 1), 2], [st(ev, 2, 9, 7), 2, 3], [84, 1, 0], [59, 6, 1]],
        card: ev > 0 ? { icon: '💥', title: 'BONDMAGEDDON', text: '“The collapse of the world’s safest investment.” Every bank position pays the Bond Desk. Mood: PANIC.', age: ev } : null };
    } },

  { id: 'win', dur: 14, still: 9.5, owners: O11, rubble: { port: 1, geo_missile: 1, bullock: 1, oil: 1, albo: 1, made: 1 }, tokens: { 0: 'bond', 1: 'f1', 2: 'jt' },
    frame(w, t) {
      const set = [['hedge', 'BANK'], ['asic', 'REGULATOR'], ['tenyear', 'CHART'], ['geo_tuvalu', 'WILD'], ['coal', 'CORPORATE'], ['gold', 'COMMODITY'], ['leak', 'MEDIA']];
      w.cam(v3(0, 0, 0.6), lerp(22, 27, sm(t, 0, 14)), 0.7, lerp(-0.35, 0.35, sm(t, 0, 14)));
      let n = 0;
      set.forEach(([id, ty], i) => { const k = sm(t, 1 + i * 0.9, 1.6 + i * 0.9); if (k > 0.5) n++; w.beam(up(w.N(id), 0.05), 0.42, 6, GOLD, 0.16 * k); w.pulse(id, k); w.pop('t' + i, w.N(id), '✓ ' + ty, GOLD, t - (1.2 + i * 0.9), 0, 'tag'); });
      const done = t - 8.2;
      if (done > 0) for (let i = 0; i < 70; i++) { const a = (done - rnd(i) * 2.5) % 3; if (a < 0) continue; const b = w.stand('bond', 0); w.coin(v3(b.x + (rnd(i * 3) - 0.5) * 3 * a, 0.5 + (4 + rnd(i * 5) * 4) * a - 3.2 * a * a, b.z + (rnd(i * 7) - 0.5) * 3 * a), 0.07, t * 7 + i); }
      w.pop('w', w.N('bond'), 'THE CON IS YOURS', GOLD, done, 0, 'huge');
      return { led: [[Math.round(lerp(64, 100, sm(t, 1, 8))), 3, 2], [22, 2, 3], [91, 2, 1], [18, 4, 0]], types: n };
    } },
];
