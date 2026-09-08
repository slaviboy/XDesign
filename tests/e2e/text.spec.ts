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
  captureDownload,
  clickCanvas,
  countRedPixels,
  dragOnCanvas,
  drawShape,
  dropFiles,
  nodesOfType,
  openApp,
  openExportDialog,
  press,
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

/** Turn spell check on from Preferences and wait for the dictionaries. */
async function enableSpellCheck(page: Page): Promise<void> {
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('.menu-item', { hasText: 'Preferences' }).click()
  const prefs = page.locator('.dialog')
  await prefs.locator('.checkbox-row', { hasText: 'Check spelling' }).locator('input').check()
  await prefs.locator('button', { hasText: 'Done' }).click()
  await expect(page.locator('.spell-underline').first()).toBeVisible({ timeout: 20000 })
}

/** Export the document as SVG through the real dialog. */
async function exportSvg(page: Page): Promise<void> {
  await openExportDialog(page)
  await page
    .locator('[role="dialog"] .dialog-row', { hasText: 'Format' })
    .locator('select')
    .selectOption('svg')
  await page.locator('button:text-is("Export")').click()
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

// ------------------------------------------------------------------ editing --

test('the text being edited is drawn once, by the editor', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'Text', { x: 260, y: 300 })

  // Not editing: the document draws it.
  await expect(nodesOfType(page, 'text').locator('text')).toHaveCount(1)

  await nodesOfType(page, 'text').first().dblclick({ force: true })
  await expect(page.locator('[data-testid="text-editor"]')).toBeVisible()
  // Editing: the textarea is the rendering, and the glyphs behind it are gone.
  // Drawing both shows two sets of letters at once — they cannot line up,
  // because a textarea centres its text in a CSS line box and SVG sits it on a
  // baseline.
  await expect(nodesOfType(page, 'text').locator('text')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(nodesOfType(page, 'text').locator('text')).toHaveCount(1)
})

test('the editor wraps exactly where the drawn text will', async ({ page }) => {
  await openApp(page)
  const long = 'The quick brown fox jumps over the lazy dog and keeps on going'
  await makeText(page, long, { x: 240, y: 260 }, { x: 420, y: 330 })

  await nodesOfType(page, 'text').first().dblclick({ force: true })
  const overflow = () =>
    page.locator('[data-testid="text-editor"]').evaluate((el) => {
      const ta = el as HTMLTextAreaElement
      return { h: ta.scrollWidth - ta.clientWidth, v: ta.scrollHeight - ta.clientHeight }
    })

  // Auto Height: the editor wraps, so it never scrolls sideways. With no
  // wrapping it would, and the text under the caret would sit at a horizontal
  // offset from where it is going to be drawn.
  expect((await overflow()).h).toBe(0)
  expect((await overflow()).v).toBe(0)
  await page.keyboard.press('Escape')

  // Auto Width: one line, and the box is the line, so still no scrolling.
  await page.locator('[data-testid="sizing-auto-width"]').click()
  await nodesOfType(page, 'text').first().dblclick({ force: true })
  expect((await overflow()).h).toBe(0)
  await page.keyboard.press('Escape')
})

test('a transformation is visible while editing, without changing the text', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'hello world', { x: 260, y: 300 })
  await page.locator('select[title="Text transformation"]').selectOption('uppercase')

  await nodesOfType(page, 'text').first().dblclick({ force: true })
  const editor = page.locator('[data-testid="text-editor"]')
  // Shown transformed...
  await expect(editor).toHaveCSS('text-transform', 'uppercase')
  // ...but holding what was typed, which is why None can give it back.
  await expect(editor).toHaveValue('hello world')
  await page.keyboard.press('Escape')
})

// ------------------------------------------------------- clipping & export --

