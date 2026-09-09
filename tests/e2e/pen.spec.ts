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
 * The Pen tool's XD procedures, driven through the real canvas.
 *
 * The unit tests pin the geometry; these pin that the gestures are actually
 * reachable with a mouse — that the modifiers arrive, that the overlay shows
 * what is being built, and that the path lands in the document.
 */

import { test, expect, type Page } from '@playwright/test'
import { CANVAS, nodesOfType, openApp, selectTool } from './helpers'

async function pt(page: Page, x: number, y: number) {
  const box = await page.locator(CANVAS).boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return { x: box.x + x, y: box.y + y }
}

async function click(page: Page, x: number, y: number, keys: string[] = []) {
  const p = await pt(page, x, y)
  for (const k of keys) await page.keyboard.down(k)
  await page.mouse.click(p.x, p.y)
  for (const k of keys) await page.keyboard.up(k)
}

/** Press at (x,y) and drag to (hx,hy) — pulls handles out of the new anchor. */
async function dragOut(page: Page, x: number, y: number, hx: number, hy: number, keys: string[] = []) {
  const a = await pt(page, x, y)
  const b = await pt(page, hx, hy)
  for (const k of keys) await page.keyboard.down(k)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.mouse.up()
  for (const k of keys) await page.keyboard.up(k)
}

const pathD = (page: Page) =>
  nodesOfType(page, 'path').locator('path').first().getAttribute('d')

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'pen')
})

test('clicks draw straight lines, and the first point closes the path', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await click(page, 320, 320)
  await click(page, 200, 200)

  const d = (await pathD(page))!
  expect(d).toMatch(/Z\s*$/)
  expect(d).not.toContain('C')
})

test('dragging pulls out handles and draws a curve', async ({ page }) => {
  await dragOut(page, 200, 300, 260, 300)
  await dragOut(page, 340, 220, 400, 220)
  await page.keyboard.press('Enter')
  expect((await pathD(page))!).toContain('C')
})

test('a curve can be followed by a straight line (Alt retracts the handle)', async ({ page }) => {
  await dragOut(page, 200, 300, 260, 300)
  await dragOut(page, 340, 240, 400, 240)
  // Alt-click the anchor just placed: its outgoing handle goes, so the next
  // segment leaves straight while the curve into it keeps its shape.
  await click(page, 340, 240, ['Alt'])
  await click(page, 460, 240)
  await page.keyboard.press('Enter')

  const d = (await pathD(page))!
  expect(d).toContain('C')
  expect(d.trimEnd()).toMatch(/L[\d.\s-]+$/)
})

test('two curves can meet at a corner (Alt splits the direction lines)', async ({ page }) => {
  await dragOut(page, 200, 300, 260, 300)
  await dragOut(page, 340, 220, 400, 280, ['Alt'])
  await dragOut(page, 460, 300, 520, 300)
  await page.keyboard.press('Enter')
  // Three smooth-ish joints would be one long S; the cusp shows up as more than
  // one curve command with a direction change at the middle anchor.
  const d = (await pathD(page))!
  expect((d.match(/C/g) ?? []).length).toBeGreaterThanOrEqual(2)
})

test('Shift constrains a new point to 45 degrees', async ({ page }) => {
  await click(page, 200, 300)
  await click(page, 330, 310, ['Shift'])
  await page.keyboard.press('Enter')
  // 10px of drift over 130 snaps flat, so the path is a horizontal line.
  const d = (await pathD(page))!
  expect(d).toMatch(/^M0 0 L[\d.]+ 0\s*$/)
})

test('the overlay previews the pending segment as the curve it will be', async ({ page }) => {
  await dragOut(page, 200, 300, 280, 300)
  const at = await pt(page, 380, 240)
  await page.mouse.move(at.x, at.y)
  // Not a straight rubber band: the previous anchor's handle bends it.
  const rubber = await page.locator('.pen-rubber').getAttribute('d')
  expect(rubber).toContain('C')
  await page.keyboard.press('Escape')
})

test('handles are visible while the curve is being drawn', async ({ page }) => {
  const a = await pt(page, 200, 300)
  const b = await pt(page, 280, 260)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await expect(page.locator('.pen-preview .bezier-handle')).toHaveCount(2)
  await expect(page.locator('.pen-preview .handle-arm')).toHaveCount(2)
  await page.mouse.up()
  await page.keyboard.press('Escape')
})

test('dragging from the first point shapes the closing curve', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 340, 200)
  await click(page, 340, 320)
  await dragOut(page, 200, 200, 160, 280)

  const d = (await pathD(page))!
  expect(d).toMatch(/Z\s*$/)
  expect(d).toContain('C')
})

test('Escape ends the open path rather than throwing it away', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await click(page, 320, 320)
  await page.keyboard.press('Escape')

  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  expect((await pathD(page))!).not.toMatch(/Z\s*$/)
  // And it returns to the selection tool, as XD does.
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true')
})

test('double-clicking an anchor converts it corner to smooth', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await click(page, 320, 320)
  await page.keyboard.press('Enter')
  expect((await pathD(page))!).not.toContain('C')

  // Enter point editing, then double-click the middle anchor.
  await selectTool(page, 'select')
  const mid = await pt(page, 320, 200)
  await page.locator(CANVAS).dblclick({ position: { x: 260, y: 200 } })
  await expect(page.locator('.anchor-point')).toHaveCount(3)
  await page.mouse.dblclick(mid.x, mid.y)

  expect((await pathD(page))!).toContain('C')
})

test('the pen extends an existing open path instead of starting a second one', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await click(page, 320, 320)
  await page.keyboard.press('Enter')
  await expect(nodesOfType(page, 'path')).toHaveCount(1)

  await selectTool(page, 'pen')
  // Clicking the open end picks the path back up for DRAWING rather than
  // dropping another anchor on top of the one already there — which is what it
  // used to do, leaving a zero-length segment behind. So the count is unchanged
  // until a click actually places a point somewhere new.
  await click(page, 320, 320)
  await click(page, 400, 380)
  await page.keyboard.press('Enter')

  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  await selectTool(page, 'direct-select')
  await click(page, 320, 260)
  await expect(page.locator('.anchor-point')).toHaveCount(4)
})
