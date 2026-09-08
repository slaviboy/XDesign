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
 * The four features added after the first release: dark theme, the Transform
 * panel, corner rotation, and Repeat Grid with the boolean toolbar.
 */

import { test, expect } from '@playwright/test'
import {
  CANVAS, captureDownload, dragOnCanvas, drawShape, modifier,
  nodesOfType, openApp, openExportDialog, readField, selectTool, setField,
} from './helpers'

// ---------------------------------------------------------------- theme --

test('theme toggle flips the chrome and leaves artboards alone', async ({ page }) => {
  await openApp(page)
  const html = page.locator('html')

  const before = await html.getAttribute('data-theme')
  await page.locator('[data-testid="theme-toggle"]').click()
  const after = await html.getAttribute('data-theme')
  expect(after).not.toBe(before)
  expect(['light', 'dark']).toContain(after)

  // The chrome follows the theme...
  const panelBg = await page.locator('.inspector').evaluate((e) => getComputedStyle(e).backgroundColor)
  expect(panelBg).toBeTruthy()

  // ...but an artboard's background is DOCUMENT data and must not change: the
  // artwork has to look the same to everyone who opens the file.
  // rect[fill] specifically: the first plain <rect> under an artboard is the
  // one inside its clipPath, which carries no fill.
  const artboardFill = await page
    .locator('.document-layer [data-node-type="artboard"] rect[fill]')
    .first()
    .getAttribute('fill')
  expect(artboardFill?.toLowerCase()).toBe('#ffffff')
})

test('the theme choice survives a reload', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-testid="theme-toggle"]').click()
  const chosen = await page.locator('html').getAttribute('data-theme')

  await page.reload()
  await page.waitForSelector(CANVAS)
  expect(await page.locator('html').getAttribute('data-theme')).toBe(chosen)
})

test('the theme is applied before first paint, with no flash', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-testid="theme-toggle"]').click()
  await page.waitForTimeout(100)

  // Read data-theme at the earliest possible moment on the next load. If the
  // theme were applied by React instead of the inline boot script, this would
  // come back null and the user would see a white flash.
  await page.goto('/')
  const atDocumentStart = await page.evaluate(() => document.documentElement.dataset.theme)
  expect(['light', 'dark']).toContain(atDocumentStart)
})

test('follow-system is reachable from the app menu', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'Theme' }).hover()
  await expect(page.locator('.menu-item', { hasText: 'Follow system' })).toBeVisible()
  await page.locator('.menu-item', { hasText: 'Follow system' }).click()
  await expect(page.locator('[data-testid="theme-toggle"]')).toHaveAttribute(
    'data-theme-preference',
    'system',
  )
})

// ------------------------------------------------------------ transform --

test('transform panel lays out W/H, X/Y and rotation', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 400, y: 300 })

  await expect(page.locator('.section-title', { hasText: 'Transform' })).toBeVisible()
  for (const label of ['W', 'H', 'X', 'Y']) {
    await expect(
      page.locator('.transform-grid .field-label', { hasText: new RegExp(`^${label}$`) }),
    ).toHaveCount(1)
  }
  // W sits left of X, matching the reference layout.
  const w = (await page.locator('.tf-w').boundingBox())!
  const x = (await page.locator('.tf-x').boundingBox())!
  const h = (await page.locator('.tf-h').boundingBox())!
  expect(w.x).toBeLessThan(x.x)
  expect(h.y).toBeGreaterThan(w.y)
  // Both columns get a real share of the width.
  expect(w.width).toBeGreaterThan(40)
})

test('aspect-ratio lock scales the other dimension', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 400, y: 300 })
  await setField(page, 'W', 200)
  await setField(page, 'H', 100)

  await page.locator('[data-testid="aspect-lock"]').click()
  await expect(page.locator('[data-testid="aspect-lock"]')).toHaveAttribute('aria-pressed', 'true')

  await setField(page, 'W', 400)
  expect(await readField(page, 'H')).toBeCloseTo(200, 0)

  // Unlocking stops the coupling.
  await page.locator('[data-testid="aspect-lock"]').click()
  await setField(page, 'W', 100)
  expect(await readField(page, 'H')).toBeCloseTo(200, 0)
})

