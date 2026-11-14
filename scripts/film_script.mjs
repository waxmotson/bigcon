/* The exhibition match behind film.html: what each seat does on each turn, which event
   card is on top of the deck, and what the dice say where the rules roll them.
   scripts/build_film.mjs plays this through the real engine — if a step here is illegal
   (too few steps, too little cash, wrong phase) the build fails and says why. */
export const GOAL = 200;
export const SEATS = [
  { name: 'Mark Watson', char: 'markwatson' },
  { name: 'Tomkins', char: 'tomkins' },
  { name: 'Jim Chalmers', char: 'jimchalmers' },
  { name: 'Bessock', char: 'bessock' },
];
const W = 0, T = 1, J = 2, B = 3;

/* ---------- steps ---------- */
const A = (k, m, extra) => Object.assign({ k, ph: 'action', m: () => (Array.isArray(m) ? m : [m]) }, extra);   // needs the action phase
const M = (k, m, extra) => Object.assign({ k, m: () => (Array.isArray(m) ? m : [m]) }, extra);               // legal while moving
const route = (ctx, from, to) => {
  const blocked = id => ctx.E.blockaded(id) || !ctx.E.canReach(id);
  const prev = { [from]: null }, q = [from];
  while (q.length) { const c = q.shift(); if (c === to) break; for (const n of ctx.adj[c] || []) if (!(n in prev) && !blocked(n)) { prev[n] = c; q.push(n); } }
  if (!(to in prev)) throw new Error('no route ' + from + ' → ' + to);
  const out = []; for (let c = to; c !== from; c = prev[c]) out.unshift(c); return out;
};
const hop = id => M('move', { act: 'move', id });
/* walk all the way there this turn */
const go = to => ctx => { const me = ctx.S.players[ctx.S.cur], r = route(ctx, me.pos, to); if (r.length > ctx.S.steps) throw new Error(to + ' is ' + r.length + ' steps from ' + me.pos + ' and only ' + ctx.S.steps + ' are left'); return r.map(hop); };
/* walk as far toward it as the steps allow */
const toward = to => ctx => { const me = ctx.S.players[ctx.S.cur]; return route(ctx, me.pos, to).slice(0, ctx.S.steps).map(hop); };
const stay = M('endmove', { act: 'endmove' });
const favor = M('favor', { act: 'favor' });
const slip = M('slip', { act: 'slip' });
const fly = id => M('fly', [{ act: 'flymode' }, { act: 'fly', id }]);
const seize = A('seize', { act: 'seize' });
const seizeIntel = A('seize', { act: 'seize' }, { ans: { 'BACKROOM DEALS': 1 }, backroom: 1 });
const bug = id => A('bug', [{ act: 'bugmode' }, { act: 'bug', id }]);
const leak = target => A('leak', [{ act: 'leakmode' }, { act: 'leak', target }]);
const audit = target => A('audit', [{ act: 'auditmode' }, { act: 'audit', target }]);
const tweet = target => A('tweet', [{ act: 'tweetmode' }, { act: 'tweet', target }]);
const spin = kind => A(kind === 'fox' ? 'foxspin' : 'spin', { act: 'spin', kind }, { ans: { SPIN: 'cool' } });
const roast = (kind, target) => A(kind === 'fox' ? 'foxroast' : 'roast', [{ act: 'spin', kind }, { act: 'roast', target }], { ans: { SPIN: 'cortisol' } });
const cook = A('cook', { act: 'cook' });
const pressure = A('pressure', { act: 'pressure' });
const budget = A('budget', { act: 'budget' });
const push = A('push', { act: 'push' });
const jog = A('jog', { act: 'jog' });
const missile = id => A('missile', [{ act: 'missilemode' }, { act: 'missile', id }]);
const rebuild = A('rebuild', { act: 'rebuild' });
const beach = A('beach', { act: 'beach' });
const ground = A('qantasdown', { act: 'qantasdown' });
const oilcrash = A('oilcrash', { act: 'oilcrash' });
const stage5 = A('stage5', { act: 'stage5' });
const gondola = A('venicecool', { act: 'venicecool' });
const overtour = id => A('overtour', [{ act: 'overmode' }, { act: 'overtour', id }]);
const blockade = id => A('blockade', [{ act: 'blockmode' }, { act: 'blockade', id }]);
const spy = A('spy', { act: 'spy' });
const dossier = A('dossier', { act: 'dossier' });
const sweep = A('sweep', { act: 'sweep' });
const masspanic = A('masspanic', { act: 'masspanic' });
const overload = target => A('targetpanic', { act: 'targetpanic' }, { ans: { 'CORTISOL OVERLOAD': target }, tgt: target });
const divest = A('divestmade', { act: 'divestmade' }, { ans: { 'DIVEST MADE': 1 } });
const bondmageddon = target => A('bondmageddon', { act: 'bondmageddon' }, { ans: { 'BONDMAGEDDON': target }, tgt: target });
const marketsell = id => A('marketsell', { act: 'marketsell', id });
const lobby = kind => A('lobby', { act: 'lobby', kind });
const refer = (target, kind) => A('refer', [{ act: 'refermode' }, { act: 'refer', target, kind }]);
const deal = (target, id, n, yes = 1) => A('deal', [{ act: 'dealmode' }, { act: 'deal', target, id, n }], { ans: { 'DEAL OFFERED': yes } });
const sell = n => A('sell', { act: 'sell', n });
const sellall = A('sellall', { act: 'sellall' });
const laylow = choice => A('laylow', { act: 'laylow', choice });
/* an ability used mid-move through BACKROOM DEALS (costs two steps, the action still follows) */
const inMove = step => Object.assign({}, step, { ph: 'move', mid: 1 });

