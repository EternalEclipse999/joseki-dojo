import { Check, Globe } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { LANGUAGE_NAMES, LANGUAGES } from '@joseki-dojo/shared'
import { useI18n } from '../i18n'

const BUTTON_ID = 'language-menu-button'

/** Spec (languages) 5: a globe button that opens the list of languages; the current one is checked. */
export function LanguageMenu() {
  const { language, setLanguage, t } = useI18n()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])

  // Only the opening moves the focus (to the current language): a language change in the meantime must not pull it back.
  useEffect(() => {
    if (!open) return
    items.current[LANGUAGES.indexOf(language)]?.focus()
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  // Closing from the keyboard or by a choice hands the focus back to the globe, so that it does not fall to the page.
  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      close()
      return
    }
    if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const last = LANGUAGES.length - 1
    const at = items.current.findIndex((b) => b === document.activeElement) // -1: the focus is on the globe
    let next: number
    if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    else if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % LANGUAGES.length
    else next = at < 0 ? last : (at + last) % LANGUAGES.length
    items.current[next]?.focus()
  }

  // Tab out of the menu closes it. A focus that goes nowhere (relatedTarget null: a click on the page, another window)
  // is left to the mousedown handler, so that browsers that do not focus a clicked button do not close it under the click.
  const onFocusOut = (e: FocusEvent): void => {
    const to = e.relatedTarget as Node | null
    if (to && !box.current?.contains(to)) setOpen(false)
  }

  return (
    <div class="language-menu" ref={box} onKeyDown={onKey} onFocusOut={onFocusOut}>
      <button
        id={BUTTON_ID}
        ref={trigger}
        class="icon"
        aria-label={t('language.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('language.label')}
        onClick={() => setOpen(!open)}
      >
        <Globe aria-hidden="true" />
      </button>
      {open && (
        <div class="language-popup" role="menu" aria-labelledby={BUTTON_ID}>
          {LANGUAGES.map((lang, i) => (
            <button
              key={lang}
              ref={(el) => {
                items.current[i] = el
              }}
              role="menuitemradio"
              aria-checked={lang === language}
              lang={lang}
              onClick={() => {
                setLanguage(lang)
                close()
              }}
            >
              <Check aria-hidden="true" class={lang === language ? '' : 'invisible'} />
              {LANGUAGE_NAMES[lang]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