test('Fixed Size crops the spell marks with the text they mark', async ({ page }) => {
  await openApp(page)
  // Several misspellings spread down a tall block, then cropped to one line.
  await makeText(
    page,
    'wrng speling here\nannother baad line\nthird wrng line',
    { x: 240, y: 260 },
    { x: 500, y: 400 },
  )
  await enableSpellCheck(page)
  await expect(nodesOfType(page, 'text').first().locator('.spell-underline')).not.toHaveCount(0)

  await page.locator('[data-testid="sizing-fixed"]').click()
  await setField(page, 'H', 34)

  // The selection frame is chrome, so it reports the box itself rather than
  // whatever the text spills past it.
  const frame = (await page.locator('.selection-frame').boundingBox())!
  // Deselect, so the frame's own blue is not in the sample.
  await clickCanvas(page, { x: 60, y: 500 })

  // Asserted on the pixels, because a clipped SVG element still reports its
  // full geometry and still answers isVisible() — "this mark is not drawn" is
  // a claim only the screen can settle.
  const below = { x: frame.x, y: frame.y + frame.height + 3, width: frame.width, height: 80 }
  // A red wave under blank canvas reports an error in text the user cannot
  // see, let alone correct. The marks belong to words the box cropped away, so
  // they go with them.
  expect(countRedPixels(await page.screenshot({ clip: below }))).toBe(0)
})

test('exported text wraps and crops exactly as the canvas does', async ({ page }) => {
  await openApp(page)
  const copy = 'one two three four five six seven eight nine ten eleven twelve'
  await makeText(page, copy, { x: 240, y: 260 }, { x: 400, y: 340 })

  const linesOnCanvas = await tspans(page).count()
  expect(linesOnCanvas).toBeGreaterThan(1)

  const auto = await captureDownload(page, () => exportSvg(page))
  const autoSvg = auto.buffer.toString('utf8')
  // Auto Height wraps in the file too — not one very long line.
  expect((autoSvg.match(/<tspan/g) ?? []).length).toBe(linesOnCanvas)
  expect(autoSvg).not.toContain('clip-path')

  // Fixed Size crops, so the file has to carry the crop or it shows text the
  // canvas deliberately hid.
  await page.locator('[data-testid="sizing-fixed"]').click()
  await setField(page, 'H', 30)
  const fixed = await captureDownload(page, () => exportSvg(page))
  const fixedSvg = fixed.buffer.toString('utf8')
  expect(fixedSvg).toContain('<clipPath')
  expect(fixedSvg).toMatch(/<text[^>]*clip-path="url\(#textclip-/)
})

// ----------------------------------------------------------- handle resizes --

/** Drag a named selection handle by a screen-space offset. */
async function dragHandle(
  page: Page,
  handle: string,
  dx: number,
  dy: number,
): Promise<void> {
  const h = (await page.locator(`[data-handle="${handle}"]`).boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2 + dy, { steps: 10 })
  await page.mouse.up()
}

/** The text's own extent, which is what has to stay inside the box. */
async function textExtent(page: Page): Promise<{ width: number; height: number }> {
  return nodesOfType(page, 'text')
    .first()
    .locator('text')
    .evaluate((el) => {
      const b = (el as SVGGraphicsElement).getBBox()
      return { width: b.width, height: b.height }
    })
}

test('narrowing an Auto Height box rewraps it and takes the height with it', async ({ page }) => {
  await openApp(page)
  await makeText(
    page,
    'Neither of the usual handles can see a clip: a clipped SVG element still reports its full geometry and still answers isVisible.',
    { x: 240, y: 240 },
    { x: 500, y: 330 },
  )

  await dragHandle(page, 'e', -80, 0)

  // Still Auto Height — a width is the one thing this mode already owned.
  await expect(page.locator('[data-testid="sizing-auto-height"]')).toHaveAttribute('aria-pressed', 'true')
  // And the height followed the new wrap, instead of leaving the last lines
  // hanging below the box.
  const stored = await readField(page, 'H')
  const { height } = await textExtent(page)
  expect(stored).toBeGreaterThanOrEqual(height - 1)
})

test('giving Auto Width text a width turns it into Auto Height', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'Hello brave new world of wrapping text', { x: 220, y: 260 })
  await expect(tspans(page)).toHaveCount(1)

  // Dragging a side handle is how you say "this wide" — which is what Auto
  // Height means. Enforcing Auto Width instead would spring the box back to
  // the width of its text and the handle would look broken.
  await dragHandle(page, 'e', -120, 0)

  await expect(page.locator('[data-testid="sizing-auto-height"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(tspans(page)).not.toHaveCount(1)
  const { width } = await textExtent(page)
  expect(width).toBeLessThanOrEqual((await readField(page, 'W')) + 1)
})

test('giving a text box a height turns it into Fixed Size', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'one two three four five six seven', { x: 240, y: 240 }, { x: 440, y: 320 })

  await dragHandle(page, 's', 0, 40)

  // A height is the dimension only Fixed Size owns, so that is what it becomes
  // — shown in the control, not applied silently.
  await expect(page.locator('[data-testid="sizing-fixed"]')).toHaveAttribute('aria-pressed', 'true')
})

