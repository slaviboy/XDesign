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
  /**
   * Movement since the previous event, in canvas-relative CSS pixels.
   *
   * Screen space, not document space, and deliberately so: the only tool that
   * wants a delta is the Hand, and the Hand moves the very viewport a document
   * delta would be measured against. Differencing two document positions taken
   * either side of a pan yields the pointer's ACCELERATION rather than its
   * movement, which is what made panning shake. A screen delta cannot feed back
   * on itself, because screen coordinates do not depend on the viewport at all.
   */
  deltaScreen: Vec2
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
  /**
   * Keep `cursor` in every state: nothing the pointer passes over — a point, a
   * handle, a guide — swaps it for a cursor of its own.
   */
  readonly fixedCursor?: boolean
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
