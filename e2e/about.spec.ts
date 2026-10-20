import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

// The main e2e server (5180): Russian, the fake KataGo through commandOverride and no setup record — «настроена вручную».
test('«О программе» shows the version and the engine, and closes with Esc and the cross back to its button', async ({ page }) => {
  await page.goto('/')
  const button = page.getByRole('button', { name: 'О программе' })
  const dialog = page.getByRole('dialog', { name: 'О программе' })
  await button.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(`Версия ${version}`)).toBeVisible()
  await expect(dialog.getByText('KataGo: проверенная версия 1.18.1, запущена 1.18.1')).toBeVisible()
  await expect(dialog.getByText('Сборка: настроена вручную')).toBeVisible()
  await expect(dialog.getByText('kata1-b18c384nbt-s9996604416-d4316597426')).toBeVisible()
  await expect(dialog.getByRole('link', { name: 'Сообщить об ошибке' })).toHaveAttribute('href', 'https://github.com/EternalEclipse999/joseki-dojo/issues/new')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(button).toBeFocused()

  await button.click()
  await dialog.getByRole('button', { name: 'Закрыть' }).click()
  await expect(dialog).toBeHidden()
  await expect(button).toBeFocused()
})

test('«О программе» opens during a training and leaves it as it was', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Чёрные').check()
  await page.getByLabel('Правый верхний').check()
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
  await page.locator('.shudan-vertex[data-x="15"][data-y="3"]').click()
  await expect(page.getByTestId('moves-count')).toHaveText('2')

  await page.getByRole('button', { name: 'О программе' }).click()
  const dialog = page.getByRole('dialog', { name: 'О программе' })
  await expect(dialog).toBeVisible()
  await page.mouse.click(5, 5) // the backdrop, outside the centred window
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'О программе' })).toBeFocused()
  await expect(page.getByTestId('moves-count')).toHaveText('2')
  await expect(page.getByRole('heading', { name: 'Ваш ход' })).toBeVisible()
})
