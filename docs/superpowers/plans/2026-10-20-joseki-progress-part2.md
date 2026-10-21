# Joseki Progress (Part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every training into graph cards, compute the progress of every start position, branch, group and the whole list for the player's colour and level, show it on «Из списка», and recompute everything when the level changes (spec `docs/superpowers/specs/2026-10-20-joseki-progress-part2-design.md`; base spec `2026-10-20-joseki-progress-design.md` sections 2 and 4).

**Architecture:** Server: a migration with `graph_cards`, `graph_reviews`, `graph_seen`; `GraphCardRepo`; `GraphProgressService` (records a training by walking it through `GraphBook`, computes percents from card stabilities and the level's weights, caches per colour and level, recomputes on level change); a level-change replay that also rebuilds the position and problem cards; `GET /api/progress`. Web: a pure aggregation module over the list tree, the summary above «Из списка», bars and percents in its rows.

**Tech Stack:** TypeScript, better-sqlite3, ts-fsrs 5.4.2 (exact pin), Fastify, Preact, Vitest, Playwright.

## Global Constraints

- Graph cards never enter the «Повторение» queue and never mix with position or problem cards.
- A move card per graph node where the player's colour moves (key = the node's position key); a rest card per node and player colour. Cards store position keys, never node indices.
- A training counts unless it is a replay from move N: its initial moves must be exactly those of its origin (the list or random start's moves, the trap's setup, none for a free game). «Играть позицию заново» counts.
- Move card rating: KataGo's best move → easy, exact → good, inaccuracy → hard, mistake / blunder → again. Start moves (before the player's first move) get no review.
- Rest card rating: by the worst of the player's in-zone moves after leaving the graph and the unpunished in-zone bot mistakes after leaving: all exact → good, inaccuracy → hard, mistake / blunder / unpunished → again — except «hard» when every mistake (not inaccuracy) was made at a position met for the first time. No player move and no bot mistake after leaving → no review.
- Leaving the graph: a move not among the node's edges; an edge with `to: null`; an edge into a position already on the walk (a tenuki cycle). The walk stops there.
- Card percent: new → 0; else min(1, ln(1 + S) / ln(22)), S = FSRS stability in days.
- Position percent (spec 4.2): opponent nodes use the edge probabilities at the level as they are; their exit weight (rest + Σ `to: null` edges + Σ back edges) goes to the rest card for the colour. Player nodes: the move card with the reach weight; continue along the player's good (ideal, good) edges normalised among themselves; the share of good edges that leave the graph, or all of it without good edges, goes to the rest card. Back edges = DFS back edges from the empty corner, computed once per graph load. Reach sums over transpositions (topological order of the graph without back edges).
- Branch / group / overall = Σ(weight × percent) / Σ weights over their list positions; weight = reach from the empty corner at the level for the colour. Nested positions count separately.
- «Пора повторить»: a list position whose subtree holds a graph card with a reached FSRS due.
- Random colour: rows show the mean of both colours; the summary shows both numbers and a mean bar.
- Without weights: nothing is shown and nothing breaks; cards are still recorded.
- Level change: every review's auto rating is re-derived from its raw data with the new level's thresholds (manual ratings stay), every card's FSRS history is replayed from the start — graph cards, position cards and problem cards — in one transaction together with the config write; a failure leaves both the level and the cards unchanged.
- Recording is isolated: its failure is a log line; the review, the position and problem cards are unaffected.
- User-facing text in all six catalogs (plural forms); terms per `docs/superpowers/specs/2026-10-14-languages-glossary.md`; code, comments, commits in English; trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never name the joseki dictionaries or their sites.

---

### Task 1: Graph cards — storage and recording a training

**Files:**
- Create: `packages/server/src/progress/repo.ts`, `packages/server/src/progress/record.ts`, `packages/server/src/progress/service.ts`, tests next to them
- Modify: `packages/server/src/store/migrations.ts` (migration 006), `packages/server/src/store/repo.test.ts` (migration list), `packages/server/src/app.ts` (`AppServices.progress`), `packages/server/src/review/service.ts` (call the recorder after the card hook, isolated in its own try/catch)

**Interfaces (produced):**

