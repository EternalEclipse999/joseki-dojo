# Joseki Dojo Core (Free Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app where the user plays one corner of a 19×19 board against a human-like KataGo bot and then reviews per-move point loss, the engine's best variations, and whether bot mistakes were punished.

**Architecture:** npm-workspaces monorepo in TypeScript. `packages/shared` holds types, coordinates, the 11×11 corner zone and Go rules (wrapping `@sabaki/go-board`). `packages/server` (Fastify + WebSocket) owns the single `katago analysis` process, the human-policy bot, session orchestration, end-of-joseki detection, review computation and SQLite storage. `packages/web` (Vite + Preact + `@sabaki/shudan`) renders the start, game and review screens. `scripts/setup` downloads and calibrates KataGo.

**Tech Stack:** Node ≥ 22.12, TypeScript 7, tsx, Vitest 5, Fastify 5, @fastify/websocket 11, @fastify/static 10, better-sqlite3 13, Preact 10, Vite 8, @preact/preset-vite, @sabaki/go-board, @sabaki/shudan, Playwright, extract-zip, KataGo 1.18.

**Spec:** `docs/superpowers/specs/2026-10-06-core-free-mode-design.md`

## Global Constraints

- Node.js `>=22.12` (Vitest 5 and Vite 8 require `^22.12 || ^24 || >=26`).
- All packages are ESM (`"type": "module"`); relative imports have no file extension; TypeScript `strict`.
- Preact stays on `^10` — `@sabaki/shudan` 1.8 declares `preact: ^8.4.2 || 10.x`.
- User-facing text is Russian. Code, identifiers, comments and commit messages are English.
- The server listens on `127.0.0.1` only. Default port `5179`.
- KataGo `>= 1.15.0` is required; queries use `rules: "chinese"`, `komi: 7.5`, 19×19; the analysis config sets `reportAnalysisWinratesAs = BLACK`, so every `scoreLead` and `ownership` value is from Black's point of view.
- Versions are pinned in `katago.lock.json`: KataGo `1.18.1`, main network `kata1-b18c384nbt-s9996604416-d4316597426`, human network `b18c384nbt-humanv0`, each file with its SHA-256. `npm run setup` downloads only these and verifies every checksum. A different running KataGo works (if `>= 1.15.0`) but shows a "version not verified" warning.
- Engine paths and visit counts can be changed at runtime on the «Настройки» screen; a change is kept only if the restarted KataGo passes the startup checks, otherwise the previous paths are restored.
- Zone = 11×11 square from the training corner: left corners `x ∈ [0, 10]`, right `x ∈ [8, 18]`, top `y ∈ [0, 10]`, bottom `y ∈ [8, 18]` (Sabaki coordinates, `y` grows downward).
- Loss thresholds (defaults, configurable): exact `< 0.5`, inaccuracy `0.5–2`, mistake `2–5`, blunder `≥ 5`; a bot mistake is "punished" when the user's reply loses `< 1.0`.
- Defaults: bot rank `7k`, temperature `1`, `reviewVisits` 500, `endVisits` 200, `maxSessionMoves` 60. After «Играть дальше» the end proposal may reappear only after ≥ 2 more moves.
- Never commit KataGo binaries, networks, `config.local.json`, `data/`, `engines/`.
- **Commits — one per milestone, not per task** (see `CLAUDE.md`): M1 after Task 3, M2 after Task 7, M3 after Task 11, M4 after Task 14a, M5 after Task 17a, M6 after Task 19, M7 after Task 20. Every other task ends by staging its files. Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (the second `-m` in the commit commands).
- **One pull request** for the whole plan, opened in Task 20. `main` is protected by a ruleset (PR only); all work happens on branch `feat/core-free-mode`; never push to `main`; the user merges.
- Make edits in large complete blocks (whole files or whole sections) rather than many small edits.

## File Structure

```
package.json                      root workspaces + scripts
tsconfig.json                     single typecheck project for the whole repo
vitest.config.ts                  unit tests (excludes *.integration.test.ts)
vitest.katago.config.ts           integration tests against a real KataGo
playwright.config.ts              e2e with the fake KataGo
katago.lock.json                  pinned KataGo builds and networks with SHA-256
config.example.json               documented defaults
CLAUDE.md                         working agreements (already committed)
README.md
.gitignore, .gitattributes
packages/shared/
  src/types.ts                    domain + review + health types, ranks
  src/protocol.ts                 WebSocket message types
  src/settings.ts                 settings screen types
  src/coords.ts                   Vertex <-> GTP <-> KataGo array index
  src/zone.ts                     corner zone geometry
  src/rules.ts                    Position (legality, captures, ko), nextColor
  src/index.ts                    re-exports
packages/server/
  migrations/001_init.sql
  src/config.ts                   AppConfig, defaults, loadConfig
  src/errors.ts                   error -> ServerMessage mapping
  src/engine/katago-types.ts      KataGo JSON protocol types
  src/engine/query.ts             baseQuery (rules, komi, moves)
  src/engine/engine.ts            KataGoEngine process wrapper (restart, restartWith)
  src/engine/command.ts           command line from config
  src/engine/health.ts            startup checks, HealthMonitor
  src/engine/lock.ts              katago.lock.json loader, version warning
  src/store/records.ts            SessionRecord, StoredAnalysis, movesBefore
  src/store/db.ts                 openDb + migration runner
  src/store/repo.ts               SessionRepo
  src/bot/rng.ts                  seeded RNG
  src/bot/choose.ts               pure human-policy move choice
  src/bot/bot.ts                  HumanBot (engine query + choice)
  src/analysis/compact.ts         AnalysisResponse -> StoredAnalysis
  src/analysis/scheduler.ts       deduplicated, cached position / pass-probe analyses
  src/session/end-detection.ts    joseki started / end proposal rules
  src/session/session.ts          Session state machine, SessionError
  src/session/service.ts          SessionService orchestration
  src/review/compute.ts           losses, candidates, punishment, summary
  src/review/service.ts           ReviewService (prepare + get)
  src/settings/service.ts         SettingsService (view, apply with rollback)
  src/api/hub.ts                  socket subscriptions per session
  src/api/messages.ts             client message parsing
  src/api/ws.ts                   WebSocket handler
  src/api/http.ts                 /api/health, /api/sessions/:id/review
  src/api/settings-routes.ts      GET/PUT /api/settings
  src/app.ts                      createServices, buildApp
  src/main.ts                     entry point
  test/fake-katago.mjs            stand-in for `katago analysis`
  test/helpers.ts                 fakeEngine, testConfig, StubEngine
  test/katago.integration.test.ts real-KataGo checks (spec 6.5, pinned version)
packages/web/
  index.html, vite.config.ts
  src/main.tsx, src/App.tsx, src/api.ts, src/format.ts, src/board-maps.ts, src/styles.css, src/vite-env.d.ts
  src/components/Board.tsx, ErrorBanner.tsx, LossBar.tsx
  src/screens/StartScreen.tsx, EngineScreen.tsx, GameScreen.tsx, ReviewScreen.tsx, SettingsScreen.tsx
scripts/setup/
  katago-config.ts, calibrate.ts, download.ts, setup.ts (+ tests)
e2e/
  config.e2e.json, game.spec.ts
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.gitattributes`
- Create: `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/go-board-interop.test.ts`
- Create: `packages/server/package.json`, `packages/web/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace names `@joseki-dojo/shared`, `@joseki-dojo/server`, `@joseki-dojo/web`; root scripts `test`, `typecheck`; `@joseki-dojo/shared` resolves to `packages/shared/src/index.ts`.

- [ ] **Step 1: Confirm the branch**

Run: `git status --short --branch`
Expected: `## feat/core-free-mode`

- [ ] **Step 2: Write root files**

`package.json`:
```json
{
  "name": "joseki-dojo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "workspaces": ["packages/shared", "packages/server", "packages/web"],
  "engines": { "node": ">=22.12" },
  "scripts": {
    "setup": "tsx scripts/setup/setup.ts",
    "dev": "concurrently -k -n server,web -c blue,green \"npm run dev -w @joseki-dojo/server\" \"npm run dev -w @joseki-dojo/web\"",
    "build": "npm run build -w @joseki-dojo/web",
    "start": "npm run build && npm run start -w @joseki-dojo/server",
    "test": "vitest run",
    "test:katago": "vitest run -c vitest.katago.config.ts",
    "typecheck": "tsc -p tsconfig.json",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@types/node": "^24.0.0",
    "concurrently": "^10.0.5",
    "extract-zip": "^2.0.1",
    "tsx": "^4.23.15",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["packages/*/src", "packages/*/test", "scripts", "e2e", "*.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
})
```

`.gitignore`:
```
node_modules/
dist/
data/
engines/
config.local.json
e2e/.data/
test-results/
playwright-report/
*.log
```

`.gitattributes`:
```
* text=auto eol=lf
*.png binary
```

- [ ] **Step 3: Write package manifests**

`packages/shared/package.json`:
```json
{
  "name": "@joseki-dojo/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@sabaki/go-board": "^1.4.3" }
}
```

`packages/server/package.json`:
```json
{
  "name": "@joseki-dojo/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "tsx watch src/main.ts", "start": "tsx src/main.ts" },
  "dependencies": {
    "@fastify/static": "^10.1.5",
    "@fastify/websocket": "^11.3.3",
    "@joseki-dojo/shared": "*",
    "better-sqlite3": "^13.0.3",
    "fastify": "^5.12.5"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^9.6.0",
    "@types/ws": "^8.18.2",
    "ws": "^8.22.0"
  }
}
```

`packages/web/package.json`:
```json
{
  "name": "@joseki-dojo/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": {
    "@joseki-dojo/shared": "*",
    "@sabaki/shudan": "^1.8.0",
    "preact": "^10.29.8"
  },
  "devDependencies": {
    "@preact/preset-vite": "^2.10.6",
    "vite": "^8.3.3"
  }
}
```

`packages/shared/src/index.ts`:
```ts
export {}
```

- [ ] **Step 4: Install**

Run: `npm install`
Expected: exits 0; `node_modules/@joseki-dojo/shared` is a link to `packages/shared`; `better-sqlite3` installs from a prebuilt binary (no compiler needed).

- [ ] **Step 5: Write the interop test**

`packages/shared/src/go-board-interop.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import GoBoard from '@sabaki/go-board'

// @sabaki/go-board is CommonJS; this guards the default-import interop the rules module relies on.
describe('@sabaki/go-board interop', () => {
  it('default import is the GoBoard class', () => {
    const board = GoBoard.fromDimensions(19).makeMove(1, [3, 3])
    expect(board.get([3, 3])).toBe(1)
    expect(board.stringifyVertex([3, 3])).toBe('D16')
  })
})
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test`
Expected: PASS, 1 test.
Run: `npm run typecheck`
Expected: exits 0, no output.

- [ ] **Step 7: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .gitattributes packages
```

---

### Task 2: Shared types, coordinates and zone

**Files:**
- Create: `packages/shared/src/types.ts`, `packages/shared/src/protocol.ts`, `packages/shared/src/coords.ts`, `packages/shared/src/zone.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/types.test.ts`, `packages/shared/src/coords.test.ts`, `packages/shared/src/zone.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `@joseki-dojo/shared`):
  - types: `Color`, `Vertex`, `MoveVertex`, `Corner`, `CORNERS`, `Move`, `Actor`, `PlayedMove`, `Mode`, `Environment`, `SessionSettings`, `ResolvedSettings`, `SessionStatus`, `SessionView`, `Category`, `Candidate`, `PositionReview`, `MoveReview`, `PunishmentEvent`, `ReviewSummary`, `ReviewData`, `HealthState`, `HealthResponse`, `otherColor(c)`, `BOT_RANKS`, `isBotRank(s)`, `DEFAULT_BOT_RANK`
  - protocol: `ClientMessage`, `ServerMessage`, `ErrorCode`
  - coords: `BOARD_SIZE = 19`, `PASS_INDEX = 361`, `vertexToGtp(v): string`, `gtpToVertex(s): MoveVertex`, `moveToGtp(v: MoveVertex): string`, `vertexToIndex(v): number`, `indexToVertex(i): MoveVertex`, `sameVertex(a, b): boolean`
  - zone: `ZONE_SIZE = 11`, `zoneRanges(corner)`, `inZone(corner, v: MoveVertex): boolean`, `zoneVertices(corner): Vertex[]`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/types.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { BOT_RANKS, isBotRank, otherColor } from './types'

describe('types helpers', () => {
  it('lists ranks from 20k to 9d', () => {
    expect(BOT_RANKS).toHaveLength(29)
    expect(BOT_RANKS[0]).toBe('20k')
    expect(BOT_RANKS[19]).toBe('1k')
    expect(BOT_RANKS[20]).toBe('1d')
    expect(BOT_RANKS[28]).toBe('9d')
  })

  it('validates ranks', () => {
    expect(isBotRank('7k')).toBe(true)
    expect(isBotRank('0k')).toBe(false)
    expect(isBotRank('10d')).toBe(false)
  })

  it('flips colors', () => {
    expect(otherColor('B')).toBe('W')
    expect(otherColor('W')).toBe('B')
  })
})
```

`packages/shared/src/coords.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { gtpToVertex, indexToVertex, moveToGtp, PASS_INDEX, sameVertex, vertexToGtp, vertexToIndex } from './coords'

describe('GTP coordinates', () => {
  it('converts reference points', () => {
    expect(vertexToGtp([0, 0])).toBe('A19')
    expect(vertexToGtp([18, 18])).toBe('T1')
    expect(vertexToGtp([3, 15])).toBe('D4')
    expect(vertexToGtp([15, 3])).toBe('Q16')
  })

  it('skips the letter I', () => {
    expect(vertexToGtp([7, 0])).toBe('H19')
    expect(vertexToGtp([8, 0])).toBe('J19')
    expect(gtpToVertex('J19')).toEqual([8, 0])
  })

  it('round-trips every vertex', () => {
    for (let x = 0; x < 19; x++) {
      for (let y = 0; y < 19; y++) expect(gtpToVertex(vertexToGtp([x, y]))).toEqual([x, y])
    }
  })

  it('parses pass and lowercase input', () => {
    expect(gtpToVertex('pass')).toBe('pass')
    expect(gtpToVertex('PASS')).toBe('pass')
    expect(gtpToVertex('q16')).toEqual([15, 3])
    expect(moveToGtp('pass')).toBe('pass')
    expect(moveToGtp([15, 3])).toBe('Q16')
  })

  it('rejects invalid input', () => {
    for (const bad of ['I5', 'Z1', 'A0', 'A20', '', 'Q']) expect(() => gtpToVertex(bad)).toThrow()
    expect(() => vertexToGtp([19, 0])).toThrow()
    expect(() => vertexToGtp([0, -1])).toThrow()
  })
})

describe('KataGo array indices', () => {
  it('is row-major from A19', () => {
    expect(vertexToIndex([0, 0])).toBe(0)
    expect(vertexToIndex([18, 0])).toBe(18)
    expect(vertexToIndex([0, 1])).toBe(19)
    expect(vertexToIndex([18, 18])).toBe(360)
  })

  it('maps back and handles pass', () => {
    expect(indexToVertex(20)).toEqual([1, 1])
    expect(indexToVertex(PASS_INDEX)).toBe('pass')
    expect(() => indexToVertex(362)).toThrow()
    expect(() => indexToVertex(-1)).toThrow()
  })

  it('compares vertices', () => {
    expect(sameVertex([1, 2], [1, 2])).toBe(true)
    expect(sameVertex([1, 2], [2, 1])).toBe(false)
    expect(sameVertex('pass', 'pass')).toBe(true)
    expect(sameVertex('pass', [0, 0])).toBe(false)
  })
})
```

`packages/shared/src/zone.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { gtpToVertex } from './coords'
import { CORNERS } from './types'
import { inZone, zoneRanges, zoneVertices } from './zone'

describe('corner zone', () => {
  it('TR covers x 8..18 and y 0..10', () => {
    expect(zoneRanges('TR')).toEqual({ x: [8, 18], y: [0, 10] })
    expect(inZone('TR', [8, 0])).toBe(true)
    expect(inZone('TR', [18, 10])).toBe(true)
    expect(inZone('TR', [7, 0])).toBe(false)
    expect(inZone('TR', [18, 11])).toBe(false)
  })

  it('BL covers x 0..10 and y 8..18', () => {
    expect(zoneRanges('BL')).toEqual({ x: [0, 10], y: [8, 18] })
    expect(inZone('BL', [0, 18])).toBe(true)
    expect(inZone('BL', [11, 18])).toBe(false)
  })

  it('has 121 vertices for every corner', () => {
    for (const corner of CORNERS) expect(zoneVertices(corner)).toHaveLength(121)
  })

  it('never contains pass', () => {
    for (const corner of CORNERS) expect(inZone(corner, 'pass')).toBe(false)
  })

  it('places star points in their own corner', () => {
    expect(inZone('TR', gtpToVertex('Q16'))).toBe(true)
    expect(inZone('TR', gtpToVertex('D4'))).toBe(false)
    expect(inZone('BL', gtpToVertex('D4'))).toBe(true)
    expect(inZone('TL', gtpToVertex('D16'))).toBe(true)
    expect(inZone('BR', gtpToVertex('Q4'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/shared`
Expected: FAIL — `Failed to resolve import "./types"` (and `./coords`, `./zone`).

- [ ] **Step 3: Implement**

`packages/shared/src/types.ts`:
```ts
export type Color = 'B' | 'W'
/** Sabaki coordinates: x grows to the right, y grows downward, both 0..18. */
export type Vertex = [x: number, y: number]
export type MoveVertex = Vertex | 'pass'
export type Corner = 'TL' | 'TR' | 'BL' | 'BR'
export const CORNERS: readonly Corner[] = ['TL', 'TR', 'BL', 'BR']

export interface Move {
  color: Color
  vertex: MoveVertex
}

export type Actor = 'user' | 'bot' | 'auto-tenuki'

export interface PlayedMove extends Move {
  actor: Actor
  inZone: boolean
}

export type Mode = 'free'
export type Environment = 'empty'

export interface SessionSettings {
  mode: Mode
  environment: Environment
  userColor: Color | 'random'
  botRank: string
  corner: Corner | 'random'
}

export interface ResolvedSettings {
  mode: Mode
  environment: Environment
  userColor: Color
  botRank: string
  corner: Corner
}

export type SessionStatus = 'playing' | 'finished' | 'abandoned'

export interface SessionView {
  id: string
  settings: ResolvedSettings
  /** Moves played before turn 0 (the parent's prefix after «Переиграть с этого хода»). */
  initialMoves: Move[]
  moves: PlayedMove[]
  toMove: Color
  status: SessionStatus
  josekiStarted: boolean
  endProposed: boolean
  botThinking: boolean
  parentSessionId: string | null
}

export type Category = 'exact' | 'inaccuracy' | 'mistake' | 'blunder'

export interface Candidate {
  vertex: MoveVertex
  /** Points the side to move loses by choosing this candidate instead of the engine's first choice. */
  loss: number
  pv: MoveVertex[]
}

/** Analysis of position `turn` (the position before move `turn`). */
export interface PositionReview {
  turn: number
  scoreLeadBlack: number
  candidates: Candidate[]
  /** 361 values, row-major from the top-left, Black's point of view (-1..1). */
  ownership: number[] | null
}

export interface MoveReview {
  turn: number
  color: Color
  actor: Actor
  vertex: MoveVertex
  loss: number
  category: Category
}

export interface PunishmentEvent {
  /** Turn of the bot mistake; the user's reply is `turn + 1`. */
  turn: number
  botLoss: number
  userLoss: number
  punished: boolean
  kept: number
}

export interface ReviewSummary {
  userLoss: number
  botMistakes: number
  botMistakeLoss: number
  punished: number
  keptPoints: number
}

export interface ReviewData {
  sessionId: string
  settings: ResolvedSettings
  initialMoves: Move[]
  moves: PlayedMove[]
  /** Length `moves.length + 1`. */
  positions: PositionReview[]
  moveReviews: MoveReview[]
  punishments: PunishmentEvent[]
  summary: ReviewSummary
}

export type HealthState = 'starting' | 'ready' | 'failed'

export interface HealthResponse {
  state: HealthState
  reason: string | null
}

export const otherColor = (c: Color): Color => (c === 'B' ? 'W' : 'B')

export const BOT_RANKS: readonly string[] = [
  ...Array.from({ length: 20 }, (_, i) => `${20 - i}k`),
  ...Array.from({ length: 9 }, (_, i) => `${i + 1}d`),
]

export const isBotRank = (s: string): boolean => BOT_RANKS.includes(s)

export const DEFAULT_BOT_RANK = '7k'
```

`packages/shared/src/protocol.ts`:
```ts
import type { SessionSettings, SessionView, Vertex } from './types'

export type ClientMessage =
  | { type: 'startSession'; settings: SessionSettings }
  | { type: 'playMove'; sessionId: string; vertex: Vertex }
  | { type: 'tenuki'; sessionId: string }
  | { type: 'finish'; sessionId: string }
  | { type: 'continuePlaying'; sessionId: string }
  | { type: 'replayFrom'; sessionId: string; turn: number }
  | { type: 'resync'; sessionId: string }

export type ErrorCode =
  | 'bad_request'
  | 'illegal_move'
  | 'outside_zone'
  | 'not_your_turn'
  | 'session_not_found'
  | 'session_finished'
  | 'engine_error'
  | 'internal_error'

/** `sessionState` carries every session change: user and bot moves, "bot thinking", end proposals. */
export type ServerMessage =
  | { type: 'sessionState'; session: SessionView }
  | { type: 'analysisProgress'; sessionId: string; done: number; total: number }
  | { type: 'reviewReady'; sessionId: string }
  | { type: 'error'; code: ErrorCode; message: string }
```

`packages/shared/src/coords.ts`:
```ts
import type { MoveVertex, Vertex } from './types'

export const BOARD_SIZE = 19
/** Index of "pass" in KataGo policy arrays (after the 361 board points). */
export const PASS_INDEX = BOARD_SIZE * BOARD_SIZE

const LETTERS = 'ABCDEFGHJKLMNOPQRST'

const onBoard = (n: number): boolean => Number.isInteger(n) && n >= 0 && n < BOARD_SIZE

export function vertexToGtp([x, y]: Vertex): string {
  if (!onBoard(x) || !onBoard(y)) throw new Error(`Vertex off board: ${x},${y}`)
  return `${LETTERS[x]}${BOARD_SIZE - y}`
}

export function gtpToVertex(s: string): MoveVertex {
  const t = s.trim().toUpperCase()
  if (t === 'PASS') return 'pass'
  const x = t.length > 0 ? LETTERS.indexOf(t[0]) : -1
  const row = Number(t.slice(1))
  if (x < 0 || !Number.isInteger(row) || row < 1 || row > BOARD_SIZE) throw new Error(`Invalid GTP vertex: "${s}"`)
  return [x, BOARD_SIZE - row]
}

export const moveToGtp = (v: MoveVertex): string => (v === 'pass' ? 'pass' : vertexToGtp(v))

export function vertexToIndex([x, y]: Vertex): number {
  if (!onBoard(x) || !onBoard(y)) throw new Error(`Vertex off board: ${x},${y}`)
  return y * BOARD_SIZE + x
}

export function indexToVertex(i: number): MoveVertex {
  if (i === PASS_INDEX) return 'pass'
  if (!Number.isInteger(i) || i < 0 || i > PASS_INDEX) throw new Error(`Invalid board index: ${i}`)
  return [i % BOARD_SIZE, Math.floor(i / BOARD_SIZE)]
}

export function sameVertex(a: MoveVertex, b: MoveVertex): boolean {
  if (a === 'pass' || b === 'pass') return a === b
  return a[0] === b[0] && a[1] === b[1]
}
```

`packages/shared/src/zone.ts`:
```ts
import { BOARD_SIZE } from './coords'
import type { Corner, MoveVertex, Vertex } from './types'

export const ZONE_SIZE = 11

export function zoneRanges(corner: Corner): { x: [number, number]; y: [number, number] } {
  const low: [number, number] = [0, ZONE_SIZE - 1]
  const high: [number, number] = [BOARD_SIZE - ZONE_SIZE, BOARD_SIZE - 1]
  return {
    x: corner === 'TL' || corner === 'BL' ? low : high,
    y: corner === 'TL' || corner === 'TR' ? low : high,
  }
}

export function inZone(corner: Corner, v: MoveVertex): boolean {
  if (v === 'pass') return false
  const { x, y } = zoneRanges(corner)
  return v[0] >= x[0] && v[0] <= x[1] && v[1] >= y[0] && v[1] <= y[1]
}

export function zoneVertices(corner: Corner): Vertex[] {
  const { x, y } = zoneRanges(corner)
  const out: Vertex[] = []
  for (let yy = y[0]; yy <= y[1]; yy++) for (let xx = x[0]; xx <= x[1]; xx++) out.push([xx, yy])
  return out
}
```

`packages/shared/src/index.ts`:
```ts
export * from './types'
export * from './protocol'
export * from './coords'
export * from './zone'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/shared`
Expected: PASS (all tests in 4 files).
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/shared
```

---

### Task 3: Go rules (Position)

**Files:**
- Create: `packages/shared/src/rules.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/rules.test.ts`

**Interfaces:**
- Consumes: `BOARD_SIZE`, `Color`, `Move`, `Vertex`, `otherColor` (Task 2).
- Produces: `IllegalMoveError`, `colorSign(c): 1 | -1`, `nextColor(moves: readonly Move[]): Color`, class `Position` with `static empty()`, `static fromMoves(moves)`, `play(move): Position`, `isLegal(color, vertex): boolean`, `colorAt(vertex): Color | null`, `signMap(): (0 | 1 | -1)[][]`, `emptyVertices(): Vertex[]`.

Note: `@sabaki/go-board` keeps its ko ban across a pass (`makeMove` with an off-board vertex). Under the simple ko rule KataGo uses for `chinese`, the ban lasts one move, so `play()` handles a pass by rebuilding the board without ko state.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { IllegalMoveError, nextColor, Position } from './rules'
import type { Move } from './types'

const B = (x: number, y: number): Move => ({ color: 'B', vertex: [x, y] })
const W = (x: number, y: number): Move => ({ color: 'W', vertex: [x, y] })
const pass = (color: 'B' | 'W'): Move => ({ color, vertex: 'pass' })

// Ko in the top-left corner: Black (1,0) (0,1) (1,2), White (2,0) (3,1) (2,2).
// White plays into (1,1); Black captures it by playing (2,1).
const KO: Move[] = [B(1, 0), W(2, 0), B(0, 1), W(3, 1), B(1, 2), W(2, 2), pass('B'), W(1, 1), B(2, 1)]

describe('Position', () => {
  it('captures stones', () => {
    const p = Position.fromMoves(KO)
    expect(p.colorAt([1, 1])).toBeNull()
    expect(p.colorAt([2, 1])).toBe('B')
  })

  it('forbids the immediate ko recapture', () => {
    const p = Position.fromMoves(KO)
    expect(p.isLegal('W', [1, 1])).toBe(false)
    expect(() => p.play(W(1, 1))).toThrow(IllegalMoveError)
  })

  it('allows the ko recapture after a pass by each side', () => {
    const p = Position.fromMoves([...KO, pass('W'), pass('B')])
    expect(p.isLegal('W', [1, 1])).toBe(true)
    expect(p.play(W(1, 1)).colorAt([2, 1])).toBeNull()
  })

  it('allows the ko recapture after an exchange elsewhere', () => {
    const p = Position.fromMoves([...KO, W(10, 10), B(10, 11)])
    expect(p.isLegal('W', [1, 1])).toBe(true)
  })

  it('forbids suicide and occupied points', () => {
    const p = Position.fromMoves([W(1, 0), W(0, 1)])
    expect(p.isLegal('B', [0, 0])).toBe(false)
    expect(p.isLegal('B', [1, 0])).toBe(false)
    expect(p.isLegal('B', [5, 5])).toBe(true)
  })

  it('rejects off-board vertices', () => {
    expect(() => Position.empty().play(B(19, 0))).toThrow(IllegalMoveError)
  })

  it('returns copies of the sign map', () => {
    const p = Position.fromMoves([B(3, 3)])
    const map = p.signMap()
    expect(map[3][3]).toBe(1)
    map[3][3] = 0
    expect(p.colorAt([3, 3])).toBe('B')
  })

  it('lists empty vertices', () => {
    expect(Position.fromMoves([B(3, 3), W(15, 15)]).emptyVertices()).toHaveLength(359)
  })
})

describe('nextColor', () => {
  it('starts with Black and alternates after the last move', () => {
    expect(nextColor([])).toBe('B')
    expect(nextColor([B(3, 3)])).toBe('W')
    expect(nextColor([B(3, 3), pass('W')])).toBe('B')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/src/rules.test.ts`
Expected: FAIL — `Failed to resolve import "./rules"`.

- [ ] **Step 3: Implement**

`packages/shared/src/rules.ts`:
```ts
import GoBoard from '@sabaki/go-board'
import { BOARD_SIZE } from './coords'
import { otherColor, type Color, type Move, type Vertex } from './types'

export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalMoveError'
  }
}

export const colorSign = (c: Color): 1 | -1 => (c === 'B' ? 1 : -1)

export function nextColor(moves: readonly Move[]): Color {
  const last = moves.at(-1)
  return last ? otherColor(last.color) : 'B'
}

/** Immutable board position with simple-ko, suicide and overwrite checks. */
export class Position {
  private constructor(private readonly board: GoBoard) {}

  static empty(): Position {
    return new Position(GoBoard.fromDimensions(BOARD_SIZE))
  }

  static fromMoves(moves: readonly Move[]): Position {
    return moves.reduce((p, m) => p.play(m), Position.empty())
  }

  play(move: Move): Position {
    if (move.vertex === 'pass') {
      // go-board keeps the ko ban across passes; a fresh board drops it (simple ko lasts one move).
      const fresh = new GoBoard(this.board.signMap.map((row) => [...row]))
      fresh.setCaptures(1, this.board.getCaptures(1))
      fresh.setCaptures(-1, this.board.getCaptures(-1))
      return new Position(fresh)
    }
    if (!this.board.has(move.vertex)) throw new IllegalMoveError(`Off-board vertex ${move.vertex.join(',')}`)
    try {
      const next = this.board.makeMove(colorSign(move.color), move.vertex, {
        preventSuicide: true,
        preventOverwrite: true,
        preventKo: true,
      })
      return new Position(next)
    } catch (err) {
      throw new IllegalMoveError(err instanceof Error ? err.message : String(err))
    }
  }

  isLegal(color: Color, vertex: Vertex): boolean {
    try {
      this.play({ color, vertex })
      return true
    } catch (err) {
      if (err instanceof IllegalMoveError) return false
      throw err
    }
  }

  colorAt(vertex: Vertex): Color | null {
    const s = this.board.get(vertex)
    return s === 1 ? 'B' : s === -1 ? 'W' : null
  }

  signMap(): (0 | 1 | -1)[][] {
    return this.board.signMap.map((row) => [...row])
  }

  emptyVertices(): Vertex[] {
    const out: Vertex[] = []
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) if (this.board.get([x, y]) === 0) out.push([x, y])
    }
    return out
  }
}
```

Append to `packages/shared/src/index.ts`:
```ts
export * from './rules'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/shared`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Milestone commit**

```bash
git add packages/shared
git commit -m "feat(shared): scaffold monorepo; add domain types, coordinates, zone and Go rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server configuration

**Files:**
- Create: `packages/server/src/config.ts`, `config.example.json`
- Test: `packages/server/src/config.test.ts`

**Interfaces:**
- Consumes: `isBotRank` (Task 2).
- Produces: `KataGoSettings`, `Thresholds`, `AppConfig`, `MAIN_MODEL_FILE`, `HUMAN_MODEL_FILE`, `DEFAULT_CONFIG`, `ConfigError`, `loadConfig(file: string): AppConfig`. All paths in the returned config are absolute; `katago.commandOverride` (test/e2e only) keeps its first element unless it is `"node"` (replaced by `process.execPath`) and resolves later elements that start with `./` or `../` against the config file's directory.

- [ ] **Step 1: Write the failing test**

`packages/server/src/config.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, DEFAULT_CONFIG, loadConfig } from './config'

function configFile(content?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'joseki-config-'))
  const file = join(dir, 'config.local.json')
  if (content) writeFileSync(file, JSON.stringify(content))
  return file
}

describe('loadConfig', () => {
  it('uses defaults when the file is missing and resolves paths against its directory', () => {
    const file = configFile()
    const c = loadConfig(file)
    expect(c.port).toBe(5179)
    expect(c.analysis).toEqual({ reviewVisits: 500, endVisits: 200 })
    expect(c.dataDir).toBe(join(file, '..', 'data'))
    expect(c.katago.mainModel).toBe(join(file, '..', DEFAULT_CONFIG.katago.mainModel))
  })

  it('merges nested sections', () => {
    const c = loadConfig(configFile({ analysis: { reviewVisits: 900 }, thresholds: { punished: 0.5 } }))
    expect(c.analysis).toEqual({ reviewVisits: 900, endVisits: 200 })
    expect(c.thresholds).toEqual({ inaccuracy: 0.5, mistake: 2, blunder: 5, punished: 0.5 })
  })

  it('keeps absolute paths', () => {
    const abs = join(tmpdir(), 'katago-bin')
    expect(loadConfig(configFile({ katago: { path: abs } })).katago.path).toBe(abs)
  })

  it('resolves command override arguments', () => {
    const file = configFile({ katago: { commandOverride: ['node', '../fake.mjs', '--flag'] } })
    const c = loadConfig(file)
    expect(c.katago.commandOverride).toEqual([process.execPath, join(file, '..', '..', 'fake.mjs'), '--flag'])
  })

  it('rejects thresholds out of order', () => {
    expect(() => loadConfig(configFile({ thresholds: { mistake: 6 } }))).toThrow(ConfigError)
  })

  it('rejects an unknown rank', () => {
    expect(() => loadConfig(configFile({ bot: { defaultRank: '42k' } }))).toThrow(ConfigError)
  })

  it('rejects non-positive numbers', () => {
    expect(() => loadConfig(configFile({ analysis: { endVisits: 0 } }))).toThrow(ConfigError)
    expect(() => loadConfig(configFile({ maxSessionMoves: -1 }))).toThrow(ConfigError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/config.test.ts`
Expected: FAIL — `Failed to resolve import "./config"`.

- [ ] **Step 3: Implement**

`packages/server/src/config.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { isBotRank } from '@joseki-dojo/shared'

export interface KataGoSettings {
  path: string
  analysisConfig: string
  mainModel: string
  humanModel: string
  /** Tests and e2e only: run this command instead of `katago analysis ...`. */
  commandOverride?: string[]
}

export interface Thresholds {
  inaccuracy: number
  mistake: number
  blunder: number
  punished: number
}

export interface AppConfig {
  port: number
  dataDir: string
  katago: KataGoSettings
  analysis: { reviewVisits: number; endVisits: number }
  thresholds: Thresholds
  bot: { defaultRank: string; temperature: number }
  maxSessionMoves: number
}

export const MAIN_MODEL_FILE = 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz'
export const HUMAN_MODEL_FILE = 'b18c384nbt-humanv0.bin.gz'

export const DEFAULT_CONFIG: AppConfig = {
  port: 5179,
  dataDir: 'data',
  katago: {
    path: process.platform === 'win32' ? 'engines/katago/katago.exe' : 'engines/katago/katago',
    analysisConfig: 'engines/analysis.cfg',
    mainModel: `engines/models/${MAIN_MODEL_FILE}`,
    humanModel: `engines/models/${HUMAN_MODEL_FILE}`,
  },
  analysis: { reviewVisits: 500, endVisits: 200 },
  thresholds: { inaccuracy: 0.5, mistake: 2, blunder: 5, punished: 1 },
  bot: { defaultRank: '7k', temperature: 1 },
  maxSessionMoves: 60,
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** Reads `file` (if present) over the defaults. Relative paths resolve against the file's directory. */
export function loadConfig(file: string): AppConfig {
  const baseDir = dirname(resolve(file))
  const raw = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) as Partial<AppConfig>
  const merged: AppConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    katago: { ...DEFAULT_CONFIG.katago, ...raw.katago },
    analysis: { ...DEFAULT_CONFIG.analysis, ...raw.analysis },
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...raw.thresholds },
    bot: { ...DEFAULT_CONFIG.bot, ...raw.bot },
  }
  validate(merged)
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(baseDir, p))
  const override = merged.katago.commandOverride?.map((part, i) => {
    if (i === 0) return part === 'node' ? process.execPath : part
    return part.startsWith('./') || part.startsWith('../') ? resolve(baseDir, part) : part
  })
  return {
    ...merged,
    dataDir: abs(merged.dataDir),
    katago: {
      path: abs(merged.katago.path),
      analysisConfig: abs(merged.katago.analysisConfig),
      mainModel: abs(merged.katago.mainModel),
      humanModel: abs(merged.katago.humanModel),
      ...(override ? { commandOverride: override } : {}),
    },
  }
}

function validate(c: AppConfig): void {
  const positive = (n: unknown, name: string): void => {
    if (typeof n !== 'number' || !(n > 0)) throw new ConfigError(`${name} must be a positive number`)
  }
  positive(c.port, 'port')
  positive(c.analysis.reviewVisits, 'analysis.reviewVisits')
  positive(c.analysis.endVisits, 'analysis.endVisits')
  positive(c.bot.temperature, 'bot.temperature')
  positive(c.maxSessionMoves, 'maxSessionMoves')
  for (const key of ['inaccuracy', 'mistake', 'blunder', 'punished'] as const) positive(c.thresholds[key], `thresholds.${key}`)
  const t = c.thresholds
  if (!(t.inaccuracy < t.mistake && t.mistake < t.blunder)) {
    throw new ConfigError('thresholds must satisfy inaccuracy < mistake < blunder')
  }
  if (!isBotRank(c.bot.defaultRank)) throw new ConfigError(`bot.defaultRank is not a valid rank: ${c.bot.defaultRank}`)
}
```

`config.example.json` (copy to `config.local.json`, or let `npm run setup` write it):
```json
{
  "port": 5179,
  "dataDir": "data",
  "katago": {
    "path": "engines/katago/katago.exe",
    "analysisConfig": "engines/analysis.cfg",
    "mainModel": "engines/models/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz",
    "humanModel": "engines/models/b18c384nbt-humanv0.bin.gz"
  },
  "analysis": { "reviewVisits": 500, "endVisits": 200 },
  "thresholds": { "inaccuracy": 0.5, "mistake": 2, "blunder": 5, "punished": 1 },
  "bot": { "defaultRank": "7k", "temperature": 1 },
  "maxSessionMoves": 60
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/server/src/config.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/server/src/config.ts packages/server/src/config.test.ts config.example.json
```

---

### Task 5: KataGo engine wrapper and fake KataGo

**Files:**
- Create: `packages/server/src/engine/katago-types.ts`, `packages/server/src/engine/query.ts`, `packages/server/src/engine/engine.ts`, `packages/server/src/engine/command.ts`
- Create: `packages/server/test/fake-katago.mjs`, `packages/server/test/helpers.ts`
- Test: `packages/server/src/engine/engine.test.ts`, `packages/server/src/engine/command.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `DEFAULT_CONFIG` (Task 4); `BOARD_SIZE`, `moveToGtp`, `Move` (Task 2).
- Produces:
  - `KataGoQueryBody`, `MoveInfo`, `RootInfo`, `AnalysisResponse`, `VersionResponse`
  - `RULES = 'chinese'`, `KOMI = 7.5`, `baseQuery(moves: readonly Move[]): KataGoQueryBody`
  - `EngineCommand { command; args; env? }`, `EngineErrorCode`, `EngineError(message, code)`, `interface AnalysisEngine { analyze(q): Promise<AnalysisResponse> }`
  - `class KataGoEngine implements AnalysisEngine` — `start()`, `reset()`, `version(): Promise<string>`, `analyze(q)`, `stop(): Promise<void>`, getters `failed: boolean`, `failure: string | null`
  - `engineCommand(config: AppConfig): EngineCommand`
  - test helpers: `FAKE_KATAGO`, `tempDir()`, `fakeEngine(env?, logs?)`, `testConfig(overrides?)`

- [ ] **Step 1: Write the fake KataGo**

`packages/server/test/fake-katago.mjs`:
```js
// Stand-in for `katago analysis` used by tests and e2e. Reads JSON queries from stdin and answers
// deterministically: the best move is the first free point of D4, Q4, D16, Q16 (or the first
// allowed move), every score is 0, and the human policy is uniform over free points.
// Switches (environment variables):
//   FAKE_KATAGO_CRASH_ONCE_FILE=<path>  exit on the first analysis query if <path> is missing (creates it)
//   FAKE_KATAGO_ALWAYS_CRASH=1          exit on every analysis query
//   FAKE_KATAGO_NO_HUMAN=1              omit humanPolicy (as if -human-model were missing)
//   FAKE_KATAGO_VERSION=<v>             version reported by query_version (default 1.18.1)
import { existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const LETTERS = 'ABCDEFGHJKLMNOPQRST'
const BEST_MOVE_PREFERENCE = ['D4', 'Q4', 'D16', 'Q16']

const toIndex = (gtp) => (19 - Number(gtp.slice(1))) * 19 + LETTERS.indexOf(gtp[0].toUpperCase())

function answer(query) {
  if (query.action === 'query_version') {
    return { id: query.id, action: 'query_version', version: process.env.FAKE_KATAGO_VERSION ?? '1.18.1', git_hash: 'fake' }
  }
  if (query.rules === 'invalid') return { id: query.id, error: 'Could not parse rules', field: 'rules' }
  const moves = query.moves ?? []
  const taken = new Set(moves.filter(([, v]) => v.toLowerCase() !== 'pass').map(([, v]) => toIndex(v)))
  const last = moves[moves.length - 1]
  const toMove = last ? (last[0] === 'B' ? 'W' : 'B') : 'B'
  const allowed = (query.allowMoves ?? []).find((a) => a.player === toMove)
  const options = (allowed ? allowed.moves : BEST_MOVE_PREFERENCE).filter((m) => !taken.has(toIndex(m)))
  const best = options[0] ?? 'pass'
  const visits = query.maxVisits ?? 1
  const res = {
    id: query.id,
    isDuringSearch: false,
    turnNumber: moves.length,
    rootInfo: { currentPlayer: toMove, scoreLead: 0, winrate: 0.5, visits },
    moveInfos: [{ move: best, order: 0, visits, scoreLead: 0, winrate: 0.5, pv: [best] }],
  }
  if (query.includeOwnership) res.ownership = new Array(361).fill(0)
  if (query.includePolicy) {
    const free = 361 - taken.size
    const policy = Array.from({ length: 362 }, (_, i) => (i === 361 ? 0 : taken.has(i) ? -1 : 1 / free))
    res.policy = policy
    if (query.overrideSettings?.humanSLProfile && !process.env.FAKE_KATAGO_NO_HUMAN) res.humanPolicy = [...policy]
  }
  return res
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  const query = JSON.parse(line)
  const isAnalysis = query.action === undefined
  if (isAnalysis && process.env.FAKE_KATAGO_ALWAYS_CRASH) process.exit(3)
  const marker = process.env.FAKE_KATAGO_CRASH_ONCE_FILE
  if (isAnalysis && marker && !existsSync(marker)) {
    writeFileSync(marker, 'crashed')
    process.exit(3)
  }
  process.stdout.write(`${JSON.stringify(answer(query))}\n`)
})
```

- [ ] **Step 2: Write the KataGo protocol types and query builder**

`packages/server/src/engine/katago-types.ts`:
```ts
/** Body of a KataGo analysis query without `id` (the engine assigns ids). One turn per query. */
export interface KataGoQueryBody {
  moves: [string, string][]
  rules: string
  komi: number
  boardXSize: number
  boardYSize: number
  initialStones?: [string, string][]
  maxVisits?: number
  includeOwnership?: boolean
  includePolicy?: boolean
  priority?: number
  allowMoves?: { player: string; moves: string[]; untilDepth: number }[]
  overrideSettings?: Record<string, string | number | boolean>
}

export interface MoveInfo {
  move: string
  order: number
  visits: number
  scoreLead: number
  winrate: number
  pv: string[]
  prior?: number
  humanPrior?: number
}

export interface RootInfo {
  currentPlayer: 'B' | 'W'
  scoreLead: number
  winrate: number
  visits: number
}

export interface AnalysisResponse {
  id: string
  turnNumber: number
  isDuringSearch: boolean
  moveInfos: MoveInfo[]
  rootInfo: RootInfo
  ownership?: number[]
  policy?: number[]
  humanPolicy?: number[]
}

export interface VersionResponse {
  id: string
  action: 'query_version'
  version: string
  git_hash: string
}
```

`packages/server/src/engine/query.ts`:
```ts
import { BOARD_SIZE, moveToGtp, type Move } from '@joseki-dojo/shared'
import type { KataGoQueryBody } from './katago-types'

export const RULES = 'chinese'
export const KOMI = 7.5

export function baseQuery(moves: readonly Move[]): KataGoQueryBody {
  return {
    moves: moves.map((m): [string, string] => [m.color, moveToGtp(m.vertex)]),
    rules: RULES,
    komi: KOMI,
    boardXSize: BOARD_SIZE,
    boardYSize: BOARD_SIZE,
  }
}
```

- [ ] **Step 3: Write the test helpers**

`packages/server/test/helpers.ts`:
```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CONFIG, type AppConfig } from '../src/config'
import { KataGoEngine } from '../src/engine/engine'

export const FAKE_KATAGO = fileURLToPath(new URL('./fake-katago.mjs', import.meta.url))

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'joseki-dojo-'))

export function fakeEngine(env: Record<string, string> = {}, logs: string[] = []): KataGoEngine {
  return new KataGoEngine({ command: process.execPath, args: [FAKE_KATAGO], env }, (line) => logs.push(line))
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    dataDir: tempDir(),
    katago: { ...DEFAULT_CONFIG.katago, commandOverride: [process.execPath, FAKE_KATAGO] },
    analysis: { reviewVisits: 10, endVisits: 5 },
    ...overrides,
  }
}
```

- [ ] **Step 4: Write the failing tests**

`packages/server/src/engine/engine.test.ts`:
```ts
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeEngine, tempDir } from '../../test/helpers'
import type { KataGoEngine } from './engine'
import { baseQuery } from './query'

const engines: KataGoEngine[] = []
const track = (e: KataGoEngine): KataGoEngine => {
  engines.push(e)
  e.start()
  return e
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.stop()))
})

