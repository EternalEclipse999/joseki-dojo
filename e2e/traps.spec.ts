import { expect, test, type Page } from '@playwright/test'

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)

// e2e/make-traps.ts: Q16, R17, the trick S18 by the bot; O14 is the correct answer.
test('a trap: the bot plays the trick, a correct answer gets its verdict in the review', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: /Ловушки/ }).check()
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  await page.getByRole('button', { name: 'Начать' }).click()

  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(page.getByTestId('moves-count')).toHaveText('1')
  await vertex(page, 13, 5).click()
  await expect(page.getByTestId('moves-count')).toHaveText('3')
  await page.getByRole('button', { name: 'Закончить' }).click()

  await expect(page.getByText('ловушка', { exact: true })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('верный ответ')).toBeVisible()
  await expect(page.getByText('Верно: O14')).toBeVisible()
})
