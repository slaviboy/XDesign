/**
 * The offline guarantee, tested at its strictest: install the service worker,
 * cut the network completely, then hard-reload and keep working.
 *
 * This is the claim the whole product rests on, so it is verified against the
 * real production build rather than asserted.
 */

import { test, expect } from '@playwright/test'
import { CANVAS, dismissRecovery, drawShape, nodesOfType, readField, selectTool, setField } from './helpers'

test('boots and works after a hard reload with the network cut', async ({ page, context }) => {
  // 1. First visit: let the service worker install and precache.
  await page.goto('/')
  await page.waitForSelector(CANVAS)
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported'
    const reg = await navigator.serviceWorker.ready.catch(() => null)
    return reg ? 'ready' : 'failed'
  })
  expect(swReady).toBe('ready')
  // Give the precache pass time to finish.
  await page.waitForTimeout(3000)

  // 2. Cut the network at the browser level.
  await context.setOffline(true)

  // 3. Hard reload with nothing available from the server.
  await page.reload()
  await page.waitForSelector(CANVAS, { timeout: 20000 })
  await page.waitForTimeout(400)
  await dismissRecovery(page)

  // 4. The whole editor must still be there and functional.
  await expect(page.locator('.topbar')).toBeVisible()
  await expect(page.locator('.toolbar .tool-button')).toHaveCount(11)
  await expect(page.locator('[data-node-type="artboard"]')).toHaveCount(1)

  await drawShape(page, 'rect', { x: 200, y: 200 }, { x: 340, y: 300 })
  await expect(nodesOfType(page, 'rect')).toHaveCount(1)
  await setField(page, 'W', 275)
  expect(await readField(page, 'W')).toBeCloseTo(275, 0)

  await drawShape(page, 'polygon', { x: 400, y: 200 }, { x: 500, y: 300 })
  await expect(nodesOfType(page, 'polygon')).toHaveCount(1)

  await selectTool(page, 'pen')
  await page.locator(CANVAS).click({ position: { x: 250, y: 420 } })
  await page.locator(CANVAS).click({ position: { x: 350, y: 380 } })
  await page.keyboard.press('Enter')
  await selectTool(page, 'select')
  await expect(nodesOfType(page, 'path')).toHaveCount(1)
})

test('bundled fonts render with no network', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForSelector(CANVAS)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForTimeout(3000)
  await context.setOffline(true)
  await page.reload()
  await page.waitForSelector(CANVAS, { timeout: 20000 })
  await page.waitForTimeout(400)
  await dismissRecovery(page)

  await selectTool(page, 'text')
  await page.locator(CANVAS).click({ position: { x: 300, y: 300 } })
  await page.locator('[data-testid="text-editor"]').fill('Offline')
  await page.keyboard.press('Escape')

  const box = await nodesOfType(page, 'text').locator('text').boundingBox()
  expect(box!.width).toBeGreaterThan(20)

  // A bundled family must be pickable and actually load without a network.
  const loaded = await page.evaluate(async () => {
    await document.fonts.load('700 32px Inter', 'Offline')
    return document.fonts.check('700 32px Inter')
  })
  expect(loaded).toBe(true)
})
