# Thresholds Calibration Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run thresholds:gpu` saves every finished position to `.gpu-runs/thresholds.jsonl` and the same command continues an interrupted run from that save (spec `docs/superpowers/specs/2026-10-23-thresholds-resume-design.md`).

**Architecture:** A new module `scripts/thresholds/checkpoint.ts` owns the save file: the JSON Lines format, reading with torn-line recovery and damage checks, an append-only writer that flushes every line to the disk, the comparison with the current run, and removal. `scripts/thresholds/calibrate-steps.ts` gains `--restart`, a resumable `calibrate`, `prepareCalibration` (sampling and the save check before KataGo starts) and a `runCalibration` that writes, continues and removes the save. `scripts/thresholds/gpu.ts` wires them.

**Tech Stack:** TypeScript (tsx), Node `fs`, Vitest.

## Global Constraints

- The save is `.gpu-runs/thresholds.jsonl` relative to the repository root; `.gpu-runs/` is in `.gitignore`. Never under `packages/server/bases/`.
- JSON Lines, every line ends with `\n`. First line: `{ version: 1, options: { positions, visits, seed, coverage }, ids, levels, code, katago }` (`code` from Task 3). Each next line: `{ i, evaluated, seconds, samples }`, `samples` = per level (in `levels` order) a list of `[loss, weight]` pairs. Numbers are written unrounded.
- The header is written before the first position; every position is appended as soon as it is done and flushed with `fsync`; the file is never rewritten except when a run from the start replaces it with its header.
- Reading (Tasks 1–2; Task 3 replaces it after the final review): a last line without `\n` or that is not JSON is dropped and cut off the file; a file without a whole first line is no save; any other damage (unreadable header, a non-JSON line before the last, `i` out of order, a column count other than the level count, a position beyond `ids`) refuses with `The saved run in .gpu-runs/thresholds.jsonl is damaged (<why>). Add --restart to start over.`
- Reading (Task 3, owner decision 5): the sound beginning is kept — the header and the positions after it in order — and the first unsound line and everything after it are cut off the file, with `Dropped N damaged line(s) from the end of the save: their positions are computed again.` when at least one whole line was cut; only a whole first line that is not a run description refuses.
- The calibration code (Task 3, owner decision 4): the header's `code` is `git log -1 --format=%H -- scripts packages/server/src packages/shared/src packages/server/bases/starts.jdb`; another `code` refuses with `the calibration code differs (<7 chars> → <7 chars>)`. A save without positions is no save.
- A save of the same run is continued automatically. `options`, `ids`, `levels` (and `code`, Task 3) are compared before KataGo starts; `katago` after the KataGo check and before the first position. A mismatch refuses with `The saved run in .gpu-runs/thresholds.jsonl differs: <differences>. Run with the same options to continue, or add --restart to start over.` — differences like `visits 2000 → 500`, `the sampled positions differ`, `the levels differ`, `<saved katago> → <current katago>`.
- `--restart` is a flag without a value: the run starts from the first position without reading the save; the old save is replaced only when the new run writes its header (after the KataGo check).
- On continue, log `Continuing the saved run: <saved>/<total> positions done`. When the calibration fails, log `<saved>/<total> positions are saved in .gpu-runs/thresholds.jsonl: run the same command to continue.` and rethrow the original error.
- After `thresholds.json` is written and committed (or nothing changed), the save is deleted; if writing or committing fails, the save stays.
- Progress lines keep their format; «about N min left» uses the speed of this run only (positions computed since this start). The report's minutes are the sum of `seconds` over all saved and new positions.
- Unchanged: the sampling, the moves to evaluate, losses, shares, smoothing, `thresholds.json`, the git checks, the speed, `npm run tree:gpu`.
- Script logs are English. `docs/gpu-calibration.md` and the specs are Russian; README is English.
- Commits use the repository identity (the GitHub noreply address in `.git/config`).

## File Structure

- Create `scripts/thresholds/checkpoint.ts` — the save: types, `readCheckpoint`, `CheckpointWriter`, `runDifferences`, `differsMessage`, `removeCheckpoint`.
- Create `scripts/thresholds/checkpoint.test.ts`.
- Modify `scripts/thresholds/calibrate-steps.ts` — `--restart`, resumable `calibrate`, `prepareCalibration`, `runCalibration` with the save.
- Modify `scripts/thresholds/calibrate-steps.test.ts`.
- Modify `scripts/thresholds/gpu.ts`.
- Modify `.gitignore`, `README.md`, `docs/gpu-calibration.md`, `docs/superpowers/specs/2026-10-15-repetition-design.md`.

Setup (once, before Task 1): the worktree `D:\projects\joseki-dojo-resume` has no `node_modules`; run `npm ci` there.

---

### Task 1: The save file

**Files:**
- Create: `scripts/thresholds/checkpoint.ts`
- Test: `scripts/thresholds/checkpoint.test.ts`

**Interfaces:**
- Produces (used by Task 2):
  - `CHECKPOINT_FILE = '.gpu-runs/thresholds.jsonl'`
  - `interface RunOptions { positions: number; visits: number; seed: number; coverage: number }`
  - `interface RunIdentity { options: RunOptions; ids: string[]; levels: string[] }`
  - `interface RunHeader extends RunIdentity { version: 1; katago: string }`
  - `interface SavedPosition { i: number; evaluated: number; seconds: number; samples: [number, number][][] }`
  - `interface Checkpoint { header: RunHeader; positions: SavedPosition[] }`
  - `readCheckpoint(root: string): Checkpoint | null`
  - `class CheckpointWriter { static start(root: string, header: RunHeader): CheckpointWriter; static append(root: string): CheckpointWriter; add(position: SavedPosition): void; close(): void }`
  - `runDifferences(saved: RunHeader, identity: RunIdentity): string[]`
  - `differsMessage(differences: readonly string[]): string`
  - `removeCheckpoint(root: string): void`

- [ ] **Step 1: Write the failing tests**

