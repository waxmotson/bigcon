# Big Con — Code-Level Test Plan

**Repository:** `waxmotson/bigcon`  
**Scope:** rules engine, game flow, multiplayer synchronisation, randomized board generation, and rules/help consistency.  
**Status:** implemented and green (2026-10-17). Sections CF/MP/DC/RM/EC/CR/RC of this plan are covered by dependency-free Node tests (92 tests: 91 pass, 1 documented skip, 0 fail, ~45 s). The Playwright E2E layer (3. Browser) is deferred, and DC-05 (host migration) is skipped because the feature does not exist. Run everything with `node --test 'tests/*.test.mjs'` (quote the glob).

## Goals

1. Detect regressions in core gameplay and win conditions.
2. Ensure the host remains authoritative and every client sees the same game state.
3. Make Cortisol, raids, economy, node abilities, and events deterministic enough to test.
4. Validate randomized boards for connectivity and reasonable access to valuable/scarce nodes.
5. Prevent the implementation, tooltips, event copy, and help panel from describing different rules.

## Current implementation considerations

The browser game currently keeps much of its logic in `index.html`. The test harness should avoid depending on the DOM wherever possible. Prefer extracting pure rule functions into a module, or expose a test-only adapter guarded from production use. Do not add test hooks that allow normal clients to mutate host state.

Relevant implementation areas include `applyIntent()`, `addCortisol()`, `raid()`, `madePay()`, `acccInvestigate()`, `generateRandomBoard()`, `rebuildAdj()`, `pubState()`, `adoptState()`, `sendAll()`, `sendTo()`, `askPlayer()`, `announceAll()`, and `revealAll()`. Names may change during refactoring; tests should target stable public rule APIs rather than line numbers.

## Execution status & engine findings

**Implemented (all uncommitted at time of writing — review before any commit):**

- `tests/helpers/harness.mjs` — shared harness: loads the entire inline `<script>` of `index.html` into a `node:vm` context with a stubbed DOM, virtual clock, and fake PeerJS connections (recorded sends, auto-acked events, scripted answers, held modals). Seeded `makeGame` retries the seat shuffle (mulberry32) until the host seats at index 0.
- `tests/smoke-engine.test.mjs`, `tests/smoke.test.mjs`, `tests/rules-smoke.test.mjs` — pre-existing smoke layer.
- `tests/cortisol-raids.test.mjs` (CR) — 14 tests; `tests/economy.test.mjs` (EC) — 20 tests.
- `tests/game-flow.test.mjs` (CF) — 13 tests including the hostile-takeover pricing (CF-06b) and the in-flight action lock.
- `tests/multiplayer.test.mjs` (MP/DC) — 12 tests + DC-05 skipped.
- `tests/board-generation.test.mjs` (RM) — 200-seed generator sweep + initGame wire checks + `pubState`→`adoptState` round-trip.
- `tests/rules-consistency.test.mjs` (RC) — 22 tests: assets/copies on disk, deck completeness, every card's `run()` on a clean table, behaviour-driven action costs, cortisol constants, win types/goal clamp, dead-reference audit.
- `tests/geo-dlc.test.mjs` (GD) — 38 tests for the Geography DLC: world rebuild both ways, 82-pin generation sweeps, missile and Shahed launchers (including correct launch origin and Tuvalu backblast), ESG vulnerability and flat takeover pricing, rubble/rebuild, board-wide synergy spacing, Intel operations, Bondmageddon chart-leader targeting, beach day, tribute income, Qantas grounding, oil crash, Stage 5 decline, full-cycle Venice Overtourism, Tuvalu claim, lobby mirroring, copy pins.

**Engine findings recorded (no production code changed; each has a pinning test):**

