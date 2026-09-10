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
 * 3D Transforms, driven the way Adobe's help describes them: the cube in the
 * Transform section, the fields it reveals, the gizmo on the object, ⌥⌘T and
 * ⌘T, and the context menu's Reset 3D Transforms. Asserted against what is on
 * screen — the mesh in the DOM, the frame's size, where a click lands — and
 * against the file an export writes.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  captureDownload,
  clickCanvas,
  drawShape,
  dropFiles,
  modifier,
  nodesOfType,
  openApp,
  openExportDialog,
  pngSize,
  readField,
  selectionFrameBox,
  selectTool,
  setField,
} from './helpers'

const toggle = (page: Page) => page.locator('[data-testid="toggle-3d"]')
/** A plane the browser draws in perspective (CSS matrix3d inside a foreignObject). */
const plane = (page: Page) => page.locator('.document-layer .plane-3d')
/** The triangle mesh, which Chromium's canvas must not fall back to: it is what made images crawl. */
const mesh = (page: Page) => page.locator('.document-layer mask[id^="p3d-"]')

/** A 160×200 on-screen rectangle, selected, with the 3D controls shown. */
async function rectWith3d(page: Page) {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 460, y: 400 })
  await toggle(page).click()
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
}

test('the cube shows the 3D fields, and a Y rotation draws the object in perspective', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 460, y: 400 })
  const flat = (await selectionFrameBox(page))!
  await expect(page.locator('.field[title="Y rotation"]')).toHaveCount(0)

  await toggle(page).click()
  for (const title of ['X rotation', 'Y rotation', 'Z depth']) {
    await expect(page.locator(`.field[title="${title}"]`)).toBeVisible()
  }
  await setField(page, 'Y rotation', 40)

  await expect(nodesOfType(page, 'rect')).toHaveAttribute('data-3d', '')
  // Drawn by the browser in one pass, not by a mesh redrawing it per triangle.
  await expect(plane(page)).toHaveCount(1)
  await expect(mesh(page)).toHaveCount(0)
  // Turned about its vertical axis: narrower, and its near edge taller.
  const turned = (await selectionFrameBox(page))!
  expect(turned.width).toBeLessThan(flat.width - 10)
  expect(turned.height).toBeGreaterThan(flat.height + 5)
  // Adobe does not flip an object in 3D.
  await expect(page.locator('button[aria-label="Flip horizontal"]')).toBeDisabled()
})

test('an image in perspective is drawn in one pass, so zooming and panning stay smooth', async ({ page }) => {
  await openApp(page)
  // A large picture: the case where redrawing it per triangle made the canvas crawl.
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 2400
    c.height = 1600
    const x = c.getContext('2d')!
    x.fillStyle = '#3399cc'
    x.fillRect(0, 0, 2400, 1600)
    x.fillStyle = '#e84a5f'
    x.fillRect(300, 300, 900, 600)
    return c.toDataURL('image/png').split(',')[1]!
  })
  await dropFiles(page, [{ name: 'photo.png', type: 'image/png', base64 }], { x: 420, y: 320 })
  await expect(nodesOfType(page, 'image')).toHaveCount(1)
  await page.locator('.layer-row', { hasText: 'photo' }).first().click()
  await toggle(page).click()
  await setField(page, 'Y rotation', 35)
  await setField(page, 'X rotation', 15)

  await expect(plane(page)).toHaveCount(1)
  await expect(plane(page).locator('image')).toHaveCount(1)
  await expect(mesh(page)).toHaveCount(0)
})

test('dragging the gizmo turns the object, and its centre pushes it in depth', async ({ page }) => {
  await rectWith3d(page)
  const ring = (await page.locator('.gizmo-hit').boundingBox())!
  const cx = ring.x + ring.width / 2
  const cy = ring.y + ring.height / 2

  // On the rings, not the centre: sideways turns about Y, half a degree a pixel.
  await page.mouse.move(cx + 12, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 72, cy, { steps: 6 })
  // Live, before letting go: the field follows the gizmo.
  expect(await readField(page, 'Y rotation')).toBeCloseTo(30, 0)
  await page.mouse.up()
  expect(await readField(page, 'Y rotation')).toBeCloseTo(30, 0)
  await expect(plane(page)).toHaveCount(1)

  // The centre, dragged up, brings it toward you.
  const before = (await selectionFrameBox(page))!
  const dot = (await page.locator('.gizmo-centre-hit').boundingBox())!
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2)
  await page.mouse.down()
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2 - 30, { steps: 5 })
  await page.mouse.up()
  expect(await readField(page, 'Z depth')).toBeGreaterThan(20)
  const nearer = (await selectionFrameBox(page))!
  expect(nearer.height).toBeGreaterThan(before.height)
})

