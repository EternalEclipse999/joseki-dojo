import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Position, type Move } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { fromTopRight, mirrorDiagonal } from '../jdb'
import { GraphBook } from './book'
import { cycleGraph, lineGraph, TEST_LIST_ID, testGraph, testWeights, walkGraph, wideGraph, wideWeights } from './fixture'
import { decodeWeights, encodeGraph, encodeWeights, GraphError, type JosekiGraph } from './format'
import { pathMoves, positionKey, zoneKey } from './key'

const mv = (color: 'B' | 'W', x: number, y: number): Move => ({ color, vertex: [x, y] })
const graph = testGraph()
const graphBytes = encodeGraph(graph)
const weightsBytes = encodeWeights(testWeights(), graph)

describe('GraphBook', () => {
  const book = GraphBook.load(graphBytes, weightsBytes)

  it('finds nodes by key, by list id and by training moves in any corner', () => {
    expect(book.node(graph.nodes[2].key)).toBe(2)
    expect(book.node('B:nothing')).toBeNull()
    expect(book.listNode(TEST_LIST_ID)).toBe(1)
    expect(book.listNode('missing')).toBeNull()
    // Q16 O17 in the top-left corner: node 2 is kept as Q16 R14, so the training moves are its mirror.
    expect(book.nodeOfTraining([mv('B', 3, 3), mv('W', 5, 2)], 'TL', 'B')).toEqual({ node: 2, mirrored: true })
    // Q16 R14 in the bottom-right corner reads as the node itself.
    expect(book.nodeOfTraining([mv('B', 15, 15), mv('W', 16, 13)], 'BR', 'B')).toEqual({ node: 2, mirrored: false })
    expect(book.nodeOfTraining([mv('B', 15, 15), mv('W', 16, 13)], 'BR', 'W')).toBeNull()
  })

  it('lists the edges of a node in file order', () => {
    expect(book.edges(1)).toEqual(graph.edges.slice(1, 4))
    expect(book.edges(2)).toEqual(graph.edges.slice(4))
  })

  it('has no edges for a node outside the graph', () => {
    expect(book.edges(3)).toEqual([])
    expect(book.edges(-1)).toEqual([])
  })

  it('gives the probabilities of a node at a level', () => {
    expect(book.hasWeights).toBe(true)
    const p = book.probabilities(1, '1d')!
    expect(p.edges).toHaveLength(3)
    expect(p.edges[0]).toBeCloseTo(0.123456, 4)
    expect(p.rest).toBeCloseTo(0.043211, 4)
    expect(book.probabilities(2, '5k')).toEqual({ edges: [expect.closeTo(0.25, 4)], rest: expect.closeTo(0.75, 4) })
    expect(book.probabilities(1, '9d')).toBeNull()
    expect(book.probabilities(3, '1d')).toBeNull()
    expect(book.probabilities(-1, '1d')).toBeNull()
    expect([book.hasLevel('1d'), book.hasLevel('5k'), book.hasLevel('9d')]).toEqual([true, true, false])
  })

  it('works without weights', () => {
    const bare = GraphBook.load(graphBytes, null)
    expect(bare.hasWeights).toBe(false)
    expect(bare.hasLevel('1d')).toBe(false)
    expect(bare.probabilities(1, '1d')).toBeNull()
    expect(bare.listNode(TEST_LIST_ID)).toBe(1)
    expect(bare.withWeights(weightsBytes).hasWeights).toBe(true)
  })

  it('refuses the weights of another graph', () => {
    const other = testGraph()
    other.edges[3].categories = [{ source: 1, category: 'question' }]
    expect(() => GraphBook.load(encodeGraph(other), weightsBytes)).toThrow(GraphError)
  })

  it('is empty without a graph', () => {
    const empty = GraphBook.empty()
    expect([empty.nodeCount, empty.edgeCount, empty.firstEdge(0)]).toEqual([0, 0, 0])
    expect(empty.hasWeights).toBe(false)
    expect(empty.node(graph.nodes[0].key)).toBeNull()
    expect(empty.nodeOfTraining([], 'TR', 'B')).toBeNull()
    expect(empty.listNode(TEST_LIST_ID)).toBeNull()
    expect(empty.edges(0)).toEqual([])
    expect(empty.probabilities(0, '1d')).toBeNull()
    expect(empty.hasLevel('1d')).toBe(false)
  })
})

