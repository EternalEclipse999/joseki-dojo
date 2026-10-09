# Bot Stays in the Corner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bot plays the joseki out in the corner (local moves only, tenuki only when the corner is settled or as a rare mistake), and the end proposal follows the bot's tenuki instead of KataGo's whole-board best move.

**Architecture:** `chooseBotMove` (server/bot) gets a local area around the stones in the zone and a three-band tenuki rule. `SessionService.commit` proposes the end after a bot move outside the zone. The pass probe and the KataGo-based end rule are removed. Design: `docs/superpowers/specs/2026-10-09-bot-stays-in-corner-design.md`.

**Tech Stack:** TypeScript, Node ≥ 22, vitest, Playwright, Preact.

## Global Constraints

- Constants, exact names and values: `SETTLED_SHARE = 0.6`, `CALM_SHARE = 0.2`, `MISTAKE_TENUKI_RATE = 0.05`, `LOCAL_RADIUS = 4` (Chebyshev distance).
- Tenuki share `s = p_out / (p_in + p_out)`: `p_in` = human policy over legal zone points, `p_out` = over legal points outside the zone plus pass.
- Before the joseki starts the bot never tenukis (unless the zone has no legal point).
- Local area: legal zone points within Chebyshev distance ≤ 4 of any stone in the zone; with no stone in the zone, of the corner's 4-4 point (TL `[3,3]`, TR `[15,3]`, BL `[3,15]`, BR `[15,15]`); with no legal point in the local area, the whole zone.
- End proposal text: «Бот сыграл в другом месте.» — the same for a settled corner and a mistake. Buttons unchanged: «К разбору», «Играть дальше».
- Settings label for `analysis.endVisits`: «Визиты для кнопки «Тэнуки»». The config key `endVisits` stays (old config files load unchanged).
- User-facing text is Russian; code, identifiers, comments and commit messages are English.
- Commits use the repository's configured noreply address; one commit per task.

---

### Task 1: Local bot move choice

**Files:**
- Modify: `packages/server/src/bot/choose.ts` (whole file)
- Modify: `packages/server/src/bot/choose.test.ts` (whole file)

**Interfaces:**
- Consumes: `@joseki-dojo/shared` — `indexToVertex`, `inZone`, `PASS_INDEX`, `zoneVertices`, `Position.colorAt(v): 'B' | 'W' | null`, `Position.isLegal`.
- Produces: `chooseBotMove(input: BotChoiceInput, rng: Rng): BotChoice` — same signature and types as today; exported constants `SETTLED_SHARE`, `CALM_SHARE`, `MISTAKE_TENUKI_RATE`, `LOCAL_RADIUS`.

