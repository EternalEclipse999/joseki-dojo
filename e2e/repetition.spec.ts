import { expect, test, type Page } from '@playwright/test'

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)

/** The positions of e2e/make-starts.ts under «Тестовое начало», each the continuation «A» of the one before. */
const CONTINUATIONS = ['Тестовое продолжение', 'Тестовая очередь'] as const

async function openList(page: Page): Promise<void> {
  await page.getByRole('radio', { name: /Из списка/ }).check()
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
}

/** Plays one move of the user's: (10, 10) is in the corner zone of every corner. */
async function playInZone(page: Page): Promise<void> {
  const count = page.getByTestId('moves-count')
  const before = await count.textContent()
  await vertex(page, 10, 10).click()
  await expect(count).not.toHaveText(before ?? '')
}

/** A training of a listed position from the tree with one move of the user's in the corner zone, finished: its review is on screen. */
async function playListPosition(page: Page, name: (typeof CONTINUATIONS)[number]): Promise<void> {
  await page.goto('/')
  await openList(page)
  const tree = page.locator('.start-tree')
  const info = tree.locator('.start-info-name')
  await tree.locator('.start-card', { hasText: '4-4' }).click()
  // A hovered continuation shows a ring instead of its letter.
  await page.mouse.move(0, 0)
  await tree.locator('.start-board .corner-mark', { hasText: 'A' }).click()
  await expect(info).toHaveText('Тестовое начало')
  for (const next of CONTINUATIONS.slice(0, CONTINUATIONS.indexOf(name) + 1)) {
    await page.keyboard.press('KeyA')
    await expect(info).toHaveText(next)
  }
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await playInZone(page)
  await page.getByRole('button', { name: 'Закончить' }).click()
}

// The server and its database are shared by all specs of the run, so other specs may have made the same card already.
// The continuation: starts.spec trains «Тестовое начало» concurrently, and only the latest review of a card can be re-rated.
test('a trained position becomes a card: rated in the review, listed in «Повторение», marked in the tree', async ({ page }) => {
  await playListPosition(page, 'Тестовое продолжение')
  const panel = page.getByRole('region', { name: 'Повторение позиции' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Хорошо' })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('button', { name: 'Трудно' })).toBeEnabled()
  await panel.getByRole('button', { name: 'Трудно' }).click()
  await expect(panel.getByRole('button', { name: 'Трудно' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: /^Повторение/ }).click()
  await expect(page.getByRole('heading', { name: 'Повторение', exact: true })).toBeVisible()
  const row = page.locator('.card-row', { hasText: 'Тестовое продолжение' })
  await expect(row).toHaveCount(1)

  await page.getByRole('button', { name: 'Игра' }).click()
  await page.getByRole('button', { name: 'К выбору позиции' }).click()
  await page.getByRole('radio', { name: /Из списка/ }).check()
  await expect(page.locator('.start-tree .card-mark').first()).toBeVisible()

  await page.getByRole('button', { name: /^Повторение/ }).click()
  page.once('dialog', (d) => d.accept())
  await row.getByRole('button', { name: /^Удалить/ }).click()
  await expect(row).toHaveCount(0)
})

// «Тестовая очередь» belongs to this test alone: no other test trains it or deletes its card (a deleted card never comes back).
// The queue serves the most overdue card first, so the trainings it starts are checked whatever card another spec left due.
test('the queue: a card rated «Снова» falls due, the queue trains it, «Дальше» brings it back at once, «Закончить» goes back', async ({ page }) => {
  // «Снова» puts the card a minute away (the first learning step): the tab enables «Начать повторение» once it falls due.
  test.setTimeout(150_000)
  await playListPosition(page, 'Тестовая очередь')
  const panel = page.getByRole('region', { name: 'Повторение позиции' })
  await panel.getByRole('button', { name: 'Снова' }).click()
  await expect(panel.getByRole('button', { name: 'Снова' })).toHaveAttribute('aria-pressed', 'true')
  // Outside the queue the panel has no queue buttons.
  await expect(panel.getByRole('button', { name: 'Дальше' })).toHaveCount(0)

  await page.getByRole('button', { name: /^Повторение/ }).click()
  await expect(page.locator('.card-row', { hasText: 'Тестовая очередь' })).toHaveCount(1)
  const start = page.getByRole('button', { name: 'Начать повторение' })
  // The tab reads the cards again when the next one falls due, without a reload.
  await expect(start).toBeEnabled({ timeout: 100_000 })
  await start.click()

  // A queue training: «Снова» again, then «Дальше» — nothing else is due now, and the learn-ahead serves the card again.
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await playInZone(page)
  await page.getByRole('button', { name: 'Закончить' }).click()
  await panel.getByRole('button', { name: 'Снова' }).click()
  await expect(panel.getByRole('button', { name: 'Снова' })).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('button', { name: 'Дальше' }).click()

  // The next training, finished without a move: not a repetition, and the queue's buttons stay.
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await page.getByRole('button', { name: 'Закончить' }).click()
  await expect(panel).toContainText('Не засчитано как повторение')
  await expect(panel.getByRole('button', { name: 'Дальше' })).toBeVisible()
  await panel.getByRole('button', { name: 'Закончить повторение' }).click()
  await expect(page.getByRole('heading', { name: 'Повторение', exact: true })).toBeVisible()
})

test('the level is saved in Settings', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Настройки' }).click()
  const level = page.getByLabel('Ваш уровень')
  await expect(level).toBeEnabled()
  // Whatever the database holds now, pick the other of two values and see it survive a reload.
  const next = (await level.inputValue()) === '3d' ? '5k' : '3d'
  await level.selectOption(next)
  await page.reload()
  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByLabel('Ваш уровень')).toHaveValue(next)
})
