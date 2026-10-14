import { useEffect, useState } from 'preact/hooks'
import { Check, Gauge, LoaderCircle, TriangleAlert } from 'lucide-preact'
import { LANGUAGE_NAMES, LANGUAGES, localize, type LocalizedText, type MessageKey, type SettingsUpdate, type SettingsView, type Theme } from '@joseki-dojo/shared'
import { failureText, fetchSettings, fetchUi, saveSettings, saveTheme } from '../api'
import { errorText } from '../error-text'
import { useI18n } from '../i18n'
import { applyTheme, THEME_OPTIONS } from '../theme'

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; text: LocalizedText }
type PathKey = keyof SettingsUpdate['katago']
type VisitsKey = keyof SettingsUpdate['analysis']

const PATH_FIELDS: { key: PathKey; label: MessageKey; models: boolean }[] = [
  { key: 'path', label: 'settings.engine.path', models: false },
  { key: 'analysisConfig', label: 'settings.engine.analysisConfig', models: false },
  { key: 'mainModel', label: 'settings.engine.mainModel', models: true },
  { key: 'humanModel', label: 'settings.engine.humanModel', models: true },
]

/** The colour theme: applied at once and saved without «Сохранить и проверить». */
function ThemeSection() {
  const { language, t } = useI18n()
  const [theme, setTheme] = useState<Theme | null>(null)
  const [error, setError] = useState<LocalizedText | null>(null)
  useEffect(() => {
    fetchUi()
      .then((u) => setTheme(u.theme))
      .catch(() => setTheme('system'))
  }, [])
  const choose = (next: Theme): void => {
    setTheme(next)
    setError(null)
    applyTheme(next)
    saveTheme(next).catch((e: unknown) => setError(failureText(e)))
  }
  return (
    <section class="card section">
      <div class="section-head">
        <h2>{t('settings.theme.title')}</h2>
        <p>{t('settings.theme.hint')}</p>
      </div>
      <div class="segmented" role="radiogroup" aria-label={t('settings.theme.label')}>
        {THEME_OPTIONS.map((o) => (
          <label key={o.value}>
            <input type="radio" name="theme" checked={theme === o.value} onChange={() => choose(o.value)} />
            {t(o.label)}
          </label>
        ))}
      </div>
      {error && <p class="hint error">{errorText(error, language)}</p>}
    </section>
  )
}

/** The interface language: applied at once and saved with the other UI settings, like the theme. */
function LanguageSection() {
  const { language, setLanguage, t } = useI18n()
  return (
    <section class="card section">
      <div class="section-head">
        <h2>{t('settings.language.title')}</h2>
      </div>
      <div class="segmented" role="radiogroup" aria-label={t('language.label')}>
        {LANGUAGES.map((lang) => (
          <label key={lang} lang={lang}>
            <input type="radio" name="language" checked={language === lang} onChange={() => setLanguage(lang)} />
            {LANGUAGE_NAMES[lang]}
          </label>
        ))}
      </div>
    </section>
  )
}

const VISIT_FIELDS: { key: VisitsKey; label: MessageKey }[] = [
  { key: 'reviewVisits', label: 'settings.analysis.reviewVisits' },
  { key: 'variationVisits', label: 'settings.analysis.variationVisits' },
  { key: 'endVisits', label: 'settings.analysis.endVisits' },
]

export function SettingsScreen({ onClose, onSaved, onRepick }: { onClose: () => void; onSaved: () => void; onRepick: () => void }) {
  const { language, t } = useI18n()
  const [view, setView] = useState<SettingsView | null>(null)
  const [form, setForm] = useState<SettingsUpdate | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    fetchSettings()
      .then((v) => {
        setView(v)
        setForm({ katago: { ...v.katago }, analysis: { ...v.analysis } })
      })
      .catch((e: unknown) => setStatus({ kind: 'error', text: failureText(e) }))
  }, [])

  if (!view || !form) {
    return (
      <main>
        <div class="page wide">
          {status.kind === 'error' ? (
            <p class="hint error">{errorText(status.text, language)}</p>
          ) : (
            <p class="status-line">
              <LoaderCircle class="spin" aria-hidden="true" />
              {t('settings.loading')}
            </p>
          )}
          <div class="actions">
            <button class="ghost" onClick={onClose}>
              {t('common.back')}
            </button>
          </div>
        </div>
      </main>
    )
  }

  const setPath = (key: PathKey, value: string): void => setForm({ ...form, katago: { ...form.katago, [key]: value } })
  const setVisits = (key: VisitsKey, value: string): void => setForm({ ...form, analysis: { ...form.analysis, [key]: Number(value) } })

  const save = async (): Promise<void> => {
    setStatus({ kind: 'saving' })
    try {
      const r = await saveSettings(form)
      if (r.ok) {
        setView(r.settings)
        setStatus({ kind: 'saved' })
        onSaved()
      } else {
        setStatus({ kind: 'error', text: r.reason })
      }
    } catch (e) {
      setStatus({ kind: 'error', text: failureText(e) })
    }
  }

  return (
    <main>
      <div class="page wide settings">
        <div class="page-head">
          <h1>{t('settings.title')}</h1>
          <p>
            {view.runningVersion === null
              ? t('settings.versionsNotRunning', { locked: view.lockedVersion })
              : t('settings.versions', { locked: view.lockedVersion, running: view.runningVersion })}
          </p>
        </div>
        {view.versionWarning && (
          <p class="note warning">
            <TriangleAlert aria-hidden="true" />
            <span>{localize(language, view.versionWarning)}</span>
          </p>
        )}

        <ThemeSection />

        <LanguageSection />

        <section class="card section">
          <div class="section-head">
            <h2>{t('settings.engine.title')}</h2>
            <p>{t('settings.engine.hint')}</p>
          </div>
          {PATH_FIELDS.map((f) => (
            <label class="field" key={f.key}>
              {t(f.label)}
              <input
                type="text"
                spellcheck={false}
                value={form.katago[f.key]}
                list={f.models ? 'models' : undefined}
                onInput={(e) => setPath(f.key, e.currentTarget.value)}
              />
            </label>
          ))}
          <datalist id="models">
            {view.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </section>

        <section class="card section">
          <div class="section-head">
            <h2>{t('settings.repick.title')}</h2>
            <p>{t('settings.repick.hint')}</p>
          </div>
          <div class="actions">
            <button onClick={onRepick}>
              <Gauge aria-hidden="true" />
              {t('common.repickEngine')}
            </button>
          </div>
        </section>

        <section class="card section">
          <div class="section-head">
            <h2>{t('settings.analysis.title')}</h2>
          </div>
          <div class="visits">
            {VISIT_FIELDS.map((f) => (
              <label class="field" key={f.key}>
                {t(f.label)}
                <input type="number" min={1} value={form.analysis[f.key]} onInput={(e) => setVisits(f.key, e.currentTarget.value)} />
              </label>
            ))}
          </div>
        </section>

        <div class="actions">
          <button class="primary" disabled={status.kind === 'saving'} onClick={() => void save()}>
            {status.kind === 'saving' ? <LoaderCircle class="spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
            {t('settings.save')}
          </button>
          <button class="ghost" onClick={onClose}>
            {t('common.back')}
          </button>
        </div>
        {status.kind === 'saving' && <p class="hint">{t('settings.saving')}</p>}
        {status.kind === 'saved' && (
          <p class="status-line">
            <Check aria-hidden="true" />
            {t('settings.saved')}
          </p>
        )}
        {status.kind === 'error' && <p class="hint error">{errorText(status.text, language)}</p>}
      </div>
    </main>
  )
}
