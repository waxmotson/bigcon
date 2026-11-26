'use strict';
/* ui: modal/toast, help, rendering, pan/zoom/input wiring and the setup-screen click wiring. Browser only.
   Nothing runs at import time: initUI() (called once from app.js boot) attaches every listener. toast/modal/render are
   installed as hooks and every module calls them through `hooks`. */
import { $, IS_DISCORD_ACTIVITY, Presence } from './core.js';
import { hooks } from './hooks.js';
import { LOG_SHOWN, Net, S } from './state.js';
import { GOAL_MAX, GOAL_MIN, clampGoal, esc } from './util.js';
import { CLASSIFIED_INTEL, CLASSIFIED_MONEY, classifiedBlocked, hiddenFrom, hiddenInfo, ACCC_RULING, INDBYID, WIN_TYPES, addChat, applyIntent, filesOf, ownedInIndustry, blockaded, canFireMissileFrom, canMissileNode, canReach, flatSeize, goalAmount, hasType, initGame, missingTypes, nodeName, noTakeover, worldBlocked, hasEdge, isVanished, chokeToll, svalbardFreeRebuild, ownsMissileLauncher, pname, projRig, qantasGrounded, qantasGroundedReason, seizeListPrice, takeoverCost, blocStatus, tariffFor, tariffOwner, blockSources, blockadeFree, reefBleached, fileAuthority, isWaterNode } from './engine.js';
import { TRADE_BLOCS, blocOfMember, BLOC_FREE } from './world.js';
import { launderBooks, reworkBlocked, honeypotBan, swissBalance, abductTargets, inflationExtra, pyramidPayout } from './engine.js';
import { applyLayoutFromState, boardViewBounds, megaRingMetrics, nodeBox, ringworldMetrics, worldMapSVG } from './boards.js';
import { ADJ, BUZZWORDS, EDGES, MOODS, NMAP, NODES, QUIK_SLOTS, TYPE_COLORS, charSrc, codeLabel, matchBuzzword } from './data.js';
import { addBotSeat, applyChar, backToLobby, broadcastLobby, cleanName, guestJoin, hostCreate, kickBotSeat, sendAll, setBoardLayout, setFogUI, setGeoUI, setGoalUI, setWorldUI, setNetStatus, toggleSpectate } from './net.js';
const shownFx=new Set();
let svgEl=null;
/* the unsent chat line survives the sidebar being re-rendered */
let chatDraft='';
let toastTimer=null;
export function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2400)}
export function modal(o){return new Promise(res=>{
 const ov=document.createElement('div');ov.className='overlay';
 const card=document.createElement('div');card.className='mcard';
 const t=document.createElement('div');t.className='mtitle';t.textContent=o.title||'';
 const b=document.createElement('div');b.className='mbody';
 if(o.html)b.innerHTML=o.html;
 if(o.body){const p=document.createElement('p');p.textContent=o.body;b.appendChild(p)}
 const opts=document.createElement('div');opts.className='mopts';
 (o.options||[{label:'Continue',v:1}]).forEach(op=>{const bt=document.createElement('button');bt.textContent=op.label;bt.onclick=()=>{document.body.removeChild(ov);res(op.v)};opts.appendChild(bt)});
 card.appendChild(t);card.appendChild(b);card.appendChild(opts);ov.appendChild(card);document.body.appendChild(ov);
})}
/* ================= LOCAL DESKTOP TURN ALERTS =================
   Alerts are opt-out and default on. Permission is requested only from a
   user gesture; the preference is local to this browser/device. */
const TURN_ALERTS_KEY='bigcon-v1.14-turn-alerts';
let lastTurnAlertKey='',lastDeliveredTurnAlertKey='';
export function turnAlertsEnabled(){try{return localStorage.getItem(TURN_ALERTS_KEY)!=='off'}catch(_){return true}}
export function requestTurnNotificationPermission(){
 if(!turnAlertsEnabled()||typeof Notification==='undefined')return;
 if(Notification.permission==='denied'){hooks.toast('Turn alerts are blocked by browser or system notification settings.');return}
 if(Notification.permission==='default'){
  try{Notification.requestPermission().then(p=>{if(p==='granted')notifyCurrentTurn(true)}).catch(()=>{})}catch(_){}
 }else if(Notification.permission==='granted')notifyCurrentTurn(true);
}
export function notifyCurrentTurn(force){
 if(!S||S.over||S.cur!==Net.myIdx||!turnAlertsEnabled())return;
 const key=S.turn+':'+S.cur;
 if(!force&&key===lastTurnAlertKey)return;
 lastTurnAlertKey=key;
 if(lastDeliveredTurnAlertKey===key||typeof Notification==='undefined'||Notification.permission!=='granted')return;
 try{
  const p=S.players[S.cur];const n=new Notification('THE BIG CON v1.14 — Your turn',{body:(p&&p.name?p.name+' — ':'')+'It is your move. Open the game to make your play.',tag:'bigcon-turn-'+key,renotify:false});
  lastDeliveredTurnAlertKey=key;
  n.onclick=()=>{try{window.focus()}catch(_){}try{n.close()}catch(_){}};
 }catch(_){}
}
export function toggleTurnAlerts(){
 const next=!turnAlertsEnabled();
 try{localStorage.setItem(TURN_ALERTS_KEY,next?'on':'off')}catch(_){}
 if(next)requestTurnNotificationPermission();
 hooks.toast('Desktop turn alerts '+(next?'enabled':'disabled')+'.');
 render();
}
export function showRules(){
 hooks.modal({title:'HOW TO PULL THE BIG CON',html:
 '<h4>Online play (2–8 players)</h4><p>One player <b>hosts</b> and shares the room code — a jt portal <b>buzzword</b> (NESA, LOW CORTISOL, JAKE TOMKINS…), every one of them straight off the jt portal news ticker; the others <b>join</b> by typing it — the table seats up to <b>eight</b>. Short a friend? The host can <b>🤖 seat a bot</b> — it plays through the same rules, sends the same moves, and only ever knows what the table shows it. Or hand your <b>own seat</b> to a bot too and spectate: a table full of cons, and you just watch (and chat). Each player sees only their own secret prompts. If someone drops, their seat is held and auto-plays “lay low” ($1, turn over) — rejoin with the <b>same name</b> to reclaim your empire. The table plays on: joining <b>mid-con</b> deals you in fresh at <b>Quikstop</b> — $15 and 2 Intel, the same stake every first turn gets — or you can take the <b>spectator rail</b> and just watch. Chat in the <b>lobby</b> before the con starts, and in the sidebar once it does.</p>'
 +'<h4>The market mood — events you can feel</h4><p>Every market event shifts the mood of the whole board — watch the <b>ticker</b> across the top, the <b>tint</b> of the board and the <b>glowing nodes</b>: <b style="color:#f5c542">BOOM</b> (commodities +$1/turn), <b style="color:#ff6b5e">PANIC</b> (banks −$1/turn, intel dearer), <b style="color:#e19bff">MEDIA FRENZY</b> (media +$1/turn), <b style="color:#8fbf7f">CALM</b>. The mood also sets what Intel sells for: <b>$2</b> (CALM/BOOM), <b>$3</b> (FRENZY), <b>$4</b> (PANIC). Yields go vertical in a panic; the oil graph spikes in a boom. Money, Cortisol and Intel changes pop up on the board as they happen.</p>'
 +'<h4>Intel ops (🛈)</h4><ul><li><b>Burn a favor</b> (1 🛈, while moving, once per turn) — +1 step this turn.</li><li><b>Spy on the deck</b> (2 🛈, free action) — privately see the next event card, anywhere.</li><li><b>The Dossier</b> (3 🛈, free action) — your hostile takeovers this turn cost <b>list price, not double</b>.</li><li><b>Sweep for bugs</b> (2 🛈, your action) — remove every bug on your nodes.</li><li><b>Mass panic</b> (5 🛈, your action) — every player gains +2 Cortisol (holders of only one node are immune).</li><li><b>Divest MADE</b> (5 🛈 + $7, your action) — strip MADE from any rival; the $7 goes to its former owner as compensation, and you take +1 Cortisol.</li><li><b>Sell intel</b> (your action, anywhere): sell 1–3 or <b>ALL</b> your Intel at once for the current market rate ($2–$4 each, set by the mood) — it uses your action. Bad news is good news.</li><li><b>Overload a rival</b> (30 🛈, your action): choose one rival to receive <b>+6 Cortisol</b>, bypassing the normal one-node immunity.</li><li><b>Lobby</b> (3 🛈, free, once per turn, while a regulator file is open on you) — −1 scrutiny on that file.</li></ul>'
 +'<h4>The board is the whole collage</h4><p><b>70 exhibits</b> (82 with the DLC), and everyone starts at <b>Quikstop</b> with $15 and 2 Intel. Every con deals a fresh board — the host picks <b>Random</b> (positions and threads reshuffled, the prized nodes seeded far from Quikstop, MADE out on the edge with one or two links, and Quikstop opening in a different neighbourhood each game), <b>RINGWORLD</b> (three concentric rings around Quikstop) or <b>MEGA RING</b> (one big ring plus a Quikstop hub). Red threads are the paths — long ones dash. <b>Fog of War</b> (host-toggled): you only see exhibits you have already visited, plus a <b>?</b> on the ones one step away. <i>Drag to pan, scroll to zoom; hover a node to light up its links, right-click to pin the route to it.</i></p>'
 +'<h4>Winning</h4><p><b>Money <i>and</i> a finished portfolio.</b> The host sets a cash target in the lobby (anything from $'+GOAL_MIN+' to $'+GOAL_MAX+'); to take the con you must reach it <b>while holding at least one '+WIN_TYPES.join(', one ')+' node</b> — the seven-type set (BANK, REGULATOR, CHART, WILD, CORPORATE, COMMODITY and MEDIA) is tracked in your sidebar. There are only four REGULATORS on the base board (seven with the DLC), so the set is a race of its own; if several players qualify at once, the richest wins. Nodes, synergies, bugs and the mood are all just ways of getting there faster — the board banner and the sidebar show the target and who is closest.</p>'
 +'<h4>Your turn</h4><p><b>1 · Income</b> — $3 salary (+$1 CPI-indexed with Inflation Compensation) + holdings &amp; powers &amp; mood. <b>2 · Move</b> — 3 steps (+1 with COAL CORP HQ, +1 with the Coal Train <i>or</i> the Bullet Train, +1 with the ASICS shoe, +1 by burning a favor). Tolls: $1 entering a rival’s node — $2 if they hold Albanese, free if you hold James Bond. <b>3 · One action</b> (plus free intel ops — Spy and the Dossier; most other ops are your action). <b>4 · Market event</b> — one card from the 36-card deck (43 on the Global Edition) hits the whole table, and the mood moves. Card dollars are written for a $100 table and <b>scale with the host’s target</b> (a $300 table pays and charges three times as much; never less than $1). A raided player skips income and gets one step.</p>'
 +'<h4>Actions</h4><ul><li><b>Seize</b> the node you stand on (+1 🔥). Hostile takeover: double cost, doubling again every time the node is taken (list price with the Dossier; MADE, Qantas, the RBA and ESG Pillars never inflate), old owner pockets list price, +2 🔥, +$2 ACCC fee if they own the ACCC. Short on cash? Backroom Deals covers up to $3 with Intel.</li><li><b>Plant a bug</b> (1 🛈; free with INSIDER TRADING) on a rival node next to you — skim $1/turn ($2 with the WEF).</li><li><b>Offer a deal</b> (your action) — offer one of your nodes to one rival for a whole-dollar price you name, from $0 up to their cash. They accept or decline in private, and a declined offer still uses your action. On a yes the cash and the node change hands and any bugs on it are cleared; nobody takes Cortisol, and the node’s takeover price is unchanged.</li><li><b>Sell to the market</b> (your action, only for a node in a book with an open ACCC/ASIC file) — list price, and the node is unowned again · <b>Refer</b> ($4, the ACCC or ASIC owner, once per turn) — a rival’s open file +1 scrutiny.</li><li><b>Leak dirt</b> (2 🛈) — rival +2 Cortisol · <b>Audit</b> ($4, ASIC) — rival +1 Cortisol · <b>The Tweet</b> ($2, Trump) — rival loses the greater of 3 Intel or 50% of their Intel.</li><li><b>Spin</b> ($3 Press Room) / <b>Fox Spin</b> ($2 Fox Business) · <b>Cook the books</b> ($3, The Rock) · <b>Budget night</b> ($3, the Government: every rival pays you $1, +1 🛈) · <b>Lean on the table</b> (Backroom Deals: every rival +1 🔥; using a Backroom ability during movement costs 2 steps).</li><li><b>Push the boulder</b> — earns $10 the first time, then doubles every push ($10, $20, $40, $80…), resetting to $10 if you walk off (Backroom Deals keeps it) or the node changes hands. No Cortisol cost. · <b>Fly the Qantas jet</b> ($3, during movement, teleport anywhere — ends your move) · <b>Slipstream</b> ($2, Formula 1: +2 steps and $2 off the next seizure) · <b>Lay low</b> (choose $1 cash or −2 Cortisol). · <b>Blockade</b> (free, Albanese, once per turn) — wall off literally any node until the end of next round: nobody walks in, nobody lands, not even you.</li></ul>'
 +'<p><b>BONDMAGEDDON</b> (own both the Bond Desk and “Bond Markets Revolt” — The Leak; $16 + 4 🛈, once per turn): pick any rival with intact holdings and launch four missiles at random holdings — each becomes rubble (no DLC needed). If they own the ESG Pillars, three missiles hit ESG and the fourth hits another random holding.</p>'
 +'<p><b>JAMES BOND — CLASSIFIED</b> (own the “JAMES BOND, CITIBANK · 007” polaroid; 1 🛈 or $3, free, once per turn, in your move or action phase): file <b>any node</b> away until the end of next round. Everyone but you and the node’s holder sees only a <b>?</b> — no name, owner, ability or bugs. It is information only: rivals can still walk or fly onto it and seize it blind, but cannot pick it as a bug, missile, Overtourism or blockade target. Under <b>Fog of War</b> every rival who had been there also forgets it for good (they must visit again). It lapses if Bond changes hands. He still pays no tolls.</p>'
 +'<h4>Cortisol &amp; raids</h4><p>Cortisol is capped at 9, and a player holding only one node (or none) cannot gain Cortisol at all (only the 30-Intel Overload bypasses this). At 🔥9 the regulators raid you, and a raid hurts: your <b>two</b> highest-income nodes are seized, every bug you planted is pulled, you pay a fine of $5 or 30% of your cash (whichever is larger), your Intel is burned down to 1, Cortisol resets to 0 and your <b>next turn brings no income and a single step</b>. <b>The whole table sees the raid</b> — it pops up on every screen. The Hedge Fund pays $3 on every raid; the Group Photograph pays 1 🛈 Intel.</p>'
 +'<h4>ACCC concentration — the regulators keep a file</h4><p>Twelve industries are tracked. Five are type-based — banking, regulators, corporates, commodities and media (charts and WILD nodes don’t count toward them) — and seven are themed books listed by name: coal, oil, education, JTPortal, Jim Chalmers, Big Bessent and monetary policy (MONETARY POLICY also counts the CASH-RATE and INFLATION charts). A themed book is <b>concentrated at 3</b> holdings. A type-based industry is concentrated at <b>a third of its size on the live board, rounded up, never fewer than 3</b>: three banks, regulators or corporates, but <b>four</b> media or four commodities (there are 11 media and 10 commodities, 12 and 11 with the Geography DLC). Hold that many and the regulator <b>opens a public file</b> on the book — every player’s open files are listed in THE SYNDICATE. <b>ASIC</b> runs monetary-policy books as <b>market manipulation</b>; the <b>ACCC</b> takes every other industry. There are no dice: at the start of each of <b>your</b> turns every open file on you gains <b>+1 scrutiny</b>, and at <b>3</b> the ruling lands. You choose which nodes to keep, down to one fewer than the trigger; only the excess is divested, back to the market <b>unowned</b> (never to a rival, and any bugs on it are pulled), and you pay <b>10% of your cash and 10% of your Intel per divested node</b>, capped at 30% each. A file closes the moment the book drops back under the trigger, however that happens — a sale, a deal, a takeover, a raid, a missile — and its scrutiny is discarded. While a file is open you can <b>sell a node from that book to the market</b> for its list price (your action), or <b>lobby</b> (3 🛈, free, once per turn) for −1 scrutiny on one of your files (never below 0). The owner of the <b>ACCC</b> can <b>REFER</b> a rival’s file ($4, your action, once per turn) for +1 scrutiny; the owner of <b>ASIC</b> refers monetary-policy files the same way. You can’t refer your own file, and a referral never rules on the spot — rulings only land at the start of the offender’s own turn. The <b>MONOPOLY ALERT</b> event adds +1 scrutiny to every open file on the table. Owning <b>Mark Watson</b> exempts your holdings in the COAL industry from ACCC monopoly investigations.</p>'
 +'<h4>MADE (???)</h4><p>Nobody knows what the purple graphic is, but it moves money: at the <b>start of every player\'s turn</b> there is a chance MADE pays out (<b>33% at 2 seats, 22% at 3, 17% at 4, 13% at 5, 11% at 6, 10% at 7, 8% at 8</b>) — <b>+$10 and +1 Intel</b> to its owner. Every other player with <b>more than two nodes and at least $50</b> pays 15% of their cash to the void. Seizing MADE always costs list price — it never inflates after a takeover. You may also force MADE to divest from any rival for <b>5 Intel + $7</b> (the $7 goes to the former owner as compensation, and you take +1 Cortisol).</p>'
 +'<h4>📰 Market events — the second batch</h4>'
 +'<ul><li><b>BANK RUN</b> — everyone loses 25% of their cash above $40 unless they own a BANK or REGULATOR (the IMF collects $3). <b>THE ROYAL COMMISSION</b> — every open regulator file +2 scrutiny; every BANK owner +1 Cortisol. <b>ROBODEBT</b> — everyone pays 10% of their cash to the bank. <b>GAMESTOP SQUEEZE</b> — the poorest takes 20% of the richest’s cash; the Hedge Fund’s owner pays the poorest a further $3. <b>FTX COLLAPSES</b> — anyone with 6+ Intel loses half.</li>'
 +'<li><b>CROWDSTRIKE BLUE SCREEN</b> — for one full round: no flights (Qantas, the Cruise Ship, launches), no Terminal peeks, no bug actions. <b>COVID LOCKDOWN</b> — next round everyone moves at most 1 step and flights are grounded; MEDIA nodes pay $2. <b>TOILET PAPER PANIC</b> — everyone +1 Cortisol; the Quikstop owner takes $10 from each rival. <b>EOFY SALE</b> — every seizure costs $2 less this round (min $1). <b>SWIFTONOMICS</b> — Qantas, the Marketplace, the Quikstop and the tourism nodes (Venice, Wonsan, Tuvalu, the Pyongyang Hotel, the Cruise Ship, Marina Bay, Monaco, the Reef, the Burj, the Pyramids, Fiji) pay $3 each. <b>IRON ORE CRASH</b> — BHP, Vale, COAL Corp, Codelco, Potosí and the Indonesian nickel pay nothing for a round. <b>RATE CUT</b> — everyone +$2 and −1 Cortisol.</li>'
 +'<li><b>Global Edition only:</b> <b>HOUTHIS IN THE RED SEA</b> — all four chokepoints are blockaded until the end of next round; the Tanker Fleet pays $3. <b>SANCTIONS</b> — Gazprom, Nord Stream, the Kremlin, the Shahed drone and the North Korean cluster pay nothing for a round and their owners take +1 Cortisol. <b>CHINA BANS AUSTRALIAN COAL</b> — COAL Corp, the Coal Train, the Docks, Watson and BHP pay nothing for two rounds. <b>THE PANAMA PAPERS</b> — +2 Cortisol per tax haven you own; Apple’s owner +1 more. <b>BRICS SUMMIT</b> — BRICS members pay ×2 and American nodes half for a round. <b>EL NIÑO</b> — Fonterra, ANZCERTA, the Amazon and the Tulip Bulb pay nothing for a round, and the Reef bleaches. <b>A TARIFF WAR</b> — the Tariff Wall surcharge doubles until the end of next round; the WTO owner collects $3. A “round” is one full rotation of the table’s turns after the card.</li></ul>'
 +'<h4>🌐 THE BIG CON: GLOBAL EDITION</h4><p>Two host-chosen options in the lobby. <b>GLOBAL EDITION EXHIBITS</b> add <b>100+ global exhibits</b> — central banks, chokepoints, mines, wealth funds, a Nigerian prince — to <i>any</i> board layout (Random, Ringworld, Mega Ring) and combines freely with the Geography DLC. The <b>THE BIG CON: GLOBAL EDITION</b> map pins every exhibit to the place it really lives on a world map (and switches the exhibits on): <b>Quikstop opens in Sydney</b>, Wall Street is in New York, Hormuz is in the Gulf. Threads follow geography — neighbours link up inside their region and the regions meet at gateways: Panama joins the Americas, Suez joins Europe, the Middle East and Africa, Hormuz joins the Gulf to South Asia, Malacca joins South Asia to the Pacific side, and Antarctica is a ring road of ten territorial claims, closed across the date line (the Peninsula, Queen Maud Land, the Australian Antarctic Territory and the Ross Dependency touch the outside world; nothing else does). Europe and North America touch <i>only</i> through Iceland and Greenland, and The Rock lets you sail off the right edge of the map and back in from the left. Exhibits that are not places (screens, charts, the boulder) float to a random open spot each game. The new exhibits ship as <b>text cards</b> (name and icon) until their pictures arrive. Most pay through simple synergies — per node type, a partner node, start-of-turn Cortisol or Intel, and windfalls on events like OIL SPIKES or GOLD RUSH; nodes marked ⚙ have income, price and seizing working while their special ability is still being wired up.</p>'
 +'<h4>🎭 Node reworks</h4><ul>'
+'<li><b>NAB</b> — FEE FOR NO SERVICE: a rival who <i>ends their movement</i> on any node you own pays you an extra $2, on top of tolls. <b>WESTPAC</b> — 23 MILLION BREACHES (free, once per turn): burn 1 Intel for $3, and the laundering adds +1 scrutiny to an ASIC/ACCC file on you (BANKING or MONETARY POLICY, your pick); a file opened this way rules as a fine of 15% of your cash. <b>COMMONWEALTH BANK</b> — CAN’T BE BEAT: once per game you may refuse a hostile takeover of any of your nodes; it fails, they keep their money (but spend their action). <b>ANZ</b> — you are warned privately a turn ahead when BONDMAGEDDON is the next event.</li>'
+'<li><b>QUIKSTOP</b> — THE SERVO: +$2 a turn for every player at the table (4 players = +$8). <b>THE GOLF CLUB</b> — THE BACK NINE: once per turn, a free action in your action phase: swap one of your nodes for a rival’s, with cash from either side; they accept or decline in private (bugs on both are cleared; the old $1 seizure discount is gone). <b>JIM CHALMERS</b> — TREASURY BRIEF: at your turn start, privately see the next two market events and choose which is drawn next.</li>'
+'<li><b>Global Edition:</b> <b>BAIKONUR</b> also lets you ESCAPE ON THE ROCKET once per game: a raid on you is cancelled, your pawn flies to the cosmodrome (or a node you choose) and Cortisol drops to 5. <b>ZIMBABWE</b> — PRINT MONEY (once per game, your action): +20% of the goal, then every seizure costs +$1 more for good (inflation; shown on the strip above THE TURN). <b>THE SWISS VAULT</b> — stash cash (your action) beyond the reach of raids, fines, events and loans; withdraw freely once per turn from anywhere; stashed cash does not count toward the goal. <b>AREA 51</b> — ALIEN ABDUCTION (once per game, $4 + 3 Intel, your action): steal a rival’s node remotely; 50% it arrives as rubble. It cannot take Antarctica, MADE, anyone still holding an unused Commonwealth Bank refusal, Seed Vault holdings or Pillars holdings. <b>THE WALL STREET BELL</b> — RING THE BELL ($2, your action, once per turn): the next market event resolves now, and a rival’s regulator file opens or gains +1 scrutiny. <b>THE TURKISH LIRA</b> — once per game, every rival loses 20% of cash above $30. <b>THE BAHT 1997</b> — CONTAGION: when anyone is raided, every rival of the Baht’s owner with a node in the raided pawn’s region takes +1 Cortisol. <b>SRI LANKA</b> — DEFAULT (free, once per game): all your debts are wiped and your tolls this turn are free. <b>THE PYRAMIDS</b> — a rival who seizes a node adjacent to one of yours pays $1, then $2, $4, $8… (doubling each time; reset by THE BOULDER ROLLS BACK DOWN). <b>GREENLAND</b> — with DONALD TRUMP, force-buy Greenland at list price once per game.</li></ul>'
+'<h4>🌐 Global Edition — trade blocs, the WTO, the water and the reef</h4>'
 +'<ul><li><b>TRADE BLOCS</b> — <b>THE EU SINGLE MARKET</b> and <b>BRICS</b>. Own the bloc node and your income from its <b>member nodes</b> (EU: the ECB, Deutsche Bank, Bunds, BTP, Greek Debt, Luxembourg, ASML, Tulip, OPEC Vienna, Rotterdam, the Paris master chart, the Brussels Pillars, Venice; BRICS: nodes in Brazil, Russia, India, China and South Africa) is multiplied by <b>1 + 0.25 per member you hold, capped at ×2.5</b>. It is added at income time and logged; hover the bloc node to see your members, multiplier and file. The catch: with <b>4 or more members</b> a <b>WTO file</b> opens on you, each member held <b>beyond 3</b> adds that much scrutiny at each of your turn starts (4 members: +1, 5: +2, 6: +3), and at 3 the ruling lands — you keep 3 members, the rest return to the market, and you pay the usual 10% fine per node. Lobby, sell to the market or drop below 4 members to close it. <b>THE ANTARCTIC TREATY</b> is a third bloc over the nine territorial claims: the same multiplier, but Antarctica is outside the WTO’s jurisdiction, so no file ever opens — and while anyone owns the Treaty, the Peninsula sovereignty disputes are settled, but every other player holding Antarctic territory takes +1 Cortisol at the start of each of their turns (the Treaty recognises only its owner). The owner of <b>THE WTO</b> can <b>REFER</b> a rival’s bloc file ($4, your action, once per turn) for +1 scrutiny.</li>'
 +'<li><b>BLOCKADE</b> — ALBANESE, <b>THE GREAT BARRIER REEF</b> and <b>CRITICAL PATH ANALYSIS</b> each grant it. With one source it is a once-per-turn <b>action</b> (it ends your turn, as ever). Hold <b>any two</b> of the three and it becomes a <b>FREE action</b> — once per turn, in your move or action phase, using neither your action nor your movement. Only one blockade per turn, however many sources you hold. The Reef stops counting while it is bleached.</li>'
 +'<li><b>CORAL BLEACHING</b> — an extra market event that only exists on the Global Edition. The Reef’s blockade and income are off for the next 2 rounds and its owner takes +1 Cortisol.</li>'
 +'<li><b>THE CRUISE SHIP</b> — standing on a <b>WATER node</b> (the four chokepoints, the South China Sea, Venice, Wonsan, Tuvalu, Fiji, Nauru, Papua New Guinea, Sri Lanka, Easter Island, the Caymans, the BVI, Bermuda, Svalbard, Iceland, Greenland, the Reef, Hawaii (The Rock), Marina Bay, Dover, Nord Stream, Barcelona, the Docks, the Tanker Fleet and the Rotterdam barrel yard), pay $2 in your move phase to sail to any other WATER node; the voyage ends your move. Its owner takes +1 Cortisol each turn unless they also own a REGULATOR.</li>'
 +'<li><b>THE IMF</b> — BAILOUT (your action, once per turn): lend a rival $6 of your own money; $8 is due to you at the start of their next-but-one turn, or they take +2 Cortisol and the loan is written off. One IMF loan per rival at a time.</li>'
 +'<li><b>THE TARIFF WALL</b> — free, once per turn: name a node type. Rivals pay $2 extra (to the wall’s owner) whenever they seize or take over a node of that type. The current wall is shown above THE TURN.</li>'
 +'<li><b>WOOLWORTHS</b> — your seizures cost $1 less, and every seizure you make gives each rival +1 Cortisol. <b>ANZCERTA</b> replaces the NZ sheep: +$1 per Australian or NZ node and no tolls between them. <b>APPLE</b> pays $2 per tax haven; <b>THE 20-FOOT BOX</b> $1 per chokepoint; <b>OVERSEAS FILIPINO WORKERS</b> −1 Cortisol a turn and $1 per region you hold a node in; <b>THE DOHA ROUND</b> (once per game) pays $2 per commodity for 3 turns, then stalls.</li></ul>'
 +'<h4>🌍 The Geography DLC — the board expands over the water</h4><p>Host-toggled in the lobby (look for <b>ENABLE THE GEOGRAPHY DLC</b>). <b>On: the board deals 82 exhibits.</b> Off: the same 70 exhibits as always.</p>'
 +'<ul><li><b>MISSILE COMMAND ($8) / IRANIAN SHAHED DRONE ($8)</b> — you can own <b>MISSILE COMMAND or the SHAHED DRONE</b>, but not both. Either owned launch site can LAUNCH A MISSILE ($4 + 1 🛈, once per turn): stand on the launcher you own to fire, or own KIM JONG UN to fire from anywhere — during your move (the launch ends it) or as your action. You can’t hit your own nodes, or any other node held by the Pillars owner. An <b>owned node is expropriated with NO payout</b> to its former owner; either way it becomes <b>RUBBLE</b> until rebuilt at list price. The <b>ESG Pillars themselves can be missile-struck</b>, and the shield falls with them. Strike a <b>REGULATOR</b> and an investigation opens — <b>ASIC or the ACCC</b> comes for you on your next turn: a 50/50 indictment, and <b>+1 Cortisol</b> whether it lands or not.</li>'
 +'<li><b>PYONGYANG CITY ($6)</b> — +$1 income per Geography node you own. The capital collects tribute.</li>'
 +'<li><b>PYONGYANG HOTEL ($8)</b> — collects <b>$2</b> whenever anyone rebuilds rubble. Construction kickbacks, allegedly.</li>'
 +'<li><b>WONSAN RESORT ($5)</b> — stand there (owned) for <b>BEACH DAY</b>: free, once per turn, <b>−2 Cortisol</b>.</li>'
 +'<li><b>IRANIAN SHAHED DRONE ($8)</b> — a second missile launch site using the same rules and cost as MISSILE COMMAND; one player cannot own both.</li>'
 +'<li><b>KIM JONG UN ($6)</b> — <b>+1 Intel at the start of each of your turns</b>. Owning him exempts you from either launcher’s on-site rule — the keys work from anywhere.</li>'
 +'<li><b>THE CORPORATE BOEING ($7)</b> — SHUT DOWN QANTAS ($4, once per turn): the kangaroo is <b>grounded until the end of next round</b> — nobody can walk or fly to it, and its owner collects nothing from it (you can’t ground your own).</li>'
 +'<li><b>THE SOUTH CHINA SEA ($9)</b> — TRIGGER AN OIL CRASH ($3, once per turn): PANIC mood, and every player pays <b>$2 per oil node</b> they own (Pillars players exempt).</li>'
 +'<li><b>STAGE 5 DECLINE ($4)</b> — CALL STAGE 5 (2 🛈, once per turn): the <b>richest player</b> (never you) makes <b>no income of any kind on their next turn</b>.</li>'
 +'<li><b>PILLARS OF SUSTAINABILITY ($6)</b> — <b>ESG SHIELD</b>: −1 Cortisol each of your turns; your other holdings can’t be missile-struck while you hold the Pillars (the Pillars themselves can, and are the main BONDMAGEDDON target), but they remain vulnerable to Overtourism; you pay nothing on an oil crash and Stage 5 cannot call you.</li>'
 +'<li><b>VENICE DI CCTV ($8)</b> — stand there (owned) for <b>GONDOLA THERAPY</b>: free, once per turn, −1 Cortisol. Or, as your action, send <b>OVERTOURISM</b> ($2, once per turn, one or the other): pick a rival-owned node (including ESG holdings) — the target takes <b>+1 Cortisol</b> on their turn during the next full table rotation. It ends when the rotation finishes or Venice changes hands.</li>'
 +'<li><b>TUVALU .TV ($5)</b> — THE JOIN IS FREE: the first player to arrive simply owns it. No action, no cost, no Cortisol. <b>Missiles aimed at Tuvalu are REFLECTED</b> back onto the launcher’s own holdings — and their silo blows up in the backblast.</li></ul>'
 +'<h4>Turn notifications &amp; player identity</h4><p>Desktop turn alerts are enabled by default. Use <b>TURN ALERTS</b> in the game sidebar to switch them on or off; your choice is saved on this device. Your browser or desktop app must allow notifications for alerts to appear. Choose a character in the lobby to lock in that character’s dedicated player colour, shown beside the portrait and used throughout the game. Player names support up to 80 characters.</p><p class="fine">No dice. The dice were rigged from the start.</p>',
 options:[{label:'Back to the con',v:1}]});
}

