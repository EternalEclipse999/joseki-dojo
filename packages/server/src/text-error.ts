import { localize, type LocalizedText } from '@joseki-dojo/shared'

/** Spec (languages) 6: an error the player sees; `message` is the English text for the log. */
export class TextError extends Error {
  constructor(
    readonly text: LocalizedText,
    options?: ErrorOptions,
  ) {
    super(localize('en', text), options)
    this.name = 'TextError'
  }
}

/** The player-facing text of any error: its own key, or `error.internal` with the raw message. */
export const textOf = (err: unknown): LocalizedText =>
  err instanceof TextError ? err.text : { key: 'error.internal', params: { detail: err instanceof Error ? err.message : String(err) } }
