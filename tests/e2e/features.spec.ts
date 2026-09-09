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
 * The tools and behaviours the acceptance suite does not reach: pen, text,
 * boolean operations, point editing, clipboard, guides, grid, zoom/pan, and the
 * context menu.
 */

import { test, expect } from '@playwright/test'
import {
  CANVAS, RED_PNG_BASE64, captureDownload, clickCanvas, dismissRecovery, dragOnCanvas,
  drawShape, dropFiles, modifier, nodesOfType, openApp, openExportDialog, press,
  readField, selectTool, setField,
} from './helpers'

/** Choose an option from one of the stroke section's icon dropdowns. */
async function pickStroke(page: import('@playwright/test').Page, control: string, option: string) {
  await page.locator(`.icon-select[title^="${control}"]`).click()
  await page.locator('.menu-item', { hasText: new RegExp(`^${option}`) }).click()
}

/** Draw a shallow arc freehand, so the simplifier has real curvature to keep. */
async function freehandArc(
  page: import('@playwright/test').Page,
  origin: { x: number; y: number },
  width: number,
  height: number,
) {
  const box = await page.locator(CANVAS).boundingBox()
  const pt = (t: number) => ({
    x: box!.x + origin.x + width * t,
    y: box!.y + origin.y - Math.sin(t * Math.PI) * height,
  })
  const start = pt(0)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let i = 1; i <= 40; i++) {
    const p = pt(i / 40)
    await page.mouse.move(p.x, p.y)
  }
  await page.mouse.up()
}

test('pen tool builds a real Bezier path', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'pen')
  await clickCanvas(page, { x: 200, y: 300 })
  await clickCanvas(page, { x: 280, y: 220 })
  // Click-drag pulls out mirrored handles, making the joint smooth.
  await dragOnCanvas(page, { x: 360, y: 300 }, { x: 400, y: 340 })
  await page.keyboard.press('Enter')
  await selectTool(page, 'select')

  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  const d = await nodesOfType(page, 'path').locator('path').first().getAttribute('d')
  // Real SVG commands, including a cubic from the handle drag.
  expect(d).toMatch(/^M/)
  expect(d).toContain('C')
})

test('pen closes a path when clicking the first point', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'pen')
  await clickCanvas(page, { x: 200, y: 200 })
  await clickCanvas(page, { x: 300, y: 200 })
  await clickCanvas(page, { x: 300, y: 300 })
  await clickCanvas(page, { x: 200, y: 200 })
  await selectTool(page, 'select')

  const d = await nodesOfType(page, 'path').locator('path').first().getAttribute('d')
  expect(d).toMatch(/Z\s*$/)
})

test('pencil draws a smoothed freehand path', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'pencil')
  // An actual curve — a straight drag would be simplified to two points, which
  // is correct behaviour but proves nothing about smoothing.
  await freehandArc(page, { x: 200, y: 320 }, 160, 26)
  await selectTool(page, 'select')

  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  const d = await nodesOfType(page, 'path').locator('path').first().getAttribute('d')
  expect(d).toContain('C')
  // Simplification keeps the stroke editable rather than dumping every sample.
  expect((d!.match(/C/g) ?? []).length).toBeLessThan(30)
})

test('text tool creates editable text', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'text')
  await clickCanvas(page, { x: 300, y: 300 })

  const editor = page.locator('[data-testid="text-editor"]')
  await expect(editor).toBeVisible()
  await editor.fill('Hello XDesign')
  await page.keyboard.press('Escape')

  await expect(nodesOfType(page, 'text')).toHaveCount(1)
  await expect(nodesOfType(page, 'text').locator('text')).toContainText('Hello XDesign')

  // The text is still live: re-editing changes it.
  await nodesOfType(page, 'text').first().dblclick({ force: true })
  await expect(page.locator('[data-testid="text-editor"]')).toBeVisible()
  await page.locator('[data-testid="text-editor"]').fill('Edited')
  await page.keyboard.press('Escape')
  await expect(nodesOfType(page, 'text').locator('text')).toContainText('Edited')
})

test('boolean union merges two shapes into one path', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'ellipse', { x: 200, y: 200 }, { x: 320, y: 320 })
  await drawShape(page, 'ellipse', { x: 270, y: 200 }, { x: 390, y: 320 })

  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(2)

  await page.locator('button[aria-label="Union"]').click()
  // paper.js loads lazily into a worker on the first operation.
  await expect(nodesOfType(page, 'path')).toHaveCount(1, { timeout: 15000 })
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(0)

  const d = await nodesOfType(page, 'path').locator('path').first().getAttribute('d')
  // Curve fidelity: the union of two circles is still made of curves.
  expect(d).toMatch(/[CcSsAa]/)
  await expect(page.locator('.notification', { hasText: 'flattened' })).toHaveCount(0)
})

test('boolean subtract removes the top shape from the bottom', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 340, y: 320 })
  await drawShape(page, 'ellipse', { x: 250, y: 240 }, { x: 310, y: 300 })
  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)

  await page.locator('button[aria-label="Subtract"]').click()
  await expect(nodesOfType(page, 'path')).toHaveCount(1, { timeout: 15000 })
  const d = await nodesOfType(page, 'path').locator('path').first().getAttribute('d')
  // A hole means two subpaths.
  expect((d!.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(2)
})

test('double-click enters point editing on a path', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'pen')
  await clickCanvas(page, { x: 220, y: 300 })
  await clickCanvas(page, { x: 320, y: 240 })
  await clickCanvas(page, { x: 420, y: 300 })
  await page.keyboard.press('Enter')
  await selectTool(page, 'select')

  // An open path is only hit near its stroke — the bounding-box centre of a
  // "Λ" shape is empty space, so aim at the apex.
  await clickCanvas(page, { x: 320, y: 240 })
  const box = await page.locator(CANVAS).boundingBox()
  await page.mouse.dblclick(box!.x + 320, box!.y + 240)
  await expect(page.locator('.anchor-point')).toHaveCount(3)

  await page.keyboard.press('Escape')
  await expect(page.locator('.anchor-point')).toHaveCount(0)
})

test('copy, paste and duplicate preserve the object', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'polygon', { x: 200, y: 200 }, { x: 300, y: 300 })
  await selectTool(page, 'select')
  await nodesOfType(page, 'polygon').first().click({ force: true })

  await press(page, 'd')
  await expect(nodesOfType(page, 'polygon')).toHaveCount(2)

  await press(page, 'c')
  await press(page, 'v')
  await expect(nodesOfType(page, 'polygon')).toHaveCount(3)

  await press(page, 'z')
  await expect(nodesOfType(page, 'polygon')).toHaveCount(2)
  await page.keyboard.press(`${modifier()}+Shift+z`)
  await expect(nodesOfType(page, 'polygon')).toHaveCount(3)
})

test('undo and redo restore transforms exactly', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 280 })
  await setField(page, 'W', 400)
  expect(await readField(page, 'W')).toBeCloseTo(400, 1)

  await press(page, 'z')
  expect(await readField(page, 'W')).not.toBeCloseTo(400, 1)
  await page.keyboard.press(`${modifier()}+Shift+z`)
  expect(await readField(page, 'W')).toBeCloseTo(400, 1)
})

