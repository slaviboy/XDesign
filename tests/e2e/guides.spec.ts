/**
 * Guides and grids, per artboard.
 *
 * Adobe's model: guides are pulled out of strips on an artboard's own top and
 * left borders, belong to that artboard, and copy across to others. Grids are
 * Square or Layout and are set on the artboard in the Property Inspector.
 *
 * Positions are asserted in the artboard's LOCAL units, which is what the model
 * stores — the whole point of the feature being per artboard.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  CANVAS, captureDownload, dismissRecovery, drawShape, nodesOfType, openApp,
  openExportDialog, press, selectTool, setField,
} from './helpers'

const guides = (page: Page) => page.locator('.artboard-guides .guide')
const section = (page: Page, name: string) => page.locator('.section', { hasText: name })

/** Drag a guide out of an artboard's edge strip to a screen offset. */
async function pullGuide(
  page: Page,
  axis: 'x' | 'y',
  to: number,
  options: { modifiers?: Array<'Shift' | 'Meta' | 'Control'> } = {},
) {
  const strip = page.locator(`[data-guide-strip="${axis}"]`).first()
  const box = (await strip.boundingBox())!
  const start = axis === 'x'
    ? { x: box.x + box.width / 2, y: box.y + 100 }
    : { x: box.x + 150, y: box.y + box.height / 2 }
  const end = axis === 'x' ? { x: to, y: start.y } : { x: start.x, y: to }

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (const m of options.modifiers ?? []) await page.keyboard.down(m)
  await page.mouse.move(end.x, end.y, { steps: 10 })
  for (const m of options.modifiers ?? []) await page.keyboard.up(m)
  await page.mouse.up()
}

/** Open Preferences from the application menu. */
async function openPreferences(page: Page) {
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'Preferences' }).click()
}

async function setGuideDrag(page: Page, mode: 'line' | 'handle') {
  await openPreferences(page)
  await page.locator('.dialog select[title="Where a guide can be picked up"]').selectOption(mode)
  await page.locator('.dialog button', { hasText: 'Done' }).click()
}

/** Right-click the canvas and choose an item from the Guides submenu. */
async function guidesMenu(page: Page, at: { x: number; y: number }, item: string) {
  await page.locator('.canvas-svg').click({ button: 'right', position: at })
  // A submenu opens on pointer enter, so it has to be hovered before its
  // contents exist in the DOM at all.
  await page.locator('.menu-item', { hasText: 'Guides' }).first().hover()
  await page.locator('.menu-item', { hasText: item }).click()
}

/** Screen x of a point at artboard-local x, for a document-origin artboard. */
async function screenOfLocalX(page: Page, localX: number) {
  const canvas = (await page.locator(CANVAS).boundingBox())!
  const viewport = await page.evaluate(() => {
    const t = document.querySelector('.viewport')!.getAttribute('transform')!
    const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/.exec(t)!
    return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) }
  })
  return canvas.x + viewport.x + localX * viewport.zoom
}

// ------------------------------------------------------------------ create --

test('a guide is pulled out of the artboard edge, which is the only way to make one', async ({ page }) => {
  await openApp(page)
  await expect(guides(page)).toHaveCount(0)
  // Two strips per artboard: one on the top border, one on the left.
  await expect(page.locator('.guide-strip')).toHaveCount(2)

  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  await expect(guides(page)).toHaveCount(1)
  expect(Number(await guides(page).first().getAttribute('x1'))).toBeCloseTo(250, 0)

  // The top strip gives a horizontal one, spanning the artboard rather than the
  // whole canvas — it belongs to this artboard.
  await pullGuide(page, 'y', (await page.locator(CANVAS).boundingBox())!.y + 300)
  await expect(guides(page)).toHaveCount(2)
  const horizontal = guides(page).nth(1)
  expect(Number(await horizontal.getAttribute('x1'))).toBe(0)
  expect(Number(await horizontal.getAttribute('x2'))).toBeGreaterThan(100)
})