let real: GraphBook | null = null
/** The committed graph file, loaded once. */
const realBook = (): GraphBook => (real ??= GraphBook.load(readFileSync(fileURLToPath(new URL('../../bases/joseki-graph.bin', import.meta.url))), null))

/**
 * Checks the cut of a book's cycles (spec (progress part 2) 4.2): its order holds every node once, each before the target
 * of every edge that is not a back edge, and every back edge leads to a node at or before its own.
 * Returns the back edges.
 */
function expectWalk(book: GraphBook): number[] {
  const order = book.topoOrder()
  const at = new Int32Array(book.nodeCount).fill(-1)
  order.forEach((node, i) => (at[node] = i))
  expect(order.length).toBe(book.nodeCount)
  expect(at.every((i) => i >= 0)).toBe(true)
  const back: number[] = []
  const wrong: number[] = []
  for (let node = 0; node < book.nodeCount; node++) {
    book.edges(node).forEach((e, k) => {
      const edge = book.firstEdge(node) + k
      if (book.backEdge(edge)) back.push(edge)
      if (book.backEdge(edge) ? e.to === null || at[e.to] > at[node] : e.to !== null && at[e.to] <= at[node]) wrong.push(edge)
    })
  }
  expect(wrong).toEqual([])
  return back
}

/**
 * A ko in a component of three nodes (spec (progress part 2) 4.2). Black P16 O15 P14 and White Q16 R15 Q14 (nodes 1–6)
 * leave the ko points P15 and Q15 between them:
 *   9   K1, White to move: Black Q15 straight after the six stones, 7 moves deep
 *   8   K0, Black to move: after a Black tenuki (node 7) and White P15, 8 moves deep; Black takes at Q15 (to K1)
 *   10  K2, Black to move: White's ko threat (a tenuki) at K1, 8 moves deep; Black answers it (a tenuki, back to K1)
 * K1 also has White's retake at P15 (to K0). Node 6 gives its tenuki first, so a walk from the empty corner along the edges
 * in their order enters the ko at K0 and would cut the retake K1 → K0.
 */
function koGraph(): JosekiGraph {
  const stones = ['P16', 'Q16', 'O15', 'R15', 'P14', 'Q14']
  const k0 = [...stones, 'tenuki', 'P15']
  const k1 = [...stones, 'Q15']
  return lineGraph([
    ...stones.map((move, i) => ({ line: stones.slice(0, i), move })),
    { line: stones, move: 'tenuki' },
    { line: [...stones, 'tenuki'], move: 'P15' },
    { line: stones, move: 'Q15' },
    { line: k1, move: 'tenuki' },
    { line: k1, move: 'P15' },
    { line: [...k1, 'tenuki'], move: 'tenuki' },
    { line: k0, move: 'Q15' },
  ]).graph
}

