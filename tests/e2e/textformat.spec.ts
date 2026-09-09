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
 * Formatting a selection of characters, in a real browser.
 *
 * The whole feature is a conversation between two panels — select a word on the
 * canvas, reach for a control in the inspector — and the thing that makes it
 * hard is that clicking the inspector blurs the textarea holding the selection.
 * Only a browser can prove that survives.
 */

import { test, expect } from '@playwright/test'
import { CANVAS, clickCanvas, inspectorField, nodesOfType, openApp, selectTool } from './helpers'

/** Put a text object on the canvas and leave it in editing mode. */
async function typeText(page: import('@playwright/test').Page, text: string) {
  await selectTool(page, 'text')
  await clickCanvas(page, { x: 200, y: 200 })
  await page.keyboard.type(text)
  await expect(page.locator('[data-testid="text-editor"]')).toBeVisible()
}

/** Select characters [from, to) inside the text being edited. */
async function selectRange(page: import('@playwright/test').Page, from: number, to: number) {
  await page.locator('[data-testid="text-editor"]').evaluate(
    (el, { from, to }) => {
      const area = el as HTMLTextAreaElement
      area.focus()
      area.setSelectionRange(from, to)
      area.dispatchEvent(new Event('select', { bubbles: true }))
    },
    { from, to },
  )
}

/** The Text section's weight dropdown. */
function weightSelect(page: import('@playwright/test').Page) {
  return page.locator('select[title="Weight"]')
}

/**
 * Set the weight of whatever the inspector is currently describing.
 *
 * The explicit focus() matters: selectOption sets the value without moving
 * focus, where a real click would — and moving focus off the textarea is half
 * of what is being tested, since that is when the canvas takes the rendering
 * back.
 */
async function setWeight(page: import('@playwright/test').Page, weight: string) {
  await weightSelect(page).focus()
  await weightSelect(page).selectOption(weight)
}

/** Every tspan the canvas drew for the one text node, with its weight. */
async function drawnWeights(page: import('@playwright/test').Page) {
  return page.locator('.document-layer [data-node-type="text"] tspan').evaluateAll((nodes) =>
    nodes.map((n) => ({
      text: n.textContent,
      weight: getComputedStyle(n).fontWeight,
    })),
  )
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('the inspector says when it is formatting a selection, not the object', async ({ page }) => {
  await typeText(page, 'You can adjust the text')
  await expect(page.locator('.text-range-note')).toHaveCount(0)

  await selectRange(page, 0, 3)
  await expect(page.locator('.text-range-note')).toContainText('3 characters')

  // A caret is not a selection: there is nothing to format.
  await selectRange(page, 3, 3)
  await expect(page.locator('.text-range-note')).toHaveCount(0)
})

test('formatting reaches the selected characters and no others', async ({ page }) => {
  await typeText(page, 'You can adjust')
  await selectRange(page, 0, 3)

  // Clicking the inspector blurs the textarea. If that ended the edit, or lost
  // the selection, this would format the whole object or nothing at all.
  await setWeight(page, '700')

  const drawn = await drawnWeights(page)
  const bold = drawn.filter((d) => d.weight === '700')
  expect(bold.map((d) => d.text).join('')).toBe('You')
  expect(drawn.filter((d) => d.weight !== '700').map((d) => d.text).join('')).toBe(' can adjust')
})

test('the canvas shows the formatting while the inspector has focus', async ({ page }) => {
  await typeText(page, 'You can adjust')
  await selectRange(page, 0, 3)
  // While typing, the textarea is the rendering and the canvas draws nothing.
  await expect(page.locator('.document-layer [data-node-type="text"] tspan')).toHaveCount(0)

  await setWeight(page, '700')
  // Focus is in the inspector now, so the canvas takes over and shows the
  // mixed styling a textarea cannot draw.
  await expect(page.locator('.document-layer [data-node-type="text"] tspan')).not.toHaveCount(0)
  // The editor is still there and still clickable — it has simply stopped
  // drawing, so clicking the text hands editing straight back to it.
  await expect(page.locator('[data-testid="text-editor"]')).toHaveCSS('color', 'rgba(0, 0, 0, 0)')
})

test('the size field applies to the selection alone', async ({ page }) => {
  await typeText(page, 'You can adjust')
  await selectRange(page, 4, 7)

  const size = inspectorField(page, 'Size')
  await size.focus()
  await size.fill('40')
  await size.press('Enter')

  const sizes = await page.locator('.document-layer [data-node-type="text"] tspan').evaluateAll(
    (nodes) => nodes.map((n) => ({ text: n.textContent, size: getComputedStyle(n).fontSize })),
  )
  const big = sizes.filter((s) => s.size === '40px')
  expect(big.map((s) => s.text).join('')).toBe('can')
})

test('the inspector reads the selection back, and reports a mixture as one', async ({ page }) => {
  await typeText(page, 'You can adjust')
  await selectRange(page, 0, 3)
  await setWeight(page, '700')

  // Re-select the bold word: the dropdown reflects it.
  await selectRange(page, 0, 3)
  await expect(weightSelect(page)).toHaveValue('700')

  // A range spanning bold and plain agrees on nothing, so nothing is claimed.
  await selectRange(page, 0, 10)
  // A native select cannot show "no answer", so it says so explicitly rather
  // than displaying the first option as though it were the value.
  await expect(weightSelect(page).locator('option:checked')).toHaveText('Mixed')
})

test('Clear takes the formatting off the selection', async ({ page }) => {
  await typeText(page, 'You can adjust')
  await selectRange(page, 0, 3)
  await setWeight(page, '700')
  expect((await drawnWeights(page)).some((d) => d.weight === '700')).toBe(true)

  await selectRange(page, 0, 3)
  await page.locator('.text-range-note .link-button').click()
  expect((await drawnWeights(page)).some((d) => d.weight === '700')).toBe(false)
})

test('alignment still applies to the whole object while a range is selected', async ({ page }) => {
  await typeText(page, 'You can adjust')
  await selectRange(page, 0, 3)
  const textSection = page.locator('.section', { hasText: 'Text' })
  await textSection.getByRole('button', { name: 'Align center' }).click()

  // A block property, so it landed on the object. With a range selected the
  // controls read back through the range, and alignment reads the object's —
  // which is the same value, because a run cannot carry one.
  await expect(textSection.getByRole('button', { name: 'Align center' })).toHaveAttribute('aria-pressed', 'true')
  await expect(textSection.getByRole('button', { name: 'Align left' })).toHaveAttribute('aria-pressed', 'false')

  // And it applies to every line, not to the three selected characters: the
  // whole object is centred, so a second selection elsewhere reads it too.
  await selectRange(page, 8, 14)
  await expect(textSection.getByRole('button', { name: 'Align center' })).toHaveAttribute('aria-pressed', 'true')
})

test('one undo takes the formatting back off', async ({ page }) => {
  await typeText(page, 'You can adjust')
  await selectRange(page, 0, 3)
  await setWeight(page, '700')
  expect((await drawnWeights(page)).some((d) => d.weight === '700')).toBe(true)

  await page.locator(CANVAS).click({ position: { x: 500, y: 400 } })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(nodesOfType(page, 'text')).toHaveCount(1)
  expect((await drawnWeights(page)).some((d) => d.weight === '700')).toBe(false)
})
