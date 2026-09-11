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
 * New / Open / Save / Save As / Import, shared by the menu and the keyboard.
 *
 * Save target state (the FileSystemFileHandle, where the browser supports one)
 * lives here so that Save after Save As overwrites the same file rather than
 * prompting again.
 */

import { createDocument } from '../document/NodeFactory'
import { documentStore, getDoc, markSaved, replaceDocument, pruneUnusedAssets } from '../state/DocumentStore'
import { clearSelection, notify, openDialog, readDefaultGrid, setEditor, setViewport } from '../state/EditorStore'
import {
  downloadBytes,
  DocumentFormatError,
  openDocument,
  pickFileViaInput,
  readDocumentFile,
  pickFilesViaInput,
  saveDocument,
  type SaveTarget,
} from '../persistence/FileSystem'
import {
  applyPreferences, parsePreferences, PreferencesFormatError, PREFERENCES_EXTENSION,
  serializePreferences, type PreferencesFile, type PreferenceSection,
} from '../persistence/Preferences'
import { setPendingPreferences } from '../state/PreferencesTransfer'
import { flush, markDocumentSaved } from '../persistence/Autosave'
import { recordRecent } from '../persistence/IndexedDbStore'
import { FILE_EXTENSION } from '../persistence/FileFormat'
import { importFiles } from '../images/ImageImporter'
import { preloadFontsFor } from '../text/FontRegistry'
import { documentBounds } from '../document/SceneGraph'
import { fitViewport } from '../canvas/Viewport'
import { editorStore } from '../state/EditorStore'
import { zoomToFit } from '../shortcuts/KeyboardManager'

let saveTarget: SaveTarget = { handle: null, fileName: '' }

export function getSaveTarget(): SaveTarget {
  return saveTarget
}

export function hasSaveTarget(): boolean {
  return saveTarget.handle !== null
}

/** Warn before discarding unsaved work. Returns false when the user cancels. */
function confirmDiscard(): boolean {
  if (!documentStore.getState().dirty) return true
  return window.confirm('This document has unsaved changes. Discard them?')
}

export function newDocument(): void {
  if (!confirmDiscard()) return
  const doc = createDocument('Untitled')
  // The saved default reaches the artboard a new document is seeded with, not
  // just ones drawn afterwards — Adobe: "any new files you open has this new
  // default."
  const preset = readDefaultGrid()
  if (preset) {
    for (const node of Object.values(doc.nodes)) {
      if (node.type === 'artboard') node.grid = { ...preset }
    }
  }
  replaceDocument(doc)
  saveTarget = { handle: null, fileName: '' }
  clearSelection()
  setViewport({ x: 120, y: 100, zoom: 0.6 })
  notify('info', 'New document created.', undefined, 2000)
}

export async function openDocumentFlow(): Promise<void> {
  if (!confirmDiscard()) return
  try {
    // Checkpoint the current document before replacing it, so its autosave is
    // complete if the user wants it back.
    await flush()
    const result = await openDocument()
    if (!result) return
    await installOpenedDocument(result.doc, result.target)
  } catch (error) {
    reportOpenFailure(error)
  }
}

/**
 * Whether a file is a document to open rather than artwork to import — told
 * by its extension, since an operating system rarely knows the type of a
 * .xdesign file and hands it over as octet-stream or as nothing at all.
 */
export function isDocumentFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(FILE_EXTENSION) || file.type === 'application/x-xdesign+zip'
}

/**
 * Open a document from a file the user already has in hand — one dropped on
 * the canvas. Replacing the open document is the caller's to have confirmed:
 * a drop has no menu command in front of it to ask. There is no file handle
 * behind a dropped file, so the first Save asks where to put it, as a
 * document opened from the fallback file picker does.
 */
export async function openDocumentFromFile(file: File): Promise<boolean> {
  try {
    await flush()
    const doc = await readDocumentFile(file)
    await recordRecent(doc)
    await installOpenedDocument(doc, { handle: null, fileName: file.name })
    return true
  } catch (error) {
    reportOpenFailure(error)
    return false
  }
}

async function installOpenedDocument(doc: ReturnType<typeof getDoc>, target: SaveTarget): Promise<void> {
  // Before the document is installed, not after: the first layout of every
  // text node happens on the first render, and a face that has not arrived by
  // then is measured as the fallback.
  await preloadDocumentFonts(doc)
  replaceDocument(doc)
  saveTarget = target
  clearSelection()
  fitToDocument()
  notify('success', `Opened ${doc.name}`, undefined, 2500)
}

function reportOpenFailure(error: unknown): void {
  notify(
    'error',
    error instanceof DocumentFormatError ? error.message : 'That file could not be opened.',
    undefined,
    9000,
  )
}

