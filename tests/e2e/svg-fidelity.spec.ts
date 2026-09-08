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
 * SVG structural fidelity, against a real Adobe XD export.
 *
 * This has to be an e2e test rather than a unit test: DOMPurify reports
 * isSupported === false under happy-dom and passes its input straight through,
 * so the sanitizer — and therefore the whole import path it gates — only
 * behaves like itself in real Chromium.
 *
 * What is being guarded: the reference file wraps every one of its elements in
 * one `<g clip-path="url(#…)">`. That single attribute used to collapse the
 * entire document into one opaque preserved-markup node — no groups, no layers,
 * nothing editable, and no warning that it had happened.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import {
  CANVAS, captureDownload, dropFiles, nodesOfType, openApp, openExportDialog, selectAll,
} from './helpers'

const FIXTURE = fileURLToPath(new URL('../fixtures/android-mobile-2.svg', import.meta.url))
const REFERENCE = readFileSync(FIXTURE, 'utf8')

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await dropFiles(
    page,
    [{ name: 'android-mobile-2.svg', type: 'image/svg+xml', text: REFERENCE }],
    { x: 600, y: 400 },
  )
})

test('imports as an editable tree, not one opaque object', async ({ page }) => {
  // The headline assertion. A preservation node means something collapsed.
  await expect(nodesOfType(page, 'svg')).toHaveCount(0)

  await expect(nodesOfType(page, 'group').first()).toBeVisible()
  expect(await nodesOfType(page, 'rect').count()).toBeGreaterThan(15)
  expect(await nodesOfType(page, 'path').count()).toBeGreaterThan(10)
  expect(await nodesOfType(page, 'ellipse').count()).toBeGreaterThan(2)
  expect(await nodesOfType(page, 'text').count()).toBeGreaterThan(2)
})

test('keeps groups nested rather than flattening them', async ({ page }) => {
  // The file is a clipped root group holding named groups holding shapes.
  // Flattening — or collapsing to one preserved node — gives zero of these.
  const nested = page.locator(
    '.document-layer [data-node-type="group"] [data-node-type="group"]',
  )
  expect(await nested.count()).toBeGreaterThan(5)

  // And the leaves really are inside their group, not re-parented to the root.
  const inGroup = page.locator(
    '.document-layer [data-node-type="group"] [data-node-type="group"] [data-node-type="path"]',
  )
  expect(await inGroup.count()).toBeGreaterThan(5)
})

test('the clip survives as a real mask rather than being dropped', async ({ page }) => {
  // The clip is materialized into a <clipPath> the renderer emits, and the
  // group that carries it references it.
  const clipped = page.locator('.document-layer g[clip-path^="url(#mask-clip-"]')
  expect(await clipped.count()).toBeGreaterThan(0)
})

test('layer names come from data-name', async ({ page }) => {
  const names = await page.locator('.layer-row').allInnerTexts()
  const joined = names.join('\n')
  // "Rectangle 30" (data-name), not "Rectangle_30" (id).
  expect(joined).toContain('Group 32')
  expect(joined).not.toContain('Group_32')
})

test('gradients import as editable gradient paints, not flat colour', async ({ page }) => {
  const grads = page.locator('.document-layer linearGradient')
  expect(await grads.count()).toBeGreaterThan(5)
})

test('the pattern reference resolves instead of dangling', async ({ page }) => {
  // The file's <pattern> is empty and referenced by one rect's fill. It must
  // survive as a document-level def, and the rect must still point at it.
  const patternDef = page.locator('.document-layer > defs pattern')
  await expect(patternDef).toHaveCount(1)

  const fills = await page.locator('.document-layer path[fill^="url(#"]').count()
  expect(fills).toBeGreaterThan(0)
})

test('nothing is reported as lost', async ({ page }) => {
  // The catch-all "could not be fully edited" warning means a subtree was
  // preserved as markup. Nothing in this file should trigger it.
  const warning = page.locator('.notification', { hasText: /could not be fully edited/ })
  await expect(warning).toHaveCount(0)
})

test('exports back to SVG as vector, with its clip and gradients intact', async ({ page }) => {
  await page.locator(CANVAS).click({ position: { x: 5, y: 5 } })
  await selectAll(page)

  const out = await captureDownload(page, async () => {
    await openExportDialog(page)
    await page
      .locator('[role="dialog"] .dialog-row', { hasText: 'Format' })
      .locator('select')
      .selectOption('svg')
    await page.locator('button:text-is("Export")').click()
  })
  const svg = out.buffer.toString('utf8')

  // Still vector, and the constructs that were imported come back out.
  expect(svg).not.toContain('data:image/png')
  expect(svg).toContain('linearGradient')
  expect(svg).toContain('<clipPath')
  // The empty <pattern> the artwork references travels with the export rather
  // than leaving a dangling url(#…).
  expect(svg).toContain('<pattern')

  // Every url(#id) the file emits must resolve to an id the file also defines.
  const defined = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
  const referenced = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
  expect(referenced.filter((id) => !defined.has(id!))).toEqual([])
})