- [ ] **Step 1: Replace the tests** — write `packages/server/src/bot/choose.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { gtpToVertex, PASS_INDEX, Position, vertexToIndex, zoneVertices, type Vertex } from '@joseki-dojo/shared'
import { chooseBotMove, LOCAL_RADIUS, type BotChoiceInput } from './choose'
import { mulberry32, type Rng } from './rng'

const policy = (entries: Record<string, number>, pass = 0): number[] => {
  const p = new Array<number>(362).fill(0)
  for (const [gtp, value] of Object.entries(entries)) p[vertexToIndex(gtpToVertex(gtp) as Vertex)] = value
  p[PASS_INDEX] = pass
  return p
}

const seq = (...values: number[]): Rng => {
  let i = 0
  return () => values[i++ % values.length]
}

const input = (humanPolicy: number[], over: Partial<BotChoiceInput> = {}): BotChoiceInput => ({
  humanPolicy,
  position: Position.empty(),
  color: 'W',
  corner: 'TR',
  josekiStarted: true,
  temperature: 1,
  ...over,
})

const Q16: Vertex = [15, 3] // the top-right 4-4 point
const R16: Vertex = [16, 3]
const R17: Vertex = [16, 2]
const K10: Vertex = [9, 9] // inside the top-right zone, far from its corner
const D4: Vertex = [3, 15]
const D16: Vertex = [3, 3]
const nearQ16 = (v: Vertex): boolean => Math.max(Math.abs(v[0] - 15), Math.abs(v[1] - 3)) <= LOCAL_RADIUS

describe('chooseBotMove', () => {
  it('plays in the zone before the joseki starts even if most mass is outside', () => {
    const c = chooseBotMove(input(policy({ Q16: 0.1, D4: 0.9 }), { josekiStarted: false }), seq(0.5))
    expect(c).toEqual({ kind: 'zone', vertex: Q16 })
  })

  it('leaves a settled corner whatever the draw', () => {
    expect(chooseBotMove(input(policy({ Q16: 0.25, D4: 0.75 })), seq(0.99))).toEqual({ kind: 'tenuki', vertex: D4 })
  })

  it('leaves a calm corner only on a rare draw', () => {
    const p = policy({ Q16: 0.5, D4: 0.5 })
    expect(chooseBotMove(input(p), seq(0.04))).toEqual({ kind: 'tenuki', vertex: D4 })
    expect(chooseBotMove(input(p), seq(0.06, 0))).toEqual({ kind: 'zone', vertex: Q16 })
  })

  it('never leaves a sharp corner', () => {
    expect(chooseBotMove(input(policy({ Q16: 0.9, D4: 0.1 })), seq(0))).toEqual({ kind: 'zone', vertex: Q16 })
  })

  it('makes the premature tenuki about 5% of the time in a calm corner', () => {
    const rng = mulberry32(42)
    const p = policy({ Q16: 0.5, D4: 0.5 })
    let tenuki = 0
    for (let i = 0; i < 2_000; i++) if (chooseBotMove(input(p), rng).kind === 'tenuki') tenuki++
    expect(tenuki / 2_000).toBeGreaterThan(0.035)
    expect(tenuki / 2_000).toBeLessThan(0.065)
  })

  it('tenukis to the strongest outside point, never to pass', () => {
    const c = chooseBotMove(input(policy({ Q16: 0.1, D4: 0.3, D16: 0.4 }, 0.2)), seq(0))
    expect(c).toEqual({ kind: 'tenuki', vertex: D16 })
  })

  it('keeps zone moves near the stones in the zone', () => {
    const position = Position.fromMoves([{ color: 'B', vertex: Q16 }])
    const c = chooseBotMove(input(policy({ K10: 0.9, R17: 0.1 }), { position, josekiStarted: false }), seq(0))
    expect(c).toEqual({ kind: 'zone', vertex: R17 })
  })

  it('measures the local area from the 4-4 point when the zone is empty', () => {
    const c = chooseBotMove(input(policy({ K10: 0.9, R17: 0.1 }), { josekiStarted: false }), seq(0))
    expect(c).toEqual({ kind: 'zone', vertex: R17 })
  })

  it('falls back to the whole zone when the local area has no legal point', () => {
    const p = policy({ K10: 0.5, D4: 0.5 })
    for (const v of zoneVertices('TR')) if (nearQ16(v)) p[vertexToIndex(v)] = -1
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0))).toEqual({ kind: 'zone', vertex: K10 })
  })

  it('samples zone points in proportion to the policy', () => {
    const p = policy({ Q16: 0.25, R16: 0.75 })
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.2))).toEqual({ kind: 'zone', vertex: Q16 })
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.3))).toEqual({ kind: 'zone', vertex: R16 })
  })

  it('skips occupied and KataGo-illegal points', () => {
    const position = Position.fromMoves([{ color: 'B', vertex: Q16 }])
    const c = chooseBotMove(input(policy({ Q16: 0.9, R16: 0.1, R17: -1 }), { position, josekiStarted: false }), seq(0.1))
    expect(c).toEqual({ kind: 'zone', vertex: R16 })
  })

  it('tenukis when the zone has no playable point and passes when nothing is playable', () => {
    const p = policy({ D4: 0.5 })
    for (const v of zoneVertices('TR')) p[vertexToIndex(v)] = -1
    expect(chooseBotMove(input(p, { josekiStarted: false }), seq(0.5))).toEqual({ kind: 'tenuki', vertex: D4 })
    const nothing = new Array<number>(362).fill(-1)
    nothing[PASS_INDEX] = 1
    expect(chooseBotMove(input(nothing), seq(0.5))).toEqual({ kind: 'pass' })
  })

  it('sharpens the distribution with a lower temperature', () => {
    const p = policy({ Q16: 0.2, R16: 0.8 })
    expect(chooseBotMove(input(p, { josekiStarted: false, temperature: 1 }), seq(0.1))).toEqual({ kind: 'zone', vertex: Q16 })
    expect(chooseBotMove(input(p, { josekiStarted: false, temperature: 0.5 }), seq(0.1))).toEqual({ kind: 'zone', vertex: R16 })
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run packages/server/src/bot/choose.test.ts`
Expected: FAIL — `LOCAL_RADIUS` is not exported; the settled/calm/sharp and local-area tests fail.

- [ ] **Step 3: Write the implementation** — replace `packages/server/src/bot/choose.ts`:

```ts
import { indexToVertex, inZone, PASS_INDEX, zoneVertices, type Color, type Corner, type Position, type Vertex } from '@joseki-dojo/shared'
import type { Rng } from './rng'

/** At this share of the policy outside the zone the corner is settled: the bot plays elsewhere. */
export const SETTLED_SHARE = 0.6
/** Below this share the position is sharp: the bot always answers in the corner. */
export const CALM_SHARE = 0.2
/** In a calm corner that is not settled the bot leaves this often: a mistake for the player to punish. */
export const MISTAKE_TENUKI_RATE = 0.05
/** Zone moves stay within this Chebyshev distance of the stones already in the zone. */
export const LOCAL_RADIUS = 4

/** The 4-4 point of each corner: the local area's centre while the zone is still empty. */
const CORNER_4_4: Record<Corner, Vertex> = { TL: [3, 3], TR: [15, 3], BL: [3, 15], BR: [15, 15] }

export interface BotChoiceInput {
  /** KataGo humanPolicy: 362 values, -1 for illegal points, the last one is pass. */
  humanPolicy: readonly number[]
  position: Position
  color: Color
  corner: Corner
  josekiStarted: boolean
  temperature: number
}

export type BotChoice = { kind: 'zone'; vertex: Vertex } | { kind: 'tenuki'; vertex: Vertex } | { kind: 'pass' }

interface Entry {
  vertex: Vertex
  p: number
}

/**
 * Spec 8.4 (revised 2026-10-09): the share of the human policy outside the zone decides whether the bot leaves the
 * corner — always when it is settled, rarely (a mistake) when it is calm, never when it is sharp or the joseki has not
 * started. Zone moves are sampled from policy^(1/temperature) over the local area around the stones in the zone.
 */
export function chooseBotMove(input: BotChoiceInput, rng: Rng): BotChoice {
  const zone: Entry[] = []
  const outside: Entry[] = []
  for (let i = 0; i < PASS_INDEX; i++) {
    const p = input.humanPolicy[i] ?? 0
    if (p < 0) continue
    const vertex = indexToVertex(i) as Vertex
    if (!input.position.isLegal(input.color, vertex)) continue
    ;(inZone(input.corner, vertex) ? zone : outside).push({ vertex, p })
  }
  const passMass = Math.max(0, input.humanPolicy[PASS_INDEX] ?? 0)
  const pIn = zone.reduce((s, e) => s + e.p, 0)
  const pOut = outside.reduce((s, e) => s + e.p, 0) + passMass

  const tenuki = (): BotChoice => {
    const best = outside.reduce<Entry | null>((b, e) => (b === null || e.p > b.p ? e : b), null)
    return best ? { kind: 'tenuki', vertex: best.vertex } : { kind: 'pass' }
  }

  if (zone.length === 0) return tenuki()
  if (input.josekiStarted && pIn + pOut > 0) {
    const share = pOut / (pIn + pOut)
    if (share >= SETTLED_SHARE) return tenuki()
    if (share >= CALM_SHARE && rng() < MISTAKE_TENUKI_RATE) return tenuki()
  }
  const anchors = localAnchors(input.position, input.corner)
  const local = zone.filter((e) => anchors.some((a) => chebyshev(a, e.vertex) <= LOCAL_RADIUS))
  return { kind: 'zone', vertex: sample(local.length > 0 ? local : zone, input.temperature, rng) }
}

/** The stones in the zone, or the corner's 4-4 point while the zone is empty. */
function localAnchors(position: Position, corner: Corner): Vertex[] {
  const stones = zoneVertices(corner).filter((v) => position.colorAt(v) !== null)
  return stones.length > 0 ? stones : [CORNER_4_4[corner]]
}

const chebyshev = (a: Vertex, b: Vertex): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))

function sample(entries: Entry[], temperature: number, rng: Rng): Vertex {
  const weights = entries.map((e) => (e.p > 0 ? Math.pow(e.p, 1 / temperature) : 0))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total === 0) return entries[Math.floor(rng() * entries.length)].vertex
  let r = rng() * total
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i]
    if (r < 0) return entries[i].vertex
  }
  return entries[entries.length - 1].vertex
}
```

- [ ] **Step 4: Run the bot tests, then the whole suite and the type check**

