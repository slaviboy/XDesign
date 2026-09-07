/**
 * The on-canvas gradient editor, and angular gradients.
 *
 * NOTE for future edits: an angular fill puts a <pattern> of ~180 paths in the
 * document layer. Several other specs count `.document-layer linearGradient`
 * elements, so angular gradients stay in this file — Playwright isolates pages
 * per test, which is what keeps that safe.
 */

import { test, expect, type Page } from '@playwright/test'
import { drawShape, nodesOfType, openApp, press } from './helpers'

const popover = (page: Page) => page.locator('.popover')
const handle = (page: Page, corner: string) =>
  page.locator(`[data-handle="gradient"][data-corner="${corner}"]`)

async function openGradient(page: Page, type: 'linear' | 'radial' | 'angular') {
  await page.locator('.section', { hasText: 'FILL' }).locator('.swatch').first().click()
  await expect(popover(page)).toBeVisible()
  await page.locator('.popover select[title="Paint type"]').selectOption(type)
}

async function centreOf(page: Page, corner: string) {
  const box = (await handle(page, corner).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const x2 = (page: Page) =>
  page.locator('.document-layer linearGradient').first().getAttribute('x2')

// ------------------------------------------------------------- visibility --

test('the handles belong to the picker, not to selection', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'linear')

  await expect(handle(page, 'start')).toBeVisible()
  await expect(handle(page, 'end')).toBeVisible()
  // The corner-radius dots stand down so the two do not compete for the corners.
  await expect(page.locator('[data-handle="radius"]')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(page.locator('[data-handle="gradient"]')).toHaveCount(0)
  // ...and the radius dots come back.
  await expect(page.locator('[data-handle="radius"]')).toHaveCount(4)
})

// ------------------------------------------------------------- dragging --

test('dragging an endpoint moves the gradient, in one undo step', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'linear')

  const before = await x2(page)
  const end = await centreOf(page, 'end')
  await page.mouse.move(end.x, end.y)
  await page.mouse.down()
  await page.mouse.move(end.x - 90, end.y + 60, { steps: 10 })
  const during = await x2(page)
  expect(during).not.toBe(before)
  await page.mouse.up()

  // What was previewed is what was committed.
  expect(await x2(page)).toBe(during)
  // And the whole drag is ONE entry: re-writing the identical paint on release
  // would have cost a second Cmd+Z.
  await press(page, 'z')
  expect(await x2(page)).toBe(before)
})

test('an endpoint can be dragged outside the shape', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'linear')

  const end = await centreOf(page, 'end')
  await page.mouse.move(end.x, end.y)
  await page.mouse.down()
  await page.mouse.move(end.x + 160, end.y, { steps: 10 })
  await page.mouse.up()

  // Adobe allows this explicitly, and objectBoundingBox units are not clamped.
  expect(Number(await x2(page))).toBeGreaterThan(1)
})

test('dragging the segment moves the whole gradient', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'linear')

  const readX = async (n: 'x1' | 'x2') =>
    Number(await page.locator('.document-layer linearGradient').first().getAttribute(n))
  const [bx1, bx2] = [await readX('x1'), await readX('x2')]

  const a = await centreOf(page, 'start')
  const b = await centreOf(page, 'end')
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  await page.mouse.move(mid.x, mid.y)
  await page.mouse.down()
  await page.mouse.move(mid.x + 50, mid.y, { steps: 10 })
  await page.mouse.up()

  // Both ends move by the same amount, so the gradient translates rather than
  // stretching.
  expect(await readX('x1') - bx1).toBeCloseTo(await readX('x2') - bx2, 4)
  expect(await readX('x1')).toBeGreaterThan(bx1)
})

// ---------------------------------------------------------------- radial --

test('the radius handle sits where the gradient actually paints', async ({ page }) => {
  await openApp(page)
  // Deliberately not square: objectBoundingBox units make a radial gradient an
  // ellipse, so a handle placed on a circle would miss the painted edge.
  await drawShape(page, 'rect', { x: 180, y: 220 }, { x: 480, y: 320 })
  await openGradient(page, 'radial')

  const centre = await centreOf(page, 'center')
  const radius = await centreOf(page, 'radius')
  const box = (await nodesOfType(page, 'rect').first().boundingBox())!

  // Default r is 0.5, so the handle is half the WIDTH away — not half the mean
  // of width and height.
  expect(radius.x - centre.x).toBeCloseTo(box.width / 2, 0)
  expect(radius.y - centre.y).toBeCloseTo(0, 0)
})

// --------------------------------------------------------------- angular --

test('an angular gradient renders as a wedge pattern and exports as one', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'angular')

  await expect(page.locator('.document-layer pattern')).toHaveCount(1)
  expect(await page.locator('.document-layer pattern path').count()).toBeGreaterThan(100)
  // Scoped to a path that actually references the pattern: the wedges inside
  // <defs> are <path> elements too, so `.first()` would pick one of those.
  await expect(nodesOfType(page, 'rect').locator('path[fill^="url(#"]')).toHaveCount(1)

  // The centre and angle handles are the ones the user asked for.
  await expect(handle(page, 'center')).toBeVisible()
  await expect(handle(page, 'angle')).toBeVisible()
})

