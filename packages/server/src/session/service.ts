import { randomUUID } from 'node:crypto'
import {
  CORNERS,
  gtpToVertex,
  inZone,
  isBotRank,
  vertexToGtp,
  type Actor,
  type Move,
  type MoveVertex,
  type ResolvedSettings,
  type ServerMessage,
  type SessionSettings,
  type SessionView,
  type Vertex,
} from '@joseki-dojo/shared'
import type { AnalysisScheduler } from '../analysis/scheduler'
import type { MoveChooser } from '../bot/bot'
import type { Rng } from '../bot/rng'
import type { AppConfig } from '../config'
import type { AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import { toErrorMessage } from '../errors'
import { movesBefore, type SessionRecord } from '../store/records'
import type { SessionRepo } from '../store/repo'
import { shouldProposeEnd } from './end-detection'
import { Session, SessionError } from './session'

export interface SessionServiceDeps {
  repo: SessionRepo
  analysis: AnalysisScheduler
  bot: MoveChooser
  engine: AnalysisEngine
  config: AppConfig
  publish: (sessionId: string, msg: ServerMessage) => void
  /** Starts the review of a finished session. */
  onFinished: (sessionId: string) => void
  rng?: Rng
  newId?: () => string
  now?: () => string
}

export function validateSettings(s: SessionSettings): void {
  const ok =
    s.mode === 'free' &&
    s.environment === 'empty' &&
    (s.userColor === 'B' || s.userColor === 'W' || s.userColor === 'random') &&
    typeof s.botRank === 'string' &&
    isBotRank(s.botRank) &&
    (s.corner === 'random' || CORNERS.includes(s.corner))
  if (!ok) throw new SessionError('Некорректные настройки тренировки', 'bad_request')
}

export class SessionService {
  private readonly active = new Map<string, Session>()
  private readonly rng: Rng
  private readonly newId: () => string
  private readonly now: () => string

  constructor(private readonly d: SessionServiceDeps) {
    this.rng = d.rng ?? Math.random
    this.newId = d.newId ?? randomUUID
    this.now = d.now ?? (() => new Date().toISOString())
  }

  start(settings: SessionSettings): SessionView {
    validateSettings(settings)
    const resolved: ResolvedSettings = {
      mode: settings.mode,
      environment: settings.environment,
      botRank: settings.botRank,
      userColor: settings.userColor === 'random' ? (this.rng() < 0.5 ? 'B' : 'W') : settings.userColor,
      corner: settings.corner === 'random' ? CORNERS[Math.floor(this.rng() * CORNERS.length)] : settings.corner,
    }
    return this.create(resolved, [], null)
  }

  replayFrom(sessionId: string, turn: number): SessionView {
    const parent = this.load(sessionId)
    if (!Number.isInteger(turn) || turn < 0 || turn > parent.turn) throw new SessionError('Нет такого хода', 'bad_request')
    return this.create(parent.record.settings, movesBefore(parent.record, turn), parent.id)
  }

  view(sessionId: string): SessionView {
    return this.load(sessionId).view()
  }

  playUserMove(sessionId: string, vertex: Vertex): void {
    const s = this.load(sessionId)
    this.requireUserTurn(s)
    if (!inZone(s.corner, vertex)) throw new SessionError('Ходить можно только в зоне угла', 'outside_zone')
    this.commit(s, vertex, 'user')
  }

  /** Spec 8.3: plays the main network's best move outside the zone for the user. */
  async tenuki(sessionId: string): Promise<void> {
    const s = this.load(sessionId)
    this.requireUserTurn(s)
    const turn = s.turn
    const color = s.toMove
    const outside = s.position.emptyVertices().filter((v) => !inZone(s.corner, v) && s.position.isLegal(color, v))
    let vertex: MoveVertex = 'pass'
    if (outside.length > 0) {
      const r = await this.d.engine.analyze({
        ...baseQuery(s.allMoves),
        maxVisits: this.d.config.analysis.endVisits,
        priority: 10,
        allowMoves: [{ player: color, moves: outside.map(vertexToGtp), untilDepth: 1 }],
      })
      const best = [...r.moveInfos].sort((a, b) => a.order - b.order)[0]
      if (best) vertex = gtpToVertex(best.move)
    }
    if (s.turn !== turn || !s.isPlaying) return
    this.commit(s, vertex, 'auto-tenuki')
  }

  finish(sessionId: string): void {
    const s = this.load(sessionId)
    if (!s.isPlaying) return
    s.finish(this.now())
    this.d.repo.setStatus(s.id, 'finished', s.record.finishedAt)
    this.publishState(s)
    this.d.onFinished(s.id)
  }

  continuePlaying(sessionId: string): void {
    const s = this.load(sessionId)
    s.declineEnd()
    this.publishState(s)
  }

  /** Re-sends the state and restarts work that may have been lost (analysis, bot move, review). */
  resync(sessionId: string): SessionView {
    const s = this.load(sessionId)
    if (s.isPlaying) {
      this.scheduleAnalysis(s)
      if (!s.isUserTurn) void this.runBot(s)
    } else if (s.record.status === 'finished' && this.d.repo.getSession(s.id)?.summary === null) {
      this.d.onFinished(s.id)
    }
    return s.view()
  }

  private create(settings: ResolvedSettings, initialMoves: Move[], parentSessionId: string | null): SessionView {
    const record: SessionRecord = {
      id: this.newId(),
      createdAt: this.now(),
      finishedAt: null,
      settings,
      status: 'playing',
      parentSessionId,
      initialMoves,
      moves: [],
      summary: null,
    }
    this.d.repo.insertSession(record)
    const s = new Session(record)
    this.active.set(s.id, s)
    this.afterPositionChanged(s)
    return s.view()
  }

  private commit(s: Session, vertex: MoveVertex, actor: Actor): void {
    const played = s.apply(vertex, actor)
    this.d.repo.insertMove(s.id, s.turn - 1, played)
    this.afterPositionChanged(s)
  }

  private afterPositionChanged(s: Session): void {
    if (s.turn >= this.d.config.maxSessionMoves) {
      this.finish(s.id)
      return
    }
    this.publishState(s)
    this.scheduleAnalysis(s)
    if (!s.isUserTurn) void this.runBot(s)
  }

  private scheduleAnalysis(s: Session): void {
    const t = s.turn
    const started = s.josekiStarted
    this.d.analysis
      .position(s.record, t)
      .then(async (a) => {
        if (!started || s.turn !== t || !s.isPlaying) return
        const b = await this.d.analysis.passProbe(s.record, t)
        if (s.turn === t && s.canProposeEnd() && shouldProposeEnd(a, b, s.corner)) {
          s.proposeEnd()
          this.publishState(s)
        }
      })
      .catch((err: unknown) => this.d.publish(s.id, toErrorMessage(err)))
  }

  private async runBot(s: Session): Promise<void> {
    if (s.botThinking || !s.isPlaying || s.isUserTurn) return
    s.botThinking = true
    this.publishState(s)
    const t = s.turn
    try {
      const vertex = await this.d.bot.chooseMove({
        moves: s.allMoves,
        position: s.position,
        color: s.toMove,
        corner: s.corner,
        josekiStarted: s.josekiStarted,
        rank: s.record.settings.botRank,
        temperature: this.d.config.bot.temperature,
      })
      s.botThinking = false
      if (s.turn !== t || !s.isPlaying) {
        this.publishState(s)
        return
      }
      this.commit(s, vertex, 'bot')
    } catch (err) {
      s.botThinking = false
      this.publishState(s)
      this.d.publish(s.id, toErrorMessage(err))
    }
  }

  private load(sessionId: string): Session {
    const cached = this.active.get(sessionId)
    if (cached) return cached
    const rec = this.d.repo.getSession(sessionId)
    if (!rec) throw new SessionError('Тренировка не найдена', 'session_not_found')
    const s = new Session(rec)
    this.active.set(sessionId, s)
    return s
  }

  private requireUserTurn(s: Session): void {
    if (!s.isPlaying) throw new SessionError('Тренировка уже закончена', 'session_finished')
    if (!s.isUserTurn || s.botThinking) throw new SessionError('Сейчас ход бота', 'not_your_turn')
  }

  private publishState(s: Session): void {
    this.d.publish(s.id, { type: 'sessionState', session: s.view() })
  }
}
