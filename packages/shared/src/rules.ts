import GoBoard from '@sabaki/go-board'
import { BOARD_SIZE } from './coords'
import { otherColor, type Color, type Move, type Vertex } from './types'

export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalMoveError'
  }
}

export const colorSign = (c: Color): 1 | -1 => (c === 'B' ? 1 : -1)

export function nextColor(moves: readonly Move[]): Color {
  const last = moves.at(-1)
  return last ? otherColor(last.color) : 'B'
}

/** Immutable board position with simple-ko, suicide and overwrite checks. */
export class Position {
  private constructor(private readonly board: GoBoard) {}

  static empty(): Position {
    return new Position(GoBoard.fromDimensions(BOARD_SIZE))
  }

  static fromMoves(moves: readonly Move[]): Position {
    return moves.reduce((p, m) => p.play(m), Position.empty())
  }

  play(move: Move): Position {
    if (move.vertex === 'pass') {
      // go-board keeps the ko ban across passes; a fresh board drops it (simple ko lasts one move).
      const fresh = new GoBoard(this.board.signMap.map((row) => [...row]))
      fresh.setCaptures(1, this.board.getCaptures(1))
      fresh.setCaptures(-1, this.board.getCaptures(-1))
      return new Position(fresh)
    }
    if (!this.board.has(move.vertex)) throw new IllegalMoveError(`Off-board vertex ${move.vertex.join(',')}`)
    try {
      const next = this.board.makeMove(colorSign(move.color), move.vertex, {
        preventSuicide: true,
        preventOverwrite: true,
        preventKo: true,
      })
      return new Position(next)
    } catch (err) {
      throw new IllegalMoveError(err instanceof Error ? err.message : String(err))
    }
  }

  isLegal(color: Color, vertex: Vertex): boolean {
    try {
      this.play({ color, vertex })
      return true
    } catch (err) {
      if (err instanceof IllegalMoveError) return false
      throw err
    }
  }

  colorAt(vertex: Vertex): Color | null {
    const s = this.board.get(vertex)
    return s === 1 ? 'B' : s === -1 ? 'W' : null
  }

  signMap(): (0 | 1 | -1)[][] {
    return this.board.signMap.map((row) => [...row])
  }

  emptyVertices(): Vertex[] {
    const out: Vertex[] = []
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) if (this.board.get([x, y]) === 0) out.push([x, y])
    }
    return out
  }
}
