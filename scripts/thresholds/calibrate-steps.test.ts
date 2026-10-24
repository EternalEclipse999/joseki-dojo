import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

// The git calls must not depend on the developer's own git config (a global commit.gpgsign would hang the commits).
const CONFIG_DIR = mkdtempSync(join(tmpdir(), 'joseki-gitcfg-'))
writeFileSync(join(CONFIG_DIR, 'gitconfig'), '')
process.env.GIT_CONFIG_GLOBAL = join(CONFIG_DIR, 'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM = '1'

describe('calibration helpers', () => {
  it('reads the options over the defaults', () => {
    expect(parseCalibrateOptions([])).toEqual({ positions: 400, visits: 2000, seed: 1, coverage: 0.98, restart: false })
    expect(parseCalibrateOptions(['--positions', '50', '--visits', '500', '--seed', '7'])).toEqual({ positions: 50, visits: 500, seed: 7, coverage: 0.98, restart: false })
    expect(parseCalibrateOptions(['--restart', '--visits', '500'])).toEqual({ positions: 400, visits: 500, seed: 1, coverage: 0.98, restart: true })
    expect(parseCalibrateOptions(['--visits', '500', '--restart'])).toMatchObject({ visits: 500, restart: true })
    expect(() => parseCalibrateOptions(['--level', '5k'])).toThrow('Unknown option --level')
    expect(() => parseCalibrateOptions(['--visits'])).toThrow('--visits needs a value')
    expect(() => parseCalibrateOptions(['--visits', '0'])).toThrow('--visits needs a positive whole number')
  })

  it('samples the same items for the same seed', () => {
    const items = Array.from({ length: 100 }, (_, i) => i)
    expect(sample(items, 10, 3)).toEqual(sample(items, 10, 3))
    expect(new Set(sample(items, 10, 3)).size).toBe(10)
    expect(sample(items, 500, 3)).toHaveLength(100)
  })

  it('evaluates the moves that cover the share of every policy', () => {
    // Two policies over 5 points; -1 marks an occupied point.
    const a = [0.6, 0.3, 0.05, 0.05, -1]
    const b = [0.1, 0.1, 0.1, 0.7, -1]
    expect(movesToEvaluate([a], 0.9)).toEqual([0, 1])
    expect(movesToEvaluate([a, b], 0.9).sort()).toEqual([0, 1, 2, 3])
  })

  it('finds the loss exceeded by a weighted share of moves', () => {
    const samples = [
      { loss: 0, weight: 0.5 },
      { loss: 1, weight: 0.3 },
      { loss: 4, weight: 0.15 },
      { loss: 10, weight: 0.05 },
    ]
    // Exceeded by at most 25 %: losses above 1 weigh 0.2; above 0 weigh 0.5.
    expect(exceedThreshold(samples, 0.25)).toBe(1)
    expect(exceedThreshold(samples, 0.1)).toBe(4)
    expect(exceedThreshold(samples, 0.03)).toBe(10)
  })

  it('rounds, floors and keeps thresholds from growing with the level', () => {
    const raw = Object.fromEntries(PLAYER_LEVELS.map((l) => [l, { inaccuracy: 0.52, mistake: 2.01, blunder: 4.98 }]))
    raw['1d'] = { inaccuracy: 0.6, mistake: 2.4, blunder: 6 }
    raw.pro = { inaccuracy: 0.01, mistake: 0.02, blunder: 0.03 }
    const { levels, notes } = smooth(raw)
    expect(levels['20k']).toEqual({ inaccuracy: 0.5, mistake: 2, blunder: 5 })
    expect(levels['1d']).toEqual({ inaccuracy: 0.5, mistake: 2, blunder: 5 })
    expect(levels.pro).toEqual({ inaccuracy: 0.05, mistake: 0.1, blunder: 0.15 })
    expect(notes.some((n) => n.startsWith('1d: '))).toBe(true)
    expect(notes).toContain('pro: inaccuracy 0.01 lifted to 0.05 (floor)')
    expect(notes).toContain('pro: mistake 0.05 lifted to 0.1 (inaccuracy < mistake)')
    expect(notes).toContain('pro: blunder 0.05 lifted to 0.15 (mistake < blunder)')
  })
})

describe('calibrate', () => {
  it('turns the losses of the weighted moves into thresholds per level', async () => {
    // Every level plays the point index 0 with 0.7 and index 1 with 0.3; index 1 loses 3 points.
    const engine = {
      analyze: async (q: { moves: [string, string][]; includePolicy?: boolean }) => {
        if (q.includePolicy) {
          const p = new Array(362).fill(0)
          p[0] = 0.7
          p[1] = 0.3
          return { humanPolicy: p, rootInfo: { scoreLead: 0 }, moveInfos: [] }
        }
        const last = q.moves[q.moves.length - 1]?.[1]
        return { rootInfo: { scoreLead: last === 'B19' ? -3 : 0 }, moveInfos: [] }
      },
    }
    const { levels, evaluated } = await calibrate(engine as never, [[]], { positions: 1, visits: 1, seed: 1, coverage: 0.98 }, () => {})
    expect(levels['20k']).toEqual({ inaccuracy: 3, mistake: 3.05, blunder: 3.1 })
    expect(evaluated).toBe(2)
  })

  const OPTS = { positions: 1, visits: 1, seed: 1, coverage: 0.8 }
  const policy = (...head: number[]): number[] => [...head, ...new Array(362 - head.length).fill(0)]

  it('counts a loss for White to move and gives the uncovered tail the worst evaluated loss', async () => {
    // One Black move is played, so White moves; index 1 (B19) hands Black 2 points. The policy 0.6 / 0.2 / 0.1 / 0.1 at coverage 0.8 leaves 0.2 unevaluated.
    const engine = {
      analyze: async (q: { moves: [string, string][]; includePolicy?: boolean }) => {
        if (q.includePolicy) return { humanPolicy: policy(0.6, 0.2, 0.1, 0.1), rootInfo: { scoreLead: 0 }, moveInfos: [] }
        const [color, vertex] = q.moves[q.moves.length - 1]
        return { rootInfo: { scoreLead: color === 'W' && vertex === 'B19' ? 2 : 0 }, moveInfos: [] }
      },
    }
    const { levels, evaluated } = await calibrate(engine as never, [[{ color: 'B', vertex: indexToVertex(100) }]], OPTS, () => {})
    // Losses: 0 (weight 0.6), 2 (0.2) and the tail 2 (0.2): the share above 0 is 0.4, so every threshold is 2.
    expect(levels['20k']).toEqual({ inaccuracy: 2, mistake: 2.05, blunder: 2.1 })
    expect(evaluated).toBe(2)
  })

  it('gives levels with different policies different thresholds', async () => {
    const weakest = humanProfile(PLAYER_LEVELS[0])
    const engine = {
      analyze: async (q: { moves: [string, string][]; includePolicy?: boolean; overrideSettings?: { humanSLProfile?: string } }) => {
        if (q.includePolicy) {
          const humanPolicy = q.overrideSettings?.humanSLProfile === weakest ? policy(0.6, 0.4) : policy(1)
          return { humanPolicy, rootInfo: { scoreLead: 0 }, moveInfos: [] }
        }
        return { rootInfo: { scoreLead: q.moves[q.moves.length - 1]?.[1] === 'B19' ? -3 : 0 }, moveInfos: [] }
      },
    }
    const { levels } = await calibrate(engine as never, [[]], OPTS, () => {})
    expect(levels[PLAYER_LEVELS[0]]).toEqual({ inaccuracy: 3, mistake: 3.05, blunder: 3.1 })
    expect(levels.pro).toEqual({ inaccuracy: 0.05, mistake: 0.1, blunder: 0.15 })
  })

  it('logs the progress with the elapsed and the remaining minutes', async () => {
    const engine = { analyze: async (q: { includePolicy?: boolean }) => ({ humanPolicy: q.includePolicy ? policy(1) : undefined, rootInfo: { scoreLead: 0 }, moveInfos: [] }) }
    const lines: string[] = []
    await calibrate(engine as never, [[], []], OPTS, (l) => lines.push(l))
    expect(lines).toEqual(['  2/2 positions, 0 min, about 0 min left'])
  })
})

/** The identity configured in the repository; the last commit is by someone else. */
const CONFIGURED = { name: 'Table Author', email: '1+author@users.noreply.github.com' }
const OTHER = { name: 'Someone Else', email: '2+other@users.noreply.github.com' }
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A repository on branch feat/x configured with CONFIGURED, with other.txt committed by OTHER and no thresholds file yet. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'joseki-thresholds-'))
  git(root, 'init', '-q')
  git(root, 'checkout', '-q', '-b', 'feat/x')
  git(root, 'config', 'user.name', CONFIGURED.name)
  git(root, 'config', 'user.email', CONFIGURED.email)
  writeFileSync(join(root, 'other.txt'), 'x')
  git(root, 'add', '-A')
  git(root, '-c', `user.name=${OTHER.name}`, '-c', `user.email=${OTHER.email}`, 'commit', '-q', '-m', 'init')
  mkdirSync(dirname(join(root, THRESHOLDS_FILE)), { recursive: true })
  return root
}

