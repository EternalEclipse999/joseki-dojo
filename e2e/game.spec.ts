import { expect, test, type Page } from '@playwright/test'

async function startAsBlackTopRight(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.getByText('Ваш ход (чёрные)')).toBeVisible()
}

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)

test('play a move, accept the end proposal and replay from the review', async ({ page }) => {
  await startAsBlackTopRight(page)
  await vertex(page, 15, 3).click()

  // The fake engine's best move is D4, outside the top-right zone, so the end is proposed after the bot replies.
  await expect(page.getByText('Похоже, дзёсеки закончилось.')).toBeVisible()
  await page.getByRole('button', { name: 'К разбору' }).click()

  await expect(page.getByText(/Вы потеряли/)).toBeVisible()
  await expect(page.locator('.lossbar g.slot')).toHaveCount(2)
  await page.getByRole('button', { name: 'Показать ветку' }).click()
  await expect(page.getByText(/Ветка: 1 из/)).toBeVisible()

  await page.getByRole('button', { name: 'Переиграть с этого хода' }).click()
  await expect(page.getByText('Ваш ход (чёрные)')).toBeVisible()
})

test('a click outside the zone shows a hint and plays nothing', async ({ page }) => {
  await startAsBlackTopRight(page)
  await vertex(page, 3, 15).click()
  await expect(page.getByText('Ходить можно только внутри выделенной зоны угла')).toBeVisible()
  await expect(page.getByText('ходов: 0')).toBeVisible()
})

test('settings show the pinned version and refuse a missing network', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByText(/Проверенная версия KataGo: 1\.18\.1/)).toBeVisible()
  await page.getByLabel('Основная сеть').fill('/nope/missing.bin.gz')
  await page.getByRole('button', { name: 'Сохранить и проверить' }).click()
  await expect(page.locator('.hint.error')).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible()
})
