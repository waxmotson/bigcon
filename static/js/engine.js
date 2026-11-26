'use strict';
/* engine: host-side game rules — economy, cortisol/raids, MADE, turn flow, event deck, bot seats, income and intent handling.
 *
 * DOM-free and wire-free: this module (with util, data, boards, state) never touches
 * document / $() / toast() / modal() / render functions / window / global timers.
 * Everything outside the rules is reached through the injected `hooks` interface —
 * see hooks.js for the full list and the `setHooks({...})` call that wires it.
 * Tests import this module directly and supply fake hooks and a virtual clock.
 * Game state stays the module-level object `S` (state.js); replace it with setS().
 */
import { hooks, setHooks } from './hooks.js';
import { S, setS, Net, pubState } from './state.js';
import { clampGoal, esc, shuffle } from './util.js';
import { NODES, NMAP, EDGES, ADJ, GEO_NODE_IDS, OIL_IDS, COUNTRY, MOODS, PCOLORS, QUIK_SLOTS, charMeta, charSrc, rebuildWorld, setEdges, rebuildAdj } from './data.js';
import { generateRandomBoard, generateRingworldBoard, generateMegaRingBoard, generateWorldMapBoard, applyLayoutFromState, worldMapMetrics } from './boards.js';
import { regionOf, REGION_NAMES } from './world.js';
import { WORLD_NODE_IDS, WORLD_START_RUBBLE, WORLD_CHOKEPOINTS, OIL_ALL, worldSynergy, worldStartFx, worldEventPays, WATER_NODES, TAX_HAVENS, TOURISM_NODES, IRON_NODES, SANCTIONED_NODES, COAL_CHAIN, AGRI_NODES, US_NODES, CHINA_NODES, LIBERATORS, TRADE_BLOCS, BLOC_STEP, BLOC_MAX, BLOC_FREE, AUSNZ, PENINSULA } from './world.js';
export { hooks, setHooks };
/* The host services the rules call, bound late so a hook swapped in by setHooks
   (or wrapped by a test) is always the one that runs. */
/* every publish reconciles the regulators' files against ownership first */
const sync=now=>{acccReconcile();hooks.sync(now)},sysTo=(pi,msg)=>hooks.sysTo(pi,msg),askPlayer=async(pi,opt)=>{/* a private prompt can outlast the 30 s action-lock watchdog (a guest has 45 s): the watchdog only releases a lock when no prompt is open */ openPrompts++;try{return await hooks.askPlayer(pi,opt)}finally{openPrompts--}},announceAll=(title,html)=>hooks.announceAll(title,html),revealAll=(title,html)=>hooks.revealAll(title,html);
/* ================= STATE & HELPERS ================= */
let fxSeq=0;
const WORLD_COUNT=WORLD_NODE_IDS.length;
export function pname(i){return S.players[i].name}
export function log(t){S.log.push(t);S.logN=(S.logN|0)+1}
/* ---- floating FX: visible on every screen, driven purely by synced state ---- */
export function fx(x,y,t,c,big){if(Net.role!=='host'||!S)return;S.fx.push({id:++fxSeq,x,y,t,c,b:big?1:0});if(S.fx.length>FX_CAP)S.fx.shift()}
/* the synced fx buffer: room for a full barrage (LIBERATE OIL launches dozens at once) */
export const FX_CAP=90;
export function fxAt(pi,t,c){if(!S||!S.players[pi])return;const n=NMAP[S.players[pi].pos];if(n)fx(n.x,n.y-64,t,c)}
/* 🌍 Projectile fx: missiles and the Qantas jet fly their route as a rotating
   <image>. Entries ride S.fx (synced by pubState) with proj:1 and carry both
   endpoints; the rig rotates toward the target and mirrors when flying left.
   Rendering happens in #fxg so board re-renders never interrupt the flight. */
export const PROJ_DEFS={
 missile:{img:'./static/GeographyDLC/missile_travelling.png',w:116,h:125,base:45},
 fly:{img:'./static/qantas_jet_travelling.png',w:150,h:103,base:10},
 f35:{img:'./static/GlobalEdition/fx/f35_travelling.png',w:160,h:104,base:-33} /* the Lockheed photo, sky keyed out, mirrored nose-right (the nose dips 33 degrees) */
};
/* opts: {delay, dur} in ms, so a barrage can stagger its launches inside one sync (defaults: at once, 1.1s) */
export function projFx(kind,fromId,toId,opts){
 if(Net.role!=='host'||!S)return false;
 const d=PROJ_DEFS[kind],a=NMAP[fromId],b=NMAP[toId];
 if(!d||!a||!b||fromId===toId)return false;
 const e={id:++fxSeq,proj:1,img:d.img,base:d.base,w:d.w,h:d.h,x0:a.x,y0:a.y-40,x1:b.x,y1:b.y-40,x:a.x,y:a.y-40};
 if(opts&&opts.delay)e.dl=Math.round(opts.delay);if(opts&&opts.dur)e.du=Math.round(opts.dur);
 S.fx.push(e);
 if(S.fx.length>FX_CAP)S.fx.shift();
 return true;
}
/* 🌍 The table watches the launch: the host holds the turn open for the flight
   (1.1s SMIL + a beat) so the market-event card never drops while a warhead or
   jet is still in the air. Tests advance the virtual clock past the pause. */
export const PROJ_PAUSE_MS=1300;
export function projPause(ms){return new Promise(res=>hooks.setTimeout(res,ms||PROJ_PAUSE_MS))}
/* Flight direction → SVG rig: nose-align the sprite (base offset), and when the
   shot travels leftwards mirror it first so the artwork never flies tail-first. */
export function projRig(f){
 const dx=f.x1-f.x0,dy=f.y1-f.y0;
 const deg=dx<0?Math.atan2(dy,-dx)*180/Math.PI:Math.atan2(dy,dx)*180/Math.PI;
 const r=(deg+f.base).toFixed(1);
 return dx<0?'scale(-1,1) rotate('+r+')':'rotate('+r+')';
}
export function setMood(k,headline){
 if(!S)return;
 const changed=S.mood!==k;
 S.mood=k;S.wire=headline;
 if(changed){log('🌡️ THE MOOD SHIFTS — '+MOODS[k].label+' ('+MOODS[k].desc+').');fx(1200,720,MOODS[k].label.split(': ')[1]||k,MOODS[k].color,true)}
}
export function giveIntel(i,n,why){if(!S||!S.players[i]||n<=0)return;S.players[i].intel+=n;log('🛈 '+pname(i)+' +'+n+' Intel'+(why?' — '+why:'')+'.');fxAt(i,'🛈+'+n,'#55c1ff')}
export function gain(i,amt,why){S.players[i].money+=amt;log('💰 '+pname(i)+' gains $'+amt+(why?' — '+why:'')+'.');fxAt(i,'+$'+amt,'#7fe08d')}
export function payVoid(i,amt,why){const p=S.players[i];const real=Math.min(p.money,amt);p.money-=real;log('💸 '+pname(i)+' loses $'+real+' — '+why+'.');fxAt(i,'−$'+real,'#ff6b5e')}
export function payTo(i,amt,to,why){const p=S.players[i];const real=Math.min(p.money,amt);p.money-=real;S.players[to].money+=real;log('💸 '+pname(i)+' pays $'+real+' to '+pname(to)+' — '+why+'.');fxAt(i,'−$'+real,'#ff6b5e');fxAt(to,'+$'+real,'#7fe08d')}
export function payFee(i,amt,why){const p=S.players[i];const real=Math.min(p.money,amt);p.money-=real;log('💸 '+pname(i)+' pays $'+real+' — '+why+'.');fxAt(i,'−$'+real,'#ff6b5e')}
export function addCortisol(i,n,why,ev,force){
 if(!n)return;
 if(n>0&&!force&&NODES.filter(node=>S.owner[node.id]===i).length<=1)return;
 if(ev&&n>0&&(S.owner.bess===i||S.owner.jim===i)){n-=1;if(n<=0){log('📺 Big Bessent / The Jim buries the story — '+pname(i)+' takes no Cortisol at all.');return}log('📺 Breaking news softens the story — '+pname(i)+' takes only +'+n+' Cortisol.')}
 if(ev&&n>0){const h=S.owner.herald;if(h!=null&&h!==i)giveIntel(h,1,'THE JIM REAPER files the cortisol')}
 const p=S.players[i];p.cortisol=Math.max(0,Math.min(9,p.cortisol+n));
 log('🔥 '+pname(i)+(n>0?' +'+n:' '+n)+' Cortisol (now '+p.cortisol+')'+(why?' — '+why:'')+'.');
 fxAt(i,(n>0?'🔥+'+n:'🔥'+n),'#ffa94d');
 if(p.cortisol>=9)raid(i);
}
/* The raid is the one thing on this board that can end a run: two assets seized,
   the books fined, the intel network burned and a wasted turn under caution. */
export function raid(i){
 const p=S.players[i];
 if(rocketEscape(i))return;
 const bahtOwner=S.owner.w_baht,baht=S.dlcWorld&&bahtOwner!=null&&NMAP[p.pos]?regionOf(NMAP[p.pos]):null; /* 🌐 THE BAHT 1997: the region the raided pawn stands in */
 const owned=NODES.filter(n=>S.owner[n.id]===i).sort((a,b)=>b.income-a.income||b.cost-a.cost);
 const seized=owned.slice(0,2);
 seized.forEach(n=>{delete S.owner[n.id];delete S.bugs[n.id];fx(n.x,n.y-70,'🚨 SEIZED','#ff6b5e')});
 if(seized.length)log('🚨 REGULATOR RAID! '+pname(i)+' is stripped of '+seized.map(n=>n.name.join(' ')).join(' and ')+' — cameras everywhere.');
 else log('🚨 REGULATOR RAID! '+pname(i)+' owns nothing worth seizing — the regulators take it out of the accounts instead.');
 Object.keys(S.bugs).forEach(id=>{if(S.bugs[id]===i)delete S.bugs[id]});
 const fine=Math.min(p.money,Math.max(5,Math.floor(p.money*0.3)));
 payVoid(i,fine,'the enforcement penalty');
 if(p.intel>1){const lost=p.intel-1;p.intel=1;log('🛈 '+pname(i)+' loses '+lost+' Intel — every contact stops answering.');fxAt(i,'🛈−'+lost,'#55c1ff')}
 p.raided=1;
 p.cortisol=0;log('🚨 '+pname(i)+' is under caution: Cortisol resets to 0, and next turn brings no income and a single step.');
 fxAt(i,'🚨 RAIDED','#ff6b5e',true);
 S.players.forEach((pl,j)=>{if(S.owner.hedge===j)gain(j,3,'somebody was short the whole time');if(S.owner.group===j)giveIntel(j,1,'the group photo pays')});
 announceAll('🚨 REGULATOR RAID',
  '<div class="eventcard"><div class="eicon">🚨</div><div class="etitle">'+esc(p.name)+' IS RAIDED</div>'
  +'<div class="etext">Cameras on the driveway. Boxes out the front door.</div></div>'
  +'<ul><li>'+(seized.length?'Seized: <b>'+seized.map(n=>esc(n.name.join(' '))).join('</b> and <b>')+'</b>':'Nothing worth seizing — the accounts took it instead')+'</li>'
  +'<li>Fine of <b>$'+fine+'</b>, Intel burned down to 1, every planted bug pulled</li>'
  +'<li>Cortisol resets to <b>0</b>; next turn brings no income and a single step</li></ul>');
 if(baht!=null)bahtContagion(i,baht,bahtOwner);
}

/* ACCC concentration — a public file the table can see coming, not a dice roll.
   A book is concentrated once a player holds the industry's trigger count: 3 in the
   themed id-list industries, max(3, ceil(size/3)) in the five type-based ones, sized
   on the live board (the Geography DLC grows them). Charts and WILD nodes count only
   where a themed list names them. While a book is concentrated a file is open on that
   (player, industry): +1 scrutiny at each of the offender's turn starts, a ruling at
   ACCC_RULING, and it closes the moment the book drops back to the allowed count —
   reconciled against ownership on every sync, so no mutation has to remember it. */
export const ACCC_RULING=3;
export const INDUSTRIES=[
 {id:'bank',name:'BANKING',pick:n=>n.type==='BANK'},
 {id:'regulator',name:'REGULATORS',pick:n=>n.type==='REGULATOR'},
 {id:'corporate',name:'CORPORATES',pick:n=>n.type==='CORPORATE'},
 {id:'coal',name:'COAL',ids:['coal','train','port','bhp','watson']},
 {id:'commodity',name:'COMMODITIES',pick:n=>n.type==='COMMODITY'},
 {id:'media',name:'MEDIA',pick:n=>n.type==='MEDIA'},
 {id:'oil',name:'OIL',ids:['oil','oilgraph','barrels','tanker','petronas']},
 {id:'education',name:'EDUCATION',ids:['school','ib','mpc']},
 {id:'jtportal',name:'JTPORTAL',ids:['jt','press','iface']},
 {id:'chalmers',name:'JIM CHALMERS',ids:['chalmers','jim','herald']},
 {id:'bessent',name:'BIG BESSENT',ids:['bessent','bess','bond']},
 {id:'monetary',name:'MONETARY POLICY',ids:['mpc','rba','cash','bullock','infl']}
];
export const INDBYID={};INDUSTRIES.forEach(g=>INDBYID[g.id]=g);
/* 🌐 TRADE BLOCS: a WTO "book" per bloc node (THE EU SINGLE MARKET, BRICS). Not in INDUSTRIES (the twelve classic books are unchanged): the bloc books are
   only tracked while the Global Edition is on, and only for the seat that OWNS the bloc node. They reuse the whole file machinery: scrutiny, lobby,
   market sale, referral (by the WTO owner) and the proportional ruling. */
export const BLOC_BOOKS=Object.keys(TRADE_BLOCS).filter(bid=>!TRADE_BLOCS[bid].noWto).map(bid=>({id:'bloc_'+TRADE_BLOCS[bid].short.toLowerCase(),name:TRADE_BLOCS[bid].book,bloc:bid,ids:TRADE_BLOCS[bid].members}));
BLOC_BOOKS.forEach(g=>{INDBYID[g.id]=g});
export function industryNodes(g){
 if(g.ids)return g.ids.map(id=>NMAP[id]).filter(Boolean);
 return NODES.filter(g.pick);
}
export function industryTrigger(g){return g.bloc?BLOC_FREE+1:g.ids?3:Math.max(3,Math.ceil(industryNodes(g).length/3))}
export function industryAllowed(g){return industryTrigger(g)-1}
export function ownedInIndustry(pi,g){return industryNodes(g).filter(n=>S.owner[n.id]===pi)}
/* Mark Watson exempts the holder's COAL book only. */
/* UBS (a rebuilt Credit Suisse) is too big to fail: it exempts its holder's BANKING (ACCC) book. */
export function acccExempt(pi,ind){
 if(!S)return false;
 if(ind==='coal'&&S.owner.watson===pi)return true;
 return !!(S.dlcWorld&&ind==='bank'&&S.owner.w_cs===pi&&S.rebuilt&&S.rebuilt.w_cs&&!(S.rubble&&S.rubble.w_cs));
}
export function concentratedIndustries(pi){
 const books=INDUSTRIES.concat(S&&S.dlcWorld?BLOC_BOOKS.filter(g=>S.owner[g.bloc]===pi):[]);
 return books.map(g=>{const owned=ownedInIndustry(pi,g);return {g,owned,n:owned.length,trigger:industryTrigger(g)}}).filter(x=>x.n>=x.trigger&&!acccExempt(pi,x.g.id));
}
/* MONETARY POLICY books are market manipulation — ASIC's file, not the ACCC's. */
export function fileAgency(ind){return ind==='monetary'?'ASIC':(INDBYID[ind]&&INDBYID[ind].bloc?'WTO':'ACCC')}
/* the node whose owner may REFER a file: the ASIC, the WTO or the ACCC */
export function fileAuthority(f){return f.agency==='ASIC'?'asic':f.agency==='WTO'?'w_wto':'accc'}
export function acccFileList(){if(!S)return [];if(!Array.isArray(S.acccFiles))S.acccFiles=[];return S.acccFiles}
export function findFile(pi,ind){return acccFileList().find(f=>f.pi===pi&&f.ind===ind)||null}
export function filesOf(pi){return acccFileList().filter(f=>f.pi===pi)}
/* the open file (if any) whose book contains this node */
export function fileForNode(pi,nid){return filesOf(pi).find(f=>INDBYID[f.ind]&&industryNodes(INDBYID[f.ind]).some(n=>n.id===nid))||null}
const fileIcon=f=>f.agency==='ASIC'?'⚖️':f.agency==='WTO'?'🌐':'🧐';
const fileName=f=>'the '+f.agency+' file on '+pname(f.pi)+'’s '+INDBYID[f.ind].name+' book';
export function acccReconcile(){
 if(!S||!Array.isArray(S.players)||!S.owner||S.over)return;
 const files=acccFileList();
 for(let k=files.length-1;k>=0;k--){
  const f=files[k];
  if(S.players[f.pi]&&INDBYID[f.ind]&&((f.breach&&!acccExempt(f.pi,f.ind))||concentratedIndustries(f.pi).some(x=>x.g.id===f.ind)))continue;
  files.splice(k,1);
  if(S.players[f.pi]&&INDBYID[f.ind]){log(fileIcon(f)+' CASE CLOSED — '+fileName(f)+' is closed: the book is back to '+industryAllowed(INDBYID[f.ind])+' or fewer. Scrutiny discarded.');fxAt(f.pi,'📁 FILE CLOSED','#8fbf7f')}
 }
 S.players.forEach((_,pi)=>concentratedIndustries(pi).forEach(x=>{
  if(findFile(pi,x.g.id))return;
  const f={pi,ind:x.g.id,s:0,agency:fileAgency(x.g.id)};files.push(f);
  log(fileIcon(f)+' THE '+f.agency+' OPENS A FILE on '+pname(pi)+'’s '+x.g.name+' book — '+x.n+' held, '+(x.trigger-1)+' allowed. Scrutiny 0/'+ACCC_RULING+': +1 at each of their turn starts, ruling at '+ACCC_RULING+'.');
  fxAt(pi,'📁 '+f.agency+' FILE','#55c1ff');
 }));
}
/* Turn start: every open file of the offender gains +1 scrutiny; returns the
   industries whose file has reached the ruling. */
/* scrutiny added to a file at its offender's turn start: +1, but a TRADE-BLOC file gains +1 per member held beyond BLOC_FREE */
export function fileStep(f){const g=INDBYID[f.ind];return g&&g.bloc?Math.max(1,ownedInIndustry(f.pi,g).length-BLOC_FREE):1}
export function acccAdvance(pi){
 if(!S||S.over)return [];
 acccReconcile();
 const due=[];
 filesOf(pi).forEach(f=>{const st=fileStep(f);f.s+=st;log(fileIcon(f)+' '+fileName(f)+' advances'+(st>1?' by '+st+' (each member beyond '+BLOC_FREE+' adds one)':'')+' — scrutiny '+f.s+'/'+ACCC_RULING+(f.s>=ACCC_RULING?'. The ruling is in.':'.'));if(f.s>=ACCC_RULING)due.push(f.ind)});
 return due;
}
export async function acccRuleAll(pi,due){
 for(const ind of due){if(!S||S.over)return;acccReconcile();if(findFile(pi,ind))await acccRule(pi,ind)}
}
export async function acccReview(pi){return acccRuleAll(pi,acccAdvance(pi))}
/* The ruling is proportional: the offender keeps the allowed count (their choice;
   away seats and the default keep the highest income, ties by cost), only the excess
   is divested back to the market unowned — never gifted — and the fine is 10% of cash
   and of Intel per divested node, capped at 30% each. */
export async function acccRule(pi,ind){
 const g=INDBYID[ind],f=findFile(pi,ind);
 if(!S||!g||!f||!S.players[pi])return;
 const p=S.players[pi],agency=f.agency,isAsic=agency==='ASIC',allowed=industryAllowed(g);
 const held=ownedInIndustry(pi,g),excess=held.length-allowed;
 if(excess<=0){if(f.breach&&!acccExempt(pi,ind)){breachRuling(pi,f);return}acccReconcile();return}
 const keepOrder=(a,b)=>b.income-a.income||b.cost-a.cost;
 const chosen=[];
 for(let k=0;k<excess;k++){
  const pool=held.filter(n=>chosen.indexOf(n)<0).sort(keepOrder);
  const def=pool[pool.length-1];
  const v=await askPlayer(pi,{title:agency+' RULING — DIVEST '+(k+1)+' OF '+excess,body:'The '+agency+' rules on your '+g.name+' book: you may keep '+allowed+' of '+held.length+'. Choose a node to give up — it returns to the market unowned. The fine is '+Math.min(30,10*excess)+'% of your cash and Intel.',options:pool.map(n=>({label:'Divest '+n.name.join(' ')+' · $'+n.income+'/turn · list $'+n.cost,v:n.id})),def:def.id,timeout:30000,meta:{kind:'ruling',ind,excess,keep:allowed}});
  if(!S||S.over)return;
  chosen.push(pool.find(n=>n.id===v)||def);
 }
 const divested=chosen.filter(n=>S.owner[n.id]===pi);
 divested.forEach(n=>{delete S.owner[n.id];delete S.bugs[n.id];fx(n.x,n.y-70,'🧐 DIVESTED','#55c1ff')});
 if(divested.some(n=>n.id==='sisy'))S.sisyPayout=10;
 const pct=Math.min(30,10*divested.length);
 const moneyFine=Math.floor(p.money*pct/100),intelFine=Math.floor(p.intel*pct/100);
 if(moneyFine>0)payVoid(pi,moneyFine,isAsic?'ASIC market-manipulation fine ('+pct+'%)':agency==='WTO'?'WTO trade-bloc fine ('+pct+'%)':'ACCC monopoly fine ('+pct+'%)');
 if(intelFine>0){p.intel-=intelFine;fxAt(pi,'🛈−'+intelFine,'#55c1ff');log('🛈 '+pname(pi)+' pays an '+agency+' fine of '+intelFine+' Intel ('+pct+'%).')}
 const files=acccFileList(),at=files.indexOf(f);if(at>=0)files.splice(at,1);
 const names=divested.map(n=>n.name.join(' '));
 const kept=ownedInIndustry(pi,g).map(n=>n.name.join(' '));
 log((isAsic?'⚖️ MARKET MANIPULATION! ':agency==='WTO'?'🌐 TRADE-BLOC RULING! ':'🧐 MONOPOLY ALERT! ')+pname(pi)+'’s '+g.name+' book is ruled on: '+names.join(', ')+' divested and returned to the market'+(kept.length?'; kept: '+kept.join(', '):'')+'. Fine: $'+moneyFine+' and '+intelFine+' Intel ('+pct+'%). The file is closed.');
 fxAt(pi,isAsic?'MARKET MANIPULATION':agency==='WTO'?'TRADE-BLOC RULING':'MONOPOLY ALERT','#55c1ff',true);
 announceAll(isAsic?'ASIC MARKET MANIPULATION':agency==='WTO'?'WTO TRADE-BLOC RULING':'MONOPOLY ALERT',
  (agency==='WTO'?blocRulingFace(esc(p.name)+' held '+held.length+' '+esc(g.name)+' member nodes — the limit is '+allowed+'.'):monopolyAlertFace(esc(p.name)+' held '+held.length+' '+esc(g.name)+' properties — the limit is '+allowed+'.',isAsic))
  +'<p>The '+agency+' file reached '+ACCC_RULING+' scrutiny. Divested back to the market, unowned: <b>'+names.map(esc).join('</b>, <b>')+'</b>.'+(kept.length?' Kept: '+kept.map(esc).join(', ')+'.':'')+'</p>'
  +'<p>Fine: <b>$'+moneyFine+'</b> and <b>'+intelFine+' Intel</b> ('+pct+'% of current balances — 10% per divested node, capped at 30%).</p>');
 acccReconcile();
 sync();
}
/* MADE rolls on every seat's turn, so a flat chance skims big tables far harder: at
   33%, 8 seats saw 2.7 payouts a round and no seat could hold a high goal. Every
   table now gets 2/3 of a payout a round, which leaves 2 seats at the old 33%. */
export function madeChance(){return (2/3)/S.players.length}
/* MADE moves money off the rest of the table, not out of thin air. */
export function madePay(){
 const m=S.owner.made;
 if(m==null)return;
 gain(m,10,'MADE pays out — nobody knows why');
 giveIntel(m,1,'the purple graphic tells you something');
 S.players.forEach((pl,j)=>{
  if(j===m)return;
  const nodes=NODES.filter(n=>S.owner[n.id]===j).length;
  if(nodes<=2||pl.money<50)return;
  const cut=Math.floor(pl.money*0.15);
  if(cut>0)payVoid(j,cut,'MADE takes 15% from eligible players');
 });
}

