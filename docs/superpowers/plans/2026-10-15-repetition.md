# Repetition, iteration 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player's level with thresholds calibrated per level, position cards scheduled by FSRS, the «Повторение» tab with a queue, and progress marks in the «Из списка» tree (spec `docs/superpowers/specs/2026-10-15-repetition-design.md`, iteration 1).

**Architecture:** The server gets a thresholds table (`packages/server/bases/thresholds.json`, written by a GPU calibration script) and picks the thresholds of the configured player level for every review. A new `cards` module (SQLite tables, an FSRS wrapper around `ts-fsrs`, a card service) records a position card review whenever the review of a training from a listed start is computed, and serves the tab, the queue and the tree through `/api/cards/*`. The web adds a third header section, a repetition screen, a grade panel in the review and progress marks in the tree.

**Tech Stack:** TypeScript, Node 24, Fastify, better-sqlite3, `ts-fsrs` 5.4.2, Preact, Vitest, Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-15-repetition-design.md` (sections 3, 4 without move cards, 5.1–5.3, 6, 7 without the answer route, 8, 9; section 10 item 1).
- Levels: `20k` … `1k`, `1d` … `9d`, `pro` (30 values, weakest first); config `player.level`, default `7k`. Human SL profiles: `rank_<level>` for `20k` … `9d`, `proyear_2023` for `pro`.
- Thresholds file `packages/server/bases/thresholds.json`; per level `inaccuracy`, `mistake`, `blunder`; valid only if every level is present, `0 < inaccuracy < mistake < blunder`, and no value grows from a weaker to a stronger level; `punished = inaccuracy` of the level. Missing or invalid file: the config thresholds for every level (defaults 0.5 / 2 / 5, punished 1) and one log line.
- Calibration defaults: 400 positions (seeded sample of the normal starts), 2000 visits, coverage 0.98 of each level's policy, quantiles: `inaccuracy` exceeded by 25 % of the level's moves, `mistake` by 10 %, `blunder` by 3 %; rounding to 0.05, floor 0.05, non-increasing by level.
- FSRS: `ts-fsrs` 5.4.2 (exact version), request retention 0.9, fuzz off, short-term steps on. The day starts at 04:00 local time.
- Auto rating of a position training: the worst category of the user's in-zone moves after the start, an unpunished bot mistake counting as a mistake: `exact` → good, `inaccuracy` → hard, `mistake` / `blunder` / unpunished → again; `easy` only by the button. A training without user moves is not a review.
- A replaced rating is allowed only for the card's latest review and reschedules from the state before that review.
- User-facing text: every new message in all six catalogs (`packages/shared/src/i18n/{ru,en,ja,ko,zh-Hans,zh-Hant}.ts`, flat dotted keys; `ru` is the model; plurals by `count` with the categories `Intl.PluralRules` reports). Rating labels: ru Снова / Трудно / Хорошо / Легко; en Again / Hard / Good / Easy; ja もう一度 / 難しい / 正解 / 簡単; ko 다시 / 어려움 / 알맞음 / 쉬움; zh-Hans 重来 / 困难 / 良好 / 简单; zh-Hant 重來 / 困難 / 良好 / 簡單. Go terms follow `docs/superpowers/specs/2026-10-14-languages-glossary.md`.
- Code, comments, commits in English. No mention of the online joseki dictionary or the pro-game database in the repository.
- Commit identity: the repository's configured one. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Player levels and the thresholds table

**Files:**
- Modify: `packages/shared/src/types.ts`, `packages/shared/src/types.test.ts`
- Modify: `packages/server/src/config.ts`, `config.example.json`
- Create: `packages/server/src/review/thresholds.ts`, `packages/server/src/review/thresholds.test.ts`
- Modify: `packages/server/src/review/service.ts`, `packages/server/src/review/service.test.ts`
- Modify: `packages/server/src/start.ts`, `packages/server/src/app.ts`, `packages/server/src/main.ts`, `packages/desktop/src/main.ts`

**Interfaces:**
- Produces: shared `PLAYER_LEVELS: readonly string[]`, `isPlayerLevel(s: string): boolean`, `DEFAULT_PLAYER_LEVEL = '7k'`, `humanProfile(level: string): string`; server `ThresholdTable`, `parseThresholdTable(json: string): ThresholdTable` (throws `ThresholdsError`), `loadThresholds(file: string | null | undefined, log: (line: string) => void): ThresholdTable | null`, `thresholdsFor(level: string, table: ThresholdTable | null, fallback: Thresholds): Thresholds`; `AppConfig.player: { level: string }`; `ServiceOptions.thresholds?: ThresholdTable | null`; `ReviewServiceDeps.thresholds?: ThresholdTable | null`; `StartOptions.thresholdsFile?: string | null`.

- [ ] **Step 1: Levels in `packages/shared/src/types.ts`** — after `isBotRank`:

```ts
/** Spec (repetition) 3.1: the player's level — the bot ranks, weakest first, then «профи». */
export const PLAYER_LEVELS: readonly string[] = [...BOT_RANKS, 'pro']
export const isPlayerLevel = (s: string): boolean => PLAYER_LEVELS.includes(s)
export const DEFAULT_PLAYER_LEVEL = '7k'
/** The human SL profile of a level: `rank_7k` … `rank_9d`, `proyear_2023` for «профи». */
export const humanProfile = (level: string): string => (level === 'pro' ? 'proyear_2023' : `rank_${level}`)
```

Test in `types.test.ts`:

```ts
  it('lists the player levels: the bot ranks, then pro', () => {
    expect(PLAYER_LEVELS).toHaveLength(30)
    expect([PLAYER_LEVELS[0], PLAYER_LEVELS[28], PLAYER_LEVELS[29]]).toEqual(['20k', '9d', 'pro'])
    expect([isPlayerLevel('pro'), isPlayerLevel('7k'), isPlayerLevel('10p')]).toEqual([true, true, false])
    expect([humanProfile('7k'), humanProfile('pro')]).toEqual(['rank_7k', 'proyear_2023'])
  })
```

- [ ] **Step 2: Config `player.level`** — in `packages/server/src/config.ts`: `AppConfig` gets `player: { level: string }`; `DEFAULT_CONFIG.player = { level: DEFAULT_PLAYER_LEVEL }`; the merge gets `player: { ...DEFAULT_CONFIG.player, ...raw.player },`; `validate` gets

```ts
  if (!isPlayerLevel(c.player.level)) throw new ConfigError(`player.level is not a valid level: ${c.player.level}`)
```

`config.example.json` gets `"player": { "level": "7k" }` next to `"bot"`. Add a config test next to the existing `bot.defaultRank` test (in the config test file): a raw `{ "player": { "level": "pro" } }` loads; `{ "player": { "level": "10p" } }` throws `player.level is not a valid level: 10p`.

- [ ] **Step 3: Failing tests `packages/server/src/review/thresholds.test.ts`**

```ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAYER_LEVELS } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../test/helpers'
import { DEFAULT_CONFIG } from '../config'
import { loadThresholds, parseThresholdTable, thresholdsFor, type ThresholdTable } from './thresholds'

/** A valid table: thresholds shrink by 0.1 per level from 20k. */
const table = (): ThresholdTable => ({
  method: { positions: 400 },
  levels: Object.fromEntries(PLAYER_LEVELS.map((l, i) => [l, { inaccuracy: 1.5 - i * 0.03, mistake: 5 - i * 0.1, blunder: 12 - i * 0.3 }])),
})

describe('the thresholds table', () => {
  it('reads a valid table', () => {
    const t = parseThresholdTable(JSON.stringify(table()))
    expect(t.levels['20k']).toEqual({ inaccuracy: 1.5, mistake: 5, blunder: 12 })
  })

  it('refuses a missing level, a wrong order and a threshold growing with the level', () => {
    const missing = table()
    delete missing.levels.pro
    expect(() => parseThresholdTable(JSON.stringify(missing))).toThrow('no thresholds for pro')
    const order = table()
    order.levels['5k'] = { inaccuracy: 2, mistake: 1, blunder: 3 }
    expect(() => parseThresholdTable(JSON.stringify(order))).toThrow('5k: need 0 < inaccuracy < mistake < blunder')
    const grows = table()
    grows.levels['1d'] = { ...grows.levels['1d'], mistake: grows.levels['1k'].mistake + 0.5, blunder: 20 }
    expect(() => parseThresholdTable(JSON.stringify(grows))).toThrow('1d: mistake is larger than at 1k')
    expect(() => parseThresholdTable('[]')).toThrow()
  })

  it('takes the level from the table and punished = inaccuracy, else the config thresholds', () => {
    const t = table()
    expect(thresholdsFor('20k', t, DEFAULT_CONFIG.thresholds)).toEqual({ inaccuracy: 1.5, mistake: 5, blunder: 12, punished: 1.5 })
    expect(thresholdsFor('20k', null, DEFAULT_CONFIG.thresholds)).toEqual(DEFAULT_CONFIG.thresholds)
  })

  it('loads a file, logs and returns null for a missing or broken one', () => {
    const dir = tempDir()
    const good = join(dir, 'thresholds.json')
    writeFileSync(good, JSON.stringify(table()))
    const lines: string[] = []
    expect(loadThresholds(good, (l) => lines.push(l))?.levels.pro).toBeDefined()
    expect(lines).toEqual([])
    expect(loadThresholds(join(dir, 'none.json'), (l) => lines.push(l))).toBeNull()
    writeFileSync(join(dir, 'bad.json'), '{}')
    expect(loadThresholds(join(dir, 'bad.json'), (l) => lines.push(l))).toBeNull()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^Таблица порогов недоступна, действуют пороги из конфига: /)
    expect(loadThresholds(null, (l) => lines.push(l))).toBeNull()
    expect(lines).toHaveLength(2)
  })
})
```

Run: `npx vitest run packages/server/src/review/thresholds.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: `packages/server/src/review/thresholds.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs'
import { PLAYER_LEVELS } from '@joseki-dojo/shared'
import type { Thresholds } from '../config'

/** Spec (repetition) 3.2: the category thresholds of one level, in points. */
export interface LevelThresholds {
  inaccuracy: number
  mistake: number
  blunder: number
}

/** Spec (repetition) 3.2–3.3: the calibrated table; `method` records how it was made. */
export interface ThresholdTable {
  method: Record<string, unknown>
  levels: Record<string, LevelThresholds>
}

export class ThresholdsError extends Error {}

const KEYS = ['inaccuracy', 'mistake', 'blunder'] as const

/** Spec (repetition) 3.2: every level, `0 < inaccuracy < mistake < blunder`, no threshold larger than at a weaker level. */
export function parseThresholdTable(json: string): ThresholdTable {
  const raw = JSON.parse(json) as unknown
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ThresholdsError('not a JSON object')
  const levels = (raw as { levels?: unknown }).levels
  if (typeof levels !== 'object' || levels === null) throw new ThresholdsError('no levels')
  const out: Record<string, LevelThresholds> = {}
  let weaker: [string, LevelThresholds] | null = null
  for (const level of PLAYER_LEVELS) {
    const t = (levels as Record<string, unknown>)[level] as Partial<LevelThresholds> | undefined
    if (!t || KEYS.some((k) => typeof t[k] !== 'number' || !Number.isFinite(t[k]))) throw new ThresholdsError(`no thresholds for ${level}`)
    const v: LevelThresholds = { inaccuracy: t.inaccuracy!, mistake: t.mistake!, blunder: t.blunder! }
    if (!(0 < v.inaccuracy && v.inaccuracy < v.mistake && v.mistake < v.blunder)) throw new ThresholdsError(`${level}: need 0 < inaccuracy < mistake < blunder`)
    if (weaker) for (const k of KEYS) if (v[k] > weaker[1][k]) throw new ThresholdsError(`${level}: ${k} is larger than at ${weaker[0]}`)
    out[level] = v
    weaker = [level, v]
  }
  const method = (raw as { method?: unknown }).method
  return { method: typeof method === 'object' && method !== null ? (method as Record<string, unknown>) : {}, levels: out }
}

/** Spec (repetition) 3.2: null (and one log line) when the file is missing or invalid; no line when no file is configured. */
export function loadThresholds(file: string | null | undefined, log: (line: string) => void): ThresholdTable | null {
  if (!file) return null
  try {
    if (!existsSync(file)) throw new ThresholdsError(`no file ${file}`)
    return parseThresholdTable(readFileSync(file, 'utf8'))
  } catch (err) {
    log(`Таблица порогов недоступна, действуют пороги из конфига: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** Spec (repetition) 3.2: the level's thresholds; `punished` is the level's inaccuracy. Without a table — the config's. */
