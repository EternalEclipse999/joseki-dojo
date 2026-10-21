import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gtpToVertex, humanProfile, PLAYER_LEVELS, vertexToIndex, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { EngineError } from '../../packages/server/src/engine/engine'
import { decodeGraph, decodeWeights, encodeGraph, type GraphWeights, type JosekiGraph } from '../../packages/server/src/graph/format'
import { testGraph, testWeights } from '../../packages/server/src/graph/fixture'
import { StubEngine } from '../../packages/server/test/helpers'
import { gitProblem, GRAPH_FILE, moveProbabilities, nodeQuery, parseTreeOptions, runWeighing, treeEngineOverrides, weighGraph, weightsReport, WEIGHTS_FILE } from './weigh-steps'

// The git calls must not depend on the developer's own git config (a global commit.gpgsign would hang the commits).
const CONFIG_DIR = mkdtempSync(join(tmpdir(), 'joseki-gitcfg-'))
writeFileSync(join(CONFIG_DIR, 'gitconfig'), '')
process.env.GIT_CONFIG_GLOBAL = join(CONFIG_DIR, 'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const v = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
/** A human policy: the given points (GTP, or `pass`), 0 elsewhere, -1 at the occupied `taken`. */
function policy(values: Record<string, number>, taken: string[] = []): number[] {
  const p = new Array<number>(362).fill(0)
  for (const [gtp, x] of Object.entries(values)) p[gtp === 'pass' ? 361 : vertexToIndex(v(gtp))] = x
  for (const gtp of taken) p[vertexToIndex(v(gtp))] = -1
  return p
}
const close = (xs: number[], digits = 6): unknown[] => xs.map((x) => expect.closeTo(x, digits))

describe('nodeQuery', () => {
  it("replays the node's path with a pass for a tenuki and asks one visit of the level's human policy", () => {
    expect(nodeQuery([v('Q16'), 'tenuki', v('R14')], '5k')).toEqual({
      moves: [
        ['B', 'Q16'],
        ['W', 'pass'],
        ['B', 'R14'],
      ],
      rules: 'chinese',
      komi: 7.5,
      boardXSize: 19,
      boardYSize: 19,
      maxVisits: 1,
      includePolicy: true,
      overrideSettings: { humanSLProfile: 'rank_5k' },
    })
    expect(nodeQuery([], 'pro')).toMatchObject({ moves: [], overrideSettings: { humanSLProfile: 'proyear_2023' } })
  })
})

describe('moveProbabilities', () => {
  it('reads a zone edge at its point, tenuki as the policy outside the zone plus the pass, and the rest as 1 minus their sum', () => {
    // Zone (J..T, 19..9): the edges R17 0.3 and Q14 0.2, the corner of the zone J9 0.25 (no edge); outside: H9 and T8 next
    // to the zone, D4, the pass; Q16 and C3 are occupied.
    const p = policy({ R17: 0.3, Q14: 0.2, J9: 0.25, H9: 0.05, T8: 0.05, D4: 0.05, pass: 0.1 }, ['Q16', 'C3'])
    const { edges, rest } = moveProbabilities(p, [v('R17'), v('Q14'), 'tenuki'])
    expect(edges).toEqual(close([0.3, 0.2, 0.25], 12))
    expect(rest).toBeCloseTo(0.25, 12)
  })

  it('keeps the rest at 0 or more and tenuki at 1 or less', () => {
    expect(moveProbabilities(policy({ R17: 0.7, Q14: 0.6 }), [v('R17'), v('Q14')]).rest).toBe(0)
    expect(moveProbabilities(policy({ D4: 0.6, D16: 0.4000001 }), ['tenuki'])).toEqual({ edges: [1], rest: 0 })
  })

  it('refuses a policy of another size', () => {
    expect(() => moveProbabilities([0.5, 0.5], ['tenuki'])).toThrow('A human policy of 2 values, not 362')
  })
})

// The weakest level plays the test graph one way, every other level another (testGraph: edges Q16 | O17 R14 R17 | tenuki).
const WEAK = policy({ Q16: 0.1, O17: 0.5, R14: 0.25, R17: 0.05, A1: 0.04, pass: 0.06 })
const OTHER = policy({ Q16: 0.3, O17: 0.2, R14: 0.2, R17: 0.1, D4: 0.15, pass: 0.05 })
function stubEngine(): StubEngine {
  const engine = new StubEngine()
  engine.human = (q) => (q.overrideSettings?.humanSLProfile === humanProfile(PLAYER_LEVELS[0]) ? WEAK : OTHER)
  return engine
}

describe('weighGraph', () => {
  it('measures every edge of every node at every level with one one-visit query per node and level', async () => {
    const engine = stubEngine()
    const lines: string[] = []
    const w = await weighGraph(engine, testGraph(), (line) => lines.push(line))
    expect(w.levels).toEqual(PLAYER_LEVELS)
    expect(Array.from(w.edge[0])).toEqual(close([0.1, 0.5, 0.25, 0.05, 0.1]))
    expect(Array.from(w.rest[0])).toEqual(close([0.9, 0.2, 0.9]))
    for (const l of [1, PLAYER_LEVELS.length - 1]) {
      expect(Array.from(w.edge[l])).toEqual(close([0.3, 0.2, 0.2, 0.1, 0.2]))
      expect(Array.from(w.rest[l])).toEqual(close([0.7, 0.5, 0.8]))
    }
    expect(engine.queries).toHaveLength(3 * PLAYER_LEVELS.length)
    expect(engine.queries.every((q) => q.maxVisits === 1 && q.includePolicy === true)).toBe(true)
    // Node 2 is kept as Q16 R14 (the mirror of Q16 O17): its path is replayed as it is, once per level.
    const node2 = engine.queries.filter((q) => q.moves.length === 2)
    expect(node2.map((q) => q.moves)).toEqual(PLAYER_LEVELS.map(() => [['B', 'Q16'], ['W', 'R14']]))
    expect(node2.map((q) => q.overrideSettings?.humanSLProfile).sort()).toEqual(PLAYER_LEVELS.map(humanProfile).sort())
    expect(lines).toEqual(['  3/3 nodes, 0 min, about 0 min left'])
  })

  it('logs the progress every 1 000 nodes with the time left', async () => {
    const node = { key: 'B:', toMove: 'B' as const, path: [], listIds: [] }
    const graph: JosekiGraph = { nodes: Array.from({ length: 2500 }, () => node), edges: [] }
    const answer = { humanPolicy: policy({ pass: 1 }) }
    const lines: string[] = []
    await weighGraph({ analyze: async () => answer } as never, graph, (line) => lines.push(line))
    expect(lines).toEqual(['  1000/2500 nodes, 0 min, about 0 min left', '  2000/2500 nodes, 0 min, about 0 min left', '  2500/2500 nodes, 0 min, about 0 min left'])
  })

  it('asks a query once more after the engine failed, and fails the run when it fails again', async () => {
    const engine = stubEngine()
    engine.fail = { when: (q) => q.moves.length === 1, error: new EngineError({ key: 'error.engine.restarted' }, 'engine_failed') }
    const w = await weighGraph(engine, testGraph(), () => {})
    expect(Array.from(w.rest[1])).toEqual(close([0.7, 0.5, 0.8]))
    expect(engine.queries).toHaveLength(3 * PLAYER_LEVELS.length + 1)

    let calls = 0
    const broken = {
      analyze: async () => {
        calls++
        throw new EngineError({ key: 'error.engine.restarted' }, 'engine_failed')
      },
    }
    await expect(weighGraph(broken as never, testGraph(), () => {})).rejects.toBeInstanceOf(EngineError)
    expect(calls).toBeLessThanOrEqual(2 * 32 * PLAYER_LEVELS.length)

    const other = stubEngine()
    other.fail = { when: () => true, error: new EngineError({ key: 'error.engine.restarted' }, 'query_error') }
    await expect(weighGraph(other, testGraph(), () => {})).rejects.toBeInstanceOf(EngineError)
    expect(other.queries).toHaveLength(3 * PLAYER_LEVELS.length)
  })

  it('stops at an answer without a human policy', async () => {
    const engine = { analyze: async () => ({ rootInfo: { scoreLead: 0 }, moveInfos: [] }) }
    await expect(weighGraph(engine as never, testGraph(), () => {})).rejects.toThrow(/^KataGo returned no human policy for rank_20k$/)
  })
})

describe('weightsReport', () => {
  it('gives the means by level over the nodes with an edge, three edges, and with and without a tenuki, and the largest rests among the nodes with three edges', () => {
    expect(weightsReport(testGraph(), testWeights(), 1.5)).toEqual([
      'Nodes 3, edges 5, levels 2 (5k … 1d), 6 queries, 1.5 minutes',
      'Leaves (no edges, rest 1): 0; with at least one edge: 3; with at least 3: 1; with a tenuki in the path: 0',
      'Mean rest probability by level: leaves, then over the nodes with at least one edge, with at least three, with a tenuki in the path, without:',
      '  5k   leaves 0  1+ edges 0.600  3+ edges 0.450  tenuki -  no tenuki 0.600',
      '  1d   leaves 0  1+ edges 0.148  3+ edges 0.043  tenuki -  no tenuki 0.148',
      'The largest rest at 1d among the nodes with at least 3 edges:',
      '  0.043  node 1: Q16',
    ])
  })

  it('counts the leaves apart and separates the nodes with a tenuki in the path', () => {
    const at = (path: JosekiGraph['nodes'][number]['path']): JosekiGraph['nodes'][number] => ({ key: `k${path.length}${path.join('')}`, toMove: 'B', path, listIds: [] })
    const edge = (from: number, move: JosekiGraph['edges'][number]['move']): JosekiGraph['edges'][number] => ({ from, to: null, move, categories: [{ source: 0, category: 'ideal' }] })
    // Node 0: the empty corner, three edges; node 1: after a tenuki, one edge; node 2: Q16, a leaf; node 3: after a tenuki, a leaf.
    const graph: JosekiGraph = { nodes: [at([]), at(['tenuki']), at([v('Q16')]), at(['tenuki', 'tenuki'])], edges: [edge(0, v('Q16')), edge(0, v('D4')), edge(0, 'tenuki'), edge(1, v('Q16'))] }
    const weights: GraphWeights = { levels: ['5k', '1d'], edge: [new Float32Array(4), new Float32Array(4)], rest: [Float32Array.from([0.5, 0.25, 1, 1]), Float32Array.from([0.5, 0.75, 1, 1])] }
    expect(weightsReport(graph, weights, 0)).toEqual([
      'Nodes 4, edges 4, levels 2 (5k … 1d), 8 queries, 0.0 minutes',
      'Leaves (no edges, rest 1): 2; with at least one edge: 2; with at least 3: 1; with a tenuki in the path: 2',
      'Mean rest probability by level: leaves, then over the nodes with at least one edge, with at least three, with a tenuki in the path, without:',
      '  5k   leaves 2  1+ edges 0.375  3+ edges 0.500  tenuki 0.250  no tenuki 0.500',
      '  1d   leaves 2  1+ edges 0.625  3+ edges 0.500  tenuki 0.750  no tenuki 0.500',
      'The largest rest at 1d among the nodes with at least 3 edges:',
      '  0.500  node 0: the empty corner',
    ])
  })

  it('names no node when none has three edges', () => {
    const graph: JosekiGraph = { nodes: [{ key: 'B:', toMove: 'B', path: [], listIds: [] }], edges: [] }
    const weights: GraphWeights = { levels: ['5k'], edge: [new Float32Array(0)], rest: [Float32Array.from([1])] }
    expect(weightsReport(graph, weights, 0).slice(-3)).toEqual(['  5k   leaves 1  1+ edges -  3+ edges -  tenuki -  no tenuki -', 'The largest rest at 5k among the nodes with at least 3 edges:', '  none'])
  })
})

/** The identity configured in the repository; the last commit is by someone else. */
const CONFIGURED = { name: 'Weights Author', email: '1+author@users.noreply.github.com' }
const OTHER_AUTHOR = { name: 'Someone Else', email: '2+other@users.noreply.github.com' }
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A repository on branch feat/x configured with CONFIGURED, with the test graph committed by OTHER_AUTHOR and no weights yet. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'joseki-tree-'))
  git(root, 'init', '-q')
  git(root, 'checkout', '-q', '-b', 'feat/x')
  git(root, 'config', 'user.name', CONFIGURED.name)
  git(root, 'config', 'user.email', CONFIGURED.email)
  mkdirSync(dirname(join(root, GRAPH_FILE)), { recursive: true })
  writeFileSync(join(root, GRAPH_FILE), encodeGraph(testGraph()))
  git(root, 'add', '-A')
  git(root, '-c', `user.name=${OTHER_AUTHOR.name}`, '-c', `user.email=${OTHER_AUTHOR.email}`, 'commit', '-q', '-m', 'init')
  return root
}

