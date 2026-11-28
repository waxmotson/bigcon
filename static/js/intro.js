'use strict';
/* intro: the splash animation on the setup screen. A board of nodes deals itself out from Quikstop,
   the crew drop onto Quikstop and each hops once to their node, everything goes off at once
   (Missile Command vs Tuvalu, the Qantas jet, Sisyphus, The Rock cooking the books, the chainsaw,
   the Bermuda Triangle, the roulette wheel, Baikonur), BONDMAGEDDON and LIBERATE OIL flatten it,
   and the crew step off the board to form the logo — ending on the logo image itself.

   mountIntro(host) takes the .splash-logo box (which already holds the logo <img>) and plays once.
   Click to skip. It needs GSAP + MotionPathPlugin (loaded by index.html); without them, with
   reduced motion, or in a DOM-less test harness it does nothing and the static logo stays. */

const G='./static/GlobalEdition/',P='./static/';
/* the logo's own geometry (big con logo.png is 512×512): the eight faces and the white tile's letter cells */
const L=512;
const SLOTS={bessock:[85,88],calvinathanasius:[255,85],denialswan:[425,85],japsnchen:[85,255],thousandyardwax:[425,255],jimchalmers:[85,425],markwatson:[255,425],tomkins:[425,425]};
const FACE=160,BOX={x:166,y:170,w:186,h:174};
const ROWS=[[172,213],[232,273],[295,335]],COLS=[[172,220],[244,280],[304,347]];
/* the board: a 5×5 grid [row, col] with Quikstop in the middle. kind: bond (BONDMAGEDDON's two), target (what it hits),
   lib (LIBERATE OIL: Trump, Big Yahu, Lockheed), oil (what that hits) */
const NODES={
 yahu:{img:G+'big-yahu.jpg',rc:[0,0],kind:'lib'}, qantas:{img:P+'qantas.png',rc:[0,1]}, wti:{img:P+'wti crude.png',rc:[0,2],kind:'oil'},
 barrels:{img:P+'blue oil barrels.png',rc:[0,3],kind:'oil'}, aramco:{img:G+'saudi-aramco.jpg',rc:[0,4],kind:'oil'},
 milei:{img:G+'javier-milei.avif',rc:[1,0],kind:'target'}, made:{img:P+'made logo.png',rc:[1,1]}, trump:{img:P+'trump.png',rc:[1,2],kind:'lib'},
 tanker:{img:P+'tanker fleet.png',rc:[1,3],kind:'oil'}, petronas:{img:P+'petronas.png',rc:[1,4],kind:'oil'},
 bermuda:{img:G+'bermuda-triangle.jpg',rc:[2,0],kind:'target'}, bond:{img:P+'bond desk.png',rc:[2,1],kind:'bond'}, quik:{img:P+'quikstop.png',rc:[2,2]},
 sisy:{img:P+'sisyphus.webp',rc:[2,3]}, cushing:{img:G+'cushing-oklahoma.jpg',rc:[2,4],kind:'oil'},
 monaco:{img:G+'monaco-casino.jpg',rc:[3,0],kind:'target'}, leak:{img:P+'bondmageddon 2.png',rc:[3,1],kind:'bond'}, lockheed:{img:G+'lockheed-martin.jpg',rc:[3,2],kind:'lib'},
 oilgraph:{img:P+'oil price increase.png',rc:[3,3],kind:'oil'}, pemex:{img:G+'pemex.png',rc:[3,4],kind:'oil'},
 baikonur:{img:G+'baikonur.jpg',rc:[4,0],kind:'target'}, rock:{img:P+'the rock.gif',rc:[4,1]}, missile:{img:P+'GeographyDLC/nk_missile.jpg',rc:[4,2]},
 tuvalu:{img:P+'GeographyDLC/geo_tuvalu.png',rc:[4,3]}, petrobras:{img:G+'petrobras.jpg',rc:[4,4],kind:'oil'},
};
/* who ends up where: DJT on Trump fires LIBERATE OIL, the CEO of Coal on the Bond Desk fires BONDMAGEDDON, the soldier minds Lockheed */
const PAWNS={markwatson:'bond',tomkins:'leak',DJT:'trump',thebigwegrzyn:'yahu',thousandyardwax:'lockheed',bessock:'quik',
 calvinathanasius:'qantas',Alexander_Lane:'made',denialswan:'sisy',thebigag:'rock',japsnchen:'missile',jimchalmers:'tuvalu'};
