'use strict';
/* data: static game data — nodes, edges, geography DLC, characters, moods, room-code buzzwords; builds the world graph. Pure: no DOM, no state.
   NODES/EDGES/… are live bindings rebuilt by rebuildWorld(); other modules read them, and replace EDGES/NODES only through setEdges/setNodes. */
/* ================= THE COMPLETE EVIDENCE BOARD — 70 exhibits · +12 with the GEOGRAPHY DLC ================= */
export const BASE_NODES=[
{id:'citi',image:'./static/citi tower.webp',name:['CITI TOWER'],icon:'🏦',type:'BANK',shape:'logo',band:'#1a5fa8',income:3,cost:8,x:210,y:150,rot:-2,sub:'too big to fail · 007 on payroll',sp:'+$1 income per CORPORATE node you own (James Bond is on the payroll).'},
{id:'commbank',image:'./static/cba.png',name:['COMMONWEALTH BANK'],icon:'🏦',type:'BANK',shape:'logo',band:'#d4a017',income:2,cost:6,x:400,y:95,rot:2,sub:'can’t be beat? we’ll see',sp:'+$2 income while you own any other BANK (the big four stick together).'},
{id:'nab',image:'./static/nab.png',name:['NAB'],icon:'🏦',type:'BANK',shape:'logo',band:'#c0392b',income:2,cost:6,x:590,y:165,rot:-1,sub:'more than money',sp:'Seizing CHART nodes costs you $1 less (their analysts share screens).'},
{id:'anz',image:'./static/anz.png',name:['ANZ'],icon:'🏦',type:'BANK',shape:'logo',band:'#2e7d64',income:2,cost:6,x:770,y:100,rot:2,sub:'the blue bank',sp:'+$1 income per CHART node you own (ANZ reads the data).'},
{id:'westpac',image:'./static/westpac.png',name:['WESTPAC'],icon:'🏦',type:'BANK',shape:'logo',band:'#d21e2b',income:2,cost:6,x:500,y:270,rot:1,sub:'the red bank · the other fourth',sp:'+$1 income per REGULATOR you own (they have sat through every inquiry).'},
{id:'bond',image:'./static/bond desk.png',name:['THE BOND DESK'],icon:'💼',type:'BANK',income:3,cost:8,x:1040,y:310,rot:1,sub:'“Government Bond: the collapse of the world’s safest investment.”',sp:'Gain 2 Intel when you seize it. Collects $2 per BANK a rival owns when BONDMAGEDDON hits. With THE LEAK it unlocks BONDMAGEDDON ($16 + 4 Intel, once per turn): four missiles at one rival’s holdings.'},
{id:'hedge',image:'./static/hedge fund.png',name:['THE HEDGE FUND'],icon:'🕶️',type:'BANK',income:2,cost:6,x:1260,y:300,rot:-2,sub:'somebody’s shorting',sp:'+$3 whenever ANY player is raided — even you. +$2 on THE BIG SHORT SCREENING.'},
{id:'rba',image:'./static/rba.png',name:['RESERVE BANK','OF AUSTRALIA'],icon:'🏛️',type:'REGULATOR',shape:'logo',band:'#4a5a66',income:2,cost:10,x:960,y:145,rot:1,sub:'sets the price of money',sp:'−1 Cortisol at the start of each of your turns. The RBA CASH-RATE DECISION never charges you. Hostile takeovers stay at list price forever.'},
{id:'asic',image:'./static/asic.png',name:['ASIC'],icon:'⚖️',type:'REGULATOR',shape:'logo',band:'#1f3a5f',income:1,cost:5,x:1160,y:95,rot:-1,sub:'the corporate cop',sp:'Unlocks AUDIT ($4): any rival +1 Cortisol, once per turn. Also unlocks REFER ($4, your action, once per turn): +1 scrutiny on a rival’s open ASIC market-manipulation file (monetary-policy books). A ruling still waits for their turn start.'},
{id:'accc',image:'./static/accc.png',name:['ACCC'],icon:'🧐',type:'REGULATOR',shape:'logo',band:'#233a8f',income:1,cost:5,x:1360,y:155,rot:1,sub:'reviews every merger',sp:'When a rival hostile-takes one of YOUR nodes, they pay you an extra $2 (ACCC review fee, if they can afford it). Unlocks REFER ($4, your action, once per turn): +1 scrutiny on a rival’s open ACCC file (any book but monetary policy). A ruling still waits for their turn start.'},
{id:'gov',image:'./static/coat of arms.png',name:['AUSTRALIAN GOVERNMENT','COAT OF ARMS'],icon:'🦘',type:'REGULATOR',shape:'logo',band:'#1b3a2a',income:2,cost:8,x:1540,y:100,rot:-1,sub:'documents, logos & ribbons',sp:'Unlocks BUDGET NIGHT ($3): every rival pays you $1 and you gain +1 Intel.'},
/* — charts pinned across the collage, not stacked in one corner — */
{id:'us',image:'./static/us treasury yield.png',name:['US BOND','YIELDS'],type:'CHART',shape:'chart',spark:'up',income:0,cost:2,x:1980,y:95,rot:1,sub:'the safe haven',sp:'+$1 while you own the 10-YEAR MASTER CHART; +$1 on BONDMAGEDDON; +$2 on TRUMP TWEETS TARIFFS.'},
{id:'japan',image:'./static/debt japan.png',name:['JAPAN BOND','YIELDS'],type:'CHART',shape:'chart',spark:'up',income:0,cost:2,x:2260,y:455,rot:-1,sub:'largest foreign holder, allegedly',sp:'+$1 while you own the MASTER CHART; +$3 on BONDMAGEDDON (curve control fails).'},
{id:'uk',image:'./static/uk bond yield.png',name:['UK BOND','YIELDS'],type:'CHART',shape:'chart',spark:'up',income:0,cost:2,x:980,y:1165,rot:1,sub:'gilts gone wild',sp:'+$1 while you own the MASTER CHART; +$1 on BONDMAGEDDON.'},
{id:'aus',image:'./static/aus bond yield.png',name:['AUSTRALIAN','BOND YIELDS'],type:'CHART',shape:'chart',spark:'up',income:0,cost:2,x:1325,y:85,rot:1,sub:'home soil',sp:'+$1 while you own the MASTER CHART; +$1 on BONDMAGEDDON.'},
{id:'tenyear',image:'./static/government bond comparison.png',name:['10-YEAR GOVT','BOND YIELDS'],type:'CHART',shape:'chart',spark:'up',income:1,cost:4,x:1285,y:205,rot:1,sub:'the master chart — now in the middle of everything',sp:'THE MASTER CHART: +$3 income for every other CHART node you own. +$2 on BONDMAGEDDON or BIG BESSENT SPEAKS.'},
{id:'infl',image:'./static/inflation data.png',name:['INFLATION','COMPENSATION'],type:'CHART',shape:'chart',spark:'up',income:1,cost:3,x:1085,y:675,rot:-1,sub:'the hidden tax',sp:'Your salary is $4, not $3 — indexed to CPI.'},
{id:'cash',image:'./static/cash rate graph.png',name:['CASH-RATE','CHART'],type:'CHART',shape:'chart',spark:'step',income:1,cost:3,x:880,y:210,rot:1,sub:'the RBA headline',sp:'+$2 whenever the RBA CASH-RATE DECISION is drawn (you set it).'},
{id:'stock',image:'./static/stock market graph.png',name:['STOCK-MARKET','CHARTS'],type:'CHART',shape:'chart',spark:'vola',income:1,cost:3,x:1365,y:365,rot:1,sub:'green days, red days',sp:'+$1 while you own THE TERMINAL or FOX BUSINESS (fast data).'},
/* — the commodities — */
{id:'oil',image:'./static/wti crude.png',name:['CRUDE OIL PIT','WTI · USD/BBL'],icon:'🛢️',type:'COMMODITY',income:8,cost:12,x:1500,y:470,rot:-2,sub:'the ticker that never sleeps',sp:'Pays $8 a turn. $6 windfall whenever OIL SPIKES is drawn. +$3 when TRUMP TWEETS TARIFFS picks the OIL chain.'},
{id:'oilgraph',image:'./static/oil price increase.png',name:['OIL PRICE','INCREASE'],type:'COMMODITY',shape:'chart',spark:'up',income:1,cost:3,x:1680,y:540,rot:2,sub:'the graph that called it',sp:'+$2 whenever OIL SPIKES (you drew the graph). +$3 when TARIFFS picks the OIL chain.'},
{id:'barrels',image:'./static/blue oil barrels.png',name:['BLUE OIL','BARRELS'],icon:'🛢️',type:'COMMODITY',income:2,cost:4,x:1320,y:480,rot:1,sub:'stacked and photographed',sp:'+$1 income while you own THE FORKLIFT. +$2 on OIL SPIKES; +$3 when TARIFFS picks the OIL chain.'},
{id:'tanker',image:'./static/tanker fleet.png',name:['THE TANKER FLEET'],icon:'🚢',type:'COMMODITY',income:2,cost:5,x:1850,y:430,rot:2,sub:'coal & crude by sea',sp:'+$3 on OIL SPIKES or COAL RUSH, and +$3 when TARIFFS picks the OIL chain.'},
{id:'petronas',image:'./static/petronas.png',name:['PETRONAS'],icon:'🛢️',type:'COMMODITY',shape:'logo',band:'#00a19b',income:3,cost:7,x:2000,y:530,rot:-1,sub:'the national oil company',sp:'+$3 on OIL SPIKES; +$3 when TARIFFS picks the OIL chain.'},
{id:'gold',image:'./static/gold coloured coin.jpg',name:['GOLD-COLOURED','COINS'],icon:'🪙',type:'COMMODITY',income:2,cost:5,x:1330,y:620,rot:-2,sub:'shiny. suspiciously shiny.',sp:'−2 Cortisol at the start of each of your turns; +$5 whenever GOLD RUSH is drawn.'},
{id:'train',image:'./static/coal train.png',name:['THE COAL TRAIN'],icon:'🚃',type:'COMMODITY',income:2,cost:5,x:770,y:700,rot:-2,sub:'tonnage by rail',sp:'+1 movement step each turn while owned (the express). Does not stack with THE BULLET TRAIN. +$2 on COAL RUSH; +$3 when TARIFFS picks the COAL chain.'},
{id:'port',image:'./static/coal terminal.png',name:['COAL TERMINAL','THE DOCKS'],icon:'⚓',type:'COMMODITY',income:3,cost:7,x:950,y:800,rot:2,sub:'ships in the night',sp:'+$4 on COAL RUSH; +$3 when TARIFFS picks the COAL chain. +$5 on CEO PHOTO LEAKS if you also own COAL CORP HQ (shipped before the news).'},
{id:'bhp',image:'./static/bhp.png',name:['BHP','THE BIG AUSTRALIAN'],icon:'⛏️',type:'COMMODITY',shape:'logo',band:'#ee3a23',income:3,cost:7,x:560,y:820,rot:-2,sub:'pit to port · ore and more',sp:'+$3 on COAL RUSH or GOLD RUSH. +$1 income while you own THE COAL TRAIN. +$3 when TARIFFS picks the COAL chain.'},
{id:'forklift',image:'./static/forklift.png',name:['THE FORKLIFT'],icon:'🚜',type:'COMMODITY',income:1,cost:4,x:1520,y:650,rot:-1,sub:'it moves everything',sp:'+$1 income per COMMODITY node you own (itself included). +$1 on COAL RUSH; +$3 when TARIFFS picks the COAL chain.'},
/* — the corporates — */
{id:'coal',image:'./static/coal corp hq.png',name:['COAL CORP HQ','CEO COAL'],icon:'🚂',type:'CORPORATE',shape:'logo',band:'#3f3f3f',income:3,cost:7,x:150,y:480,rot:-2,sub:'Mark Watson, Chief Executive',sp:'+1 movement step per turn. With THE COAL TRAIN too: 5 steps — the private express. +$2 on COAL RUSH; +$3 when TARIFFS picks the COAL chain.'},
{id:'quik',image:'./static/quikstop.png',name:['QUIKSTOP'],icon:'⛽',type:'CORPORATE',shape:'logo',band:'#c05621',income:2,cost:5,x:350,y:430,rot:2,sub:'the storefront · fuel, snacks & shopping bags',sp:'Collects $1 from every rival on OIL SPIKES; +$4 on PROFIT WARNING.'},
{id:'market',image:'./static/marketplace.webp',name:['MARKETPLACE','LEICHARDT'],icon:'🛍️',type:'CORPORATE',shape:'logo',band:'#b0342e',income:2,cost:5,x:170,y:660,rot:1,sub:'shopping centre · interior & exterior',sp:'+$2 income while you also own QUIKSTOP (the anchor tenant).'},
{id:'f1',image:'./static/f1.png',name:['FORMULA 1','RACING CAR'],icon:'🏎️',type:'CORPORATE',shape:'photo',income:2,cost:6,x:380,y:760,rot:-3,sub:'sponsorship pays',sp:'Unlocks THE SLIPSTREAM ($2, during movement, once per turn): +2 steps and your next seizure this turn costs $2 less.'},
{id:'qantas',image:'./static/qantas.png',name:['QANTAS','THE FLYING KANGAROO'],icon:'✈️',type:'CORPORATE',shape:'logo',band:'#e0001b',income:2,cost:20,x:575,y:975,rot:2,sub:'the spirit of australia',sp:'Unlocks FLY THE JET ($3, during movement): teleport to any node and end your movement. Hostile takeovers stay at list price forever.'},
{id:'bullet',image:'./static/bullet train.png',name:['THE BULLET TRAIN'],icon:'🚄',type:'CORPORATE',income:2,cost:6,x:95,y:1240,rot:-1,sub:'fast enough to outrun a hearing',sp:'+1 movement step each turn. Does not stack with THE COAL TRAIN — pick the faster service.'},
/* — the media — */
{id:'press',image:'./static/jtportal quite frankly.png',name:['“QUITE FRANKLY,','JTPORTAL…” PRESS ROOM'],icon:'🗣️',type:'MEDIA',shape:'bubble',income:2,cost:6,x:760,y:900,rot:-1,sub:'narrative for sale',sp:'Unlocks SPIN ($3): −2 own Cortisol or +1 rival Cortisol. If you also own COAL CORP HQ, the CEO photo leak pays you $3 instead of costing Cortisol. You also pick the victim on MEDIA FRENZY.'},
{id:'fox',image:'./static/fox business.png',name:['FOX BUSINESS'],icon:'🦊',type:'MEDIA',shape:'logo',band:'#1a2f6b',income:2,cost:10,x:980,y:1000,rot:2,sub:'fair & furious',sp:'Unlocks FOX SPIN ($2): −3 own Cortisol or +1 rival’s. If you also own COAL CORP HQ, the CEO photo leak pays you $3 instead of costing Cortisol.'},
{id:'leak',image:'./static/bondmageddon 2.png',name:['“BOND MARKETS','REVOLT” — THE LEAK'],icon:'📰',type:'MEDIA',shape:'bubble',income:2,cost:6,x:1200,y:930,rot:2,sub:'someone talked',sp:'+1 Intel when you seize it; +$2 whenever BONDMAGEDDON runs. With THE BOND DESK it unlocks BONDMAGEDDON.'},
{id:'jim',image:'./static/jim chalmers breaking news.jpg',name:['“THE JIM…”','TREASURY EXCLUSIVE'],icon:'🗞️',type:'MEDIA',shape:'news',income:1,cost:4,x:1420,y:880,rot:-2,sub:'bond-market news graphic',sp:'+$2 whenever a GOVERNMENT event runs (budgets & rate decisions). Event Cortisol on you is reduced by 1.'},
{id:'herald',image:'./static/the jim reaper.png',name:['HERALD SUN','THE JIM REAPER'],icon:'📰',type:'MEDIA',shape:'news',income:1,cost:4,x:1725,y:265,rot:2,sub:'front page, every page',sp:'+$2 whenever a GOVERNMENT event runs. +1 Intel whenever any rival gains Cortisol from an event.'},
{id:'bess',image:'./static/big bessent breaking news.jpg',name:['“BIG BESSENT”','BREAKING'],icon:'📣',type:'MEDIA',shape:'bubble',income:1,cost:4,x:1630,y:930,rot:-1,sub:'the big man speaks',sp:'+$2 on BONDMAGEDDON or the RBA CASH-RATE DECISION — he moves markets by talking. Event Cortisol on you is reduced by 1.'},
{id:'insider',image:'./static/insider trading graphic.png',name:['“INSIDER TRADING”','THE GRAPHIC'],icon:'⚠️',type:'MEDIA',shape:'news',income:1,cost:4,x:1830,y:860,rot:2,sub:'circled in red marker',sp:'Your BUG actions cost 0 Intel (it’s only insider trading if you’re on the outside).'},
{id:'photo',image:'./static/the big con.png',name:['THE BIG CON'],icon:'📷',type:'MEDIA',income:1,cost:5,x:1220,y:1210,rot:-2,sub:'faces pinned to cork',sp:'+1 Intel whenever any rival seizes a node — the wall sees everything.'},
{id:'bigshort',image:'./static/the big short.png',name:['THE BIG SHORT','THE CINEMA'],icon:'🎬',type:'MEDIA',shape:'logo',band:'#8a1f11',income:1,cost:4,x:1420,y:1080,rot:1,sub:'they explained it with a Jenga tower',sp:'+$3 on BONDMAGEDDON, MONOPOLY ALERT or THE BIG SHORT SCREENING.'},
{id:'news',image:'./static/all the newspapers.jpg',name:['THE NEWSPAPERS','ALL OF THEM'],icon:'🗞️',type:'MEDIA',shape:'news',income:1,cost:3,x:860,y:1250,rot:-1,sub:'interest-rate clippings & small headlines',sp:'+1 Intel at the start of your turn while you own 2+ MEDIA nodes.'},
{id:'wef',image:'./static/world economic forum.webp',name:['WORLD ECONOMIC','FORUM'],icon:'🏔️',type:'MEDIA',shape:'logo',band:'#0b3d91',income:2,cost:6,x:1750,y:1300,rot:-2,sub:'the conference stage',sp:'Your bugs skim $2 instead of $1 (global networks, ski trips). +$3 on DAVOS.'},
/* — the backrooms — */
{id:'back',image:'./static/backroom deals.png',name:['BACKROOM DEALS'],icon:'🤝',type:'WILD',income:1,cost:4,x:960,y:430,rot:-3,sub:'cash · intel · favors',sp:'Pay up to $3 of any seizure shortfall with Intel (1 🛈 = $1). Unlocks LEAN ON THE TABLE: every other player gains +1 Cortisol. Using a Backroom Deals ability during movement costs 2 movement steps.'},
{id:'term',image:'./static/bloomberg terminal.png',name:['THE TERMINAL'],icon:'📈',type:'WILD',income:1,cost:4,x:1440,y:255,rot:1,sub:'the screens never sleep',sp:'End movement here to PEEK at the top Event card — keep it or bury it.'},
{id:'golf',image:'./static/golf club.jpg',name:['THE GOLF CLUB'],icon:'⛳',type:'WILD',income:2,cost:6,x:170,y:960,rot:3,sub:'deals on the back nine',sp:'All your seizure costs are $1 cheaper.'},
{id:'whistle',image:'./static/whistleblower.png',name:['THE WHISTLEBLOWER','KNOWS TOO MUCH'],icon:'🕵️',type:'WILD',shape:'photo',income:0,cost:6,x:1980,y:640,rot:-2,sub:'half a confession ready',sp:'+1 Intel at the start of each of your turns; +2 Intel on THE TAPES GO MISSING.'},
{id:'iface',image:'./static/bloomberg terminal.png',name:['THE MARKET','INTERFACE'],icon:'🖥️',type:'WILD',income:1,cost:4,x:2060,y:1100,rot:2,sub:'computer & website screenshots',sp:'Your TERMINAL peek works wherever you end movement — everything is online.'},
/* — school & fate — */
{id:'school',image:'./static/st andrews cathedral school.png',name:['ST ANDREW’S','CATHEDRAL SCHOOL'],icon:'🏫',type:'WILD',shape:'logo',band:'#1b2a5e',income:1,cost:5,x:170,y:1080,rot:-1,sub:'the crest & the tower',sp:'+1 Intel at the start of your turn if you own 3+ CHART nodes (the research department).'},
{id:'ib',image:'./static/ibdp.png',name:['THE IB DIPLOMA','PROGRAMME'],icon:'📚',type:'WILD',income:1,cost:5,x:380,y:1050,rot:2,sub:'HL Economics, allegedly',sp:'Your CHART nodes pay DOUBLE income (Higher Level Economics).'},
{id:'mpc',image:'./static/monetary policy competition.png',name:['THE AUSTRALIAN','MONETARY POLICY','COMPETITION'],icon:'🏆',type:'WILD',shape:'mpc',income:1,cost:6,x:390,y:1200,rot:-2,sub:'the trophy of trophies',sp:'+$1 income per CHART node; +1 Intel each turn. +$2 more each turn while you also hold the SCHOOL and the IB DIPLOMA.'},
{id:'sisy',image:'./static/sisyphus.webp',name:['THE SISYPHUS','BOULDER'],icon:'🪨',type:'WILD',income:0,cost:4,x:600,y:1150,rot:2,sub:'it always rolls back down',sp:'Stand here (once owned) to PUSH: earn $10 the first time, then double the payout every push ($10, $20, $40, $80…). No Cortisol cost. Walking away or losing the node resets it to $10 (BACKROOM DEALS keeps the streak when you walk off).'},
{id:'group',image:'./static/the outdoors.png',name:['THE OUTDOOR','GROUP PHOTOGRAPH'],icon:'👥',type:'WILD',shape:'wide',income:1,cost:4,x:820,y:1120,rot:-1,sub:'everyone smiled',sp:'Whenever ANY player is raided, gain +1 Intel (you have photos of everyone).'},
{id:'sat',image:'./static/the outback.jpg',name:['SATELLITE IMAGE','THE OUTBACK'],icon:'🛰️',type:'WILD',shape:'sat',income:1,cost:4,x:610,y:1300,rot:1,sub:'landscape · the dry country',sp:'−1 Cortisol at the start of each of your turns (hiding out bush).'},
/* — the people (polaroids) — */
{id:'watson',image:'./static/ceo of coal.png',name:['MARK WATSON','CEO OF COAL'],icon:'🕴️',type:'WILD',shape:'photo',income:0,cost:6,x:330,y:590,rot:3,sub:'the face of the company',sp:'+$2/turn while you also own COAL CORP HQ. Exempts your COAL industry holdings from ACCC monopoly investigations. Personally deflects the CEO PHOTO LEAK.'},
{id:'bessent',image:'./static/scott bessent.png',name:['SCOTT BESSENT','“BIG BESSENT”'],icon:'👔',type:'WILD',shape:'photo',income:1,cost:7,x:1600,y:310,rot:-2,sub:'US Treasury · moves markets',sp:'+$1 income per BANK node you own.'},
{id:'chalmers',image:'./static/jim chalmers.png',name:['JIM CHALMERS','“THE JIM”'],icon:'👨‍💼',type:'WILD',shape:'photo',income:1,cost:8,x:1720,y:180,rot:2,sub:'the Treasurer',sp:'+$1 income per REGULATOR node you own (the Treasurer’s friends).'},
{id:'albo',image:'./static/albo.png',name:['ANTHONY ALBANESE','THE PM'],icon:'🫡',type:'WILD',shape:'photo',income:1,cost:8,x:1875,y:105,rot:-2,sub:'the motorcade',sp:'Tolls rivals pay to enter YOUR nodes are $2 (the PM closes the road). Unlocks BLOCKADE (free, once per turn): wall off literally any node until the end of next round — nobody walks or flies in, not even you.'},
{id:'trump',image:'./static/trump.png',name:['DONALD TRUMP','TARIFF MAN'],icon:'🦅',type:'WILD',shape:'photo',income:1,cost:7,x:2020,y:185,rot:2,sub:'the tweets move markets',sp:'Unlocks THE TWEET ($2): choose a rival to lose the greater of 3 Intel or 50% of their Intel. You choose which chain (OIL or COAL) TRUMP TWEETS TARIFFS pays.'},
{id:'bullock',image:'./static/michelle bullock.png',name:['MICHELE BULLOCK','RBA GOVERNOR'],icon:'👩‍💼',type:'WILD',shape:'photo',income:1,cost:7,x:880,y:265,rot:-3,sub:'she decides the cash rate',sp:'Rate events never charge you; +1 Intel each turn (the Governor briefs you).'},
{id:'bond007',image:'./static/james bond.png',name:['JAMES BOND','CITIBANK · 007'],icon:'🤵',type:'WILD',shape:'photo',income:1,cost:6,x:300,y:330,rot:-2,sub:'banker. sort of.',sp:'You pay NO tolls (he has… credentials).'},
{id:'rock',image:'./static/the rock.gif',name:['THE ROCK','CAN SMELL IT'],icon:'💪',type:'WILD',shape:'photo',income:1,cost:7,x:660,y:450,rot:2,sub:'final boss energy',sp:'Unlocks COOK THE BOOKS ($3): −3 Cortisol. +$1 income per DIFFERENT node type you own.'},
{id:'brad',image:'./static/brad pitt.png',name:['BRAD PITT','“THE BIG SHORT”'],icon:'😎',type:'WILD',shape:'photo',income:1,cost:5,x:1630,y:1120,rot:-2,sub:'explained it in the movie',sp:'+$2 on BONDMAGEDDON, BIG BESSENT SPEAKS or THE BIG SHORT SCREENING (he had it explained to him).'},
{id:'jt',image:'./static/jt portal.png',name:['JTPORTAL','QUITE FRANKLY'],icon:'🌐',type:'WILD',shape:'photo',income:1,cost:9,x:1150,y:540,rot:-1,sub:'the legend of the board',sp:'+1 Intel each turn AND you are shown the next Market Event at the start of your turn. ONCE PER GAME: cancel a Market Event as it is revealed — “quite frankly, it never happened.”'},
{id:'made',image:'./static/made logo.png',name:['MADE','(???)'],type:'WILD',shape:'made',income:2,cost:7,x:1000,y:1380,rot:-2,sub:'the purple graphic',sp:'Start of every turn: a chance MADE pays out (33% at 2 seats, falling to 8% at 8) — +$10 and +1 Intel to its owner. Every other player with more than two nodes and at least $50 pays 15% of their cash. No Cortisol is added. Hostile takeovers of MADE stay at list price forever, and anyone can force it to divest for 5 Intel + $7. Nobody knows why. NOBODY.'},
{id:'asics',image:'./static/running shoe.jpg',name:['THE RUNNING SHOE','ASICS'],icon:'👟',type:'WILD',shape:'photo',income:1,cost:3,x:430,y:1360,rot:3,sub:'circled in red · why is this here',sp:'+1 movement step (you are always jogging). Stand here (once owned) to JOG: free −1 Cortisol.'},
{id:'toktimer',image:'./static/toktimer.png',name:['TOKTIMER'],icon:'⏱️',type:'WILD',shape:'photo',income:1,cost:5,x:1920,y:1020,rot:-2,sub:'the clock is running',sp:'+1 Intel whenever a Market Event is revealed. Time is information.'}
];
/* ─────────── 🌍 GEOGRAPHY DLC — twelve more pins, host-toggled in the lobby ───────────
   The whole GEOGRAPHY set is appended to BASE_NODES only when the lobby flag is on
   (rebuildWorld). Abilities are id-hooked exactly like the base game: startTurn
   passives, income() synergies, and applyIntent actions keyed on the node id. */
