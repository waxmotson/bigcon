'use strict';
/* world: the GLOBAL EDITION exhibits (the World Expansion) — ~100 global exhibits pinned to real places — plus the geography the THE BIG CON: GLOBAL EDITION map layout needs.
   Pure data and pure helpers: no DOM, no state, no engine imports (data.js and boards.js import THIS).
   A node WITHOUT an `image` renders as a styled text card (name + icon on its type colour) in the SVG board and the 3D board;
   drop a file path into `image` later and the picture takes over. Nothing else needs to change.
   Abilities that fit the existing hooks are data-driven through `fx` (see worldSynergy / worldStartFx / worldEventPays below).
   A node marked todo:true has its full `sp` text written but only income, cost and seizing live (none are left; the flag still renders a ⚙). */

/* fx schema (all dollar figures are for a $100 table; event cash scales with the host's target like every card):
   t:[[TYPE,$,other?]]  +$ per owned node of that type (other = not counting this node)
   r:[[TYPE,$]]         +$ per rival-owned node of that type
   w:[[id,$]]           +$ income while you also own id
   i:[[[ids],$]]        +$ per owned node from the list (never itself)
   n:[$,per]            +$ per `per` nodes owned (rounded down)
   c:±n                 Cortisol at the start of your turn (negative soothes, positive is a curse)
   s:n                  Intel at the start of your turn;  wi:[[id,n]]  +n Intel at the start of your turn while you also own id
   e:{cardId:$|[$,intel]} windfall when that market event is drawn;  x2:id doubles the cash if you also own id
   rg:[$,cap]  +$ per REGION (regionOf) in which you own at least one node, capped;  an:[$,cap]  +$ per Australian or New Zealand node you own, capped */
