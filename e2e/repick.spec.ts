import { expect, test } from '@playwright/test'

// e2e/repick-server.ts: KataGo is installed from an older lock; downloads and KataGo are fakes.
test.use({ baseURL: 'http://127.0.0.1:5182' })
test.describe.configure({ mode: 'serial' })

test('an old engine record offers the update; the update ends on the start screen without the bar', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible()
  await expect(page.getByText('Доступна новая проверенная версия KataGo')).toBeVisible()
  await page.getByRole('button', { name: 'Обновить движок' }).click()
  await expect(page.getByRole('heading', { name: 'Обновление KataGo' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Доступна новая проверенная версия KataGo')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'KataGo не настроен' })).toHaveCount(0)
})

test('«Подобрать движок заново» in Settings re-runs the installer and returns to Settings', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.getByRole('button', { name: 'Подобрать движок заново' }).click()
  await expect(page.getByRole('heading', { name: 'Подбор движка KataGo' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Запущена: 1\.18\.1/)).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible()
})
