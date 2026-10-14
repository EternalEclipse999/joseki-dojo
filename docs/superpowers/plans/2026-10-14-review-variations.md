# Review Variations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the review, the user plays any move instead of a game move, continues the variation for both sides or against KataGo's automatic replies, and sees the main network's analysis of each variation position deepen continuously up to a visits limit.

**Architecture:** `KataGoEngine.analyzeStream` sends a query with `reportDuringSearchEvery`, hands partial answers to a callback and can be stopped (`terminate`). `VariationService` (server) validates a variation, keeps one running stream per socket, caches the best result per position and sends `variationAnalysis` messages. The web review keeps the variation (pure helpers in `variation.ts`), asks for the analysis of the shown position, and plays KataGo's reply when the analysis is done.

**Tech Stack:** TypeScript, Node 24, Fastify + `ws`, KataGo analysis engine (fake in tests), Preact, Vitest, Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-14-review-variations-design.md`.
- A variation replaces the selected game move: it starts from the position before move `fromTurn` (session moves; the initial moves come first), its first move is by the same side; moves alternate colours; only board points (no pass); the whole board.
- Variation positions show the candidates for the **next** move (up to 3, losses against the best, as in the review) with PV, ownership and the visits count.
- Deepening: `reportDuringSearchEvery` 0.5 s; limit `analysis.variationVisits` (default `10 × reviewVisits`, settable 1…100000 like the other visits); leaving a position stops its search; results cached in server memory (key = the full move list, at most 500, least recently used out); a returning position shows its cached result at once and a new search replaces it only when it has more visits.
- One running variation search per socket; a new request stops the previous one; closing the socket stops it.
- Auto-reply «Отвечает KataGo» is on by default; KataGo plays the best candidate when the analysis is `done` (limit reached) or on «Ответить сейчас»; while it thinks, board clicks are ignored; navigation or leaving cancels the reply.
- «Глубже» on a game position = the same stream with no variation moves; the stored analysis, move categories and summary do not change.
- Variations are not stored in the database. Training and the bot are unchanged.
- Server → client message: `{ type: 'variationAnalysis', sessionId, fromTurn, moves, visits, done, position }` (`position`: `PositionReview` with `turn = fromTurn + moves.length`). Client → server: `{ type: 'analyzeVariation', sessionId, fromTurn, moves }`, `{ type: 'stopVariation', sessionId }`.
- Error text for an illegal variation: «Недопустимый ход в варианте». UI text Russian; code, comments, commits English.

---

### Task 1: Streaming analysis in the engine and the fake KataGo

**Files:**
- Modify: `packages/server/src/engine/engine.ts`, `packages/server/src/engine/katago-types.ts`
- Modify: `packages/server/test/fake-katago.mjs`
- Test: `packages/server/src/engine/engine.test.ts` (new `describe('analyzeStream')`)

**Interfaces:**
- Produces: `KataGoQueryBody.reportDuringSearchEvery?: number`; `AnalysisResponse.noResults?: boolean`; `interface AnalysisStream { done: Promise<AnalysisResponse | null>; stop(): void }`; `interface StreamingEngine extends AnalysisEngine { analyzeStream(query, onUpdate, everySec?): AnalysisStream }`; `KataGoEngine implements StreamingEngine`.

- [ ] **Step 1: Types** — in `katago-types.ts` add `reportDuringSearchEvery?: number` to `KataGoQueryBody` and `noResults?: boolean` to `AnalysisResponse`.

- [ ] **Step 2: The fake KataGo streams** — in `fake-katago.mjs` (document both in the header comment):
  - a query with `reportDuringSearchEvery` (seconds) gets three partial answers (`isDuringSearch: true`, visits `ceil(maxVisits * k / 4)` for k = 1, 2, 3), each `reportDuringSearchEvery * 1000` ms after the previous, then the final answer (`isDuringSearch: false`, visits `maxVisits`); the scores stay 0 and the best move rule is unchanged;
  - `{ id, action: 'terminate', terminateId }` stops that query's remaining answers (no final answer is sent) and is acknowledged with `{ id, action: 'terminate' }`;
  - streaming queries ignore `FAKE_KATAGO_DELAY_MS` (they have their own timing).

- [ ] **Step 3: `analyzeStream` in `engine.ts`**

```ts
/** A running streaming query: partial answers go to the callback; `done` settles with the last answer. */
export interface AnalysisStream {
  /** The final answer, or after `stop()` the last partial one (null if none came). */
  done: Promise<AnalysisResponse | null>
  /** Ends the search early: KataGo is asked to terminate the query, and `done` settles at once. */
  stop(): void
}

