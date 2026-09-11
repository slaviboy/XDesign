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
 * Pasting from another application.
 *
 * The one thing worth proving here that a unit test cannot: the browser's own
 * paste event reaches the app at all. It used to not — Cmd+V called
 * preventDefault, which suppressed the event, which meant nothing copied outside
 * this app could ever get in.
 */

import { test, expect } from '@playwright/test'
import {
  CANVAS, RED_PNG_BASE64, SAMPLE_SVG, clickCanvas, drawShape, modifier, nodesOfType,
  openApp, pasteClipboard, press, selectTool,
} from './helpers'

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('pastes an image copied from another application', async ({ page }) => {
  await pasteClipboard(page, {
    files: [{ name: 'shot.png', type: 'image/png', base64: RED_PNG_BASE64 }],
  })
  await expect(nodesOfType(page, 'image')).toHaveCount(1)
})

test('pastes plain text as a text object', async ({ page }) => {
  await pasteClipboard(page, { text: 'Pasted from a browser' })

  const texts = nodesOfType(page, 'text')
  await expect(texts).toHaveCount(1)
  await expect(texts.first()).toContainText('Pasted from a browser')
})

test('pastes SVG markup as real nodes rather than a picture', async ({ page }) => {
  await pasteClipboard(page, { text: SAMPLE_SVG })

  await expect(nodesOfType(page, 'image')).toHaveCount(0)
  // The gradient rect, the circle and the path all survive as vectors.
  await expect(page.locator('.document-layer [data-node-id]')).not.toHaveCount(0)
})

test('a bitmap on the clipboard wins over a text description of it', async ({ page }) => {
  await pasteClipboard(page, {
    files: [{ name: 'shot.png', type: 'image/png', base64: RED_PNG_BASE64 }],
    text: 'shot.png',
  })
  await expect(nodesOfType(page, 'image')).toHaveCount(1)
  await expect(nodesOfType(page, 'text')).toHaveCount(0)
})

test('the paste lands inside the selected artboard', async ({ page }) => {
  // Select the artboard by clicking its name label, then paste with no point.
  await page.locator('.artboard-label').first().click()
  await pasteClipboard(page, { text: 'Into the artboard' })

  const artboardId = await page.locator('.document-layer [data-node-type="artboard"]')
    .first()
    .getAttribute('data-node-id')
  const text = nodesOfType(page, 'text').first()
  await expect(text).toHaveCount(1)

  // The text node is rendered inside the artboard's group, which is what being
  // parented to it means on screen.
  const inside = page.locator(
    `.document-layer [data-node-id="${artboardId}"] [data-node-type="text"]`,
  )
  await expect(inside).toHaveCount(1)
})

test('Cmd+V reaches the system clipboard, not just the internal one', async ({ page }) => {
  // The regression guard, and the reason this file exists. Cmd+V used to call
  // preventDefault, which suppressed the browser's paste event — so nothing
  // copied outside this app could get in by keyboard. Put something on the real
  // clipboard, press the real keys, and see whether it arrives.
  await page.evaluate(() => navigator.clipboard.writeText('Copied elsewhere'))

  await page.locator(CANVAS).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press(`${modifier()}+v`)
  // Longer than the 150ms internal fallback, so a pass here means the native
  // paste event fired rather than the fallback covering for it.
  await page.waitForTimeout(1200)

  const texts = nodesOfType(page, 'text')
  await expect(texts).toHaveCount(1)
  await expect(texts.first()).toContainText('Copied elsewhere')
})

test('copying inside the app still duplicates rather than re-importing markup', async ({ page }) => {
  await drawShape(page, 'rect', { x: 120, y: 120 }, { x: 220, y: 200 })
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)

  await press(page, 'c')
  await press(page, 'v')
  await page.waitForTimeout(600)

  // A full-fidelity duplicate: still a rect, and still exactly two of them. A
  // round trip through the SVG we wrote to the OS clipboard would land a group.
  await expect(nodesOfType(page, 'rect')).toHaveCount(2)
})

