import { useState } from 'preact/hooks'
import { CircleAlert, Gauge, LoaderCircle, RefreshCw, Settings } from 'lucide-preact'
import { localize, type HealthResponse } from '@joseki-dojo/shared'
import { useI18n } from '../i18n'

export interface EngineScreenProps {
  health: HealthResponse
  /** Re-checks KataGo; resolves when the check is done. */
  onRetry: () => Promise<void>
  onSettings: () => void
  /** KataGo's files are installed but it does not work: offers the one-click way out. */
  onRepick?: () => void
}

export function EngineScreen({ health, onRetry, onSettings, onRepick }: EngineScreenProps) {
  const [checking, setChecking] = useState(false)
  const { language } = useI18n()
  if (health.state === 'starting') {
    return (
      <main class="loading">
        <LoaderCircle class="spin" aria-hidden="true" />
        {localize(language, health.reason ?? { key: 'health.starting' })}
      </main>
    )
  }
  return (
    <main>
      <div class="page engine">
        <div class="page-head">
          <h1>KataGo не настроен</h1>
        </div>
        <p class="note error">
          <CircleAlert aria-hidden="true" />
          <span>{health.reason && localize(language, health.reason)}</span>
        </p>
        <div class="card section">
          {onRepick ? (
            <p>Файлы KataGo на месте, но она не работает. Попробуйте подобрать движок заново: программа проверит файлы и выберет подходящую сборку.</p>
          ) : (
            <>
              <p>Скачайте проверенные версии командой в папке проекта и перезапустите сервер:</p>
              <pre>npm run setup</pre>
              <p>Или укажите пути к уже установленной KataGo и сетям в настройках.</p>
            </>
          )}
        </div>
        <div class="actions">
          {onRepick && (
            <button class="primary" onClick={onRepick}>
              <Gauge aria-hidden="true" />
              Подобрать движок заново
            </button>
          )}
          <button class={onRepick ? undefined : 'primary'} onClick={onSettings}>
            <Settings aria-hidden="true" />
            Открыть настройки
          </button>
          <button
            class="ghost"
            disabled={checking}
            onClick={() => {
              setChecking(true)
              void onRetry().finally(() => setChecking(false))
            }}
          >
            <RefreshCw class={checking ? 'spin' : undefined} aria-hidden="true" />
            {checking ? 'Проверяю…' : 'Проверить снова'}
          </button>
        </div>
      </div>
    </main>
  )
}
