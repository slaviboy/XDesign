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
 * What an export will look like, shown before it is written.
 *
 * The preview IS an export: the same request goes through the same pipeline,
 * and what is shown is the file that came out — the crop, the background, a
 * JPEG's compression. A picture assembled separately would be a second
 * renderer, and one that could disagree with the file without anyone noticing.
 *
 * Two departures, each because the real thing cannot be shown:
 *  - An SVG whose images are linked would show empty frames on its own, since
 *    the files sit beside it rather than inside it. The preview embeds them,
 *    which is what the SVG looks like next to its images.
 *  - Only Safari can put a HEIF in an <img>, so a HEIF is decoded back to pixels
 *    first — the compressed pixels, from the bytes that were just encoded.
 */

import {
  isRasterFormat,
  resolveExportBounds,
  runExport,
  clampScale,
  type ExportRequest,
} from './ExportPipeline'
import { decodeHeif } from './HeifEncoder'
import type { DesignDocument } from '../document/types'

/**
 * A preview is drawn at the export's own size up to this many pixels, and
 * scaled down past it.
 *
 * The box it is shown in is a few hundred pixels across, so a 30-megapixel
 * render would be seconds of work — and for HEIF, seconds of encoding — for
 * detail nobody can see there, repeated on every change of a setting.
 */
export const PREVIEW_MAX_PIXELS = 4_000_000

export interface ExportPreviewImage {
  /** An object URL; the caller revokes it. */
  url: string
  /**
   * The size of the file, when the preview is the file byte for byte — not
   * when it was drawn smaller, or had its images embedded.
   */
  bytes: number | null
  /** Drawn smaller than it will be exported. */
  reduced: boolean
}

export async function renderExportPreview(
  doc: DesignDocument,
  request: ExportRequest,
): Promise<ExportPreviewImage> {
  const scale = clampScale(request.scale)
  let previewScale = scale
  if (isRasterFormat(request.format)) {
    const bounds = resolveExportBounds(doc, request)
    const pixels = bounds ? bounds.width * bounds.height * scale * scale : 0
    if (pixels > PREVIEW_MAX_PIXELS) previewScale = scale * Math.sqrt(PREVIEW_MAX_PIXELS / pixels)
  }
  const reduced = previewScale !== scale
  const embeds = request.format === 'svg' && request.imageHandling === 'link'

  const output = await runExport(doc, {
    ...request,
    scale: previewScale,
    imageHandling: embeds ? 'embed' : request.imageHandling,
  })
  const shown = request.format === 'heif' ? await pngOf(await decodeHeif(output.blob)) : output.blob

  return {
    url: URL.createObjectURL(shown),
    bytes: reduced || embeds ? null : output.blob.size,
    reduced,
  }
}

function pngOf(image: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('This browser could not provide a 2D canvas.'))
  ctx.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The preview could not be drawn.'))), 'image/png')
  })
}
