import { gtpToVertex, inZone, Position, vertexToIndex, type Color, type PlayedMove, type Rating, type ResolvedSettings, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it, vi } from 'vitest'
import { testConfig } from '../../test/helpers'
import { naturalMoves, type NaturalMove } from '../bot/choose'
import type { Rng } from '../bot/rng'
import { newState, schedule } from '../cards/schedule'
import { GraphBook } from '../graph/book'
import { lineKey, walkGraph } from '../graph/fixture'
import { encodeGraph, encodeWeights } from '../graph/format'
import { TEST_THRESHOLDS, uniformWeights } from '../progress/fixture'
import { GraphCardRepo, type GraphCardKind } from '../progress/repo'
import { GraphProgressService } from '../progress/service'
import { StartBook } from '../starts/book'
import { openDb } from '../store/db'
import type { SessionRecord } from '../store/records'
import { DEEP_LINE, DEEP_LINE_MIRRORED as MIRRORED, DEEP_LIST_ID, deepBook, lineKeys, zoneMoves } from './fixture'
import { TrainerService } from './service'

const NOW = new Date('2026-10-26T10:00:00')
const DAY = 24 * 3600 * 1000

const V = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex

type Seq = Rng & { draws: number }
/** The values given, in turn; `draws` counts the draws. */
const seq = (...values: number[]): Seq => {
  const rng: Seq = Object.assign(() => values[rng.draws++ % values.length], { draws: 0 })
  return rng
}

const P11: NaturalMove = { vertex: V('P11'), tenuki: false, p: 0.6 }
const D4: NaturalMove = { vertex: V('D4'), tenuki: true, p: 0.4 }

/** walkGraph() with uniformWeights at `level`: at Q16, White's R14 and its mirror O17 lead to one node. */
function walkWeighted(level: string): GraphBook {
  const graph = walkGraph()
  return GraphBook.load(encodeGraph(graph), encodeWeights(uniformWeights(graph, [level]), graph))
}

function setup(o: { levels?: string[]; rng?: Rng; book?: (level: string) => GraphBook } = {}) {
  const config = testConfig()
  const graph = o.book?.(config.player.level) ?? deepBook(o.levels ?? [config.player.level])
  const repo = new GraphCardRepo(openDb(':memory:'))
  const starts = StartBook.empty()
  const progress = new GraphProgressService({ repo, graph, starts, thresholds: () => TEST_THRESHOLDS, level: () => config.player.level, now: () => NOW })
  const trainer = new TrainerService({ graph, progress, repo, starts, config, now: () => NOW, rng: o.rng ?? (() => 0.9) })
  /** The node after the first `n` moves of DEEP_LINE. */
  const at = (n: number): number => graph.node(lineKey(DEEP_LINE.slice(0, n)))!
  /** A Black player's card at the node after `n` moves of DEEP_LINE, reviewed `rating` at `when`: due 10 minutes later. */
  const card = (n: number, kind: GraphCardKind, when: Date, rating: Rating = 'good'): void => {
    repo.upsert({ key: graph.nodeKey(at(n)), kind, color: 'B', state: schedule(newState(when), rating, when), createdAt: when.toISOString() })
  }
  return { config, graph, repo, progress, trainer, at, card }
}

interface Shape {
  /** The way from the empty corner to the target, top-right GTP or 'tenuki'. */
  line: string[]
  /** The number of its moves before turn 0, the setup (a tenuki as a pass on the board), colours from Black; the path is the rest. */
  setup: number
  leave?: boolean
  /** The training's moves (top-right GTP or 'pass'). */
  moves?: string[]
  settings?: Partial<ResolvedSettings>
}