Create `scripts/thresholds/checkpoint.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHECKPOINT_FILE, CheckpointWriter, differsMessage, readCheckpoint, removeCheckpoint, runDifferences, type RunHeader, type SavedPosition } from './checkpoint'

const HEADER: RunHeader = {
  version: 1,
  options: { positions: 3, visits: 10, seed: 1, coverage: 0.98 },
  ids: ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'],
  levels: ['20k', 'pro'],
  katago: 'KataGo 1.18.1; networks: main.bin.gz, human.bin.gz',
}
const position = (i: number): SavedPosition => ({ i, evaluated: 2, seconds: 1.5, samples: [[[0, 0.7], [3, 0.3]], [[0, 1]]] })
const root = (): string => mkdtempSync(join(tmpdir(), 'joseki-checkpoint-'))
const file = (r: string): string => join(r, CHECKPOINT_FILE)
const write = (r: string, text: string): void => {
  mkdirSync(dirname(file(r)), { recursive: true })
  writeFileSync(file(r), text)
}
const line = (x: unknown): string => `${JSON.stringify(x)}\n`

describe('the save of a thresholds run', () => {
  it('writes the description first, then one line per position, and reads them back', () => {
    const r = root()
    const w = CheckpointWriter.start(r, HEADER)
    w.add(position(0))
    w.add(position(1))
    w.close()
    expect(readFileSync(file(r), 'utf8')).toBe(line(HEADER) + line(position(0)) + line(position(1)))
    expect(readCheckpoint(r)).toEqual({ header: HEADER, positions: [position(0), position(1)] })
  })

  it('appends to a save it continues and replaces the save when a run starts from the beginning', () => {
    const r = root()
    const w = CheckpointWriter.start(r, HEADER)
    w.add(position(0))
    w.close()
    const more = CheckpointWriter.append(r)
    more.add(position(1))
    more.close()
    expect(readCheckpoint(r)?.positions).toEqual([position(0), position(1)])
    CheckpointWriter.start(r, { ...HEADER, katago: 'other' }).close()
    expect(readCheckpoint(r)).toEqual({ header: { ...HEADER, katago: 'other' }, positions: [] })
  })

  it('has no save without the file or without a whole first line', () => {
    const r = root()
    expect(readCheckpoint(r)).toBeNull()
    write(r, line(HEADER).slice(0, 20))
    expect(readCheckpoint(r)).toBeNull()
  })

  it('drops a torn last line and cuts it off the file', () => {
    const r = root()
    const whole = line(HEADER) + line(position(0))
    write(r, whole + line(position(1)).slice(0, 15))
    expect(readCheckpoint(r)?.positions).toEqual([position(0)])
    expect(readFileSync(file(r), 'utf8')).toBe(whole)
    write(r, `${whole}{"i":1,\n`)
    expect(readCheckpoint(r)?.positions).toEqual([position(0)])
    expect(readFileSync(file(r), 'utf8')).toBe(whole)
  })

  it('refuses any other damage', () => {
    const r = root()
    write(r, `${line(HEADER)}nonsense\n${line(position(1))}`)
    expect(() => readCheckpoint(r)).toThrow('The saved run in .gpu-runs/thresholds.jsonl is damaged (line 2 is not JSON). Add --restart to start over.')
    write(r, line(HEADER) + line(position(1)))
    expect(() => readCheckpoint(r)).toThrow('(line 2 has the position 1, not 0)')
    write(r, line(HEADER) + line({ ...position(0), samples: [[[0, 1]]] }))
    expect(() => readCheckpoint(r)).toThrow('(line 2 is not a position of 2 levels)')
    write(r, line({ version: 2 }) + line(position(0)))
    expect(() => readCheckpoint(r)).toThrow('(the first line is not a run description)')
    write(r, line({ ...HEADER, ids: ['aaaaaaaa'] }) + line(position(0)) + line(position(1)))
    expect(() => readCheckpoint(r)).toThrow('(line 3 has the position 1 beyond the 1 sampled)')
  })

  it('names what differs from the saved run', () => {
    const identity = { options: HEADER.options, ids: HEADER.ids, levels: HEADER.levels }
    expect(runDifferences(HEADER, identity)).toEqual([])
    expect(runDifferences(HEADER, { ...identity, options: { ...HEADER.options, visits: 500 } })).toEqual(['visits 10 → 500'])
    expect(runDifferences(HEADER, { ...identity, ids: ['aaaaaaaa'], levels: ['20k'] })).toEqual(['the sampled positions differ', 'the levels differ'])
    expect(differsMessage(['visits 10 → 500'])).toBe(
      'The saved run in .gpu-runs/thresholds.jsonl differs: visits 10 → 500. Run with the same options to continue, or add --restart to start over.',
    )
  })

  it('removes the save, and does nothing without one', () => {
    const r = root()
    CheckpointWriter.start(r, HEADER).close()
    removeCheckpoint(r)
    expect(existsSync(file(r))).toBe(false)
    removeCheckpoint(r)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/thresholds/checkpoint.test.ts`
Expected: FAIL — `Failed to resolve import "./checkpoint"`.

- [ ] **Step 3: Write the module**

Create `scripts/thresholds/checkpoint.ts`:

```ts
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, truncateSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Spec (thresholds resume) 2: the save of a thresholds run. JSON Lines: the run's description first, then one line per
// finished position, appended and flushed to the disk one by one, so that a power cut loses at most the line being written.

/** The save of the thresholds run, relative to the repository root (`.gpu-runs/` is ignored by git). */
export const CHECKPOINT_FILE = '.gpu-runs/thresholds.jsonl'

/** The options that change the result of a run. */
export interface RunOptions {
  positions: number
  visits: number
  seed: number
  coverage: number
}

/** What makes two runs the same run, apart from KataGo: the options, the sampled starts and the level columns. */
export interface RunIdentity {
  options: RunOptions
  ids: string[]
  levels: string[]
}

/** Spec 2.2: the first line. */
export interface RunHeader extends RunIdentity {
  version: 1
  /** KataGo version and network names, as in the report. */
  katago: string
}

/** Spec 2.2: one finished position — its index in `ids`, the moves evaluated, the seconds it took and its [loss, weight] pairs per level. */
export interface SavedPosition {
  i: number
  evaluated: number
  seconds: number
  samples: [number, number][][]
}

export interface Checkpoint {
  header: RunHeader
  positions: SavedPosition[]
}

const NEWLINE = 0x0a
const BAD = Symbol('not JSON')

const parse = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return BAD
  }
}

const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string')
const isPair = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && isNumber(x[0]) && isNumber(x[1])

function asHeader(value: unknown): RunHeader | null {
  if (typeof value !== 'object' || value === null) return null
  const h = value as Record<string, unknown>
  const o = h.options
  if (h.version !== 1 || typeof o !== 'object' || o === null) return null
  const { positions, visits, seed, coverage } = o as Record<string, unknown>
  if (!isNumber(positions) || !isNumber(visits) || !isNumber(seed) || !isNumber(coverage)) return null
  if (!isStrings(h.ids) || !isStrings(h.levels) || typeof h.katago !== 'string') return null
  return { version: 1, options: { positions, visits, seed, coverage }, ids: h.ids, levels: h.levels, katago: h.katago }
}

function asPosition(value: unknown, levels: number): SavedPosition | null {
  if (typeof value !== 'object' || value === null) return null
  const { i, evaluated, seconds, samples } = value as Record<string, unknown>
  if (!isNumber(i) || !isNumber(evaluated) || !isNumber(seconds) || !Array.isArray(samples) || samples.length !== levels) return null
  if (!samples.every((s: unknown) => Array.isArray(s) && s.every(isPair))) return null
  return { i, evaluated, seconds, samples: samples as [number, number][][] }
}

const damaged = (why: string): Error => new Error(`The saved run in ${CHECKPOINT_FILE} is damaged (${why}). Add --restart to start over.`)

/**
 * Spec 2.4: the save in `root`, or null when there is none or it has no whole first line. A torn last line (no newline
 * at its end, or not JSON) is dropped and cut off the file; any other damage throws.
 */
export function readCheckpoint(root: string): Checkpoint | null {
  const path = join(root, CHECKPOINT_FILE)
  if (!existsSync(path)) return null
  const data = readFileSync(path)
  // Only the lines that end with a newline are whole; a whole last line that is not JSON was cut by a power loss too.
  const lines = data.subarray(0, data.lastIndexOf(NEWLINE) + 1).toString('utf8').split('\n').slice(0, -1)
  if (lines.length > 0 && parse(lines[lines.length - 1]) === BAD) lines.pop()
  const whole = Buffer.byteLength(lines.map((l) => `${l}\n`).join(''))
  if (whole < data.length) truncateSync(path, whole)
  if (lines.length === 0) return null
  const [first, ...rest] = lines.map(parse)
  const header = asHeader(first)
  if (!header) throw damaged('the first line is not a run description')
  const positions = rest.map((value, k) => {
    const at = k + 2
    if (value === BAD) throw damaged(`line ${at} is not JSON`)
    const p = asPosition(value, header.levels.length)
    if (!p) throw damaged(`line ${at} is not a position of ${header.levels.length} levels`)
    if (p.i !== k) throw damaged(`line ${at} has the position ${p.i}, not ${k}`)
    if (p.i >= header.ids.length) throw damaged(`line ${at} has the position ${p.i} beyond the ${header.ids.length} sampled`)
    return p
  })
  return { header, positions }
}

/** Spec 2.3: appends lines to the save, each flushed to the disk before the next position starts. */
export class CheckpointWriter {
  private constructor(private readonly fd: number) {}

  /** A new save with the run's description; it replaces any old one. */
  static start(root: string, header: RunHeader): CheckpointWriter {
    const path = join(root, CHECKPOINT_FILE)
    mkdirSync(dirname(path), { recursive: true })
    const writer = new CheckpointWriter(openSync(path, 'w'))
    writer.line(header)
    return writer
  }

  /** The save that readCheckpoint returned, to append the next positions to. */
  static append(root: string): CheckpointWriter {
    return new CheckpointWriter(openSync(join(root, CHECKPOINT_FILE), 'a'))
  }

  add(position: SavedPosition): void {
    this.line(position)
  }

  close(): void {
    closeSync(this.fd)
  }

  private line(value: RunHeader | SavedPosition): void {
    writeSync(this.fd, `${JSON.stringify(value)}\n`)
    fsyncSync(this.fd)
  }
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, k) => x === b[k])

/** Spec 3.3: what differs between the saved run and this one, apart from KataGo (compared once it has started). */
export function runDifferences(saved: RunHeader, identity: RunIdentity): string[] {
  const out: string[] = []
  for (const key of ['positions', 'visits', 'seed', 'coverage'] as const) {
    if (saved.options[key] !== identity.options[key]) out.push(`${key} ${saved.options[key]} → ${identity.options[key]}`)
  }
  if (!sameList(saved.ids, identity.ids)) out.push('the sampled positions differ')
  if (!sameList(saved.levels, identity.levels)) out.push('the levels differ')
  return out
}

/** Spec 3.3: the refusal for a save of another run. */
export const differsMessage = (differences: readonly string[]): string =>
  `The saved run in ${CHECKPOINT_FILE} differs: ${differences.join('; ')}. Run with the same options to continue, or add --restart to start over.`

/** Spec 3.6: deletes the save (nothing to do without one). */
export function removeCheckpoint(root: string): void {
  rmSync(join(root, CHECKPOINT_FILE), { force: true })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/thresholds/checkpoint.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — Expected: no output errors.

```bash
git add scripts/thresholds/checkpoint.ts scripts/thresholds/checkpoint.test.ts
git commit -m "wip: the save of a thresholds run"
```

---

### Task 2: Resume the calibration from the save

**Files:**
- Modify: `scripts/thresholds/calibrate-steps.ts` (whole file below)
- Modify: `scripts/thresholds/gpu.ts:1-17`
- Test: `scripts/thresholds/calibrate-steps.test.ts`
- Modify: `.gitignore`, `README.md:147,149,158`, `docs/gpu-calibration.md:23,33,41`, `docs/superpowers/specs/2026-10-15-repetition-design.md:53`

**Interfaces:**
- Consumes (Task 1): `CHECKPOINT_FILE`, `CheckpointWriter`, `readCheckpoint`, `removeCheckpoint`, `runDifferences`, `differsMessage`, types `Checkpoint`, `RunIdentity`, `RunOptions`, `SavedPosition` from `./checkpoint`.
- Produces:
  - `interface CalibrateOptions extends RunOptions { restart: boolean }`; `parseCalibrateOptions(args)` accepts `--restart`.
  - `interface CalibrateResume { saved: readonly SavedPosition[]; onPosition: (position: SavedPosition) => void }`
  - `calibrate(engine, positions, opts: RunOptions, log, resume?: CalibrateResume): Promise<Calibration>`; `Calibration` gains `seconds: number`.
  - `interface PreparedCalibration { positions: Move[][]; identity: RunIdentity; saved: Checkpoint | null }`
  - `prepareCalibration(root: string, opts: CalibrateOptions): PreparedCalibration`
  - `CalibrationRun` gains `prepared: PreparedCalibration`; `runCalibration` no longer loads the starts itself.

- [ ] **Step 1: Write the failing tests**

In `scripts/thresholds/calibrate-steps.test.ts`:

1. Replace the imports at the top of the file with:

```ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { humanProfile, indexToVertex, PLAYER_LEVELS, type Move } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { EngineError } from '../../packages/server/src/engine/engine'
import { encodeJdb } from '../../packages/server/src/jdb'
import { testStartsTree } from '../../packages/server/src/starts/fixture'
import {
  calibrate,
  exceedThreshold,
  gitProblem,
  movesToEvaluate,
  parseCalibrateOptions,
  prepareCalibration,
  runCalibration,
  sample,
  smooth,
  STARTS_FILE,
  THRESHOLDS_FILE,
  type CalibrateOptions,
  type PreparedCalibration,
} from './calibrate-steps'
import { CHECKPOINT_FILE, CheckpointWriter, readCheckpoint, type RunIdentity, type SavedPosition } from './checkpoint'
```

2. Replace the first test of `describe('calibration helpers')` (`'reads the options over the defaults'`) with:

```ts
  it('reads the options over the defaults', () => {
    expect(parseCalibrateOptions([])).toEqual({ positions: 400, visits: 2000, seed: 1, coverage: 0.98, restart: false })
    expect(parseCalibrateOptions(['--positions', '50', '--visits', '500', '--seed', '7'])).toEqual({ positions: 50, visits: 500, seed: 7, coverage: 0.98, restart: false })
    expect(parseCalibrateOptions(['--restart', '--visits', '500'])).toEqual({ positions: 400, visits: 500, seed: 1, coverage: 0.98, restart: true })
    expect(parseCalibrateOptions(['--visits', '500', '--restart'])).toMatchObject({ visits: 500, restart: true })
    expect(() => parseCalibrateOptions(['--level', '5k'])).toThrow('Unknown option --level')
    expect(() => parseCalibrateOptions(['--visits'])).toThrow('--visits needs a value')
    expect(() => parseCalibrateOptions(['--visits', '0'])).toThrow('--visits needs a positive whole number')
  })
```

3. Append at the end of the file:

```ts
type Query = { moves: [string, string][]; includePolicy?: boolean }
const humanPolicy = (...head: number[]): number[] => [...head, ...new Array(362 - head.length).fill(0)]
/** The first query of a position: its root search (no policy, and the last move is not one of the evaluated A19 / B19). */
const isRoot = (q: Query): boolean => !q.includePolicy && !['A19', 'B19'].includes(q.moves[q.moves.length - 1]?.[1] ?? '')

/**
 * Every level plays index 0 (A19) with 0.7 and index 1 (B19) with 0.3; B19 loses as many points as there are moves
 * once it is played. `onRoot` sees the number of moves of each position at its root query and may throw.
 */
function lossEngine({ queries = [], onRoot }: { queries?: Query[]; onRoot?: (moves: number) => void } = {}) {
  return {
    analyze: async (q: Query) => {
      queries.push(q)
      if (isRoot(q)) onRoot?.(q.moves.length)
      if (q.includePolicy) return { humanPolicy: humanPolicy(0.7, 0.3), rootInfo: { scoreLead: 0 }, moveInfos: [] }
      return { rootInfo: { scoreLead: q.moves[q.moves.length - 1]?.[1] === 'B19' ? -q.moves.length : 0 }, moveInfos: [] }
    },
  }
}

const m = (color: 'B' | 'W', index: number): Move => ({ color, vertex: indexToVertex(index) })
/** Three positions with Black to move: B19 loses 1, 3 and 5 points; the table of all three is 1 / 3 / 5 at every level. */
const POSITIONS: Move[][] = [[], [m('B', 100), m('W', 120)], [m('B', 100), m('W', 120), m('B', 140), m('W', 160)]]
const TABLE = { inaccuracy: 1, mistake: 3, blunder: 5 }
const RUN_OPTS: CalibrateOptions = { positions: 3, visits: 1, seed: 1, coverage: 0.98, restart: false }
const IDENTITY: RunIdentity = { options: { positions: 3, visits: 1, seed: 1, coverage: 0.98 }, ids: ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'], levels: [...PLAYER_LEVELS] }
const ENGINE_INFO = 'KataGo 1.18.1; networks: main.bin.gz, human.bin.gz'
const columns = (pairs: [number, number][]): [number, number][][] => PLAYER_LEVELS.map(() => pairs)

describe('calibrate, resumed', () => {
  it('pools the saved positions, asks only for the rest and gives the table of a run without a break', async () => {
    const saved: SavedPosition[] = []
    const straight = await calibrate(lossEngine() as never, POSITIONS, RUN_OPTS, () => {}, { saved: [], onPosition: (p) => saved.push(p) })
    expect(straight.levels['20k']).toEqual(TABLE)
    expect(saved.map((p) => p.i)).toEqual([0, 1, 2])
    expect(saved[1]).toMatchObject({ evaluated: 2, samples: columns([[0, 0.7], [3, 0.3]]) })

    const queries: Query[] = []
    const added: SavedPosition[] = []
    const resumed = await calibrate(lossEngine({ queries }) as never, POSITIONS, RUN_OPTS, () => {}, { saved: saved.slice(0, 2), onPosition: (p) => added.push(p) })
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.every((q) => q.moves.length >= 4)).toBe(true) // only the third position was asked
    expect(added.map((p) => p.i)).toEqual([2])
    expect(resumed).toEqual({ ...straight, seconds: resumed.seconds })
  })

  it('adds the seconds of the saved positions and estimates the rest by the speed of this run', async () => {
    const positions: Move[][] = Array.from({ length: 21 }, () => [])
    const saved = Array.from({ length: 19 }, (_, i): SavedPosition => ({ i, evaluated: 2, seconds: 600, samples: columns([[0, 0.7], [1, 0.3]]) }))
    const lines: string[] = []
    const { seconds } = await calibrate(lossEngine() as never, positions, RUN_OPTS, (l) => lines.push(l), { saved, onPosition: () => {} })
    expect(seconds).toBeGreaterThanOrEqual(19 * 600)
    expect(seconds).toBeLessThan(19 * 600 + 10)
    // By the saved seconds the 21st position would be «about 10 min left»; this run's own speed says 0.
    expect(lines).toEqual(['  20/21 positions, 0 min, about 0 min left', '  21/21 positions, 0 min, about 0 min left'])
  })
})

describe('runCalibration with the save', () => {
  const lineCount = (root: string): number => (existsSync(join(root, CHECKPOINT_FILE)) ? readFileSync(join(root, CHECKPOINT_FILE), 'utf8').split('\n').length - 1 : 0)
  const prepared = (root: string): PreparedCalibration => ({ positions: POSITIONS, identity: IDENTITY, saved: readCheckpoint(root) })
  const run = (root: string, engine: unknown, lines: string[] = [], opts: CalibrateOptions = RUN_OPTS) =>
    runCalibration({ root, engine: engine as never, opts, engineInfo: ENGINE_INFO, log: (l) => lines.push(l), prepared: opts.restart ? { ...prepared(root), saved: null } : prepared(root) })
  const table = (root: string): { levels: Record<string, unknown> } => JSON.parse(readFileSync(join(root, THRESHOLDS_FILE), 'utf8'))
  /** Saves the first `n` positions of a run with ENGINE_INFO, as an interrupted run would. */
  async function saveFirst(root: string, n: number, seconds?: number): Promise<void> {
    const save = CheckpointWriter.start(root, { version: 1, ...IDENTITY, katago: ENGINE_INFO })
    await calibrate(lossEngine() as never, POSITIONS.slice(0, n), RUN_OPTS, () => {}, { saved: [], onPosition: (p) => save.add(seconds === undefined ? p : { ...p, seconds }) })
    save.close()
  }

  it('saves every finished position at once and removes the save after the commit', async () => {
    const root = repo()
    const seen: number[] = []
    const out = await run(root, lossEngine({ onRoot: () => seen.push(lineCount(root)) }))
    expect(seen).toEqual([1, 2, 3]) // the description, then one more line per finished position
    expect(out.committed).toBe(true)
    expect(table(root).levels['20k']).toEqual(TABLE)
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe(THRESHOLDS_FILE)
    expect(existsSync(join(root, CHECKPOINT_FILE))).toBe(false)
  })

  it('keeps the finished positions when KataGo fails and continues from them with the table of a run without a break', async () => {
    const root = repo()
    const head = git(root, 'rev-parse', 'HEAD')
    const lines: string[] = []
    const failing = lossEngine({
      onRoot: (moves) => {
        if (moves === 4) throw new EngineError({ key: 'error.engine.stopped' }, 'engine_failed')
      },
    })
    await expect(run(root, failing, lines)).rejects.toThrow(EngineError)
    expect(lines).toContain('2/3 positions are saved in .gpu-runs/thresholds.jsonl: run the same command to continue.')
    expect(readCheckpoint(root)?.positions.map((p) => p.i)).toEqual([0, 1])
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)

    const queries: Query[] = []
    const again: string[] = []
    expect((await run(root, lossEngine({ queries }), again)).committed).toBe(true)
    expect(again).toContain('Continuing the saved run: 2/3 positions done')
    expect(queries.every((q) => q.moves.length >= 4)).toBe(true)
    const straight = repo()
    await run(straight, lossEngine())
    expect(table(root).levels).toEqual(table(straight).levels)
    expect(existsSync(join(root, CHECKPOINT_FILE))).toBe(false)
  })

  it('refuses a save made with another KataGo before any position', async () => {
    const root = repo()
    const old = 'KataGo 1.17.0; networks: old.bin.gz, human.bin.gz'
    CheckpointWriter.start(root, { version: 1, ...IDENTITY, katago: old }).close()
    const queries: Query[] = []
    await expect(run(root, lossEngine({ queries }))).rejects.toThrow(`differs: ${old} → ${ENGINE_INFO}. Run with the same options to continue, or add --restart to start over.`)
    expect(queries).toEqual([])
    expect(readCheckpoint(root)?.header.katago).toBe(old)
  })

  it('commits at once when every position is saved', async () => {
    const root = repo()
    await saveFirst(root, 3)
    const queries: Query[] = []
    expect((await run(root, lossEngine({ queries }))).committed).toBe(true)
    expect(queries).toEqual([])
    expect(table(root).levels['20k']).toEqual(TABLE)
    expect(existsSync(join(root, CHECKPOINT_FILE))).toBe(false)
  })

  it('keeps the save when the commit fails', async () => {
    const root = repo()
    writeFileSync(join(root, '.git', 'index.lock'), '')
    await expect(run(root, lossEngine())).rejects.toThrow('may already be written')
    expect(readCheckpoint(root)?.positions).toHaveLength(3)
  })

  it('starts over with --restart and replaces the save only once KataGo is ready', async () => {
    const root = repo()
    CheckpointWriter.start(root, { version: 1, ...IDENTITY, options: { ...IDENTITY.options, visits: 500 }, katago: 'old' }).close()
    const headers: (string | undefined)[] = []
    const out = await run(root, lossEngine({ onRoot: () => headers.push(readCheckpoint(root)?.header.katago) }), [], { ...RUN_OPTS, restart: true })
    expect(out.committed).toBe(true)
    expect(headers).toEqual([ENGINE_INFO, ENGINE_INFO, ENGINE_INFO])
    expect(existsSync(join(root, CHECKPOINT_FILE))).toBe(false)
  })

  it('reports the time of every run of the calibration', async () => {
    const root = repo()
    await saveFirst(root, 2, 600)
    const lines: string[] = []
    await run(root, lossEngine(), lines)
    expect(lines.find((l) => l.startsWith('Positions 3,'))).toMatch(/, 20\.0 minutes$/)
  })
})

