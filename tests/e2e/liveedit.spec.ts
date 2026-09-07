/**
 * Corner-radius handles, and the inspector tracking a gesture in real time.
 *
 * The live-readout tests deliberately assert MID-drag, before pointerup: drags
 * make no store writes, so a readout that only updates on commit would still
 * pass an after-the-fact assertion while being frozen on screen.
 */

import { test, expect } from '@playwright/test'
import {
  CANVAS, captureDownload, drawShape, modifier, nodesOfType, openApp,
  openExportDialog, readField, selectTool, setField,
} from './helpers'

const radiusField = (page: import('@playwright/test').Page) =>
  page.locator('.field[title="Corner radius"] input')

/** Screen-space centre of a locator. */
async function centreOf(locator: import('@playwright/test').Locator) {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// ------------------------------------------------------------- handles --

test('radius handles appear inside every roundable shape', async ({ page }) => {
  await openApp(page)

  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 450, y: 360 })
  await selectTool(page, 'select')
  // A box has four independently reachable corners.
  await expect(page.locator('[data-handle="radius"]')).toHaveCount(4)

  await page.keyboard.press('Escape')
  await drawShape(page, 'polygon', { x: 600, y: 200 }, { x: 800, y: 400 })
  await selectTool(page, 'select')
  // A polygon's vertices are generated, so one handle drives one scalar.
  await expect(page.locator('[data-handle="radius"]')).toHaveCount(1)
})

test('ellipses and text have no radius handle', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'ellipse', { x: 250, y: 200 }, { x: 420, y: 360 })
  await selectTool(page, 'select')
  await expect(page.locator('[data-handle="radius"]')).toHaveCount(0)
})

test('the handle is hidden when the shape is too small to host it', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 450, y: 360 })
  await selectTool(page, 'select')
  await expect(page.locator('[data-handle="radius"]')).toHaveCount(4)

  await setField(page, 'W', 8)
  await setField(page, 'H', 8)
  // Four handles inside an 8px box would be unusable and would cover the shape.
  await expect(page.locator('[data-handle="radius"]')).toHaveCount(0)
})

test('dragging a radius handle rounds the corners', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 470, y: 380 })
  await selectTool(page, 'select')

  const before = await nodesOfType(page, 'rect').locator('path').first().getAttribute('d')
  expect(before).not.toContain('A')

  const start = await centreOf(page.locator('[data-handle="radius"]').first())
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 40, start.y + 40, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(150)

  const after = await nodesOfType(page, 'rect').locator('path').first().getAttribute('d')
  // Real arcs, not a re-drawn sharp rectangle.
  expect(after).toContain('A')
  expect(Number.parseFloat(await radiusField(page).inputValue())).toBeGreaterThan(20)
})

test('dragging outward reduces the radius back to zero', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 470, y: 380 })
  await selectTool(page, 'select')
  await setField(page, 'Corner radius', 40)
  expect(await readField(page, 'Corner radius')).toBeCloseTo(40, 0)

  const start = await centreOf(page.locator('[data-handle="radius"]').first())
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x - 90, start.y - 90, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(150)

  expect(await readField(page, 'Corner radius')).toBeCloseTo(0, 0)
})

test('the radius readout follows the handle mid-drag', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 470, y: 380 })
  await selectTool(page, 'select')

  const start = await centreOf(page.locator('[data-handle="radius"]').first())
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 45, start.y + 45, { steps: 14 })

  // Read BEFORE pointerup — the drag has written nothing to the store yet.
  const midDrag = Number.parseFloat(await radiusField(page).inputValue())
  await page.mouse.up()
  expect(midDrag).toBeGreaterThan(15)
})

test('a rounded polygon keeps its radius through save and export', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'polygon', { x: 250, y: 200 }, { x: 450, y: 400 })
  await selectTool(page, 'select')
  await setField(page, 'Corner radius', 12)

  const d = await nodesOfType(page, 'polygon').locator('path').first().getAttribute('d')
  expect(d).toContain('A')

  const out = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page.locator('[role="dialog"] .dialog-row', { hasText: 'Format' }).locator('select').selectOption('svg')
    await page.locator('button:text-is("Export")').click()
  })
  const svg = out.buffer.toString('utf8')
  // Exported as real rounded vector, not a bitmap or a sharp fallback.
  expect(svg).toMatch(/<path[^>]+d="[^"]*A/)
  expect(svg).not.toContain('data:image/png')
})

