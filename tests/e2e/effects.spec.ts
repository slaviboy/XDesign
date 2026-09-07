/**
 * Masking and effects: Mask With Shape, background and object blur, drop and
 * inner shadow, and Outline Stroke.
 *
 * Each is checked through the rendered SVG rather than through the store, so a
 * setting that never reaches the picture fails here — which is the failure mode
 * that matters for an effect.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  CANVAS, captureDownload, drawShape, nodesOfType, openApp, openExportDialog,
  press, selectTool,
} from './helpers'

const section = (page: Page, name: string) => page.locator('.section', { hasText: name })
const filterOf = (page: Page, nth = 0) =>
  page.locator('.document-layer filter').nth(nth).innerHTML()

/** Select two layers by name, which is steadier than clicking overlapping art. */
async function selectLayers(page: Page, names: string[]) {
  await selectTool(page, 'select')
  await page.locator('.layer-row', { hasText: names[0]! }).first().click()
  for (const name of names.slice(1)) {
    await page.locator('.layer-row', { hasText: name }).first().click({ modifiers: ['Shift'] })
  }
}

// ----------------------------------------------------------------- shadows --

test('Drop Shadow and Inner Shadow are two shapes of the same effect', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 460, y: 340 })
  const shadow = section(page, 'SHADOW')

  // Off to begin with: no effect, and nothing in the picture.
  await expect(shadow.locator('.paint-toggle')).not.toBeChecked()
  await expect(page.locator('.document-layer filter')).toHaveCount(0)

  await shadow.locator('.paint-toggle').check()
  expect(await filterOf(page)).toContain('feDropShadow')

  await shadow.locator('select').selectOption('inner')
  const inner = await filterOf(page)
  expect(inner).not.toContain('feDropShadow')
  // The shape minus a shifted copy of itself, flooded and drawn back on top.
  expect(inner).toContain('feOffset')
  expect(inner).toContain('operator="out"')
  expect(inner).toContain('feFlood')
})

test('the shadow X, Y and B fields drive what is drawn', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 460, y: 340 })
  const shadow = section(page, 'SHADOW')
  await shadow.locator('.paint-toggle').check()

  for (const [label, value, attr, expected] of [
    ['X', '12', 'dx', '12'],
    ['Y', '-8', 'dy', '-8'],
    ['B', '30', 'stdDeviation', '15'],
  ] as const) {
    const field = shadow.locator('.field', { has: page.locator(`.field-label:text-is("${label}")`) })
    await field.locator('input').fill(value)
    await field.locator('input').press('Enter')
    expect(await filterOf(page), label).toContain(`${attr}="${expected}"`)
  }
})

test('unchecking a shadow keeps its settings for when it comes back', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 460, y: 340 })
  const shadow = section(page, 'SHADOW')
  await shadow.locator('.paint-toggle').check()
  const blur = shadow.locator('.field', { has: page.locator('.field-label:text-is("B")') }).locator('input')
  await blur.fill('26')
  await blur.press('Enter')

  await shadow.locator('.paint-toggle').uncheck()
  await expect(page.locator('.document-layer filter')).toHaveCount(0)

  // Adobe: the checkbox turns the effect off. It does not discard it.
  await shadow.locator('.paint-toggle').check()
  expect(await filterOf(page)).toContain('stdDeviation="13"')
})

// -------------------------------------------------------------------- blur --

test('background blur shows three controls, object blur shows one', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 460, y: 340 })
  const blur = section(page, 'BLUR')
  await blur.locator('.paint-toggle').check()

  // Adobe: Blur Amount, Brightness and Opacity for a background blur.
  await expect(blur.locator('.slider-row')).toHaveCount(3)
  await expect(blur.locator('.slider-row-label')).toHaveText(['Amount', 'Brightness', 'Opacity'])

  // "Ignored for object blur effects" — so they are not shown for one.
  await blur.locator('select').selectOption('object')
  await expect(blur.locator('.slider-row')).toHaveCount(1)
  await expect(blur.locator('.slider-row-label')).toHaveText(['Amount'])
})

