'use strict';
/* ui: modal/toast, help, rendering, pan/zoom/input wiring and the setup-screen click wiring. Browser only.
   Nothing runs at import time: initUI() (called once from app.js boot) attaches every listener. toast/modal/render are
   installed as hooks and every module calls them through `hooks`. */
import { $, IS_DISCORD_ACTIVITY, Presence } from './core.js';
import { hooks } from './hooks.js';
import { LOG_SHOWN, Net, S } from './state.js';
import { GOAL_MAX, GOAL_MIN, clampGoal, esc } from './util.js';
import { WIN_TYPES, addChat, applyIntent, blockaded, canFireMissileFrom, canMissileNode, canReach, flatSeize, goalAmount, hasType, initGame, missingTypes, ownsMissileLauncher, pname, projRig, qantasGrounded, qantasGroundedReason, seizeListPrice, takeoverCost } from './engine.js';
import { applyLayoutFromState, boardViewBounds, megaRingMetrics, nodeBox, ringworldMetrics } from './boards.js';
import { ADJ, BUZZWORDS, EDGES, MOODS, NMAP, NODES, QUIK_SLOTS, TYPE_COLORS, charSrc, codeLabel, matchBuzzword } from './data.js';
import { addBotSeat, applyChar, backToLobby, broadcastLobby, cleanName, guestJoin, hostCreate, kickBotSeat, sendAll, setBoardLayout, setFogUI, setGeoUI, setGoalUI, setNetStatus, toggleSpectate } from './net.js';
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
const TURN_ALERTS_KEY='bigcon-v1.13-turn-alerts';
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
  const p=S.players[S.cur];const n=new Notification('THE BIG CON v1.13 — Your turn',{body:(p&&p.name?p.name+' — ':'')+'It is your move. Open the game to make your play.',tag:'bigcon-turn-'+key,renotify:false});
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
 '<h4>Online play (2–8 players)</h4><p>One player <b>hosts</b> and shares the room code — a jt portal <b>buzzword</b> (NESA, LOW CORTISOL, JAKE TOMKINS…), every one of them straight off the jt portal news ticker; the others <b>join</b> by typing it — the table seats up to <b>eight</b>. Short a friend? The host can <b>🤖 seat a bot</b> — it plays through the same rules, sends the same moves, and only ever knows what the table shows it. Or hand your <b>own seat</b> to a bot too and spectate: a table full of cons, and you just watch (and chat). Each player sees only their own secret prompts. If someone drops, their seat auto-plays “lay low” — rejoin with the <b>same name</b> to reclaim your empire. The table plays on: joining <b>mid-con</b> deals you in fresh at <b>Quikstop</b> — $15 and 2 Intel, the same stake every first turn gets — or you can take the <b>spectator rail</b> and just watch. Chat in the <b>lobby</b> before the con starts, and in the sidebar once it does.</p>'
 +'<h4>The market mood — events you can feel</h4><p>Every market event shifts the mood of the whole board — watch the <b>ticker</b> across the top, the <b>tint</b> of the board and the <b>glowing nodes</b>: <b style="color:#f5c542">BOOM</b> (commodities +$1/turn), <b style="color:#ff6b5e">PANIC</b> (banks −$1/turn, intel dearer), <b style="color:#e19bff">MEDIA FRENZY</b> (media +$1/turn), <b style="color:#8fbf7f">CALM</b>. Yields go vertical in a panic; the oil graph spikes in a boom. Money, Cortisol and Intel changes pop up on the board as they happen.</p>'
 +'<h4>Intel ops (🛈)</h4><ul><li><b>Burn a favor</b> (1 🛈, while moving) — +1 step this turn.</li><li><b>Spy on the deck</b> (2 🛈, free action) — privately see the next event card, anywhere.</li><li><b>The Dossier</b> (3 🛈, free action) — your hostile takeovers this turn cost <b>list price, not double</b>.</li><li><b>Sweep for bugs</b> (2 🛈, your action) — remove every bug on your nodes.</li><li><b>Mass panic</b> (5 🛈, your action) — every player gains +2 Cortisol.</li><li><b>Divest MADE</b> (5 🛈, your action) — take MADE from any rival and pay its former owner $7 compensation.</li><li><b>Sell intel</b> (your action, anywhere): sell 1–3 or <b>ALL</b> your Intel at once for the current market rate. Bad news is good news.</li><li><b>Overload a rival</b> (30 🛈, your action): choose one rival to receive <b>+6 Cortisol</b>, bypassing the normal one-node immunity.</li></ul>'
 +'<h4>The board is the whole collage</h4><p><b>70 exhibits.</b> Charts are spread across the collage — US yields sit by Trump, Japan by the tankers, UK by the papers, Australia by the coat of arms, and the 10-year master in the middle. Each game <b>Quikstop opens in a different neighbourhood</b>, so the first moves change. New pins from the collage: <b>Westpac</b>, <b>BHP</b>, <b>Herald Sun / The Jim Reaper</b>, <b>the bullet train</b>, the circled <b>ASICS shoe</b>, and <b>Toktimer</b>. Red threads are the paths — long ones dash. <i>Drag to pan, scroll to zoom.</i></p>'
 +'<h4>Winning</h4><p><b>Money <i>and</i> a finished portfolio.</b> The host sets a cash target in the lobby (anything from $'+GOAL_MIN+' to $'+GOAL_MAX+'); to take the con you must reach it <b>while holding at least one '+WIN_TYPES.join(', one ')+' node</b> — the seven-type set (BANK, REGULATOR, CHART, WILD, CORPORATE, COMMODITY and MEDIA) is tracked in your sidebar. There are only four REGULATORS on the whole board, so the set is a race of its own. Nodes, synergies, bugs and the mood are all just ways of getting there faster — the board banner and the sidebar show the target and who is closest.</p>'
 +'<h4>Your turn</h4><p><b>1 · Income</b> — $3 salary (+$1 CPI-indexed with Inflation Compensation) + holdings &amp; powers &amp; mood. <b>2 · Move</b> — 3 steps (+1 with COAL CORP HQ, +1 with the Coal Train <i>or</i> the Bullet Train, +1 with the ASICS shoe, +1 by burning a favor). Tolls: $1 entering a rival’s node — $2 if they hold Albanese, free if you hold James Bond. <b>3 · One action</b> (plus free intel ops). <b>4 · Market event</b> for the whole table — and the mood moves.</p>'
 +'<h4>Actions</h4><ul><li><b>Seize</b> the node you stand on (+1 🔥). Hostile takeover: double cost (list price with the Dossier; MADE, Qantas, the RBA and ESG Pillars never inflate), old owner pockets list price, +2 🔥, +$2 ACCC fee if they own the ACCC.</li><li><b>Plant a bug</b> (1 🛈; free with INSIDER TRADING) — skim $1/turn ($2 with the WEF).</li><li><b>Leak dirt</b> (2 🛈) — rival +2 Cortisol · <b>Audit</b> ($4, ASIC) — rival +1 Cortisol · <b>The Tweet</b> ($2, Trump) — rival loses the greater of 3 Intel or 50% of their Intel.</li><li><b>Spin</b> ($3 Press Room) / <b>Fox Spin</b> ($2 Fox Business) · <b>Cook the books</b> ($3, The Rock) · <b>Budget night</b> ($3, the Government) · <b>Lean on the table</b> (Backroom Deals: every rival +1 🔥; using a Backroom ability costs 2 movement steps).</li><li><b>Push the boulder</b> — earns $10 the first time, then doubles every push ($10, $20, $40, $80…). No Cortisol cost. · <b>Fly the Qantas jet</b> ($3, teleport — Qantas itself cannot be reached on turn 1) · <b>Slipstream</b> ($2, Formula 1: +2 steps and $2 off the next seizure) · <b>Lay low</b> (choose $1 cash or −2 Cortisol). · <b>Blockade</b> (free, the PM, once per turn) — wall off literally any node for one full rotation: nobody walks in, nobody lands, not even you.</li></ul>'
 +'<p><b>BONDMAGEDDON</b> (Bond Desk, $16 + 4 🛈, once per turn): launch four missiles at the rival with the most CHART holdings. If they own the ESG Pillars, three missiles hit ESG and the fourth hits another random holding.</p>'
 +'<h4>Cortisol &amp; raids</h4><p>Cortisol is capped at 9. At 🔥9 the regulators raid you, and a raid hurts: your <b>two</b> highest-income nodes are seized, every bug you planted is pulled, you pay a fine of $5 or 30% of your cash (whichever is larger), your Intel is burned down to 1, Cortisol resets to 0 and your <b>next turn brings no income and a single step</b>. <b>The whole table sees the raid</b> — it pops up on every screen. The Hedge Fund pays $3 on every raid; the Group Photograph pays 1 🛈 Intel.</p>'
 +'<h4>ACCC concentration</h4><p>Charts are exempt from the six type-based industries; the custom MONETARY POLICY industry also counts the CASH-RATE and INFLATION charts. If you hold <b>more than two</b> properties in the same tracked industry — banking, regulators, corporates, coal, commodities, media, oil, education, JTPortal, Jim Chalmers, Big Bessent, or monetary policy — then at the start of <b>your turn</b> there is a <b>33% chance</b> the regulators investigate: <b>ASIC</b> runs monetary-policy books as <b>market manipulation</b>, the <b>ACCC</b> takes every other industry. You pay a <b>20% fine on both cash and Intel</b>; divested nodes are randomly redistributed to other players (maximum one node per player), with any remainder returned to the market. Owning <b>Mark Watson</b> exempts your holdings in the COAL industry from ACCC monopoly investigations.</p>'
 +'<h4>MADE (???)</h4><p>Nobody knows what the purple graphic is, but it moves money: at the <b>start of every player\'s turn</b> there is a chance MADE pays out (<b>33% at 2 seats, 22% at 3, 17% at 4, 13% at 5, 11% at 6, 10% at 7, 8% at 8</b>) — <b>+$10 and +1 Intel</b> to its owner. Every other player with <b>more than two nodes and at least $50</b> pays 15% of their cash to the void. Seizing MADE always costs list price — it never inflates after a takeover. You may also force MADE to divest from any rival for <b>5 Intel</b>, paying the former owner <b>$7 compensation</b>.</p>'
 +'<h4>🌍 The Geography DLC — the board expands over the water</h4><p>Host-toggled in the lobby (look for <b>ENABLE THE GEOGRAPHY DLC</b>). <b>On: the board deals 82 exhibits.</b> Off: the same 70 exhibits as always.</p>'
 +'<ul><li><b>MISSILE COMMAND ($8) / IRANIAN SHAHED DRONE ($8)</b> — you can own <b>MISSILE COMMAND or the SHAHED DRONE</b>, but not both. Either owned launch site can LAUNCH A MISSILE ($4 + 1 🛈, once per turn): stand on the launcher you own to fire, or own KIM JONG UN to fire from anywhere. An <b>owned node is expropriated with NO payout</b> to its former owner; either way it becomes <b>RUBBLE</b> until rebuilt at list price. The <b>ESG Pillars themselves can be missile-struck</b>. Strike a <b>REGULATOR</b> and an investigation opens — <b>ASIC or the ACCC</b> comes for you on your next turn: a 50/50 indictment, and <b>+1 Cortisol</b> whether it lands or not.</li>'
 +'<li><b>PYONGYANG CITY ($6)</b> — +$1 income per Geography node you own. The capital collects tribute.</li>'
 +'<li><b>PYONGYANG HOTEL ($8)</b> — collects <b>$2</b> whenever anyone rebuilds rubble. Construction kickbacks, allegedly.</li>'
 +'<li><b>WONSAN RESORT ($5)</b> — stand there (owned) for <b>BEACH DAY</b>: free, once per turn, <b>−2 Cortisol</b>.</li>'
 +'<li><b>IRANIAN SHAHED DRONE ($8)</b> — a second missile launch site using the same rules and cost as MISSILE COMMAND; one player cannot own both.</li>'
 +'<li><b>KIM JONG UN ($6)</b> — <b>+1 Intel at the start of each of your turns</b>. Owning him exempts you from either launcher’s on-site rule — the keys work from anywhere.</li>'
 +'<li><b>THE CORPORATE BOEING ($7)</b> — SHUT DOWN QANTAS ($4, once per turn): the kangaroo is <b>grounded for two full turns</b> — nobody flies the jet, and its owner collects nothing from it.</li>'
 +'<li><b>THE SOUTH CHINA SEA ($9)</b> — TRIGGER AN OIL CRASH ($3, once per turn): PANIC mood, and every player pays <b>$2 per oil node</b> they own (Pillars players exempt).</li>'
 +'<li><b>STAGE 5 DECLINE ($4)</b> — CALL STAGE 5 (2 🛈, once per turn): the <b>richest player</b> (never you) makes <b>no income of any kind on their next turn</b>.</li>'
 +'<li><b>PILLARS OF SUSTAINABILITY ($6)</b> — <b>ESG SHIELD</b>: −1 Cortisol each of your turns; the Pillars themselves can be missile-struck and your holdings remain vulnerable to Overtourism; you still pay nothing on an oil crash and Stage 5 cannot call you.</li>'
 +'<li><b>VENICE DI CCTV ($8)</b> — stand there (owned) for <b>GONDOLA THERAPY</b>: free, once per turn, −1 Cortisol. Or, as your action, send <b>OVERTOURISM</b> ($2, once per turn, one or the other): pick a rival-owned node (including ESG holdings) — the target takes <b>+1 Cortisol</b> on their turn during the next full table rotation. It ends when the rotation finishes or Venice changes hands.</li>'
 +'<li><b>TUVALU .TV ($5)</b> — THE JOIN IS FREE: the first player to arrive simply owns it. No action, no cost, no Cortisol. <b>Missiles aimed at Tuvalu are REFLECTED</b> back onto the launcher’s own holdings — and their silo blows up in the backblast.</li></ul>'
 +'<h4>Turn notifications &amp; player identity</h4><p>Desktop turn alerts are enabled by default. Use <b>TURN ALERTS</b> in the game sidebar to switch them on or off; your choice is saved on this device. Your browser or desktop app must allow notifications for alerts to appear. Choose a character in the lobby to lock in that character’s dedicated player colour, shown beside the portrait and used throughout the game. Player names support up to 80 characters.</p><p class="fine">No dice. The dice were rigged from the start.</p>',
 options:[{label:'Back to the con',v:1}]});
}