/** An engine that can also stream one query's partial answers (spec: variations, 6.1). */
export interface StreamingEngine extends AnalysisEngine {
  analyzeStream(query: KataGoQueryBody, onUpdate: (partial: AnalysisResponse) => void, everySec?: number): AnalysisStream
}
```

Implementation notes (keep the existing behaviour of `analyze`):
- `Pending` gets an optional `stream?: (msg: unknown) => void`.
- `handleLine`: a message with `isDuringSearch === true` goes to `p.stream` when the pending entry has one (it already counts as progress for the watchdog, since every line updates `lastProgressAt`); otherwise it is ignored as now. A final message with `noResults === true` resolves like a final one.
- `analyzeStream(query, onUpdate, everySec = 0.5)`: sends `{ ...query, reportDuringSearchEvery: everySec }` through the same queue as `analyze` but with `stream` set; keeps the last partial; `done` resolves with the final message (or with the last partial when the final one has `noResults`), and rejects with the query's error like `analyze`.
- `stop()`: if the query is still pending — delete it from `pending`, write `{"id":"t<n>","action":"terminate","terminateId":"<query id>"}` to the current process, and settle `done` with the last partial (or null). Lines that arrive later for that id are ignored (it is no longer pending). Calling `stop()` twice or after `done` is harmless.
- Crash: in `onCrash` (before `start()` resends pending lines) and in `stop()` of the engine, streaming entries are rejected with `EngineError('KataGo перезапущен', 'engine_failed')` and removed, so they are not resent (spec 6.1); non-streaming entries keep today's behaviour.
- `KataGoEngine implements StreamingEngine`.

- [ ] **Step 4: Tests** — `describe('analyzeStream')` in `engine.test.ts` with `fakeEngine()`:
  - delivers three partial answers with growing visits, then `done` resolves with the final answer (visits = maxVisits); use `everySec` 0.02;
  - `stop()` after the first partial: `done` resolves with that partial at once; no further `onUpdate` calls arrive within 200 ms;
  - `stop()` before any partial resolves `done` with null;
  - a streaming query KataGo rejects (`rules: 'invalid'`) rejects `done`;
  - a crash (`FAKE_KATAGO_CRASH_ONCE_FILE`) rejects a running stream with `engine_failed` instead of resending it, while a plain `analyze` sent together is still answered after the restart;
  - the existing engine tests pass unchanged.

- [ ] **Step 5: Run** `npx vitest run packages/server/src/engine && npm run typecheck` — all pass.

- [ ] **Step 6: Commit** `feat(engine): stream a query's partial answers and stop it on demand`

---

### Task 2: The «Предел визитов в вариантах» setting

**Files:**
- Modify: `packages/server/src/config.ts`, `packages/shared/src/settings.ts`, `packages/server/src/settings/service.ts`, `packages/web/src/screens/SettingsScreen.tsx`, `packages/server/test/helpers.ts`
- Modify every other place the type checker flags (object literals of the analysis settings)
- Tests: `packages/server/src/config.test.ts`, `packages/server/src/settings/service.test.ts` (or where analysis visits are tested today)

**Interfaces:**
- Produces: `AppConfig.analysis.variationVisits: number`; `AnalysisSettings.variationVisits: number`.