describe('KataGoEngine', () => {
  it('reports the version', async () => {
    expect(await track(fakeEngine()).version()).toBe('1.18.1')
  })

  it('matches concurrent replies by id', async () => {
    const e = track(fakeEngine())
    const [a, b] = await Promise.all([
      e.analyze({ ...baseQuery([]), maxVisits: 10 }),
      e.analyze({ ...baseQuery([{ color: 'B', vertex: [3, 15] }]), maxVisits: 20 }),
    ])
    expect(a.rootInfo.visits).toBe(10)
    expect(a.moveInfos[0].move).toBe('D4')
    expect(b.rootInfo.visits).toBe(20)
    expect(b.moveInfos[0].move).toBe('Q4')
  })

  it('rejects a query KataGo answers with an error', async () => {
    const e = track(fakeEngine())
    await expect(e.analyze({ ...baseQuery([]), rules: 'invalid' })).rejects.toMatchObject({ code: 'query_error' })
  })

  it('restarts after a crash and resends the pending query', async () => {
    const logs: string[] = []
    const e = track(fakeEngine({ FAKE_KATAGO_CRASH_ONCE_FILE: join(tempDir(), 'crashed') }, logs))
    const r = await e.analyze(baseQuery([]))
    expect(r.moveInfos[0].move).toBe('D4')
    expect(logs.some((l) => l.includes('crash #1'))).toBe(true)
    expect(e.failed).toBe(false)
  })

  it('gives up after repeated crashes and recovers on reset', async () => {
    const e = track(fakeEngine({ FAKE_KATAGO_ALWAYS_CRASH: '1' }))
    await expect(e.analyze(baseQuery([]))).rejects.toMatchObject({ code: 'engine_failed' })
    expect(e.failed).toBe(true)
    expect(e.failure).toContain('аварийно')
    await expect(e.version()).rejects.toMatchObject({ code: 'engine_failed' })
    e.reset()
    expect(e.failed).toBe(false)
    expect(await e.version()).toBe('1.18.1')
  })
})
```

`packages/server/src/engine/command.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config'
import { engineCommand } from './command'

describe('engineCommand', () => {
  it('builds the analysis command line', () => {
    const k = { path: '/k/katago', analysisConfig: '/k/a.cfg', mainModel: '/k/main.bin.gz', humanModel: '/k/human.bin.gz' }
    expect(engineCommand({ ...DEFAULT_CONFIG, katago: k })).toEqual({
      command: '/k/katago',
      args: ['analysis', '-config', '/k/a.cfg', '-model', '/k/main.bin.gz', '-human-model', '/k/human.bin.gz'],
    })
  })

  it('uses the override when present', () => {
    const katago = { ...DEFAULT_CONFIG.katago, commandOverride: ['/usr/bin/node', '/x/fake.mjs'] }
    expect(engineCommand({ ...DEFAULT_CONFIG, katago })).toEqual({ command: '/usr/bin/node', args: ['/x/fake.mjs'] })
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/engine`
Expected: FAIL — `Failed to resolve import "./engine"` / `"./command"`.

- [ ] **Step 6: Implement**

`packages/server/src/engine/engine.ts`:
```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AnalysisResponse, KataGoQueryBody, VersionResponse } from './katago-types'

export interface EngineCommand {
  command: string
  args: string[]
  env?: Record<string, string>
}

export type EngineErrorCode = 'engine_failed' | 'query_error'

export class EngineError extends Error {
  constructor(message: string, readonly code: EngineErrorCode) {
    super(message)
    this.name = 'EngineError'
  }
}

/** The part of the engine the rest of the server depends on; tests substitute a stub. */
export interface AnalysisEngine {
  analyze(query: KataGoQueryBody): Promise<AnalysisResponse>
}

interface Pending {
  line: string
  resolve: (msg: unknown) => void
  reject: (err: Error) => void
}

/**
 * Owns one `katago analysis` process. Queries are JSON lines matched to replies by `id`; each
 * query analyses one turn, so it gets exactly one final reply. After a crash the process restarts
 * and pending queries are resent. More than `maxRestarts` consecutive crashes without a successful
 * reply mark the engine as failed until `reset()`.
 */
export class KataGoEngine implements AnalysisEngine {
  private proc: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<string, Pending>()
  private nextId = 1
  private crashes = 0
  private stopping = false
  private failedReason: string | null = null

  constructor(
    private readonly cmd: EngineCommand,
    private readonly log: (line: string) => void = () => {},
    private readonly maxRestarts = 3,
  ) {}

  get failure(): string | null {
    return this.failedReason
  }

  get failed(): boolean {
    return this.failedReason !== null
  }

  start(): void {
    if (this.proc || this.failedReason) return
    this.stopping = false
    const proc = spawn(this.cmd.command, this.cmd.args, {
      env: { ...process.env, ...this.cmd.env },
      stdio: 'pipe',
      windowsHide: true,
    })
    this.proc = proc
    let gone = false
    const onGone = (why: string): void => {
      if (gone) return
      gone = true
      this.handleExit(proc, why)
    }
    proc.on('error', (err) => onGone(err.message))
    proc.on('exit', (code, signal) => onGone(`exit code ${code ?? signal}`))
    proc.stdin.on('error', (err) => this.log(`stdin: ${err.message}`))
    createInterface({ input: proc.stdout }).on('line', (line) => this.handleLine(line))
    createInterface({ input: proc.stderr }).on('line', (line) => this.log(line))
    for (const p of this.pending.values()) proc.stdin.write(p.line)
  }

  /** Clears a permanent failure and starts the process again. */
  reset(): void {
    this.failedReason = null
    this.crashes = 0
    this.start()
  }

  async version(): Promise<string> {
    return (await this.send<VersionResponse>({ action: 'query_version' })).version
  }

  analyze(query: KataGoQueryBody): Promise<AnalysisResponse> {
    return this.send<AnalysisResponse>(query)
  }

  async stop(): Promise<void> {
    this.stopping = true
    for (const p of this.pending.values()) p.reject(new EngineError('KataGo остановлен', 'engine_failed'))
    this.pending.clear()
    const proc = this.proc
    this.proc = null
    if (!proc || proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return
    await new Promise<void>((done) => {
      proc.once('exit', () => done())
      proc.stdin.end()
      setTimeout(() => proc.kill(), 2000).unref()
    })
  }

  private send<T>(body: object): Promise<T> {
    if (this.failedReason) return Promise.reject(new EngineError(this.failedReason, 'engine_failed'))
    const id = `q${this.nextId++}`
    const line = `${JSON.stringify({ id, ...body })}\n`
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { line, resolve: resolve as (msg: unknown) => void, reject })
      if (this.proc) this.proc.stdin.write(line)
      else this.start() // start() writes every pending line, including this one
    })
  }

  private handleLine(line: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      this.log(line)
      return
    }
    if (msg.warning !== undefined) {
      this.log(`KataGo warning: ${String(msg.warning)}`)
      return
    }
    const id = typeof msg.id === 'string' ? msg.id : null
    const p = id ? this.pending.get(id) : undefined
    if (msg.error !== undefined) {
      if (id && p) {
        this.pending.delete(id)
        p.reject(new EngineError(`KataGo: ${String(msg.error)}`, 'query_error'))
      } else {
        this.log(`KataGo error: ${String(msg.error)}`)
      }
      return
    }
    if (!id || !p || msg.isDuringSearch === true) return
    this.pending.delete(id)
    this.crashes = 0
    p.resolve(msg)
  }

  private handleExit(proc: ChildProcessWithoutNullStreams, why: string): void {
    if (this.proc === proc) this.proc = null
    if (this.stopping) return
    this.crashes++
    this.log(`KataGo exited (${why}), crash #${this.crashes}`)
    if (this.crashes > this.maxRestarts) {
      this.failedReason = `KataGo аварийно завершился ${this.crashes} раза подряд (${why})`
      for (const p of this.pending.values()) p.reject(new EngineError(this.failedReason, 'engine_failed'))
      this.pending.clear()
      return
    }
    this.start()
  }
}
```

`packages/server/src/engine/command.ts`:
```ts
import type { AppConfig } from '../config'
import type { EngineCommand } from './engine'

export function engineCommand(config: AppConfig): EngineCommand {
  const override = config.katago.commandOverride
  if (override && override.length > 0) return { command: override[0], args: override.slice(1) }
  const k = config.katago
  return {
    command: k.path,
    args: ['analysis', '-config', k.analysisConfig, '-model', k.mainModel, '-human-model', k.humanModel],
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run packages/server/src/engine`
Expected: PASS (7 tests).
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 8: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/server/src/engine packages/server/test
```

---

### Task 6: Engine health checks

**Files:**
- Create: `packages/server/src/engine/health.ts`
- Test: `packages/server/src/engine/health.test.ts`

**Interfaces:**
- Consumes: `AppConfig` (Task 4); `KataGoEngine`, `baseQuery` (Task 5); `HealthResponse` (Task 2).
- Produces: `MIN_KATAGO_VERSION = '1.15.0'`, `compareVersions(a, b): -1 | 0 | 1`, `missingFiles(config): string | null`, `checkEngine(config, engine): Promise<HealthResponse>` (never throws), `class HealthMonitor(config, engine)` with `get(): HealthResponse`, `check(): Promise<HealthResponse>`, `recover(): Promise<HealthResponse>`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/engine/health.test.ts`:
```ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config'
import { fakeEngine, tempDir, testConfig } from '../../test/helpers'
import type { KataGoEngine } from './engine'
import { checkEngine, compareVersions, HealthMonitor, missingFiles } from './health'

const engines: KataGoEngine[] = []
const engine = (env: Record<string, string> = {}): KataGoEngine => {
  const e = fakeEngine(env)
  engines.push(e)
  return e
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.stop()))
})

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('1.15.0', '1.15.0')).toBe(0)
    expect(compareVersions('1.9.0', '1.15.0')).toBe(-1)
    expect(compareVersions('1.18.1', '1.15')).toBe(1)
  })
})

describe('missingFiles', () => {
  it('reports the first missing file', () => {
    const dir = tempDir()
    const katago = { path: join(dir, 'katago'), analysisConfig: join(dir, 'a.cfg'), mainModel: join(dir, 'm.bin.gz'), humanModel: join(dir, 'h.bin.gz') }
    writeFileSync(katago.path, '')
    expect(missingFiles({ ...DEFAULT_CONFIG, katago })).toBe(`Нет конфига анализа KataGo: ${katago.analysisConfig}`)
  })

  it('skips file checks for a command override', () => {
    expect(missingFiles(testConfig())).toBeNull()
  })
})

describe('checkEngine', () => {
  it('is ready with a working engine', async () => {
    expect(await checkEngine(testConfig(), engine())).toEqual({ state: 'ready', reason: null })
  })

  it('fails for an old KataGo', async () => {
    const h = await checkEngine(testConfig(), engine({ FAKE_KATAGO_VERSION: '1.14.1' }))
    expect(h).toEqual({ state: 'failed', reason: 'Версия KataGo 1.14.1 старше 1.15.0' })
  })

  it('fails without the human model', async () => {
    const h = await checkEngine(testConfig(), engine({ FAKE_KATAGO_NO_HUMAN: '1' }))
    expect(h.state).toBe('failed')
    expect(h.reason).toContain('human')
  })

  it('fails when KataGo keeps crashing', async () => {
    const h = await checkEngine(testConfig(), engine({ FAKE_KATAGO_ALWAYS_CRASH: '1' }))
    expect(h.state).toBe('failed')
    expect(h.reason).toContain('аварийно')
  })
})

describe('HealthMonitor', () => {
  it('starts in "starting" and becomes ready after the check', async () => {
    const monitor = new HealthMonitor(testConfig(), engine())
    expect(monitor.get().state).toBe('starting')
    await monitor.check()
    expect(monitor.get()).toEqual({ state: 'ready', reason: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/engine/health.test.ts`
Expected: FAIL — `Failed to resolve import "./health"`.

- [ ] **Step 3: Implement**

`packages/server/src/engine/health.ts`:
```ts
import { existsSync } from 'node:fs'
import type { HealthResponse } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import type { KataGoEngine } from './engine'
import { baseQuery } from './query'

export const MIN_KATAGO_VERSION = '1.15.0'

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export function missingFiles(config: AppConfig): string | null {
  if (config.katago.commandOverride) return null
  const k = config.katago
  const checks: [string, string][] = [
    [k.path, 'KataGo не найден'],
    [k.analysisConfig, 'Нет конфига анализа KataGo'],
    [k.mainModel, 'Нет основной сети KataGo'],
    [k.humanModel, 'Нет human-сети KataGo'],
  ]
  for (const [file, label] of checks) if (!existsSync(file)) return `${label}: ${file}`
  return null
}

/** Startup checks: files, version, and that the human model answers. Never throws. */
export async function checkEngine(config: AppConfig, engine: KataGoEngine): Promise<HealthResponse> {
  const missing = missingFiles(config)
  if (missing) return { state: 'failed', reason: missing }
  try {
    engine.start()
    const version = await engine.version()
    if (compareVersions(version, MIN_KATAGO_VERSION) < 0) {
      return { state: 'failed', reason: `Версия KataGo ${version} старше ${MIN_KATAGO_VERSION}` }
    }
    const probe = await engine.analyze({
      ...baseQuery([]),
      maxVisits: 1,
      includePolicy: true,
      overrideSettings: { humanSLProfile: 'rank_7k' },
    })
    if (!probe.humanPolicy) return { state: 'failed', reason: 'KataGo запущен без human-сети (нет humanPolicy в ответе)' }
    return { state: 'ready', reason: null }
  } catch (err) {
    return { state: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}

export class HealthMonitor {
  private current: HealthResponse = { state: 'starting', reason: 'KataGo запускается…' }
  private running: Promise<HealthResponse> | null = null

  constructor(private readonly config: AppConfig, private readonly engine: KataGoEngine) {}

  get(): HealthResponse {
    const failure = this.engine.failure
    if (failure && this.current.state === 'ready') return { state: 'failed', reason: failure }
    return this.current
  }

  check(): Promise<HealthResponse> {
    this.running ??= checkEngine(this.config, this.engine).then((h) => {
      this.current = h
      this.running = null
      return h
    })
    return this.running
  }

  /** Restarts a failed engine and checks again. */
  recover(): Promise<HealthResponse> {
    if (this.engine.failed) this.engine.reset()
    this.current = { state: 'starting', reason: 'KataGo перезапускается…' }
    return this.check()
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/server/src/engine`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/server/src/engine
```

---

### Task 7: SQLite store

**Files:**
- Create: `packages/server/migrations/001_init.sql`, `packages/server/src/store/records.ts`, `packages/server/src/store/db.ts`, `packages/server/src/store/repo.ts`
- Test: `packages/server/src/store/repo.test.ts`

**Interfaces:**
- Consumes: shared types, `gtpToVertex`, `moveToGtp` (Task 2).
- Produces:
  - records: `SessionRecord`, `AnalysisKind = 'position' | 'pass_probe'`, `StoredMoveInfo`, `StoredAnalysis`, `MissedPunishmentRow`, `movesBefore(rec, t): Move[]`
  - db: `type Db`, `openDb(file): Db` (`':memory:'` allowed), `migrate(db, dir?): number[]`
  - `class SessionRepo(db)`: `insertSession(r)`, `insertMove(sessionId, turn, m)`, `setStatus(id, status, finishedAt)`, `saveSummary(id, summary)`, `getSession(id): SessionRecord | null`, `saveAnalysis(sessionId, turn, kind, visits, analysis)`, `getAnalysis(sessionId, turn, kind): { visits: number; analysis: StoredAnalysis } | null`, `replaceMissedPunishments(sessionId, rows, createdAt)`, `listMissedPunishments(sessionId): MissedPunishmentRow[]`

- [ ] **Step 1: Write the migration**

`packages/server/migrations/001_init.sql`:
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  mode TEXT NOT NULL,
  environment TEXT NOT NULL,
  user_color TEXT NOT NULL CHECK (user_color IN ('B', 'W')),
  bot_rank TEXT NOT NULL,
  corner TEXT NOT NULL CHECK (corner IN ('TL', 'TR', 'BL', 'BR')),
  status TEXT NOT NULL CHECK (status IN ('playing', 'finished', 'abandoned')),
  parent_session_id TEXT REFERENCES sessions (id),
  initial_moves_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT
);

CREATE TABLE moves (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('B', 'W')),
  move TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'bot', 'auto-tenuki')),
  in_zone INTEGER NOT NULL,
  PRIMARY KEY (session_id, turn)
);

CREATE TABLE analyses (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('position', 'pass_probe')),
  visits INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (session_id, turn, kind)
);

CREATE TABLE missed_punishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  bot_move TEXT NOT NULL,
  bot_loss REAL NOT NULL,
  user_move TEXT NOT NULL,
  user_loss REAL NOT NULL,
  best_move TEXT NOT NULL,
  best_pv_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX missed_punishments_session ON missed_punishments (session_id);
```

- [ ] **Step 2: Write the failing test**

`packages/server/src/store/repo.test.ts`:
```ts
import type { Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { migrate, openDb } from './db'
import { movesBefore, type MissedPunishmentRow, type SessionRecord, type StoredAnalysis } from './records'
import { SessionRepo } from './repo'

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  createdAt: '2026-10-06T10:00:00.000Z',
  finishedAt: null,
  settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' },
  status: 'playing',
  parentSessionId: null,
  initialMoves: [],
  moves: [],
  summary: null,
  ...over,
})

const analysis = (lead: number): StoredAnalysis => ({
  rootInfo: { currentPlayer: 'B', scoreLead: lead, winrate: 0.5, visits: 10 },
  moveInfos: [{ move: 'D4', order: 0, visits: 10, scoreLead: lead, winrate: 0.5, pv: ['D4', 'Q16'] }],
  ownership: null,
})

describe('migrations', () => {
  it('applies once', () => {
    const db = openDb(':memory:')
    expect(migrate(db)).toEqual([])
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['sessions', 'moves', 'analyses', 'missed_punishments', 'schema_migrations']),
    )
  })
})

describe('SessionRepo', () => {
  it('round-trips a session with moves', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    const r = record({
      initialMoves: [{ color: 'B', vertex: [15, 3] }],
      moves: [
        { color: 'W', vertex: [16, 5], actor: 'bot', inZone: true },
        { color: 'B', vertex: 'pass', actor: 'auto-tenuki', inZone: false },
      ],
    })
    repo.insertSession(r)
    expect(repo.getSession('s1')).toEqual(r)
    expect(repo.getSession('missing')).toBeNull()
  })

  it('appends moves and updates status and summary', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    repo.insertSession(record())
    repo.insertMove('s1', 0, { color: 'B', vertex: [15, 3], actor: 'user', inZone: true })
    repo.setStatus('s1', 'finished', '2026-10-06T10:05:00.000Z')
    const summary = { userLoss: 1, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 }
    repo.saveSummary('s1', summary)
    const r = repo.getSession('s1')!
    expect(r.moves).toEqual([{ color: 'B', vertex: [15, 3], actor: 'user', inZone: true }])
    expect(r.status).toBe('finished')
    expect(r.finishedAt).toBe('2026-10-06T10:05:00.000Z')
    expect(r.summary).toEqual(summary)
  })

  it('rejects moves of an unknown session', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    expect(() => repo.insertMove('nope', 0, { color: 'B', vertex: [0, 0], actor: 'user', inZone: false })).toThrow()
  })

  it('stores and replaces analyses', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    repo.insertSession(record())
    repo.saveAnalysis('s1', 0, 'position', 10, analysis(1))
    repo.saveAnalysis('s1', 0, 'position', 500, analysis(2))
    expect(repo.getAnalysis('s1', 0, 'position')).toEqual({ visits: 500, analysis: analysis(2) })
    expect(repo.getAnalysis('s1', 0, 'pass_probe')).toBeNull()
  })

  it('replaces missed punishments', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    repo.insertSession(record())
    const D4: Vertex = [3, 15]
    const row: MissedPunishmentRow = { turn: 1, botMove: [16, 5], botLoss: 3, userMove: 'pass', userLoss: 2, bestMove: D4, bestPv: [D4, 'pass'] }
    repo.replaceMissedPunishments('s1', [row, { ...row, turn: 3 }], '2026-10-06T10:05:00.000Z')
    repo.replaceMissedPunishments('s1', [row], '2026-10-06T10:06:00.000Z')
    expect(repo.listMissedPunishments('s1')).toEqual([row])
  })
})