test('the locked ratio does not drift across repeated edits', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 400, y: 300 })
  await setField(page, 'W', 300)
  await setField(page, 'H', 100)
  await page.locator('[data-testid="aspect-lock"]').click()

  // Recomputing the ratio each keystroke would compound rounding error here.
  for (const width of [150, 600, 240, 90, 333]) await setField(page, 'W', width)
  expect(await readField(page, 'W')).toBeCloseTo(333, 0)
  expect(await readField(page, 'H')).toBeCloseTo(111, 0)
})

test('match width, height and size act on a multi-selection', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 260, y: 240 })
  await drawShape(page, 'rect', { x: 320, y: 200 }, { x: 460, y: 300 })
  await selectTool(page, 'select')

  await expect(page.locator('button[aria-label="Match width"]')).toBeDisabled()
  await page.keyboard.press(`${modifier()}+a`)
  await expect(page.locator('button[aria-label="Match width"]')).toBeEnabled()

  await page.locator('button[aria-label="Match size"]').click()
  const sizes = await page.locator('.document-layer [data-node-type="rect"]').evaluateAll((els) =>
    els.map((e) => e.querySelector('path')?.getAttribute('d')),
  )
  expect(sizes[0]).toBe(sizes[1])
})

// ------------------------------------------------------------- rotation --

test('corners carry a rotation cursor, including for a multi-selection', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 400, y: 320 })
  await selectTool(page, 'select')

  const zones = page.locator('[data-handle="rotate"]')
  await expect(zones).toHaveCount(4)
  const cursor = await zones.first().evaluate((e) => (e as SVGElement).style.cursor)
  // A data-URL cursor, so it needs no network and cannot 404 offline.
  expect(cursor).toContain('data:image/svg+xml')
  expect(cursor).toContain('crosshair') // fallback

  // Opposite corners point in opposite directions, so the cursor really is
  // derived from the corner rather than being one fixed image.
  const cursors = await zones.evaluateAll((els) => els.map((e) => (e as SVGElement).style.cursor))
  expect(new Set(cursors).size).toBeGreaterThan(1)

  await drawShape(page, 'ellipse', { x: 450, y: 200 }, { x: 560, y: 320 })
  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)
  await expect(page.locator('[data-handle="rotate"]')).toHaveCount(4)
})

/** The SVG inside a `url("data:image/svg+xml,...")` cursor. */
function cursorSvg(cursor: string): string {
  const start = cursor.indexOf(',') + 1
  return decodeURIComponent(cursor.slice(start, cursor.indexOf('")', start)))
}

