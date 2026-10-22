import { State } from 'ts-fsrs'
import { describe, expect, it, vi } from 'vitest'
import { newState, schedule } from '../cards/schedule'
import type { Thresholds } from '../config'
import { GraphBook } from '../graph/book'
import { walkGraph } from '../graph/fixture'
import { encodeGraph, encodeWeights } from '../graph/format'
import { decodeJdb, encodeJdb } from '../jdb'
import { StartBook } from '../starts/book'
import { TEST_STARTS_LIST, testStartsTree } from '../starts/fixture'
import { openDb } from '../store/db'
import { keyBefore, TEST_THRESHOLDS, training, uniformWeights, walkBook, type Step } from './fixture'
import { restRating } from './record'
import { GraphCardRepo } from './repo'
import { GraphProgressService } from './service'

const book = walkBook()
const key = (node: number): string => book.nodeKey(node)
const starts = (): StartBook => StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})
// walkGraph() with Q16 on the list; at 7k and 1d every edge and the rest of a node are equally likely.
const listed = walkGraph()
listed.nodes[1].listIds.push('walk-q16')
const weighted = GraphBook.load(encodeGraph(listed), encodeWeights(uniformWeights(listed, ['7k', '1d']), listed))
// Node 4 has no White R12; Black's Q12 after it loses 2.5.
const STEPS: Step[] = [['Q16', 0, true], ['R14'], ['O16', 0.7], ['R12'], ['Q12', 2.5]]

function setup(startBook = StartBook.empty()) {
  let now = new Date('2026-10-21T10:00:00')
  const repo = new GraphCardRepo(openDb(':memory:'))
  const service = new GraphProgressService({ repo, graph: book, starts: startBook, thresholds: () => TEST_THRESHOLDS, level: () => '7k', now: () => now })
  return { repo, service, now: () => now, setNow: (d: Date) => (now = d) }
}