test('a copied artboard pastes beside the original, contents and all', async ({ page }) => {
  // It used to nest inside the artboard it was copied from: listed in Layers,
  // never drawn, impossible to click.
  await drawShape(page, 'rect', { x: 120, y: 120 }, { x: 220, y: 200 })
  await page.locator('.artboard-label').first().click()
  await press(page, 'c')
  await press(page, 'v')
  await page.waitForTimeout(600)

  const boards = nodesOfType(page, 'artboard')
  await expect(boards).toHaveCount(2)
  const ids = await boards.evaluateAll((els) => els.map((el) => el.getAttribute('data-node-id')))
  for (const id of ids) {
    // Neither draws inside the other, and each carries its own rect.
    await expect(page.locator(`.document-layer [data-node-id="${id}"] [data-node-type="artboard"]`)).toHaveCount(0)
    await expect(page.locator(`.document-layer [data-node-id="${id}"] [data-node-type="rect"]`)).toHaveCount(1)
  }

  const labels = page.locator('.artboard-label')
  await expect(labels).toHaveText(['Artboard 1', 'Artboard 2'])
  const [original, copy] = [await labels.nth(0).boundingBox(), await labels.nth(1).boundingBox()]
  expect(copy!.x).toBeGreaterThan(original!.x + original!.width)
})

test('right-click Copy then Paste on an artboard pastes the artboard, not a picture of it', async ({ page }) => {
  // The menu Paste has to read the clipboard itself, where the PNG written for
  // other applications sits beside the stamped markup that says the copy is ours.
  await drawShape(page, 'rect', { x: 120, y: 120 }, { x: 220, y: 200 })
  await page.locator('.artboard-label').first().click({ button: 'right' })
  await page.locator('.menu-item', { hasText: 'Copy' }).first().click()

  const canvas = await page.locator(CANVAS).boundingBox()
  await page.locator(CANVAS).click({ button: 'right', position: { x: canvas!.width - 20, y: canvas!.height - 20 } })
  await page.locator('.menu-item', { hasText: 'Paste' }).first().click()
  await page.waitForTimeout(800)

  await expect(nodesOfType(page, 'image')).toHaveCount(0)
  await expect(nodesOfType(page, 'artboard')).toHaveCount(2)
  await expect(nodesOfType(page, 'rect')).toHaveCount(2)
  await expect(page.locator('.artboard-label')).toHaveText(['Artboard 1', 'Artboard 2'])
})

test.describe('several artboards picked by Shift+clicking their names', () => {
  const label = (page: import('@playwright/test').Page, name: string) =>
    page.locator('.artboard-label', { hasText: new RegExp(`^${name}$`) })

  test.beforeEach(async ({ page }) => {
    // A second artboard to pick, then everything in view.
    await label(page, 'Artboard 1').click()
    await press(page, 'c')
    await press(page, 'v')
    await expect(page.locator('.artboard-label')).toHaveText(['Artboard 1', 'Artboard 2'])
    await press(page, '0')
    await page.waitForTimeout(300)
  })

  test('Shift+click adds an artboard and takes it out again', async ({ page }) => {
    await label(page, 'Artboard 1').click()
    await label(page, 'Artboard 2').click({ modifiers: ['Shift'] })
    await expect(page.locator('.artboard-label.selected')).toHaveCount(2)

    await label(page, 'Artboard 2').click({ modifiers: ['Shift'] })
    await expect(page.locator('.artboard-label.selected')).toHaveText(['Artboard 1'])

    // A plain click on one of several narrows to it.
    await label(page, 'Artboard 2').click({ modifiers: ['Shift'] })
    await label(page, 'Artboard 2').click()
    await expect(page.locator('.artboard-label.selected')).toHaveText(['Artboard 2'])
  })

  test('the keyboard copies and pastes them all', async ({ page }) => {
    await label(page, 'Artboard 1').click()
    await label(page, 'Artboard 2').click({ modifiers: ['Shift'] })
    await press(page, 'c')
    await press(page, 'v')
    await page.waitForTimeout(600)

    await expect(nodesOfType(page, 'image')).toHaveCount(0)
    await expect(page.locator('.artboard-label')).toHaveText(['Artboard 1', 'Artboard 2', 'Artboard 3', 'Artboard 4'])
    await expect(page.locator('.document-layer [data-node-type="artboard"] [data-node-type="artboard"]')).toHaveCount(0)
    await expect(page.locator('.artboard-label.selected')).toHaveText(['Artboard 3', 'Artboard 4'])
  })

  test('right-click Copy and Paste copies them all', async ({ page }) => {
    await label(page, 'Artboard 1').click()
    await label(page, 'Artboard 2').click({ modifiers: ['Shift'] })
    // Right-clicking one of the two keeps both.
    await label(page, 'Artboard 2').click({ button: 'right' })
    await page.locator('.menu-item', { hasText: 'Copy' }).first().click()

    const canvas = await page.locator(CANVAS).boundingBox()
    await page.locator(CANVAS).click({ button: 'right', position: { x: canvas!.width / 2, y: canvas!.height - 20 } })
    await page.locator('.menu-item', { hasText: 'Paste' }).first().click()
    await page.waitForTimeout(800)

    await expect(nodesOfType(page, 'image')).toHaveCount(0)
    await expect(page.locator('.artboard-label')).toHaveText(['Artboard 1', 'Artboard 2', 'Artboard 3', 'Artboard 4'])
    await expect(page.locator('.document-layer [data-node-type="artboard"] [data-node-type="artboard"]')).toHaveCount(0)
  })
})

