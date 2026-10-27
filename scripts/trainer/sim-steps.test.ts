import { State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { GraphBook } from '../../packages/server/src/graph/book'
import { lineKey } from '../../packages/server/src/graph/fixture'
import { weightedBook, type WeightedEdge } from '../../packages/server/src/progress/fixture'
import { newState, schedule, type FsrsState } from '../../packages/server/src/cards/schedule'
import { LEARN_AHEAD_MS } from '../../packages/server/src/cards/service'
import { cardPercent, progressFlow, reachOf, type NodeCards } from '../../packages/server/src/progress/compute'
import {
  crossScenarios,
  defaultCheckpoints,
  DEFAULT_SCENARIOS,
  listReach,
  nextQueueItem,
  parseSimOptions,
  pool,
  reachBand,
  report,
  SEEDS_PER_SCENARIO,
  simulate,
  tenukiPercent,
  weightNatural,
  type Scenario,
  type SimResult,
  type TrainingTrace,
} from './sim-steps'

/**
 * The empty corner (Black): Q16 (p 0.7) to A, R16 (p 0.2) to B, the rest 0.1.
 * A = Q16, on the list as 'a' (White): R14 (p 0.5) to C, R17 (p 0.3) to D, the rest 0.2.
 * C = Q16 R14 (Black): O16 (p 0.6) to E, the bad Q14 (p 0.2) to a leaf, the rest 0.2.
 * E = Q16 R14 O16 (White): R12 (p 0.3) to a leaf, a tenuki (p 0.4, calm: the bot plays it 5 % of the time) to G, the rest 0.3.
 * G = Q16 R14 O16 tenuki (Black): R12 (p 0.5) to a leaf, the rest 0.5.
 * D = Q16 R17 (Black): Q17 (p 0.8) to a leaf, the rest 0.2.
 * B = R16, on the list as 'b' (White): R14 (p 0.5) and P17 (p 0.3) to leaves, the rest 0.2.
 */
const FIXTURE: WeightedEdge[] = [
  { line: [], move: 'Q16', p: 0.7 },
  { line: [], move: 'R16', p: 0.2 },
  { line: ['Q16'], move: 'R14', p: 0.5 },
  { line: ['Q16'], move: 'R17', p: 0.3 },
  { line: ['Q16', 'R14'], move: 'O16', p: 0.6 },
  { line: ['Q16', 'R14'], move: 'Q14', p: 0.2, category: 'bad' },
  { line: ['Q16', 'R14', 'O16'], move: 'R12', p: 0.3 },
  { line: ['Q16', 'R14', 'O16'], move: 'tenuki', p: 0.4 },
  { line: ['Q16', 'R14', 'O16', 'tenuki'], move: 'R12', p: 0.5 },
  { line: ['Q16', 'R17'], move: 'Q17', p: 0.8 },
  { line: ['R16'], move: 'R14', p: 0.5 },
  { line: ['R16'], move: 'P17', p: 0.3 },
]
const LISTS = { a: ['Q16'], b: ['R16'] }
const fixture = (): GraphBook => weightedBook(FIXTURE, LISTS)

/**
 * Nodes of White without a good edge: A = Q16 (on the list as 'a') has only the bad R14 (p 0.6), to C = Q16 R14 (Black),
 * whose O16 (p 1) leads to D = Q16 R14 O16 without edges; B = R16 (on the list as 'b') has no edges.
 */
const noGoodEdge = (): GraphBook =>
  weightedBook(
    [
      { line: [], move: 'Q16', p: 0.6 },
      { line: [], move: 'R16', p: 0.4 },
      { line: ['Q16'], move: 'R14', p: 0.6, category: 'bad' },
      { line: ['Q16', 'R14'], move: 'O16', p: 1 },
    ],
    { a: ['Q16'], b: ['R16'] },
  )

/** A = Q16 (White, on the list as 'a'): the bad R14 (p 0.9), then the good P17 and O16 at the given probabilities. */
const badFirst = (p17: number, o16: number): GraphBook =>
  weightedBook(
    [
      { line: [], move: 'Q16', p: 1 },
      { line: ['Q16'], move: 'R14', p: 0.9, category: 'bad' },
      { line: ['Q16'], move: 'P17', p: p17 },
      { line: ['Q16'], move: 'O16', p: o16 },
    ],
    { a: ['Q16'] },
  )

const SHORT: Scenario = { perDay: 3, days: 30, level: '5k', list: 0.5 }
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1)

/** The trainings of a run as simulate() reports them. */
function traced(book: GraphBook, scenario: Scenario, seed: number): TrainingTrace[] {
  const trainings: TrainingTrace[] = []
  simulate(book, scenario, seed, (t) => trainings.push(t))
  return trainings
}

