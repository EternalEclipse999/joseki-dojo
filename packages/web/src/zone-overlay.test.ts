import { describe, expect, it } from 'vitest'
import { relativeTo, union } from './zone-overlay'

describe('zone overlay', () => {
  it('unites two boxes', () => {
    expect(union({ x: 10, y: 20, w: 5, h: 5 }, { x: 40, y: 0, w: 10, h: 10 })).toEqual({ x: 10, y: 0, w: 40, h: 25 })
  })

  it("moves a box into a container's coordinates", () => {
    expect(relativeTo({ x: 40, y: 30, w: 60, h: 60 }, { x: 10, y: 10 })).toEqual({ x: 30, y: 20, w: 60, h: 60 })
  })
})