/* ================= GAME FLOW (host) ================= */
export function initGame(defs){
 Net.gameEpoch=(Net.gameEpoch||0)+1;
 const boardLayout=Net.boardLayout||(Net.ringworld?'ringworld':'random');
 /* the GLOBAL EDITION map layout ('worldmap') is the whole world: it forces the global exhibits on */
 const world=!!Net.dlcWorld||boardLayout==='worldmap';
 rebuildWorld(!!Net.dlcGeo,world);
 const quikSlot=(boardLayout==='ringworld'||boardLayout==='megaring'||boardLayout==='worldmap')?0:Math.floor(Math.random()*QUIK_SLOTS.length);
 const order=defs.map((_,i)=>i);
 for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const t=order[i];order[i]=order[j];order[j]=t}
 const seated=order.map(i=>defs[i]);
 if(Net.conns&&Net.conns.length){
  const hostWas=0;
  Net.conns=order.map(i=>Net.conns[i]||null);
  Net.roster=order.map(i=>Net.roster[i]).filter(Boolean);
  Net.myIdx=order.indexOf(hostWas);
 }
 const goal=clampGoal(Net.goal);
 setS({backroomAbilityUsed:false,players:seated.map((d,i)=>({name:d.name,color:(charMeta(d.char)||{}).color||PCOLORS[i%PCOLORS.length],char:d.char||null,money:15,intel:2,cortisol:0,raided:0,pos:'quik',visited:{quik:true},dc:false,bot:!!d.bot})),cur:0,turn:1,phase:'move',steps:3,goal,owner:{},bugs:{},seizeCount:{},sisyPayout:10,deck:shuffle(CARDS.map(c=>c.id).concat(world?WORLD_CARDS.map(c=>c.id):[])),discard:[],spun:false,audited:false,cooked:false,budgeted:false,extraStep:false,slipped:false,caution:false,dossier:false,jtUsed:false,spinKind:'press',mood:'CALM',wire:'all quiet on the wire… for now',fx:[],over:false,mode:null,log:[],chat:(Net.lobbyChat||[]).slice(-25),logN:0,chatN:0,quikSlot,boardLayout:null,boardEdges:null,layoutKind:boardLayout,ringworld:boardLayout==='ringworld',dlcGeo:!!Net.dlcGeo,dlcWorld:world,fogOfWar:!!Net.fogOfWar,rubble:{},ov:null,geoMissiled:false,geoBeach:false,geoBoeing:false,geoCrash:false,geoStage5:false,geoVenice:false,bondmageddonUsed:false,blockades:{},blockadeUsed:false,missileProbe:null,qantasGroundUntil:0,decline:null,acccFiles:[],cw:{},suspend:{},tariffWarUntil:0,lobbied:false,referred:false});
 const slot=QUIK_SLOTS[quikSlot];
 {const bots=hooks.bots();if(bots&&bots.resetForGame)bots.resetForGame((hooks.botSeed()|0)||((Math.random()*0x7fffffff)|0))}
 const generated=boardLayout==='worldmap'?generateWorldMapBoard():boardLayout==='megaring'?generateMegaRingBoard():(boardLayout==='ringworld'?generateRingworldBoard():generateRandomBoard(slot));S.boardLayout=generated.positions;S.boardEdges=generated.edges;
 applyLayoutFromState();
 /* 🌐 the World Expansion's casualties open the game as rubble: rebuild one to bring it back */
 if(S.dlcWorld)WORLD_START_RUBBLE.forEach(id=>{if(NMAP[id])S.rubble[id]=1});
 Net.started=true;
 log('🌅 A new board is dealt — '+NODES.length+' exhibits, '+EDGES.length+' freshly rebuilt connections, '+S.players.length+' at the table.');
 if(boardLayout==='ringworld')log('⭕ RINGWORLD — every exhibit is arranged around central Quikstop in three concentric rings.');
 else if(boardLayout==='megaring')log('⭕ MEGA RING — every exhibit sits on one large ring, connected to the central Quikstop hub.');
 else if(boardLayout==='worldmap')log('🌍 THE BIG CON: GLOBAL EDITION — every exhibit is pinned where it lives; Quikstop opens in Australia.');
 else log('🧭 High-value targets are seeded further from Quikstop; the board and routes are reshuffled every game.');
 if(S.dlcWorld)log('🌐 GLOBAL EDITION — '+WORLD_COUNT+' global exhibits join the board: central banks, chokepoints, mines, wealth funds and one Nigerian prince.');
 if(S.dlcWorld)log('💥 '+WORLD_START_RUBBLE.map(id=>nodeName(NMAP[id]).join(' ')).join(', ')+' open the game as RUBBLE — arrive and pay the list price to rebuild them.');
 if(S.dlcGeo)log('🌍 GEOGRAPHY DLC — 12 extra exhibits are on the board: missiles, resorts, disputed waters, ESG pillars, the hermit kingdom and one free country.');
 log('🎲 Seating was shuffled. First to move: '+S.players[0].name+'.');
 log('⛽ Quikstop opened '+slot.label+' this game. Everyone starts there with $15 and 2 Intel.');
 log('🏆 WIN CONDITION: $'+goal+' in the bank AND one of every node type ('+WIN_TYPES.join(', ')+'). The host set the target.');
 hooks.showGame();
 hooks.beginGame(pubState(true));
 startTurn();
}
export async function startTurn(){
 if(S)S.backroomAbilityUsed=false;
 if(!S||S.over)return;
 log('—— TURN '+S.turn+' · '+pname(S.cur)+' ——');
 S.phase='move';S.mode=null;S.spun=false;S.audited=false;S.cooked=false;S.budgeted=false;S.pressured=false;S.extraStep=false;S.slipped=false;S.dossier=false;S.blockadeUsed=false;S.lobbied=false;S.referred=false;S.classifiedUsed=false;S.nTurn={};S.tollFree=null;
 if(S.dlcGeo){S.geoMissiled=false;S.geoBeach=false;S.geoBoeing=false;S.geoCrash=false;S.geoStage5=false;S.geoVenice=false}
 if(S.dlcWorld){
  S.wTurn={};
  /* 🌐 THE BERMUDA TRIANGLE: the vanished seat reappears where it said it would */
  const vd=S.vanished&&S.vanished[S.cur];
  if(vd!=null){
   delete S.vanished[S.cur];
   if(NMAP[vd]){const vp=S.players[S.cur];vp.pos=vd;if(vp.visited)vp.visited[vd]=true;fxAt(S.cur,'🌀 REAPPEARS','#9ad7ff');log('🌀 '+pname(S.cur)+' reappears out of the Bermuda Triangle at '+nodeName(NMAP[vd]).join(' ')+'.')}
  }
 }
 S.bondmageddonUsed=false;
 if(S.fx.length>30)S.fx=S.fx.slice(-30);
 /* Expired blockades come down the moment the rotation that blocked them is done. */
 if(S.blockades)Object.keys(S.blockades).forEach(id=>{if(S.blockades[id]<=S.turn)delete S.blockades[id]});
 const p=S.players[S.cur];const own=id=>S.owner[id]===S.cur;
 /* 🌍 MISSILE PROBE — striking a REGULATOR opens an investigation that lands on
    the striker's next turn. It resolves BEFORE the caution flag is read, so an
    indictment's raid puts this turn under caution instead of being wiped by the
    `p.raided=0` reset below. Either outcome stresses the striker: +1 Cortisol. */
 if(S.dlcGeo&&S.missileProbe&&S.missileProbe.by===S.cur){
  S.missileProbe=null;
  const agency=Math.random()<0.5?'ASIC':'ACCC';
  const indicted=Math.random()<0.5;
  if(indicted){
   log('🔎 '+agency+' closes the investigation opened after '+pname(S.cur)+'’s missile launch — INDICTED. The regulators move in.');
   raid(S.cur);
  }else{
   log('🔎 '+agency+' closes the investigation opened after '+pname(S.cur)+'’s missile launch — cleared, but the strain still costs.');
  }
  p.cortisol=Math.min(9,p.cortisol+1);fxAt(S.cur,'🔥+1','#ffa94d');
  if(p.cortisol>=9&&!p.raided)raid(S.cur);
 }
 const underCaution=!!p.raided;S.caution=underCaution;
 /* 🌍 STAGE 5 DECLINE: the pending "no income" call lands on this player's next turn. */
 const wasDeclined=S.decline===S.cur;
 if(S.dlcGeo&&S.decline===S.cur)S.decline=null;
 if(underCaution)log('🚨 '+pname(S.cur)+' spends the turn with the regulators — no income and one step only.');
 else if(wasDeclined){log('📉 STAGE 5 DECLINE — '+pname(S.cur)+' makes no income this turn: salary, nodes, synergies, all of it.');fxAt(S.cur,'📉 NO INCOME','#ff6b5e')}
 else income(S.cur);
 if(own('rba')&&p.cortisol>0){p.cortisol--;fxAt(S.cur,'🔥−1','#8fbf7f');log('🏛️ Inside the Reserve Bank: −1 Cortisol (now '+p.cortisol+').')}
 if(own('sat')&&p.cortisol>0){p.cortisol--;fxAt(S.cur,'🔥−1','#8fbf7f');log('🛰️ Hiding out in the dry country: −1 Cortisol (now '+p.cortisol+').')}
  if(own('gold')&&p.cortisol>0){const relief=Math.min(2,p.cortisol);p.cortisol-=relief;fxAt(S.cur,'🔥−'+relief,'#8fbf7f');log('🪙 Gold-coloured coins somehow soothe the nerves: −'+relief+' Cortisol (now '+p.cortisol+').')}
 if(S.dlcWorld)worldStartFx(NODES.filter(n=>S.owner[n.id]===S.cur),own).forEach(f=>{
  if(f.c<0&&p.cortisol>0){const r=Math.min(-f.c,p.cortisol);p.cortisol-=r;fxAt(S.cur,'🔥−'+r,'#8fbf7f');log('🌐 '+f.name+': −'+r+' Cortisol (now '+p.cortisol+').')}
  else if(f.c>0)addCortisol(S.cur,f.c,f.name+' weighs on you');
  if(f.s)giveIntel(S.cur,f.s,f.name);
 });
 /* 🌐 ANTARCTIC PENINSULA: hold two of the three overlapping claims and the owner of the third takes +1 Cortisol (the sovereignty dispute) */
 /* 🗽 ZOHRAN MAMDANI — TAX THE RICH: the richest rival (if richer than you) pays you $2 at the start of your turn */
 if(S.dlcWorld&&S.owner.w_mamdani===S.cur&&!S.rubble.w_mamdani&&!suspended('w_mamdani')){let r=-1;S.players.forEach((pl,j)=>{if(j!==S.cur&&!isVanished(j)&&pl.money>p.money&&(r<0||pl.money>S.players[r].money))r=j});if(r>=0){const amt=Math.min(2,S.players[r].money);S.players[r].money-=amt;p.money+=amt;fxAt(r,'−$'+amt,'#ff6b5e');fxAt(S.cur,'+$'+amt,'#7fe08d');log('🗽 TAX THE RICH — '+pname(r)+' is the richest at the table and pays $'+amt+' to '+pname(S.cur)+' (ZOHRAN MAMDANI).')}}
 /* 🐧 THE ANTARCTIC TREATY: its owner's claims are settled, but every other seat still holding Antarctic territory is in breach: +1 Cortisol a turn */
 if(treatyInForce()&&S.owner.w_antarctica!==S.cur){const held=TRADE_BLOCS.w_antarctica.members.filter(id=>S.owner[id]===S.cur&&!S.rubble[id]);if(held.length){log('🐧 THE ANTARCTIC TREATY: '+pname(S.owner.w_antarctica)+' holds the Treaty, and '+pname(S.cur)+'’s claim on '+held.map(id=>lname(NMAP[id])).join(', ')+' is not recognised.');addCortisol(S.cur,1,'an Antarctic claim the Treaty does not recognise',false,true)}}
 if(S.dlcWorld&&!treatyInForce()){const held=PENINSULA.filter(id=>S.owner[id]===S.cur);if(held.length===2){const third=PENINSULA.find(id=>!held.includes(id)),o=S.owner[third];if(o!=null&&o!==S.cur&&S.players[o]&&!S.rubble[third]&&!isVanished(o)){log('🇦🇶 SOVEREIGNTY DISPUTE: '+pname(S.cur)+' files against '+pname(o)+'’s claim on '+lname(NMAP[third])+'.');addCortisol(o,1,'a sovereignty dispute over the Peninsula',false,true)}}}
 /* 🌐 CRUISE EMISSIONS: +1 Cortisol each turn unless the owner also holds a REGULATOR */
 if(S.dlcWorld&&own('w_cruise')&&!S.rubble.w_cruise&&!NODES.some(n=>n.type==='REGULATOR'&&S.owner[n.id]===S.cur))addCortisol(S.cur,1,'the cruise ship’s emissions');
 /* 🌐 THE IMF: a bailout comes due at the start of the borrower's next-but-one turn */
 if(S.dlcWorld&&S.imf&&S.imf[S.cur]){
  const ln=S.imf[S.cur];
  if(--ln.left<=0){
   delete S.imf[S.cur];
   if(p.money>=IMF_REPAY){p.money-=IMF_REPAY;if(S.players[ln.by])S.players[ln.by].money+=IMF_REPAY;fxAt(S.cur,'−$'+IMF_REPAY,'#ff6b5e');if(S.players[ln.by])fxAt(ln.by,'+$'+IMF_REPAY,'#7fe08d');log('🆘 The IMF bailout comes due: '+pname(S.cur)+' repays $'+IMF_REPAY+' to '+pname(ln.by)+' on the $'+IMF_LOAN+' lent.')}
   else{log('🆘 The IMF bailout comes due and '+pname(S.cur)+' cannot repay the $'+IMF_REPAY+' — austerity it is. The loan is written off.');addCortisol(S.cur,IMF_CORTISOL,'IMF austerity',false,true)}
  }
 }
 /* 🌐 THE DOHA ROUND: while it runs, its starter collects $2 per COMMODITY node at each turn start, for three turns */
 if(S.dlcWorld&&S.doha&&S.doha.by===S.cur&&S.doha.left>0){
  const d=S.doha;d.left--;
  if(own('w_doha')){const c=NODES.filter(n=>n.type==='COMMODITY'&&S.owner[n.id]===S.cur).length;if(c)gain(S.cur,DOHA_PER*c,'the Doha round delivers ('+c+' commodity node'+(c>1?'s':'')+')');else log('🕰️ The Doha round meets — and you own no commodities. Nothing is agreed.')}
  else log('🕰️ The Doha round meets without its host. Nothing is agreed.');
  if(d.left<=0){log('🕰️ The Doha round STALLS. As ever. The communiqué says “progress”.');fxAt(S.cur,'🕰️ STALLED','#9ad7ff')}
 }
 /* 🧱 THE TARIFF WALL: the import duty on a rival's walled-type holdings */
 if(S.dlcWorld){const duty=tariffDuty(S.cur),to=tariffOwner();
  if(duty&&to!=null){const p=S.players[S.cur],paid=Math.min(duty,Math.max(0,p.money));
   if(paid){p.money-=paid;S.players[to].money+=paid;fxAt(S.cur,'🧱 −$'+paid,'#ff6b5e');fxAt(to,'🧱 +$'+paid,'#7fe08d');
    log('🧱 IMPORT DUTY: '+pname(S.cur)+' pays $'+paid+' to '+pname(to)+' on their '+S.tariffType+' holdings behind THE TARIFF WALL.')}}}
 /* 🌐 BANK OF JAPAN (Mrs Watanabe's carry trade): the carry trade comes due */
 if(S.dlcWorld&&S.carry&&S.carry[S.cur]){
  const loan=S.carry[S.cur]>1?S.carry[S.cur]:CARRY_LOAN,due=carryDue(loan);
  delete S.carry[S.cur];
  const paid=Math.min(Math.max(0,p.money),due),short=due-paid;
  if(paid){p.money-=paid;fxAt(S.cur,'−$'+paid,'#ff6b5e')}
  if(!short)log('👛 The carry trade unwinds: '+pname(S.cur)+' repays $'+due+' on the $'+loan+' borrowed from Tokyo.');
  else{const c=carryPenalty(short);log('👛 The carry trade unwinds and '+pname(S.cur)+' repays only $'+paid+' of the $'+due+' — Tokyo collects the missing $'+short+' as '+c+' Cortisol (1 for every $2).');addCortisol(S.cur,c,'the carry trade is called in',false,true)}
 }
 if(S.dlcGeo&&own('geo_pillars')&&p.cortisol>0){p.cortisol--;fxAt(S.cur,'🔥−1','#8fbf7f');log('🧱 ESG SHIELD — the Pillars absorb 1 Cortisol (now '+p.cortisol+').')}
 if(S.dlcGeo&&S.ov){
  const ov=S.ov,turnIndex=S.turn*S.players.length+S.cur;
  if(S.owner.geo_venice!==ov.by||S.owner[ov.nid]!==ov.targetOwner||S.rubble[ov.nid]||turnIndex>=ov.expiresAt)S.ov=null;
  else if(ov.targetOwner===S.cur)addCortisol(S.cur,1,'overtourism — the Venice cruise ships keep coming');
 }
 if(own('whistle'))giveIntel(S.cur,1,'the dossier grows');
 if(own('bullock'))giveIntel(S.cur,1,'the Governor briefs you');
 if(own('jt'))giveIntel(S.cur,1,'JTPortal knows things');
 const jtHolder=own('jt');
 if(own('mpc'))giveIntel(S.cur,1,'the Competition feeds you data');
 if(S.dlcGeo&&own('geo_kim'))giveIntel(S.cur,1,'the Supreme Leader briefs you');
 const charts=NODES.filter(n=>n.type==='CHART'&&S.owner[n.id]===S.cur).length;
 if(own('school')&&charts>=3)giveIntel(S.cur,1,'the research department delivers');
 const media=NODES.filter(n=>n.type==='MEDIA'&&S.owner[n.id]===S.cur).length;
 if(own('news')&&media>=2)giveIntel(S.cur,1,'you read everything');
 if(S.owner.made!=null&&Math.random()<madeChance())madePay();
 /* the regulators' files: +1 scrutiny on each of this seat's open files; a file at ACCC_RULING is ruled on now */
 {const due=acccAdvance(S.cur);if(due.length){const ep=Net.gameEpoch;await acccRuleAll(S.cur,due);if(!S||S.over||Net.gameEpoch!==ep)return}}
 const rail=(S.owner.train===S.cur||S.owner.bullet===S.cur)?1:0;
 S.steps=underCaution?1:3+(S.owner.coal===S.cur?1:0)+rail+(S.owner.asics===S.cur?1:0);
 if(windowOn('lockdown')){S.steps=Math.min(S.steps,1);log('😷 LOCKDOWN: everyone moves at most 1 step this round.')}
 /* 🚆 DEUTSCHE BAHN — DELAYS: a delayed seat moves at most 1 space, for its next two turns */
 S.delayedNow=false;
 if(S.dlcWorld&&S.delays&&S.delays[S.cur]>0){
  S.delayedNow=true;S.steps=Math.min(S.steps,1);
  const left=--S.delays[S.cur];if(left<=0)delete S.delays[S.cur];
  log('🚆 DELAYED: '+pname(S.cur)+' can only move 1 space this turn (the 17:42 is running late)'+(left>0?' — '+left+' more delayed turn'+(left>1?'s':'')+' to go.':' — the last delayed turn.'));
 }
 p.raided=0;
 sysTo(S.cur,'👁️ YOUR TURN, '+p.name.toUpperCase());
 sync(true);
 if(await winCheck())return;
 if(own('chalmers')&&!p.dc)await treasuryBrief(S.cur);
 if(jtHolder&&!p.dc)await jtBriefing(S.cur);
 anzTip();
 /* Bot seats are driven locally by the policy module. The away-path below
    would pay the away dollar and end the turn, so the bot branch must come
    first; a bot whose module failed to load falls back to the away path. */
 if(p.bot&&hooks.bots()&&hooks.bots().takeTurn){await runBotTurn(S.cur);return}
 if(p.dc){log('💤 '+pname(S.cur)+' is away — plays it quiet.');gain(S.cur,1,'away');endOfTurn()}
}
/* ============ BOT SEATS ============
   A bot is a roster entry {bot:true, conn:null}. The engine drives it exactly
   like a human guest: every mutation goes through applyIntent, every private
   prompt through askPlayer's bot branch, and the only state it sees is
   botView() — a redacted snapshot that carries nothing the wire wouldn't
   (the event deck order never leaves the engine). If static/bots.js failed
   to load (hooks.bots() is null), a bot seat quietly falls back to the away path in startTurn. */