export let NODES=[];
export const GEO_NODE_IDS=['geo_missile','geo_shahed','geo_wonsan','geo_pyoncity','geo_pyothotel','geo_boeing','geo_scs','geo_stage5','geo_pillars','geo_venice','geo_tuvalu','geo_kim'];
export const OIL_IDS=['oil','oilgraph','barrels','tanker','petronas'];
export const GEO_HIGH_VALUE_IDS=['geo_missile','geo_shahed','geo_scs','geo_pyothotel','geo_boeing','geo_pillars','geo_kim','geo_wonsan','geo_venice','geo_pyoncity','geo_stage5'];
/* Related North Korea DLC pins; their physical positions are deliberately not clustered. */
export const GEO_NK_IDS=['geo_missile','geo_wonsan','geo_pyoncity','geo_pyothotel','geo_kim'];
export const GEO_NODES=[
{id:'geo_missile',image:'./static/GeographyDLC/nk_missile.jpg',name:['MISSILE COMMAND'],icon:'🚀',type:'REGULATOR',shape:'photo',income:0,cost:8,x:2140,y:1180,rot:2,sub:'strategic assets · keys under the desk',sp:'Unlocks LAUNCH A MISSILE ($4 + 1 Intel, once per turn): strike any rival or unowned node (never your own) — but you must BE HERE to fire, during your move (the launch ends the move; your action still follows) or as your action (owning KIM JONG UN also arms the silo from anywhere). An owned node is expropriated with NO payout; either way it becomes rubble — no income, no seizing. Stand on rubble in your action phase and pay the list price to rebuild it; it returns unowned, buyable from next turn. Holdings of a PILLARS owner are shielded (hit the Pillars first), TUVALU reflects the warhead back at you, and striking a REGULATOR draws an ASIC/ACCC probe next turn (+1 Cortisol, 50% raid).'},
{id:'geo_shahed',image:'./static/GeographyDLC/shahed drone.webp',name:['IRANIAN','SHAHED DRONE'],icon:'🛩️',type:'REGULATOR',shape:'photo',income:0,cost:8,x:420,y:1120,rot:-2,sub:'one-way delivery · disposable diplomacy',sp:'Functions like MISSILE COMMAND: launch a missile for $4 + 1 Intel, once per turn. Fire while standing on the drone you own, or from anywhere if you own KIM JONG UN. You cannot own this and MISSILE COMMAND at the same time.'},
{id:'geo_wonsan',image:'./static/GeographyDLC/nk_wonsanresort.jpg',name:['WONSAN','RESORT'],icon:'🏖️',type:'WILD',shape:'photo',income:2,cost:5,x:2080,y:700,rot:-2,sub:'the beach town · sanctioned paradise',sp:'Stand here (once owned) for BEACH DAY: free, once per turn, −2 Cortisol. The sand is quiet. The waves are loud. Nobody is watching.'},
{id:'geo_pyoncity',image:'./static/GeographyDLC/nk_pyongyangcity.webp',name:['PYONGYANG','CITY'],icon:'🌆',type:'BANK',shape:'photo',income:2,cost:6,x:2240,y:1000,rot:1,sub:'the capital · show windows, all lit',sp:'+$1 income per GEOGRAPHY DLC node you own, itself included (the capital collects tribute).'},
{id:'geo_pyothotel',image:'./static/GeographyDLC/nk_pyongyanghotel.jpg',name:['PYONGYANG','HOTEL'],icon:'🏨',type:'CORPORATE',shape:'photo',income:2,cost:8,x:2200,y:830,rot:-1,sub:'106 floors · 47 in use',sp:'Gain $2 whenever ANY rubble node is REBUILT (construction kickbacks, allegedly).'},
{id:'geo_boeing',image:'./static/GeographyDLC/geo_boeing.jpg',name:['THE CORPORATE','BOEING'],icon:'🛩️',type:'CORPORATE',shape:'photo',income:2,cost:7,x:1920,y:590,rot:2,sub:'white tail · no livery · no paperwork',sp:'Unlocks SHUT DOWN QANTAS ($4, once per turn; not if you own QANTAS): the kangaroo is grounded until the end of next round — nobody flies the jet or lands there, and its owner collects nothing from it.'},
{id:'geo_scs',image:'./static/GeographyDLC/geo_southchinasea.jpg',name:['THE SOUTH','CHINA SEA'],icon:'🌊',type:'COMMODITY',shape:'photo',income:4,cost:9,x:1880,y:1300,rot:-2,sub:'disputed waters · freedom of navigation',sp:'Unlocks TRIGGER AN OIL CRASH ($3, once per turn): the mood turns PANIC and every player pays $2 per oil node they own. Pillars-protected players are exempt.'},
{id:'geo_stage5',image:'./static/GeographyDLC/geo_stage5decline.png',name:['STAGE 5','DECLINE'],type:'CHART',shape:'chart',spark:'down',income:1,cost:4,x:2040,y:470,rot:1,sub:'imported uranium · charcoal · decay',sp:'Unlocks CALL STAGE 5 (2 Intel, once per turn): the current richest player (not you) makes NO income on their next turn.'},
{id:'geo_pillars',image:'./static/GeographyDLC/geo_pillars.jpg',name:['PILLARS OF','SUSTAINABILITY'],icon:'🧱',type:'REGULATOR',shape:'photo',income:1,cost:6,x:1760,y:250,rot:-1,sub:'ESG-laminated · one pillar is cardboard',sp:'ESG SHIELD: −1 Cortisol at the start of each of your turns. While you own it your OTHER nodes cannot be missile-struck, you pay nothing on an OIL CRASH, and Stage 5 Decline cannot call you. The Pillars themselves can be struck (BONDMAGEDDON aims three missiles at them first), and Overtourism still works on you. Hostile takeovers stay at list price forever.'},
{id:'geo_venice',image:'./static/GeographyDLC/geo_venice.jpg',name:['VENICE','DI CCTV'],type:'MEDIA',shape:'photo',income:3,cost:8,x:150,y:950,rot:2,sub:'la serenissima · sella aperta',sp:'Stand here (once owned) for GONDOLA THERAPY: free, once per turn, −1 Cortisol. Or in your action phase send OVERTOURISM ($2, once per turn, either/or): pick a rival node — its owner takes +1 Cortisol at the start of their next turn, if they still own it and you still own Venice.'},
{id:'geo_tuvalu',image:'./static/GeographyDLC/geo_tuvalu.png',name:['TUVALU','.TV'],icon:'🏝️',type:'WILD',shape:'photo',income:2,cost:5,x:1900,y:1420,rot:-2,sub:'the first country you get free',sp:'THE JOIN IS FREE: the first player to arrive simply owns it. No action, no cost, no Cortisol. After that, normal rules apply. A missile fired at Tuvalu backfires on the launcher.'},
{id:'geo_kim',image:'./static/GeographyDLC/nk_kimjongun.png',name:['KIM JONG','UN'],icon:'🧨',type:'WILD',shape:'photo',income:0,cost:6,x:2320,y:1210,rot:-2,sub:'the man himself · nothing is happening',sp:'+1 Intel at the start of each of your turns. Owning him exempts you from either launcher’s on-site rule — both the silo and the Shahed can fire from anywhere.'},
];
export const GEO_EDGES=[
 ['geo_missile','geo_pyoncity'],['geo_pyoncity','geo_pyothotel'],['geo_pyothotel','geo_wonsan'],['geo_wonsan','geo_missile'],
 ['geo_boeing','geo_pyothotel'],['geo_missile','geo_stage5'],['geo_stage5','geo_pillars'],
 ['geo_scs','geo_tuvalu'],['geo_venice','geo_scs'],
 ['geo_kim','geo_missile'],['geo_kim','geo_pyoncity'],['geo_shahed','geo_venice']
];
export const NMAP={};
/* The Geography DLC rebuilds these every time the lobby flag flips. */
export let ORIGINAL_NODE_LAYOUT=[];
export let ORIGINAL_LAYOUT_BY_ID={};

