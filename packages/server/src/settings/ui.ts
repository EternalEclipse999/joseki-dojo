import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { THEMES, type Theme, type UiSettings } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import { renameRetrying } from '../install/download'

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
    const raw = (existsSync(this.configFile) ? JSON.parse(readFileSync(this.configFile, 'utf8')) : {}) as Record<string, unknown>
    raw.ui = { ...((raw.ui ?? {}) as Record<string, unknown>), theme }
    mkdirSync(dirname(this.configFile), { recursive: true })
    const tmp = `${this.configFile}.tmp`
    writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
    await renameRetrying(tmp, this.configFile)
    this.config.ui = { ...this.config.ui, theme: theme as Theme }
    return this.view()
  }
}
