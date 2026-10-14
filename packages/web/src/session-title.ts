import type { Mode, ResolvedSettings, StartRef } from '@joseki-dojo/shared'

/** The captions of the review's actions: a new game with the same settings and the way back to the start screen. */
export interface ReviewLabels {
  next: string
  back: string
}

/** Starts spec 5.4: «Из списка» plays the same node again and goes back to the tree; the other modes go on to a new game. */
export function reviewLabels(mode: Mode): ReviewLabels {
  return mode === 'list' ? { next: 'Играть позицию заново', back: 'К выбору позиции' } : { next: 'Следующая позиция', back: 'К выбору тренировки' }
}

/** Starts spec 5.4: a listed start goes with its group, since the same name can stand in two groups; null when unnamed. */
function startName(start: StartRef): string | null {
  if (start.name === null) return null
  return start.group ? `${start.group} · ${start.name}` : start.name
}

/** The crumb of a game: a start session is named after its position; the other modes keep their names. */
export function sessionTitle(settings: ResolvedSettings): string {
  if (settings.start) return startName(settings.start) ?? 'Случайная позиция'
  return settings.mode === 'traps' ? 'Ловушка' : 'Свободная тренировка'
}

/** The crumb of a review; only here a dubious start says so. */
export function reviewTitle(settings: ResolvedSettings): string {
  const start = settings.start
  if (!start) return 'Разбор тренировки'
  return `Разбор: ${startName(start) ?? (start.dubious ? 'случайная позиция (ход соперника похуже)' : 'случайная позиция')}`
}
