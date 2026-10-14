# Start Positions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The start screen's «Случайно» and «Из списка» start a training from a position of a known joseki (3–8 moves on the board), then play on as in «Свободно».

**Architecture:** The JDB format gains a node category `start`. `starts/book.ts` (`StartBook`) reads `starts.jdb` and the named list `starts-list.json`, picks a position and puts it on the board. The server loads both files like the traps base, serves `GET /api/starts`, stores the start of a session in `sessions.start_json` and counts shows from finished sessions. The web start screen gets the two cards and a grouped list with corner previews. Task 4 — the data — is done by the controller outside the repository.

**Tech Stack:** TypeScript, Node 24, Fastify, better-sqlite3 (JSON1), Preact, Vitest, Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-13-start-positions-design.md`; JDB and ids: `docs/superpowers/specs/2026-10-12-traps-mode-design.md` (3.2, 3.3).
- Node category `4` = `start`; categories 5–7 are a read error ('Повреждённые флаги узла в базе'). Format version stays `1`. Base kind `starts` (code 2).
- Start id = `trapId(canonical path)` (first 8 hex chars of SHA-1 of the canonical path).
- List file (Task 6 on): a JSON object `{ "branches": [{ "moves", "name" }], "positions": [{ "group", "name", "short"?, "moves", "rare"? }] }`; groups `4-4, 3-4, 3-3, 5-4, 5-3`, fixed order on screen; a position whose path is not a normal start of the base is skipped with a log line; a branch (2–8 moves, not a position) with no positions under it is skipped with a log line.
- Missing or broken `starts.jdb`: both start modes off; missing or broken list: only «Из списка» off; one log line with the reason.
- Modes: `'free' | 'traps' | 'random' | 'list'`; `'list'` requires `startId`.
- Placement: the canonical moves go to the chosen corner, mirrored in the corner's diagonal by one coin; colours unchanged (Black first); the moves become `initialMoves`; if the bot is to move, it moves first.
- «Случайно» picks with weight `1 / (1 + shows)`; a show = a **finished** session with that start (either start mode).
- After the start everything is as in «Свободно»; only the general `maxSessionMoves` limit applies (it counts moves after the initial ones).
- Card texts: «Случайно» — «позиция из базы дзёсеки»; «Из списка» — «выберите дзёсеки»; without a base — «база стартовых позиций недоступна». Crumb in a game: the list name, or «Случайная позиция»; in the review: «Разбор: <name>» or «Разбор: случайная позиция».
- User-facing text Russian; code, comments, commits English. No mention of the joseki dictionary or the pro-game database anywhere in the repository.

---

### Task 1: JDB `start` category, shared types and `StartBook`

**Files:**
- Modify: `packages/server/src/jdb/format.ts`, `packages/server/src/jdb/format.test.ts`, `packages/server/src/jdb/dump.ts`
- Modify: `packages/server/src/bot/rng.ts`, `packages/server/src/traps/book.ts`
- Modify: `packages/shared/src/types.ts`
- Create: `packages/server/src/starts/book.ts`, `packages/server/src/starts/fixture.ts`, `packages/server/src/starts/book.test.ts`

**Interfaces:**
- Produces: `NodeCategory` with `'start'`; `pickLeastShown(ids, shows, rng)`; shared `Mode`, `SessionSettings.startId?`, `StartRef`, `ResolvedSettings.start?`, `START_GROUPS`, `StartGroup`, `StartListEntry`, `StartsInfo`; `StartBook` (`empty`, `loadBase`, `fromBase`, `withList`, `count`, `skipped`, `ids`, `has`, `list`, `isListed`, `nameOf`, `pick`, `place`); fixture `testStartsTree()`, `TEST_STARTS_LIST`, `writeTestStarts(baseFile, listFile)`.

- [ ] **Step 1: The `start` category in `packages/server/src/jdb/format.ts`**

Change the two declarations (nothing else in the reader changes: it already rejects `(flags & 0x07) >= CATEGORIES.length`):

```ts
export type NodeCategory = 'none' | 'good' | 'caught' | 'trap' | 'start'
```
```ts
const CATEGORIES: NodeCategory[] = ['none', 'good', 'caught', 'trap', 'start']
```

- [ ] **Step 2: Tests in `packages/server/src/jdb/format.test.ts`** (add a `describe`; `crc32` is exported from `./crc32`, already re-exported by `./index`)

```ts
describe('the start category', () => {
  const startTree = (): JdbTree => ({
    kind: 'starts',
    verified: false,
    roots: [{ move: [15, 3], category: 'none', loss: null, children: [{ move: [13, 2], category: 'start', loss: null, children: [] }] }],
  })

  it('writes and reads start nodes', () => {
    const base = decodeJdb(encodeJdb(startTree()))
    expect(base.kind).toBe('starts')
    expect(base.nodesOf('start').map((i) => base.path(i))).toEqual([[[15, 3], [13, 2]]])
  })

  it('rejects a category above start', () => {
    const bytes = encodeJdb({ kind: 'starts', verified: false, roots: [{ move: [15, 3], category: 'start', loss: null, children: [] }] })
    // Header 16 bytes, root count (1 byte), the move (1 byte), then the flags.
    bytes[18] = 5
    new DataView(bytes.buffer).setUint32(12, crc32(bytes.subarray(16)), true)
    expect(() => decodeJdb(bytes)).toThrow('Повреждённые флаги узла в базе')
  })
})
```

Add `crc32` and `JdbTree` to the test's imports if they are not there yet.

- [ ] **Step 3: `packages/server/src/jdb/dump.ts` — starts in the text dump**

In `dumpText`, the header counts the base's own category, and a start node shows its id like a trap:

```ts
  const own = base.kind === 'starts' ? 'starts' : 'traps'
  const lines = [`${base.kind}, verified: ${base.verified ? 'yes' : 'no'}, nodes: ${base.size}, ${own}: ${base.nodesOf(own === 'starts' ? 'start' : 'trap').length}`]
```
```ts
    if (cat === 'trap' || cat === 'start') line += ` ${trapId(base.path(i))}`
```

The SGF dump gives start nodes no mark (no change there). Run `npx vitest run packages/server/src/jdb` — the existing dump tests must still pass unchanged.

- [ ] **Step 4: `pickLeastShown` in `packages/server/src/bot/rng.ts`, used by `TrapBook.pick`**

Append to `rng.ts`:

```ts
/** A weighted random id, weight 1 / (1 + shows): the less an id was shown, the likelier it is. One `rng()` draw; null for no ids. */
export function pickLeastShown(ids: readonly string[], shows: (id: string) => number, rng: Rng): string | null {
  if (ids.length === 0) return null
  const weights = ids.map((id) => 1 / (1 + shows(id)))
  let r = rng() * weights.reduce((a, b) => a + b, 0)
  for (let k = 0; k < ids.length; k++) {
    r -= weights[k]
    if (r < 0) return ids[k]
  }
  return ids[ids.length - 1]
}
```

Replace the body of `TrapBook.pick` in `packages/server/src/traps/book.ts` with `return pickLeastShown(this.ids(), shows, rng)` (import `pickLeastShown` next to `Rng` from `'../bot/rng'`; keep its doc comment). The traps book tests must pass unchanged.

- [ ] **Step 5: Shared types in `packages/shared/src/types.ts`**

Replace `export type Mode = 'free' | 'traps'` and extend the settings:

```ts
export type Mode = 'free' | 'traps' | 'random' | 'list'
```
In `SessionSettings`, after `corner`:
```ts
  /** Mode 'list': the id of the chosen start position. */
  startId?: string
```
After `TrapRef`:
```ts
/** The start position of a 'random' or 'list' session and how its canonical form was put on the board. */
export interface StartRef {
  id: string
  /** The name on the list; null for a position that is not on it. */
  name: string | null
  mirror: boolean
}
```
In `ResolvedSettings`, after `trap?`:
```ts
  /** Only in the start modes ('random', 'list'). */
  start?: StartRef
```
At the end of the file, after `TrapsInfo`:
```ts
/** Groups of the named start list, in screen order: the first move in the corner. */
export const START_GROUPS = ['4-4', '3-4', '3-3', '5-4', '5-3'] as const
export type StartGroup = (typeof START_GROUPS)[number]

/** One position of the named list; `moves` are canonical (top-right corner, Black first) in GTP. */
export interface StartListEntry {
  id: string
  group: StartGroup
  name: string
  moves: string[]
}

/** What `GET /api/starts` reports: how many start positions the base holds, and the named list. */
export interface StartsInfo {
  count: number
  list: StartListEntry[]
}
```

- [ ] **Step 6: The fixture `packages/server/src/starts/fixture.ts`**

```ts
import { writeFileSync } from 'node:fs'
import { gtpToVertex } from '@joseki-dojo/shared'
import { encodeJdb, type CanonicalMove, type JdbNode, type JdbTree, type NodeCategory } from '../jdb'

const mv = (gtp: string): CanonicalMove => gtpToVertex(gtp) as CanonicalMove
const node = (gtp: string, category: NodeCategory, children: JdbNode[] = []): JdbNode => ({ move: mv(gtp), category, loss: null, children })

/**
 * A small starts base in canonical form (the first move off the diagonal is closer to the top edge):
 *   Q16 O17       start
 *   Q16 O17 R14   start (on the list, group 4-4)
 *   Q17 R15       start (on the list, group 3-4)
 */
export function testStartsTree(): JdbTree {
  return {
    kind: 'starts',
    verified: false,
    roots: [node('Q16', 'none', [node('O17', 'start', [node('R14', 'start')])]), node('Q17', 'none', [node('R15', 'start')])],
  }
}

export const TEST_STARTS_LIST = [
  { group: '4-4', name: 'Тестовое начало 4-4', moves: 'Q16 O17 R14' },
  { group: '3-4', name: 'Тестовое начало 3-4', moves: 'Q17 R15' },
]

export function writeTestStarts(baseFile: string, listFile: string): void {
  writeFileSync(baseFile, encodeJdb(testStartsTree()))
  writeFileSync(listFile, JSON.stringify(TEST_STARTS_LIST))
}
```

- [ ] **Step 7: Write `packages/server/src/starts/book.test.ts`**

```ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CORNERS, gtpToVertex, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../test/helpers'
import { decodeJdb, encodeJdb, fromTopRight, JdbError, mirrorDiagonal, needsMirror, trapId, type JdbNode } from '../jdb'
import { testTrapsTree } from '../traps/fixture'
import { StartBook } from './book'
import { TEST_STARTS_LIST, testStartsTree, writeTestStarts } from './fixture'

const v = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
const id = (moves: string): string => trapId(moves.split(' ').map(v))
const A = id('Q16 O17')
const B = id('Q16 O17 R14')
const C = id('Q17 R15')
const base = () => decodeJdb(encodeJdb(testStartsTree()))
const book = (): StartBook => StartBook.fromBase(base())
const listed = (): StartBook => book().withList(JSON.stringify(TEST_STARTS_LIST), () => {})

