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
import { NODES, NMAP, EDGES, ADJ, GEO_NODE_IDS, OIL_IDS, COUNTRY, MOODS, PCOLORS, QUIK_SLOTS, charMeta, charSrc, rebuildWorld } from './data.js';
import { generateRandomBoard, generateRingworldBoard, generateMegaRingBoard, applyLayoutFromState } from './boards.js';
export { hooks, setHooks };
/* The host services the rules call, bound late so a hook swapped in by setHooks
   (or wrapped by a test) is always the one that runs. */
const sync=now=>hooks.sync(now),sysTo=(pi,msg)=>hooks.sysTo(pi,msg),askPlayer=(pi,opt)=>hooks.askPlayer(pi,opt),announceAll=(title,html)=>hooks.announceAll(title,html),revealAll=(title,html)=>hooks.revealAll(title,html);
/* ================= STATE & HELPERS ================= */
let fxSeq=0;
export function pname(i){return S.players[i].name}
export function log(t){S.log.push(t);S.logN=(S.logN|0)+1}
/* ---- floating FX: visible on every screen, driven purely by synced state ---- */
export function fx(x,y,t,c,big){if(Net.role!=='host'||!S)return;S.fx.push({id:++fxSeq,x,y,t,c,b:big?1:0});if(S.fx.length>40)S.fx.shift()}
export function fxAt(pi,t,c){if(!S||!S.players[pi])return;const n=NMAP[S.players[pi].pos];if(n)fx(n.x,n.y-64,t,c)}
/* 🌍 Projectile fx: missiles and the Qantas jet fly their route as a rotating
   <image>. Entries ride S.fx (synced by pubState) with proj:1 and carry both
   endpoints; the rig rotates toward the target and mirrors when flying left.
   Rendering happens in #fxg so board re-renders never interrupt the flight. */
export const PROJ_DEFS={
 missile:{img:'./static/GeographyDLC/missile_travelling.png',w:116,h:125,base:45},
 fly:{img:'./static/qantas_jet_travelling.png',w:150,h:103,base:10}
};
export function projFx(kind,fromId,toId){
 if(Net.role!=='host'||!S)return false;
 const d=PROJ_DEFS[kind],a=NMAP[fromId],b=NMAP[toId];
 if(!d||!a||!b||fromId===toId)return false;
 S.fx.push({id:++fxSeq,proj:1,img:d.img,base:d.base,w:d.w,h:d.h,x0:a.x,y0:a.y-40,x1:b.x,y1:b.y-40,x:a.x,y:a.y-40});
 if(S.fx.length>40)S.fx.shift();
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
}

