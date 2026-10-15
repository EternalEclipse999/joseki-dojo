import { LANGUAGE_NAMES, LANGUAGES, type Language } from '@joseki-dojo/shared'
import { useI18n } from '../i18n'

/** Spec (languages) 8.2: six buttons, each in its own language; English is highlighted and the hint is English. */
export function LanguageScreen() {
  const { setLanguage } = useI18n()
  return (
    <main>
      <div class="page language-screen">
        {/* The heading and the hint are English whatever language the page remembers. */}
        <div class="page-head" lang="en">
          <h1>Choose your language</h1>
          <p>You can change it later in Settings or with the globe in the header.</p>
        </div>
        <div class="language-choices">
          {LANGUAGES.map((lang: Language) => (
            <button key={lang} lang={lang} class={lang === 'en' ? 'primary lg' : 'lg'} onClick={() => setLanguage(lang)}>
              {LANGUAGE_NAMES[lang]}
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