test('object blur blurs the shape; background blur blurs what is behind it', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 420, y: 360 })
  await drawShape(page, 'rect', { x: 320, y: 250 }, { x: 560, y: 400 })
  const blur = section(page, 'BLUR')
  await blur.locator('.paint-toggle').check()

  // A background blur re-draws the artwork beneath, blurred and clipped to the
  // shape — there is no SVG filter that can read a backdrop.
  await expect(page.locator('.document-layer clipPath[id^="bdclip-"]')).toHaveCount(1)
  const backdrop = page.locator('.document-layer filter[id^="bdblur-"]')
  await expect(backdrop).toHaveCount(1)
  expect(await backdrop.innerHTML()).toContain('feGaussianBlur')
  // The copy is not clickable; only the real shape is.
  await expect(page.locator('.document-layer g[clip-path^="url(#bdclip"]')).toHaveAttribute(
    'pointer-events',
    'none',
  )

  await blur.locator('select').selectOption('object')
  await expect(page.locator('.document-layer clipPath[id^="bdclip-"]')).toHaveCount(0)
  expect(await filterOf(page)).toContain('feGaussianBlur')
})

test('a background blur lets its own fill fade so the blur shows through', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 420, y: 360 })
  await drawShape(page, 'rect', { x: 320, y: 250 }, { x: 560, y: 400 })
  const painted = nodesOfType(page, 'rect').nth(1).locator('path').first()
  expect(Number(await painted.getAttribute('fill-opacity'))).toBe(1)

  await section(page, 'BLUR').locator('.paint-toggle').check()
  // Adobe: the shape is drawn "with its fill modulated by fillOpacity".
  expect(Number(await painted.getAttribute('fill-opacity'))).toBeCloseTo(0.5, 2)

  const opacity = section(page, 'BLUR')
    .locator('.slider-row', { hasText: 'Opacity' })
    .locator('input[type="text"]')
  await opacity.fill('100')
  await opacity.press('Enter')
  expect(Number(await painted.getAttribute('fill-opacity'))).toBe(1)
})

// -------------------------------------------------------------------- mask --

test('the topmost object masks the rest, and nothing is deleted', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 480, y: 380 })
  await drawShape(page, 'ellipse', { x: 280, y: 230 }, { x: 430, y: 350 })
  await selectLayers(page, ['Ellipse', 'Rectangle'])
  await press(page, 'M', true)

  await expect(page.locator('.document-layer clipPath[id^="mask-clip-"]')).toHaveCount(1)
  // Both objects are still in the document — Adobe: the masked area "is not
  // deleted from your project".
  await expect(page.locator('.layer-row', { hasText: 'Mask Group' })).toHaveCount(1)
  await expect(page.locator('.layer-row', { hasText: 'Ellipse' })).toHaveCount(1)
  await expect(page.locator('.layer-row', { hasText: 'Rectangle' })).toHaveCount(1)

  // The mask itself is not painted: it is the clip, not artwork.
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(0)
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
})

test('a mask group is framed and hit-tested by its mask, not by what it hides', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 480, y: 380 })
  await drawShape(page, 'ellipse', { x: 300, y: 250 }, { x: 400, y: 330 })
  await selectLayers(page, ['Ellipse', 'Rectangle'])
  await press(page, 'M', true)

  // The frame is the mask's box, not the union: framing the rectangle would
  // draw a selection round artwork that is not on screen.
  const frame = (await page.locator('.transform-frame, .selection-frame').first().boundingBox())!
  const canvas = (await page.locator(CANVAS).boundingBox())!
  expect(frame.width).toBeLessThan(160)
  expect(frame.x - canvas.x).toBeGreaterThan(280)

  // A corner of the hidden rectangle is not clickable, because nothing is drawn
  // there any more.
  await page.keyboard.press('Escape')
  await page.locator('.canvas-svg').click({ position: { x: 240, y: 215 } })
  await expect(page.locator('.layer-row.selected')).toHaveCount(0)

  // The middle, which the mask reveals, still is. (Which layer a click inside a
  // group resolves to is the group machinery's business and unchanged here;
  // what masking decides is whether there is anything to hit at all.)
  await page.locator('.canvas-svg').click({ position: { x: 350, y: 290 } })
  await expect(page.locator('.layer-row.selected')).toHaveCount(1)
})

test('Ungroup Mask hands both objects back', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 480, y: 380 })
  await drawShape(page, 'ellipse', { x: 280, y: 230 }, { x: 430, y: 350 })
  await selectLayers(page, ['Ellipse', 'Rectangle'])
  await press(page, 'M', true)

  await page.locator('.canvas-svg').click({ button: 'right', position: { x: 350, y: 290 } })
  await page.locator('.menu-item', { hasText: 'Ungroup Mask' }).click()

  await expect(page.locator('.layer-row', { hasText: 'Mask Group' })).toHaveCount(0)
  await expect(page.locator('.document-layer clipPath[id^="mask-clip-"]')).toHaveCount(0)
  // The mask is a normal object again, drawn rather than clipping.
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(1)
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
})

