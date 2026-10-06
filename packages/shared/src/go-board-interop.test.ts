import { describe, expect, it } from 'vitest'
import GoBoard from '@sabaki/go-board'

// @sabaki/go-board is CommonJS; this guards the default-import interop the rules module relies on.
describe('@sabaki/go-board interop', () => {
  it('default import is the GoBoard class', () => {
    const board = GoBoard.fromDimensions(19).makeMove(1, [3, 3])
    expect(board.get([3, 3])).toBe(1)
    expect(board.stringifyVertex([3, 3])).toBe('D16')
  })
})
