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
 * Adobe's "Import text from text files".
 *
 * Reads a plain text file straight into the selected text object, or makes a
 * new one when nothing suitable is selected. Local only, like everything else
 * here: the file never leaves the machine, and no network is involved.
 */

import { containerAtPoint, insertNode, setText } from '../history/Commands'
import { createText } from '../document/NodeFactory'
import { DEFAULT_TEXT_STYLE } from '../document/types'
import { geometryBounds } from '../document/SceneGraph'
import { intrinsicTextSize } from '../text/TextLayout'
import { editorStore, notify } from '../state/EditorStore'
import { getDoc } from '../state/DocumentStore'
import { screenToDoc } from '../canvas/Viewport'
import type { NodeId } from '../document/types'
import type { Vec2 } from '../geometry/Matrix'

const MAX_BYTES = 5 * 1024 * 1024

/** Width of a text box created from a file, when the drop gives no other clue. */
const IMPORT_WIDTH = 480

/** Breathing room left either side when a text box is fitted to an artboard. */
const FIT_MARGIN = 16

/**
 * Anything a text editor would open. Not a whitelist of extensions: a .md, a
 * .csv and a .srt are all just text, and refusing them would be pedantry.
 * The extension check is the fallback for the systems that report no MIME type
 * at all, which is most of them for anything but .txt.
 */
export function isTextFile(file: File): boolean {
  if (file.type.toLowerCase().startsWith('text/')) return true
  return /\.(txt|md|markdown|csv|tsv|log|json|srt|vtt)$/i.test(file.name)
}

export async function importTextIntoSelection(): Promise<boolean> {
  const file = await pickTextFile()
  if (!file) return false

  const text = await readTextFile(file)
  if (text === null) return false

  const doc = getDoc()
  const target = editorStore.getState().selection.find((id) => doc.nodes[id]?.type === 'text')
  // Filling the selected object is the point of the panel button; with nothing
  // selected — which is how the File menu entry is normally used — the file
  // becomes a new object instead.
  if (target) return setText(target, text)
  return placeText(text, { name: file.name }) !== null
}

/** Place a dropped text file at the point it was dropped on. */
export async function importTextFile(file: File, at: Vec2): Promise<NodeId | null> {
  const text = await readTextFile(file)
  if (text === null) return null
  return placeText(text, { name: file.name, at })
}

/**
 * Read and tidy a text file. Returns null when it cannot be used, having said
 * why; the caller only has to stop.
 */
async function readTextFile(file: File): Promise<string | null> {
  if (file.size > MAX_BYTES) {
    notify('error', 'That text file is too large to place in a single text object.')
    return null
  }

  let text: string
  try {
    text = await file.text()
  } catch {
    notify('error', 'That file could not be read.')
    return null
  }
  // A trailing newline from a text file would otherwise show as an empty last
  // line, which is not what the file looks like anywhere else.
  text = text.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  if (!text) {
    notify('info', 'That file is empty.')
    return null
  }
  return text
}

/**
 * Make a new text object holding `text`.
 *
 * Area text rather than a single line: a file's worth of text on one line is
 * unusable, and Auto Height is what Adobe gives you for a block of copy.
 *
 * @param opts.at      where to put it — the top-left corner, or the centre when
 *                     `centred` is set, which is how a paste and a file drop
 *                     both name a position.
 */
export function placeText(
  text: string,
  opts: { name?: string; at?: Vec2; centred?: boolean } = {},
): NodeId | null {
  const editor = editorStore.getState()
  const style = { ...DEFAULT_TEXT_STYLE, sizing: 'auto-height' as const }
  // A trailing newline would show as an empty last line, which is not what the
  // text looked like where it came from.
  const body = text.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  if (!body) return null

  const at =
    opts.at ??
    screenToDoc(editor.viewport, {
      x: editor.canvasSize.width / 2 - (IMPORT_WIDTH * editor.viewport.zoom) / 2,
      y: editor.canvasSize.height / 3,
    })

  // Resolve the container from the point we were given, before the box has a
  // size. Letting insertNode work it out from the top-left instead would put a
  // box centred on a narrow artboard outside it, and land the text on the
  // pasteboard — which is how images already avoid the problem.
  const doc = getDoc()
  const parentId = containerAtPoint(doc, at)
  const width = fitWidth(parentId)
  const height = intrinsicTextSize(body, style, width).height

  const origin =
    opts.centred && opts.at ? { x: at.x - width / 2, y: at.y - height / 2 } : at

  const node = createText(body, { x: origin.x, y: origin.y, width, height }, {}, style)
  if (opts.name) node.name = opts.name.replace(/\.[^.]+$/, '')
  return insertNode(node, parentId)
}

/**
 * The width to pour text into. A 480px column on a 320px phone artboard is not
 * a text box, it is an overflow — so the artboard wins whenever it is narrower.
 */
function fitWidth(parentId: NodeId): number {
  const doc = getDoc()
  if (parentId === doc.rootId) return IMPORT_WIDTH
  const bounds = geometryBounds(doc, parentId)
  if (bounds.width <= 0) return IMPORT_WIDTH
  return Math.max(1, Math.min(IMPORT_WIDTH, bounds.width - FIT_MARGIN * 2))
}

/** One file, as text. Resolves to null when the picker is dismissed. */
function pickTextFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.txt,.md,.csv,.json,text/plain'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    // Dismissing a file dialog fires no event in most browsers, so the promise
    // would hang; `cancel` is the one that does, where it is supported.
    input.oncancel = () => resolve(null)
    input.click()
  })
}
