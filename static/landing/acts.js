'use strict';
/* landing/acts: the catalogue of everything a player (or the table) can do, as film.html
   names it. Pure data — tests/film.test.mjs checks the recorded match shows every entry. */

/* id · label on the checklist · headline · the rule in one line */
export const GROUPS = [
  ['MOVING', [
    ['move', 'WALK THE THREADS', 'WALK THE THREADS', 'Three steps a turn along the red threads. More with Coal Corp HQ, a train or the running shoe.'],
    ['toll', 'PAY A TOLL', 'PAY THE TOLL', 'Stepping onto a rival’s node costs $1, paid to them. $2 if they hold Albanese; nothing if you hold James Bond.'],
    ['favor', 'BURN A FAVOR', 'BURN A FAVOR', '1 Intel, once a turn: one more step.'],
    ['slip', 'SLIPSTREAM', 'THE SLIPSTREAM', 'Formula 1, $2: two more steps and $2 off your next seizure this turn.'],
    ['fly', 'FLY THE JET', 'FLY THE JET', 'Qantas, $3: land on any node. The flight ends your move; your action still follows.'],
    ['tuvalu', 'TUVALU: THE FREE JOIN', 'THE JOIN IS FREE', 'The first player to arrive in Tuvalu simply owns it. No action, no cost, no Cortisol.'],
    ['mid', 'BACKROOM: ACT MID-MOVE', 'A BACKROOM DEAL', 'Backroom Deals lets its owner use one node ability during movement. It costs two steps, and the action still follows.'],
    ['peek', 'PEEK AT THE DECK', 'PEEK AT TOMORROW', 'The Terminal (or the Market Interface, anywhere): end your move and see the next event card.'],
    ['bury', 'BURY A CARD', 'BURY THE STORY', 'After a peek, the card goes back on top — or to the bottom of the deck.'],
  ]],
  ['TAKING', [
    ['seize', 'SEIZE', 'SEIZE IT', 'Pay the list price for the node you stand on. +1 Cortisol.'],
    ['takeover', 'HOSTILE TAKEOVER', 'HOSTILE TAKEOVER', 'Take a rival’s node for double, doubling again each time it changes hands. They pocket list price; you take +2 Cortisol.'],
    ['dossier', 'THE DOSSIER', 'THE DOSSIER', '3 Intel, free: this turn’s hostile takeovers cost list price, not double.'],
    ['deal', 'OFFER A DEAL', 'OFFER A DEAL', 'Offer one of your nodes to one rival at a price you name. They accept or decline in private. No Cortisol.'],
    ['marketsell', 'SELL TO THE MARKET', 'SELL TO THE MARKET', 'With a regulator’s file open on the book, sell a node back for its list price. It is unowned again.'],
    ['rebuild', 'REBUILD RUBBLE', 'REBUILD', 'Stand on rubble and pay the list price. It comes back unowned, buyable from next turn.'],
  ]],
  ['NODE POWERS', [
    ['push', 'PUSH THE BOULDER', 'PUSH THE BOULDER', 'Sisyphus pays $10, then doubles every push. Walk away and it resets.'],
    ['jog', 'JOG A LAP', 'JOG A LAP', 'Stand on the running shoe: a free −1 Cortisol.'],
    ['spin', 'SPIN THE PRESS', 'SPIN THE PRESS', 'The Press Room, $3: −2 of your own Cortisol, or +1 on a rival.'],
    ['foxroast', 'FOX SPIN: ROAST', 'FAIR. AND. FURIOUS.', 'Fox Business, $2: −3 of your own Cortisol, or roast a rival for +1.'],
    ['cook', 'COOK THE BOOKS', 'COOK THE BOOKS', 'The Rock, $3: −3 Cortisol. What numbers?'],
    ['pressure', 'LEAN ON THE TABLE', 'LEAN ON THE TABLE', 'Backroom Deals, free: every other player takes +1 Cortisol.'],
    ['budget', 'BUDGET NIGHT', 'BUDGET NIGHT', 'The Government, $3: every rival pays you $1, and you gain 1 Intel.'],
    ['audit', 'AUDIT', 'A VERY THOROUGH AUDIT', 'ASIC, $4: one rival takes +1 Cortisol.'],
    ['refer', 'REFER A FILE', 'REFER THE FILE', 'The ACCC or ASIC, $4: +1 scrutiny on a rival’s open file. Three scrutiny is a ruling.'],
    ['lobby', 'LOBBY THE REGULATOR', 'LOBBY THE REGULATOR', '3 Intel, free: −1 scrutiny on a file that is open on you.'],
    ['tweet', 'THE TWEET', 'THE TWEET', 'Trump, $2: a rival loses 3 Intel, or half of it if that is more.'],
    ['blockade', 'BLOCKADE', 'THE ALBANESE BLOCKADE', 'Albanese, free: wall off any node until the end of next round. Nobody walks in, nobody lands.'],
    ['jtcancel', 'JTPORTAL: CANCEL AN EVENT', 'QUITE FRANKLY, IT NEVER HAPPENED', 'JTPortal, once per game: cancel a market event as it is revealed.'],
  ]],
  ['GEOGRAPHY DLC', [
    ['missile', 'LAUNCH A MISSILE', 'MISSILE AWAY', '$4 + 1 Intel: the target is expropriated with no payout and becomes rubble. Strike a regulator and a probe follows.'],
    ['reflect', 'TUVALU REFLECTS', 'REFLECTED', 'A missile aimed at Tuvalu comes back: the launcher is destroyed, and so is another of its owner’s holdings.'],
    ['qantasdown', 'GROUND QANTAS', 'SHUT DOWN QANTAS', 'The Corporate Boeing, $4: Qantas is grounded until the end of next round and pays its owner nothing.'],
    ['oilcrash', 'OIL CRASH', 'TRIGGER AN OIL CRASH', 'The South China Sea, $3: the mood turns to PANIC and every oil node costs its owner $2.'],
    ['stage5', 'STAGE 5 DECLINE', 'CALL STAGE 5', 'Stage 5 Decline, 2 Intel: the richest rival makes no income of any kind on their next turn.'],
    ['venicecool', 'GONDOLA THERAPY', 'GONDOLA THERAPY', 'Stand in Venice: a free −1 Cortisol. Canals over committees.'],
    ['overtour', 'OVERTOURISM', 'OVERTOURISM', 'Venice, $2: send the cruise ships to a rival’s node. Its owner takes +1 Cortisol on their next turn.'],
    ['beach', 'BEACH DAY', 'BEACH DAY', 'Stand in Wonsan: a free −2 Cortisol. Nobody is watching.'],
    ['bondmageddon', 'BONDMAGEDDON', 'BONDMAGEDDON', 'The Bond Desk and The Leak together, $16 + 4 Intel: four missiles at one rival’s holdings.'],
  ]],
  ['INTEL & QUIET TURNS', [
    ['bug', 'PLANT A BUG', 'PLANT A BUG', '1 Intel, on a rival’s node next to you: skim $1 off it every turn.'],
    ['leak', 'LEAK DIRT', 'LEAK DIRT', '2 Intel: a rival takes +2 Cortisol in the morning paper.'],
    ['spy', 'SPY ON THE DECK', 'SPY ON THE DECK', '2 Intel, free: see the next event card, from anywhere.'],
    ['sweep', 'SWEEP FOR BUGS', 'SWEEP FOR BUGS', '2 Intel: every bug on your nodes is pulled.'],
    ['masspanic', 'MASS PANIC', 'MASS PANIC', '5 Intel: every player with more than one node takes +2 Cortisol. Including you.'],
    ['targetpanic', 'OVERLOAD A RIVAL', 'CORTISOL OVERLOAD', '30 Intel: one rival takes +6 Cortisol. Nine is a raid.'],
    ['divestmade', 'DIVEST MADE', 'DIVEST MADE', '5 Intel + $7: strip MADE from a rival. The $7 is their compensation; you take +1 Cortisol.'],
    ['sell', 'SELL INTEL', 'SELL INTEL', 'Sell Intel at the market rate: $2 each when calm, $3 in a frenzy, $4 in a panic.'],
    ['sellall', 'SELL ALL YOUR INTEL', 'SELL EVERYTHING YOU KNOW', 'The whole lot at the market rate. Bad news is good news: it pays $4 each in a panic.'],
    ['laylow-cash', 'LAY LOW: POCKET $1', 'LAY LOW', 'Do nothing at all, and pocket $1.'],
    ['laylow-cool', 'LAY LOW: COOL OFF', 'LAY LOW', 'Do nothing at all: −2 Cortisol.'],
  ]],
  ['THE TABLE', [
    ['turn', 'INCOME', 'INCOME', '$3 salary, plus every node you hold, its synergies and the market mood.'],
    ['event', 'MARKET EVENT', 'MARKET EVENT', 'Every turn ends with one card from the 24-card deck. It pays someone, bills someone and moves the mood.'],
    ['made', 'MADE PAYS OUT', 'MADE PAYS OUT', '+$10 and 1 Intel to its owner. Everyone else with three nodes and $50 loses 15% of their cash. Nobody knows why.'],
    ['ruling', 'A REGULATOR’S RULING', 'MONOPOLY ALERT', 'Three scrutiny on an open file: the excess is divested, with a fine of 10% of cash and Intel for each node.'],
    ['probe', 'MISSILE PROBE', 'THE INVESTIGATION', 'Strike a regulator and ASIC or the ACCC comes for you next turn: +1 Cortisol, and a coin-flip indictment.'],
    ['raid', 'REGULATOR RAID', 'REGULATOR RAID', 'Cortisol 9: your two best nodes are seized, a 30% fine, Intel burned to 1, and a wasted turn under caution.'],
    ['win', 'THE WIN', 'THE CON IS YOURS', 'Reach the cash target while holding one of every node type.'],
  ]],
];
export const ACTS = Object.fromEntries(GROUPS.flatMap(([, list]) => list.map(([id, label, title, rule]) => [id, { id, label, title, rule }])));

/* which catalogue entries a recorded beat shows */
export function chipsOf(b) {
  const has = s => (b.lines || []).some(l => l.includes(s));
  const out = [];
  switch (b.k) {
    case 'move': out.push(has('toll to') ? 'toll' : has('THE JOIN IS FREE') ? 'tuvalu' : 'move'); break;
    case 'fly': out.push('fly'); if (has('THE JOIN IS FREE')) out.push('tuvalu'); break;
    case 'laylow': out.push('laylow-' + b.choice); break;
    case 'missile': out.push(b.id === 'geo_tuvalu' ? 'reflect' : 'missile'); break;
    case 'peek': out.push((b.q || []).some(q => q.v === 'bury') ? 'bury' : 'peek'); break;
    case 'foxspin': out.push('spin'); break;
    case 'roast': out.push('spin'); break;
    default: if (ACTS[b.k]) out.push(b.k);
  }
  if (b.mid) out.push('mid');
  return out;
}
