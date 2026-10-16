import { ChevronRight } from 'lucide-preact'
import { useT } from '../i18n'
import { LanguageMenu } from './LanguageMenu'

/** The header's sections: «Игра», «Повторение», «Настройки». */
export type Section = 'game' | 'repetition' | 'settings'

export interface AppHeaderProps {
  /** Where the player is («Новая тренировка», «Разбор тренировки», …), already in the current language. */
  crumb?: string
  /** The «Игра / Повторение / Настройки» switch; absent during a game and an engine update. `due`: the cards due now, for the badge. */
  nav?: { section: Section; onSection: (s: Section) => void; due: number }
}

/** Spec 4: the brand, the breadcrumb, the section switch (repetition spec 5.1: with the due cards' badge) and the language globe on every screen. */
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
            <button aria-pressed={nav.section === 'game'} onClick={() => nav.onSection('game')}>
              {t('header.game')}
            </button>
            <button aria-pressed={nav.section === 'repetition'} onClick={() => nav.onSection('repetition')}>
              {t('header.repetition')}
              {nav.due > 0 && (
                <>
                  <span class="badge" aria-hidden="true">
                    {nav.due}
                  </span>
                  <span class="sr-only"> {t('header.dueBadge', { count: nav.due })}</span>
                </>
              )}
            </button>
            <button aria-pressed={nav.section === 'settings'} onClick={() => nav.onSection('settings')}>
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