```ts
export type GraphCardKind = 'move' | 'rest'
export interface GraphCard { key: string; kind: GraphCardKind; color: Color; state: FsrsState; createdAt: string }
// raw data kept for the level-change replay (spec 2.4)
export type MoveRaw = { loss: number; best: boolean }
export type RestRaw = { moves: { loss: number; key: string; seenBefore: boolean }[]; unpunished: { botLoss: number; userLoss: number; key: string; seenBefore: boolean }[] }
export interface GraphReview { id: number; cardKey: string; kind: GraphCardKind; color: Color; reviewedAt: string; sessionId: string; manual: Rating | null; auto: Rating; raw: MoveRaw | RestRaw }
export class GraphCardRepo { /* card(key, kind, color), upsert, insertReview, reviews(cardKey…), allCards(), allReviews(), markSeen(key, at), seen(key), transaction(fn) */ }
/** Spec 3.1–3.3: the reviews a training gives, as pure data (no storage). */
export function walkTraining(rec: SessionRecord, review: ReviewData, graph: GraphBook, seen: (key: string) => boolean, thresholds: Thresholds): { moves: { key: string; raw: MoveRaw; auto: Rating }[]; rest: { key: string; raw: RestRaw; auto: Rating } | null; met: string[] }
export class GraphProgressService { recordTraining(rec: SessionRecord, review: ReviewData): void /* … Task 2 adds progress(), Task 3 replayLevel() */ }
```

- [ ] **Step 1: Migration 006** — `graph_cards (key TEXT, kind TEXT CHECK (kind IN ('move','rest')), color TEXT CHECK (color IN ('B','W')), fsrs_json TEXT NOT NULL, due TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (key, kind, color))`; `graph_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, card_key, kind, color, reviewed_at, session_id TEXT NOT NULL, manual TEXT, auto TEXT NOT NULL, raw_json TEXT NOT NULL)` with an index on (card_key, kind, color, id) and a unique index on (card_key, kind, color, session_id) (one review per card per training); `graph_seen (key TEXT PRIMARY KEY, first_at TEXT NOT NULL)`. Update the migrations test (the extra test migration becomes 7).
- [ ] **Step 2: Failing tests of `walkTraining`** on the test graph fixture (`packages/server/src/graph/fixture.ts`; extend it with a branch that has a tenuki cycle, a `to: null` edge and a transposition): a walk along edges (move reviews with ratings from categories; `best` when the move is `review.positions[turn].candidates[0]`); each of the three ways to leave; the rest rating from the worst after leaving incl. an unpunished bot mistake and the «first time → hard» rule (`seen` stub); start moves give no review; the same training in another corner and mirrored gives the same keys; a replay from move N → no reviews; no player move after leaving → no rest review.
- [ ] **Step 3: Implement** `walkTraining` (pure; use `nodeOfTraining`, `toNodeMove`, `categorize` with the given thresholds), `GraphCardRepo`, and `GraphProgressService.recordTraining` (in one transaction: create missing cards with `newState`, `schedule` with the auto rating, insert reviews, mark the met positions seen; skip a card that already has a review of this session).
- [ ] **Step 4: Wiring** — `AppServices.progress`; `ReviewService` calls `progress.recordTraining(rec, review)` right after `cards.recordTraining`, in its own try/catch with a log line (as the card hook does). The thresholds come from `thresholdsFor(config.player.level, table, config.thresholds)` at recording time.
- [ ] **Step 5: Run** `npm test && npm run typecheck` — PASS. **Commit:** `feat(progress): graph cards recorded from every training`.

### Task 2: Progress — percents, aggregation, API

**Files:**
- Create: `packages/server/src/progress/compute.ts` (+ test), `packages/server/src/api/progress-routes.ts`
- Modify: `packages/server/src/graph/book.ts` (back edges and a topological order, computed once at load), `packages/server/src/progress/service.ts`, `packages/server/src/app.ts`, `packages/server/src/api/api.test.ts`, `packages/shared/src/types.ts`

**Interfaces:**

```ts
// shared
export interface ProgressEntry { percent: number; weight: number; due: boolean }
export interface ProgressView { hasWeights: boolean; level: string; color: Color; overall: { percent: number; due: number }; positions: Record<string, ProgressEntry> }
// server
export const cardPercent = (state: FsrsState | null): number  // spec 4.1
export function computeProgress(graph: GraphBook, level: string, color: Color, cards: (key: string, kind: GraphCardKind) => FsrsState | null, now: Date): ProgressView
```

- [ ] **Step 1: Failing tests** — `cardPercent` (new 0; S = 21 → 1; S = 2.37 → 0.393); `computeProgress` on small hand-made graphs with hand-computed answers: an opponent node with two edges and a rest; a player node with two good edges (normalisation) and one `to: null` good edge (its share to the rest card); a transposition (reach sums); a tenuki two-cycle (the back edge goes to the rest card, no infinite loop); a list position nested in another; the overall and a branch weight from the empty corner; `due` from a reached card due; without weights → `hasWeights: false`.
- [ ] **Step 2: Implement** — `GraphBook` gains `backEdge(edgeIndex): boolean` and `topoOrder(): readonly number[]` (DFS from node 0, iterative, computed once); `computeProgress` does one pass per colour and level: reach from the root for the list positions' weights, then subtree percents for every list node (reuse partial sums; a pass per list node over its subtree is acceptable if the whole call stays under ~200 ms on the real graph — measure and report); the service caches by (level, colour) and drops the cache on a new recording and on a level change.
- [ ] **Step 3: API** — `GET /api/progress?color=B|W` (400 for anything else) → `ProgressView`; API test.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — PASS; report the timing on the real graph with stub weights (uniform probabilities) built in the test or a one-off check. **Commit:** `feat(progress): progress of positions, branches and the list`.