test('right-click Copy then Paste on a text object pastes the text object', async ({ page }) => {
  // All-text copies put the characters on the clipboard, not the stamped markup,
  // so there is no stamp to find — the paste has to recognise the text itself.
  await selectTool(page, 'text')
  await clickCanvas(page, { x: 200, y: 200 })
  await page.keyboard.type('Headline')
  await page.keyboard.press('Escape')
  await expect(nodesOfType(page, 'text')).toHaveCount(1)

  await nodesOfType(page, 'text').first().click({ button: 'right' })
  await page.locator('.menu-item', { hasText: 'Copy' }).first().click()
  await page.waitForTimeout(800)
  await page.locator(CANVAS).click({ button: 'right', position: { x: 300, y: 300 } })
  await page.locator('.menu-item', { hasText: 'Paste' }).first().click()
  await page.waitForTimeout(800)

  await expect(nodesOfType(page, 'image')).toHaveCount(0)
  await expect(nodesOfType(page, 'text')).toHaveCount(2)
})

test('copying puts a picture on the clipboard, for applications that want one', async ({ page }) => {
  await drawShape(page, 'rect', { x: 120, y: 120 }, { x: 240, y: 200 })
  await press(page, 'c')

  // The PNG is rasterized asynchronously, so give the write a moment to land.
  await expect
    .poll(async () => page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      return items.flatMap((i) => i.types)
    }), { timeout: 10_000 })
    .toContain('image/png')

  // And it is a real PNG, not an empty placeholder.
  const size = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const item = items.find((i) => i.types.includes('image/png'))!
    return (await item.getType('image/png')).size
  })
  expect(size).toBeGreaterThan(100)
})

test('copying text puts the characters on the clipboard, not markup', async ({ page }) => {
  await selectTool(page, 'text')
  await clickCanvas(page, { x: 200, y: 200 })
  await page.keyboard.type('Just the words')
  await page.keyboard.press('Escape')
  await press(page, 'c')

  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 })
    .toBe('Just the words')
})

test('the app menu pastes what another application copied', async ({ page }) => {
  // The one path with no clipboard event behind it: the menu has to ask for the
  // clipboard rather than being handed it.
  await page.evaluate(() => navigator.clipboard.writeText('From the menu'))

  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'Paste' }).first().click()
  await page.waitForTimeout(800)

  const texts = nodesOfType(page, 'text')
  await expect(texts).toHaveCount(1)
  await expect(texts.first()).toContainText('From the menu')
})

test('right-click Paste is offered even with an empty internal clipboard', async ({ page }) => {
  await clickCanvas(page, { x: 400, y: 400 })
  await page.locator(CANVAS).click({ button: 'right', position: { x: 400, y: 400 } })

  const paste = page.locator('.menu-item', { hasText: 'Paste' }).first()
  await expect(paste).toBeVisible()
  await expect(paste).toBeEnabled()
})
