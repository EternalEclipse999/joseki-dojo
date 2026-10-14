import { expect, test, type Page } from '@playwright/test'

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)

// e2e/make-starts.ts: Q16 and R17 are on the board; Black (the user) moves first.
test('a start from the list: the position is on the board and its name is in the crumbs', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: /Из списка/ }).check()
  await expect(page.getByRole('button', { name: 'Начать тренировку' })).toBeDisabled()
  await page.getByRole('radio', { name: /Тестовое начало/ }).check()
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()

  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(page.getByText('Тестовое начало')).toBeVisible()
  await expect(page.getByTestId('moves-count')).toHaveText('0')
  await vertex(page, 13, 2).click()
  await expect(page.getByTestId('moves-count')).toHaveText('2')
  await page.getByRole('button', { name: 'Закончить' }).click()
  await expect(page.getByText('Разбор: Тестовое начало')).toBeVisible()
})

test('a random start: its name is in the crumbs and the user is to move', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: /Случайно/ }).first().check()
  await page.getByLabel('Чёрные').check()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()

  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await expect(page.getByText('Тестовое начало')).toBeVisible()
})