export function botAPI(epoch){
 return {
  viewOf:pi=>((epoch===undefined||Net.gameEpoch===(epoch|0))?botView(pi):null),
  applyIntent:async(pi,m)=>{await applyIntent(pi,m)},
  /* bot banter faucet — a bot may only speak as itself, through the host */
  chat:(seat,text)=>{try{
   if(!S||S.over||!S.players[seat]||!S.players[seat].bot)return;
   const line=String(text).slice(0,140).trim();
   if(line)addChat(seat,line);
  }catch(e){}},
 };
}
export function botView(pi){
 if(!S)return null;
 const c={};
 for(const k in S){if(k==='deck'||k==='log'||k==='chat')continue;c[k]=S[k]}
 const out=JSON.parse(JSON.stringify(c));
 /* a CLASSIFIED site is invisible to a seat that may not see it: no owner, no bug, and the policy skips it as a target */
 out.hiddenFromMe={};
 if(S.hidden)Object.keys(S.hidden).forEach(nid=>{if(hiddenFrom(pi,nid)){out.hiddenFromMe[nid]=true;delete out.owner[nid];delete out.bugs[nid]}});
 out.pi=pi;
 out.curSeat=S.cur;
 out.cardIds=activeCards().map(x=>x.id);
 out.discardIds=S.discard.slice();
 out.country=COUNTRY.slice();
 out.oilIds=OIL_IDS.slice();
 out.edges=EDGES.map(e=>e.slice());
 out.nodes=NODES.map(n=>({id:n.id,type:n.type,income:n.income,cost:n.cost}));
 out.industryIds=INDUSTRIES.map(g=>({id:g.id,ids:industryNodes(g).map(n=>n.id),trigger:industryTrigger(g)}));
 out.acccRuling=ACCC_RULING;
 out.nmap={};NODES.forEach(n=>{out.nmap[n.id]={id:n.id,type:n.type,income:n.income,cost:n.cost}});
 out.moodRate=(MOODS[S.mood]||{rate:2}).rate;
 out.geo={qantasGrounded:!!(S.dlcGeo&&qantasGrounded())};
 out.jet=S.dlcWorld?{at:jetAt(),reach:NODES.filter(n=>inFlyRange(n.id)).map(n=>n.id),canFly:seat=>canFly(seat)}:null;
 out.geoUsed={stage5:!!S.geoStage5,crash:!!S.geoCrash,boeing:!!S.geoBoeing};
 out.seizePrice=(seat,nid)=>seizeListPrice(seat,NMAP[nid])+(S.owner[nid]==null?tariffFor(seat,nid)+inflationExtra():0);
 out.takePrice=(seat,nid,base)=>takeoverCost(seat,nid,base)+tariffFor(seat,nid)+inflationExtra();
 out.blockSources=seat=>blockSources(seat).length;
 out.blockFree=seat=>blockadeFree(seat);
 out.flatSeize=nid=>flatSeize(nid);
 out.noTakeover=nid=>noTakeover(nid);
 out.chokeToll=nid=>chokeToll(nid);
 out.acccExempt=(seat,ind)=>acccExempt(seat,ind);
 out.svalbardFree=seat=>svalbardFreeRebuild(seat);
 out.missingTypes=seat=>missingTypes(seat);
 return out;
}
export async function runBotTurn(pi){
 if(!S||S.over)return;
 const epoch=Net.gameEpoch;
 /* Yield the turn boundary: the table paints between turns, and a fresh game
    (initGame bumps gameEpoch) can never be haunted by a stale turn chain. */
 await new Promise(res=>hooks.setTimeout(res,0));
 if(!S||S.over||Net.gameEpoch!==epoch)return;
 try{
  await hooks.bots().takeTurn(pi,botView(pi),botAPI(epoch));
 }catch(e){console.error('[BIGCON] bot turn error',e)}
 /* whatever happened above, the turn cannot be left hanging on the table */
 if(!S||S.over||Net.gameEpoch!==epoch||S.cur!==pi)return;
 if(S.phase==='move'){S.steps=0;await endMovement()}
 if(!S||S.over||Net.gameEpoch!==epoch||S.cur!==pi)return;
 if(S.phase==='action')await endOfTurn();
}
/* JTPortal knows what runs tomorrow, and tells whoever holds it. */
export async function jtBriefing(pi){
 if(!S||S.over)return;
 if(!S.deck.length){S.deck=shuffle(S.discard.slice());S.discard=[];log('🎴 The rumor deck is reshuffled.')}
 if(!S.deck.length)return;
 const c=CARDBYID[S.deck[S.deck.length-1]];
 log('🌐 JTPortal briefs '+pname(pi)+' on what is coming next.');
 sync();
 await askPlayer(pi,{title:'JTPORTAL — “QUITE FRANKLY, HERE IS WHAT HAPPENS NEXT”',html:cardFace(c)+'<p class="fine">The event that lands at the end of your turn — for your eyes only.</p>',options:[{label:'Noted',v:1}],def:1,timeout:25000,meta:{kind:'brief',card:c.id}});
}
export function income(i){
 const p=S.players[i];const own=id=>S.owner[id]===i&&!suspended(id); /* a node a card has switched off pays and powers nothing */
 const owned=NODES.filter(n=>own(n.id));
 let salary=3;if(own('infl'))salary=4;
 let holdSum=0;owned.forEach(n=>{let v=n.income;if(n.type==='CHART'&&own('ib'))v*=2;if(n.id==='qantas'&&S.dlcGeo&&qantasGrounded())v=0;if(n.id==='w_gbr'&&reefBleached())v=0;v=cardIncome(n.id,v);holdSum+=v});
 const corp=owned.filter(n=>n.type==='CORPORATE').length,bank=owned.filter(n=>n.type==='BANK').length,chart=owned.filter(n=>n.type==='CHART').length,comm=owned.filter(n=>n.type==='COMMODITY').length,reg=owned.filter(n=>n.type==='REGULATOR').length,med=owned.filter(n=>n.type==='MEDIA').length;
 let syn=0;
 if(own('citi')&&corp)syn+=corp;
 if(own('commbank')&&bank>1)syn+=2;
 if(own('westpac')&&reg)syn+=reg;
 if(own('anz')&&chart)syn+=chart;
 if(own('bhp')&&own('train'))syn+=1;
 if(own('tenyear')&&chart>1)syn+=3*(chart-1);
 COUNTRY.forEach(c=>{if(own(c)&&own('tenyear'))syn+=1});
 if(own('mpc')&&own('school')&&own('ib'))syn+=2;
 if(own('stock')&&(own('term')||own('fox')))syn+=1;
 if(own('notes')&&bank)syn+=bank;
 if(own('barrels')&&own('forklift'))syn+=1;
 if(own('forklift')&&comm)syn+=comm;
 if(own('market')&&own('quik'))syn+=2;
 if(own('quik')){const sv=SERVO_PER*S.players.length;syn+=sv;log('⛽ THE SERVO: $'+SERVO_PER+' × '+S.players.length+' players at the table = +$'+sv+'.')}
 if(own('rock'))syn+=new Set(owned.map(n=>n.type)).size;
 if(own('bessent')&&bank)syn+=bank;
 if(own('chalmers')&&reg)syn+=reg;
 if(own('watson')&&own('coal'))syn+=2;
 if(own('mpc')&&chart)syn+=chart;
 if(S.dlcGeo&&own('geo_pyoncity')){let gc=0;GEO_NODE_IDS.forEach(gid=>{if(S.owner[gid]===i)gc++});if(gc)syn+=gc}
 if(S.dlcWorld){const rc=t=>NODES.filter(n=>n.type===t&&S.owner[n.id]!=null&&S.owner[n.id]!==i).length;const w=worldSynergy(owned,own,rc);if(w){syn+=w;log('🌐 World expansion synergies: +$'+w+'.')}}
 /* 🌐 TRADE BLOCS: the bloc node multiplies the income of its member nodes */
 if(S.dlcWorld)blocStatus(i).forEach(b=>{if(b.bonus){syn+=b.bonus;log('🌐 '+b.name+': '+b.k+' member node'+(b.k>1?'s':'')+' (base $'+b.base+') ×'+b.mult.toFixed(2)+' → +$'+b.bonus+'.')}});
 /* the market mood pays — or takes */
 if(S.mood==='BOOM'&&comm>0){syn+=comm;log('📈 BOOM: commodities pay +$1 each (+'+comm+').')}
 if(S.mood==='FRENZY'&&med>0){syn+=med;log('🗣️ FRENZY: media pays +$1 each (+'+med+').')}
 if(S.mood==='PANIC'&&bank>0){syn-=bank;log('🚨 PANIC: banks bleed −$1 each (−'+bank+').')}
 const inc=salary+holdSum+syn;
 p.money+=inc;
 log('💵 '+pname(i)+' collects $'+inc+' (salary $'+salary+' + holdings $'+holdSum+' + synergies $'+syn+') — now $'+p.money+'.');
 fxAt(i,'+$'+inc,'#7fe08d');
 Object.keys(S.bugs).forEach(nid=>{if(S.bugs[nid]===i&&S.owner[nid]!==i){const amt=(S.owner.wef===i)?2:1;p.money+=amt;log('🐛 Skim from '+NMAP[nid].name.join(' ')+': +$'+amt+'.');fxAt(i,'+$'+amt,'#7fe08d')}});
}
let openPrompts=0;
function armLockWatchdog(){hooks.clearTimeout(Net.lockTimer);Net.lockTimer=hooks.setTimeout(()=>{if(Net.lock&&openPrompts>0){armLockWatchdog();return}if(Net.lock){console.error('[BIGCON] stale action lock released');Net.lock=false;Net.lockTimer=null;sync()}},30000)}
export async function applyIntent(pi,m){
 if(!S||S.over||!m||!m.act)return;
 if(S.cur!==pi){sysTo(pi,'Not your turn.');return}
 if(Net.lock){sysTo(pi,'⏳ Your previous action is still resolving — please wait a moment.');return} Net.lock=true;armLockWatchdog();
 try{
  const act=m.act,p=S.players[pi];
  {const cb=cardGate(act);if(cb){sysTo(pi,cb);return}}
  if(act==='move'&&S.phase==='move'&&!S.mode){
   if(S.steps<=0)return;
   if(!(ADJ[p.pos]||[]).includes(m.id)){sysTo(pi,'You can only move along the red threads.');return}
   await doMove(pi,m.id);
  }
  else if((act==='favor'||act==='slip')&&S.phase==='move'&&S.delayedNow){sysTo(pi,'🚆 You are DELAYED — you can only move 1 space this turn, no favors or slipstreams.')}
  else if(act==='favor'&&S.phase==='move'&&!S.extraStep&&p.intel>=1){
   p.intel--;S.extraStep=true;S.steps++;
   log('🤝 '+pname(pi)+' cashes a favor — +1 step this turn.');
   fxAt(pi,'🛈−1 · +1 step','#55c1ff');sync();
  }
  else if(act==='endmove'&&S.phase==='move'){await endMovement()}
  else if(act==='flymode'&&S.phase==='move'&&!S.mode&&canFly(pi)&&p.money>=3){S.mode='fly';sync()}
  else if(act==='slip'&&S.phase==='move'&&!S.slipped&&S.owner.f1===pi&&p.money>=2){
   p.money-=2;S.slipped=true;S.steps+=2;
   log('🏎️ '+pname(pi)+' takes the slipstream — +2 steps and $2 off the next seizure.');
   fxAt(pi,'−$2 · +2 steps','#f5c542');sync();
  }
  else if(act==='fly'&&S.phase==='move'&&S.mode==='fly'){await doFly(pi,m.id)}
  else if(act==='cancel'){S.mode=null;sync()}
  else if(act==='seize'&&S.phase==='action'&&!S.mode){await doSeize(pi)}
  else if(act==='bugmode'&&S.phase==='action'&&!S.mode){if(p.intel<(S.owner.insider===pi?0:1)){sysTo(pi,'Planting a bug costs 1 Intel.');return}if(!(ADJ[p.pos]||[]).some(q=>S.owner[q]!=null&&S.owner[q]!==pi&&S.bugs[q]==null&&!hiddenFrom(pi,q))){sysTo(pi,'No rival node next to you can take a bug right now.');return}S.mode='bug';sync()}
  else if(act==='bug'&&S.phase==='action'&&S.mode==='bug'){await doBug(pi,m.id)}
  else if(act==='leakmode'&&abilityPhase(pi)&&!S.mode&&p.intel>=2){S.mode='leak';sync()}
  else if((act==='leak'||act==='audit'||act==='tweet'||act==='roast')&&!isRival(pi,m.target)){sysTo(pi,'Pick a rival in THE SYNDICATE list.');return}
  else if(act==='leak'&&abilityPhase(pi)&&S.mode==='leak'&&m.target!==pi){
   if(p.intel<2){sysTo(pi,'Not enough Intel.');S.mode=null;sync();return}
   p.intel-=2;fxAt(pi,'🛈−2','#55c1ff');log('🗣️ '+pname(pi)+' leaks dirt on '+pname(m.target)+'.');S.mode=null;addCortisol(m.target,2,'dirt in the morning paper');await finishNodeAbility(pi)}
  else if(act==='auditmode'&&abilityPhase(pi)&&!S.mode&&S.owner.asic===pi&&p.money>=4&&!S.audited){S.mode='audit';sync()}
  else if(act==='audit'&&abilityPhase(pi)&&S.mode==='audit'&&m.target!==pi){
   if(p.money<4||S.audited){S.mode=null;sync();return}
   p.money-=4;fxAt(pi,'−$4','#ff6b5e');S.audited=true;log('⚖️ '+pname(pi)+' sends the regulator after '+pname(m.target)+'.');S.mode=null;addCortisol(m.target,1,'a very thorough audit');await finishNodeAbility(pi)}
  else if(act==='tweetmode'&&abilityPhase(pi)&&!S.mode&&S.owner.trump===pi&&p.money>=2){S.mode='tweet';sync()}
  else if(act==='tweet'&&abilityPhase(pi)&&S.mode==='tweet'&&m.target!==pi){
   if(p.money<2){S.mode=null;sync();return}
   p.money-=2;fxAt(pi,'−$2','#ff6b5e');
   const target=S.players[m.target], intelLoss=Math.min(target.intel,Math.max(3,Math.ceil(target.intel*0.5)));
   target.intel-=intelLoss;
   if(intelLoss>0)fxAt(m.target,'🛈−'+intelLoss,'#55c1ff');
   log('🦅 '+pname(pi)+' tweets. '+pname(m.target)+' loses '+intelLoss+' Intel (the greater of 3 or 50%).');
   S.mode=null;await finishNodeAbility(pi)}
  else if(act==='spin'&&abilityPhase(pi)&&!S.mode){await doSpin(pi,m.kind==='fox'?'fox':'press')}
  else if(act==='roast'&&abilityPhase(pi)&&S.mode==='roast'&&m.target!==pi){
   const cost=S.spinKind==='fox'?2:3;
   if(p.money<cost){S.mode=null;sync();return}
   p.money-=cost;fxAt(pi,'−$'+cost,'#ff6b5e');S.spun=true;log('🗞️ '+pname(pi)+' roasts '+pname(m.target)+' in the press.');S.mode=null;addCortisol(m.target,1,'unflattering coverage');await finishNodeAbility(pi)}
  else if(act==='cook'&&abilityPhase(pi)&&!S.mode&&S.owner.rock===pi&&p.money>=3&&!S.cooked){
   p.money-=3;fxAt(pi,'−$3','#ff6b5e');S.cooked=true;log('💪 '+pname(pi)+' cooks the books. What numbers?');addCortisol(pi,-3,'a very warm kitchen');await finishNodeAbility(pi)}
  else if(act==='pressure'&&abilityPhase(pi)&&!S.mode&&S.owner.back===pi&&!S.pressured){
   S.pressured=true;log('🤝 '+pname(pi)+' leans on the table — every other player feels it.');
   S.players.forEach((pl,j)=>{if(j!==pi)addCortisol(j,1,'a backroom deal gone loud')});
   await finishNodeAbility(pi);
  }
  else if(act==='budget'&&abilityPhase(pi)&&!S.mode&&S.owner.gov===pi&&p.money>=3&&!S.budgeted){
   p.money-=3;fxAt(pi,'−$3','#ff6b5e');S.budgeted=true;log('🦘 BUDGET NIGHT! '+pname(pi)+' reads the numbers.');
   S.players.forEach((pl,i)=>{if(i!==pi)payTo(i,1,pi,'the Treasurer collects')});
   giveIntel(pi,1,'you saw the budget first');await finishNodeAbility(pi)}
  else if(act==='push'&&abilityPhase(pi)&&!S.mode&&p.pos==='sisy'&&S.owner.sisy===pi){
   const payout=S.sisyPayout||10;gain(pi,payout,'pushed the boulder uphill');S.sisyPayout=payout*2;log('🪨 The next PUSH will pay $'+S.sisyPayout+'.');await finishNodeAbility(pi)}
  else if(act==='jog'&&abilityPhase(pi)&&!S.mode&&p.pos==='asics'&&S.owner.asics===pi){
   log('👟 '+pname(pi)+' jogs a lap in the circled shoe. Why is it on the board? Irrelevant.');addCortisol(pi,-1,'a cooling lap');await finishNodeAbility(pi)}
  /* ---- 🌍 GEOGRAPHY DLC ---- */
  else if(act==='missilemode'&&S.dlcGeo&&(S.phase==='action'||S.phase==='move')&&!S.mode&&ownsMissileLauncher(pi)&&canFireMissileFrom(pi)&&p.money>=4&&p.intel>=1&&!S.geoMissiled){S.mode='missile';sync()}
  else if(act==='missile'&&S.dlcGeo&&(S.phase==='action'||S.phase==='move')&&S.mode==='missile'){
   const n=NMAP[m.id];
   if(!n||!S.rubble||S.rubble[m.id]){sysTo(pi,'Pick a target that still stands.');S.mode=null;sync();return}
   if(S.owner[m.id]===pi){sysTo(pi,'You cannot missile your own node.');S.mode=null;sync();return}
   if(hiddenFrom(pi,m.id)){sysTo(pi,'You cannot target a CLASSIFIED site — you cannot even see it.');S.mode=null;sync();return}
   if(isPillarShieldedNode(m.id)){sysTo(pi,'ESG SHIELD — that holding is protected while its owner controls the Pillars. Strike the Pillars to break the shield.');S.mode=null;sync();return}
   const launcherId=S.owner.geo_missile===pi?'geo_missile':(S.owner.geo_shahed===pi?'geo_shahed':null);
   if(!launcherId||!canFireMissileFrom(pi)){sysTo(pi,'You no longer control an armed missile launcher.');S.mode=null;sync();return}
   /* ESG holdings are valid missile targets. */
   if(p.money<4||p.intel<1||S.geoMissiled){sysTo(pi,'Missile unavailable.');S.mode=null;sync();return}
   p.money-=4;p.intel-=1;fxAt(pi,'−$4 · 🛈−1','#ff6b5e');
   S.geoMissiled=true;S.mode=null;
   if(m.id==='geo_tuvalu'){
    /* 🌍 TUVALU REFLECTS — the island sends the warhead back at the launcher
       that actually fired it, whether that is MISSILE COMMAND or the SHAHED DRONE. */
    const launcherName=NMAP[launcherId].name.join(' ');
    projFx('missile',launcherId,'geo_tuvalu');
    log('🚀 '+pname(pi)+' launches a missile at TUVALU — the island REFUSES it. The warhead comes back down on '+pname(pi)+'’s own holdings.');
    if(rubbleShielded(launcherId))log('🌱 The SEED VAULT saves '+pname(pi)+'’s '+launcherName+' from the backblast — it survives.');
    else{
     const lo=S.owner.w_vero;
     delete S.owner[launcherId];delete S.bugs[launcherId];S.rubble[launcherId]=1;
     fx(NMAP[launcherId].x,NMAP[launcherId].y-70,'💥 BACKFIRE','#ff6b5e');
     log('💥 '+pname(pi)+'’s '+launcherName+' is destroyed in the backblast — rubble, no payout, no refund.');
     lloydsPays(launcherId,pi,lo);
    }
    sync();
    await projPause(); /* the warhead flies to the island before anything lands */
    /* The ESG shield absorbs a reflected strike before it can reach the owner's other holdings. */
    const pool=NODES.filter(nn=>S.owner[nn.id]===pi&&nn.id!==launcherId&&nn.id!=='geo_tuvalu'&&!S.rubble[nn.id]&&(S.owner.geo_pillars!==pi||nn.id==='geo_pillars'));
    /* ESG does not shield the owner's holdings from missile impacts. */
    if(pool.length){
     const hit=pool[Math.floor(Math.random()*pool.length)];
     if(projFx('missile','geo_tuvalu',hit.id)){sync();await projPause()} /* the reflected warhead flies home on screen */
     strikeNode(pi,hit.id,{silent:true});
    }
    else log('🌊 The reflection finds nothing else of theirs to hit — the sea keeps the rest.');
    if(S.phase==='move'){S.steps=0;await endMovement()} /* a mid-move launch ends the walk; the action phase still follows */
    else await endOfTurn();
   }else{
    if(projFx('missile',launcherId,m.id)){sync();await projPause()} /* the flight starts at the launcher the player actually owns */
    strikeNode(pi,m.id);
    if(S.phase==='move'){S.steps=0;await endMovement()} /* a mid-move launch ends the walk; the action phase still follows */
    else await endOfTurn();
   }
  }
  else if(act==='rebuild'&&S.phase==='action'&&S.rubble&&!S.mode&&S.rubble[p.pos]){
   const n=NMAP[p.pos];
   /* 🌐 SVALBARD SEED VAULT — once per game its owner rebuilds one rubble node for free */
   const free=m.free===true;
   if(free&&!svalbardFreeRebuild(pi)){sysTo(pi,'The Seed Vault’s free rebuild is not available to you.');return}
   const cost=free?0:n.cost;
   if(p.money<cost){sysTo(pi,'Rebuilding '+nodeName(n).join(' ')+' costs $'+cost+' — you cannot afford it.');return}
   if(free){S.svalbardUsed=true;log('🌱 '+pname(pi)+' opens the Seed Vault — the rebuild is FREE (once per game).')}
   if(cost>0){p.money-=cost;fxAt(pi,'−$'+cost,'#ff6b5e')}
   delete S.rubble[p.pos];
   if(n.rebuiltName){(S.rebuilt||(S.rebuilt={}))[n.id]=1;log('🏔️ '+n.name.join(' ')+' rises again as '+n.rebuiltName.join(' ')+'.')}
   fx(n.x,n.y-64,'♻️ REBUILT','#7fe08d');
   log('♻️ '+pname(pi)+' '+(free?'rebuilds ':'pays $'+cost+' to rebuild ')+nodeName(n).join(' ')+'. It returns unowned — first bids from next turn.');
   const hb=S.owner.geo_pyothotel;if(hb!=null)gain(hb,2,'construction kickbacks on every rebuild');
   await endOfTurn();
  }
  else if(act==='beach'&&abilityPhase(pi)&&S.dlcGeo&&!S.mode&&p.pos==='geo_wonsan'&&S.owner.geo_wonsan===pi&&!S.geoBeach){
   S.geoBeach=true;log('🏖️ '+pname(pi)+' takes a beach day in Wonsan. The cortisol washes away.');
   addCortisol(pi,-2,'sunscreen and silence');await finishNodeAbility(pi);
  }
  else if(act==='qantasdown'&&abilityPhase(pi)&&S.dlcGeo&&!S.mode&&S.owner.geo_boeing===pi&&p.money>=4&&!S.geoBoeing){
   if(S.owner.qantas===pi){sysTo(pi,'You own the kangaroo — you cannot shut down your own airline.');return}
   p.money-=4;fxAt(pi,'−$4','#ff6b5e');S.geoBoeing=true;
   S.qantasGroundUntil=S.turn+2;
   const qn=NMAP.qantas;fx(qn.x,qn.y-70,'🛫 GROUNDED','#ff6b5e');
   log('🛩️ '+pname(pi)+' parks THE CORPORATE BOEING on the runway — QANTAS is grounded until the end of next round: nobody can fly or walk in, and it pays its owner nothing.');
   await finishNodeAbility(pi);
  }
  else if(act==='oilcrash'&&abilityPhase(pi)&&S.dlcGeo&&!S.mode&&S.owner.geo_scs===pi&&p.money>=3&&!S.geoCrash){
   p.money-=3;fxAt(pi,'−$3','#ff6b5e');S.geoCrash=true;
   setMood('PANIC','the South China Sea narrows — crude is crashing');
   log('🌊 '+pname(pi)+' closes the sea lanes — OIL CRASH! Every oil position goes underwater.');
   OIL_IDS.forEach(oid=>{
    const o=S.owner[oid];if(o==null)return;
    if(S.owner.geo_pillars===o){log('🧱 '+pname(o)+' holds the Pillars of Sustainability — '+NMAP[oid].name.join(' ')+' rides the crash out unscathed.');return}
    payVoid(o,2,NMAP[oid].name.join(' ')+' crashes underwater');
   });
   await finishNodeAbility(pi);
  }
  else if(act==='stage5'&&abilityPhase(pi)&&S.dlcGeo&&!S.mode&&S.owner.geo_stage5===pi&&p.intel>=2&&!S.geoStage5){
   let rich=-1;
   S.players.forEach((pl,j)=>{if(j!==pi&&(rich<0||S.players[j].money>S.players[rich].money))rich=j});
   if(rich<0){sysTo(pi,'There is nobody else to decline.');return}
   if(S.owner.geo_pillars===rich){sysTo(pi,'ESG SHIELD — that player cannot be called into decline.');return}
   p.intel-=2;fxAt(pi,'🛈−2','#55c1ff');S.geoStage5=true;S.decline=rich;
   log('📉 '+pname(pi)+' calls STAGE 5 DECLINE — '+pname(rich)+', the richest at the table, will make no income on their next turn.');
   fxAt(rich,'📉 STAGE 5','#ff6b5e');
   await finishNodeAbility(pi);
  }
  else if(act==='venicecool'&&abilityPhase(pi)&&S.dlcGeo&&!S.mode&&p.pos==='geo_venice'&&S.owner.geo_venice===pi&&!S.geoVenice){
   S.geoVenice=true;log('🚤 '+pname(pi)+' takes the gondola. Canals > committees.');
   addCortisol(pi,-1,'a quiet canal');await finishNodeAbility(pi);
  }
  else if(act==='overmode'&&S.phase==='action'&&S.dlcGeo&&!S.mode&&S.owner.geo_venice===pi&&p.money>=2&&!S.geoVenice){S.mode='overtour';sync()}
  else if(act==='overtour'&&S.phase==='action'&&S.dlcGeo&&S.mode==='overtour'){
   const n=NMAP[m.id],o=S.owner[m.id];
   if(!n||o==null||o===pi||S.rubble[m.id]||hiddenFrom(pi,m.id)){sysTo(pi,'Overtourism targets a rival-owned node that still stands.');S.mode=null;sync();return}
   /* ESG does not protect against Overtourism. */
   if(p.money<2||S.geoVenice){S.mode=null;sync();return}
   p.money-=2;fxAt(pi,'−$2','#ff6b5e');
   S.geoVenice=true;S.ov={nid:m.id,by:pi,targetOwner:o,expiresAt:S.turn*S.players.length+S.cur+S.players.length};S.mode=null;
   fx(n.x,n.y-60,'🛳️ OVERTOURISM','#e19bff');
   log('🛳️ '+pname(pi)+' sends the cruise ships to '+n.name.join(' ')+' — OVERTOURISM: '+pname(o)+' takes +1 Cortisol on their next turn.');
   await finishNodeAbility(pi);
  }
  else if(act==='blockmode'&&(S.phase==='action'||(S.phase==='move'&&blockadeFree(pi)))&&!S.mode&&blockSources(pi).length&&!S.blockadeUsed){S.mode='blockade';sync()}
  else if(act==='blockade'&&(S.phase==='action'||(S.phase==='move'&&blockadeFree(pi)))&&S.mode==='blockade'){
   const n=NMAP[m.id];
   if(!n||S.rubble[m.id]||blockaded(m.id)||hiddenFrom(pi,m.id)){sysTo(pi,'That node is rubble, already walled off or CLASSIFIED.');S.mode=null;sync();return}
   const free=blockadeFree(pi);
   S.blockades[m.id]=S.turn+2;S.blockadeUsed=true;S.mode=null;
   fx(n.x,n.y-64,'🚧 BLOCKADED','#f5c542');
   log('🚧 '+pname(pi)+' walls off '+n.name.join(' ')+' — BLOCKADED until the end of next round: nobody walks in, nobody lands, not even '+pname(pi)+'.'+(free?' (A free action: the combo of two blockade sources keeps your '+(S.phase==='move'?'movement':'action')+'.)':''));
   if(free){sync();return}
   await finishNodeAbility(pi);
  }
  /* ---- 🌐 WORLD EXPANSION actives: a table of handlers (see WORLD_ACTS) ---- */
  else if(S.dlcWorld&&Object.prototype.hasOwnProperty.call(WORLD_ACTS,act)){await WORLD_ACTS[act](pi,m)}
  /* ---- 🤵 CLASSIC node actives that live in a table (CLASSIC_ACTS) ---- */
  else if(Object.prototype.hasOwnProperty.call(CLASSIC_ACTS,act)){await CLASSIC_ACTS[act](pi,m)}
  /* ---- INTEL OPS ---- */
  else if(act==='spy'&&S.phase==='action'&&!S.mode&&p.intel>=2){
   p.intel-=2;fxAt(pi,'🛈−2','#55c1ff');log('🛈 '+pname(pi)+' buys a look at tomorrow.');
   if(!S.deck.length){S.deck=shuffle(S.discard.slice());S.discard=[];log('🎴 The rumor deck is reshuffled.')}
   if(S.deck.length){
    const c=CARDBYID[S.deck[S.deck.length-1]];
    await askPlayer(pi,{title:'SPY ON THE DECK — 2 🛈',html:cardFace(c)+'<p class="fine">The next market event, for your eyes only.</p>',options:[{label:'Understood',v:1}],meta:{kind:'brief',card:c.id}});
   }
   sync();
  }
  else if(act==='dossier'&&S.phase==='action'&&!S.mode&&!S.dossier&&p.intel>=3){
   p.intel-=3;S.dossier=true;fxAt(pi,'📂 THE DOSSIER','#e19bff');
   log('📂 '+pname(pi)+' opens THE DOSSIER — this turn’s hostile takeovers cost list price, not double.');
   sync();
  }
  else if(act==='sweep'&&S.phase==='action'&&!S.mode&&p.intel>=2){
   p.intel-=2;fxAt(pi,'🛈−2','#55c1ff');
   /* "remove every bug on your nodes" — the office sweep clears rival bugs
      off nodes YOU own (that rival skim is funding their race), and also
      closes your own skim operation on nodes you no longer hold. */
   const cleaned=Object.keys(S.bugs).filter(nid=>S.bugs[nid]===pi||S.owner[nid]===pi);
   const enemy=cleaned.filter(nid=>S.bugs[nid]!==pi).length;
   if(cleaned.length){
    cleaned.forEach(nid=>{delete S.bugs[nid];const n=NMAP[nid];fx(n.x,n.y-60,'🧹','#8fbf7f')});
    log('🧹 '+pname(pi)+' sweeps '+cleaned.length+' bug'+(cleaned.length>1?'s':'')+(enemy?' — '+enemy+' rival bug'+(enemy>1?'s':'')+' off their own nodes':'')+' — the office is clean.');
   }
   else log('🧹 '+pname(pi)+' sweeps the office — nothing found. Paranoia is free; the sweep cost 2 Intel.');
   await endOfTurn();
  }
  else if(act==='masspanic'&&S.phase==='action'&&!S.mode&&p.intel>=5){
    p.intel-=5;fxAt(pi,'🛈−5','#55c1ff');
    log('🔥 '+pname(pi)+' unleashes MASS PANIC — everyone gains +2 Cortisol.');
    S.players.forEach((pl,j)=>addCortisol(j,2,'mass panic'));
    await endOfTurn();
   }
  else if(act==='targetpanic'&&S.phase==='action'&&!S.mode&&p.intel>=30){
   /* a rival who has VANISHED (Bermuda) cannot be targeted */
   const rivals=S.players.map((pl,j)=>j).filter(j=>isRival(pi,j));
   if(!rivals.length){sysTo(pi,'There is nobody at the table you can target right now.');return}
   const target=await askPlayer(pi,{title:'CORTISOL OVERLOAD — 30 INTEL',body:'Choose one rival to receive +6 Cortisol.',options:rivals.map(j=>({label:pname(j)+' · '+S.players[j].cortisol+'/9 Cortisol',v:j})).concat([{label:'Cancel',v:-1}]),def:-1});
   if(target<0){sync();return}
   if(!rivals.includes(target)){sysTo(pi,'Choose a valid rival.');sync();return}
   if(S.cur!==pi||S.phase!=='action'||S.mode||S.over||p.intel<30||!isRival(pi,target)){sysTo(pi,'The overload is no longer available.');sync();return}
   p.intel-=30;fxAt(pi,'🛈−30','#55c1ff');log('🔥 '+pname(pi)+' spends 30 Intel to overload '+pname(target)+' with +6 Cortisol.');
   addCortisol(target,6,'a 30-Intel intelligence overload',null,true);await endOfTurn();
  }
  else if(act==='divestmade'&&S.phase==='action'&&!S.mode&&p.intel>=5&&p.money>=7&&S.owner.made!=null&&S.owner.made!==pi){
   const oldOwner=S.owner.made;
   const confirm=await askPlayer(pi,{title:'DIVEST MADE — 5 INTEL + $7',body:'Force MADE away from '+pname(oldOwner)+'? They receive $7 compensation.',options:[{label:'Pay 5 Intel + $7 compensation',v:1},{label:'Cancel',v:0}],def:0});
   if(!confirm){sync();return}
   if(S.cur!==pi||S.phase!=='action'||S.mode||S.over||S.owner.made!==oldOwner||p.intel<5||p.money<7){sysTo(pi,'The divestment is no longer available.');sync();return}
   p.intel-=5;p.money-=7;S.players[oldOwner].money+=7;delete S.owner.made;delete S.bugs.made;
   fxAt(pi,'🛈−5 · −$7','#55c1ff');fxAt(oldOwner,'+$7 compensation','#7fe08d');
   log('🟣 '+pname(pi)+' forces MADE to divest from '+pname(oldOwner)+', paying $7 compensation.');
   addCortisol(pi,1,'the forced divestment');await endOfTurn();
  }
  else if(act==='bondmageddon'&&S.phase==='action'&&!S.mode&&S.owner.bond===pi&&S.owner.leak===pi&&!S.bondmageddonUsed&&p.money>=16&&p.intel>=4){
   const rivals=S.players.map((pl,j)=>j).filter(j=>isRival(pi,j)&&NODES.some(nn=>S.owner[nn.id]===j&&!S.rubble[nn.id]));
   if(!rivals.length){sysTo(pi,'There are no rivals with intact holdings to target.');return}
   const target=await askPlayer(pi,{title:'BONDMAGEDDON — CHOOSE TARGET',body:'Choose which rival to target with all four missiles.',options:rivals.map(j=>({label:pname(j)+' · '+NODES.filter(nn=>nn.type==='CHART'&&S.owner[nn.id]===j).length+' CHART holdings',v:j})).concat([{label:'Cancel',v:-1}]),def:-1});
   if(target<0){sync();return}
   if(!rivals.includes(target)){sysTo(pi,'Choose a valid rival with intact holdings.');sync();return}
   if(S.cur!==pi||S.phase!=='action'||S.mode||S.over||S.owner.bond!==pi||S.owner.leak!==pi||S.bondmageddonUsed||p.money<16||p.intel<4||!isRival(pi,target)){sysTo(pi,'Bondmageddon is no longer available.');sync();return}
   const owned=NODES.filter(nn=>S.owner[nn.id]===target&&!S.rubble[nn.id]);
   if(!owned.length){sysTo(pi,'The chart leader has no intact holdings to strike.');return}
   const esg=owned.find(nn=>nn.id==='geo_pillars');
   let targets;
   if(esg){
    const others=owned.filter(nn=>nn.id!=='geo_pillars');
    const final=others.length?others[Math.floor(Math.random()*others.length)]:esg;
    targets=[esg.id,esg.id,esg.id,final.id];
   }else{
    targets=shuffle(owned).slice(0,4).map(nn=>nn.id);
    while(targets.length<4)targets.push(owned[Math.floor(Math.random()*owned.length)].id);
   }
   p.money-=16;p.intel-=4;S.bondmageddonUsed=true;fxAt(pi,'−$16 · 🛈−4','#ff6b5e');
   const targetCharts=NODES.filter(nn=>nn.type==='CHART'&&S.owner[nn.id]===target&&!S.rubble[nn.id]).length;
   log('💥 '+pname(pi)+' unleashes BONDMAGEDDON on '+pname(target)+' ('+targetCharts+' CHART nodes). Four missiles inbound.');
   for(let i=0;i<targets.length;i++){
    const id=targets[i],node=NMAP[id];
    if(projFx('missile','bond',id)){sync();await projPause()}
    if(!S.rubble[id]&&S.owner[id]===target)strikeNode(pi,id,{silent:true});
    else log('💥 Missile '+(i+1)+' hits '+node.name.join(' ')+' again — it is already rubble; the barrage continues.');
   }
   await endOfTurn();
  }
  /* ---- 🧐 THE REGULATORS' FILES ---- */
  else if(act==='marketsell'&&S.phase==='action'&&!S.mode){
   const n=typeof m.id==='string'?NMAP[m.id]:null;
   if(!n||S.owner[m.id]!==pi){sysTo(pi,'Pick a node you own.');return}
   const f=fileForNode(pi,m.id);
   if(!f){sysTo(pi,'Only a node in a book with an open ACCC or ASIC file can be sold back to the market.');return}
   delete S.owner[m.id];delete S.bugs[m.id];if(m.id==='sisy')S.sisyPayout=10;
   fx(n.x,n.y-64,'🏷️ SOLD','#7fe08d');
   log('🏷️ '+pname(pi)+' sells '+n.name.join(' ')+' back to the market for its $'+n.cost+' list price, with '+fileName(f)+' open. It is unowned again.');
   gain(pi,n.cost,'market sale of '+n.name.join(' '));
   acccReconcile();sync();
   if(await winCheck())return;
   await endOfTurn();
  }
  else if(act==='lobby'&&S.phase==='action'&&!S.mode){
   const f=typeof m.kind==='string'?findFile(pi,m.kind):null;
   if(!f){sysTo(pi,'You have no open file in that industry to lobby against.');return}
   if(S.lobbied){sysTo(pi,'You have already lobbied this turn.');return}
   if(p.intel<3){sysTo(pi,'Lobbying costs 3 Intel.');return}
   if(f.s<=0){sysTo(pi,'That file is already at 0 scrutiny.');return}
   p.intel-=3;S.lobbied=true;f.s=Math.max(0,f.s-1);fxAt(pi,'🛈−3','#55c1ff');
   log(fileIcon(f)+' '+pname(pi)+' lobbies the '+f.agency+' (3 Intel) — '+fileName(f)+' drops to scrutiny '+f.s+'/'+ACCC_RULING+'.');
   sync();
  }
  else if(act==='refermode'&&S.phase==='action'&&!S.mode&&(S.owner.accc===pi||S.owner.asic===pi||(S.dlcWorld&&S.owner.w_wto===pi))&&p.money>=4&&!S.referred&&S.players.some((pl,i)=>i!==pi&&filesOf(i).some(f=>S.owner[fileAuthority(f)]===pi))){S.mode='refer';sync()}
  else if(act==='refer'&&S.phase==='action'&&(!S.mode||S.mode==='refer')){
   const bail=msg=>{sysTo(pi,msg);if(S.mode==='refer'){S.mode=null;sync()}};
   if(!isRival(pi,m.target)){bail('Pick a rival with an open file — never your own.');return}
   const f=typeof m.kind==='string'?findFile(m.target,m.kind):null;
   if(!f){bail('That rival has no open file in that industry.');return}
   const need=fileAuthority(f);
   if(S.owner[need]!==pi){bail(need==='asic'?'Only the ASIC owner can refer a monetary-policy file.':need==='w_wto'?'Only the WTO owner can refer a trade-bloc file.':'Only the ACCC owner can refer this file.');return}
   if(S.referred){bail('You have already made a referral this turn.');return}
   if(p.money<4){bail('A referral costs $4.');return}
   p.money-=4;S.referred=true;S.mode=null;f.s++;
   fxAt(pi,'−$4','#ff6b5e');fxAt(m.target,'📁 +1 SCRUTINY','#55c1ff');
   log(fileIcon(f)+' '+pname(pi)+' refers '+pname(m.target)+'’s '+INDBYID[f.ind].name+' book to the '+f.agency+' ($4) — scrutiny '+f.s+'/'+ACCC_RULING+'. Any ruling waits for '+pname(m.target)+'’s turn start.');
   await endOfTurn();
  }
  /* ---- 🤝 NODE DEALS: sell one of yours to one rival for a price you name ---- */
  else if(act==='dealmode'&&S.phase==='action'&&!S.mode&&S.players.length>1&&NODES.some(nn=>S.owner[nn.id]===pi)){S.mode='deal';sync()}
  else if(act==='deal'&&S.phase==='action'&&(!S.mode||S.mode==='deal')){
   const bail=msg=>{sysTo(pi,msg);if(S.mode==='deal'){S.mode=null;sync()}};
   const buyer=m.target,n=typeof m.id==='string'?NMAP[m.id]:null,price=m.n;
   if(!isRival(pi,buyer)){bail('Offer the deal to a rival at the table.');return}
   if(!n||S.owner[m.id]!==pi){bail('You can only offer a node you own.');return}
   {const hb=honeypotBan(buyer,m.id);if(hb){bail(pname(buyer)+' cannot buy it: '+hb);return}}
   if(!Number.isInteger(price)||price<0||price>S.players[buyer].money){bail('Name a whole-dollar price from $0 to '+pname(buyer)+'’s cash ($'+S.players[buyer].money+').');return}
   S.mode=null;
   const nm=n.name.join(' ');
   log('🤝 '+pname(pi)+' offers '+nm+' to '+pname(buyer)+' for $'+price+'.');
   sync();
   const v=await askPlayer(buyer,{title:'DEAL OFFERED — '+nm+' FOR $'+price,body:pname(pi)+' offers to sell you '+nm+' ('+n.type+', $'+n.income+'/turn, list $'+n.cost+') for $'+price+'. Any bugs on it are cleared. No Cortisol either way.',options:[{label:'Accept — pay $'+price,v:1},{label:'Decline',v:0}],def:0,timeout:30000,meta:{kind:'deal',node:n.id,price,from:pi}});
   if(!S||S.over||S.cur!==pi||S.phase!=='action')return;
   if(v===1&&S.owner[m.id]===pi&&S.players[buyer]&&S.players[buyer].money>=price){
    S.players[buyer].money-=price;p.money+=price;
    S.owner[m.id]=buyer;delete S.bugs[m.id];if(m.id==='sisy')S.sisyPayout=10;
    if(price>0){fxAt(buyer,'−$'+price,'#ff6b5e');fxAt(pi,'+$'+price,'#7fe08d')}
    fx(n.x,n.y-64,'🤝 SOLD',S.players[buyer].color);
    log('🤝 DEAL DONE — '+pname(buyer)+' buys '+nm+' from '+pname(pi)+' for $'+price+'. Bugs on it are cleared.');
    acccReconcile();sync();
    if(await winCheck())return;
   }
   else if(v===1)log('🤝 The deal for '+nm+' falls through — it is no longer on the table. The offer still used the turn.');
   else log('🤝 '+pname(buyer)+' declines — '+nm+' stays with '+pname(pi)+'. The offer still used the turn.');
   await endOfTurn();
  }
  else if((act==='sell'||act==='sellall')&&S.phase==='action'&&!S.mode){
   const rate=MOODS[S.mood].rate;const n=act==='sellall'?p.intel:Math.min(Math.floor(+m.n)||0,p.intel);
   if(n<=0){sysTo(pi,'No Intel to sell.');return}
   p.intel-=n;fxAt(pi,'🛈−'+n,'#55c1ff');
   gain(pi,n*rate,'sold '+n+' Intel at the market ($'+rate+'/🛈)');
   await endOfTurn();
  }
  else if(act==='laylow'&&S.phase==='action'&&!S.mode){
   if(m.choice==='cash')gain(pi,1,'kept it quiet');else addCortisol(pi,-2,'kept it quiet');
   await endOfTurn()}
 } finally {hooks.clearTimeout(Net.lockTimer);Net.lockTimer=null;Net.lock=false}
}
/* ---- 🚧 BLOCKADE sources: ALBANESE, and on the Global Edition THE GREAT BARRIER REEF (unless bleached) and CRITICAL PATH ANALYSIS.
   One source: BLOCKADE uses your action (once per turn). Two or more: it is a FREE action (move or action phase, once per turn), which keeps
   your action and your movement. One blockade per turn in total (S.blockadeUsed), however many sources you hold. ---- */
