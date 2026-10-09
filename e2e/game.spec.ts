import { expect, test, type Page } from '@playwright/test'

async function startAsBlackTopRight(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.getByText('Ваш ход (чёрные)')).toBeVisible()
}

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)

test('the bot leaves the corner, the end is proposed and the review replays from a move', async ({ page }) => {
  await startAsBlackTopRight(page)
  await vertex(page, 15, 3).click()
  await expect(page.getByText('ходов: 2')).toBeVisible()
  // Out of the bot's local area (more than 4 lines from Q16). With the joseki started, the fake engine's uniform
  // policy puts two thirds of the mass outside the zone: the corner counts as settled and the bot leaves it.
  await vertex(page, 8, 10).click()
  await expect(page.getByText('Бот сыграл в другом месте.')).toBeVisible()
  await page.getByRole('button', { name: 'К разбору' }).click()

  await expect(page.getByText(/Вы потеряли/)).toBeVisible()
  await expect(page.locator('.lossbar g.slot')).toHaveCount(4)
  await page.getByRole('button', { name: 'Показать ветку' }).click()
  await expect(page.getByText(/Ветка: 1 из/)).toBeVisible()

  await page.getByRole('button', { name: 'Переиграть с этого хода' }).click()
  await expect(page.getByText('Ваш ход (чёрные)')).toBeVisible()
})

test('«Закончить» opens the review at once', async ({ page }) => {
  await startAsBlackTopRight(page)
  await vertex(page, 15, 3).click()
  await expect(page.getByText('ходов: 2')).toBeVisible()
  await page.getByRole('button', { name: 'Закончить' }).click()
  await expect(page.getByText(/Вы потеряли/)).toBeVisible()
  await expect(page.locator('.lossbar g.slot')).toHaveCount(2)
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
  await expect(page.locator('.hint.error')).toContainText('KataGo не найден')
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible()
})

test('the board fills a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 })
  await startAsBlackTopRight(page)
  await expect.poll(async () => (await page.locator('.game .shudan-goban').boundingBox())?.width ?? 0).toBeGreaterThan(300)
  // The goban root can be stretched by the layout while its vertices stay tiny: check a vertex too.
  await expect.poll(async () => (await vertex(page, 3, 3).boundingBox())?.width ?? 0).toBeGreaterThan(15)
})

test('the board does not overlap the side panel in a wide window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await startAsBlackTopRight(page)
  await expect.poll(async () => (await vertex(page, 3, 3).boundingBox())?.width ?? 0).toBeGreaterThan(15)
  const board = await page.locator('.game .shudan-goban').boundingBox()
  const panel = await page.locator('.game .panel').boundingBox()
  expect(board && panel && board.x + board.width <= panel.x).toBe(true)
})
