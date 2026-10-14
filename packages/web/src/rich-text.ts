import type { ComponentChildren } from 'preact'

/**
 * Spec (languages) 4.2: a translated sentence with markup inside it («Ход 3: <b>Q16</b>»). `t` leaves a `{slot}` it was
 * given no value for as it is; the text is cut there and each slot becomes its markup, so the word order stays the
 * translator's. A slot without markup stays as written.
 */
export function richText(text: string, slots: Record<string, ComponentChildren>): ComponentChildren[] {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 === 0 ? part : Object.hasOwn(slots, part) ? slots[part] : `{${part}}`))
}
