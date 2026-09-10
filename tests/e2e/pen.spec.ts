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
import { CANVAS, dropFiles, nodesOfType, openApp, selectTool } from './helpers'

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
  // "To toggle between drawing mode and edit mode, press the Esc key." So the
  // pen keeps the tool and the path's anchors stay on screen; it does NOT jump
  // to the pointer, which is what this used to assert.
  await expect(page.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.anchor-point')).toHaveCount(3)

  // A second Escape leaves point editing, a third leaves the tool.
  await page.keyboard.press('Escape')
  await expect(page.locator('.anchor-point')).toHaveCount(0)
  await page.keyboard.press('Escape')
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

// ---------------------------------------------------------------------------
// Working on a path that is already there
// ---------------------------------------------------------------------------

/** Draw the standard two-segment open path and hand it back via the pointer. */
async function drawAndReselect(page: Page) {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await click(page, 320, 320)
  await page.keyboard.press('Enter')
  await selectTool(page, 'select')
  await click(page, 320, 260)
  await selectTool(page, 'pen')
}

test('no resize frame is drawn over a path the pen is carrying on', async ({ page }) => {
  await drawAndReselect(page)
  await expect(page.locator('.selection-frame')).toHaveCount(0)

  // Picking the path up for drawing used to clear point editing and leave the
  // node selected, which is exactly the state that draws a transform frame —
  // so a box with resize handles appeared around the path being drawn.
  await click(page, 320, 320)
  await expect(page.locator('.pen-preview')).toHaveCount(1)
  await expect(page.locator('.selection-frame')).toHaveCount(0)
})

test('dragging a point moves it, and clicking it draws on from there', async ({ page }) => {
  await drawAndReselect(page)

  // A press on an end is two gestures wearing the same clothes, so it is the
  // release that decides. Dragged: the point moves.
  const from = await pt(page, 320, 320)
  const to = await pt(page, 260, 380)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  expect(await pathD(page)).toBe('M0 0 L200 0 L100 300')
  await expect(page.locator('.pen-preview')).toHaveCount(0)

  // Clicked: the same press carries the path on instead.
  await click(page, 260, 380)
  await expect(page.locator('.pen-preview')).toHaveCount(1)
  await click(page, 180, 440)
  await page.keyboard.press('Enter')
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  expect(await pathD(page)).toBe('M0 0 L200 0 L100 300 L-33.3333 400')
})

test('a middle point is moved by the pen too', async ({ page }) => {
  await drawAndReselect(page)
  const from = await pt(page, 320, 200)
  const to = await pt(page, 380, 160)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  expect(await pathD(page)).toBe('M0 0 L300 -66.6667 L200 200')
})

test('the pen marks where a click would add a point', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await click(page, 320, 320)
  await page.keyboard.press('Enter')
  await selectTool(page, 'select')
  await click(page, 600, 150)
  await selectTool(page, 'pen')

  // Nothing is open yet, so there is nothing to preview: the first click on an
  // object opens its points rather than adding one.
  const on = await pt(page, 320, 260)
  await page.mouse.move(on.x, on.y)
  await expect(page.locator('.insert-preview')).toHaveCount(0)
  await click(page, 320, 260)
  await expect(page.locator('.anchor-point')).toHaveCount(3)

  const lower = await pt(page, 320, 290)
  await page.mouse.move(lower.x, lower.y)
  await expect(page.locator('.insert-preview')).toHaveCount(1)
  // On the outline, not under the pointer: it says where the anchor lands.
  const marker = page.locator('.insert-preview')
  expect(Number(await marker.getAttribute('cx'))).toBeCloseTo(320, 0)
  expect(Number(await marker.getAttribute('cy'))).toBeCloseTo(290, 0)

  // Off the outline a click starts a new path, so there is nothing to promise.
  await page.mouse.move(lower.x + 200, lower.y)
  await expect(page.locator('.insert-preview')).toHaveCount(0)
})

