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
  await page.evaluate(() => {
    localStorage.removeItem('xdesign.hiddenSections')
    localStorage.removeItem('xdesign.sectionOrder')
  })
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

test('the panel buttons at the foot of the rail are drawn in grey', async ({ page }) => {
  for (const id of ['toggle-layers', 'extensions']) {
    const colour = await page.locator(`[data-testid="${id}"]`).evaluate((el) => getComputedStyle(el).color)
    expect(colour).toBe('rgb(102, 102, 102)')
  }
})

test('a section is moved by dragging its title, and stays where it was put', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
  const drawnOrder = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.inspector-scroll > .section[data-section]'))
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .map((el) => el.dataset.section),
    )
  expect((await drawnOrder()).slice(0, 3)).toEqual(['transform', 'align', 'fill'])

  // Fill's title, dragged up over Transform's.
  const from = (await page.locator('[data-section="fill"] .section-title').boundingBox())!
  const to = (await page.locator('[data-section="transform"] .section-title').boundingBox())!
  await page.mouse.move(from.x + 40, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y - 10, { steps: 3 })
  await page.mouse.move(to.x + 40, to.y + 2, { steps: 8 })
  await expect(page.locator('[data-section="transform"]')).toHaveClass(/section-drop-before/)
  await page.mouse.up()
  expect((await drawnOrder()).slice(0, 3)).toEqual(['fill', 'transform', 'align'])

  // A click on a title is still only a click.
  await page.locator('[data-section="align"] .section-title').click()
  expect((await drawnOrder()).slice(0, 3)).toEqual(['fill', 'transform', 'align'])

  await page.reload()
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
  expect((await drawnOrder()).slice(0, 3)).toEqual(['fill', 'transform', 'align'])

  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-sections"]').hover()
  await page.locator('[data-testid="reset-section-order"]').click()
  expect((await drawnOrder()).slice(0, 3)).toEqual(['transform', 'align', 'fill'])
})
