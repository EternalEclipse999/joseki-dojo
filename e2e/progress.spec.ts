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
