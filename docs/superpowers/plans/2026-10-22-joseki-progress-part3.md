# Joseki Progress (Part 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The trainer that leads to gaps: «Случайно» and the «Повторение» queue start deeper, near a target; the queue works by the graph cards' due dates; the review shows the progress gained; a CPU simulator checks the trainer on the real graph and weights (it measured and rejected steering the bot's moves, owner decision 2026-10-26) (spec `docs/superpowers/specs/2026-10-22-joseki-progress-part3-design.md`; part 2 spec `2026-10-20-joseki-progress-part2-design.md`; base spec `2026-10-20-joseki-progress-design.md` section 5).

**Architecture:** Server: node-indexed card arrays and level arrays for fast passes over the graph; the progress pass gains due times and due targets (the card that sets a position's due); a `trainer/` module — needs (1 − FSRS recall), habits (the player's good moves), deep starts (targets, paths, the ½ start rule, real move sequences) and `TrainerService` that the session service asks for the bot's guide and for deep starts; the card service merges the graph queue items; a per-training progress delta stored and attached to the review. Web: the delta line, the queue's graph items, the selected position's due from the progress. A CPU simulator script over the real graph and weights.

**Tech Stack:** TypeScript, better-sqlite3, ts-fsrs 5.4.2 (exact pin), Fastify, Preact, Vitest, Playwright.

