import { colorSign, type Actor, type Category, type Color, type Corner, type Rating, type RepetitionInfo, type ReviewData, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it, vi } from 'vitest'
import { decodeJdb, encodeJdb, toTopRight } from '../jdb'
import { StartBook } from '../starts/book'
import { TEST_STARTS_LIST, testStartsTree } from '../starts/fixture'
import { openDb } from '../store/db'
import type { SessionRecord } from '../store/records'
import { DEFAULT_CONFIG, type Thresholds } from '../config'
import { EngineError } from '../engine/engine'
import type { AnalysisResponse, KataGoQueryBody } from '../engine/katago-types'
import { CardRepo } from './repo'
import { newState, schedule } from './schedule'
import { CardError, CardService, LEARN_AHEAD_MS } from './service'

const book = (list = TEST_STARTS_LIST): StartBook => StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(list), () => {})
const listedId = (): string => book().list()[0].id
/** The same base with the first position taken off the list: its cards are orphans. */
const shorterList = (): StartBook => book({ branches: [], positions: TEST_STARTS_LIST.positions.slice(1) })

// Thresholds like a kyu level's, where 1.5 points is exact, and like a dan level's, where it is a mistake.
const KYU: Thresholds = { inaccuracy: 2, mistake: 4, blunder: 8, punished: 2 }
const DAN: Thresholds = { inaccuracy: 0.5, mistake: 1, blunder: 3, punished: 0.5 }

function setup(start = new Date('2026-10-15T10:00:00'), repo = new CardRepo(openDb(':memory:')), starts = book()) {
  let now = start
  let n = 0
  const service = new CardService({ repo, starts, now: () => now, newId: () => `card${++n}` })
  return { service, repo, setNow: (d: Date) => (now = d) }
}

function training(id: string, startId: string | null, userLosses: [number, 'exact' | 'inaccuracy' | 'mistake' | 'blunder'][]): [SessionRecord, ReviewData] {
  const settings = { mode: 'list' as const, environment: 'empty' as const, userColor: 'B' as const, botRank: '5k', corner: 'TR' as const, ...(startId ? { start: { id: startId, name: 'X', mirror: false } } : {}) }
  const moves = userLosses.map((_, i) => ({ color: 'B' as const, vertex: [i, 0] as [number, number], actor: 'user' as const, inZone: true }))
  const rec = { id, createdAt: '', finishedAt: '', settings, status: 'finished', parentSessionId: null, initialMoves: [], moves, summary: null } as unknown as SessionRecord
  const review = {
    sessionId: id, settings, initialMoves: [], moves, positions: [],
    moveReviews: userLosses.map(([loss, category], turn) => ({ turn, color: 'B', actor: 'user', vertex: [turn, 0], loss, category })),
    punishments: [], summary: { userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 },
  } as unknown as ReviewData
  return [rec, review]
}

