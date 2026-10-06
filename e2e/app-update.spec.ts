import { expect, test } from '@playwright/test'

test('a browser has no desktop updater and shows no update bar', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible()
  await expect(page.getByText(/Доступна версия/)).toHaveCount(0)
})

test('the update bar follows the desktop updater', async ({ page }) => {
  // Stands in for the desktop preload (window.dojoDesktop): an update is available; downloading reports 42 %.
  await page.addInitScript(() => {
    type State = { status: string; version?: string; percent?: number }
    let listener: ((s: State) => void) | null = null
    const w = window as unknown as { dojoDesktop: unknown; updateCalls: string[] }
    w.updateCalls = []
    w.dojoDesktop = {
      getUpdateState: async (): Promise<State> => ({ status: 'available', version: '0.2.0' }),
      onUpdateState: (l: (s: State) => void) => {
        listener = l
        return () => {
          listener = null
        }
      },
      downloadUpdate: async () => {
        w.updateCalls.push('download')
        listener?.({ status: 'downloading', version: '0.2.0', percent: 42 })
      },
      retryUpdate: async () => {
        w.updateCalls.push('retry')
      },
    }
  })
  await page.goto('/')
  await expect(page.getByText('Доступна версия 0.2.0')).toBeVisible()
  await page.getByRole('button', { name: 'Обновить', exact: true }).click()
  await expect(page.getByText('Скачиваю версию 0.2.0: 42%')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { updateCalls: string[] }).updateCalls)).toEqual(['download'])
})
