import { expect, test, type Page } from '@playwright/test'

const post = (page: Page, path: string) => page.waitForResponse((r) => r.url().endsWith(path) && r.request().method() === 'POST')

// The news server (5185) starts with a training already in its database: the first start is an update.
test('after an update: the callout and the «новое» mark; «Понятно» keeps the mark; opening the section clears it for good', async ({ page }) => {
  await page.goto('/')
  const repetition = page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: /^Повторение/ })
  const callout = page.getByRole('dialog', { name: 'Новое: повторение' })
  await expect(callout).toBeVisible()
  await expect(repetition).toContainText('новое')
  const dismissed = post(page, '/api/news/repetition/dismiss')
  await callout.getByRole('button', { name: 'Понятно' }).click()
  await dismissed
  await expect(callout).toBeHidden()
  await expect(repetition).toContainText('новое')
  await expect(repetition).toBeFocused()

  await page.reload()
  await expect(repetition).toContainText('новое')
  await expect(callout).toHaveCount(0)

  const seen = post(page, '/api/news/repetition/seen')
  await repetition.click()
  await seen
  await expect(page.getByRole('heading', { name: 'Повторение', exact: true })).toBeVisible()
  await expect(repetition).not.toContainText('новое')
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible()
  await expect(repetition).not.toContainText('новое')
})

test('a fresh install (the main e2e server) shows no callout and no mark', async ({ page }) => {
  const news = page.waitForResponse((r) => r.url().endsWith('/api/news') && r.request().method() === 'GET')
  await page.goto('http://127.0.0.1:5180/')
  await news
  const nav = page.getByRole('navigation', { name: 'Разделы' })
  await expect(nav).toBeVisible()
  await expect(nav.getByRole('button', { name: /^Повторение/ })).not.toContainText('новое')
  await expect(page.getByRole('dialog', { name: 'Новое: повторение' })).toHaveCount(0)
})

test('«Открыть» opens the section, marks the novelty seen, and removes the callout and the mark', async ({ page }) => {
  // Only the GET is stubbed; the real server answers the POST.
  await page.route('**/api/news', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { unseen: ['repetition'], callout: 'repetition' } }) : route.continue(),
  )
  await page.goto('http://127.0.0.1:5180/')
  const repetition = page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: /^Повторение/ })
  const callout = page.getByRole('dialog', { name: 'Новое: повторение' })
  await expect(callout).toBeVisible()
  await expect(repetition).toContainText('новое')
  const seen = post(page, '/api/news/repetition/seen')
  await callout.getByRole('button', { name: 'Открыть' }).click()
  await seen
  await expect(page.getByRole('heading', { name: 'Повторение', exact: true })).toBeVisible()
  await expect(callout).toHaveCount(0)
  await expect(repetition).not.toContainText('новое')
})
