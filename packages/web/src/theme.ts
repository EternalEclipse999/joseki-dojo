import type { MessageKey, Theme } from '@joseki-dojo/shared'

/** The theme choices in the order the settings show them, with their labels. */
export const THEME_OPTIONS: readonly { value: Theme; label: MessageKey }[] = [
  { value: 'system', label: 'settings.theme.system' },
  { value: 'light', label: 'settings.theme.light' },
  { value: 'dark', label: 'settings.theme.dark' },
]

/** The colours to show: the chosen theme, or the system's when the choice is 'system'. */
export const resolveTheme = (theme: Theme, systemDark: boolean): 'light' | 'dark' => (theme === 'system' ? (systemDark ? 'dark' : 'light') : theme)

let chosen: Theme = 'system'
let watching = false

const systemDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches

function paint(): void {
  document.documentElement.dataset.theme = resolveTheme(chosen, systemDark())
}

/** Applies the theme at once; with 'system' it follows later system changes too. The desktop app also themes its window. */
export function applyTheme(theme: Theme): void {
  chosen = theme
  paint()
  if (!watching) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint)
    watching = true
  }
  void window.dojoDesktop?.setTheme(theme).catch(() => undefined)
}