- [ ] **Step 1:** `config.ts` — `analysis: { reviewVisits: number; endVisits: number; variationVisits: number }`; `DEFAULT_CONFIG.analysis.variationVisits = 5000`; in `loadConfig`, when the file's `analysis` has no `variationVisits`, use `10 × analysis.reviewVisits` of the merged config; `validate` checks it is positive.
- [ ] **Step 2:** `shared/settings.ts` — `AnalysisSettings.variationVisits: number`. `settings/service.ts` — validate it with the other visits (integer 1…100000, same message), pass it through `apply` → `switchTo` → `persist` like the other two.
- [ ] **Step 3:** `SettingsScreen.tsx` — add `{ key: 'variationVisits', label: 'Предел визитов в вариантах' }` after the review visits field.
- [ ] **Step 4:** `test/helpers.ts` `testConfig` — `analysis: { reviewVisits: 10, endVisits: 5, variationVisits: 40 }`.
- [ ] **Step 5: Tests** — config: a file without `variationVisits` gets `10 × reviewVisits` (e.g. reviewVisits 300 → 3000), a file with it keeps it, a non-positive value is a `ConfigError`; settings: an update with `variationVisits` 0 or 100001 is refused with «Число визитов должно быть целым от 1 до 100000», a valid one is saved and shown by `view()`.
- [ ] **Step 6: Run** `npm test && npm run typecheck` — all pass.
- [ ] **Step 7: Commit** `feat(settings): the visits limit for variations in the review`

---

### Task 3: The variation service and its messages

**Files:**
- Create: `packages/server/src/review/variation.ts`, `packages/server/src/review/variation.test.ts`
- Modify: `packages/shared/src/protocol.ts`, `packages/server/src/api/messages.ts`, `packages/server/src/api/messages.test.ts`, `packages/server/src/api/ws.ts`, `packages/server/src/app.ts`
- Modify: `packages/server/test/helpers.ts` (`StubEngine` gets `analyzeStream`)

**Interfaces:**
- Consumes: `StreamingEngine`, `AnalysisStream` (Task 1); `config.analysis.variationVisits` (Task 2); `compactAnalysis`, `candidatesOf`, `movesBefore`, `baseQuery`.
- Produces: `VariationService` with `start(owner: object, req: { sessionId: string; fromTurn: number; moves: Vertex[] }, send: (msg: ServerMessage) => void): void` and `stop(owner: object): void`; `AppServices.variations`.

- [ ] **Step 1: Protocol** (`packages/shared/src/protocol.ts`, import `PositionReview`):

```ts
  | { type: 'analyzeVariation'; sessionId: string; fromTurn: number; moves: Vertex[] }
  | { type: 'stopVariation'; sessionId: string }
```
added to `ClientMessage`, and to `ServerMessage`:
```ts
  /** Variations spec 6.2: the analysis of a variation position (or of a game position for «Глубже», with no moves). */
  | { type: 'variationAnalysis'; sessionId: string; fromTurn: number; moves: Vertex[]; visits: number; done: boolean; position: PositionReview }
```

- [ ] **Step 2: Parsing** (`messages.ts`): `analyzeVariation` needs a `sessionId`, an integer `fromTurn` ≥ 0 and `moves` — an array (at most 200) of valid vertices; `stopVariation` needs a `sessionId`. Tests in `messages.test.ts` for a good message and each bad field.

- [ ] **Step 3: `VariationService`** (`review/variation.ts`):