describe('prepareCalibration', () => {
  const OPTIONS: CalibrateOptions = { positions: 2, visits: 10, seed: 1, coverage: 0.98, restart: false }
  /** A folder with the test starts base (three starts) at STARTS_FILE. */
  function startsRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'joseki-prepare-'))
    mkdirSync(dirname(join(root, STARTS_FILE)), { recursive: true })
    writeFileSync(join(root, STARTS_FILE), encodeJdb(testStartsTree()))
    return root
  }

  it('samples the starts and has no save at first', () => {
    const p = prepareCalibration(startsRoot(), OPTIONS)
    expect(p.saved).toBeNull()
    expect(p.identity.options).toEqual({ positions: 2, visits: 10, seed: 1, coverage: 0.98 })
    expect(p.identity.levels).toEqual([...PLAYER_LEVELS])
    expect(p.identity.ids).toHaveLength(2)
    expect(p.positions).toHaveLength(2)
  })

  it('continues the save of the same run, refuses another run and ignores the save with --restart', () => {
    const root = startsRoot()
    const { identity } = prepareCalibration(root, OPTIONS)
    const save = CheckpointWriter.start(root, { version: 1, ...identity, katago: 'k' })
    save.add({ i: 0, evaluated: 1, seconds: 1, samples: columns([[0, 1]]) })
    save.close()
    expect(prepareCalibration(root, OPTIONS).saved?.positions).toHaveLength(1)
    expect(() => prepareCalibration(root, { ...OPTIONS, visits: 20 })).toThrow(
      'The saved run in .gpu-runs/thresholds.jsonl differs: visits 10 → 20. Run with the same options to continue, or add --restart to start over.',
    )
    expect(prepareCalibration(root, { ...OPTIONS, visits: 20, restart: true }).saved).toBeNull()
    expect(readCheckpoint(root)?.positions).toHaveLength(1) // --restart replaces the save only when the run starts
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/thresholds/calibrate-steps.test.ts`
Expected: FAIL — `prepareCalibration` is not exported / `restart` missing from the parsed options.

- [ ] **Step 3: Rewrite `scripts/thresholds/calibrate-steps.ts`**

Replace the whole file with:

```ts
import { join } from 'node:path'
import { colorSign, humanProfile, indexToVertex, nextColor, PASS_INDEX, PLAYER_LEVELS, type Move } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../../packages/server/src/engine/engine'
import { baseQuery } from '../../packages/server/src/engine/query'
import { parseThresholdTable, type LevelThresholds } from '../../packages/server/src/review/thresholds'
import { StartBook } from '../../packages/server/src/starts/book'
import { resultGitProblem, saveResult } from '../gpu-run'
import {
  CHECKPOINT_FILE,
  CheckpointWriter,
  differsMessage,
  readCheckpoint,
  removeCheckpoint,
  runDifferences,
  type Checkpoint,
  type RunIdentity,
  type RunOptions,
  type SavedPosition,
} from './checkpoint'

export const THRESHOLDS_FILE = 'packages/server/bases/thresholds.json'
export const STARTS_FILE = 'packages/server/bases/starts.jdb'
/** Spec (repetition) 3.3: the share of a level's moves that exceeds each threshold. */
export const SHARES = { inaccuracy: 0.25, mistake: 0.1, blunder: 0.03 } as const
const SUBJECT = 'feat(levels): calibrate the thresholds with KataGo'
const USAGE = 'Usage: npm run thresholds:gpu -- [--positions N] [--visits N] [--seed N] [--restart]'

/** The options of a run; `restart` (spec (resume) 3.4) starts from the first position without reading the save. */
export interface CalibrateOptions extends RunOptions {
  restart: boolean
}
const DEFAULTS: CalibrateOptions = { positions: 400, visits: 2000, seed: 1, coverage: 0.98, restart: false }
const FLAGS = { '--positions': 'positions', '--visits': 'visits', '--seed': 'seed' } as const

/** Spec (repetition) 3.3: reads `--name value` pairs over the defaults, and the flag `--restart`; an unknown flag, a missing value or a bad value is an error. */
export function parseCalibrateOptions(args: string[]): CalibrateOptions {
  const opts = { ...DEFAULTS }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--restart') {
      opts.restart = true
      continue
    }
    const flag = args[i] as keyof typeof FLAGS
    if (!(flag in FLAGS)) throw new Error(`Unknown option ${args[i]}. ${USAGE}`)
    const value = args[++i]
    if (value === undefined || value.trim() === '') throw new Error(`${flag} needs a value. ${USAGE}`)
    const n = Number(value)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} needs a positive whole number`)
    opts[FLAGS[flag]] = n
  }
  return opts
}

/** A seeded pick of up to `n` items (mulberry32 + a partial Fisher–Yates shuffle). */
export function sample<T>(items: readonly T[], n: number, seed: number): T[] {
  let s = seed >>> 0
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let x = s
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  const a = [...items]
  const k = Math.min(n, a.length)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, k)
}

/** Float sums of policy values fall just short of a round share (0.6 + 0.3 < 0.9). */
const EPS = 1e-9

/**
 * Spec (repetition) 3.3: the union over the policies of the most likely moves that cover `coverage` of each policy.
 * The moves as likely as the last one taken are taken too, so the result does not depend on the order of the points.
 */
export function movesToEvaluate(policies: readonly (readonly number[])[], coverage: number): number[] {
  const out = new Set<number>()
  for (const p of policies) {
    const order = p.map((v, i) => [v, i] as const).filter(([v]) => v > 0).sort((x, y) => y[0] - x[0])
    let covered = 0
    let last = Infinity
    for (const [v, i] of order) {
      if (covered >= coverage - EPS && v < last) break
      out.add(i)
      covered += v
      last = v
    }
  }
  return [...out]
}

export interface Sample {
  loss: number
  weight: number
}

/** The smallest observed loss x such that the moves losing more than x weigh at most `share` of all moves. */
export function exceedThreshold(samples: readonly Sample[], share: number): number {
  const total = samples.reduce((s, x) => s + x.weight, 0)
  const sorted = [...samples].sort((a, b) => a.loss - b.loss)
  let above = total
  for (const x of sorted) {
    above -= x.weight
    if (above <= share * total + 1e-12) return x.loss
  }
  return sorted[sorted.length - 1]?.loss ?? 0
}

const STEP = 0.05
const KEYS = ['inaccuracy', 'mistake', 'blunder'] as const
const two = (x: number): number => Number(x.toFixed(2))

/** Spec (repetition) 3.3: round to 0.05 (floor 0.05), no threshold above the weaker level's, inaccuracy < mistake < blunder; every correction is noted. */
export function smooth(raw: Record<string, LevelThresholds>): { levels: Record<string, LevelThresholds>; notes: string[] } {
  const levels: Record<string, LevelThresholds> = {}
  const notes: string[] = []
  let weaker: LevelThresholds | null = null
  for (const level of PLAYER_LEVELS) {
    const v = { ...raw[level] }
    for (const k of KEYS) {
      const rounded = two(Math.round(v[k] / STEP) * STEP)
      if (rounded < STEP) {
        notes.push(`${level}: ${k} ${v[k]} lifted to ${STEP} (floor)`)
        v[k] = STEP
      } else v[k] = rounded
    }
    if (weaker) {
      for (const k of KEYS) {
        if (v[k] > weaker[k]) {
          notes.push(`${level}: ${k} ${v[k]} lowered to ${weaker[k]} (the weaker level's)`)
          v[k] = weaker[k]
        }
      }
    }
    if (v.mistake <= v.inaccuracy) {
      notes.push(`${level}: mistake ${v.mistake} lifted to ${two(v.inaccuracy + STEP)} (inaccuracy < mistake)`)
      v.mistake = two(v.inaccuracy + STEP)
    }
    if (v.blunder <= v.mistake) {
      notes.push(`${level}: blunder ${v.blunder} lifted to ${two(v.mistake + STEP)} (mistake < blunder)`)
      v.blunder = two(v.mistake + STEP)
    }
    levels[level] = v
    weaker = v
  }
  return { levels, notes }
}