export async function saveDocumentFlow(forceDialog = false): Promise<boolean> {
  try {
    pruneUnusedAssets()
    const doc = getDoc()
    const result = await saveDocument(doc, saveTarget, { forceDialog })
    if (!result) return false
    saveTarget = result
    markSaved()
    markDocumentSaved(doc)
    notify('success', `Saved ${result.fileName}`, undefined, 2500)
    return true
  } catch (error) {
    notify(
      'error',
      'The document could not be saved.',
      error instanceof Error ? error.message : undefined,
      9000,
    )
    return false
  }
}

export async function importFilesFlow(): Promise<void> {
  const files = await pickFilesViaInput('.svg,image/svg+xml,image/*')
  if (files.length === 0) return
  // Import at the center of the current view.
  const { viewport, canvasSize } = editorStore.getState()
  const at = {
    x: (canvasSize.width / 2 - viewport.x) / viewport.zoom,
    y: (canvasSize.height / 2 - viewport.y) / viewport.zoom,
  }
  await importFiles(files, at)
}

/** Every face the document's text actually uses, loaded before it is shown. */
async function preloadDocumentFonts(doc: ReturnType<typeof getDoc>): Promise<void> {
  await preloadFontsFor(
    Object.values(doc.nodes)
      .filter((n) => n.type === 'text')
      .map((n) => ({
        family: n.textStyle.fontFamily,
        weight: n.textStyle.fontWeight,
        italic: n.textStyle.fontStyle === 'italic',
      })),
  )
}

/** Open a document that was recovered from autosave. */
export async function adoptRecoveredDocument(doc: ReturnType<typeof getDoc>): Promise<void> {
  await preloadDocumentFonts(doc)
  replaceDocument(doc, false)
  saveTarget = { handle: null, fileName: '' }
  clearSelection()
  fitToDocument()
}

function fitToDocument(): void {
  const bounds = documentBounds(getDoc())
  const size = editorStore.getState().canvasSize
  if (bounds.width > 0 && bounds.height > 0) {
    setViewport(fitViewport(bounds, size, 60, 2))
  } else {
    zoomToFit()
  }
}

export function setSaveTarget(target: SaveTarget): void {
  saveTarget = target
}

export { setEditor }

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * Write this machine's preferences out as a file.
 *
 * A plain, pretty-printed JSON document rather than anything packed: it is
 * small, it is meant to be readable, and somebody will inevitably want to edit
 * one by hand or check it into a dotfiles repository.
 */
export function exportPreferencesFlow(): void {
  openDialog('preferences-export')
}

/**
 * Write a chosen set of preferences out.
 *
 * A plain, pretty-printed JSON document rather than anything packed: it is
 * small, it is meant to be readable, and somebody will inevitably want to edit
 * one by hand or check it into a dotfiles repository.
 */
export function writePreferencesFile(file: PreferencesFile): void {
  const bytes = new TextEncoder().encode(serializePreferences(file))
  const stamp = file.exported?.slice(0, 10) ?? 'preferences'
  downloadBytes(bytes, `XDesign ${stamp}${PREFERENCES_EXTENSION}`)
  notify('success', 'Preferences exported.', undefined, 2500)
}

/**
 * Pick a preferences file and open the dialog that chooses what to take from
 * it. Reading has to come first: until the file is parsed there is nothing to
 * offer a choice between.
 */
export async function importPreferencesFlow(): Promise<void> {
  const picked = await pickFileViaInput(`${PREFERENCES_EXTENSION},application/json`)
  if (!picked) return

  try {
    setPendingPreferences(parsePreferences(await picked.text()))
    openDialog('preferences-import')
  } catch (error) {
    notify(
      'error',
      error instanceof PreferencesFormatError
        ? error.message
        : 'That preferences file could not be read.',
    )
  }
}

/**
 * Apply the sections the user ticked.
 *
 * The report names what changed rather than saying "imported", because the
 * settings this touches are spread across four dialogs and a menu — and because
 * the canvas half of them is a document edit, which the user is entitled to
 * know about before reaching for undo.
 */
export function applyImportedPreferences(
  file: PreferencesFile,
  sections: readonly PreferenceSection[],
): void {
  const summary = applyPreferences(file, sections)
  if (summary.applied.length === 0) {
    notify('warn', 'Nothing was imported.')
    return
  }
  notify(
    'success',
    `Preferences imported: ${summary.applied.join(', ')}.`,
    summary.changedDocument
      ? 'The canvas settings changed this document, which one undo reverses.'
      : undefined,
    6000,
  )
}