1. **`revealAll()` ack-gate ordering race** — the guest-side ack gate is registered only after the announcement modal's await resolves, while `sendTo` fires the `event` message first; an instant ack is dropped. Real browsers mask this with network latency; the harness acks on a retry loop. (MP/CF layer)
2. **`applyIntent()` trusts the seat index** — `pi` comes from `Net.conns.indexOf(c)` with no bounds check against `S.players.length`. Unreachable with length-matched arrays, but a hardening candidate. (MP-05)
3. **Cortisol protection quirk** — with zero or one owned node, positive cortisol changes are silently ignored (reductions always apply). Marked *rule decision required*; pinned as current behaviour. (CR-01/02/02b)
4. **`separateNodes()` does not guarantee zero overlap** — residual node-box overlaps occur on ~46% of seeds (126 pair-overlaps across 200 seeds; worst observed 5 pairs in one seed), from wall clamping plus mutual pushes. Marked *rule decision required*; the test pins a per-seed envelope of 8. (RM sweep)
5. **Health of the generated graph is good** — connectivity from Quikstop holds on every seed; path depth median 5, p95 7, max 7 (loose max 12). (RM sweep)
6. **Copy drift (partially resolved in follow-up branch)** — the help copy and source header now say 70 exhibits and the event-deck header now says 24 cards; three typo'd filenames (`oil price increease.png`, `whistelblower.png`, `us treasury yeild.png`) are shipped as the real assets. Informational; flagged by RC-01/RC-07.
7. **Dead references** — `S.owner.*`/`own()` references to the removed-node set (`econ`, `notes`, `real`, `spend`, `timeline`) survive in the source but are inert. The unreachable `scrub` action handler/UI was removed in the follow-up rules-copy branch. RC-07 guarantees no reference escapes validation entirely.
8. **Budget-night direction** — `payTo(i, amt, to)` means each rival *pays* the Treasurer $1; the copy ("the Treasurer collects") is accurate, but the transfer direction is easy to misread, so RC-03 pins it explicitly.
9. **Host migration is unimplemented (DC-05 skipped)** — disconnects fall back to the away-seat watchdog (20 s → seat auto-plays "lays low" + $1 Intel), and reclamation by playerId/displayed name restores the seat cleanly. Pinned by DC-01..DC-06.
10. **Testing note** — `deepStrictEqual` rejects structurally identical objects that originate in different `node:vm` realms (both engines create their own realm), so wire-equality assertions compare JSON serialisations — the same thing the real wire carries. (GD-12b hits this for `S.ov`.)
11. **`applyIntent()`'s synchronous prefix reaches the market event** — the intent branch runs synchronously into `finishNodeAbility → endOfTurn → card.run()`; a `quiet` deck therefore applies its +$2 (and its mood reset) *before* the intent promise yields, while the next seat's `startTurn` income lands in microtasks after. Behaviour tests pin immediate effects pre-await and chain results after `settle()` (GD layer; RC-03 tests post-await throughout, which is equivalent for its sums).
12. **Geo once-per-turn flags reset at every `startTurn`** — `geoMissiled/geoBeach/geoBoeing/geoCrash/geoStage5/geoVenice` are cleared at the top of `startTurn`, so after any action chain they read `false`. Same-turn "already used" gates are tested by restoring the flag manually (GD-06/GD-12) rather than racing the chain.

**Continuation:** the rules-copy vs gameplay-mechanics audit (2026-10-17) lives in **`docs/RULES_COPY_AUDIT.md`** — its findings are numbered **#11–#17**, continuing this ledger, in the form *copy (source, quote) → implementation (file:line) → driven behavior → verdict → rule decision*. It also extends item 6 (the initGame log tell the truth — "70 exhibits") and item 7 (full dead-ref call-site table), and corrects item 9: the away watchdog pays **$1 cash via `gain()`**, not "$1 Intel", and the seat is not lay-low (help copy drifts from both watchdog sites; see audit finding #14).

## Test strategy

Use three layers:

- **Unit tests:** pure rule functions with seeded randomness and a small fixture state.
- **Integration tests:** a host plus simulated client connections, fake timers, and deterministic prompt responses.
- **Browser/end-to-end tests:** real browser contexts for lobby, UI, disconnect/reconnect, and cross-client behaviour.

Recommended tooling, subject to repository setup: Vitest or Node's built-in test runner for extracted pure logic; Playwright for browser tests. If adding dependencies is undesirable, start with a dependency-free Node test harness and add Playwright as a separate optional CI job.

### Determinism and fixtures