> **Order (owner, 2026-10-22):** the core (Tasks 1–4) and the simulator (Task 5) first, so that the simulator can test the design on the real weights as soon as `tree:gpu` has produced them; then the sessions, the queue, the delta, the web and the end-to-end tests.
>
> **Steering removed (owner, 2026-10-26):** on the real weights the simulator showed no gain from steering the bot within the invisibility bound, at 90 days and over a year (spec section 3, notes section 3). Tasks 1–5 are done as written; Task 6 removes the steering they added (the subtree need, the weighted choice, `trainer.epsilon`, the simulator's ε grid); Tasks 7–11 are the former 6–10 without steering. The final review then removed the leftovers the steering design had in Tasks 1–4 (`ProgressResult.percentAt`, `listWeights`, `restNeed`); their mentions below are historical.

## Global Constraints

- The bot plays as now (the human net at its rank, the tenuki rule) everywhere, except on the path of a deep start: there it plays the path's moves to the target, and at a rest target it leaves the graph with a move of its natural distribution that is no edge of the node (none → its natural move). Steering the bot's moves by need was measured and removed (owner decision 2026-10-26); there is no `trainer.epsilon`.
- Need of a card: 1 without a card or for a new card, else 1 − R, R = FSRS probability of recall at the training's start (ts-fsrs, the app's scheduler parameters).
- Habit at a node of C: the shares of the moves of C's move-card reviews of the node whose move is a good edge; mistakes and moves off the edges do not count; without such reviews — the good edges' probabilities at L normalised among them (equal shares when they sum to 0).
- Deep start only in «Случайно» and the queue, with weights for L. «Случайно»: list position X ∝ reach_L(X) × Σ_{move cards t under X} reach_X(t) × need(t); then a descent from X (stop at a node of C ∝ its move card's need; an edge ∝ share × the need mass under it), part-2 shares without habits. Queue: X and the target t come from the queue; the path is a descent from X ∝ share × probability of reaching t. Start = the earliest path node v_j with Π q_i ≥ ½ over the player's nodes from v_j to t (t excluded), never above X. Setup = the path from the empty corner to the start; a tenuki in it is a pass; setup moves give no review. The bot plays the path's moves to t (a tenuki edge → the best point outside the corner); a deviation drops the path; a rest target makes the bot leave the graph at t.
- Name of a deep start: the deepest list position on the path from the empty corner to the start. Deep starts record no position card and count no start shows.
- Position due (part 3 spec 6.1): the earliest due among the cards under the position with part-2 weight > 0 at L, except rest cards at nodes where C moves; «пора повторить» when it is reached. This replaces part 2's rule.
- Queue with weights: problems as now plus (list position, colour) items; by due, the deepest first on equal due; learn-ahead as now (`LEARN_AHEAD_MS`); position cards out of the queue; «изучено» = problems + items whose due-setting card is in review stage; graph items cannot be deleted. Without weights — exactly as now.
- Review delta: «Освоено: 34 % → 36 %» for the training's position (or the whole list), whole percents unless equal after rounding (then one decimal); «Новых позиций: N» when N > 0; none without weights or for an unrecorded training.
- Simulator: CPU only, no KataGo; the natural bot; five seeds per scenario; it reports coverage, unweighted reach by band, lateness, repeats, deep starts, the subtrees after the bot's tenuki and the largest queue-target share.
- User-facing text in all six catalogs (plural forms); terms per `docs/superpowers/specs/2026-10-14-languages-glossary.md`; code, comments, commits in English; trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never name the joseki dictionaries or their sites.

---

### Task 1: Recall, level arrays, node-indexed cards, the due rule and due targets

**Files:**
- Modify: `packages/server/src/cards/schedule.ts` (+ `schedule.test.ts`)
- Modify: `packages/server/src/graph/book.ts` (+ `book.test.ts`)
- Modify: `packages/server/src/progress/compute.ts` (+ `compute.test.ts`), `packages/server/src/progress/service.ts` (+ `service.test.ts`)
- Modify: `packages/shared/src/types.ts` (`ProgressEntry.dueAt`)

**Interfaces (produced):**

```ts
// cards/schedule.ts
/** Spec (progress part 3) 2.1: the FSRS probability of recalling the card at `now` (the app's scheduler); 0 for a new card. */
export const recall: (state: FsrsState, now: Date) => number

// graph/book.ts
/** One level's probabilities: `edge` by global edge index, `rest` by node. */
export interface LevelArrays { edge: Float32Array; rest: Float32Array }
class GraphBook {
  /** Spec 3.3: the arrays of `level`, or null without it; the last four levels asked for stay decoded. */
  levelArrays(level: string): LevelArrays | null
  /** The node an edge leads to, -1 for an edge without a node. */
  edgeTarget(edge: number): number
  /** The edge is ideal or good in either dictionary. */
  goodEdge(edge: number): boolean
}

// progress/compute.ts
export interface Flow { player: Uint8Array; share: Float64Array; to: Int32Array; exit: Float64Array }
/** Part 2 spec 4.2 (the former flowOf): opponent nodes at `level` as they are, player nodes along their good edges normalised. */
export function progressFlow(graph: GraphBook, level: string, color: Color): Flow
/** The probability of reaching each node from the empty corner along `flow` (topological order). */
export function reachOf(graph: GraphBook, flow: Flow): Float64Array
/** The player's cards of one colour by node; null where there is none or it is new. */
export interface NodeCards { move: (FsrsState | null)[]; rest: (FsrsState | null)[] }
export function nodeCards(graph: GraphBook, cards: readonly GraphCard[], color: Color): NodeCards
/** Part 3 spec 6.1: the card that sets a position's due. */
export interface DueTarget { node: number; kind: GraphCardKind; state: FsrsState }
export interface ProgressResult {
  view: ProgressView
  /** By list id: the position's due-setting card; absent for a position without such a card. */
  targets: ReadonlyMap<string, DueTarget>
  /** A node's percent (Σ weight × percent / Σ weight under it); 0 without weight. */
  percentAt: (node: number) => number
}
export function computeProgress(graph: GraphBook, level: string, color: Color, cards: NodeCards, now: Date): ProgressResult

// progress/service.ts (GraphProgressService)
progress(color: Color): ProgressView           // unchanged contract, entries gain dueAt
result(color: Color): ProgressResult | null    // null without weights for the level; the same cached computation
nodeCards(color: Color): NodeCards             // cached by version
readonly version: number                       // +1 on every recordTraining that writes and every replayLevel

// shared ProgressEntry
/** Part 3 spec 6.1: the earliest due of the cards that set the position's due, ISO; null without such a card. */
dueAt: string | null
```

- [ ] **Step 1: Failing tests.**
  - `recall`: a new card → 0; a card just reviewed «Хорошо» (elapsed 0) → 1; a review-stage card at its due → within 0.005 of 0.9 (the request retention).
  - `levelArrays`: the values equal `probabilities()` for every node of `testGraph()` weights at both levels; asking alternately for two levels does not decode again (spy on `decodeWeightsLevel` through a counter, or assert identity of the returned arrays); null for an unknown level. `edgeTarget` and `goodEdge` against `edges()` on `walkGraph()`.
  - `computeProgress` (adapt the existing tests to `NodeCards` through a helper that maps keys to nodes with `graph.node(key)`): the old answers stay; `dueAt` is the earliest due among the cards with weight > 0; **a rest card at a node of the player's colour no longer makes a position due** (a player node whose only good edge has no node: its rest card due → `due: false`, `dueAt` from the other cards); `targets` names the earliest card (node and kind) — an opponent-node rest card can be a target; `percentAt` of a node equals the entry percent at list nodes.
  - Service: `progress()` builds the cards with `graph.node(key)` (a card of a key that is not in the graph is skipped); `version` grows by one per recording that wrote and per level replay.
- [ ] **Step 2: Implement.** `recall` uses the module's `scheduler.get_retrievability(toCard(state), now, false)`. `Weights` keeps a small LRU (insertion-ordered `Map`, 4 entries) instead of one level; `probabilities()` reads through it. `goodEdge` decodes `edgeCategories` once into a `Uint8Array` at first use. `progressFlow` is the former `flowOf` reading `levelArrays` (no per-node allocation). The backward pass keeps, per node, the earliest due (ms), its card node and kind: own cards are the move card at a player node and the rest card at a non-player node with exit > 0; children only along edges with `to[e] >= 0`; equal due — keep the first found. `due = dueMs <= now`. The service caches `{ result, until }` by level and colour as the view is cached now.
- [ ] **Step 3: Run** `npm test && npm run typecheck` — PASS. **Commit:** `feat(progress): due targets, node-indexed cards and level arrays`.

### Task 2: The shared walk, the move in move reviews, habits

**Files:**
- Modify: `packages/server/src/progress/record.ts` (+ `record.test.ts`), `packages/server/src/progress/repo.ts` (`MoveRaw.move`), `packages/server/src/progress/service.ts` (uses `originLength` from record.ts)
- Create: `packages/server/src/trainer/habits.ts` (+ test)

**Interfaces:**

```ts
// progress/repo.ts
export type MoveRaw = { loss: number; best: boolean; /** Part 3 spec 4: the move in the node's orientation; absent in older reviews. */ move?: ZoneMove }

// progress/record.ts
export interface WalkStep { node: number; mirrored: boolean; /** the move played there, in the node's orientation */ move: ZoneMove }
/**
 * Part 2 spec 3.1: `moves` (Black first: the colours are roles) walked from the empty corner. `steps[i]` is the node before
 * move i; `exit` the index of the move that left the graph (null while in it); `at` the node after the last move, null once left.
 */
export function graphWalk(moves: readonly Move[], corner: Corner, graph: GraphBook): { steps: WalkStep[]; exit: number | null; at: { node: number; mirrored: boolean } | null }
/** Part 2 spec 2.3 (moved from the service): the initial moves a training's origin puts on the board; null for a start the book no longer knows. */
export function originLength(settings: ResolvedSettings, starts: StartBook): number | null

// trainer/habits.ts
/** Part 3 spec 4: per node of the colour, the count of each of its good edges the player chose (aligned with its edges). */
export function habitCounts(graph: GraphBook, reviews: readonly GraphReview[], color: Color): Map<number, Float64Array>
/** The shares of a node's good edges, aligned with its edges (0 for the others); all 0 without a good edge. */
export type HabitShares = (node: number) => Float64Array
export function habitShares(graph: GraphBook, counts: ReadonlyMap<number, Float64Array>, level: LevelArrays): HabitShares
```

- [ ] **Step 1: Failing tests.**
  - `graphWalk` gives the same nodes, exits and orientations `walkTraining` used on every existing record.test case (walkTraining is rewritten on top of it; its tests stay green unchanged).
  - A move review's raw keeps `move` in the node's orientation: the same training in another corner and mirrored stores the same `move`.
  - `habitCounts`/`habitShares` on `weightedBook` with a node of White whose good edges are A, B and bad edge C: reviews A, A, B, C (and one review without `move`) → shares A 2/3, B 1/3, C 0; no reviews → the level probabilities of A and B normalised (0.3 and 0.1 → 0.75 and 0.25); both 0 → 0.5 and 0.5; a node without good edges → all 0. Reviews of the other colour and rest reviews are ignored.
- [ ] **Step 2: Implement.** `walkTraining` keeps its contract and output (the level-change replay and the card hook rely on it). `move` is the `ZoneMove` the walk already computes (`toNodeMove`); `moveRating` ignores it.
- [ ] **Step 3: Run** `npm test && npm run typecheck` — PASS. **Commit:** `feat(trainer): habits from the moves of move reviews`.

### Task 3: The natural distribution, the subtree need, the steered bot

**Files:**
- Modify: `packages/server/src/bot/choose.ts` (+ test), `packages/server/src/bot/bot.ts` (+ test), `packages/server/src/config.ts` (+ `config.test.ts`)
- Create: `packages/server/src/trainer/need.ts`, `packages/server/src/trainer/steer.ts` (+ tests)

**Interfaces:**

```ts
// bot/choose.ts
export interface NaturalMove { vertex: Vertex | 'pass'; tenuki: boolean; p: number }
/** Part 3 spec 3.2: the distribution chooseBotMove samples from (Σ p = 1). chooseBotMove itself is unchanged. */
export function naturalMoves(input: BotChoiceInput): NaturalMove[]

// bot/bot.ts
export type BotGuide = (natural: readonly NaturalMove[], rng: Rng) => MoveVertex | null
export interface BotRequest { /* … */ guide?: BotGuide }   // HumanBot: guide's move when it gives one, else chooseBotMove

// config.ts
trainer: { epsilon: number | null }   // DEFAULT_CONFIG: null; validate: null or a positive number; loadConfig merges it

// trainer/need.ts
export function cardNeeds(cards: NodeCards, now: Date): { moveNeed: Float64Array; restNeed: Float64Array }   // 1 − recall, 1 without a card
export interface NeedInput { color: Color; bot: LevelArrays; habits: HabitShares; moveNeed: Float64Array; restNeed: Float64Array }
/** Part 3 spec 2.2: N(n) for every node. */
export function subtreeNeed(graph: GraphBook, input: NeedInput): Float64Array

// trainer/steer.ts
export interface SteerInput { graph: GraphBook; node: number; mirrored: boolean; corner: Corner; need: Float64Array; restNeed: Float64Array; epsilon: number; /** a rest target: only the leaving option */ leave?: boolean }
export interface SteerOption { edge: number | null /* null: leaving the graph */; natural: number; need: number; weight: number; moves: NaturalMove[] }
export function steerOptions(natural: readonly NaturalMove[], s: SteerInput): SteerOption[]
/** Part 3 spec 3.3: an option ∝ weight, then one of its moves ∝ p. */
export function steerMove(natural: readonly NaturalMove[], s: SteerInput, rng: Rng): MoveVertex
```

- [ ] **Step 1: Failing tests.**
  - `naturalMoves`: settled corner → only the best outside point, p 1; calm → tenuki 0.05 and the zone moves 0.95 in policy proportions; sharp or joseki not started → no tenuki; an empty zone → the tenuki point (or pass) p 1; temperature 2 → zone weights ∝ √p. Over 20 000 `chooseBotMove` draws with `mulberry32(7)` the frequencies match `naturalMoves` within 0.01.
  - `subtreeNeed` on this graph (player White, bot Black, `weightedBook`): root (Black) Q16 p 0.5 → n1, R16 p 0.5 → n2, rest 0; n1 (White) one good edge R14 → n3, a leaf (rest 1); n2 (White) one good edge Q14 → n4, a leaf. With needs move(n1) 0.05, rest(n3) 1, move(n2) 0.05, rest(n4) 0.05: N(n1) = 0.525, N(n2) = 0.05. A node of White with no good edge sends everything to its rest card; a back edge's share goes to the rest card (cycleGraph).
  - `steerOptions` at the root with natural Q16 0.5 / R16 0.5 and ε 0.1: weights 0.3125 and 0.075, so Q16 is chosen with probability 0.80645 (±1e-4); equal needs everywhere → each option's weight ∝ its natural probability exactly; a natural move that is no edge goes to the leaving option with the rest card's need; the tenuki natural move maps to the node's tenuki edge when it has one, else leaves; on a node kept mirrored (walkGraph node 2) a board move maps to the mirrored edge; `leave: true` keeps only the leaving option.
  - HumanBot: with a guide that returns a move, that move is played; with a guide that returns null or without a guide, the move equals `chooseBotMove`'s for the same rng.
  - Config: `trainer.epsilon` absent → null; 0.2 kept; 0, a negative or a string → ConfigError.
- [ ] **Step 2: Implement** as the interfaces say. `steerMove` draws twice from `rng` (option, then move); when every weight is 0 it falls back to sampling `natural` by p.
- [ ] **Step 3: Run** `npm test && npm run typecheck` — PASS. **Commit:** `feat(trainer): the bot re-weighted by the need behind its moves`.

### Task 4: Deep starts — targets, paths, the ½ start, real moves

**Files:**
- Create: `packages/server/src/trainer/start.ts` (+ test)

**Interfaces:**

```ts
/** A path of the graph: nodes[0] = the list position X, nodes.at(-1) = the target; edges[i] (global) leads from nodes[i] to nodes[i + 1]. */
export interface GraphPath { nodes: number[]; edges: number[] }
/** Part 3 spec 5.2 «Случайно»: X, then the descent; null when no move card under any list position has need > 0. */
export function randomTarget(graph: GraphBook, flow: Flow, reach: Float64Array, moveNeed: Float64Array, rng: Rng): GraphPath | null
/** The weights randomTarget draws X with, by list node (for tests and the simulator). */
export function listWeights(graph: GraphBook, flow: Flow, reach: Float64Array, moveNeed: Float64Array): Map<number, number>
/** Part 3 spec 5.2 queue: the descent from `from` to `target` ∝ share × the probability of reaching the target; null when unreachable. */
export function pathTo(graph: GraphBook, flow: Flow, from: number, target: number, rng: Rng): GraphPath | null
/** Part 3 spec 5.3: the index of the start on the path (0 = X). */
export function startIndex(graph: GraphBook, path: GraphPath, habits: HabitShares, color: Color): number
/** The top-right move sequences: from the empty corner to the start (X's representative path, then the path's edges), and from the start to the target. */
export function realMoves(graph: GraphBook, path: GraphPath, start: number): { setup: ZoneMove[] }   // Task 7's fix dropped `guide`: the path is kept as node keys
/** Part 3 spec 5.5: the first list id of the deepest node with list ids among nodes[0..start]. */
export function nameOnPath(graph: GraphBook, path: GraphPath, start: number): string
```

- [ ] **Step 1: Failing tests** (small `weightedBook` graphs with hand-computed answers):
  - `listWeights` = reach(X) × (Σ over move cards under X of reach from X × need), nested list positions each with their own weight; `randomTarget` with `mulberry32` over 20 000 draws hits each (X, target) with the product of the X weight share and the descent probabilities within 0.01; a descent stops at a player node ∝ its move need and goes on along an edge ∝ share × the need mass under it.
  - `pathTo` through a transposition: two routes to t with shares 0.3·1 and 0.1·1 → 0.75 / 0.25 (±0.01 over 20 000 draws); null for a target not under `from`.
  - `startIndex`: player decisions with q = 0.4, 0.9, 0.8 at path nodes 1, 3, 5 and the target at node 6 → 2 (0.9 × 0.8 = 0.72 ≥ ½, 0.4 × 0.72 < ½); every q = 1 → 0; the last decision alone below ½ → the index right after it.
  - `realMoves` on `walkGraph()` through the mirrored node 2: placing setup + guide with `pathMoves` and walking them with `graphWalk` from the empty corner visits exactly `path.nodes` (from X on) and never leaves; a tenuki edge yields `'tenuki'`.
  - `nameOnPath`: nested list positions on the path → the deeper one at or before the start; X when no other list node is on the way.
- [ ] **Step 2: Implement.** The descent's need mass is one backward pass in topological order: mass[n] = (player node ? moveNeed[n] : 0) + Σ share[e] × mass[to[e]]. ρ for `pathTo` is a backward pass from the target (ρ[t] = 1). Orientation in `realMoves`: append an edge's move mirrored when the sequence so far reads as the mirror of the node's key (`zoneKey(pathMoves(seq), pathToMove(seq)).mirrored`).
- [ ] **Step 3: Run** `npm test && npm run typecheck` — PASS. **Commit:** `feat(trainer): deep starts — targets, paths and the start rule`.

### Task 5: The simulator

**Files:**
- Create: `scripts/trainer/sim-steps.ts` (+ `sim-steps.test.ts`), `scripts/trainer/sim.ts`
- Modify: `package.json` (`"trainer:sim": "tsx scripts/trainer/sim.ts"`)

**Interfaces:**

```ts
export interface Scenario { perDay: number; days: number; level: string; list: number /* share of the non-queue trainings from the list; the rest «Случайно» */ }
/** Part 3 spec 8.2: 3, 10 and 30 trainings a day for 90 days at 15k, 5k and 2d, half «Из списка». */
export const DEFAULT_SCENARIOS: Scenario[]
export const EPSILON_GRID: readonly number[]   // [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]
/** The natural options of an opponent node from the weights at `level`: π₀ per edge and for leaving, with the tenuki rule on the tenuki edge. */
export function weightNatural(graph: GraphBook, node: number, level: LevelArrays, josekiStarted: boolean): { edges: Float64Array; leave: number }
export interface SimResult {
  scenario: Scenario; epsilon: number | null
  kl: number; baseline: number                      // mean per in-graph bot move
  coverage: number[]                                 // the overall percent at each day's end, mean of both colours
  late: { share: number; meanDays: number }
  repeat: number                                     // share of trainings repeating the previous path from the same start
  deep: { reached: number; deviated: number }        // shares of deep starts
  tenuki: number                                     // reach-weighted percent of the subtrees after the bot's tenuki edges
}
export function simulate(graph: GraphBook, scenario: Scenario, epsilon: number | null, seed: number): SimResult
/** Part 3 spec 8.4: the smallest ε whose kl ≤ baseline in every scenario; null when none. */
export function chooseEpsilon(results: readonly SimResult[]): number | null
export function report(results: readonly SimResult[], chosen: number | null): string
```

- [ ] **Step 1: Failing tests** on a small weighted graph (`weightedBook`, two list positions, a tenuki edge) with fixed seeds:
  - ε null → kl 0; the same seed gives the same result.
  - The steered run's coverage at the last day ≥ the natural one's, strictly greater on a graph with a rare unexplored branch.
  - `weightNatural`: the tenuki edge's probability by the rule (0.7 → 1; 0.3 → 0.05, the others scaled to 0.95; before the joseki starts → 0).
  - `chooseEpsilon` on hand-made results picks the smallest passing ε, null when none passes.
  - `report` names the chosen ε and every metric per scenario.
- [ ] **Step 2: Implement** the model of spec 8.2 on node indices with the server's own functions (`progressFlow`, `reachOf`, `computeProgress` with `NodeCards`, `cardNeeds`, `subtreeNeed`, `habitShares` from the model's counts, `steerOptions`-equivalent weights from `weightNatural`, `randomTarget`, `pathTo`, `startIndex`, `schedule`, `recall`):
  - the model's cards are the app's (`schedule` with its ratings); a node with a card: recall with probability R → the last good edge played there («Хорошо»), else (and at a new node) an edge by the probabilities at the level normalised over the edges — good «Хорошо», other «Снова»; the rest card at the exit — new → «Трудно» (the first-time rule), else «Хорошо» with probability R, «Снова» otherwise;
  - time: each day's trainings start at 18:00, two minutes apart; first the queue (problems are not modelled) while it serves, learn-ahead included, then list and random alternately by the scenario's share; the colour of each training random;
  - kl per bot move: KL(π ‖ π₀ at B); the baseline: the mean of KL(π₀ at B ± 1 ‖ π₀ at B) over the neighbours that exist, π₀ floored at 1e-9 and renormalised;
  - `sim.ts`: reads `packages/server/bases/joseki-graph.bin` and `joseki-weights.bin` (exits with a message when the weights are missing), runs every scenario for every ε of the grid and for null, prints progress lines, writes the report to stdout and to `--out` when given; `--scenario`, `--days`, `--seed` narrow a run.
