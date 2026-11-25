'use strict';
/* world: the WORLD EXPANSION — ~100 global exhibits pinned to real places — plus the geography the WORLD MAP layout needs.
   Pure data and pure helpers: no DOM, no state, no engine imports (data.js and boards.js import THIS).
   A node WITHOUT an `image` renders as a styled text card (name + icon on its type colour) in the SVG board and the 3D board;
   drop a file path into `image` later and the picture takes over. Nothing else needs to change.
   Abilities that fit the existing hooks are data-driven through `fx` (see worldSynergy / worldStartFx / worldEventPays below).
   Anything marked todo:true has its full intended `sp` text written but only income, cost and seizing are live (phase 2). */

/* fx schema (all dollar figures are for a $100 table; event cash scales with the host's target like every card):
   t:[[TYPE,$,other?]]  +$ per owned node of that type (other = not counting this node)
   r:[[TYPE,$]]         +$ per rival-owned node of that type
   w:[[id,$]]           +$ income while you also own id
   i:[[[ids],$]]        +$ per owned node from the list (never itself)
   n:[$,per]            +$ per `per` nodes owned (rounded down)
   c:±n                 Cortisol at the start of your turn (negative soothes, positive is a curse)
   s:n                  Intel at the start of your turn;  wi:[[id,n]]  +n Intel at the start of your turn while you also own id
   e:{cardId:$|[$,intel]} windfall when that market event is drawn;  x2:id doubles the cash if you also own id */
