/**
 * Opening and saving .xdesign files.
 *
 * The File System Access API gives a real Save that overwrites the same file,
 * but it is Chromium-only — Firefox and Safari have both formally declined the
 * pickers. So there are two paths, and the UI reflects which one is active:
 *
 *   Chromium  showSaveFilePicker -> a handle, persisted in IndexedDB so a later
 *             session's Save still targets the same file on disk.
 *   Elsewhere anchor download for save, <input type=file> for open. No overwrite
 *             is possible, so "Save" behaves as "Save a copy".
 *
 * Autosave to IndexedDB runs in parallel with both, so the document is never
 * lost regardless of which path the browser supports.
 */

import { deserializeDocument, serializeDocument, suggestFileName, DocumentFormatError, FILE_EXTENSION } from './FileFormat'
import { recordRecent } from './IndexedDbStore'
import type { DesignDocument } from '../document/types'

export interface SaveTarget {
  handle: FileSystemFileHandle | null
  fileName: string
}

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'showOpenFilePicker' in window
}

const PICKER_TYPES = [
  {
    description: 'XDesign document',
    accept: { 'application/x-xdesign+zip': ['.xdesign'] as string[] },
  },
]

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

export interface OpenResult {
  doc: DesignDocument
  target: SaveTarget
}

/** @returns null when the user cancelled. */
export async function openDocument(): Promise<OpenResult | null> {
  if (supportsFileSystemAccess()) {
    let handle: FileSystemFileHandle
    try {
      const [picked] = await window.showOpenFilePicker!({
        types: PICKER_TYPES,
        excludeAcceptAllOption: false,
        multiple: false,
      })
      if (!picked) return null
      handle = picked
    } catch (error) {
      // AbortError is the user cancelling; anything else is worth reporting.
      if (isAbort(error)) return null
      throw error
    }
    const file = await handle.getFile()
    const doc = await readDocumentFile(file)
    await recordRecent(doc, handle)
    return { doc, target: { handle, fileName: file.name } }
  }

  const file = await pickFileViaInput(FILE_EXTENSION + ',.json,application/json')
  if (!file) return null
  const doc = await readDocumentFile(file)
  await recordRecent(doc)
  return { doc, target: { handle: null, fileName: file.name } }
}

export async function readDocumentFile(file: File | Blob): Promise<DesignDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength === 0) {
    throw new DocumentFormatError('That file is empty.')
  }
  return deserializeDocument(bytes)
}

/** Fallback file picker for browsers without the File System Access API. */
export function pickFileViaInput(accept: string, multiple = false): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'
    // Some browsers only fire change on a connected input.
    document.body.appendChild(input)

    const cleanup = () => {
      input.remove()
      window.removeEventListener('focus', onFocus)
    }
    // There is no cancel event; a window refocus with no file means cancelled.
    const onFocus = () => setTimeout(() => {
      if (!input.files?.length) {
        cleanup()
        resolve(null)
      }
    }, 400)

    input.onchange = () => {
      const file = input.files?.[0] ?? null
      cleanup()
      resolve(file)
    }
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

export function pickFilesViaInput(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = true
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      input.remove()
      resolve(files)
    }
    input.click()
  })
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export interface SaveOptions {
  /** Always prompt for a location, even when a handle already exists. */
  forceDialog?: boolean
  plainJson?: boolean
}

/**
 * @returns the target actually written to, or null when the user cancelled.
 */
export async function saveDocument(
  doc: DesignDocument,
  target: SaveTarget,
  options: SaveOptions = {},
): Promise<SaveTarget | null> {
  const bytes = serializeDocument(doc, { plainJson: options.plainJson })
  const fileName = suggestFileName(doc.name)

  if (supportsFileSystemAccess()) {
    let handle = target.handle

    if (!handle || options.forceDialog) {
      try {
        handle = await window.showSaveFilePicker!({
          suggestedName: fileName,
          types: PICKER_TYPES,
        })
      } catch (error) {
        if (isAbort(error)) return null
        throw error
      }
    } else if (!(await ensureWritePermission(handle))) {
      // Permission lapsed between sessions; ask for a location again rather
      // than silently failing to save.
      try {
        handle = await window.showSaveFilePicker!({ suggestedName: fileName, types: PICKER_TYPES })
      } catch (error) {
        if (isAbort(error)) return null
        throw error
      }
    }

    if (!handle) return null
    const writable = await handle.createWritable()
    // Cast: TS models write() as accepting BufferSource; a Uint8Array view is one.
    await writable.write(bytes as unknown as BufferSource)
    await writable.close()

    const saved: SaveTarget = { handle, fileName: handle.name || fileName }
    await recordRecent(doc, handle)
    return saved
  }

  // No overwrite available — this is effectively "Save a copy".
  downloadBytes(bytes, fileName)
  await recordRecent(doc)
  return { handle: null, fileName }
}

async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  try {
    const query = (handle as unknown as {
      queryPermission?: (d: { mode: string }) => Promise<PermissionState>
      requestPermission?: (d: { mode: string }) => Promise<PermissionState>
    })
    if (!query.queryPermission) return true
    if ((await query.queryPermission({ mode: 'readwrite' })) === 'granted') return true
    // Must be called from a user gesture, which Save always is.
    return (await query.requestPermission?.({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export { DocumentFormatError }
