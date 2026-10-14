import { describe, expect, it, vi } from 'vitest'
import { gtpToVertex, type SessionSettings, type SessionView, type Vertex } from '@joseki-dojo/shared'
import { StubEngine, testConfig } from '../../test/helpers'
import { AnalysisScheduler } from '../analysis/scheduler'
import { HumanBot } from '../bot/bot'
import { mulberry32 } from '../bot/rng'
import { decodeJdb, encodeJdb, trapId } from '../jdb'
import { StartBook } from '../starts/book'
import { TEST_STARTS_LIST, testDubiousStartsTree, testStartsTree } from '../starts/fixture'
import { openDb } from '../store/db'
import { SessionRepo } from '../store/repo'
import { SessionService } from './service'

const V = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
const ID_C = trapId(['Q17', 'R15'].map(V))
const book = (): StartBook => StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})

const settings = (over: Partial<SessionSettings> = {}): SessionSettings => ({ mode: 'list', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR', startId: ID_C, ...over })

/** `draws` feed `pick` (random mode) and the mirror coin: 0.9 means no mirror. */
function setup(starts: StartBook = book(), draws: number[] = [0.9]) {
  const engine = new StubEngine()
  const repo = new SessionRepo(openDb(':memory:'))
  const cfg = testConfig()
  let n = 0
  let k = 0
  const service = new SessionService({
    repo,
    engine,
    config: cfg,
    analysis: new AnalysisScheduler(engine, repo, cfg.analysis),
    bot: new HumanBot(engine, mulberry32(1)),
    starts,
    publish: () => undefined,
    onFinished: () => undefined,
    rng: () => draws[k++ % draws.length],
    newId: () => `s${++n}`,
    now: () => '2026-10-14T10:00:00.000Z',
  })
  return { service, repo }
}

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
    expect(() => service.start(settings({ mode: 'random', startId: undefined }))).toThrow('Стартовые позиции недоступны')
    const listed = setup().service
    expect(() => listed.start(settings({ startId: 'nope' }))).toThrow('Такой позиции нет в списке')
    expect(() => listed.start(settings({ startId: undefined }))).toThrow('Некорректные настройки тренировки')
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
    expect(() => service.start(settings({ startId: dubiousId }))).toThrow('Такой позиции нет в списке')
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