test('the rotation cursor is a double arrow turned toward its own corner', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 430, y: 320 })
  await selectTool(page, 'select')

  const zones = page.locator('[data-handle="rotate"]')
  const cursors = await zones.evaluateAll((els) => els.map((e) => (e as SVGElement).style.cursor))
  const svgs = cursors.map(cursorSvg)

  // A double-headed arrow: one closed outline, drawn twice — a white underlay
  // and the dark shape over it, which is what keeps it legible on any artwork.
  for (const svg of svgs) {
    const paths = svg.match(/<path[^>]*>/g) ?? []
    expect(paths).toHaveLength(2)
    expect(svg).toContain('stroke="#fff"')
    expect(svg).toContain('fill="#1a1a1a"')
    // Two arcs — the outer and inner edges of the band — and two arrowheads:
    // three straight edges each, plus the one that returns from the first head
    // onto the inner edge. The second head is closed by the Z instead.
    const d = /d="([^"]+)"/.exec(svg)![1]!
    expect((d.match(/A/g) ?? []).length).toBe(2)
    expect((d.match(/L/g) ?? []).length).toBe(7)
    expect(d.endsWith('Z')).toBe(true)
  }

  // Each corner gets its own orientation, aimed out along that corner's own
  // diagonal — the arc bulging away from the object, which is what reads as
  // turning around it rather than sliding along an edge. The rectangle is
  // deliberately not square, so a cursor hard-coded to the diagonals would fail
  // here.
  const frame = (await page.locator('.selection-frame').boundingBox())!
  const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
  const boxes = await Promise.all(
    (await zones.all()).map(async (z) => (await z.boundingBox())!),
  )

  const angles = svgs.map((svg) => Number(/rotate\((-?[\d.]+)/.exec(svg)![1]))
  boxes.forEach((box, i) => {
    const outward =
      (Math.atan2(box.y + box.height / 2 - centre.y, box.x + box.width / 2 - centre.x) * 180) /
      Math.PI
    // The glyph is built bulging upward, so facing it outward is a further
    // quarter turn. Sixteen pre-rendered orientations means up to 11.25 degrees
    // of rounding.
    const off = Math.abs(((angles[i]! - (outward + 90) + 540) % 360) - 180)
    expect(off, `corner ${i}`).toBeLessThan(15)
  })
  expect(new Set(angles).size).toBe(4)

  // And it follows the object: turning the rectangle turns every cursor with
  // it, because the angle comes from the on-screen frame rather than the corner
  // it started at.
  await setField(page, '∠', 30)
  const turned = (await zones.evaluateAll((els) => els.map((e) => (e as SVGElement).style.cursor)))
    .map((c) => Number(/rotate\((-?[\d.]+)/.exec(cursorSvg(c))![1]))
  expect(turned.some((a, i) => a !== angles[i])).toBe(true)
})

test('the rotation cursor cannot clip, at any angle it is drawn', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 430, y: 320 })
  await selectTool(page, 'select')

  const svg = cursorSvg(
    await page.locator('[data-handle="rotate"]').first().evaluate((e) => (e as SVGElement).style.cursor),
  )
  const d = /d="([^"]+)"/.exec(svg)![1]!

  // A cursor image is a fixed 24x24 box that CSS cannot transform, so every one
  // of the sixteen pre-rendered orientations has to fit inside it on its own.
  // Measured with the browser's own path maths rather than by reading numbers
  // out of the `d`, because the extreme point of an arc is not one of its
  // endpoints.
  const worst = await page.evaluate((path) => {
    const ns = 'http://www.w3.org/2000/svg'
    const svgEl = document.createElementNS(ns, 'svg')
    svgEl.setAttribute('width', '24')
    svgEl.setAttribute('height', '24')
    document.body.append(svgEl)
    let out = { min: 99, max: -99 }
    for (let i = 0; i < 16; i++) {
      const g = document.createElementNS(ns, 'g')
      g.setAttribute('transform', `rotate(${i * 22.5} 12 12)`)
      const p = document.createElementNS(ns, 'path')
      p.setAttribute('d', path)
      g.append(p)
      svgEl.append(g)
      const b = g.getBBox()
      out = {
        min: Math.min(out.min, b.x, b.y),
        max: Math.max(out.max, b.x + b.width, b.y + b.height),
      }
      g.remove()
    }
    svgEl.remove()
    return out
  }, d)

  // 1.5 of margin on each side: the white underlay is a 3-wide stroke, drawn
  // half outside the shape.
  expect(worst.min).toBeGreaterThanOrEqual(1.5)
  expect(worst.max).toBeLessThanOrEqual(22.5)
  // And it actually uses the space it is given — a glyph shrunk to be safe
  // would pass the test above and be unreadable at 24 pixels.
  expect(worst.max - worst.min).toBeGreaterThan(15)
})