/** Spec (repetition) 3.3: losses of the evaluated moves of one position, weighted by each level's policy. */
async function positionSamples(engine: AnalysisEngine, moves: Move[], opts: RunOptions): Promise<{ perLevel: Sample[][]; evaluated: number }> {
  const toMove = nextColor(moves)
  const root = await engine.analyze({ ...baseQuery(moves), maxVisits: opts.visits })
  const policies = await Promise.all(
    PLAYER_LEVELS.map(async (level) => {
      const r = await engine.analyze({ ...baseQuery(moves), maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: humanProfile(level) } })
      if (!r.humanPolicy) throw new Error(`KataGo returned no human policy for ${humanProfile(level)}`)
      return r.humanPolicy
    }),
  )
  // A pass counts toward the coverage but is not evaluated: its weight falls into the rest (the worst loss).
  const points = movesToEvaluate(policies, opts.coverage).filter((i) => i < PASS_INDEX)
  const losses = new Map<number, number>()
  await Promise.all(
    points.map(async (i) => {
      const after = await engine.analyze({ ...baseQuery([...moves, { color: toMove, vertex: indexToVertex(i) }]), maxVisits: opts.visits })
      losses.set(i, Math.max(0, colorSign(toMove) * (root.rootInfo.scoreLead - after.rootInfo.scoreLead)))
    }),
  )
  const worst = Math.max(0, ...losses.values())
  const perLevel = policies.map((p) => {
    const legal = p.reduce((s, v) => s + (v > 0 ? v : 0), 0)
    const got = points.map((i) => ({ loss: losses.get(i)!, weight: p[i] / legal }))
    const rest = 1 - got.reduce((s, x) => s + x.weight, 0)
    return rest > EPS ? [...got, { loss: worst, weight: rest }] : got
  })
  return { perLevel, evaluated: points.length }
}

