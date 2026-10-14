import { CATALOGS, type MessageKey } from './catalogs'
import type { Language } from './languages'
import type { Message } from './message'

/** Spec (languages) 6: a text sent as a key so that it is shown in the reader's language. */
export interface LocalizedText {
  key: MessageKey
  params?: Record<string, TextParam>
}
export type TextParam = string | number | LocalizedText
export type Translate = (key: MessageKey, params?: Record<string, TextParam>) => string

const pluralRules = new Map<Language, Intl.PluralRules>()
const numberFormats = new Map<Language, Intl.NumberFormat>()
const cached = <T>(map: Map<Language, T>, lang: Language, make: () => T): T => {
  let value = map.get(lang)
  if (!value) map.set(lang, (value = make()))
  return value
}

const pick = (lang: Language, message: Message, count: TextParam | undefined): string => {
  if (typeof message === 'string') return message
  if (typeof count !== 'number') return message.other
  return message[cached(pluralRules, lang, () => new Intl.PluralRules(lang)).select(count)] ?? message.other
}

const show = (lang: Language, value: TextParam): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return cached(numberFormats, lang, () => new Intl.NumberFormat(lang)).format(value)
  return t(lang, value.key, value.params)
}

/** Spec (languages) 4.2: the text of `key` in `lang` with `{params}` filled in; numbers are formatted for the language. */
export function t(lang: Language, key: MessageKey, params: Record<string, TextParam> = {}): string {
  const message = CATALOGS[lang][key] ?? CATALOGS.en[key]
  if (message === undefined) return key
  return pick(lang, message, params.count).replace(/\{(\w+)\}/g, (whole, name: string) => (params[name] === undefined ? whole : show(lang, params[name])))
}

export const translator =
  (lang: Language): Translate =>
  (key, params) =>
    t(lang, key, params)

export const localize = (lang: Language, text: LocalizedText): string => t(lang, text.key, text.params)

export const isLocalizedText = (value: unknown): value is LocalizedText =>
  typeof value === 'object' && value !== null && typeof (value as { key?: unknown }).key === 'string'
