# Traps Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A «Ловушки» training mode that sets up a known trick play from our own JDB move base, plays it with the bot, follows up strongly for 3 moves, and gives a verdict in the review.

**Architecture:** `packages/server/src/jdb/` reads and writes the JDB format (spec 3). `packages/server/src/traps/` places traps on the board, picks them with weights, judges answers and checks the base with KataGo. The session service gets a `traps` mode: initial moves, a scripted trick move, three strong bot moves, then the usual human bot. The review carries a `trap` block; the web UI enables the mode card and shows badges.

**Tech Stack:** TypeScript, Node ≥ 22, better-sqlite3, vitest, Playwright, Preact.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-12-traps-mode-design.md` — binding for every task.
- JDB layout exactly as spec 3: magic `JDB1`, version `1`, kind `1` traps / `2` starts, base flags byte (bit 0 = verified by KataGo), u32 node count, CRC32 (IEEE) of the body; body = varint root child count, then nodes in depth-first preorder: move byte (`0–120` zone index `x + 11·y` of the top-right 11×11 zone, `121` tenuki, `255` + u16 board index `x + 19·y`), flags byte (bits 0–2 category `0` none / `1` good / `2` caught / `3` trap, bit 3 has-loss), varint child count, then i16 loss in tenths of a point if bit 3.
- Canonical form: top-right corner, Black first; of the two diagonal mirrors keep the one whose first off-diagonal move has corner-y < corner-x (corner-x counts from the right edge). Trap id = first 8 hex chars of SHA-1 of the canonical path to the trap, inclusive, as GTP text joined by spaces (`tenuki` for a tenuki).
- No mention of any external source in code, data or UI.
- Strong phase: exactly the bot's 3 moves after the trick; zone-restricted KataGo best move (`allowMoves` of the legal empty zone points, `untilDepth: 1`, `maxVisits = analysis.reviewVisits`).
- Trap pick weight `1 / (1 + shows)`, shows = rows in `trap_attempts` for that id.
- Base file: `packages/server/bases/traps.jdb` (not `data/`, which is git-ignored). Missing or unreadable base → the mode is unavailable, everything else works.
- User-facing text Russian; code, comments, commit messages English; commits with the repository's noreply identity, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; one commit per task.

---

### Task 1: The JDB library

**Files:**
- Create: `packages/server/src/jdb/varint.ts`, `crc32.ts`, `canonical.ts`, `format.ts`, `index.ts`
- Create tests: `packages/server/src/jdb/canonical.test.ts`, `format.test.ts`

**Interfaces (produced):**
- `type CanonicalMove = Vertex | 'tenuki'` (board coordinates in the top-right corner)
- `type NodeCategory = 'none' | 'good' | 'caught' | 'trap'`, `type JdbKind = 'traps' | 'starts'`
- `interface JdbNode { move: CanonicalMove; category: NodeCategory; loss: number | null; children: JdbNode[] }`
- `interface JdbTree { kind: JdbKind; verified: boolean; roots: JdbNode[] }`
- `encodeJdb(tree: JdbTree): Uint8Array`, `decodeJdb(bytes: Uint8Array): JdbBase` (throws `JdbError` with a Russian message)
- `class JdbBase`: `kind`, `verified`, `size`, `roots(): number[]`, `children(i): number[]`, `parent(i): number` (−1 for a first-level node), `move(i): CanonicalMove`, `category(i): NodeCategory`, `loss(i): number | null`, `path(i): CanonicalMove[]` (from the first level to `i`, inclusive), `find(path): number | null`, `nodesOf(category): number[]`, `toTree(): JdbTree`
- `canonical.ts`: `ZONE_SIZE_TR`, `zoneIndex(v): number | null`, `zoneVertex(i): Vertex`, `toTopRight(v, corner)`, `fromTopRight(v, corner)` (both involutions), `mirrorDiagonal(v)` (`[x, y] → [18 − y, 18 − x]`), `needsMirror(seq): boolean`, `mirrorMoves(seq)`, `canonicalize(seq)`, `moveText(m)`, `trapId(path): string`

- [ ] **Step 1: Tests first** — `canonical.test.ts`:
  - `zoneIndex([8, 0]) === 0`, `zoneIndex([18, 10]) === 120`, `zoneIndex([7, 0]) === null`, `zoneIndex([8, 11]) === null`; `zoneVertex(zoneIndex(v)!)` round-trips for all 121 zone points.
  - `toTopRight` / `fromTopRight` for all four corners on `D16`, `D4`, `Q4`, `Q16` (as vertices): TL `[3, 3] → [15, 3]`, BL `[3, 15] → [15, 3]`, BR `[15, 15] → [15, 3]`, TR identity; applying `fromTopRight(toTopRight(v, c), c)` returns `v` for all 361 points and 4 corners.
  - `mirrorDiagonal([16, 3])` (R16) `=== [15, 2]` (Q17) and it is an involution.
  - `canonicalize` keeps `Q17 R14` (first off-diagonal move Q17: corner-x 3, corner-y 2) and mirrors `R16 …` into `Q17 …`; a sequence whose moves are all on the diagonal or tenuki is unchanged.
  - `trapId` is 8 lowercase hex chars, equal for `[Q16, R14, S14]` given as vertices, different for a different path; `moveText('tenuki') === 'tenuki'`, `moveText([15, 3]) === 'Q16'`.
  `format.test.ts`:
  - encode → decode → `toTree()` deep-equals the input for a tree with: two first-level nodes; a trap node with a `good` child (loss 0.3) and a `caught` child (loss −4.6 → stored −46 tenths, read back −4.6); a tenuki move; a move outside the zone (`[3, 15]`); a node with 200 children (varint > 127); `verified` true and false; kind `starts`.
  - header: bytes 0–3 are `JDB1`, byte 4 is `1`, byte 6 bit 0 follows `verified`, u32 at 8 is the node count.
  - errors: wrong magic, version `2`, kind `9`, a flipped body byte (CRC), a truncated file, trailing bytes — each throws `JdbError`.
  - `JdbBase` navigation: `roots`, `children`, `parent`, `path`, `find` (hit and miss), `nodesOf('trap')`.
- [ ] **Step 2: Run** `npx vitest run packages/server/src/jdb` — FAIL (modules missing).
- [ ] **Step 3: Implement** (reference code below; keep it verbatim unless a test proves it wrong).

```ts
// varint.ts
import { JdbError } from './format'
/** Unsigned LEB128. */
export function writeVarint(out: number[], value: number): void {
  let v = value
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80)
    v = Math.floor(v / 0x80)
  }
  out.push(v)
}
export function readVarint(bytes: Uint8Array, pos: number): [value: number, next: number] {
  let value = 0
  let scale = 1
  let p = pos
  for (let i = 0; i < 5; i++) {
    if (p >= bytes.length) throw new JdbError('Файл базы обрывается')
    const b = bytes[p++]
    value += (b & 0x7f) * scale
    if (b < 0x80) return [value, p]
    scale *= 0x80
  }
  throw new JdbError('Повреждённое число в файле базы')
}
```

```ts
// crc32.ts — CRC-32 (IEEE 802.3), table-driven.
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
```

```ts
// canonical.ts
import { createHash } from 'node:crypto'
import { vertexToGtp, type Corner, type Vertex } from '@joseki-dojo/shared'