describe('StartBook', () => {
  it('keeps the fixture canonical', () => {
    const b = base()
    for (const i of b.nodesOf('start')) expect(needsMirror(b.path(i))).toBe(false)
  })

  it('lists the starts of the base in tree order', () => {
    expect(book().count).toBe(3)
    expect(book().ids()).toEqual([A, B, C])
    expect(book().has(B)).toBe(true)
  })

  it('is empty without a base', () => {
    const e = StartBook.empty()
    expect([e.count, e.ids(), e.list(), e.pick(() => 0, () => 0.5)]).toEqual([0, [], [], null])
  })

  it('loads a base file and refuses a traps base or a broken file', () => {
    const dir = tempDir()
    writeTestStarts(join(dir, 'starts.jdb'), join(dir, 'list.json'))
    expect(StartBook.loadBase(join(dir, 'starts.jdb')).count).toBe(3)
    writeFileSync(join(dir, 'traps.jdb'), encodeJdb(testTrapsTree()))
    expect(() => StartBook.loadBase(join(dir, 'traps.jdb'))).toThrow(JdbError)
    writeFileSync(join(dir, 'bad.jdb'), 'nonsense')
    expect(() => StartBook.loadBase(join(dir, 'bad.jdb'))).toThrow(JdbError)
  })

  it('skips starts that cannot be played', () => {
    const n = (gtp: string, category: JdbNode['category'], children: JdbNode[] = []): JdbNode => ({ move: gtp === 'tenuki' ? 'tenuki' : v(gtp), category, loss: null, children })
    const tree = { kind: 'starts' as const, verified: false, roots: [n('Q16', 'none', [n('Q16', 'start'), n('tenuki', 'none', [n('O17', 'start')]), n('O17', 'start')])] }
    const b = StartBook.fromBase(decodeJdb(encodeJdb(tree)))
    expect(b.ids()).toEqual([A])
    expect(b.skipped).toHaveLength(2)
  })

  it('reads the named list in file order', () => {
    const b = listed()
    expect(b.list()).toEqual([
      { id: B, group: '4-4', name: 'Тестовое начало 4-4', moves: ['Q16', 'O17', 'R14'] },
      { id: C, group: '3-4', name: 'Тестовое начало 3-4', moves: ['Q17', 'R15'] },
    ])
    expect([b.isListed(B), b.isListed(A)]).toEqual([true, false])
    expect([b.nameOf(C), b.nameOf(A)]).toEqual(['Тестовое начало 3-4', null])
  })

  it('canonicalizes the moves of a list entry', () => {
    // R14 is O17 mirrored in the diagonal.
    const b = book().withList(JSON.stringify([{ group: '4-4', name: 'Зеркально', moves: 'Q16 R14' }]), () => {})
    expect(b.list()).toEqual([{ id: A, group: '4-4', name: 'Зеркально', moves: ['Q16', 'O17'] }])
  })

  it('skips bad list entries with a log line each', () => {
    const lines: string[] = []
    const entries = [
      { group: '6-6', name: 'x', moves: 'Q16 O17' },
      { group: '4-4', name: ' ', moves: 'Q16 O17' },
      { group: '4-4', name: 'x', moves: 'Q16 Z99' },
      { group: '4-4', name: 'x', moves: 'Q16 O16' },
      { group: '4-4', name: 'first', moves: 'Q16 O17' },
      { group: '4-4', name: 'again', moves: 'Q16 O17' },
      null,
    ]
    const b = book().withList(JSON.stringify(entries), (l) => lines.push(l))
    expect(b.list().map((e) => e.name)).toEqual(['first'])
    expect(lines).toHaveLength(6)
    expect(lines[0]).toMatch(/^Список стартовых позиций, запись 1: /)
  })

  it('refuses a list that is not an array', () => {
    expect(() => book().withList('{"group":"4-4"}', () => {})).toThrow('Список стартовых позиций должен быть массивом')
    expect(() => book().withList('not json', () => {})).toThrow()
  })

  it('picks the less shown starts more often', () => {
    const shows = (s: string): number => (s === C ? 1e9 : 0)
    // Weights 1, 1, ~0: a draw near 1 lands on the second start, never on the heavily shown third.
    expect(book().pick(shows, () => 0.99)).toBe(B)
    expect(book().pick(shows, () => 0)).toBe(A)
  })

  it('places a start in any corner, mirrored or not, Black first', () => {
    for (const corner of CORNERS) {
      for (const mirror of [false, true]) {
        const moves = book().place(B, corner, mirror)
        const expected = ['Q16', 'O17', 'R14'].map((m) => fromTopRight(mirror ? mirrorDiagonal(v(m)) : v(m), corner))
        expect(moves).toEqual(expected.map((vertex, i) => ({ color: i % 2 === 0 ? 'B' : 'W', vertex })))
      }
    }
    expect(() => book().place('nope', 'TR', false)).toThrow()
  })
})
```

- [ ] **Step 8: Run it to see it fail**

Run: `npx vitest run packages/server/src/starts/book.test.ts`
Expected: FAIL — `Cannot find module './book'`.

- [ ] **Step 9: Create `packages/server/src/starts/book.ts`**

```ts
import { readFileSync } from 'node:fs'
import { gtpToVertex, Position, START_GROUPS, vertexToGtp, type Color, type Corner, type Move, type StartGroup, type StartListEntry, type Vertex } from '@joseki-dojo/shared'
import { pickLeastShown, type Rng } from '../bot/rng'
import { canonicalize, decodeJdb, fromTopRight, JdbError, mirrorMoves, trapId, type CanonicalMove, type JdbBase } from '../jdb'

const colorAt = (i: number): Color => (i % 2 === 0 ? 'B' : 'W')

/** A start can be played when its path has no tenuki and is a legal sequence of moves, Black first. */
function isPlayable(path: readonly CanonicalMove[]): boolean {
  if (path.length === 0 || path.includes('tenuki')) return false
  try {
    Position.fromMoves(path.map((m, i) => ({ color: colorAt(i), vertex: m as Vertex })))
    return true
  } catch {
    return false
  }
}

/** The moves of a list entry, canonical; null for anything that is not a list of board points. */
function parseMoves(text: unknown): Vertex[] | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  try {
    const moves = text.trim().split(/\s+/).map(gtpToVertex)
    if (moves.some((m) => m === 'pass')) return null
    return canonicalize(moves as Vertex[]) as Vertex[]
  } catch {
    return null
  }
}

/** Spec (starts) 4: the start positions of a starts base and its named list — picking one and putting it on the board. */
export class StartBook {
  private constructor(
    /** Canonical path of each playable start, by id (the trap id of the path), in tree order. */
    private readonly paths: ReadonlyMap<string, CanonicalMove[]>,
    private readonly entries: readonly StartListEntry[],
    /** Ids of the starts left out because they cannot be played. */
    readonly skipped: readonly string[] = [],
  ) {}

  static empty(): StartBook {
    return new StartBook(new Map(), [])
  }

  /** Throws `JdbError` for a bad file or a base of another kind, a file system error for an unreadable file. */
  static loadBase(file: string): StartBook {
    const base = decodeJdb(readFileSync(file))
    if (base.kind !== 'starts') throw new JdbError(`Это не база стартовых позиций (тип: ${base.kind})`)
    return StartBook.fromBase(base)
  }

  static fromBase(base: JdbBase): StartBook {
    const paths = new Map<string, CanonicalMove[]>()
    const skipped: string[] = []
    for (const i of base.nodesOf('start')) {
      const path = base.path(i)
      const id = trapId(path)
      if (isPlayable(path)) paths.set(id, path)
      else skipped.push(id)
    }
    return new StartBook(paths, [], skipped)
  }

  /**
   * Spec (starts) 4.2: this book with the named list from `json`, the text of starts-list.json. An entry with an unknown
   * group, no name, bad moves, a path that is not a start of the base, or a position already on the list is left out
   * with one `log` line. Throws when the text is not a JSON array.
   */
  withList(json: string, log: (line: string) => void): StartBook {
    const raw = JSON.parse(json) as unknown
    if (!Array.isArray(raw)) throw new Error('Список стартовых позиций должен быть массивом')
    const entries: StartListEntry[] = []
    raw.forEach((item: unknown, k) => {
      const skip = (why: string): void => log(`Список стартовых позиций, запись ${k + 1}: ${why}`)
      const e = (item ?? {}) as Record<string, unknown>
      if (!START_GROUPS.includes(e.group as StartGroup)) return skip('неизвестная группа')
      if (typeof e.name !== 'string' || e.name.trim() === '') return skip('нет названия')
      const path = parseMoves(e.moves)
      if (!path) return skip('недопустимые ходы')
      const id = trapId(path)
      if (!this.paths.has(id)) return skip('такой стартовой позиции нет в базе')
      if (entries.some((x) => x.id === id)) return skip('эта позиция уже есть в списке')
      entries.push({ id, group: e.group as StartGroup, name: e.name.trim(), moves: path.map(vertexToGtp) })
    })
    return new StartBook(this.paths, entries, this.skipped)
  }

  get count(): number {
    return this.paths.size
  }
  ids(): string[] {
    return [...this.paths.keys()]
  }
  has(id: string): boolean {
    return this.paths.has(id)
  }
  list(): StartListEntry[] {
    return [...this.entries]
  }
  isListed(id: string): boolean {
    return this.entries.some((e) => e.id === id)
  }
  /** The name of `id` on the list; null when it is not on it. */
  nameOf(id: string): string | null {
    return this.entries.find((e) => e.id === id)?.name ?? null
  }

  /** Spec (starts) 5.3: weight 1 / (1 + shows); null for an empty book. */
  pick(shows: (id: string) => number, rng: Rng): string | null {
    return pickLeastShown(this.ids(), shows, rng)
  }

  /** Spec (starts) 5.2: the moves of `id` in `corner`, mirrored in the corner's diagonal when `mirror`; Black first. */
  place(id: string, corner: Corner, mirror: boolean): Move[] {
    const path = this.paths.get(id)
    if (!path) throw new Error(`Unknown start ${id}`)
    return (mirror ? mirrorMoves(path) : path).map((m, i): Move => ({ color: colorAt(i), vertex: fromTopRight(m as Vertex, corner) }))
  }
}
```

- [ ] **Step 10: Run the tests and the type check**

Run: `npx vitest run packages/server/src/starts packages/server/src/jdb packages/server/src/traps packages/server/src/bot && npm run typecheck`
Expected: all PASS; no type errors. (Other places that switch on `Mode` may now need the new values only in Task 2/3; if the type check flags them here, report it rather than changing them.)

- [ ] **Step 11: Commit**

```bash
git add packages/server/src/jdb packages/server/src/bot/rng.ts packages/server/src/traps/book.ts packages/shared/src/types.ts packages/server/src/starts
git commit -m "feat(starts): the start category in JDB and the start book" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Server — loading, API, sessions and shows

**Files:**
- Modify: `packages/server/src/start.ts`, `packages/server/src/main.ts`, `packages/desktop/src/main.ts`, `packages/server/src/app.ts`
- Create: `packages/server/src/api/starts-routes.ts`
- Modify: `packages/server/src/store/migrations.ts`, `packages/server/src/store/repo.ts`
- Modify: `packages/server/src/session/service.ts`
- Tests: `packages/server/src/start.test.ts`, `packages/server/src/api/api.test.ts`, create `packages/server/src/store/starts-repo.test.ts`, create `packages/server/src/session/starts.test.ts`

**Interfaces:**
- Consumes (Task 1): `StartBook`, `writeTestStarts`, `testStartsTree`, `TEST_STARTS_LIST`, shared `StartRef`, `StartsInfo`, `Mode`.
- Produces: `ServerOptions.startsFile?`, `ServerOptions.startsListFile?`, `loadStarts(baseFile, listFile, log): StartBook`, `AppServices.starts`, `ServiceOptions.starts?`, `SessionServiceDeps.starts?`, `SessionRepo.startShows(): Map<string, number>`, `GET /api/starts` → `StartsInfo`.

- [ ] **Step 1: Loading in `packages/server/src/start.ts`**

Add to `ServerOptions` after `trapsFile`:

```ts
  /** The start positions base (packages/server/bases/starts.jdb); missing, null or unreadable turns the start modes off. */
  startsFile?: string | null
  /** The named start list (packages/server/bases/starts-list.json); missing or unreadable turns «Из списка» off. */
  startsListFile?: string | null
```

In `startServer`, next to `const traps = loadTraps(...)`: `const starts = loadStarts(options.startsFile, options.startsListFile, log)`, and pass `starts` in the `createServices` options object next to `traps`. Add at the end of the file (import `readFileSync` from `node:fs` and `StartBook` from `./starts/book`):

```ts
/** Spec (starts) 4.3: the starts base and its list; a missing or broken base turns both start modes off, a broken list only «Из списка». */
export function loadStarts(baseFile: string | null | undefined, listFile: string | null | undefined, log: (line: string) => void): StartBook {
  if (!baseFile) return StartBook.empty()
  let book: StartBook
  try {
    book = StartBook.loadBase(baseFile)
  } catch (err) {
    log(`База стартовых позиций недоступна: ${err instanceof Error ? err.message : String(err)}`)
    return StartBook.empty()
  }
  if (book.skipped.length > 0) log(`Пропущено стартовых позиций: ${book.skipped.length} (недопустимые позиции)`)
  if (!listFile) return book
  try {
    return book.withList(readFileSync(listFile, 'utf8'), log)
  } catch (err) {
    log(`Список стартовых позиций недоступен: ${err instanceof Error ? err.message : String(err)}`)
    return book
  }
}
```

- [ ] **Step 2: Paths in `packages/server/src/main.ts` and `packages/desktop/src/main.ts`**

`main.ts`, next to `trapsFile`:
```ts
  startsFile: process.env.JOSEKI_STARTS ?? join(repoRoot, 'packages', 'server', 'bases', 'starts.jdb'),
  startsListFile: process.env.JOSEKI_STARTS_LIST ?? join(repoRoot, 'packages', 'server', 'bases', 'starts-list.json'),
```
`packages/desktop/src/main.ts`, next to `trapsFile` (same pattern as it):
```ts
    startsFile: app.isPackaged ? join(resourcesDir, 'bases', 'starts.jdb') : join(resourcesDir, 'packages', 'server', 'bases', 'starts.jdb'),
    startsListFile: app.isPackaged ? join(resourcesDir, 'bases', 'starts-list.json') : join(resourcesDir, 'packages', 'server', 'bases', 'starts-list.json'),
```
(`electron-builder.config.cjs` already ships the whole `../server/bases` folder.)