describe('the default scenarios', () => {
  it('run 3, 10 and 30 trainings a day for 90 days at 15k, 5k and 2d, half from the list (part 3 spec 8.2)', () => {
    expect(DEFAULT_SCENARIOS).toHaveLength(9)
    for (const perDay of [3, 10, 30]) for (const level of ['15k', '5k', '2d']) expect(DEFAULT_SCENARIOS).toContainEqual({ perDay, days: 90, level, list: 0.5 })
    expect(crossScenarios([10, 30], ['5k'], 365)).toEqual([
      { perDay: 10, days: 365, level: '5k', list: 0.5 },
      { perDay: 30, days: 365, level: '5k', list: 0.5 },
    ])
  })

  it('reports at days 30, 60 and the last by default, those within the run', () => {
    expect(defaultCheckpoints(90)).toEqual([30, 60, 90])
    expect(defaultCheckpoints(365)).toEqual([30, 60, 365])
    expect(defaultCheckpoints(45)).toEqual([30, 45])
    expect(defaultCheckpoints(60)).toEqual([30, 60])
    expect(defaultCheckpoints(2)).toEqual([2])
  })
})

describe('weightNatural', () => {
  // Q16 (White): R14 (p 0.5), a tenuki (p 0.3), the rest 0.2. Q16 R14 (Black): a tenuki (p 0.7), O16 (p 0.2), the rest 0.1.
  // Q16 R14 O16 (White): a tenuki (p 0.3), R12 (p 0.5), the rest 0.2.
  const book = weightedBook([
    { line: [], move: 'Q16', p: 1 },
    { line: ['Q16'], move: 'R14', p: 0.5 },
    { line: ['Q16'], move: 'tenuki', p: 0.3 },
    { line: ['Q16', 'R14'], move: 'tenuki', p: 0.7 },
    { line: ['Q16', 'R14'], move: 'O16', p: 0.2 },
    { line: ['Q16', 'R14', 'O16'], move: 'tenuki', p: 0.3 },
    { line: ['Q16', 'R14', 'O16'], move: 'R12', p: 0.5 },
  ])
  const level = book.levelArrays('5k')!
  const natural = (line: string[], started: boolean): number[] => {
    const { edges, leave } = weightNatural(book, book.node(lineKey(line))!, level, started)
    return [...edges, leave]
  }
  // The weights file keeps the probabilities in steps of 1/65535.
  const close = (xs: number[]): unknown[] => xs.map((x) => expect.closeTo(x, 4))

  it('always plays a tenuki the policy gives at least SETTLED_SHARE', () => {
    expect(natural(['Q16', 'R14'], true)).toEqual(close([1, 0, 0]))
  })

  it('plays a calm tenuki at MISTAKE_TENUKI_RATE and scales the other options to the rest', () => {
    expect(natural(['Q16', 'R14', 'O16'], true)).toEqual(close([0.05, (0.5 / 0.7) * 0.95, (0.2 / 0.7) * 0.95]))
  })

  it('never plays a tenuki before the joseki starts: the other options share the whole', () => {
    expect(natural(['Q16'], false)).toEqual(close([0.5 / 0.7, 0, 0.2 / 0.7]))
    expect(natural(['Q16', 'R14'], false)).toEqual(close([0, 0.2 / 0.3, 0.1 / 0.3]))
  })

  it('only normalises a node without a tenuki edge', () => {
    expect(natural(['Q16', 'R14', 'O16', 'R12'], true)).toEqual(close([1]))
    expect(natural([], false)).toEqual(close([1, 0]))
  })
})

