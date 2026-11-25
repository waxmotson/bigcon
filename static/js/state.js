'use strict';
/* state: the shared mutable game/session state — S (the game), Net (room + roster + lock flags) — and the wire view of S. No DOM. */
import { GOAL_DEF } from './util.js';
/* S is replaced wholesale (new game, adopted guest state, back to lobby), and an
   importer cannot assign to an imported binding, so replacement goes through
   setS(). Reads elsewhere see the live binding. */
export let S=null;
export function setS(v){S=v}
export const Net={role:null,peer:null,conn:null,conns:[],roster:[],myIdx:0,myName:'',playerId:null,roomCode:null,roomLabel:null,lobbyChat:[],lobbyPlayers:[],started:false,begun:false,spect:false,lock:false,lockTimer:null,pendingPrompts:new Map(),acks:null,promptSeq:0,evSeq:0,autoT:null,goal:GOAL_DEF,dlcGeo:false,dlcWorld:false,fogOfWar:false,ringworld:false,boardLayout:'random',hbTimer:null,lastSeen:0};
/* The host keeps the whole record. A join or reconnect carries LOG_WELCOME lines, and
   the rest follows in logpart messages: the relay closes a socket over 256,000 chars.
   The live panel draws LOG_SHOWN lines until the game ends, then all of them. */
export const LOG_TAIL=40,LOG_WELCOME=250,LOG_SHOWN=250,LOG_PART_CHARS=60000,LOG_RETRY_MS=8000,CHAT_TAIL=25,STATE_MIN_GAP=40;
/* The wire carries only what changed: the deck stays home and the record/chat
   travel as tails the guests splice onto what they already hold. */
export function pubState(full){
 const c={};
 for(const k in S){if(k==='deck'||k==='log'||k==='chat')continue;c[k]=S[k]}
 const out=JSON.parse(JSON.stringify(c));
 out.deckCount=S.deck.length;
 const lt=S.log.slice(-(full?LOG_WELCOME:LOG_TAIL));
 const ct=full?S.chat.slice():S.chat.slice(-CHAT_TAIL);
 out.log=lt;out.chat=ct;out.logN=S.logN|0;out.chatN=S.chatN|0;
 return out;
}
export function mergeTail(prev,prevN,tail,totalN){
 if(!prev||prevN==null)return tail.slice();
 const start=totalN-tail.length;
 const keep=prev.length-(prevN-start);
 if(!(keep>=0&&keep<=prev.length))return tail.slice();
 return prev.slice(0,keep).concat(tail);
}
