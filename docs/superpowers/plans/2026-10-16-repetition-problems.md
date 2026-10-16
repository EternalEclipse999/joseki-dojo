# Repetition, iteration 2 (problems) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «Find a good move» cards from the user's in-zone mistakes and unpunished in-zone bot mistakes, a one-move problem screen with KataGo's verdict, problems in the queue, the summary and the card list (spec `docs/superpowers/specs/2026-10-15-repetition-design.md`, iteration 2).

**Architecture:** The card service, already called after every computed review, also records problem cards: one per position before a user move that was a mistake/blunder or a failed punishment, keyed by the position seen in the top-right corner (diagonal-canonical) plus the colour to move. A problem card keeps everything to show and judge it (setup moves, the review's analysis of the position with candidates and their losses). `POST /api/cards/:id/answer` judges a click: from the stored candidates when possible, else one KataGo analysis of the position after the move; the verdict is a card review. The web gets a problem screen in the «Повторение» section, problems in the queue, and a kind filter in the card list.

**Tech Stack:** TypeScript, Node 24, Fastify, better-sqlite3, ts-fsrs 5.4.2, Preact, Vitest, Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-15-repetition-design.md` sections 4.1–4.2 (problems), 5.1 (kind filter, problem rows), 5.2 (queue with both kinds), 5.4 (problem screen), 7 (answer route), 9; section 10 item 2.
- A problem card is created for: (a) every user move in the corner zone whose category is `mistake` or `blunder` (position before that move, source `mistake`); (b) every unpunished bot mistake whose bot move is in the zone (position before the user's reply, source `unpunished`). Moves inside the initial (start) moves never count. When one position qualifies twice in a training, it is one card with source `unpunished`.
- Problem key: `move:<colour to move>:<board signature>` where the board is the position after the setup moves, with every stone moved by `toTopRight(v, corner)` (the training's corner becomes the top-right one) and the signature is the smaller of the plain and the diagonal-mirrored `signMap` readings (as `keyOf` in the starts tools). The same position in another corner or mirrored is the same card.
- A new problem card's first review is «Снова» (`again`) at creation; an existing (not deleted) card gets an «again» review once per training (the `(card_id, session_id)` unique index); a deleted card never comes back.
- Answer: illegal point → 400; the loss of a move among the stored candidates is that candidate's `loss`; otherwise one KataGo analysis of the position after the move (`maxVisits` = `config.analysis.reviewVisits`) and `loss = max(0, colorSign(toMove) * (rootLeadBlack − afterLeadBlack))`; the category by the thresholds of the current level; auto rating: KataGo's first candidate → `easy`, `exact` → `good`, `inaccuracy` → `hard`, `mistake`/`blunder` → `again`. KataGo unavailable (not ready or an engine error) → 503 `{ error: 'engine_unavailable' }`, nothing recorded.
- The review panel's repetition (`ReviewData.repetition`) is only ever a position card's review.
- The queue serves both kinds by due time (with the 20-minute learn-ahead for cards in learning steps).
- User-facing text: every new message in all six catalogs (`packages/shared/src/i18n/{ru,en,ja,ko,zh-Hans,zh-Hant}.ts`); Go terms per `docs/superpowers/specs/2026-10-14-languages-glossary.md` (category labels are the existing `category.*`).
- Code, comments, commits in English; no mention of the online joseki dictionary or the pro-game database. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Problem cards on the server — creation, queue, list

**Files:**
- Modify: `packages/shared/src/types.ts`
- Create: `packages/server/src/cards/problem.ts`, `packages/server/src/cards/problem.test.ts`
- Modify: `packages/server/src/cards/service.ts`, `packages/server/src/cards/service.test.ts`, `packages/server/src/cards/repo.ts`, `packages/server/src/cards/repo.test.ts`

**Interfaces:**
- Consumes: `toTopRight`, `mirrorDiagonal` (`packages/server/src/jdb`), `Position`, `colorSign`, `vertexToGtp` (shared), `ReviewData`, `SessionRecord`, `movesBefore` (`packages/server/src/store/records.ts`).
- Produces (shared): `ProblemSource = 'mistake' | 'unpunished'`; `ProblemCandidate { vertex: MoveVertex; loss: number; pv: MoveVertex[] }`; `ProblemView { source: ProblemSource; corner: Corner; userColor: Color; moves: Move[]; userMove: MoveVertex; userLoss: number; moveNumber: number; group: StartGroup | null }`; `CardListItem.problem: { source: ProblemSource; group: StartGroup | null; moveNumber: number; black: string[]; white: string[] } | null`; `DueCard` with `{ card: { id: string; kind: 'move'; problem: ProblemView } }`. (server) `problemKey(moves: Move[], corner: Corner, toMove: Color): string`, `cornerGroup(moves: Move[], corner: Corner): StartGroup | null`, `zoneStones(moves: Move[], corner: Corner): { black: string[]; white: string[] }`, `ProblemData`, `findProblems(rec: SessionRecord, review: ReviewData): ProblemData[]`; `CardRepo.positionReviewOfSession(sessionId)`.

- [ ] **Step 1: Shared types** — in `packages/shared/src/types.ts`, after `StartCardState`:

```ts
/** Spec (repetition) 4.1: where a «find a good move» problem came from. */
export type ProblemSource = 'mistake' | 'unpunished'

/** A KataGo candidate of the problem position: the points lost against the first one, and its line. */
export interface ProblemCandidate {
  vertex: MoveVertex
  loss: number
  pv: MoveVertex[]
}

/** Spec (repetition) 5.4: what the problem screen shows before the answer (no hint of the best move). */
export interface ProblemView {
  source: ProblemSource
  /** The corner of the training the problem came from; the board is shown as it was. */
  corner: Corner
  userColor: Color
  /** The moves before the problem position, as played (the last one is marked). */
  moves: Move[]
  /** The move played in the training and its loss. */
  userMove: MoveVertex
  userLoss: number
  /** The number of the problem move in that training (1-based, start moves included). */
  moveNumber: number
  group: StartGroup | null
}
```

Change `CardListItem` (add after `orphan`):

```ts
  /** Problem cards: the source, the corner's group, the move number and the zone's stones (top-right, GTP). */
  problem: { source: ProblemSource; group: StartGroup | null; moveNumber: number; black: string[]; white: string[] } | null
```

and `DueCard`:

```ts
export type DueCard =
  | { card: { id: string; kind: 'position'; startId: string; userColor: Color; botRank: string } }
  | { card: { id: string; kind: 'move'; problem: ProblemView } }
  | { card: null; nextDue: string | null }
```

- [ ] **Step 2: Failing tests `packages/server/src/cards/problem.test.ts`**

```ts
import type { Move, ReviewData } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import type { SessionRecord } from '../store/records'
import { cornerGroup, findProblems, problemKey, zoneStones } from './problem'

const mv = (color: 'B' | 'W', x: number, y: number): Move => ({ color, vertex: [x, y] })
// Q16 (the 4-4 point) and O17 in the top-right corner, and the same stones in the bottom-left corner.
const tr: Move[] = [mv('B', 15, 3), mv('W', 13, 2)]
const bl: Move[] = [mv('B', 3, 15), mv('W', 5, 16)]
// The top-right stones mirrored in the corner's diagonal: R16 ↔ Q17 means [16,3] ↔ [15,2]; [13,2] ↔ [16,5].
const trMirrored: Move[] = [mv('B', 15, 3), mv('W', 16, 5)]

describe('problem keys', () => {
  it('is the same for the same position in another corner or mirrored, and differs by the colour to move', () => {
    expect(problemKey(bl, 'BL', 'B')).toBe(problemKey(tr, 'TR', 'B'))
    expect(problemKey(trMirrored, 'TR', 'B')).toBe(problemKey(tr, 'TR', 'B'))
    expect(problemKey(tr, 'TR', 'W')).not.toBe(problemKey(tr, 'TR', 'B'))
    expect(problemKey(tr, 'TR', 'B')).toMatch(/^move:B:/)
  })

  it('names the group by the first stone in the corner', () => {
    expect(cornerGroup(tr, 'TR')).toBe('4-4')
    expect(cornerGroup([mv('B', 16, 3)], 'TR')).toBe('3-4')
    expect(cornerGroup([mv('B', 3, 2)], 'TL')).toBe('3-4')
    expect(cornerGroup([mv('B', 16, 2)], 'TR')).toBe('3-3')
    expect(cornerGroup([mv('B', 15, 4)], 'TR')).toBe('5-4')
    expect(cornerGroup([mv('B', 16, 4)], 'TR')).toBe('5-3')
    expect(cornerGroup([mv('B', 12, 6)], 'TR')).toBeNull()
  })

  it('lists the zone stones seen in the top-right corner, captures applied', () => {
    expect(zoneStones(bl, 'BL')).toEqual({ black: ['Q16'], white: ['O17'] })
  })
})

/** A training of user (Black) moves with the given losses; positions carry one candidate each. */
function training(user: { x: number; y: number; loss: number; category: 'exact' | 'inaccuracy' | 'mistake' | 'blunder' }[]): [SessionRecord, ReviewData] {
  const moves = user.flatMap((u, i) => [
    { color: 'B' as const, vertex: [u.x, u.y] as [number, number], actor: 'user' as const, inZone: true },
    { color: 'W' as const, vertex: [8 + i, 9] as [number, number], actor: 'bot' as const, inZone: true },
  ])
  const settings = { mode: 'free' as const, environment: 'empty' as const, userColor: 'B' as const, botRank: '5k', corner: 'TR' as const }
  const rec = { id: 's1', createdAt: '', finishedAt: '', settings, status: 'finished', parentSessionId: null, initialMoves: [], moves, summary: null } as unknown as SessionRecord
  const review = {
    sessionId: 's1', settings, initialMoves: [], moves,
    positions: Array.from({ length: moves.length + 1 }, (_, turn) => ({ turn, scoreLeadBlack: 0, visits: 10, candidates: [{ vertex: [15, 3], loss: 0, pv: [[15, 3]] }], ownership: null })),
    moveReviews: moves.map((m, turn) => ({ turn, color: m.color, actor: m.actor, vertex: m.vertex, loss: m.actor === 'user' ? user[turn / 2].loss : 0, category: m.actor === 'user' ? user[turn / 2].category : 'exact' })),
    punishments: [], summary: { userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 },
  } as unknown as ReviewData
  return [rec, review]
}

describe('findProblems', () => {
  it('takes the user mistakes and blunders in the zone, with the position before the move', () => {
    const [rec, review] = training([
      { x: 15, y: 3, loss: 0, category: 'exact' },
      { x: 13, y: 2, loss: 2.4, category: 'mistake' },
    ])
    const found = findProblems(rec, review)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ source: 'mistake', userMove: [13, 2], userLoss: 2.4, moveNumber: 3, toMove: 'B' })
    expect(found[0].moves).toHaveLength(2)
    expect(found[0].analysis.candidates[0]).toEqual({ vertex: [15, 3], loss: 0, pv: [[15, 3]] })
  })

  it('takes an unpunished in-zone bot mistake as the position before the reply, once per position', () => {
    const [rec, review] = training([
      { x: 15, y: 3, loss: 0, category: 'exact' },
      { x: 13, y: 2, loss: 3, category: 'mistake' },
    ])
    review.punishments = [{ turn: 1, botLoss: 3, userLoss: 3, punished: false, kept: 0 }]
    const found = findProblems(rec, review)
    expect(found).toHaveLength(1)
    expect(found[0].source).toBe('unpunished')
  })
})
```

(Fix the fixture's coordinates if `toTopRight`'s conventions differ — the tests' intent: one position, four corners, a mirror — must stay. `moveNumber` = initial moves + turn + 1.)

Run: `npx vitest run packages/server/src/cards/problem.test.ts` — FAIL (module not found).

- [ ] **Step 3: `packages/server/src/cards/problem.ts`**

```ts
import { colorSign, Position, vertexToGtp, type Color, type Corner, type Move, type MoveVertex, type ProblemCandidate, type ProblemSource, type ReviewData, type StartGroup, type Vertex } from '@joseki-dojo/shared'
import { mirrorDiagonal, toTopRight } from '../jdb'
import { movesBefore, type SessionRecord } from '../store/records'

