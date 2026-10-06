import { useState } from 'preact/hooks'
import type { HealthResponse } from '@joseki-dojo/shared'

export interface EngineScreenProps {
  health: HealthResponse
  /** Re-checks KataGo; resolves when the check is done. */
  onRetry: () => Promise<void>
  onSettings: () => void
}

export function EngineScreen({ health, onRetry, onSettings }: EngineScreenProps) {
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
      <p>Скачайте проверенные версии командой в папке проекта и перезапустите сервер:</p>
      <pre>npm run setup</pre>
      <p>Или укажите пути к уже установленной KataGo и сетям в настройках.</p>
      <div class="row">
        <button class="primary" onClick={onSettings}>
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