export interface Calibration {
  levels: Record<string, LevelThresholds>
  /** The smoothing corrections, one line each. */
  notes: string[]
  /** The moves evaluated over all positions. */
  evaluated: number
  /** The seconds the positions took, over every run of a resumed calibration. */
  seconds: number
}

/** Spec (resume) 3: the positions a run continues from, and where each new position goes as soon as it is done. */
export interface CalibrateResume {
  /** The first positions, already done, in order. */
  saved: readonly SavedPosition[]
  onPosition: (position: SavedPosition) => void
}
const FROM_THE_START: CalibrateResume = { saved: [], onPosition: () => {} }

const toPairs = (perLevel: Sample[][]): [number, number][][] => perLevel.map((s) => s.map((x): [number, number] => [x.loss, x.weight]))
const fromPairs = (pairs: [number, number][][]): Sample[][] => pairs.map((s) => s.map(([loss, weight]) => ({ loss, weight })))

/**
 * Spec (repetition) 3.3: the thresholds of every level over `positions` (each position weighs the same). A resumed run
 * (spec (resume) 3.2) pools the saved positions first and computes only the rest; «min left» follows this run's speed.
 */
export async function calibrate(
  engine: AnalysisEngine,
  positions: Move[][],
  opts: RunOptions,
  log: (line: string) => void,
  resume: CalibrateResume = FROM_THE_START,
): Promise<Calibration> {
  const pooled: Sample[][] = PLAYER_LEVELS.map(() => [])
  let evaluated = 0
  let seconds = 0
  for (const saved of resume.saved) {
    fromPairs(saved.samples).forEach((s, k) => pooled[k].push(...s))
    evaluated += saved.evaluated
    seconds += saved.seconds
  }
  const first = resume.saved.length
  const started = Date.now()
  for (let i = first; i < positions.length; i++) {
    const t = Date.now()
    const position = await positionSamples(engine, positions[i], opts)
    const spent = (Date.now() - t) / 1000
    resume.onPosition({ i, evaluated: position.evaluated, seconds: spent, samples: toPairs(position.perLevel) })
    position.perLevel.forEach((s, k) => pooled[k].push(...s))
    evaluated += position.evaluated
    seconds += spent
    const done = i + 1
    if (done % 20 === 0 || done === positions.length) {
      const elapsed = (Date.now() - started) / 60000
      const left = (elapsed / (done - first)) * (positions.length - done)
      log(`  ${done}/${positions.length} positions, ${Math.round(elapsed)} min, about ${Math.round(left)} min left`)
    }
  }
  const raw: Record<string, LevelThresholds> = {}
  PLAYER_LEVELS.forEach((level, k) => {
    raw[level] = { inaccuracy: exceedThreshold(pooled[k], SHARES.inaccuracy), mistake: exceedThreshold(pooled[k], SHARES.mistake), blunder: exceedThreshold(pooled[k], SHARES.blunder) }
  })
  return { ...smooth(raw), evaluated, seconds }
}

