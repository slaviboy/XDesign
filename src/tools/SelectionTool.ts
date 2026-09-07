/**
 * The selection tool.
 *
 * Handles click, shift-click, marquee, group entry/exit, and the move / resize /
 * rotate gestures. Everything transform-related delegates to DragSession, which
 * owns the 60fps direct-DOM path; this file is only about deciding *what* the
 * user is trying to do.
 */

import {
  boundsFromCorners,
  containsPoint,
  translateBounds,
  type Bounds,
} from '../geometry/Bounds'
import {
  ancestorIds,
  hitTest,
  hitTestAll,
  isEffectivelyLocked,
  nodesInBounds,
} from '../document/SceneGraph'
import {
  beginDrag,
  cancelDrag,
  commitDrag,
  getDragFrame,
  isDragging,
  updateDrag,
  type ResizeHandle,
} from './DragSession'
import { buildSnapContext, resolveSnap, type SnapContext } from './snapHelpers'
import {
  beginPathEditing,
  endPathEditing,
  pathEditKeyDown,
  pathEditPointerDown,
  pathEditPointerMove,
  pathEditPointerUp,
} from './PathEditing'
import {
  addToSelection,
  clearSelection,
  editorStore,
  enterGroup,
  exitGroup,
  removeFromSelection,
  setEditor,
  setSelection,
} from '../state/EditorStore'
import { getDoc } from '../state/DocumentStore'
import type { Mat2D, Vec2 } from '../geometry/Matrix'
import type { NodeId } from '../document/types'
import type { CanvasPointerEvent, Tool, ToolContext } from './types'

type Phase = 'idle' | 'pending' | 'marquee' | 'transform'

interface State {
  phase: Phase
  start: Vec2
  /** Node picked on pointerdown, resolved on pointerup if no drag happened. */
  pendingSelect: NodeId | null
  pendingAdditive: boolean
  snap: SnapContext | null
  latest: Map<NodeId, Mat2D> | null
  /** Selection bounds captured at gesture start, for snapping the moving box. */
  startFrame: Bounds | null
}

const state: State = {
  phase: 'idle',
  start: { x: 0, y: 0 },
  pendingSelect: null,
  pendingAdditive: false,
  snap: null,
  latest: null,
  startFrame: null,
}

/** Movement below this (in screen px) counts as a click, not a drag. */
const DRAG_THRESHOLD_PX = 3

function reset(): void {
  state.phase = 'idle'
  state.pendingSelect = null
  state.pendingAdditive = false
  state.snap = null
  state.latest = null
  state.startFrame = null
}

/**
 * Resolve a click to the node that should become selected.
 *
 * Outside a group, clicking any descendant selects the outermost group, which is
 * what makes groups feel like single objects. Inside an entered group (after a
 * double-click), clicks resolve to that group's direct children instead.
 */
function resolvePick(point: Vec2, tolerance: number): NodeId | null {
  const doc = getDoc()
  const context = editorStore.getState().editingContext

  if (context && doc.nodes[context]) {
    const inner = hitTest(doc, point, { tolerance, deep: true, within: context })
    if (inner) {
      // Climb back up to the direct child of the entered container.
      const chain = [inner, ...ancestorIds(doc, inner)]
      const idx = chain.indexOf(context)
      if (idx > 0) return chain[idx - 1]!
      return inner
    }
    return null
  }
  return hitTest(doc, point, { tolerance })
}

