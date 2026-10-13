import { useEffect, useState } from 'preact/hooks'
import { Check, Gauge, LoaderCircle, TriangleAlert } from 'lucide-preact'
import type { SettingsUpdate, SettingsView, Theme } from '@joseki-dojo/shared'
import { fetchSettings, fetchUi, saveSettings, saveTheme } from '../api'
import { applyTheme } from '../theme'

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; text: string }
type PathKey = keyof SettingsUpdate['katago']
type VisitsKey = keyof SettingsUpdate['analysis']

const PATH_FIELDS: { key: PathKey; label: string; models: boolean }[] = [
  { key: 'path', label: 'Исполняемый файл KataGo', models: false },
  { key: 'analysisConfig', label: 'Конфиг анализа', models: false },
  { key: 'mainModel', label: 'Основная сеть', models: true },
  { key: 'humanModel', label: 'Human-сеть', models: true },
]

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
]

/** The colour theme: applied at once and saved without «Сохранить и проверить». */
function ThemeSection() {
  const [theme, setTheme] = useState<Theme | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetchUi()
      .then((u) => setTheme(u.theme))
      .catch(() => setTheme('system'))
  }, [])
  const choose = (t: Theme): void => {
    setTheme(t)
    setError(null)
    applyTheme(t)
    saveTheme(t).catch((e: Error) => setError(e.message))
  }
  return (
    <section class="card section">
      <div class="section-head">
        <h2>Оформление</h2>
        <p>Тема применяется сразу.</p>
      </div>
      <div class="segmented" role="radiogroup" aria-label="Тема">
        {THEME_OPTIONS.map((o) => (
          <label key={o.value}>
            <input type="radio" name="theme" checked={theme === o.value} onChange={() => choose(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      {error && <p class="hint error">{error}</p>}
    </section>
  )
}

const VISIT_FIELDS: { key: VisitsKey; label: string }[] = [
  { key: 'reviewVisits', label: 'Визиты на позицию в разборе' },
  { key: 'endVisits', label: 'Визиты для кнопки «Тэнуки»' },
]

export function SettingsScreen({ onClose, onSaved, onRepick }: { onClose: () => void; onSaved: () => void; onRepick: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null)
  const [form, setForm] = useState<SettingsUpdate | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    fetchSettings()
      .then((v) => {
        setView(v)
        setForm({ katago: { ...v.katago }, analysis: { ...v.analysis } })
      })
      .catch((e: Error) => setStatus({ kind: 'error', text: e.message }))
  }, [])

  if (!view || !form) {
    return (
      <main>
        <div class="page wide">
          {status.kind === 'error' ? (
            <p class="hint error">{status.text}</p>
          ) : (
            <p class="status-line">
              <LoaderCircle class="spin" aria-hidden="true" />
              Загрузка настроек…
            </p>
          )}
          <div class="actions">
            <button class="ghost" onClick={onClose}>
              Назад
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
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  return (
    <main>
      <div class="page wide settings">
        <div class="page-head">
          <h1>Настройки</h1>
          <p>
            Проверенная версия KataGo: {view.lockedVersion}. Запущена: {view.runningVersion ?? 'нет'}.
          </p>
        </div>
        {view.versionWarning && (
          <p class="note warning">
            <TriangleAlert aria-hidden="true" />
            <span>{view.versionWarning}</span>
          </p>
        )}

        <ThemeSection />

        <section class="card section">
          <div class="section-head">
            <h2>Движок</h2>
            <p>Сети из папки engines/models можно выбрать из списка. Браузер не сообщает полный путь к файлу из окна выбора, поэтому путь вводится текстом.</p>
          </div>
          {PATH_FIELDS.map((f) => (
            <label class="field" key={f.key}>
              {f.label}
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
            <h2>Подбор движка</h2>
            <p>
              Программа ещё раз проверит скорость на процессоре и на видеокарте и выберет быстрее. Файлы заново не скачиваются. Это занимает
              пару минут, а на видеокарте при первом запуске — дольше.
            </p>
          </div>
          <div class="actions">
            <button onClick={onRepick}>
              <Gauge aria-hidden="true" />
              Подобрать движок заново
            </button>
          </div>
        </section>

        <section class="card section">
          <div class="section-head">
            <h2>Анализ</h2>
          </div>
          <div class="visits">
            {VISIT_FIELDS.map((f) => (
              <label class="field" key={f.key}>
                {f.label}
                <input type="number" min={1} value={form.analysis[f.key]} onInput={(e) => setVisits(f.key, e.currentTarget.value)} />
              </label>
            ))}
          </div>
        </section>

        <div class="actions">
          <button class="primary" disabled={status.kind === 'saving'} onClick={() => void save()}>
            {status.kind === 'saving' ? <LoaderCircle class="spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
            Сохранить и проверить
          </button>
          <button class="ghost" onClick={onClose}>
            Назад
          </button>
        </div>
        {status.kind === 'saving' && <p class="hint">Запускаю KataGo с новыми настройками…</p>}
        {status.kind === 'saved' && (
          <p class="status-line">
            <Check aria-hidden="true" />
            Сохранено, KataGo работает.
          </p>
        )}
        {status.kind === 'error' && <p class="hint error">{status.text}</p>}
      </div>
    </main>
  )
}
