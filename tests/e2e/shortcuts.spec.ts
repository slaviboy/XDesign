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
 * Changing a shortcut, and taking your settings to another machine.
 *
 * Recording a chord is the part only a browser can prove: the editor has to
 * swallow key events that the application itself binds, show what is held
 * before a chord exists, and commit when the keys come back up. And a rebound
 * shortcut has to actually do the thing — a dialog that records a chord nobody
 * dispatches would pass every unit test there is.
 */

import { test, expect } from '@playwright/test'
import { CANVAS, drawShape, modifier, nodesOfType, openApp } from './helpers'

const MOD = modifier()

async function openShortcuts(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-shortcuts"]').click()
  await expect(page.locator('.shortcut-grid')).toBeVisible()
}

/** A row's keys button, found by the aria-label that names its command. */
function shortcutButton(page: import('@playwright/test').Page, label: string) {
  return page.locator(`.kbd-button[aria-label^="${label}:"]`)
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
})

test('double-clicking a shortcut records a new one', async ({ page }) => {
  await openShortcuts(page)
  const save = shortcutButton(page, 'Save')
  await expect(save).toHaveText(MOD === 'Meta' ? '⌘S' : 'Ctrl+S')

  await save.dblclick()
  await expect(save).toHaveClass(/recording/)

  // Holding a modifier shows progress before any chord exists.
  await page.keyboard.down('Shift')
  await expect(save).toHaveText(/⇧|Shift/)

  await page.keyboard.down('K')
  await expect(save).toHaveText(/K$/)

  // Committed on release, and marked as changed.
  await page.keyboard.up('K')
  await page.keyboard.up('Shift')
  await expect(save).not.toHaveClass(/recording/)
  await expect(save).toHaveText(MOD === 'Meta' ? '⇧K' : 'Shift+K')
  await expect(page.locator('.shortcut-reset').first()).toBeVisible()
})

test('a reset puts one shortcut back and leaves the others alone', async ({ page }) => {
  await openShortcuts(page)
  const save = shortcutButton(page, 'Save')
  const open = shortcutButton(page, 'Open…')

  await save.dblclick()
  await page.keyboard.press('K')
  await expect(save).toHaveText('K')

  await open.dblclick()
  await page.keyboard.press('J')
  await expect(open).toHaveText('J')

  // The row's own reset, not the global one.
  await page.locator('.shortcut-keys', { has: save }).locator('.shortcut-reset').click()
  await expect(save).toHaveText(MOD === 'Meta' ? '⌘S' : 'Ctrl+S')
  await expect(open).toHaveText('J')
})

test('Reset All puts every shortcut back', async ({ page }) => {
  await openShortcuts(page)
  const resetAll = page.locator('.shortcut-footer-row .button')
  await expect(resetAll).toBeDisabled()

  const save = shortcutButton(page, 'Save')
  await save.dblclick()
  await page.keyboard.press('K')
  await expect(save).toHaveText('K')
  await expect(resetAll).toBeEnabled()

  await resetAll.click()
  await expect(save).toHaveText(MOD === 'Meta' ? '⌘S' : 'Ctrl+S')
  await expect(resetAll).toBeDisabled()
  await expect(page.locator('.shortcut-reset')).toHaveCount(0)
})

test('Escape leaves recording without binding anything', async ({ page }) => {
  await openShortcuts(page)
  const save = shortcutButton(page, 'Save')
  await save.dblclick()
  await expect(save).toHaveClass(/recording/)

  await page.keyboard.press('Escape')
  await expect(save).not.toHaveClass(/recording/)
  await expect(save).toHaveText(MOD === 'Meta' ? '⌘S' : 'Ctrl+S')
  // And the dialog is still open: Escape cancelled the recording, not the dialog.
  await expect(page.locator('.shortcut-grid')).toBeVisible()
})

test('taking a chord from another command says so and leaves it unbound', async ({ page }) => {
  await openShortcuts(page)
  const open = shortcutButton(page, 'Open…')

  await open.dblclick()
  await page.keyboard.down(MOD)
  await page.keyboard.down('S')
  await page.keyboard.up('S')
  await page.keyboard.up(MOD)

  await expect(page.locator('.shortcut-message')).toContainText('Save')
  await expect(shortcutButton(page, 'Save')).toHaveText('None')
})

test('a rebound shortcut is the one that fires', async ({ page }) => {
  await drawShape(page, 'rect', { x: 120, y: 120 }, { x: 220, y: 200 })
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)

  await openShortcuts(page)
  const duplicate = shortcutButton(page, 'Duplicate')
  await duplicate.dblclick()
  await page.keyboard.down(MOD)
  await page.keyboard.down('K')
  await page.keyboard.up('K')
  await page.keyboard.up(MOD)
  await expect(duplicate).toHaveText(MOD === 'Meta' ? '⌘K' : 'Ctrl+K')

  await page.locator('.dialog-footer .button.primary').click()
  await page.locator(CANVAS).click({ position: { x: 170, y: 160 } })

  // The new chord duplicates...
  await page.keyboard.press(`${MOD}+k`)
  await expect(nodesOfType(page, 'rect')).toHaveCount(2)
  // ...and the old one no longer does.
  await page.keyboard.press(`${MOD}+d`)
  await expect(nodesOfType(page, 'rect')).toHaveCount(2)
})

