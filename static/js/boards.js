'use strict';
/* boards: node layout helpers and the random / ringworld / mega-ring board generators. Pure: no DOM; they only read S and rewrite NODES positions / EDGES. */
import { NODES, NMAP, EDGES, WORLD_EDGES, WORLD_EXP, worldRandomBounds, ORIGINAL_NODE_LAYOUT, ORIGINAL_LAYOUT_BY_ID, HIGH_VALUE_NODE_IDS, HIGH_VALUE_BASE_IDS, GEO_HIGH_VALUE_IDS, QUIK_SLOTS, rebuildAdj, setEdges } from './data.js';
import { S } from './state.js';
import { shuffle } from './util.js';
import { LAND, WATER, WORLD_ROUTES, WORLD_RANDOM_SCALE, geoOf } from './world.js';
export function nodeBox(n){
 const sizes={card:[150,84],photo:[140,92],wide:[170,100],bubble:[150,80],logo:[150,80],chart:[130,64],news:[150,84],made:[140,74],mpc:[164,96],sat:[170,90]};
 return sizes[n.shape]||[150,80];
}
/* opts: pad, iters, minX/maxX/minY/maxY (default: the collage canvas), anchors {id:{x,y}} + pull (spring back to the true spot). */
export function separateNodes(opts){
 const o=opts||{};
 const f=WORLD_EXP&&o.minX==null?WORLD_RANDOM_SCALE:1;
 const pad=o.pad==null?16:o.pad,minX=o.minX==null?95*f:o.minX,maxX=o.maxX==null?2305*f:o.maxX,minY=o.minY==null?95*f:o.minY,maxY=o.maxY==null?1455*f:o.maxY;
 const iters=o.iters||90,anchors=o.anchors||null,pull=o.pull||0;
 const boxes=NODES.map(nodeBox);
 for(let iter=0;iter<iters;iter++){
  let moved=false;
  for(let i=0;i<NODES.length;i++){
   for(let j=i+1;j<NODES.length;j++){
    const A=NODES[i],B=NODES[j];
    const [aw,ah]=boxes[i],[bw,bh]=boxes[j];
    const dx=B.x-A.x,dy=B.y-A.y;
    const ox=(aw+bw)/2+pad-Math.abs(dx);
    const oy=(ah+bh)/2+pad-Math.abs(dy);
    if(ox>0&&oy>0){
     if(ox<oy){const s=dx===0?(i%2?1:-1):Math.sign(dx);const p=ox/2+.6;A.x-=s*p;B.x+=s*p}
     else{const s=dy===0?(i%2?1:-1):Math.sign(dy);const p=oy/2+.6;A.y-=s*p;B.y+=s*p}
     moved=true;
    }
   }
  }
  /* a spring toward each node's true geographic spot, for the first 70% of the passes only */
  const springing=!!(anchors&&pull&&iter<iters*0.7);
  if(springing)NODES.forEach(n=>{const a=anchors[n.id];if(a){n.x+=(a.x-n.x)*pull;n.y+=(a.y-n.y)*pull}});
  NODES.forEach(n=>{n.x=Math.max(minX,Math.min(maxX,n.x));n.y=Math.max(minY,Math.min(maxY,n.y))});
  if(!moved&&!springing)break;
 }
}
export function applyQuikSlot(slot){
 const q=NMAP.quik;if(!q||!slot)return;
 const sf=WORLD_EXP?WORLD_RANDOM_SCALE:1;
 q.x=slot.x*sf;q.y=slot.y*sf;q.rot=slot.rot;
 setEdges(WORLD_EDGES.filter(e=>e[0]!=='quik'&&e[1]!=='quik').concat((slot.links||[]).map(id=>['quik',id])));
 rebuildAdj();
 separateNodes();
}
export function applyLayoutFromState(){
 if(!S)return;
 const slot=QUIK_SLOTS[S.quikSlot|0]||QUIK_SLOTS[0];
 if(S.boardLayout){
  S.boardLayout.forEach(p=>{const n=NMAP[p.id];if(n){n.x=p.x;n.y=p.y;n.rot=p.rot}});
  setEdges((S.boardEdges||WORLD_EDGES).map(e=>e.slice()));
  rebuildAdj();
 }else applyQuikSlot(slot);
}
export function generateRandomBoard(slot){
 const q=NMAP.quik;
 /* with the WORLD EXPANSION the canvas (and so every Quikstop neighbourhood) is scaled up */
 if(WORLD_EXP)slot={x:slot.x*WORLD_RANDOM_SCALE,y:slot.y*WORLD_RANDOM_SCALE,rot:slot.rot};
 q.x=slot.x;q.y=slot.y;q.rot=slot.rot;
 const ids=NODES.map(n=>n.id).filter(id=>id!=='quik');
 const positions=shuffle(ORIGINAL_NODE_LAYOUT.filter(p=>p.id!=='quik').map(p=>({x:p.x,y:p.y,rot:p.rot})));
 const farthest=positions.slice().sort((a,b)=>Math.hypot(b.x-slot.x,b.y-slot.y)-Math.hypot(a.x-slot.x,a.y-slot.y));
 const basePrized=shuffle(ids.filter(id=>HIGH_VALUE_BASE_IDS.includes(id)&&id!=='made'));
 const geoPrized=shuffle(ids.filter(id=>GEO_HIGH_VALUE_IDS.includes(id)));
 const ordinary=shuffle(ids.filter(id=>!HIGH_VALUE_NODE_IDS.has(id)&&id!=='made'));
 const assignment={quik:{x:slot.x,y:slot.y,rot:slot.rot}};
 const quikPoint={x:slot.x,y:slot.y};
 assignment.made=farthest[0];
 const remaining=positions.filter(p=>p!==assignment.made);
 const basePool=remaining.slice().sort((a,b)=>Math.hypot(b.x-slot.x,b.y-slot.y)-Math.hypot(a.x-slot.x,a.y-slot.y)).slice(0,Math.ceil(positions.length*.55)); /* a wider outer-board pool preserves the prized-ring bias */
 const takeMostSpaced=(pool,anchors)=>{pool.sort((a,b)=>Math.min(...anchors.map(p=>Math.hypot(b.x-p.x,b.y-p.y)))-Math.min(...anchors.map(p=>Math.hypot(a.x-p.x,a.y-p.y))));const p=pool.shift();const at=remaining.indexOf(p);if(at>=0)remaining.splice(at,1);return p};
 const baseAnchors=[quikPoint,assignment.made];
 basePrized.forEach(id=>{const p=takeMostSpaced(basePool,baseAnchors);assignment[id]=p;baseAnchors.push(p)});
 const sortedRemaining=remaining.slice().sort((a,b)=>Math.hypot(a.x-slot.x,a.y-slot.y)-Math.hypot(b.x-slot.x,b.y-slot.y));
 const geoPool=geoPrized.length?sortedRemaining.slice(Math.floor(sortedRemaining.length*.10),Math.ceil(sortedRemaining.length*.98)):[]; /* wide outer-biased pool, max-min spaced */
 geoPrized.forEach(id=>{const p=takeMostSpaced(geoPool,baseAnchors);assignment[id]=p;baseAnchors.push(p)});
 const ordinaryPositions=shuffle(remaining);
 ordinary.forEach((id,i)=>{assignment[id]=ordinaryPositions[i]});
 NODES.forEach(n=>{const p=assignment[n.id]||ORIGINAL_LAYOUT_BY_ID[n.id];n.x=p.x;n.y=p.y;n.rot=p.rot});
 /* High-value nodes keep the max-min spacing assigned above. */
 /* Randomized nearest-neighbour spanning tree, then extra local links. */
 const order=shuffle(ids),edges=[],seen=new Set();
 const add=(a,b)=>{if(!a||!b||a===b)return;const key=[a,b].sort().join('|');if(seen.has(key))return;seen.add(key);edges.push([a,b])};
 const placed=[order[0]];
 for(let i=1;i<order.length;i++){
  const id=order[i],n=NMAP[id];
  const candidates=placed.slice().sort((a,b)=>{
   const A=NMAP[a],B=NMAP[b];
   return Math.hypot(A.x-n.x,A.y-n.y)-Math.hypot(B.x-n.x,B.y-n.y);
  }).slice(0,Math.min(5,placed.length));
  add(id,candidates[Math.floor(Math.random()*candidates.length)]);
  placed.push(id);
 }
 for(const id of ids){
  if(id==='made')continue;
  const n=NMAP[id];
  const near=ids.filter(other=>other!==id).map(other=>({id:other,d:Math.hypot(NMAP[other].x-n.x,NMAP[other].y-n.y)})).sort((a,b)=>a.d-b.d).slice(0,8);
  shuffle(near).slice(0,2+Math.floor(Math.random()*2)).forEach(v=>add(id,v.id));
 }
 const nearest=ids.map(id=>({id,d:Math.hypot(NMAP[id].x-q.x,NMAP[id].y-q.y)})).sort((a,b)=>a.d-b.d);
 nearest.slice(0,5).forEach(v=>add('quik',v.id));
 /* Cap MADE to 1-2 connections: trim extras, ensure at least one. */
 let madeEdges=edges.filter(e=>e[0]==='made'||e[1]==='made');
 if(madeEdges.length>2){const kept=[];let c=0;for(const e of edges){if(e[0]==='made'||e[1]==='made'){if(c<2){c++;kept.push(e)}}else kept.push(e)};edges.length=0;edges.push(...kept)}
 if(!edges.some(e=>e[0]==='made'||e[1]==='made')){const nearMade=ids.filter(x=>x!=='made').map(x=>({id:x,d:Math.hypot(NMAP[x].x-NMAP.made.x,NMAP[x].y-NMAP.made.y)})).sort((a,b)=>a.d-b.d)[0].id;add('made',nearMade)}
 setEdges(edges);rebuildAdj();separateNodes();
 return {positions:NODES.map(n=>({id:n.id,x:n.x,y:n.y,rot:n.rot})),edges:EDGES.map(e=>e.slice())};
}
/* Perimeter of an ellipse (Ramanujan) — used to size the three tracks. */
export function ringEllipsePerimeter(rx,ry){
 const h=Math.pow((rx-ry)/(rx+ry),2);
 return Math.PI*(rx+ry)*(1+(3*h)/(10+Math.sqrt(4-3*h)));
}
/* Declare a track as a cumulative arc-length table, so nodes can be spaced by
   distance along the ellipse instead of by angle. Constant angle bunches
   neighbours together at the ends of an ellipse, where the curve is tightest. */