test('clicking a second path by its end joins the two into one object', async ({ page }) => {
  await click(page, 150, 150)
  await click(page, 250, 150)
  await page.keyboard.press('Enter')
  await selectTool(page, 'pen')
  await click(page, 400, 300)
  await click(page, 500, 300)
  await page.keyboard.press('Enter')
  await expect(nodesOfType(page, 'path')).toHaveCount(2)

  await selectTool(page, 'select')
  await click(page, 200, 150)
  await selectTool(page, 'pen')
  await click(page, 250, 150)   // carry the first path on
  await click(page, 400, 300)   // and run it into the second one's end
  await page.keyboard.press('Enter')

  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  expect(await pathD(page)).toBe('M0 0 L166.6666 0 L416.6666 250 L583.3333 250')

  // One undo, not two: the join and the object it consumed are one step.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(nodesOfType(page, 'path')).toHaveCount(2)
})

test('a line can be carried on from its end, and joined to another', async ({ page }) => {
  await selectTool(page, 'line')
  await dragOut(page, 150, 500, 250, 500)
  await selectTool(page, 'line')
  await dragOut(page, 400, 560, 500, 560)
  await expect(nodesOfType(page, 'line')).toHaveCount(2)

  await selectTool(page, 'select')
  await click(page, 200, 500)
  await selectTool(page, 'pen')
  await click(page, 250, 500)
  await click(page, 400, 560)
  await page.keyboard.press('Enter')

  await expect(nodesOfType(page, 'line')).toHaveCount(0)
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  expect(await pathD(page)).toBe('M0 0 L166.6667 0 L416.6667 100 L583.3334 100')
})

test('picking a line up and putting it straight back down leaves it a line', async ({ page }) => {
  await selectTool(page, 'line')
  await dragOut(page, 200, 400, 350, 400)
  await selectTool(page, 'select')
  await click(page, 275, 400)
  await selectTool(page, 'pen')

  // Committing an unchanged path would convert the line to a path and leave an
  // undo step for a gesture that drew nothing.
  await click(page, 350, 400)
  await page.keyboard.press('Escape')
  await expect(nodesOfType(page, 'line')).toHaveCount(1)
  await expect(nodesOfType(page, 'path')).toHaveCount(0)
})

test('Alt and Shift keep their point-editing meanings on an end', async ({ page }) => {
  await drawAndReselect(page)

  // Alt-click rounds the corner rather than picking the path up to draw.
  const end = await pt(page, 320, 320)
  await page.keyboard.down('Alt')
  await page.mouse.click(end.x, end.y)
  await page.keyboard.up('Alt')
  await expect(page.locator('.pen-preview')).toHaveCount(0)
  expect((await pathD(page))!).toContain('C')

  // Shift-click adds it to the point selection rather than picking it up.
  await click(page, 320, 200)
  await page.keyboard.down('Shift')
  await page.mouse.click(end.x, end.y)
  await page.keyboard.up('Shift')
  await expect(page.locator('.anchor-point.selected')).toHaveCount(2)
  await expect(page.locator('.pen-preview')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// One anchor, one undo step
// ---------------------------------------------------------------------------

const UNDO = 'ControlOrMeta+z'
const REDO = 'ControlOrMeta+Shift+z'

test('every anchor placed is its own undo step, while the path is still being drawn', async ({ page }) => {
  // The path used to be written once, on finish, so five clicks were one undo
  // entry and a misplaced anchor could only be taken back by discarding the lot.
  await click(page, 200, 200)
  await click(page, 320, 200)
  expect(await pathD(page)).toBe('M0 0 L200 0')
  await click(page, 320, 320)
  await click(page, 420, 320)
  expect(await pathD(page)).toBe('M0 0 L200 0 L200 200 L366.6667 200')

  await page.keyboard.press(UNDO)
  await expect.poll(() => pathD(page)).toBe('M0 0 L200 0 L200 200')
  await page.keyboard.press(UNDO)
  await expect.poll(() => pathD(page)).toBe('M0 0 L200 0')
  await page.keyboard.press(REDO)
  await expect.poll(() => pathD(page)).toBe('M0 0 L200 0 L200 200')

  // And the pen is still drawing the same path throughout.
  await click(page, 420, 320)
  await page.keyboard.press('Enter')
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  expect(await pathD(page)).toBe('M0 0 L200 0 L200 200 L366.6667 200')
})

test('undoing past the first anchor leaves the pen holding it', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await expect(nodesOfType(page, 'path')).toHaveCount(1)

  // The first anchor was never in the document — there is no path with one
  // point — so it comes back from the pen rather than from the history.
  await page.keyboard.press(UNDO)
  await expect(nodesOfType(page, 'path')).toHaveCount(0)
  await expect(page.locator('.pen-preview .anchor-point')).toHaveCount(1)

  await click(page, 400, 300)
  await page.keyboard.press('Enter')
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  expect(await pathD(page)).toBe('M0 0 L333.3333 166.6667')
})

test('splitting a line leaves two lines, not two curves', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await click(page, 320, 320)
  await page.keyboard.press('Enter')
  await selectTool(page, 'select')
  await click(page, 320, 260)
  await selectTool(page, 'pen')

  await click(page, 320, 260)
  expect(await pathD(page)).toBe('M0 0 L200 0 L200 100 L200 200')
})

/**
 * The cursor the pointer shows at a point on the page. Read from whatever is
 * under it rather than from the canvas: an anchor or a handle with a cursor of
 * its own shows through a canvas that only set its own.
 */
async function cursorAt(page: Page, p: { x: number; y: number }) {
  await page.mouse.move(p.x, p.y)
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    return el ? getComputedStyle(el).cursor : null
  }, p)
}

