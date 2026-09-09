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
 * Every keyboard command, as data.
 *
 * This used to be a switch inside the key handler, with a separate hand-written
 * list for the shortcuts dialog to display. Two consequences: the dialog could
 * describe a binding that did not exist (⇧⌘' did nothing, because the handler
 * compared against a character Shift never produces), and nothing could be
 * rebound, because there was no binding to rebind — only code.
 *
 * So a command is a record with an id, a default chord and a function. The
 * handler looks up the chord and runs what it finds; the dialog lists the same
 * records; the keymap overrides the chords. None of the three can disagree,
 * because there is only one of them.
 *
 * `id` is the stable identity, and it is what an exported preferences file
 * refers to. Labels change with translation and chords change with the user;
 * the id never does.
 */

import {
  deleteSelection, groupSelection, maskWithShape, moveSelection, orderCommand,
  outlineStrokeSelection, removeGuide, selectAll, setGuidesLocked, setLocked,
  setVisibility, ungroupSelection, updateSettings,
} from '../history/Commands'
import { copySelection, cutSelection, duplicateInPlace } from '../state/Clipboard'
import { armPasteFallback } from '../state/SystemClipboard'
import { redo, undo, getDoc } from '../state/DocumentStore'
import { clearSelection, editorStore, notify, setEditor, setTool } from '../state/EditorStore'
import { togglePenCurvature } from '../tools/PenTool'
import { traceStore } from '../state/TraceStore'
import { cancelImageTrace } from '../history/TraceCommands'
import { artboardIds } from '../document/SceneGraph'
import type { ToolId } from '../state/EditorStore'

/** The application actions a shortcut cannot reach on its own. */
export interface CommandHandlers {
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
  onExport: () => void
  onImport: () => void
  onShortcuts: () => void
}

export interface CommandSpec {
  /** Stable identity. Never translated, never changed. */
  id: string
  group: string
  label: string
  /** Canonical chord, in the platform-neutral form chords.ts defines. */
  defaultChord: string
  /**
   * Extra chords that always work alongside the bound one — Backspace for
   * Delete, ⌘Y for Redo. They are conveniences rather than bindings, so they
   * are neither shown nor editable, and a user binding placed on one of them
   * wins.
   */
  aliases?: string[]
  /**
   * Whether to call preventDefault. Copy, cut and paste must NOT: doing so
   * suppresses the browser's native clipboard events, which are the only way
   * to read what another application copied. That is not an optimisation —
   * it is why ⌘V used to ignore the system clipboard entirely.
   */
  passthrough?: boolean
  run: (handlers: CommandHandlers) => void
}

function tool(id: string, label: string, chord: string, target: ToolId): CommandSpec {
  return { id: `tool.${id}`, group: 'Tools', label, defaultChord: chord, run: () => setTool(target) }
}

