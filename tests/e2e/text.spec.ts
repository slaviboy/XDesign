/**
 * Text, per Adobe's "Drawing text tools" page: the three resize options, area
 * text, paragraph spacing, transformations, importing from a file, spell check,
 * and the Alt-hover distance measurement.
 *
 * Everything is asserted against rendered SVG — the <tspan>s that were actually
 * laid out, the clip that was actually applied — rather than against store
 * state, so a change that stops reaching the screen fails here.
 */

import { test, expect, type Page } from '@playwright/test'
import {
  CANVAS,
  clickCanvas,
  dragOnCanvas,
  drawShape,
  dropFiles,
  nodesOfType,
  openApp,
  readField,
  selectTool,
  setField,
} from './helpers'

/** Make a text object and type into it. Click for Auto Width, drag for area. */
async function makeText(
  page: Page,
  content: string,
  at: { x: number; y: number },
  to?: { x: number; y: number },
): Promise<void> {
  await selectTool(page, 'text')
  if (to) await dragOnCanvas(page, at, to)
  else await clickCanvas(page, at)
  const editor = page.locator('[data-testid="text-editor"]')
  await expect(editor).toBeVisible()
  await editor.fill(content)
  await page.keyboard.press('Escape')
  await selectTool(page, 'select')
}

function tspans(page: Page) {
  return nodesOfType(page, 'text').first().locator('text tspan')
}

/** Hold Alt and hover a canvas point, which is Adobe's measure gesture. */
async function altHover(page: Page, at: { x: number; y: number }): Promise<void> {
  const box = (await page.locator(CANVAS).boundingBox())!
  await page.keyboard.down('Alt')
  // Two moves: the first can land while the pointer is still considered outside.
  await page.mouse.move(box.x + at.x - 6, box.y + at.y - 6)
  await page.mouse.move(box.x + at.x, box.y + at.y, { steps: 4 })
}

// ---------------------------------------------------------------- measuring --

/** The selected object's box, in document units, read from the inspector. */
async function selectedBox(page: Page) {
  return {
    x: await readField(page, 'X'),
    y: await readField(page, 'Y'),
    w: await readField(page, 'W'),
    h: await readField(page, 'H'),
  }
}

test('Alt and hover measures the distance to another object', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 300 })
  await clickCanvas(page, { x: 250, y: 250 })
  const a = await selectedBox(page)

  await drawShape(page, 'ellipse', { x: 460, y: 420 }, { x: 540, y: 500 })
  await clickCanvas(page, { x: 500, y: 460 })
  const b = await selectedBox(page)

  // Select the rectangle, then hold Alt over the ellipse.
  await clickCanvas(page, { x: 250, y: 250 })
  await altHover(page, { x: 500, y: 460 })

  const overlay = page.locator('.measure-overlay')
  await expect(overlay).toBeVisible()
  // Separated on both axes, so both distances are real and both are drawn.
  await expect(overlay.locator('[data-measure="x"]')).toHaveCount(1)
  await expect(overlay.locator('[data-measure="y"]')).toHaveCount(1)

  // The numbers are the gaps between the facing edges, in document units — not
  // centre-to-centre, and not scaled by the zoom the canvas happens to be at.
  const labels = await overlay.locator('.measure-badge text').allTextContents()
  expect(labels.map(Number).sort((n, m) => n - m)).toEqual(
    [Math.round(b.x - (a.x + a.w)), Math.round(b.y - (a.y + a.h))].sort((n, m) => n - m),
  )

  // The thing being measured to is outlined, so the pair is unambiguous.
  await expect(overlay.locator('.measure-target')).toHaveCount(1)

  // Releasing Alt ends the gesture.
  await page.keyboard.up('Alt')
  await expect(overlay).toHaveCount(0)
})

test('overlapping boxes report only the axis they are separated on', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 300 })
  // Side by side, sharing the same vertical band: there is no vertical gap.
  await drawShape(page, 'rect', { x: 420, y: 240 }, { x: 500, y: 280 })

  await clickCanvas(page, { x: 460, y: 260 })
  const b = await selectedBox(page)
  await clickCanvas(page, { x: 250, y: 250 })
  const a = await selectedBox(page)
  await altHover(page, { x: 460, y: 260 })

  const overlay = page.locator('.measure-overlay')
  await expect(overlay.locator('[data-measure="x"]')).toHaveCount(1)
  await expect(overlay.locator('[data-measure="y"]')).toHaveCount(0)
  await expect(overlay.locator('.measure-badge text')).toHaveText(String(Math.round(b.x - (a.x + a.w))))
  await page.keyboard.up('Alt')
})

