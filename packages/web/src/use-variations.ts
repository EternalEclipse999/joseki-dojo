import type { Marker } from '@sabaki/shudan'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { nextColor, Position, type AnalysisSettings, type Move, type MoveVertex, type PositionReview, type Vertex } from '@joseki-dojo/shared'
import { emptyMap, isVertex, pvMoves, sameVertex } from './board-maps'
import { LABELS } from './components/CandidateList'
import {
  bestIsPass,
  candidateIndex,
  candidateLeft,
  exitTurn,
  isLegalNext,
  lossBefore,
  mergeResult,
  moveLoss,
  playInVariation,
  positionKey,
  positionTurn,
  replyVertex,
  shouldReply,
  shownMoves,
  startFromView,
  startVariation,
  stepTurn,
  stepVariation,
  variationMoves,
  type Variation,
  type VariationResult,
  type VariationUpdateLike,
} from './variation'

/** Variations spec 3–6: a screen's link to the deepening search on the server, and the visits settings. */
export interface VariationLink<U extends VariationUpdateLike = VariationUpdateLike> {
  /** The last analysis of a variation position, or null; the hook is given only the ones of its screen. */
  update: U | null
  analyze: (fromTurn: number, moves: Vertex[]) => void
  stop: () => void
  /** A search ends with its socket: the shown position is asked for again when the link is back. */
  connected: boolean
  /** Increments on every server error: a pending KataGo reply is given up. */
  errorSeq: number
  /** The visits of the stored review and the limit of a variation search; null until the settings are loaded. */
  visits: AnalysisSettings | null
}

/** What a screen explores: the moves before the first game move, the game moves, and the stored analyses. */
export interface VariationGame {
  /** The moves before game move 0 (the review: the initial moves; a problem: its setup). */
  setup: readonly Move[]
  /** The game moves (the review: the training; a problem: the answer). */
  moves: readonly Move[]
  /**
   * positions[t]: the stored analysis of the position before game move t, t = 0..moves.length. positions[0..moves.length−1]
   * are views: their candidates are shown and deepened. Only positions[moves.length], the position after the last game
   * move, may hold only a lead (no candidates, visits 0): it serves as the «before» of a move's loss, never as a list of
   * candidates.
   */
  positions: readonly PositionReview[]
  /** A view of the position before game move 0 with no move placed (turn −1): a problem's start; the review has none. */
  startView: boolean
}

/**
 * ← and → step through the moves unless the focus is in a text field (a checkbox does not take the arrows). The listener
 * calls the latest `onStep`: a key pressed right after a render, before the effects run, must not step from the view
 * shown before it.
 */
