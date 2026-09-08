/**
 * New / Open / Save / Save As / Import, shared by the menu and the keyboard.
 *
 * Save target state (the FileSystemFileHandle, where the browser supports one)
 * lives here so that Save after Save As overwrites the same file rather than
 * prompting again.
 */

import { createDocument } from '../document/NodeFactory'
import { documentStore, getDoc, markSaved, replaceDocument, pruneUnusedAssets } from '../state/DocumentStore'
import { clearSelection, notify, readDefaultGrid, setEditor, setViewport } from '../state/EditorStore'
import {
  DocumentFormatError,
  openDocument,
  pickFilesViaInput,
  saveDocument,
  type SaveTarget,
} from '../persistence/FileSystem'
import { flush, markDocumentSaved } from '../persistence/Autosave'
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
    // Before the document is installed, not after: the first layout of every
    // text node happens on the first render, and a face that has not arrived by
    // then is measured as the fallback.
    await preloadDocumentFonts(result.doc)
    replaceDocument(result.doc)
    saveTarget = result.target
    clearSelection()
    fitToDocument()
    notify('success', `Opened ${result.doc.name}`, undefined, 2500)
  } catch (error) {
    notify(
      'error',
      error instanceof DocumentFormatError ? error.message : 'That file could not be opened.',
      undefined,
      9000,
    )
  }
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