- [ ] **Step 3: Services and the route**

`packages/server/src/api/starts-routes.ts`:
```ts
import type { StartsInfo } from '@joseki-dojo/shared'
import type { FastifyInstance } from 'fastify'
import type { StartBook } from '../starts/book'

export function registerStartsRoutes(app: FastifyInstance, starts: StartBook): void {
  app.get('/api/starts', async (): Promise<StartsInfo> => ({ count: starts.count, list: starts.list() }))
}
```

`packages/server/src/app.ts`: mirror `traps` exactly — `AppServices.starts: StartBook` (doc: «The loaded start positions; empty when there is none.»), `ServiceOptions.starts?: StartBook` (doc: «The start positions; default: an empty book.»), `const starts = options.starts ?? StartBook.empty()` in `createServices`, pass `starts` to `new SessionService({ … })`, return it in the services object, and `registerStartsRoutes(app, services.starts)` next to `registerTrapsRoutes`.

- [ ] **Step 4: Storage — migration 3 and the repository**

Append to the migrations array in `packages/server/src/store/migrations.ts`:
```ts
  {
    version: 3,
    name: '003_starts.sql',
    sql: `
ALTER TABLE sessions ADD COLUMN start_json TEXT;
`,
  },
```

`packages/server/src/store/repo.ts`: add `start_json: string | null` to `SessionRow`; in `insertSession` add `start_json` to the column list, `@start` to the values and `start: r.settings.start ? JSON.stringify(r.settings.start) : null` to the parameters; in `getSession` add `...(row.start_json ? { start: JSON.parse(row.start_json) as StartRef } : {})` after the `trap` line (import `StartRef`); and add:

```ts
  /** Spec (starts) 5.3: finished sessions per start position id. */
  startShows(): Map<string, number> {
    const rows = this.db
      .prepare(`SELECT json_extract(start_json, '$.id') AS id, COUNT(*) AS n FROM sessions WHERE status = 'finished' AND start_json IS NOT NULL GROUP BY id`)
      .all() as { id: string; n: number }[]
    return new Map(rows.map((r) => [r.id, r.n]))
  }
```

- [ ] **Step 5: Sessions in `packages/server/src/session/service.ts`**

- `SessionServiceDeps`: `/** The start positions; default: an empty book (the start modes are unavailable). */ starts?: StartBook`; store it in the constructor as `this.starts = d.starts ?? StartBook.empty()` (a `private readonly starts: StartBook` field).
- `validateSettings`: accept the four modes, and require a non-empty string `startId` for `'list'`:

```ts
const MODES: readonly Mode[] = ['free', 'traps', 'random', 'list']

export function validateSettings(s: SessionSettings): void {
  const ok =
    MODES.includes(s.mode) &&
    s.environment === 'empty' &&
    (s.userColor === 'B' || s.userColor === 'W' || s.userColor === 'random') &&
    typeof s.botRank === 'string' &&
    isBotRank(s.botRank) &&
    (s.corner === 'random' || CORNERS.includes(s.corner)) &&
    (s.mode !== 'list' || (typeof s.startId === 'string' && s.startId !== ''))
  if (!ok) throw new SessionError('Некорректные настройки тренировки', 'bad_request')
}
```
- In `start()`, after the traps line: `if (resolved.mode === 'random' || resolved.mode === 'list') return this.startPosition(resolved, settings.startId)`, and add after `startTrap`:

```ts
  /** Spec (starts) 5.2–5.3: a start from the list or picked by shows, put in the corner; the bot moves first when it is its turn. */
  private startPosition(resolved: ResolvedSettings, startId: string | undefined): SessionView {
    if (this.starts.count === 0) throw new SessionError('Стартовые позиции недоступны: нет базы', 'bad_request')
    let id: string | null
    if (resolved.mode === 'list') {
      if (startId === undefined || !this.starts.isListed(startId)) throw new SessionError('Такой позиции нет в списке', 'bad_request')
      id = startId
    } else {
      const shows = this.d.repo.startShows()
      id = this.starts.pick((s) => shows.get(s) ?? 0, this.rng)
    }
    if (id === null) throw new SessionError('Стартовые позиции недоступны: нет базы', 'bad_request')
    const mirror = this.rng() < 0.5
    const initialMoves = this.starts.place(id, resolved.corner, mirror)
    return this.create({ ...resolved, start: { id, name: this.starts.nameOf(id), mirror } }, initialMoves, null)
  }
```
(`create` → `afterPositionChanged` already lets the bot move when it is its turn.)

- [ ] **Step 6: Tests**

`packages/server/src/store/starts-repo.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { ResolvedSettings } from '@joseki-dojo/shared'
import { openDb } from './db'
import type { SessionRecord } from './records'
import { SessionRepo } from './repo'

const settings = (start?: ResolvedSettings['start']): ResolvedSettings => ({ mode: start ? 'list' : 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR', ...(start ? { start } : {}) })
const record = (id: string, start?: ResolvedSettings['start']): SessionRecord => ({
  id,
  createdAt: '2026-10-14T10:00:00.000Z',
  finishedAt: null,
  settings: settings(start),
  status: 'playing',
  parentSessionId: null,
  initialMoves: [],
  moves: [],
  summary: null,
})

describe('start positions in the repository', () => {
  it('keeps the start of a session', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    repo.insertSession(record('a', { id: 'abcd1234', name: 'Имя', mirror: true }))
    repo.insertSession(record('b'))
    expect(repo.getSession('a')?.settings.start).toEqual({ id: 'abcd1234', name: 'Имя', mirror: true })
    expect(repo.getSession('b')?.settings.start).toBeUndefined()
  })

  it('counts only finished sessions as shows', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    repo.insertSession(record('a', { id: 'x', name: null, mirror: false }))
    repo.insertSession(record('b', { id: 'x', name: null, mirror: false }))
    repo.insertSession(record('c', { id: 'y', name: null, mirror: false }))
    repo.insertSession(record('d'))
    repo.setStatus('a', 'finished', '2026-10-14T10:05:00.000Z')
    repo.setStatus('c', 'abandoned', null)
    repo.setStatus('d', 'finished', '2026-10-14T10:05:00.000Z')
    expect(repo.startShows()).toEqual(new Map([['x', 1]]))
  })
})
```

`packages/server/src/session/starts.test.ts` (same setup style as `traps.test.ts`):
```ts
import { describe, expect, it, vi } from 'vitest'
import { gtpToVertex, type SessionSettings, type SessionView, type Vertex } from '@joseki-dojo/shared'
import { StubEngine, testConfig } from '../../test/helpers'
import { AnalysisScheduler } from '../analysis/scheduler'
import { HumanBot } from '../bot/bot'
import { mulberry32 } from '../bot/rng'
import { decodeJdb, encodeJdb, trapId } from '../jdb'
import { StartBook } from '../starts/book'
import { TEST_STARTS_LIST, testStartsTree } from '../starts/fixture'
import { openDb } from '../store/db'
import { SessionRepo } from '../store/repo'
import { SessionService } from './service'

const V = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
const ID_B = trapId(['Q16', 'O17', 'R14'].map(V))
const ID_C = trapId(['Q17', 'R15'].map(V))
const book = (): StartBook => StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})

const settings = (over: Partial<SessionSettings> = {}): SessionSettings => ({ mode: 'list', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR', startId: ID_C, ...over })

/** `draws` feed `pick` (random mode) and the mirror coin: 0.9 means no mirror. */
function setup(starts: StartBook = book(), draws: number[] = [0.9]) {
  const engine = new StubEngine()
  const repo = new SessionRepo(openDb(':memory:'))
  const cfg = testConfig()
  let n = 0
  let k = 0
  const service = new SessionService({
    repo,
    engine,
    config: cfg,
    analysis: new AnalysisScheduler(engine, repo, cfg.analysis),
    bot: new HumanBot(engine, mulberry32(1)),
    starts,
    publish: () => undefined,
    onFinished: () => undefined,
    rng: () => draws[k++ % draws.length],
    newId: () => `s${++n}`,
    now: () => '2026-10-14T10:00:00.000Z',
  })
  return { service, repo }
}

const waitMoves = async (service: SessionService, id: string, count: number): Promise<SessionView> => {
  await vi.waitFor(() => {
    const v = service.view(id)
    expect(v.moves.length).toBe(count)
    expect(v.botThinking).toBe(false)
  })
  return service.view(id)
}

describe('start position sessions', () => {
  it('puts a list position on the board and lets the user move when it is their turn', () => {
    const { service } = setup()
    const v = service.start(settings())
    expect(v.initialMoves).toEqual([
      { color: 'B', vertex: V('Q17') },
      { color: 'W', vertex: V('R15') },
    ])
    expect(v.settings.start).toEqual({ id: ID_C, name: 'Тестовое начало 3-4', mirror: false })
    expect(v.toMove).toBe('B')
    expect(v.moves).toEqual([])
  })

  it('lets the bot move first when it is the bot\'s turn', async () => {
    const { service } = setup()
    const v = service.start(settings({ userColor: 'W' }))
    const after = await waitMoves(service, v.id, 1)
    expect(after.moves[0].actor).toBe('bot')
    expect(after.toMove).toBe('W')
  })

  it('mirrors on the coin and moves the position to the chosen corner', () => {
    const { service } = setup(book(), [0.1])
    const v = service.start(settings({ corner: 'BL' }))
    expect(v.settings.start?.mirror).toBe(true)
    // Q17 mirrored in the top-right diagonal is R16; in the bottom-left corner it is C4.
    expect(v.initialMoves[0]).toEqual({ color: 'B', vertex: V('C4') })
  })

  it('picks a random position by shows and names it when it is on the list', () => {
    const { service } = setup(book(), [0.99, 0.9])
    const v = service.start(settings({ mode: 'random', startId: undefined }))
    expect(v.settings.mode).toBe('random')
    expect(v.settings.start?.id).toBe(ID_C)
    expect(v.settings.start?.name).toBe('Тестовое начало 3-4')
  })

  it('refuses the start modes without a base and a list id that is not on the list', () => {
    const { service } = setup(StartBook.empty())
    expect(() => service.start(settings({ mode: 'random', startId: undefined }))).toThrow('Стартовые позиции недоступны')
    const listed = setup().service
    expect(() => listed.start(settings({ startId: 'nope' }))).toThrow('Такой позиции нет в списке')
    expect(() => listed.start(settings({ startId: undefined }))).toThrow('Некорректные настройки тренировки')
  })

  it('counts a finished session as a show', () => {
    const { service, repo } = setup()
    const v = service.start(settings())
    expect(repo.startShows()).toEqual(new Map())
    service.finish(v.id)
    expect(repo.startShows()).toEqual(new Map([[ID_C, 1]]))
  })
})
```

Notes for the implementer: verify the mirror test's expectation against `fromTopRight` and `mirrorDiagonal` before trusting the comment (Q17 = (15, 2); its diagonal mirror is (16, 3) = R16; in the bottom-left corner R16 maps to (2, 15) = C4). In the random-mode test the ids are in tree order `[Q16 O17, Q16 O17 R14, Q17 R15]` with no shows, so a draw of 0.99 lands on the third. If the bot-first test needs the analysis or a human policy from the stub, follow how `traps.test.ts` drives `HumanBot` with `StubEngine`.

`packages/server/src/api/api.test.ts` — add next to `describe('GET /api/traps')` (import `StartBook`, `testStartsTree`, `TEST_STARTS_LIST`):
```ts
describe('GET /api/starts', () => {
  it('reports an empty book without a base', async () => {
    expect(await (await fetch(`http://${host}/api/starts`)).json()).toEqual({ count: 0, list: [] })
  })

  it('reports the loaded base and its list', async () => {
    const config = testConfig()
    const starts = StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})
    const services = createServices(config, fakeEngine(), serviceOptions(config, { starts }))
    const other = await buildApp(services)
    try {
      const res = await other.inject({ method: 'GET', url: '/api/starts', headers: { host: '127.0.0.1:1' } })
      expect(res.json()).toEqual({ count: 3, list: starts.list() })
    } finally {
      await other.close()
      await services.engine.stop()
      services.db.close()
    }
  })
})
```
(If `serviceOptions` does not pass through unknown keys, extend it the way it handles `traps`.)

`packages/server/src/start.test.ts` — add a `describe('starts base')` in the style of the existing `describe('traps base')`, with a helper that starts the server with `startsFile`/`startsListFile` and reads `GET /api/starts`; cover:
- both files written by `writeTestStarts` → `{ count: 3, list: <2 entries> }` and no log line starting with `База стартовых позиций` or `Список стартовых позиций`;
- a broken base file (`'nonsense'`) → `{ count: 0, list: [] }` and a log line starting with `База стартовых позиций недоступна: `;
- a good base and a broken list (`'not json'`) → `count: 3`, `list: []` and a log line starting with `Список стартовых позиций недоступен: `;
- no files given → `{ count: 0, list: [] }` and no such log lines.

- [ ] **Step 7: Run the tests and the type check**

Run: `npx vitest run packages/server && npm run typecheck`
Expected: all PASS; no type errors. (The web package may report type errors about the new `Mode` values only if it switches exhaustively on `Mode`; if so, report them — Task 3 covers the web.)

- [ ] **Step 8: Commit**

```bash
git add packages/server packages/desktop/src/main.ts
git commit -m "feat(starts): load the start positions, serve them and start sessions from them" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Web — the two cards, the list and the crumbs; e2e

