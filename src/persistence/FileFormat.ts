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
 * The .xdesign document format.
 *
 * A ZIP container holding `document.json` plus the raw bytes of every image
 * under `assets/`. Zipping matters: base64 inside JSON inflates binary by 33%
 * and then compresses badly, so an image-heavy document is many times larger as
 * flat JSON. The container is fully self-contained — copy the file to another
 * machine and every vector and every bitmap opens intact, with no external
 * dependency.
 *
 * The reader sniffs the magic bytes: `PK` means unzip, anything else is parsed
 * as flat JSON. So a hand-written or hand-edited JSON document still opens, and
 * so would a file produced by an older build.
 *
 * Loading is defensive by design. A corrupt or partially-written file must
 * produce a clear message and leave the current document untouched, never a
 * half-applied import.
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import {
  DEFAULT_SETTINGS,
  type DesignDocument, type DesignNode, type ImageAsset, type NodeId,
  type ArtboardGrid, type Guide, type RGBA, type Swatch,
} from '../document/types'
import { createDocumentRoot } from '../document/NodeFactory'
import { artboardIds, createMatrixCache, geometryBounds } from '../document/SceneGraph'
import { clampGrid } from '../history/Commands'

export const FORMAT_NAME = 'OfflineDesignDocument'
/**
 * 3: guides moved from `document.guides` onto the artboard that owns them.
 *
 * A bump rather than the usual additive field, because this MOVES data: a
 * version-2 file's guides are read from the old place and distributed, and
 * nothing is written back there.
 */
export const FORMAT_VERSION = 3
export const FILE_EXTENSION = '.xdesign'
export const MIME_TYPE = 'application/x-xdesign+zip'

/** On-disk shape. Mirrors the model but keeps assets separable. */
export interface XDesignFile {
  format: string
  version: number
  document: {
    id: string
    name: string
    createdAt: number
    modifiedAt: number
    settings: DesignDocument['settings']
    /** Version 2 and earlier only; guides now live on their artboard. */
    guides?: Guide[]
    swatches?: DesignDocument['swatches']
  }
  rootId: NodeId
  /** Convenience index; the authoritative structure is in `layers`. */
  artboards: NodeId[]
  /** Every node, flat. Parent/child links are inside the nodes themselves. */
  layers: DesignNode[]
  /** Metadata only when zipped; `dataUrl` is inline in the JSON-only form. */
  assets: Array<Omit<ImageAsset, 'dataUrl'> & { dataUrl?: string; file?: string }>
  metadata: Record<string, unknown>
}

export class DocumentFormatError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'DocumentFormatError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

export interface SerializeOptions {
  /** Write flat JSON instead of a ZIP. Larger, but human-readable. */
  plainJson?: boolean
}

export function serializeDocument(
  doc: DesignDocument,
  options: SerializeOptions = {},
): Uint8Array {
  const assets = Object.values(doc.assets)

  const payload: XDesignFile = {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    document: {
      id: doc.id,
      name: doc.name,
      createdAt: doc.createdAt,
      modifiedAt: Date.now(),
      settings: doc.settings,
      swatches: doc.swatches,
    },
    rootId: doc.rootId,
    artboards: Object.values(doc.nodes)
      .filter((n) => n.type === 'artboard')
      .map((n) => n.id),
    layers: Object.values(doc.nodes),
    assets: assets.map((a) =>
      options.plainJson
        ? { ...a }
        : { ...stripDataUrl(a), file: `assets/${a.id}.${extensionFor(a.mimeType)}` },
    ),
    metadata: {
      generator: 'XDesign',
      savedAt: new Date().toISOString(),
      nodeCount: Object.keys(doc.nodes).length,
      assetCount: assets.length,
    },
  }

  const json = JSON.stringify(payload, null, options.plainJson ? 2 : 0)
  if (options.plainJson) return strToU8(json)

  const files: Record<string, Uint8Array> = { 'document.json': strToU8(json) }
  for (const asset of assets) {
    const bytes = dataUrlToBytes(asset.dataUrl)
    if (bytes) files[`assets/${asset.id}.${extensionFor(asset.mimeType)}`] = bytes
  }
  // level 6 keeps saves fast; the bytes are mostly already-compressed images.
  return zipSync(files, { level: 6, mtime: Date.now() })
}

