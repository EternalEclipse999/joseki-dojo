# Joseki Graph (Progress, Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The joseki graph under the start list — positions from two joseki dictionaries merged by position — with the human net's move probabilities for all 30 levels, built offline and loaded by the server for parts 2–3 (spec `docs/superpowers/specs/2026-10-20-joseki-progress-design.md`, section 3).

**Architecture:** A graph module in the server (`packages/server/src/graph/`): canonical zone-position keys, the graph and weights file formats (encode/decode), and `GraphBook` (loaded at start; lookups by key and by training moves; edges and the rest probability for a level). A local build script outside the repository merges the two dictionary caches into `packages/server/bases/joseki-graph.bin`. A GPU script `npm run tree:gpu` queries the human net once per node and level and writes `packages/server/bases/joseki-weights.bin`.

**Tech Stack:** TypeScript, Node 22 (`node:zlib`), Vitest, the KataGo analysis engine (human SL profiles).

## Global Constraints

- Nothing in the repository names the joseki dictionaries or the pro-game site (code, comments, data, commits, docs).
- The two dictionaries' local caches, archives, scripts and logs outside the repository are never deleted or rewritten; scripts there only read the caches.
- GPU work never runs on the development machine; `tree:gpu` runs only on the owner's GPU machine (its tests use the fake KataGo).
- A node is a corner-zone position with the side to move: the zone stones (top-right 11×11, x 8..18, y 0..10, after captures) of the position, the diagonal mirror folded (the smaller reading wins), plus the side to move. Tenuki moves add no stone in the zone. Transpositions and mirrored orders are one node.
- An edge is a move from a node: a zone vertex in the node's representative orientation, or `tenuki`; it carries its category in each dictionary (`ideal`, `good`, `bad`, `trick`, `question`) and its sources.
- The rest probability of a node at a level = max(0, 1 − Σ edge probabilities at that level); the tenuki edge's probability = the human policy outside the zone plus the pass.
- Weights are measured, never invented: a level without weights has no progress; a missing or damaged file is a log line and no progress, and the app works as before.
- `tree:gpu` behaves like `thresholds:gpu`: refuses on `main`, on a detached HEAD or with uncommitted changes in its file; checks that KataGo answers with the human net before any work; commits only its file with the report, with the configured git identity; prints progress with the time left.
- User-facing text (if any) in all six catalogs; code, comments, commits in English; commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: The graph module — keys, files, `GraphBook`

**Files:**
- Create: `packages/server/src/graph/key.ts`, `packages/server/src/graph/format.ts`, `packages/server/src/graph/book.ts`, tests next to them (`*.test.ts`)
- Modify: `packages/server/src/start.ts` (load the two files, options and env like the starts and thresholds files), `packages/server/src/app.ts` (`AppServices.graph`), `packages/server/test/helpers.ts` if the options need defaults

**Interfaces (produced):**

```ts
// key.ts
export type ZoneMove = Vertex | 'tenuki'
/** Spec 3.2: the canonical key of the zone position after `moves` (top-right coordinates, colours alternating from Black unless given) with `toMove` to play. */
export function zoneKey(moves: readonly Move[], toMove: Color): { key: string; mirrored: boolean }
/** The key of a training position: its moves in its corner (moved to the top-right first); tenuki and moves outside the zone add no zone stone. */
export function trainingKey(moves: readonly Move[], corner: Corner, toMove: Color): { key: string; mirrored: boolean }
```

`key` = `${toMove}:` + the 121 zone points read row by row (`0` empty, `1` black, `2` white) — the smaller of the plain and the diagonal-mirrored reading; `mirrored` says the mirrored reading won (a move from the caller's orientation must then be mirrored to the node's representative orientation, and back).

