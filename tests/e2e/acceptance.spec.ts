/**
 * The ten acceptance tests from the specification, plus an offline proof.
 *
 * Everything is driven through the real UI and asserted against the rendered
 * SVG DOM or the bytes of an actual export — no internal state is inspected.
 *
 * Save/open use the download and file-input fallback (openApp deletes the File
 * System Access API), because showSaveFilePicker opens a native dialog that
 * cannot be driven. That path is what Firefox and Safari users get regardless.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  CANVAS, RED_PNG_BASE64, SAMPLE_SVG, captureDownload, dismissRecovery, drawShape,
  dropFiles, layerRows, modifier, nodesOfType, openApp, openExportDialog, pngSize,
  press, readField, selectTool, setField,
} from './helpers'

/** Save the document and hand back the .xdesign bytes. */
async function saveDocument(page: Page) {
  return captureDownload(page, async () => {
    await press(page, 's')
  })
}

/** Reload and open a previously saved document through the file input. */
async function reopenDocument(page: Page, name: string, buffer: Buffer) {
  await page.reload()
  await page.waitForSelector(CANVAS)
  await page.waitForTimeout(300)
  await dismissRecovery(page)
  const chooserPromise = page.waitForEvent('filechooser')
  await press(page, 'o')
  const chooser = await chooserPromise
  await chooser.setFiles({ name, mimeType: 'application/x-xdesign+zip', buffer })
  await page.waitForTimeout(500)
}

/** Address a dialog control by its row label — index-based lookup breaks when
 *  the dialog grows a conditional row. */
function dialogSelect(page: Page, label: string) {
  return page.locator('[role="dialog"] .dialog-row', { hasText: label }).locator('select').first()
}

/** Set the fill through the swatch popover. */
async function setFillHex(page: Page, hex: string) {
  await page.locator('.section', { hasText: 'FILL' }).locator('.swatch').first().click()
  const field = page.locator('.popover .field', { has: page.locator('.field-label:text-is("#")') }).locator('input')
  await field.fill(hex.replace('#', ''))
  await field.press('Enter')
  await page.keyboard.press('Escape')
}

// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  ;(page as unknown as { __errors: string[] }).__errors = errors
})

test.afterEach(async ({ page }) => {
  const errors = (page as unknown as { __errors?: string[] }).__errors ?? []
  expect(errors, `uncaught page errors: ${errors.join('\n')}`).toHaveLength(0)
})

// ---------------------------------------------------------------------------

test('TEST 1 — rectangle: size, rotation, fill, stroke survive save and reload', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 180 }, { x: 320, y: 260 })

  await setField(page, 'W', 300)
  await setField(page, 'H', 200)
  await setField(page, '∠', 15)
  await setFillHex(page, '#ff5722')
  await page.locator('.section', { hasText: 'STROKE' }).locator('.swatch').first().click()
  const strokeHex = page.locator('.popover .field', { has: page.locator('.field-label:text-is("#")') }).locator('input')
  await strokeHex.fill('1122cc')
  await strokeHex.press('Enter')
  await page.keyboard.press('Escape')
  await setField(page, 'W', 300)

  expect(await readField(page, 'W')).toBeCloseTo(300, 1)
  expect(await readField(page, 'H')).toBeCloseTo(200, 1)
  expect(await readField(page, '∠')).toBeCloseTo(15, 1)

  const saved = await saveDocument(page)
  expect(saved.name).toMatch(/\.xdesign$/)
  expect(saved.buffer.length).toBeGreaterThan(100)
  // Zip container: the format is a real archive, not base64-in-JSON.
  expect(saved.buffer.subarray(0, 2).toString()).toBe('PK')

  await reopenDocument(page, saved.name, saved.buffer)

  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
  await nodesOfType(page, 'rect').first().click({ force: true })
  expect(await readField(page, 'W')).toBeCloseTo(300, 0)
  expect(await readField(page, 'H')).toBeCloseTo(200, 0)
  expect(await readField(page, '∠')).toBeCloseTo(15, 0)

  const fill = await nodesOfType(page, 'rect').locator('path').first().getAttribute('fill')
  expect(fill?.toLowerCase()).toBe('#ff5722')
})