- Inject or stub the random-number source for board generation, event draws, and random outcomes.
- Use fake timers for heartbeat, prompt timeouts, lock watchdogs, and reconnect windows.
- Build a canonical fixture with 2, 4, and 8 players, unique player IDs, known node owners, known adjacency, fixed money/Intel/Cortisol, and a known event deck.
- Compare deep state snapshots after each action. Ignore presentation-only fields such as animation timers.
- Every test should assert both the state change and the relevant log/event output where applicable.
- Keep a regression test for every confirmed production bug.

## 1. Core game flow

### CF-01 — Start a solo test game
**Setup:** one player; lobby's solo-test option enabled.  
**Steps:** create lobby, start game, complete a turn, reset/restart.  
**Assertions:** game starts without a remote connection; active player and phase are valid; no connection-index access crashes; reset clears old state, timers, prompts, and locks.

### CF-02 — Start a normal multiplayer game
**Setup:** 2 and 4 connected clients.  
**Steps:** start lobby and inspect all clients.  
**Assertions:** one host; each seat has one unique player identity; all clients agree on player order, turn, phase, board layout, and ownership.

### CF-03 — Legal movement
**Setup:** current player has steps and an adjacent destination.  
**Steps:** submit a legal move.  
**Assertions:** position updates once; step count decrements exactly once; host and clients converge to the same state.

### CF-04 — Illegal movement and stale actions
**Steps:** attempt a non-adjacent destination, move with zero steps, move during the wrong phase, and submit an action for a non-current player.  
**Assertions:** no state mutation; action receives a useful rejection; lock is released; subsequent legal action still succeeds.

### CF-05 — Seize an available node
**Setup:** player at an unowned node in action phase with sufficient funds.  
**Steps:** seize node.  
**Assertions:** ownership changes to the actor; funds change by the displayed price and modifiers; seizure effects run once; node is no longer available to another player.

### CF-06 — Seizure failure cases
**Steps:** insufficient money, already-owned node, wrong phase, invalid node ID, and duplicate request.  
**Assertions:** no negative or duplicated charge; no ownership overwrite; no uncaught exception; action lock always recovers.

### CF-07 — Finish a turn and collect income
**Steps:** finish movement/action, advance to next player, then complete the next round.  
**Assertions:** each player gets exactly one turn; passive income runs once per eligible turn; round, current player, phase, and steps remain consistent across clients.

### CF-08 — Event draw and resolution
**Setup:** fixed deck containing a harmless event and a choice-based event.  
**Assertions:** exactly one card is consumed; effects apply once; choice recipient is correct; cancellation/timeout follows the documented default; no stale prompt remains.

### CF-09 — Win condition
**Setup:** state one step short of victory.  
**Steps:** satisfy the final missing requirement.  
**Assertions:** game ends once, correct winner is announced to all clients, further intents are rejected, and the end state survives reconnect.

## 2. Multiplayer ordering and identity

Run the following suite with **2, 4, and 8 players**, using at least 100 seeded seat shuffles per player count.

### MP-01 — Identity remains bound to the right connection
Assert that every player index/ID maps to the intended connection after shuffling. Never assume the host is at connection index zero unless the architecture explicitly guarantees and enforces it.

### MP-02 — Broadcast reaches all and only connected peers
Send state, chat, event, and system messages. Verify host is not sent a duplicate copy of its own broadcast and each connected peer receives one copy.

### MP-03 — Private message isolation
Send a private prompt/system message to one player. Assert that no other client receives the prompt contents or response.

### MP-04 — State convergence
After each action, compare normalized host and client state: player IDs, turn, phase, positions, steps, money, Intel, Cortisol, ownership, bugs, market mood, event state, and victory state.

### MP-05 — Reordered and duplicated messages
Deliver duplicate and delayed intents/state messages. Assert actions are idempotent where required, stale actions are rejected, and clients do not roll back to an older state.

### MP-06 — Invalid client input
Send unknown action names, missing fields, invalid player targets, invalid node IDs, negative values, and malformed payloads. Assert host validation rejects them without crashing or changing state.

## 3. Disconnect and reconnect

