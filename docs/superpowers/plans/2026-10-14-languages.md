# Interface Languages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Joseki Dojo speaks English (default), Russian, Simplified Chinese, Traditional Chinese, Korean and Japanese, switched at runtime from the settings and a globe menu, asked by the Windows installer and by a first-start screen.

**Architecture:** Typed dictionaries in `packages/shared/src/i18n` (`ru.ts` is the model, the other five have the same keys or typecheck fails) and one `t(lang, key, params)` with `Intl.PluralRules`. The server stops sending Russian text: every player-facing message is a `LocalizedText = { key, params }` that the web renders in the current language. Start position names come from a new `starts-i18n.json` keyed by moves. The Windows installer writes the chosen language to a file that the desktop app hands to the server on first start.

**Tech Stack:** TypeScript, Preact, Fastify, Electron + electron-builder (NSIS), Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-14-languages-design.md](../specs/2026-10-14-languages-design.md). **Terms:** [glossary](../specs/2026-10-14-languages-glossary.md).

## Global Constraints

- Languages and order: `en`, `ru`, `zh-Hans`, `zh-Hant`, `ko`, `ja`; native names English, Русский, 简体中文, 繁體中文, 한국어, 日本語 (spec 3).
- Default language: `en` — when `ui.language` is missing and in the installer (spec 3, 8.1). No migration for existing configs.
- Windows LANGIDs: 1033 en, 1049 ru, 2052 zh-Hans, 1028 zh-Hant, 1042 ko, 1041 ja; unknown → en (spec 3).
- Every Go term in every language comes from the glossary; a term missing there is added to the glossary with a source before it is used (spec 4.3).
- No new runtime dependencies (spec approach A).
- Out of scope: server and KataGo logs, base read errors, `npm run setup`, `traps:*`, `jdb:dump`, translations of README and docs (spec 2).
- Code, identifiers, comments, commit messages: English. Player-facing text: from the dictionaries only.
- Comments follow the repo: a short doc comment where the intent is not obvious, the spec section in it (`Spec (languages) 6:`).
- Commits only at the four milestones below (CLAUDE.md «Large commits»); tasks between milestones leave their changes uncommitted. Commit email is the noreply address in `.git/config`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before each milestone commit: `npx vitest run` and `npm run typecheck` pass. `npm run e2e` needs Playwright browsers; when they are missing locally, CI runs it.

## How the string-extraction tasks are written

Tasks 4–6 move about 240 Russian strings of the web UI into the dictionaries. Writing every one of them out here would duplicate the work, so those tasks give: the files, the key prefix, the conversion patterns with real examples from the code, the translation rules, and a check that leaves no Cyrillic outside the dictionaries. Every other task has its full code.

### Key naming
Dotted, area first: `app.*`, `header.*`, `language.*`, `start.*`, `tree.*`, `game.*`, `review.*`, `variation.*`, `settings.*`, `install.*`, `engine.*`, `update.*`, `error.*`, `health.*`, `common.*`, `rank.*`, `category.*`, `corner.*`, `actor.*`. Name the meaning, not the words: `review.next`, not `review.sledushayaPoziciya`.

### Translation rules (all tasks that add keys)
1. Add the key to `ru.ts` with the exact current Russian text (moving it, not rewriting it).
2. Add the same key to `en.ts`, `zh-Hans.ts`, `zh-Hant.ts`, `ko.ts`, `ja.ts`.
3. Go terms: the glossary column of that language. UI terms in glossary section 4: joseki 定石 / 定式 / 정석, tenuki 手抜き / 脱先 / 脫先 / 손빼기, trap ハメ手 / 骗招 / 騙招 / 함정수, review 検討 / 复盘 / 復盤 / 복기, variation 変化 / 变化 / 變化 / 변화, black/white 黒 白 / 黑 白 / 흑 백, corner 隅 / 角 / 귀, points 目 / 目 / 집.
4. Ranks: en `7 kyu` / `1 dan`; ja `7級` / `初段` (1 dan only; `2段`…); zh-Hans `7级` / `1段`; zh-Hant `7級` / `1段`; ko `7급` / `1단`.
5. zh-Hant is Taiwan usage, not a character conversion of zh-Hans where wording differs (软件 → 軟體, 设置 → 設定, 视频 → 影片…).
6. Keep `{params}` exactly; keep `…`, `—` and quotes style of each language (ja/zh use 「」 or no quotes, ko uses ‘ ’ or none).
7. Short UI labels stay short (buttons, chips): no longer than the English one by more than a few characters.

---

## Task 1: Dictionaries and `t` in `packages/shared`

**Files:**
- Create: `packages/shared/src/i18n/languages.ts`, `packages/shared/src/i18n/message.ts`, `packages/shared/src/i18n/ru.ts`, `packages/shared/src/i18n/en.ts`, `packages/shared/src/i18n/zh-Hans.ts`, `packages/shared/src/i18n/zh-Hant.ts`, `packages/shared/src/i18n/ko.ts`, `packages/shared/src/i18n/ja.ts`, `packages/shared/src/i18n/catalogs.ts`, `packages/shared/src/i18n/translate.ts`, `packages/shared/src/i18n/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/i18n/translate.test.ts`, `packages/shared/src/i18n/catalogs.test.ts`

**Interfaces:**
- Produces: `LANGUAGES`, `type Language`, `DEFAULT_LANGUAGE`, `isLanguage(v)`, `LANGUAGE_NAMES`, `languageFromWindowsId(id: number): Language`; `type Message`, `type PluralForms`, `type MessageKey`, `type Catalog`; `CATALOGS: Record<Language, Catalog>`; `type TextParam = string | number | LocalizedText`, `interface LocalizedText { key: MessageKey; params?: Record<string, TextParam> }`, `type Translate = (key: MessageKey, params?: Record<string, TextParam>) => string`, `t(lang, key, params?)`, `translator(lang): Translate`, `localize(lang, text: LocalizedText): string`, `isLocalizedText(v): v is LocalizedText`.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/i18n/translate.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { isLanguage, languageFromWindowsId, LANGUAGES } from './languages'
import { isLocalizedText, localize, t, translator } from './translate'

describe('t', () => {
  it('substitutes parameters and leaves an unknown one as it is', () => {
    expect(t('ru', 'error.internal', { detail: 'boom' })).toBe('Внутренняя ошибка: boom')
    expect(t('en', 'error.internal')).toBe('Internal error: {detail}')
  })

  it('picks the plural form by count, Russian and English', () => {
    const ru = (value: string, count: number): string => t('ru', 'common.pointsValue', { value, count })
    expect([ru('1', 1), ru('2', 2), ru('5', 5), ru('1,5', 1.5), ru('21', 21)]).toEqual(['1 очко', '2 очка', '5 очков', '1,5 очка', '21 очко'])
    expect([1, 2].map((count) => t('en', 'common.pointsValue', { value: String(count), count }))).toEqual(['1 point', '2 points'])
    expect(t('ja', 'common.pointsValue', { value: '3', count: 3 })).toBe('3目')
  })

  it('formats numbers in the language and translates nested texts', () => {
    expect(t('ru', 'error.internal', { detail: 1200 })).toBe('Внутренняя ошибка: 1 200')
    expect(t('en', 'error.internal', { detail: 1200 })).toBe('Internal error: 1,200')
    expect(localize('ru', { key: 'error.internal', params: { detail: { key: 'common.pointsValue', params: { value: '2', count: 2 } } } })).toBe('Внутренняя ошибка: 2 очка')
    expect(translator('en')('error.internal', { detail: 'x' })).toBe('Internal error: x')
  })

  it('tells a localized text from other values', () => {
    expect([isLocalizedText({ key: 'error.internal' }), isLocalizedText('text'), isLocalizedText({ key: 1 })]).toEqual([true, false, false])
  })
})

describe('languages', () => {
  it('lists the six languages in menu order', () => {
    expect(LANGUAGES).toEqual(['en', 'ru', 'zh-Hans', 'zh-Hant', 'ko', 'ja'])
    expect([isLanguage('ko'), isLanguage('fr'), isLanguage(undefined)]).toEqual([true, false, false])
  })

  it('maps Windows language ids, unknown to English', () => {
    expect([1033, 1049, 2052, 1028, 1042, 1041, 1031].map(languageFromWindowsId)).toEqual(['en', 'ru', 'zh-Hans', 'zh-Hant', 'ko', 'ja', 'en'])
  })
})
```

`packages/shared/src/i18n/catalogs.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CATALOGS } from './catalogs'
import { LANGUAGES } from './languages'
import type { Message } from './message'
import { ru } from './ru'

const params = (m: Message): string[] => {
  const texts = typeof m === 'string' ? [m] : Object.values(m)
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1])))].sort()
}