describe('CardService', () => {
  it('creates a position card from a training of a listed start, once per training', () => {
    const { service } = setup()
    const [rec, review] = training('s1', listedId(), [[0, 'exact']])
    service.recordTraining(rec, review)
    service.recordTraining(rec, review)
    expect(service.list()).toHaveLength(1)
    expect(service.repetitionOf('s1')).toMatchObject({ cardId: 'card1', auto: 'good', rating: 'good', worst: null, editable: true })
  })

  it('ignores trainings without a listed start or without user moves', () => {
    const { service } = setup()
    service.recordTraining(...training('s1', null, [[0, 'exact']]))
    service.recordTraining(...training('s2', 'deadbeef', [[0, 'exact']]))
    service.recordTraining(...training('s3', listedId(), []))
    expect(service.list()).toEqual([])
  })

  it('repeats the card only for a training that began at the start position', () => {
    const { service } = setup()
    const startMoves = book().list()[0].moves.length
    const stone = (i: number) => ({ color: 'B' as const, vertex: [i, 1] as [number, number], actor: 'user' as const, inZone: true })
    const replay = (id: string, extra: number): [SessionRecord, ReviewData] => {
      const [rec, review] = training(id, listedId(), [[0, 'exact']])
      return [{ ...rec, initialMoves: Array.from({ length: startMoves + extra }, (_, i) => stone(i)) }, review]
    }
    service.recordTraining(...replay('s1', 3))
    expect(service.list()).toEqual([])
    service.recordTraining(...replay('s2', 0))
    expect(service.list()).toHaveLength(1)
  })

  it('repeats an existing card, and only the latest review can be re-rated', () => {
    const { service, setNow } = setup()
    service.recordTraining(...training('s1', listedId(), [[2.5, 'mistake']]))
    setNow(new Date('2026-10-15T10:30:00'))
    service.recordTraining(...training('s2', listedId(), [[0, 'exact']]))
    const first = service.repetitionOf('s1')!
    const second = service.repetitionOf('s2')!
    expect([first.auto, first.editable, second.editable]).toEqual(['again', false, true])
    expect(() => service.rate(first.reviewId, 'good')).toThrowError(expect.objectContaining({ code: 'not_latest' }))
    const changed = service.rate(second.reviewId, 'easy')
    expect(changed).toMatchObject({ rating: 'easy', auto: 'good', editable: true })
    expect(new Date(changed.due).getTime()).toBeGreaterThan(new Date(second.due).getTime())
  })

  it('summarizes what is due, the week and the learned cards', () => {
    const { service, setNow } = setup()
    service.recordTraining(...training('s1', listedId(), [[2.5, 'mistake']]))
    expect(service.summary()).toMatchObject({ dueNow: 0, total: 1, learned: 0 })
    setNow(new Date('2026-10-15T11:00:00'))
    const s = service.summary()
    expect(s.dueNow).toBe(1)
    expect(s.dueByKind).toEqual({ position: 1, move: 0 })
    expect(s.forecast).toHaveLength(7)
    expect(s.forecast[0]).toBe(1)
    expect(s.nextDue).toBeNull()
    expect(service.due()).toEqual({ card: { id: 'card1', kind: 'position', startId: listedId(), userColor: 'B', botRank: '5k' } })
    expect(service.startStates()[listedId()]).toMatchObject({ stage: 'learning', dueNow: true })
  })

  it('reports the next due time when nothing is due', () => {
    const { service } = setup()
    expect(service.due()).toEqual({ card: null, nextDue: null })
    service.recordTraining(...training('s1', listedId(), [[0, 'exact']]))
    // «Легко» moves the card past its learning steps: days away, out of the learn-ahead.
    service.rate(service.repetitionOf('s1')!.reviewId, 'easy')
    const nextDue = service.list()[0].due
    expect(service.summary().nextDue).toBe(nextDue)
    expect(service.due()).toEqual({ card: null, nextDue })
  })

  it('serves a card rated «Снова» again right away: it is in its learning steps, due within the learn-ahead', () => {
    const { service } = setup()
    service.recordTraining(...training('s1', listedId(), [[2.5, 'mistake']]))
    expect(service.summary()).toMatchObject({ dueNow: 0 })
    expect(service.due()).toEqual({ card: { id: 'card1', kind: 'position', startId: listedId(), userColor: 'B', botRank: '5k' } })
  })

  it('does not serve a card in its learning steps that falls due later than the learn-ahead', () => {
    const { service, repo } = setup()
    service.recordTraining(...training('s1', listedId(), [[0, 'exact']]))
    const [card] = service.list()
    expect(card.stage).toBe('learning')
    const due = new Date(card.due).getTime()
    // A clock 30 minutes before the card's due time: nothing is served; at the window's edge it is.
    expect(setup(new Date(due - 30 * 60_000), repo).service.due()).toEqual({ card: null, nextDue: card.due })
    expect(setup(new Date(due - LEARN_AHEAD_MS), repo).service.due().card).toMatchObject({ id: 'card1' })
  })

  it('deletes a card for good: a new training of the same start does not bring it back', () => {
    const { service } = setup()
    service.recordTraining(...training('s1', listedId(), [[0, 'exact']]))
    service.remove('card1')
    service.recordTraining(...training('s2', listedId(), [[0, 'exact']]))
    expect(service.list()).toEqual([])
    expect(service.repetitionOf('s2')).toBeNull()
    expect(() => service.remove('nope')).toThrow(CardError)
  })
})

