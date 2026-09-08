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
 * Text tool.
 *
 * Click creates an auto-sizing text box that grows with its content; dragging
 * creates a fixed-width box that wraps. Either way the node goes straight into
 * inline editing, so typing starts immediately.
 */

import { boundsFromCorners } from '../geometry/Bounds'
import { createText } from '../document/NodeFactory'
import { hitTest } from '../document/SceneGraph'
import { insertNode } from '../history/Commands'
import { intrinsicTextSize } from '../text/TextLayout'
import { DEFAULT_TEXT_STYLE } from '../document/types'
import {
  editorStore,
  refreshOverlay,
  setEditor,
  setSelection,
  setTool,
} from '../state/EditorStore'
import type { Bounds } from '../geometry/Bounds'
import type { Vec2 } from '../geometry/Matrix'
import type { CanvasPointerEvent, Tool, ToolContext } from './types'

const DRAG_THRESHOLD_PX = 4

let start: Vec2 | null = null
let current: Vec2 | null = null

export function getTextDragPreview(): Bounds | null {
  if (!start || !current) return null
  const b = boundsFromCorners(start.x, start.y, current.x, current.y)
  return b.width > 2 || b.height > 2 ? b : null
}

export const textTool: Tool = {
  id: 'text',
  cursor: 'text',
  label: 'Text',
  shortcut: 'T',

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    // Clicking existing text edits it rather than stacking a new box on top.
    const hit = hitTest(ctx.doc(), e.doc, { tolerance: ctx.tolerance() })
    if (hit && ctx.doc().nodes[hit]?.type === 'text') {
      setSelection([hit])
      setEditor({ editingTextId: hit })
      return
    }
    start = e.doc
    current = e.doc
  },

  onPointerMove(e: CanvasPointerEvent): void {
    if (!start) return
    current = e.doc
    refreshOverlay()
  },

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!start) return
    const dragged =
      Math.hypot(e.doc.x - start.x, e.doc.y - start.y) * ctx.viewport().zoom >= DRAG_THRESHOLD_PX
    const origin = start
    const box = current ? boundsFromCorners(origin.x, origin.y, current.x, current.y) : null
    start = null
    current = null
    refreshOverlay()

    const style = { ...DEFAULT_TEXT_STYLE }
    let bounds: Bounds
    if (dragged && box && box.width > 4) {
      style.sizing = 'auto-height'
      bounds = box
    } else {
      style.sizing = 'auto-width'
      const size = intrinsicTextSize('Text', style)
      bounds = { x: origin.x, y: origin.y, width: size.width, height: size.height }
    }

    const node = createText(
      'Text',
      { x: bounds.x, y: bounds.y, width: Math.max(8, bounds.width), height: Math.max(8, bounds.height) },
      {},
      style,
    )
    const id = insertNode(node)
    // Order matters: switch first, then open the editor, so setTool cannot
    // clear the editingTextId we are about to set.
    setTool('select')
    setEditor({ editingTextId: id })
  },

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      if (start) {
        start = null
        current = null
        refreshOverlay()
        return true
      }
      if (editorStore.getState().editingTextId) {
        setEditor({ editingTextId: null })
        return true
      }
    }
    return false
  },

  onDeactivate(): void {
    start = null
    current = null
  },
}