export const OIL_ALL=['oil','oilgraph','barrels','tanker','petronas','geo_scs','w_aramco','w_cushing','w_permian','w_tar','w_pemex','w_petrobras','w_pdvsa','w_dangote','w_gazprom'];
export const BATTERY=['w_lithium','w_cobalt','w_nickel','w_baotou'];
const mk=(id,name,icon,type,income,cost,lat,lon,sub,sp,fx,todo)=>{
 const n={id:'w_'+id,name:[].concat(name),icon,type,shape:'card',income,cost,geo:[lat,lon],x:0,y:0,rot:0,sub,sp};
 if(fx)n.fx=fx;if(todo)n.todo=true;return n;
};
export const WORLD_NODES=[
/* ── North America ── */
mk('bell','WALL STREET BELL','🔔','MEDIA',2,5,40.707,-74.011,'rung by whoever paid the most this year','+$2 on BONDMAGEDDON, A QUIET QUARTER or THE BIG SHORT SCREENING (the bell rings either way).',{e:{bondrevolt:2,quiet:2,bigscreen:2}}),
mk('fed','THE FEDERAL RESERVE','🏛️','REGULATOR',2,9,38.893,-77.045,'dual mandate · triple vibes','−1 Cortisol at the start of each of your turns. +$2 on the RBA CASH-RATE DECISION and BIG BESSENT SPEAKS (the world is listening).',{c:-1,e:{rates:2,besspeak:2}}),
mk('powell','JEROME POWELL','🎙️','WILD',1,7,38.886,-77.03,'“transitory” · still being said',
 'TRANSITORY: the first Cortisol you would take each round is cancelled outright. (He said it would pass. It passed.)',null,true),
mk('sec','THE SEC','📋','REGULATOR',1,6,38.896,-77.014,'the paperwork arrives eventually','+$3 on MONOPOLY ALERT. +1 Intel at the start of your turn while you also own THE WHISTLEBLOWER (they file everything).',{e:{crackdown:3},wi:[['whistle',1]]}),
mk('goldman','GOLDMAN SACHS','🐙','BANK',3,10,40.7145,-74.0147,'a great vampire squid · allegedly','+$2 income per BANK your rivals own (the squid has many arms).',{r:[['BANK',2]]}),
mk('jpm','JPMORGAN','🏦','BANK',3,8,40.7556,-73.9733,'too big to jail','Hostile takeovers of any node YOU own cost the buyer +$2 (the house always has a lawyer).',null),
mk('svb','SILICON VALLEY BANK','📉','BANK',2,5,37.3541,-121.9552,'the duration was a surprise to everyone',
 'STARTS AS RUBBLE: it falls on turn one and must be rebuilt before anyone can own it. Rebuilt, it pays +$1 per CHART you own (the duration mismatch is a feature).',null,true),
mk('cushing','CUSHING, OKLAHOMA','🛢️','COMMODITY',2,6,35.9851,-96.7676,'pipeline crossroads · the WTI delivery point','+$5 when OIL SPIKES, DOUBLED to $10 if you also own the CRUDE OIL PIT (the barrel has to land somewhere).',{e:{oilspike:5},x2:'oil'}),
mk('permian','THE PERMIAN BASIN','⛽','COMMODITY',3,7,31.9,-102.1,'fracked flat · the pump jacks nod','+$3 when OIL SPIKES; +$1 income per other oil node you own.',{e:{oilspike:3},i:[[OIL_ALL,1]]}),
mk('knox','FORT KNOX','🥇','COMMODITY',2,6,37.89,-85.96,'audit pending since 1974','+$5 on GOLD RUSH. +$2 income while you also own the GOLD-COLOURED COINS (the gold is, allegedly, there).',{e:{goldrush:5},w:[['gold',2]]}),
mk('cme','CME TRADING FLOOR','📟','CHART',2,5,41.8819,-87.6278,'open outcry, now silent','+$1 income per COMMODITY node you own (the futures all clear here).',{t:[['COMMODITY',1]]}),
mk('malago','MAR-A-LAGO','⛳','WILD',2,7,26.6773,-80.0368,'the gold-plated clubhouse','+$3 income while you also own DONALD TRUMP (the member lives here).',{w:[['trump',3]]}),
mk('area51','AREA 51','👽','WILD',1,5,37.2431,-115.793,'nothing to see here · see here','+1 Intel at the start of each of your turns (they have a file on everyone).',{s:1}),
mk('panama','THE PANAMA CANAL','🚢','COMMODITY',3,8,9.08,-79.68,'one lock, ten thousand invoices',
 'CHOKEPOINT: every rival who walks into or through this node pays you a $2 transit toll, and on the WORLD MAP it is the only land link between the northern and southern continents.',null,true),
mk('bay','BAY STREET','🍁','BANK',2,6,43.6532,-79.3832,'polite · well-capitalised · sorry','+$2 income while you also own the ALBERTA TAR SANDS (the TSX is all mines and oil).',{w:[['w_tar',2]]}),
mk('tar','ALBERTA TAR SANDS','⚫','COMMODITY',3,7,56.7267,-111.3803,'it flows if you wait','+$4 when OIL SPIKES.',{e:{oilspike:4}}),
mk('pemex','PEMEX','🛢️','COMMODITY',2,5,19.4326,-99.1332,'the state oil company · the books are a mood','+$3 when OIL SPIKES; +$1 when TRUMP TWEETS TARIFFS (a neighbour has opinions).',{e:{oilspike:3,tariffs:1}}),
mk('hollywood','HOLLYWOOD','🎬','MEDIA',2,6,34.1016,-118.3267,'the sign still says it','+$2 income while you own THE BIG SHORT cinema and +$2 while you own BRAD PITT; +$3 on THE BIG SHORT SCREENING.',{w:[['bigshort',2],['brad',2]],e:{bigscreen:3}}),
mk('satoshi',['SATOSHI’S','WALLET'],'🔑','WILD',0,6,64.1466,-21.9426,'last moved in 2010 · might be a committee','+$2 income per OTHER WILD node you own (the keys are scattered everywhere).',{t:[['WILD',2,1]]}),
/* ── South America ── */
mk('milei','JAVIER MILEI','🪚','WILD',2,7,-34.6037,-58.3816,'the chainsaw · the wig · the inflation graph',
 'CHAINSAW: once per game, on your action, pay $3 and cut ONE edge of the board adjacent to any node you choose, and +$4 from the savings. (Phase 2.)',null,true),
mk('lithium',['THE LITHIUM','TRIANGLE'],'🔋','COMMODITY',3,7,-23.65,-67.8,'salt flats · white gold · batteries for everyone','+$2 income per other battery metal you own (LITHIUM TRIANGLE, CONGO COBALT, INDONESIAN NICKEL, BAOTOU RARE EARTHS).',{i:[[BATTERY,2]]}),
mk('vale',['VALE','IRON ORE'],'⛏️','COMMODITY',3,7,-6.0667,-50.1833,'a red mountain that ships itself','+$3 income while you also own BHP; +$2 on COAL RUSH (the ore rides the rails too).',{w:[['bhp',3]],e:{coalrush:2}}),
mk('codelco',['CODELCO','COPPER'],'🟠','COMMODITY',3,6,-22.3,-68.9,'the biggest hole in Chile','+$3 on COAL RUSH or GOLD RUSH (the whole metals complex lifts).',{e:{coalrush:3,goldrush:3}}),
mk('petrobras','PETROBRAS','🛢️','CORPORATE',3,8,-22.9068,-43.1729,'the oil chain, deep-sea division','+$1 income per OTHER oil node you own; +$4 when OIL SPIKES.',{i:[[OIL_ALL,1]],e:{oilspike:4}}),
mk('pdvsa','PDVSA','🚫','COMMODITY',3,4,10.4806,-66.9036,'sanctioned · yet somehow still shipping','Sanctioned, so cheap: +$5 when OIL SPIKES, but the compliance burden costs +1 Cortisol at the start of your turns.',{e:{oilspike:5},c:1}),
mk('potosi',['POTOSÍ','SILVER MINE'],'🥈','COMMODITY',2,5,-19.5836,-65.7531,'the mountain that ate eight million','+$3 on GOLD RUSH; +$1 income while you also own the GOLD-COLOURED COINS (silver is a good friend).',{e:{goldrush:3},w:[['gold',1]]}),
mk('amazon','THE AMAZON','🌳','WILD',1,6,-3.119,-60.0217,'the lungs · the ledger · the credits',
 '−1 Cortisol at the start of each of your turns (deep breaths). CARBON CREDITS: once per turn, on your action, sell the canopy for $3 per node of yours that is not a COMMODITY. (Phase 2.)',{c:-1},true),
mk('easter',['EASTER','ISLAND'],'🗿','WILD',1,4,-27.1127,-109.3497,'the heads know · the heads say nothing','−1 Cortisol at the start of each of your turns (the heads are very calming).',{c:-1}),
/* ── Europe ── */
mk('boe',['BANK OF','ENGLAND'],'🏛️','REGULATOR',2,8,51.5142,-0.0885,'the Old Lady of Threadneedle Street','+$1 income per BANK you own; +$2 on BONDMAGEDDON (the gilts were here first).',{t:[['BANK',1]],e:{bondrevolt:2}}),
mk('city',['THE CITY','OF LONDON'],'🏙️','BANK',3,8,51.5133,-0.0899,'LIBOR was a vibe, not a number','+$2 income while you also own the BANK OF ENGLAND; +$3 on the RBA CASH-RATE DECISION (the rate fix pays regardless).',{w:[['w_boe',2]],e:{rates:3}}),
mk('lloyds',['LLOYD’S','OF LONDON'],'☂️','BANK',2,6,51.5128,-0.0821,'insured · except for that',
 'MISSILE INSURANCE: whenever ANY node is destroyed by a missile, you are paid $3 by the bank (the underwriters had read the small print), and a node of yours that is hit pays out in full.',null,true),
mk('brexit','BREXIT','🇬🇧','WILD',1,6,51.1279,1.3134,'the cliffs of Dover · the border of vibes',
 'TAKE BACK CONTROL: once per game, on your action, sever any one edge of the board for the rest of the con (Dover, the Channel, the whole lot) — and take +1 Cortisol. (Phase 2.)',null,true),
mk('ecb',['THE ECB'],'💶','REGULATOR',2,8,50.1109,8.6821,'whatever it takes · for nineteen governments','+$2 on the RBA CASH-RATE DECISION and BONDMAGEDDON; +$2 income while you also own GERMAN BUNDS.',{e:{rates:2,bondrevolt:2},w:[['w_bunds',2]]}),
mk('db',['DEUTSCHE BANK'],'🏦','BANK',2,6,50.1135,8.6732,'allegedly well capitalised · always','+$1 income per CORPORATE you own (it lends to everybody, then again).',{t:[['CORPORATE',1]]}),
mk('bunds',['GERMAN','BUNDS'],'🇩🇪','CHART',1,3,52.52,13.405,'boring is the product','+$2 income while you also own the 10-YEAR MASTER CHART; +$2 on BONDMAGEDDON (the safe haven of the safe havens).',{w:[['tenyear',2]],e:{bondrevolt:2}}),
mk('btp',['ITALIAN','BTP SPREAD'],'🍝','CHART',1,3,41.9028,12.4964,'the spread widens, the espresso stays hot','+$3 on BONDMAGEDDON (the spread explodes first).',{e:{bondrevolt:3}}),
mk('greek',['THE GREEK','DEBT'],'🏺','CHART',3,2,37.9838,23.7275,'cursed · a gift that keeps giving','CURSED: pays $3 a turn at a fire-sale price, but holding it costs +1 Cortisol at the start of every turn. (The bailouts were also “temporary”.)',{c:1}),
mk('cs',['CREDIT SUISSE'],'🏔️','BANK',2,3,47.3769,8.5417,'160 years · gone in a weekend',
 'STARTS AS RUBBLE. When rebuilt it comes back as UBS: a BANK that pays +$2 per BANK you own. (Phase 2.)',null,true),
mk('bis',['THE BIS','BASEL'],'🌀','REGULATOR',1,6,47.5596,7.5886,'the central bank of central banks','+$1 income per OTHER REGULATOR you own (the committee of committees).',{t:[['REGULATOR',1,1]]}),
mk('swiss',['THE SWISS','VAULT'],'🔒','WILD',2,7,46.948,7.4474,'discretion is the product','+1 Intel on THE TAPES GO MISSING and on ANONYMOUS TIP (the vault keeps copies).',{e:{tapes:[0,1],tip:[0,1]}}),
mk('lux',['LUXEMBOURG','LETTERBOX'],'📮','CORPORATE',2,6,49.6117,6.1319,'two hundred thousand companies · one door','+$1 income per BANK you own; +$3 on A QUIET QUARTER.',{t:[['BANK',1]],e:{quiet:3}}),
mk('asml',['ASML'],'🔬','CORPORATE',3,9,51.4096,5.4586,'the only machine that can make the machine','+$3 income while you also own TSMC; +$2 while you own SAMSUNG (the customers queue).',{w:[['w_tsmc',3],['w_samsung',2]]}),
mk('tulip',['THE TULIP','BULB'],'🌷','COMMODITY',1,3,52.3676,4.9041,'1637 · the original bubble','+$4 on A QUIET QUARTER and +$3 on GOLD RUSH (the bubble loves a quiet room).',{e:{quiet:4,goldrush:3}}),
mk('norway',['NORWAY’S','WEALTH FUND'],'🛢️','BANK',3,9,59.9139,10.7522,'a trillion · mostly oil · politely','+$1 income per oil node you own; +$4 when OIL SPIKES.',{i:[[OIL_ALL,1]],e:{oilspike:4}}),
mk('gazprom','GAZPROM','🔥','COMMODITY',3,7,59.9876,30.1858,'the pipeline is the diplomacy','+$3 when OIL SPIKES; +$3 income while you also own NORD STREAM; +$2 while you own THE KREMLIN.',{e:{oilspike:3},w:[['w_nordstream',3],['w_kremlin',2]]}),
mk('nordstream',['NORD STREAM'],'💥','COMMODITY',2,4,54.9,15.5,'built · inspected · allegedly very quiet',
 'STARTS AS RUBBLE (the pipeline is already in pieces) and must be rebuilt before it pays; rebuilt, it pays +$3 on OIL SPIKES. (Phase 2.)',null,true),
mk('kremlin',['THE KREMLIN'],'🏰','REGULATOR',2,8,55.752,37.6175,'a very long table · nobody sits','+1 Intel at the start of your turn; +$2 income while you also own GAZPROM.',{s:1,w:[['w_gazprom',2]]}),
mk('lira',['THE TURKISH','LIRA'],'💸','CHART',1,2,39.9334,32.8597,'the line goes the other way','+$3 on BONDMAGEDDON (it was already in free fall).',{e:{bondrevolt:3}}),
mk('monaco',['MONACO','CASINO'],'🎰','WILD',2,6,43.7384,7.4246,'the house always wins · the house is a principality','+$3 on A QUIET QUARTER and on MADE PAYS OUT… PROBABLY (the house collects on everything).',{e:{quiet:3,madeout:3}}),
mk('vatican',['THE VATICAN','BANK'],'⛪','BANK',2,7,41.9022,12.4539,'works in mysterious ways · accounts in more','−1 Cortisol at the start of each of your turns (confession is free). ACCC-EXEMPT: no ACCC or ASIC file can ever open on you for banking. (Phase 2.)',{c:-1},true),
/* ── Middle East & Africa ── */
mk('aramco',['SAUDI','ARAMCO'],'🛢️','COMMODITY',5,11,26.3,50.15,'the biggest oil on the board','+$8 when OIL SPIKES. Pays $5 a turn — the largest oil position on the board.',{e:{oilspike:8}}),
mk('opec',['OPEC','VIENNA'],'🛢️','REGULATOR',2,8,48.2082,16.3738,'the cartel meets · the cartel decides','+$1 income per oil node you own; +$4 when OIL SPIKES.',{i:[[OIL_ALL,1]],e:{oilspike:4}}),
mk('hormuz',['STRAIT OF','HORMUZ'],'⚓','COMMODITY',3,8,26.57,56.25,'a fifth of the world’s oil · two miles wide',
 'CHOKEPOINT: every rival who enters this node pays you a $2 toll, and on OIL SPIKES you collect $2 per oil node a rival owns. (Phase 2.)',null,true),
mk('suez',['THE SUEZ','CANAL'],'🛳️','COMMODITY',3,8,30.4574,32.3499,'the Ever Given · six days · one very big boat',
 'CHOKEPOINT: every rival who enters this node pays you a $2 toll; once per game, on your action, you may BLOCK it (EVER GIVEN) for a full round: no one, you included, passes through. (Phase 2.)',null,true),
mk('burj',['BURJ KHALIFA'],'🏙️','CORPORATE',3,8,25.1972,55.2744,'828 metres of confidence','+$2 income while you also own the ABU DHABI WEALTH FUND (the floors are rented to the sovereign).',{w:[['w_adia',2]]}),
mk('neom',['NEOM','THE LINE'],'📏','CORPORATE',1,7,28.1,35.1,'170 km long · zero metres built','+$3 income while you also own SAUDI ARAMCO (the funding round is crude).',{w:[['w_aramco',3]]}),
mk('adia',['ABU DHABI','WEALTH FUND'],'🏦','BANK',3,9,24.4539,54.3773,'sovereign · patient · a lot of it','+$1 income per oil node you own; +$3 when OIL SPIKES.',{i:[[OIL_ALL,1]],e:{oilspike:3}}),
mk('nigprince',['THE NIGERIAN','PRINCE'],'👑','WILD',1,3,6.5244,3.3792,'a confidential business proposal',
 'ADVANCE FEE: once per turn, on your action, pay $2 and name a node on the table: flip a coin — heads you receive $5, tails you receive nothing at all and the prince has gone silent. (Phase 2.)',null,true),
mk('dangote',['DANGOTE','REFINERY'],'🏭','COMMODITY',3,7,6.4474,3.9718,'the largest refinery in Africa · the queue is for petrol','+$4 when OIL SPIKES; +$2 income while you also own THE PERMIAN BASIN.',{e:{oilspike:4},w:[['w_permian',2]]}),
mk('cobalt',['CONGO','COBALT'],'🔵','COMMODITY',3,6,-10.7167,25.4667,'every phone · every battery · very deep','+$2 income per other battery metal you own.',{i:[[BATTERY,2]]}),
mk('witz',['WITWATERSRAND','GOLD'],'⛏️','COMMODITY',3,7,-26.2041,28.0473,'a third of all the gold ever mined','+$5 on GOLD RUSH.',{e:{goldrush:5}}),
mk('debeers',['DE BEERS'],'💎','COMMODITY',3,8,-28.7282,24.7499,'a diamond is forever · the supply was not','+$3 on GOLD RUSH; +$2 income while you also own WITWATERSRAND GOLD.',{e:{goldrush:3},w:[['w_witz',2]]}),
mk('zim',['ZIMBABWE','TRILLION-DOLLAR','NOTE'],'🧾','CHART',1,2,-17.8252,31.0335,'a trillion · buys a loaf · nearly','+$3 on BONDMAGEDDON and on A QUIET QUARTER (hyperinflation is at least predictable).',{e:{bondrevolt:3,quiet:3}}),
mk('mpesa',['M-PESA'],'📱','BANK',2,5,-1.2921,36.8219,'a bank in your pocket before the banks were','+$1 income per OTHER WILD node you own (the app reaches everywhere).',{t:[['WILD',1,1]]}),
mk('pyramids',['THE PYRAMIDS'],'🔺','WILD',2,6,29.9792,31.1342,'the original pyramid scheme','+$1 income per three nodes you own (more at the bottom, more at the top).',{n:[1,3]}),
/* ── Asia ── */
mk('boj',['BANK OF','JAPAN'],'🏯','REGULATOR',2,8,35.6866,139.7735,'yield curve control · the rubber band','+$2 income while you also own JAPAN BOND YIELDS; +$3 on BONDMAGEDDON (the curve control fails here first).',{w:[['japan',2]],e:{bondrevolt:3}}),
mk('watanabe',['MRS','WATANABE'],'👛','WILD',1,5,35.7,139.7,'the carry trade has a face',
 'CARRY TRADE: on your action, borrow $6 against Tokyo’s zero rates now; repay $9 at the start of your next turn, or pay it in Cortisol if you cannot. (Phase 2.)',null,true),
mk('toyota',['TOYOTA'],'🚗','CORPORATE',3,8,35.0825,137.1561,'just in time · always on time','+$2 income while you also own THE BULLET TRAIN (the lines run to the minute); +$2 on A QUIET QUARTER.',{w:[['bullet',2]],e:{quiet:2}}),
mk('pboc',['THE PBOC'],'🏦','REGULATOR',2,8,39.9042,116.4074,'the reserve requirement is a mood','+$2 income while you also own the HKMA PEG; +$2 on the RBA CASH-RATE DECISION and on TRUMP TWEETS TARIFFS (it responds).',{w:[['w_hkma',2]],e:{rates:2,tariffs:2}}),
mk('evergrande',['EVERGRANDE'],'🏗️','CORPORATE',3,3,22.5429,114.0596,'the towers are very tall · and empty',
 'STARTS AS RUBBLE (the towers are, allegedly, standing but not finished). Rebuilt, it pays +$2 per CORPORATE you own. (Phase 2.)',null,true),
mk('shenzhen',['SHENZHEN','FACTORY'],'🏭','CORPORATE',2,6,22.6,114.1,'the world’s workshop · three shifts','+$1 income per CORPORATE node you own (itself included).',{t:[['CORPORATE',1]]}),
mk('baotou',['BAOTOU','RARE EARTHS'],'🧲','COMMODITY',3,7,40.65,109.84,'the magnet in everything','+$3 when TRUMP TWEETS TARIFFS (the trade war is a magnet); +$2 income while you also own the SHENZHEN FACTORY.',{e:{tariffs:3},w:[['w_shenzhen',2]]}),
mk('bri',['THE BELT','AND ROAD'],'🛤️','WILD',2,8,34.3416,108.9398,'every road leads to a loan',
 'NEW SILK ROAD: once per turn, on your action, pay $4 to link two nodes of yours (or one of yours and any node next to it) with a permanent edge, for everyone. (Phase 2.)',null,true),
mk('hsbc',['HSBC','HONG KONG'],'🏦','BANK',3,8,22.2796,114.1588,'the world’s local bank · the Hong Kong one','+$2 income while you also own the HKMA PEG; +$2 on the RBA CASH-RATE DECISION.',{w:[['w_hkma',2]],e:{rates:2}}),
mk('hkma',['THE HKMA','PEG'],'📌','REGULATOR',2,7,22.2831,114.1733,'7.80 · hold the line','−1 Cortisol at the start of each of your turns (the peg holds, the nerves hold).',{c:-1}),
mk('tsmc',['TSMC'],'🧠','CORPORATE',4,10,24.7804,120.9983,'the island that makes the chips','+$3 income while you also own ASML; +$2 income while you own SAMSUNG (the foundries watch each other).',{w:[['w_asml',3],['w_samsung',2]]}),
mk('samsung',['SAMSUNG'],'📱','CORPORATE',3,8,37.2636,127.0286,'chaebol · everything with a screen','+$2 income while you also own ASML; +$2 on A QUIET QUARTER.',{w:[['w_asml',2]],e:{quiet:2}}),
mk('temasek',['TEMASEK'],'🇸🇬','BANK',3,8,1.2833,103.8501,'the sovereign that owns the airline','+$2 income while you also own MARINA BAY SANDS; +$1 income per OTHER BANK you own.',{w:[['w_mbs',2]],t:[['BANK',1,1]]}),
mk('mbs',['MARINA BAY','SANDS'],'🏨','CORPORATE',3,8,1.2834,103.8607,'a ship on three towers · the casino pays','+$3 on A QUIET QUARTER and on MADE PAYS OUT… PROBABLY (the casino collects).',{e:{quiet:3,madeout:3}}),
mk('rbi',['THE RBI'],'🇮🇳','REGULATOR',2,7,18.9322,72.8348,'the repo rate · the repo man','+$2 income while you also own DALAL STREET; +$2 on the RBA CASH-RATE DECISION (rates echo down the world).',{w:[['w_dalal',2]],e:{rates:2}}),
mk('dalal',['DALAL STREET'],'📊','CHART',2,4,18.9298,72.8333,'the Sensex has opinions','+$2 income while you also own the STOCK-MARKET CHARTS; +$2 on BONDMAGEDDON.',{w:[['stock',2]],e:{bondrevolt:2}}),
mk('adani',['ADANI'],'🏗️','CORPORATE',3,8,23.0225,72.5714,'ports · power · coal · allegedly','+$4 on COAL RUSH; +$2 income while you also own the COAL TERMINAL (allegedly shipped and sold).',{e:{coalrush:4},w:[['port',2]]}),
mk('bangalore',['THE BANGALORE','CALL CENTRE'],'🎧','WILD',2,5,12.9716,77.5946,'“have you tried turning it off and on”',
 'WARRANTY EXPIRED: at the start of each of your turns one rival of your choice is put on hold and loses 1 Intel (they were told it would be a ten-minute wait). (Phase 2.)',null,true),
mk('mdb',['1MDB'],'🦘','WILD',2,6,3.1479,101.6953,'the yacht · the paintings · the pink diamond','+$3 income while you also own PETRONAS (the fund-raising was local).',{w:[['petronas',3]]}),
mk('nickel',['INDONESIAN','NICKEL'],'🪨','COMMODITY',3,6,-2.0,121.4,'the island that powers the EV','+$2 income per OTHER battery metal you own; +$3 on COAL RUSH (the smelters run on coal).',{i:[[BATTERY,2]],e:{coalrush:3}}),
mk('kazatom',['KAZATOMPROM','URANIUM'],'☢️','COMMODITY',2,5,51.1694,71.4491,'two-fifths of the planet’s uranium','+$3 on COAL RUSH (the competition panics) and +$2 when OIL SPIKES.',{e:{coalrush:3,oilspike:2}}),
mk('baht',['THE BAHT','1997'],'📉','CHART',1,3,13.7563,100.5018,'the contagion started in Bangkok','+$3 on BONDMAGEDDON (the flu begins here).',{e:{bondrevolt:3}}),
mk('srilanka',['SRI LANKA'],'🍃','WILD',1,2,6.9271,79.8612,'in default · the tea is still excellent','Pays $1 a turn and costs almost nothing: +$3 on BONDMAGEDDON (the default was early).',{e:{bondrevolt:3}}),
/* ── Oceania, polar & offshore ── */
mk('rbnz',['THE RBNZ'],'🥝','REGULATOR',1,5,-41.2866,174.7756,'a cash rate · and a kiwi','+$2 income while you also own the RBA; +$2 on the RBA CASH-RATE DECISION (the Reserve Bank of the other island).',{w:[['rba',2]],e:{rates:2}}),
mk('fonterra',['FONTERRA'],'🥛','COMMODITY',2,5,-36.8485,174.7633,'milk · a lot of it · powdered','+$3 on A QUIET QUARTER; +$2 income while you also own THE NZ SHEEP.',{e:{quiet:3},w:[['w_sheep',2]]}),
mk('sheep',['THE NZ','SHEEP'],'🐑','COMMODITY',1,3,-43.5321,172.6362,'six per person · all of them listening','+$2 on A QUIET QUARTER and +$1 income while you also own FONTERRA.',{e:{quiet:2},w:[['w_fonterra',1]]}),
mk('nauru',['NAURU'],'🏝️','WILD',1,2,-0.5477,166.9209,'phosphate · a nation · a parking lot','+$3 on GOLD RUSH (everything shiny gets looked at) and +$1 income while you also own TUVALU.',{e:{goldrush:3},w:[['geo_tuvalu',1]]}),
mk('fiji',['FIJI','WATER'],'💧','CORPORATE',2,5,-17.7134,178.065,'bottled somewhere very far from here','+$2 income while you also own QUIKSTOP (the bottled water sells best at the servo).',{w:[['quik',2]]}),
mk('png',['PNG','GOLD'],'🪙','COMMODITY',2,5,-6.31,155.1,'a big pit · a small island','+$4 on GOLD RUSH; +$1 income per OTHER COMMODITY you own.',{e:{goldrush:4},t:[['COMMODITY',1,1]]}),
mk('antarctica',['ANTARCTICA'],'🐧','WILD',2,9,-77.85,166.67,'nobody owns it · nobody pays rent',
 'UNTOUCHABLE: once you own it, no hostile takeover of it is ever possible; it also never inflates. Its income is a flat $2. (Phase 2.)',null,true),
mk('greenland',['GREENLAND'],'❄️','WILD',2,6,64.1835,-51.7216,'it is not for sale · apparently it is','+$3 income while you also own DONALD TRUMP (he is, allegedly, interested).',{w:[['trump',3]]}),
mk('svalbard',['SVALBARD','SEED VAULT'],'🌱','WILD',1,6,78.2386,15.5086,'every seed on earth · in a very cold cupboard',
 'ANTI-RUBBLE: any node of yours that would be turned to rubble survives; once per game, you may rebuild a rubble node for free. (Phase 2.)',null,true),
mk('cayman',['THE CAYMAN','ISLANDS'],'🏝️','CORPORATE',2,6,19.3133,-81.2546,'everyone is a director here','+$2 income while you also own THE HEDGE FUND (somebody is shorting from the beach); +$1 income per BANK you own.',{w:[['hedge',2]],t:[['BANK',1]]}),
mk('bermuda',['THE BERMUDA','TRIANGLE'],'🌀','WILD',1,5,25.0,-71.0,'ships · planes · positions · all vanish',
 'THE VANISH: once per game, on your action, you disappear from the board for the rest of the round: you cannot be targeted, tolled or bugged, and you reappear at any node of your choice at the start of your next turn. (Phase 2.)',null,true),
mk('bvi',['THE BRITISH','VIRGIN ISLANDS'],'🏝️','CORPORATE',2,5,18.4286,-64.6185,'a million companies · a very small island','+$2 income while you also own THE CAYMAN ISLANDS; +$3 on A QUIET QUARTER.',{w:[['w_cayman',2]],e:{quiet:3}})
];
export const WORLD_NODE_IDS=WORLD_NODES.map(n=>n.id);
/* the WORLD EXPANSION is wide: a random board with it on is dealt on a canvas this much larger */
export const WORLD_RANDOM_SCALE=1.6;

