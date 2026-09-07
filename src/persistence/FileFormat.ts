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
import { DEFAULT_SETTINGS, type DesignDocument, type DesignNode, type ImageAsset, type NodeId } from '../document/types'
import { createDocumentRoot } from '../document/NodeFactory'

export const FORMAT_NAME = 'OfflineDesignDocument'
export const FORMAT_VERSION = 1
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
    guides: DesignDocument['guides']
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
      guides: doc.guides,
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
    if (node && typeof node.id === 'string') nodes[node.id] = node
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

  return {
    id: payload.document?.id ?? `doc${Date.now().toString(36)}`,
    name: payload.document?.name ?? 'Untitled',
    nodes,
    rootId,
    assets,
    guides: Array.isArray(payload.document?.guides) ? payload.document.guides : [],
    settings: { ...DEFAULT_SETTINGS, ...(payload.document?.settings ?? {}) },
    createdAt: payload.document?.createdAt ?? Date.now(),
    modifiedAt: payload.document?.modifiedAt ?? Date.now(),
  }
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
