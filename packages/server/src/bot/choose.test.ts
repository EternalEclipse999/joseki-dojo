import { describe, expect, it } from 'vitest'
import { gtpToVertex, indexToVertex, inZone, PASS_INDEX, Position, vertexToIndex, zoneVertices, type Corner, type MoveVertex, type Vertex } from '@joseki-dojo/shared'
import { chooseBotMove, LOCAL_RADIUS, MISTAKE_TENUKI_RATE, naturalMoves, type BotChoiceInput } from './choose'
import { mulberry32, type Rng } from './rng'

const policy = (entries: Record<string, number>, pass = 0): number[] => {
  const p = new Array<number>(362).fill(0)
  for (const [gtp, value] of Object.entries(entries)) p[vertexToIndex(gtpToVertex(gtp) as Vertex)] = value
  p[PASS_INDEX] = pass
  return p
}

const seq = (...values: number[]): Rng => {
  let i = 0
  return () => values[i++ % values.length]
}

const input = (humanPolicy: number[], over: Partial<BotChoiceInput> = {}): BotChoiceInput => ({
  humanPolicy,
  position: Position.empty(),
  color: 'W',
  corner: 'TR',
  josekiStarted: true,
  temperature: 1,
  ...over,
})

const Q16: Vertex = [15, 3] // the top-right 4-4 point
const R16: Vertex = [16, 3]
const R17: Vertex = [16, 2]
const K10: Vertex = [9, 9] // inside the top-right zone, far from its corner
const D4: Vertex = [3, 15]
const D16: Vertex = [3, 3]
const nearQ16 = (v: Vertex): boolean => Math.max(Math.abs(v[0] - 15), Math.abs(v[1] - 3)) <= LOCAL_RADIUS

