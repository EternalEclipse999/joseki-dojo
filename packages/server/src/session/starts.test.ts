import { describe, expect, it, vi } from 'vitest'
import { gtpToVertex, type Corner, type Move, type SessionSettings, type SessionView, type Vertex } from '@joseki-dojo/shared'
import { StubEngine, testConfig } from '../../test/helpers'
import { AnalysisScheduler } from '../analysis/scheduler'
import { HumanBot } from '../bot/bot'
import { mulberry32 } from '../bot/rng'
import { newState, schedule } from '../cards/schedule'
import { lineKey } from '../graph/fixture'
import { decodeJdb, encodeJdb, fromTopRight, trapId } from '../jdb'
import { TEST_THRESHOLDS } from '../progress/fixture'
import { GraphCardRepo } from '../progress/repo'
import { GraphProgressService } from '../progress/service'
import { StartBook } from '../starts/book'
import { TEST_STARTS_LIST, testDubiousStartsTree, testStartsTree } from '../starts/fixture'
import { openDb } from '../store/db'
import { SessionRepo } from '../store/repo'
import { DEEP_LINE, DEEP_LINE_MIRRORED, deepBook, lineKeys, zoneMoves } from '../trainer/fixture'
import { TrainerService } from '../trainer/service'
import { SessionService, type SessionServiceDeps } from './service'

const V = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
const ID_C = trapId(['Q17', 'R15'].map(V))
const book = (): StartBook => StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})