export function thresholdsFor(level: string, table: ThresholdTable | null, fallback: Thresholds): Thresholds {
  const t = table?.levels[level]
  return t ? { ...t, punished: t.inaccuracy } : fallback
}
```

Run the test — Expected: PASS.

- [ ] **Step 5: The review uses the level** — `packages/server/src/review/service.ts`: `ReviewServiceDeps` gets `/** Spec (repetition) 3.2: the calibrated table; null — the config thresholds. */ thresholds?: ThresholdTable | null`; in `assemble`, replace `thresholds: this.d.config.thresholds,` with

```ts
      thresholds: thresholdsFor(this.d.config.player.level, this.d.thresholds ?? null, this.d.config.thresholds),
```

Add to `service.test.ts` a test: with `thresholds` set to a table where the configured level has `mistake: 0.5` (build it like the helper above but with small values), a move losing 1 point (use the existing `engine.lead` pattern) is categorized `mistake`, while without the table it is `inaccuracy`.

- [ ] **Step 6: Loading** — `packages/server/src/start.ts`: `StartOptions` (the options interface next to `trapsFile`) gets `/** Spec (repetition) 3.2: packages/server/bases/thresholds.json; missing — the config thresholds. */ thresholdsFile?: string | null`; next to `loadTraps(...)` add `const thresholds = loadThresholds(options.thresholdsFile, log)` and pass `thresholds` in the `ServiceOptions` given to `createServices`. `packages/server/src/app.ts`: `ServiceOptions` gets `thresholds?: ThresholdTable | null`; `createServices` passes `thresholds: options.thresholds ?? null` to `new ReviewService({ ... })`. `packages/server/src/main.ts`: `thresholdsFile: process.env.JOSEKI_THRESHOLDS ?? join(repoRoot, 'packages', 'server', 'bases', 'thresholds.json'),`. `packages/desktop/src/main.ts`: `thresholdsFile: app.isPackaged ? join(resourcesDir, 'bases', 'thresholds.json') : join(resourcesDir, 'packages', 'server', 'bases', 'thresholds.json'),` next to `startsFile`.

- [ ] **Step 7: Run everything** — `npm test && npm run typecheck` — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared packages/server packages/desktop config.example.json
git commit -m "feat(levels): the player's level and the calibrated thresholds table" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The level in Settings

**Files:**
- Create: `packages/server/src/settings/player.ts`, `packages/server/src/settings/player.test.ts`, `packages/server/src/api/player-routes.ts`
- Modify: `packages/server/src/app.ts`, `packages/server/src/api/api.test.ts`
- Modify: `packages/shared/src/settings.ts`, `packages/shared/src/i18n/{ru,en,ja,ko,zh-Hans,zh-Hant}.ts`
- Modify: `packages/web/src/api.ts`, `packages/web/src/format.ts`, `packages/web/src/format.test.ts`, `packages/web/src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `PLAYER_LEVELS`, `isPlayerLevel`, `AppConfig.player` (Task 1); `updateConfigFile(file, mutate)` from `packages/server/src/settings/config-writer.ts`.
- Produces: shared `PlayerSettings { level: string }`; server `PlayerService` (`view(): PlayerSettings`, `save(level: string): Promise<PlayerSettings>`, throws `PlayerSettingsError` with `text: LocalizedText`), `GET /api/player`, `PUT /api/player` (`{ level }` → 200 `PlayerSettings` | 400 `{ error: LocalizedText }`); `AppServices.player`; web `fetchPlayer(): Promise<PlayerSettings>`, `savePlayer(level: string): Promise<PlayerSettings>`, `levelLabel(level: string, t: Translate): string`.

- [ ] **Step 1: `PlayerSettings`** in `packages/shared/src/settings.ts`:

```ts
/** Spec (repetition) 3.1: the player's level, saved at once from Settings. */
export interface PlayerSettings {
  level: string
}
```

- [ ] **Step 2: Failing test `packages/server/src/settings/player.test.ts`**

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir, testConfig } from '../../test/helpers'
import { PlayerService, PlayerSettingsError } from './player'

describe('PlayerService', () => {
  it('saves the level into the config file and the live config', async () => {
    const config = testConfig()
    const file = join(tempDir(), 'config.local.json')
    writeFileSync(file, JSON.stringify({ port: 5179, player: { level: '7k' } }))
    const player = new PlayerService(config, file)
    expect(player.view()).toEqual({ level: '7k' })
    expect(await player.save('3d')).toEqual({ level: '3d' })
    expect(config.player.level).toBe('3d')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ port: 5179, player: { level: '3d' } })
  })

  it('refuses an unknown level', async () => {
    const player = new PlayerService(testConfig(), join(tempDir(), 'config.local.json'))
    await expect(player.save('10p')).rejects.toBeInstanceOf(PlayerSettingsError)
  })
})
```

- [ ] **Step 3: `packages/server/src/settings/player.ts`**

```ts
import { isPlayerLevel, type LocalizedText, type PlayerSettings } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import { updateConfigFile } from './config-writer'

export class PlayerSettingsError extends Error {
  constructor(readonly text: LocalizedText) {
    super(text.key)
  }
}

/** Spec (repetition) 3.1: the player's level in the config (`player.level`); takes effect at once. */
export class PlayerService {
  constructor(
    private readonly config: AppConfig,
    private readonly configFile: string,
  ) {}

  view(): PlayerSettings {
    return { level: this.config.player.level }
  }

  async save(level: string): Promise<PlayerSettings> {
    if (!isPlayerLevel(level)) throw new PlayerSettingsError({ key: 'error.player.level' })
    await updateConfigFile(this.configFile, (raw) => {
      raw.player = { ...((raw.player ?? {}) as Record<string, unknown>), level }
    })
    this.config.player.level = level
    return this.view()
  }
}
```

- [ ] **Step 4: Route `packages/server/src/api/player-routes.ts`** (same shape as `ui-routes.ts`):

```ts
import type { PlayerSettings } from '@joseki-dojo/shared'
import type { FastifyInstance } from 'fastify'
import { PlayerSettingsError, type PlayerService } from '../settings/player'

export function registerPlayerRoutes(app: FastifyInstance, player: PlayerService): void {
  app.get('/api/player', async (): Promise<PlayerSettings> => player.view())
  app.put<{ Body: { level?: unknown } }>('/api/player', async (req, reply) => {
    try {
      return await player.save(String(req.body?.level ?? ''))
    } catch (err) {
      if (err instanceof PlayerSettingsError) return reply.code(400).send({ error: err.text })
      throw err
    }
  })
}
```

`app.ts`: `AppServices.player: PlayerService`; `createServices` builds `const player = new PlayerService(config, options.configFile)` and returns it; `buildApp` calls `registerPlayerRoutes(app, services.player)` after `registerUiRoutes`. `api.test.ts`: a test `GET /api/player` → `{ level: '7k' }`, `PUT` with `{ level: '1d' }` → `{ level: '1d' }`, `PUT` with `{ level: 'x' }` → 400 with `error.key === 'error.player.level'`.

- [ ] **Step 5: Catalog keys** (all six files; ru shown, translate the others; keep the comment style of each file):

```ts
  'settings.level.title': 'Ваш уровень',
  'settings.level.hint': 'От уровня зависят пороги неточности, ошибки и грубой ошибки — в разборе и в оценке повторения.',
  'level.pro': 'профи',
  'error.player.level': 'Неизвестный уровень игрока',
  'error.api.player': 'Не удалось сохранить уровень: HTTP {status}',
```

- [ ] **Step 6: Web** — `packages/web/src/format.ts`:

```ts
/** Spec (repetition) 3.1: a player level as a label: the rank, or «профи». */
export const levelLabel = (level: string, t: Translate): string => (level === 'pro' ? t('level.pro') : rankLabel(level, t))
```

with a test in `format.test.ts` (`levelLabel('pro', t)` and `levelLabel('3d', t)` against the `ru` translator, as the existing `rankLabel` tests do). `packages/web/src/api.ts` (next to `saveTheme`):

```ts
export async function fetchPlayer(): Promise<PlayerSettings> {
  const res = await request('/api/player')
  if (!res.ok) throw failed('error.api.player', res)
  return (await res.json()) as PlayerSettings
}

export async function savePlayer(level: string): Promise<PlayerSettings> {
  const res = await request('/api/player', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level }) })
  if (!res.ok) throw failed('error.api.player', res)
  return (await res.json()) as PlayerSettings
}
```

(Use the same `request(...)` call shape as `saveTheme`.) `SettingsScreen.tsx`: a `LevelSection` modelled on `ThemeSection` (saved at once, its own error line), placed first among the sections:

```tsx
function LevelSection() {
  const t = useT()
  const [level, setLevel] = useState<string | null>(null)
  const [error, setError] = useState<LocalizedText | null>(null)
  useEffect(() => {
    fetchPlayer().then((p) => setLevel(p.level)).catch((e) => setError(failureText(e)))
  }, [])
  const choose = (next: string): void => {
    setLevel(next)
    setError(null)
    savePlayer(next).catch((e) => setError(failureText(e)))
  }
  return (
    <section class="card section">
      <div class="section-head"><h2>{t('settings.level.title')}</h2></div>
      <p class="hint">{t('settings.level.hint')}</p>
      <select aria-label={t('settings.level.title')} value={level ?? ''} disabled={level === null} onChange={(e) => choose(e.currentTarget.value)}>
        {PLAYER_LEVELS.map((l) => (
          <option key={l} value={l}>{levelLabel(l, t)}</option>
        ))}
      </select>
      {error && <p class="error-text">{errorText(error, language)}</p>}
    </section>
  )
}
```

(Take `language` from `useI18n()` as the rest of the file does; reuse the existing class names of `ThemeSection` for the hint and the error line if they differ.)

- [ ] **Step 7: Run** `npm test && npm run typecheck` — PASS. **Commit:**

```bash
git add packages/shared packages/server packages/web
git commit -m "feat(levels): the player's level in Settings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: The calibration script

**Files:**
- Create: `scripts/thresholds/calibrate-steps.ts`, `scripts/thresholds/calibrate-steps.test.ts`, `scripts/thresholds/gpu.ts`
- Modify: `package.json` (script `thresholds:gpu`), `README.md` (a «Calibrating the thresholds» section next to the traps GPU section)

**Interfaces:**
- Consumes: `PLAYER_LEVELS`, `humanProfile` (Task 1); `parseThresholdTable`, `LevelThresholds`, `ThresholdTable` (Task 1); `StartBook.loadBase(file)`, `book.ids()`, `book.place(id, 'TR', false)`; `baseQuery(moves)` (`packages/server/src/engine/query.ts`); `AnalysisEngine`, `KataGoEngine`, `engineCommand`, `checkEngine`, `loadConfig` as in `scripts/traps/gpu.ts`; `colorSign`, `indexToVertex`, `PASS_INDEX`, `otherColor` from `@joseki-dojo/shared` (check the exact export names in `packages/shared/src`).
- Produces: `npm run thresholds:gpu -- [--positions N] [--visits N] [--seed N]`; `THRESHOLDS_FILE`; pure helpers below.

- [ ] **Step 1: Failing tests `scripts/thresholds/calibrate-steps.test.ts`**

```ts
import { PLAYER_LEVELS } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { exceedThreshold, movesToEvaluate, parseCalibrateOptions, sample, smooth } from './calibrate-steps'

describe('calibration helpers', () => {
  it('reads the options over the defaults', () => {
    expect(parseCalibrateOptions([])).toEqual({ positions: 400, visits: 2000, seed: 1, coverage: 0.98 })
    expect(parseCalibrateOptions(['--positions', '50', '--visits', '500', '--seed', '7'])).toEqual({ positions: 50, visits: 500, seed: 7, coverage: 0.98 })
    expect(() => parseCalibrateOptions(['--level', '5k'])).toThrow('Unknown option --level')
    expect(() => parseCalibrateOptions(['--visits'])).toThrow('--visits needs a value')
    expect(() => parseCalibrateOptions(['--visits', '0'])).toThrow('--visits needs a positive whole number')
  })

  it('samples the same items for the same seed', () => {
    const items = Array.from({ length: 100 }, (_, i) => i)
    expect(sample(items, 10, 3)).toEqual(sample(items, 10, 3))
    expect(new Set(sample(items, 10, 3)).size).toBe(10)
    expect(sample(items, 500, 3)).toHaveLength(100)
  })

  it('evaluates the moves that cover the share of every policy', () => {
    // Two policies over 5 points; -1 marks an occupied point.
    const a = [0.6, 0.3, 0.05, 0.05, -1]
    const b = [0.1, 0.1, 0.1, 0.7, -1]
    expect(movesToEvaluate([a], 0.9)).toEqual([0, 1])
    expect(movesToEvaluate([a, b], 0.9).sort()).toEqual([0, 1, 2, 3])
  })

  it('finds the loss exceeded by a weighted share of moves', () => {
    const samples = [
      { loss: 0, weight: 0.5 },
      { loss: 1, weight: 0.3 },
      { loss: 4, weight: 0.15 },
      { loss: 10, weight: 0.05 },
    ]
    // Exceeded by at most 25 %: losses above 1 weigh 0.2; above 0 weigh 0.5.
    expect(exceedThreshold(samples, 0.25)).toBe(1)
    expect(exceedThreshold(samples, 0.1)).toBe(4)
    expect(exceedThreshold(samples, 0.03)).toBe(10)
  })

  it('rounds, floors and keeps thresholds from growing with the level', () => {
    const raw = Object.fromEntries(PLAYER_LEVELS.map((l) => [l, { inaccuracy: 0.52, mistake: 2.01, blunder: 4.98 }]))
    raw['1d'] = { inaccuracy: 0.6, mistake: 2.4, blunder: 6 }
    raw.pro = { inaccuracy: 0.01, mistake: 0.02, blunder: 0.03 }
    const { levels, notes } = smooth(raw)
    expect(levels['20k']).toEqual({ inaccuracy: 0.5, mistake: 2, blunder: 5 })
    expect(levels['1d']).toEqual({ inaccuracy: 0.5, mistake: 2, blunder: 5 })
    expect(levels.pro).toEqual({ inaccuracy: 0.05, mistake: 0.1, blunder: 0.15 })
    expect(notes.some((n) => n.startsWith('1d: '))).toBe(true)
  })
})
```

