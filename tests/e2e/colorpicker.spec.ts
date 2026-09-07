/**
 * The colour picker's chrome: the paint-type dropdown, the colour-model
 * dropdown, the document palette and the eyedropper.
 *
 * The hex field keeps its `#` label deliberately — four other specs address it
 * that way, and Hex stays the default mode so they go on working.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  CANVAS, captureDownload, dismissRecovery, drawShape, openApp, press,
} from './helpers'

const popover = (page: Page) => page.locator('.popover')
const hexInput = (page: Page) =>
  page.locator('.popover .field', { has: page.locator('.field-label:text-is("#")') }).locator('input')

async function openFillPicker(page: Page) {
  await page.locator('.section', { hasText: 'FILL' }).locator('.swatch').first().click()
  await expect(popover(page)).toBeVisible()
}

async function setHex(page: Page, hex: string) {
  const field = hexInput(page)
  await field.fill(hex.replace('#', ''))
  await field.press('Enter')
}

// ------------------------------------------------------------ paint types --

test('the paint type is a dropdown, and switching keeps the colour', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 420, y: 360 })
  await openFillPicker(page)
  await setHex(page, 'e8a33d')

  const type = page.locator('.popover select[title="Paint type"]')
  await expect(type).toHaveValue('solid')

  await type.selectOption('linear')
  await expect(page.locator('.gradient-bar')).toBeVisible()
  // The gradient starts from the colour that was there, not from a default grey.
  const firstStop = await page.locator('.document-layer linearGradient stop').first().getAttribute('stop-color')
  expect(firstStop?.toLowerCase()).toBe('#e8a33d')

  await type.selectOption('none')
  await expect(page.locator('.gradient-bar')).toHaveCount(0)
  await type.selectOption('solid')
  await expect(hexInput(page)).toHaveValue('e8a33d')
})

// ---------------------------------------------------------- colour models --

test('the colour model dropdown switches without changing the colour', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 420, y: 360 })
  await openFillPicker(page)
  await setHex(page, '2b8ac6')

  const model = page.locator('.popover select[title="Color model"]')
  await expect(model).toHaveValue('hex')

  await model.selectOption('rgb')
  const rgb = page.locator('.popover .value-row .field:not(.alpha-field) input')
  await expect(rgb).toHaveCount(3)
  expect(await rgb.nth(0).inputValue()).toBe('43')
  expect(await rgb.nth(1).inputValue()).toBe('138')
  expect(await rgb.nth(2).inputValue()).toBe('198')

  await model.selectOption('hsl')
  const hsl = page.locator('.popover .value-row .field:not(.alpha-field) input')
  // Hue near 203 — and not clipped by a field too narrow to show it.
  expect(Number(await hsl.nth(0).inputValue())).toBeGreaterThan(195)
  expect(Number(await hsl.nth(0).inputValue())).toBeLessThan(210)

  await model.selectOption('hsv')
  await expect(page.locator('.popover .value-row .field:not(.alpha-field) input')).toHaveCount(3)

  await model.selectOption('hex')
  await expect(hexInput(page)).toHaveValue('2b8ac6')
})

test('opacity is editable as a number, not only as a slider', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 420, y: 360 })
  await openFillPicker(page)

  const alpha = page.locator('.popover .alpha-field input')
  await expect(alpha).toHaveValue('100')
  await alpha.fill('40')
  await alpha.press('Enter')

  const fill = await page.locator('.document-layer [data-node-type="rect"] path').first().getAttribute('fill-opacity')
  expect(Number(fill)).toBeCloseTo(0.4, 2)
})

// --------------------------------------------------------------- swatches --

test('the palette starts empty and (+) fills it', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 420, y: 360 })
  await openFillPicker(page)

  // No presets: the palette is the user's, and starts blank.
  await expect(page.locator('.popover .preset-swatch')).toHaveCount(0)

  await setHex(page, 'e8a33d')
  await page.locator('.popover .add-swatch').click()
  await expect(page.locator('.popover .preset-swatch')).toHaveCount(1)

  await setHex(page, '2b8ac6')
  await page.locator('.popover .add-swatch').click()
  await expect(page.locator('.popover .preset-swatch')).toHaveCount(2)

  // Adding the same colour twice is a no-op, not a duplicate.
  await page.locator('.popover .add-swatch').click()
  await expect(page.locator('.popover .preset-swatch')).toHaveCount(2)

  // Saving a colour is a document edit, so it undoes like any other. Checked
  // before the click below, which would otherwise put a fill change on top of
  // the undo stack.
  await page.keyboard.press('Escape')
  await press(page, 'z')
  await openFillPicker(page)
  await expect(page.locator('.popover .preset-swatch')).toHaveCount(1)

  // Clicking one applies it.
  await page.locator('.popover .preset-swatch').first().click()
  await expect(hexInput(page)).toHaveValue('e8a33d')
})

test('swatches travel with the document', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 420, y: 360 })
  await openFillPicker(page)
  await setHex(page, 'e8a33d')
  await page.locator('.popover .add-swatch').click()
  await page.keyboard.press('Escape')

  const saved = await captureDownload(page, () => press(page, 's'))
  await page.reload()
  await page.waitForSelector(CANVAS)
  await page.waitForTimeout(300)
  await dismissRecovery(page)

  const chooserPromise = page.waitForEvent('filechooser')
  await press(page, 'o')
  ;(await chooserPromise).setFiles({
    name: saved.name,
    mimeType: 'application/x-xdesign+zip',
    buffer: saved.buffer,
  })
  await page.waitForTimeout(600)

  await page.locator('.document-layer [data-node-type="rect"]').first().click({ force: true })
  await openFillPicker(page)
  await expect(page.locator('.popover .preset-swatch')).toHaveCount(1)
  await page.locator('.popover .preset-swatch').first().click()
  await expect(hexInput(page)).toHaveValue('e8a33d')
})

// ------------------------------------------------------------ eyedropper --

test('the eyedropper picks a colour off the canvas', async ({ page }) => {
  await openApp(page)
  // A shape with a known colour to sample from...
  await drawShape(page, 'rect', { x: 500, y: 200 }, { x: 700, y: 360 })
  await openFillPicker(page)
  await setHex(page, '1e9e4f')
  await page.keyboard.press('Escape')

  // ...and a second shape to paint.
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 380, y: 360 })
  await openFillPicker(page)
  await setHex(page, 'ffffff')

  await page.locator('.popover button[aria-label="Eyedropper"]').click()
  await expect(page.locator('.popover button[aria-label="Eyedropper"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })

  const box = (await page.locator(CANVAS).boundingBox())!
  await page.mouse.move(box.x + 600, box.y + 280)
  await page.mouse.down()
  await page.mouse.up()

  // Sampled from real rendered pixels, so it works over images and gradients too.
  await expect(hexInput(page)).toHaveValue('1e9e4f')
})

test('angular joins the same dropdown and keeps the stops', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 420, y: 360 })
  await openFillPicker(page)
  await setHex(page, 'e8a33d')

  const type = page.locator('.popover select[title="Paint type"]')
  await type.selectOption('angular')
  // SVG has no conic paint server, so it is drawn as a pattern of wedges.
  await expect(page.locator('.document-layer pattern')).toHaveCount(1)
  await expect(page.locator('.gradient-bar')).toBeVisible()

  await type.selectOption('linear')
  const first = await page.locator('.document-layer linearGradient stop').first().getAttribute('stop-color')
  expect(first?.toLowerCase()).toBe('#e8a33d')
})
