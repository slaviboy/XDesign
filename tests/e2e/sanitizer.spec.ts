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
 * SVG sanitization, verified in real Chromium.
 *
 * These assertions live here rather than in the unit suite because DOMPurify
 * reports isSupported === false under happy-dom and passes its input straight
 * through — so a "the script was stripped" assertion would pass without any
 * sanitization having happened. Testing a security boundary against a fake DOM
 * proves nothing, so it is tested where it actually runs.
 *
 * Everything is exercised through the real import path: files are dropped onto
 * the canvas exactly as a user would drop them.
 */

import { test, expect } from '@playwright/test'
import { dropFiles, nodesOfType, openApp } from './helpers'

const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${inner}</svg>`

async function importSvgText(page: import('@playwright/test').Page, markup: string) {
  await dropFiles(page, [{ name: 'test.svg', type: 'image/svg+xml', text: markup }], { x: 400, y: 300 })
}

test('geometry attributes survive sanitization', async ({ page }) => {
  await openApp(page)
  await importSvgText(page, svg('<path d="M10 90 C 40 60, 80 120, 120 90" stroke="#333" fill="none"/>'))

  await expect(nodesOfType(page, 'path')).toHaveCount(1)
  const d = await nodesOfType(page, 'path').locator('path').first().getAttribute('d')
  expect(d).toBeTruthy()
  expect(d!.length).toBeGreaterThan(10)
})

test('rect geometry survives with real dimensions', async ({ page }) => {
  await openApp(page)
  await importSvgText(page, svg('<rect x="10" y="20" width="60" height="40" rx="5" fill="#3366cc"/>'))

  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
  await nodesOfType(page, 'rect').first().click({ force: true })
  const w = await page.locator('.field', { has: page.locator('.field-label:text-is("W")') })
    .locator('input').first().inputValue()
  expect(Number.parseFloat(w)).toBeCloseTo(60, 0)
})

test('scripts and event handlers are removed', async ({ page }) => {
  const alerts: string[] = []
  page.on('dialog', async (d) => { alerts.push(d.message()); await d.dismiss() })
  await openApp(page)

  await importSvgText(page, svg('<script>window.__pwned = true</script><rect width="50" height="50" onload="window.__pwned2 = true" fill="#f00"/>'))

  expect(await page.evaluate(() => (window as never as Record<string, unknown>).__pwned)).toBeUndefined()
  expect(await page.evaluate(() => (window as never as Record<string, unknown>).__pwned2)).toBeUndefined()
  expect(await page.locator('.document-layer script').count()).toBe(0)
  expect(alerts).toHaveLength(0)
})

test('foreignObject is removed', async ({ page }) => {
  await openApp(page)
  await importSvgText(page, svg('<foreignObject width="50" height="50"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject><rect width="20" height="20"/>'))
  expect(await page.locator('.document-layer foreignObject').count()).toBe(0)
})

test('remote references are stripped so nothing can be fetched at runtime', async ({ page, context }) => {
  const external: string[] = []
  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (!url.startsWith('http://localhost:4173')) {
      external.push(url)
      return route.abort()
    }
    return route.continue()
  })

  await openApp(page)
  await importSvgText(page, svg(
    '<image href="https://evil.example/x.png" width="50" height="50"/>' +
    '<rect width="50" height="50" fill="url(https://evil.example/g)"/>' +
    '<rect x="50" width="20" height="20" fill="#0f0"/>',
  ))
  await page.waitForTimeout(500)

  expect(external, `SVG import reached the network: ${external.join(', ')}`).toHaveLength(0)
  const hrefs = await page.locator('.document-layer image').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href')),
  )
  expect(hrefs.filter((h) => h?.startsWith('http'))).toHaveLength(0)
})

test('javascript: urls do not survive', async ({ page }) => {
  await openApp(page)
  await importSvgText(page, svg('<a href="javascript:window.__x=1"><rect width="30" height="30"/></a>'))
  const html = await page.locator('.document-layer').innerHTML()
  expect(html).not.toContain('javascript:')
})

test('embedded data: images are preserved', async ({ page }) => {
  await openApp(page)
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGO4o6GBFTEMpAQAngY4QZX0zKMAAAAASUVORK5CYII='
  await importSvgText(page, svg(`<image href="${dataUrl}" width="50" height="50"/>`))

  await expect(nodesOfType(page, 'image')).toHaveCount(1)
  const href = await nodesOfType(page, 'image').locator('image').first().getAttribute('href')
  expect(href).toMatch(/^data:image\/png;base64,/)
})

test('gradients and their references survive intact', async ({ page }) => {
  await openApp(page)
  await importSvgText(page, svg(
    '<defs><linearGradient id="title" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>' +
    '</linearGradient></defs><rect width="80" height="60" fill="url(#title)"/>',
  ))

  // id="title" is exactly the case DOMPurify's SANITIZE_DOM would delete.
  await expect(page.locator('.document-layer linearGradient')).toHaveCount(1)
  await expect(page.locator('.document-layer linearGradient stop')).toHaveCount(2)
  const fill = await nodesOfType(page, 'rect').locator('path').first().getAttribute('fill')
  expect(fill).toMatch(/^url\(#/)
})