test('a line cannot be a mask, because it hides everything', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 480, y: 380 })
  await drawShape(page, 'line', { x: 260, y: 240 }, { x: 440, y: 340 })
  await selectLayers(page, ['Line', 'Rectangle'])
  await press(page, 'M', true)

  await expect(page.locator('.layer-row', { hasText: 'Mask Group' })).toHaveCount(0)
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
})

// ---------------------------------------------------------- outline stroke --

test('Outline Stroke separates a border from its fill', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'ellipse', { x: 280, y: 220 }, { x: 460, y: 360 })
  await selectTool(page, 'select')
  await page.locator('.layer-row', { hasText: 'Ellipse' }).click()
  await section(page, 'STROKE').locator('.paint-toggle').check()

  await page.locator('.layer-row', { hasText: 'Ellipse' }).click()
  await press(page, 'O', true)

  // Adobe: "If any layer contains both a fill and a border, they'll
  // automatically be separated."
  await expect(page.locator('.layer-row', { hasText: 'Ellipse Outline' })).toHaveCount(1)
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(1)

  // The border is gone from the original, and lives on as a filled shape.
  const ellipse = nodesOfType(page, 'ellipse').locator('path').first()
  expect(await ellipse.getAttribute('stroke')).toBe('none')
  const outline = nodesOfType(page, 'path').locator('path').first()
  expect(await outline.getAttribute('fill')).not.toBe('none')
  const d = (await outline.getAttribute('d'))!
  // A ring: an outer loop and an inner one, so the middle stays empty.
  expect((d.match(/M/g) ?? []).length).toBe(2)

  await press(page, 'z')
  await expect(nodesOfType(page, 'path')).toHaveCount(0)
})

test('a shape with only a border becomes the outline outright', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 280, y: 220 }, { x: 460, y: 360 })
  await selectTool(page, 'select')
  await page.locator('.layer-row', { hasText: 'Rectangle' }).click()
  await section(page, 'STROKE').locator('.paint-toggle').check()
  await section(page, 'FILL').locator('.paint-toggle').uncheck()

  await page.locator('.layer-row', { hasText: 'Rectangle' }).click()
  await press(page, 'O', true)

  // Nothing to separate, so it is replaced rather than doubled.
  await expect(nodesOfType(page, 'rect')).toHaveCount(0)
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  await expect(page.locator('.layer-row', { hasText: 'Rectangle' })).toHaveCount(1)
})

test('Outline Stroke does nothing to a shape with no border', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 280, y: 220 }, { x: 460, y: 360 })
  await selectTool(page, 'select')
  await page.locator('.layer-row', { hasText: 'Rectangle' }).click()
  await press(page, 'O', true)
  await expect(nodesOfType(page, 'path')).toHaveCount(0)
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
})

// ------------------------------------------------------------------ export --

test('every effect survives SVG export', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 400, y: 340 })
  await section(page, 'SHADOW').locator('.paint-toggle').check()
  await drawShape(page, 'rect', { x: 300, y: 260 }, { x: 520, y: 380 })
  await section(page, 'BLUR').locator('.paint-toggle').check()
  await drawShape(page, 'ellipse', { x: 560, y: 200 }, { x: 700, y: 320 })
  await drawShape(page, 'rect', { x: 580, y: 220 }, { x: 680, y: 300 })
  await selectLayers(page, ['Ellipse', 'Rectangle'])
  await press(page, 'M', true)
  await page.keyboard.press('Escape')

  await openExportDialog(page)
  await page.locator('[role="dialog"] .dialog-row', { hasText: 'Format' }).locator('select').selectOption('svg')
  const file = await captureDownload(page, () =>
    page.locator('.dialog button', { hasText: 'Export' }).last().click(),
  )
  const svg = file.buffer.toString('utf8')

  expect(svg).toContain('feDropShadow')
  expect(svg).toContain('maskclip-')
  // The backdrop, drawn a second time through a <use> — the same construction
  // the canvas makes, so the file matches the screen.
  expect(svg).toMatch(/<use href="#bd-/)
  expect(svg).toContain('bdblur-')
})
