import { describe, expect, it } from 'vitest'
import { crc32, decodeJdb, encodeJdb, JdbError, zoneIndex, type JdbNode, type JdbTree } from './index'

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

/** A file with the given body, node count and a valid header (traps, verified). */
function file(body: number[], count: number): Uint8Array {
  const bytes = new Uint8Array(16 + body.length)
  bytes.set([0x4a, 0x44, 0x42, 0x31, 1, 1, 1, 0], 0)
  bytes.set(body, 16)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, count, true)
  view.setUint32(12, crc32(bytes.subarray(16)), true)
  return bytes
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('zoneIndex', () => {
  it('is x - 8 + 11 * y, not symmetric in x and y', () => {
    expect(zoneIndex([9, 0])).toBe(1)
    expect(zoneIndex([8, 1])).toBe(11)
  })
})

describe('golden bytes', () => {
  it('encodes a tiny tree to the exact file', () => {
    // Board points as [x, y]: x counts from A (A0 .. T18, no I), y from the top edge (row 19 - y).
    // Q16 = [15, 3]: zone index (15 - 8) + 11 * 3 = 7 + 33 = 40.
    // O17 = [13, 2]: zone index (13 - 8) + 11 * 2 = 5 + 22 = 27.
    // P17 = [14, 2]: zone index (14 - 8) + 11 * 2 = 6 + 22 = 28.
    // Categories: none 0, good 1, caught 2, trap 3; the loss flag is 8; a loss is round(10 * loss) as a little-endian i16 (0.3 -> 3, 0).
    const tree: JdbTree = {
      kind: 'traps',
      verified: true,
      roots: [
        {
          move: [15, 3],
          category: 'none',
          loss: null,
          children: [{ move: [13, 2], category: 'trap', loss: null, children: [leaf([14, 2], 'good', 0.3)] }],
        },
      ],
    }
    const body = [
      1, // first-level node count
      40, 0, 1, // Q16: move, flags none, one child
      27, 3, 1, // O17: move, flags trap, one child
      28, 1 | 8, 0, 3, 0, // P17: move, flags good + loss, no children, loss 3 as i16
    ]
    const header = [0x4a, 0x44, 0x42, 0x31, 1, 1, 1, 0, 3, 0, 0, 0]
    const crc = crc32(Uint8Array.from(body))
    const crcBytes = [crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff]
    expect(Array.from(encodeJdb(tree))).toEqual([...header, ...crcBytes, ...body])
  })
})

describe('header and node flags', () => {
  it('rejects base flags with bits 1 to 7 set, and accepts the verified bit', () => {
    for (const flags of [0x02, 0x80, 0xff]) {
      const bytes = file([1, 40, 0, 0], 1)
      bytes[6] = flags
      expect(() => decodeJdb(bytes)).toThrow(JdbError)
    }
    for (const flags of [0, 1]) {
      const bytes = file([1, 40, 0, 0], 1)
      bytes[6] = flags
      expect(decodeJdb(bytes).verified).toBe(flags === 1)
    }
  })
  it('rejects a non-zero reserved header byte', () => {
    const bytes = file([1, 40, 0, 0], 1)
    bytes[7] = 1
    expect(() => decodeJdb(bytes)).toThrow(JdbError)
  })
  it('rejects a loss of -32768 on a node that has a loss', () => {
    // none + has-loss flag (8), no children, then the i16 loss.
    expect(() => decodeJdb(file([1, 40, 8, 0, 0x00, 0x80], 1))).toThrow(JdbError)
    expect(decodeJdb(file([1, 40, 8, 0, 0x01, 0x80], 1)).loss(0)).toBe(-3276.7)
  })
})

describe('decode limits', () => {
  it('rejects a node count the file cannot hold, before allocating', () => {
    const huge = file([0], 0)
    new DataView(huge.buffer).setUint32(8, 0xffffffff, true)
    expect(() => decodeJdb(huge)).toThrow(JdbError)
    // 4 body bytes hold at most one node.
    expect(() => decodeJdb(file([1, 40, 0, 0], 2))).toThrow(JdbError)
    expect(decodeJdb(file([1, 40, 0, 0], 1)).size).toBe(1)
  })
  it('rejects an escape board index of 361 or more', () => {
    const escape = (i: number) => file([1, 255, i & 0xff, i >> 8, 0, 0], 1)
    expect(() => decodeJdb(escape(361))).toThrow(JdbError)
    expect(decodeJdb(escape(360)).move(0)).toEqual([360 % 19, Math.floor(360 / 19)])
  })
})

describe('the start category', () => {
  const startTree = (): JdbTree => ({
    kind: 'starts',
    verified: false,
    roots: [{ move: [15, 3], category: 'none', loss: null, children: [{ move: [13, 2], category: 'start', loss: null, children: [] }] }],
  })

  it('writes and reads start nodes', () => {
    const base = decodeJdb(encodeJdb(startTree()))
    expect(base.kind).toBe('starts')
    expect(base.nodesOf('start').map((i) => base.path(i))).toEqual([[[15, 3], [13, 2]]])
  })

  it('writes and reads dubious nodes', () => {
    const tree = startTree()
    tree.roots[0].children[0].category = 'dubious'
    const base = decodeJdb(encodeJdb(tree))
    expect(base.nodesOf('dubious').map((i) => base.path(i))).toEqual([[[15, 3], [13, 2]]])
    expect(base.nodesOf('start')).toEqual([])
  })

  it('rejects a category above dubious', () => {
    const bytes = encodeJdb({ kind: 'starts', verified: false, roots: [{ move: [15, 3], category: 'start', loss: null, children: [] }] })
    // Header 16 bytes, root count (1 byte), the move (1 byte), then the flags.
    bytes[18] = 6
    new DataView(bytes.buffer).setUint32(12, crc32(bytes.subarray(16)), true)
    expect(() => decodeJdb(bytes)).toThrow('Повреждённые флаги узла в базе')
  })
})
