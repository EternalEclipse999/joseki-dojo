import { describe, expect, it } from 'vitest'
import { testTrapsTree } from '../traps/fixture'
import { decodeJdb, encodeJdb } from '.'
import { dumpSgf, dumpText } from './dump'

const base = decodeJdb(encodeJdb(testTrapsTree()))

describe('dumpText', () => {
  it('prints a header and one indented line per node', () => {
    const lines = dumpText(base).split('\n')
    expect(lines[0]).toBe('traps, verified: yes, nodes: 11, traps: 2')
    expect(lines[1]).toBe('Q16')
    expect(lines[2]).toBe('  O17')
    expect(lines[3]).toMatch(/^ {4}O18 \[trap\] [0-9a-f]{8}$/)
    expect(lines[4]).toBe('      P17 [good]')
    expect(lines.some((l) => l.trim() === 'tenuki [good]')).toBe(true)
  })

  it('prints the loss', () => {
    const tree = testTrapsTree()
    tree.roots[0].children[0].children[0].children[2].loss = 3.5
    expect(dumpText(decodeJdb(encodeJdb(tree)))).toContain('N18 [caught] loss 3.5')
  })
})

describe('dumpSgf', () => {
  it('writes one game tree with alternating colours, variations and marks', () => {
    const sgf = dumpSgf(base)
    expect(sgf.startsWith('(;GM[1]FF[4]SZ[19]')).toBe(true)
    expect(sgf).toContain(';B[pd];W[nc]') // Q16 = [15,3], O17 = [13,2]
    expect(sgf).toContain('BM[1]') // trap and caught answers
    expect(sgf).toContain('TE[1]') // good answer
    expect(sgf).toContain(';B[]TE[1])') // the tenuki answer is a pass
    expect(sgf.match(/\(/g)!.length).toBe(sgf.match(/\)/g)!.length)
  })

  it('stores the loss in a comment', () => {
    const tree = testTrapsTree()
    tree.roots[0].children[0].children[0].children[2].loss = 3.5
    expect(dumpSgf(decodeJdb(encodeJdb(tree)))).toContain('C[loss 3.5]')
  })
})