export function ringArcTable(rx,ry,steps){
 const angles=[],cum=[0];
 let total=0,px=rx,py=0;
 for(let i=1;i<=steps;i++){
  const a=i/steps*Math.PI*2,x=Math.cos(a)*rx,y=Math.sin(a)*ry;
  total+=Math.hypot(x-px,y-py);angles.push(a);cum.push(total);px=x;py=y;
 }
 return {rx,ry,total,angles,cum};
}
export function ringPointAtArc(table,fraction){
 const s=(((fraction%1)+1)%1)*table.total;
 let lo=1,hi=table.cum.length-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(table.cum[mid]<s)lo=mid+1;else hi=mid}
 const i=lo,prev=table.cum[i-1],seg=(table.cum[i]-prev)||1,k=(s-prev)/seg;
 const a0=table.angles[i-1]||0,a1=table.angles[i]||a0;
 const angle=a0+(a1-a0)*k;
 return {angle,x:Math.cos(angle)*table.rx,y:Math.sin(angle)*table.ry};
}
/* Size all three tracks from the tightest one so every neighbour keeps an
   image-to-image gap, then scale the tracks together to preserve the gaps
   between rings. The canvas grows to fit the outer track. */
export function ringworldMetrics(nodeCount){
 const n=Math.max(3,nodeCount|0);
 const pitch=202; /* the same 170px maximum image width + 32px clear space as Mega Ring */
 const base=[{x:1050,y:630},{x:780,y:465},{x:510,y:300}];
 const counts=base.map((_,i)=>Math.floor((n-i+2)/3)); /* rings are filled i%3 */
 let scale=1;
 base.forEach((r,i)=>{scale=Math.max(scale,pitch*counts[i]/ringEllipsePerimeter(r.x,r.y))});
 const radii=base.map(r=>({x:r.x*scale,y:r.y*scale}));
 const margin=380;
 const w=Math.ceil((radii[0].x+margin)*2/100)*100;
 const h=Math.ceil((radii[0].y+margin)*2/100)*100;
 return {x:0,y:0,w,h,cx:w/2,cy:h/2,radii,counts,scale,pitch,margin};
}
export function generateRingworldBoard(){
 const ids=shuffle(NODES.map(n=>n.id).filter(id=>id!=='quik'));
 const metrics=ringworldMetrics(ids.length);
 const q=NMAP.quik;
 const cx=metrics.cx,cy=metrics.cy;
 q.x=Math.round(cx);q.y=Math.round(cy);q.rot=0;
 const rings=[[],[],[]];
 ids.forEach((id,i)=>rings[i%rings.length].push(id));
 /* half-slot and 0.65-slot offsets keep the radial links from stacking exactly */
 const phaseSlots=[0,0.5,0.65];
 rings.forEach((ring,ri)=>{
  const r=metrics.radii[ri];
  const table=ringArcTable(r.x,r.y,Math.max(360,ring.length*24));
  ring.forEach((id,i)=>{
   const pt=ringPointAtArc(table,(i+phaseSlots[ri])/ring.length);
   const x=cx+pt.x;
   const y=cy+pt.y;
   const tangent=Math.atan2(r.y*Math.cos(pt.angle),-r.x*Math.sin(pt.angle))*180/Math.PI;
   const n=NMAP[id];n.x=Math.round(x);n.y=Math.round(y);n.rot=Math.round(tangent*10)/10;
  });
 });
 const edges=[],seen=new Set();
 const add=(a,b)=>{
  if(!a||!b||a===b)return;
  const key=[a,b].sort().join('|');
  if(seen.has(key))return;
  seen.add(key);edges.push([a,b]);
 };
 // Each track is a closed loop.
 rings.forEach(ring=>{
  for(let i=0;i<ring.length;i++)add(ring[i],ring[(i+1)%ring.length]);
 });
 // Radial links connect the three loops into one traversable network.
 for(let ri=0;ri<rings.length-1;ri++){
  const outer=rings[ri],inner=rings[ri+1];
  outer.forEach((id,i)=>add(id,inner[Math.round(i*inner.length/outer.length)%inner.length]));
 }
 // Quikstop is the central hub, with four evenly spaced spokes to the inner ring.
 const inner=rings[2];
 for(let k=0;k<4;k++)add('quik',inner[Math.floor(k*inner.length/4)]);
 setEdges(edges);rebuildAdj();
 return {positions:NODES.map(n=>({id:n.id,x:n.x,y:n.y,rot:n.rot})),edges:EDGES.map(e=>e.slice())};
}
/* Size the ring from the widest exhibit so every neighbour keeps an
   image-to-image gap, including when the Geography DLC adds more nodes. */
