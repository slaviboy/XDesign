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
 * The Export dialog: what it remembers, what it names the file, what it paints
 * behind the artwork, what it shows before writing anything, and HEIF.
 *
 * Pixels are read from the files that were actually downloaded, because the
 * dialog saying "red background" and the file having one are different claims.
 */

import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  captureDownload, decodePng, drawShape, openApp, openExportDialog, setField,
} from './helpers'

const dialog = (page: Page) => page.locator('[role="dialog"][aria-label="Export"]')
const row = (page: Page, label: string) => dialog(page).locator('.dialog-row', { hasText: label })
const formatSelect = (page: Page) => row(page, 'Format').locator('select')
const scaleSelect = (page: Page) => row(page, 'Scale').locator('select').first()
const quality = (page: Page) => dialog(page).locator('input[type="range"]')
const exportButton = (page: Page) => page.locator('button:text-is("Export")')

/** A 200×100 rectangle, selected, so the export has a known size. */
async function oneRect(page: Page) {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 260 })
  await setField(page, 'W', 200)
  await setField(page, 'H', 100)
}

/** Choose a colour through the swatch's popover, the way a person would. */
async function pickBackground(page: Page, hex: string) {
  await page.locator('[data-testid="export-background-color"]').click()
  const field = page.locator('.popover .field', { has: page.locator('.field-label:text-is("#")') }).locator('input')
  await field.fill(hex)
  await field.press('Enter')
  // Closed by a press elsewhere in the dialog, not by Escape — Escape would
  // close the dialog behind it as well.
  await dialog(page).locator('.dialog-header').click()
  await expect(page.locator('.popover')).toHaveCount(0)
}