export type CanonicalMove = Vertex | 'tenuki'
const LAST = 18
/** The top-right 11×11 zone: x 8..18, y 0..10. */
const ZONE_X0 = 8
const ZONE = 11

export function zoneIndex(v: Vertex): number | null {
  const zx = v[0] - ZONE_X0
  const zy = v[1]
  return zx >= 0 && zx < ZONE && zy >= 0 && zy < ZONE ? zx + ZONE * zy : null
}
export const zoneVertex = (i: number): Vertex => [ZONE_X0 + (i % ZONE), Math.floor(i / ZONE)]

/** A move of `corner` seen in the top-right corner; the same map takes it back (an involution). */
export function toTopRight(v: Vertex, corner: Corner): Vertex {
  const flipX = corner === 'TL' || corner === 'BL'
  const flipY = corner === 'BL' || corner === 'BR'
  return [flipX ? LAST - v[0] : v[0], flipY ? LAST - v[1] : v[1]]
}
export const fromTopRight = toTopRight

/** Reflection of the top-right corner in its diagonal (R16 ↔ Q17). */
export const mirrorDiagonal = (v: Vertex): Vertex => [LAST - v[1], LAST - v[0]]

/** Spec 3.3: the first move off the diagonal must lie closer to the top edge than to the right edge. */
export function needsMirror(seq: readonly CanonicalMove[]): boolean {
  for (const m of seq) {
    if (m === 'tenuki') continue
    const cx = LAST - m[0]
    const cy = m[1]
    if (cx !== cy) return cy > cx
  }
  return false
}
export const mirrorMoves = (seq: readonly CanonicalMove[]): CanonicalMove[] => seq.map((m) => (m === 'tenuki' ? m : mirrorDiagonal(m)))
export const canonicalize = (seq: readonly CanonicalMove[]): CanonicalMove[] => (needsMirror(seq) ? mirrorMoves(seq) : [...seq])