export const OIL_ALL=['oil','oilgraph','barrels','tanker','petronas','geo_scs','w_aramco','w_cushing','w_pemex','w_petrobras','w_pdvsa','w_dangote','w_gazprom'];
/* nodes that begin the game as rubble (the World Expansion's casualties) and the ones that rename when rebuilt */
export const WORLD_START_RUBBLE=['w_cs','w_nordstream','w_evergrande'];
/* the three overlapping claims on the Antarctic Peninsula */
export const PENINSULA=['w_aq_chl','w_aq_gbr','w_aq_arg'];
export const WORLD_CHOKEPOINTS=['w_panama','w_hormuz','w_suez','w_malacca'];
export const BATTERY=['w_lithium','w_cobalt','w_nickel','w_baotou'];
/* the offshore nodes: APPLE pays $2 for each one you own */
export const TAX_HAVENS=['w_cayman','w_bvi','w_bermuda','w_swiss','w_monaco'];
/* MARKET-EVENT NODE SETS (the second batch of cards): who a card switches off, pays or taxes. Ids missing from the live board are simply skipped. */
export const TOURISM_NODES=['qantas','market','quik','geo_venice','geo_wonsan','geo_tuvalu','geo_pyothotel','w_cruise','w_mbs','w_monaco','w_gbr','w_burj','w_pyramids','w_fiji']; /* SWIFTONOMICS */
export const IRON_NODES=['bhp','coal','w_codelco','w_potosi','w_nickel']; /* IRON ORE CRASH */
export const SANCTIONED_NODES=['w_gazprom','w_nordstream','w_kremlin','geo_shahed','geo_missile','geo_wonsan','geo_pyoncity','geo_pyothotel','geo_kim']; /* SANCTIONS: Russia, Iran, North Korea */
export const COAL_CHAIN=['coal','train','port','watson','bhp']; /* CHINA BANS AUSTRALIAN COAL */
export const AGRI_NODES=['w_fonterra','w_anzcerta','w_amazon','w_tulip']; /* EL NINO */
export const US_NODES=['citi','hedge','us','oil','fox','leak','bess','bigshort','golf','bessent','trump','brad','geo_boeing','w_bell','w_fed','w_mamdani','w_sec','w_jpm','w_cushing','w_knox','w_malago','w_area51','w_hollywood','w_imf','w_apple','w_tariffwall','w_lockheed']; /* BRICS SUMMIT: the dollar's own nodes */
/* JENSEN HUANG — HONEYPOT: the mainland nodes he can pick up for free */
export const CHINA_NODES=['w_pboc','w_shenzhen','w_baotou','w_bri','w_hsbc','w_hkma','w_evergrande'];
/* the three a liberator needs */
export const LIBERATORS=['w_bigyahu','trump','w_lockheed'];
const mk=(id,name,icon,type,income,cost,lat,lon,sub,sp,fx,todo)=>{
 const n={id:'w_'+id,name:[].concat(name),icon,type,shape:'card',income,cost,geo:[lat,lon],x:0,y:0,rot:0,sub,sp};
 if(fx)n.fx=fx;if(todo)n.todo=true;return n;
};
export const WORLD_NODES=[
/* ── North America ── */
mk('bell','WALL STREET BELL','🔔','MEDIA',2,5,40.707,-74.011,'rung by whoever paid the most this year','+$2 on BONDMAGEDDON, A QUIET QUARTER or THE BIG SHORT SCREENING (the bell rings either way). RING THE BELL: once per turn, as your action, pay $2: the next market event is drawn and resolved RIGHT NOW, and an ASIC/ACCC investigation opens (or escalates by +1 scrutiny) on a rival you choose.',{e:{bondrevolt:2,quiet:2,bigscreen:2}}),
mk('fed','THE FEDERAL RESERVE','🏛️','REGULATOR',2,9,38.893,-77.045,'dual mandate · triple vibes','−1 Cortisol at the start of each of your turns. +$2 on the RBA CASH-RATE DECISION and BIG BESSENT SPEAKS (the world is listening).',{c:-1,e:{rates:2,besspeak:2}}),
mk('mamdani',['ZOHRAN','MAMDANI'],'🗽','WILD',2,7,40.7754,-73.9431,'Gracie Mansion · freeze the rent',
 'TAX THE RICH: at the start of each of your turns, the rival holding the most cash (if they hold more than you) pays you $2.',null),
mk('sec','THE SEC','📋','REGULATOR',1,6,38.896,-77.014,'the paperwork arrives eventually','+$3 on MONOPOLY ALERT. +1 Intel at the start of your turn while you also own THE WHISTLEBLOWER (they file everything).',{e:{crackdown:3},wi:[['whistle',1]]}),
mk('jpm','JPMORGAN','🏦','BANK',3,8,40.7556,-73.9733,'too big to jail','Hostile takeovers of any node YOU own cost the buyer +$2 (the house always has a lawyer).',null),
mk('lockheed',['LOCKHEED','MARTIN'],'✈️','CORPORATE',3,9,32.77,-97.44,'the F-35 line · the order book is the foreign policy','+$2 income while you also own BIG YAHU (the order book); +$3 on HOUTHIS IN THE RED SEA and +$2 on SANCTIONS (somebody needs more planes). LIBERATE OIL: with BIG YAHU and DONALD TRUMP, see BIG YAHU.',{w:[['w_bigyahu',2]],e:{houthis:3,sanctions:2}}),
mk('cushing',['CUSHING, OKLAHOMA','THE OIL CROSSROADS'],'🛢️','COMMODITY',2,6,35.9851,-96.7676,'pipeline crossroads · the WTI delivery point','+$5 when OIL SPIKES, DOUBLED to $10 if you also own the CRUDE OIL PIT (the barrel has to land somewhere).',{e:{oilspike:5},x2:'oil'}),
mk('knox','FORT KNOX','🥇','COMMODITY',2,6,37.89,-85.96,'audit pending since 1974','+$5 on GOLD RUSH. +$2 income while you also own the GOLD-COLOURED COINS (the gold is, allegedly, there).',{e:{goldrush:5},w:[['gold',2]]}),
mk('malago','MAR-A-LAGO','⛳','WILD',2,7,26.6773,-80.0368,'the gold-plated clubhouse','+$3 income while you also own DONALD TRUMP (the member lives here).',{w:[['trump',3]]}),
mk('area51','AREA 51','👽','WILD',1,5,37.2431,-115.793,'nothing to see here · see here','ALIEN ABDUCTION: once per game, as your action, pay $4 and 3 Intel to steal any rival’s node remotely. A coin flip decides: 50% it arrives intact, 50% it arrives as RUBBLE (nobody owns it). Not allowed on Antarctica, MADE, a holder of the Commonwealth Bank while its refusal is unused, nodes the Seed Vault protects, or the ESG Pillars owner’s holdings.',null),
mk('panama','THE PANAMA CANAL','🚢','COMMODITY',3,8,9.08,-79.68,'one lock, ten thousand invoices',
 'CHOKEPOINT: every rival who walks into this node pays you a $2 transit toll (instead of the usual $1), and on the GLOBAL EDITION map it is the gateway between North and South America.',null),
mk('pemex','PEMEX','🛢️','COMMODITY',2,5,19.4326,-99.1332,'the state oil company · the books are a mood','+$3 when OIL SPIKES; +$1 when TRUMP TWEETS TARIFFS (a neighbour has opinions).',{e:{oilspike:3,tariffs:1}}),
mk('hollywood','HOLLYWOOD','🎬','MEDIA',2,6,34.1016,-118.3267,'the sign still says it','+$2 income while you own THE BIG SHORT cinema and +$2 while you own BRAD PITT; +$3 on THE BIG SHORT SCREENING.',{w:[['bigshort',2],['brad',2]],e:{bigscreen:3}}),
mk('hdi',['THE HUMAN','DEVELOPMENT INDEX'],'📈','CHART',1,6,64.1466,-21.9426,'Iceland tops it · again · the rest of us are being polite','−1 Cortisol at the start of each of your turns (the happiest chart on the board), and +$2 on A QUIET QUARTER.',{c:-1,e:{quiet:2}}),
/* ── South America ── */
mk('milei','JAVIER MILEI','🪚','WILD',2,7,-34.6037,-58.3816,'the chainsaw · the wig · the inflation graph',
 'CHAINSAW: once per game, on your action, pay $3 and cut any one edge of the board for good (pick a node, then one of its neighbours); the savings pay you $4.',null),
mk('lithium',['THE LITHIUM','TRIANGLE'],'🔋','COMMODITY',3,7,-23.65,-67.8,'salt flats · white gold · batteries for everyone','+$2 income per other battery metal you own (LITHIUM TRIANGLE, CONGO COBALT, INDONESIAN NICKEL, BAOTOU RARE EARTHS).',{i:[[BATTERY,2]]}),
mk('codelco',['CODELCO','COPPER'],'🟠','COMMODITY',3,6,-22.3,-68.9,'the biggest hole in Chile','+$3 on COAL RUSH or GOLD RUSH (the whole metals complex lifts).',{e:{coalrush:3,goldrush:3}}),
mk('petrobras','PETROBRAS','🛢️','CORPORATE',3,8,-22.9068,-43.1729,'the oil chain, deep-sea division','+$1 income per OTHER oil node you own; +$4 when OIL SPIKES.',{i:[[OIL_ALL,1]],e:{oilspike:4}}),
mk('pdvsa','PDVSA','🚫','COMMODITY',3,4,10.4806,-66.9036,'sanctioned · yet somehow still shipping','Sanctioned, so cheap: +$5 when OIL SPIKES, but the compliance burden costs +1 Cortisol at the start of your turns.',{e:{oilspike:5},c:1}),
mk('potosi',['POTOSÍ','SILVER MINE'],'🥈','COMMODITY',2,5,-19.5836,-65.7531,'the mountain that ate eight million','+$3 on GOLD RUSH; +$1 income while you also own the GOLD-COLOURED COINS (silver is a good friend).',{e:{goldrush:3},w:[['gold',1]]}),
mk('amazon','THE AMAZON','🌳','WILD',1,6,-3.119,-60.0217,'the lungs · the ledger · the credits',
 '−1 Cortisol at the start of each of your turns (deep breaths). CARBON CREDITS: once per turn, on your action, sell the canopy for $3 per node of yours that is not a COMMODITY.',{c:-1}),
mk('easter',['EASTER','ISLAND'],'🗿','WILD',1,4,-27.1127,-109.3497,'the heads know · the heads say nothing','−1 Cortisol at the start of each of your turns (the heads are very calming).',{c:-1}),
/* ── Europe ── */
mk('boe',['BANK OF','ENGLAND'],'🏛️','REGULATOR',2,8,51.5142,-0.0885,'the Old Lady of Threadneedle Street','+$1 income per BANK you own; +$2 on BONDMAGEDDON (the gilts were here first).',{t:[['BANK',1]],e:{bondrevolt:2}}),
mk('city',['THE CITY','OF LONDON'],'🏙️','BANK',3,8,51.5133,-0.0899,'LIBOR was a vibe, not a number','+$2 income while you also own the BANK OF ENGLAND; +$3 on the RBA CASH-RATE DECISION (the rate fix pays regardless).',{w:[['w_boe',2]],e:{rates:3}}),
mk('vero',['VERO','INSURANCE'],'☂️','BANK',2,6,-31.9523,115.8613,'insured · except for that',
 'MISSILE INSURANCE: whenever ANY node is destroyed by a missile, you are paid $3 by the bank (the underwriters had read the small print), and if the node destroyed is one of YOURS, the bank pays out its full list price instead.',null),
mk('brexit','BREXIT','🇬🇧','WILD',1,6,51.1279,1.3134,'the cliffs of Dover · the border of vibes',
 'TAKE BACK CONTROL: once per game, on your action, sever any one edge of the board for the rest of the con (pick a node, then one of its neighbours; Dover, the Channel, the whole lot) — and take +1 Cortisol.',null),
mk('ecb',['THE ECB'],'💶','REGULATOR',2,8,50.1109,8.6821,'whatever it takes · for nineteen governments','+$2 on the RBA CASH-RATE DECISION and BONDMAGEDDON; +$2 income while you also own GERMAN BUNDS.',{e:{rates:2,bondrevolt:2},w:[['w_bunds',2]]}),
mk('db',['DEUTSCHE','BAHN'],'🚆','CORPORATE',2,6,50.1135,8.6732,'allegedly on time · always','DELAYS: your action, once per turn, $3: name a rival. On their next turn they move 2 steps fewer (minimum 0; no favors, no slipstream). A rival already delayed cannot be delayed again until it runs out. (“We apologise for the inconvenience.”)',null),
mk('bunds',['GERMAN','BUNDS'],'🇩🇪','CHART',1,3,52.52,13.405,'boring is the product','+$2 income while you also own the 10-YEAR MASTER CHART; +$2 on BONDMAGEDDON (the safe haven of the safe havens).',{w:[['tenyear',2]],e:{bondrevolt:2}}),
mk('greek',['THE GREEK','DEBT'],'🏺','CHART',3,2,37.9838,23.7275,'cursed · a gift that keeps giving','CURSED: pays $3 a turn at a fire-sale price, but holding it costs +1 Cortisol at the start of every turn. (The bailouts were also “temporary”.)',{c:1}),
mk('cs',['CREDIT SUISSE'],'🏔️','BANK',6,3,47.3769,8.5417,'160 years · gone in a weekend',
 'STARTS AS RUBBLE. When rebuilt it comes back as UBS, backed by the Swiss state: a BANK that pays +$3 per BANK you own (itself included) on top of its $6 income, soothes −1 Cortisol a turn, and TOO BIG TO FAIL: no ACCC file can open on your BANKING book. AT1 WIPE-OUT: once per game, your action: every rival pays you $2 for each BANK or CHART node they hold (the bondholders get nothing, you get it all).',{t:[['BANK',3]],c:-1}),
mk('bis',['THE BIS','BASEL'],'🌀','REGULATOR',1,6,47.5596,7.5886,'the central bank of central banks','+$1 income per OTHER REGULATOR you own (the committee of committees).',{t:[['REGULATOR',1,1]]}),
mk('swiss',['THE SWISS','VAULT'],'🔒','WILD',2,7,46.948,7.4474,'discretion is the product','+1 Intel on THE TAPES GO MISSING and on ANONYMOUS TIP (the vault keeps copies). NUMBERED ACCOUNT: stash any amount of cash here as your action — raids, fines, events and loans cannot touch it, and it does NOT count toward the win goal until withdrawn. Withdraw all or part as a FREE action, once per turn, from anywhere. Losing the vault never loses the money; you just cannot deposit more.',{e:{tapes:[0,1],tip:[0,1]}}),
mk('asml',['ASML'],'🔬','CORPORATE',3,9,51.4096,5.4586,'the only machine that can make the machine','+$3 income while you also own TSMC; +$2 while you own SAMSUNG (the customers queue).',{w:[['w_tsmc',3],['w_samsung',2]]}),
mk('tulip',['THE TULIP','BULB'],'🌷','COMMODITY',1,3,52.3676,4.9041,'1637 · the original bubble','+$4 on A QUIET QUARTER and +$3 on GOLD RUSH (the bubble loves a quiet room).',{e:{quiet:4,goldrush:3}}),
mk('norway',['NORWAY’S','WEALTH FUND'],'🛢️','BANK',3,9,59.9139,10.7522,'a trillion · mostly oil · politely','+$1 income per oil node you own; +$4 when OIL SPIKES.',{i:[[OIL_ALL,1]],e:{oilspike:4}}),
mk('gazprom','GAZPROM','🔥','COMMODITY',3,7,59.9876,30.1858,'the pipeline is the diplomacy','+$3 when OIL SPIKES; +$3 income while you also own NORD STREAM; +$2 while you own THE KREMLIN.',{e:{oilspike:3},w:[['w_nordstream',3],['w_kremlin',2]]}),
mk('nordstream',['NORD STREAM'],'💥','COMMODITY',2,4,54.9,15.5,'built · inspected · allegedly very quiet',
 'STARTS AS RUBBLE (the pipeline is already in pieces) and must be rebuilt before it pays; rebuilt and owned, it pays +$3 on OIL SPIKES.',{e:{oilspike:3}}),
mk('kremlin',['THE KREMLIN'],'🏰','REGULATOR',2,8,55.752,37.6175,'a very long table · nobody sits','+1 Intel at the start of your turn; +$2 income while you also own GAZPROM.',{s:1,w:[['w_gazprom',2]]}),
mk('lira',['THE TURKISH','LIRA'],'💸','CHART',1,2,39.9334,32.8597,'the line goes the other way','+$3 on BONDMAGEDDON (it was already in free fall). ERDOĞANOMICS: once per game, as your action, every rival loses 20% of their cash above $30.',{e:{bondrevolt:3}}),
mk('monaco',['MONACO','CASINO'],'🎰','WILD',2,6,43.7384,7.4246,'the house always wins · the house is a principality','+$3 on A QUIET QUARTER and on MADE PAYS OUT… PROBABLY (the house collects on everything). PUT IT ALL ON BLACK: free, once per turn, bet any amount — 47% of the time it pays double; or go ALL IN ON GREEN — 1 in 37, pays 35×. THE BIG GAMBLE: own a casino, THE PYRAMIDS and THE SISYPHUS BOULDER and, once per game on your action, every owned node is dealt out again; you lose those three and nobody is dealt all of them.',{e:{quiet:3,madeout:3}}),
/* ── Middle East & Africa ── */
mk('bigyahu',['BIG YAHU'],'🛡️','WILD',2,8,31.7683,35.2137,'the iron dome · the long coalition','+$2 income while you also own DONALD TRUMP. LIBERATE OIL: if you also own DONALD TRUMP and LOCKHEED MARTIN, once per game and as your action, divest every oil node on the board: your own oil nodes are sold back to the market at list price, and of the oil nodes your rivals own you take HALF (rounded up, the best-paying first); the rest are liberated (unowned). Every oil node nobody owned is also SEIZED by you.',{w:[['trump',2]]}),
mk('aramco',['SAUDI','ARAMCO'],'🛢️','COMMODITY',5,11,26.3,50.15,'the biggest oil on the board','+$8 when OIL SPIKES. Pays $5 a turn — the largest oil position on the board.',{e:{oilspike:8}}),
mk('malacca',['STRAIT OF','MALACCA'],'⚓','COMMODITY',3,8,2.5,101.2,'a quarter of world trade · squeezed through a drinking straw',
 'CHOKEPOINT: every rival who enters this node pays you a $2 toll (instead of the usual $1). It is the gateway between the Indian Ocean (South Asia) and the Pacific side: Singapore, South-East and East Asia.',null),
mk('hormuz',['STRAIT OF','HORMUZ'],'⚓','COMMODITY',3,8,26.57,56.25,'a fifth of the world’s oil · two miles wide',
 'CHOKEPOINT: every rival who enters this node pays you a $2 toll (instead of the usual $1), and on OIL SPIKES you collect $2 per oil node a rival owns.',null),
mk('suez',['THE SUEZ','CANAL'],'🛳️','COMMODITY',3,8,30.4574,32.3499,'the Ever Given · six days · one very big boat',
 'CHOKEPOINT: every rival who enters this node pays you a $2 toll (instead of the usual $1); once per game, in your action phase, you may BLOCK it (EVER GIVEN) until the end of next round: nobody walks in or lands there, you included.',null),
mk('burj',['BURJ KHALIFA'],'🏙️','CORPORATE',3,8,25.1972,55.2744,'828 metres of confidence','+$2 income while you also own NEOM (the floors are rented to the future).',{w:[['w_neom',2]]}),
mk('neom',['NEOM','THE LINE'],'📏','CORPORATE',1,7,28.1,35.1,'170 km long · zero metres built','+$3 income while you also own SAUDI ARAMCO (the funding round is crude).',{w:[['w_aramco',3]]}),
mk('nigprince',['THE NIGERIAN','PRINCE'],'👑','WILD',1,3,6.5244,3.3792,'a confidential business proposal',
 'ADVANCE FEE: once per turn, on your action, pay $2 and flip a coin — heads you receive $5, tails you receive nothing at all and the prince has gone silent.',null),
mk('dangote',['DANGOTE','REFINERY'],'🏭','COMMODITY',3,7,6.4474,3.9718,'the largest refinery in Africa · the queue is for petrol','+$4 when OIL SPIKES; +$2 income while you also own CUSHING, OKLAHOMA.',{e:{oilspike:4},w:[['w_cushing',2]]}),
mk('cobalt',['CONGO','COBALT'],'🔵','COMMODITY',3,6,-10.7167,25.4667,'every phone · every battery · very deep','+$2 income per other battery metal you own.',{i:[[BATTERY,2]]}),
mk('zim',['ZIMBABWE','TRILLION-DOLLAR','NOTE'],'🧾','CHART',1,2,-17.8252,31.0335,'a trillion · buys a loaf · nearly','+$3 on BONDMAGEDDON and on A QUIET QUARTER (hyperinflation is at least predictable). PRINT MONEY: once per game, as your action, gain 20% of the game’s target. Then INFLATION: every seizure on the board costs +$1 more for the rest of the game (it stacks with any later inflation).',{e:{bondrevolt:3,quiet:3}}),
mk('pyramids',['THE PYRAMIDS'],'🔺','WILD',2,6,29.9792,31.1342,'the original pyramid scheme','PYRAMID SCHEME: whenever a rival seizes a node ADJACENT (on the board graph) to any node you own, they pay you the current payout — $1, then $2, $4, $8… doubling each time it pays, capped by what they can pay — until THE BOULDER ROLLS BACK DOWN is drawn and it resets to $1. The payout is shown on the node.',null),
/* ── Asia ── */
mk('boj',['BANK OF','JAPAN'],'🏯','REGULATOR',2,8,35.6866,139.7735,'yield curve control · the rubber band',
 '+$2 income while you also own JAPAN BOND YIELDS; +$3 on BONDMAGEDDON (the curve control fails here first). CARRY TRADE (Mrs Watanabe, who now works here): on your action, borrow up to $50 against Tokyo’s zero rates; repay half as much again at the start of your next turn. Every $2 you cannot return is +1 Cortisol. One loan at a time.',{w:[['japan',2]],e:{bondrevolt:3}}),
mk('toyota',['TOYOTA'],'🚗','CORPORATE',3,8,35.0825,137.1561,'just in time · always on time','+$2 income while you also own THE BULLET TRAIN (the lines run to the minute); +$2 on A QUIET QUARTER.',{w:[['bullet',2]],e:{quiet:2}}),
mk('pboc',['THE PBOC'],'🏦','REGULATOR',2,8,39.9042,116.4074,'the reserve requirement is a mood','+$2 income while you also own the HKMA PEG; +$2 on the RBA CASH-RATE DECISION and on TRUMP TWEETS TARIFFS (it responds).',{w:[['w_hkma',2]],e:{rates:2,tariffs:2}}),
mk('evergrande',['EVERGRANDE'],'🏗️','CORPORATE',3,3,22.5429,114.0596,'the towers are very tall · and empty',
 'STARTS AS RUBBLE (the towers are, allegedly, standing but not finished). Once rebuilt and owned, it pays +$2 per CORPORATE you own (itself included).',{t:[['CORPORATE',2]]}),
mk('shenzhen',['SHENZHEN','FACTORY'],'🏭','CORPORATE',2,6,22.6,114.1,'the world’s workshop · three shifts','+$1 income per CORPORATE node you own (itself included).',{t:[['CORPORATE',1]]}),
mk('baotou',['BAOTOU','RARE EARTHS'],'🧲','COMMODITY',3,7,40.65,109.84,'the magnet in everything','+$3 when TRUMP TWEETS TARIFFS (the trade war is a magnet); +$2 income while you also own the SHENZHEN FACTORY.',{e:{tariffs:3},w:[['w_shenzhen',2]]}),
mk('bri',['THE BELT','AND ROAD'],'🛤️','WILD',2,8,34.3416,108.9398,'every road leads to a loan',
 'NEW SILK ROAD: once per turn, on your action, pay $4 to link one of your nodes to any other node it is not already joined to, with a permanent edge for everyone.',null),
mk('hsbc',['HSBC','HONG KONG'],'🏦','BANK',3,8,22.2796,114.1588,'the world’s local bank · the Hong Kong one','+$2 income while you also own the HKMA PEG; +$2 on the RBA CASH-RATE DECISION.',{w:[['w_hkma',2]],e:{rates:2}}),
mk('hkma',['THE HKMA','PEG'],'📌','REGULATOR',2,7,22.2831,114.1733,'7.80 · hold the line','−1 Cortisol at the start of each of your turns (the peg holds, the nerves hold).',{c:-1}),
mk('jensen',['JENSEN HUANG'],'🧥','WILD',2,8,25.033,121.5654,'the leather jacket · home for Computex','+$3 income while you also own TSMC. HONEYPOT: once per game, as your action, take 2 Chinese nodes for free (unowned ones first, the best-paying first; if there are not enough, a rival’s). The US stock market crashes: no US node earns income for 2 rounds, and you are banned from buying anything in South-East Asia or the USA for your next 2 turns.',{w:[['w_tsmc',3]]}),
mk('tsmc',['TSMC'],'🧠','CORPORATE',4,10,24.7804,120.9983,'the island that makes the chips','+$3 income while you also own ASML; +$2 income while you own SAMSUNG (the foundries watch each other).',{w:[['w_asml',3],['w_samsung',2]]}),
mk('samsung',['SAMSUNG'],'📱','CORPORATE',3,8,37.2636,127.0286,'chaebol · everything with a screen','+$2 income while you also own ASML; +$2 on A QUIET QUARTER.',{w:[['w_asml',2]],e:{quiet:2}}),
mk('temasek',['TEMASEK'],'🇸🇬','BANK',3,8,1.2833,103.8501,'the sovereign that owns the airline','+$2 income while you also own MARINA BAY SANDS; +$1 income per OTHER BANK you own.',{w:[['w_mbs',2]],t:[['BANK',1,1]]}),
mk('mbs',['MARINA BAY','SANDS'],'🏨','CORPORATE',3,8,1.2834,103.8607,'a ship on three towers · the casino pays','+$3 on A QUIET QUARTER and on MADE PAYS OUT… PROBABLY (the casino collects). PUT IT ALL ON BLACK: free, once per turn, bet any amount — 47% of the time it pays double; or go ALL IN ON GREEN — 1 in 37, pays 35×. THE BIG GAMBLE: own a casino, THE PYRAMIDS and THE SISYPHUS BOULDER and, once per game on your action, every owned node is dealt out again; you lose those three and nobody is dealt all of them.',{e:{quiet:3,madeout:3}}),
mk('adani',['ADANI'],'🏗️','CORPORATE',3,8,23.0225,72.5714,'ports · power · coal · allegedly','+$4 on COAL RUSH; +$2 income while you also own the COAL TERMINAL (allegedly shipped and sold).',{e:{coalrush:4},w:[['port',2]]}),
mk('bangalore',['THE BANGALORE','CALL CENTRE'],'🎧','WILD',2,5,12.9716,77.5946,'“have you tried turning it off and on”',
 'WARRANTY EXPIRED: once per turn, on your action, put a rival on hold: they lose 1 Intel (they were told it would be a ten-minute wait).',null),
mk('mdb',['1MDB'],'🦘','WILD',2,6,3.1479,101.6953,'the yacht · the paintings · the pink diamond','+$3 income while you also own PETRONAS (the fund-raising was local).',{w:[['petronas',3]]}),
mk('nickel',['INDONESIAN','NICKEL'],'🪨','COMMODITY',3,6,-2.0,121.4,'the island that powers the EV','+$2 income per OTHER battery metal you own; +$3 on COAL RUSH (the smelters run on coal).',{i:[[BATTERY,2]],e:{coalrush:3}}),
mk('kazatom',['KAZATOMPROM','URANIUM'],'☢️','COMMODITY',2,5,51.1694,71.4491,'two-fifths of the planet’s uranium','+$3 on COAL RUSH (the competition panics) and +$2 when OIL SPIKES.',{e:{coalrush:3,oilspike:2}}),
mk('baht',['THE BAHT','1997'],'📉','CHART',1,3,13.7563,100.5018,'the contagion started in Bangkok','+$3 on BONDMAGEDDON (the flu begins here). CONTAGION: whenever any player is raided, every rival of the Baht’s owner who owns a node in the region the raided player’s pawn stood in takes +1 Cortisol.',{e:{bondrevolt:3}}),
mk('baikonur',['THE BAIKONUR','COSMODROME'],'🚀','REGULATOR',2,8,45.965,63.305,'the first rocket · the first satellite · the lease is in roubles',
 'LIFTOFF: +$2 income while you own MISSILE COMMAND or the IRANIAN SHAHED DRONE (the Geography DLC supplies the payload). LAUNCH WINDOW: once per game, in your MOVE phase, pay $3 to be launched to ANY node on the board (the Qantas jet, only once, and it burns more). ESCAPE ON THE ROCKET: once per game, when you would be RAIDED, the raid is cancelled — your pawn is launched to the cosmodrome (or a node you choose) and your Cortisol drops to 5.',{w:[['geo_missile',2],['geo_shahed',2]]}),
mk('srilanka',['SRI LANKA'],'🍃','WILD',1,2,6.9271,79.8612,'in default · the tea is still excellent','Pays $1 a turn and costs almost nothing: +$3 on BONDMAGEDDON (the default was early). DEFAULT: once per game, as a free action, wipe all your debts (the IMF loan, the Bank of Japan carry trade) — and every toll you would owe this turn is free.',{e:{bondrevolt:3}}),
/* ── Oceania, polar & offshore ── */
mk('rbnz',['THE RBNZ'],'🥝','REGULATOR',1,5,-41.2866,174.7756,'a cash rate · and a kiwi','+$2 income while you also own the RBA; +$2 on the RBA CASH-RATE DECISION (the Reserve Bank of the other island).',{w:[['rba',2]],e:{rates:2}}),
mk('fonterra',['FONTERRA'],'🥛','COMMODITY',2,5,-36.8485,174.7633,'milk · a lot of it · powdered','+$3 on A QUIET QUARTER; +$2 income while you also own ANZCERTA (the dairy rides the treaty).',{e:{quiet:3},w:[['w_anzcerta',2]]}),
mk('nauru',['NAURU'],'🏝️','WILD',1,2,-0.5477,166.9209,'phosphate · a nation · a parking lot','+$3 on GOLD RUSH (everything shiny gets looked at) and +$1 income while you also own TUVALU.',{e:{goldrush:3},w:[['geo_tuvalu',1]]}),
mk('fiji',['FIJI','WATER'],'💧','CORPORATE',2,5,-17.7134,178.065,'bottled somewhere very far from here','+$2 income while you also own QUIKSTOP (the bottled water sells best at the servo).',{w:[['quik',2]]}),
/* ── Antarctica: eight stops along the ice, west to east. Only four links leave the continent (see WORLD_ROUTES). ── */
mk('aq_mbl',['MARIE BYRD','LAND'],'🧊','WILD',1,3,-79,-135,'unclaimed · nobody wanted it · nobody asked',
 'UNCLAIMED: the first player to arrive here owns it free: no action, no cost, no Cortisol (like Tuvalu). Income $1.',null),
mk('aq_chl',['TERRITORIO CHILENO','ANTÁRTICO'],'🇨🇱','WILD',1,4,-76,-88,'drawn in 1940 · overlapping on purpose',
 'DISPUTED: +$1 income for each OTHER Peninsula claim you hold (CHILE, BRITAIN, ARGENTINA). Hold two and the owner of the third takes +1 Cortisol at the start of each of your turns (you have filed a sovereignty dispute), unless someone owns THE ANTARCTIC TREATY, which settles the dispute (though anyone but its owner who holds Antarctic territory then takes +1 Cortisol a turn).',{i:[[PENINSULA,1]]}),
mk('aq_gbr',['BRITISH ANTARCTIC','TERRITORY'],'🇬🇧','WILD',1,4,-71.5,-68,'the oldest claim · the thinnest ice',
 'DISPUTED: +$1 income for each OTHER Peninsula claim you hold (CHILE, BRITAIN, ARGENTINA). Hold two and the owner of the third takes +1 Cortisol at the start of each of your turns (you have filed a sovereignty dispute), unless someone owns THE ANTARCTIC TREATY, which settles the dispute (though anyone but its owner who holds Antarctic territory then takes +1 Cortisol a turn).',{i:[[PENINSULA,1]]}),
mk('aq_arg',['ANTÁRTIDA','ARGENTINA'],'🇦🇷','WILD',1,4,-77.5,-52,'it is on the map · it is on the 50 peso note',
 'DISPUTED: +$1 income for each OTHER Peninsula claim you hold (CHILE, BRITAIN, ARGENTINA). Hold two and the owner of the third takes +1 Cortisol at the start of each of your turns (you have filed a sovereignty dispute), unless someone owns THE ANTARCTIC TREATY, which settles the dispute (though anyone but its owner who holds Antarctic territory then takes +1 Cortisol a turn).',{i:[[PENINSULA,1]]}),
mk('antarctica',['THE ANTARCTIC','TREATY'],'🐧','WILD',2,9,-80,-25,'nobody owns it · nobody pays rent',
 'THE TREATY SYSTEM: while anyone owns it, the Peninsula sovereignty disputes are settled — but only the Treaty’s owner is recognised: every OTHER player who holds any Antarctic territory takes +1 Cortisol at the start of each of their turns. It is a bloc outside the WTO’s jurisdiction: your income from the seven territorial claims is multiplied ×(1 + 0.25 per claim you own) with NO CAP (all seven: ×2.75), and no WTO file ever opens, however many you hold. UNTOUCHABLE: once you own it, no hostile takeover of it is ever possible (regulators and raids still reach it).',null),
mk('aq_qml',['QUEEN MAUD','LAND'],'🇳🇴','COMMODITY',1,5,-73,18,'a Norwegian queen · a Norwegian claim · very cold',
 '+$2 income while you also own NORWAY’S WEALTH FUND (the oil money bought a glacier).',{w:[['w_norway',2]]}),
mk('aq_aatw',['AUSTRALIAN','ANTARCTIC TERRITORY'],'🇦🇺','WILD',1,5,-73,85,'42% of a continent · filed under Canberra',
 '+$1 income per Australian or New Zealand node you own, up to $3 (the paperwork says it is basically Tasmania).',{an:[1,3]}),
mk('aq_adelie',['TERRE','ADÉLIE'],'🐧','WILD',1,4,-72,139,'France claimed a penguin colony · and a wife’s name',
 'MARCH OF THE PENGUINS: −1 Cortisol at the start of each of your turns (the penguins are not judging you; much).',{c:-1}),
mk('greenland',['GREENLAND'],'❄️','WILD',2,6,64.1835,-51.7216,'it is not for sale · apparently it is','+$3 income while you also own DONALD TRUMP (he is, allegedly, interested). MAKE AN OFFER: if you own DONALD TRUMP, once per game and as your action, force-buy Greenland from whoever owns it at its list price. The owner cannot refuse; the money goes to them.',{w:[['trump',3]]}),
mk('svalbard',['SVALBARD','SEED VAULT'],'🌱','WILD',1,6,78.2386,15.5086,'every seed on earth · in a very cold cupboard',
 'ANTI-RUBBLE: any node of yours that a missile would turn to rubble survives; once per game, you may rebuild a rubble node for free (stand on it in your action phase).',null),
mk('cayman',['THE CAYMAN','ISLANDS'],'🏝️','CORPORATE',2,6,19.3133,-81.2546,'everyone is a director here','+$2 income while you also own THE HEDGE FUND (somebody is shorting from the beach); +$1 income per BANK you own.',{w:[['hedge',2]],t:[['BANK',1]]}),
mk('bermuda',['THE BERMUDA','TRIANGLE'],'🌀','WILD',1,5,25.0,-71.0,'ships · planes · positions · all vanish',
 'THE VANISH: once per turn, on your action, you name any node and disappear from the board for the rest of the round: rivals cannot target you with any ability, and you reappear at the node you named at the start of your next turn.',null),
mk('bvi',['THE BRITISH','VIRGIN ISLANDS'],'🏝️','CORPORATE',2,5,18.4286,-64.6185,'a million companies · a very small island','+$2 income while you also own THE CAYMAN ISLANDS; +$3 on A QUIET QUARTER.',{w:[['w_cayman',2]],e:{quiet:3}}),
/* ── batch C: regulators, trade blocs, the water and the reef ── */
mk('wto',['THE WTO'],'🌐','REGULATOR',2,8,46.2292,6.1503,'the appellate body has not met since 2019 · the rulebook is a suggestion',
 'TRADE WATCHDOG: it runs its own investigation files (WTO files) into anyone who owns a trade-bloc node (THE EU SINGLE MARKET or BRICS) and holds 4 or more of its member nodes. REFER: the owner may refer a rival’s bloc file ($4, your action, once per turn) for +1 scrutiny. +$2 on TRUMP TWEETS TARIFFS (the docket is enormous).',{e:{tariffs:2}}),
mk('imf',['THE IMF'],'🆘','REGULATOR',2,8,38.8991,-77.0425,'a rescue package · with conditions · and further conditions',
 'BAILOUT: once per turn, on your action, lend a chosen rival $6 out of your own pocket. At the start of their next-but-one turn they repay you $8, or take +2 Cortisol (austerity) if they cannot, and the loan is written off. A rival can carry only one IMF loan at a time.',null),
mk('tariffwall',['THE TARIFF','WALL'],'🧱','REGULATOR',1,7,38.0,-97.0,'big · beautiful · somebody else pays for it',
 'THE WALL: name one node TYPE (a free action, once per turn, in your move or action phase). Every rival who seizes or takes over a node of that type pays $4 extra, paid to you. IMPORT DUTY: at the start of each rival’s turn they pay you $1 for every node of that type they hold (up to $4). A TARIFF WAR doubles both. The current wall is shown on the board header and in tooltips. Floats to a random open spot each game.',null),
mk('eu',['THE EU','SINGLE MARKET'],'🇪🇺','REGULATOR',2,9,50.8467,4.3525,'one market · twenty-seven opinions · a form for everything',
 'TRADE BLOC: your income from member nodes (nodes in EU countries: the ECB, Deutsche Bahn, German Bunds, the Greek Debt, ASML, the Tulip Bulb, the Rotterdam barrel yard, the Paris master chart, the Brussels Pillars, Venice) is multiplied ×(1 + 0.25 per member node you own), capped at ×2.5. Not members: the UK, Norway, Switzerland, Russia, Turkey, Iceland, Monaco. SCRUTINY: with 4 or more members a WTO file opens on you; each member beyond 3 adds +1 scrutiny at each of your turn starts, and at 3 the ruling strips you back to 3 members.',null),
mk('brics',['BRICS'],'🧮','WILD',2,8,-26.1952,28.034,'five letters · one summit · a currency that does not exist yet',
 'TRADE BLOC: your income from member nodes (nodes in Brazil, Russia, India, China and South Africa: Vale, Petrobras, Gazprom, the Kremlin, the Whistleblower, Adani, Bangalore, the PBOC, Evergrande, Shenzhen, Baotou, the Belt and Road, HSBC, the HKMA) is multiplied ×(1 + 0.25 per member node you own), capped at ×2.5. SCRUTINY: with 4 or more members a WTO file opens on you; each member beyond 3 adds +1 scrutiny at each of your turn starts, and at 3 the ruling strips you back to 3 members. Floats to a random open spot each game.',null),
mk('apple',['APPLE'],'🍎','CORPORATE',2,9,37.3349,-122.009,'a trillion dollars · an infinite loop · one very low tax rate',
 'IRISH SANDWICH: +$2 income for every tax haven you own (THE CAYMAN ISLANDS, THE BRITISH VIRGIN ISLANDS, THE BERMUDA TRIANGLE, THE SWISS VAULT, MONACO CASINO).',{i:[[TAX_HAVENS,2]]}),
mk('cruise',['THE CRUISE SHIP','“THE 3,000-BERTH','ENCLAVE”'],'🛳️','CORPORATE',2,8,41.3851,2.1734,'a floating city-state · no laws · the buffet is endless',
 'SET SAIL: during your move phase, while standing on a WATER node (a strait, island, port or sea; see the rules), pay $2 to sail to any other WATER node. The voyage ends your movement. ON THE MOVE (world map): at the start of every round the ship itself sails on and docks beside a different WATER node, its threads redrawn (anyone aboard rides along). CRUISE EMISSIONS: you take +1 Cortisol at the start of each of your turns unless you also own a REGULATOR.',null),
mk('gbr',['THE GREAT','BARRIER REEF'],'🪸','WILD',1,6,-17.9,148.2,'visible from space · bleaching quietly · tourists dispatched hourly',
 'BLOCKADE: wall off any one node until the end of next round (as the PM does). It uses your action, once per turn, unless you also own two of ALBANESE, THE GREAT BARRIER REEF and CRITICAL PATH ANALYSIS: then BLOCKADE is a FREE action that does not use your action or end your move. CORAL BLEACHING (a market event, Global Edition only) switches off the reef’s blockade and its income for the next 2 rounds, and its owner takes +1 Cortisol.',null),
mk('cpa',['CRITICAL PATH','ANALYSIS'],'📐','CHART',1,6,-35.3,149.1,'every project is on time · in the plan',
 'DELAY A PROJECT: BLOCKADE wall off any one node until the end of next round. It uses your action, once per turn, unless you also own two of ALBANESE, THE GREAT BARRIER REEF and CRITICAL PATH ANALYSIS: then BLOCKADE is a FREE action that does not use your action or end your move. Floats to a random open spot each game.',null),
mk('box',['THE 20-FOOT','BOX'],'📦','COMMODITY',2,6,51.9244,4.4777,'the box that ate the docks · the manifest says “various”',
 'CONTAINERISATION: +$1 income for every chokepoint you own (PANAMA, HORMUZ, SUEZ, MALACCA). Floats to a random open spot each game.',{i:[[WORLD_CHOKEPOINTS,1]]}),
mk('woolies',['WOOLWORTHS','SELF-CHECKOUT'],'🛒','CORPORATE',2,9,-33.7366,150.9534,'unexpected item in the bagging area · a staff member has been called',
 'AUTOMATION: every seizure you make costs $1 less (never below $1). UNEXPECTED ITEM: whenever you seize ANY node, every rival takes +1 Cortisol (a seizure ends your turn, so it fires once per turn).',null),
mk('ofw',['OVERSEAS','FILIPINO WORKERS'],'✈️','WILD',1,6,14.5995,120.9842,'the nation’s biggest export · it sends the money home · and it comes back',
 'REMITTANCES: −1 Cortisol at the start of each of your turns, and +$1 income per world REGION in which you own at least one node (capped at +$6).',{c:-1,rg:[1,6]}),
mk('anzcerta',['ANZCERTA'],'🤝','WILD',1,7,-43.5321,172.6362,'closer economic relations · the Tasman is not that wide',
 'CLOSER ECONOMIC RELATIONS: +$1 income per Australian or New Zealand node you own (this one included, capped at +$5), and the tolls you pay moving between Australian and New Zealand nodes are waived.',{an:[1,5]}),
mk('doha',['THE DOHA','ROUND'],'🕰️','WILD',1,6,25.2854,51.531,'launched 2001 · concluded: not yet',
 'START THE ROUND: once per game, on your action, open a new trade round: for your next 3 turns you collect +$2 per COMMODITY node you own, then the talks stall (they always do). The round only pays while you still hold the Doha node.',null)
];
WORLD_NODES.find(n=>n.id==='w_cs').rebuiltName=['UBS'];
/* photos for the Global Edition cards (static/GlobalEdition/, keyed by node id): the picture IS the card, like the classic nodes (cropped to fit, not stretched) */
export const WORLD_PHOTOS={cushing:'cushing-oklahoma.jpg',greenland:'greenland.jpg',cayman:'cayman-islands.jpg',bermuda:'bermuda-triangle.jpg',bvi:'british-virgin-islands.png',imf:'imf.jpg',apple:'apple.jpg',amazon:'the-amazon.jpg',aramco:'saudi-aramco.jpg',area51:'area-51.jpg',asml:'asml.jpg',bell:'wall-street-bell.jpg',bigyahu:'big-yahu.jpg',bis:'bis-basel.jpg',boe:'bank-of-england.jpg',brexit:'brexit.jpg',bunds:'german-bunds.avif',burj:'burj-khalifa.avif',city:'city-of-london.jpg',cobalt:'congo-cobalt.jpg',codelco:'codelco.png',cruise:'cruise-ship.jpg',cs:'credit-suisse.jpg',dangote:'dangote-refinery.jpg',db:'deutsche-bahn.jpg',doha:'doha-round.jpg',easter:'easter-island.jpg',ecb:'ecb.jpg',eu:'eu-single-market.jpg',fed:'federal-reserve.jpg',gazprom:'gazprom.jpg',greek:'greek-debt.jpg',hdi:'human-development-index.jpg',hollywood:'hollywood.jpg',hormuz:'strait-of-hormuz.jpg',jpm:'jpmorgan.jpg',knox:'fort-knox.jpg',kremlin:'the-kremlin.jpg',lira:'turkish-lira.jpg',lithium:'lithium-triangle.png',lockheed:'lockheed-martin.jpg',malago:'mar-a-lago.jpg',mamdani:'zohran-mamdani.avif',milei:'javier-milei.avif',monaco:'monaco-casino.jpg',neom:'neom-the-line.jpg',nigprince:'nigerian-prince.png',nordstream:'nord-stream.jpg',norway:'norway-wealth-fund.jpg',panama:'panama-canal.jpg',pdvsa:'pdvsa.jpg',pemex:'pemex.png',petrobras:'petrobras.jpg',potosi:'potosi-silver-mine.jpg',pyramids:'pyramids.jpg',sec:'sec.jpg',suez:'suez-canal-ever-given.jpg',svalbard:'svalbard-seed-vault.webp',swiss:'swiss-vault.jpg',tulip:'tulip-bulb.jpg',vero:'vero-insurance.jpg',wto:'wto.jpg',zim:'zimbabwe-dollar.jpg',mdb:'1mdb.jpg',box:'twenty-foot-box.jpg',aq_gbr:'british-antarctic-territory.webp',adani:'adani.jpg',aq_adelie:'adelie-land.jpg',antarctica:'antarctic-treaty.png',anzcerta:'anzcerta.jpg',aq_arg:'argentine-antarctica.jpg',aq_aatw:'australian-antarctic-territory.png',baikonur:'baikonur.jpg',boj:'bank-of-japan.avif',baotou:'baotou.jpg',mbs:'marina-bay-sands.jpg',bri:'belt-and-road.jpg',bangalore:'bangalore-tech-support.jpg',brics:'brics.jpg',aq_chl:'chilean-antarctic.jpg',cpa:'critical-path.png',evergrande:'evergrande.avif',fiji:'fiji-water.jpg',fonterra:'fonterra.avif',gbr:'great-barrier-reef.jpg',hkma:'hkma.webp',hsbc:'hsbc.jpg',jensen:'jensen-huang.jpg',kazatom:'kazatomprom.jpg',malacca:'strait-of-malacca.png',aq_mbl:'marie-byrd-land.jpg',nauru:'nauru.png',nickel:'indonesian-nickel.jpg',ofw:'overseas-filipino-workers.jpg',pboc:'pboc.png',aq_qml:'queen-maud-land.png',rbnz:'rbnz.jpg',samsung:'samsung.webp',woolies:'woolworths-self-checkout.jpg',shenzhen:'shenzhen-factory.jpg',srilanka:'sri-lanka.jpg',tariffwall:'tariff-wall.avif',temasek:'temasek.jpg',baht:'thai-baht.jpg',toyota:'toyota.jpg',tsmc:'tsmc.jpg'};
for(const [id,f] of Object.entries(WORLD_PHOTOS)){const n=WORLD_NODES.find(x=>x.id==='w_'+id);if(n){n.image='./static/GlobalEdition/'+f;n.crop=true;}}
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
  if(f.rg)syn+=Math.min(f.rg[1],f.rg[0]*new Set(owned.map(regionOf)).size);
  if(f.an)syn+=Math.min(f.an[1],f.an[0]*owned.filter(o=>AUSNZ.has(o.id)).length);
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

