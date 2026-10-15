import { expect, test, type Page } from '@playwright/test'

// e2e/languages-server.ts: the profile of this spec, which starts in Russian. The language is put back after each test, so that every test starts from Russian.
test.afterEach(async ({ request }) => {
  await request.put('/api/ui', { data: { language: 'ru' } })
})

/** Resolves when the page's `PUT /api/ui` (the saved language) is answered; start it before the click that saves. */
const languageSaved = (page: Page) => page.waitForResponse((r) => r.url().endsWith('/api/ui') && r.request().method() === 'PUT')

test('the globe switches the language at once, the server saves it and it survives a reload', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await page.getByRole('button', { name: 'Язык' }).click()
  const saved = languageSaved(page)
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await saved
  await expect(page.getByRole('heading', { name: 'New training' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(((await (await request.get('/api/ui')).json()) as { language?: string }).language).toBe('en')
  // The reload waits for the server's answer, so what follows is the saved language, not only the remembered one.
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/ui') && r.request().method() === 'GET'), page.reload()])
  await expect(page.getByRole('heading', { name: 'New training' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('settings switch the language too', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Настройки' }).click()
  const saved = languageSaved(page)
  await page.getByRole('radio', { name: '日本語' }).check()
  await saved
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  // Texts from the Japanese dictionary: the settings heading and the title of the language section.
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '言語', exact: true })).toBeVisible()
})

// e2e/make-starts.ts writes the names: «Тестовое начало» is "Test start" (short "Start") and «Тестовое продолжение» is "Test continuation" ("Continuation").
test('the names of the start positions follow the language, also when it changes with the tree on screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await page.getByRole('button', { name: 'Язык' }).click()
  const saved = languageSaved(page)
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await saved
  await expect(page.getByRole('heading', { name: 'New training' })).toBeVisible()

  await page.getByRole('radio', { name: /From the list/ }).check()
  const tree = page.locator('.start-tree')
  const name = tree.locator('.start-info-name')
  await tree.locator('.start-card', { hasText: '4-4' }).click()
  // The new card under the pointer may turn hovered, and a hovered continuation shows a ring instead of its letter.
  await page.mouse.move(0, 0)
  await tree.locator('.start-board .corner-mark', { hasText: 'A' }).click()
  await expect(name).toHaveText('Test start')
  await expect(tree.locator('.start-card', { hasText: 'Continuation' })).toBeVisible()
  await expect(tree.locator('.start-outline-row.current')).toContainText('Start')
  await expect(page.getByText('Тестовое начало')).toHaveCount(0)

  // The tree stays on the same position and shows its name in the new language.
  await page.getByRole('button', { name: 'Language', exact: true }).click()
  const savedJapanese = languageSaved(page)
  await page.getByRole('menuitemradio', { name: '日本語' }).click()
  await savedJapanese
  await expect(name).toHaveText('テスト開始')
  await expect(tree.locator('.start-card', { hasText: '続き' })).toBeVisible()
  await expect(page.getByText('Test start')).toHaveCount(0)
})

test('a late answer of /api/ui does not undo a language picked before it arrives', async ({ page, request }) => {
  // The server answers at once (Russian), the page gets the answer 2 s later: after the player's choice.
  await page.route('**/api/ui', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 2000))
    return route.fulfill({ response })
  })
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/ui') && r.request().method() === 'GET')
  await page.goto('/')
  await page.getByRole('button', { name: /^(Language|Язык)$/ }).click() // English until the late answer, Russian after it
  const saved = languageSaved(page)
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await saved
  await answered
  await page.waitForTimeout(500) // the page handles the late answer
  await expect(page.getByRole('heading', { name: 'New training' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(((await (await request.get('/api/ui')).json()) as { language?: string }).language).toBe('en')
})
