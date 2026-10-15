import { expect, test, type Page } from '@playwright/test'

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)

// e2e/make-starts.ts: Q16 and R17 are on the board; Black (the user) moves first.
test('a start from the tree: the position is on the board, its name is in the crumbs, the review replays it and goes back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: /Из списка/ }).check()
  const start = page.getByRole('button', { name: 'Начать тренировку' })
  await expect(start).toBeDisabled()
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  const tree = page.locator('.start-tree')
  const name = tree.locator('.start-info-name')
  await tree.locator('.start-card', { hasText: '4-4' }).click()
  // The new card under the pointer may turn hovered, and a hovered continuation shows a ring instead of its letter.
  await page.mouse.move(0, 0)
  await tree.locator('.start-board .corner-mark', { hasText: 'A' }).click()
  await expect(name).toHaveText('Тестовое начало')
  await expect(tree.locator('.start-card', { hasText: 'Продолжение' })).toBeVisible()
  await expect(tree.locator('.start-outline-row.current')).toContainText('Начало')
  // The clicks keep the focus in the tree: a letter, Backspace and Enter work right after them.
  await page.keyboard.press('KeyA')
  await expect(name).toHaveText('Тестовое продолжение')
  await page.keyboard.press('Backspace')
  await expect(name).toHaveText('Тестовое начало')
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(page.getByText('4-4 · Тестовое начало')).toBeVisible()
  await expect(page.getByTestId('moves-count')).toHaveText('0')
  await vertex(page, 13, 2).click()
  await expect(page.getByTestId('moves-count')).toHaveText('2')
  await page.getByRole('button', { name: 'Закончить' }).click()
  await expect(page.getByText('Разбор: 4-4 · Тестовое начало')).toBeVisible()

  // The review plays the same position again and goes back to the tree, with the settings kept.
  await page.getByRole('button', { name: 'Играть позицию заново' }).click()
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(page.locator('.app-header .crumb')).toHaveText('4-4 · Тестовое начало')
  await expect(page.getByTestId('moves-count')).toHaveText('0')
  await vertex(page, 13, 2).click()
  await expect(page.getByTestId('moves-count')).toHaveText('2')
  await page.getByRole('button', { name: 'Закончить' }).click()
  await page.getByRole('button', { name: 'К выбору позиции' }).click()
  await expect(page.getByRole('radio', { name: /Из списка/ })).toBeChecked()
  await expect(page.locator('.start-tree .start-info-name')).toHaveText('Тестовое начало')
  await expect(page.getByLabel('Чёрные')).toBeChecked()
})

test('a random start: its name is in the crumbs', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: /Случайно/ }).first().check()
  await page.getByLabel('Чёрные').check()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()

  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(page.getByText(/Тестовое (начало|продолжение)/)).toBeVisible()
})

test('a start from a group: only its corner stone is on the board and the bot answers it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: /Из списка/ }).check()
  await page.getByLabel('Чёрные').check()
  await page.locator('.start-tree .start-card', { hasText: '4-4' }).click()
  await expect(page.locator('.start-pick')).toHaveText('4-4')
  await page.getByRole('button', { name: 'Начать тренировку' }).click()

  await expect(page.locator('.app-header .crumb')).toHaveText('4-4')
  await expect(page.getByTestId('moves-count')).toHaveText('1')
})