export function reefBleached(){return !!(S&&S.dlcWorld&&S.bleachUntil>S.turn)}
export function blockSources(pi){
 if(!S||!S.owner)return [];
 const ids=['albo'];if(S.dlcWorld){if(!reefBleached())ids.push('w_gbr');ids.push('w_cpa')}
 return ids.filter(id=>S.owner[id]===pi&&NMAP[id]&&!(S.rubble&&S.rubble[id]));
}
export function blockadeFree(pi){return blockSources(pi).length>=2}
/* 🐧 THE ANTARCTIC TREATY settles the Peninsula claims while anyone owns it (and it is not rubble) */
export function treatyInForce(){return !!(S&&S.dlcWorld&&S.owner&&S.owner.w_antarctica!=null&&!(S.rubble&&S.rubble.w_antarctica))}
/* ---- 🌐 TRADE BLOCS: member count, multiplier and bonus for each bloc node a seat owns ---- */
export function blocStatus(pi){
 const out=[];if(!S||!S.dlcWorld||!S.owner)return out;
 Object.keys(TRADE_BLOCS).forEach(bid=>{
  if(S.owner[bid]!==pi||!NMAP[bid]||S.rubble[bid])return;
  const b=TRADE_BLOCS[bid],mem=b.members.filter(id=>NMAP[id]&&S.owner[id]===pi);
  const base=mem.reduce((a,id)=>a+NMAP[id].income,0),mult=b.noCap?1+BLOC_STEP*mem.length:Math.min(BLOC_MAX,1+BLOC_STEP*mem.length); /* the Antarctic Treaty has no cap */
  const g=b.noWto?null:INDBYID['bloc_'+b.short.toLowerCase()],f=g?findFile(pi,g.id):null;
  out.push({id:bid,name:NMAP[bid].name.join(' '),icon:b.icon,k:mem.length,members:mem,base,mult,bonus:Math.round(base*(mult-1)),file:f,noWto:!!b.noWto,step:!b.noWto&&mem.length>BLOC_FREE?mem.length-BLOC_FREE:0});
 });
 return out;
}
/* ---- 🧱 THE TARIFF WALL: the +$2 a rival pays (to the wall's owner) to seize or take over a node of the named type ---- */
export function tariffOwner(){return S&&S.dlcWorld&&S.tariffType&&S.owner.w_tariffwall!=null&&!(S.rubble&&S.rubble.w_tariffwall)?S.owner.w_tariffwall:null}
export function tariffFor(pi,nid){const o=tariffOwner();return o!=null&&o!==pi&&NMAP[nid]&&NMAP[nid].type===S.tariffType?TARIFF_EXTRA*(S.tariffWarUntil>S.turn?2:1):0}
/* 🌐 the world helpers a Cruise Ship voyage and ANZCERTA need */
export function isWaterNode(id){return WATER_NODES.has(id)&&!!NMAP[id]}
export function ausNzWaiver(pi,from,to){return !!(S&&S.dlcWorld&&S.owner.w_anzcerta===pi&&AUSNZ.has(from)&&AUSNZ.has(to))}
/* 🌐 World Expansion actives. Each handler runs inside applyIntent (the turn lock held, host-side), validates for itself and ends the action through finishNodeAbility. */
/* 🌐 the edge graph is part of the game state (S.boardEdges), so cuts and new roads survive sync, reconnects and the 3D snapshot */
/* the carry trade: borrow up to CARRY_CAP; half as much again is due at the start of your next turn; every $2 (or part) you cannot return is 1 Cortisol */
export const CARRY_LOAN=6,CARRY_CAP=50;
export const carryDue=loan=>Math.ceil(loan*1.5),carryPenalty=short=>Math.ceil(short/2);
/* 🎰 PUT IT ALL ON BLACK (Monaco Casino, Marina Bay Sands): a bet that pays double 47% of the time */
export const BLACK_ODDS=0.47;
/* …or ALL IN ON GREEN: the single zero (1 pocket in 37) pays 35 to 1 */
export const GREEN_ODDS=1/37,GREEN_PAYS=35;
export const CASINOS=['w_monaco','w_mbs'];
const IMF_LOAN=6,IMF_REPAY=8,IMF_CORTISOL=2,DOHA_PER=2,CRUISE_FARE=2;
/* THE TARIFF WALL: $4 on every rival seizure of the walled type, plus an IMPORT DUTY at the start of each rival's turn:
   $1 per walled-type node they hold (up to $4), all paid to the wall's owner. A TARIFF WAR doubles both. */
export const TARIFF_EXTRA=4,TARIFF_DUTY_CAP=4;
export function tariffDuty(pi){const o=tariffOwner();if(o==null||o===pi)return 0;const c=NODES.filter(n=>n.type===S.tariffType&&S.owner[n.id]===pi&&!(S.rubble&&S.rubble[n.id])).length;return Math.min(TARIFF_DUTY_CAP,c)*(S.tariffWarUntil>S.turn?2:1)}
export function isVanished(i){return !!(S&&S.dlcWorld&&S.vanished&&S.vanished[i]!=null)}
export function hasEdge(a,b){return EDGES.some(e=>(e[0]===a&&e[1]===b)||(e[0]===b&&e[1]===a))}
function commitEdges(list){S.boardEdges=list.map(e=>e.slice());setEdges(list.map(e=>e.slice()));rebuildAdj()}
function reachFromQuik(edges){
 const adj={};edges.forEach(e=>{if(!NMAP[e[0]]||!NMAP[e[1]])return;(adj[e[0]]=adj[e[0]]||[]).push(e[1]);(adj[e[1]]=adj[e[1]]||[]).push(e[0])});
 const seen=new Set(['quik']),q=['quik'];
 while(q.length){const c=q.pop();(adj[c]||[]).forEach(x=>{if(!seen.has(x)){seen.add(x);q.push(x)}})}
 return seen;
}
/* RULE: no cut may strand a node from Quikstop that could reach it before (the board stays one connected piece) */
export function cutKeepsBoardConnected(a,b){
 const rest=EDGES.filter(e=>!((e[0]===a&&e[1]===b)||(e[0]===b&&e[1]===a)));
 return reachFromQuik(rest).size>=reachFromQuik(EDGES).size;
}
/* why a World Expansion active cannot be used right now ('' when it can) */
export function worldBlocked(pi,kind){
 if(!S||!S.dlcWorld)return 'The Global Edition exhibits are not in play.';
 if(kind==='launch'||kind==='cruise'){const cb=cardGate('fly');if(cb)return cb}
 const p=S.players[pi],used=S.wTurn||{},game=S.wGame||{};
 const need={chainsaw:'w_milei',brexit:'w_brexit',silkroad:'w_bri',carry:'w_boj',advance:'w_nigprince',hold:'w_bangalore',carbon:'w_amazon',vanish:'w_bermuda',launch:'w_baikonur',bailout:'w_imf',tariff:'w_tariffwall',cruise:'w_cruise',doha:'w_doha'}[kind];
 if(!need||!NMAP[need])return 'Unknown ability.';
 if(S.owner[need]!==pi)return 'You do not control '+nodeName(NMAP[need]).join(' ')+'.';
 if(S.rubble&&S.rubble[need])return 'That node is rubble.';
 switch(kind){
  case 'chainsaw':if(game.milei)return 'The chainsaw has already been used this game.';if(p.money<3)return 'The chainsaw costs $3.';break;
  case 'brexit':if(game.brexit)return 'Brexit has already happened.';break;
  case 'silkroad':if(used.silkroad)return 'You already built a road this turn.';if(p.money<4)return 'A new road costs $4.';break;
  case 'carry':if(S.carry&&S.carry[pi])return 'You still owe Tokyo from the last carry trade.';break;
  case 'advance':if(used.advance)return 'The prince only writes once a turn.';if(p.money<2)return 'The advance fee is $2.';break;
  case 'hold':if(used.hold)return 'You already put someone on hold this turn.';if(!S.players.some((x,i)=>i!==pi&&!isVanished(i)&&x.intel>=1))return 'No rival has any Intel to lose.';break;
  case 'carbon':if(used.carbon)return 'You already sold credits this turn.';break;
  case 'vanish':if(used.vanish)return 'You already vanished this turn.';break;
  case 'bailout':if(used.bailout)return 'You already made a bailout this turn.';if(p.money<IMF_LOAN)return 'A bailout lends $'+IMF_LOAN+' out of your own pocket.';if(!S.players.some((x,i)=>i!==pi&&!isVanished(i)&&!(S.imf&&S.imf[i])))return 'Every rival already carries an IMF loan.';break;
  case 'tariff':if(used.tariff)return 'You already moved the wall this turn.';if(S.phase!=='move'&&S.phase!=='action')return 'Not now.';break;
  case 'cruise':if(S.phase!=='move'||S.cur!==pi)return 'The cruise ship sails in your MOVE phase.';if(!isWaterNode(p.pos))return 'The ship only sails from a WATER node (a strait, island, port or sea).';if(p.money<CRUISE_FARE)return 'The fare is $'+CRUISE_FARE+'.';break;
  case 'doha':if(game.doha)return 'The Doha round has already been launched (and has stalled).';break;
  case 'launch':if(game.baikonur)return 'The launch window has closed: Baikonur flies once per game.';if(S.phase!=='move'||S.cur!==pi)return 'Baikonur launches in your MOVE phase.';if(p.money<3)return 'A launch costs $3.';break;
 }
 return '';
}
const WORLD_ACTS={
 /* enter a targeting mode: chainsaw / brexit / silkroad (pick an edge), vanish (pick a node), hold (pick a rival) */
 async worldmode(pi,m){
  if(!['chainsaw','brexit','silkroad','vanish','hold','launch','bailout','cruise'].includes(m.kind)||S.mode||!((m.kind==='launch'||m.kind==='cruise')?(S.phase==='move'&&S.cur===pi):abilityPhase(pi)))return;
  const why=worldBlocked(pi,m.kind);
  if(why){sysTo(pi,why);return}
  S.edgeA=null;S.mode=m.kind;sync();
 },
 /* the two clicks that name an edge: a node, then one of its neighbours (for the Silk Road, any other node) */
 async edgepick(pi,m){
  const k=S.mode;
  if(!abilityPhase(pi)||!['chainsaw','brexit','silkroad'].includes(k)||!NMAP[m.id])return;
  const bail=msg=>{sysTo(pi,msg);S.mode=null;S.edgeA=null;sync()};
  const why=worldBlocked(pi,k);
  if(why){bail(why);return}
  if(k!=='silkroad'&&m.a!=null&&NMAP[m.a]&&hasEdge(m.a,m.id))S.edgeA=m.a; /* clicked the thread itself */
  const id=m.id,a=S.edgeA;
  if(a==null||!NMAP[a]){
   if(k==='silkroad'&&S.owner[id]!==pi){sysTo(pi,'Start the new road from one of YOUR nodes.');return}
   S.edgeA=id;sync();return;
  }
  if(id===a){S.edgeA=null;sync();return}
  const n1=NMAP[a],n2=NMAP[id],pn=q=>nodeName(q).join(' '),p=S.players[pi];
  if(k==='silkroad'){
   if(hasEdge(a,id)){sysTo(pi,pn(n1)+' and '+pn(n2)+' are already linked.');return}
   p.money-=4;fxAt(pi,'−$4','#ff6b5e');
   commitEdges(EDGES.concat([[a,id]]));
   (S.wTurn||(S.wTurn={})).silkroad=1;S.mode=null;S.edgeA=null;
   fx((n1.x+n2.x)/2,(n1.y+n2.y)/2,'🛤️ NEW ROAD','#f5c542');
   log('🛤️ '+pname(pi)+' pays $4 and opens the NEW SILK ROAD: '+pn(n1)+' ⇄ '+pn(n2)+' — a permanent link, for everyone.');
   await finishNodeAbility(pi);return;
  }
  if(!hasEdge(a,id)){S.edgeA=id;sync();return} /* not a neighbour: start again from here */
  if(!cutKeepsBoardConnected(a,id)){sysTo(pi,'That cut would strand part of the board from Quikstop — pick another edge.');return}
  const chain=k==='chainsaw';
  commitEdges(EDGES.filter(e=>!((e[0]===a&&e[1]===id)||(e[0]===id&&e[1]===a))));
  S.wGame=S.wGame||{};S.wGame[chain?'milei':'brexit']=1;S.mode=null;S.edgeA=null;
  fx((n1.x+n2.x)/2,(n1.y+n2.y)/2,chain?'🪚 CUT':'🇬🇧 SEVERED','#ff6b5e');
  if(chain){
   p.money-=3;fxAt(pi,'−$3','#ff6b5e');
   log('🪚 AFUERA! '+pname(pi)+' pays $3 and takes the chainsaw to the line between '+pn(n1)+' and '+pn(n2)+' — severed for good.');
   gain(pi,4,'the savings from the cut');
  }else{
   log('🇬🇧 TAKE BACK CONTROL! '+pname(pi)+' severs the link between '+pn(n1)+' and '+pn(n2)+' for the rest of the con.');
   addCortisol(pi,1,'the fallout of Brexit',false,true);
  }
  await finishNodeAbility(pi);
 },
 /* THE NIGERIAN PRINCE: pay $2, flip a coin (decided here, host-side) */
 async advance(pi){
  if(!abilityPhase(pi)||S.mode)return;
  const why=worldBlocked(pi,'advance');if(why){sysTo(pi,why);return}
  S.players[pi].money-=2;fxAt(pi,'−$2','#ff6b5e');(S.wTurn||(S.wTurn={})).advance=1;
  if(Math.random()<0.5){log('👑 '+pname(pi)+' wires the $2 advance fee — and the prince delivers! Heads: +$5.');gain(pi,5,'the prince came through')}
  else log('👑 '+pname(pi)+' wires the $2 advance fee. Tails: the prince has gone silent. The inbox is empty.');
  await finishNodeAbility(pi);
 },
 /* BANK OF JAPAN (Mrs Watanabe's carry trade): borrow now, repay (or be punished) at the start of your next turn */
 async carry(pi,m){
  if(!abilityPhase(pi)||S.mode)return;
  const why=worldBlocked(pi,'carry');if(why){sysTo(pi,why);return}
  const loan=Math.max(1,Math.min(CARRY_CAP,Math.floor(Number(m&&m.n)||CARRY_LOAN)));
  S.players[pi].money+=loan;(S.carry||(S.carry={}))[pi]=loan;
  fxAt(pi,'+$'+loan,'#7fe08d');
  log('👛 '+pname(pi)+' borrows $'+loan+' against Tokyo’s zero rates — $'+carryDue(loan)+' is due at the start of their next turn; every $2 short is 1 Cortisol.');
  await finishNodeAbility(pi);
 },
 /* THE BANGALORE CALL CENTRE: put a rival on hold */
 async hold(pi,m){
  if(!abilityPhase(pi)||S.mode!=='hold')return;
  const why=worldBlocked(pi,'hold');
  if(why){sysTo(pi,why);S.mode=null;sync();return}
  if(!isRival(pi,m.target)){sysTo(pi,'Pick a rival in THE SYNDICATE list.');return}
  const t=S.players[m.target];
  if(t.intel<1){sysTo(pi,pname(m.target)+' has no Intel left to lose.');return}
  t.intel-=1;(S.wTurn||(S.wTurn={})).hold=1;S.mode=null;
  fxAt(m.target,'🎧 ON HOLD 🛈−1','#55c1ff');
  log('🎧 '+pname(pi)+' puts '+pname(m.target)+' on hold — your call is important to us. '+pname(m.target)+' loses 1 Intel.');
  await finishNodeAbility(pi);
 },
 /* THE AMAZON: sell carbon credits */
 async carbon(pi){
  if(!abilityPhase(pi)||S.mode)return;
  const why=worldBlocked(pi,'carbon');if(why){sysTo(pi,why);return}
  const cnt=NODES.filter(n=>S.owner[n.id]===pi&&n.type!=='COMMODITY').length;
  (S.wTurn||(S.wTurn={})).carbon=1;
  log('🌳 '+pname(pi)+' sells carbon credits on the canopy: '+cnt+' non-commodity node'+(cnt===1?'':'s')+' × $3.');
  gain(pi,3*cnt,'carbon credits');
  await finishNodeAbility(pi);
 },
 /* THE BERMUDA TRIANGLE: name where you will reappear, then vanish until the start of your next turn */
 async vanish(pi,m){
  if(!abilityPhase(pi)||S.mode!=='vanish')return;
  const why=worldBlocked(pi,'vanish');
  if(why){sysTo(pi,why);S.mode=null;sync();return}
  const n=NMAP[m.id];
  if(!n||blockaded(n.id)||!canReach(n.id)){sysTo(pi,'You cannot reappear there.');return}
  (S.vanished||(S.vanished={}))[pi]=n.id;(S.wTurn||(S.wTurn={})).vanish=1;S.mode=null;
  fxAt(pi,'🌀 VANISHED','#9ad7ff');
  log('🌀 '+pname(pi)+' vanishes into the Bermuda Triangle — untouchable until the start of their next turn, when they reappear at '+nodeName(n).join(' ')+'.');
  await finishNodeAbility(pi);
 },
 /* THE BAIKONUR COSMODROME: once per game, in your move phase, pay $3 and land on ANY node (the Qantas jet, only louder) */
 async launch(pi,m){
  if(S.phase!=='move'||S.cur!==pi||S.mode!=='launch')return;
  const p=S.players[pi],why=worldBlocked(pi,'launch');
  if(why){sysTo(pi,why);S.mode=null;sync();return}
  const n=NMAP[m.id];
  if(!n||n.id===p.pos){sysTo(pi,'Pick somewhere else on the board to land.');return}
  if(!canReach(n.id)){sysTo(pi,qantasGroundedReason()+' — you cannot land there yet.');return}
  if(blockaded(n.id)){sysTo(pi,nodeName(n).join(' ')+' is BLOCKADED — you cannot land there.');return}
  const from=p.pos;
  p.money-=3;fxAt(pi,'−$3','#ff6b5e');S.mode=null;p.pos=n.id;S.steps=0;(S.wGame||(S.wGame={})).baikonur=1;
  if(!p.visited)p.visited={};p.visited[n.id]=true;
  if(from==='sisy'&&n.id!=='sisy'&&S.owner.back!==pi)S.sisyPayout=10;
  const flew=projFx('fly',from,n.id);
  log('🚀 '+pname(pi)+' pays $3 and rides a Soyuz from the BAIKONUR COSMODROME straight to '+nodeName(n).join(' ')+' — once per game.');
  if(flew){sync();await projPause()}
  await endMovement();
 },
 /* THE IMF: pick a rival, lend $6 of your own money, collect $8 at the start of their next-but-one turn (or +2 Cortisol and a write-off) */
 async bailout(pi,m){
  if(!abilityPhase(pi)||S.mode!=='bailout')return;
  const why=worldBlocked(pi,'bailout');
  if(why){sysTo(pi,why);S.mode=null;sync();return}
  if(!isRival(pi,m.target)){sysTo(pi,'Pick a rival in THE SYNDICATE list.');return}
  if(S.imf&&S.imf[m.target]){sysTo(pi,pname(m.target)+' already carries an IMF loan.');return}
  const t=S.players[m.target];
  S.players[pi].money-=IMF_LOAN;t.money+=IMF_LOAN;(S.imf||(S.imf={}))[m.target]={by:pi,left:2};(S.wTurn||(S.wTurn={})).bailout=1;S.mode=null;
  fxAt(pi,'−$'+IMF_LOAN,'#ff6b5e');fxAt(m.target,'+$'+IMF_LOAN,'#7fe08d');
  log('🆘 The IMF bails out '+pname(m.target)+': '+pname(pi)+' lends $'+IMF_LOAN+'. $'+IMF_REPAY+' is due to '+pname(pi)+' at the start of '+pname(m.target)+'’s next-but-one turn, or '+IMF_CORTISOL+' Cortisol (austerity) if they cannot pay.');
  await finishNodeAbility(pi);
 },
 /* THE TARIFF WALL: name the node type that costs rivals $4 extra to seize (and an import duty each turn). A free action: it changes the wall and the phase carries on. */
 async tariff(pi,m){
  const why=worldBlocked(pi,'tariff');
  if(why){sysTo(pi,why);return}
  if(S.mode)return;
  const type=typeof m.kind==='string'?m.kind:null;
  if(!WIN_TYPES.includes(type)){sysTo(pi,'Name one node type: '+WIN_TYPES.join(', ')+'.');return}
  if(S.tariffType===type){sysTo(pi,'The wall already stands on '+type+'.');return}
  S.tariffType=type;(S.wTurn||(S.wTurn={})).tariff=1;
  fxAt(pi,'🧱 '+type,'#f5c542');
  log('🧱 '+pname(pi)+' raises THE TARIFF WALL on '+type+' nodes — every rival who seizes one pays $'+TARIFF_EXTRA+' extra, and $1 a node in IMPORT DUTY each turn (up to $'+TARIFF_DUTY_CAP+'), to '+pname(pi)+'.');
  sync();
 },
 /* THE CRUISE SHIP: from a WATER node, pay $2 and sail to any other WATER node (ends your movement) */
 async cruise(pi,m){
  if(S.phase!=='move'||S.cur!==pi||S.mode!=='cruise')return;
  const p=S.players[pi],why=worldBlocked(pi,'cruise');
  if(why){sysTo(pi,why);S.mode=null;sync();return}
  const n=NMAP[m.id];
  if(!n||n.id===p.pos||!isWaterNode(n.id)){sysTo(pi,'The ship only calls at WATER nodes: pick another strait, island, port or sea.');return}
  if(!canReach(n.id)){sysTo(pi,qantasGroundedReason()+' — you cannot land there yet.');return}
  if(blockaded(n.id)){sysTo(pi,nodeName(n).join(' ')+' is BLOCKADED — the ship cannot dock.');return}
  const from=p.pos;
  p.money-=CRUISE_FARE;fxAt(pi,'−$'+CRUISE_FARE,'#ff6b5e');S.mode=null;p.pos=n.id;S.steps=0;
  if(!p.visited)p.visited={};p.visited[n.id]=true;
  if(from==='sisy'&&n.id!=='sisy'&&S.owner.back!==pi)S.sisyPayout=10;
  log('🛳️ '+pname(pi)+' pays $'+CRUISE_FARE+' and sails the 3,000-berth enclave from '+nodeName(NMAP[from]).join(' ')+' to '+nodeName(n).join(' ')+'.');
  sync();
  await endMovement();
 },
 /* THE DOHA ROUND: start the never-ending round (once per game) */
 async doha(pi){
  if(!abilityPhase(pi)||S.mode)return;
  const why=worldBlocked(pi,'doha');if(why){sysTo(pi,why);return}
  (S.wGame||(S.wGame={})).doha=1;S.doha={by:pi,left:3};
  fxAt(pi,'🕰️ ROUND OPEN','#9ad7ff');
  log('🕰️ '+pname(pi)+' opens a new DOHA ROUND — for the next 3 of their turns they collect $'+DOHA_PER+' per COMMODITY node, then the talks stall.');
  await finishNodeAbility(pi);
 },
 /* SUEZ: the Ever Given, once per game, in your action phase */
 async evergiven(pi){
  if(S.phase!=='action'||S.mode||S.owner.w_suez!==pi||S.evergivenUsed)return;
  const n=NMAP.w_suez;
  if(S.rubble[n.id]||blockaded(n.id)){sysTo(pi,'The canal is already closed.');return}
  S.evergivenUsed=true;S.blockades[n.id]=S.turn+2;
  fx(n.x,n.y-64,'🚢 EVER GIVEN','#f5c542');
  log('🚢 '+pname(pi)+' runs the EVER GIVEN aground in the Suez — BLOCKED until the end of next round: nobody walks in, nobody lands, not even '+pname(pi)+'. (Once per game.)');
  await finishNodeAbility(pi);
 }
};
/* ---- 🤵 JAMES BOND (bond007) — CLASSIFIED ----
   Once per turn, in your move or action phase and for 1 Intel or $3, file any node away: until the end of NEXT round it is drawn as an
   unknown to everyone but its holder and the Bond owner (no name, owner, ability or bugs). It is INFORMATION only: rivals can still walk
   or fly onto it and seize it blind, but cannot pick it as a remote target (bug, missile, overtourism, blockade). Under Fog of War the
   hide also wipes it from every rival's `visited` set — permanently; they must visit it again to rediscover it. It lapses at once if
   Bond changes hands. S.hidden[nid]={by,until} (until is a turn number, like S.blockades). */
export const CLASSIFIED_MONEY=3,CLASSIFIED_INTEL=1;
export function hiddenInfo(nid){const h=S&&S.hidden&&S.hidden[nid];return h&&h.until>S.turn&&S.owner.bond007===h.by?h:null}
/* true when `viewer` may NOT see the node: it is classified and the viewer is neither the filer nor the deed holder */
export function hiddenFrom(viewer,nid){const h=hiddenInfo(nid);return !!h&&viewer!==h.by&&S.owner[nid]!==viewer}
/* the name the shared record may use for a node: a classified site stays nameless */
export function lname(n){return hiddenInfo(n.id)?'a CLASSIFIED site':n.name.join(' ')}
export function classifiedBlocked(pi,pay){
 if(!S||S.over)return 'The game is over.';
 if(S.owner.bond007!==pi)return 'You do not control JAMES BOND.';
 if(S.classifiedUsed)return 'You have already filed something as CLASSIFIED this turn.';
 if(S.phase!=='move'&&S.phase!=='action')return 'Not now.';
 if(pay==='money'){if(S.players[pi].money<CLASSIFIED_MONEY)return 'CLASSIFIED costs $'+CLASSIFIED_MONEY+' (or 1 Intel).'}
 else if(S.players[pi].intel<CLASSIFIED_INTEL)return 'CLASSIFIED costs 1 Intel (or $'+CLASSIFIED_MONEY+').';
 return '';
}
const CLASSIC_ACTS={
 /* enter the targeting mode, paying with Intel (default) or cash */
 async classifiedmode(pi,m){
  if(S.mode)return;
  const pay=m.pay==='money'?'money':'intel',why=classifiedBlocked(pi,pay);
  if(why){sysTo(pi,why);return}
  S.mode='classified';S.classPay=pay;sync();
 },
 /* name the node; a free action, so the phase carries on */
 async classified(pi,m){
  if(S.mode!=='classified')return;
  const pay=S.classPay==='money'?'money':'intel',p=S.players[pi],n=typeof m.id==='string'?NMAP[m.id]:null;
  const why=classifiedBlocked(pi,pay);
  if(why){sysTo(pi,why);S.mode=null;sync();return}
  if(!n){sysTo(pi,'Pick a node to file away.');return}
  if(pay==='money'){p.money-=CLASSIFIED_MONEY;fxAt(pi,'−$'+CLASSIFIED_MONEY,'#ff6b5e')}else{p.intel-=CLASSIFIED_INTEL;fxAt(pi,'🛈−'+CLASSIFIED_INTEL,'#55c1ff')}
  (S.hidden||(S.hidden={}))[n.id]={by:pi,until:S.turn+2};
  S.classifiedUsed=true;S.mode=null;S.classPay=null;
  /* Fog of War: everyone else forgets it (except a rival standing on it right now). Permanent — it must be visited again. */
  if(S.fogOfWar)S.players.forEach((pl,j)=>{if(j!==pi&&pl.visited&&pl.pos!==n.id)delete pl.visited[n.id]});
  fxAt(pi,'🗂️ CLASSIFIED','#9ad7ff');
  log('🤵 '+pname(pi)+' flashes the credentials and files a site under CLASSIFIED until the end of next round'+(S.fogOfWar?' — everyone who had been there forgets the way':'')+'.');
  sync();
 },
};
/* ================= NODE REWORKS =================
   NAB · WESTPAC · COMMONWEALTH BANK · ANZ · QUIKSTOP · THE GOLF CLUB · JIM CHALMERS, and on the Global Edition BAIKONUR · ZIMBABWE · THE SWISS VAULT
   · AREA 51 · THE WALL STREET BELL · THE TURKISH LIRA · THE BAHT 1997 · SRI LANKA · THE PYRAMIDS · GREENLAND.
   Once-per-game flags live in S.wGame, once-per-turn flags in S.nTurn (cleared at every turn start); both ride the synced state.
   The new actives are added to the handler tables below (CLASSIC_ACTS / WORLD_ACTS), never as new `act===` branches. */
