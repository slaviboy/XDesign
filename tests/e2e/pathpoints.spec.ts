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
 * Point editing: live feedback, line endpoints, and the Direct Selection tool.
 *
 * The live assertions all read the rendered `d` MID-drag, before pointerup —
 * that is the whole defect being pinned. An after-the-fact check would have
 * passed against the old code, which only updated on release.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  CANVAS, drawShape, nodesOfType, openApp, press, selectTool,
} from './helpers'

async function pt(page: Page, x: number, y: number) {
  const box = await page.locator(CANVAS).boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return { x: box.x + x, y: box.y + y }
}

const shapeD = (page: Page, type: string) =>
  nodesOfType(page, type).locator('path').first().getAttribute('d')

/** Double-click a shape to show its points. */
async function enterPoints(page: Page, at: { x: number; y: number }) {
  const p = await pt(page, at.x, at.y)
  await page.mouse.dblclick(p.x, p.y)
}

// ------------------------------------------------------------------- live --

test('a point follows the pointer while the mouse is down', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 400, y: 360 })
  await enterPoints(page, { x: 300, y: 280 })
  await expect(page.locator('.anchor-point')).toHaveCount(4)

  const before = await shapeD(page, 'rect')
  const corner = await pt(page, 200, 200)
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 10 })

  // MID-drag the node is still a rect — conversion happens on commit — but its
  // drawn outline must already have moved. This is the whole defect: it used to
  // stay frozen until release.
  const during = await shapeD(page, 'rect')
  expect(during).not.toBe(before)
  await page.mouse.up()

  // And what was previewed is what was committed.
  expect(await shapeD(page, 'path')).toBe(during)
})

test('the anchor dots move with the point too', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 400, y: 360 })
  await enterPoints(page, { x: 300, y: 280 })

  const dotX = () => page.locator('.anchor-point').first().getAttribute('x')
  const before = await dotX()

  const corner = await pt(page, 200, 200)
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 10 })
  expect(await dotX()).not.toBe(before)
  await page.mouse.up()
})

// ------------------------------------------------------------------ lines --

test('double-clicking a line shows its two ends, and they move', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'line', { x: 200, y: 200 }, { x: 400, y: 300 })
  await enterPoints(page, { x: 300, y: 250 })
  await expect(page.locator('.anchor-point')).toHaveCount(2)

  // Still a line — looking at the points converts nothing.
  await expect(nodesOfType(page, 'line')).toHaveCount(1)

  const end = await pt(page, 400, 300)
  await page.mouse.move(end.x, end.y)
  await page.mouse.down()
  await page.mouse.move(end.x - 80, end.y + 60, { steps: 10 })
  await page.mouse.up()

  // Moving an end is a real edit, so it becomes a path — one node, not two.
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  await expect(nodesOfType(page, 'line')).toHaveCount(0)
})

test('the pen continues a line from its end instead of starting a new object', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'line', { x: 200, y: 200 }, { x: 340, y: 200 })
  await selectTool(page, 'pen')

  // Click an end to pick the line back up, then keep clicking to draw on.
  const end = await pt(page, 340, 200)
  await page.mouse.click(end.x, end.y)
  const next = await pt(page, 420, 280)
  await page.mouse.click(next.x, next.y)
  const last = await pt(page, 500, 220)
  await page.mouse.click(last.x, last.y)
  await page.keyboard.press('Enter')

  // One node, now four points long — not a second object beside the first.
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  await expect(nodesOfType(page, 'line')).toHaveCount(0)
  const d = (await shapeD(page, 'path'))!
  expect((d.match(/L/g) ?? []).length).toBe(3)
})

// -------------------------------------------------------- direct selection --

test('one click with the direct pointer shows a shape\'s points', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 400, y: 360 })
  await selectTool(page, 'direct-select')

  const inside = await pt(page, 300, 280)
  await page.mouse.click(inside.x, inside.y)

  await expect(page.locator('.anchor-point')).toHaveCount(4)
  // Points replace the transform frame and the corner-radius handles.
  await expect(page.locator('.selection-frame')).toHaveCount(0)
  await expect(page.locator('[data-handle="radius"]')).toHaveCount(0)
})