**Files:**
- Modify: `packages/web/src/api.ts`, `packages/web/src/App.tsx`, `packages/web/src/screens/StartScreen.tsx`, `packages/web/src/styles/screens.css`
- Create: `packages/web/src/components/StartList.tsx`
- Create: `e2e/make-starts.ts`, `e2e/starts.spec.ts`; Modify: `playwright.config.ts`, `.gitignore`

**Interfaces:**
- Consumes: `GET /api/starts` → `StartsInfo`; `SessionSettings.startId`; `ResolvedSettings.start`; `START_GROUPS`.

- [ ] **Step 1: `fetchStarts` in `packages/web/src/api.ts`** (next to `fetchTraps`, import `StartsInfo`)

```ts
/** Spec (starts) 5.1: the size of the starts base and the named list; an empty base turns both start modes off. */
export async function fetchStarts(): Promise<StartsInfo> {
  const res = await fetch('/api/starts')
  if (!res.ok) throw new Error(`Не удалось узнать базу стартовых позиций: HTTP ${res.status}`)
  return (await res.json()) as StartsInfo
}
```

- [ ] **Step 2: `packages/web/src/components/StartList.tsx`**

```tsx
import { gtpToVertex, START_GROUPS, type StartListEntry } from '@joseki-dojo/shared'

const N = 11
const STEP = 10
const PAD = 6
const SIZE = PAD * 2 + STEP * (N - 1)
const at = (i: number): number => PAD + i * STEP
/** Zone columns start at x = 8 (the top-right 11×11 corner). */
const ZONE_X0 = 8

/** Spec (starts) 5.1: the top-right 11×11 corner with the stones of a start (canonical moves, Black first). */
export function StartPreview({ moves }: { moves: string[] }) {
  const stones = moves.flatMap((m, i) => {
    const v = gtpToVertex(m)
    return v === 'pass' ? [] : [{ x: v[0] - ZONE_X0, y: v[1], black: i % 2 === 0 }]
  })
  return (
    <svg class="start-preview" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
      <rect width={SIZE} height={SIZE} rx="4" fill="var(--board)" />
      <g stroke="var(--board-line)" stroke-width="0.6">
        {Array.from({ length: N }, (_, i) => (
          <path key={`h${i}`} d={`M0 ${at(i)}H${at(N - 1)}`} />
        ))}
        {Array.from({ length: N }, (_, i) => (
          <path key={`v${i}`} d={`M${at(i)} ${at(0)}V${SIZE}`} />
        ))}
      </g>
      <circle cx={at(15 - ZONE_X0)} cy={at(3)} r="1.4" fill="var(--board-line)" />
      {stones.map((s, i) => (
        <circle key={i} cx={at(s.x)} cy={at(s.y)} r="4.4" fill={s.black ? '#17181c' : '#f4f4f1'} stroke="var(--stone-ring)" stroke-width="0.6" />
      ))}
    </svg>
  )
}

export interface StartListProps {
  entries: StartListEntry[]
  selected: string | null
  onSelect: (id: string) => void
}

/** Spec (starts) 5.1: the named list grouped by the first move, one radio row per position. */
export function StartList({ entries, selected, onSelect }: StartListProps) {
  return (
    <div class="start-list" role="radiogroup" aria-label="Стартовая позиция">
      {START_GROUPS.map((group) => {
        const rows = entries.filter((e) => e.group === group)
        if (rows.length === 0) return null
        return (
          <section key={group}>
            <div class="label">{group}</div>
            <div class="start-rows">
              {rows.map((e) => (
                <label key={e.id} class="start-row">
                  <input type="radio" name="start" checked={selected === e.id} onChange={() => onSelect(e.id)} />
                  <StartPreview moves={e.moves} />
                  <span>{e.name}</span>
                </label>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Styles — append to `packages/web/src/styles/screens.css`**

```css
.start-list { display: grid; gap: 12px; margin-top: 12px; }
.start-rows { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.start-row { position: relative; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-raised); cursor: pointer; }
.start-row input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
.start-row:has(input:checked) { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.start-row:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.start-preview { width: 56px; height: 56px; flex: none; }
```
(If `.mode` uses different token names for the selected and focus states, use the same ones as `.mode` so the list matches the cards.)

- [ ] **Step 4: `packages/web/src/screens/StartScreen.tsx`**

- Props: replace nothing; add
```ts
  /** Start positions in the base; 0 turns «Случайно» and «Из списка» off. */
  startsCount?: number
  /** The named list; empty turns «Из списка» off. */
  startsList?: StartListEntry[]
```
and destructure `startsCount = 0, startsList = []`. State: `const [startId, setStartId] = useState<string | null>(null)`.
- The two cards become:
```tsx
            <label class="mode">
              <input type="radio" name="mode" checked={mode === 'random'} disabled={startsCount === 0} onChange={() => setMode('random')} />
              <Dice3 aria-hidden="true" />
              <b>Случайно</b>
              <span class="d">{startsCount > 0 ? 'позиция из базы дзёсеки' : 'база стартовых позиций недоступна'}</span>
            </label>
            <label class="mode">
              <input type="radio" name="mode" checked={mode === 'list'} disabled={startsList.length === 0} onChange={() => setMode('list')} />
              <ListChecks aria-hidden="true" />
              <b>Из списка</b>
              <span class="d">{startsList.length > 0 ? 'выберите дзёсеки' : 'база стартовых позиций недоступна'}</span>
            </label>
```
- Right after the modes radiogroup `div`: `{mode === 'list' && <StartList entries={startsList} selected={startId} onSelect={setStartId} />}`.
- The start button: `disabled={busy || (mode === 'list' && startId === null)}` and `onClick={() => onStart({ mode, environment: 'empty', userColor, botRank, corner, ...(mode === 'list' && startId ? { startId } : {}) })}`.

- [ ] **Step 5: `packages/web/src/App.tsx`**

- `const [starts, setStarts] = useState<StartsInfo | null>(null)` and an effect like the traps one: `fetchStarts().then(setStarts).catch(() => setStarts({ count: 0, list: [] }))` on `[ready, healthTick]` with the comment «Starts spec 5.1: the start cards are available only when the base holds positions.».
- `StartScreen` gets `startsCount={starts?.count ?? 0}` and `startsList={starts?.list ?? []}`.
- Crumbs: a helper above the component

```ts
/** Starts spec 5.4: a start session is named after its position; the other modes keep their names. */
function sessionTitle(settings: ResolvedSettings): string {
  if (settings.start) return settings.start.name ?? 'Случайная позиция'
  return settings.mode === 'traps' ? 'Ловушка' : 'Свободная тренировка'
}
```
In a game `crumb = sessionTitle(session.settings)`; in the review `crumb = session.settings.start ? `Разбор: ${session.settings.start.name ?? 'случайная позиция'}` : 'Разбор тренировки'`.

- [ ] **Step 6: e2e — `e2e/make-starts.ts`, `e2e/starts.spec.ts`, `playwright.config.ts`, `.gitignore`**

`e2e/make-starts.ts`:
```ts
// Writes e2e/starts.test.jdb and e2e/starts-list.test.json: one start whose moves lie on the corner's diagonal, so its
// coordinates do not depend on the random mirror. Q16 and R17; Black (the user) is to move.
import { writeFileSync } from 'node:fs'
import { encodeJdb, type JdbNode } from '../packages/server/src/jdb'

const node = (move: [number, number], category: JdbNode['category'] = 'none', children: JdbNode[] = []): JdbNode => ({ move, category, loss: null, children })

const tree = { kind: 'starts' as const, verified: false, roots: [node([15, 3], 'none', [node([16, 2], 'start')])] }
writeFileSync('e2e/starts.test.jdb', encodeJdb(tree))
writeFileSync('e2e/starts-list.test.json', JSON.stringify([{ group: '4-4', name: 'Тестовое начало', moves: 'Q16 R17' }]))
```

`e2e/starts.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test'

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)

// e2e/make-starts.ts: Q16 and R17 are on the board; Black (the user) moves first.
test('a start from the list: the position is on the board and its name is in the crumbs', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: /Из списка/ }).check()
  await expect(page.getByRole('button', { name: 'Начать тренировку' })).toBeDisabled()
  await page.getByRole('radio', { name: /Тестовое начало/ }).check()
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()

  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(page.getByText('Тестовое начало')).toBeVisible()
  await expect(page.getByTestId('moves-count')).toHaveText('0')
  await vertex(page, 13, 2).click()
  await expect(page.getByTestId('moves-count')).toHaveText('2')
  await page.getByRole('button', { name: 'Закончить' }).click()
  await expect(page.getByText('Разбор: Тестовое начало')).toBeVisible()
})
```
(Check `moves-count` semantics against `GameScreen`: in the traps e2e it counts session moves without the initial ones; adjust the expected numbers only if they differ.)

`playwright.config.ts`: in the first `webServer` command, add `npx tsx e2e/make-starts.ts && ` right after `npx tsx e2e/make-traps.ts && `, and add to its `env`: `JOSEKI_STARTS: 'e2e/starts.test.jdb', JOSEKI_STARTS_LIST: 'e2e/starts-list.test.json'`. `.gitignore`: add `e2e/starts-list.test.json` next to `e2e/*.jdb`.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run typecheck && npm run e2e`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web e2e/make-starts.ts e2e/starts.spec.ts playwright.config.ts .gitignore
git commit -m "feat(web): «Случайно» and «Из списка» start a training from a joseki position" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4 (controller, outside the repository): the data

Done by the controller in `D:\private\joseki-dojo-starts\` (outside the repository, like the trap crawl); nothing of it is committed except the two output files. Can run in parallel with Tasks 1–3.

- [ ] **Step 1: Dictionary walk (spec 3.1).** A local script walks the dictionary's node API from the root, following only moves marked good or joseki, to depth 8; pass or a move outside the top-right 11×11 zone ends a branch. At most one request a second, retries with a pause, every answer cached to disk. A candidate: depth 3–8, at least two good continuations, not marked as the end of a joseki. Paths canonicalized (traps spec 3.3), transpositions merged (same final position in either orientation, shortest path kept).
- [ ] **Step 2: Candidates (spec 3.3, 3.4).** A local script turns the walk into candidates: the normal ones (3.1) and the starts after a dubious move (3.4, the bad and questionable moves come from the cached nodes, no extra requests); canonical form, merged transpositions. No pro-game threshold.
- [ ] **Step 3: Summary for the owner.** How many normal and dubious candidates, by depth and first move.
- [ ] **Step 4: The named list (spec 3.2, 3.3).** About 70 positions in the five groups: the start position of each chapter of a classic basic-joseki reference; their pro-game counts are read through the pro-game site's own page in the built-in browser (at most one query a second, only the list positions); rarely played ones out; known long lines — taisha, flying knife and the like — in, cut at their first ≤ 8 moves; Russian names. Show the owner a table (group, name, moves, counts in total and since 2016) and wait for approval.
- [ ] **Step 5: Write the files.** With the repository's JDB library: `packages/server/bases/starts.jdb` (kind `starts`, not verified; the normal candidates ∪ the list positions marked `start`, the dubious ones marked `dubious`) and `packages/server/bases/starts-list.json`. Check with `npm run jdb:dump -- packages/server/bases/starts.jdb` and by starting the server (no log lines about skipped starts or list entries). Commit: `feat(starts): the start positions and the named list`. Archive the caches next to the scripts; delete nothing.
- [ ] **Step 6: PR text.** The summary (candidates, dubious starts, list size) goes into the PR description for the owner — with no names of the sources.

---

### Task 5: Starts after the opponent's dubious move («Случайно» only)

Spec: 3.4, 4.1 (category 5), 4.2, 5.2–5.4. Applies on top of Tasks 1–3.

**Files:**
- Modify: `packages/server/src/jdb/format.ts`, `packages/server/src/jdb/format.test.ts`, `packages/server/src/jdb/dump.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/server/src/starts/book.ts`, `packages/server/src/starts/book.test.ts`, `packages/server/src/starts/fixture.ts`
- Modify: `packages/server/src/session/service.ts`, `packages/server/src/session/starts.test.ts`
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Produces: `NodeCategory` with `'dubious'` (code 5); `StartRef.dubious?: boolean`, `StartRef.swapColors?: boolean`; `DUBIOUS_SHARE = 0.1`; `StartBook.dubiousCount`, `dubiousIds()`, `isDubious(id)`, `place(id, corner, mirror, swapColors = false)`; `StartBook.count` counts both sets; `ids()` stays the normal starts only; fixture `testDubiousStartsTree()`.

- [ ] **Step 1: Category 5 in `format.ts`**

```ts
export type NodeCategory = 'none' | 'good' | 'caught' | 'trap' | 'start' | 'dubious'
```
```ts
const CATEGORIES: NodeCategory[] = ['none', 'good', 'caught', 'trap', 'start', 'dubious']
```
In `format.test.ts`, the test «rejects a category above start» becomes «rejects a category above dubious» and writes `bytes[18] = 6`; add a round-trip test like «writes and reads start nodes» for a `'dubious'` node (`base.nodesOf('dubious')`).

- [ ] **Step 2: `dump.ts`** — a dubious start shows its id like a start, and the starts header counts both kinds. Replace the Task 1 header code with:

```ts
  const counts = base.kind === 'starts' ? `starts: ${base.nodesOf('start').length}, dubious: ${base.nodesOf('dubious').length}` : `traps: ${base.nodesOf('trap').length}`
  const lines = [`${base.kind}, verified: ${base.verified ? 'yes' : 'no'}, nodes: ${base.size}, ${counts}`]
```
```ts
    if (cat === 'trap' || cat === 'start' || cat === 'dubious') line += ` ${trapId(base.path(i))}`
```

- [ ] **Step 3: `StartRef` in `packages/shared/src/types.ts`** — add after `mirror`:

```ts
  /** Spec (starts) 3.4: the start ends with the opponent's dubious move («Случайно» only). */
  dubious?: boolean
  /** The colours of a dubious start were swapped so that the user answers the dubious move. */
  swapColors?: boolean