test('arrow keys nudge, and the run is a single undo step', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 280 })
  const x0 = await readField(page, 'X')

  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  expect(await readField(page, 'X')).toBeCloseTo(x0 + 5, 1)

  await page.keyboard.press('Shift+ArrowRight')
  expect(await readField(page, 'X')).toBeCloseTo(x0 + 15, 1)

  // Coalesced: one undo takes the whole run back.
  await press(page, 'z')
  expect(await readField(page, 'X')).toBeCloseTo(x0, 1)
})

test('flip is non-destructive and reversible', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'polygon', { x: 200, y: 200 }, { x: 320, y: 300 })
  const before = await nodesOfType(page, 'polygon').first().getAttribute('transform')

  await page.locator('button[aria-label="Flip horizontal"]').click()
  const flipped = await nodesOfType(page, 'polygon').first().getAttribute('transform')
  expect(flipped).not.toBe(before)

  await page.locator('button[aria-label="Flip horizontal"]').click()
  const restored = await nodesOfType(page, 'polygon').first().getAttribute('transform')
  // Flipping twice returns to the original matrix, not an accumulated one.
  const nums = (s: string | null) => (s ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number)
  nums(restored).forEach((v, i) => expect(v).toBeCloseTo(nums(before)[i]!, 3))
})

test('zoom and pan change the view without touching the document', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 280 })
  const w = await readField(page, 'W')

  await press(page, '1')
  await expect(page.locator('[data-testid="zoom-value"]')).toHaveValue('100%')
  await press(page, '0')
  await expect(page.locator('[data-testid="zoom-value"]')).not.toHaveValue('100%')

  // Space-drag pans.
  await page.keyboard.down('Space')
  await dragOnCanvas(page, { x: 500, y: 400 }, { x: 560, y: 430 })
  await page.keyboard.up('Space')

  // The object's own geometry is unchanged by any view operation.
  expect(await readField(page, 'W')).toBeCloseTo(w, 3)
})

test('marquee selects only fully contained objects', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 260, y: 260 })
  await drawShape(page, 'rect', { x: 400, y: 200 }, { x: 460, y: 260 })
  await selectTool(page, 'select')

  await dragOnCanvas(page, { x: 150, y: 150 }, { x: 300, y: 300 })
  await expect(page.locator('.layer-row.selected')).toHaveCount(1)

  // Start clear of the first rect's corner: with something already selected,
  // a drag beginning just outside its corner is a rotation, not a marquee.
  await dragOnCanvas(page, { x: 150, y: 150 }, { x: 520, y: 320 })
  await expect(page.locator('.layer-row.selected')).toHaveCount(2)
})

test('shift-click extends the selection', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 260, y: 260 })
  await drawShape(page, 'ellipse', { x: 300, y: 200 }, { x: 360, y: 260 })
  await selectTool(page, 'select')

  await clickCanvas(page, { x: 230, y: 230 })
  await expect(page.locator('.layer-row.selected')).toHaveCount(1)
  await clickCanvas(page, { x: 330, y: 230 }, { modifiers: ['Shift'] })
  await expect(page.locator('.layer-row.selected')).toHaveCount(2)
})

test('artboard tool creates a second artboard', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'artboard')
  await dragOnCanvas(page, { x: 700, y: 200 }, { x: 900, y: 400 })
  await selectTool(page, 'select')
  await expect(nodesOfType(page, 'artboard')).toHaveCount(2)
  await expect(page.locator('.artboard-label')).toHaveCount(2)
})

test('grid toggles and does not become part of the document', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('.grid-overlay')).toHaveCount(0)
  await page.locator('button[aria-label="Show grid"]').click()
  await expect(page.locator('.grid-overlay')).toHaveCount(1)
  // Grid lines live outside the document layer, so they cannot be exported.
  await expect(page.locator('.document-layer .grid-overlay')).toHaveCount(0)
  await page.locator('button[aria-label="Show grid"]').click()
  await expect(page.locator('.grid-overlay')).toHaveCount(0)
})

test('context menu acts on the selection', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 280 })
  await selectTool(page, 'select')
  await nodesOfType(page, 'rect').first().click({ force: true })

  const box = await page.locator(CANVAS).boundingBox()
  await page.mouse.click(box!.x + 250, box!.y + 240, { button: 'right' })
  await expect(page.locator('.menu')).toBeVisible()

  await page.locator('.menu-item', { hasText: 'Duplicate' }).click()
  await expect(nodesOfType(page, 'rect')).toHaveCount(2)
})

test('layer rename persists', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 280 })
  await page.locator('.layer-row', { hasText: 'Rectangle' }).dblclick()
  const input = page.locator('.layer-name input')
  await expect(input).toBeVisible()
  await input.fill('Header Bar')
  await input.press('Enter')
  await expect(page.locator('.layer-row', { hasText: 'Header Bar' })).toHaveCount(1)
})

test('stroke alignment, caps and dashes reach the rendered SVG', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 340, y: 300 })

  const strokeSection = page.locator('.section', { hasText: 'STROKE' })
  await strokeSection.locator('.swatch').first().click()
  const hex = page.locator('.popover .field', { has: page.locator('.field-label:text-is("#")') }).locator('input')
  await hex.fill('112233')
  await hex.press('Enter')
  await page.keyboard.press('Escape')

  await pickStroke(page, 'Line cap', 'Round')
  await pickStroke(page, 'Line join', 'Bevel')
  const dash = strokeSection.locator('.field', { has: page.locator('.field-label:text-is("Dash")') }).locator('input')
  await dash.fill('6 3')
  await dash.press('Enter')

  const path = nodesOfType(page, 'rect').locator('path').first()
  expect(await path.getAttribute('stroke')).toBe('#112233')
  expect(await path.getAttribute('stroke-linecap')).toBe('round')
  expect(await path.getAttribute('stroke-linejoin')).toBe('bevel')
  expect(await path.getAttribute('stroke-dasharray')).toBe('6 3')
})

test('one polygon tool covers triangle, polygon and star', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'polygon', { x: 200, y: 200 }, { x: 320, y: 320 })
  const shape = nodesOfType(page, 'polygon').locator('path').first()

  // The tool draws a triangle: three corners, so two L commands after the M.
  expect(await readField(page, 'Corners')).toBe(3)
  expect(await readField(page, 'Star')).toBe(100)
  expect(((await shape.getAttribute('d'))!.match(/L/g) ?? []).length).toBe(2)

  await setField(page, 'Corners', 8)
  expect(((await shape.getAttribute('d'))!.match(/L/g) ?? []).length).toBe(7)

  // Dropping the star ratio makes it a star, with an inner vertex per corner.
  await setField(page, 'Star', 40)
  expect(((await shape.getAttribute('d'))!.match(/L/g) ?? []).length).toBe(15)

  // And it is reversible: 100% is the plain polygon again, not a 16-gon.
  await setField(page, 'Star', 100)
  expect(((await shape.getAttribute('d'))!.match(/L/g) ?? []).length).toBe(7)
})

test('a polygon fills its selection frame, with no dead margin', async ({ page }) => {
  await openApp(page)
  // A hexagon used to reach only 86.6% of its frame's width, so the frame, the
  // W/H readout and the export crop all claimed area the shape did not occupy.
  await drawShape(page, 'polygon', { x: 200, y: 200 }, { x: 400, y: 380 })
  await setField(page, 'Corners', 6)

  // getBBox is the fill outline in the node's own local units, with no stroke
  // padding — so it compares directly against the W/H the inspector reports,
  // which is exactly the box the frame, align/distribute and export all use.
  const box = await nodesOfType(page, 'polygon')
    .locator('path')
    .first()
    .evaluate((el) => {
      const b = (el as unknown as SVGGraphicsElement).getBBox()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    })

  expect(box.x).toBeCloseTo(0, 3)
  expect(box.y).toBeCloseTo(0, 3)
  expect(box.width).toBeCloseTo(await readField(page, 'W'), 1)
  expect(box.height).toBeCloseTo(await readField(page, 'H'), 1)
})