Run: `npx vitest run packages/server/src/bot` → PASS.
Run: `npm test` and `npm run typecheck`. Other suites use the uniform stub policy with a seeded RNG; if a test elsewhere relied on the old tenuki probability, fix that test's setup (not the rule) and mention it in the report.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bot/choose.ts packages/server/src/bot/choose.test.ts
git commit -m "feat(bot): keep the bot in the corner: local moves, tenuki only when settled or as a rare mistake"
```

---

### Task 2: End proposal after the bot's tenuki; remove the pass probe

**Files:**
- Modify: `packages/server/src/session/service.ts` (`commit`, `scheduleAnalysis`, imports)
- Rename: `packages/server/src/session/end-detection.ts` → `packages/server/src/session/joseki-start.ts` (keep only `josekiStartedIn`); `end-detection.test.ts` → `joseki-start.test.ts` (keep only the `josekiStartedIn` tests); update the import in `session.ts`
- Modify: `packages/server/src/analysis/scheduler.ts` (drop `passProbe` and the `pass_probe` branch), `scheduler.test.ts` (drop the pass-probe test)
- Modify: `packages/server/src/store/records.ts` (`AnalysisKind = 'position'`, comment that `migrations.ts` still allows `pass_probe` rows left by v0.1.0), `repo.test.ts` (drop the `pass_probe` lookup)
- Modify: `packages/server/test/helpers.ts` (drop `isPassProbe`; add a `human` hook to `StubEngine`)
- Modify: `packages/server/src/session/service.test.ts`, `packages/server/src/api/api.test.ts`, `e2e/game.spec.ts`
- Modify: `packages/web/src/screens/GameScreen.tsx` (proposal text), `packages/web/src/screens/SettingsScreen.tsx` (`endVisits` label)
- Modify: `README.md` (`endVisits` row), `scripts/setup/setup.ts` (the line printing `endVisits`), and any comment that still describes `endVisits` or the analysis scheduler as an end-of-joseki check (`grep -rn "end-of-joseki\|проверк. конца\|pass probe\|pass_probe" packages scripts README.md`)

**Interfaces:**
- Consumes: Task 1's `chooseBotMove` (unchanged signature); `Session.canProposeEnd()`, `Session.proposeEnd()`, `PlayedMove.inZone`.
- Produces: `StubEngine.human: ((q: KataGoQueryBody) => number[]) | null` (default `null` = the uniform policy as today); `stubResponse(q, best, lead, human?: number[])`.

- [ ] **Step 1: `StubEngine` hook** in `packages/server/test/helpers.ts`: add the field `human: ((q: KataGoQueryBody) => number[]) | null = null`, call `stubResponse(q, this.best(q), this.lead(q), this.human?.(q))`, give `stubResponse` a fourth parameter `human?: number[]` and set `res.humanPolicy = human ?? [...policy]` for human queries. Delete `isPassProbe`.

- [ ] **Step 2: Rewrite the end-proposal tests** in `packages/server/src/session/service.test.ts`. Replace the three tests «proposes the end when both analyses point outside the zone», «does not propose the end while the best move stays in the zone», «proposes again only two moves after «Играть дальше»» with the tests below, and add the helper next to `freeZonePoint` (import `vertexToIndex` from `@joseki-dojo/shared` and the type `KataGoQueryBody` from `../engine/katago-types`; drop `isPassProbe` from the imports):

```ts
/** Human policy for the top-right corner: `out` of the mass on D4 (outside the zone), the rest spread over the zone. */
function cornerPolicy(q: KataGoQueryBody, out: number): number[] {
  const taken = new Set<number>()
  for (const [, gtp] of q.moves) {
    const v = gtpToVertex(gtp)
    if (v !== 'pass') taken.add(vertexToIndex(v))
  }
  const free = zoneVertices('TR').map(vertexToIndex).filter((i) => !taken.has(i))
  const p = new Array<number>(362).fill(0)
  for (const i of taken) p[i] = -1
  for (const i of free) p[i] = (1 - out) / free.length
  p[vertexToIndex([3, 15])] = out
  return p
}
```

```ts
  it('proposes the end when the bot leaves the corner', async () => {
    const { service, engine } = setup()
    engine.human = (q) => cornerPolicy(q, 0.9)
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(2))
    expect(service.view(v.id).endProposed).toBe(false) // the joseki had not started: the bot answered in the corner
    service.playUserMove(v.id, freeZonePoint(service.view(v.id)))
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(4))
    expect(service.view(v.id).moves[3]).toMatchObject({ actor: 'bot', inZone: false })
    expect(service.view(v.id).endProposed).toBe(true)
  })

  it('does not propose the end while the bot answers in the corner', async () => {
    const { service, engine } = setup()
    engine.human = (q) => cornerPolicy(q, 0.1)
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(2))
    service.playUserMove(v.id, freeZonePoint(service.view(v.id)))
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(4))
    expect(service.view(v.id).moves.every((m) => m.inZone)).toBe(true)
    expect(service.view(v.id).endProposed).toBe(false)
  })

  it("does not propose the end for the user's own tenuki", async () => {
    const { service, engine } = setup()
    engine.human = (q) => cornerPolicy(q, 0.1)
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(2))
    await service.tenuki(v.id)
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(4))
    expect(service.view(v.id).moves[2]).toMatchObject({ actor: 'auto-tenuki', inZone: false })
    expect(service.view(v.id).endProposed).toBe(false)
  })

  it('proposes again only two moves after «Играть дальше»', async () => {
    const { service, engine } = setup()
    engine.human = (q) => cornerPolicy(q, 0.9)
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(2))
    service.playUserMove(v.id, freeZonePoint(service.view(v.id)))
    await vi.waitFor(() => expect(service.view(v.id).endProposed).toBe(true))
    service.continuePlaying(v.id)
    expect(service.view(v.id).endProposed).toBe(false)
    service.playUserMove(v.id, freeZonePoint(service.view(v.id)))
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(6))
    expect(service.view(v.id).endProposed).toBe(true)
  })
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run packages/server/src/session/service.test.ts`
Expected: FAIL — the end is not proposed after the bot's tenuki (the old rule waits for analyses).

- [ ] **Step 4: Service change** in `packages/server/src/session/service.ts`:

```ts
  private commit(s: Session, vertex: MoveVertex, actor: Actor): void {
    const played = s.apply(vertex, actor)
    this.d.repo.insertMove(s.id, s.turn - 1, played)
    // Spec 8.5: the bot leaving the corner ends the joseki (or is its mistake to punish); the text is the same either way.
    if (actor === 'bot' && !played.inZone && s.canProposeEnd()) s.proposeEnd()
    this.afterPositionChanged(s)
  }