test('the menu shows the shortcut it is actually bound to', async ({ page }) => {
  await openShortcuts(page)
  const save = shortcutButton(page, 'Save')
  await save.dblclick()
  await page.keyboard.down(MOD)
  await page.keyboard.down('K')
  await page.keyboard.up('K')
  await page.keyboard.up(MOD)
  await page.locator('.dialog-footer .button.primary').click()

  await page.locator('[data-testid="app-menu"]').click()
  const item = page.locator('.menu-item', { hasText: 'Save' }).first()
  await expect(item).toContainText(MOD === 'Meta' ? '⌘K' : 'Ctrl+K')
})

test('preferences export and import move settings between machines', async ({ page }) => {
  // Change something that survives a reload and is visible without a document.
  await openShortcuts(page)
  const save = shortcutButton(page, 'Save')
  await save.dblclick()
  await page.keyboard.press('K')
  await expect(save).toHaveText('K')
  await page.locator('.dialog-footer .button.primary').click()

  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-export-prefs"]').click()

  // Every section is offered, ticked, and says what it holds.
  const rows = page.locator('.prefs-transfer-list .prefs-transfer-row')
  await expect(rows).toHaveCount(7)
  await expect(rows.filter({ hasText: 'Keyboard Shortcuts' })).toContainText('1 of')

  const download = page.waitForEvent('download')
  await page.locator('.dialog-footer .button.primary').click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.xprefs$/)

  const body = await file.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')

  const parsed = JSON.parse(text)
  expect(parsed.format).toBe('xdesign-preferences')
  // Stored platform-neutrally, so the file works on the other kind of machine.
  expect(parsed.shortcuts['file.save']).toBe('K')
  expect(text).not.toContain('⌘')

  // Now put it back on a "different machine": reset, then import the file.
  await openShortcuts(page)
  await page.locator('.shortcut-footer-row .button').click()
  await expect(shortcutButton(page, 'Save')).toHaveText(MOD === 'Meta' ? '⌘S' : 'Ctrl+S')
  await page.locator('.dialog-footer .button.primary').click()

  const chooser = page.waitForEvent('filechooser')
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-import-prefs"]').click()
  await (await chooser).setFiles({ name: 'prefs.xprefs', mimeType: 'application/json', buffer: Buffer.from(text) })

  await expect(page.locator('.prefs-transfer-list .prefs-transfer-row')).toHaveCount(7)
  await page.locator('.dialog-footer .button.primary').click()

  await expect(page.locator('.notification').last()).toContainText('shortcuts')
  await openShortcuts(page)
  await expect(shortcutButton(page, 'Save')).toHaveText('K')
})

test('export writes only the sections that are ticked', async ({ page }) => {
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-export-prefs"]').click()

  // Untick everything, then take one section back.
  await page.locator('.prefs-transfer-all input').click()
  await expect(page.locator('.dialog-footer .button.primary')).toBeDisabled()

  await page.locator('.prefs-transfer-list .prefs-transfer-row', { hasText: 'Theme' }).locator('input').check()
  const download = page.waitForEvent('download')
  await page.locator('.dialog-footer .button.primary').click()

  const body = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(chunk as Buffer)
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))

  expect(parsed.theme).toBeDefined()
  expect(parsed.language).toBeUndefined()
  expect(parsed.shortcuts).toBeUndefined()
  expect(parsed.canvas).toBeUndefined()
})

test('import applies only the sections that are ticked', async ({ page }) => {
  const source = JSON.stringify({
    format: 'xdesign-preferences',
    version: 1,
    theme: 'dark',
    shortcuts: { 'file.save': 'Mod+K' },
  })

  const chooser = page.waitForEvent('filechooser')
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-import-prefs"]').click()
  await (await chooser).setFiles({ name: 'two.xprefs', mimeType: 'application/json', buffer: Buffer.from(source) })

  // Only the two sections the file actually holds are offered.
  const rows = page.locator('.prefs-transfer-list .prefs-transfer-row')
  await expect(rows).toHaveCount(2)

  // Take the shortcut but not the theme.
  await rows.filter({ hasText: 'Theme' }).locator('input').uncheck()
  await page.locator('.dialog-footer .button.primary').click()

  await expect(page.locator('.notification').last()).toContainText('shortcuts')
  await expect(page.locator('.notification').last()).not.toContainText('theme')
  await openShortcuts(page)
  await expect(shortcutButton(page, 'Save')).toHaveText(MOD === 'Meta' ? '⌘K' : 'Ctrl+K')
})

test('Cancel leaves everything as it was', async ({ page }) => {
  const source = JSON.stringify({
    format: 'xdesign-preferences',
    version: 1,
    shortcuts: { 'file.save': 'Mod+K' },
  })

  const chooser = page.waitForEvent('filechooser')
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-import-prefs"]').click()
  await (await chooser).setFiles({ name: 'one.xprefs', mimeType: 'application/json', buffer: Buffer.from(source) })

  await expect(page.locator('.prefs-transfer-list')).toBeVisible()
  await page.locator('.dialog-footer .button', { hasText: 'Cancel' }).click()

  await expect(page.locator('.prefs-transfer-list')).toHaveCount(0)
  await openShortcuts(page)
  await expect(shortcutButton(page, 'Save')).toHaveText(MOD === 'Meta' ? '⌘S' : 'Ctrl+S')
})

test('a corrupt preferences file is refused, not half-applied', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser')
  await page.locator('[data-testid="app-menu"]').click()
  await page.locator('[data-testid="menu-import-prefs"]').click()
  await (await chooser).setFiles({
    name: 'broken.xprefs',
    mimeType: 'application/json',
    buffer: Buffer.from('{ not json'),
  })

  await expect(page.locator('.notification').last()).toContainText('not valid JSON')
})