function stripDataUrl(asset: ImageAsset): Omit<ImageAsset, 'dataUrl'> {
  const { dataUrl: _dataUrl, ...rest } = asset
  void _dataUrl
  return rest
}

// ---------------------------------------------------------------------------
// Deserialize
// ---------------------------------------------------------------------------

export function deserializeDocument(bytes: Uint8Array): DesignDocument {
  let payload: XDesignFile
  let zipped: Record<string, Uint8Array> | null = null

  if (isZip(bytes)) {
    try {
      zipped = unzipSync(bytes)
    } catch (cause) {
      throw new DocumentFormatError('This file is not a readable .xdesign document.', { cause })
    }
    const docBytes = zipped['document.json']
    if (!docBytes) {
      throw new DocumentFormatError('This .xdesign file is missing its document data.')
    }
    payload = parseJson(strFromU8(docBytes))
  } else {
    payload = parseJson(strFromU8(bytes))
  }

  return buildDocument(payload, zipped)
}

function parseJson(text: string): XDesignFile {
  try {
    return JSON.parse(text) as XDesignFile
  } catch (cause) {
    throw new DocumentFormatError('This file could not be parsed as a document.', { cause })
  }
}

/**
 * Rebuild the in-memory model, repairing what can be repaired.
 *
 * A document with one broken parent link should still open with everything else
 * intact — losing an afternoon's work to a single bad reference is not an
 * acceptable failure mode.
 */
/**
 * Brings a node written by an older build up to the current model.
 *
 * The only migration so far is the shape merge: Triangle and Star used to be
 * their own node types, and are now a polygon with three corners and a polygon
 * with a star ratio below 1. This runs on the one path every document takes into
 * memory, so file open and crash recovery are both covered.
 */
export function migrateLegacyNode(node: DesignNode): DesignNode {
  const legacy = node as DesignNode & {
    points?: number
    innerRatio?: number
    sides?: number
    starRatio?: number
    cornerRadius?: unknown
  }
  const type = node.type as string
  if (type !== 'triangle' && type !== 'star' && type !== 'polygon') return node

  const sides =
    type === 'triangle'
      ? 3
      : Math.min(100, Math.max(3, Math.round((type === 'star' ? legacy.points : legacy.sides) ?? 3)))

  // The old innerRatio was a fraction of the CIRCUMradius; starRatio is a
  // fraction of the apothem, which is what makes 100% a plain polygon. Without
  // this conversion every saved star would visibly change shape on load.
  let starRatio = 1
  if (type === 'star') {
    starRatio = Math.min(1, Math.max(0.01, (legacy.innerRatio ?? 0.5) / Math.cos(Math.PI / sides)))
  } else if (typeof legacy.starRatio === 'number') {
    starRatio = Math.min(1, Math.max(0.01, legacy.starRatio))
  }

  // Destructured out rather than left in place: dead keys would otherwise ride
  // along into the next save forever.
  const { points: _points, innerRatio: _innerRatio, ...rest } = legacy
  void _points
  void _innerRatio
  // The layer's own name is kept as the user last saw it — silently renaming
  // someone's "Star" layer to "Polygon" on load is worse than a stale name.
  return {
    ...rest,
    type: 'polygon',
    sides,
    starRatio,
    cornerRadius: typeof legacy.cornerRadius === 'number' ? legacy.cornerRadius : 0,
  } as DesignNode
}

