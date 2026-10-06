import type { MoveVertex, Vertex } from './types'

export const BOARD_SIZE = 19
/** Index of "pass" in KataGo policy arrays (after the 361 board points). */
export const PASS_INDEX = BOARD_SIZE * BOARD_SIZE

const LETTERS = 'ABCDEFGHJKLMNOPQRST'

const onBoard = (n: number): boolean => Number.isInteger(n) && n >= 0 && n < BOARD_SIZE

export function vertexToGtp([x, y]: Vertex): string {
  if (!onBoard(x) || !onBoard(y)) throw new Error(`Vertex off board: ${x},${y}`)
  return `${LETTERS[x]}${BOARD_SIZE - y}`
}

export function gtpToVertex(s: string): MoveVertex {
  const t = s.trim().toUpperCase()
  if (t === 'PASS') return 'pass'
  const x = t.length > 0 ? LETTERS.indexOf(t[0]) : -1
  const row = Number(t.slice(1))
  if (x < 0 || !Number.isInteger(row) || row < 1 || row > BOARD_SIZE) throw new Error(`Invalid GTP vertex: "${s}"`)
  return [x, BOARD_SIZE - row]
}

export const moveToGtp = (v: MoveVertex): string => (v === 'pass' ? 'pass' : vertexToGtp(v))

export function vertexToIndex([x, y]: Vertex): number {
  if (!onBoard(x) || !onBoard(y)) throw new Error(`Vertex off board: ${x},${y}`)
  return y * BOARD_SIZE + x
}

export function indexToVertex(i: number): MoveVertex {
  if (i === PASS_INDEX) return 'pass'
  if (!Number.isInteger(i) || i < 0 || i > PASS_INDEX) throw new Error(`Invalid board index: ${i}`)
  return [i % BOARD_SIZE, Math.floor(i / BOARD_SIZE)]
}

export function sameVertex(a: MoveVertex, b: MoveVertex): boolean {
  if (a === 'pass' || b === 'pass') return a === b
  return a[0] === b[0] && a[1] === b[1]
}