test('creating a guide is a single undo entry', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  await expect(guides(page)).toHaveCount(1)

  // One press, not one per frame of the drag: the drag writes nothing to the
  // document until it is released.
  await press(page, 'z')
  await expect(guides(page)).toHaveCount(0)
})

// --------------------------------------------------------------- modifiers --

test('Shift moves a guide in tens', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 237), { modifiers: ['Shift'] })
  expect(Number(await guides(page).first().getAttribute('x1'))).toBe(240)
})

test('a guide snaps to an object, and the primary modifier suspends that', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 300, y: 200 }, { x: 420, y: 320 })
  await selectTool(page, 'select')
  await page.locator('.canvas-svg').click({ position: { x: 700, y: 520 } })

  // The rect's left edge in artboard-local units.
  const edge = Number(await nodesOfType(page, 'rect').first().evaluate((el) => {
    const m = /matrix\([^)]*?([-\d.]+) [-\d.]+\)/.exec(el.getAttribute('transform') ?? '')
    return m ? Number(m[1]) : 0
  }))

  await pullGuide(page, 'x', await screenOfLocalX(page, edge + 4))
  expect(Number(await guides(page).first().getAttribute('x1'))).toBeCloseTo(edge, 0)

  // Adobe: "To disable the snapping behavior, press Cmd (macOS) or Ctrl."
  await pullGuide(page, 'x', await screenOfLocalX(page, edge + 4), { modifiers: ['Meta'] })
  expect(Number(await guides(page).nth(1).getAttribute('x1'))).not.toBeCloseTo(edge, 0)
})

test('a guide snaps to the artboard centre', async ({ page }) => {
  await openApp(page)
  const width = Number(await nodesOfType(page, 'artboard').first().locator('rect').first().getAttribute('width'))
  await pullGuide(page, 'x', await screenOfLocalX(page, width / 2 + 3))
  expect(Number(await guides(page).first().getAttribute('x1'))).toBeCloseTo(width / 2, 1)
})

// --------------------------------------------------------- remove and lock --

test('dragging a guide off the artboard removes it', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  await expect(guides(page)).toHaveCount(1)

  const hit = page.locator('.artboard-guides .guide-hit').first()
  const box = (await hit.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x - 300, box.y + 100, { steps: 10 })
  await page.mouse.up()
  await expect(guides(page)).toHaveCount(0)
})

test('locked guides stay on screen but stop moving', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  const before = await guides(page).first().getAttribute('x1')

  await press(page, ';', true)
  // Adobe's lock hides neither the guide nor the artboard: it stops the guide
  // moving. The strips go, because there is nothing to pull one out for.
  await expect(guides(page)).toHaveCount(1)
  await expect(page.locator('.guide-strip')).toHaveCount(0)
  await expect(guides(page).first()).toHaveClass(/locked/)

  const box = (await guides(page).first().boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 100, { steps: 6 })
  await page.mouse.up()
  expect(await guides(page).first().getAttribute('x1')).toBe(before)

  await press(page, ';', true)
  await expect(page.locator('.guide-strip')).toHaveCount(2)
})

test('hiding guides takes them off screen but they still pull', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  await press(page, ';')
  await expect(guides(page)).toHaveCount(0)
  await press(page, ';')
  await expect(guides(page)).toHaveCount(1)
})

// ---------------------------------------------------------- copy and paste --

test('guides copy from one artboard to another', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  await selectTool(page, 'artboard')
  await page.locator(CANVAS).click({ position: { x: 20, y: 20 } })
  const canvas = (await page.locator(CANVAS).boundingBox())!
  await page.mouse.move(canvas.x + 700, canvas.y + 150)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 950, canvas.y + 450, { steps: 6 })
  await page.mouse.up()
  await expect(nodesOfType(page, 'artboard')).toHaveCount(2)

  await selectTool(page, 'select')
  await page.locator('.artboard-label').first().click()
  await guidesMenu(page, { x: 250, y: 250 }, 'Copy Guides')

  await page.locator('.artboard-label').nth(1).click()
  await guidesMenu(page, { x: 800, y: 300 }, 'Paste Guides')

  // The same local position on both, which is what makes one set of guides
  // usable across a run of screens.
  await expect(guides(page)).toHaveCount(2)
  const positions = await guides(page).evaluateAll((els) => els.map((e) => e.getAttribute('x1')))
  expect(positions[0]).toBe(positions[1])
})

