import { describe, expect, it } from 'vitest'
import { IllegalMoveError, nextColor, Position } from './rules'
import type { Move } from './types'

const B = (x: number, y: number): Move => ({ color: 'B', vertex: [x, y] })
const W = (x: number, y: number): Move => ({ color: 'W', vertex: [x, y] })
const pass = (color: 'B' | 'W'): Move => ({ color, vertex: 'pass' })

// Ko in the top-left corner: Black (1,0) (0,1) (1,2), White (2,0) (3,1) (2,2).
// White plays into (1,1); Black captures it by playing (2,1).
const KO: Move[] = [B(1, 0), W(2, 0), B(0, 1), W(3, 1), B(1, 2), W(2, 2), pass('B'), W(1, 1), B(2, 1)]

describe('Position', () => {
  it('captures stones', () => {
    const p = Position.fromMoves(KO)
    expect(p.colorAt([1, 1])).toBeNull()
    expect(p.colorAt([2, 1])).toBe('B')
  })

  it('forbids the immediate ko recapture', () => {
    const p = Position.fromMoves(KO)
    expect(p.isLegal('W', [1, 1])).toBe(false)
    expect(() => p.play(W(1, 1))).toThrow(IllegalMoveError)
  })

  it('allows the ko recapture after a pass by each side', () => {
    const p = Position.fromMoves([...KO, pass('W'), pass('B')])
    expect(p.isLegal('W', [1, 1])).toBe(true)
    expect(p.play(W(1, 1)).colorAt([2, 1])).toBeNull()
  })

  it('allows the ko recapture after an exchange elsewhere', () => {
    const p = Position.fromMoves([...KO, W(10, 10), B(10, 11)])
    expect(p.isLegal('W', [1, 1])).toBe(true)
  })

  it('forbids suicide and occupied points', () => {
    const p = Position.fromMoves([W(1, 0), W(0, 1)])
    expect(p.isLegal('B', [0, 0])).toBe(false)
    expect(p.isLegal('B', [1, 0])).toBe(false)
    expect(p.isLegal('B', [5, 5])).toBe(true)
  })

  it('rejects off-board vertices', () => {
    expect(() => Position.empty().play(B(19, 0))).toThrow(IllegalMoveError)
  })

  it('returns copies of the sign map', () => {
    const p = Position.fromMoves([B(3, 3)])
    const map = p.signMap()
    expect(map[3][3]).toBe(1)
    map[3][3] = 0
    expect(p.colorAt([3, 3])).toBe('B')
  })

  it('lists empty vertices', () => {
    expect(Position.fromMoves([B(3, 3), W(15, 15)]).emptyVertices()).toHaveLength(359)
  })
})

describe('nextColor', () => {
  it('starts with Black and alternates after the last move', () => {
    expect(nextColor([])).toBe('B')
    expect(nextColor([B(3, 3)])).toBe('W')
    expect(nextColor([B(3, 3), pass('W')])).toBe('B')
  })
})