test('the pen keeps one cursor whatever it is over', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await click(page, 320, 320)
  await page.keyboard.press('Enter')
  await selectTool(page, 'select')
  await click(page, 320, 260)
  await selectTool(page, 'pen')

  // On the outline, where a press adds a point; on an anchor, where it grabs
  // one; on an open end, where it carries on drawing; and on empty canvas.
  for (const [x, y] of [[320, 290], [320, 200], [200, 200], [600, 500]] as const) {
    const p = await pt(page, x, y)
    await expect.poll(() => cursorAt(page, p), `at ${x},${y}`).toBe('crosshair')
  }

  // And while drawing, over the path being built.
  await click(page, 600, 500)
  const next = await pt(page, 650, 520)
  await expect.poll(() => cursorAt(page, next)).toBe('crosshair')
})

test('the pen keeps its cursor over the frame of something it cannot edit', async ({ page }) => {
  // An image has no points, so the pen leaves its frame up — and every handle
  // on a frame carries a cursor of its own.
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 200
    c.height = 120
    const x = c.getContext('2d')!
    x.fillStyle = '#3399cc'
    x.fillRect(0, 0, 200, 120)
    return c.toDataURL('image/png').split(',')[1]!
  })
  await selectTool(page, 'select')
  await dropFiles(page, [{ name: 'photo.png', type: 'image/png', base64 }], { x: 400, y: 300 })
  await page.locator('.layer-row', { hasText: 'photo' }).first().click()
  await selectTool(page, 'pen')

  for (const handle of ['se', 'n']) {
    const box = (await page.locator(`.resize-handle[data-handle="${handle}"]`).boundingBox())!
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await expect.poll(() => cursorAt(page, centre), handle).toBe('crosshair')
  }
  // The same handle still says "resize" to the Select tool, whose it is.
  await selectTool(page, 'select')
  const se = (await page.locator('.resize-handle[data-handle="se"]').boundingBox())!
  await expect
    .poll(() => cursorAt(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }))
    .toBe('nwse-resize')
})

// ---------------------------------------------------------------------------
// Curvature mode
// ---------------------------------------------------------------------------

