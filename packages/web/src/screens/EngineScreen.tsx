import { useState } from 'preact/hooks'
import type { HealthResponse } from '@joseki-dojo/shared'

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
  if (health.state === 'starting') {
    return (
      <main class="engine">
        <p class="status">{health.reason ?? 'KataGo запускается…'}</p>
      </main>
    )
  }
  return (
    <main class="engine">
      <h1>KataGo не настроен</h1>
      <p>{health.reason}</p>
      {onRepick ? (
        <p>Файлы KataGo на месте, но она не работает. Попробуйте подобрать движок заново: программа проверит файлы и выберет подходящую сборку.</p>
      ) : (
        <>
          <p>Скачайте проверенные версии командой в папке проекта и перезапустите сервер:</p>
          <pre>npm run setup</pre>
          <p>Или укажите пути к уже установленной KataGo и сетям в настройках.</p>
        </>
      )}
      <div class="row">
        {onRepick && (
          <button class="primary" onClick={onRepick}>
            Подобрать движок заново
          </button>
        )}
        <button class={onRepick ? undefined : 'primary'} onClick={onSettings}>
          Открыть настройки
        </button>
        <button
          disabled={checking}
          onClick={() => {
            setChecking(true)
            void onRetry().finally(() => setChecking(false))
          }}
        >
          {checking ? 'Проверяю…' : 'Проверить снова'}
        </button>
      </div>
    </main>
  )
}