### Task 3: Level change — replay every card

**Files:**
- Create: `packages/server/src/progress/replay.ts` (+ test)
- Modify: `packages/server/src/settings/player.ts`, `packages/server/src/api/player-routes.ts`, `packages/server/src/cards/repo.ts` / `service.ts` (what the replay needs), `packages/server/src/app.ts`, tests

**Interfaces:**

```ts
/** Spec 5: re-derive auto ratings with `thresholds`, replay FSRS from the start; manual ratings stay. Pure over the review lists. */
export function replayCard(reviews: readonly { reviewedAt: string; manual: Rating | null; auto: Rating; raw: unknown }[], derive: (raw: unknown) => Rating, createdAt: string): { state: FsrsState; autos: Rating[] }
```

- [ ] **Step 1: Failing tests** — a move card whose 1.5-point move was «good» at 7k becomes «again» at a dan level and its percent drops; back again restores it; a manual rating survives; a rest card with the «first time» rule under new thresholds; a position card from its stored worst (and from the training's moves when the session is still in the database); a problem card from its stored answer loss; the whole replay and the config write are one transaction — a failing config write leaves the level and every card unchanged.
- [ ] **Step 2: Implement** — `replayCard`; `GraphProgressService.replayLevel(thresholds)`; the position and problem card replay in `CardService` (store raw losses on new position reviews from now on: all in-zone user losses and unpunished events, so later replays do not depend on the session); `PlayerService.save(level)` runs the replays and writes the config inside one database transaction (write the config last; on its failure throw so the transaction rolls back); the API answers after the replay.
- [ ] **Step 3: Run** `npm test && npm run typecheck` — PASS. **Commit:** `feat(progress): a level change replays every card with the new thresholds`.

### Task 4: The web — summary, rows, settings

**Files:**
- Create: `packages/web/src/progress.ts` (+ test)
- Modify: `packages/web/src/api.ts`, `packages/web/src/App.tsx`, `packages/web/src/screens/StartScreen.tsx`, `packages/web/src/components/StartTree.tsx`, `packages/web/src/screens/SettingsScreen.tsx`, the stylesheet, the six catalogs

**Interfaces:**

```ts
export function aggregate(tree: StartTreeNode, view: ProgressView): Map<string, { percent: number; due: number }> // by tree node id: position / branch / group / root
export function mergeColors(black: ProgressView, white: ProgressView): ProgressView // the mean of both, for a random colour
```

- [ ] **Step 1: Catalog keys** (ru; all six; plural forms): `progress.mastered` «освоено {percent}», `progress.due` «пора повторить: {count}» (позиция / позиции / позиций), `progress.dueMark` «пора повторить», `progress.black` «за чёрных {percent}», `progress.white` «за белых {percent}», `progress.noWeights` «Прогресс появится после калибровки весов», `settings.level.recomputing` «Пересчёт прогресса…».
- [ ] **Step 2: Failing tests** of `aggregate` (weights from positions, nesting, due counts) and `mergeColors`.
- [ ] **Step 3: Implement** — `fetchProgress(color)`; App loads progress for the start screen's colour (both colours for «случайно») and reloads after a training's review, after a level change and on a colour change; StartScreen: the summary above the tree (big percent, bar, due count; for random both numbers); StartTree rows: a thin bar and the percent, the due mark; the iteration-1 card marks are replaced when `hasWeights`, kept otherwise; the selected position's line gets its percent; without weights a quiet hint instead of the summary; Settings: «Пересчёт прогресса…» while the level save is pending.
- [ ] **Step 4: Run** `npm test && npm run typecheck`, look at it in a browser (light/dark, six languages, random colour). **Commit:** `feat(progress): the progress of joseki on «Из списка»`.

### Task 5: End to end, README, notes

**Files:**
- Create: `e2e/make-graph.ts` (a small graph and weights for e2e from the graph fixture, written to a gitignored folder), `e2e/progress-server.ts` (port 5186, its own data folder), `e2e/progress.spec.ts`
- Modify: `playwright.config.ts`, `.gitignore`, `README.md`, `docs/superpowers/notes/2026-10-20-joseki-progress-part2-notes.md` (create)

- [ ] **Step 1:** The e2e graph covers the e2e start list's first position with two levels of weights; the server uses it.
- [ ] **Step 2: Spec** — a training of that position along the graph; back on «Из списка» its row shows a percent above 0 and the summary too; switching the colour changes the numbers; changing the level in Settings changes the percent.
- [ ] **Step 3:** README paragraph; notes (decisions, numbers, open questions).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run e2e`, clean tree. **Commit:** `test(progress): the progress end to end; README`.
