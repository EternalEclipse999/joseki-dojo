import { ChevronRight } from 'lucide-preact'
import { useT } from '../i18n'
import { LanguageMenu } from './LanguageMenu'

export interface AppHeaderProps {
  /** Where the player is («Новая тренировка», «Разбор тренировки», …), already in the current language. */
  crumb?: string
  /** The «Игра / Настройки» switch; absent during a game and an engine update. */
  nav?: { settings: boolean; onGame: () => void; onSettings: () => void }
}

/** Spec 4: the brand, the breadcrumb, the section switch and the language globe on every screen. */
export function AppHeader({ crumb, nav }: AppHeaderProps) {
  const t = useT()
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
      <div class="header-end">
        {nav && (
          <nav class="segmented" aria-label={t('header.sections')}>
            <button aria-pressed={!nav.settings} onClick={nav.onGame}>
              {t('header.game')}
            </button>
            <button aria-pressed={nav.settings} onClick={nav.onSettings}>
              {t('header.settings')}
            </button>
          </nav>
        )}
        <LanguageMenu />
      </div>
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
