import { useState } from 'preact/hooks'
import { ArrowRight, Dice3, ListChecks, Play, Shuffle, Swords } from 'lucide-preact'
import { BOT_RANKS, DEFAULT_BOT_RANK, isBotRank, type SessionSettings, type StartListEntry } from '@joseki-dojo/shared'
import { StartList } from '../components/StartList'
import { rankLabel } from '../format'
import { RANK_MARKS, rankAt, rankIndex } from '../rank-scale'

type ModeChoice = SessionSettings['mode']
type ColorChoice = SessionSettings['userColor']
type CornerChoice = SessionSettings['corner']

const COLORS: { value: ColorChoice; label: string; hidden?: string; stone?: 'black' | 'white' }[] = [
  { value: 'B', label: 'Чёрные', stone: 'black' },
  { value: 'W', label: 'Белые', stone: 'white' },
  { value: 'random', label: 'Случайно', hidden: ' (случайный цвет)' },
]
const QUADRANTS: { value: Exclude<CornerChoice, 'random'>; label: string; cls: string }[] = [
  { value: 'TL', label: 'Левый верхний', cls: 'q-tl' },
  { value: 'TR', label: 'Правый верхний', cls: 'q-tr' },
  { value: 'BL', label: 'Левый нижний', cls: 'q-bl' },
  { value: 'BR', label: 'Правый нижний', cls: 'q-br' },
]
const SOON_ENVIRONMENTS = ['фусеки', 'лесенка', 'смешанно']

export interface StartScreenProps {
  onStart: (settings: SessionSettings) => void
  busy?: boolean
  /** Rank preselected on the strength slider (`bot.defaultRank` from the config). */
  defaultRank?: string
  /** Traps in the base; 0 disables the «Ловушки» mode. */
  trapsCount?: number
  /** Start positions in the base; 0 turns «Случайно» and «Из списка» off. */
  startsCount?: number
  /** The named list; empty turns «Из списка» off. */
  startsList?: StartListEntry[]
}

/** Spec 5: a new training — mode, corner, colour, bot strength and environment. */
export function StartScreen({ onStart, busy, defaultRank, trapsCount = 0, startsCount = 0, startsList = [] }: StartScreenProps) {
  const [mode, setMode] = useState<ModeChoice>('free')
  const [userColor, setUserColor] = useState<ColorChoice>('B')
  const [botRank, setBotRank] = useState(defaultRank && isBotRank(defaultRank) ? defaultRank : DEFAULT_BOT_RANK)
  const [corner, setCorner] = useState<CornerChoice>('random')
  const [chosenId, setStartId] = useState<string | null>(null)
  // A selection that is no longer on the list counts as empty.
  const startId = chosenId !== null && startsList.some((e) => e.id === chosenId) ? chosenId : null

  return (
    <main>
      <div class="page start">
        <div class="page-head">
          <h1>Новая тренировка</h1>
          <p>Бот разыграет с вами дзёсеки в выбранном углу и ошибётся, как живой соперник</p>
        </div>

        <div role="radiogroup" aria-label="Режим">
          <div class="label">Режим</div>
          <div class="modes">
            <label class="mode">
              <input type="radio" name="mode" checked={mode === 'free'} onChange={() => setMode('free')} />
              <Play aria-hidden="true" />
              <b>Свободно</b>
              <span class="d">любое дзёсеки</span>
            </label>
            <label class="mode">
              <input type="radio" name="mode" checked={mode === 'traps'} disabled={trapsCount === 0} onChange={() => setMode('traps')} />
              <Swords aria-hidden="true" />
              <b>Ловушки</b>
              <span class="d">{trapsCount > 0 ? 'бот разыграет известную ловушку' : 'нет базы ловушек'}</span>
            </label>
            <label class="mode">
              <input type="radio" name="mode" checked={mode === 'random'} disabled={startsCount === 0} onChange={() => setMode('random')} />
              <Dice3 aria-hidden="true" />
              <b>Случайно</b>
              <span class="d">{startsCount > 0 ? 'позиция из базы дзёсеки' : 'база стартовых позиций недоступна'}</span>
            </label>
            <label class="mode">
              <input type="radio" name="mode" checked={mode === 'list'} disabled={startsList.length === 0} onChange={() => setMode('list')} />
              <ListChecks aria-hidden="true" />
              <b>Из списка</b>
              <span class="d">{startsList.length > 0 ? 'выберите дзёсеки' : 'база стартовых позиций недоступна'}</span>
            </label>
          </div>
        </div>
        {mode === 'list' && <StartList entries={startsList} selected={startId} onSelect={setStartId} />}

        <div class="options">
          <div role="radiogroup" aria-label="Угол">
            <div class="label">Угол</div>
            <div class={corner === 'random' ? 'corner-picker random' : 'corner-picker'}>
              <MiniBoard />
              {QUADRANTS.map((q) => (
                <label key={q.value} class={q.cls}>
                  <input type="radio" name="corner" checked={corner === q.value} onChange={() => setCorner(q.value)} />
                  <span class="sr-only">{q.label}</span>
                </label>
              ))}
            </div>
            <div class="chips corner-under">
              <label class="chip">
                <input type="radio" name="corner" checked={corner === 'random'} onChange={() => setCorner('random')} />
                <Shuffle aria-hidden="true" />
                Случайный угол
              </label>
            </div>
          </div>

          <div class="stack">
            <div>
              <div class="label">Ваш цвет</div>
              <div class="segmented" role="radiogroup" aria-label="Ваш цвет">
                {COLORS.map((c) => (
                  <label key={c.value}>
                    <input type="radio" name="color" checked={userColor === c.value} onChange={() => setUserColor(c.value)} />
                    {c.stone && <span class={`stone ${c.stone}`} />}
                    {c.label}
                    {c.hidden && <span class="sr-only">{c.hidden}</span>}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div class="label rank-head">
                <span id="rank-label">Сила бота</span>
                <b>{rankLabel(botRank)}</b>
              </div>
              <input
                type="range"
                min={0}
                max={BOT_RANKS.length - 1}
                step={1}
                value={rankIndex(botRank)}
                aria-labelledby="rank-label"
                aria-valuetext={rankLabel(botRank)}
                onInput={(e) => setBotRank(rankAt(Number(e.currentTarget.value)))}
              />
              <div class="rank-marks" aria-hidden="true">
                {RANK_MARKS.map((m) => (
                  <span key={m.rank} style={{ left: `${m.at * 100}%` }}>
                    {rankLabel(m.rank)}
                  </span>
                ))}
              </div>
            </div>

            <div role="radiogroup" aria-label="Окружение">
              <div class="label">Окружение</div>
              <div class="chips">
                <label class="chip">
                  <input type="radio" name="environment" checked />
                  пустая доска
                </label>
                {SOON_ENVIRONMENTS.map((e) => (
                  <label class="chip" key={e}>
                    <input type="radio" name="environment" disabled />
                    {e} · скоро
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div class="start-actions">
          <button class="primary lg" disabled={busy || (mode === 'list' && startId === null)}
            onClick={() => onStart({ mode, environment: 'empty', userColor, botRank, corner, ...(mode === 'list' && startId ? { startId } : {}) })}
          >
            Начать тренировку
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
