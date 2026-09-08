/**
 * E2E helpers.
 *
 * These drive the real UI — toolbar clicks, canvas drags, inspector fields — and
 * assert against the rendered SVG DOM rather than any internal state. There is
 * deliberately no test-only backdoor in the application code: if a test can only
 * pass by reaching past the UI, the UI is what needs fixing.
 */

import { inflateSync } from 'node:zlib'
import { expect, type Page, type Locator } from '@playwright/test'

export const CANVAS = '[data-testid="canvas-root"]'

/**
 * Dismiss the crash-recovery prompt if it appears.
 *
 * Reloading with unsaved work is exactly the condition recovery exists for, so
 * the dialog showing up after page.reload() is correct behaviour, not a bug —
 * tests just have to answer it.
 */
export async function dismissRecovery(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"][aria-label="Recover previous document?"]')
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.locator('button:text-is("Discard")').click()
    await dialog.waitFor({ state: 'hidden' })
  }
}

export async function openApp(page: Page): Promise<void> {
  // The File System Access API opens a native dialog Playwright cannot drive, so
  // tests exercise the download/file-input fallback path that Firefox and Safari
  // users get anyway.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker
  })
  await page.goto('/')
  await page.waitForSelector(CANVAS)
  // Wait for fonts so text measurement is stable across runs.
  await page.evaluate(() => document.fonts.ready)
  // A previous test in the same storage state may have left a recovery offer.
  await page.waitForTimeout(300)
  await dismissRecovery(page)
}

export async function selectTool(page: Page, tool: string): Promise<void> {
  await page.click(`[data-tool="${tool}"]`)
}

/** Canvas-relative point -> absolute page coordinates. */
async function toPagePoint(page: Page, x: number, y: number) {
  const box = await page.locator(CANVAS).boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return { x: box.x + x, y: box.y + y }
}

/** Drag on the canvas in canvas-relative coordinates. */
export async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { steps?: number; modifiers?: Array<'Shift' | 'Alt' | 'Meta' | 'Control'> } = {},
): Promise<void> {
  const a = await toPagePoint(page, from.x, from.y)
  const b = await toPagePoint(page, to.x, to.y)
  for (const key of options.modifiers ?? []) await page.keyboard.down(key)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: options.steps ?? 12 })
  await page.mouse.up()
  for (const key of options.modifiers ?? []) await page.keyboard.up(key)
}

export async function clickCanvas(
  page: Page,
  point: { x: number; y: number },
  options: { modifiers?: Array<'Shift' | 'Alt' | 'Meta' | 'Control'> } = {},
): Promise<void> {
  const p = await toPagePoint(page, point.x, point.y)
  // page.mouse.click has no `modifiers` option (that is page.click), so the
  // keys have to be held around the click explicitly.
  for (const key of options.modifiers ?? []) await page.keyboard.down(key)
  await page.mouse.click(p.x, p.y)
  for (const key of options.modifiers ?? []) await page.keyboard.up(key)
}

/** Draw a shape with the given tool by dragging a box. */
export async function drawShape(
  page: Page,
  tool: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await selectTool(page, tool)
  await dragOnCanvas(page, from, to)
  await selectTool(page, 'select')
}

// ---------------------------------------------------------------------------
// Reading state through the UI
// ---------------------------------------------------------------------------

/** All rendered document nodes of a type. */
export function nodesOfType(page: Page, type: string): Locator {
  return page.locator(`.document-layer [data-node-type="${type}"]`)
}

export function layerRows(page: Page): Locator {
  return page.locator('.layer-row')
}

/**
 * Inspector numeric field by its label.
 *
 * The rotation field is labelled with an icon rather than text, so it is
 * addressed by its grid class. '∠' is kept as the spelling callers use so the
 * intent still reads at the call site.
 */
export function inspectorField(page: Page, label: string): Locator {
  if (label === '∠' || label.toLowerCase() === 'rotation') {
    return page.locator('.tf-rot input')
  }
  // Most fields carry a visible text label; icon-labelled ones (corner radius)
  // carry their name in `title` instead. Try both rather than guessing from the
  // shape of the string — "Gap X" has a text label, "Corner radius" does not.
  const byText = page
    .locator('.field', { has: page.locator(`.field-label:text-is("${label}")`) })
    .locator('input')
    .first()
  const byTitle = page.locator(`.field[title="${label}"] input`).first()
  return byText.or(byTitle).first()
}

export async function readField(page: Page, label: string): Promise<number> {
  const value = await inspectorField(page, label).inputValue()
  return Number.parseFloat(value)
}

export async function setField(page: Page, label: string, value: number): Promise<void> {
  const field = inspectorField(page, label)
  await field.fill(String(value))
  await field.press('Enter')
}

/** The selection frame's on-screen size, for verifying transforms visually. */
export async function selectionFrameBox(page: Page) {
  return page.locator('.selection-frame').boundingBox()
}