test('curvature mode fairs the curve through every point clicked', async ({ page }) => {
  await page.keyboard.press('Shift+`')
  await click(page, 200, 300)
  await click(page, 300, 220)
  await click(page, 400, 300)
  await click(page, 500, 220)
  await page.keyboard.press('Enter')

  // Every interior anchor carries handles, so the path runs through the points
  // as one curve rather than as a chain of straight segments.
  const d = (await pathD(page))!
  expect(d.match(/C/g)).toHaveLength(3)
  expect(d).not.toContain('L')

  // And the mode is a mode: turned off, clicks give corners again. Matched by
  // value rather than by index — the two paths land in different containers, so
  // document order is not the order they were drawn in.
  await page.keyboard.press('Shift+`')
  await selectTool(page, 'pen')
  await click(page, 200, 500)
  await click(page, 300, 560)
  await click(page, 400, 500)
  await page.keyboard.press('Enter')
  await expect(nodesOfType(page, 'path')).toHaveCount(2)
  const all = await nodesOfType(page, 'path').locator('path').evaluateAll((els) =>
    els.map((el) => el.getAttribute('d')),
  )
  expect(all).toContain('M0 0 L166.6667 100 L333.3333 0')
})

test('the curvature preview shows the whole curve, not a line to the pointer', async ({ page }) => {
  await page.keyboard.press('Shift+`')
  await click(page, 200, 300)
  await click(page, 300, 220)
  const ahead = await pt(page, 400, 300)
  await page.mouse.move(ahead.x, ahead.y)

  // Placing the next anchor re-fairs the one before it, so a straight rubber
  // band to the pointer would show a path that is not the one about to exist.
  const rubber = page.locator('.pen-rubber')
  await expect(rubber).toHaveCount(1)
  expect((await rubber.getAttribute('d'))!).toContain('C')
})

test('a curvature ring is faired all the way round when it closes', async ({ page }) => {
  await page.keyboard.press('Shift+`')
  await click(page, 300, 200)
  await click(page, 400, 300)
  await click(page, 300, 400)
  await click(page, 200, 300)
  await click(page, 300, 200)

  const d = (await pathD(page))!
  expect(d).toMatch(/Z\s*$/)
  // The point the ring comes back to is faired like every other one; while the
  // path was open it was an end, and ends keep their corners.
  expect(d).not.toContain('L')
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
})

test('a drag in curvature mode places a point rather than pulling handles', async ({ page }) => {
  await page.keyboard.press('Shift+`')
  await dragOut(page, 200, 300, 260, 300)
  await click(page, 400, 300)
  await page.keyboard.press('Enter')
  expect(await pathD(page)).toBe('M0 0 L333.3333 0')
})

// ---------------------------------------------------------------------------
// The rest of what the documentation describes
// ---------------------------------------------------------------------------

test('a dragged curve gets two direction lines of equal length', async ({ page }) => {
  // The complaint this was written for: the far handle sat on top of the
  // anchor, so the curve had no curvature arriving at it. A real drag arrives
  // as many small moves, and the far handle used to keep the length the first
  // of them gave it.
  const anchor = await pt(page, 300, 300)
  const out = await pt(page, 360, 360)
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down()
  await page.mouse.move(out.x, out.y, { steps: 10 })

  const handles = await page
    .locator('.pen-preview .bezier-handle')
    .evaluateAll((els) => els.map((el) => [Number(el.getAttribute('cx')), Number(el.getAttribute('cy'))]))
  expect(handles).toHaveLength(2)
  const box = (await page.locator(CANVAS).boundingBox())!
  const [a, b] = handles.map(([x, y]) => [x! + box.x - anchor.x, y! + box.y - anchor.y] as const)
  // Equal reach either side, and opposite directions.
  expect(Math.hypot(a![0], a![1])).toBeCloseTo(Math.hypot(b![0], b![1]), 1)
  expect(a![0]).toBeCloseTo(-b![0], 1)
  expect(a![1]).toBeCloseTo(-b![1], 1)

  await page.mouse.up()
  await click(page, 460, 300)
  await page.keyboard.press('Enter')
  // Both sides of the joint bend: a curve, not a corner wearing one handle.
  expect((await pathD(page))!).toContain('C')
})

