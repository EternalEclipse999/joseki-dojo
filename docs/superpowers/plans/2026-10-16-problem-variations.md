# Problem Variations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After answering a problem, the player can explore it as in the review: rewind to the problem's start, play variations for both sides with KataGo's replies, candidates with «Ветка», «Глубже» (spec `docs/superpowers/specs/2026-10-16-problem-variations-design.md`).

**Architecture:** The server's `VariationService` gains a second base — a problem card (`startProblem`), sharing its cache, deepening, streaming and retry with the review's variations; new socket messages `analyzeProblemVariation` / `stopProblemVariation` / `problemVariationAnalysis`; the answer verdict carries the stored analysis of the problem position and the lead after the answer. The web's variation machinery moves out of `ReviewScreen` into a shared hook used by the review (unchanged behaviour) and by the problem screen, which models the problem as a one-move game (the answer) with a view before it.

**Tech Stack:** TypeScript, Fastify + ws, Preact, Vitest, Playwright.

## Global Constraints

- Exploration only after the answer; the answer alone is the card's repetition: variations change neither the rating nor the schedule.
- Views after the answer: «Начало задачи» (the problem position without the answer) and «Ваш ответ» (with it, marks as now); nothing before the problem's start; nothing after the answer except a variation.
- On «Ваш ответ» the candidates are those of the problem position (review semantics: the candidates of the position before the shown move); a board click continues after the answer; on «Начало задачи» a board click plays another first move instead of the answer.
- Variations behave as in the review: both sides in turn, «Отвечает KataGo» (on by default) and «Ответить сейчас», step, close (back to the view it started from), live deepening of the shown position, the last move's loss, «Ветка» / «Сыграть» per candidate row, «Глубже» for the problem position.
- The loss of the first move after the answer uses the lead after the answer from the verdict (`leadAfter`: measured for an answer outside the stored candidates, else the problem position's lead minus the answer's loss from the mover's side).
- The review's behaviour does not change; `packages/web/src/variation.test.ts` and `e2e/variations.spec.ts` stay green without edits to their expectations.
- One shared implementation of the variation machinery on each side (server: `VariationService`; web: one hook) — no copy.
- User-facing text in all six catalogs (`packages/shared/src/i18n/{ru,en,ja,ko,zh-Hans,zh-Hant}.ts`); terms per `docs/superpowers/specs/2026-10-14-languages-glossary.md` («ветка» for KataGo's continuation, «вариант» for the player's own).
- Code, comments, commits in English; commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never mention the online joseki dictionary or the pro-game database.
- Every e2e server starts from a gitignored, wiped data folder; a run leaves tracked files unchanged.

---

### Task 1: The server — problem variations and the richer verdict

**Files:**
- Modify: `packages/shared/src/types.ts` (`ProblemAnswer`), `packages/shared/src/protocol.ts`, the six catalogs (`error.card.notFound`), `packages/server/src/cards/service.ts`, `packages/server/src/cards/service.test.ts`, `packages/server/src/review/variation.ts`, `packages/server/src/review/variation.test.ts`, `packages/server/src/session/session.ts` (`SessionErrorCode`), `packages/server/src/api/messages.ts` (+ its test if it has one), `packages/server/src/api/ws.ts`, `packages/server/src/app.ts`, `packages/server/src/api/api.test.ts`

**Interfaces:**
- Produces: `ProblemAnswer.position: PositionReview`, `ProblemAnswer.leadAfter: number`; `CardService.problemBase(cardId: string): { moves: Move[]; toMove: Color } | null`; `VariationService` dep `problems?: (cardId: string) => { moves: Move[]; toMove: Color } | null` and `startProblem(owner: object, req: ProblemVariationRequest, send: (msg: ServerMessage) => void): void` with `ProblemVariationRequest { cardId: string; answer: Vertex; fromTurn: number; moves: Vertex[] }`; client messages `{ type: 'analyzeProblemVariation'; cardId: string; answer: Vertex; fromTurn: number; moves: Vertex[] }`, `{ type: 'stopProblemVariation'; cardId: string }`; server message `{ type: 'problemVariationAnalysis'; cardId: string; fromTurn: number; moves: Vertex[]; visits: number; done: boolean; position: PositionReview }`; error code `card_not_found`.

- [ ] **Step 1: Shared types and texts**

`packages/shared/src/types.ts`, in `ProblemAnswer` after `line`:

```ts
  /** Spec (problem variations) 3.1: the stored analysis of the problem position, for the candidates after the answer. */
  position: PositionReview
  /** Spec (problem variations) 2.3: Black's lead after the answer — measured, or the problem position's lead minus the answer's loss. */
  leadAfter: number
```

`packages/shared/src/protocol.ts`: `ClientMessage` gains

```ts
  /** Spec (problem variations) 3.1: a variation on a problem card — instead of the answer (fromTurn 0) or after it (1). */
  | { type: 'analyzeProblemVariation'; cardId: string; answer: Vertex; fromTurn: number; moves: Vertex[] }
  | { type: 'stopProblemVariation'; cardId: string }
```

`ServerMessage` gains

```ts
  /** Spec (problem variations) 3.1: the analysis of a problem variation position (or of the problem position for «Глубже», with no moves). */
  | { type: 'problemVariationAnalysis'; cardId: string; fromTurn: number; moves: Vertex[]; visits: number; done: boolean; position: PositionReview }
```

`ErrorCode` gains `'card_not_found'`. Catalog key in all six: `'error.card.notFound': 'Задачи больше нет'`.

- [ ] **Step 2: Failing tests**

`packages/server/src/cards/service.test.ts` (in the answer tests, reusing their judge stub and the stored candidates there — Q17 best, P17 at 0.8, root lead as in that fixture):
- a stored candidate answer → `answer.position` equals `{ turn: 0, scoreLeadBlack: <root lead>, visits: <stored visits>, candidates: <stored candidates>, ownership: null }` and `answer.leadAfter === <root lead> − colorSign(toMove) × 0.8` for the P17 answer;
- an answer outside the candidates → `leadAfter` equals the stub's measured lead after the move (−2.5 in the existing case);
- `problemBase`: a move card → `{ moves: <setup moves>, toMove }`; a position card, an unknown id and a deleted move card → `null`.

`packages/server/src/review/variation.test.ts` (a `problems` stub dep returning `{ moves: [{ color: 'B', vertex: [15, 3] }], toMove: 'W' }` for `'c1'` and `null` otherwise):
- `startProblem(owner, { cardId: 'c1', answer: [16, 5], fromTurn: 0, moves: [[16, 2]] }, send)` queries the setup plus `W R17` (the first variation move is `toMove`'s), and the messages are `problemVariationAnalysis` with `cardId: 'c1'`, `fromTurn: 0`, `moves: [[16, 2]]`, `position.turn === 1`;
- `fromTurn: 1` queries the setup, then the answer as `toMove`'s move, then the variation moves alternating (`W R14`, `B R17` for `answer [16, 5]`, `moves [[16, 2]]`), `position.turn === 2`;
- an unknown card → `SessionError` with code `card_not_found`; an illegal move (on an occupied point) → `illegal_move`; `fromTurn` other than 0 or 1 → `bad_request`;
- a problem search and a review search of the same owner replace each other (one stream per owner), and `stop(owner)` stops a problem search.

`packages/server/src/api/messages.ts` tests (if a test file exists for it, else in `api.test.ts` through the socket): a valid `analyzeProblemVariation` parses; a missing `cardId`, a non-vertex `answer`, a bad `fromTurn` or `moves` → `bad_request`; `stopProblemVariation` needs a `cardId`.

Run the focused files — FAIL.

- [ ] **Step 3: The verdict and `problemBase`** — `packages/server/src/cards/service.ts`:

```ts
  /** Spec (problem variations) 3.1: the moves and the side to move of a problem card; null for anything else. */
  problemBase(cardId: string): { moves: Move[]; toMove: Color } | null {
    const card = this.d.repo.card(cardId)
    if (!card || card.deleted || card.kind !== 'move') return null
    const p = card.data as unknown as ProblemData
    return { moves: p.moves, toMove: p.toMove }
  }
```

In `answer`, keep the measured lead of an off-list answer (`let measured: number | null = null`; set it from `after.rootInfo.scoreLead` next to `lossAfter`) and return, besides the existing fields:

```ts
      position: { turn: 0, scoreLeadBlack: p.analysis.scoreLeadBlack, visits: p.analysis.visits, candidates: p.analysis.candidates, ownership: null },
      leadAfter: measured ?? p.analysis.scoreLeadBlack - colorSign(p.toMove) * judged.loss,
```

- [ ] **Step 4: Problem variations** — `packages/server/src/review/variation.ts`. Refactor `start` so that the part after building the full move list is a private method shared by both bases, then add `startProblem`:

```ts
export interface ProblemVariationRequest {
  cardId: string
  /** The answer the variation follows when `fromTurn` is 1. */
  answer: Vertex
  /** 0: instead of the answer; 1: after it. */
  fromTurn: number
  moves: Vertex[]
}
```

- the deps gain `problems?: (cardId: string) => { moves: Move[]; toMove: Color } | null`;
- `start(owner, req, send)` keeps its checks and builds `moves` as now, then calls `this.run(owner, moves, (visits, done, position) => send({ type: 'variationAnalysis', sessionId: req.sessionId, fromTurn: req.fromTurn, moves: req.moves, visits, done, position: { turn: req.fromTurn + req.moves.length, ...position } }), send)`;
- `startProblem(owner, req, send)`: `const base = this.d.problems?.(req.cardId) ?? null`; none → `throw new SessionError({ key: 'error.card.notFound' }, 'card_not_found')`; `fromTurn` not 0 or 1 → `bad_request` (`error.turn.notFound`); `moves = [...base.moves]`, then, colour starting at `base.toMove`, push the answer when `fromTurn === 1`, then each variation move, alternating; the same `Position.fromMoves` legality check (`illegal_move`, `error.variation.illegal`); then `this.run(owner, moves, (visits, done, position) => send({ type: 'problemVariationAnalysis', cardId: req.cardId, fromTurn: req.fromTurn, moves: req.moves, visits, done, position: { turn: req.fromTurn + req.moves.length, ...position } }), send)`;
- `run(owner, moves, reply, send)` holds what `start` did after its checks: stop the owner's previous search, the cache key, the cached reply, `launch`.

`SessionErrorCode` (`packages/server/src/session/session.ts`) gains `'card_not_found'`.

- [ ] **Step 5: Socket and wiring**
- `packages/server/src/api/messages.ts`: parse `analyzeProblemVariation` (`cardId` a non-empty string; `answer` a vertex; `fromTurn` 0 or 1; `moves` as for `analyzeVariation`) and `stopProblemVariation` (`cardId`); anything else in them → `bad_request`, as the existing cases do.
- `packages/server/src/api/ws.ts`: `analyzeProblemVariation` → `deps.variations.startProblem(socket, msg, send)`; `stopProblemVariation` → `deps.variations.stop(socket)`.
- `packages/server/src/app.ts`: `new VariationService({ repo, engine, config, problems: (id) => cards.problemBase(id) })`.
- `packages/server/src/api/api.test.ts`: through the socket, an `analyzeProblemVariation` for an unknown card answers an `error` with code `card_not_found`.

- [ ] **Step 6: Run** `npm test && npm run typecheck` — PASS. **Commit:**

```bash
git add packages/shared packages/server
git commit -m "feat(variations): problem variations on the server; the verdict carries the problem analysis" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The web — the variation machinery as a shared hook (review unchanged)

**Files:**
- Create: `packages/web/src/use-variations.ts` (the hook)
- Modify: `packages/web/src/screens/ReviewScreen.tsx`, `packages/web/src/variation.ts`, `packages/web/src/variation.test.ts` (new cases only)

**Interfaces:**
- Consumes: `packages/web/src/variation.ts` (`Variation`, `startVariation`, `startAfterTurn`, `exitTurn`, `playInVariation`, `stepVariation`, `shownMoves`, `positionKey`, `variationMoves`, `isLegalNext`, `mergeResult`, `shouldReply`, `candidateIndex`, `candidateLeft`, `bestIsPass`, `replyVertex`, `moveLoss`), `VariationLink` (`ReviewScreen.tsx`).
- Produces: `useVariations(game: VariationGame, link: VariationLink)` in `packages/web/src/use-variations.ts`; the `VariationGame` input type; `mergeResult` accepting any update with `fromTurn`, `moves`, `visits`, `done`, `position` (so that a `problemVariationAnalysis` fits).

This task is a behaviour-preserving extraction: the review must look and act exactly as before.

- [ ] **Step 1: Read** `ReviewLoaded` in `packages/web/src/screens/ReviewScreen.tsx` (the state from `turn` to `passedKey`, the effects, `step`, the board's `signMap`, `answer`, `play`, `onBoardClick`, `backToGame`, `selectTurn`, `switchAutoReply`, the markers, `lastLoss`) and `packages/web/src/variation.ts`.

- [ ] **Step 2: The game the hook works on**

```ts
/** What a screen explores: the moves before the first game move, the game moves, and the stored analyses. */
export interface VariationGame {
  /** The moves before game move 0 (the review: the initial moves; a problem: its setup). */
  setup: readonly Move[]
  /** The game moves (the review: the training; a problem: the answer). */
  moves: readonly Move[]
  /**
   * positions[t]: the stored analysis of the position before game move t, t = 0..moves.length. A position may hold only a
   * lead (no candidates, visits 0): it serves as the «before» of a move's loss, never as a list of candidates.
   */
  positions: readonly PositionReview[]
  /** A view of the position before game move 0 with no move placed (turn −1): a problem's start; the review has none. */
  startView: boolean
}
```

- [ ] **Step 3: The link** — keep `VariationLink` as it is (`update`, `analyze(fromTurn, moves)`, `stop()`, `connected`, `errorSeq`, `visits`), but type `update` as `VariationUpdateLike | null` where `VariationUpdateLike = Pick<VariationUpdate, 'fromTurn' | 'moves' | 'visits' | 'done' | 'position'>`; the screen gives the hook only updates that belong to it (the review filters by `sessionId` today inside `ReviewLoaded`; move that filter to where the review builds its link, or keep it in the review's wrapper — the hook itself does not know sessions or cards). `mergeResult` takes `VariationUpdateLike`.

- [ ] **Step 4: The hook** — move the variation machinery of `ReviewLoaded` into `useVariations(game, link)` as is, generalised only where the two screens differ:
- `turn` ranges from `game.startView ? -1 : 0` to `game.moves.length - 1`; the initial turn is `0`;
- at turn −1 the board shows `setup` (no game move), the last setup move is marked, the candidates are `positions[0]`'s, and a board click starts `startVariation(0, v, -1)` (instead of game move 0); `exitTurn` of such a variation returns −1;
- at turn ≥ 0 everything is as in the review today (the board after move `turn`, the candidates of the position before it, a click plays after the shown move);
- the loss of a variation's last move: `before` is the previous variation position's result, else (first move) the deeper result of `positions[fromTurn]` when it has more visits, else `positions[fromTurn]` (which may hold only a lead);
- everything screen-specific stays in the screen: the review's summary, chart, move list, punishments, ownership toggle, replay buttons; the hook returns what the screens render from (turn and its setters, `variation`, `step`, `shown` position, `candidates`, `selIndex`, `hot`, setters for the hot and selected vertex, `pvStep` / branch, `signMap`, `markers`, `dimmed`, `highlighted`, `last`, `awaiting`, `autoReply` and its switch, `answer` (reply now), `deeper` toggle, `play`, `onBoardClick`, `backToGame`, `selectTurn`, `lastLoss`, `result`, `passedKey`/`passed`).

Name things as they are named in `ReviewLoaded` today; keep the comments that explain spec rules, moving them with their code.

- [ ] **Step 5: Pure additions with tests** — where the turn −1 rules are pure (the turn bounds, the click's meaning at −1, the exit of a variation started at −1), put them as small functions in `packages/web/src/variation.ts` and add cases to `packages/web/src/variation.test.ts`: bounds with and without a start view; a click at −1 starts `{ fromTurn: 0, originTurn: -1 }`; `exitTurn` of it is −1; a click at 0 with a start view still plays after move 0. Do not change the expectations of the existing cases.

- [ ] **Step 6: The review uses the hook** — `ReviewLoaded` calls `useVariations({ setup: review.initialMoves, moves: review.moves, positions: review.positions, startView: false }, link)` and renders exactly as before.

- [ ] **Step 7: Run** `npm test && npm run typecheck && npm run e2e` — PASS, with `e2e/variations.spec.ts` and the review specs unchanged. **Commit:**

```bash
git add packages/web
git commit -m "refactor(web): the variation machinery as a shared hook" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: The problem screen explores; e2e and README

**Files:**
- Modify: `packages/web/src/screens/ProblemScreen.tsx`, `packages/web/src/problem-view.ts` (+ test), `packages/web/src/App.tsx`, the six catalogs, the stylesheet if needed, `e2e/problems.spec.ts`, `README.md`

**Interfaces:**
- Consumes: `useVariations`, `VariationGame`, `VariationLink` (Task 2); `ProblemAnswer.position`, `ProblemAnswer.leadAfter`, the socket messages (Task 1); `CandidateList`, `VariationBar`, `Board`.

- [ ] **Step 1: Catalog keys** (ru; all six):

```ts
  'problem.view.start': 'Начало задачи',
  'problem.view.answer': 'Ваш ответ: {move}',
  'problem.explore': 'Щёлкните по доске, чтобы исследовать позицию',
```

- [ ] **Step 2: App** — `packages/web/src/App.tsx`:
- state `problemVariationUpdate` set from `problemVariationAnalysis` messages whose `cardId` is the open problem's (read it through a ref, as other socket handlers read current state); cleared when the problem changes;
- the problem screen's link: `analyze: (fromTurn, moves) => send({ type: 'analyzeProblemVariation', cardId, answer: <the answer's vertex>, fromTurn, moves })`, `stop: () => send({ type: 'stopProblemVariation', cardId })`, `update`, `connected`, `errorSeq`, `visits` as the review's link has them;
- leaving the problem (next card, finish, section change) stops the variation search.

- [ ] **Step 3: The problem screen** — `packages/web/src/screens/ProblemScreen.tsx`:
- before the answer: unchanged;
- after the answer: `useVariations({ setup: problem.moves, moves: [{ color: problem.userColor, vertex: answer.vertex }], positions: [answer.position, { turn: 1, scoreLeadBlack: answer.leadAfter, visits: 0, candidates: [], ownership: null }], startView: true }, link)`; the board, markers, clicks, arrows and keys come from the hook; on «Ваш ответ» without a variation or branch, the problem marks of `problem-view.ts` stay (circle on the answer, triangle on KataGo's best, cross on the training's move) together with the hook's candidate letters;
- the aside: the verdict lines as now; a line with `problem.view.start` or `problem.view.answer` (GTP of the answer) and the ‹ › buttons; `problem.explore` as a hint while no variation is open; the `CandidateList` and the `VariationBar` as the review renders them (with «Глубже» for the problem position); then the repetition panel and the queue buttons as now;
- the separate «Показать ветку» / «Скрыть ветку» toggle goes (the best candidate's «Ветка» replaces it); adjust `problem-view.ts` and its tests for whatever the toggle fed.

- [ ] **Step 4: e2e** — extend the test in `e2e/problems.spec.ts` after the verdict and the re-rating, before «Закончить повторение» (the problem is the empty board, Black to move, the answer Q16; the fake KataGo's best move is the first free point of D4, Q4, D16, Q16):
1. a click on a free point (e.g. C3, `vertex(page, 2, 16)`) plays White's move after the answer; with «Отвечает KataGo» on, a Black stone appears at the fake's best free point (D4 is free: `vertex(page, 3, 15)` holds a stone);
2. «←» until the start view: «Начало задачи» shows and Q16 has no stone; a click on another point (e.g. R4, `vertex(page, 16, 15)`) starts another first move there;
3. «Закончить повторение» returns to the tab as before.

Check the real locators first (how the review e2e reads a stone on a vertex and presses «←»).

- [ ] **Step 5: README** — in the «Повторение» paragraph, after the problem sentences: after answering, you can rewind to the problem's start and explore it as in the review: variations for both sides with KataGo's replies, candidates with their lines; the exploration does not change the rating.

- [ ] **Step 6: Run** `npm test && npm run typecheck && npm run e2e`, then `git status --short` (clean apart from the commit). **Commit:**

```bash
git add packages/web packages/shared e2e README.md
git commit -m "feat(problems): explore a problem after the answer, as in the review" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
