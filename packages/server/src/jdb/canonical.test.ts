import { describe, expect, it } from 'vitest'
import type { Corner, Vertex } from '@joseki-dojo/shared'
import { canonicalize, fromTopRight, mirrorDiagonal, moveText, toTopRight, trapId, zoneIndex, zoneVertex, type CanonicalMove } from './canonical'

describe('zone', () => {
  it('indexes the top-right zone', () => {
    expect(zoneIndex([8, 0])).toBe(0)
    expect(zoneIndex([18, 10])).toBe(120)
    expect(zoneIndex([7, 0])).toBeNull()
    expect(zoneIndex([8, 11])).toBeNull()
  })
  it('round-trips all zone points', () => {
    for (let i = 0; i < 121; i++) expect(zoneIndex(zoneVertex(i))).toBe(i)
  })
})

describe('corners', () => {
  it('maps every corner to the top right', () => {
    expect(toTopRight([3, 3], 'TL')).toEqual([15, 3])
    expect(toTopRight([3, 15], 'BL')).toEqual([15, 3])
    expect(toTopRight([15, 15], 'BR')).toEqual([15, 3])
    expect(toTopRight([15, 3], 'TR')).toEqual([15, 3])
  })
  it('is an involution', () => {
    const corners: Corner[] = ['TL', 'TR', 'BL', 'BR']
    for (const c of corners)
      for (let x = 0; x < 19; x++)
        for (let y = 0; y < 19; y++) {
          const v: Vertex = [x, y]
          expect(fromTopRight(toTopRight(v, c), c)).toEqual(v)
        }
  })
})

describe('mirror and canonical form', () => {
  it('mirrors along the diagonal', () => {
    expect(mirrorDiagonal([16, 3])).toEqual([15, 2])
    expect(mirrorDiagonal(mirrorDiagonal([16, 3]))).toEqual([16, 3])
  })
  it('canonicalizes', () => {
    const q17r14: CanonicalMove[] = [[15, 2], [16, 4]]
    expect(canonicalize(q17r14)).toEqual(q17r14)
    expect(canonicalize([[16, 3], [14, 2]])).toEqual([[15, 2], [16, 4]])
    const flat: CanonicalMove[] = [[15, 3], 'tenuki', [14, 4]]
    expect(canonicalize(flat)).toEqual(flat)
  })
})

describe('trapId and moveText', () => {
  it('is a stable 8-char hex id', () => {
    const a = trapId([[15, 3], [16, 5], [17, 5]])
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(trapId([[15, 3], [16, 5], [17, 5]])).toBe(a)
    expect(trapId([[15, 3], [16, 5]])).not.toBe(a)
  })
  it('prints moves', () => {
    expect(moveText('tenuki')).toBe('tenuki')
    expect(moveText([15, 3])).toBe('Q16')
  })
})