/** Spec (repetition) 3.3: why the run could not commit its result here, or null. */
export const gitProblem = (root: string): string | null => resultGitProblem(root, THRESHOLDS_FILE, 'thresholds-gpu-run')

const fixed = (x: number): string => x.toFixed(2)

/** Spec (resume) 3: the sampled positions of this run, what makes it this run, and the save it continues (null: from the start). */
export interface PreparedCalibration {
  positions: Move[][]
  identity: RunIdentity
  saved: Checkpoint | null
}

/**
 * Spec (resume) 3.2–3.4, before KataGo starts: samples the normal starts and reads the save; a save of another run is
 * refused, `--restart` does not read it (the save is replaced when the new run starts).
 */
export function prepareCalibration(root: string, opts: CalibrateOptions): PreparedCalibration {
  const book = StartBook.loadBase(join(root, STARTS_FILE))
  const ids = sample(book.ids(), opts.positions, opts.seed)
  if (ids.length === 0) throw new Error(`${STARTS_FILE} has no normal starts`)
  const identity: RunIdentity = { options: { positions: opts.positions, visits: opts.visits, seed: opts.seed, coverage: opts.coverage }, ids, levels: [...PLAYER_LEVELS] }
  const saved = opts.restart ? null : readCheckpoint(root)
  if (saved) {
    const differences = runDifferences(saved.header, identity)
    if (differences.length > 0) throw new Error(differsMessage(differences))
  }
  return { positions: ids.map((id) => book.place(id, 'TR', false)), identity, saved }
}

export interface CalibrationRun {
  root: string
  engine: AnalysisEngine
  opts: CalibrateOptions
  /** KataGo version and network names, for the log, the table and the commit. */
  engineInfo: string
  log: (line: string) => void
  /** prepareCalibration's result. */
  prepared: PreparedCalibration
}

/**
 * Spec (repetition) 3.3 and (resume) 3: calibrates the prepared positions — continuing the save or writing a new one
 * position by position — writes the table and commits it, then deletes the save. A failure keeps the save.
 */
export async function runCalibration({ root, engine, opts, engineInfo, log, prepared }: CalibrationRun): Promise<{ committed: boolean }> {
  const { positions, identity, saved } = prepared
  if (saved && saved.header.katago !== engineInfo) throw new Error(differsMessage([`${saved.header.katago} → ${engineInfo}`]))

  log(`Calibrating ${PLAYER_LEVELS.length} levels (${PLAYER_LEVELS[0]} … ${PLAYER_LEVELS[PLAYER_LEVELS.length - 1]}) on ${positions.length} positions (seed ${opts.seed}) with ${opts.visits} visits`)
  log(`Started at ${new Date().toLocaleString()}`)
  if (saved) log(`Continuing the saved run: ${saved.positions.length}/${positions.length} positions done`)
  const save = saved ? CheckpointWriter.append(root) : CheckpointWriter.start(root, { version: 1, ...identity, katago: engineInfo })
  let done = saved?.positions.length ?? 0
  const onPosition = (position: SavedPosition): void => {
    save.add(position)
    done++
  }
  const { levels, notes, evaluated, seconds } = await calibrate(engine, positions, opts, log, { saved: saved?.positions ?? [], onPosition })
    .catch((err: unknown) => {
      log(`${done}/${positions.length} positions are saved in ${CHECKPOINT_FILE}: run the same command to continue.`)
      throw err
    })
    .finally(() => save.close())
  const minutes = seconds / 60

  const table = {
    method: { positions: positions.length, visits: opts.visits, seed: opts.seed, coverage: opts.coverage, shares: SHARES, katago: engineInfo, date: new Date().toISOString() },
    levels,
  }
  const json = JSON.stringify(table, null, 2) + '\n'
  try {
    parseThresholdTable(json)
  } catch (err) {
    throw new Error(`The calibrated table is invalid, nothing written: ${err instanceof Error ? err.message : String(err)}`)
  }

  const report = [
    ...PLAYER_LEVELS.map((level) => {
      const t = levels[level]
      return `${level.padEnd(5)}inaccuracy ${fixed(t.inaccuracy)}  mistake ${fixed(t.mistake)}  blunder ${fixed(t.blunder)}`
    }),
    ...(notes.length > 0 ? ['', 'Smoothing:', ...notes.map((n) => `  ${n}`)] : ['', 'Smoothing: none']),
    '',
    `Positions ${positions.length}, evaluated moves ${evaluated}, visits ${opts.visits}, seed ${opts.seed}, ${minutes.toFixed(1)} minutes`,
  ]
  log('')
  for (const line of report) log(line)

  const committed = await saveResult(root, THRESHOLDS_FILE, json, SUBJECT, [...report, '', engineInfo].join('\n'))
  removeCheckpoint(root)
  log('')
  log(committed ? 'Committed. Next: git push (git push -u origin HEAD for a new branch)' : 'The thresholds did not change: nothing to commit.')
  return { committed }
}
```

- [ ] **Step 4: Wire `scripts/thresholds/gpu.ts`**

Replace lines 1–17 (the imports through the end of `main`) with:

```ts
import { fileURLToPath } from 'node:url'
import { EngineError } from '../../packages/server/src/engine/engine'
import { withHumanNet } from '../gpu-run'
import { gitProblem, parseCalibrateOptions, prepareCalibration, runCalibration } from './calibrate-steps'

const root = fileURLToPath(new URL('../../', import.meta.url))
let visits: number | undefined
const log = (line: string): void => console.log(line)

/** Spec (repetition) 3.3, (resume) 3: `npm run thresholds:gpu` — the checks and the save first, then the calibration with the owner's KataGo. */
async function main(): Promise<void> {
  const opts = parseCalibrateOptions(process.argv.slice(2))
  visits = opts.visits
  const problem = gitProblem(root)
  if (problem) throw new Error(problem)
  const prepared = prepareCalibration(root, opts)
  await withHumanNet(root, log, (engine, engineInfo) => runCalibration({ root, engine, opts, engineInfo, log, prepared }))
}
```

(The `main().catch(...)` block below stays as it is.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run scripts/thresholds`
Expected: PASS — all tests of `checkpoint.test.ts` and `calibrate-steps.test.ts`.

- [ ] **Step 6: `.gitignore` and the documents**

Append to `.gitignore`:

```
# the save of an interrupted thresholds calibration (npm run thresholds:gpu)
.gpu-runs/
```

`README.md`:
- line 147: `` `npm run thresholds:gpu -- [--positions 400] [--visits 2000] [--seed 1]` `` → `` `npm run thresholds:gpu -- [--positions 400] [--visits 2000] [--seed 1] [--restart]` ``.
- line 149: replace the sentence `There is no resume: an interrupted run starts over, and nothing is written until the end.` with:
  `An interrupted run (a power cut, a KataGo crash, a closed window) is not lost: every finished position is saved to `.gpu-runs/thresholds.jsonl` (ignored by git), and the same command with the same options continues after the last saved one; the file is deleted once the table is committed. With other options, another sample of positions or another KataGo than the saved run, or with a damaged save, the run refuses and says why; `--restart` starts over (the old save is replaced once the new run starts).`
