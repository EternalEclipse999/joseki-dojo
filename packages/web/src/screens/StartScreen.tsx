import { useState } from 'preact/hooks'
import { ArrowRight, Dice3, ListChecks, Play, Shuffle, Swords } from 'lucide-preact'
import { BOT_RANKS, DEFAULT_BOT_RANK, isBotRank, type MessageKey, type SessionSettings, type StartCardState } from '@joseki-dojo/shared'
import { StartTree } from '../components/StartTree'
import { rankLabel } from '../format'
import { useI18n } from '../i18n'
import { RANK_MARKS, rankAt, rankIndex } from '../rank-scale'
import { buildStartTree, findById, findNode, nodeTitle, type StartTreeNode } from '../start-tree'

type ModeChoice = SessionSettings['mode']
type ColorChoice = SessionSettings['userColor']
type CornerChoice = SessionSettings['corner']

const COLORS: { value: ColorChoice; label: MessageKey; hidden?: MessageKey; stone?: 'black' | 'white' }[] = [
  { value: 'B', label: 'start.color.black', stone: 'black' },
  { value: 'W', label: 'start.color.white', stone: 'white' },
  { value: 'random', label: 'start.color.random', hidden: 'start.color.randomHint' },
]
const QUADRANTS: { value: Exclude<CornerChoice, 'random'>; label: MessageKey; cls: string }[] = [
  { value: 'TL', label: 'start.corner.topLeft', cls: 'q-tl' },
  { value: 'TR', label: 'start.corner.topRight', cls: 'q-tr' },
  { value: 'BL', label: 'start.corner.bottomLeft', cls: 'q-bl' },
  { value: 'BR', label: 'start.corner.bottomRight', cls: 'q-br' },
]
const SOON_ENVIRONMENTS: MessageKey[] = ['start.environment.fuseki', 'start.environment.ladder', 'start.environment.mixed']
/** Spec (starts) 5.1: the last current node of the tree, remembered in the browser. */
const TREE_KEY = 'joseki-dojo.start-tree'
const readTreeKey = (): string => {
  try {
    return localStorage.getItem(TREE_KEY) ?? ''
  } catch {
    return ''
  }
}
const writeTreeKey = (key: string): void => {
  try {
    localStorage.setItem(TREE_KEY, key)
  } catch {
    // Storage is off: the tree opens at its root next time.
  }
}

export interface StartScreenProps {
  onStart: (settings: SessionSettings) => void
  busy?: boolean
  /** Rank preselected on the strength slider (`bot.defaultRank` from the config). */
  defaultRank?: string
  /** Traps in the base; 0 disables the «Ловушки» mode. */
  trapsCount?: number
  /** Start positions in the base; 0 turns «Случайно» and «Из списка» off. */
  startsCount?: number
  /** The tree of the named list (starts spec 5.1); a root without children turns «Из списка» off. */
  startTree?: StartTreeNode
  /** The settings of the last training: the screen opens with them, and the tree on its node (starts spec 5.1). */
  last?: SessionSettings | null
  /** Repetition spec 6: the position cards' states by start id, marked in the tree. */
  cards?: Record<string, StartCardState>
}

/** Spec 5: a new training — mode, corner, colour, bot strength and environment. */
// The node of the last trained start (remembered for the next reload), else the stored key.
const initialTreeKey = (tree: StartTreeNode, lastStartId: string | null): string => {
  const trained = lastStartId ? findById(tree, lastStartId)?.key : null
  if (trained) {
    writeTreeKey(trained)
    return trained
  }
  return readTreeKey()
}

