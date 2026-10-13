import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AnalysisEngine } from '../../packages/server/src/engine/engine'
import { renameRetrying } from '../../packages/server/src/install/download'
import { decodeJdb, encodeJdb, moveText } from '../../packages/server/src/jdb'
import { checkTraps, type CheckResult } from '../../packages/server/src/traps/check'
import { completeCandidates, type CompletedTrap, type CompleteOptions, type CompleteResult } from '../../packages/server/src/traps/complete'
import { addTraps, removeTraps } from '../../packages/server/src/traps/tree'

export const TRAPS_FILE = 'packages/server/bases/traps.jdb'
export const CANDIDATES_FILE = 'scripts/traps/candidates.jdb'
const SUBJECT = 'feat(traps): verify the base and complete the candidates with KataGo'
const USAGE = 'Usage: npm run traps:gpu -- [--visits N] [--good-max X] [--caught-gap X] [--ranks 20k,15k,10k,5k,3k,1k] [--natural X]'
const DEFAULTS: CompleteOptions = { visits: 8000, goodMax: 1, caughtGap: 2, ranks: ['20k', '15k', '10k', '5k', '3k', '1k'], natural: 0.1 }
const FLAGS = new Set(['--visits', '--good-max', '--caught-gap', '--ranks', '--natural'])
/** Human SL profiles: rank_20k … rank_1k, rank_1d … rank_9d. */
const RANK = /^(?:[1-9]|1\d|20)k$|^[1-9]d$/

function numberOf(flag: string, value: string): number {
  const x = Number(value)
  if (!Number.isFinite(x)) throw new Error(`${flag} needs a number`)
  return x
}

