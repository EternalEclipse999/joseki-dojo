import { gtpToVertex, inZone, otherColor, type Actor, type Color, type Move, type MoveVertex, type PlayedMove, type ResolvedSettings, type ReviewData, type Vertex } from '@joseki-dojo/shared'
import type { Thresholds } from '../config'
import { GraphBook } from '../graph/book'
import { lineGraph, walkGraph, type LineEdge } from '../graph/fixture'
import { encodeGraph, encodeWeights, type GraphWeights, type JosekiGraph } from '../graph/format'
import { trainingKey } from '../graph/key'
import { fromTopRight, mirrorDiagonal } from '../jdb'
import { categorize } from '../review/compute'
import { movesBefore, type SessionRecord } from '../store/records'

export const TEST_THRESHOLDS: Thresholds = { inaccuracy: 0.5, mistake: 2, blunder: 5, punished: 1 }

/** walkGraph() as a book, without weights. */
export const walkBook = (): GraphBook => GraphBook.load(encodeGraph(walkGraph()), null)

/** Probabilities of `graph` at `levels`, the same at each: at every node, each edge and the rest equally likely. */
export function uniformWeights(graph: JosekiGraph, levels: string[]): GraphWeights {
  const counts = new Int32Array(graph.nodes.length)
  for (const e of graph.edges) counts[e.from]++
  const edge = Float32Array.from(graph.edges, (e) => 1 / (counts[e.from] + 1))
  const rest = Float32Array.from(counts, (c) => 1 / (c + 1))
  return { levels, edge: levels.map(() => edge), rest: levels.map(() => rest) }
}

/** An edge of lineGraph with its probability `p` at the level of weightedBook. */
export type WeightedEdge = LineEdge & { p: number }

/** lineGraph(specs, lists) as a book whose edges have their probabilities `p` at `level` (the rest of a node: 1 minus their sum). */
export function weightedBook(specs: WeightedEdge[], lists: Record<string, string[]> = {}, level = '5k'): GraphBook {
  const { graph, edges } = lineGraph(specs, lists)
  const edge = Float32Array.from(edges, (e) => e.p)
  const sums = new Float64Array(graph.nodes.length)
  graph.edges.forEach((e, i) => (sums[e.from] += edge[i]))
  const rest = Float32Array.from(sums, (s) => Math.max(0, 1 - s))
  return GraphBook.load(encodeGraph(graph), encodeWeights({ levels: [level], edge: [edge], rest: [rest] }, graph))
}

/** A training move: a top-right point (GTP) or 'tenuki', its loss (default 0), and whether it was the engine's first choice. */
export type Step = [move: string, loss?: number, best?: boolean]

export interface TrainingShape {
  id?: string
  parentSessionId?: string | null
  /** The moves before turn 0, as top-right points like the steps. */
  initial?: string[]
  /** Every move (not a tenuki) mirrored in the top-right corner's diagonal before it is put in the corner. */
  mirror?: boolean
  /** The colour of the first move (default Black): White for a training with swapped colours. */
  first?: Color
  settings?: Partial<ResolvedSettings>
}

/**
 * A finished training and its review. Colours alternate from `first` over the initial moves and the steps; a step of the
 * user's colour is the user's ('auto-tenuki' for a tenuki), the others the bot's. A tenuki is played far from the corner,
 * on a fresh point each time. The losses are categorised with TEST_THRESHOLDS.
 */
export function training(steps: Step[], shape: TrainingShape = {}): [SessionRecord, ReviewData] {
  const settings: ResolvedSettings = { mode: 'free', environment: 'empty', userColor: 'B', botRank: '5k', corner: 'TR', ...shape.settings }
  const { corner, userColor } = settings
  let outside = 0
  const place = (m: string): MoveVertex => {
    if (m === 'tenuki') return fromTopRight([3 + outside++, 15], corner)
    const v = gtpToVertex(m) as Vertex
    return fromTopRight(shape.mirror ? mirrorDiagonal(v) : v, corner)
  }
  const first = shape.first ?? 'B'
  const colorAt = (i: number): Color => (i % 2 === 0 ? first : otherColor(first))
  const initialMoves: Move[] = (shape.initial ?? []).map((m, i) => ({ color: colorAt(i), vertex: place(m) }))
  const moves: PlayedMove[] = steps.map(([m], t) => {
    const color = colorAt(initialMoves.length + t)
    const vertex = place(m)
    const actor: Actor = color !== userColor ? 'bot' : m === 'tenuki' ? 'auto-tenuki' : 'user'
    return { color, vertex, actor, inZone: inZone(corner, vertex) }
  })
  const id = shape.id ?? 's1'
  const rec: SessionRecord = { id, createdAt: '', finishedAt: '', settings, status: 'finished', parentSessionId: shape.parentSessionId ?? null, initialMoves, moves, summary: null }
  const loss = (t: number): number => steps[t][1] ?? 0
  const review: ReviewData = {
    sessionId: id,
    settings,
    initialMoves,
    moves,
    positions: Array.from({ length: moves.length + 1 }, (_, t) => ({
      turn: t,
      scoreLeadBlack: 0,
      visits: 1,
      candidates: t < moves.length ? [{ vertex: steps[t][2] ? moves[t].vertex : [0, 18], loss: 0, pv: [] }] : [],
      ownership: null,
    })),
    moveReviews: moves.map((m, t) => ({ turn: t, color: m.color, actor: m.actor, vertex: m.vertex, loss: loss(t), category: categorize(loss(t), TEST_THRESHOLDS) })),
    punishments: [],
    summary: { userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 },
  }
  return [rec, review]
}

/** The key of the position before move `turn` of a training. */
export const keyBefore = (rec: SessionRecord, turn: number): string => trainingKey(movesBefore(rec, turn), rec.settings.corner, rec.moves[turn].color).key
