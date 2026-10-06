import { useEffect, useState } from 'preact/hooks'
import type { InstallStatus } from '@joseki-dojo/shared'
import { fetchInstall, startInstall } from '../api'
import { canStartInstall, downloadSizeText, fileProgressText, INSTALL_STEP_TEXT, installFinishedAtOnce, isInstalling } from '../install-format'

export interface InstallScreenProps {
  /** An engine update from the banner or a re-pick: it starts at once and can be left after a failure. */
  update: boolean
  /** The player asked to pick the engine again (the title says so instead of "update"). */
  repick?: boolean
  /** The installation finished and KataGo runs. */
  onDone: () => void
  /** Leaves a failed engine update (the previous KataGo keeps working). */
  onClose?: () => void
}

/** Spec 5: downloads and sets up KataGo with one button, polling the server once a second. */
export function InstallScreen({ update, repick = false, onDone, onClose }: InstallScreenProps) {
  const [status, setStatus] = useState<InstallStatus | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  // A first install watches from the start (an installation may already run). An update watches only after its
  // own start request, so a 'done' left over from an earlier installation is not taken for this one.
  const [watching, setWatching] = useState(!update)

  const start = async (): Promise<void> => {
    setRequestError(null)
    try {
      setStatus(await startInstall())
      setWatching(true)
    } catch (e) {
      setRequestError((e as Error).message)
    }
  }

  useEffect(() => {
    if (update) void start()
  }, [])

  useEffect(() => {
    if (!watching) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const s = await fetchInstall()
        if (cancelled) return
        setStatus(s)
        if (installFinishedAtOnce(s)) {
          onDone()
          return
        }
        if (s.step === 'done') return // a note to read: the «Продолжить» button leaves
      } catch {
        // transient failure: try again on the next tick
      }
      if (!cancelled) timer = setTimeout(() => void tick(), 1000)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [watching])

  const step = status?.step ?? 'idle'
  const running = isInstalling(step)
  const failed = step === 'failed' || requestError !== null
  const canStart = canStartInstall({ update, running, failed, installed: status?.installed })

  return (
    <main class="install">
      <h1>{repick ? 'Подбор движка KataGo' : update ? 'Обновление KataGo' : 'Нужно скачать движок KataGo'}</h1>
      {!update && !running && (
        <p>
          Joseki Dojo играет и считает с помощью KataGo — сильной программы для игры в го. Её нужно один раз скачать (
          {downloadSizeText(/linux/i.test(navigator.userAgent))}) — это займёт несколько минут. Дальше всё произойдёт само: программа
          проверит файлы и выберет, что на этом компьютере работает быстрее — процессор или видеокарта.
        </p>
      )}
      {(running || step === 'done') && <p class="status">{INSTALL_STEP_TEXT[step]}</p>}
      {status && status.files.length > 0 && (
        <ul class="files">
          {status.files.map((f) => (
            <li key={f.name}>
              <div class="row">
                <span>{f.label}</span>
                <span class="meta">{fileProgressText(f)}</span>
              </div>
              <progress max={f.total || 1} value={f.done ? f.total || 1 : f.received} />
            </li>
          ))}
        </ul>
      )}
      {step === 'done' && status?.note && <p class="hint">{status.note}</p>}
      {step === 'failed' && (
        <>
          <p class="status error">{INSTALL_STEP_TEXT.failed}</p>
          <p class="hint error">{status?.error}</p>
        </>
      )}
      {requestError && <p class="hint error">{requestError}</p>}
      <div class="row">
        {canStart && (
          <button class="primary" onClick={() => void start()}>
            {failed ? 'Попробовать снова' : 'Установить'}
          </button>
        )}
        {step === 'done' && status?.note && (
          <button class="primary" onClick={onDone}>
            Продолжить
          </button>
        )}
        {update && failed && onClose && <button onClick={onClose}>Назад</button>}
      </div>
    </main>
  )
}