test('dragging a corner zone rotates the object', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 420, y: 320 })
  await selectTool(page, 'select')
  // The rotation field is labelled with an icon, so it is addressed by class.
  const rotationInput = page.locator('.tf-rot input')
  expect(Number.parseFloat(await rotationInput.inputValue())).toBeCloseTo(0, 1)

  const frame = (await page.locator('.selection-frame').boundingBox())!
  const canvas = (await page.locator(CANVAS).boundingBox())!
  // Grab just outside the top-left corner, where the rotate zone sits.
  const start = { x: frame.x - canvas.x - 8, y: frame.y - canvas.y - 8 }
  const centre = {
    x: frame.x - canvas.x + frame.width / 2,
    y: frame.y - canvas.y + frame.height / 2,
  }
  // Swing a quarter turn around the centre.
  const end = { x: centre.x + (start.y - centre.y), y: centre.y - (start.x - centre.x) }
  await dragOnCanvas(page, start, end, { steps: 20 })

  const rotated = Number.parseFloat(await rotationInput.inputValue())
  expect(Math.abs(rotated)).toBeGreaterThan(45)
})

test('resize still wins when the pointer is on the handle itself', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 420, y: 320 })
  await selectTool(page, 'select')
  const widthBefore = await readField(page, 'W')

  const frame = (await page.locator('.selection-frame').boundingBox())!
  const canvas = (await page.locator(CANVAS).boundingBox())!
  // Dead centre of the SE handle — resize must win over the rotate zone.
  const handle = {
    x: frame.x - canvas.x + frame.width,
    y: frame.y - canvas.y + frame.height,
  }
  await dragOnCanvas(page, handle, { x: handle.x + 60, y: handle.y + 40 })

  expect(await readField(page, 'W')).toBeGreaterThan(widthBefore + 50)
  expect(Number.parseFloat(await page.locator('.tf-rot input').inputValue())).toBeCloseTo(0, 1)
})

// ---------------------------------------------------------- repeat grid --

test('repeat grid tiles one source and stays one source', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 330, y: 280 })
  await selectTool(page, 'select')

  await page.locator('[data-testid="repeat-grid"]').click()
  await expect(nodesOfType(page, 'repeat-grid')).toHaveCount(1)

  await setField(page, 'Cols', 4)
  await setField(page, 'Rows', 3)
  // 12 visible cells...
  await expect(page.locator('.document-layer [data-node-type="repeat-grid"] path')).toHaveCount(12)
  // ...from exactly one stored child.
  await expect(page.locator('.layer-row', { hasText: 'Rectangle' })).toHaveCount(1)
})

test('editing the source updates every cell', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 330, y: 280 })
  await selectTool(page, 'select')
  await page.locator('[data-testid="repeat-grid"]').click()
  await setField(page, 'Cols', 3)

  // Change the one source child's fill; all three repeats must follow.
  await page.locator('.layer-row', { hasText: 'Rectangle' }).click()
  await page.locator('.section', { hasText: 'FILL' }).locator('.swatch').first().click()
  const hex = page.locator('.popover .field', { has: page.locator('.field-label:text-is("#")') }).locator('input')
  await hex.fill('ff0000')
  await hex.press('Enter')
  await page.keyboard.press('Escape')

  const fills = await page
    .locator('.document-layer [data-node-type="repeat-grid"] path')
    .evaluateAll((els) => els.map((e) => e.getAttribute('fill')))
  expect(fills).toHaveLength(3)
  expect(new Set(fills)).toEqual(new Set(['#ff0000']))
})

test('gutters space the cells apart', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 330, y: 280 })
  await selectTool(page, 'select')
  await page.locator('[data-testid="repeat-grid"]').click()
  await setField(page, 'Cols', 2)
  // Start from a known gutter — a new grid defaults to 16, not 0.
  await setField(page, 'Gap X', 0)
  const flush = await readField(page, 'W')
  await setField(page, 'Gap X', 50)
  expect(await readField(page, 'W')).toBeCloseTo(flush + 50, 0)

  // Negative gutters are legitimate: overlapping repeats are a real design.
  await setField(page, 'Gap X', -20)
  expect(await readField(page, 'W')).toBeCloseTo(flush - 20, 0)
})

