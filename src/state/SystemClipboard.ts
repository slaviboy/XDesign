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
 * The operating system's clipboard.
 *
 * Everything that crosses the boundary between this app and the rest of the
 * machine lives here; `Clipboard.ts` next door stays about the scene graph.
 *
 * Two rules shape the whole module:
 *
 *  1. **Never call preventDefault on Cmd+V.** Doing so suppresses the browser's
 *     native `paste` event, which is the only way to read the clipboard without
 *     a permission prompt. The keyboard layer therefore leaves copy, cut and
 *     paste alone and the handlers below do the work.
 *  2. **Our own copy is recognised and not re-imported.** A copy writes SVG to
 *     the OS clipboard so other applications can use it; pasting that SVG back
 *     into this app would flatten the gradients, groups and image assets the
 *     internal clipboard was keeping. The SVG carries a stamp naming the copy it
 *     came from, and a paste that sees the current stamp uses the internal
 *     payload instead.
 */

import {
  claimSystemWrite, currentClipId, externalPasteTarget, paste, setSystemClipboardWriter,
} from './Clipboard'
import { editorStore, notify } from './EditorStore'
import { getDoc } from './DocumentStore'
import { createMatrixCache, renderBoundsOfNodes } from '../document/SceneGraph'
import { exportNodesToSvg } from '../svg/SvgExporter'
import { runExport } from '../export/ExportPipeline'
import { importClipboardPayload } from '../images/ImageImporter'
import { isTypingTarget } from '../shortcuts/focus'
import type { NodeId } from '../document/types'
import type { Vec2 } from '../geometry/Matrix'

/** What a paste has to work with, however it was read. */
export interface ClipboardPayload {
  files: File[]
  text: string | null
  /** The clip id stamped into `text`, when the SVG on the clipboard is ours. */
  clipId: string | null
}

/**
 * Marks the SVG we write as ours. Placed inside the root element so the markup
 * still parses — and still matches the `/^<svg/` test the importer uses — for
 * any application that receives it.
 */
const STAMP_PREFIX = 'xdesign-clip:'
const STAMP_RE = new RegExp(`<!--\\s*${STAMP_PREFIX}([a-z0-9]+)\\s*-->`, 'i')

/**
 * The same stamp in its own flavour, set synchronously during the copy event.
 *
 * The SVG and the PNG both come from asynchronous exporters, so for a few tens
 * of milliseconds after Cmd+C the clipboard has been claimed but not yet filled.
 * A Cmd+V inside that window would otherwise find whatever was on the clipboard
 * beforehand and import that instead of the copy just made. This lands with the
 * event itself, so the window is covered. It carries no user-visible text, so
 * nothing leaks into a paste made in another application.
 */
const STAMP_TYPE = 'application/x-xdesign-clip'

/**
 * The raster written alongside the markup. 2× is the scale a screenshot pasted
 * into a chat wants; anything that would exceed the budget drops to 1× rather
 * than failing, because a copy that silently produces nothing is worse than a
 * copy at half the resolution.
 */
const PNG_SCALE = 2
const PNG_MAX_PIXELS = 16_000_000

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Build the flavours for a selection.
 *
 * `text/plain` is the characters themselves when everything copied is text —
 * copying a headline and pasting it into a chat should produce the headline,
 * not a screenful of XML. Otherwise it is the markup, which is what a code
 * editor or Illustrator wants.
 */
async function buildFlavors(
  ids: readonly NodeId[],
): Promise<{ svg: string; plain: string } | null> {
  const doc = getDoc()
  const bounds = renderBoundsOfNodes(doc, ids, createMatrixCache())
  if (!bounds.width && !bounds.height) return null

  const { svg } = await exportNodesToSvg(doc, ids, {
    bounds,
    imageHandling: 'embed',
    textHandling: 'reference',
  })
  const stamped = stamp(svg, currentClipId())

  const texts = ids.map((id) => doc.nodes[id]).filter((n) => n?.type === 'text')
  const plain =
    texts.length === ids.length && texts.length > 0
      ? texts.map((n) => (n && 'text' in n ? n.text : '')).join('\n')
      : stamped

  return { svg: stamped, plain }
}

/** Append the provenance marker just before the closing tag. */
function stamp(svg: string, clipId: string | null): string {
  if (!clipId) return svg
  const marker = `<!--${STAMP_PREFIX}${clipId}-->`
  const close = svg.lastIndexOf('</svg>')
  return close < 0 ? svg + marker : svg.slice(0, close) + marker + svg.slice(close)
}