export const selectionTool: Tool = {
  id: 'select',
  cursor: 'default',
  label: 'Select',
  shortcut: 'V',

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    const editor = editorStore.getState()
    const doc = ctx.doc()
    state.start = e.doc
    state.latest = null

    // While a path's points are shown, they own the pointer.
    if (editor.nodeEditingId && pathEditPointerDown(e, ctx)) return

    // 1. A selection handle takes priority over anything underneath it.
    if (e.targetHandle) {
      const ids = editor.selection.filter((id) => !isEffectivelyLocked(doc, id))
      if (ids.length === 0) return
      const mode = e.targetHandle === 'rotate' ? 'rotate' : 'resize'
      const handle = mode === 'resize' ? (e.targetHandle as ResizeHandle) : null
      if (beginDrag(doc, ids, mode, e.doc, handle)) {
        state.phase = 'transform'
        state.startFrame = getDragFrame()
        state.snap =
          mode === 'resize'
            ? buildSnapContext(doc, new Set(ids), ctx.viewport(), editor.canvasSize, editor.snapEnabled)
            : null
      }
      return
    }

    // 2. Something under the pointer.
    const pick = resolvePick(e.doc, ctx.tolerance())
    if (pick) {
      const already = editor.selection.includes(pick)

      if (e.shiftKey) {
        if (already) {
          // Removal is deferred to pointerup so shift-DRAGGING an already
          // selected object still moves the whole selection instead of
          // dropping it out from under the cursor.
          state.pendingSelect = pick
          state.pendingAdditive = true
        } else {
          // Extend immediately; deferring here and toggling on pointerup would
          // add then remove in the same gesture, a no-op.
          addToSelection([pick])
        }
      } else if (!already) {
        setSelection([pick])
      } else {
        state.pendingSelect = pick
        state.pendingAdditive = false
      }

      const ids = editorStore.getState().selection.filter((id) => !isEffectivelyLocked(doc, id))
      if (ids.length && beginDrag(doc, ids, 'move', e.doc)) {
        state.phase = 'pending'
        state.startFrame = getDragFrame()
        state.snap = buildSnapContext(
          doc,
          new Set(ids),
          ctx.viewport(),
          editor.canvasSize,
          editor.snapEnabled,
        )
      }
      return
    }

    // 3. Empty canvas: marquee.
    if (!e.shiftKey) clearSelection()
    state.phase = 'marquee'
    setEditor({ marquee: { x: e.doc.x, y: e.doc.y, width: 0, height: 0 } })
  },

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (editorStore.getState().nodeEditingId && pathEditPointerMove(e, ctx)) return

    if (state.phase === 'idle') {
      // Hover feedback only.
      const pick = resolvePick(e.doc, ctx.tolerance())
      if (pick !== editorStore.getState().hoverId) setEditor({ hoverId: pick })
      return
    }

    const movedPx =
      Math.hypot(e.doc.x - state.start.x, e.doc.y - state.start.y) * ctx.viewport().zoom

    if (state.phase === 'pending') {
      if (movedPx < DRAG_THRESHOLD_PX) return
      state.phase = 'transform'
      state.pendingSelect = null
    }

    if (state.phase === 'marquee') {
      setEditor({
        marquee: boundsFromCorners(state.start.x, state.start.y, e.doc.x, e.doc.y),
      })
      return
    }

    if (state.phase === 'transform' && isDragging()) {
      // Snapping applies to the moving selection box, not the raw pointer, so an
      // object's edge lands exactly on its neighbour's rather than near it.
      let snapDelta: Vec2 | undefined
      let snapLines
      if (state.snap && state.startFrame && !e.primaryModifier) {
        const raw = { x: e.doc.x - state.start.x, y: e.doc.y - state.start.y }
        const moved = translateBounds(state.startFrame, raw.x, raw.y)
        const snap = resolveSnap(moved, state.snap)
        snapDelta = { x: snap.dx, y: snap.dy }
        snapLines = snap.lines
      }
      state.latest = updateDrag(e.doc, {
        constrain: e.shiftKey,
        fromCenter: e.altKey,
        snapDelta,
        snapLines,
      })
    }
  },

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    const editor = editorStore.getState()
    if (editor.nodeEditingId && pathEditPointerUp()) return

    if (state.phase === 'marquee') {
      const box = editor.marquee
      if (box && (box.width > 1 || box.height > 1)) {
        const found = nodesInBounds(ctx.doc(), box, {
          crossing: e.altKey,
          within: editor.editingContext ?? undefined,
        })
        if (e.shiftKey) addToSelection(found)
        else setSelection(found)
      }
      setEditor({ marquee: null })
      reset()
      return
    }

    if (state.phase === 'pending' || state.phase === 'transform') {
      commitDrag(state.latest)
      // A click that never became a drag resolves the deferred selection.
      if (state.phase === 'pending' && state.pendingSelect) {
        if (state.pendingAdditive) removeFromSelection([state.pendingSelect])
        else setSelection([state.pendingSelect])
      }
    }
    reset()
  },

  onDoubleClick(e: CanvasPointerEvent, ctx: ToolContext): void {
    const doc = ctx.doc()
    const deep = hitTest(doc, e.doc, { tolerance: ctx.tolerance(), deep: true })
    if (!deep) return

    const node = doc.nodes[deep]
    // Double-clicking text goes straight to editing it.
    if (node?.type === 'text') {
      setSelection([deep])
      setEditor({ editingTextId: deep })
      return
    }
    // Double-clicking a path enters point-editing mode.
    if (node?.type === 'path') {
      setSelection([deep])
      setEditor({ nodeEditingId: deep })
      beginPathEditing(deep)
      return
    }

    // Otherwise step into the group that contains what was clicked.
    const chain = ancestorIds(doc, deep)
    const context = editorStore.getState().editingContext
    const groups = chain.filter((id) => doc.nodes[id]?.type === 'group' || doc.nodes[id]?.type === 'artboard')
    const currentIdx = context ? groups.indexOf(context) : groups.length
    const next = groups[currentIdx - 1] ?? groups[groups.length - 1]
    if (next) {
      enterGroup(next)
      setSelection([deep])
    } else {
      setSelection([deep])
    }
  },

  onKeyDown(e: KeyboardEvent): boolean {
    if (editorStore.getState().nodeEditingId && pathEditKeyDown(e)) return true

    if (e.key === 'Escape') {
      if (isDragging()) {
        cancelDrag()
        reset()
        return true
      }
      if (editorStore.getState().editingContext) {
        exitGroup()
        return true
      }
      if (editorStore.getState().nodeEditingId) {
        setEditor({ nodeEditingId: null })
        endPathEditing()
        return true
      }
    }
    return false
  },

  onDeactivate(): void {
    if (isDragging()) cancelDrag()
    endPathEditing()
    setEditor({ marquee: null, hoverId: null })
    reset()
  },
}

/** Alt-click cycles through overlapping objects instead of always picking the top. */
export function cycleSelectionAt(point: Vec2, tolerance: number): void {
  const doc = getDoc()
  const hits = hitTestAll(doc, point, { tolerance })
  if (hits.length === 0) return
  const current = editorStore.getState().selection[0]
  const idx = current ? hits.indexOf(current) : -1
  const next = hits[(idx - 1 + hits.length) % hits.length] ?? hits[hits.length - 1]!
  setSelection([next])
}

export function isPointInSelection(point: Vec2, bounds: Bounds | null): boolean {
  return !!bounds && containsPoint(bounds, point)
}
