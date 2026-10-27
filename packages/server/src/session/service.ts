import { randomUUID } from 'node:crypto'
import {
  CORNERS,
  gtpToVertex,
  inZone,
  isBotRank,
  sameVertex,
  vertexToGtp,
  type Actor,
  type Move,
  type MoveVertex,
  type ResolvedSettings,
  type ServerMessage,
  type StartRef,
  type Mode,
  type TrapRef,
  type SessionSettings,
  type SessionView,
  type Vertex,
} from '@joseki-dojo/shared'
import type { AnalysisScheduler } from '../analysis/scheduler'
import type { BotGuide, MoveChooser } from '../bot/bot'
import { StrongBot, type StrongChooser } from '../bot/strong'
import type { Rng } from '../bot/rng'
import type { AppConfig } from '../config'
import type { AnalysisEngine } from '../engine/engine'
import { baseQuery } from '../engine/query'
import { toErrorMessage } from '../errors'
import { fromTopRight, mirrorDiagonal } from '../jdb'
import { trapReview } from '../review/trap'
import { StartBook, type ListStart } from '../starts/book'
import { TrapBook } from '../traps/book'
import { movesBefore, type SessionRecord } from '../store/records'
import type { SessionRepo } from '../store/repo'
import type { GraphStart, TrainerService } from '../trainer/service'
import { Session, SessionError } from './session'

type Trainer = Pick<TrainerService, 'randomStart' | 'queueStart' | 'guideFor'>

export interface SessionServiceDeps {
  repo: SessionRepo
  analysis: AnalysisScheduler
  bot: MoveChooser
  /** The strong replies of the traps mode; default: a `StrongBot` on `engine`. */
  strong?: StrongChooser
  /** The traps base; default: an empty book (the traps mode is unavailable). */
  traps?: TrapBook
  /** The start positions; default: an empty book (the start modes are unavailable). */
  starts?: StartBook
  /** Part 3 spec 5: the deep starts of «Случайно» and the queue and the bot's guide on their way; default: none, the starts as before. */
  trainer?: Trainer
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

const MODES: readonly Mode[] = ['free', 'traps', 'random', 'list']

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** A start's name and group on the list (StartRef), from its list entry; no name for a start off the list. */
const nameOf = (named: ListStart | null): Pick<StartRef, 'name' | 'group'> => ({ name: named?.name ?? null, ...(named?.group ? { group: named.group } : {}) })

export function validateSettings(s: SessionSettings): void {
  const ok =
    MODES.includes(s.mode) &&
    s.environment === 'empty' &&
    (s.userColor === 'B' || s.userColor === 'W' || s.userColor === 'random') &&
    typeof s.botRank === 'string' &&
    isBotRank(s.botRank) &&
    (s.corner === 'random' || CORNERS.includes(s.corner)) &&
    (s.mode !== 'list' || (typeof s.startId === 'string' && s.startId !== '')) &&
    // Part 3 spec 6.3: the queue starts a list position for a colour it knows.
    (s.queue === undefined || s.queue === false || (s.queue === true && s.mode === 'list' && s.userColor !== 'random'))
  if (!ok) throw new SessionError({ key: 'error.settings.invalid' }, 'bad_request')
}

export class SessionService {
  private readonly active = new Map<string, Session>()
  private readonly rng: Rng
  private readonly newId: () => string
  private readonly now: () => string
  private readonly strong: StrongChooser
  private readonly traps: TrapBook
  private readonly starts: StartBook
  private readonly log: (line: string) => void
  /** Sessions whose trap the book no longer knows (logged once each). */
  private readonly missingTrap = new Set<string>()

  constructor(private readonly d: SessionServiceDeps) {
    this.strong = d.strong ?? new StrongBot(d.engine)
    this.traps = d.traps ?? TrapBook.empty()
    this.starts = d.starts ?? StartBook.empty()
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
    if (resolved.mode === 'random' || resolved.mode === 'list') return this.startPosition(resolved, settings.startId, settings.queue === true)
    return this.create(resolved, [], null)
  }