export const COUNTRY=['us','japan','uk','aus'];
export const BASE_EDGES=[
 /* banks & the missing fourth */
 ['citi','commbank'],['commbank','nab'],['nab','anz'],['nab','westpac'],['westpac','commbank'],['westpac','citi'],['anz','rba'],['citi','bond007'],['citi','coal'],
 /* regulators row */
 ['rba','bullock'],['rba','asic'],['asic','accc'],['accc','gov'],['gov','chalmers'],['chalmers','albo'],['albo','trump'],['rba','bond'],['gov','herald'],
 /* desks & screens */
 ['bond','hedge'],['bond','bessent'],['bond','back'],['hedge','term'],['hedge','stock'],['term','bessent'],['term','stock'],
 /* charts — each lives in a different neighbourhood, linked to neighbours AND the master */
 ['rba','cash'],['cash','bullock'],['cash','tenyear'],['aus','gov'],['aus','accc'],['aus','tenyear'],['gov','chalmers'],['chalmers','tenyear'],
 ['us','trump'],['us','albo'],['us','tenyear'],['japan','petronas'],['japan','tanker'],['japan','tenyear'],
 ['uk','press'],['uk','news'],['uk','tenyear'],['tenyear','bessent'],['tenyear','bond'],
 ['infl','jt'],['infl','back'],
 ['stock','oilgraph'],
 
 /* commodities */
 ['oil','oilgraph'],['oil','tanker'],['oil','petronas'],['oil','barrels'],['oil','jt'],['barrels','forklift'],['forklift','port'],['forklift','gold'],
 ['tanker','port'],['tanker','petronas'],['petronas','trump'],
 ['train','coal'],['train','watson'],['train','port'],['train','rock'],['train','bhp'],['bhp','coal'],['bhp','watson'],['bhp','market'],
 /* corporates & the wandering servo */
 ['coal','watson'],['coal','quik'],['quik','market'],['quik','bond007'],['quik','watson'],['market','f1'],
 ['f1','qantas'],['qantas','press'],['qantas','golf'],['bullet','school'],['bullet','albo'],['bullet','golf'],['bullet','asics'],
 /* media ring */
 ['back','press'],['back','leak'],['back','jt'],['iface','toktimer'],
 ['press','leak'],['press','fox'],['press','golf'],['press','news'],['leak','photo'],['photo','news'],['photo','bigshort'],['photo','made'],
 ['news','fox'],['news','made'],['fox','jim'],['jim','bess'],['jim','herald'],['bess','insider'],['bess','wef'],['bess','herald'],
 ['insider','whistle'],['wef','brad'],['wef','iface'],['bigshort','brad'],['hedge','bigshort'],
 /* school, fate, shoes, the clock */
 ['school','ib'],['school','mpc'],['school','golf'],['ib','mpc'],['mpc','sisy'],['sisy','group'],['sisy','sat'],
 ['group','sat'],['group','press'],['group','news'],['sat','made'],['sat','asics'],['asics','mpc'],['asics','sisy'],
 ['toktimer','whistle'],['toktimer','brad'],
 /* people bridges */
 ['bullock','rock'],['rock','jt'],['jt','press'],['watson','golf'],['chalmers','herald']
];
export const REMOVED_NODE_IDS=new Set(['notes','vault','unid1','unid2','real','spend','can','tv','ger','timeline','econ','debt']);
export let CLEAN_EDGES=[],WORLD_EDGES=[],EDGES=[],HIGH_VALUE_NODE_IDS=new Set();
export function setEdges(v){EDGES=v}
export function setNodes(v){NODES=v}
export const ADJ={};
export function rebuildAdj(){
 Object.keys(ADJ).forEach(k=>delete ADJ[k]);
 EDGES.forEach(e=>{
  if(!NMAP[e[0]]||!NMAP[e[1]])return;
  (ADJ[e[0]]=ADJ[e[0]]||[]).push(e[1]);
  (ADJ[e[1]]=ADJ[e[1]]||[]).push(e[0]);
 });
}
rebuildAdj();
/* ================= 🌍 WORLD REBUILD — the DLC toggle rewires everything =================
   The lobby's Geography flag changes the node set, so every derived mapping is
   recomputed from scratch: NMAP, the canonical layout deck, the edge graph and
   the high-value seeding set. With the flag off this produces a world that is
   byte-for-byte the game as it has always been. */
