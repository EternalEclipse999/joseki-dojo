import { describe, expect, it } from 'vitest'
import { emptyMap, isVertex, ownershipMap, pvMoves, zoneBorder } from './board-maps'

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

  it('draws the two inner edges of the zone', () => {
    expect(zoneBorder('TR')).toEqual([
      { v1: [8, 0], v2: [8, 10], type: 'line' },
      { v1: [8, 10], v2: [18, 10], type: 'line' },
    ])
    expect(zoneBorder('BL')).toEqual([
      { v1: [10, 8], v2: [10, 18], type: 'line' },
      { v1: [0, 8], v2: [10, 8], type: 'line' },
    ])
  })

  it('alternates variation colors from the first mover', () => {
    expect(pvMoves('W', [[1, 1], [2, 2], 'pass'], 2)).toEqual([
      { color: 'W', vertex: [1, 1] },
      { color: 'B', vertex: [2, 2] },
    ])
    expect(isVertex('pass')).toBe(false)
    expect(isVertex([0, 0])).toBe(true)
  })
})
