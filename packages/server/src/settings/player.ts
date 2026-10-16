import { isPlayerLevel, type PlayerSettings } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import { TextError } from '../text-error'
import { updateConfigFile } from './config-writer'

export class PlayerSettingsError extends TextError {}

/** Spec (repetition) 3.1: the player's level in the config (`player.level`); takes effect at once. */
export class PlayerService {
  constructor(
    private readonly config: AppConfig,
    private readonly configFile: string,
  ) {}

  view(): PlayerSettings {
    return { level: this.config.player.level }
  }

  async save(level: string): Promise<PlayerSettings> {
    if (!isPlayerLevel(level)) throw new PlayerSettingsError({ key: 'error.player.level' })
    await updateConfigFile(this.configFile, (raw) => {
      raw.player = { ...((raw.player ?? {}) as Record<string, unknown>), level }
    })
    this.config.player.level = level
    return this.view()
  }
}