export function StartScreen({ onStart, busy, defaultRank, trapsCount = 0, startsCount = 0, startTree: tree, last = null, cards }: StartScreenProps) {
  const { t, language } = useI18n()
  // Without a tree: the empty corner alone, which turns «Из списка» off.
  const startTree = tree ?? buildStartTree([], [], [], t('tree.root'), language)
  const listReady = startTree.children.length > 0
  const available = (m: ModeChoice): boolean => (m === 'traps' ? trapsCount > 0 : m === 'random' ? startsCount > 0 : m === 'list' ? listReady : true)
  const [mode, setMode] = useState<ModeChoice>(last && available(last.mode) ? last.mode : 'free')
  const [userColor, setUserColor] = useState<ColorChoice>(last?.userColor ?? 'B')
  const [botRank, setBotRank] = useState(last && isBotRank(last.botRank) ? last.botRank : defaultRank && isBotRank(defaultRank) ? defaultRank : DEFAULT_BOT_RANK)
  const [corner, setCorner] = useState<CornerChoice>(last?.corner ?? 'random')
  const [currentKey, setCurrentKey] = useState<string>(() => initialTreeKey(startTree, last?.mode === 'list' ? (last.startId ?? null) : null))
  const current = findNode(startTree, currentKey) ?? startTree
  // Spec (starts) 5.1: any node but the empty corner can be started from.
  const startId = current.id
  const pick = (node: StartTreeNode): void => {
    setCurrentKey(node.key)
    writeTreeKey(node.key)
  }
  const canStart = !busy && !(mode === 'list' && startId === null)
  const start = (): void => {
    if (canStart) onStart({ mode, environment: 'empty', userColor, botRank, corner, ...(mode === 'list' && startId ? { startId } : {}) })
  }

  return (
    <main>
      <div class={`page start${mode === 'list' ? ' wide' : ''}`}>
        <div class="page-head">
          <h1>{t('start.title')}</h1>
          <p>{t('start.subtitle')}</p>
        </div>

        <div role="radiogroup" aria-label={t('start.mode.label')}>
          <div class="label">{t('start.mode.label')}</div>
          <div class="modes">
            <label class="mode">
              <input type="radio" name="mode" checked={mode === 'free'} onChange={() => setMode('free')} />
              <Play aria-hidden="true" />
              <b>{t('start.mode.free')}</b>
              <span class="d">{t('start.mode.freeHint')}</span>
            </label>
            <label class="mode">
              <input type="radio" name="mode" checked={mode === 'traps'} disabled={trapsCount === 0} onChange={() => setMode('traps')} />
              <Swords aria-hidden="true" />
              <b>{t('start.mode.traps')}</b>
              <span class="d">{t(trapsCount > 0 ? 'start.mode.trapsHint' : 'start.mode.trapsMissing')}</span>
            </label>
            <label class="mode">
              <input type="radio" name="mode" checked={mode === 'random'} disabled={startsCount === 0} onChange={() => setMode('random')} />
              <Dice3 aria-hidden="true" />
              <b>{t('start.mode.random')}</b>
              <span class="d">{t(startsCount > 0 ? 'start.mode.randomHint' : 'start.mode.startsMissing')}</span>
            </label>
            <label class="mode">
              <input type="radio" name="mode" checked={mode === 'list'} disabled={!listReady} onChange={() => setMode('list')} />
              <ListChecks aria-hidden="true" />
              <b>{t('start.mode.list')}</b>
              <span class="d">{t(listReady ? 'start.mode.listHint' : 'start.mode.startsMissing')}</span>
            </label>
          </div>
        </div>
        {mode === 'list' && <StartTree root={startTree} current={current} onCurrent={pick} onStart={start} cards={cards} />}

        <div class="options">
          <div role="radiogroup" aria-label={t('start.corner.label')}>
            <div class="label">{t('start.corner.label')}</div>
            <div class={corner === 'random' ? 'corner-picker random' : 'corner-picker'}>
              <MiniBoard />
              {QUADRANTS.map((q) => (
                <label key={q.value} class={q.cls}>
                  <input type="radio" name="corner" checked={corner === q.value} onChange={() => setCorner(q.value)} />
                  <span class="sr-only">{t(q.label)}</span>
                </label>
              ))}
            </div>
            <div class="chips corner-under">
              <label class="chip">
                <input type="radio" name="corner" checked={corner === 'random'} onChange={() => setCorner('random')} />
                <Shuffle aria-hidden="true" />
                {t('start.corner.random')}
              </label>
            </div>
          </div>

          <div class="stack">
            <div>
              <div class="label">{t('start.color.label')}</div>
              <div class="segmented" role="radiogroup" aria-label={t('start.color.label')}>
                {COLORS.map((c) => (
                  <label key={c.value}>
                    <input type="radio" name="color" checked={userColor === c.value} onChange={() => setUserColor(c.value)} />
                    {c.stone && <span class={`stone ${c.stone}`} />}
                    {t(c.label)}
                    {c.hidden && <span class="sr-only"> {t(c.hidden)}</span>}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div class="label rank-head">
                <span id="rank-label">{t('start.rank.label')}</span>
                <b>{rankLabel(botRank, t)}</b>
              </div>
              <input
                type="range"
                min={0}
                max={BOT_RANKS.length - 1}
                step={1}
                value={rankIndex(botRank)}
                aria-labelledby="rank-label"
                aria-valuetext={rankLabel(botRank, t)}
                onInput={(e) => setBotRank(rankAt(Number(e.currentTarget.value)))}
              />
              <div class="rank-marks" aria-hidden="true">
                {RANK_MARKS.map((m) => (
                  <span key={m.rank} style={{ left: `${m.at * 100}%` }}>
                    {rankLabel(m.rank, t)}
                  </span>
                ))}
              </div>
            </div>

            <div role="radiogroup" aria-label={t('start.environment.label')}>
              <div class="label">{t('start.environment.label')}</div>
              <div class="chips">
                <label class="chip">
                  <input type="radio" name="environment" checked />
                  {t('start.environment.empty')}
                </label>
                {SOON_ENVIRONMENTS.map((e) => (
                  <label class="chip" key={e}>
                    <input type="radio" name="environment" disabled />
                    {t('start.environment.soon', { name: t(e) })}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div class="start-actions">
          {mode === 'list' && <span class="start-pick">{startId ? nodeTitle(current) : t('start.pickHint')}</span>}
          <button class="primary lg" disabled={!canStart} onClick={start}>
            {t('start.begin')}
            <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </div>
    </main>
  )
}

const LINES = Array.from({ length: 19 }, (_, i) => 10 + (i * 176) / 18)
const STARS = [3, 9, 15].flatMap((x) => [3, 9, 15].map((y) => [LINES[x], LINES[y]]))

/** The board behind the corner picker. */
function MiniBoard() {
  return (
    <svg viewBox="0 0 196 196" aria-hidden="true">
      <g stroke="var(--board-line)" stroke-width="0.6">
        {LINES.map((p) => (
          <path key={`h${p}`} d={`M10 ${p}H186`} />
        ))}
        {LINES.map((p) => (
          <path key={`v${p}`} d={`M${p} 10V186`} />
        ))}
      </g>
      <g fill="var(--board-line)">
        {STARS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />
        ))}
      </g>
    </svg>
  )
}