describe('the weights run', () => {
  it('refuses main and an uncommitted weights file', () => {
    const root = repo()
    expect(gitProblem(root)).toBeNull()
    writeFileSync(join(root, WEIGHTS_FILE), 'x')
    expect(gitProblem(root)).toMatch(/^Uncommitted changes in packages\/server\/bases\/joseki-weights.bin/)
    git(root, 'checkout', '-q', '-b', 'main')
    expect(gitProblem(root)).toMatch(/^You are on main: .*git switch -c tree-gpu-run/)
  })

  it('refuses a changed or untracked graph file', () => {
    const root = repo()
    writeFileSync(join(root, GRAPH_FILE), 'changed')
    expect(gitProblem(root)).toMatch(/^Uncommitted changes in packages\/server\/bases\/joseki-weights.bin, packages\/server\/bases\/joseki-graph.bin:\nM packages/)
    git(root, 'rm', '-q', '--cached', GRAPH_FILE)
    expect(gitProblem(root)).toMatch(/\?\? packages\/server\/bases\/joseki-graph.bin/)
  })

  it('takes --threads and overrides the engine for this run only', () => {
    expect(parseTreeOptions([])).toEqual({ threads: 16 })
    expect(parseTreeOptions(['--threads', '24'])).toEqual({ threads: 24 })
    expect(() => parseTreeOptions(['--threads', '0'])).toThrow(/--threads N/)
    expect(() => parseTreeOptions(['--x'])).toThrow(/--threads N/)
    expect(treeEngineOverrides(24)).toEqual({ numAnalysisThreads: 24, numSearchThreadsPerAnalysisThread: 1, nnMaxBatchSize: 24, nnRandomize: false })
    expect(treeEngineOverrides(8)).toMatchObject({ numAnalysisThreads: 8, nnMaxBatchSize: 16 })
  })

  it("writes the weights of the graph and commits only them, with the repository's configured identity", async () => {
    const root = repo()
    const graph = decodeGraph(readFileSync(join(root, GRAPH_FILE)))
    const lines: string[] = []
    const run = () => runWeighing({ root, engine: stubEngine(), graph, engineInfo: 'KataGo test', log: (line) => lines.push(line) })
    expect(await run()).toEqual({ committed: true })

    const w = decodeWeights(readFileSync(join(root, WEIGHTS_FILE)), graph)
    expect(w.levels).toEqual(PLAYER_LEVELS)
    expect(Array.from(w.edge[0])).toEqual(close([0.1, 0.5, 0.25, 0.05, 0.1], 4))
    expect(Array.from(w.rest[1])).toEqual(close([0.7, 0.5, 0.8], 4))
    const configured = `${CONFIGURED.name} <${CONFIGURED.email}>`
    expect(git(root, 'log', '-1', '--format=%an <%ae>|%cn <%ce>|%s')).toBe(`${configured}|${configured}|feat(graph): measure the move probabilities of the joseki graph with KataGo`)
    expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe(WEIGHTS_FILE)
    const body = git(root, 'log', '-1', '--format=%b')
    expect(body).toContain('Mean rest probability by level:')
    expect(body.endsWith('KataGo test')).toBe(true)
    expect(lines.at(-1)).toBe('Committed. Next: git push (git push -u origin HEAD for a new branch)')

    // The same probabilities again: the file does not change.
    expect(await run()).toEqual({ committed: false })
    expect(lines.at(-1)).toBe('The weights did not change: nothing to commit.')
  })
})