describe('dictionaries', () => {
  const keys = Object.keys(ru).sort()
  for (const lang of LANGUAGES) {
    const catalog = CATALOGS[lang] as Record<string, Message>
    it(`${lang} has exactly the keys of ru`, () => {
      expect(Object.keys(catalog).sort()).toEqual(keys)
    })
    it(`${lang} keeps the parameters of every message`, () => {
      for (const key of keys) expect(params(catalog[key]), key).toEqual(params((ru as Record<string, Message>)[key]))
    })
    it(`${lang} gives every plural form its language can pick`, () => {
      const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories
      for (const key of keys) {
        const m = catalog[key]
        const model = (ru as Record<string, Message>)[key]
        expect(typeof m === 'string', key).toBe(typeof model === 'string')
        if (typeof m !== 'string') for (const c of categories) expect(m[c], `${key}.${c}`).toBeTypeOf('string')
      }
    })
    it(`${lang} has no empty message`, () => {
      for (const key of keys) {
        const m = catalog[key]
        for (const s of typeof m === 'string' ? [m] : Object.values(m)) expect(s.trim(), key).not.toBe('')
      }
    })
  }
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/shared/src/i18n`
Expected: FAIL — `Cannot find module './languages'`.

- [ ] **Step 3: Write the code**

`packages/shared/src/i18n/languages.ts`:
```ts
/** Spec (languages) 3: the interface languages in menu order. */
export const LANGUAGES = ['en', 'ru', 'zh-Hans', 'zh-Hant', 'ko', 'ja'] as const
export type Language = (typeof LANGUAGES)[number]

/** Spec (languages) 3: without `ui.language` the interface is English. */
export const DEFAULT_LANGUAGE: Language = 'en'

export const isLanguage = (value: unknown): value is Language => (LANGUAGES as readonly unknown[]).includes(value)

/** Each language named in itself, for the menus and the first start screen. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  ru: 'Русский',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  ko: '한국어',
  ja: '日本語',
}

const WINDOWS_LANGUAGE_IDS: Record<number, Language> = { 1033: 'en', 1049: 'ru', 2052: 'zh-Hans', 1028: 'zh-Hant', 1042: 'ko', 1041: 'ja' }

/** Spec (languages) 8.1: the LANGID the Windows installer writes; an unknown one is English. */
export const languageFromWindowsId = (id: number): Language => WINDOWS_LANGUAGE_IDS[id] ?? DEFAULT_LANGUAGE
```

`packages/shared/src/i18n/message.ts`:
```ts
/** CLDR plural forms; `other` is always there, the rest as the language needs (`Intl.PluralRules`). */
export interface PluralForms {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

/** A dictionary entry: a text with `{params}`, or plural forms chosen by `{count}`. */
export type Message = string | PluralForms
```

`packages/shared/src/i18n/ru.ts` (the model; later tasks add keys here first):
```ts
import type { Message } from './message'

/** Spec (languages) 4.1: the model dictionary. Every other language has exactly these keys. */
export const ru = {
  // A number of points already formatted by the caller (`value`, one decimal) with its plural form chosen by `count`.
  'common.pointsValue': { one: '{value} очко', few: '{value} очка', many: '{value} очков', other: '{value} очка' },
  'error.internal': 'Внутренняя ошибка: {detail}',
} satisfies Record<string, Message>
```

`packages/shared/src/i18n/en.ts`:
```ts
import type { Catalog } from './catalogs'

export const en: Catalog = {
  'common.pointsValue': { one: '{value} point', other: '{value} points' },
  'error.internal': 'Internal error: {detail}',
}
```

`packages/shared/src/i18n/zh-Hans.ts`:
```ts
import type { Catalog } from './catalogs'

export const zhHans: Catalog = {
  'common.pointsValue': { other: '{value}目' },
  'error.internal': '内部错误：{detail}',
}
```

`packages/shared/src/i18n/zh-Hant.ts`:
```ts
import type { Catalog } from './catalogs'

export const zhHant: Catalog = {
  'common.pointsValue': { other: '{value}目' },
  'error.internal': '內部錯誤：{detail}',
}
```

`packages/shared/src/i18n/ko.ts`:
```ts
import type { Catalog } from './catalogs'

export const ko: Catalog = {
  'common.pointsValue': { other: '{value}집' },
  'error.internal': '내부 오류: {detail}',
}
```

`packages/shared/src/i18n/ja.ts`:
```ts
import type { Catalog } from './catalogs'

export const ja: Catalog = {
  'common.pointsValue': { other: '{value}目' },
  'error.internal': '内部エラー：{detail}',
}
```

`packages/shared/src/i18n/catalogs.ts`:
```ts
import { en } from './en'
import { ja } from './ja'
import { ko } from './ko'
import type { Language } from './languages'
import type { Message } from './message'
import { ru } from './ru'
import { zhHans } from './zh-Hans'
import { zhHant } from './zh-Hant'

export type MessageKey = keyof typeof ru
/** Spec (languages) 4.1: a dictionary must have every key of `ru` — a missing one fails the typecheck. */
export type Catalog = Record<MessageKey, Message>

export const CATALOGS: Record<Language, Catalog> = { en, ru, 'zh-Hans': zhHans, 'zh-Hant': zhHant, ko, ja }
```

`packages/shared/src/i18n/translate.ts`:
```ts
import { CATALOGS, type MessageKey } from './catalogs'
import type { Language } from './languages'
import type { Message } from './message'

/** Spec (languages) 6: a text sent as a key so that it is shown in the reader's language. */
export interface LocalizedText {
  key: MessageKey
  params?: Record<string, TextParam>
}
export type TextParam = string | number | LocalizedText
export type Translate = (key: MessageKey, params?: Record<string, TextParam>) => string

const pluralRules = new Map<Language, Intl.PluralRules>()
const numberFormats = new Map<Language, Intl.NumberFormat>()
const cached = <T>(map: Map<Language, T>, lang: Language, make: () => T): T => {
  let value = map.get(lang)
  if (!value) map.set(lang, (value = make()))
  return value
}

const pick = (lang: Language, message: Message, count: TextParam | undefined): string => {
  if (typeof message === 'string') return message
  if (typeof count !== 'number') return message.other
  return message[cached(pluralRules, lang, () => new Intl.PluralRules(lang)).select(count)] ?? message.other
}

const show = (lang: Language, value: TextParam): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return cached(numberFormats, lang, () => new Intl.NumberFormat(lang)).format(value)
  return t(lang, value.key, value.params)
}

/** Spec (languages) 4.2: the text of `key` in `lang` with `{params}` filled in; numbers are formatted for the language. */
export function t(lang: Language, key: MessageKey, params: Record<string, TextParam> = {}): string {
  const message = CATALOGS[lang][key] ?? CATALOGS.en[key]
  if (message === undefined) return key
  return pick(lang, message, params.count).replace(/\{(\w+)\}/g, (whole, name: string) => (params[name] === undefined ? whole : show(lang, params[name])))
}

export const translator =
  (lang: Language): Translate =>
  (key, params) =>
    t(lang, key, params)

export const localize = (lang: Language, text: LocalizedText): string => t(lang, text.key, text.params)

export const isLocalizedText = (value: unknown): value is LocalizedText =>
  typeof value === 'object' && value !== null && typeof (value as { key?: unknown }).key === 'string'
```

`packages/shared/src/i18n/index.ts`:
```ts
export * from './languages'
export * from './message'
export * from './catalogs'
export * from './translate'
```

`packages/shared/src/index.ts` — append:
```ts
export * from './i18n'
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/shared/src/i18n && npm run typecheck`
Expected: PASS; typecheck clean.

No commit: Tasks 1–3 form milestone 1.

---

## Task 2: The language setting (server, config, web runtime)

**Files:**
- Create: `packages/server/src/text-error.ts`, `packages/web/src/i18n.tsx`
- Modify: `packages/shared/src/types.ts` (`UiSettings`), `packages/server/src/config.ts` (`validate`), `packages/server/src/settings/ui.ts`, `packages/server/src/api/ui-routes.ts`, `packages/server/src/start.ts` (`ServerOptions.initialLanguage`), `packages/web/src/api.ts` (`saveLanguage`), `packages/web/src/App.tsx` (provider), `packages/shared/src/i18n/*.ts` (keys `error.ui.theme`, `error.ui.language`)
- Test: `packages/server/src/settings/ui.test.ts` (create or extend), `packages/server/src/config.test.ts`, `packages/server/src/start.test.ts`, `packages/web/src/i18n.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Language`, `isLanguage`, `DEFAULT_LANGUAGE`, `LocalizedText`, `translator`, `localize`, `Translate`).
- Produces: `UiSettings { theme: Theme; language?: Language }`; `class TextError extends Error { readonly text: LocalizedText }` and `textOf(err: unknown): LocalizedText` in `packages/server/src/text-error.ts`; `UiService.setLanguage(language: unknown): Promise<UiSettings>`, `UiService.applyInitialLanguage(language: Language): Promise<void>`; `ServerOptions.initialLanguage?: Language`; `PUT /api/ui` accepts `{ theme?, language? }` and answers 400 `{ error: LocalizedText }`; web `I18nContext`, `useI18n(): { language: Language; t: Translate; setLanguage(lang: Language): void; chosen: boolean | null }`, `useT(): Translate`, `storedLanguage(): Language`, `rememberLanguage(lang)`; `saveLanguage(language): Promise<UiSettings>` in `api.ts`.

- [ ] **Step 1: Write the failing tests**

Server, `packages/server/src/settings/ui.test.ts` (extend if it exists; it uses a temp config file like the other settings tests):
```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir, testConfig } from '../../test/helpers'
import { UiService, UiSettingsError } from './ui'

const service = () => {
  const file = join(tempDir(), 'config.json')
  const config = testConfig()
  return { file, config, ui: new UiService(config, file) }
}

describe('UiService language', () => {
  it('has no language until one is chosen', () => {
    expect(service().ui.view().language).toBeUndefined()
  })

  it('saves a language next to the theme', async () => {
    const { file, ui } = service()
    await ui.setTheme('dark')
    expect(await ui.setLanguage('ko')).toEqual({ theme: 'dark', language: 'ko' })
    expect(JSON.parse(readFileSync(file, 'utf8')).ui).toEqual({ theme: 'dark', language: 'ko' })
  })

  it('refuses an unknown language with a key', async () => {
    const err = await service().ui.setLanguage('fr').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UiSettingsError)
    expect((err as UiSettingsError).text).toEqual({ key: 'error.ui.language' })
  })

  it('takes the installer language only when none is saved', async () => {
    const { ui } = service()
    await ui.applyInitialLanguage('ja')
    expect(ui.view().language).toBe('ja')
    await ui.applyInitialLanguage('ru')
    expect(ui.view().language).toBe('ja')
  })
})
```

`packages/server/src/config.test.ts` — add:
```ts
it('reads ui.language and refuses an unknown one', () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ ui: { language: 'zh-Hant' } }))
  expect(loadConfig(join(dir, 'a.json')).ui).toEqual({ theme: 'system', language: 'zh-Hant' })
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ ui: { language: 'xx' } }))
  expect(() => loadConfig(join(dir, 'b.json'))).toThrow('ui.language is not a valid language: xx')
})
```

`packages/server/src/start.test.ts` — add next to the test at line 43, built the same way (its `root`, `configFile`, `webDist`, `REPO_LOCK` and the `servers` cleanup list):
```ts
  it('writes initialLanguage into a config without a language, and keeps a saved one', async () => {
    const root = tempDir()
    const configFile = join(root, 'config.json')
    const start = (initialLanguage: Language) =>
      startServer({ configFile, dataDir: join(root, 'data'), enginesDir: join(root, 'engines'), lockFile: REPO_LOCK, webDist, port: 0, log: () => undefined, initialLanguage })
    const first = await start('ko')
    servers.push(first)
    expect(first.services.config.ui.language).toBe('ko')
    await first.close()
    const second = await start('ja')
    servers.push(second)
    expect(second.services.config.ui.language).toBe('ko')
  })
```

Web, `packages/web/src/i18n.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { pickLanguage } from './i18n'

describe('pickLanguage', () => {
  it('takes the saved language, else the remembered one', () => {
    expect(pickLanguage({ theme: 'system', language: 'ja' }, 'ru')).toEqual({ language: 'ja', chosen: true })
    expect(pickLanguage({ theme: 'system' }, 'ru')).toEqual({ language: 'ru', chosen: false })
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/server/src/settings packages/server/src/config.test.ts packages/server/src/start.test.ts packages/web/src/i18n.test.ts`
Expected: FAIL — `setLanguage is not a function`, missing `pickLanguage`.

- [ ] **Step 3: Add the dictionary keys**

`ru.ts`:
```ts
'error.ui.theme': 'Неизвестная тема оформления',
'error.ui.language': 'Неизвестный язык',
```
`en.ts`: `'Unknown colour theme'`, `'Unknown language'`. Other languages per the translation rules (e.g. ja `不明なテーマです` / `不明な言語です`).

- [ ] **Step 4: Write the code**

`packages/shared/src/types.ts` — `UiSettings`:
```ts
/** `GET/PUT /api/ui`: interface preferences saved in the config file. */
export interface UiSettings {
  theme: Theme
  /** Spec (languages) 3: absent until the player (or the installer) chooses; the interface is English meanwhile. */
  language?: Language
}
```
(import `type Language` from `./i18n`).

`packages/server/src/text-error.ts`:
```ts
import { localize, type LocalizedText } from '@joseki-dojo/shared'

/** Spec (languages) 6: an error the player sees; `message` is the English text for the log. */
export class TextError extends Error {
  constructor(
    readonly text: LocalizedText,
    options?: ErrorOptions,
  ) {
    super(localize('en', text), options)
    this.name = 'TextError'
  }
}

/** The player-facing text of any error: its own key, or `error.internal` with the raw message. */
export const textOf = (err: unknown): LocalizedText =>
  err instanceof TextError ? err.text : { key: 'error.internal', params: { detail: err instanceof Error ? err.message : String(err) } }
```

`packages/server/src/config.ts` — at the end of `validate`:
```ts
  if (c.ui.language !== undefined && !isLanguage(c.ui.language)) throw new ConfigError(`ui.language is not a valid language: ${String(c.ui.language)}`)
```
(import `isLanguage` from `@joseki-dojo/shared`).

`packages/server/src/settings/ui.ts`:
```ts
import { isLanguage, THEMES, type Language, type Theme, type UiSettings } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import { TextError } from '../text-error'
import { updateConfigFile } from './config-writer'

export class UiSettingsError extends TextError {}

/** Interface preferences (the colour theme and the language), saved in the config file next to the engine settings. */
export class UiService {
  constructor(
    private readonly config: AppConfig,
    private readonly configFile: string,
  ) {}

  view(): UiSettings {
    return { ...this.config.ui }
  }

  async setTheme(theme: unknown): Promise<UiSettings> {
    if (!THEMES.includes(theme as Theme)) throw new UiSettingsError({ key: 'error.ui.theme' })
    return this.save({ theme: theme as Theme })
  }

  async setLanguage(language: unknown): Promise<UiSettings> {
    if (!isLanguage(language)) throw new UiSettingsError({ key: 'error.ui.language' })
    return this.save({ language })
  }

  /** Spec (languages) 8.1: the installer's choice, kept only when the player has none yet. */
  async applyInitialLanguage(language: Language): Promise<void> {
    if (this.config.ui.language === undefined) await this.save({ language })
  }

  private async save(change: Partial<UiSettings>): Promise<UiSettings> {
    await updateConfigFile(this.configFile, (raw) => {
      raw.ui = { ...((raw.ui ?? {}) as Record<string, unknown>), ...change }
    })
    this.config.ui = { ...this.config.ui, ...change }
    return this.view()
  }
}
```

`packages/server/src/api/ui-routes.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { UiSettingsError, type UiService } from '../settings/ui'

export function registerUiRoutes(app: FastifyInstance, ui: UiService): void {
  app.get('/api/ui', async () => ui.view())

  /** `{ theme }` and/or `{ language }`; an invalid value changes nothing; an empty body is an unknown theme, as before. */
  app.put<{ Body: { theme?: unknown; language?: unknown } }>('/api/ui', async (req, reply) => {
    const { theme, language } = req.body ?? {}
    try {
      if (language !== undefined && !isLanguage(language)) throw new UiSettingsError({ key: 'error.ui.language' })
      if (theme !== undefined || language === undefined) await ui.setTheme(theme)
      if (language !== undefined) await ui.setLanguage(language)
      return ui.view()
    } catch (err) {
      if (err instanceof UiSettingsError) return reply.code(400).send({ error: err.text })
      throw err
    }
  })
}
```
(import `isLanguage` from `@joseki-dojo/shared`). Update the existing `api.test.ts` expectation of `{ error: 'Неизвестная тема оформления' }` to `{ error: { key: 'error.ui.theme' } }`.

`packages/server/src/start.ts` — `ServerOptions`:
```ts
  /** Spec (languages) 8.1: the language chosen in the Windows installer; saved only into a config without one. */
  initialLanguage?: Language
```
and right after the services are created (where `UiService` is available as `services.ui`):
```ts
  if (opts.initialLanguage) await services.ui.applyInitialLanguage(opts.initialLanguage)
```

`packages/web/src/api.ts` — next to `saveTheme`:
```ts
export async function saveLanguage(language: Language): Promise<UiSettings> {
  const res = await fetch('/api/ui', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language }) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as UiSettings
}
```

`packages/web/src/i18n.tsx`:
```tsx
import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import { DEFAULT_LANGUAGE, isLanguage, translator, type Language, type Translate, type UiSettings } from '@joseki-dojo/shared'

const STORAGE_KEY = 'joseki-dojo.language'

/** Spec (languages) 5: the last language, remembered so that the page does not flash in English before /api/ui answers. */
export function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isLanguage(value) ? value : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

/** Remembers `lang` and sets `<html lang>`, which picks the Japanese, Chinese or Korean shapes of the characters. */
export function rememberLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Storage is off: the next start shows English until /api/ui answers.
  }
  document.documentElement.lang = lang
}

