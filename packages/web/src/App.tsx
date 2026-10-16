import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { localize, translator, type AnalysisSettings, type ClientMessage, type HealthResponse, type InstallStatus, type Language, type LocalizedText, type NewsId, type ProblemAnswer, type ProblemView, type Rating, type RepetitionInfo, type ResolvedSettings, type ReviewData, type SessionSettings, type SessionView, type StartCardState, type StartsInfo, type TrapsInfo, type Vertex } from '@joseki-dojo/shared'
import { LoaderCircle, RefreshCw } from 'lucide-preact'
import { buildStartTree } from './start-tree'
import { answerProblem, DojoSocket, failureText, fetchCardSummary, fetchDueCard, fetchHealth, fetchInstall, fetchNews, fetchReview, fetchSettings, fetchStartCards, fetchStarts, fetchTraps, fetchUi, markNews, rateReview, recheckHealth, saveLanguage } from './api'
import { I18nContext, pickLanguage, rememberLanguage, storedLanguage, type I18n } from './i18n'
import { needsLanguageScreen } from './language-gate'
import { afterAction, fromStartup, NO_NEWS, type NewsAction, type NewsShown } from './news'
import { AppHeader, type Section } from './components/AppHeader'
import { AppUpdateBanner } from './components/AppUpdateBanner'
import { Bar } from './components/Bar'
import { ErrorBanner } from './components/ErrorBanner'
import { EngineScreen } from './screens/EngineScreen'
import { GameScreen } from './screens/GameScreen'
import { InstallScreen } from './screens/InstallScreen'
import { LanguageScreen } from './screens/LanguageScreen'
import { ProblemScreen } from './screens/ProblemScreen'
import { RepetitionScreen } from './screens/RepetitionScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StartScreen } from './screens/StartScreen'
import { SessionFollow } from './session-follow'
import { listedName, reviewLabels, reviewTitle, sessionTitle } from './session-title'
import { applyTheme } from './theme'
import type { VariationUpdate } from './variation'

interface Progress {
  done: number
  total: number
}