- [ ] **Step 3: Run** `npm test && npm run typecheck` — PASS; time one scenario on the real graph with stub uniform weights (the weights file is not in the repo yet) and put the timing in the task report. **Commit:** `feat(trainer): the simulator that picks the steering strength`.

### Task 6: Remove the bot steering

**Files:**
- Modify: `packages/server/src/trainer/need.ts` (keep `cardNeeds`; remove `subtreeNeed`, `NeedInput`), `packages/server/src/trainer/steer.ts` (replace the weighted choice with `leaveMove`), `packages/server/src/config.ts` (remove `trainer.epsilon`), their tests, `scripts/trainer/sim-steps.ts`, `scripts/trainer/sim.ts`, `scripts/trainer/sim-steps.test.ts`
- Keep: `naturalMoves` (bot/choose.ts), `BotGuide` (bot/bot.ts), habits, deep starts — the deep starts and their guide still need them.

**Interfaces:**

```ts
// trainer/steer.ts (the file may be renamed to trainer/leave.ts)
export interface LeaveInput { graph: GraphBook; node: number; mirrored: boolean; corner: Corner }
/** Part 3 spec 5.4: a natural move that is no edge of the node, ∝ p; null when every natural move is an edge's. */
export function leaveMove(natural: readonly NaturalMove[], at: LeaveInput, rng: Rng): MoveVertex | null
```