function useArrowKeys(onStep: (delta: number) => void): void {
  const latest = useRef(onStep)
  latest.current = onStep
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !target.matches('input[type=checkbox]')))) return
      if (e.key === 'ArrowLeft') latest.current(-1)
      else if (e.key === 'ArrowRight') latest.current(1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Variations spec 3–5: a variation instead of a game move, its deepening analysis and KataGo's replies; the candidates,
 * the branch and the board of the shown view. The screen renders from what it returns and keeps its own panels.
 * `setup`, `moves` and `positions` are read as given: a screen keeps them stable between renders (the board is
 * recomputed when they change). The hook's state (the shown turn, the variation, the results, «Глубже») is never reset
 * when `game` changes, so a screen mounts it once per game: the review is keyed by its session, the problem screen by
 * the answered problem.
 */
export function useVariations(game: VariationGame, variations: VariationLink) {
  const { setup, moves, positions, startView } = game
  const [turn, setTurn] = useState(0)
  const [pvStep, setPvStep] = useState<number | null>(null)
  // Candidates are chosen by their vertex: a deeper analysis may reorder the list.
  const [hotVertex, setHotVertex] = useState<MoveVertex | null>(null)
  const [selectedVertex, setSelectedVertex] = useState<MoveVertex | null>(null)
  const [variation, setVariation] = useState<Variation | null>(null)
  const [results, setResults] = useState<ReadonlyMap<string, VariationResult>>(() => new Map())
  const [autoReply, setAutoReply] = useState(true)
  // The key of the position KataGo is to answer; board clicks wait meanwhile.
  const [awaiting, setAwaiting] = useState<string | null>(null)
  // «Глубже» is on for one game position (the start view shares game move 0's).
  const [deeperTurn, setDeeperTurn] = useState<number | null>(null)
  // The key of the position where KataGo's best reply was a pass.
  const [passedKey, setPassedKey] = useState<string | null>(null)

  const { update, connected, errorSeq } = variations
  const replyVisits = variations.visits?.reviewVisits ?? null
  // The game position of the shown view: before game move `turn`; the start view (−1) shows the one before game move 0.
  const viewTurn = positionTurn(turn)
  const deeper = deeperTurn === viewTurn
  const link = useRef(variations)
  link.current = variations
  useEffect(() => {
    if (update) setResults((r) => mergeResult(r, update))
  }, [update])
  useEffect(() => setAwaiting(null), [errorSeq])

  // The position the candidates belong to: before game move `turn` (the start view: game move 0), or after the shown moves of the variation.
  const fromTurn = variation?.fromTurn ?? viewTurn
  const vMoves = useMemo(() => (variation ? shownMoves(variation) : []), [variation])
  const key = positionKey(fromTurn, vMoves)
  const base = useMemo(() => variationMoves([...setup, ...moves.slice(0, fromTurn)], vMoves), [setup, moves, fromTurn, vMoves])
  const result = results.get(key)
  // The start view and game move 0 share a position: a step between them clears the choice too.
  useEffect(() => {
    setPvStep(null)
    setHotVertex(null)
    setSelectedVertex(null)
  }, [key, turn])

  // Spec 4: the shown variation position (or a deepened game position) is searched until it is done or left.
  const live = variation !== null || deeper
  const finished = result?.done === true
  useEffect(() => {
    if (!live || finished || !connected) return
    link.current.analyze(fromTurn, vMoves)
    return () => link.current.stop()
  }, [live, key, finished, connected])

  const lastTurn = moves.length - 1
  const step = useMemo(
    () => (delta: number) => {
      if (variation) {
        // Spec 8: «←» on the first variation move leaves the variation for the game position it started from.
        if (delta < 0 && variation.step <= 1) {
          setTurn(exitTurn(variation))
          setVariation(null)
        } else setVariation(stepVariation(variation, delta))
        setAwaiting(null)
      } else setTurn((shown) => stepTurn(shown, delta, lastTurn, startView))
    },
    [variation, lastTurn, startView],
  )
  useArrowKeys(step)

  // «Глубже»: the deepened candidates replace the stored ones once they rest on more visits.
  const deepResult = !variation && deeper && result && result.visits > positions[viewTurn].visits ? result : null
  const shown = variation ? (result?.position ?? null) : (deepResult?.position ?? positions[viewTurn])
  const candidates = shown?.candidates ?? []
  const selIndex = candidateIndex(candidates, selectedVertex)
  const hot = hotVertex === null ? -1 : candidates.findIndex((c) => sameVertex(c.vertex, hotVertex))
  const sel = candidates[selIndex] ?? null
  // The chosen candidate left the list: back to the best one, and its branch is gone.
  useEffect(() => {
    if (!candidateLeft(candidates, selectedVertex)) return
    setSelectedVertex(null)
    setPvStep(null)
  }, [candidates, selectedVertex])
  const branchStep = sel && pvStep !== null ? Math.max(1, Math.min(pvStep, sel.pv.length)) : null
  const toMove = variation ? nextColor(base) : moves[viewTurn].color
  const branch = useMemo(() => (sel && branchStep !== null ? pvMoves(toMove, sel.pv, branchStep) : []), [sel, branchStep, toMove])
  // The board shows the position after the selected move (or the variation's last shown move; the start view places no
  // game move); a branch continues from the position the candidates belong to.
  const signMap = useMemo(() => {
    const onBoard = branchStep !== null ? [...base, ...branch] : variation || turn < 0 ? base : [...base, moves[turn]]
    try {
      return Position.fromMoves(onBoard).signMap()
    } catch {
      return Position.fromMoves(base).signMap()
    }
  }, [moves, turn, variation, base, branch, branchStep])

  // Spec 5: KataGo plays the best move of the latest result for the awaited position.
  const answer = (): void => {
    const r = results.get(key)
    const v = replyVertex(r)
    setAwaiting(null)
    if (bestIsPass(r)) setPassedKey(key)
    if (variation && v && isLegalNext(base, v)) setVariation(playInVariation(variation, v))
  }
  useEffect(() => {
    if (awaiting === null) return
    if (awaiting !== key || !variation) setAwaiting(null)
    else if (shouldReply(results.get(awaiting), replyVisits)) answer()
  }, [awaiting, key, results, replyVisits])

  /** The user's moves from the shown position: a variation instead of game move `turn` (the start view: game move 0), or more of the open one. */
  const play = (vertices: Vertex[], afterTurn = false): void => {
    if (awaiting !== null) return
    let next: Variation | null = variation
    for (const v of vertices) next = next ? playInVariation(next, v) : afterTurn ? startFromView(turn, v) : startVariation(viewTurn, v, turn)
    if (!next) return
    setVariation(next)
    setPassedKey(null)
    setAwaiting(autoReply ? positionKey(next.fromTurn, shownMoves(next)) : null)
  }
  // A click plays after the shown game move, or in the open variation, or after the shown branch.
  const onBoardClick = (v: Vertex): void => {
    if (awaiting !== null) return
    const pv = branch.map((m) => m.vertex)
    // Spec 8: in the game, a click plays after the shown move (the letters are only hints); a shown branch is continued.
    const plain = !variation && branchStep === null
    if (plain) {
      if (isLegalNext(turn < 0 ? base : [...base, moves[turn]], v)) play([v], true)
      return
    }
    if (!pv.every(isVertex) || !isLegalNext([...base, ...branch], v)) return
    play([...pv, v])
  }
  const backToGame = (): void => {
    if (variation) setTurn(exitTurn(variation))
    setVariation(null)
    setAwaiting(null)
  }
  const selectTurn = (n: number): void => {
    setVariation(null)
    setAwaiting(null)
    setTurn(n)
  }
  const switchAutoReply = (on: boolean): void => {
    setAutoReply(on)
    if (!on) setAwaiting(null)
  }
  const switchDeeper = (): void => setDeeperTurn(deeper ? null : viewTurn)

  // The start view marks the last setup move, as the board before the answer does.
  const last: Move | null = variation || turn < 0 ? (base.at(-1) ?? null) : moves[turn]
  const markers = emptyMap<Marker | null>(null)
  const dimmed: Vertex[] = []
  let highlighted: Vertex[] = []
  if (branchStep === null) {
    // The letters show where to play next; in the game, a candidate that is the move itself keeps its dot.
    candidates.forEach((c, i) => {
      if (!isVertex(c.vertex)) return
      if (i === hot) highlighted = [c.vertex]
      if (last && sameVertex(c.vertex, last.vertex)) return
      markers[c.vertex[1]][c.vertex[0]] = { type: 'label', label: LABELS[i] }
      if (i > 0) dimmed.push(c.vertex)
    })
    if (last && isVertex(last.vertex)) markers[last.vertex[1]][last.vertex[0]] = { type: 'point' }
  } else {
    branch.forEach((m, i) => {
      if (isVertex(m.vertex)) markers[m.vertex[1]][m.vertex[0]] = { type: 'label', label: String(i + 1) }
    })
  }

  // Spec 3: the last variation move loses against the best move of the position before it, once both are analysed.
  let lastLoss: number | null = null
  if (variation && last && result) {
    const prevMoves = vMoves.slice(0, -1)
    const before = lossBefore(prevMoves.length === 0, results.get(positionKey(fromTurn, prevMoves)), positions[fromTurn])
    if (before) lastLoss = moveLoss(last.color, before.scoreLeadBlack, result.position.scoreLeadBlack)
  }

  return {
    turn,
    selectTurn,
    step,
    variation,
    fromTurn,
    result,
    shown,
    deeper,
    deepResult,
    switchDeeper,
    candidates,
    selIndex,
    hot,
    sel,
    setHotVertex,
    setSelectedVertex,
    branchStep,
    setPvStep,
    signMap,
    markers,
    dimmed,
    highlighted,
    last,
    awaiting,
    autoReply,
    switchAutoReply,
    replyVisits,
    answer,
    passed: passedKey === key,
    play,
    onBoardClick,
    backToGame,
    lastLoss,
  }
}

/** What `useVariations` gives a screen and the panel pieces it shares (components/VariationAside). */
export type VariationState = ReturnType<typeof useVariations>
