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
 * Editor (UI) state — everything that is NOT part of the saved document.
 *
 * Kept strictly separate from DocumentStore so that changing tool, panning, or
 * hovering a layer never marks the document dirty, never lands in undo history,
 * and never triggers an autosave.
 */

import { createStore } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ArtboardGrid, NodeId } from '../document/types'
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

/**
 * What a marquee has to do to an object before it counts as selected.
 *
 * 'enclose'  the whole object must be inside the rectangle. Precise, but it
 *            means surrounding everything you want.
 * 'touch'    anything the rectangle so much as clips is selected — dragging a
 *            line through a row of objects takes all of them. The default,
 *            because reaching for a selection is far more common than needing
 *            to exclude a neighbour, and the neighbour is one key away.
 *
 * Alt inverts whichever is chosen, so both are always one key away.
 */
export type MarqueeMode = 'enclose' | 'touch'

export const MARQUEE_MODE_STORAGE_KEY = 'xdesign.marqueeMode'

function readStoredMarqueeMode(): MarqueeMode {
  try {
    return localStorage.getItem(MARQUEE_MODE_STORAGE_KEY) === 'enclose' ? 'enclose' : 'touch'
  } catch {
    // Private mode, or storage blocked: fall through to the default.
    return 'touch'
  }
}

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
  | 'preferences-export'
  | 'preferences-import'
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
  /** The node the selection is being measured against, while Alt is held. */
  measureTo: NodeId | null
  /** How much of an object a marquee must cover to select it. */
  marqueeMode: MarqueeMode
  /**
   * The selected guide, if any.
   *
   * Not part of `selection`: that holds NodeIds, and a guide is not a node. Two
   * separate fields rather than one union because almost everything that reads
   * a selection means nodes, and would have to filter guides back out.
   */
  selectedGuide: { artboardId: NodeId; guideId: string } | null
  /** Text node currently being edited inline. */
  editingTextId: NodeId | null
  /**
   * The characters selected inside the text being edited.
   *
   * Kept in the store rather than read from the textarea because the inspector
   * needs it AFTER the textarea has lost focus to the field being clicked —
   * which is the whole interaction: select a word, then reach for the size.
   * `start === end` is a caret, and still meaningful: it says what typing next
   * would look like.
   */
  textSelection: { nodeId: NodeId; start: number; end: number } | null
  /**
   * Whether the text editor's textarea actually holds focus.
   *
   * A textarea cannot draw mixed styling, so while you are typing it shows the
   * object's base style and the canvas keeps its own text hidden. The moment
   * focus moves to the inspector — which is where formatting a selection
   * happens — the textarea is not the thing being looked at, so it steps aside
   * and the real, formatted rendering takes over. That is the only moment both
   * are possible: they cannot be shown together, because a textarea centres its
   * text in a line box and SVG sits it on a baseline.
   */
  textEditingFocused: boolean
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
  /**
   * A file drag in progress: where the cursor is, what will happen, and which
   * artboard is about to receive it.
   */
  dropIndicator: {
    x: number
    y: number
    label: string
    /** The artboard the file will land in, or null for bare pasteboard. */
    artboardId: NodeId | null
  } | null

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
    measureTo: null,
    marqueeMode: readStoredMarqueeMode(),
    selectedGuide: null,
    editingTextId: null,
    textSelection: null,
    textEditingFocused: false,
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

/** Persisted, because a selection habit should outlive the tab. */
export function setMarqueeMode(mode: MarqueeMode): void {
  editorStore.setState({ marqueeMode: mode })
  try {
    localStorage.setItem(MARQUEE_MODE_STORAGE_KEY, mode)
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
}

/**
 * Adobe's "Make Default": the grid new artboards start with.
 *
 * "This option sets the default grid option for your account. Any new files you
 * open with XD has this new default." — so it belongs in localStorage beside
 * the theme and the marquee mode, not in the document.
 */
export const DEFAULT_GRID_STORAGE_KEY = 'xdesign.defaultGrid'

export function saveDefaultGrid(grid: ArtboardGrid): void {
  try {
    localStorage.setItem(DEFAULT_GRID_STORAGE_KEY, JSON.stringify(grid))
  } catch {
    // Storage blocked: nothing to do, and nothing worth telling the user.
  }
}

/** The saved default, or null. Shape-checked: it is user-editable storage. */
export function readDefaultGrid(): ArtboardGrid | null {
  try {
    const raw = localStorage.getItem(DEFAULT_GRID_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ArtboardGrid
    if (parsed?.type === 'square' && typeof parsed.size === 'number') return parsed
    if (parsed?.type === 'layout' && typeof parsed.columns === 'number') return parsed
    return null
  } catch {
    return null
  }
}

/** Selecting a guide clears the node selection, and the reverse. */
export function selectGuide(artboardId: NodeId, guideId: string): void {
  editorStore.setState({ selectedGuide: { artboardId, guideId }, selection: [] })
}

export function clearGuideSelection(): void {
  if (editorStore.getState().selectedGuide) editorStore.setState({ selectedGuide: null })
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
    textSelection: keepEditing ? s.textSelection : null,
    textEditingFocused: keepEditing ? s.textEditingFocused : false,
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
  const state = editorStore.getState()
  const current = state.selection
  if (
    current.length === ids.length &&
    current.every((id, i) => id === ids[i]) &&
    !state.selectedGuide
  ) {
    return
  }
  // Drop the explicit corner mode: the new selection derives its own from data.
  editorStore.setState({
    selection: [...ids],
    selectedPoints: [],
    cornerRadiusMode: null,
    // Selecting artwork puts a selected guide down: the inspector shows one
    // thing at a time, and a guide is not part of a multi-selection.
    selectedGuide: null,
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
  if (s.selection.length === 0 && !s.editingContext && !s.selectedGuide) return
  editorStore.setState({
    selection: [],
    editingContext: null,
    nodeEditingId: null,
    selectedPoints: [],
    selectedGuide: null,
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

/**
 * Stop editing text, forgetting the selection with it.
 *
 * One function rather than a setEditor call at each site, because the two
 * fields have to be cleared together: a stale selection with no editor would
 * leave the inspector formatting characters nobody can see.
 */
export function endTextEditing(): void {
  editorStore.setState({ editingTextId: null, textSelection: null, textEditingFocused: false })
}

/** Record which characters are selected inside the text being edited. */
export function setTextSelection(nodeId: NodeId, start: number, end: number): void {
  const current = editorStore.getState().textSelection
  if (current && current.nodeId === nodeId && current.start === start && current.end === end) return
  editorStore.setState({ textSelection: { nodeId, start, end } })
}

export function openDialog(dialog: Exclude<DialogId, null>): void {
  editorStore.setState({ dialog })
}

export function closeDialog(): void {
  editorStore.setState({ dialog: null })
}
