/**
 * Local storage for documents, autosave snapshots and recent files.
 *
 * IndexedDB, not localStorage: the document must survive as real bytes, and
 * localStorage is a synchronous ~5MB string store that would fall over on the
 * first embedded image. localStorage is used only for small preferences.
 *
 * Snapshots are stored as the serialized .xdesign bytes rather than as live
 * objects, so what is recovered after a crash is byte-identical to what would
 * have been saved to disk.
 */

import { openDB, type IDBPDatabase } from 'idb'
import { serializeDocument, deserializeDocument } from './FileFormat'
import type { DesignDocument } from '../document/types'

const DB_NAME = 'xdesign'
const DB_VERSION = 1

const STORE_DOCUMENTS = 'documents'
const STORE_SNAPSHOTS = 'snapshots'
const STORE_RECENT = 'recent'
const STORE_META = 'meta'

/** Snapshots kept per document before the oldest are pruned. */
const MAX_SNAPSHOTS = 20

export interface DocumentRecord {
  id: string
  name: string
  updatedAt: number
  /** False until the session ends cleanly; drives the recovery prompt. */
  cleanShutdown: boolean
  byteSize: number
}

export interface SnapshotRecord {
  key: string
  docId: string
  version: number
  savedAt: number
  bytes: Uint8Array
}

export interface RecentRecord {
  id: string
  name: string
  openedAt: number
  /** Persisted so "Save" can overwrite the same file in a later session. */
  handle?: FileSystemFileHandle
}

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
          db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          const store = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'key' })
          store.createIndex('byDoc', 'docId')
        }
        if (!db.objectStoreNames.contains(STORE_RECENT)) {
          db.createObjectStore(STORE_RECENT, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META)
        }
      },
    })
  }
  return dbPromise
}

export async function isStorageAvailable(): Promise<boolean> {
  try {
    await getDb()
    return true
  } catch {
    return false
  }
}

/**
 * Ask the browser not to evict our data under storage pressure.
 * Best-effort: a denial is not an error, autosave still works.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate) return null
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export async function saveSnapshot(doc: DesignDocument, version: number): Promise<void> {
  const db = await getDb()
  const bytes = serializeDocument(doc)

  const tx = db.transaction([STORE_DOCUMENTS, STORE_SNAPSHOTS], 'readwrite')
  const record: DocumentRecord = {
    id: doc.id,
    name: doc.name,
    updatedAt: Date.now(),
    cleanShutdown: false,
    byteSize: bytes.byteLength,
  }
  await tx.objectStore(STORE_DOCUMENTS).put(record)
  await tx.objectStore(STORE_SNAPSHOTS).put({
    key: `${doc.id}:${version}`,
    docId: doc.id,
    version,
    savedAt: Date.now(),
    bytes,
  } satisfies SnapshotRecord)
  await tx.done

  await pruneSnapshots(doc.id)
}

async function pruneSnapshots(docId: string): Promise<void> {
  const db = await getDb()
  const all = (await db.getAllFromIndex(STORE_SNAPSHOTS, 'byDoc', docId)) as SnapshotRecord[]
  if (all.length <= MAX_SNAPSHOTS) return
  const doomed = all.sort((a, b) => a.savedAt - b.savedAt).slice(0, all.length - MAX_SNAPSHOTS)
  const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite')
  for (const s of doomed) await tx.store.delete(s.key)
  await tx.done
}

export async function loadLatestSnapshot(docId: string): Promise<DesignDocument | null> {
  const db = await getDb()
  const all = (await db.getAllFromIndex(STORE_SNAPSHOTS, 'byDoc', docId)) as SnapshotRecord[]
  if (all.length === 0) return null
  const newest = all.sort((a, b) => b.savedAt - a.savedAt)[0]!
  try {
    return deserializeDocument(newest.bytes)
  } catch {
    return null
  }
}

/**
 * A document whose session did not end cleanly — the basis for the recovery
 * prompt on next launch.
 */
export async function findRecoverableDocument(): Promise<{
  record: DocumentRecord
  doc: DesignDocument
} | null> {
  try {
    const db = await getDb()
    const records = (await db.getAll(STORE_DOCUMENTS)) as DocumentRecord[]
    const dirty = records
      .filter((r) => !r.cleanShutdown)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (!dirty) return null
    const doc = await loadLatestSnapshot(dirty.id)
    return doc ? { record: dirty, doc } : null
  } catch {
    return null
  }
}

export async function markCleanShutdown(docId: string): Promise<void> {
  try {
    const db = await getDb()
    const record = (await db.get(STORE_DOCUMENTS, docId)) as DocumentRecord | undefined
    if (!record) return
    await db.put(STORE_DOCUMENTS, { ...record, cleanShutdown: true })
  } catch {
    // A failed flag write only costs a spurious recovery prompt.
  }
}

export async function clearDocument(docId: string): Promise<void> {
  const db = await getDb()
  const snapshots = (await db.getAllFromIndex(STORE_SNAPSHOTS, 'byDoc', docId)) as SnapshotRecord[]
  const tx = db.transaction([STORE_DOCUMENTS, STORE_SNAPSHOTS], 'readwrite')
  await tx.objectStore(STORE_DOCUMENTS).delete(docId)
  for (const s of snapshots) await tx.objectStore(STORE_SNAPSHOTS).delete(s.key)
  await tx.done
}

// ---------------------------------------------------------------------------
// Recent documents
// ---------------------------------------------------------------------------

export async function recordRecent(
  doc: DesignDocument,
  handle?: FileSystemFileHandle,
): Promise<void> {
  try {
    const db = await getDb()
    const record: RecentRecord = {
      id: doc.id,
      name: doc.name,
      openedAt: Date.now(),
      // FileSystemFileHandle is structured-cloneable, so a later session can
      // re-acquire permission and overwrite the same file.
      ...(handle ? { handle } : {}),
    }
    await db.put(STORE_RECENT, record)
  } catch {
    // Recents are a convenience; never let them break a save.
  }
}

export async function listRecent(limit = 10): Promise<RecentRecord[]> {
  try {
    const db = await getDb()
    const all = (await db.getAll(STORE_RECENT)) as RecentRecord[]
    return all.sort((a, b) => b.openedAt - a.openedAt).slice(0, limit)
  } catch {
    return []
  }
}

export async function clearRecent(): Promise<void> {
  try {
    const db = await getDb()
    await db.clear(STORE_RECENT)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Preferences (small values only)
// ---------------------------------------------------------------------------

export async function setMeta(key: string, value: unknown): Promise<void> {
  try {
    const db = await getDb()
    await db.put(STORE_META, value, key)
  } catch {
    // ignore
  }
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  try {
    const db = await getDb()
    return (await db.get(STORE_META, key)) as T | undefined
  } catch {
    return undefined
  }
}