test('the star ratio handle turns a polygon into a star without moving the frame', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'polygon', { x: 220, y: 200 }, { x: 420, y: 400 })
  await setField(page, 'Corners', 5)

  const w0 = await readField(page, 'W')
  const h0 = await readField(page, 'H')
  const handle = (await page.locator('[data-handle="star-ratio"]').boundingBox())!
  const frame = (await page.locator('.selection-frame').boundingBox())!
  const grab = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }

  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move((grab.x + centre.x) / 2, (grab.y + centre.y) / 2, { steps: 10 })
  await page.mouse.up()

  expect(await readField(page, 'Star')).toBeLessThan(100)
  // The frame is set by the outer ring alone, so it must not have moved.
  expect(await readField(page, 'W')).toBeCloseTo(w0, 1)
  expect(await readField(page, 'H')).toBeCloseTo(h0, 1)
  const d = (await nodesOfType(page, 'polygon').locator('path').first().getAttribute('d'))!
  expect((d.match(/L/g) ?? []).length).toBe(9)
})

test('line tool draws a real line with editable endpoints', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'line', { x: 200, y: 200 }, { x: 340, y: 280 })
  await expect(nodesOfType(page, 'line')).toHaveCount(1)

  const d = await nodesOfType(page, 'line').locator('path').first().getAttribute('d')
  expect(d).toMatch(/^M[\d.\s-]+L[\d.\s-]+$/)
  // A line has no fill and must still be selectable by its stroke.
  expect(await nodesOfType(page, 'line').locator('path').first().getAttribute('fill')).toBe('none')
  expect(await readField(page, 'W')).toBeGreaterThan(100)
})

test('JPEG export produces a real JPEG with a background', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 280 })
  await setField(page, 'W', 120)
  await setField(page, 'H', 90)

  const out = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page.locator('[role="dialog"] .dialog-row', { hasText: 'Format' }).locator('select').selectOption('jpeg')
    await page.locator('button:text-is("Export")').click()
  })

  expect(out.name).toMatch(/\.jpg$/)
  // SOI marker: JPEG has no alpha, so the exporter must fill a background.
  expect(out.buffer[0]).toBe(0xff)
  expect(out.buffer[1]).toBe(0xd8)
  expect(out.buffer.length).toBeGreaterThan(200)
})

test('JPEG quality changes the file size', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'ellipse', { x: 200, y: 200 }, { x: 500, y: 450 })

  const exportAt = async (quality: string) => {
    const out = await captureDownload(page, async () => {
      await openExportDialog(page)
      await page.locator('[role="dialog"] .dialog-row', { hasText: 'Format' }).locator('select').selectOption('jpeg')
      await page.locator('[role="dialog"] input[type="range"]').fill(quality)
      await page.locator('button:text-is("Export")').click()
    })
    return out.buffer.length
  }

  const low = await exportAt('20')
  const high = await exportAt('100')
  expect(high).toBeGreaterThan(low)
})

test('SVG export keeps shapes as shapes, not paths of pixels', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 280 })
  await drawShape(page, 'ellipse', { x: 340, y: 200 }, { x: 460, y: 280 })
  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)

  const out = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page.locator('[role="dialog"] .dialog-row', { hasText: 'Format' }).locator('select').selectOption('svg')
    await page.locator('button:text-is("Export")').click()
  })

  const svg = out.buffer.toString('utf8')
  // Semantic elements, not a wall of path data — and definitely not a bitmap.
  expect(svg).toContain('<rect')
  expect(svg).toContain('<ellipse')
  expect(svg).not.toContain('data:image/png')
  expect(svg).toMatch(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  // Explicit width/height, without which Firefox renders an <img> SVG as 0x0.
  expect(svg).toMatch(/width="\d+"/)
  expect(svg).toMatch(/height="\d+"/)
})

test('exported text embeds its font so it renders identically anywhere', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'text')
  await clickCanvas(page, { x: 300, y: 300 })
  await page.locator('[data-testid="text-editor"]').fill('Vector')
  await page.keyboard.press('Escape')

  const out = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page.locator('[role="dialog"] .dialog-row', { hasText: 'Format' }).locator('select').selectOption('svg')
    await page.locator('button:text-is("Export")').click()
  })

  const svg = out.buffer.toString('utf8')
  // Real <text>, so it stays selectable and editable...
  expect(svg).toContain('<text')
  expect(svg).toContain('Vector')
  // ...plus the face itself, base64-inlined. A data: URL is not a fetch, so it
  // resolves even inside the <img> sandbox used for raster export, where an
  // external font reference would silently substitute.
  expect(svg).toContain('@font-face')
  expect(svg).toMatch(/src:url\(data:font\/woff2?;base64,/)
})

test('raster export of text always embeds the font', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'text')
  await clickCanvas(page, { x: 300, y: 300 })
  await page.locator('[data-testid="text-editor"]').fill('Raster')
  await page.keyboard.press('Escape')
  await setField(page, 'Size', 48)

  const out = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page.locator('[role="dialog"] .dialog-row', { hasText: 'Format' }).locator('select').selectOption('png')
    await page.locator('button:text-is("Export")').click()
  })

  // A PNG that actually contains rendered glyphs, not an empty transparent box.
  expect(out.buffer.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )
  expect(out.buffer.length).toBeGreaterThan(500)
})

test('hidden layers are excluded from export', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 280 })
  await drawShape(page, 'ellipse', { x: 340, y: 200 }, { x: 460, y: 280 })
  await page.locator('.layer-row', { hasText: 'Ellipse' }).locator('button[title="Hide"]').click()

  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)
  const out = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page.locator('[role="dialog"] .dialog-row', { hasText: 'Format' }).locator('select').selectOption('svg')
    await page.locator('button:text-is("Export")').click()
  })

  const svg = out.buffer.toString('utf8')
  expect(svg).toContain('<rect')
  expect(svg).not.toContain('<ellipse')
})

test('text renders visibly on the canvas', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'text')
  await clickCanvas(page, { x: 350, y: 300 })
  await page.locator('[data-testid="text-editor"]').fill('Rendered')
  await page.keyboard.press('Escape')

  const textEl = nodesOfType(page, 'text').locator('text')
  await expect(textEl).toBeVisible()
  const box = await textEl.boundingBox()
  // A real laid-out box, not a zero-size element.
  expect(box!.width).toBeGreaterThan(20)
  expect(box!.height).toBeGreaterThan(8)
})

test('Prototype and Share are honestly disabled, not fake', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('.tab', { hasText: 'Design' })).toHaveClass(/active/)
  await expect(page.locator('.tab', { hasText: 'Prototype' })).toBeDisabled()
  await expect(page.locator('.tab', { hasText: 'Share' })).toBeDisabled()
})

test('every tool in the rail activates', async ({ page }) => {
  await openApp(page)
  const tools = ['select', 'direct-select', 'rect', 'ellipse', 'polygon', 'line',
                 'pen', 'pencil', 'text', 'artboard', 'zoom', 'hand']
  for (const tool of tools) {
    await selectTool(page, tool)
    await expect(page.locator(`[data-tool="${tool}"]`)).toHaveAttribute('aria-pressed', 'true')
  }
})

