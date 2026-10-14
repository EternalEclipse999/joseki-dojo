/** Spec (languages) 3: the interface languages in menu order. */
export const LANGUAGES = ['en', 'ru', 'zh-Hans', 'zh-Hant', 'ko', 'ja'] as const
export type Language = (typeof LANGUAGES)[number]

/** Spec (languages) 3: without `ui.language` the interface is English. */
export const DEFAULT_LANGUAGE: Language = 'en'

export const isLanguage = (value: unknown): value is Language => (LANGUAGES as readonly unknown[]).includes(value)

/** Each language named in itself, for the menus and the first start screen. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  ru: 'Русский',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  ko: '한국어',
  ja: '日本語',
}

const WINDOWS_LANGUAGE_IDS: Record<number, Language> = { 1033: 'en', 1049: 'ru', 2052: 'zh-Hans', 1028: 'zh-Hant', 1042: 'ko', 1041: 'ja' }

/** Spec (languages) 8.1: the LANGID the Windows installer writes; an unknown one is English. */
export const languageFromWindowsId = (id: number): Language => WINDOWS_LANGUAGE_IDS[id] ?? DEFAULT_LANGUAGE