/* ================= RENDERING (shared by host & guests) ================= */
export function render(){
 if(!S)return;
 
 notifyCurrentTurn(false);applyLayoutFromState();
 if(want3d()&&!view3d&&!view3dPending)set3d(true);
 renderBoard();renderSide();
 if(!S.over){
  const me=S.players[Net.myIdx];
  const cur=S.players[S.cur];
  Presence.inGame(S.turn,pname(S.cur),S.cur===Net.myIdx,me?me.money:0,goalAmount(),S.players.filter(pl=>!pl.dc).length,me?me.char:null,Net.roomLabel||Net.roomCode,cur?cur.char:null,Net.role==='host');
 }
}
export function moodBoost(n){
 if(!S)return 0;
 if(S.mood==='BOOM'&&n.type==='COMMODITY')return 1;
 if(S.mood==='PANIC'&&n.type==='BANK')return -1;
 if(S.mood==='FRENZY'&&n.type==='MEDIA')return 1;
 return 0;
}
/* A node with no `image` is a styled text card: its type colour, the icon and the name. Give the node an `image`
   path and the picture takes over — nothing else has to change. */
/* Colour emoji drawn as SVG <text> are re-rasterised glyph by glyph on every zoom/pan frame, and the Global Edition board carries ~200 of them
   (a 10× frame-time cost, measured). Each icon is painted ONCE onto a canvas and reused as a bitmap <image>, which the browser scales for free.
   Without a canvas (the Node test harness) it falls back to the plain text glyph. */
