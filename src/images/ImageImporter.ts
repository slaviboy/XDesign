/**
 * Importing dropped, pasted, or picked files.
 *
 * Images are stored as data URLs inside the document, never as blob: or file:
 * URLs. That is the whole reason a saved .xdesign still opens after the original
 * file is deleted, or on a different machine — a temporary object URL would be
 * dead the moment the tab closed.
 *
 * Multiple files import in the order they were dropped, each becoming its own
 * node so they can be arranged individually. Unsupported files are reported once
 * and skipped rather than aborting the whole drop.
 */

import { measureImageDataUrl } from '../export/Rasterizer'
import { createAssetId } from '../document/ids'
import { createImage } from '../document/NodeFactory'
import { addNode } from '../document/DocumentModel'
import { importSvg } from '../svg/SvgImporter'
import { transaction, getDoc } from '../state/DocumentStore'
import { containerAtPoint } from '../history/Commands'
import { notify, setSelection } from '../state/EditorStore'
import { worldMatrix } from '../document/SceneGraph'
import { invert, multiply, type Mat2D } from '../geometry/Matrix'
import type { DesignNode, ImageAsset, NodeId } from '../document/types'
import type { Vec2 } from '../geometry/Matrix'

/** Raster types every current browser can decode from a data URL. */
export const SUPPORTED_IMAGE_TYPES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
  'image/bmp', 'image/x-icon', 'image/avif',
]

/**
 * TIFF has no native browser decoder. It is accepted so the user gets a clear
 * explanation instead of a silent no-op.
 */
const KNOWN_UNDECODABLE = ['image/tiff', 'image/tif']

/** Longest edge a freshly placed image is scaled to, so a 6000px photo is usable. */
const MAX_INITIAL_SIZE = 900

export interface ImportOutcome {
  createdIds: NodeId[]
  skipped: string[]
  warnings: string[]
}

export function isSupportedFile(file: File): boolean {
  const type = file.type.toLowerCase()
  if (type === 'image/svg+xml') return true
  if (SUPPORTED_IMAGE_TYPES.includes(type)) return true
  // Some systems report an empty MIME type; fall back to the extension.
  return /\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i.test(file.name)
}

export async function importFiles(files: FileList | File[], at: Vec2): Promise<ImportOutcome> {
  const list = Array.from(files)
  const outcome: ImportOutcome = { createdIds: [], skipped: [], warnings: [] }

  // Cascade successive drops so several files do not land exactly on top of
  // each other.
  let offset = 0

  for (const file of list) {
    if (!isSupportedFile(file)) {
      if (KNOWN_UNDECODABLE.includes(file.type.toLowerCase())) {
        outcome.warnings.push(`${file.name}: TIFF images cannot be decoded by the browser.`)
      } else {
        outcome.skipped.push(file.name)
      }
      continue
    }

    const point = { x: at.x + offset, y: at.y + offset }
    try {
      const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
      const id = isSvg
        ? await importSvgFile(file, point, outcome)
        : await importImageFile(file, point)
      if (id) {
        outcome.createdIds.push(id)
        offset += 20
      }
    } catch (error) {
      outcome.warnings.push(
        `${file.name}: ${error instanceof Error ? error.message : 'could not be imported'}`,
      )
    }
  }

  reportOutcome(outcome)
  if (outcome.createdIds.length) setSelection(outcome.createdIds)
  return outcome
}

// ---------------------------------------------------------------------------
// Raster images
// ---------------------------------------------------------------------------

export async function importImageFile(file: File, at: Vec2): Promise<NodeId | null> {
  const dataUrl = await readAsDataUrl(file)
  const natural = await measureImageDataUrl(dataUrl).catch(() => null)
  if (!natural) throw new Error('the image data could not be decoded')

  // Fit large images down on entry; aspect ratio is always preserved.
  const longest = Math.max(natural.width, natural.height)
  const fit = longest > MAX_INITIAL_SIZE ? MAX_INITIAL_SIZE / longest : 1
  const width = Math.max(1, Math.round(natural.width * fit))
  const height = Math.max(1, Math.round(natural.height * fit))

  const asset: ImageAsset = {
    id: createAssetId(),
    name: file.name.replace(/\.[^.]+$/, ''),
    mimeType: file.type || guessMimeType(file.name),
    width: natural.width,
    height: natural.height,
    byteSize: file.size,
    dataUrl,
  }

  const node = createImage(asset.id, asset.name, {
    // Drop point is the image's center, which is what the drop indicator shows.
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
  })

  return insertImported(node, { [node.id]: node }, [asset], at)
}

