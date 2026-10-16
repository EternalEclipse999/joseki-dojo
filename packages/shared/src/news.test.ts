import { describe, expect, it } from 'vitest'
import { NEWS } from './news'

describe('NEWS list', () => {
  it('has unique ids', () => {
    const ids = NEWS.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has integer waves of at least 1', () => {
    for (const n of NEWS) {
      expect(Number.isInteger(n.wave)).toBe(true)
      expect(n.wave).toBeGreaterThanOrEqual(1)
    }
  })

  // A new novelty takes a wave above every existing one, so the list stays ordered by wave.
  it('is ordered by wave', () => {
    const waves = NEWS.map((n) => n.wave)
    expect(waves).toEqual([...waves].sort((a, b) => a - b))
  })
})
