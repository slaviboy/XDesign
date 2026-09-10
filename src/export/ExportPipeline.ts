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
 * Export orchestration.
 *
 * One place that decides WHAT to export (which nodes, which bounds) and hands it
 * to the SVG serializer or the rasterizer. Both raster and vector output go
 * through the same serializer, so a PNG and an SVG of the same selection are
 * guaranteed to agree.
 *
 * Bounds use renderBounds, not geometry bounds — cropping to the fill outline is
 * what slices strokes in half at the edge of an exported image.
 */

import { roundOut, unionAll, type Bounds } from '../geometry/Bounds'
import { renderBounds, createMatrixCache, artboardIds } from '../document/SceneGraph'
import { exportNodesToSvg, type ImageHandling, type TextHandling } from '../svg/SvgExporter'
import { rasterizeSvg, RasterizeError } from './Rasterizer'
import type { DesignDocument, NodeId, RGBA } from '../document/types'

export type ExportFormat = 'svg' | 'png' | 'jpeg' | 'heif' | 'webp'
export type ExportArea = 'selection' | 'artboard' | 'document' | 'custom' | 'marked'

export interface ExportRequest {
  format: ExportFormat
  area: ExportArea
  /** Nodes to export. For 'artboard' this is the artboard id. */
  nodeIds: readonly NodeId[]
  /** Required when area is 'custom'. */
  customBounds?: Bounds
  scale: number
  /** JPEG and WebP, 0..1. */
  quality?: number
  /**
   * null exports a transparent background. JPEG has no transparency, so there
   * it means white, and a translucent colour is laid over white.
   */
  background?: RGBA | null
  imageHandling?: ImageHandling
  textHandling?: TextHandling
  padding?: number
  /** The name before the scale and extension, which are always added. */
  fileName?: string
}

/** Everything but SVG comes out as pixels, and so has a scale. */
export function isRasterFormat(format: ExportFormat): boolean {
  return format !== 'svg'
}

/** JPEG is the one format that cannot be transparent. */
export function supportsTransparency(format: ExportFormat): boolean {
  return format !== 'jpeg'
}

/** The lossy formats whose encoder takes a quality. HEIF's does not. */
export function hasQuality(format: ExportFormat): boolean {
  return format === 'jpeg' || format === 'webp'
}

const EXTENSIONS: Record<ExportFormat, string> = {
  svg: 'svg',
  png: 'png',
  jpeg: 'jpg',
  // The HEVC-coded kind of HEIF, which is what the encoder writes and what
  // Apple's software and Windows' HEIF extension look for by name.
  heif: 'heic',
  webp: 'webp',
}

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 }

export interface ExportOutput {
  blob: Blob
  fileName: string
  /** Actual pixel dimensions for raster; document units for SVG. */
  width: number
  height: number
  warnings: string[]
  linkedAssets: Array<{ fileName: string; dataUrl: string }>
}

export const SCALE_PRESETS = [0.5, 1, 1.5, 2, 3, 4] as const
export const MIN_SCALE = 0.1
export const MAX_SCALE = 10

/**
 * Resolve the crop rectangle for a request.
 *
 * Exporting an artboard crops to the artboard's own frame — not to its content —
 * so objects hanging off the edge are excluded, which is what "export artboard"
 * has to mean.
 */
export function resolveExportBounds(
  doc: DesignDocument,
  request: Pick<ExportRequest, 'area' | 'nodeIds' | 'customBounds'>,
): Bounds | null {
  if (request.area === 'custom') return request.customBounds ?? null

  const cache = createMatrixCache()

  if (request.area === 'artboard') {
    const id = request.nodeIds[0]
    if (!id || doc.nodes[id]?.type !== 'artboard') return null
    // Artboard frame, not content bounds.
    const artboard = doc.nodes[id]!
    const cornerBounds = renderBounds(doc, id, cache)
    return artboard.transform.rotation === 0
      ? {
          x: cornerBounds.x,
          y: cornerBounds.y,
          width: artboard.transform.width * Math.abs(artboard.transform.scaleX),
          height: artboard.transform.height * Math.abs(artboard.transform.scaleY),
        }
      : cornerBounds
  }

  if (request.nodeIds.length === 0) return null
  const box = unionAll(request.nodeIds.map((id) => renderBounds(doc, id, cache)))
  return box.width > 0 || box.height > 0 ? box : null
}

/** Nodes to include, given the requested area. */
export function resolveExportNodes(
  doc: DesignDocument,
  request: Pick<ExportRequest, 'area' | 'nodeIds'>,
): NodeId[] {
  switch (request.area) {
    case 'artboard':
      return request.nodeIds.filter((id) => doc.nodes[id]?.type === 'artboard')
    case 'document': {
      const boards = artboardIds(doc)
      const root = doc.nodes[doc.rootId]
      return boards.length > 0 ? boards : root && 'children' in root ? [...root.children] : []
    }
    case 'custom': {
      // Everything at top level; the crop rectangle does the selecting.
      const root = doc.nodes[doc.rootId]
      return root && 'children' in root ? [...root.children] : []
    }
    default:
      return [...request.nodeIds]
  }
}

