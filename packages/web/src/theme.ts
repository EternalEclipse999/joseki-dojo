import type { Theme } from '@joseki-dojo/shared'

/** The colours to show: the chosen theme, or the system's when the choice is «Как в системе». */
export const resolveTheme = (theme: Theme, systemDark: boolean): 'light' | 'dark' => (theme === 'system' ? (systemDark ? 'dark' : 'light') : theme)

let chosen: Theme = 'system'
let watching = false

const systemDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches

function paint(): void {
  document.documentElement.dataset.theme = resolveTheme(chosen, systemDark())
}

/** Applies the theme at once; with «Как в системе» it follows later system changes too. The desktop app also themes its window. */
export function applyTheme(theme: Theme): void {
  chosen = theme
  paint()
  if (!watching) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint)
    watching = true
  }
  void window.dojoDesktop?.setTheme(theme).catch(() => undefined)
}
