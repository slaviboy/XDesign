/**
 * Editor (UI) state — everything that is NOT part of the saved document.
 *
 * Kept strictly separate from DocumentStore so that changing tool, panning, or
 * hovering a layer never marks the document dirty, never lands in undo history,
 * and never triggers an autosave.
 */

import { createStore } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import type { NodeId } from '../document/types'
import type { Bounds } from '../geometry/Bounds'

/** One path point (or one of its two handles), addressed unambiguously. */
export interface PointRef {
  subpath: number
  index: number
  kind: 'anchor' | 'in' | 'out'
}

export type ToolId =
  | 'select'
  | 'direct-select'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'line'
  | 'pen'
  | 'pencil'
  | 'text'
  | 'artboard'
  | 'zoom'
  | 'hand'

export type WorkspaceTab = 'design' | 'prototype' | 'share'

export interface Viewport {
  /** Screen-space translation of the document origin, in CSS pixels. */
  x: number
  y: number
  zoom: number
}

export interface Notification {
  id: string
  kind: 'info' | 'warn' | 'error' | 'success'
  message: string
  detail?: string
  timestamp: number
}

export type DialogId =
  | 'export'
  | 'preferences'
  | 'shortcuts'
  | 'about'
  | 'new-document'
  | 'artboard-preset'
  | 'recover'
  | null

/** A live smart-guide line drawn during a snapped drag. */
export interface SnapGuide {
  axis: 'x' | 'y'
  position: number
  start: number
  end: number
  kind: 'edge' | 'center' | 'guide' | 'grid' | 'spacing'
}

export interface EditorState {
  tool: ToolId
  /** Set while space is held so the hand tool can restore the previous tool. */
  toolBeforeTemporary: ToolId | null
  tab: WorkspaceTab

  selection: NodeId[]
  hoverId: NodeId | null
  /**
   * The group or artboard the user has "entered" by double-clicking. While set,
   * clicks select its direct children rather than resolving to the outermost group.
   */
  editingContext: NodeId | null
  /** Text node currently being edited inline. */
  editingTextId: NodeId | null
  /** Artboard whose on-canvas name label is being renamed inline. */
  renamingArtboardId: NodeId | null
  /** Path node the pen tool is currently building or editing. */
  penTargetId: NodeId | null
  /** Node whose gradient handles are shown on canvas, while the picker is open. */
  gradientEditing: { nodeId: NodeId; target: 'fill' | 'stroke' } | null
  /** Gradient stop selected on the canvas widget, so Delete knows which to remove. */
  activeGradientStop: string | null
  /** Path nodes whose Bezier points are shown for direct editing. */
  nodeEditingId: NodeId | null
  /**
   * Selected path points, each carrying its SUBPATH as well as its index.
   *
   * The subpath is load-bearing, not decoration: a bare index meant Delete
   * removed that index from every subpath at once, which quietly punched the
   * hole out of a boolean-subtract donut, and made the selected highlight
   * appear on the matching point of every ring.
   */
  selectedPoints: PointRef[]

  viewport: Viewport
  canvasSize: { width: number; height: number }

  /** Live overlay state, updated during gestures without touching the document. */
  marquee: Bounds | null
  snapGuides: SnapGuide[]
  dropIndicator: { x: number; y: number; label: string } | null

  /**
   * Whether a box's four corners are edited together or individually.
   *
   * null means "derive from the data" — a shape whose radii already differ
   * opens in independent mode. An explicit choice overrides that, so switching
   * to independent with all corners at 0 stays independent.
   */
  cornerRadiusMode: 'uniform' | 'independent' | null

  /** Bumped by tools to force an overlay repaint without touching the document. */
  overlayTick: number

  snapEnabled: boolean
  dialog: DialogId
  notifications: Notification[]

  inspectorWidth: number
  layersHeight: number
  isDragging: boolean
}

const DEFAULT_VIEWPORT: Viewport = { x: 80, y: 80, zoom: 0.6 }

export const editorStore = createStore<EditorState>()(
  subscribeWithSelector((): EditorState => ({
    tool: 'select',
    toolBeforeTemporary: null,
    tab: 'design',

    selection: [],
    hoverId: null,
    editingContext: null,
    editingTextId: null,
    renamingArtboardId: null,
    penTargetId: null,
    gradientEditing: null,
    activeGradientStop: null,
    nodeEditingId: null,
    selectedPoints: [],

    viewport: { ...DEFAULT_VIEWPORT },
    canvasSize: { width: 1200, height: 800 },

    marquee: null,
    snapGuides: [],
    dropIndicator: null,

    cornerRadiusMode: null,

    overlayTick: 0,

    snapEnabled: true,
    dialog: null,
    notifications: [],

    inspectorWidth: 260,
    layersHeight: 300,
    isDragging: false,
  })),
)

/**
 * Invoked with the OUTGOING tool id whenever the tool changes.
 *
 * Registered by the app rather than imported here, because EditorStore cannot
 * reach the tool registry without a cycle. Without this, Tool.onDeactivate was
 * dead code — nothing called it — so switching tools mid-gesture left the old
 * tool's session open, its LiveTransform overrides applied, and isDragging
 * stuck true, with no way back short of a reload.
 */
let deactivateHandler: ((outgoing: ToolId) => void) | null = null

export function setToolDeactivateHandler(fn: ((outgoing: ToolId) => void) | null): void {
  deactivateHandler = fn
}

