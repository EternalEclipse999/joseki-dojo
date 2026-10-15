import type { Mode, ResolvedSettings, StartRef, Translate } from '@joseki-dojo/shared'
import { findById, type StartTreeNode } from './start-tree'

/** The captions of the review's actions: a new game with the same settings and the way back to the start screen. */
export interface ReviewLabels {
  next: string
  back: string
}

/** Starts spec 5.4: «Из списка» plays the same node again and goes back to the tree; the other modes go on to a new game. */
export function reviewLabels(mode: Mode, t: Translate): ReviewLabels {
  return mode === 'list' ? { next: t('review.replayPosition'), back: t('review.toPositions') } : { next: t('review.next'), back: t('review.toTrainings') }
}

/**
 * Languages spec 7: the name of a named start in the language of `tree`, while it is still on the list; undefined
 * otherwise, and the crumbs keep the saved (Russian) name. A start the server left unnamed stays so.
 */
export function listedName(tree: StartTreeNode, start: StartRef | undefined): string | undefined {
  if (!start || start.name === null) return undefined
  return findById(tree, start.id)?.name
}

/**
 * Starts spec 5.4: a listed start goes with its group, since the same name can stand in two groups; null when unnamed.
 * `name`, when given, is the position's name in the current language and stands in for the saved one.
 */
function startName(start: StartRef, name: string | null | undefined): string | null {
  const shown = name ?? start.name
  if (shown === null) return null
  return start.group ? `${start.group} · ${shown}` : shown
}

/** The crumb of a game: a start session is named after its position; the other modes keep their names. */
export function sessionTitle(settings: ResolvedSettings, t: Translate, name?: string | null): string {
  if (settings.start) return startName(settings.start, name) ?? t('game.crumb.random')
  return t(settings.mode === 'traps' ? 'game.crumb.traps' : 'game.crumb.free')
}

/** The crumb of a review; only here a dubious start says so. */
export function reviewTitle(settings: ResolvedSettings, t: Translate, name?: string | null): string {
  const start = settings.start
  if (!start) return t('review.crumb.training')
  const named = startName(start, name)
  if (named !== null) return t('review.crumb.named', { name: named })
  return t(start.dubious ? 'review.crumb.randomDubious' : 'review.crumb.random')
}