const EDGES=(()=>{const ids=Object.keys(NODES),at={};ids.forEach(id=>at[NODES[id].rc.join()]=id);const out=[];
 ids.forEach(id=>{const [r,c]=NODES[id].rc;[[0,1],[1,0]].forEach(([dr,dc])=>{const o=at[(r+dr)+','+(c+dc)];if(o&&(r*7+c*3+dr)%5!==2)out.push([id,o])})});
 out.push(['quik','made'],['trump','tanker'],['yahu','made'],['bond','monaco'],['lockheed','tuvalu'],['sisy','petronas']);return out})();
const F35=G+'fx/f35_travelling.png';
const MISSILE='<svg viewBox="0 0 70 22"><path d="M0 11 L-26 6 L-26 16 Z" fill="#ffb347" opacity=".9"/><path d="M-10 11 L-30 8 L-30 14 Z" fill="#fff3b0"/>'
 +'<rect x="4" y="7" width="50" height="8" rx="3" fill="#d9dde0" stroke="#000" stroke-width="1.5"/><path d="M54 7 Q68 11 54 15 Z" fill="#ff3b30" stroke="#000" stroke-width="1.5"/>'
 +'<path d="M8 7 L2 1 L14 7 Z M8 15 L2 21 L14 15 Z" fill="#8a9196" stroke="#000" stroke-width="1"/></svg>';
const PLANE='<svg viewBox="0 0 120 50"><path d="M8 25 Q10 18 30 18 L96 18 Q116 20 116 25 Q116 30 96 32 L30 32 Q10 32 8 25 Z" fill="#f4f4f4" stroke="#000" stroke-width="2"/>'
 +'<path d="M50 30 L72 30 L44 50 L36 50 Z" fill="#cfd4d8" stroke="#000" stroke-width="1.5"/><path d="M50 20 L72 20 L44 0 L36 0 Z" fill="#cfd4d8" stroke="#000" stroke-width="1.5"/>'
 +'<path d="M8 25 L2 6 L20 6 L30 19 Z" fill="#e0001b" stroke="#000" stroke-width="1.5"/><circle cx="13" cy="12" r="3" fill="#fff"/>'
 +'<path d="M96 21 L106 21 Q110 23 110 25 L96 25 Z" fill="#1a2b3c"/></svg>';
const SVGNS='http://www.w3.org/2000/svg';

