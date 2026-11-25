/* THE EXHIBITS — the catalogue page. Renders straight from the game's own data modules, so it cannot go stale:
   data.js (the classic 70 and the Geography DLC), world.js (the GLOBAL EDITION) and engine.js (the market event cards).
   Nothing here is mirrored by hand. The build bundles this file and content-hashes it like the landing/film modules. */
import { BASE_NODES, GEO_NODES, TYPE_COLORS } from '../js/data.js';
import { WORLD_NODES, WORLD_FLOATING, regionOf } from '../js/world.js';
import { CARDS, WORLD_CARDS } from '../js/engine.js';
import { esc } from '../js/util.js';

const $ = id => document.getElementById(id);
const TYPE_ORDER = ['BANK', 'REGULATOR', 'CHART', 'WILD', 'CORPORATE', 'COMMODITY', 'MEDIA']; /* the win-set order */
const TYPE_FLAV = {
  BANK: 'the money stacks — rude, insured, and always open',
  REGULATOR: 'the cops and the crown — grab one early',
  CHART: 'the graphs that see it coming — cheap, and they feed each other',
  COMMODITY: 'the barrels and the black rock — big days when the deck draws right',
  CORPORATE: 'the shops, the machines and one overpriced kangaroo',
  MEDIA: 'the narrative machine — “quite frankly…”',
  WILD: 'the back rooms, the school and the people'
};
/* the Global Edition regions, in reading order; the gateways (Panama, Suez, Hormuz, Malacca, Iceland, Greenland) sit with their neighbours */
const GE_GROUPS = [
  { key: 'NAM', title: 'NORTH AMERICA', flav: 'Wall Street, Washington and everything the dollar touches', regs: ['NAM', 'PAN', 'GRL'] },
  { key: 'SAM', title: 'SOUTH AMERICA', flav: 'lithium, soy and a very long coastline', regs: ['SAM'] },
  { key: 'EUR', title: 'EUROPE', flav: 'old money, new regulations and a lot of vaults', regs: ['EUR', 'ISL'] },
  { key: 'MEA', title: 'THE MIDDLE EAST & AFRICA', flav: 'the oil, the straits, the minerals and the pyramids', regs: ['ME', 'AFR', 'SUZ', 'HRM'] },
  { key: 'ASIA', title: 'ASIA', flav: 'the factories, the ports and the Strait', regs: ['CAS', 'SAS', 'SEA', 'EAS', 'MAL'] },
  { key: 'OCE', title: 'OCEANIA', flav: 'the banks, the reef and the rest of the Pacific', regs: ['OCE'] },
  { key: 'ANT', title: 'ANTARCTICA', flav: 'ten territorial claims on a long ice chain', regs: ['ANT'] },
  { key: 'FLT', title: 'FLOATING', flav: 'not places — screens, graphs and boxes that drift to open ground each game', regs: [] }
];
const floatSet = new Set(WORLD_FLOATING);

/* one flat catalogue; `ed` = edition, `sect` = type (classic) or Global Edition group key */
const ALL = [];
BASE_NODES.forEach(n => ALL.push({ n, ed: 'classic', sect: n.type }));
GEO_NODES.forEach(n => ALL.push({ n, ed: 'geo', sect: 'GEO' }));
WORLD_NODES.forEach(n => {
  const g = floatSet.has(n.id) ? GE_GROUPS.find(x => x.key === 'FLT') : (GE_GROUPS.find(x => x.regs.includes(regionOf(n))) || GE_GROUPS.find(x => x.key === 'OCE'));
  ALL.push({ n, ed: 'world', sect: g.key });
});
const byId = {};
ALL.forEach(e => { byId[e.n.id] = e; });
const EVENTS = CARDS.map(c => ({ c, ed: 'classic' })).concat(WORLD_CARDS.map(c => ({ c, ed: 'world' })));
const evById = {};
EVENTS.forEach(e => { evById[e.c.id] = e; });