describe('simulate', () => {
  it('plays the natural bot: the same seed gives the same run, traced or not', () => {
    const book = fixture()
    const r = simulate(book, SHORT, 7)
    expect(r).toEqual(simulate(book, SHORT, 7))
    expect(simulate(book, SHORT, 7, () => {})).toEqual(r)
    expect(r.coverage).toHaveLength(SHORT.days)
    expect(r.coverage.at(-1)!).toBeGreaterThan(0)
  })

  it('measures the deep starts, the repeats, the lateness, the tenuki subtrees and the queue top as shares', () => {
    const r = simulate(fixture(), { perDay: 10, days: 20, level: '5k', list: 0.5 }, 7)
    const at = (x: number | undefined): { min: number | undefined; max: number | undefined } => ({ min: x, max: x })
    expect([r.runs, r.last]).toEqual([1, { coverage: at(r.coverage.at(-1)), seen: at(r.seen.at(-1)), mastered: at(r.mastered.at(-1)) }])
    expect(r.seenByReach.map((curve) => curve.length)).toEqual([20, 20, 20])
    expect(r.queueTop).toBeGreaterThan(0)
    for (const share of [r.late.share, r.repeat, r.deep.reached, r.deep.deviated, r.tenuki, r.queueTop]) {
      expect(share).toBeGreaterThanOrEqual(0)
      expect(share).toBeLessThanOrEqual(1)
    }
    // Random and queue trainings start deep and mostly reach their target; ten a day leave some reviews late.
    expect(r.deep.reached).toBeGreaterThan(0.5)
    expect(r.late.share).toBeGreaterThan(0)
    expect(r.late.meanDays).toBeGreaterThan(0)
    expect(r.repeat).toBeGreaterThan(0)
    expect(r.tenuki).toBeGreaterThan(0)
  })

  it('needs the weights of the scenario level', () => {
    expect(() => simulate(fixture(), { ...SHORT, level: '2d' }, 1)).toThrow(/2d/)
  })
})

describe('the model player (part 3 spec 8.2)', () => {
  const FROM_LIST: Scenario = { perDay: 3, days: 30, level: '5k', list: 1 }

  /** The reviews of the move card of `node` in White's trainings, each with its training and its place there. */
  const moveReviews = (trainings: TrainingTrace[], node: number): { t: TrainingTrace; i: number; rating: string }[] =>
    trainings
      .filter((t) => t.color === 'W')
      .flatMap((t) => t.reviews.flatMap((r, i) => (r.node === node && r.kind === 'move' ? [{ t, i, rating: r.rating }] : [])))

  it('leaves the graph at a node with only bad edges once it recalls the card there, rated «Хорошо» without a second draw', () => {
    const book = noGoodEdge()
    const a = book.node(lineKey(['Q16']))!
    for (const seed of [1, 7]) {
      const reviews = moveReviews(traced(book, FROM_LIST, seed), a)
      for (const { t, i, rating } of reviews) {
        if (t.walk.at(-1) === a) {
          // Recalled (one draw against R): the right move is off the dictionary — «Хорошо», then the rest card's own review.
          expect(rating).toBe('good')
          expect(t.reviews.slice(i + 1)).toEqual([{ node: a, kind: 'rest', rating: expect.any(String) }])
        } else expect(rating).toBe('again') // not recalled: the bad edge
      }
      // The first time it cannot recall and plays the bad edge; later it mostly recalls and leaves with the right move.
      expect(reviews[0].t.walk.at(-1)).not.toBe(a)
      const later = reviews.slice(reviews.length / 2)
      expect(later.filter(({ t }) => t.walk.at(-1) === a).length).toBeGreaterThan(later.length / 2)
    }
  })

  it('leaves the graph at a node without edges: «Хорошо» when it recalls, «Снова» otherwise and on a new card', () => {
    const book = noGoodEdge()
    const leaves = [book.node(lineKey(['R16']))!, book.node(lineKey(['Q16', 'R14', 'O16']))!]
    for (const seed of [1, 7]) {
      const trainings = traced(book, FROM_LIST, seed)
      for (const node of leaves) {
        const reviews = moveReviews(trainings, node)
        expect(reviews.length).toBeGreaterThan(0)
        expect(reviews[0].rating).toBe('again')
        for (const { t, i } of reviews) {
          expect(t.walk.at(-1)).toBe(node)
          expect(t.reviews.slice(i + 1)).toEqual([{ node, kind: 'rest', rating: expect.any(String) }])
        }
      }
      expect(moveReviews(trainings, leaves[0]).some(({ rating }) => rating === 'good')).toBe(true)
    }
  })

  it('after «Снова» recalls the move the review showed: the good edge the level plays most, the first of equals', () => {
    // The nodes White's moves after Q16 led to.
    const played = (book: GraphBook): Set<number> => {
      const a = book.node(lineKey(['Q16']))!
      const trainings = traced(book, FROM_LIST, 7).filter((t) => t.color === 'W')
      return new Set(trainings.flatMap((t) => t.walk.flatMap((node, i) => (node === a && i + 1 < t.walk.length ? [t.walk[i + 1]] : []))))
    }
    const p17 = lineKey(['Q16', 'P17'])
    const o16 = lineKey(['Q16', 'O16'])
    // The level never plays either good edge: only the review shows one, the first of the two.
    const tie = badFirst(0, 0)
    expect(played(tie)).toContain(tie.node(p17))
    expect(played(tie)).not.toContain(tie.node(o16))
    // The level plays O16 now and then and P17 never: the review shows O16.
    const often = badFirst(0, 0.05)
    expect(played(often)).toContain(often.node(o16))
    expect(played(often)).not.toContain(often.node(p17))
  })
})

