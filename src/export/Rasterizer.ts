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
 * SVG -> PNG / JPEG rasterization.
 *
 * The pitfall stack this deliberately avoids, all of which fail SILENTLY:
 *
 *  - An SVG loaded through <img> runs in secure static mode: it may not issue
 *    ANY network request. External images, @font-face src URLs, CSS @import and
 *    external <use> all resolve to nothing. So the SVG handed to this module must
 *    already be fully self-contained — the exporter inlines bitmaps as data URLs
 *    and converts text to outlines for exactly this reason.
 *  - That document does not inherit the page's document.fonts either, so a
 *    webfont that looks right in the editor renders as a substitute here.
 *  - Firefox renders a viewBox-only SVG as 0x0 inside an <img>; explicit
 *    width/height are mandatory, and the exporter always emits them.
 *  - Safari chokes on multi-megabyte data: URLs, so a Blob URL is used instead.
 *    A same-origin blob: SVG does not taint the canvas.
 *  - img.onload can fire before the image is decodable; img.decode() is awaited
 *    instead so drawImage never lands on a half-ready bitmap.
 *  - The canvas is sized at the final pixel dimensions rather than ctx.scale()-ing
 *    a small one, which would resample and soften the output.
 */

export type RasterFormat = 'png' | 'jpeg'

export interface RasterOptions {
  /** Output pixel dimensions. */
  width: number
  height: number
  format: RasterFormat
  /** JPEG only, 0..1. */
  quality?: number
  /** Painted before the artwork. JPEG has no alpha, so it always gets one. */
  background?: string | null
  /** Guards against a runaway export locking up the tab. */
  maxPixels?: number
}

const DEFAULT_MAX_PIXELS = 64_000_000 // ~8000x8000

export class RasterizeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'RasterizeError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

/**
 * Rasterize to pixels rather than to a file.
 *
 * The eyedropper needs to READ the rendered artwork, which a Blob cannot give
 * it. Same-origin blob: SVG does not taint the canvas, so getImageData works —
 * that is the whole reason this module uses a Blob URL rather than a data URL.
 */
export async function rasterizeSvgToImageData(
  svg: string,
  size: { width: number; height: number },
): Promise<ImageData> {
  const width = Math.max(1, Math.round(size.width))
  const height = Math.max(1, Math.round(size.height))
  const image = await loadSvgImage(svg)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new RasterizeError('This browser could not provide a 2D canvas.')
  ctx.drawImage(image, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

/**
 * Rasterize a self-contained SVG string.
 * @throws RasterizeError with a message suitable for showing to the user.
 */
export async function rasterizeSvg(svg: string, options: RasterOptions): Promise<Blob> {
  const width = Math.max(1, Math.round(options.width))
  const height = Math.max(1, Math.round(options.height))
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS

  if (width * height > maxPixels) {
    throw new RasterizeError(
      `That export would be ${width}×${height} pixels, which is too large to render. ` +
        `Try a smaller scale.`,
    )
  }

  const image = await loadSvgImage(svg)

  try {
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!ctx) throw new RasterizeError('Could not create a drawing context for the export.')

    // JPEG has no alpha channel; without a fill, transparent areas come out black.
    const background = options.background ?? (options.format === 'jpeg' ? '#ffffff' : null)
    if (background) {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, width, height)
    }

    ctx.drawImage(image as CanvasImageSource, 0, 0, width, height)

    return await canvasToBlob(canvas, options.format, options.quality ?? 0.92)
  } finally {
    if ('src' in image && typeof image.src === 'string' && image.src.startsWith('blob:')) {
      URL.revokeObjectURL(image.src)
    }
  }
}

/**
 * Load the SVG as an image element.
 *
 * A Blob URL rather than a data: URL (size limits), and decode() rather than
 * onload (decode guarantees the bitmap is actually ready to draw).
 */
async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.crossOrigin = 'anonymous'

  try {
    image.src = url
    if (typeof image.decode === 'function') {
      await image.decode()
    } else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('image failed to load'))
      })
    }
    return image
  } catch (cause) {
    URL.revokeObjectURL(url)
    throw new RasterizeError(
      'The artwork could not be rendered for export. It may contain an unsupported feature.',
      { cause },
    )
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  format: RasterFormat,
  quality: number,
): Promise<Blob> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'

  try {
    if ('convertToBlob' in canvas) {
      return await canvas.convertToBlob({ type: mime, quality })
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
        mime,
        format === 'jpeg' ? quality : undefined,
      )
    })
  } catch (cause) {
    // A SecurityError here means something remote got into the artwork. The
    // importer's URI allowlist should make that impossible, so say so plainly.
    const isSecurity = cause instanceof DOMException && cause.name === 'SecurityError'
    throw new RasterizeError(
      isSecurity
        ? 'Export failed because the artwork references an external resource.'
        : 'Export failed while encoding the image.',
      { cause },
    )
  }
}

/** Natural pixel size of an image data URL, used when placing a dropped file. */
export function measureImageDataUrl(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 })
    img.onerror = () => reject(new Error('Could not read image dimensions'))
    img.src = dataUrl
  })
}