describe('the thresholds checks', () => {
  it('refuses main and an uncommitted thresholds file', () => {
    const root = repo()
    expect(gitProblem(root)).toBeNull()
    writeFileSync(join(root, THRESHOLDS_FILE), '{}')
    expect(gitProblem(root)).toMatch(/Uncommitted changes in packages\/server\/bases\/thresholds.json/)
    git(root, 'checkout', '-q', '-b', 'main')
    expect(gitProblem(root)).toMatch(/on main/)
  })
})

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
const IDENTITY: RunIdentity = {
  options: { positions: 3, visits: 1, seed: 1, coverage: 0.98 },
  ids: ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'],
  levels: [...PLAYER_LEVELS],
  code: 'c0dec0dec0dec0dec0dec0dec0dec0dec0dec0de',
}
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
    const lines: string[] = []
    writeFileSync(join(root, '.git', 'index.lock'), '')
    await expect(run(root, lossEngine(), lines)).rejects.toThrow('may already be written')
    expect(readCheckpoint(root)?.positions).toHaveLength(3)
    expect(lines).toContain(
      'All 3 positions stay saved in .gpu-runs/thresholds.jsonl: once packages/server/bases/thresholds.json is discarded, the same command writes and commits the table again; if you commit it by hand, delete the save.',
    )
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
  const quiet = (): void => {}
  const finished: SavedPosition = { i: 0, evaluated: 1, seconds: 1, samples: columns([[0, 1]]) }
  /** Commits `path` (relative to the repository) with `text`. */
  function commit(root: string, path: string, text: string): string {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
    git(root, 'add', path)
    git(root, '-c', `user.name=${OTHER.name}`, '-c', `user.email=${OTHER.email}`, 'commit', '-q', '-m', `change ${path}`)
    return git(root, 'rev-parse', 'HEAD')
  }
  /** A git repository on branch feat/x with the test starts base (three starts) committed at STARTS_FILE. */
  function startsRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'joseki-prepare-'))
    git(root, 'init', '-q')
    git(root, 'checkout', '-q', '-b', 'feat/x')
    git(root, 'config', 'user.name', CONFIGURED.name)
    git(root, 'config', 'user.email', CONFIGURED.email)
    mkdirSync(dirname(join(root, STARTS_FILE)), { recursive: true })
    writeFileSync(join(root, STARTS_FILE), encodeJdb(testStartsTree()))
    git(root, 'add', '-A')
    git(root, '-c', `user.name=${OTHER.name}`, '-c', `user.email=${OTHER.email}`, 'commit', '-q', '-m', 'init')
    return root
  }

  it('samples the starts and has no save at first', () => {
    const root = startsRoot()
    const p = prepareCalibration(root, OPTIONS, quiet)
    expect(p.saved).toBeNull()
    expect(p.identity.options).toEqual({ positions: 2, visits: 10, seed: 1, coverage: 0.98 })
    expect(p.identity.levels).toEqual([...PLAYER_LEVELS])
    expect(p.identity.ids).toHaveLength(2)
    expect(p.identity.code).toBe(git(root, 'rev-parse', 'HEAD'))
    expect(p.positions).toHaveLength(2)
  })

  it('continues the save of the same run, refuses another run and ignores the save with --restart', () => {
    const root = startsRoot()
    const { identity } = prepareCalibration(root, OPTIONS, quiet)
    const save = CheckpointWriter.start(root, { version: 1, ...identity, katago: 'k' })
    save.add(finished)
    save.close()
    expect(prepareCalibration(root, OPTIONS, quiet).saved?.positions).toHaveLength(1)
    expect(() => prepareCalibration(root, { ...OPTIONS, visits: 20 }, quiet)).toThrow(
      'The saved run in .gpu-runs/thresholds.jsonl differs: visits 10 → 20. Run with the same options to continue, or add --restart to start over.',
    )
    expect(prepareCalibration(root, { ...OPTIONS, visits: 20, restart: true }, quiet).saved).toBeNull()
    expect(readCheckpoint(root)?.positions).toHaveLength(1) // --restart replaces the save only when the run starts
  })

  it('treats a save without positions as none', () => {
    const root = startsRoot()
    const { identity } = prepareCalibration(root, OPTIONS, quiet)
    CheckpointWriter.start(root, { version: 1, ...identity, katago: 'k' }).close()
    expect(prepareCalibration(root, { ...OPTIONS, visits: 20 }, quiet).saved).toBeNull()
  })

  it('refuses a save made by other calibration code, not after a commit elsewhere', () => {
    const root = startsRoot()
    const { identity } = prepareCalibration(root, OPTIONS, quiet)
    const old = git(root, 'rev-parse', 'HEAD')
    const save = CheckpointWriter.start(root, { version: 1, ...identity, katago: 'k' })
    save.add(finished)
    save.close()
    commit(root, 'README.md', 'documents')
    expect(prepareCalibration(root, OPTIONS, quiet).saved?.positions).toHaveLength(1)
    const now = commit(root, 'scripts/new-step.ts', 'export {}')
    expect(() => prepareCalibration(root, OPTIONS, quiet)).toThrow(`the calibration code differs (${old.slice(0, 7)} → ${now.slice(0, 7)})`)
  })

  it('logs the damaged lines it drops', () => {
    const root = startsRoot()
    const { identity } = prepareCalibration(root, OPTIONS, quiet)
    const save = CheckpointWriter.start(root, { version: 1, ...identity, katago: 'k' })
    save.add(finished)
    save.close()
    appendFileSync(join(root, CHECKPOINT_FILE), 'nonsense\n')
    const lines: string[] = []
    expect(prepareCalibration(root, OPTIONS, (l) => lines.push(l)).saved?.positions).toHaveLength(1)
    expect(lines).toEqual(['Dropped 1 damaged line from the end of the save: their positions are computed again.'])
  })
})