### DC-01 — Disconnect during movement
Disconnect the active player between a movement intent and its resolution. Verify whether the action finishes or rolls back according to the chosen policy; it must not run twice. Reconnect and confirm position, steps, turn, and phase.

### DC-02 — Disconnect during a private choice
Disconnect the prompt recipient while `askPlayer()` is pending. Verify the documented timeout/default is applied once, pending prompt state is cleaned up, and the game advances.

### DC-03 — Reconnect before prompt timeout
Reconnect with the same identity before timeout. Verify prompt ownership and response routing; a response from an old connection must not resolve the prompt twice.

### DC-04 — Disconnect during non-blocking event announcement
Disconnect a client after the host sends an event announcement. Verify event effects do not depend on the client's modal being dismissed; reconnecting client receives current state and does not replay effects.

### DC-05 — Host disconnect
If host migration is unsupported, show a clear terminal/disconnected state rather than allowing guests to submit actions that appear to succeed. If supported, test migration explicitly.

### DC-06 — Timer and lock cleanup
After disconnect, reconnect, timeout, and reset, assert no orphaned timers, unresolved promises, stale acknowledgement sets, or permanently held action locks remain.

## 4. Cortisol and raids

The current `addCortisol()` implementation includes a guard that ignores positive changes when the player owns one or fewer nodes. Treat that as a rule requiring an explicit decision, not an assumed intended behaviour.

### CR-01 — Positive Cortisol with zero nodes
Apply +1 and +2. Assert behaviour matches the approved rule, remains within 0–9, and logs the actual applied amount.

### CR-02 — Positive Cortisol with one node
Repeat CR-01. Specifically assert whether the one-node protection applies; this test should fail if implementation and approved rules disagree.

### CR-03 — Positive Cortisol with multiple nodes
Apply +1, +2, and a large increment. Assert correct clamp at 9 and no off-by-one behaviour.

### CR-04 — Cortisol reductions
Apply negative changes at 0, 1, and higher values. Assert it never falls below zero and reduction is not blocked by a positive-change protection rule.

### CR-05 — Event modifiers
Test the Big Bessent / The Jim reduction and Herald Intel effect for event-sourced Cortisol. Assert modifiers apply only under their intended conditions and Intel is awarded at most once.

### CR-06 — Raid threshold
Test Cortisol values 7, 8, and 9 followed by +1, plus an increment that crosses the threshold. Assert exactly one raid occurs when the approved threshold is reached.

### CR-07 — Raid side effects
Assert the two highest-income owned nodes (with deterministic tie-breaking) are seized; bugs are removed; the fine is correct; Intel is reduced to 1 when applicable; Cortisol resets to 0; `raided` is set; and raid bonuses/event announcement occur once.

### CR-08 — Raid with zero or one owned node
Assert no crash and no duplicate seizure. Verify fine and account-penalty behaviour matches the rules when there are no nodes to seize.

### CR-09 — Recovery turn
On the raided player's next turn, verify no income and one movement step according to the stated rules; verify normal income and movement resume on the subsequent turn.

## 5. Economy and victory

### EC-01 — MADE payout
With MADE owned, run `madePay()`. Assert owner receives $10 and 1 Intel once. For each opponent, verify the 15% cash transfer only when they have more than two nodes and at least $50; assert rounding and payment bounds.

### EC-02 — MADE payout edge cases
Test no owner, owner with maximum relevant resources, opponents at $49/$50, opponents with 2/3 nodes, and zero-dollar rounded cuts. Ensure the node description, help text, logs, and implementation agree.

### EC-03 — Repeated Sisyphus pushes
Test the first several pushes with a deterministic state. Assert the payout sequence matches the approved design, the push has no unintended Cortisol cost, and the amount does not overflow numeric/state/UI limits. Add a long-run test to make exponential growth and any intended cap/reset explicit.

### EC-04 — Passive income and synergies
For each income component, test baseline salary, node income, chart modifiers, industry counts, pair synergies, market mood modifiers, and bug skims. Assert total equals the sum of eligible components and each modifier is applied exactly once.

### EC-05 — Income timing
Verify income is awarded at the intended point in the turn, not on game start, turn reset, reconnect, or duplicate state delivery. Verify raided players' skipped-income turn is respected.

