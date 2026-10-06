import type { HealthResponse } from '@joseki-dojo/shared'

export interface EngineScreenProps {
  health: HealthResponse
  onRetry: () => void
  onSettings: () => void
}

export function EngineScreen({ health, onRetry, onSettings }: EngineScreenProps) {
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
        <button onClick={onRetry}>Проверить снова</button>
      </div>
    </main>
  )
}
