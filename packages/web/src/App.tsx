import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { AnalysisSettings, ClientMessage, HealthResponse, InstallStatus, ResolvedSettings, ReviewData, SessionSettings, SessionView, StartsInfo, TrapsInfo } from '@joseki-dojo/shared'
import { LoaderCircle, RefreshCw } from 'lucide-preact'
import { buildStartTree } from './start-tree'
import { DojoSocket, fetchHealth, fetchInstall, fetchReview, fetchSettings, fetchStarts, fetchTraps, fetchUi, recheckHealth } from './api'
import { AppHeader } from './components/AppHeader'
import { AppUpdateBanner } from './components/AppUpdateBanner'
import { Bar } from './components/Bar'
import { ErrorBanner } from './components/ErrorBanner'
import { EngineScreen } from './screens/EngineScreen'
import { GameScreen } from './screens/GameScreen'
import { InstallScreen } from './screens/InstallScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StartScreen } from './screens/StartScreen'
import { reviewLabels, reviewTitle, sessionTitle } from './session-title'
import { applyTheme } from './theme'
import type { VariationUpdate } from './variation'

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
  // The settings of the last startSession sent: «Следующая позиция» starts with the same ones (in memory only).
  const [lastSettings, setLastSettings] = useState<SessionSettings | null>(null)
  const [install, setInstall] = useState<InstallStatus | null>(null)
  const [installChecked, setInstallChecked] = useState(false)
  // An engine update (from the banner) or a re-pick (Settings, engine screen) is on screen.
  const [engineUpdate, setEngineUpdate] = useState(false)
  const [repick, setRepick] = useState(false)
  const [traps, setTraps] = useState<TrapsInfo | null>(null)
  // Variations spec 6.2: the latest analysis of a variation position; the review keeps the results.
  const [variationUpdate, setVariationUpdate] = useState<VariationUpdate | null>(null)
  const [analysisSettings, setAnalysisSettings] = useState<AnalysisSettings | null>(null)
  const [starts, setStarts] = useState<StartsInfo | null>(null)
  const startTree = useMemo(() => buildStartTree(starts?.list ?? [], starts?.branches ?? [], starts?.groups ?? []), [starts])

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
          case 'variationAnalysis':
            setVariationUpdate(msg)
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
    setVariationUpdate(null)
  }, [socket, session?.id])

  // The saved colour theme; without the server the page keeps the system colours set by index.html.
  useEffect(() => {
    fetchUi()
      .then((u) => applyTheme(u.theme))
      .catch(() => undefined)
  }, [])

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
        setAnalysisSettings(s.analysis)
      })
      .catch(() => undefined)
  }, [ready, healthTick])

  // Traps spec 5: the «Ловушки» card is available only when the base holds traps.
  useEffect(() => {
    if (!ready) return
    fetchTraps()
      .then(setTraps)
      .catch(() => setTraps({ count: 0, verified: false }))
  }, [ready, healthTick])

  // Starts spec 5.1: the start cards are available only when the base holds positions.
  useEffect(() => {
    if (!ready) return
    fetchStarts()
      .then(setStarts)
      .catch(() => setStarts({ count: 0, list: [], branches: [], groups: [] }))
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
  const startWith = (settings: SessionSettings): void => {
    setLastSettings(settings)
    sendStarting({ type: 'startSession', settings })
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
  let crumb: string | undefined
  // The install screen comes first: a re-pick from Settings returns to Settings when it is done.
  if (engineUpdate) {
    crumb = repick ? 'Подбор движка' : 'Обновление KataGo'
    screen = <InstallScreen update repick={repick} onDone={() => void afterInstall()} onClose={closeUpdate} />
  } else if (showSettings) {
    crumb = 'Настройки'
    screen = <SettingsScreen onClose={() => setShowSettings(false)} onSaved={() => setHealthTick((n) => n + 1)} onRepick={startRepick} />
  } else if (!health || (health.state !== 'ready' && !installChecked)) {
    screen = (
      <main class="loading">
        <LoaderCircle class="spin" aria-hidden="true" />
        Загрузка…
      </main>
    )
  } else if (health.state !== 'ready' && install && !install.installed) {
    crumb = 'Установка KataGo'
    screen = <InstallScreen update={false} onDone={() => void afterInstall()} />
  } else if (health.state !== 'ready') {
    crumb = health.state === 'starting' ? 'Запуск KataGo' : 'KataGo не готов'
    screen = (
      <EngineScreen
        health={health}
        onRetry={retryHealth}
        onSettings={() => setShowSettings(true)}
        onRepick={install?.installed ? startRepick : undefined}
      />
    )
  } else if (!session) {
    crumb = 'Новая тренировка'
    screen = (
      <StartScreen
        key={defaultRank}
        defaultRank={defaultRank}
        trapsCount={traps?.count ?? 0}
        startsCount={starts?.count ?? 0}
        startTree={startTree}
        last={lastSettings}
        busy={starting || !connected}
        onStart={startWith}
      />
    )
  } else if (session.status === 'playing') {
    crumb = sessionTitle(session.settings)
    screen = <GameScreen session={session} errorSeq={errorSeq} send={send} />
  } else {
    crumb = reviewTitle(session.settings)
    screen = (
      <ReviewScreen
        review={review}
        progress={progress}
        busy={starting}
        onReplay={(turn) => sendStarting({ type: 'replayFrom', sessionId: session.id, turn })}
        onNew={resetToStart}
        onNext={lastSettings ? () => startWith(lastSettings) : null}
        labels={reviewLabels(session.settings.mode)}
        variations={{
          update: variationUpdate,
          analyze: (fromTurn, moves) => send({ type: 'analyzeVariation', sessionId: session.id, fromTurn, moves }),
          stop: () => send({ type: 'stopVariation', sessionId: session.id }),
          connected,
          errorSeq,
          visits: analysisSettings,
        }}
      />
    )
  }

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
  const nav = !inGame && !engineUpdate ? { settings: showSettings, onGame: () => setShowSettings(false), onSettings: () => setShowSettings(true) } : undefined

  return (
    <>
      <AppHeader crumb={crumb} nav={nav} />
      <AppUpdateBanner />
      {bannerText && <ErrorBanner message={bannerText} onRetry={retry} />}
      {offerEngineUpdate && (
        <Bar icon={RefreshCw} action={{ label: 'Обновить движок', onClick: () => setEngineUpdate(true), primary: true }}>
          Доступна новая проверенная версия KataGo
        </Bar>
      )}
      {versionWarning && !showSettings && <Bar tone="warning">{versionWarning}</Bar>}
      {screen}
    </>
  )
}