const t = (p, ev, ...rest) => { const opt = rest.length && !rest[0].k && typeof rest[0] !== 'function' && !Array.isArray(rest[0]) ? rest.shift() : {}; return { p, ev, do: rest, ...opt }; };

export const TURNS = [
  /* ── round 1 ── */
  t(W, 'quiet', go('coal'), seize),
  t(T, 'tip', go('f1'), seize),
  t(J, 'profit', go('golf'), seize),
  t(B, 'coalrush', go('bullet'), seize),
  /* ── round 2 ── */
  t(W, 'besspeak', go('train'), seize),
  t(T, 'bigscreen', slip, go('qantas'), seize),
  t(J, 'mpcfinals', go('sisy'), seize),
  t(B, 'rockcooks', go('accc'), seize),
  /* ── round 3 ── */
  t(W, 'davos', go('port'), seize),
  t(T, 'snoop', fly('geo_missile'), sell(2)),
  t(J, 'madeout', push),
  t(B, 'frenzy', go('asic'), seize),
  /* ── round 4 ── */
  t(W, 'ceophoto', go('leak'), lobby('coal'), seize),
  t(T, 'bondrevolt', seize),
  t(J, 'sisyroll', push),
  t(B, 'tapes', refer(W, 'coal')),
  /* ── round 5 ── */
  t(W, 'ibexams', laylow('cool')),
  t(T, 'crackdown', go('geo_kim'), seize),
  t(J, 'goldrush', push),
  t(B, 'quikrob', { ans: { RULING: 'coal' } }, audit(J)),      // the ACCC ruling lands as Watson's next turn starts
  /* ── round 6 ── */
  t(W, 'tariffs', go('rba'), seize),
  t(T, 'oilspike', inMove(missile('sisy')), deal(W, 'qantas', 24)),
  t(J, 'rates', go('asics'), seize),
  t(B, 'budget', go('bullock'), seize),
  /* ── round 7 ── the deck is reshuffled ── */
  t(W, 'quiet', fly('toktimer'), seize),
  t(T, 'tip', go('petronas'), seize),
  t(J, 'profit', jog),
  t(B, 'mpcfinals', go('rock'), seize),
  /* ── round 8 ── */
  t(W, 'besspeak', go('iface'), seize),
  t(T, 'frenzy', go('geo_wonsan'), seize),
  t(J, 'bigscreen', go('made'), seize),
  t(B, 'madeout', { dice: [0] }, cook),
  /* ── round 9 ── */
  t(W, 'goldrush', fly('geo_scs'), seize),
  t(T, 'snoop', beach),
  t(J, 'coalrush', go('press'), seize),
  t(B, 'rockcooks', toward('gov'), divest),
  /* ── round 10 ── */
  t(W, 'sisyroll', go('geo_tuvalu'), oilcrash),
  t(T, 'ibexams', go('geo_boeing'), seize),
  t(J, 'davos', go('back'), seize),
  t(B, 'quikrob', go('gov'), seize),
  /* ── round 11 ── */
  t(W, 'oilspike', go('geo_venice'), seize),
  t(T, 'rates', favor, go('geo_stage5'), ground),
  t(J, 'budget', inMove(spin('press')), bug('leak')),
  t(B, 'tapes', budget),
  /* ── round 12 ── */
  t(W, 'tariffs', overtour('press')),
  t(T, 'ceophoto', spy, seize),
  t(J, 'bondrevolt', inMove(pressure), go('jt'), seize),
  t(B, 'crackdown', marketsell('gov')),
  /* ── round 13 ── the deck is reshuffled ── */
  t(W, 'tip', gondola),
  t(T, 'quiet', inMove(missile('accc')), stage5),
  t(J, null, { ans: { INTERVENES: 1 } }, go('fox'), seize),
  t(B, 'rockcooks', go('albo'), seize),
  /* ── round 14 ── */
  t(W, 'mpcfinals', { dice: [0.2, 0.9] }, fly('bond'), seize),
  t(T, 'besspeak', { dice: [0.55] }, missile('geo_tuvalu')),
  t(J, 'bigscreen', roast('fox', B)),
  t(B, 'goldrush', blockade('tenyear')),
  /* ── round 15 ── */
  t(W, 'bondrevolt', bondmageddon(J)),
  t(T, 'davos', go('geo_missile'), rebuild),
  t(J, 'coalrush', go('f1'), dossier, seize),
  t(B, 'profit', go('trump'), seize),
  /* ── round 16 ── */
  t(W, 'madeout', { bury: 'sisyroll', ans: { PEEK: 'bury' } }, sweep),
  t(T, 'ibexams', go('geo_wonsan'), beach),
  t(J, 'oilspike', leak(W)),
  t(B, 'crackdown', tweet(T)),
  /* ── round 17 ── */
  t(W, 'tariffs', { ans: { 'TRUMP TWEETS TARIFFS': 'coal' } }, overload(J)),
  t(T, 'budget', sellall),
  t(J, 'quikrob', laylow('cash')),
  t(B, 'tapes', masspanic),
  /* ── round 18 ── */
  t(W, null, go('tenyear'), seize),
];