export const HIGH_VALUE_BASE_IDS=[
 'qantas','rba','oil','gold','sat','asics','rock','press','fox','sisy',
 'made','bullock','jt','mpc','whistle','term','bond','hedge','petronas'
];
export let WORLD_GEO=false;
export function rebuildWorld(geo){
 WORLD_GEO=!!geo;
 NODES=geo?BASE_NODES.concat(GEO_NODES):BASE_NODES.slice();
 Object.keys(NMAP).forEach(k=>delete NMAP[k]);
 NODES.forEach(n=>NMAP[n.id]=n);
 ORIGINAL_NODE_LAYOUT=NODES.map(n=>({id:n.id,x:n.x,y:n.y,rot:n.rot}));
 ORIGINAL_LAYOUT_BY_ID=Object.fromEntries(ORIGINAL_NODE_LAYOUT.map(p=>[p.id,p]));
 CLEAN_EDGES=BASE_EDGES.filter(e=>!REMOVED_NODE_IDS.has(e[0])&&!REMOVED_NODE_IDS.has(e[1]));
 WORLD_EDGES=geo?CLEAN_EDGES.concat(GEO_EDGES):CLEAN_EDGES.slice();
 EDGES=WORLD_EDGES.map(e=>e.slice());
 HIGH_VALUE_NODE_IDS=new Set(HIGH_VALUE_BASE_IDS.concat(geo?GEO_HIGH_VALUE_IDS:[]));
 rebuildAdj();
}
rebuildWorld(false);
/* Quikstop is the only exhibit that physically moves each game — five neighbourhoods, same servo */
export const QUIK_HOME={x:350,y:430,rot:2};
export const QUIK_SLOTS=[
 {x:350,y:430,rot:2,links:['coal','watson','bond007','market','train'],label:'the original servo · inner west'},
 {x:1540,y:1210,rot:-2,links:['photo','bigshort','market','news'],label:'down by MarketPlace · the late shift'},
 {x:2060,y:680,rot:1,links:['forklift','petronas','whistle'],label:'the docks servo · petrol & crude'},
 {x:700,y:280,rot:-1,links:['rba','bullock','rock','westpac','cash'],label:'across from the Reserve Bank'},
 {x:1120,y:1410,rot:2,links:['made','sat','news','photo'],label:'the unexplained servo · next to MADE'}
];
export const TYPE_COLORS={BANK:'#a87511',COMMODITY:'#c05621',MEDIA:'#b5308c',CORPORATE:'#1f6f8b',REGULATOR:'#5c6b73',CHART:'#2e8b57',WILD:'#6b4fa0'};
export const PCOLORS=['#f5c542','#55c1ff','#e19bff','#7fe08d','#ff5e9c','#ffffff','#00e5c0','#ffa94d'];
export const MAXPLAYERS=8;
export const CHARURL='/characters/';
export const CHARS=[
 {id:'markwatson',name:'Mark Watson',file:'markwatson.png',color:'#f5c542'},
 {id:'tomkins',name:'Tomkins',file:'tomkins.png',color:'#55c1ff'},
 {id:'jimchalmers',name:'Jim Chalmers',file:'jimchalmers.png',color:'#e19bff'},
 {id:'bessock',name:'Bessock',file:'bessock.png',color:'#7fe08d'},
 {id:'calvinathanasius',name:'Calvin Athanasius',file:'calvinathanasius.png',color:'#ff5e9c'},
 {id:'denialswan',name:'Denial Swan',file:'denialswan.png',color:'#ffffff'},
 {id:'japsnchen',name:'Japsn Chen',file:'japsnchen.png',color:'#00e5c0'},
 {id:'thousandyardwax',name:'Thousand Yard Wax',file:'thousandyardwax.png',color:'#ffa94d'},
 {id:'Alexander_Lane',name:'The guy from Toktimer',file:'Alexander_Lane.png',color:'#ff6b5e'},
 {id:'DJT',name:'QUITE FRANKLY',file:'DJT.png',color:'#9b8cff'},
 {id:'thebigag',name:'The Big Ag',file:'thebigag.png',color:'#d6e85c'},
 {id:'thebigwegrzyn',name:'Seth Wegrzyn',file:'thebigwegrzyn.png',color:'#e8a07a'}
];
export function charMeta(id){return CHARS.find(c=>c.id===id)||null}
export function charSrc(id){const c=charMeta(id);return c?(c.url||CHARURL+c.file):''}
/* ================= THE MARKET MOOD — set by every event, felt by everyone ================= */
export const MOODS={
 CALM:{label:'MARKET: CALM',color:'#8fbf7f',tint:'rgba(70,130,70,0.045)',rate:2,desc:'no modifiers · 1 🛈 = $2'},
 BOOM:{label:'MARKET: BOOM',color:'#f5c542',tint:'rgba(200,160,40,0.075)',rate:2,desc:'COMMODITIES +$1/turn · 1 🛈 = $2'},
 PANIC:{label:'MARKET: PANIC',color:'#ff6b5e',tint:'rgba(170,30,20,0.10)',rate:4,desc:'BANKS −$1/turn · 1 🛈 = $4'},
 FRENZY:{label:'MEDIA FRENZY',color:'#e19bff',tint:'rgba(150,60,170,0.075)',rate:3,desc:'MEDIA +$1/turn · 1 🛈 = $3'}
};
/* sparklines drawn INSIDE the 130x64 chart card (card spans x -65..65, y -32..32;
   line band: x -50..50, y 0..14) */
