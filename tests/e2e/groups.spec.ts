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
 * Groups: selecting one, entering it, and transforming it.
 *
 * A group only behaves like one object if a click resolves to the OUTERMOST
 * group containing what was clicked. Getting that wrong is invisible until you
 * drag — the selection looks plausible and then only half the artwork moves —
 * so these assert on where the artwork ends up, not on what is highlighted.
 */

import { test, expect } from '@playwright/test'
import {
  CANVAS, clickCanvas, dragOnCanvas, drawShape, modifier, openApp, press, selectTool,
} from './helpers'

type Page = import('@playwright/test').Page

/** Every rect's on-screen box, in document order: [B, C, A]. */
async function rects(page: Page): Promise<number[][]> {
  return page.locator('.document-layer [data-node-type="rect"]').evaluateAll((els) =>
    els.map((e) => {
      const b = (e as SVGGraphicsElement).getBoundingClientRect()
      return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]
    }),
  )
}

async function selectedLayers(page: Page): Promise<(string | undefined)[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.layer-row')]
      .filter((r) => r.className.includes('selected') || r.getAttribute('aria-selected') === 'true')
      .map((r) => r.textContent?.trim()),
  )
}

async function dblCanvas(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator(CANVAS).boundingBox()
  await page.mouse.dblclick(box!.x + x, box!.y + y)
}

/**
 * outer group [ rect A , inner group [ rect B , rect C ] ]
 *
 * Two levels deep on purpose: one level cannot tell "outermost group" apart
 * from "the group directly holding the shape".
 */
async function buildNested(page: Page): Promise<void> {
  await drawShape(page, 'rect', { x: 500, y: 250 }, { x: 560, y: 310 })
  await drawShape(page, 'rect', { x: 580, y: 250 }, { x: 640, y: 310 })
  await selectTool(page, 'select')
  await clickCanvas(page, { x: 530, y: 280 })
  await clickCanvas(page, { x: 610, y: 280 }, { modifiers: ['Shift'] })
  await press(page, 'g')
  await drawShape(page, 'rect', { x: 380, y: 250 }, { x: 440, y: 310 })
  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)
  await press(page, 'g')
  await page.keyboard.press('Escape')
}

test.describe('selecting a group', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await buildNested(page)
  })

  test('a click selects the whole group, however deeply nested the shape is', async ({ page }) => {
    // Clicking rect B — two groups down — and dragging must move ALL THREE
    // rects. Resolving to the inner group instead moves two of them, which is
    // exactly what a stale ancestor chain used to do.
    await clickCanvas(page, { x: 530, y: 280 })
    const before = await rects(page)
    await dragOnCanvas(page, { x: 530, y: 280 }, { x: 630, y: 320 })
    const after = await rects(page)

    expect(after.map((a, i) => [a[0]! - before[i]![0]!, a[1]! - before[i]![1]!]))
      .toEqual([[100, 40], [100, 40], [100, 40]])
  })

  test('the group keeps its shape while moving', async ({ page }) => {
    await clickCanvas(page, { x: 530, y: 280 })
    const before = await rects(page)
    await dragOnCanvas(page, { x: 530, y: 280 }, { x: 630, y: 320 })
    const after = await rects(page)

    // Same sizes, same gaps between the pieces: a move is not a transform.
    expect(after.map((a) => [a[2], a[3]])).toEqual(before.map((b) => [b[2], b[3]]))
    expect(after[1]![0]! - after[0]![0]!).toBe(before[1]![0]! - before[0]![0]!)
  })

  test('scaling the group scales every child, keeping their relative layout', async ({ page }) => {
    await clickCanvas(page, { x: 530, y: 280 })
    const before = await rects(page)
    const frame = (await page.locator('.selection-frame').boundingBox())!

    await page.mouse.move(frame.x + frame.width, frame.y + frame.height)
    await page.mouse.down()
    await page.mouse.move(frame.x + frame.width + 100, frame.y + frame.height + 100, { steps: 12 })
    await page.mouse.up()

    const after = await rects(page)
    // Every child grew, and by the same factor on each axis.
    const sx = after.map((a, i) => a[2]! / before[i]![2]!)
    const sy = after.map((a, i) => a[3]! / before[i]![3]!)
    expect(Math.max(...sx) - Math.min(...sx)).toBeLessThan(0.05)
    expect(Math.max(...sy) - Math.min(...sy)).toBeLessThan(0.05)
    expect(sx[0]!).toBeGreaterThan(1)

    // The gap between two children scaled with them rather than staying fixed,
    // which is what "relative positions are kept" actually means.
    const gapBefore = before[1]![0]! - before[0]![0]!
    const gapAfter = after[1]![0]! - after[0]![0]!
    expect(gapAfter / gapBefore).toBeCloseTo(sx[0]!, 1)
  })
})