test('measuring needs a selection and never measures a thing against itself', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 300, y: 300 })
  await drawShape(page, 'rect', { x: 460, y: 200 }, { x: 540, y: 280 })

  // Nothing selected: Alt-hover shows nothing.
  await clickCanvas(page, { x: 60, y: 60 })
  await altHover(page, { x: 500, y: 240 })
  await expect(page.locator('.measure-overlay')).toHaveCount(0)
  await page.keyboard.up('Alt')

  // Selected, hovering itself: still nothing, because that distance is zero.
  await clickCanvas(page, { x: 250, y: 250 })
  await altHover(page, { x: 250, y: 250 })
  await expect(page.locator('.measure-overlay')).toHaveCount(0)
  await page.keyboard.up('Alt')

  // Moving onto the OTHER object, still with Alt down, does measure — so the
  // silence above is the rule working and not the feature being absent.
  await altHover(page, { x: 500, y: 240 })
  await expect(page.locator('.measure-overlay')).toHaveCount(1)
  await page.keyboard.up('Alt')
})

// ----------------------------------------------------------- resize options --

test('Auto Width grows sideways and never wraps', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'one two three four five six', { x: 260, y: 300 })

  await page.locator('[data-testid="sizing-auto-width"]').click()
  await expect(page.locator('[data-testid="sizing-auto-width"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(tspans(page)).toHaveCount(1)

  const wide = await readField(page, 'W')
  // Typing more makes the box wider rather than taller.
  const tall = await readField(page, 'H')
  await nodesOfType(page, 'text').first().dblclick({ force: true })
  await page.locator('[data-testid="text-editor"]').fill('one two three four five six seven eight nine')
  await page.keyboard.press('Escape')

  expect(await readField(page, 'W')).toBeGreaterThan(wide)
  expect(await readField(page, 'H')).toBeCloseTo(tall, 0)
  await expect(tspans(page)).toHaveCount(1)

  // The box does not own its size in this mode, so anything that changes how
  // wide the text is has to move the frame with it — a bigger font included,
  // not just more characters.
  const before = await readField(page, 'W')
  await setField(page, 'Size', 48)
  expect(await readField(page, 'W')).toBeGreaterThan(before)
  expect(await readField(page, 'H')).toBeGreaterThan(tall)
})

test('Auto Height keeps its width and grows downwards', async ({ page }) => {
  await openApp(page)
  // Drag creates area text, which is Auto Height.
  await makeText(page, 'one two three four five six seven eight', { x: 240, y: 280 }, { x: 400, y: 340 })

  await expect(page.locator('[data-testid="sizing-auto-height"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(tspans(page)).not.toHaveCount(1)

  const width = await readField(page, 'W')
  const height = await readField(page, 'H')

  // Narrowing the box wraps harder and the height follows.
  await setField(page, 'W', Math.round(width / 2))
  expect(await readField(page, 'W')).toBeCloseTo(Math.round(width / 2), 0)
  expect(await readField(page, 'H')).toBeGreaterThan(height)
})

test('Fixed Size clips overflow and offers to fit it', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'one two three four five six seven eight nine ten', { x: 240, y: 260 }, { x: 380, y: 300 })

  await page.locator('[data-testid="sizing-fixed"]').click()
  await setField(page, 'H', 24)

  // Clipped, so the overflow is hidden rather than spilling out of the box.
  const clip = await nodesOfType(page, 'text').first().locator('[clip-path]').count()
  expect(clip).toBeGreaterThan(0)

  // The bottom handle turns red to say there is more text than box...
  const handle = page.locator('.resize-handle.overflowing')
  await expect(handle).toHaveCount(1)

  // ...and double-clicking it grows the box to hold everything.
  await handle.dblclick()
  expect(await readField(page, 'H')).toBeGreaterThan(24)
  await expect(page.locator('.resize-handle.overflowing')).toHaveCount(0)
})

test('switching to Auto Width unwraps text that was wrapping', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'alpha beta gamma delta', { x: 240, y: 280 }, { x: 330, y: 340 })
  await expect(tspans(page)).not.toHaveCount(1)

  await page.locator('[data-testid="sizing-auto-width"]').click()
  await expect(tspans(page)).toHaveCount(1)
})

// -------------------------------------------------------- spacing & transform --

test('paragraph spacing separates paragraphs without moving the first', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'first', { x: 260, y: 300 })
  // A second paragraph, typed as a real newline in the editor.
  await nodesOfType(page, 'text').first().dblclick({ force: true })
  await page.locator('[data-testid="text-editor"]').fill('first\nsecond')
  await page.keyboard.press('Escape')

  const baselines = async () =>
    (await tspans(page).evaluateAll((els) => els.map((e) => Number(e.getAttribute('y')))))

  const before = await baselines()
  expect(before).toHaveLength(2)

  await setField(page, '¶', 40)

  const after = await baselines()
  expect(after[0]).toBeCloseTo(before[0]!, 1)
  expect(after[1]! - before[1]!).toBeCloseTo(40, 1)
})