function buildDocument(
  payload: XDesignFile,
  zipped: Record<string, Uint8Array> | null,
): DesignDocument {
  if (payload?.format !== FORMAT_NAME) {
    throw new DocumentFormatError('This is not an XDesign document.')
  }
  if (typeof payload.version !== 'number' || payload.version > FORMAT_VERSION) {
    throw new DocumentFormatError(
      `This document was created by a newer version of the app (format ${payload.version}).`,
    )
  }
  if (!Array.isArray(payload.layers)) {
    throw new DocumentFormatError('This document is missing its layer data.')
  }

  const nodes: Record<NodeId, DesignNode> = {}
  for (const node of payload.layers) {
    if (node && typeof node.id === 'string') nodes[node.id] = migrateLegacyNode(node)
  }

  let rootId = payload.rootId
  if (!rootId || !nodes[rootId]) {
    const found = Object.values(nodes).find((n) => n.type === 'document')
    if (found) {
      rootId = found.id
    } else {
      const root = createDocumentRoot()
      nodes[root.id] = root
      rootId = root.id
    }
  }

  repairHierarchy(nodes, rootId)
  sanitizeArtboardExtras(nodes)

  const assets: Record<string, ImageAsset> = {}
  for (const asset of payload.assets ?? []) {
    if (!asset?.id) continue
    let dataUrl = asset.dataUrl
    if (!dataUrl && zipped && asset.file) {
      const bytes = zipped[asset.file]
      if (bytes) dataUrl = bytesToDataUrl(bytes, asset.mimeType)
    }
    if (!dataUrl) continue
    assets[asset.id] = {
      id: asset.id,
      name: asset.name ?? 'Image',
      mimeType: asset.mimeType ?? 'image/png',
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      byteSize: asset.byteSize ?? 0,
      dataUrl,
    }
  }

  const doc: DesignDocument = {
    id: payload.document?.id ?? `doc${Date.now().toString(36)}`,
    name: payload.document?.name ?? 'Untitled',
    nodes,
    rootId,
    assets,
    // Absent in files written before swatches existed, which is exactly the
    // right default — no version bump needed for a purely additive field.
    swatches: Array.isArray(payload.document?.swatches)
      ? payload.document.swatches.filter(isSwatch)
      : [],
    settings: { ...DEFAULT_SETTINGS, ...(payload.document?.settings ?? {}) },
    createdAt: payload.document?.createdAt ?? Date.now(),
    modifiedAt: payload.document?.modifiedAt ?? Date.now(),
  }

  // After the document is whole, so artboard bounds can be resolved.
  if (payload.version <= 2 && Array.isArray(payload.document?.guides)) {
    migrateGuidesToArtboards(doc, payload.document.guides.filter(isGuide))
  }
  return doc
}

/** Repair-what-you-can: a malformed guide is dropped, not fatal. */
function isGuide(value: unknown): value is Guide {
  if (!value || typeof value !== 'object') return false
  const g = value as Guide
  return (
    typeof g.id === 'string' &&
    (g.axis === 'x' || g.axis === 'y') &&
    typeof g.position === 'number' &&
    Number.isFinite(g.position)
  )
}

/**
 * Move a version-2 document's guides onto the artboards they fall inside.
 *
 * The old guides were world-space lines spanning the whole canvas; the new ones
 * belong to an artboard and are stored in its local space. A guide that crosses
 * no artboard has nowhere to go and is dropped — keeping it would mean keeping
 * the document-level list alive for the one case it no longer serves.
 */
function migrateGuidesToArtboards(doc: DesignDocument, legacy: readonly Guide[]): void {
  if (legacy.length === 0) return
  const cache = createMatrixCache()
  const boards = artboardIds(doc)

  for (const guide of legacy) {
    // Backwards: artboardIds is paint order, so the LAST match is the topmost,
    // which is the one a click would have chosen too (see containerAtPoint).
    for (let i = boards.length - 1; i >= 0; i--) {
      const id = boards[i]!
      const board = doc.nodes[id]
      if (!board || board.type !== 'artboard') continue
      const b = geometryBounds(doc, id, cache)
      const lo = guide.axis === 'x' ? b.x : b.y
      const hi = guide.axis === 'x' ? b.x + b.width : b.y + b.height
      if (guide.position < lo || guide.position > hi) continue
      board.guides = [...(board.guides ?? []), { ...guide, position: guide.position - lo }]
      break
    }
  }
}

/**
 * Trust nothing that came off disk.
 *
 * Node fields skip the guide validation above entirely — they arrive inside
 * `layers` — so a hand-edited or truncated file could put a string where a
 * position belongs and have the renderer paint NaN. This is the same hole
 * `isSwatch` exists to close, applied to the artboard's own additions.
 */