const EMOJI_SPRITES=new Map();
export function emojiSprite(ch){
 if(EMOJI_SPRITES.has(ch))return EMOJI_SPRITES.get(ch);
 let url=null;
 try{
  const c=typeof document!=='undefined'&&document.createElement?document.createElement('canvas'):null;
  const x=c&&c.getContext?c.getContext('2d'):null;
  if(x&&c.toDataURL){
   c.width=c.height=96;
   x.font='80px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
   x.textAlign='center';x.textBaseline='middle';x.fillText(ch,48,54);
   const u=c.toDataURL('image/png');if(typeof u==='string'&&u.startsWith('data:image/png'))url=u;
  }
 }catch(_){url=null}
 EMOJI_SPRITES.set(ch,url);return url;
}
export function placeholderCardSVG(n,w,h){
 const esc=t=>String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const col=TYPE_COLORS[n.type]||'#168388',lines=(nodeName(n)||[n.id]).slice(0,3),longest=Math.max(...lines.map(l=>String(l).length),4);
 const fs=Math.max(9,Math.min(17,(w-52)/(0.64*longest))),ty=-(lines.length-1)*fs*0.55+fs*0.3;
 const sp=emojiSprite(n.icon||'❔');
 return '<g class="node-card"><rect x="'+(-w/2)+'" y="'+(-h/2)+'" width="'+w+'" height="'+h+'" fill="#17201f" stroke="'+col+'" stroke-width="3"/>'
  +'<rect x="'+(-w/2)+'" y="'+(-h/2)+'" width="'+w+'" height="14" fill="'+col+'"/>'
  +'<text x="'+(-w/2+8)+'" y="'+(-h/2+11)+'" font-size="9" font-weight="900" letter-spacing="1.5" fill="#fff">'+esc(n.type)+(n.todo?' · ⚙':'')+'</text>'
  +(sp?'<image href="'+sp+'" x="'+(-w/2+7)+'" y="'+(h/2-39)+'" width="30" height="30"/>':'<text x="'+(-w/2+22)+'" y="'+(h/2-14)+'" text-anchor="middle" font-size="26">'+(n.icon||'❔')+'</text>')
  +lines.map((l,i)=>'<text x="'+(w/2-(w-46)/2+2)+'" y="'+(ty+i*fs*1.1+6)+'" text-anchor="middle" font-size="'+fs.toFixed(1)+'" font-weight="800" fill="#f4f0e6" font-family="Tomkins Display, Bricolage Grotesque, sans-serif">'+esc(l)+'</text>').join('')
  +'</g>';
}
export function nodeSVG(n,cls){
 const me=S&&S.players[Net.myIdx];
 const classified=hiddenFromMe(n.id);
 const discovered=!S||((!S.fogOfWar||(me&&me.visited&&me.visited[n.id]))&&!classified);
 if(!discovered){
  /* Unknown destinations are hinted only when they are directly reachable.
     Other unseen locations leave no marker, so the hidden map cannot be read.
     A CLASSIFIED site on a plain (no-fog) board stays drawn, as an unknown card. */
  if(cls.indexOf('reach')<0&&!(classified&&!S.fogOfWar))return '';
  const box=nodeBox(n),w=box[0],h=box[1];
  return '<g class="node fog-node click'+(cls.indexOf('reach')>=0?' reach':'')+'" transform="translate('+n.x+','+n.y+')" data-id="'+n.id+'" opacity=".94"><rect x="'+(-w/2)+'" y="'+(-h/2)+'" width="'+w+'" height="'+h+'" fill="#101716" stroke="#7ff6fb" stroke-width="3" stroke-dasharray="7 6"/><text text-anchor="middle" y="5" font-size="18" font-weight="900" fill="#7ff6fb">?</text></g>';
 }
 const o=S?S.owner[n.id]:null;
 const ownr=o!=null;
 const oc=ownr?S.players[o].color:'#8a7a5f';
 const bug=S&&S.bugs[n.id]!=null;
 const rb=S&&S.rubble&&S.rubble[n.id];
 const ot=S&&S.dlcGeo&&S.ov&&S.ov.nid===n.id;
 const gq=S&&S.dlcGeo&&n.id==='qantas'&&qantasGrounded();
 const md=MOODS[S?S.mood:'CALM'];
 const mb=moodBoost(n);
 const box=nodeBox(n),w=box[0],h=box[1];
 let halo='';
 if(cls.indexOf('reach')>=0||cls.indexOf('target')>=0){
  halo='<rect x="'+(-w/2-6)+'" y="'+(-h/2-6)+'" width="'+(w+12)+'" height="'+(h+12)+'" fill="none" stroke="'+(cls.indexOf('target')>=0?'#55c1ff':'#fff')+'" stroke-width="2.5" stroke-dasharray="5 7"/>';
 }
 let moodGlow='';
 if(mb!==0){
  moodGlow='<rect class="moodhalo" x="'+(-w/2-5)+'" y="'+(-h/2-5)+'" width="'+(w+10)+'" height="'+(h+10)+'" fill="none" stroke="'+md.color+'" stroke-width="3.5" stroke-dasharray="3 6"/>';
 }
 let ownerGlow='';
 if(ownr){
  ownerGlow='<rect x="'+(-w/2-5)+'" y="'+(-h/2-5)+'" width="'+(w+10)+'" height="'+(h+10)+'" fill="none" stroke="'+oc+'" stroke-width="7" opacity=".95"/><rect x="'+(-w/2-1)+'" y="'+(-h/2-1)+'" width="'+(w+2)+'" height="'+(h+2)+'" fill="none" stroke="#000" stroke-width="1.4"/>';
 }
 const ownerTag=ownr?'<circle cx="'+(w/2-10)+'" cy="'+(-h/2+10)+'" r="8" fill="'+oc+'" stroke="#000" stroke-width="1.5"/><text x="'+(w/2-10)+'" y="'+(-h/2+13.5)+'" text-anchor="middle" font-size="8" font-weight="900" fill="#fff">'+String(o+1)+'</text>':'';
 const bugTag=bug?'<text x="'+(w/2-24)+'" y="'+(-h/2+18)+'" font-size="12">🐛</text>':'';
 const bl=S&&blockaded(n.id);
 const filed=hiddenInfo(n.id)&&!hiddenFromMe(n.id);
 const badges=(filed?'<text x="'+(w/2-48)+'" y="'+(-h/2+18)+'" font-size="12">🗂️</text>':'')+(ot?'<text x="'+(w/2-36)+'" y="'+(-h/2+18)+'" font-size="12">🛳️</text>':'')+(gq?'<text x="'+(-w/2+6)+'" y="'+(-h/2+18)+'" font-size="12">⛔</text>':'')+(bl?'<text x="'+(-w/2+7)+'" y="'+(-h/2+18)+'" font-size="15" font-weight="900">🚧</text>':'')+(S&&S.dlcWorld&&n.id==='w_pyramids'?'<text x="0" y="'+(h/2-6)+'" text-anchor="middle" font-size="15" font-weight="900" fill="#ffd34d" stroke="#000" stroke-width="3" paint-order="stroke">🔺 $'+pyramidPayout()+'</text>':'')+(S&&S.dlcWorld&&n.id==='w_zim'&&inflationExtra()>0?'<text x="0" y="'+(h/2-6)+'" text-anchor="middle" font-size="15" font-weight="900" fill="#ff9a8a" stroke="#000" stroke-width="3" paint-order="stroke">📈 +$'+inflationExtra()+'</text>':'');
 const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 return '<g class="node '+cls+'" data-id="'+n.id+'" transform="translate('+n.x+','+n.y+') rotate('+n.rot+')">'
  +ownerGlow+moodGlow+halo
  +(n.image?'<image class="node-image" href="'+n.image+'" x="'+(-w/2)+'" y="'+(-h/2)+'" width="'+w+'" height="'+h+'" preserveAspectRatio="none"/>':placeholderCardSVG(n,w,h))
  +(rb?'<rect x="'+(-w/2)+'" y="'+(-h/2)+'" width="'+w+'" height="'+h+'" fill="rgba(8,6,6,0.72)"/><text x="0" y="-4" text-anchor="middle" font-size="22">💥</text><text x="0" y="16" text-anchor="middle" font-size="9" font-weight="900" fill="#ffb08a" letter-spacing="1">REBUILD $'+n.cost+'</text>':'')
  +ownerTag+bugTag+badges
  +'<title>'+esc(nodeTip(n)).replace(/\n/g,'&#10;')+'</title></g>';
}
/* the Global Edition's extra tooltip lines for a node: trade-bloc multiplier and scrutiny, the tariff wall, the bleached reef, WATER nodes */
export function worldTip(n){
 if(!S||!S.dlcWorld)return '';
 let t='';
 const me=Net.myIdx,seated=me!=null&&me>=0&&me<S.players.length;
 const bid=TRADE_BLOCS[n.id]?n.id:blocOfMember(n.id);
 if(bid){
  const b=TRADE_BLOCS[bid],bn=NMAP[bid]?nodeName(NMAP[bid]).join(' '):b.short;
  if(n.id===bid){
   t+='\n'+b.icon+' MEMBER NODES ('+b.members.filter(id=>NMAP[id]).length+'): '+b.members.filter(id=>NMAP[id]).map(id=>NMAP[id].name.join(' ')).join(', ')+'.';
   const st=seated?blocStatus(me).find(x=>x.id===bid):null;
   if(st)t+='\n'+b.icon+' YOURS: '+st.k+' member node'+(st.k===1?'':'s')+' · income ×'+st.mult.toFixed(2)+' · +$'+st.bonus+'/turn'+(st.noWto?' · outside the WTO: no file':st.file?' · WTO file '+st.file.s+'/'+ACCC_RULING:st.k>BLOC_FREE?' · a WTO file is about to open':'')+(st.step?' · scrutiny +'+st.step+' per turn':'')+'.';
   else if(S.owner[bid]!=null)t+='\n'+b.icon+' Owned by '+pname(S.owner[bid])+'.';
  }else t+='\n'+b.icon+' A MEMBER of '+bn+'. The bloc owner multiplies its income ×(1 + 0.25 per member held, max 2.5)'+(b.noWto?'; the treaty is outside the WTO’s jurisdiction, so no file ever opens.':', and '+(BLOC_FREE+1)+' or more members open a WTO file.');
 }
 if(n.id==='w_tariffwall')t+='\n🧱 The wall stands on: '+(S.tariffType||'nothing yet')+'.';
 else if(S.tariffType===n.type&&tariffOwner()!=null)t+='\n🧱 TARIFF WALL: rivals of '+pname(tariffOwner())+' pay $2 extra to seize a '+n.type+' node.';
 if(n.id==='w_gbr'&&reefBleached())t+='\n🪸 BLEACHED: its blockade and income are off until the end of round '+(S.bleachUntil-1)+'.';
 if(isWaterNode(n.id))t+='\n🌊 A WATER node: the Cruise Ship calls here.';
 if(n.id==='w_pyramids')t+='\n🔺 The next PYRAMID payout: $'+pyramidPayout()+' (it doubles every time it pays and resets when THE BOULDER ROLLS BACK DOWN).';
 if(n.id==='w_zim'&&inflationExtra()>0)t+='\n📈 INFLATION: every seizure on the board costs +$'+inflationExtra()+'.';
 if(S.imf&&n.id==='w_imf'){const l=Object.keys(S.imf).map(k=>pname(+k)+' (due in '+S.imf[k].left+' of their turns)');if(l.length)t+='\n🆘 Open loans: '+l.join(', ')+'.'}
 return t;
}
/* A node's hover text, as plain lines: the SVG board's <title> and the 3D board's tooltip. */
export function nodeTip(n){
 const o=S?S.owner[n.id]:null;
 const rb=S&&S.rubble&&S.rubble[n.id];
 const ot=S&&S.dlcGeo&&S.ov&&S.ov.nid===n.id;
 const bl=S&&blockaded(n.id);
 let t=nodeName(n).join(' ')+' — '+n.type+' · $'+n.income+'/turn · seize $'+n.cost+'\n'+(n.sub||'')+'\n'+(n.sp||'');
 if(n.todo)t+='\n⚙ Ability still being wired up — income, price and seizing already work.';
 if(bl)t+='\n🚧 BLOCKADED — entry and Qantas landing are prohibited until the blockade expires.';
 t+=worldTip(n);
 if(rb)t+='\n💥 RUBBLE — arrive and pay $'+n.cost+' in your action phase to rebuild. No income, nothing to seize until rebuilt.';
 if(ot)t+='\n🛳️ OVERTOURISM — its owner takes +1 Cortisol on their next turn (one rotation, or until Venice changes hands).';
 if(S&&!rb)t+=priceTip(n,o).replace(/&#10;/g,'\n');
 return t;
}
/* Hover price line: what the NEXT seizure of this node costs. Mirrors doSeize —
   your own discounts (seizeListPrice, Slipstream), then the takeover doubling
   (2× after the first seizure, doubling again each time it changes hands; the
   Dossier and the flat nodes pay list). Spectators see the undiscounted price. */
export function priceTip(n,o){
 const me=Net.myIdx,seated=me!=null&&me>=0&&me<S.players.length;
 const taken=S.seizeCount[n.id]||0,flat=flatSeize(n.id);
 const mult=flat?1:Math.pow(2,Math.max(1,taken));
 const times=taken?' · taken '+taken+'×':'';
 if(o==null){
  if(!seated)return '&#10;💰 Seize: $'+n.cost+(flat?' — never inflates':'');
  let base=seizeListPrice(me,n);if(S.slipped===true&&S.cur===me&&S.owner.f1===me)base=Math.max(1,base-2);
  const tf0=tariffFor(me,n.id);
  return '&#10;💰 Seize for you: $'+(base+tf0+inflationExtra())+(tf0?' (incl. $'+tf0+' TARIFF WALL)':'')+(inflationExtra()?' (incl. $'+inflationExtra()+' INFLATION)':'')+(flat?' — never inflates':' · once owned, a takeover costs $'+n.cost*Math.pow(2,Math.max(1,taken+1))+times);
 }
 if(seated&&o===me)return '&#10;⚔️ A rival’s takeover costs $'+n.cost*mult+' (list $'+n.cost+(flat?', never inflates':'')+times+') — you pocket the $'+n.cost+' buyout'+(S.owner.accc===me?' + $2 ACCC fee':'')+'.';
 const fee=S.owner.accc===o?' + $2 ACCC fee':'';
 if(!seated)return '&#10;⚔️ Takeover: $'+n.cost*mult+fee+(flat?' — never inflates':times);
 let base=seizeListPrice(me,n);if(S.slipped===true&&S.cur===me&&S.owner.f1===me)base=Math.max(1,base-2);
 const dossier=!flat&&S.dossier&&S.cur===me;
 const cost=flat||dossier?base:base*mult;
 const tf=seated?tariffFor(me,n.id):0;
 return '&#10;⚔️ Takeover for you: $'+(cost+tf+inflationExtra())+fee+(tf?' (incl. $'+tf+' TARIFF WALL)':'')+(inflationExtra()?' (incl. $'+inflationExtra()+' INFLATION)':'')+(flat?' — never inflates':dossier?' — the Dossier holds it to list':' ('+(mult)+'× list'+times+'; doubles again after)')+'.';
}
export function tokenLayer(){
 const byPos={};S.players.forEach((p,i)=>{if(isVanished(i))return;(byPos[p.pos]=byPos[p.pos]||[]).push(i)});
 const SLOTS=[[-62,-58],[62,-58],[-90,-6],[90,-6],[-62,58],[62,58],[0,-70],[0,70]];
 let s='<g pointer-events="none"><defs>';
 S.players.forEach((p,i)=>{s+='<clipPath id="faceclip'+i+'"><circle r="14"/></clipPath>'});
 s+='</defs>';
 Object.keys(byPos).forEach(nid=>{
  const n=NMAP[nid];const idxs=byPos[nid];
  idxs.forEach((pi,k)=>{
   const p=S.players[pi];if(S.fogOfWar&&pi!==Net.myIdx&&!(S.players[Net.myIdx]&&S.players[Net.myIdx].visited&&S.players[Net.myIdx].visited[nid]))return;const off=SLOTS[k%SLOTS.length];
   const src=charSrc(p.char);
   s+='<g transform="translate('+(n.x+off[0])+','+(n.y+off[1])+')">'
    +(pi===S.cur?'<circle class="ringp" r="19" fill="none" stroke="'+p.color+'" stroke-width="2.5" stroke-dasharray="4 5"/>':'')
    +'<circle r="15.5" fill="#000" stroke="'+p.color+'" stroke-width="2.5"/>'
    +(src?'<image href="'+src+'" x="-14" y="-14" width="28" height="28" preserveAspectRatio="xMidYMid slice" clip-path="url(#faceclip'+pi+')"/>':'<text text-anchor="middle" y="4.5" font-size="11" font-weight="800" fill="#fff">'+(pi+1)+'</text>')
    +'</g>';
  });
 });
 return s+'</g>';
}
export function scribble(x,y,rx,ry,rot){return '<g transform="translate('+x+','+y+') rotate('+rot+')" opacity=".8" pointer-events="none"><ellipse rx="'+rx+'" ry="'+ry+'" fill="none" stroke="#d92b1f" stroke-width="3.5" stroke-dasharray="14 9"/><ellipse rx="'+(rx-6)+'" ry="'+(ry-4)+'" fill="none" stroke="#d92b1f" stroke-width="2" stroke-dasharray="20 14" opacity=".7"/></g>'}
export function redArrow(x1,y1,x2,y2){
 const a=Math.atan2(y2-y1,x2-x1);const hx=x2-16*Math.cos(a),hy=y2-16*Math.sin(a);
 const px=Math.cos(a+Math.PI/2)*6,py=Math.sin(a+Math.PI/2)*6;
 return '<g pointer-events="none" opacity=".6"><path d="M'+x1+','+y1+' L'+hx+','+hy+'" stroke="#d92b1f" stroke-width="3" stroke-dasharray="10 7" fill="none"/><polygon points="'+x2+','+y2+' '+(hx+px)+','+(hy+py)+' '+(hx-px)+','+(hy-py)+'" fill="#d92b1f"/></g>';
}
export function scribText(x,y,rot,txt){return '<text x="'+x+'" y="'+y+'" transform="rotate('+rot+' '+x+' '+y+')" font-size="15" font-style="italic" font-weight="700" fill="#d92b1f" opacity=".85" pointer-events="none">'+txt+'</text>'}
export function bugTargetable(n){
 const me=Net.myIdx;
 return S&&S.phase==='action'&&S.mode==='bug'&&myTurn()
  &&S.owner[n.id]!=null&&S.owner[n.id]!==me
  &&S.bugs[n.id]==null&&!hiddenFromMe(n.id)
  &&(ADJ[S.players[me].pos]||[]).includes(n.id);
}
export function missileTargetable(n){
 const me=Net.myIdx;
 return S&&(S.phase==='action'||S.phase==='move')&&S.mode==='missile'&&myTurn()&&S.dlcGeo
  &&canMissileNode(me,n.id)&&!hiddenFromMe(n.id);
}
/* James Bond's CLASSIFIED: any node may be filed away */
export function classifiedTargetable(n){
 return !!(S&&(S.phase==='action'||S.phase==='move')&&S.mode==='classified'&&myTurn()&&S.owner.bond007===Net.myIdx);
}
export function hiddenFromMe(id){return !!(S&&hiddenFrom(Net.myIdx,id))}
export function overtourTargetable(n){
 const me=Net.myIdx;
 return S&&S.phase==='action'&&S.mode==='overtour'&&myTurn()&&S.dlcGeo
  &&S.owner[n.id]!=null&&S.owner[n.id]!==me&&!S.rubble[n.id]&&!hiddenFromMe(n.id);
}
/* the World Expansion's picks: a node then a neighbour (chainsaw, brexit), one of yours then any node (silk road), any node (vanish) */
/* the Global Edition buttons that live in the MOVE phase: the Cruise Ship, the free blockade combo and the Tariff Wall */
export function worldMoveButtons(me,p){
 if(!S||!S.dlcWorld)return '';
 let h='';
 if(S.owner.w_cruise===me){const why=worldBlocked(me,'cruise');h+='<button class="act" data-act="worldmode:cruise"'+(why?' disabled':'')+' title="'+esc(why||'Pay $2 and sail to any other WATER node; the voyage ends your movement.')+'">🛳️ CRUISE SHIP — $2, sail to any WATER node</button>'}
 if(blockadeFree(me)){const open=NODES.some(nn=>!S.rubble[nn.id]&&!blockaded(nn.id));h+='<button class="act" data-act="blockmode"'+(!S.blockadeUsed&&open?'':' disabled')+' title="FREE, once per turn: you hold two blockade sources, so walling off a node uses neither your action nor your movement.">🚧 BLOCKADE — FREE (once per turn)</button>'}
 if(S.owner.w_tariffwall===me){const why=worldBlocked(me,'tariff');h+='<button class="act" data-act="tariffmode"'+(why?' disabled':'')+' title="'+esc(why||'Free, once per turn: name the node type that costs rivals $2 extra to seize.')+'">🧱 TARIFF WALL — name a type'+(S.tariffType?' (now '+S.tariffType+')':'')+'</button>'}
 return h;
}
export function worldPickable(n){
 const me=Net.myIdx,k=S&&S.mode;
 if(!S||S.phase!=='action'||!myTurn()||!S.dlcWorld||!k)return false;
 if(k==='vanish')return !blockaded(n.id)&&canReach(n.id);
 if(k!=='chainsaw'&&k!=='brexit'&&k!=='silkroad')return false;
 const a=S.edgeA;
 if(a==null)return k==='silkroad'?S.owner[n.id]===me:(ADJ[n.id]||[]).length>0;
 if(n.id===a)return true;
 return k==='silkroad'?!hasEdge(a,n.id):hasEdge(a,n.id);
}
export function blockadeTargetable(n){
 const me=Net.myIdx;
 return S&&(S.phase==='action'||(S.phase==='move'&&blockadeFree(me)))&&S.mode==='blockade'&&myTurn()&&blockSources(me).length>0
  &&!S.rubble[n.id]&&!blockaded(n.id)&&!hiddenFromMe(n.id);
}
/* Edge geometry shared by the board and the hover/path overlay. Under fog of war an edge only shows once both
   ends are known (or it leads out of the node you stand on), so the overlay can never reveal the hidden map. */
function edgeVisible(e){
 if(!(S&&S.fogOfWar))return true;
 const me=S.players[Net.myIdx],seen=me&&me.visited||{},pos=me&&me.pos,knownA=!!seen[e[0]],knownB=!!seen[e[1]];
 const frontier=(e[0]===pos&&!knownB)||(e[1]===pos&&!knownA);
 return (knownA&&knownB)||frontier;
}
function edgeCurve(e,i){
 const A=NMAP[e[0]],B=NMAP[e[1]];
 if(!A||!B)return null;
 /* the date-line wrap (The Rock to Fiji): drawn as a pair of stubs, off the right edge of the map and back in at the left */
 if(S&&S.layoutKind==='worldmap'){const W=boardViewBounds().w;if(Math.abs(B.x-A.x)>W*0.6){const L=A.x<B.x?A:B,R=A.x<B.x?B:A,t=(W-R.x)/((L.x+W)-R.x),y0=Math.round(R.y+(L.y-R.y)*t);return {d:'M'+R.x+','+R.y+' L'+(W-8)+','+y0+' M8,'+y0+' L'+L.x+','+L.y,len:W,mx:(L.x+R.x)/2,my:y0,wrap:true,W,y0,L,R}}}
 const dx=B.x-A.x,dy=B.y-A.y,len=Math.hypot(dx,dy)||1;
 const nx=-dy/len,ny=dx/len;
 const bow=(i%2===0?1:-1)*(18+Math.min(46,len*0.08));
 const mx=(A.x+B.x)/2+nx*bow,my=(A.y+B.y)/2+ny*bow;
 return {d:'M'+A.x+','+A.y+' Q'+mx+','+my+' '+B.x+','+B.y,len,mx,my};
}
/* Hover a node: its connections light up. Right-click a node: the shortest route from your seat to it is pinned
   (any time, not just on your turn) until you right-click it again, click the board, or press Escape. */
let hoverId=null,pinnedId=null;
const EDGEIDX={};
let indexedEdges=null,indexedCount=-1;
function indexEdges(){
 Object.keys(EDGEIDX).forEach(k=>delete EDGEIDX[k]);
 EDGES.forEach((e,i)=>{EDGEIDX[e[0]+'|'+e[1]]=i;EDGEIDX[e[1]+'|'+e[0]]=i});
 indexedEdges=EDGES;indexedCount=EDGES.length;
}
/* the edge list is replaced when the world changes (Geography DLC), so re-index whenever it is a different list */
function ensureEdgeIndex(){if(indexedEdges!==EDGES||indexedCount!==EDGES.length)indexEdges()}
function discoveredNode(id){
 if(!NMAP[id])return false;
 if(hiddenFromMe(id))return false;
 if(!(S&&S.fogOfWar))return true;
 const me=S.players[Net.myIdx];
 return !!(me&&me.visited&&me.visited[id]);
}
function visibleLink(a,b){
 ensureEdgeIndex();
 const i=EDGEIDX[a+'|'+b];
 return i!=null&&edgeVisible(EDGES[i])&&discoveredNode(b);
}
function myPos(){
 const me=S&&S.players[Net.myIdx];
 return me&&NMAP[me.pos]?me.pos:null;
}
/* Shortest route over the edges the viewer can see, as a node-id list from `from` to `to` (null if none). */
export function shortestPath(from,to){
 if(!S||!NMAP[from]||!NMAP[to])return null;
 if(from===to)return [from];
 const prev={};prev[from]=null;
 const q=[from];
 for(let h=0;h<q.length;h++){
  const u=q[h];
  for(const v of (ADJ[u]||[])){
   if(v in prev||!visibleLink(u,v))continue;
   prev[v]=u;
   if(v===to){const path=[v];for(let x=u;x!=null;x=prev[x])path.push(x);return path.reverse()}
   q.push(v);
  }
 }
 return null;
}
function overlayEdge(a,b,color,w,glowW){
 ensureEdgeIndex();
 const i=EDGEIDX[a+'|'+b];
 if(i==null)return '';
 const c=edgeCurve(EDGES[i],i);
 if(!c)return '';
 const A=NMAP[a],B=NMAP[b];
 const d=c.wrap?c.d:'M'+A.x+','+A.y+' Q'+c.mx+','+c.my+' '+B.x+','+B.y;
 return '<path d="'+d+'" fill="none" stroke="#000" stroke-width="'+glowW+'" opacity=".55" stroke-linecap="round"/><path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="'+w+'" stroke-linecap="round"/>';
}
function nodeRing(id,color,w,pad,dash){
 const n=NMAP[id];if(!n)return '';
 const b=nodeBox(n),bw=b[0],bh=b[1];
 return '<rect x="'+(n.x-bw/2-pad)+'" y="'+(n.y-bh/2-pad)+'" width="'+(bw+pad*2)+'" height="'+(bh+pad*2)+'" fill="none" stroke="'+color+'" stroke-width="'+w+'"'+(dash?' stroke-dasharray="'+dash+'"':'')+'/>';
}
/* what the hover and the pinned route light up, for both boards */
function highlightState(){
 ensureEdgeIndex();
 const me=myPos();
 const hov=hoverId&&discoveredNode(hoverId)?hoverId:null;
 const path=(pinnedId&&discoveredNode(pinnedId)&&me)?shortestPath(me,pinnedId):null;
 const links=hov?(ADJ[hov]||[]).filter(v=>visibleLink(hov,v)):[];
 return {hov,path,links};
}
export function drawHighlights(){
 if(view3d&&S)view3d.update(boardScene());
 const g=$('hlg');
 if(!g)return;
 if(!S){g.innerHTML='';return}
 let lines='',out='';
 const {hov,path,links}=highlightState();
 links.forEach(v=>{lines+=overlayEdge(hov,v,'#ffd24a',3.5,8)});
 if(path&&path.length>1)for(let i=0;i<path.length-1;i++)lines+=overlayEdge(path[i],path[i+1],'#ff5e9c',4.5,10);
 if(lines){
  /* the lines stop at the node cards instead of striking across them or over the player tokens */
  const bounds=boardViewBounds();
  let cut='';
  NODES.forEach(n=>{
   if(!discoveredNode(n.id))return;
   const b=nodeBox(n);
   cut+='<rect x="'+(n.x-b[0]/2-3)+'" y="'+(n.y-b[1]/2-3)+'" width="'+(b[0]+6)+'" height="'+(b[1]+6)+'" fill="#000"/>';
  });
  out+='<mask id="hlmask" maskUnits="userSpaceOnUse" x="0" y="0" width="'+bounds.w+'" height="'+bounds.h+'"><rect x="0" y="0" width="'+bounds.w+'" height="'+bounds.h+'" fill="#fff"/>'+cut+'</mask><g mask="url(#hlmask)">'+lines+'</g>';
 }
 if(hov){
  out+=nodeRing(hov,'#ffd24a',4,8);
  links.forEach(v=>{out+=nodeRing(v,'#ffd24a',2.5,6,'6 5')});
 }
 if(path&&path.length>1){
  path.forEach((id,i)=>{
   const n=NMAP[id],b=nodeBox(n);
   out+=nodeRing(id,'#ff5e9c',i===0||i===path.length-1?4:2.5,8);
   if(i>0)out+='<g transform="translate('+(n.x-b[0]/2)+','+(n.y-b[1]/2)+')"><circle r="13" fill="#ff5e9c" stroke="#000" stroke-width="2"/><text text-anchor="middle" y="5" font-size="14" font-weight="900" fill="#000">'+i+'</text></g>';
  });
  const t=NMAP[pinnedId],tb=nodeBox(t),steps=path.length-1;
  out+='<g transform="translate('+t.x+','+(t.y+tb[1]/2+22)+')"><rect x="-52" y="-13" width="104" height="22" fill="#000" stroke="#ff5e9c" stroke-width="2"/><text text-anchor="middle" y="3" font-size="12" font-weight="900" letter-spacing="1" fill="#ff5e9c">'+steps+(steps===1?' STEP':' STEPS')+'</text></g>';
 }
 g.innerHTML=out;
}
function setHover(id){
 if(id===hoverId)return;
 hoverId=id;drawHighlights();
}
function clearPin(){
 if(pinnedId==null)return;
 pinnedId=null;drawHighlights();
}
function pinPathTo(id){
 if(!S)return;
 if(pinnedId===id){clearPin();return}
 const me=myPos();
 if(!me){hooks.toast('You have no seat on the board to route from.');return}
 if(!discoveredNode(id))return;
 if(id===me){clearPin();hooks.toast('You are standing on it.');return}
 if(!shortestPath(me,id)){pinnedId=null;drawHighlights();hooks.toast('No known route there yet.');return}
 pinnedId=id;drawHighlights();
}
/* how a node answers a click right now: '' · 'click' (a Qantas landing) · 'click reach' (a step) · 'click target' */
function nodeClass(n,curpos){
 if(!S||S.over)return '';
 if(classifiedTargetable(n))return 'click target';
 if(S.mode==='fly'||S.mode==='launch')return (myTurn()&&n.id!==curpos&&canReach(n.id)&&!blockaded(n.id))?'click':'';
 if(S.mode==='cruise')return (myTurn()&&n.id!==curpos&&isWaterNode(n.id)&&canReach(n.id)&&!blockaded(n.id))?'click':'';
 if(S.mode!=='missile'&&S.mode!=='blockade'&&S.phase==='move'&&myTurn()&&S.steps>0&&(ADJ[curpos]||[]).includes(n.id)&&canReach(n.id)&&!blockaded(n.id))return 'click reach';
 if(classifiedTargetable(n)||bugTargetable(n)||missileTargetable(n)||overtourTargetable(n)||blockadeTargetable(n)||worldPickable(n))return 'click target';
 return '';
}
/* ---------- the optional 3D board (static/landing/board3d.js) ----------
   Off by default and remembered per browser. It is loaded only when switched on, and it
   draws from boardScene() — a plain snapshot — so it never touches S or the rules. If
   three.js or WebGL is unavailable it says so and the classic board stays. */
const B3D_KEY='bigcon-board3d';
let view3d=null,view3dPending=false;
function want3d(){try{return localStorage.getItem(B3D_KEY)==='on'}catch(_){return false}}
function save3d(on){try{localStorage.setItem(B3D_KEY,on?'on':'off')}catch(_){}}
function sync3dButton(){
 const b=$('z3d');if(!b)return;
 const on=!!view3d||view3dPending;
 b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));
 b.title=on?'Back to the classic board':'Switch to the 3D board';
}
export function set3d(on){
 save3d(on);
 const wrap=$('boardWrap');
 if(!on){if(view3d){view3d.destroy();view3d=null}if(wrap)wrap.classList.remove('b3d');sync3dButton();return}
 if(view3d||view3dPending||!S||!wrap){sync3dButton();return}
 view3dPending=true;sync3dButton();
 const fail=e=>{
  view3dPending=false;if(e)console.warn('[board3d]',e);
  if(view3d){view3d.destroy();view3d=null}
  wrap.classList.remove('b3d');save3d(false);sync3dButton();
  hooks.toast('The 3D board could not start here — you are on the classic board.');
 };
 import('../landing/board3d.js')
  .then(m=>m.mountBoard3D(wrap,boardScene(),{tap:tapNode,hover:setHover,pin:pinPathTo,unpin:clearPin,fail:()=>fail()}))
  .then(v=>{
   view3dPending=false;
   if(!want3d()||!S){v.destroy();sync3dButton();return}
   view3d=v;wrap.classList.add('b3d');view3d.update(boardScene());sync3dButton();
  })
  .catch(fail);
}
/* Everything the 3D board draws, as plain data (board pixels, seat indices, ids). */
export function boardScene(){
 ensureEdgeIndex();
 const curpos=S.players[S.cur].pos,viewer=S.players[Net.myIdx];
 const known=id=>discoveredNode(id);
 const nodes=NODES.map(n=>{
  const cls=nodeClass(n,curpos),k=known(n.id);
  /* ring layouts turn cards along the ring; standing up, every card faces the camera instead */
  return {id:n.id,x:n.x,y:n.y,rot:Math.abs(n.rot||0)<=20?n.rot||0:0,type:n.type,name:nodeName(n).join(' '),known:k,click:cls.indexOf('click')>=0,reach:cls.indexOf('reach')>=0,target:cls.indexOf('target')>=0,tip:k?nodeTip(n):''};
 });
 const seats=S.players.map((p,i)=>{
  const seen=!S.fogOfWar||i===Net.myIdx||!!(viewer&&viewer.visited&&viewer.visited[p.pos]);
  return {color:p.color,face:charSrc(p.char)||null,name:p.name,pos:seen&&!isVanished(i)&&NMAP[p.pos]?p.pos:null,raided:p.raided||0};
 });
 const edges=EDGES.filter(edgeVisible).map(e=>[e[0],e[1]]);
 const owner={},rubble={},bugs={};
 NODES.forEach(n=>{
  if(!known(n.id))return;
  if(S.owner[n.id]!=null)owner[n.id]=S.owner[n.id];
  if(S.rubble&&S.rubble[n.id])rubble[n.id]=1;
  if(S.bugs&&S.bugs[n.id]!=null)bugs[n.id]=S.bugs[n.id];
 });
 const moving=!S.over&&S.phase==='move'&&S.mode!=='fly'&&S.steps>0;
 const {hov,path,links}=highlightState();
 const sisyO=S.owner.sisy;
 return {
  fog:!!S.fogOfWar,
  key:[S.layoutKind||'',S.dlcGeo?1:0,S.dlcWorld?1:0,S.fogOfWar?1:0,NODES.map(n=>n.id+','+n.x+','+n.y+','+(n.rot||0)).join(';'),S.players.map(p=>p.color+'|'+p.char).join(';')].join('#'),
  edgesKey:edges.map(e=>e[0]+'-'+e[1]).join(','),
  bounds:boardViewBounds(),nodes,edges,seats,owner,rubble,bugs,
  hot:moving?edges.filter(e=>e[0]===curpos||e[1]===curpos):[],
  blockades:NODES.filter(n=>known(n.id)&&blockaded(n.id)).map(n=>n.id),
  qg:!!(S.dlcGeo&&NMAP.qantas&&qantasGrounded()),
  ov:S.dlcGeo&&S.ov&&known(S.ov.nid)?S.ov.nid:null,
  sisy:Math.max(0,Math.min(5,Math.log2((S.sisyPayout||10)/10)))/5,
  sisyActive:sisyO!=null&&S.players[sisyO]&&S.players[sisyO].pos==='sisy',
  made:S.owner.made!=null,tuvalu:S.owner.geo_tuvalu!=null,
  mood:S.mood,fx:S.fx.slice(),cur:S.cur,turn:S.turn,over:!!S.over,winner:S.winner!=null?S.winner:null,
  hover:hov?{id:hov,links}:null,path:path&&path.length>1?path:null,
 };
}
export function renderBoard(){
 const svg=$('board');
 /* static content lives in #root; floating fx live in #fxg and survive re-renders */
 let root=$('root');
 if(!root){
  svg.innerHTML='';
  root=document.createElementNS('http://www.w3.org/2000/svg','g');root.id='root';
  const fxg=document.createElementNS('http://www.w3.org/2000/svg','g');fxg.id='fxg';
  const hlg=document.createElementNS('http://www.w3.org/2000/svg','g');hlg.id='hlg';hlg.setAttribute('pointer-events','none');
  svg.appendChild(root);svg.appendChild(hlg);svg.appendChild(fxg);
 }
 const md=MOODS[S.mood]||MOODS.CALM;
 const mega=!!(S&&S.layoutKind==='megaring');
 const ring=!!(S&&S.layoutKind==='ringworld');
 const wm=!!(S&&S.layoutKind==='worldmap');
 const special=mega||ring||wm;
 const bounds=boardViewBounds();
 const metrics=wm?{cx:bounds.w/2,cy:bounds.h/2}:mega?megaRingMetrics(Math.max(3,(S.boardLayout||[]).length-1)):(ring?ringworldMetrics(Math.max(3,(S.boardLayout||[]).length-1)):null);
 const curpos=S?S.players[S.cur].pos:null;
 let s='';
 s+='<defs><pattern id="dots" width="'+(special?56:26)+'" height="'+(special?56:26)+'" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="rgba(22,131,136,0.18)"/></pattern></defs>';
 s+='<rect x="0" y="0" width="'+bounds.w+'" height="'+bounds.h+'" fill="#1d201f"/><rect x="0" y="0" width="'+bounds.w+'" height="'+bounds.h+'" fill="url(#dots)"/>';
 s+='<rect x="0" y="0" width="'+bounds.w+'" height="'+bounds.h+'" fill="'+md.tint+'" pointer-events="none"/>';
 s+='<rect x="7" y="7" width="'+(bounds.w-14)+'" height="'+(bounds.h-14)+'" rx="0" fill="none" stroke="#168388" stroke-width="'+(special?8:3)+'" opacity=".7"/>';
 if(wm)s+=worldMapSVG();
 EDGES.forEach((e,i)=>{
  if(!edgeVisible(e))return;
  const c=edgeCurve(e,i);
  if(!c)return;
  const d=c.d,len=c.len;
  const hot=S&&!S.over&&S.phase==='move'&&S.mode!=='fly'&&S.steps>0&&(e[0]===curpos||e[1]===curpos);
  const long=len>520;
  s+='<path d="'+d+'" fill="none" stroke="#08383a" stroke-width="'+(hot?6:long?3.5:5)+'" opacity="'+(hot?'.7':'.35')+'"/>';
  s+='<path d="'+d+'" fill="none" stroke="'+(hot?'#7ff6fb':'#168388')+'" stroke-width="'+(hot?3:long?1.6:2)+'" stroke-dasharray="'+(long?'11 8':'')+'" opacity="'+(hot?'1':'.9')+'"/>';
  if(c.wrap){const nm=q=>nodeName(q).join(' '),tx='font-size="34" font-weight="900" fill="#f5c542" stroke="#000" stroke-width="6" paint-order="stroke" font-family="Tomkins Display, sans-serif"';s+='<text x="'+(c.W-30)+'" y="'+(c.y0-18)+'" text-anchor="end" '+tx+'>⟶ WRAPS TO '+esc(nm(c.L))+'</text><text x="30" y="'+(c.y0-18)+'" '+tx+'>⟶ FROM '+esc(nm(c.R))+'</text>'}
 });
 if(wm){
  s+='<g transform="translate('+metrics.cx+',150) scale(2.6)"><rect x="-330" y="-27" width="660" height="48" fill="#168388" stroke="#000" stroke-width="2"/><text text-anchor="middle" y="5" font-size="22" font-weight="900" letter-spacing="3" fill="#fff" font-family="Tomkins Display, sans-serif">THE BIG CON: GLOBAL EDITION v1.14</text></g>';
  s+='<g transform="translate('+metrics.cx+',330) scale(2.4)"><rect x="-1050" y="-15" width="2100" height="30" fill="#000" stroke="'+md.color+'" stroke-width="2" opacity=".96"/><circle class="tkdot" cx="-1028" cy="0" r="6" fill="'+md.color+'"/><text x="-1008" y="4" font-size="13" font-weight="900" letter-spacing="1.5" fill="aqua">'+md.label+'</text><text x="0" y="4" text-anchor="middle" font-size="12" font-style="italic" fill="#ddd">'+esc((S.wire||'all quiet on the wire').slice(0,100))+'</text><text x="1028" y="4" text-anchor="end" font-size="12" font-weight="800" fill="#9ad">1🛈=$'+md.rate+'</text></g>';
 }else if(mega){
  s+='<circle cx="'+metrics.cx+'" cy="'+metrics.cy+'" r="'+metrics.radius+'" fill="none" stroke="#168388" stroke-width="3" stroke-dasharray="18 20" opacity=".22"/>';
  s+='<circle cx="'+metrics.cx+'" cy="'+metrics.cy+'" r="'+(metrics.radius-175)+'" fill="none" stroke="#168388" stroke-width="2" stroke-dasharray="4 18" opacity=".14"/>';
  s+='<g transform="translate('+metrics.cx+',95)"><rect x="-330" y="-27" width="660" height="48" fill="#168388" stroke="#000" stroke-width="2"/><text text-anchor="middle" y="5" font-size="22" font-weight="900" letter-spacing="3" fill="#fff" font-family="Tomkins Display, sans-serif">THE BIG CON v1.14 · MEGA RING</text></g>';
  s+='<g transform="translate('+metrics.cx+',175)"><rect x="-1050" y="-15" width="2100" height="30" fill="#000" stroke="'+md.color+'" stroke-width="2" opacity=".96"/><circle class="tkdot" cx="-1028" cy="0" r="6" fill="'+md.color+'"/><text x="-1008" y="4" font-size="13" font-weight="900" letter-spacing="1.5" fill="aqua">'+md.label+'</text><text x="0" y="4" text-anchor="middle" font-size="12" font-style="italic" fill="#ddd">'+esc((S.wire||'all quiet on the wire').slice(0,100))+'</text><text x="1028" y="4" text-anchor="end" font-size="12" font-weight="800" fill="#9ad">1🛈=$'+md.rate+'</text></g>';
 }else if(ring){
  metrics.radii.forEach((r,i)=>{
   s+='<ellipse cx="'+metrics.cx+'" cy="'+metrics.cy+'" rx="'+r.x+'" ry="'+r.y+'" fill="none" stroke="#168388" stroke-width="'+(i===0?3:2)+'" stroke-dasharray="'+(i===0?'18 20':'4 18')+'" opacity="'+(i===0?'.22':'.14')+'"/>';
  });
  s+='<g transform="translate('+metrics.cx+',95)"><rect x="-330" y="-27" width="660" height="48" fill="#168388" stroke="#000" stroke-width="2"/><text text-anchor="middle" y="5" font-size="22" font-weight="900" letter-spacing="3" fill="#fff" font-family="Tomkins Display, sans-serif">THE BIG CON v1.14 · RINGWORLD</text></g>';
  s+='<g transform="translate('+metrics.cx+',175)"><rect x="-1050" y="-15" width="2100" height="30" fill="#000" stroke="'+md.color+'" stroke-width="2" opacity=".96"/><circle class="tkdot" cx="-1028" cy="0" r="6" fill="'+md.color+'"/><text x="-1008" y="4" font-size="13" font-weight="900" letter-spacing="1.5" fill="aqua">'+md.label+'</text><text x="0" y="4" text-anchor="middle" font-size="12" font-style="italic" fill="#ddd">'+esc((S.wire||'all quiet on the wire').slice(0,100))+'</text><text x="1028" y="4" text-anchor="end" font-size="12" font-weight="800" fill="#9ad">1🛈=$'+md.rate+'</text></g>';
 }else{
  s+=scribble(1830,860,100,64,4)+scribble(1150,540,95,72,-3)+scribble(1000,1380,92,62,5)+scribble(1630,930,96,62,-4)+scribble(1500,470,98,62,3)+scribble(2020,185,92,66,-5)+scribble(390,1200,102,68,3);
  s+=redArrow(2090,330,1140,310)+redArrow(1965,235,1580,440)+redArrow(1080,585,480,1140)+redArrow(1130,1170,420,640);
  s+=scribText(1930,392,-4,'CASH RATE ↑')+scribText(1150,390,3,'“BOND…”')+scribText(1715,448,-6,'WTI +12%')+scribText(455,295,2,'TOO BIG TO FAIL')+scribText(1930,745,-3,'GOLD ↑')+scribText(1050,1150,4,'RATES ON HOLD')+scribText(640,810,-5,'INSIDER TRADING?');
  s+='<g transform="translate(58,40)"><rect x="-4" y="-22" width="268" height="36" fill="#168388" stroke="#000" stroke-width="2"/><text x="14" y="3" font-size="16" font-weight="900" letter-spacing="2" fill="#fff" font-family="Tomkins Display, sans-serif">THE BIG CON v1.14</text></g>';
  /* the market wire — the mood, live */
  s+='<g transform="translate(1230,30)"><rect x="-700" y="-13" width="1400" height="26" fill="#000" stroke="'+md.color+'" stroke-width="2" opacity=".96"/><circle class="tkdot" cx="-682" cy="0" r="5" fill="'+md.color+'"/><text x="-668" y="4" font-size="11" font-weight="900" letter-spacing="1.5" fill="aqua">'+md.label+'</text><text x="-20" y="4" text-anchor="middle" font-size="10.5" font-style="italic" fill="#ddd">'+esc((S.wire||'all quiet on the wire').slice(0,88))+'</text><text x="688" y="4" text-anchor="end" font-size="10" font-weight="800" fill="#9ad">1🛈=$'+md.rate+'</text></g>';
 }
 let lx=special?metrics.cx-360:560;
 s+='<g transform="translate(0,'+(wm?480:special?245:62)+')">';
 Object.keys(TYPE_COLORS).forEach(k=>{
  s+='<rect x="'+lx+'" y="-7" width="10" height="10" rx="2" fill="'+TYPE_COLORS[k]+'"/><text x="'+(lx+14)+'" y="2" font-size="9" font-weight="800" fill="#cbb992">'+k+'</text>';
  lx+=14+k.length*6.2+16;
 });
 s+='</g>';
 const goalNow=goalAmount();
 const leader=S.players.reduce((a,b)=>b.money>a.money?b:a,S.players[0]);
 const footerX=special?metrics.cx:1200,footerY=special?bounds.h-155:1490;
 s+='<g transform="translate('+footerX+','+footerY+')"><rect x="-800" y="-14" width="1600" height="25" fill="#000" stroke="#168388" stroke-width="1.5"/><text text-anchor="middle" y="3" font-size="'+(special?14:10.5)+'" font-weight="700" letter-spacing="1" fill="#fff">WIN CONDITION: $'+goalNow+' AND ONE OF EVERY NODE TYPE TAKES THE CON</text></g>';
 s+='<g transform="translate('+footerX+','+(footerY+38)+')"><rect x="-800" y="-12" width="1600" height="23" fill="#000" stroke="#168388" stroke-width="1.5"/><text text-anchor="middle" y="3" font-size="'+(special?13:10)+'" font-weight="700" letter-spacing="1" fill="aqua">FRONT RUNNER: '+esc(String(leader.name).toUpperCase())+' — $'+leader.money+' · $'+Math.max(0,goalNow-leader.money)+' TO GO</text></g>';
 NODES.forEach(n=>{s+=nodeSVG(n,nodeClass(n,curpos))});
 if(S)s+=tokenLayer();
 root.innerHTML=s;
 drawHighlights();
 /* floating fx — animate each exactly once, on every screen */
 const fxg=$('fxg');
 const present=new Set(S.fx.map(f=>f.id));
 shownFx.forEach(id=>{if(!present.has(id))shownFx.delete(id)});
 S.fx.forEach(f=>{
  if(shownFx.has(f.id))return;
  shownFx.add(f.id);
  if(f.proj){
   /* 🌍 a flying warhead or jet: SMIL slides the rig along the route, the static
      inner rig keeps it nose-first (mirrored on leftward flights), CSS fades it */
   const outer=document.createElementNS('http://www.w3.org/2000/svg','g');
   outer.setAttribute('class','fxproj');
   const mover=document.createElementNS('http://www.w3.org/2000/svg','g');
   const anim=document.createElementNS('http://www.w3.org/2000/svg','animateTransform');
   anim.setAttribute('attributeName','transform');anim.setAttribute('type','translate');
   anim.setAttribute('from',f.x0+' '+f.y0);anim.setAttribute('to',f.x1+' '+f.y1);
   anim.setAttribute('dur','1.1s');anim.setAttribute('begin','indefinite');anim.setAttribute('fill','freeze');
   mover.appendChild(anim);
   const rig=document.createElementNS('http://www.w3.org/2000/svg','g');
   rig.setAttribute('transform',projRig(f));
   const img=document.createElementNS('http://www.w3.org/2000/svg','image');
   img.setAttribute('href',f.img);
   img.setAttribute('x',-f.w/2);img.setAttribute('y',-f.h/2);
   img.setAttribute('width',f.w);img.setAttribute('height',f.h);
   rig.appendChild(img);mover.appendChild(rig);outer.appendChild(mover);fxg.appendChild(outer);
   setTimeout(()=>{try{anim.beginElement()}catch(e){}},30);
   setTimeout(()=>{try{outer.remove()}catch(e){}},1600);
   return;
  }
  const outer=document.createElementNS('http://www.w3.org/2000/svg','g');
  outer.setAttribute('transform','translate('+f.x+','+f.y+')');
  const inner=document.createElementNS('http://www.w3.org/2000/svg','g');
  inner.setAttribute('class',f.b?'fxb':'fxt');
  const t=document.createElementNS('http://www.w3.org/2000/svg','text');
  t.setAttribute('text-anchor','middle');
  t.setAttribute('font-size',f.b?54:20);
  t.setAttribute('font-weight','900');
  t.setAttribute('fill',f.c);
  t.setAttribute('stroke','#0f0a05');
  t.setAttribute('stroke-width',f.b?4:2.5);
  t.setAttribute('paint-order','stroke');
  t.textContent=f.t;
  inner.appendChild(t);outer.appendChild(inner);fxg.appendChild(outer);
  setTimeout(()=>{try{outer.remove()}catch(e){}},f.b?3600:2900);
 });
}
/* 🤵 JAMES BOND's CLASSIFIED: two ways to pay, once per turn, in the move or the action phase */
function classifiedButtons(me,p){
 if(S.owner.bond007!==me)return '';
 const tip='Free action, once per turn: file any node under CLASSIFIED until the end of next round. Rivals see only a ? — no name, owner, ability or bugs'+(S.fogOfWar?'; under Fog of War they also forget they were ever there':'')+'. They can still walk onto it and seize it.';
 return ['intel','money'].map(k=>'<button class="act" data-act="classifiedmode" data-pay="'+k+'"'+(classifiedBlocked(me,k)?' disabled':'')+' title="'+esc(tip)+'">🗂️ CLASSIFIED — hide a node · '+(k==='money'?'$'+CLASSIFIED_MONEY:CLASSIFIED_INTEL+' 🛈')+'</button>').join('');
}
export function renderSide(){
 const side=$('side');
 const me=Net.myIdx;const p=S.players[S.cur];const isTurn=myTurn();
 const md=MOODS[S.mood]||MOODS.CALM;
 const ownedIcons=NODES.filter(n=>S.owner[n.id]===me).map(n=>'<span title="'+n.name.join(' ')+'">'+(n.icon||({BANK:'🏦',COMMODITY:'🛢️',MEDIA:'🗞️',CORPORATE:'🏢',REGULATOR:'⚖️',CHART:'📈',WILD:'🎭'}[n.type]||'◆'))+'</span>').join('')||'<span style="opacity:.4">—</span>';
 const curN=NMAP[p.pos];
 let phaseHtml='';
 if(S.phase==='over'){
  phaseHtml='<div class="phlabel">GAME OVER</div><p>The con is complete. Check the record below.</p>'
   +(Net.role==='host'
    ?'<button class="act primary" data-act="tolobby">🃏 BACK TO THE LOBBY — same room, deal the next con</button><p class="fine" style="margin-top:8px">Nobody is going anywhere — the table keeps the room, the record and the chat. LEAVE is the only button that ends the night.</p>'
    :'<p class="fine">Stick around — the host can deal the next con. Nobody has to leave.</p>');
 } else if(!isTurn){
  if(Net.spect)phaseHtml='<div class="phlabel">SPECTATING</div><p>You joined mid-con — the table plays on without you. The chat is open and the record below is the play-by-play.</p>';
  else if(S.phase==='event')phaseHtml='<div class="phlabel">MARKET EVENT</div><p>The market moves whether anyone likes it or not…</p>';
  else phaseHtml='<div class="phlabel">STANDBY</div><p>⏳ Waiting for <b style="color:'+p.color+'">'+esc(p.name)+'</b>'+(p.dc?' <i>(away — auto-playing)</i>':'')+'…</p><p>Scheme in the chat. Hover exhibits to study their powers.</p>';
 } else if(S.phase==='move'){
  const maxSteps=S.caution?1:3+(S.owner.coal===me?1:0)+((S.owner.train===me||S.owner.bullet===me)?1:0)+(S.owner.asics===me?1:0)+(S.extraStep?1:0)+(S.slipped?2:0);
  const dots='●'.repeat(Math.max(0,S.steps))+'○'.repeat(Math.max(0,maxSteps-S.steps));
  if(S.mode==='classified'){phaseHtml='<div class="phlabel">🗂️ CLASSIFIED — '+(S.classPay==='money'?'$'+CLASSIFIED_MONEY:CLASSIFIED_INTEL+' 🛈')+' · FREE ACTION · ONCE PER TURN</div><p>Click <b>any node</b> on the board. Until the end of next round it is drawn as an unknown to everyone but you and its holder'+(S.fogOfWar?', and every rival who had been there forgets the way (permanently)':'')+'. Rivals can still walk onto it and seize it blind — they just can’t see it or pick it as a target.</p><button class="act" data-act="cancel">Cancel</button>'}
  else if(S.mode==='cruise'){phaseHtml='<div class="phlabel">🛳️ THE CRUISE SHIP — $2</div><p><b>SAILING:</b> click any <b>WATER node</b> (a strait, island, port or sea) to sail there. Your move ends on arrival.</p><button class="act" data-act="cancel">Cancel the voyage</button>'}
  else if(S.mode==='blockade'){phaseHtml='<div class="phlabel">🚧 BLOCKADE — FREE ACTION · ONCE PER TURN</div><p>Your blockade sources make this a <b>free action</b>: click any <b>highlighted node</b> to wall it off until the end of next round. Your movement and your action are untouched.</p><button class="act" data-act="cancel">Cancel</button>'}
  else if(S.mode==='launch'){phaseHtml='<div class="phlabel">🚀 BAIKONUR LAUNCH — $3, ONCE PER GAME</div><p><b>LAUNCHING:</b> click <b>any node</b> on the board to land there. Your move ends on arrival.</p><button class="act" data-act="cancel">Scrub the launch</button>'}
  else if(S.mode==='fly'){phaseHtml='<div class="phlabel">PHASE 1 · MOVE — FLYING</div><p><b>FLYING:</b> click <b>any node</b> on the board to land there ($3).</p><button class="act" data-act="cancel">Cancel flight</button>'}
  else if(S.mode==='missile'){phaseHtml='<div class="phlabel">🚀 MISSILE AWAY — $4 + 1 🛈</div><p><b>LAUNCHING:</b> click <b>any node</b> on the board to strike it. The launch <b>ends your move</b>, and your action phase still follows.</p><button class="act" data-act="cancel">Abort the launch</button>'}
  else{
   phaseHtml='<div class="phlabel">PHASE 1 · MOVE</div>'
    +'<p>Click a <b>highlighted node</b> to move along the red threads (3 steps, plus bonuses from your holdings). Tolls: <b>$1</b> entering a rival’s node (<b>$2</b> if they hold ALBANESE, <b>free</b> if you hold JAMES BOND).</p>'
    +'<div class="dots">'+dots+' <span>'+S.steps+' step'+(S.steps!==1?'s':'')+' left</span></div>'
    +'<div class="btns"><button class="act" data-act="endmove">Stay put — end movement</button>'
    +((!S.extraStep&&p.intel>=1)?'<button class="act" data-act="favor">🛈 Burn a favor — 1 🛈 (+1 step this turn)</button>':'')
    +((S.dlcWorld&&S.owner.w_baikonur===me)?'<button class="act" data-act="worldmode:launch"'+(worldBlocked(me,'launch')?' disabled':'')+' title="Once per game: pay $3 and land on any node (like the Qantas jet).">🚀 BAIKONUR LAUNCH — $3, anywhere (once per game)</button>':'')
    +((S.owner.qantas===me)?'<button class="act" data-act="flymode"'+(p.money>=3?'':' disabled')+'>✈️ Fly the Qantas jet — $3 (anywhere)</button>':'')
    +((S.owner.f1===me&&!S.slipped)?'<button class="act" data-act="slip"'+(p.money>=2?'':' disabled')+'>🏎️ Slipstream — $2 (+2 steps, $2 off next seizure)</button>':'')
    +classifiedButtons(me,p)
    +worldMoveButtons(me,p)
    +reworkButtons(me,p,'move').join('')
    +((S.dlcGeo&&ownsMissileLauncher(me)&&canFireMissileFrom(me))?'<button class="act" data-act="missilemode"'+((p.money>=4&&p.intel>=1&&!S.geoMissiled)?'':' disabled')+' title="From either launcher (anywhere with Kim Jong Un): strike any node that still stands — the launch ends your move; your action still follows ($4 + 1 Intel, once per turn)">🚀 Launch a missile — $4 + 1🛈 (ends the move)</button>':'')
    +'</div>';
    if(S.owner.back===me&&!S.backroomAbilityUsed){
     phaseHtml+='<div class="sublabel">BACKROOM DEALS · ONE NODE ABILITY · COSTS 2 MOVEMENT STEPS</div><div class="btns">';
     const backroomStepLock=S.steps<2?' disabled':'';
     if(S.owner.trump===me)phaseHtml+='<button class="act" data-act="tweetmode"'+((p.money>=2?'':' disabled')+backroomStepLock)+'>🦅 The Tweet — $2 · 2 steps</button>';
     phaseHtml+='<button class="act" data-act="pressure"'+backroomStepLock+'>🤝 Lean on the table · 2 steps</button>';
     if(S.owner.gov===me)phaseHtml+='<button class="act" data-act="budget"'+((p.money>=3?'':' disabled')+backroomStepLock)+'>🦘 Budget night — $3 · 2 steps</button>';
     if(S.owner.rock===me)phaseHtml+='<button class="act" data-act="cook"'+((p.money>=3?'':' disabled')+backroomStepLock)+'>💪 Cook the books — $3 · 2 steps</button>';
     if(S.owner.asic===me)phaseHtml+='<button class="act" data-act="auditmode"'+((p.money>=4&&!S.audited?'':' disabled')+backroomStepLock)+'>⚖️ Audit — $4 · 2 steps</button>';
     if(S.owner.press===me)phaseHtml+='<button class="act" data-act="spin" data-kind="press"'+((p.money>=3&&!S.spun?'':' disabled')+backroomStepLock)+'>🗞️ Spin the press — $3 · 2 steps</button>';
     if(S.owner.fox===me)phaseHtml+='<button class="act" data-act="spin" data-kind="fox"'+((p.money>=2&&!S.spun?'':' disabled')+backroomStepLock)+'>🦊 Fox spin — $2 · 2 steps</button>';
     if(S.owner.sisy===me&&p.pos==='sisy')phaseHtml+='<button class="act" data-act="push"'+backroomStepLock+'>🪨 Push the boulder — +$'+(S.sisyPayout||10)+' · 2 steps</button>';
     if(S.owner.asics===me&&p.pos==='asics')phaseHtml+='<button class="act" data-act="jog"'+backroomStepLock+'>👟 Jog a lap — −1 🔥 · 2 steps</button>';
     if(S.dlcGeo&&S.owner.geo_boeing===me)phaseHtml+='<button class="act" data-act="qantasdown"'+((p.money>=4&&!S.geoBoeing&&S.owner.qantas!==me?'':' disabled')+backroomStepLock)+' title="Ground a rival or unowned Qantas until the end of next round; unavailable if you own Qantas">🛩️ Ground Qantas — $4 · 2 steps</button>';
     if(S.dlcGeo&&S.owner.geo_scs===me)phaseHtml+='<button class="act" data-act="oilcrash"'+((p.money>=3&&!S.geoCrash?'':' disabled')+backroomStepLock)+'>🌊 Oil crash — $3 · 2 steps</button>';
     if(S.dlcGeo&&S.owner.geo_stage5===me)phaseHtml+='<button class="act" data-act="stage5"'+((p.intel>=2&&!S.geoStage5?'':' disabled')+backroomStepLock)+'>📉 Stage 5 — 2🛈 · 2 steps</button>';
     phaseHtml+='</div>';
    }

  }
 } else if(S.phase==='action'){
  const nid=p.pos,n=curN,prev=S.owner[nid];
  const hidHere=hiddenFromMe(nid),nodeNm=hidHere?'a CLASSIFIED site':n.name.join(' ');
  const powline=hidHere?'<div class="pow"><b>CLASSIFIED</b> — you cannot read this file. You can still seize it blind.</div>':'<div class="pow"><b>'+n.name.join(' ')+'</b> — '+n.sp+'</div>';
  if(S.mode==='classified'){
   phaseHtml='<div class="phlabel">🗂️ CLASSIFIED — '+(S.classPay==='money'?'$'+CLASSIFIED_MONEY:CLASSIFIED_INTEL+' 🛈')+' · FREE ACTION · ONCE PER TURN</div><p>Click <b>any node</b> on the board. Until the end of next round it is drawn as an unknown to everyone but you and its holder'+(S.fogOfWar?', and every rival who had been there forgets the way (permanently)':'')+'. Rivals can still walk onto it and seize it blind — they just can’t see it or pick it as a target.</p><button class="act" data-act="cancel">Cancel</button>'
  } else if(S.mode==='bug'){
   phaseHtml='<div class="phlabel">PLANT A BUG</div>'+powline+'<p>Click a <b>highlighted rival node next to you</b> on the board. You will skim <b>$1/turn</b> off it ($2 with the WEF).</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='missile'){
   phaseHtml='<div class="phlabel">🚀 LAUNCH A MISSILE — $4 + 1 🛈 (once per turn)</div>'+powline+'<p>Click <b>any node</b> on the board. An owned node is expropriated with <b>no payout</b>; either way it becomes <b>rubble</b> — no income, nothing to seize, until someone stands there and pays its list price to rebuild (a rebuild is an action of its own).</p><button class="act" data-act="cancel">Abort the launch</button>';
  } else if(S.mode==='bailout'){
   phaseHtml='<div class="phlabel">🆘 IMF BAILOUT — LEND $6</div>'+powline+'<p>Click a <b>rival</b> in THE SYNDICATE list below (one with no IMF loan). You lend $6 of your own money; $8 is due back at the start of their next-but-one turn, or they take +2 Cortisol.</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='blockade'){
   phaseHtml='<div class="phlabel">🚧 BLOCKADE — '+(blockadeFree(me)?'FREE':'USES YOUR ACTION')+' · ONCE PER TURN</div>'+powline+'<p>Click any <b>highlighted node</b> to block entry until the end of next round. Blocked nodes display a 🚧 marker. Nobody can walk or fly into one, including you; income and missiles are unaffected. Rubble and already-blocked nodes cannot be selected.</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='overtour'){
   phaseHtml='<div class="phlabel">🛳️ OVERTOURISM — $2</div>'+powline+'<p>Click a <b>rival-owned node</b>. Its owner takes <b>+1 Cortisol</b> at the start of their turn for one full table rotation, or until Venice changes hands.</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='deal'){
   phaseHtml='<div class="phlabel">🤝 OFFER A DEAL — USES YOUR ACTION</div>'+powline+'<p>Click a <b>rival</b> in THE SYNDICATE list, then pick one of your nodes and name a whole-dollar price ($0 up to their cash). They accept or decline in private; a declined offer still ends your turn. No Cortisol either way, and any bugs on the node are cleared.</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='refer'){
   phaseHtml='<div class="phlabel">🧐 REFER A FILE — $4 (+1 SCRUTINY)</div>'+powline+'<p>Click a highlighted <b>rival</b> with an open file you can refer ('+(S.owner.accc===me?'ACCC: every book but monetary policy':'')+(S.owner.accc===me&&S.owner.asic===me?' · ':'')+(S.owner.asic===me?'ASIC: monetary policy':'')+'). Any ruling still waits for their own turn start.</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='chainsaw'||S.mode==='brexit'||S.mode==='silkroad'){
   const lab={chainsaw:'🪚 CHAINSAW — $3 · +$4 · ONCE PER GAME',brexit:'🇬🇧 TAKE BACK CONTROL — ONCE PER GAME · +1 🔥',silkroad:'🛤️ NEW SILK ROAD — $4'}[S.mode];
   const a=S.edgeA!=null&&NMAP[S.edgeA]?nodeName(NMAP[S.edgeA]).join(' '):null;
   const how=S.mode==='silkroad'?(a?'Now click <b>any other node</b> to link it to <b>'+a+'</b> (click '+a+' again to start over).':'Click <b>one of your own nodes</b> to start the road.'):(a?'Now click one of the <b>neighbours</b> of <b>'+a+'</b> to cut the line between them (click '+a+' again to start over).':'Click the <b>first node</b> of the edge to cut, then one of its neighbours.');
   phaseHtml='<div class="phlabel">'+lab+'</div>'+powline+'<p>'+how+(S.mode==='silkroad'?'':' A cut that would strand part of the board from Quikstop is refused.')+'</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='vanish'){
   phaseHtml='<div class="phlabel">🌀 THE VANISH — ONCE PER GAME</div>'+powline+'<p>Click <b>any node</b>: you disappear until the start of your next turn, then reappear there. Rivals cannot target you meanwhile.</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='hold'){
   phaseHtml='<div class="phlabel">🎧 PUT A RIVAL ON HOLD (rival −1 🛈)</div>'+powline+'<p>Click a <b>rival</b> in THE SYNDICATE list below.</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='leak'||S.mode==='audit'||S.mode==='tweet'||S.mode==='roast'){
   const lab={leak:'LEAK DIRT — 2 🛈 (rival +2 🔥)',audit:'AUDIT — $4 (rival +1 🔥)',tweet:'THE TWEET — $2 (rival loses Intel)',roast:(S.spinKind==='fox'?'FOX SPIN — $2 (rival +1 🔥)':'SPIN THE PRESS — $3 (rival +1 🔥)')}[S.mode];
   phaseHtml='<div class="phlabel">'+lab+'</div>'+powline+'<p>Click a <b>rival</b> in THE SYNDICATE list below.</p><button class="act" data-act="cancel">Cancel</button>';
  } else {
   let base=seizeListPrice(me,n);
   /* the slipstream's $2 off applies to this seizure (the engine takes it in doSeize) */
   if(S.slipped===true&&S.owner.f1===me)base=Math.max(1,base-2);
   const isTake=prev!=null&&prev!==me;
   const cost=(isTake?takeoverCost(me,nid,base):base)+tariffFor(me,nid)+inflationExtra();
   const maxPay=p.money+(S.owner.back===me?Math.min(3,p.intel):0);
   const btns=[];
   if(prev===me){
    btns.push('<div class="ownnote">You already control <b>'+n.name.join(' ')+'</b>.</div>');
    if(nid==='sisy')btns.push('<button class="act primary" data-act="push">Push the boulder — +$'+(S.sisyPayout||10)+' (next push doubles)</button>');
    if(nid==='asics')btns.push('<button class="act primary" data-act="jog">Jog a lap — free −1 🔥</button>');
   }else if(S.rubble&&S.rubble[nid]){
    btns.push('<button class="act primary" data-act="rebuild"'+(p.money>=n.cost?'':' disabled')+'>♻️ Rebuild '+nodeName(n).join(' ')+' — $'+n.cost+' (returns unowned — first bids from next turn)</button>');
    if(svalbardFreeRebuild(me))btns.push('<button class="act primary" data-act="rebuildfree" title="Once per game: the Seed Vault pays for the rebuild">🌱 Rebuild FREE — Seed Vault (once per game)</button>');
    btns.push('<div class="ownnote">Rubble since a missile strike — no income, nothing to seize, until it is rebuilt.</div>');
   }else if(honeypotBan(me,nid)){
    btns.push('<div class="ownnote">🍯 '+honeypotBan(me,nid)+'</div>');
   }else if(isTake&&noTakeover(nid)){
    btns.push('<div class="ownnote">🐧 <b>'+n.name.join(' ')+'</b> is UNTOUCHABLE — no hostile takeover of it is ever possible.</div>');
   }else{
    const afford=maxPay>=cost;
    const twinLauncher=S.dlcGeo&&((nid==='geo_shahed'&&S.owner.geo_missile===me)||(nid==='geo_missile'&&S.owner.geo_shahed===me));
    const lbl=hidHere?'Seize '+nodeNm+' blind — $'+cost:isTake?('Hostile takeover — $'+cost+(flatSeize(nid)?' (never inflates)':S.dossier?' (DOSSIER: list price)':' (takeover '+(S.seizeCount[nid]||0)+'×)')):('Seize '+n.name.join(' ')+' — $'+cost);
    btns.push('<button class="act primary" data-act="seize"'+(afford&&!twinLauncher?'':' disabled')+'>'+lbl+(twinLauncher?' — you can own either launcher, not both':afford?'':' — can’t afford')+'</button>');
   }
   const bugCost=(S.owner.insider===me)?0:1;
   const bugTargets=(ADJ[nid]||[]).filter(m=>S.owner[m]!=null&&S.owner[m]!==me&&S.bugs[m]==null).length>0;
   btns.push('<button class="act" data-act="bugmode"'+((p.intel>=bugCost&&bugTargets)?'':' disabled')+'>Plant a bug — '+(bugCost===0?'FREE (insider trading graphic)':'1 🛈')+'</button>');
   btns.push('<button class="act" data-act="leakmode"'+(p.intel>=2?'':' disabled')+'>Leak dirt — 2 🛈 (rival +2 🔥)</button>');
   if(S.owner.asic===me)btns.push('<button class="act" data-act="auditmode"'+((p.money>=4&&!S.audited)?'':' disabled')+'>⚖️ Audit — $4 (rival +1 🔥)</button>');
   if(S.owner.press===me)btns.push('<button class="act" data-act="spin" data-kind="press"'+((p.money>=3&&!S.spun)?'':' disabled')+'>🗞️ Spin the press — $3 (−2 🔥 or roast)</button>');
   if(S.owner.fox===me)btns.push('<button class="act" data-act="spin" data-kind="fox"'+((p.money>=2&&!S.spun)?'':' disabled')+'>🦊 Fox spin — $2 (−3 🔥 or roast)</button>');
   if(S.owner.rock===me)btns.push('<button class="act" data-act="cook"'+((p.money>=3&&!S.cooked)?'':' disabled')+'>💪 Cook the books — $3 (−3 🔥)</button>');
   if(S.owner.trump===me)btns.push('<button class="act" data-act="tweetmode"'+(p.money>=2?'':' disabled')+'>🦅 The Tweet — $2 (rival loses Intel)</button>');
   if(S.owner.gov===me)btns.push('<button class="act" data-act="budget"'+((p.money>=3&&!S.budgeted)?'':' disabled')+'>🦘 Budget night — $3 (rivals each pay you $1, +1 🛈)</button>');
   if(S.owner.back===me)btns.push('<button class="act" data-act="pressure"'+(!S.pressured?'':' disabled')+'>🤝 Lean on the table — rivals each +1 🔥</button>');
   /* ---- 🌍 GEOGRAPHY DLC ---- */
   if(S.dlcGeo&&ownsMissileLauncher(me)&&canFireMissileFrom(me))btns.push('<button class="act" data-act="missilemode"'+((p.money>=4&&p.intel>=1&&!S.geoMissiled)?'':' disabled')+' title="Stand on either launcher to fire (owning Kim Jong Un arms either from anywhere): strike any node — the owner is expropriated with no payout; the node becomes rubble ($4 + 1 Intel, once per turn)">🚀 Launch a missile — $4 + 1 🛈 (expropriate &amp; rubble)</button>');
   if(S.dlcGeo&&S.owner.geo_boeing===me)btns.push('<button class="act" data-act="qantasdown"'+((p.money>=4&&!S.geoBoeing&&S.owner.qantas!==me)?'':' disabled')+' title="QANTAS grounded until the end of next round — nobody can enter it, and its owner earns nothing ($4, once per turn)">🛩️ Shut down Qantas — $4 (grounded two turns)</button>');
   if(S.dlcGeo&&S.owner.geo_scs===me)btns.push('<button class="act" data-act="oilcrash"'+((p.money>=3&&!S.geoCrash)?'':' disabled')+' title="PANIC mood; everyone pays $2 per oil node owned — Pillars exempt ($3, once per turn)">🌊 Trigger an oil crash — $3 (oil pays underwater)</button>');
   if(S.dlcGeo&&S.owner.geo_stage5===me)btns.push('<button class="act" data-act="stage5"'+((p.intel>=2&&!S.geoStage5)?'':' disabled')+' title="The richest player (not you) makes no income on their next turn (2 Intel, once per turn)">📉 Call Stage 5 decline — 2 🛈</button>');
   if(S.dlcGeo&&S.owner.geo_venice===me&&nid==='geo_venice')btns.push('<button class="act" data-act="venicecool"'+(!S.geoVenice?'':' disabled')+' title="Free — once per turn, either this or Overtourism">🚤 Gondola therapy — free −1 🔥</button>');
   if(S.dlcGeo&&S.owner.geo_venice===me){
    const ot=NODES.filter(nn=>S.owner[nn.id]!=null&&S.owner[nn.id]!==me&&!(S.rubble&&S.rubble[nn.id])).length;
    btns.push('<button class="act" data-act="overmode"'+((p.money>=2&&!S.geoVenice&&ot>0)?'':' disabled')+' title="Pick any rival-owned node, including ESG holdings. It remains active for one full table rotation and applies +1 Cortisol when the target takes their turn ($2, once per turn, either/or)">🛳️ Overtourism — $2 (one full turn cycle)</button>');
   }
   if(S.dlcGeo&&S.owner.geo_wonsan===me&&nid==='geo_wonsan')btns.push('<button class="act primary" data-act="beach"'+(!S.geoBeach?'':' disabled')+' title="Free — once per turn">🏖️ Beach day — free −2 🔥</button>');
   if(blockSources(me).length){const blockadeTargets=NODES.some(nn=>!S.rubble[nn.id]&&!blockaded(nn.id));const bfree=blockadeFree(me);btns.push('<button class="act" data-act="blockmode"'+(!S.blockadeUsed&&blockadeTargets?'':' disabled')+' title="Once per turn: wall off any unblocked, non-rubble node until the end of next round. Blocks walking and Qantas landings; shown by a 🚧 marker on the board.'+(bfree?' You hold two blockade sources, so this is a FREE action.':' It uses your action (hold two of ALBANESE, THE GREAT BARRIER REEF and CRITICAL PATH ANALYSIS to make it free).')+'">🚧 Blockade — '+(bfree?'free (once per turn)':'uses your action (once per turn)')+'</button>');}
   if(S.dlcWorld&&S.owner.w_suez===me)btns.push('<button class="act" data-act="evergiven"'+(!S.evergivenUsed&&!blockaded('w_suez')&&!S.rubble['w_suez']?'':' disabled')+' title="Once per game: block the Suez until the end of next round. Nobody walks in or lands there — you included.">🚢 EVER GIVEN — block the Suez (once per game)</button>');
   if(S.dlcWorld){
    [['chainsaw','w_milei','worldmode:chainsaw','🪚 CHAINSAW — cut an edge, $3 (once per game)','Pay $3, cut any one edge of the board for good, and pocket $4.'],
     ['brexit','w_brexit','worldmode:brexit','🇬🇧 TAKE BACK CONTROL — sever an edge (once per game)','Sever any one edge of the board for good. +1 Cortisol.'],
     ['silkroad','w_bri','worldmode:silkroad','🛤️ NEW SILK ROAD — link two nodes, $4','Pay $4 to add a permanent edge from one of your nodes to any other node.'],
     ['advance','w_nigprince','advance','👑 ADVANCE FEE — $2, coin flip for $5','Pay $2: heads you receive $5, tails nothing at all.'],
     ['carry','w_watanabe','carry','👛 CARRY TRADE — borrow $6, repay $9 next turn','Borrow $6 now; repay $9 at the start of your next turn or take +3 Cortisol.'],
     ['hold','w_bangalore','worldmode:hold','🎧 PUT A RIVAL ON HOLD — they lose 1 🛈','Pick a rival: they lose 1 Intel. Once per turn.'],
     ['carbon','w_amazon','carbon','🌳 SELL CARBON CREDITS — $3 per non-commodity node','Once per turn: $3 for every node of yours that is not a COMMODITY.'],
     ['vanish','w_bermuda','worldmode:vanish','🌀 THE VANISH — reappear anywhere (once per game)','Disappear until your next turn; rivals cannot target you. You reappear at any node you name.'],
     ['bailout','w_imf','worldmode:bailout','🆘 IMF BAILOUT — lend a rival $6 (repay $8)','Lend a chosen rival $6 of your own money; $8 is due back at the start of their next-but-one turn, or they take +2 Cortisol.'],
     ['tariff','w_tariffwall','tariffmode','🧱 TARIFF WALL — name a node type'+(S.tariffType?' (now '+S.tariffType+')':''),'Free, once per turn: rivals pay $2 extra (to you) to seize a node of the type you name.'],
     ['doha','w_doha','doha','🕰️ START THE DOHA ROUND — +$2 per commodity for 3 turns (once per game)','Open a trade round: $2 per COMMODITY node you own at the start of each of your next 3 turns, then the talks stall.']
    ].forEach(([k,nid,act,label,tip])=>{if(S.owner[nid]!==me)return;const why=worldBlocked(me,k);btns.push('<button class="act" data-act="'+act+'"'+(why?' disabled':'')+' title="'+esc(why||tip)+'">'+label+'</button>')});
   }
   reworkButtons(me,p,'action').forEach(h=>btns.push(h));
   /* ---- 🧐 THE REGULATORS' FILES & NODE DEALS ---- */
   const myFiles=filesOf(me);
   if(myFiles.length){
    btns.push('<div class="sublabel">REGULATOR FILES ON YOU · RULING AT '+ACCC_RULING+' SCRUTINY</div>');
    const listed={};
    myFiles.forEach(f=>{
     const g=INDBYID[f.ind];
     btns.push('<button class="act" data-act="lobby" data-kind="'+f.ind+'"'+((p.intel>=3&&!S.lobbied&&f.s>0)?'':' disabled')+' title="Free, once per turn: 3 Intel for −1 scrutiny on this file (never below 0)">🤝 Lobby the '+f.agency+' — 3 🛈 ('+g.name+' '+f.s+'/'+ACCC_RULING+' → '+Math.max(0,f.s-1)+')</button>');
     ownedInIndustry(me,g).forEach(nn=>{if(listed[nn.id])return;listed[nn.id]=1;btns.push('<button class="act" data-act="marketsell" data-id="'+nn.id+'" title="Your action: sell this node back to the market for its list price — it becomes unowned and any bugs on it are cleared">🏷️ Sell '+nn.name.join(' ')+' to the market — +$'+nn.cost+'</button>')});
    });
   }
   btns.push('<button class="act" data-act="dealmode"'+((S.players.length>1&&NODES.some(nn=>S.owner[nn.id]===me))?'':' disabled')+' title="Your action: offer one of your nodes to one rival for a price you name ($0 up to their cash). They accept or decline in private; a declined offer still uses your action. No Cortisol; bugs on the node are cleared.">🤝 Offer a deal — sell a node to a rival</button>');
   if(S.owner.accc===me||S.owner.asic===me||(S.dlcWorld&&S.owner.w_wto===me))btns.push('<button class="act" data-act="refermode"'+((p.money>=4&&!S.referred&&S.players.some((_,i)=>referableFiles(i).length))?'':' disabled')+' title="Your action, once per turn: $4 for +1 scrutiny on a rival’s open file. The ACCC refers every book but monetary policy; ASIC refers monetary-policy books; the WTO refers trade-bloc books. You cannot refer your own file, and rulings still wait for the offender’s turn start.">🧐 Refer a rival file — $4 (+1 scrutiny)</button>');
   if(S.owner.bond007===me)btns.push(classifiedButtons(me,p));
   /* ---- INTEL OPS ---- */
   btns.push('<div class="sublabel">INTEL OPS · you hold 🛈 '+p.intel+' · market rate $'+md.rate+'/🛈</div>');
   btns.push('<button class="act" data-act="spy"'+(p.intel>=2?'':' disabled')+' title="Free action — see the next event card, anywhere">🛈 Spy on the deck — 2 🛈 (see next event)</button>');
   btns.push('<button class="act" data-act="dossier"'+((p.intel>=3&&!S.dossier)?'':' disabled')+' title="Free action — hostile takeovers cost list price this turn">📂 The Dossier — 3 🛈 (takeovers at list price)</button>');
   btns.push('<button class="act" data-act="divestmade"'+((p.intel>=5&&p.money>=7&&S.owner.made!=null&&S.owner.made!==me)?'':' disabled')+' title="Pay 5 Intel and $7 compensation to remove MADE from any rival; you take +1 Cortisol">🟣 Divest MADE — 5 🛈 + $7 compensation</button>');
   btns.push('<button class="act" data-act="sweep"'+(p.intel>=2?'':' disabled')+' title="Your action — remove all bugs on your nodes">🧹 Sweep for bugs — 2 🛈 (cleanse your nodes)</button>');
    btns.push('<button class="act" data-act="masspanic"'+(p.intel>=5?'':' disabled')+' title="Your action — every player gains 2 Cortisol">🔥 Mass panic — 5 🛈 (+2 Cortisol to everyone)</button>');
   btns.push('<button class="act" data-act="targetpanic"'+(p.intel>=30&&S.players.some((_,i)=>i!==me&&!isVanished(i))?'':' disabled')+' title="Choose one rival to receive +6 Cortisol; costs 30 Intel">🔥 Overload a rival — 30 🛈 (+6 Cortisol)</button>');
   if(S.owner.bond===me&&S.owner.leak===me){btns.push('<button class="act" data-act="bondmageddon"'+(p.money>=16&&p.intel>=4&&!S.bondmageddonUsed&&S.players.length>1?'':' disabled')+' title="Choose a rival with intact holdings: four missiles hit random holdings and turn them to rubble. If they own ESG, three hit ESG and the fourth hits another holding. Costs $16 + 4 Intel; once per turn.">💥 BONDMAGEDDON — 4 missiles ($16 + 4 🛈)</button>');}
   for(let k=1;k<=3;k++){
    btns.push('<button class="act" data-act="sell" data-n="'+k+'"'+(p.intel>=k?'':' disabled')+' title="Your action — sell Intel at the current market rate">💰 Sell '+k+' 🛈 → $'+(k*md.rate)+'</button>');
   }
   btns.push('<button class="act" data-act="sellall"'+(p.intel>0?'':' disabled')+' title="Exchange every Intel point you hold at the current market rate">💰 Sell ALL '+p.intel+' 🛈 → $'+(p.intel*md.rate)+'</button>');
   btns.push('<button class="act" data-act="laylowcash">Lay low — pocket $1</button>');
   btns.push('<button class="act" data-act="laylowcool">Lay low — cool 2 🔥</button>');
   phaseHtml='<div class="phlabel">PHASE 2 · ONE ACTION</div>'+powline+'<div class="btns">'+btns.join('')+'</div>';
  }
 } else if(S.phase==='event'){
  phaseHtml='<div class="phlabel">PHASE 3 · MARKET EVENT</div><p>Resolve the event… and watch the mood.</p>';
 }
 const prows=S.players.map((pl,i)=>{
  const nodes=NODES.filter(nn=>S.owner[nn.id]===i).length;
  const targetable=isTurn&&i!==me&&((S.phase==='action'||(S.phase==='move'&&S.owner.back===me&&!S.backroomAbilityUsed))&&(S.mode==='leak'||S.mode==='audit'||S.mode==='tweet'||S.mode==='roast'||S.mode==='hold'||S.mode==='bailout')||(S.phase==='action'&&(S.mode==='deal'||(S.mode==='refer'&&referableFiles(i).length))));
  const fl=filesOf(i);
  const face=charSrc(pl.char);
  return '<div class="prow'+(i===me?' me':'')+(targetable?' targetable':'')+(pl.cortisol>=6?' hot':'')+'" data-rival="'+i+'" style="--pc:'+pl.color+'">'
   +(face?'<img class="pface" src="'+face+'" alt="">':'<span class="pnum">'+(i+1)+'</span><span class="pdot"></span>')
   +'<span class="pname">'+esc(pl.name)+(i===me?' <i style="color:#9ad">(you)</i>':'')+(pl.dc?' 💤':'')+'</span>'
   +'<span class="pstats">$'+pl.money+' · 🛈'+pl.intel+' · 🔥'+pl.cortisol+'</span>'
   +'<span class="pnodes">'+nodes+' node'+(nodes!==1?'s':'')+' · set '+(WIN_TYPES.length-missingTypes(i).length)+'/'+WIN_TYPES.length+'</span>'
   +(fl.length?'<span class="pfiles" title="Open regulator files: +1 scrutiny at each of this player’s turn starts (a trade-bloc file adds 1 per member beyond 3), ruling at '+ACCC_RULING+'">'+fl.map(f=>agencyTag(f)+' file · '+INDBYID[f.ind].name+' '+f.s+'/'+ACCC_RULING).join(' · ')+'</span>':'')+'</div>';
 }).join('');
 const myMissing=Net.spect?[]:missingTypes(me);
 const setHtml=Net.spect?'<span style="color:#9ad">not playing — just watching</span>':WIN_TYPES.map(t=>{const has=hasType(me,t);return '<span style="color:'+(has?'#7fe08d':'#ff6b5e')+'">'+(has?'✔':'✘')+' '+t+'</span>'}).join('');
 const chatHtml=(S.chat||[]).map(c=>'<div><b style="color:'+c.c+'">'+esc(c.n)+':</b> '+esc(c.t)+'</div>').join('')||'<div style="opacity:.4;font-style:italic">— the wire is quiet —</div>';
 const chatVal=chatDraft;
 side.innerHTML='<div class="netstrip">ROOM <b>'+(Net.roomLabel||Net.roomCode||'·····')+'</b> · '+(Net.role==='host'?'HOST':(Net.spect?'👁 SPECTATOR':'SEAT '+(Net.myIdx+1)))+' · 🎯 TARGET $'+goalAmount()+' · '+(S.players.filter(pl=>!pl.dc).length+'/'+S.players.length+' connected')+(S.deckCount!=null?' · 🎴 '+S.deckCount+' events left':'')+' · ⛽ '+(QUIK_SLOTS[S.quikSlot|0]||QUIK_SLOTS[0]).label+'</div>'
  +'<div class="moodstrip" style="border-color:'+md.color+'"><span class="mdot" style="background:'+md.color+'"></span><b style="color:'+md.color+'">'+md.label+'</b><span>'+md.desc+'</span><span class="mwire">“'+esc(S.wire||'all quiet on the wire')+'”</span></div>'
  +worldStrip()
  +'<div class="brand"><div class="t1">THE BIG CON</div><div class="t2">v1.14 · '+(S.dlcGeo?'82':'70')+' exhibits · three board layouts · online, 2–8</div></div>'
  +'<div class="turncard" style="border-color:'+p.color+'"><div class="turnlab">TURN '+S.turn+'</div><div class="turnname" style="color:'+p.color+'">'+esc(p.name)+(isTurn?' — that’s you':'')+'</div>'
  +'<div class="resline">$ '+p.money+' &nbsp;·&nbsp; 🛈 '+p.intel+' &nbsp;·&nbsp; 🔥 '+p.cortisol+(p.cortisol>=6?' <span class="danger">RAID AT 9</span>':'')+'</div>'
  +'<div class="holds" title="holdings of '+esc(p.name)+'">'+(isTurn?ownedIcons:'<span style="opacity:.5;font-size:12px;">'+NODES.filter(n=>S.owner[n.id]===S.cur).length+' holdings</span>')+'</div></div>'
  +'<div class="setcard"><span class="st">🎯 WIN SET</span>'+setHtml+'<span style="flex-basis:100%;color:#9ad">'+(Net.spect?'the spectacle is the point':(myMissing.length?'still need: '+myMissing.join(', ')+' · and $'+goalAmount():'full set held — now bank $'+goalAmount()))+'</span></div>'
  +'<div class="phasecard">'+phaseHtml+'</div>'
  +'<div class="paneltitle">THE SYNDICATE — '+S.players.length+' AT THE TABLE</div><div>'+prows+'</div>'
  +'<div class="paneltitle">THE RECORD<span style="float:right;display:inline-flex;gap:6px;margin-top:-4px"><button class="mini" data-act="copyrecord" style="flex:0 0 auto;padding:3px 8px;font-size:10px;">COPY</button><button class="mini" data-act="reviewlog" style="flex:0 0 auto;padding:3px 8px;font-size:10px;" title="Open this record in the log reviewer">🔬 REVIEW</button></span></div><div class="log" id="logbox">'+(S.over?S.log:S.log.slice(-LOG_SHOWN)).map(l=>'<div>'+l+'</div>').join('')+'</div>'
  +'<div class="paneltitle">THE WIRE (chat)</div><div class="chatbox"><div class="chatlist" id="chatbox">'+chatHtml+'</div><div class="chatrow"><input id="chatInput" maxlength="140" placeholder="talk your book…" value="'+esc(chatVal)+'"><button id="chatSend">SEND</button></div></div>'
  +'<div class="footbtns"><button class="mini" data-act="notifications">🔔 TURN ALERTS: '+(turnAlertsEnabled()?'ON':'OFF')+'</button><button class="mini" data-act="rules">📖 RULES</button><a class="mini" href="exhibits.html" target="_blank" rel="noopener">▦ EXHIBITS</a><button class="mini" data-act="leave">↺ LEAVE</button></div>';
 const lb=$('logbox');if(lb)lb.scrollTop=lb.scrollHeight;
 const cb=$('chatbox');if(cb)cb.scrollTop=cb.scrollHeight;
 const ci=$('chatInput');
 if(ci){ci.addEventListener('input',()=>{chatDraft=ci.value});
  const send=()=>{const t=ci.value.trim();if(!t)return;chatDraft='';sendChat(t)};
  $('chatSend').onclick=send;
  ci.addEventListener('keydown',e=>{if(e.key==='Enter')send()});
 }
}
/* a one-line status of the Global Edition's shared state: the tariff wall, the bleached reef, my trade blocs and IMF loans */
export function worldStrip(){
 if(!S||!S.dlcWorld)return '';
 const bits=[],me=Net.myIdx;
 if(tariffOwner()!=null)bits.push('🧱 TARIFF WALL on <b>'+S.tariffType+'</b> ($2 extra, paid to '+esc(pname(tariffOwner()))+')');
 else if(S.owner.w_tariffwall!=null&&!S.tariffType)bits.push('🧱 the Tariff Wall is unbuilt');
 if(reefBleached())bits.push('🪸 the Reef is <b>BLEACHED</b> — no blockade, no income');
 if(inflationExtra()>0)bits.push('📈 INFLATION: every seizure costs <b>+$'+inflationExtra()+'</b>');
 if(S.owner.w_pyramids!=null)bits.push('🔺 PYRAMID payout: <b>$'+pyramidPayout()+'</b> (paid to '+esc(pname(S.owner.w_pyramids))+')');
 if(S.doha&&S.doha.left>0)bits.push('🕰️ DOHA ROUND open ('+S.doha.left+' turn'+(S.doha.left>1?'s':'')+' left for '+esc(pname(S.doha.by))+')');
 if(me!=null&&S.players[me]&&!Net.spect){
  blocStatus(me).forEach(b=>bits.push(b.icon+' <b>'+esc(b.name)+'</b>: '+b.k+' member'+(b.k===1?'':'s')+' · income ×'+b.mult.toFixed(2)+' (+$'+b.bonus+'/turn)'+(b.noWto?' · no WTO jurisdiction':b.file?' · 🌐 WTO file '+b.file.s+'/'+ACCC_RULING:(b.k>BLOC_FREE?' · 🌐 file about to open':''))+(b.step?' · +'+b.step+' scrutiny a turn':'')));
  if(S.imf&&S.imf[me])bits.push('🆘 you owe the IMF ($8 to '+esc(pname(S.imf[me].by))+', due in '+S.imf[me].left+' of your turns)');
 }
 return bits.length?'<div class="moodstrip" style="border-color:#7fa7b3;flex-wrap:wrap;gap:4px 14px">'+bits.map(b=>'<span>'+b+'</span>').join('')+'</div>':'';
}
export function sendChat(t){
 if(Net.role==='host'){addChat(Net.myIdx,t)}
 else if(Net.conn&&Net.conn.open){Net.conn.send({t:'chat',text:t})}
}
/* It is this screen's turn to act: our seat is up, and it is not a bot seat
   (a spectating host watches its bot play — it never clicks for it). */
