/**
 * Autosave and crash recovery.
 *
 * A 2s debounce after the last edit, plus a hard 30s ceiling so a long
 * continuous editing session still checkpoints. Work is scheduled on idle time
 * where the browser offers it, so serializing never competes with a drag.
 *
 * The clean-shutdown flag is set on `pagehide` and on `visibilitychange:hidden`,
 * NOT on `beforeunload` — that event is unreliable on mobile Safari and simply
 * does not fire when a tab is discarded, which is exactly the case recovery
 * exists for. If the flag is missing at next launch, the session ended
 * abnormally and we offer to restore.
 */

import { documentStore } from '../state/DocumentStore'
import {
  findRecoverableDocument,
  markCleanShutdown,
  requestPersistentStorage,
  saveSnapshot,
} from './IndexedDbStore'
import type { DesignDocument } from '../document/types'

const DEBOUNCE_MS = 2000
const MAX_INTERVAL_MS = 30_000

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastSavedVersion = -1
let lastSaveAt = 0
let running = false
let unsubscribe: (() => void) | null = null
let saving = false

type IdleHandle = number
const requestIdle: (cb: () => void) => IdleHandle =
  typeof requestIdleCallback === 'function'
    ? (cb) => requestIdleCallback(() => cb(), { timeout: 2000 }) as unknown as IdleHandle
    : (cb) => setTimeout(cb, 0) as unknown as IdleHandle

export function startAutosave(): void {
  if (running) return
  running = true

  void requestPersistentStorage()

  unsubscribe = documentStore.subscribe((state) => {
    if (state.version === lastSavedVersion) return
    schedule()
  })

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', handleExit)
    document.addEventListener('visibilitychange', handleVisibility)
  }
}

export function stopAutosave(): void {
  running = false
  unsubscribe?.()
  unsubscribe = null
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', handleExit)
    document.removeEventListener('visibilitychange', handleVisibility)
  }
}

function schedule(): void {
  if (debounceTimer) clearTimeout(debounceTimer)

  // A long unbroken editing session would otherwise never checkpoint, because
  // the debounce keeps being pushed out.
  const overdue = Date.now() - lastSaveAt > MAX_INTERVAL_MS
  const delay = overdue ? 0 : DEBOUNCE_MS

  debounceTimer = setTimeout(() => {
    debounceTimer = null
    requestIdle(() => void flush())
  }, delay)
}

/** Write a snapshot now. Called by autosave, and before opening another file. */
export async function flush(): Promise<boolean> {
  if (saving) return false
  const state = documentStore.getState()
  if (state.version === lastSavedVersion) return false

  saving = true
  try {
    await saveSnapshot(state.doc, state.version)
    lastSavedVersion = state.version
    lastSaveAt = Date.now()
    return true
  } catch {
    // Storage full, private mode, or a blocked database. Autosave is a safety
    // net, not the save path — failing here must not interrupt the user.
    return false
  } finally {
    saving = false
  }
}

function handleVisibility(): void {
  if (document.visibilityState === 'hidden') handleExit()
}

function handleExit(): void {
  const state = documentStore.getState()
  // Only a saved document is marked clean; an unsaved one should still offer
  // recovery next launch.
  if (!state.dirty) void markCleanShutdown(state.doc.id)
  else void flush()
}

/** Called after an explicit save, so a clean exit does not prompt for recovery. */
export function markDocumentSaved(doc: DesignDocument): void {
  lastSavedVersion = documentStore.getState().version
  void markCleanShutdown(doc.id)
}

export interface RecoveryOffer {
  doc: DesignDocument
  name: string
  savedAt: number
}

/**
 * Check for a document left behind by an abnormal exit.
 * Called once at startup, before the user has made any changes.
 */
export async function checkForRecovery(): Promise<RecoveryOffer | null> {
  const found = await findRecoverableDocument()
  if (!found) return null
  // An empty document is not worth prompting about.
  const nodeCount = Object.keys(found.doc.nodes).length
  if (nodeCount <= 2) {
    await markCleanShutdown(found.record.id)
    return null
  }
  return { doc: found.doc, name: found.record.name, savedAt: found.record.updatedAt }
}

export async function dismissRecovery(docId: string): Promise<void> {
  await markCleanShutdown(docId)
}
