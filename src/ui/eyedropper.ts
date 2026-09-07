/**
 * Sampling a colour from the canvas.
 *
 * The artwork is rendered as SVG, so there are no pixels to read until we make
 * some: arming the eyedropper serialises the visible document through the same
 * exporter the PNG pipeline uses — bitmaps embedded, gradients intact — and
 * rasterises it ONCE. Every subsequent sample is an array lookup, so tracking
 * the pointer costs nothing.
 *
 * The native `EyeDropper` API is deliberately not used: it is Chromium-only, so
 * a fallback would be needed anyway; it takes over the screen with an OS
 * magnifier that cannot be driven by the test suite; and it cannot keep the
 * picker's own fields updating as the pointer moves.
 */

import { exportNodesToSvg } from '../svg/SvgExporter'
import { rasterizeSvgToImageData } from '../export/Rasterizer'
import { screenToDoc } from '../canvas/Viewport'
import { editorStore } from '../state/EditorStore'
import { getDoc } from '../state/DocumentStore'
import type { RGBA } from '../document/types'

export interface EyedropperSampler {
  /** @returns the colour under a page coordinate, or null where nothing is drawn. */
  sample(clientX: number, clientY: number): RGBA | null
}

/** Rasterise what is on screen right now. Null when there is nothing to sample. */
export async function armEyedropper(): Promise<EyedropperSampler | null> {
  const el = document.querySelector('[data-testid="canvas-root"]')
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null

  const { viewport } = editorStore.getState()
  const topLeft = screenToDoc(viewport, { x: 0, y: 0 })
  const bottomRight = screenToDoc(viewport, { x: rect.width, y: rect.height })
  const bounds = {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(1, bottomRight.x - topLeft.x),
    height: Math.max(1, bottomRight.y - topLeft.y),
  }

  const doc = getDoc()
  const root = doc.nodes[doc.rootId]
  const ids = root && 'children' in root ? root.children : []
  if (ids.length === 0) return null

  const { svg } = await exportNodesToSvg(doc, ids, {
    bounds,
    scale: viewport.zoom,
    imageHandling: 'embed',
    textHandling: 'embed-font',
    background: null,
  })

  const pixels = await rasterizeSvgToImageData(svg, {
    width: rect.width,
    height: rect.height,
  })

  return {
    sample(clientX, clientY) {
      const box = el.getBoundingClientRect()
      const x = Math.round(clientX - box.left)
      const y = Math.round(clientY - box.top)
      if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return null
      const i = (y * pixels.width + x) * 4
      const a = pixels.data[i + 3]! / 255
      // Transparent means nothing was drawn there; the caller holds its last
      // value rather than flashing to black.
      if (a === 0) return null
      return { r: pixels.data[i]!, g: pixels.data[i + 1]!, b: pixels.data[i + 2]!, a }
    },
  }
}
