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
 * Corner radius (the two-mode control and the on-canvas handle) and the live
 * inspector readouts.
 *
 * The readout tests all assert the same invariant rather than exact numbers:
 * what the field shows mid-gesture must equal what it shows after release.
 * Every defect in this area presented as a visible jump at pointerup, and the
 * invariant catches all of them without hard-coding a coordinate system.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  CANVAS, drawShape, openApp, press, selectAll, dragOnCanvas, inspectorField, setField,
} from './helpers'

/** Centre of a radius dot, in page coordinates. */
async function radiusHandle(page: Page, corner: string) {
  const box = await page.locator(`[data-handle="radius"][data-corner="${corner}"]`).boundingBox()
  if (!box) throw new Error(`no radius handle for corner ${corner}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const cornerValues = (page: Page) =>
  page.locator('.corner-fields input').evaluateAll((els) =>
    els.map((e) => Number.parseFloat((e as HTMLInputElement).value)),
  )

// ------------------------------------------------------------ corner modes --

test('the corner control switches between one field and four', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 500, y: 380 })

  // A fresh rect has four equal corners, so it opens in uniform mode.
  await expect(page.locator('[data-testid="corners-uniform"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.corner-radius-row input')).toHaveCount(1)

  await page.locator('[data-testid="corners-independent"]').click()
  await expect(page.locator('[data-testid="corners-independent"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.corner-radius-row input')).toHaveCount(4)

  await page.locator('[data-testid="corners-uniform"]').click()
  await expect(page.locator('.corner-radius-row input')).toHaveCount(1)
})

test('only a box gets the mode toggle; a polygon keeps its single field', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'polygon', { x: 260, y: 200 }, { x: 420, y: 360 })
  await expect(page.locator('[data-testid="corners-uniform"]')).toHaveCount(0)
  await expect(page.locator('.corner-radius-row input')).toHaveCount(1)
})

test('the radius handle follows the selected mode', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 500, y: 380 })

  // Independent: dragging the top-left dot moves that corner alone.
  await page.locator('[data-testid="corners-independent"]').click()
  const nw = await radiusHandle(page, 'nw')
  await page.mouse.move(nw.x, nw.y)
  await page.mouse.down()
  await page.mouse.move(nw.x + 45, nw.y + 45, { steps: 10 })
  await page.mouse.up()

  const perCorner = await cornerValues(page)
  expect(perCorner).toHaveLength(4)
  expect(perCorner[0]).toBeGreaterThan(20)
  expect(perCorner.slice(1)).toEqual([0, 0, 0])

  // The drawn geometry agrees: one rounded corner means exactly one arc.
  const d = await page.locator('.document-layer [data-node-type="rect"] path').first().getAttribute('d')
  expect((d?.match(/A/g) ?? []).length).toBe(1)

  // Uniform: dragging any dot now moves all four together.
  await page.locator('[data-testid="corners-uniform"]').click()
  const se = await radiusHandle(page, 'se')
  await page.mouse.move(se.x, se.y)
  await page.mouse.down()
  await page.mouse.move(se.x - 35, se.y - 35, { steps: 10 })
  await page.mouse.up()

  const uniform = Number.parseFloat(await page.locator('.tf-corner-all input').inputValue())
  expect(uniform).toBeGreaterThan(20)

  await page.locator('[data-testid="corners-independent"]').click()
  const all = await cornerValues(page)
  expect(all.every((v) => Math.abs(v - uniform) < 0.01)).toBe(true)

  const dAll = await page.locator('.document-layer [data-node-type="rect"] path').first().getAttribute('d')
  expect((dAll?.match(/A/g) ?? []).length).toBe(4)
})

test('a click on a radius dot does not change the radius', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 500, y: 380 })

  const before = await page.locator('.tf-corner-all input').inputValue()
  const nw = await radiusHandle(page, 'nw')
  await page.mouse.move(nw.x, nw.y)
  await page.mouse.down()
  await page.mouse.up()

  expect(await page.locator('.tf-corner-all input').inputValue()).toBe(before)
  // A click that changed nothing must not push a history entry, so the single
  // undo below has to land on the rect's creation. If the click had committed a
  // radius, this undo would spend itself on that and the rect would survive.
  await press(page, 'z')
  await expect(page.locator('.document-layer [data-node-type="rect"]')).toHaveCount(0)
})

test('switching tools mid-radius-drag tears the gesture down', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 500, y: 380 })

  const shape = page.locator('.document-layer [data-node-type="rect"] path').first()
  const before = await shape.getAttribute('d')

  const nw = await radiusHandle(page, 'nw')
  await page.mouse.move(nw.x, nw.y)
  await page.mouse.down()
  await page.mouse.move(nw.x + 20, nw.y + 20, { steps: 4 })

  // Hold space to pan — a reflex, not a decision, and the most likely way to
  // change tools mid-gesture. The pointerup that would have ended the radius
  // drag is delivered to the hand tool instead, so the selection tool has to be
  // torn down or it stays wedged in its radius phase, deforming the shape under
  // a button-less cursor. Two mechanisms hold this: the tool swap runs the
  // outgoing tool's onDeactivate, and the radius branch bails out on its own
  // when it sees no button down.
  await page.keyboard.down(' ')
  await page.mouse.up()
  await page.keyboard.up(' ')

  // Button-less moves must now do nothing at all to the shape.
  await page.mouse.move(nw.x + 120, nw.y + 120, { steps: 6 })
  await page.mouse.move(nw.x + 10, nw.y + 10, { steps: 6 })
  expect(await shape.getAttribute('d')).toBe(before)

  // And the tool still works afterwards.
  await page.locator(CANVAS).click({ position: { x: 8, y: 8 } })
  await page.locator(CANVAS).click({ position: { x: 380, y: 290 } })
  await expect(page.locator('.selection-frame')).toHaveCount(1)
})

// --------------------------------------------------------- live readouts --

test('X does not jump when a group starts moving', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 280, y: 280 })
  await drawShape(page, 'rect', { x: 340, y: 200 }, { x: 420, y: 280 })
  await selectAll(page)
  await press(page, 'g')
  const group = page.locator('.document-layer [data-node-type="group"]')
  await expect(group).toHaveCount(1)

  // Move a child INSIDE the group so the group's nominal box goes stale: it is
  // written once when the group is formed and never refitted afterwards. While
  // the box and the children still agree, the defect is invisible.
  // Rows: Artboard 1 / Group / Rectangle / Rectangle, already expanded.
  const rows = page.locator('.layer-row')
  await rows.nth(2).click()
  await setField(page, 'X', 60)
  await rows.nth(1).click()
  await expect(page.locator('.selection-frame')).toHaveCount(1)

  const before = Number.parseFloat(await inspectorField(page, 'X').inputValue())
  expect(Number.isFinite(before)).toBe(true)

  // Rotate rather than move: a pointerdown on a child of an already-selected
  // group descends into the child, which would change what is being measured.
  // Rotation also exercises the world-space union — AABB(M . union) is not
  // union(AABB(M . box)) once anything is turned.
  const zone = await page.locator('[data-handle="rotate"]').first().boundingBox()
  if (!zone) throw new Error('no rotate zone')
  const grab = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }

  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 90, grab.y + 90, { steps: 10 })
  const during = Number.parseFloat(await inspectorField(page, 'X').inputValue())
  await page.mouse.up()
  const after = Number.parseFloat(await inspectorField(page, 'X').inputValue())

  expect(during).not.toBeCloseTo(before, 1)
  expect(during).toBeCloseTo(after, 1)
})

test('W does not jump when a scaled node is resized', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 300 })
  await drawShape(page, 'rect', { x: 340, y: 200 }, { x: 440, y: 300 })

  // A multi-selection resize puts the change in each node's SCALE rather than
  // its width, which is the only way to get scale != 1 through the UI — and the
  // case where reading the intrinsic size mid-drag understates W.
  await selectAll(page)
  await dragOnCanvas(page, { x: 440, y: 300 }, { x: 680, y: 500 })

  await page.locator(CANVAS).click({ position: { x: 20, y: 20 } })
  await page.locator('.document-layer [data-node-type="rect"]').first().click({ force: true })
  await expect(page.locator('.selection-frame')).toHaveCount(1)

  const handle = await page.locator('[data-handle="se"]').boundingBox()
  if (!handle) throw new Error('no se handle')
  const grab = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }

  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 60, grab.y + 40, { steps: 8 })
  const during = Number.parseFloat(await inspectorField(page, 'W').inputValue())
  await page.mouse.up()
  const after = Number.parseFloat(await inspectorField(page, 'W').inputValue())

  expect(during).toBeCloseTo(after, 1)
})

test('the radius field has a draggable R label, like every other field', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 500, y: 380 })

  const field = page.locator('.field[title="Corner radius"]')
  const label = field.locator('.field-label')
  await expect(label).toHaveText('R')
  expect(Number(await field.locator('input').inputValue())).toBe(0)

  // Scrubbing the label is how the rest of the inspector edits numbers; the
  // radius used to be the one value you could only type. Scrolled into view
  // first: raw mouse coordinates do not scroll the inspector the way a click would.
  await label.scrollIntoViewIfNeeded()
  const box = (await label.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 10 })
  const during = Number(await field.locator('input').inputValue())
  await page.mouse.up()

  expect(during).toBeGreaterThan(0)
  // The shape followed, and the value stuck on release.
  expect(Number(await field.locator('input').inputValue())).toBe(during)
  const d = (await page.locator('.document-layer [data-node-type="rect"] path').first().getAttribute('d'))!
  expect((d.match(/A/g) ?? []).length).toBe(4)
})

test('each independent corner gets its own scrub handle', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 260, y: 200 }, { x: 500, y: 380 })
  await page.locator('[data-testid="corners-independent"]').click()

  const corners = page.locator('.corner-fields .field')
  await expect(corners).toHaveCount(4)
  await expect(corners.locator('.field-label')).toHaveCount(4)

  const label = corners.first().locator('.field-label')
  await label.scrollIntoViewIfNeeded()
  const box = (await label.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()

  const values = await corners.locator('input').evaluateAll((els) =>
    els.map((e) => Number((e as HTMLInputElement).value)),
  )
  expect(values[0]).toBeGreaterThan(0)
  // Only the corner whose label was dragged.
  expect(values.slice(1)).toEqual([0, 0, 0])
})
