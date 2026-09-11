/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The column's sections, turned off and on, and the rail's panel buttons.
 */

import { test, expect } from '@playwright/test'
import { drawShape, openApp } from './helpers'

test.beforeEach(async ({ page }) => {
  await openApp(page)
  // Every test starts with every section showing, whatever an earlier one left.
  await page.evaluate(() => localStorage.removeItem('xdesign.hiddenSections'))
  await page.reload()
  await openApp(page)
})

test('the menu button sits over the tool column', async ({ page }) => {
  const centre = async (selector: string) => {
    const box = (await page.locator(selector).first().boundingBox())!
    return box.x + box.width / 2
  }
  expect(Math.abs((await centre('[data-testid="app-menu"]')) - (await centre('.tool-button')))).toBeLessThan(0.5)
})

test('the Layers button hides and shows the layers panel, and remembers', async ({ page }) => {
  const layers = page.locator('.layers-panel')
  const button = page.locator('[data-testid="toggle-layers"]')
  await expect(layers).toBeVisible()
  await expect(button).toHaveAttribute('aria-pressed', 'true')

  await button.click()
  await expect(layers).toHaveCount(0)
  await expect(button).toHaveAttribute('aria-pressed', 'false')

  await page.reload()
  await openApp(page)
  await expect(page.locator('.layers-panel')).toHaveCount(0)

  await page.locator('[data-testid="toggle-layers"]').click()
  await expect(page.locator('.layers-panel')).toBeVisible()
})

test('the Extensions button says it has nothing to open yet', async ({ page }) => {
  await page.locator('[data-testid="extensions"]').click()
  await expect(page.getByText('Extensions are not available yet.')).toBeVisible()
})

test('a section turned off in the menu is gone until turned back on', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
  await expect(page.locator('[data-section="fill"]')).toBeVisible()

  const openSections = async () => {
    await page.locator('[data-testid="app-menu"]').click()
    await page.locator('[data-testid="menu-sections"]').hover()
  }

  await openSections()
  await page.locator('[data-testid="section-toggle-fill"]').click()
  await expect(page.locator('[data-section="fill"]')).toHaveCount(0)
  await expect(page.locator('[data-section="stroke"]')).toBeVisible()

  await openSections()
  await page.locator('[data-testid="section-toggle-layers"]').click()
  await expect(page.locator('.layers-panel')).toHaveCount(0)

  await openSections()
  await page.locator('.menu-item', { hasText: 'Show All Sections' }).click()
  await expect(page.locator('[data-section="fill"]')).toBeVisible()
  await expect(page.locator('.layers-panel')).toBeVisible()
})
