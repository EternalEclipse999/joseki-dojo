import { isLanguage, THEMES, type Language, type Theme, type UiSettings } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import { TextError } from '../text-error'
import { updateConfigFile } from './config-writer'

export class UiSettingsError extends TextError {}

/** Interface preferences (the colour theme and the language), saved in the config file next to the engine settings. */
export class UiService {
  constructor(
    private readonly config: AppConfig,
    private readonly configFile: string,
  ) {}

  view(): UiSettings {
    return { ...this.config.ui }
  }

  async setTheme(theme: unknown): Promise<UiSettings> {
    if (!THEMES.includes(theme as Theme)) throw new UiSettingsError({ key: 'error.ui.theme' })
    return this.save({ theme: theme as Theme })
  }

  async setLanguage(language: unknown): Promise<UiSettings> {
    if (!isLanguage(language)) throw new UiSettingsError({ key: 'error.ui.language' })
    return this.save({ language })
  }

  /** Spec (languages) 8.1: the installer's choice, kept only when the player has none yet. */
  async applyInitialLanguage(language: Language): Promise<void> {
    if (this.config.ui.language === undefined) await this.save({ language })
  }

  private async save(change: Partial<UiSettings>): Promise<UiSettings> {
    await updateConfigFile(this.configFile, (raw) => {
      raw.ui = { ...((raw.ui ?? {}) as Record<string, unknown>), ...change }
    })
    this.config.ui = { ...this.config.ui, ...change }
    return this.view()
  }
}
