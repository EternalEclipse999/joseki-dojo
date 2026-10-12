import { BOARD_SIZE, otherColor, type Color, type Move, type MoveVertex, type Vertex } from '@joseki-dojo/shared'

export function emptyMap<T>(fill: T): T[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => fill))
}

/** KataGo ownership (row-major from the top-left, Black positive) as a Shudan paint map. */
export function ownershipMap(ownership: readonly number[] | null): number[][] | null {
  if (!ownership) return null
  return Array.from({ length: BOARD_SIZE }, (_, y) => ownership.slice(y * BOARD_SIZE, (y + 1) * BOARD_SIZE))
}

/** The first `count` moves of a variation, alternating colors from `first`. */
export function pvMoves(first: Color, pv: readonly MoveVertex[], count: number): Move[] {
  return pv.slice(0, count).map((vertex, i) => ({ color: i % 2 === 0 ? first : otherColor(first), vertex }))
}

export const isVertex = (v: MoveVertex): v is Vertex => v !== 'pass'

export const sameVertex = (a: MoveVertex, b: MoveVertex): boolean => (isVertex(a) && isVertex(b) ? a[0] === b[0] && a[1] === b[1] : a === b)
