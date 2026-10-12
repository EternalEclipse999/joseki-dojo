import { BOT_RANKS } from '@joseki-dojo/shared'

/** The slider position of a rank (0 = the weakest); an unknown rank is the weakest. */
export const rankIndex = (rank: string): number => Math.max(0, BOT_RANKS.indexOf(rank))

/** The rank at a slider position, clamped to the list. */
export const rankAt = (index: number): string => BOT_RANKS[Math.min(BOT_RANKS.length - 1, Math.max(0, Math.round(index)))]

/** Marks under the slider: the weakest rank, 1 dan and the strongest, at their share of the track (0..1). */
export const RANK_MARKS: { rank: string; at: number }[] = [BOT_RANKS[0], '1d', BOT_RANKS[BOT_RANKS.length - 1]].map((rank) => ({
  rank,
  at: rankIndex(rank) / (BOT_RANKS.length - 1),
}))
