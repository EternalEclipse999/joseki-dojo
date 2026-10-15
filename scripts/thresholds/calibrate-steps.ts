import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { colorSign, humanProfile, indexToVertex, nextColor, PASS_INDEX, PLAYER_LEVELS, type Move } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../../packages/server/src/engine/engine'
import { baseQuery } from '../../packages/server/src/engine/query'
import { renameRetrying } from '../../packages/server/src/install/download'
import { parseThresholdTable, type LevelThresholds } from '../../packages/server/src/review/thresholds'
import { StartBook } from '../../packages/server/src/starts/book'

export const THRESHOLDS_FILE = 'packages/server/bases/thresholds.json'
export const STARTS_FILE = 'packages/server/bases/starts.jdb'
/** Spec (repetition) 3.3: the share of a level's moves that exceeds each threshold. */
export const SHARES = { inaccuracy: 0.25, mistake: 0.1, blunder: 0.03 } as const
const SUBJECT = 'feat(levels): calibrate the thresholds with KataGo'
const USAGE = 'Usage: npm run thresholds:gpu -- [--positions N] [--visits N] [--seed N]'

export interface CalibrateOptions {
  positions: number
  visits: number
  seed: number
  coverage: number
}
const DEFAULTS: CalibrateOptions = { positions: 400, visits: 2000, seed: 1, coverage: 0.98 }
const FLAGS = { '--positions': 'positions', '--visits': 'visits', '--seed': 'seed' } as const

/** Spec (repetition) 3.3: reads `--name value` pairs over the defaults; an unknown flag, a missing value or a bad value is an error. */
export function parseCalibrateOptions(args: string[]): CalibrateOptions {
  const opts = { ...DEFAULTS }
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i] as keyof typeof FLAGS
    if (!(flag in FLAGS)) throw new Error(`Unknown option ${args[i]}. ${USAGE}`)
    const value = args[i + 1]
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
async function positionSamples(engine: AnalysisEngine, moves: Move[], opts: CalibrateOptions): Promise<{ perLevel: Sample[][]; evaluated: number }> {
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
}

/** Spec (repetition) 3.3: the thresholds of every level over `positions` (each position weighs the same). */
export async function calibrate(engine: AnalysisEngine, positions: Move[][], opts: CalibrateOptions, log: (line: string) => void): Promise<Calibration> {
  const pooled: Sample[][] = PLAYER_LEVELS.map(() => [])
  let evaluated = 0
  let done = 0
  const started = Date.now()
  for (const moves of positions) {
    const position = await positionSamples(engine, moves, opts)
    position.perLevel.forEach((s, k) => pooled[k].push(...s))
    evaluated += position.evaluated
    done++
    if (done % 20 === 0 || done === positions.length) {
      const elapsed = (Date.now() - started) / 60000
      const left = (elapsed / done) * (positions.length - done)
      log(`  ${done}/${positions.length} positions, ${Math.round(elapsed)} min, about ${Math.round(left)} min left`)
    }
  }
  const raw: Record<string, LevelThresholds> = {}
  PLAYER_LEVELS.forEach((level, k) => {
    raw[level] = { inaccuracy: exceedThreshold(pooled[k], SHARES.inaccuracy), mistake: exceedThreshold(pooled[k], SHARES.mistake), blunder: exceedThreshold(pooled[k], SHARES.blunder) }
  })
  return { ...smooth(raw), evaluated }
}

const git = (root: string, args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const fileChanges = (root: string): string => git(root, ['status', '--porcelain', '--', THRESHOLDS_FILE])

/** Spec (repetition) 3.3: why the run could not commit its result here, or null. */
export function gitProblem(root: string): string | null {
  let branch: string
  try {
    branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? '').trim()
    const detail = stderr !== '' ? `\ngit says: ${stderr}` : ''
    return `Not on a branch (a detached HEAD or not a git repository): switch to the pull request branch or create a branch for the result (e.g. git switch -c thresholds-gpu-run)${detail}`
  }
  if (branch === 'main') return 'You are on main: switch to the pull request branch or create a branch for the result (e.g. git switch -c thresholds-gpu-run)'
  const changed = fileChanges(root)
  if (changed !== '') return `Uncommitted changes in ${THRESHOLDS_FILE}:\n${changed}\nCommit, restore or delete it first`
  return null
}

/** Spec (repetition) 3.3: commits only the thresholds file (new or changed) with the repository's configured identity; false when it did not change. */
export function commitThresholds(root: string, subject: string, body: string): boolean {
  if (fileChanges(root) === '') return false
  // A path commit only takes files git knows: the first run creates the file.
  git(root, ['add', '--', THRESHOLDS_FILE])
  git(root, ['commit', '-q', '-m', subject, '-m', body, '--', THRESHOLDS_FILE])
  return true
}

const fixed = (x: number): string => x.toFixed(2)

export interface CalibrationRun {
  root: string
  engine: AnalysisEngine
  opts: CalibrateOptions
  /** KataGo version and network names, for the log, the table and the commit. */
  engineInfo: string
  log: (line: string) => void
}

/** Spec (repetition) 3.3: calibrates on a sample of the normal starts, writes the table and commits it. An engine failure writes nothing. */
export async function runCalibration({ root, engine, opts, engineInfo, log }: CalibrationRun): Promise<{ committed: boolean }> {
  const book = StartBook.loadBase(join(root, STARTS_FILE))
  const ids = sample(book.ids(), opts.positions, opts.seed)
  if (ids.length === 0) throw new Error(`${STARTS_FILE} has no normal starts`)
  const positions = ids.map((id) => book.place(id, 'TR', false))

  const started = Date.now()
  log(`Calibrating ${PLAYER_LEVELS.length} levels (${PLAYER_LEVELS[0]} … ${PLAYER_LEVELS[PLAYER_LEVELS.length - 1]}) on ${positions.length} positions (seed ${opts.seed}) with ${opts.visits} visits`)
  log(`Started at ${new Date(started).toLocaleString()}`)
  const { levels, notes, evaluated } = await calibrate(engine, positions, opts, log)
  const minutes = (Date.now() - started) / 60000

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

  const file = join(root, THRESHOLDS_FILE)
  const tmp = `${file}.tmp`
  let committed: boolean
  try {
    try {
      writeFileSync(tmp, json)
      await renameRetrying(tmp, file)
    } finally {
      rmSync(tmp, { force: true })
    }
    committed = commitThresholds(root, SUBJECT, [...report, '', engineInfo].join('\n'))
  } catch (err) {
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0]
    throw new Error(`The result may already be written to ${THRESHOLDS_FILE}. Commit it with: git add -- ${THRESHOLDS_FILE} && git commit -- ${THRESHOLDS_FILE} or discard it with: git restore --staged --worktree -- ${THRESHOLDS_FILE} (for a newly added file: git rm --cached -- ${THRESHOLDS_FILE}, then delete the file)\n${first}`)
  }
  log('')
  log(committed ? 'Committed. Next: git push (git push -u origin HEAD for a new branch)' : 'The thresholds did not change: nothing to commit.')
  return { committed }
}
