import { describe, expect, it } from 'vitest'
import { mirrorDiagonal } from '../jdb'
import { testGraph, testWeights } from './fixture'
import { pathMoves, pathToMove, zoneKey, type ZoneMove } from './key'
import { decodeGraph, decodeWeights, encodeGraph, encodeWeights, GraphError, type JosekiGraph } from './format'

const damaged = (bytes: Uint8Array, at: number): Uint8Array => {
  const copy = Uint8Array.from(bytes)
  copy[at] ^= 0xff
  return copy
}

/** Every value of `actual` lies within `steps` quantisation steps (1/65535) of `expected`. */
function expectClose(actual: Float32Array, expected: Float32Array, steps = 1): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((x, i) => expect(Math.abs(actual[i] - x)).toBeLessThanOrEqual(steps / 65535))
}

describe('graph file', () => {
  it('round-trips a graph', () => {
    const graph = testGraph()
    const bytes = encodeGraph(graph)
    expect(Array.from(bytes.subarray(0, 5))).toEqual([0x4a, 0x44, 0x47, 0x31, 1])
    expect(decodeGraph(bytes)).toEqual(graph)
  })

  it('refuses a damaged file', () => {
    const bytes = encodeGraph(testGraph())
    expect(() => decodeGraph(damaged(bytes, 0))).toThrow(GraphError)
    expect(() => decodeGraph(damaged(bytes, 4))).toThrow(GraphError)
    expect(() => decodeGraph(damaged(bytes, 12))).toThrow(GraphError)
    expect(() => decodeGraph(damaged(bytes, bytes.length - 12))).toThrow(GraphError)
    expect(() => decodeGraph(bytes.subarray(0, bytes.length - 3))).toThrow(GraphError)
  })

  it('refuses to write a graph that does not match its paths', () => {
    const wrongKey = testGraph()
    wrongKey.nodes[1].key = wrongKey.nodes[2].key
    expect(() => encodeGraph(wrongKey)).toThrow(/node 1/)
    const mirroredPath = testGraph()
    mirroredPath.nodes[2].path = [[15, 3], [13, 2]] // Q16 O17: the larger reading of the node
    expect(() => encodeGraph(mirroredPath)).toThrow(/node 2/)
    const wrongTarget = testGraph()
    wrongTarget.edges[3].to = 2
    expect(() => encodeGraph(wrongTarget)).toThrow(/edge 3/)
    const unordered = testGraph()
    unordered.edges.reverse()
    expect(() => encodeGraph(unordered)).toThrow(/edge 1/)
  })

  it('refuses duplicate moves from a node and edges without categories', () => {
    const duplicate = testGraph()
    duplicate.edges[2] = { ...duplicate.edges[2], move: duplicate.edges[1].move }
    expect(() => encodeGraph(duplicate)).toThrow(/edge 2.*already/)
    const bare = testGraph()
    bare.edges[3].categories = []
    expect(() => encodeGraph(bare)).toThrow(/edge 3.*no categories/)
  })

  it('round-trips a node reached through a capture and a move back onto the captured point', () => {
    // A ko in the zone: Black captures the White stone on [12,5] by playing [13,5]; White plays a threat, Black answers, White retakes.
    const ko: ZoneMove[] = [[11, 5], [12, 5], [12, 4], [13, 4], [12, 6], [13, 6], 'tenuki', [14, 5], [13, 5], [9, 9], [9, 7]]
    // The node and its edge moves go in the orientation of the key (the smaller reading).
    const flip = zoneKey(pathMoves(ko), pathToMove(ko)).mirrored
    const orient = (m: ZoneMove): ZoneMove => (flip && m !== 'tenuki' ? mirrorDiagonal(m) : m)
    const back: ZoneMove = [12, 5]
    const place = (path: ZoneMove[], f: boolean): ZoneMove[] => (f ? path.map((m) => (m === 'tenuki' ? m : mirrorDiagonal(m))) : path)
    const after = [...ko, back]
    const flipAfter = zoneKey(pathMoves(after), pathToMove(after)).mirrored
    const nodeOf = (path: ZoneMove[]) => {
      const { key } = zoneKey(pathMoves(path), pathToMove(path))
      return { key, toMove: pathToMove(path), path, listIds: [] }
    }
    const graph: JosekiGraph = {
      nodes: [nodeOf([]), nodeOf(place(ko, flip)), nodeOf(place(after, flipAfter))],
      edges: [{ from: 1, to: 2, move: orient(back), categories: [{ source: 1, category: 'ideal' }] }],
    }
    expect(graph.nodes[1].key).not.toBe(graph.nodes[2].key)
    expect(graph.nodes[1].key.slice(2).replace(/0/g, '')).toHaveLength(9) // ten stones played, one captured
    expect(decodeGraph(encodeGraph(graph))).toEqual(graph)
  })
})

describe('weights file', () => {
  it('round-trips the weights within one step of 1/65535', () => {
    const graph = testGraph()
    const weights = testWeights()
    const decoded = decodeWeights(encodeWeights(weights, graph), graph)
    expect(decoded.levels).toEqual(weights.levels)
    weights.levels.forEach((_, l) => {
      expectClose(decoded.edge[l], weights.edge[l])
      // The rest is derived from the quantised edges: each of them adds up to one step of error.
      expectClose(decoded.rest[l], weights.rest[l], 4)
    })
  })

  it('refuses a damaged file', () => {
    const graph = testGraph()
    const bytes = encodeWeights(testWeights(), graph)
    expect(() => decodeWeights(damaged(bytes, 1), graph)).toThrow(GraphError)
    expect(() => decodeWeights(damaged(bytes, bytes.length - 12), graph)).toThrow(GraphError)
  })

  it('refuses the weights of another graph', () => {
    const graph = testGraph()
    // The same sizes, one category changed.
    const other: JosekiGraph = testGraph()
    other.edges[3].categories = [{ source: 1, category: 'question' }]
    expect(() => decodeWeights(encodeWeights(testWeights(), graph), other)).toThrow(/другого графа/)
  })

  it('derives the rest as 1 minus the edges instead of storing it', () => {
    const graph = testGraph()
    const decoded = decodeWeights(encodeWeights(testWeights(), graph), graph)
    // Node 2 at 1d has one edge of 1: nothing is left; node 0 at 5k has the edge 0.4.
    expect(decoded.rest[1][2]).toBe(0)
    expect(decoded.rest[0][0]).toBeCloseTo(0.6, 4)
    // Edges that add up to more than 1 leave a rest of 0, not a negative one.
    const over = testWeights()
    over.edge[0] = Float32Array.from([0.4, 0.5, 0.5, 0.05, 0.25])
    over.rest[0] = Float32Array.from([0.6, 0, 0.75])
    expect(decodeWeights(encodeWeights(over, graph), graph).rest[0][1]).toBe(0)
  })

  it('refuses to write a rest that is not 1 minus the edges', () => {
    const weights = testWeights()
    weights.rest[0][1] = 0.9
    expect(() => encodeWeights(weights, testGraph())).toThrow(/rest/)
  })

  it('refuses to write weights that do not fit the graph', () => {
    const weights = testWeights()
    weights.rest[1] = new Float32Array(2)
    expect(() => encodeWeights(weights, testGraph())).toThrow(GraphError)
  })
})
