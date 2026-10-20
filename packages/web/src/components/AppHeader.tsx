import type { NewsId } from '@joseki-dojo/shared'
import { ChevronRight, Info } from 'lucide-preact'
import { useRef, useState } from 'preact/hooks'
import { useT } from '../i18n'
import { AboutDialog } from './AboutDialog'
import { LanguageMenu } from './LanguageMenu'
import { Logo } from './Logo'
import { NewMark } from './NewMark'
import { NewsCallout } from './NewsCallout'

/** The header's sections: «Игра», «Повторение», «Настройки». */
export type Section = 'game' | 'repetition' | 'settings'

export interface AppHeaderProps {
  /** Where the player is («Новая тренировка», «Разбор тренировки», …), already in the current language. */
  crumb?: string
  /** The «Игра / Повторение / Настройки» switch; absent during a game and an engine update. `due`: the cards due now, for the badge. */
  nav?: {
    section: Section
    onSection: (s: Section) => void
    due: number
    /** Spec (whats-new) 2: the novelties to mark on their section buttons, and the callout to show under its button. */
    news: { unseen: readonly NewsId[]; callout: NewsId | null; onOpen: (id: NewsId) => void; onDismiss: (id: NewsId) => void }
  }
}

/**
 * Spec 4: the brand, the breadcrumb, the section switch (repetition spec 5.1: with the due cards' badge; whats-new spec 2:
 * with the «новое» mark and the callout), the language globe on every screen, and the «О программе» button and window
 * (spec (about) 2).
 */
export function AppHeader({ crumb, nav }: AppHeaderProps) {
  const t = useT()
  const targetRef = useRef<HTMLButtonElement>(null)
  const aboutRef = useRef<HTMLButtonElement>(null)
  const [about, setAbout] = useState(false)
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
          <div class="header-nav">
            <nav class="segmented" aria-label={t('header.sections')}>
              <button aria-pressed={nav.section === 'game'} onClick={() => nav.onSection('game')}>
                {t('header.game')}
              </button>
              <button class="news-target" ref={targetRef} aria-pressed={nav.section === 'repetition'} onClick={() => nav.onSection('repetition')}>
                {t('header.repetition')}
                {nav.news.unseen.includes('repetition') && <NewMark />}
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
            {/* Outside .segmented, so that the callout's buttons keep their own look; after the sections in the tab order. */}
            {nav.news.callout === 'repetition' && nav.section !== 'repetition' && (
              <NewsCallout
                id="repetition"
                onOpen={() => nav.news.onOpen('repetition')}
                onDismiss={() => {
                  nav.news.onDismiss('repetition')
                  // The callout unmounts with the focus inside it: hand the focus back to its button instead of the body.
                  targetRef.current?.focus()
                }}
              />
            )}
          </div>
        )}
        <button
          ref={aboutRef}
          class="icon"
          aria-label={t('about.title')}
          aria-haspopup="dialog"
          title={t('about.title')}
          onClick={() => setAbout(true)}
        >
          <Info aria-hidden="true" />
        </button>
        <LanguageMenu />
      </div>
      {about && (
        <AboutDialog
          onClose={() => {
            setAbout(false)
            aboutRef.current?.focus()
          }}
        />
      )}
    </header>
  )
}