### EC-06 — Victory predicate for every required type
Create a table-driven test with one fixture per each of the seven required node types. For each type, assert that one owned node satisfies only that type, that missing any one type blocks victory, and that acquiring the final missing type wins only when the cash threshold is also satisfied.

### EC-07 — Victory edge cases
Test exactly at and one unit below the cash threshold; node divestment/removal after near-victory; simultaneous apparent win conditions; and actions received after game over. Winner selection must be deterministic and documented.

### EC-08 — ACCC concentration
Test 0–2 and 3+ holdings for each configured industry, overlapping industry groups, the Mark Watson exception, and cases where there are fewer rivals than divested nodes. Assert each node is transferred at most once, remaining nodes return to market, and fines are calculated correctly.

## 6. Random map validation

Use seeded generation to make failures reproducible. Run at least **1,000 seeds** in CI if runtime permits; otherwise run 100 in PR CI and 1,000 nightly.

### RM-01 — Node and edge integrity
Every expected node appears exactly once; every edge references two distinct existing nodes; no duplicate undirected edges; no self-loops; coordinates and rotations are finite.

### RM-02 — Connectivity
Run BFS/DFS from every node. All intended playable nodes must be reachable from the starting node unless the rules explicitly allow isolated nodes.

### RM-03 — Adjacency consistency
Assert `rebuildAdj()` produces symmetric adjacency for undirected edges and that movement legality uses the same graph as rendering.

### RM-04 — Spacing and overlap
Check node bounding boxes or circles against minimum spacing. Account for the actual rendered node size and viewport scale; log seeds that produce overlaps or unreadable crossings.

### RM-05 — Path-length distribution
Record shortest-path distances from Quikstop to every node and summarize min/median/max and distribution by node category. Set acceptable thresholds based on playtest data, not arbitrary assumptions.

### RM-06 — Valuable-node placement
Measure access to each node in `HIGH_VALUE_NODE_IDS`. Confirm prized nodes are placed as intended and that assignment does not duplicate or omit positions.

### RM-07 — Scarce type availability
For every required victory type, verify at least one valid instance exists and is reachable. Check whether starting position and player order create systematic first-mover advantages.

### RM-08 — Layout/state round trip
Serialize a generated layout and edges, apply them on a guest, and compare node coordinates, rotations, and adjacency. Confirm a late join/reconnect sees the same board.

### RM-09 — Distribution fairness
Across many seeds, compare player start options and distance to valuable nodes. Report outliers and compare seat advantage by player index; do not require every random board to be identical.

## 7. Rules and UI consistency

Create a canonical rule registry for node abilities, event cards, costs, modifiers, and victory conditions. Where feasible, generate tooltips/help content from that registry rather than maintaining duplicated prose.

### RC-01 — Node inventory coverage
Enumerate every node in `NODES`. For each node, require a stable ID, display name, price/cost, income, ability definition (or explicit “no active ability”), and a corresponding help/tooltip entry where applicable.

### RC-02 — Event inventory coverage
Enumerate every event card/deck entry. Ensure its effect handler exists and its description explains trigger, target, cost, duration, and relevant edge cases.

### RC-03 — Cost and requirement consistency
Compare displayed action cost and requirements with host-side validation for seizure, movement abilities, Intel abilities, audits, leaks, divestment, and any other activated action.

### RC-04 — Cortisol and raid wording
Verify every reference to the raid threshold, Cortisol protection, raid effects, and recovery turn matches the approved constants and implementation.

### RC-05 — MADE and Sisyphus wording
Verify MADE eligibility, payout amount, Intel, opponent loss conditions, and frequency. Verify Sisyphus growth/reset/cost rules. These descriptions must be updated together with code changes.

### RC-06 — Victory copy
Check the help panel, in-game status, end screen, and any onboarding text all describe the same cash threshold and all seven required node types.

### RC-07 — Automated drift check
Prefer structured metadata tests over brittle string scraping. If the UI still embeds prose in HTML, add a temporary audit script that flags missing node IDs, missing event handlers, stale numeric thresholds, and conflicting duplicated rule strings for manual review.

## 8. Geography DLC (GD)

