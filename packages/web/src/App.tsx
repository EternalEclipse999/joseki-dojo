import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { ClientMessage, HealthResponse, InstallStatus, ReviewData, SessionView } from '@joseki-dojo/shared'
import { DojoSocket, fetchHealth, fetchInstall, fetchReview, fetchSettings, recheckHealth } from './api'
import { AppUpdateBanner } from './components/AppUpdateBanner'
import { ErrorBanner } from './components/ErrorBanner'
import { EngineScreen } from './screens/EngineScreen'
import { GameScreen } from './screens/GameScreen'
import { InstallScreen } from './screens/InstallScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StartScreen } from './screens/StartScreen'

interface Progress {
  done: number
  total: number
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthTick, setHealthTick] = useState(0)
  const [session, setSession] = useState<SessionView | null>(null)
  const [review, setReview] = useState<ReviewData | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorSeq, setErrorSeq] = useState(0)
  const [connected, setConnected] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [versionWarning, setVersionWarning] = useState<string | null>(null)
  const [defaultRank, setDefaultRank] = useState<string | undefined>(undefined)
  // True from sending startSession/replayFrom until the server answers (sessionState/error) or the link drops.
  const [starting, setStarting] = useState(false)
  const [install, setInstall] = useState<InstallStatus | null>(null)
  const [installChecked, setInstallChecked] = useState(false)
  // An engine update (from the banner) or a re-pick (Settings, engine screen) is on screen.
  const [engineUpdate, setEngineUpdate] = useState(false)
  const [repick, setRepick] = useState(false)

  const socket = useMemo(
    () =>
      new DojoSocket((msg) => {
        switch (msg.type) {
          case 'sessionState':
            setSession(msg.session)
            setStarting(false)
            setError(null)
            if (msg.session.status === 'playing') {
              setReview(null)
              setProgress(null)
            }
            break
          case 'analysisProgress':
            setProgress({ done: msg.done, total: msg.total })
            break
          case 'reviewReady':
            fetchReview(msg.sessionId)
              .then((r) => r && setReview(r))
              .catch((e: Error) => {
                setError(e.message)
                setErrorSeq((n) => n + 1)
              })
            break
          case 'error':
            setError(msg.message)
            setStarting(false)
            setErrorSeq((n) => n + 1)
            break
        }
      }, (isConnected) => {
        setConnected(isConnected)
        if (!isConnected) setStarting(false)
      }),
    [],
  )

  useEffect(() => {
    socket.sessionId = session?.id ?? null
  }, [socket, session?.id])

  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      try {
        const h = await fetchHealth()
        if (cancelled) return
        setHealth(h)
        if (h.state === 'starting') setTimeout(poll, 2000)
      } catch {
        if (!cancelled) setTimeout(poll, 2000)
      }
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [healthTick])

  // Spec 5.1: is KataGo installed at all, and is the installer's KataGo older than katago.lock.json?
  useEffect(() => {
    let cancelled = false
    fetchInstall()
      .then((s) => {
        if (!cancelled) setInstall(s)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setInstallChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [healthTick])

  // Spec 6.6: warn when the running KataGo is not the version pinned in katago.lock.json.
  const ready = health?.state === 'ready'
  useEffect(() => {
    if (!ready) return
    fetchSettings()
      .then((s) => {
        setVersionWarning(s.versionWarning)
        setDefaultRank(s.defaultBotRank)
      })
      .catch(() => undefined)
  }, [ready, healthTick])

  // While a finished session has no review yet, poll for it: reviewReady may have been missed
  // (socket drop) and the server does not re-send it on resync.
  const finishedId = session?.status === 'finished' ? session.id : null
  const hasReview = review !== null
  useEffect(() => {
    if (!finishedId || hasReview) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const r = await fetchReview(finishedId)
        if (cancelled) return
        if (r) {
          setReview(r)
          return
        }
      } catch {
        // transient failure: try again on the next tick
      }
      if (!cancelled) timer = setTimeout(() => void tick(), 2000)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [finishedId, hasReview])

  const send = (msg: ClientMessage): void => socket.send(msg)
  const sendStarting = (msg: ClientMessage): void => {
    setStarting(true)
    send(msg)
  }
  const resetToStart = (): void => {
    setSession(null)
    setReview(null)
    setProgress(null)
    setError(null)
  }

  const retryHealth = async (): Promise<void> => {
    await recheckHealth().catch(() => undefined) // a failed request is shown by the re-poll below
    setHealthTick((n) => n + 1)
  }

  // The installer is done: read the state it left before leaving its screen, so that the engine screen does not flash
  // and a stale "engine update" bar does not come back. (Health is ready by now; the loop only covers a slow check.)
  const afterInstall = async (): Promise<void> => {
    let h: HealthResponse | null = null
    for (let attempt = 0; attempt < 10; attempt++) {
      h = await fetchHealth().catch(() => null)
      if (h && h.state !== 'starting') break
      await new Promise((r) => setTimeout(r, 500))
    }
    const i = await fetchInstall().catch(() => null)
    if (h) setHealth(h)
    if (i) setInstall(i)
    setEngineUpdate(false)
    setRepick(false)
    setHealthTick((n) => n + 1)
  }
  const startRepick = (): void => {
    setRepick(true)
    setEngineUpdate(true)
  }
  const closeUpdate = (): void => {
    setEngineUpdate(false)
    setRepick(false)
  }

  let screen: JSX.Element
  // The install screen comes first: a re-pick from Settings returns to Settings when it is done.
  if (engineUpdate) screen = <InstallScreen update repick={repick} onDone={() => void afterInstall()} onClose={closeUpdate} />
  else if (showSettings)
    screen = <SettingsScreen onClose={() => setShowSettings(false)} onSaved={() => setHealthTick((n) => n + 1)} onRepick={startRepick} />
  else if (!health || (health.state !== 'ready' && !installChecked)) screen = <main><p class="status">Загрузка…</p></main>
  else if (health.state !== 'ready' && install && !install.installed) screen = <InstallScreen update={false} onDone={() => void afterInstall()} />
  else if (health.state !== 'ready')
    screen = (
      <EngineScreen
        health={health}
        onRetry={retryHealth}
        onSettings={() => setShowSettings(true)}
        onRepick={install?.installed ? startRepick : undefined}
      />
    )
  else if (!session) screen = (
      <StartScreen
        key={defaultRank}
        defaultRank={defaultRank}
        busy={starting || !connected}
        onStart={(settings) => sendStarting({ type: 'startSession', settings })} />
    )
  else if (session.status === 'playing') screen = <GameScreen session={session} errorSeq={errorSeq} send={send} />
  else
    screen = (
      <ReviewScreen
        review={review}
        progress={progress}
        busy={starting}
        onReplay={(turn) => sendStarting({ type: 'replayFrom', sessionId: session.id, turn })}
        onNew={resetToStart}
      />
    )

  const inGame = session?.status === 'playing'
  const bannerText = connected ? error : 'Нет связи с сервером, переподключаюсь…'
  const retry =
    connected && session
      ? () => {
          setError(null)
          send({ type: 'resync', sessionId: session.id })
        }
      : undefined
  // Spec 5.1: offered outside a game, when the installer's KataGo is not the one pinned in katago.lock.json.
  // Not while a review is being prepared: the update stops KataGo, and the review needs it.
  const reviewPending = session?.status === 'finished' && review === null
  const offerEngineUpdate = ready && install?.updateAvailable === true && !engineUpdate && !inGame && !showSettings && !reviewPending

  return (
    <>
      <AppUpdateBanner />
      {bannerText && <ErrorBanner message={bannerText} onRetry={retry} />}
      {!inGame && !showSettings && !engineUpdate && (
        <header class="topbar">
          <button onClick={() => setShowSettings(true)}>Настройки</button>
        </header>
      )}
      {offerEngineUpdate && (
        <div class="bar">
          <span>Доступна новая проверенная версия KataGo</span>
          <button class="primary" onClick={() => setEngineUpdate(true)}>
            Обновить движок
          </button>
        </div>
      )}
      {versionWarning && !showSettings && <p class="notice">{versionWarning}</p>}
      {screen}
    </>
  )
}