```ts
import { moveToGtp, nextColor, otherColor, Position, type Move, type PositionReview, type ServerMessage, type Vertex } from '@joseki-dojo/shared'
import { compactAnalysis } from '../analysis/compact'
import type { AppConfig } from '../config'
import type { AnalysisStream, StreamingEngine } from '../engine/engine'
import type { AnalysisResponse } from '../engine/katago-types'
import { baseQuery } from '../engine/query'
import { toErrorMessage } from '../errors'
import { SessionError } from '../session/session'
import { movesBefore } from '../store/records'
import type { SessionRepo } from '../store/repo'
import { candidatesOf } from './compute'

export interface VariationRequest {
  sessionId: string
  /** The game move the variation replaces: it starts from the position before it. */
  fromTurn: number
  moves: Vertex[]
}

type Analysed = Omit<PositionReview, 'turn'>
/** Spec 4: results kept in memory, least recently used out. */
const CACHE_SIZE = 500

/** Spec 6.2: one deepening search per owner (a socket); results cached per position; partial results sent as they come. */
export class VariationService {
  private readonly running = new Map<object, AnalysisStream>()
  private readonly cache = new Map<string, { visits: number; position: Analysed }>()

  constructor(private readonly d: { repo: SessionRepo; engine: StreamingEngine; config: AppConfig; everySec?: number }) {}

  start(owner: object, req: VariationRequest, send: (msg: ServerMessage) => void): void {
    this.stop(owner)
    const rec = this.d.repo.getSession(req.sessionId)
    if (!rec) throw new SessionError('Тренировка не найдена', 'session_not_found')
    if (!Number.isInteger(req.fromTurn) || req.fromTurn < 0 || req.fromTurn > rec.moves.length) throw new SessionError('Нет такого хода', 'bad_request')
    const moves: Move[] = movesBefore(rec, req.fromTurn)
    let color = nextColor(moves)
    for (const vertex of req.moves) {
      moves.push({ color, vertex })
      color = otherColor(color)
    }
    try {
      Position.fromMoves(moves)
    } catch {
      throw new SessionError('Недопустимый ход в варианте', 'illegal_move')
    }
    const key = moves.map((m) => `${m.color}${moveToGtp(m.vertex)}`).join(' ')
    const limit = this.d.config.analysis.variationVisits
    const reply = (visits: number, done: boolean, position: Analysed): void =>
      send({ type: 'variationAnalysis', sessionId: req.sessionId, fromTurn: req.fromTurn, moves: req.moves, visits, done, position: { turn: req.fromTurn + req.moves.length, ...position } })

    const cached = this.recall(key)
    if (cached) {
      reply(cached.visits, cached.visits >= limit, cached.position)
      if (cached.visits >= limit) return
    }
    const stream = this.d.engine.analyzeStream(
      { ...baseQuery(moves), maxVisits: limit, includeOwnership: true },
      (partial) => {
        const better = this.keep(key, partial)
        if (better && this.running.get(owner) === stream) reply(better.visits, false, better.position)
      },
      this.d.everySec ?? 0.5,
    )
    this.running.set(owner, stream)
    stream.done.then(
      (final) => {
        const current = this.running.get(owner) === stream
        if (current) this.running.delete(owner)
        if (final) this.keep(key, final)
        const best = this.recall(key)
        // Only a search that ran to its end is `done`; a stopped one was left by its owner.
        if (current && best) reply(best.visits, true, best.position)
      },
      (err: unknown) => {
        if (this.running.get(owner) !== stream) return
        this.running.delete(owner)
        send(toErrorMessage(err))
      },
    )
  }

  stop(owner: object): void {
    const stream = this.running.get(owner)
    if (!stream) return
    this.running.delete(owner)
    stream.stop()
  }

  /** Stores `r` when it has more visits than the cached result; returns the stored one, or null when it was not better. */
  private keep(key: string, r: AnalysisResponse): { visits: number; position: Analysed } | null {
    const a = compactAnalysis(r)
    const visits = a.rootInfo.visits
    const known = this.cache.get(key)
    if (known && known.visits >= visits) return null
    const entry = { visits, position: { scoreLeadBlack: a.rootInfo.scoreLead, candidates: candidatesOf(a), ownership: a.ownership } }
    this.cache.delete(key)
    this.cache.set(key, entry)
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string)
    return entry
  }

  private recall(key: string): { visits: number; position: Analysed } | null {
    const hit = this.cache.get(key)
    if (!hit) return null
    this.cache.delete(key)
    this.cache.set(key, hit)
    return hit
  }
}
```
(`stop()` settles `done` with the last partial; the `then` above then sees that it is no longer current, keeps the result in the cache and sends nothing.)

- [ ] **Step 4: Wiring** — `app.ts`: `AppServices.variations: VariationService` created in `createServices` with `{ repo, engine, config }` (the real `KataGoEngine` is a `StreamingEngine`). `ws.ts`: `SocketDeps` adds `'variations'`; `analyzeVariation` → `deps.variations.start(socket, msg, send)` (errors go through the existing catch → `toErrorMessage`); `stopVariation` → `deps.variations.stop(socket)`; `socket.on('close')` also calls `deps.variations.stop(socket)`.

- [ ] **Step 5: `StubEngine.analyzeStream`** (`test/helpers.ts`): sends `onUpdate` partials synchronously-later (via `setTimeout(0)`) at visits `ceil(limit/4)`, `ceil(limit/2)`, then resolves `done` with the final `stubResponse` (visits = limit); `stop()` settles `done` with the last partial and suppresses the rest; records each streamed query in `queries` and counts stops in a public `stops` field.

