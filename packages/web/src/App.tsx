import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { localize, translator, type AnalysisSettings, type ClientMessage, type HealthResponse, type InstallStatus, type Language, type LocalizedText, type ResolvedSettings, type ReviewData, type SessionSettings, type SessionView, type StartsInfo, type TrapsInfo } from '@joseki-dojo/shared'
import { LoaderCircle, RefreshCw } from 'lucide-preact'
import { buildStartTree } from './start-tree'
import { DojoSocket, failureText, fetchHealth, fetchInstall, fetchReview, fetchSettings, fetchStarts, fetchTraps, fetchUi, recheckHealth, saveLanguage } from './api'
import { I18nContext, pickLanguage, rememberLanguage, storedLanguage, type I18n } from './i18n'
import { needsLanguageScreen } from './language-gate'
import { AppHeader } from './components/AppHeader'
import { AppUpdateBanner } from './components/AppUpdateBanner'
import { Bar } from './components/Bar'
import { ErrorBanner } from './components/ErrorBanner'
import { EngineScreen } from './screens/EngineScreen'
import { GameScreen } from './screens/GameScreen'
import { InstallScreen } from './screens/InstallScreen'
import { LanguageScreen } from './screens/LanguageScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StartScreen } from './screens/StartScreen'
import { SessionFollow } from './session-follow'
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
  const [error, setError] = useState<LocalizedText | null>(null)
  const [errorSeq, setErrorSeq] = useState(0)
  const [connected, setConnected] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [versionWarning, setVersionWarning] = useState<LocalizedText | null>(null)
  const [defaultRank, setDefaultRank] = useState<string | undefined>(undefined)
  // True from sending startSession/replayFrom until the server answers (sessionState/error) or the link drops.
  const [starting, setStarting] = useState(false)
  // The settings of the last startSession sent: the review's new game and the start screen use them (in memory only).
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
  const [language, setLanguageState] = useState<Language>(storedLanguage)
  const [languageChosen, setLanguageChosen] = useState<boolean | null>(null)
  // The player picked a language (globe, settings, first screen): a late /api/ui answer must not undo it.
  const pickedByPlayer = useRef(false)

  const follow = useMemo(() => new SessionFollow(), [])
  const socket = useMemo(
    () =>
      new DojoSocket((msg) => {
        switch (msg.type) {
          case 'sessionState':
            if (!follow.acceptState(msg.session.id)) break
            setSession(msg.session)
            setStarting(false)
            setError(null)
            if (msg.session.status === 'playing') {
              setReview(null)
              setProgress(null)
            }
            break
          case 'analysisProgress':
            if (follow.concerns(msg.sessionId)) setProgress({ done: msg.done, total: msg.total })
            break
          case 'variationAnalysis':
            if (follow.concerns(msg.sessionId)) setVariationUpdate(msg)
            break
          case 'reviewReady':
            if (!follow.concerns(msg.sessionId)) break
            fetchReview(msg.sessionId)
              .then((r) => r && follow.concerns(r.sessionId) && setReview(r))
              .catch((e: unknown) => {
                setError(failureText(e))
                setErrorSeq((n) => n + 1)
              })
            break
          case 'error':
            setError(msg.text)
            setStarting(false)
            setErrorSeq((n) => n + 1)
            break
        }
      }, (isConnected) => {
        setConnected(isConnected)
        if (!isConnected) setStarting(false)
      }),
    [follow],
  )

  useEffect(() => {
    socket.sessionId = session?.id ?? null
    setVariationUpdate(null)
  }, [socket, session?.id])

  // <html lang> follows the language from the first render: it picks the shapes of the Chinese, Japanese and Korean characters.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  // The saved colour theme and language; without the server the page keeps the system colours and the remembered language.
  useEffect(() => {
    fetchUi()
      .then((u) => {
        // The language first: a failing desktop theme call must not leave the page in the wrong language.
        // Chosen while the request was on its way: the choice stays, the first screen does not come back.
        if (!pickedByPlayer.current) {
          const picked = pickLanguage(u, storedLanguage())
          setLanguageState(picked.language)
          rememberLanguage(picked.language)
          setLanguageChosen(picked.chosen)
        }
        applyTheme(u.theme)
      })
      .catch(() => undefined)
  }, [])

  const i18n = useMemo<I18n>(
    () => ({
      language,
      t: translator(language),
      chosen: languageChosen,
      setLanguage: (lang) => {
        pickedByPlayer.current = true
        setLanguageState(lang)
        rememberLanguage(lang)
        setLanguageChosen(true)
        saveLanguage(lang).catch(() => undefined) // the next start asks again; the page already shows the choice
      },
    }),
    [language, languageChosen],
  )
  // The App renders the provider, so it takes its texts from `i18n` itself rather than from the context.
  const t = i18n.t
  const rootName = t('tree.root')
  const startTree = useMemo(() => buildStartTree(starts?.list ?? [], starts?.branches ?? [], starts?.groups ?? [], rootName), [starts, rootName])

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
    follow.starting(session?.id ?? null)
    setStarting(true)
    send(msg)
  }
  const startWith = (settings: SessionSettings): void => {
    setLastSettings(settings)
    sendStarting({ type: 'startSession', settings })
  }
  const resetToStart = (): void => {
    follow.leave(session?.id ?? null)
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
  // Spec (languages) 8.2: the language screen comes before everything else, the installer included.
  // The install screen comes next: a re-pick from Settings returns to Settings when it is done.
  const languageGate = needsLanguageScreen(languageChosen)
  if (languageGate) {
    crumb = undefined
    screen = <LanguageScreen />
  } else if (engineUpdate) {
    crumb = t(repick ? 'app.crumb.repick' : 'app.crumb.engineUpdate')
    screen = <InstallScreen update repick={repick} onDone={() => void afterInstall()} onClose={closeUpdate} />
  } else if (showSettings) {
    crumb = t('app.crumb.settings')
    screen = <SettingsScreen onClose={() => setShowSettings(false)} onSaved={() => setHealthTick((n) => n + 1)} onRepick={startRepick} />
  } else if (!health || (health.state !== 'ready' && !installChecked)) {
    screen = (
      <main class="loading">
        <LoaderCircle class="spin" aria-hidden="true" />
        {t('app.loading')}
      </main>
    )
  } else if (health.state !== 'ready' && install && !install.installed) {
    crumb = t('app.crumb.install')
    screen = <InstallScreen update={false} onDone={() => void afterInstall()} />
  } else if (health.state !== 'ready') {
    crumb = t(health.state === 'starting' ? 'app.crumb.engineStarting' : 'app.crumb.engineNotReady')
    screen = (
      <EngineScreen
        health={health}
        onRetry={retryHealth}
        onSettings={() => setShowSettings(true)}
        onRepick={install?.installed ? startRepick : undefined}
      />
    )
  } else if (!session) {
    crumb = t('app.crumb.newTraining')
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
    crumb = sessionTitle(session.settings, t)
    screen = <GameScreen session={session} errorSeq={errorSeq} send={send} />
  } else {
    crumb = reviewTitle(session.settings, t)
    screen = (
      <ReviewScreen
        review={review}
        progress={progress}
        busy={starting}
        onReplay={(turn) => sendStarting({ type: 'replayFrom', sessionId: session.id, turn })}
        onNew={resetToStart}
        onNext={lastSettings ? () => startWith(lastSettings) : null}
        labels={reviewLabels(session.settings.mode, t)}
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
  const bannerText: LocalizedText | null = connected ? error : { key: 'app.disconnected' }
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
  const offerEngineUpdate = ready && install?.updateAvailable === true && !engineUpdate && !inGame && !showSettings && !reviewPending && !languageGate
  const nav = !inGame && !engineUpdate && !languageGate ? { settings: showSettings, onGame: () => setShowSettings(false), onSettings: () => setShowSettings(true) } : undefined

  return (
    <I18nContext.Provider value={i18n}>
      <AppHeader crumb={crumb} nav={nav} />
      <AppUpdateBanner />
      {bannerText && <ErrorBanner error={bannerText} onRetry={retry} />}
      {offerEngineUpdate && (
        <Bar icon={RefreshCw} action={{ label: t('app.engineUpdate.action'), onClick: () => setEngineUpdate(true), primary: true }}>
          {t('app.engineUpdate.offer')}
        </Bar>
      )}
      {versionWarning && !showSettings && <Bar tone="warning">{localize(language, versionWarning)}</Bar>}
      {screen}
    </I18nContext.Provider>
  )
}