export function myTurn(){
 if(!S||S.cur!==Net.myIdx)return false;
 const me=S.players[Net.myIdx];
 return !!me&&!me.bot&&!Net.spect;
}
/* the rival files this screen's seat may REFER: never its own, and only the agency it owns */
export function agencyTag(f){return f.agency==='ASIC'?'⚖️ ASIC':f.agency==='WTO'?'🌐 WTO':'🧐 ACCC'}
export function referableFiles(i){const me=Net.myIdx;if(!S||i===me)return [];return filesOf(i).filter(f=>S.owner[fileAuthority(f)]===me)}
/* DEAL: the rival is picked on the syndicate list; the node and the price are asked
   locally, then one 'deal' intent goes to the host (who re-validates all of it). */
export async function dealFlow(ri){
 const me=Net.myIdx,buyer=S&&S.players[ri];
 const mine=NODES.filter(n=>S.owner[n.id]===me);
 if(!buyer||!mine.length){dispatch({act:'cancel'});return}
 const nid=await hooks.modal({title:'OFFER A DEAL — TO '+buyer.name.toUpperCase(),body:'Which of your nodes do you offer to '+buyer.name+'?',options:mine.map(n=>({label:n.name.join(' ')+' · $'+n.income+'/turn · list $'+n.cost,v:n.id})).concat([{label:'Cancel',v:''}])});
 if(!S||S.mode!=='deal'||!myTurn())return;
 if(!nid||!NMAP[nid]){dispatch({act:'cancel'});return}
 const n=NMAP[nid],max=S.players[ri].money;
 let price=Math.min(max,n.cost);
 const asked=hooks.modal({title:'NAME YOUR PRICE — '+n.name.join(' '),html:'<p>'+esc(buyer.name)+' holds <b>$'+max+'</b>. Name a whole-dollar price from $0 to $'+max+' — the list price is $'+n.cost+'.</p><input id="dealPrice" type="number" min="0" max="'+max+'" step="1" value="'+price+'" style="width:100%;font-size:18px;padding:6px;box-sizing:border-box">',options:[{label:'Send the offer',v:1},{label:'Cancel',v:0}]});
 const inp=$('dealPrice');if(inp&&inp.addEventListener)inp.addEventListener('input',()=>{price=String(inp.value).trim()===''?NaN:Number(inp.value)});
 const ok=await asked;
 if(!S||S.mode!=='deal'||!myTurn())return;
 if(!ok){dispatch({act:'cancel'});return}
 if(!Number.isInteger(price)||price<0||price>S.players[ri].money){hooks.toast('Name a whole-dollar price from $0 to $'+S.players[ri].money+'.');return}
 dispatch({act:'deal',id:nid,target:ri,n:price});
}
/* ===== NODE REWORKS: buttons and the pick-flows that build their intents ===== */
const rwBtn=(act,label,why,tip,extra)=>'<button class="act" data-act="'+act+'"'+(extra||'')+(why?' disabled':'')+' title="'+esc(why||tip)+'">'+label+'</button>';
export function reworkButtons(me,p,phase){
 if(!S||S.over)return [];
 const out=[],own=id=>S.owner[id]===me&&!(S.rubble&&S.rubble[id]);
 if(own('westpac'))launderBooks(me).forEach(b=>out.push(rwBtn('launder','🧺 LAUNDER — 1 🛈 → $3 · +1 scrutiny, '+b.name+' ('+b.agency+')',reworkBlocked(me,'launder'),'FREE, once per turn: burn 1 Intel for $3. It adds +1 scrutiny to the '+b.agency+' file on your '+b.name+' book (opening a breach file if none is open); a breach file that rules fines you 15% of your cash.',' data-kind="'+b.id+'"')));
 if(own('w_swiss')||swissBalance(me)>0){
  if(swissBalance(me)>0)out.push(rwBtn('swisswithdraw','🔓 SWISS VAULT — withdraw (balance $'+swissBalance(me)+')',reworkBlocked(me,'swisswithdraw'),'FREE, once per turn, from anywhere: take all or part of your numbered account back into your cash. Stashed money does not count toward the win goal.'));
  if(phase==='action'&&own('w_swiss'))out.push(rwBtn('swissdeposit','🔒 SWISS VAULT — stash cash'+(swissBalance(me)>0?' (balance $'+swissBalance(me)+')':''),reworkBlocked(me,'swissdeposit'),'Your action: stash any amount where raids, fines, events and loans cannot reach it. It does not count toward the goal until withdrawn.'));
 }
 if(S.dlcWorld&&own('w_srilanka'))out.push(rwBtn('srilankadefault','🍃 DEFAULT — wipe your debts, tolls free this turn (once per game)',reworkBlocked(me,'srilankadefault'),'FREE, once per game: the IMF loan and the Mrs Watanabe carry trade are written off, and every toll you would owe this turn is waived.'));
 if(phase!=='action')return out;
 if(own('golf'))out.push(rwBtn('golfmode','⛳ THE BACK NINE — propose a node swap (free, once per turn)',reworkBlocked(me,'golf'),'FREE, once per turn: offer one of your nodes for one of a rival’s, with cash either way. They accept or decline in private.'));
 if(own('w_zim'))out.push(rwBtn('printmoney','🧾 PRINT MONEY — +$'+Math.max(1,Math.round(goalAmount()*0.2))+' now, +$1 on every seizure forever (once per game)',reworkBlocked(me,'printmoney'),'Your action, once per game: gain 20% of the game’s target. From then on every seizure on the board costs +$1 (inflation).'));
 if(own('w_area51'))out.push(rwBtn('abduct','👽 ALIEN ABDUCTION — $4 + 3 🛈, steal a rival’s node (50% rubble, once per game)',reworkBlocked(me,'abduct'),'Your action, once per game: steal any rival node remotely. A coin flip: intact, or it arrives as rubble.'));
 if(own('w_bell'))out.push(rwBtn('ringbell','🔔 RING THE BELL — $2: the next event NOW + investigate a rival',reworkBlocked(me,'ringbell'),'Your action, once per turn: the next market event is drawn and resolved right now, and an ASIC/ACCC file on a rival you choose opens or gains +1 scrutiny.'));
 if(own('w_lira'))out.push(rwBtn('lira','💸 ERDOĞANOMICS — every rival loses 20% of cash above $30 (once per game)',reworkBlocked(me,'lira'),'Your action, once per game: each rival loses 20% of the cash they hold above $30.'));
 if(own('trump')&&S.dlcWorld&&NMAP.w_greenland)out.push(rwBtn('greenbuy','🇬🇱 MAKE AN OFFER — force-buy Greenland at list price (once per game)',reworkBlocked(me,'greenbuy'),'Your action, once per game, with DONALD TRUMP: buy Greenland from its owner at list price. They cannot refuse.'));
 if(S.dlcWorld&&own('w_bigyahu')&&own('trump')&&own('w_lockheed'))out.push(rwBtn('liberate','🛢️ LIBERATE OIL — divest all oil, take half of your rivals’ (once per game)',reworkBlocked(me,'liberate'),'Your action, once per game, with BIG YAHU, DONALD TRUMP and LOCKHEED MARTIN: your oil nodes are sold to the market at list price; you take half (rounded up) of your rivals’ oil nodes and the rest go unowned.'));
 if(S.dlcWorld&&own('w_jensen'))out.push(rwBtn('honeypot','🍯 HONEYPOT — 2 free Chinese nodes; US nodes stop paying (once per game)',reworkBlocked(me,'honeypot'),'Your action, once per game: take 2 Chinese nodes for free. No US node earns income for 2 rounds, and you cannot buy in South-East Asia or the USA for your next 2 turns.'));
 return out;
}
const rivalsWith=pred=>S.players.map((pl,i)=>i).filter(i=>i!==Net.myIdx&&!isVanished(i)&&pred(i));
export async function golfFlow(){
 const me=Net.myIdx,theirNodes=i=>NODES.filter(n=>S.owner[n.id]===i&&!(S.rubble&&S.rubble[n.id])&&!hiddenFrom(me,n.id));
 const rivals=rivalsWith(i=>theirNodes(i).length>0);
 if(!rivals.length){hooks.toast('No rival holds a node you could ask for.');return}
 const t=await hooks.modal({title:'THE BACK NINE — WHO?',body:'Swap one of your nodes for one of theirs.',options:rivals.map(i=>({label:pname(i)+' · '+theirNodes(i).length+' node'+(theirNodes(i).length===1?'':'s'),v:i})).concat([{label:'Cancel',v:-1}])});
 if(!S||t==null||t<0||!myTurn())return;
 const mine=NODES.filter(n=>S.owner[n.id]===me&&!(S.rubble&&S.rubble[n.id]));
 const give=await hooks.modal({title:'THE BACK NINE — YOUR NODE',body:'Which of your nodes do you put on the table?',options:mine.map(n=>({label:nodeName(n).join(' ')+' · $'+n.income+'/turn · list $'+n.cost,v:n.id})).concat([{label:'Cancel',v:''}])});
 if(!S||!give||!myTurn())return;
 const their=theirNodes(t);
 const take=await hooks.modal({title:'THE BACK NINE — THEIR NODE',body:'Which of '+pname(t)+'’s nodes do you want?',options:their.map(n=>({label:nodeName(n).join(' ')+' · $'+n.income+'/turn · list $'+n.cost,v:n.id})).concat([{label:'Cancel',v:''}])});
 if(!S||!take||!myTurn())return;
 const opts=[{label:'No cash either way',v:0}];
 [1,2,3,5,10].forEach(x=>{if(S.players[me].money>=x)opts.push({label:'I add $'+x,v:x})});
 [1,2,3,5,10].forEach(x=>{if(S.players[t].money>=x)opts.push({label:'I ask for $'+x+' from '+pname(t),v:-x})});
 opts.push({label:'Cancel',v:null});
 const cash=await hooks.modal({title:'THE BACK NINE — SWEETENER',body:'Add cash to the swap, or ask for some?',options:opts});
 if(!S||cash===null||cash===undefined||!myTurn())return;
 dispatch({act:'golftrade',target:t,id:give,kind:take,n:cash});
}
export async function abductFlow(){
 const me=Net.myIdx,tg=abductTargets(me);
 const rivals=rivalsWith(i=>tg.some(n=>S.owner[n.id]===i));
 if(!rivals.length){hooks.toast('There is no rival node the aliens can take.');return}
 const t=await hooks.modal({title:'ALIEN ABDUCTION — WHOSE NODE?',body:'$4 + 3 Intel, once per game. A coin flip: the node arrives intact — or as rubble.',options:rivals.map(i=>({label:pname(i)+' · '+tg.filter(n=>S.owner[n.id]===i).length+' abductable',v:i})).concat([{label:'Cancel',v:-1}])});
 if(!S||t==null||t<0||!myTurn())return;
 const id=await hooks.modal({title:'ALIEN ABDUCTION — WHICH NODE?',options:tg.filter(n=>S.owner[n.id]===t).map(n=>({label:nodeName(n).join(' ')+' · $'+n.income+'/turn · list $'+n.cost,v:n.id})).concat([{label:'Cancel',v:''}])});
 if(!S||!id||!myTurn())return;
 dispatch({act:'abduct',target:t,id});
}
export async function bellFlow(){
 const rivals=rivalsWith(()=>true);
 if(!rivals.length)return;
 const t=await hooks.modal({title:'RING THE BELL — INVESTIGATE WHOM?',body:'$2. The next market event resolves now, and the regulators open (or escalate) a file on your pick.',options:rivals.map(i=>({label:pname(i)+(filesOf(i).length?' · '+filesOf(i).length+' open file'+(filesOf(i).length===1?'':'s'):''),v:i})).concat([{label:'Cancel',v:-1}])});
 if(!S||t==null||t<0||!myTurn())return;
 dispatch({act:'ringbell',target:t});
}
export async function swissFlow(kind){
 const me=Net.myIdx,max=kind==='swissdeposit'?S.players[me].money:swissBalance(me);
 if(max<1)return;
 const set=[...new Set([max,Math.floor(max/2),5,10,20].filter(x=>x>=1&&x<=max))].sort((a,b)=>b-a);
 const n=await hooks.modal({title:kind==='swissdeposit'?'NUMBERED ACCOUNT — STASH HOW MUCH?':'NUMBERED ACCOUNT — WITHDRAW HOW MUCH?',body:kind==='swissdeposit'?'Your cash is $'+max+'. Stashed cash is safe from raids, fines, events and loans — and does not count toward the goal.':'The account holds $'+max+'.',options:set.map(x=>({label:(x===max?'All — ':'')+'$'+x,v:x})).concat([{label:'Cancel',v:0}])});
 if(!S||!n||!myTurn())return;
 dispatch({act:kind,n});
}
export async function tariffFlow(){
 if(!S||S.owner.w_tariffwall!==Net.myIdx)return;
 const kind=await hooks.modal({title:'THE TARIFF WALL — WHICH NODE TYPE?',options:WIN_TYPES.map(t=>({label:t+(S.tariffType===t?' (current wall)':''),v:t})).concat([{label:'Cancel',v:''}])});
 if(!kind||!S)return;
 dispatch({act:'tariff',kind});
}
export async function referFlow(ri){
 const fl=referableFiles(ri);
 if(!fl.length){hooks.toast('That rival has no open file you can refer.');return}
 let kind=fl[0].ind;
 if(fl.length>1){kind=await hooks.modal({title:'REFER WHICH FILE?',options:fl.map(f=>({label:f.agency+' · '+INDBYID[f.ind].name+' '+f.s+'/'+ACCC_RULING,v:f.ind})).concat([{label:'Cancel',v:''}])});if(!kind||!S||S.mode!=='refer')return}
 dispatch({act:'refer',target:ri,kind});
}
export function dispatch(m){
 if(!S||S.over||!myTurn())return;
 if(Net.role==='host')applyIntent(Net.myIdx,m);
 else if(Net.conn&&Net.conn.open)Net.conn.send({t:'intent',act:m.act,id:m.id,target:m.target,kind:m.kind,choice:m.choice,n:m.n});
}