```

- [ ] **Step 4: `StartBook` — the dubious set**

- A second map `dubiousPaths: ReadonlyMap<string, CanonicalMove[]>` next to `paths` (constructor parameter after `paths`; `empty()` passes an empty map; `withList` passes it through unchanged).
- `fromBase`: playable `'dubious'` nodes go to `dubiousPaths`, unplayable ones to `skipped` (same `isPlayable`).
- `export const DUBIOUS_SHARE = 0.1` with the doc comment: Spec (starts) 5.3: the share of «Случайно» picks that start after the opponent's dubious move.
- `get count(): number { return this.paths.size + this.dubiousPaths.size }`; `get dubiousCount(): number`; `dubiousIds(): string[]`; `isDubious(id): boolean`; `has(id)` checks both maps; `ids()` stays the normal starts; `withList` keeps checking `this.paths` only, so a dubious path in the list is skipped as «такой стартовой позиции нет в базе».
- `pick`:

```ts
  /** Spec (starts) 5.3: a dubious start with probability DUBIOUS_SHARE (when there are both kinds), weight 1 / (1 + shows) inside the set. */
  pick(shows: (id: string) => number, rng: Rng): string | null {
    const dubious = this.dubiousPaths.size > 0 && (this.paths.size === 0 || rng() < DUBIOUS_SHARE)
    return pickLeastShown(dubious ? this.dubiousIds() : this.ids(), shows, rng)
  }
```
With no dubious starts `pick` still makes exactly one `rng()` draw — the Task 1 and Task 2 tests rely on that.
- `place(id, corner, mirror, swapColors = false)`: the path comes from either map; each move's colour is `colorAt(i)`, or the other colour when `swapColors`.

`starts/fixture.ts` — add (and use it from both test files below):

```ts
/** testStartsTree plus one start after a dubious move: Q16 O17 O16 (Black's dubious O16). */
export function testDubiousStartsTree(): JdbTree {
  const tree = testStartsTree()
  tree.roots[0].children[0].children.push(node('O16', 'dubious'))
  return tree
}
```

Tests in `book.test.ts` — a `describe('dubious starts')` with `const D = id('Q16 O17 O16')` and a book from `testDubiousStartsTree()`. Cover: `count` 4, `dubiousCount` 1, `ids()` still `[A, B, C]`, `dubiousIds()` `[D]`, `isDubious(D)`, `has(D)`; a list entry `'Q16 O17 O16'` is skipped with a log line ending «такой стартовой позиции нет в базе»; `pick` with draws `[0.05, 0]` returns `D`, with `[0.5, 0]` returns `A`; `place(D, 'TR', false, true)` gives `W Q16, B O17, W O16`.

- [ ] **Step 5: Sessions in `service.ts`** — in `startPosition`, replace the placement and `create` lines:

```ts
    const dubious = this.starts.isDubious(id)
    const mirror = this.rng() < 0.5
    let initialMoves = this.starts.place(id, resolved.corner, mirror)
    // Spec (starts) 5.2: after a dubious move the user answers at once — swap the colours when the user chose the side that played it.
    const swapColors = dubious && initialMoves[initialMoves.length - 1].color === resolved.userColor
    if (swapColors) initialMoves = this.starts.place(id, resolved.corner, mirror, true)
    const start: StartRef = { id, name: this.starts.nameOf(id), mirror, ...(dubious ? { dubious: true, swapColors } : {}) }
    return this.create({ ...resolved, start }, initialMoves, null)
```
Tests in `starts.test.ts` — a `describe('dubious starts')` with a book from `testDubiousStartsTree()` (plus the list):
- Black user, random mode, draws `[0.05, 0, 0.9]` (share, pick, mirror coin): `settings.start` is `{ id: D, name: null, mirror: false, dubious: true, swapColors: true }`, the initial moves are `W Q16, B O17, W O16`, `toMove` is `'B'`, no session moves.
- White user, same draws: `swapColors: false`, initial moves `B Q16, W O17, B O16`, `toMove` is `'W'`.

- [ ] **Step 6: The review crumb in `App.tsx`** (the game crumb stays «Случайная позиция» — no hint during the game):

```ts
    const start = session.settings.start
    crumb = start ? `Разбор: ${start.name ?? (start.dubious ? 'случайная позиция (ход соперника похуже)' : 'случайная позиция')}` : 'Разбор тренировки'
```

- [ ] **Step 7: Run everything**

Run: `npm test && npm run typecheck && npm run e2e`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server packages/shared packages/web
git commit -m "feat(starts): starts after the opponent's dubious move in «Случайно»" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## The tree of positions in «Из списка» (spec 3.3, 4.2, 5.1, 6)

«Из списка» shows only a tree: an outline on the left, a corner board with lettered continuations and cards on the right. The list file gains branches (names of the 2-move nodes), short captions and the «редко» flag; all 88 chapter positions are on it.

### Task 6: The list file with branches, short names and rare positions

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/server/src/starts/book.ts`, `packages/server/src/starts/fixture.ts`, `packages/server/src/starts/book.test.ts`
- Modify: `packages/server/src/api/starts-routes.ts`, `packages/server/src/api/api.test.ts`, `packages/server/src/start.test.ts`
- Modify: `packages/web/src/next-settings.test.ts` (the `entry` helper only), `e2e/make-starts.ts`, `README.md`

**Interfaces:**
- Produces: `StartListEntry` with `short: string` (the name when the file has none) and `rare: boolean`; `StartBranch { moves: string[]; name: string }` (canonical GTP); `StartsInfo.branches: StartBranch[]`; `StartBook.branches(): StartBranch[]`; `TEST_STARTS_LIST` is an object `{ branches, positions }`.

- [ ] **Step 1: Types in `packages/shared/src/types.ts`** — replace `StartListEntry` and `StartsInfo`:

```ts
/** One position of the named list; `moves` are canonical (top-right corner, Black first) in GTP. */
export interface StartListEntry {
  id: string
  group: StartGroup
  /** The full name: crumbs of the game and the review. */
  name: string
  /** The caption in the tree (starts spec 5.1); the full name when the list file has none. */
  short: string
  /** Played by pros fewer than 10 times since 2016 (starts spec 3.3): shown muted with «редко». */
  rare: boolean
  moves: string[]
}

/** A named node of the tree that is not a position itself, e.g. «Малое приближение» (starts spec 3.3); canonical GTP moves. */
export interface StartBranch {
  moves: string[]
  name: string
}

/** What `GET /api/starts` reports: how many start positions the base holds, the named list and its branches. */
export interface StartsInfo {
  count: number
  list: StartListEntry[]
  branches: StartBranch[]
}
```

- [ ] **Step 2: Fixture `packages/server/src/starts/fixture.ts`** — replace `TEST_STARTS_LIST`:

```ts
export const TEST_STARTS_LIST = {
  branches: [{ moves: 'Q16 O17', name: 'Тестовая ветка' }],
  positions: [
    { group: '4-4', name: 'Тестовое начало 4-4', short: 'Начало 4-4', moves: 'Q16 O17 R14' },
    { group: '3-4', name: 'Тестовое начало 3-4', moves: 'Q17 R15', rare: true },
  ],
}
```

- [ ] **Step 3: Failing tests in `packages/server/src/starts/book.test.ts`** — replace the tests «reads the named list in file order», «canonicalizes the moves of a list entry», «skips bad list entries with a log line each» and «refuses a list that is not an array»; in «skips a dubious path in the list» wrap the array: `JSON.stringify({ positions: [{ group: '4-4', name: 'X', moves: 'Q16 O17 O16' }] })`.

```ts
  it('reads the named list in file order, with short names, rare marks and branches', () => {
    const b = listed()
    expect(b.list()).toEqual([
      { id: B, group: '4-4', name: 'Тестовое начало 4-4', short: 'Начало 4-4', rare: false, moves: ['Q16', 'O17', 'R14'] },
      { id: C, group: '3-4', name: 'Тестовое начало 3-4', short: 'Тестовое начало 3-4', rare: true, moves: ['Q17', 'R15'] },
    ])
    expect(b.branches()).toEqual([{ moves: ['Q16', 'O17'], name: 'Тестовая ветка' }])
    expect([b.isListed(B), b.isListed(A)]).toEqual([true, false])
    expect([b.nameOf(C), b.nameOf(A)]).toEqual(['Тестовое начало 3-4', null])
  })

  it('canonicalizes the moves of positions and branches', () => {
    // R14 is O17 mirrored in the diagonal.
    const b = book().withList(JSON.stringify({ branches: [{ moves: 'Q16 R14', name: 'Ветка' }], positions: [{ group: '4-4', name: 'Зеркально', moves: 'Q16 R14 O17' }] }), () => {})
    expect(b.list().map((e) => e.moves)).toEqual([['Q16', 'O17', 'R14']])
    expect(b.branches()).toEqual([{ moves: ['Q16', 'O17'], name: 'Ветка' }])
  })

  it('skips bad positions with a log line each', () => {
    const lines: string[] = []
    const positions = [
      { group: '6-6', name: 'x', moves: 'Q16 O17' },
      { group: '4-4', name: ' ', moves: 'Q16 O17' },
      { group: '4-4', name: 'x', moves: 'Q16 Z99' },
      { group: '4-4', name: 'x', moves: 'Q16 O16' },
      { group: '4-4', name: 'first', moves: 'Q16 O17' },
      { group: '4-4', name: 'again', moves: 'Q16 O17' },
      null,
    ]
    const b = book().withList(JSON.stringify({ positions }), (l) => lines.push(l))
    expect(b.list().map((e) => e.name)).toEqual(['first'])
    expect(lines).toHaveLength(6)
    expect(lines[0]).toMatch(/^Список стартовых позиций, позиция 1: /)
  })

  it('skips bad branches with a log line each', () => {
    const lines: string[] = []
    const branches = [
      { moves: 'Q16 O17', name: ' ' },
      { moves: 'Q16', name: 'один ход' },
      { moves: 'Q16 Z99', name: 'плохой ход' },
      { moves: 'Q16 O17 R14', name: 'это позиция' },
      { moves: 'Q17 R16', name: 'без позиций' },
      { moves: 'Q16 O17', name: 'ветка' },
      { moves: 'Q16 O17', name: 'повтор' },
    ]
    const b = book().withList(JSON.stringify({ branches, positions: TEST_STARTS_LIST.positions }), (l) => lines.push(l))
    expect(b.branches()).toEqual([{ moves: ['Q16', 'O17'], name: 'ветка' }])
    expect(lines).toHaveLength(6)
    expect(lines[0]).toMatch(/^Список стартовых позиций, ветка 1: /)
  })

  it('refuses a list that is not an object with positions', () => {
    for (const text of ['[]', '{"branches":[]}', 'null']) expect(() => book().withList(text, () => {})).toThrow('Список стартовых позиций должен быть объектом с массивом positions')
    expect(() => book().withList('not json', () => {})).toThrow()
  })
```

