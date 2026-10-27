import { expect, test, type Page } from '@playwright/test'

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)
const summary = (page: Page) => page.locator('.progress-summary')
const percentOf = (text: string | null): number => Number(/(\d+)\s*%/.exec(text ?? '')?.[1])
// «Освоено 42 %»: the number of the summary's first line.
const summaryPercent = async (page: Page): Promise<number> => percentOf(await summary(page).locator('b').textContent())
const rowPercent = async (page: Page): Promise<number> =>
  percentOf(await page.locator('.start-outline-row', { hasText: 'Начало' }).getByRole('img', { name: /^освоено/ }).getAttribute('aria-label'))
const setLevel = async (page: Page, level: string): Promise<void> => {
  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.getByLabel('Ваш уровень').selectOption(level)
  await page.getByRole('button', { name: 'Назад' }).click()
}

// The server (5186) has a graph over the e2e start list: Q16 R17 is its first position, Black's O17 (or its mirror) a move of the graph.
test('the progress of the list: a training along the graph, the colour and the level change the numbers', async ({ page }) => {
  await page.goto('/')
  await setLevel(page, '5k')
  await page.getByRole('radio', { name: /Из списка/ }).check()
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  // Nothing trained yet: the summary is there, at 0 %.
  await expect(summary(page)).toBeVisible()
  await expect.poll(() => summaryPercent(page)).toBe(0)

  const tree = page.locator('.start-tree')
  await tree.locator('.start-card', { hasText: '4-4' }).click()
  await page.mouse.move(0, 0)
  await tree.locator('.start-board .corner-mark', { hasText: 'A' }).click()
  await expect(tree.locator('.start-info-name')).toContainText('Тестовое начало')
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await vertex(page, 13, 2).click() // O17, a move of the graph (or R14, its mirror: one probability)
  await expect(page.getByTestId('moves-count')).toHaveText('2')
  await page.getByRole('button', { name: 'Закончить' }).click()
  await expect(page.getByText('Разбор: 4-4 · Тестовое начало')).toBeVisible()
  await page.getByRole('button', { name: 'К выбору позиции' }).click()

  // The position's row and the summary show the progress.
  await expect(page.getByRole('radio', { name: /Из списка/ })).toBeChecked()
  await expect.poll(() => rowPercent(page)).toBeGreaterThan(0)
  const summaryAt5k = await summaryPercent(page)
  expect(summaryAt5k).toBeGreaterThan(0)

  // White has no card yet: its numbers differ from Black's; a random colour shows both.
  await page.getByLabel('Белые').check()
  await expect.poll(() => summaryPercent(page)).toBe(0)
  await page.getByRole('radio', { name: /Случайно/ }).last().check()
  await expect(summary(page)).toContainText('За чёрных')
  await expect(summary(page)).toContainText('за белых 0')
  await page.getByLabel('Чёрные').check()
  await expect.poll(() => summaryPercent(page)).toBe(summaryAt5k)

  // Another level: the cards are replayed and the weights are those of the level, so the second position weighs more
  // and the list, in which only the first is trained, is worth less.
  await setLevel(page, '3d')
  await expect(page.getByRole('radio', { name: /Из списка/ })).toBeChecked()
  await expect.poll(() => summaryPercent(page)).toBeLessThan(summaryAt5k)
})

const crumb = (page: Page) => page.locator('.app-header .crumb')
const stones = (page: Page) => page.locator('main.game .shudan-vertex.shudan-sign_1, main.game .shudan-vertex.shudan-sign_-1')
const movesCount = (page: Page) => page.getByTestId('moves-count')

/**
 * A training of «Тестовое начало» (Q16 R17) for Black in the top-right corner: from the tree, or `again` from the review of
 * the previous one («Играть позицию заново»; the start screen keeps the position picked, so the tree opens on it). `play`
 * makes the moves, then «Закончить»; its review is on screen.
 */
