import { expect, test, type Page } from '@playwright/test'

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)
const stones = (page: Page) => page.locator('.review .shudan-vertex.shudan-sign_1, .review .shudan-vertex.shudan-sign_-1')

async function reviewAfterOneMove(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await vertex(page, 15, 3).click()
  await expect(page.getByTestId('moves-count')).toHaveText('2')
  await page.getByRole('button', { name: 'Закончить' }).click()
  await expect(page.getByText('Ход 1 из 2')).toBeVisible()
}

// The fake KataGo's best move is the first free point of D4, Q4, D16, Q16 (here D4); a variation search sends three
// partial answers 0.5 s apart (25, 50, 75 visits) and then the final one at the limit (10 × the review's 10 visits).
// KataGo replies at the review's 10 visits: with the first partial answer.
test('a variation in the review: KataGo replies, a step back and another move replace the tail', async ({ page }) => {
  await reviewAfterOneMove(page)

  // R6 instead of move 1 (Q16): KataGo thinks, then answers D4 at the review's visits.
  const line = page.getByTestId('variation-line')
  await vertex(page, 16, 13).click()
  await expect(line).toHaveText('Вариант от хода 1: R6')
  await expect(page.getByText(/KataGo думает: \d+ \/ 10 визитов/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ответить сейчас' })).toBeVisible()
  await expect(line).toHaveText('Вариант от хода 1: R6 · D4', { timeout: 5_000 })
  await expect(stones(page)).toHaveCount(2)
  await expect(vertex(page, 16, 13)).toHaveClass(/shudan-sign_1\b/)
  await expect(vertex(page, 3, 15)).toHaveClass(/shudan-sign_-1\b/)
  await expect(page.getByText(/^визитов: \d+$/)).toBeVisible()

  // Back to R6 and C17 instead of D4: the tail is replaced; KataGo answers again.
  await page.getByRole('button', { name: 'Назад по варианту' }).click()
  await expect(stones(page)).toHaveCount(1)
  await vertex(page, 2, 2).click()
  await expect(line).toHaveText('Вариант от хода 1: R6 · C17')
  await expect(line).toHaveText('Вариант от хода 1: R6 · C17 · D4')
  await expect(stones(page)).toHaveCount(3)

  await page.getByRole('button', { name: 'Вернуться к партии' }).click()
  await expect(line).toBeHidden()
  await expect(page.getByText('Ход 1 из 2')).toBeVisible()
  await expect(stones(page)).toHaveCount(1)
})

test('«Глубже» deepens a game position; «Сыграть» plays a candidate, for both sides when KataGo does not reply', async ({ page }) => {
  await reviewAfterOneMove(page)
  await page.getByRole('button', { name: 'Глубже' }).click()
  await expect(page.getByText('визитов: 100')).toBeVisible({ timeout: 10_000 })

  const line = page.getByTestId('variation-line')
  await page.getByRole('button', { name: 'Сыграть D4' }).click()
  await expect(line).toHaveText('Вариант от хода 1: D4')
  await page.getByLabel('Отвечает KataGo').uncheck()
  await expect(page.getByText(/KataGo думает/)).toBeHidden()
  // The search still runs to its limit, and nothing is played for the other side.
  await expect(page.getByText('визитов: 100')).toBeVisible({ timeout: 10_000 })
  await expect(line).toHaveText('Вариант от хода 1: D4')
  await page.getByRole('button', { name: 'Сыграть Q4' }).click()
  await expect(line).toHaveText('Вариант от хода 1: D4 · Q4')
  await expect(stones(page)).toHaveCount(2)
})
