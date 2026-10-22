import { describe, expect, it } from 'vitest'
import { PLAYER_LEVELS, type ServerMessage } from '@joseki-dojo/shared'
import { StubEngine, testConfig } from '../../test/helpers'
import { AnalysisScheduler } from '../analysis/scheduler'
import { CardRepo } from '../cards/repo'
import { CardService } from '../cards/service'
import { decodeJdb, encodeJdb } from '../jdb'
import { TEST_THRESHOLDS, walkBook } from '../progress/fixture'
import { GraphCardRepo } from '../progress/repo'
import { GraphProgressService } from '../progress/service'
import { StartBook } from '../starts/book'
import { TEST_STARTS_LIST, testStartsTree } from '../starts/fixture'
import { SessionError } from '../session/session'
import { openDb } from '../store/db'
import type { SessionRecord } from '../store/records'
import { SessionRepo } from '../store/repo'
import { ReviewService } from './service'
import type { ThresholdTable } from './thresholds'

function setup(thresholds: ThresholdTable | null = null, cards?: CardService, start?: SessionRecord['settings']['start'], progress?: GraphProgressService) {
  const engine = new StubEngine()
  const repo = new SessionRepo(openDb(':memory:'))
  const config = testConfig()
  const published: ServerMessage[] = []
  const logs: string[] = []
  const reviews = new ReviewService({
    repo,
    config,
    analysis: new AnalysisScheduler(engine, repo, config.analysis),
    publish: (_id, msg) => published.push(msg),
    thresholds,
    cards,
    progress,
    now: () => '2026-10-06T10:10:00.000Z',
    log: (line) => logs.push(line),
  })
  const rec: SessionRecord = {
    id: 's1',
    createdAt: '2026-10-06T10:00:00.000Z',
    finishedAt: '2026-10-06T10:05:00.000Z',
    settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR', ...(start ? { start } : {}) },
    status: 'finished',
    parentSessionId: null,
    initialMoves: [],
    moves: [
      { color: 'B', vertex: [15, 3], actor: 'user', inZone: true },
      { color: 'W', vertex: [16, 5], actor: 'bot', inZone: true },
      { color: 'B', vertex: [14, 5], actor: 'user', inZone: true },
    ],
    summary: null,
  }
  repo.insertSession(rec)
  // Black's lead per position: the bot (White) loses 3 on turn 1, the user gives back 1 on turn 2.
  engine.lead = (q) => [0, 0, 3, 2][q.moves.length]
  return { engine, repo, reviews, published, logs }
}

