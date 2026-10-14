import { IllegalMoveError, moveToGtp, nextColor, otherColor, Position, type Move, type PositionReview, type ServerMessage, type Vertex } from '@joseki-dojo/shared'
import { compactAnalysis } from '../analysis/compact'
import type { AppConfig } from '../config'
import { EngineError, type AnalysisStream, type StreamingEngine } from '../engine/engine'
import type { AnalysisResponse } from '../engine/katago-types'
import { baseQuery } from '../engine/query'
import { toErrorMessage } from '../errors'
import { SessionError } from '../session/session'
import { movesBefore } from '../store/records'
import type { SessionRepo } from '../store/repo'
import { candidatesOf } from './compute'

export interface VariationRequest {
  sessionId: string
  /** The game move the variation replaces: it starts from the position before it. */
  fromTurn: number
  moves: Vertex[]
}

type Analysed = Omit<PositionReview, 'turn'>
interface CacheEntry {
  visits: number
  /** The search reached its natural end: the position needs no new search. */
  complete: boolean
  position: Analysed
}
/** Spec 4: results kept in memory, least recently used out. */
const CACHE_SIZE = 500

/** Spec 6.2: one deepening search per owner (a socket); results cached per position; partial results sent as they come. */
export class VariationService {
  private readonly running = new Map<object, AnalysisStream>()
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly d: { repo: SessionRepo; engine: StreamingEngine; config: AppConfig; everySec?: number; log?: (line: string) => void }) {}

  start(owner: object, req: VariationRequest, send: (msg: ServerMessage) => void): void {
    const rec = this.d.repo.getSession(req.sessionId)
    if (!rec) throw new SessionError('Тренировка не найдена', 'session_not_found')
    if (rec.status !== 'finished') throw new SessionError('Варианты доступны только в разборе', 'bad_request')
    if (!Number.isInteger(req.fromTurn) || req.fromTurn < 0 || req.fromTurn > rec.moves.length) throw new SessionError('Нет такого хода', 'bad_request')
    const moves: Move[] = movesBefore(rec, req.fromTurn)
    let color = nextColor(moves)
    for (const vertex of req.moves) {
      moves.push({ color, vertex })
      color = otherColor(color)
    }
    try {
      Position.fromMoves(moves)
    } catch (err) {
      if (err instanceof IllegalMoveError) throw new SessionError('Недопустимый ход в варианте', 'illegal_move')
      throw err
    }
    // The request is valid: only now the owner's previous search is given up.
    this.stop(owner)
    const key = moves.map((m) => `${m.color}${moveToGtp(m.vertex)}`).join(' ')
    const reply = (visits: number, done: boolean, position: Analysed): void =>
      send({ type: 'variationAnalysis', sessionId: req.sessionId, fromTurn: req.fromTurn, moves: req.moves, visits, done, position: { turn: req.fromTurn + req.moves.length, ...position } })

    const cached = this.recall(key)
    if (cached) {
      reply(cached.visits, cached.complete, cached.position)
      if (cached.complete) return
    }
    this.launch(owner, key, moves, reply, send, false)
  }

  /** Forgets every cached result (the engine was switched to another network). */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Starts the search. Spec 6.1: a stream rejected because KataGo restarted is asked again once, by the service itself;
   * a second failure, or an engine that has failed for good, goes to the client.
   */
  private launch(owner: object, key: string, moves: Move[], reply: (visits: number, done: boolean, position: Analysed) => void, send: (msg: ServerMessage) => void, retried: boolean): void {
    // Declared before the call: a synchronous update must not hit the temporal dead zone.
    let stream: AnalysisStream | undefined
    stream = this.d.engine.analyzeStream(
      { ...baseQuery(moves), maxVisits: this.d.config.analysis.variationVisits, includeOwnership: true },
      (partial) => {
        const better = this.keep(key, partial, false)
        if (better && stream && this.running.get(owner) === stream) reply(better.visits, false, better.position)
      },
      this.d.everySec ?? 0.5,
    )
    const mine = stream
    this.running.set(owner, mine)
    mine.done
      .then(
        (final) => {
          const current = this.running.get(owner) === mine
          if (current) this.running.delete(owner)
          // A stopped stream settles with its last partial answer: only a real final answer completes the position.
          if (final) this.keep(key, final, !final.isDuringSearch)
          const best = this.recall(key)
          // Only a search that ran to its end is `done`; a stopped one was left by its owner.
          if (current && best) reply(best.visits, true, best.position)
        },
        (err: unknown) => {
          if (this.running.get(owner) !== mine) return
          if (!retried && err instanceof EngineError && err.code === 'engine_failed' && !this.d.engine.failed) {
            this.launch(owner, key, moves, reply, send, true)
            return
          }
          this.running.delete(owner)
          send(toErrorMessage(err))
        },
      )
      .catch((err: unknown) => (this.d.log ?? console.error)(`variation: ${err instanceof Error ? err.message : String(err)}`))
  }

  stop(owner: object): void {
    const stream = this.running.get(owner)
    if (!stream) return
    this.running.delete(owner)
    stream.stop()
  }

  /** Stores `r` when it has more visits than the cached result; returns the stored one, or null when it was not better. */
  private keep(key: string, r: AnalysisResponse, complete: boolean): CacheEntry | null {
    const a = compactAnalysis(r)
    const visits = a.rootInfo.visits
    const known = this.cache.get(key)
    if (known && known.visits >= visits) {
      if (complete) known.complete = true
      return null
    }
    const entry = { visits, complete, position: { scoreLeadBlack: a.rootInfo.scoreLead, visits, candidates: candidatesOf(a), ownership: a.ownership } }
    this.cache.delete(key)
    this.cache.set(key, entry)
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string)
    return entry
  }

  private recall(key: string): CacheEntry | null {
    const hit = this.cache.get(key)
    if (!hit) return null
    this.cache.delete(key)
    this.cache.set(key, hit)
    return hit
  }
}