/** The language to show from the saved settings: the saved one, else the remembered one; `chosen` is false until the player picks. */
export const pickLanguage = (ui: UiSettings, remembered: Language): { language: Language; chosen: boolean } =>
  ui.language ? { language: ui.language, chosen: true } : { language: remembered, chosen: false }

export interface I18n {
  language: Language
  t: Translate
  setLanguage: (lang: Language) => void
  /** Whether the player has a saved language; null until /api/ui answers. */
  chosen: boolean | null
}

export const I18nContext = createContext<I18n>({ language: DEFAULT_LANGUAGE, t: translator(DEFAULT_LANGUAGE), setLanguage: () => undefined, chosen: null })
export const useI18n = (): I18n => useContext(I18nContext)
export const useT = (): Translate => useContext(I18nContext).t
```

`packages/web/src/App.tsx`:
- State: `const [language, setLanguageState] = useState<Language>(storedLanguage)` and `const [languageChosen, setLanguageChosen] = useState<boolean | null>(null)`.
- Replace the theme effect:
```tsx
  // The saved colour theme and language; without the server the page keeps the system colours and the remembered language.
  useEffect(() => {
    fetchUi()
      .then((u) => {
        applyTheme(u.theme)
        const picked = pickLanguage(u, storedLanguage())
        setLanguageState(picked.language)
        rememberLanguage(picked.language)
        setLanguageChosen(picked.chosen)
      })
      .catch(() => undefined)
  }, [])
```
- The context value:
```tsx
  const i18n = useMemo<I18n>(
    () => ({
      language,
      t: translator(language),
      chosen: languageChosen,
      setLanguage: (lang) => {
        setLanguageState(lang)
        rememberLanguage(lang)
        setLanguageChosen(true)
        saveLanguage(lang).catch(() => undefined) // the next start asks again; the page already shows the choice
      },
    }),
    [language, languageChosen],
  )