- [ ] **Step 1: Remove** the weighted choice (`steerOptions`, `steerMove`, `SteerInput`, `SteerOption`), `subtreeNeed` and `NeedInput`, `trainer.epsilon` (DEFAULT_CONFIG, merge, validation; a config file that still has it loads without error and ignores it), and in the simulator the ε dimension: the `--epsilons` option, the KL and bound measures, `chooseEpsilon`, `EPSILON_GRID`, «Chosen ε» in the report; the simulator runs the natural bot only and keeps every other measure, option and test that does not concern ε.
- [ ] **Step 2: `leaveMove`** — the move mapping is the one the walk uses (`toNodeMove` and `sameZoneMove`; tenuki maps to the node's tenuki edge when it has one); tests: a natural move off the edges is drawn ∝ p among those; every natural move an edge's → null; the tenuki natural move counts as leaving only when the node has no tenuki edge; a mirrored node.
- [ ] **Step 3: Run** `npm test && npm run typecheck` — PASS; the simulator's CLI smoke run (2 days) prints its report. **Commit:** `refactor(trainer): drop the bot steering`.

### Task 7: TrainerService and the session

**Files:**
- Create: `packages/server/src/trainer/service.ts` (+ test)
- Modify: `packages/shared/src/types.ts` (`StartRef.graph`, `SessionSettings.queue`), `packages/server/src/session/service.ts` (+ tests in `session/starts.test.ts`, `session/service.test.ts`), `packages/server/src/progress/record.ts` (`originLength` for graph starts), `packages/server/src/cards/service.ts` (no position card for a graph start), `packages/server/src/store/repo.ts` (`startShows` skips graph starts), `packages/server/src/app.ts`

**Interfaces:**

```ts
// shared
export interface StartRef { /* … */ /** Part 3 spec 5: a start the trainer chose deeper in the graph. */ graph?: GraphStartRef }
export interface GraphStartRef {
  /** The number of initial moves (the setup): a replay from move N has more, and is neither guided nor recorded. */
  setup: number
  /** The keys of the path's nodes after the start, one per path move, the target last (Task 7 fix: followed by the graph, so a mirror-equivalent move at a symmetric node keeps it). */
  path: string[]
  /** The target is a rest card: the bot leaves the graph once the path is played. */
  leave: boolean
}
export interface SessionSettings { /* … */ /** Mode 'list', a colour of B or W: the queue's start of the position by its due card. */ queue?: boolean }

// trainer/service.ts
export interface GraphStart { setup: ZoneMove[]; path: string[]; leave: boolean; nameId: string }
export interface TrainerDeps { graph: GraphBook; progress: GraphProgressService; repo: GraphCardRepo; starts: StartBook; config: AppConfig; now?: () => Date; rng?: Rng }
export class TrainerService {
  /** Part 3 spec 5.2 «Случайно»; null without weights for the player's level or with nothing to learn. */
  randomStart(color: Color): GraphStart | null
  /** Part 3 spec 6.3; null without weights or without a due-setting card of the position. */
  queueStart(listId: string, color: Color): GraphStart | null
  /** Part 3 spec 5.4: the bot's guide on a deep start's path, or null when the bot plays as now. */
  guideFor(rec: SessionRecord): BotGuide | null
}
```

- [ ] **Step 1: Failing tests.**
  - `guideFor` returns null for: a session without a graph start, traps, a replay from move N (initial moves ≠ origin), no weights for the player's level, a walk that left the graph.
  - A graph start: while the node after each move past the setup has the path's key, the bot's move is the first edge of the current node to the next path node, on the board via `fromNodeMove` (a tenuki edge → the natural tenuki point, the best outside point even when the rule's rate is 0); after the player deviates → null; after the whole path with `leave` the bot plays `leaveMove`'s move (null from it → null, the natural move).
  - A guide decides on null before it draws from `rng` (the `BotGuide` contract: a null must leave the rng untouched); habits and node cards are cached by the progress `version`.
  - Session «Случайно» with weights (`uniformWeights` over a small graph listed in a test StartBook): the initial moves are the setup placed in the corner (mirror honoured, tenuki → pass), `settings.start` has `graph` and the deep start's name; no position card is recorded for it; it does not count in `startShows`. Without weights → the base pick as now.
  - Session «Из списка» with `queue: true`: a deep start toward the position's due card; without weights or without a target → the plain list start. `validateSettings` refuses `queue` outside 'list' or with a random colour.
  - The bot's request carries the guide only outside traps.
- [ ] **Step 2: Implement.** The player's colour is the role, as `walkTraining` finds it (inverted when the first move is White's). The start functions use `progressFlow(graph, level, color)`, `reachOf`, `cardNeeds(progress.nodeCards(color), now).moveNeed` and `habitShares(graph, habitCounts(graph, repo.allReviews(), color), graph.levelArrays(level))` with `level` the player's. `SessionService` gets an optional `trainer` dep: `startPosition` asks `randomStart(resolved.userColor)` in «Случайно» and `queueStart(startId, userColor)` for `queue`; it places `setup` with `fromTopRight(mirror ? mirrorDiagonal(m) : m, corner)`, colours from Black, tenuki → `'pass'`; `StartRef` = `{ id: nameId, name/group from listStart(nameId), mirror, graph: { setup: setup.length, path, leave } }`. `botVertex` adds `guide: trainer.guideFor(s.record)` outside traps. `originLength` returns `start.graph.setup` for a graph start. `CardService.recordPosition` returns for `start.graph`. `startShows` adds `AND json_extract(start_json, '$.graph') IS NULL`. `createServices` builds the TrainerService and passes it to the sessions.
- [ ] **Step 3: Run** `npm test && npm run typecheck` — PASS. **Commit:** `feat(trainer): deep starts in sessions`.

### Task 8: The queue with weights

**Files:**
- Modify: `packages/server/src/progress/service.ts` (+ test), `packages/server/src/cards/service.ts` (+ test), `packages/shared/src/types.ts` (`DueCard`, `CardListItem`), `packages/server/src/app.ts`, `packages/server/src/api/api.test.ts`

**Interfaces:**

```ts
// progress/service.ts
export interface GraphQueueItem { listId: string; color: Color; due: string; stage: CardStage; learning: boolean; /** the list position's moves, for the tie order and the small board */ moves: string[] }
/** Part 3 spec 6.1–6.2: both colours' positions with a due-setting card; null without weights for the player's level. */
queueItems(): GraphQueueItem[] | null

// cards/service.ts
export interface CardServiceDeps { /* … */ graphQueue?: () => GraphQueueItem[] | null }

// shared
export type DueCard =
  | /* the two existing variants */
  | { card: { id: string; kind: 'graph'; startId: string; userColor: Color } }
  | { card: null; nextDue: string | null }
export interface CardListItem { /* … */ /** Part 3 spec 6.2: a position's graph item — its colour; not deletable. */ graph?: { color: Color } }
```

- [ ] **Step 1: Failing tests.**
  - `queueItems`: one item per (list position, colour) with a target; `due`, `stage` and `learning` from the target card; null without weights.
  - `CardService` with items: `summary` — position cards out; `dueNow` = due problems + due items, `dueByKind.position` = due items, `forecast` includes the items, `total` and `learned` count problems and items (an item learned when its card is in review stage), `nextDue` over both; `list` — problems and items (`id` `graph:<listId>:<color>`, `kind: 'position'`, `startId`, `moves`, `due`, `stage`, `graph.color`, `lastRating: null`, `reps: 0`, `orphan: false`); `due()` — the most overdue of problems and items, equal due → the deeper position (more moves) first, learn-ahead for items in learning steps; a graph item answers `{ kind: 'graph', startId, userColor }`; `remove('graph:…')` → `card_not_found`. Without items (null) every existing test stays green.
  - API: `GET /api/cards/due` returns the graph variant on a server with weights.
- [ ] **Step 2: Implement**; `createServices` passes `graphQueue: () => progress.queueItems()`.
- [ ] **Step 3: Run** `npm test && npm run typecheck` — PASS. **Commit:** `feat(cards): the queue by the graph cards' due dates`.

### Task 9: The progress delta of a training

**Files:**
- Modify: `packages/server/src/store/migrations.ts` (migration 008) and the migrations test, `packages/server/src/progress/repo.ts`, `packages/server/src/progress/service.ts` (+ test), `packages/server/src/review/service.ts` (+ test), `packages/shared/src/types.ts`

**Interfaces:**

```ts
// shared
/** Part 3 spec 7: the progress a training gained, for its position (or the whole list: listId null) and colour. */
export interface ProgressDelta { listId: string | null; color: Color; before: number; after: number; newPositions: number }
export interface ReviewData { /* … */ progress?: ProgressDelta }

// progress/repo.ts (GraphCardRepo)
insertDelta(sessionId: string, d: ProgressDelta): void
delta(sessionId: string): ProgressDelta | null

// progress/service.ts
deltaOf(sessionId: string): ProgressDelta | null
```

- [ ] **Step 1: Migration 008** — `graph_training_progress (session_id TEXT PRIMARY KEY, list_id TEXT, color TEXT NOT NULL CHECK (color IN ('B','W')), before REAL NOT NULL, after REAL NOT NULL, new_moves INTEGER NOT NULL)`; the migrations test lists it.
- [ ] **Step 2: Failing tests.** With weights, a recorded training stores a delta: `listId` = the start's id when it is a list position (`graph.listNode(id) !== null`), else null (free, traps, a branch start); `before`/`after` = that position's percent (or the overall percent) for the recorded colour before and after the reviews; `newPositions` = the move cards created by this recording. No delta without weights or when the training gave no review; a second `recordTraining` of the same session keeps the first delta. `ReviewService` attaches `progress` in `prepare()`'s result and in `get()`; a failing lookup is logged and the review comes without it.
- [ ] **Step 3: Implement** — `before` is read from `progress(color)` before the transaction, `after` after it (the cache is dropped by the recording).
- [ ] **Step 4: Run** `npm test && npm run typecheck` — PASS. **Commit:** `feat(progress): the progress a training gained`.

### Task 10: The web

**Files:**
- Modify: `packages/web/src/format.ts` (+ test), `packages/web/src/progress.ts` (+ test), `packages/web/src/screens/ReviewScreen.tsx`, `packages/web/src/components/RepetitionPanel.tsx`, `packages/web/src/App.tsx`, `packages/web/src/screens/RepetitionScreen.tsx`, `packages/web/src/components/StartTree.tsx`, the six catalogs `packages/shared/src/i18n/{ru,en,ja,ko,zh-Hans,zh-Hant}.ts`, `docs/superpowers/specs/2026-10-14-languages-glossary.md` (only if a new term appears)

**Interfaces:**

```ts
// format.ts
/** Part 3 spec 7: both percents whole, or with one decimal when they are equal whole. */
export function formatPercentPair(before: number, after: number, lang: Language): [string, string]
// progress.ts
export interface NodePercent { percent: number; due: number; /** a position's earliest due (the earlier of both colours) */ dueAt: string | null }
```

- [ ] **Step 1: Failing tests.** `formatPercentPair(0.34, 0.36, 'ru')` → ['34 %', '36 %'] (narrow spaces normalised as in format.test); `(0.341, 0.344)` → ['34,1 %', '34,4 %']; `(0.3412, 0.3414)` → ['34,1 %', '34,1 %']; 'en' uses '34.1%'. `aggregate`/`treeProgress` carry `dueAt` of positions (the earlier of both colours for a random colour; null for branches and groups).
- [ ] **Step 2: Implement.**
  - Review: a block at the top of the review's aside when `review.progress` is there — `review.progress.position` «Освоено: {before} → {after}» (a position) or `review.progress.overall` «Освоено во всём списке: {before} → {after}» (listId null), and, when `newPositions > 0`, `review.progress.new` (plural: «Новая позиция: {count}», «Новые позиции: {count}», «Новых позиций: {count}»). `RepetitionPanel` gets `counted?: boolean`: with it and no `info` the «не засчитано» line is not shown (a graph training of the queue keeps only the queue's buttons).
  - Queue: a `kind: 'graph'` due card starts `{ mode: 'list', environment: 'empty', userColor, botRank: lastSettings?.botRank ?? defaultRank ?? DEFAULT_BOT_RANK, corner: 'random', startId, queue: true }`.
  - «Повторение» list: a graph item's title is the tree name and the colour (`colorLabel`), no delete button.
  - «Из списка»: with progress rows, the selected position's «когда повторять» line comes from its row's `dueAt` («пора повторить» when reached, else `tree.card.next`); without rows — the position card's, as now.
  - Six catalogs; plural forms per language as the other count keys.
