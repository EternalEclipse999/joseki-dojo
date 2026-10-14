import { vertexToGtp, type Actor, type Category, type Color, type Corner, type MoveVertex } from '@joseki-dojo/shared'

export const formatPoints = (n: number): string => {
  const text = n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  // Values that round to zero must not print a sign ("-0,0").
  return text.replace(/^[-−]0,0$/, '0,0')
}

/** Visit counts with grouped thousands: «1 200». */
export const formatCount = (n: number): string => Math.round(n).toLocaleString('ru-RU')

export const moveLabel = (v: MoveVertex): string => (v === 'pass' ? 'пас' : vertexToGtp(v))

export const rankLabel = (rank: string): string =>
  rank.endsWith('k') ? `${rank.slice(0, -1)} кю` : `${rank.slice(0, -1)} дан`

export const colorLabel = (c: Color): string => (c === 'B' ? 'чёрные' : 'белые')

export const CATEGORY_LABEL: Record<Category, string> = {
  exact: 'точно',
  inaccuracy: 'неточность',
  mistake: 'ошибка',
  blunder: 'грубая ошибка',
}

export const CORNER_LABEL: Record<Corner, string> = {
  TL: 'левый верхний',
  TR: 'правый верхний',
  BL: 'левый нижний',
  BR: 'правый нижний',
}

export const ACTOR_LABEL: Record<Actor, string> = { user: 'вы', bot: 'бот', 'auto-tenuki': 'вы, тэнуки' }