```
- Wrap the returned tree: `<I18nContext.Provider value={i18n}>…</I18nContext.Provider>`.
- `index.html` keeps `lang="ru"` until Task 7 sets the default to `en`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

---

## Task 3: Server messages as keys

**Files:**
- Modify: `packages/shared/src/types.ts` (`HealthResponse.reason`), `packages/shared/src/protocol.ts` (`error` message), `packages/shared/src/install.ts` (`InstallFile.label`, `InstallStatus.error`, `InstallStatus.note`), `packages/shared/src/settings.ts` (`versionWarning`, `SettingsResponse.reason`), `packages/shared/src/desktop.ts` (`AppUpdateState` error)
- Modify (server): `session/session.ts`, `engine/engine.ts`, `engine/health.ts`, `engine/lock.ts`, `errors.ts`, `api/messages.ts`, `api/ws.ts`, `bot/bot.ts`, `review/service.ts`, `review/variation.ts`, `session/service.ts`, `settings/service.ts`, `install/installer.ts`, `install/download.ts`, `install/unzip.ts`, `config.ts` (two parse messages → English), `scripts/setup/setup.ts` (prints `localize('ru', warning)`)
- Modify (desktop): `packages/desktop/src/update-controller.ts`
- Create (web): `packages/web/src/error-text.ts`, `packages/web/src/error-text.test.ts`
- Modify (web): every consumer the typecheck reports — known: `App.tsx`, `components/ErrorBanner.tsx`, `screens/EngineScreen.tsx`, `screens/InstallScreen.tsx`, `screens/SettingsScreen.tsx`, `update-banner.ts`, `components/AppUpdateBanner.tsx`
- Modify: the six dictionaries
- Test: the server tests listed in Step 6, `packages/desktop/src/update-controller.test.ts`, `packages/web/src/update-banner.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2 (`TextError`, `textOf`).
- Produces: `HealthResponse.reason: LocalizedText | null`; `ServerMessage` error `{ type: 'error'; code: ErrorCode; text: LocalizedText }`; `InstallFile.label: LocalizedText`; `InstallStatus.error/note: LocalizedText | null`; `SettingsView.versionWarning: LocalizedText | null`; `SettingsResponse` `{ ok: false; reason: LocalizedText }`; `AppUpdateState` `{ status: 'error'; text: LocalizedText }`; `SessionError(text: LocalizedText, code)`, `EngineError(text: LocalizedText, code)` (both `extends TextError`); `missingFiles(config): LocalizedText | null`; `KataGoEngine.failure: LocalizedText | null`; `versionWarning(lock, running): LocalizedText | null`; web: errors on screen are `LocalizedText | string` until Task 6.

- [ ] **Step 1: Add the keys**

`ru.ts` (exact texts; `{params}` as named):
```ts
'error.message.bad': 'Некорректное сообщение',
'error.settings.invalid': 'Некорректные настройки тренировки',
'error.traps.unavailable': 'Ловушки недоступны: нет базы ловушек',
'error.starts.unavailable': 'Стартовые позиции недоступны: нет базы',
'error.starts.notOnList': 'Такой позиции нет в списке',
'error.turn.notFound': 'Нет такого хода',
'error.move.outsideZone': 'Ходить можно только в зоне угла',
'error.move.illegal': 'Недопустимый ход',
'error.move.notYourTurn': 'Сейчас ход бота',
'error.session.notFound': 'Тренировка не найдена',
'error.session.finished': 'Тренировка уже закончена',
'error.variation.reviewOnly': 'Варианты доступны только в разборе',
'error.variation.illegal': 'Недопустимый ход в варианте',
'error.engine.notReady': 'KataGo не готов: {reason}',
'error.engine.noHumanPolicy': 'KataGo не вернул humanPolicy: human-сеть не загружена',
'error.engine.stopped': 'KataGo остановлен',
'error.engine.restarted': 'KataGo перезапущен',
'error.engine.timeout': 'KataGo не ответил за {seconds} с',
'error.engine.crashed': { one: 'KataGo аварийно завершился {count} раз подряд ({detail})', few: 'KataGo аварийно завершился {count} раза подряд ({detail})', many: 'KataGo аварийно завершился {count} раз подряд ({detail})', other: 'KataGo аварийно завершился {count} раза подряд ({detail})' },
'health.starting': 'KataGo запускается…',
'health.restarting': 'KataGo перезапускается…',
'health.missing.katago': 'KataGo не найден: {path}',
'health.missing.analysisConfig': 'Нет конфига анализа KataGo: {path}',
'health.missing.mainModel': 'Нет основной сети KataGo: {path}',
'health.missing.humanModel': 'Нет human-сети KataGo: {path}',
'health.versionTooOld': 'Версия KataGo {version} старше {min}',
'health.noHumanNet': 'KataGo запущен без human-сети (нет humanPolicy в ответе)',
'settings.error.paths': 'Укажите все пути',
'settings.error.visits': 'Число визитов должно быть целым от 1 до {max}',
'settings.error.notStarted': 'KataGo не запустился',
'settings.error.saveFailed': 'Не удалось сохранить настройки: {detail}',
'settings.versionWarning': 'Запущена KataGo {running}, а проверена {locked}. Работать будет, но эта версия не проверялась.',
'install.file.cpu': 'KataGo для процессора',
'install.file.gpu': 'KataGo для видеокарты (OpenCL)',
'install.file.mainNet': 'Основная сеть',
'install.file.humanNet': 'Human-сеть',
'install.error.noBuild': 'Для этой системы ({platform}) нет готовых сборок KataGo',
'install.error.notStarted': 'KataGo не запустился: {detail}',
'install.error.noSuitableBuild': 'нет подходящей сборки',
'install.error.versionTooOld': 'нужна KataGo {min} или новее, а запущена {version}',
'install.error.serverStopped': 'Сервер остановлен',
'install.error.offline': 'Нет подключения к интернету или сервер недоступен',
'install.error.aborted': 'Загрузка {url} остановлена',
'install.error.stalled': 'Не удалось скачать {url}: загрузка зависла, нет данных {seconds} с',
'install.error.download': 'Не удалось скачать {url}: {detail}',
'install.error.sha': '{name}: SHA-256 {actual} не совпадает с katago.lock.json ({expected})',
'install.error.noExecutable': 'В архиве нет исполняемого файла KataGo: {name}',
'install.error.symlink': 'в архиве есть символическая ссылка {name}',
'install.error.unzip': 'Не удалось распаковать {name}: {detail}',
'install.note.cpuFallback': 'Используется процессор: видеокарта не запустилась.',
'update.error.check': 'Не удалось проверить обновления: {detail}',
'update.error.download': 'Не удалось скачать обновление: {detail}',
'update.error.install': 'Не удалось установить обновление: {detail}',
```
The checksum error of `download.ts:87` (`… Удалите его и запустите setup снова.`) is thrown only with `replaceMismatched: false`, which only `npm run setup` uses: it stays a plain Russian `Error` (developer tools are out of scope). Then add all keys to the other five dictionaries (translation rules; `{count}` in `error.engine.crashed` needs the plural forms of each language — en `one`/`other`, ja/zh/ko `other` only).

- [ ] **Step 2: Change the shared types** — as in Interfaces above. `protocol.ts`:
```ts
  | { type: 'error'; code: ErrorCode; text: LocalizedText }
```

- [ ] **Step 3: Server errors carry keys**

`session/session.ts`:
```ts
export class SessionError extends TextError {
  constructor(
    text: LocalizedText,
    readonly code: SessionErrorCode,
  ) {
    super(text)
    this.name = 'SessionError'
  }
}
```
`engine/engine.ts` — `EngineError` the same with `EngineErrorCode`. Then every `new SessionError('…', code)` / `new EngineError('…', code)` becomes `new SessionError({ key: '…' }, code)` with the key from Step 1, e.g.:
```ts
if (startId === undefined || !named) throw new SessionError({ key: 'error.starts.notOnList' }, 'bad_request')
throw new EngineError({ key: 'error.engine.notReady', params: { reason: h.reason ?? { key: 'health.starting' } } }, 'engine_failed')
```
`engine/engine.ts`: `failedReason: LocalizedText | null`; crash: `{ key: 'error.engine.crashed', params: { count: this.crashes, detail: why } }`; timeout: `const err: LocalizedText = { key: 'error.engine.timeout', params: { seconds: Math.round(limit / 1000) } }` and the log line `this.log(`${localize('en', err)}; the process will be restarted`)`.
`engine/health.ts`: `missingFiles` returns `{ key: 'health.missing.katago', params: { path: file } }` etc.; `checkEngine` reasons use the keys; its `catch` returns `{ state: 'failed', reason: textOf(err) }`; `HealthMonitor` starting/restarting use `health.starting` / `health.restarting`.
`engine/lock.ts`: `versionWarning` returns `{ key: 'settings.versionWarning', params: { running, locked: lock.katago.version } }` or null.
`errors.ts`:
```ts
export function toErrorMessage(err: unknown): Extract<ServerMessage, { type: 'error' }> {
  if (err instanceof IllegalMoveError) return { type: 'error', code: 'illegal_move', text: { key: 'error.move.illegal' } }
  if (err instanceof SessionError) return { type: 'error', code: err.code, text: err.text }
  if (err instanceof EngineError) return { type: 'error', code: 'engine_error', text: err.text }
  return { type: 'error', code: 'internal_error', text: textOf(err) }
}
```
`settings/service.ts`: the four reasons become `LocalizedText` (`settings.error.*`, `failure = health.reason ?? { key: 'settings.error.notStarted' }`, `{ key: 'settings.error.saveFailed', params: { detail: e instanceof Error ? e.message : String(e) } }`, visits max `100000`).
`install/installer.ts`: labels `{ key: 'install.file.cpu' }`…; `this.error = textOf(err)`; `note = { key: 'install.note.cpuFallback' }`; the thrown errors become `TextError` with their keys; `errors` collects `LocalizedText` and `install.error.notStarted` gets `detail: errors[0] ?? { key: 'install.error.noSuitableBuild' }`.
`install/download.ts`: `OFFLINE_MESSAGE` becomes `OFFLINE: LocalizedText = { key: 'install.error.offline' }`; all thrown errors become `TextError`; the check `cause.message.startsWith('Не удалось скачать')` becomes `cause instanceof TextError && cause.text.key === 'install.error.download'`; the HTTP case is `{ key: 'install.error.download', params: { url, detail: `HTTP ${res.status}` } }`. Log lines keep their text (logs are out of scope).
`install/unzip.ts`: both errors become `TextError` (`install.error.symlink`, `install.error.unzip` with `{ cause: err }`).
`config.ts:107,109`: English text (`expected a JSON object`, `invalid JSON`) — they reach only the startup error box as a detail.
`scripts/setup/setup.ts`: `if (warning) console.log(`\nВнимание: ${localize('ru', warning)}`)`.