describe('movesBefore', () => {
  it('joins initial moves and the first t session moves', () => {
    const r = record({
      initialMoves: [{ color: 'B', vertex: [15, 3] }],
      moves: [
        { color: 'W', vertex: [16, 5], actor: 'bot', inZone: true },
        { color: 'B', vertex: [14, 5], actor: 'user', inZone: true },
      ],
    })
    expect(movesBefore(r, 1)).toEqual([
      { color: 'B', vertex: [15, 3] },
      { color: 'W', vertex: [16, 5] },
    ])
    expect(movesBefore(r, 0)).toEqual([{ color: 'B', vertex: [15, 3] }])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/server/src/store`
Expected: FAIL — `Failed to resolve import "./db"`.

- [ ] **Step 4: Implement**

`packages/server/src/store/records.ts`:
```ts
import type { Color, Move, MoveVertex, PlayedMove, ResolvedSettings, ReviewSummary, SessionStatus } from '@joseki-dojo/shared'

export interface SessionRecord {
  id: string
  createdAt: string
  finishedAt: string | null
  settings: ResolvedSettings
  status: SessionStatus
  parentSessionId: string | null
  initialMoves: Move[]
  moves: PlayedMove[]
  summary: ReviewSummary | null
}

export type AnalysisKind = 'position' | 'pass_probe'

export interface StoredMoveInfo {
  move: string
  order: number
  visits: number
  scoreLead: number
  winrate: number
  pv: string[]
}

/** Compact KataGo answer kept in the database. Scores and ownership are from Black's view. */
export interface StoredAnalysis {
  rootInfo: { currentPlayer: Color; scoreLead: number; winrate: number; visits: number }
  moveInfos: StoredMoveInfo[]
  ownership: number[] | null
}

export interface MissedPunishmentRow {
  /** Turn of the bot mistake. */
  turn: number
  botMove: MoveVertex
  botLoss: number
  userMove: MoveVertex
  userLoss: number
  bestMove: MoveVertex
  bestPv: MoveVertex[]
}

/** Moves leading to position `t`: the initial moves plus the first `t` session moves. */
export function movesBefore(rec: Pick<SessionRecord, 'initialMoves' | 'moves'>, t: number): Move[] {
  return [...rec.initialMoves, ...rec.moves.slice(0, t).map(({ color, vertex }) => ({ color, vertex }))]
}
```

`packages/server/src/store/db.ts`:
```ts
import Database from 'better-sqlite3'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Db = Database.Database

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

/** Applies `NNN_name.sql` files not yet recorded in `schema_migrations`; returns the versions applied. */
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  const applied = new Set(rows.map((r) => r.version))
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()
  const ran: number[] = []
  for (const file of files) {
    const version = Number(file.slice(0, 3))
    if (applied.has(version)) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(version, file, new Date().toISOString())
    })()
    ran.push(version)
  }
  return ran
}
```

`packages/server/src/store/repo.ts`:
```ts
import { gtpToVertex, moveToGtp, type Actor, type Color, type Corner, type PlayedMove, type ReviewSummary, type SessionStatus } from '@joseki-dojo/shared'
import type { Db } from './db'
import type { AnalysisKind, MissedPunishmentRow, SessionRecord, StoredAnalysis } from './records'

interface SessionRow {
  id: string
  created_at: string
  finished_at: string | null
  user_color: string
  bot_rank: string
  corner: string
  status: string
  parent_session_id: string | null
  initial_moves_json: string
  summary_json: string | null
}

interface MoveRow {
  color: string
  move: string
  actor: string
  in_zone: number
}

interface MissedRow {
  turn: number
  bot_move: string
  bot_loss: number
  user_move: string
  user_loss: number
  best_move: string
  best_pv_json: string
}

export class SessionRepo {
  constructor(private readonly db: Db) {}

  insertSession(r: SessionRecord): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions (id, created_at, finished_at, mode, environment, user_color, bot_rank, corner, status, parent_session_id, initial_moves_json, summary_json)
           VALUES (@id, @createdAt, @finishedAt, @mode, @environment, @userColor, @botRank, @corner, @status, @parentSessionId, @initialMoves, @summary)`,
        )
        .run({
          id: r.id,
          createdAt: r.createdAt,
          finishedAt: r.finishedAt,
          mode: r.settings.mode,
          environment: r.settings.environment,
          userColor: r.settings.userColor,
          botRank: r.settings.botRank,
          corner: r.settings.corner,
          status: r.status,
          parentSessionId: r.parentSessionId,
          initialMoves: JSON.stringify(r.initialMoves),
          summary: r.summary ? JSON.stringify(r.summary) : null,
        })
      r.moves.forEach((m, turn) => this.insertMove(r.id, turn, m))
    })()
  }

  insertMove(sessionId: string, turn: number, m: PlayedMove): void {
    this.db
      .prepare('INSERT INTO moves (session_id, turn, color, move, actor, in_zone) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sessionId, turn, m.color, moveToGtp(m.vertex), m.actor, m.inZone ? 1 : 0)
  }

  setStatus(id: string, status: SessionStatus, finishedAt: string | null): void {
    this.db.prepare('UPDATE sessions SET status = ?, finished_at = ? WHERE id = ?').run(status, finishedAt, id)
  }

  saveSummary(id: string, summary: ReviewSummary): void {
    this.db.prepare('UPDATE sessions SET summary_json = ? WHERE id = ?').run(JSON.stringify(summary), id)
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
    if (!row) return null
    const moveRows = this.db
      .prepare('SELECT color, move, actor, in_zone FROM moves WHERE session_id = ? ORDER BY turn')
      .all(id) as MoveRow[]
    return {
      id: row.id,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      settings: {
        mode: 'free',
        environment: 'empty',
        userColor: row.user_color as Color,
        botRank: row.bot_rank,
        corner: row.corner as Corner,
      },
      status: row.status as SessionStatus,
      parentSessionId: row.parent_session_id,
      initialMoves: JSON.parse(row.initial_moves_json),
      moves: moveRows.map((m) => ({
        color: m.color as Color,
        vertex: gtpToVertex(m.move),
        actor: m.actor as Actor,
        inZone: m.in_zone === 1,
      })),
      summary: row.summary_json ? (JSON.parse(row.summary_json) as ReviewSummary) : null,
    }
  }

  saveAnalysis(sessionId: string, turn: number, kind: AnalysisKind, visits: number, analysis: StoredAnalysis): void {
    this.db
      .prepare(
        `INSERT INTO analyses (session_id, turn, kind, visits, payload_json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (session_id, turn, kind) DO UPDATE SET visits = excluded.visits, payload_json = excluded.payload_json`,
      )
      .run(sessionId, turn, kind, visits, JSON.stringify(analysis))
  }

  getAnalysis(sessionId: string, turn: number, kind: AnalysisKind): { visits: number; analysis: StoredAnalysis } | null {
    const row = this.db
      .prepare('SELECT visits, payload_json FROM analyses WHERE session_id = ? AND turn = ? AND kind = ?')
      .get(sessionId, turn, kind) as { visits: number; payload_json: string } | undefined
    return row ? { visits: row.visits, analysis: JSON.parse(row.payload_json) as StoredAnalysis } : null
  }

  replaceMissedPunishments(sessionId: string, rows: MissedPunishmentRow[], createdAt: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM missed_punishments WHERE session_id = ?').run(sessionId)
      const insert = this.db.prepare(
        `INSERT INTO missed_punishments (session_id, turn, bot_move, bot_loss, user_move, user_loss, best_move, best_pv_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const r of rows) {
        insert.run(
          sessionId,
          r.turn,
          moveToGtp(r.botMove),
          r.botLoss,
          moveToGtp(r.userMove),
          r.userLoss,
          moveToGtp(r.bestMove),
          JSON.stringify(r.bestPv.map(moveToGtp)),
          createdAt,
        )
      }
    })()
  }

  listMissedPunishments(sessionId: string): MissedPunishmentRow[] {
    const rows = this.db
      .prepare('SELECT turn, bot_move, bot_loss, user_move, user_loss, best_move, best_pv_json FROM missed_punishments WHERE session_id = ? ORDER BY turn')
      .all(sessionId) as MissedRow[]
    return rows.map((r) => ({
      turn: r.turn,
      botMove: gtpToVertex(r.bot_move),
      botLoss: r.bot_loss,
      userMove: gtpToVertex(r.user_move),
      userLoss: r.user_loss,
      bestMove: gtpToVertex(r.best_move),
      bestPv: (JSON.parse(r.best_pv_json) as string[]).map(gtpToVertex),
    }))
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run packages/server/src/store`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Milestone commit**

```bash
git add packages/server/migrations packages/server/src/store
git commit -m "feat(server): add config, KataGo engine wrapper, health checks and SQLite store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Human-like bot

**Files:**
- Create: `packages/server/src/bot/rng.ts`, `packages/server/src/bot/choose.ts`, `packages/server/src/bot/bot.ts`
- Modify: `packages/server/test/helpers.ts` (add imports, append `StubEngine` and query predicates)
- Test: `packages/server/src/bot/rng.test.ts`, `packages/server/src/bot/choose.test.ts`, `packages/server/src/bot/bot.test.ts`

**Interfaces:**
- Consumes: `Position`, `inZone`, `indexToVertex`, `PASS_INDEX`, `zoneVertices` (Tasks 2–3); `AnalysisEngine`, `EngineError`, `baseQuery`, `AnalysisResponse`, `KataGoQueryBody` (Task 5).
- Produces:
  - `type Rng = () => number`, `mulberry32(seed): Rng`
  - `BotChoiceInput { humanPolicy; position; color; corner; josekiStarted; temperature }`, `BotChoice = { kind: 'zone'; vertex } | { kind: 'tenuki'; vertex } | { kind: 'pass' }`, `chooseBotMove(input, rng): BotChoice`
  - `BotRequest { moves; position; color; corner; josekiStarted; rank; temperature }`, `interface MoveChooser { chooseMove(req): Promise<MoveVertex> }`, `class HumanBot(engine, rng = Math.random) implements MoveChooser`
  - helpers: `StubEngine` (fields `queries`, `best`, `lead`, `fail`, `hold`; method `release()`), `stubResponse(q, best, lead)`, `isHumanQuery(q)`, `isPassProbe(q)`, `isTenukiQuery(q)`

- [ ] **Step 1: Extend the test helpers**

Add to the import block at the top of `packages/server/test/helpers.ts`:
```ts
import { gtpToVertex, vertexToIndex } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../src/engine/engine'
import type { AnalysisResponse, KataGoQueryBody } from '../src/engine/katago-types'
```

Append to the end of `packages/server/test/helpers.ts`:
```ts
export const isHumanQuery = (q: KataGoQueryBody): boolean => q.overrideSettings?.humanSLProfile !== undefined
export const isTenukiQuery = (q: KataGoQueryBody): boolean => q.allowMoves !== undefined
export const isPassProbe = (q: KataGoQueryBody): boolean => !isHumanQuery(q) && q.moves.at(-1)?.[1] === 'pass'

/** In-process engine with programmable answers (captures are not simulated). */
export class StubEngine implements AnalysisEngine {
  readonly queries: KataGoQueryBody[] = []
  best: (q: KataGoQueryBody) => string = (q) => q.allowMoves?.[0]?.moves[0] ?? 'D4'
  lead: (q: KataGoQueryBody) => number = () => 0
  fail: { when: (q: KataGoQueryBody) => boolean; error: Error } | null = null
  hold = false
  private readonly held: (() => void)[] = []

  async analyze(q: KataGoQueryBody): Promise<AnalysisResponse> {
    this.queries.push(q)
    if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve))
    if (this.fail?.when(q)) {
      const { error } = this.fail
      this.fail = null
      throw error
    }
    return stubResponse(q, this.best(q), this.lead(q))
  }

  release(): void {
    this.hold = false
    for (const resolve of this.held.splice(0)) resolve()
  }
}

export function stubResponse(q: KataGoQueryBody, best: string, lead: number): AnalysisResponse {
  const taken = new Set<number>()
  for (const [, v] of q.moves) {
    const vertex = gtpToVertex(v)
    if (vertex !== 'pass') taken.add(vertexToIndex(vertex))
  }
  const last = q.moves.at(-1)
  const toMove = last ? (last[0] === 'B' ? 'W' : 'B') : 'B'
  const visits = q.maxVisits ?? 1
  const res: AnalysisResponse = {
    id: 'stub',
    turnNumber: q.moves.length,
    isDuringSearch: false,
    rootInfo: { currentPlayer: toMove, scoreLead: lead, winrate: 0.5, visits },
    moveInfos: [{ move: best, order: 0, visits, scoreLead: lead, winrate: 0.5, pv: [best] }],
  }
  if (q.includeOwnership) res.ownership = new Array<number>(361).fill(0)
  if (q.includePolicy) {
    const free = 361 - taken.size
    const policy = Array.from({ length: 362 }, (_, i) => (i === 361 ? 0 : taken.has(i) ? -1 : 1 / free))
    res.policy = policy
    if (isHumanQuery(q)) res.humanPolicy = [...policy]
  }
  return res
}
```

- [ ] **Step 2: Write the failing tests**

`packages/server/src/bot/rng.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { mulberry32 } from './rng'

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})
```

`packages/server/src/bot/choose.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { gtpToVertex, PASS_INDEX, Position, vertexToIndex, zoneVertices, type Vertex } from '@joseki-dojo/shared'
import { chooseBotMove, type BotChoiceInput } from './choose'
import { mulberry32, type Rng } from './rng'

const policy = (entries: Record<string, number>, pass = 0): number[] => {
  const p = new Array<number>(362).fill(0)
  for (const [gtp, value] of Object.entries(entries)) p[vertexToIndex(gtpToVertex(gtp) as Vertex)] = value
  p[PASS_INDEX] = pass
  return p
}

const seq = (...values: number[]): Rng => {
  let i = 0
  return () => values[i++ % values.length]
}

const input = (humanPolicy: number[], over: Partial<BotChoiceInput> = {}): BotChoiceInput => ({
  humanPolicy,
  position: Position.empty(),
  color: 'W',
  corner: 'TR',
  josekiStarted: true,
  temperature: 1,
  ...over,
})

const Q16: Vertex = [15, 3]
const R16: Vertex = [16, 3]
const D4: Vertex = [3, 15]
const D16: Vertex = [3, 3]

describe('chooseBotMove', () => {
  it('plays in the zone before the joseki starts even if most mass is outside', () => {
    const c = chooseBotMove(input(policy({ Q16: 0.1, D4: 0.9 }), { josekiStarted: false }), seq(0.5))
    expect(c).toEqual({ kind: 'zone', vertex: Q16 })
  })

  it('tenukis when the draw falls inside the outside share', () => {
    expect(chooseBotMove(input(policy({ Q16: 0.1, D4: 0.9 })), seq(0.5))).toEqual({ kind: 'tenuki', vertex: D4 })
  })

  it('stays in the zone when the draw exceeds the outside share', () => {
    expect(chooseBotMove(input(policy({ Q16: 0.1, D4: 0.9 })), seq(0.95, 0))).toEqual({ kind: 'zone', vertex: Q16 })
  })

  it('tenukis to the strongest outside point, never to pass', () => {
    const c = chooseBotMove(input(policy({ Q16: 0.1, D4: 0.3, D16: 0.4 }, 0.2)), seq(0))
    expect(c).toEqual({ kind: 'tenuki', vertex: D16 })
  })

  it('samples zone points in proportion to the policy', () => {
    const p = policy({ Q16: 0.25, R16: 0.75 })
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.2))).toEqual({ kind: 'zone', vertex: Q16 })
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.3))).toEqual({ kind: 'zone', vertex: R16 })
  })

  it('tenukis about as often as the outside mass', () => {
    const rng = mulberry32(42)
    const p = policy({ Q16: 0.3, D4: 0.7 })
    let tenuki = 0
    for (let i = 0; i < 10_000; i++) if (chooseBotMove(input(p), rng).kind === 'tenuki') tenuki++
    expect(tenuki / 10_000).toBeGreaterThan(0.67)
    expect(tenuki / 10_000).toBeLessThan(0.73)
  })

  it('skips occupied and KataGo-illegal points', () => {
    const position = Position.fromMoves([{ color: 'B', vertex: Q16 }])
    const c = chooseBotMove(input(policy({ Q16: 0.9, R16: 0.1, R17: -1 }), { position, josekiStarted: false }), seq(0.99))
    expect(c).toEqual({ kind: 'zone', vertex: R16 })
  })

  it('tenukis when the zone has no playable point and passes when nothing is playable', () => {
    const p = policy({ D4: 0.5 })
    for (const v of zoneVertices('TR')) p[vertexToIndex(v)] = -1
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.5))).toEqual({ kind: 'tenuki', vertex: D4 })
    const nothing = new Array<number>(362).fill(-1)
    nothing[PASS_INDEX] = 1
    expect(chooseBotMove(input(nothing), seq(0.5))).toEqual({ kind: 'pass' })
  })

  it('sharpens the distribution with a lower temperature', () => {
    const p = policy({ Q16: 0.2, R16: 0.8 })
    expect(chooseBotMove(input(p, { josekiStarted: false, temperature: 1 }), seq(0.1))).toEqual({ kind: 'zone', vertex: Q16 })
    expect(chooseBotMove(input(p, { josekiStarted: false, temperature: 0.5 }), seq(0.1))).toEqual({ kind: 'zone', vertex: R16 })
  })
})
```

`packages/server/src/bot/bot.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { inZone, Position } from '@joseki-dojo/shared'
import { StubEngine, stubResponse } from '../../test/helpers'
import type { AnalysisEngine } from '../engine/engine'
import { HumanBot, type BotRequest } from './bot'
import { mulberry32 } from './rng'

const request: BotRequest = {
  moves: [],
  position: Position.empty(),
  color: 'B',
  corner: 'TR',
  josekiStarted: false,
  rank: '5k',
  temperature: 1,
}

describe('HumanBot', () => {
  it('queries the human policy of the configured rank and plays in the zone', async () => {
    const engine = new StubEngine()
    const vertex = await new HumanBot(engine, mulberry32(3)).chooseMove(request)
    expect(engine.queries[0]).toMatchObject({ maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: 'rank_5k' } })
    expect(vertex).not.toBe('pass')
    expect(inZone('TR', vertex)).toBe(true)
  })

  it('fails clearly when KataGo returns no human policy', async () => {
    const engine: AnalysisEngine = {
      analyze: async (q) => {
        const r = stubResponse(q, 'D4', 0)
        delete r.humanPolicy
        return r
      },
    }
    await expect(new HumanBot(engine).chooseMove(request)).rejects.toThrow(/humanPolicy/)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/bot`
Expected: FAIL — `Failed to resolve import "./rng"` / `"./choose"` / `"./bot"`.

- [ ] **Step 4: Implement**

`packages/server/src/bot/rng.ts`:
```ts
export type Rng = () => number

/** Small seeded PRNG for reproducible tests; production passes Math.random. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

`packages/server/src/bot/choose.ts`:
```ts
import { indexToVertex, inZone, PASS_INDEX, type Color, type Corner, type Position, type Vertex } from '@joseki-dojo/shared'
import type { Rng } from './rng'

export interface BotChoiceInput {
  /** KataGo humanPolicy: 362 values, -1 for illegal points, the last one is pass. */
  humanPolicy: readonly number[]
  position: Position
  color: Color
  corner: Corner
  josekiStarted: boolean
  temperature: number
}

export type BotChoice = { kind: 'zone'; vertex: Vertex } | { kind: 'tenuki'; vertex: Vertex } | { kind: 'pass' }

interface Entry {
  vertex: Vertex
  p: number
}

/**
 * Spec 8.4: split the human policy into zone and non-zone mass. Before the joseki starts the bot
 * always plays in the zone; afterwards it tenukis with probability p_out / (p_in + p_out), to the
 * strongest non-zone point. Zone moves are sampled from policy^(1/temperature).
 */
export function chooseBotMove(input: BotChoiceInput, rng: Rng): BotChoice {
  const zone: Entry[] = []
  const outside: Entry[] = []
  for (let i = 0; i < PASS_INDEX; i++) {
    const p = input.humanPolicy[i] ?? 0
    if (p < 0) continue
    const vertex = indexToVertex(i) as Vertex
    if (!input.position.isLegal(input.color, vertex)) continue
    ;(inZone(input.corner, vertex) ? zone : outside).push({ vertex, p })
  }
  const passMass = Math.max(0, input.humanPolicy[PASS_INDEX] ?? 0)
  const pIn = zone.reduce((s, e) => s + e.p, 0)
  const pOut = outside.reduce((s, e) => s + e.p, 0) + passMass

  const tenuki = (): BotChoice => {
    const best = outside.reduce<Entry | null>((b, e) => (b === null || e.p > b.p ? e : b), null)
    return best ? { kind: 'tenuki', vertex: best.vertex } : { kind: 'pass' }
  }

  if (zone.length === 0) return tenuki()
  if (input.josekiStarted && pIn + pOut > 0 && rng() < pOut / (pIn + pOut)) return tenuki()
  return { kind: 'zone', vertex: sample(zone, input.temperature, rng) }
}

function sample(entries: Entry[], temperature: number, rng: Rng): Vertex {
  const weights = entries.map((e) => (e.p > 0 ? Math.pow(e.p, 1 / temperature) : 0))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total === 0) return entries[Math.floor(rng() * entries.length)].vertex
  let r = rng() * total
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i]
    if (r < 0) return entries[i].vertex
  }
  return entries[entries.length - 1].vertex
}
```

`packages/server/src/bot/bot.ts`:
```ts
import type { Color, Corner, Move, MoveVertex, Position } from '@joseki-dojo/shared'
import { EngineError, type AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import { chooseBotMove } from './choose'
import type { Rng } from './rng'

export interface BotRequest {
  /** Every move so far, including the session's initial moves. */
  moves: readonly Move[]
  position: Position
  color: Color
  corner: Corner
  josekiStarted: boolean
  rank: string
  temperature: number
}

export interface MoveChooser {
  chooseMove(req: BotRequest): Promise<MoveVertex>
}

export class HumanBot implements MoveChooser {
  constructor(private readonly engine: AnalysisEngine, private readonly rng: Rng = Math.random) {}

  async chooseMove(req: BotRequest): Promise<MoveVertex> {
    const r = await this.engine.analyze({
      ...baseQuery(req.moves),
      maxVisits: 1,
      includePolicy: true,
      priority: 10,
      overrideSettings: { humanSLProfile: `rank_${req.rank}` },
    })
    if (!r.humanPolicy) throw new EngineError('KataGo не вернул humanPolicy: human-сеть не загружена', 'query_error')
    const choice = chooseBotMove(
      {
        humanPolicy: r.humanPolicy,
        position: req.position,
        color: req.color,
        corner: req.corner,
        josekiStarted: req.josekiStarted,
        temperature: req.temperature,
      },
      this.rng,
    )
    return choice.kind === 'pass' ? 'pass' : choice.vertex
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run packages/server/src/bot`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/server/src/bot packages/server/test/helpers.ts
```

---

### Task 9: Analysis scheduler

**Files:**
- Create: `packages/server/src/analysis/compact.ts`, `packages/server/src/analysis/scheduler.ts`
- Test: `packages/server/src/analysis/scheduler.test.ts`

**Interfaces:**
- Consumes: `nextColor` (Task 3); `AnalysisEngine`, `baseQuery`, `AnalysisResponse` (Task 5); `SessionRepo`, `SessionRecord`, `StoredAnalysis`, `AnalysisKind`, `movesBefore` (Task 7); `StubEngine` (Task 8).
- Produces: `STORED_MOVE_INFOS = 5`, `compactAnalysis(r): StoredAnalysis`, `class AnalysisScheduler(engine, repo, visits: { reviewVisits; endVisits })` with `position(rec, t): Promise<StoredAnalysis>` and `passProbe(rec, t): Promise<StoredAnalysis>`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/analysis/scheduler.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { StubEngine } from '../../test/helpers'
import type { AnalysisResponse } from '../engine/katago-types'
import { openDb } from '../store/db'
import type { SessionRecord } from '../store/records'
import { SessionRepo } from '../store/repo'
import { compactAnalysis } from './compact'
import { AnalysisScheduler } from './scheduler'

function setup(visits = { reviewVisits: 10, endVisits: 5 }) {
  const engine = new StubEngine()
  const repo = new SessionRepo(openDb(':memory:'))
  const rec: SessionRecord = {
    id: 's1',
    createdAt: '2026-10-06T10:00:00.000Z',
    finishedAt: null,
    settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' },
    status: 'playing',
    parentSessionId: null,
    initialMoves: [{ color: 'B', vertex: [15, 3] }],
    moves: [{ color: 'W', vertex: [16, 5], actor: 'bot', inZone: true }],
    summary: null,
  }
  repo.insertSession(rec)
  return { engine, repo, rec, scheduler: new AnalysisScheduler(engine, repo, visits) }
}

describe('AnalysisScheduler', () => {
  it('analyses a position with ownership and stores it', async () => {
    const { engine, repo, rec, scheduler } = setup()
    engine.lead = () => 2.5
    const a = await scheduler.position(rec, 1)
    expect(engine.queries[0]).toMatchObject({ moves: [['B', 'Q16'], ['W', 'R14']], maxVisits: 10, includeOwnership: true })
    expect(a.rootInfo.scoreLead).toBe(2.5)
    expect(repo.getAnalysis('s1', 1, 'position')?.visits).toBe(10)
  })

  it('reuses stored results and shares concurrent requests', async () => {
    const { engine, rec, scheduler } = setup()
    await Promise.all([scheduler.position(rec, 0), scheduler.position(rec, 0)])
    await scheduler.position(rec, 0)
    expect(engine.queries).toHaveLength(1)
  })

  it('re-analyses when the stored result has fewer visits than required', async () => {
    const { engine, repo, rec } = setup()
    await new AnalysisScheduler(engine, repo, { reviewVisits: 10, endVisits: 5 }).position(rec, 0)
    await new AnalysisScheduler(engine, repo, { reviewVisits: 50, endVisits: 5 }).position(rec, 0)
    expect(engine.queries.map((q) => q.maxVisits)).toEqual([10, 50])
  })

  it('probes a pass by the side to move', async () => {
    const { engine, rec, scheduler } = setup()
    await scheduler.passProbe(rec, 1)
    expect(engine.queries[0]).toMatchObject({ moves: [['B', 'Q16'], ['W', 'R14'], ['B', 'pass']], maxVisits: 5 })
    expect(engine.queries[0].includeOwnership).toBeUndefined()
  })
})

describe('compactAnalysis', () => {
  it('keeps the five best move infos in order', () => {
    const r: AnalysisResponse = {
      id: 'x',
      turnNumber: 0,
      isDuringSearch: false,
      rootInfo: { currentPlayer: 'B', scoreLead: 1, winrate: 0.6, visits: 100 },
      moveInfos: [6, 2, 0, 5, 1, 4, 3].map((order) => ({ move: 'D4', order, visits: 10, scoreLead: order, winrate: 0.5, pv: ['D4'], prior: 0.1 })),
      ownership: [0.5],
    }
    const a = compactAnalysis(r)
    expect(a.moveInfos.map((m) => m.order)).toEqual([0, 1, 2, 3, 4])
    expect(a.moveInfos[0]).toEqual({ move: 'D4', order: 0, visits: 10, scoreLead: 0, winrate: 0.5, pv: ['D4'] })
    expect(a.rootInfo).toEqual({ currentPlayer: 'B', scoreLead: 1, winrate: 0.6, visits: 100 })
    expect(a.ownership).toEqual([0.5])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/analysis`
Expected: FAIL — `Failed to resolve import "./compact"`.

- [ ] **Step 3: Implement**

`packages/server/src/analysis/compact.ts`:
```ts
import type { AnalysisResponse } from '../engine/katago-types'
import type { StoredAnalysis } from '../store/records'

export const STORED_MOVE_INFOS = 5

export function compactAnalysis(r: AnalysisResponse): StoredAnalysis {
  const moveInfos = [...r.moveInfos]
    .sort((a, b) => a.order - b.order)
    .slice(0, STORED_MOVE_INFOS)
    .map(({ move, order, visits, scoreLead, winrate, pv }) => ({ move, order, visits, scoreLead, winrate, pv }))
  const { currentPlayer, scoreLead, winrate, visits } = r.rootInfo
  return { rootInfo: { currentPlayer, scoreLead, winrate, visits }, moveInfos, ownership: r.ownership ?? null }
}
```

`packages/server/src/analysis/scheduler.ts`:
```ts
import { nextColor } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../engine/engine'
import type { KataGoQueryBody } from '../engine/katago-types'
import { baseQuery } from '../engine/query'
import { movesBefore, type AnalysisKind, type SessionRecord, type StoredAnalysis } from '../store/records'
import type { SessionRepo } from '../store/repo'
import { compactAnalysis } from './compact'

/**
 * Runs and caches the two analyses of a session position:
 * - `position`: the position itself, `reviewVisits`, with ownership (review + end check);
 * - `pass_probe`: the position after a pass by the side to move, `endVisits` (end check only).
 * A stored result with enough visits is reused; concurrent requests share one query.
 */
export class AnalysisScheduler {
  private readonly inflight = new Map<string, Promise<StoredAnalysis>>()

  constructor(
    private readonly engine: AnalysisEngine,
    private readonly repo: SessionRepo,
    private readonly visits: { reviewVisits: number; endVisits: number },
  ) {}

  position(rec: SessionRecord, t: number): Promise<StoredAnalysis> {
    return this.run(rec, t, 'position')
  }

  passProbe(rec: SessionRecord, t: number): Promise<StoredAnalysis> {
    return this.run(rec, t, 'pass_probe')
  }

  private run(rec: SessionRecord, t: number, kind: AnalysisKind): Promise<StoredAnalysis> {
    const key = `${rec.id}:${t}:${kind}`
    const running = this.inflight.get(key)
    if (running) return running
    const visits = kind === 'position' ? this.visits.reviewVisits : this.visits.endVisits
    const stored = this.repo.getAnalysis(rec.id, t, kind)
    if (stored && stored.visits >= visits) return Promise.resolve(stored.analysis)
    const moves = movesBefore(rec, t)
    const query: KataGoQueryBody =
      kind === 'position'
        ? { ...baseQuery(moves), maxVisits: visits, includeOwnership: true }
        : { ...baseQuery([...moves, { color: nextColor(moves), vertex: 'pass' }]), maxVisits: visits }
    const job = this.engine
      .analyze(query)
      .then((r) => {
        const analysis = compactAnalysis(r)
        this.repo.saveAnalysis(rec.id, t, kind, visits, analysis)
        return analysis
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, job)
    return job
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/server/src/analysis`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/server/src/analysis
```

---

### Task 10: Session state and end detection

**Files:**
- Create: `packages/server/src/session/end-detection.ts`, `packages/server/src/session/session.ts`
- Test: `packages/server/src/session/end-detection.test.ts`, `packages/server/src/session/session.test.ts`

**Interfaces:**
- Consumes: `Position`, `nextColor`, `IllegalMoveError`, `inZone`, `zoneVertices`, `gtpToVertex` (Tasks 2–3); `SessionRecord`, `StoredAnalysis`, `movesBefore` (Task 7).
- Produces:
  - `josekiStartedIn(position, corner): boolean`, `bestMoveOutsideZone(a, corner): boolean`, `shouldProposeEnd(positionAnalysis, passProbe, corner): boolean`
  - `SessionErrorCode`, `SessionError(message, code)`
  - `class Session(record)` — fields/getters `botThinking`, `record`, `id`, `corner`, `userColor`, `position`, `turn`, `allMoves`, `toMove`, `isUserTurn`, `isPlaying`, `josekiStarted`; methods `apply(vertex, actor): PlayedMove`, `canProposeEnd()`, `proposeEnd()`, `declineEnd()`, `finish(at)`, `view(): SessionView`

- [ ] **Step 1: Write the failing tests**

`packages/server/src/session/end-detection.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { Position } from '@joseki-dojo/shared'
import type { StoredAnalysis } from '../store/records'
import { bestMoveOutsideZone, josekiStartedIn, shouldProposeEnd } from './end-detection'

const analysis = (...moves: string[]): StoredAnalysis => ({
  rootInfo: { currentPlayer: 'B', scoreLead: 0, winrate: 0.5, visits: 10 },
  moveInfos: moves.map((move, order) => ({ move, order, visits: 10, scoreLead: 0, winrate: 0.5, pv: [move] })),
  ownership: null,
})

describe('josekiStartedIn', () => {
  it('needs stones of both colors inside the zone', () => {
    expect(josekiStartedIn(Position.fromMoves([{ color: 'B', vertex: [15, 3] }]), 'TR')).toBe(false)
    expect(josekiStartedIn(Position.fromMoves([{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [3, 15] }]), 'TR')).toBe(false)
    expect(josekiStartedIn(Position.fromMoves([{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [16, 5] }]), 'TR')).toBe(true)
  })
})

describe('end detection', () => {
  it('uses the order-0 move even when it is not listed first', () => {
    const a = analysis('D4')
    a.moveInfos.unshift({ move: 'Q16', order: 1, visits: 5, scoreLead: 0, winrate: 0.5, pv: ['Q16'] })
    expect(bestMoveOutsideZone(a, 'TR')).toBe(true)
  })

  it('treats pass as outside and no moves as inside', () => {
    expect(bestMoveOutsideZone(analysis('pass'), 'TR')).toBe(true)
    expect(bestMoveOutsideZone(analysis(), 'TR')).toBe(false)
  })

  it('proposes the end only when both analyses point outside the zone', () => {
    expect(shouldProposeEnd(analysis('D4'), analysis('pass'), 'TR')).toBe(true)
    expect(shouldProposeEnd(analysis('D4'), analysis('R17'), 'TR')).toBe(false)
    expect(shouldProposeEnd(analysis('Q16'), analysis('D4'), 'TR')).toBe(false)
  })
})
```

`packages/server/src/session/session.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { IllegalMoveError } from '@joseki-dojo/shared'
import type { SessionRecord } from '../store/records'
import { Session, SessionError } from './session'

const rec = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  createdAt: '2026-10-06T10:00:00.000Z',
  finishedAt: null,
  settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' },
  status: 'playing',
  parentSessionId: null,
  initialMoves: [],
  moves: [],
  summary: null,
  ...over,
})

describe('Session', () => {
  it('alternates colors starting with Black', () => {
    const s = new Session(rec())
    expect(s.toMove).toBe('B')
    expect(s.isUserTurn).toBe(true)
    const played = s.apply([15, 3], 'user')
    expect(played).toEqual({ color: 'B', vertex: [15, 3], actor: 'user', inZone: true })
    expect(s.toMove).toBe('W')
    expect(s.isUserTurn).toBe(false)
    expect(s.turn).toBe(1)
  })

  it('continues after initial moves', () => {
    const s = new Session(rec({ initialMoves: [{ color: 'B', vertex: [15, 3] }] }))
    expect(s.toMove).toBe('W')
    expect(s.turn).toBe(0)
    expect(s.allMoves).toEqual([{ color: 'B', vertex: [15, 3] }])
  })

  it('starts the joseki once both colors are in the zone', () => {
    const s = new Session(rec())
    s.apply([15, 3], 'user')
    s.apply([3, 15], 'bot')
    expect(s.josekiStarted).toBe(false)
    s.apply([2, 3], 'user')
    s.apply([16, 5], 'bot')
    expect(s.josekiStarted).toBe(true)
  })

  it('rejects illegal moves without changing state', () => {
    const s = new Session(rec())
    s.apply([15, 3], 'user')
    expect(() => s.apply([15, 3], 'bot')).toThrow(IllegalMoveError)
    expect(s.turn).toBe(1)
    expect(s.toMove).toBe('W')
  })

  it('refuses moves after finishing', () => {
    const s = new Session(rec())
    s.finish('2026-10-06T10:05:00.000Z')
    expect(s.record.finishedAt).toBe('2026-10-06T10:05:00.000Z')
    expect(() => s.apply([15, 3], 'user')).toThrow(SessionError)
  })

  it('re-proposes the end only after two more moves', () => {
    const s = new Session(rec())
    expect(s.canProposeEnd()).toBe(false)
    s.apply([15, 3], 'user')
    s.apply([16, 5], 'bot')
    expect(s.canProposeEnd()).toBe(true)
    s.proposeEnd()
    expect(s.view().endProposed).toBe(true)
    expect(s.canProposeEnd()).toBe(false)
    s.declineEnd()
    expect(s.view().endProposed).toBe(false)
    expect(s.canProposeEnd()).toBe(false)
    s.apply([14, 5], 'user')
    expect(s.canProposeEnd()).toBe(false)
    s.apply([16, 6], 'bot')
    expect(s.canProposeEnd()).toBe(true)
  })

  it('treats playing on as declining the proposal', () => {
    const s = new Session(rec())
    s.apply([15, 3], 'user')
    s.apply([16, 5], 'bot')
    s.proposeEnd()
    s.apply([14, 5], 'user')
    expect(s.view().endProposed).toBe(false)
    expect(s.canProposeEnd()).toBe(false)
    s.apply([16, 6], 'bot')
    expect(s.canProposeEnd()).toBe(true)
  })

  it('rebuilds its state from a stored record', () => {
    const s = new Session(
      rec({
        moves: [
          { color: 'B', vertex: [15, 3], actor: 'user', inZone: true },
          { color: 'W', vertex: [16, 5], actor: 'bot', inZone: true },
        ],
      }),
    )
    expect(s.turn).toBe(2)
    expect(s.toMove).toBe('B')
    expect(s.josekiStarted).toBe(true)
    expect(s.position.colorAt([16, 5])).toBe('W')
  })

  it('exposes a view', () => {
    const s = new Session(rec())
    s.botThinking = true
    expect(s.view()).toEqual({
      id: 's1',
      settings: rec().settings,
      initialMoves: [],
      moves: [],
      toMove: 'B',
      status: 'playing',
      josekiStarted: false,
      endProposed: false,
      botThinking: true,
      parentSessionId: null,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/session`
Expected: FAIL — `Failed to resolve import "./end-detection"` / `"./session"`.

- [ ] **Step 3: Implement**

`packages/server/src/session/end-detection.ts`:
```ts
import { gtpToVertex, inZone, zoneVertices, type Corner, type Position } from '@joseki-dojo/shared'
import type { StoredAnalysis } from '../store/records'

/** The joseki has started once the zone holds stones of both colors. */
export function josekiStartedIn(position: Position, corner: Corner): boolean {
  let black = false
  let white = false
  for (const v of zoneVertices(corner)) {
    const c = position.colorAt(v)
    if (c === 'B') black = true
    else if (c === 'W') white = true
    if (black && white) return true
  }
  return false
}

export function bestMoveOutsideZone(a: StoredAnalysis, corner: Corner): boolean {
  const best = [...a.moveInfos].sort((x, y) => x.order - y.order)[0]
  if (!best) return false
  return !inZone(corner, gtpToVertex(best.move))
}

/** Spec 8.5: the position and the pass probe both say the biggest move is elsewhere. */
export function shouldProposeEnd(position: StoredAnalysis, passProbe: StoredAnalysis, corner: Corner): boolean {
  return bestMoveOutsideZone(position, corner) && bestMoveOutsideZone(passProbe, corner)
}
```

`packages/server/src/session/session.ts`:
```ts
import { inZone, nextColor, Position, type Actor, type Color, type Corner, type Move, type MoveVertex, type PlayedMove, type SessionView } from '@joseki-dojo/shared'
import { movesBefore, type SessionRecord } from '../store/records'
import { josekiStartedIn } from './end-detection'

export type SessionErrorCode = 'bad_request' | 'outside_zone' | 'not_your_turn' | 'session_not_found' | 'session_finished'

export class SessionError extends Error {
  constructor(message: string, readonly code: SessionErrorCode) {
    super(message)
    this.name = 'SessionError'
  }
}

/** In-memory state of one training session; mutates the SessionRecord it wraps. */
export class Session {
  botThinking = false
  private pos: Position
  private started: boolean
  private endProposed = false
  private movesSinceDecline: number | null = null

  constructor(readonly record: SessionRecord) {
    const corner = record.settings.corner
    let pos = Position.fromMoves(record.initialMoves)
    let started = josekiStartedIn(pos, corner)
    for (const m of record.moves) {
      pos = pos.play(m)
      started ||= josekiStartedIn(pos, corner)
    }
    this.pos = pos
    this.started = started
  }

  get id(): string {
    return this.record.id
  }

  get corner(): Corner {
    return this.record.settings.corner
  }

  get userColor(): Color {
    return this.record.settings.userColor
  }

  get position(): Position {
    return this.pos
  }

  /** Index of the current position (= number of session moves). */
  get turn(): number {
    return this.record.moves.length
  }

  get allMoves(): Move[] {
    return movesBefore(this.record, this.turn)
  }

  get toMove(): Color {
    return nextColor(this.allMoves)
  }

  get isUserTurn(): boolean {
    return this.toMove === this.userColor
  }

  get isPlaying(): boolean {
    return this.record.status === 'playing'
  }

  get josekiStarted(): boolean {
    return this.started
  }

  /** Plays `vertex` for the side to move. Throws IllegalMoveError or SessionError and leaves state unchanged. */
  apply(vertex: MoveVertex, actor: Actor): PlayedMove {
    if (!this.isPlaying) throw new SessionError('Тренировка уже закончена', 'session_finished')
    const color = this.toMove
    const next = this.pos.play({ color, vertex })
    const played: PlayedMove = { color, vertex, actor, inZone: inZone(this.corner, vertex) }
    this.record.moves.push(played)
    this.pos = next
    this.started ||= josekiStartedIn(next, this.corner)
    if (this.endProposed) {
      // Playing on instead of answering the proposal counts as «Играть дальше».
      this.endProposed = false
      this.movesSinceDecline = 0
    }
    if (this.movesSinceDecline !== null) this.movesSinceDecline++
    return played
  }

  canProposeEnd(): boolean {
    return (
      this.isPlaying &&
      this.started &&
      !this.endProposed &&
      (this.movesSinceDecline === null || this.movesSinceDecline >= 2)
    )
  }

  proposeEnd(): void {
    this.endProposed = true
  }

  declineEnd(): void {
    if (!this.endProposed) return
    this.endProposed = false
    this.movesSinceDecline = 0
  }

  finish(at: string): void {
    this.record.status = 'finished'
    this.record.finishedAt = at
    this.endProposed = false
  }

  view(): SessionView {
    return {
      id: this.id,
      settings: this.record.settings,
      initialMoves: [...this.record.initialMoves],
      moves: [...this.record.moves],
      toMove: this.toMove,
      status: this.record.status,
      josekiStarted: this.started,
      endProposed: this.endProposed,
      botThinking: this.botThinking,
      parentSessionId: this.record.parentSessionId,
    }
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/server/src/session`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/server/src/session
```

---

### Task 11: Review computation

**Files:**
- Create: `packages/server/src/review/compute.ts`
- Test: `packages/server/src/review/compute.test.ts`

**Interfaces:**
- Consumes: shared review types, `gtpToVertex`, `colorSign` (Tasks 2–3); `Thresholds` (Task 4); `StoredAnalysis`, `MissedPunishmentRow` (Task 7).
- Produces: `categorize(loss, th): Category`, `moveLosses(leadsBlack, moves): number[]`, `candidatesOf(a, limit = 3): Candidate[]`, `findPunishments(moves, losses, userColor, th): PunishmentEvent[]`, `summarize(moves, losses, events, userColor): ReviewSummary`, `ReviewInput`, `buildReview(input): ReviewData`, `missedPunishmentRows(review): MissedPunishmentRow[]`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/review/compute.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { Actor, Color, PlayedMove, Vertex } from '@joseki-dojo/shared'
import type { StoredAnalysis } from '../store/records'
import { buildReview, candidatesOf, categorize, findPunishments, missedPunishmentRows, moveLosses, summarize } from './compute'

const th = { inaccuracy: 0.5, mistake: 2, blunder: 5, punished: 1 }
const m = (color: Color, actor: Actor, vertex: Vertex = [0, 0]): PlayedMove => ({ color, actor, vertex, inZone: true })

const analysis = (currentPlayer: Color, scoreLead: number, best = 'D4'): StoredAnalysis => ({
  rootInfo: { currentPlayer, scoreLead, winrate: 0.5, visits: 10 },
  moveInfos: [{ move: best, order: 0, visits: 10, scoreLead, winrate: 0.5, pv: [best] }],
  ownership: null,
})

describe('categorize', () => {
  it('uses the thresholds as lower bounds', () => {
    expect(categorize(0.49, th)).toBe('exact')
    expect(categorize(0.5, th)).toBe('inaccuracy')
    expect(categorize(1.99, th)).toBe('inaccuracy')
    expect(categorize(2, th)).toBe('mistake')
    expect(categorize(5, th)).toBe('blunder')
  })
})

describe('moveLosses', () => {
  it('measures each move from the mover’s side and clips noise at zero', () => {
    expect(moveLosses([3, 1, 4, 4.3], [m('B', 'user'), m('W', 'bot'), m('B', 'user')])).toEqual([2, 3, 0])
  })
})

describe('candidatesOf', () => {
  it('sorts by order and measures losses for the side to move', () => {
    const a: StoredAnalysis = {
      rootInfo: { currentPlayer: 'W', scoreLead: -2, winrate: 0.4, visits: 10 },
      moveInfos: [
        { move: 'R14', order: 1, visits: 3, scoreLead: -1, winrate: 0.45, pv: ['R14'] },
        { move: 'Q14', order: 0, visits: 6, scoreLead: -2, winrate: 0.4, pv: ['Q14', 'R14'] },
        { move: 'pass', order: 2, visits: 1, scoreLead: 3, winrate: 0.7, pv: [] },
        { move: 'D4', order: 3, visits: 1, scoreLead: 0, winrate: 0.5, pv: [] },
      ],
      ownership: null,
    }
    expect(candidatesOf(a)).toEqual([
      { vertex: [15, 5], loss: 0, pv: [[15, 5], [16, 5]] },
      { vertex: [16, 5], loss: 1, pv: [[16, 5]] },
      { vertex: 'pass', loss: 5, pv: [] },
    ])
  })
})

describe('punishments', () => {
  const moves = [m('B', 'user'), m('W', 'bot'), m('B', 'user'), m('W', 'bot'), m('B', 'auto-tenuki'), m('W', 'bot')]
  const losses = [0, 3, 0.4, 6, 4, 2.5]

  it('scores the user reply to every bot mistake that has one', () => {
    const events = findPunishments(moves, losses, 'B', th)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ turn: 1, botLoss: 3, userLoss: 0.4, punished: true })
    expect(events[0].kept).toBeCloseTo(2.6)
    expect(events[1]).toEqual({ turn: 3, botLoss: 6, userLoss: 4, punished: false, kept: 2 })
  })

  it('ignores bot inaccuracies', () => {
    expect(findPunishments([m('W', 'bot'), m('B', 'user')], [1.5, 0], 'B', th)).toEqual([])
  })

  it('summarizes the session', () => {
    const events = findPunishments(moves, losses, 'B', th)
    const s = summarize(moves, losses, events, 'B')
    expect(s.userLoss).toBeCloseTo(4.4)
    expect(s.botMistakes).toBe(2)
    expect(s.botMistakeLoss).toBe(9)
    expect(s.punished).toBe(1)
    expect(s.keptPoints).toBeCloseTo(4.6)
  })
})

describe('buildReview', () => {
  const moves = [m('B', 'user', [15, 3]), m('W', 'bot', [16, 5]), m('B', 'user', [14, 5])]
  const analyses = [analysis('B', 0), analysis('W', 0), analysis('B', 3), analysis('W', 2)]
  const input = {
    sessionId: 's1',
    settings: { mode: 'free' as const, environment: 'empty' as const, userColor: 'B' as const, botRank: '7k', corner: 'TR' as const },
    initialMoves: [],
    moves,
    analyses,
    thresholds: th,
  }

  it('requires one analysis per position', () => {
    expect(() => buildReview({ ...input, analyses: analyses.slice(1) })).toThrow(/Expected 4 analyses/)
  })

  it('assembles losses, categories, punishments and the summary', () => {
    const r = buildReview(input)
    expect(r.moveReviews.map((x) => x.category)).toEqual(['exact', 'mistake', 'inaccuracy'])
    expect(r.punishments).toEqual([{ turn: 1, botLoss: 3, userLoss: 1, punished: false, kept: 2 }])
    expect(r.summary).toEqual({ userLoss: 1, botMistakes: 1, botMistakeLoss: 3, punished: 0, keptPoints: 2 })
    expect(r.positions).toHaveLength(4)
    expect(r.positions[0].candidates[0].vertex).toEqual([3, 15])
  })

  it('lists missed punishments with the best reply', () => {
    expect(missedPunishmentRows(buildReview(input))).toEqual([
      { turn: 1, botMove: [16, 5], botLoss: 3, userMove: [14, 5], userLoss: 1, bestMove: [3, 15], bestPv: [[3, 15]] },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/review`
Expected: FAIL — `Failed to resolve import "./compute"`.

- [ ] **Step 3: Implement**

`packages/server/src/review/compute.ts`:
```ts
import {
  colorSign,
  gtpToVertex,
  type Candidate,
  type Category,
  type Color,
  type Move,
  type MoveReview,
  type PlayedMove,
  type PositionReview,
  type PunishmentEvent,
  type ResolvedSettings,
  type ReviewData,
  type ReviewSummary,
} from '@joseki-dojo/shared'
import type { Thresholds } from '../config'
import type { MissedPunishmentRow, StoredAnalysis } from '../store/records'

export function categorize(loss: number, th: Thresholds): Category {
  if (loss >= th.blunder) return 'blunder'
  if (loss >= th.mistake) return 'mistake'
  if (loss >= th.inaccuracy) return 'inaccuracy'
  return 'exact'
}

/** Spec 9.2. `leadsBlack[t]` is the root scoreLead (Black's view) of position t; length moves.length + 1. */
export function moveLosses(leadsBlack: readonly number[], moves: readonly PlayedMove[]): number[] {
  return moves.map((m, t) => Math.max(0, colorSign(m.color) * (leadsBlack[t] - leadsBlack[t + 1])))
}

/** Up to `limit` engine candidates; losses are measured inside the same search against order 0. */
export function candidatesOf(a: StoredAnalysis, limit = 3): Candidate[] {
  const sorted = [...a.moveInfos].sort((x, y) => x.order - y.order)
  const best = sorted[0]
  if (!best) return []
  const sign = colorSign(a.rootInfo.currentPlayer)
  return sorted.slice(0, limit).map((mi) => ({
    vertex: gtpToVertex(mi.move),
    loss: Math.max(0, sign * (best.scoreLead - mi.scoreLead)),
    pv: mi.pv.map(gtpToVertex),
  }))
}

/** Spec 9.5: every bot mistake followed by a user reply. */
export function findPunishments(
  moves: readonly PlayedMove[],
  losses: readonly number[],
  userColor: Color,
  th: Thresholds,
): PunishmentEvent[] {
  const events: PunishmentEvent[] = []
  moves.forEach((m, t) => {
    if (m.actor !== 'bot' || losses[t] < th.mistake) return
    const reply = moves[t + 1]
    if (!reply || reply.color !== userColor) return
    const userLoss = losses[t + 1]
    const returned = Math.min(userLoss, losses[t])
    events.push({ turn: t, botLoss: losses[t], userLoss, punished: userLoss < th.punished, kept: losses[t] - returned })
  })
  return events
}

export function summarize(
  moves: readonly PlayedMove[],
  losses: readonly number[],
  events: readonly PunishmentEvent[],
  userColor: Color,
): ReviewSummary {
  return {
    userLoss: moves.reduce((sum, m, t) => (m.color === userColor ? sum + losses[t] : sum), 0),
    botMistakes: events.length,
    botMistakeLoss: events.reduce((sum, e) => sum + e.botLoss, 0),
    punished: events.filter((e) => e.punished).length,
    keptPoints: events.reduce((sum, e) => sum + e.kept, 0),
  }
}

export interface ReviewInput {
  sessionId: string
  settings: ResolvedSettings
  initialMoves: Move[]
  moves: PlayedMove[]
  /** Position analyses 0..moves.length. */
  analyses: StoredAnalysis[]
  thresholds: Thresholds
}

export function buildReview(input: ReviewInput): ReviewData {
  const { moves, analyses, thresholds } = input
  if (analyses.length !== moves.length + 1) {
    throw new Error(`Expected ${moves.length + 1} analyses, got ${analyses.length}`)
  }
  const losses = moveLosses(analyses.map((a) => a.rootInfo.scoreLead), moves)
  const positions: PositionReview[] = analyses.map((a, turn) => ({
    turn,
    scoreLeadBlack: a.rootInfo.scoreLead,
    candidates: candidatesOf(a),
    ownership: a.ownership,
  }))
  const moveReviews: MoveReview[] = moves.map((m, turn) => ({
    turn,
    color: m.color,
    actor: m.actor,
    vertex: m.vertex,
    loss: losses[turn],
    category: categorize(losses[turn], thresholds),
  }))
  const punishments = findPunishments(moves, losses, input.settings.userColor, thresholds)
  return {
    sessionId: input.sessionId,
    settings: input.settings,
    initialMoves: input.initialMoves,
    moves,
    positions,
    moveReviews,
    punishments,
    summary: summarize(moves, losses, punishments, input.settings.userColor),
  }
}

export function missedPunishmentRows(review: ReviewData): MissedPunishmentRow[] {
  return review.punishments
    .filter((e) => !e.punished)
    .map((e) => {
      const best = review.positions[e.turn + 1].candidates[0]
      return {
        turn: e.turn,
        botMove: review.moves[e.turn].vertex,
        botLoss: e.botLoss,
        userMove: review.moves[e.turn + 1].vertex,
        userLoss: e.userLoss,
        bestMove: best?.vertex ?? 'pass',
        bestPv: best?.pv ?? [],
      }
    })
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/server/src/review`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Milestone commit**

```bash
git add packages/server/src/review
git commit -m "feat(server): add human-like bot, analysis scheduler, session state and review computation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Session service

**Files:**
- Create: `packages/server/src/errors.ts`, `packages/server/src/session/service.ts`
- Test: `packages/server/src/errors.test.ts`, `packages/server/src/session/service.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–10 (`Session`, `SessionError`, `shouldProposeEnd`, `AnalysisScheduler`, `MoveChooser`, `HumanBot`, `Rng`, `AnalysisEngine`, `EngineError`, `baseQuery`, `SessionRepo`, `movesBefore`, `AppConfig`); test helpers `StubEngine`, `testConfig`, `isHumanQuery`, `isPassProbe`, `isTenukiQuery`.
- Produces:
  - `toErrorMessage(err): Extract<ServerMessage, { type: 'error' }>`
  - `SessionServiceDeps { repo; analysis; bot; engine; config; publish(sessionId, msg); onFinished(sessionId); rng?; newId?; now? }`
  - `validateSettings(s: SessionSettings): void`
  - `class SessionService(deps)`: `start(settings): SessionView`, `replayFrom(sessionId, turn): SessionView`, `view(sessionId): SessionView`, `playUserMove(sessionId, vertex): void`, `tenuki(sessionId): Promise<void>`, `finish(sessionId): void`, `continuePlaying(sessionId): void`, `resync(sessionId): SessionView`

Behaviour (spec 8): after every position change the service publishes `sessionState`, schedules the position analysis (plus the pass probe once the joseki has started) and, if the bot is to move, asks the bot. An end proposal is published only if the analysed position is still current. Reaching `maxSessionMoves` finishes the session. `resync` restarts work that might have been lost: the current analysis and a pending bot move for a playing session, or the review for a finished session without a stored summary.

- [ ] **Step 1: Write the failing tests**

`packages/server/src/errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { IllegalMoveError } from '@joseki-dojo/shared'
import { EngineError } from './engine/engine'
import { toErrorMessage } from './errors'
import { SessionError } from './session/session'

describe('toErrorMessage', () => {
  it('maps known errors to protocol codes', () => {
    expect(toErrorMessage(new IllegalMoveError('Ko prevented'))).toEqual({ type: 'error', code: 'illegal_move', message: 'Недопустимый ход' })
    expect(toErrorMessage(new SessionError('Сейчас ход бота', 'not_your_turn'))).toEqual({ type: 'error', code: 'not_your_turn', message: 'Сейчас ход бота' })
    expect(toErrorMessage(new EngineError('boom', 'engine_failed'))).toEqual({ type: 'error', code: 'engine_error', message: 'boom' })
    expect(toErrorMessage(new Error('x'))).toEqual({ type: 'error', code: 'internal_error', message: 'x' })
  })
})
```

`packages/server/src/session/service.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { gtpToVertex, inZone, Position, zoneVertices, type ServerMessage, type SessionSettings, type SessionView, type Vertex } from '@joseki-dojo/shared'
import { isHumanQuery, isPassProbe, isTenukiQuery, StubEngine, testConfig } from '../../test/helpers'
import { AnalysisScheduler } from '../analysis/scheduler'
import { HumanBot } from '../bot/bot'
import { mulberry32 } from '../bot/rng'
import type { AppConfig } from '../config'
import { EngineError } from '../engine/engine'
import { openDb } from '../store/db'
import { SessionRepo } from '../store/repo'
import { SessionService } from './service'
import { SessionError } from './session'

const settings = (over: Partial<SessionSettings> = {}): SessionSettings => ({
  mode: 'free',
  environment: 'empty',
  userColor: 'B',
  botRank: '7k',
  corner: 'TR',
  ...over,
})

function setup(config: Partial<AppConfig> = {}, repo = new SessionRepo(openDb(':memory:')), engine = new StubEngine()) {
  const cfg = testConfig(config)
  const published: { id: string; msg: ServerMessage }[] = []
  const finished: string[] = []
  let n = 0
  const service = new SessionService({
    repo,
    engine,
    config: cfg,
    analysis: new AnalysisScheduler(engine, repo, cfg.analysis),
    bot: new HumanBot(engine, mulberry32(1)),
    publish: (id, msg) => published.push({ id, msg }),
    onFinished: (id) => finished.push(id),
    rng: mulberry32(7),
    newId: () => `s${++n}`,
    now: () => '2026-10-06T10:00:00.000Z',
  })
  const errors = (): ServerMessage[] => published.filter((p) => p.msg.type === 'error').map((p) => p.msg)
  return { service, engine, repo, published, finished, errors }
}

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn()
  } catch (err) {
    return (err as { code?: string }).code ?? 'no-code'
  }
  return null
}

/** A free, legal point of the TR zone in the current position. */
const freeZonePoint = (v: SessionView): Vertex => {
  const p = Position.fromMoves([...v.initialMoves, ...v.moves])
  const found = zoneVertices('TR').find((x) => p.colorAt(x) === null && p.isLegal(v.toMove, x))
  if (!found) throw new Error('zone is full')
  return found
}

describe('SessionService', () => {
  it('starts a session and analyses the empty position', async () => {
    const { service, engine } = setup()
    const v = service.start(settings())
    expect(v).toMatchObject({ id: 's1', toMove: 'B', status: 'playing', botThinking: false, josekiStarted: false })
    await vi.waitFor(() => expect(engine.queries.some((q) => q.includeOwnership === true && q.moves.length === 0)).toBe(true))
  })

  it('resolves a random color and corner', () => {
    const v = setup().service.start(settings({ userColor: 'random', corner: 'random' }))
    expect(['B', 'W']).toContain(v.settings.userColor)
    expect(['TL', 'TR', 'BL', 'BR']).toContain(v.settings.corner)
  })

  it('rejects invalid settings', () => {
    const { service } = setup()
    expect(() => service.start(settings({ botRank: '99k' }))).toThrow(SessionError)
  })

  it('lets the bot open when the user plays White', async () => {
    const { service } = setup()
    const v = service.start(settings({ userColor: 'W' }))
    expect(v.botThinking).toBe(true)
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(1))
    expect(service.view(v.id).moves[0]).toMatchObject({ color: 'B', actor: 'bot', inZone: true })
  })

  it('answers a user move with a bot move in the zone', async () => {
    const { service } = setup()
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(2))
    expect(service.view(v.id).moves[1]).toMatchObject({ color: 'W', actor: 'bot', inZone: true })
  })

  it('rejects moves outside the zone and out of turn', () => {
    const { service, engine } = setup()
    const v = service.start(settings())
    expect(codeOf(() => service.playUserMove(v.id, [3, 15]))).toBe('outside_zone')
    engine.hold = true
    service.playUserMove(v.id, [15, 3])
    expect(codeOf(() => service.playUserMove(v.id, [16, 3]))).toBe('not_your_turn')
    engine.release()
  })

  it('proposes the end when both analyses point outside the zone', async () => {
    const { service } = setup()
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).endProposed).toBe(true))
    expect(service.view(v.id).moves).toHaveLength(2)
  })

  it('does not propose the end while the best move stays in the zone', async () => {
    const { service, engine } = setup()
    engine.best = (q) => (isTenukiQuery(q) ? q.allowMoves![0].moves[0] : 'R17')
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(engine.queries.some(isPassProbe)).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(service.view(v.id).endProposed).toBe(false)
  })

  it('proposes again only two moves after «Играть дальше»', async () => {
    const { service } = setup()
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).endProposed).toBe(true))
    service.continuePlaying(v.id)
    expect(service.view(v.id).endProposed).toBe(false)
    service.playUserMove(v.id, freeZonePoint(service.view(v.id)))
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(4))
    await vi.waitFor(() => expect(service.view(v.id).endProposed).toBe(true))
  })

  it('finishes on request, once', () => {
    const { service, repo, finished } = setup()
    const v = service.start(settings())
    service.finish(v.id)
    service.finish(v.id)
    expect(service.view(v.id).status).toBe('finished')
    expect(repo.getSession(v.id)?.status).toBe('finished')
    expect(finished).toEqual([v.id])
  })

  it('finishes automatically at the move limit', async () => {
    const { service, finished } = setup({ maxSessionMoves: 2 })
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).status).toBe('finished'))
    expect(service.view(v.id).moves).toHaveLength(2)
    expect(finished).toEqual([v.id])
  })

  it('plays tenuki for the user at the best point outside the zone', async () => {
    const { service, engine } = setup()
    const v = service.start(settings())
    await service.tenuki(v.id)
    const q = engine.queries.find(isTenukiQuery)!
    expect(q.allowMoves![0].player).toBe('B')
    expect(q.allowMoves![0].moves.every((m) => !inZone('TR', gtpToVertex(m)))).toBe(true)
    expect(service.view(v.id).moves[0]).toMatchObject({ actor: 'auto-tenuki', inZone: false, vertex: gtpToVertex(q.allowMoves![0].moves[0]) })
  })

  it('reports a failed bot move and retries it on resync', async () => {
    const { service, engine, errors } = setup()
    engine.fail = { when: isHumanQuery, error: new EngineError('boom', 'query_error') }
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(errors()).toEqual([{ type: 'error', code: 'engine_error', message: 'boom' }]))
    expect(service.view(v.id).botThinking).toBe(false)
    expect(service.view(v.id).moves).toHaveLength(1)
    service.resync(v.id)
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(2))
  })

  it('restores sessions from the database', async () => {
    const repo = new SessionRepo(openDb(':memory:'))
    const first = setup({}, repo)
    const v = first.service.start(settings())
    first.service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(first.service.view(v.id).moves).toHaveLength(2))
    const second = setup({}, repo)
    expect(second.service.resync(v.id).moves).toEqual(first.service.view(v.id).moves)
  })

  it('replays from a chosen move', async () => {
    const { service } = setup()
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(2))
    const r = service.replayFrom(v.id, 1)
    expect(r).toMatchObject({ parentSessionId: v.id, initialMoves: [{ color: 'B', vertex: [15, 3] }], moves: [], toMove: 'W' })
    await vi.waitFor(() => expect(service.view(r.id).moves).toHaveLength(1))
    expect(() => service.replayFrom(v.id, 5)).toThrow(SessionError)
  })

  it('restarts the review on resync of a finished session without a summary', () => {
    const { service, finished } = setup()
    const v = service.start(settings())
    service.finish(v.id)
    service.resync(v.id)
    expect(finished).toEqual([v.id, v.id])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/errors.test.ts packages/server/src/session/service.test.ts`
Expected: FAIL — `Failed to resolve import "./errors"` / `"./service"`.

- [ ] **Step 3: Implement**

`packages/server/src/errors.ts`:
```ts
import { IllegalMoveError, type ServerMessage } from '@joseki-dojo/shared'
import { EngineError } from './engine/engine'
import { SessionError } from './session/session'

export function toErrorMessage(err: unknown): Extract<ServerMessage, { type: 'error' }> {
  if (err instanceof IllegalMoveError) return { type: 'error', code: 'illegal_move', message: 'Недопустимый ход' }
  if (err instanceof SessionError) return { type: 'error', code: err.code, message: err.message }
  if (err instanceof EngineError) return { type: 'error', code: 'engine_error', message: err.message }
  return { type: 'error', code: 'internal_error', message: err instanceof Error ? err.message : String(err) }
}
```

`packages/server/src/session/service.ts`:
```ts
import { randomUUID } from 'node:crypto'
import {
  CORNERS,
  gtpToVertex,
  inZone,
  isBotRank,
  vertexToGtp,
  type Actor,
  type Move,
  type MoveVertex,
  type ResolvedSettings,
  type ServerMessage,
  type SessionSettings,
  type SessionView,
  type Vertex,
} from '@joseki-dojo/shared'
import type { AnalysisScheduler } from '../analysis/scheduler'
import type { MoveChooser } from '../bot/bot'
import type { Rng } from '../bot/rng'
import type { AppConfig } from '../config'
import type { AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import { toErrorMessage } from '../errors'
import { movesBefore, type SessionRecord } from '../store/records'
import type { SessionRepo } from '../store/repo'
import { shouldProposeEnd } from './end-detection'
import { Session, SessionError } from './session'

export interface SessionServiceDeps {
  repo: SessionRepo
  analysis: AnalysisScheduler
  bot: MoveChooser
  engine: AnalysisEngine
  config: AppConfig
  publish: (sessionId: string, msg: ServerMessage) => void
  /** Starts the review of a finished session. */
  onFinished: (sessionId: string) => void
  rng?: Rng
  newId?: () => string
  now?: () => string
}

export function validateSettings(s: SessionSettings): void {
  const ok =
    s.mode === 'free' &&
    s.environment === 'empty' &&
    (s.userColor === 'B' || s.userColor === 'W' || s.userColor === 'random') &&
    typeof s.botRank === 'string' &&
    isBotRank(s.botRank) &&
    (s.corner === 'random' || CORNERS.includes(s.corner))
  if (!ok) throw new SessionError('Некорректные настройки тренировки', 'bad_request')
}

export class SessionService {
  private readonly active = new Map<string, Session>()
  private readonly rng: Rng
  private readonly newId: () => string
  private readonly now: () => string

  constructor(private readonly d: SessionServiceDeps) {
    this.rng = d.rng ?? Math.random
    this.newId = d.newId ?? randomUUID
    this.now = d.now ?? (() => new Date().toISOString())
  }

  start(settings: SessionSettings): SessionView {
    validateSettings(settings)
    const resolved: ResolvedSettings = {
      mode: settings.mode,
      environment: settings.environment,
      botRank: settings.botRank,
      userColor: settings.userColor === 'random' ? (this.rng() < 0.5 ? 'B' : 'W') : settings.userColor,
      corner: settings.corner === 'random' ? CORNERS[Math.floor(this.rng() * CORNERS.length)] : settings.corner,
    }
    return this.create(resolved, [], null)
  }

  replayFrom(sessionId: string, turn: number): SessionView {
    const parent = this.load(sessionId)
    if (!Number.isInteger(turn) || turn < 0 || turn > parent.turn) throw new SessionError('Нет такого хода', 'bad_request')
    return this.create(parent.record.settings, movesBefore(parent.record, turn), parent.id)
  }

  view(sessionId: string): SessionView {
    return this.load(sessionId).view()
  }

  playUserMove(sessionId: string, vertex: Vertex): void {
    const s = this.load(sessionId)
    this.requireUserTurn(s)
    if (!inZone(s.corner, vertex)) throw new SessionError('Ходить можно только в зоне угла', 'outside_zone')
    this.commit(s, vertex, 'user')
  }

  /** Spec 8.3: plays the main network's best move outside the zone for the user. */
  async tenuki(sessionId: string): Promise<void> {
    const s = this.load(sessionId)
    this.requireUserTurn(s)
    const turn = s.turn
    const color = s.toMove
    const outside = s.position.emptyVertices().filter((v) => !inZone(s.corner, v) && s.position.isLegal(color, v))
    let vertex: MoveVertex = 'pass'
    if (outside.length > 0) {
      const r = await this.d.engine.analyze({
        ...baseQuery(s.allMoves),
        maxVisits: this.d.config.analysis.endVisits,
        priority: 10,
        allowMoves: [{ player: color, moves: outside.map(vertexToGtp), untilDepth: 1 }],
      })
      const best = [...r.moveInfos].sort((a, b) => a.order - b.order)[0]
      if (best) vertex = gtpToVertex(best.move)
    }
    if (s.turn !== turn || !s.isPlaying) return
    this.commit(s, vertex, 'auto-tenuki')
  }

  finish(sessionId: string): void {
    const s = this.load(sessionId)
    if (!s.isPlaying) return
    s.finish(this.now())
    this.d.repo.setStatus(s.id, 'finished', s.record.finishedAt)
    this.publishState(s)
    this.d.onFinished(s.id)
  }

  continuePlaying(sessionId: string): void {
    const s = this.load(sessionId)
    s.declineEnd()
    this.publishState(s)
  }

  /** Re-sends the state and restarts work that may have been lost (analysis, bot move, review). */
  resync(sessionId: string): SessionView {
    const s = this.load(sessionId)
    if (s.isPlaying) {
      this.scheduleAnalysis(s)
      if (!s.isUserTurn) void this.runBot(s)
    } else if (s.record.status === 'finished' && this.d.repo.getSession(s.id)?.summary === null) {
      this.d.onFinished(s.id)
    }
    return s.view()
  }

  private create(settings: ResolvedSettings, initialMoves: Move[], parentSessionId: string | null): SessionView {
    const record: SessionRecord = {
      id: this.newId(),
      createdAt: this.now(),
      finishedAt: null,
      settings,
      status: 'playing',
      parentSessionId,
      initialMoves,
      moves: [],
      summary: null,
    }
    this.d.repo.insertSession(record)
    const s = new Session(record)
    this.active.set(s.id, s)
    this.afterPositionChanged(s)
    return s.view()
  }

  private commit(s: Session, vertex: MoveVertex, actor: Actor): void {
    const played = s.apply(vertex, actor)
    this.d.repo.insertMove(s.id, s.turn - 1, played)
    this.afterPositionChanged(s)
  }

  private afterPositionChanged(s: Session): void {
    if (s.turn >= this.d.config.maxSessionMoves) {
      this.finish(s.id)
      return
    }
    this.publishState(s)
    this.scheduleAnalysis(s)
    if (!s.isUserTurn) void this.runBot(s)
  }

  private scheduleAnalysis(s: Session): void {
    const t = s.turn
    const started = s.josekiStarted
    this.d.analysis
      .position(s.record, t)
      .then(async (a) => {
        if (!started || s.turn !== t || !s.isPlaying) return
        const b = await this.d.analysis.passProbe(s.record, t)
        if (s.turn === t && s.canProposeEnd() && shouldProposeEnd(a, b, s.corner)) {
          s.proposeEnd()
          this.publishState(s)
        }
      })
      .catch((err: unknown) => this.d.publish(s.id, toErrorMessage(err)))
  }

  private async runBot(s: Session): Promise<void> {
    if (s.botThinking || !s.isPlaying || s.isUserTurn) return
    s.botThinking = true
    this.publishState(s)
    const t = s.turn
    try {
      const vertex = await this.d.bot.chooseMove({
        moves: s.allMoves,
        position: s.position,
        color: s.toMove,
        corner: s.corner,
        josekiStarted: s.josekiStarted,
        rank: s.record.settings.botRank,
        temperature: this.d.config.bot.temperature,
      })
      s.botThinking = false
      if (s.turn !== t || !s.isPlaying) {
        this.publishState(s)
        return
      }
      this.commit(s, vertex, 'bot')
    } catch (err) {
      s.botThinking = false
      this.publishState(s)
      this.d.publish(s.id, toErrorMessage(err))
    }
  }

  private load(sessionId: string): Session {
    const cached = this.active.get(sessionId)
    if (cached) return cached
    const rec = this.d.repo.getSession(sessionId)
    if (!rec) throw new SessionError('Тренировка не найдена', 'session_not_found')
    const s = new Session(rec)
    this.active.set(sessionId, s)
    return s
  }

  private requireUserTurn(s: Session): void {
    if (!s.isPlaying) throw new SessionError('Тренировка уже закончена', 'session_finished')
    if (!s.isUserTurn || s.botThinking) throw new SessionError('Сейчас ход бота', 'not_your_turn')
  }

  private publishState(s: Session): void {
    this.d.publish(s.id, { type: 'sessionState', session: s.view() })
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/server/src/errors.test.ts packages/server/src/session`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/server/src/errors.ts packages/server/src/errors.test.ts packages/server/src/session
```

---

### Task 13: Review service

**Files:**
- Create: `packages/server/src/review/service.ts`
- Test: `packages/server/src/review/service.test.ts`

**Interfaces:**
- Consumes: `AnalysisScheduler` (Task 9), `buildReview`, `missedPunishmentRows` (Task 11), `SessionError` (Task 10), `SessionRepo` (Task 7), `AppConfig` (Task 4).
- Produces: `ReviewResult = { status: 'ok'; review: ReviewData } | { status: 'not_found' } | { status: 'not_ready' }`, `ReviewServiceDeps { repo; analysis; config; publish; now? }`, `class ReviewService(deps)` with `prepare(sessionId): Promise<ReviewData>` (publishes `analysisProgress` from `0/total` to `total/total`, then `reviewReady`; stores summary and missed punishments) and `get(sessionId): ReviewResult`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/review/service.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '@joseki-dojo/shared'
import { StubEngine, testConfig } from '../../test/helpers'
import { AnalysisScheduler } from '../analysis/scheduler'
import { SessionError } from '../session/session'
import { openDb } from '../store/db'
import type { SessionRecord } from '../store/records'
import { SessionRepo } from '../store/repo'
import { ReviewService } from './service'

function setup() {
  const engine = new StubEngine()
  const repo = new SessionRepo(openDb(':memory:'))
  const config = testConfig()
  const published: ServerMessage[] = []
  const reviews = new ReviewService({
    repo,
    config,
    analysis: new AnalysisScheduler(engine, repo, config.analysis),
    publish: (_id, msg) => published.push(msg),
    now: () => '2026-10-06T10:10:00.000Z',
  })
  const rec: SessionRecord = {
    id: 's1',
    createdAt: '2026-10-06T10:00:00.000Z',
    finishedAt: '2026-10-06T10:05:00.000Z',
    settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' },
    status: 'finished',
    parentSessionId: null,
    initialMoves: [],
    moves: [
      { color: 'B', vertex: [15, 3], actor: 'user', inZone: true },
      { color: 'W', vertex: [16, 5], actor: 'bot', inZone: true },
      { color: 'B', vertex: [14, 5], actor: 'user', inZone: true },
    ],
    summary: null,
  }
  repo.insertSession(rec)
  // Black's lead per position: the bot (White) loses 3 on turn 1, the user gives back 1 on turn 2.
  engine.lead = (q) => [0, 0, 3, 2][q.moves.length]
  return { engine, repo, reviews, published }
}

describe('ReviewService', () => {
  it('is not ready before the analyses exist and not found for unknown sessions', () => {
    const { reviews } = setup()
    expect(reviews.get('s1')).toEqual({ status: 'not_ready' })
    expect(reviews.get('nope')).toEqual({ status: 'not_found' })
  })

  it('analyses every position, reports progress and stores the results', async () => {
    const { reviews, repo, published } = setup()
    const review = await reviews.prepare('s1')
    expect(review.summary).toEqual({ userLoss: 1, botMistakes: 1, botMistakeLoss: 3, punished: 0, keptPoints: 2 })
    const progress = published.filter((m) => m.type === 'analysisProgress')
    expect(progress[0]).toEqual({ type: 'analysisProgress', sessionId: 's1', done: 0, total: 4 })
    expect(progress.at(-1)).toEqual({ type: 'analysisProgress', sessionId: 's1', done: 4, total: 4 })
    expect(published.at(-1)).toEqual({ type: 'reviewReady', sessionId: 's1' })
    expect(repo.getSession('s1')?.summary).toEqual(review.summary)
    expect(repo.listMissedPunishments('s1')).toEqual([
      { turn: 1, botMove: [16, 5], botLoss: 3, userMove: [14, 5], userLoss: 1, bestMove: [3, 15], bestPv: [[3, 15]] },
    ])
    const got = reviews.get('s1')
    expect(got.status).toBe('ok')
    if (got.status === 'ok') expect(got.review.moveReviews.map((m) => m.category)).toEqual(['exact', 'mistake', 'inaccuracy'])
  })

  it('reuses stored analyses', async () => {
    const { engine, reviews } = setup()
    await reviews.prepare('s1')
    const count = engine.queries.length
    await reviews.prepare('s1')
    expect(engine.queries).toHaveLength(count)
  })

  it('rejects unknown sessions', async () => {
    await expect(setup().reviews.prepare('nope')).rejects.toBeInstanceOf(SessionError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/review/service.test.ts`
Expected: FAIL — `Failed to resolve import "./service"`.

- [ ] **Step 3: Implement**

`packages/server/src/review/service.ts`:
```ts
import type { ReviewData, ServerMessage } from '@joseki-dojo/shared'
import type { AnalysisScheduler } from '../analysis/scheduler'
import type { AppConfig } from '../config'
import { SessionError } from '../session/session'
import type { SessionRecord, StoredAnalysis } from '../store/records'
import type { SessionRepo } from '../store/repo'
import { buildReview, missedPunishmentRows } from './compute'

export type ReviewResult = { status: 'ok'; review: ReviewData } | { status: 'not_found' } | { status: 'not_ready' }

export interface ReviewServiceDeps {
  repo: SessionRepo
  analysis: AnalysisScheduler
  config: AppConfig
  publish: (sessionId: string, msg: ServerMessage) => void
  now?: () => string
}

export class ReviewService {
  private readonly now: () => string

  constructor(private readonly d: ReviewServiceDeps) {
    this.now = d.now ?? (() => new Date().toISOString())
  }

  /** Spec 9.1: analyses positions that lack a full analysis, then stores the summary and missed punishments. */
  async prepare(sessionId: string): Promise<ReviewData> {
    const rec = this.d.repo.getSession(sessionId)
    if (!rec) throw new SessionError('Тренировка не найдена', 'session_not_found')
    const total = rec.moves.length + 1
    let done = 0
    const progress = (): void => this.d.publish(sessionId, { type: 'analysisProgress', sessionId, done, total })
    progress()
    const analyses = await Promise.all(
      Array.from({ length: total }, (_, t) =>
        this.d.analysis.position(rec, t).then((a) => {
          done++
          progress()
          return a
        }),
      ),
    )
    const review = this.assemble(rec, analyses)
    this.d.repo.saveSummary(sessionId, review.summary)
    this.d.repo.replaceMissedPunishments(sessionId, missedPunishmentRows(review), this.now())
    this.d.publish(sessionId, { type: 'reviewReady', sessionId })
    return review
  }

  get(sessionId: string): ReviewResult {
    const rec = this.d.repo.getSession(sessionId)
    if (!rec) return { status: 'not_found' }
    const analyses: StoredAnalysis[] = []
    for (let t = 0; t <= rec.moves.length; t++) {
      const row = this.d.repo.getAnalysis(sessionId, t, 'position')
      if (!row || row.visits < this.d.config.analysis.reviewVisits) return { status: 'not_ready' }
      analyses.push(row.analysis)
    }
    return { status: 'ok', review: this.assemble(rec, analyses) }
  }

  private assemble(rec: SessionRecord, analyses: StoredAnalysis[]): ReviewData {
    return buildReview({
      sessionId: rec.id,
      settings: rec.settings,
      initialMoves: rec.initialMoves,
      moves: rec.moves,
      analyses,
      thresholds: this.d.config.thresholds,
    })
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/server/src/review`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/server/src/review
```

---

### Task 14: HTTP and WebSocket API, server entry point

**Files:**
- Create: `packages/server/src/api/hub.ts`, `packages/server/src/api/messages.ts`, `packages/server/src/api/ws.ts`, `packages/server/src/api/http.ts`, `packages/server/src/app.ts`, `packages/server/src/main.ts`
- Test: `packages/server/src/api/messages.test.ts`, `packages/server/src/api/api.test.ts`

**Interfaces:**
- Consumes: all server services (Tasks 4–13).
- Produces:
  - `class Hub` — `watch(socket, sessionId)`, `drop(socket)`, `publish(sessionId, msg)`
  - `parseClientMessage(text): ClientMessage` (throws `SessionError('…', 'bad_request')`)
  - `handleSocket(socket, deps)`, `registerHttp(app, deps)`
  - `AppServices { config; db; engine; health; sessions; reviews; hub }`, `createServices(config, engine: KataGoEngine): AppServices`, `buildApp(services, webDist?: string | null): Promise<FastifyInstance>`
  - `main.ts`: reads `JOSEKI_CONFIG` (default `<repo>/config.local.json`), listens on `127.0.0.1:<port>`, serves `packages/web/dist` when it exists, starts the health check.
  - HTTP: `GET /api/health` → `HealthResponse`; `GET /api/sessions/:id/review` → `ReviewData` | 404 `{ error: 'session_not_found' }` | 409 `{ error: 'not_ready' }`; WebSocket at `/ws`.

- [ ] **Step 1: Write the failing tests**

`packages/server/src/api/messages.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseClientMessage } from './messages'

describe('parseClientMessage', () => {
  it('accepts well-formed messages', () => {
    expect(parseClientMessage('{"type":"playMove","sessionId":"s1","vertex":[15,3]}')).toEqual({ type: 'playMove', sessionId: 's1', vertex: [15, 3] })
    expect(parseClientMessage('{"type":"replayFrom","sessionId":"s1","turn":2}')).toEqual({ type: 'replayFrom', sessionId: 's1', turn: 2 })
    expect(parseClientMessage('{"type":"finish","sessionId":"s1"}')).toEqual({ type: 'finish', sessionId: 's1' })
  })

  it('rejects malformed messages', () => {
    const codeOf = (text: string): string | null => {
      try {
        parseClientMessage(text)
        return null
      } catch (err) {
        return (err as { code?: string }).code ?? 'no-code'
      }
    }
    for (const bad of ['nope', '{}', '{"type":"dance"}', '{"type":"finish"}', '{"type":"playMove","sessionId":"s1","vertex":[19,0]}', '{"type":"replayFrom","sessionId":"s1","turn":1.5}', '{"type":"startSession"}']) {
      expect(codeOf(bad)).toBe('bad_request')
    }
  })
})
```

`packages/server/src/api/api.test.ts`:
```ts
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import type { ClientMessage, ServerMessage } from '@joseki-dojo/shared'
import { fakeEngine, testConfig } from '../../test/helpers'
import { buildApp, createServices, type AppServices } from '../app'
import { HealthMonitor } from '../engine/health'

class Client {
  readonly messages: ServerMessage[] = []

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => this.messages.push(JSON.parse(String(data)) as ServerMessage))
  }

  static async connect(url: string): Promise<Client> {
    const ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    return new Client(ws)
  }

  send(msg: ClientMessage | object): void {
    this.ws.send(JSON.stringify(msg))
  }

  next(pred: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    return vi.waitFor(
      () => {
        const found = this.messages.find(pred)
        if (!found) throw new Error('message not received yet')
        return found
      },
      { timeout: 5000 },
    )
  }

  close(): void {
    this.ws.close()
  }
}

const START = { type: 'startSession', settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' } }

let services: AppServices
let app: FastifyInstance
let host: string
const clients: Client[] = []

const connect = async (): Promise<Client> => {
  const c = await Client.connect(`ws://${host}/ws`)
  clients.push(c)
  return c
}

const startSession = async (c: Client): Promise<string> => {
  c.send(START)
  const m = await c.next((x) => x.type === 'sessionState')
  if (m.type !== 'sessionState') throw new Error('unexpected message')
  return m.session.id
}

beforeEach(async () => {
  services = createServices(testConfig(), fakeEngine())
  await services.health.check()
  app = await buildApp(services)
  await app.listen({ port: 0, host: '127.0.0.1' })
  host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`
})

afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  await app.close()
  await services.engine.stop()
  services.db.close()
})

describe('API', () => {
  it('reports health', async () => {
    const res = await fetch(`http://${host}/api/health`)
    expect(await res.json()).toEqual({ state: 'ready', reason: null })
  })

  it('plays, proposes the end, finishes and serves the review', async () => {
    const c = await connect()
    const id = await startSession(c)
    c.send({ type: 'playMove', sessionId: id, vertex: [15, 3] })
    await c.next((m) => m.type === 'sessionState' && m.session.endProposed)
    c.send({ type: 'finish', sessionId: id })
    await c.next((m) => m.type === 'reviewReady')
    const res = await fetch(`http://${host}/api/sessions/${id}/review`)
    expect(res.status).toBe(200)
    const review = await res.json()
    expect(review.moves).toHaveLength(2)
    expect(review.summary).toEqual({ userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 })
  })

  it('reports protocol and game errors', async () => {
    const c = await connect()
    c.send({ type: 'dance' })
    await c.next((m) => m.type === 'error' && m.code === 'bad_request')
    const id = await startSession(c)
    c.send({ type: 'playMove', sessionId: id, vertex: [3, 15] })
    await c.next((m) => m.type === 'error' && m.code === 'outside_zone')
  })

  it('refuses to start while KataGo is not ready', async () => {
    services.health = new HealthMonitor(services.config, services.engine)
    const c = await connect()
    c.send(START)
    const m = await c.next((x) => x.type === 'error')
    expect(m).toMatchObject({ type: 'error', code: 'engine_error' })
  })

  it('returns 404 for an unknown review', async () => {
    const res = await fetch(`http://${host}/api/sessions/nope/review`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/api`
Expected: FAIL — `Failed to resolve import "./messages"` / `"../app"`.

- [ ] **Step 3: Implement**

`packages/server/src/api/hub.ts`:
```ts
import type { ServerMessage } from '@joseki-dojo/shared'
import type { WebSocket } from 'ws'

/** Remembers which session each socket watches; session messages go only to its watchers. */
export class Hub {
  private readonly watching = new Map<WebSocket, string>()

  watch(socket: WebSocket, sessionId: string): void {
    this.watching.set(socket, sessionId)
  }

  drop(socket: WebSocket): void {
    this.watching.delete(socket)
  }

  publish(sessionId: string, msg: ServerMessage): void {
    const data = JSON.stringify(msg)
    for (const [socket, id] of this.watching) {
      if (id === sessionId && socket.readyState === socket.OPEN) socket.send(data)
    }
  }
}
```

`packages/server/src/api/messages.ts`:
```ts
import { BOARD_SIZE, type ClientMessage, type Vertex } from '@joseki-dojo/shared'
import { SessionError } from '../session/session'

const bad = (): SessionError => new SessionError('Некорректное сообщение', 'bad_request')

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const isVertex = (v: unknown): v is Vertex =>
  Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0 && n < BOARD_SIZE)

/** Validates the shape of a client message; session settings are validated by SessionService. */
export function parseClientMessage(text: string): ClientMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw bad()
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') throw bad()
  const msg = parsed
  const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : null
  switch (msg.type) {
    case 'startSession':
      if (!isRecord(msg.settings)) throw bad()
      return msg as unknown as ClientMessage
    case 'playMove':
      if (!sessionId || !isVertex(msg.vertex)) throw bad()
      return { type: 'playMove', sessionId, vertex: msg.vertex }
    case 'replayFrom':
      if (!sessionId || !Number.isInteger(msg.turn)) throw bad()
      return { type: 'replayFrom', sessionId, turn: msg.turn as number }
    case 'tenuki':
    case 'finish':
    case 'continuePlaying':
    case 'resync':
      if (!sessionId) throw bad()
      return { type: msg.type as 'tenuki' | 'finish' | 'continuePlaying' | 'resync', sessionId }
    default:
      throw bad()
  }
}
```

`packages/server/src/api/ws.ts`:
```ts
import type { ServerMessage } from '@joseki-dojo/shared'
import type { WebSocket } from 'ws'
import type { AppServices } from '../app'
import { EngineError } from '../engine/engine'
import { toErrorMessage } from '../errors'
import { parseClientMessage } from './messages'

type SocketDeps = Pick<AppServices, 'sessions' | 'hub' | 'health'>

export function handleSocket(socket: WebSocket, deps: SocketDeps): void {
  const send = (msg: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
  }

  const handle = async (text: string): Promise<void> => {
    const msg = parseClientMessage(text)
    switch (msg.type) {
      case 'startSession': {
        requireReady(deps)
        const view = deps.sessions.start(msg.settings)
        deps.hub.watch(socket, view.id)
        send({ type: 'sessionState', session: view })
        return
      }
      case 'replayFrom': {
        requireReady(deps)
        const view = deps.sessions.replayFrom(msg.sessionId, msg.turn)
        deps.hub.watch(socket, view.id)
        send({ type: 'sessionState', session: view })
        return
      }
      case 'resync': {
        if (deps.health.get().state === 'failed') await deps.health.recover()
        deps.hub.watch(socket, msg.sessionId)
        send({ type: 'sessionState', session: deps.sessions.resync(msg.sessionId) })
        return
      }
      case 'playMove':
        deps.sessions.playUserMove(msg.sessionId, msg.vertex)
        return
      case 'tenuki':
        await deps.sessions.tenuki(msg.sessionId)
        return
      case 'finish':
        deps.sessions.finish(msg.sessionId)
        return
      case 'continuePlaying':
        deps.sessions.continuePlaying(msg.sessionId)
        return
    }
  }

  socket.on('message', (data) => {
    handle(String(data)).catch((err: unknown) => send(toErrorMessage(err)))
  })
  socket.on('close', () => deps.hub.drop(socket))
}

function requireReady(deps: SocketDeps): void {
  const h = deps.health.get()
  if (h.state !== 'ready') throw new EngineError(`KataGo не готов: ${h.reason ?? h.state}`, 'engine_failed')
}
```

`packages/server/src/api/http.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { AppServices } from '../app'

export function registerHttp(app: FastifyInstance, deps: Pick<AppServices, 'health' | 'reviews'>): void {
  app.get('/api/health', async () => deps.health.get())

  app.get<{ Params: { id: string } }>('/api/sessions/:id/review', async (req, reply) => {
    const r = deps.reviews.get(req.params.id)
    if (r.status === 'not_found') return reply.code(404).send({ error: 'session_not_found' })
    if (r.status === 'not_ready') return reply.code(409).send({ error: 'not_ready' })
    return r.review
  })
}
```

`packages/server/src/app.ts`:
```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import type { ServerMessage } from '@joseki-dojo/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { AnalysisScheduler } from './analysis/scheduler'
import { registerHttp } from './api/http'
import { Hub } from './api/hub'
import { handleSocket } from './api/ws'
import { HumanBot } from './bot/bot'
import type { AppConfig } from './config'
import type { KataGoEngine } from './engine/engine'
import { HealthMonitor } from './engine/health'
import { toErrorMessage } from './errors'
import { ReviewService } from './review/service'
import { SessionService } from './session/service'
import { openDb, type Db } from './store/db'
import { SessionRepo } from './store/repo'

export interface AppServices {
  config: AppConfig
  db: Db
  engine: KataGoEngine
  health: HealthMonitor
  sessions: SessionService
  reviews: ReviewService
  hub: Hub
}

export function createServices(config: AppConfig, engine: KataGoEngine): AppServices {
  const db = openDb(join(config.dataDir, 'joseki-dojo.sqlite'))
  const repo = new SessionRepo(db)
  const hub = new Hub()
  const publish = (sessionId: string, msg: ServerMessage): void => hub.publish(sessionId, msg)
  const analysis = new AnalysisScheduler(engine, repo, config.analysis)
  const reviews = new ReviewService({ repo, analysis, config, publish })
  const sessions = new SessionService({
    repo,
    analysis,
    engine,
    config,
    publish,
    bot: new HumanBot(engine),
    onFinished: (id) => {
      reviews.prepare(id).catch((err: unknown) => publish(id, toErrorMessage(err)))
    },
  })
  return { config, db, engine, health: new HealthMonitor(config, engine), sessions, reviews, hub }
}

export async function buildApp(services: AppServices, webDist: string | null = null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(websocket)
  app.get('/ws', { websocket: true }, (socket) => handleSocket(socket, services))
  registerHttp(app, services)
  if (webDist && existsSync(webDist)) await app.register(fastifyStatic, { root: webDist })
  return app
}
```

`packages/server/src/main.ts`:
```ts
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp, createServices } from './app'
import { loadConfig } from './config'
import { engineCommand } from './engine/command'
import { KataGoEngine } from './engine/engine'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const configFile = process.env.JOSEKI_CONFIG ? resolve(process.env.JOSEKI_CONFIG) : join(repoRoot, 'config.local.json')
const config = loadConfig(configFile)
const engine = new KataGoEngine(engineCommand(config), (line) => console.log(`[katago] ${line}`))
const services = createServices(config, engine)
const app = await buildApp(services, join(repoRoot, 'packages', 'web', 'dist'))
await app.listen({ port: config.port, host: '127.0.0.1' })
console.log(`Joseki Dojo: http://127.0.0.1:${config.port}`)
void services.health.check().then((h) => {
  console.log(h.state === 'ready' ? 'KataGo готов' : `KataGo не готов: ${h.reason}`)
})

const shutdown = async (): Promise<void> => {
  await app.close()
  await engine.stop()
  services.db.close()
  process.exit(0)
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run packages/server`
Expected: PASS (all server tests).
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Smoke-run the server against the fake engine**

Write a throwaway config outside the repo (Bash):
```bash
node -e "require('fs').writeFileSync(require('os').tmpdir()+'/joseki-smoke.json', JSON.stringify({port:5181,dataDir:require('os').tmpdir()+'/joseki-smoke-data',katago:{commandOverride:['node', require('path').resolve('packages/server/test/fake-katago.mjs')]}}))"
```
Start the server in the background (a background shell, not the foreground terminal):
```bash
JOSEKI_CONFIG="$(node -p "require('os').tmpdir()")/joseki-smoke.json" npx tsx packages/server/src/main.ts
```
Expected output: `Joseki Dojo: http://127.0.0.1:5181`, then `KataGo готов`. Check:
```bash
curl -s http://127.0.0.1:5181/api/health
```
Expected: `{"state":"ready","reason":null}`. Then stop the background server.

- [ ] **Step 6: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/server/src
```

---

### Task 14a: KataGo lock file and engine settings (server)

**Files:**
- Create: `katago.lock.json`, `packages/shared/src/settings.ts`, `packages/server/src/engine/lock.ts`, `packages/server/src/settings/service.ts`, `packages/server/src/api/settings-routes.ts`
- Modify: `packages/shared/src/index.ts` (append one export), `packages/server/src/engine/engine.ts` (make `cmd` mutable, add `restartWith`), `packages/server/src/app.ts` (whole file), `packages/server/src/main.ts` (whole file), `packages/server/src/api/api.test.ts` (append a describe block)
- Test: `packages/server/src/engine/lock.test.ts`, `packages/server/src/engine/restart.test.ts`, `packages/server/src/settings/service.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `KataGoSettings`, `MAIN_MODEL_FILE`, `HUMAN_MODEL_FILE` (Task 4); `KataGoEngine`, `EngineCommand`, `engineCommand` (Task 5); `checkEngine`, `missingFiles`, `HealthMonitor` (Task 6); everything wired in Task 14.
- Produces:
  - shared: `EngineSettings`, `AnalysisSettings`, `SettingsView { katago; analysis; models; lockedVersion; runningVersion; versionWarning }`, `SettingsUpdate { katago; analysis }`, `SettingsResponse = { ok: true; settings } | { ok: false; reason }`
  - lock: `LockedBuild { id; platform; kind: 'cpu' | 'gpu'; label; url; sha256 }`, `LockedFile { file; url; sha256; size }`, `KataGoLock`, `LOCK_FILE`, `loadLock(file?)`, `buildsFor(lock, platform)`, `versionWarning(lock, running)`
  - engine: `KataGoEngine.restartWith(cmd): Promise<void>` — switches the process to another command and resends pending queries; clears a failure
  - `SettingsServiceDeps { config; configFile; modelsDir; engine; health; lock; commandFor? }`, `class SettingsService` with `view(): Promise<SettingsView>` and `apply(update): Promise<SettingsResponse>`
  - `registerSettingsRoutes(app, settings)`: `GET /api/settings` → `SettingsView`; `PUT /api/settings` → 200 `{ ok: true, settings }` or 400 `{ ok: false, reason }`
  - `ServicePaths { configFile; modelsDir }`, `createServices(config, engine, paths?)` (default paths inside `config.dataDir`, used by tests), `AppServices.settings`

- [ ] **Step 1: Write the lock file**

`katago.lock.json` (SHA-256 of the builds come from the GitHub release metadata; the network sums were computed from the downloaded files):
```json
{
  "katago": {
    "version": "1.18.1",
    "builds": [
      {
        "id": "eigenavx2",
        "platform": "win32",
        "kind": "cpu",
        "label": "CPU (AVX2) — работает на любом компьютере, медленнее всего",
        "url": "https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-eigenavx2-windows-x64.zip",
        "sha256": "0d62ffa41ee04dd89dd1b80fe45e306c837231cb1e2dccb4f5780d0ca7c313db"
      },
      {
        "id": "opencl",
        "platform": "win32",
        "kind": "gpu",
        "label": "OpenCL — видеокарты AMD, NVIDIA и Intel",
        "url": "https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-opencl-windows-x64.zip",
        "sha256": "1710db1903ab921aa6837a9599c8474f8a59f057650217c5d9bc125ee393a9ff"
      },
      {
        "id": "cuda",
        "platform": "win32",
        "kind": "gpu",
        "label": "CUDA 12.8 + cuDNN 9.8 — NVIDIA (CUDA и cuDNN должны быть установлены)",
        "url": "https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-cuda12.8-cudnn9.8.0-windows-x64.zip",
        "sha256": "8caabc5675950f52d285a686c19727f7a56a982313a7f055ade060ba78df552e"
      },
      {
        "id": "eigenavx2",
        "platform": "linux",
        "kind": "cpu",
        "label": "CPU (AVX2) — работает на любом компьютере, медленнее всего",
        "url": "https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-eigenavx2-linux-x64.zip",
        "sha256": "33e79780dbe3bf6ee859e16f64952cdfc90f7210c8f71ad978ffcba85ad20d79"
      },
      {
        "id": "opencl",
        "platform": "linux",
        "kind": "gpu",
        "label": "OpenCL — видеокарты AMD, NVIDIA и Intel",
        "url": "https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-opencl-linux-x64.zip",
        "sha256": "81ecea81526adb412a392ec728dbdf9627e754df7cf1a7a3dbb8ef220182184a"
      },
      {
        "id": "cuda",
        "platform": "linux",
        "kind": "gpu",
        "label": "CUDA 12.8 + cuDNN 9.8 — NVIDIA (CUDA и cuDNN должны быть установлены)",
        "url": "https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-cuda12.8-cudnn9.8.0-linux-x64.zip",
        "sha256": "f84222594101abbde8a0df885c54fd8fcfe90a3c1a9ab140e0354fc28cbfa61c"
      }
    ]
  },
  "models": {
    "main": {
      "file": "kata1-b18c384nbt-s9996604416-d4316597426.bin.gz",
      "url": "https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz",
      "sha256": "9d7a6afed8ff5b74894727e156f04f0cd36060a24824892008fbb6e0cba51f1d",
      "size": 97898094
    },
    "human": {
      "file": "b18c384nbt-humanv0.bin.gz",
      "url": "https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.bin.gz",
      "sha256": "637746e44f0efe00ad1245a50aa9bbf0716efe364c43965ead97bd6835d84ab5",
      "size": 99066230
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`packages/server/src/engine/lock.test.ts`:
```ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../test/helpers'
import { HUMAN_MODEL_FILE, MAIN_MODEL_FILE } from '../config'
import { buildsFor, loadLock, versionWarning } from './lock'

describe('katago.lock.json', () => {
  it('pins one KataGo version with builds for Windows and Linux', () => {
    const lock = loadLock()
    expect(lock.katago.version).toBe('1.18.1')
    expect(buildsFor(lock, 'win32').map((b) => b.id)).toEqual(['eigenavx2', 'opencl', 'cuda'])
    expect(buildsFor(lock, 'linux').map((b) => b.id)).toEqual(['eigenavx2', 'opencl', 'cuda'])
    expect(buildsFor(lock, 'darwin')).toEqual([])
    for (const b of lock.katago.builds) expect(b.url).toContain(`/v${lock.katago.version}/katago-v${lock.katago.version}-`)
  })

  it('names the same networks as the config defaults', () => {
    const lock = loadLock()
    expect(lock.models.main.file).toBe(MAIN_MODEL_FILE)
    expect(lock.models.human.file).toBe(HUMAN_MODEL_FILE)
  })

  it('rejects a malformed lock', () => {
    const lock = loadLock()
    const file = join(tempDir(), 'lock.json')
    writeFileSync(file, JSON.stringify({ ...lock, katago: { ...lock.katago, builds: [{ ...lock.katago.builds[0], sha256: 'abc' }] } }))
    expect(() => loadLock(file)).toThrow(/sha256/)
  })

  it('warns only about a different running version', () => {
    const lock = loadLock()
    expect(versionWarning(lock, null)).toBeNull()
    expect(versionWarning(lock, '1.18.1')).toBeNull()
    expect(versionWarning(lock, '1.17.2')).toBe('Запущена KataGo 1.17.2, а проверена 1.18.1. Работать будет, но эта версия не проверялась.')
  })
})
```

`packages/server/src/engine/restart.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest'
import { FAKE_KATAGO, fakeEngine } from '../../test/helpers'
import type { KataGoEngine } from './engine'
import { baseQuery } from './query'

const engines: KataGoEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.stop()))
})

describe('KataGoEngine.restartWith', () => {
  it('switches to another command and keeps answering', async () => {
    const e = fakeEngine()
    engines.push(e)
    e.start()
    expect(await e.version()).toBe('1.18.1')
    await e.restartWith({ command: process.execPath, args: [FAKE_KATAGO], env: { FAKE_KATAGO_VERSION: '1.18.2' } })
    expect(await e.version()).toBe('1.18.2')
    expect(e.failed).toBe(false)
  })

  it('clears a failure', async () => {
    const e = fakeEngine({ FAKE_KATAGO_ALWAYS_CRASH: '1' })
    engines.push(e)
    e.start()
    await expect(e.analyze(baseQuery([]))).rejects.toMatchObject({ code: 'engine_failed' })
    await e.restartWith({ command: process.execPath, args: [FAKE_KATAGO] })
    expect(e.failed).toBe(false)
    expect((await e.analyze(baseQuery([]))).moveInfos[0].move).toBe('D4')
  })
})
```

`packages/server/src/settings/service.test.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SettingsUpdate } from '@joseki-dojo/shared'
import { FAKE_KATAGO, fakeEngine, tempDir, testConfig } from '../../test/helpers'
import type { AppConfig } from '../config'
import type { EngineCommand, KataGoEngine } from '../engine/engine'
import { HealthMonitor } from '../engine/health'
import { loadLock } from '../engine/lock'
import { SettingsService } from './service'

/** A fake installation: real (empty) files on disk; the main network's name selects the fake engine's behaviour. */
function install() {
  const dir = tempDir()
  const models = join(dir, 'models')
  mkdirSync(models)
  const file = (name: string): string => {
    const p = join(dir, name)
    writeFileSync(p, '')
    return p
  }
  const model = (name: string): string => {
    const p = join(models, name)
    writeFileSync(p, '')
    return p
  }
  return {
    dir,
    models,
    katago: file('katago.exe'),
    cfg: file('analysis.cfg'),
    main: model('main.bin.gz'),
    next: model('next.bin.gz'),
    broken: model('broken.bin.gz'),
    human: model('human.bin.gz'),
  }
}

const commandFor = (c: AppConfig): EngineCommand => ({
  command: process.execPath,
  args: [FAKE_KATAGO],
  env: c.katago.mainModel.endsWith('next.bin.gz')
    ? { FAKE_KATAGO_VERSION: '1.18.2' }
    : c.katago.mainModel.endsWith('broken.bin.gz')
      ? { FAKE_KATAGO_NO_HUMAN: '1' }
      : {},
})

const engines: KataGoEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.stop()))
})

