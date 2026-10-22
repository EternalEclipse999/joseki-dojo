import { vertexToGtp, type Actor, type Category, type Color, type Corner, type Language, type MessageKey, type MoveVertex, type Translate } from '@joseki-dojo/shared'

const oneDecimalFormats = new Map<Language, Intl.NumberFormat>()
const integerFormats = new Map<Language, Intl.NumberFormat>()
const percentFormats = new Map<Language, Intl.NumberFormat>()
const cachedFormat = (cache: Map<Language, Intl.NumberFormat>, lang: Language, options?: Intl.NumberFormatOptions): Intl.NumberFormat => {
  let format = cache.get(lang)
  if (!format) cache.set(lang, (format = new Intl.NumberFormat(lang, options)))
  return format
}

/** One decimal in the language. One formatter per language: a screen formats many numbers on every render, and building a formatter is slow. */
export const oneDecimalFormat = (lang: Language): Intl.NumberFormat => cachedFormat(oneDecimalFormats, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** A loss below this many points rounds to zero in the display: it shows as «0,0» and gets no minus sign. */
export const ZERO_LOSS = 0.05

/** One decimal, in the reader's language («5,1» / "5.1"); a value that rounds to zero prints without a sign. */
export const formatPoints = (n: number, lang: Language): string => {
  const format = oneDecimalFormat(lang)
  const text = format.format(n)
  const zero = format.format(0)
  return text.replace(/^[-−]/, '') === zero ? zero : text
}

/**
 * Spec (languages) 4.2: a number of points in words («5,1 очка», "5.1 points"). The number always shows one decimal, and
 * a number with a visible decimal takes the `other` plural form in every language (CLDR: «1,0 очка», "1.0 points"), so
 * no `count` is passed: the raw value would pick «1,0 очко» or «0,0 очков».
 */
export const pointsText = (n: number, t: Translate, lang: Language): string => t('common.pointsValue', { value: formatPoints(n, lang) })

/** Visit counts with grouped thousands («1 200» / "1,200"). */
export const formatCount = (n: number, lang: Language): string => cachedFormat(integerFormats, lang).format(Math.round(n))

/** Spec (progress part 2) 6: a share 0..1 as a whole percent in the language («42 %», "42%"). */
export const formatPercent = (n: number, lang: Language): string => cachedFormat(percentFormats, lang, { style: 'percent', maximumFractionDigits: 0 }).format(n)

/** The first letter in upper case: a lowercase catalog text that opens a line. */
export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export const moveLabel = (v: MoveVertex, t: Translate): string => (v === 'pass' ? t('common.pass') : vertexToGtp(v))

/** Ranks as players write them: «7 кю», "1 dan", 初段 (Japanese has no 一段). */
export const rankLabel = (rank: string, t: Translate): string => {
  const n = Number(rank.slice(0, -1))
  if (rank.endsWith('k')) return t('rank.kyu', { n })
  return n === 1 ? t('rank.dan1') : t('rank.dan', { n })
}

/** Spec (repetition) 3.1: a player level as a label: the rank, or «профи». */
export const levelLabel = (level: string, t: Translate): string => (level === 'pro' ? t('level.pro') : rankLabel(level, t))

/** The colour as a label («Чёрные», "Black"). */
export const colorLabel = (c: Color, t: Translate): string => t(c === 'B' ? 'common.black' : 'common.white')

export const CATEGORY_LABEL: Record<Category, MessageKey> = {
  exact: 'category.exact',
  inaccuracy: 'category.inaccuracy',
  mistake: 'category.mistake',
  blunder: 'category.blunder',
}

/** The whole corner («левый верхний угол», "top left corner"). */
export const CORNER_LABEL: Record<Corner, MessageKey> = {
  TL: 'corner.topLeft',
  TR: 'corner.topRight',
  BL: 'corner.bottomLeft',
  BR: 'corner.bottomRight',
}

/** Who played a move, inside a sentence («вы», "you"). */
export const ACTOR_LABEL: Record<Actor, MessageKey> = { user: 'actor.user', bot: 'actor.bot', 'auto-tenuki': 'actor.autoTenuki' }

/** Spec (repetition) 4.3: the start of the repetition day containing `now` — 04:00 local time, as on the server. */
export function dayStart(now: Date): Date {
  const d = new Date(now)
  d.setHours(4, 0, 0, 0)
  if (now < d) d.setDate(d.getDate() - 1)
  return d
}

/**
 * Spec (repetition) 5.1: when a card is due — «сейчас», minutes or hours within a day («через 10 минут»), then repetition
 * days counted on the 04:00 boundary as the week's forecast counts them («завтра», «послезавтра», «через 3 дня»).
 */
export function formatWhen(iso: string, now: Date, language: Language, t: Translate): string {
  const due = new Date(iso)
  const ms = due.getTime() - now.getTime()
  if (ms <= 0) return t('repetition.now')
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  // Rounded: a day across a daylight-saving change is 23 or 25 hours long.
  const days = Math.round((dayStart(due).getTime() - dayStart(now).getTime()) / 86_400_000)
  // A day or more ahead but not past 04:00 yet (the same repetition day): hours, never «сегодня».
  if (hours < 24 || days < 1) return rtf.format(hours, 'hour')
  return rtf.format(days, 'day')
}