describe('a position card whose start left the list', () => {
  /** A card made while the start was listed, read back by a service at 11:00 (the card is due) with the start off the list. */
  function orphaned() {
    const { service, repo } = setup()
    service.recordTraining(...training('s1', listedId(), [[2.5, 'mistake']]))
    const later = new Date('2026-10-15T11:00:00')
    return { listed: setup(later, repo).service, orphan: setup(later, repo, shorterList()).service }
  }

  it('is not served by the queue', () => {
    const { listed, orphan } = orphaned()
    expect(listed.due().card).toMatchObject({ id: 'card1' })
    expect(orphan.due()).toEqual({ card: null, nextDue: null })
  })

  it('is left out of every number of the summary', () => {
    const { listed, orphan } = orphaned()
    expect(listed.summary()).toMatchObject({ dueNow: 1, total: 1 })
    expect(orphan.summary()).toEqual({ dueNow: 0, dueByKind: { position: 0, move: 0 }, forecast: [0, 0, 0, 0, 0, 0, 0], total: 0, learned: 0, nextDue: null })
  })

  it('is left out of the tree states', () => {
    const { listed, orphan } = orphaned()
    expect(Object.keys(listed.startStates())).toEqual([listedId()])
    expect(orphan.startStates()).toEqual({})
  })

  it('stays in the list, marked, so that it can be deleted', () => {
    const { listed, orphan } = orphaned()
    expect(listed.list()).toEqual([expect.objectContaining({ id: 'card1', orphan: false })])
    expect(orphan.list()).toEqual([expect.objectContaining({ id: 'card1', startId: listedId(), moves: [], orphan: true })])
    orphan.remove('card1')
    expect(orphan.list()).toEqual([])
  })
})