Run: `npx vitest run packages/server/src/starts/book.test.ts`
Expected: FAIL (`branches` is not a function, entries without `short`/`rare`).

- [ ] **Step 4: `StartBook` in `packages/server/src/starts/book.ts`**

Import `type StartBranch` from `@joseki-dojo/shared`. The constructor gets the branches after the entries:

```ts
  private constructor(
    /** Canonical path of each playable start, by id (the trap id of the path), in tree order. */
    private readonly paths: ReadonlyMap<string, CanonicalMove[]>,
    /** The same for the starts after the opponent's dubious move. */
    private readonly dubiousPaths: ReadonlyMap<string, CanonicalMove[]>,
    private readonly entries: readonly StartListEntry[],
    private readonly branchList: readonly StartBranch[],
    /** Ids of the starts left out because they cannot be played. */
    readonly skipped: readonly string[] = [],
  ) {}
```

`empty()` returns `new StartBook(new Map(), new Map(), [], [])`; `fromBase` returns `new StartBook(paths, dubiousPaths, [], [], skipped)`. Replace `withList`:

```ts
  /**
   * Spec (starts) 4.2: this book with the named list from `json`, the text of starts-list.json — `positions` (the list)
   * and `branches` (names of tree nodes that are not positions). A bad position or branch is left out with one `log`
   * line. Throws when the text is not an object with a `positions` array.
   */
  withList(json: string, log: (line: string) => void): StartBook {
    const raw = JSON.parse(json) as unknown
    const file = (raw ?? {}) as Record<string, unknown>
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !Array.isArray(file.positions)) {
      throw new Error('Список стартовых позиций должен быть объектом с массивом positions')
    }
    const entries: StartListEntry[] = []
    ;(file.positions as unknown[]).forEach((item, k) => {
      const skip = (why: string): void => log(`Список стартовых позиций, позиция ${k + 1}: ${why}`)
      const e = (item ?? {}) as Record<string, unknown>
      if (!isStartGroup(e.group)) return skip('неизвестная группа')
      if (typeof e.name !== 'string' || e.name.trim() === '') return skip('нет названия')
      const path = parseMoves(e.moves)
      if (!path) return skip('недопустимые ходы')
      const id = trapId(path)
      if (!this.paths.has(id)) return skip('такой стартовой позиции нет в базе')
      if (entries.some((x) => x.id === id)) return skip('эта позиция уже есть в списке')
      const name = e.name.trim()
      const short = typeof e.short === 'string' && e.short.trim() !== '' ? e.short.trim() : name
      entries.push({ id, group: e.group, name, short, rare: e.rare === true, moves: path.map(vertexToGtp) })
    })
    const branches: StartBranch[] = []
    const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((m, i) => m === b[i])
    ;(Array.isArray(file.branches) ? (file.branches as unknown[]) : []).forEach((item, k) => {
      const skip = (why: string): void => log(`Список стартовых позиций, ветка ${k + 1}: ${why}`)
      const b = (item ?? {}) as Record<string, unknown>
      if (typeof b.name !== 'string' || b.name.trim() === '') return skip('нет названия')
      const path = parseMoves(b.moves)
      if (!path || path.length < 2 || path.length > 8) return skip('недопустимые ходы')
      const moves = path.map(vertexToGtp)
      if (entries.some((e) => same(e.moves, moves))) return skip('совпадает с позицией списка')
      if (branches.some((x) => same(x.moves, moves))) return skip('эта ветка уже есть')
      if (!entries.some((e) => e.moves.length > moves.length && same(e.moves.slice(0, moves.length), moves))) return skip('под веткой нет позиций')
      branches.push({ moves, name: b.name.trim() })
    })
    return new StartBook(this.paths, this.dubiousPaths, entries, branches, this.skipped)
  }
```

Add next to `list()`:

```ts
  branches(): StartBranch[] {
    return [...this.branchList]
  }
```

Run: `npx vitest run packages/server/src/starts/book.test.ts`
Expected: PASS.

- [ ] **Step 5: API** — `packages/server/src/api/starts-routes.ts`:

```ts
  app.get('/api/starts', async (): Promise<StartsInfo> => ({ count: starts.count, list: starts.list(), branches: starts.branches() }))
```

In `packages/server/src/api/api.test.ts` the empty book reports `{ count: 0, list: [], branches: [] }` and the loaded one `{ count: 3, list: starts.list(), branches: starts.branches() }`. In `packages/server/src/start.test.ts` add `branches: []` to the three `toEqual` objects (`{ count: 0, list: [], branches: [] }` twice, `{ count: 3, list: [], branches: [] }` once).

- [ ] **Step 6: The rest of the list's readers**
- `packages/web/src/next-settings.test.ts`: `const entry = (id: string, group: StartListEntry['group']): StartListEntry => ({ id, group, name: id, short: id, rare: false, moves: [] })`.
- `e2e/make-starts.ts`: the list becomes `{ branches: [], positions: [{ group: '4-4', name: 'Тестовое начало', moves: 'Q16 R17' }] }`.
- `README.md`, the paragraph on `starts-list.json`:

```md
`packages/server/bases/starts-list.json` is the named list for «Из списка»: a JSON object with `positions` — `{ group, name, short, moves, rare }` in chapter order, with the groups `4-4`, `3-4`, `3-3`, `5-4` and `5-3`, canonical moves in GTP, the caption `short` for the tree and `rare: true` for positions pros rarely play — and `branches` — `{ moves, name }`, the names of tree nodes that are not positions (an approach, say). A position whose path is not a normal start of the base, or a branch with no positions under it, is skipped with a log line. A missing or broken base turns both start modes off; a missing or broken list turns off only «Из списка».
```

- [ ] **Step 7: Run everything**

Run: `npm test && npm run typecheck && npm run e2e`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared packages/server packages/web e2e README.md
git commit -m "feat(starts): branches, short names and rare positions in the list file" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The tree model and the order of «Следующая позиция»

**Files:**
- Create: `packages/web/src/start-tree.ts`, `packages/web/src/start-tree.test.ts`
- Modify: `packages/web/src/next-settings.ts`, `packages/web/src/next-settings.test.ts`, `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `StartListEntry` (`short`, `rare`), `StartBranch`, `StartsInfo.branches` (Task 6).
- Produces: `StartTreeNode`, `buildStartTree(list, branches): StartTreeNode`, `treePositions(root): StartTreeNode[]`, `findNode(root, key): StartTreeNode | null`, `findById(root, id): StartTreeNode | null`; `nextSettings(settings, ids: readonly string[])`; in `App.tsx` the memos `startTree` and `startOrder`.

- [ ] **Step 1: Failing tests `packages/web/src/start-tree.test.ts`**

```ts
import type { StartBranch, StartListEntry } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { buildStartTree, findById, findNode, treePositions, type StartTreeNode } from './start-tree'

const pos = (id: string, group: StartListEntry['group'], moves: string, rare = false): StartListEntry => ({ id, group, name: `Полное ${id}`, short: id, rare, moves: moves.split(' ') })
const branch = (moves: string, name: string): StartBranch => ({ moves: moves.split(' '), name })
// File order: chapter order, with a 4-4 position in the middle.
const LIST = [
  pos('косуми', '3-4', 'R16 P17 Q15'),
  pos('снизу', '3-4', 'R16 P16 P17'),
  pos('хане', '3-4', 'R16 P16 P17 O17'),
  pos('лавина', '3-4', 'R16 P16 P17 Q16 Q17 R15'),
  pos('кэйма', '4-4', 'Q16 R14 O17'),
  pos('меч', '3-4', 'R16 P16 M16', true),
]
const BRANCHES = [branch('R16 P17', 'Малое приближение'), branch('R16 P16', 'Высокое приближение'), branch('Q16 R14', 'Малое приближение'), branch('R17 Q16', 'Без позиций')]
const names = (n: StartTreeNode): string[] => n.children.map((c) => c.short)

describe('buildStartTree', () => {
  const root = buildStartTree(LIST, BRANCHES)
  const g34 = root.children[1]
  const high = g34.children[1]
  const under = high.children[0]

  it('puts the groups under the empty corner in the fixed order, only those with positions', () => {
    expect(root).toMatchObject({ key: '', kind: 'root', name: 'Пустой угол', short: 'Пустой угол', moves: [], parent: null, count: 6 })
    expect(names(root)).toEqual(['4-4', '3-4'])
    expect(g34).toMatchObject({ key: 'group:3-4', kind: 'group', name: '3-4', moves: ['R16'], count: 5 })
  })

  it('hangs each node under the longest branch or position that begins its moves, skipping unnamed moves', () => {
    expect(names(g34)).toEqual(['Малое приближение', 'Высокое приближение'])
    expect(names(high)).toEqual(['снизу', 'меч'])
    expect(names(under)).toEqual(['хане', 'лавина'])
    expect(under).toMatchObject({ key: 'R16 P16 P17', kind: 'position', id: 'снизу', name: 'Полное снизу', count: 2 })
    expect(under.children[1].parent).toBe(under)
    expect(high).toMatchObject({ kind: 'branch', id: null, name: 'Высокое приближение', count: 4 })
  })

  it('keeps the rare mark and leaves out a branch with no positions under it', () => {
    expect(high.children[1].rare).toBe(true)
    expect(findNode(root, 'R17 Q16')).toBeNull()
  })

  it('lists the positions depth-first for «Следующая позиция»', () => {
    expect(treePositions(root).map((n) => n.id)).toEqual(['кэйма', 'косуми', 'снизу', 'хане', 'лавина', 'меч'])
  })

  it('finds nodes by key and by id', () => {
    expect(findNode(root, 'group:4-4')?.short).toBe('4-4')
    expect(findNode(root, '')).toBe(root)
    expect(findById(root, 'хане')?.key).toBe('R16 P16 P17 O17')
    expect(findById(root, 'нет')).toBeNull()
  })

  it('is just the root for an empty list', () => {
    expect(buildStartTree([], [])).toMatchObject({ kind: 'root', children: [], count: 0 })
  })
})
```

Run: `npx vitest run packages/web/src/start-tree.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: `packages/web/src/start-tree.ts`**

```ts
import { START_GROUPS, type StartBranch, type StartListEntry } from '@joseki-dojo/shared'

export type StartTreeKind = 'root' | 'group' | 'branch' | 'position'

/** Spec (starts) 5.1: a node of the tree of start positions in «Из списка». */
export interface StartTreeNode {
  /** '' for the root, `group:<group>` for a group, the moves joined by spaces for a branch or a position. */
  key: string
  kind: StartTreeKind
  /** A position's full name, a branch's name, the group, or «Пустой угол». */
  name: string
  /** The caption in the outline, the crumbs and on the cards. */
  short: string
  /** Canonical GTP moves; a group has the first move of its positions (none if they differ), the root none. */
  moves: string[]
  /** The start id of a position; null for the other kinds. */
  id: string | null
  rare: boolean
  /** Positions below the node, the node itself not counted. */
  count: number
  parent: StartTreeNode | null
  children: StartTreeNode[]
}

const ROOT_NAME = 'Пустой угол'

const make = (key: string, kind: StartTreeKind, name: string, short: string, moves: string[], id: string | null, rare: boolean): StartTreeNode => ({
  key,
  kind,
  name,
  short,
  moves,
  id,
  rare,
  count: 0,
  parent: null,
  children: [],
})

/** `moves` continue `prefix` (and are longer). */
const continues = (moves: readonly string[], prefix: readonly string[]): boolean => prefix.length < moves.length && prefix.every((m, i) => moves[i] === m)

const adopt = (parent: StartTreeNode, child: StartTreeNode): void => {
  child.parent = parent
  parent.children.push(child)
}

/**
 * Spec (starts) 5.1: «Пустой угол» → the groups with positions, in the fixed order → branches and positions. The parent
 * of a branch or a position is the branch or position with the longest moves that begin its moves, else its group;
 * unnamed moves in between are skipped. Children follow the file order of the first position in their subtree.
 */
export function buildStartTree(list: readonly StartListEntry[], branches: readonly StartBranch[]): StartTreeNode {
  const root = make('', 'root', ROOT_NAME, ROOT_NAME, [], null, false)
  const fileIndex = new Map<StartTreeNode, number>()
  for (const group of START_GROUPS) {
    const entries = list.filter((e) => e.group === group)
    if (entries.length === 0) continue
    const first = entries[0].moves[0]
    const head = make(`group:${group}`, 'group', group, group, entries.every((e) => e.moves[0] === first) ? [first] : [], null, false)
    adopt(root, head)
    const items = [
      ...branches.filter((b) => entries.some((e) => continues(e.moves, b.moves))).map((b) => make(b.moves.join(' '), 'branch', b.name, b.name, [...b.moves], null, false)),
      ...entries.map((e) => {
        const n = make(e.moves.join(' '), 'position', e.name, e.short, [...e.moves], e.id, e.rare)
        fileIndex.set(n, list.indexOf(e))
        return n
      }),
    ]
    for (const item of items) {
      const parent = items.filter((p) => continues(item.moves, p.moves)).reduce<StartTreeNode | null>((best, p) => (best && best.moves.length >= p.moves.length ? best : p), null)
      adopt(parent ?? head, item)
    }
  }
  finish(root, fileIndex, new Map())
  return root
}

/** Counts the positions below each node and orders the children (not the groups) by their first position in the file. */
function finish(n: StartTreeNode, own: ReadonlyMap<StartTreeNode, number>, first: Map<StartTreeNode, number>): void {
  let min = own.get(n) ?? Number.POSITIVE_INFINITY
  let count = 0
  for (const c of n.children) {
    finish(c, own, first)
    min = Math.min(min, first.get(c) ?? Number.POSITIVE_INFINITY)
    count += c.count + (c.kind === 'position' ? 1 : 0)
  }
  if (n.kind !== 'root') n.children.sort((a, b) => (first.get(a) ?? 0) - (first.get(b) ?? 0))
  first.set(n, min)
  n.count = count
}

/** The positions in outline order (depth-first, a node before its children): the order of «Следующая позиция». */
export function treePositions(root: StartTreeNode): StartTreeNode[] {
  const out: StartTreeNode[] = []
  const walk = (n: StartTreeNode): void => {
    if (n.kind === 'position') out.push(n)
    n.children.forEach(walk)
  }
  walk(root)
  return out
}

function find(root: StartTreeNode, test: (n: StartTreeNode) => boolean): StartTreeNode | null {
  if (test(root)) return root
  for (const c of root.children) {
    const hit = find(c, test)
    if (hit) return hit
  }
  return null
}

export const findNode = (root: StartTreeNode, key: string): StartTreeNode | null => find(root, (n) => n.key === key)
export const findById = (root: StartTreeNode, id: string): StartTreeNode | null => find(root, (n) => n.id === id)
```

