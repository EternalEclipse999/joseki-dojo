import { readFileSync } from 'node:fs'
import { otherColor, Position, type Color, type Corner, type Move, type MoveVertex, type TrapVerdict, type Vertex } from '@joseki-dojo/shared'
import type { Rng } from '../bot/rng'
import { decodeJdb, fromTopRight, JdbError, mirrorDiagonal, mirrorMoves, sameMove, toTopRight, trapId, zoneIndex, type CanonicalMove, type JdbBase } from '../jdb'

export interface TrapPlacement {
  corner: Corner
  mirror: boolean
  swapColors: boolean
}
export type { TrapVerdict }

/** Spec 3.3: a path without a move off the diagonal reads the same in both orientations. */
const isSymmetric = (path: readonly CanonicalMove[]): boolean => path.every((m) => m !== 'tenuki' && sameMove(m, mirrorDiagonal(m)))

const sameVertex = (a: MoveVertex, b: MoveVertex): boolean => (a === 'pass' || b === 'pass' ? a === b : a[0] === b[0] && a[1] === b[1])

function isPlayable(base: JdbBase, node: number, path: readonly CanonicalMove[]): boolean {
  if (path.length < 2 || path.includes('tenuki')) return false
  try {
    Position.fromMoves(path.map((m, i): Move => ({ color: i % 2 === 0 ? 'B' : 'W', vertex: m as Vertex })))
  } catch {
    return false
  }
  const cats = base.children(node).map((c) => base.category(c))
  return cats.includes('good') && cats.includes('caught')
}

/** The trap positions of a traps base: picking one, putting it on the board and judging the answer. No session code here. */
export class TrapBook {
  private constructor(
    private readonly base: JdbBase | null,
    private readonly nodes: ReadonlyMap<string, number>,
    /** Ids of the traps the book left out because they cannot be played. */
    readonly skipped: readonly string[] = [],
  ) {}

  /** Throws `JdbError` for a bad file or a file system error for an unreadable one. */
  static load(file: string): TrapBook {
    const base = decodeJdb(readFileSync(file))
    if (base.kind !== 'traps') throw new JdbError(`Это не база ловушек (тип: ${base.kind})`)
    return TrapBook.fromBase(base)
  }
  static empty(): TrapBook {
    return new TrapBook(null, new Map())
  }
  /** Keeps the traps that can be played: a trick after at least one move, no tenuki on the way, a legal position, a good and a caught answer. */
  static fromBase(base: JdbBase): TrapBook {
    const nodes = new Map<string, number>()
    const skipped: string[] = []
    for (const i of base.nodesOf('trap')) {
      const path = base.path(i)
      const id = trapId(path)
      if (isPlayable(base, i, path)) nodes.set(id, i)
      else skipped.push(id)
    }
    return new TrapBook(base, nodes, skipped)
  }

  get count(): number {
    return this.nodes.size
  }
  get verified(): boolean {
    return this.base?.verified ?? false
  }
  has(id: string): boolean {
    return this.nodes.has(id)
  }
  ids(): string[] {
    return [...this.nodes.keys()]
  }

  /** Weighted random trap: weight 1 / (1 + shows). One `rng()` draw; null for an empty book. */
  pick(shows: (id: string) => number, rng: Rng): string | null {
    const ids = this.ids()
    if (ids.length === 0) return null
    const weights = ids.map((id) => 1 / (1 + shows(id)))
    let r = rng() * weights.reduce((a, b) => a + b, 0)
    for (let k = 0; k < ids.length; k++) {
      r -= weights[k]
      if (r < 0) return ids[k]
    }
    return ids[ids.length - 1]
  }

  private nodeOf(id: string): { base: JdbBase; node: number } {
    const node = this.nodes.get(id)
    if (node === undefined || !this.base) throw new Error(`Unknown trap ${id}`)
    return { base: this.base, node }
  }

  /** The position before the trick, the trick itself, and how the canonical trap was mapped onto the board. */
  place(id: string, corner: Corner, userColor: Color, mirror: boolean): { initialMoves: Move[]; trick: Move; placement: TrapPlacement } {
    const { base, node } = this.nodeOf(id)
    const path = base.path(node)
    const trickColor: Color = (path.length - 1) % 2 === 0 ? 'B' : 'W'
    const swapColors = trickColor === userColor
    const mapped = (mirror ? mirrorMoves(path) : path).map((m, i): Move => {
      if (m === 'tenuki') throw new Error(`Trap ${id} has a tenuki in its path`)
      const color: Color = i % 2 === 0 ? 'B' : 'W'
      return { color: swapColors ? otherColor(color) : color, vertex: fromTopRight(m, corner) }
    })
    return { initialMoves: mapped.slice(0, -1), trick: mapped[mapped.length - 1], placement: { corner, mirror, swapColors } }
  }

  private boardMove(m: CanonicalMove, p: TrapPlacement): MoveVertex {
    if (m === 'tenuki') return 'pass'
    return fromTopRight(p.mirror ? (mirrorMoves([m])[0] as Vertex) : m, p.corner)
  }

  /** Good and caught answers on the board; a tenuki answer is 'pass' (display only). */
  answers(id: string, placement: TrapPlacement): { good: MoveVertex[]; caught: MoveVertex[] } {
    const { base, node } = this.nodeOf(id)
    const out: { good: MoveVertex[]; caught: MoveVertex[] } = { good: [], caught: [] }
    const symmetric = isSymmetric(base.path(node))
    const add = (list: MoveVertex[], m: CanonicalMove): void => {
      for (const v of symmetric ? [m, ...mirrorMoves([m])] : [m]) {
        const board = this.boardMove(v, placement)
        if (!list.some((x) => sameVertex(x, board))) list.push(board)
      }
    }
    for (const c of base.children(node)) {
      const cat = base.category(c)
      if (cat === 'good') add(out.good, base.move(c))
      else if (cat === 'caught') add(out.caught, base.move(c))
    }
    return out
  }

  verdict(id: string, placement: TrapPlacement, answer: MoveVertex): TrapVerdict {
    const { base, node } = this.nodeOf(id)
    let canonical: CanonicalMove = 'tenuki'
    if (answer !== 'pass') {
      const tr = toTopRight(answer, placement.corner)
      if (zoneIndex(tr) !== null) canonical = placement.mirror ? (mirrorMoves([tr])[0] as Vertex) : tr
    }
    // A symmetric trap accepts the mirror image of an answer too.
    const wanted = isSymmetric(base.path(node)) ? [canonical, ...mirrorMoves([canonical])] : [canonical]
    const child = base.children(node).find((c) => wanted.some((w) => sameMove(base.move(c), w)))
    if (child === undefined) return 'other'
    const cat = base.category(child)
    return cat === 'good' ? 'correct' : cat === 'caught' ? 'caught' : 'other'
  }
}