describe('the absolute coverage: seen and mastered', () => {
  /** A = Q16 (White, on the list as 'a') with only the bad R14 (p 1), to C = Q16 R14 (Black) without edges. */
  const oneMoveEach = (): GraphBook =>
    weightedBook(
      [
        { line: [], move: 'Q16', p: 1 },
        { line: ['Q16'], move: 'R14', p: 1, category: 'bad' },
      ],
      { a: ['Q16'] },
    )

  it('counts the one new card of the first training, rated «Снова», whichever colour trains', () => {
    // White plays the bad R14 at A; Black, after the bot's R14, leaves C without edges: either way one new move card «Снова»,
    // whose stability 0.212 days gives ln(1.212) / ln 22 = 0.0622.
    const colors = new Set<string>()
    for (const seed of SEEDS) {
      const trainings: TrainingTrace[] = []
      const r = simulate(oneMoveEach(), { perDay: 1, days: 1, level: '5k', list: 1 }, seed, (t) => trainings.push(t))
      const at = new Date(trainings[0].at)
      colors.add(trainings[0].color)
      expect(r.seen).toEqual([1])
      expect(r.mastered).toEqual([cardPercent(schedule(newState(at), 'again', at))])
      expect(r.mastered[0]).toBeCloseTo(0.0622, 4)
    }
    expect(colors).toEqual(new Set(['B', 'W']))
  })

  it('counts the move cards reviewed by each day’s end and sums their percents, over both colours', () => {
    const scenario: Scenario = { perDay: 4, days: 8, level: '5k', list: 0.5 }
    for (const seed of [1, 7]) {
      const trainings = traced(fixture(), scenario, seed)
      const r = simulate(fixture(), scenario, seed)
      // The move cards replayed from the trace, by colour and node.
      const cards = new Map<string, FsrsState>()
      const seen: number[] = []
      const mastered: number[] = []
      for (let day = 0; day < scenario.days; day++) {
        for (const t of trainings.filter((t) => t.day === day)) {
          const at = new Date(t.at)
          for (const { node, kind, rating } of t.reviews) {
            if (kind === 'move') cards.set(`${t.color}${node}`, schedule(cards.get(`${t.color}${node}`) ?? newState(at), rating, at))
          }
        }
        seen.push(cards.size)
        mastered.push([...cards.values()].reduce((sum, card) => sum + cardPercent(card), 0))
      }
      expect(new Set([...cards.keys()].map((key) => key[0]))).toEqual(new Set(['B', 'W']))
      expect(r.seen).toEqual(seen)
      expect(r.mastered).toEqual(mastered.map((m) => expect.closeTo(m, 12)))
      expect(r.seen.at(-1)).toBeGreaterThan(r.seen[0])
    }
  })
})