Run: `npx vitest run packages/web/src/start-tree.test.ts`
Expected: PASS.

- [ ] **Step 3: `nextSettings` takes the ids in outline order** — `packages/web/src/next-settings.ts`:

```ts
import type { SessionSettings } from '@joseki-dojo/shared'

/**
 * «Следующая позиция»: the same start-screen settings; in «Из списка» the next position in outline order (`ids`, the
 * positions of the tree depth-first), wrapping around (starts spec 5.1).
 */
export function nextSettings(settings: SessionSettings, ids: readonly string[]): SessionSettings {
  if (settings.mode !== 'list' || ids.length === 0) return settings
  const at = ids.indexOf(settings.startId ?? '')
  return { ...settings, startId: ids[(at + 1) % ids.length] }
}
```

`packages/web/src/next-settings.test.ts`:

```ts
import type { SessionSettings } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { nextSettings } from './next-settings'

const IDS = ['b', 'a', 'c']
const settings = (over: Partial<SessionSettings> = {}): SessionSettings => ({ mode: 'list', environment: 'empty', userColor: 'random', botRank: '7k', corner: 'random', startId: 'b', ...over })

describe('nextSettings', () => {
  it('keeps the settings of the other modes', () => {
    const free = settings({ mode: 'free', startId: undefined })
    expect(nextSettings(free, IDS)).toBe(free)
  })

  it('takes the next position in outline order and wraps around', () => {
    expect(nextSettings(settings({ startId: 'b' }), IDS).startId).toBe('a')
    expect(nextSettings(settings({ startId: 'a' }), IDS).startId).toBe('c')
    expect(nextSettings(settings({ startId: 'c' }), IDS).startId).toBe('b')
  })

  it('starts from the top when the position is no longer on the list, and keeps the rest of the settings', () => {
    expect(nextSettings(settings({ startId: 'gone' }), IDS)).toEqual(settings({ startId: 'b' }))
  })

  it('keeps the settings when the list is empty', () => {
    const s = settings()
    expect(nextSettings(s, [])).toBe(s)
  })
})
```

- [ ] **Step 4: `App.tsx`** — build the tree once per `starts` and pass the order to `nextSettings`:

```ts
import { buildStartTree, treePositions } from './start-tree'
```
```ts
  const startTree = useMemo(() => buildStartTree(starts?.list ?? [], starts?.branches ?? []), [starts])
  const startOrder = useMemo(() => treePositions(startTree).flatMap((n) => (n.id ? [n.id] : [])), [startTree])
```
(next to the other hooks, before any early return), and in the review screen:

```tsx
        onNext={lastSettings ? () => startWith(nextSettings(lastSettings, startOrder)) : null}
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(starts): the tree of the named list and the order of «Следующая позиция»" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The tree on the start screen

**Files:**
- Create: `packages/web/src/components/CornerBoard.tsx`, `packages/web/src/components/StartTree.tsx`
- Delete: `packages/web/src/components/StartList.tsx`
- Modify: `packages/web/src/screens/StartScreen.tsx`, `packages/web/src/App.tsx`, `packages/web/src/styles/screens.css`
- Modify: `e2e/make-starts.ts`, `e2e/starts.spec.ts`

**Interfaces:**
- Consumes: `StartTreeNode`, `findNode`, `findById` (Task 7); the `startTree` memo in `App.tsx` (Task 7).
- Produces: `CornerBoard` (`moves`, `ghost?`, `marks?`, `lastMove?`, `onMarkEnter?`, `onMarkLeave?`, `onMarkClick?`, `class?`); `StartTree` (`root`, `current`, `onCurrent`, `onStart`); `StartScreen` props `startTree?: StartTreeNode` (replaces `startsList`) and `lastStartId?: string | null`.

- [ ] **Step 1: `packages/web/src/components/CornerBoard.tsx`** (the corner drawing of the old `StartPreview`, plus letters and a translucent continuation):

```tsx
import { BOARD_SIZE, gtpToVertex, ZONE_SIZE } from '@joseki-dojo/shared'

const N = ZONE_SIZE
const STEP = 10
const PAD = 6
const SIZE = PAD * 2 + STEP * (N - 1)
const at = (i: number): number => PAD + i * STEP
/** The zone is the top-right ZONE_SIZE x ZONE_SIZE corner: its first column. */
const ZONE_X0 = BOARD_SIZE - ZONE_SIZE
/** The 4-4 star point in zone coordinates. */
const STAR = 3
const BLACK = '#17181c'
const WHITE = '#f4f4f1'

const point = (gtp: string): { x: number; y: number } | null => {
  const v = gtpToVertex(gtp)
  return v === 'pass' ? null : { x: v[0] - ZONE_X0, y: v[1] }
}

/** A continuation's letter on its first move; `active` while it is hovered. */
export interface CornerMark {
  letter: string
  move: string
  active: boolean
}

export interface CornerBoardProps {
  /** Canonical moves in GTP, Black first. */
  moves: string[]
  /** A continuation shown as translucent stones, numbered from moves.length + 1. */
  ghost?: string[]
  marks?: CornerMark[]
  /** Mark the last stone of `moves`. */
  lastMove?: boolean
  onMarkEnter?: (letter: string) => void
  onMarkLeave?: () => void
  onMarkClick?: (letter: string) => void
  class?: string
}

