import { BOARD_SIZE, otherColor, zoneRanges, type Category, type Color, type Corner, type Move, type MoveVertex, type Vertex } from '@joseki-dojo/shared'
import type { LineMarker } from '@sabaki/shudan'

export function emptyMap<T>(fill: T): T[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => fill))
}

/** KataGo ownership (row-major from the top-left, Black positive) as a Shudan paint map. */
export function ownershipMap(ownership: readonly number[] | null): number[][] | null {
  if (!ownership) return null
  return Array.from({ length: BOARD_SIZE }, (_, y) => ownership.slice(y * BOARD_SIZE, (y + 1) * BOARD_SIZE))
}

/** The zone's two inner edges; its other two sides are the board edges. */
export function zoneBorder(corner: Corner): LineMarker[] {
  const { x, y } = zoneRanges(corner)
  const innerX = corner === 'TL' || corner === 'BL' ? x[1] : x[0]
  const innerY = corner === 'TL' || corner === 'TR' ? y[1] : y[0]
  return [
    { v1: [innerX, y[0]], v2: [innerX, y[1]], type: 'line' },
    { v1: [x[0], innerY], v2: [x[1], innerY], type: 'line' },
  ]
}

export const GHOST_TYPE: Record<Category, 'good' | 'interesting' | 'doubtful' | 'bad'> = {
  exact: 'good',
  inaccuracy: 'interesting',
  mistake: 'doubtful',
  blunder: 'bad',
}

/** The first `count` moves of a variation, alternating colors from `first`. */
export function pvMoves(first: Color, pv: readonly MoveVertex[], count: number): Move[] {
  return pv.slice(0, count).map((vertex, i) => ({ color: i % 2 === 0 ? first : otherColor(first), vertex }))
}

export const isVertex = (v: MoveVertex): v is Vertex => v !== 'pass'
