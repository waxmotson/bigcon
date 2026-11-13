'use strict';
/* net: state sync (adoptState), prompts, the Cloudflare/PeerJS transports, lobby, host and guest, and the lobby/setup view helpers.
   Allowed to touch the DOM and the wire. The rules engine reaches it only through hooks (sync, sysTo, askPlayer, announceAll, revealAll, beginGame). */
import { CHARS, MAXPLAYERS, PCOLORS, WORLD_GEO, charMeta, charSrc, codeLabel, genCode, rebuildWorld } from './data.js';
import { LOG_PART_CHARS, LOG_RETRY_MS, Net, S, STATE_MIN_GAP, mergeTail, pubState, setS } from './state.js';
import { hooks } from './hooks.js';
import { addChat, applyIntent, botAPI, endOfTurn, gain, log, pname } from './engine.js';
import { $, IS_DISCORD_ACTIVITY, Presence } from './core.js';
import { clampGoal, esc } from './util.js';
/* ============ NET: state sync & prompts (host-authoritative) ============ */
export function adoptState(ns){
 /* The lobby flag travels with the state: rebuild the world before the
    board-render path touches NMAP/EDGES. */
 if(ns.dlcGeo!=null&&!!ns.dlcGeo!==WORLD_GEO)rebuildWorld(!!ns.dlcGeo);
 if(S){
  ns.log=mergeTail(S.log,S.logN|0,ns.log||[],ns.logN|0);
  ns.chat=mergeTail(S.chat,S.chatN|0,ns.chat||[],ns.chatN|0);
 }
 if(ns.chat.length>60)ns.chat=ns.chat.slice(-60);
 setS(ns);
 requestMissingLog();
}
/* A guest holds the newest S.log.length of S.logN lines. Anything older (a late join,
   a reconnect, a missed tail) is fetched from the host, oldest first. */
let logFetch={lines:[],at:-Infinity};
export function requestMissingLog(){
 if(Net.role!=='guest'||!Net.conn||!S||S.log.length>=(S.logN|0))return;
 const now=Date.now();
 if(now-logFetch.at<LOG_RETRY_MS)return;
 logFetch={lines:[],at:now};
 try{Net.conn.send({t:'logreq'})}catch(e){}
}
export function sendLogParts(c){
 if(!S)return;
 const total=S.log.length;
 let start=0;
 while(start<total){
  let end=start,chars=0;
  while(end<total&&(end===start||chars+S.log[end].length<=LOG_PART_CHARS)){chars+=S.log[end].length;end++}
  c.send({t:'logpart',start,total,lines:S.log.slice(start,end)});
  start=end;
 }
}
export function adoptLogPart(d){
 if(!S||!Array.isArray(d.lines))return;
 if(d.start!==logFetch.lines.length)return;
 logFetch.lines.push(...d.lines);
 if(logFetch.lines.length<d.total)return;
 const newer=(S.logN|0)-d.total; /* lines that arrived in state updates meanwhile */
 if(newer>=0&&newer<=S.log.length){S.log=logFetch.lines.concat(S.log.slice(S.log.length-newer));scheduleRender()}
 logFetch={lines:[],at:-Infinity};
}
export function sendAll(msg){for(let i=0;i<Net.conns.length;i++){if(i===Net.myIdx)continue;const c=Net.conns[i];if(c&&c.open){try{c.send(msg)}catch(e){}}}}
export function sendTo(pi,msg){if(pi===Net.myIdx)return;const c=Net.conns[pi];if(c&&c.open){try{c.send(msg)}catch(e){}}}
/* State goes out coalesced: a single turn touches the state dozens of times and
   guests only need the result, not every intermediate frame. */
let stateTimer=null,stateLastSend=0;
export function flushState(){
 if(stateTimer){clearTimeout(stateTimer);stateTimer=null}
 if(!S||Net.role!=='host')return;
 stateLastSend=Date.now();
 sendAll({t:'state',s:pubState(false)});
}
export function sendState(now){
 if(Net.role!=='host'||!S)return;
 if(now){flushState();return}
 if(stateTimer)return;
 stateTimer=setTimeout(flushState,Math.max(0,STATE_MIN_GAP-(Date.now()-stateLastSend)));
}
let renderRaf=0;
export function scheduleRender(){
 if(renderRaf)return;
 renderRaf=requestAnimationFrame(()=>{renderRaf=0;hooks.render()});
}
export function sync(now){if(Net.role==='host'){scheduleRender();sendState(now)}else scheduleRender()}
export function sysTo(pi,msg){if(Net.role!=='host')return;if(pi===Net.myIdx){if(S&&S.players[pi]&&S.players[pi].bot)return;hooks.toast(msg);return}sendTo(pi,{t:'sys',msg})}
export function askPlayer(pi,opt){return new Promise(res=>{
 if(Net.role!=='host'){hooks.modal(opt).then(res);return}
 const def=opt.def!==undefined?opt.def:(opt.options&&opt.options[0]?opt.options[0].v:undefined);
 /* Bot seats answer privately through the policy module — neither the host's
    modal (a spectating host's seat is a bot) nor the wire prompt below may fire
    for a bot. */
 const bp=S&&S.players[pi];
 if(bp&&bp.bot&&hooks.bots()&&hooks.bots().answerPrompt){
  hooks.bots().answerPrompt(pi,opt,botAPI()).then(v=>res(v===undefined?def:v));
  return;
 }
 if(pi===Net.myIdx){hooks.modal(opt).then(res);return}
 const c=Net.conns[pi];
 if(!c||!c.open){res(def);return}
 const pid=++Net.promptSeq;
 /* a guest may only pick one of the options it was offered — anything else is the default */
 const allowed=(opt.options||[]).map(o=>o.v);
 Net.pendingPrompts.set(pid,{res:v=>res(allowed.some(a=>a===v)?v:def),def,pi});
 flushState();
 sendTo(pi,{t:'prompt',pid,title:opt.title,html:opt.html,body:opt.body,options:opt.options});
 setTimeout(()=>{const p=Net.pendingPrompts.get(pid);if(p){Net.pendingPrompts.delete(pid);res(p.def)}},opt.timeout||45000);
})}
/* A table-wide bulletin nobody has to wait on: the raid is news, not a turn. */
export function announceAll(title,html){
 if(Net.role!=='host')return;
 const eid=++Net.evSeq;
 flushState();
 for(let i=0;i<Net.conns.length;i++){if(i===Net.myIdx)continue;const c=Net.conns[i];if(c&&c.open)sendTo(i,{t:'event',eid,title,html})}
 hooks.modal({title,html,options:[{label:'Continue',v:1}]});
}
export async function revealAll(title,html){
 if(Net.role!=='host'){await hooks.modal({title,html,options:[{label:'Continue',v:1}]});return}
 const eid=++Net.evSeq;const need=new Set();
 flushState();
 for(let i=0;i<Net.conns.length;i++){if(i===Net.myIdx)continue;const c=Net.conns[i];if(c&&c.open)need.add(i)}
 /* listen for acks before anything is sent, so an instant ack is never dropped;
    the 5 s grace starts once the host has dismissed its own card */
 let acked=Promise.resolve();
 if(need.size){acked=new Promise(res=>{Net.acks={eid,set:need,res,timer:null}})}
 need.forEach(i=>sendTo(i,{t:'event',eid,title,html}));
 await hooks.modal({title,html,options:[{label:'Continue',v:1}]});
 if(Net.acks&&Net.acks.eid===eid){const a=Net.acks;a.timer=setTimeout(()=>{if(Net.acks===a){Net.acks=null;a.res()}},5000)}
 await acked;
}

