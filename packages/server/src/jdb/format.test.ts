import { describe, expect, it } from 'vitest'
import { decodeJdb, encodeJdb, JdbError, type JdbNode, type JdbTree } from './index'

const leaf = (move: JdbNode['move'], category: JdbNode['category'] = 'none', loss: number | null = null): JdbNode => ({ move, category, loss, children: [] })

const sample = (): JdbTree => ({
  kind: 'traps',
  verified: true,
  roots: [
    {
      move: [15, 3],
      category: 'none',
      loss: null,
      children: [
        { move: [16, 5], category: 'trap', loss: null, children: [leaf([17, 5], 'good', 0.3), leaf([14, 2], 'caught', -4.6)] },
        leaf('tenuki'),
        leaf([3, 15]),
      ],
    },
    { move: [16, 3], category: 'none', loss: null, children: Array.from({ length: 200 }, (_, i) => leaf([8 + (i % 11), Math.floor(i / 11) % 11])) },
  ],
})

describe('encode / decode', () => {
  it('round-trips a tree', () => {
    const t = sample()
    expect(decodeJdb(encodeJdb(t)).toTree()).toEqual(t)
  })
  it('round-trips flags and kind', () => {
    for (const verified of [true, false]) {
      const t: JdbTree = { kind: 'starts', verified, roots: [leaf([15, 3])] }
      expect(decodeJdb(encodeJdb(t)).toTree()).toEqual(t)
    }
  })
  it('writes the header', () => {
    const b = encodeJdb(sample())
    expect(Array.from(b.subarray(0, 4))).toEqual([0x4a, 0x44, 0x42, 0x31])
    expect(b[4]).toBe(1)
    expect(b[6] & 1).toBe(1)
    expect(new DataView(b.buffer).getUint32(8, true)).toBe(207)
    expect(encodeJdb({ ...sample(), verified: false })[6] & 1).toBe(0)
  })
  it('rejects bad files', () => {
    const good = encodeJdb(sample())
    const bad = (f: (b: Uint8Array) => Uint8Array) => () => decodeJdb(f(Uint8Array.from(good)))
    expect(bad((b) => ((b[0] = 0), b))).toThrow(JdbError)
    expect(bad((b) => ((b[4] = 2), b))).toThrow(JdbError)
    expect(bad((b) => ((b[5] = 9), b))).toThrow(JdbError)
    expect(bad((b) => ((b[20] ^= 0xff), b))).toThrow(JdbError)
    expect(bad((b) => b.subarray(0, b.length - 5))).toThrow(JdbError)
    expect(bad((b) => Uint8Array.from([...b, 0]))).toThrow(JdbError)
  })
})

describe('JdbBase navigation', () => {
  const base = decodeJdb(encodeJdb(sample()))
  it('navigates', () => {
    expect(base.size).toBe(207)
    const roots = base.roots()
    expect(roots).toHaveLength(2)
    const kids = base.children(roots[0])
    expect(kids).toHaveLength(3)
    expect(base.parent(roots[0])).toBe(-1)
    expect(base.parent(kids[0])).toBe(roots[0])
    const grand = base.children(kids[0])
    expect(base.path(grand[1])).toEqual([[15, 3], [16, 5], [14, 2]])
    expect(base.loss(grand[1])).toBe(-4.6)
    expect(base.category(grand[0])).toBe('good')
  })
  it('finds paths', () => {
    expect(base.find([[15, 3], [16, 5]])).toBe(base.children(base.roots()[0])[0])
    expect(base.find([[15, 3], 'tenuki'])).not.toBeNull()
    expect(base.find([[15, 3], [9, 9]])).toBeNull()
    expect(base.find([])).toBeNull()
  })
  it('lists nodes of a category', () => {
    expect(base.nodesOf('trap')).toHaveLength(1)
  })
})
