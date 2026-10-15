import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import { DEFAULT_LANGUAGE, isLanguage, translator, type Language, type Translate, type UiSettings } from '@joseki-dojo/shared'

const STORAGE_KEY = 'joseki-dojo.language'

/** Spec (languages) 5: the last language, remembered so that the page does not flash in English before /api/ui answers. */
export function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isLanguage(value) ? value : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

/** Remembers `lang` and sets `<html lang>`, which picks the Japanese, Chinese or Korean shapes of the characters. */
export function rememberLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Storage is off: the next start shows English until /api/ui answers.
  }
  document.documentElement.lang = lang
}

/** The language to show from the saved settings: the saved one, else the remembered one; `chosen` is false until the player picks. */
export const pickLanguage = (ui: UiSettings, remembered: Language): { language: Language; chosen: boolean } =>
  ui.language ? { language: ui.language, chosen: true } : { language: remembered, chosen: false }

export interface I18n {
  language: Language
  t: Translate
  setLanguage: (lang: Language) => void
  /** Whether the player has a saved language; null until /api/ui answers. */
  chosen: boolean | null
}

export const I18nContext = createContext<I18n>({ language: DEFAULT_LANGUAGE, t: translator(DEFAULT_LANGUAGE), setLanguage: () => undefined, chosen: null })
export const useI18n = (): I18n => useContext(I18nContext)
export const useT = (): Translate => useContext(I18nContext).t