describe('the seen cards by reach from the list position', () => {
  /**
   * The empty corner (Black): Q16 (p 0.1, the rest 0.9) to the list position 'a' = A = Q16 (White): R14 (p 1) to C = Q16 R14
   * (Black): O16 (p 0.92) to the leaf D, R17 (p 0.08) to E (White): Q17 (p 1) to E1 (Black): R18 (p 0.92) to the leaf E2,
   * P17 (p 0.08) to F (White): P18 (p 1) to F1 (Black): O18 (p 0.92) to the leaf F2, O17 (p 0.08) to the leaf G. The leaves
   * are White's. From the empty corner White would reach A at 0.1 only, which would move E, E2 and F, F2 a band down.
   */
  const LINE = ['Q16', 'R14', 'R17', 'Q17', 'P17', 'P18']
  const deepRare = (): GraphBook =>
    weightedBook(
      [
        { line: [], move: 'Q16', p: 0.1 },
        { line: LINE.slice(0, 1), move: 'R14', p: 1 },
        { line: LINE.slice(0, 2), move: 'O16', p: 0.92 },
        { line: LINE.slice(0, 2), move: 'R17', p: 0.08 },
        { line: LINE.slice(0, 3), move: 'Q17', p: 1 },
        { line: LINE.slice(0, 4), move: 'R18', p: 0.92 },
        { line: LINE.slice(0, 4), move: 'P17', p: 0.08 },
        { line: LINE.slice(0, 5), move: 'P18', p: 1 },
        { line: LINE, move: 'O18', p: 0.92 },
        { line: LINE, move: 'O17', p: 0.08 },
      ],
      { a: ['Q16'] },
    )
  const LINES: Record<string, string[]> = {
    A: LINE.slice(0, 1),
    C: LINE.slice(0, 2),
    D: [...LINE.slice(0, 2), 'O16'],
    E: LINE.slice(0, 3),
    E1: LINE.slice(0, 4),
    E2: [...LINE.slice(0, 4), 'R18'],
    F: LINE.slice(0, 5),
    F1: LINE,
    F2: [...LINE, 'O18'],
    G: [...LINE, 'O17'],
  }
  // By hand: the product of the probabilities from A (the player's single good edges pass all of it on), the same for
  // either colour's flow here. ≥ 1 %: A, C, D, E, E1, E2; 0.1–1 %: F, F1, F2; below: G.
  const REACH: Record<string, number> = { A: 1, C: 1, D: 0.92, E: 0.08, E1: 0.08, E2: 0.08 * 0.92, F: 0.0064, F1: 0.0064, F2: 0.0064 * 0.92, G: 0.000512 }
  const BAND: Record<string, number> = { A: 0, C: 0, D: 0, E: 0, E1: 0, E2: 0, F: 1, F1: 1, F2: 1, G: 2 }

  it('is the largest probability of reaching a node from a list position along the flow, 0 above every list position', () => {
    const book = deepRare()
    for (const color of ['B', 'W'] as const) {
      const reach = listReach(book, progressFlow(book, '5k', color))
      expect(reach[0]).toBe(0)
      for (const [name, line] of Object.entries(LINES)) {
        const node = book.node(lineKey(line))!
        expect(reach[node]).toBeCloseTo(REACH[name], 4)
        expect(reachBand(reach[node])).toBe(BAND[name])
      }
    }
    // A list position under another starts again at 1.
    const nested = weightedBook(FIXTURE, { a: ['Q16'], e: ['Q16', 'R14', 'O16'] })
    const reach = listReach(nested, progressFlow(nested, '5k', 'W'))
    expect(reach[nested.node(lineKey(['Q16', 'R14', 'O16']))!]).toBe(1)
    expect(reach[nested.node(lineKey(['Q16', 'R14', 'O16', 'R12']))!]).toBeCloseTo(0.3 / 0.7, 4)
  })

  it('counts the move cards seen by each day’s end in the bands of their nodes; the deep starts open the rarest', () => {
    const book = deepRare()
    const bandOf = new Map(Object.entries(LINES).map(([name, line]) => [book.node(lineKey(line))!, BAND[name]]))
    for (const seed of [1, 2, 3, 7]) {
      const last: number[][] = []
      // Only «Из списка», then half «Случайно».
      for (const list of [1, 0.5]) {
        const scenario: Scenario = { perDay: 3, days: 30, level: '5k', list }
        const trainings = traced(book, scenario, seed)
        const r = simulate(book, scenario, seed)
        // The move cards replayed from the trace, by colour and node, counted by the hand-checked bands at each day's end.
        const seen = new Set<string>()
        const byReach: number[][] = [[], [], []]
        for (let day = 0; day < scenario.days; day++) {
          for (const t of trainings.filter((t) => t.day === day)) for (const { node, kind } of t.reviews) if (kind === 'move') seen.add(`${t.color}:${node}`)
          const counts = [0, 0, 0]
          for (const key of seen) counts[bandOf.get(Number(key.slice(2)))!]++
          counts.forEach((count, b) => byReach[b].push(count))
        }
        expect(r.seenByReach).toEqual(byReach)
        expect(r.seen).toEqual(r.seen.map((_, d) => byReach[0][d] + byReach[1][d] + byReach[2][d]))
        last.push(byReach.map((curve) => curve.at(-1)!))
      }
      // G is 0.08³ of a training from A: the trainings from the list do not get there in 30 days; «Случайно», whose deep
      // starts aim at the cards with the most to learn, does.
      expect([last[0][2], last[1][2]]).toEqual([0, 1])
    }
  })
})

