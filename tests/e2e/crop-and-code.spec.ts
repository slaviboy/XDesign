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
 * Cropping an image on the canvas, and editing a shape through its SVG code —
 * the two features whose whole point is what they do to the real canvas.
 */

import { test, expect, type Page } from '@playwright/test'
import { drawShape, modifier, nodesOfType, openApp } from './helpers'

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

/** A 400 × 300 picture in four colours, pasted the way a screenshot would be. */
async function pasteQuadrants(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 300
    const g = c.getContext('2d')!
    g.fillStyle = '#e53935'
    g.fillRect(0, 0, 200, 150)
    g.fillStyle = '#1e88e5'
    g.fillRect(200, 0, 200, 150)
    g.fillStyle = '#43a047'
    g.fillRect(0, 150, 200, 150)
    g.fillStyle = '#fdd835'
    g.fillRect(200, 150, 200, 150)
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'quad.png', { type: 'image/png' }))
    window.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  })
  await expect(nodesOfType(page, 'image')).toHaveCount(1)
}

async function size(page: Page): Promise<[string, string]> {
  return [await page.locator('.tf-w input').inputValue(), await page.locator('.tf-h input').inputValue()]
}

async function dragHandle(page: Page, corner: string, dx: number, dy: number): Promise<void> {
  const box = (await page.locator(`.crop-handle[data-corner="${corner}"]`).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await page.mouse.up()
}

test.describe('cropping an image', () => {
  test('keeps the chosen part, in place, and the image is then that size', async ({ page }) => {
    await pasteQuadrants(page)
    expect(await size(page)).toEqual(['400', '300'])
    const before = (await nodesOfType(page, 'image').boundingBox())!

    await page.locator('[data-testid="crop-image"]').click()
    await expect(page.locator('[data-testid="crop-frame"]')).toBeVisible()
    // The zoom is 60%: 60 screen pixels is 100 of the image's units.
    await dragHandle(page, 'se', -60, -60)
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="crop-frame"]')).toHaveCount(0)

    expect(await size(page)).toEqual(['300', '200'])
    const after = (await nodesOfType(page, 'image').boundingBox())!
    expect(Math.abs(after.x - before.x)).toBeLessThan(1)
    expect(Math.abs(after.y - before.y)).toBeLessThan(1)

    // Reset takes it back to the whole picture, and Undo takes the reset back.
    await page.locator('[data-testid="reset-crop"]').click()
    expect(await size(page)).toEqual(['400', '300'])
    await page.locator('[data-testid="canvas-root"]').hover()
    await page.keyboard.press(`${modifier()}+z`)
    await expect.poll(() => size(page)).toEqual(['300', '200'])
  })

  test('Escape leaves the image as it was', async ({ page }) => {
    await pasteQuadrants(page)
    await page.locator('[data-testid="crop-image"]').click()
    await dragHandle(page, 'nw', 60, 30)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="crop-frame"]')).toHaveCount(0)
    expect(await size(page)).toEqual(['400', '300'])
  })

  test('a crop can be widened again, because the whole picture is kept', async ({ page }) => {
    await pasteQuadrants(page)
    await page.locator('[data-testid="crop-image"]').click()
    await dragHandle(page, 'e', -120, 0)
    await page.locator('[data-testid="crop-done"]').click()
    expect(await size(page)).toEqual(['200', '300'])

    await page.locator('[data-testid="crop-image"]').click()
    await page.locator('[data-testid="crop-full"]').click()
    await page.locator('[data-testid="crop-done"]').click()
    expect(await size(page)).toEqual(['400', '300'])
    await expect(page.locator('[data-testid="reset-crop"]')).toBeDisabled()
  })
})

test.describe('a shape’s SVG code', () => {
  test('shows the shape’s code, coloured, and follows the shape', async ({ page }) => {
    await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
    const code = page.locator('[data-testid="svg-code"]')
    await expect(code).toHaveValue(/<rect [^>]*fill="#d9d9d9"/)
    await expect(page.locator('[data-section="svgCode"] .code-tag').first()).toHaveText('svg')

    // A change made elsewhere shows up in the code.
    await page.locator('.tf-w input').fill('150')
    await page.locator('.tf-w input').press('Enter')
    await expect(code).toHaveValue(/width="150"/)
  })

  test('edits the shape on the canvas, as one undoable step', async ({ page }) => {
    await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
    const code = page.locator('[data-testid="svg-code"]')
    const shape = page.locator('.document-layer [data-node-type="rect"] [fill]').first()
    const original = await code.inputValue()

    await code.click()
    await code.fill(original.replace('fill="#d9d9d9"', 'fill="#e53935"'))
    await expect(shape).toHaveAttribute('fill', '#e53935')

    await code.press('Escape')
    await page.locator('[data-testid="canvas-root"]').hover()
    await page.keyboard.press(`${modifier()}+z`)
    await expect(shape).toHaveAttribute('fill', '#d9d9d9')
  })

  test('says what is wrong with code it cannot use, and leaves the shape alone', async ({ page }) => {
    await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
    const code = page.locator('[data-testid="svg-code"]')
    await code.click()
    await code.fill('<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/><circle r="4"/></svg>')
    await expect(page.locator('.code-error')).toContainText('one shape')
    await expect(nodesOfType(page, 'rect')).toHaveCount(1)
  })

  test('copies the code', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await drawShape(page, 'ellipse', { x: 200, y: 200 }, { x: 300, y: 300 })
    await page.locator('[data-testid="copy-svg-code"]').click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('<ellipse')
    expect(copied).toBe(await page.locator('[data-testid="svg-code"]').inputValue())
  })
})