/** Spec (repetition) 4.2: everything a problem card needs, independent of the training it came from. */
export interface ProblemData {
  source: ProblemSource
  corner: Corner
  userColor: Color
  toMove: Color
  moves: Move[]
  userMove: MoveVertex
  userLoss: number
  moveNumber: number
  group: StartGroup | null
  /** The review's analysis of the problem position (Black's lead, its visits, the candidates with their losses). */
  analysis: { scoreLeadBlack: number; visits: number; candidates: ProblemCandidate[] }
}

const isVertex = (v: MoveVertex): v is Vertex => v !== 'pass'
const topRight = (moves: readonly Move[], corner: Corner): Move[] => moves.map((m) => (isVertex(m.vertex) ? { ...m, vertex: toTopRight(m.vertex, corner) } : m))

/** Spec (repetition) 4.1: the position seen in the top-right corner, diagonal-canonical, with the colour to move. */
export function problemKey(moves: readonly Move[], corner: Corner, toMove: Color): string {
  const s = Position.fromMoves(topRight(moves, corner)).signMap()
  const read = (mirror: boolean): string => {
    let out = ''
    for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) {
      const [mx, my] = mirror ? mirrorDiagonal([x, y]) : [x, y]
      out += String(s[my][mx] + 1)
    }
    return out
  }
  const plain = read(false)
  const mirrored = read(true)
  return `move:${toMove}:${plain <= mirrored ? plain : mirrored}`
}

