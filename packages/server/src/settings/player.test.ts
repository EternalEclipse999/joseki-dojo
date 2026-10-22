import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAYER_LEVELS, type Rating } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { fakeEngine, serviceOptions, tempDir, testConfig } from '../../test/helpers'
import { createServices } from '../app'
import { CardRepo } from '../cards/repo'
import { newState, schedule } from '../cards/schedule'
import type { AppConfig } from '../config'
import { GraphCardRepo } from '../progress/repo'
import type { ThresholdTable } from '../review/thresholds'
import { SessionRepo } from '../store/repo'
import { PlayerService, PlayerSettingsError } from './player'

/** A player service whose replay and transaction only log what happens. */
function logged(config: AppConfig, configFile: string) {
  const log: string[] = []
  const player = new PlayerService({
    config,
    configFile,
    replay: (level) => log.push(`replay ${level}`),
    transaction: (fn) => {
      log.push('begin')
      try {
        const result = fn()
        log.push('commit')
        return result
      } catch (err) {
        log.push('rollback')
        throw err
      }
    },
  })
  return { player, log }
}

describe('PlayerService', () => {
  it('saves the level into the config file and the live config, after the replay in the same transaction', async () => {
    const config = testConfig()
    const file = join(tempDir(), 'config.local.json')
    writeFileSync(file, JSON.stringify({ port: 5179, player: { level: '7k' } }))
    const { player, log } = logged(config, file)
    expect(player.view()).toEqual({ level: '7k' })
    expect(await player.save('3d')).toEqual({ level: '3d' })
    expect(log).toEqual(['begin', 'replay 3d', 'commit'])
    expect(config.player.level).toBe('3d')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ port: 5179, player: { level: '3d' } })
  })

  it('rolls the replay back when the config cannot be written, and keeps the level', async () => {
    const config = testConfig()
    // A folder where the config file should be: it can be neither read nor replaced.
    const { player, log } = logged(config, tempDir())
    await expect(player.save('3d')).rejects.toThrow()
    expect(log).toEqual(['begin', 'replay 3d', 'rollback'])
    expect(config.player.level).toBe('7k')
  })

  it('refuses an unknown level without a replay', async () => {
    const { player, log } = logged(testConfig(), join(tempDir(), 'config.local.json'))
    await expect(player.save('10p')).rejects.toBeInstanceOf(PlayerSettingsError)
    expect(log).toEqual([])
  })
})

describe('a level change', () => {
  // Thresholds like the kyu levels' up to 1k, where 1.5 points is exact, and like the dan levels' from 1d on, where it is a mistake.
  const table: ThresholdTable = {
    method: {},
    levels: Object.fromEntries(PLAYER_LEVELS.map((l) => [l, l.endsWith('k') ? { inaccuracy: 2, mistake: 4, blunder: 8 } : { inaccuracy: 0.5, mistake: 1, blunder: 3 }])),
  }
  const at = new Date('2026-10-20T10:00:00')
  const once = (rating: Rating) => schedule(newState(at), rating, at)

  /**
   * Services with the table and a card of each kind, each with one review at 7k where a 1.5-point move was exact: a graph
   * move card, a problem card answered with a loss of 1.5, and a position card whose review is older than the raw losses,
   * its training still in the database (Black's third move loses 1.5).
   */
  function withCards(configFile?: string) {
    const config = testConfig()
    const services = createServices(config, fakeEngine(), serviceOptions(config, { thresholds: table, ...(configFile ? { configFile } : {}) }))
    const { db } = services
    const sessions = new SessionRepo(db)
    sessions.insertSession({
      id: 's1', createdAt: at.toISOString(), finishedAt: at.toISOString(), status: 'finished', parentSessionId: null, initialMoves: [], summary: null,
      settings: { mode: 'list', environment: 'empty', userColor: 'B', botRank: '5k', corner: 'TR' },
      moves: [
        { color: 'B', vertex: [15, 3], actor: 'user', inZone: true },
        { color: 'W', vertex: [16, 5], actor: 'bot', inZone: true },
        { color: 'B', vertex: [14, 5], actor: 'user', inZone: true },
      ],
    })
    ;[0, 0, 0, -1.5].forEach((scoreLead, turn) =>
      sessions.saveAnalysis('s1', turn, 'position', 10, { rootInfo: { currentPlayer: turn % 2 === 0 ? 'B' : 'W', scoreLead, winrate: 0.5, visits: 10 }, moveInfos: [], ownership: null }),
    )
    const cards = new CardRepo(db)
    const base = { reviewedAt: at.toISOString(), rating: 'good' as const, auto: 'good' as const, worst: null, stateBefore: newState(at) }
    cards.insertCard({ id: 'position', kind: 'position', key: 'position:x', data: { startId: 'x', userColor: 'B', botRank: '5k' }, state: once('good'), createdAt: at.toISOString() })
    cards.insertReview({ ...base, cardId: 'position', sessionId: 's1', raw: null })
    cards.insertCard({ id: 'problem', kind: 'move', key: 'move:x', data: {}, state: once('good'), createdAt: at.toISOString() })
    cards.insertReview({ ...base, cardId: 'problem', sessionId: null, raw: { loss: 1.5, best: false } })
    const graph = new GraphCardRepo(db)
    graph.upsert({ key: 'k', kind: 'move', color: 'B', state: once('good'), createdAt: at.toISOString() })
    graph.insertReview({ cardKey: 'k', kind: 'move', color: 'B', reviewedAt: at.toISOString(), sessionId: 's1', manual: null, auto: 'good', raw: { loss: 1.5, best: false } })
    const tables = () => ['graph_cards', 'graph_reviews', 'cards', 'card_reviews'].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())
    const close = async () => {
      await services.engine.stop()
      db.close()
    }
    return { config, services, cards, graph, tables, close }
  }

  it('replays every card with the thresholds of the new level before it answers', async () => {
    const { config, services, cards, graph, close } = withCards()
    try {
      expect(await services.player.save('1d')).toEqual({ level: '1d' })
      expect(config.player.level).toBe('1d')
      expect(graph.reviews('k', 'move', 'B').map((r) => r.auto)).toEqual(['again'])
      expect(graph.card('k', 'move', 'B')!.state).toEqual(once('again'))
      // Re-derived from the training's moves and analyses, its raw losses kept from now on.
      expect(cards.reviewsOf('position')).toEqual([
        expect.objectContaining({ auto: 'again', rating: 'again', worst: { category: 'mistake', loss: 1.5 }, raw: { moves: [{ loss: 0 }, { loss: 1.5 }], opponent: [{ loss: 0, replyLoss: 1.5 }] } }),
      ])
      expect(cards.reviewsOf('problem')).toEqual([expect.objectContaining({ auto: 'again', worst: { category: 'mistake', loss: 1.5 } })])
      expect([cards.card('position')!.state, cards.card('problem')!.state]).toEqual([once('again'), once('again')])

      await services.player.save('7k')
      expect([graph.card('k', 'move', 'B')!.state, cards.card('position')!.state, cards.card('problem')!.state]).toEqual([once('good'), once('good'), once('good')])
    } finally {
      await close()
    }
  })

  it('is one transaction with the config write: a failed write leaves the level and every card as they were', async () => {
    // A folder where the config file should be.
    const { config, services, tables, close } = withCards(tempDir())
    try {
      const before = tables()
      await expect(services.player.save('1d')).rejects.toThrow()
      expect(config.player.level).toBe('7k')
      expect(tables()).toEqual(before)
    } finally {
      await close()
    }
  })
})