/* ───── GLOBAL EDITION map geography ───── */
/* lat/lon of the classic and Geography DLC exhibits (the world expansion carries its own `geo`). */
export const GEO_ANCHORS={
 citi:[40.7061,-74.0088],commbank:[-19.6500,134.1900],nab:[-29.0100,134.7500],anz:[-25.9000,137.6000],westpac:[-21.9000,131.5000],
 bond:[-33.8700,151.2050],hedge:[41.0262,-73.6282],rba:[-33.8680,151.2112],asic:[-34.9200,138.5950],accc:[-35.2809,149.1300],gov:[-35.3081,149.1245],
 us:[38.8977,-77.0365],japan:[35.6762,139.6503],uk:[51.5074,-0.1278],aus:[-34.9285,138.6007],tenyear:[48.8566,2.3522],infl:[-34.6,-58.45],
 cash:[-33.8700,151.2000],stock:[31.2304,121.4737],oil:[29.7604,-95.3698],oilgraph:[31.9973,-102.0779],barrels:[51.9244,4.4777],tanker:[1.2,104.5],
 petronas:[3.1579,101.7116],gold:[-30.7489,121.4660],train:[-22.0,148.2],port:[-21.2800,149.3000],bhp:[-20.3100,118.5800],forklift:[-12.4634,130.8456],
 coal:[-23.8400,151.2600],quik:[-23.7000,133.8800],market:[-33.8860,151.1570],f1:[-37.8497,144.9680],qantas:[-22.3000,136.8000],bullet:[34.6937,135.5023],
 press:[-19.2590,146.8180],fox:[40.7580,-73.9855],leak:[38.9072,-77.0369],jim:[-27.4700,153.0200],herald:[-37.8200,144.9800],bess:[38.9000,-77.0300],
 insider:[41.8781,-87.6298],photo:[-35.2900,149.1100],bigshort:[34.0522,-118.2437],news:[-27.4698,153.0251],wef:[46.8,9.8366],
 back:[36.1699,-115.1398],term:[40.7614,-73.9776],golf:[33.4735,-81.9748],whistle:[55.7558,37.6173],iface:[47.6062,-122.3321],
 school:[-33.8710,151.2070],ib:[46.2044,6.1432],mpc:[-42.8821,147.3272],sisy:[37.9060,22.8800],group:[-25.3444,131.0369],sat:[-19.4000,129.6000],
 watson:[-20.7300,139.4900],bessent:[38.8950,-77.0400],chalmers:[-27.6500,153.1000],albo:[-35.3076,149.1244],trump:[40.7624,-73.9733],bullock:[-33.8700,151.2150],
 bond007:[51.4975,-0.1357],rock:[21.3069,-157.8583],brad:[37.2090,-93.2923],jt:[-16.9200,145.7700],made:[-48.8767,-123.3933],asics:[34.6900,135.1956],toktimer:[-42.8821,147.3272],
 geo_missile:[40.0333,128.1833],geo_shahed:[35.6892,51.3890],geo_wonsan:[39.1500,127.4400],geo_pyoncity:[39.0392,125.7625],geo_pyothotel:[39.0310,125.7340],
 geo_boeing:[47.9790,-122.2020],geo_scs:[14.5,114.0],geo_stage5:[39.7900,125.7500],geo_pillars:[50.8503,4.3517],geo_venice:[45.4408,12.3155],geo_tuvalu:[-8.5211,179.1983],geo_kim:[39.0100,125.7300]
};
export function geoOf(n){return n&&(n.geo||GEO_ANCHORS[n.id])||null}
/* ───── REGIONS: the graph of the GLOBAL EDITION map is built region by region ─────
   Neighbours only link up INSIDE a region; the regions are joined by the curated routes below, and the chokepoints are the
   gateways: Panama (the two Americas), Suez (Europe, the Middle East and Africa), Hormuz (the Gulf and South Asia),
   Malacca (South Asia and South-East Asia), and Antarctica (a long ice road that only touches South America, Africa, Australia and New Zealand at its four ends). Europe and North America
   touch ONLY through Iceland and Greenland. */