// ------------------------------------------------------- live readouts --

test('X and Y track a move in real time', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 400, y: 330 })
  await selectTool(page, 'select')
  const x0 = await readField(page, 'X')

  const canvas = (await page.locator(CANVAS).boundingBox())!
  await page.mouse.move(canvas.x + 320, canvas.y + 265)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 420, canvas.y + 265, { steps: 12 })

  const midDrag = await readField(page, 'X')
  await page.mouse.up()

  // Frozen readouts would still equal x0 here.
  expect(midDrag).toBeGreaterThan(x0 + 50)
})

test('W and H track a resize in real time', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 400, y: 330 })
  await selectTool(page, 'select')
  const w0 = await readField(page, 'W')

  const frame = (await page.locator('.selection-frame').boundingBox())!
  const handle = { x: frame.x + frame.width, y: frame.y + frame.height }
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(handle.x + 90, handle.y + 60, { steps: 14 })

  const midDrag = await readField(page, 'W')
  await page.mouse.up()
  expect(midDrag).toBeGreaterThan(w0 + 60)
})

test('rotation tracks a corner rotation in real time', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 430, y: 340 })
  await selectTool(page, 'select')

  const frame = (await page.locator('.selection-frame').boundingBox())!
  const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
  const start = { x: frame.x - 7, y: frame.y - 7 }
  const end = { x: centre.x + (start.y - centre.y), y: centre.y - (start.x - centre.x) }

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 16 })

  const midDrag = Number.parseFloat(await page.locator('.tf-rot input').inputValue())
  await page.mouse.up()
  expect(Math.abs(midDrag)).toBeGreaterThan(45)
})

test('a multi-selection resize updates its readouts live', async ({ page }) => {
  await openApp(page)
  // Both the same size, so the shared W readout is a number rather than
  // "Mixed" — snapping can otherwise make two hand-drawn rects differ slightly.
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 320, y: 300 })
  await selectTool(page, 'select')
  await setField(page, 'W', 120)
  await setField(page, 'H', 120)
  await page.keyboard.press('Escape')

  await drawShape(page, 'rect', { x: 380, y: 200 }, { x: 480, y: 300 })
  await selectTool(page, 'select')
  await setField(page, 'W', 120)
  await setField(page, 'H', 120)

  await page.keyboard.press(`${modifier()}+a`)
  const w0 = await readField(page, 'W')
  expect(Number.isNaN(w0)).toBe(false)

  const frame = (await page.locator('.selection-frame').boundingBox())!
  const handle = { x: frame.x + frame.width, y: frame.y + frame.height }
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(handle.x + 100, handle.y + 80, { steps: 14 })

  // A multi-node resize scales the matrix rather than writing intrinsic size,
  // so this only works if the readout decomposes the live matrix.
  const midDrag = await readField(page, 'W')
  await page.mouse.up()
  expect(midDrag).toBeGreaterThan(w0)
})

test('resizing a group scales its children, live and on commit', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 280, y: 280 })
  await drawShape(page, 'rect', { x: 340, y: 200 }, { x: 420, y: 280 })
  await page.keyboard.press(`${modifier()}+a`)
  await page.keyboard.press(`${modifier()}+g`)

  // Select via the Layers panel: a pointerdown on a child of a selected group
  // descends into that child.
  await page.locator('.layer-row').nth(1).click()

  const childWidths = () =>
    nodesOfType(page, 'rect').evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().width)),
    )
  const before = await childWidths()
  expect(before).toEqual([80, 80])

  const handle = (await page.locator('[data-handle="se"]').boundingBox())!
  const grab = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 220, grab.y + 80, { steps: 12 })

  // A group has no size of its own, so writing a new width/height moves nothing.
  // Only scaling its matrix resizes it — and the preview has to show that, not
  // wait for the commit.
  const during = await childWidths()
  expect(during[0]).toBeGreaterThan(before[0]!)
  await page.mouse.up()

  // No snap at pointerup: what was previewed is what was committed.
  expect(await childWidths()).toEqual(during)
})