Run: `npx vitest run scripts/thresholds/calibrate-steps.test.ts` — FAIL (module not found).

- [ ] **Step 2: `scripts/thresholds/calibrate-steps.ts`** — pure helpers and the run:

```ts
import { execFileSync } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { humanProfile, PLAYER_LEVELS, type Move } from '@joseki-dojo/shared'
import type { AnalysisEngine } from '../../packages/server/src/engine/engine'
import { baseQuery } from '../../packages/server/src/engine/query'
import { parseThresholdTable, type LevelThresholds } from '../../packages/server/src/review/thresholds'
import { StartBook } from '../../packages/server/src/starts/book'

export const THRESHOLDS_FILE = 'packages/server/bases/thresholds.json'
export const STARTS_FILE = 'packages/server/bases/starts.jdb'
/** Spec (repetition) 3.3: the share of a level's moves that exceeds each threshold. */
export const SHARES = { inaccuracy: 0.25, mistake: 0.1, blunder: 0.03 } as const
const SUBJECT = 'feat(levels): calibrate the thresholds with KataGo'
const USAGE = 'Usage: npm run thresholds:gpu -- [--positions N] [--visits N] [--seed N]'

export interface CalibrateOptions {
  positions: number
  visits: number
  seed: number
  coverage: number
}
const DEFAULTS: CalibrateOptions = { positions: 400, visits: 2000, seed: 1, coverage: 0.98 }
const FLAGS = { '--positions': 'positions', '--visits': 'visits', '--seed': 'seed' } as const

export function parseCalibrateOptions(args: string[]): CalibrateOptions {
  const opts = { ...DEFAULTS }
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i] as keyof typeof FLAGS
    if (!(flag in FLAGS)) throw new Error(`Unknown option ${args[i]}. ${USAGE}`)
    const value = args[i + 1]
    if (value === undefined || value.trim() === '') throw new Error(`${flag} needs a value. ${USAGE}`)
    const n = Number(value)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} needs a positive whole number`)
    opts[FLAGS[flag]] = n
  }
  return opts
}

/** A seeded pick of up to `n` items (mulberry32 + a partial Fisher–Yates shuffle). */
export function sample<T>(items: readonly T[], n: number, seed: number): T[] {
  let s = seed >>> 0
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let x = s
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  const a = [...items]
  const k = Math.min(n, a.length)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, k)
}

/** Spec (repetition) 3.3: the union over the policies of the most likely moves that cover `coverage` of each policy. */
export function movesToEvaluate(policies: readonly (readonly number[])[], coverage: number): number[] {
  const out = new Set<number>()
  for (const p of policies) {
    const order = p.map((v, i) => [v, i] as const).filter(([v]) => v > 0).sort((x, y) => y[0] - x[0])
    let covered = 0
    for (const [v, i] of order) {
      if (covered >= coverage) break
      out.add(i)
      covered += v
    }
  }
  return [...out]
}

export interface Sample {
  loss: number
  weight: number
}

/** The smallest observed loss x such that the moves losing more than x weigh at most `share` of all moves. */
export function exceedThreshold(samples: readonly Sample[], share: number): number {
  const total = samples.reduce((s, x) => s + x.weight, 0)
  const sorted = [...samples].sort((a, b) => a.loss - b.loss)
  let above = total
  for (const x of sorted) {
    above -= x.weight
    if (above <= share * total + 1e-12) return x.loss
  }
  return sorted[sorted.length - 1]?.loss ?? 0
}

const STEP = 0.05
const round = (x: number): number => Math.max(STEP, Math.round(x / STEP) * STEP)
const KEYS = ['inaccuracy', 'mistake', 'blunder'] as const

/** Spec (repetition) 3.3: round to 0.05 (floor 0.05), no threshold above the weaker level's, inaccuracy < mistake < blunder. */
export function smooth(raw: Record<string, LevelThresholds>): { levels: Record<string, LevelThresholds>; notes: string[] } {
  const levels: Record<string, LevelThresholds> = {}
  const notes: string[] = []
  let weaker: LevelThresholds | null = null
  for (const level of PLAYER_LEVELS) {
    const v = { ...raw[level] }
    for (const k of KEYS) v[k] = Number(round(v[k]).toFixed(2))
    if (weaker) {
      for (const k of KEYS) {
        if (v[k] > weaker[k]) {
          notes.push(`${level}: ${k} ${v[k]} lowered to ${weaker[k]} (the weaker level's)`)
          v[k] = weaker[k]
        }
      }
    }
    if (v.mistake <= v.inaccuracy) v.mistake = Number((v.inaccuracy + STEP).toFixed(2))
    if (v.blunder <= v.mistake) v.blunder = Number((v.mistake + STEP).toFixed(2))
    levels[level] = v
    weaker = v
  }
  return { levels, notes }
}

const sign = (color: 'B' | 'W'): number => (color === 'B' ? 1 : -1)

/** Spec (repetition) 3.3: losses of the evaluated moves of one position, weighted by each level's policy. */
async function positionSamples(engine: AnalysisEngine, moves: Move[], opts: CalibrateOptions): Promise<Sample[][]> {
  const toMove: 'B' | 'W' = moves.length % 2 === 0 ? 'B' : 'W'
  const root = await engine.analyze({ ...baseQuery(moves), maxVisits: opts.visits })
  const policies = await Promise.all(
    PLAYER_LEVELS.map(async (level) => {
      const r = await engine.analyze({ ...baseQuery(moves), maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: humanProfile(level) } })
      if (!r.humanPolicy) throw new Error(`KataGo returned no human policy for ${humanProfile(level)}`)
      return r.humanPolicy
    }),
  )
  const points = movesToEvaluate(policies, opts.coverage).filter((i) => i < 361)
  const losses = new Map<number, number>()
  await Promise.all(
    points.map(async (i) => {
      const vertex: [number, number] = [i % 19, Math.floor(i / 19)]
      const after = await engine.analyze({ ...baseQuery([...moves, { color: toMove, vertex }]), maxVisits: opts.visits })
      losses.set(i, Math.max(0, sign(toMove) * (root.rootInfo.scoreLead - after.rootInfo.scoreLead)))
    }),
  )
  const worst = Math.max(0, ...losses.values())
  return policies.map((p) => {
    const legal = p.reduce((s, v) => s + (v > 0 ? v : 0), 0)
    const got = points.map((i) => ({ loss: losses.get(i)!, weight: p[i] / legal }))
    const rest = 1 - got.reduce((s, x) => s + x.weight, 0)
    return rest > 1e-9 ? [...got, { loss: worst, weight: rest }] : got
  })
}

/** Spec (repetition) 3.3: the thresholds of every level over `positions` (each position weighs the same). */
export async function calibrate(engine: AnalysisEngine, positions: Move[][], opts: CalibrateOptions, log: (line: string) => void) {
  const pooled: Sample[][] = PLAYER_LEVELS.map(() => [])
  let done = 0
  for (const moves of positions) {
    const perLevel = await positionSamples(engine, moves, opts)
    perLevel.forEach((s, k) => pooled[k].push(...s))
    done++
    if (done % 20 === 0 || done === positions.length) log(`  ${done}/${positions.length} positions`)
  }
  const raw: Record<string, LevelThresholds> = {}
  PLAYER_LEVELS.forEach((level, k) => {
    raw[level] = { inaccuracy: exceedThreshold(pooled[k], SHARES.inaccuracy), mistake: exceedThreshold(pooled[k], SHARES.mistake), blunder: exceedThreshold(pooled[k], SHARES.blunder) }
  })
  return smooth(raw)
}
```

`movesOf`: a start's moves come from `book.place(id, 'TR', false)` (Black first, top-right corner). The vertex `[x, y]` of index `i` is `[i % 19, Math.floor(i / 19)]` — use the shared `indexToVertex` instead if its signature matches.

Then the run, modelled on `scripts/traps/gpu-steps.ts` (`gitProblem`, `commitBases`): `gitProblem(root)` refuses a detached HEAD, `main`, and uncommitted changes in `THRESHOLDS_FILE`, with the same messages as the traps script but naming the thresholds file; `runCalibration({ root, engine, opts, engineInfo, log })`:
1. `const book = StartBook.loadBase(join(root, STARTS_FILE))`; `const ids = sample(book.ids(), opts.positions, opts.seed)`; `const positions = ids.map((id) => book.place(id, 'TR', false))`.
2. Log the plan: positions, levels, visits, and the started time.
3. `const { levels, notes } = await calibrate(engine, positions, opts, log)`.
4. `const table = { method: { positions: positions.length, visits: opts.visits, seed: opts.seed, coverage: opts.coverage, shares: SHARES, katago: engineInfo, date: new Date().toISOString() }, levels }`; check it with `parseThresholdTable(JSON.stringify(table))` (a failure is an error, nothing written).
5. Write `THRESHOLDS_FILE` through a `.tmp` file and `renameSync`, with `JSON.stringify(table, null, 2) + '\n'`.
6. The report: one line per level `20k  inaccuracy 1.20  mistake 4.10  blunder 9.80`, then the smoothing notes, then the run's numbers (positions, evaluated moves, elapsed minutes).
7. Commit only that file: `git -c user.name=… -c user.email=… commit -q -m SUBJECT -m <report> -- THRESHOLDS_FILE` with the name and email of the last commit (as `commitBases` does). Return `{ committed }`.

- [ ] **Step 3: A run test with a fake engine** (in the same test file):

```ts
import { calibrate } from './calibrate-steps'

it('turns the losses of the weighted moves into thresholds per level', async () => {
  // Every level plays the point index 0 with 0.7 and index 1 with 0.3; index 1 loses 3 points.
  const engine = {
    analyze: async (q: { moves: [string, string][]; includePolicy?: boolean }) => {
      if (q.includePolicy) {
        const p = new Array(362).fill(0)
        p[0] = 0.7
        p[1] = 0.3
        return { humanPolicy: p, rootInfo: { scoreLead: 0 }, moveInfos: [] }
      }
      const last = q.moves[q.moves.length - 1]?.[1]
      return { rootInfo: { scoreLead: last === 'B19' ? -3 : 0 }, moveInfos: [] }
    },
  }
  const { levels } = await calibrate(engine as never, [[]], { positions: 1, visits: 1, seed: 1, coverage: 0.98 }, () => {})
  expect(levels['20k']).toEqual({ inaccuracy: 3, mistake: 3.05, blunder: 3.1 })
})
```

(Index 1 is `[1, 0]`, GTP `B19`; Black to move, so a lead of −3 after it is a 3-point loss. 30 % of the moves lose 3, so every share ≤ 30 % is exceeded only above 3; the order rule then lifts `mistake` and `blunder` by 0.05 steps. If `baseQuery` writes the GTP differently, take the coordinate from it.)

- [ ] **Step 4: `scripts/thresholds/gpu.ts`** — a copy of `scripts/traps/gpu.ts` with `parseCalibrateOptions`, `gitProblem` and `runCalibration` from `./calibrate-steps`; the engine check also asks one `proyear_2023` policy query and stops with `KataGo has no pro profile (proyear_2023)` when `humanPolicy` is missing. Root `package.json`: `"thresholds:gpu": "tsx scripts/thresholds/gpu.ts"`.

- [ ] **Step 5: README** — a section after the traps GPU section:

```md
### Calibrating the thresholds

