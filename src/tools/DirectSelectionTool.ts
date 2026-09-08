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
 * Direct Selection — the second pointer.
 *
 * Where the normal pointer resolves a click up to the outermost group and moves
 * whole objects, this one goes straight to the leaf and shows its points. A
 * single click on a rectangle puts its four corners on screen; a click on a line
 * shows its two ends. Nothing is written to the document by looking: the shape
 * only becomes an editable path when a point is actually moved, so a rectangle
 * keeps its Corners and Radius fields until you commit to editing it.
 *
 * All the point-level work is PathEditing's; this file is only the entry point.
 */

import { hitTest, isEffectivelyLocked } from '../document/SceneGraph'
import {
  beginPathEditing,
  isPointEditable,
  pathEditDoubleClick,
  pathEditKeyDown,
  pathEditPointerDown,
  pathEditPointerMove,
  pathEditPointerUp,
} from './PathEditing'
import { clearSelection, editorStore, setEditor, setSelection } from '../state/EditorStore'
import type { CanvasPointerEvent, Tool, ToolContext } from './types'

export const directSelectionTool: Tool = {
  id: 'direct-select',
  cursor: 'default',
  label: 'Direct Selection',
  shortcut: 'D',

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    // Points own the pointer whenever they are on screen.
    if (editorStore.getState().nodeEditingId && pathEditPointerDown(e, ctx)) return

    const doc = ctx.doc()
    // The LEAF, not the outermost group: reaching inside a group without
    // *entering* it is the whole point of this tool.
    const hit = hitTest(doc, e.doc, { tolerance: ctx.tolerance(), deep: true })
    if (!hit) {
      clearSelection()
      return
    }
    if (isEffectivelyLocked(doc, hit)) return

    setSelection([hit])
    if (isPointEditable(doc.nodes[hit])) {
      // This order matters: setSelection notifies the store while nodeEditingId
      // is still null, and the Canvas subscriber closes point editing on that.
      setEditor({ nodeEditingId: hit })
      beginPathEditing(hit)
      // Hand this same press to the point editor, so clicking straight onto an
      // anchor starts dragging it in one gesture rather than two.
      pathEditPointerDown(e, ctx)
    } else {
      // Text, images and groups have no points; select them and stop.
      setEditor({ nodeEditingId: null, selectedPoints: [] })
    }
  },

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (editorStore.getState().nodeEditingId && pathEditPointerMove(e, ctx)) return

    const doc = ctx.doc()
    const hit = hitTest(doc, e.doc, { tolerance: ctx.tolerance(), deep: true })
    if (hit !== editorStore.getState().hoverId) setEditor({ hoverId: hit })
  },

  onPointerUp(): void {
    pathEditPointerUp()
  },

  onDoubleClick(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (editorStore.getState().nodeEditingId) pathEditDoubleClick(e, ctx)
  },

  onKeyDown(e: KeyboardEvent): boolean {
    return pathEditKeyDown(e)
  },

  onDeactivate(): void {
    // Point editing is NOT ended here: `nodeEditingId` owns its lifetime and the
    // Canvas subscriber closes it when setTool clears that. Ending it here would
    // stop the two pointers handing the points back and forth.
    setEditor({ hoverId: null })
  },
}