describe('GraphBook cycles cut at their shallowest node', () => {
  it('cuts a tenuki two-cycle at its second tenuki and orders the nodes topologically without it', () => {
    const book = GraphBook.load(encodeGraph(walkGraph()), null)
    // Node 3 (Q16 tenuki): its tenuki returns to node 1, the shallower node of the cycle.
    expect(expectWalk(book)).toEqual([book.firstEdge(3)])
    expect(book.topoOrder()[0]).toBe(0)
    expect(book.edges(3)[0]).toMatchObject({ move: 'tenuki', to: 1 })
  })

  it('cuts a two-cycle entered at both nodes back into the shallower one, though a walk from the empty corner reaches the other first', () => {
    const book = GraphBook.load(encodeGraph(cycleGraph()), null)
    expect(book.edges(7)).toMatchObject([{ move: 'tenuki', to: 6 }])
    expect(book.edges(6)).toMatchObject([{ move: 'tenuki', to: 7 }])
    // Y's tenuki back to X (4 moves deep) is cut; X's tenuki on to Y (5 moves deep) stays.
    expect(expectWalk(book)).toEqual([book.firstEdge(6)])
  })

  it('cuts every cycle of a larger component on an edge back into its shallowest node (a ko)', () => {
    const book = GraphBook.load(encodeGraph(koGraph()), null)
    expect(book.edges(8)).toMatchObject([{ to: 9 }])
    expect(book.edges(9)).toMatchObject([{ move: 'tenuki', to: 10 }, { to: 8 }])
    expect(book.edges(10)).toMatchObject([{ move: 'tenuki', to: 9 }])
    // Into K1: Black's take at K0 and Black's answer to the threat at K2. White's threat and retake stay.
    expect(expectWalk(book)).toEqual([book.firstEdge(8), book.firstEdge(10)])
  })

  it('orders the nodes the empty corner does not reach too, and cuts their cycles at the smaller index', () => {
    const { graph } = lineGraph(
      [
        { line: [], move: 'Q16' },
        { line: ['R16'], move: 'R14' },
        { line: ['R16'], move: 'tenuki' },
        { line: ['R16', 'tenuki'], move: 'tenuki' },
      ],
      { far: ['R16'] },
    )
    const book = GraphBook.load(encodeGraph(graph), null)
    expect(book.nodeCount).toBe(5)
    // R16 (node 2) and R16 tenuki (node 4), both unreached: the cut is node 4's tenuki back to node 2.
    expect(book.edges(4)).toMatchObject([{ move: 'tenuki', to: 2 }])
    expect(expectWalk(book)).toEqual([book.firstEdge(4)])
  })

  it('throws a RangeError for an edge index outside the graph, and has no order without a graph', () => {
    const book = GraphBook.load(graphBytes, null)
    for (const e of [-1, book.edgeCount, 1.5, Number.NaN]) expect(() => book.backEdge(e)).toThrow(RangeError)
    expect(book.withWeights(weightsBytes).topoOrder()).toBe(book.topoOrder())
    expect(GraphBook.empty().topoOrder()).toEqual([])
    expect(() => GraphBook.empty().backEdge(0)).toThrow(RangeError)
  })

  it('cuts the committed graph: its 689 tenuki two-cycles and its ko, keeping the tenuki of list position 83b6ab96', () => {
    const book = realBook()
    // One cut edge in each two-cycle and one in the six-node ko component.
    expect(expectWalk(book)).toHaveLength(690)
    // White to move at 83b6ab96 (3 moves deep): its tenuki goes on, Black's tenuki back to it is the cut.
    const node = book.listNode('83b6ab96')!
    const k = book.edges(node).findIndex((e) => e.move === 'tenuki')
    const after = book.edges(node)[k].to!
    const back = book.edges(after).findIndex((e) => e.move === 'tenuki' && e.to === node)
    expect(book.nodeToMove(node)).toBe('W')
    expect(book.backEdge(book.firstEdge(node) + k)).toBe(false)
    expect(book.backEdge(book.firstEdge(after) + back)).toBe(true)
  })
})

/** Every node of `graph` found by its key, and its key, side to move, path, list ids and edges read back by its index. */
function expectSameGraph(book: GraphBook, graph: JosekiGraph): void {
  expect([book.nodeCount, book.edgeCount]).toEqual([graph.nodes.length, graph.edges.length])
  graph.nodes.forEach((n, i) => {
    expect(book.node(n.key)).toBe(i)
    expect(book.nodeKey(i)).toBe(n.key)
    expect(book.nodeToMove(i)).toBe(n.toMove)
    expect(book.nodePath(i)).toEqual(n.path)
    expect(book.nodeListIds(i)).toEqual(n.listIds)
    expect(book.edges(i)).toEqual(graph.edges.slice(book.firstEdge(i), book.firstEdge(i + 1)))
    expect(book.edges(i).every((e) => e.from === i)).toBe(true)
  })
  expect(book.firstEdge(book.nodeCount)).toBe(book.edgeCount)
}

