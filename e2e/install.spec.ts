import { expect, test } from '@playwright/test'

// e2e/install-server.ts: KataGo is not installed; downloads and KataGo are fakes.
test.use({ baseURL: 'http://127.0.0.1:5181' })

test('installs KataGo with one button and opens the start screen', async ({ page }) => {
  await page.goto('/')
  // A fresh profile has no language yet: the first screen asks for it.
  await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible()
  await page.getByRole('button', { name: 'Русский' }).click()
  await expect(page.getByRole('heading', { name: 'Нужно скачать движок KataGo' })).toBeVisible()
  await page.getByRole('button', { name: 'Установить' }).click()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Доступна новая проверенная версия KataGo')).toHaveCount(0)
})