test('a text resize is one undo step, mode included', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'Hello brave new world of wrapping text', { x: 220, y: 260 })
  const width = await readField(page, 'W')

  await dragHandle(page, 'e', -120, 0)
  await expect(page.locator('[data-testid="sizing-auto-height"]')).toHaveAttribute('aria-pressed', 'true')

  await press(page, 'z')

  // One press puts back both the size and the mode: the resize and the mode it
  // implied were one transaction, not a resize followed by a style change.
  expect(await readField(page, 'W')).toBeCloseTo(width, 0)
  await expect(page.locator('[data-testid="sizing-auto-width"]')).toHaveAttribute('aria-pressed', 'true')
})

// ------------------------------------------------------------ live resizing --

/**
 * Drag a handle, sampling something on every step and once after release.
 *
 * The point of the sampling is the last comparison: whatever the box shows on
 * the final move has to be what it shows after the pointer comes up. Anything
 * computed only at commit shows as a jump right there.
 */
async function sampleDuringDrag<T>(
  page: Page,
  handle: string,
  steps: Array<{ dx: number; dy: number }>,
  read: () => Promise<T>,
): Promise<{ during: T[]; after: T }> {
  const h = (await page.locator(`[data-handle="${handle}"]`).boundingBox())!
  const cx = h.x + h.width / 2
  const cy = h.y + h.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const during: T[] = []
  for (const step of steps) {
    await page.mouse.move(cx + step.dx, cy + step.dy, { steps: 4 })
    await page.waitForTimeout(120)
    during.push(await read())
  }
  await page.mouse.up()
  await page.waitForTimeout(250)
  return { during, after: await read() }
}

const frameHeight = (page: Page) => async () =>
  Math.round((await page.locator('.selection-frame').boundingBox())!.height)

test('an Auto Height box grows under the pointer, not on release', async ({ page }) => {
  await openApp(page)
  await makeText(
    page,
    'Neither of the usual handles can see a clip: a clipped SVG element still reports its full geometry and answers isVisible.',
    { x: 240, y: 240 },
    { x: 520, y: 320 },
  )

  const { during, after } = await sampleDuringDrag(
    page,
    'e',
    [{ dx: -40, dy: 0 }, { dx: -80, dy: 0 }, { dx: -120, dy: 0 }],
    frameHeight(page),
  )

  // It got taller while the pointer was down...
  expect(during[during.length - 1]).toBeGreaterThan(during[0]!)
  // ...and letting go changed nothing, which is the whole claim.
  expect(after).toBe(during[during.length - 1])
})

test('Auto Width text rewraps under the pointer as it is given a width', async ({ page }) => {
  await openApp(page)
  await makeText(page, 'Hello brave new world of wrapping text here', { x: 200, y: 250 })
  await expect(tspans(page)).toHaveCount(1)

  const { during, after } = await sampleDuringDrag(
    page,
    'e',
    [{ dx: -60, dy: 0 }, { dx: -120, dy: 0 }, { dx: -180, dy: 0 }],
    async () => tspans(page).count(),
  )

  // The box is becoming Auto Height, so it has to start wrapping now — not
  // stay one long line and break into four the moment the pointer comes up.
  expect(during[0]).toBeGreaterThan(1)
  expect(during[during.length - 1]).toBeGreaterThan(during[0]!)
  expect(after).toBe(during[during.length - 1])
})