function sanitizeArtboardExtras(nodes: Record<NodeId, DesignNode>): void {
  for (const node of Object.values(nodes)) {
    if (node.type !== 'artboard') continue
    const guides = Array.isArray(node.guides) ? node.guides.filter(isGuide) : []
    // Deleted rather than left empty, so an artboard with no guides costs
    // nothing in the file.
    if (guides.length) node.guides = guides
    else delete node.guides
    if (node.guidesLocked !== true) delete node.guidesLocked

    const grid = readGrid(node.grid)
    if (grid) node.grid = grid
    else delete node.grid
  }
}

function isRgba(value: unknown): value is RGBA {
  if (!value || typeof value !== 'object') return false
  const c = value as RGBA
  return [c.r, c.g, c.b, c.a].every((n) => typeof n === 'number' && Number.isFinite(n))
}

/** A grid with any bad field is dropped whole: half a grid is not a grid. */
function readGrid(value: unknown): ArtboardGrid | undefined {
  if (!value || typeof value !== 'object') return undefined
  const g = value as ArtboardGrid
  if (typeof g.visible !== 'boolean' || !isRgba(g.color)) return undefined
  if (g.type === 'square') {
    return typeof g.size === 'number' && Number.isFinite(g.size) ? clampGrid(g) : undefined
  }
  if (g.type === 'layout') {
    const numbers = [g.columns, g.gutter, g.marginLeft, g.marginRight]
    if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
    return clampGrid(g)
  }
  return undefined
}

/** Repair-what-you-can: a malformed swatch is dropped, not fatal. */
function isSwatch(value: unknown): value is Swatch {
  if (!value || typeof value !== 'object') return false
  const s = value as Swatch
  const c = s.color as RGBA | undefined
  return (
    typeof s.id === 'string' &&
    !!c &&
    typeof c.r === 'number' &&
    typeof c.g === 'number' &&
    typeof c.b === 'number' &&
    typeof c.a === 'number'
  )
}

/**
 * Make the tree consistent: drop dangling child references, re-home orphans on
 * the root, and break any parent cycle.
 */
function repairHierarchy(nodes: Record<NodeId, DesignNode>, rootId: NodeId): void {
  const root = nodes[rootId]
  if (!root || !('children' in root)) return

  for (const node of Object.values(nodes)) {
    if ('children' in node) {
      node.children = node.children.filter((id) => !!nodes[id] && id !== node.id)
    }
  }

  // Anything not claimed by a parent becomes a root child.
  const claimed = new Set<NodeId>()
  for (const node of Object.values(nodes)) {
    if ('children' in node) for (const c of node.children) claimed.add(c)
  }

  for (const node of Object.values(nodes)) {
    if (node.id === rootId) continue
    if (!claimed.has(node.id)) {
      node.parentId = rootId
      if (!root.children.includes(node.id)) root.children.push(node.id)
    } else if (!node.parentId || !nodes[node.parentId]) {
      const owner = Object.values(nodes).find(
        (n) => 'children' in n && n.children.includes(node.id),
      )
      node.parentId = owner?.id ?? rootId
    }
  }

  // Cycle guard: a node that cannot reach the root is re-homed on it.
  for (const node of Object.values(nodes)) {
    const seen = new Set<NodeId>([node.id])
    let cur = node.parentId
    while (cur && nodes[cur]) {
      if (seen.has(cur)) {
        node.parentId = rootId
        if (!root.children.includes(node.id)) root.children.push(node.id)
        break
      }
      seen.add(cur)
      cur = nodes[cur]!.parentId
    }
  }
}

// ---------------------------------------------------------------------------
// Binary helpers
// ---------------------------------------------------------------------------

/** ZIP local file header signature, "PK\x03\x04". */
function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const meta = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)

  if (!meta.includes(';base64')) {
    return strToU8(decodeURIComponent(payload))
  }
  try {
    const binary = atob(payload)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = ''
  // Chunked to avoid blowing the argument limit on large images.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${mimeType || 'image/png'};base64,${btoa(binary)}`
}

/** File extension for an asset's MIME type, used for its name inside the zip. */
function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/bmp': 'bmp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
    'image/x-icon': 'ico', 'image/tiff': 'tiff',
  }
  return map[(mimeType || '').toLowerCase()] ?? 'bin'
}

export function suggestFileName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._ -]+/g, '-').trim() || 'Untitled'
  return clean.endsWith(FILE_EXTENSION) ? clean : `${clean}${FILE_EXTENSION}`
}
