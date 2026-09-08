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
 * Zoom and Hand.
 *
 * Both only touch the viewport, never the document, so neither can dirty a file
 * or create an undo entry.
 */

import { boundsFromCorners, type Bounds } from '../geometry/Bounds'
import { fitViewport, nextZoomStep } from '../canvas/Viewport'
import { editorStore, panBy, refreshOverlay, setViewport, zoomAt } from '../state/EditorStore'
import type { Vec2 } from '../geometry/Matrix'
import type { CanvasPointerEvent, Tool, ToolContext } from './types'

const DRAG_THRESHOLD_PX = 6

let zoomStart: Vec2 | null = null
let zoomCurrent: Vec2 | null = null

export function getZoomMarquee(): Bounds | null {
  if (!zoomStart || !zoomCurrent) return null
  const b = boundsFromCorners(zoomStart.x, zoomStart.y, zoomCurrent.x, zoomCurrent.y)
  return b.width > 2 || b.height > 2 ? b : null
}

export const zoomTool: Tool = {
  id: 'zoom',
  cursor: 'zoom-in',
  label: 'Zoom',
  shortcut: 'Z',

  onPointerDown(e: CanvasPointerEvent): void {
    zoomStart = e.doc
    zoomCurrent = e.doc
  },

  onPointerMove(e: CanvasPointerEvent): void {
    if (!zoomStart) return
    zoomCurrent = e.doc
    refreshOverlay()
  },

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!zoomStart) return
    const box = getZoomMarquee()
    const dragged =
      zoomCurrent &&
      Math.hypot(zoomCurrent.x - zoomStart.x, zoomCurrent.y - zoomStart.y) * ctx.viewport().zoom >=
        DRAG_THRESHOLD_PX
    zoomStart = null
    zoomCurrent = null
    refreshOverlay()

    if (dragged && box && box.width > 1 && box.height > 1) {
      setViewport(fitViewport(box, editorStore.getState().canvasSize, 24, 64))
      return
    }
    // Plain click zooms in about the cursor; Alt zooms out.
    const v = ctx.viewport()
    zoomAt(e.screen.x, e.screen.y, nextZoomStep(v.zoom, e.altKey ? -1 : 1))
  },

  onDeactivate(): void {
    zoomStart = null
    zoomCurrent = null
  },
}

let panning = false

export const handTool: Tool = {
  id: 'hand',
  cursor: 'grab',
  label: 'Hand',
  shortcut: 'H',

  onPointerDown(): void {
    panning = true
  },

  onPointerMove(e: CanvasPointerEvent): void {
    if (!panning) return
    // Straight through in screen pixels: the document tracks the cursor 1:1 at
    // any zoom, and nothing here is measured against the viewport this call is
    // about to move.
    panBy(e.deltaScreen.x, e.deltaScreen.y)
  },

  onPointerUp(): void {
    panning = false
  },

  onDeactivate(): void {
    panning = false
  },
}