/** A training of a deep start in the top-right corner, unmirrored; the player is Black unless the settings say otherwise. */
function record(o: Shape): SessionRecord {
  const color = (i: number): Color => (i % 2 === 0 ? 'B' : 'W')
  const graph = { setup: o.setup, path: lineKeys(o.line, o.setup), leave: o.leave ?? false }
  const settings: ResolvedSettings = { mode: 'random', environment: 'empty', userColor: 'B', botRank: '5k', corner: 'TR', start: { id: DEEP_LIST_ID, name: null, mirror: false, graph }, ...o.settings }
  const initialMoves = o.line.slice(0, o.setup).map((m, i) => ({ color: color(i), vertex: m === 'tenuki' ? ('pass' as const) : V(m) }))
  const moves = (o.moves ?? []).map((m, t): PlayedMove => {
    const vertex = gtpToVertex(m)
    const c = color(initialMoves.length + t)
    return { color: c, vertex, actor: c === settings.userColor ? 'user' : 'bot', inZone: inZone('TR', vertex) }
  })
  return { id: 's1', createdAt: '', finishedAt: null, settings, status: 'playing', parentSessionId: null, initialMoves, moves, summary: null }
}

describe('TrainerService.randomStart', () => {
  it('draws a target and starts where the habits reach it with at least ½, named by the list position above (part 3 spec 5.2–5.5)', () => {
    // 0.9 goes on at Y (stopping there has 1 of 1.25) and at T: the target is V, and Y's third leaves the start at Z.
    expect(setup().trainer.randomStart('B')).toEqual({ setup: zoneMoves(MIRRORED.slice(0, 5)), path: lineKeys(DEEP_LINE, 5), leave: false, nameId: DEEP_LIST_ID })
    // 0.5 stops at Y, the bot's tenuki from X before it: the start is X.
    expect(setup({ rng: () => 0.5 }).trainer.randomStart('B')).toEqual({ setup: zoneMoves(MIRRORED.slice(0, 3)), path: lineKeys(DEEP_LINE.slice(0, 4), 3), leave: false, nameId: DEEP_LIST_ID })
  })

  it('is null without weights for the player level and with nothing to learn', () => {
    expect(setup({ levels: ['1d'] }).trainer.randomStart('B')).toBeNull()
    const { trainer, card } = setup()
    // Every move card of Black, reviewed just now: nothing to learn anywhere.
    for (const n of [0, 2, 4, 6, 8]) card(n, 'move', NOW)
    expect(trainer.randomStart('B')).toBeNull()
  })
})

describe('TrainerService.queueStart', () => {
  it("leads to the card that sets the position's due: a move card of the player (part 3 spec 6.3)", () => {
    const { trainer, card } = setup()
    card(8, 'move', new Date(NOW.getTime() - DAY))
    expect(trainer.queueStart(DEEP_LIST_ID, 'B')).toEqual({ setup: zoneMoves(MIRRORED.slice(0, 5)), path: lineKeys(DEEP_LINE, 5), leave: false, nameId: DEEP_LIST_ID })
  })

  it("leaves the graph at a rest card of the bot's node", () => {
    const { trainer, card } = setup()
    card(7, 'rest', new Date(NOW.getTime() - DAY))
    expect(trainer.queueStart(DEEP_LIST_ID, 'B')).toEqual({ setup: zoneMoves(MIRRORED.slice(0, 5)), path: lineKeys(DEEP_LINE.slice(0, 7), 5), leave: true, nameId: DEEP_LIST_ID })
  })

  it('starts higher when the habits of the player follow the path', () => {
    const { trainer, card, repo, graph, at } = setup()
    card(8, 'move', new Date(NOW.getTime() - DAY))
    // Black chose the path's move at Y once (in Y's orientation): the habit there is 1, so the start goes up to X.
    card(4, 'move', NOW)
    const move = graph.edges(at(4)).find((e) => e.to === at(5))!.move
    repo.insertReview({ cardKey: graph.nodeKey(at(4)), kind: 'move', color: 'B', reviewedAt: NOW.toISOString(), sessionId: 's0', manual: null, auto: 'good', raw: { loss: 0, best: true, move } })
    expect(trainer.queueStart(DEEP_LIST_ID, 'B')).toEqual({ setup: zoneMoves(MIRRORED.slice(0, 3)), path: lineKeys(DEEP_LINE, 3), leave: false, nameId: DEEP_LIST_ID })
  })

  it('is null without weights, without a card that sets the due, and for an id that is no list position', () => {
    const none = setup({ levels: ['1d'] })
    none.card(8, 'move', new Date(NOW.getTime() - DAY))
    expect(none.trainer.queueStart(DEEP_LIST_ID, 'B')).toBeNull()
    const { trainer, card } = setup()
    expect(trainer.queueStart(DEEP_LIST_ID, 'B')).toBeNull()
    card(8, 'move', new Date(NOW.getTime() - DAY))
    expect(trainer.queueStart(DEEP_LIST_ID, 'W')).toBeNull()
    expect(trainer.queueStart('nope', 'B')).toBeNull()
  })

  it('keeps the habits and the node cards until the progress version changes', () => {
    const { trainer, card, repo, progress } = setup()
    card(8, 'move', new Date(NOW.getTime() - DAY))
    const reviews = vi.spyOn(repo, 'allReviews')
    const cards = vi.spyOn(repo, 'allCards')
    trainer.randomStart('B')
    trainer.queueStart(DEEP_LIST_ID, 'B')
    trainer.randomStart('B')
    expect([reviews.mock.calls.length, cards.mock.calls.length]).toEqual([1, 1])
    progress.replayLevel(TEST_THRESHOLDS)
    reviews.mockClear()
    cards.mockClear()
    trainer.queueStart(DEEP_LIST_ID, 'B')
    trainer.randomStart('B')
    expect([reviews.mock.calls.length, cards.mock.calls.length]).toEqual([1, 1])
  })
})