export function megaRingMetrics(nodeCount){
 const n=Math.max(3,nodeCount|0);
 const nodePitch=202; /* 170px maximum image width + at least 32px clear space */
 const radius=Math.max(2500,nodePitch/(2*Math.sin(Math.PI/n)));
 const margin=380;
 const size=Math.ceil((radius+margin)*2/100)*100;
 return {x:0,y:0,w:size,h:size,cx:size/2,cy:size/2,radius,margin};
}
export function generateMegaRingBoard(){
 const ids=shuffle(NODES.map(n=>n.id).filter(id=>id!=='quik'));
 const n=ids.length;
 const map=megaRingMetrics(n);
 const q=NMAP.quik;
 q.x=map.cx;q.y=map.cy;q.rot=0;
 if(n===0){setEdges([]);rebuildAdj();return {positions:NODES.map(n=>({id:n.id,x:n.x,y:n.y,rot:n.rot})),edges:[]};}
 ids.forEach((id,i)=>{
  const angle=(Math.PI*2*i/n);
  const x=map.cx+Math.cos(angle)*map.radius;
  const y=map.cy+Math.sin(angle)*map.radius;
  const tangent=(angle+Math.PI/2)*180/Math.PI;
  const node=NMAP[id];node.x=Math.round(x);node.y=Math.round(y);node.rot=Math.round(tangent*10)/10;
 });
 const edges=[],seen=new Set();
 const add=(a,b)=>{
  if(!a||!b||a===b)return;
  const key=[a,b].sort().join('|');
  if(seen.has(key))return;
  seen.add(key);edges.push([a,b]);
 };
 for(let i=0;i<n;i++)add(ids[i],ids[(i+1)%n]);
 for(let k=0;k<4;k++)add('quik',ids[Math.floor(k*n/4)]);
 setEdges(edges);rebuildAdj();
 return {positions:NODES.map(n=>({id:n.id,x:n.x,y:n.y,rot:n.rot})),edges:EDGES.map(e=>e.slice())};
}
export function boardViewBounds(){
 if(S&&S.layoutKind==='worldmap'){const m=worldMapMetrics();return {x:0,y:0,w:m.w,h:m.h}}
 if(S&&S.dlcWorld&&S.layoutKind!=='megaring'&&S.layoutKind!=='ringworld')return worldRandomBounds();
 if(S&&(S.layoutKind==='megaring'||S.layoutKind==='ringworld')){
  const count=Math.max(3,(S.boardLayout||[]).length-1||NODES.length-1);
  const m=S.layoutKind==='ringworld'?ringworldMetrics(count):megaRingMetrics(count);
  return {x:m.x,y:m.y,w:m.w,h:m.h};
 }
 return {x:0,y:0,w:2400,h:1560};
}
/* ================= 🌍 WORLD MAP — every exhibit pinned where it lives ================= */
/* An equirectangular map with a few local "magnifying glasses": the Sydney inset, Europe, the US east coast, Singapore,
   Hong Kong, Tokyo and Mumbai are stretched so the crowded cities have room, and the very same warp is applied to the
   continent outlines, so the backdrop and the pins always agree. */
