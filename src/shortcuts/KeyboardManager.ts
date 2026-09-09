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
 * Global keyboard handling.
 *
 * What a key DOES lives in commands.ts and which key does it lives in
 * keymap.ts; this file is only the plumbing between a KeyboardEvent and them.
 * It used to be a long switch, which is why nothing could be rebound — there
 * was no binding to rebind, only code.
 *
 * Three rules keep it from fighting the rest of the app:
 *
 *  1. Nothing fires while focus is in a text input, a textarea, or a
 *     contentEditable — otherwise typing "r" in the layer-rename field would
 *     switch to the rectangle tool.
 *  2. The active tool gets first refusal on every key. A tool that consumes the
 *     event (the pen finishing a path on Enter) stops the global handler.
 *  3. Space to pan and the modifier-drag behaviours are not commands and are
 *     not rebindable: they are held, not pressed, and a chord cannot express
 *     "while this is down".
 *
 * preventDefault is called deliberately, not blanket. Copy, cut and paste opt
 * out of it entirely — see `passthrough` in commands.ts.
 */

import { isTypingTarget } from './focus'
import {
  editorStore,
  popTemporaryTool,
  pushTemporaryTool,
  setEditor,
  setViewport,
  zoomAt,
} from '../state/EditorStore'
import { getDoc } from '../state/DocumentStore'
import { eventChordString } from './chords'
import { commandForChord } from './keymap'
import { viewCommands, type CommandHandlers } from './commands'
import { centerViewport, fitViewport, nextZoomStep } from '../canvas/Viewport'
import { boundsOfNodes, documentBounds } from '../document/SceneGraph'
import { getTool } from '../tools/ToolRegistry'
import type { ToolContext } from '../tools/types'

/** The handlers the commands need; named here for the callers that pass them. */
export type KeyboardHandlers = CommandHandlers

let spaceHeld = false

export function installKeyboard(ctx: ToolContext, handlers: KeyboardHandlers): () => void {
  // The zoom commands live here but are named in the registry; hand them over
  // before any key can reach it.
  viewCommands.zoomToFit = zoomToFit
  viewCommands.zoomToSelection = zoomToSelection
  viewCommands.zoomTo = zoomTo
  viewCommands.stepZoom = stepZoom

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

    // ---- Space to pan, which is a hold rather than a press ----------------
    if (e.key === ' ' && !e.metaKey && !e.ctrlKey && !spaceHeld) {
      spaceHeld = true
      pushTemporaryTool('hand')
      e.preventDefault()
      return
    }

    const chord = eventChordString(e)
    if (!chord) return

    const command = commandForChord(chord)
    if (!command) return

    if (!command.passthrough) e.preventDefault()
    command.run(handlers)
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ' && spaceHeld) {
      spaceHeld = false
      popTemporaryTool()
    }
    // The measure overlay is held open by a key, and a key coming up produces
    // no pointer event — nothing else would ever take it down.
    if (!e.altKey && editorStore.getState().measureTo) setEditor({ measureTo: null })
  }

  const onBlur = () => {
    // A key held while the window loses focus would otherwise stick.
    if (spaceHeld) {
      spaceHeld = false
      popTemporaryTool()
    }
    if (editorStore.getState().measureTo) setEditor({ measureTo: null })
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