export async function runExport(
  doc: DesignDocument,
  request: ExportRequest,
): Promise<ExportOutput> {
  const nodeIds = resolveExportNodes(doc, request)
  if (nodeIds.length === 0) {
    throw new RasterizeError('There is nothing to export.')
  }

  const bounds = resolveExportBounds(doc, request)
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    throw new RasterizeError('The export area is empty.')
  }

  const scale = clampScale(request.scale)
  const padding = request.padding ?? 0

  const { svg, linkedAssets, warnings } = await exportNodesToSvg(doc, nodeIds, {
    bounds,
    scale: request.format === 'svg' ? 1 : scale,
    imageHandling: request.imageHandling ?? 'embed',
    // Raster export ALWAYS embeds: the <img> sandbox cannot fetch our fonts and
    // does not inherit the page's document.fonts, so a name reference would
    // silently substitute.
    textHandling: request.format === 'svg' ? (request.textHandling ?? 'embed-font') : 'embed-font',
    // The background is drawn INTO the SVG, for every format, and nowhere else.
    // The rasterizer used to paint it underneath as well, which went unnoticed
    // while the only choice was opaque white: a half-transparent colour painted
    // twice comes out three-quarters opaque.
    background: supportsTransparency(request.format)
      ? (request.background ?? null)
      : (request.background ?? WHITE),
    padding,
  })

  const name = request.fileName?.trim() || defaultName(doc, request, nodeIds)
  const fileName = sanitizeFileName(baseNameOf(name)) + exportFileSuffix(request.format, scale)

  if (request.format === 'svg') {
    return {
      blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      fileName,
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
      warnings,
      linkedAssets,
    }
  }

  // Round the pixel box outward so a fractional bound never clips an edge.
  const pixel = roundOut({
    x: 0,
    y: 0,
    width: (bounds.width + padding * 2) * scale,
    height: (bounds.height + padding * 2) * scale,
  })

  const blob = await rasterizeSvg(svg, {
    width: pixel.width,
    height: pixel.height,
    format: request.format,
    quality: request.quality ?? 0.92,
    // Only JPEG gets a ground of its own: it has no alpha, so whatever the SVG
    // leaves see-through would otherwise come out black. Everything else has
    // its background in the SVG already.
    background: supportsTransparency(request.format) ? null : '#ffffff',
  })

  return {
    blob,
    fileName,
    width: pixel.width,
    height: pixel.height,
    warnings,
    linkedAssets,
  }
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function formatScale(scale: number): string {
  return Number.isInteger(scale) ? String(scale) : String(Number(scale.toFixed(2)))
}

/**
 * What the pipeline puts after a file's name: the scale, for pixels, and the
 * extension. The dialog shows it after the name field, so the whole name is on
 * screen before anything is written.
 */
export function exportFileSuffix(format: ExportFormat, scale: number): string {
  const s = clampScale(scale)
  return `${isRasterFormat(format) && s !== 1 ? `@${formatScale(s)}x` : ''}.${EXTENSIONS[format]}`
}

/** The name an export gets when nobody types one. */
export function defaultExportName(
  doc: DesignDocument,
  request: Pick<ExportRequest, 'area' | 'nodeIds'>,
): string {
  return defaultName(doc, request, resolveExportNodes(doc, request))
}

function defaultName(
  doc: DesignDocument,
  request: Pick<ExportRequest, 'area'>,
  nodeIds: readonly NodeId[],
): string {
  if (request.area === 'artboard' || nodeIds.length === 1) {
    const node = doc.nodes[nodeIds[0]!]
    if (node) return node.name
  }
  if (request.area === 'document') return doc.name
  return `${doc.name}-${request.area}`
}

/**
 * A typed name, less a scale and extension the pipeline is about to add anyway
 * — someone who types "hero.png" means hero.png, not hero.png.png.
 */
function baseNameOf(name: string): string {
  return name.replace(/(@\d+(\.\d+)?x)?\.(svg|png|jpe?g|heic|heif|webp)$/i, '')
}

/**
 * Only what a file system will not take, so a name in any script survives.
 *
 * The rule used to keep [A-Za-z0-9._ -] and replace everything else, which was
 * harmless while names only came from layers but turned a name typed in
 * Bulgarian or Japanese into a row of dashes.
 */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading dot hides the file on macOS and Linux; Windows drops a trailing one.
    .replace(/^\.+|\.+$/g, '')
  // By code point, so the cut cannot split an emoji into half a character.
  return Array.from(cleaned).slice(0, 80).join('').trim() || 'export'
}

/**
 * Hand a blob to the user as a download.
 *
 * Object URL rather than a data URL so large exports do not hit URL length
 * limits, and revoked on the next tick so the download has started.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export { RasterizeError }
