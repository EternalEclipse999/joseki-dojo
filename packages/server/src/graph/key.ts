import { Position, type Color, type Corner, type Move, type Vertex } from '@joseki-dojo/shared'
import { fromTopRight, mirrorDiagonal, movesToTopRight, toTopRight, ZONE_SIZE_TR, zoneVertex } from '../jdb'

/** A move of the joseki graph: a point of the top-right zone, or a move outside the zone (a pass included). */
export type ZoneMove = Vertex | 'tenuki'

export const ZONE_POINTS = ZONE_SIZE_TR * ZONE_SIZE_TR
const PLAIN: Vertex[] = Array.from({ length: ZONE_POINTS }, (_, i) => zoneVertex(i))
const MIRRORED: Vertex[] = PLAIN.map(mirrorDiagonal)
/** A sign map value + 1 (white, empty, black) as a key character. */
const POINT = ['2', '0', '1']

/** Spec (progress) 3.2: the key of `position` (top-right coordinates) with `toMove` to play; see zoneKey. */
export function positionKey(position: Position, toMove: Color): { key: string; mirrored: boolean } {
  const s = position.signMap()
  let plain = ''
  let mirrored = ''
  for (let i = 0; i < ZONE_POINTS; i++) {
    plain += POINT[s[PLAIN[i][1]][PLAIN[i][0]] + 1]
    mirrored += POINT[s[MIRRORED[i][1]][MIRRORED[i][0]] + 1]
  }
  return mirrored < plain ? { key: `${toMove}:${mirrored}`, mirrored: true } : { key: `${toMove}:${plain}`, mirrored: false }
}

/** Spec 3.2: the canonical key of the zone position after `moves` (top-right coordinates, colours alternating from Black unless given) with `toMove` to play. */
export function zoneKey(moves: readonly Move[], toMove: Color): { key: string; mirrored: boolean } {
  return positionKey(Position.fromMoves(moves), toMove)
}

/** The key of a training position: its moves in its corner (moved to the top-right first); tenuki and moves outside the zone add no zone stone. */
export function trainingKey(moves: readonly Move[], corner: Corner, toMove: Color): { key: string; mirrored: boolean } {
  return zoneKey(movesToTopRight(moves, corner), toMove)
}

/** Both colours have a stone in the zone of `key` (see positionKey): among its points '1' is Black and '2' White. */
export const keyHasBothColors = (key: string): boolean => key.includes('1', 2) && key.includes('2', 2)

/** Two graph moves are the same: the same point, or both tenuki. */
export const sameZoneMove = (a: ZoneMove, b: ZoneMove): boolean => (a === 'tenuki' || b === 'tenuki' ? a === b : a[0] === b[0] && a[1] === b[1])

/** A graph path as board moves: colours alternate from Black, a tenuki is a pass. */
export const pathMoves = (path: readonly ZoneMove[]): Move[] => path.map((m, i) => ({ color: i % 2 === 0 ? 'B' : 'W', vertex: m === 'tenuki' ? 'pass' : m }))

/** The colour to move after a graph path. */
export const pathToMove = (path: readonly ZoneMove[]): Color => (path.length % 2 === 0 ? 'B' : 'W')

/**
 * A move of a training position (in the board corner `corner`) in the orientation of the graph node it is played from:
 * first into the top-right corner, then mirrored when `mirrored` says the node is kept as the mirror of the position.
 * The order matters (corner first, mirror second), and `mirrored` must be recomputed at each node (`nodeOfTraining`):
 * the orientation can flip along an edge. Tenuki stays tenuki.
 */
export function toNodeMove(u: Vertex | 'tenuki', corner: Corner, mirrored: boolean): ZoneMove {
  if (u === 'tenuki') return 'tenuki'
  const v = toTopRight(u, corner)
  return mirrored ? mirrorDiagonal(v) : v
}

/** The inverse of toNodeMove: a move of a node's edge as a board move in `corner`; the same order and the same per-node `mirrored`. */
export function fromNodeMove(e: ZoneMove, corner: Corner, mirrored: boolean): Vertex | 'tenuki' {
  if (e === 'tenuki') return 'tenuki'
  return fromTopRight(mirrored ? mirrorDiagonal(e) : e, corner)
}

/**
 * A node key packed for the in-memory index of GraphBook (never written to a file): two bits per zone point in key order
 * (0 empty, 1 black, 2 white), four points a byte from the low bits, then the side to move in the last byte (0 Black,
 * 1 White). Equal keys pack to equal bytes, so the packed form is compared and hashed as it is.
 */
export const PACKED_KEY_BYTES = 32
const SIDE_BYTE = PACKED_KEY_BYTES - 1
const KEY_LENGTH = 2 + ZONE_POINTS

/** Packs the zone points (`points[i]`: 0, 1 or 2 for the i-th point of the key) and the side to move into `out` at `at`. */
export function packPoints(points: ArrayLike<number>, toMove: Color, out: Uint8Array, at: number): void {
  out.fill(0, at, at + PACKED_KEY_BYTES)
  for (let i = 0; i < ZONE_POINTS; i++) out[at + (i >> 2)] |= points[i] << ((i & 3) << 1)
  out[at + SIDE_BYTE] = toMove === 'W' ? 1 : 0
}

/** Packs a key (see positionKey) into `out` at `at`; false when `key` is not a key (the bytes at `at` are then partly written). */
export function packKey(key: string, out: Uint8Array, at: number): boolean {
  if (key.length !== KEY_LENGTH || key[1] !== ':' || (key[0] !== 'B' && key[0] !== 'W')) return false
  out.fill(0, at, at + PACKED_KEY_BYTES)
  for (let i = 0; i < ZONE_POINTS; i++) {
    const point = key.charCodeAt(2 + i) - 0x30 // '0'
    if (point < 0 || point > 2) return false
    out[at + (i >> 2)] |= point << ((i & 3) << 1)
  }
  out[at + SIDE_BYTE] = key[0] === 'W' ? 1 : 0
  return true
}

/** The side to move of a packed key. */
export const packedToMove = (packed: Uint8Array, at: number): Color => (packed[at + SIDE_BYTE] === 1 ? 'W' : 'B')

const keyChars = new Uint8Array(KEY_LENGTH)
const keyText = new TextDecoder('latin1')

/** The key string of a packed key. */
export function unpackKey(packed: Uint8Array, at: number): string {
  keyChars[0] = packedToMove(packed, at).charCodeAt(0)
  keyChars[1] = 0x3a // ':'
  for (let i = 0; i < ZONE_POINTS; i++) keyChars[2 + i] = 0x30 + ((packed[at + (i >> 2)] >> ((i & 3) << 1)) & 3)
  return keyText.decode(keyChars)
}