let showGeo = true, showWorld = true, onlyTypes = new Set(), query = '';
const nameOf = n => n.name.join(' ');
const colorOf = n => TYPE_COLORS[n.type] || '#6b4fa0';
const SHAPE_SIZE = { photo: [140, 92], wide: [170, 100], bubble: [150, 80], logo: [150, 80], chart: [130, 64], news: [150, 84], made: [140, 74], mpc: [164, 96], sat: [170, 90] };
const figRatio = n => { const [a, b] = SHAPE_SIZE[n.shape] || [150, 80]; return (a - 10) + '/' + (b - 22); };
const edPill = e => e.ed === 'geo' ? '<span class="pill g">🌍 GEO DLC</span>' : e.ed === 'world' ? '<span class="pill w">🌐 GLOBAL EDITION</span>' : '';

/* a node with no picture shows a styled text card: its icon and name on its type colour */
function placeholder(n, ratio) {
  return '<div class="ph txt" style="--c:' + colorOf(n) + ';aspect-ratio:' + (ratio || '140/58') + '"><span class="pi">' + esc(n.icon || '📌') + '</span><span class="pn">' + esc(nameOf(n)) + '</span></div>';
}
function figure(n) {
  if (!n.image) return '<div class="fig">' + placeholder(n, figRatio(n)) + '</div>';
  return '<div class="fig"><img loading="lazy" decoding="async" data-id="' + esc(n.id) + '" style="aspect-ratio:' + figRatio(n) + '" src="' + encodeURI(n.image) + '" alt="' + esc(nameOf(n)) + '"></div>';
}
function cardHtml(e) {
  const n = e.n;
  return '<article class="card ' + e.ed + '" id="x-' + esc(n.id) + '" data-id="' + esc(n.id) + '" style="--c:' + colorOf(n) + '">'
    + figure(n)
    + '<div><h3 class="nm">' + esc(nameOf(n)) + '</h3><div class="pillrow">'
    + '<span class="pill t" style="--c:' + colorOf(n) + '">' + n.type + '</span>'
    + '<span class="pill k">+$' + n.income + ' / TURN</span><span class="pill k">SEIZE $' + n.cost + '</span>' + edPill(e) + '</div></div>'
    + '<p class="sub">' + esc(n.sub || '') + '</p>'
    + '<p class="shot clamp">' + esc(n.sp || '') + '</p>'
    + '</article>';
}
const secHtml = (title, flav, color, list) =>
  '<section class="sec" style="--c:' + color + '"><div class="sechead"><h2>' + title + '</h2><span class="sflav">' + flav + '</span><span class="scount">' + list.length + ' EXHIBIT' + (list.length !== 1 ? 'S' : '') + '</span></div><div class="cards">' + list.map(cardHtml).join('') + '</div></section>';
const edHead = (cls, title, sub, count) => '<div class="edhead ' + cls + '"><h2>' + title + '</h2><span>' + sub + '</span><b>' + count + '</b></div>';
function evHtml(e) {
  const c = e.c;
  return '<article class="card ev ' + e.ed + '" data-ev="' + esc(c.id) + '" style="--c:' + (e.ed === 'world' ? '#168388' : '#f5c542') + '">'
    + '<div class="evtop"><span class="evi">' + esc(c.icon) + '</span><h3 class="nm">' + esc(c.title) + '</h3></div>'
    + (e.ed === 'world' ? '<div class="pillrow"><span class="pill w">🌐 GLOBAL EDITION ONLY</span></div>' : '')
    + '<p class="shot">' + esc(c.text) + '</p></article>';
}