test('the angular angle handle turns the sweep', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'angular')

  const angleField = page
    .locator('.popover .field', { has: page.locator('.field-label:text-is("Angle")') })
    .locator('input')
  const before = Number(await angleField.inputValue())

  const centre = await centreOf(page, 'center')
  const at = await centreOf(page, 'angle')
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  // Swing a quarter turn around the centre.
  await page.mouse.move(centre.x, centre.y + (at.x - centre.x), { steps: 12 })
  await page.mouse.up()

  expect(Number(await angleField.inputValue())).not.toBe(before)
})

// ----------------------------------------------------------------- stops --

test('stops ride the on-canvas editor and can be added, moved and deleted', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'linear')

  const stops = page.locator('[data-handle="gradient"][data-corner="stop"]')
  await expect(stops).toHaveCount(2)

  // Adobe: "Click anywhere on the gradient editor to add new color stops."
  const a = await centreOf(page, 'start')
  const b = await centreOf(page, 'end')
  await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2)
  await expect(stops).toHaveCount(3)

  const rendered = page.locator('.document-layer linearGradient stop')
  await expect(rendered).toHaveCount(3)
  // It landed where it was clicked, and took the colour the ramp shows there —
  // the default ramp fades to transparent, so halfway is half-opaque.
  const middle = rendered.nth(1)
  expect(Number(await middle.getAttribute('offset'))).toBeCloseTo(0.5, 1)
  expect(Number(await middle.getAttribute('stop-opacity'))).toBeCloseTo(0.5, 1)

  // Dragging it along the axis changes its position.
  const mid = (await stops.nth(1).boundingBox())!
  await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + (b.x - a.x) * 0.75, a.y + (b.y - a.y) * 0.75, { steps: 8 })
  await page.mouse.up()
  expect(Number(await middle.getAttribute('offset'))).toBeGreaterThan(0.6)
})

test('Delete removes the selected canvas stop, not the shape', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'linear')

  await page.locator('.popover button[title="Add stop"]').click()
  await expect(page.locator('.document-layer linearGradient stop')).toHaveCount(3)

  const stops = page.locator('[data-handle="gradient"][data-corner="stop"]')
  const box = (await stops.nth(1).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.press('Delete')

  await expect(page.locator('.document-layer linearGradient stop')).toHaveCount(2)
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
})

test('arrow keys nudge the stop, not the shape', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'linear')
  await page.locator('.popover button[title="Add stop"]').click()

  const stops = page.locator('[data-handle="gradient"][data-corner="stop"]')
  const box = (await stops.nth(1).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  const posField = page
    .locator('.popover .field', { has: page.locator('.field-label:text-is("Pos")') })
    .locator('input')
  const shapeX = await nodesOfType(page, 'rect').first().boundingBox()
  const before = Number(await posField.inputValue())

  await page.keyboard.press('ArrowRight')
  expect(Number(await posField.inputValue())).toBe(before + 1)
  await page.keyboard.press('Shift+ArrowRight')
  expect(Number(await posField.inputValue())).toBe(before + 11)

  // The shape has not moved — without claiming the arrows this would have
  // nudged the rectangle instead.
  const after = await nodesOfType(page, 'rect').first().boundingBox()
  expect(after!.x).toBeCloseTo(shapeX!.x, 1)
})

test('clicking a canvas stop moves the panel to it', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'linear')

  // The end handle paints over the stop at that end, so pressing it selects the
  // covered stop rather than leaving it unreachable.
  const end = await centreOf(page, 'end')
  await page.mouse.click(end.x, end.y)

  // The panel's Pos field follows the canvas selection.
  const posField = page
    .locator('.popover .field', { has: page.locator('.field-label:text-is("Pos")') })
    .locator('input')
  expect(Number(await posField.inputValue())).toBe(100)
})

test('a canvas stop dragged off the axis is deleted', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'linear')
  await page.locator('.popover button[title="Add stop"]').click()
  await expect(page.locator('.document-layer linearGradient stop')).toHaveCount(3)

  const stops = page.locator('[data-handle="gradient"][data-corner="stop"]')
  const mid = (await stops.nth(1).boundingBox())!
  await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2)
  await page.mouse.down()
  // Adobe: delete "by dragging it away from the gradient editor".
  await page.mouse.move(mid.x + mid.width / 2, mid.y + 90, { steps: 10 })
  await page.mouse.up()

  await expect(page.locator('.document-layer linearGradient stop')).toHaveCount(2)
  // The shape is untouched.
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
})

test('a gradient never drops below two stops', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 220, y: 200 }, { x: 440, y: 340 })
  await openGradient(page, 'linear')

  const stops = page.locator('[data-handle="gradient"][data-corner="stop"]')
  const first = (await stops.first().boundingBox())!
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(first.x, first.y + 120, { steps: 10 })
  await page.mouse.up()

  await expect(page.locator('.document-layer linearGradient stop')).toHaveCount(2)
})