test('every tool keyboard shortcut selects its tool', async ({ page }) => {
  await openApp(page)
  const map: Record<string, string> = {
    v: 'select', d: 'direct-select', r: 'rect', e: 'ellipse', y: 'polygon',
    l: 'line', p: 'pen', n: 'pencil', t: 'text', a: 'artboard', z: 'zoom', h: 'hand',
  }
  for (const [key, tool] of Object.entries(map)) {
    await page.keyboard.press(key)
    await expect(page.locator(`[data-tool="${tool}"]`)).toHaveAttribute('aria-pressed', 'true')
  }
})

test('tooltips appear next to the control they describe', async ({ page }) => {
  await openApp(page)

  const button = page.locator('[data-tool="ellipse"]')
  const buttonBox = (await button.boundingBox())!
  await button.hover()

  const tip = page.locator('.tooltip')
  await expect(tip).toBeVisible({ timeout: 3000 })
  await expect(tip).toContainText('Ellipse')

  const tipBox = (await tip.boundingBox())!
  // The wrapper is display:contents, which has no layout box — measuring it
  // instead of the child parked every tooltip at the window's top-left corner.
  expect(tipBox.x).toBeGreaterThan(buttonBox.x)
  expect(tipBox.x).toBeLessThan(buttonBox.x + buttonBox.width + 40)
  // Vertically centred on the button.
  const tipMid = tipBox.y + tipBox.height / 2
  const buttonMid = buttonBox.y + buttonBox.height / 2
  expect(Math.abs(tipMid - buttonMid)).toBeLessThan(14)
})

test('tooltips near the right edge flip inside the window', async ({ page }) => {
  await openApp(page)

  // The zoom presets button sits hard against the right edge, now that the
  // application menu has moved to the left of the bar.
  const button = page.locator('button[aria-label="Zoom presets"]')
  await button.hover()

  const tip = page.locator('.tooltip')
  await expect(tip).toBeVisible({ timeout: 3000 })
  const tipBox = (await tip.boundingBox())!
  const viewport = page.viewportSize()!
  expect(tipBox.x).toBeGreaterThanOrEqual(0)
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(viewport.width)
  expect(tipBox.y).toBeGreaterThanOrEqual(0)
})

/**
 * Dragging a file over a target.
 *
 * NOTE on what can and cannot be asserted here: `dropEffect` is ignored on a
 * synthetic DataTransfer — assigning it outside a real OS drag is a documented
 * no-op, verified directly (it reads back as 'none' however it is set). So the
 * regression is covered through the behaviour a user actually sees: the canvas
 * shows drop feedback and accepts the file, while the surrounding chrome does
 * neither.
 */
async function dragFileOver(page: import('@playwright/test').Page, selector: string) {
  return page.evaluate((sel) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Blob(['x'])], 'photo.png', { type: 'image/png' }))
    const target = document.querySelector(sel)!
    const rect = target.getBoundingClientRect()
    const event = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    })
    target.dispatchEvent(event)
    return { accepted: event.defaultPrevented }
  }, selector)
}

test('the canvas accepts a dragged file and shows drop feedback', async ({ page }) => {
  await openApp(page)

  // The window-level guard that stops the browser navigating to a dropped file
  // must not veto the canvas. When it did, the browser cancelled the drag and
  // `drop` never fired — which is why dragging an image in did nothing at all.
  const result = await dragFileOver(page, '[data-testid="canvas-root"]')
  expect(result.accepted).toBe(true)
  // The centre of the canvas is over the artboard, so the feedback is the
  // message filling it rather than the chip that follows the cursor.
  await expect(page.locator('.drop-message-body')).toBeVisible()
  await expect(page.locator('.drop-message-body')).toContainText('Import')
})

test('a file dragged over the chrome shows no drop target', async ({ page }) => {
  await openApp(page)
  await dragFileOver(page, '.inspector')
  // No feedback outside the canvas, and the guard still blocks navigation.
  await expect(page.locator('.drop-indicator')).toHaveCount(0)
})

test('dropping an image onto the canvas imports it', async ({ page }) => {
  await openApp(page)
  await dropFiles(page, [{ name: 'photo.png', type: 'image/png', base64: RED_PNG_BASE64 }], { x: 420, y: 320 })

  await expect(nodesOfType(page, 'image')).toHaveCount(1)
  await expect(page.locator('.layer-row', { hasText: 'photo' })).toHaveCount(1)
  // Placed where it was dropped, not at the origin.
  expect(await readField(page, 'X')).toBeGreaterThan(0)
})

// -------------------------------------------------------------- the top bar --

test('the application menu sits at the left of the bar and opens under itself', async ({ page }) => {
  await openApp(page)
  const button = page.locator('[data-testid="app-menu"]')

  const where = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="app-menu"]')!
    const mark = document.querySelector('.app-mark')!
    return {
      inLeftGroup: !!btn.closest('.topbar-left'),
      beforeTheMark:
        (btn.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    }
  })
  expect(where).toEqual({ inLeftGroup: true, beforeTheMark: true })

  // Anchored to the button's left edge — right-anchoring it here would have put
  // the panel off the left of the window.
  await button.click()
  const menu = page.locator('.menu').first()
  await expect(menu).toBeVisible()
  const panel = (await menu.boundingBox())!
  const anchor = (await button.boundingBox())!
  expect(panel.x).toBeGreaterThanOrEqual(0)
  expect(Math.abs(panel.x - anchor.x)).toBeLessThan(4)
  expect(panel.y).toBeGreaterThan(anchor.y)
})

test('the zoom control is only as wide as the value it holds', async ({ page }) => {
  await openApp(page)
  const value = page.locator('[data-testid="zoom-value"]')

  // An <input> with no width is about twenty characters wide by default, which
  // is what made this section span a fifth of the bar.
  const box = (await value.boundingBox())!
  expect(box.width).toBeLessThanOrEqual(50)
  expect((await page.locator('.zoom-control').boundingBox())!.width).toBeLessThanOrEqual(150)

  // Narrow, but not so narrow that the value is clipped — including the longest
  // one it can show.
  await value.fill('800')
  await value.press('Enter')
  await expect(value).toHaveValue('800%')
  const clipped = await value.evaluate((el) => (el as HTMLInputElement).scrollWidth > el.clientWidth + 1)
  expect(clipped).toBe(false)
})

// ------------------------------------------------------- artboard renaming --

/** Double-click the first artboard's on-canvas name label. */
async function openRename(page: import('@playwright/test').Page) {
  const label = page.locator('.artboard-label').first()
  const name = (await label.textContent())!
  const box = (await label.boundingBox())!
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  return name
}

test('double-clicking an artboard name renames it on the canvas', async ({ page }) => {
  await openApp(page)
  const before = await openRename(page)

  const input = page.locator('[data-testid="artboard-rename"]')
  await expect(input).toBeVisible()
  // Focused with the whole name selected, so typing replaces it outright.
  expect(
    await input.evaluate((el) => {
      const i = el as HTMLInputElement
      return `${i.selectionStart}-${i.selectionEnd}|${document.activeElement === i}`
    }),
  ).toBe(`0-${before.length}|true`)
  // The label it stands in for is hidden, so the name is never drawn twice.
  await expect(page.locator('.artboard-label', { hasText: before })).toHaveCount(0)

  await page.keyboard.type('Home Screen')
  await page.keyboard.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(page.locator('.artboard-label').first()).toHaveText('Home Screen')
  // A real document edit: the layer list follows, and it undoes.
  await expect(page.locator('.layer-row', { hasText: 'Home Screen' })).toHaveCount(1)
  await press(page, 'z')
  await expect(page.locator('.artboard-label').first()).toHaveText(before)
})

