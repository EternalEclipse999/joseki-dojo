/**
 * Spec (whats-new) 3.1: the app's novelties in waves. A novelty is new for a player whose install predates its wave;
 * the next novelty takes the next wave. A wave is not an app version: versions are set by hand at release.
 */
export const NEWS = [{ id: 'repetition', wave: 1 }] as const

export type NewsId = (typeof NEWS)[number]['id']

export const NEWS_IDS: readonly NewsId[] = NEWS.map((n) => n.id)

export const isNewsId = (v: unknown): v is NewsId => typeof v === 'string' && (NEWS_IDS as readonly string[]).includes(v)

/** Spec (whats-new) 3.3: what `GET /api/news` returns: the novelties to mark, and the callout to show first. */
export interface NewsView {
  unseen: NewsId[]
  callout: NewsId | null
}