/** Decode any image the browser can, and read one pixel of it. */
async function pixelOf(page: Page, buffer: Buffer, type: string, x: number, y: number) {
  return page.evaluate(
    async ({ base64, type, x, y }) => {
      const image = new Image()
      image.src = `data:${type};base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      return Array.from(ctx.getImageData(x, y, 1, 1).data)
    },
    { base64: buffer.toString('base64'), type, x, y },
  )
}

test('opens with the settings the last export used', async ({ page }) => {
  await oneRect(page)

  await captureDownload(page, async () => {
    await openExportDialog(page)
    await formatSelect(page).selectOption('jpeg')
    await scaleSelect(page).selectOption('2')
    await quality(page).fill('45')
    await exportButton(page).click()
  })

  await openExportDialog(page)
  await expect(formatSelect(page)).toHaveValue('jpeg')
  await expect(scaleSelect(page)).toHaveValue('2')
  await expect(quality(page)).toHaveValue('45')

  // A cancelled dialog is not an export, so it changes nothing remembered.
  await formatSelect(page).selectOption('svg')
  await page.locator('button:text-is("Cancel")').click()
  await openExportDialog(page)
  await expect(formatSelect(page)).toHaveValue('jpeg')

  // And it survives a reload, which is the point of remembering it.
  await page.reload()
  await page.locator('[data-testid="canvas-root"]').waitFor()
  await openExportDialog(page)
  await expect(formatSelect(page)).toHaveValue('jpeg')
})

test('starts from the defaults when remembering is switched off', async ({ page }) => {
  await oneRect(page)
  await captureDownload(page, async () => {
    await openExportDialog(page)
    await formatSelect(page).selectOption('svg')
    await exportButton(page).click()
  })

  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-preferences"]').click()
  const remember = page.locator('[data-testid="remember-export"]')
  // On unless someone turns it off.
  await expect(remember).toBeChecked()
  await remember.uncheck()
  await page.keyboard.press('Escape')

  await openExportDialog(page)
  await expect(formatSelect(page)).toHaveValue('png')
})

test('exports under the name typed, with the scale and extension added', async ({ page }) => {
  await oneRect(page)

  const plain = await captureDownload(page, async () => {
    await openExportDialog(page)
    const name = page.locator('[data-testid="export-file-name"]')
    await name.fill('Hero banner')
    await expect(row(page, 'File name')).toContainText('.png')
    await exportButton(page).click()
  })
  expect(plain.name).toBe('Hero banner.png')

  const scaled = await captureDownload(page, async () => {
    await openExportDialog(page)
    await scaleSelect(page).selectOption('2')
    // The field is not remembered: a name belongs to one export.
    await expect(page.locator('[data-testid="export-file-name"]')).not.toHaveValue('Hero banner')
    await page.locator('[data-testid="export-file-name"]').fill('Hero banner')
    await expect(row(page, 'File name')).toContainText('@2x.png')
    await exportButton(page).click()
  })
  expect(scaled.name).toBe('Hero banner@2x.png')
})

test('paints the chosen background colour behind the artwork', async ({ page }) => {
  await openApp(page)
  // A ring, so there is empty space inside the export's own bounds to read.
  await drawShape(page, 'ellipse', { x: 200, y: 200 }, { x: 300, y: 300 })

  const transparent = await captureDownload(page, async () => {
    await openExportDialog(page)
    await expect(page.locator('[data-testid="export-background-toggle"]')).not.toBeChecked()
    await exportButton(page).click()
  })
  const clear = decodePng(transparent.buffer)
  expect(clear.channels).toBe(4)
  expect(clear.data[3], 'the corner outside the ellipse is see-through').toBe(0)

  const red = await captureDownload(page, async () => {
    await openExportDialog(page)
    await pickBackground(page, 'FF0000')
    await expect(page.locator('[data-testid="export-background-toggle"]')).toBeChecked()
    await expect(row(page, 'Background')).toContainText('#FF0000')
    await exportButton(page).click()
  })
  const png = decodePng(red.buffer)
  const corner = [...png.data.subarray(0, png.channels)]
  expect(corner.slice(0, 3)).toEqual([255, 0, 0])
  if (png.channels === 4) expect(corner[3]).toBe(255)
})

test('JPEG takes the colour too, and cannot be made transparent', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'ellipse', { x: 200, y: 200 }, { x: 300, y: 300 })

  const out = await captureDownload(page, async () => {
    await openExportDialog(page)
    await formatSelect(page).selectOption('jpeg')
    const toggle = page.locator('[data-testid="export-background-toggle"]')
    await expect(toggle).toBeChecked()
    await expect(toggle).toBeDisabled()
    await pickBackground(page, '0000FF')
    await exportButton(page).click()
  })
  expect(out.name).toMatch(/\.jpg$/)
  const [r, g, b] = await pixelOf(page, out.buffer, 'image/jpeg', 1, 1)
  expect(r).toBeLessThan(20)
  expect(g).toBeLessThan(20)
  expect(b).toBeGreaterThan(235)
})

test('previews the file the export would write', async ({ page }) => {
  await openApp(page)
  // An ellipse leaves its corners empty, so the background has somewhere to show.
  await drawShape(page, 'ellipse', { x: 200, y: 200 }, { x: 300, y: 300 })
  await openExportDialog(page)

  const image = page.locator('[data-testid="export-preview-image"]')
  await expect(image).toHaveCount(0)
  await page.locator('[data-testid="export-preview"]').check()
  await expect(image).toBeVisible()
  await expect(dialog(page)).toContainText(/File size: \d/)
  expect(await image.getAttribute('src')).toMatch(/^blob:/)

  // A change that alters the picture renders a new one.
  const first = await image.getAttribute('src')
  await scaleSelect(page).selectOption('2')
  await expect(image).not.toHaveAttribute('src', first!)
})

/** Read straight off the page, with no waiting: "at once" is the claim. */
const now = {
  backdrop: (image: Locator) =>
    image.evaluate((el) => `${getComputedStyle(el).backgroundColor} ${getComputedStyle(el).backgroundImage}`),
  pending: (page: Page) =>
    page.locator('.export-preview-frame').evaluate((el) => el.classList.contains('pending')),
}

test('the preview follows the background the moment it changes', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'ellipse', { x: 200, y: 200 }, { x: 300, y: 300 })
  await openExportDialog(page)
  await page.locator('[data-testid="export-preview"]').check()
  const image = page.locator('[data-testid="export-preview-image"]')
  await expect(image).toBeVisible()
  const src = await image.getAttribute('src')

  // Ticked: the colour is behind the artwork straight away, and nothing had to
  // be rendered for it — it used to wait out a pause and a whole export.
  const toggle = page.locator('[data-testid="export-background-toggle"]')
  await toggle.check()
  expect(await now.backdrop(image)).toContain('rgb(255, 255, 255)')
  expect(await now.pending(page)).toBe(false)
  await toggle.uncheck()
  expect(await now.backdrop(image)).toContain('rgba(0, 0, 0, 0)')
  expect(await now.pending(page)).toBe(false)

  // Dragged through the picker: it keeps up, and never dims the picture while
  // it does, which is what it used to do until the pointer stopped.
  await page.locator('[data-testid="export-background-color"]').click()
  const square = (await page.locator('.popover .sv-square').boundingBox())!
  await page.mouse.move(square.x + 5, square.y + 5)
  await page.mouse.down()
  const seen = new Set<string>()
  for (const f of [0.2, 0.4, 0.6, 0.8]) {
    await page.mouse.move(square.x + square.width * f, square.y + square.height * (1 - f))
    seen.add(await now.backdrop(image))
    expect(await now.pending(page)).toBe(false)
  }
  await page.mouse.up()
  expect(seen.size, 'a new colour at every step of the drag').toBe(4)
  expect(await image.getAttribute('src'), 'the artwork never needed rendering again').toBe(src)
})

test('a JPEG preview takes a new colour at once, then shows the file itself', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'ellipse', { x: 200, y: 200 }, { x: 300, y: 300 })
  await openExportDialog(page)
  await formatSelect(page).selectOption('jpeg')
  await page.locator('[data-testid="export-preview"]').check()
  const file = page.locator('[data-testid="export-preview-file"]')
  const standIn = page.locator('[data-testid="export-preview-image"]')
  await expect(file).toBeVisible()

  await page.locator('[data-testid="export-background-color"]').click()
  const hex = page.locator('.popover .field', { has: page.locator('.field-label:text-is("#")') }).locator('input')
  await hex.fill('0000FF')
  await hex.press('Enter')
  // JPEG has no transparency, so the file cannot be split from its colour. A
  // lossless stand-in over the new colour holds its place meanwhile.
  expect(await standIn.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible')
  expect(await now.backdrop(standIn)).toContain('rgb(0, 0, 255)')
  expect(await now.pending(page)).toBe(false)
  await dialog(page).locator('.dialog-header').click()

  // And then the JPEG, colour and compression both, once it has been written.
  await expect(file).toBeVisible()
  const corner = await file.evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return Array.from(ctx.getImageData(1, 1, 1, 1).data)
  })
  expect(corner[0]).toBeLessThan(20)
  expect(corner[2]).toBeGreaterThan(235)
})

test('exports WebP, transparent or on a colour', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'ellipse', { x: 200, y: 200 }, { x: 300, y: 300 })

  const clear = await captureDownload(page, async () => {
    await openExportDialog(page)
    await formatSelect(page).selectOption('webp')
    // Lossy, so it has a quality — shared with JPEG's.
    await expect(quality(page)).toBeVisible()
    await exportButton(page).click()
  })
  expect(clear.name).toBe('Ellipse.webp')
  expect(clear.buffer.toString('latin1', 0, 4)).toBe('RIFF')
  expect(clear.buffer.toString('latin1', 8, 12)).toBe('WEBP')
  expect((await pixelOf(page, clear.buffer, 'image/webp', 0, 0))[3], 'see-through outside the ellipse').toBe(0)

  const red = await captureDownload(page, async () => {
    await openExportDialog(page)
    await expect(formatSelect(page)).toHaveValue('webp')
    await pickBackground(page, 'FF0000')
    await exportButton(page).click()
  })
  const [r, g, b, a] = await pixelOf(page, red.buffer, 'image/webp', 0, 0)
  expect(r).toBeGreaterThan(235)
  expect(g).toBeLessThan(20)
  expect(b).toBeLessThan(20)
  expect(a).toBe(255)
})

test('the file name comes first, and the area after how the file is made', async ({ page }) => {
  await oneRect(page)
  await openExportDialog(page)
  const labels = () => dialog(page).locator('.dialog-row > label:first-child').allInnerTexts()

  expect(await labels()).toEqual(['File name', 'Format', 'Scale', 'Background', 'Area'])
  await formatSelect(page).selectOption('svg')
  expect(await labels()).toEqual(['File name', 'Format', 'Background', 'Images', 'Text', 'Area'])
  // The artboard picker stays with the choice it refines.
  await dialog(page).locator('.radio-option', { hasText: 'Artboard' }).locator('input').check()
  expect(await labels()).toEqual(['File name', 'Format', 'Background', 'Images', 'Text', 'Area', 'Which'])
})

test('exports HEIF, and previews it though the browser cannot show one', async ({ page }) => {
  await oneRect(page)

  const out = await captureDownload(page, async () => {
    await openExportDialog(page)
    await formatSelect(page).selectOption('heif')
    await page.locator('[data-testid="export-preview"]').check()
    // Decoded from the encoded bytes, since Chromium has no HEIF decoder — so a
    // picture of the right size here means the file round-trips.
    const preview = page.locator('[data-testid="export-preview-image"]')
    await expect(preview).toBeVisible({ timeout: 20_000 })
    expect(
      await preview.evaluate(async (img: HTMLImageElement) => {
        await img.decode()
        return [img.naturalWidth, img.naturalHeight]
      }),
    ).toEqual([200, 100])
    await exportButton(page).click()
  })

  expect(out.name).toBe('Rectangle.heic')
  // An ISO base media file whose brand says HEIF-with-HEVC.
  expect(out.buffer.toString('latin1', 4, 12)).toBe('ftypheic')
  expect(out.buffer.length).toBeGreaterThan(200)
})