- [ ] **Step 6: Tests** (`review/variation.test.ts`, with `StubEngine`, `openDb(':memory:')`, a finished session record inserted through `SessionRepo`):
  - sends partial results then one `done: true` result with visits = `variationVisits`; `position.turn` is `fromTurn + moves.length`; candidates come from `candidatesOf`;
  - the streamed query has the session's moves before `fromTurn` plus the variation moves with alternating colours, `maxVisits` = limit, ownership on;
  - an illegal variation (a move on an occupied point) throws «Недопустимый ход в варианте»; an unknown session and a bad `fromTurn` throw;
  - a new `start` for the same owner stops the previous stream (`stops` = 1) and no message of the old one arrives afterwards; `stop(owner)` stops it;
  - a position already analysed to the limit is answered from the cache with `done: true` and no new query; a cached partial result is sent first, then the new search replaces it only when it has more visits;
  - two owners run independently.
  `messages.test.ts`: the two new client messages. A `ws`/api test (follow the existing socket tests) that `analyzeVariation` over the socket produces `variationAnalysis` messages and that closing the socket stops the stream.

- [ ] **Step 7: Run** `npm test && npm run typecheck` — all pass.
- [ ] **Step 8: Commit** `feat(review): analyse variations with a deepening search per socket`

---

### Task 4: Variations in the review screen; e2e

**Files:**
- Create: `packages/web/src/variation.ts`, `packages/web/src/variation.test.ts`
- Modify: `packages/web/src/screens/ReviewScreen.tsx`, `packages/web/src/App.tsx`, `packages/web/src/styles/screens.css`
- Create: `e2e/variations.spec.ts`

**Interfaces:**
- Consumes: the messages of Task 3.

- [ ] **Step 1: Pure helpers `packages/web/src/variation.ts`** (and tests in `variation.test.ts`):

```ts
import { nextColor, otherColor, Position, vertexToGtp, type Move, type Vertex } from '@joseki-dojo/shared'

/** Variations spec 3: the variation replaces game move `fromTurn`; `step` moves of it are shown (1..moves.length). */
export interface Variation {
  fromTurn: number
  moves: Vertex[]
  step: number
}

export const startVariation = (fromTurn: number, first: Vertex): Variation => ({ fromTurn, moves: [first], step: 1 })

/** A move after the shown part: the hidden tail is replaced. */
export function playInVariation(v: Variation, next: Vertex): Variation {
  const moves = [...v.moves.slice(0, v.step), next]
  return { ...v, moves, step: moves.length }
}

/** Steps inside the variation, between its first move and its last. */
export const stepVariation = (v: Variation, delta: number): Variation => ({ ...v, step: Math.min(v.moves.length, Math.max(1, v.step + delta)) })

export const shownMoves = (v: Variation): Vertex[] => v.moves.slice(0, v.step)

/** The key of a position: the replaced game move and the variation moves before it (as sent to the server). */
export const positionKey = (fromTurn: number, moves: readonly Vertex[]): string => `${fromTurn}:${moves.map(vertexToGtp).join(' ')}`

/** The moves of the position after `moves` played from the position before game move `fromTurn`, colours alternating. */
export function variationMoves(before: readonly Move[], moves: readonly Vertex[]): Move[] {
  const out = [...before]
  let color = nextColor(out)
  for (const vertex of moves) {
    out.push({ color, vertex })
    color = otherColor(color)
  }
  return out
}

/** Whether `vertex` is a legal next move after `moves`. */
export function isLegalNext(moves: readonly Move[], vertex: Vertex): boolean {
  try {
    return Position.fromMoves(moves).isLegal(nextColor(moves), vertex)
  } catch {
    return false
  }
}
```
Tests: start, play at the end, play after stepping back replaces the tail, step clamps to 1..length, `shownMoves`, `positionKey` format, `variationMoves` alternates colours from the side to move, `isLegalNext` refuses an occupied point.

- [ ] **Step 2: `App.tsx`** — keep the latest `variationAnalysis` message in state (`case 'variationAnalysis': setVariationUpdate(msg)`) and pass `ReviewScreen` two more props: `variationUpdate` (the last message, or null) and `send` (or two callbacks `onAnalyze(fromTurn, moves)` / `onStopAnalysis()` that send `analyzeVariation` / `stopVariation` with the session id). Reset the stored update when the session changes.

