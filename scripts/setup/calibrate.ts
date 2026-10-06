import type { Move } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../../packages/server/src/engine/engine'
import { baseQuery } from '../../packages/server/src/engine/query'

/** Spec 6.4: about `seconds` per reviewed position; the end check uses half of that. */
export function visitsForBudget(visitsPerSecond: number, seconds = 2): { reviewVisits: number; endVisits: number } {
  const to50 = (n: number): number => Math.round(n / 50) * 50
  const reviewVisits = Math.min(5000, Math.max(100, to50(visitsPerSecond * seconds)))
  const endVisits = Math.min(2500, Math.max(50, to50(reviewVisits / 2)))
  return { reviewVisits, endVisits }
}

const SAMPLE: Move[] = [
  { color: 'B', vertex: [15, 3] },
  { color: 'W', vertex: [3, 15] },
  { color: 'B', vertex: [2, 3] },
  { color: 'W', vertex: [16, 5] },
]

export async function measureVisitsPerSecond(engine: AnalysisEngine, visits = 800): Promise<number> {
  // Warm up on a different position so the timed search does not hit the NN cache (and OpenCL is tuned).
  await engine.analyze({ ...baseQuery([]), maxVisits: 100 })
  const started = performance.now()
  const r = await engine.analyze({ ...baseQuery(SAMPLE), maxVisits: visits })
  const seconds = (performance.now() - started) / 1000
  return r.rootInfo.visits / Math.max(seconds, 0.001)
}