const WM_K=26,WM_TOP=84,WM_MARGIN=360;
const WM_WARPS=[
 {lat:-31,lon:143,A:2.7,R:25},   /* Australia: the home turf and the busiest corner of the board */
 {lat:49,lon:7,A:2.3,R:13},      /* Europe */
 {lat:40,lon:-77,A:2.3,R:9},     /* New York · Washington */
 {lat:1.5,lon:104,A:2,R:5.5},    /* Singapore · Kuala Lumpur */
 {lat:22.5,lon:114,A:2,R:5},     /* Hong Kong · Shenzhen */
 {lat:36,lon:139,A:1.9,R:6},     /* Tokyo */
 {lat:19,lon:74,A:1.9,R:5}       /* Mumbai · Ahmedabad */
];
function warpGeo(lat,lon){
 for(const w of WM_WARPS){
  const dx=lon-w.lon,dy=lat-w.lat,r=Math.hypot(dx,dy);
  const m=1+(w.A-1)*Math.exp(-(r/w.R)*(r/w.R));
  lon=w.lon+dx*m;lat=w.lat+dy*m;
 }
 return [lat,lon];
}
let WM_CACHE=null;
function densify(ring){
 const out=[];
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2.5));
  for(let k=0;k<n;k++)out.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);
 }
 return out;
}
export function worldMapMetrics(){
 if(WM_CACHE)return WM_CACHE;
 let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
 LAND.map(densify).forEach(r=>r.forEach(([lon,lat])=>{const [la,lo]=warpGeo(lat,lon);const x=(lo+180)*WM_K,y=(WM_TOP-la)*WM_K;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}));
 WM_CACHE={ox:WM_MARGIN-minX,oy:WM_MARGIN-minY+260,w:Math.ceil((maxX-minX+WM_MARGIN*2)/100)*100,h:Math.ceil((maxY-minY+WM_MARGIN*2+260+160)/100)*100};
 return WM_CACHE;
}
/* board pixels for a latitude/longitude (warped, then scaled) */
export function projectGeo(lat,lon){
 const m=worldMapMetrics(),[la,lo]=warpGeo(lat,lon);
 return {x:(lo+180)*WM_K+m.ox,y:(WM_TOP-la)*WM_K+m.oy};
}
/* The backdrop: land masses, inland seas and a faint graticule, as one inline <g>. No images, a few KB of path data. */
export function worldMapSVG(){
 const ring=r=>'M'+densify(r).map(([lon,lat])=>{const p=projectGeo(lat,lon);return Math.round(p.x)+','+Math.round(p.y)}).join('L')+'Z';
 const line=pts=>pts.map((p,i)=>(i?'L':'M')+Math.round(p.x)+','+Math.round(p.y)).join('');
 let grat='';
 for(let lat=-60;lat<=60;lat+=30){const pts=[];for(let lon=-180;lon<=180;lon+=5)pts.push(projectGeo(lat,lon));grat+='<path d="'+line(pts)+'"/>'}
 for(let lon=-150;lon<=150;lon+=30){const pts=[];for(let lat=-80;lat<=80;lat+=5)pts.push(projectGeo(lat,lon));grat+='<path d="'+line(pts)+'"/>'}
 return '<g class="worldmap" pointer-events="none">'
  +'<g fill="none" stroke="#168388" stroke-width="2" stroke-dasharray="14 18" opacity=".16">'+grat+'</g>'
  +'<path d="'+LAND.map(ring).join('')+'" fill="#27312f" stroke="#2f8f8a" stroke-width="5" stroke-linejoin="round" opacity=".95"/>'
  +'<path d="'+WATER.map(ring).join('')+'" fill="#1d201f" stroke="#2f8f8a" stroke-width="4" opacity=".95"/>'
  +'</g>';
}
/* the two American continents touch only at Panama: a node is on the south side, the north side, or (Panama) neither */
const SIDE_S=n=>{const g=geoOf(n);if(!g||n.id==='w_panama')return false;const la=g[0],lo=g[1];return lo>-130&&lo<-34&&(la<8.5||(la<12.4&&lo>-75))};
const SIDE_N=n=>{const g=geoOf(n);if(!g||n.id==='w_panama')return false;const la=g[0],lo=g[1];return lo>-130&&lo<-30&&la>=8.5&&!SIDE_S(n)};
/* distance in km on the flat map (no wrapping over the date line: a thread must never cross the whole board) */
function haversine(a,b){
 const r=Math.PI/180,dx=(b[1]-a[1])*Math.cos((a[0]+b[0])/2*r),dy=b[0]-a[0];
 return Math.hypot(dx,dy)*111;
}
/* Exhibits pinned to (almost) the same spot — a whole city's worth in Sydney — are first laid out as a tidy grid
   around their centroid, so the relaxation below only has small corrections left to make. */