- [ ] **Step 3: `ReviewScreen.tsx`** — behaviour (spec 3–5); keep the existing game view as it is when no variation is open:
  - **State:** `variation: Variation | null`; `results: Map<string, { visits: number; done: boolean; position: PositionReview }>` filled from `variationUpdate` (keyed by `positionKey(msg.fromTurn, msg.moves)`; a message only replaces a stored result with fewer visits, or marks it done); `autoReply` (default true); `awaiting: string | null` (the key of the position KataGo must answer); `deeper: boolean` for «Глубже» on a game position; `selected` candidate index (default 0) and the existing `pvStep` now follow the selected candidate.
  - **Requests:** whenever the shown position is a variation position (`fromTurn`, `shownMoves`) or «Глубже» is on for game position `turn` (`fromTurn = turn`, no moves), send `analyzeVariation` for it unless its stored result is `done`; when it stops being shown, and on unmount, send `stopVariation`.
  - **Board clicks** (`Board onClick`): ignored while `awaiting` is set. Without a variation: the click on a legal point of the position before game move `turn` (`isLegalNext(movesBefore, vertex)`) starts `startVariation(turn, vertex)`. With a variation: a legal next move after the shown moves plays `playInVariation`. With `autoReply` on, a user move sets `awaiting` to the new position's key.
  - **Auto-reply:** when the result for `awaiting` is `done` (or the user presses «Ответить сейчас», which uses the latest result for that key), play its best candidate with `playInVariation` and clear `awaiting`; navigation, «Вернуться к партии», a new variation or turning `autoReply` off clear `awaiting` (and the analysis request moves to the newly shown position).
  - **Display in a variation:** the board shows `variationMoves(gameMovesBefore(fromTurn), shownMoves)`; the last variation move has the dot; the candidate letters A/B/C on the board and the list are the next-move candidates from `results` for this position (an empty list with «KataGo считает…» until the first result); the last move's loss — when the result of the position before it is known — is `max(0, colorSign(mover) · (leadBefore − leadAfter))` in Black's view (`scoreLeadBlack`), shown as «−0,9» next to the move; no category colour.
  - **Panel above the candidates in a variation:** «Вариант от хода N: R6 · D4 · …» (N = `fromTurn + 1`, moves in `moveLabel`, the shown step in bold), ‹ › buttons and ← → keys step inside the variation, «Вернуться к партии» closes it and shows game move `fromTurn`; the switch «Отвечает KataGo» (a checkbox with that label); «визитов: N» of the shown result; while awaiting: «KataGo думает: N / limit визитов» and the button «Ответить сейчас». The limit comes from the result (`done`) or is not shown when unknown — show «KataGo думает: N визитов».
  - **Candidates:** a click on a row selects it (`selected`); each row gets a «Сыграть» button that plays that candidate (starts a variation instead of game move `turn`, or continues the variation); «Показать ветку» shows the PV of the selected candidate (`pvMoves`), not only of A.
  - **«Глубже»** on a game position: a button next to «Территория»; while on, the game position's candidates come from `results` for `(turn, [])` when they have more visits than the stored analysis; the move category and loss of the game move are unchanged.
  - Keep the component readable: move the variation panel into a small component (e.g. `VariationBar`) inside the file or in `components/`.
- [ ] **Step 4: Styles** — the variation bar and the «KataGo думает» line in `screens.css`, using the same tokens as `.navigator` and `.branch`.
- [ ] **Step 5: e2e `e2e/variations.spec.ts`** — play a free training with a few moves (follow `e2e/game.spec.ts` or the traps spec for starting and finishing), open the review, click an empty board point on move 1 → the variation bar shows «Вариант от хода 1», after the fake KataGo's answers the reply appears (two stones of the variation on the board, the bar lists two moves), ‹ goes back to the first move, a click on another point replaces the tail, «Вернуться к партии» hides the bar.
- [ ] **Step 6: Run** `npm test && npm run typecheck && npm run e2e` — all pass. Check the screen once by eye in light and dark themes.
- [ ] **Step 7: Commit** `feat(web): variations in the review with KataGo replies and deepening analysis`