const GROUPS: Record<string, StartGroup> = { '4-4': '4-4', '3-4': '3-4', '4-3': '3-4', '3-3': '3-3', '4-5': '5-4', '5-4': '5-4', '3-5': '5-3', '5-3': '5-3' }

/** The group of the corner by its first stone (lines counted from the corner's edges); null for another point. */
export function cornerGroup(moves: readonly Move[], corner: Corner): StartGroup | null {
  const first = topRight(moves, corner).find((m) => isVertex(m.vertex))
  if (!first || !isVertex(first.vertex)) return null
  const fromRight = 19 - first.vertex[0]
  const fromTop = first.vertex[1] + 1
  return GROUPS[`${fromRight}-${fromTop}`] ?? null
}

/** The stones of the corner zone seen in the top-right corner (captures applied), as GTP — for the small board. */
export function zoneStones(moves: readonly Move[], corner: Corner): { black: string[]; white: string[] } {
  const s = Position.fromMoves(topRight(moves, corner)).signMap()
  const black: string[] = []
  const white: string[] = []
  for (let y = 0; y <= 10; y++) for (let x = 8; x <= 18; x++) {
    if (s[y][x] === 1) black.push(vertexToGtp([x, y]))
    else if (s[y][x] === -1) white.push(vertexToGtp([x, y]))
  }
  return { black, white }
}