/** Spec 3: reads `--name value` pairs over the defaults; an unknown flag, a missing value or a bad value is an error. */
export function parseGpuOptions(args: string[]): CompleteOptions {
  const opts: CompleteOptions = { ...DEFAULTS, ranks: [...DEFAULTS.ranks] }
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    if (!FLAGS.has(flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`)
    const value = args[i + 1]
    if (value === undefined || value.trim() === '') throw new Error(`${flag} needs a value. ${USAGE}`)
    if (flag === '--ranks') {
      const ranks = value.split(',').map((r) => r.trim())
      const bad = ranks.find((r) => !RANK.test(r))
      if (bad !== undefined) throw new Error(`--ranks: unknown rank "${bad}" (use 20k … 1k or 1d … 9d)`)
      opts.ranks = [...new Set(ranks)]
      continue
    }
    const x = numberOf(flag, value)
    if (flag === '--visits') {
      if (!Number.isInteger(x) || x < 1) throw new Error('--visits needs an integer of at least 1')
      opts.visits = x
    } else if (flag === '--natural') {
      if (x <= 0 || x > 1) throw new Error('--natural needs a number above 0 and at most 1')
      opts.natural = x
    } else {
      if (x < 0) throw new Error(`${flag} needs a non-negative number`)
      if (flag === '--good-max') opts.goodMax = x
      else opts.caughtGap = x
    }
  }
  return opts
}

const git = (root: string, args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const baseChanges = (root: string): string => git(root, ['status', '--porcelain', '--', TRAPS_FILE, CANDIDATES_FILE])

/** Spec 3, step 1: why the run could not commit its result here, or null. */
export function gitProblem(root: string): string | null {
  let branch: string
  try {
    branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? '').trim()
    const detail = stderr !== '' ? `\ngit says: ${stderr}` : ''
    return `Not on a branch (a detached HEAD or not a git repository): switch to the pull request branch or create a branch for the result (e.g. git switch -c traps-gpu-run)${detail}`
  }
  if (branch === 'main') return 'You are on main: switch to the pull request branch or create a branch for the result (e.g. git switch -c traps-gpu-run)'
  const changed = baseChanges(root)
  if (changed !== '') return `Uncommitted changes in the base files:\n${changed}\nCommit or restore them first`
  return null
}

/** Spec 3, step 5: commits only the two base files, as the author of the last commit; false when they did not change. */
export function commitBases(root: string, subject: string, body: string): boolean {
  if (baseChanges(root) === '') return false
  const [name, email] = git(root, ['log', '-1', '--no-show-signature', '--format=%an%n%ae']).split('\n')
  git(root, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', subject, '-m', body, '--', TRAPS_FILE, CANDIDATES_FILE])
  return true
}

/** Writes both files next to their targets first, then renames both, so a failed write leaves the bases as they were. */
async function writePaired(files: [string, Uint8Array][]): Promise<void> {
  const pending = files.map(([file]) => `${file}.tmp`)
  try {
    for (const [i, [, bytes]] of files.entries()) writeFileSync(pending[i], bytes)
    for (const [i, [file]] of files.entries()) {
      await renameRetrying(pending[i], file)
      pending[i] = ''
    }
  } finally {
    for (const tmp of pending) if (tmp !== '') rmSync(tmp, { force: true })
  }
}

function answersOf(t: CompletedTrap, category: 'good' | 'caught'): string {
  return t.answers
    .filter((a) => a.category === category)
    .map((a) => `${moveText(a.move)} ${a.loss}${a.ranks.length > 0 ? ` (${a.ranks.join(' ')})` : ''}`)
    .join(', ')
}

/** Spec 5: the report, also the body of the commit. */
function summaryLines(checked: CheckResult, completed: CompleteResult): string[] {
  return [
    `Base: kept ${checked.kept}, dropped ${checked.dropped.length}, left unchecked ${checked.failed.length}; verified: ${checked.tree.verified ? 'yes' : 'no'}`,
    ...checked.dropped.map((d) => `  dropped ${d.id}: ${d.reason}`),
    ...checked.failed.map((f) => `  unchecked ${f.id}: ${f.reason}`),
    `Candidates: accepted ${completed.accepted.length}, not accepted ${completed.rejected.length}`,
    ...completed.accepted.map((t) => `  accepted ${t.id} ${t.path.map(moveText).join(' ')} | good: ${answersOf(t, 'good')} | caught: ${answersOf(t, 'caught')}`),
    ...completed.rejected.map((r) => `  not accepted ${r.id}: ${r.reason}`),
  ]
}

export interface GpuRun {
  root: string
  engine: AnalysisEngine
  opts: CompleteOptions
  /** KataGo version and network names, for the log and the commit. */
  engineInfo: string
  log: (line: string) => void
}

/** Spec 3, steps 2–6: checks the base, completes the candidates, writes both files and commits them. An engine failure writes nothing. */
export async function runGpu({ root, engine, opts, engineInfo, log }: GpuRun): Promise<{ committed: boolean }> {
  const trapsFile = join(root, TRAPS_FILE)
  const candidatesFile = join(root, CANDIDATES_FILE)
  const traps = decodeJdb(readFileSync(trapsFile))
  const candidates = decodeJdb(readFileSync(candidatesFile))
  if (traps.kind !== 'traps' || candidates.kind !== 'traps') throw new Error(`${TRAPS_FILE} and ${CANDIDATES_FILE} must both be traps bases`)

  log(`Checking ${traps.nodesOf('trap').length} traps of the base with ${opts.visits} visits (good-max ${opts.goodMax}, caught-gap ${opts.caughtGap})`)
  const checked = await checkTraps(traps, engine, opts, log)
  log(`Completing ${candidates.nodesOf('trap').length} candidates (ranks ${opts.ranks.join(' ')}, natural ${opts.natural})`)
  const completed = await completeCandidates(candidates, engine, opts, log)

  const summary = summaryLines(checked, completed)
  log('')
  for (const line of summary) log(line)
  const options = `Options: visits ${opts.visits}, good-max ${opts.goodMax}, caught-gap ${opts.caughtGap}, ranks ${opts.ranks.join(',')}, natural ${opts.natural}`
  let committed: boolean
  try {
    await writePaired([
      [trapsFile, encodeJdb(addTraps(checked.tree, completed.accepted))],
      [candidatesFile, encodeJdb(removeTraps(candidates.toTree(), new Set(completed.accepted.map((t) => t.id))))],
    ])
    committed = commitBases(root, SUBJECT, [...summary, '', engineInfo, options].join('\n'))
  } catch (err) {
    const files = `${TRAPS_FILE} ${CANDIDATES_FILE}`
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0]
    throw new Error(`The results may already be written to ${TRAPS_FILE} and ${CANDIDATES_FILE}. Commit them with: git commit -- ${files} or discard them with: git restore -- ${files}\n${first}`)
  }
  log('')
  log(committed ? 'Committed. Next: git push (git push -u origin HEAD for a new branch)' : 'The base files did not change: nothing to commit.')
  return { committed }
}
