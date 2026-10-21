import { createHash } from 'node:crypto'
import { vertexToGtp, type Corner, type Move, type Vertex } from '@joseki-dojo/shared'

export type CanonicalMove = Vertex | 'tenuki'
const LAST = 18
/** The top-right 11×11 zone: x 8..18, y 0..10. */
const ZONE_X0 = 8
const ZONE = 11
export const ZONE_SIZE_TR = ZONE

export function zoneIndex(v: Vertex): number | null {
  const zx = v[0] - ZONE_X0
  const zy = v[1]
  return zx >= 0 && zx < ZONE && zy >= 0 && zy < ZONE ? zx + ZONE * zy : null
}
export const zoneVertex = (i: number): Vertex => [ZONE_X0 + (i % ZONE), Math.floor(i / ZONE)]

/** A move of `corner` seen in the top-right corner; the same map takes it back (an involution). */
export function toTopRight(v: Vertex, corner: Corner): Vertex {
  const flipX = corner === 'TL' || corner === 'BL'
  const flipY = corner === 'BL' || corner === 'BR'
  return [flipX ? LAST - v[0] : v[0], flipY ? LAST - v[1] : v[1]]
}
export const fromTopRight = toTopRight
/** Moves of `corner` seen in the top-right corner; passes stay passes. */
export const movesToTopRight = (moves: readonly Move[], corner: Corner): Move[] =>
  moves.map((m) => (m.vertex === 'pass' ? m : { ...m, vertex: toTopRight(m.vertex, corner) }))

/** Reflection of the top-right corner in its diagonal (R16 <-> Q17). */
export const mirrorDiagonal = (v: Vertex): Vertex => [LAST - v[1], LAST - v[0]]

/** Spec 3.3: the first move off the diagonal must lie closer to the top edge than to the right edge. */
export function needsMirror(seq: readonly CanonicalMove[]): boolean {
  for (const m of seq) {
    if (m === 'tenuki') continue
    const cx = LAST - m[0]
    const cy = m[1]
    if (cx !== cy) return cy > cx
  }
  return false
}
export const mirrorMoves = (seq: readonly CanonicalMove[]): CanonicalMove[] => seq.map((m) => (m === 'tenuki' ? m : mirrorDiagonal(m)))
export const canonicalize = (seq: readonly CanonicalMove[]): CanonicalMove[] => (needsMirror(seq) ? mirrorMoves(seq) : [...seq])

export const moveText = (m: CanonicalMove): string => (m === 'tenuki' ? 'tenuki' : vertexToGtp(m))
/** Spec 3.3: first 8 hex characters of SHA-1 of the canonical path, inclusive. */
export const trapId = (path: readonly CanonicalMove[]): string =>
  createHash('sha1').update(path.map(moveText).join(' ')).digest('hex').slice(0, 8)
