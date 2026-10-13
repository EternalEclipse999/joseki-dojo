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
  type TrapRef,
  type SessionSettings,
  type SessionView,
  type Vertex,
} from '@joseki-dojo/shared'
import type { AnalysisScheduler } from '../analysis/scheduler'
import type { MoveChooser } from '../bot/bot'
import { StrongBot, type StrongChooser } from '../bot/strong'
import type { Rng } from '../bot/rng'
import type { AppConfig } from '../config'
import type { AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import { toErrorMessage } from '../errors'
import { trapReview } from '../review/trap'
import { TrapBook } from '../traps/book'
import { movesBefore, type SessionRecord } from '../store/records'
import type { SessionRepo } from '../store/repo'
import { Session, SessionError } from './session'

export interface SessionServiceDeps {
  repo: SessionRepo
  analysis: AnalysisScheduler
  bot: MoveChooser
  /** The strong replies of the traps mode; default: a `StrongBot` on `engine`. */
  strong?: StrongChooser
  /** The traps base; default: an empty book (the traps mode is unavailable). */
  traps?: TrapBook
  engine: AnalysisEngine
  config: AppConfig
  publish: (sessionId: string, msg: ServerMessage) => void
  /** Starts the review of a finished session. */
  onFinished: (sessionId: string) => void
  /** Diagnostics for the operator (the same style as the engine and installer logs); default: silent. */
  log?: (line: string) => void
  rng?: Rng
  newId?: () => string
  now?: () => string
}

export function validateSettings(s: SessionSettings): void {
  const ok =
    (s.mode === 'free' || s.mode === 'traps') &&
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
  private readonly strong: StrongChooser
  private readonly traps: TrapBook
  private readonly log: (line: string) => void
  /** Sessions whose trap the book no longer knows (logged once each). */
  private readonly missingTrap = new Set<string>()

  constructor(private readonly d: SessionServiceDeps) {
    this.strong = d.strong ?? new StrongBot(d.engine)
    this.traps = d.traps ?? TrapBook.empty()
    this.log = d.log ?? (() => {})
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
    if (resolved.mode === 'traps') return this.startTrap(resolved)
    return this.create(resolved, [], null)
  }

  private startTrap(resolved: ResolvedSettings): SessionView {
    const unavailable = new SessionError('Ловушки недоступны: нет базы ловушек', 'bad_request')
    if (this.traps.count === 0) throw unavailable
    const shows = this.d.repo.trapShows()
    const id = this.traps.pick((t) => shows.get(t) ?? 0, this.rng)
    if (id === null) throw unavailable
    const mirror = this.rng() < 0.5
    const { initialMoves, placement } = this.traps.place(id, resolved.corner, resolved.userColor, mirror)
    const trap: TrapRef = { id, index: initialMoves.length, mirror, swapColors: placement.swapColors }
    return this.create({ ...resolved, trap }, initialMoves, null)
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
    this.d.repo.transaction(() => {
      this.d.repo.setStatus(s.id, 'finished', s.record.finishedAt)
      this.recordTrapAttempt(s)
    })
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

  /** One attempt row per finished traps session whose answer to the trick is among its own moves. */
  private recordTrapAttempt(s: Session): void {
    const { trap } = s.record.settings
    if (!trap) return
    const review = trapReview(s.record.settings, s.record.initialMoves.length, s.record.moves, this.traps)
    if (!review || review.verdict === null) return
    this.d.repo.insertTrapAttempt({ sessionId: s.id, trapId: trap.id, result: review.verdict, createdAt: this.now() })
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
    // Spec 8.5: the bot leaving the corner ends the joseki (or is its mistake to punish); the text is the same either way.
    if (actor === 'bot' && !played.inZone && s.canProposeEnd()) s.proposeEnd()
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

  /** Spec 8.5: every position is analysed in the background for the review. */
  private scheduleAnalysis(s: Session): void {
    this.d.analysis.position(s.record, s.turn).catch((err: unknown) => this.d.publish(s.id, toErrorMessage(err)))
  }

  private async runBot(s: Session): Promise<void> {
    if (s.botThinking || !s.isPlaying || s.isUserTurn) return
    s.botThinking = true
    this.publishState(s)
    const t = s.turn
    try {
      const vertex = await this.botVertex(s)
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

  /** The bot's move: the scripted trick, a strong zone reply after it, or the human-like move. */
  private botVertex(s: Session): Promise<MoveVertex> {
    const { trap } = s.record.settings
    const req = {
      moves: s.allMoves,
      position: s.position,
      color: s.toMove,
      corner: s.corner,
      josekiStarted: s.josekiStarted,
      rank: s.record.settings.botRank,
      temperature: this.d.config.bot.temperature,
    }
    // A base replaced since the session started may no longer know the trap: the bot plays as usual from then on.
    if (trap && !this.traps.has(trap.id)) {
      if (!this.missingTrap.has(s.id)) {
        this.missingTrap.add(s.id)
        this.log(`Ловушка ${trap.id} не найдена в базе, бот играет как обычно`)
      }
    } else if (trap) {
      const n = req.moves.length
      if (n === trap.index) {
        const { trick } = this.traps.place(trap.id, s.corner, s.userColor, trap.mirror)
        return Promise.resolve(trick.vertex)
      }
      if (n === trap.index + 2 || n === trap.index + 4 || n === trap.index + 6) {
        return this.strong.chooseMove({ ...req, visits: this.d.config.analysis.reviewVisits })
      }
    }
    return this.d.bot.chooseMove(req)
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