async function setup() {
  const inst = install()
  const config = testConfig()
  const engine = fakeEngine()
  engines.push(engine)
  const health = new HealthMonitor(config, engine)
  await health.check()
  const configFile = join(inst.dir, 'config.local.json')
  const settings = new SettingsService({ config, configFile, modelsDir: inst.models, engine, health, lock: loadLock(), commandFor })
  const update = (mainModel: string, analysis: Partial<SettingsUpdate['analysis']> = {}): SettingsUpdate => ({
    katago: { path: inst.katago, analysisConfig: inst.cfg, mainModel, humanModel: inst.human },
    analysis: { reviewVisits: 40, endVisits: 20, ...analysis },
  })
  return { inst, config, engine, health, configFile, settings, update }
}

describe('SettingsService', () => {
  it('shows the paths, the networks found and the running version', async () => {
    const { settings, inst } = await setup()
    const v = await settings.view()
    expect(v.lockedVersion).toBe('1.18.1')
    expect(v.runningVersion).toBe('1.18.1')
    expect(v.versionWarning).toBeNull()
    expect(v.models).toEqual([inst.broken, inst.human, inst.main, inst.next].sort())
    expect(v.analysis).toEqual({ reviewVisits: 10, endVisits: 5 })
  })

  it('rejects invalid input without touching the engine', async () => {
    const { settings, update, inst } = await setup()
    expect(await settings.apply(update(inst.main, { reviewVisits: 0 }))).toEqual({ ok: false, reason: 'Число визитов должно быть целым от 1 до 100000' })
    const missing = join(inst.models, 'missing.bin.gz')
    expect(await settings.apply(update(missing))).toEqual({ ok: false, reason: `Нет основной сети KataGo: ${missing}` })
  })

  it('switches KataGo, saves the config and warns about an unverified version', async () => {
    const { settings, update, inst, config, configFile } = await setup()
    const r = await settings.apply(update(inst.next))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.settings.runningVersion).toBe('1.18.2')
    expect(r.settings.versionWarning).toContain('1.18.2')
    expect(config.katago.mainModel).toBe(inst.next)
    expect(config.katago.commandOverride).toBeUndefined()
    expect(config.analysis).toEqual({ reviewVisits: 40, endVisits: 20 })
    const saved = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(saved.katago.mainModel).toBe(inst.next)
    expect(saved.analysis).toEqual({ reviewVisits: 40, endVisits: 20 })
  })

  it('restores the previous engine when the new one fails its checks', async () => {
    const { settings, update, inst, config, configFile, health, engine } = await setup()
    const before = config.katago.mainModel
    const r = await settings.apply(update(inst.broken))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('human')
    expect(config.katago.mainModel).toBe(before)
    expect(existsSync(configFile)).toBe(false)
    expect(health.get().state).toBe('ready')
    expect(await engine.version()).toBe('1.18.1')
  })
})
```

Append to `packages/server/src/api/api.test.ts`:
```ts
describe('settings API', () => {
  it('shows the settings and refuses paths that do not exist', async () => {
    const view = await (await fetch(`http://${host}/api/settings`)).json()
    expect(view.lockedVersion).toBe('1.18.1')
    expect(view.runningVersion).toBe('1.18.1')
    const res = await fetch(`http://${host}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ katago: { ...view.katago, mainModel: '/nope/main.bin.gz' }, analysis: view.analysis }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(typeof body.reason).toBe('string')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/engine/lock.test.ts packages/server/src/engine/restart.test.ts packages/server/src/settings packages/server/src/api/api.test.ts`
Expected: FAIL — `Failed to resolve import "./lock"`, `restartWith is not a function`, `Failed to resolve import "./service"`, and 404 from `/api/settings`.

- [ ] **Step 4: Implement**

`packages/shared/src/settings.ts`:
```ts
export interface EngineSettings {
  path: string
  analysisConfig: string
  mainModel: string
  humanModel: string
}

export interface AnalysisSettings {
  reviewVisits: number
  endVisits: number
}

export interface SettingsView {
  katago: EngineSettings
  analysis: AnalysisSettings
  /** Network files found in engines/models (absolute paths). */
  models: string[]
  lockedVersion: string
  runningVersion: string | null
  versionWarning: string | null
}

export interface SettingsUpdate {
  katago: EngineSettings
  analysis: AnalysisSettings
}

export type SettingsResponse = { ok: true; settings: SettingsView } | { ok: false; reason: string }
```

Append to `packages/shared/src/index.ts`:
```ts
export * from './settings'
```

In `packages/server/src/engine/engine.ts`, change the constructor parameter `private readonly cmd: EngineCommand,` to `private cmd: EngineCommand,` and add this method right after `reset()`:
```ts
  /**
   * Switches to another command (new paths). The old process is stopped without counting as a crash;
   * pending queries are resent to the new process. Clears a permanent failure.
   */
  async restartWith(cmd: EngineCommand): Promise<void> {
    this.cmd = cmd
    this.failedReason = null
    this.crashes = 0
    const old = this.proc
    this.proc = null
    this.stopping = true
    if (old && old.pid !== undefined && old.exitCode === null && old.signalCode === null) {
      await new Promise<void>((done) => {
        old.once('exit', () => done())
        old.stdin.end()
        setTimeout(() => old.kill(), 2000).unref()
      })
    }
    this.start()
  }
```

`packages/server/src/engine/lock.ts`:
```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface LockedBuild {
  id: string
  platform: 'win32' | 'linux'
  kind: 'cpu' | 'gpu'
  label: string
  url: string
  sha256: string
}

export interface LockedFile {
  file: string
  url: string
  sha256: string
  size: number
}

export interface KataGoLock {
  katago: { version: string; builds: LockedBuild[] }
  models: { main: LockedFile; human: LockedFile }
}

export const LOCK_FILE = fileURLToPath(new URL('../../../../katago.lock.json', import.meta.url))

const SHA256 = /^[0-9a-f]{64}$/

export function loadLock(file: string = LOCK_FILE): KataGoLock {
  const lock = JSON.parse(readFileSync(file, 'utf8')) as KataGoLock
  if (!/^\d+\.\d+\.\d+$/.test(lock.katago?.version ?? '')) throw new Error(`${file}: katago.version must look like 1.18.1`)
  if (!lock.katago.builds?.length) throw new Error(`${file}: no KataGo builds`)
  if (!lock.models?.main || !lock.models?.human) throw new Error(`${file}: models.main and models.human are required`)
  for (const entry of [...lock.katago.builds, lock.models.main, lock.models.human]) {
    if (!entry.url?.startsWith('https://')) throw new Error(`${file}: url must be https: ${entry.url}`)
    if (!SHA256.test(entry.sha256 ?? '')) throw new Error(`${file}: bad sha256 for ${entry.url}`)
  }
  return lock
}

export const buildsFor = (lock: KataGoLock, platform: string): LockedBuild[] =>
  lock.katago.builds.filter((b) => b.platform === platform)

export function versionWarning(lock: KataGoLock, running: string | null): string | null {
  if (!running || running === lock.katago.version) return null
  return `Запущена KataGo ${running}, а проверена ${lock.katago.version}. Работать будет, но эта версия не проверялась.`
}
```

`packages/server/src/settings/service.ts`:
```ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AnalysisSettings, SettingsResponse, SettingsUpdate, SettingsView } from '@joseki-dojo/shared'
import type { AppConfig, KataGoSettings } from '../config'
import { engineCommand } from '../engine/command'
import type { EngineCommand, KataGoEngine } from '../engine/engine'
import { checkEngine, missingFiles, type HealthMonitor } from '../engine/health'
import { versionWarning, type KataGoLock } from '../engine/lock'

export interface SettingsServiceDeps {
  config: AppConfig
  configFile: string
  modelsDir: string
  engine: KataGoEngine
  health: HealthMonitor
  lock: KataGoLock
  /** Tests substitute the fake KataGo; production builds the real command line. */
  commandFor?: (config: AppConfig) => EngineCommand
}

const MODEL_FILE = /\.(bin|txt)\.gz$|\.bin$/

function validateUpdate(u: SettingsUpdate): string | null {
  const paths = u?.katago ? [u.katago.path, u.katago.analysisConfig, u.katago.mainModel, u.katago.humanModel] : []
  if (paths.length !== 4 || paths.some((p) => typeof p !== 'string' || p.trim() === '')) return 'Укажите все пути'
  const visits = [u.analysis?.reviewVisits, u.analysis?.endVisits]
  if (visits.some((v) => !Number.isInteger(v) || (v as number) < 1 || (v as number) > 100_000)) {
    return 'Число визитов должно быть целым от 1 до 100000'
  }
  return null
}

/** Spec 7a: shows and changes the engine paths; a change is kept only if the restarted KataGo passes its checks. */
export class SettingsService {
  private applying = false
  private readonly commandFor: (config: AppConfig) => EngineCommand

  constructor(private readonly d: SettingsServiceDeps) {
    this.commandFor = d.commandFor ?? engineCommand
  }

  async view(): Promise<SettingsView> {
    const running = this.d.health.get().state === 'ready' ? await this.d.engine.version().catch(() => null) : null
    const { path, analysisConfig, mainModel, humanModel } = this.d.config.katago
    return {
      katago: { path, analysisConfig, mainModel, humanModel },
      analysis: { ...this.d.config.analysis },
      models: this.listModels(),
      lockedVersion: this.d.lock.katago.version,
      runningVersion: running,
      versionWarning: versionWarning(this.d.lock, running),
    }
  }

  async apply(update: SettingsUpdate): Promise<SettingsResponse> {
    if (this.applying) return { ok: false, reason: 'Настройки уже применяются' }
    const invalid = validateUpdate(update)
    if (invalid) return { ok: false, reason: invalid }
    this.applying = true
    try {
      const katago: KataGoSettings = {
        path: resolve(update.katago.path),
        analysisConfig: resolve(update.katago.analysisConfig),
        mainModel: resolve(update.katago.mainModel),
        humanModel: resolve(update.katago.humanModel),
      }
      const analysis: AnalysisSettings = { reviewVisits: update.analysis.reviewVisits, endVisits: update.analysis.endVisits }
      const candidate: AppConfig = { ...this.d.config, katago, analysis }
      const missing = missingFiles(candidate)
      if (missing) return { ok: false, reason: missing }

      const previous = this.commandFor(this.d.config)
      await this.d.engine.restartWith(this.commandFor(candidate))
      const health = await checkEngine(candidate, this.d.engine)
      if (health.state !== 'ready') {
        await this.d.engine.restartWith(previous)
        await this.d.health.check()
        return { ok: false, reason: health.reason ?? 'KataGo не запустился' }
      }

      this.d.config.katago = katago // a test-only commandOverride is dropped here on purpose
      Object.assign(this.d.config.analysis, analysis) // the scheduler holds this same object
      this.persist(katago, analysis)
      await this.d.health.check()
      return { ok: true, settings: await this.view() }
    } finally {
      this.applying = false
    }
  }

  private listModels(): string[] {
    if (!existsSync(this.d.modelsDir)) return []
    return readdirSync(this.d.modelsDir)
      .filter((f) => MODEL_FILE.test(f))
      .map((f) => join(this.d.modelsDir, f))
      .sort()
  }

  private persist(katago: KataGoSettings, analysis: AnalysisSettings): void {
    const raw = (existsSync(this.d.configFile) ? JSON.parse(readFileSync(this.d.configFile, 'utf8')) : {}) as Record<string, unknown>
    const { commandOverride: _dropped, ...oldKatago } = (raw.katago ?? {}) as Record<string, unknown>
    raw.katago = { ...oldKatago, ...katago }
    raw.analysis = { ...((raw.analysis ?? {}) as Record<string, unknown>), ...analysis }
    writeFileSync(this.d.configFile, `${JSON.stringify(raw, null, 2)}\n`)
  }
}
```

`packages/server/src/api/settings-routes.ts`:
```ts
import type { SettingsUpdate } from '@joseki-dojo/shared'
import type { FastifyInstance } from 'fastify'
import type { SettingsService } from '../settings/service'

export function registerSettingsRoutes(app: FastifyInstance, settings: SettingsService): void {
  app.get('/api/settings', async () => settings.view())

  app.put<{ Body: SettingsUpdate }>('/api/settings', async (req, reply) => {
    const r = await settings.apply(req.body)
    return r.ok ? r : reply.code(400).send(r)
  })
}
```

Replace `packages/server/src/app.ts` with:
```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import type { ServerMessage } from '@joseki-dojo/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { AnalysisScheduler } from './analysis/scheduler'
import { registerHttp } from './api/http'
import { Hub } from './api/hub'
import { registerSettingsRoutes } from './api/settings-routes'
import { handleSocket } from './api/ws'
import { HumanBot } from './bot/bot'
import type { AppConfig } from './config'
import type { KataGoEngine } from './engine/engine'
import { HealthMonitor } from './engine/health'
import { loadLock } from './engine/lock'
import { toErrorMessage } from './errors'
import { ReviewService } from './review/service'
import { SessionService } from './session/service'
import { SettingsService } from './settings/service'
import { openDb, type Db } from './store/db'
import { SessionRepo } from './store/repo'

export interface AppServices {
  config: AppConfig
  db: Db
  engine: KataGoEngine
  health: HealthMonitor
  sessions: SessionService
  reviews: ReviewService
  settings: SettingsService
  hub: Hub
}

export interface ServicePaths {
  /** Where the settings screen saves changes (config.local.json in production). */
  configFile: string
  /** Folder listed as "available networks" on the settings screen. */
  modelsDir: string
}

export function createServices(
  config: AppConfig,
  engine: KataGoEngine,
  paths: ServicePaths = { configFile: join(config.dataDir, 'config.local.json'), modelsDir: join(config.dataDir, 'models') },
): AppServices {
  const db = openDb(join(config.dataDir, 'joseki-dojo.sqlite'))
  const repo = new SessionRepo(db)
  const hub = new Hub()
  const publish = (sessionId: string, msg: ServerMessage): void => hub.publish(sessionId, msg)
  const analysis = new AnalysisScheduler(engine, repo, config.analysis)
  const reviews = new ReviewService({ repo, analysis, config, publish })
  const sessions = new SessionService({
    repo,
    analysis,
    engine,
    config,
    publish,
    bot: new HumanBot(engine),
    onFinished: (id) => {
      reviews.prepare(id).catch((err: unknown) => publish(id, toErrorMessage(err)))
    },
  })
  const health = new HealthMonitor(config, engine)
  const settings = new SettingsService({ config, engine, health, lock: loadLock(), ...paths })
  return { config, db, engine, health, sessions, reviews, settings, hub }
}

export async function buildApp(services: AppServices, webDist: string | null = null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(websocket)
  app.get('/ws', { websocket: true }, (socket) => handleSocket(socket, services))
  registerHttp(app, services)
  registerSettingsRoutes(app, services.settings)
  if (webDist && existsSync(webDist)) await app.register(fastifyStatic, { root: webDist })
  return app
}
```

Replace `packages/server/src/main.ts` with:
```ts
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp, createServices } from './app'
import { loadConfig } from './config'
import { engineCommand } from './engine/command'
import { KataGoEngine } from './engine/engine'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const configFile = process.env.JOSEKI_CONFIG ? resolve(process.env.JOSEKI_CONFIG) : join(repoRoot, 'config.local.json')
const config = loadConfig(configFile)
const engine = new KataGoEngine(engineCommand(config), (line) => console.log(`[katago] ${line}`))
const services = createServices(config, engine, { configFile, modelsDir: join(repoRoot, 'engines', 'models') })
const app = await buildApp(services, join(repoRoot, 'packages', 'web', 'dist'))
await app.listen({ port: config.port, host: '127.0.0.1' })
console.log(`Joseki Dojo: http://127.0.0.1:${config.port}`)
void services.health.check().then((h) => {
  console.log(h.state === 'ready' ? 'KataGo готов' : `KataGo не готов: ${h.reason}`)
})

const shutdown = async (): Promise<void> => {
  await app.close()
  await engine.stop()
  services.db.close()
  process.exit(0)
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run packages`
Expected: PASS (all shared and server tests).
Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Milestone commit**

```bash
git add katago.lock.json packages/shared packages/server
git commit -m "feat(server): add session and review services, HTTP/WebSocket API, KataGo lock and engine settings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Web app shell, start and engine screens

**Files:**
- Create: `packages/web/index.html`, `packages/web/vite.config.ts`, `packages/web/src/vite-env.d.ts`, `packages/web/src/main.tsx`, `packages/web/src/styles.css`, `packages/web/src/format.ts`, `packages/web/src/api.ts`, `packages/web/src/App.tsx`, `packages/web/src/components/ErrorBanner.tsx`, `packages/web/src/screens/EngineScreen.tsx`, `packages/web/src/screens/StartScreen.tsx`
- Test: `packages/web/src/format.test.ts`

**Interfaces:**
- Consumes: shared types and protocol (Task 2); HTTP and WebSocket API (Task 14).
- Produces:
  - format: `formatPoints(n)`, `plural(n, one, few, many)`, `moveLabel(v)`, `rankLabel(rank)`, `colorLabel(c)`, `CATEGORY_LABEL`, `CORNER_LABEL`, `ACTOR_LABEL`
  - api: `fetchHealth(): Promise<HealthResponse>`, `fetchReview(id): Promise<ReviewData | null>` (null on 409), `class DojoSocket(onMessage, onStatus)` with `send(msg)` and writable `sessionId` (re-sent as `resync` after reconnect)
  - `ErrorBanner({ message, onRetry? })`, `EngineScreen({ health, onRetry })`, `StartScreen({ onStart })`, `App()`
  - CSS tokens used by later tasks: `--surface`, `--surface-2`, `--text`, `--text-2`, `--border`, `--accent`, `--good`, `--warning`, `--serious`, `--critical`; classes `.game`, `.review`, `.panel`, `.proposal`, `.summary`, `.candidates`, `.lossbar`, `.swatch`, `.row`, `.status`, `.meta`, `.hint`

- [ ] **Step 1: Write the failing test**

`packages/web/src/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { formatPoints, moveLabel, plural, rankLabel } from './format'

describe('format', () => {
  it('formats points with a decimal comma', () => {
    expect(formatPoints(7.5)).toBe('7,5')
    expect(formatPoints(2)).toBe('2,0')
    expect(formatPoints(0.04)).toBe('0,0')
  })

  it('picks Russian plural forms', () => {
    expect(plural(1, 'раз', 'раза', 'раз')).toBe('раз')
    expect(plural(3, 'раз', 'раза', 'раз')).toBe('раза')
    expect(plural(5, 'раз', 'раза', 'раз')).toBe('раз')
    expect(plural(11, 'раз', 'раза', 'раз')).toBe('раз')
    expect(plural(22, 'раз', 'раза', 'раз')).toBe('раза')
  })

  it('labels moves and ranks', () => {
    expect(moveLabel([15, 3])).toBe('Q16')
    expect(moveLabel('pass')).toBe('пас')
    expect(rankLabel('7k')).toBe('7 кю')
    expect(rankLabel('1d')).toBe('1 дан')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web`
Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 3: Write the build setup**

`packages/web/vite.config.ts`:
```ts
import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

// The server listens on 127.0.0.1:5179 by default; in development Vite proxies API calls to it.
const SERVER = 'http://127.0.0.1:5179'

export default defineConfig({
  plugins: [preact()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': SERVER, '/ws': { target: SERVER, ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
```

`packages/web/index.html`:
```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Joseki Dojo</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

`packages/web/src/main.tsx`:
```tsx
import { render } from 'preact'
import '@sabaki/shudan/css/goban.css'
import './styles.css'
import { App } from './App'

render(<App />, document.getElementById('app')!)
```

`packages/web/src/styles.css`:
```css
:root {
  color-scheme: light;
  --surface: #fcfcfb;
  --surface-2: #f0efec;
  --text: #0b0b0b;
  --text-2: #52514e;
  --border: #d9d8d3;
  --accent: #2a78d6;
  --accent-text: #ffffff;
  /* Fixed status palette (data-viz reference): loss categories exact / inaccuracy / mistake / blunder. */
  --good: #0ca30c;
  --warning: #fab219;
  --serious: #ec835a;
  --critical: #d03b3b;
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --surface: #1a1a19;
    --surface-2: #262624;
    --text: #ffffff;
    --text-2: #c3c2b7;
    --border: #3a3a37;
    --accent: #3987e5;
  }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--text); font: 15px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { padding: 16px; max-width: 1200px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 8px; }
p { margin: 0; }
button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.status { font-weight: 600; }
.meta, .hint { color: var(--text-2); }

.banner { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 8px 16px; background: var(--critical); color: #ffffff; }
.banner button { background: transparent; color: #ffffff; border-color: #ffffff; }

.start { max-width: 560px; display: grid; gap: 16px; }
.start fieldset { border: 1px solid var(--border); border-radius: 8px; display: flex; flex-wrap: wrap; gap: 4px 16px; }
.start .soon { color: var(--text-2); }
.start .field { display: grid; gap: 4px; }
.engine { display: grid; gap: 12px; max-width: 640px; }
.engine pre { background: var(--surface-2); padding: 8px 12px; border-radius: 6px; margin: 0; }

.game, .review { display: grid; grid-template-columns: minmax(0, auto) minmax(280px, 1fr); gap: 24px; align-items: start; }
@media (max-width: 900px) { .game, .review { grid-template-columns: 1fr; } }
.panel { display: grid; gap: 12px; }
.proposal { border: 1px solid var(--accent); border-radius: 8px; padding: 12px; display: grid; gap: 8px; }
.summary { display: grid; gap: 4px; }
.candidates { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }

.lossbar { margin: 0; overflow-x: auto; }
.lossbar svg { display: block; }
.lossbar .baseline { stroke: var(--border); stroke-width: 1; }
.lossbar .hit { fill: transparent; cursor: pointer; }
.lossbar .slot.selected .hit { fill: var(--surface-2); }
.lossbar figcaption { display: flex; flex-wrap: wrap; gap: 12px; color: var(--text-2); font-size: 13px; margin-top: 4px; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
```

- [ ] **Step 4: Implement the helpers, API client and screens**

`packages/web/src/format.ts`:
```ts
import { vertexToGtp, type Actor, type Category, type Color, type Corner, type MoveVertex } from '@joseki-dojo/shared'

export const formatPoints = (n: number): string =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Russian plural: 1 раз, 2 раза, 5 раз. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export const moveLabel = (v: MoveVertex): string => (v === 'pass' ? 'пас' : vertexToGtp(v))

export const rankLabel = (rank: string): string =>
  rank.endsWith('k') ? `${rank.slice(0, -1)} кю` : `${rank.slice(0, -1)} дан`

export const colorLabel = (c: Color): string => (c === 'B' ? 'чёрные' : 'белые')

export const CATEGORY_LABEL: Record<Category, string> = {
  exact: 'точно',
  inaccuracy: 'неточность',
  mistake: 'ошибка',
  blunder: 'грубая ошибка',
}

export const CORNER_LABEL: Record<Corner, string> = {
  TL: 'левый верхний',
  TR: 'правый верхний',
  BL: 'левый нижний',
  BR: 'правый нижний',
}

export const ACTOR_LABEL: Record<Actor, string> = { user: 'вы', bot: 'бот', 'auto-tenuki': 'вы, тэнуки' }
```

`packages/web/src/api.ts`:
```ts
import type { ClientMessage, HealthResponse, ReviewData, ServerMessage } from '@joseki-dojo/shared'

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as HealthResponse
}

/** Null while the review is still being prepared (HTTP 409). */
export async function fetchReview(sessionId: string): Promise<ReviewData | null> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/review`)
  if (res.status === 409) return null
  if (!res.ok) throw new Error(`Не удалось загрузить разбор: HTTP ${res.status}`)
  return (await res.json()) as ReviewData
}

/** WebSocket that reconnects with backoff and re-subscribes to `sessionId` after reconnecting. */
export class DojoSocket {
  sessionId: string | null = null
  private ws: WebSocket | null = null
  private retries = 0
  private readonly queue: string[] = []

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    private readonly onStatus: (connected: boolean) => void,
  ) {
    this.connect()
  }

  send(msg: ClientMessage): void {
    const data = JSON.stringify(msg)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data)
    else this.queue.push(data)
  }

  private connect(): void {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.retries = 0
      this.onStatus(true)
      if (this.sessionId) ws.send(JSON.stringify({ type: 'resync', sessionId: this.sessionId }))
      for (const data of this.queue.splice(0)) ws.send(data)
    }
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMessage)
    ws.onclose = () => {
      this.onStatus(false)
      const delay = Math.min(5000, 250 * 2 ** this.retries++)
      setTimeout(() => this.connect(), delay)
    }
  }
}
```

`packages/web/src/components/ErrorBanner.tsx`:
```tsx
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div class="banner" role="alert">
      <span>{message}</span>
      {onRetry && <button onClick={onRetry}>Повторить</button>}
    </div>
  )
}
```

`packages/web/src/screens/EngineScreen.tsx`:
```tsx
import type { HealthResponse } from '@joseki-dojo/shared'

export function EngineScreen({ health, onRetry }: { health: HealthResponse; onRetry: () => void }) {
  if (health.state === 'starting') {
    return (
      <main class="engine">
        <p class="status">{health.reason ?? 'KataGo запускается…'}</p>
      </main>
    )
  }
  return (
    <main class="engine">
      <h1>KataGo не настроен</h1>
      <p>{health.reason}</p>
      <p>Выполните в папке проекта и перезапустите сервер:</p>
      <pre>npm run setup</pre>
      <div class="row">
        <button onClick={onRetry}>Проверить снова</button>
      </div>
    </main>
  )
}
```

`packages/web/src/screens/StartScreen.tsx`:
```tsx
import { useState } from 'preact/hooks'
import { BOT_RANKS, DEFAULT_BOT_RANK, type SessionSettings } from '@joseki-dojo/shared'
import { rankLabel } from '../format'

type ColorChoice = SessionSettings['userColor']
type CornerChoice = SessionSettings['corner']

const COLORS: [ColorChoice, string][] = [
  ['B', 'Чёрные'],
  ['W', 'Белые'],
  ['random', 'Случайный цвет'],
]
const CORNERS: [CornerChoice, string][] = [
  ['TL', 'Левый верхний'],
  ['TR', 'Правый верхний'],
  ['BL', 'Левый нижний'],
  ['BR', 'Правый нижний'],
  ['random', 'Случайный угол'],
]
const SOON_MODES = ['Случайно', 'Из списка']
const SOON_ENVIRONMENTS = ['Фусеки', 'Лесенка', 'Смешанно']

export function StartScreen({ onStart }: { onStart: (settings: SessionSettings) => void }) {
  const [userColor, setUserColor] = useState<ColorChoice>('B')
  const [botRank, setBotRank] = useState(DEFAULT_BOT_RANK)
  const [corner, setCorner] = useState<CornerChoice>('random')

  return (
    <main class="start">
      <h1>Joseki Dojo</h1>
      <fieldset>
        <legend>Режим</legend>
        <label>
          <input type="radio" name="mode" checked /> Свободно
        </label>
        {SOON_MODES.map((m) => (
          <label class="soon" key={m}>
            <input type="radio" name="mode" disabled /> {m} <small>скоро</small>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Окружение</legend>
        <label>
          <input type="radio" name="environment" checked /> Пусто
        </label>
        {SOON_ENVIRONMENTS.map((e) => (
          <label class="soon" key={e}>
            <input type="radio" name="environment" disabled /> {e} <small>скоро</small>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Ваш цвет</legend>
        {COLORS.map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="color" checked={userColor === value} onChange={() => setUserColor(value)} /> {label}
          </label>
        ))}
      </fieldset>
      <label class="field">
        Ранг бота
        <select value={botRank} onChange={(e) => setBotRank(e.currentTarget.value)}>
          {BOT_RANKS.map((r) => (
            <option key={r} value={r}>
              {rankLabel(r)}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Угол</legend>
        {CORNERS.map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="corner" checked={corner === value} onChange={() => setCorner(value)} /> {label}
          </label>
        ))}
      </fieldset>
      <div class="row">
        <button class="primary" onClick={() => onStart({ mode: 'free', environment: 'empty', userColor, botRank, corner })}>
          Начать
        </button>
      </div>
    </main>
  )
}
```

`packages/web/src/App.tsx`:
```tsx
import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { ClientMessage, HealthResponse, ReviewData, SessionView } from '@joseki-dojo/shared'
import { DojoSocket, fetchHealth, fetchReview } from './api'
import { ErrorBanner } from './components/ErrorBanner'
import { EngineScreen } from './screens/EngineScreen'
import { StartScreen } from './screens/StartScreen'

interface Progress {
  done: number
  total: number
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthTick, setHealthTick] = useState(0)
  const [session, setSession] = useState<SessionView | null>(null)
  const [review, setReview] = useState<ReviewData | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorSeq, setErrorSeq] = useState(0)
  const [connected, setConnected] = useState(true)

  const socket = useMemo(
    () =>
      new DojoSocket((msg) => {
        switch (msg.type) {
          case 'sessionState':
            setSession(msg.session)
            setError(null)
            if (msg.session.status === 'playing') {
              setReview(null)
              setProgress(null)
            }
            break
          case 'analysisProgress':
            setProgress({ done: msg.done, total: msg.total })
            break
          case 'reviewReady':
            fetchReview(msg.sessionId)
              .then((r) => r && setReview(r))
              .catch((e: Error) => setError(e.message))
            break
          case 'error':
            setError(msg.message)
            setErrorSeq((n) => n + 1)
            break
        }
      }, setConnected),
    [],
  )

  useEffect(() => {
    socket.sessionId = session?.id ?? null
  }, [socket, session?.id])

  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const h = await fetchHealth()
        if (cancelled) return
        setHealth(h)
        if (h.state === 'starting') setTimeout(poll, 2000)
      } catch {
        if (!cancelled) setTimeout(poll, 2000)
      }
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [healthTick])

  // A finished session whose review was prepared before this page loaded.
  const finishedId = session?.status === 'finished' ? session.id : null
  useEffect(() => {
    if (finishedId) fetchReview(finishedId).then((r) => r && setReview(r)).catch(() => undefined)
  }, [finishedId])

  const send = (msg: ClientMessage): void => socket.send(msg)
  const resetToStart = (): void => {
    setSession(null)
    setReview(null)
    setProgress(null)
    setError(null)
  }

  let screen: JSX.Element
  if (!health) screen = <main><p class="status">Загрузка…</p></main>
  else if (health.state !== 'ready') screen = <EngineScreen health={health} onRetry={() => setHealthTick((n) => n + 1)} />
  else if (!session) screen = <StartScreen onStart={(settings) => send({ type: 'startSession', settings })} />
  else if (session.status === 'playing') screen = <main><p class="status">Игровой экран появится в задаче 16.</p></main>
  else screen = <main><p class="status">Экран разбора появится в задаче 17.</p></main>

  const bannerText = connected ? error : 'Нет связи с сервером, переподключаюсь…'
  const retry =
    connected && session
      ? () => {
          setError(null)
          send({ type: 'resync', sessionId: session.id })
        }
      : undefined

  return (
    <>
      {bannerText && <ErrorBanner message={bannerText} onRetry={retry} />}
      {screen}
    </>
  )
}
```

Note: `resetToStart` and `errorSeq` are wired into the game and review screens in Tasks 16–17.

- [ ] **Step 5: Run tests, typecheck and build**

Run: `npx vitest run packages/web`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.
Run: `npm run build`
Expected: Vite prints `✓ built` and writes `packages/web/dist/index.html`.

- [ ] **Step 6: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/web
```

---

### Task 16: Board and game screen

**Files:**
- Create: `packages/web/src/board-maps.ts`, `packages/web/src/components/Board.tsx`, `packages/web/src/screens/GameScreen.tsx`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/src/board-maps.test.ts`

**Interfaces:**
- Consumes: `Position`, `inZone`, `zoneRanges`, `otherColor`, `BOARD_SIZE` (Tasks 2–3); `formatPoints`, `colorLabel`, `rankLabel`, `CORNER_LABEL` (Task 15); Shudan `BoundedGoban`, `Marker`, `GhostStone`, `LineMarker`.
- Produces:
  - board-maps: `emptyMap(fill)`, `ownershipMap(ownership): number[][] | null`, `zoneBorder(corner): LineMarker[]`, `GHOST_TYPE: Record<Category, 'good' | 'interesting' | 'doubtful' | 'bad'>`, `pvMoves(first, pv, count): Move[]`, `isVertex(v): v is Vertex`
  - `Board({ signMap, corner, markers?, ghosts?, paint?, busy?, onClick? })`
  - `GameScreen({ session, errorSeq, send })`

- [ ] **Step 1: Write the failing test**

`packages/web/src/board-maps.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { emptyMap, isVertex, ownershipMap, pvMoves, zoneBorder } from './board-maps'

describe('board maps', () => {
  it('creates independent rows', () => {
    const m = emptyMap(0)
    m[0][0] = 1
    expect(m[1][0]).toBe(0)
    expect(m).toHaveLength(19)
    expect(m[0]).toHaveLength(19)
  })

  it('reshapes ownership row-major from the top-left', () => {
    const m = ownershipMap(Array.from({ length: 361 }, (_, i) => i))!
    expect(m[0][0]).toBe(0)
    expect(m[1][1]).toBe(20)
    expect(m[18][18]).toBe(360)
    expect(ownershipMap(null)).toBeNull()
  })

  it('draws the two inner edges of the zone', () => {
    expect(zoneBorder('TR')).toEqual([
      { v1: [8, 0], v2: [8, 10], type: 'line' },
      { v1: [8, 10], v2: [18, 10], type: 'line' },
    ])
    expect(zoneBorder('BL')).toEqual([
      { v1: [10, 8], v2: [10, 18], type: 'line' },
      { v1: [0, 8], v2: [10, 8], type: 'line' },
    ])
  })

  it('alternates variation colors from the first mover', () => {
    expect(pvMoves('W', [[1, 1], [2, 2], 'pass'], 2)).toEqual([
      { color: 'W', vertex: [1, 1] },
      { color: 'B', vertex: [2, 2] },
    ])
    expect(isVertex('pass')).toBe(false)
    expect(isVertex([0, 0])).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/board-maps.test.ts`
Expected: FAIL — `Failed to resolve import "./board-maps"`.

- [ ] **Step 3: Implement**

`packages/web/src/board-maps.ts`:
```ts
import { BOARD_SIZE, otherColor, zoneRanges, type Category, type Color, type Corner, type Move, type MoveVertex, type Vertex } from '@joseki-dojo/shared'
import type { LineMarker } from '@sabaki/shudan'

export function emptyMap<T>(fill: T): T[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => fill))
}

/** KataGo ownership (row-major from the top-left, Black positive) as a Shudan paint map. */
export function ownershipMap(ownership: readonly number[] | null): number[][] | null {
  if (!ownership) return null
  return Array.from({ length: BOARD_SIZE }, (_, y) => ownership.slice(y * BOARD_SIZE, (y + 1) * BOARD_SIZE))
}

/** The zone's two inner edges; its other two sides are the board edges. */
export function zoneBorder(corner: Corner): LineMarker[] {
  const { x, y } = zoneRanges(corner)
  const innerX = corner === 'TL' || corner === 'BL' ? x[1] : x[0]
  const innerY = corner === 'TL' || corner === 'TR' ? y[1] : y[0]
  return [
    { v1: [innerX, y[0]], v2: [innerX, y[1]], type: 'line' },
    { v1: [x[0], innerY], v2: [x[1], innerY], type: 'line' },
  ]
}

export const GHOST_TYPE: Record<Category, 'good' | 'interesting' | 'doubtful' | 'bad'> = {
  exact: 'good',
  inaccuracy: 'interesting',
  mistake: 'doubtful',
  blunder: 'bad',
}

/** The first `count` moves of a variation, alternating colors from `first`. */
export function pvMoves(first: Color, pv: readonly MoveVertex[], count: number): Move[] {
  return pv.slice(0, count).map((vertex, i) => ({ color: i % 2 === 0 ? first : otherColor(first), vertex }))
}

export const isVertex = (v: MoveVertex): v is Vertex => v !== 'pass'
```

`packages/web/src/components/Board.tsx`:
```tsx
import { BoundedGoban, type GhostStone, type Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Corner, Vertex } from '@joseki-dojo/shared'
import { zoneBorder } from '../board-maps'

export interface BoardProps {
  signMap: (0 | 1 | -1)[][]
  corner: Corner
  markers?: (Marker | null)[][]
  ghosts?: (GhostStone | null)[][]
  /** Ownership -1..1 (Black positive); Shudan scales the paint opacity by the magnitude. */
  paint?: number[][] | null
  busy?: boolean
  onClick?: (vertex: Vertex) => void
}

const fit = (): { width: number; height: number } => ({
  width: Math.min(720, window.innerWidth - 32),
  height: Math.min(720, window.innerHeight - 96),
})

export function Board({ signMap, corner, markers, ghosts, paint, busy, onClick }: BoardProps) {
  const [size, setSize] = useState(fit)
  useEffect(() => {
    const onResize = (): void => setSize(fit())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const lines = useMemo(() => zoneBorder(corner), [corner])

  return (
    <BoundedGoban
      maxWidth={size.width}
      maxHeight={size.height}
      showCoordinates
      fuzzyStonePlacement
      animateStonePlacement
      busy={busy}
      signMap={signMap}
      markerMap={markers}
      ghostStoneMap={ghosts}
      paintMap={(paint ?? undefined) as (0 | 1 | -1)[][] | undefined}
      lines={lines}
      onVertexClick={(_evt, v) => onClick?.([v[0], v[1]])}
    />
  )
}
```

`packages/web/src/screens/GameScreen.tsx`:
```tsx
import type { Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { inZone, Position, type ClientMessage, type SessionView, type Vertex } from '@joseki-dojo/shared'
import { emptyMap, isVertex } from '../board-maps'
import { Board } from '../components/Board'
import { colorLabel, CORNER_LABEL, rankLabel } from '../format'

export interface GameScreenProps {
  session: SessionView
  /** Increments on every server error so a pending action can be released. */
  errorSeq: number
  send: (msg: ClientMessage) => void
}

export function GameScreen({ session, errorSeq, send }: GameScreenProps) {
  const [pending, setPending] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  useEffect(() => setPending(false), [session, errorSeq])
  useEffect(() => setHint(null), [session.moves.length])

  const { userColor, corner, botRank } = session.settings
  const position = useMemo(() => Position.fromMoves([...session.initialMoves, ...session.moves]), [session])
  const userTurn = session.status === 'playing' && session.toMove === userColor && !session.botThinking && !pending
  const last = session.moves.at(-1) ?? session.initialMoves.at(-1) ?? null
  const markers = useMemo(() => {
    const m = emptyMap<Marker | null>(null)
    if (last && isVertex(last.vertex)) m[last.vertex[1]][last.vertex[0]] = { type: 'circle' }
    return m
  }, [last])

  const play = (v: Vertex): void => {
    if (!userTurn) return
    if (!inZone(corner, v)) return setHint('Ходить можно только внутри выделенной зоны угла')
    if (!position.isLegal(userColor, v)) return setHint('Недопустимый ход')
    setPending(true)
    send({ type: 'playMove', sessionId: session.id, vertex: v })
  }
  const tenuki = (): void => {
    setPending(true)
    send({ type: 'tenuki', sessionId: session.id })
  }
  const finish = (): void => send({ type: 'finish', sessionId: session.id })
  const keepPlaying = (): void => send({ type: 'continuePlaying', sessionId: session.id })

  const status = session.botThinking
    ? 'Бот думает…'
    : session.toMove === userColor
      ? `Ваш ход (${colorLabel(userColor)})`
      : 'Ход бота'

  return (
    <main class="game">
      <Board signMap={position.signMap()} corner={corner} markers={markers} busy={session.botThinking || pending} onClick={play} />
      <aside class="panel">
        <p class="status">{status}</p>
        <p class="meta">
          Бот: {rankLabel(botRank)} · угол: {CORNER_LABEL[corner]} · ходов: {session.moves.length}
        </p>
        {session.endProposed && (
          <div class="proposal" role="status">
            <p>Похоже, дзёсеки закончилось.</p>
            <div class="row">
              <button class="primary" onClick={finish}>
                К разбору
              </button>
              <button onClick={keepPlaying}>Играть дальше</button>
            </div>
          </div>
        )}
        {hint && <p class="hint">{hint}</p>}
        <div class="row">
          <button disabled={!userTurn} onClick={tenuki}>
            Тэнуки
          </button>
          <button onClick={finish}>Закончить</button>
        </div>
      </aside>
    </main>
  )
}
```

In `packages/web/src/App.tsx` add the import:
```tsx
import { GameScreen } from './screens/GameScreen'
```
and replace the line
```tsx
  else if (session.status === 'playing') screen = <main><p class="status">Игровой экран появится в задаче 16.</p></main>
```
with
```tsx
  else if (session.status === 'playing') screen = <GameScreen session={session} errorSeq={errorSeq} send={send} />
```

- [ ] **Step 4: Run tests, typecheck and build**

Run: `npx vitest run packages/web`
Expected: PASS.
Run: `npm run typecheck`
Expected: exits 0.
Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/web
```

---

### Task 17: Loss bar and review screen

**Files:**
- Create: `packages/web/src/components/LossBar.tsx`, `packages/web/src/screens/ReviewScreen.tsx`
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `ReviewData` (Task 2); `Position`, `colorSign` (Task 3); board-maps and `Board` (Task 16); format helpers (Task 15).
- Produces: `LossBar({ moves, userColor, selected, onSelect })`, `ReviewScreen({ review, progress, onReplay, onNew })`.

Design (data-viz rules): one column per move; height = loss capped at 10 points; the user's moves grow up from the baseline and the bot's grow down, so identity is carried by position, not color; color = loss category from the fixed status palette, always paired with a text label (legend, tooltip, details panel). Bars have a 4px rounded data end, a square base and a 2px gap; each column has a full-height hit target with a native tooltip.

- [ ] **Step 1: Implement the loss bar**

`packages/web/src/components/LossBar.tsx`:
```tsx
import type { Category, Color, MoveReview } from '@joseki-dojo/shared'
import { ACTOR_LABEL, CATEGORY_LABEL, formatPoints, moveLabel } from '../format'

const SLOT = 14
const GAP = 2
const HALF = 48
const MAX_LOSS = 10
const CATEGORIES: Category[] = ['exact', 'inaccuracy', 'mistake', 'blunder']
const FILL: Record<Category, string> = {
  exact: 'var(--good)',
  inaccuracy: 'var(--warning)',
  mistake: 'var(--serious)',
  blunder: 'var(--critical)',
}

/** Bar with a 4px rounded data end (away from the baseline) and a square base. */
function barPath(x: number, y: number, w: number, h: number, up: boolean): string {
  const r = Math.min(4, w / 2, h)
  return up
    ? `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
    : `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`
}

export interface LossBarProps {
  moves: MoveReview[]
  userColor: Color
  selected: number
  onSelect: (turn: number) => void
}

export function LossBar({ moves, userColor, selected, onSelect }: LossBarProps) {
  const width = Math.max(moves.length, 1) * SLOT
  const height = HALF * 2 + 1
  return (
    <figure class="lossbar">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Потери по ходам">
        <line class="baseline" x1={0} x2={width} y1={HALF + 0.5} y2={HALF + 0.5} />
        {moves.map((m) => {
          const mine = m.color === userColor
          const h = Math.max(2, (Math.min(m.loss, MAX_LOSS) / MAX_LOSS) * (HALF - 2))
          const x = m.turn * SLOT + GAP / 2
          const y = mine ? HALF - h : HALF + 1
          return (
            <g key={m.turn} class={m.turn === selected ? 'slot selected' : 'slot'} onClick={() => onSelect(m.turn)}>
              <rect class="hit" x={m.turn * SLOT} y={0} width={SLOT} height={height} />
              <path d={barPath(x, y, SLOT - GAP, h, mine)} fill={FILL[m.category]} />
              <title>{`Ход ${m.turn + 1} (${ACTOR_LABEL[m.actor]}): ${moveLabel(m.vertex)} — потеря ${formatPoints(m.loss)}, ${CATEGORY_LABEL[m.category]}`}</title>
            </g>
          )
        })}
      </svg>
      <figcaption>
        <span>↑ ваши ходы · ↓ ходы бота</span>
        {CATEGORIES.map((c) => (
          <span key={c}>
            <i class="swatch" style={{ background: FILL[c] }} />
            {CATEGORY_LABEL[c]}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
```

- [ ] **Step 2: Implement the review screen**

`packages/web/src/screens/ReviewScreen.tsx`:
```tsx
import type { GhostStone, Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { colorSign, Position, type ReviewData } from '@joseki-dojo/shared'
import { emptyMap, GHOST_TYPE, isVertex, ownershipMap, pvMoves } from '../board-maps'
import { Board } from '../components/Board'
import { LossBar } from '../components/LossBar'
import { ACTOR_LABEL, CATEGORY_LABEL, colorLabel, formatPoints, moveLabel, plural } from '../format'

const LABELS = 'ABC'

export interface ReviewScreenProps {
  review: ReviewData | null
  progress: { done: number; total: number } | null
  onReplay: (turn: number) => void
  onNew: () => void
}

export function ReviewScreen({ review, progress, onReplay, onNew }: ReviewScreenProps) {
  if (!review) {
    return (
      <main class="engine">
        <p class="status">Анализирую позиции…{progress ? ` ${progress.done} из ${progress.total}` : ''}</p>
        <div class="row">
          <button onClick={onNew}>Новая тренировка</button>
        </div>
      </main>
    )
  }
  if (review.moves.length === 0) {
    return (
      <main class="engine">
        <p>В этой тренировке не было ходов.</p>
        <div class="row">
          <button class="primary" onClick={onNew}>
            Новая тренировка
          </button>
        </div>
      </main>
    )
  }
  return <ReviewLoaded review={review} onReplay={onReplay} onNew={onNew} />
}

function ReviewLoaded({ review, onReplay, onNew }: { review: ReviewData; onReplay: (turn: number) => void; onNew: () => void }) {
  const [turn, setTurn] = useState(0)
  const [pvStep, setPvStep] = useState<number | null>(null)
  const [showOwnership, setShowOwnership] = useState(false)
  useEffect(() => setPvStep(null), [turn])

  const move = review.moveReviews[turn]
  const position = review.positions[turn]
  const best = position.candidates[0] ?? null
  const variation = useMemo(
    () => (best && pvStep !== null ? pvMoves(move.color, best.pv, pvStep) : []),
    [best, pvStep, move.color],
  )
  const signMap = useMemo(() => {
    const base = [...review.initialMoves, ...review.moves.slice(0, turn)]
    try {
      return Position.fromMoves([...base, ...variation]).signMap()
    } catch {
      return Position.fromMoves(base).signMap()
    }
  }, [review, turn, variation])

  const markers = emptyMap<Marker | null>(null)
  const ghosts = emptyMap<GhostStone | null>(null)
  if (pvStep === null) {
    position.candidates.forEach((c, i) => {
      if (isVertex(c.vertex)) markers[c.vertex[1]][c.vertex[0]] = { type: 'label', label: LABELS[i] }
    })
    if (isVertex(move.vertex)) ghosts[move.vertex[1]][move.vertex[0]] = { sign: colorSign(move.color), type: GHOST_TYPE[move.category] }
  } else {
    variation.forEach((m, i) => {
      if (isVertex(m.vertex)) markers[m.vertex[1]][m.vertex[0]] = { type: 'label', label: String(i + 1) }
    })
  }
  const paint = showOwnership ? ownershipMap(review.positions[turn + 1].ownership) : null

  const s = review.summary
  const punishment = review.punishments.find((e) => e.turn === turn || e.turn + 1 === turn) ?? null
  const lastTurn = review.moves.length - 1

  return (
    <main class="review">
      <Board signMap={signMap} corner={review.settings.corner} markers={markers} ghosts={ghosts} paint={paint} />
      <aside class="panel">
        <div class="summary">
          <p>Вы потеряли {formatPoints(s.userLoss)} очка.</p>
          <p>
            Бот ошибся {s.botMistakes} {plural(s.botMistakes, 'раз', 'раза', 'раз')}
            {s.botMistakes > 0 && ` на ${formatPoints(s.botMistakeLoss)} очка`}.
          </p>
          {s.botMistakes > 0 && (
            <p>
              Наказано {s.punished} из {s.botMistakes}, удержано {formatPoints(s.keptPoints)} из {formatPoints(s.botMistakeLoss)} очка.
            </p>
          )}
        </div>
        <LossBar moves={review.moveReviews} userColor={review.settings.userColor} selected={turn} onSelect={setTurn} />
        <div class="row">
          <button disabled={turn === 0} onClick={() => setTurn(turn - 1)} aria-label="Предыдущий ход">
            ◀
          </button>
          <span>
            Ход {turn + 1} из {review.moves.length}
          </span>
          <button disabled={turn === lastTurn} onClick={() => setTurn(turn + 1)} aria-label="Следующий ход">
            ▶
          </button>
        </div>
        <p>
          {colorLabel(move.color)} ({ACTOR_LABEL[move.actor]}): <b>{moveLabel(move.vertex)}</b> — потеря {formatPoints(move.loss)}, {CATEGORY_LABEL[move.category]}
        </p>
        {punishment && (
          <p>
            {punishment.turn === turn ? 'Ошибка бота' : 'Ваш ответ на ошибку бота'}: бот потерял {formatPoints(punishment.botLoss)}, ваш ответ —{' '}
            {formatPoints(punishment.userLoss)}. {punishment.punished ? 'Наказано.' : `Не наказано, удержано ${formatPoints(punishment.kept)}.`}
          </p>
        )}
        <ul class="candidates">
          {position.candidates.map((c, i) => (
            <li key={i}>
              <b>{LABELS[i]}</b> {moveLabel(c.vertex)} {i === 0 ? '— лучший ход' : `— −${formatPoints(c.loss)}`}
            </li>
          ))}
        </ul>
        {best && best.pv.length > 0 && (
          <div class="row">
            {pvStep === null ? (
              <button onClick={() => setPvStep(1)}>Показать ветку</button>
            ) : (
              <>
                <button disabled={pvStep <= 1} onClick={() => setPvStep(pvStep - 1)} aria-label="Назад по ветке">
                  ◀
                </button>
                <span>
                  Ветка: {pvStep} из {best.pv.length}
                </span>
                <button disabled={pvStep >= best.pv.length} onClick={() => setPvStep(pvStep + 1)} aria-label="Вперёд по ветке">
                  ▶
                </button>
                <button onClick={() => setPvStep(null)}>Скрыть ветку</button>
              </>
            )}
          </div>
        )}
        <label>
          <input type="checkbox" checked={showOwnership} onChange={() => setShowOwnership(!showOwnership)} /> Чья территория
        </label>
        <div class="row">
          <button class="primary" onClick={() => onReplay(turn)}>
            Переиграть с этого хода
          </button>
          <button onClick={onNew}>Новая тренировка</button>
        </div>
      </aside>
    </main>
  )
}
```

In `packages/web/src/App.tsx` add the import:
```tsx
import { ReviewScreen } from './screens/ReviewScreen'
```
and replace the line
```tsx
  else screen = <main><p class="status">Экран разбора появится в задаче 17.</p></main>
```
with
```tsx
  else
    screen = (
      <ReviewScreen
        review={review}
        progress={progress}
        onReplay={(turn) => send({ type: 'replayFrom', sessionId: session.id, turn })}
        onNew={resetToStart}
      />
    )
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck`
Expected: exits 0.
Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Look at it**

Write the smoke config of Task 14 Step 5 again, this time with `port: 5179` (the port the Vite dev proxy targets):
```bash
node -e "require('fs').writeFileSync(require('os').tmpdir()+'/joseki-smoke.json', JSON.stringify({port:5179,dataDir:require('os').tmpdir()+'/joseki-smoke-data',katago:{commandOverride:['node', require('path').resolve('packages/server/test/fake-katago.mjs')]}}))"
```
Start both in background shells:
```bash
JOSEKI_CONFIG="$(node -p "require('os').tmpdir()")/joseki-smoke.json" npx tsx packages/server/src/main.ts
```
```bash
npm run dev -w @joseki-dojo/web
```
Open `http://127.0.0.1:5173` in the browser pane, start a session as Black in the top-right corner, play Q16, accept the end proposal and confirm on the review screen: the summary renders; the loss bar shows two columns (one up, one down) with its legend; ◀/▶ move between moves; «Показать ветку» steps through the variation with numbered stones; «Чья территория» toggles without console errors. Stop both background processes.

- [ ] **Step 5: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add packages/web
```

---

### Task 17a: Settings screen

**Files:**
- Create: `packages/web/src/screens/SettingsScreen.tsx`
- Modify: `packages/web/src/api.ts` (import line + append), `packages/web/src/screens/EngineScreen.tsx` (whole file), `packages/web/src/App.tsx` (whole file), `packages/web/src/styles.css` (append)

**Interfaces:**
- Consumes: `SettingsView`, `SettingsUpdate`, `SettingsResponse` (Task 14a); `GET/PUT /api/settings` (Task 14a); every screen from Tasks 15–17.
- Produces: `fetchSettings(): Promise<SettingsView>`, `saveSettings(update): Promise<SettingsResponse>`, `SettingsScreen({ onClose, onSaved })`, `EngineScreen({ health, onRetry, onSettings })`; the final `App` with a «Настройки» button outside a game and a version-warning notice.

- [ ] **Step 1: Extend the API client**

In `packages/web/src/api.ts` replace the first line with:
```ts
import type { ClientMessage, HealthResponse, ReviewData, ServerMessage, SettingsResponse, SettingsUpdate, SettingsView } from '@joseki-dojo/shared'
```
and append:
```ts
export async function fetchSettings(): Promise<SettingsView> {
  const res = await fetch('/api/settings')
  if (!res.ok) throw new Error(`Не удалось загрузить настройки: HTTP ${res.status}`)
  return (await res.json()) as SettingsView
}

/** 200 and 400 both carry a SettingsResponse; anything else is a transport error. */
export async function saveSettings(update: SettingsUpdate): Promise<SettingsResponse> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  })
  if (res.status !== 200 && res.status !== 400) throw new Error(`Не удалось сохранить настройки: HTTP ${res.status}`)
  return (await res.json()) as SettingsResponse
}
```

- [ ] **Step 2: Write the settings screen**

`packages/web/src/screens/SettingsScreen.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks'
import type { SettingsUpdate, SettingsView } from '@joseki-dojo/shared'
import { fetchSettings, saveSettings } from '../api'

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; text: string }
type PathKey = keyof SettingsUpdate['katago']
type VisitsKey = keyof SettingsUpdate['analysis']

const PATH_FIELDS: { key: PathKey; label: string; models: boolean }[] = [
  { key: 'path', label: 'Исполняемый файл KataGo', models: false },
  { key: 'analysisConfig', label: 'Конфиг анализа', models: false },
  { key: 'mainModel', label: 'Основная сеть', models: true },
  { key: 'humanModel', label: 'Human-сеть', models: true },
]

const VISIT_FIELDS: { key: VisitsKey; label: string }[] = [
  { key: 'reviewVisits', label: 'Визиты на позицию в разборе' },
  { key: 'endVisits', label: 'Визиты для проверки конца дзёсеки' },
]

export function SettingsScreen({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null)
  const [form, setForm] = useState<SettingsUpdate | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    fetchSettings()
      .then((v) => {
        setView(v)
        setForm({ katago: { ...v.katago }, analysis: { ...v.analysis } })
      })
      .catch((e: Error) => setStatus({ kind: 'error', text: e.message }))
  }, [])

  if (!view || !form) {
    return (
      <main class="settings">
        <p class={status.kind === 'error' ? 'hint error' : 'status'}>{status.kind === 'error' ? status.text : 'Загрузка настроек…'}</p>
        <div class="row">
          <button onClick={onClose}>Назад</button>
        </div>
      </main>
    )
  }

  const setPath = (key: PathKey, value: string): void => setForm({ ...form, katago: { ...form.katago, [key]: value } })
  const setVisits = (key: VisitsKey, value: string): void => setForm({ ...form, analysis: { ...form.analysis, [key]: Number(value) } })

  const save = async (): Promise<void> => {
    setStatus({ kind: 'saving' })
    try {
      const r = await saveSettings(form)
      if (r.ok) {
        setView(r.settings)
        setStatus({ kind: 'saved' })
        onSaved()
      } else {
        setStatus({ kind: 'error', text: r.reason })
      }
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  return (
    <main class="settings">
      <h1>Настройки</h1>
      <p class="meta">
        Проверенная версия KataGo: {view.lockedVersion}. Запущена: {view.runningVersion ?? 'нет'}.
      </p>
      {view.versionWarning && <p class="notice">{view.versionWarning}</p>}
      <fieldset>
        <legend>Движок</legend>
        {PATH_FIELDS.map((f) => (
          <label class="field" key={f.key}>
            {f.label}
            <input
              type="text"
              spellcheck={false}
              value={form.katago[f.key]}
              list={f.models ? 'models' : undefined}
              onInput={(e) => setPath(f.key, e.currentTarget.value)}
            />
          </label>
        ))}
        <datalist id="models">
          {view.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p class="hint">
          Сети из папки engines/models можно выбрать из списка. Браузер не сообщает полный путь к файлу из окна выбора, поэтому путь вводится текстом.
        </p>
      </fieldset>
      <fieldset>
        <legend>Анализ</legend>
        {VISIT_FIELDS.map((f) => (
          <label class="field" key={f.key}>
            {f.label}
            <input type="number" min={1} value={form.analysis[f.key]} onInput={(e) => setVisits(f.key, e.currentTarget.value)} />
          </label>
        ))}
      </fieldset>
      <div class="row">
        <button class="primary" disabled={status.kind === 'saving'} onClick={() => void save()}>
          Сохранить и проверить
        </button>
        <button onClick={onClose}>Назад</button>
      </div>
      {status.kind === 'saving' && <p class="status">Запускаю KataGo с новыми настройками…</p>}
      {status.kind === 'saved' && <p class="status">Сохранено, KataGo работает.</p>}
      {status.kind === 'error' && <p class="hint error">{status.text}</p>}
    </main>
  )
}
```

- [ ] **Step 3: Replace the engine screen and the app**

Replace `packages/web/src/screens/EngineScreen.tsx` with:
```tsx
import type { HealthResponse } from '@joseki-dojo/shared'

export interface EngineScreenProps {
  health: HealthResponse
  onRetry: () => void
  onSettings: () => void
}

export function EngineScreen({ health, onRetry, onSettings }: EngineScreenProps) {
  if (health.state === 'starting') {
    return (
      <main class="engine">
        <p class="status">{health.reason ?? 'KataGo запускается…'}</p>
      </main>
    )
  }
  return (
    <main class="engine">
      <h1>KataGo не настроен</h1>
      <p>{health.reason}</p>
      <p>Скачайте проверенные версии командой в папке проекта и перезапустите сервер:</p>
      <pre>npm run setup</pre>
      <p>Или укажите пути к уже установленной KataGo и сетям в настройках.</p>
      <div class="row">
        <button class="primary" onClick={onSettings}>
          Открыть настройки
        </button>
        <button onClick={onRetry}>Проверить снова</button>
      </div>
    </main>
  )
}
```

Replace `packages/web/src/App.tsx` with:
```tsx
import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { ClientMessage, HealthResponse, ReviewData, SessionView } from '@joseki-dojo/shared'
import { DojoSocket, fetchHealth, fetchReview, fetchSettings } from './api'
import { ErrorBanner } from './components/ErrorBanner'
import { EngineScreen } from './screens/EngineScreen'
import { GameScreen } from './screens/GameScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StartScreen } from './screens/StartScreen'

interface Progress {
  done: number
  total: number
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthTick, setHealthTick] = useState(0)
  const [session, setSession] = useState<SessionView | null>(null)
  const [review, setReview] = useState<ReviewData | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorSeq, setErrorSeq] = useState(0)
  const [connected, setConnected] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [versionWarning, setVersionWarning] = useState<string | null>(null)

  const socket = useMemo(
    () =>
      new DojoSocket((msg) => {
        switch (msg.type) {
          case 'sessionState':
            setSession(msg.session)
            setError(null)
            if (msg.session.status === 'playing') {
              setReview(null)
              setProgress(null)
            }
            break
          case 'analysisProgress':
            setProgress({ done: msg.done, total: msg.total })
            break
          case 'reviewReady':
            fetchReview(msg.sessionId)
              .then((r) => r && setReview(r))
              .catch((e: Error) => setError(e.message))
            break
          case 'error':
            setError(msg.message)
            setErrorSeq((n) => n + 1)
            break
        }
      }, setConnected),
    [],
  )

  useEffect(() => {
    socket.sessionId = session?.id ?? null
  }, [socket, session?.id])

  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const h = await fetchHealth()
        if (cancelled) return
        setHealth(h)
        if (h.state === 'starting') setTimeout(poll, 2000)
      } catch {
        if (!cancelled) setTimeout(poll, 2000)
      }
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [healthTick])

  // Spec 6.6: warn when the running KataGo is not the version pinned in katago.lock.json.
  const ready = health?.state === 'ready'
  useEffect(() => {
    if (!ready) return
    fetchSettings()
      .then((s) => setVersionWarning(s.versionWarning))
      .catch(() => undefined)
  }, [ready, healthTick])

  // A finished session whose review was prepared before this page loaded.
  const finishedId = session?.status === 'finished' ? session.id : null
  useEffect(() => {
    if (finishedId) fetchReview(finishedId).then((r) => r && setReview(r)).catch(() => undefined)
  }, [finishedId])

  const send = (msg: ClientMessage): void => socket.send(msg)
  const resetToStart = (): void => {
    setSession(null)
    setReview(null)
    setProgress(null)
    setError(null)
  }

  let screen: JSX.Element
  if (showSettings) screen = <SettingsScreen onClose={() => setShowSettings(false)} onSaved={() => setHealthTick((n) => n + 1)} />
  else if (!health) screen = <main><p class="status">Загрузка…</p></main>
  else if (health.state !== 'ready')
    screen = <EngineScreen health={health} onRetry={() => setHealthTick((n) => n + 1)} onSettings={() => setShowSettings(true)} />
  else if (!session) screen = <StartScreen onStart={(settings) => send({ type: 'startSession', settings })} />
  else if (session.status === 'playing') screen = <GameScreen session={session} errorSeq={errorSeq} send={send} />
  else
    screen = (
      <ReviewScreen
        review={review}
        progress={progress}
        onReplay={(turn) => send({ type: 'replayFrom', sessionId: session.id, turn })}
        onNew={resetToStart}
      />
    )

  const inGame = session?.status === 'playing'
  const bannerText = connected ? error : 'Нет связи с сервером, переподключаюсь…'
  const retry =
    connected && session
      ? () => {
          setError(null)
          send({ type: 'resync', sessionId: session.id })
        }
      : undefined

  return (
    <>
      {bannerText && <ErrorBanner message={bannerText} onRetry={retry} />}
      {!inGame && !showSettings && (
        <header class="topbar">
          <button onClick={() => setShowSettings(true)}>Настройки</button>
        </header>
      )}
      {versionWarning && !showSettings && <p class="notice">{versionWarning}</p>}
      {screen}
    </>
  )
}
```

Append to `packages/web/src/styles.css`:
```css
.topbar { display: flex; justify-content: flex-end; max-width: 1200px; margin: 0 auto; padding: 8px 16px 0; }
.notice { max-width: 1168px; margin: 8px auto 0; padding: 8px 12px; border-left: 4px solid var(--warning); background: var(--surface-2); }
.settings { max-width: 760px; display: grid; gap: 16px; }
.settings fieldset { border: 1px solid var(--border); border-radius: 8px; display: grid; gap: 12px; }
.settings .field { display: grid; gap: 4px; }
.settings input { font: 13px ui-monospace, Consolas, monospace; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); }
.settings input[type='text'] { width: 100%; }
.settings input[type='number'] { width: 120px; }
.error { color: var(--critical); }
```

- [ ] **Step 4: Typecheck, build and look at it**

Run: `npm run typecheck`
Expected: exits 0.
Run: `npm run build`
Expected: `✓ built`.
With the smoke server (port 5179) and `npm run dev -w @joseki-dojo/web` running as in Task 17 Step 4, open `http://127.0.0.1:5173`, press «Настройки»: the four paths and both visit counts are shown, «Проверенная версия KataGo: 1.18.1. Запущена: 1.18.1.»; set «Основная сеть» to a path that does not exist and press «Сохранить и проверить» — the screen shows «Нет основной сети KataGo: …» and the game still starts afterwards. Stop both processes.