// -------------------------------------------------------------------- grid --

test('an artboard takes a Square or a Layout grid', async ({ page }) => {
  await openApp(page)
  await page.locator('.artboard-label').first().click()
  const grid = section(page, 'GRID')
  await expect(grid).toHaveCount(1)

  await grid.locator('.paint-toggle').check()
  await expect(page.locator('[data-grid="square"]')).toHaveCount(1)

  await grid.locator('select[title="Grid type"]').selectOption('layout')
  // Adobe's default is twelve columns.
  await expect(page.locator('[data-grid="layout"] rect')).toHaveCount(12)

  const columns = grid.locator('.field', { has: page.locator('.field-label:text-is("Cols")') }).locator('input')
  await columns.fill('4')
  await columns.press('Enter')
  await expect(page.locator('[data-grid="layout"] rect')).toHaveCount(4)
})

test('a layout grid stays inside its artboard when the artboard changes width', async ({ page }) => {
  await openApp(page)
  await page.locator('.artboard-label').first().click()
  const grid = section(page, 'GRID')
  await grid.locator('.paint-toggle').check()
  await grid.locator('select[title="Grid type"]').selectOption('layout')

  const rightEdge = async () => {
    const last = page.locator('[data-grid="layout"] rect').last()
    return Number(await last.getAttribute('x')) + Number(await last.getAttribute('width'))
  }
  const margin = 16
  await setField(page, 'W', 900)
  // Column width is derived, so the last column lands exactly on the margin
  // whatever the artboard's width — there is no stored width that could go stale.
  expect(await rightEdge()).toBeCloseTo(900 - margin, 1)

  await setField(page, 'W', 420)
  expect(await rightEdge()).toBeCloseTo(420 - margin, 1)
})

test('an over-constrained layout grid draws nothing and says why', async ({ page }) => {
  await openApp(page)
  await page.locator('.artboard-label').first().click()
  const grid = section(page, 'GRID')
  await grid.locator('.paint-toggle').check()
  await grid.locator('select[title="Grid type"]').selectOption('layout')

  const gutter = grid.locator('.field', { has: page.locator('.field-label:text-is("Gut")') }).locator('input')
  await gutter.fill('500')
  await gutter.press('Enter')
  await expect(page.locator('[data-grid="layout"] rect')).toHaveCount(0)
  await expect(grid.locator('.multi-note')).toContainText('no room')
})

test('the grid colour is document data, and survives a theme change', async ({ page }) => {
  await openApp(page)
  await page.locator('.artboard-label').first().click()
  const grid = section(page, 'GRID')
  await grid.locator('.paint-toggle').check()
  await grid.locator('select[title="Grid type"]').selectOption('layout')

  await grid.locator('.swatch').first().click()
  const hex = page.locator('.popover .field', { has: page.locator('.field-label:text-is("#")') }).locator('input')
  await hex.fill('00aa44')
  await hex.press('Enter')
  await page.keyboard.press('Escape')

  const column = page.locator('[data-grid="layout"] rect').first()
  expect((await column.getAttribute('fill'))?.toLowerCase()).toBe('#00aa44')
  // Chrome follows the theme; artwork settings do not.
  await page.locator('[data-testid="theme-toggle"]').click()
  expect((await column.getAttribute('fill'))?.toLowerCase()).toBe('#00aa44')
})

// ------------------------------------------------------- never exported --

