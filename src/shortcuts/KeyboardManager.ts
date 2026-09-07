/**
 * Global keyboard handling.
 *
 * Two rules keep this from fighting the rest of the app:
 *
 *  1. Nothing fires while focus is in a text input, a textarea, or a
 *     contentEditable — otherwise typing "r" in the layer-rename field would
 *     switch to the rectangle tool.
 *  2. The active tool gets first refusal on every key. A tool that consumes the
 *     event (the pen finishing a path on Enter) stops the global handler.
 *
 * preventDefault is called deliberately, not blanket: Cmd+S must not open the
 * browser's save dialog and Cmd+D must not bookmark the page, but Cmd+Shift+I
 * and the like are left alone.
 */

import {
  deleteSelection,
  groupSelection,
  maskWithShape,
  setGuidesLocked,
  outlineStrokeSelection,
  moveSelection,
  orderCommand,
  selectAll,
  setLocked,
  setVisibility,
  ungroupSelection,
  updateSettings,
} from '../history/Commands'
import { copySelection, cutSelection, duplicateInPlace, paste } from '../state/Clipboard'
import { redo, undo, getDoc } from '../state/DocumentStore'
import {
  clearSelection,
  editorStore,
  popTemporaryTool,
  pushTemporaryTool,
  setEditor,
  setTool,
  setViewport,
  zoomAt,
} from '../state/EditorStore'
import { centerViewport, fitViewport, nextZoomStep } from '../canvas/Viewport'
import { artboardIds, boundsOfNodes, documentBounds } from '../document/SceneGraph'
import { getTool, TOOL_SHORTCUTS } from '../tools/ToolRegistry'
import type { ToolContext } from '../tools/types'

export interface KeyboardHandlers {
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
  onExport: () => void
  onImport: () => void
  onShortcuts: () => void
}

/** Nudge distances, matching every design tool's convention. */
const NUDGE_SMALL = 1
const NUDGE_LARGE = 10

let spaceHeld = false

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  )
}

export function installKeyboard(ctx: ToolContext, handlers: KeyboardHandlers): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return

    const state = editorStore.getState()
    // Text editing owns the keyboard entirely while it is active.
    if (state.editingTextId) return

    // The active tool gets first refusal.
    if (getTool(state.tool).onKeyDown?.(e, ctx)) {
      e.preventDefault()
      return
    }

    const mod = e.metaKey || e.ctrlKey
    const key = e.key
    const lower = key.length === 1 ? key.toLowerCase() : key

    // ---- Space to pan -----------------------------------------------------
    if (key === ' ' && !mod && !spaceHeld) {
      spaceHeld = true
      pushTemporaryTool('hand')
      e.preventDefault()
      return
    }

    // ---- Modifier combinations -------------------------------------------
    if (mod) {
      switch (lower) {
        case 'z':
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
          return
        case 'y':
          e.preventDefault()
          redo()
          return
        case 'c':
          e.preventDefault()
          copySelection()
          return
        case 'x':
          e.preventDefault()
          cutSelection()
          return
        case 'v':
          e.preventDefault()
          paste()
          return
        case 'd':
          e.preventDefault()
          duplicateInPlace()
          return
        case 'a':
          e.preventDefault()
          selectAll()
          return
        case 'g':
          e.preventDefault()
          if (e.shiftKey) ungroupSelection()
          else groupSelection()
          return
        case 's':
          e.preventDefault()
          if (e.shiftKey) handlers.onSaveAs()
          else handlers.onSave()
          return
        case 'o':
          e.preventDefault()
          // Adobe puts Outline Stroke on the shifted form of the same key.
          if (e.shiftKey) outlineStrokeSelection()
          else handlers.onOpen()
          return
        case 'm':
          // ⇧⌘M is Adobe's Mask With Shape. Unshifted ⌘M is the OS window
          // command, so it is left alone.
          if (!e.shiftKey) return
          e.preventDefault()
          maskWithShape()
          return
        case 'n':
          e.preventDefault()
          handlers.onNew()
          return
        case 'e':
          e.preventDefault()
          handlers.onExport()
          return
        case 'i':
          if (e.shiftKey) {
            e.preventDefault()
            handlers.onImport()
          }
          return
        case 'l':
          e.preventDefault()
          toggleLockSelection()
          return
        case 'h':
          if (e.shiftKey) {
            e.preventDefault()
            toggleVisibilitySelection()
          }
          return
        case ']':
          e.preventDefault()
          orderCommand(e.shiftKey ? 'front' : 'forward')
          return
        case '[':
          e.preventDefault()
          orderCommand(e.shiftKey ? 'back' : 'backward')
          return
        case '0':
          e.preventDefault()
          zoomToFit()
          return
        case '1':
          e.preventDefault()
          zoomTo(1)
          return
        case '2':
          e.preventDefault()
          zoomToSelection()
          return
        case '=':
        case '+':
          e.preventDefault()
          stepZoom(1)
          return
        case '-':
          e.preventDefault()
          stepZoom(-1)
          return
        case "'": {
          e.preventDefault()
          if (e.shiftKey) {
            // Moved here from ⇧⌘; so that key can carry Adobe's Lock Guides.
            // It sits next to ⌘' (toggle grid), which reads well.
            setEditor({ snapEnabled: !editorStore.getState().snapEnabled })
          } else {
            updateSettings({ gridVisible: !getDoc().settings.gridVisible })
          }
          return
        }
        case ';': {
          e.preventDefault()
          if (e.shiftKey) {
            // Adobe's binding for "Lock All Guides", applied to the selected
            // artboards or, with nothing selected, to every artboard.
            const doc = getDoc()
            const selected = editorStore
              .getState()
              .selection.filter((id) => doc.nodes[id]?.type === 'artboard')
            const targets = selected.length ? selected : artboardIds(doc)
            const locked = targets.every((id) => {
              const n = doc.nodes[id]
              return n?.type === 'artboard' && n.guidesLocked
            })
            setGuidesLocked(targets, !locked)
          } else {
            updateSettings({ guidesVisible: !getDoc().settings.guidesVisible })
          }
          return
        }
        case '/':
          e.preventDefault()
          handlers.onShortcuts()
          return
        default:
          return
      }
    }

    // ---- Unmodified keys --------------------------------------------------
    switch (key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        deleteSelection()
        return
      case 'Escape':
        e.preventDefault()
        if (editorStore.getState().editingContext) setEditor({ editingContext: null })
        else clearSelection()
        return
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault()
        const step = e.shiftKey ? NUDGE_LARGE : NUDGE_SMALL
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
        // One coalesce key means a run of arrow presses is a single undo step.
        moveSelection(dx, dy, 'nudge')
        return
      }
      case '?':
        e.preventDefault()
        handlers.onShortcuts()
        return
    }

    // ---- Tool shortcuts ---------------------------------------------------
    const tool = TOOL_SHORTCUTS[lower]
    if (tool && !e.altKey) {
      e.preventDefault()
      setTool(tool)
    }
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ' && spaceHeld) {
      spaceHeld = false
      popTemporaryTool()
    }
  }

  const onBlur = () => {
    // A key held while the window loses focus would otherwise stick.
    if (spaceHeld) {
      spaceHeld = false
      popTemporaryTool()
    }
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  }
}