const visible = e => (e.ed !== 'geo' || showGeo) && (e.ed !== 'world' || showWorld) && (!onlyTypes.size || onlyTypes.has(e.n.type));
function renderSections() {
  const vis = ALL.filter(visible);
  let html = '';
  const classic = vis.filter(e => e.ed === 'classic');
  if (classic.length) {
    html += edHead('classic', 'THE CLASSIC EXHIBITS', 'the original evidence board', classic.length + ' / ' + BASE_NODES.length);
    TYPE_ORDER.forEach(t => { const l = classic.filter(e => e.n.type === t); if (l.length) html += secHtml(t, TYPE_FLAV[t], TYPE_COLORS[t], l); });
  }
  const geo = vis.filter(e => e.ed === 'geo');
  if (geo.length) {
    html += edHead('geo', '🌍 THE GEOGRAPHY DLC', 'extra pins for the classic board — host-toggled in the lobby', geo.length + ' / ' + GEO_NODES.length);
    html += secHtml('GEOGRAPHY DLC', 'missiles, resorts and one very nervous island', '#4f7a3a', geo);
  }
  const world = vis.filter(e => e.ed === 'world');
  if (world.length) {
    html += edHead('world', '🌐 THE BIG CON: GLOBAL EDITION', 'the world map — these pins exist only here (the classic and Geography pins ride along on it too)', world.length + ' / ' + WORLD_NODES.length);
    GE_GROUPS.forEach(g => { const l = world.filter(e => e.sect === g.key); if (l.length) html += secHtml(g.title, g.flav, '#168388', l); });
  }
  html += edHead('events', '🎴 THE MARKET EVENT DECK', 'one card resolves for the whole table at the end of every turn', CARDS.length + ' CLASSIC + ' + WORLD_CARDS.length + ' GLOBAL EDITION');
  html += '<section class="sec" style="--c:#f5c542"><div class="sechead"><h2>CLASSIC EVENTS</h2><span class="sflav">in every game</span><span class="scount">' + CARDS.length + ' CARDS</span></div><div class="cards evs">'
    + EVENTS.filter(e => e.ed === 'classic').map(evHtml).join('') + '</div></section>';
  html += '<section class="sec" style="--c:#168388"><div class="sechead"><h2>GLOBAL EDITION EVENTS</h2><span class="sflav">dealt into the deck only on the world map</span><span class="scount">' + WORLD_CARDS.length + ' CARDS</span></div><div class="cards evs">'
    + EVENTS.filter(e => e.ed === 'world').map(evHtml).join('') + '</div></section>';
  html += '<p class="fine">Cash amounts on the cards are for a $100 table; the host’s target scales them. Everything on this page is read live from the game’s own data modules, so it always matches the current rules.</p>';
  $('grid').innerHTML = html;
  applySearchDim();
  const nc = k => vis.filter(e => e.ed === k).length;
  $('counts').innerHTML = '<b>' + vis.length + '</b> exhibits · ' + nc('classic') + ' classic · <b style="color:#8fd">' + nc('geo') + ' 🌍 geo</b> · <b style="color:#7fe0e6">' + nc('world') + ' 🌐 global</b> · <b>' + EVENTS.length + '</b> event cards';
}
function applySearchDim() {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#grid .card').forEach(c => {
    let hit = !q;
    if (q) {
      const n = c.dataset.id && byId[c.dataset.id];
      const ev = c.dataset.ev && evById[c.dataset.ev];
      const hay = n ? (nameOf(n.n) + ' ' + n.n.type + ' ' + (n.n.sub || '') + ' ' + (n.n.sp || '')) : ev ? (ev.c.title + ' ' + ev.c.text) : '';
      hit = hay.toLowerCase().includes(q);
      c.classList.toggle('dim', !hit);
    } else c.classList.remove('dim');
    c.classList.toggle('hit', hit && !!q);
  });
}
/* a failed picture becomes the text placeholder, never a broken image */
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.id || !byId[img.dataset.id]) return;
  const t = document.createElement('div');
  t.innerHTML = placeholder(byId[img.dataset.id].n, img.style.aspectRatio || '140/58');
  img.replaceWith(t.firstChild);
}, true);