describe('chooseBotMove', () => {
  it('plays in the zone before the joseki starts even if most mass is outside', () => {
    const c = chooseBotMove(input(policy({ Q16: 0.1, D4: 0.9 }), { josekiStarted: false }), seq(0.5))
    expect(c).toEqual({ kind: 'zone', vertex: Q16 })
  })

  it('leaves a settled corner whatever the draw', () => {
    expect(chooseBotMove(input(policy({ Q16: 0.25, D4: 0.75 })), seq(0.99))).toEqual({ kind: 'tenuki', vertex: D4 })
  })

  it('leaves a calm corner only on a rare draw', () => {
    const p = policy({ Q16: 0.5, D4: 0.5 })
    expect(chooseBotMove(input(p), seq(0.04))).toEqual({ kind: 'tenuki', vertex: D4 })
    expect(chooseBotMove(input(p), seq(0.06, 0))).toEqual({ kind: 'zone', vertex: Q16 })
  })

  it('never leaves a sharp corner', () => {
    expect(chooseBotMove(input(policy({ Q16: 0.9, D4: 0.1 })), seq(0))).toEqual({ kind: 'zone', vertex: Q16 })
  })

  it('counts a share exactly at a threshold as the higher band', () => {
    expect(chooseBotMove(input(policy({ Q16: 0.4, D4: 0.6 })), seq(0.99))).toEqual({ kind: 'tenuki', vertex: D4 })
    expect(chooseBotMove(input(policy({ Q16: 0.8, D4: 0.2 })), seq(0.04))).toEqual({ kind: 'tenuki', vertex: D4 })
  })

  it('makes the premature tenuki about 5% of the time in a calm corner', () => {
    const rng = mulberry32(42)
    const p = policy({ Q16: 0.5, D4: 0.5 })
    let tenuki = 0
    for (let i = 0; i < 2_000; i++) if (chooseBotMove(input(p), rng).kind === 'tenuki') tenuki++
    expect(tenuki / 2_000).toBeGreaterThan(0.035)
    expect(tenuki / 2_000).toBeLessThan(0.065)
  })

  it('tenukis to the strongest outside point, never to pass', () => {
    const c = chooseBotMove(input(policy({ Q16: 0.1, D4: 0.3, D16: 0.4 }, 0.2)), seq(0))
    expect(c).toEqual({ kind: 'tenuki', vertex: D16 })
  })

  it('keeps zone moves near the stones in the zone', () => {
    const position = Position.fromMoves([{ color: 'B', vertex: Q16 }])
    const c = chooseBotMove(input(policy({ K10: 0.9, R17: 0.1 }), { position, josekiStarted: false }), seq(0))
    expect(c).toEqual({ kind: 'zone', vertex: R17 })
  })

  it('keeps zone moves near any of the stones in the zone', () => {
    const position = Position.fromMoves([{ color: 'B', vertex: Q16 }, { color: 'W', vertex: K10 }])
    // K12 is 2 lines from K10 and 6 from Q16.
    const c = chooseBotMove(input(policy({ K12: 0.9 }), { position, color: 'B' }), seq(0))
    expect(c).toEqual({ kind: 'zone', vertex: gtpToVertex('K12') })
  })

  it('measures the local area from the 4-4 point of the corner while the zone is empty', () => {
    // For each corner: a point exactly 4 lines from its 4-4 point towards the centre, and the zone's far corner.
    const cases: [Corner, string, string][] = [
      ['TL', 'H12', 'L9'],
      ['TR', 'M12', 'J9'],
      ['BL', 'H8', 'L11'],
      ['BR', 'M8', 'J11'],
    ]
    for (const [corner, edge, far] of cases) {
      const c = chooseBotMove(input(policy({ [far]: 0.9, [edge]: 0.1 }), { corner, josekiStarted: false }), seq(0))
      expect(c).toEqual({ kind: 'zone', vertex: gtpToVertex(edge) })
    }
  })

  it('falls back to the whole zone when the local area has no legal point', () => {
    const p = policy({ K10: 0.5, D4: 0.5 })
    for (const v of zoneVertices('TR')) if (nearQ16(v)) p[vertexToIndex(v)] = -1
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0))).toEqual({ kind: 'zone', vertex: K10 })
  })

  it('samples zone points in proportion to the policy', () => {
    const p = policy({ Q16: 0.25, R16: 0.75 })
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.2))).toEqual({ kind: 'zone', vertex: Q16 })
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.3))).toEqual({ kind: 'zone', vertex: R16 })
  })

  it('skips occupied and KataGo-illegal points', () => {
    const position = Position.fromMoves([{ color: 'B', vertex: Q16 }])
    const c = chooseBotMove(input(policy({ Q16: 0.9, R16: 0.1, R17: -1 }), { position, josekiStarted: false }), seq(0.1))
    expect(c).toEqual({ kind: 'zone', vertex: R16 })
  })

  it('tenukis when the zone has no playable point and passes when nothing is playable', () => {
    const p = policy({ D4: 0.5 })
    for (const v of zoneVertices('TR')) p[vertexToIndex(v)] = -1
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.5))).toEqual({ kind: 'tenuki', vertex: D4 })
    const nothing = new Array<number>(362).fill(-1)
    nothing[PASS_INDEX] = 1
    expect(chooseBotMove(input(nothing), seq(0.5))).toEqual({ kind: 'pass' })
  })

  it('sharpens the distribution with a lower temperature', () => {
    const p = policy({ Q16: 0.2, R16: 0.8 })
    expect(chooseBotMove(input(p, { josekiStarted: false, temperature: 1 }), seq(0.1))).toEqual({ kind: 'zone', vertex: Q16 })
    expect(chooseBotMove(input(p, { josekiStarted: false, temperature: 0.5 }), seq(0.1))).toEqual({ kind: 'zone', vertex: R16 })
  })
})

