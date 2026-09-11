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
 * Dropping a .xdesign document on the canvas opens it — after asking, since
 * opening replaces what is open, and after warning, when that has unsaved
 * changes.
 */

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { drawShape, dropFiles, nodesOfType, openApp, RED_PNG_BASE64 } from './helpers'

// Playwright runs from the repository root.
const AURA = readFileSync('examples/shop-app/Aura Shopping App.xdesign').toString('base64')
// An operating system rarely knows a .xdesign's type, and hands it over as nothing.
const DOCUMENT = { name: 'Aura Shopping App.xdesign', type: '', base64: AURA }

const dialog = (page: Page) => page.locator('[role="dialog"]')

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('a saved document is replaced after a plain yes', async ({ page }) => {
  await dropFiles(page, [DOCUMENT], { x: 300, y: 300 })
  await expect(dialog(page)).toContainText('Open “Aura Shopping App.xdesign”?')
  await expect(dialog(page)).toContainText('nothing will be lost')
  await expect(page.locator('.dialog-warning')).toHaveCount(0)

  await page.locator('[data-testid="drop-open"]').click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(nodesOfType(page, 'artboard')).toHaveCount(5)
  await expect(page.locator('.doc-name')).toHaveValue('Aura — Shopping App')
})

test('unsaved changes are warned about, and Cancel keeps them', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
  await dropFiles(page, [DOCUMENT], { x: 300, y: 300 })

  await expect(page.locator('.dialog-warning')).toContainText('has unsaved changes')
  await expect(page.locator('[data-testid="drop-open"]')).toHaveCount(0)
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()

  await expect(dialog(page)).toHaveCount(0)
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
  await expect(nodesOfType(page, 'artboard')).toHaveCount(1)
})

test('Discard & Open replaces a document with unsaved changes', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
  await dropFiles(page, [DOCUMENT], { x: 300, y: 300 })
  await page.locator('[data-testid="drop-open-discard"]').click()

  await expect(nodesOfType(page, 'artboard')).toHaveCount(5)
  await expect(page.locator('.save-status')).not.toHaveClass(/dirty/)
})

test('Save & Open saves the changes first, then opens', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
  await dropFiles(page, [DOCUMENT], { x: 300, y: 300 })

  const download = page.waitForEvent('download')
  await page.locator('[data-testid="drop-open-save"]').click()
  expect((await download).suggestedFilename()).toMatch(/\.xdesign$/)
  await expect(nodesOfType(page, 'artboard')).toHaveCount(5)
})

test('a document dropped with other files is opened alone', async ({ page }) => {
  await dropFiles(page, [DOCUMENT, { name: 'red.png', type: 'image/png', base64: RED_PNG_BASE64 }], { x: 300, y: 300 })
  await expect(dialog(page)).toContainText('other file you dropped with it is not imported')
  await page.locator('[data-testid="drop-open"]').click()

  await expect(nodesOfType(page, 'artboard')).toHaveCount(5)
  // Aura's own pictures, and not the dropped PNG on top of them.
  await expect(page.locator('.layer-row', { hasText: 'red' })).toHaveCount(0)
})

test('artwork dropped without a document is still imported, with no question', async ({ page }) => {
  await dropFiles(page, [{ name: 'red.png', type: 'image/png', base64: RED_PNG_BASE64 }], { x: 300, y: 300 })
  await expect(dialog(page)).toHaveCount(0)
  await expect(nodesOfType(page, 'image')).toHaveCount(1)
})