/** Spec (repetition) 4.2: the problems of a computed review — in-zone user mistakes and unpunished in-zone bot mistakes. */
export function findProblems(rec: SessionRecord, review: ReviewData): ProblemData[] {
  const byTurn = new Map<number, ProblemSource>()
  for (const m of review.moveReviews) {
    if (m.actor === 'user' && review.moves[m.turn]?.inZone && (m.category === 'mistake' || m.category === 'blunder')) byTurn.set(m.turn, 'mistake')
  }
  for (const p of review.punishments) {
    if (!p.punished && review.moves[p.turn]?.inZone && review.moves[p.turn + 1]) byTurn.set(p.turn + 1, 'unpunished')
  }
  const out: ProblemData[] = []
  for (const [turn, source] of [...byTurn].sort((a, b) => a[0] - b[0])) {
    const played = review.moves[turn]
    const position = review.positions[turn]
    if (!played || !position) continue
    const moves = movesBefore(rec, turn)
    out.push({
      source,
      corner: rec.settings.corner,
      userColor: rec.settings.userColor,
      toMove: played.color,
      moves,
      userMove: played.vertex,
      userLoss: review.moveReviews[turn]?.loss ?? 0,
      moveNumber: rec.initialMoves.length + turn + 1,
      group: cornerGroup(moves, rec.settings.corner),
      analysis: { scoreLeadBlack: position.scoreLeadBlack, visits: position.visits, candidates: position.candidates.map((c) => ({ vertex: c.vertex, loss: c.loss, pv: c.pv })) },
    })
  }
  return out
}

/** Spec (repetition) 5.4: the loss of `vertex` judged from the stored candidates; null when it is not among them. */
export function candidateLoss(data: ProblemData, vertex: Vertex): { loss: number; best: boolean } | null {
  const i = data.analysis.candidates.findIndex((c) => c.vertex !== 'pass' && c.vertex[0] === vertex[0] && c.vertex[1] === vertex[1])
  return i < 0 ? null : { loss: data.analysis.candidates[i].loss, best: i === 0 }
}

/** Spec (repetition) 5.4: the loss of a move from the lead after it (Black's view), as the review computes it. */
export const lossAfter = (data: ProblemData, afterLeadBlack: number): number => Math.max(0, colorSign(data.toMove) * (data.analysis.scoreLeadBlack - afterLeadBlack))
```

Run the test — PASS.

- [ ] **Step 4: The repo** — `packages/server/src/cards/repo.ts`, next to `reviewOfSession`:

```ts
  /** Spec (repetition) 5.3: the latest review of a training that belongs to a position card (problem reviews of the same training are not it). */
  positionReviewOfSession(sessionId: string): ReviewRow | null {
    const r = this.db
      .prepare("SELECT r.* FROM card_reviews r JOIN cards c ON c.id = r.card_id WHERE r.session_id = ? AND c.kind = 'position' ORDER BY r.id DESC LIMIT 1")
      .get(sessionId) as RawReview | undefined
    return r ? review(r) : null
  }
```

Test in `repo.test.ts`: a position card and a move card both reviewed with session `s1` → `positionReviewOfSession('s1')` returns the position card's review even when the move card's review is newer.

- [ ] **Step 5: The service** — `packages/server/src/cards/service.ts`:
- `repetitionOf` uses `this.d.repo.positionReviewOfSession(sessionId)` instead of `reviewOfSession`.
- `recordTraining`: keep the position-card part as it is, but move it into a private `recordPosition(rec, review)`; add `recordProblems(rec, review)` and call both (each in its own transaction, the problems after the position):

```ts
  /** Spec (repetition) 4.2: every problem of the training — a new card starts with «Снова», an existing one gets an «again» review once per training. */
  private recordProblems(rec: SessionRecord, review: ReviewData): void {
    for (const p of findProblems(rec, review)) {
      const key = problemKey(p.moves, p.corner, p.toMove)
      this.d.repo.transaction(() => {
        let card = this.d.repo.cardByKey(key)
        if (card?.deleted) return
        if (card && this.d.repo.reviewBySession(card.id, rec.id)) return
        const now = this.now()
        if (!card) {
          const row = { id: this.d.newId?.() ?? randomUUID(), kind: 'move' as const, key, data: { ...p } as unknown as Record<string, unknown>, state: newState(now), createdAt: now.toISOString() }
          this.d.repo.insertCard(row)
          card = { ...row, deleted: false }
        }
        const stateBefore = card.state
        this.d.repo.updateState(card.id, schedule(stateBefore, 'again', now))
        this.d.repo.insertReview({ cardId: card.id, reviewedAt: now.toISOString(), rating: 'again', auto: 'again', worst: null, stateBefore, sessionId: rec.id })
      })
    }
  }
```

- `due()` serves both kinds (drop the `kind === 'position'` filter; `servable()` already drops orphaned position cards); for a move card:

```ts
    if (next.kind === 'move') {
      const p = next.data as unknown as ProblemData
      return { card: { id: next.id, kind: 'move', problem: { source: p.source, corner: p.corner, userColor: p.userColor, moves: p.moves, userMove: p.userMove, userLoss: p.userLoss, moveNumber: p.moveNumber, group: p.group } } }
    }