`npm run thresholds:gpu -- [--positions 400] [--visits 2000] [--seed 1]` measures how players of every level play the joseki starts: the human net gives each level's moves, KataGo the loss of each move, and the inaccuracy, mistake and blunder thresholds of a level are the losses its moves exceed in 25 %, 10 % and 3 % of cases. It writes `packages/server/bases/thresholds.json` and commits that file with the report; push it afterwards. It refuses to run on `main`, on a detached HEAD or with uncommitted changes in that file. Without the file the app uses the thresholds of the config for every level.
```

- [ ] **Step 6: Run** `npm test && npm run typecheck` — PASS. **Commit:**

```bash
git add scripts/thresholds package.json README.md
git commit -m "feat(levels): the threshold calibration script" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Cards — types, tables, FSRS and the auto rating

**Files:**
- Modify: `packages/shared/src/types.ts` (card types), `packages/server/package.json` (`ts-fsrs`), `package-lock.json`
- Modify: `packages/server/src/store/migrations.ts`, `packages/server/src/store/repo.test.ts` (the hard-coded `004_extra` test migration becomes `005_extra`)
- Create: `packages/server/src/cards/schedule.ts`, `packages/server/src/cards/schedule.test.ts`
- Create: `packages/server/src/cards/grade.ts`, `packages/server/src/cards/grade.test.ts`
- Create: `packages/server/src/cards/repo.ts`, `packages/server/src/cards/repo.test.ts`

**Interfaces:**
- Consumes: `ReviewData`, `Category`, `PlayedMove` (shared); `Db`, `openDb` (`packages/server/src/store/db.ts`).
- Produces (shared): `Rating = 'again' | 'hard' | 'good' | 'easy'`, `RATINGS`, `CardKind = 'position' | 'move'`, `CardStage = 'learning' | 'learned'`, `RepetitionInfo`, `CardSummary`, `CardListItem`, `DueCard`, `StartCardState`. (server) `FsrsState`, `newState(now: Date): FsrsState`, `schedule(state: FsrsState, rating: Rating, now: Date): FsrsState`, `stageOf(state): CardStage`, `dayStart(now: Date): Date`; `positionRating(review: ReviewData): AutoRating | null`; `CardRepo` (methods below).

- [ ] **Step 1: Shared types** — append to `packages/shared/src/types.ts`:

```ts
/** Spec (repetition) 4.4: an FSRS answer. */
export type Rating = 'again' | 'hard' | 'good' | 'easy'
export const RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy']
/** Spec (repetition) 4.1: a tree position, or (iteration 2) a «find a good move» problem. */
export type CardKind = 'position' | 'move'
/** «изучается» (learning or relearning) or «изучена» (review stage). */
export type CardStage = 'learning' | 'learned'

/** Spec (repetition) 4.4, 5.3: the review of a training counted as a card repetition. */
export interface RepetitionInfo {
  cardId: string
  reviewId: number
  auto: Rating
  rating: Rating
  /** The worst user move behind the auto rating; null when every move was exact. */
  worst: { category: Category | 'unpunished'; loss: number } | null
  /** Only the card's latest review can be re-rated. */
  editable: boolean
  /** The card's next due time after this review, ISO. */
  due: string
}

/** Spec (repetition) 5.1: the tab's summary; days start at 04:00 local time. */
export interface CardSummary {
  dueNow: number
  dueByKind: Record<CardKind, number>
  /** Seven counts: cards due by the end of today (overdue included), then each next day. */
  forecast: number[]
  total: number
  learned: number
  /** The earliest due time when nothing is due now, ISO; null without cards. */
  nextDue: string | null
}

export interface CardListItem {
  id: string
  kind: CardKind
  /** Position cards: the start id (the web names it from the tree). */
  startId: string | null
  /** Canonical GTP moves for the small board. */
  moves: string[]
  due: string
  stage: CardStage
  lastRating: Rating | null
  reps: number
}

/** Spec (repetition) 5.2: the next card of the queue. */
export type DueCard = { card: { id: string; kind: 'position'; startId: string; userColor: Color; botRank: string } } | { card: null; nextDue: string | null }

/** Spec (repetition) 6: a position card's state for the tree. */
export interface StartCardState {
  stage: CardStage
  due: string
  dueNow: boolean
}
```

`ReviewData` gets an optional field after `trap?`:

```ts
  /** Spec (repetition) 5.3: present when this training is a position card repetition. */
  repetition?: RepetitionInfo
```

- [ ] **Step 2: Dependency** — `npm install ts-fsrs@5.4.2 --save-exact -w @joseki-dojo/server`.

- [ ] **Step 3: Migration 004** — append to `MIGRATIONS` in `packages/server/src/store/migrations.ts`:

```ts
  {
    version: 4,
    name: '004_cards.sql',
    sql: `
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('position', 'move')),
  card_key TEXT NOT NULL UNIQUE,
  data_json TEXT NOT NULL,
  fsrs_json TEXT NOT NULL,
  due TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cards_due ON cards (deleted, due);

CREATE TABLE card_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  reviewed_at TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  auto_rating TEXT NOT NULL CHECK (auto_rating IN ('again', 'hard', 'good', 'easy')),
  worst_json TEXT,
  state_before_json TEXT NOT NULL,
  session_id TEXT
);
CREATE INDEX card_reviews_card ON card_reviews (card_id, id);
CREATE UNIQUE INDEX card_reviews_session ON card_reviews (card_id, session_id) WHERE session_id IS NOT NULL;
`,
  },
```

In `repo.test.ts`, the test migration added by «applies only the migrations not recorded yet» becomes `{ version: 5, name: '005_extra.sql', … }` and the expected names list becomes `['001_init.sql', '002_traps.sql', '003_starts.sql', '004_cards.sql', '005_extra.sql']` (keep the rest of the test).

- [ ] **Step 4: Failing tests `packages/server/src/cards/schedule.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { dayStart, newState, schedule, stageOf } from './schedule'

const at = (iso: string): Date => new Date(iso)

describe('the FSRS schedule', () => {
  it('starts a card as due now and learning', () => {
    const s = newState(at('2026-10-15T10:00:00'))
    expect(new Date(s.due).getTime()).toBe(at('2026-10-15T10:00:00').getTime())
    expect(stageOf(s)).toBe('learning')
  })

  it('brings an «again» back within minutes and a «good» later', () => {
    const now = at('2026-10-15T10:00:00')
    const again = schedule(newState(now), 'again', now)
    const good = schedule(newState(now), 'good', now)
    expect(new Date(again.due).getTime() - now.getTime()).toBeLessThanOrEqual(10 * 60_000)
    expect(new Date(good.due).getTime()).toBeGreaterThan(new Date(again.due).getTime())
  })

  it('moves a card to the review stage after good answers spaced by their due times', () => {
    let s = newState(at('2026-10-15T10:00:00'))
    for (let i = 0; i < 4 && stageOf(s) === 'learning'; i++) s = schedule(s, 'good', new Date(s.due))
    expect(stageOf(s)).toBe('learned')
    expect(s.reps).toBeGreaterThanOrEqual(2)
  })

  it('round-trips through JSON', () => {
    const s = schedule(newState(at('2026-10-15T10:00:00')), 'hard', at('2026-10-15T10:00:00'))
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('starts the day at 04:00 local time', () => {
    expect(dayStart(at('2026-10-15T03:59:00'))).toEqual(at('2026-10-14T04:00:00'))
    expect(dayStart(at('2026-10-15T04:00:00'))).toEqual(at('2026-10-15T04:00:00'))
    expect(dayStart(at('2026-10-15T23:30:00'))).toEqual(at('2026-10-15T04:00:00'))
  })
})
```

(The ISO strings without a zone are local time, which is what `dayStart` works in.)

- [ ] **Step 5: `packages/server/src/cards/schedule.ts`**

```ts
import { createEmptyCard, fsrs, generatorParameters, Rating as FsrsRating, State, type Card, type Grade } from 'ts-fsrs'
import type { CardStage, Rating } from '@joseki-dojo/shared'

/** Spec (repetition) 4.3: a ts-fsrs card with its dates as ISO strings (stored as JSON). */
export type FsrsState = Omit<Card, 'due' | 'last_review'> & { due: string; last_review: string | null }

const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false, enable_short_term: true }))

const GRADES: Record<Rating, Grade> = { again: FsrsRating.Again, hard: FsrsRating.Hard, good: FsrsRating.Good, easy: FsrsRating.Easy }

const toState = (c: Card): FsrsState => ({ ...c, due: c.due.toISOString(), last_review: c.last_review ? c.last_review.toISOString() : null })
const toCard = (s: FsrsState): Card => ({ ...s, due: new Date(s.due), last_review: s.last_review ? new Date(s.last_review) : undefined }) as Card

/** A card that has never been reviewed: due now. */
export const newState = (now: Date): FsrsState => toState(createEmptyCard(now))

/** Spec (repetition) 4.3: the state after answering `rating` at `now`. */
export const schedule = (state: FsrsState, rating: Rating, now: Date): FsrsState => toState(scheduler.next(toCard(state), now, GRADES[rating]).card)

/** «изучена» only on the review stage; new, learning and relearning cards are «изучается». */
export const stageOf = (state: FsrsState): CardStage => (state.state === State.Review ? 'learned' : 'learning')

/** Spec (repetition) 4.3: the start of the day containing `now` — 04:00 local time. */
export function dayStart(now: Date): Date {
  const d = new Date(now)
  d.setHours(4, 0, 0, 0)
  if (now < d) d.setDate(d.getDate() - 1)
  return d
}
```

If the installed `ts-fsrs` types differ (e.g. `learning_steps`, an optional `last_review`), keep the same exported functions and adapt `toState` / `toCard` only. Run the test — PASS.

- [ ] **Step 6: Failing tests `packages/server/src/cards/grade.test.ts`** — the auto rating of a position training (spec 4.4):

```ts
import type { ReviewData } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { positionRating } from './grade'

/** A review with user moves of the given losses/categories (all in the zone) and optional punishment events. */
function review(user: { loss: number; category: 'exact' | 'inaccuracy' | 'mistake' | 'blunder'; inZone?: boolean }[], punished: boolean[] = []): ReviewData {
  const moves = user.map((u, i) => ({ color: 'B' as const, vertex: [i, 0] as [number, number], actor: 'user' as const, inZone: u.inZone ?? true }))
  return {
    sessionId: 's',
    settings: { mode: 'list', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' },
    initialMoves: [],
    moves,
    positions: [],
    moveReviews: user.map((u, turn) => ({ turn, color: 'B', actor: 'user', vertex: [turn, 0], loss: u.loss, category: u.category })),
    punishments: punished.map((p, i) => ({ turn: i, botLoss: 3, userLoss: p ? 0 : 3, punished: p, kept: p ? 3 : 0 })),
    summary: { userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 },
  } as unknown as ReviewData
}

describe('positionRating', () => {
  it('rates by the worst in-zone user move', () => {
    expect(positionRating(review([{ loss: 0.1, category: 'exact' }]))).toEqual({ rating: 'good', worst: null })
    expect(positionRating(review([{ loss: 0.1, category: 'exact' }, { loss: 0.8, category: 'inaccuracy' }]))).toEqual({ rating: 'hard', worst: { category: 'inaccuracy', loss: 0.8 } })
    expect(positionRating(review([{ loss: 2.4, category: 'mistake' }, { loss: 0.8, category: 'inaccuracy' }]))?.rating).toBe('again')
    expect(positionRating(review([{ loss: 7, category: 'blunder' }]))).toEqual({ rating: 'again', worst: { category: 'blunder', loss: 7 } })
  })

  it('ignores moves outside the zone and counts an unpunished bot mistake as a mistake', () => {
    expect(positionRating(review([{ loss: 9, category: 'blunder', inZone: false }, { loss: 0, category: 'exact' }]))?.rating).toBe('good')
    expect(positionRating(review([{ loss: 0, category: 'exact' }], [false]))).toEqual({ rating: 'again', worst: { category: 'unpunished', loss: 3 } })
    expect(positionRating(review([{ loss: 0, category: 'exact' }], [true]))?.rating).toBe('good')
  })

  it('is no repetition without user moves', () => {
    expect(positionRating(review([]))).toBeNull()
  })
})
```

(Check the real field names of `PunishmentEvent` and `MoveReview` in `packages/shared/src/types.ts` and adjust the fixture, not the rule.)

- [ ] **Step 7: `packages/server/src/cards/grade.ts`**

