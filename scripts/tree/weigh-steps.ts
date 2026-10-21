import { humanProfile, indexToVertex, PASS_INDEX, PLAYER_LEVELS, vertexToIndex, type Vertex } from '@joseki-dojo/shared'
import { EngineError, type AnalysisEngine } from '../../packages/server/src/engine/engine'
import type { KataGoQueryBody } from '../../packages/server/src/engine/katago-types'
import { baseQuery } from '../../packages/server/src/engine/query'
import { encodeWeights, type GraphWeights, type JosekiGraph } from '../../packages/server/src/graph/format'
import { pathMoves, type ZoneMove } from '../../packages/server/src/graph/key'
import { moveText, zoneIndex } from '../../packages/server/src/jdb'
import { resultGitProblem, saveResult } from '../gpu-run'

export const GRAPH_FILE = 'packages/server/bases/joseki-graph.bin'
export const WEIGHTS_FILE = 'packages/server/bases/joseki-weights.bin'
const SUBJECT = 'feat(graph): measure the move probabilities of the joseki graph with KataGo'
/**
 * The nodes queried at once, each with all its levels: KataGo queues the queries it cannot run yet, so enough of them in
 * flight keep its analysis threads busy; the bound keeps the memory and the resend after a KataGo restart small.
 */
const NODES_IN_FLIGHT = 32
const PROGRESS_EVERY = 1000
/** The nodes with the largest rest named in the report (among those with at least MANY_EDGES edges). */
const LARGEST_REST = 5
/** A node with this many recorded moves or more has a rest that means something: the rest of a leaf is 1 and that of a one-move node is large. */
const MANY_EDGES = 3

/** The policy points outside the corner zone, and the pass: together they are the tenuki edge. */
const OUTSIDE: number[] = [...Array.from({ length: PASS_INDEX }, (_, i) => i).filter((i) => zoneIndex(indexToVertex(i) as Vertex) === null), PASS_INDEX]

/** Spec (progress) 3.3: why the run could not commit the weights here, or null; the graph file is read and stamped into the weights, so it must be committed. */
export const gitProblem = (root: string): string | null => resultGitProblem(root, WEIGHTS_FILE, 'tree-gpu-run', [GRAPH_FILE])

const DEFAULT_THREADS = 16

/** `npm run tree:gpu [--threads N]`: the number of KataGo analysis threads (one-visit queries need many to fill the GPU). */
export function parseTreeOptions(args: readonly string[]): { threads: number } {
  if (args.length === 0) return { threads: DEFAULT_THREADS }
  const threads = Number(args[1])
  if (args.length !== 2 || args[0] !== '--threads' || !Number.isInteger(threads) || threads < 1) throw new Error('npm run tree:gpu takes only --threads N (a positive integer)')
  return { threads }
}

/**
 * KataGo config overrides for this run only: `threads` analysis threads, each with one search thread (a one-visit query
 * needs no more) and a batch size that lets the threads' queries form one GPU batch, and one fixed symmetry (twin edges
 * are not perturbed; the GPU batching still makes reruns differ a little).
 */
export const treeEngineOverrides = (threads: number): Record<string, number | boolean> => ({
  numAnalysisThreads: threads,
  numSearchThreadsPerAnalysisThread: 1,
  nnMaxBatchSize: Math.max(16, threads),
  nnRandomize: false,
})

/** A query that failed with the engine (it restarts and resends what was pending) is asked once more before it fails the run. */
async function analyzeRetrying(engine: AnalysisEngine, query: KataGoQueryBody): ReturnType<AnalysisEngine['analyze']> {
  try {
    return await engine.analyze(query)
  } catch (err) {
    if (!(err instanceof EngineError) || err.code !== 'engine_failed') throw err
    return engine.analyze(query)
  }
}

/** Spec (progress) 3.3: the query of a node at a level — the node's path replayed (a tenuki is a pass), one visit, the level's human policy. */
export function nodeQuery(path: readonly ZoneMove[], level: string): KataGoQueryBody {
  return { ...baseQuery(pathMoves(path)), maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: humanProfile(level) } }
}

