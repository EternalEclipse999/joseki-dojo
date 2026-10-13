import { describe, expect, it } from 'vitest'
import { gtpToVertex, Position, type Move } from '@joseki-dojo/shared'
import { StubEngine } from '../../test/helpers'
import { StrongBot } from './strong'

const req = (moves: Move[]) => ({
  moves,
  position: Position.fromMoves(moves),
  color: 'W' as const,
  corner: 'TR' as const,
  josekiStarted: true,
  rank: '7k',
  temperature: 1,
  visits: 40,
})

describe('StrongBot', () => {
  it('asks for the best move among the legal zone points', async () => {
    const engine = new StubEngine()
    engine.best = () => 'P17'
    const moves: Move[] = [{ color: 'B', vertex: gtpToVertex('Q16') }]
    expect(await new StrongBot(engine).chooseMove(req(moves))).toEqual(gtpToVertex('P17'))
    const q = engine.queries[0]
    expect(q).toMatchObject({ maxVisits: 40, priority: 10 })
    expect(q.allowMoves).toEqual([{ player: 'W', moves: expect.any(Array), untilDepth: 1 }])
    expect(q.allowMoves![0].moves).toHaveLength(120)
    expect(q.allowMoves![0].moves).not.toContain('Q16')
  })

  it('passes when the zone has no legal point', async () => {
    const engine = new StubEngine()
    const r = req([])
    // A full zone: every point is occupied, so nothing is legal.
    expect(await new StrongBot(engine).chooseMove({ ...r, position: { colorAt: () => 'B', isLegal: () => false } as unknown as Position })).toBe('pass')
    expect(engine.queries).toHaveLength(0)
  })
})
