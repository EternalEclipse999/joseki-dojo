import type { Move, Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { fromNodeMove, keyHasBothColors, pathMoves, toNodeMove, trainingKey, zoneKey } from './key'

const mv = (color: 'B' | 'W', x: number, y: number): Move => ({ color, vertex: [x, y] })
const pass = (color: 'B' | 'W'): Move => ({ color, vertex: 'pass' })
const EMPTY = '0'.repeat(121)

describe('zone keys', () => {
  it('reads the 121 zone points row by row: 0 empty, 1 black, 2 white, the smaller of the plain and mirrored readings', () => {
    expect(zoneKey([], 'B')).toEqual({ key: `B:${EMPTY}`, mirrored: false })
    // Black on the zone's first point (J19) reads plainly as "1000…"; mirrored it lands on the last point (T9): "…0001" wins.
    expect(zoneKey([mv('B', 8, 0)], 'W')).toEqual({ key: `W:${'0'.repeat(120)}1`, mirrored: true })
    // White on T9 reads plainly as "…0002", which wins over the mirrored "2000…".
    expect(zoneKey([pass('B'), mv('W', 18, 10)], 'B')).toEqual({ key: `B:${'0'.repeat(120)}2`, mirrored: false })
  })

  it('is the same for two move orders of one position', () => {
    const a = [mv('B', 15, 3), mv('W', 13, 2), mv('B', 16, 5), mv('W', 11, 2)]
    const b = [mv('B', 16, 5), mv('W', 11, 2), mv('B', 15, 3), mv('W', 13, 2)]
    expect(zoneKey(b, 'B')).toEqual(zoneKey(a, 'B'))
  })

  it('is the same for a position and its mirror, with mirrored set on one of them', () => {
    // Q16 O17 and its reflection Q16 R14 ([13,2] <-> [16,5]).
    const plain = zoneKey([mv('B', 15, 3), mv('W', 13, 2)], 'B')
    const mirror = zoneKey([mv('B', 15, 3), mv('W', 16, 5)], 'B')
    expect(mirror.key).toBe(plain.key)
    expect([plain.mirrored, mirror.mirrored].sort()).toEqual([false, true])
  })

  it('leaves a captured stone out of the zone', () => {
    // White T19 is captured by Black S19 and T18.
    const captured = zoneKey([mv('W', 18, 0), mv('B', 17, 0), pass('W'), mv('B', 18, 1)], 'W')
    expect(captured).toEqual(zoneKey([mv('B', 17, 0), pass('W'), mv('B', 18, 1)], 'W'))
  })

  it('adds no zone stone for a tenuki, but the side to move changes', () => {
    const before = zoneKey([mv('B', 15, 3)], 'W')
    const tenuki = zoneKey([mv('B', 15, 3), mv('W', 3, 3)], 'B')
    expect(zoneKey([mv('B', 15, 3), pass('W')], 'B')).toEqual(tenuki)
    expect(tenuki.key.slice(2)).toBe(before.key.slice(2))
    expect(tenuki.key.slice(0, 2)).toBe('B:')
  })

  it('keys a training position in another corner as the same position in the top-right corner', () => {
    const tr = [mv('B', 15, 3), mv('W', 13, 2)]
    // The same stones in the bottom-left and top-left corners, with a tenuki in another corner that adds no zone stone.
    expect(trainingKey([mv('B', 3, 15), mv('W', 5, 16)], 'BL', 'B')).toEqual(zoneKey(tr, 'B'))
    expect(trainingKey([mv('B', 3, 3), mv('W', 5, 2), mv('B', 15, 15), pass('W')], 'TL', 'B')).toEqual(zoneKey(tr, 'B'))
  })

  it('tells whether both colours have a stone in the zone', () => {
    const has = (moves: Move[], toMove: 'B' | 'W'): boolean => keyHasBothColors(zoneKey(moves, toMove).key)
    expect(has([], 'B')).toBe(false)
    expect(has([mv('B', 15, 3)], 'W')).toBe(false)
    expect(has([mv('B', 15, 3), pass('W')], 'B')).toBe(false)
    expect(has([mv('B', 15, 3), mv('W', 13, 2)], 'B')).toBe(true)
    // The side to move is no stone; a captured stone is none either.
    expect(has([pass('B'), mv('W', 18, 10)], 'B')).toBe(false)
    expect(has([mv('W', 18, 0), mv('B', 17, 0), pass('W'), mv('B', 18, 1)], 'W')).toBe(false)
  })

  it('replays a graph path with colours alternating from Black and a pass for tenuki', () => {
    expect(pathMoves([[15, 3], 'tenuki', [13, 2]])).toEqual([mv('B', 15, 3), pass('W'), mv('B', 13, 2)])
  })
})

describe('node moves', () => {
  it('moves a board move into the node orientation: corner first, then the mirror', () => {
    // O17 in the top-left corner is [5,2] -> top-right [13,2]; the mirror of [13,2] is [16,5].
    expect(toNodeMove([5, 2], 'TL', false)).toEqual([13, 2])
    expect(toNodeMove([5, 2], 'TL', true)).toEqual([16, 5])
    expect(toNodeMove([13, 2], 'TR', false)).toEqual([13, 2])
  })

  it('keeps tenuki', () => {
    expect(toNodeMove('tenuki', 'BL', true)).toBe('tenuki')
    expect(fromNodeMove('tenuki', 'BL', true)).toBe('tenuki')
  })

  it('is undone by fromNodeMove in every corner, mirrored or not', () => {
    for (const corner of ['TR', 'TL', 'BL', 'BR'] as const) {
      for (const mirrored of [false, true]) {
        for (const u of [[15, 3], [5, 2], [3, 16], [16, 13]] as Vertex[]) {
          expect(fromNodeMove(toNodeMove(u, corner, mirrored), corner, mirrored)).toEqual(u)
        }
      }
    }
  })
})
