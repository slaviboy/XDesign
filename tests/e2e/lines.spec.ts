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
 * Lines: selecting them, and resizing them.
 *
 * Both of these were reported broken and neither reproduced, so the point of
 * this file is to make the two invariants explicit and keep them that way.
 *
 * The first is that a line can be clicked at any zoom. A click target is a
 * screen distance, so zooming in must not make one harder to hit — and the
 * tolerance behind it used to be compared in the wrong units, which made the
 * effective radius depend on the zoom and on any scaling above the object.
 *
 * The second is that a line's selection frame and the line itself agree at
 * every moment of a resize, not merely at the end of one. They come from two
 * different places — the frame is React reading the drag session, the geometry
 * is written straight to the DOM by LiveTransform — so nothing but a test
 * keeps them in step.
 */

import { test, expect } from '@playwright/test'
import { drawShape, openApp, selectTool } from './helpers'

/** How far the drawn line escapes its own selection frame, in screen pixels. */
async function escapesFrameBy(page: import('@playwright/test').Page): Promise<number> {
  const frame = await page.locator('.selection-frame').boundingBox()
  const line = await page.locator('.document-layer [data-node-type="line"]').boundingBox()
  if (!frame || !line) return NaN
  return Math.max(
    frame.x - line.x,
    frame.y - line.y,
    line.x + line.width - (frame.x + frame.width),
    line.y + line.height - (frame.y + frame.height),
  )
}

/** Bring the line to the middle of the view, so a click on it is a click on it. */
async function centreOnLine(page: import('@playwright/test').Page): Promise<void> {
  const size = page.viewportSize()!
  const box = await page
    .locator('.document-layer [data-node-id]:not([data-node-type="artboard"])')
    .first()
    .boundingBox()
  if (!box) return
  const dx = size.width / 2 - (box.x + box.width / 2)
  const dy = size.height / 2 - (box.y + box.height / 2)
  await page.keyboard.down('Space')
  await page.mouse.move(size.width / 2, size.height / 2)
  await page.mouse.down()
  await page.mouse.move(size.width / 2 + dx, size.height / 2 + dy, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Space')
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('a line can be clicked at any zoom', async ({ page }) => {
  await drawShape(page, 'line', { x: 300, y: 300 }, { x: 380, y: 340 })
  await selectTool(page, 'select')
  const zoom = page.locator('[data-testid="zoom-value"]')

  for (const level of ['100%', '400%', '1600%']) {
    await page.keyboard.press('Escape')
    await zoom.fill(level)
    await zoom.press('Enter')
    await centreOnLine(page)

    const box = (await page.locator('.document-layer [data-node-type="line"]').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator('.layer-row.selected'), level).toHaveCount(1)
  }
})

test('a line stays inside its frame at every moment of a resize', async ({ page }) => {
  await drawShape(page, 'line', { x: 300, y: 300 }, { x: 420, y: 370 })

  // The top-left handle: the one that moves the origin, where an anchoring
  // mistake shows up as the line sliding out of the box it is being sized by.
  const handle = (await page.locator('.resize-handle').first().boundingBox())!
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2

  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(x + step * 6, y + step * 4)
    // Never more than a stroke's width outside, at any point in the drag.
    expect(await escapesFrameBy(page), `step ${step}`).toBeLessThan(1.5)
  }
  await page.mouse.up()
  expect(await escapesFrameBy(page)).toBeLessThan(1.5)
})

test('a resized line lands where the drag left it', async ({ page }) => {
  await drawShape(page, 'line', { x: 300, y: 300 }, { x: 420, y: 370 })
  const handle = (await page.locator('.resize-handle').first().boundingBox())!
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 48, y + 32, { steps: 8 })
  const during = await page.locator('.document-layer [data-node-type="line"]').boundingBox()
  await page.mouse.up()
  const after = await page.locator('.document-layer [data-node-type="line"]').boundingBox()

  // Releasing must not move it: a preview that has to be corrected on commit
  // is a preview of something else.
  expect(after!.x).toBeCloseTo(during!.x, 0)
  expect(after!.y).toBeCloseTo(during!.y, 0)
  expect(after!.width).toBeCloseTo(during!.width, 0)
  expect(after!.height).toBeCloseTo(during!.height, 0)
})

