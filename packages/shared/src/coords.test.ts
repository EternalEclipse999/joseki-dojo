import { describe, expect, it } from 'vitest'
import { gtpToVertex, indexToVertex, moveToGtp, PASS_INDEX, sameVertex, vertexToGtp, vertexToIndex } from './coords'

describe('GTP coordinates', () => {
  it('converts reference points', () => {
    expect(vertexToGtp([0, 0])).toBe('A19')
    expect(vertexToGtp([18, 18])).toBe('T1')
    expect(vertexToGtp([3, 15])).toBe('D4')
    expect(vertexToGtp([15, 3])).toBe('Q16')
  })

  it('skips the letter I', () => {
    expect(vertexToGtp([7, 0])).toBe('H19')
    expect(vertexToGtp([8, 0])).toBe('J19')
    expect(gtpToVertex('J19')).toEqual([8, 0])
  })

  it('round-trips every vertex', () => {
    for (let x = 0; x < 19; x++) {
      for (let y = 0; y < 19; y++) expect(gtpToVertex(vertexToGtp([x, y]))).toEqual([x, y])
    }
  })

  it('parses pass and lowercase input', () => {
    expect(gtpToVertex('pass')).toBe('pass')
    expect(gtpToVertex('PASS')).toBe('pass')
    expect(gtpToVertex('q16')).toEqual([15, 3])
    expect(moveToGtp('pass')).toBe('pass')
    expect(moveToGtp([15, 3])).toBe('Q16')
  })

  it('rejects invalid input', () => {
    for (const bad of ['I5', 'Z1', 'A0', 'A20', '', 'Q']) expect(() => gtpToVertex(bad)).toThrow()
    expect(() => vertexToGtp([19, 0])).toThrow()
    expect(() => vertexToGtp([0, -1])).toThrow()
  })
})

describe('KataGo array indices', () => {
  it('is row-major from A19', () => {
    expect(vertexToIndex([0, 0])).toBe(0)
    expect(vertexToIndex([18, 0])).toBe(18)
    expect(vertexToIndex([0, 1])).toBe(19)
    expect(vertexToIndex([18, 18])).toBe(360)
  })

  it('maps back and handles pass', () => {
    expect(indexToVertex(20)).toEqual([1, 1])
    expect(indexToVertex(PASS_INDEX)).toBe('pass')
    expect(() => indexToVertex(362)).toThrow()
    expect(() => indexToVertex(-1)).toThrow()
  })

  it('compares vertices', () => {
    expect(sameVertex([1, 2], [1, 2])).toBe(true)
    expect(sameVertex([1, 2], [2, 1])).toBe(false)
    expect(sameVertex('pass', 'pass')).toBe(true)
    expect(sameVertex('pass', [0, 0])).toBe(false)
  })
})