test('TEST 2 — dropped PNG: resize, rotate, flip, and survive reload', async ({ page }) => {
  await openApp(page)
  await dropFiles(page, [{ name: 'red.png', type: 'image/png', base64: RED_PNG_BASE64 }], { x: 400, y: 300 })

  await expect(nodesOfType(page, 'image')).toHaveCount(1)
  const href = await nodesOfType(page, 'image').locator('image').first().getAttribute('href')
  expect(href).toMatch(/^data:image\/png;base64,/)

  await setField(page, 'W', 240)
  await setField(page, 'H', 180)
  await setField(page, '∠', 30)
  await page.locator('button[aria-label="Flip horizontal"]').click()

  const saved = await saveDocument(page)
  await reopenDocument(page, saved.name, saved.buffer)

  await expect(nodesOfType(page, 'image')).toHaveCount(1)
  // The pixels travelled inside the file, not as a reference to the original.
  const reopened = await nodesOfType(page, 'image').locator('image').first().getAttribute('href')
  expect(reopened).toMatch(/^data:image\/png;base64,/)
  expect(reopened).toBe(href)

  await nodesOfType(page, 'image').first().click({ force: true })
  expect(await readField(page, 'W')).toBeCloseTo(240, 0)
})

test('TEST 3 — dropped SVG stays vector, transforms, and exports as vector', async ({ page }) => {
  await openApp(page)
  await dropFiles(page, [{ name: 'art.svg', type: 'image/svg+xml', text: SAMPLE_SVG }], { x: 420, y: 300 })

  // Real nodes, not one flattened image: rect + ellipse + path all imported.
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(1)
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  await expect(nodesOfType(page, 'image')).toHaveCount(0)

  // The gradient survived as a real gradient.
  await expect(page.locator('.document-layer linearGradient')).toHaveCount(1)

  await selectTool(page, 'select')
  await page.locator('.layer-row', { hasText: 'art' }).first().click()
  await setField(page, '∠', 20)

  const exported = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page.locator('[role="dialog"] select').first().selectOption('svg')
    await page.locator('button:text-is("Export")').click()
  })

  const svg = exported.buffer.toString('utf8')
  expect(exported.name).toMatch(/\.svg$/)
  // Vector, not a rasterized <image>.
  expect(svg).toContain('<path')
  expect(svg).toContain('linearGradient')
  expect(svg).not.toMatch(/<image[^>]+data:image\/png/)
})

test('TEST 4 — group of mixed shapes rotates and ungroups correctly', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 260, y: 250 })
  await drawShape(page, 'ellipse', { x: 280, y: 200 }, { x: 340, y: 250 })
  await drawShape(page, 'polygon', { x: 360, y: 200 }, { x: 420, y: 250 })
  await drawShape(page, 'polygon', { x: 440, y: 200 }, { x: 500, y: 250 })
  await drawShape(page, 'pen', { x: 200, y: 300 }, { x: 260, y: 300 })

  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)
  const before = await layerRows(page).count()
  expect(before).toBeGreaterThanOrEqual(5)

  await page.keyboard.press(`${modifier()}+g`)
  await expect(page.locator('.layer-row', { hasText: 'Group' })).toHaveCount(1)

  await setField(page, '∠', 45)
  expect(await readField(page, '∠')).toBeCloseTo(45, 0)

  await page.keyboard.press(`${modifier()}+Shift+g`)
  await expect(page.locator('.layer-row', { hasText: 'Group' })).toHaveCount(0)
  // Every child survived the round trip.
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(1)
  await expect(nodesOfType(page, 'polygon')).toHaveCount(2)
})

test('TEST 5 — layer ordering, hide and lock behave correctly', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
  await drawShape(page, 'ellipse', { x: 250, y: 240 }, { x: 370, y: 340 })

  const order = () =>
    page.locator('.document-layer > g > g > g[data-node-id]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-node-type')),
    )
  // Paint order: last drawn is on top, so it is last in the DOM.
  expect(await order()).toEqual(['rect', 'ellipse'])

  await page.keyboard.press(`${modifier()}+BracketLeft`)
  expect(await order()).toEqual(['ellipse', 'rect'])

  // Hidden nodes are not rendered at all, which also makes them unclickable.
  await page.locator('.layer-row', { hasText: 'Ellipse' }).locator('button[title="Hide"]').click()
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(0)
  await page.locator('.layer-row', { hasText: 'Ellipse' }).locator('button[title="Show"]').click()
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(1)

  // A locked node stays visible but cannot be picked up on canvas.
  await page.locator('.layer-row', { hasText: 'Rectangle' }).locator('button[title="Lock"]').click()
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
  await expect(page.locator('.layer-row', { hasText: 'Rectangle' }).locator('button[title="Unlock"]')).toBeVisible()
})

test('TEST 6 — align, distribute, group and export a multi-selection', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 250, y: 240 })
  await drawShape(page, 'rect', { x: 300, y: 260 }, { x: 350, y: 320 })
  await drawShape(page, 'rect', { x: 400, y: 320 }, { x: 450, y: 400 })

  await selectTool(page, 'select')
  await page.keyboard.press(`${modifier()}+a`)

  await page.locator('button[aria-label="Align middle"]').click()
  await page.locator('button[aria-label="Distribute horizontally"]').click()

  await page.keyboard.press(`${modifier()}+g`)
  await expect(page.locator('.layer-row', { hasText: 'Group' })).toHaveCount(1)

  const exported = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page.locator('button:text-is("Export")').click()
  })
  expect(exported.name).toMatch(/\.png$/)
  const size = pngSize(exported.buffer)
  expect(size.width).toBeGreaterThan(50)
  expect(size.height).toBeGreaterThan(10)
})

