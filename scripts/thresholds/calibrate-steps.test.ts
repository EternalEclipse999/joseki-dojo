import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { humanProfile, indexToVertex, PLAYER_LEVELS } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { calibrate, exceedThreshold, gitProblem, movesToEvaluate, parseCalibrateOptions, sample, smooth, THRESHOLDS_FILE } from './calibrate-steps'

// The git calls must not depend on the developer's own git config (a global commit.gpgsign would hang the commits).
const CONFIG_DIR = mkdtempSync(join(tmpdir(), 'joseki-gitcfg-'))
writeFileSync(join(CONFIG_DIR, 'gitconfig'), '')
process.env.GIT_CONFIG_GLOBAL = join(CONFIG_DIR, 'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM = '1'

describe('calibration helpers', () => {
  it('reads the options over the defaults', () => {
    expect(parseCalibrateOptions([])).toEqual({ positions: 400, visits: 2000, seed: 1, coverage: 0.98 })
    expect(parseCalibrateOptions(['--positions', '50', '--visits', '500', '--seed', '7'])).toEqual({ positions: 50, visits: 500, seed: 7, coverage: 0.98 })
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