describe('replaying the position cards at another level', () => {
  const at = new Date('2026-10-15T10:00:00')
  const once = (rating: Rating) => schedule(newState(at), rating, at)

  it('re-rates a review from its raw losses and replays the card; back again restores it', () => {
    const { service, repo } = setup(at)
    // A training at a kyu level, where its 1.5-point move is exact.
    service.recordTraining(...training('s1', listedId(), [[1.5, 'exact']]))
    const recorded = repo.card('card1')!.state
    expect(repo.reviewBySession('card1', 's1')!.raw).toEqual({ moves: [{ loss: 1.5 }], opponent: [] })
    service.replayLevel(DAN)
    expect(service.repetitionOf('s1')).toMatchObject({ auto: 'again', rating: 'again', worst: { category: 'mistake', loss: 1.5 } })
    expect(repo.card('card1')!.state).toEqual(once('again'))
    service.replayLevel(KYU)
    expect(service.repetitionOf('s1')).toMatchObject({ auto: 'good', rating: 'good', worst: null })
    expect(repo.card('card1')!.state).toEqual(recorded)
  })

  it('keeps a manual rating through every replay, also one that a level makes equal to the auto rating', () => {
    const { service, repo } = setup(at)
    service.recordTraining(...training('s1', listedId(), [[1.5, 'exact']]))
    const { reviewId } = service.repetitionOf('s1')!
    service.rate(reviewId, 'again')
    service.replayLevel(DAN)
    service.replayLevel(KYU)
    expect(service.repetitionOf('s1')).toMatchObject({ auto: 'good', rating: 'again' })
    expect(repo.card('card1')!.state).toEqual(once('again'))
    // A later re-rating starts from the replayed state before the review.
    expect(repo.review(reviewId)!.stateBefore).toEqual(newState(at))
    expect(service.rate(reviewId, 'hard').due).toBe(once('hard').due)
  })

  /** A position card with one review recorded before the raw losses were kept: its worst move, and the training `sessionId`. */
  function older(worst: RepetitionInfo['worst'], auto: Rating, sessionId = 'gone') {
    const { service, repo } = setup(at)
    repo.insertCard({ id: 'old', kind: 'position', key: `position:${listedId()}`, data: { startId: listedId(), userColor: 'B', botRank: '5k' }, state: once(auto), createdAt: at.toISOString() })
    const id = repo.insertReview({ cardId: 'old', reviewedAt: at.toISOString(), rating: auto, auto, worst, stateBefore: newState(at), sessionId, raw: null })
    return { service, repo, id }
  }

  it('re-categorises the stored worst move of an older review whose training is gone; an unpunished bot mistake and a clean training stay', () => {
    const { service, repo, id } = older({ category: 'inaccuracy', loss: 1.5 }, 'hard')
    service.replayLevel(DAN)
    expect(repo.review(id)).toMatchObject({ auto: 'again', rating: 'again', worst: { category: 'mistake', loss: 1.5 } })
    service.replayLevel(KYU)
    expect(repo.review(id)).toMatchObject({ auto: 'good', rating: 'good', worst: null })
    // The loss is kept from the first replay on, so a stricter level finds it again.
    service.replayLevel(DAN)
    expect(repo.review(id)).toMatchObject({ auto: 'again', worst: { category: 'mistake', loss: 1.5 }, raw: { moves: [{ loss: 1.5 }], opponent: [] } })
    expect(repo.card('old')!.state).toEqual(once('again'))
    for (const [worst, auto] of [[{ category: 'unpunished', loss: 3 }, 'again'], [null, 'good']] as const) {
      const kept = older(worst, auto)
      kept.service.replayLevel(KYU)
      kept.service.replayLevel(DAN)
      expect(kept.repo.review(kept.id)).toMatchObject({ auto, rating: auto, worst, raw: null })
      expect(kept.repo.card('old')!.state).toEqual(once(auto))
    }
  })

  it('re-derives an older review from its training while the training is in the database, and keeps its raw losses', () => {
    const { service, repo, id } = older(null, 'good', 's1')
    // The training as the review service rebuilds it (only its losses count).
    const [, rebuilt] = training('s1', listedId(), [[0.25, 'exact'], [1.5, 'exact']])
    const asked: string[] = []
    service.replayLevel(DAN, (sessionId) => {
      asked.push(sessionId)
      return rebuilt
    })
    expect(asked).toEqual(['s1'])
    expect(repo.review(id)).toMatchObject({ auto: 'again', worst: { category: 'mistake', loss: 1.5 }, raw: { moves: [{ loss: 0.25 }, { loss: 1.5 }], opponent: [] } })
    // The raw losses are kept: the training is not asked for again.
    service.replayLevel(KYU, (sessionId) => {
      asked.push(sessionId)
      return null
    })
    expect(asked).toEqual(['s1'])
    expect(repo.review(id)).toMatchObject({ auto: 'good', worst: null })
  })

  it('falls back to the stored worst move of an older review whose training cannot be rebuilt, and logs it', () => {
    const { repo, id } = older({ category: 'inaccuracy', loss: 1.5 }, 'hard', 's1')
    const lines: string[] = []
    const service = new CardService({ repo, starts: book(), now: () => at, log: (line) => lines.push(line) })
    service.replayLevel(DAN, () => {
      throw new Error('damaged analysis')
    })
    expect(repo.review(id)).toMatchObject({ auto: 'again', worst: { category: 'mistake', loss: 1.5 }, raw: { moves: [{ loss: 1.5 }], opponent: [] } })
    expect(lines).toEqual([expect.stringMatching(/training s1 not rebuilt.*damaged analysis/)])
  })

  it('writes only what a replay changes', () => {
    const { service, repo } = setup(at)
    service.recordTraining(...training('s1', listedId(), [[1.5, 'exact']]))
    const replaced = vi.spyOn(repo, 'replaceReview')
    const updated = vi.spyOn(repo, 'updateState')
    // Recorded as exact, as the kyu thresholds rate 1.5 points: nothing to write. The dan ones change the review and the
    // card once; a second replay at them changes nothing.
    service.replayLevel(KYU)
    expect([replaced.mock.calls.length, updated.mock.calls.length]).toEqual([0, 0])
    service.replayLevel(DAN)
    expect([replaced.mock.calls.length, updated.mock.calls.length]).toEqual([1, 1])
    service.replayLevel(DAN)
    expect([replaced.mock.calls.length, updated.mock.calls.length]).toEqual([1, 1])
  })
})

/**
 * A training of Black in `corner`, seen in the top-right corner: Q16 (exact), the bot's R17, then a 2.4-point mistake at
 * O17. Every position carries one candidate, so the mistake makes a problem card; with `startId` the training is of a
 * listed start too.
 */
