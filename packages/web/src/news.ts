import type { NewsId, NewsView } from '@joseki-dojo/shared'

export type NewsAction = 'seen' | 'dismiss'

/** Spec (whats-new) 3.4: what the app highlights — the marks, and the callout of the startup load only. */
export interface NewsShown {
  unseen: readonly NewsId[]
  callout: NewsId | null
}

export const NO_NEWS: NewsShown = { unseen: [], callout: null }

export const fromStartup = (v: NewsView): NewsShown => ({ unseen: v.unseen, callout: v.callout })

/**
 * After `seen` or `dismiss`: with no answer yet (or a failed one) the action applies locally; an answer sets the marks.
 * Either way the callout is gone for this run (spec 2.2: one callout per run).
 */
export function afterAction(shown: NewsShown, id: NewsId, action: NewsAction, answer: NewsView | null): NewsShown {
  if (answer) return { unseen: answer.unseen, callout: null }
  return { unseen: action === 'seen' ? shown.unseen.filter((x) => x !== id) : shown.unseen, callout: null }
}