export const moveText = (m: CanonicalMove): string => (m === 'tenuki' ? 'tenuki' : vertexToGtp(m))
/** Spec 3.3: first 8 hex characters of SHA-1 of the canonical path, inclusive. */
export const trapId = (path: readonly CanonicalMove[]): string =>
  createHash('sha1').update(path.map(moveText).join(' ')).digest('hex').slice(0, 8)
```

```ts
// format.ts
import { crc32 } from './crc32'
import { zoneIndex, zoneVertex, type CanonicalMove } from './canonical'
import { readVarint, writeVarint } from './varint'

export type JdbKind = 'traps' | 'starts'
export type NodeCategory = 'none' | 'good' | 'caught' | 'trap'
export interface JdbNode { move: CanonicalMove; category: NodeCategory; loss: number | null; children: JdbNode[] }
export interface JdbTree { kind: JdbKind; verified: boolean; roots: JdbNode[] }

export class JdbError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JdbError'
  }
}

const MAGIC = [0x4a, 0x44, 0x42, 0x31] // "JDB1"
export const JDB_VERSION = 1
const HEADER = 16
const KIND_CODE: Record<JdbKind, number> = { traps: 1, starts: 2 }
const CATEGORIES: NodeCategory[] = ['none', 'good', 'caught', 'trap']
const HAS_LOSS = 0x08
const TENUKI = 121
const ESCAPE = 255
const NO_LOSS = -32768
const OUTSIDE = 1000 // moves[] holds 1000 + board index for a move outside the zone

function writeMove(out: number[], m: CanonicalMove): void {
  if (m === 'tenuki') return void out.push(TENUKI)
  const z = zoneIndex(m)
  if (z !== null) return void out.push(z)
  const i = m[0] + 19 * m[1]
  out.push(ESCAPE, i & 0xff, i >> 8)
}

export function encodeJdb(tree: JdbTree): Uint8Array {
  const body: number[] = []
  let count = 0
  const writeNode = (n: JdbNode): void => {
    count++
    writeMove(body, n.move)
    body.push(CATEGORIES.indexOf(n.category) | (n.loss === null ? 0 : HAS_LOSS))
    writeVarint(body, n.children.length)
    if (n.loss !== null) {
      const v = Math.max(-32767, Math.min(32767, Math.round(n.loss * 10))) & 0xffff
      body.push(v & 0xff, v >> 8)
    }
    for (const c of n.children) writeNode(c)
  }
  writeVarint(body, tree.roots.length)
  for (const r of tree.roots) writeNode(r)
  const bytes = new Uint8Array(HEADER + body.length)
  bytes.set(MAGIC, 0)
  bytes[4] = JDB_VERSION
  bytes[5] = KIND_CODE[tree.kind]
  bytes[6] = tree.verified ? 1 : 0
  bytes.set(body, HEADER)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, count, true)
  view.setUint32(12, crc32(bytes.subarray(HEADER)), true)
  return bytes
}

