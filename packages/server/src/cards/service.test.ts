import type { ReviewData } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { decodeJdb, encodeJdb } from '../jdb'
import { StartBook } from '../starts/book'
import { TEST_STARTS_LIST, testStartsTree } from '../starts/fixture'
import { openDb } from '../store/db'
import type { SessionRecord } from '../store/records'
import { CardRepo } from './repo'
import { CardError, CardService, LEARN_AHEAD_MS } from './service'

const book = (list = TEST_STARTS_LIST): StartBook => StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(list), () => {})
const listedId = (): string => book().list()[0].id
/** The same base with the first position taken off the list: its cards are orphans. */
const shorterList = (): StartBook => book({ branches: [], positions: TEST_STARTS_LIST.positions.slice(1) })

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