```

```ts
  /** Spec 8.5: every position is analysed in the background for the review. */
  private scheduleAnalysis(s: Session): void {
    this.d.analysis.position(s.record, s.turn).catch((err: unknown) => this.d.publish(s.id, toErrorMessage(err)))
  }
```

Remove the `shouldProposeEnd` import. Then do the renames and removals listed under **Files** (`joseki-start.ts`, scheduler without `passProbe`, `AnalysisKind = 'position'`, tests).

- [ ] **Step 5: API and end-to-end tests**

In `packages/server/src/api/api.test.ts` rename the test to `'plays, finishes and serves the review'` and replace the wait for `endProposed` with `await c.next((m) => m.type === 'sessionState' && m.session.moves.length === 2)`.

In `e2e/game.spec.ts` rename the first test to `'play a move, finish and replay from the review'`; after `await vertex(page, 15, 3).click()` wait for `await expect(page.getByText('ходов: 2')).toBeVisible()` and click `page.getByRole('button', { name: 'Закончить' })` instead of the proposal (drop the comment about the fake engine's best move). If «Закончить» asks for confirmation in `GameScreen.tsx`, confirm it the way the UI requires.

- [ ] **Step 6: Texts**

- `GameScreen.tsx`: `<p>Похоже, дзёсеки закончилось.</p>` → `<p>Бот сыграл в другом месте.</p>`.
- `SettingsScreen.tsx`: label of `endVisits` → `Визиты для кнопки «Тэнуки»`.
- `README.md`: the `endVisits` row → `analysis depth for the review / for the Tenuki button`.
- `scripts/setup/setup.ts`: `проверка конца: ${visits.endVisits}` → `кнопка «Тэнуки»: ${visits.endVisits}`.

- [ ] **Step 7: Verify**

Run: `npm test`, `npm run typecheck`, `npm run e2e` → all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A packages README.md scripts e2e
git commit -m "feat(session): propose the end when the bot leaves the corner; drop the pass probe"
```

---

### Task 3 (controller): calibration on real KataGo

Not a subagent task. With `config.local.json` pointing at KataGo 1.18.1, measure the tenuki share for `rank_5k`, `rank_6k`, `rank_7k`, `rank_9k` along the lines of the design's section 2 (4-4 low approach, 4-4 3-3 invasion, 3-4 low and high approach) and the screenshot position `D16`. Check: no share ≥ 0.6 in the middle of a sharp sequence; the bot's first reply to `D16` stays within 4 lines of D16. Report the numbers in the PR description; change a constant only with the user's agreement.