test('neither guides nor artboard grids reach an export', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  await page.locator('.artboard-label').first().click()
  await section(page, 'GRID').locator('.paint-toggle').check()
  await expect(page.locator('[data-grid="square"]')).toHaveCount(1)

  // Out of the inspector: the shortcut layer ignores keys aimed at a field.
  await page.locator('.canvas-svg').click({ position: { x: 760, y: 540 } })
  await openExportDialog(page)
  await page.locator('[role="dialog"] .dialog-row', { hasText: 'Format' }).locator('select').selectOption('svg')
  const file = await captureDownload(page, () =>
    page.locator('.dialog button', { hasText: 'Export' }).last().click(),
  )
  const svg = file.buffer.toString('utf8')

  expect(svg).not.toContain('artboard-grid')
  expect(svg).not.toContain('artboard-guides')
  expect(svg).not.toContain('data-grid')
  // Not an empty export: the artboard itself is there, so the assertions above
  // cannot pass by exporting nothing at all.
  expect(svg).toContain('<svg')
  expect(svg.length).toBeGreaterThan(200)
})

// ------------------------------------------------------------- persistence --

test('guides and a grid survive a save and reopen', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  await page.locator('.artboard-label').first().click()
  await section(page, 'GRID').locator('.paint-toggle').check()
  await section(page, 'GRID').locator('select[title="Grid type"]').selectOption('layout')

  await page.locator('.canvas-svg').click({ position: { x: 760, y: 540 } })
  const saved = await captureDownload(page, () => press(page, 's'))
  await page.reload()
  await page.waitForSelector(CANVAS)
  await page.waitForTimeout(300)
  await dismissRecovery(page)

  const chooser = page.waitForEvent('filechooser')
  await press(page, 'o')
  ;(await chooser).setFiles({
    name: saved.name,
    mimeType: 'application/x-xdesign+zip',
    buffer: saved.buffer,
  })
  await page.waitForTimeout(600)

  await expect(guides(page)).toHaveCount(1)
  expect(Number(await guides(page).first().getAttribute('x1'))).toBeCloseTo(250, 0)
  await expect(page.locator('[data-grid="layout"] rect')).toHaveCount(12)
})

// ---------------------------------------------------------------- readout --

/** Start a guide drag and leave the pointer down, so the readout is on screen. */
async function holdGuide(page: Page, axis: 'x' | 'y', to: number) {
  const strip = page.locator(`[data-guide-strip="${axis}"]`).first()
  const box = (await strip.boundingBox())!
  const start = axis === 'x'
    ? { x: box.x + box.width / 2, y: box.y + 200 }
    : { x: box.x + 300, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(axis === 'x' ? to : start.x, axis === 'x' ? start.y : to, { steps: 10 })
}

test('a guide being dragged reads out its coordinate at the cursor', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('.guide-readout')).toHaveCount(0)

  await holdGuide(page, 'x', await screenOfLocalX(page, 280))
  // The axis and the value, as Adobe shows them: "X 280".
  const chip = page.locator('.guide-chip')
  await expect(chip).toHaveAttribute('data-guide-readout', 'x280')
  await expect(chip).toContainText('X')
  await expect(chip).toContainText('280')

  // It follows the cursor rather than sitting at a fixed spot.
  const before = (await chip.boundingBox())!
  await page.mouse.move(await screenOfLocalX(page, 400), 400, { steps: 4 })
  const after = (await chip.boundingBox())!
  expect(after.x).toBeGreaterThan(before.x)

  await page.mouse.up()
  // Feedback for a gesture, so it goes when the gesture does.
  await expect(page.locator('.guide-readout')).toHaveCount(0)
})

test('the artboard edge shows the distance either side of the guide', async ({ page }) => {
  await openApp(page)
  const width = Number(
    await nodesOfType(page, 'artboard').first().locator('rect').first().getAttribute('width'),
  )

  await holdGuide(page, 'x', await screenOfLocalX(page, 280))
  await expect(page.locator('.guide-rule')).toHaveCount(1)
  // The two segments the guide divides the artboard into, which is what you are
  // usually after when placing one — a margin, or a column.
  expect(await page.locator('.guide-measure').allTextContents()).toEqual([
    '280',
    String(width - 280),
  ])

  // Each sits over the middle of the span it measures.
  const guideX = await screenOfLocalX(page, 280)
  const boxes = await page.locator('.guide-measure').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().x + e.getBoundingClientRect().width / 2),
  )
  expect(boxes[0]!).toBeLessThan(guideX)
  expect(boxes[1]!).toBeGreaterThan(guideX)
  await page.mouse.up()
})