- [ ] **Step 3: Run** `npm test && npm run typecheck && npm run build` — PASS. **Commit:** `feat(web): the progress gained in the review and the graph queue`.

### Task 11: End to end, README, notes, calibration guide

**Files:**
- Modify: `e2e/make-graph.ts`, `e2e/progress.spec.ts` (or a new `e2e/trainer.spec.ts` on the same server), `README.md`, `docs/gpu-calibration.md` (a line that `npm run trainer:sim` runs on any machine with the weights, no GPU), `docs/superpowers/notes/2026-10-22-joseki-progress-part3-notes.md`

- [ ] **Step 1: e2e graph** — extend the progress graph with a line of four more legal zone moves under the first list position (probabilities above 0 at both levels), so that a start below the position exists; keep the existing test green.
- [ ] **Step 2: e2e tests.**
  - Queue: after one training of the first position (Black), «Повторение» shows a position to repeat (learn-ahead); starting the queue gives a training whose board has the position's stones or more and whose review shows «Освоено: … → …» with the queue's buttons.
  - «Случайно» with weights: the training starts from a graph position, its crumbs name a list position.
- [ ] **Step 3: Docs.** README: the trainer in a few lines (the deep starts, the queue by the graph, the delta, `trainer:sim` as the tool that checks it). The calibration guide: one line on `trainer:sim`. Notes: anything non-critical found on the way.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build && npm run e2e` — PASS. **Commit:** `test(trainer): end to end; docs`.
