import { describe, expect, it } from 'vitest'
import { emptyMap, isVertex, ownershipMap, pvMoves, sameVertex } from './board-maps'

describe('board maps', () => {
  it('creates independent rows', () => {
    const m = emptyMap(0)
    m[0][0] = 1
    expect(m[1][0]).toBe(0)
    expect(m).toHaveLength(19)
    expect(m[0]).toHaveLength(19)
  })

  it('reshapes ownership row-major from the top-left', () => {
    const m = ownershipMap(Array.from({ length: 361 }, (_, i) => i))!
    expect(m[0][0]).toBe(0)
    expect(m[1][1]).toBe(20)
    expect(m[18][18]).toBe(360)
    expect(ownershipMap(null)).toBeNull()
  })

  it('alternates variation colors from the first mover', () => {
    expect(pvMoves('W', [[1, 1], [2, 2], 'pass'], 2)).toEqual([
      { color: 'W', vertex: [1, 1] },
      { color: 'B', vertex: [2, 2] },
    ])
    expect(isVertex('pass')).toBe(false)
    expect(isVertex([0, 0])).toBe(true)
  })

  it('compares moves by point', () => {
    expect(sameVertex([3, 15], [3, 15])).toBe(true)
    expect(sameVertex([3, 15], [15, 3])).toBe(false)
    expect(sameVertex('pass', 'pass')).toBe(true)
    expect(sameVertex('pass', [0, 0])).toBe(false)
  })
})
