import type { ReviewData, ServerMessage } from '@joseki-dojo/shared'
import type { AnalysisScheduler } from '../analysis/scheduler'
import type { CardService } from '../cards/service'
import type { AppConfig, Thresholds } from '../config'
import type { GraphProgressService } from '../progress/service'
import { TrapBook } from '../traps/book'
import { SessionError } from '../session/session'
import type { SessionRecord, StoredAnalysis } from '../store/records'
import type { SessionRepo } from '../store/repo'
import { thresholdsFor, type ThresholdTable } from './thresholds'
import { buildReview, missedPunishmentRows } from './compute'
import { trapReview } from './trap'

export type ReviewResult = { status: 'ok'; review: ReviewData } | { status: 'not_found' } | { status: 'not_ready' }

export interface ReviewServiceDeps {
  repo: SessionRepo
  analysis: AnalysisScheduler
  config: AppConfig
  publish: (sessionId: string, msg: ServerMessage) => void
  /** The traps base for the trap block; default: an empty book. */
  traps?: TrapBook
  /** Spec (repetition) 3.2: the calibrated table; null — the config thresholds. */
  thresholds?: ThresholdTable | null
  /** Spec (repetition) 4.2, 5.3. */
  cards?: CardService
  /** Spec (progress part 2) 3.4: the graph cards. */
  progress?: GraphProgressService
  now?: () => string
  /** One-line diagnostics; the card hooks log here instead of breaking the review. */
  log?: (line: string) => void
}

export class ReviewService {
  private readonly now: () => string
  private readonly running = new Map<string, Promise<ReviewData>>()

  constructor(private readonly d: ReviewServiceDeps) {
    this.now = d.now ?? (() => new Date().toISOString())
  }

  /** Spec 9.1: analyses positions that lack a full analysis, then stores the summary and missed punishments. */
  prepare(sessionId: string): Promise<ReviewData> {
    const inFlight = this.running.get(sessionId)
    if (inFlight) return inFlight
    const run = this.run(sessionId).finally(() => this.running.delete(sessionId))
    this.running.set(sessionId, run)
    return run
  }

  private async run(sessionId: string): Promise<ReviewData> {
    const rec = this.d.repo.getSession(sessionId)
    if (!rec) throw new SessionError({ key: 'error.session.notFound' }, 'session_not_found')
    const total = rec.moves.length + 1
    let done = 0
    const progress = (): void => this.d.publish(sessionId, { type: 'analysisProgress', sessionId, done, total })
    progress()
    const analyses = await Promise.all(
      Array.from({ length: total }, (_, t) =>
        this.d.analysis.position(rec, t).then((a) => {
          done++
          progress()
          return a
        }),
      ),
    )
    const review = this.assemble(rec, analyses)
    this.d.repo.saveSummary(sessionId, review.summary)
    this.d.repo.replaceMissedPunishments(sessionId, missedPunishmentRows(review), this.now())
    try {
      this.d.cards?.recordTraining(rec, review)
    } catch (err) {
      this.d.log?.(`card hook failed for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`)
    }
    try {
      this.d.progress?.recordTraining(rec, review)
    } catch (err) {
      this.d.log?.(`graph card hook failed for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`)
    }
    this.d.publish(sessionId, { type: 'reviewReady', sessionId })
    return this.withCards(review)
  }

  get(sessionId: string): ReviewResult {
    const rec = this.d.repo.getSession(sessionId)
    if (!rec) return { status: 'not_found' }
    const analyses: StoredAnalysis[] = []
    for (let t = 0; t <= rec.moves.length; t++) {
      const row = this.d.repo.getAnalysis(sessionId, t, 'position')
      if (!row || row.visits < this.d.config.analysis.reviewVisits) return { status: 'not_ready' }
      analyses.push(row.analysis)
    }
    return { status: 'ok', review: this.withCards(this.assemble(rec, analyses)) }
  }

  /**
   * Spec (progress part 2) 5: the review of a training at other thresholds, from its moves and the analyses stored for
   * it; null when the session or one of its analyses is no longer in the database.
   */
  rebuild(sessionId: string, thresholds: Thresholds): ReviewData | null {
    const rec = this.d.repo.getSession(sessionId)
    if (!rec) return null
    const analyses: StoredAnalysis[] = []
    for (let t = 0; t <= rec.moves.length; t++) {
      const row = this.d.repo.getAnalysis(sessionId, t, 'position')
      if (!row) return null
      analyses.push(row.analysis)
    }
    return this.assemble(rec, analyses, thresholds)
  }

  /** Spec (repetition) 5.3: the card repetition of this training, if any; part 3 spec 7: the progress it gained, if any. */
  private withCards(review: ReviewData): ReviewData {
    const { sessionId } = review
    const repetition = this.lookup('card', sessionId, () => this.d.cards?.repetitionOf(sessionId))
    const progress = this.lookup('progress', sessionId, () => this.d.progress?.deltaOf(sessionId))
    return { ...review, ...(repetition ? { repetition } : {}), ...(progress ? { progress } : {}) }
  }

  /** A lookup that never breaks the review: a failure is logged and gives nothing. */
  private lookup<T>(what: string, sessionId: string, find: () => T | null | undefined): T | null {
    try {
      return find() ?? null
    } catch (err) {
      this.d.log?.(`${what} lookup failed for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /** The review at `thresholds`, by default the player level's. */
  private assemble(rec: SessionRecord, analyses: StoredAnalysis[], thresholds = thresholdsFor(this.d.config.player.level, this.d.thresholds ?? null, this.d.config.thresholds)): ReviewData {
    return buildReview({
      sessionId: rec.id,
      settings: rec.settings,
      initialMoves: rec.initialMoves,
      moves: rec.moves,
      analyses,
      thresholds,
      trap: trapReview(rec.settings, rec.initialMoves.length, rec.moves, this.d.traps ?? TrapBook.empty()),
    })
  }
}