describe('tenukiPercent (part 3 spec 12)', () => {
  /**
   * The empty corner (Black): Q16 (p 0.3) to A, a tenuki (p 0.7) to T, the empty corner with White to move: Q16 (p 1) to a
   * leaf. A = Q16 (White, on the list as 'a'): R14 (p 0.5) to C, a tenuki (p 0.5) to G; C and G (Black) have no edges.
   */
  const book = (): GraphBook =>
    weightedBook(
      [
        { line: [], move: 'Q16', p: 0.3 },
        { line: [], move: 'tenuki', p: 0.7 },
        { line: ['tenuki'], move: 'Q16', p: 1 },
        { line: ['Q16'], move: 'R14', p: 0.5 },
        { line: ['Q16'], move: 'tenuki', p: 0.5 },
      ],
      { a: ['Q16'] },
    )
  const NOW = new Date(Date.UTC(2026, 0, 5, 18))
  /** A reviewed card of percent ln(1 + S) / ln 22 = `percent`. */
  const card = (percent: number): FsrsState => ({ ...newState(NOW), state: State.Review, reps: 1, stability: 22 ** percent - 1 })
  const cardsOf = (g: GraphBook, move: [string[], number][], rest: [string[], number][] = []): NodeCards => {
    const cards: NodeCards = { move: new Array<FsrsState | null>(g.nodeCount).fill(null), rest: new Array<FsrsState | null>(g.nodeCount).fill(null) }
    for (const [line, percent] of move) cards.move[g.node(lineKey(line))!] = card(percent)
    for (const [line, percent] of rest) cards.rest[g.node(lineKey(line))!] = card(percent)
    return cards
  }
  const percentOf = (g: GraphBook, color: 'B' | 'W', cards: NodeCards): number | null => {
    const flow = progressFlow(g, '5k', color)
    return tenukiPercent(g, flow, reachOf(g, flow), cards)
  }

  it('weighs the cards after the bot’s tenuki under the list positions as the overall percent does', () => {
    const g = book()
    // Black under A: C and G each weigh 2 (the move card and the rest card of a node without a good edge), A passes half
    // to each. After the tenuki: weight 0.5 × 2 = 1, score 0.5 × (1 + 0.5) = 0.75. C's card (percent 1) is not after it.
    const cards = cardsOf(g, [[['Q16', 'R14'], 1], [['Q16', 'tenuki'], 1]], [[['Q16', 'tenuki'], 0.5]])
    expect(percentOf(g, 'B', cards)).toBeCloseTo(0.75, 9)
    expect(percentOf(g, 'B', cardsOf(g, [[['Q16', 'R14'], 1]]))).toBe(0)
  })

  it('leaves out the tenuki edges above every list position: no training goes there (the 0.0 % of the old measure)', () => {
    // White's only bot tenuki is Black's at the empty corner, 70 % of the reach from there; its subtree is under no list
    // position, so the overall percent does not count it, and neither does this, even with White's card there.
    const g = book()
    expect(percentOf(g, 'W', cardsOf(g, [[['tenuki'], 1]]))).toBeNull()
  })
})

describe('the model queue (part 3 spec 6.2 and 8.2)', () => {
  const NOW = Date.UTC(2026, 0, 5, 18)
  const item = (due: number, depth: number, learning = false): { due: number; depth: number; learning: boolean } => ({ due: NOW + due, depth, learning })

  it('serves the most overdue item, the deepest of equal due, before learning ahead within LEARN_AHEAD_MS', () => {
    const items = [item(-10, 1), item(-20, 1), item(-20, 3), item(-20, 3), item(60_000, 9, true)]
    expect(nextQueueItem(items, NOW)).toBe(items[2])
    expect(nextQueueItem([item(60_000, 1, true), item(0, 1)], NOW)).toEqual(item(0, 1))
    // Nothing due: the earliest card in its learning steps due within LEARN_AHEAD_MS, never a card in review.
    const ahead = [item(120_000, 1, true), item(60_000, 1), item(LEARN_AHEAD_MS, 2, true)]
    expect(nextQueueItem(ahead, NOW)).toBe(ahead[0])
    expect(nextQueueItem([item(LEARN_AHEAD_MS + 1, 1, true), item(60_000, 1)], NOW)).toBeNull()
    expect(nextQueueItem([], NOW)).toBeNull()
  })

  it('serves the queue first each day within the day’s trainings and leaves what is left for the next day', () => {
    const scenario: Scenario = { perDay: 2, days: 40, level: '5k', list: 0.5 }
    const trainings = traced(fixture(), scenario, 7)
    let carried = 0
    for (let day = 0; day < scenario.days; day++) {
      const today = trainings.filter((t) => t.day === day)
      expect(today).toHaveLength(scenario.perDay)
      const ended = today.findIndex((t) => t.mode !== 'queue')
      expect(today.slice(0, ended < 0 ? today.length : ended).every((t) => t.waiting !== null)).toBe(true)
      // The queue phase ends at the first training it cannot serve; the queue is not asked again that day.
      if (ended >= 0) {
        expect(today[ended].waiting).toBe(0)
        expect(today.slice(ended + 1).every((t) => t.mode !== 'queue' && t.waiting === null)).toBe(true)
      }
      const last = today.at(-1)!
      if (day + 1 < scenario.days && last.mode === 'queue' && last.waiting! > 1) {
        carried++
        expect(trainings.find((t) => t.day === day + 1)!.mode).toBe('queue')
      }
    }
    expect(carried).toBeGreaterThan(0)
  })

  it('learns ahead: serves a card in its learning steps before its due when nothing is due', () => {
    const trainings = traced(fixture(), { perDay: 10, days: 10, level: '5k', list: 0.5 }, 7)
    expect(trainings.some((t) => t.mode === 'queue' && t.waiting === 0)).toBe(true)
  })
})