/* ================= NETWORKING ================= */
export const PFX='bigcon-oz-';
export function setNetStatus(msg,err){const el=$('netStatus');el.textContent=msg||'';el.className=err?'err':''}
export function cleanName(s){return String(s||'').replace(/[<>&"'`]/g,'').trim().slice(0,80)}
export function showFatal(msg){
 Presence.clear();
 const ov=document.createElement('div');ov.className='overlay';
 const card=document.createElement('div');card.className='mcard';
 card.innerHTML='<div class="mtitle">CONNECTION LOST</div><div class="mbody"><p>'+esc(msg)+'</p></div><div class="mopts"><button onclick="location.reload()">Reload</button></div>';
 ov.appendChild(card);document.body.appendChild(ov);
}

/* ---- DEFAULT CLOUDFLARE DURABLE OBJECT RELAY ----
   The deployed Worker URL is built in, so players do not need to configure it.
   PeerJS remains available as a fallback transport if the relay is unavailable;
   all players in a room must use the same transport. */
export const BIGCON_RELAY_URL='https://bigconhosting.wax-no-bones.workers.dev';
export function transportSettings(){
 if(IS_DISCORD_ACTIVITY)return {mode:'cloudflare',url:'/relay'};
 const mode=$('transportMode')?.value||'cloudflare';
 try{localStorage.setItem('bigcon-transport-mode-v2',mode)}catch(_){}
 return {mode,url:BIGCON_RELAY_URL.replace(/^https:/i,'wss:').replace(/^http:/i,'ws:').replace(/\/+$/,'')};
}
export function loadTransportSettings(){
 if(IS_DISCORD_ACTIVITY){const panel=$('transportSettings');if(panel)panel.style.display='none';return}
 try{
  const mode=localStorage.getItem('bigcon-transport-mode-v2')||'cloudflare';
  if($('transportMode'))$('transportMode').value=mode;
 }catch(_){}
 const refresh=()=>{
  const mode=$('transportMode')?.value||'cloudflare';
  if($('relayHelp'))$('relayHelp').textContent=mode==='cloudflare'
   ?'Using the built-in Cloudflare relay. No URL setup is needed.'
   :'PeerJS / WebRTC direct or TURN fallback is active. Everyone joining the room must select the same connection system.';
 };
 $('transportMode')?.addEventListener('change',()=>{transportSettings();refresh()});
 loadTransportSettings._refresh=refresh;refresh();
}
/* Host secret: proves to the relay that we are the host that claimed this room,
   so nobody who merely knows the room code can take over the host slot (e.g.
   while the real host reconnects). One random secret per hosted room, kept in
   sessionStorage so a page refresh/reconnect reuses it, with an in-memory
   fallback when storage is unavailable. It is sent in the websocket "join"
   message, never in the URL, so it stays out of request logs. */
const hostSecretMem=new Map();
export function hostSecretFor(room){
 const key='bigcon-host-secret-'+room;
 let s=hostSecretMem.get(room);
 if(!s){try{const v=sessionStorage.getItem(key);if(v&&/^[0-9a-f]{64}$/.test(v))s=v}catch(_){}}
 if(!s){const b=new Uint8Array(32);crypto.getRandomValues(b);s=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}
 hostSecretMem.set(room,s);
 try{sessionStorage.setItem(key,s)}catch(_){}
 return s;
}
/* Relay errors after which retrying with the same secret cannot help. */
export const RELAY_FATAL_HOST_ERRORS=['room-claimed','host-secret-required'];
export class RelayEvents{
 constructor(){this.events={}}
 on(name,fn){(this.events[name]||(this.events[name]=[])).push(fn);return this}
 emit(name,...args){for(const fn of this.events[name]||[]){try{fn(...args)}catch(e){console.error(e)}}}
}
export class CloudflareDataConnection extends RelayEvents{
 constructor(peer,room,id,hostSide){super();this.peer=peer;this.room=room;this.id=id;this.hostSide=hostSide;this.open=false;this.__bigconClosed=false;this.__lastSeen=Date.now()}
 send(data){if(!this.open||!this.peer.socket||this.peer.socket.readyState!==1)throw new Error('Relay connection is not open');this.peer.socket.send(JSON.stringify({type:'data',target:this.hostSide?this.id:'host',data}))}
 close(){if(this.__bigconClosed)return;this.__bigconClosed=true;this.open=false;this.emit('close');if(this.peer.socket&&this.peer.socket.readyState===1)this.peer.socket.send(JSON.stringify({type:'leave',target:this.id}));}
}
export class CloudflarePeer extends RelayEvents{
 constructor(idOrOptions,maybeOptions){
  super();this.id=typeof idOrOptions==='string'?idOrOptions:null;this.options=typeof idOrOptions==='string'?maybeOptions:idOrOptions;this.destroyed=false;this.disconnected=false;this.socket=null;this.connections=new Map();this.hostSide=!!this.id;
  queueMicrotask(()=>{if(this.destroyed)return;if(this.hostSide)this._connectSocket(this.id.slice(PFX.length),'host');else this.emit('open','guest-'+crypto.randomUUID())});
 }
 _baseUrl(){
  return transportSettings().url;
 }
 _connectSocket(room,role){
  let base;try{base=this._baseUrl()}catch(e){this.emit('error',{type:'configuration',message:e.message});return}
  const url=base.replace(/^https:/i,'wss:').replace(/^http:/i,'ws:')+'/ws/'+encodeURIComponent(room)+'?role='+role;
  const ws=new WebSocket(url);this.socket=ws;
  ws.addEventListener('open',()=>{if(this.destroyed){ws.close();return}ws.send(JSON.stringify(role==='host'?{type:'join',role,secret:hostSecretFor(room)}:{type:'join',role}));});
  ws.addEventListener('message',ev=>{
   let m;try{m=JSON.parse(ev.data)}catch(_){return}
   if(m.type==='ready'){
    this._retries=0;
    if(role==='host'){this.emit('open',this.id);return}
    const c=this.connections.get('outgoing');if(c&&!c.open){c.id=m.id;c.open=true;c.emit('open');}
   }else if(m.type==='incoming'&&role==='host'){
    const c=new CloudflareDataConnection(this,room,m.id,true);c.open=true;this.connections.set(m.id,c);this.emit('connection',c);c.emit('open');
   }else if(m.type==='data'){
    const c=role==='host'?this.connections.get(m.source):this.connections.get('outgoing');
    if(c&&c.open){c.__lastSeen=Date.now();c.emit('data',m.data)}
   }else if(m.type==='left'){
    const c=role==='host'?this.connections.get(m.id):this.connections.get('outgoing');
    if(c){c.open=false;c.__bigconClosed=true;c.emit('close');if(role==='host')this.connections.delete(m.id)}
   }else if(m.type==='host_back'&&!this.hostSide){
    const c=this.connections.get('outgoing');
    if(c&&c.open){try{c.send({t:'hello',name:Net.myName,playerId:Net.playerId})}catch(_){}}
   }else if(m.type==='error'){
    if(role==='host'){
     // The relay closes the socket right after an error. Report the error once and
     // skip the generic 'disconnected' path, which would reconnect immediately.
     failureNotified=true;
     if(RELAY_FATAL_HOST_ERRORS.includes(m.code))this.fatal=true;
    }
    this.emit('error',{type:m.code||'network',message:m.message||'Cloudflare relay error'});
   }
  });
  let failureNotified=false;
  ws.addEventListener('close',()=>{
   if(this.destroyed)return;
   this.disconnected=true;
   for(const c of this.connections.values()){if(c.open){c.open=false;c.emit('close')}}
   if(!failureNotified){failureNotified=true;if(this.hostSide)this.emit('disconnected');else this.emit('error',{type:'socket-closed',message:'Cloudflare relay connection closed'})}
  });
  ws.addEventListener('error',()=>{
   if(this.destroyed||failureNotified)return;
   failureNotified=true;
   if(this.hostSide)this.emit('disconnected');
   else this.emit('error',{type:'socket-error',message:'Cloudflare relay socket error'});
  });
 }
 connect(target){
  const room=String(target||'').startsWith(PFX)?String(target).slice(PFX.length):String(target||'');
  const c=new CloudflareDataConnection(this,room,'outgoing',false);this.connections.set('outgoing',c);
  try{this._connectSocket(room,'guest')}catch(e){queueMicrotask(()=>this.emit('error',{type:'configuration',message:e.message}))}
  return c;
 }
 /* The first retry is immediate; after that the waits double (capped at 10 s) until
    the relay says ready again, so a dead network can't spin a reconnect loop. */
 reconnect(){
  if(this.destroyed||this.fatal)return;
  clearTimeout(this._retryT);
  const n=this._retries=(this._retries||0)+1;
  const delay=n<=1?0:Math.min(10000,500*Math.pow(2,n-2));
  const go=()=>{this._retryT=null;if(this.destroyed||this.fatal)return;this._connectSocket(this.id?this.id.slice(PFX.length):Net.roomCode,this.hostSide?'host':'guest')};
  if(delay)this._retryT=setTimeout(go,delay);else go();
 }
 destroy(){this.destroyed=true;clearTimeout(this._retryT);for(const c of this.connections.values())c.close();if(this.socket){try{this.socket.close()}catch(_){}}this.emit('close')}
}
export function selectedPeerClass(){
 const cfg=transportSettings();
 if(cfg.mode!=='cloudflare')return Peer;
 return CloudflarePeer;
}

/* ---- WEBRTC / ICE CONFIG ---- */
/* Keep game traffic peer-to-peer. STUN discovers routes; TURN relays only when
   a direct route is impossible. Several relays over UDP, TCP and TLS/443:
   office firewalls and mobile carriers block different ones. */
export const BIGCON_ICE_CONFIG={
 iceServers:[
  {urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302','stun:stun2.l.google.com:19302','stun:global.stun.twilio.com:3478']},
  {urls:['turn:eu-0.turn.peerjs.com:3478','turn:us-0.turn.peerjs.com:3478','turn:eu-0.turn.peerjs.com:3478?transport=tcp','turn:us-0.turn.peerjs.com:3478?transport=tcp'],username:'peerjs',credential:'peerjsp'},
  {urls:['turns:eu-0.turn.peerjs.com:5349','turns:us-0.turn.peerjs.com:5349'],username:'peerjs',credential:'peerjsp'}
 ],
 sdpSemantics:'unified-plan',
 iceCandidatePoolSize:4
};
export const BIGCON_PEER_OPTIONS={config:BIGCON_ICE_CONFIG,debug:1,pingInterval:5000};
// Tolerate short stalls on congested or filtered school networks.
export const HEARTBEAT_MS=5000,CONN_TIMEOUT_MS=35000;
export const PEER_REOPEN_BASE_MS=3500;
let hostReopenTimer=null,hostReopenAttempt=0;
export function scheduleHostReopen(reason){
 if(hostReopenTimer)return;
 hostReopenAttempt++;
 const delay=Math.min(20000,PEER_REOPEN_BASE_MS*Math.pow(2,Math.min(hostReopenAttempt-1,3)));
 setNetStatus((reason||'Signalling connection interrupted')+' — retrying room registration in '+Math.ceil(delay/1000)+'s…',true);
 hostReopenTimer=setTimeout(()=>{
  hostReopenTimer=null;
  if(Net.role==='host'&&Net.roomCode)hostOpenPeer();
 },delay);
}

/* ---- HOST ---- */
export function hostCreate(name){
 setNetStatus('Contacting the matchmaker…');
 Net.role='host';Net.myName=name;Net.playerId=getPlayerId();Net.myIdx=0;Net.roster=[{name,playerId:Net.playerId,conn:null,char:null}];Net.conns=[null];
 Net.roomCode=genCode();Net.roomLabel=codeLabel(Net.roomCode);
 hostOpenPeer();
 startHostHeartbeat();
}
export function hostOpenPeer(){
 if(hostReopenTimer){clearTimeout(hostReopenTimer);hostReopenTimer=null}
 const code=Net.roomCode;
 const old=Net.peer;
 if(old&&!old.destroyed){try{old.destroy()}catch(_){}}
 const p=new (selectedPeerClass())(PFX+code,BIGCON_PEER_OPTIONS);
 Net.peer=p;
 let opened=false;
 p.on('open',()=>{
  opened=true;
  if(Net.peer!==p)return;
  hostReopenAttempt=0;
  $('btnCreate').disabled=false;
  showLobby(true);
  if(!Net.started)setNetStatus('Room created — seats up to 8. Waiting for co-conspirators…');
 });
 p.on('disconnected',()=>{
  if(Net.peer!==p||p.destroyed)return;
  try{p.reconnect()}catch(_){scheduleHostReopen('Signalling server disconnected')}
 });
 p.on('error',e=>{
  const ty=e&&e.type;
  if(Net.peer!==p)return;
  if(RELAY_FATAL_HOST_ERRORS.includes(ty)){
   // Another host holds this room's claim (or the relay wants a secret we can't
   // supply). Retrying can't help, so stop for good instead of reconnecting.
   if(hostReopenTimer){clearTimeout(hostReopenTimer);hostReopenTimer=null}
   clearInterval(Net.hbTimer);
   try{p.destroy()}catch(x){}
   const label=Net.roomLabel||Net.roomCode;
   const msg=ty==='room-claimed'
    ?'Room code '+label+' is already claimed by another host. Pick another code: press Create Room again for a new one. (A claimed code frees up after its room has been empty for 10 minutes.)'
    :((e&&e.message)||'The relay refused this host.');
   if(opened||Net.started)showFatal(msg);
   else{$('btnCreate').disabled=false;setNetStatus(msg,true)}
   return;
  }
  if(ty==='unavailable-id'&&!opened&&!Net.started){try{p.destroy()}catch(x){}Net.roomCode=genCode();Net.roomLabel=codeLabel(Net.roomCode);hostReopenAttempt=0;hostOpenPeer();return}
  if(ty==='unavailable-id'){scheduleHostReopen('Room ID is temporarily registered elsewhere');return}
  if(ty==='network'||ty==='socket-error'||ty==='socket-closed'||ty==='server-error'||ty==='host-taken'){
   // Back off rather than repeatedly destroying/recreating the peer in a tight loop.
   scheduleHostReopen('Matchmaker error ('+ty+')');
   return;
  }
  if(ty==='peer-unavailable')return;
  setNetStatus('Network error: '+(ty||'unknown')+' — check your internet and try again.',true);
 });
 p.on('connection',c=>{
  c.on('open',()=>{
   c.__lastSeen=Date.now();
   c.on('data',d=>{try{onHostData(c,d)}catch(err){console.error(err)}});
  });
  c.on('close',()=>onHostClose(c));
  c.on('error',()=>onHostClose(c));
 });
}
/* A quiet data channel is indistinguishable from a dead one, so the host keeps
   pinging and drops seats that stop answering instead of stalling the table. */
export function startHostHeartbeat(){
 clearInterval(Net.hbTimer);
 Net.hbTimer=setInterval(()=>{
  const now=Date.now();
  for(let i=0;i<Net.conns.length;i++){
   const c=Net.conns[i];
   if(!c)continue;
   if(!c.open){onHostClose(c);continue}
   if(now-(c.__lastSeen||now)>CONN_TIMEOUT_MS){try{c.close()}catch(_){}onHostClose(c);continue}
   try{c.send({t:'ping'})}catch(_){}
  }
 },HEARTBEAT_MS);
}
export function onHostData(c,d){
 if(!d||!d.t)return;
 c.__lastSeen=Date.now();
 if(d.t==='ping'){try{c.send({t:'pong'})}catch(_){}return}
 if(d.t==='pong')return;
 if(d.t==='hello'){handleHello(c,cleanName(d.name)||'Player',String(d.playerId||''));return}
 if(d.t==='joinmode'){handleJoinMode(c,d);return}
 if(d.t==='joinchar'){handleJoinChar(c,d);return}
 if(d.t==='pick'){const pi=Net.conns.indexOf(c);if(pi>=0&&!Net.started)applyChar(pi,d.char);return}
 const pi=Net.conns.indexOf(c);
 if(pi<0)return;
 if(d.t==='logreq'){sendLogParts(c);return}
 if(d.t==='intent'){applyIntent(pi,d)}
 else if(d.t==='answer'){const pr=Net.pendingPrompts.get(d.pid);if(pr&&pr.pi===pi){Net.pendingPrompts.delete(d.pid);pr.res(d.v)}}
 else if(d.t==='ack'){if(Net.acks&&Net.acks.eid===d.eid){Net.acks.set.delete(pi);if(!Net.acks.set.size){clearTimeout(Net.acks.timer);const r=Net.acks.res;Net.acks=null;r()}}}
 else if(d.t==='chat'){if(S&&pi>=0)addChat(pi,String(d.text||'').slice(0,140))}
 else if(d.t==='lchat'){if(!Net.started)addLobbyChat(pi,String(d.text||'').slice(0,140))}
}
/* The wire opens before the con does: chat runs in the lobby too, and whatever
   was said there carries over into the game record. */
export function addLobbyChat(pi,text){
 if(!text)return;
 const e=Net.roster[pi];if(!e)return;
 Net.lobbyChat.push({n:e.name,c:PCOLORS[pi%PCOLORS.length],t:text});
 if(Net.lobbyChat.length>40)Net.lobbyChat.shift();
 broadcastLobby();
}
export function sendLobbyChat(){
 const inp=$('lobbyChatInput');if(!inp)return;
 const text=inp.value.trim().slice(0,140);
 if(!text)return;
 inp.value='';
 if(Net.role==='host')addLobbyChat(0,text);
 else if(Net.conn&&Net.conn.open)Net.conn.send({t:'lchat',text});
}
export function renderLobbyChat(){
 const box=$('lobbyChatList');if(!box)return;
 const rows=Net.lobbyChat||[];
 box.innerHTML=rows.map(c=>'<div><b style="color:'+c.c+'">'+esc(c.n)+':</b> '+esc(c.t)+'</div>').join('')||'<div style="opacity:.4;font-style:italic">— the wire is quiet —</div>';
 box.scrollTop=box.scrollHeight;
}
export function lobbyPlayers(){return (Net.role==='host'?Net.roster:(Net.lobbyPlayers||[])).map(e=>({name:e.name,char:e.char||null}))}
export function applyChar(idx,id){
 if(!charMeta(id))return false;
 if((Net.roster||[]).some((e,i)=>i!==idx&&e.char===id))return false;
 if(!Net.roster[idx])return false;
 Net.roster[idx].char=id;
 broadcastLobby();
 return true;
}
export function renderCharGrid(){
 const grid=$('charGrid');if(!grid)return;
 const rows=Net.role==='host'?Net.roster:(Net.lobbyPlayers||[]);
 const myIdx=Net.role==='host'?0:Net.myIdx;
 const mine=rows[myIdx]&&rows[myIdx].char;
 const taken=new Set(rows.filter((e,i)=>e.char&&i!==myIdx).map(e=>e.char));
 grid.innerHTML=CHARS.map(c=>{
  const on=mine===c.id,busy=taken.has(c.id),spect=Net.role==='host'&&rows[0]&&rows[0].bot;
  return '<button type="button" class="charpick'+(on?' on':'')+(busy?' taken':'')+'" data-char="'+c.id+'" style="border-bottom:4px solid '+c.color+'" '+(busy?'disabled':'')+'>'
   +'<img src="'+charSrc(c.id)+'" alt="">'
   +'<div class="cn">'+esc(c.name)+(on?(spect?' · YOUR BOT':' · YOU'):'')+(busy?' · TAKEN':'')+'</div>'
   +'<div class="ccolour"><span class="cswatch" style="background:'+c.color+'"></span>'+c.color.toUpperCase()+(on?' · YOUR COLOUR':'')+'</div></button>';
 }).join('');
}
export function handleHello(c,name,playerId){
 const existing=playerId?Net.roster.findIndex(e=>e.playerId===playerId):-1;
 if(existing>=0){
  const old=Net.conns[existing];
  if(old===c)return;
  if(old&&old.open){c.send({t:'kick',reason:'This player is already connected in this room. Close the other tab before joining again.'});setTimeout(()=>{try{c.close()}catch(e){}},800);return;}
  Net.roster[existing].conn=c;Net.conns[existing]=c;c.__bigconClosed=false;c.__lastSeen=Date.now();
  if(Net.started&&S){
   if(S.players[existing]){S.players[existing].dc=false;clearTimeout(Net.autoT);log('🔔 '+name+' reconnected to their existing seat.');c.send({t:'welcome',idx:existing,s:pubState(true)});sync(true);return}
   /* a spectator row holds no seat at the table — back to the rail, not the door */
   Net.roster[existing].spect=true;
   c.send({t:'welcome',idx:existing,spect:true,s:pubState(true)});sync(true);return;
  }
  c.send({t:'welcome',idx:existing,lobby:lobbyPlayers(),goal:clampGoal(Net.goal),dlcGeo:!!Net.dlcGeo,fogOfWar:!!Net.fogOfWar,boardLayout:Net.boardLayout||(Net.ringworld?'ringworld':'random'),ringworld:!!Net.ringworld,chat:Net.lobbyChat.slice(-40)});broadcastLobby();return;
 }
 if(Net.started&&S){
  const idx=S.players.findIndex(pl=>pl.dc&&pl.name.toLowerCase()===name.toLowerCase());
  if(idx>=0&&idx!==Net.myIdx){
   Net.conns[idx]=c;S.players[idx].dc=false;c.__bigconClosed=false;c.__lastSeen=Date.now();
   if(Net.roster[idx]){Net.roster[idx].conn=c;Net.roster[idx].playerId=playerId||Net.roster[idx].playerId}
   log('🔔 '+name+' is back at the table.');
   clearTimeout(Net.autoT);
   c.send({t:'welcome',idx:idx,s:pubState(true)});
   sync(true);return;
  }
  /* dead spectator rows are not seats — sweep them so rejoiners don't pile up */
  for(let i=Net.roster.length-1;i>=S.players.length;i--){if(Net.roster[i]&&Net.roster[i].spect&&!Net.roster[i].conn)Net.roster.splice(i,1)}
  Net.conns=Net.roster.map(e=>e.conn);
  /* the con is already on, so the joiner chooses: a fresh seat dealt at
     Quikstop, or the spectator rail. The host validates every step of it. */
  c.__midjoin={name,playerId:playerId||crypto.randomUUID()};
  c.send({t:'midjoin',over:!!S.over});
  return;
 }
 joinLobby(c,name,playerId);
}
export function joinLobby(c,name,playerId){
 if(Net.roster.length>=MAXPLAYERS){c.send({t:'kick',reason:'Room is full (8 players).'});setTimeout(()=>{try{c.close()}catch(e){}},800);return}
 if(Net.roster.some(e=>e.name.toLowerCase()===name.toLowerCase()))name=name+' ★';
 Net.roster.push({name,playerId:playerId||crypto.randomUUID(),conn:c,char:null});
 Net.conns=Net.roster.map(e=>e.conn);
 c.__lastSeen=Date.now();
 c.send({t:'welcome',idx:Net.roster.length-1,lobby:lobbyPlayers(),goal:clampGoal(Net.goal),dlcGeo:!!Net.dlcGeo,fogOfWar:!!Net.fogOfWar,boardLayout:Net.boardLayout||(Net.ringworld?'ringworld':'random'),ringworld:!!Net.ringworld,chat:Net.lobbyChat.slice(-40)});
 broadcastLobby();
}
/* Mid-con joiners: the game does not stop for them. A new player gets the
   same deal every con starts with ($15, 2 Intel, standing at Quikstop); a
   spectator gets the whole board read-only. Nothing is trusted from the wire —
   the host re-validates the cap and the face on every step. */
export function midJoinReject(c,reason){c.send({t:'kick',reason});setTimeout(()=>{try{c.close()}catch(e){}},800)}
export function seatSpectator(c){
 if(Net.roster.length>=MAXPLAYERS)return midJoinReject(c,'Room is full (8 players).');
 const mj=c.__midjoin;if(!mj)return;delete c.__midjoin;
 Net.roster.push({name:mj.name,playerId:mj.playerId,conn:c,char:null,spect:true});
 Net.conns=Net.roster.map(e=>e.conn);
 c.__bigconClosed=false;c.__lastSeen=Date.now();
 log('👁 '+mj.name+' pulls up a chair — spectating the con.');
 hooks.toast('👁 '+mj.name+' joined as a spectator.');
 c.send({t:'welcome',idx:Net.roster.length-1,spect:true,s:pubState(true)});
 sync(true);
}
export function seatMidgamePlayer(c,char){
 if(Net.roster.length>=MAXPLAYERS)return midJoinReject(c,'Room is full (8 players).');
 if(!charMeta(char)||Net.roster.some(e=>e.char===char))return midJoinReject(c,'That face was just taken — join the room again to pick another.');
 const mj=c.__midjoin;if(!mj)return;delete c.__midjoin;
 /* roster rows 0..players-1 are the seats; spectators sit after them. The new
    seat goes in right behind the last seat, and every spectator it pushes down
    a row is told its new row index. */
 const idx=S.players.length;
 Net.roster.splice(idx,0,{name:mj.name,playerId:mj.playerId,conn:c,char});
 Net.conns=Net.roster.map(e=>e.conn);
 c.__bigconClosed=false;c.__lastSeen=Date.now();
 const meta=charMeta(char);
 S.players.push({name:mj.name,color:meta.color||PCOLORS[idx%PCOLORS.length],char,money:15,intel:2,cortisol:0,raided:0,pos:'quik',visited:{quik:true},dc:false,bot:false});
 log('🔔 '+mj.name+' joins the con — dealt in at Quikstop with $15 and 2 Intel.');
 hooks.toast('🔔 '+mj.name+' joined — dealt in at Quikstop.');
 c.send({t:'welcome',idx,s:pubState(true)});
 for(let i=idx+1;i<Net.roster.length;i++){const sc=Net.conns[i];if(sc&&sc.open){try{sc.send({t:'welcome',idx:i,spect:true,s:pubState(true)})}catch(_){}}}
 sync(true);
}
export function handleJoinMode(c,d){
 const mj=c.__midjoin;if(!mj)return;
 if(!Net.started||!S){delete c.__midjoin;joinLobby(c,mj.name,mj.playerId);return}
 if(d.v!=='player'||S.over)return seatSpectator(c);
 const taken=new Set(Net.roster.map(e=>e.char));
 const free=CHARS.filter(ch=>!taken.has(ch.id));
 if(!free.length)return seatSpectator(c);
 c.send({t:'joinface',free:free.map(f=>f.id)});
}
export function handleJoinChar(c,d){
 const mj=c.__midjoin;if(!mj)return;
 if(!Net.started||!S){delete c.__midjoin;joinLobby(c,mj.name,mj.playerId);return}
 if(S.over)return seatSpectator(c);
 seatMidgamePlayer(c,String(d.char||''));
}
export function onHostClose(c){
 if(c.__bigconClosed)return;
 c.__bigconClosed=true;
 const pi=Net.conns.indexOf(c);
 if(pi<0)return;
 if(!Net.started){
  const nm=Net.roster[pi]?Net.roster[pi].name:'A player';
  Net.roster.splice(pi,1);Net.conns=Net.roster.map(e=>e.conn);
  broadcastLobby();setNetStatus(nm+' left the lobby.');
  return;
 }
 if(Net.conns[pi]===c)Net.conns[pi]=null;
 if(Net.roster[pi]&&Net.roster[pi].conn===c)Net.roster[pi].conn=null;
 if(S&&!S.over&&S.players[pi]){
  S.players[pi].dc=true;
  log('🔕 '+pname(pi)+' lost connection — seat is being held.');
  Net.pendingPrompts.forEach((p,pid)=>{if(p.pi===pi){Net.pendingPrompts.delete(pid);p.res(p.def)}});
  if(Net.acks&&Net.acks.set.has(pi)){
   Net.acks.set.delete(pi);
   if(!Net.acks.set.size){clearTimeout(Net.acks.timer);const r=Net.acks.res;Net.acks=null;r()}
  }
  if(S.cur===pi&&(S.phase==='move'||S.phase==='action')){
   clearTimeout(Net.autoT);
   Net.autoT=setTimeout(()=>{
    if(S&&!S.over&&S.cur===pi&&S.players[pi].dc){log('💤 '+pname(pi)+' is away — plays it quiet.');gain(pi,1,'away');endOfTurn()}
   },20000);
  }
  sync(true);
 }
}
/* Bots keep the lobby alive: a rate-limited ambient line in their own
   character's voice. Cosmetic only (the lobby is pre-game), so Date.now and
   Math.random are fine here — none of it touches the game's streams. */
export function lobbyChatter(){
 if(Net.role!=='host'||Net.started||!Net.roster||Net.roster.length<2)return;
 const now=Date.now();
 if(Net.lobbyChatAt&&now-Net.lobbyChatAt<20000)return;
 const bots=Net.roster.map((e,i)=>({e,i})).filter(x=>x.e&&x.e.bot&&x.e.char);
 if(!bots.length)return;
 Net.lobbyChatAt=now;
 const pick=bots[Math.floor(Math.random()*bots.length)];
 const line=botLobbyLine(pick.e.char);
 if(line)addLobbyChat(pick.i,line);
}
/* Ambient chatter must not depend on somebody clicking: a self-rescheduling
   chain keeps the room murmuring while it is open, and stops with the con
   (or with the host leaving). The virtual clock runs it in tests. */
export function startLobbyChatter(){
 if(Net.role!=='host'||Net.started||Net.lobbyChatT)return;
 Net.lobbyChatT=setTimeout(function tick(){
  Net.lobbyChatT=null;
  if(Net.role!=='host'||Net.started)return;
  lobbyChatter();
  startLobbyChatter();
 },20000);
}
export function broadcastLobby(){
 sendAll({t:'lobby',players:lobbyPlayers(),goal:clampGoal(Net.goal),dlcGeo:!!Net.dlcGeo,fogOfWar:!!Net.fogOfWar,boardLayout:Net.boardLayout||(Net.ringworld?'ringworld':'random'),ringworld:!!Net.ringworld,chat:Net.lobbyChat.slice(-40)});
 renderLobbyList();renderLobbyChat();
 lobbyChatter();
 startLobbyChatter();
 const n=Net.roster.length;
 const ready=n>=1&&Net.roster.every(e=>e.char);
 const allBots=n>=1&&Net.roster.every(e=>e.bot);
 $('btnStart').disabled=!ready;
 $('btnStart').textContent=!ready?(n<1?'START THE CON (need a player)':'START THE CON (everyone pick a face)'):
  (allBots?'START THE CON — ALL-BOT TABLE ('+n+(n===1?' BOT':' BOTS')+' · YOU WATCH)':n===1?'START SOLO TEST — 1 PLAYER':n>=MAXPLAYERS?'START THE CON — FULL TABLE (8/8)':
  'START THE CON — '+n+' PLAYERS · '+(MAXPLAYERS-n)+' SEATS OPEN');
}
export function renderLobbyList(){
 const c=$('lobbyList');if(!c)return;
 const rows=Net.role==='host'?Net.roster:(Net.lobbyPlayers||[]);
 c.innerHTML=rows.map((e,i)=>{
  const face=charSrc(e.char);
  const who=Net.role==='host'?(e.bot?(i===0?'🤖 BOT · HOST SPECTATES':'🤖 BOT'):(i===0?'HOST · YOU':'CONNECTED')):(i===Net.myIdx?'YOU':'CONNECTED');
  return '<div class="lrow" style="border-left:4px solid '+((charMeta(e.char)||{}).color||PCOLORS[i%PCOLORS.length])+'">'+(face?'<img class="pface" src="'+face+'" alt="" style="border-color:'+((charMeta(e.char)||{}).color||PCOLORS[i%PCOLORS.length])+'">':'<span class="ld" style="background:'+PCOLORS[i%PCOLORS.length]+'"></span>')
   +'<span class="ln">'+(i+1)+'. '+esc(e.name)+(e.char?' · '+esc((charMeta(e.char)||{}).name||''):' · pick a face')+'</span><span class="lh">'+who+(Net.role==='host'&&e.bot&&i>0?' <button class="botbtn" data-kickbot="'+i+'" title="Send this bot home">✕</button>':'')+'</span></div>';
 }).join('')
  +'<div class="lrow" style="background:transparent;border:1px dashed #168388;color:#9ad;font-size:12px;"><span class="ln">'+rows.length+' of 8 seats filled</span>'
  +(Net.role==='host'&&rows.length<MAXPLAYERS?'<button class="botbtn" id="btnAddBot" style="margin-left:8px;cursor:pointer;background:#000;border:1px solid #168388;color:#9ad;padding:2px 10px;font:inherit">🤖 ADD A BOT — FILLS THE NEXT EMPTY SEAT</button>':'')
  +(Net.role==='host'&&!Net.started?'<button class="botbtn" id="btnSpectate" style="margin-left:8px;cursor:pointer;background:#000;border:1px solid #168388;color:#9ad;padding:2px 10px;font:inherit">'+(rows[0]&&rows[0].bot?'🙋 TAKE MY SEAT BACK — I’LL PLAY':'🤖 SPECTATE — LET A BOT PLAY MY SEAT')+'</button>':'')
  +'</div>';
 renderCharGrid();
 const meIdx=Net.role==='host'?0:Net.myIdx;
 Presence.lobby(Net.role==='host',Net.roomLabel||Net.roomCode,rows.length,MAXPLAYERS,rows[meIdx]&&rows[meIdx].char);
}
/* ---- BOTS (host lobby) ----
   A bot is a roster entry with bot:true and no connection. It picks a free
   face immediately so the start button unlocks, plays through the same
   applyIntent gate as everyone else, and never counts as connected. */
export function botLobbyLine(charId){
  try{const b=hooks.bots();return b&&b.lobbyLine?b.lobbyLine(charId):null}catch(e){return null}
}
export function addBotSeat(){
 if(Net.role!=='host'||!Net.roster)return;
 if(Net.roster.length>=MAXPLAYERS){hooks.toast('The table is full — no seat for a bot.');return}
 const used=new Set(Net.roster.map(e=>e.char));
 const free=CHARS.filter(ch=>!used.has(ch.id));
 if(!free.length){hooks.toast('Every face is already at the table.');return}
 /* the lobby is cosmetic — Math.random is fine here and keeps every table
    from being the same four faces in roster order */
 const pick=free[Math.floor(Math.random()*free.length)];
 const n=Net.roster.filter(e=>e.bot).length+1;
 Net.roster.push({name:'BOT '+(pick.name||pick.id).toUpperCase(),playerId:'bot'+n+'-'+pick.id,conn:null,char:pick.id,bot:true});
 broadcastLobby();
 const line=botLobbyLine(pick.id);
 if(line)addLobbyChat(Net.roster.length-1,line);
}
export function kickBotSeat(i){
 if(Net.role!=='host'||!Net.roster||!Net.roster[i]||!Net.roster[i].bot||i===0)return;
 Net.roster.splice(i,1);broadcastLobby();
}
/* Spectator host: hand your OWN seat to a bot and watch the con unfold. The
   roster row stays at index 0 — the relay's seat — it just plays itself
   through the same bot policy as every other bot. Your name, player id and
   face are kept aside so you can take the seat back before the start. */
export function toggleSpectate(){
 if(Net.role!=='host'||!Net.roster||!Net.roster.length||Net.started)return;
 const me=Net.roster[0];
 if(me.bot){
  const back=me.spectated||{};
  const used=new Set(Net.roster.slice(1).map(e=>e.char).filter(Boolean));
  Net.roster[0]={name:back.name||'HOST',playerId:back.playerId||Net.playerId||'host',conn:null,char:(back.char&&!used.has(back.char))?back.char:null,bot:false};
 }else{
  const used=new Set(Net.roster.slice(1).map(e=>e.char).filter(Boolean));
  const pick=(me.char&&!used.has(me.char))?CHARS.filter(ch=>ch.id===me.char)[0]||null:CHARS.filter(ch=>!used.has(ch.id))[0];
  if(!pick){hooks.toast('Every face is already at the table — send a bot home first.');return}
  Net.roster[0]={name:'BOT '+(pick.name||pick.id).toUpperCase(),playerId:'spectator-'+pick.id,conn:null,char:pick.id,bot:true,spectated:{name:me.name,playerId:me.playerId,char:me.char}};
 }
 broadcastLobby();
}
/* ---- GUEST ---- */
let guestReconnectTimer=null;
let guestReconnectAttempt=0;
let guestTransportToken=0;
let guestReconnectStopped=false;

export function clearGuestReconnect(){
 if(guestReconnectTimer){clearTimeout(guestReconnectTimer);guestReconnectTimer=null}
}

export function guestReconnectDelay(){
 // Exponential backoff with a cap avoids retry storms on filtered Wi-Fi.
 return Math.min(15000,1200*Math.pow(2,Math.min(Math.max(0,guestReconnectAttempt-1),4)));
}

export function guestConnectionLost(token){
 if(token!==guestTransportToken||guestReconnectStopped)return;
 clearGuestReconnect();
 guestReconnectAttempt++;
 const attempt=guestReconnectAttempt;
 const delay=guestReconnectDelay();
 stopGuestHeartbeat();
 console.warn('[BigCon] connection lost; scheduling retry',{attempt,delayMs:delay,room:Net.roomCode,stage:Net.begun?'game':'lobby'});
 setNetStatus((Net.begun?'Connection lost':'Lost the lobby connection')+' — reconnecting ('+attempt+') in '+Math.ceil(delay/1000)+'s…',true);
 guestReconnectTimer=setTimeout(()=>{
  guestReconnectTimer=null;
  if(token!==guestTransportToken||guestReconnectStopped)return;
  connectGuestTransport(true);
 },delay);
}

export function connectGuestTransport(isRetry){
 const token=++guestTransportToken;
 const name=Net.myName;
 const code=Net.roomCode;
 const oldPeer=Net.peer;
 if(oldPeer&&!oldPeer.destroyed){
  try{oldPeer.destroy()}catch(_){}
 }
 const p=new (selectedPeerClass())(BIGCON_PEER_OPTIONS);
 Net.peer=p;
 p.on('open',()=>{
  if(token!==guestTransportToken||guestReconnectStopped)return;
  const c=p.connect(PFX+code,{reliable:true,serialization:'json'});
  Net.conn=c;
  let connectionOpened=false;
  const connectionTimeout=setTimeout(()=>{
   if(!connectionOpened&&token===guestTransportToken&&!guestReconnectStopped){
    console.warn('[BigCon] Data connection timed out; retrying', {code, token});
    try{c.close()}catch(_){}
    guestConnectionLost(token);
   }
  },30000);
  c.on('open',()=>{
   connectionOpened=true;
   clearTimeout(connectionTimeout);
   if(token!==guestTransportToken||guestReconnectStopped)return;
   guestReconnectAttempt=0;
   c.__bigconClosed=false;
   c.send({t:'hello',name,playerId:Net.playerId});
   setNetStatus('Connected — '+(isRetry?'rejoining':'joining')+' “'+codeLabel(code)+'”…');
   startGuestHeartbeat(token);
  });
  c.on('data',d=>{
   if(token!==guestTransportToken||guestReconnectStopped)return;
   Net.lastSeen=Date.now();
   try{onGuestData(d)}catch(err){console.error(err)}
  });
  c.on('close',()=>guestConnectionLost(token));
  c.on('error',()=>guestConnectionLost(token));
 });
 p.on('disconnected',()=>{
  if(token!==guestTransportToken||guestReconnectStopped)return;
  try{p.reconnect()}catch(_){guestConnectionLost(token)}
 });
 p.on('error',e=>{
  if(token!==guestTransportToken||guestReconnectStopped)return;
  const ty=e&&e.type;
  if(ty==='peer-unavailable'){
   /* the host may just be re-registering with the matchmaker — keep trying a while */
   if(Net.begun||guestReconnectAttempt<5)guestConnectionLost(token);
   else {setNetStatus('Room “'+codeLabel(code)+'” not found yet — retrying in case the host is reconnecting.',true);guestConnectionLost(token)}
  }else if(ty==='network'||ty==='socket-error'||ty==='socket-closed'||ty==='server-error'||ty==='unavailable-id'){
   guestConnectionLost(token);
  }else{
   setNetStatus('Network error: '+(ty||'unknown')+'.',true);
  }
 });
}

/* The guest watches the wire too: silence for CONN_TIMEOUT_MS means the link is
   gone even when the browser never fires 'close'. */
export function stopGuestHeartbeat(){clearInterval(Net.hbTimer);Net.hbTimer=null}
export function startGuestHeartbeat(token){
 stopGuestHeartbeat();
 Net.lastSeen=Date.now();
 Net.hbTimer=setInterval(()=>{
  if(token!==guestTransportToken||guestReconnectStopped){stopGuestHeartbeat();return}
  const c=Net.conn;
  if(!c||!c.open){guestConnectionLost(token);return}
  if(Date.now()-Net.lastSeen>CONN_TIMEOUT_MS){try{c.close()}catch(_){}guestConnectionLost(token);return}
  try{c.send({t:'ping'})}catch(_){guestConnectionLost(token)}
 },HEARTBEAT_MS);
}

export function guestJoin(name,code){
 clearGuestReconnect();
 guestReconnectStopped=false;
 guestReconnectAttempt=0;
 setNetStatus('Contacting the matchmaker…');
 Net.role='guest';Net.myName=name;Net.playerId=getPlayerId();Net.roomCode=code;Net.roomLabel=codeLabel(code);
 connectGuestTransport(false);
}

export function onGuestData(d){
 if(!d||!d.t)return;
 switch(d.t){
  case 'ping':if(Net.conn&&Net.conn.open){try{Net.conn.send({t:'pong'})}catch(_){}}break;
  case 'pong':break;
  case 'welcome':
   Net.myIdx=d.idx;Net.spect=!!d.spect;
   if(d.lobby)Net.lobbyPlayers=d.lobby;
   if(d.chat)Net.lobbyChat=d.chat;
   if(d.goal)setGoalUI(d.goal);
   if(d.dlcGeo!==undefined)setGeoUI(!!d.dlcGeo);
   if(d.fogOfWar!==undefined)setFogUI(!!d.fogOfWar);
   if(d.boardLayout!==undefined)setBoardLayout(d.boardLayout);else if(d.ringworld!==undefined)setBoardLayout(d.ringworld?'ringworld':'random');
   if(d.s){setS(null);adoptState(d.s);Net.begun=true;enterGame()}
   else showLobby(false);
   break;
  case 'lobby':
   Net.lobbyPlayers=d.players||[];
   Net.lobbyChat=d.chat||[];
   renderLobbyChat();
   if(d.goal)setGoalUI(d.goal);
   if(d.dlcGeo!==undefined)setGeoUI(!!d.dlcGeo);
   if(d.fogOfWar!==undefined)setFogUI(!!d.fogOfWar);
   if(d.boardLayout!==undefined)setBoardLayout(d.boardLayout);else if(d.ringworld!==undefined)setBoardLayout(d.ringworld?'ringworld':'random');
   renderLobbyList();
   break;
  case 'begin':setS(null);Net.spect=false;adoptState(d.s);if(d.idx!=null)Net.myIdx=d.idx;Net.begun=true;enterGame();break;
  case 'state':adoptState(d.s);scheduleRender();break;
  case 'logpart':adoptLogPart(d);break;
  case 'prompt':hooks.modal({title:d.title,html:d.html,body:d.body,options:d.options}).then(v=>{if(Net.conn&&Net.conn.open)Net.conn.send({t:'answer',pid:d.pid,v})});break;
  case 'event':hooks.modal({title:d.title,html:d.html,options:[{label:'Continue',v:1}]}).then(()=>{if(d.eid!=null&&Net.conn&&Net.conn.open){try{Net.conn.send({t:'ack',eid:d.eid})}catch(_){}}});break;
  case 'midjoin':hooks.modal({title:'THE CON IS ALREADY ON',body:d.over?'The table just wrapped up. Take the spectator rail — when the host deals the next con, you are in it.':'The table is mid-heist. You can deal in fresh at Quikstop — $15 and 2 Intel, the same stake every con starts with — or take the spectator rail and just watch.',options:d.over?[{label:'👁 WATCH AS A SPECTATOR',v:'spect'}]:[{label:'🎲 DEAL ME IN AT QUIKSTOP',v:'player'},{label:'👁 SPECTATE — JUST WATCHING',v:'spect'}]}).then(v=>{if(Net.conn&&Net.conn.open)Net.conn.send({t:'joinmode',v:v||'spect'})});break;
  case 'joinface':hooks.modal({title:'PICK YOUR FACE',body:'Every free face at the table. Pick who you are for this con.',options:(d.free||[]).map(id=>{const m=charMeta(id);return{label:m?m.name:id,v:id}})}).then(id=>{if(Net.conn&&Net.conn.open)Net.conn.send({t:'joinchar',char:id})});break;
  case 'tolobby':setS(null);Net.begun=false;Net.spect=false;if(d.idx!=null)Net.myIdx=d.idx;showLobby(false);break;
  case 'sys':hooks.toast(d.msg);break;
  case 'reload':location.reload();break;
  case 'kick':guestReconnectStopped=true;clearGuestReconnect();stopGuestHeartbeat();showFatal(d.reason||'Kicked from room.');break;
 }
}
export function enterGame(){
 hooks.showGame();
 hooks.render();
}
/* ================= SETUP SCREEN ================= */
/* Only the host may move the target; guests mirror whatever comes off the wire. */
export function setGoalUI(v){
 Net.goal=clampGoal(v);
 const inp=$('goalInput');
 if(inp&&document.activeElement!==inp)inp.value=Net.goal;
 const note=$('goalNote');
 if(note)note.textContent=Net.role==='host'?'first player to $'+Net.goal+' wins the con':'the host set the target at $'+Net.goal;
}
/* 🌍 The Geography DLC is the same anchor: the host flips it, the table mirrors it. */
export function setGeoUI(v){
 Net.dlcGeo=!!v;
 const t=$('geoToggle');
 if(t)t.checked=!!v;
}
export function setFogUI(v){
 Net.fogOfWar=!!v;
 const t=$('fogToggle');
 if(t)t.checked=!!v;
}
export function setBoardLayout(val){
 const allowed=['random','ringworld','megaring'];
 Net.boardLayout=allowed.includes(val)?val:'random';
 Net.ringworld=Net.boardLayout==='ringworld';
 const t=$('boardLayoutSelect');
 if(t){t.value=Net.boardLayout;t.disabled=Net.role!=='host'}
 const note=$('boardLayoutNote');
 if(note)note.textContent=Net.role==='host'?'the host chooses the map':(Net.boardLayout==='megaring'?'Mega Ring selected by the host':(Net.ringworld?'Ringworld selected by the host':'random board selected by the host'));
}
export function setRingworldUI(v){
 setBoardLayout(v?'ringworld':'random');
}
/* After the payout the table keeps its room: everyone is walked back to the
   lobby with the same code, roster and faces — no reload, no rejoin. The
   roster sits in shuffled seating order after initGame, so each guest is told
   their own row index for the "YOU" marker. */
export function backToLobby(){
 if(Net.role!=='host'||!S||!S.over)return;
 Net.started=false;Net.begun=false;setS(null);
 /* The lobby (and the next initGame) keeps the host on row 0, but the game
    seated the roster in shuffled order: put the host row back on top. Rows of
    players who are no longer connected leave the table — dealt into the next
    con they would hold a seat nobody can play. Bots stay. */
 const rows=Net.roster.map((e,i)=>({e,c:Net.conns[i]||null,host:i===Net.myIdx}));
 const kept=rows.filter(r=>r.host||r.e.bot||(r.c&&r.c.open));
 kept.sort((a,b)=>(b.host?1:0)-(a.host?1:0));
 Net.roster=kept.map(r=>r.e);Net.conns=kept.map(r=>r.host?null:r.c);Net.myIdx=0;
 Net.roster.forEach((e,i)=>{if(!e.bot)e.conn=Net.conns[i]});
 /* spectators step off the rail and pick a face like anyone else for the next con */
 Net.roster.forEach(e=>{if(e.spect)e.spect=false});
 for(let i=0;i<Net.roster.length;i++){
  if(i===Net.myIdx)continue;
  const c=Net.conns[i];if(c&&c.open)sendTo(i,{t:'tolobby',idx:i});
 }
 showLobby(true);
 setNetStatus('Back in the lobby — same room, same faces. Deal the next con when ready.');
 broadcastLobby();
}
export function showLobby(asHost){
 $('hostForm').classList.remove('show');$('joinForm').classList.remove('show');
 $('lobbyView').style.display='block';
 $('app').style.display='none';document.body.classList.remove('game-open');
 $('roomCodeBig').textContent=Net.roomLabel||Net.roomCode||'·····';
 $('btnStart').style.display=asHost?'block':'none';
 $('btnCopy').style.display=asHost?'inline-block':'none';
 const gi=$('goalInput');
 if(gi)gi.disabled=!asHost;
 const layout=$('boardLayoutSelect');if(layout)layout.disabled=!asHost;
 setGoalUI(Net.goal);
 setBoardLayout(Net.boardLayout||(Net.ringworld?'ringworld':'random'));
 if(!asHost)setNetStatus('In the lobby. Pick a face — the host starts when everyone is in.');
 renderLobbyList();renderLobbyChat();
 const inp=$('lobbyChatInput'),btn=$('lobbyChatSend');
 if(btn)btn.onclick=sendLobbyChat;
 if(inp)inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();sendLobbyChat()}};
}
/* The player id survives a page refresh for the length of the tab session, so a reconnect reclaims the same seat. */
export function getPlayerId(){const key='bigcon-player-id';let id=sessionStorage.getItem(key);if(!id){id=crypto.randomUUID();sessionStorage.setItem(key,id)}return id;}
/* initGame hands the opening state to every connected guest (hooks.beginGame). */
export function sendBegin(pub){
 for(let i=0;i<Net.conns.length;i++){
  const c=Net.conns[i];
  if(c&&c.open){try{c.send({t:'begin',s:pub,idx:i})}catch(e){}}
 }
}