export const COMMANDS: CommandSpec[] = [
  // ---- Tools -------------------------------------------------------------
  tool('select', 'Selection', 'V', 'select'),
  tool('direct-select', 'Direct Selection (edit points)', 'D', 'direct-select'),
  tool('rect', 'Rectangle', 'R', 'rect'),
  tool('ellipse', 'Ellipse', 'E', 'ellipse'),
  tool('polygon', 'Polygon (triangle, n-gon or star)', 'Y', 'polygon'),
  tool('line', 'Line', 'L', 'line'),
  tool('pen', 'Pen', 'P', 'pen'),
  tool('pencil', 'Pencil', 'N', 'pencil'),
  tool('text', 'Text', 'T', 'text'),
  tool('artboard', 'Artboard', 'A', 'artboard'),
  tool('zoom', 'Zoom', 'Z', 'zoom'),
  tool('hand', 'Hand', 'H', 'hand'),
  {
    // Illustrator's Curvature tool binding. It is a MODE of the pen here rather
    // than a thirteenth tool, because everything else about drawing — closing,
    // joining, carrying an existing path on — is identical either way.
    id: 'tool.penCurvature',
    group: 'Tools',
    label: 'Pen: curvature mode (smooth through the points)',
    defaultChord: 'Shift+`',
    run: () => {
      if (editorStore.getState().tool !== 'pen') setTool('pen')
      const on = togglePenCurvature()
      notify(
        'info',
        on ? 'Curvature mode on' : 'Curvature mode off',
        on
          ? 'Click along a shape and the curve is faired through every point.'
          : 'Click for corners, click-drag to pull handles.',
        2500,
      )
    },
  },

  // ---- File --------------------------------------------------------------
  { id: 'file.new', group: 'File', label: 'New document', defaultChord: 'Mod+N', run: (h) => h.onNew() },
  { id: 'file.open', group: 'File', label: 'Open…', defaultChord: 'Mod+O', run: (h) => h.onOpen() },
  { id: 'file.save', group: 'File', label: 'Save', defaultChord: 'Mod+S', run: (h) => h.onSave() },
  { id: 'file.saveAs', group: 'File', label: 'Save As…', defaultChord: 'Mod+Shift+S', run: (h) => h.onSaveAs() },
  { id: 'file.export', group: 'File', label: 'Export…', defaultChord: 'Mod+E', run: (h) => h.onExport() },
  { id: 'file.import', group: 'File', label: 'Import…', defaultChord: 'Mod+Shift+I', run: (h) => h.onImport() },

  // ---- Edit --------------------------------------------------------------
  { id: 'edit.undo', group: 'Edit', label: 'Undo', defaultChord: 'Mod+Z', run: () => void undo() },
  {
    id: 'edit.redo',
    group: 'Edit',
    label: 'Redo',
    defaultChord: 'Mod+Shift+Z',
    aliases: ['Mod+Y'],
    run: () => void redo(),
  },
  { id: 'edit.copy', group: 'Edit', label: 'Copy', defaultChord: 'Mod+C', passthrough: true, run: () => void copySelection() },
  { id: 'edit.cut', group: 'Edit', label: 'Cut', defaultChord: 'Mod+X', passthrough: true, run: () => void cutSelection() },
  {
    id: 'edit.paste',
    group: 'Edit',
    label: 'Paste',
    defaultChord: 'Mod+V',
    passthrough: true,
    // Nothing to do here: the browser's native paste event does the work. This
    // only covers a browser that declines to send one.
    run: () => armPasteFallback(),
  },
  { id: 'edit.duplicate', group: 'Edit', label: 'Duplicate', defaultChord: 'Mod+D', run: () => duplicateInPlace() },
  { id: 'edit.selectAll', group: 'Edit', label: 'Select all', defaultChord: 'Mod+A', run: () => selectAll() },
  {
    id: 'edit.delete',
    group: 'Edit',
    label: 'Delete selection',
    defaultChord: 'Delete',
    aliases: ['Backspace'],
    run: () => {
      // A selected guide is not part of `selection`, so deleteSelection would
      // not see it — and with a guide selected there is no node selection to
      // delete anyway.
      const guide = editorStore.getState().selectedGuide
      if (guide) removeGuide(guide.artboardId, guide.guideId)
      else deleteSelection()
    },
  },

  // ---- Arrange -----------------------------------------------------------
  { id: 'arrange.group', group: 'Arrange', label: 'Group', defaultChord: 'Mod+G', run: () => groupSelection() },
  { id: 'arrange.ungroup', group: 'Arrange', label: 'Ungroup', defaultChord: 'Mod+Shift+G', run: () => ungroupSelection() },
  { id: 'arrange.forward', group: 'Arrange', label: 'Bring forward', defaultChord: 'Mod+]', run: () => orderCommand('forward') },
  { id: 'arrange.front', group: 'Arrange', label: 'Bring to front', defaultChord: 'Mod+Shift+]', run: () => orderCommand('front') },
  { id: 'arrange.backward', group: 'Arrange', label: 'Send backward', defaultChord: 'Mod+[', run: () => orderCommand('backward') },
  { id: 'arrange.back', group: 'Arrange', label: 'Send to back', defaultChord: 'Mod+Shift+[', run: () => orderCommand('back') },
  { id: 'arrange.mask', group: 'Arrange', label: 'Mask with shape', defaultChord: 'Mod+Shift+M', run: () => maskWithShape() },
  { id: 'arrange.outlineStroke', group: 'Arrange', label: 'Outline stroke', defaultChord: 'Mod+Shift+O', run: () => outlineStrokeSelection() },
  { id: 'arrange.lock', group: 'Arrange', label: 'Lock / unlock', defaultChord: 'Mod+L', run: () => toggleLockSelection() },
  { id: 'arrange.hide', group: 'Arrange', label: 'Hide / show', defaultChord: 'Mod+Shift+H', run: () => toggleVisibilitySelection() },

  // ---- View --------------------------------------------------------------
  { id: 'view.zoomFit', group: 'View', label: 'Zoom to fit', defaultChord: 'Mod+0', run: () => void viewCommands.zoomToFit() },
  { id: 'view.zoom100', group: 'View', label: 'Zoom to 100%', defaultChord: 'Mod+1', run: () => void viewCommands.zoomTo(1) },
  { id: 'view.zoomSelection', group: 'View', label: 'Zoom to selection', defaultChord: 'Mod+2', run: () => void viewCommands.zoomToSelection() },
  { id: 'view.zoomIn', group: 'View', label: 'Zoom in', defaultChord: 'Mod+=', aliases: ['Mod+Shift+='], run: () => void viewCommands.stepZoom(1) },
  { id: 'view.zoomOut', group: 'View', label: 'Zoom out', defaultChord: 'Mod+-', run: () => void viewCommands.stepZoom(-1) },
  {
    id: 'view.toggleGrid',
    group: 'View',
    label: 'Toggle grid',
    defaultChord: "Mod+'",
    run: () => updateSettings({ gridVisible: !getDoc().settings.gridVisible }),
  },
  {
    id: 'view.toggleSnapping',
    group: 'View',
    label: 'Toggle snapping',
    defaultChord: "Mod+Shift+'",
    run: () => setEditor({ snapEnabled: !editorStore.getState().snapEnabled }),
  },
  {
    id: 'view.toggleGuides',
    group: 'View',
    label: 'Toggle guides',
    defaultChord: 'Mod+;',
    run: () => updateSettings({ guidesVisible: !getDoc().settings.guidesVisible }),
  },
  {
    id: 'view.lockGuides',
    group: 'View',
    label: 'Lock guides',
    defaultChord: 'Mod+Shift+;',
    run: () => {
      // Adobe's binding, applied to the selected artboards or, with nothing
      // selected, to every artboard.
      const doc = getDoc()
      const selected = editorStore.getState().selection.filter((id) => doc.nodes[id]?.type === 'artboard')
      const targets = selected.length ? selected : artboardIds(doc)
      const locked = targets.every((id) => {
        const node = doc.nodes[id]
        return node?.type === 'artboard' && node.guidesLocked
      })
      setGuidesLocked(targets, !locked)
    },
  },
  {
    id: 'view.shortcuts',
    group: 'View',
    label: 'Keyboard shortcuts',
    defaultChord: 'Mod+/',
    aliases: ['Shift+/'],
    run: (h) => h.onShortcuts(),
  },

  // ---- Transform ---------------------------------------------------------
  { id: 'transform.nudgeLeft', group: 'Transform', label: 'Nudge left', defaultChord: 'ArrowLeft', run: () => nudge(-1, 0, false) },
  { id: 'transform.nudgeRight', group: 'Transform', label: 'Nudge right', defaultChord: 'ArrowRight', run: () => nudge(1, 0, false) },
  { id: 'transform.nudgeUp', group: 'Transform', label: 'Nudge up', defaultChord: 'ArrowUp', run: () => nudge(0, -1, false) },
  { id: 'transform.nudgeDown', group: 'Transform', label: 'Nudge down', defaultChord: 'ArrowDown', run: () => nudge(0, 1, false) },
  { id: 'transform.nudgeLeftLarge', group: 'Transform', label: 'Nudge left 10px', defaultChord: 'Shift+ArrowLeft', run: () => nudge(-1, 0, true) },
  { id: 'transform.nudgeRightLarge', group: 'Transform', label: 'Nudge right 10px', defaultChord: 'Shift+ArrowRight', run: () => nudge(1, 0, true) },
  { id: 'transform.nudgeUpLarge', group: 'Transform', label: 'Nudge up 10px', defaultChord: 'Shift+ArrowUp', run: () => nudge(0, -1, true) },
  { id: 'transform.nudgeDownLarge', group: 'Transform', label: 'Nudge down 10px', defaultChord: 'Shift+ArrowDown', run: () => nudge(0, 1, true) },

  // ---- Selection ---------------------------------------------------------
  {
    id: 'edit.deselect',
    group: 'Edit',
    label: 'Deselect / exit group',
    defaultChord: 'Escape',
    run: () => {
      // Image Trace is modeless but takes over the inspector, so Escape has to
      // reach it before it reaches the selection — otherwise the panel would be
      // the one thing on screen that Escape cannot close.
      if (traceStore.getState().session) cancelImageTrace()
      else if (editorStore.getState().editingContext) setEditor({ editingContext: null })
      else clearSelection()
    },
  },
]

/** Nudge distances, matching every design tool's convention. */
const NUDGE_SMALL = 1
const NUDGE_LARGE = 10

function nudge(dx: number, dy: number, large: boolean): void {
  const step = large ? NUDGE_LARGE : NUDGE_SMALL
  // One coalesce key means a run of arrow presses is a single undo step.
  moveSelection(dx * step, dy * step, 'nudge')
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

/**
 * The zoom commands live in KeyboardManager, which imports this module — so
 * they are handed back at install time rather than imported, which would be a
 * cycle. Set once, before any key can be pressed.
 */
export const viewCommands = {
  zoomToFit: () => {},
  zoomToSelection: () => {},
  zoomTo: (_zoom: number) => {},
  stepZoom: (_direction: 1 | -1) => {},
}

export function commandById(id: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.id === id)
}

/** The groups the shortcuts dialog shows, in the order it shows them. */
export const COMMAND_GROUP_ORDER = ['Tools', 'File', 'Edit', 'Arrange', 'Transform', 'View']