// ---------------------------------------------------------------------------
// SVG files
// ---------------------------------------------------------------------------

async function importSvgFile(file: File, at: Vec2, outcome: ImportOutcome): Promise<NodeId | null> {
  const text = await file.text()
  const result = importSvg(text, file.name.replace(/\.svg$/i, ''))
  outcome.warnings.push(...result.warnings)

  if (!result.rootId) return null

  const root = result.nodes[result.rootId]!
  // Center the import on the drop point.
  const w = root.transform.width || result.size.width || 100
  const h = root.transform.height || result.size.height || 100
  root.transform = { ...root.transform, x: at.x - w / 2, y: at.y - h / 2 }

  return insertImported(root, result.nodes, result.assets, at)
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

/**
 * Splice an imported subtree into the document under whichever container the
 * drop point falls in, re-expressing its position in that container's space.
 */
function insertImported(
  root: DesignNode,
  nodes: Record<NodeId, DesignNode>,
  assets: readonly ImageAsset[],
  at: Vec2,
): NodeId {
  const parentId = containerAtPoint(getDoc(), at)

  transaction(`Import ${root.name}`, (draft) => {
    for (const asset of assets) draft.assets[asset.id] = asset

    // Insert descendants first so parents can reference them.
    for (const node of Object.values(nodes)) {
      if (node.id === root.id) continue
      draft.nodes[node.id] = node
    }
    addNode(draft, root, parentId)

    if (parentId !== draft.rootId) {
      // root.transform.x/y were computed in world space; rebase into the parent.
      const parentWorld: Mat2D = worldMatrix(draft, parentId)
      const world: Mat2D = [1, 0, 0, 1, root.transform.x, root.transform.y]
      const local = multiply(invert(parentWorld), world)
      const inserted = draft.nodes[root.id]!
      inserted.transform = { ...inserted.transform, x: local[4], y: local[5] }
    }
  })

  return root.id
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/**
 * Import whatever is on the system clipboard: image bitmaps, SVG markup, or a
 * data URL pasted as text.
 * @returns the created node ids, or null when the clipboard held nothing usable.
 */
export async function importFromClipboardEvent(
  event: ClipboardEvent,
  at: Vec2,
): Promise<NodeId[] | null> {
  const data = event.clipboardData
  if (!data) return null

  const files = Array.from(data.files ?? [])
  if (files.length > 0) {
    const outcome = await importFiles(files, at)
    return outcome.createdIds
  }

  const text = data.getData('text/plain')?.trim()
  if (text && /^<svg[\s>]/i.test(text)) {
    const file = new File([text], 'Pasted SVG.svg', { type: 'image/svg+xml' })
    const outcome = await importFiles([file], at)
    return outcome.createdIds
  }
  if (text && /^data:image\//.test(text)) {
    const blob = await (await fetch(text)).blob()
    const file = new File([blob], 'Pasted image', { type: blob.type })
    const outcome = await importFiles([file], at)
    return outcome.createdIds
  }
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('the file could not be read'))
    reader.readAsDataURL(file)
  })
}

function guessMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  }
  return map[ext] ?? 'image/png'
}

function reportOutcome(outcome: ImportOutcome): void {
  if (outcome.skipped.length) {
    notify(
      'warn',
      outcome.skipped.length === 1
        ? `${outcome.skipped[0]} is not a supported file type.`
        : `${outcome.skipped.length} files were skipped — unsupported types.`,
    )
  }
  for (const warning of new Set(outcome.warnings)) {
    notify('warn', warning, undefined, 8000)
  }
  if (outcome.createdIds.length && !outcome.warnings.length && !outcome.skipped.length) {
    notify(
      'success',
      outcome.createdIds.length === 1 ? 'Imported 1 item.' : `Imported ${outcome.createdIds.length} items.`,
      undefined,
      2500,
    )
  }
}
