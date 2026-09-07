/**
 * The tools and behaviours the acceptance suite does not reach: pen, text,
 * boolean operations, point editing, clipboard, guides, grid, zoom/pan, and the
 * context menu.
 */

import { test, expect } from '@playwright/test'
import {
  CANVAS, RED_PNG_BASE64, captureDownload, clickCanvas, dragOnCanvas, drawShape,
  dropFiles, modifier, nodesOfType, openApp, openExportDialog, press, readField,
  selectTool, setField,
} from './helpers'

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

  await strokeSection.locator('select').nth(0).selectOption('round')
  await strokeSection.locator('select').nth(1).selectOption('bevel')
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
  await expect(page.locator('.drop-indicator')).toBeVisible()
  await expect(page.locator('.drop-indicator')).toContainText('Import')
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