`packages/desktop/src/update-controller.ts`:
```ts
const FAILED: Record<Phase, MessageKey> = { check: 'update.error.check', download: 'update.error.download', install: 'update.error.install' }
```
and where it sets an error: `this.state = { status: 'error', text: { key: FAILED[phase], params: { detail: shortMessage(err) } } }`.

- [ ] **Step 4: Web renders the keys** — run `npm run typecheck`; every error in `packages/web` is a place that showed one of these strings. Render with `useT()` / `localize(language, …)`:
```tsx
const { t, language } = useI18n()
// before: <p class="reason">{health.reason}</p>
<p class="reason">{health.reason && localize(language, health.reason)}</p>
```
`App.tsx` keeps errors as `LocalizedText | string` (the WebSocket error is `msg.text`, fetch errors stay `e.message` until Task 6): `const [error, setError] = useState<LocalizedText | string | null>(null)`. The banner text comes from a pure helper, so that a shown error follows a later language switch (spec 5) and this is tested without a DOM:

`packages/web/src/error-text.ts`:
```ts
import { localize, type Language, type LocalizedText } from '@joseki-dojo/shared'

/** Spec (languages) 5: an error on screen is kept as a key and translated on every render, so a language switch retranslates it. */
export const errorText = (error: LocalizedText | string, lang: Language): string => (typeof error === 'string' ? error : localize(lang, error))
```
`packages/web/src/error-text.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { errorText } from './error-text'

describe('errorText', () => {
  it('shows the same server error in the current language', () => {
    const error = { key: 'error.starts.notOnList' } as const
    expect(errorText(error, 'ru')).toBe('Такой позиции нет в списке')
    expect(errorText(error, 'en')).not.toBe(errorText(error, 'ru'))
    expect(errorText('plain', 'ja')).toBe('plain')
  })
})
```
`ErrorBanner` renders `errorText(error, language)` with `language` from `useI18n()`. `update-banner.ts` returns `text: LocalizedText` for the error state (`{ text: state.text, … }`) and the banner renders it with `localize`.

- [ ] **Step 5: Server tests compare keys** — update every test that expected Russian server text. Pattern:
```ts
// before
await expect(run()).rejects.toThrow('Такой позиции нет в списке')
// after
await expect(run()).rejects.toMatchObject({ text: { key: 'error.starts.notOnList' } })
// health
expect(h).toEqual({ state: 'failed', reason: { key: 'health.missing.katago', params: { path: file } } })
// a WebSocket error
expect(msg).toEqual({ type: 'error', code: 'bad_request', text: { key: 'error.message.bad' } })
```
Files with such expectations: `starts/book.test.ts` (only those for thrown errors; log lines stay), `install/installer.test.ts`, `engine/engine.test.ts`, `start.test.ts`, `session/starts.test.ts`, `install/download.test.ts`, `review/variation.test.ts`, `settings/service.test.ts`, `engine/health.test.ts`, `install/unzip.test.ts`, `session/traps.test.ts`, `errors.test.ts`, `session/service.test.ts`, `engine/lock.test.ts`, `api/api.test.ts`, `desktop/src/update-controller.test.ts`, `web/src/update-banner.test.ts`.

Add one test to `errors.test.ts`:
```ts
it('sends a foreign error as error.internal with its text as detail', () => {
  expect(toErrorMessage(new Error('ECONNRESET'))).toEqual({ type: 'error', code: 'internal_error', text: { key: 'error.internal', params: { detail: 'ECONNRESET' } } })
})
```

- [ ] **Step 6: Run everything**

Run: `npx vitest run && npm run typecheck`
Expected: PASS. Then: `grep -rn "[А-Яа-яЁё]" packages/server/src --include=*.ts | grep -v test | grep -v "log(" ` — only log lines, base read errors (`jdb/`, `starts/book.ts` skip reasons, `traps/book.ts`) and comments remain.

- [ ] **Step 7: Milestone 1 commit**

```bash
git add packages scripts
git commit -m "feat(i18n): dictionaries, the language setting and server messages as keys" -m "Typed dictionaries in packages/shared (ru is the model; the other five languages must have the same keys and parameters) with t() and plural forms from Intl.PluralRules. ui.language in the config and PUT /api/ui; the installer's language is applied only to an empty setting. The server sends every player-facing message as a key with parameters, and the web renders it in the current language." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Web strings — app shell, start screen and tree

**Files:**
- Modify: `packages/web/src/App.tsx`, `components/AppHeader.tsx`, `screens/StartScreen.tsx`, `components/StartTree.tsx`, `components/CornerBoard.tsx`, `session-title.ts`, `start-tree.ts`, `components/ErrorBanner.tsx`, the six dictionaries
- Test: `session-title.test.ts`, `start-tree.test.ts`

**Interfaces:**
- Consumes: Task 2 (`useT`, `useI18n`), Task 1 (`Translate`, `translator`).
- Produces: `sessionTitle(settings, t: Translate, name?: string | null)`, `reviewTitle(settings, t: Translate, name?: string | null)`, `reviewLabels(mode, t: Translate)` (the optional `name` is filled by Task 8 with the translated position name); `buildStartTree(list, branches, groups, rootName: string)`; `nodeTitle(n)` unchanged.

- [ ] **Step 1: Convert the modules that build strings to take `t`**

Pure modules get a `t: Translate` parameter; tests call them with `translator('ru')` so their Russian expectations stay valid. Example (`session-title.ts`):
```ts
export function reviewLabels(mode: Mode, t: Translate): ReviewLabels {
  return mode === 'list' ? { next: t('review.replayPosition'), back: t('review.toPositions') } : { next: t('review.next'), back: t('review.toTrainings') }
}
```
and in the test: `const t = translator('ru')` … `expect(reviewLabels('list', t)).toEqual({ next: 'Играть позицию заново', back: 'К выбору позиции' })`. `start-tree.ts` takes the root caption as a parameter (`buildStartTree(list, branches, groups, t('tree.root'))`).

- [ ] **Step 2: Convert the components**

```tsx
// before
<nav class="segmented" aria-label="Разделы">
// after
const t = useT()
<nav class="segmented" aria-label={t('header.sections')}>
```
Plurals: `Позиций внутри: {count}` becomes a plural key: `'tree.positionsInside': { one: 'Позиций внутри: {count}', few: …, many: …, other: … }` — in Russian the label form does not change with the number, so all four forms are the same text; other languages may differ. Strings assembled from pieces become one key with params: `` `Ходов на доске: ${n}` `` → `t('tree.movesOnBoard', { count: n })`.

- [ ] **Step 3: Translate** — add every new key to the five other dictionaries (translation rules).

- [ ] **Step 4: Check** — `npx vitest run && npm run typecheck`, then:
```bash
grep -n "[А-Яа-яЁё]" packages/web/src/App.tsx packages/web/src/components/AppHeader.tsx packages/web/src/screens/StartScreen.tsx packages/web/src/components/StartTree.tsx packages/web/src/components/CornerBoard.tsx packages/web/src/session-title.ts packages/web/src/start-tree.ts packages/web/src/components/ErrorBanner.tsx | grep -v "^\S*:[0-9]*:\s*\(//\|\*\)"
```
Expected: no output (comments may keep Russian UI quotes such as «Из списка»).

---

## Task 5: Web strings — game, review and variations

**Files:**
- Modify: `screens/GameScreen.tsx`, `screens/ReviewScreen.tsx`, `components/CandidateList.tsx`, `components/LossBar.tsx`, `components/VariationBar.tsx`, `review-summary.ts`, `format.ts`, `variation.ts` (if it holds text), the six dictionaries
- Test: `format.test.ts`, `review-summary.test.ts`, `variation.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2.
- Produces: `formatPoints(n: number, lang: Language): string`, `formatCount(n: number, lang: Language): string`, `moveLabel(v, t)`, `rankLabel(rank, t)`, `colorLabel(c, t)`; `CATEGORY_LABEL`, `CORNER_LABEL`, `ACTOR_LABEL` become key maps (`Record<Category, MessageKey>` …) rendered with `t`; `summaryTiles(s, t, lang)`.

- [ ] **Step 1: Number formatting follows the language**

`format.ts`:
```ts
/** One decimal, in the reader's language («5,1» / "5.1"); a value that rounds to zero prints without a sign. */
export const formatPoints = (n: number, lang: Language): string => {
  const text = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)
  const zero = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(0)
  return text.replace(/^[-−]/, '') === zero ? zero : text
}

/** Visit counts with grouped thousands («1 200» / "1,200"). */
export const formatCount = (n: number, lang: Language): string => new Intl.NumberFormat(lang).format(Math.round(n))

export const rankLabel = (rank: string, t: Translate): string =>
  rank.endsWith('k') ? t('rank.kyu', { n: Number(rank.slice(0, -1)) }) : t('rank.dan', { n: Number(rank.slice(0, -1)) })
```
Dictionary: ru `'rank.kyu': '{n} кю'`, `'rank.dan': '{n} дан'`; en `'{n} kyu'` / `'{n} dan'`; zh-Hans `'{n}级'` / `'{n}段'`; zh-Hant `'{n}級'` / `'{n}段'`; ko `'{n}급'` / `'{n}단'`; ja `'{n}級'` / `'{n}段'` — and 1 dan in Japanese is 初段: make `rank.dan` a plural-free special case: add `'rank.dan1'` (ru `1 дан`, en `1 dan`, zh `1段`, ko `1단`, ja `初段`) and use it for `1d`. Tests in `format.test.ts`:
```ts
expect([formatPoints(5.06, 'ru'), formatPoints(5.06, 'en'), formatPoints(-0.04, 'ru')]).toEqual(['5,1', '5.1', '0,0'])
expect(['7k', '1d', '3d'].map((r) => rankLabel(r, translator('ja')))).toEqual(['7級', '初段', '3段'])
```