export const NAB_FEE=2,SERVO_PER=2,LAUNDER_CASH=3,BREACH_FINE_PCT=15,BELL_COST=2,DELAYS_COST=3,DELAYS_TURNS=2,AT1_PER_NODE=2,ESCAPE_CORTISOL=5,ABDUCT_INTEL=3,ABDUCT_MONEY=4,ABDUCT_RUBBLE=0.5,ZIM_PCT=20,LIRA_PCT=20,LIRA_FLOOR=30;
const gUsed=k=>!!(S&&S.wGame&&S.wGame[k]),gMark=k=>{(S.wGame||(S.wGame={}))[k]=1};
const tUsed=k=>!!(S&&S.nTurn&&S.nTurn[k]),tMark=k=>{(S.nTurn||(S.nTurn={}))[k]=1};
export function inflationExtra(){return S&&S.inflation>0?S.inflation|0:0}
export function addInflation(n,why){if(!S||!(n>0))return;S.inflation=inflationExtra()+n;log('📈 INFLATION'+(why?' — '+why:'')+': every seizure on the board now costs +$'+S.inflation+'.')}
export function pyramidPayout(){return Math.max(1,Number(S&&S.pyramid)||1)}
export function swissBalance(pi){return S&&S.vault&&S.vault[pi]>0?S.vault[pi]:0}
/* 🏦 NAB — FEE FOR NO SERVICE: a rival who ends movement on any node its owner holds pays that owner $2, on top of tolls */
export function nabFee(pi){
 const p=S.players[pi],o=p&&S.owner[p.pos];
 if(o==null||o===pi||S.owner.nab!==o||isVanished(pi)||p.money<=0)return;
 payTo(pi,NAB_FEE,o,'NAB: FEE FOR NO SERVICE for ending the move on '+lname(NMAP[p.pos]));
}
/* 🏦 WESTPAC — 23 MILLION BREACHES: the two books a breach can be filed on (UBS exempts its owner from the banking book) */
export function launderBooks(pi){return ['bank','monetary'].filter(id=>!acccExempt(pi,id)).map(id=>({id,name:INDBYID[id].name,agency:fileAgency(id)}))}
function openBreach(pi,ind,s){
 const f={pi,ind,s:s|0,agency:fileAgency(ind),breach:true};acccFileList().push(f);
 log(fileIcon(f)+' THE '+f.agency+' OPENS A FILE on '+pname(pi)+'’s '+INDBYID[ind].name+' book — a BREACH investigation. Scrutiny '+f.s+'/'+ACCC_RULING+'; the ruling is a fine of '+BREACH_FINE_PCT+'% of their cash.');
 fxAt(pi,'📁 '+f.agency+' FILE','#55c1ff');
 return f;
}
/* a breach file with nothing to divest rules as a fine, and closes */
function breachRuling(pi,f){
 const p=S.players[pi],fine=Math.min(p.money,Math.max(2,Math.floor(p.money*BREACH_FINE_PCT/100)));
 if(fine>0)payVoid(pi,fine,f.agency+' breach fine ('+BREACH_FINE_PCT+'%)');
 const files=acccFileList(),at=files.indexOf(f);if(at>=0)files.splice(at,1);
 log(fileIcon(f)+' BREACH RULING — the '+f.agency+' closes its investigation of '+pname(pi)+'’s '+INDBYID[f.ind].name+' book with a fine of $'+fine+'. The file is closed.');
 fxAt(pi,'📁 BREACH FINE','#55c1ff',true);
 acccReconcile();sync();
}
/* the Wall Street Bell's instant investigation: escalate the rival's worst open file, or open a breach file on the book they lean on most */
function bellInvestigate(pi,t){
 acccReconcile();
 const worst=filesOf(t).slice().sort((a,b)=>b.s-a.s)[0];
 if(worst){worst.s++;log(fileIcon(worst)+' 🔔 The Bell escalates '+fileName(worst)+' — scrutiny '+worst.s+'/'+ACCC_RULING+(worst.s>=ACCC_RULING?'; the ruling lands at their turn start.':'.'));fxAt(t,'📁 +1 SCRUTINY','#55c1ff');return worst}
 const pick=INDUSTRIES.filter(g=>!acccExempt(t,g.id)).map(g=>({g,n:ownedInIndustry(t,g).length})).sort((a,b)=>b.n-a.n)[0];
 if(!pick)return null;
 log('🔔 The Bell opens an instant investigation into '+pname(t)+'.');
 return openBreach(t,pick.g.id,1);
}
/* 🏛️ JIM CHALMERS — TREASURY BRIEF: at your turn start you see the next two events and choose which is drawn next; the other goes back second */
export async function treasuryBrief(pi){
 if(!S||S.over)return;
 if(S.deck.length<2){S.deck=shuffle(S.discard.slice()).concat(S.deck);S.discard=[];log('🎴 The rumor deck is reshuffled.')}
 const n=S.deck.length;if(n<2)return;
 const a=S.deck[n-1],b=S.deck[n-2],ca=CARDBYID[a],cb=CARDBYID[b];
 if(!ca||!cb)return;
 log('🏛️ The Treasurer briefs '+pname(pi)+': two events are on the way.');
 sync();
 const v=await askPlayer(pi,{title:'TREASURY BRIEF — CHOOSE THE NEXT EVENT',html:cardFace(ca)+cardFace(cb)+'<p class="fine">For your eyes only. The first card above is drawn next by default; the other goes back in second place.</p>',options:[{label:'Draw “'+ca.title+'” next, “'+cb.title+'” second',v:a},{label:'Draw “'+cb.title+'” next, “'+ca.title+'” second',v:b}],def:a,timeout:30000,meta:{kind:'treasury',cards:[a,b]}});
 if(!S||S.over)return;
 const m=S.deck.length;
 if(v===b&&S.deck[m-1]===a&&S.deck[m-2]===b){S.deck[m-1]=b;S.deck[m-2]=a;log('🏛️ '+pname(pi)+' re-orders the Treasury’s calendar — the event order has changed.')}
 else log('🏛️ '+pname(pi)+' leaves the calendar as it stands.');
 sync();
}
/* 🏦 ANZ — THE BOND DESK TIP-OFF: whenever BONDMAGEDDON is the next event, the ANZ owner is warned privately (once for each card drawn) */
function anzTip(){
 if(!S||S.over)return;
 const o=S.owner.anz;
 if(o==null||!S.players[o]||!S.deck.length||S.deck[S.deck.length-1]!=='bondrevolt')return;
 if(S.anzTipAt===(S.drawN|0))return;
 S.anzTipAt=S.drawN|0;
 const c=CARDBYID.bondrevolt;
 log('🏦 The Bond Desk tips off '+pname(o)+'.');
 Promise.resolve(askPlayer(o,{title:'ANZ — THE BOND DESK TIP-OFF',html:cardFace(c)+'<p class="fine">BONDMAGEDDON is the very next market event. For your eyes only.</p>',options:[{label:'Noted',v:1}],def:1,timeout:25000,meta:{kind:'brief',card:c.id}})).catch(()=>{});
}
/* 🔺 THE PYRAMIDS: a rival who seizes a node ADJACENT to one of the owner's pays the current payout, which then doubles */
function pyramidPays(pi,nid){
 if(!S.dlcWorld)return;
 const po=S.owner.w_pyramids;
 if(po==null||po===pi||!S.players[po]||(S.rubble&&S.rubble.w_pyramids)||!(ADJ[nid]||[]).some(q=>S.owner[q]===po))return;
 const pay=pyramidPayout(),amt=Math.min(S.players[pi].money,pay);
 if(amt<=0){log('🔺 THE PYRAMIDS: '+pname(pi)+' seizes next to '+pname(po)+'’s holdings but has nothing left to pay.');return}
 payTo(pi,amt,po,'PYRAMID SCHEME: '+lname(NMAP[nid])+' sits next to '+pname(po)+'’s holdings');
 S.pyramid=pay*2;
 log('🔺 The next PYRAMID payout doubles to $'+S.pyramid+'.');
}
/* 🚀 BAIKONUR — ESCAPE ON THE ROCKET: once per game a raid is cancelled; the pawn lifts off to the cosmodrome (or a node of the owner's choice) and Cortisol drops to a moderate level */
function rocketEscape(i){
 if(!S.dlcWorld||S.owner.w_baikonur!==i||gUsed('rocket')||(S.rubble&&S.rubble.w_baikonur)||!NMAP.w_baikonur)return false;
 const p=S.players[i],from=p.pos;
 gMark('rocket');
 const moved=!blockaded('w_baikonur')&&!isVanished(i);
 if(moved){p.pos='w_baikonur';if(!p.visited)p.visited={};p.visited.w_baikonur=true;if(from==='sisy'&&S.owner.back!==i)S.sisyPayout=10}
 p.cortisol=Math.min(p.cortisol,ESCAPE_CORTISOL);
 fx(NMAP.w_baikonur.x,NMAP.w_baikonur.y-70,'🚀 ESCAPED','#9ad7ff',true);
 log('🚀 ESCAPE ON THE ROCKET! The regulators arrive to raid '+pname(i)+' — and find an empty chair. The raid is CANCELLED: '+pname(i)+' is on a Soyuz'+(moved?' to the BAIKONUR COSMODROME':' (the cosmodrome is blockaded, so the pawn stays put)')+', and Cortisol drops to '+p.cortisol+'. (Once per game.)');
 announceAll('🚀 ESCAPE ON THE ROCKET','<div class="eventcard"><div class="eicon">🚀</div><div class="etitle">'+esc(p.name)+' ESCAPES THE RAID</div><div class="etext">Cameras on the driveway, boxes by the door — and the Soyuz already gone. The raid is cancelled.</div></div>');
 if(moved)rocketDestination(i);
 return true;
}
async function rocketDestination(i){
 try{
  const p=S.players[i];
  const v=await askPlayer(i,{title:'ESCAPE ON THE ROCKET — WHERE TO?',body:'The raid is cancelled and the Soyuz is on the pad. Stay at the Cosmodrome, or land somewhere else?',options:[{label:'Stay at the Cosmodrome',v:'stay'},{label:'Pick another node…',v:'pick'}],def:'stay',timeout:25000,meta:{kind:'rocket'}});
  if(v!=='pick'||!S||S.over||p.pos!=='w_baikonur')return;
  const list=NODES.filter(n=>n.id!=='w_baikonur'&&!(S.rubble&&S.rubble[n.id])&&canReach(n.id)&&!blockaded(n.id));
  const id=await askPlayer(i,{title:'ESCAPE ON THE ROCKET — LAND ON…',options:list.map(n=>({label:lname(n)+(S.owner[n.id]!=null&&!hiddenInfo(n.id)?' · '+pname(S.owner[n.id]):''),v:n.id})),def:'w_baikonur',timeout:30000,meta:{kind:'rocket2'}});
  if(!S||S.over||p.pos!=='w_baikonur'||!list.some(n=>n.id===id))return;
  p.pos=id;if(!p.visited)p.visited={};p.visited[id]=true;
  log('🚀 '+pname(i)+' re-routes the Soyuz and lands on '+lname(NMAP[id])+'.');
  sync();
 }catch(e){console.error('[BIGCON] rocket destination',e)}
}
/* 📉 THE BAHT 1997 — CONTAGION: when anyone is raided, every rival of the Baht's owner who owns a node in the region the raided pawn stood in takes +1 Cortisol */
function bahtContagion(i,rgn,b){
 if(b==null||rgn==null||(S.rubble&&S.rubble.w_baht))return;
 const hit=[];
 S.players.forEach((pl,j)=>{if(j===b||j===i||isVanished(j))return;if(NODES.some(n=>S.owner[n.id]===j&&regionOf(n)===rgn))hit.push(j)});
 if(!hit.length)return;
 log('📉 CONTAGION — the raid on '+pname(i)+' in '+REGION_NAMES[rgn]+' spreads from Bangkok: '+hit.map(pname).join(', ')+' hold nodes there.');
 hit.forEach(j=>addCortisol(j,1,'THE BAHT 1997: the contagion reaches '+REGION_NAMES[rgn]));
}
/* why a node-rework active cannot be used right now ('' when it can). Shared by the handlers and the buttons. */
export function reworkBlocked(pi,kind){
 if(!S||S.over)return 'The game is over.';
 const p=S.players[pi];if(!p)return 'No such seat.';
 const own=id=>S.owner[id]===pi&&!(S.rubble&&S.rubble[id]),act=!!abilityPhase(pi),either=S.phase==='move'||S.phase==='action';
 const w=!!S.dlcWorld,need=id=>NMAP[id]?'You do not control '+nodeName(NMAP[id]).join(' ')+'.':'That node is not on this board.';
 switch(kind){
  case 'launder':
   if(!own('westpac'))return need('westpac');if(!either)return 'Not now.';if(tUsed('launder'))return 'You already laundered this turn.';
   if(p.intel<1)return 'Laundering burns 1 Intel.';
   if(!launderBooks(pi).length)return 'Your books are shielded — there is no file for the breach to open.';
   return '';
  case 'golf':
   if(!own('golf'))return need('golf');if(S.phase!=='action'||S.mode)return 'The Back Nine is played in your action phase.';if(tUsed('golf'))return 'You already proposed a swap this turn.';
   if(!NODES.some(n=>S.owner[n.id]===pi&&!(S.rubble&&S.rubble[n.id])))return 'You have no node to offer.';
   if(!S.players.some((x,j)=>isRival(pi,j)&&NODES.some(n=>S.owner[n.id]===j&&!(S.rubble&&S.rubble[n.id])&&!hiddenFrom(pi,n.id))))return 'No rival holds a node you could ask for.';
   return '';
  case 'printmoney':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!own('w_zim'))return need('w_zim');if(!act)return 'Printing money is your action.';if(gUsed('zim'))return 'The presses have already run: once per game.';return '';
  case 'swissdeposit':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!own('w_swiss'))return need('w_swiss');if(!act)return 'Depositing is your action.';if(p.money<1)return 'You have no cash to stash.';return '';
  case 'swisswithdraw':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!either)return 'Not now.';if(swissBalance(pi)<=0)return 'Your numbered account is empty.';if(tUsed('swiss'))return 'You already withdrew this turn.';return '';
  case 'abduct':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!own('w_area51'))return need('w_area51');if(!act)return 'Abduction is your action.';if(gUsed('area51'))return 'The mothership has already visited: once per game.';
   if(p.intel<ABDUCT_INTEL)return 'An abduction costs '+ABDUCT_INTEL+' Intel and $'+ABDUCT_MONEY+'.';if(p.money<ABDUCT_MONEY)return 'An abduction costs '+ABDUCT_INTEL+' Intel and $'+ABDUCT_MONEY+'.';
   if(!NODES.some(n=>!abductBlocked(pi,n.id)))return 'There is no rival node the aliens can take.';return '';
  case 'ringbell':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!own('w_bell'))return need('w_bell');if(!act)return 'Ringing the Bell is your action.';if(tUsed('bell'))return 'You already rang the Bell this turn.';
   if(p.money<BELL_COST)return 'Ringing the Bell costs $'+BELL_COST+'.';if(!S.players.some((x,j)=>isRival(pi,j)))return 'There is no rival to investigate.';return '';
  case 'delays':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!own('w_db'))return need('w_db');if(!act)return 'DELAYS is your action.';if(tUsed('delays'))return 'You already delayed someone this turn.';
   if(p.money<DELAYS_COST)return 'DELAYS costs $'+DELAYS_COST+'.';if(!delayTargets(pi).length)return 'Every rival is already delayed.';return '';
  case 'at1':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!own('w_cs'))return need('w_cs');if(!act)return 'The AT1 WIPE-OUT is your action.';if(gUsed('at1'))return 'The AT1 bonds have already been wiped: once per game.';
   if(!S.players.some((x,j)=>isRival(pi,j)))return 'There is no rival to wipe out.';return '';
  case 'lira':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!own('w_lira'))return need('w_lira');if(!act)return 'ERDOĞANOMICS is your action.';if(gUsed('lira'))return 'The rate cut has already happened: once per game.';return '';
  case 'srilankadefault':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!own('w_srilanka'))return need('w_srilanka');if(!either)return 'Not now.';if(gUsed('srilanka'))return 'The default has already been declared: once per game.';return '';
  case 'liberate':
   if(!w)return 'The Global Edition exhibits are not in play.';
   for(const id of LIBERATORS)if(!own(id))return need(id);
   if(!act)return 'Liberating the oil is your action.';if(gUsed('liberate'))return 'The oil has already been liberated: once per game.';
   if(!oilStanding().some(id=>S.owner[id]!=null))return 'Nobody owns any oil to liberate.';return '';
  case 'black':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!CASINOS.some(own))return 'You do not own a casino (MONACO or MARINA BAY SANDS).';
   if(!either||S.cur!==pi)return 'Not now.';if(tUsed('black'))return 'One spin a turn: the wheel has already turned for you.';if(p.money<1)return 'You have nothing to bet.';return '';
  case 'biggamble':
   if(!w)return 'The Global Edition exhibits are not in play.';
   for(const id of ['w_pyramids','sisy'])if(!own(id))return need(id);
   if(!CASINOS.some(own))return 'You also need a casino: MONACO or MARINA BAY SANDS.';
   if(!act)return 'THE BIG GAMBLE is your action.';if(gUsed('biggamble'))return 'The big gamble has already been played: once per game.';
   if(!bigGamblePlan(pi))return 'There is nothing to reshuffle.';return '';
  case 'honeypot':
   if(!w)return 'The Global Edition exhibits are not in play.';if(!own('w_jensen'))return need('w_jensen');if(!act)return 'The HONEYPOT is your action.';if(gUsed('honeypot'))return 'The honeypot has already been set: once per game.';
   if(!honeypotPicks(pi).length)return 'There is no Chinese node to take.';return '';
  case 'greenbuy':{
   if(!w)return 'The Global Edition exhibits are not in play.';if(!own('trump'))return need('trump');if(!act)return 'Making an offer is your action.';if(gUsed('greenland'))return 'You have already made your offer: once per game.';
   const g=NMAP.w_greenland,o=S.owner.w_greenland;
   if(!g)return need('w_greenland');if(S.rubble&&S.rubble.w_greenland)return 'Greenland is rubble.';if(o==null)return 'Nobody owns Greenland — just seize it.';if(o===pi)return 'You already own Greenland.';
   if(p.money<g.cost)return 'Greenland’s list price is $'+g.cost+'.';
   return '';}
 }
 return 'Unknown ability.';
}
/* 🛢️ LIBERATE OIL: the standing oil nodes on this board */
function oilStanding(){return OIL_ALL.filter(id=>NMAP[id]&&!(S.rubble&&S.rubble[id]))}
const byPay=(a,b)=>(NMAP[b].income-NMAP[a].income)||(NMAP[b].cost-NMAP[a].cost)||(a<b?-1:1);
/* the split LIBERATE OIL would make right now: mine (sold to the market), taken (rival oil that comes to me), freed (rival oil that goes unowned) */
/* 🛢️ LIBERATE OIL on screen — bigger than BONDMAGEDDON: missiles from DONALD TRUMP and BIG YAHU rain on every oil field in the world,
   then LOCKHEED MARTIN scrambles F-35s that sweep the fields and fly the flag over the rest of the map. Launches are staggered inside one
   sync; the host holds the turn until the last one lands, then every oil field takes a hit. */
export const LIBERATE_FLIGHT_MS=1600;
export async function liberateBarrage(pi){
 const oil=oilStanding(),src=['trump','w_bigyahu'].filter(id=>NMAP[id]),jet=NMAP.w_lockheed?'w_lockheed':null;
 if(!oil.length)return;
 const ny=NMAP.trump,yh=NMAP.w_bigyahu,lm=NMAP.w_lockheed;
 if(ny)fx(ny.x,ny.y-64,'🇺🇸 FREEDOM','#7fb2ff',true);
 if(yh)fx(yh.x,yh.y-64,'🚀 LAUNCH','#f5c542',true);
 let n=0,last=0;
 /* wave 1: every oil field gets a missile from each launcher */
 oil.forEach((id,i)=>src.forEach((s,k)=>{const dl=i*110+k*55;if(projFx('missile',s,id,{delay:dl,dur:LIBERATE_FLIGHT_MS}))n++;last=Math.max(last,dl)}));
 if(jet){
  if(lm)fx(lm.x,lm.y-64,'✈️ SCRAMBLE THE F-35s','#9ad7ff',true);
  /* wave 2: the F-35s sweep every field, then fan out across the map */
  const t0=last+500,far=shuffle(NODES.filter(x=>!oil.includes(x.id)&&x.id!==jet&&x.id.startsWith('w_')).map(x=>x.id)).slice(0,8);
  oil.concat(far).forEach((id,i)=>{const dl=t0+i*90;if(projFx('f35',jet,id,{delay:dl,dur:LIBERATE_FLIGHT_MS+300}))n++;last=Math.max(last,dl+300)});
 }
 if(!n)return;
 sync();await projPause(last+LIBERATE_FLIGHT_MS+200);
 oil.forEach(id=>{const x=NMAP[id];fx(x.x,x.y-50,'💥','#ff6b5e',true)});
 sync();
}
export function liberatePlan(pi){
 const oil=oilStanding(),mine=oil.filter(id=>S.owner[id]===pi);
 const theirs=oil.filter(id=>S.owner[id]!=null&&S.owner[id]!==pi&&!hiddenFrom(pi,id)&&!isPillarShieldedNode(id)).sort(byPay);
 const k=Math.ceil(theirs.length/2);
 return {mine,taken:theirs.slice(0,k),freed:theirs.slice(k)};
}
/* 🎲 THE BIG GAMBLE (THE PYRAMIDS + THE SISYPHUS BOULDER + a casino, once per game, your action): every owned node on the board is
   dealt out again at once. Each player keeps the same NUMBER of nodes, but who holds what is shuffled. The gambler loses the very nodes
   that made the play (the Pyramids, the Boulder and their casino(s)), and nobody is dealt all of them together. Returns {nodeId: newOwner}
   or null when there is nothing to shuffle. */
export function bigGambleTrio(pi){return ['w_pyramids','sisy'].concat(CASINOS.filter(id=>S.owner[id]===pi))}
export function bigGamblePlan(pi){
 const trio=bigGambleTrio(pi);
 const ids=Object.keys(S.owner).filter(id=>S.owner[id]!=null&&NMAP[id]&&!(S.rubble&&S.rubble[id])).sort();
 if(ids.length<2)return null;
 const owners=ids.map(id=>S.owner[id]);
 const ok=plan=>!trio.some(id=>plan[id]===pi)&&!S.players.some((x,j)=>trio.every(id=>plan[id]===j));
 let plan=null;
 for(let t=0;t<600&&!plan;t++){const perm=shuffle(owners.slice()),pl={};ids.forEach((id,i)=>{pl[id]=perm[i]});if(ok(pl))plan=pl}
 if(!plan){ /* no fair deal exists (say the gambler owns nearly everything): the trio goes back to the market instead */
  plan={};const perm=shuffle(owners.slice());ids.forEach((id,i)=>{plan[id]=perm[i]});
  trio.forEach(id=>{if(plan[id]===pi)plan[id]=null});
  if(!ok(plan))trio.forEach(id=>{plan[id]=null});
 }
 return plan;
}
/* 🧥 HONEYPOT: the (up to) two Chinese nodes Jensen would take — unowned first, then a rival's (honouring every takeover guard), the best-paying first */
export function honeypotPicks(pi){
 const ids=CHINA_NODES.filter(id=>NMAP[id]&&!(S.rubble&&S.rubble[id]));
 const free=ids.filter(id=>S.owner[id]==null&&!hiddenFrom(pi,id)).sort(byPay);
 const rival=ids.filter(id=>S.owner[id]!=null&&!abductBlocked(pi,id)).sort(byPay);
 return free.concat(rival).slice(0,2);
}
/* 🧥 HONEYPOT: the buying ban — South-East Asia (and the Strait of Malacca) and the USA, for the seat's next two turns */
export const HONEYPOT_TURNS=2,HONEYPOT_ROUNDS=2;
const US_BAN=new Set(US_NODES);
/* 🚆 DEUTSCHE BAHN — rivals who can still be delayed (not already carrying a delay) */
export function delayTargets(pi){return S.players.map((x,j)=>j).filter(j=>isRival(pi,j)&&!(S.delays&&S.delays[j]>0))}
/* 🏔️ UBS — AT1 WIPE-OUT: what each rival would owe (BANK and CHART nodes held, $2 each, capped at their cash) */
export function at1Bill(pi){
 return S.players.map((x,j)=>j).filter(j=>isRival(pi,j)).map(j=>{
  const k=NODES.filter(n=>S.owner[n.id]===j&&!(S.rubble&&S.rubble[n.id])&&(n.type==='BANK'||n.type==='CHART')).length;
  return {j,k,pay:Math.min(S.players[j].money,k*AT1_PER_NODE)};
 });
}
export function honeypotBan(pi,nid){
 if(!S||!S.dlcWorld||!S.honeyBan||!(S.honeyBan[pi]>rtick()))return '';
 const n=NMAP[nid];if(!n)return '';
 const r=regionOf(n);
 if(r==='SEA'||r==='MAL')return 'HONEYPOT — you are banned from buying anything in South-East Asia for now.';
 if(US_BAN.has(nid))return 'HONEYPOT — you are banned from buying anything in the USA for now.';
 return '';
}
/* 👽 AREA 51: why a node cannot be abducted ('' when it can). It honours every existing takeover guard: Antarctica, MADE, the Commonwealth Bank's unused refusal,
   the Svalbard owner's rubble protection and the ESG Pillars shield, and CLASSIFIED sites you cannot see. */
