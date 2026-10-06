import { describe, expect, it } from 'vitest'
import { gtpToVertex } from './coords'
import { CORNERS } from './types'
import { inZone, zoneRanges, zoneVertices } from './zone'

describe('corner zone', () => {
  it('TR covers x 8..18 and y 0..10', () => {
    expect(zoneRanges('TR')).toEqual({ x: [8, 18], y: [0, 10] })
    expect(inZone('TR', [8, 0])).toBe(true)
    expect(inZone('TR', [18, 10])).toBe(true)
    expect(inZone('TR', [7, 0])).toBe(false)
    expect(inZone('TR', [18, 11])).toBe(false)
  })

  it('BL covers x 0..10 and y 8..18', () => {
    expect(zoneRanges('BL')).toEqual({ x: [0, 10], y: [8, 18] })
    expect(inZone('BL', [0, 18])).toBe(true)
    expect(inZone('BL', [11, 18])).toBe(false)
  })

  it('has 121 vertices for every corner', () => {
    for (const corner of CORNERS) expect(zoneVertices(corner)).toHaveLength(121)
  })

  it('never contains pass', () => {
    for (const corner of CORNERS) expect(inZone(corner, 'pass')).toBe(false)
  })

  it('places star points in their own corner', () => {
    expect(inZone('TR', gtpToVertex('Q16'))).toBe(true)
    expect(inZone('TR', gtpToVertex('D4'))).toBe(false)
    expect(inZone('BL', gtpToVertex('D4'))).toBe(true)
    expect(inZone('TL', gtpToVertex('D16'))).toBe(true)
    expect(inZone('BR', gtpToVertex('Q4'))).toBe(true)
  })
})