  private startTrap(resolved: ResolvedSettings): SessionView {
    const unavailable = new SessionError({ key: 'error.traps.unavailable' }, 'bad_request')
    if (this.traps.count === 0) throw unavailable
    const shows = this.d.repo.trapShows()
    const id = this.traps.pick((t) => shows.get(t) ?? 0, this.rng)
    if (id === null) throw unavailable
    const mirror = this.rng() < 0.5
    const { initialMoves, placement } = this.traps.place(id, resolved.corner, resolved.userColor, mirror)
    const trap: TrapRef = { id, index: initialMoves.length, mirror, swapColors: placement.swapColors }
    return this.create({ ...resolved, trap }, initialMoves, null)
  }

  /**
   * Spec (starts) 5.2–5.3: a start from the list or picked by shows, put in the corner; the bot moves first when it is its
   * turn. Part 3 spec 5.1: with weights for the player's level, «Случайно» and the queue's training of a list position
   * (`queue`) start deeper in the graph; without them, or with nothing to lead to, they start as before. «Случайно» keeps
   * its share of dubious starts: the share is drawn first, as StartBook.pick draws it, and the trainer chooses the others.
   */
  private startPosition(resolved: ResolvedSettings, startId: string | undefined, queue: boolean): SessionView {
    if (this.starts.count === 0) throw new SessionError({ key: 'error.starts.unavailable' }, 'bad_request')
    let id: string | null
    let named: ListStart | null = null
    if (resolved.mode === 'list') {
      named = startId === undefined ? null : this.starts.listStart(startId)
      if (startId === undefined || !named) throw new SessionError({ key: 'error.starts.notOnList' }, 'bad_request')
      const deep = queue ? this.deepStart('the queue start', (t) => t.queueStart(startId, resolved.userColor)) : null
      if (deep) return this.startDeep(resolved, deep)
      id = startId
    } else {
      const dubious = this.starts.drawDubious(this.rng)
      const deep = dubious ? null : this.deepStart('the random start', (t) => t.randomStart(resolved.userColor))
      if (deep) return this.startDeep(resolved, deep)
      const shows = this.d.repo.startShows()
      id = this.starts.pick((s) => shows.get(s) ?? 0, this.rng, dubious)
    }
    if (id === null) throw new SessionError({ key: 'error.starts.unavailable' }, 'bad_request')
    const mirror = this.rng() < 0.5
    const dubious = this.starts.isDubious(id)
    // Spec (starts) 5.2: after a dubious move the user answers at once — swap the colours when the user chose the side that played it.
    const swapColors = dubious && this.starts.lastColor(id) === resolved.userColor
    const initialMoves = this.starts.place(id, resolved.corner, mirror, swapColors)
    // «Случайно» names a start only by the list positions: a branch can share the moves of an unnamed start of the base.
    if (!named && this.starts.isListed(id)) named = this.starts.listStart(id)
    const start: StartRef = { id, ...nameOf(named), mirror, ...(dubious ? { dubious: true, swapColors } : {}) }
    return this.create({ ...resolved, start }, initialMoves, null)
  }

  /** Part 3 spec 5: the trainer's deep start; null without a trainer, and when it fails (logged): the start is chosen as before. */
  private deepStart(what: string, get: (trainer: Trainer) => GraphStart | null): GraphStart | null {
    if (!this.d.trainer) return null
    try {
      return get(this.d.trainer)
    } catch (err) {
      this.log(`trainer: ${what} failed, the start is chosen as before: ${messageOf(err)}`)
      return null
    }
  }

  /**
   * Part 3 spec 5.3–5.5: a deep start's setup put in the corner, mirrored on the coin, colours from Black (the player's
   * colour is its role), a tenuki as a pass; its path kept as the graph's keys, which no corner or mirror changes. It is
   * named by the deepest list position on its way.
   */
  private startDeep(resolved: ResolvedSettings, deep: GraphStart): SessionView {
    const mirror = this.rng() < 0.5
    const onBoard = (m: Vertex): Vertex => fromTopRight(mirror ? mirrorDiagonal(m) : m, resolved.corner)
    const initialMoves = deep.setup.map((m, i): Move => ({ color: i % 2 === 0 ? 'B' : 'W', vertex: m === 'tenuki' ? 'pass' : onBoard(m) }))
    const graph = { setup: initialMoves.length, path: deep.path, leave: deep.leave }
    const start: StartRef = { id: deep.nameId, ...nameOf(this.starts.listStart(deep.nameId)), mirror, graph }
    return this.create({ ...resolved, start }, initialMoves, null)
  }