describe('ReviewService', () => {
  it('is not ready before the analyses exist and not found for unknown sessions', () => {
    const { reviews } = setup()
    expect(reviews.get('s1')).toEqual({ status: 'not_ready' })
    expect(reviews.get('nope')).toEqual({ status: 'not_found' })
  })

  it('analyses every position, reports progress and stores the results', async () => {
    const { reviews, repo, published } = setup()
    const review = await reviews.prepare('s1')
    expect(review.summary).toEqual({ userLoss: 1, botMistakes: 1, botMistakeLoss: 3, punished: 0, keptPoints: 2 })
    const progress = published.filter((m) => m.type === 'analysisProgress')
    expect(progress[0]).toEqual({ type: 'analysisProgress', sessionId: 's1', done: 0, total: 4 })
    expect(progress.at(-1)).toEqual({ type: 'analysisProgress', sessionId: 's1', done: 4, total: 4 })
    expect(published.at(-1)).toEqual({ type: 'reviewReady', sessionId: 's1' })
    expect(repo.getSession('s1')?.summary).toEqual(review.summary)
    expect(repo.listMissedPunishments('s1')).toEqual([
      { turn: 1, botMove: [16, 5], botLoss: 3, userMove: [14, 5], userLoss: 1, bestMove: [3, 15], bestPv: [[3, 15]] },
    ])
    const got = reviews.get('s1')
    expect(got.status).toBe('ok')
    if (got.status === 'ok') expect(got.review.moveReviews.map((m) => m.category)).toEqual(['exact', 'mistake', 'inaccuracy'])
  })

  it('takes the category thresholds of the player level from the table', async () => {
    const level = { inaccuracy: 0.2, mistake: 0.5, blunder: 3 }
    const table: ThresholdTable = { method: {}, levels: Object.fromEntries(PLAYER_LEVELS.map((l) => [l, level])) }
    const categories = async (t: ThresholdTable | null) => {
      const got = await setup(t).reviews.prepare('s1')
      return got.moveReviews.map((m) => m.category)
    }
    expect(await categories(null)).toEqual(['exact', 'mistake', 'inaccuracy'])
    expect(await categories(table)).toEqual(['exact', 'blunder', 'mistake'])
  })

  it('rebuilds the review of a training at other thresholds from its stored analyses; nothing without them', async () => {
    const { reviews } = setup()
    const kyu = { inaccuracy: 2, mistake: 4, blunder: 8, punished: 2 }
    expect(reviews.rebuild('s1', kyu)).toBeNull()
    await reviews.prepare('s1')
    expect(reviews.rebuild('s1', kyu)?.moveReviews.map((m) => m.category)).toEqual(['exact', 'inaccuracy', 'exact'])
    expect(reviews.rebuild('s1', TEST_THRESHOLDS)?.moveReviews.map((m) => m.category)).toEqual(['exact', 'mistake', 'inaccuracy'])
    expect(reviews.rebuild('nope', kyu)).toBeNull()
  })

  it('reuses stored analyses', async () => {
    const { engine, reviews } = setup()
    await reviews.prepare('s1')
    const count = engine.queries.length
    await reviews.prepare('s1')
    expect(engine.queries).toHaveLength(count)
  })

  it('rejects unknown sessions', async () => {
    await expect(setup().reviews.prepare('nope')).rejects.toBeInstanceOf(SessionError)
  })

  it('shares one run between concurrent prepares and runs again afterwards', async () => {
    const { reviews, published } = setup()
    const a = reviews.prepare('s1')
    const b = reviews.prepare('s1')
    const [ra, rb] = await Promise.all([a, b])
    expect(rb).toBe(ra)
    expect(published.filter((m) => m.type === 'reviewReady')).toHaveLength(1)
    await reviews.prepare('s1')
    expect(published.filter((m) => m.type === 'reviewReady')).toHaveLength(2)
  })

  it('records a card repetition of a start training and shows it over the review', async () => {
    const starts = StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})
    const cards = new CardService({ repo: new CardRepo(openDb(':memory:')), starts })
    const { engine, reviews } = setup(null, cards, { id: starts.list()[0].id, name: 'X', mirror: false })
    engine.lead = () => 0
    const review = await reviews.prepare('s1')
    expect(cards.list()).toHaveLength(1)
    expect(review.repetition?.auto).toBe('good')
    const got = reviews.get('s1')
    expect(got.status === 'ok' && got.review.repetition).toEqual(review.repetition)
  })

  it('never lets a failing card hook break the review', async () => {
    const boom = (): never => {
      throw new Error('boom')
    }
    const { reviews, published } = setup(null, { recordTraining: boom, repetitionOf: boom } as unknown as CardService)
    const review = await reviews.prepare('s1')
    expect(review.repetition).toBeUndefined()
    expect(published.some((m) => m.type === 'reviewReady')).toBe(true)
    expect(reviews.get('s1').status).toBe('ok')
  })

  it('still returns the review when only the repetition lookup fails', async () => {
    const starts = StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})
    const real = new CardService({ repo: new CardRepo(openDb(':memory:')), starts })
    const cards = { recordTraining: real.recordTraining.bind(real), repetitionOf: () => { throw new Error('boom') } } as unknown as CardService
    const { engine, reviews } = setup(null, cards, { id: starts.list()[0].id, name: 'X', mirror: false })
    engine.lead = () => 0
    await reviews.prepare('s1')
    const got = reviews.get('s1')
    expect(got.status === 'ok' && got.review.repetition).toBeFalsy()
    expect(real.list()).toHaveLength(1)
  })

  it('records the graph cards of a training after its card repetition', async () => {
    const graphCards = new GraphCardRepo(openDb(':memory:'))
    const progress = new GraphProgressService({ repo: graphCards, graph: walkBook(), starts: StartBook.empty(), thresholds: () => TEST_THRESHOLDS, level: () => '7k' })
    const calls: string[] = []
    const cards = { recordTraining: () => calls.push('cards'), repetitionOf: () => null } as unknown as CardService
    const recordTraining = progress.recordTraining.bind(progress)
    progress.recordTraining = (rec, review) => {
      calls.push('progress')
      recordTraining(rec, review)
    }
    await setup(null, cards, undefined, progress).reviews.prepare('s1')
    expect(calls).toEqual(['cards', 'progress'])
    // Q16 and P14 are the user's: P14 is not an edge of node 2, so there is no rest after it.
    expect(graphCards.allCards().map((c) => [c.kind, c.color])).toEqual([['move', 'B'], ['move', 'B']])
  })

  it('never lets a failing graph card hook break the review or the card repetition', async () => {
    const starts = StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})
    const cards = new CardService({ repo: new CardRepo(openDb(':memory:')), starts })
    const progress = { recordTraining: () => { throw new Error('boom') } } as unknown as GraphProgressService
    const { engine, reviews, published, logs } = setup(null, cards, { id: starts.list()[0].id, name: 'X', mirror: false }, progress)
    engine.lead = () => 0
    const review = await reviews.prepare('s1')
    expect(review.repetition?.auto).toBe('good')
    expect(published.some((m) => m.type === 'reviewReady')).toBe(true)
    expect(logs).toEqual(['graph card hook failed for session s1: boom'])
  })
})