export async function selectAll(page: Page): Promise<void> {
  await page.locator(CANVAS).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press(modifier() + '+a')
}

export function modifier(): 'Meta' | 'Control' {
  return process.platform === 'darwin' ? 'Meta' : 'Control'
}

export async function press(page: Page, key: string, shift = false): Promise<void> {
  await page.keyboard.press(`${shift ? 'Shift+' : ''}${modifier()}+${key}`)
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Drop files onto the canvas via a synthetic DataTransfer. */
export async function dropFiles(
  page: Page,
  files: Array<{ name: string; type: string; base64?: string; text?: string }>,
  at: { x: number; y: number },
): Promise<void> {
  const box = await page.locator(CANVAS).boundingBox()
  if (!box) throw new Error('canvas has no bounding box')

  await page.evaluate(
    async ({ files, clientX, clientY }) => {
      const dt = new DataTransfer()
      for (const f of files) {
        let blob: Blob
        if (f.base64) {
          const binary = atob(f.base64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          blob = new Blob([bytes], { type: f.type })
        } else {
          blob = new Blob([f.text ?? ''], { type: f.type })
        }
        dt.items.add(new File([blob], f.name, { type: f.type }))
      }
      const target = document.querySelector('[data-testid="canvas-root"]')!
      const init: DragEventInit = { bubbles: true, cancelable: true, clientX, clientY }
      target.dispatchEvent(new DragEvent('dragenter', { ...init, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('dragover', { ...init, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('drop', { ...init, dataTransfer: dt }))
    },
    { files, clientX: box.x + at.x, clientY: box.y + at.y },
  )
  // Import is async (decode + measure).
  await page.waitForTimeout(600)
}

/** A real 8x6 red PNG with valid chunk CRCs, so the browser actually decodes it. */
export const RED_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGO4o6GBFTEMpAQAngY4QZX0zKMAAAAASUVORK5CYII='

/** An SVG with a gradient, a curve and an arc — enough to prove vector survival. */
export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff0000"/>
      <stop offset="1" stop-color="#0000ff"/>
    </linearGradient>
  </defs>
  <rect x="10" y="10" width="80" height="50" rx="6" fill="url(#g1)"/>
  <circle cx="150" cy="40" r="25" fill="#00aa55"/>
  <path d="M10 90 C 40 60, 80 120, 120 90 A 20 20 0 0 1 160 90" stroke="#333" stroke-width="3" fill="none"/>
</svg>`

/** Trigger a download and return its bytes. */
export async function captureDownload(
  page: Page,
  action: () => Promise<void>,
): Promise<{ name: string; buffer: Buffer }> {
  const [download] = await Promise.all([page.waitForEvent('download'), action()])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return { name: download.suggestedFilename(), buffer: Buffer.concat(chunks) }
}

/** PNG dimensions, read straight from the IHDR chunk. */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export async function openExportDialog(page: Page): Promise<void> {
  await press(page, 'e')
  await page.waitForSelector('[role="dialog"][aria-label="Export"]')
}

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

/**
 * Decode a Playwright screenshot to raw RGBA.
 *
 * Some things can only be asserted on what actually reached the screen. A
 * clipped SVG element still reports its full geometry to getBoundingClientRect
 * and still answers isVisible(), so "this mark is not drawn" is a claim only
 * the pixels can settle.
 *
 * Playwright writes 8-bit truecolour, with an alpha channel only when the shot
 * actually has transparency — so both colour types are handled and everything
 * else is asserted rather than guessed at.
 */
export function decodePng(buffer: Buffer): {
  width: number
  height: number
  channels: number
  data: Buffer
} {
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  expect(buffer[24]).toBe(8) // bit depth
  const colourType = buffer[25]
  expect([2, 6]).toContain(colourType) // RGB or RGBA
  const channels = colourType === 6 ? 4 : 3

  const idat: Buffer[] = []
  let at = 8
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at)
    const type = buffer.toString('ascii', at + 4, at + 8)
    if (type === 'IDAT') idat.push(buffer.subarray(at + 8, at + 8 + length))
    at += length + 12
    if (type === 'IEND') break
  }

  const raw = inflateSync(Buffer.concat(idat))
  const bpp = channels
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp]! : 0
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp]! : 0
      let value = line[x]!
      switch (filter) {
        case 1: value += a; break
        case 2: value += b; break
        case 3: value += (a + b) >> 1; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
      }
      out[y * stride + x] = value & 0xff
    }
  }
  return { width, height, channels, data: out }
}

/** How many pixels in a screenshot are unmistakably red — a spell mark, say. */
export function countRedPixels(buffer: Buffer): number {
  const { width, height, channels, data } = decodePng(buffer)
  let n = 0
  for (let i = 0; i < width * height * channels; i += channels) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!
    const a = channels === 4 ? data[i + 3]! : 255
    if (a > 128 && r > 140 && g < 110 && b < 110) n++
  }
  return n
}
