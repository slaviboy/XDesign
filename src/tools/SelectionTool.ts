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
  beginRadiusDrag,
  cancelRadiusDrag,
  commitRadiusDrag,
  isRadiusDragging,
  updateRadiusDrag,
  type RadiusCorner,
} from './RadiusSession'
import {
  beginStarRatioDrag,
  cancelStarRatioDrag,
  commitStarRatioDrag,
  isStarRatioDragging,
  updateStarRatioDrag,
} from './StarRatioSession'
import {
  beginGradientDrag,
  cancelGradientDrag,
  commitGradientDrag,
  isGradientDragging,
  addStopAt,
  endStop,
  nextGradientStop,
  nudgeGradientStop,
  removeStop,
  updateGradientDrag,
  type GradientHandle,
} from './GradientSession'
import {
  beginPathEditing,
  isPointEditable,
  endPathEditing,
  pathEditDoubleClick,
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
  setTool,
} from '../state/EditorStore'
import { getDoc } from '../state/DocumentStore'
import { isUniformCornerRadius } from '../document/types'
import type { Mat2D, Vec2 } from '../geometry/Matrix'
import type { NodeId } from '../document/types'
import type { CanvasPointerEvent, Tool, ToolContext } from './types'

type Phase = 'idle' | 'pending' | 'marquee' | 'transform' | 'radius' | 'star-ratio' | 'gradient'

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
  /** Which gradient handle a 'gradient' phase started on. */
  gradientHandle: GradientHandle | null
}

