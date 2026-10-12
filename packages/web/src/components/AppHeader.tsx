import { ChevronRight } from 'lucide-preact'

export interface AppHeaderProps {
  /** Where the player is («Новая тренировка», «Разбор тренировки», …). */
  crumb?: string
  /** The «Игра / Настройки» switch; absent during a game and an engine update. */
  nav?: { settings: boolean; onGame: () => void; onSettings: () => void }
}

/** Spec 4: the brand, the breadcrumb and the section switch on every screen. */
export function AppHeader({ crumb, nav }: AppHeaderProps) {
  return (
    <header class="app-header">
      <div class="brand">
        <Logo />
        <b>Joseki Dojo</b>
        {crumb && (
          <>
            <ChevronRight aria-hidden="true" />
            <span class="crumb">{crumb}</span>
          </>
        )}
      </div>
      {nav && (
        <nav class="segmented" aria-label="Разделы">
          <button aria-pressed={!nav.settings} onClick={nav.onGame}>
            Игра
          </button>
          <button aria-pressed={nav.settings} onClick={nav.onSettings}>
            Настройки
          </button>
        </nav>
      )}
    </header>
  )
}

/** Two stones, black over white. */
function Logo() {
  return (
    <svg class="logo" viewBox="0 0 22 22" aria-hidden="true">
      <circle class="w" cx="14" cy="11" r="6.6" />
      <circle cx="8.2" cy="11" r="7.3" fill="var(--bg)" />
      <circle class="b" cx="8.2" cy="11" r="6.6" />
    </svg>
  )
}
