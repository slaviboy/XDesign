import { test, expect } from '@playwright/test'
import { CANVAS, drawShape, selectTool, openApp, readField } from './helpers'

test('radius handles during a move drag', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 470, y: 380 })
  await selectTool(page, 'select')

  const handle = page.locator('[data-handle="radius"]').first()
  const before = (await handle.boundingBox())!
  const frameBefore = (await page.locator('.selection-frame').boundingBox())!
  console.log('BEFORE handle', JSON.stringify(before), 'frame', JSON.stringify(frameBefore))

  const canvas = (await page.locator(CANVAS).boundingBox())!
  await page.mouse.move(canvas.x + 360, canvas.y + 290)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 510, canvas.y + 290, { steps: 14 })
  await page.waitForTimeout(120)

  const during = await handle.boundingBox()
  const frameDuring = (await page.locator('.selection-frame').boundingBox())!
  console.log('DURING handle', JSON.stringify(during), 'frame', JSON.stringify(frameDuring))
  console.log('frame moved by', frameDuring.x - frameBefore.x, ' handle moved by', during ? during.x - before.x : 'GONE')
  await page.mouse.up()
  expect(true).toBe(true)
})

test('radius handles during a resize drag', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 470, y: 380 })
  await selectTool(page, 'select')
  const frame = (await page.locator('.selection-frame').boundingBox())!
  const handles0 = await page.locator('[data-handle="radius"]').all()
  const boxes0 = await Promise.all(handles0.map((h) => h.boundingBox()))
  console.log('BEFORE', JSON.stringify(boxes0.map(b => b && [Math.round(b.x), Math.round(b.y)])))

  const se = { x: frame.x + frame.width, y: frame.y + frame.height }
  await page.mouse.move(se.x, se.y)
  await page.mouse.down()
  await page.mouse.move(se.x + 160, se.y + 120, { steps: 14 })
  await page.waitForTimeout(120)
  const handles1 = await page.locator('[data-handle="radius"]').all()
  const boxes1 = await Promise.all(handles1.map((h) => h.boundingBox()))
  console.log('DURING', JSON.stringify(boxes1.map(b => b && [Math.round(b.x), Math.round(b.y)])))
  const f1 = (await page.locator('.selection-frame').boundingBox())!
  console.log('frame during', JSON.stringify(f1))
  await page.mouse.up()
  expect(true).toBe(true)
})

test('W readout during a move of a nested node under a scaled group', async ({ page }) => {
  await openApp(page)
  await drawShape(page, 'rect', { x: 250, y: 200 }, { x: 350, y: 300 })
  await drawShape(page, 'rect', { x: 400, y: 200 }, { x: 500, y: 300 })
  await page.keyboard.press('Meta+a')
  await page.keyboard.press('Meta+g')
  // now resize the group so it gets a scale? single selection resize writes width/height.
  const w = await readField(page, 'W')
  console.log('group W', w)
  expect(true).toBe(true)
})
