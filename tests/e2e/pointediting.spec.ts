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
 * The two pointers, and what they do to points.
 *
 * Most of this is about gestures that cannot be unit-tested: which tool owns a
 * click, whether switching tools picks up what is already selected, and whether
 * a drag moves one thing or several.
 */

import { test, expect } from '@playwright/test'
import {
  CANVAS, clickCanvas, dragOnCanvas, drawShape, nodesOfType, openApp, readField, selectTool,
} from './helpers'

/** A line from (200,200) to (400,200), left selected. */
async function drawLine(page: import('@playwright/test').Page) {
  await drawShape(page, 'line', { x: 200, y: 200 }, { x: 400, y: 200 })
  await expect(nodesOfType(page, 'line')).toHaveCount(1)
}

function anchors(page: import('@playwright/test').Page) {
  return page.locator('.path-points .anchor-point')
}

function selectedAnchors(page: import('@playwright/test').Page) {
  return page.locator('.path-points .anchor-point.selected')
}

/** The path data of the one shape on the canvas. */
async function pathData(page: import('@playwright/test').Page) {
  return page.locator('.document-layer [data-node-id] path').first().getAttribute('d')
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('Direct Selection selects a segment instead of adding a point to it', async ({ page }) => {
  await drawLine(page)
  await selectTool(page, 'direct-select')
  await clickCanvas(page, { x: 300, y: 200 })

  // Two ends, still. Clicking a line used to leave a third anchor behind.
  await expect(anchors(page)).toHaveCount(2)
  await expect(page.locator('.path-points .selected-segment')).toHaveCount(1)
})

test('the Pen is the tool that adds points to a line', async ({ page }) => {
  await drawLine(page)
  await selectTool(page, 'direct-select')
  await clickCanvas(page, { x: 250, y: 200 })
  await expect(anchors(page)).toHaveCount(2)

  // Direct Selection left the line's points open, and the Pen adopts them, so
  // its first click on the outline inserts. There used to be a wake-up click
  // before this one — the Pen could only react to a click, and on the canvas a
  // click is how you start a new path, so the two were ambiguous.
  await selectTool(page, 'pen')
  await expect(anchors(page)).toHaveCount(2)
  await clickCanvas(page, { x: 300, y: 200 })
  await expect(anchors(page)).toHaveCount(3)
})

test('switching to Direct Selection picks up what is already selected', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 340, y: 300 })
  await selectTool(page, 'select')
  await clickCanvas(page, { x: 270, y: 250 })
  await expect(page.locator('.selection-frame')).toHaveCount(1)

  // No second click: the tool wakes up onto the existing selection.
  await selectTool(page, 'direct-select')
  await expect(anchors(page)).toHaveCount(4)
})

test('switching back to Select shows the box, not the points', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 340, y: 300 })
  await selectTool(page, 'direct-select')
  await clickCanvas(page, { x: 270, y: 250 })
  await expect(anchors(page)).toHaveCount(4)

  await selectTool(page, 'select')
  await expect(anchors(page)).toHaveCount(0)
  await expect(page.locator('.selection-frame')).toHaveCount(1)
})

test('Shift click adds objects to the selection and takes them back out', async ({ page }) => {
  await drawShape(page, 'rect', { x: 120, y: 120 }, { x: 200, y: 200 })
  await drawShape(page, 'ellipse', { x: 260, y: 120 }, { x: 340, y: 200 })
  await selectTool(page, 'select')

  await clickCanvas(page, { x: 160, y: 160 })
  await expect(page.locator('.layer-row.selected')).toHaveCount(1)

  await clickCanvas(page, { x: 300, y: 160 }, { modifiers: ['Shift'] })
  await expect(page.locator('.layer-row.selected')).toHaveCount(2)

  await clickCanvas(page, { x: 300, y: 160 }, { modifiers: ['Shift'] })
  await expect(page.locator('.layer-row.selected')).toHaveCount(1)
})

test('Shift click collects points, and a drag moves all of them', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 340, y: 300 })
  await selectTool(page, 'direct-select')
  await clickCanvas(page, { x: 270, y: 250 })
  await expect(anchors(page)).toHaveCount(4)

  await clickCanvas(page, { x: 200, y: 200 })
  await expect(selectedAnchors(page)).toHaveCount(1)
  await clickCanvas(page, { x: 340, y: 200 }, { modifiers: ['Shift'] })
  await expect(selectedAnchors(page)).toHaveCount(2)

  // Drag one of the two: the other comes with it, and the shape updates as it
  // goes rather than on release.
  const before = await pathData(page)
  const heightBefore = await readField(page, 'H')
  await dragOnCanvas(page, { x: 340, y: 200 }, { x: 340, y: 160 })
  expect(await pathData(page)).not.toBe(before)

  await expect(selectedAnchors(page)).toHaveCount(2)
  // Both top corners rose and the bottom two did not, so the shape is taller
  // by however far they went. Measured through the inspector, because a path's
  // own `d` is in its local space and says nothing about where it sits.
  expect(await readField(page, 'H')).toBeGreaterThan(heightBefore + 30)
})

test('a segment drags both of its ends, and only those', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 340, y: 300 })
  await selectTool(page, 'direct-select')
  await clickCanvas(page, { x: 270, y: 250 })

  const heightBefore = await readField(page, 'H')
  const widthBefore = await readField(page, 'W')

  // Grab the top edge between its corners.
  await dragOnCanvas(page, { x: 270, y: 200 }, { x: 270, y: 170 })

  // Both ends of that edge came up, so the rectangle is taller and no wider.
  expect(await readField(page, 'H')).toBeGreaterThan(heightBefore + 30)
  expect(await readField(page, 'W')).toBeCloseTo(widthBefore, 1)
})