test('line height and letter spacing change the laid-out text', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'spacing\ntest', { x: 260, y: 300 })

  const gap = async () => {
    const ys = await tspans(page).evaluateAll((els) => els.map((e) => Number(e.getAttribute('y'))))
    return ys[1]! - ys[0]!
  }
  const before = await gap()
  await setField(page, 'LH', 3)
  expect(await gap()).toBeGreaterThan(before)

  const width = await readField(page, 'W')
  await setField(page, 'LS', 0.5)
  expect(await readField(page, 'W')).toBeGreaterThan(width)
})

test('text transformations change what is drawn and are reversible', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'hello brave world', { x: 260, y: 300 })

  const drawn = () => nodesOfType(page, 'text').first().locator('text')
  const transform = page.locator('select[title="Text transformation"]')

  await transform.selectOption('uppercase')
  await expect(drawn()).toHaveText('HELLO BRAVE WORLD')

  await transform.selectOption('titlecase')
  await expect(drawn()).toHaveText('Hello Brave World')

  // Back to None gives the typed text, because the transform never touched it.
  await transform.selectOption('none')
  await expect(drawn()).toHaveText('hello brave world')

  // Re-editing shows the original too, not the transformed rendering.
  await transform.selectOption('uppercase')
  await nodesOfType(page, 'text').first().dblclick({ force: true })
  await expect(page.locator('[data-testid="text-editor"]')).toHaveValue('hello brave world')
  await page.keyboard.press('Escape')
})

// ------------------------------------------------------------------ importing --

test('a text file can be imported into the selected text object', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'placeholder', { x: 260, y: 300 })

  const chooser = page.waitForEvent('filechooser')
  await page.locator('button[aria-label="Import text from a file…"]').click()
  await (await chooser).setFiles({
    name: 'copy.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Imported from a file.\nSecond line.\n'),
  })

  const drawn = nodesOfType(page, 'text').first().locator('text')
  await expect(drawn).toContainText('Imported from a file.')
  await expect(drawn).toContainText('Second line.')
  // Still one object: the file filled the selection rather than adding another.
  await expect(nodesOfType(page, 'text')).toHaveCount(1)
  // The trailing newline in the file is not an empty last line on the canvas.
  await expect(tspans(page)).toHaveCount(2)
})

test('the File menu imports text with nothing selected', async ({ page }) => {
  await openApp(page)
  // The Text panel only exists once a text object is selected, so importing a
  // file has to be reachable from the menu or the first one is unmakeable.
  const chooser = page.waitForEvent('filechooser')
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'Import Text' }).click()
  await (await chooser).setFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('one two three four five six seven eight nine ten eleven twelve thirteen'),
  })

  await expect(nodesOfType(page, 'text')).toHaveCount(1)
  // Area text, so a file's worth of copy wraps instead of running off-screen.
  await expect(page.locator('[data-testid="sizing-auto-height"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(tspans(page)).not.toHaveCount(1)
  // Named after the file, which is how you find it in the layer list.
  await expect(page.locator('.layer-row', { hasText: 'notes' })).toHaveCount(1)
})

test('dropping a text file on the canvas places it there', async ({ page }) => {
  await openApp(page)
  await dropFiles(
    page,
    [{ name: 'dropped.txt', type: 'text/plain', text: 'Dropped straight onto the canvas.' }],
    { x: 320, y: 300 },
  )
  await expect(nodesOfType(page, 'text')).toHaveCount(1)
  await expect(nodesOfType(page, 'text').locator('text')).toContainText('Dropped straight onto the canvas.')
})

// ---------------------------------------------------------------- spell check --

test('spell check underlines only the misspelled words', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'the quik brown fox jumpps over', { x: 240, y: 300 })

  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'Preferences' }).click()
  const prefs = page.locator('.dialog')
  await expect(prefs).toBeVisible()
  await prefs.locator('.checkbox-row', { hasText: 'Check spelling' }).locator('input').check()
  await prefs.locator('button', { hasText: 'Done' }).click()

  const underlines = nodesOfType(page, 'text').first().locator('.spell-underline')
  // "quik" and "jumpps" — and nothing under the four real words.
  await expect(underlines).toHaveCount(2, { timeout: 20000 })

  // Fixing the spelling removes the marks.
  await nodesOfType(page, 'text').first().dblclick({ force: true })
  await page.locator('[data-testid="text-editor"]').fill('the quick brown fox jumps over')
  await page.keyboard.press('Escape')
  await expect(underlines).toHaveCount(0)
})