export function abductBlocked(pi,nid){
 const n=NMAP[nid],o=S.owner[nid];
 if(!n)return 'No such node.';
 if(o==null||!isRival(pi,o))return 'Pick a node a rival owns.';
 if(S.rubble&&S.rubble[nid])return 'That node is rubble.';
 if(hiddenFrom(pi,nid))return 'You cannot target a CLASSIFIED site.';
 if(noTakeover(nid))return nodeName(n).join(' ')+' is UNTOUCHABLE.';
 if(nid==='made')return 'MADE has its own rules — the aliens cannot take it.';
 if(S.owner.commbank===o&&!(S.rubble&&S.rubble.commbank)&&!gUsed('cba'))return pname(o)+' holds the COMMONWEALTH BANK and may still refuse a takeover — the aliens cannot take their nodes yet.';
 if(rubbleShielded(nid))return 'The SEED VAULT protects that holding from anything that could turn it to rubble.';
 if(isPillarShieldedNode(nid))return 'ESG SHIELD — that holding is protected while its owner controls the Pillars.';
 return '';
}
export function abductTargets(pi){return NODES.filter(n=>!abductBlocked(pi,n.id))}
/* two nodes change hands: bugs on them are cleared, the boulder resets, a live overtourism on them lapses */
function handOver(nid,to){
 if(to==null)delete S.owner[nid];else S.owner[nid]=to;
 delete S.bugs[nid];if(nid==='sisy')S.sisyPayout=10;if(S.ov&&S.ov.nid===nid)S.ov=null;
}
/* 🏛️ THE GOLF CLUB — THE BACK NINE: swap one of your nodes for a rival's (plus cash either way), if they agree */
export function golfSwapError(pi,t,mineId,theirId,cash){
 const p=S.players[pi],rt=S.players[t],mine=NMAP[mineId],theirs=NMAP[theirId];
 if(!isRival(pi,t))return 'Offer the swap to a rival at the table.';
 if(!mine||S.owner[mineId]!==pi||(S.rubble&&S.rubble[mineId]))return 'Offer one of your own nodes.';
 if(!theirs||S.owner[theirId]!==t||(S.rubble&&S.rubble[theirId])||hiddenFrom(pi,theirId))return 'Ask for a node that rival owns.';
 if(!Number.isInteger(cash)||cash>9999||cash<-9999)return 'Name a whole-dollar sweetener.';
 if(cash>0&&p.money<cash)return 'You cannot cover the $'+cash+' sweetener.';
 if(cash<0&&rt.money<-cash)return pname(t)+' cannot cover the $'+(-cash)+' you are asking for.';
 const after=id=>id===mineId?t:id===theirId?pi:S.owner[id];
 if(S.dlcGeo&&[pi,t].some(x=>after('geo_missile')===x&&after('geo_shahed')===x))return 'That swap would leave one player owning both MISSILE COMMAND and the SHAHED DRONE.';
 return '';
}
const CLASSIC_REWORKS={
 /* 🏦 WESTPAC — 23 MILLION BREACHES: a free action, once per turn: 1 Intel becomes $3, and an ASIC/ACCC file on you gains +1 scrutiny (opened if need be) */
 async launder(pi,m){
  if(S.mode)return;
  const why=reworkBlocked(pi,'launder');if(why){sysTo(pi,why);return}
  const p=S.players[pi],books=launderBooks(pi),open=books.find(b=>findFile(pi,b.id));
  let ind=typeof m.kind==='string'&&books.some(b=>b.id===m.kind)?m.kind:null;
  if(!ind){
   if(books.length===1)ind=books[0].id;
   else{
    const v=await askPlayer(pi,{title:'23 MILLION BREACHES — WHICH BOOK?',body:'Laundering turns 1 Intel into $'+LAUNDER_CASH+' and adds +1 scrutiny to a regulator file on you. Which book does the breach land on?',options:books.map(b=>({label:b.name+' ('+b.agency+')'+(findFile(pi,b.id)?' — file already open':''),v:b.id})),def:(open||books[0]).id,timeout:20000});
    ind=books.some(b=>b.id===v)?v:(open||books[0]).id;
   }
  }
  if(!S||S.over||S.cur!==pi||S.mode||reworkBlocked(pi,'launder')){sysTo(pi,'The laundering is no longer available.');return}
  p.intel-=1;p.money+=LAUNDER_CASH;tMark('launder');
  fxAt(pi,'🛈−1 · +$'+LAUNDER_CASH,'#7fe08d');
  log('🧺 23 MILLION BREACHES — '+pname(pi)+' launders 1 Intel into $'+LAUNDER_CASH+'.');
  acccReconcile();
  const f=findFile(pi,ind)||openBreach(pi,ind,0);
  f.s++;log(fileIcon(f)+' '+fileName(f)+' gains +1 scrutiny from the laundering — now '+f.s+'/'+ACCC_RULING+'.');
  fxAt(pi,'📁 +1 SCRUTINY','#55c1ff');
  sync();
 },
 /* 🏛️ THE GOLF CLUB — THE BACK NINE (free action, once per turn): m.target = rival, m.id = your node, m.kind = their node, m.n = cash you add (negative: you ask for cash) */
 async golftrade(pi,m){
  if(S.mode)return;
  const why=reworkBlocked(pi,'golf');if(why){sysTo(pi,why);return}
  const t=m.target,mineId=typeof m.id==='string'?m.id:null,theirId=typeof m.kind==='string'?m.kind:null,cash=m.n===undefined||m.n===null?0:m.n;
  const err=golfSwapError(pi,t,mineId,theirId,cash);if(err){sysTo(pi,err);return}
  const mine=NMAP[mineId],theirs=NMAP[theirId],nm=nodeName(mine).join(' '),tn=nodeName(theirs).join(' ');
  tMark('golf');
  const sweet=cash>0?' plus $'+cash+' from '+pname(pi):cash<0?' and $'+(-cash)+' from '+pname(t)+' to '+pname(pi):'';
  log('⛳ THE BACK NINE — '+pname(pi)+' proposes to '+pname(t)+': '+nm+' for '+tn+sweet+'.');
  sync();
  const v=await askPlayer(t,{title:'THE BACK NINE — SWAP OFFER',body:pname(pi)+' offers you '+nm+' ('+mine.type+', $'+mine.income+'/turn, list $'+mine.cost+') for your '+tn+' ('+theirs.type+', $'+theirs.income+'/turn, list $'+theirs.cost+')'+(cash>0?', and adds $'+cash+' to sweeten it':cash<0?', and asks you to add $'+(-cash)+'':'')+'. Bugs on both nodes are cleared. No Cortisol either way.',options:[{label:'Accept the swap',v:1},{label:'Decline',v:0}],def:0,timeout:30000,meta:{kind:'golf',from:pi,give:mineId,take:theirId,cash:-cash}});
  if(!S||S.over||S.cur!==pi)return;
  if(v!==1){log('⛳ '+pname(t)+' declines the swap — both nodes stay put.');sync();return}
  const err2=golfSwapError(pi,t,mineId,theirId,cash);
  if(err2){log('⛳ The swap falls through — '+err2);sync();return}
  handOver(mineId,t);handOver(theirId,pi);
  if(cash>0){S.players[pi].money-=cash;S.players[t].money+=cash;fxAt(pi,'−$'+cash,'#ff6b5e');fxAt(t,'+$'+cash,'#7fe08d')}
  else if(cash<0){S.players[t].money+=cash;S.players[pi].money-=cash;fxAt(t,'−$'+(-cash),'#ff6b5e');fxAt(pi,'+$'+(-cash),'#7fe08d')}
  fx(mine.x,mine.y-64,'⛳ SWAPPED',S.players[t].color);fx(theirs.x,theirs.y-64,'⛳ SWAPPED',S.players[pi].color);
  log('⛳ DEAL DONE — '+pname(t)+' takes '+nm+' and '+pname(pi)+' takes '+tn+sweet+'. Bugs on both are cleared.');
  acccReconcile();sync();
  await winCheck();
 },
};
Object.assign(CLASSIC_ACTS,CLASSIC_REWORKS);
const WORLD_REWORKS={
 /* 🚆 DEUTSCHE BAHN — DELAYS ($3, your action, once per turn): a rival moves at most 1 space for their next two turns */
 async delays(pi,m){
  if(S.mode)return;
  const why=reworkBlocked(pi,'delays');if(why){sysTo(pi,why);return}
  if(!isRival(pi,m.target)){sysTo(pi,'Pick a rival in THE SYNDICATE list.');return}
  if(S.delays&&S.delays[m.target]>0){sysTo(pi,pname(m.target)+' is already delayed.');return}
  S.players[pi].money-=DELAYS_COST;tMark('delays');fxAt(pi,'🚆 −$'+DELAYS_COST,'#f5c542');
  (S.delays||(S.delays={}))[m.target]=DELAYS_TURNS;
  const d=NMAP.w_db;if(d)fx(d.x,d.y-64,'🚆 DELAYED','#f5c542');
  log('🚆 DELAYS — '+pname(pi)+' (DEUTSCHE BAHN) pays $'+DELAYS_COST+': '+pname(m.target)+' can only move 1 space for their next '+DELAYS_TURNS+' turns. We apologise for the inconvenience.');
  sync();
  await finishNodeAbility(pi);
 },
 /* 🏔️ UBS — AT1 WIPE-OUT (once per game, your action): every rival pays $2 per BANK or CHART node they hold */
 async at1(pi){
  if(S.mode)return;
  const why=reworkBlocked(pi,'at1');if(why){sysTo(pi,why);return}
  gMark('at1');
  const c=NMAP.w_cs;if(c)fx(c.x,c.y-64,'🏔️ AT1 WIPED','#f5c542');
  log('🏔️ AT1 WIPE-OUT — '+pname(pi)+' (UBS) writes the Credit Suisse AT1 bonds down to zero: every rival pays $'+AT1_PER_NODE+' for each BANK or CHART node they hold. (Once per game.)');
  let total=0;
  at1Bill(pi).forEach(({j,k,pay})=>{
   if(pay>0){payTo(j,pay,pi,'AT1 bondholders take the loss ('+k+' BANK/CHART node'+(k===1?'':'s')+')');total+=pay}
   else log('🏔️ '+pname(j)+' holds '+(k?k+' BANK/CHART node'+(k===1?'':'s')+' but no cash':'no BANK or CHART nodes')+' — nothing to wipe out.');
  });
  sync();
  if(await winCheck())return;
  await finishNodeAbility(pi);
 },
 /* 🧾 ZIMBABWE — PRINT MONEY: once per game, 20% of the goal in cash; from then on every seizure on the board costs +$1 more */
 async printmoney(pi){
  if(S.mode)return;
  const why=reworkBlocked(pi,'printmoney');if(why){sysTo(pi,why);return}
  gMark('zim');
  const amt=Math.max(1,Math.round(goalAmount()*ZIM_PCT/100));
  fxAt(pi,'🧾 PRINT','#f5c542');
  gain(pi,amt,'the presses run: '+ZIM_PCT+'% of the $'+goalAmount()+' target');
  addInflation(1,pname(pi)+' prints money');
  await finishNodeAbility(pi);
 },
 /* 🔒 THE SWISS VAULT — NUMBERED ACCOUNT. Deposit (your action, any amount, m.n); withdraw (free, once per turn, anywhere, all or m.n) */
 async swissdeposit(pi,m){
  if(S.mode)return;
  const why=reworkBlocked(pi,'swissdeposit');if(why){sysTo(pi,why);return}
  const p=S.players[pi],n=Number.isInteger(m.n)?m.n:0;
  if(n<1||n>p.money){sysTo(pi,'Name a whole-dollar amount from $1 to your cash ($'+p.money+').');return}
  p.money-=n;(S.vault||(S.vault={}))[pi]=swissBalance(pi)+n;
  fxAt(pi,'🔒 −$'+n,'#9ad7ff');
  log('🔒 NUMBERED ACCOUNT — '+pname(pi)+' stashes $'+n+' in the Swiss vault (balance $'+S.vault[pi]+'). Raids, fines, events and loans cannot touch it, and it does not count toward the goal until withdrawn.');
  await finishNodeAbility(pi);
 },
 async swisswithdraw(pi,m){
  if(S.mode)return;
  const why=reworkBlocked(pi,'swisswithdraw');if(why){sysTo(pi,why);return}
  const bal=swissBalance(pi),n=Number.isInteger(m.n)&&m.n>=1?Math.min(m.n,bal):bal;
  S.vault[pi]=bal-n;S.players[pi].money+=n;tMark('swiss');
  fxAt(pi,'🔓 +$'+n,'#7fe08d');
  log('🔓 NUMBERED ACCOUNT — '+pname(pi)+' withdraws $'+n+' from the Swiss vault (balance $'+S.vault[pi]+'). A free action.');
  sync();
  await winCheck();
 },
 /* 👽 AREA 51 — ALIEN ABDUCTION (once per game, $4 + 3 Intel, your action): m.target = rival, m.id = their node. 50%: it arrives intact; 50%: it arrives as rubble */
 async abduct(pi,m){
  if(S.mode)return;
  const why=reworkBlocked(pi,'abduct');if(why){sysTo(pi,why);return}
  const nid=typeof m.id==='string'?m.id:null,bad=nid?abductBlocked(pi,nid):'Pick a node.';
  if(bad){sysTo(pi,bad);return}
  if(Number.isInteger(m.target)&&S.owner[nid]!==m.target){sysTo(pi,'That node is not that rival’s.');return}
  const p=S.players[pi],n=NMAP[nid],prev=S.owner[nid];
  p.money-=ABDUCT_MONEY;p.intel-=ABDUCT_INTEL;gMark('area51');
  fxAt(pi,'−$'+ABDUCT_MONEY+' · 🛈−'+ABDUCT_INTEL,'#ff6b5e');
  const rubble=Math.random()<ABDUCT_RUBBLE;
  fx(n.x,n.y-70,'👽 ABDUCTED','#9dffb0',true);
  if(rubble){
   handOver(nid,null);S.rubble[nid]=1;
   log('👽 ALIEN ABDUCTION! '+pname(pi)+' beams up '+lname(n)+' from '+pname(prev)+' — and it arrives as RUBBLE. Nobody owns it; it must be rebuilt for $'+n.cost+'. (Once per game.)');
  }else{
   handOver(nid,pi);S.seizeCount[nid]=(S.seizeCount[nid]||0)+1;
   log('👽 ALIEN ABDUCTION! '+pname(pi)+' beams up '+lname(n)+' from '+pname(prev)+' — it arrives INTACT. (Once per game.)');
   addCortisol(pi,2,'an alien abduction');
  }
  acccReconcile();sync();
  if(await winCheck())return;
  await finishNodeAbility(pi);
 },
 /* 🔔 THE WALL STREET BELL — RING THE BELL ($2, your action, once per turn): the next market event resolves now, and a rival's regulator file opens or escalates */
 async ringbell(pi,m){
  if(S.mode)return;
  const why=reworkBlocked(pi,'ringbell');if(why){sysTo(pi,why);return}
  if(!isRival(pi,m.target)){sysTo(pi,'Pick a rival in THE SYNDICATE list.');return}
  const p=S.players[pi];
  p.money-=BELL_COST;tMark('bell');fxAt(pi,'🔔 −$'+BELL_COST,'#f5c542');
  log('🔔 '+pname(pi)+' RINGS THE BELL — the next market event is drawn right now, and the regulators open the books on '+pname(m.target)+'.');
  bellInvestigate(pi,m.target);
  const card=drawCard();
  await resolveEvent(card);
  acccReconcile();sync();
  if(await winCheck())return;
  await finishNodeAbility(pi);
 },
 /* 💸 THE TURKISH LIRA — ERDOĞANOMICS (once per game, your action): every rival loses 20% of their cash above $30 */
 async lira(pi){
  if(S.mode)return;
  const why=reworkBlocked(pi,'lira');if(why){sysTo(pi,why);return}
  gMark('lira');
  log('💸 ERDOĞANOMICS — '+pname(pi)+' cuts rates to fight inflation. Every rival loses '+LIRA_PCT+'% of their cash above $'+LIRA_FLOOR+'.');
  S.players.forEach((pl,j)=>{if(!isRival(pi,j))return;const cut=Math.floor(Math.max(0,pl.money-LIRA_FLOOR)*LIRA_PCT/100);if(cut>0)payVoid(j,cut,'the lira falls through the floor');else log('💸 '+pname(j)+' holds $'+pl.money+' — nothing above $'+LIRA_FLOOR+', nothing lost.')});
  await finishNodeAbility(pi);
 },
 /* 🍃 SRI LANKA — DEFAULT (free, once per game): every debt is wiped and this turn's tolls are free */
 async srilankadefault(pi){
  if(S.mode)return;
  const why=reworkBlocked(pi,'srilankadefault');if(why){sysTo(pi,why);return}
  gMark('srilanka');
  const wiped=[];
  if(S.imf&&S.imf[pi]){delete S.imf[pi];wiped.push('the IMF loan')}
  if(S.carry&&S.carry[pi]){delete S.carry[pi];wiped.push('the Bank of Japan carry trade')}
  S.tollFree=pi;
  fxAt(pi,'🍃 DEFAULT','#9ad7ff');
  log('🍃 DEFAULT — '+pname(pi)+' stops paying: '+(wiped.length?wiped.join(' and ')+' wiped out':'no debts to wipe')+', and every toll '+pname(pi)+' would owe this turn is free. (Once per game.)');
  sync();
 },
 /* 🇬🇱 GREENLAND — MAKE AN OFFER (once per game, your action, with DONALD TRUMP): buy Greenland from its owner at list price; they cannot refuse */
 async greenbuy(pi){
  if(S.mode)return;
  const why=reworkBlocked(pi,'greenbuy');if(why){sysTo(pi,why);return}
  const p=S.players[pi],n=NMAP.w_greenland,prev=S.owner.w_greenland;
  gMark('greenland');
  p.money-=n.cost;S.players[prev].money+=n.cost;
  fxAt(pi,'−$'+n.cost,'#ff6b5e');fxAt(prev,'+$'+n.cost,'#7fe08d');
  handOver('w_greenland',pi);S.seizeCount.w_greenland=(S.seizeCount.w_greenland||0)+1;
  fx(n.x,n.y-64,'🇬🇱 SOLD','#f5c542');
  log('🇬🇱 MAKE AN OFFER — '+pname(pi)+' (with DONALD TRUMP behind them) buys GREENLAND from '+pname(prev)+' at its $'+n.cost+' list price. “It is not for sale.” It was. The seller cannot refuse. (Once per game.)');
  acccReconcile();sync();
  if(await winCheck())return;
  await finishNodeAbility(pi);
 },
 /* 🛢️ BIG YAHU — LIBERATE OIL (once per game, your action, with DONALD TRUMP and LOCKHEED MARTIN): every oil node is divested.
    Your own are sold to the market at list price; of your rivals' you take half (rounded up, the best-paying first) and the rest go unowned. */
 async liberate(pi){
  if(S.mode)return;
  const why=reworkBlocked(pi,'liberate');if(why){sysTo(pi,why);return}
  const p=S.players[pi],pl=liberatePlan(pi),nm=id=>nodeName(NMAP[id]).join(' ');
  gMark('liberate');
  await liberateBarrage(pi);
  let cash=0;pl.mine.forEach(id=>{cash+=NMAP[id].cost;handOver(id,null)});
  if(cash){p.money+=cash;fxAt(pi,'+$'+cash,'#7fe08d')}
  const from={};pl.taken.forEach(id=>{const o=S.owner[id];(from[o]||(from[o]=[])).push(nm(id));handOver(id,pi);S.seizeCount[id]=(S.seizeCount[id]||0)+1});
  pl.freed.forEach(id=>handOver(id,null));
  const b=NMAP.w_bigyahu;if(b)fx(b.x,b.y-64,'🛢️ LIBERATED','#f5c542');
  log('🛢️ LIBERATE OIL — '+pname(pi)+' (BIG YAHU, DONALD TRUMP and LOCKHEED MARTIN) brings freedom to the oil fields. '
   +(pl.mine.length?pname(pi)+' divests '+pl.mine.map(nm).join(', ')+' to the market for $'+cash+'. ':'')
   +(pl.taken.length?'Liberated into '+pname(pi)+'’s hands: '+Object.keys(from).map(o=>from[o].join(', ')+' (from '+pname(+o)+')').join('; ')+'. ':'')
   +(pl.freed.length?'Set free (unowned): '+pl.freed.map(nm).join(', ')+'. ':'')+'(Once per game.)');
  acccReconcile();sync();
  if(await winCheck())return;
  await finishNodeAbility(pi);
 },
 /* 🎰 PUT IT ALL ON BLACK (own MONACO or MARINA BAY SANDS; free, once per turn): bet m.n — 47% it pays double, otherwise the house keeps it */
 async black(pi,m){
  if(S.mode)return;
  const why=reworkBlocked(pi,'black');if(why){sysTo(pi,why);return}
  const p=S.players[pi],green=!!(m&&m.color==='green'),bet=green?p.money:Math.floor(Number(m&&m.n)||0);
  if(bet<1||bet>p.money){sysTo(pi,'Bet between $1 and your $'+p.money+'.');return}
  tMark('black');
  const house=CASINOS.filter(id=>S.owner[id]===pi).map(id=>nodeName(NMAP[id]).join(' ')).join(' / ');
  if(green){ /* everything on the zero */
   if(Math.random()<GREEN_ODDS){
    const win=bet*GREEN_PAYS;p.money+=win;fxAt(pi,'🟢 +$'+win,'#7fe08d');
    log('🟢 '+pname(pi)+' pushes ALL $'+bet+' onto GREEN at '+house+'… ZERO! The table pays 35 to 1: +$'+win+'.');
   }else{
    p.money-=bet;fxAt(pi,'🟢 −$'+bet,'#ff6b5e');
    log('🟢 '+pname(pi)+' pushes ALL $'+bet+' onto GREEN at '+house+'… it is not the zero. The house keeps all $'+bet+'.');
   }
  }else if(Math.random()<BLACK_ODDS){
   p.money+=bet;fxAt(pi,'⚫ +$'+bet,'#7fe08d');
   log('⚫ '+pname(pi)+' puts $'+bet+' on BLACK at '+house+'… BLACK! The table pays $'+bet+'.');
  }else{
   p.money-=bet;fxAt(pi,'🔴 −$'+bet,'#ff6b5e');
   log('🔴 '+pname(pi)+' puts $'+bet+' on BLACK at '+house+'… RED. The house keeps the $'+bet+'.');
  }
  sync();
  await winCheck();
 },
 /* 🎲 THE BIG GAMBLE — reshuffle who owns every node */
 async biggamble(pi){
  if(S.mode)return;
  const why=reworkBlocked(pi,'biggamble');if(why){sysTo(pi,why);return}
  const plan=bigGamblePlan(pi),trio=bigGambleTrio(pi);
  gMark('biggamble');
  let moved=0;
  Object.keys(plan).forEach(id=>{if(S.owner[id]!==plan[id]){handOver(id,plan[id]);moved++}});
  fxAt(pi,'🎲 THE BIG GAMBLE','#f5c542');
  const nm=id=>nodeName(NMAP[id]).join(' ');
  log('🎲 THE BIG GAMBLE — '+pname(pi)+' bets the house: every owned node on the board is dealt out again ('+moved+' change hands). '
   +pname(pi)+' gives up '+trio.map(nm).join(', ')+': '+trio.map(id=>nm(id)+' → '+(plan[id]==null?'the market':pname(plan[id]))).join(', ')+'. (Once per game.)');
  acccReconcile();sync();
  if(await winCheck())return;
  await finishNodeAbility(pi);
 },
 /* 🧥 JENSEN HUANG — HONEYPOT (once per game, your action): two Chinese nodes for free; the US market crashes (no US node pays for 2 rounds)
    and the seat is banned from buying in South-East Asia or the USA for its next 2 turns */
 async honeypot(pi){
  if(S.mode)return;
  const why=reworkBlocked(pi,'honeypot');if(why){sysTo(pi,why);return}
  const picks=honeypotPicks(pi),nm=id=>nodeName(NMAP[id]).join(' ');
  gMark('honeypot');
  const got=picks.map(id=>{const o=S.owner[id];handOver(id,pi);S.seizeCount[id]=(S.seizeCount[id]||0)+1;return nm(id)+(o!=null?' (from '+pname(o)+')':'')});
  suspendNodes(US_NODES,HONEYPOT_ROUNDS);
  (S.honeyBan||(S.honeyBan={}))[pi]=rtick()+HONEYPOT_TURNS*S.players.length+1;
  const j=NMAP.w_jensen;if(j)fx(j.x,j.y-64,'🍯 HONEYPOT','#f5c542');
  log('🍯 HONEYPOT — '+pname(pi)+' (JENSEN HUANG) picks up '+got.join(' and ')+' for nothing. The US stock market crashes: no US node earns income for '+HONEYPOT_ROUNDS+' rounds, and '+pname(pi)+' is banned from buying anything in South-East Asia or the USA for their next '+HONEYPOT_TURNS+' turns. (Once per game.)');
  acccReconcile();sync();
  if(await winCheck())return;
  await finishNodeAbility(pi);
 },
};
Object.assign(WORLD_ACTS,WORLD_REWORKS);
/* A seat index from the wire: a real seat at this table that is not the actor. */
export function isRival(pi,t){return Number.isInteger(t)&&t!==pi&&!!(S&&S.players[t])&&!isVanished(t)}
export function canUseBackroomAbility(pi){return !!(S&&S.phase==='move'&&S.cur===pi&&S.owner.back===pi&&!S.backroomAbilityUsed&&S.steps>=2)}
export function abilityPhase(pi){return !!(S&&(S.phase==='action'||canUseBackroomAbility(pi)))}
export async function finishNodeAbility(pi){
 if(canUseBackroomAbility(pi)){S.steps-=2;S.backroomAbilityUsed=true;S.mode=null;log('🤝 Backroom Deals lets '+pname(pi)+' use one node ability during movement (−2 movement steps).');fxAt(pi,'−2 STEPS','#e19bff');sync()}
 else await endOfTurn();
}
export function qantasGrounded(){return !!(S&&S.dlcGeo&&S.qantasGroundUntil>S.turn)}
export function qantasGroundedReason(){if(!S)return '';return qantasGrounded()?'THE CORPORATE BOEING is parked on the runway':'QANTAS is not grounded'}
/* 🌐 SVALBARD: a node its owner holds cannot be turned to rubble. */
export function rubbleShielded(nid){return !!(S&&S.dlcWorld&&S.owner[nid]!=null&&S.owner.w_svalbard===S.owner[nid])}
export function svalbardFreeRebuild(pi){return !!(S&&S.dlcWorld&&S.owner.w_svalbard===pi&&!S.svalbardUsed&&S.rubble&&S.rubble[S.players[pi].pos])}
/* 🌐 VERO INSURANCE: the underwriters pay $3 on any missile kill, or the full list price if it was their own node. */
function lloydsPays(nid,prev,lo){
 if(!S.dlcWorld||lo==null||!S.players[lo])return;
 const n=NMAP[nid];
 if(prev===lo)gain(lo,n.cost,'VERO pays out in full on '+nodeName(n).join(' '));
 else gain(lo,3,'VERO underwrites the loss of '+nodeName(n).join(' '));
}
export function strikeNode(pi,nid,opts){
 const silent=opts&&opts.silent;
 const n=NMAP[nid],prev=S.owner[nid],lo=S.owner.w_vero;
 if(rubbleShielded(nid)){
  log('🚀 '+pname(pi)+' launches a missile at '+nodeName(n).join(' ')+' — the SEED VAULT shrugs it off. '+pname(prev)+' keeps it; nothing becomes rubble.');
  fx(n.x,n.y-70,'🌱 SURVIVES','#7fe08d');
  sync();return;
 }
 if(prev!=null)delete S.owner[nid];
 delete S.bugs[nid];
 S.rubble[nid]=1;
 if(S.ov&&S.ov.nid===nid)S.ov=null;
 fx(n.x,n.y-70,'💥 MISSILE','#ff6b5e');
 log('🚀 '+pname(pi)+' launches a missile at '+n.name.join(' ')+(prev!=null?' — '+pname(prev)+' is expropriated with NO payout.':' — an unowned exhibit goes up in smoke.')+' What is left is rubble: no income, nothing to seize, until someone arrives and pays $'+n.cost+' to rebuild it.');
 lloydsPays(nid,prev,lo);
 /* 🌍 REGULATOR PROBE — a warhead on a regulator is a career-ending event: an
    investigation opens and lands on the striker's NEXT turn (50/50 indictment). */
 if(!silent&&n.type==='REGULATOR'){
  S.missileProbe={by:pi};
  log('🔎 Striking '+n.name.join(' ')+' opens a REGULATOR INVESTIGATION — '+pname(pi)+' will answer to ASIC or the ACCC next turn.');
 }
 sync();
}
export function isPillarShieldedNode(nid){
 const owner=S&&S.owner[nid];
 return owner!=null&&nid!=='geo_pillars'&&S.owner.geo_pillars===owner;
}
export function canMissileNode(me,nid){
 return !!(S&&S.dlcGeo&&!S.rubble[nid]&&S.owner[nid]!==me&&!isPillarShieldedNode(nid));
}
export function ownsMissileLauncher(pi){return !!(S&&S.dlcGeo&&(S.owner.geo_missile===pi||S.owner.geo_shahed===pi))}
export function canFireMissileFrom(pi){if(!S||!S.players[pi]||!ownsMissileLauncher(pi))return false;const pos=S.players[pi].pos;return (pos==='geo_missile'&&S.owner.geo_missile===pi)||(pos==='geo_shahed'&&S.owner.geo_shahed===pi)||S.owner.geo_kim===pi}
export function canReach(id){return !(id==='qantas'&&qantasGrounded())}
/* ✈️ GLOBAL EDITION — the Qantas jet is a real plane. It starts parked at QANTAS and stays wherever it lands. Whoever STANDS on the
   jet's square can fly it ($3, during movement): the owner flies it, anyone else steals it. A flight has a range (QANTAS_RANGE_PX on the
   map, about 8,500 km; the date line wraps), so it is no longer a ticket to anywhere. The classic boards keep the old jet: the owner,
   from anywhere, to anywhere. */