// ---------------------------------------------------------------------------
// View commands
// ---------------------------------------------------------------------------

export function zoomToFit(): void {
  const doc = getDoc()
  const bounds = documentBounds(doc)
  const size = editorStore.getState().canvasSize
  if (bounds.width <= 0 || bounds.height <= 0) {
    setViewport({ x: size.width / 2, y: size.height / 2, zoom: 1 })
    return
  }
  setViewport(fitViewport(bounds, size, 60, 4))
}

export function zoomToSelection(): void {
  const doc = getDoc()
  const ids = editorStore.getState().selection
  if (ids.length === 0) {
    zoomToFit()
    return
  }
  const bounds = boundsOfNodes(doc, ids)
  if (bounds.width <= 0 && bounds.height <= 0) return
  setViewport(fitViewport(bounds, editorStore.getState().canvasSize, 80, 8))
}

export function zoomToNode(id: string): void {
  const doc = getDoc()
  const bounds = boundsOfNodes(doc, [id])
  if (bounds.width <= 0 && bounds.height <= 0) return
  setViewport(fitViewport(bounds, editorStore.getState().canvasSize, 60, 4))
}

export function zoomTo(zoom: number): void {
  const state = editorStore.getState()
  const ids = state.selection
  const doc = getDoc()
  const focus = ids.length ? boundsOfNodes(doc, ids) : documentBounds(doc)
  if (focus.width > 0 || focus.height > 0) {
    setViewport(centerViewport(focus, state.canvasSize, zoom))
  } else {
    zoomAt(state.canvasSize.width / 2, state.canvasSize.height / 2, zoom)
  }
}

export function stepZoom(direction: 1 | -1): void {
  const state = editorStore.getState()
  zoomAt(
    state.canvasSize.width / 2,
    state.canvasSize.height / 2,
    nextZoomStep(state.viewport.zoom, direction),
  )
}

function toggleLockSelection(): void {
  const doc = getDoc()
  const ids = editorStore.getState().selection
  if (ids.length === 0) return
  const anyUnlocked = ids.some((id) => doc.nodes[id] && !doc.nodes[id]!.locked)
  setLocked(ids, anyUnlocked)
}

function toggleVisibilitySelection(): void {
  const doc = getDoc()
  const ids = editorStore.getState().selection
  if (ids.length === 0) return
  const anyVisible = ids.some((id) => doc.nodes[id]?.visible)
  setVisibility(ids, !anyVisible)
}