- [ ] **Step 5: Milestone commit**

```bash
git add packages/web
git commit -m "feat(web): add start, game, review and settings screens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: End-to-end test with the fake engine

**Files:**
- Create: `playwright.config.ts`, `e2e/config.e2e.json`, `e2e/game.spec.ts`

**Interfaces:**
- Consumes: the built web app (Tasks 15–17a), the server entry point (Tasks 14, 14a), `packages/server/test/fake-katago.mjs` (Task 5).
- Produces: `npm run e2e` — builds the web app, starts the server on `127.0.0.1:5180` with the fake engine, runs the browser tests.

- [ ] **Step 1: Install the browser**

Run: `npx playwright install chromium`
Expected: Chromium is downloaded (or reported as already installed).

- [ ] **Step 2: Write the configuration**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5180' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build && npx tsx packages/server/src/main.ts',
    url: 'http://127.0.0.1:5180/api/health',
    env: { JOSEKI_CONFIG: 'e2e/config.e2e.json' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
```

`e2e/config.e2e.json`:
```json
{
  "port": 5180,
  "dataDir": ".data",
  "katago": { "commandOverride": ["node", "../packages/server/test/fake-katago.mjs"] },
  "analysis": { "reviewVisits": 10, "endVisits": 5 }
}
```

- [ ] **Step 3: Write the tests**