/**
 * Spec (progress) 3.3: the probabilities of a node's edge moves in the human policy of its position (362 values, -1 at
 * an illegal point): a zone point is its policy value, tenuki the policy outside the zone plus the pass; the rest is
 * 1 minus their sum, not below 0. The moves are in the orientation of the node's path, so they are read as they are.
 */
export function moveProbabilities(policy: readonly number[], moves: readonly ZoneMove[]): { edges: number[]; rest: number } {
  if (policy.length !== PASS_INDEX + 1) throw new Error(`A human policy of ${policy.length} values, not ${PASS_INDEX + 1}`)
  const at = (i: number): number => Math.max(0, policy[i])
  const edges = moves.map((m) => (m === 'tenuki' ? Math.min(1, OUTSIDE.reduce((s, i) => s + at(i), 0)) : at(vertexToIndex(m))))
  return { edges, rest: Math.max(0, 1 - edges.reduce((s, p) => s + p, 0)) }
}

/**
 * Spec (progress) 3.3: the probabilities of every edge and the rest of every node at every level, one one-visit query
 * per node and level, NODES_IN_FLIGHT nodes at a time; the progress every 1 000 nodes. The first failed query ends the
 * run: no node starts after it.
 */
export async function weighGraph(engine: AnalysisEngine, graph: JosekiGraph, log: (line: string) => void): Promise<GraphWeights> {
  const levels = [...PLAYER_LEVELS]
  const edge = levels.map(() => new Float32Array(graph.edges.length))
  const rest = levels.map(() => new Float32Array(graph.nodes.length))
  // The edges are grouped by node in node order: node n has edges[first[n]] .. edges[first[n + 1] - 1].
  const first = new Int32Array(graph.nodes.length + 1)
  for (const e of graph.edges) first[e.from + 1]++
  for (let n = 0; n < graph.nodes.length; n++) first[n + 1] += first[n]

  const total = graph.nodes.length
  const started = Date.now()
  let next = 0
  let done = 0
  let failed = false
  const weigh = async (n: number): Promise<void> => {
    const moves = graph.edges.slice(first[n], first[n + 1]).map((e) => e.move)
    await Promise.all(
      levels.map(async (level, l) => {
        const { humanPolicy } = await analyzeRetrying(engine, nodeQuery(graph.nodes[n].path, level))
        if (!humanPolicy) throw new Error(`KataGo returned no human policy for ${humanProfile(level)}`)
        const p = moveProbabilities(humanPolicy, moves)
        edge[l].set(p.edges, first[n])
        rest[l][n] = p.rest
      }),
    )
  }
  const worker = async (): Promise<void> => {
    while (!failed && next < total) {
      try {
        await weigh(next++)
      } catch (err) {
        failed = true
        throw err
      }
      done++
      if (done % PROGRESS_EVERY === 0 || done === total) {
        const elapsed = (Date.now() - started) / 60000
        const left = (elapsed / done) * (total - done)
        log(`  ${done}/${total} nodes, ${Math.round(elapsed)} min, about ${Math.round(left)} min left`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(NODES_IN_FLIGHT, total) }, worker))
  return { levels, edge, rest }
}

const pathText = (path: readonly ZoneMove[]): string => (path.length === 0 ? 'the empty corner' : path.map(moveText).join(' '))

const fixed = (x: number | null): string => (x === null ? '-' : x.toFixed(3))

/**
 * Spec (progress) 3.3: the report, also the body of the commit. A leaf (no edges) has the rest 1 and a node with one
 * recorded move a large one, so the means are over the nodes with at least one edge and with at least three, and over
 * the nodes with and without a tenuki in the path (a tenuki is replayed as a pass: those probabilities are less
 * reliable); the largest rests are named among the nodes with at least three edges, at the middle level.
 */
export function weightsReport(graph: JosekiGraph, weights: GraphWeights, minutes: number): string[] {
  const { levels } = weights
  const nodes = graph.nodes.length
  const edgeCount = new Int32Array(nodes)
  for (const e of graph.edges) edgeCount[e.from]++
  const tenuki = graph.nodes.map((n) => n.path.includes('tenuki'))
  const all = Array.from({ length: nodes }, (_, n) => n)
  const leaves = all.filter((n) => edgeCount[n] === 0)
  const branching = all.filter((n) => edgeCount[n] >= 1)
  const many = all.filter((n) => edgeCount[n] >= MANY_EDGES)
  const withTenuki = branching.filter((n) => tenuki[n])
  const withoutTenuki = branching.filter((n) => !tenuki[n])
  const mean = (a: Float32Array, of: readonly number[]): number | null => (of.length === 0 ? null : of.reduce((sum, n) => sum + a[n], 0) / of.length)
  const middle = levels.length >> 1
  const largest = many
    .map((n) => ({ r: weights.rest[middle]?.[n] ?? 0, n }))
    .sort((a, b) => b.r - a.r || a.n - b.n)
    .slice(0, LARGEST_REST)
  return [
    `Nodes ${nodes}, edges ${graph.edges.length}, levels ${levels.length} (${levels[0]} … ${levels[levels.length - 1]}), ${nodes * levels.length} queries, ${minutes.toFixed(1)} minutes`,
    `Leaves (no edges, rest 1): ${leaves.length}; with at least one edge: ${branching.length}; with at least ${MANY_EDGES}: ${many.length}; with a tenuki in the path: ${tenuki.filter(Boolean).length}`,
    'Mean rest probability by level: leaves, then over the nodes with at least one edge, with at least three, with a tenuki in the path, without:',
    ...levels.map(
      (level, l) =>
        `  ${level.padEnd(5)}leaves ${leaves.length}  1+ edges ${fixed(mean(weights.rest[l], branching))}  ${MANY_EDGES}+ edges ${fixed(mean(weights.rest[l], many))}  tenuki ${fixed(mean(weights.rest[l], withTenuki))}  no tenuki ${fixed(mean(weights.rest[l], withoutTenuki))}`,
    ),
    `The largest rest at ${levels[middle]} among the nodes with at least ${MANY_EDGES} edges:`,
    ...(largest.length === 0 ? ['  none'] : largest.map(({ r, n }) => `  ${r.toFixed(3)}  node ${n}: ${pathText(graph.nodes[n].path)}`)),
  ]
}

export interface WeighingRun {
  root: string
  engine: AnalysisEngine
  /** The decoded graph file: the weights file names it by its checksum. */
  graph: JosekiGraph
  /** KataGo version and network names, for the log and the commit. */
  engineInfo: string
  log: (line: string) => void
}

/** Spec (progress) 3.3: measures the graph at every level, writes the weights file and commits it. An engine failure writes nothing. */
export async function runWeighing({ root, engine, graph, engineInfo, log }: WeighingRun): Promise<{ committed: boolean }> {
  const started = Date.now()
  const levels = PLAYER_LEVELS
  log(
    `Measuring ${levels.length} levels (${levels[0]} … ${levels[levels.length - 1]}) on ${graph.nodes.length} nodes and ${graph.edges.length} edges: ${graph.nodes.length * levels.length} queries of one visit`,
  )
  log(`Started at ${new Date(started).toLocaleString()}`)
  const weights = await weighGraph(engine, graph, log)
  const bytes = encodeWeights(weights, graph)
  const report = weightsReport(graph, weights, (Date.now() - started) / 60000)
  log('')
  for (const line of report) log(line)

  const committed = await saveResult(root, WEIGHTS_FILE, bytes, SUBJECT, [...report, '', engineInfo].join('\n'))
  log('')
  log(committed ? 'Committed. Next: git push (git push -u origin HEAD for a new branch)' : 'The weights did not change: nothing to commit.')
  return { committed }
}