test('Escape abandons the rename, and clicking away keeps it', async ({ page }) => {
  await openApp(page)
  const before = await openRename(page)
  await page.keyboard.type('Discarded')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-testid="artboard-rename"]')).toHaveCount(0)
  await expect(page.locator('.artboard-label').first()).toHaveText(before)

  // Blur commits, the way the layer list's rename does.
  await openRename(page)
  await page.keyboard.type('Committed')
  await clickCanvas(page, { x: 700, y: 520 })
  await expect(page.locator('[data-testid="artboard-rename"]')).toHaveCount(0)
  await expect(page.locator('.artboard-label').first()).toHaveText('Committed')
})

test('an empty artboard name is a slip, not an instruction', async ({ page }) => {
  await openApp(page)
  const before = await openRename(page)
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Enter')
  await expect(page.locator('.artboard-label').first()).toHaveText(before)
})

test('typing an artboard name does not reach the tool shortcuts', async ({ page }) => {
  await openApp(page)
  await openRename(page)
  // "r", "t" and "e" are the rectangle, text and ellipse bindings.
  await page.keyboard.type('Rate')
  await page.keyboard.press('Enter')
  await expect(page.locator('.tool-button.active')).toHaveAttribute('data-tool', 'select')
  await expect(page.locator('.artboard-label').first()).toHaveText('Rate')
})

// --------------------------------------------------------------- panning --

/** The viewport, read off the canvas transform rather than the store. */
async function viewportOf(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const t = document.querySelector('.viewport')!.getAttribute('transform')!
    const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/.exec(t)!
    return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) }
  })
}

test('the hand tool pans 1:1 with the cursor, without shaking', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'hand')
  const box = (await page.locator(CANVAS).boundingBox())!
  const before = await viewportOf(page)

  await page.mouse.move(box.x + 400, box.y + 300)
  await page.mouse.down()
  const path: number[] = []
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + 400 + i * 20, box.y + 300 + i * 10)
    path.push((await viewportOf(page)).x - before.x)
  }
  await page.mouse.up()

  // The document tracks the cursor exactly: 200px right, 100px down.
  const after = await viewportOf(page)
  expect(after.x - before.x).toBeCloseTo(200, 0)
  expect(after.y - before.y).toBeCloseTo(100, 0)
  expect(after.zoom).toBeCloseTo(before.zoom, 5)

  // And it got there smoothly. This is the shake: the delta used to be measured
  // in document space against the very viewport the pan was moving, which turns
  // a difference of positions into a difference of DIFFERENCES — the pointer's
  // acceleration, not its movement. Every step here must be the same 20px.
  path.forEach((x, i) => expect(x, `step ${i + 1}`).toBeCloseTo(20 * (i + 1), 0))
})

test('panning at a zoom other than 100% still tracks the cursor', async ({ page }) => {
  await openApp(page)
  await press(page, '1')
  await selectTool(page, 'hand')
  const box = (await page.locator(CANVAS).boundingBox())!
  const before = await viewportOf(page)

  await page.mouse.move(box.x + 500, box.y + 400)
  await page.mouse.down()
  await page.mouse.move(box.x + 620, box.y + 340, { steps: 12 })
  await page.mouse.up()

  // Screen pixels, not document units — the view follows the hand, not the zoom.
  const after = await viewportOf(page)
  expect(after.x - before.x).toBeCloseTo(120, 0)
  expect(after.y - before.y).toBeCloseTo(-60, 0)
})

// -------------------------------------------------- dragging by the label --

test('an artboard can be dragged by its name, whatever tool is selected', async ({ page }) => {
  await openApp(page)
  // Deliberately not a selection tool: the label is chrome, and belongs to no tool.
  await selectTool(page, 'rect')

  const label = page.locator('.artboard-label').first()
  const before = (await label.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 120, before.y + before.height / 2 + 60, { steps: 8 })

  // The name follows the artboard through the drag rather than jumping to it on
  // release — it is positioned from the live matrix, not the document.
  const during = (await label.boundingBox())!
  expect(during.x - before.x).toBeCloseTo(120, 0)
  expect(during.y - before.y).toBeCloseTo(60, 0)
  await page.mouse.up()

  // Committed as a real move: one undo entry, and no rectangle was drawn by the
  // tool that happened to be active.
  await expect(nodesOfType(page, 'rect')).toHaveCount(0)
  expect(await readField(page, 'X')).toBeCloseTo(200, 0)
  await press(page, 'z')
  expect(await readField(page, 'X')).toBeCloseTo(0, 0)
})

test('a click on an artboard name selects without moving it', async ({ page }) => {
  await openApp(page)
  const label = page.locator('.artboard-label').first()
  const box = (await label.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  await expect(page.locator('.layer-row.selected')).toHaveCount(1)
  expect(await readField(page, 'X')).toBeCloseTo(0, 0)
  // Nothing to undo: a press that never moved writes nothing.
  await press(page, 'z')
  expect(await readField(page, 'X')).toBeCloseTo(0, 0)
})

test('Escape during a label drag puts the artboard back', async ({ page }) => {
  await openApp(page)
  const label = page.locator('.artboard-label').first()
  const box = (await label.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 6 })
  await page.keyboard.press('Escape')
  await page.mouse.up()

  expect(await readField(page, 'X')).toBeCloseTo(0, 0)
})

// -------------------------------------------------------- marquee modes --

/** Drag a selection rectangle across the canvas. */
async function marquee(
  page: import('@playwright/test').Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  alt = false,
) {
  const box = (await page.locator(CANVAS).boundingBox())!
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.move(box.x + from.x, box.y + from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 })
  await page.mouse.up()
  if (alt) await page.keyboard.up('Alt')
}

async function setMarqueeMode(page: import('@playwright/test').Page, mode: 'enclose' | 'touch') {
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-preferences"]').click()
  await page.locator('.dialog select[title^="What a drag-selection"]').selectOption(mode)
  await page.locator('.dialog button', { hasText: 'Done' }).click()
}

/** Three rectangles in a row, with gaps between them. */
async function threeInARow(page: import('@playwright/test').Page) {
  await drawShape(page, 'rect', { x: 240, y: 200 }, { x: 340, y: 300 })
  await drawShape(page, 'rect', { x: 380, y: 200 }, { x: 480, y: 300 })
  await drawShape(page, 'rect', { x: 520, y: 200 }, { x: 620, y: 300 })
  await selectTool(page, 'select')
}

test('a marquee selects everything it touches, by default', async ({ page }) => {
  await openApp(page)
  await threeInARow(page)

  // One stroke through the row takes the whole row — no vertex of any
  // rectangle is inside the band, so this only works if crossed EDGES count.
  await marquee(page, { x: 200, y: 250 }, { x: 660, y: 260 })
  await expect(page.locator('.layer-row.selected')).toHaveCount(3)

  // Even a marquee wholly inside one shape, touching none of its edges.
  await page.keyboard.press('Escape')
  await marquee(page, { x: 260, y: 230 }, { x: 300, y: 270 })
  await expect(page.locator('.layer-row.selected')).toHaveCount(1)
})