```ts
// format.ts
export type EdgeCategory = 'ideal' | 'good' | 'bad' | 'trick' | 'question'
export interface GraphNode { key: string; toMove: Color; path: ZoneMove[]; listIds: string[] }
export interface GraphEdge { from: number; to: number | null; move: ZoneMove; categories: { source: 0 | 1; category: EdgeCategory }[] }
export interface JosekiGraph { nodes: GraphNode[]; edges: GraphEdge[] }   // nodes[0] is the empty corner
export function encodeGraph(g: JosekiGraph): Uint8Array
export function decodeGraph(bytes: Uint8Array): JosekiGraph
export interface GraphWeights { levels: string[]; edge: Float32Array[]; rest: Float32Array[] } // [level][edge index] / [level][node index]
export function encodeWeights(w: GraphWeights): Uint8Array
export function decodeWeights(bytes: Uint8Array, graph: JosekiGraph): GraphWeights
```

- `path` is a representative move sequence from the empty corner to the node in its own orientation (the KataGo queries replay it; tenuki is a pass).
- `to` is `null` for an edge whose move is known but not expanded (bad / trick / question children, and the moves of the frontier); such an edge still has a probability.
- `source` 0 and 1 are the two dictionaries in a fixed order; nothing else names them.
- Both files: a magic and version header, a checksum, gzip (`node:zlib`) of a compact body; probabilities quantised to `uint16` (value × 65535, rounded) in the weights file; the weights file carries the graph's checksum and is refused for another graph.

```ts
// book.ts
export class GraphBook {
  static empty(): GraphBook
  static load(graphBytes: Uint8Array, weightsBytes: Uint8Array | null): GraphBook
  readonly hasWeights: boolean
  node(key: string): number | null
  /** The node of a training position, or null outside the graph. */
  nodeOfTraining(moves: readonly Move[], corner: Corner, toMove: Color): { node: number; mirrored: boolean } | null
  listNode(listId: string): number | null
  edges(node: number): readonly GraphEdge[]
  /** Spec 3.3: the probabilities of a node's edges and of its rest at a level; null without weights or for an unknown level. */
  probabilities(node: number, level: string): { edges: number[]; rest: number } | null
}
```

- [ ] **Step 1: Failing tests** — `key.test.ts`: the same position by two move orders → one key; a position and its mirror → one key with `mirrored` set on one of them; a capture in the zone removes the stone; a tenuki adds no zone stone but changes the side to move; `trainingKey` of the same position played in another corner equals `zoneKey`. `format.test.ts`: round trip of a small graph (three nodes, an unexpanded edge, two sources) and of its weights (two levels, values survive within 1/65535); a damaged byte → an error; weights for another graph → an error. `book.test.ts`: lookups by key, by training moves in another corner (mirrored), by list id; `probabilities` with and without weights and for an unknown level; `GraphBook.empty()`.
- [ ] **Step 2: Implement** `key.ts`, `format.ts`, `book.ts` (reuse `toTopRight`, `mirrorDiagonal` from `packages/server/src/jdb/canonical.ts` and `Position` from shared).
- [ ] **Step 3: Wiring** — `start.ts` loads `packages/server/bases/joseki-graph.bin` and `joseki-weights.bin` (options `graphFile`, `graphWeightsFile`, env `JOSEKI_GRAPH`, `JOSEKI_GRAPH_WEIGHTS`, empty string = none, as the thresholds file does); a missing graph is silent (no file yet), a damaged one or weights that do not match are one log line each; `AppServices.graph: GraphBook`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — PASS. **Commit:** `feat(graph): zone-position keys, the graph and weights files, GraphBook`.

### Task 2: Building the graph from the two dictionary caches (outside the repository)

**Files:**
- Create: a build script next to the dictionaries' local caches (outside the repository; not committed)
- Create (by running it): `packages/server/bases/joseki-graph.bin`

**Interfaces:**
- Consumes: Task 1's `zoneKey`, `encodeGraph`, `JosekiGraph`; the first dictionary's local cache (outside the repository; one file per position with its move, its own move-type code and the list of next moves, each with its move-type code and the id of the position it leads to; the root has its own file; moves alternate from Black; read the way the earlier trap build script, kept outside the repository, does) and the second dictionary's local cache (outside the repository; one file per node with its list of children, each with its id, its move as an SGF coordinate for Black or White, and its own move-type code, one of five kinds that map to the five categories; an SGF pass is a pass; the root is the first file; read the way its crawl scripts do); the list `packages/server/bases/starts-list.json` (positions with their GTP moves).