/**
 * A PNG of the selection, so a copy pastes as a picture into applications that
 * cannot read SVG markup. Best effort — a failure here must not cost the text
 * flavours that already succeeded.
 */
async function renderPng(ids: readonly NodeId[]): Promise<Blob | null> {
  try {
    const doc = getDoc()
    const bounds = renderBoundsOfNodes(doc, ids, createMatrixCache())
    if (bounds.width <= 0 || bounds.height <= 0) return null

    const wanted = bounds.width * bounds.height * PNG_SCALE * PNG_SCALE
    const scale = wanted > PNG_MAX_PIXELS ? 1 : PNG_SCALE
    if (bounds.width * bounds.height * scale * scale > PNG_MAX_PIXELS) return null

    const { blob } = await runExport(doc, {
      format: 'png',
      area: 'selection',
      nodeIds: ids,
      scale,
      background: null,
    })
    return blob
  } catch {
    return null
  }
}

/**
 * The text the last write put on the clipboard, and the copy it came from.
 *
 * An all-text copy writes the characters rather than the stamped markup, so
 * there is no stamp to find when it comes back — without this a paste from the
 * menu took the PNG beside it for a picture from somewhere else.
 */
let written: { clipId: string; plain: string } | null = null

/**
 * The write still under way. Rendering the PNG takes a moment, and until the
 * write lands the clipboard holds whatever was there before — so a Paste from
 * the menu right after Copy would import that instead.
 */
let inflight: Promise<void> | null = null

/**
 * Write the clipboard asynchronously, with the PNG included.
 *
 * Used on its own for a copy from a menu, where there is no native event, and
 * as the second half of a keyboard copy: the synchronous flavours land first and
 * this supersedes them a moment later. If it fails — no `ClipboardItem`, denied
 * permission, an insecure context — whatever was written synchronously stands,
 * so copy never ends up worse off for having tried.
 */
function writeAsync(ids: readonly NodeId[]): Promise<void> {
  const write = writeFlavors(ids)
  inflight = write
  void write.finally(() => {
    if (inflight === write) inflight = null
  })
  return write
}

async function writeFlavors(ids: readonly NodeId[]): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    const flavors = await buildFlavors(ids)
    if (!flavors) return
    const clipId = currentClipId()
    // Trimmed as the readers trim, so the comparison is like for like.
    written = clipId ? { clipId, plain: flavors.plain.trim() } : null

    const png = typeof ClipboardItem === 'undefined' ? null : await renderPng(ids)
    if (png && navigator.clipboard.write) {
      const item: Record<string, Blob> = {
        'image/png': png,
        'text/plain': new Blob([flavors.plain], { type: 'text/plain' }),
      }
      await navigator.clipboard.write([new ClipboardItem(item)])
      return
    }
    await navigator.clipboard.writeText?.(flavors.plain)
  } catch {
    // Clipboard access denied or unavailable; the internal clipboard still works.
  }
}

/**
 * The synchronous half, inside a native `copy`/`cut` event.
 *
 * Only the characters of a text selection can be written here: `setData` takes
 * strings and nothing else, and the SVG and the PNG both come from asynchronous
 * exporters. So this is a floor rather than the real write — it guarantees that
 * copying text puts text on the clipboard even if the async write below is
 * refused, and the async write supersedes it a moment later when it is not.
 */
function writeSync(event: ClipboardEvent, ids: readonly NodeId[]): void {
  // preventDefault regardless: without it the browser also copies whatever DOM
  // text happens to be selected on the page, which is never what was meant.
  event.preventDefault()

  try {
    const data = event.clipboardData
    const clipId = currentClipId()
    if (data && clipId) data.setData(STAMP_TYPE, clipId)

    const doc = getDoc()
    const texts = ids.map((id) => doc.nodes[id]).filter((n) => n?.type === 'text')
    if (data && texts.length === ids.length && texts.length > 0) {
      data.setData('text/plain', texts.map((n) => (n && 'text' in n ? n.text : '')).join('\n'))
    }
  } catch {
    // Nothing to lose: the async write is still coming.
  }

  void writeAsync(ids)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function readClipboardEvent(event: ClipboardEvent): ClipboardPayload {
  const data = event.clipboardData
  if (!data) return { files: [], text: null, clipId: null }
  const text = data.getData('text/plain')?.trim() || null
  // The dedicated flavour first: during the moment between a copy claiming the
  // clipboard and the async write filling it in, it is the only stamp there is.
  const clipId = data.getData(STAMP_TYPE)?.trim() || clipIdOf(text)
  return { files: Array.from(data.files ?? []), text, clipId }
}

/**
 * Read the clipboard without an event, for the menu entries.
 *
 * Chrome prompts for permission the first time; Firefox does not expose this to
 * web content at all. Either way a rejection means "fall back to the internal
 * clipboard", not "fail" — the keyboard path still works everywhere.
 */
export async function readClipboardAsync(): Promise<ClipboardPayload | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.read) return null
    const items = await navigator.clipboard.read()
    const files: File[] = []
    let text: string | null = null

    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (type) {
        const blob = await item.getType(type)
        files.push(new File([blob], `Pasted image.${extensionFor(type)}`, { type }))
      }
      // Read even beside an image: our own copy is exactly that pair, and the
      // text is where the stamp saying so lives. Skipping it pasted a copied
      // artboard back as a picture of itself.
      if (!text && item.types.includes('text/plain')) {
        text = (await (await item.getType('text/plain')).text()).trim() || null
      }
    }
    return { files, text, clipId: clipIdOf(text) }
  } catch {
    return null
  }
}