test('double-click rounds a corner, and double-click straightens it again', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 340, y: 300 })
  await selectTool(page, 'direct-select')
  await clickCanvas(page, { x: 270, y: 250 })
  await expect(anchors(page)).toHaveCount(4)

  await page.locator(CANVAS).dblclick({ position: { x: 200, y: 200 } })
  // A rounded point has handles; a corner has none.
  await expect(page.locator('.path-points .bezier-handle')).not.toHaveCount(0)

  // The same gesture back the other way. Straightening used to be a SINGLE
  // click, which fired on the way out of any press that landed on a rounded
  // point and went nowhere — so selecting a point to look at it flattened the
  // curve through it.
  await page.waitForTimeout(600)
  await clickCanvas(page, { x: 200, y: 200 })
  await expect(page.locator('.path-points .bezier-handle')).not.toHaveCount(0)

  await page.waitForTimeout(600)
  await page.locator(CANVAS).dblclick({ position: { x: 200, y: 200 } })
  await expect(page.locator('.path-points .bezier-handle')).toHaveCount(0)
})

test('the Pen picks up the selected path, and carries on drawing it', async ({ page }) => {
  // Choosing the Pen used to need a click on the object to wake it up — and
  // with the Pen that click is ambiguous, because a click on the canvas is how
  // you start a NEW path.
  await drawLine(page)
  await selectTool(page, 'direct-select')
  await clickCanvas(page, { x: 300, y: 200 })
  await expect(anchors(page)).toHaveCount(2)

  await selectTool(page, 'pen')
  await expect(anchors(page), 'the Pen adopts the selection with no click').toHaveCount(2)

  // Click the open end and keep going: this must extend the SAME object rather
  // than leaving an unrelated path beside it.
  await clickCanvas(page, { x: 400, y: 200 })
  await clickCanvas(page, { x: 450, y: 260 })
  await clickCanvas(page, { x: 510, y: 210 })
  await page.keyboard.press('Enter')

  await expect(nodesOfType(page, 'line')).toHaveCount(0)
  await expect(nodesOfType(page, 'path')).toHaveCount(1)

  await selectTool(page, 'direct-select')
  await clickCanvas(page, { x: 350, y: 200 })
  await expect(anchors(page), 'two original points plus the two placed').toHaveCount(4)
})

test('the Pen hands the object back to the pointers', async ({ page }) => {
  await drawLine(page)
  await selectTool(page, 'pen')
  await expect(anchors(page)).toHaveCount(2)

  // Select shows the box, not the points, and does it on arrival.
  await selectTool(page, 'select')
  await expect(anchors(page)).toHaveCount(0)
  await expect(page.locator('.selection-frame')).toHaveCount(1)

  // And Direct Selection takes the points straight back.
  await selectTool(page, 'direct-select')
  await expect(anchors(page)).toHaveCount(2)
})

// ---------------------------------------------------------------------------
// Selecting and moving points the way the documentation describes
// ---------------------------------------------------------------------------

test('a marquee over the points selects them, and Shift adds to that', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 400, y: 320 })
  await selectTool(page, 'direct-select')
  await clickCanvas(page, { x: 300, y: 260 })
  await expect(anchors(page)).toHaveCount(4)

  // "To select multiple anchor points … marquee select the anchor points."
  // A band over the two left corners, drawn from empty space beside them.
  await dragOnCanvas(page, { x: 150, y: 160 }, { x: 250, y: 360 })
  await expect(selectedAnchors(page)).toHaveCount(2)

  // Shift adds the right-hand pair rather than starting again.
  await dragOnCanvas(page, { x: 360, y: 160 }, { x: 450, y: 360 }, { modifiers: ['Shift'] })
  await expect(selectedAnchors(page)).toHaveCount(4)

  // And a band over nothing clears it, as a click on empty space does.
  await dragOnCanvas(page, { x: 480, y: 400 }, { x: 560, y: 460 })
  await expect(selectedAnchors(page)).toHaveCount(0)
  // The points are still on screen: the marquee selects, it does not deselect
  // the object out from under itself.
  await expect(anchors(page)).toHaveCount(4)
})

test('the arrow keys nudge the selected points, not the whole object', async ({ page }) => {
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 400, y: 320 })
  await selectTool(page, 'direct-select')
  await clickCanvas(page, { x: 300, y: 260 })
  const before = await pathData(page)

  // "Nudge the selected anchor points using your keyboard." One corner only,
  // so the shape changes rather than moving.
  await dragOnCanvas(page, { x: 150, y: 160 }, { x: 250, y: 240 })
  await expect(selectedAnchors(page)).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')

  // The corner alone moved: the three others are where they were, which is
  // what tells this apart from the whole object sliding right.
  expect(before).toBe('M0 0 L333.3333 0 L333.3333 200 L0 200 Z')
  expect(await pathData(page)).toBe('M2 0 L333.3333 0 L333.3333 200 L0 200 L2 0 Z')

  // Shift takes the larger step.
  await page.keyboard.press('Shift+ArrowRight')
  expect(await pathData(page)).toBe('M12 0 L333.3333 0 L333.3333 200 L0 200 L12 0 Z')
})