/* ───── modal ───── */
let cur = null;
const order = () => Array.from(document.querySelectorAll('#grid .card:not(.dim)')).map(c => c.dataset.id ? 'node:' + c.dataset.id : 'ev:' + c.dataset.ev);
function openKey(key) {
  const kind = key.split(':')[0], id = key.slice(kind.length + 1);
  let body;
  if (kind === 'node') {
    const e = byId[id]; if (!e) return;
    const n = e.n;
    body = '<div class="mhero">' + (n.image ? '<img data-id="' + esc(n.id) + '" src="' + encodeURI(n.image) + '" alt="' + esc(nameOf(n)) + '">' : placeholder(n, '16/5')) + '</div>'
      + '<div class="mbody"><h3 class="mname">' + esc(nameOf(n)) + '</h3><p class="sub" style="margin:2px 0 0">' + esc(n.sub || '') + '</p>'
      + '<div class="pillrow"><span class="pill t" style="--c:' + colorOf(n) + '">' + n.type + '</span><span class="pill k">+$' + n.income + ' / TURN</span><span class="pill k">SEIZE $' + n.cost + '</span>' + edPill(e)
      + (e.ed === 'world' ? '<span class="pill">' + esc(GE_GROUPS.find(g => g.key === e.sect).title) + '</span>' : '') + '</div>'
      + '<div class="mmech"><p>' + esc(n.sp || '') + '</p></div></div>';
  } else {
    const e = evById[id]; if (!e) return;
    body = '<div class="mhero"><div class="ph" style="font-size:96px;height:200px">' + esc(e.c.icon) + '</div></div><div class="mbody"><h3 class="mname">' + esc(e.c.title) + '</h3>'
      + '<div class="pillrow">' + (e.ed === 'world' ? '<span class="pill w">🌐 GLOBAL EDITION ONLY</span>' : '<span class="pill k">CLASSIC · EVERY GAME</span>') + '</div>'
      + '<div class="mmech"><p>' + esc(e.c.text) + '</p></div></div>';
  }
  const list = order(), i = list.indexOf(key), can = list.length > 1 && i > -1;
  cur = key;
  $('mcard').innerHTML = body + '<div id="mnav">' + (can ? '<button id="mprev" title="Previous">‹</button><button id="mnext" title="Next">›</button>' : '') + '</div><div id="mpos">' + (can ? (i + 1) + ' / ' + list.length : '') + '</div>';
  $('ovl').classList.add('show'); document.body.style.overflow = 'hidden';
}
function closeOvl() { $('ovl').classList.remove('show'); document.body.style.overflow = ''; cur = null; $('mcard').innerHTML = ''; }
function step(d) { const l = order(); if (!cur || l.length < 2) return; const i = Math.max(0, l.indexOf(cur)); openKey(l[((i + d) % l.length + l.length) % l.length]); }
$('ovl').addEventListener('click', e => { if (e.target.id === 'ovl') closeOvl(); });
$('mclose').addEventListener('click', closeOvl);
$('mcard').addEventListener('click', e => { if (e.target.id === 'mprev') step(-1); else if (e.target.id === 'mnext') step(1); });
window.addEventListener('keydown', e => { if (e.key === 'Escape') closeOvl(); if (e.key === 'ArrowRight' && cur) step(1); if (e.key === 'ArrowLeft' && cur) step(-1); });

/* ───── interactions ───── */
document.addEventListener('click', e => {
  const c = e.target.closest('.tchip');
  if (c && c.dataset.t) {
    const t = c.dataset.t;
    if (onlyTypes.has(t)) onlyTypes.delete(t); else onlyTypes.add(t);
    c.classList.toggle('on', onlyTypes.has(t)); $('chipAll').classList.toggle('on', !onlyTypes.size); renderSections(); return;
  }
  if (c && c.id === 'chipAll') { onlyTypes.clear(); document.querySelectorAll('#chips .tchip').forEach(x => x.classList.remove('on')); c.classList.add('on'); renderSections(); return; }
  const card = e.target.closest('#grid .card');
  if (card) openKey(card.dataset.id ? 'node:' + card.dataset.id : 'ev:' + card.dataset.ev);
});
$('geoToggle').addEventListener('change', e => { showGeo = e.target.checked; $('geoT').classList.toggle('on', showGeo); renderSections(); });
$('worldToggle').addEventListener('change', e => { showWorld = e.target.checked; $('worldT').classList.toggle('on', showWorld); renderSections(); });
$('search').addEventListener('input', e => { query = e.target.value; applySearchDim(); });
$('search').addEventListener('keydown', e => { if (e.key === 'Enter') { const f = document.querySelector('#grid .card.hit:not(.dim),#grid .card:not(.dim)'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });

$('chips').innerHTML = TYPE_ORDER.map(t => '<button class="tchip" data-t="' + t + '" style="--c:' + TYPE_COLORS[t] + '"><span class="sw"></span>' + t + ' <span class="n">' + ALL.filter(e => e.n.type === t).length + '</span></button>').join('');
$('geoLab').textContent = '🌍 GEOGRAPHY DLC ' + GEO_NODES.length;
$('worldLab').textContent = '🌐 GLOBAL EDITION ' + WORLD_NODES.length;
renderSections();