```ts
import type { Category, Rating, RepetitionInfo, ReviewData } from '@joseki-dojo/shared'

export interface AutoRating {
  rating: Rating
  worst: RepetitionInfo['worst']
}

const RANK: Record<Category | 'unpunished', number> = { exact: 0, inaccuracy: 1, mistake: 2, unpunished: 2, blunder: 3 }

/**
 * Spec (repetition) 4.4: the worst category of the user's in-zone moves after the start, an unpunished bot mistake
 * counting as a mistake: exact → good, inaccuracy → hard, mistake / blunder / unpunished → again. Null without user moves.
 */
export function positionRating(review: ReviewData): AutoRating | null {
  const user = review.moveReviews.filter((m) => m.actor === 'user' && review.moves[m.turn]?.inZone)
  if (!review.moveReviews.some((m) => m.actor === 'user')) return null
  let worst: { category: Category | 'unpunished'; loss: number } | null = null
  const consider = (category: Category | 'unpunished', loss: number): void => {
    if (category === 'exact') return
    if (!worst || RANK[category] > RANK[worst.category] || (RANK[category] === RANK[worst.category] && loss > worst.loss)) worst = { category, loss }
  }
  for (const m of user) consider(m.category, m.loss)
  for (const p of review.punishments) if (!p.punished) consider('unpunished', p.userLoss)
  const w = worst as { category: Category | 'unpunished'; loss: number } | null
  const rating: Rating = !w ? 'good' : w.category === 'inaccuracy' ? 'hard' : 'again'
  return { rating, worst: w }
}
```

Run the test — PASS.

- [ ] **Step 8: Failing tests `packages/server/src/cards/repo.test.ts`** — the store:

```ts
import { describe, expect, it } from 'vitest'
import { openDb } from '../store/db'
import { CardRepo } from './repo'
import { newState, schedule } from './schedule'

const now = new Date('2026-10-15T10:00:00')

describe('CardRepo', () => {
  it('inserts a card, finds it by key, updates its state and lists it', () => {
    const repo = new CardRepo(openDb(':memory:'))
    const state = newState(now)
    repo.insertCard({ id: 'c1', kind: 'position', key: 'position:abcd1234', data: { startId: 'abcd1234', userColor: 'B', botRank: '7k' }, state, createdAt: now.toISOString() })
    expect(repo.cardByKey('position:abcd1234')?.id).toBe('c1')
    const next = schedule(state, 'good', now)
    repo.updateState('c1', next)
    expect(repo.card('c1')?.state).toEqual(next)
    expect(repo.cards().map((c) => c.id)).toEqual(['c1'])
  })

  it('records reviews, knows the latest and replaces a rating', () => {
    const repo = new CardRepo(openDb(':memory:'))
    repo.insertCard({ id: 'c1', kind: 'position', key: 'k', data: {}, state: newState(now), createdAt: now.toISOString() })
    const r1 = repo.insertReview({ cardId: 'c1', reviewedAt: now.toISOString(), rating: 'good', auto: 'good', worst: null, stateBefore: newState(now), sessionId: 's1' })
    const r2 = repo.insertReview({ cardId: 'c1', reviewedAt: now.toISOString(), rating: 'again', auto: 'again', worst: { category: 'mistake', loss: 2.5 }, stateBefore: newState(now), sessionId: 's2' })
    expect(repo.latestReviewId('c1')).toBe(r2)
    expect(repo.reviewBySession('c1', 's1')?.id).toBe(r1)
    repo.setRating(r2, 'hard')
    expect(repo.review(r2)?.rating).toBe('hard')
    expect(repo.lastRating('c1')).toBe('hard')
  })

  it('marks a card deleted: hidden from lists but its key stays taken', () => {
    const repo = new CardRepo(openDb(':memory:'))
    repo.insertCard({ id: 'c1', kind: 'position', key: 'k', data: {}, state: newState(now), createdAt: now.toISOString() })
    repo.markDeleted('c1')
    expect(repo.cards()).toEqual([])
    expect(repo.cardByKey('k')?.deleted).toBe(true)
  })
})
```

- [ ] **Step 9: `packages/server/src/cards/repo.ts`**

```ts
import type { CardKind, Rating, RepetitionInfo } from '@joseki-dojo/shared'
import type { Db } from '../store/db'
import type { FsrsState } from './schedule'

export interface CardRow {
  id: string
  kind: CardKind
  key: string
  data: Record<string, unknown>
  state: FsrsState
  createdAt: string
  deleted: boolean
}

export interface ReviewRow {
  id: number
  cardId: string
  reviewedAt: string
  rating: Rating
  auto: Rating
  worst: RepetitionInfo['worst']
  stateBefore: FsrsState
  sessionId: string | null
}

interface RawCard { id: string; kind: CardKind; card_key: string; data_json: string; fsrs_json: string; created_at: string; deleted: number }
interface RawReview { id: number; card_id: string; reviewed_at: string; rating: Rating; auto_rating: Rating; worst_json: string | null; state_before_json: string; session_id: string | null }

const card = (r: RawCard): CardRow => ({ id: r.id, kind: r.kind, key: r.card_key, data: JSON.parse(r.data_json), state: JSON.parse(r.fsrs_json), createdAt: r.created_at, deleted: r.deleted === 1 })
const review = (r: RawReview): ReviewRow => ({
  id: r.id, cardId: r.card_id, reviewedAt: r.reviewed_at, rating: r.rating, auto: r.auto_rating,
  worst: r.worst_json ? JSON.parse(r.worst_json) : null, stateBefore: JSON.parse(r.state_before_json), sessionId: r.session_id,
})

/** Spec (repetition) 4.5: the `cards` and `card_reviews` tables. */
export class CardRepo {
  constructor(private readonly db: Db) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  insertCard(c: Omit<CardRow, 'deleted'>): void {
    this.db
      .prepare('INSERT INTO cards (id, kind, card_key, data_json, fsrs_json, due, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, c.kind, c.key, JSON.stringify(c.data), JSON.stringify(c.state), c.state.due, c.createdAt)
  }

  card(id: string): CardRow | null {
    const r = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as RawCard | undefined
    return r ? card(r) : null
  }

  cardByKey(key: string): CardRow | null {
    const r = this.db.prepare('SELECT * FROM cards WHERE card_key = ?').get(key) as RawCard | undefined
    return r ? card(r) : null
  }

  /** The cards not deleted, by due time. */
  cards(): CardRow[] {
    return (this.db.prepare('SELECT * FROM cards WHERE deleted = 0 ORDER BY due, id').all() as RawCard[]).map(card)
  }

  updateState(id: string, state: FsrsState): void {
    this.db.prepare('UPDATE cards SET fsrs_json = ?, due = ? WHERE id = ?').run(JSON.stringify(state), state.due, id)
  }

  markDeleted(id: string): void {
    this.db.prepare('UPDATE cards SET deleted = 1 WHERE id = ?').run(id)
  }

  insertReview(r: Omit<ReviewRow, 'id'>): number {
    const info = this.db
      .prepare('INSERT INTO card_reviews (card_id, reviewed_at, rating, auto_rating, worst_json, state_before_json, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.cardId, r.reviewedAt, r.rating, r.auto, r.worst ? JSON.stringify(r.worst) : null, JSON.stringify(r.stateBefore), r.sessionId)
    return Number(info.lastInsertRowid)
  }

  review(id: number): ReviewRow | null {
    const r = this.db.prepare('SELECT * FROM card_reviews WHERE id = ?').get(id) as RawReview | undefined
    return r ? review(r) : null
  }

  reviewBySession(cardId: string, sessionId: string): ReviewRow | null {
    const r = this.db.prepare('SELECT * FROM card_reviews WHERE card_id = ? AND session_id = ?').get(cardId, sessionId) as RawReview | undefined
    return r ? review(r) : null
  }

  /** The review of a training, whatever its card (a training repeats at most one position card). */
  reviewOfSession(sessionId: string): ReviewRow | null {
    const r = this.db.prepare('SELECT * FROM card_reviews WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId) as RawReview | undefined
    return r ? review(r) : null
  }

  latestReviewId(cardId: string): number | null {
    const r = this.db.prepare('SELECT MAX(id) AS id FROM card_reviews WHERE card_id = ?').get(cardId) as { id: number | null }
    return r.id
  }

  lastRating(cardId: string): Rating | null {
    const r = this.db.prepare('SELECT rating FROM card_reviews WHERE card_id = ? ORDER BY id DESC LIMIT 1').get(cardId) as { rating: Rating } | undefined
    return r?.rating ?? null
  }

  setRating(id: number, rating: Rating): void {
    this.db.prepare('UPDATE card_reviews SET rating = ? WHERE id = ?').run(rating, id)
  }
}
```

Run the repo test — PASS.

- [ ] **Step 10: Run** `npm test && npm run typecheck` — PASS. **Commit:**

```bash
git add packages/shared packages/server package-lock.json
git commit -m "feat(cards): card tables, the FSRS schedule and the auto rating" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The card service, the review hook and `/api/cards`

**Files:**
- Create: `packages/server/src/cards/service.ts`, `packages/server/src/cards/service.test.ts`, `packages/server/src/api/cards-routes.ts`
- Modify: `packages/server/src/review/service.ts`, `packages/server/src/review/service.test.ts`, `packages/server/src/app.ts`, `packages/server/src/api/api.test.ts`

**Interfaces:**
- Consumes: `CardRepo`, `newState`, `schedule`, `stageOf`, `dayStart`, `positionRating` (Task 4); `StartBook` (`isListed(id)`, `list()`); `SessionRecord`; shared card types.
- Produces: `CardService` with `recordTraining(rec: SessionRecord, review: ReviewData): void`, `repetitionOf(sessionId: string): RepetitionInfo | null`, `rate(reviewId: number, rating: Rating): RepetitionInfo`, `summary(): CardSummary`, `list(kind?: CardKind): CardListItem[]`, `due(): DueCard`, `remove(id: string): void`, `startStates(): Record<string, StartCardState>`; `CardError` (`code: 'card_not_found' | 'review_not_found' | 'not_latest'`); routes `GET /api/cards/summary`, `GET /api/cards?kind=`, `DELETE /api/cards/:id`, `GET /api/cards/due`, `GET /api/cards/starts`, `PUT /api/cards/reviews/:id` (`{ rating }`); `ReviewServiceDeps.cards?: CardService`; `AppServices.cards`.

- [ ] **Step 1: Failing tests `packages/server/src/cards/service.test.ts`**

```ts
import type { ReviewData } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { decodeJdb, encodeJdb } from '../jdb'
import { StartBook } from '../starts/book'
import { TEST_STARTS_LIST, testStartsTree } from '../starts/fixture'
import { openDb } from '../store/db'
import type { SessionRecord } from '../store/records'
import { CardRepo } from './repo'
import { CardError, CardService } from './service'

const book = (): StartBook => StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})
const listedId = (): string => book().list()[0].id

function setup(start = new Date('2026-10-15T10:00:00')) {
  let now = start
  let n = 0
  const service = new CardService({ repo: new CardRepo(openDb(':memory:')), starts: book(), now: () => now, newId: () => `card${++n}` })
  return { service, setNow: (d: Date) => (now = d) }
}

function training(id: string, startId: string | null, userLosses: [number, 'exact' | 'inaccuracy' | 'mistake' | 'blunder'][]): [SessionRecord, ReviewData] {
  const settings = { mode: 'list' as const, environment: 'empty' as const, userColor: 'B' as const, botRank: '5k', corner: 'TR' as const, ...(startId ? { start: { id: startId, name: 'X', mirror: false } } : {}) }
  const moves = userLosses.map((_, i) => ({ color: 'B' as const, vertex: [i, 0] as [number, number], actor: 'user' as const, inZone: true }))
  const rec = { id, createdAt: '', finishedAt: '', settings, status: 'finished', parentSessionId: null, initialMoves: [], moves, summary: null } as unknown as SessionRecord
  const review = {
    sessionId: id, settings, initialMoves: [], moves, positions: [],
    moveReviews: userLosses.map(([loss, category], turn) => ({ turn, color: 'B', actor: 'user', vertex: [turn, 0], loss, category })),
    punishments: [], summary: { userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 },
  } as unknown as ReviewData
  return [rec, review]
}