test('a horizontal guide measures down the left edge instead', async ({ page }) => {
  await openApp(page)
  const canvas = (await page.locator(CANVAS).boundingBox())!
  await holdGuide(page, 'y', canvas.y + 300)

  await expect(page.locator('.guide-chip')).toHaveAttribute('data-guide-readout', /^y/)
  const rule = page.locator('.guide-rule')
  // A vertical rule this time: it measures the axis the guide divides.
  expect(await rule.getAttribute('x1')).toBe(await rule.getAttribute('x2'))
  await expect(page.locator('.guide-measure')).toHaveCount(2)
  await page.mouse.up()
})

test('the guide being dragged is distinguishable from the ones already placed', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 200))
  await expect(guides(page)).toHaveCount(1)
  await expect(page.locator('.artboard-guides .guide.active')).toHaveCount(0)

  await holdGuide(page, 'x', await screenOfLocalX(page, 400))
  // Two guides on screen, and only the live one is marked.
  await expect(guides(page)).toHaveCount(2)
  await expect(page.locator('.artboard-guides .guide.active')).toHaveCount(1)
  await page.mouse.up()
  await expect(page.locator('.artboard-guides .guide.active')).toHaveCount(0)
})

// -------------------------------------------------------------- selection --

test('a guide dragged clear of its artboard disappears before you let go', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  const hit = page.locator('.artboard-guides .guide-hit').first()
  const box = (await hit.boundingBox())!

  await page.mouse.move(box.x + box.width / 2, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x - 300, box.y + 200, { steps: 10 })
  // Not merely removed on release: hidden the moment it leaves, because a guide
  // floating outside the artboard it belongs to is a state the model cannot hold.
  await expect(guides(page)).toHaveCount(0)

  // Back inside and it returns, so this is a preview rather than a deletion.
  await page.mouse.move(box.x + 40, box.y + 200, { steps: 6 })
  await expect(guides(page)).toHaveCount(1)
  await page.mouse.up()
  await expect(guides(page)).toHaveCount(1)
})

test('clicking a guide selects it and gives it a handle', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  await expect(page.locator('.guide-handle')).toHaveCount(0)

  const hit = page.locator('.artboard-guides .guide-hit').first()
  const box = (await hit.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + 300)

  await expect(page.locator('.artboard-guides .guide.selected')).toHaveCount(1)
  // The handle sits at the artboard's edge, where it cannot be lost in artwork.
  const handle = page.locator('.guide-handle')
  await expect(handle).toHaveCount(1)
  const artboard = (await nodesOfType(page, 'artboard').first().boundingBox())!
  const knob = (await handle.boundingBox())!
  // Centred ON the border, straddling it, rather than sitting beside it.
  expect(Math.abs(knob.y + knob.height / 2 - artboard.y)).toBeLessThan(2)

  // Selecting artwork puts it down again: the panel shows one thing at a time.
  await drawShape(page, 'rect', { x: 500, y: 200 }, { x: 600, y: 300 })
  await expect(page.locator('.artboard-guides .guide.selected')).toHaveCount(0)
  await expect(page.locator('.guide-handle')).toHaveCount(0)
})

test('the handle drags the guide, and Delete removes it', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  const hit = page.locator('.artboard-guides .guide-hit').first()
  const box = (await hit.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + 300)

  const handle = (await page.locator('.guide-handle').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 90, handle.y + handle.height / 2, { steps: 8 })
  await page.mouse.up()
  expect(Number(await guides(page).first().getAttribute('x1'))).toBeGreaterThan(250)

  await page.keyboard.press('Delete')
  await expect(guides(page)).toHaveCount(0)
})

