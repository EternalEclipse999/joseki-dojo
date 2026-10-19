import { expect, test, type Page } from '@playwright/test'

interface ListedCard {
  kind: string
  due: string
}

const vertex = (page: Page, x: number, y: number) => page.locator(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)
const stones = (page: Page) => page.locator('.problem .shudan-vertex.shudan-sign_1, .problem .shudan-vertex.shudan-sign_-1')

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

  // Problem variations 2.2: «Ваш ответ» keeps the verdict's marks; the best candidate's «Ветка» shows KataGo's line.
  await expect(page.getByText('Ваш ответ: Q16')).toBeVisible()
  await expect(vertex(page, 15, 3)).toHaveClass(/shudan-marker_circle\b/)
  await expect(vertex(page, 3, 15)).toHaveClass(/shudan-marker_triangle\b/)
  await expect(vertex(page, 12, 6)).toHaveClass(/shudan-marker_cross\b/)
  await page.getByRole('button', { name: /^Ветка / }).first().click()
  await expect(page.getByText(/Ветка: 1 из/)).toBeVisible()
  await page.getByRole('button', { name: 'Скрыть ветку' }).click()
  await expect(page.getByText(/Ветка: 1 из/)).toBeHidden()

  // A click after the answer is White's move C3; KataGo (Black) replies with the fake's best free point, D4.
  const line = page.getByTestId('variation-line')
  await vertex(page, 2, 16).click()
  await expect(line).toHaveText('Вариант от хода 2: C3 · D4', { timeout: 5_000 })
  await expect(vertex(page, 2, 16)).toHaveClass(/shudan-sign_-1\b/)
  await expect(vertex(page, 3, 15)).toHaveClass(/shudan-sign_1\b/)
  await expect(stones(page)).toHaveCount(3)

  // ← steps back through the variation, leaves it for «Ваш ответ», then shows the problem's start without the answer.
  await page.keyboard.press('ArrowLeft')
  await expect(stones(page)).toHaveCount(2)
  await page.keyboard.press('ArrowLeft')
  await expect(line).toBeHidden()
  await expect(page.getByText('Ваш ответ: Q16')).toBeVisible()
  await expect(stones(page)).toHaveCount(1)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('Начало задачи')).toBeVisible()
  await expect(stones(page)).toHaveCount(0)
  await expect(vertex(page, 15, 3)).not.toHaveClass(/shudan-marker_/)
  // The problem is on the first move: no setup move to mark.
  await expect(page.locator('.problem .shudan-marker_point')).toHaveCount(0)

  // A click on the start view is another first move instead of the answer; KataGo (White) replies; closing the variation
  // shows the start view again.
  await vertex(page, 16, 15).click()
  await expect(line).toHaveText('Вариант от хода 1: R4 · D4', { timeout: 5_000 })
  await expect(vertex(page, 16, 15)).toHaveClass(/shudan-sign_1\b/)
  await expect(vertex(page, 3, 15)).toHaveClass(/shudan-sign_-1\b/)
  await expect(vertex(page, 15, 3)).toHaveClass(/shudan-sign_0\b/)
  await page.getByRole('button', { name: 'Вернуться к задаче' }).click()
  await expect(line).toBeHidden()
  await expect(page.getByText('Начало задачи')).toBeVisible()
  await expect(stones(page)).toHaveCount(0)

  // The exploration changes neither the rating nor the schedule: «Трудно», chosen above, is still the pressed rating.
  await expect(panel.locator('button[aria-pressed="true"]')).toHaveCount(1)
  await expect(other).toHaveAttribute('aria-pressed', 'true')
  await expect(auto).toHaveAttribute('aria-pressed', 'false')

  await panel.getByRole('button', { name: 'Закончить повторение' }).click()
  await expect(page.getByRole('heading', { name: 'Повторение', exact: true })).toBeVisible()
  await page.getByRole('radio', { name: 'Задачи' }).check()
  expect(await problemDue()).toBeGreaterThan(dueBefore)
})
