import { isPlayerLevel, type PlayerSettings } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import { TextError } from '../text-error'
import { inConfigTurn, updateConfigFileSync } from './config-writer'

export class PlayerSettingsError extends TextError {}

export interface PlayerServiceDeps {
  config: AppConfig
  configFile: string
  /** Spec (progress part 2) 5: replays every card with the thresholds of `level`; it runs inside `transaction`. */
  replay: (level: string) => void
  /** Runs `fn` in one database transaction. */
  transaction: <T>(fn: () => T) => T
}

/** Spec (repetition) 3.1: the player's level in the config (`player.level`); takes effect at once. */
export class PlayerService {
  constructor(private readonly d: PlayerServiceDeps) {}

  view(): PlayerSettings {
    return { level: this.d.config.player.level }
  }

  /**
   * Spec (progress part 2) 5: a new level replays every card and is written to the config as one unit — both in one
   * database transaction, the config write last, so that a failed write rolls the replay back and the level stays. It
   * runs in the config file's turn, so that no queued write of another setting interleaves with it; the live level
   * changes right after the commit. Resolves once the replay is done.
   */
  async save(level: string): Promise<PlayerSettings> {
    if (!isPlayerLevel(level)) throw new PlayerSettingsError({ key: 'error.player.level' })
    await inConfigTurn(this.d.configFile, () => {
      this.d.transaction(() => {
        this.d.replay(level)
        // A commit failing after this rename (very unlikely) would leave the new level in the file over the old replay.
        updateConfigFileSync(this.d.configFile, (raw) => {
          raw.player = { ...((raw.player ?? {}) as Record<string, unknown>), level }
        })
      })
      this.d.config.player.level = level
    })
    return this.view()
  }
}
