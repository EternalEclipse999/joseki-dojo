import { gtpToVertex, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { mulberry32, type Rng } from '../bot/rng'
import type { GraphBook } from '../graph/book'
import { lineKey } from '../graph/fixture'
import { pathMoves, pathToMove, sameZoneMove, toNodeMove, zoneKey, type ZoneMove } from '../graph/key'
import { progressFlow, reachOf } from '../progress/compute'
import { walkBook, weightedBook, type WeightedEdge } from '../progress/fixture'
import { graphWalk } from '../progress/record'
import { habitShares } from './habits'
import { nameOnPath, pathTo, randomTarget, realMoves, startIndex, type GraphPath } from './start'

const DRAWS = 20_000

const v = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
const zoneMove = (m: string): ZoneMove => (m === 'tenuki' ? m : v(m))

/**
 * The path of `book` along `line` (top-right moves from the empty corner) from the node after its first `from` moves: each
 * edge the one of its move in its node's orientation, as a training's walk finds it.
 */
function pathOf(book: GraphBook, line: string[], from = 0): GraphPath {
  const moves = line.map(zoneMove)
  const nodes = [book.node(lineKey(line.slice(0, from)))!]
  const edges: number[] = []
  for (let i = from; i < moves.length; i++) {
    const node = nodes[nodes.length - 1]
    const before = moves.slice(0, i)
    const move = toNodeMove(moves[i], 'TR', zoneKey(pathMoves(before), pathToMove(before)).mirrored)
    const k = book.edges(node).findIndex((e) => sameZoneMove(e.move, move))
    if (k < 0) throw new Error(`No edge ${line[i]} after ${line.slice(0, i).join(' ')}`)
    edges.push(book.firstEdge(node) + k)
    nodes.push(book.edgeTarget(book.firstEdge(node) + k))
  }
  return { nodes, edges }
}

/**
 * The player is White. The empty corner (Black, the bot): Q16 (p 0.5) to A, R16 (p 0.3) to the leaf H, the rest 0.2.
 * A = Q16, on the list as 'a': White's good edges R14 (p 0.3) to C and R17 (p 0.1) to D, shares 0.75 and 0.25.
 * C = Q16 R14, on the list as 'c' and 'c2': Black's O16 (p 0.5) to the leaf E and Q14 (p 0.25) to the leaf F, the rest 0.25.
 * D = Q16 R17: Black's O16 (p 0.6) to the leaf G, the rest 0.4.
 * The move needs: A 0.2, F 0.4, G 0.5, 1 elsewhere (E and H; at the bot's nodes they do not count). The need mass under each
 * node: E 1, F 0.4, G 0.5, C 0.5 × 1 + 0.25 × 0.4 = 0.6, D 0.6 × 0.5 = 0.3, A 0.2 + 0.75 × 0.6 + 0.25 × 0.3 = 0.725.
 * The reach: A 0.5, C 0.5 × 0.75 = 0.375.
 */
function targets() {
  const book = weightedBook(
    [
      { line: [], move: 'Q16', p: 0.5 },
      { line: [], move: 'R16', p: 0.3 },
      { line: ['Q16'], move: 'R14', p: 0.3 },
      { line: ['Q16'], move: 'R17', p: 0.1 },
      { line: ['Q16', 'R14'], move: 'O16', p: 0.5 },
      { line: ['Q16', 'R14'], move: 'Q14', p: 0.25 },
      { line: ['Q16', 'R17'], move: 'O16', p: 0.6 },
    ],
    { a: ['Q16'], c: ['Q16', 'R14'], c2: ['Q16', 'R14'] },
  )
  const at = (...line: string[]): number => book.node(lineKey(line))!
  const flow = progressFlow(book, '5k', 'W')
  const moveNeed = new Float64Array(book.nodeCount).fill(1)
  moveNeed[at('Q16')] = 0.2
  moveNeed[at('Q16', 'R14', 'Q14')] = 0.4
  moveNeed[at('Q16', 'R17', 'O16')] = 0.5
  return { book, flow, reach: reachOf(book, flow), moveNeed, at }
}

describe('randomTarget', () => {
  it('draw X by its reach times the need mass under it (part 3 spec 5.2), then stop at a node of the player by its move need or go on along an edge by share × need mass', () => {
    const { book, flow, reach, moveNeed, at } = targets()
    const [A, C, D, E, F, G] = [at('Q16'), at('Q16', 'R14'), at('Q16', 'R17'), at('Q16', 'R14', 'O16'), at('Q16', 'R14', 'Q14'), at('Q16', 'R17', 'O16')]
    // X's weights: A at 0.5 × 0.725, C (nested in A, on its own; its two list ids one entry) at 0.375 × 0.6.
    const total = 0.5 * 0.725 + 0.375 * 0.6
    // X's share of the weights times the descent's choices: from A, stop 0.2 / 0.725, to C 0.45 / 0.725, to D 0.075 / 0.725;
    // from C, to E 0.5 / 0.6, to F 0.1 / 0.6; from D, to G.
    const expected = new Map([
      [[A].join(), ((0.5 * 0.725) / total) * (0.2 / 0.725)],
      [[A, C, E].join(), ((0.5 * 0.725) / total) * (0.45 / 0.725) * (0.5 / 0.6)],
      [[A, C, F].join(), ((0.5 * 0.725) / total) * (0.45 / 0.725) * (0.1 / 0.6)],
      [[A, D, G].join(), ((0.5 * 0.725) / total) * (0.075 / 0.725)],
      [[C, E].join(), ((0.375 * 0.6) / total) * (0.5 / 0.6)],
      [[C, F].join(), ((0.375 * 0.6) / total) * (0.1 / 0.6)],
    ])
    let draws = 0
    const base = mulberry32(11)
    const rng: Rng = () => {
      draws++
      return base()
    }
    const counts = new Map<string, number>()
    const paths = new Map<string, GraphPath>()
    let visited = 0
    for (let i = 0; i < DRAWS; i++) {
      const path = randomTarget(book, flow, reach, moveNeed, rng)!
      const key = path.nodes.join()
      counts.set(key, (counts.get(key) ?? 0) + 1)
      paths.set(key, path)
      visited += path.nodes.length
    }
    expect([...counts.keys()].sort()).toEqual([...expected.keys()].sort())
    for (const [key, p] of expected) expect(Math.abs(counts.get(key)! / DRAWS - p)).toBeLessThan(0.01)
    for (const { nodes, edges } of paths.values()) {
      expect(edges).toHaveLength(nodes.length - 1)
      edges.forEach((e, i) => {
        expect(e).toBeGreaterThanOrEqual(book.firstEdge(nodes[i]))
        expect(e).toBeLessThan(book.firstEdge(nodes[i] + 1))
        expect(book.edgeTarget(e)).toBe(nodes[i + 1])
      })
    }
    // One draw for X, then one at each node of the descent.
    expect(draws).toBe(DRAWS + visited)
  })

  it('give null when no list position reaches a move card with need above 0', () => {
    const { book, flow, reach, at } = targets()
    expect(randomTarget(book, flow, reach, new Float64Array(book.nodeCount), mulberry32(1))).toBeNull()
    // H has need, but no list position is above it.
    const outside = new Float64Array(book.nodeCount)
    outside[at('R16')] = 1
    expect(randomTarget(book, flow, reach, outside, mulberry32(1))).toBeNull()
  })
})

/**
 * The player is White. The empty corner (Black, the bot): Q16 (p 0.3), R14 (p 0.1) and R16 (p 0.2, to a leaf); White's
 * tenuki after Q16 and after R14 (the only good edge: share 1); Black's R14 after Q16 tenuki and Q16 after R14 tenuki reach
 * one position t.
 */
function transposition() {
  const book = weightedBook([
    { line: [], move: 'Q16', p: 0.3 },
    { line: [], move: 'R14', p: 0.1 },
    { line: [], move: 'R16', p: 0.2 },
    { line: ['Q16'], move: 'tenuki', p: 1 },
    { line: ['R14'], move: 'tenuki', p: 1 },
    { line: ['Q16', 'tenuki'], move: 'R14', p: 1 },
    { line: ['R14', 'tenuki'], move: 'Q16', p: 1 },
  ])
  return { book, flow: progressFlow(book, '5k', 'W'), t: book.node(lineKey(['Q16', 'tenuki', 'R14']))! }
}

describe('pathTo', () => {
  it('descends to the target by share times the probability of reaching it, through a transposition (part 3 spec 5.2)', () => {
    const { book, flow, t } = transposition()
    const first = pathOf(book, ['Q16', 'tenuki', 'R14'])
    const second = pathOf(book, ['R14', 'tenuki', 'Q16'])
    expect(second.nodes.at(-1)).toBe(t)
    const rng = mulberry32(5)
    const counts = new Map<string, number>()
    for (let i = 0; i < DRAWS; i++) {
      const key = JSON.stringify(pathTo(book, flow, 0, t, rng))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    expect([...counts.keys()].sort()).toEqual([JSON.stringify(first), JSON.stringify(second)].sort())
    // 0.3 × 1 against 0.1 × 1.
    expect(Math.abs(counts.get(JSON.stringify(first))! / DRAWS - 0.75)).toBeLessThan(0.01)
    expect(Math.abs(counts.get(JSON.stringify(second))! / DRAWS - 0.25)).toBeLessThan(0.01)
  })

  it('is the target alone from the target, and null for a target not under the start', () => {
    const { book, flow, t } = transposition()
    const rng = mulberry32(5)
    expect(pathTo(book, flow, t, t, rng)).toEqual({ nodes: [t], edges: [] })
    expect(pathTo(book, flow, book.node(lineKey(['Q16']))!, book.node(lineKey(['R14']))!, rng)).toBeNull()
    expect(pathTo(book, flow, book.node(lineKey(['R16']))!, t, rng)).toBeNull()
  })
})

/**
 * The player is White, on a line of six moves from the empty corner (path nodes 0–6): White decides at nodes 1, 3 and 5,
 * between the line's move, played with probability q[d] at the level, and another good move (1 − q[d], to no node); without
 * reviews the habit share of the line's move is q[d]. Black's nodes have one edge. The start index of the line's path.
 */
function decisions(q: [number, number, number]): number {
  const line = ['Q16', 'R14', 'O16', 'R12', 'O14', 'Q12']
  const others = ['R17', 'O17', 'R13']
  const specs: WeightedEdge[] = line.map((move, i) => ({ line: line.slice(0, i), move, p: i % 2 === 1 ? q[(i - 1) / 2] : 1 }))
  others.forEach((move, d) => specs.push({ line: line.slice(0, 2 * d + 1), move, p: 1 - q[d], expanded: false }))
  const book = weightedBook(specs)
  return startIndex(book, pathOf(book, line), habitShares(book, new Map(), book.levelArrays('5k')!), 'W')
}

describe('startIndex', () => {
  it('starts at the earliest node from which the habits reach the target with a probability of at least ½ (part 3 spec 5.3)', () => {
    // 0.9 × 0.8 = 0.72 from node 2 on; 0.4 × 0.72 < ½ from node 1.
    expect(decisions([0.4, 0.9, 0.8])).toBe(2)
    expect(decisions([1, 1, 1])).toBe(0)
    // Exactly ½ is enough.
    expect(decisions([1, 0.5, 1])).toBe(0)
    // The last decision alone below ½: the start is the target.
    expect(decisions([1, 1, 0.4])).toBe(6)
  })

  it('counts twin edges to one node together: a move and its mirror at a symmetric node', () => {
    // The player is Black. At the empty corner R16 and its mirror Q17 lead to one node, each played half the time; then
    // White's R14 and Black's decision between Q14 (p 0.6, the path's) and P16 (p 0.4).
    const book = weightedBook([
      { line: [], move: 'R16', p: 0.3 },
      { line: [], move: 'Q17', p: 0.3 },
      { line: ['R16'], move: 'R14', p: 1 },
      { line: ['R16', 'R14'], move: 'Q14', p: 0.6 },
      { line: ['R16', 'R14'], move: 'P16', p: 0.4, expanded: false },
    ])
    const habits = habitShares(book, new Map([[0, Float64Array.of(1, 1)]]), book.levelArrays('5k')!)
    const path = pathOf(book, ['R16', 'R14', 'Q14'])
    expect(path.edges[0]).toBe(0)
    expect(book.edgeTarget(1)).toBe(path.nodes[1])
    // q = 0.5 + 0.5 at the empty corner, 0.6 at the decision: 0.6 ≥ ½ from the empty corner (0.5 × 0.6 would not be).
    expect(startIndex(book, path, habits, 'B')).toBe(0)
    expect(startIndex(book, { ...path, edges: [1, ...path.edges.slice(1)] }, habits, 'B')).toBe(0)
  })
})

describe('realMoves', () => {
  const graph = walkBook()

  /**
   * realMoves of the path along `line` from its first `from` moves, checked: walked from the empty corner, the setup visits
   * exactly the path's nodes up to the start after X's own path, and never leaves the graph.
   */
  function placed(line: string[], from: number, start: number): ZoneMove[] {
    const path = pathOf(graph, line, from)
    const setup = realMoves(graph, path, start)
    const { steps, exit, at } = graphWalk(pathMoves(setup), 'TR', graph)
    expect(exit).toBeNull()
    expect([...steps.slice(graph.nodePath(path.nodes[0]).length).map((s) => s.node), at!.node]).toEqual(path.nodes.slice(0, start + 1))
    return setup
  }

  it("plays each edge's move in the orientation the moves so far are seen in, through the mirrored node 2", () => {
    // Node 2 is kept as Q16 R14: reached by O17, it is seen mirrored, and its O16 is played as Q14.
    expect(placed(['Q16', 'O17', 'Q14'], 1, 0)).toEqual([v('Q16')])
    expect(placed(['Q16', 'O17', 'Q14'], 1, 1)).toEqual([v('Q16'), v('O17')])
    expect(placed(['Q16', 'O17', 'Q14'], 1, 2)).toEqual([v('Q16'), v('O17'), v('Q14')])
    // Reached by R14, as it is kept.
    expect(placed(['Q16', 'R14', 'O16'], 0, 3)).toEqual([v('Q16'), v('R14'), v('O16')])
  })

  it('gives a tenuki edge as a tenuki', () => {
    expect(placed(['Q16', 'tenuki', 'R14'], 0, 3)).toEqual([v('Q16'), 'tenuki', v('R14')])
    expect(placed(['Q16', 'tenuki', 'R14'], 1, 1)).toEqual([v('Q16'), 'tenuki'])
    // X's own path holds the tenuki.
    expect(placed(['Q16', 'tenuki', 'R14'], 2, 0)).toEqual([v('Q16'), 'tenuki'])
    expect(placed(['tenuki', 'Q16'], 0, 2)).toEqual(['tenuki', v('Q16')])
  })
})

describe('nameOnPath', () => {
  it('names the deepest list position on the way to the start (part 3 spec 5.5)', () => {
    const { book } = targets()
    const toE = pathOf(book, ['Q16', 'R14', 'O16'], 1)
    expect(nameOnPath(book, toE, 0)).toBe('a')
    // C carries 'c' and 'c2': the first.
    expect(nameOnPath(book, toE, 1)).toBe('c')
    expect(nameOnPath(book, toE, 2)).toBe('c')
    // No other list position on the way: X.
    expect(nameOnPath(book, pathOf(book, ['Q16', 'R17', 'O16'], 1), 2)).toBe('a')
  })
})