describe('CardService', () => {
  it('creates a position card from a training of a listed start, once per training', () => {
    const { service } = setup()
    const [rec, review] = training('s1', listedId(), [[0, 'exact']])
    service.recordTraining(rec, review)
    service.recordTraining(rec, review)
    expect(service.list()).toHaveLength(1)
    expect(service.repetitionOf('s1')).toMatchObject({ cardId: 'card1', auto: 'good', rating: 'good', worst: null, editable: true })
  })

  it('ignores trainings without a listed start or without user moves', () => {
    const { service } = setup()
    service.recordTraining(...training('s1', null, [[0, 'exact']]))
    service.recordTraining(...training('s2', 'deadbeef', [[0, 'exact']]))
    service.recordTraining(...training('s3', listedId(), []))
    expect(service.list()).toEqual([])
  })

  it('repeats an existing card, and only the latest review can be re-rated', () => {
    const { service, setNow } = setup()
    service.recordTraining(...training('s1', listedId(), [[2.5, 'mistake']]))
    setNow(new Date('2026-10-15T10:30:00'))
    service.recordTraining(...training('s2', listedId(), [[0, 'exact']]))
    const first = service.repetitionOf('s1')!
    const second = service.repetitionOf('s2')!
    expect([first.auto, first.editable, second.editable]).toEqual(['again', false, true])
    expect(() => service.rate(first.reviewId, 'good')).toThrowError(expect.objectContaining({ code: 'not_latest' }))
    const changed = service.rate(second.reviewId, 'easy')
    expect(changed).toMatchObject({ rating: 'easy', auto: 'good', editable: true })
    expect(new Date(changed.due).getTime()).toBeGreaterThan(new Date(second.due).getTime())
  })

  it('summarizes what is due, the week and the learned cards', () => {
    const { service, setNow } = setup()
    service.recordTraining(...training('s1', listedId(), [[2.5, 'mistake']]))
    expect(service.summary()).toMatchObject({ dueNow: 0, total: 1, learned: 0 })
    setNow(new Date('2026-10-15T11:00:00'))
    const s = service.summary()
    expect(s.dueNow).toBe(1)
    expect(s.dueByKind).toEqual({ position: 1, move: 0 })
    expect(s.forecast).toHaveLength(7)
    expect(s.forecast[0]).toBe(1)
    expect(s.nextDue).toBeNull()
    expect(service.due()).toEqual({ card: { id: 'card1', kind: 'position', startId: listedId(), userColor: 'B', botRank: '5k' } })
    expect(service.startStates()[listedId()]).toMatchObject({ stage: 'learning', dueNow: true })
  })

  it('deletes a card for good: a new training of the same start does not bring it back', () => {
    const { service } = setup()
    service.recordTraining(...training('s1', listedId(), [[0, 'exact']]))
    service.remove('card1')
    service.recordTraining(...training('s2', listedId(), [[0, 'exact']]))
    expect(service.list()).toEqual([])
    expect(service.repetitionOf('s2')).toBeNull()
    expect(() => service.remove('nope')).toThrow(CardError)
  })
})
```

- [ ] **Step 2: `packages/server/src/cards/service.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { CardKind, CardListItem, CardSummary, DueCard, Rating, RepetitionInfo, ReviewData, StartCardState } from '@joseki-dojo/shared'
import type { StartBook } from '../starts/book'
import type { SessionRecord } from '../store/records'
import { positionRating } from './grade'
import type { CardRepo, CardRow, ReviewRow } from './repo'
import { dayStart, newState, schedule, stageOf } from './schedule'

export class CardError extends Error {
  constructor(readonly code: 'card_not_found' | 'review_not_found' | 'not_latest') {
    super(code)
  }
}

export interface CardServiceDeps {
  repo: CardRepo
  starts: StartBook
  now?: () => Date
  newId?: () => string
}

interface PositionData {
  startId: string
  userColor: 'B' | 'W'
  botRank: string
}

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Spec (repetition) 4–5: cards, their schedule and the queue. Iteration 1: position cards. */
export class CardService {
  constructor(private readonly d: CardServiceDeps) {}

  private now(): Date {
    return this.d.now?.() ?? new Date()
  }

  /** Spec (repetition) 4.2: a finished training of a listed start is a repetition of its position card. */
  recordTraining(rec: SessionRecord, review: ReviewData): void {
    const start = rec.settings.start
    if (!start || start.dubious || !this.d.starts.isListed(start.id)) return
    const auto = positionRating(review)
    if (!auto) return
    const key = `position:${start.id}`
    this.d.repo.transaction(() => {
      let card = this.d.repo.cardByKey(key)
      if (card?.deleted) return
      if (card && this.d.repo.reviewBySession(card.id, rec.id)) return
      const now = this.now()
      if (!card) {
        const data: PositionData = { startId: start.id, userColor: rec.settings.userColor, botRank: rec.settings.botRank }
        const row = { id: this.d.newId?.() ?? randomUUID(), kind: 'position' as const, key, data: { ...data }, state: newState(now), createdAt: now.toISOString() }
        this.d.repo.insertCard(row)
        card = { ...row, deleted: false }
      }
      const stateBefore = card.state
      this.d.repo.updateState(card.id, schedule(stateBefore, auto.rating, now))
      this.d.repo.insertReview({ cardId: card.id, reviewedAt: now.toISOString(), rating: auto.rating, auto: auto.rating, worst: auto.worst, stateBefore, sessionId: rec.id })
    })
  }

  private info(row: ReviewRow, card: CardRow): RepetitionInfo {
    return { cardId: card.id, reviewId: row.id, auto: row.auto, rating: row.rating, worst: row.worst, editable: this.d.repo.latestReviewId(card.id) === row.id, due: card.state.due }
  }

  /** Spec (repetition) 5.3: the repetition shown over the review of `sessionId`. */
  repetitionOf(sessionId: string): RepetitionInfo | null {
    const row = this.d.repo.reviewOfSession(sessionId)
    const card = row ? this.d.repo.card(row.cardId) : null
    return row && card && !card.deleted ? this.info(row, card) : null
  }

  /** Spec (repetition) 4.4: another rating for the card's latest review, rescheduled from the state before it. */
  rate(reviewId: number, rating: Rating): RepetitionInfo {
    const row = this.d.repo.review(reviewId)
    if (!row) throw new CardError('review_not_found')
    const card = this.d.repo.card(row.cardId)
    if (!card || card.deleted) throw new CardError('card_not_found')
    if (this.d.repo.latestReviewId(card.id) !== row.id) throw new CardError('not_latest')
    const state = schedule(row.stateBefore, rating, new Date(row.reviewedAt))
    this.d.repo.transaction(() => {
      this.d.repo.updateState(card.id, state)
      this.d.repo.setRating(row.id, rating)
    })
    return this.info({ ...row, rating }, { ...card, state })
  }

  summary(): CardSummary {
    const now = this.now()
    const cards = this.d.repo.cards()
    const due = (c: CardRow): Date => new Date(c.state.due)
    const dueNow = cards.filter((c) => due(c) <= now)
    const today = dayStart(now)
    const forecast = Array.from({ length: 7 }, (_, d) => cards.filter((c) => (d === 0 ? due(c) < addDays(today, 1) : due(c) >= addDays(today, d) && due(c) < addDays(today, d + 1))).length)
    return {
      dueNow: dueNow.length,
      dueByKind: { position: dueNow.filter((c) => c.kind === 'position').length, move: dueNow.filter((c) => c.kind === 'move').length },
      forecast,
      total: cards.length,
      learned: cards.filter((c) => stageOf(c.state) === 'learned').length,
      nextDue: dueNow.length > 0 || cards.length === 0 ? null : cards[0].state.due,
    }
  }

  list(kind?: CardKind): CardListItem[] {
    const moves = new Map(this.d.starts.list().map((e) => [e.id, e.moves]))
    return this.d.repo
      .cards()
      .filter((c) => !kind || c.kind === kind)
      .map((c) => {
        const startId = c.kind === 'position' ? String((c.data as Partial<PositionData>).startId ?? '') : null
        return { id: c.id, kind: c.kind, startId, moves: (startId && moves.get(startId)) || [], due: c.state.due, stage: stageOf(c.state), lastRating: this.d.repo.lastRating(c.id), reps: c.state.reps }
      })
  }

  /** Spec (repetition) 5.2: the most overdue position card, or the next due time. */
  due(): DueCard {
    const now = this.now()
    const cards = this.d.repo.cards()
    const next = cards.find((c) => c.kind === 'position' && new Date(c.state.due) <= now)
    if (!next) return { card: null, nextDue: cards[0]?.state.due ?? null }
    const data = next.data as unknown as PositionData
    return { card: { id: next.id, kind: 'position', startId: data.startId, userColor: data.userColor, botRank: data.botRank } }
  }

  remove(id: string): void {
    const card = this.d.repo.card(id)
    if (!card || card.deleted) throw new CardError('card_not_found')
    this.d.repo.markDeleted(id)
  }

  /** Spec (repetition) 6: the state of every position card, by start id. */
  startStates(): Record<string, StartCardState> {
    const now = this.now()
    const out: Record<string, StartCardState> = {}
    for (const c of this.d.repo.cards()) {
      if (c.kind !== 'position') continue
      const startId = String((c.data as Partial<PositionData>).startId ?? '')
      out[startId] = { stage: stageOf(c.state), due: c.state.due, dueNow: new Date(c.state.due) <= now }
    }
    return out
  }
}
```

Run the test — PASS. (The «again» card of the summary test is due within minutes, so at 11:00 it is due; adjust only the clock values if the installed FSRS steps differ, not the assertions' meaning.)

- [ ] **Step 3: The review hook** — `packages/server/src/review/service.ts`: `ReviewServiceDeps` gets `/** Spec (repetition) 4.2, 5.3. */ cards?: CardService`. In `run`, after `replaceMissedPunishments(...)`: `this.d.cards?.recordTraining(rec, review)`. Both `run` (its returned value) and `get` (its `review`) go through

```ts
  /** Spec (repetition) 5.3: the card repetition of this training, if any. */
  private withRepetition(review: ReviewData): ReviewData {
    const repetition = this.d.cards?.repetitionOf(review.sessionId) ?? null
    return repetition ? { ...review, repetition } : review
  }
```

A test in `review/service.test.ts`: with a `CardService` over the starts fixture and a session whose `settings.start` is the first listed start, `prepare` records one card and the returned review has `repetition.auto === 'good'`; `get` returns the same `repetition`.

- [ ] **Step 4: Routes `packages/server/src/api/cards-routes.ts`**

```ts
import { RATINGS, type CardKind, type Rating } from '@joseki-dojo/shared'
import type { FastifyInstance } from 'fastify'
import { CardError, type CardService } from '../cards/service'

const STATUS: Record<CardError['code'], number> = { card_not_found: 404, review_not_found: 404, not_latest: 409 }

/** Spec (repetition) 7. */
export function registerCardsRoutes(app: FastifyInstance, cards: CardService): void {
  const failed = (err: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (err instanceof CardError) return reply.code(STATUS[err.code]).send({ error: err.code })
    throw err
  }
  app.get('/api/cards/summary', async () => cards.summary())
  app.get<{ Querystring: { kind?: string } }>('/api/cards', async (req) => {
    const kind = req.query.kind === 'position' || req.query.kind === 'move' ? (req.query.kind as CardKind) : undefined
    return cards.list(kind)
  })
  app.get('/api/cards/due', async () => cards.due())
  app.get('/api/cards/starts', async () => cards.startStates())
  app.delete<{ Params: { id: string } }>('/api/cards/:id', async (req, reply) => {
    try {
      cards.remove(req.params.id)
      return reply.code(204).send()
    } catch (err) {
      return failed(err, reply)
    }
  })
  app.put<{ Params: { id: string }; Body: { rating?: unknown } }>('/api/cards/reviews/:id', async (req, reply) => {
    const rating = req.body?.rating
    if (!RATINGS.includes(rating as Rating)) return reply.code(400).send({ error: 'bad_rating' })
    try {
      return cards.rate(Number(req.params.id), rating as Rating)
    } catch (err) {
      return failed(err, reply)
    }
  })
}
```

`app.ts`: `AppServices.cards: CardService`; `createServices` builds `const cards = new CardService({ repo: new CardRepo(db), starts })` before `reviews` and passes `cards` to `new ReviewService({ ... })`; `buildApp` calls `registerCardsRoutes(app, services.cards)`. `api.test.ts`: with the starts fixture (as the `/api/starts` test builds `services`), finish a «Из списка» session of the first listed start through the existing `startSession`/`finishSession` helpers (send `startId` in the settings), then `GET /api/cards/summary` → `total: 1`; `GET /api/cards` → one item with that `startId`; `GET /api/sessions/:id/review` → `repetition.auto === 'good'` (the fake KataGo makes every move exact); `PUT /api/cards/reviews/<reviewId>` with `{ rating: 'hard' }` → `rating: 'hard'`; with `{ rating: 'x' }` → 400; `DELETE /api/cards/<id>` → 204, again → 404.

- [ ] **Step 5: Run** `npm test && npm run typecheck` — PASS. **Commit:**

```bash
git add packages/server packages/shared
git commit -m "feat(cards): position cards from trainings and the cards API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The «Повторение» section: header, screen and queue start

**Files:**
- Modify: `packages/web/src/api.ts`, `packages/web/src/format.ts`, `packages/web/src/format.test.ts`
- Modify: `packages/web/src/components/AppHeader.tsx`, `packages/web/src/App.tsx`, `packages/web/src/styles/screens.css` (or the stylesheet the header and screens use)
- Create: `packages/web/src/screens/RepetitionScreen.tsx`
- Modify: the six catalogs in `packages/shared/src/i18n/`