- line 158: `6. `npm run thresholds:gpu` (keep the machine awake).` → `6. `npm run thresholds:gpu` (keep the machine awake; if the run stops, run the same command again: it continues).`

`docs/gpu-calibration.md`:
- line 23: replace `Продолжения после прерывания нет: прерванный запуск начинается заново.` with `Прогон порогов (раздел 1) сохраняет каждую готовую позицию и после обрыва продолжается той же командой; прогон графа (раздел 2) продолжения не имеет и начинается заново.`
- line 33: `- **Команда:** `npm run thresholds:gpu`. Параметры по умолчанию: `--positions 400 --visits 2000 --seed 1`.` → `- **Команда:** `npm run thresholds:gpu`. Параметры по умолчанию: `--positions 400 --visits 2000 --seed 1`; `--restart` — начать заново, не продолжая сохранённый прогон.`
- after line 41 (the `**Время:**` bullet) insert:

```
- **Если прогон прервался** (отключилось питание, упал KataGo, закрыли окно): запустить ту же команду с теми же параметрами — она продолжит после последней сохранённой позиции; теряется не больше одной позиции (около 1,5 минуты). Готовые позиции хранятся в `.gpu-runs/thresholds.jsonl` (git его не видит); после коммита таблицы файл удаляется сам.
- **Если запуск отказался из-за сохранения:** при другом прогоне (другие параметры, другая выборка позиций, другой KataGo) он называет отличие — повторить запуск с прежними параметрами или добавить `--restart`, чтобы начать с нуля; при повреждённом сохранении — `--restart`. Старое сохранение заменяется, только когда новый прогон начал считать.
```

`docs/superpowers/specs/2026-10-15-repetition-design.md` line 53: append after `Отправляет коммит владелец.` the sentence ` Прерванный прогон продолжается той же командой с последней сохранённой позиции ([продолжение после обрыва](2026-10-23-thresholds-resume-design.md)).`

- [ ] **Step 7: Full check**

Run: `npx vitest run` — Expected: all test files pass.
Run: `npm run typecheck` — Expected: no errors.
Run: `git status --short` — Expected: only the files of this task (no `.gpu-runs/`).

- [ ] **Step 8: Commit**

```bash
git add .gitignore README.md docs/gpu-calibration.md docs/superpowers/specs/2026-10-15-repetition-design.md scripts/thresholds/calibrate-steps.ts scripts/thresholds/calibrate-steps.test.ts scripts/thresholds/gpu.ts
git commit -m "wip: resume the thresholds calibration from its save"
```

---

### Task 3: Final review fixes

The whole-branch review approved the mechanism and found gaps; the owner decided two of them (spec 7, decisions 4 and 5). The spec is already updated: sections 2.1–2.4, 3.2, 3.3, 3.5, 3.6, 5, 6.

**Files:**
- Modify: `scripts/thresholds/checkpoint.ts`, `scripts/thresholds/checkpoint.test.ts`
- Modify: `scripts/thresholds/calibrate-steps.ts`, `scripts/thresholds/calibrate-steps.test.ts`, `scripts/thresholds/gpu.ts`
- Modify: `README.md`, `docs/gpu-calibration.md`, `docs/superpowers/specs/2026-10-15-repetition-design.md`

**Interfaces:**
- `RunIdentity` gains `code: string` (so `RunHeader` and `asHeader` carry it; `asHeader` requires a string).
- `Checkpoint` gains `dropped: number` — the whole lines cut off after the sound beginning (a torn tail without a newline does not count).
- `calibrationCode(root: string): string` exported from `calibrate-steps.ts`.
- `prepareCalibration(root: string, opts: CalibrateOptions, log: (line: string) => void): PreparedCalibration` (new `log` parameter).

- [ ] **Step 1: `readCheckpoint` keeps the sound beginning (spec 2.4, decision 5)**

Replace `readCheckpoint` in `checkpoint.ts` (and the `Checkpoint` interface) with the version below. It takes the line boundaries from the buffer's newline offsets, so the cut is exact for any bytes (review finding T1-2), and a torn tail together with a damaged line before it is cut as one damaged end (T1-1).

```ts
export interface Checkpoint {
  header: RunHeader
  positions: SavedPosition[]
  /** Spec 2.4: the whole lines cut off after the sound beginning (damaged, or another run's). */
  dropped: number
}

/**
 * Spec 2.4: the save in `root`, or null when there is none or it has no whole first line. The sound beginning — the
 * description and the positions after it in order — is kept; the first unsound line and everything after it (a torn
 * write, a disk that lost flushed data, the lines of a second run) are cut off the file. Only a whole first line that
 * is not a run description throws.
 */
export function readCheckpoint(root: string): Checkpoint | null {
  const path = join(root, CHECKPOINT_FILE)
  if (!existsSync(path)) return null
  const data = readFileSync(path)
  // The whole lines, as byte offsets: each ends at a newline.
  const ends: number[] = []
  for (let at = data.indexOf(NEWLINE); at >= 0; at = data.indexOf(NEWLINE, at + 1)) ends.push(at)
  const text = (k: number): string => data.subarray(k === 0 ? 0 : ends[k - 1] + 1, ends[k]).toString('utf8')
  if (ends.length === 0) {
    if (data.length > 0) truncateSync(path, 0)
    return null
  }
  const header = asHeader(parse(text(0)))
  if (!header) throw damaged('the first line is not a run description')
  const positions: SavedPosition[] = []
  for (let k = 1; k < ends.length; k++) {
    const p = asPosition(parse(text(k)), header.levels.length)
    if (!p || p.i !== k - 1 || p.i >= header.ids.length) break
    positions.push(p)
  }
  const size = ends[positions.length] + 1
  if (size < data.length) truncateSync(path, size)
  return { header, positions, dropped: ends.length - 1 - positions.length }
}
```

Update the comment at the top of the file if it still says other damage refuses.

- [ ] **Step 2: The writer refuses a number that is not finite (spec 2.3, T1-3)**

In `CheckpointWriter`:

```ts
  add(position: SavedPosition): void {
    const numbers = [position.i, position.evaluated, position.seconds, ...position.samples.flat(2)]
    if (!numbers.every(Number.isFinite)) throw new Error(`Position ${position.i} has a number that is not finite: it cannot be saved`)
    this.line(position)
  }
```

- [ ] **Step 3: The calibration code in the header (spec 2.2, 3.3, decision 4)**

`checkpoint.ts`: `RunIdentity` gets `code: string` (doc: «the last commit that changed the calibration code ('' without one)»); `asHeader` requires `typeof h.code === 'string'` and copies it; `runDifferences` adds, after the levels check:

```ts
  if (saved.code !== identity.code) out.push(`the calibration code differs (${short(saved.code)} → ${short(identity.code)})`)
```

with `const short = (commit: string): string => (commit === '' ? 'none' : commit.slice(0, 7))`.

`calibrate-steps.ts` (add `import { execFileSync } from 'node:child_process'`):

```ts
/** Spec (resume) 2.2: what the calibration's result depends on in the repository. */
const CODE_PATHS = ['scripts', 'packages/server/src', 'packages/shared/src', STARTS_FILE]

/** Spec (resume) 2.2: the last commit that changed the calibration code ('' without one); uncommitted edits are not seen. */
export const calibrationCode = (root: string): string =>
  execFileSync('git', ['log', '-1', '--format=%H', '--', ...CODE_PATHS], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
```

`prepareCalibration(root, opts, log)`: the identity gets `code: calibrationCode(root)`; then

```ts
  const read = opts.restart ? null : readCheckpoint(root)
  if (read && read.dropped > 0) log(`Dropped ${read.dropped} damaged line${read.dropped === 1 ? '' : 's'} from the end of the save: their positions are computed again.`)
  // Spec (resume) 3.2: a save without positions is no save — nothing is lost by starting over with other options.
  const saved = read && read.positions.length > 0 ? read : null
```

followed by the existing `runDifferences` check on `saved`. Update its doc comment. `gpu.ts` passes `log`: `prepareCalibration(root, opts, log)`.