describe('TrainerService.guideFor', () => {
  const deep: Shape = { line: DEEP_LINE, setup: 5 }

  it("plays the path's moves at the bot's turn, a tenuki as the natural tenuki, without a draw (part 3 spec 5.4)", () => {
    const { trainer } = setup()
    const rng = seq(0.5)
    expect(trainer.guideFor(record(deep))!([P11, D4], rng)).toEqual(V('R12'))
    const tenuki = trainer.guideFor(record({ ...deep, moves: ['R12', 'Q12'] }))!
    expect(tenuki([P11, D4], rng)).toEqual(V('D4'))
    // A sharp position, where the bot itself never leaves: the path's tenuki is still its best point outside the corner.
    const policy = new Array<number>(362).fill(0)
    policy[vertexToIndex(V('P11'))] = 0.9
    policy[vertexToIndex(V('D4'))] = 0.1
    const sharp = naturalMoves({ humanPolicy: policy, position: Position.empty(), color: 'W', corner: 'TR', josekiStarted: true, temperature: 1 })
    expect(sharp).toContainEqual({ vertex: V('D4'), tenuki: true, p: 0 })
    expect(tenuki(sharp, rng)).toEqual(V('D4'))
    // No point outside the corner at all: a pass.
    expect(tenuki([P11], rng)).toBe('pass')
    // From X: the bot's tenuki, played as a pass or anywhere outside the corner, is the path's.
    const fromX: Shape = { line: DEEP_LINE, setup: 3 }
    expect(trainer.guideFor(record(fromX))!([P11, D4], rng)).toEqual(V('D4'))
    expect(trainer.guideFor(record({ ...fromX, moves: ['pass', 'Q13'] }))!([P11, D4], rng)).toEqual(V('R12'))
    expect(trainer.guideFor(record({ ...fromX, moves: ['C3', 'Q13'] }))!([P11, D4], rng)).toEqual(V('R12'))
    expect(rng.draws).toBe(0)
  })

  it("follows the path by its nodes: a symmetric node's twin move keeps it, and the bot plays on in its orientation", () => {
    const { trainer } = setup({ book: walkWeighted })
    // White, the player, is to move at Q16, where R14 and its mirror O17 lead to one node; the path goes on with Black's O16.
    const sym: Shape = { line: ['Q16', 'R14', 'O16'], setup: 1, settings: { userColor: 'W' } }
    expect(trainer.guideFor(record({ ...sym, moves: ['R14'] }))!([], seq(0))).toEqual(V('O16'))
    expect(trainer.guideFor(record({ ...sym, moves: ['O17'] }))!([], seq(0))).toEqual(V('Q14'))
    // White's tenuki leads to another node of the graph: the path is forgotten.
    expect(trainer.guideFor(record({ ...sym, moves: ['C3'] }))).toBeNull()
  })

  it("forgets the path once a move leaves it, after its target and at the player's turn", () => {
    const { trainer } = setup()
    expect(trainer.guideFor(record({ ...deep, moves: ['R12', 'P11'] }))).toBeNull()
    expect(trainer.guideFor(record({ ...deep, moves: ['P12', 'Q12'] }))).toBeNull()
    expect(trainer.guideFor(record({ ...deep, moves: ['R12', 'Q12', 'D4', 'P11'] }))).toBeNull()
    expect(trainer.guideFor(record({ ...deep, moves: ['R12'] }))).toBeNull()
  })

  it('leaves the graph after a rest target with a natural move off its edges, or decides on none before a draw', () => {
    const { trainer } = setup()
    const rest: Shape = { line: DEEP_LINE.slice(0, 7), setup: 5, leave: true }
    expect(trainer.guideFor(record(rest))!([P11, D4], seq(0.5))).toEqual(V('R12'))
    const leave = trainer.guideFor(record({ ...rest, moves: ['R12', 'Q12'] }))!
    // U's only edge is the tenuki: P11 is the one natural move off it.
    const rng = seq(0.5)
    expect(leave([P11, D4], rng)).toEqual(V('P11'))
    expect(rng.draws).toBe(1)
    // The BotGuide contract: a null leaves the bot's generator untouched.
    const untouched = seq(0.5)
    expect(leave([{ ...D4, p: 1 }], untouched)).toBeNull()
    expect(untouched.draws).toBe(0)
    expect(trainer.guideFor(record({ ...rest, moves: ['R12', 'Q12', 'P11', 'P10'] }))).toBeNull()
  })

  it('is null outside a counted deep start of the graph at the player level', () => {
    const { trainer, config } = setup()
    const rec = record(deep)
    expect(trainer.guideFor(rec)).not.toBeNull()
    expect(trainer.guideFor(record({ ...deep, settings: { mode: 'free', start: undefined } }))).toBeNull()
    expect(trainer.guideFor(record({ ...deep, settings: { start: { id: DEEP_LIST_ID, name: null, mirror: false } } }))).toBeNull()
    expect(trainer.guideFor(record({ ...deep, settings: { trap: { id: 'trap', index: 5, mirror: false, swapColors: false } } }))).toBeNull()
    // A replay from a later move: more initial moves than the setup.
    const later = record({ ...deep, moves: ['R12', 'Q12'] })
    expect(trainer.guideFor({ ...later, initialMoves: [...later.initialMoves, ...later.moves.map(({ color, vertex }) => ({ color, vertex }))], moves: [] })).toBeNull()
    // A setup the graph does not know (R16 is no edge of Q16): the walk has left it.
    expect(trainer.guideFor(record({ line: ['Q16', 'R16', 'Q13', 'R12'], setup: 3 }))).toBeNull()
    // A path the graph no longer has (rebuilt since): its next key is no node, or a node the bot's node has no edge to.
    const withPath = (path: string[]): SessionRecord => ({ ...rec, settings: { ...rec.settings, start: { ...rec.settings.start!, graph: { setup: 5, path, leave: false } } } })
    expect(trainer.guideFor(withPath([lineKey([...DEEP_LINE.slice(0, 5), 'S12'])]))).toBeNull()
    expect(trainer.guideFor(withPath(lineKeys(DEEP_LINE, 6)))).toBeNull()
    config.player.level = '1d'
    expect(trainer.guideFor(rec)).toBeNull()
  })
})