function clipIdOf(text: string | null): string | null {
  if (!text) return null
  const stamped = STAMP_RE.exec(text)?.[1]
  if (stamped) return stamped
  return written && text === written.plain ? written.clipId : null
}

function extensionFor(mimeType: string): string {
  return mimeType === 'image/svg+xml' ? 'svg' : (mimeType.split('/')[1] ?? 'png')
}

// ---------------------------------------------------------------------------
// Pasting
// ---------------------------------------------------------------------------

/**
 * Paste whatever is available, from wherever it is.
 * @param opts.event the native paste event, when there is one
 * @param opts.at    world point to centre on; defaults to the target artboard
 */
export async function pasteFromSystem(
  opts: { event?: ClipboardEvent; at?: Vec2 } = {},
): Promise<NodeId[]> {
  // An event's data is fixed when it fires, so only a read made here can wait.
  if (!opts.event && inflight) await inflight
  const payload = opts.event ? readClipboardEvent(opts.event) : await readClipboardAsync()

  // Our own copy, still current: use the full-fidelity payload rather than
  // reading back the flattened markup we wrote for other applications.
  if (payload?.clipId && payload.clipId === currentClipId()) return paste(opts.at)

  if (payload && (payload.files.length > 0 || payload.text)) {
    const at = opts.at ?? externalPasteTarget()
    const created = await importClipboardPayload(payload, at)
    if (created && created.length > 0) return created
  }

  const internal = paste(opts.at)
  if (internal.length === 0) notify('info', 'There is nothing on the clipboard to paste.')
  return internal
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

/**
 * A keyboard paste normally arrives as a native `paste` event. Where a browser
 * declines to send one, this timer notices and falls back to the internal
 * clipboard, so Cmd+V is never simply dead.
 */
let pasteFallback: ReturnType<typeof setTimeout> | null = null
const PASTE_FALLBACK_MS = 150

export function armPasteFallback(): void {
  if (pasteFallback !== null) clearTimeout(pasteFallback)
  pasteFallback = setTimeout(() => {
    pasteFallback = null
    paste()
  }, PASTE_FALLBACK_MS)
}

function disarmPasteFallback(): void {
  if (pasteFallback === null) return
  clearTimeout(pasteFallback)
  pasteFallback = null
}

/** True when the event should be left to whatever has focus. */
function handledElsewhere(event: Event): boolean {
  if (isTypingTarget(event.target)) return true
  // The canvas text editor is a real textarea, so the check above covers it;
  // this catches the window's own listener firing before focus has settled.
  return editorStore.getState().editingTextId !== null
}

export function installSystemClipboard(): () => void {
  const onCopy = (e: ClipboardEvent) => {
    if (handledElsewhere(e)) return
    const ids = claimSystemWrite()
    if (!ids || ids.length === 0) return
    writeSync(e, ids)
  }

  const onPaste = (e: ClipboardEvent) => {
    if (handledElsewhere(e)) return
    disarmPasteFallback()
    e.preventDefault()
    void pasteFromSystem({ event: e })
  }

  window.addEventListener('copy', onCopy)
  window.addEventListener('cut', onCopy)
  window.addEventListener('paste', onPaste)
  setSystemClipboardWriter((ids) => void writeAsync(ids))

  return () => {
    window.removeEventListener('copy', onCopy)
    window.removeEventListener('cut', onCopy)
    window.removeEventListener('paste', onPaste)
    setSystemClipboardWriter(null)
    disarmPasteFallback()
  }
}