- [ ] **Step 4: A failed commit says what to do; a failed delete only warns (spec 3.6)**

In `runCalibration`, replace the `saveResult` call and `removeCheckpoint(root)` with:

```ts
  const committed = await saveResult(root, THRESHOLDS_FILE, json, SUBJECT, [...report, '', engineInfo].join('\n')).catch((err: unknown) => {
    log(`All ${positions.length} positions stay saved in ${CHECKPOINT_FILE}: once ${THRESHOLDS_FILE} is discarded, the same command writes and commits the table again; if you commit it by hand, delete the save.`)
    throw err
  })
  try {
    removeCheckpoint(root)
  } catch {
    log(`Could not delete ${CHECKPOINT_FILE}: delete it by hand, or the next run with the same options continues it.`)
  }
```

- [ ] **Step 5: The KataGo hint in `gpu.ts` (spec 3.5)**

Replace the `engine_failed` hint with:

```ts
    console.error(`If KataGo runs on the CPU or is too slow for --visits ${visits}, run npm run setup again and pick a GPU build, or lower --visits (with --restart when positions are saved).`)
```

- [ ] **Step 6: Tests**

`checkpoint.test.ts`:
- `HEADER` gets `code: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b'`; every `readCheckpoint` result expectation gets `dropped: 0` where nothing is cut.
- `'has no save without the file, in an empty file or without a whole first line'`: also a 0-byte file → `null`.
- `'drops a torn last line silently and cuts it off the file'`: `whole + line(position(1)).slice(0, 15)` → positions `[position(0)]`, `dropped: 0`, the file equals `whole`.
- Replace `'refuses any other damage'` with `'keeps the sound beginning and cuts the rest off the file'`, each case checking `positions`, `dropped` and the file content after the read:
  - `line(HEADER) + 'nonsense\n' + line(position(1))` → `[]`, dropped 2, file `line(HEADER)`;
  - `line(HEADER) + line(position(0)) + line(position(2))` → `[position(0)]`, dropped 1;
  - `line(HEADER) + line({ ...position(0), samples: [[[0, 1]]] })` → `[]`, dropped 1;
  - `line({ ...HEADER, ids: ['aaaaaaaa'] }) + line(position(0)) + line(position(1))` → `[position(0)]`, dropped 1;
  - `line(HEADER) + line(position(0)) + 'nonsense\n' + line(position(1)).slice(0, 15)` → `[position(0)]`, dropped 1, file `line(HEADER) + line(position(0))`.
- `'refuses a first line that is not a run description'`: `line({ version: 2 }) + line(position(0))` and `line({ ...HEADER, code: 7 }) + line(position(0))` throw `'(the first line is not a run description)'`.
- `'continues a cut save: what is appended after the cut reads back whole'`: write `line(HEADER) + line(position(0)) + 'nonsense\n'`, read (dropped 1), `CheckpointWriter.append(r).add(position(1))` and close, read → `[position(0), position(1)]`, dropped 0.
- `'names what differs from the saved run'`: also `runDifferences(HEADER, { ...identity, code: '5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6' })` → `['the calibration code differs (1a2b3c4 → 5d6e7f8)']`, and `code: ''` → `'(1a2b3c4 → none)'`. (`identity` now includes `code: HEADER.code`.)
- `'refuses to save a number that is not finite'`: `add({ ...position(0), seconds: Number.NaN })` and `add({ ...position(0), samples: [[[0, Infinity]], [[0, 1]]] })` throw `'Position 0 has a number that is not finite: it cannot be saved'`, and the file still holds only the header line.

`calibrate-steps.test.ts`:
- `IDENTITY` gets `code: 'c0dec0dec0dec0dec0dec0dec0dec0dec0dec0de'`.
- `'keeps the save when the commit fails'` also expects the log line `All 3 positions stay saved in .gpu-runs/thresholds.jsonl: once packages/server/bases/thresholds.json is discarded, the same command writes and commits the table again; if you commit it by hand, delete the save.`
- `prepareCalibration`: `startsRoot()` becomes a git repository (init, branch `feat/x`, `starts.jdb` committed with `-c user.name=… -c user.email=…`, as `repo()` does); every call passes a `log`. Tests:
  - `'samples the starts and has no save at first'` also expects `identity.code` to equal `git rev-parse HEAD`;
  - the existing `'continues the save of the same run, refuses another run and ignores the save with --restart'`;
  - `'treats a save without positions as none'`: a header-only save with `visits: 10`, then `prepareCalibration(root, { ...OPTIONS, visits: 20 }, log)` → `saved` null, no throw;
  - `'refuses a save made by other calibration code, not after a commit elsewhere'`: save one position; commit a change to `README.md` → `saved.positions` has 1; commit a new file under `scripts/` → throws `the calibration code differs (<old 7> → <new 7>)` (take both hashes from `git rev-parse`);
  - `'logs the damaged lines it drops'`: a save of the header, one position and `'nonsense\n'` → `saved.positions` has 1 and the log has `Dropped 1 damaged line from the end of the save: their positions are computed again.`

- [ ] **Step 7: Documents**

`README.md`, «Calibrating the thresholds»: replace the sentence that starts `An interrupted run (a power cut, a KataGo crash, a closed window) is not lost:` (through `once the new run starts).`) with:

`An interrupted run (a power cut, a KataGo crash, a closed window) is not lost: every finished position is saved to `.gpu-runs/thresholds.jsonl` in this working copy (ignored by git; another clone starts over, and a working copy runs one calibration at a time), and the same command with the same options continues after the last saved one; the file is deleted once the table is committed. A damaged end of the save is cut off and those positions are computed again. With other options, another sample of positions, other calibration code (a newer commit touching `scripts`, `packages/server/src`, `packages/shared/src` or `starts.jdb`; uncommitted edits are not tracked) or another KataGo than the saved run, the run refuses and says why; `--restart` starts over (the old save is replaced once the new run starts).`

`docs/gpu-calibration.md`, section 1: replace the two bullets added in Task 2 (`**Если прогон прервался**` and `**Если запуск отказался из-за сохранения:**`) with:

```
- **Если прогон прервался** (отключилось питание, упал KataGo, закрыли окно): запустить ту же команду с теми же параметрами — она продолжит после последней сохранённой позиции; теряется не больше одной позиции (около 1,5 минуты). Готовые позиции хранятся в `.gpu-runs/thresholds.jsonl` этой рабочей копии (git его не видит; в другом клоне или на другой машине прогон начнётся заново); в одной рабочей копии запускайте один прогон. Испорченный конец файла отрезается, и эти позиции считаются заново. После коммита таблицы файл удаляется сам.
- **Если запуск отказался из-за сохранения:** при другом прогоне (другие параметры, другая выборка позиций, другой KataGo) или другом коде расчёта (новый коммит в `scripts`, `packages/server/src`, `packages/shared/src` или в `starts.jdb`; незакоммиченные правки не учитываются) он называет отличие — повторить запуск с прежними параметрами и кодом или добавить `--restart`, чтобы начать с нуля; при испорченном описании прогона (первой строке файла) — `--restart`. Старое сохранение заменяется, только когда новый прогон начал считать.
```

`docs/superpowers/specs/2026-10-15-repetition-design.md` line 53: `[--seed N]` → `[--seed N] [--restart]` (T2-1).

- [ ] **Step 8: Full check and commit**

Run: `npx vitest run scripts/thresholds`, then `npx vitest run` and `npm run typecheck` — all pass, no output noise. `git status --short` shows only this task's files.

```bash
git add README.md docs/gpu-calibration.md docs/superpowers/specs/2026-10-15-repetition-design.md scripts/thresholds/checkpoint.ts scripts/thresholds/checkpoint.test.ts scripts/thresholds/calibrate-steps.ts scripts/thresholds/calibrate-steps.test.ts scripts/thresholds/gpu.ts
git commit -m "wip: final review fixes for the thresholds resume"
```

---

### Finish: one commit for the feature

After all tasks pass review, squash the three `wip:` commits into one (the docs commit with the spec and this plan stays separate):

```bash
git reset --soft HEAD~3
git commit -m "feat(thresholds): resume an interrupted calibration from its save" -m "npm run thresholds:gpu saves every finished position to .gpu-runs/thresholds.jsonl (append-only, flushed to the disk) and the same command continues after the last saved one; a torn last line is dropped, a save of another run or a damaged one is refused, --restart starts over. The save is deleted after the table is committed. README, the GPU guide and the repetition spec describe it." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