```

and `nextDue` becomes the earliest due time of all servable cards.
- `list()`: a move card's item has `startId: null`, `moves: []`, and `problem: { source, group, moveNumber, ...zoneStones(p.moves, p.corner) }`; a position card's item has `problem: null`.

- [ ] **Step 6: Service tests** (`service.test.ts`) — with a training fixture that has filled `positions` (reuse the shape of `problem.test.ts`'s `training`):
- a mistake creates one move card, due within minutes, listed with `problem.source === 'mistake'` and `moveNumber`; the same training recorded again adds nothing; a second training with the same position adds one «again» review to the same card;
- the same position in another corner (corner `BL`, stones moved accordingly) repeats the same card;
- a deleted problem card does not come back;
- `repetitionOf` of a training that made both a position card and a problem card returns the position card;
- `due()` returns `{ card: { kind: 'move', problem: … } }` for a due move card (with `problem.moves`, no candidates in the view).

- [ ] **Step 7: Run** `npm test && npm run typecheck` — PASS (fix the web's compile errors caused by the new `CardListItem.problem` field and the `DueCard` union in `packages/web/src` minimally: `startNextCard` handles only `kind === 'position'` until Task 4 — treat a move card as nothing due for now; the list ignores `problem` until Task 3). **Commit:**

```bash
git add packages/shared packages/server packages/web
git commit -m "feat(cards): problem cards from mistakes and unpunished bot mistakes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Judging an answer — `POST /api/cards/:id/answer`

**Files:**
- Modify: `packages/shared/src/types.ts`, `packages/server/src/cards/service.ts`, `packages/server/src/cards/service.test.ts`, `packages/server/src/api/cards-routes.ts`, `packages/server/src/app.ts`, `packages/server/src/api/api.test.ts`

**Interfaces:**
- Consumes: `ProblemData`, `candidateLoss`, `lossAfter` (Task 1); `categorize` (`packages/server/src/review/compute.ts`); `thresholdsFor` (`packages/server/src/review/thresholds.ts`); `baseQuery` (`packages/server/src/engine/query.ts`); `AnalysisEngine`, `EngineError`; `HealthMonitor.get()`.
- Produces: shared `ProblemAnswer { vertex: Vertex; loss: number; category: Category; best: boolean; line: ProblemCandidate; repetition: RepetitionInfo }`; `CardServiceDeps.judge?: { analyze: (q: KataGoQueryBody) => Promise<AnalysisResponse>; ready: () => boolean; thresholds: () => Thresholds; visits: () => number }`; `CardService.answer(cardId: string, vertex: Vertex): Promise<ProblemAnswer>`; `CardError` codes `wrong_kind` (409), `illegal_move` (400), `engine_unavailable` (503); route `POST /api/cards/:id/answer` with body `{ vertex: [x, y] }`.

- [ ] **Step 1: Shared type**

```ts
/** Spec (repetition) 5.4: the verdict on a problem answer. */
export interface ProblemAnswer {
  vertex: Vertex
  loss: number
  category: Category
  /** The answer is KataGo's first candidate. */
  best: boolean
  /** KataGo's first candidate of the position, with its line. */
  line: ProblemCandidate
  repetition: RepetitionInfo
}
```

- [ ] **Step 2: Failing tests** (`service.test.ts`, a `judge` stub: `analyze` returns `{ rootInfo: { scoreLead: lead } }` for the position after the move; `ready: () => true`; `thresholds: () => DEFAULT_CONFIG.thresholds`; `visits: () => 10`):
- the stored best candidate → `{ best: true, loss: 0, category: 'exact' }`, auto `easy`, no engine query;
- a stored second candidate with loss 0.8 → `inaccuracy`, auto `hard`, no engine query;
- a point not among the candidates → one query (`maxVisits` 10, the setup moves plus the answer), loss from the lead after (Black to move, root lead 0, lead after −2.5 → loss 2.5 → `mistake`, auto `again`);
- an occupied point → `CardError('illegal_move')`; a position card → `wrong_kind`; `ready: () => false` → `engine_unavailable` and no review recorded; `analyze` rejecting with an `EngineError` → `engine_unavailable`;
- the answer is a card review (`repetition.reviewId`, `editable: true`), re-ratable with `rate`.

- [ ] **Step 3: `answer`** in `CardService`:

```ts
  /** Spec (repetition) 5.4: judge a problem answer and record it as the card's review. */
  async answer(cardId: string, vertex: Vertex): Promise<ProblemAnswer> {
    const card = this.d.repo.card(cardId)
    if (!card || card.deleted) throw new CardError('card_not_found')
    if (card.kind !== 'move') throw new CardError('wrong_kind')
    const p = card.data as unknown as ProblemData
    if (!Position.fromMoves(p.moves).isLegal(p.toMove, vertex)) throw new CardError('illegal_move')
    const judge = this.d.judge
    let judged = candidateLoss(p, vertex)
    if (!judged) {
      if (!judge || !judge.ready()) throw new CardError('engine_unavailable')
      try {
        const after = await judge.analyze({ ...baseQuery([...p.moves, { color: p.toMove, vertex }]), maxVisits: judge.visits() })
        judged = { loss: lossAfter(p, after.rootInfo.scoreLead), best: false }
      } catch (err) {
        if (err instanceof EngineError) throw new CardError('engine_unavailable')
        throw err
      }
    }
    const thresholds = judge?.thresholds() ?? DEFAULT_CONFIG.thresholds
    const category = categorize(judged.loss, thresholds)
    const auto: Rating = judged.best ? 'easy' : category === 'exact' ? 'good' : category === 'inaccuracy' ? 'hard' : 'again'
    const now = this.now()
    const fresh = this.d.repo.card(cardId)!
    const stateBefore = fresh.state
    const state = schedule(stateBefore, auto, now)
    const reviewId = this.d.repo.transaction(() => {
      this.d.repo.updateState(cardId, state)
      return this.d.repo.insertReview({ cardId, reviewedAt: now.toISOString(), rating: auto, auto, worst: category === 'exact' ? null : { category, loss: judged!.loss }, stateBefore, sessionId: null })
    })
    const row = this.d.repo.review(reviewId)!
    return { vertex, loss: judged.loss, category, best: judged.best, line: p.analysis.candidates[0], repetition: this.info(row, { ...fresh, state }) }
  }
```

(`CardError` gains the three codes. Imports: `Position`, `Vertex`, `ProblemAnswer` from shared; `baseQuery`; `EngineError`; `categorize`; `DEFAULT_CONFIG`.)

- [ ] **Step 4: Wiring** — `app.ts`: create `health` before `cards` (move the `HealthMonitor` line up) and pass

```ts
    judge: {
      analyze: (q) => engine.analyze(q),
      ready: () => health.get().state === 'ready',
      thresholds: () => thresholdsFor(config.player.level, options.thresholds ?? null, config.thresholds),
      visits: () => config.analysis.reviewVisits,
    },
```

`cards-routes.ts`: `STATUS` gains `wrong_kind: 409, illegal_move: 400, engine_unavailable: 503`, and

```ts
  app.post<{ Params: { id: string }; Body: { vertex?: unknown } }>('/api/cards/:id/answer', async (req, reply) => {
    const v = req.body?.vertex
    if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isInteger(n) && n >= 0 && n < 19)) return reply.code(400).send({ error: 'bad_vertex' })
    try {
      return await cards.answer(req.params.id, [v[0], v[1]])
    } catch (err) {
      return failed(err, reply)
    }
  })
```

API test: seed a move card through a real training is not possible with the fake engine (every move exact) — insert one directly through `services.cards`' repo in the test (or record a hand-made review through `recordTraining`), then `POST` an answer at the fake's best point and at another point (the fake engine answers with lead 0 → loss 0 → `exact`); a bad body → 400; an unknown id → 404.

- [ ] **Step 5: Run** `npm test && npm run typecheck` — PASS. **Commit:**

```bash
git add packages/shared packages/server
git commit -m "feat(cards): judge a problem answer with KataGo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Problems in the «Повторение» tab — summary, filter, rows

**Files:**
- Modify: `packages/web/src/components/CornerBoard.tsx`, `packages/web/src/screens/RepetitionScreen.tsx`, the repetition stylesheet, the six catalogs

**Interfaces:**
- Consumes: `CardListItem.problem`, `CardSummary.dueByKind.move` (Task 1).
- Produces: `CornerBoardProps.stones?: { black: string[]; white: string[] }` (drawn instead of `moves` when given; no move numbers, no last-move mark).

- [ ] **Step 1: Catalog keys** (ru; all six catalogs, plural forms as each language needs):

```ts
  'repetition.lead': 'Позиции из дерева и задачи из ваших ошибок возвращаются к повторению по расписанию: чем увереннее вы их решаете, тем реже.',
  'repetition.empty': 'Карточек пока нет. Сыграйте позицию из дерева «Из списка» или любую тренировку — после разбора позиция и ваши ошибки попадут сюда.',
  'repetition.dueProblems': { one: 'задач: {count}', few: 'задач: {count}', many: 'задач: {count}', other: 'задач: {count}' },
  'repetition.filter': 'Показать',
  'repetition.filter.all': 'Все',
  'repetition.filter.position': 'Позиции',
  'repetition.filter.move': 'Задачи',
  'repetition.kind.mistake': 'Ваша ошибка',
  'repetition.kind.unpunished': 'Ненаказанная ошибка соперника',
  'repetition.problemMove': 'ход {n}',
```

(`repetition.lead` and `repetition.empty` replace the existing texts in all six catalogs.)

- [ ] **Step 2: `CornerBoard` stones** — a new optional prop `stones?: { black: string[]; white: string[] }`; when present, the board draws those stones (GTP in the top-right zone, the same coordinates as `moves`) and ignores `moves`, `ghost` and `lastMove`.

- [ ] **Step 3: `RepetitionScreen`**
- The «Пора повторить» metric shows, when due, `repetition.dueKinds` (positions) and `repetition.dueProblems` (problems), each only when its count is above zero, joined by « · ».
- Above the list a segmented filter («Все / Позиции / Задачи», `role="radiogroup"` with `aria-label` = `repetition.filter`), kept in component state, default «Все»; the list is filtered on the client (`c.kind`).
- A problem row: `<CornerBoard stones={c.problem} />`; the title is `t('repetition.kind.<source>')`, then ` · <group>` when `group` is set, then ` · ` + `t('repetition.problemMove', { n: moveNumber })`; the rest of the row (stage, due, last rating, «Удалить») as for positions; the delete button's accessible name uses that title.

- [ ] **Step 4: Run** `npm test && npm run typecheck` — PASS. **Commit:**

```bash
git add packages/web packages/shared
git commit -m "feat(cards): problems in the «Повторение» tab: summary, filter, rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The problem screen and problems in the queue