test.describe('entering a group', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await buildNested(page)
  })

  test('double-click enters one level at a time, down through the nesting', async ({ page }) => {
    // Click: the outer group as one object.
    await clickCanvas(page, { x: 530, y: 280 })
    expect(await selectedLayers(page)).toEqual(['Group'])

    // First double-click enters the outer group and selects its child — the
    // inner GROUP, not the rectangle two levels down.
    await dblCanvas(page, 530, 280)
    expect(await selectedLayers(page)).toEqual(['Group'])

    // Second enters the inner group and reaches the rectangle.
    await dblCanvas(page, 530, 280)
    expect(await selectedLayers(page)).toEqual(['Rectangle'])
  })

  test('a shape inside an entered group can be moved on its own', async ({ page }) => {
    await dblCanvas(page, 530, 280)
    await dblCanvas(page, 530, 280)
    const before = await rects(page)
    await dragOnCanvas(page, { x: 530, y: 280 }, { x: 560, y: 300 })
    const after = await rects(page)

    // Only rect B moved; its siblings stayed put.
    expect(after[0]![0]! - before[0]![0]!).toBe(30)
    expect([after[1], after[2]]).toEqual([before[1], before[2]])
  })

  test('Escape steps back out one level rather than all the way', async ({ page }) => {
    await dblCanvas(page, 530, 280)
    await dblCanvas(page, 530, 280)
    expect(await selectedLayers(page)).toEqual(['Rectangle'])

    // Back inside the outer group: a click now picks the inner group again.
    await page.keyboard.press('Escape')
    await clickCanvas(page, { x: 530, y: 280 })
    expect(await selectedLayers(page)).toEqual(['Group'])

    // Out entirely: a click is back to selecting the whole thing, so dragging
    // moves all three rects.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await clickCanvas(page, { x: 530, y: 280 })
    const before = await rects(page)
    await dragOnCanvas(page, { x: 530, y: 280 }, { x: 580, y: 280 })
    const after = await rects(page)
    expect(after.map((a, i) => a[0]! - before[i]![0]!)).toEqual([50, 50, 50])
  })

  test('clicking a different object leaves the group and selects it', async ({ page }) => {
    await dblCanvas(page, 530, 280)
    await dblCanvas(page, 530, 280)
    // Rect A is outside the entered group. One click should land on it, not be
    // swallowed as "you are not in that group any more, try again".
    await clickCanvas(page, { x: 410, y: 280 })
    const before = await rects(page)
    await dragOnCanvas(page, { x: 410, y: 280 }, { x: 450, y: 280 })
    const after = await rects(page)
    // Rect A is a child of the OUTER group, so picking it picks that whole
    // group and all three move — the click landed rather than being discarded.
    expect(after.map((a, i) => a[0]! - before[i]![0]!)).toEqual([40, 40, 40])
  })
})

test.describe('artboard-relative positioning', () => {
  test('moving an artboard carries its contents, offsets unchanged', async ({ page }) => {
    await openApp(page)
    await drawShape(page, 'rect', { x: 400, y: 300 }, { x: 460, y: 360 })
    await selectTool(page, 'select')

    const artboardBefore = await page.locator('.document-layer [data-node-type="artboard"]')
      .first().evaluate((e) => (e as SVGGraphicsElement).getBoundingClientRect().x)
    const before = await rects(page)

    const label = (await page.locator('.artboard-label').first().boundingBox())!
    await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2)
    await page.mouse.down()
    await page.mouse.move(label.x + label.width / 2 + 120, label.y + label.height / 2 + 60, { steps: 10 })
    await page.mouse.up()

    const artboardAfter = await page.locator('.document-layer [data-node-type="artboard"]')
      .first().evaluate((e) => (e as SVGGraphicsElement).getBoundingClientRect().x)
    const after = await rects(page)

    // The child moved exactly as far as the artboard did, so its offset from
    // the artboard's top-left corner is the same as before.
    expect(after[0]![0]! - before[0]![0]!).toBe(Math.round(artboardAfter - artboardBefore))
    expect(after[0]![1]! - before[0]![1]!).toBe(60)
    expect([after[0]![2], after[0]![3]]).toEqual([before[0]![2], before[0]![3]])
  })
})
