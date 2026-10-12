import { THEMES, type Theme, type UiSettings } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import { updateConfigFile } from './config-writer'

export class UiSettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UiSettingsError'
  }
}

/** Interface preferences (the colour theme), saved in the config file next to the engine settings. */
export class UiService {
  constructor(
    private readonly config: AppConfig,
    private readonly configFile: string,
  ) {}

  view(): UiSettings {
    return { ...this.config.ui }
  }

  async setTheme(theme: unknown): Promise<UiSettings> {
    if (!THEMES.includes(theme as Theme)) throw new UiSettingsError('Неизвестная тема оформления')
    await updateConfigFile(this.configFile, (raw) => {
      raw.ui = { ...((raw.ui ?? {}) as Record<string, unknown>), theme }
    })
    this.config.ui = { ...this.config.ui, theme: theme as Theme }
    return this.view()
  }
}
