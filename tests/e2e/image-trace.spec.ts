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
 * Image Trace, end to end in a real browser.
 *
 * The engine has its own unit suites; what only a browser can prove is that the
 * pieces are actually connected — that the worker starts, that a slider
 * re-traces, that the preview replaces the picture on canvas, and that pressing
 * Trace leaves editable paths behind.
 */

import { test, expect } from '@playwright/test'
import { CANVAS, modifier, nodesOfType, openApp, pasteClipboard } from './helpers'

/**
 * A 24x24 PNG: a black disc on white. Big enough to trace into a recognisable
 * shape, small enough to inline and to trace in milliseconds.
 */
async function placeTraceableImage(page: import('@playwright/test').Page): Promise<void> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 24
    canvas.height = 24
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 24, 24)
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.arc(12, 12, 9, 0, Math.PI * 2)
    ctx.fill()
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  await pasteClipboard(page, { files: [{ name: 'disc.png', type: 'image/png', base64 }] })
  await expect(nodesOfType(page, 'image')).toHaveCount(1)
}

/** View ▸ Image Trace from the application menu. */
async function openTracePanel(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'View' }).first().hover()
  await page.locator('.menu-item', { hasText: 'Image Trace' }).first().click()
  await expect(page.locator('.image-trace-panel')).toBeVisible()
}

/** The panel's Paths readout, once a trace has produced one. */
function pathsReadout(page: import('@playwright/test').Page) {
  return page.locator('.trace-readout').first().locator('.trace-readout-value')
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await placeTraceableImage(page)
})

test('traces a selected image into editable paths', async ({ page }) => {
  await openTracePanel(page)

  // The worker returns a result, and the panel reports what it found.
  await expect(pathsReadout(page)).not.toHaveText('—', { timeout: 20_000 })
  await expect(page.locator('.trace-preview path')).not.toHaveCount(0)

  await page.locator('.trace-buttons .button.primary').click()

  // The image is gone; a group of real paths stands where it was.
  await expect(nodesOfType(page, 'image')).toHaveCount(0)
  await expect(nodesOfType(page, 'group')).toHaveCount(1)
  await expect(nodesOfType(page, 'path')).not.toHaveCount(0)
  await expect(page.locator('.image-trace-panel')).toHaveCount(0)
})

test('one undo brings the picture back', async ({ page }) => {
  await openTracePanel(page)
  await expect(pathsReadout(page)).not.toHaveText('—', { timeout: 20_000 })
  await page.locator('.trace-buttons .button.primary').click()
  await expect(nodesOfType(page, 'image')).toHaveCount(0)

  await page.keyboard.press(`${modifier()}+z`)
  await expect(nodesOfType(page, 'image')).toHaveCount(1)
  await expect(nodesOfType(page, 'path')).toHaveCount(0)
})

test('the preview replaces the picture, and Source brings it back', async ({ page }) => {
  await openTracePanel(page)
  await expect(pathsReadout(page)).not.toHaveText('—', { timeout: 20_000 })

  // Tracing Result: the bitmap is not drawn at all, only the vectors.
  await expect(page.locator('.document-layer image')).toHaveCount(0)

  await page.locator('.trace-row', { hasText: 'View' }).locator('select').selectOption('source')
  await expect(page.locator('.document-layer image')).toHaveCount(1)
  await expect(page.locator('.trace-preview path')).toHaveCount(0)

  // Outlines with Source shows both at once.
  await page.locator('.trace-row', { hasText: 'View' }).locator('select').selectOption('outlines-source')
  await expect(page.locator('.document-layer image')).toHaveCount(1)
  await expect(page.locator('.trace-preview .trace-outline')).not.toHaveCount(0)
})

test('a preset changes the result, and adjusting one lands on Custom', async ({ page }) => {
  await openTracePanel(page)
  await expect(pathsReadout(page)).not.toHaveText('—', { timeout: 20_000 })

  const presets = page.locator('.trace-row', { hasText: 'Preset' }).locator('select')
  await expect(presets).toHaveValue('default')

  // Threshold is the black-and-white control; moving it is a real re-trace.
  const threshold = page.locator('.trace-slider', { hasText: 'Threshold' }).locator('input[type="range"]')
  await threshold.fill('30')
  await expect(presets).toHaveValue('__custom__')
  await expect(pathsReadout(page)).not.toHaveText('—', { timeout: 20_000 })
})

test('switching to colour offers a palette and traces in colour', async ({ page }) => {
  await openTracePanel(page)
  await expect(pathsReadout(page)).not.toHaveText('—', { timeout: 20_000 })

  await page.locator('.trace-row', { hasText: 'Mode' }).locator('select').selectOption('color')
  await expect(page.locator('.trace-row', { hasText: 'Palette' })).toBeVisible()
  await expect(pathsReadout(page)).not.toHaveText('—', { timeout: 20_000 })

  await page.locator('.trace-buttons .button.primary').click()
  await expect(nodesOfType(page, 'image')).toHaveCount(0)
  await expect(nodesOfType(page, 'path')).not.toHaveCount(0)
})

test('Escape closes the panel and leaves the image alone', async ({ page }) => {
  await openTracePanel(page)
  await expect(pathsReadout(page)).not.toHaveText('—', { timeout: 20_000 })

  await page.locator(CANVAS).press('Escape')
  await expect(page.locator('.image-trace-panel')).toHaveCount(0)
  await expect(nodesOfType(page, 'image')).toHaveCount(1)
  await expect(page.locator('.trace-preview')).toHaveCount(0)
})

test('Image Trace is offered only for an image', async ({ page }) => {
  // With the image selected the menu item is live.
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'View' }).first().hover()
  await expect(page.locator('.menu-item', { hasText: 'Image Trace' }).first()).toBeEnabled()
  await page.keyboard.press('Escape')

  // With nothing selected it is not.
  await page.locator(CANVAS).click({ position: { x: 12, y: 12 } })
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'View' }).first().hover()
  await expect(page.locator('.menu-item', { hasText: 'Image Trace' }).first()).toBeDisabled()
})
