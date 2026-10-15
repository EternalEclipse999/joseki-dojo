import { expect, test, type Page } from '@playwright/test'

// e2e/install-server.ts: KataGo is not installed; downloads and KataGo are fakes.
test.use({ baseURL: 'http://127.0.0.1:5181' })

/** Resolves when the page's `PUT /api/ui` (the saved language) is answered; start it before the click that saves. */
const languageSaved = (page: Page) => page.waitForResponse((r) => r.url().endsWith('/api/ui') && r.request().method() === 'PUT')

test('installs KataGo with one button and opens the start screen', async ({ page }) => {
  await page.goto('/')
  // A fresh profile has no language yet: the first screen asks for it.
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()
  const saved = languageSaved(page)
  await page.getByRole('button', { name: 'Русский' }).click()
  await saved
  await expect(page.getByRole('heading', { name: 'Нужно скачать движок KataGo' })).toBeVisible()

  // The language is saved on the server: after a reload the first screen does not come back and the texts stay Russian.
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/ui') && r.request().method() === 'GET'), page.reload()])
  await expect(page.getByRole('heading', { name: 'Нужно скачать движок KataGo' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')

  await page.getByRole('button', { name: 'Установить' }).click()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Доступна новая проверенная версия KataGo')).toHaveCount(0)
})
