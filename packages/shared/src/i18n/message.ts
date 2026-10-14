/** CLDR plural forms; `other` is always there, the rest as the language needs (`Intl.PluralRules`). */
export interface PluralForms {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

/** A dictionary entry: a text with `{params}`, or plural forms chosen by `{count}`. */
export type Message = string | PluralForms