`e2e/game.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test'

async function startAsBlackTopRight(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.getByText('Ваш ход (чёрные)')).toBeVisible()
}

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)

test('play a move, accept the end proposal and replay from the review', async ({ page }) => {
  await startAsBlackTopRight(page)
  await vertex(page, 15, 3).click()

  // The fake engine's best move is D4, outside the top-right zone, so the end is proposed after the bot replies.
  await expect(page.getByText('Похоже, дзёсеки закончилось.')).toBeVisible()
  await page.getByRole('button', { name: 'К разбору' }).click()

  await expect(page.getByText(/Вы потеряли/)).toBeVisible()
  await expect(page.locator('.lossbar g.slot')).toHaveCount(2)
  await page.getByRole('button', { name: 'Показать ветку' }).click()
  await expect(page.getByText(/Ветка: 1 из/)).toBeVisible()

  await page.getByRole('button', { name: 'Переиграть с этого хода' }).click()
  await expect(page.getByText('Ваш ход (чёрные)')).toBeVisible()
})

test('a click outside the zone shows a hint and plays nothing', async ({ page }) => {
  await startAsBlackTopRight(page)
  await vertex(page, 3, 15).click()
  await expect(page.getByText('Ходить можно только внутри выделенной зоны угла')).toBeVisible()
  await expect(page.getByText('ходов: 0')).toBeVisible()
})

test('settings show the pinned version and refuse a missing network', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByText(/Проверенная версия KataGo: 1\.18\.1/)).toBeVisible()
  await page.getByLabel('Основная сеть').fill('/nope/missing.bin.gz')
  await page.getByRole('button', { name: 'Сохранить и проверить' }).click()
  await expect(page.locator('.hint.error')).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible()
})
```