test('expand turns the grid into independent objects', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 330, y: 280 })
  await selectTool(page, 'select')
  await page.locator('[data-testid="repeat-grid"]').click()
  await setField(page, 'Cols', 3)

  await page.locator('[data-testid="expand-repeat-grid"]').click()
  await expect(nodesOfType(page, 'repeat-grid')).toHaveCount(0)
  await expect(nodesOfType(page, 'rect')).toHaveCount(3)
  await expect(page.locator('.layer-row', { hasText: 'Rectangle' })).toHaveCount(3)
})

test('repeat grid exports every cell as real vector', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 330, y: 280 })
  await selectTool(page, 'select')
  await page.locator('[data-testid="repeat-grid"]').click()
  await setField(page, 'Cols', 3)
  await setField(page, 'Rows', 2)

  const out = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page.locator('[role="dialog"] .dialog-row', { hasText: 'Format' }).locator('select').selectOption('svg')
    await page.locator('button:text-is("Export")').click()
  })
  const svg = out.buffer.toString('utf8')
  // Six real <rect> elements, not one bitmap and not one cell.
  expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(6)
  expect(svg).not.toContain('data:image/png')
})

// -------------------------------------------------------- boolean toolbar --

test('boolean toolbar is always present and enables with two shapes', async ({ page }) => {
  await openApp(page)
  for (const op of ['union', 'subtract', 'intersect', 'exclude']) {
    await expect(page.locator(`[data-testid="boolean-${op}"]`)).toBeVisible()
    await expect(page.locator(`[data-testid="boolean-${op}"]`)).toBeDisabled()
  }

  await drawShape(page, 'ellipse', { x: 250, y: 200 }, { x: 370, y: 320 })
  await drawShape(page, 'ellipse', { x: 320, y: 200 }, { x: 440, y: 320 })
  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)
  await expect(page.locator('[data-testid="boolean-union"]')).toBeEnabled()

  await page.locator('[data-testid="boolean-union"]').click()
  await expect(nodesOfType(page, 'path')).toHaveCount(1, { timeout: 15000 })
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(0)
})

test('the boolean toolbar replaced the old Combine section', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 300 })
  await drawShape(page, 'rect', { x: 320, y: 200 }, { x: 420, y: 300 })
  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)
  // One way to do it, not two.
  await expect(page.locator('.section-title', { hasText: 'Combine' })).toHaveCount(0)
})

test('the rotation readout is meaningful for a multi-selection', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 320, y: 300 })
  await drawShape(page, 'rect', { x: 360, y: 200 }, { x: 460, y: 300 })
  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)

  const frame = (await page.locator('.selection-frame').boundingBox())!
  const canvas = (await page.locator(CANVAS).boundingBox())!
  const start = { x: frame.x - canvas.x - 7, y: frame.y - canvas.y - 7 }
  const centre = {
    x: frame.x - canvas.x + frame.width / 2,
    y: frame.y - canvas.y + frame.height / 2,
  }
  const end = { x: centre.x + (start.y - centre.y), y: centre.y - (start.x - centre.x) }

  // Read the badge mid-drag, before the gesture commits.
  const a = await page.locator(CANVAS).boundingBox()
  await page.mouse.move(a!.x + start.x, a!.y + start.y)
  await page.mouse.down()
  await page.mouse.move(a!.x + end.x, a!.y + end.y, { steps: 15 })

  const badge = await page.locator('.size-badge text').first().textContent()
  await page.mouse.up()

  // A multi-selection's frame is axis-aligned, so its own angle is always 0.
  // The badge must report the turn instead, or it reads "0°" the whole way.
  expect(badge).toMatch(/^[+-]\d+°$/)
  expect(Math.abs(Number.parseInt(badge!.replace('°', ''), 10))).toBeGreaterThan(45)
})