**Interfaces:**
- Consumes: `/api/cards/*` (Task 5); shared `CardSummary`, `CardListItem`, `DueCard`, `StartCardState`, `RepetitionInfo`, `Rating`; `findById`, `nodeTitle` (`packages/web/src/start-tree.ts`); `CornerBoard` (`packages/web/src/components/CornerBoard.tsx`).
- Produces: web `fetchCardSummary()`, `fetchCards()`, `deleteCard(id)`, `fetchDueCard()`, `fetchStartCards()`, `rateReview(reviewId, rating)`; `formatWhen(iso: string, now: Date, language: Language, t: Translate): string`; `type Section = 'game' | 'repetition' | 'settings'`; `AppHeaderProps.nav: { section: Section; onSection: (s: Section) => void; due: number }`; `RepetitionScreen` props `{ tree: StartTreeNode; busy: boolean; notice: string | null; onStartQueue: () => void; onChanged: () => void }`; in `App`: `section`, `queue`, `cardsTick`, `dueCount`, `startNextCard(): void`.

- [ ] **Step 1: API** — `packages/web/src/api.ts` (same `request`/`failed` pattern as `fetchStarts`, error key `error.api.cards`):

```ts
export async function fetchCardSummary(): Promise<CardSummary> {
  const res = await request('/api/cards/summary')
  if (!res.ok) throw failed('error.api.cards', res)
  return (await res.json()) as CardSummary
}

export async function fetchCards(): Promise<CardListItem[]> {
  const res = await request('/api/cards')
  if (!res.ok) throw failed('error.api.cards', res)
  return (await res.json()) as CardListItem[]
}

export async function deleteCard(id: string): Promise<void> {
  const res = await request(`/api/cards/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw failed('error.api.cards', res)
}

export async function fetchDueCard(): Promise<DueCard> {
  const res = await request('/api/cards/due')
  if (!res.ok) throw failed('error.api.cards', res)
  return (await res.json()) as DueCard
}

export async function fetchStartCards(): Promise<Record<string, StartCardState>> {
  const res = await request('/api/cards/starts')
  if (!res.ok) throw failed('error.api.cards', res)
  return (await res.json()) as Record<string, StartCardState>
}