describe('naturalMoves', () => {
  it('gives only the best outside point in a settled corner', () => {
    expect(naturalMoves(input(policy({ Q16: 0.25, D4: 0.75, D16: 0.1 })))).toEqual([{ vertex: D4, tenuki: true, p: 1 }])
  })

  it('leaves a calm corner with the mistake rate and shares the rest among the zone moves by the policy', () => {
    expect(naturalMoves(input(policy({ Q16: 0.45, R16: 0.15, D4: 0.3, D16: 0.1 })))).toEqual([
      { vertex: D4, tenuki: true, p: MISTAKE_TENUKI_RATE },
      { vertex: Q16, tenuki: false, p: expect.closeTo(0.95 * 0.75, 12) },
      { vertex: R16, tenuki: false, p: expect.closeTo(0.95 * 0.25, 12) },
    ])
  })

  it('never leaves a sharp corner or one where the joseki has not started, its best outside point listed with p 0', () => {
    expect(naturalMoves(input(policy({ Q16: 0.9, D4: 0.1 })))).toEqual([
      { vertex: D4, tenuki: true, p: 0 },
      { vertex: Q16, tenuki: false, p: 1 },
    ])
    expect(naturalMoves(input(policy({ Q16: 0.1, D4: 0.9 }), { josekiStarted: false }))).toEqual([
      { vertex: D4, tenuki: true, p: 0 },
      { vertex: Q16, tenuki: false, p: 1 },
    ])
    // Without a legal point outside the zone there is no tenuki to list.
    const p = policy({ Q16: 0.9 })
    for (let i = 0; i < PASS_INDEX; i++) if (!inZone('TR', indexToVertex(i) as Vertex)) p[i] = -1
    expect(naturalMoves(input(p))).toEqual([{ vertex: Q16, tenuki: false, p: 1 }])
  })

  it('tenukis for certain when the zone has no playable point, and passes when nothing is playable', () => {
    const p = policy({ D4: 0.5 })
    for (const v of zoneVertices('TR')) p[vertexToIndex(v)] = -1
    expect(naturalMoves(input(p, { josekiStarted: false }))).toEqual([{ vertex: D4, tenuki: true, p: 1 }])
    const nothing = new Array<number>(362).fill(-1)
    nothing[PASS_INDEX] = 1
    expect(naturalMoves(input(nothing))).toEqual([{ vertex: 'pass', tenuki: true, p: 1 }])
  })

  it('weighs the zone moves by policy^(1/temperature)', () => {
    expect(naturalMoves(input(policy({ Q16: 0.16, R16: 0.64 }), { josekiStarted: false, temperature: 2 }))).toEqual([
      // No policy outside the zone: its first point is the best, never played.
      { vertex: [0, 0], tenuki: true, p: 0 },
      { vertex: Q16, tenuki: false, p: expect.closeTo(1 / 3, 12) },
      { vertex: R16, tenuki: false, p: expect.closeTo(2 / 3, 12) },
    ])
  })

  it('is the distribution chooseBotMove samples from', () => {
    // An empty board where every point is legal: Position.isLegal plays the move, too slow for 20 000 draws of 361 points.
    const position = { isLegal: () => true, colorAt: () => null } as unknown as Position
    const calm = input(policy({ Q16: 0.4, R16: 0.15, R17: 0.05, K10: 0.05, D4: 0.3, D16: 0.05 }), { position, temperature: 1.5 })
    const key = (v: MoveVertex): string => (v === 'pass' ? 'pass' : v.join(','))
    const draws = 20_000
    const rng = mulberry32(7)
    const counts = new Map<string, number>()
    for (let i = 0; i < draws; i++) {
      const c = chooseBotMove(calm, rng)
      const k = key(c.kind === 'pass' ? 'pass' : c.vertex)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const natural = naturalMoves(calm)
    expect(natural.reduce((s, m) => s + m.p, 0)).toBeCloseTo(1, 12)
    // K10 is outside the local area: neither samples it.
    expect(natural.map((m) => key(m.vertex)).sort()).toEqual([...counts.keys()].sort())
    for (const m of natural) expect(Math.abs(counts.get(key(m.vertex))! / draws - m.p)).toBeLessThan(0.01)
  })
})