- [ ] **Step 2: Convert the components and modules** — same patterns as Task 4 Step 1–2. `review-summary.ts`: a number of points is always `common.pointsValue` (Task 1) with the number formatted by `formatPoints` in `value` and **no `count`**: points are shown with one decimal, and CLDR picks the plural form of a visible decimal as `other` («0,0 очка», «5,0 очка», "1.0 points"), which is what `t` uses without `count`. Passing the raw number would print «0,0 очков» and «1,0 очко».
```ts
const points = (x: number): string => t('common.pointsValue', { value: formatPoints(x, lang) })
// «на 5,1 очка»
s: mistakes ? t('review.summary.botLoss', { points: points(s.botMistakeLoss) }) : t('review.summary.noBotMistakes')
```
with ru `'review.summary.botLoss': 'на {points}'`. The tile under «Вы потеряли» shows the number in `v` and the unit in `s`: there `s: t('review.summary.pointsUnit')`, a plain string (ru `очка`, en `points`, ja/zh `目`, ko `집`), for the same reason.

- [ ] **Step 3: Translate, then check** — as in Task 4, with the files of this task in the grep.

---

## Task 6: Web strings — settings, install, engine, update bar and API errors

**Files:**
- Modify: `screens/SettingsScreen.tsx`, `screens/InstallScreen.tsx`, `screens/EngineScreen.tsx`, `install-format.ts`, `update-banner.ts`, `components/AppUpdateBanner.tsx`, `theme.ts`, `api.ts`, `App.tsx` (error state type), `components/ErrorBanner.tsx`, the six dictionaries
- Test: `install-format.test.ts`, `update-banner.test.ts`, `theme.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `INSTALL_STEP_TEXT: Record<InstallStep, MessageKey | null>`; `fileProgressText(f, t, lang)`; `downloadSizeText(linux, t)`; `updateBannerView(state): { text: LocalizedText; … }`; `api.ts` throws `ApiError extends Error { text: LocalizedText }`; App error state `LocalizedText | null`.

- [ ] **Step 1: API errors carry keys**

`api.ts`:
```ts
/** A failed request, shown in the reader's language. */
export class ApiError extends Error {
  constructor(readonly text: LocalizedText) {
    super(text.key)
  }
}
const failed = (key: MessageKey, res: Response): ApiError => new ApiError({ key, params: { status: res.status } })
// e.g.
if (!res.ok) throw failed('error.api.review', res)
```
ru: `'error.api.review': 'Не удалось загрузить разбор: HTTP {status}'`, `'error.api.ui': 'Не удалось загрузить оформление: HTTP {status}'`, `'error.api.saveUi': 'Не удалось сохранить оформление: HTTP {status}'`, `'error.api.starts': 'Не удалось узнать базу стартовых позиций: HTTP {status}'`, `'error.api.traps': 'Не удалось узнать базу ловушек: HTTP {status}'`, `'error.api.settings': 'Не удалось загрузить настройки: HTTP {status}'`, `'error.api.saveSettings': 'Не удалось сохранить настройки: HTTP {status}'`, `'error.api.install': 'Не удалось запустить установку: HTTP {status}'`. `{status}` is a number: render it without grouping — pass `String(res.status)`.

App: `const [error, setError] = useState<LocalizedText | null>(null)`; a caught error becomes `e instanceof ApiError ? e.text : { key: 'error.internal', params: { detail: e.message } }`.

- [ ] **Step 2: Convert the screens and modules** — patterns of Task 4. The theme options become keys (`settings.theme.system` …).

- [ ] **Step 3: Translate, then check** — as in Task 4, plus a whole-package check:
```bash
grep -rn "[А-Яа-яЁё]" packages/web/src --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -v "^\S*:[0-9]*:\s*\(//\|\*\|/\*\)"
```
Expected: no output.

---

## Task 7: Choosing the language — settings, globe menu, first start screen

**Files:**
- Create: `packages/web/src/components/LanguageMenu.tsx`, `packages/web/src/screens/LanguageScreen.tsx`, `e2e/languages.spec.ts`
- Modify: `screens/SettingsScreen.tsx`, `components/AppHeader.tsx`, `App.tsx`, `styles/*.css` (menu, fonts by `:lang()`), `packages/web/index.html` (`lang="en"`), `e2e/config.e2e.json` and `e2e/repick-server.ts` (`"ui": { "language": "ru" }`), `e2e/install.spec.ts` (picks Русский first), the six dictionaries
- Test: `packages/web/src/language-gate.test.ts`, `e2e/languages.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`useI18n`, `chosen`), Task 1 (`LANGUAGES`, `LANGUAGE_NAMES`).
- Produces: `<LanguageMenu />` (globe button + popup), `<LanguageScreen onChoose={(lang) => …} />`, `needsLanguageScreen(chosen: boolean | null): boolean`.

- [ ] **Step 1: The gate rule, test first**

`packages/web/src/language-gate.ts`:
```ts
/** Spec (languages) 8.2: the language screen goes first while the settings have no language (null: not known yet — wait). */
export const needsLanguageScreen = (chosen: boolean | null): boolean => chosen === false
```
Test: `expect([needsLanguageScreen(false), needsLanguageScreen(true), needsLanguageScreen(null)]).toEqual([true, false, false])`.

- [ ] **Step 2: First start screen**

`packages/web/src/screens/LanguageScreen.tsx`:
```tsx
import { LANGUAGE_NAMES, LANGUAGES, type Language } from '@joseki-dojo/shared'
import { useI18n } from '../i18n'