export async function rateReview(reviewId: number, rating: Rating): Promise<RepetitionInfo> {
  const res = await request(`/api/cards/reviews/${reviewId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating }) })
  if (!res.ok) throw failed('error.api.cards', res)
  return (await res.json()) as RepetitionInfo
}
```

- [ ] **Step 2: `formatWhen`** in `packages/web/src/format.ts` with tests in `format.test.ts`:

```ts
/** Spec (repetition) 5.1: when a card is due — «сейчас», or relative («через 10 минут», «завтра», «через 3 дня»). */
export function formatWhen(iso: string, now: Date, language: Language, t: Translate): string {
  const ms = new Date(iso).getTime() - now.getTime()
  if (ms <= 0) return t('repetition.now')
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}
```

Tests: due in the past → `t('repetition.now')`; in 10 minutes (ru) → `через 10 минут`; in 30 hours (ru) → `завтра`; in 3 days (en) → `in 3 days`.

- [ ] **Step 3: Catalog keys** (ru shown; add all to the six catalogs with proper plural forms):

```ts
  'header.repetition': 'Повторение',
  'header.dueBadge': { one: '{count} карточка к повторению', few: '{count} карточки к повторению', many: '{count} карточек к повторению', other: '{count} карточки к повторению' },
  'app.crumb.repetition': 'Повторение',
  'repetition.title': 'Повторение',
  'repetition.lead': 'Позиции из дерева возвращаются к повторению по расписанию: чем увереннее вы их играете, тем реже.',
  'repetition.dueNow': 'Пора повторить',
  'repetition.dueKinds': { one: 'позиций: {count}', few: 'позиций: {count}', many: 'позиций: {count}', other: 'позиций: {count}' },
  'repetition.learned': 'Изучено',
  'repetition.learnedOf': '{learned} из {total}',
  'repetition.nextDue': 'Ближайшее повторение — {when}',
  'repetition.forecast': 'Неделя вперёд',
  'repetition.today': 'сегодня',
  'repetition.start': 'Начать повторение',
  'repetition.doneToday': 'На сегодня всё',
  'repetition.empty': 'Карточек пока нет. Сыграйте позицию из дерева «Из списка» — после разбора она попадёт сюда.',
  'repetition.list': 'Карточки',
  'repetition.kind.position': 'Позиция',
  'repetition.due': 'Повторить: {when}',
  'repetition.now': 'сейчас',
  'repetition.stage.learning': 'изучается',
  'repetition.stage.learned': 'изучена',
  'repetition.last': 'Последняя оценка: {rating}',
  'repetition.delete': 'Удалить',
  'repetition.deleteConfirm': 'Удалить карточку? Она больше не появится, даже если вы снова сыграете эту позицию.',
  'rating.again': 'Снова',
  'rating.hard': 'Трудно',
  'rating.good': 'Хорошо',
  'rating.easy': 'Легко',
  'error.api.cards': 'Не удалось получить карточки: HTTP {status}',
```

(Rating labels in the other languages are in the Global Constraints. Check the existing `header.*` and `app.crumb.*` keys and keep their style.)

- [ ] **Step 4: Header** — `packages/web/src/components/AppHeader.tsx`: export `type Section = 'game' | 'repetition' | 'settings'`; the prop becomes

```ts
  /** The «Игра / Повторение / Настройки» switch; absent during a game and an engine update. */
  nav?: { section: Section; onSection: (s: Section) => void; due: number }
```

and the switch:

```tsx
          <nav class="segmented" aria-label={t('header.sections')}>
            <button aria-pressed={nav.section === 'game'} onClick={() => nav.onSection('game')}>{t('header.game')}</button>
            <button aria-pressed={nav.section === 'repetition'} onClick={() => nav.onSection('repetition')}>
              {t('header.repetition')}
              {nav.due > 0 && <span class="badge" aria-label={t('header.dueBadge', { count: nav.due })}>{nav.due}</span>}
            </button>
            <button aria-pressed={nav.section === 'settings'} onClick={() => nav.onSection('settings')}>{t('header.settings')}</button>
          </nav>
```

CSS: `.badge { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }`.

- [ ] **Step 5: App state** — `packages/web/src/App.tsx`:
- `showSettings` becomes `const [section, setSection] = useState<Section>('game')`; every `setShowSettings(true)` → `setSection('settings')`, `setShowSettings(false)` → `setSection('game')`; the settings branch tests `section === 'settings'`.
- New state: `const [queue, setQueue] = useState(false)` (the current training came from the repetition queue), `const [cardsTick, setCardsTick] = useState(0)`, `const [dueCount, setDueCount] = useState(0)`, `const [queueNotice, setQueueNotice] = useState<string | null>(null)`.
- Effect next to the `fetchStarts` effect: when `ready`, on `[ready, healthTick, cardsTick, session?.status]`, `fetchCardSummary().then((s) => setDueCount(s.dueNow)).catch(() => setDueCount(0))`.
- `startNextCard`:

```ts
  // Spec (repetition) 5.2: the next due card of the queue, or back to the tab with «На сегодня всё».
  const startNextCard = (): void => {
    fetchDueCard()
      .then((due) => {
        if (!due.card) {
          setQueue(false)
          resetToStart()
          setQueueNotice(t('repetition.doneToday'))
          setSection('repetition')
          return
        }
        setQueue(true)
        setQueueNotice(null)
        resetToStart()
        setSection('game')
        startWith({ mode: 'list', environment: 'empty', userColor: due.card.userColor, botRank: due.card.botRank, corner: 'random', startId: due.card.startId })
      })
      .catch((e) => setError(failureText(e)))
  }
```

(Use the file's existing error-reporting helper instead of `setError(failureText(e))` if it differs.)
- A branch before the settings branch: `else if (section === 'repetition') { crumb = t('app.crumb.repetition'); screen = <RepetitionScreen tree={startTree} busy={starting || !connected} notice={queueNotice} onStartQueue={startNextCard} onChanged={() => setCardsTick((n) => n + 1)} /> }`.
- `nav` becomes `{ section, onSection: (s) => { setQueueNotice(null); setSection(s) }, due: dueCount }`.
- When the user leaves a queue training by «К выбору позиции» (`onNew`), `setQueue(false)` too.

- [ ] **Step 6: `packages/web/src/screens/RepetitionScreen.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks'
import type { CardListItem, CardSummary } from '@joseki-dojo/shared'
import { deleteCard, failureText, fetchCardSummary, fetchCards } from '../api'
import { CornerBoard } from '../components/CornerBoard'
import { errorText } from '../error-text'
import { formatWhen } from '../format'
import { useI18n } from '../i18n'
import { findById, nodeTitle, type StartTreeNode } from '../start-tree'

export interface RepetitionScreenProps {
  tree: StartTreeNode
  busy: boolean
  /** «На сегодня всё» after the queue ran out. */
  notice: string | null
  onStartQueue: () => void
  /** A card was deleted: the header's counter is stale. */
  onChanged: () => void
}

/** Spec (repetition) 5.1: what is due, the week ahead, the cards. */
export function RepetitionScreen({ tree, busy, notice, onStartQueue, onChanged }: RepetitionScreenProps) {
  const { language, t } = useI18n()
  const [summary, setSummary] = useState<CardSummary | null>(null)
  const [cards, setCards] = useState<CardListItem[]>([])
  const [error, setError] = useState<ReturnType<typeof failureText> | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    Promise.all([fetchCardSummary(), fetchCards()])
      .then(([s, c]) => {
        setSummary(s)
        setCards(c)
      })
      .catch((e) => setError(failureText(e)))
  }, [tick])
  const now = new Date()
  const remove = (c: CardListItem): void => {
    if (!window.confirm(t('repetition.deleteConfirm'))) return
    deleteCard(c.id)
      .then(() => {
        setTick((n) => n + 1)
        onChanged()
      })
      .catch((e) => setError(failureText(e)))
  }
  const day = (d: number): string => {
    if (d === 0) return t('repetition.today')
    const date = new Date(now)
    date.setDate(date.getDate() + d)
    return new Intl.DateTimeFormat(language, { weekday: 'short' }).format(date)
  }
  return (
    <main>
      <div class="page repetition">
        <div class="page-head">
          <h1>{t('repetition.title')}</h1>
          <p>{t('repetition.lead')}</p>
        </div>
        {error && <p class="error-text">{errorText(error, language)}</p>}
        {summary && summary.total === 0 && <p class="hint">{t('repetition.empty')}</p>}
        {summary && summary.total > 0 && (
          <>
            <div class="metrics">
              <div class="metric">
                <span class="label">{t('repetition.dueNow')}</span>
                <b>{summary.dueNow}</b>
                {summary.dueNow > 0 && <span class="sub">{t('repetition.dueKinds', { count: summary.dueByKind.position })}</span>}
                {summary.nextDue && <span class="sub">{t('repetition.nextDue', { when: formatWhen(summary.nextDue, now, language, t) })}</span>}
              </div>
              <div class="metric">
                <span class="label">{t('repetition.learned')}</span>
                <b>{t('repetition.learnedOf', { learned: summary.learned, total: summary.total })}</b>
              </div>
            </div>
            <div class="forecast" aria-label={t('repetition.forecast')}>
              {summary.forecast.map((n, d) => (
                <div key={d} class={`forecast-day${n > 0 ? '' : ' empty'}`}>
                  <b>{n}</b>
                  <span>{day(d)}</span>
                </div>
              ))}
            </div>
            <div class="start-actions">
              {notice && <span class="notice">{notice}</span>}
              <button class="primary lg" disabled={busy || summary.dueNow === 0} onClick={onStartQueue}>{t('repetition.start')}</button>
            </div>
            <section class="card-list" aria-label={t('repetition.list')}>
              <h2>{t('repetition.list')}</h2>
              {cards.map((c) => {
                const node = c.startId ? findById(tree, c.startId) : null
                return (
                  <div class="card-row" key={c.id}>
                    <CornerBoard moves={c.moves} />
                    <div class="card-row-text">
                      <b>{node ? nodeTitle(node) : t('repetition.kind.position')}</b>
                      <span>
                        {t(c.stage === 'learned' ? 'repetition.stage.learned' : 'repetition.stage.learning')} · {t('repetition.due', { when: formatWhen(c.due, now, language, t) })}
                        {c.lastRating && <> · {t('repetition.last', { rating: t(`rating.${c.lastRating}`) })}</>}
                      </span>
                    </div>
                    <button class="ghost sm" onClick={() => remove(c)}>{t('repetition.delete')}</button>
                  </div>
                )
              })}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
```

(Check `nodeTitle`'s signature in `start-tree.ts` — it may take a translator or a language — and the existing class names for hints, errors and `.page`; reuse them. A `ReturnType<typeof failureText>` state can be replaced by `LocalizedText` if that is what `failureText` returns.) The filter by kind (spec 5.1) comes with iteration 2, when there are two kinds; iteration 1 lists only positions. CSS for `.metrics` (two cards in a row, `display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px`), `.metric` (surface card, label above, big number), `.forecast` (seven equal columns, number over the day label; `.empty` muted), `.card-list` rows (`display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border)`, the board 40×40), `.notice` (muted text before the button).

- [ ] **Step 7: Run** `npm test && npm run typecheck` — PASS (the catalog test checks the six languages). **Commit:**

```bash
git add packages/web packages/shared
git commit -m "feat(cards): the «Повторение» section, its screen and the queue start" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The repetition panel in the review

**Files:**
- Modify: `packages/web/src/screens/ReviewScreen.tsx`, `packages/web/src/App.tsx`, the review stylesheet, the six catalogs

**Interfaces:**
- Consumes: `ReviewData.repetition` (Task 5); `rateReview` (Task 6); `queue`, `startNextCard`, `setCardsTick` in `App` (Task 6).
- Produces: `ReviewScreenProps.repetition?: { onRate: (rating: Rating) => void; queue: { onNext: () => void; onFinish: () => void } | null; error: string | null }` (the info itself is `review.repetition`).

- [ ] **Step 1: Catalog keys** (ru; all six catalogs):

```ts
  'review.repetition.title': 'Повторение позиции',
  'review.repetition.auto': 'Оценка по KataGo: {rating}',
  'review.repetition.clean': 'все ваши ходы точные',
  'review.repetition.worst': 'худший ход: {category}, −{loss}',
  'review.repetition.unpunished': 'ненаказанная ошибка соперника, −{loss}',
  'review.repetition.locked': 'Оценку можно поменять только у последнего повторения позиции.',
  'review.repetition.next': 'Следующее повторение: {when}',
  'review.repetition.ratings': 'Оценка повторения',
  'review.repetition.continue': 'Дальше',
  'review.repetition.finish': 'Закончить повторение',
```

(`{category}` takes the existing `category.*` labels; `{loss}` is the loss with one decimal, formatted like the review's other losses.)

- [ ] **Step 2: The panel** — in `ReviewScreen.tsx`, a `RepetitionPanel` rendered at the top of the review aside (above the move list) when `review.repetition` and `props.repetition` are present:

```tsx
function RepetitionPanel({ info, onRate, queue, error }: { info: RepetitionInfo; onRate: (r: Rating) => void; queue: { onNext: () => void; onFinish: () => void } | null; error: string | null }) {
  const { language, t } = useI18n()
  const loss = (x: number): string => x.toFixed(1)
  const reason = !info.worst
    ? t('review.repetition.clean')
    : info.worst.category === 'unpunished'
      ? t('review.repetition.unpunished', { loss: loss(info.worst.loss) })
      : t('review.repetition.worst', { category: t(`category.${info.worst.category}`), loss: loss(info.worst.loss) })
  return (
    <section class="repetition-panel" aria-label={t('review.repetition.title')}>
      <div class="label">{t('review.repetition.title')}</div>
      <p>{t('review.repetition.auto', { rating: t(`rating.${info.auto}`) })} · {reason}</p>
      <div class="segmented" role="group" aria-label={t('review.repetition.ratings')}>
        {RATINGS.map((r) => (
          <button key={r} aria-pressed={info.rating === r} disabled={!info.editable} onClick={() => onRate(r)}>{t(`rating.${r}`)}</button>
        ))}
      </div>
      {!info.editable && <p class="hint">{t('review.repetition.locked')}</p>}
      <p class="hint">{t('review.repetition.next', { when: formatWhen(info.due, new Date(), language, t) })}</p>
      {error && <p class="error-text">{error}</p>}
      {queue && (
        <div class="actions">
          <button class="primary" onClick={queue.onNext}>{t('review.repetition.continue')}</button>
          <button class="ghost" onClick={queue.onFinish}>{t('review.repetition.finish')}</button>
        </div>
      )}
    </section>
  )
}
```

Thread `repetition` through `ReviewScreenProps` → `ReviewLoadedProps` → the `<ReviewLoaded … />` call (spec 5.3). CSS: `.repetition-panel { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--accent); border-radius: 10px; background: var(--accent-bg); }`.

- [ ] **Step 3: App** — the review branch passes

```tsx
        repetition={{
          onRate: (rating) => {
            const info = review?.repetition
            if (!info) return
            rateReview(info.reviewId, rating)
              .then((next) => {
                setReview((r) => (r ? { ...r, repetition: next } : r))
                setRatingError(null)
                setCardsTick((n) => n + 1)
              })
              .catch((e) => setRatingError(errorText(failureText(e), language)))
          },
          queue: queue ? { onNext: startNextCard, onFinish: () => { setQueue(false); resetToStart(); setSection('repetition') } } : null,
          error: ratingError,
        }}
```

with `const [ratingError, setRatingError] = useState<string | null>(null)` (cleared when a new session starts). When a queue training's review is shown, `onNext` of the regular review buttons keeps its meaning (replay the position); the queue's «Дальше» is in the panel. Bump `cardsTick` when a `reviewReady` arrives (the card was just recorded).

- [ ] **Step 4: Run** `npm test && npm run typecheck` — PASS. **Commit:**

```bash
git add packages/web packages/shared
git commit -m "feat(cards): the repetition panel in the review" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Progress in the «Из списка» tree

**Files:**
- Modify: `packages/web/src/start-tree.ts`, `packages/web/src/start-tree.test.ts`, `packages/web/src/components/StartTree.tsx`, `packages/web/src/screens/StartScreen.tsx`, `packages/web/src/App.tsx`, the start screen stylesheet, the six catalogs

**Interfaces:**
- Consumes: `fetchStartCards()` (Task 6), `cardsTick` (Task 6), `StartCardState`.
- Produces: `nodeProgress(node: StartTreeNode, cards: Readonly<Record<string, StartCardState>>): NodeProgress` with `interface NodeProgress { own: StartCardState | null; learned: number; total: number; due: number; started: boolean }`; `StartTreeProps.cards?: Record<string, StartCardState>`; `StartScreenProps.cards?: Record<string, StartCardState>`.

- [ ] **Step 1: Failing test** in `start-tree.test.ts`:

```ts
describe('nodeProgress', () => {
  const root = buildStartTree(LIST, BRANCHES, GROUPS, 'Пустой угол', 'ru')
  const cards = {
    снизу: { stage: 'learned' as const, due: '2026-10-20T10:00:00.000Z', dueNow: false },
    хане: { stage: 'learning' as const, due: '2026-10-15T10:00:00.000Z', dueNow: true },
  }
  it('counts the learned and due positions under a node and gives a position its own state', () => {
    const under = findById(root, 'снизу')!
    expect(nodeProgress(under, cards)).toEqual({ own: cards.снизу, learned: 1, total: 3, due: 1, started: true })
    const g44 = findNode(root, 'group:4-4')!
    expect(nodeProgress(g44, cards)).toEqual({ own: null, learned: 0, total: 1, due: 0, started: false })
  })
})
```

(Reuse the fixtures already in the file — `LIST`, `BRANCHES`, `GROUPS` and the `buildStartTree` call as the existing tests make it; adjust the ids to the fixture's. `total` counts the node itself when it is a position, plus every position below it.)

- [ ] **Step 2: `nodeProgress`** in `start-tree.ts`:

```ts
export interface NodeProgress {
  /** The node's own card, when it is a position with a card. */
  own: StartCardState | null
  /** Positions at or under the node: learned, all, due now. */
  learned: number
  total: number
  due: number
  /** Some position at or under the node has a card. */
  started: boolean
}

/** Spec (repetition) 6: the card progress of a node. */
export function nodeProgress(node: StartTreeNode, cards: Readonly<Record<string, StartCardState>>): NodeProgress {
  const p: NodeProgress = { own: node.id ? (cards[node.id] ?? null) : null, learned: 0, total: 0, due: 0, started: false }
  const walk = (n: StartTreeNode): void => {
    if (n.kind === 'position' && n.id) {
      p.total++
      const c = cards[n.id]
      if (c) {
        p.started = true
        if (c.stage === 'learned') p.learned++
        if (c.dueNow) p.due++
      }
    }
    n.children.forEach(walk)
  }
  walk(node)
  return p
}
```

- [ ] **Step 3: Catalog keys** (ru; all six):

```ts
  'tree.card.learning': 'изучается',
  'tree.card.learned': 'изучена',
  'tree.card.due': 'пора повторить',
  'tree.card.next': 'повторить {when}',
  'tree.progress': 'изучено {learned} из {total}',
```

- [ ] **Step 4: Marks** — `StartTree.tsx` takes `cards?: Record<string, StartCardState>` (default `{}`):
- `OutlineRow` and the continuation cards: a position with a card shows a mark before the count: `<span class={`card-mark ${own.dueNow ? 'due' : own.stage}`} title={…} aria-label={…} />` where the text is `tree.card.due`, `tree.card.learned` or `tree.card.learning`;
- a group or branch whose progress is `started` shows `learned/total` in place of the plain count (`title`/`aria-label` = `tree.progress`) and, when `due > 0`, a small `.badge` with `due`;
- the info panel under the board adds, for a position with a card, `tree.card.due` or `tree.card.next` with `formatWhen(own.due, new Date(), language, t)`.
CSS: `.card-mark { width: 8px; height: 8px; border-radius: 50%; flex: none; } .card-mark.learning { background: var(--warning); } .card-mark.learned { background: var(--good); } .card-mark.due { background: var(--accent); box-shadow: 0 0 0 2px var(--accent-bg); }`.

- [ ] **Step 5: Data** — `App.tsx`: `const [startCards, setStartCards] = useState<Record<string, StartCardState>>({})`, fetched with `fetchStartCards()` in the same effect as the summary (Task 6, Step 5); `StartScreen` gets `cards={startCards}` and passes it to `StartTree`.

- [ ] **Step 6: Run** `npm test && npm run typecheck` — PASS. **Commit:**

```bash
git add packages/web packages/shared
git commit -m "feat(cards): progress marks in the «Из списка» tree" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: End-to-end tests and README

**Files:**
- Create: `e2e/repetition.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above; the e2e server (`playwright.config.ts`, Russian UI, fake KataGo: every move exact, so an auto rating is «Хорошо»).

- [ ] **Step 1: `e2e/repetition.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test'

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)

async function playListPosition(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('radio', { name: /Из списка/ }).check()
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  const tree = page.locator('.start-tree')
  await tree.locator('.start-card', { hasText: '4-4' }).click()
  await tree.locator('.start-board .corner-mark', { hasText: 'A' }).click()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await vertex(page, 13, 2).click()
  await expect(page.getByTestId('moves-count')).toHaveText('2')
  await page.getByRole('button', { name: 'Закончить' }).click()
}

test('a trained position becomes a card: rated in the review, listed in «Повторение», marked in the tree', async ({ page }) => {
  await playListPosition(page)
  const panel = page.getByRole('region', { name: 'Повторение позиции' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Хорошо' })).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('button', { name: 'Трудно' }).click()
  await expect(panel.getByRole('button', { name: 'Трудно' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: /^Повторение/ }).click()
  await expect(page.getByRole('heading', { name: 'Повторение' })).toBeVisible()
  await expect(page.locator('.card-row')).toHaveCount(1)
  await expect(page.locator('.card-row')).toContainText('Тестовое начало')

  await page.getByRole('button', { name: 'Игра' }).click()
  await page.getByRole('button', { name: 'К выбору позиции' }).click()
  await page.getByRole('radio', { name: /Из списка/ }).check()
  await expect(page.locator('.start-tree .card-mark')).not.toHaveCount(0)

  await page.getByRole('button', { name: /^Повторение/ }).click()
  page.once('dialog', (d) => d.accept())
  await page.locator('.card-row').getByRole('button', { name: 'Удалить' }).click()
  await expect(page.locator('.card-row')).toHaveCount(0)
})

test('the level is saved in Settings', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Настройки' }).click()
  const level = page.getByRole('combobox', { name: 'Ваш уровень' })
  await expect(level).toHaveValue('7k')
  await level.selectOption('3d')
  await page.reload()
  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByRole('combobox', { name: 'Ваш уровень' })).toHaveValue('3d')
})
```

(The e2e server shares one database across tests in a run: the second test must not depend on the first. If the review crumb or the return button texts differ in the current UI, take them from `e2e/starts.spec.ts`.)

- [ ] **Step 2: README** — in the user part, a short paragraph on «Повторение»: what becomes a card (a position from the tree after its first training), the automatic rating with the four buttons, the schedule (FSRS), the tab and the marks in the tree, and «Ваш уровень» in Settings.

- [ ] **Step 3: Run** `npm test && npm run typecheck && npm run e2e` — PASS. **Commit:**

```bash
git add e2e README.md
git commit -m "test(cards): e2e for position cards and the level; README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