  replayFrom(sessionId: string, turn: number): SessionView {
    const parent = this.load(sessionId)
    if (!Number.isInteger(turn) || turn < 0 || turn > parent.turn) throw new SessionError({ key: 'error.turn.notFound' }, 'bad_request')
    return this.create(parent.record.settings, movesBefore(parent.record, turn), parent.id)
  }

  view(sessionId: string): SessionView {
    return this.load(sessionId).view()
  }

  playUserMove(sessionId: string, vertex: Vertex): void {
    const s = this.load(sessionId)
    this.requireUserTurn(s)
    if (!inZone(s.corner, vertex)) throw new SessionError({ key: 'error.move.outsideZone' }, 'outside_zone')
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

  /** `guided`: the bot played its guide's move on a deep start's way (part 3 spec 5.4). */
  private commit(s: Session, vertex: MoveVertex, actor: Actor, guided = false): void {
    const played = s.apply(vertex, actor)
    this.d.repo.insertMove(s.id, s.turn - 1, played)
    // Spec 8.5: the bot leaving the corner ends the joseki (or is its mistake to punish); the text is the same either way.
    // Part 3 spec 5.4: not after a guided move — the bot's tenuki on the path and its leaving move at the target are the variation's.
    if (actor === 'bot' && !guided && !played.inZone && s.canProposeEnd()) s.proposeEnd()
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
      const { vertex, guided } = await this.botMove(s)
      s.botThinking = false
      if (s.turn !== t || !s.isPlaying) {
        this.publishState(s)
        return
      }
      this.commit(s, vertex, 'bot', guided)
    } catch (err) {
      s.botThinking = false
      this.publishState(s)
      this.d.publish(s.id, toErrorMessage(err))
    }
  }

  /**
   * The bot's move: the scripted trick, a strong zone reply after it, or the human-like move, guided on a deep start's
   * path; `guided` when the bot played its guide's move (it plays its own when the guide's is not legal).
   */
  private async botMove(s: Session): Promise<{ vertex: MoveVertex; guided: boolean }> {
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
        return { vertex: trick.vertex, guided: false }
      }
      if (n === trap.index + 2 || n === trap.index + 4 || n === trap.index + 6) {
        return { vertex: await this.strong.chooseMove({ ...req, visits: this.d.config.analysis.reviewVisits }), guided: false }
      }
    }
    // Part 3 spec 5.4: never in a trap.
    const guide = trap ? null : this.guideOf(s)
    if (!guide) return { vertex: await this.d.bot.chooseMove(req), guided: false }
    const offered: { move: MoveVertex | null } = { move: null }
    const vertex = await this.d.bot.chooseMove({ ...req, guide: (natural, rng) => (offered.move = guide(natural, rng)) })
    return { vertex, guided: offered.move !== null && sameVertex(offered.move, vertex) }
  }

  /**
   * Part 3 spec 5.4: the trainer's guide for the bot's move, or null. A trainer that fails is logged and the bot plays as
   * without a guide: a throw of guideFor gives no guide, a throw of the guide gives null (after any draw it made).
   */
  private guideOf(s: Session): BotGuide | null {
    let guide: BotGuide | null
    try {
      guide = this.d.trainer?.guideFor(s.record) ?? null
    } catch (err) {
      this.log(`trainer: no guide for session ${s.id}, the bot plays unguided: ${messageOf(err)}`)
      return null
    }
    if (!guide) return null
    const trainerGuide = guide
    return (natural, rng) => {
      try {
        return trainerGuide(natural, rng)
      } catch (err) {
        this.log(`trainer: the guide of session ${s.id} failed, the bot plays unguided: ${messageOf(err)}`)
        return null
      }
    }
  }

  private load(sessionId: string): Session {
    const cached = this.active.get(sessionId)
    if (cached) return cached
    const rec = this.d.repo.getSession(sessionId)
    if (!rec) throw new SessionError({ key: 'error.session.notFound' }, 'session_not_found')
    const s = new Session(rec)
    this.active.set(sessionId, s)
    return s
  }

  private requireUserTurn(s: Session): void {
    if (!s.isPlaying) throw new SessionError({ key: 'error.session.finished' }, 'session_finished')
    if (!s.isUserTurn || s.botThinking) throw new SessionError({ key: 'error.move.notYourTurn' }, 'not_your_turn')
  }

  private publishState(s: Session): void {
    this.d.publish(s.id, { type: 'sessionState', session: s.view() })
  }
}