Twelve extra exhibits (`GEO_NODES`) behind a host-toggled lobby flag (`S.dlcGeo` / `Net.dlcGeo`). `rebuildWorld(geo)` swaps the node set, `WORLD_EDGES` unions `GEO_EDGES` when on, and the flag travels with every state payload (`pubState` serialises it; `adoptState` rebuilds the world before render). All behaviour lives in `tests/geo-dlc.test.mjs` and uses the `quiet` deck exactly like RC-03.

### GD-01 / GD-01b — World rebuild & node integrity
`rebuildWorld(false)` restores the classic 70-exhibit world (NMAP rebuilt, not accumulated; high-value set rebuilt); `rebuildWorld(true)` deals 82 with every `GEO_EDGES` pair present and every `GEO_HIGH_VALUE_IDS` pin seeded far out. Each GEO node is structurally complete with a shipped asset under `./static/GeographyDLC/`.

### GD-02 / GD-14 — The 82-pin board
`initGame` with the flag deals 82 connected pins on every probed seed (log tells the table the DLC is live, no rubble on a fresh world); a 30-seed generator sweep keeps the DLC board a valid collage (every geo pin plotted, no mutual overlaps, fully walkable).

### GD-03..GD-05 — MISSILE COMMAND
Strike ($4 + 1 Intel, once/turn): owned target ⇒ expropriated with NO payout; either way the pin becomes rubble (no income, nothing to seize). Guards: no self-strike, ESG does NOT shield holdings and the Pillars themselves are valid targets, rubble unstrikeable, no charge on refused launches. Rebuild on-site pays exact list price, returns the node UNOWNED, and the Pyongyang Hotel skims $2 kickbacks off every rebuild.

### GD-06..GD-09 — Passive incomes & the Boeing
Wonsan beach day: free −2 Cortisol, once/turn, on-site only. Pyongyang City: +$1 income per owned GEO node (and note the base-game westpac/REGULATOR pairing — the missile site is a regulator, GD-07 pins the interaction). The Corporate Boeing: SHUT DOWN QANTAS ($4, once/turn) grounds the jet through the current and next two turns — nobody flies it, its owner's Qantas income is $0 — and a Boeing owner cannot ground their own airline.

### GD-10..GD-11b — Crash & decline
Oil crash ($3, once/turn): PANIC mood (logged before the quiet card calms it), every player pays $2 per owned oil node, Pillars holders exempt (and the Pillars pin itself still pays its $1 income). The Pillars themselves remain valid missile targets and do not block Overtourism. Stage 5 (2 Intel, once/turn): the richest *other* player makes no income of any kind on their next turn; the call is consumed at their next `startTurn`; ESG-rich seats cannot be declined; a one-seat table has no call.

### GD-12..GD-12c — Venice
Gondola therapy: free −1 Cortisol on-site. Overtourism ($2, once/turn, *either/or* with the gondola): targets any rival-owned standing pin, including ESG holdings; applies +1 Cortisol on the target owner's next turn during one full table rotation, even when that target has already acted in the current rotation. It expires when the Venetian owner begins their next turn, and also clears if Venice changes hands or the target pin is removed. Rubble remains an invalid target.

### GD-13 — Tuvalu
THE JOIN IS FREE: the first arrival auto-claims (no action, no cost, no Cortisol) via `doMove` and `doFly`; later arrivals pay the ordinary toll; rubble is unclaimable.

### GD-15 / GD-16 — Lobby & copy
The checkbox is host-gated (guest flips are refused and mirrored); the welcome and lobby payloads carry `dlcGeo`; adopting a geo state rebuilds the guest world. Help copy: v1.12, "82 exhibits" on / "70 exhibits" off; the Shahed launcher is documented alongside MISSILE COMMAND.

