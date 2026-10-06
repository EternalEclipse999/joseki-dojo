import type { AnalysisResponse } from '../engine/katago-types'
import type { StoredAnalysis } from '../store/records'

export const STORED_MOVE_INFOS = 5

export function compactAnalysis(r: AnalysisResponse): StoredAnalysis {
  const moveInfos = [...r.moveInfos]
    .sort((a, b) => a.order - b.order)
    .slice(0, STORED_MOVE_INFOS)
    .map(({ move, order, visits, scoreLead, winrate, pv }) => ({ move, order, visits, scoreLead, winrate, pv }))
  const { currentPlayer, scoreLead, winrate, visits } = r.rootInfo
  return { rootInfo: { currentPlayer, scoreLead, winrate, visits }, moveInfos, ownership: r.ownership ?? null }
}