/** Spec (starts) 5.1: the top-right 11×11 corner with a position, its continuations' letters and a hovered continuation. */
export function CornerBoard({ moves, ghost = [], marks = [], lastMove = false, onMarkEnter, onMarkLeave, onMarkClick, class: cls = 'start-preview' }: CornerBoardProps) {
  const stones = moves.flatMap((m, i) => {
    const p = point(m)
    return p ? [{ ...p, black: i % 2 === 0 }] : []
  })
  const last = lastMove && moves.length > 0 ? point(moves[moves.length - 1]) : null
  const ghosts = ghost.flatMap((m, i) => {
    const p = point(m)
    return p ? [{ ...p, black: (moves.length + i) % 2 === 0, n: moves.length + i + 1 }] : []
  })
  return (
    <svg class={cls} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
      <rect width={SIZE} height={SIZE} rx="4" fill="var(--board)" />
      <g stroke="var(--board-line)" stroke-width="0.6">
        {Array.from({ length: N }, (_, i) => (
          <path key={`h${i}`} d={`M0 ${at(i)}H${at(N - 1)}`} />
        ))}
        {Array.from({ length: N }, (_, i) => (
          <path key={`v${i}`} d={`M${at(i)} ${at(0)}V${SIZE}`} />
        ))}
      </g>
      <circle cx={at(BOARD_SIZE - 1 - STAR - ZONE_X0)} cy={at(STAR)} r="1.4" fill="var(--board-line)" />
      {stones.map((s, i) => (
        <circle key={i} cx={at(s.x)} cy={at(s.y)} r="4.4" fill={s.black ? BLACK : WHITE} stroke="var(--stone-ring)" stroke-width="0.6" />
      ))}
      {last && <circle cx={at(last.x)} cy={at(last.y)} r="1.8" fill="none" stroke="var(--last-move)" stroke-width="1" />}
      {ghosts.map((s) => (
        <g key={`g${s.n}`} class="corner-ghost" opacity="0.6">
          <circle cx={at(s.x)} cy={at(s.y)} r="4.4" fill={s.black ? BLACK : WHITE} />
          <text x={at(s.x)} y={at(s.y) + 2.1} text-anchor="middle" font-size="6" fill={s.black ? WHITE : BLACK}>
            {s.n}
          </text>
        </g>
      ))}
      {marks.map((m) => {
        const p = point(m.move)
        if (!p) return null
        return (
          <g key={m.letter} class={`corner-mark${m.active ? ' active' : ''}`} onMouseEnter={() => onMarkEnter?.(m.letter)} onMouseLeave={() => onMarkLeave?.()} onClick={() => onMarkClick?.(m.letter)}>
            <circle cx={at(p.x)} cy={at(p.y)} r="4.6" />
            <text x={at(p.x)} y={at(p.y) + 2.2} text-anchor="middle" font-size="6.4">
              {m.letter}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
```

- [ ] **Step 2: `packages/web/src/components/StartTree.tsx`**

```tsx
import { useState } from 'preact/hooks'
import type { StartTreeNode } from '../start-tree'
import { CornerBoard } from './CornerBoard'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const chain = (n: StartTreeNode): StartTreeNode[] => {
  const out: StartTreeNode[] = []
  for (let x: StartTreeNode | null = n; x; x = x.parent) out.unshift(x)
  return out
}

/** The line under the name: moves on the board for a position, positions inside otherwise. */
const details = (n: StartTreeNode): string => (n.kind === 'position' ? `Ходов на доске: ${n.moves.length}` : `Позиций внутри: ${n.count}`)

export interface StartTreeProps {
  root: StartTreeNode
  current: StartTreeNode
  onCurrent: (node: StartTreeNode) => void
  /** Enter on a position: «Начать тренировку». */
  onStart: () => void
}

/** Spec (starts) 5.1: «Из списка» — the outline, the corner board with lettered continuations, the cards. */
export function StartTree({ root, current, onCurrent, onStart }: StartTreeProps) {
  const [hover, setHover] = useState<number | null>(null)
  const path = chain(current)
  const kids = current.children
  const hovered = hover !== null ? (kids[hover] ?? null) : null
  const shown = hovered ?? current
  const go = (n: StartTreeNode): void => {
    setHover(null)
    onCurrent(n)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.code.startsWith('Key')) {
      const i = LETTERS.indexOf(e.code.slice(3))
      if (i >= 0 && i < kids.length) {
        e.preventDefault()
        go(kids[i])
      }
    } else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && current.parent) {
      e.preventDefault()
      go(current.parent)
    } else if (e.key === 'Enter' && e.target === e.currentTarget && current.kind === 'position') {
      e.preventDefault()
      onStart()
    }
  }
  return (
    <div class="start-tree" tabIndex={0} onKeyDown={onKey} aria-label="Дерево стартовых позиций">
      <nav class="start-outline" aria-label="Оглавление">
        <OutlineRow node={root} depth={0} path={path} current={current} onPick={go} />
      </nav>
      <div class="start-explorer">
        <div class="start-crumbs">
          {path.map((n, i) =>
            i < path.length - 1 ? (
              <span key={n.key} class="start-crumb">
                <button type="button" onClick={() => go(n)}>
                  {n.short}
                </button>
                <span aria-hidden="true">›</span>
              </span>
            ) : (
              <span key={n.key} aria-current="location">
                {n.short}
              </span>
            ),
          )}
        </div>
        <div class="start-focus">
          <CornerBoard
            class="start-board"
            moves={current.moves}
            lastMove
            ghost={hovered ? hovered.moves.slice(current.moves.length) : []}
            marks={kids.flatMap((c, i) => {
              const move = c.moves[current.moves.length]
              return move ? [{ letter: LETTERS[i], move, active: i === hover }] : []
            })}
            onMarkEnter={(l) => setHover(LETTERS.indexOf(l))}
            onMarkLeave={() => setHover(null)}
            onMarkClick={(l) => go(kids[LETTERS.indexOf(l)])}
          />
          <div class="start-info">
            <div class="start-info-name">{shown.name}</div>
            <div class="start-info-sub">{details(shown)}</div>
            {shown.rare && <div class="start-rare">редко играют</div>}
          </div>
        </div>
        {kids.length > 0 && (
          <div class="start-cards" onMouseLeave={() => setHover(null)}>
            {kids.map((c, i) => (
              <button
                type="button"
                key={c.key}
                class={`start-card${c.rare ? ' rare' : ''}${i === hover ? ' hover' : ''}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => go(c)}
              >
                <b>{LETTERS[i]}</b>
                <CornerBoard moves={c.moves} />
                <span class="start-card-name">{c.short}</span>
                {c.rare && <span class="start-rare">редко</span>}
                {c.count > 0 && <span class="start-count">{c.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface OutlineRowProps {
  node: StartTreeNode
  depth: number
  path: StartTreeNode[]
  current: StartTreeNode
  onPick: (node: StartTreeNode) => void
}

/** One row of the outline; the rows on the path to the current node are open. */
function OutlineRow({ node, depth, path, current, onPick }: OutlineRowProps) {
  const onPath = path.includes(node)
  const open = onPath && node.children.length > 0
  const cls = `start-outline-row${node === current ? ' current' : onPath ? ' on-path' : ''}${node.rare ? ' rare' : ''}`
  return (
    <>
      <button type="button" class={cls} style={{ paddingLeft: `${6 + depth * 14}px` }} aria-current={node === current ? 'true' : undefined} onClick={() => onPick(node)}>
        <span class="start-outline-arrow" aria-hidden="true">
          {node.children.length === 0 ? '' : open ? '▾' : '▸'}
        </span>
        <span class="start-outline-name">{node.short}</span>
        {node.count > 0 && <span class="start-count">{node.count}</span>}
      </button>
      {open && node.children.map((c) => <OutlineRow key={c.key} node={c} depth={depth + 1} path={path} current={current} onPick={onPick} />)}
    </>
  )
}
```

- [ ] **Step 3: `StartScreen.tsx`** — the tree replaces the list.

Imports: drop `StartList` and `StartListEntry`; add

```ts
import { StartTree } from '../components/StartTree'
import { findById, findNode, type StartTreeNode } from '../start-tree'
```

Props: replace `startsList?: StartListEntry[]` with

```ts
  /** The tree of the named list (starts spec 5.1); a root without children turns «Из списка» off. */
  startTree?: StartTreeNode
  /** The position of the last training from the list: the tree opens on it. */
  lastStartId?: string | null
```

Module level, next to the other constants:

```ts
const EMPTY_TREE: StartTreeNode = { key: '', kind: 'root', name: 'Пустой угол', short: 'Пустой угол', moves: [], id: null, rare: false, count: 0, parent: null, children: [] }
/** Spec (starts) 5.1: the last current node of the tree, remembered in the browser. */
const TREE_KEY = 'joseki-dojo.start-tree'
const readTreeKey = (): string => {
  try {
    return localStorage.getItem(TREE_KEY) ?? ''
  } catch {
    return ''
  }
}
const writeTreeKey = (key: string): void => {
  try {
    localStorage.setItem(TREE_KEY, key)
  } catch {
    // Storage is off: the tree opens at its root next time.
  }
}
```

The component signature becomes `({ onStart, busy, defaultRank, trapsCount = 0, startsCount = 0, startTree = EMPTY_TREE, lastStartId = null }: StartScreenProps)`. Replace the `chosenId`/`startId` lines with:

```ts
  const [currentKey, setCurrentKey] = useState<string>(() => (lastStartId ? findById(startTree, lastStartId)?.key : null) ?? readTreeKey())
  const current = findNode(startTree, currentKey) ?? startTree
  const startId = current.kind === 'position' ? current.id : null
  const listReady = startTree.children.length > 0
  const pick = (node: StartTreeNode): void => {
    setCurrentKey(node.key)
    writeTreeKey(node.key)
  }
  const canStart = !busy && !(mode === 'list' && startId === null)
  const start = (): void => {
    if (canStart) onStart({ mode, environment: 'empty', userColor, botRank, corner, ...(mode === 'list' && startId ? { startId } : {}) })
  }
```

Then:
- `<div class="page start">` → `<div class={`page start${mode === 'list' ? ' wide' : ''}`}>`;
- the «Из списка» radio: `disabled={!listReady}` and the caption `{listReady ? 'выберите дзёсеки' : 'база стартовых позиций недоступна'}`;
- `{mode === 'list' && <StartList … />}` → `{mode === 'list' && <StartTree root={startTree} current={current} onCurrent={pick} onStart={start} />}`;
- the start button: `<button class="primary lg" disabled={!canStart} onClick={start}>`.

- [ ] **Step 4: `App.tsx`** — the start screen gets the tree from Task 7's memo and the last list position:

```tsx
      <StartScreen
        key={defaultRank}
        defaultRank={defaultRank}
        trapsCount={traps?.count ?? 0}
        startsCount={starts?.count ?? 0}
        startTree={startTree}
        lastStartId={lastSettings?.mode === 'list' ? (lastSettings.startId ?? null) : null}
        busy={starting || !connected}
        onStart={startWith}
      />
```

- [ ] **Step 5: Styles in `packages/web/src/styles/screens.css`** — replace the six `.start-list`, `.start-rows`, `.start-row…` rules (keep `.start-preview`) with:

```css
.start-tree { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 16px; margin-top: 12px; border-radius: 10px; }
.start-tree:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.start-outline { display: grid; align-content: start; gap: 1px; }
.start-outline-row { justify-content: flex-start; gap: 4px; width: 100%; height: auto; padding: 4px 6px; border: 0; border-radius: 6px; background: none; color: var(--text); font-weight: 400; text-align: left; white-space: normal; }
.start-outline-row.on-path { color: var(--accent-text); }
.start-outline-row.current { background: var(--accent-bg); color: var(--accent-text); font-weight: 500; }
.start-outline-row.rare .start-outline-name, .start-card.rare .start-card-name { color: var(--text-3); }
.start-outline-arrow { width: 12px; flex: none; color: var(--text-3); }
.start-count { margin-left: auto; padding-left: 6px; font-size: 11px; font-weight: 400; color: var(--text-2); }
.start-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 8px; font-size: 13px; color: var(--text-2); }
.start-crumb { display: inline-flex; align-items: center; gap: 4px; }
.start-crumb button { height: auto; padding: 0; border: 0; background: none; color: var(--accent-text); font-weight: 400; }
.start-crumb button:hover:not(:disabled) { background: none; text-decoration: underline; }
.start-focus { display: flex; align-items: flex-start; gap: 14px; }
.start-board { width: 250px; height: 250px; flex: none; }
.start-info { display: grid; gap: 4px; min-width: 0; }
.start-info-name { font-size: 16px; font-weight: 600; }
.start-info-sub { font-size: 13px; color: var(--text-2); }
.start-rare { font-size: 11px; font-weight: 400; color: var(--warning-text); }
.start-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; margin-top: 12px; }
.start-card { justify-content: flex-start; gap: 6px; height: auto; padding: 4px 6px; border-color: var(--border); font-size: 12px; font-weight: 400; line-height: 1.3; text-align: left; white-space: normal; }
.start-card.hover, .start-card:focus-visible { border-color: var(--accent); background: var(--accent-bg); }
.start-card b { width: 12px; flex: none; color: var(--accent-text); }
.start-card .start-preview { width: 34px; height: 34px; }
.start-card .start-rare { margin-left: auto; }
.start-card .start-rare + .start-count { margin-left: 0; }
.corner-mark { cursor: pointer; }
.corner-mark circle { fill: var(--board); }
.corner-mark text { fill: var(--board-accent); font-weight: 600; }
.corner-mark.active circle { fill: var(--last-move); }
.corner-mark.active text { fill: #ffffff; }
.corner-ghost { pointer-events: none; }
@media (max-width: 640px) { .start-tree { grid-template-columns: 1fr; } .start-board { width: 200px; height: 200px; } }
```

Delete `packages/web/src/components/StartList.tsx` (nothing else imports it).

- [ ] **Step 6: e2e data `e2e/make-starts.ts`** — two starts: «Тестовое начало» (Q16 R17, the user's move) and its continuation (one more Black move, the bot's turn):

```ts
// Writes e2e/starts.test.jdb and e2e/starts-list.test.json: «Тестовое начало» — Q16 R17, on the corner's diagonal, so
// its coordinates do not depend on the random mirror, Black (the user) to move — and «Тестовое продолжение», one more
// Black move, under it in the tree.
import { writeFileSync } from 'node:fs'
import { canonicalize, encodeJdb, moveText, type CanonicalMove, type JdbNode } from '../packages/server/src/jdb'

const node = (move: CanonicalMove, category: JdbNode['category'] = 'none', children: JdbNode[] = []): JdbNode => ({ move, category, loss: null, children })

const [a, b, c] = canonicalize([[15, 3], [16, 2], [16, 3]])
const tree = { kind: 'starts' as const, verified: false, roots: [node(a, 'none', [node(b, 'start', [node(c, 'start')])])] }
writeFileSync('e2e/starts.test.jdb', encodeJdb(tree))
const positions = [
  { group: '4-4', name: 'Тестовое начало', short: 'Начало', moves: [a, b].map(moveText).join(' ') },
  { group: '4-4', name: 'Тестовое продолжение', short: 'Продолжение', moves: [a, b, c].map(moveText).join(' ') },
]
writeFileSync('e2e/starts-list.test.json', JSON.stringify({ branches: [], positions }))
```

- [ ] **Step 7: e2e `e2e/starts.spec.ts`** — the list test walks the tree (a card, then a letter on the board); the random test accepts either name:

```ts
test('a start from the tree: the position is on the board and its name is in the crumbs', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: /Из списка/ }).check()
  const start = page.getByRole('button', { name: 'Начать тренировку' })
  await expect(start).toBeDisabled()
  const tree = page.locator('.start-tree')
  await tree.locator('.start-card', { hasText: '4-4' }).click()
  await tree.locator('.start-board .corner-mark', { hasText: 'A' }).click()
  await expect(tree.locator('.start-info-name')).toHaveText('Тестовое начало')
  await expect(tree.locator('.start-card', { hasText: 'Продолжение' })).toBeVisible()
  await expect(tree.locator('.start-outline-row.current')).toContainText('Начало')
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  await start.click()

  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(page.getByText('Тестовое начало')).toBeVisible()
  await expect(page.getByTestId('moves-count')).toHaveText('0')
  await vertex(page, 13, 2).click()
  await expect(page.getByTestId('moves-count')).toHaveText('2')
  await page.getByRole('button', { name: 'Закончить' }).click()
  await expect(page.getByText('Разбор: Тестовое начало')).toBeVisible()
})

test('a random start: its name is in the crumbs', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: /Случайно/ }).first().check()
  await page.getByLabel('Чёрные').check()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()

  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(page.getByText(/Тестовое (начало|продолжение)/)).toBeVisible()
})
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run typecheck && npm run e2e`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add -A packages/web e2e
git commit -m "feat(starts): the tree of positions in «Из списка»" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9 (controller, outside the repository): the list data in the new format

- [ ] **Step 1:** In `D:\private\joseki-dojo-starts\chapters.mjs` every chapter position gets a short caption (the step from its parent: «Косуми Сюсаку», «Хане», «Малая лавина»), and a `BRANCHES` list names the 2-move nodes («Малое приближение», «Высокое приближение», «Вторжение в 3-3» and the like).
- [ ] **Step 2:** `make-list.mts` writes every chapter position with `short` and `rare` (fewer than 10 pro games since 2016 and not famous), plus the branches.
- [ ] **Step 3:** `build-starts.mts` writes `starts-list.json` as `{ branches, positions }` with all 88 positions; a chapter position equal to a candidate keeps the chapter path and drops the candidate's path (spec 3.3), so the two 5-3 positions stay under 5-3.
- [ ] **Step 4:** Check with the server's `loadStarts`: no log lines, 88 positions, every branch kept. Then `npm test && npm run e2e`.
- [ ] **Step 5:** Fold the data into the data commit when the branch is squashed for the push.