export const REGION_NAMES={NAM:'North America',SAM:'South America',EUR:'Europe',ME:'Middle East',AFR:'Africa',CAS:'Central Asia',SAS:'South Asia',SEA:'South-East Asia',EAS:'East Asia',OCE:'Australasia & Pacific',
 PAN:'Panama',SUZ:'Suez',HRM:'Hormuz',MAL:'Malacca',ANT:'Antarctica',ISL:'Iceland',GRL:'Greenland'};
const REGION_FIX={w_panama:'PAN',w_suez:'SUZ',w_hormuz:'HRM',w_malacca:'MAL',w_hdi:'ISL',w_greenland:'GRL'};
/* the regions that are single gateways: nothing floats off them and nothing else joins them by proximity */
export const GATEWAY_REGIONS=['PAN','SUZ','HRM','MAL','ANT','ISL','GRL'];
export function regionOf(n){
 if(!n)return 'OCE';
 if(REGION_FIX[n.id])return REGION_FIX[n.id];
 const g=geoOf(n);if(!g)return 'OCE';
 const la=g[0],lo=g[1];
 if(la<-60)return 'ANT'; /* the whole ice shelf: the Antarctic territories */
 if(lo>-170&&lo<-30){
  const south=lo>-130&&lo<-34&&(la<8.5||(la<12.4&&lo>-75));
  return south?'SAM':'NAM';
 }
 if(la>=24&&la<40&&lo>=44&&lo<=64)return 'ME'; /* Iran and the Gulf shore */
 if(la>=34&&lo>=-30&&lo<=60)return 'EUR';
 if(la>=12&&la<=38&&lo>=34&&lo<=64)return 'ME';
 if(lo>=-20&&lo<=52&&la<38)return 'AFR';
 if(lo>60&&lo<=95&&la<35)return 'SAS';
 if(lo>50&&lo<=95&&la>=35)return 'CAS';
 if(lo>=95&&lo<=135&&la<20&&la>-12)return 'SEA';
 if(lo>=95&&lo<=150&&la>=20)return 'EAS';
 return 'OCE';
}
/* Exhibits that are not places (screens, graphs, a boulder): they do not live in a crowded city. Each game the host drops
   every one at a random spot in an open zone below, joins it to its two nearest neighbours there, and shares the
   result through the board layout (S.boardLayout / S.boardEdges), so every client sees the same map. */
