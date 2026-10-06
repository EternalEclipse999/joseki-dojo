import type { ReviewData, ServerMessage } from '@joseki-dojo/shared'
import type { AnalysisScheduler } from '../analysis/scheduler'
import type { AppConfig } from '../config'
import { SessionError } from '../session/session'
import type { SessionRecord, StoredAnalysis } from '../store/records'
import type { SessionRepo } from '../store/repo'
import { buildReview, missedPunishmentRows } from './compute'

export type ReviewResult = { status: 'ok'; review: ReviewData } | { status: 'not_found' } | { status: 'not_ready' }

export interface ReviewServiceDeps {
  repo: SessionRepo
  analysis: AnalysisScheduler
  config: AppConfig
  publish: (sessionId: string, msg: ServerMessage) => void
  now?: () => string
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
    if (!rec) throw new SessionError('Тренировка не найдена', 'session_not_found')
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
    this.d.publish(sessionId, { type: 'reviewReady', sessionId })
    return review
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
    return { status: 'ok', review: this.assemble(rec, analyses) }
  }

  private assemble(rec: SessionRecord, analyses: StoredAnalysis[]): ReviewData {
    return buildReview({
      sessionId: rec.id,
      settings: rec.settings,
      initialMoves: rec.initialMoves,
      moves: rec.moves,
      analyses,
      thresholds: this.d.config.thresholds,
    })
  }
}
