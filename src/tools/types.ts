/**
 * The tool contract.
 *
 * Every tool is a plain object, not a React component, so it can own gesture
 * state across events without re-rendering anything. The Canvas owns pointer
 * capture and coordinate conversion and hands tools an already-resolved event.
 */

import type { ReactNode } from 'react'
import type { Vec2 } from '../geometry/Matrix'
import type { DesignDocument, NodeId } from '../document/types'
import type { EditorState, ToolId, Viewport } from '../state/EditorStore'

export interface CanvasPointerEvent {
  /** Pointer position in canvas-relative CSS pixels. */
  screen: Vec2
  /** Pointer position in document units. */
  doc: Vec2
  /** Movement since the previous event, in document units. */
  deltaDoc: Vec2
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  /** True for Cmd on macOS, Ctrl elsewhere. */
  primaryModifier: boolean
  button: number
  buttons: number
  pointerId: number
  /** Node id resolved from the DOM element under the pointer, if any. */
  targetNodeId: NodeId | null
  /** Selection handle under the pointer, read from the overlay's data attributes. */
  targetHandle: string | null
  /** Which corner that handle belongs to, for rotation and radius handles. */
  targetCorner: string | null
  native: PointerEvent
}

export interface ToolContext {
  doc(): DesignDocument
  editor(): EditorState
  viewport(): Viewport
  screenToDoc(p: Vec2): Vec2
  docToScreen(p: Vec2): Vec2
  /** Hit tolerance in document units — a constant screen distance at any zoom. */
  tolerance(): number
  /** Request an overlay repaint without touching the document. */
  refreshOverlay(): void
}

export interface Tool {
  readonly id: ToolId
  readonly cursor: string
  /** Shown in the tooltip. */
  readonly label: string
  readonly shortcut: string

  onActivate?(ctx: ToolContext): void
  onDeactivate?(ctx: ToolContext): void

  onPointerDown?(e: CanvasPointerEvent, ctx: ToolContext): void
  onPointerMove?(e: CanvasPointerEvent, ctx: ToolContext): void
  onPointerUp?(e: CanvasPointerEvent, ctx: ToolContext): void
  onDoubleClick?(e: CanvasPointerEvent, ctx: ToolContext): void
  onContextMenu?(e: CanvasPointerEvent, ctx: ToolContext): boolean

  /** Return true when the key was consumed, so the global handler stands down. */
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): boolean

  /** Extra SVG drawn in the overlay layer, in screen space. */
  renderOverlay?(ctx: ToolContext): ReactNode
}