test('a shape keeps its parametric fields until a point actually moves', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'polygon', { x: 200, y: 200 }, { x: 380, y: 380 })
  await selectTool(page, 'direct-select')
  await page.mouse.click(...Object.values(await pt(page, 290, 330)) as [number, number])

  // Looking is free: still a polygon, still has Corners and Star.
  await expect(nodesOfType(page, 'polygon')).toHaveCount(1)
  await expect(page.locator('.field[title="Corner count"]')).toHaveCount(1)

  const anchor = await page.locator('.anchor-point').first().boundingBox()
  const from = { x: anchor!.x + anchor!.width / 2, y: anchor!.y + anchor!.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 8 })
  await page.mouse.up()

  // Editing a point commits to a path, and the parametric fields go with it.
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  await expect(nodesOfType(page, 'polygon')).toHaveCount(0)
  await expect(page.locator('.field[title="Corner count"]')).toHaveCount(0)

  // ...and undo brings the polygon back.
  await press(page, 'z')
  await expect(nodesOfType(page, 'polygon')).toHaveCount(1)
  await expect(page.locator('.field[title="Corner count"]')).toHaveCount(1)
})

test('handing points between the two pointers keeps them on screen', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 400, y: 360 })
  await selectTool(page, 'direct-select')
  await page.mouse.click(...Object.values(await pt(page, 300, 280)) as [number, number])
  await expect(page.locator('.anchor-point')).toHaveCount(4)

  // Both pointers own point editing, so switching between them must not drop it.
  await selectTool(page, 'select')
  await expect(page.locator('.anchor-point')).toHaveCount(4)
  await selectTool(page, 'direct-select')
  await expect(page.locator('.anchor-point')).toHaveCount(4)

  // Any other tool does drop it.
  await selectTool(page, 'rect')
  await expect(page.locator('.anchor-point')).toHaveCount(0)
})

// ---------------------------------------------------------------- outline --

test('the edited path is outlined in blue, over the fill', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 350 })
  // Nothing to outline until the points are shown.
  await expect(page.locator('.edit-outline')).toHaveCount(0)

  await enterPoints(page, { x: 330, y: 275 })
  await expect(page.locator('.edit-outline')).toHaveCount(1)

  // A real trace of the shape, not a placeholder: closed, and covering exactly
  // the same screen box as the artwork it is drawn over. A hairline stroke sits
  // astride the path, so the outline's box is the wider by that stroke.
  const d = (await page.locator('.edit-outline').getAttribute('d'))!
  expect(d).toMatch(/^M/)
  expect(d.trimEnd().endsWith('Z')).toBe(true)

  const boxes = await page.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect()
      return [r.x, r.y, r.width, r.height]
    }
    return {
      outline: box('.edit-outline'),
      shape: box('.document-layer [data-node-type="rect"] path'),
    }
  })
  for (let i = 0; i < 4; i++) {
    expect(Math.abs(boxes.outline[i] - boxes.shape[i]), `component ${i}`).toBeLessThanOrEqual(2)
  }

  // It is drawn AFTER the document layer, so it lands on top of the fill.
  const order = await page.evaluate(() => {
    const outline = document.querySelector('.edit-outline')!
    const shape = document.querySelector('.document-layer')!
    return outline.compareDocumentPosition(shape) & Node.DOCUMENT_POSITION_PRECEDING ? 'above' : 'below'
  })
  expect(order).toBe('above')

  await page.keyboard.press('Escape')
  await expect(page.locator('.edit-outline')).toHaveCount(0)
})

test('the outline follows a point while it is being dragged', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 350 })
  await enterPoints(page, { x: 330, y: 275 })

  const before = await page.locator('.edit-outline').getAttribute('d')
  const corner = await pt(page, 220, 200)
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x + 50, corner.y + 40, { steps: 8 })
  // Mid-drag, from the live point model rather than the document.
  expect(await page.locator('.edit-outline').getAttribute('d')).not.toBe(before)
  await page.mouse.up()
})

test('the direct pointer shows the outline too', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'polygon', { x: 600, y: 200 }, { x: 780, y: 370 })
  await selectTool(page, 'direct-select')
  const at = await pt(page, 690, 300)
  await page.mouse.click(at.x, at.y)
  await expect(page.locator('.edit-outline')).toHaveCount(1)
})

test('double-clicking a shape lights up the Direct Selection tool', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 420, y: 340 })
  await expect(page.locator('.tool-button.active')).toHaveAttribute('data-tool', 'select')

  await enterPoints(page, { x: 320, y: 270 })
  // The rail has to name the mode the canvas is in: the points belong to the
  // second pointer, so that is the button that lights up.
  await expect(page.locator('.tool-button.active')).toHaveAttribute('data-tool', 'direct-select')
  await expect(page.locator('.anchor-point')).toHaveCount(4)

  // And the handover kept the points alive — a tool change that dropped them
  // would leave the overlay showing anchors that no longer edit anything.
  const corner = await pt(page, 220, 200)
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x + 40, corner.y + 30, { steps: 6 })
  await page.mouse.up()
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
})