const settings = (over: Partial<SessionSettings> = {}): SessionSettings => ({ mode: 'list', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR', startId: ID_C, ...over })

/** `draws` feed the dubious share and `pick` (random mode) and the mirror coin: 0.9 means no mirror. */
function setup(starts: StartBook = book(), draws: number[] = [0.9], trainer?: SessionServiceDeps['trainer']) {
  const engine = new StubEngine()
  const repo = new SessionRepo(openDb(':memory:'))
  const cfg = testConfig()
  const log: string[] = []
  let n = 0
  let k = 0
  const service = new SessionService({
    repo,
    engine,
    config: cfg,
    analysis: new AnalysisScheduler(engine, repo, cfg.analysis),
    bot: new HumanBot(engine, mulberry32(1)),
    starts,
    trainer,
    publish: () => undefined,
    onFinished: () => undefined,
    log: (line) => log.push(line),
    rng: () => draws[k++ % draws.length],
    newId: () => `s${++n}`,
    now: () => '2026-10-14T10:00:00.000Z',
  })
  return { service, repo, log }
}

/** The test list's 4-4 position, Q16 O17 R14: X of deepBook(). */
const ID_44 = trapId(['Q16', 'O17', 'R14'].map(V))
const NOW = new Date('2026-10-14T10:00:00.000Z')

/** A trainer over deepBook() with X on the list as ID_44, the weights at `levels` (default: the player level), its draws all 0.9. */
function deepTrainer(levels?: string[]) {
  const config = testConfig()
  const graph = deepBook(levels ?? [config.player.level], ID_44)
  const repo = new GraphCardRepo(openDb(':memory:'))
  const progress = new GraphProgressService({ repo, graph, starts: book(), thresholds: () => TEST_THRESHOLDS, level: () => config.player.level, now: () => NOW })
  const trainer = new TrainerService({ graph, progress, repo, starts: book(), config, now: () => NOW, rng: () => 0.9 })
  /** A Black move card at V, the end of DEEP_LINE, due a day ago. */
  const dueAtV = (): void => {
    const when = new Date(NOW.getTime() - 24 * 3600 * 1000)
    repo.upsert({ key: graph.nodeKey(graph.node(lineKey(DEEP_LINE))!), kind: 'move', color: 'B', state: schedule(newState(when), 'good', when), createdAt: when.toISOString() })
  }
  return { trainer, dueAtV }
}

/** Top-right moves (GTP or 'tenuki') put in `corner` as initial moves: colours from Black, a tenuki as a pass. */
const setupMoves = (line: string[], corner: Corner): Move[] => zoneMoves(line, corner).map((m, i) => ({ color: i % 2 === 0 ? 'B' : 'W', vertex: m === 'tenuki' ? 'pass' : m }))

const waitMoves = async (service: SessionService, id: string, count: number): Promise<SessionView> => {
  await vi.waitFor(() => {
    const v = service.view(id)
    expect(v.moves.length).toBe(count)
    expect(v.botThinking).toBe(false)
  })
  return service.view(id)
}

describe('start position sessions', () => {
  it('puts a list position on the board and lets the user move when it is their turn', () => {
    const { service } = setup()
    const v = service.start(settings())
    expect(v.initialMoves).toEqual([
      { color: 'B', vertex: V('Q17') },
      { color: 'W', vertex: V('R15') },
    ])
    expect(v.settings.start).toEqual({ id: ID_C, name: 'Тестовое начало 3-4', group: '3-4', mirror: false })
    expect(v.toMove).toBe('B')
    expect(v.moves).toEqual([])
  })

  it('starts from a group stone or a branch of the tree and names it for the crumbs', () => {
    const head = setup().service.start(settings({ startId: trapId([V('Q16')]) }))
    expect(head.initialMoves).toEqual([{ color: 'B', vertex: V('Q16') }])
    expect(head.settings.start).toEqual({ id: trapId([V('Q16')]), name: '4-4', mirror: false })
    const branch = setup().service.start(settings({ startId: trapId(['Q16', 'O17'].map(V)) }))
    expect(branch.initialMoves).toHaveLength(2)
    expect(branch.settings.start).toMatchObject({ name: 'Тестовая ветка', group: '4-4' })
  })

  it('names a random start only by the list positions', () => {
    // Q16 O17 is an unnamed start of the base and also the moves of a branch.
    const { service } = setup(book(), [0, 0.9])
    const v = service.start(settings({ mode: 'random', startId: undefined }))
    expect(v.settings.start).toMatchObject({ id: trapId(['Q16', 'O17'].map(V)), name: null })
    expect(v.settings.start?.group).toBeUndefined()
  })

  it('lets the bot move first when it is the bot\'s turn', async () => {
    const { service } = setup()
    const v = service.start(settings({ userColor: 'W' }))
    const after = await waitMoves(service, v.id, 1)
    expect(after.moves[0].actor).toBe('bot')
    expect(after.toMove).toBe('W')
  })

  it('mirrors on the coin and moves the position to the chosen corner', () => {
    const { service } = setup(book(), [0.1])
    const v = service.start(settings({ corner: 'BL' }))
    expect(v.settings.start?.mirror).toBe(true)
    // Q17 mirrored in the top-right diagonal is R16; in the bottom-left corner it is C4.
    expect(v.initialMoves[0]).toEqual({ color: 'B', vertex: V('C4') })
  })

  it('picks a random position by shows and names it when it is on the list', () => {
    const { service } = setup(book(), [0.99, 0.9])
    const v = service.start(settings({ mode: 'random', startId: undefined }))
    expect(v.settings.mode).toBe('random')
    expect(v.settings.start?.id).toBe(ID_C)
    expect(v.settings.start?.name).toBe('Тестовое начало 3-4')
    expect(v.settings.start?.group).toBe('3-4')
  })

  it('refuses the start modes without a base and a list id that is not on the list', () => {
    const { service } = setup(StartBook.empty())
    expect(() => service.start(settings({ mode: 'random', startId: undefined }))).toThrow(expect.objectContaining({ text: { key: 'error.starts.unavailable' } }))
    const listed = setup().service
    expect(() => listed.start(settings({ startId: 'nope' }))).toThrow(expect.objectContaining({ text: { key: 'error.starts.notOnList' } }))
    expect(() => listed.start(settings({ startId: undefined }))).toThrow(expect.objectContaining({ text: { key: 'error.settings.invalid' } }))
  })

  it('counts a finished session as a show', () => {
    const { service, repo } = setup()
    const v = service.start(settings())
    expect(repo.startShows()).toEqual(new Map())
    service.finish(v.id)
    expect(repo.startShows()).toEqual(new Map([[ID_C, 1]]))
  })

  it('keeps the start in a replay, and finishing the replay is one more show', () => {
    const { service, repo } = setup()
    const v = service.start(settings())
    service.finish(v.id)
    const replay = service.replayFrom(v.id, 0)
    expect(replay.settings.start).toEqual(v.settings.start)
    expect(replay.initialMoves).toEqual(v.initialMoves)
    service.finish(replay.id)
    expect(repo.startShows()).toEqual(new Map([[ID_C, 2]]))
  })

  it('lets a dubious id through neither the list mode', () => {
    const dubiousId = trapId(['Q16', 'O17', 'O16'].map(V))
    const { service } = setup(StartBook.fromBase(decodeJdb(encodeJdb(testDubiousStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {}))
    expect(() => service.start(settings({ startId: dubiousId }))).toThrow(expect.objectContaining({ text: { key: 'error.starts.notOnList' } }))
  })
})

describe('deep starts (part 3 spec 5)', () => {
  // The trainer's setups come in X's orientation (DEEP_LINE_MIRRORED); its draws lead to V, and Black's habit of a third at
  // Y puts the start at Z, after Black's Q13 (N16 mirrored). The path is the keys of the nodes after Z, whatever the corner.

  it('starts «Случайно» deeper in the graph with weights for the player level, the bot playing the way to the target', async () => {
    const { service, repo } = setup(book(), [0.1], deepTrainer().trainer)
    // The mirror coin comes up: mirrored back, the setup is DEEP_LINE itself.
    const v = service.start(settings({ mode: 'random', startId: undefined, corner: 'BL' }))
    expect(v.initialMoves).toEqual(setupMoves(DEEP_LINE.slice(0, 5), 'BL'))
    expect(v.initialMoves[3].vertex).toBe('pass')
    expect(v.settings.start).toEqual({
      id: ID_44,
      name: 'Тестовое начало 4-4',
      group: '4-4',
      mirror: true,
      graph: { setup: 5, path: lineKeys(DEEP_LINE, 5), leave: false },
    })
    // White, the bot, is to move at Z and plays the path's R12.
    const after = await waitMoves(service, v.id, 1)
    expect(after.moves[0]).toMatchObject({ actor: 'bot', vertex: fromTopRight(V('R12'), 'BL') })
    // A deep start is no show of its list position.
    service.finish(v.id)
    expect(repo.startShows()).toEqual(new Map())
  })

  it("offers no end after the bot's tenuki on the path (part 3 spec 5.4)", async () => {
    const { service } = setup(book(), [0.1], deepTrainer().trainer)
    const v = service.start(settings({ mode: 'random', startId: undefined, corner: 'BL' }))
    await waitMoves(service, v.id, 1)
    // Black follows the path with Q12; White's tenuki to V is the path's.
    service.playUserMove(v.id, fromTopRight(V('Q12'), 'BL'))
    const after = await waitMoves(service, v.id, 3)
    expect(after.moves[2]).toMatchObject({ actor: 'bot', inZone: false })
    expect(after.endProposed).toBe(false)
  })

  it('picks «Случайно» by shows as before without weights for the player level', () => {
    const { service } = setup(book(), [0.99, 0.9], deepTrainer(['1d']).trainer)
    const v = service.start(settings({ mode: 'random', startId: undefined }))
    expect(v.settings.start).toEqual({ id: ID_C, name: 'Тестовое начало 3-4', group: '3-4', mirror: false })
  })

  it("starts the queue's training of a list position toward the card that sets its due (part 3 spec 6.3)", () => {
    const { trainer, dueAtV } = deepTrainer()
    dueAtV()
    const v = setup(book(), [0.9], trainer).service.start(settings({ startId: ID_44, queue: true }))
    expect(v.initialMoves).toEqual(setupMoves(DEEP_LINE_MIRRORED.slice(0, 5), 'TR'))
    expect(v.settings.start).toEqual({
      id: ID_44,
      name: 'Тестовое начало 4-4',
      group: '4-4',
      mirror: false,
      graph: { setup: 5, path: lineKeys(DEEP_LINE, 5), leave: false },
    })
    // «Из списка» itself starts at the position.
    expect(setup(book(), [0.9], trainer).service.start(settings({ startId: ID_44 })).settings.start?.graph).toBeUndefined()
  })

  it('starts the queue at the list position without weights or without a card that sets its due', () => {
    const unweighted = deepTrainer(['1d'])
    unweighted.dueAtV()
    for (const { trainer } of [deepTrainer(), unweighted]) {
      const v = setup(book(), [0.9], trainer).service.start(settings({ startId: ID_44, queue: true }))
      expect(v.settings.start).toEqual({ id: ID_44, name: 'Тестовое начало 4-4', group: '4-4', mirror: false })
      expect(v.initialMoves).toEqual(setupMoves(['Q16', 'O17', 'R14'], 'TR'))
    }
  })

  it('starts as before when the trainer fails, and logs it', () => {
    const fails = (): never => {
      throw new Error('boom')
    }
    // Draws: the pick, the mirror coin; then the mirror coin of the queue start.
    const { service, log } = setup(book(), [0.99, 0.9], { randomStart: fails, queueStart: fails, guideFor: () => null })
    expect(service.start(settings({ mode: 'random', startId: undefined })).settings.start).toEqual({ id: ID_C, name: 'Тестовое начало 3-4', group: '3-4', mirror: false })
    expect(service.start(settings({ startId: ID_44, queue: true })).settings.start).toEqual({ id: ID_44, name: 'Тестовое начало 4-4', group: '4-4', mirror: false })
    expect(log).toEqual(['trainer: the random start failed, the start is chosen as before: boom', 'trainer: the queue start failed, the start is chosen as before: boom'])
  })

  it('refuses the queue start outside «Из списка» and with a random colour', () => {
    const { service } = setup()
    const invalid = expect.objectContaining({ text: { key: 'error.settings.invalid' } })
    expect(() => service.start(settings({ queue: true, userColor: 'random' }))).toThrow(invalid)
    expect(() => service.start(settings({ mode: 'random', startId: undefined, queue: true }))).toThrow(invalid)
    expect(() => service.start(settings({ mode: 'free', startId: undefined, queue: true }))).toThrow(invalid)
    expect(service.start(settings({ queue: true })).settings.start?.id).toBe(ID_C)
  })
})

describe('dubious starts', () => {
  const D = trapId(['Q16', 'O17', 'O16'].map(V))
  const dubiousBook = (): StartBook => StartBook.fromBase(decodeJdb(encodeJdb(testDubiousStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})
  // Draws: the dubious share, the pick, the mirror coin.
  const draws = [0.05, 0, 0.9]

  it('swaps the colours when the user plays the side of the dubious move', () => {
    const { service } = setup(dubiousBook(), draws)
    const v = service.start(settings({ mode: 'random' }))
    expect(v.settings.start).toEqual({ id: D, name: null, mirror: false, dubious: true, swapColors: true })
    expect(v.initialMoves).toEqual([
      { color: 'W', vertex: V('Q16') },
      { color: 'B', vertex: V('O17') },
      { color: 'W', vertex: V('O16') },
    ])
    expect(v.toMove).toBe('B')
    expect(v.moves).toEqual([])
  })

  it('keeps the colours when the user is the other side', () => {
    const { service } = setup(dubiousBook(), draws)
    const v = service.start(settings({ mode: 'random', userColor: 'W' }))
    expect(v.settings.start).toEqual({ id: D, name: null, mirror: false, dubious: true, swapColors: false })
    expect(v.initialMoves).toEqual([
      { color: 'B', vertex: V('Q16') },
      { color: 'W', vertex: V('O17') },
      { color: 'B', vertex: V('O16') },
    ])
    expect(v.toMove).toBe('W')
  })

  it("keeps the share with weights: a dubious start as before, else the trainer's, else the base's pick (part 3 spec 5.1)", () => {
    const weighted = deepTrainer()
    const asked = vi.spyOn(weighted.trainer, 'randomStart')
    // The share draw comes up: the dubious start, with the colours swapped so that the user answers; the trainer is not asked.
    const dubious = setup(dubiousBook(), draws, weighted.trainer).service.start(settings({ mode: 'random' }))
    expect(dubious.settings.start).toEqual({ id: D, name: null, mirror: false, dubious: true, swapColors: true })
    expect(asked).not.toHaveBeenCalled()
    // It does not: the trainer's deep start. Draws: the share, the mirror coin.
    const deep = setup(dubiousBook(), [0.5, 0.9], weighted.trainer).service.start(settings({ mode: 'random' }))
    expect(deep.settings.start).toEqual({ id: ID_44, name: 'Тестовое начало 4-4', group: '4-4', mirror: false, graph: { setup: 5, path: lineKeys(DEEP_LINE, 5), leave: false } })
    expect(asked).toHaveBeenCalledTimes(1)
    // Nor has the trainer a start (no weights for the player level): a normal start of the base. Draws: the share, the pick, the mirror coin.
    const normal = setup(dubiousBook(), [0.5, 0.99, 0.9], deepTrainer(['1d']).trainer).service.start(settings({ mode: 'random' }))
    expect(normal.settings.start).toEqual({ id: ID_C, name: 'Тестовое начало 3-4', group: '3-4', mirror: false })
  })

  it('keeps the dubious flags in a replay', () => {
    const { service, repo } = setup(dubiousBook(), draws)
    const v = service.start(settings({ mode: 'random' }))
    service.finish(v.id)
    const replay = service.replayFrom(v.id, 0)
    expect(replay.settings.start).toEqual({ id: D, name: null, mirror: false, dubious: true, swapColors: true })
    service.finish(replay.id)
    expect(repo.startShows()).toEqual(new Map([[D, 2]]))
  })
})