/** Changes the shown repetition (the review's or the problem's) while it is still the one with this review id. */
type Retarget = (reviewId: number, change: (info: RepetitionInfo) => RepetitionInfo) => void

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthTick, setHealthTick] = useState(0)
  const [session, setSession] = useState<SessionView | null>(null)
  const [review, setReview] = useState<ReviewData | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<LocalizedText | null>(null)
  const [errorSeq, setErrorSeq] = useState(0)
  const [connected, setConnected] = useState(true)
  const [section, setSection] = useState<Section>('game')
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
  // Repetition spec 5.2: the training on screen came from the repetition queue.
  const [queue, setQueue] = useState(false)
  // Bumped when the cards change (a deleted card): the header's due count and the tree's marks are read again.
  const [cardsTick, setCardsTick] = useState(0)
  const [dueCount, setDueCount] = useState(0)
  // Repetition spec 6: the position cards' states by start id, for the marks in the «Из списка» tree.
  const [startCards, setStartCards] = useState<Record<string, StartCardState>>({})
  // The queue ran out: «На сегодня всё» on the «Повторение» tab (a flag, so that a language switch retranslates it); a section switch clears it.
  const [queueDone, setQueueDone] = useState(false)
  // Repetition spec 4.4: a re-rating in the review failed (kept as a text key, so that a language switch retranslates it).
  const [ratingError, setRatingError] = useState<LocalizedText | null>(null)
  // The latest rating click, and the latest one whose answer is applied: an earlier click's late answer must not
  // overwrite a later one, and only the latest click's failure is shown. Leaving a card (another problem, another
  // training) bumps `rateSeq` too, so that a late failure of its click is not shown on the next card's panel; a late
  // success still lands (`ratedSeq` is untouched), on the repetition with its review id only.
  const rateSeq = useRef(0)
  const ratedSeq = useRef(0)
  // Repetition spec 5.4: the queue's problem on screen, KataGo's verdict on the answer, the answer with KataGo, KataGo not
  // ready, and the answer's request failed otherwise (the banner says why; the queue's buttons let the player move on).
  const [problem, setProblem] = useState<{ id: string; view: ProblemView } | null>(null)
  const [problemAnswer, setProblemAnswer] = useState<ProblemAnswer | null>(null)
  const [judging, setJudging] = useState(false)
  const [problemUnavailable, setProblemUnavailable] = useState(false)
  const [answerFailed, setAnswerFailed] = useState(false)
  // Bumped whenever the shown problem changes: a late verdict for an earlier one is dropped, and the screen starts afresh
  // (the same card can come back at once after «Снова»).
  const problemSeq = useRef(0)
  const [language, setLanguageState] = useState<Language>(storedLanguage)
  const [languageChosen, setLanguageChosen] = useState<boolean | null>(null)
  // The player picked a language (globe, settings, first screen): a late /api/ui answer must not undo it.
  const pickedByPlayer = useRef(false)
  // A queue card's startSession is on its way: if the server refuses it or the link drops, the queue ends.
  const queueStart = useRef(false)
  // Spec (whats-new) 3.4: the novelties highlighted in the header, and the latest `seen` / `dismiss` sent.
  const [news, setNews] = useState<NewsShown>(NO_NEWS)
  const newsSeq = useRef(0)

  const follow = useMemo(() => new SessionFollow(), [])
  const socket = useMemo(() => {
    const queueStartFailed = (): void => {
      if (queueStart.current) setQueue(false)
      queueStart.current = false
    }
    return new DojoSocket(
      (msg) => {
        switch (msg.type) {
          case 'sessionState':
            if (!follow.acceptState(msg.session.id)) break
            queueStart.current = false
            setSession(msg.session)
            setStarting(false)
            setError(null)
            if (msg.session.status === 'playing') {
              setReview(null)
              setProgress(null)
              // A replay or the review's own «next» leaves the review without resetToStart: its rating click goes stale here.
              rateSeq.current++
              setRatingError(null)
              // A game is on: its review must not land under «Повторение» or «Настройки» (the switch is hidden meanwhile).
              setSection('game')
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
            // The server recorded the training's card before this message: the header's count and the tree are stale.
            setCardsTick((n) => n + 1)
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
            queueStartFailed()
            setErrorSeq((n) => n + 1)
            break
        }
      },
      (isConnected) => {
        setConnected(isConnected)
        if (isConnected) return
        setStarting(false)
        queueStartFailed()
      },
    )
  }, [follow])

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

  // Spec (whats-new) 3.4: the novelties, once per run; a failure shows no highlight and no error bar.
  useEffect(() => {
    let cancelled = false
    fetchNews()
      .then((v) => !cancelled && setNews(fromStartup(v)))
      .catch((err: unknown) => console.warn('news', err))
    return () => {
      cancelled = true
    }
  }, [])

  // Applied at once; the answer of the latest action sets the marks, an older one is dropped, a failure keeps the local change.
  const actOnNews = (id: NewsId, action: NewsAction): void => {
    const seq = ++newsSeq.current
    setNews((s) => afterAction(s, id, action, null))
    markNews(id, action)
      .then((v) => {
        if (seq === newsSeq.current) setNews((s) => afterAction(s, id, action, v))
      })
      .catch((err: unknown) => console.warn('news', err))
  }

  // Spec (whats-new) 2.1: opening the section by any path marks its novelty seen.
  useEffect(() => {
    if (section === 'repetition' && news.unseen.includes('repetition')) actOnNews('repetition', 'seen')
  }, [section, news.unseen])

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
        saveLanguage(lang).catch((e: unknown) => setError(failureText(e))) // the page already shows the choice; the banner tells that it was not saved
      },
    }),
    [language, languageChosen],
  )
  // The App renders the provider, so it takes its texts from `i18n` itself rather than from the context.
  const t = i18n.t
  const rootName = t('tree.root')
  const startTree = useMemo(() => buildStartTree(starts?.list ?? [], starts?.branches ?? [], starts?.groups ?? [], rootName, language), [starts, rootName, language])

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

  // Repetition spec 5.1, 6: the header's badge counts the cards due now and the tree marks the position cards; a finished
  // training may have added or moved one, and a section switch reads them again, so that cards falling due meanwhile show
  // up (the tab itself shows the same count).
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    fetchCardSummary()
      .then((s) => !cancelled && setDueCount(s.dueNow))
      .catch(() => !cancelled && setDueCount(0))
    fetchStartCards()
      .then((c) => !cancelled && setStartCards(c))
      .catch(() => !cancelled && setStartCards({}))
    return () => {
      cancelled = true
    }
  }, [ready, healthTick, cardsTick, session?.status, section])

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
          // As on reviewReady: the training's card was recorded with the review.
          setCardsTick((n) => n + 1)
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
    rateSeq.current++
    follow.leave(session?.id ?? null)
    setSession(null)
    setReview(null)
    setProgress(null)
    setError(null)
  }
  /** Shows a problem of the queue, or none: the previous one's verdict, pending answer and rating error go with it. */
  const openProblem = (next: { id: string; view: ProblemView } | null): void => {
    problemSeq.current++
    rateSeq.current++
    setProblem(next)
    setProblemAnswer(null)
    setJudging(false)
    setProblemUnavailable(false)
    setAnswerFailed(false)
    setRatingError(null)
  }
  // Spec (repetition) 5.2: the next due card of the queue, or back to the tab with «На сегодня всё». `starting` covers the
  // card's lookup too, so a second click (the tab's button, the review's or the problem's «Дальше») cannot start a second
  // training. A problem (5.4) opens its own screen under «Повторение»; a position starts a training.
  const startNextCard = (): void => {
    if (starting) return
    setStarting(true)
    fetchDueCard()
      .then((due) => {
        if (!due.card) {
          setStarting(false)
          setQueue(false)
          openProblem(null)
          resetToStart()
          setQueueDone(true)
          setSection('repetition')
          return
        }
        if (due.card.kind === 'move') {
          setStarting(false)
          resetToStart()
          setQueue(true)
          setQueueDone(false)
          openProblem({ id: due.card.id, view: due.card.problem })
          setSection('repetition')
          return
        }
        openProblem(null)
        setQueue(true)
        setQueueDone(false)
        resetToStart()
        setSection('game')
        queueStart.current = true
        startWith({ mode: 'list', environment: 'empty', userColor: due.card.userColor, botRank: due.card.botRank, corner: 'random', startId: due.card.startId })
      })
      .catch((e: unknown) => {
        setStarting(false)
        setError(failureText(e))
        setErrorSeq((n) => n + 1)
      })
  }

  // Repetition spec 4.4: a button of the repetition panel (the review's or the problem's) replaces the rating; the answer
  // is the repetition as rescheduled. A later repetition of the card since (null) locks the rating: the panel's note says
  // so instead of an error.
  const rate =
    (info: RepetitionInfo | undefined, retarget: Retarget) =>
    (rating: Rating): void => {
      if (!info) return
      const seq = ++rateSeq.current
      const latest = (): boolean => seq === rateSeq.current
      rateReview(info.reviewId, rating)
        .then((next) => {
          if (latest()) setRatingError(null)
          if (!next) {
            retarget(info.reviewId, (shown) => ({ ...shown, editable: false }))
            return
          }
          if (seq <= ratedSeq.current) return
          ratedSeq.current = seq
          // A lock seen meanwhile stays: the repetition never becomes the card's latest again.
          retarget(next.reviewId, (shown) => ({ ...next, editable: next.editable && shown.editable }))
          setCardsTick((n) => n + 1)
        })
        .catch((e: unknown) => {
          if (latest()) setRatingError(failureText(e))
        })
    }
  const inReview: Retarget = (reviewId, change) => setReview((r) => (r?.repetition?.reviewId === reviewId ? { ...r, repetition: change(r.repetition) } : r))
  const inProblem: Retarget = (reviewId, change) => setProblemAnswer((a) => (a?.repetition.reviewId === reviewId ? { ...a, repetition: change(a.repetition) } : a))
  const finishQueue = (): void => {
    setQueue(false)
    openProblem(null)
    resetToStart()
    setSection('repetition')
  }
  // Repetition spec 5.4: one click answers the problem, and KataGo's verdict is the card's repetition. A verdict for a
  // problem no longer shown is dropped (the counts are read again all the same).
  const answerShownProblem = (vertex: Vertex): void => {
    if (!problem || judging) return
    const seq = problemSeq.current
    const shown = (): boolean => seq === problemSeq.current
    setJudging(true)
    setAnswerFailed(false)
    answerProblem(problem.id, vertex)
      .then((answer) => {
        if (answer === 'unavailable') {
          if (shown()) setProblemUnavailable(true)
          return
        }
        setCardsTick((n) => n + 1)
        if (shown()) setProblemAnswer(answer)
      })
      .catch((e: unknown) => {
        if (!shown()) return
        setAnswerFailed(true)
        setError(failureText(e))
        setErrorSeq((n) => n + 1)
      })
      .finally(() => {
        if (shown()) setJudging(false)
      })
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
  } else if (section === 'repetition') {
    if (problem) {
      crumb = t('app.crumb.problem')
      screen = (
        <ProblemScreen
          key={problemSeq.current}
          problem={problem.view}
          answer={problemAnswer}
          judging={judging}
          unavailable={problemUnavailable}
          failed={answerFailed}
          onAnswer={answerShownProblem}
          repetition={{
            onRate: rate(problemAnswer?.repetition, inProblem),
            queue: queue ? { onNext: startNextCard, onFinish: finishQueue } : null,
            error: ratingError && localize(language, ratingError),
          }}
          busy={starting}
        />
      )
    } else {
      crumb = t('app.crumb.repetition')
      screen = <RepetitionScreen tree={startTree} busy={starting || !connected || !ready} notice={queueDone ? t('repetition.doneToday') : null} onStartQueue={startNextCard} onChanged={() => setCardsTick((n) => n + 1)} />
    }
  } else if (section === 'settings') {
    crumb = t('app.crumb.settings')
    screen = <SettingsScreen onClose={() => setSection('game')} onSaved={() => setHealthTick((n) => n + 1)} onRepick={startRepick} />
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
        onSettings={() => setSection('settings')}
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
        cards={startCards}
        busy={starting || !connected}
        onStart={(s) => {
          setQueue(false)
          startWith(s)
        }}
      />
    )
  } else if (session.status === 'playing') {
    crumb = sessionTitle(session.settings, t, listedName(startTree, session.settings.start))
    screen = <GameScreen session={session} errorSeq={errorSeq} send={send} />
  } else {
    crumb = reviewTitle(session.settings, t, listedName(startTree, session.settings.start))
    screen = (
      <ReviewScreen
        review={review}
        progress={progress}
        busy={starting}
        onReplay={(turn) => sendStarting({ type: 'replayFrom', sessionId: session.id, turn })}
        onNew={() => {
          setQueue(false)
          resetToStart()
        }}
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
        repetition={{
          onRate: rate(review?.repetition, inReview),
          // The review's own «next» button still replays the position; the queue goes on from the panel.
          queue: queue ? { onNext: startNextCard, onFinish: finishQueue } : null,
          error: ratingError && localize(language, ratingError),
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
  const offerEngineUpdate = ready && install?.updateAvailable === true && !engineUpdate && !inGame && section !== 'settings' && !reviewPending && !languageGate
  const goSection = (s: Section): void => {
    setQueueDone(false)
    // The problem screen lives under «Повторение»: leaving it for another section, or for the tab itself, ends the
    // queue and drops the problem. A queue's training keeps its «Дальше» / «Закончить» over a trip elsewhere.
    if (problem) {
      setQueue(false)
      openProblem(null)
    }
    setSection(s)
  }
  const nav =
    !inGame && !engineUpdate && !languageGate
      ? {
          section,
          onSection: goSection,
          due: dueCount,
          news: { unseen: news.unseen, callout: news.callout, onOpen: () => goSection('repetition'), onDismiss: (id: NewsId) => actOnNews(id, 'dismiss') },
        }
      : undefined

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
      {versionWarning && section !== 'settings' && <Bar tone="warning">{localize(language, versionWarning)}</Bar>}
      {screen}
    </I18nContext.Provider>
  )
}