### GD-17..GD-24 — Geography wave 2 (dual launchers, probe, reflection, blockade, Kim, map spacing, ASIC, projectiles)
- **GD-17** — either owned launcher (MISSILE COMMAND or SHAHED DRONE) arms on-site; owning KIM JONG UN permits either to fire from anywhere. A player cannot own both launchers. Projectile origin and Tuvalu backblast use the actual launcher held, not a hard-coded silo coordinate.
- **GD-18** — striking a REGULATOR schedules `S.missileProbe={by}` at the strike; it resolves on the striker's NEXT `startTurn` BEFORE the caution flag is read, so a 50% indictment runs the full `raid(striker)` and its caution bites that same turn (the `p.raided=0` reset at the end of startTurn wipes the flag, by design). Either verdict adds +1 Cortisol via a direct set (bypasses `addCortisol`'s ≤1-node guard). Seeded via `makeRng`/`withSeedAsync`.
- **GD-19** — a warhead at TUVALU reflects: Tuvalu never burns, the actual launcher used (MISSILE COMMAND or SHAHED DRONE) is expropriated to rubble (custom backblast log), and the warhead lands on a random launcher-owner pin (pool excludes rubble, the launcher, and Tuvalu; empty if no other holdings remain). Reflected strikes use `strikeNode(...,{silent:true})` — no probe cascade.
- **GD-20** — BLOCKADE (Albanese, base-game, not DLC-gated): free, once per player-turn, action phase only, consumes the turn; expiry `S.blockades[id]=S.turn+S.players.length` while `blockades[id]>S.turn` = exactly one rotation; blocks walkers, the jet and the owner; income and missiles unaffected; rubble and already-walled pins refused. A walled Tuvalu cannot be free-claimed.
- **GD-21** — KIM JONG UN: WILD, income 0, $6, `nk_kimjongun.png` on disk; +1 Intel at each startTurn ("the Supreme Leader briefs you"), Toktimer-style; remotely arms either missile launcher.
- **GD-22** — strategic and Cortisol-relief nodes are distributed across the map with max-min placement; the old fixed Pyongyang ring is removed. Verify across 12 seeds that the high-value set (including Venice, both launchers, Kim, Wonsan, Pyongyang City, Stage 5 and base-game relief nodes) is not clustered; max-min selection can choose from the full remaining board rather than a restricted band.
- **GD-23** — MONETARY POLICY concentration (charts counted) is policed by ASIC as MARKET MANIPULATION: the card carries `./static/asic.png` and the ASIC titles; mechanics unchanged (33% gate, 20% cash+Intel fines, divestment). Other industries keep the ACCC face.
- **GD-24** — projectile fx: `projFx(kind,fromId,toId)` emits `{id,proj:1,img,base,w,h,x0,y0,x1,y1,x,y}` riding `S.fx`/`pubState`; `projRig` returns `rotate(θ+base)` rightward and `scale(-1,1) rotate(atan2(dy,−dx)+base)` leftward (missile base +45°, jet base +10°); same-pin launches emit nothing; the 40-entry fx cap holds.

### GD-26..GD-29 — Intel operations and Bondmageddon
- **GD-26** — Sell ALL Intel converts the entire current Intel balance at the current mood's market rate in one action.
- **GD-27** — CORTISOL OVERLOAD costs 30 Intel and adds +6 Cortisol to one selected rival. It bypasses the ordinary one-node Cortisol immunity, still respects the 9-point cap, and can trigger the normal raid at 9.
- **GD-28** — BONDMAGEDDON is available to the Bond Desk owner once per turn; it costs $16 + 4 Intel and selects a rival with the most CHART nodes (random among ties). Four missiles target random intact holdings. If the target owns the ESG Pillars, three launches are directed at the Pillars and the fourth at another random intact holding.
- **GD-29** — ESG Pillars are a flat-price hostile takeover (flatSeize): takeover count never inflates the price above the calculated list price. The Pillars themselves remain missile-vulnerable and do not protect against Overtourism; their Oil Crash and Stage 5 protections remain.