test('the Enclose mode takes only what the marquee surrounds', async ({ page }) => {
  await openApp(page)
  await threeInARow(page)
  await setMarqueeMode(page, 'enclose')

  // The same sweep now encloses none of them.
  await marquee(page, { x: 200, y: 250 }, { x: 660, y: 260 })
  await expect(page.locator('.layer-row.selected')).toHaveCount(0)

  // A rectangle round the first two takes exactly those.
  await marquee(page, { x: 210, y: 170 }, { x: 500, y: 330 })
  await expect(page.locator('.layer-row.selected')).toHaveCount(2)
})

test('Alt uses the other mode for one selection, whichever is set', async ({ page }) => {
  await openApp(page)
  await threeInARow(page)

  // Touch is the default: Alt encloses.
  await marquee(page, { x: 200, y: 250 }, { x: 660, y: 260 }, true)
  await expect(page.locator('.layer-row.selected')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await setMarqueeMode(page, 'enclose')
  // Enclose is set: Alt crosses.
  await marquee(page, { x: 200, y: 250 }, { x: 660, y: 260 }, true)
  await expect(page.locator('.layer-row.selected')).toHaveCount(3)
})

test('the marquee mode outlives the tab', async ({ page }) => {
  await openApp(page)
  await setMarqueeMode(page, 'enclose')

  await page.reload()
  await page.waitForSelector(CANVAS)
  await page.waitForTimeout(300)
  await dismissRecovery(page)
  // Drawn after the reload: dismissing the recovery offer starts a fresh
  // document, and the point here is the preference, not the artwork.
  await threeInARow(page)

  // Set to Enclose before the reload, so the sweep must still take nothing.
  await marquee(page, { x: 200, y: 250 }, { x: 660, y: 260 })
  await expect(page.locator('.layer-row.selected')).toHaveCount(0)
})

// ------------------------------------------------------ preference notes --

test('the toolbar can mark the active tool by colour instead of a chip', async ({ page }) => {
  await openApp(page)
  const active = page.locator('.tool-button.active')
  // The default: a filled chip behind the icon.
  await expect(page.locator('.toolbar')).toHaveClass(/highlight-fill/)
  const filled = await active.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(filled).not.toBe('rgba(0, 0, 0, 0)')

  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-preferences"]').click()
  await page.locator('.dialog-row', { hasText: 'Active tool' }).locator('select').selectOption('tint')
  await page.locator('.dialog button').last().click()

  // The chip is gone and the icon carries the signal on its own.
  await expect(page.locator('.toolbar')).toHaveClass(/highlight-tint/)
  await page.mouse.move(700, 400)
  expect(await active.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  expect(await active.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(68, 146, 229)')

  // And it is a preference, so it outlives the tab.
  await page.reload()
  await expect(page.locator('.toolbar')).toHaveClass(/highlight-tint/)
})

test('every preference explains itself behind an (i)', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-preferences"]').click()

  // One button per setting, and nothing explained until asked.
  const buttons = page.locator('.dialog .info-button')
  await expect(buttons).toHaveCount(12)
  await expect(page.locator('.dialog .pref-note')).toHaveCount(0)

  const snap = page.locator('[data-testid="info-snap-objects"]')
  await expect(snap).toHaveAttribute('aria-expanded', 'false')
  await snap.click()
  await expect(snap).toHaveAttribute('aria-expanded', 'true')

  const note = page.locator('.dialog .pref-note')
  await expect(note).toHaveCount(1)
  await expect(note).toContainText('edges and centres')
  // Named by the button that opened it, so a screen reader reads the two together.
  expect(await note.getAttribute('id')).toBe(await snap.getAttribute('aria-controls'))

  // A second one opens alongside rather than replacing it.
  await page.locator('[data-testid="info-marquee-mode"]').click()
  await expect(page.locator('.dialog .pref-note')).toHaveCount(2)

  // And pressing again puts it away.
  await snap.click()
  await expect(page.locator('.dialog .pref-note')).toHaveCount(1)
  await expect(snap).toHaveAttribute('aria-expanded', 'false')
})

// -------------------------------------------------------- stroke pickers --

test('cap, join and alignment each show the option they name', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 460, y: 340 })
  const stroke = page.locator('.section', { hasText: 'STROKE' })
  await stroke.locator('.paint-toggle').check()

  // Three dropdowns, each showing an icon for what it currently holds.
  const pickers = stroke.locator('.icon-select')
  await expect(pickers).toHaveCount(3)
  // The tooltip names the control AND the option it is showing, because the
  // closed control has room for the icon and nothing else.
  expect(
    await pickers.evaluateAll((els) =>
      els.map((e) => `${e.getAttribute('title')}=${e.getAttribute('data-value')}`),
    ),
  ).toEqual([
    'Line cap: Butt=butt',
    'Line join: Miter=miter',
    'Stroke alignment: Center=center',
  ])
  await expect(pickers.first().locator('svg')).toHaveCount(2)

  // Every option in the menu carries an icon, and the current one is ticked.
  await stroke.locator('.icon-select[title^="Stroke alignment"]').click()
  const items = page.locator('.menu-item')
  await expect(items).toHaveCount(3)
  await expect(items.locator('.menu-item-icon')).toHaveCount(3)
  await expect(items.locator('.menu-item-check')).toHaveCount(1)
  await expect(items.filter({ hasText: 'Center' }).locator('.menu-item-check')).toHaveCount(1)

  // Choosing one applies it and shows it on the closed control.
  await items.filter({ hasText: 'Outside' }).click()
  await expect(page.locator('.menu-item')).toHaveCount(0)
  await expect(stroke.locator('.icon-select[title^="Stroke alignment"]')).toHaveAttribute(
    'data-value',
    'outer',
  )
  // Outside alignment is drawn by masking the shape out of a doubled stroke.
  await expect(page.locator('.document-layer mask[id^="sa-mask-"]')).toHaveCount(1)
})

// ------------------------------------------------- reaching a blocked object --

/** Right-click the canvas and read back the menu, then dismiss it. */
async function menuAt(page: import('@playwright/test').Page, x: number, y: number) {
  await page.locator('.canvas-svg').click({ button: 'right', position: { x, y } })
  const items = await page.locator('.menu-item').allTextContents()
  await page.keyboard.press('Escape')
  return items
}

const unblockItems = (items: string[]) => items.filter((t) => /Unlock “|Show “/.test(t))

test('a locked object can be unlocked from the canvas it is sitting on', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 500, y: 380 })
  await selectTool(page, 'select')
  await page.locator('.canvas-svg').click({ position: { x: 400, y: 300 } })
  await press(page, 'l')
  await page.keyboard.press('Escape')

  // A locked object takes no pointer events, so a right-click over it used to
  // find bare canvas and the Layers panel was the only way back.
  expect(unblockItems(await menuAt(page, 400, 300))).toEqual(['Unlock “Rectangle”'])

  await page.locator('.canvas-svg').click({ button: 'right', position: { x: 400, y: 300 } })
  await page.locator('.menu-item', { hasText: /Unlock “/ }).click()

  // Unlocked, so it is clickable again and no longer offered.
  expect(unblockItems(await menuAt(page, 400, 300))).toEqual([])
  await page.locator('.canvas-svg').click({ position: { x: 400, y: 300 } })
  await expect(page.locator('.layer-row.selected')).toHaveCount(1)
})