/* ───── ability helpers (pure) ───── */
/* extra income from `fx` for player i. own(id)->bool, owned: that player's nodes, rivalCount(type)->count. */
export function worldSynergy(owned,own,rivalCount){
 let syn=0;
 for(const n of owned){
  const f=n.fx;if(!f)continue;
  if(f.t)f.t.forEach(([type,amt,other])=>{syn+=amt*owned.filter(o=>o.type===type&&!(other&&o.id===n.id)).length});
  if(f.r)f.r.forEach(([type,amt])=>{syn+=amt*rivalCount(type)});
  if(f.w)f.w.forEach(([id,amt])=>{if(own(id))syn+=amt});
  if(f.i)f.i.forEach(([ids,amt])=>{syn+=amt*ids.filter(id=>id!==n.id&&own(id)).length});
  if(f.n)syn+=f.n[0]*Math.floor(owned.length/f.n[1]);
 }
 return syn;
}
/* start-of-turn passives: [{id,name,c,s}] for every owned node that has one */
export function worldStartFx(owned,own){
 const out=[];
 for(const n of owned){
  const f=n.fx;if(!f)continue;
  let s=f.s||0;if(f.wi)f.wi.forEach(([id,amt])=>{if(own(id))s+=amt});
  if(f.c||s)out.push({id:n.id,name:n.name.join(' '),c:f.c||0,s});
 }
 return out;
}
/* event windfalls: [{id,amt,intel,name}] for the nodes with an entry for this card. `amt` is at $100 scale. */
export function worldEventPays(cardId,ownerOf){
 const out=[];
 for(const n of WORLD_NODES){
  const f=n.fx;if(!f||!f.e||f.e[cardId]==null)continue;
  const o=ownerOf(n.id);if(o==null)continue;
  const v=f.e[cardId];let amt=Array.isArray(v)?v[0]:v;const intel=Array.isArray(v)?v[1]:0;
  if(f.x2&&ownerOf(f.x2)===o)amt*=2;
  out.push({id:n.id,owner:o,amt,intel,name:n.name.join(' ')});
 }
 return out;
}