test('clicking a line anywhere it is visible selects it, not just its centreline', async ({ page }) => {
  // The bug this exists for: hit-testing an OBJECT counts the stroke, so a
  // click anywhere on the visible line opened its points — but the segment test
  // used a flat screen radius, so between the two lay a band where the anchors
  // appeared and nothing was selected. You clicked what you could see, and
  // nothing moved. A thick stroke is what a thin one looks like zoomed in.
  await drawShape(page, 'line', { x: 300, y: 320 }, { x: 460, y: 320 })
  const strokeWidth = page.locator('.section', { hasText: 'STROKE' })
    .locator('.field', { has: page.locator('.field-label:text-is("W")') })
    .locator('input')
    .first()
  await strokeWidth.fill('24')
  await strokeWidth.press('Enter')
  await selectTool(page, 'direct-select')

  const shape = page.locator('.document-layer [data-node-id]:not([data-node-type="artboard"])').first()
  const box = (await shape.boundingBox())!
  const x = box.x + box.width / 2
  const middle = box.y + box.height / 2

  for (const offset of [0, 3, 6, box.height / 2]) {
    await page.keyboard.press('Escape')
    await page.mouse.click(x, middle + offset)
    // Whatever opened the points must also have selected something to drag.
    await expect(page.locator('.path-points .anchor-point'), `offset ${offset}`).toHaveCount(2)
    await expect(page.locator('.path-points .selected-segment'), `offset ${offset}`).toHaveCount(1)
  }
})

test('a segment selected on a line can be dragged', async ({ page }) => {
  await drawShape(page, 'line', { x: 300, y: 300 }, { x: 440, y: 380 })
  await selectTool(page, 'direct-select')

  const shape = page.locator('.document-layer [data-node-id]:not([data-node-type="artboard"])').first()
  const box = (await shape.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await page.mouse.click(x, y)
  await expect(page.locator('.path-points .selected-segment')).toHaveCount(1)

  const before = (await shape.boundingBox())!
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 40, y + 30, { steps: 6 })
  await page.mouse.up()

  const after = (await shape.boundingBox())!
  expect(after.x - before.x).toBeCloseTo(40, 0)
  expect(after.y - before.y).toBeCloseTo(30, 0)
})

test('an inner or outer stroke is clickable across all of it', async ({ page }) => {
  // An inner or outer stroke is drawn at DOUBLE width against a clip or a mask,
  // so its paint lands a full width to one side of the path rather than half a
  // width either side. Hit-testing took half regardless, which left the outer
  // part of a visible line unclickable — click what you can see, nothing
  // happens — and the wider the stroke the bigger the dead band.
  await drawShape(page, 'line', { x: 300, y: 320 }, { x: 460, y: 320 })
  const stroke = page.locator('.section', { hasText: 'STROKE' })
  const width = stroke.locator('.field', { has: page.locator('.field-label:text-is("W")') })
    .locator('input')
    .first()
  await width.fill('24')
  await width.press('Enter')
  await page.locator('.icon-select[title^="Stroke alignment"]').click()
  await page.locator('.menu-item', { hasText: 'Outside' }).click()
  await selectTool(page, 'select')

  const shape = page.locator('.document-layer [data-node-id]:not([data-node-type="artboard"])').first()
  const box = (await shape.boundingBox())!
  const x = box.x + box.width / 2

  // Right across the band, edge to edge.
  for (const fraction of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    await page.keyboard.press('Escape')
    await page.mouse.click(x, box.y + box.height * fraction)
    await expect(page.locator('.layer-row.selected'), `${fraction} down the stroke`).toHaveCount(1)
  }
})

test('a line stays selectable and draggable however far in you zoom', async ({ page }) => {
  await drawShape(page, 'line', { x: 300, y: 320 }, { x: 460, y: 320 })
  const zoom = page.locator('[data-testid="zoom-value"]')

  for (const level of ['400%', '1600%']) {
    await page.keyboard.press('Escape')
    await selectTool(page, 'direct-select')
    await zoom.fill(level)
    await zoom.press('Enter')
    await centreOnLine(page)

    const shape = page.locator('.document-layer [data-node-id]:not([data-node-type="artboard"])').first()
    const box = (await shape.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2

    // Clicking it selects it, and selects something that can be dragged.
    await page.mouse.click(x, y)
    await expect(page.locator('.layer-row.selected'), level).toHaveCount(1)
    await expect(page.locator('.path-points .selected-segment'), level).toHaveCount(1)

    const before = (await shape.boundingBox())!
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y - 40, { steps: 6 })
    await page.mouse.up()
    const after = (await shape.boundingBox())!
    expect(after.y - before.y, level).toBeCloseTo(-40, 0)
  }
})