- [ ] **Step 4: Run**

Run: `npm run e2e`
Expected: `3 passed`.

- [ ] **Step 5: Stage the changes**

No commit after this task (see "Commits" in Global Constraints):

```bash
git add playwright.config.ts e2e
```

---

### Task 19: KataGo setup from the lock file

**Files:**
- Create: `scripts/setup/katago-config.ts`, `scripts/setup/calibrate.ts`, `scripts/setup/download.ts`, `scripts/setup/setup.ts`
- Test: `scripts/setup/katago-config.test.ts`, `scripts/setup/calibrate.test.ts`, `scripts/setup/download.test.ts`

**Interfaces:**
- Consumes: `loadLock`, `buildsFor`, `versionWarning`, `LockedBuild` (Task 14a); `KataGoEngine`, `AnalysisEngine`, `baseQuery` (Task 5); `compareVersions`, `MIN_KATAGO_VERSION` (Task 6); `StubEngine` (Task 8, tests only).
- Produces: `npm run setup` (interactive; answers may be piped) which writes `engines/…`, `engines/analysis.cfg` and `config.local.json`; helpers `analysisConfigText(opts)`, `searchThreadsFor(kind, cores)`, `visitsForBudget(vps, seconds?)`, `measureVisitsPerSecond(engine, visits?)`, `sha256File(file)`, `download(url, dest, sha256, log?)`, `unzip(zip, dir)`, `findKatagoBinary(dir)`.