let VB={x:0,y:0,w:2400,h:1560};
export function applyVB(){svgEl.setAttribute('viewBox',VB.x+' '+VB.y+' '+VB.w+' '+VB.h)}
export function resetBoardView(){
 const b=boardViewBounds();
 VB={x:b.x,y:b.y,w:b.w,h:b.h};
 applyVB();
}
export function boardDisplayMetrics(){
 const rect=svgEl.getBoundingClientRect();
 const scale=Math.min(rect.width/VB.w,rect.height/VB.h);
 const displayWidth=VB.w*scale,displayHeight=VB.h*scale;
 return {rect,scale,offsetX:(rect.width-displayWidth)/2,offsetY:(rect.height-displayHeight)/2};
}
export function zoomAt(f,cx,cy){
 const bounds=boardViewBounds();
 const m=boardDisplayMetrics();
 if(!m.scale)return;
 const bx=VB.x+(cx-m.rect.left-m.offsetX)/m.scale;
 const by=VB.y+(cy-m.rect.top-m.offsetY)/m.scale;
 const nw=Math.min(bounds.w,Math.max(280,VB.w*f)), nh=nw*bounds.h/bounds.w;
 VB.x=bx-(bx-VB.x)*(nw/VB.w);VB.y=by-(by-VB.y)*(nh/VB.h);
 VB.w=nw;VB.h=nh;clampVB();applyVB();
}
export function clampVB(){
 const b=boardViewBounds();
 VB.x=Math.min(b.x+b.w-VB.w,Math.max(b.x,VB.x));
 VB.y=Math.min(b.y+b.h-VB.h,Math.max(b.y,VB.y));
}
let drag=null,lastTapTarget=null;
export function handleNodeTap(t){
 if(!t||!t.closest)return;
 const g=t.closest('g.node');
 if(g)tapNode(g.dataset.id);
}
/* a click on a node, from either board */
export function tapNode(id){
 if(!id||!S||S.over)return;
 if(!myTurn())return;
 if(S.mode==='classified'){dispatch({act:'classified',id});return}
 if(S.phase==='move'){
  if(S.mode==='fly'){dispatch({act:'fly',id});return}
  if(S.mode==='launch'){dispatch({act:'launch',id});return}
  if(S.mode==='cruise'){dispatch({act:'cruise',id});return}
  if(S.mode==='blockade'){dispatch({act:'blockade',id});return}
  if(S.mode==='missile'){dispatch({act:'missile',id});return}
  if(S.steps<=0)return;
  if(!canReach(id)){hooks.toast(qantasGroundedReason()+'.');return}
  if((ADJ[S.players[Net.myIdx].pos]||[]).includes(id))dispatch({act:'move',id});
  else hooks.toast('You can only move along the red threads — click a highlighted node.');
 } else if(S.phase==='action'){
  if(S.mode==='bug')dispatch({act:'bug',id});
  else if(S.mode==='missile')dispatch({act:'missile',id});
  else if(S.mode==='overtour')dispatch({act:'overtour',id});
  else if(S.mode==='blockade')dispatch({act:'blockade',id});
  else if(S.mode==='vanish')dispatch({act:'vanish',id});
  else if(S.mode==='chainsaw'||S.mode==='brexit'||S.mode==='silkroad')dispatch({act:'edgepick',id});
 }
}
/* initGame / enterGame: leave the setup screen and show the board. */
export function showGame(){
 $('setup').style.display='none';$('app').style.display='flex';document.body.classList.add('game-open');
 resetBoardView();
}
/* Everything below attaches listeners and reads the DOM, so it waits for initUI(). */
export function initUI(){
 svgEl=$('board');
/* a trackpad fires many wheel events per frame: fold them into one viewBox write per animation frame */
let wheelZ=null;
svgEl.addEventListener('wheel',e=>{
 e.preventDefault();
 const f=e.deltaY>0?1.13:0.885;
 if(wheelZ){wheelZ.f*=f;wheelZ.x=e.clientX;wheelZ.y=e.clientY;return}
 wheelZ={f,x:e.clientX,y:e.clientY};
 const raf=typeof requestAnimationFrame==='function'?requestAnimationFrame:(cb=>cb());
 raf(()=>{const z=wheelZ;wheelZ=null;if(z)zoomAt(z.f,z.x,z.y)});
},{passive:false});
svgEl.addEventListener('pointerdown',e=>{if(e.button>0)return;if(pinnedId!=null&&!(e.target.closest&&e.target.closest('g.node')))clearPin();drag={x:e.clientX,y:e.clientY,moved:false};lastTapTarget=e.target;});
svgEl.addEventListener('pointermove',e=>{
 if(!drag)return;
 const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
 if(!drag.moved&&Math.abs(dx)+Math.abs(dy)>6){
  drag.moved=true;
  try{svgEl.setPointerCapture(e.pointerId)}catch(_){}
  svgEl.classList.add('panning');
 }
 if(drag.moved){
  const m=boardDisplayMetrics();
  if(m.scale){VB.x-=dx/m.scale;VB.y-=dy/m.scale;clampVB();applyVB()}
  drag.x=e.clientX;drag.y=e.clientY;
 }
});
svgEl.addEventListener('pointerup',()=>{
 if(drag&&!drag.moved)handleNodeTap(lastTapTarget);
 drag=null;svgEl.classList.remove('panning');
});
svgEl.addEventListener('mouseover',e=>{
 if(drag&&drag.moved)return;
 const g=e.target.closest?e.target.closest('g.node'):null;
 setHover(g?g.dataset.id:null);
});
svgEl.addEventListener('mouseleave',()=>setHover(null));
svgEl.addEventListener('contextmenu',e=>{
 e.preventDefault();
 const g=e.target.closest?e.target.closest('g.node'):null;
 if(g)pinPathTo(g.dataset.id);else clearPin();
});
window.addEventListener('keydown',e=>{if(e.key==='Escape')clearPin()});
svgEl.addEventListener('pointercancel',()=>{drag=null;svgEl.classList.remove('panning')});
window.addEventListener('pointerup',e=>{if(drag&&e.target&&e.target!==svgEl&&!svgEl.contains(e.target)){drag=null;svgEl.classList.remove('panning')}});
 $('zin').onclick=()=>{if(view3d){view3d.zoom(0.8);return}const r=svgEl.getBoundingClientRect();zoomAt(0.8,r.left+r.width/2,r.top+r.height/2)};
 $('zout').onclick=()=>{if(view3d){view3d.zoom(1.25);return}const r=svgEl.getBoundingClientRect();zoomAt(1.25,r.left+r.width/2,r.top+r.height/2)};
 $('zreset').onclick=()=>{if(view3d){view3d.reset();return}resetBoardView()};
 if($('z3d')){$('z3d').onclick=()=>set3d(!(view3d||view3dPending));sync3dButton()}
/* The syndicate hover card: hold the cursor over a rival's row and the table
   shows exactly which pins they hold and which win types they still need. */
(function(){
 let card=null;
 function ensure(){
  if(card)return;
  card=document.createElement('div');card.id='nodecard';
  card.style.cssText='position:fixed;display:none;pointer-events:none;z-index:9999;max-width:360px;background:#101418;border:1px solid #2a4a55;border-radius:10px;padding:10px 12px;font:12px/1.55 Inconsolata,monospace;color:#cfe6ee;box-shadow:0 8px 30px rgba(0,0,0,.55);white-space:normal';
  document.body.appendChild(card);
 }
 function hide(){if(card)card.style.display='none'}
 function move(e){
  if(!card||card.style.display!=='block')return;
  const pad=14,r=card.getBoundingClientRect();
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+r.width>innerWidth-8)x=e.clientX-r.width-pad;
  if(y+r.height>innerHeight-8)y=e.clientY-r.height-pad;
  card.style.left=Math.max(8,x)+'px';card.style.top=Math.max(8,y)+'px';
 }
 function show(e){
  const row=e.target&&e.target.closest?e.target.closest('.prow[data-rival]'):null;
  if(!row||!S){hide();return}
  const i=+row.dataset.rival,pl=S.players[i];
  if(!pl){hide();return}
  ensure();
  const owned=NODES.filter(n=>S.owner[n.id]===i);
  const byType={};for(const n of owned){(byType[n.type]=byType[n.type]||[]).push(n.name.join(' '))}
  const missing=missingTypes(i);
  let h='<b style="color:'+pl.color+';font-size:13px">'+esc(pl.name)+'</b> <span style="opacity:.7">$'+pl.money+' · 🛈'+pl.intel+' · 🔥'+pl.cortisol+'</span>';
  h+='<div style="margin-top:6px;letter-spacing:.12em;color:#7fa7b3">HOLDS '+(owned.length||'NOTHING')+'</div>';
  if(owned.length)h+=WIN_TYPES.filter(t=>byType[t]).map(t=>'<div><span style="color:#7fe08d">✔ '+t+'</span><span style="opacity:.85"> — '+byType[t].join(', ')+'</span></div>').join('');
  else h+='<div style="opacity:.5">no pins on the board yet</div>';
  h+='<div style="margin-top:6px;letter-spacing:.12em;color:#7fa7b3">'+(missing.length?'STILL NEEDS':'FULL SET HELD')+'</div>';
  h+=missing.length?missing.map(t=>'<span style="color:#ff6b5e;margin-right:10px">✘ '+t+'</span>').join(''):'<span style="color:#7fe08d">✔ every type — now it is just the cash</span>';
  const fl=filesOf(i);
  if(fl.length)h+='<div style="margin-top:6px;letter-spacing:.12em;color:#7fa7b3">REGULATOR FILES</div>'+fl.map(f=>'<div style="color:#ffb35c">'+agencyTag(f)+' · '+INDBYID[f.ind].name+' — scrutiny '+f.s+'/'+ACCC_RULING+'</div>').join('');
  card.innerHTML=h;card.style.display='block';
  move(e);
 }
 document.addEventListener('mouseover',show);
 document.addEventListener('mousemove',e=>{
  const row=e.target&&e.target.closest?e.target.closest('.prow[data-rival]'):null;
  if(row)show(e);else hide();
 });
 document.addEventListener('mouseout',e=>{
  const row=e.target&&e.target.closest?e.target.closest('.prow[data-rival]'):null;
  if(row&&(!e.relatedTarget||!row.contains(e.relatedTarget)))hide();
 });
})();
 $('side').addEventListener('click',async e=>{
 if(!S)return;
 const row=e.target.closest('.prow[data-rival]');
 if(row&&(S.phase==='action'||(S.phase==='move'&&S.owner.back===Net.myIdx&&!S.backroomAbilityUsed))&&S.cur===Net.myIdx){
  const ri=+row.dataset.rival;if(ri===Net.myIdx)return;
  if(S.mode&&['leak','audit','tweet','roast','hold','bailout'].includes(S.mode)){dispatch({act:S.mode,target:ri});return}
  if(S.mode==='deal'&&S.phase==='action'){dealFlow(ri);return}
  if(S.mode==='refer'&&S.phase==='action'){referFlow(ri);return}
 }
 const b=e.target.closest('button[data-act]');
 if(!b||b.disabled)return;
 const act=b.dataset.act;
 if(act.startsWith('worldmode:')){dispatch({act:'worldmode',kind:act.slice(10)});return}
 if(act==='tariffmode'){tariffFlow();return}
 if(act==='doha'){dispatch({act:'doha'});return}
 if(act==='rules'){showRules();return}
 if(act==='notifications'){toggleTurnAlerts();return}
 if(act==='copyrecord'){
  const rec=(S.log||[]).join('\n');
  try{navigator.clipboard.writeText(rec).then(()=>hooks.toast('Record copied.')).catch(()=>hooks.toast('Could not copy the record.'))}catch(e){hooks.toast('Could not copy the record.')}
  return;
 }
 if(act==='reviewlog'){
  const meta={t:(S.log||[]).join('\n'),p:S.players.map(pl=>({n:pl.name,c:pl.color}))};
  let saved=false;
  try{localStorage.setItem('bigcon-record-pending',JSON.stringify(meta));saved=true}catch(e){}
  const w=window.open('logs.html','_blank');
  if(!w)hooks.toast('Allow pop-ups to open the log reviewer.');
  else if(!saved)hooks.toast('Could not hand the record over — use COPY and paste it into the reviewer.');
  return;
 }
 if(act==='tolobby'){if(Net.role==='host')backToLobby();return}
 if(act==='leave'){
  if(Net.role==='host'){const v=await hooks.modal({title:'END THE GAME?',body:'This will disconnect everyone and return all players to the lobby screen. Proceed?',options:[{label:'Yes — end it',v:1},{label:'Keep scheming',v:0}]});if(v){sendAll({t:'reload'});setTimeout(()=>location.reload(),300)}}
  else{const v=await hooks.modal({title:'LEAVE THE TABLE?',body:'Your seat will be held — rejoin later with the same name and room code.',options:[{label:'Yes — leave',v:1},{label:'Stay',v:0}]});if(v)location.reload()}
  return;
 }
 if(!myTurn()||S.over)return;
 switch(act){
  case 'classifiedmode':dispatch({act:'classifiedmode',pay:b.dataset.pay==='money'?'money':'intel'});break;
  case 'endmove':dispatch({act:'endmove'});break;
  case 'flymode':dispatch({act:'flymode'});break;
  case 'slip':dispatch({act:'slip'});break;
  case 'favor':dispatch({act:'favor'});break;
  case 'seize':dispatch({act:'seize'});break;
  case 'bugmode':dispatch({act:'bugmode'});break;
  case 'leakmode':dispatch({act:'leakmode'});break;
  case 'auditmode':dispatch({act:'auditmode'});break;
  case 'tweetmode':dispatch({act:'tweetmode'});break;
   case 'pressure':dispatch({act:'pressure'});break;
   case 'missilemode':dispatch({act:'missilemode'});break;
  case 'bondmageddon':dispatch({act:'bondmageddon'});break;
  case 'sellall':dispatch({act:'sellall'});break;
   case 'rebuild':dispatch({act:'rebuild'});break;
   case 'beach':dispatch({act:'beach'});break;
   case 'qantasdown':dispatch({act:'qantasdown'});break;
   case 'oilcrash':dispatch({act:'oilcrash'});break;
   case 'stage5':dispatch({act:'stage5'});break;
   case 'overmode':dispatch({act:'overmode'});break;
   case 'venicecool':dispatch({act:'venicecool'});break;
   case 'blockmode':dispatch({act:'blockmode'});break;
   case 'evergiven':dispatch({act:'evergiven'});break;
   case 'advance':case 'carry':case 'carbon':dispatch({act:b.dataset.act});break;
   case 'rebuildfree':dispatch({act:'rebuild',free:true});break;
  case 'spin':dispatch({act:'spin',kind:b.dataset.kind});break;
  case 'cook':dispatch({act:'cook'});break;
  case 'budget':dispatch({act:'budget'});break;
  case 'push':dispatch({act:'push'});break;
  case 'jog':dispatch({act:'jog'});break;
  case 'spy':dispatch({act:'spy'});break;
  case 'dossier':dispatch({act:'dossier'});break;
  case 'sweep':dispatch({act:'sweep'});break;
  case 'masspanic':dispatch({act:'masspanic'});break;
  case 'divestmade':dispatch({act:'divestmade'});break;
  case 'marketsell':dispatch({act:'marketsell',id:b.dataset.id});break;
  case 'lobby':dispatch({act:'lobby',kind:b.dataset.kind});break;
  case 'dealmode':dispatch({act:'dealmode'});break;
  case 'refermode':dispatch({act:'refermode'});break;
  case 'sell':dispatch({act:'sell',n:+b.dataset.n});break;
  case 'cancel':dispatch({act:'cancel'});break;
  case 'launder':dispatch({act:'launder',kind:b.dataset.kind});break;
  case 'golfmode':golfFlow();break;
  case 'abduct':abductFlow();break;
  case 'ringbell':bellFlow();break;
  case 'swissdeposit':case 'swisswithdraw':swissFlow(act);break;
  case 'printmoney':case 'lira':case 'greenbuy':case 'liberate':case 'honeypot':case 'srilankadefault':dispatch({act});break;
  case 'laylowcash':dispatch({act:'laylow',choice:'cash'});break;
  case 'laylowcool':dispatch({act:'laylow',choice:'cool'});break;
 }
});

 $('btnHost').onclick=()=>{$('hostForm').classList.add('show');$('joinForm').classList.remove('show');$('lobbyView').style.display='none';setNetStatus('')};
 $('btnJoin').onclick=()=>{$('joinForm').classList.add('show');$('hostForm').classList.remove('show');$('lobbyView').style.display='none';setNetStatus('')};
 $('btnCreate').onclick=()=>{
 if(!IS_DISCORD_ACTIVITY&&typeof Peer==='undefined'){setNetStatus('Could not load the networking library — check your internet connection and reload.',true);return}
 const nm=cleanName($('hostName').value);if(!nm){setNetStatus('Enter your name first.',true);return}requestTurnNotificationPermission();
 $('btnCreate').disabled=true;hostCreate(nm);
};
 $('btnJoinGo').onclick=()=>{
 if(!IS_DISCORD_ACTIVITY&&typeof Peer==='undefined'){setNetStatus('Could not load the networking library — check your internet connection and reload.',true);return}
 const nm=cleanName($('joinName').value);const code=matchBuzzword($('joinCode').value);requestTurnNotificationPermission();
 if(!nm){setNetStatus('Enter your name first.',true);return}
 if(!code){setNetStatus('Enter the buzzword the host read out — e.g. NESA or LOW CORTISOL.',true);return}
 $('btnJoinGo').disabled=true;guestJoin(nm,code);
};
 $('btnStart').onclick=()=>{
 if(Net.roster.length<1||Net.roster.some(e=>!e.char)){hooks.toast('Pick a character before starting.');return}
 requestTurnNotificationPermission();$('btnStart').disabled=true;
 initGame(Net.roster.map(e=>({name:e.name,char:e.char,bot:!!e.bot})));
};
 document.addEventListener('click',e=>{
  const b=e.target.closest('#charGrid .charpick');
  if(!b||b.disabled)return;
  const id=b.dataset.char;
  if(Net.role==='host'){if(Net.roster[0]&&Net.roster[0].bot){hooks.toast('You are spectating — take your seat back to pick a face.');return}applyChar(0,id)}
  else if(Net.conn&&Net.conn.open)Net.conn.send({t:'pick',char:id});
 });
 document.addEventListener('click',e=>{
  if(e.target.closest&&e.target.closest('#btnAddBot')){addBotSeat();return}
  if(e.target.closest&&e.target.closest('#btnSpectate')){toggleSpectate();return}
  const kick=e.target.closest&&e.target.closest('[data-kickbot]');
  if(kick)kickBotSeat(Number(kick.dataset.kickbot));
 });
 (function(){
 const gi=$('goalInput');
 if(!gi)return;
 const push=()=>{if(Net.role!=='host')return;setGoalUI(gi.value);broadcastLobby()};
 gi.oninput=()=>{if(Net.role!=='host')return;const n=Number(gi.value);if(n>=GOAL_MIN&&n<=GOAL_MAX)push()};
 gi.onchange=()=>{if(Net.role!=='host')return;gi.value=clampGoal(gi.value);push()};
})();
(function(){
 const gt=$('geoToggle');
 const wt=$('worldToggle');
 if(wt)wt.onchange=()=>{if(Net.role!=='host'||Net.boardLayout==='worldmap'){wt.checked=!!Net.dlcWorld||Net.boardLayout==='worldmap';hooks.toast(Net.role!=='host'?'The host decides whether the Global Edition exhibits are played.':'THE BIG CON: GLOBAL EDITION always includes its exhibits.');return}setWorldUI(wt.checked);broadcastLobby()};
 if(gt)gt.onchange=()=>{if(Net.role!=='host'){gt.checked=Net.dlcGeo;hooks.toast('The host decides whether the Geography DLC is played.');return}setGeoUI(gt.checked);broadcastLobby()};
 const ft=$('fogToggle');
 if(ft)ft.onchange=()=>{if(Net.role!=='host'){ft.checked=Net.fogOfWar;hooks.toast('The host decides whether Fog of War is enabled.');return}setFogUI(ft.checked);broadcastLobby()};
 const layout=$('boardLayoutSelect');
 if(layout)layout.onchange=()=>{if(Net.role!=='host'){setBoardLayout(Net.boardLayout);hooks.toast('The host decides which board layout is played.');return}setBoardLayout(layout.value);broadcastLobby()};
})();
 $('btnCopy').onclick=()=>{
 const code=Net.roomLabel||Net.roomCode||'';
 try{navigator.clipboard.writeText(code).then(()=>hooks.toast('Room code copied: '+code))}catch(e){hooks.toast('Code: '+code)}
};
(function(){
 const dl=$('buzzwords');
 if(dl)dl.innerHTML=BUZZWORDS.map(b=>'<option value="'+b+'"></option>').join('');
})();
document.querySelector('.setuplinks button[data-srules]').onclick=()=>showRules();
if(!IS_DISCORD_ACTIVITY&&typeof Peer==='undefined'){setNetStatus('⚠ Networking library failed to load — you need an internet connection the first time you connect.',true)}
Presence.menu();

