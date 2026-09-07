/**
 * Artboard tool. Drag to draw an artboard; click to place one at the last used
 * preset size, which is how it is normally used.
 */

import { boundsFromCorners, type Bounds } from '../geometry/Bounds'
import { ARTBOARD_PRESETS } from '../document/NodeFactory'
import { artboardIds } from '../document/SceneGraph'
import { createArtboardCommand } from '../history/Commands'
import { refreshOverlay, setTool } from '../state/EditorStore'
import { getDoc } from '../state/DocumentStore'
import type { Vec2 } from '../geometry/Matrix'
import type { CanvasPointerEvent, Tool, ToolContext } from './types'

const DRAG_THRESHOLD_PX = 4

let start: Vec2 | null = null
let current: Vec2 | null = null
let lastPreset = ARTBOARD_PRESETS.find((p) => p.label === 'Web 1280') ?? ARTBOARD_PRESETS[0]!

export function setArtboardPreset(label: string): void {
  const found = ARTBOARD_PRESETS.find((p) => p.label === label)
  if (found) lastPreset = found
}

export function getArtboardPreset() {
  return lastPreset
}

export function getArtboardPreview(): Bounds | null {
  if (!start || !current) return null
  return boundsFromCorners(start.x, start.y, current.x, current.y)
}

export const artboardTool: Tool = {
  id: 'artboard',
  cursor: 'crosshair',
  label: 'Artboard',
  shortcut: 'A',

  onPointerDown(e: CanvasPointerEvent): void {
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
    const box = current ? boundsFromCorners(start.x, start.y, current.x, current.y) : null
    const origin = start
    start = null
    current = null
    refreshOverlay()

    const bounds: Bounds =
      dragged && box && box.width > 8 && box.height > 8
        ? box
        : { x: origin.x, y: origin.y, width: lastPreset.width, height: lastPreset.height }

    const n = artboardIds(getDoc()).length + 1
    createArtboardCommand(`Artboard ${n}`, bounds)
    setTool('select')
  },

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && start) {
      start = null
      current = null
      refreshOverlay()
      return true
    }
    return false
  },

  onDeactivate(): void {
    start = null
    current = null
  },
}
