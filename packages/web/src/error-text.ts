import { localize, type Language, type LocalizedText } from '@joseki-dojo/shared'

/** Spec (languages) 5: an error on screen is kept as a key and translated on every render, so a language switch retranslates it. */
export const errorText = (error: LocalizedText | string, lang: Language): string => (typeof error === 'string' ? error : localize(lang, error))