/** Spec (languages) 8.2: six buttons, each in its own language; English is highlighted and the hint is English. */
export function LanguageScreen() {
  const { setLanguage } = useI18n()
  return (
    <main>
      <div class="page language-screen">
        <div class="page-head">
          <h1>Choose your language</h1>
          <p>You can change it later in Settings or with the globe in the header.</p>
        </div>
        <div class="language-choices">
          {LANGUAGES.map((lang: Language) => (
            <button key={lang} lang={lang} class={lang === 'en' ? 'primary lg' : 'lg'} onClick={() => setLanguage(lang)}>
              {LANGUAGE_NAMES[lang]}
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
```
`App.tsx`: before the install and engine screens: `if (needsLanguageScreen(languageChosen)) { crumb = undefined; screen = <LanguageScreen /> }`.

- [ ] **Step 3: Globe menu in the header**

`packages/web/src/components/LanguageMenu.tsx`:
```tsx
import { Check, Globe } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { LANGUAGE_NAMES, LANGUAGES } from '@joseki-dojo/shared'
import { useI18n } from '../i18n'

/** Spec (languages) 5: a globe button that opens the list of languages; the current one is checked. */
export function LanguageMenu() {
  const { language, setLanguage, t } = useI18n()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    items.current[LANGUAGES.indexOf(language)]?.focus()
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open, language])

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const at = items.current.findIndex((b) => b === document.activeElement)
    const next = (at + (e.key === 'ArrowDown' ? 1 : LANGUAGES.length - 1)) % LANGUAGES.length
    items.current[next]?.focus()
  }

  return (
    <div class="language-menu" ref={box} onKeyDown={onKey}>
      <button class="icon" aria-label={t('language.label')} aria-haspopup="menu" aria-expanded={open} title={t('language.label')} onClick={() => setOpen(!open)}>
        <Globe aria-hidden="true" />
      </button>
      {open && (
        <div class="language-popup" role="menu">
          {LANGUAGES.map((lang, i) => (
            <button
              key={lang}
              ref={(el) => (items.current[i] = el)}
              role="menuitemradio"
              aria-checked={lang === language}
              lang={lang}
              onClick={() => {
                setLanguage(lang)
                setOpen(false)
              }}
            >
              <Check aria-hidden="true" class={lang === language ? '' : 'invisible'} />
              {LANGUAGE_NAMES[lang]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```
`AppHeader.tsx`: `<div class="header-end">{nav && <nav …/>}<LanguageMenu /></div>` — the globe shows on every screen, also during a game.

ru `'language.label': 'Язык'` (en `Language`, zh-Hans `语言`, zh-Hant `語言`, ko `언어`, ja `言語`).

CSS (in the styles file that holds `.app-header`):
```css
.header-end { display: flex; align-items: center; gap: 8px; }
.language-menu { position: relative; }
.language-popup { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; display: grid; min-width: 160px; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); box-shadow: 0 8px 24px rgb(0 0 0 / 0.12); }
.language-popup button { display: flex; align-items: center; gap: 8px; justify-content: flex-start; padding: 6px 10px; border: 0; background: none; text-align: left; }
.language-popup button:hover, .language-popup button:focus-visible { background: var(--surface); }
.language-popup .invisible { visibility: hidden; }
.language-screen .language-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
/* Spec (languages) 5: the characters in the shapes of each language. */
:lang(zh-Hans) { font-family: 'Inter Variable', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif; }
:lang(zh-Hant) { font-family: 'Inter Variable', 'Microsoft JhengHei', 'PingFang TC', 'Noto Sans CJK TC', sans-serif; }
:lang(ja) { font-family: 'Inter Variable', 'Yu Gothic UI', 'Hiragino Sans', 'Noto Sans CJK JP', sans-serif; }
:lang(ko) { font-family: 'Inter Variable', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', sans-serif; }
```
(Use the font family name the existing CSS uses for Inter.)

- [ ] **Step 4: Settings section «Язык»** — in `SettingsScreen.tsx`, after the theme section, a radio group of the six names (each with `lang` attribute), checked by `language`, calling `setLanguage`. Header `t('settings.language.title')` (ru «Язык»).

- [ ] **Step 5: e2e**

`e2e/config.e2e.json` and the config written in `e2e/repick-server.ts` get `"ui": { "language": "ru" }`, so the existing Russian assertions stay. `e2e/install-server.ts` starts with a fresh config: in `e2e/install.spec.ts`, before the first install step, add:
```ts
await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()
await page.getByRole('button', { name: 'Русский' }).click()
```
`e2e/languages.spec.ts` (runs against the 5180 server; restores Russian at the end so the other specs keep their language):
```ts
import { expect, test } from '@playwright/test'

test.afterEach(async ({ request }) => {
  await request.put('/api/ui', { data: { language: 'ru' } })
})

test('the globe switches the language at once, and it survives a reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await page.getByRole('button', { name: 'Язык' }).click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'New training' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'New training' })).toBeVisible()
})

test('settings switch the language too', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.getByRole('radio', { name: '日本語' }).check()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
})
```
(Use the actual English heading text you gave `start.title` in Task 4.)

- [ ] **Step 6: Run** — `npx vitest run && npm run typecheck`; `npm run e2e` if Playwright browsers are installed (otherwise CI).

- [ ] **Step 7: Milestone 2 commit**

```bash
git add packages e2e
git commit -m "feat(i18n): the interface in six languages, the globe menu and the first start screen" -m "Every web string comes from the dictionaries; numbers, points and ranks follow the language. The language switches at once from the settings or the globe menu in the header, survives a reload, and a config without a language opens a choice of six languages first. <html lang> and per-language fonts give the Chinese, Japanese and Korean characters their shapes." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Start position names in six languages and the Russian renames

**Files:**
- Create: `packages/server/bases/starts-i18n.json`, `packages/server/src/starts/names.ts`, `packages/server/src/starts/names.test.ts`, `packages/server/src/starts/shipped-names.test.ts`
- Modify: `packages/server/bases/starts-list.json` (spec 7.1), `packages/shared/src/types.ts` (`StartListEntry`, `StartBranch`), `packages/server/src/starts/book.ts`, `packages/server/src/start.ts` (load the file), `packages/server/src/main.ts` + `packages/desktop/src/main.ts` + `packages/desktop/electron-builder.config.cjs` (path; the `bases` folder is already shipped), `packages/server/src/session/service.ts` (`StartRef.name` stays Russian), `packages/web/src/start-tree.ts`, `components/StartTree.tsx`, `screens/StartScreen.tsx`, `session-title.ts`, `App.tsx`, `e2e/make-starts.ts`
- Test: `starts/book.test.ts`, `start-tree.test.ts`, `session-title.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4.
- Produces: `type LocalizedName = Record<Language, string>` in `packages/shared/src/types.ts`; `StartListEntry.name: LocalizedName`, `StartListEntry.short: LocalizedName`, `StartBranch.name: LocalizedName`; `loadNames(json: string, log): StartNames` and `nameFor(names, moves: string, russian: { name: string; short?: string }): { name: LocalizedName; short?: LocalizedName }` in `starts/names.ts`; `StartBook.withList(json, log, names?: StartNames)`; `ServerOptions.startsNamesFile?: string | null`; web `StartTreeNode.name/short` stay strings, built for the current language: `buildStartTree(list, branches, groups, rootName, lang)`.

- [ ] **Step 1: Russian renames (spec 7.1)** — edit `packages/server/bases/starts-list.json` exactly as the table of spec 7.1 says (`name` and `short`; branches `name`). Keep moves, order and `rare`. Check: `node -e "const l=require('./packages/server/bases/starts-list.json');console.log(l.positions.length,l.branches.length)"` prints `88 17`, and the server test that loads the shipped list still finds no skipped entry.

- [ ] **Step 2: The names file format, test first**

`packages/server/src/starts/names.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { loadNames, nameFor } from './names'

const json = JSON.stringify({ 'Q16 O17 R14': { en: { name: 'Small approach — knight answer', short: 'Knight answer' } } })

describe('start names', () => {
  it('gives every language, falling back to English, then Russian, and logs what is missing', () => {
    const lines: string[] = []
    const log = (l: string): void => void lines.push(l)
    const names = loadNames(json, log)
    const n = nameFor(names, 'Q16 O17 R14', { name: 'Малое приближение — ответ кэймой', short: 'Ответ кэймой' }, log)
    expect(n.name).toMatchObject({ ru: 'Малое приближение — ответ кэймой', en: 'Small approach — knight answer', ja: 'Small approach — knight answer' })
    expect(n.short?.ko).toBe('Knight answer')
    expect(nameFor(names, 'Q17 R15', { name: 'Тест' }, log).name.en).toBe('Тест')
    expect(lines.filter((l) => l.includes('Q16 O17 R14'))).toHaveLength(1)
  })

  it('takes a broken file as no translations', () => {
    expect(loadNames('not json', () => {})).toEqual({})
  })
})
```
`packages/server/src/starts/shipped-names.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const list = JSON.parse(readFileSync('packages/server/bases/starts-list.json', 'utf8')) as { positions: { moves: string }[]; branches: { moves: string }[] }
const names = JSON.parse(readFileSync('packages/server/bases/starts-i18n.json', 'utf8')) as Record<string, Record<string, { name?: string; short?: string }>>
const LANGS = ['en', 'zh-Hans', 'zh-Hant', 'ko', 'ja']

describe('starts-i18n.json', () => {
  it('names every position and branch of the shipped list in five languages', () => {
    for (const p of list.positions) for (const l of LANGS) expect(names[p.moves]?.[l], `${p.moves} ${l}`).toMatchObject({ name: expect.any(String), short: expect.any(String) })
    for (const b of list.branches) for (const l of LANGS) expect(names[b.moves]?.[l]?.name, `${b.moves} ${l}`).toEqual(expect.any(String))
  })

  it('has nothing that is not on the list', () => {
    const known = new Set([...list.positions, ...list.branches].map((e) => e.moves))
    expect(Object.keys(names).filter((k) => !known.has(k))).toEqual([])
  })
})
```

- [ ] **Step 3: Write `names.ts`**
```ts
import { LANGUAGES, type Language, type LocalizedName } from '@joseki-dojo/shared'

type Entry = Partial<Record<Language, { name?: string; short?: string }>>
export type StartNames = Record<string, Entry>

/** Spec (languages) 7: starts-i18n.json, keyed by the moves of a position or a branch; a broken file is no translations. */
export function loadNames(json: string, log: (line: string) => void): StartNames {
  try {
    const raw = JSON.parse(json) as unknown
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as StartNames
  } catch {
    // reported below
  }
  log('Переводы названий стартовых позиций недоступны: файл повреждён')
  return {}
}

/** The name of `moves` in every language: the translation, else English, else the Russian of the list. */
export function nameFor(names: StartNames, moves: string, russian: { name: string; short?: string }, log: (line: string) => void = () => {}): { name: LocalizedName; short?: LocalizedName } {
  const entry = names[moves] ?? {}
  const pick = (field: 'name' | 'short', ru: string): LocalizedName =>
    Object.fromEntries(LANGUAGES.map((l) => [l, l === 'ru' ? ru : (entry[l]?.[field] ?? entry.en?.[field] ?? ru)])) as LocalizedName
  const missing = LANGUAGES.filter((l) => l !== 'ru' && !entry[l]?.name)
  // Without the file at all, loadNames has already said so once: no line per entry.
  if (missing.length > 0 && Object.keys(names).length > 0) log(`Нет перевода названия ${moves}: ${missing.join(', ')}`)
  return { name: pick('name', russian.name), ...(russian.short !== undefined ? { short: pick('short', russian.short) } : {}) }
}
```
`withList` passes its own `log` to `nameFor`.

- [ ] **Step 4: Wire it** — `StartBook.withList(json, log, names = {})` builds `StartListEntry { name: nameFor(…).name, short: (nameFor(…).short ?? name) }` and branches `name: nameFor(names, moves, { name }).name`; `listStart` returns `{ name: entry.name.ru, group }` (the session keeps Russian as before); `start.ts` reads `startsNamesFile` (default: next to `startsListFile`, `starts-i18n.json`) with a log line when missing; `main.ts` gets `JOSEKI_STARTS_NAMES`; desktop passes `join(…, 'bases', 'starts-i18n.json')`. Existing tests that compare `list()` / `branches()` get `name: expect.objectContaining({ ru: '…' })`.

- [ ] **Step 5: The web shows the current language** — `buildStartTree(list, branches, groups, rootName, lang)` takes `e.name[lang]`, `e.short[lang]`, `b.name[lang]`; `App.tsx` passes `language`; crumbs: `sessionTitle` / `reviewTitle` get the name of `settings.start.id` from the tree when the position is still listed (`findById(startTree, id)?.name`), else the saved `StartRef.name`. Test in `session-title.test.ts`: a listed start in English shows the English name; an unlisted one shows the saved Russian name.

- [ ] **Step 6: Translate the 105 entries** — write `packages/server/bases/starts-i18n.json`: for each line of the glossary appendix, `{ "<moves>": { "en": { "name", "short" }, "zh-Hans": …, "zh-Hant": …, "ko": …, "ja": … } }` (branches only `name`). Rules:
  - Build each name from the glossary terms of the actual move (glossary sections 1–3), not from the Russian words; the two-space approach is high in 4-4/3-4 and low in 3-3 (glossary 2a).
  - Same structure as Russian: `<approach or branch> — <answer>`; the short caption is the answer part.
  - Named joseki use the established names (glossary 3): avalanche ナダレ / 雪崩 / 눈사태, taisha 大斜 / 대사, magic sword 村正の妖刀 / 妖刀 / 요도, flying knife 飛刀 / 飞刀 (ja and ko proposals as marked).
  - Keep `JSON.stringify(…, null, 2)` formatting so diffs stay readable.
  Then `e2e/make-starts.ts` writes a matching `e2e/starts-i18n.test.json` for its two positions (and `playwright.config.ts` passes `JOSEKI_STARTS_NAMES`).

- [ ] **Step 7: Run** — `npx vitest run && npm run typecheck`.

- [ ] **Step 8: Milestone 3 commit**

```bash
git add packages e2e playwright.config.ts
git commit -m "feat(starts): position names in six languages and corrected Russian names" -m "starts-i18n.json names the 88 positions and 17 branches of «Из списка» in English, Chinese (Simplified and Traditional), Korean and Japanese, keyed by moves; GET /api/starts serves every language and the tree and the crumbs follow the current one. A missing translation falls back to English, then Russian. Russian names that misnamed their move are corrected (spec 7.1); chapters.mjs needs the same edits." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Installer language and the desktop app

**Files:**
- Create: `packages/desktop/build/installer.nsh`, `packages/desktop/src/installer-language.ts`, `packages/desktop/src/installer-language.test.ts`
- Modify: `packages/desktop/electron-builder.config.cjs`, `packages/desktop/src/main.ts`

**Interfaces:**
- Consumes: Task 1 (`languageFromWindowsId`, `isLanguage`, `t`, `DEFAULT_LANGUAGE`), Task 2 (`ServerOptions.initialLanguage`).
- Produces: `readInstallerLanguage(userData: string): Language | null`, `forgetInstallerLanguage(userData: string): void`, `configLanguage(configFile: string): Language`.

- [ ] **Step 1: Test first**

`packages/desktop/src/installer-language.test.ts`:
```ts
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configLanguage, forgetInstallerLanguage, readInstallerLanguage } from './installer-language'

const dir = (): string => mkdtempSync(join(tmpdir(), 'joseki-lang-'))

describe('installer language', () => {
  it('reads the LANGID the installer wrote, unknown as English', () => {
    const d = dir()
    expect(readInstallerLanguage(d)).toBeNull()
    writeFileSync(join(d, 'installer-language'), '1042\r\n')
    expect(readInstallerLanguage(d)).toBe('ko')
    writeFileSync(join(d, 'installer-language'), '9999')
    expect(readInstallerLanguage(d)).toBe('en')
    forgetInstallerLanguage(d)
    expect(existsSync(join(d, 'installer-language'))).toBe(false)
  })

  it('takes the error box language from the config, English otherwise', () => {
    const d = dir()
    expect(configLanguage(join(d, 'config.json'))).toBe('en')
    writeFileSync(join(d, 'config.json'), JSON.stringify({ ui: { language: 'ja' } }))
    expect(configLanguage(join(d, 'config.json'))).toBe('ja')
    writeFileSync(join(d, 'config.json'), '{ broken')
    expect(configLanguage(join(d, 'config.json'))).toBe('en')
  })
})
```

- [ ] **Step 2: Write `installer-language.ts`**
```ts
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_LANGUAGE, isLanguage, languageFromWindowsId, type Language } from '@joseki-dojo/shared'

const FILE = 'installer-language'

/** Spec (languages) 8.1: the LANGID the Windows installer wrote into the data folder, or null. */
export function readInstallerLanguage(userData: string): Language | null {
  try {
    const id = Number.parseInt(readFileSync(join(userData, FILE), 'utf8').trim(), 10)
    return Number.isNaN(id) ? DEFAULT_LANGUAGE : languageFromWindowsId(id)
  } catch {
    return null
  }
}

export function forgetInstallerLanguage(userData: string): void {
  rmSync(join(userData, FILE), { force: true })
}

/** The language of the startup error box: the saved one, English when the config is missing or broken. */
export function configLanguage(configFile: string): Language {
  try {
    const language = (JSON.parse(readFileSync(configFile, 'utf8')) as { ui?: { language?: unknown } }).ui?.language
    return isLanguage(language) ? language : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}
```

- [ ] **Step 3: `main.ts`** — `boot()`: `const installerLanguage = readInstallerLanguage(userData)`; pass `initialLanguage: installerLanguage ?? undefined` to `startServer`; after `server = await starting`: `if (installerLanguage) forgetInstallerLanguage(userData)`. `fatal()`:
```ts
  const lang = configLanguage(join(app.getPath('userData'), 'config.json'))
  dialog.showErrorBox(t(lang, 'app.startFailed'), err instanceof Error ? err.message : String(err))
```
ru `'app.startFailed': 'Joseki Dojo не запустился'` (en `Joseki Dojo could not start`, zh-Hans `Joseki Dojo 无法启动`, zh-Hant `Joseki Dojo 無法啟動`, ko `Joseki Dojo를 시작할 수 없습니다`, ja `Joseki Dojo を起動できませんでした`).

- [ ] **Step 4: The installer**

`packages/desktop/electron-builder.config.cjs` — `nsis`:
```js
    // Spec (languages) 8.1: a language choice before the one-click install; English is preselected (build/installer.nsh).
    installerLanguages: ['en_US', 'ru_RU', 'zh_CN', 'zh_TW', 'ko_KR', 'ja_JP'],
    displayLanguageSelector: true,
    include: 'build/installer.nsh',
```
`packages/desktop/build/installer.nsh`:
```nsis
; Spec (languages) 8.1. preInit runs right before the template's language dialog (MUI_LANGDLL_DISPLAY in installer.nsi).
!macro preInit
  ; English is preselected whatever the Windows language is.
  StrCpy $LANGUAGE 1033
!macroend

; The chosen language for the app's first start; a silent run (an update) writes nothing, so the player's language stays.
!macro customInstall
  ${IfNot} ${Silent}
    CreateDirectory "$APPDATA\${PRODUCT_NAME}"
    FileOpen $0 "$APPDATA\${PRODUCT_NAME}\installer-language" w
    FileWrite $0 "$LANGUAGE"
    FileClose $0
  ${EndIf}
!macroend
```
`$APPDATA\${PRODUCT_NAME}` is Electron's `userData` (`%APPDATA%\Joseki Dojo`); electron-builder defines `PRODUCT_NAME`.

**Silent updates must not show the dialog (spec 10).** In NSIS 3.04 and later the macro `MUI_LANGDLL_DISPLAY` keeps the dialog out of silent mode itself: under `!ifdef NSIS_CONFIG_SILENT_SUPPORT` it wraps the `LangDLL::LangDialog` call in `${Unless} ${Silent}` … `${EndUnless}` (older NSIS versions jumped over the dialog with `IfSilent`). Check it once NSIS is downloaded by the first `npm run dist` (Step 5): in `%LOCALAPPDATA%\electron-builder\Cache\nsis\nsis-*\Contrib\Modern UI 2\`, search the `.nsh` files for the macro `MUI_LANGDLL_DISPLAY`; its `LangDLL::LangDialog` call must sit inside that `${Unless} ${Silent}` guard. If it does not, stop and report it to the user before going on: the auto-update would hang on the dialog, and the fix (a custom NSIS template or no dialog) is a decision of the user.

- [ ] **Step 5: Build the installer locally (Windows)** — `npm run dist`; expected: `packages/desktop/release/Joseki-Dojo-Setup-<version>.exe`. First do the silent-mode check of Step 4 (the `${Unless} ${Silent}` guard) in the NSIS that this build downloaded. Manual checks (spec 9), reported to the user as steps — Claude does not install software on the user's machine:
  1. Run the installer: a language dialog with six languages, English preselected; pick 한국어; the installer runs in Korean; the app opens in Korean, without the language screen.
  2. `%APPDATA%\Joseki Dojo\installer-language` is gone after the first start; `config.json` has `"language": "ko"`.
  3. Run the installer with `/S`: no dialog, the language stays.

- [ ] **Step 6: Run** — `npx vitest run && npm run typecheck`.

---

## Task 10: README and the final checks

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README** (English):
  - Install section (Windows): «The installer first asks for the language (English is preselected); you can change it later.»
  - Install section (Linux): «On the first start the app asks for the language.» and a note: «Chinese, Japanese and Korean need CJK fonts; if you see squares instead of characters, install the Noto CJK fonts (`sudo apt install fonts-noto-cjk` on Debian/Ubuntu).»
  - A short «Languages» paragraph after the update section: the six languages, the globe button in the header and «Settings → Language», the switch is immediate.
  - In the start positions section: `packages/server/bases/starts-i18n.json` holds the names in the other five languages, keyed by moves; a position added to the list needs its translations there (a test checks it); after editing the list, apply the same name changes to `chapters.mjs`.
  - Replace Russian UI quotes in the README that refer to buttons only where the button text changed (e.g. «Следующая позиция» in the list mode).

- [ ] **Step 2: Final checks**
```bash
npx vitest run
npm run typecheck
grep -rn "[А-Яа-яЁё]" packages/web/src packages/desktop/src --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -v "^\S*:[0-9]*:\s*\(//\|\*\|/\*\)"
```
Expected: tests and typecheck pass; the grep prints nothing.

- [ ] **Step 3: Translation review** — dispatch a reviewer (fresh context) with the glossary and the five dictionaries plus `starts-i18n.json`: it checks every Go term against the glossary, zh-Hant wording (Taiwan usage), Japanese 初段, plural forms, and reports doubts; fix what it finds.

- [ ] **Step 4: Milestone 4 commit**

```bash
git add README.md packages
git commit -m "feat(i18n): the installer asks for the language; README" -m "The Windows installer offers six languages with English preselected and writes the choice for the app's first start; silent updates keep the player's language. The startup error box follows the saved language. README: languages, the first start choice, CJK fonts on Linux, and starts-i18n.json for new positions." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then push `feat/languages` and give the user the PR title and description (CLAUDE.md: the user creates the PR).