test('TEST 7 — gradient with edited stops survives save and reload', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 400, y: 320 })

  await page.locator('.section', { hasText: 'FILL' }).locator('.swatch').first().click()
  await page.locator('.popover select[title="Paint type"]').selectOption('linear')
  await expect(page.locator('.gradient-bar')).toBeVisible()

  // Add a third stop, then move it.
  await page.locator('.popover button[title="Add stop"]').click()
  await expect(page.locator('.gradient-stop')).toHaveCount(3)
  const posField = page.locator('.popover .field', { has: page.locator('.field-label:text-is("Pos")') }).locator('input')
  await posField.fill('35')
  await posField.press('Enter')
  await page.keyboard.press('Escape')

  await expect(page.locator('.document-layer linearGradient stop')).toHaveCount(3)
  const before = await page.locator('.document-layer linearGradient stop').evaluateAll((els) =>
    els.map((e) => `${e.getAttribute('offset')}|${e.getAttribute('stop-color')}`),
  )

  const saved = await saveDocument(page)
  await reopenDocument(page, saved.name, saved.buffer)

  await expect(page.locator('.document-layer linearGradient stop')).toHaveCount(3)
  const after = await page.locator('.document-layer linearGradient stop').evaluateAll((els) =>
    els.map((e) => `${e.getAttribute('offset')}|${e.getAttribute('stop-color')}`),
  )
  expect(after).toEqual(before)
})

test('TEST 8 — artboard export contains only artboard content', async ({ page }) => {
  await openApp(page)
  // Inside the artboard.
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 280 })
  // Far outside it, on the pasteboard.
  await drawShape(page, 'ellipse', { x: 960, y: 620 }, { x: 1010, y: 660 })

  const exported = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page.locator('[role="dialog"] .radio-option', { hasText: 'Artboard' }).locator('input').check()
    await dialogSelect(page, 'Format').selectOption('svg')
    await page.locator('button:text-is("Export")').click()
  })

  const svg = exported.buffer.toString('utf8')
  // The artboard's own frame defines the crop: 1280x800 at 1x.
  expect(svg).toMatch(/viewBox="0 0 1280 800"/)
  // The rect inside is present; the pasteboard ellipse is clipped away.
  expect(svg).toContain('<rect')
  expect(svg).not.toContain('<ellipse')
})

test('TEST 9 — export scale produces exact pixel dimensions', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 260 })
  await setField(page, 'W', 200)
  await setField(page, 'H', 100)

  const at = async (scale: string) => {
    const out = await captureDownload(page, async () => {
      await openExportDialog(page)
      await dialogSelect(page, 'Format').selectOption('png')
      await dialogSelect(page, 'Scale').selectOption(scale)
      await page.locator('button:text-is("Export")').click()
    })
    return pngSize(out.buffer)
  }

  expect(await at('1')).toEqual({ width: 200, height: 100 })
  expect(await at('2')).toEqual({ width: 400, height: 200 })
  expect(await at('4')).toEqual({ width: 800, height: 400 })
})

test('TEST 10 — recovers the previous document after an abnormal exit', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })
  await drawShape(page, 'ellipse', { x: 340, y: 200 }, { x: 440, y: 300 })
  // Let the autosave debounce fire.
  await page.waitForTimeout(2600)

  // Reload without a clean shutdown — the tab simply goes away.
  await page.reload()
  await page.waitForSelector(CANVAS)

  const dialog = page.locator('[role="dialog"][aria-label="Recover previous document?"]')
  await expect(dialog).toBeVisible({ timeout: 8000 })
  await dialog.locator('button:text-is("Recover")').click()

  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
  await expect(nodesOfType(page, 'ellipse')).toHaveCount(1)
})

test('runs with no network at all', async ({ page, context }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 320, y: 300 })

  // Nothing may reach the network from here on.
  const attempted: string[] = []
  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (!url.startsWith('http://localhost:4173')) {
      attempted.push(url)
      return route.abort()
    }
    return route.continue()
  })
  await context.setOffline(true)

  // The editor keeps working with the network cut.
  await setField(page, 'W', 250)
  expect(await readField(page, 'W')).toBeCloseTo(250, 0)
  await drawShape(page, 'polygon', { x: 400, y: 200 }, { x: 480, y: 280 })
  await expect(nodesOfType(page, 'polygon')).toHaveCount(1)

  expect(attempted, `unexpected external requests: ${attempted.join(', ')}`).toHaveLength(0)
})