**Files:**
- Create: `packages/web/src/components/RepetitionPanel.tsx` (moved out of `ReviewScreen.tsx`), `packages/web/src/screens/ProblemScreen.tsx`
- Modify: `packages/web/src/screens/ReviewScreen.tsx`, `packages/web/src/App.tsx`, `packages/web/src/api.ts`, the stylesheet, the six catalogs

**Interfaces:**
- Consumes: `POST /api/cards/:id/answer` (Task 2: 200 `ProblemAnswer`, 400 `illegal_move`/`bad_vertex`, 404, 409 `wrong_kind`, 503 `engine_unavailable`); `DueCard` move variant, `ProblemView` (Task 1); `Board` (`packages/web/src/components/Board.tsx`: `signMap`, `corner`, `markers`, `busy`, `onClick`); `pvMoves(first, pv, count)` and `emptyMap` (`packages/web/src/board-maps.ts`); `rateReview`; `RepetitionPanel` props as it has in `ReviewScreen.tsx` now.
- Produces: `answerProblem(cardId: string, vertex: Vertex): Promise<ProblemAnswer | 'unavailable'>` (503 → `'unavailable'`, other failures throw `failed('error.api.answer', res)`); `RepetitionPanel` component (same props as now) used by the review and the problem screen; `ProblemScreen` props `{ problem: ProblemView; answer: ProblemAnswer | null; judging: boolean; unavailable: boolean; onAnswer: (v: Vertex) => void; repetition: { onRate: (r: Rating) => void; queue: { onNext: () => void; onFinish: () => void } | null; error: string | null }; busy: boolean }`.

- [ ] **Step 1: Catalog keys** (ru; all six):

```ts
  'problem.title': 'Найдите хороший ход',
  'problem.source.mistake': 'В партии вы здесь ошиблись',
  'problem.source.unpunished': 'Соперник здесь ошибся — накажите',
  'problem.move': 'Ход {n}',
  'problem.yourColor': 'Ваш цвет: {color}',
  'problem.judging': 'KataGo оценивает ход…',
  'problem.unavailable': 'Оценка недоступна: KataGo не готов. Повторение не засчитано.',
  'problem.best': 'Это лучший ход KataGo',
  'problem.verdict': '{category}, −{loss}',
  'problem.kataGoBest': 'Лучший ход KataGo: {move}',
  'problem.inGame': 'В партии: {move}, −{loss}',
  'problem.showLine': 'Показать вариант',
  'problem.hideLine': 'Скрыть вариант',
  'problem.lineStep': 'Ход варианта {step} из {total}',
  'problem.illegal': 'Сюда ходить нельзя',
  'app.crumb.problem': 'Повторение · задача',
  'error.api.answer': 'Не удалось оценить ответ: HTTP {status}',
```

(`{color}` takes the existing colour label helper; `{category}` the `category.*` label; `{loss}` through `formatPoints`.)

- [ ] **Step 2: `RepetitionPanel`** — move the panel component and its props type from `ReviewScreen.tsx` into `packages/web/src/components/RepetitionPanel.tsx` unchanged (export both); `ReviewScreen` imports it. No behaviour change.

- [ ] **Step 3: `answerProblem`** in `packages/web/src/api.ts`:

```ts
export async function answerProblem(cardId: string, vertex: Vertex): Promise<ProblemAnswer | 'unavailable'> {
  const res = await request(`/api/cards/${encodeURIComponent(cardId)}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vertex }) })
  if (res.status === 503) return 'unavailable'
  if (!res.ok) throw failed('error.api.answer', res)
  return (await res.json()) as ProblemAnswer
}
```

- [ ] **Step 4: `ProblemScreen`** — layout like the review: the board on the left, an aside on the right.
- Board: `signMap` of `Position.fromMoves(problem.moves)`, `corner = problem.corner`, the last setup move marked (`{ type: 'point' }`); before the answer a click calls `onAnswer(v)` when `Position.isLegal(toMove, v)` (toMove = the colour after the last setup move), else a short `problem.illegal` hint; `busy` while `judging`.
- After the answer: the answer stone is on the board (the setup plus the answer), marked with a circle; KataGo's first candidate marked with a triangle when it differs from the answer; for source `mistake`, the training's move `problem.userMove` marked with a cross. «Показать вариант» shows `pvMoves(toMove, answer.line.pv, step)` on the setup position (stepping ‹ / › with `problem.lineStep`, as the review's branch does), «Скрыть вариант» returns to the answer.
- Aside: `<h1>` `problem.title`; a line `problem.source.<source>`; `problem.move` and the group when known; `problem.yourColor`. After the answer: `problem.best` when `answer.best`, else `problem.verdict`; `problem.kataGoBest` with the GTP of `answer.line.vertex`; for `mistake` `problem.inGame`; then `<RepetitionPanel info={answer.repetition} … />` with the queue buttons. While judging `problem.judging`; when unavailable `problem.unavailable` and the queue buttons only.

- [ ] **Step 5: App** — `packages/web/src/App.tsx`:
- state `problem: { id: string; view: ProblemView } | null`, `problemAnswer: ProblemAnswer | null`, `judging: boolean`, `problemUnavailable: boolean`;
- `startNextCard`: for `due.card.kind === 'move'`: `setStarting(false)`, `resetToStart()`, `setQueue(true)`, `setQueueDone(false)`, set `problem` (and clear the answer state), `setSection('repetition')`;
- in the `section === 'repetition'` branch: when `problem` is set, crumb `app.crumb.problem` and `<ProblemScreen …/>`; else the tab as now;
- `onAnswer`: `setJudging(true)`, `answerProblem(problem.id, v)` → `'unavailable'` sets `problemUnavailable`; an answer sets `problemAnswer` and bumps `cardsTick`; errors go to the app error banner; `setJudging(false)` at the end;
- the panel's `onRate`: the same sequencing as the review's rating (`rateReview` with the answer's `reviewId`, a 409 → locked), updating `problemAnswer.repetition`;
- queue: `onNext = startNextCard` (it clears the problem first), `onFinish` clears `problem`, `queue` and returns to the tab;
- switching to another section clears `problem` and `queue`.

- [ ] **Step 6: Run** `npm test && npm run typecheck` — PASS. **Commit:**

```bash
git add packages/web packages/shared
git commit -m "feat(cards): the problem screen and problems in the queue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: A mistake in e2e, the problem flow end to end, README

**Files:**
- Modify: `packages/server/test/fake-katago.mjs`
- Create: `e2e/problems-server.ts`, `e2e/problems.spec.ts`
- Modify: `playwright.config.ts`, `README.md`

**Interfaces:**
- Produces: the fake KataGo switch `FAKE_KATAGO_PENALTY="<GTP>:<points>"` — every query's lead (Black's view, root and candidates) is `−points` per black stone and `+points` per white stone on that point; nothing else changes. A second e2e server on port 5184 (its own data dir and config copy, the switch set to `N13:3`), a Playwright project `problems` for `e2e/problems.spec.ts` only; the `chromium` project ignores that spec.

- [ ] **Step 1: The switch** — in `fake-katago.mjs`, read `FAKE_KATAGO_PENALTY` once; in `answer()`, compute the lead from `query.moves` (`[color, gtp]` pairs): `lead = Σ (color === 'B' ? −points : +points)` over moves on the penalty point (captures are not simulated, as elsewhere in the fake); use it for `rootInfo.scoreLead` and every `moveInfos[*].scoreLead`. Without the variable the behaviour is unchanged (score 0).

- [ ] **Step 2: The server** — `e2e/problems-server.ts` modelled on `e2e/languages-server.ts` (its own data folder under `e2e/`, wiped at start; a config copy with the fake KataGo and `"ui": { "language": "ru" }`; the test starts and traps as the main server; `FAKE_KATAGO_PENALTY=N13:3` in the environment of the KataGo process; port 5184; `JOSEKI_THRESHOLDS` empty). `playwright.config.ts`: a webServer entry for it and a project `problems` with `testMatch: /problems\.spec\.ts/` and `baseURL: 'http://127.0.0.1:5184'`; the `chromium` project gets `testIgnore` for that spec too (next to the languages one). Keep every tracked file unchanged by a run.

- [ ] **Step 3: `e2e/problems.spec.ts`** — one test (timeout 150 s, as the queue test):
1. a free training (Чёрные, Правый верхний); the user plays N13 (`vertex(page, 12, 6)`) — a 3-point loss, a mistake by the default thresholds — and finishes;
2. «Повторение»: the filter «Задачи» shows one row titled «Ваша ошибка · … · ход 1»;
3. wait until «Начать повторение» is enabled (the «Снова» card is due after its 1-minute step), start: the problem screen shows «Найдите хороший ход» and «В партии вы здесь ошиблись»;
4. answer at Q16 (`vertex(page, 15, 3)`): the verdict shows the category «точно» (the fake's lead without the penalty stone is 0) and the panel shows a pressed rating; «Показать вариант» toggles;
5. «Закончить повторение» returns to the tab; the problem row shows a later due time.

- [ ] **Step 4: README** — the user paragraph on «Повторение» adds the problems: where they come from (your in-zone mistakes and the bot's in-zone mistakes you did not punish, in any mode), one click to answer, KataGo's verdict and best line, the automatic rating; and the card list filter.

- [ ] **Step 5: Run** `npm test && npm run typecheck && npm run e2e`, then `git status --short` (clean tree after the run). **Commit:**

```bash
git add packages/server/test/fake-katago.mjs e2e playwright.config.ts README.md
git commit -m "test(cards): a mistake in the fake KataGo and the problem flow end to end; README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
