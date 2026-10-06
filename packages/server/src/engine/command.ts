import type { AppConfig } from '../config'
import type { EngineCommand } from './engine'

export function engineCommand(config: AppConfig): EngineCommand {
  const override = config.katago.commandOverride
  if (override && override.length > 0) return { command: override[0], args: override.slice(1) }
  const k = config.katago
  return {
    command: k.path,
    args: ['analysis', '-config', k.analysisConfig, '-model', k.mainModel, '-human-model', k.humanModel],
  }
}