function problemTraining(id: string, corner: Corner = 'TR', startId: string | null = null): [SessionRecord, ReviewData] {
  const settings = { mode: startId ? 'list' : 'free', environment: 'empty', userColor: 'B', botRank: '5k', corner, ...(startId ? { start: { id: startId, name: 'X', mirror: false } } : {}) }
  const played: [Color, Vertex, Actor, number, Category][] = [
    ['B', [15, 3], 'user', 0, 'exact'],
    ['W', [16, 2], 'bot', 0, 'exact'],
    ['B', [13, 2], 'user', 2.4, 'mistake'],
  ]
  const moves = played.map(([color, vertex, actor]) => ({ color, vertex: toTopRight(vertex, corner), actor, inZone: true }))
  const rec = { id, createdAt: '', finishedAt: '', settings, status: 'finished', parentSessionId: null, initialMoves: [], moves, summary: null } as unknown as SessionRecord
  const review = {
    sessionId: id, settings, initialMoves: [], moves,
    positions: Array.from({ length: moves.length + 1 }, (_, turn) => ({ turn, scoreLeadBlack: 0, visits: 10, candidates: [{ vertex: toTopRight([15, 2], corner), loss: 0, pv: [] }], ownership: null })),
    moveReviews: played.map(([color, , actor, loss, category], turn) => ({ turn, color, actor, vertex: moves[turn].vertex, loss, category })),
    punishments: [], summary: { userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 },
  } as unknown as ReviewData
  return [rec, review]
}

describe('problem cards', () => {
  it('makes a card of a mistake, due within minutes, once per training; another training of the position repeats it', () => {
    const start = new Date('2026-10-15T10:00:00')
    const { service, repo, setNow } = setup(start)
    service.recordTraining(...problemTraining('s1'))
    service.recordTraining(...problemTraining('s1'))
    const [card, ...rest] = service.list()
    expect(rest).toEqual([])
    expect(service.repetitionOf('s1')).toBeNull()
    expect(card).toMatchObject({
      id: 'card1', kind: 'move', startId: null, moves: [], stage: 'learning', lastRating: 'again', reps: 1, orphan: false,
      problem: { source: 'mistake', group: '4-4', moveNumber: 3, black: ['Q16'], white: ['R17'] },
    })
    expect(new Date(card.due).getTime() - start.getTime()).toBeLessThanOrEqual(10 * 60_000)
    setNow(new Date('2026-10-15T10:30:00'))
    service.recordTraining(...problemTraining('s2'))
    expect(service.list()).toEqual([expect.objectContaining({ id: 'card1', reps: 2 })])
    expect(repo.reviewBySession('card1', 's2')).toMatchObject({ rating: 'again', auto: 'again', worst: null })
  })

  it('repeats the same card for the same position in another corner', () => {
    const { service, repo } = setup()
    service.recordTraining(...problemTraining('s1', 'TR'))
    service.recordTraining(...problemTraining('s2', 'BL'))
    expect(service.list()).toEqual([expect.objectContaining({ id: 'card1', reps: 2 })])
    expect(repo.reviewBySession('card1', 's2')).not.toBeNull()
  })

  it('does not bring a deleted problem card back', () => {
    const { service } = setup()
    service.recordTraining(...problemTraining('s1'))
    service.remove('card1')
    service.recordTraining(...problemTraining('s2'))
    expect(service.list()).toEqual([])
  })

  it('shows the position card over the review of a training that made a problem card too', () => {
    const { service } = setup()
    service.recordTraining(...problemTraining('s1', 'TR', listedId()))
    expect(service.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'card1', kind: 'position', startId: listedId(), problem: null }),
        expect.objectContaining({ id: 'card2', kind: 'move' }),
      ]),
    )
    expect(service.repetitionOf('s1')).toMatchObject({ cardId: 'card1', auto: 'again' })
  })

  it('serves a due problem card as the problem screen shows it, without the candidates', () => {
    const { service } = setup()
    service.recordTraining(...problemTraining('s1', 'BL'))
    expect(service.due()).toEqual({
      card: {
        id: 'card1', kind: 'move',
        problem: { source: 'mistake', corner: 'BL', userColor: 'B', moves: [{ color: 'B', vertex: [3, 15] }, { color: 'W', vertex: [2, 16] }], userMove: [5, 16], userLoss: 2.4, moveNumber: 3, group: '4-4' },
      },
    })
  })

  it('gives the moves and the side to move of a problem card; nothing for a position card, an unknown or a deleted card', () => {
    const { service } = setup()
    service.recordTraining(...problemTraining('s1', 'TR', listedId()))
    expect(service.problemBase('card2')).toEqual({ moves: [{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [16, 2] }], toMove: 'B' })
    expect(service.problemBase('card1')).toBeNull()
    expect(service.problemBase('nope')).toBeNull()
    service.remove('card2')
    expect(service.problemBase('card2')).toBeNull()
  })

  it('counts a problem card in the next due time when nothing is due', () => {
    const { service, repo } = setup()
    service.recordTraining(...problemTraining('s1'))
    service.rate(repo.reviewBySession('card1', 's1')!.id, 'easy')
    const nextDue = service.list()[0].due
    expect(service.due()).toEqual({ card: null, nextDue })
  })
})