export const WORLD_FLOATING=['term','geo_stage5','stock','infl','tenyear','cash','oilgraph','iface','back','toktimer','made','sisy','photo','insider','news','w_tariffwall','w_brics','w_cpa','w_box'];
/* open ocean and sparse land: [lat, lon, radius in degrees] */
export const FLOAT_ZONES=[
 [62,100,12],[66,140,9],[46,103,6],[48,68,5],[33,88,6],    /* Siberia, Mongolia, the steppe, Tibet */
 [23,8,8],[22,25,6],[20,49,4],[0,22,6],[-22,22,5],         /* the Sahara, the Empty Quarter, the Congo, the Kalahari */
 [60,-100,10],[58,-120,7],[64,-152,5],[74,-40,7],          /* Canada, Alaska, the Greenland ice */
 [-8,-62,8],[-44,-68,4],[-24,124,5],                       /* the Amazon, Patagonia, the Gibson Desert */
 [55,85,6],[70,115,6],[14,0,6],[12,32,5],[-12,18,4],       /* more steppe and tundra, the Sahel, Sudan, Angola */
 [42,-100,5],[68,-110,6],[52,-72,5],[-14,-50,6],[-34,-64,4], /* the Great Plains, the Arctic, Quebec, the Cerrado, the Pampas */
 [24,44,4],[32,57,3],                                      /* the Arabian interior, the Iranian plateau */
 [66,75,8],[58,60,6],[-6,-70,5],[20,-6,5],[4,20,5],[50,-85,5],   /* more tundra, the Urals, the western Amazon, Mauritania, Central Africa, Ontario */
 [-26,-60,4],[8,-68,3],[40,62,4],[60,-70,4],                /* the Chaco, the Llanos, the Kazakh steppe, Labrador */
 [-17,-87,9],[-10,136,5]  /* the two slots the Antarctic ice used to take: kept so the seeded layouts stay stable (floaters drawn here mostly fall in water and are redrawn) */
];
/* ───── batch C: water, trade blocs, the Australia/New Zealand area ───── */
/* WATER nodes: straits, islands, ports and seas. The Cruise Ship sails between them. (Ids of nodes that are not on the board — the
   Geography DLC's — are simply ignored when that DLC is off.) */