export function decodeJdb(bytes: Uint8Array): JdbBase {
  if (bytes.length < HEADER || MAGIC.some((b, i) => bytes[i] !== b)) throw new JdbError('Это не файл базы ходов')
  if (bytes[4] !== JDB_VERSION) throw new JdbError(`Неизвестная версия базы ходов: ${bytes[4]}`)
  const kind = (Object.keys(KIND_CODE) as JdbKind[]).find((k) => KIND_CODE[k] === bytes[5])
  if (!kind) throw new JdbError(`Неизвестный тип базы ходов: ${bytes[5]}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(8, true)
  if (crc32(bytes.subarray(HEADER)) !== view.getUint32(12, true)) throw new JdbError('Файл базы ходов повреждён')

  const moves = new Int16Array(count)
  const flags = new Uint8Array(count)
  const losses = new Int16Array(count).fill(NO_LOSS)
  const firstChild = new Int32Array(count).fill(-1)
  const nextSibling = new Int32Array(count).fill(-1)
  const parents = new Int32Array(count).fill(-1)
  let pos = HEADER
  let rootCount: number
  ;[rootCount, pos] = readVarint(bytes, pos)
  // Each frame: the parent (-1 = first level), children still to read, and the last child linked so far.
  const stack: { parent: number; left: number; last: number }[] = [{ parent: -1, left: rootCount, last: -1 }]
  let rootFirst = -1
  let n = 0
  while (stack.length > 0) {
    const top = stack[stack.length - 1]
    if (top.left === 0) {
      stack.pop()
      continue
    }
    top.left--
    if (n >= count) throw new JdbError('В файле базы больше узлов, чем указано')
    if (pos >= bytes.length) throw new JdbError('Файл базы обрывается')
    const code = bytes[pos++]
    if (code === ESCAPE) {
      if (pos + 2 > bytes.length) throw new JdbError('Файл базы обрывается')
      moves[n] = OUTSIDE + (bytes[pos] | (bytes[pos + 1] << 8))
      pos += 2
    } else if (code <= TENUKI) moves[n] = code
    else throw new JdbError(`Неизвестный код хода в базе: ${code}`)
    if (pos >= bytes.length) throw new JdbError('Файл базы обрывается')
    flags[n] = bytes[pos++]
    if ((flags[n] & 0x07) >= CATEGORIES.length || (flags[n] & 0xf0) !== 0) throw new JdbError('Повреждённые флаги узла в базе')
    let kids: number
    ;[kids, pos] = readVarint(bytes, pos)
    if (flags[n] & HAS_LOSS) {
      if (pos + 2 > bytes.length) throw new JdbError('Файл базы обрывается')
      losses[n] = view.getInt16(pos, true)
      pos += 2
    }
    parents[n] = top.parent
    if (top.last === -1) {
      if (top.parent === -1) rootFirst = n
      else firstChild[top.parent] = n
    } else nextSibling[top.last] = n
    top.last = n
    stack.push({ parent: n, left: kids, last: -1 })
    n++
  }
  if (n !== count) throw new JdbError('В файле базы меньше узлов, чем указано')
  if (pos !== bytes.length) throw new JdbError('Лишние данные в конце файла базы')
  return new JdbBase(kind, (bytes[6] & 1) === 1, moves, flags, losses, firstChild, nextSibling, parents, rootFirst)
}

/** A decoded base in typed arrays (spec 3.4). Node indices are preorder positions. */
export class JdbBase {
  constructor(
    readonly kind: JdbKind,
    readonly verified: boolean,
    private readonly moves: Int16Array,
    private readonly flags: Uint8Array,
    private readonly losses: Int16Array,
    private readonly firstChild: Int32Array,
    private readonly nextSibling: Int32Array,
    private readonly parents: Int32Array,
    private readonly rootFirst: number,
  ) {}

  get size(): number {
    return this.moves.length
  }
  private siblingsFrom(first: number): number[] {
    const out: number[] = []
    for (let i = first; i !== -1; i = this.nextSibling[i]) out.push(i)
    return out
  }
  roots(): number[] {
    return this.siblingsFrom(this.rootFirst)
  }
  children(i: number): number[] {
    return this.siblingsFrom(this.firstChild[i])
  }
  parent(i: number): number {
    return this.parents[i]
  }
  move(i: number): CanonicalMove {
    const m = this.moves[i]
    if (m === TENUKI) return 'tenuki'
    if (m >= OUTSIDE) return [(m - OUTSIDE) % 19, Math.floor((m - OUTSIDE) / 19)]
    return zoneVertex(m)
  }
  category(i: number): NodeCategory {
    return CATEGORIES[this.flags[i] & 0x07]
  }
  loss(i: number): number | null {
    return this.losses[i] === NO_LOSS ? null : this.losses[i] / 10
  }
  path(i: number): CanonicalMove[] {
    const out: CanonicalMove[] = []
    for (let k = i; k !== -1; k = this.parents[k]) out.push(this.move(k))
    return out.reverse()
  }
  find(path: readonly CanonicalMove[]): number | null {
    let level = this.roots()
    let found = -1
    for (const m of path) {
      found = level.find((i) => sameMove(this.move(i), m)) ?? -1
      if (found === -1) return null
      level = this.children(found)
    }
    return found === -1 ? null : found
  }
  nodesOf(category: NodeCategory): number[] {
    const out: number[] = []
    for (let i = 0; i < this.size; i++) if (this.category(i) === category) out.push(i)
    return out
  }
  toTree(): JdbTree {
    const build = (i: number): JdbNode => ({ move: this.move(i), category: this.category(i), loss: this.loss(i), children: this.children(i).map(build) })
    return { kind: this.kind, verified: this.verified, roots: this.roots().map(build) }
  }
}

export const sameMove = (a: CanonicalMove, b: CanonicalMove): boolean =>
  a === 'tenuki' || b === 'tenuki' ? a === b : a[0] === b[0] && a[1] === b[1]
```

`index.ts` re-exports everything public from the four modules. Note the circular import between `varint.ts` and `format.ts` (`JdbError`): if it causes trouble, move `JdbError` into its own `errors.ts` and import it from both.

- [ ] **Step 4: Run** `npx vitest run packages/server/src/jdb`, then `npm test` and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(jdb): the JDB move base format: encode, decode and canonical form`.

---

### Task 2: Trap book, storage, API and packaging

**Files:**
- Create: `packages/server/src/traps/book.ts` (+ `book.test.ts`), `packages/server/src/traps/fixture.ts` (builds a small test base)
- Modify: `packages/server/src/store/migrations.ts` (migration 2), `records.ts`, `repo.ts` (+ tests), `packages/server/src/start.ts` and `app.ts` (load the base, `GET /api/traps`), `packages/server/src/main.ts` (dev path, `JOSEKI_TRAPS` env), `packages/desktop/src/main.ts` and `packages/desktop/electron-builder.config.cjs` (ship `bases/`), `packages/shared/src/types.ts` (`TrapsInfo`)

**Interfaces:**
- Consumes: Task 1's `JdbBase`, `decodeJdb`, canonical helpers.
- Produces:
  - `interface TrapPlacement { corner: Corner; mirror: boolean; swapColors: boolean }`
  - `type TrapVerdict = 'correct' | 'caught' | 'other'`
  - `class TrapBook`: `static load(file: string): TrapBook` (throws `JdbError` or a file error), `static empty(): TrapBook`, `static fromBase(base: JdbBase)`, `count`, `verified`, `ids(): string[]`, `pick(shows: (id: string) => number, rng: Rng): string | null`, `place(id: string, corner: Corner, userColor: Color, mirror: boolean): { initialMoves: Move[]; trick: Move; placement: TrapPlacement }`, `answers(id, placement): { good: MoveVertex[]; caught: MoveVertex[] }` (actual board coordinates; a tenuki answer is returned as `'pass'` in `caught`/`good` lists only for display — see below), `verdict(id, placement, answer: MoveVertex): TrapVerdict`
  - Repo: `insertTrapAttempt(row: { sessionId; trapId; result: TrapVerdict; createdAt })`, `trapShows(): Map<string, number>`
  - `shared`: `interface TrapsInfo { count: number; verified: boolean }`; `GET /api/traps` returns it (`{ count: 0, verified: false }` when no base)
  - `ServerOptions.trapsFile?: string | null`

Rules:
- `place`: canonical path of the trap node (path before the trap + the trap move). Apply `mirrorMoves` when `mirror`, then `fromTopRight(·, corner)`. The trap move is played by Black when its index in the path is even; the user is the side answering, so `swapColors = (trickColor === userColor)` and all colours are swapped when set. A tenuki inside the path is impossible (the build excludes it); throw if met.
- `verdict`: map the answer back (`toTopRight`, then `mirrorMoves` if `placement.mirror`); a move outside the zone or `'pass'` counts as `tenuki`. Find the child of the trap node with the same move: category `good` → `correct`, `caught` → `caught`; no such child → `other`.
- `answers`: children of the trap node with category `good` / `caught`, mapped to the board; a `tenuki` child is listed as `'pass'` (the UI prints «тэнуки»).
- `pick`: weight `1 / (1 + shows(id))`, one `rng()` draw; `null` when the book is empty.
- Migration 2 (never edit migration 1): `ALTER TABLE sessions ADD COLUMN trap_json TEXT;` and `CREATE TABLE trap_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE, trap_id TEXT NOT NULL, result TEXT NOT NULL CHECK (result IN ('correct', 'caught', 'other')), created_at TEXT NOT NULL); CREATE INDEX trap_attempts_trap ON trap_attempts (trap_id);`
- Start: `startServer` loads `options.trapsFile` with `TrapBook.load`; on any error logs `База ловушек недоступна: <reason>` and uses `TrapBook.empty()`. Dev `main.ts`: `process.env.JOSEKI_TRAPS ?? join(repoRoot, 'packages/server/bases/traps.jdb')`. Desktop: `join(resourcesDir, 'bases', 'traps.jdb')` when packaged, the repository path otherwise; `extraResources` gets `{ from: '../server/bases', to: 'bases' }`.
- `fixture.ts` exports `testTrapsTree(): JdbTree` — two traps in canonical form, e.g. `Q16 R14 S14` (answers `R15` good, `S15` good, `S13` caught) and `Q16 R14 O16 S17` (answers `R17` good, `tenuki` good, `S16` caught) — and `writeTestTraps(file: string)`; used by tests and by e2e.

Tests (`book.test.ts`, repo tests): placement in all four corners and with `mirror` (the trick lands where expected; colours swapped when the user picks the trick colour); `verdict` for good, caught, tenuki (outside the zone and `'pass'`), and an unknown move, through every corner and mirror; `answers` mapped to the board; `pick` weights with a seeded RNG (an unseen trap is picked about twice as often as one seen once); migration 2 on an existing v1 database; `trapShows` counts; `GET /api/traps` with and without a base; a corrupt base file makes `startServer` log and serve `{ count: 0 }`.

- [ ] Tests first, implement, `npm test` + `npm run typecheck`, commit `feat(traps): trap book, attempts table, /api/traps and the base in the desktop app`.

---

### Task 3: Traps sessions and the bot

**Files:** `packages/shared/src/types.ts` (`Mode`, `ResolvedSettings.trap`, `ReviewData.trap`), `packages/server/src/session/service.ts` (+ tests), `session.ts` if needed, `packages/server/src/bot/strong.ts` (+ test), `packages/server/src/review/` (trap block, attempt recording), `packages/server/src/store/repo.ts` (persist `trap_json`)

**Interfaces:**
- Consumes: Task 2's `TrapBook`, repo methods.
- Produces:
  - `type Mode = 'free' | 'traps'`
  - `interface TrapRef { id: string; index: number; mirror: boolean; swapColors: boolean }` — `index` is the trick's position in the full move list (`initialMoves` + `moves`); `ResolvedSettings.trap?: TrapRef` (only in traps mode), persisted in `sessions.trap_json`
  - `interface ReviewTrap { trickTurn: number | null; answerTurn: number | null; verdict: TrapVerdict | null; good: MoveVertex[] }` — turns relative to this session's `moves`, `null` when the move is in `initialMoves` or not played; `ReviewData.trap?: ReviewTrap`
  - `class StrongBot` with `chooseMove(req: BotRequest & { visits: number }): Promise<MoveVertex>` — zone-restricted best move (`allowMoves` of the legal empty zone points for `req.color`, `untilDepth: 1`, `maxVisits: visits`, `priority: 10`); `pass` when the zone has no legal point.

Rules:
- `validateSettings` accepts `mode: 'traps'` (environment `empty`); when the book is empty, `start` throws `SessionError('Ловушки недоступны: нет базы ловушек', 'bad_request')`.
- `start` in traps mode: resolve colour and corner as now; `id = book.pick(shows, rng)`; `mirror = rng() < 0.5`; `place(...)`; create the session with `initialMoves` and `trap = { id, index: initialMoves.length, mirror, swapColors }`. The bot is to move: the trick.
- `runBot`: with `trap` set and `allMoves.length === trap.index` → play the trick (from `place`, recomputed from the ref) without asking KataGo; `allMoves.length` ∈ `{index + 2, index + 4, index + 6}` → `StrongBot` with `analysis.reviewVisits`; otherwise the usual `HumanBot`.
- `replayFrom` keeps `trap` (absolute indices stay valid because the move prefix is kept).
- Review: `ReviewData.trap` from the ref and the book (`verdict` of the move at `index + 1` if it was played); on finishing a traps session whose answer is among this session's `moves`, insert one `trap_attempts` row with the verdict.
- The rest (end proposal, tenuki rules, review) is unchanged.

Tests: start places the initial moves and the bot's first move is the trick (no KataGo call for it); the next three bot moves use a zone-restricted query with `reviewVisits`; the fourth uses the human policy; replay before and after the trick; empty book → `bad_request`; review trap block (correct, caught, other, answer not played, trick in `initialMoves`); attempt row written once; `trap_json` round-trips through the repo.

- [ ] Tests first, implement, `npm test` + `npm run typecheck`, commit `feat(traps): traps sessions: scripted trick, three strong replies, verdict in the review`.

---

### Task 4: UI and end-to-end

**Files:** `packages/web/src/screens/StartScreen.tsx`, `ReviewScreen.tsx`, `packages/web/src/api.ts` (`fetchTraps`), `packages/web/src/App.tsx` (pass traps info, crumb «Ловушки»), styles, `e2e/traps.spec.ts`, `e2e/make-traps.ts`, `playwright.config.ts`, `.gitignore` (`e2e/*.jdb`)

Rules:
- Start screen: the mode cards become a real radio group: «Свободно» and «Ловушки» (icon `Swords` or `Shield` from lucide, description «бот разыграет известную ловушку»); «Случайно» and «Из списка» stay «скоро» (spec 5); four cards in a 2×2 grid (four in a row from 900px). When `GET /api/traps` returns `count: 0`, the «Ловушки» card is disabled with «нет базы ловушек». Start sends `mode: 'traps'`.
- Game: crumb «Ловушка» instead of «Свободная тренировка» in traps mode. No other hints.
- Review: on the trick turn the move line shows a badge «ловушка»; on the answer turn a verdict badge — «верный ответ» (good tone), «попались в ловушку» (blunder tone), «ход не из базы» (neutral) — and the line «Верно: R15, S15» (tenuki printed as «тэнуки»).
- e2e: `e2e/make-traps.ts` writes `e2e/traps.test.jdb` from `testTrapsTree()`; the first Playwright web server runs it before the server and sets `JOSEKI_TRAPS=e2e/traps.test.jdb`. `traps.spec.ts`: pick «Ловушки», start, see the bot's trick on the board (moves count ≥ 1, initial stones present), answer with a correct move, finish, see «верный ответ» in the review on that move.
- Screenshots of the start screen and the review with a verdict, light and dark (controller checks).

- [ ] Implement, `npm test`, `npm run typecheck`, `npm run e2e`, commit `feat(web): traps mode on the start screen and trap verdicts in the review`.

---

### Task 5: Tools — `jdb:dump` and `traps:check`

**Files:** `scripts/jdb/dump.ts`, `scripts/traps/check.ts`, `packages/server/src/traps/check.ts` (+ `check.test.ts`), root `package.json` scripts, `README.md` (developer section «Trap base»)

Rules:
- `npm run jdb:dump -- <file> [--sgf <out>]`: text — one line per node, indented by depth, `Q16`, category in brackets, loss if any, and the trap id on trap nodes; header line with kind, verified, node and trap counts. SGF — one game tree, 19×19, moves alternating from Black from the empty board (tenuki as a pass `[]`), trap node `BM[1]`, good answer `TE[1]`, caught answer `BM[1]`, `C[loss …]` when a loss is stored.
- `packages/server/src/traps/check.ts`: `checkTraps(base: JdbBase, engine: AnalysisEngine, opts: { visits: number; goodMax: number; caughtGap: number }, log): Promise<{ tree: JdbTree; kept: number; dropped: { id: string; reason: string }[] }>` — spec 4.2: for each trap, query the position before the answer (the canonical path, Black first, in the top-right corner) with `allowMoves` of the legal empty zone points for the answering colour, `untilDepth: 1`; the best zone lead `L*`; for every answer child, query the position after the answer and take its lead from the answerer's view; loss = `L*` − that lead; keep the trap when `min(good losses) ≤ goodMax` and `min(caught losses) − min(good losses) ≥ caughtGap`; write losses into the answer nodes; drop failing traps (and prune now-empty branches); set `verified: true`.
- `scripts/traps/check.ts` CLI: reads `config.local.json` and `packages/server/bases/traps.jdb`, defaults `--visits 1600 --good-max 1 --caught-gap 2`, writes the file back, prints the summary. **It is not run in this iteration** (spec 4.2).
- Tests on the stub engine: losses from programmed leads; keep and drop by both thresholds; pruning; `verified` set; a tenuki answer (an actual pass appended to the position).
- README developer section: how the base is stored, how to look at it (`jdb:dump`), how to verify it on a machine with a strong GPU (`traps:check`), and that the shipped base is not verified yet.

- [ ] Tests first, implement, `npm test` + `npm run typecheck`, commit `feat(traps): jdb:dump and traps:check tools`.

---

### Task 6 (controller): the trap base

Not a subagent task. When the local crawl (outside the repository) finishes: convert its cache with a local script that imports the Task 1 library — select traps per spec 4.1, canonicalize, merge duplicates, write `packages/server/bases/traps.jdb` with `verified: false`; run `jdb:dump` for a sanity check; commit `feat(traps): the trap base (not verified by KataGo yet)`; put the summary (found, dropped with reasons, written) into the PR description; delete the local crawl script and its cache.
