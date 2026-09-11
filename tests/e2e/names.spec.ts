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
 * A name given in the Layers panel is still there on the other side of every
 * way out and back in: saved and opened again, and exported as SVG and
 * imported again.
 */

import { test, expect, type Page } from '@playwright/test'
import { captureDownload, drawShape, openApp, openExportDialog, press } from './helpers'

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

async function rename(page: Page, from: string, to: string): Promise<void> {
  await page.locator('.layer-row', { hasText: from }).first().dblclick()
  const input = page.locator('.layer-name input')
  await input.fill(to)
  await input.press('Enter')
  await expect(page.locator('.layer-row', { hasText: to })).toHaveCount(1)
}

/** A group called "header" holding a "logo" and a "nav bar". */
async function header(page: Page): Promise<void> {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 420, y: 250 })
  await rename(page, 'Rectangle', 'nav bar')
  await drawShape(page, 'ellipse', { x: 440, y: 200 }, { x: 490, y: 250 })
  await rename(page, 'Ellipse', 'logo')
  await press(page, 'a')
  await press(page, 'g')
  await rename(page, 'Group', 'header')
}

async function expandAll(page: Page): Promise<void> {
  // Opens every collapsed row, so the children's names are in the panel too.
  for (let i = 0; i < 4; i++) {
    const closed = page.locator('.layer-row [aria-expanded="false"]')
    if ((await closed.count()) === 0) break
    await closed.first().click()
  }
}

test('names come back when the document is saved and opened again', async ({ page }) => {
  await header(page)
  const saved = await captureDownload(page, () => press(page, 's'))
  expect(saved.name).toMatch(/\.xdesign$/)

  // A different document, then the saved one opened into it.
  await page.evaluate(() => { window.confirm = () => true })
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'New' }).first().click()
  await expect(page.locator('.layer-row', { hasText: 'header' })).toHaveCount(0)

  const chooser = page.waitForEvent('filechooser')
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'Open' }).first().click()
  await (await chooser).setFiles({ name: saved.name, mimeType: 'application/octet-stream', buffer: saved.buffer })

  await expect(page.locator('.layer-row', { hasText: 'header' })).toHaveCount(1)
  await expandAll(page)
  await expect(page.locator('.layer-row', { hasText: 'logo' })).toHaveCount(1)
  await expect(page.locator('.layer-row', { hasText: 'nav bar' })).toHaveCount(1)
})

test('names come back when the artwork is exported as SVG and imported again', async ({ page }) => {
  await header(page)
  const exported = await captureDownload(page, async () => {
    await openExportDialog(page)
    const exportDialog = page.locator('[role="dialog"][aria-label="Export"]')
    await exportDialog.locator('.dialog-row', { hasText: 'Format' }).locator('select').selectOption('svg')
    await page.locator('button:text-is("Export")').click()
  })
  expect(exported.buffer.toString('utf8')).toContain('data-name="header"')

  await page.evaluate(() => { window.confirm = () => true })
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'New' }).first().click()

  const chooser = page.waitForEvent('filechooser')
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: /^Import…/ }).first().click()
  await (await chooser).setFiles({ name: 'header.svg', mimeType: 'image/svg+xml', buffer: exported.buffer })

  await expandAll(page)
  await expect(page.locator('.layer-row', { hasText: 'header' })).toHaveCount(1)
  await expect(page.locator('.layer-row', { hasText: 'logo' })).toHaveCount(1)
  await expect(page.locator('.layer-row', { hasText: 'nav bar' })).toHaveCount(1)
})
