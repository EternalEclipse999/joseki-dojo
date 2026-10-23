import { execFileSync } from 'node:child_process'
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

/** Spec (resume) 2.2: what the calibration's result depends on in the repository. */
const CODE_PATHS = ['scripts', 'packages/server/src', 'packages/shared/src', STARTS_FILE]

/** Spec (resume) 2.2: the last commit that changed the calibration code ('' without one); uncommitted edits are not seen. */
export const calibrationCode = (root: string): string =>
  execFileSync('git', ['log', '-1', '--format=%H', '--', ...CODE_PATHS], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/**
 * Spec (resume) 3.2–3.4, before KataGo starts: samples the normal starts and reads the save (cutting off a damaged end,
 * which `log` reports); a save of another run or of other calibration code is refused, a save without positions is no
 * save, `--restart` does not read it (the save is replaced when the new run starts).
 */
export function prepareCalibration(root: string, opts: CalibrateOptions, log: (line: string) => void): PreparedCalibration {
  const book = StartBook.loadBase(join(root, STARTS_FILE))
  const ids = sample(book.ids(), opts.positions, opts.seed)
  if (ids.length === 0) throw new Error(`${STARTS_FILE} has no normal starts`)
  const identity: RunIdentity = {
    options: { positions: opts.positions, visits: opts.visits, seed: opts.seed, coverage: opts.coverage },
    ids,
    levels: [...PLAYER_LEVELS],
    code: calibrationCode(root),
  }
  const read = opts.restart ? null : readCheckpoint(root)
  if (read && read.dropped > 0) log(`Dropped ${read.dropped} damaged line${read.dropped === 1 ? '' : 's'} from the end of the save: their positions are computed again.`)
  // Spec (resume) 3.2: a save without positions is no save — nothing is lost by starting over with other options.
  const saved = read && read.positions.length > 0 ? read : null
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

  const committed = await saveResult(root, THRESHOLDS_FILE, json, SUBJECT, [...report, '', engineInfo].join('\n')).catch((err: unknown) => {
    log(`All ${positions.length} positions stay saved in ${CHECKPOINT_FILE}: once ${THRESHOLDS_FILE} is discarded, the same command writes and commits the table again; if you commit it by hand, delete the save.`)
    throw err
  })
  try {
    removeCheckpoint(root)
  } catch {
    log(`Could not delete ${CHECKPOINT_FILE}: delete it by hand, or the next run with the same options continues it.`)
  }
  log('')
  log(committed ? 'Committed. Next: git push (git push -u origin HEAD for a new branch)' : 'The thresholds did not change: nothing to commit.')
  return { committed }
}