test('the drag-from setting can put the line out of reach without hiding it', async ({ page }) => {
  await openApp(page)
  await setGuideDrag(page, 'handle')
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))

  const hit = page.locator('.artboard-guides .guide-hit').first()
  const box = (await hit.boundingBox())!
  const before = await guides(page).first().getAttribute('x1')

  await page.mouse.move(box.x + box.width / 2, box.y + 300)
  await page.mouse.down()
  await page.mouse.move(box.x + 150, box.y + 300, { steps: 8 })
  await page.mouse.up()
  // The line no longer drags...
  expect(await guides(page).first().getAttribute('x1')).toBe(before)
  // ...but it still selects, so the guide is never unreachable.
  await expect(page.locator('.artboard-guides .guide.selected')).toHaveCount(1)

  // And the handle it just revealed does drag it.
  const handle = (await page.locator('.guide-handle').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + handle.height / 2, { steps: 8 })
  await page.mouse.up()
  expect(await guides(page).first().getAttribute('x1')).not.toBe(before)
})

// --------------------------------------------------------- guide inspector --

test('a selected guide can be positioned from the panel', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))
  const hit = page.locator('.artboard-guides .guide-hit').first()
  const box = (await hit.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + 300)

  const guideSection = page.locator('.section', {
    has: page.locator('.section-title:text-is("Guide")'),
  })
  await expect(guideSection).toHaveCount(1)
  // Labelled for the axis it constrains: a vertical guide has an X and no Y.
  await expect(guideSection.locator('.field-label')).toHaveText('X')
  expect(Number(await guideSection.locator('input').inputValue())).toBeCloseTo(250, 0)

  await guideSection.locator('input').fill('400')
  await guideSection.locator('input').press('Enter')
  expect(Number(await guides(page).first().getAttribute('x1'))).toBe(400)

  await guideSection.locator('button', { hasText: 'Delete Guide' }).click()
  await expect(guides(page)).toHaveCount(0)
  // The section goes with it rather than pointing at nothing.
  await expect(page.locator('.section-title:text-is("Guide")')).toHaveCount(0)
})

test('a horizontal guide is labelled Y', async ({ page }) => {
  await openApp(page)
  const canvas = (await page.locator(CANVAS).boundingBox())!
  await pullGuide(page, 'y', canvas.y + 300)
  const hit = page.locator('.artboard-guides .guide-hit').first()
  const box = (await hit.boundingBox())!
  await page.mouse.click(box.x + 200, box.y + box.height / 2)
  await expect(
    page
      .locator('.section', { has: page.locator('.section-title:text-is("Guide")') })
      .locator('.field-label'),
  ).toHaveText('Y')
})

// ------------------------------------------------------------ guide colour --

test('the guide colour is a setting, and is saved with the document', async ({ page }) => {
  await openApp(page)
  await pullGuide(page, 'x', await screenOfLocalX(page, 250))

  await openPreferences(page)
  await page.locator('[data-testid="guide-color"]').click()
  const hex = page.locator('.popover .field', { has: page.locator('.field-label:text-is("#")') }).locator('input')
  await hex.fill('1188ff')
  await hex.press('Enter')
  // Clicking outside the popover closes it; Escape would close the dialog too.
  await page.locator('.dialog h4').first().click()
  await page.locator('.dialog button', { hasText: 'Done' }).click()

  const stroke = await page.locator('.artboard-guides').evaluate((el) => getComputedStyle(el).stroke)
  expect(stroke).toBe('rgb(17, 136, 255)')

  // Document data, not chrome: it does not follow the theme.
  await page.locator('[data-testid="theme-toggle"]').click()
  expect(await page.locator('.artboard-guides').evaluate((el) => getComputedStyle(el).stroke)).toBe(
    'rgb(17, 136, 255)',
  )
})

// ------------------------------------------------- readout and the artboard --

test('the measurement rule takes the artboard title\'s place while it is needed', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('.artboard-label')).toHaveCount(1)

  await holdGuide(page, 'x', await screenOfLocalX(page, 280))
  // Both want the strip above the artboard's top border, and the rule has to
  // line up with the border it is measuring.
  await expect(page.locator('.artboard-label')).toHaveCount(0)

  const artboard = (await nodesOfType(page, 'artboard').first().boundingBox())!
  const rule = (await page.locator('.guide-rule').boundingBox())!
  expect(Math.abs(rule.y - artboard.y)).toBeLessThan(2)

  await page.mouse.up()
  await expect(page.locator('.artboard-label')).toHaveCount(1)
})
