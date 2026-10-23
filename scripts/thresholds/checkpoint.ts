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

/** What makes two runs the same run, apart from KataGo: the options, the sampled starts, the level columns and the calibration code. */
export interface RunIdentity {
  options: RunOptions
  ids: string[]
  levels: string[]
  /** The last commit that changed the calibration code ('' without one). */
  code: string
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
  /** Spec 2.4: the whole lines cut off after the sound beginning (damaged, or another run's). */
  dropped: number
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
  if (!isStrings(h.ids) || !isStrings(h.levels) || typeof h.code !== 'string' || typeof h.katago !== 'string') return null
  return { version: 1, options: { positions, visits, seed, coverage }, ids: h.ids, levels: h.levels, code: h.code, katago: h.katago }
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

  /** Spec 2.3: a number that is not finite is refused here, not found by the next run hours later. */
  add(position: SavedPosition): void {
    const numbers = [position.i, position.evaluated, position.seconds, ...position.samples.flat(2)]
    if (!numbers.every(Number.isFinite)) throw new Error(`Position ${position.i} has a number that is not finite: it cannot be saved`)
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
const short = (commit: string): string => (commit === '' ? 'none' : commit.slice(0, 7))

/** Spec 3.3: what differs between the saved run and this one, apart from KataGo (compared once it has started). */
export function runDifferences(saved: RunHeader, identity: RunIdentity): string[] {
  const out: string[] = []
  for (const key of ['positions', 'visits', 'seed', 'coverage'] as const) {
    if (saved.options[key] !== identity.options[key]) out.push(`${key} ${saved.options[key]} → ${identity.options[key]}`)
  }
  if (!sameList(saved.ids, identity.ids)) out.push('the sampled positions differ')
  if (!sameList(saved.levels, identity.levels)) out.push('the levels differ')
  if (saved.code !== identity.code) out.push(`the calibration code differs (${short(saved.code)} → ${short(identity.code)})`)
  return out
}

/** Spec 3.3: the refusal for a save of another run. */
export const differsMessage = (differences: readonly string[]): string =>
  `The saved run in ${CHECKPOINT_FILE} differs: ${differences.join('; ')}. Run with the same options to continue, or add --restart to start over.`

/** Spec 3.6: deletes the save (nothing to do without one). */
export function removeCheckpoint(root: string): void {
  rmSync(join(root, CHECKPOINT_FILE), { force: true })
}
