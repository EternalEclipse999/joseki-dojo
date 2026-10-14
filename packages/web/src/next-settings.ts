import { START_GROUPS, type SessionSettings, type StartListEntry } from '@joseki-dojo/shared'

/**
 * «Следующая позиция»: the same start-screen settings; in «Из списка» the next position of the list,
 * in screen order (grouped by the first move), wrapping around (starts spec 5.1).
 */
export function nextSettings(settings: SessionSettings, list: readonly StartListEntry[]): SessionSettings {
  if (settings.mode !== 'list' || list.length === 0) return settings
  const ordered = START_GROUPS.flatMap((g) => list.filter((e) => e.group === g))
  const at = ordered.findIndex((e) => e.id === settings.startId)
  return { ...settings, startId: ordered[(at + 1) % ordered.length].id }
}