test('the gizmo belongs to the Select tool', async ({ page }) => {
  await rectWith3d(page)
  await expect(page.locator('.gizmo-3d')).toHaveCount(1)
  // Under any other tool a press on it would draw rather than turn, so it is
  // not offered — the object stays selected, and the gizmo comes back with Select.
  await selectTool(page, 'ellipse')
  await expect(page.locator('.gizmo-3d')).toHaveCount(0)
  await selectTool(page, 'select')
  await expect(page.locator('.gizmo-3d')).toHaveCount(1)
})

test('⌥⌘T resets the 3D transform, and ⌘T shows and hides the controls', async ({ page }) => {
  await rectWith3d(page)
  await setField(page, 'Y rotation', 40)
  await expect(plane(page)).toHaveCount(1)

  await page.keyboard.press(`${modifier()}+Alt+t`)
  await expect(plane(page)).toHaveCount(0)
  expect(await readField(page, 'Y rotation')).toBe(0)

  // One undo step brings the tilt back.
  await page.keyboard.press(`${modifier()}+z`)
  expect(await readField(page, 'Y rotation')).toBe(40)

  await page.keyboard.press(`${modifier()}+t`)
  await expect(page.locator('.field[title="Y rotation"]')).toHaveCount(0)
  await expect(page.locator('.gizmo-3d')).toHaveCount(0)
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
  // Hiding the controls leaves the object exactly as it was.
  await expect(nodesOfType(page, 'rect')).toHaveAttribute('data-3d', '')

  await page.keyboard.press(`${modifier()}+t`)
  await expect(page.locator('.field[title="Y rotation"]')).toBeVisible()
})

test('Reset 3D Transforms is on the context menu', async ({ page }) => {
  await rectWith3d(page)
  await setField(page, 'X rotation', 25)
  const frame = (await selectionFrameBox(page))!
  await page.mouse.click(frame.x + 10, frame.y + frame.height / 2, { button: 'right' })
  await page.locator('.menu-item', { hasText: /^Transform/ }).hover()
  await page.locator('.menu-item', { hasText: 'Reset 3D Transforms' }).click()
  await expect(plane(page)).toHaveCount(0)
  expect(await readField(page, 'X rotation')).toBe(0)
})

test('a click lands on the tilted shape, not on where it would be flat', async ({ page }) => {
  await rectWith3d(page)
  await setField(page, 'Y rotation', 70)
  await page.keyboard.press('Escape')
  await expect(page.locator('.selection-frame')).toHaveCount(0)

  // Inside the flat rectangle's footprint, but well clear of the turned card.
  await clickCanvas(page, { x: 450, y: 300 })
  await expect(page.locator('.selection-frame')).toHaveCount(0)
  // On the card itself.
  await clickCanvas(page, { x: 380, y: 300 })
  await expect(page.locator('.selection-frame')).toHaveCount(1)
})

test('moving a tilted object keeps its tilt and follows the pointer', async ({ page }) => {
  await rectWith3d(page)
  await setField(page, 'Y rotation', 35)
  const before = (await selectionFrameBox(page))!
  // Grab it away from the gizmo, on the card's near side.
  const from = { x: before.x + 12, y: before.y + before.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 80, from.y + 20, { steps: 8 })
  await page.mouse.up()
  const after = (await selectionFrameBox(page))!
  expect(after.x - before.x).toBeCloseTo(80, 0)
  expect(after.y - before.y).toBeCloseTo(20, 0)
  expect(after.width).toBeCloseTo(before.width, 0)
  expect(await readField(page, 'Y rotation')).toBe(35)
})

test('an artboard cannot take a 3D transform', async ({ page }) => {
  await openApp(page)
  await page.locator('.artboard-label').first().click()
  await expect(toggle(page)).toBeDisabled()
})

test('an export draws the perspective too', async ({ page }) => {
  await rectWith3d(page)
  await setField(page, 'W', 200)
  await setField(page, 'H', 300)
  await setField(page, 'Y rotation', 40)
  const dialog = page.locator('[role="dialog"][aria-label="Export"]')
  const format = dialog.locator('.dialog-row', { hasText: 'Format' }).locator('select')

  await openExportDialog(page)
  const png = await captureDownload(page, async () => {
    await format.selectOption('png')
    await page.locator('button:text-is("Export")').click()
  })
  // Cropped to the projection: narrower than the flat 200, taller than 300.
  const size = pngSize(png.buffer)
  expect(size.width).toBeLessThan(195)
  expect(size.height).toBeGreaterThan(305)

  await openExportDialog(page)
  const svg = await captureDownload(page, async () => {
    await format.selectOption('svg')
    await page.locator('button:text-is("Export")').click()
  })
  const markup = svg.buffer.toString('utf8')
  expect(markup).toContain('<mask id="p3d-')
  expect(markup).toContain('shape-rendering="crispEdges"')
})