/* ACCC concentration: more than 2 holdings in one industry (charts excluded). */
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
export function industryNodes(g){
 if(g.ids)return g.ids.map(id=>NMAP[id]).filter(Boolean);
 return NODES.filter(g.pick);
}
export function ownedInIndustry(pi,g){return industryNodes(g).filter(n=>S.owner[n.id]===pi)}
export function concentratedIndustries(pi){
 return INDUSTRIES.map(g=>{const owned=ownedInIndustry(pi,g);return {g,owned,n:owned.length}}).filter(x=>x.n>2);
}
export function acccInvestigate(pi){
 if(!S||S.over)return;
 let hits=concentratedIndustries(pi);
 // Mark Watson exempts the holder from ACCC action against the COAL industry only.
 if(S.owner.watson===pi)hits=hits.filter(x=>x.g.id!=='coal');
 if(!hits.length)return;
 if(Math.random()>=1/3)return
 hits.sort((a,b)=>b.n-a.n||a.g.name.localeCompare(b.g.name));
 const hit=hits[0],offender=S.players[pi];
 /* MONETARY POLICY books are market manipulation — ASIC's file, not the ACCC's.
    Mechanics are unchanged: 33% trigger, 20% fines, forced divestment. */
 const isAsic=hit.g.id==='monetary';
 const agency=isAsic?'ASIC':'ACCC';
 const crime=isAsic?'MARKET MANIPULATION':'MONOPOLY ALERT';
 const divested=shuffle(hit.owned.slice());
 // Give at most one node to each rival; any remaining nodes return to the market.
 divested.forEach(n=>{delete S.owner[n.id];delete S.bugs[n.id];fx(n.x,n.y-70,'🧐 DIVESTED','#55c1ff')});
 if(divested.some(n=>n.id==='sisy'))S.sisyPayout=10;
 const recipients=shuffle(S.players.map((_,i)=>i).filter(i=>i!==pi));
 const transfers=[];
 for(let i=0;i<Math.min(divested.length,recipients.length);i++){
  const node=divested[i],recipient=recipients[i];
  S.owner[node.id]=recipient;
  transfers.push({node,recipient});
  fxAt(recipient,'+'+node.name.join(' '),'#55c1ff');
 }
 const moneyFine=Math.floor(offender.money*0.20);
 const intelFine=Math.floor(offender.intel*0.20);
 if(moneyFine>0)payVoid(pi,moneyFine,isAsic?'ASIC market-manipulation fine (20%)':'ACCC monopoly fine (20%)');
 if(intelFine>0){offender.intel-=intelFine;fxAt(pi,'🛈−'+intelFine,'#55c1ff');log('🛈 '+pname(pi)+' pays an '+agency+' fine of '+intelFine+' Intel (20%).')}
 const transferText=transfers.length?transfers.map(t=>esc(t.node.name.join(' '))+' → '+esc(S.players[t.recipient].name)).join('; '):'none — all divested nodes return to the market';
 const lost=divested.slice(transfers.length).map(n=>n.name.join(' '));
 log((isAsic?'⚖️':'🧐')+' '+(isAsic?'MARKET MANIPULATION! ':'MONOPOLY ALERT! ')+pname(pi)+' is forced to dump the whole '+hit.g.name+' book ('+hit.owned.map(n=>n.name.join(' ')).join(', ')+'). Redistributed: '+(transfers.length?transfers.map(t=>t.node.name.join(' ')+' to '+pname(t.recipient)).join(', '):'none')+'. '+(lost.length?'Returned to market: '+lost.join(', ')+'. ':'')+'Fine: $'+moneyFine+' and '+intelFine+' Intel.');
 fxAt(pi,isAsic?'MARKET MANIPULATION':'MONOPOLY ALERT','#55c1ff',true);
 announceAll(isAsic?'ASIC MARKET MANIPULATION':'MONOPOLY ALERT',
  monopolyAlertFace(esc(offender.name)+' held more than two '+esc(hit.g.name)+' properties.',isAsic)
  +'<p>The '+agency+' breaks up the book. Divested: <b>'+hit.owned.map(n=>esc(n.name.join(' '))).join('</b>, <b>')+'</b>.</p>'
  +'<p>Randomly redistributed (max one node per rival): '+transferText+'.'+(lost.length?' Remaining nodes return to the market: <b>'+lost.map(esc).join('</b>, <b>')+'</b>.':'')+'</p>'
  +'<p>Fine: <b>$'+moneyFine+'</b> and <b>'+intelFine+' Intel</b> (20% of current balances).</p>');
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
 rebuildWorld(!!Net.dlcGeo);
 const boardLayout=Net.boardLayout||(Net.ringworld?'ringworld':'random');
 const quikSlot=(boardLayout==='ringworld'||boardLayout==='megaring')?0:Math.floor(Math.random()*QUIK_SLOTS.length);
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
 setS({backroomAbilityUsed:false,players:seated.map((d,i)=>({name:d.name,color:(charMeta(d.char)||{}).color||PCOLORS[i%PCOLORS.length],char:d.char||null,money:15,intel:2,cortisol:0,raided:0,pos:'quik',visited:{quik:true},dc:false,bot:!!d.bot})),cur:0,turn:1,phase:'move',steps:3,goal,owner:{},bugs:{},seizeCount:{},sisyPayout:10,deck:shuffle(CARDS.map(c=>c.id)),discard:[],spun:false,audited:false,cooked:false,budgeted:false,extraStep:false,slipped:false,caution:false,dossier:false,jtUsed:false,spinKind:'press',mood:'CALM',wire:'all quiet on the wire… for now',fx:[],over:false,mode:null,log:[],chat:(Net.lobbyChat||[]).slice(-25),logN:0,chatN:0,quikSlot,boardLayout:null,boardEdges:null,layoutKind:boardLayout,ringworld:boardLayout==='ringworld',dlcGeo:!!Net.dlcGeo,fogOfWar:!!Net.fogOfWar,rubble:{},ov:null,geoMissiled:false,geoBeach:false,geoBoeing:false,geoCrash:false,geoStage5:false,geoVenice:false,bondmageddonUsed:false,blockades:{},blockadeUsed:false,missileProbe:null,qantasGroundUntil:0,decline:null});
 const slot=QUIK_SLOTS[quikSlot];
 {const bots=hooks.bots();if(bots&&bots.resetForGame)bots.resetForGame((hooks.botSeed()|0)||((Math.random()*0x7fffffff)|0))}
 const generated=boardLayout==='megaring'?generateMegaRingBoard():(boardLayout==='ringworld'?generateRingworldBoard():generateRandomBoard(slot));S.boardLayout=generated.positions;S.boardEdges=generated.edges;
 applyLayoutFromState();
 Net.started=true;
 log('🌅 A new board is dealt — '+NODES.length+' exhibits, '+EDGES.length+' freshly rebuilt connections, '+S.players.length+' at the table.');
 if(boardLayout==='ringworld')log('⭕ RINGWORLD — every exhibit is arranged around central Quikstop in three concentric rings.');
 else if(boardLayout==='megaring')log('⭕ MEGA RING — every exhibit sits on one large ring, connected to the central Quikstop hub.');
 else log('🧭 High-value targets are seeded further from Quikstop; the board and routes are reshuffled every game.');
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
 S.phase='move';S.mode=null;S.spun=false;S.audited=false;S.cooked=false;S.budgeted=false;S.pressured=false;S.extraStep=false;S.slipped=false;S.dossier=false;S.blockadeUsed=false;
 if(S.dlcGeo){S.geoMissiled=false;S.geoBeach=false;S.geoBoeing=false;S.geoCrash=false;S.geoStage5=false;S.geoVenice=false}
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
 acccInvestigate(S.cur);
 
 const rail=(S.owner.train===S.cur||S.owner.bullet===S.cur)?1:0;
 S.steps=underCaution?1:3+(S.owner.coal===S.cur?1:0)+rail+(S.owner.asics===S.cur?1:0);
 p.raided=0;
 sysTo(S.cur,'👁️ YOUR TURN, '+p.name.toUpperCase());
 sync(true);
 if(await winCheck())return;
 if(jtHolder&&!p.dc)await jtBriefing(S.cur);
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
 out.pi=pi;
 out.curSeat=S.cur;
 out.cardIds=CARDS.map(x=>x.id);
 out.discardIds=S.discard.slice();
 out.country=COUNTRY.slice();
 out.oilIds=OIL_IDS.slice();
 out.edges=EDGES.map(e=>e.slice());
 out.nodes=NODES.map(n=>({id:n.id,type:n.type,income:n.income,cost:n.cost}));
 out.industryIds=INDUSTRIES.map(g=>({id:g.id,ids:industryNodes(g).map(n=>n.id)}));
 out.nmap={};NODES.forEach(n=>{out.nmap[n.id]={id:n.id,type:n.type,income:n.income,cost:n.cost}});
 out.moodRate=(MOODS[S.mood]||{rate:2}).rate;
 out.geo={qantasGrounded:!!(S.dlcGeo&&qantasGrounded())};
 out.geoUsed={stage5:!!S.geoStage5,crash:!!S.geoCrash,boeing:!!S.geoBoeing};
 out.seizePrice=(seat,nid)=>seizeListPrice(seat,NMAP[nid]);
 out.takePrice=(seat,nid,base)=>takeoverCost(seat,nid,base);
 out.flatSeize=nid=>flatSeize(nid);
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
 const p=S.players[i];const own=id=>S.owner[id]===i;
 const owned=NODES.filter(n=>S.owner[n.id]===i);
 let salary=3;if(own('infl'))salary=4;
 let holdSum=0;owned.forEach(n=>{let v=n.income;if(n.type==='CHART'&&own('ib'))v*=2;if(n.id==='qantas'&&S.dlcGeo&&qantasGrounded())v=0;holdSum+=v});
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
 if(own('rock'))syn+=new Set(owned.map(n=>n.type)).size;
 if(own('bessent')&&bank)syn+=bank;
 if(own('chalmers')&&reg)syn+=reg;
 if(own('watson')&&own('coal'))syn+=2;
 if(own('mpc')&&chart)syn+=chart;
 if(S.dlcGeo&&own('geo_pyoncity')){let gc=0;GEO_NODE_IDS.forEach(gid=>{if(S.owner[gid]===i)gc++});if(gc)syn+=gc}
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
export async function applyIntent(pi,m){
 if(!S||S.over||!m||!m.act)return;
 if(S.cur!==pi){sysTo(pi,'Not your turn.');return}
 if(Net.lock){sysTo(pi,'⏳ Your previous action is still resolving — please wait a moment.');return} Net.lock=true;hooks.clearTimeout(Net.lockTimer);Net.lockTimer=hooks.setTimeout(()=>{if(Net.lock){console.error('[BIGCON] stale action lock released');Net.lock=false;Net.lockTimer=null;sync()}},30000);
 try{
  const act=m.act,p=S.players[pi];
  if(act==='move'&&S.phase==='move'&&!S.mode){
   if(S.steps<=0)return;
   if(!(ADJ[p.pos]||[]).includes(m.id)){sysTo(pi,'You can only move along the red threads.');return}
   await doMove(pi,m.id);
  }
  else if(act==='favor'&&S.phase==='move'&&!S.extraStep&&p.intel>=1){
   p.intel--;S.extraStep=true;S.steps++;
   log('🤝 '+pname(pi)+' cashes a favor — +1 step this turn.');
   fxAt(pi,'🛈−1 · +1 step','#55c1ff');sync();
  }
  else if(act==='endmove'&&S.phase==='move'){await endMovement()}
  else if(act==='flymode'&&S.phase==='move'&&!S.mode&&S.owner.qantas===pi&&p.money>=3){S.mode='fly';sync()}
  else if(act==='slip'&&S.phase==='move'&&!S.slipped&&S.owner.f1===pi&&p.money>=2){
   p.money-=2;S.slipped=true;S.steps+=2;
   log('🏎️ '+pname(pi)+' takes the slipstream — +2 steps and $2 off the next seizure.');
   fxAt(pi,'−$2 · +2 steps','#f5c542');sync();
  }
  else if(act==='fly'&&S.phase==='move'&&S.mode==='fly'){await doFly(pi,m.id)}
  else if(act==='cancel'){S.mode=null;sync()}
  else if(act==='seize'&&S.phase==='action'&&!S.mode){await doSeize(pi)}
  else if(act==='bugmode'&&S.phase==='action'&&!S.mode){S.mode='bug';sync()}
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
    delete S.owner[launcherId];delete S.bugs[launcherId];S.rubble[launcherId]=1;
    fx(NMAP[launcherId].x,NMAP[launcherId].y-70,'💥 BACKFIRE','#ff6b5e');
    log('💥 '+pname(pi)+'’s '+launcherName+' is destroyed in the backblast — rubble, no payout, no refund.');
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
  else if(act==='rebuild'&&S.phase==='action'&&S.dlcGeo&&!S.mode&&S.rubble[p.pos]){
   const n=NMAP[p.pos],cost=n.cost;
   if(p.money<cost){sysTo(pi,'Rebuilding '+n.name.join(' ')+' costs $'+cost+' — you cannot afford it.');return}
   p.money-=cost;fxAt(pi,'−$'+cost,'#ff6b5e');delete S.rubble[p.pos];
   fx(n.x,n.y-64,'♻️ REBUILT','#7fe08d');
   log('♻️ '+pname(pi)+' pays $'+cost+' to rebuild '+n.name.join(' ')+'. It returns unowned — first bids from next turn.');
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
   if(!n||o==null||o===pi||S.rubble[m.id]){sysTo(pi,'Overtourism targets a rival-owned node that still stands.');S.mode=null;sync();return}
   /* ESG does not protect against Overtourism. */
   if(p.money<2||S.geoVenice){S.mode=null;sync();return}
   p.money-=2;fxAt(pi,'−$2','#ff6b5e');
   S.geoVenice=true;S.ov={nid:m.id,by:pi,targetOwner:o,expiresAt:S.turn*S.players.length+S.cur+S.players.length};S.mode=null;
   fx(n.x,n.y-60,'🛳️ OVERTOURISM','#e19bff');
   log('🛳️ '+pname(pi)+' sends the cruise ships to '+n.name.join(' ')+' — OVERTOURISM: '+pname(o)+' takes +1 Cortisol on their next turn.');
   await finishNodeAbility(pi);
  }
  else if(act==='blockmode'&&S.phase==='action'&&!S.mode&&S.owner.albo===pi&&!S.blockadeUsed){S.mode='blockade';sync()}
  else if(act==='blockade'&&S.phase==='action'&&S.mode==='blockade'){
   const n=NMAP[m.id];
   if(!n||S.rubble[m.id]||blockaded(m.id)){sysTo(pi,'That node is rubble or already walled off.');S.mode=null;sync();return}
   S.blockades[m.id]=S.turn+2;S.blockadeUsed=true;S.mode=null;
   fx(n.x,n.y-64,'🚧 BLOCKADED','#f5c542');
   log('🚧 '+pname(pi)+' walls off '+n.name.join(' ')+' — BLOCKADED until the end of next round: nobody walks in, nobody lands, not even '+pname(pi)+'.');
   await finishNodeAbility(pi);
  }
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
   const rivals=S.players.map((pl,j)=>j).filter(j=>j!==pi);
   if(!rivals.length){sysTo(pi,'There is nobody else at the table.');return}
   const target=await askPlayer(pi,{title:'CORTISOL OVERLOAD — 30 INTEL',body:'Choose one rival to receive +6 Cortisol.',options:rivals.map(j=>({label:pname(j)+' · '+S.players[j].cortisol+'/9 Cortisol',v:j})).concat([{label:'Cancel',v:-1}]),def:-1});
   if(target<0){sync();return}
   if(!Number.isInteger(target)||target===pi||!S.players[target]){sysTo(pi,'Choose a valid rival.');sync();return}
   if(S.cur!==pi||S.phase!=='action'||S.over||p.intel<30){sysTo(pi,'The overload is no longer available.');sync();return}
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
   const rivals=S.players.map((pl,j)=>j).filter(j=>j!==pi&&NODES.some(nn=>S.owner[nn.id]===j&&!S.rubble[nn.id]));
   if(!rivals.length){sysTo(pi,'There are no rivals with intact holdings to target.');return}
   const target=await askPlayer(pi,{title:'BONDMAGEDDON — CHOOSE TARGET',body:'Choose which rival to target with all four missiles.',options:rivals.map(j=>({label:pname(j)+' · '+NODES.filter(nn=>nn.type==='CHART'&&S.owner[nn.id]===j).length+' CHART holdings',v:j})).concat([{label:'Cancel',v:-1}]),def:-1});
   if(target<0){sync();return}
   if(!Number.isInteger(target)||target===pi||!rivals.includes(target)){sysTo(pi,'Choose a valid rival with intact holdings.');sync();return}
   if(S.cur!==pi||S.phase!=='action'||S.mode||S.over||S.owner.bond!==pi||S.owner.leak!==pi||S.bondmageddonUsed||p.money<16||p.intel<4){sysTo(pi,'Bondmageddon is no longer available.');sync();return}
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
/* A seat index from the wire: a real seat at this table that is not the actor. */
export function isRival(pi,t){return Number.isInteger(t)&&t!==pi&&!!(S&&S.players[t])}
export function canUseBackroomAbility(pi){return !!(S&&S.phase==='move'&&S.cur===pi&&S.owner.back===pi&&!S.backroomAbilityUsed&&S.steps>=2)}
export function abilityPhase(pi){return !!(S&&(S.phase==='action'||canUseBackroomAbility(pi)))}
export async function finishNodeAbility(pi){
 if(canUseBackroomAbility(pi)){S.steps-=2;S.backroomAbilityUsed=true;S.mode=null;log('🤝 Backroom Deals lets '+pname(pi)+' use one node ability during movement (−2 movement steps).');fxAt(pi,'−2 STEPS','#e19bff');sync()}
 else await endOfTurn();
}
export function qantasGrounded(){return !!(S&&S.dlcGeo&&S.qantasGroundUntil>S.turn)}
export function qantasGroundedReason(){if(!S)return '';return qantasGrounded()?'THE CORPORATE BOEING is parked on the runway':'QANTAS is not grounded'}
export function strikeNode(pi,nid,opts){
 const silent=opts&&opts.silent;
 const n=NMAP[nid],prev=S.owner[nid];
 if(prev!=null)delete S.owner[nid];
 delete S.bugs[nid];
 S.rubble[nid]=1;
 if(S.ov&&S.ov.nid===nid)S.ov=null;
 fx(n.x,n.y-70,'💥 MISSILE','#ff6b5e');
 log('🚀 '+pname(pi)+' launches a missile at '+n.name.join(' ')+(prev!=null?' — '+pname(prev)+' is expropriated with NO payout.':' — an unowned exhibit goes up in smoke.')+' What is left is rubble: no income, nothing to seize, until someone arrives and pays $'+n.cost+' to rebuild it.');
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
export function blockaded(id){return !!(S&&S.blockades&&S.blockades[id]>S.turn)}
export function seizeListPrice(pi,n){
 let base=n.cost;
 if(S.owner.golf===pi)base=Math.max(1,base-1);
 if(n.type==='CHART'){if(S.owner.nab===pi)base=Math.max(1,base-1);if(S.owner.econ===pi)base=Math.max(1,base-1)}
 return base;
}
export function flatSeize(nid){return nid==='made'||nid==='qantas'||nid==='rba'||nid==='geo_pillars'}
export function takeoverCost(pi,nid,base){
 if(flatSeize(nid))return base;
 if(S.dossier)return base;
 const prior=S.seizeCount[nid]||0;
 return base*Math.pow(2,Math.max(1,prior));
}
export async function doMove(pi,id){
 if(!canReach(id)){sysTo(pi,qantasGroundedReason()+' — the jet is still at the gate.');return}
 if(blockaded(id)){sysTo(pi,NMAP[id].name.join(' ')+' is BLOCKADED — nobody gets in.');return}
 const prevPos=S.players[pi].pos;
 const owner=S.owner[id];
 if(owner!=null&&owner!==pi){
  if(S.owner.bond007===pi){log('🤵 007 flashes… credentials. No toll.')}
  else{
   const toll=(S.owner.albo===owner)?2:1;const p=S.players[pi];
   if(p.money<toll){sysTo(pi,'Toll: you cannot afford the $'+toll+' to enter '+NMAP[id].name.join(' ')+'.');return}
   p.money-=toll;S.players[owner].money+=toll;
   fxAt(pi,'−$'+toll,'#ff6b5e');fxAt(owner,'+$'+toll,'#7fe08d');
   log('🛂 '+pname(pi)+' pays $'+toll+' toll to '+pname(owner)+(toll===2?' — the PM closed the road.':'.'));
  }
 }
 S.players[pi].pos=id;S.steps--;
 if(S.dlcGeo&&id==='geo_tuvalu'&&S.owner[id]==null&&!S.rubble[id]){
  S.owner[id]=pi;const n=NMAP[id];
  fx(n.x,n.y-64,'🏝️ CLAIMED','#7fe08d');
  log('🏝️ '+pname(pi)+' lands in TUVALU — THE JOIN IS FREE. First arrival claims it: no action, no cost, no Cortisol.');
 }
 if(!S.players[pi].visited)S.players[pi].visited={};S.players[pi].visited[id]=true;
 if(prevPos==='sisy'&&id!=='sisy'&&S.owner.back!==pi)S.sisyPayout=10;
 log('→ '+pname(pi)+' moves to '+NMAP[id].name.join(' ')+'.');
 if(S.steps<=0)await endMovement();else sync();
}
export async function doFly(pi,id){
 const p=S.players[pi];
 if(!NMAP[id]||id===p.pos){sysTo(pi,'Pick somewhere else on the board to land.');return}
 if(!canReach(id)){sysTo(pi,qantasGroundedReason()+' — you cannot land there yet.');S.mode=null;sync();return}
 if(blockaded(id)){sysTo(pi,NMAP[id].name.join(' ')+' is BLOCKADED — you cannot land there.');S.mode=null;sync();return}
 if(p.money<3){sysTo(pi,'The Flying Kangaroo wants $3 for the seat.');S.mode=null;sync();return}
 const prevFlyPos=p.pos;
 p.money-=3;fxAt(pi,'−$3','#ff6b5e');S.mode=null;p.pos=id;S.steps=0;
 const flew=projFx('fly',prevFlyPos,id);
 if(S.dlcGeo&&id==='geo_tuvalu'&&S.owner[id]==null&&!S.rubble[id]){
  S.owner[id]=pi;const n=NMAP[id];
  fx(n.x,n.y-64,'🏝️ CLAIMED','#7fe08d');
  log('🏝️ '+pname(pi)+' jets into TUVALU — THE JOIN IS FREE. First arrival claims it: no action, no cost, no Cortisol.');
 }
 if(!p.visited)p.visited={};p.visited[id]=true;
 if(prevFlyPos==='sisy'&&id!=='sisy'&&S.owner.back!==pi)S.sisyPayout=10;
 log('✈️ '+pname(pi)+' takes the Qantas jet straight to '+NMAP[id].name.join(' ')+'.');
 if(flew){sync();await projPause()} /* the jet flies before the landing opens the next phase */
 await endMovement();
}
export async function endMovement(){
 if(!S||S.over||S.phase!=='move')return;
 S.phase='action';sync();
 await maybePeek();
 sync();
}
export async function maybePeek(){
 const pi=S.cur;const p=S.players[pi];
 const anywhere=S.owner.iface===pi;
 const here=(S.owner.term===pi&&p.pos==='term')||(S.owner.timeline===pi&&p.pos==='timeline');
 if(!anywhere&&!here)return;
 if(!S.deck.length){S.deck=shuffle(S.discard.slice());S.discard=[];log('🎴 The rumor deck is reshuffled.')}
 if(!S.deck.length)return;
 const c=CARDBYID[S.deck[S.deck.length-1]];
 const v=await askPlayer(pi,{title:anywhere&&!here?'THE MARKET INTERFACE — PEEK':'THE TERMINAL — INSIDER PEEK',html:cardFace(c)+'<p class="fine">For your eyes only. Keep the card on top, or bury it at the bottom?</p>',options:[{label:'Put it back on top',v:'keep'},{label:'Bury it at the bottom',v:'bury'}],def:'keep',meta:{kind:'peek',card:c.id}});
 if(v==='bury'){const cid=S.deck.pop();S.deck.unshift(cid);log('📈 '+pname(pi)+' buries the story at the bottom of the deck.')}
 else log('📈 '+pname(pi)+' peeks at tomorrow and puts it back.');
}
export async function doSeize(pi){
 const p=S.players[pi];const nid=p.pos;const n=NMAP[nid];const prev=S.owner[nid];
 if(S.dlcGeo&&S.rubble[nid]){sysTo(pi,'That node is rubble — it must be rebuilt before it can be owned.');return}
 if(prev===pi)return;
 if(S.dlcGeo&&((nid==='geo_shahed'&&S.owner.geo_missile===pi)||(nid==='geo_missile'&&S.owner.geo_shahed===pi))){sysTo(pi,'You can own either MISSILE COMMAND or the SHAHED DRONE, not both.');return}
 let base=seizeListPrice(pi,n);
 /* the slipstream discount is only spent once the deal actually goes through */
 const slip=S.slipped===true&&S.owner.f1===pi;
 if(slip)base=Math.max(1,base-2);
 const isTake=prev!=null;
 const cost=isTake?takeoverCost(pi,nid,base):base;
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
 if(slip){S.slipped='spent';log('🏎️ The slipstream carries '+pname(pi)+' into the deal — $2 off.')}
 p.money-=cash;p.intel-=useInt;
 if(useInt>0)fxAt(pi,'🛈−'+useInt,'#55c1ff');
 if(cash>0)fxAt(pi,'−$'+cash,'#ff6b5e');
 if(isTake){
  S.players[prev].money+=n.cost;log('💸 '+pname(prev)+' pockets a $'+n.cost+' buyout.');fxAt(prev,'+$'+n.cost,'#7fe08d');
  if(S.owner.accc===prev&&p.money>=2){p.money-=2;S.players[prev].money+=2;log('🧐 ACCC review fee: '+pname(pi)+' pays '+pname(prev)+' $2.')}
 }
 S.owner[nid]=pi;if(nid==='sisy')S.sisyPayout=10;
 S.seizeCount[nid]=(S.seizeCount[nid]||0)+1;
 const via=useInt>0?' (paid $'+cash+' + '+useInt+' 🛈)':'';
 log('📝 '+pname(pi)+(isTake?' muscles in on ':' seizes ')+n.name.join(' ')+via+'.');
 fx(n.x,n.y-64,'📝 SEIZED',S.players[pi].color);
 if(nid==='bond')giveIntel(pi,2,'desk gossip flows');
 if(nid==='leak')giveIntel(pi,1,'the leak pays');
 S.players.forEach((pl,j)=>{if(j!==pi&&S.owner.photo===j)giveIntel(j,1,'the Photo Wall catches it')});
 addCortisol(pi,isTake?2:1,isTake?'hostile takeover':'hands are getting dirty');
 sync();
 if(await winCheck())return;
 await endOfTurn();
}
export async function doBug(pi,nid){
 const n=NMAP[nid];const p=S.players[pi];
 if(!(ADJ[p.pos]||[]).includes(nid)||S.owner[nid]==null||S.owner[nid]===pi||S.bugs[nid]!=null){sysTo(pi,'Pick a highlighted rival node next to you (not already bugged).');return}
 const cost=(S.owner.insider===pi)?0:1;
 if(p.intel<cost){sysTo(pi,'Not enough Intel.');S.mode=null;sync();return}
 p.intel-=cost;S.bugs[nid]=pi;
 if(cost>0)fxAt(pi,'🛈−1','#55c1ff');
 fx(n.x,n.y-60,'🐛 PLANTED','#55c1ff');
 log('🐛 '+pname(pi)+' plants a bug on '+n.name.join(' ')+(cost===0?' — the INSIDER TRADING graphic made it free.':'.'));
 S.mode=null;await endOfTurn();
}
export async function doSpin(pi,kind){
 const cost=kind==='fox'?2:3;const cool=kind==='fox'?3:2;
 if(S.owner[kind==='fox'?'fox':'press']!==pi)return;
 const p=S.players[pi];
 if(p.money<cost||S.spun){sysTo(pi,'Spin unavailable.');return}
 const v=await askPlayer(pi,{title:kind==='fox'?'FOX SPIN':'SPIN THE PRESS',body:(kind==='fox'?'Fair. And. Furious. ':'“Quite frankly…” — ')+'for $'+cost+':',options:[{label:'Cool my own Cortisol (−'+cool+' 🔥)',v:'cool'},{label:'Roast a rival (+1 🔥)',v:'cortisol'},{label:'Never mind',v:'no'}],def:'no'});
 if(v==='no')return;
 if(v==='cool'){p.money-=cost;fxAt(pi,'−$'+cost,'#ff6b5e');S.spun=true;log('🗞️ '+pname(pi)+' spins the story smooth.');addCortisol(pi,-cool,'friendly coverage');await finishNodeAbility(pi);return}
 S.spinKind=kind;S.mode='roast';sync();
}
export function drawCard(){
 if(!S.deck.length){S.deck=shuffle(S.discard.slice());S.discard=[];log('🎴 The rumor deck is reshuffled.')}
 const id=S.deck.pop();S.discard.push(id);
 const c=CARDBYID[id];
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
 /* A table of only bots has nobody to interrupt: the event still runs, the log
    keeps the record and the mood strip shows the swing — but no modal. */
 if(!S.players.every(p=>p.bot))announceAll('MARKET EVENT — TURN '+S.turn,cardFace(card));
 const tk=S.owner.toktimer;if(tk!=null)giveIntel(tk,1,'Toktimer clocked the event');
 await card.run();
 sync();
 if(await winCheck())return;
 nextTurn();
}
export function nextTurn(){if(!S||S.over)return;S.cur=(S.cur+1)%S.players.length;if(S.cur===0)S.turn++;Promise.resolve(startTurn()).catch(e=>console.error(e))}
export function goalAmount(){return clampGoal(S&&S.goal?S.goal:Net.goal)}
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
export function monopolyAlertFace(sub,asic){const img=asic?'./static/asic.png':'./static/accc.png';const lab=asic?'ASIC':'ACCC';const title=asic?'ASIC MARKET-MANIPULATION ALERT':'MONOPOLY ALERT';return '<div class="eventcard"><div style="display:flex;gap:16px;justify-content:center;align-items:center;margin:10px 0 8px"><img src="./static/the rock.gif" alt="The Rock" style="width:120px;height:120px;object-fit:cover;border:2px solid #168388;background:#000"><img src="'+img+'" alt="'+lab+'" style="width:120px;height:120px;object-fit:contain;border:2px solid #168388;background:#111;padding:8px"></div><div class="etitle">'+title+'</div><div class="etext">'+(sub||'')+'</div></div>';}
export function cardFace(c){if(c.id==='crackdown')return monopolyAlertFace(c.text);return '<div class="eventcard"><div class="eicon">'+c.icon+'</div><div class="etitle">'+c.title+'</div><div class="etext">'+c.text+'</div></div>'}
/* ================= MARKET EVENT DECK (24 cards) — every card moves the mood ================= */
export const CARDS=[
{id:'oilspike',icon:'🛢️',title:'OIL SPIKES — WTI +12%',text:'Crude goes vertical. The pit pays out, the tankers get rich, and everyone but the QuikStop owner pays $1 at the pump.',
 run(){setMood('BOOM','WTI +12% — crude goes vertical');[['oil',6,'crude windfall'],['oilgraph',2,'the graph called it'],['tanker',3,'tankers rechartered at panic rates'],['petronas',3,'the national oil company'],['barrels',2,'the barrel yard']].forEach(a=>{const o=S.owner[a[0]];if(o!=null)gain(o,a[1],a[2])});const q=S.owner.quik;S.players.forEach((pl,i)=>{if(i===q)return;if(q==null)payVoid(i,1,'fuel costs — nobody minds the till');else payTo(i,1,q,'fuel costs → QuikStop')});}},
{id:'coalrush',icon:'🚃',title:'COAL RUSH',text:'Demand for black rock goes nuclear. Everything on rails and water makes money.',
 run(){setMood('BOOM','coal rush — everything on rails makes money');[['port',4,'the docks work overtime'],['train',2,'the train runs all night'],['tanker',3,'freight rates through the roof'],['coal',2,'COAL Corp books all of it'],['forklift',1,'pallets upon pallets'],['bhp',3,'the Big Australian books the tonnes']].forEach(a=>{const o=S.owner[a[0]];if(o!=null)gain(o,a[1],a[2])});}},
{id:'rates',icon:'🏛️',title:'RBA CASH-RATE DECISION',text:'Governor Bullock leans into the microphone. Money gets expensive — everyone pays $2, except the insiders.',
 run(){setMood('CALM','the RBA decides — the market holds its breath, then exhales');const r=S.owner.rba,b=S.owner.bullock;S.players.forEach((pl,i)=>{if(i===r||i===b)return;payFee(i,2,'the cost of money')});if(r!=null)log('🏛️ '+pname(r)+' set the rate — pays nothing.');if(b!=null)log('👩‍💼 The Governor takes '+pname(b)+'’s calls — pays nothing.');const c=S.owner.cash;if(c!=null)gain(c,2,'you literally set it');const j=S.owner.jim;if(j!=null)gain(j,2,'the headline sells papers');const be=S.owner.bess;if(be!=null)gain(be,2,'“BIG BESSENT” reacts live');const hs=S.owner.herald;if(hs!=null)gain(hs,2,'THE JIM REAPER reprints the decision');}},
{id:'bondrevolt',icon:'💥',title:'BONDMAGEDDON',text:'“Government Bond: the collapse of the world’s safest investment.” Yields go vertical from Tokyo to Toronto.',
 run(){setMood('PANIC','“the collapse of the world’s safest investment”');const bd=S.owner.bond;S.players.forEach((pl,i)=>{const banks=NODES.filter(n=>n.type==='BANK'&&S.owner[n.id]===i).length;if(!banks)return;const amt=banks*2;if(bd!=null)payTo(i,amt,bd,'the revolt eats '+banks+' bank position'+(banks>1?'s':'')+' → The Bond Desk');else payVoid(i,amt,'the revolt eats the banking book')});COUNTRY.forEach(c=>{const o=S.owner[c];if(o!=null)gain(o,c==='japan'?3:1,NMAP[c].name.join(' ')+' pays its reader')});const t=S.owner.tenyear;if(t!=null)gain(t,2,'the master chart was right');const be=S.owner.bess;if(be!=null)gain(be,2,'Big Bessent called it on air');const br=S.owner.brad;if(br!=null)gain(br,2,'he had it explained in the movie');const bs=S.owner.bigshort;if(bs!=null)gain(bs,3,'the cinema saw it coming');const lk=S.owner.leak;if(lk!=null)gain(lk,2,'the leak was first with it');}},
{id:'ceophoto',icon:'📸',title:'CEO PHOTO LEAKS — COAL CORP',text:'Mark Watson, photographed exactly where he should not have been. Someone is holding matches.',
 run(){setMood('FRENZY','CEO photo leaks — the front pages feed');const c=S.owner.coal;if(c==null){log('🚂 COAL CORP HQ is unowned — Watson denies everything to an empty room.');return}if(S.owner.watson===c){log('🕴️ Watson fronts the cameras himself — the photos are dismissed as “old”. No Cortisol.');return}if(S.owner.port===c)gain(c,5,'shipped the coal before the news broke');if(S.owner.press===c||S.owner.fox===c){gain(c,3,'the press room spins it beautifully');return}addCortisol(c,3,'the photos run on every front page','event');}},
{id:'tariffs',icon:'🦅',title:'TRUMP TWEETS TARIFFS',text:'ALL CAPS. Exclamation points. Global markets do a synchronized swan dive.',
 async run(){setMood('PANIC','TARIFFS! ALL CAPS! markets swan-dive');const t=S.owner.trump;let chain;const opts=[{label:'🛢️ OIL chain +$3 each',v:'oil'},{label:'🚂 COAL chain +$3 each',v:'coal'}];
 if(t!=null)chain=await askPlayer(t,{title:'TRUMP TWEETS TARIFFS',body:'You own THE DONALD — which chain gets the windfall?',options:opts,def:Math.random()<.5?'oil':'coal'});
 else chain=Math.random()<.5?'oil':'coal';
 const list=chain==='oil'?['oil','oilgraph','barrels','tanker','petronas']:['coal','train','port','watson','forklift','bhp'];
 const winners=new Set();list.forEach(id=>{const o=S.owner[id];if(o!=null){gain(o,3,chain+' windfall via '+NMAP[id].name[0]);winners.add(o)}});
 const u=S.owner.us;if(u!=null){gain(u,2,'the safe-haven bid');winners.add(u)}
 S.players.forEach((pl,i)=>{if(!winners.has(i))payVoid(i,1,'the tariff bill')});
 if(t!=null)log('🦅 The tweet did numbers.');}},
{id:'besspeak',icon:'🎤',title:'BIG BESSENT SPEAKS',text:'The Treasury clears its throat. Bond desks straighten their ties. Markets listen.',
 run(){setMood('CALM','Big Bessent soothes the desk');const b=S.owner.bessent;if(b!=null)gain(b,3,'the big man speaks');const d=S.owner.bond;if(d!=null)gain(d,2,'the desk frontran the speech');const t=S.owner.tenyear;if(t!=null)gain(t,2,'yields obey');const br=S.owner.brad;if(br!=null)gain(br,2,'he had it explained to him');}},
{id:'budget',icon:'📰',title:'THE JIM DELIVERS THE BUDGET',text:'“The Jim…” reads numbers to a sleepy chamber. Somebody, somewhere, is counting.',
 run(){setMood('CALM','the budget is delivered — mostly numbers');const s=S.owner.spend;if(s!=null)gain(s,3,'the spending graphic glows');const ch=S.owner.chalmers;if(ch!=null)gain(ch,2,'the Treasurer delivers');const j=S.owner.jim;if(j!=null)gain(j,2,'the exclusive pays');const hs=S.owner.herald;if(hs!=null)gain(hs,2,'THE JIM REAPER special edition');const a=S.owner.albo;if(a!=null)gain(a,1,'the PM signs it');S.players.forEach((pl,i)=>{if(i!==s&&i!==ch&&i!==j&&i!==a&&i!==hs)payVoid(i,1,'return to sender (taxes)')});}},
{id:'mpcfinals',icon:'🏆',title:'MONETARY POLICY COMPETITION FINALS',text:'The RBA’s big night. Schools. Charts. Trophies. JTPortal is rumoured to be judging.',
 run(){setMood('BOOM','monetary policy finals — the schools deliver');const m=S.owner.mpc;if(m!=null){gain(m,4,'the champions’ purse');giveIntel(m,1,'the finalists’ data')}const sc=S.owner.school;if(sc!=null)gain(sc,2,'the school places');const ib=S.owner.ib;if(ib!=null)gain(ib,2,'the IB cohort delivers');const jt=S.owner.jt;if(jt!=null)giveIntel(jt,1,'JTPortal judged the submissions');}},
{id:'sisyroll',icon:'🪨',title:'THE BOULDER ROLLS BACK DOWN',text:'Empires, portfolios, homework — everything heavy slides. The biggest players feel it most.',
 run(){setMood('CALM','the boulder rolls back down, as ever');const counts=S.players.map((pl,i)=>NODES.filter(n=>S.owner[n.id]===i).length);const mx=Math.max(0,...counts);if(mx<=0){log('🪨 Nobody holds anything yet — the boulder rolls past an empty table.');return}S.players.forEach((pl,i)=>{if(counts[i]===mx&&S.owner.sisy!==i)payVoid(i,2,'the boulder finds the biggest stack')});const s=S.owner.sisy;if(s!=null)log('🪨 '+pname(s)+' is used to this — immune.');}},
{id:'goldrush',icon:'🪙',title:'GOLD RUSH',text:'The gold-coloured coins gleam. Paper money suddenly looks like a rumor.',
 run(){setMood('BOOM','gold gleams — paper looks like a rumor');const g=S.owner.gold;if(g!=null)gain(g,5,'everything gleams');const n=S.owner.notes;if(n!=null)gain(n,2,'collectors pay up');const bh=S.owner.bhp;if(bh!=null)gain(bh,3,'ore prices sneak up with the gold');S.players.forEach((pl,i)=>{if(i!==g&&i!==n&&i!==bh)payVoid(i,1,'inflation bites')});}},
{id:'rockcooks',icon:'💪',title:'THE ROCK COOKS',text:'A gym, a blender, a set of books that needed cooking. The smell is unmistakable.',
 run(){setMood('CALM','the books are cooked; the gym is calm');const r=S.owner.rock;if(r!=null){gain(r,3,'ladder of opportunity');addCortisol(r,-1,'the calm after the cook')}else log('💪 Nobody owns The Rock. The books stay raw.');}},
{id:'davos',icon:'🏔️',title:'DAVOS — THE CONFERENCE STAGE',text:'Lanyards, panels, fondue. Global networks tighten over canapés.',
 run(){setMood('FRENZY','Davos — lanyards, panels, fondue');const w=S.owner.wef;if(w!=null)gain(w,3,'the big table pays out');const b=S.owner.bessent;if(b!=null)gain(b,2,'a familiar face on the panel');Object.keys(S.bugs).forEach(nid=>{const o=S.bugs[nid];S.players[o].money+=1;log('🏔️ Global skim from '+NMAP[nid].name.join(' ')+': '+pname(o)+' +$1.')});}},
{id:'quikrob',icon:'🎭',title:'QUIKSTOP ROBBERY',text:'A ski mask, a shopping bag, an empty register. The tapes are… missing.',
 run(){setMood('CALM','a ski mask, a shopping bag, an empty register');const q=S.owner.quik;if(q==null){S.players.forEach((pl,i)=>payVoid(i,1,'nobody was watching the till'));return}payVoid(q,2,'gone, just gone');const b=S.owner.bond007;if(b!=null)gain(b,2,'he was there in disguise (allegedly)');}},
{id:'ibexams',icon:'📝',title:'IB EXAMS',text:'Papers, calculators, despair. The Diploma Programme does not grade on charisma.',
 run(){setMood('CALM','IB exams — despair, indexed');const ib=S.owner.ib;if(ib!=null)giveIntel(ib,2,'HL Economics pays off');const sc=S.owner.school;if(sc!=null)giveIntel(sc,1,'the cohort crammed');S.players.forEach((pl,i)=>{const charts=NODES.filter(n=>n.type==='CHART'&&S.owner[n.id]===i).length;if(charts===0&&pl.intel>0){pl.intel-=1;fxAt(i,'🛈−1','#55c1ff');log('📝 '+pname(i)+' didn’t do the reading: −1 Intel.')}});}},
{id:'profit',icon:'⛽',title:'PROFIT WARNING… FOR OTHERS',text:'Markets wobble, people stress-eat. Quikstop does just fine.',
 run(){setMood('CALM','profit warning… for others');const q=S.owner.quik;if(q!=null)gain(q,4,'snack economics');else log('⛽ Quikstop is unowned — the profits drift away.');}},
{id:'quiet',icon:'🌙',title:'A QUIET QUARTER',text:'No tweets, no leaks, no rate decisions. Everyone quietly pockets a little extra.',
 run(){setMood('CALM','a quiet quarter — no tweets, no leaks');S.players.forEach((pl,i)=>gain(i,2,'a quiet quarter'));}},
{id:'snoop',icon:'🔍',title:'REGULATORS SNOOP AROUND',text:'Somebody asked one question too many. The sweatiest players get a second look.',
 run(){setMood('CALM','regulators asking one question too many');const mx=Math.max(0,...S.players.map(pl=>pl.cortisol));if(mx<=0){log('🔍 Nobody has any Cortisol — the regulators go for coffee.');return}S.players.forEach((pl,i)=>{if(pl.cortisol===mx)addCortisol(i,1,'regulators circling','event')});}},
{id:'tip',icon:'✉️',title:'ANONYMOUS TIP',text:'A brown envelope with no return address. Everyone learns something.',
 run(){setMood('CALM','a brown envelope, no return address');S.players.forEach((pl,i)=>giveIntel(i,1,'the envelope'));log('✉️ Every player gains 1 Intel.');}},
{id:'frenzy',icon:'🗣️',title:'MEDIA FRENZY',text:'“Quite frankly…” The press needs a villain before deadline. Whoever owns the narrative picks one.',
 async run(){setMood('FRENZY','the press needs a villain before deadline');const pi=S.owner.press;if(pi==null){log('🗣️ The Press Room is unowned — the story dies in committee.');return}const rivals=S.players.map((pl,i)=>i).filter(i=>i!==pi);const opts=rivals.map(i=>({label:S.players[i].name+' +2 🔥',v:i}));opts.push({label:'Sit on the story',v:-1});const v=await askPlayer(pi,{title:'MEDIA FRENZY',body:'You control the PRESS ROOM — torch which rival?',options:opts,def:-1});if(isRival(pi,v))addCortisol(v,2,'front-page frenzy','event');}},
{id:'crackdown',icon:'🚨',title:'MONOPOLY ALERT',text:'The regulator finally does something. The hottest player pays for it.',
 run(){setMood('PANIC','crackdown — the regulator finally does something');const mx=Math.max(0,...S.players.map(pl=>pl.cortisol));if(mx<=0){log('🚨 Nobody is hot — the crackdown hits an empty office.');return}S.players.forEach((pl,i)=>{if(pl.cortisol===mx)payFee(i,4,'crackdown fine')});const bs=S.owner.bigshort;if(bs!=null)gain(bs,3,'the cinema called it');}},
{id:'tapes',icon:'🗑️',title:'THE TAPES GO MISSING',text:'A shredder runs all night. What you knew, you no longer know — unless you kept copies.',
 run(){setMood('CALM','the tapes go missing — a shredder runs all night');S.players.forEach((pl,i)=>{if(S.owner.whistle===i){giveIntel(i,2,'the Whistleblower kept copies')}else if(S.owner.jt===i){giveIntel(i,2,'JTPortal keeps backups')}else if(pl.intel>0){pl.intel-=1;fxAt(i,'🛈−1','#55c1ff');log('🗑️ '+pname(i)+' loses 1 Intel — the tapes are gone.')}});}},
{id:'bigscreen',icon:'🎬',title:'THE BIG SHORT SCREENING',text:'Brad Pitt explains subprime with a Jenga tower. Everyone watches. Nobody learns.',
 run(){setMood('FRENZY','The Big Short screens to a packed house');const bs=S.owner.bigshort;if(bs!=null)gain(bs,3,'packed house');const br=S.owner.brad;if(br!=null)gain(br,2,'he was right there on screen');const h=S.owner.hedge;if(h!=null)gain(h,2,'somebody was short the whole time');}},
{id:'madeout',icon:'🟣',title:'MADE PAYS OUT… PROBABLY',text:'The purple graphic does… something. Money appears. Explanations do not.',
 run(){setMood(S.mood,'MADE does… something');if(Math.random()<1/3){madePay();log('🟣 MADE has paid out. Nobody knows why. NOBODY.')}else log('🟣 MADE remains unexplained. Again.');}}
];
export const CARDBYID={};CARDS.forEach(c=>CARDBYID[c.id]=c);