describe('answering a problem', () => {
  /**
   * A problem card (Black to move after B Q16, W R17); the stored candidates: Q17 (best) and P17 (loss 0.8). `meanwhile`
   * runs while the engine judges an answer.
   */
  function problemSetup(opts: { ready?: boolean; fail?: Error; lead?: number; meanwhile?: (service: CardService) => void } = {}) {
    const queries: KataGoQueryBody[] = []
    const judge = {
      analyze: async (q: KataGoQueryBody): Promise<AnalysisResponse> => {
        queries.push(q)
        opts.meanwhile?.(service)
        if (opts.fail) throw opts.fail
        return { rootInfo: { scoreLead: opts.lead ?? -2.5 } } as unknown as AnalysisResponse
      },
      ready: () => opts.ready ?? true,
      thresholds: () => DEFAULT_CONFIG.thresholds,
      visits: () => 10,
    }
    let now = new Date('2026-10-15T10:00:00')
    const repo = new CardRepo(openDb(':memory:'))
    const service = new CardService({ repo, starts: book(), now: () => now, newId: () => 'card1', judge })
    const [rec, review] = problemTraining('s1')
    review.positions[2].candidates = [
      { vertex: [15, 2], loss: 0, pv: [] },
      { vertex: [14, 2], loss: 0.8, pv: [] },
    ] as never
    service.recordTraining(rec, review)
    return { service, repo, queries, setNow: (d: Date) => (now = d) }
  }

  it('judges the best stored candidate without the engine: exact, easy', async () => {
    const { service, queries } = problemSetup()
    const a = await service.answer('card1', [15, 2])
    expect(a).toMatchObject({ vertex: [15, 2], loss: 0, category: 'exact', best: true, line: { vertex: [15, 2] } })
    expect(a.repetition).toMatchObject({ cardId: 'card1', auto: 'easy', rating: 'easy', editable: true })
    expect(queries).toEqual([])
  })

  it('judges another stored candidate by its loss: inaccuracy, hard', async () => {
    const { service, queries } = problemSetup()
    const a = await service.answer('card1', [14, 2])
    expect(a).toMatchObject({ loss: 0.8, category: 'inaccuracy', best: false })
    expect(a.repetition.auto).toBe('hard')
    expect(queries).toEqual([])
  })

  it('carries the stored analysis of the problem position, and the lead after a stored candidate from its loss', async () => {
    const { service } = problemSetup()
    const a = await service.answer('card1', [14, 2])
    expect(a.position).toEqual({
      turn: 0, scoreLeadBlack: 0, visits: 10, ownership: null,
      candidates: [{ vertex: [15, 2], loss: 0, pv: [] }, { vertex: [14, 2], loss: 0.8, pv: [] }],
    })
    // Black is to move: the answer's loss is taken from Black's lead.
    expect(a.leadAfter).toBe(0 - colorSign('B') * 0.8)
  })

  it('asks the engine about a point outside the candidates: loss from the lead after the move', async () => {
    const { service, queries } = problemSetup()
    const a = await service.answer('card1', [10, 10])
    expect(queries).toHaveLength(1)
    expect(queries[0].maxVisits).toBe(10)
    expect(queries[0].priority).toBe(10)
    expect(queries[0].moves).toHaveLength(3)
    expect(queries[0].moves[2]).toEqual(['B', 'L9'])
    expect(a).toMatchObject({ loss: 2.5, category: 'mistake', best: false, leadAfter: -2.5 })
    expect(a.repetition.auto).toBe('again')
  })

  it('keeps the measured lead after a point outside the candidates, a gain included', async () => {
    const { service } = problemSetup({ lead: 1.5 })
    const a = await service.answer('card1', [10, 10])
    expect(a).toMatchObject({ loss: 0, leadAfter: 1.5 })
  })

  it('rejects an occupied point, an unknown card and a position card', async () => {
    const { service } = problemSetup()
    await expect(service.answer('card1', [15, 3])).rejects.toMatchObject({ code: 'illegal_move' })
    await expect(service.answer('nope', [1, 1])).rejects.toMatchObject({ code: 'card_not_found' })
    const { service: other } = setup()
    other.recordTraining(...training('p1', listedId(), [[0, 'exact']]))
    await expect(other.answer('card1', [1, 1])).rejects.toMatchObject({ code: 'wrong_kind' })
  })

  it('is unavailable without a ready engine or when the engine fails, and records nothing', async () => {
    const down = problemSetup({ ready: false })
    await expect(down.service.answer('card1', [10, 10])).rejects.toMatchObject({ code: 'engine_unavailable' })
    const failing = problemSetup({ fail: new EngineError({ key: 'error.engine.noHumanPolicy' }, 'query_error') })
    await expect(failing.service.answer('card1', [10, 10])).rejects.toMatchObject({ code: 'engine_unavailable' })
    expect(failing.repo.card('card1')!.state.reps).toBe(1)
    expect(down.repo.card('card1')!.state.reps).toBe(1)
  })

  it('rethrows a failure that is not an engine error as it is, and records nothing', async () => {
    const boom = new TypeError('boom')
    const { service, repo } = problemSetup({ fail: boom })
    const before = repo.latestReviewId('card1')
    await expect(service.answer('card1', [10, 10])).rejects.toBe(boom)
    expect(repo.card('card1')!.state.reps).toBe(1)
    expect(repo.latestReviewId('card1')).toBe(before)
  })

  it('drops the verdict on a card deleted while the engine judged it, and records nothing', async () => {
    const { service, repo } = problemSetup({ meanwhile: (s) => s.remove('card1') })
    const before = repo.latestReviewId('card1')
    const err = await service.answer('card1', [10, 10]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CardError)
    expect(err).toMatchObject({ code: 'card_not_found' })
    expect(repo.card('card1')).toMatchObject({ deleted: true, state: { reps: 1 } })
    expect(repo.latestReviewId('card1')).toBe(before)
  })

  it('is re-rated from its answer loss at another level; the review of the training that made the problem stays «Снова»', async () => {
    const { service, repo, setNow } = problemSetup()
    const made = new Date('2026-10-15T10:00:00')
    const answered = new Date('2026-10-15T10:30:00')
    setNow(answered)
    // 0.8 points: an inaccuracy at the default thresholds, exact at the kyu ones.
    const { reviewId } = (await service.answer('card1', [14, 2])).repetition
    expect(repo.review(reviewId)).toMatchObject({ auto: 'hard', raw: { loss: 0.8, best: false } })
    service.replayLevel(KYU)
    expect(repo.review(reviewId)).toMatchObject({ auto: 'good', rating: 'good', worst: null })
    expect(repo.reviewBySession('card1', 's1')).toMatchObject({ auto: 'again', rating: 'again' })
    expect(repo.card('card1')!.state).toEqual(schedule(schedule(newState(made), 'again', made), 'good', answered))
    service.replayLevel(DEFAULT_CONFIG.thresholds)
    expect(repo.review(reviewId)).toMatchObject({ auto: 'hard', worst: { category: 'inaccuracy', loss: 0.8 } })
    // Answers recorded before the raw losses were kept: from the stored loss; the best move stays «Легко».
    const older = repo.insertReview({ cardId: 'card1', reviewedAt: answered.toISOString(), rating: 'again', auto: 'again', worst: { category: 'mistake', loss: 2.5 }, stateBefore: newState(made), sessionId: null, raw: null })
    const best = repo.insertReview({ cardId: 'card1', reviewedAt: answered.toISOString(), rating: 'easy', auto: 'easy', worst: null, stateBefore: newState(made), sessionId: null, raw: null })
    service.replayLevel(KYU)
    expect(repo.review(older)).toMatchObject({ auto: 'hard', worst: { category: 'inaccuracy', loss: 2.5 } })
    expect(repo.review(best)).toMatchObject({ auto: 'easy', worst: null })
  })

  it('records the answer as a review that can be re-rated', async () => {
    const { service, repo, setNow } = problemSetup()
    setNow(new Date('2026-10-15T10:30:00'))
    const a = await service.answer('card1', [14, 2])
    expect(repo.review(a.repetition.reviewId)).toMatchObject({ sessionId: null, auto: 'hard', worst: { category: 'inaccuracy', loss: 0.8 } })
    expect(service.rate(a.repetition.reviewId, 'good')).toMatchObject({ rating: 'good', auto: 'hard', editable: true })
  })
})