describe('GraphProgressService.recordTraining', () => {
  it('reviews the move and rest cards of a training and marks the positions it met', () => {
    const { repo, service, now } = setup()
    const [rec, review] = training(STEPS)
    service.recordTraining(rec, review)
    expect(repo.allCards().map((c) => [c.key, c.kind, c.color, c.createdAt])).toEqual([
      [key(0), 'move', 'B', now().toISOString()],
      [key(2), 'move', 'B', now().toISOString()],
      [key(4), 'rest', 'B', now().toISOString()],
    ])
    expect(repo.card(key(2), 'move', 'B')?.state).toEqual(schedule(newState(now()), 'hard', now()))
    expect(repo.allReviews().map((r) => [r.cardKey, r.kind, r.color, r.auto, r.manual, r.sessionId, r.reviewedAt])).toEqual([
      [key(0), 'move', 'B', 'easy', null, 's1', now().toISOString()],
      [key(2), 'move', 'B', 'hard', null, 's1', now().toISOString()],
      // Q12's mistake is at a position met for the first time.
      [key(4), 'rest', 'B', 'hard', null, 's1', now().toISOString()],
    ])
    expect(repo.allReviews()[2].raw).toEqual({
      moves: [{ loss: 2.5, key: keyBefore(rec, 4), seenBefore: false }],
      opponent: [{ loss: 0, replyLoss: 2.5, key: keyBefore(rec, 4), seenBefore: false }],
    })
    // Only the player's decision positions outside the graph: not the exit node, not a node of the walk.
    expect([keyBefore(rec, 4), key(4), key(2)].map((k) => repo.seen(k))).toEqual([true, false, false])
  })

  it('keeps every opponent move after leaving, so a stricter level finds a new unpunished mistake', () => {
    const { repo, service } = setup()
    // After White's leaving R17, which loses 1.5 (not a mistake here), Black answers with a tenuki that loses 1.5 as well.
    const [rec, review] = training([['Q16'], ['R17', 1.5], ['tenuki', 1.5], ['Q17'], ['P17']])
    service.recordTraining(rec, review)
    const [rest] = repo.reviews(key(1), 'rest', 'B')
    expect(rest.auto).toBe('good')
    expect(rest.raw).toEqual({
      moves: [{ loss: 0, key: keyBefore(rec, 4), seenBefore: false }],
      opponent: [
        { loss: 1.5, replyLoss: 1.5, key: keyBefore(rec, 2), seenBefore: false },
        { loss: 0, replyLoss: 0, key: keyBefore(rec, 4), seenBefore: false },
      ],
    })
    if (!('opponent' in rest.raw)) throw new Error('not a rest review')
    expect(restRating(rest.raw, { ...TEST_THRESHOLDS, mistake: 1 })).toBe('hard')
    expect(restRating({ ...rest.raw, opponent: rest.raw.opponent.map((o) => ({ ...o, seenBefore: true })) }, { ...TEST_THRESHOLDS, mistake: 1 })).toBe('again')
  })

  it("records a training with swapped colours under the colour of the player's role, nothing on the empty corner with White to move", () => {
    const { repo, service } = setup()
    // A trap where the user has the trick's colour: White starts the corner, and the user is White.
    const trap = { id: 'trap', index: 2, mirror: false, swapColors: true }
    const [rec, review] = training([['O16', 0.7], ['R12'], ['Q12', 2.5]], { first: 'W', initial: ['Q16', 'R14'], settings: { mode: 'traps', userColor: 'W', trap } })
    service.recordTraining(rec, review)
    expect(repo.allCards().map((c) => [c.key, c.kind, c.color])).toEqual([[key(2), 'move', 'B'], [key(4), 'rest', 'B']])
    expect(repo.allReviews().map((r) => [r.cardKey, r.kind, r.auto])).toEqual([[key(2), 'move', 'hard'], [key(4), 'rest', 'hard']])
    // The position met is stored in the role colours: as after Black's Q16, White's R14 and so on.
    const [byRole] = training([['O16'], ['R12'], ['Q12']], { initial: ['Q16', 'R14'] })
    expect([keyBefore(byRole, 2), keyBefore(rec, 2)].map((k) => repo.seen(k))).toEqual([true, false])
    expect(repo.allCards().some((c) => c.key === key(8) || c.key === key(9))).toBe(false)
  })

  it('records a training once', () => {
    const { repo, service } = setup()
    const [rec, review] = training(STEPS)
    service.recordTraining(rec, review)
    service.recordTraining(rec, review)
    expect(repo.allReviews()).toHaveLength(3)
    expect(repo.allCards().map((c) => c.state.reps)).toEqual([1, 1, 1])
  })

  it('repeats the cards in a later training, the rest at the positions met before', () => {
    const { repo, service, setNow } = setup()
    service.recordTraining(...training(STEPS, { id: 's1' }))
    setNow(new Date('2026-10-22T10:00:00'))
    service.recordTraining(...training(STEPS, { id: 's2' }))
    expect(repo.allCards().map((c) => c.state.reps)).toEqual([2, 2, 2])
    expect(repo.reviews(key(4), 'rest', 'B').map((r) => [r.sessionId, r.auto])).toEqual([['s1', 'hard'], ['s2', 'again']])
  })

  it('keeps the rest cards of the two colours apart', () => {
    const { repo, service } = setup()
    service.recordTraining(...training([['Q16'], ['R17'], ['Q17', 0.3]], { id: 's1' }))
    service.recordTraining(...training([['Q16'], ['R17'], ['Q17'], ['P17', 0.7]], { id: 's2', settings: { userColor: 'W' } }))
    expect(repo.allCards().map((c) => [c.key, c.kind, c.color])).toEqual([[key(0), 'move', 'B'], [key(1), 'rest', 'B'], [key(1), 'move', 'W'], [key(1), 'rest', 'W']])
  })

  it('counts a training from a start and a replay of its start position, not a replay from a later move', () => {
    const book = starts()
    const { repo, service } = setup(book)
    // Q16 O17 R14: its R14 leaves the graph at node 2 (kept as Q16 R14, whose only edge is O16); White plays after it.
    const settings = { mode: 'list' as const, userColor: 'W' as const, start: { id: book.list()[0].id, name: 'X', mirror: false } }
    const initial = ['Q16', 'O17', 'R14']
    service.recordTraining(...training([['Q13', 0.7]], { id: 's1', initial, settings }))
    service.recordTraining(...training([['P13', 2.5]], { id: 's2', parentSessionId: 's1', initial: [...initial, 'Q13', 'R13'], settings }))
    service.recordTraining(...training([['Q13']], { id: 's3', parentSessionId: 's1', initial, settings }))
    expect(repo.allReviews().map((r) => [r.cardKey, r.kind, r.color, r.sessionId, r.auto])).toEqual([
      [key(2), 'rest', 'W', 's1', 'hard'],
      [key(2), 'rest', 'W', 's3', 'good'],
    ])
  })

  it('counts a trap training only from its setup, and nothing of a start the book no longer knows', () => {
    const { repo, service } = setup(starts())
    const trap = { id: 'trap', index: 2, mirror: false, swapColors: false }
    service.recordTraining(...training([['O16']], { id: 's1', initial: ['Q16', 'R14'], settings: { mode: 'traps', trap } }))
    service.recordTraining(...training([['R12'], ['Q12']], { id: 's2', parentSessionId: 's1', initial: ['Q16', 'R14', 'O16'], settings: { mode: 'traps', trap } }))
    service.recordTraining(...training([['O16']], { id: 's3', initial: ['Q16', 'R14'], settings: { mode: 'random', start: { id: 'gone', name: null, mirror: false } } }))
    expect(repo.allReviews().map((r) => [r.cardKey, r.sessionId])).toEqual([[key(2), 's1']])
  })
})