test('a hidden object can be shown from where it used to be', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'ellipse', { x: 300, y: 200 }, { x: 500, y: 380 })
  await selectTool(page, 'select')
  await page.locator('.canvas-svg').click({ position: { x: 400, y: 300 } })
  await press(page, 'h', true)
  await page.keyboard.press('Escape')
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(0)

  expect(unblockItems(await menuAt(page, 400, 300))).toEqual(['Show “Ellipse”'])
  await page.locator('.canvas-svg').click({ button: 'right', position: { x: 400, y: 300 } })
  await page.locator('.menu-item', { hasText: /Show “/ }).click()
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(1)
})

test('a locked group is offered by name, not the child inside it', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 400, y: 300 })
  await drawShape(page, 'rect', { x: 420, y: 200 }, { x: 520, y: 300 })
  await selectTool(page, 'select')
  await page.keyboard.press('Meta+a')
  await press(page, 'g')
  await press(page, 'l')
  await page.keyboard.press('Escape')

  // Locking a group locks its children by inheritance, so offering to unlock a
  // child would do nothing visible — the flag lives on the group.
  expect(unblockItems(await menuAt(page, 350, 250))).toEqual(['Unlock “Group”'])
})

test('it works for every kind of object, and only over one', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'line', { x: 300, y: 200 }, { x: 500, y: 380 })
  await selectTool(page, 'select')
  await page.locator('.layer-row', { hasText: 'Line' }).click()
  await press(page, 'l')
  await page.keyboard.press('Escape')

  // A hairline is a fair target: the hit test carries the same slack a click has.
  expect(unblockItems(await menuAt(page, 400, 290))).toEqual(['Unlock “Line”'])
  // And nothing is offered over bare canvas.
  expect(unblockItems(await menuAt(page, 750, 520))).toEqual([])
})

test('an object that is both locked and hidden offers both ways back', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 500, y: 380 })
  await selectTool(page, 'select')
  await page.locator('.canvas-svg').click({ position: { x: 400, y: 300 } })
  await press(page, 'l')
  await page.locator('.layer-row', { hasText: 'Rectangle' }).click()
  await press(page, 'h', true)
  await page.keyboard.press('Escape')

  expect(unblockItems(await menuAt(page, 400, 300)).sort()).toEqual([
    'Show “Rectangle”',
    'Unlock “Rectangle”',
  ])
})

test('the selected object is not offered twice', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 500, y: 380 })
  await selectTool(page, 'select')
  await page.locator('.canvas-svg').click({ position: { x: 400, y: 300 } })
  await press(page, 'l')

  // Locking lets go, so getting back to "locked AND selected" now means the
  // Layers panel — the one route a locked object can still be picked by.
  await page.locator('.layer-row', { hasText: 'Rectangle' }).click()
  await expect(page.locator('.layer-row.selected')).toHaveCount(1)

  // Selected, so the menu's own Unlock entry already covers it. Two ways to do
  // one thing in a single menu is worse than one.
  const items = await menuAt(page, 400, 300)
  expect(unblockItems(items)).toEqual([])
  expect(items.some((t) => t.startsWith('Unlock'))).toBe(true)
})

// ------------------------------------------------------- drop target --

/** Fire a synthetic file drag over a point on the canvas, in canvas coordinates. */
async function dragFileAt(page: import('@playwright/test').Page, x: number, y: number) {
  const box = (await page.locator(CANVAS).boundingBox())!
  await page.evaluate(
    ({ cx, cy }) => {
      const el = document.querySelector('[data-testid="canvas-root"]')!
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'photo.png', { type: 'image/png' }))
      for (const type of ['dragenter', 'dragover']) {
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
            dataTransfer: dt,
          }),
        )
      }
    },
    { cx: box.x + x, cy: box.y + y },
  )
}

test('a dragged file highlights the artboard it will land in, by name', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('.drop-target')).toHaveCount(0)

  await dragFileAt(page, 400, 300)
  // The badge says WHAT will happen; the highlight says WHERE, which the cursor
  // cannot show — a file dropped either side of an artboard edge ends up
  // somewhere quite different and the two look identical until it has happened.
  await expect(page.locator('.drop-target')).toHaveCount(1)
  // A message large enough to read without looking for it, in the region it is
  // describing — not a chip beside the cursor.
  const message = page.locator('.drop-message-body')
  await expect(message).toContainText('Import')
  await expect(message).toContainText('Artboard 1')

  // It covers the artboard it names, not the whole canvas.
  // Within the outline's own 2px stroke, which straddles the edge it traces.
  const target = (await page.locator('.drop-target').boundingBox())!
  const artboard = (await nodesOfType(page, 'artboard').first().boundingBox())!
  expect(Math.abs(target.x - artboard.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(target.width - artboard.width)).toBeLessThanOrEqual(2)
})

test('dragging over bare pasteboard highlights nothing and says so', async ({ page }) => {
  await openApp(page)
  await dragFileAt(page, 1000, 620)
  await expect(page.locator('.drop-target')).toHaveCount(0)
  // Still an offer to import — it just lands on the canvas rather than in an
  // artboard, and the label stops naming one.
  await expect(page.locator('.drop-indicator')).toHaveText('Import')
})

test('the highlight names the artboard the file actually lands in', async ({ page }) => {
  await openApp(page)
  await selectTool(page, 'artboard')
  const canvas = (await page.locator(CANVAS).boundingBox())!
  await page.mouse.move(canvas.x + 760, canvas.y + 160)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 1010, canvas.y + 420, { steps: 6 })
  await page.mouse.up()
  await selectTool(page, 'select')

  await dragFileAt(page, 880, 300)
  await expect(page.locator('.drop-message-body')).toContainText('Artboard 2')
  const target = await page.locator('.drop-target').getAttribute('data-drop-target')

  // And that is genuinely where it goes: the highlight reads the same
  // artboardAtPoint the drop itself parents by.
  await dropFiles(page, [{ name: 'photo.png', type: 'image/png', base64: RED_PNG_BASE64 }], { x: 880, y: 300 })
  const parent = await page.locator('.document-layer image').evaluate(
    (el) => el.closest('[data-node-type="artboard"]')?.getAttribute('data-node-id') ?? null,
  )
  expect(parent).toBe(target)
})

test('the highlight goes when the drag leaves', async ({ page }) => {
  await openApp(page)
  await dragFileAt(page, 400, 300)
  await expect(page.locator('.drop-target')).toHaveCount(1)
  await expect(page.locator('.drop-message')).toHaveCount(1)

  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="canvas-root"]')!
    el.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.drop-target')).toHaveCount(0)
  await expect(page.locator('.drop-message')).toHaveCount(0)
})

// ------------------------------------------------- lock and hide let go --

test('locking the selection lets go of it', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 500, y: 380 })
  await selectTool(page, 'select')
  await page.locator('.canvas-svg').click({ position: { x: 400, y: 300 } })
  await expect(page.locator('.layer-row.selected')).toHaveCount(1)

  await press(page, 'l')
  // A selection frame over something you can no longer touch is a lie: the
  // handles do nothing and the inspector offers edits that will not apply.
  await expect(page.locator('.layer-row.selected')).toHaveCount(0)
  await expect(page.locator('.transform-frame, .selection-frame')).toHaveCount(0)

  // Unlocking does not take it back: you may have been clearing it out of the
  // way of something else.
  await press(page, 'l')
  await expect(page.locator('.layer-row.selected')).toHaveCount(0)
})

