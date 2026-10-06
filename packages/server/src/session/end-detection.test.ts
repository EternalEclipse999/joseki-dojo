import { describe, expect, it } from 'vitest'
import { Position } from '@joseki-dojo/shared'
import type { StoredAnalysis } from '../store/records'
import { bestMoveOutsideZone, josekiStartedIn, shouldProposeEnd } from './end-detection'

const analysis = (...moves: string[]): StoredAnalysis => ({
  rootInfo: { currentPlayer: 'B', scoreLead: 0, winrate: 0.5, visits: 10 },
  moveInfos: moves.map((move, order) => ({ move, order, visits: 10, scoreLead: 0, winrate: 0.5, pv: [move] })),
  ownership: null,
})

describe('josekiStartedIn', () => {
  it('needs stones of both colors inside the zone', () => {
    expect(josekiStartedIn(Position.fromMoves([{ color: 'B', vertex: [15, 3] }]), 'TR')).toBe(false)
    expect(josekiStartedIn(Position.fromMoves([{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [3, 15] }]), 'TR')).toBe(false)
    expect(josekiStartedIn(Position.fromMoves([{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [16, 5] }]), 'TR')).toBe(true)
  })
})

describe('end detection', () => {
  it('uses the order-0 move even when it is not listed first', () => {
    const a = analysis('D4')
    a.moveInfos.unshift({ move: 'Q16', order: 1, visits: 5, scoreLead: 0, winrate: 0.5, pv: ['Q16'] })
    expect(bestMoveOutsideZone(a, 'TR')).toBe(true)
  })

  it('treats pass as outside and no moves as inside', () => {
    expect(bestMoveOutsideZone(analysis('pass'), 'TR')).toBe(true)
    expect(bestMoveOutsideZone(analysis(), 'TR')).toBe(false)
  })

  it('proposes the end only when both analyses point outside the zone', () => {
    expect(shouldProposeEnd(analysis('D4'), analysis('pass'), 'TR')).toBe(true)
    expect(shouldProposeEnd(analysis('D4'), analysis('R17'), 'TR')).toBe(false)
    expect(shouldProposeEnd(analysis('Q16'), analysis('D4'), 'TR')).toBe(false)
  })
})
