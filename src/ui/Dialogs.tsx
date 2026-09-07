/**
 * Preferences, keyboard shortcuts, About, New document, and crash recovery.
 */

import { useEffect, useState } from 'react'
import { ARTBOARD_PRESETS, createDocument } from '../document/NodeFactory'
import { updateSettings } from '../history/Commands'
import { createArtboardCommand } from '../history/Commands'
import { replaceDocument } from '../state/DocumentStore'
import { closeDialog, setEditor, setViewport } from '../state/EditorStore'
import { useDocument, useEditorStore } from '../state/hooks'
import { getStorageEstimate, clearRecent } from '../persistence/IndexedDbStore'
import { supportsFileSystemAccess } from '../persistence/FileSystem'
import { shortcutGroups } from '../shortcuts/bindings'
import { NumberField, Select, TextField } from './primitives'
import type { RecoveryOffer } from '../persistence/Autosave'

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function DialogShell({
  title,
  width = 420,
  onClose,
  footer,
  children,
}: {
  title: string
  width?: number
  onClose: () => void
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="dialog" style={{ width }} role="dialog" aria-label={title}>
        <div className="dialog-header">{title}</div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New document
// ---------------------------------------------------------------------------

export function NewDocumentDialog() {
  const [name, setName] = useState('Untitled')
  const [preset, setPreset] = useState('Web 1280')
  const [width, setWidth] = useState(1280)
  const [height, setHeight] = useState(800)

  const applyPreset = (label: string) => {
    setPreset(label)
    const found = ARTBOARD_PRESETS.find((p) => p.label === label)
    if (found) {
      setWidth(found.width)
      setHeight(found.height)
    }
  }

  const create = () => {
    const doc = createDocument(name || 'Untitled', false)
    replaceDocument(doc)
    createArtboardCommand('Artboard 1', { x: 0, y: 0, width, height })
    setViewport({ x: 120, y: 100, zoom: 0.6 })
    setEditor({ selection: [] })
    closeDialog()
  }

  return (
    <DialogShell
      title="New Document"
      onClose={closeDialog}
      footer={
        <>
          <button type="button" className="button" onClick={closeDialog}>Cancel</button>
          <button type="button" className="button primary" onClick={create}>Create</button>
        </>
      }
    >
      <div className="dialog-row">
        <label>Name</label>
        <TextField value={name} onChange={setName} />
      </div>
      <div className="dialog-row">
        <label>Preset</label>
        <Select
          value={preset}
          options={groupPresets()}
          onChange={applyPreset}
        />
      </div>
      <div className="dialog-row">
        <label>Size</label>
        <div className="field-row">
          <NumberField label="W" value={width} min={1} max={20000} precision={0} onChange={(v) => { setWidth(Math.round(v)); setPreset('Custom') }} />
          <NumberField label="H" value={height} min={1} max={20000} precision={0} onChange={(v) => { setHeight(Math.round(v)); setPreset('Custom') }} />
        </div>
      </div>
    </DialogShell>
  )
}

function groupPresets() {
  const groups = new Map<string, Array<{ value: string; label: string }>>()
  for (const p of ARTBOARD_PRESETS) {
    const list = groups.get(p.group) ?? []
    list.push({ value: p.label, label: `${p.label} — ${p.width}×${p.height}` })
    groups.set(p.group, list)
  }
  return [
    ...[...groups.entries()].map(([group, options]) => ({ group, options })),
    { value: 'Custom', label: 'Custom' },
  ]
}

/** Also used by the "add artboard" flow in the top bar. */
export function ArtboardPresetDialog() {
  const [preset, setPreset] = useState('Web 1280')
  const [width, setWidth] = useState(1280)
  const [height, setHeight] = useState(800)
  const doc = useDocument()

  const applyPreset = (label: string) => {
    setPreset(label)
    const found = ARTBOARD_PRESETS.find((p) => p.label === label)
    if (found) { setWidth(found.width); setHeight(found.height) }
  }

  const create = () => {
    // Place the new artboard to the right of everything that exists.
    let x = 0
    for (const node of Object.values(doc.nodes)) {
      if (node.type === 'artboard') {
        x = Math.max(x, node.transform.x + node.transform.width + 80)
      }
    }
    const count = Object.values(doc.nodes).filter((n) => n.type === 'artboard').length + 1
    createArtboardCommand(`Artboard ${count}`, { x, y: 0, width, height })
    closeDialog()
  }

  return (
    <DialogShell
      title="New Artboard"
      onClose={closeDialog}
      footer={
        <>
          <button type="button" className="button" onClick={closeDialog}>Cancel</button>
          <button type="button" className="button primary" onClick={create}>Add</button>
        </>
      }
    >
      <div className="dialog-row">
        <label>Preset</label>
        <Select value={preset} options={groupPresets()} onChange={applyPreset} />
      </div>
      <div className="dialog-row">
        <label>Size</label>
        <div className="field-row">
          <NumberField label="W" value={width} min={1} max={20000} precision={0} onChange={(v) => { setWidth(Math.round(v)); setPreset('Custom') }} />
          <NumberField label="H" value={height} min={1} max={20000} precision={0} onChange={(v) => { setHeight(Math.round(v)); setPreset('Custom') }} />
        </div>
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export function PreferencesDialog() {
  const doc = useDocument()
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => {
    void getStorageEstimate().then(setStorage)
  }, [])

  return (
    <DialogShell
      title="Preferences"
      onClose={closeDialog}
      footer={<button type="button" className="button primary" onClick={closeDialog}>Done</button>}
    >
      <h4 style={{ margin: '0 0 8px', fontSize: 12 }}>Canvas</h4>
      <label className="checkbox-row">
        <input type="checkbox" checked={doc.settings.gridVisible} onChange={(e) => updateSettings({ gridVisible: e.target.checked })} />
        Show grid
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={doc.settings.snapToGrid} onChange={(e) => updateSettings({ snapToGrid: e.target.checked })} />
        Snap to grid
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={doc.settings.snapToObjects} onChange={(e) => updateSettings({ snapToObjects: e.target.checked })} />
        Snap to objects
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={doc.settings.guidesVisible} onChange={(e) => updateSettings({ guidesVisible: e.target.checked })} />
        Show guides
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={snapEnabled} onChange={(e) => setEditor({ snapEnabled: e.target.checked })} />
        Snapping enabled
      </label>
      <div className="dialog-row" style={{ marginTop: 10 }}>
        <label>Grid size</label>
        <NumberField value={doc.settings.gridSize} min={1} max={500} precision={0} onChange={(v) => updateSettings({ gridSize: Math.round(v) })} />
      </div>

      <h4 style={{ margin: '16px 0 8px', fontSize: 12 }}>Storage</h4>
      <div className="multi-note">
        Documents autosave to this browser's local database every few seconds. Nothing is uploaded
        anywhere.
      </div>
      {storage && (
        <div className="multi-note" style={{ marginTop: 6 }}>
          Using {formatBytes(storage.usage)} of {formatBytes(storage.quota)} available.
        </div>
      )}
      <div className="multi-note" style={{ marginTop: 6 }}>
        File saving: {supportsFileSystemAccess()
          ? 'this browser supports saving directly to a file on disk.'
          : 'this browser cannot overwrite files, so Save downloads a copy.'}
      </div>
      <button
        type="button"
        className="button"
        style={{ marginTop: 8 }}
        onClick={() => void clearRecent()}
      >
        Clear recent documents
      </button>
    </DialogShell>
  )
}

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

export function ShortcutsDialog() {
  return (
    <DialogShell
      title="Keyboard Shortcuts"
      width={520}
      onClose={closeDialog}
      footer={<button type="button" className="button primary" onClick={closeDialog}>Done</button>}
    >
      <div className="shortcut-grid">
        {shortcutGroups().map((group) => (
          <div key={group.group} style={{ display: 'contents' }}>
            <div className="shortcut-group-title">{group.group}</div>
            {group.items.map((item) => (
              <div key={item.keys + item.label} style={{ display: 'contents' }}>
                <span>{item.label}</span>
                <span className="kbd">{item.keys}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </DialogShell>
  )
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

export function AboutDialog() {
  return (
    <DialogShell
      title="About XDesign"
      onClose={closeDialog}
      footer={<button type="button" className="button primary" onClick={closeDialog}>Close</button>}
    >
      <p style={{ marginTop: 0, fontSize: 12, lineHeight: 1.6 }}>
        <strong>XDesign</strong> is an offline-first vector design editor.
      </p>
      <ul style={{ fontSize: 12, lineHeight: 1.7, paddingLeft: 18 }}>
        <li>No account, no login, no server, no telemetry.</li>
        <li>Documents live on this machine — in the browser's local database, and in the
          <code> .xdesign</code> files you save.</li>
        <li>Once loaded, it works with no network connection at all.</li>
        <li>The document is an SVG scene graph, so imported SVG stays real, editable vector
          and exported SVG is never rasterized.</li>
        <li>Fonts are bundled locally; nothing is fetched from a font CDN.</li>
      </ul>
    </DialogShell>
  )
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export function RecoveryDialog({
  offer,
  onRecover,
  onDiscard,
}: {
  offer: RecoveryOffer
  onRecover: () => void
  onDiscard: () => void
}) {
  const when = new Date(offer.savedAt)
  return (
    <DialogShell
      title="Recover previous document?"
      onClose={onDiscard}
      footer={
        <>
          <button type="button" className="button" onClick={onDiscard}>Discard</button>
          <button type="button" className="button primary" onClick={onRecover}>Recover</button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 12, lineHeight: 1.6 }}>
        The last session ended without closing <strong>{offer.name}</strong>. An autosaved copy from{' '}
        {when.toLocaleString()} is available.
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Recovering replaces the current empty document. Discarding removes the autosave.
      </p>
    </DialogShell>
  )
}