test('hiding the selection lets go of it', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'ellipse', { x: 300, y: 200 }, { x: 500, y: 380 })
  await selectTool(page, 'select')
  await page.locator('.canvas-svg').click({ position: { x: 400, y: 300 } })

  await press(page, 'h', true)
  await expect(page.locator('.layer-row.selected')).toHaveCount(0)
  await expect(page.locator('.transform-frame, .selection-frame')).toHaveCount(0)
})

test('locking a group lets go of a child selected inside it', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 400, y: 300 })
  await drawShape(page, 'ellipse', { x: 420, y: 200 }, { x: 520, y: 300 })
  await selectTool(page, 'select')
  await page.keyboard.press('Meta+a')
  await press(page, 'g')
  await page.keyboard.press('Escape')

  // Step into the group and pick one child.
  await page.locator('.canvas-svg').dblclick({ position: { x: 350, y: 250 } })
  await expect(page.locator('.layer-row.selected')).toHaveCount(1)

  // Lock the GROUP from its own layer row, leaving the child selected — the
  // row action does not change the selection.
  const groupRow = page.locator('.layer-row', { hasText: 'Group' })
  await groupRow.hover()
  await groupRow.locator('[title="Lock"]').click()

  // The child is exactly as untouchable as the group that now contains it.
  await expect(page.locator('.layer-row.selected')).toHaveCount(0)
})

test('locking something else leaves the selection alone', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 400, y: 300 })
  await drawShape(page, 'ellipse', { x: 500, y: 200 }, { x: 600, y: 300 })
  await selectTool(page, 'select')
  await page.locator('.canvas-svg').click({ position: { x: 350, y: 250 } })
  const selected = await page.locator('.layer-row.selected').textContent()

  // Lock the OTHER one through its layer row, which does not change the selection.
  const other = page.locator('.layer-row', { hasText: 'Ellipse' })
  await other.hover()
  await other.locator('[title="Lock"]').click()

  await expect(page.locator('.layer-row.selected')).toHaveCount(1)
  expect(await page.locator('.layer-row.selected').textContent()).toBe(selected)
})

test('locking a shape being point-edited closes the point editor', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 500, y: 380 })
  await selectTool(page, 'select')
  await page.locator('.canvas-svg').dblclick({ position: { x: 400, y: 300 } })
  await expect(page.locator('.anchor-point')).toHaveCount(4)

  await press(page, 'l')
  // Holding a point editor open over a locked shape is the same lie in a
  // different shape.
  await expect(page.locator('.anchor-point')).toHaveCount(0)
  await expect(page.locator('.edit-outline')).toHaveCount(0)
})

test('the drop message shrinks to a chip where there is no room for it', async ({ page }) => {
  await openApp(page)
  // An artboard too small to hold the panel: the outline still shows, the
  // words would otherwise be wider than the thing they describe.
  await selectTool(page, 'artboard')
  const canvas = (await page.locator(CANVAS).boundingBox())!
  await page.mouse.move(canvas.x + 780, canvas.y + 480)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 860, canvas.y + 540, { steps: 4 })
  await page.mouse.up()
  await selectTool(page, 'select')

  await dragFileAt(page, 820, 510)
  await expect(page.locator('.drop-target')).toHaveCount(1)
  await expect(page.locator('.drop-message')).toHaveCount(1)
  await expect(page.locator('.drop-message-body')).toHaveCount(0)
})

// ------------------------------------------------------------- language --

/** Open Preferences and pick a language, whatever language it is currently in. */
async function setLanguage(page: import('@playwright/test').Page, code: string) {
  await page.locator('[data-testid="app-menu"]').click()
  // The menu item is itself translated, so it is found by position rather than
  // by text: the menu is in whatever language was chosen last.
  await page.locator('[data-testid="menu-preferences"]').click()
  await page.locator('.dialog select').first().selectOption(code)
  await page.locator('.dialog button').last().click()
}

test('the interface can be shown in another language', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('.tool-button').first()).toHaveAttribute('aria-label', 'Select')

  await setLanguage(page, 'de')
  // The rail, the panel and the menu all follow — not just the dialog the
  // choice was made in.
  await expect(page.locator('.tool-button').first()).toHaveAttribute('aria-label', 'Auswählen')
  await expect(page.locator('.section-title').first()).toHaveText('Dokument')
  await page.locator('[data-testid="app-menu"]').click()
  await expect(page.locator('.menu-item').first()).toHaveText(/Neu/)
  await page.keyboard.press('Escape')

  // Including languages with no shared alphabet.
  await setLanguage(page, 'ja')
  await expect(page.locator('.tool-button').first()).toHaveAttribute('aria-label', '選択')
  await expect(page.locator('.section-title').first()).toHaveText('ドキュメント')
})

test('the language outlives the tab', async ({ page }) => {
  await openApp(page)
  await setLanguage(page, 'zh')
  await expect(page.locator('.tool-button').first()).toHaveAttribute('aria-label', '选择')

  await page.reload()
  await page.waitForSelector(CANVAS)
  await dismissRecovery(page)
  await expect(page.locator('.tool-button').first()).toHaveAttribute('aria-label', '选择')

  await setLanguage(page, 'en')
})

test('the language menu names each language in itself', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-preferences"]').click()

  const options = await page.locator('.dialog select').first().locator('option').allTextContents()
  // The one menu that cannot be translated: someone looking for their own
  // language is looking for the word they use for it.
  expect(options).toEqual([
    'English',
    'Български',
    'Deutsch',
    'Español',
    'Français',
    'Português',
    '中文',
    '日本語',
  ])
})

test('every icon sits in the middle of the control that holds it', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 250 }, { x: 460, y: 360 })
  await drawShape(page, 'ellipse', { x: 500, y: 250 }, { x: 600, y: 340 })
  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)
  await page.waitForTimeout(300)

  const offset = await page.evaluate(() => {
    const out: Array<{ where: string; dx: number; dy: number }> = []
    for (const svg of document.querySelectorAll('svg')) {
      const host = svg.parentElement
      if (!(host instanceof HTMLElement)) continue
      const h = host.getBoundingClientRect()
      const s = svg.getBoundingClientRect()
      // Small chrome icons only — not the canvas, not the overlays.
      if (!s.width || s.width > 40 || h.width > 60) continue
      out.push({
        where: `${host.tagName.toLowerCase()}.${host.className.toString().split(' ')[0]} ${
          host.getAttribute('title') ?? host.getAttribute('aria-label') ?? ''
        }`.trim(),
        dx: (s.x + s.width / 2) - (h.x + h.width / 2),
        dy: (s.y + s.height / 2) - (h.y + h.height / 2),
      })
    }
    return out
  })

  // Enough of the UI is on screen for this to mean something.
  expect(offset.length).toBeGreaterThan(30)

  // A button carries the browser's own padding unless it is reset, and with
  // border-box that shrinks the content box under the icon. A grid track that
  // overflows its container overflows to ONE side, so the icon lands off centre
  // rather than merely overflowing evenly — which is how every icon in the app
  // came to sit two pixels right of where it belonged.
  const crooked = offset.filter((o) => Math.abs(o.dx) > 0.5 || Math.abs(o.dy) > 0.5)
  expect(
    crooked.map((o) => `${o.where} dx=${o.dx.toFixed(2)} dy=${o.dy.toFixed(2)}`),
  ).toEqual([])
})
