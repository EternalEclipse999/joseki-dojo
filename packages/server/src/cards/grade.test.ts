import type { ReviewData } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { positionRating } from './grade'

/** A review with user moves of the given losses/categories (all in the zone) and optional punishment events. */
function review(user: { loss: number; category: 'exact' | 'inaccuracy' | 'mistake' | 'blunder'; inZone?: boolean }[], punished: boolean[] = []): ReviewData {
  const moves = user.map((u, i) => ({ color: 'B' as const, vertex: [i, 0] as [number, number], actor: 'user' as const, inZone: u.inZone ?? true }))
  return {
    sessionId: 's',
    settings: { mode: 'list', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' },
    initialMoves: [],
    moves,
    positions: [],
    moveReviews: user.map((u, turn) => ({ turn, color: 'B', actor: 'user', vertex: [turn, 0], loss: u.loss, category: u.category })),
    punishments: punished.map((p, i) => ({ turn: i, botLoss: 3, userLoss: p ? 0 : 3, punished: p, kept: p ? 3 : 0 })),
    summary: { userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 },
  } as unknown as ReviewData
}

describe('positionRating', () => {
  it('rates by the worst in-zone user move', () => {
    expect(positionRating(review([{ loss: 0.1, category: 'exact' }]))).toEqual({ rating: 'good', worst: null })
    expect(positionRating(review([{ loss: 0.1, category: 'exact' }, { loss: 0.8, category: 'inaccuracy' }]))).toEqual({ rating: 'hard', worst: { category: 'inaccuracy', loss: 0.8 } })
    expect(positionRating(review([{ loss: 2.4, category: 'mistake' }, { loss: 0.8, category: 'inaccuracy' }]))?.rating).toBe('again')
    expect(positionRating(review([{ loss: 7, category: 'blunder' }]))).toEqual({ rating: 'again', worst: { category: 'blunder', loss: 7 } })
  })

  it('ignores moves outside the zone and counts an unpunished bot mistake as a mistake', () => {
    expect(positionRating(review([{ loss: 9, category: 'blunder', inZone: false }, { loss: 0, category: 'exact' }]))?.rating).toBe('good')
    expect(positionRating(review([{ loss: 0, category: 'exact' }], [false]))).toEqual({ rating: 'again', worst: { category: 'unpunished', loss: 3 } })
    expect(positionRating(review([{ loss: 0, category: 'exact' }], [true]))?.rating).toBe('good')
  })

  it('is no repetition without user moves', () => {
    expect(positionRating(review([]))).toBeNull()
  })

  it('counts an unpunished bot mistake only when the bot move is in the zone', () => {
    const r = review([{ loss: 0, category: 'exact' }], [false])
    r.moves = [{ ...r.moves[0], inZone: true }, { ...r.moves[0], actor: 'bot', inZone: false }] as ReviewData['moves']
    r.punishments = [{ turn: 1, botLoss: 3, userLoss: 3, punished: false, kept: 0 }]
    expect(positionRating(r)?.rating).toBe('good')
    r.moves = [{ ...r.moves[0], inZone: true }, { ...r.moves[0], actor: 'bot', inZone: true }] as ReviewData['moves']
    expect(positionRating(r)).toEqual({ rating: 'again', worst: { category: 'unpunished', loss: 3 } })
  })

  it('is no repetition without in-zone user moves', () => {
    expect(positionRating(review([{ loss: 9, category: 'blunder', inZone: false }]))).toBeNull()
  })
})