/* ───── WORLD MAP geography ───── */
/* lat/lon of the classic and Geography DLC exhibits (the world expansion carries its own `geo`). */
export const GEO_ANCHORS={
 citi:[40.7061,-74.0088],commbank:[-33.8688,151.2093],nab:[-37.8136,144.9631],anz:[-37.8220,144.9500],westpac:[-33.8650,151.2100],
 bond:[40.7128,-74.0060],hedge:[41.0262,-73.6282],rba:[-33.8680,151.2112],asic:[-37.8100,144.9700],accc:[-35.2809,149.1300],gov:[-35.3081,149.1245],
 us:[38.8977,-77.0365],japan:[35.6762,139.6503],uk:[51.5074,-0.1278],aus:[-33.9000,151.2300],tenyear:[48.8566,2.3522],infl:[-34.6,-58.45],
 cash:[-33.8700,151.2000],stock:[31.2304,121.4737],oil:[29.7604,-95.3698],oilgraph:[31.9973,-102.0779],barrels:[51.9244,4.4777],tanker:[1.2,104.5],
 petronas:[3.1579,101.7116],gold:[-31.9505,115.8605],train:[-32.3,150.9],port:[-32.9283,151.7817],bhp:[-20.3100,118.5800],forklift:[-33.9700,151.2100],
 coal:[-33.8800,151.1500],quik:[-33.8830,151.1600],market:[-33.8860,151.1570],f1:[-37.8497,144.9680],qantas:[-33.9399,151.1753],bullet:[34.6937,135.5023],
 press:[-33.8600,151.2050],fox:[40.7580,-73.9855],leak:[38.9072,-77.0369],jim:[-35.3000,149.1400],herald:[-37.8200,144.9800],bess:[38.9000,-77.0300],
 insider:[41.8781,-87.6298],photo:[-35.2900,149.1100],bigshort:[34.0522,-118.2437],news:[-27.4698,153.0251],wef:[46.8,9.8366],
 back:[36.1699,-115.1398],term:[40.7614,-73.9776],golf:[33.4735,-81.9748],whistle:[55.7558,37.6173],iface:[47.6062,-122.3321],
 school:[-33.8710,151.2070],ib:[46.2044,6.1432],mpc:[-33.8750,151.2150],sisy:[37.9060,22.8800],group:[-25.3444,131.0369],sat:[-23.7000,133.8800],
 watson:[-32.9200,151.7600],bessent:[38.8950,-77.0400],chalmers:[-27.6500,153.1000],albo:[-33.9100,151.1500],trump:[40.7624,-73.9733],bullock:[-33.8700,151.2150],
 bond007:[51.4975,-0.1357],rock:[21.3069,-157.8583],brad:[37.2090,-93.2923],jt:[-28.0167,153.4000],made:[-48.8767,-123.3933],asics:[34.6900,135.1956],toktimer:[-42.8821,147.3272],
 geo_missile:[40.0333,128.1833],geo_shahed:[35.6892,51.3890],geo_wonsan:[39.1500,127.4400],geo_pyoncity:[39.0392,125.7625],geo_pyothotel:[39.0310,125.7340],
 geo_boeing:[47.9790,-122.2020],geo_scs:[14.5,114.0],geo_stage5:[39.7900,125.7500],geo_pillars:[50.8503,4.3517],geo_venice:[45.4408,12.3155],geo_tuvalu:[-8.5211,179.1983],geo_kim:[39.0100,125.7300]
};
export function geoOf(n){return n&&(n.geo||GEO_ANCHORS[n.id])||null}
/* Long-haul routes (shipping lanes and flight paths) that proximity alone would not create. */
export const WORLD_ROUTES=[
 /* the Atlantic bridge */ ['citi','uk'],['w_goldman','w_city'],['w_bell','w_boe'],['oil','barrels'],['w_petrobras','w_dangote'],['w_milei','w_ecb'],
 /* the kangaroo route */ ['qantas','w_temasek'],['qantas','w_hollywood'],['qantas','japan'],['qantas','w_fonterra'],['gold','w_witz'],['w_antarctica','toktimer'],
 /* the Asian ring */ ['w_temasek','w_hsbc'],['japan','w_hsbc'],['w_temasek','w_burj'],['w_hsbc','w_pboc'],['w_burj','w_rbi'],['w_rbi','w_temasek'],['japan','w_pboc'],['w_samsung','japan'],
 /* oil lanes */ ['w_hormuz','tanker'],['w_hormuz','w_rbi'],['w_suez','w_hormuz'],['w_suez','barrels'],['w_aramco','w_hormuz'],['port','japan'],['bhp','stock'],['bhp','w_temasek'],
 /* the Middle corridor */ ['w_burj','w_suez'],['w_burj','w_witz'],['w_burj','w_city'],['w_suez','w_dangote'],['w_kremlin','w_pboc'],['w_kremlin','w_bunds'],['w_kremlin','w_aramco'],
 /* the Americas */ ['w_panama','w_vale'],['w_panama','oil'],['w_panama','w_hollywood'],['w_panama','w_pdvsa'],['citi','w_hollywood'],['w_pemex','w_panama'],['w_milei','w_petrobras'],['rock','w_hollywood'],['w_easter','w_milei'],['made','w_easter'],
 /* the Caribbean */ ['w_cayman','w_bvi'],['w_cayman','w_bermuda'],['w_bermuda','citi'],['w_cayman','w_panama'],
 /* the North */ ['w_greenland','w_satoshi'],['w_satoshi','uk'],['w_svalbard','w_norway'],['w_greenland','w_bay'],
 /* the Pacific islands */ ['w_nauru','geo_tuvalu'],['w_png','w_nauru'],['w_fiji','geo_tuvalu'],['w_fiji','w_fonterra'],['w_png','qantas'],['w_nickel','w_png']
];