describe('GraphProgressService.progress', () => {
  it('computes the list for a colour at the player level, cached until a recording, a level change or a card coming due', () => {
    let now = new Date('2026-10-21T10:00:00')
    let level = '7k'
    const repo = new GraphCardRepo(openDb(':memory:'))
    const service = new GraphProgressService({ repo, graph: weighted, starts: StartBook.empty(), thresholds: () => TEST_THRESHOLDS, level: () => level, now: () => now })
    const first = service.progress('B')
    // Black reaches Q16 by one of the three good edges of the empty corner.
    expect(first).toEqual({ hasWeights: true, level: '7k', color: 'B', overall: { percent: 0, due: 0 }, positions: { 'walk-q16': { percent: 0, weight: expect.closeTo(1 / 3, 6), due: false } } })
    expect(service.progress('B')).toBe(first)
    const white = service.progress('W')
    expect(white.color).toBe('W')
    expect(service.progress('W')).toBe(white)

    service.recordTraining(...training(STEPS))
    const recorded = service.progress('B')
    expect(recorded).not.toBe(first)
    expect(recorded.positions['walk-q16'].percent).toBeGreaterThan(0)
    expect(service.progress('W')).not.toBe(white)
    // The training's cards are due minutes later at the earliest: until then the view stays.
    now = new Date('2026-10-21T10:00:01')
    expect(service.progress('B')).toBe(recorded)

    level = '1d'
    expect(service.progress('B').level).toBe('1d')
    level = '7k'
    const again = service.progress('B')
    expect(again).not.toBe(recorded)
    expect(again).toEqual(recorded)

    now = new Date('2026-10-22T10:00:00')
    const due = service.progress('B')
    expect(due).not.toBe(again)
    expect([recorded.positions['walk-q16'].due, due.positions['walk-q16'].due, due.overall.due]).toEqual([false, true, 1])
  })

  it('reads no card when the graph has no weights for the level', () => {
    for (const [graph, level] of [[book, '7k'], [weighted, '9d']] as const) {
      const repo = new GraphCardRepo(openDb(':memory:'))
      const cards = vi.spyOn(repo, 'allCards')
      const service = new GraphProgressService({ repo, graph, starts: StartBook.empty(), thresholds: () => TEST_THRESHOLDS, level: () => level })
      expect(service.progress('B')).toEqual({ hasWeights: false, level, color: 'B', overall: { percent: 0, due: 0 }, positions: {} })
      expect(cards).not.toHaveBeenCalled()
    }
  })
})