/* Discord "Invite to join" — the desktop build delivers the join secret
   here. The website never sees window.discordRPC, so this is a no-op there. */
(function bindDiscordJoin(){
 const b=(typeof window!=='undefined'&&window.discordRPC)||null;
 if(!b)return;
 function applySecret(secret){
  const code=Presence.decodeJoinSecret(secret);
  if(!code){setNetStatus('That Discord invite did not contain a room.',true);return}
  if(Net.role||Net.begun){
   hooks.toast('Already at a table. Buzzword for the invite was '+codeLabel(code)+'.');
   return;
  }
  $('joinForm').classList.add('show');
  $('hostForm').classList.remove('show');
  $('lobbyView').style.display='none';
  const box=$('joinCode');
  if(box)box.value=codeLabel(code);
  const existing=cleanName(($('joinName')&&$('joinName').value)||($('hostName')&&$('hostName').value)||'');
  function go(nm){
   const name=cleanName(nm);
   if(!name){setNetStatus('Discord invite for “'+codeLabel(code)+'” — type a name and hit JOIN GAME.');return}
   if($('joinName'))$('joinName').value=name;
   $('btnJoinGo').disabled=true;
   guestJoin(name,code);
  }
  if(existing){go(existing);return}
  if(typeof b.getUser==='function'){
   Promise.resolve(b.getUser()).then(u=>{
    const fromDiscord=cleanName(u&&(u.username||''));
    if(fromDiscord)go(fromDiscord);
    else setNetStatus('Discord invite for “'+codeLabel(code)+'” — type a name and hit JOIN GAME.');
   }).catch(()=>setNetStatus('Discord invite for “'+codeLabel(code)+'” — type a name and hit JOIN GAME.'));
   return;
  }
  setNetStatus('Discord invite for “'+codeLabel(code)+'” — type a name and hit JOIN GAME.');
 }
 if(typeof b.onJoin==='function')b.onJoin(applySecret);
 if(typeof b.takePendingJoin==='function'){
  Promise.resolve(b.takePendingJoin()).then(s=>{if(s)applySecret(s)}).catch(()=>{});
 }
})();
}