export const WATER_NODES=new Set([
 'w_panama','w_hormuz','w_suez','w_malacca',                                       /* the chokepoints */
 'geo_scs','geo_tuvalu','geo_venice','geo_wonsan',                                 /* the South China Sea, Tuvalu, Venice, Wonsan harbour */
 'w_fiji','w_nauru','w_srilanka','w_easter','w_cayman','w_bvi','w_bermuda', /* islands */
 'w_svalbard','w_hdi','w_greenland','w_gbr','rock','w_mbs','w_brexit','w_nordstream','w_cruise', /* the Arctic, Iceland, Greenland, the Reef, Hawaii, Marina Bay, Dover, the Baltic, Barcelona */
 'port','tanker','barrels'                                                          /* the Docks, the Tanker Fleet, the Rotterdam barrel yard */
]);
/* TRADE BLOCS. The bloc node multiplies its owner's income from member nodes by 1 + BLOC_STEP per member held (capped at BLOC_MAX); holding
   more than BLOC_FREE members opens a WTO file on the owner: +1 scrutiny at each turn start per member beyond BLOC_FREE, ruling at the usual 3.
   A bloc marked noWto (THE ANTARCTIC TREATY) multiplies the same way but is outside the WTO's jurisdiction: no file ever opens. */
export const BLOC_STEP=0.25,BLOC_MAX=2.5,BLOC_FREE=3;
export const TRADE_BLOCS={
 w_eu:{short:'EU',book:'EU SINGLE MARKET',icon:'🇪🇺',members:['w_ecb','w_db','w_bunds','w_greek','w_asml','w_tulip','barrels','tenyear','geo_pillars','geo_venice']},
 w_antarctica:{short:'TREATY',book:'ANTARCTIC TREATY',icon:'🐧',noWto:true,noCap:true,members:['w_aq_mbl','w_aq_chl','w_aq_gbr','w_aq_arg','w_aq_qml','w_aq_aatw','w_aq_adelie']},
 w_brics:{short:'BRICS',book:'BRICS',icon:'🧮',members:['w_petrobras','w_gazprom','w_kremlin','whistle','w_adani','w_bangalore','w_pboc','w_evergrande','w_shenzhen','w_baotou','w_bri','w_hsbc','w_hkma']}
};
/* the bloc a node is a member of (or null) */
export function blocOfMember(id){for(const b of Object.keys(TRADE_BLOCS))if(TRADE_BLOCS[b].members.includes(id))return b;return null}
/* Australian or New Zealand nodes (by geography; the floating exhibits are not places and never count) */
const geoById=id=>{const n=WORLD_NODES.find(x=>x.id===id);return n?n.geo:(GEO_ANCHORS[id]||null)};
const inAusNz=g=>!!g&&((g[0]<=-9&&g[0]>=-48&&g[1]>=112&&g[1]<=154)||(g[0]<=-34&&g[0]>=-48&&g[1]>=165&&g[1]<=180));
export const AUSNZ=new Set(Object.keys(GEO_ANCHORS).concat(WORLD_NODE_IDS).filter(id=>!WORLD_FLOATING.includes(id)&&inAusNz(geoById(id))));
/* edges that cross the date line: drawn as a pair of arrows off the right edge and back in at the left */
export const WORLD_WRAPS=[['rock','w_fiji'],['w_aq_adelie','w_aq_mbl']];
/* The ONLY links between regions (everything else is a local web, see generateWorldMapBoard). Walking across the world is meant to be
   slow: the chokepoints are the gateways (Panama, Suez, Hormuz, Malacca, Antarctica), the North Atlantic corridor is the single way from
   Europe to North America (via Iceland and Greenland), and a handful of overland and island hops join neighbouring regions. There are
   no kangaroo-route shortcuts: for those there are Qantas, the Cruise Ship and Baikonur. At most one or two links per pair of neighbours. */