async function trainFirstPosition(page: Page, play: () => Promise<void>, again = false): Promise<void> {
  if (again) await page.getByRole('button', { name: 'Играть позицию заново' }).click()
  else {
    await page.goto('/')
    await page.getByRole('radio', { name: /Из списка/ }).check()
    await page.getByLabel('Чёрные').check()
    await page.getByLabel('Правый верхний').check()
    const tree = page.locator('.start-tree')
    await tree.locator('.start-card', { hasText: '4-4' }).click()
    await page.mouse.move(0, 0)
    await tree.locator('.start-board .corner-mark', { hasText: 'A' }).click()
    await expect(tree.locator('.start-info-name')).toContainText('Тестовое начало')
    await page.getByRole('button', { name: 'Начать тренировку' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await play()
  await page.getByRole('button', { name: 'Закончить' }).click()
  await expect(page.getByText('Разбор: 4-4 · Тестовое начало')).toBeVisible()
}

// Part 3 spec 6: with weights the queue serves a list position by its graph cards' due, and spec 5.3 starts it below the
// position when the player's habits reach the due card with less than ½. The graph's line under the first position
// (e2e/make-graph.ts): Black P17, a White tenuki, then Black's turn N2. The training that walks it makes N2's card «Снова»
// (the user's tenuki to B19, which the server punishes): it falls due in a minute and sets the position's due. Two more
// trainings play O17, so P17 is at most a third of Black's habit at the position (a quarter after the first test's O17):
// the queue's start is after P17, where the bot plays the line's tenuki.
test('the queue with weights: a card below the position falls due, the queue starts below it, the review shows the progress gained', async ({ page }) => {
  // N2's card falls due a minute after its training; the tab enables «Начать повторение» then.
  test.setTimeout(180_000)
  await page.goto('/')
  await setLevel(page, '5k')
  await trainFirstPosition(page, async () => {
    await vertex(page, 14, 2).click() // P17, the line under the position (or R15, its mirror: one node)
    await expect(movesCount(page)).toHaveText('2') // the bot's tenuki, the line's White move: Black's turn at N2
    await page.getByRole('button', { name: 'Тэнуки' }).click() // B19: a mistake
    await expect(movesCount(page)).toHaveText('4')
  })
  for (let i = 0; i < 2; i++) {
    await trainFirstPosition(
      page,
      async () => {
        await vertex(page, 13, 2).click() // O17
        await expect(movesCount(page)).toHaveText('2')
      },
      true,
    )
  }

  // The tab lists the position for Black (a graph item, no card: it cannot be deleted) and starts it once N2 falls due.
  await page.getByRole('button', { name: /^Повторение/ }).click()
  await expect(page.getByRole('heading', { name: 'Повторение', exact: true })).toBeVisible()
  const row = page.locator('.card-row', { hasText: 'Тестовое начало · Чёрные' })
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('button', { name: /^Удалить/ })).toHaveCount(0)
  const start = page.getByRole('button', { name: 'Начать повторение' })
  await expect(start).toBeEnabled({ timeout: 100_000 })
  await start.click()

  // A deep start, named by the position: more stones than its two (P17 or R15 and the bot's tenuki), the user at N2.
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(crumb(page)).toHaveText('4-4 · Тестовое начало')
  await expect.poll(() => stones(page).count()).toBeGreaterThan(2)
  await vertex(page, 10, 10).click() // in the corner zone of every corner (the queue's corner is random), off the graph
  await expect(movesCount(page)).not.toHaveText('1')
  await page.getByRole('button', { name: 'Закончить' }).click()

  // The review: the progress gained instead of a position card's rating, and the queue's buttons.
  await expect(page.getByText('Разбор: 4-4 · Тестовое начало')).toBeVisible()
  await expect(page.locator('.progress-gain')).toContainText(/^Освоено: [\d,]+\s%\s→\s[\d,]+\s%/)
  const panel = page.getByRole('region', { name: 'Повторение позиции' })
  await expect(panel.getByRole('button', { name: 'Дальше' })).toBeVisible()
  await expect(panel).not.toContainText('Не засчитано')

  // N2's card is in its learning steps: with nothing due, «Дальше» brings the position back at once (learn-ahead).
  await panel.getByRole('button', { name: 'Дальше' }).click()
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(crumb(page)).toHaveText('4-4 · Тестовое начало')
  await expect.poll(() => stones(page).count()).toBeGreaterThan(2)
  await page.getByRole('button', { name: 'Закончить' }).click()
  await panel.getByRole('button', { name: 'Закончить повторение' }).click()
  await expect(page.getByRole('heading', { name: 'Повторение', exact: true })).toBeVisible()
})

// Part 3 spec 5.2: with weights «Случайно» draws a list position and a target under it by what is left to learn, and the
// start is named by the deepest list position on its way: a position of the graph, never «Тестовая очередь», a start of
// the list outside it.
test('«Случайно» with weights starts in the graph, named by a list position', async ({ page }) => {
  await page.goto('/')
  await setLevel(page, '5k')
  await page.getByRole('radio', { name: /Случайно/ }).first().check()
  await page.getByLabel('Чёрные').check()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(crumb(page)).toHaveText(/^4-4 · Тестовое (начало|продолжение)$/)
  await expect.poll(() => stones(page).count()).toBeGreaterThanOrEqual(2)
})