test('hovering a path with the pen shows handles over its start and end', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await click(page, 320, 320)
  await page.keyboard.press('Enter')
  await selectTool(page, 'select')
  await click(page, 600, 150)
  await selectTool(page, 'pen')

  // "all paths on the artboard under the mouse display handles over their
  // start and end point" — two of them, and they are not anchors of anything
  // selected, so they do not count as the path's points.
  await expect(page.locator('.pen-end-hint')).toHaveCount(0)
  const on = await pt(page, 320, 260)
  await page.mouse.move(on.x, on.y)
  await expect(page.locator('.pen-end-hint')).toHaveCount(2)
  await expect(page.locator('.anchor-point')).toHaveCount(0)

  const away = await pt(page, 640, 480)
  await page.mouse.move(away.x, away.y)
  await expect(page.locator('.pen-end-hint')).toHaveCount(0)
})

test('a closed path is reopened by clicking one of its points', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 320, 200)
  await click(page, 320, 320)
  await click(page, 200, 200)
  expect((await pathD(page))!).toMatch(/Z\s*$/)

  await selectTool(page, 'select')
  await click(page, 260, 200)
  await selectTool(page, 'pen')

  // "Extending a closed path reopens the path and then puts the pen tool in
  // drawing mode for that path." A ring's start and end are the same point, so
  // it gets the one handle, and that is what reopens it.
  const start = await pt(page, 200, 200)
  await page.mouse.move(start.x, start.y)
  await expect(page.locator('.pen-end-hint')).toHaveCount(1)
  await click(page, 200, 200)
  await expect(page.locator('.pen-preview')).toHaveCount(1)
  await click(page, 120, 120)
  await page.keyboard.press('Enter')

  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  expect((await pathD(page))!).not.toMatch(/Z\s*$/)
})

test('an anchor lines up with the anchors around it, and Cmd lets go', async ({ page }) => {
  // A first path whose corner sits at a known place, to line up against.
  await click(page, 200, 200)
  await click(page, 200, 320)
  await page.keyboard.press('Enter')
  await selectTool(page, 'pen')

  // Second path, whose second anchor is placed a few pixels off that column.
  await click(page, 400, 420)
  const near = await pt(page, 204, 420)
  await page.mouse.move(near.x, near.y)
  await expect(page.locator('.snap-guide')).not.toHaveCount(0)
  await page.mouse.click(near.x, near.y)
  await page.keyboard.press('Enter')

  // Snapped onto the column exactly, rather than four pixels beside it.
  const all = await nodesOfType(page, 'path').locator('path').evaluateAll((els) =>
    els.map((el) => el.getAttribute('d')),
  )
  // The path is rebased against its own bounds, so the snapped anchor is the
  // origin and the first one sits 533.33 - 200 away from it.
  expect(all.some((d) => d === 'M333.3333 0 L0 0')).toBe(true)
})

test('Cmd suppresses anchor snapping while placing a point', async ({ page }) => {
  await click(page, 200, 200)
  await click(page, 200, 320)
  await page.keyboard.press('Enter')
  await selectTool(page, 'pen')

  await click(page, 400, 420)
  const near = await pt(page, 204, 420)
  await page.keyboard.down('ControlOrMeta')
  await page.mouse.move(near.x, near.y)
  await expect(page.locator('.snap-guide')).toHaveCount(0)
  await page.mouse.click(near.x, near.y)
  await page.keyboard.up('ControlOrMeta')
  await page.keyboard.press('Enter')

  const all = await nodesOfType(page, 'path').locator('path').evaluateAll((els) =>
    els.map((el) => el.getAttribute('d')),
  )
  // Left where it was put: 4px at 60% zoom is 6.67 document units, so the gap
  // is 6.67 shorter than the snapped one above.
  expect(all.some((d) => d === 'M326.6666 0 L0 0')).toBe(true)
})
