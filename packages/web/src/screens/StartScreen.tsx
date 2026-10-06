import { useState } from 'preact/hooks'
import { BOT_RANKS, DEFAULT_BOT_RANK, type SessionSettings } from '@joseki-dojo/shared'
import { rankLabel } from '../format'

type ColorChoice = SessionSettings['userColor']
type CornerChoice = SessionSettings['corner']

const COLORS: [ColorChoice, string][] = [
  ['B', 'Чёрные'],
  ['W', 'Белые'],
  ['random', 'Случайный цвет'],
]
const CORNERS: [CornerChoice, string][] = [
  ['TL', 'Левый верхний'],
  ['TR', 'Правый верхний'],
  ['BL', 'Левый нижний'],
  ['BR', 'Правый нижний'],
  ['random', 'Случайный угол'],
]
const SOON_MODES = ['Случайно', 'Из списка']
const SOON_ENVIRONMENTS = ['Фусеки', 'Лесенка', 'Смешанно']

export function StartScreen({ onStart, busy }: { onStart: (settings: SessionSettings) => void; busy?: boolean }) {
  const [userColor, setUserColor] = useState<ColorChoice>('B')
  const [botRank, setBotRank] = useState(DEFAULT_BOT_RANK)
  const [corner, setCorner] = useState<CornerChoice>('random')

  return (
    <main class="start">
      <h1>Joseki Dojo</h1>
      <fieldset>
        <legend>Режим</legend>
        <label>
          <input type="radio" name="mode" checked /> Свободно
        </label>
        {SOON_MODES.map((m) => (
          <label class="soon" key={m}>
            <input type="radio" name="mode" disabled /> {m} <small>скоро</small>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Окружение</legend>
        <label>
          <input type="radio" name="environment" checked /> Пусто
        </label>
        {SOON_ENVIRONMENTS.map((e) => (
          <label class="soon" key={e}>
            <input type="radio" name="environment" disabled /> {e} <small>скоро</small>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Ваш цвет</legend>
        {COLORS.map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="color" checked={userColor === value} onChange={() => setUserColor(value)} /> {label}
          </label>
        ))}
      </fieldset>
      <label class="field">
        Ранг бота
        <select value={botRank} onChange={(e) => setBotRank(e.currentTarget.value)}>
          {BOT_RANKS.map((r) => (
            <option key={r} value={r}>
              {rankLabel(r)}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Угол</legend>
        {CORNERS.map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="corner" checked={corner === value} onChange={() => setCorner(value)} /> {label}
          </label>
        ))}
      </fieldset>
      <div class="row">
        <button class="primary" disabled={busy} onClick={() => onStart({ mode: 'free', environment: 'empty', userColor, botRank, corner })}>
          Начать
        </button>
      </div>
    </main>
  )
}