export const getEditor = () => editorStore.getState()
export const setEditor = (partial: Partial<EditorState>) => editorStore.setState(partial)

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * @param keepEditing preserve an in-progress inline text edit. The text tool
 *   hands control back to the selection tool immediately after creating a text
 *   box, and must not tear down the editor it just opened.
 */
export function setTool(tool: ToolId, keepEditing = false): void {
  const s = editorStore.getState()
  if (s.tool === tool) return
  // Let the outgoing tool tear down first: it may hold an open gesture whose
  // pointerup will now be delivered to a different tool entirely.
  deactivateHandler?.(s.tool)
  editorStore.setState({
    tool,
    toolBeforeTemporary: null,
    // Leaving a vector tool ends whatever it was building.
    penTargetId: tool === 'pen' ? s.penTargetId : null,
    editingTextId: keepEditing ? s.editingTextId : null,
    // Both pointers keep the point overlay; every other tool drops it.
    nodeEditingId: tool === 'select' || tool === 'direct-select' ? s.nodeEditingId : null,
  })
}

/**
 * Space-to-pan: swap in the hand tool, remembering what to restore.
 *
 * This tears the outgoing tool down exactly as setTool does. Holding space is
 * the single most likely way to change tools mid-gesture — it is a reflex, not
 * a decision — so skipping teardown here would leave the very hole setTool
 * closes.
 */
export function pushTemporaryTool(tool: ToolId): void {
  const s = editorStore.getState()
  if (s.toolBeforeTemporary !== null || s.tool === tool) return
  deactivateHandler?.(s.tool)
  editorStore.setState({ toolBeforeTemporary: s.tool, tool })
}

export function popTemporaryTool(): void {
  const s = editorStore.getState()
  if (s.toolBeforeTemporary === null) return
  deactivateHandler?.(s.tool)
  editorStore.setState({ tool: s.toolBeforeTemporary, toolBeforeTemporary: null })
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function setSelection(ids: readonly NodeId[]): void {
  const current = editorStore.getState().selection
  if (current.length === ids.length && current.every((id, i) => id === ids[i])) return
  // Drop the explicit corner mode: the new selection derives its own from data.
  editorStore.setState({
    selection: [...ids],
    selectedPoints: [],
    cornerRadiusMode: null,
  })
}

export function setCornerRadiusMode(mode: 'uniform' | 'independent'): void {
  editorStore.setState({ cornerRadiusMode: mode })
}

export function addToSelection(ids: readonly NodeId[]): void {
  const set = new Set(editorStore.getState().selection)
  for (const id of ids) set.add(id)
  editorStore.setState({ selection: [...set] })
}

export function removeFromSelection(ids: readonly NodeId[]): void {
  const drop = new Set(ids)
  editorStore.setState({
    selection: editorStore.getState().selection.filter((id) => !drop.has(id)),
  })
}

export function toggleSelection(id: NodeId): void {
  const s = editorStore.getState().selection
  if (s.includes(id)) removeFromSelection([id])
  else addToSelection([id])
}

export function clearSelection(): void {
  const s = editorStore.getState()
  if (s.selection.length === 0 && !s.editingContext) return
  editorStore.setState({
    selection: [],
    editingContext: null,
    nodeEditingId: null,
    selectedPoints: [],
  })
}

export function enterGroup(id: NodeId): void {
  editorStore.setState({ editingContext: id })
}

export function exitGroup(): void {
  editorStore.setState({ editingContext: null })
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 64

export function setViewport(v: Partial<Viewport>): void {
  const cur = editorStore.getState().viewport
  const zoom = v.zoom !== undefined ? clampZoom(v.zoom) : cur.zoom
  editorStore.setState({ viewport: { x: v.x ?? cur.x, y: v.y ?? cur.y, zoom } })
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/** Zoom about a fixed screen point, so the point under the cursor stays put. */
export function zoomAt(screenX: number, screenY: number, nextZoom: number): void {
  const { viewport } = editorStore.getState()
  const zoom = clampZoom(nextZoom)
  if (zoom === viewport.zoom) return
  const k = zoom / viewport.zoom
  editorStore.setState({
    viewport: {
      zoom,
      x: screenX - (screenX - viewport.x) * k,
      y: screenY - (screenY - viewport.y) * k,
    },
  })
}

export function panBy(dx: number, dy: number): void {
  const { viewport } = editorStore.getState()
  editorStore.setState({ viewport: { ...viewport, x: viewport.x + dx, y: viewport.y + dy } })
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

let notificationSeq = 0

export function notify(
  kind: Notification['kind'],
  message: string,
  detail?: string,
  ttlMs = 5000,
): string {
  const id = `notif${++notificationSeq}`
  const next: Notification = { id, kind, message, detail, timestamp: Date.now() }
  editorStore.setState({ notifications: [...editorStore.getState().notifications, next] })
  if (ttlMs > 0) {
    setTimeout(() => dismissNotification(id), ttlMs)
  }
  return id
}

export function dismissNotification(id: string): void {
  editorStore.setState({
    notifications: editorStore.getState().notifications.filter((n) => n.id !== id),
  })
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/** Force the overlay layer to repaint (drawing previews, pen rubber-band). */
export function refreshOverlay(): void {
  editorStore.setState({ overlayTick: editorStore.getState().overlayTick + 1 })
}

export function openDialog(dialog: Exclude<DialogId, null>): void {
  editorStore.setState({ dialog })
}

export function closeDialog(): void {
  editorStore.setState({ dialog: null })
}