export const QANTAS_RANGE_PX=2300;
export function jetAt(){if(!S||!S.dlcWorld)return null;return S.jetAt&&NMAP[S.jetAt]?S.jetAt:'qantas'}
export function flyDist(a,b){
 const A=NMAP[a],B=NMAP[b];if(!A||!B)return Infinity;
 const w=worldMapMetrics().w;let dx=Math.abs(A.x-B.x);dx=Math.min(dx,w-dx);
 return Math.hypot(dx,A.y-B.y);
}
export function inFlyRange(to){if(!S||!S.dlcWorld)return true;const at=jetAt();return !!at&&flyDist(at,to)<=QANTAS_RANGE_PX}
export function canFly(pi){
 if(!S||!S.players[pi]||!NMAP.qantas)return false;
 if(!S.dlcWorld)return S.owner.qantas===pi;
 return S.players[pi].pos===jetAt()&&!S.rubble.qantas;
}
/* 🌐 the three chokepoints charge rivals a $2 transit toll */
export function chokeToll(id){return !!(S&&S.dlcWorld&&WORLD_CHOKEPOINTS.includes(id))}
export function nodeName(n){return (S&&S.rebuilt&&S.rebuilt[n.id]&&n.rebuiltName)||n.name}
export function blockaded(id){return !!(S&&S.blockades&&S.blockades[id]>S.turn)}
export function seizeListPrice(pi,n){
 let base=n.cost;
 if(S.dlcWorld&&S.owner.w_woolies===pi)base=Math.max(1,base-1); /* WOOLWORTHS SELF-CHECKOUT: automation */
 if(n.type==='CHART'){if(S.owner.econ===pi)base=Math.max(1,base-1)}
 if(windowOn('eofy'))base=Math.max(1,base-2); /* EOFY SALE */
 return base;
}
/* 🌐 MARIE BYRD LAND: unclaimed, so the first player to arrive owns it free (like Tuvalu) */
function claimMarieByrd(pi,id,verb){
 if(id!=='w_aq_mbl'||S.owner[id]!=null||S.rubble[id])return;
 S.owner[id]=pi;const n=NMAP[id];
 fx(n.x,n.y-64,'🧊 CLAIMED','#7fe08d');
 log('🧊 '+pname(pi)+' '+verb+' MARIE BYRD LAND — UNCLAIMED, SO IT IS YOURS. First arrival owns it: no action, no cost, no Cortisol.');
}
/* 🌐 ANTARCTICA (THE ANTARCTIC TREATY) cannot be taken from its owner */
export function noTakeover(nid){return !!(S&&S.dlcWorld&&nid==='w_antarctica')}
export function flatSeize(nid){return nid==='made'||nid==='qantas'||nid==='rba'||nid==='geo_pillars'}
export function takeoverCost(pi,nid,base){
 if(flatSeize(nid))return base;
 if(S.dossier)return base;
 const prior=S.seizeCount[nid]||0;
 let c=base*Math.pow(2,Math.max(1,prior));
 if(S.dlcWorld&&S.owner[nid]!=null&&S.owner.w_jpm===S.owner[nid])c+=2; /* JPMORGAN: its owner's nodes cost the buyer +$2 */
 return c;
}
export async function doMove(pi,id){
 if(!canReach(id)){sysTo(pi,qantasGroundedReason()+' — the jet is still at the gate.');return}
 if(blockaded(id)){sysTo(pi,NMAP[id].name.join(' ')+' is BLOCKADED — nobody gets in.');return}
 const prevPos=S.players[pi].pos;
 const owner=S.owner[id];
 if(owner!=null&&owner!==pi){
  if(S.owner.bond007===pi){log('🤵 007 flashes… credentials. No toll.')}
  else if(S.tollFree===pi){log('🍃 DEFAULT: the toll into '+lname(NMAP[id])+' is waived for '+pname(pi)+' this turn.')}
  else if(ausNzWaiver(pi,prevPos,id)){log('🤝 ANZCERTA: the toll between '+nodeName(NMAP[prevPos]).join(' ')+' and '+nodeName(NMAP[id]).join(' ')+' is waived for '+pname(pi)+'.')}
  else{
   let toll=(S.owner.albo===owner)?2:1;const p=S.players[pi];
   if(chokeToll(id))toll=Math.max(toll,2); /* 🌐 CHOKEPOINT: Panama, Hormuz and Suez charge $2 */
   if(p.money<toll){sysTo(pi,'Toll: you cannot afford the $'+toll+' to enter '+lname(NMAP[id])+'.');return}
   p.money-=toll;S.players[owner].money+=toll;
   fxAt(pi,'−$'+toll,'#ff6b5e');fxAt(owner,'+$'+toll,'#7fe08d');
   if(hiddenInfo(id))log('🛂 '+pname(pi)+' pays $'+toll+' toll to whoever holds a CLASSIFIED site.');
   else log('🛂 '+pname(pi)+' pays $'+toll+' toll to '+pname(owner)+(toll===2?' — the PM closed the road.':'.'));
  }
 }
 S.players[pi].pos=id;S.steps--;
 if(S.dlcWorld)claimMarieByrd(pi,id,'lands in');
 if(S.dlcGeo&&id==='geo_tuvalu'&&S.owner[id]==null&&!S.rubble[id]){
  S.owner[id]=pi;const n=NMAP[id];
  fx(n.x,n.y-64,'🏝️ CLAIMED','#7fe08d');
  log('🏝️ '+pname(pi)+' lands in TUVALU — THE JOIN IS FREE. First arrival claims it: no action, no cost, no Cortisol.');
 }
 if(!S.players[pi].visited)S.players[pi].visited={};S.players[pi].visited[id]=true;
 if(prevPos==='sisy'&&id!=='sisy'&&S.owner.back!==pi)S.sisyPayout=10;
 log('→ '+pname(pi)+' moves to '+lname(NMAP[id])+'.');
 if(S.steps<=0)await endMovement();else sync();
}
export async function doFly(pi,id){
 const p=S.players[pi];
 if(!NMAP[id]||id===p.pos){sysTo(pi,'Pick somewhere else on the board to land.');return}
 if(!canReach(id)){sysTo(pi,qantasGroundedReason()+' — you cannot land there yet.');S.mode=null;sync();return}
 if(blockaded(id)){sysTo(pi,NMAP[id].name.join(' ')+' is BLOCKADED — you cannot land there.');S.mode=null;sync();return}
 if(p.money<3){sysTo(pi,'The Flying Kangaroo wants $3 for the seat.');S.mode=null;sync();return}
 if(S.dlcWorld&&!canFly(pi)){sysTo(pi,'The Qantas jet is parked at '+lname(NMAP[jetAt()])+' — stand on it to fly it.');S.mode=null;sync();return}
 if(!inFlyRange(id)){sysTo(pi,lname(NMAP[id])+' is out of the jet’s range (about 8,500 km).');return}
 const stolen=S.dlcWorld&&S.owner.qantas!==pi;
 const prevFlyPos=p.pos;
 p.money-=3;fxAt(pi,'−$3','#ff6b5e');S.mode=null;p.pos=id;S.steps=0;
 const flew=projFx('fly',prevFlyPos,id);
 if(S.dlcWorld)claimMarieByrd(pi,id,'flies into');
 if(S.dlcGeo&&id==='geo_tuvalu'&&S.owner[id]==null&&!S.rubble[id]){
  S.owner[id]=pi;const n=NMAP[id];
  fx(n.x,n.y-64,'🏝️ CLAIMED','#7fe08d');
  log('🏝️ '+pname(pi)+' jets into TUVALU — THE JOIN IS FREE. First arrival claims it: no action, no cost, no Cortisol.');
 }
 if(!p.visited)p.visited={};p.visited[id]=true;
 if(prevFlyPos==='sisy'&&id!=='sisy'&&S.owner.back!==pi)S.sisyPayout=10;
 if(S.dlcWorld){
  S.jetAt=id;
  if(stolen){fxAt(pi,'✈️ STOLEN','#ff9a3c');log('✈️ '+pname(pi)+' STEALS the Qantas jet'+(S.owner.qantas!=null?' from '+pname(S.owner.qantas):'')+' and flies it to '+lname(NMAP[id])+'. It is parked there now.')}
  else log('✈️ '+pname(pi)+' flies the Qantas jet to '+lname(NMAP[id])+' — it is parked there now (anyone standing on it can take it).');
 }
 else log('✈️ '+pname(pi)+' takes the Qantas jet straight to '+lname(NMAP[id])+'.');
 if(flew){sync();await projPause()} /* the jet flies before the landing opens the next phase */
 await endMovement();
}
export async function endMovement(){
 if(!S||S.over||S.phase!=='move')return;
 S.phase='action';nabFee(S.cur);sync();
 await maybePeek();
 sync();
}
export async function maybePeek(){
 const pi=S.cur;const p=S.players[pi];
 const anywhere=S.owner.iface===pi;
 const here=(S.owner.term===pi&&p.pos==='term')||(S.owner.timeline===pi&&p.pos==='timeline');
 if(!anywhere&&!here)return;
 if(windowOn('crowdstrike')){log('🟦 CROWDSTRIKE: the Terminal shows a blue screen — no peek this round.');return}
 if(!S.deck.length){S.deck=shuffle(S.discard.slice());S.discard=[];log('🎴 The rumor deck is reshuffled.')}
 if(!S.deck.length)return;
 const c=CARDBYID[S.deck[S.deck.length-1]];
 const v=await askPlayer(pi,{title:anywhere&&!here?'THE MARKET INTERFACE — PEEK':'THE TERMINAL — INSIDER PEEK',html:cardFace(c)+'<p class="fine">For your eyes only. Keep the card on top, or bury it at the bottom?</p>',options:[{label:'Put it back on top',v:'keep'},{label:'Bury it at the bottom',v:'bury'}],def:'keep',meta:{kind:'peek',card:c.id}});
 if(v==='bury'){const cid=S.deck.pop();S.deck.unshift(cid);log('📈 '+pname(pi)+' buries the story at the bottom of the deck.')}
 else log('📈 '+pname(pi)+' peeks at tomorrow and puts it back.');
}
export async function doSeize(pi){
 const p=S.players[pi];const nid=p.pos;const n=NMAP[nid];const prev=S.owner[nid];
 if(S.rubble&&S.rubble[nid]){sysTo(pi,'That node is rubble — it must be rebuilt before it can be owned.');return}
 if(prev===pi)return;
 if(prev!=null&&noTakeover(nid)){sysTo(pi,nodeName(n).join(' ')+' is UNTOUCHABLE — no hostile takeover of it is ever possible.');return}
 {const hb=honeypotBan(pi,nid);if(hb){sysTo(pi,hb);return}}
 if(S.dlcGeo&&((nid==='geo_shahed'&&S.owner.geo_missile===pi)||(nid==='geo_missile'&&S.owner.geo_shahed===pi))){sysTo(pi,'You can own either MISSILE COMMAND or the SHAHED DRONE, not both.');return}
 let base=seizeListPrice(pi,n);
 /* the slipstream discount is only spent once the deal actually goes through */
 const slip=S.slipped===true&&S.owner.f1===pi;
 if(slip)base=Math.max(1,base-2);
 const isTake=prev!=null;
 const tariff=tariffFor(pi,nid);
 const cost=(isTake?takeoverCost(pi,nid,base):base)+tariff+inflationExtra();
 if(isTake&&flatSeize(nid))log('📌 '+n.name.join(' ')+' does not get more expensive — list price, always.');
 else if(isTake&&S.dossier)log('📂 The Dossier does its work — list price, not double.');
 const maxPay=p.money+(S.owner.back===pi?Math.min(3,p.intel):0);
 if(maxPay<cost){sysTo(pi,"You can't afford that.");return}
 let cash=cost,useInt=0;
 if(p.money<cost){
  const need=cost-p.money;
  const v=await askPlayer(pi,{title:'BACKROOM DEALS',body:'Cover the $'+need+' shortfall with '+need+' Intel (1 🛈 = $1)?',options:[{label:'Pay $'+p.money+' + '+need+' 🛈',v:1},{label:'Walk away',v:0}],def:0});
  if(!v)return;
  if(S.cur!==pi||S.phase!=='action'||S.over||S.owner[nid]!==prev||p.pos!==nid||S.owner.back!==pi||p.money+Math.min(3,p.intel)<cost){sysTo(pi,'That deal is no longer on the table.');return}
  useInt=Math.max(0,cost-p.money);cash=cost-useInt;
 }
 /* 🏦 COMMONWEALTH BANK — CAN'T BE BEAT: once per game its owner may refuse a hostile takeover of any of their nodes */
 if(isTake&&S.owner.commbank===prev&&!(S.rubble&&S.rubble.commbank)&&!gUsed('cba')){
  const ref=await askPlayer(prev,{title:'CAN’T BE BEAT — REFUSE THE TAKEOVER?',body:pname(pi)+' is trying to take '+lname(n)+' (their bid: $'+cost+'). You hold the COMMONWEALTH BANK: once per game you may refuse a hostile takeover. The takeover fails and they keep their money.',options:[{label:'Refuse — it can’t be beat (once per game)',v:1},{label:'Let it through',v:0}],def:0,timeout:30000,meta:{kind:'cba',node:nid,from:pi,price:cost}});
  if(!S||S.over||S.cur!==pi||S.phase!=='action'||S.owner[nid]!==prev||p.pos!==nid)return;
  if(ref===1&&!gUsed('cba')){
   gMark('cba');
   fx(n.x,n.y-64,'🏦 REFUSED','#ffd34d');
   log('🏦 CAN’T BE BEAT! '+pname(prev)+' refuses '+pname(pi)+'’s takeover of '+lname(n)+' — it fails, and '+pname(pi)+' keeps their money. (Once per game.) The attempt still uses '+pname(pi)+'’s action.');
   sync();await endOfTurn();return;
  }
 }
 if(slip){S.slipped='spent';log('🏎️ The slipstream carries '+pname(pi)+' into the deal — $2 off.')}
 p.money-=cash;p.intel-=useInt;
 if(tariff){const to=tariffOwner();if(to!=null){S.players[to].money+=tariff;fxAt(to,'+$'+tariff,'#7fe08d');log('🧱 THE TARIFF WALL: '+pname(pi)+' pays $'+tariff+' extra to '+pname(to)+' for a '+n.type+' node.')}}
 if(useInt>0)fxAt(pi,'🛈−'+useInt,'#55c1ff');
 if(cash>0)fxAt(pi,'−$'+cash,'#ff6b5e');
 if(isTake){
  S.players[prev].money+=n.cost;log(hiddenInfo(nid)?'💸 The previous holder of a CLASSIFIED site pockets a $'+n.cost+' buyout.':'💸 '+pname(prev)+' pockets a $'+n.cost+' buyout.');fxAt(prev,'+$'+n.cost,'#7fe08d');
  if(S.owner.accc===prev&&p.money>=2){p.money-=2;S.players[prev].money+=2;log('🧐 ACCC review fee: '+pname(pi)+' pays '+pname(prev)+' $2.')}
 }
 S.owner[nid]=pi;if(nid==='sisy')S.sisyPayout=10;
 S.seizeCount[nid]=(S.seizeCount[nid]||0)+1;
 pyramidPays(pi,nid);
 const via=useInt>0?' (paid $'+cash+' + '+useInt+' 🛈)':'';
 log('📝 '+pname(pi)+(isTake?' muscles in on ':' seizes ')+lname(n)+via+'.');
 fx(n.x,n.y-64,'📝 SEIZED',S.players[pi].color);
 if(nid==='bond')giveIntel(pi,2,'desk gossip flows');
 if(nid==='leak')giveIntel(pi,1,'the leak pays');
 S.players.forEach((pl,j)=>{if(j!==pi&&S.owner.photo===j)giveIntel(j,1,'the Photo Wall catches it')});
 addCortisol(pi,isTake?2:1,isTake?'hostile takeover':'hands are getting dirty');
 /* 🌐 WOOLWORTHS: unexpected item in the bagging area — every rival takes +1 Cortisol (a seizure ends the turn, so once per turn) */
 if(S.dlcWorld&&S.owner.w_woolies===pi&&!S.rubble.w_woolies){log('🛒 UNEXPECTED ITEM in the bagging area — '+pname(pi)+'’s seizure rattles the whole table.');S.players.forEach((pl,j)=>{if(j!==pi)addCortisol(j,1,'unexpected item in the bagging area')})}
 sync();
 if(await winCheck())return;
 await endOfTurn();
}
export async function doBug(pi,nid){
 const n=NMAP[nid];const p=S.players[pi];
 if(!(ADJ[p.pos]||[]).includes(nid)||S.owner[nid]==null||S.owner[nid]===pi||S.bugs[nid]!=null||hiddenFrom(pi,nid)){sysTo(pi,'Pick a highlighted rival node next to you (not already bugged).');return}
 const cost=(S.owner.insider===pi)?0:1;
 if(p.intel<cost){sysTo(pi,'Not enough Intel.');S.mode=null;sync();return}
 p.intel-=cost;S.bugs[nid]=pi;
 if(cost>0)fxAt(pi,'🛈−1','#55c1ff');
 fx(n.x,n.y-60,'🐛 PLANTED','#55c1ff');
 log('🐛 '+pname(pi)+' plants a bug on '+lname(n)+(cost===0?' — the INSIDER TRADING graphic made it free.':'.'));
 S.mode=null;await endOfTurn();
}
export async function doSpin(pi,kind){
 const cost=kind==='fox'?2:3;const cool=kind==='fox'?3:2;
 if(S.owner[kind==='fox'?'fox':'press']!==pi)return;
 const p=S.players[pi];
 if(p.money<cost||S.spun){sysTo(pi,'Spin unavailable.');return}
 const v=await askPlayer(pi,{title:kind==='fox'?'FOX SPIN':'SPIN THE PRESS',body:(kind==='fox'?'Fair. And. Furious. ':'“Quite frankly…” — ')+'for $'+cost+':',options:[{label:'Cool my own Cortisol (−'+cool+' 🔥)',v:'cool'},{label:'Roast a rival (+1 🔥)',v:'cortisol'},{label:'Never mind',v:'no'}],def:'no'});
 if(v==='no')return;
 /* the prompt may have sat open: the spin is only good if the seat still owns the outlet, still has the cash and the turn */
 if(S.cur!==pi||S.over||S.mode||S.spun||S.owner[kind==='fox'?'fox':'press']!==pi||p.money<cost){sysTo(pi,'The spin is no longer available.');sync();return}
 if(v==='cool'){p.money-=cost;fxAt(pi,'−$'+cost,'#ff6b5e');S.spun=true;log('🗞️ '+pname(pi)+' spins the story smooth.');addCortisol(pi,-cool,'friendly coverage');await finishNodeAbility(pi);return}
 S.spinKind=kind;S.mode='roast';sync();
}
export function drawCard(){
 if(!S.deck.length){S.deck=shuffle(S.discard.slice());S.discard=[];log('🎴 The rumor deck is reshuffled.')}
 const id=S.deck.pop();S.discard.push(id);S.drawN=(S.drawN|0)+1;
 const c=CARDBYID[id];
 if(id==='sisyroll'&&S.dlcWorld&&S.pyramid>1){log('🔺 THE BOULDER ROLLS BACK DOWN — the pyramid scheme collapses and resets: the payout is back to $1.');S.pyramid=1}
 log('🎴 EVENT — '+c.title);
 return c;
}
export async function endOfTurn(){
 if(!S||S.over||S.phase==='event')return;
 S.mode=null;S.phase='event';sync(true);
 const jtO=S.owner.jt;
 if(jtO!=null&&!S.jtUsed&&!(S.players[jtO]&&S.players[jtO].dc)){
  const v=await askPlayer(jtO,{title:'JTPORTAL INTERVENES?',body:'You hold JTPORTAL — once per game, an event can be made to have never happened. Use it on this one?',options:[{label:'Let it play out',v:0},{label:'“Quite frankly…” — cancel it',v:1}],def:0,timeout:15000});
  if(v){S.jtUsed=true;log('🌐 JTPortal: “Quite frankly, that never happened.” The event vanishes.');fx(1200,720,'“NEVER HAPPENED.”','#55c1ff',true);nextTurn();return}
 }
 const card=drawCard();
 await resolveEvent(card);
 sync();
 if(await winCheck())return;
 nextTurn();
}
/* a drawn market event, resolved: the end-of-turn event, and the one THE WALL STREET BELL rings in early */
export async function resolveEvent(card){
 /* A table of only bots has nobody to interrupt: the event still runs, the log
    keeps the record and the mood strip shows the swing — but no modal. */
 if(!S.players.every(p=>p.bot))announceAll('MARKET EVENT — TURN '+S.turn,cardFace(card));
 const tk=S.owner.toktimer;if(tk!=null)giveIntel(tk,1,'Toktimer clocked the event');
 await card.run();
 if(S.dlcWorld)worldEventPays(card.id,id=>S.owner[id]).forEach(w=>{if(w.amt)gain(w.owner,cs(w.amt),w.name);if(w.intel)giveIntel(w.owner,w.intel,w.name)});
 /* 🌐 STRAIT OF HORMUZ: $2 per oil node a rival holds when OIL SPIKES */
 if(S.dlcWorld&&card.id==='oilspike'&&S.owner.w_hormuz!=null){
  const h=S.owner.w_hormuz,cnt=OIL_ALL.filter(id=>NMAP[id]&&S.owner[id]!=null&&S.owner[id]!==h&&!S.rubble[id]).length;
  if(cnt)gain(h,cs(2)*cnt,'the Strait of Hormuz taxes '+cnt+' rival oil position'+(cnt>1?'s':''));
 }
}
export function nextTurn(){if(!S||S.over)return;S.cur=(S.cur+1)%S.players.length;if(S.cur===0)S.turn++;Promise.resolve(startTurn()).catch(e=>console.error(e))}
export function goalAmount(){return clampGoal(S&&S.goal?S.goal:Net.goal)}
/* Event-card dollars are written for the default $100 table and scale with the
   host's goal, so the deck matters as much at $20 as at $999 (never below $1). */
export function cs(n){return Math.max(1,Math.round(n*goalAmount()/100))}
export function cardText(c){return String(c.text).replace(/[$](\d+)/g,(m,n)=>'$'+cs(+n))}
/* Money alone no longer takes it: the con needs a finished portfolio. */
export const WIN_TYPES=['BANK','REGULATOR','CHART','WILD','CORPORATE','COMMODITY','MEDIA'];
export function hasType(i,t){return NODES.some(n=>n.type===t&&S.owner[n.id]===i)}
export function missingTypes(i){return WIN_TYPES.filter(t=>!hasType(i,t))}
export async function winCheck(){
 if(!S||S.over||Net.role!=='host')return false;
 const goal=goalAmount();
 let win=-1;
 S.players.forEach((pl,i)=>{if(pl.money>=goal&&!missingTypes(i).length&&(win<0||pl.money>S.players[win].money))win=i});
 if(win<0)return false;
 /* two (or more) complete the con at once (say after THE BIG GAMBLE): the deepest pocket takes it */
 const tied=S.players.map((pl,i)=>i).filter(i=>S.players[i].money>=goal&&!missingTypes(i).length);
 if(tied.length>1)log('⚖️ '+tied.map(pname).join(' and ')+' complete the con at the same moment — whoever has the most money takes it: '+pname(win)+' with $'+S.players[win].money+'.');
 S.over=true;S.phase='over';sync(true);
 const w=S.players[win];
 hooks.gameOver(w.name,w.char,S.players.map(pl=>({name:pl.name,money:pl.money})));
 log('🏆 '+pname(win)+' banks $'+w.money+' with the full set of node types — the target was $'+goal+'. The con is complete.');
 const wc=charMeta(w.char);
 const charHtml=wc?'<div style="margin:10px 0 14px;text-align:center"><img src="'+charSrc(w.char)+'" alt="'+esc(wc.name)+'" style="width:96px;height:96px;object-fit:contain;border-radius:12px;border:2px solid '+w.color+';background:#111;padding:4px"><div style="font-weight:800;margin-top:5px">'+esc(wc.name)+'</div></div>':'';
 const board=S.players.map((pl,i)=>{const c=charMeta(pl.char);return esc(pl.name)+' ('+(c?esc(c.name):'No character')+') — $'+pl.money}).join(' · ');
 await revealAll('🏆 THE BIG CON PAYS OUT','<div class="winname" style="color:'+w.color+'">'+esc(w.name)+'</div>'+charHtml+'<p>walks away with <b>$'+w.money+'</b>, past the table’s target of <b>$'+goal+'</b>, holding one of every node type — '+WIN_TYPES.join(' · ')+'. The market was rigged. It was rigged by <b>them</b>.</p><div class="winlist">'+board+'</div>');
 /* The table stays put after the payout — nobody is kicked out. The room, the
    connections and the record all survive; the host deals the next con from
    the lobby (or LEAVE ends the night deliberately). */
 return true;
}
export function addChat(pi,text){
 if(!S)return;
 /* rows past the seated table are spectators — they chat under their roster
    name with a palette colour, since they hold no seat of their own */
 const sp=pi>=S.players.length?Net.roster[pi]:null;
 S.chat.push({n:sp?'👁 '+sp.name:pname(pi),c:sp?PCOLORS[pi%PCOLORS.length]:S.players[pi].color,t:text});S.chatN=(S.chatN|0)+1;
 if(S.chat.length>60)S.chat.shift();
 sync();
}
/* ================= EVENT FACES (pure HTML strings) ================= */
export function blocRulingFace(sub){return '<div class="eventcard"><div class="eicon">🌐</div><div class="etitle">WTO TRADE-BLOC RULING</div><div class="etext">'+(sub||'')+'</div></div>'}
export function monopolyAlertFace(sub,asic){const img=asic?'./static/asic.png':'./static/accc.png';const lab=asic?'ASIC':'ACCC';const title=asic?'ASIC MARKET-MANIPULATION ALERT':'MONOPOLY ALERT';return '<div class="eventcard"><div style="display:flex;gap:16px;justify-content:center;align-items:center;margin:10px 0 8px"><img src="./static/the rock.gif" alt="The Rock" style="width:120px;height:120px;object-fit:cover;border:2px solid #168388;background:#000"><img src="'+img+'" alt="'+lab+'" style="width:120px;height:120px;object-fit:contain;border:2px solid #168388;background:#111;padding:8px"></div><div class="etitle">'+title+'</div><div class="etext">'+(sub||'')+'</div></div>';}
export function cardFace(c){if(c.id==='crackdown')return monopolyAlertFace(cardText(c));return '<div class="eventcard"><div class="eicon">'+c.icon+'</div><div class="etitle">'+c.title+'</div><div class="etext">'+cardText(c)+'</div></div>'}
/* ================= MARKET EVENT DECK (36 cards) — every card moves the mood ================= */
/* ================= ROUND WINDOWS & SWITCHED-OFF NODES (shared by the market-event cards) =================
   A "round" here is one full rotation of income: a window opened at the end of seat k covers the turns of seats k+1 … k+N
   (N = players), so every player takes exactly one income and one turn inside it. S.cw[key] and S.suspend[nodeId] hold the first
   tick (turn*N+seat) at which they have lapsed, so they live in the game state and sync with everything else. */