describe('GraphProgressService.replayLevel', () => {
  // Thresholds like a kyu level's, where 1.5 points is exact, and like a dan level's, where it is a mistake.
  const KYU: Thresholds = { inaccuracy: 2, mistake: 4, blunder: 8, punished: 2 }
  const DAN: Thresholds = { inaccuracy: 0.5, mistake: 1, blunder: 3, punished: 0.5 }

  /** Trainings recorded at `thresholds` on the weighted walk graph; the service's level stays 7k throughout. */
  function replaySetup(thresholds: Thresholds) {
    let now = new Date('2026-10-21T10:00:00')
    const db = openDb(':memory:')
    const repo = new GraphCardRepo(db)
    const service = new GraphProgressService({ repo, graph: weighted, starts: StartBook.empty(), thresholds: () => thresholds, level: () => '7k', now: () => now })
    return { db, repo, service, setNow: (d: Date) => (now = d) }
  }
  const once = (rating: 'again' | 'hard' | 'good' | 'easy', at: string) => schedule(newState(new Date(at)), rating, new Date(at))
  // Black's O16 at node 2, under the list position Q16 (node 1), loses 1.5.
  const O16: Step[] = [['Q16'], ['R14'], ['O16', 1.5]]

  it('re-rates a move card: a 1.5-point move, «good» at a kyu level, is «again» at a dan level and its percent drops; back again restores it', () => {
    const { repo, service } = replaySetup(KYU)
    service.recordTraining(...training(O16))
    const recorded = repo.card(key(2), 'move', 'B')!.state
    const before = service.progress('B').positions['walk-q16'].percent
    expect(repo.reviews(key(2), 'move', 'B').map((r) => r.auto)).toEqual(['good'])

    service.replayLevel(DAN)
    const [review] = repo.reviews(key(2), 'move', 'B')
    expect(review.auto).toBe('again')
    expect(repo.card(key(2), 'move', 'B')!.state).toEqual(once('again', review.reviewedAt))
    // The level the service reads is still 7k: the replay itself drops the computed view.
    expect(service.progress('B').positions['walk-q16'].percent).toBeLessThan(before)

    service.replayLevel(KYU)
    expect(repo.reviews(key(2), 'move', 'B').map((r) => r.auto)).toEqual(['good'])
    expect(repo.card(key(2), 'move', 'B')!.state).toEqual(recorded)
    expect(service.progress('B').positions['walk-q16'].percent).toBe(before)
  })

  it('keeps a manual rating: FSRS gets it at any level, and the auto rating is derived anew', () => {
    const { db, repo, service } = replaySetup(KYU)
    service.recordTraining(...training(O16))
    db.prepare("UPDATE graph_reviews SET manual = 'easy' WHERE card_key = ?").run(key(2))
    service.replayLevel(DAN)
    const [review] = repo.reviews(key(2), 'move', 'B')
    expect([review.manual, review.auto]).toEqual(['easy', 'again'])
    expect(repo.card(key(2), 'move', 'B')!.state).toEqual(once('easy', review.reviewedAt))
  })

  it('re-rates a rest card with the «first time» rule at the new thresholds', () => {
    const { repo, service, setNow } = replaySetup(KYU)
    // White's R17 leaves the graph at node 1; Black's Q17 after it loses 1.5, at a position new in s1 and met before in s2.
    const steps: Step[] = [['Q16'], ['R17'], ['Q17', 1.5]]
    service.recordTraining(...training(steps, { id: 's1' }))
    setNow(new Date('2026-10-22T10:00:00'))
    service.recordTraining(...training(steps, { id: 's2' }))
    const rest = () => repo.reviews(key(1), 'rest', 'B').map((r) => r.auto)
    const recorded = repo.card(key(1), 'rest', 'B')!.state
    expect(rest()).toEqual(['good', 'good'])
    service.replayLevel(DAN)
    expect(rest()).toEqual(['hard', 'again'])
    service.replayLevel(KYU)
    expect(rest()).toEqual(['good', 'good'])
    expect(repo.card(key(1), 'rest', 'B')!.state).toEqual(recorded)
  })

  it('skips a rest review that is none at the new thresholds — made by an opponent mistake alone that is no mistake there', () => {
    const { repo, service } = replaySetup(TEST_THRESHOLDS)
    // White's R17 leaves the graph losing 2.5, a mistake at TEST_THRESHOLDS; Black answers with a tenuki and plays no more.
    service.recordTraining(...training([['Q16'], ['R17', 2.5], ['tenuki', 1.5]]))
    const recorded = repo.card(key(1), 'rest', 'B')!.state
    expect(repo.reviews(key(1), 'rest', 'B').map((r) => r.auto)).toEqual(['hard'])
    const entry = service.progress('B').positions['walk-q16']
    expect(entry.percent).toBeGreaterThan(0)

    service.replayLevel(KYU)
    // No review at the kyu thresholds: the card is as new, which the progress counts as no card (0 %, not due); the
    // review keeps its rating for a level where it counts.
    expect(repo.card(key(1), 'rest', 'B')!.state).toMatchObject({ state: State.New, reps: 0 })
    expect(repo.reviews(key(1), 'rest', 'B').map((r) => r.auto)).toEqual(['hard'])
    expect(service.progress('B').positions['walk-q16']).toEqual({ percent: 0, weight: entry.weight, due: false })

    service.replayLevel(TEST_THRESHOLDS)
    expect(repo.card(key(1), 'rest', 'B')!.state).toEqual(recorded)
  })

  it('writes only what a replay changes', () => {
    const { repo, service } = replaySetup(KYU)
    service.recordTraining(...training(O16))
    const upserted = vi.spyOn(repo, 'upsert')
    const rated = vi.spyOn(repo, 'setAuto')
    // At the thresholds of the recording nothing changes; the dan ones change O16's card and review (Q16 loses nothing,
    // «Хорошо» at any level); a second replay at them changes nothing.
    service.replayLevel(KYU)
    expect([upserted.mock.calls.length, rated.mock.calls.length]).toEqual([0, 0])
    service.replayLevel(DAN)
    expect([upserted.mock.calls.length, rated.mock.calls.length]).toEqual([1, 1])
    service.replayLevel(DAN)
    expect([upserted.mock.calls.length, rated.mock.calls.length]).toEqual([1, 1])
  })
})