export const SPK={
up:'-50,13 -34,11 -18,12 -2,7 14,9 30,3 42,5 50,1',
down:'-50,2 -34,4 -18,3 -2,8 14,7 30,11 42,10 50,13',
step:'-50,13 -30,13 -30,9 -8,9 -8,5 16,5 16,2 50,2',
spike:'-50,13.5 -34,13 -18,11.5 -2,12 14,7 30,3 42,0.5 50,0',
vola:'-50,7 -38,12 -26,3 -14,10 -2,5 10,12 22,2 34,9 46,1 50,5',
flat:'-50,9 -25,8.5 0,9 25,8.5 50,8'};

/* ================= ROOM CODES — jt portal buzzwords ================= */
/* Room codes are jt portal buzzwords — every one of these has its own line in
   the jt portal news ticker, so the code is always something you can say out loud. */
export const BUZZWORDS=['WORLD ECONOMIC FORUM','NESA','JAKE TOMKINS','ELIJAH SON','SETH WEGRZYN','AIDAN NEWLING','DANIEL SWAIN','TOKTIMER','RBA','BIG BESSENT','NEW LAKEMBA','JTPORTAL','MCMETRO','CEO OF COAL','INKDIN','HORMUZ','PYONGYANG UNIVERSITY','LOW CORTISOL'];
export function codeSlug(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'')}
export function codeLabel(slug){const hit=BUZZWORDS.find(b=>codeSlug(b)===slug);return hit||slug}
/* Typed codes are forgiving: case, spaces and punctuation are all ignored, and a
   unique prefix of a buzzword is enough. */
export function matchBuzzword(input){
 const s=codeSlug(input);
 if(!s)return '';
 if(BUZZWORDS.some(b=>codeSlug(b)===s))return s;
 const hits=BUZZWORDS.filter(b=>codeSlug(b).startsWith(s));
 return hits.length===1?codeSlug(hits[0]):s;
}
export function genCode(){return codeSlug(BUZZWORDS[Math.floor(Math.random()*BUZZWORDS.length)])}