function spreadClusters(radius){
 const left=NODES.slice(),groups=[];
 while(left.length){
  const seed=left.shift(),g=[seed];
  for(let i=left.length-1;i>=0;i--)if(Math.hypot(left[i].x-seed.x,left[i].y-seed.y)<radius){g.push(left[i]);left.splice(i,1)}
  if(g.length>1)groups.push(g);
 }
 groups.forEach(g=>{
  const cx=g.reduce((a,n)=>a+n.x,0)/g.length,cy=g.reduce((a,n)=>a+n.y,0)/g.length;
  const cols=Math.ceil(Math.sqrt(g.length*1.7)),rows=Math.ceil(g.length/cols);
  const cw=176,ch=100,sorted=g.slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x));
  sorted.forEach((n,k)=>{
   const r=Math.floor(k/cols),c=k%cols,inRow=Math.min(cols,g.length-r*cols);
   n.x=cx+(c-(inRow-1)/2)*cw;n.y=cy+(r-(rows-1)/2)*ch;
  });
 });
}
export function generateWorldMapBoard(){
 const m=worldMapMetrics();
 const anchors={};
 NODES.forEach(n=>{
  const g=geoOf(n);
  const p=g?projectGeo(g[0],g[1]):{x:m.w/2,y:m.h/2};
  n.x=p.x;n.y=p.y;n.rot=0;anchors[n.id]={x:p.x,y:p.y};
 });
 spreadClusters(150);
 separateNodes({pad:12,iters:900,pull:0.012,minX:110,maxX:m.w-110,minY:110,maxY:m.h-110,anchors});
 NODES.forEach(n=>{n.x=Math.round(n.x);n.y=Math.round(n.y)});
 /* edges: each exhibit to its two nearest neighbours (true distance), then the cheapest links that join any
    islands left over, then the long-haul shipping lanes and flight paths. */
 const ids=NODES.map(n=>n.id),geo={};ids.forEach(id=>{geo[id]=geoOf(NMAP[id])||[0,0]});
 const blocked=(a,b)=>(SIDE_N(NMAP[a])&&SIDE_S(NMAP[b]))||(SIDE_S(NMAP[a])&&SIDE_N(NMAP[b]));
 const edges=[],seen=new Set(),par={};ids.forEach(id=>par[id]=id);
 const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x]}return x};
 const add=(a,b)=>{if(!NMAP[a]||!NMAP[b]||a===b)return false;const key=a<b?a+'|'+b:b+'|'+a;if(seen.has(key))return false;seen.add(key);edges.push([a,b]);par[find(a)]=find(b);return true};
 const pairs=[];
 for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)pairs.push([ids[i],ids[j],haversine(geo[ids[i]],geo[ids[j]])]);
 pairs.sort((a,b)=>a[2]-b[2]);
 const near={};ids.forEach(id=>near[id]=0);
 pairs.forEach(([a,b])=>{if(blocked(a,b))return;if(near[a]<2||near[b]<2){if(add(a,b)){near[a]++;near[b]++}}});
 pairs.forEach(([a,b])=>{if(blocked(a,b)||find(a)===find(b))return;add(a,b)});
 WORLD_ROUTES.forEach(([a,b])=>{if(!blocked(a,b))add(a,b)});
 /* Quikstop is the hub of the home turf: always at least four ways out */
 pairs.filter(p=>p[0]==='quik'||p[1]==='quik').slice(0,4).forEach(([a,b])=>add(a,b));
 setEdges(edges);rebuildAdj();
 return {positions:NODES.map(n=>({id:n.id,x:n.x,y:n.y,rot:n.rot})),edges:EDGES.map(e=>e.slice())};
}