test('a Fixed Size box uncrops under the pointer', async ({ page }) => {
  await openApp(page)
  await makeText(
    page,
    'one two three four five six seven eight nine ten eleven twelve',
    { x: 240, y: 240 },
    { x: 480, y: 300 },
  )
  await page.locator('[data-testid="sizing-fixed"]').click()
  await setField(page, 'H', 30)

  const clipHeight = async () =>
    nodesOfType(page, 'text')
      .first()
      .evaluate((g) => Number(g.querySelector('clipPath rect')?.getAttribute('height') ?? -1))

  const { during, after } = await sampleDuringDrag(
    page,
    's',
    [{ dx: 0, dy: 40 }, { dx: 0, dy: 90 }],
    clipHeight,
  )

  // The crop is what makes Fixed Size Fixed Size, so it has to track the drag —
  // otherwise the text stays cropped at the old height and appears all at once
  // on release.
  expect(during[0]).toBeGreaterThan(30)
  expect(during[1]).toBeGreaterThan(during[0]!)
  expect(after).toBe(during[1])
})

// ------------------------------------------------------------------- fonts --

/** The box the inspector reports, and what the drawn text actually needs. */
async function boxAndText(page: Page) {
  const text = await nodesOfType(page, 'text')
    .first()
    .locator('text')
    .evaluate((el) => {
      const b = (el as SVGGraphicsElement).getBBox()
      return { width: b.width, height: b.height }
    })
  return { box: { width: await readField(page, 'W'), height: await readField(page, 'H') }, text }
}

test('a font change keeps the text inside its box, on the click', async ({ page }) => {
  await openApp(page)
  await makeText(
    page,
    'The obvious fix is wrong for Auto Width: the box would spring back to the width of its own text and the handle would look broken.',
    { x: 240, y: 200 },
    { x: 480, y: 300 },
  )
  const section = page.locator('.section', { hasText: 'TEXT' })

  // Each of these needs a face the browser has never drawn. Measured against a
  // face that has not arrived, the wrap comes out packed too full — and then
  // the real glyphs land wider than the box they were fitted to. Asserted with
  // no settling time at all, because "it fixes itself a moment later" is the
  // other half of what was wrong.
  const changes: Array<[string, () => Promise<unknown>]> = [
    ['bold', () => section.locator('select').nth(1).selectOption('700')],
    ['thin', () => section.locator('select').nth(1).selectOption('300')],
    ['italic', () => page.locator('button[title="Italic"]').click()],
    ['another family', () => section.locator('select').first().selectOption('Playfair Display')],
  ]

  for (const [label, change] of changes) {
    await change()
    const { box, text } = await boxAndText(page)
    expect(text.width, `${label}: wider than its box`).toBeLessThanOrEqual(box.width + 1)
    expect(text.height, `${label}: taller than its box`).toBeLessThanOrEqual(box.height + 1)
  }
})

test('the Text panel loads the faces its own controls offer', async ({ page }) => {
  await openApp(page)

  // FontFace.status, not fonts.check() — check() answers "would this render",
  // which is true for a declared face nobody has fetched.
  const loadedFaces = () =>
    page.evaluate(() =>
      [...document.fonts].filter((f) => f.family === 'Inter' && f.status === 'loaded').length,
    )
  const declaredFaces = await page.evaluate(
    () => [...document.fonts].filter((f) => f.family === 'Inter').length,
  )
  expect(declaredFaces).toBeGreaterThan(4)
  // The app has drawn its own chrome, but nothing like every weight.
  expect(await loadedFaces()).toBeLessThan(declaredFaces)

  await makeText(page, 'Hello', { x: 300, y: 300 })

  // Selecting text opens the panel, and the panel asks for every face it can
  // switch to — a whole family costs a few milliseconds from local files, and
  // it is what makes Bold take effect on the click rather than a beat later.
  await expect.poll(loadedFaces, { timeout: 5000 }).toBe(declaredFaces)
})