export function rtick(){return S?S.turn*S.players.length+S.cur:0}
export function roundWindow(key,rounds){if(!S.cw)S.cw={};S.cw[key]=rtick()+(rounds||1)*S.players.length+1}
export function windowOn(key){return !!(S&&S.cw&&S.cw[key]>rtick())}
export function suspendNodes(ids,rounds){if(!S.suspend)S.suspend={};const until=rtick()+(rounds||1)*S.players.length+1;ids.forEach(id=>{if(NMAP[id])S.suspend[id]=Math.max(S.suspend[id]||0,until)})}
export function suspended(id){return !!(S&&S.suspend&&S.suspend[id]>rtick())}
/* the owned, standing nodes of a card's list */
function cardNodes(ids){return ids.filter(id=>NMAP[id]&&S.owner[id]!=null&&!(S.rubble&&S.rubble[id]))}
const BRICS_SET=new Set(TRADE_BLOCS.w_brics.members),US_SET=new Set(US_NODES);
/* per-node income tweak while the BRICS SUMMIT is on: BRICS members x2, American nodes halved */
export function cardIncome(id,v){if(S&&S.dlcWorld&&windowOn('brics')){if(BRICS_SET.has(id))return v*2;if(US_SET.has(id))return Math.floor(v/2)}return v}
/* why an intent is refused while a card is in force ('' when it is allowed) */
export function cardGate(act){
 if(!S||!S.cw)return '';
 if(windowOn('crowdstrike')&&(act==='flymode'||act==='fly'||act==='bugmode'||act==='bug'||act==='spy'))return '🟦 CROWDSTRIKE BLUE SCREEN — flights, Terminal peeks and bug actions are down for the round.';
 if(windowOn('lockdown')&&(act==='flymode'||act==='fly'||act==='favor'||act==='slip'))return '😷 COVID LOCKDOWN — flights are grounded and nobody moves further than one step this round.';
 return '';
}
function bleachReef(){S.bleachUntil=S.turn+3;const o=S.owner.w_gbr;fxAt(o==null?S.cur:o,'🪸 BLEACHED','#e19bff',true);if(o==null)log('🪸 The Great Barrier Reef bleaches — nobody owns it; nobody notices.');else{log('🪸 The Great Barrier Reef bleaches for two rounds — its blockade and income are off, and '+pname(o)+' takes +1 Cortisol.');addCortisol(o,1,'the reef goes white','event')}}
const SANCTION_WHO='Gazprom, Nord Stream, the Kremlin, the Shahed drone and the North Korean cluster';
const CARDS_B=[
{id:'bankrun',icon:'🏦',title:'BANK RUN',text:'A rumour, a queue, a very long weekend. Everyone loses 25% of the cash they hold above $40 — unless they own a BANK or a REGULATOR, who simply close the doors.',
 run(){setMood('PANIC','a bank run — the queue wraps around the block');const floor=cs(40);S.players.forEach((pl,i)=>{if(NODES.some(n=>(n.type==='BANK'||n.type==='REGULATOR')&&S.owner[n.id]===i&&!(S.rubble&&S.rubble[n.id]))){log('🏦 '+pname(i)+' owns a bank or a regulator — the doors are firmly shut.');return}const amt=Math.floor(Math.max(0,pl.money-floor)*0.25);if(amt>0)payVoid(i,amt,'a quarter of everything above $'+floor+' walks out the door');else log('🏦 '+pname(i)+' has no more than $'+floor+' — there is nothing to run with.')});const im=S.dlcWorld?S.owner.w_imf:null;if(im!=null)gain(im,cs(3),'the lender of last resort takes the call')}},
{id:'royalcomm',icon:'⚖️',title:'THE ROYAL COMMISSION',text:'Nine months, four volumes, one very tall stack of recommendations. Every open regulator file gains +2 scrutiny, and every BANK owner takes +1 Cortisol.',
 run(){setMood('PANIC','a royal commission — the findings are, regrettably, damning');acccReconcile();const files=acccFileList();if(!files.length)log('⚖️ The Commission finds no open files — only the banks to blame.');else files.forEach(f=>{f.s+=2;log('⚖️ The Commission lands on '+fileName(f)+' — scrutiny '+f.s+'/'+ACCC_RULING+(f.s>=ACCC_RULING?'; the ruling lands at their turn start.':'.'));fxAt(f.pi,'📁 +2 SCRUTINY','#55c1ff')});S.players.forEach((pl,i)=>{if(NODES.some(n=>n.type==='BANK'&&S.owner[n.id]===i))addCortisol(i,1,'called to give evidence','event')})}},
{id:'robodebt',icon:'🧾',title:'ROBODEBT',text:'A spreadsheet decides you owe money. You do not. The letter arrives anyway: every player pays 10% of their cash to the bank, rounded to the nearest dollar.',
 run(){setMood('PANIC','robodebt — an algorithm sends the letters');S.players.forEach((pl,i)=>{const amt=Math.round(pl.money*0.1);if(amt>0)payVoid(i,amt,'the algorithm says you owe 10%');else log('🧾 '+pname(i)+' owes less than a dollar — the letter is a rounding error.')})}},
{id:'gamestop',icon:'🚀',title:'GAMESTOP SQUEEZE',text:'Retail finds the short interest. The poorest player takes 20% of the richest player’s cash — and if the Hedge Fund has an owner, they pay the poorest a further $3, because the shorts get squeezed.',
 run(){setMood('FRENZY','GameStop — the apes find the short interest');let poor=0,rich=0;S.players.forEach((pl,i)=>{if(pl.money<S.players[poor].money)poor=i;if(pl.money>S.players[rich].money)rich=i});if(poor===rich){log('🚀 Nobody is richer or poorer than anybody else — the squeeze fizzles.');return}const take=Math.floor(S.players[rich].money*0.2);if(take>0)payTo(rich,take,poor,'the squeeze: '+pname(poor)+' takes 20% of the richest');const h=S.owner.hedge;if(h!=null&&h!==poor)payTo(h,cs(3),poor,'the Hedge Fund was short and gets squeezed')}},
{id:'ftx',icon:'🪙',title:'FTX COLLAPSES',text:'The customer funds were “in the other wallet”. Anyone holding 6 or more Intel loses half of it, rounded down, in the contagion.',
 run(){setMood('PANIC','FTX — the other wallet was empty');let hit=false;S.players.forEach((pl,i)=>{if(pl.intel>=6){const lose=Math.floor(pl.intel/2);pl.intel-=lose;hit=true;fxAt(i,'🛈−'+lose,'#55c1ff');log('🪙 '+pname(i)+' loses '+lose+' Intel in the contagion.')}});if(!hit)log('🪙 Nobody holds 6 Intel — the contagion has nothing to eat.')}},
{id:'crowdstrike',icon:'🟦',title:'CROWDSTRIKE BLUE SCREEN',text:'One update, eight million machines, and a very blue afternoon. For one full round there are no flights (Qantas, the Cruise Ship and launches), no Terminal peeks and no bug actions.',
 run(){setMood('PANIC','a blue screen at every airport');roundWindow('crowdstrike',1);log('🟦 The systems are down for one full round: flights, Terminal peeks and bugs are off.')}},
{id:'toiletpaper',icon:'🧻',title:'TOILET PAPER PANIC',text:'The shelves are bare and the nerves are bare-er. Everyone takes +1 Cortisol, and the QUIKSTOP owner collects $10 from each other player (or whatever they can find).',
 run(){setMood('FRENZY','the shelves are bare');S.players.forEach((pl,i)=>addCortisol(i,1,'the shelves are bare','event'));const q=S.owner.quik;if(q==null){log('🧻 The Quikstop is unowned — the last roll goes to nobody.');return}S.players.forEach((pl,i)=>{if(i!==q)payTo(i,cs(10),q,'a four-pack at panic prices → QuikStop')})}},
{id:'covid',icon:'😷',title:'COVID LOCKDOWN',text:'Stay home, bake bread, watch the briefings. Next round everyone moves at most 1 step (flights grounded too), and every MEDIA node pays its owner $2.',
 run(){setMood('PANIC','a lockdown — stay home, watch the briefing');roundWindow('lockdown',1);cardNodes(NODES.filter(n=>n.type==='MEDIA').map(n=>n.id)).forEach(id=>gain(S.owner[id],cs(2),NMAP[id].name.join(' ')+' — the briefings rate through the roof'));log('😷 For one full round nobody walks further than one step and no plane leaves the ground.')}},
{id:'eofy',icon:'🏷️',title:'EOFY SALE',text:'Everything must go before the thirtieth. Every seizure costs $2 less this round (never below $1).',
 run(){setMood('BOOM','the EOFY sale — everything must go');roundWindow('eofy',1);log('🏷️ EOFY: every seizure is $2 cheaper for one full round (minimum $1).')}},
{id:'swiftonomics',icon:'🎤',title:'SWIFTONOMICS',text:'Taylor’s tour rolls into town and the whole economy buys a ticket. QANTAS, the Marketplace, the Quikstop and the tourism nodes pay their owners $3 each.',
 run(){setMood('BOOM','the tour is in town — every hotel is full');const ids=cardNodes(TOURISM_NODES);if(!ids.length)log('🎤 No tourism node has an owner — the tour plays to an empty stadium.');ids.forEach(id=>gain(S.owner[id],cs(3),NMAP[id].name.join(' ')+' sells out'))}},
{id:'ironcrash',icon:'📉',title:'IRON ORE CRASH',text:'China stops building things. BHP, Vale, COAL Corp, Codelco, the Potosí silver mine and the Indonesian nickel nodes pay nothing for one full round.',
 run(){setMood('PANIC','iron ore falls off a cliff');suspendNodes(IRON_NODES,1);const ids=cardNodes(IRON_NODES);log('📉 Switched off for one round: '+(ids.length?ids.map(id=>NMAP[id].name.join(' ')).join(', '):'nothing owned — the mines were idle anyway')+'.')}},
{id:'ratecut',icon:'✂️',title:'RATE CUT',text:'The Governor blinks. Money is cheap again: everyone gains $2 and loses 1 Cortisol.',
 run(){setMood('BOOM','a rate cut — money is cheap again');S.players.forEach((pl,i)=>{gain(i,cs(2),'cheaper money');addCortisol(i,-1,'the Governor blinks')})}}
];
const WORLD_CARDS_B=[
{id:'houthis',icon:'🚢',title:'HOUTHIS IN THE RED SEA',text:'Drones over the shipping lane, insurers on the phone. All four chokepoints (Panama, Hormuz, Suez, Malacca) are blockaded until the end of next round, and the Tanker Fleet’s owner collects $3 in freight rates.',
 run(){setMood('PANIC','the Red Sea closes — insurers hang up');WORLD_CHOKEPOINTS.forEach(id=>{if(NMAP[id])S.blockades[id]=S.turn+2});log('🚢 Every chokepoint is blockaded until the end of next round.');const t=S.owner.tanker;if(t!=null)gain(t,cs(3),'freight rates through the roof')}},
{id:'sanctions',icon:'⛔',title:'SANCTIONS',text:'The communiqué is long and the loopholes are longer. '+SANCTION_WHO+' pay nothing for one full round, and each of their owners takes +1 Cortisol.',
 run(){setMood('PANIC','sanctions — the communiqué is long, the loopholes longer');suspendNodes(SANCTIONED_NODES,1);const ids=cardNodes(SANCTIONED_NODES);if(!ids.length){log('⛔ None of the sanctioned nodes has an owner — the communiqué lands on an empty desk.');return}log('⛔ Switched off for one round: '+ids.map(id=>NMAP[id].name.join(' ')).join(', ')+'.');new Set(ids.map(id=>S.owner[id])).forEach(o=>addCortisol(o,1,'sanctions bite','event'))}},
{id:'chinacoal',icon:'🛑',title:'CHINA BANS AUSTRALIAN COAL',text:'Beijing discovers a sudden quality concern. COAL Corp HQ, the Coal Train, the Docks, Watson and BHP pay nothing for two full rounds.',
 run(){setMood('PANIC','the ships wait off Qingdao — the coal does not move');suspendNodes(COAL_CHAIN,2);const ids=cardNodes(COAL_CHAIN);log('🛑 Switched off for two rounds: '+(ids.length?ids.map(id=>NMAP[id].name.join(' ')).join(', '):'nothing owned — the quay was empty anyway')+'.')}},
{id:'panamapapers',icon:'📂',title:'THE PANAMA PAPERS',text:'Eleven million documents, one very large leak. Each tax haven you own costs you +2 Cortisol, and APPLE’s owner takes an extra +1.',
 run(){setMood('FRENZY','the Panama Papers — eleven million documents');const ap=S.owner.w_apple;S.players.forEach((pl,i)=>{const n=cardNodes(TAX_HAVENS).filter(id=>S.owner[id]===i).length;const c=2*n+(ap===i?1:0);if(c>0)addCortisol(i,c,(n?n+' tax haven'+(n>1?'s':'')+' in the documents':'')+(n&&ap===i?', and ':'')+(ap===i?'Apple’s name on page one':''),'event')})}},
{id:'brics',icon:'🧮',title:'BRICS SUMMIT: DE-DOLLARISATION',text:'The leaders announce a currency, then a committee for the currency. For one full round BRICS member nodes pay double and American nodes pay half.',
 run(){setMood('FRENZY','de-dollarisation — a currency, then a committee');roundWindow('brics',1);log('🧮 For one full round BRICS members pay ×2 and American nodes pay half.')}},
{id:'elnino',icon:'🌊',title:'EL NIÑO',text:'The Pacific warms, the rain moves house. Fonterra, ANZCERTA, the Amazon and the Tulip Bulb pay nothing for one full round, and the Great Barrier Reef bleaches.',
 run(){setMood('CALM','El Niño — the rain has moved house');suspendNodes(AGRI_NODES,1);const ids=cardNodes(AGRI_NODES);log('🌊 Switched off for one round: '+(ids.length?ids.map(id=>NMAP[id].name.join(' ')).join(', '):'nothing owned — the paddocks were dry anyway')+'.');bleachReef()}},
{id:'tariffwar',icon:'🥊',title:'A TARIFF WAR',text:'Retaliation, retaliation to the retaliation, a press conference. Every TARIFF WALL surcharge and import duty doubles until the end of next round, and the WTO’s owner collects $3 in filing fees.',
 run(){setMood('PANIC','a tariff war — retaliation to the retaliation');S.tariffWarUntil=S.turn+2;log('🥊 The Tariff Wall surcharge is doubled until the end of next round.');const w=S.owner.w_wto;if(w!=null)gain(w,cs(3),'the filing fees roll in')}}
];
export const CARDS=[
{id:'oilspike',icon:'🛢️',title:'OIL SPIKES — WTI +12%',text:'Crude goes vertical. The pit pays out, the tankers get rich, and everyone but the QuikStop owner pays $1 at the pump.',
 run(){setMood('BOOM','WTI +12% — crude goes vertical');[['oil',6,'crude windfall'],['oilgraph',2,'the graph called it'],['tanker',3,'tankers rechartered at panic rates'],['petronas',3,'the national oil company'],['barrels',2,'the barrel yard']].forEach(a=>{const o=S.owner[a[0]];if(o!=null)gain(o,cs(a[1]),a[2])});const q=S.owner.quik;S.players.forEach((pl,i)=>{if(i===q)return;if(q==null)payVoid(i,cs(1),'fuel costs — nobody minds the till');else payTo(i,cs(1),q,'fuel costs → QuikStop')});}},
{id:'coalrush',icon:'🚃',title:'COAL RUSH',text:'Demand for black rock goes nuclear. Everything on rails and water makes money.',
 run(){setMood('BOOM','coal rush — everything on rails makes money');[['port',4,'the docks work overtime'],['train',2,'the train runs all night'],['tanker',3,'freight rates through the roof'],['coal',2,'COAL Corp books all of it'],['forklift',1,'pallets upon pallets'],['bhp',3,'the Big Australian books the tonnes']].forEach(a=>{const o=S.owner[a[0]];if(o!=null)gain(o,cs(a[1]),a[2])});}},
{id:'rates',icon:'🏛️',title:'RBA CASH-RATE DECISION',text:'Governor Bullock leans into the microphone. Money gets expensive — everyone pays $2, except the insiders.',
 run(){setMood('CALM','the RBA decides — the market holds its breath, then exhales');const r=S.owner.rba,b=S.owner.bullock;S.players.forEach((pl,i)=>{if(i===r||i===b)return;payFee(i,cs(2),'the cost of money')});if(r!=null)log('🏛️ '+pname(r)+' set the rate — pays nothing.');if(b!=null)log('👩‍💼 The Governor takes '+pname(b)+'’s calls — pays nothing.');const c=S.owner.cash;if(c!=null)gain(c,cs(2),'you literally set it');const j=S.owner.jim;if(j!=null)gain(j,cs(2),'the headline sells papers');const be=S.owner.bess;if(be!=null)gain(be,cs(2),'“BIG BESSENT” reacts live');const hs=S.owner.herald;if(hs!=null)gain(hs,cs(2),'THE JIM REAPER reprints the decision');}},
{id:'bondrevolt',icon:'💥',title:'BONDMAGEDDON',text:'“Government Bond: the collapse of the world’s safest investment.” Yields go vertical from Tokyo to Toronto.',
 run(){setMood('PANIC','“the collapse of the world’s safest investment”');const bd=S.owner.bond;S.players.forEach((pl,i)=>{const banks=NODES.filter(n=>n.type==='BANK'&&S.owner[n.id]===i).length;if(!banks)return;const amt=banks*cs(2);if(bd!=null)payTo(i,amt,bd,'the revolt eats '+banks+' bank position'+(banks>1?'s':'')+' → The Bond Desk');else payVoid(i,amt,'the revolt eats the banking book')});COUNTRY.forEach(c=>{const o=S.owner[c];if(o!=null)gain(o,cs(c==='japan'?3:1),NMAP[c].name.join(' ')+' pays its reader')});const t=S.owner.tenyear;if(t!=null)gain(t,cs(2),'the master chart was right');const be=S.owner.bess;if(be!=null)gain(be,cs(2),'Big Bessent called it on air');const br=S.owner.brad;if(br!=null)gain(br,cs(2),'he had it explained in the movie');const bs=S.owner.bigshort;if(bs!=null)gain(bs,cs(3),'the cinema saw it coming');const lk=S.owner.leak;if(lk!=null)gain(lk,cs(2),'the leak was first with it');}},
{id:'ceophoto',icon:'📸',title:'CEO PHOTO LEAKS — COAL CORP',text:'Mark Watson, photographed exactly where he should not have been. Someone is holding matches.',
 run(){setMood('FRENZY','CEO photo leaks — the front pages feed');const c=S.owner.coal;if(c==null){log('🚂 COAL CORP HQ is unowned — Watson denies everything to an empty room.');return}if(S.owner.watson===c){log('🕴️ Watson fronts the cameras himself — the photos are dismissed as “old”. No Cortisol.');return}if(S.owner.port===c)gain(c,cs(5),'shipped the coal before the news broke');if(S.owner.press===c||S.owner.fox===c){gain(c,cs(3),'the press room spins it beautifully');return}addCortisol(c,3,'the photos run on every front page','event');}},
{id:'tariffs',icon:'🦅',title:'TRUMP TWEETS TARIFFS',text:'ALL CAPS. Exclamation points. Global markets do a synchronized swan dive.',
 async run(){setMood('PANIC','TARIFFS! ALL CAPS! markets swan-dive');const t=S.owner.trump;let chain;const opts=[{label:'🛢️ OIL chain +$'+cs(3)+' each',v:'oil'},{label:'🚂 COAL chain +$'+cs(3)+' each',v:'coal'}];
 if(t!=null)chain=await askPlayer(t,{title:'TRUMP TWEETS TARIFFS',body:'You own THE DONALD — which chain gets the windfall?',options:opts,def:Math.random()<.5?'oil':'coal'});
 else chain=Math.random()<.5?'oil':'coal';
 const list=chain==='oil'?['oil','oilgraph','barrels','tanker','petronas']:['coal','train','port','watson','forklift','bhp'];
 const winners=new Set();list.forEach(id=>{const o=S.owner[id];if(o!=null){gain(o,cs(3),chain+' windfall via '+NMAP[id].name[0]);winners.add(o)}});
 const u=S.owner.us;if(u!=null){gain(u,cs(2),'the safe-haven bid');winners.add(u)}
 S.players.forEach((pl,i)=>{if(!winners.has(i))payVoid(i,cs(1),'the tariff bill')});
 if(t!=null)log('🦅 The tweet did numbers.');}},
{id:'besspeak',icon:'🎤',title:'BIG BESSENT SPEAKS',text:'The Treasury clears its throat. Bond desks straighten their ties. Markets listen.',
 run(){setMood('CALM','Big Bessent soothes the desk');const b=S.owner.bessent;if(b!=null)gain(b,cs(3),'the big man speaks');const d=S.owner.bond;if(d!=null)gain(d,cs(2),'the desk frontran the speech');const t=S.owner.tenyear;if(t!=null)gain(t,cs(2),'yields obey');const br=S.owner.brad;if(br!=null)gain(br,cs(2),'he had it explained to him');}},
{id:'budget',icon:'📰',title:'THE JIM DELIVERS THE BUDGET',text:'“The Jim…” reads numbers to a sleepy chamber. Somebody, somewhere, is counting.',
 run(){setMood('CALM','the budget is delivered — mostly numbers');const s=S.owner.spend;if(s!=null)gain(s,cs(3),'the spending graphic glows');const ch=S.owner.chalmers;if(ch!=null)gain(ch,cs(2),'the Treasurer delivers');const j=S.owner.jim;if(j!=null)gain(j,cs(2),'the exclusive pays');const hs=S.owner.herald;if(hs!=null)gain(hs,cs(2),'THE JIM REAPER special edition');const a=S.owner.albo;if(a!=null)gain(a,cs(1),'the PM signs it');S.players.forEach((pl,i)=>{if(i!==s&&i!==ch&&i!==j&&i!==a&&i!==hs)payVoid(i,cs(1),'return to sender (taxes)')});}},
{id:'mpcfinals',icon:'🏆',title:'MONETARY POLICY COMPETITION FINALS',text:'The RBA’s big night. Schools. Charts. Trophies. JTPortal is rumoured to be judging.',
 run(){setMood('BOOM','monetary policy finals — the schools deliver');const m=S.owner.mpc;if(m!=null){gain(m,cs(4),'the champions’ purse');giveIntel(m,1,'the finalists’ data')}const sc=S.owner.school;if(sc!=null)gain(sc,cs(2),'the school places');const ib=S.owner.ib;if(ib!=null)gain(ib,cs(2),'the IB cohort delivers');const jt=S.owner.jt;if(jt!=null)giveIntel(jt,1,'JTPortal judged the submissions');}},
{id:'sisyroll',icon:'🪨',title:'THE BOULDER ROLLS BACK DOWN',text:'Empires, portfolios, homework — everything heavy slides. The biggest players feel it most.',
 run(){setMood('CALM','the boulder rolls back down, as ever');const counts=S.players.map((pl,i)=>NODES.filter(n=>S.owner[n.id]===i).length);const mx=Math.max(0,...counts);if(mx<=0){log('🪨 Nobody holds anything yet — the boulder rolls past an empty table.');return}S.players.forEach((pl,i)=>{if(counts[i]===mx&&S.owner.sisy!==i)payVoid(i,cs(2),'the boulder finds the biggest stack')});const s=S.owner.sisy;if(s!=null)log('🪨 '+pname(s)+' is used to this — immune.');}},
{id:'goldrush',icon:'🪙',title:'GOLD RUSH',text:'The gold-coloured coins gleam. Paper money suddenly looks like a rumor.',
 run(){setMood('BOOM','gold gleams — paper looks like a rumor');const g=S.owner.gold;if(g!=null)gain(g,cs(5),'everything gleams');const n=S.owner.notes;if(n!=null)gain(n,cs(2),'collectors pay up');const bh=S.owner.bhp;if(bh!=null)gain(bh,cs(3),'ore prices sneak up with the gold');S.players.forEach((pl,i)=>{if(i!==g&&i!==n&&i!==bh)payVoid(i,cs(1),'inflation bites')});}},
{id:'rockcooks',icon:'💪',title:'THE ROCK COOKS',text:'A gym, a blender, a set of books that needed cooking. The smell is unmistakable.',
 run(){setMood('CALM','the books are cooked; the gym is calm');const r=S.owner.rock;if(r!=null){gain(r,cs(3),'ladder of opportunity');addCortisol(r,-1,'the calm after the cook')}else log('💪 Nobody owns The Rock. The books stay raw.');}},
{id:'davos',icon:'🏔️',title:'DAVOS — THE CONFERENCE STAGE',text:'Lanyards, panels, fondue. Global networks tighten over canapés.',
 run(){setMood('FRENZY','Davos — lanyards, panels, fondue');const w=S.owner.wef;if(w!=null)gain(w,cs(3),'the big table pays out');const b=S.owner.bessent;if(b!=null)gain(b,cs(2),'a familiar face on the panel');Object.keys(S.bugs).forEach(nid=>{const o=S.bugs[nid];S.players[o].money+=cs(1);log('🏔️ Global skim from '+NMAP[nid].name.join(' ')+': '+pname(o)+' +$'+cs(1)+'.')});}},
{id:'quikrob',icon:'🎭',title:'QUIKSTOP ROBBERY',text:'A ski mask, a shopping bag, an empty register. The tapes are… missing.',
 run(){setMood('CALM','a ski mask, a shopping bag, an empty register');const q=S.owner.quik;if(q==null){S.players.forEach((pl,i)=>payVoid(i,cs(1),'nobody was watching the till'));return}payVoid(q,cs(2),'gone, just gone');const b=S.owner.bond007;if(b!=null)gain(b,cs(2),'he was there in disguise (allegedly)');}},
{id:'ibexams',icon:'📝',title:'IB EXAMS',text:'Papers, calculators, despair. The Diploma Programme does not grade on charisma.',
 run(){setMood('CALM','IB exams — despair, indexed');const ib=S.owner.ib;if(ib!=null)giveIntel(ib,2,'HL Economics pays off');const sc=S.owner.school;if(sc!=null)giveIntel(sc,1,'the cohort crammed');S.players.forEach((pl,i)=>{const charts=NODES.filter(n=>n.type==='CHART'&&S.owner[n.id]===i).length;if(charts===0&&pl.intel>0){pl.intel-=1;fxAt(i,'🛈−1','#55c1ff');log('📝 '+pname(i)+' didn’t do the reading: −1 Intel.')}});}},
{id:'profit',icon:'⛽',title:'PROFIT WARNING… FOR OTHERS',text:'Markets wobble, people stress-eat. Quikstop does just fine.',
 run(){setMood('CALM','profit warning… for others');const q=S.owner.quik;if(q!=null)gain(q,cs(4),'snack economics');else log('⛽ Quikstop is unowned — the profits drift away.');}},
{id:'quiet',icon:'🌙',title:'A QUIET QUARTER',text:'No tweets, no leaks, no rate decisions. Everyone quietly pockets a little extra.',
 run(){setMood('CALM','a quiet quarter — no tweets, no leaks');S.players.forEach((pl,i)=>gain(i,cs(2),'a quiet quarter'));}},
{id:'snoop',icon:'🔍',title:'REGULATORS SNOOP AROUND',text:'Somebody asked one question too many. The sweatiest players get a second look.',
 run(){setMood('CALM','regulators asking one question too many');const mx=Math.max(0,...S.players.map(pl=>pl.cortisol));if(mx<=0){log('🔍 Nobody has any Cortisol — the regulators go for coffee.');return}S.players.forEach((pl,i)=>{if(pl.cortisol===mx)addCortisol(i,1,'regulators circling','event')});}},
{id:'tip',icon:'✉️',title:'ANONYMOUS TIP',text:'A brown envelope with no return address. Everyone learns something.',
 run(){setMood('CALM','a brown envelope, no return address');S.players.forEach((pl,i)=>giveIntel(i,1,'the envelope'));log('✉️ Every player gains 1 Intel.');}},
{id:'frenzy',icon:'🗣️',title:'MEDIA FRENZY',text:'“Quite frankly…” The press needs a villain before deadline. Whoever owns the narrative picks one.',
 async run(){setMood('FRENZY','the press needs a villain before deadline');const pi=S.owner.press;if(pi==null){log('🗣️ The Press Room is unowned — the story dies in committee.');return}const rivals=S.players.map((pl,i)=>i).filter(i=>i!==pi);const opts=rivals.map(i=>({label:S.players[i].name+' +2 🔥',v:i}));opts.push({label:'Sit on the story',v:-1});const v=await askPlayer(pi,{title:'MEDIA FRENZY',body:'You control the PRESS ROOM — torch which rival?',options:opts,def:-1});if(isRival(pi,v))addCortisol(v,2,'front-page frenzy','event');}},
{id:'crackdown',icon:'🚨',title:'MONOPOLY ALERT',text:'The regulators finally do something: every open ACCC and ASIC file on the table gains +1 scrutiny. Rulings still wait for each offender’s turn start.',
 run(){setMood('PANIC','crackdown — the regulators sweep the table');acccReconcile();const files=acccFileList();if(!files.length)log('🚨 The regulators sweep the table — no open files, the sweep finds nothing.');else files.forEach(f=>{f.s++;log('🚨 The sweep lands on '+fileName(f)+' — scrutiny '+f.s+'/'+ACCC_RULING+(f.s>=ACCC_RULING?'; the ruling lands at their turn start.':'.'));fxAt(f.pi,'📁 +1 SCRUTINY','#55c1ff')});const bs=S.owner.bigshort;if(bs!=null)gain(bs,cs(3),'the cinema called it');}},
{id:'tapes',icon:'🗑️',title:'THE TAPES GO MISSING',text:'A shredder runs all night. What you knew, you no longer know — unless you kept copies.',
 run(){setMood('CALM','the tapes go missing — a shredder runs all night');S.players.forEach((pl,i)=>{if(S.owner.whistle===i){giveIntel(i,2,'the Whistleblower kept copies')}else if(S.owner.jt===i){giveIntel(i,2,'JTPortal keeps backups')}else if(pl.intel>0){pl.intel-=1;fxAt(i,'🛈−1','#55c1ff');log('🗑️ '+pname(i)+' loses 1 Intel — the tapes are gone.')}});}},
{id:'bigscreen',icon:'🎬',title:'THE BIG SHORT SCREENING',text:'Brad Pitt explains subprime with a Jenga tower. Everyone watches. Nobody learns.',
 run(){setMood('FRENZY','The Big Short screens to a packed house');const bs=S.owner.bigshort;if(bs!=null)gain(bs,cs(3),'packed house');const br=S.owner.brad;if(br!=null)gain(br,cs(2),'he was right there on screen');const h=S.owner.hedge;if(h!=null)gain(h,cs(2),'somebody was short the whole time');}},
{id:'madeout',icon:'🟣',title:'MADE PAYS OUT… PROBABLY',text:'The purple graphic does… something. Money appears. Explanations do not.',
 run(){setMood(S.mood,'MADE does… something');if(Math.random()<1/3){madePay();log('🟣 MADE has paid out. Nobody knows why. NOBODY.')}else log('🟣 MADE remains unexplained. Again.');}}
].concat(CARDS_B);
/* 🌐 Global Edition only: dealt into the deck when the world exhibits are on (the classic 24 are untouched) */
export const WORLD_CARDS=[
{id:'coral',icon:'🪸',title:'CORAL BLEACHING',text:'The water runs two degrees too warm. The Great Barrier Reef goes white from the edges in: its blockade and its income are switched off for the next two rounds, and whoever owns it takes +1 Cortisol.',
 run(){setMood('CALM','the reef goes white — the tourist board calls it “seasonal”');bleachReef()}}
].concat(WORLD_CARDS_B);
export const CARDBYID={};CARDS.forEach(c=>CARDBYID[c.id]=c);WORLD_CARDS.forEach(c=>CARDBYID[c.id]=c);
/* the cards actually in the deck: the Global Edition adds its own */
export function activeCards(){return S&&S.dlcWorld?CARDS.concat(WORLD_CARDS):CARDS}