const A: Scenario = { perDay: 3, days: 90, level: '5k', list: 0.5 }
const B: Scenario = { perDay: 30, days: 90, level: '2d', list: 0.5 }
const result = (scenario: Scenario): SimResult => ({
  scenario,
  runs: SEEDS_PER_SCENARIO,
  coverage: [0.1, 0.15, 0.2, 0.25],
  seen: [10, 20, 30, 40],
  mastered: [1, 2, 3, 4.5],
  seenByReach: [
    [5, 10, 15, 20],
    [3, 6, 9, 12],
    [2, 4, 6, 8],
  ],
  last: { coverage: { min: 0.2, max: 0.3 }, seen: { min: 35, max: 45 }, mastered: { min: 4, max: 5 } },
  late: { share: 0.125, meanDays: 1.5 },
  repeat: 0.375,
  deep: { reached: 0.875, deviated: 0.0625 },
  tenuki: 0.05,
  queueTop: 0.4375,
})

describe('pool', () => {
  const run = (last: number, share: number, queueTop: number): SimResult => ({
    ...result(A),
    runs: 1,
    coverage: [last / 2, last],
    seen: [10 * last, 20 * last],
    mastered: [last, 3 * last],
    seenByReach: [
      [5 * last, 10 * last],
      [3 * last, 6 * last],
      [2 * last, 4 * last],
    ],
    last: { coverage: { min: last, max: last }, seen: { min: 20 * last, max: 20 * last }, mastered: { min: 3 * last, max: 3 * last } },
    late: { share, meanDays: 2 * share },
    repeat: share,
    deep: { reached: share, deviated: share / 2 },
    tenuki: share,
    queueTop,
  })

  it('pools the curves with their last-day ranges, the means of the rest and the largest queue top', () => {
    expect(pool([run(0.2, 0.1, 0.05), run(0.4, 0.3, 0.25)])).toEqual({
      scenario: A,
      runs: 2,
      coverage: [expect.closeTo(0.15, 12), expect.closeTo(0.3, 12)],
      seen: [expect.closeTo(3, 12), expect.closeTo(6, 12)],
      mastered: [expect.closeTo(0.3, 12), expect.closeTo(0.9, 12)],
      seenByReach: [
        [expect.closeTo(1.5, 12), expect.closeTo(3, 12)],
        [expect.closeTo(0.9, 12), expect.closeTo(1.8, 12)],
        [expect.closeTo(0.6, 12), expect.closeTo(1.2, 12)],
      ],
      last: { coverage: { min: 0.2, max: 0.4 }, seen: { min: 4, max: 8 }, mastered: { min: expect.closeTo(0.6, 12), max: expect.closeTo(1.2, 12) } },
      late: { share: expect.closeTo(0.2, 12), meanDays: expect.closeTo(0.4, 12) },
      repeat: expect.closeTo(0.2, 12),
      deep: { reached: expect.closeTo(0.2, 12), deviated: expect.closeTo(0.1, 12) },
      tenuki: expect.closeTo(0.2, 12),
      queueTop: 0.25,
    })
  })

  it('pools only the runs of one scenario', () => {
    expect(() => pool([])).toThrow(RangeError)
    expect(() => pool([result(A), result(B)])).toThrow(RangeError)
  })
})

