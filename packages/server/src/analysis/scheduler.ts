import { nextColor } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../engine/engine'
import type { KataGoQueryBody } from '../engine/katago-types'
import { baseQuery } from '../engine/query'
import { movesBefore, type AnalysisKind, type SessionRecord, type StoredAnalysis } from '../store/records'
import type { SessionRepo } from '../store/repo'
import { compactAnalysis } from './compact'

/**
 * Runs and caches the two analyses of a session position:
 * - `position`: the position itself, `reviewVisits`, with ownership (review + end check);
 * - `pass_probe`: the position after a pass by the side to move, `endVisits` (end check only).
 * A stored result with enough visits is reused; concurrent requests share one query.
 */
export class AnalysisScheduler {
  private readonly inflight = new Map<string, Promise<StoredAnalysis>>()

  constructor(
    private readonly engine: AnalysisEngine,
    private readonly repo: SessionRepo,
    private readonly visits: { reviewVisits: number; endVisits: number },
  ) {}

  position(rec: SessionRecord, t: number): Promise<StoredAnalysis> {
    return this.run(rec, t, 'position')
  }

  passProbe(rec: SessionRecord, t: number): Promise<StoredAnalysis> {
    return this.run(rec, t, 'pass_probe')
  }

  private run(rec: SessionRecord, t: number, kind: AnalysisKind): Promise<StoredAnalysis> {
    const key = `${rec.id}:${t}:${kind}`
    const running = this.inflight.get(key)
    if (running) return running
    const visits = kind === 'position' ? this.visits.reviewVisits : this.visits.endVisits
    const stored = this.repo.getAnalysis(rec.id, t, kind)
    if (stored && stored.visits >= visits) return Promise.resolve(stored.analysis)
    const moves = movesBefore(rec, t)
    const query: KataGoQueryBody =
      kind === 'position'
        ? { ...baseQuery(moves), maxVisits: visits, includeOwnership: true }
        : { ...baseQuery([...moves, { color: nextColor(moves), vertex: 'pass' }]), maxVisits: visits }
    const job = this.engine
      .analyze(query)
      .then((r) => {
        const analysis = compactAnalysis(r)
        this.repo.saveAnalysis(rec.id, t, kind, visits, analysis)
        return analysis
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, job)
    return job
  }
}