export const WORLD_ROUTES=[
 /* the North Atlantic corridor: Europe, Iceland, Greenland, Canada */ ['uk','w_hdi'],['w_norway','w_hdi'],['w_hdi','w_greenland'],['w_greenland','w_mamdani'],
 /* the date line: Hawaii wraps around the world to Fiji; and Hawaii's one link to the American mainland */ ['rock','w_fiji'],['rock','w_hollywood'],
 /* the South Atlantic */ ['w_petrobras','w_dangote'],
 /* Panama: the two Americas */ ['w_panama','w_pemex'],['w_panama','w_pdvsa'],['w_panama','w_amazon'],
 /* Suez: Europe, the Middle East and Africa */ ['w_suez','w_greek'],['w_suez','w_neom'],['w_suez','w_pyramids'],
 /* Hormuz: the Gulf and South Asia */ ['w_hormuz','w_burj'],['w_hormuz','w_adani'],
 /* Malacca: South Asia and South-East Asia */ ['w_malacca','w_srilanka'],['w_malacca','petronas'],['w_malacca','w_temasek'],
 /* the overland road across Eurasia: Moscow, the steppe, the Chinese north */ ['w_kremlin','w_kazatom'],['w_kazatom','w_baotou'],
 /* South-East Asia: the Pacific rim to the north, the Indonesian islands to the south */ ['geo_scs','w_hsbc'],['w_nickel','forklift'],
 /* Antarctica: eight territories chained west to east along the ice and closed into a RING by a date-line wrap (Terre Adélie to Marie Byrd Land); ONLY FOUR links leave it: the Peninsula to South America, Queen Maud Land to South Africa, the Australian Antarctic Territory to Hobart and Terre Adélie to Christchurch */
 ['w_aq_adelie','w_aq_mbl'],['w_aq_mbl','w_aq_chl'],['w_aq_chl','w_aq_gbr'],['w_aq_gbr','w_aq_arg'],['w_aq_arg','w_antarctica'],['w_antarctica','w_aq_qml'],['w_aq_qml','w_aq_aatw'],['w_aq_aatw','w_aq_adelie'],
 ['w_aq_gbr','w_milei'],['w_aq_qml','w_zim'],['w_aq_aatw','mpc'],['w_aq_adelie','w_anzcerta'],
 /* the Pacific islands */ ['w_fiji','geo_tuvalu'],['w_nauru','geo_tuvalu']
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

/* is a raw [lat,lon] on the drawn land (inside a LAND ring and outside every WATER ring)? */
const inRing=(lat,lon,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const [xi,yi]=r[i],[xj,yj]=r[j];if((yi>lat)!==(yj>lat)&&lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)c=!c}return c};
export function onLand(lat,lon){return LAND.some(r=>inRing(lat,lon,r))&&!WATER.some(r=>inRing(lat,lon,r))}