const state: State = {
  phase: 'idle',
  start: { x: 0, y: 0 },
  pendingSelect: null,
  pendingAdditive: false,
  snap: null,
  latest: null,
  startFrame: null,
  gradientHandle: null,
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
  state.gradientHandle = null
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

    // 1a. A corner-radius handle. Checked before the transform handles because
    // it sits inside the shape, where a plain click would otherwise start a move.
    if (e.targetHandle === 'radius') {
      const id = editor.selection[0]
      const node = id ? doc.nodes[id] : undefined
      // Independent mode is explicit, or inferred when the corners already differ.
      const independent =
        editor.cornerRadiusMode === 'independent' ||
        (editor.cornerRadiusMode === null &&
          !!node &&
          (node.type === 'rect' || node.type === 'image') &&
          !isUniformCornerRadius(node.cornerRadius))
      if (
        id &&
        beginRadiusDrag(doc, id, (e.targetCorner ?? 'vertex') as RadiusCorner, e.doc, independent)
      ) {
        state.phase = 'radius'
        return
      }
      return
    }

    // 1a-bis. The Star Ratio handle, for the same reason: it sits inside the
    // shape, where a plain click would otherwise start a move.
    if (e.targetHandle === 'star-ratio') {
      const id = editor.selection[0]
      if (id && beginStarRatioDrag(doc, id, e.doc)) {
        state.phase = 'star-ratio'
        return
      }
      return
    }

    // 1a-ter. The on-canvas gradient editor, for the same reason: its segment
    // and dots sit on top of the shape.
    if (e.targetHandle === 'gradient') {
      const editing = editor.gradientEditing
      if (!editing) return
      const corner = (e.targetCorner ?? 'segment') as GradientHandle
      // An end handle sits exactly on the stop at that end, and paints over it.
      // Pressing it selects that stop as well, so the one underneath stays
      // reachable instead of being permanently covered.
      if (corner === 'start' || corner === 'end' || corner === 'radius' || corner === 'angle') {
        const end = corner === 'start' ? 'first' : 'last'
        const stop = endStop(doc, editing.nodeId, editing.target, end)
        if (stop) setEditor({ activeGradientStop: stop })
      }
      if (corner === 'stop') {
        // Selecting a stop is what makes Delete and the picker's fields address
        // it; the drag that may follow moves it along the axis.
        setEditor({ activeGradientStop: e.native?.target instanceof Element
          ? (e.native.target as Element).closest('[data-stop]')?.getAttribute('data-stop') ?? null
          : null })
      }
      if (
        beginGradientDrag(
          doc,
          editing.nodeId,
          editing.target,
          corner,
          editorStore.getState().activeGradientStop,
          e.doc,
        )
      ) {
        state.phase = 'gradient'
        state.gradientHandle = corner
      }
      return
    }

    // 1b. A selection handle takes priority over anything underneath it.
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
    if (state.phase === 'radius') {
      // Self-healing: a tool switch mid-gesture can deliver pointerup elsewhere,
      // and a button-less move here would otherwise keep deforming the shape.
      if (!isRadiusDragging() || e.buttons === 0) {
        cancelRadiusDrag()
        reset()
        return
      }
      updateRadiusDrag(e.doc, ctx.doc())
      return
    }

    if (state.phase === 'star-ratio') {
      // Same self-healing guard as the radius phase above.
      if (!isStarRatioDragging() || e.buttons === 0) {
        cancelStarRatioDrag()
        reset()
        return
      }
      updateStarRatioDrag(e.doc, e.shiftKey)
      return
    }

    if (state.phase === 'gradient') {
      // Same self-healing guard as the phases above.
      if (!isGradientDragging() || e.buttons === 0) {
        cancelGradientDrag()
        reset()
        return
      }
      updateGradientDrag(e.doc, e.shiftKey)
      return
    }

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

    if (state.phase === 'radius') {
      commitRadiusDrag()
      reset()
      return
    }

    if (state.phase === 'star-ratio') {
      commitStarRatioDrag()
      reset()
      return
    }

    if (state.phase === 'gradient') {
      const handle = commitGradientDrag()
      const editing = editorStore.getState().gradientEditing
      // Adobe: "Click anywhere on the gradient editor to add new color stops."
      // A press on the segment that never became a drag is that click.
      if (!handle && editing && state.gradientHandle === 'segment') {
        const added = addStopAt(ctx.doc(), editing.nodeId, editing.target, e.doc)
        if (added) setEditor({ activeGradientStop: added })
      }
      reset()
      return
    }

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
    // Already editing points: a double-click on an anchor converts it, which is
    // XD's binding. It cannot collide with the double-click that ENTERS point
    // editing below, because that only runs when nothing is being edited yet.
    if (editorStore.getState().nodeEditingId && pathEditDoubleClick(e, ctx)) return

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
    // Double-clicking any shape shows its points — a line its two ends, a
    // rectangle its four corners. Text was already handled above, and nothing
    // is written to the document, so this is free until a point actually moves.
    if (isPointEditable(node)) {
      setSelection([deep])
      setEditor({ nodeEditingId: deep })
      beginPathEditing(deep)
      // The rail has to name the mode the canvas is actually in. A double-click
      // puts you on the points, which is Direct Selection's job, so light that
      // button up rather than leaving the arrow claiming to be in charge.
      // setTool carries `nodeEditingId` across between the two pointers, which
      // is what makes this handover free.
      setTool('direct-select')
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

    // While the gradient widget is on screen, its selected stop owns Delete and
    // Tab — otherwise Delete would remove the whole shape out from under it.
    const gradient = editorStore.getState().gradientEditing
    if (gradient) {
      const activeStop = editorStore.getState().activeGradientStop
      if ((e.key === 'Delete' || e.key === 'Backspace') && activeStop) {
        if (removeStop(getDoc(), gradient.nodeId, gradient.target, activeStop)) {
          setEditor({ activeGradientStop: null })
          return true
        }
      }
      if (e.key === 'Tab') {
        const next = nextGradientStop(getDoc(), gradient.nodeId, gradient.target, activeStop, e.shiftKey)
        if (next) {
          setEditor({ activeGradientStop: next })
          return true
        }
      }
      // Arrows nudge the stop. Without claiming them they fall through to the
      // global nudge and move the whole shape instead.
      if (activeStop && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01)
        if (nudgeGradientStop(getDoc(), gradient.nodeId, gradient.target, activeStop, step)) {
          return true
        }
      }
    }

    if (e.key === 'Escape') {
      if (isRadiusDragging()) {
        cancelRadiusDrag()
        reset()
        return true
      }
      if (isStarRatioDragging()) {
        cancelStarRatioDrag()
        reset()
        return true
      }
      if (isGradientDragging()) {
        cancelGradientDrag()
        reset()
        return true
      }
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
    if (isRadiusDragging()) cancelRadiusDrag()
    if (isStarRatioDragging()) cancelStarRatioDrag()
    if (isGradientDragging()) cancelGradientDrag()
    if (isDragging()) cancelDrag()
    // Point editing is NOT torn down here: `nodeEditingId` owns its lifetime, and
    // the Canvas subscriber ends it the moment setTool clears that. Ending it
    // unconditionally would break handing the points to the direct-select tool.
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
