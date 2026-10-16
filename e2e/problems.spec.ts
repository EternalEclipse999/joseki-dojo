import { expect, test, type Page } from '@playwright/test'

interface ListedCard {
  kind: string
  due: string
}

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)

// The server (5184) runs the fake KataGo with a 3-point penalty on N13: the user's first move there is a mistake.
test('a mistake becomes a problem: listed, answered in the queue, rated, and its card comes later', async ({ page }) => {
  // The new problem card is rated «Снова» by the training itself, so it falls due a minute later (the tab re-reads the cards then).
  // The free training has no group, so the row title has no group between the kind and the move.
  test.setTimeout(150_000)
  await page.goto('/')
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  const count = page.getByTestId('moves-count')
  const before = await count.textContent()
  await vertex(page, 12, 6).click() // N13
  await expect(count).not.toHaveText(before ?? '')
  await page.getByRole('button', { name: 'Закончить' }).click()
  await page.getByRole('button', { name: /^Повторение/ }).click()
  await expect(page.getByRole('heading', { name: 'Повторение', exact: true })).toBeVisible()
  await page.getByRole('radio', { name: 'Задачи' }).check()
  const rows = page.locator('.card-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Ваша ошибка · ход 1')
  const problemDue = async (): Promise<number> => {
    const cards = (await (await page.request.get('/api/cards')).json()) as ListedCard[]
    return Date.parse(cards.filter((c) => c.kind === 'move')[0].due)
  }
  const dueBefore = await problemDue()

  const start = page.getByRole('button', { name: 'Начать повторение' })
  await expect(start).toBeEnabled({ timeout: 100_000 })
  await start.click()
  await expect(page.getByRole('heading', { name: 'Найдите хороший ход' })).toBeVisible()
  await expect(page.getByText('В партии вы здесь ошиблись')).toBeVisible()

  await vertex(page, 15, 3).click() // Q16
  await expect(page.locator('.move-line .cat')).toContainText('точно')
  const panel = page.getByRole('region', { name: 'Повторение задачи' })
  await expect(panel.locator('button[aria-pressed="true"]')).toHaveCount(1)
  // Re-rating the problem's review: Q16 is exact (auto «Хорошо»; the fake's best on the empty board is D4), so «Трудно»
  // is never the auto rating here and pressing it really replaces the rating.
  const auto = panel.getByRole('button', { name: 'Хорошо', exact: true })
  await expect(auto).toHaveAttribute('aria-pressed', 'true')
  const other = panel.getByRole('button', { name: 'Трудно', exact: true })
  await other.click()
  await expect(other).toHaveAttribute('aria-pressed', 'true')
  await expect(auto).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Показать ветку' }).click()
  await expect(page.getByRole('button', { name: 'Скрыть ветку' })).toBeVisible()
  await page.getByRole('button', { name: 'Скрыть ветку' }).click()
  await expect(page.getByRole('button', { name: 'Показать ветку' })).toBeVisible()

  await panel.getByRole('button', { name: 'Закончить повторение' }).click()
  await expect(page.getByRole('heading', { name: 'Повторение', exact: true })).toBeVisible()
  await page.getByRole('radio', { name: 'Задачи' }).check()
  expect(await problemDue()).toBeGreaterThan(dueBefore)
})