Every file comes from `katago.lock.json` and is accepted only if its SHA-256 matches. Threads are set from the build kind and the speed is measured with a real query instead of parsing `katago benchmark` (spec 6.4).

- [ ] **Step 1: Write the failing tests**

`scripts/setup/katago-config.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { analysisConfigText, searchThreadsFor } from './katago-config'

describe('analysis config', () => {
  it('reports from Black’s view and uses forward slashes', () => {
    const text = analysisConfigText({ logDir: 'C:\\dojo\\data\\katago-logs', searchThreadsPerAnalysisThread: 6 })
    expect(text).toContain('reportAnalysisWinratesAs = BLACK')
    expect(text).toContain('logDir = C:/dojo/data/katago-logs')
    expect(text).toContain('numAnalysisThreads = 2')
    expect(text).toContain('numSearchThreadsPerAnalysisThread = 6')
  })

  it('splits CPU cores between the analysis threads and uses 8 per thread on GPU', () => {
    expect(searchThreadsFor('cpu', 24)).toBe(12)
    expect(searchThreadsFor('cpu', 1)).toBe(1)
    expect(searchThreadsFor('gpu', 24)).toBe(8)
  })
})
```

`scripts/setup/calibrate.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { StubEngine } from '../../packages/server/test/helpers'
import { measureVisitsPerSecond, visitsForBudget } from './calibrate'

describe('visitsForBudget', () => {
  it('targets two seconds per position, rounded to 50, within limits', () => {
    expect(visitsForBudget(250)).toEqual({ reviewVisits: 500, endVisits: 250 })
    expect(visitsForBudget(400)).toEqual({ reviewVisits: 800, endVisits: 400 })
    expect(visitsForBudget(10)).toEqual({ reviewVisits: 100, endVisits: 50 })
    expect(visitsForBudget(100_000)).toEqual({ reviewVisits: 5000, endVisits: 2500 })
  })
})

describe('measureVisitsPerSecond', () => {
  it('warms up on another position, then times a fixed search', async () => {
    const engine = new StubEngine()
    const vps = await measureVisitsPerSecond(engine, 800)
    expect(vps).toBeGreaterThan(0)
    expect(engine.queries.map((q) => [q.moves.length, q.maxVisits])).toEqual([
      [0, 100],
      [4, 800],
    ])
  })
})
```

`scripts/setup/download.test.ts`:
```ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { download, findKatagoBinary, sha256File } from './download'

const temp = (): string => mkdtempSync(join(tmpdir(), 'joseki-setup-'))
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const closers: (() => Promise<void>)[] = []

async function serve(body: Buffer): Promise<string> {
  const server = createServer((_req, res) => {
    res.setHeader('content-length', body.length)
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/file.bin`
}

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

describe('download', () => {
  const body = Buffer.from('katago network bytes')

  it('downloads a file and verifies its checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    await download(await serve(body), dest, sha(body), () => undefined)
    expect(readFileSync(dest)).toEqual(body)
    expect(await sha256File(dest)).toBe(sha(body))
  })

  it('rejects a wrong checksum and leaves nothing behind', async () => {
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(await serve(body), dest, sha(Buffer.from('other')), () => undefined)).rejects.toThrow(/SHA-256/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('re-checks an existing file instead of downloading it', async () => {
    const dest = join(temp(), 'net.bin.gz')
    writeFileSync(dest, body)
    const logs: string[] = []
    await download('https://invalid.example/never-fetched', dest, sha(body), (l) => logs.push(l))
    expect(logs).toEqual(['Уже скачано и проверено: net.bin.gz'])
  })

  it('refuses an existing file with a different checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    writeFileSync(dest, 'tampered')
    await expect(download('https://invalid.example/never-fetched', dest, sha(body), () => undefined)).rejects.toThrow(/katago\.lock\.json/)
  })
})

describe('findKatagoBinary', () => {
  it('finds the executable in nested folders', () => {
    const dir = temp()
    const nested = join(dir, 'katago-v1.18.1', 'bin')
    mkdirSync(nested, { recursive: true })
    const name = process.platform === 'win32' ? 'katago.exe' : 'katago'
    writeFileSync(join(nested, name), '')
    expect(findKatagoBinary(dir)).toBe(join(nested, name))
    expect(findKatagoBinary(temp())).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts`
Expected: FAIL — `Failed to resolve import "./katago-config"` (and the other modules).

- [ ] **Step 3: Implement**

`scripts/setup/katago-config.ts`:
```ts
import type { LockedBuild } from '../../packages/server/src/engine/lock'

export const ANALYSIS_THREADS = 2

export interface AnalysisCfgOptions {
  logDir: string
  searchThreadsPerAnalysisThread: number
}

export function analysisConfigText(o: AnalysisCfgOptions): string {
  return [
    '# Generated by `npm run setup` (joseki-dojo). Search limits are set per query.',
    `logDir = ${o.logDir.replaceAll('\\', '/')}`,
    'reportAnalysisWinratesAs = BLACK',
    `numAnalysisThreads = ${ANALYSIS_THREADS}`,
    `numSearchThreadsPerAnalysisThread = ${o.searchThreadsPerAnalysisThread}`,
    'nnCacheSizePowerOfTwo = 21',
    'nnMutexPoolSizePowerOfTwo = 17',
    'nnRandomize = true',
    '',
  ].join('\n')
}

/** CPU: split the logical cores between the analysis threads; GPU: 8 search threads per analysis thread. */
export function searchThreadsFor(kind: LockedBuild['kind'], logicalCores: number): number {
  return kind === 'cpu' ? Math.max(1, Math.floor(logicalCores / ANALYSIS_THREADS)) : 8
}
```

`scripts/setup/calibrate.ts`:
```ts
import type { Move } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../../packages/server/src/engine/engine'
import { baseQuery } from '../../packages/server/src/engine/query'

/** Spec 6.4: about `seconds` per reviewed position; the end check uses half of that. */
export function visitsForBudget(visitsPerSecond: number, seconds = 2): { reviewVisits: number; endVisits: number } {
  const to50 = (n: number): number => Math.round(n / 50) * 50
  const reviewVisits = Math.min(5000, Math.max(100, to50(visitsPerSecond * seconds)))
  const endVisits = Math.min(2500, Math.max(50, to50(reviewVisits / 2)))
  return { reviewVisits, endVisits }
}

const SAMPLE: Move[] = [
  { color: 'B', vertex: [15, 3] },
  { color: 'W', vertex: [3, 15] },
  { color: 'B', vertex: [2, 3] },
  { color: 'W', vertex: [16, 5] },
]

export async function measureVisitsPerSecond(engine: AnalysisEngine, visits = 800): Promise<number> {
  // Warm up on a different position so the timed search does not hit the NN cache (and OpenCL is tuned).
  await engine.analyze({ ...baseQuery([]), maxVisits: 100 })
  const started = performance.now()
  const r = await engine.analyze({ ...baseQuery(SAMPLE), maxVisits: visits })
  const seconds = (performance.now() - started) / 1000
  return r.rootInfo.visits / Math.max(seconds, 0.001)
}
```

`scripts/setup/download.ts`:
```ts
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import extractZip from 'extract-zip'

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(
    createReadStream(file),
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        hash.update(chunk)
        done()
      },
    }),
  )
  return hash.digest('hex')
}

/** Downloads `url` to `dest` and accepts it only if its SHA-256 matches; an existing file is re-checked instead. */
export async function download(url: string, dest: string, sha256: string, log: (line: string) => void = console.log): Promise<void> {
  const name = basename(dest)
  if (existsSync(dest)) {
    if ((await sha256File(dest)) !== sha256) {
      throw new Error(`${name}: контрольная сумма не совпадает с katago.lock.json (файл повреждён или другой версии). Удалите его и запустите setup снова.`)
    }
    log(`Уже скачано и проверено: ${name}`)
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  log(`Скачиваю ${url}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать ${url}: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const hash = createHash('sha256')
  let received = 0
  let shown = -1
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      received += chunk.length
      const pct = total > 0 ? Math.floor((received / total) * 100) : -1
      if (pct >= 0 && pct % 10 === 0 && pct !== shown) {
        shown = pct
        log(`  ${name}: ${pct}%`)
      }
      done(null, chunk)
    },
  })
  const partial = `${dest}.part`
  await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), meter, createWriteStream(partial))
  const actual = hash.digest('hex')
  if (actual !== sha256) {
    rmSync(partial, { force: true })
    throw new Error(`${name}: SHA-256 ${actual} не совпадает с katago.lock.json (${sha256})`)
  }
  renameSync(partial, dest)
}

export async function unzip(zipFile: string, dir: string): Promise<void> {
  await extractZip(zipFile, { dir: resolve(dir) })
}

/** Finds the KataGo executable anywhere under `dir`. */
export function findKatagoBinary(dir: string): string | null {
  const name = process.platform === 'win32' ? 'katago.exe' : 'katago'
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const found = findKatagoBinary(full)
      if (found) return found
    }
  }
  return null
}
```

`scripts/setup/setup.ts`:
```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { KataGoEngine } from '../../packages/server/src/engine/engine'
import { compareVersions, MIN_KATAGO_VERSION } from '../../packages/server/src/engine/health'
import { buildsFor, loadLock, versionWarning, type LockedBuild } from '../../packages/server/src/engine/lock'
import { measureVisitsPerSecond, visitsForBudget } from './calibrate'
import { download, findKatagoBinary, unzip } from './download'
import { analysisConfigText, searchThreadsFor } from './katago-config'

type Json = Record<string, unknown>

const root = fileURLToPath(new URL('../../', import.meta.url))
const configFile = join(root, 'config.local.json')
const enginesDir = join(root, 'engines')

/**
 * Line-queue prompter. Unlike readline's question(), it keeps lines that arrive before the question
 * is asked, so piped answers (`printf '\n1\n\n' | npm run setup`) work. After EOF every answer is ''.
 */
function prompter(): { ask: (question: string) => Promise<string>; close: () => void } {
  const rl = createInterface({ input: process.stdin })
  const lines: string[] = []
  const waiting: ((line: string) => void)[] = []
  let closed = false
  rl.on('line', (line) => {
    const waiter = waiting.shift()
    if (waiter) waiter(line)
    else lines.push(line)
  })
  rl.on('close', () => {
    closed = true
    for (const waiter of waiting.splice(0)) waiter('')
  })
  return {
    ask(question: string): Promise<string> {
      process.stdout.write(question)
      const line = lines.shift()
      if (line !== undefined) return Promise.resolve(line.trim())
      if (closed) return Promise.resolve('')
      return new Promise((done) => waiting.push((l) => done(l.trim())))
    },
    close: () => rl.close(),
  }
}

async function main(): Promise<void> {
  const lock = loadLock()
  const rl = prompter()
  const existing = (existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {}) as Json
  const existingKatago = (existing.katago ?? {}) as Json
  const knownPath = typeof existingKatago.path === 'string' && existsSync(existingKatago.path) ? existingKatago.path : null

  console.log(`Настройка KataGo ${lock.katago.version} для Joseki Dojo (версии из katago.lock.json)\n`)
  const answer = await rl.ask(`Путь к установленной KataGo (Enter — ${knownPath ?? 'скачать проверенную версию'}): `)
  let katagoPath: string
  let kind: LockedBuild['kind']
  if (answer || knownPath) {
    katagoPath = resolve(answer || (knownPath as string))
    if (!existsSync(katagoPath)) throw new Error(`Файл не найден: ${katagoPath}`)
    kind = (await rl.ask('Это CPU-сборка (eigen)? [y/N]: ')).toLowerCase() === 'y' ? 'cpu' : 'gpu'
  } else {
    const options = buildsFor(lock, process.platform)
    if (options.length === 0) throw new Error(`Для ${process.platform} нет готовых сборок KataGo: установите её сами и укажите путь.`)
    options.forEach((b, i) => console.log(`  ${i + 1}) ${b.label}`))
    const build = options[Number(await rl.ask(`Бэкенд [1-${options.length}]: `)) - 1]
    if (!build) throw new Error('Нет такого варианта')
    const zip = join(enginesDir, 'downloads', basename(new URL(build.url).pathname))
    await download(build.url, zip, build.sha256)
    const dir = join(enginesDir, `katago-${lock.katago.version}-${build.id}`)
    await unzip(zip, dir)
    const bin = findKatagoBinary(dir)
    if (!bin) throw new Error(`В архиве нет исполняемого файла KataGo: ${zip}`)
    if (process.platform !== 'win32') chmodSync(bin, 0o755)
    katagoPath = bin
    kind = build.kind
  }
  const customModel = await rl.ask(`Путь к своей основной сети (Enter — ${lock.models.main.file}): `)
  rl.close()

  const mainModel = customModel ? resolve(customModel) : join(enginesDir, 'models', lock.models.main.file)
  if (!customModel) await download(lock.models.main.url, mainModel, lock.models.main.sha256)
  const humanModel = join(enginesDir, 'models', lock.models.human.file)
  await download(lock.models.human.url, humanModel, lock.models.human.sha256)

  const logDir = join(root, 'data', 'katago-logs')
  mkdirSync(logDir, { recursive: true })
  const analysisConfig = join(enginesDir, 'analysis.cfg')
  writeFileSync(analysisConfig, analysisConfigText({ logDir, searchThreadsPerAnalysisThread: searchThreadsFor(kind, availableParallelism()) }))

  console.log('\nЗапускаю KataGo и замеряю скорость. Первый запуск OpenCL может настраиваться несколько минут…')
  const engine = new KataGoEngine(
    { command: katagoPath, args: ['analysis', '-config', analysisConfig, '-model', mainModel, '-human-model', humanModel] },
    (line) => console.log(`  [katago] ${line}`),
  )
  engine.start()
  try {
    const version = await engine.version()
    if (compareVersions(version, MIN_KATAGO_VERSION) < 0) throw new Error(`Нужна KataGo ${MIN_KATAGO_VERSION} или новее, установлена ${version}`)
    const warning = versionWarning(lock, version)
    if (warning) console.log(`\nВнимание: ${warning}`)
    const vps = await measureVisitsPerSecond(engine)
    const visits = visitsForBudget(vps)
    console.log(`Скорость ≈ ${Math.round(vps)} визитов/с → разбор: ${visits.reviewVisits}, проверка конца: ${visits.endVisits} визитов`)
    const { commandOverride: _ignored, ...katagoRest } = existingKatago
    const config = {
      ...existing,
      katago: { ...katagoRest, path: katagoPath, analysisConfig, mainModel, humanModel },
      analysis: { ...((existing.analysis ?? {}) as Json), ...visits },
    }
    writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)
    console.log(`\nГотово: ${configFile}\nЗапуск: npm start`)
  } finally {
    await engine.stop()
  }
}

main().catch((err: unknown) => {
  console.error(`\nОшибка: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run scripts`
Expected: PASS.
Run: `npm test && npm run typecheck`
Expected: all unit tests pass; typecheck exits 0.

- [ ] **Step 5: Milestone commit**

```bash
git add scripts playwright.config.ts e2e
git commit -m "feat: add pinned KataGo setup with checksum verification; add e2e test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Real KataGo verification, README, pull request

**Files:**
- Create: `vitest.katago.config.ts`, `packages/server/test/katago.integration.test.ts`, `README.md`

**Interfaces:**
- Consumes: everything above; a real KataGo installed by `npm run setup`.
- Produces: `npm run test:katago`; the spec 6.5 decision; README; an open PR from `feat/core-free-mode` to `main`.

- [ ] **Step 1: Install KataGo on this machine**

The answers are: Enter (download), `1` (CPU AVX2 — works on any machine; the user can rerun setup with a GPU backend later), Enter (default network).
Run: `printf '\n1\n\n' | npm run setup`
Expected: three downloads (~6 MB zip, ~98 MB and ~99 MB networks), each checked against `katago.lock.json`, `Скорость ≈ … визитов/с → разбор: …`, `Готово: …config.local.json`. If KataGo fails to start, read its lines prefixed `[katago]` and fix the cause before continuing.

- [ ] **Step 2: Write the integration tests**

`vitest.katago.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
})
```

`packages/server/test/katago.integration.test.ts`:
```ts
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { vertexToIndex, type Move } from '@joseki-dojo/shared'
import { loadConfig } from '../src/config'
import { engineCommand } from '../src/engine/command'
import { KataGoEngine } from '../src/engine/engine'
import { checkEngine } from '../src/engine/health'
import { loadLock } from '../src/engine/lock'
import { baseQuery } from '../src/engine/query'

const CONFIG_FILE = fileURLToPath(new URL('../../../config.local.json', import.meta.url))
const configured = existsSync(CONFIG_FILE)

describe.skipIf(!configured)('real KataGo', () => {
  const config = configured ? loadConfig(CONFIG_FILE) : null
  let withHuman: KataGoEngine
  let plain: KataGoEngine

  beforeAll(() => {
    const cmd = engineCommand(config!)
    withHuman = new KataGoEngine(cmd)
    // Same command without the trailing `-human-model <file>`.
    plain = new KataGoEngine({ command: cmd.command, args: cmd.args.slice(0, -2) })
    withHuman.start()
    plain.start()
  })

  afterAll(async () => {
    await withHuman.stop()
    await plain.stop()
  })

  it('passes the startup checks', async () => {
    expect(await checkEngine(config!, withHuman)).toEqual({ state: 'ready', reason: null })
  })

  it('runs the KataGo version pinned in katago.lock.json', async () => {
    expect(await withHuman.version()).toBe(loadLock().katago.version)
  })

  it('reports score and ownership from Black’s point of view even with White to move', async () => {
    const moves: Move[] = [
      { color: 'B', vertex: [3, 15] },
      { color: 'W', vertex: [15, 3] },
      { color: 'B', vertex: [3, 3] },
    ]
    const r = await withHuman.analyze({ ...baseQuery(moves), maxVisits: 100, includeOwnership: true })
    expect(r.rootInfo.currentPlayer).toBe('W')
    expect(r.ownership![vertexToIndex([3, 15])]).toBeGreaterThan(0.3)
    expect(r.ownership![vertexToIndex([15, 3])]).toBeLessThan(-0.3)
  })

  it('returns a normalized human policy with occupied points marked illegal', async () => {
    const r = await withHuman.analyze({
      ...baseQuery([{ color: 'B', vertex: [15, 3] }]),
      maxVisits: 1,
      includePolicy: true,
      overrideSettings: { humanSLProfile: 'rank_7k' },
    })
    expect(r.humanPolicy).toHaveLength(362)
    expect(r.humanPolicy![vertexToIndex([15, 3])]).toBe(-1)
    expect(r.humanPolicy!.filter((p) => p > 0).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2)
  })

  // Spec 6.5: loading -human-model must not change plain analysis beyond search noise.
  it('gives the same plain analysis with and without the human model', async () => {
    const q = { ...baseQuery([{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [16, 5] }]), maxVisits: config!.analysis.reviewVisits }
    const meanLead = async (e: KataGoEngine): Promise<number> => {
      let sum = 0
      for (let i = 0; i < 3; i++) sum += (await e.analyze(q)).rootInfo.scoreLead
      return sum / 3
    }
    const withModel = await meanLead(withHuman)
    const without = await meanLead(plain)
    expect(Math.abs(withModel - without)).toBeLessThan(1)
  })
})
```

- [ ] **Step 3: Run the integration tests**

Run: `npm run test:katago`
Expected: 5 passed.
If only «gives the same plain analysis…» fails: **stop and report to the user** — spec 6.5 then requires a second KataGo process (one for analysis, one for the bot), which changes memory use and the server wiring; do not implement it without their decision. Any other failure is a bug to fix (use superpowers:systematic-debugging).

- [ ] **Step 4: Play a real session**

Start `npm start` in a background shell and open `http://127.0.0.1:5179` in the browser pane. Play one joseki as Black in a random corner against 7 kyu. Check and note in the PR description:
- the bot answers within about a second and plays locally until the joseki has started;
- after the corner settles, «Похоже, дзёсеки закончилось» appears; «Играть дальше» hides it, and it can return after two more moves;
- the review shows non-zero losses for at least some moves, candidates A/B/C on the board, a playable variation and an ownership overlay that matches the stones;
- «Переиграть с этого хода» starts a new session from that position.
Stop the server.

- [ ] **Step 5: Write the README**

`README.md`:
````markdown
# Joseki Dojo

Тренажёр дзёсеки для го. Вы разыгрываете угол против KataGo, который играет «как человек нужного ранга» и поэтому ошибается, как люди. После розыгрыша программа показывает, сколько очков стоил каждый ход, как надо было играть и наказали ли вы ошибки соперника.

Сейчас готов свободный режим на пустой доске. План развития: [спецификация](docs/superpowers/specs/2026-10-06-core-free-mode-design.md), раздел 2.

## Что нужно

- Node.js 22.12 или новее
- Windows или Linux x64. На macOS установите KataGo сами (например, через Homebrew) и укажите путь к нему при настройке.

## Установка и запуск

```bash
npm install
npm run setup   # скачает KataGo и сети (~200 МБ) и подберёт число визитов под этот компьютер
npm start       # затем откройте http://127.0.0.1:5179
```

`npm run setup` можно запускать повторно, например чтобы перейти с CPU на видеокарту. Уже скачанные файлы повторно не качаются.

## Версии KataGo

Проверенные версии KataGo и сетей записаны в `katago.lock.json` вместе с контрольными суммами SHA-256. `npm run setup` качает только их и сверяет суммы. Обновление версии — отдельный PR: правка lock-файла и успешный `npm run test:katago`.

## Настройки

Пути к KataGo и сетям и глубину анализа можно поменять на экране «Настройки». Приложение перезапустит KataGo с новыми путями и проверит его, а при ошибке вернёт прежние пути. Если запущена не та версия KataGo, что в lock-файле, приложение работает, но предупреждает об этом.

Остальное настраивается в `config.local.json` (его создаёт `npm run setup`; образец со значениями по умолчанию — `config.example.json`).

| Поле | Что задаёт |
|---|---|
| `analysis.reviewVisits` / `endVisits` | глубину анализа для разбора и для проверки конца дзёсеки |
| `thresholds` | границы «неточность / ошибка / грубая ошибка» и порог «наказано» (в очках) |
| `bot.defaultRank`, `bot.temperature` | ранг бота по умолчанию и разброс его ходов |
| `maxSessionMoves` | предохранитель: после стольких ходов игра переходит к разбору |

## Разработка

```bash
npm run dev          # сервер и Vite с перезагрузкой: http://127.0.0.1:5173
npm test             # юнит-тесты
npm run typecheck
npm run e2e          # сквозной тест в браузере с поддельным KataGo (один раз: npx playwright install chromium)
npm run test:katago  # проверки с настоящим KataGo (нужен config.local.json)
```

## Лицензия

MIT. KataGo и его сети в репозиторий не входят: `npm run setup` скачивает их с GitHub и katagotraining.org, у них собственные лицензии.
````

- [ ] **Step 6: Full verification and commit**

Run: `npm test && npm run typecheck && npm run e2e && npm run test:katago`
Expected: everything passes.

```bash
git add vitest.katago.config.ts packages/server/test/katago.integration.test.ts README.md
git commit -m "test: verify against a real KataGo; add README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Push and open the pull request (confirm with the user first)**

```bash
git push -u origin feat/core-free-mode
```
```bash
gh pr create --base main --head feat/core-free-mode --title "Core: free mode joseki trainer" --body-file -
```
Body: what was built, the Task 20 Step 4 observations, the spec 6.5 result, how to run; end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge — merging is the user's.

---

## Spec coverage

| Spec section | Tasks |
|---|---|
| 3 Scope (free mode, empty board, review, replay, storage, setup, lock, settings) | 7, 12, 13, 14a, 15–17a, 19 |
| 4 Terms (zone, tenuki, joseki started, numbering) | 2, 10 |
| 5 Architecture (packages, modules, protocol) | 1–14a |
| 6.1–6.3 KataGo requirements, launch, queries | 5, 6, 8, 9, 12 |
| 6.4 Setup | 19, 20 |
| 6.5 Human model check | 20 |
| 6.6 Version pinning | 14a, 19, 20 |
| 7 Start screen | 15 |
| 7a Settings screen | 14a, 17a, 18 |
| 8.1–8.5 Board, start, user tenuki, bot move, end of joseki | 8, 10, 12, 16 |
| 9.1–9.6 Analysis, loss, thresholds, review screen, punishment, replay | 9, 11, 12, 13, 17 |
| 10 Storage | 7 |
| 11 Failure handling | 5, 6, 12, 14, 14a, 15 |
| 12 Testing | every task; e2e 18; real engine 20 |
| 13 Hooks for parts 2–4 | 7 (`missed_punishments`, `mode`), 11 (`ReviewData` facts), 12 (`initialMoves`) |