describe('GraphBook in flat arrays', () => {
  const wide = wideGraph()
  const wideBytes = encodeGraph(wide)
  const book = GraphBook.load(wideBytes, null)

  it('finds every node by its key and reads back its key, side to move, path, list ids and edges', () => {
    expect(wide.nodes.length).toBeGreaterThan(1000)
    expectSameGraph(book, wide)
    expectSameGraph(GraphBook.load(graphBytes, null), graph)
    expect(book.listNode('wide-7b')).toBe(7)
  })

  it("round-trips a node's path and key: the path replays to the key and the key leads back to the node", () => {
    for (let i = 0; i < wide.nodes.length; i++) {
      const { key, mirrored } = zoneKey(pathMoves(book.nodePath(i)), book.nodeToMove(i))
      expect(mirrored).toBe(false)
      expect(key).toBe(book.nodeKey(i))
      expect(book.node(key)).toBe(i)
    }
  })

  it('finds the node of a training position in every corner, mirrored or not', () => {
    for (const i of [1, 40, 66, 300, wide.nodes.length - 1]) {
      const path = book.nodePath(i)
      for (const corner of ['TR', 'TL', 'BL', 'BR'] as const) {
        for (const mirrored of [false, true]) {
          const moves = pathMoves(path).map((m): Move => (m.vertex === 'pass' ? m : { ...m, vertex: fromTopRight(mirrored ? mirrorDiagonal(m.vertex) : m.vertex, corner) }))
          expect(book.nodeOfTraining(moves, corner, book.nodeToMove(i))?.node).toBe(i)
        }
      }
    }
  })

  it('finds no node for a string that is not a key, or for a key outside the graph', () => {
    const empty = '0'.repeat(121)
    expect(book.node(`B:${empty}`)).toBe(0)
    for (const key of ['', `W:${empty}`, `B:${empty}0`, `B:${empty.slice(1)}`, `X:${empty}`, `B;${empty}`, `B:3${empty.slice(1)}`, `B:/${empty.slice(1)}`]) {
      expect(book.node(key)).toBeNull()
    }
    // Three stones in the zone: no node of the wide graph has them.
    const three = Position.fromMoves(pathMoves([[10, 0], [11, 0], [12, 0]]))
    expect(book.node(positionKey(three, 'W').key)).toBeNull()
  })

  it('throws a RangeError for a node index outside the graph', () => {
    for (const i of [-1, book.nodeCount, 1.5, Number.NaN]) {
      expect(() => book.nodeKey(i)).toThrow(RangeError)
      expect(() => book.nodeToMove(i)).toThrow(RangeError)
      expect(() => book.nodePath(i)).toThrow(RangeError)
      expect(() => book.nodeListIds(i)).toThrow(RangeError)
    }
    expect(() => book.firstEdge(book.nodeCount + 1)).toThrow(RangeError)
    expect(() => book.firstEdge(-1)).toThrow(RangeError)
  })

  it('decodes the level asked for and drops the one before, with the values of decodeWeights', () => {
    const weights = wideWeights(wide)
    const bytes = encodeWeights(weights, wide)
    const expected = decodeWeights(bytes, wide)
    const weighed = book.withWeights(bytes)
    for (const l of [0, 2, 0, 1, 1]) {
      for (let n = 0; n < wide.nodes.length; n++) {
        const at = (a: Float32Array): number[] => Array.from(a.subarray(weighed.firstEdge(n), weighed.firstEdge(n + 1)))
        expect(weighed.probabilities(n, weights.levels[l])).toEqual({ edges: at(expected.edge[l]), rest: expected.rest[l][n] })
      }
    }
    // The small graph: node 1 at both of its levels, back and forth.
    const small = GraphBook.load(graphBytes, weightsBytes)
    const first = small.probabilities(1, '1d')
    expect(small.probabilities(1, '5k')).toEqual({ edges: [expect.closeTo(0.3, 4), expect.closeTo(0.2, 4), expect.closeTo(0.05, 4)], rest: expect.closeTo(0.45, 4) })
    expect(small.probabilities(1, '1d')).toEqual(first)
    expect(first).toEqual({ edges: [expect.closeTo(0.123456, 4), expect.closeTo(0.333333, 4), expect.closeTo(0.5, 4)], rest: expect.closeTo(0.043211, 4) })
  })

  it('indexes every node of the committed graph file', () => {
    const real = realBook()
    expect(real.nodeCount).toBeGreaterThan(100_000)
    const lost: number[] = []
    for (let i = 0; i < real.nodeCount; i++) if (real.node(real.nodeKey(i)) !== i) lost.push(i)
    expect(lost).toEqual([])
    // A sample of nodes: the path replays to the key, and each edge leads to the node of its position.
    for (let i = 0; i < real.nodeCount; i += 997) {
      const path = real.nodePath(i)
      const position = Position.fromMoves(pathMoves(path))
      expect(positionKey(position, real.nodeToMove(i))).toEqual({ key: real.nodeKey(i), mirrored: false })
      for (const e of real.edges(i)) {
        if (e.to === null) continue
        const next = position.play({ color: real.nodeToMove(i), vertex: e.move === 'tenuki' ? 'pass' : e.move })
        expect(positionKey(next, real.nodeToMove(e.to)).key).toBe(real.nodeKey(e.to))
      }
    }
  })
})
