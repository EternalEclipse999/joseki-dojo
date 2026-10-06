import { useEffect, useState } from 'preact/hooks'
import type { SettingsUpdate, SettingsView } from '@joseki-dojo/shared'
import { fetchSettings, saveSettings } from '../api'

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; text: string }
type PathKey = keyof SettingsUpdate['katago']
type VisitsKey = keyof SettingsUpdate['analysis']

const PATH_FIELDS: { key: PathKey; label: string; models: boolean }[] = [
  { key: 'path', label: 'Исполняемый файл KataGo', models: false },
  { key: 'analysisConfig', label: 'Конфиг анализа', models: false },
  { key: 'mainModel', label: 'Основная сеть', models: true },
  { key: 'humanModel', label: 'Human-сеть', models: true },
]

const VISIT_FIELDS: { key: VisitsKey; label: string }[] = [
  { key: 'reviewVisits', label: 'Визиты на позицию в разборе' },
  { key: 'endVisits', label: 'Визиты для проверки конца дзёсеки' },
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
      <main class="settings">
        <p class={status.kind === 'error' ? 'hint error' : 'status'}>{status.kind === 'error' ? status.text : 'Загрузка настроек…'}</p>
        <div class="row">
          <button onClick={onClose}>Назад</button>
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
    <main class="settings">
      <h1>Настройки</h1>
      <p class="meta">
        Проверенная версия KataGo: {view.lockedVersion}. Запущена: {view.runningVersion ?? 'нет'}.
      </p>
      {view.versionWarning && <p class="notice">{view.versionWarning}</p>}
      <fieldset>
        <legend>Движок</legend>
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
        <p class="hint">
          Сети из папки engines/models можно выбрать из списка. Браузер не сообщает полный путь к файлу из окна выбора, поэтому путь вводится текстом.
        </p>
      </fieldset>
      <fieldset>
        <legend>Подбор движка</legend>
        <p class="hint">
          Программа ещё раз проверит скорость на процессоре и на видеокарте и выберет быстрее. Файлы заново не скачиваются. Это занимает
          пару минут, а на видеокарте при первом запуске — дольше.
        </p>
        <div class="row">
          <button onClick={onRepick}>Подобрать движок заново</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Анализ</legend>
        {VISIT_FIELDS.map((f) => (
          <label class="field" key={f.key}>
            {f.label}
            <input type="number" min={1} value={form.analysis[f.key]} onInput={(e) => setVisits(f.key, e.currentTarget.value)} />
          </label>
        ))}
      </fieldset>
      <div class="row">
        <button class="primary" disabled={status.kind === 'saving'} onClick={() => void save()}>
          Сохранить и проверить
        </button>
        <button onClick={onClose}>Назад</button>
      </div>
      {status.kind === 'saving' && <p class="status">Запускаю KataGo с новыми настройками…</p>}
      {status.kind === 'saved' && <p class="status">Сохранено, KataGo работает.</p>}
      {status.kind === 'error' && <p class="hint error">{status.text}</p>}
    </main>
  )
}