export function mountIntro(host){
 const gsap=typeof window!=='undefined'&&window.gsap,MP=typeof window!=='undefined'&&window.MotionPathPlugin;
 if(!host||!gsap||!MP||!host.querySelector)return null;
 try{if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return null}catch(_){}
 const logo=host.querySelector('img');
 if(!logo||host.clientWidth<60)return null;
 gsap.registerPlugin(MP);
 host.classList.add('intro');
 const mk=(tag,cls,html)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(html)d.innerHTML=html;return d};
 const table=mk('div','i-table'),threads=document.createElementNS(SVGNS,'svg');threads.setAttribute('class','i-threads');table.appendChild(threads);
 const hole=mk('div','i-hole'),fx=mk('div','i-fx'),trails=document.createElementNS(SVGNS,'svg');trails.setAttribute('class','i-trails');fx.appendChild(trails);
 const tile=mk('div','i-tile'),stamp=mk('div','i-stamp','CONNED'),shine=mk('div','i-shine'),flash=mk('div','i-flash');
 logo.classList.add('i-logo');
 host.insertBefore(table,logo);
 [hole,fx,tile,stamp,shine,flash].forEach(n=>host.appendChild(n));
 const R=gsap.utils.random;
 let tl=null,S=0,k=1,nodeEl={},pawnEl={},C={};
 const nw=()=>S*0.155,pw=()=>S*0.068;
 const JIT={};
 function layout(){C={};Object.entries(NODES).forEach(([id,n])=>{const j=JIT[id]||(JIT[id]=[R(-.018,.018),R(-.018,.018)]);C[id]=[S*(0.1+n.rc[1]*0.2+j[0]),S*(0.1+n.rc[0]*0.2+j[1])]})}
 function build(){
  S=host.clientWidth;k=S/L;layout();
  host.style.setProperty('--s',S+'px');host.style.setProperty('--nw',nw()+'px');host.style.setProperty('--pw',pw()+'px');
  table.querySelectorAll('.i-node').forEach(n=>n.remove());host.querySelectorAll('.i-pawn').forEach(n=>n.remove());
  fx.querySelectorAll(':scope > :not(svg)').forEach(n=>n.remove());trails.innerHTML='';threads.innerHTML='';
  trails.setAttribute('viewBox','0 0 '+S+' '+S);threads.setAttribute('viewBox','0 0 '+S+' '+S);
  EDGES.forEach(([a,b])=>{const p=document.createElementNS(SVGNS,'line');
   const long=Math.hypot(C[a][0]-C[b][0],C[a][1]-C[b][1])>S*0.25;
   Object.entries({x1:C[a][0],y1:C[a][1],x2:C[b][0],y2:C[b][1],stroke:'#168388','stroke-width':long?1.6:2.4,opacity:.9}).forEach(([k2,v])=>p.setAttribute(k2,v));
   p.dataset.long=long?1:0;p.dataset.a=a;p.dataset.b=b;threads.appendChild(p)});
  nodeEl={};Object.entries(NODES).forEach(([id,n])=>{const d=mk('div','i-node','<div class="i-glow"></div>');d.style.backgroundImage='url("'+n.img+'")';table.appendChild(d);nodeEl[id]=d});
  pawnEl={};Object.keys(PAWNS).forEach(ch=>{const d=mk('div','i-pawn','<img src="./characters/'+ch+'.png" alt="">');host.insertBefore(d,tile);pawnEl[ch]=d});
  const src=logo.currentSrc||logo.src;
  Object.assign(tile.style,{left:BOX.x*k+'px',top:BOX.y*k+'px',width:BOX.w*k+'px',height:BOX.h*k+'px',
   backgroundImage:'url("'+src+'")',backgroundSize:S+'px '+S+'px',backgroundPosition:(-BOX.x*k)+'px '+(-BOX.y*k)+'px'});
  Object.assign(hole.style,{left:BOX.x*k+'px',top:BOX.y*k+'px',width:BOX.w*k+'px',height:BOX.h*k+'px'});
  tile.innerHTML='';
  ROWS.forEach(r=>COLS.forEach(c=>{const d=mk('div','i-cv');
   Object.assign(d.style,{left:(c[0]-BOX.x)*k+'px',top:(r[0]-BOX.y)*k+'px',width:(c[1]-c[0])*k+'px',height:(r[1]-r[0])*k+'px'});tile.appendChild(d)}));
 }
 const nodeXY=id=>({x:C[id][0]-nw()/2,y:C[id][1]-nw()*0.375});
 /* a pawn stands on the top-right corner of its node, so the picture stays readable */
 const pawnXY=id=>({x:C[id][0]+nw()*0.5-pw()*0.75,y:C[id][1]-nw()*0.375-pw()*0.35});
 const el=(cls,html)=>{const d=mk('div',cls,html);fx.appendChild(d);return d};
 function boom(t,p,at,big){
  const o=el('i-boom'),r=el('i-ring');
  gsap.set([o,r],{x:p[0],y:p[1],scale:0,opacity:0});
  const sc=big?1.5:1;
  t.fromTo(o,{scale:.1,opacity:1},{scale:sc,duration:0.22,ease:'power3.out',immediateRender:false},at)
   .to(o,{opacity:0,scale:sc*1.25,duration:0.35},at+0.22)
   .fromTo(r,{scale:.2,opacity:1},{scale:sc*1.5,opacity:0,duration:0.45,ease:'power2.out',immediateRender:false},at);
 }
 function missile(t,a,b,at,dur,noBoom,lift){
  const m=el('i-msl',MISSILE);
  const mid=[(a[0]+b[0])/2+(lift?0:R(-.1,.1)*S),Math.min(a[1],b[1])-(lift||R(.1,.26))*S];
  const tr=document.createElementNS(SVGNS,'path');tr.setAttribute('d','M'+a[0]+','+a[1]+' Q'+mid[0]+','+mid[1]+' '+b[0]+','+b[1]);
  Object.entries({fill:'none',stroke:'rgba(230,230,230,.55)','stroke-width':S*0.007,'stroke-linecap':'round'}).forEach(([k2,v])=>tr.setAttribute(k2,v));
  trails.appendChild(tr);const len=tr.getTotalLength();gsap.set(tr,{strokeDasharray:len,strokeDashoffset:len,opacity:1});
  gsap.set(m,{x:a[0],y:a[1],opacity:0});
  t.set(m,{opacity:1},at)
   .to(m,{motionPath:{path:[{x:a[0],y:a[1]},{x:mid[0],y:mid[1]},{x:b[0],y:b[1]}],type:'quadratic',autoRotate:true},duration:dur,ease:'power1.in'},at)
   .to(tr,{strokeDashoffset:0,duration:dur,ease:'power1.in'},at)
   .set(m,{opacity:0},at+dur)
   .to(tr,{opacity:0,duration:0.5},at+dur);
  if(!noBoom)boom(t,b,at+dur);
 }
 function jet(t,pts,at,dur){
  const j=mk('img','i-jet');j.src=F35;j.alt='';fx.appendChild(j);
  gsap.set(j,{x:pts[0][0],y:pts[0][1],opacity:0});
  t.set(j,{opacity:1},at).to(j,{motionPath:{path:pts.map(([x,y])=>({x,y})),curviness:1.3,autoRotate:true},duration:dur,ease:'none'},at).set(j,{opacity:0},at+dur);
 }
 const shake=(t,at,n=4,a=7)=>t.to(host,{x:a,y:-a*.6,duration:0.04,yoyo:true,repeat:n,clearProps:'x,y'},at);
 /* a node reduced to rubble: it stays on the board, burnt out */
 const rubble=(t,id,at)=>t.to(nodeEl[id],{filter:'grayscale(1) brightness(.4) contrast(1.5)',rotation:'+='+R(-12,12),scale:.92,duration:0.3,ease:'power2.out'},at);
 /* a pawn fires its ability: it jumps, and its node(s) light up */
 function fire(t,ch,ids,at){
  t.to(pawnEl[ch],{y:'-='+S*0.05,scale:1.35,duration:0.18,yoyo:true,repeat:1,ease:'power2.out'},at);
  ids.forEach(id=>t.to(nodeEl[id].firstChild,{opacity:1,duration:0.15,yoyo:true,repeat:3},at));
 }
 /* once it has played, only the logo is left */
 function tidy(){[table,hole,fx,tile,stamp,shine,flash].forEach(n=>n.style.display='none');host.querySelectorAll('.i-pawn').forEach(n=>n.remove());gsap.set(logo,{opacity:1});gsap.set(host,{clearProps:'x,y'})}

 function play(){
  if(tl)tl.kill();
  [table,hole,fx,tile,stamp,shine,flash].forEach(n=>n.style.display='');
  build();
  gsap.set([logo,tile,stamp,flash,hole],{opacity:0});gsap.set(stamp,{scale:3,xPercent:-50,yPercent:-50,rotate:-14,left:'50%',top:'50%',x:0,y:0});
  gsap.set(tile,{scale:1,x:0,y:0});gsap.set(host,{x:0,y:0});gsap.set(shine,{left:'-40%'});
  gsap.set(table,{opacity:1,scale:1.35,filter:'none'});
  const ids=Object.keys(NODES);
  ids.forEach(id=>{const p=nodeXY(id);gsap.set(nodeEl[id],{...p,scale:0,rotation:R(-6,6),opacity:1,filter:'none'})});
  gsap.set([...threads.children],{opacity:0});
  /* everyone starts at QUIKSTOP, as in the game */
  const Q=pawnXY('quik'),fan=ch=>{const i=Object.keys(PAWNS).indexOf(ch),a=i/12*Math.PI*2;return {x:Q.x+Math.cos(a)*pw()*0.55,y:Q.y+Math.sin(a)*pw()*0.4}};
  Object.keys(PAWNS).forEach(ch=>{const p=fan(ch);gsap.set(pawnEl[ch],{x:p.x,y:p.y-S*0.6,scale:1,opacity:0,rotation:0,borderRadius:'50%',borderWidth:3})});
  tl=gsap.timeline({onComplete:tidy});
  const T=l=>tl.labels[l];

  /* ACT ONE — the board deals itself outward from Quikstop, the threads draw, the camera pulls back */
  tl.to(table,{scale:1,duration:2.6,ease:'power2.inOut'},0.1);
  ids.forEach(id=>{const [r,c]=NODES[id].rc;tl.to(nodeEl[id],{scale:1,duration:0.32,ease:'back.out(2)'},0.15+(Math.abs(r-2)+Math.abs(c-2))*0.16+R(0,0.05))});
  [...threads.children].forEach((ln,i)=>{const len=Math.hypot(ln.x2.baseVal.value-ln.x1.baseVal.value,ln.y2.baseVal.value-ln.y1.baseVal.value);
   gsap.set(ln,{strokeDasharray:ln.dataset.long==='1'?'8 6':len,strokeDashoffset:ln.dataset.long==='1'?0:len});
   tl.to(ln,{opacity:.9,strokeDashoffset:0,duration:0.35,ease:'power1.out'},0.5+i*0.025)});

  /* ACT TWO — the crew drops onto Quikstop, then each hops once to their own node */
  tl.addLabel('crew',2.3);
  Object.keys(PAWNS).forEach((ch,i)=>tl.to(pawnEl[ch],{y:'+='+S*0.6,opacity:1,duration:0.4,ease:'bounce.out'},T('crew')+i*0.045));
  Object.entries(PAWNS).forEach(([ch,id],i)=>{
   const a=fan(ch),b=pawnXY(id),top={x:(a.x+b.x)/2,y:Math.min(a.y,b.y)-S*(0.08+Math.hypot(b.x-a.x,b.y-a.y)/S*0.25)};
   tl.to(pawnEl[ch],{motionPath:{path:[a,top,b],curviness:1},duration:0.42,ease:'power1.inOut'},T('crew')+0.85+i*0.06);
  });

  /* MAXIMUM CHAOS — everything goes off at once */
  tl.addLabel('chaos',T('crew')+2.0);
  const CH=T('chaos');
  /* MISSILE COMMAND vs TUVALU: the silo fires, Tuvalu reflects the warhead home */
  fire(tl,'japsnchen',['missile'],CH);
  {const mc=[C.missile[0],C.missile[1]-nw()*0.3],tv=C.tuvalu;
   missile(tl,mc,tv,CH+0.3,0.6,true,0.3);
   const sh=el('i-shield');gsap.set(sh,{x:tv[0],y:tv[1],scale:0,opacity:0});
   tl.fromTo(sh,{scale:.3,opacity:1},{scale:1.15,duration:0.22,ease:'back.out(3)',immediateRender:false},CH+0.85)
     .to(sh,{opacity:0,scale:1.5,duration:0.4},CH+1.1)
     .to(nodeEl.tuvalu,{scale:1.12,duration:0.1,yoyo:true,repeat:1},CH+0.88);
   missile(tl,[tv[0],tv[1]-nw()*0.2],[C.missile[0],C.missile[1]],CH+0.95,0.55,false,0.24);
   rubble(tl,'missile',CH+1.5);
   shake(tl,CH+1.5,5,5);}
  /* QANTAS: Calvin flies the jet across the board; it stays parked where it lands */
  {const a=pawnXY('qantas'),b=pawnXY('petrobras'),pa=C.qantas,pb=[C.petrobras[0]-nw()*0.55,C.petrobras[1]+nw()*0.42];
   const plane=el('i-plane',PLANE);gsap.set(plane,{x:pa[0],y:pa[1],opacity:0,scale:.6});
   const mid={x:S*0.62,y:S*0.08};
   tl.to(plane,{opacity:1,scale:1,duration:0.15},CH+0.15)
     .to(plane,{motionPath:{path:[{x:pa[0],y:pa[1]},mid,{x:pb[0],y:pb[1]}],curviness:1.2,autoRotate:true},duration:1.3,ease:'power1.inOut'},CH+0.2)
     .to(pawnEl.calvinathanasius,{motionPath:{path:[a,{x:mid.x,y:mid.y-S*0.04},b],curviness:1.2},duration:1.3,ease:'power1.inOut'},CH+0.2)
     .to(plane,{rotation:0,scale:.75,duration:0.2},CH+1.5);}
  /* THE SISYPHUS BOULDER: up the hill… and back down. Twice. */
  {const c=C.sisy,b=el('i-boulder'),lo=[c[0]-nw()*0.42,c[1]+nw()*0.25],hi=[c[0]+nw()*0.35,c[1]-nw()*0.2],P0=pawnXY('sisy');
   gsap.set(b,{x:lo[0],y:lo[1],opacity:0});
   tl.to(b,{opacity:1,duration:0.15},CH+0.05).to(pawnEl.denialswan,{x:lo[0]-pw()*1.1,y:lo[1]-pw()*0.5,duration:0.2},CH+0.05);
   for(let n=0;n<2;n++){const t0=CH+0.25+n*0.95;
    tl.to(b,{x:hi[0],y:hi[1],rotation:'+=300',duration:0.55,ease:'power1.inOut'},t0)
      .to(pawnEl.denialswan,{x:hi[0]-pw()*1.1,y:hi[1]-pw()*0.5,duration:0.55,ease:'power1.inOut'},t0)
      .to(b,{x:lo[0],y:lo[1],rotation:'-=300',duration:0.3,ease:'power2.in'},t0+0.6)
      .to(pawnEl.denialswan,{x:lo[0]-pw()*1.1,y:lo[1]-pw()*0.5,rotation:-20,duration:0.3,ease:'power2.in'},t0+0.62)
      .to(pawnEl.denialswan,{rotation:0,duration:0.1},t0+0.92);}
   tl.to(pawnEl.denialswan,{x:P0.x,y:P0.y,duration:0.25},CH+2.2).to(b,{opacity:0,duration:0.2},CH+2.2);}
  /* THE ROCK cooks the books */
  {const c=C.rock,pan=el('i-emo','🍳'),book=el('i-emo','📒'),f1=el('i-emo','🔥'),f2=el('i-emo','🔥');
   gsap.set(pan,{x:c[0],y:c[1]+nw()*0.12,scale:0,opacity:1});gsap.set(book,{x:c[0],y:c[1]-S*0.25,opacity:0,scale:.7});
   gsap.set([f1,f2],{x:c[0],y:c[1]+nw()*0.2,scale:0,opacity:1});
   tl.to(pan,{scale:1.2,duration:0.25,ease:'back.out(3)'},CH+0.45)
     .to(book,{y:c[1]+nw()*0.05,opacity:1,duration:0.35,ease:'bounce.out'},CH+0.6)
     .to(f1,{x:c[0]-S*0.025,scale:1,duration:0.15},CH+0.9).to(f2,{x:c[0]+S*0.025,scale:.9,duration:0.15},CH+0.95)
     .to([f1,f2],{scaleY:1.35,duration:0.12,yoyo:true,repeat:9,stagger:0.05},CH+1.05)
     .to(book,{filter:'brightness(.4) sepia(1)',duration:0.6},CH+1.1);
   for(let n=0;n<5;n++){const m=el('i-cash',n%2?'$':'💵');gsap.set(m,{x:c[0]+R(-.04,.04)*S,y:c[1],opacity:0});
    tl.to(m,{y:'-='+S*R(.12,.2),opacity:1,duration:0.25},CH+1.1+n*0.15).to(m,{opacity:0,duration:0.3},CH+1.4+n*0.15)}
   tl.to([pan,book,f1,f2],{opacity:0,scale:.3,duration:0.3},CH+2.2);}
  /* MILEI: the chainsaw cuts a thread for good */
  {const line=[...threads.children].find(l=>l.dataset.a==='milei'||l.dataset.b==='milei'),saw=el('i-emo','🪚');
   const mx=(line.x1.baseVal.value+line.x2.baseVal.value)/2,my=(line.y1.baseVal.value+line.y2.baseVal.value)/2;
   gsap.set(saw,{x:C.milei[0],y:C.milei[1],scale:0,opacity:1});
   tl.to(saw,{scale:1.1,duration:0.15},CH+0.35).to(saw,{x:mx,y:my,duration:0.35,ease:'power2.in'},CH+0.5)
     .to(saw,{rotation:25,duration:0.05,yoyo:true,repeat:7},CH+0.85)
     .to(line,{attr:{stroke:'#ff3b30'},duration:0.1},CH+0.85).to(line,{opacity:0,duration:0.25},CH+1.25)
     .to(saw,{opacity:0,y:'-='+S*0.05,duration:0.3},CH+1.3);
   boom(tl,[mx,my],CH+1.2);}
  /* THE BERMUDA TRIANGLE swallows the pawn on MADE (it turns up again later) */
  {const sw=el('i-emo','🌀'),c=C.bermuda,al=pawnEl.Alexander_Lane;
   gsap.set(sw,{x:c[0],y:c[1],scale:0,opacity:1,rotation:0});
   tl.to(sw,{scale:2.2,rotation:720,duration:1.2,ease:'none'},CH+0.6)
     .to(al,{x:c[0]-pw()/2,y:c[1]-pw()/2,scale:0.1,rotation:900,duration:0.7,ease:'power2.in'},CH+0.85)
     .set(al,{opacity:0},CH+1.55)
     .to(sw,{scale:0,opacity:0,duration:0.3},CH+1.8);}
  /* MONACO: the roulette wheel spins, the chips fly */
  {const w=el('i-wheel'),c=C.monaco;gsap.set(w,{x:c[0],y:c[1],scale:0,opacity:1});
   tl.to(w,{scale:1,duration:0.2,ease:'back.out(2)'},CH+0.3).to(w,{rotation:1440,duration:1.4,ease:'power3.out'},CH+0.35);
   for(let n=0;n<4;n++){const ch=el('i-emo','🪙');gsap.set(ch,{x:c[0],y:c[1],scale:.6,opacity:0});
    tl.to(ch,{x:'+='+S*R(-.08,.12),y:'-='+S*R(.06,.14),opacity:1,rotation:R(-180,180),duration:0.35,ease:'power2.out'},CH+1.5+n*0.05).to(ch,{opacity:0,duration:0.25},CH+1.9+n*0.05)}
   tl.to(w,{scale:0,opacity:0,duration:0.25},CH+2.1);}
  /* BAIKONUR: the rocket goes up */
  {const r=el('i-emo','🚀'),c=C.baikonur;gsap.set(r,{x:c[0],y:c[1],rotation:-45,scale:0,opacity:1});
   tl.to(r,{scale:1.2,duration:0.15},CH+0.9).to(r,{y:-S*0.15,duration:1.0,ease:'power2.in'},CH+1.05);
   for(let n=0;n<8;n++){const sm=el('i-emo','💨');gsap.set(sm,{x:c[0],y:c[1],scale:0,opacity:0});
    tl.set(sm,{opacity:.85,y:c[1]-n*S*0.09},CH+1.05+n*0.1).to(sm,{scale:R(.7,1.2),opacity:0,x:'+='+S*R(-.03,.03),duration:0.7},CH+1.05+n*0.1)}
   shake(tl,CH+1.0,3,3);}

  /* ACT THREE — BONDMAGEDDON: the Bond Desk and “Bond Markets Revolt” fire four missiles */
  tl.addLabel('bond',CH+2.45);
  fire(tl,'markwatson',['bond','leak'],T('bond'));
  ['milei','bermuda','monaco','baikonur'].forEach((b,i)=>{
   const src=C[i%2?'leak':'bond'];
   missile(tl,[src[0]+nw()*0.4,src[1]],C[b],T('bond')+0.35+i*0.14,0.55);
   rubble(tl,b,T('bond')+0.9+i*0.14);
  });
  shake(tl,T('bond')+0.95,8,6);

  /* ACT FOUR — LIBERATE OIL: Trump and Big Yahu fire on every oil node, Lockheed scrambles the F-35s */
  tl.addLabel('oil',T('bond')+1.85);
  fire(tl,'DJT',['trump','yahu','lockheed'],T('oil'));
  const oils=ids.filter(id=>NODES[id].kind==='oil');
  oils.forEach((o,i)=>['trump','yahu'].forEach((src,j)=>missile(tl,[C[src][0]+R(-.02,.02)*S,C[src][1]-nw()*0.3],[C[o][0]+R(-.03,.03)*S,C[o][1]+R(-.02,.02)*S],T('oil')+0.3+i*0.09+j*0.045,0.6)));
  const lk=C.lockheed;
  for(let n=0;n<6;n++){const o=C[oils[(n*3)%oils.length]];
   jet(tl,[[lk[0],lk[1]],[S*R(.45,.6),S*R(.55,.9)],[o[0],o[1]],[S*1.3,S*R(-.3,1.2)]],T('oil')+0.25+n*0.13,1.1)}
  oils.forEach((o,i)=>{boom(tl,C[o],T('oil')+0.95+i*0.09,true);rubble(tl,o,T('oil')+0.98+i*0.09)});
  shake(tl,T('oil')+1.0,16,8);
  tl.to(flash,{opacity:0.8,duration:0.08},T('oil')+1.9).to(flash,{opacity:0,duration:0.5},T('oil')+1.98);

  /* ACT FIVE — the crew steps off the board and forms the logo; the four who are not in it are CONNED off the table */
  tl.addLabel('form',T('oil')+2.35);
  {const p=pawnXY('made');tl.set(pawnEl.Alexander_Lane,{x:p.x,y:p.y,rotation:0},T('form')-0.35).to(pawnEl.Alexander_Lane,{opacity:1,scale:1,duration:0.2,ease:'back.out(3)'},T('form')-0.3);}
  tl.to(table,{opacity:0,scale:0.9,filter:'blur(3px)',duration:0.7,ease:'power2.in'},T('form')+0.15);
  tl.to(fx.querySelectorAll('.i-plane,.i-emo,.i-boulder,.i-wheel'),{opacity:0,duration:0.4},T('form')+0.15);
  Object.keys(PAWNS).forEach(ch=>{
   const s=SLOTS[ch],d=pawnEl[ch];
   if(s){const sz=FACE*k;tl.to(d,{x:s[0]*k-pw()/2,y:s[1]*k-pw()/2,scale:sz/pw(),borderRadius:'0%',borderWidth:0,rotation:0,duration:0.7,ease:'back.out(1.2)'},T('form')+R(0,0.2))}
   else{const a=R(0,Math.PI*2);tl.to(d,{x:'+='+Math.cos(a)*S*1.2,y:'+='+Math.sin(a)*S*1.2,rotation:R(-540,540),duration:0.6,ease:'power2.in'},T('form')+0.1)}
  });
  tl.to(stamp,{opacity:1,scale:1,duration:0.18,ease:'power4.in'},T('form')+0.2);
  shake(tl,T('form')+0.38,3,6);
  tl.to(stamp,{opacity:0,duration:0.25},T('form')+0.75);
  tl.set(hole,{opacity:1},T('form')+0.95);
  tl.to(logo,{opacity:1,duration:0.45},T('form')+1.0);
  tl.to(Object.keys(SLOTS).map(ch=>pawnEl[ch]),{opacity:0,duration:0.45},T('form')+1.0);
  tl.fromTo(tile,{opacity:0,scale:2.4,rotation:-6},{opacity:1,scale:1,rotation:0,duration:0.32,ease:'power4.in',immediateRender:false},T('form')+1.1)
    .set(hole,{opacity:0},T('form')+1.42)
    .to(flash,{opacity:0.55,duration:0.04},T('form')+1.42)
    .to(flash,{opacity:0,duration:0.3},T('form')+1.46);
  shake(tl,T('form')+1.42,5,7);
  [...tile.children].forEach((cv,i)=>tl.to(cv,{scaleY:0,transformOrigin:'50% 0%',duration:0.08,ease:'steps(3)'},T('form')+1.7+i*0.13));
  tl.to(tile,{scale:1.06,duration:0.08,yoyo:true,repeat:1,ease:'power2.out'},T('form')+1.7+9*0.13);
  tl.to(shine,{left:'130%',duration:0.8,ease:'power2.inOut'},'>+0.1');
 }
 const skip=()=>{if(tl&&tl.isActive())tl.progress(1)};
 host.addEventListener('click',skip);
 const start=()=>{try{play()}catch(e){console.warn('[intro]',e);tidy()}};
 if(logo.complete)start();else{logo.addEventListener('load',start,{once:true});logo.addEventListener('error',start,{once:true})}
 return {play:()=>start(),skip,timeline:()=>tl};
}
