import { LANGUAGES, type Language, type LocalizedName } from '@joseki-dojo/shared'

type Entry = Partial<Record<Language, { name?: string; short?: string }>>
export type StartNames = Record<string, Entry>

/** Spec (languages) 7: starts-i18n.json, keyed by the moves of a position or a branch; a broken or empty file is no translations. */
export function loadNames(json: string, log: (line: string) => void): StartNames {
  try {
    const raw = JSON.parse(json) as unknown
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      if (Object.keys(raw).length > 0) return raw as StartNames
      log('Переводы названий стартовых позиций недоступны: файл пуст')
      return {}
    }
  } catch {
    // reported below
  }
  log('Переводы названий стартовых позиций недоступны: файл повреждён')
  return {}
}

/** A translation counts only as a non-empty string. */
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined)

/** The name of `moves` in every language: the translation, else English, else the Russian of the list. */
export function nameFor(names: StartNames, moves: string, russian: { name: string; short?: string }, log: (line: string) => void = () => {}): { name: LocalizedName; short?: LocalizedName } {
  const entry = names[moves] ?? {}
  const pick = (field: 'name' | 'short', ru: string): LocalizedName =>
    Object.fromEntries(LANGUAGES.map((l) => [l, l === 'ru' ? ru : (text(entry[l]?.[field]) ?? text(entry.en?.[field]) ?? ru)])) as LocalizedName
  const missing = LANGUAGES.filter((l) => l !== 'ru' && !text(entry[l]?.name))
  // Without the file at all, loadNames has already said so once: no line per entry.
  if (missing.length > 0 && Object.keys(names).length > 0) log(`Нет перевода названия ${moves}: ${missing.join(', ')}`)
  return { name: pick('name', russian.name), ...(russian.short !== undefined ? { short: pick('short', russian.short) } : {}) }
}
