import { describe, expect, it } from 'vitest'
import { mulberry32, pick } from './rng'

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe('pick', () => {
  it('draws an item in proportion to its weight with one draw, the last one with weight when the sum rounds short', () => {
    const items = ['a', 'b', 'c', 'd']
    const weights: Record<string, number> = { a: 1, b: 0, c: 3, d: 0 }
    const at = (x: number): string => pick(items, (i) => weights[i], () => x)
    expect([at(0), at(0.2), at(0.25), at(0.99)]).toEqual(['a', 'a', 'c', 'c'])
    expect(at(1)).toBe('c')
    let draws = 0
    pick(items, (i) => weights[i], () => (draws++, 0.5))
    expect(draws).toBe(1)
  })
})