/* ================= RENDERING (shared by host & guests) ================= */
export function render(){
 if(!S)return;
 
 notifyCurrentTurn(false);applyLayoutFromState();renderBoard();renderSide();
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
export function nodeSVG(n,cls){
 const me=S&&S.players[Net.myIdx];
 const discovered=!S||!S.fogOfWar||(me&&me.visited&&me.visited[n.id]);
 if(!discovered){
  /* Unknown destinations are hinted only when they are directly reachable.
     Other unseen locations leave no marker, so the hidden map cannot be read. */
  if(cls.indexOf('reach')<0)return '';
  const box=nodeBox(n),w=box[0],h=box[1];
  return '<g class="node fog-node click reach" transform="translate('+n.x+','+n.y+')" data-id="'+n.id+'" opacity=".94"><rect x="'+(-w/2)+'" y="'+(-h/2)+'" width="'+w+'" height="'+h+'" fill="#101716" stroke="#7ff6fb" stroke-width="3" stroke-dasharray="7 6"/><text text-anchor="middle" y="5" font-size="18" font-weight="900" fill="#7ff6fb">?</text></g>';
 }
 const o=S?S.owner[n.id]:null;
 const ownr=o!=null;
 const oc=ownr?S.players[o].color:'#8a7a5f';
 const bug=S&&S.bugs[n.id]!=null;
 const rb=S&&S.dlcGeo&&S.rubble[n.id];
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
 const badges=(ot?'<text x="'+(w/2-36)+'" y="'+(-h/2+18)+'" font-size="12">🛳️</text>':'')+(gq?'<text x="'+(-w/2+6)+'" y="'+(-h/2+18)+'" font-size="12">⛔</text>':'')+(bl?'<text x="'+(-w/2+7)+'" y="'+(-h/2+18)+'" font-size="15" font-weight="900">🚧</text>':'');
 const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 let tip='';
 if(bl)tip+='&#10;🚧 BLOCKADED — entry and Qantas landing are prohibited until the blockade expires.';
 if(rb)tip+='&#10;💥 RUBBLE — arrive and pay $'+n.cost+' in your action phase to rebuild. No income, nothing to seize until rebuilt.';
 if(ot)tip+='&#10;🛳️ OVERTOURISM — its owner takes +1 Cortisol at each of their turns while Venice stays owned.';
 return '<g class="node '+cls+'" data-id="'+n.id+'" transform="translate('+n.x+','+n.y+') rotate('+n.rot+')">'
  +ownerGlow+moodGlow+halo
  +'<image class="node-image" href="'+n.image+'" x="'+(-w/2)+'" y="'+(-h/2)+'" width="'+w+'" height="'+h+'" preserveAspectRatio="none"/>'
  +(rb?'<rect x="'+(-w/2)+'" y="'+(-h/2)+'" width="'+w+'" height="'+h+'" fill="rgba(8,6,6,0.72)"/><text x="0" y="-4" text-anchor="middle" font-size="22">💥</text><text x="0" y="16" text-anchor="middle" font-size="9" font-weight="900" fill="#ffb08a" letter-spacing="1">REBUILD $'+n.cost+'</text>':'')
  +ownerTag+bugTag+badges
  +'<title>'+esc(n.name.join(' '))+' — '+n.type+' · $'+n.income+'/turn · seize $'+n.cost+'&#10;'+esc(n.sub)+'&#10;'+esc(n.sp)+tip+'</title></g>';
}
export function tokenLayer(){
 const byPos={};S.players.forEach((p,i)=>{(byPos[p.pos]=byPos[p.pos]||[]).push(i)});
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
 return S&&S.phase==='action'&&S.mode==='bug'&&S.cur===me
  &&S.owner[n.id]!=null&&S.owner[n.id]!==me
  &&S.bugs[n.id]==null
  &&(ADJ[S.players[me].pos]||[]).includes(n.id);
}
export function missileTargetable(n){
 const me=Net.myIdx;
 return S&&(S.phase==='action'||S.phase==='move')&&S.mode==='missile'&&S.cur===me&&S.dlcGeo
  &&canMissileNode(me,n.id);
}
export function overtourTargetable(n){
 const me=Net.myIdx;
 return S&&S.phase==='action'&&S.mode==='overtour'&&S.cur===me&&S.dlcGeo
  &&S.owner[n.id]!=null&&S.owner[n.id]!==me&&!S.rubble[n.id]
  &&S.owner[n.id]!==S.owner.geo_pillars;
}
export function blockadeTargetable(n){
 const me=Net.myIdx;
 return S&&S.phase==='action'&&S.mode==='blockade'&&S.cur===me&&S.owner.albo===me
  &&!S.rubble[n.id]&&!blockaded(n.id);
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
 const d='M'+A.x+','+A.y+' Q'+c.mx+','+c.my+' '+B.x+','+B.y;
 return '<path d="'+d+'" fill="none" stroke="#000" stroke-width="'+glowW+'" opacity=".55" stroke-linecap="round"/><path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="'+w+'" stroke-linecap="round"/>';
}
function nodeRing(id,color,w,pad,dash){
 const n=NMAP[id];if(!n)return '';
 const b=nodeBox(n),bw=b[0],bh=b[1];
 return '<rect x="'+(n.x-bw/2-pad)+'" y="'+(n.y-bh/2-pad)+'" width="'+(bw+pad*2)+'" height="'+(bh+pad*2)+'" fill="none" stroke="'+color+'" stroke-width="'+w+'"'+(dash?' stroke-dasharray="'+dash+'"':'')+'/>';
}
export function drawHighlights(){
 const g=$('hlg');
 if(!g)return;
 if(!S){g.innerHTML='';return}
 ensureEdgeIndex();
 let lines='',out='';
 const me=myPos();
 const hov=hoverId&&discoveredNode(hoverId)?hoverId:null;
 const path=(pinnedId&&discoveredNode(pinnedId)&&me)?shortestPath(me,pinnedId):null;
 const links=hov?(ADJ[hov]||[]).filter(v=>visibleLink(hov,v)):[];
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
 const special=mega||ring;
 const bounds=boardViewBounds();
 const metrics=mega?megaRingMetrics(Math.max(3,(S.boardLayout||[]).length-1)):(ring?ringworldMetrics(Math.max(3,(S.boardLayout||[]).length-1)):null);
 const curpos=S?S.players[S.cur].pos:null;
 let s='';
 s+='<defs><pattern id="dots" width="'+(special?56:26)+'" height="'+(special?56:26)+'" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="rgba(22,131,136,0.18)"/></pattern></defs>';
 s+='<rect x="0" y="0" width="'+bounds.w+'" height="'+bounds.h+'" fill="#1d201f"/><rect x="0" y="0" width="'+bounds.w+'" height="'+bounds.h+'" fill="url(#dots)"/>';
 s+='<rect x="0" y="0" width="'+bounds.w+'" height="'+bounds.h+'" fill="'+md.tint+'" pointer-events="none"/>';
 s+='<rect x="7" y="7" width="'+(bounds.w-14)+'" height="'+(bounds.h-14)+'" rx="0" fill="none" stroke="#168388" stroke-width="'+(special?8:3)+'" opacity=".7"/>';
 EDGES.forEach((e,i)=>{
  if(!edgeVisible(e))return;
  const c=edgeCurve(e,i);
  if(!c)return;
  const d=c.d,len=c.len;
  const hot=S&&!S.over&&S.phase==='move'&&S.mode!=='fly'&&S.steps>0&&(e[0]===curpos||e[1]===curpos);
  const long=len>520;
  s+='<path d="'+d+'" fill="none" stroke="#08383a" stroke-width="'+(hot?6:long?3.5:5)+'" opacity="'+(hot?'.7':'.35')+'"/>';
  s+='<path d="'+d+'" fill="none" stroke="'+(hot?'#7ff6fb':'#168388')+'" stroke-width="'+(hot?3:long?1.6:2)+'" stroke-dasharray="'+(long?'11 8':'')+'" opacity="'+(hot?'1':'.9')+'"/>';
 });
 if(mega){
  s+='<circle cx="'+metrics.cx+'" cy="'+metrics.cy+'" r="'+metrics.radius+'" fill="none" stroke="#168388" stroke-width="3" stroke-dasharray="18 20" opacity=".22"/>';
  s+='<circle cx="'+metrics.cx+'" cy="'+metrics.cy+'" r="'+(metrics.radius-175)+'" fill="none" stroke="#168388" stroke-width="2" stroke-dasharray="4 18" opacity=".14"/>';
  s+='<g transform="translate('+metrics.cx+',95)"><rect x="-330" y="-27" width="660" height="48" fill="#168388" stroke="#000" stroke-width="2"/><text text-anchor="middle" y="5" font-size="22" font-weight="900" letter-spacing="3" fill="#fff" font-family="Bestigia, sans-serif">THE BIG CON v1.13 · MEGA RING</text></g>';
  s+='<g transform="translate('+metrics.cx+',175)"><rect x="-1050" y="-15" width="2100" height="30" fill="#000" stroke="'+md.color+'" stroke-width="2" opacity=".96"/><circle class="tkdot" cx="-1028" cy="0" r="6" fill="'+md.color+'"/><text x="-1008" y="4" font-size="13" font-weight="900" letter-spacing="1.5" fill="aqua">'+md.label+'</text><text x="0" y="4" text-anchor="middle" font-size="12" font-style="italic" fill="#ddd">'+esc((S.wire||'all quiet on the wire').slice(0,100))+'</text><text x="1028" y="4" text-anchor="end" font-size="12" font-weight="800" fill="#9ad">1🛈=$'+md.rate+'</text></g>';
 }else if(ring){
  metrics.radii.forEach((r,i)=>{
   s+='<ellipse cx="'+metrics.cx+'" cy="'+metrics.cy+'" rx="'+r.x+'" ry="'+r.y+'" fill="none" stroke="#168388" stroke-width="'+(i===0?3:2)+'" stroke-dasharray="'+(i===0?'18 20':'4 18')+'" opacity="'+(i===0?'.22':'.14')+'"/>';
  });
  s+='<g transform="translate('+metrics.cx+',95)"><rect x="-330" y="-27" width="660" height="48" fill="#168388" stroke="#000" stroke-width="2"/><text text-anchor="middle" y="5" font-size="22" font-weight="900" letter-spacing="3" fill="#fff" font-family="Bestigia, sans-serif">THE BIG CON v1.13 · RINGWORLD</text></g>';
  s+='<g transform="translate('+metrics.cx+',175)"><rect x="-1050" y="-15" width="2100" height="30" fill="#000" stroke="'+md.color+'" stroke-width="2" opacity=".96"/><circle class="tkdot" cx="-1028" cy="0" r="6" fill="'+md.color+'"/><text x="-1008" y="4" font-size="13" font-weight="900" letter-spacing="1.5" fill="aqua">'+md.label+'</text><text x="0" y="4" text-anchor="middle" font-size="12" font-style="italic" fill="#ddd">'+esc((S.wire||'all quiet on the wire').slice(0,100))+'</text><text x="1028" y="4" text-anchor="end" font-size="12" font-weight="800" fill="#9ad">1🛈=$'+md.rate+'</text></g>';
 }else{
  s+=scribble(1830,860,100,64,4)+scribble(1150,540,95,72,-3)+scribble(1000,1380,92,62,5)+scribble(1630,930,96,62,-4)+scribble(1500,470,98,62,3)+scribble(2020,185,92,66,-5)+scribble(390,1200,102,68,3);
  s+=redArrow(2090,330,1140,310)+redArrow(1965,235,1580,440)+redArrow(1080,585,480,1140)+redArrow(1130,1170,420,640);
  s+=scribText(1930,392,-4,'CASH RATE ↑')+scribText(1150,390,3,'“BOND…”')+scribText(1715,448,-6,'WTI +12%')+scribText(455,295,2,'TOO BIG TO FAIL')+scribText(1930,745,-3,'GOLD ↑')+scribText(1050,1150,4,'RATES ON HOLD')+scribText(640,810,-5,'INSIDER TRADING?');
  s+='<g transform="translate(58,40)"><rect x="-4" y="-22" width="268" height="36" fill="#168388" stroke="#000" stroke-width="2"/><text x="14" y="3" font-size="16" font-weight="900" letter-spacing="2" fill="#fff" font-family="Bestigia, sans-serif">THE BIG CON v1.13</text></g>';
  /* the market wire — the mood, live */
  s+='<g transform="translate(1230,30)"><rect x="-700" y="-13" width="1400" height="26" fill="#000" stroke="'+md.color+'" stroke-width="2" opacity=".96"/><circle class="tkdot" cx="-682" cy="0" r="5" fill="'+md.color+'"/><text x="-668" y="4" font-size="11" font-weight="900" letter-spacing="1.5" fill="aqua">'+md.label+'</text><text x="-20" y="4" text-anchor="middle" font-size="10.5" font-style="italic" fill="#ddd">'+esc((S.wire||'all quiet on the wire').slice(0,88))+'</text><text x="688" y="4" text-anchor="end" font-size="10" font-weight="800" fill="#9ad">1🛈=$'+md.rate+'</text></g>';
 }
 let lx=special?metrics.cx-360:560;
 s+='<g transform="translate(0,'+(special?245:62)+')">';
 Object.keys(TYPE_COLORS).forEach(k=>{
  s+='<rect x="'+lx+'" y="-7" width="10" height="10" rx="2" fill="'+TYPE_COLORS[k]+'"/><text x="'+(lx+14)+'" y="2" font-size="9" font-weight="800" fill="#cbb992">'+k+'</text>';
  lx+=14+k.length*6.2+16;
 });
 s+='</g>';
 const goalNow=goalAmount();
 const leader=S.players.reduce((a,b)=>b.money>a.money?b:a,S.players[0]);
 const footerX=special?metrics.cx:1200,footerY=special?bounds.h-155:1490;
 s+='<g transform="translate('+footerX+','+footerY+')"><rect x="-800" y="-14" width="1600" height="25" fill="#000" stroke="#168388" stroke-width="1.5"/><text text-anchor="middle" y="3" font-size="'+(special?14:10.5)+'" font-weight="700" letter-spacing="1" fill="#fff">WIN CONDITION: FIRST TO $'+goalNow+' TAKES THE CON</text></g>';
 s+='<g transform="translate('+footerX+','+(footerY+38)+')"><rect x="-800" y="-12" width="1600" height="23" fill="#000" stroke="#168388" stroke-width="1.5"/><text text-anchor="middle" y="3" font-size="'+(special?13:10)+'" font-weight="700" letter-spacing="1" fill="aqua">FRONT RUNNER: '+esc(String(leader.name).toUpperCase())+' — $'+leader.money+' · $'+Math.max(0,goalNow-leader.money)+' TO GO</text></g>';
 NODES.forEach(n=>{
  let cls='';
  if(S&&!S.over){
   if(S.mode==='fly')cls=canReach(n.id)?'click':'';
   else if(S.mode!=='missile'&&S.phase==='move'&&S.cur===Net.myIdx&&S.steps>0&&(ADJ[curpos]||[]).includes(n.id)&&canReach(n.id))cls='click reach';
   else if(bugTargetable(n))cls='click target';
   else if(missileTargetable(n))cls='click target';
   else if(overtourTargetable(n))cls='click target';
   else if(blockadeTargetable(n))cls='click target';
  }
  s+=nodeSVG(n,cls);
 });
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
export function renderSide(){
 const side=$('side');
 const me=Net.myIdx;const p=S.players[S.cur];const isTurn=S.cur===me;
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
  if(S.mode==='fly'){phaseHtml='<div class="phlabel">PHASE 1 · MOVE — FLYING</div><p><b>FLYING:</b> click <b>any node</b> on the board to land there ($3).</p><button class="act" data-act="cancel">Cancel flight</button>'}
  else if(S.mode==='missile'){phaseHtml='<div class="phlabel">🚀 MISSILE AWAY — $4 + 1 🛈</div><p><b>LAUNCHING:</b> click <b>any node</b> on the board to strike it. The launch <b>ends your move</b>, and your action phase still follows.</p><button class="act" data-act="cancel">Abort the launch</button>'}
  else{
   phaseHtml='<div class="phlabel">PHASE 1 · MOVE</div>'
    +'<p>Click a <b>highlighted node</b> to move along the red threads (3 steps now — the board is wider). Tolls: <b>$1</b> entering a rival’s node (<b>$2</b> if they hold ALBANESE, <b>free</b> if you hold JAMES BOND).</p>'
    +'<div class="dots">'+dots+' <span>'+S.steps+' step'+(S.steps!==1?'s':'')+' left</span></div>'
    +'<button class="act" data-act="endmove">Stay put — end movement</button>'
    +((!S.extraStep&&p.intel>=1)?'<button class="act" data-act="favor">🛈 Burn a favor — 1 🛈 (+1 step this turn)</button>':'')
    +((S.owner.qantas===me)?'<button class="act" data-act="flymode"'+(p.money>=3?'':' disabled')+'>✈️ Fly the Qantas jet — $3 (anywhere)</button>':'')
    +((S.owner.f1===me&&!S.slipped)?'<button class="act" data-act="slip"'+(p.money>=2?'':' disabled')+'>🏎️ Slipstream — $2 (+2 steps, $2 off next seizure)</button>':'')
    +((S.dlcGeo&&ownsMissileLauncher(me)&&canFireMissileFrom(me))?'<button class="act" data-act="missilemode"'+((p.money>=4&&p.intel>=1&&!S.geoMissiled)?'':' disabled')+' title="From either launcher (anywhere with Kim Jong Un): strike any node that still stands — the launch ends your move; your action still follows ($4 + 1 Intel, once per turn)">🚀 Launch a missile — $4 + 1🛈 (ends the move)</button>':'');
    if(S.owner.back===me&&!S.backroomAbilityUsed){
     phaseHtml+='<div class="sublabel">BACKROOM DEALS · ONE NODE ABILITY · COSTS 2 MOVEMENT STEPS</div><div class="btns">';
     const backroomStepLock=S.steps<2?' disabled':'';
     if(S.owner.trump===me)phaseHtml+='<button class="act" data-act="tweetmode"'+((p.money>=2?'':' disabled')+backroomStepLock)+'>🦅 The Tweet — $2 · 2 steps</button>';
     phaseHtml+='<button class="act" data-act="pressure"'+backroomStepLock+'>🤝 Lean on the table · 2 steps</button>';
     if(S.owner.gov===me)phaseHtml+='<button class="act" data-act="budget"'+((p.money>=3?'':' disabled')+backroomStepLock)+'>🦘 Budget night — $3 · 2 steps</button>';
     if(S.owner.rock===me)phaseHtml+='<button class="act" data-act="cook"'+((p.money>=3?'':' disabled')+backroomStepLock)+'>💪 Cook the books — $3 · 2 steps</button>';
     if(S.owner.asic===me)phaseHtml+='<button class="act" data-act="auditmode"'+((p.money>=4&&!S.audited?'':' disabled')+backroomStepLock)+'>⚖️ Audit — $4 · 2 steps</button>';
     if(S.owner.press===me)phaseHtml+='<button class="act" data-act="spin" data-kind="press"'+((p.money>=3&&!S.spun?'':' disabled')+backroomStepLock)+'>🗞️ Spin the press — $3 · 2 steps</button>';
     if(S.owner.fox===me)phaseHtml+='<button class="act" data-act="spin" data-kind="fox"'+((p.money>=2?'':' disabled')+backroomStepLock)+'>🦊 Fox spin — $2 · 2 steps</button>';
     if(S.owner.sisy===me&&p.pos==='sisy')phaseHtml+='<button class="act" data-act="push"'+backroomStepLock+'>🪨 Push the boulder — +$'+(S.sisyPayout||10)+' · 2 steps</button>';
     if(S.owner.asics===me&&p.pos==='asics')phaseHtml+='<button class="act" data-act="jog"'+backroomStepLock+'>👟 Jog a lap — −1 🔥 · 2 steps</button>';
     if(S.dlcGeo&&S.owner.geo_boeing===me)phaseHtml+='<button class="act" data-act="qantasdown"'+((p.money>=4&&!S.geoBoeing&&S.owner.qantas!==me?'':' disabled')+backroomStepLock)+' title="Ground a rival or unowned Qantas for two full turns; unavailable if you own Qantas">🛩️ Ground Qantas — $4 · 2 steps</button>';
     if(S.dlcGeo&&S.owner.geo_scs===me)phaseHtml+='<button class="act" data-act="oilcrash"'+((p.money>=3&&!S.geoCrash?'':' disabled')+backroomStepLock)+'>🌊 Oil crash — $3 · 2 steps</button>';
     if(S.dlcGeo&&S.owner.geo_stage5===me)phaseHtml+='<button class="act" data-act="stage5"'+((p.intel>=2&&!S.geoStage5?'':' disabled')+backroomStepLock)+'>📉 Stage 5 — 2🛈 · 2 steps</button>';
     phaseHtml+='</div>';
    }

  }
 } else if(S.phase==='action'){
  const nid=p.pos,n=curN,prev=S.owner[nid];
  const powline='<div class="pow"><b>'+n.name.join(' ')+'</b> — '+n.sp+'</div>';
  if(S.mode==='bug'){
   phaseHtml='<div class="phlabel">PLANT A BUG</div>'+powline+'<p>Click a <b>highlighted rival node next to you</b> on the board. You will skim <b>$1/turn</b> off it.</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='missile'){
   phaseHtml='<div class="phlabel">🚀 LAUNCH A MISSILE — $4 + 1 🛈 (once per turn)</div>'+powline+'<p>Click <b>any node</b> on the board. An owned node is expropriated with <b>no payout</b>; either way it becomes <b>rubble</b> — no income, nothing to seize, until someone stands there and pays its list price to rebuild (a rebuild is an action of its own).</p><button class="act" data-act="cancel">Abort the launch</button>';
  } else if(S.mode==='blockade'){
   phaseHtml='<div class="phlabel">🚧 ALBANESE BLOCKADE — FREE · ONCE PER TURN</div>'+powline+'<p>Click any <b>highlighted node</b> to block entry for one full rotation. Blocked nodes display a 🚧 marker. Nobody can walk or fly into one, including you; income and missiles are unaffected. Rubble and already-blocked nodes cannot be selected.</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='overtour'){
   phaseHtml='<div class="phlabel">🛳️ OVERTOURISM — $2</div>'+powline+'<p>Click a <b>rival-owned node</b>. While you own Venice and the ships keep coming, its owner takes <b>+1 Cortisol</b> at the start of each of their turns.</p><button class="act" data-act="cancel">Cancel</button>';
  } else if(S.mode==='leak'||S.mode==='audit'||S.mode==='tweet'||S.mode==='roast'){
   const lab={leak:'LEAK DIRT — 2 🛈 (rival +2 🔥)',audit:'AUDIT — $4 (rival +1 🔥)',tweet:'THE TWEET — $2 (rival loses Intel)',roast:(S.spinKind==='fox'?'FOX SPIN — $2 (rival +1 🔥)':'SPIN THE PRESS — $3 (rival +1 🔥)')}[S.mode];
   phaseHtml='<div class="phlabel">'+lab+'</div>'+powline+'<p>Click a <b>rival</b> in THE SYNDICATE list below.</p><button class="act" data-act="cancel">Cancel</button>';
  } else {
   let base=seizeListPrice(me,n);
   const isTake=prev!=null&&prev!==me;
   const cost=isTake?takeoverCost(me,nid,base):base;
   const maxPay=p.money+(S.owner.back===me?Math.min(3,p.intel):0);
   const btns=[];
   if(prev===me){
    btns.push('<div class="ownnote">You already control <b>'+n.name.join(' ')+'</b>.</div>');
    if(nid==='sisy')btns.push('<button class="act primary" data-act="push">Push the boulder — +$'+(S.sisyPayout||10)+' (next push doubles)</button>');
    if(nid==='asics')btns.push('<button class="act primary" data-act="jog">Jog a lap — free −1 🔥</button>');
   }else if(S.dlcGeo&&S.rubble&&S.rubble[nid]){
    btns.push('<button class="act primary" data-act="rebuild"'+(p.money>=cost?'':' disabled')+'>♻️ Rebuild '+n.name.join(' ')+' — $'+cost+' (returns unowned — first bids from next turn)</button>');
    btns.push('<div class="ownnote">Rubble since a missile strike — no income, nothing to seize, until it is rebuilt.</div>');
   }else{
    const afford=maxPay>=cost;
    const lbl=isTake?('Hostile takeover — $'+cost+(flatSeize(nid)?' (never inflates)':S.dossier?' (DOSSIER: list price)':' (takeover '+(S.seizeCount[nid]||0)+'×)')):('Seize '+n.name.join(' ')+' — $'+cost);
    btns.push('<button class="act primary" data-act="seize"'+(afford?'':' disabled')+'>'+lbl+(afford?'':' — can’t afford')+'</button>');
   }
   const bugCost=(S.owner.insider===me)?0:1;
   const bugTargets=(ADJ[nid]||[]).filter(m=>S.owner[m]!=null&&S.owner[m]!==me&&S.bugs[m]==null).length>0;
   btns.push('<button class="act" data-act="bugmode"'+((p.intel>=bugCost&&bugTargets)?'':' disabled')+'>Plant a bug — '+(bugCost===0?'FREE (insider trading graphic)':'1 🛈')+'</button>');
   btns.push('<button class="act" data-act="leakmode"'+(p.intel>=2?'':' disabled')+'>Leak dirt — 2 🛈 (rival +2 🔥)</button>');
   if(S.owner.asic===me)btns.push('<button class="act" data-act="auditmode"'+((p.money>=4&&!S.audited)?'':' disabled')+'>⚖️ Audit — $4 (rival +1 🔥)</button>');
   if(S.owner.press===me)btns.push('<button class="act" data-act="spin" data-kind="press"'+((p.money>=3&&!S.spun)?'':' disabled')+'>🗞️ Spin the press — $3 (−2 🔥 or roast)</button>');
   if(S.owner.fox===me)btns.push('<button class="act" data-act="spin" data-kind="fox"'+((p.money>=2&&!S.spun)?'':' disabled')+'>🦊 Fox spin — $2 (−3 🔥 or roast)</button>');
   if(S.owner.rock===me)btns.push('<button class="act" data-act="cook"'+((p.money>=3&&!S.cooked)?'':' disabled')+'>💪 Cook the books — $3 (−3 🔥)</button>');
   if(S.owner.trump===me)btns.push('<button class="act" data-act="tweetmode"'+(p.money>=2?'':' disabled')+'>🦅 The Tweet — $2 (rival +1 🔥)</button>');
   if(S.owner.gov===me)btns.push('<button class="act" data-act="budget"'+((p.money>=3&&!S.budgeted)?'':' disabled')+'>🦘 Budget night — $3 (rivals each pay you $1, +1 🛈)</button>');
   if(S.owner.back===me)btns.push('<button class="act" data-act="pressure"'+(!S.pressured?'':' disabled')+'>🤝 Lean on the table — rivals each +1 🔥</button>');
   /* ---- 🌍 GEOGRAPHY DLC ---- */
   if(S.dlcGeo&&ownsMissileLauncher(me)&&canFireMissileFrom(me))btns.push('<button class="act" data-act="missilemode"'+((p.money>=4&&p.intel>=1&&!S.geoMissiled)?'':' disabled')+' title="Stand on either launcher to fire (owning Kim Jong Un arms either from anywhere): strike any node — the owner is expropriated with no payout; the node becomes rubble ($4 + 1 Intel, once per turn)">🚀 Launch a missile — $4 + 1 🛈 (expropriate &amp; rubble)</button>');
   if(S.dlcGeo&&S.owner.geo_boeing===me)btns.push('<button class="act" data-act="qantasdown"'+((p.money>=4&&!S.geoBoeing&&S.owner.qantas!==me)?'':' disabled')+' title="QANTAS grounded for two full turns — no jet, no income ($4, once per turn)">🛩️ Shut down Qantas — $4 (grounded two turns)</button>');
   if(S.dlcGeo&&S.owner.geo_scs===me)btns.push('<button class="act" data-act="oilcrash"'+((p.money>=3&&!S.geoCrash)?'':' disabled')+' title="PANIC mood; everyone pays $2 per oil node owned — Pillars exempt ($3, once per turn)">🌊 Trigger an oil crash — $3 (oil pays underwater)</button>');
   if(S.dlcGeo&&S.owner.geo_stage5===me)btns.push('<button class="act" data-act="stage5"'+((p.intel>=2&&!S.geoStage5)?'':' disabled')+' title="The richest player (not you) makes no income on their next turn (2 Intel, once per turn)">📉 Call Stage 5 decline — 2 🛈</button>');
   if(S.dlcGeo&&S.owner.geo_venice===me&&nid==='geo_venice')btns.push('<button class="act" data-act="venicecool"'+(!S.geoVenice?'':' disabled')+' title="Free — once per turn, either this or Overtourism">🚤 Gondola therapy — free −1 🔥</button>');
   if(S.dlcGeo&&S.owner.geo_venice===me){
    const ot=NODES.filter(nn=>S.owner[nn.id]!=null&&S.owner[nn.id]!==me&&!(S.rubble&&S.rubble[nn.id])).length;
    btns.push('<button class="act" data-act="overmode"'+((p.money>=2&&!S.geoVenice&&ot>0)?'':' disabled')+' title="Pick any rival-owned node, including ESG holdings. It remains active for one full table rotation and applies +1 Cortisol when the target takes their turn ($2, once per turn, either/or)">🛳️ Overtourism — $2 (one full turn cycle)</button>');
   }
   if(S.dlcGeo&&S.owner.geo_wonsan===me&&nid==='geo_wonsan')btns.push('<button class="act primary" data-act="beach"'+(!S.geoBeach?'':' disabled')+' title="Free — once per turn">🏖️ Beach day — free −2 🔥</button>');
   if(S.owner.albo===me){const blockadeTargets=NODES.some(nn=>!S.rubble[nn.id]&&!blockaded(nn.id));btns.push('<button class="act" data-act="blockmode"'+(!S.blockadeUsed&&blockadeTargets?'':' disabled')+' title="Free, once per turn: wall off any unblocked, non-rubble node for one full rotation. Blocks walking and Qantas landings; shown by a 🚧 marker on the board.">🚧 Blockade — free (once per turn)</button>');}
   /* ---- INTEL OPS ---- */
   btns.push('<div class="sublabel">INTEL OPS · you hold 🛈 '+p.intel+' · market rate $'+md.rate+'/🛈</div>');
   btns.push('<button class="act" data-act="spy"'+(p.intel>=2?'':' disabled')+' title="Free action — see the next event card, anywhere">🛈 Spy on the deck — 2 🛈 (see next event)</button>');
   btns.push('<button class="act" data-act="dossier"'+((p.intel>=3&&!S.dossier)?'':' disabled')+' title="Free action — hostile takeovers cost list price this turn">📂 The Dossier — 3 🛈 (takeovers at list price)</button>');
   btns.push('<button class="act" data-act="divestmade"'+((p.intel>=5&&p.money>=7&&S.owner.made!=null&&S.owner.made!==me)?'':' disabled')+' title="Pay 5 Intel and $7 compensation to remove MADE from any rival">🟣 Divest MADE — 5 🛈 + $7 compensation</button>');
   btns.push('<button class="act" data-act="sweep"'+(p.intel>=2?'':' disabled')+' title="Your action — remove all bugs on your nodes">🧹 Sweep for bugs — 2 🛈 (cleanse your nodes)</button>');
    btns.push('<button class="act" data-act="masspanic"'+(p.intel>=5?'':' disabled')+' title="Your action — every player gains 2 Cortisol">🔥 Mass panic — 5 🛈 (+2 Cortisol to everyone)</button>');
   btns.push('<button class="act" data-act="targetpanic"'+(p.intel>=30&&S.players.length>1?'':' disabled')+' title="Choose one rival to receive +6 Cortisol; costs 30 Intel">🔥 Overload a rival — 30 🛈 (+6 Cortisol)</button>');
   if(S.owner.bond===me&&S.owner.leak===me){btns.push('<button class="act" data-act="bondmageddon"'+(p.money>=16&&p.intel>=4&&!S.bondmageddonUsed&&S.players.length>1?'':' disabled')+' title="Four missiles against the rival with the most CHART holdings. If they own ESG, three hit ESG and the fourth hits another holding. Costs $16 + 4 Intel; once per turn.">💥 BONDMAGEDDON — 4 missiles ($16 + 4 🛈)</button>');}
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
  const targetable=isTurn&&(S.phase==='action'||(S.phase==='move'&&S.owner.back===me&&!S.backroomAbilityUsed))&&(S.mode==='leak'||S.mode==='audit'||S.mode==='tweet'||S.mode==='roast')&&i!==me;
  const face=charSrc(pl.char);
  return '<div class="prow'+(i===me?' me':'')+(targetable?' targetable':'')+(pl.cortisol>=6?' hot':'')+'" data-rival="'+i+'" style="--pc:'+pl.color+'">'
   +(face?'<img class="pface" src="'+face+'" alt="">':'<span class="pnum">'+(i+1)+'</span><span class="pdot"></span>')
   +'<span class="pname">'+esc(pl.name)+(i===me?' <i style="color:#9ad">(you)</i>':'')+(pl.dc?' 💤':'')+'</span>'
   +'<span class="pstats">$'+pl.money+' · 🛈'+pl.intel+' · 🔥'+pl.cortisol+'</span>'
   +'<span class="pnodes">'+nodes+' node'+(nodes!==1?'s':'')+' · set '+(WIN_TYPES.length-missingTypes(i).length)+'/'+WIN_TYPES.length+'</span></div>';
 }).join('');
 const myMissing=Net.spect?[]:missingTypes(me);
 const setHtml=Net.spect?'<span style="color:#9ad">not playing — just watching</span>':WIN_TYPES.map(t=>{const has=hasType(me,t);return '<span style="color:'+(has?'#7fe08d':'#ff6b5e')+'">'+(has?'✔':'✘')+' '+t+'</span>'}).join('');
 const chatHtml=(S.chat||[]).map(c=>'<div><b style="color:'+c.c+'">'+esc(c.n)+':</b> '+esc(c.t)+'</div>').join('')||'<div style="opacity:.4;font-style:italic">— the wire is quiet —</div>';
 const chatVal=chatDraft;
 side.innerHTML='<div class="netstrip">ROOM <b>'+(Net.roomLabel||Net.roomCode||'·····')+'</b> · '+(Net.role==='host'?'HOST':(Net.spect?'👁 SPECTATOR':'SEAT '+(Net.myIdx+1)))+' · 🎯 TARGET $'+goalAmount()+' · '+(S.players.filter(pl=>!pl.dc).length+'/'+S.players.length+' connected')+(S.deckCount!=null?' · 🎴 '+S.deckCount+' events left':'')+' · ⛽ '+(QUIK_SLOTS[S.quikSlot|0]||QUIK_SLOTS[0]).label+'</div>'
  +'<div class="moodstrip" style="border-color:'+md.color+'"><span class="mdot" style="background:'+md.color+'"></span><b style="color:'+md.color+'">'+md.label+'</b><span>'+md.desc+'</span><span class="mwire">“'+esc(S.wire||'all quiet on the wire')+'”</span></div>'
  +'<div class="brand"><div class="t1">THE BIG CON</div><div class="t2">v1.13 · '+(S.dlcGeo?'81':'70')+' exhibits · randomized board & connections · valuable nodes further away · online, 2–8</div></div>'
  +'<div class="turncard" style="border-color:'+p.color+'"><div class="turnlab">TURN '+S.turn+'</div><div class="turnname" style="color:'+p.color+'">'+esc(p.name)+(isTurn?' — that’s you':'')+'</div>'
  +'<div class="resline">$ '+p.money+' &nbsp;·&nbsp; 🛈 '+p.intel+' &nbsp;·&nbsp; 🔥 '+p.cortisol+(p.cortisol>=6?' <span class="danger">RAID AT 9</span>':'')+'</div>'
  +'<div class="holds" title="holdings of '+esc(p.name)+'">'+(isTurn?ownedIcons:'<span style="opacity:.5;font-size:12px">'+NODES.filter(n=>S.owner[n.id]===S.cur).length+' holdings</span>')+'</div></div>'
  +'<div class="setcard"><span class="st">🎯 WIN SET</span>'+setHtml+'<span style="flex-basis:100%;color:#9ad">'+(Net.spect?'the spectacle is the point':(myMissing.length?'still need: '+myMissing.join(', ')+' · and $'+goalAmount():'full set held — now bank $'+goalAmount()))+'</span></div>'
  +'<div class="phasecard">'+phaseHtml+'</div>'
  +'<div class="paneltitle">THE SYNDICATE — '+S.players.length+' AT THE TABLE</div><div>'+prows+'</div>'
  +'<div class="paneltitle">THE RECORD<span style="float:right;display:inline-flex;gap:6px;margin-top:-4px"><button class="mini" data-act="copyrecord" style="flex:0 0 auto;padding:3px 8px;font-size:10px">COPY</button><button class="mini" data-act="reviewlog" style="flex:0 0 auto;padding:3px 8px;font-size:10px" title="Open this record in the log reviewer">🔬 REVIEW</button></span></div><div class="log" id="logbox">'+(S.over?S.log:S.log.slice(-LOG_SHOWN)).map(l=>'<div>'+l+'</div>').join('')+'</div>'
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
export function sendChat(t){
 if(Net.role==='host'){addChat(Net.myIdx,t)}
 else if(Net.conn&&Net.conn.open){Net.conn.send({t:'chat',text:t})}
}
export function dispatch(m){
 if(!S||S.over)return;
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
 if(!g||!S||S.over)return;
 if(S.cur!==Net.myIdx)return;
 const id=g.dataset.id;
 if(S.phase==='move'){
  if(S.mode==='fly'){dispatch({act:'fly',id});return}
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
svgEl.addEventListener('wheel',e=>{e.preventDefault();zoomAt(e.deltaY>0?1.13:0.885,e.clientX,e.clientY)},{passive:false});
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
 $('zin').onclick=()=>{const r=svgEl.getBoundingClientRect();zoomAt(0.8,r.left+r.width/2,r.top+r.height/2)};
 $('zout').onclick=()=>{const r=svgEl.getBoundingClientRect();zoomAt(1.25,r.left+r.width/2,r.top+r.height/2)};
 $('zreset').onclick=()=>resetBoardView();
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
  if(S.mode&&['leak','audit','tweet','roast'].includes(S.mode)){dispatch({act:S.mode,target:ri});return}
 }
 const b=e.target.closest('button[data-act]');
 if(!b||b.disabled)return;
 const act=b.dataset.act;
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
 if(S.cur!==Net.myIdx||S.over)return;
 switch(act){
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
  case 'sell':dispatch({act:'sell',n:+b.dataset.n});break;
  case 'cancel':dispatch({act:'cancel'});break;
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