describe('report', () => {
  const results = [result(A), result(B)]
  /** The lines of a scenario's block: from its name to the blank line before the next one (or the legend). */
  const block = (text: string, name: string): string[] => {
    const lines = text.split('\n')
    const start = lines.indexOf(name)
    const end = lines.findIndex((l, i) => i > start && l === '' && !lines[i + 1]?.startsWith('  '))
    return lines.slice(start, end)
  }
  // The cells of a table line (indented, the cells two spaces apart at least; an empty cell at the end is trimmed).
  const cells = (line: string): string[] => line.trim().split(/ {2,}/)

  it('gives each scenario its measures and its coverage at the checkpoints, under a header without an ε', () => {
    const text = report(results, [2])
    expect(text.split('\n')[0]).toBe(`Trainer simulation, the natural bot: each scenario pools ${SEEDS_PER_SCENARIO} runs with different seeds.`)
    expect(text).not.toMatch(/ε|KL|steer/)
    const a = block(text, '3 a day for 90 days at 5k, 50 % from the list')
    // The name, the measures (a header and a row), a blank line, the coverage: a header, day 2's row and day 4's.
    expect(a).toHaveLength(7)
    expect(cells(a[1])).toEqual(['late', 'late days', 'repeat', 'reached', 'deviated', 'tenuki', 'queue top'])
    expect(cells(a[2])).toEqual(['12.5 %', '1.50', '37.5 %', '87.5 %', '6.3 %', '5.0 %', '43.8 %'])
    expect(a[3]).toBe('')
    expect(cells(a[4])).toEqual(['day', 'coverage', 'min–max', 'seen', 'min–max', 'seen ≥ 1 %', 'seen 0.1–1 %', 'seen < 0.1 %', 'mastered', 'min–max'])
    // Day 2: no ranges.
    expect(cells(a[5])).toEqual(['d2', '15.0 %', '20.0', '10.0', '6.0', '4.0', '2.0'])
    // The last day with the ranges of the runs.
    expect(cells(a[6])).toEqual(['d4', '25.0 %', '20.0–30.0 %', '40.0', '35–45', '20.0', '12.0', '8.0', '4.5', '4.0–5.0'])
    expect(block(text, '30 a day for 90 days at 2d, 50 % from the list')).toHaveLength(7)
  })

  it('shows the last day alone when no checkpoint is within the runs', () => {
    const a = block(report(results), '3 a day for 90 days at 5k, 50 % from the list')
    expect(a).toHaveLength(6)
    expect(cells(a[5])[0]).toBe('d4')
  })

  it('says a single run in its header', () => {
    expect(report([{ ...result(A), runs: 1 }]).split('\n')[0]).toBe('Trainer simulation, the natural bot: each scenario pools 1 run.')
  })
})

describe('parseSimOptions', () => {
  const GB = 2 ** 30

  it('runs the default scenarios on all CPUs but one, as many as fit in 60 % of the memory', () => {
    expect(parseSimOptions([], 24, 64 * GB)).toEqual({ scenarios: DEFAULT_SCENARIOS, checkpoints: [30, 60, 90], seed: 1, jobs: 23, out: null })
    // 60 % of 8 GB holds 10 workers of 0.45 GB.
    expect(parseSimOptions([], 24, 8 * GB).jobs).toBe(10)
    expect(parseSimOptions([], 1, 64 * GB).jobs).toBe(1)
    expect(parseSimOptions([], 24, 0.5 * GB).jobs).toBe(1)
  })

  it('crosses the trainings a day with the levels for the days and reports at the checkpoints and the last day', () => {
    const args = ['--per-day', '10,30', '--levels', '5k,2d', '--days', '365', '--checkpoints', '180,30', '--seed', '42', '--jobs', '40', '--out', 'sim.txt']
    expect(parseSimOptions(args, 24, GB)).toEqual({
      scenarios: crossScenarios([10, 30], ['5k', '2d'], 365),
      checkpoints: [30, 180, 365],
      seed: 42,
      jobs: 40,
      out: 'sim.txt',
    })
    expect(parseSimOptions(['--levels', '5k', '--per-day', '10'], 24, GB).scenarios).toEqual([{ perDay: 10, days: 90, level: '5k', list: 0.5 }])
    expect(parseSimOptions(['--days', '30'], 24, 64 * GB)).toMatchObject({ scenarios: DEFAULT_SCENARIOS.map((s) => ({ ...s, days: 30 })), checkpoints: [30] })
    expect(parseSimOptions(['--days', '2'], 24, 64 * GB).checkpoints).toEqual([2])
    expect(parseSimOptions(['--checkpoints', '90', '--days', '365'], 24, 64 * GB).checkpoints).toEqual([90, 365])
  })

  it('rejects anything else', () => {
    const rejected = [
      ['--per-day', '0'],
      ['--per-day', '3,'],
      ['--per-day', '3,3'],
      ['--levels', '11d'],
      ['--levels', '5k,5k'],
      ['--checkpoints', '0'],
      ['--checkpoints', '91'],
      ['--checkpoints', '10', '--days', '5'],
      ['--days', '0'],
      ['--seed', 'x'],
      ['--jobs', '-1'],
      ['--scenario', '10/5k'],
      // The steering strengths are gone with the steering.
      ['--epsilons', 'natural'],
      ['--out'],
      ['--fast'],
    ]
    for (const args of rejected) expect(() => parseSimOptions(args, 24, 64 * GB)).toThrow(/npm run trainer:sim/)
  })
})