### GD-25 — Geography wave 3 (the flight plays before the popup)
- **GD-25** — every projectile launch holds the turn open for its flight: `projFx` now returns whether a flight actually launched, and the launch sites `sync()` the payload then `await projPause()` (`PROJ_PAUSE_MS=1300` — the 1.1s SMIL flight plus a beat) before the turn rolls into whatever covers the board next. Covered on three paths: a missile strike (the impact — expropriation, rubble, the REGULATOR probe — lands after the flight, then `endOfTurn`'s MARKET EVENT card follows), the Tuvalu reflection (the warhead flies out to the island, then the reflected warhead gets its own flight home before the silent strike and the event card), and the Qantas jet (the phase holds at `move` until the jet lands, then `endMovement` opens the action phase). The pause lives in the host's turn flow only — guests receive the fx payload during the pause and the event bulletin after it, so the flight plays on every screen. Tests advance the virtual clock (`e.clock.advance(e.acc.PROJ_PAUSE_MS+100)`; Tuvalu advances twice, one per flight leg) — the GD suites that complete a strike or a flight all advance past the pause, and the mid-move Backroom leg keeps `S.phase==='move'` after it.

## CI gates and exit criteria

**Per pull request**
- All unit tests pass.
- Core flow, Cortisol/raid, MADE/Sisyphus, and victory regression tests pass.
- At least 100 seeded map generations pass integrity/connectivity checks.
- Static rule-inventory check reports no missing node/event handlers.
- Browser smoke test starts a game and completes a turn, if browser CI is available.

**Nightly / pre-release**
- 1,000+ seeded maps.
- 2/4/8-player multiplayer suite.
- Disconnect/reconnect and prompt-timeout suite.
- Longer economy simulation across multiple random seeds.
- Full browser suite in at least two browser contexts.

**Release blockers**
- Host/client state divergence after a completed action.
- Duplicate or skipped turn, event effect, payout, or raid.
- Unreachable required victory type.
- Victory predicate disagrees with documented rules.
- Private prompt contents delivered to the wrong client.
- A malformed action can crash the host or mutate an invalid target.
- Node/event rule descriptions contradict their actual implementation.

## Implementation order

1. Extract pure rules and define canonical test fixtures.
2. Add regression tests for Cortisol protection, ACCC/Watson, MADE, and Sisyphus.
3. Add core-flow and victory-predicate tests.
4. Add seeded random-map integrity and connectivity tests.
5. Add simulated host/client tests for ordering and prompt lifecycle.
6. Add Playwright end-to-end coverage and CI gates.
7. Use the rules registry to prevent future help-text drift.

**Important:** this is a plan, not a test-results report. Each assertion must be checked against an explicitly approved game rule where the current implementation and wording disagree.


### Follow-up rules-copy implementation

Branch `fix/rules-copy-and-watson-exemption` applies the maintainer's decisions from `docs/RULES_COPY_AUDIT.md`: Mark Watson now exempts the owner from COAL-industry ACCC investigations (COAL is tracked as its own industry); the MADE tooltip is corrected; unreachable Scrub UI/handler/help copy is removed; room-code, board-location, Rumor Exchange, chart-exemption and exhibit/card-count copy are corrected. Disconnection behavior remains intentionally unchanged. See the audit's follow-up status section for the item-by-item ledger. CI passed: 92 tests, 91 pass, 1 documented skip, 0 fail.

### Geography DLC implementation

Adds twelve Geography exhibits (including MISSILE COMMAND and the Iranian Shahed Drone) behind a host-toggled lobby flag that mirrors to every guest and rides with `pubState`/`adoptState`. Both missile launchers share the same $4 + 1 Intel strike and cannot be owned by the same player at once; Kim Jong Un arms either from anywhere. Missiles expropriate owned nodes with no payout and leave rebuildable rubble (rebuild = list price, returns unowned, Hotel skims $2); ESG has flat takeover pricing and can itself be missile-struck, while its owner still has the oil-crash and Stage 5 protections. Wonsan/La Serenissima sell Cortisol relief; Overtourism targets ESG too and lasts one full table rotation; the Boeing grounds Qantas for two turns; the South China Sea crashes oil; Stage 5 silences the richest seat's next income; Tuvalu joins the first arrival for free. High-value cortisol relief and strategic nodes use max-min spacing across the board. Intel adds Sell ALL, a 30-Intel +6 Cortisol overload, and Bondmageddon (four missiles at the rival with most charts; three hit ESG first if held). Version stamp v1.12 (82 exhibits on, 70 off; `BUILD_COMMIT` tracks HEAD). Full suite: **112 tests, 111 pass, 1 documented skip, 0 fail.**
