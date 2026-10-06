import {
  colorSign,
  gtpToVertex,
  type Candidate,
  type Category,
  type Color,
  type Move,
  type MoveReview,
  type PlayedMove,
  type PositionReview,
  type PunishmentEvent,
  type ResolvedSettings,
  type ReviewData,
  type ReviewSummary,
} from '@joseki-dojo/shared'
import type { Thresholds } from '../config'
import type { MissedPunishmentRow, StoredAnalysis } from '../store/records'

export function categorize(loss: number, th: Thresholds): Category {
  if (loss >= th.blunder) return 'blunder'
  if (loss >= th.mistake) return 'mistake'
  if (loss >= th.inaccuracy) return 'inaccuracy'
  return 'exact'
}

/** Spec 9.2. `leadsBlack[t]` is the root scoreLead (Black's view) of position t; length moves.length + 1. */
export function moveLosses(leadsBlack: readonly number[], moves: readonly PlayedMove[]): number[] {
  return moves.map((m, t) => Math.max(0, colorSign(m.color) * (leadsBlack[t] - leadsBlack[t + 1])))
}

/** Up to `limit` engine candidates; losses are measured inside the same search against order 0. */
export function candidatesOf(a: StoredAnalysis, limit = 3): Candidate[] {
  const sorted = [...a.moveInfos].sort((x, y) => x.order - y.order)
  const best = sorted[0]
  if (!best) return []
  const sign = colorSign(a.rootInfo.currentPlayer)
  return sorted.slice(0, limit).map((mi) => ({
    vertex: gtpToVertex(mi.move),
    loss: Math.max(0, sign * (best.scoreLead - mi.scoreLead)),
    pv: mi.pv.map(gtpToVertex),
  }))
}

/** Spec 9.5: every bot mistake followed by a user reply. */
export function findPunishments(
  moves: readonly PlayedMove[],
  losses: readonly number[],
  userColor: Color,
  th: Thresholds,
): PunishmentEvent[] {
  const events: PunishmentEvent[] = []
  moves.forEach((m, t) => {
    if (m.actor !== 'bot' || losses[t] < th.mistake) return
    const reply = moves[t + 1]
    if (!reply || reply.color !== userColor) return
    const userLoss = losses[t + 1]
    const returned = Math.min(userLoss, losses[t])
    events.push({ turn: t, botLoss: losses[t], userLoss, punished: userLoss < th.punished, kept: losses[t] - returned })
  })
  return events
}

export function summarize(
  moves: readonly PlayedMove[],
  losses: readonly number[],
  events: readonly PunishmentEvent[],
  userColor: Color,
): ReviewSummary {
  return {
    userLoss: moves.reduce((sum, m, t) => (m.color === userColor ? sum + losses[t] : sum), 0),
    botMistakes: events.length,
    botMistakeLoss: events.reduce((sum, e) => sum + e.botLoss, 0),
    punished: events.filter((e) => e.punished).length,
    keptPoints: events.reduce((sum, e) => sum + e.kept, 0),
  }
}

export interface ReviewInput {
  sessionId: string
  settings: ResolvedSettings
  initialMoves: Move[]
  moves: PlayedMove[]
  /** Position analyses 0..moves.length. */
  analyses: StoredAnalysis[]
  thresholds: Thresholds
}

export function buildReview(input: ReviewInput): ReviewData {
  const { moves, analyses, thresholds } = input
  if (analyses.length !== moves.length + 1) {
    throw new Error(`Expected ${moves.length + 1} analyses, got ${analyses.length}`)
  }
  const losses = moveLosses(analyses.map((a) => a.rootInfo.scoreLead), moves)
  const positions: PositionReview[] = analyses.map((a, turn) => ({
    turn,
    scoreLeadBlack: a.rootInfo.scoreLead,
    candidates: candidatesOf(a),
    ownership: a.ownership,
  }))
  const moveReviews: MoveReview[] = moves.map((m, turn) => ({
    turn,
    color: m.color,
    actor: m.actor,
    vertex: m.vertex,
    loss: losses[turn],
    category: categorize(losses[turn], thresholds),
  }))
  const punishments = findPunishments(moves, losses, input.settings.userColor, thresholds)
  return {
    sessionId: input.sessionId,
    settings: input.settings,
    initialMoves: input.initialMoves,
    moves,
    positions,
    moveReviews,
    punishments,
    summary: summarize(moves, losses, punishments, input.settings.userColor),
  }
}

export function missedPunishmentRows(review: ReviewData): MissedPunishmentRow[] {
  return review.punishments
    .filter((e) => !e.punished)
    .map((e) => {
      const best = review.positions[e.turn + 1].candidates[0]
      return {
        turn: e.turn,
        botMove: review.moves[e.turn].vertex,
        botLoss: e.botLoss,
        userMove: review.moves[e.turn + 1].vertex,
        userLoss: e.userLoss,
        bestMove: best?.vertex ?? 'pass',
        bestPv: best?.pv ?? [],
      }
    })
}