- [ ] **Step 1:** Walk each dictionary from its root, replaying moves (colours as given; a pass or a move outside the zone is a tenuki), keying every reached position with `zoneKey`; one graph node per key (the first path found is its representative, in its orientation); edges per (node, move in the node's orientation): merge categories from both dictionaries; children that are not expanded (the bad, trick and question move-type codes of the second dictionary, unexpanded frontier nodes, missing cache files) become edges with `to: null`. Positions illegal on the board are skipped and counted.
- [ ] **Step 2:** Mark the list positions: for each list position, key its moves and attach its id to that node; a list position with no node is reported.
- [ ] **Step 3:** Report (stdout): nodes and edges per dictionary, merged nodes (found in both), nodes per depth, unexpanded edges, skipped positions, list positions not found; then write the file and print its size.
- [ ] **Step 4:** Run from the repository root the build script with `npx tsx` (from its folder outside the repository) on the caches as they are (the deep walk of the second dictionary is still running — the file will be rebuilt when it ends). Commit only the graph file: `feat(graph): the joseki graph from the two dictionaries` (the commit message and the file name no dictionary).

### Task 3: `npm run tree:gpu` — the move probabilities by level

**Files:**
- Create: `scripts/tree/gpu.ts`, `scripts/tree/weigh-steps.ts`, `scripts/tree/weigh-steps.test.ts`
- Modify: `package.json` (`"tree:gpu": "tsx scripts/tree/gpu.ts"`)

**Interfaces:**
- Consumes: Task 1 (`decodeGraph`, `encodeWeights`, `GraphWeights`); `PLAYER_LEVELS` and the level's human profile (`humanProfile`, as `scripts/thresholds/` uses them); the analysis engine as `scripts/thresholds/gpu.ts` starts it (`config.local.json`, the human net); the branch / identity / commit checks of `scripts/thresholds/gpu.ts` (reuse its helpers rather than copying them; move them to a shared module under `scripts/` if they are private there).

- [ ] **Step 1: Failing tests** (`weigh-steps.test.ts`, a stub `analyze` returning a `humanPolicy` of 362 values like `scripts/thresholds/calibrate-steps.test.ts`): one node with two zone edges and a tenuki edge, two levels → edge probabilities are the policy at the edge's vertex (mapped through the node's orientation), the tenuki edge is the policy outside the zone plus the pass, the rest is 1 − their sum (never below 0); a query replays the node's representative path with passes for tenuki and uses `maxVisits: 1`, `includePolicy: true`, `overrideSettings.humanSLProfile` of the level.
- [ ] **Step 2: Implement** `weigh-steps.ts` (pure: the query for a node and level, the probabilities from a policy) and `gpu.ts`: the checks, the human-net check, the queries in batches (as many in flight as the engine takes), progress every 1 000 nodes with the time left, the weights file, the report (nodes, levels, the mean rest probability per level, the five nodes with the largest rest at the middle level), the commit of `packages/server/bases/joseki-weights.bin` only.
- [ ] **Step 3: Run** `npm test && npm run typecheck` — PASS. Do not run the script here. **Commit:** `feat(graph): tree:gpu measures the move probabilities of the graph by level`.

### Task 4: Docs and the end-to-end check

**Files:**
- Modify: `docs/gpu-calibration.md` (section 2: the branch name `tree-gpu-run`, the command, what it writes, the time estimate from the node count, what to check in the report), `README.md` (a "Joseki graph" subsection next to the start positions base: what the graph is, how it is built outside the repository, `tree:gpu`), the notes `docs/superpowers/notes/2026-10-20-joseki-graph-notes.md` (the build report numbers, open questions)

- [ ] **Step 1:** Fill the docs.
- [ ] **Step 2:** `npm test && npm run typecheck && npm run e2e` — PASS (no user-visible change yet: the app runs with the graph and without weights). **Commit:** `docs(graph): the joseki graph and its GPU calibration`.
