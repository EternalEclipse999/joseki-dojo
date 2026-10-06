import { describe, expect, it } from 'vitest'
import { gtpToVertex, PASS_INDEX, Position, vertexToIndex, zoneVertices, type Vertex } from '@joseki-dojo/shared'
import { chooseBotMove, type BotChoiceInput } from './choose'
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

const Q16: Vertex = [15, 3]
const R16: Vertex = [16, 3]
const D4: Vertex = [3, 15]
const D16: Vertex = [3, 3]

describe('chooseBotMove', () => {
  it('plays in the zone before the joseki starts even if most mass is outside', () => {
    const c = chooseBotMove(input(policy({ Q16: 0.1, D4: 0.9 }), { josekiStarted: false }), seq(0.5))
    expect(c).toEqual({ kind: 'zone', vertex: Q16 })
  })

  it('tenukis when the draw falls inside the outside share', () => {
    expect(chooseBotMove(input(policy({ Q16: 0.1, D4: 0.9 })), seq(0.5))).toEqual({ kind: 'tenuki', vertex: D4 })
  })

  it('stays in the zone when the draw exceeds the outside share', () => {
    expect(chooseBotMove(input(policy({ Q16: 0.1, D4: 0.9 })), seq(0.95, 0))).toEqual({ kind: 'zone', vertex: Q16 })
  })

  it('tenukis to the strongest outside point, never to pass', () => {
    const c = chooseBotMove(input(policy({ Q16: 0.1, D4: 0.3, D16: 0.4 }, 0.2)), seq(0))
    expect(c).toEqual({ kind: 'tenuki', vertex: D16 })
  })

  it('samples zone points in proportion to the policy', () => {
    const p = policy({ Q16: 0.25, R16: 0.75 })
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.2))).toEqual({ kind: 'zone', vertex: Q16 })
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.3))).toEqual({ kind: 'zone', vertex: R16 })
  })

  it('tenukis about as often as the outside mass', () => {
    const rng = mulberry32(42)
    const p = policy({ Q16: 0.3, D4: 0.7 })
    let tenuki = 0
    for (let i = 0; i < 10_000; i++) if (chooseBotMove(input(p), rng).kind === 'tenuki') tenuki++
    expect(tenuki / 10_000).toBeGreaterThan(0.67)
    expect(tenuki / 10_000).toBeLessThan(0.73)
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
