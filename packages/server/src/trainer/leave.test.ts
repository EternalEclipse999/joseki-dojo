import type { Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import type { NaturalMove } from '../bot/choose'
import type { Rng } from '../bot/rng'
import { walkBook, weightedBook } from '../progress/fixture'
import { leaveMove, type LeaveInput } from './leave'

type Seq = Rng & { draws: number }

/** The values given, in turn; `draws` counts the draws. */
const seq = (...values: number[]): Seq => {
  const rng: Seq = Object.assign(() => values[rng.draws++ % values.length], { draws: 0 })
  return rng
}

const Q16: Vertex = [15, 3]
const R16: Vertex = [16, 3]
const R17: Vertex = [16, 2]
const S16: Vertex = [17, 3]
const Q14: Vertex = [15, 5]
const O16: Vertex = [13, 3]
const O17: Vertex = [13, 2]
const D4: Vertex = [3, 15]

const zone = (vertex: Vertex, p: number): NaturalMove => ({ vertex, tenuki: false, p })

/** The empty corner, Black to move, with the edges Q16 and R16. */
function root(): LeaveInput {
  const graph = weightedBook([
    { line: [], move: 'Q16', p: 0.5 },
    { line: [], move: 'R16', p: 0.5 },
  ])
  return { graph, node: 0, mirrored: false, corner: 'TR' }
}

/** A node of walkGraph(). */
const walk = (node: number, mirrored: boolean): LeaveInput => ({ graph: walkBook(), node, mirrored, corner: 'TR' })

describe('leaveMove', () => {
  it("draws one of the natural moves off the node's edges by its natural probability, with one draw (part 3 spec 5.4)", () => {
    const natural = [zone(Q16, 0.3), zone(R17, 0.15), zone(R16, 0.5), zone(S16, 0.05)]
    // R17 has 0.15 of the 0.2 off the edges.
    const low = seq(0.74)
    expect(leaveMove(natural, root(), low)).toEqual(R17)
    expect(low.draws).toBe(1)
    expect(leaveMove(natural, root(), seq(0.76))).toEqual(S16)
  })

  it("is null when every natural move is an edge's, without a draw", () => {
    const rng = seq(0.5)
    expect(leaveMove([zone(Q16, 0.5), zone(R16, 0.5)], root(), rng)).toBeNull()
    expect(rng.draws).toBe(0)
  })

  it('never plays a natural move of probability 0: the tenuki of a corner the bot never leaves', () => {
    // The empty corner has no tenuki edge: D4 is off its edges, but the bot never plays it.
    const rng = seq(0.5)
    expect(leaveMove([{ vertex: D4, tenuki: true, p: 0 }, zone(Q16, 1)], root(), rng)).toBeNull()
    expect(rng.draws).toBe(0)
    expect(leaveMove([{ vertex: D4, tenuki: true, p: 0 }, zone(Q16, 0.5), zone(R17, 0.5)], root(), seq(0))).toEqual(R17)
  })

  it("counts the tenuki as leaving only at a node without a tenuki edge, a pass as the tenuki", () => {
    const tenuki: NaturalMove = { vertex: D4, tenuki: true, p: 0.05 }
    const pass: NaturalMove = { vertex: 'pass', tenuki: true, p: 0.05 }
    // walkGraph's empty corner has a Black tenuki and Q16.
    const corner = walk(0, false)
    expect(corner.graph.edges(0).some((e) => e.move === 'tenuki')).toBe(true)
    // Node 2 (Q16 R14) has only Black's O16.
    const node2 = walk(2, false)
    for (const move of [tenuki, pass]) {
      expect(leaveMove([move, zone(Q16, 0.95)], corner, seq(0))).toBeNull()
      expect(leaveMove([move, zone(O16, 0.95)], node2, seq(0.99))).toEqual(move.vertex)
    }
  })

  it("maps a board move to the node's edge in the node's orientation", () => {
    const graph = walkBook()
    // Q16 O17 on the board is node 2 (kept as Q16 R14) mirrored: the board's Q14 is the node's O16, the board's O16 no edge.
    expect(graph.nodeOfTraining([{ color: 'B', vertex: Q16 }, { color: 'W', vertex: O17 }], 'TR', 'B')).toEqual({ node: 2, mirrored: true })
    const mirrored = walk(2, true)
    expect(leaveMove([zone(Q14, 0.6), zone(O16, 0.4)], mirrored, seq(0))).toEqual(O16)
    expect(leaveMove([zone(Q14, 1)], mirrored, seq(0))).toBeNull()
    // Unmirrored, the board's O16 is the edge.
    expect(leaveMove([zone(Q14, 0.6), zone(O16, 0.4)], walk(2, false), seq(0))).toEqual(Q14)
  })
})
