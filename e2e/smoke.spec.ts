import { expect, test } from '@playwright/test'

test('loads downtown and can cross to Town Center', async ({ page }) => {
  await page.goto('/?dev=1&name=Tester')
  await expect(page.locator('#game-canvas')).toBeVisible()
  await expect(page.locator('#minimap')).toBeVisible()
  await expect(page.locator('#status')).toContainText('WASD')
  await expect(page.locator('#net-status')).toContainText('connected', { timeout: 15_000 })
  await expect(page.locator('#dev-panel')).toBeVisible()
  await page.getByRole('combobox', { name: 'Locations' }).selectOption('Burbank Town Center')
  await expect(page.locator('#place')).toContainText('Town Center')
})

test('sends text to June and shows her reply', async ({ page }) => {
  await page.goto('/?dev=1&name=Tester')
  await expect(page.locator('#net-status')).toContainText('connected', { timeout: 15_000 })
  await page.getByRole('combobox', { name: 'NPCs' }).selectOption('June Alvarez')
  await page.locator('#say-input').fill('Where is City Hall?')
  await page.locator('#send').click()
  const transcript = page.locator('#transcript')
  await expect(transcript).toContainText('June Alvarez', { timeout: 10_000 })
  await expect(transcript).toContainText('Olive Avenue')
})
