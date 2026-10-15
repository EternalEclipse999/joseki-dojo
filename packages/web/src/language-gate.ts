/** Spec (languages) 8.2: the language screen goes first while the settings have no language (null: not known yet — wait). */
export const needsLanguageScreen = (chosen: boolean | null): boolean => chosen === false