/* low-detail continent outlines: [lon,lat] rings. Hand-simplified; the look is "evidence board", not an atlas. */
export const LAND=[
 /* North America + Central America */
 [[-168,66],[-162,70],[-156,71.3],[-141,69.6],[-128,70],[-115,68.5],[-100,68],[-95,72],[-88,68.5],[-82,69],[-80,63],[-90,64],[-94,60],[-92,57],[-85,55.5],[-82,52.5],[-79,51.5],[-78,56],[-77,60],[-72,61],[-65,60],[-62,57],[-58,54],[-56,52],[-60,50],[-65,49],[-70,47],[-66,45],[-62,45.5],[-66,43.6],[-70,43],[-70.5,41.7],[-74,40.5],[-76,37],[-76,35],[-80,32],[-81,30],[-80,26],[-81,25.2],[-82.7,27.5],[-83,29.5],[-86,30.3],[-89,30.2],[-91,29],[-94,29.5],[-97,27.5],[-97.5,24],[-97.5,21],[-96,19],[-94,18.2],[-91,18.7],[-90.5,21],[-87,21.5],[-87.5,18],[-88.5,16],[-84,15.8],[-83.5,11],[-81.5,8.8],[-79,9.5],[-77.5,8.5],[-80,7.3],[-83,8.2],[-85.7,10],[-87.5,13],[-91.5,14],[-94.5,16],[-98,16.2],[-103,18.2],[-105.5,20],[-105.5,23],[-109,25.5],[-111.5,28],[-114.7,31.7],[-114.5,29],[-112,25.3],[-110,23],[-112.5,25],[-115.5,28.5],[-117.2,32.5],[-120.5,34.5],[-122.5,37.5],[-124,40.3],[-124.5,43],[-124,46.5],[-124.5,48.3],[-123,49],[-127,51],[-130,54.5],[-134,58],[-139,59.5],[-146,60.5],[-150,59.5],[-154,57],[-158,56],[-162,55],[-160,58.5],[-162,60],[-165,62],[-161,64],[-166,65],[-168,66]],
 /* Greenland */
 [[-73,78],[-60,82],[-30,83.5],[-18,80],[-20,75],[-22,70],[-32,68],[-40,65],[-43,60],[-48,61],[-52,64.5],[-54,67],[-55,71],[-60,75],[-73,78]],
 /* South America */
 [[-77.5,8.5],[-75,11],[-72,12],[-68,10.5],[-62,10.7],[-60,8],[-57,6],[-52,5],[-50,1],[-48,-1],[-44,-2.5],[-38,-4],[-35,-6],[-35,-9],[-38.5,-13],[-39,-18],[-41,-22],[-45,-23.5],[-48.5,-26],[-49,-29],[-53,-33.5],[-56,-34.8],[-57.5,-36],[-57,-38],[-62,-39],[-65,-41],[-64.5,-43],[-67,-46],[-66,-48],[-69,-51],[-68.5,-52.7],[-71,-54],[-74,-52],[-75.5,-48],[-73.5,-43],[-73.5,-37],[-71.5,-30],[-70.5,-23],[-70.3,-18.5],[-76,-14],[-79,-8],[-81,-5],[-80,-2],[-80,0.5],[-78.5,2],[-77.5,6]],
 /* Africa */
 [[-17,21],[-16,25],[-13,27.5],[-10,30],[-9.5,32.5],[-6,35.8],[-2,35.2],[3,36.8],[10,37.2],[11,33.5],[15,32.3],[20,30.8],[20,32.5],[25,32],[30,31.3],[32.5,31.2],[34,27.5],[35.5,24],[37.3,20],[39,15.5],[43,12.5],[44,10.4],[51,11.8],[51.2,10.4],[48,5],[42,-1],[40,-4],[39.5,-8],[40.5,-15],[35,-19.5],[35,-24],[33,-25.5],[32.5,-28.5],[30,-31.5],[26,-34],[22,-34.2],[18.5,-34],[17.5,-30],[15,-27],[14.3,-22],[12,-17],[13.5,-12],[12,-6],[9,-1],[9.5,3.5],[8.5,4.5],[5,4.3],[2,6.3],[-2,4.8],[-7.5,4.4],[-11,6.8],[-13.5,9.5],[-15,11.5],[-17,14.7],[-16.5,18]],
 /* Eurasia */
 [[-9.5,37],[-8.9,41.5],[-9.3,43],[-2,43.5],[-1.3,46],[-4.5,48.3],[-1.5,48.7],[1.5,50],[2.5,51.2],[5,53.2],[8.5,53.7],[8.3,55.5],[10,57.7],[10.5,56],[12,54.2],[14,54],[19,54.4],[21,57],[24,57.3],[24,59.4],[30,60],[23,60],[21.5,62.5],[25,65.5],[22,65.8],[17.5,62.5],[18.5,60],[16.5,57],[14.5,56],[12.5,56],[11,59],[8,58],[5.5,59],[5,62],[8,63.5],[13,67.5],[17,69.5],[24,71],[31,70.3],[41,67.5],[33.5,66.7],[34,64.5],[37.5,63.8],[40.5,64.5],[44,66.2],[44,68.5],[54,68.5],[60,69],[68,69],[69,73],[73,72],[80,73.5],[87,75],[100,77],[105,77.5],[113,74],[128,73],[140,72.6],[150,71.5],[160,69.8],[170,70],[180,68.8],[180,65],[178,64.5],[173,64.3],[179.5,62.5],[172,60.5],[164,59.5],[162,56],[156.5,51],[156,57],[160,61],[155,59.3],[143,59.3],[137,54],[141,53],[140,48],[135,43.5],[131,42.5],[129.5,40.5],[128,38.5],[129.4,36],[126.5,34.5],[126.2,37.2],[125,39.5],[121.5,39],[122,40.5],[118,39],[119,37.2],[122.5,37],[120,35],[121.5,32],[122,30],[120.5,26.5],[117.5,23.5],[114,22.3],[110.5,21.2],[108,21.5],[106.5,19.5],[109,15],[109,12],[106,9.5],[104.5,8.8],[105,10.5],[101,12.5],[100.2,13.4],[99.5,9.5],[100.3,6.5],[103.5,4],[104,1.5],[101,3],[100.4,6],[98.3,8],[98.5,12],[97.6,16.5],[94.5,16],[94.2,19],[92.3,21],[91.5,22.5],[89,21.8],[86.8,20.7],[85,19.5],[82.3,16.5],[80.3,15.5],[79.8,11.5],[79.2,10],[77.5,8.2],[76,10],[74.7,14],[73,17.5],[72.8,21],[70,20.8],[68.5,23.5],[66.5,25.3],[62,25.2],[57.5,25.7],[56.5,27.2],[54,26.7],[51.5,27.8],[50,30],[48.2,29.9],[50.1,26.4],[51.5,24.3],[54,24.1],[56.3,26.3],[56.8,24.5],[59.8,22.5],[58.5,20.3],[55.2,17.2],[52,16],[45,12.8],[43.3,12.7],[42.8,15.5],[40,20],[38.5,24],[35,28],[34.9,29.5],[34.3,31.3],[35.8,34.6],[36.3,36.6],[32.5,36.1],[30.5,36.6],[27.5,36.9],[26.3,38.5],[26.5,40],[26.7,40.2],[26,40.8],[24,40.8],[23,40.2],[24,38],[22.8,36.5],[21.5,37],[21,39],[19.5,41],[19,42.2],[16,43.5],[13.8,45.2],[12.3,45.3],[12.5,44],[14,42.5],[16.2,41.8],[18.5,40.2],[17,39],[16.5,38],[15.7,38],[16,40],[14,40.8],[12,42],[10.5,43.5],[8.8,44.3],[7,43.6],[4.5,43.4],[3,42.5],[3.2,41.7],[0.7,40.7],[0,39.3],[-0.5,38.2],[-2,36.8],[-4.5,36.6],[-5.5,36],[-6.5,36.9]],
 /* Britain, Ireland, Iceland */
 [[-5.5,50],[1.5,51],[1.7,52.8],[0,53.5],[-1.5,55],[-2,57.5],[-4,57.8],[-3,58.6],[-5,58.6],[-6,57],[-5.5,55.5],[-3,54.8],[-3,53.3],[-4.5,53],[-4.2,51.7],[-5.2,51.7],[-3,51.3],[-5.7,50]],
 [[-10,51.7],[-6,52.2],[-6,54.2],[-5.5,55],[-8,55.3],[-10,54]],
 [[-24,65.5],[-22,66.4],[-16,66.5],[-13.5,65],[-18,63.4],[-22.5,63.8]],
 /* Japan, Taiwan, Philippines, Sri Lanka */
 [[130.2,33.5],[131.8,33.2],[132.5,34.2],[135,34.5],[135.5,33.5],[137,34.5],[139,34.7],[140.8,35.7],[141.5,38.2],[141.8,40],[141.2,41.5],[140,41.3],[139.8,39.5],[139.3,38],[137.2,36.8],[136,36],[133,35.5],[131,34.4]],
 [[140,42],[141.5,42.8],[145,43.3],[143,44.5],[141.8,45.4],[141.5,43.5],[140,43]],
 [[120.2,23],[121.5,25.2],[122,24.5],[120.8,21.9]],
 [[120.5,18.3],[122.2,18.5],[121.8,16],[122,14],[124,12.7],[121.5,13.5],[120.5,14.5]],
 [[122,7],[125.5,9.5],[126.5,7],[125,5.8],[123,7.4]],
 [[79.8,9.8],[81.8,7.5],[81.2,6.2],[80,6],[79.8,7.5]],
 /* maritime Southeast Asia */
 [[109,1.5],[110.5,-1],[111,-3],[114.5,-4],[116.5,-2.5],[116.5,1.5],[119,5],[117,7],[115,5],[113,3],[111,1.8]],
 [[95.3,5.5],[98,4],[101,2],[104,-1.5],[106,-3],[105.8,-5.8],[102,-4],[99,0],[97,3]],
 [[105.2,-6],[108,-6.5],[111,-6.8],[114.5,-7.8],[114.5,-8.5],[108,-7.8],[105.5,-6.8]],
 [[119.5,-5.5],[120.5,-2.8],[119.8,0],[121.5,1],[124.5,1.5],[123,0],[121.5,-1],[122.5,-4.5],[121.5,-5],[120.5,-5.5]],
 [[131,-0.8],[134,-0.9],[138,-1.6],[141,-2.7],[145,-4.5],[147.5,-6],[150,-10.5],[147,-10],[143.5,-8.5],[141,-9.2],[138.5,-8],[137.5,-5],[135,-4],[132.5,-3.2]],
 /* Madagascar, Caribbean */
 [[49.3,-12],[50.4,-15.5],[49.5,-18],[47.5,-24.5],[45,-25.5],[43.5,-23],[44.3,-20],[44.5,-16.5],[47,-15]],
 [[-85,22],[-82,23.2],[-78,22.5],[-74.2,20.3],[-77.5,19.9],[-80,21.8]],
 [[-74.4,18.5],[-72.5,20],[-68.5,18.6],[-71,17.8]],
 /* Australia, Tasmania, New Zealand */
 [[113.5,-22],[114.2,-26.5],[115,-30],[115.7,-33.5],[118,-35],[121.5,-33.8],[124,-33.5],[127,-32.3],[131,-31.5],[134,-32.8],[135.7,-34.8],[137.5,-33],[138,-35.5],[140,-37.8],[143.5,-38.7],[146.3,-39],[148,-37.8],[150,-37],[151.5,-33.5],[153,-31],[153.6,-28.5],[153,-25.5],[150,-22.5],[146,-18.8],[145.5,-15],[143.5,-14],[142.5,-10.8],[141.5,-13],[141.5,-17],[139.5,-17.5],[136.5,-15.5],[135.5,-12],[132.5,-11.5],[130,-12.5],[129.5,-15],[126,-14],[122.5,-17.5],[121,-19.5],[117,-20.7]],
 [[144.7,-40.7],[148.3,-40.9],[148,-43],[146,-43.6],[145,-42]],
 [[172.7,-34.5],[174.5,-36.5],[176,-37.5],[178.5,-37.7],[177,-39.5],[175,-41.6],[174.8,-39.5],[173.8,-39.2],[174.5,-37.5]],
 [[172.7,-40.5],[174.3,-41.5],[173,-43.5],[171,-44.5],[169,-46.6],[166.5,-46],[168,-44],[171.5,-41.8]],
 /* Antarctica */
 [[-180,-84],[-180,-78],[-158,-77.5],[-145,-75.5],[-120,-74],[-100,-73],[-78,-73.5],[-72,-70],[-68,-66.5],[-62,-65],[-58,-63.5],[-62,-66.5],[-67,-69],[-65,-72],[-58,-75],[-45,-78],[-30,-77],[-15,-72],[0,-70],[25,-69.5],[50,-67],[70,-67.5],[78,-68],[95,-66.5],[115,-66],[135,-66],[150,-69],[165,-71.5],[180,-69],[180,-84]]
];
/* inland seas painted back over Eurasia */
export const WATER=[
 [[28,41.2],[28,43],[29.5,45.3],[31,46.5],[33.5,46],[33.5,44.5],[36.5,45.4],[38,47],[39.5,43.5],[41.5,41.7],[36,41.2],[31,41.1]],
 [[47,45],[50,46.5],[53.2,45.5],[53,42],[53.5,40],[54,37],[51,36.7],[49,37.5],[49.2,40],[47.5,43]]
];
