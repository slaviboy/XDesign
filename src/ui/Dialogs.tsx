/**
 * Preferences, keyboard shortcuts, About, New document, and crash recovery.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { ARTBOARD_PRESETS, createDocument } from '../document/NodeFactory'
import { updateSettings } from '../history/Commands'
import { createArtboardCommand } from '../history/Commands'
import { replaceDocument } from '../state/DocumentStore'
import { closeDialog, setEditor, setMarqueeMode, setViewport, type MarqueeMode } from '../state/EditorStore'
import { useDocument, useEditorStore } from '../state/hooks'
import { getStorageEstimate, clearRecent } from '../persistence/IndexedDbStore'
import { supportsFileSystemAccess } from '../persistence/FileSystem'
import { ALT_LABEL, MOD_LABEL, shortcutGroups } from '../shortcuts/bindings'
import { InfoIcon } from './icons'
import { NumberField, Select, TextField } from './primitives'
import { PaintPopover, PAINT_POPOVER_WIDTH } from './ColorPicker'
import { toCss } from '../document/color'
import type { GuideDragMode } from '../document/types'
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
  const marqueeMode = useEditorStore((s) => s.marqueeMode)
  const [guideColorAt, setGuideColorAt] = useState<{ x: number; y: number } | null>(null)
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
      <PreferenceRow
        name="grid-visible"
        info="Draws a ruled grid over the canvas as a drawing aid. It is never part of the document and never appears in an export."
      >
        <label className="checkbox-row">
          <input type="checkbox" checked={doc.settings.gridVisible} onChange={(e) => updateSettings({ gridVisible: e.target.checked })} />
          Show grid
        </label>
      </PreferenceRow>
      <PreferenceRow
        name="snap-grid"
        info={`While you drag, an object's edges and centre jump to the nearest grid line once they come within a few pixels of one. Grid size below sets the spacing, and the grid does not have to be visible for this to work.`}
      >
        <label className="checkbox-row">
          <input type="checkbox" checked={doc.settings.snapToGrid} onChange={(e) => updateSettings({ snapToGrid: e.target.checked })} />
          Snap to grid
        </label>
      </PreferenceRow>
      <PreferenceRow
        name="snap-objects"
        info="Aligns what you are dragging to the edges and centres of everything else, drawing a magenta guide where it lands. Objects win over the grid when both are in range."
      >
        <label className="checkbox-row">
          <input type="checkbox" checked={doc.settings.snapToObjects} onChange={(e) => updateSettings({ snapToObjects: e.target.checked })} />
          Snap to objects
        </label>
      </PreferenceRow>
      <PreferenceRow
        name="guides-visible"
        info="Shows the guides dragged out from the rulers. Hiding them leaves them in place and still snapping — it only takes them off screen."
      >
        <label className="checkbox-row">
          <input type="checkbox" checked={doc.settings.guidesVisible} onChange={(e) => updateSettings({ guidesVisible: e.target.checked })} />
          Show guides
        </label>
      </PreferenceRow>
      <PreferenceRow
        name="snap-enabled"
        info={`The master switch over both kinds of snapping above: with it off, neither applies. Holding ${MOD_LABEL} suspends snapping for a single drag without changing this.`}
      >
        <label className="checkbox-row">
          <input type="checkbox" checked={snapEnabled} onChange={(e) => setEditor({ snapEnabled: e.target.checked })} />
          Snapping enabled
        </label>
      </PreferenceRow>
      <PreferenceRow
        name="grid-size"
        info="The spacing between grid lines, in document units — the same units as the W and H fields."
      >
        <div className="dialog-row" style={{ marginTop: 10 }}>
          <label>Canvas grid size</label>
          <NumberField
            value={doc.settings.gridSize}
            min={1}
            max={500}
            precision={0}
            onChange={(v, committing) =>
              updateSettings({ gridSize: Math.round(v) }, committing ? undefined : 'grid-size')
            }
          />
        </div>
      </PreferenceRow>

      <h4 style={{ margin: '16px 0 8px', fontSize: 12 }}>Guides</h4>
      <PreferenceRow
        name="guide-drag"
        info="A guide's line lies across the artwork, so dragging it is easy to do by accident when you meant to grab a shape. Restricting it to the handle puts the whole artboard back within reach of the tools; the line still selects the guide either way, and the handle appears on whichever guide is selected."
      >
        <div className="dialog-row">
          <label>Guides drag from</label>
          <Select
            value={doc.settings.guideDragMode}
            options={[
              { value: 'line', label: 'The line or its handle' },
              { value: 'handle', label: 'Only the handle' },
            ]}
            onChange={(v) => updateSettings({ guideDragMode: v as GuideDragMode })}
            title="Where a guide can be picked up"
          />
        </div>
      </PreferenceRow>
      <PreferenceRow
        name="guide-color"
        info="The colour guides are drawn in. It is saved with the document rather than following the theme, because it is a choice about the artwork you are working on — a magenta guide is invisible over magenta artwork."
      >
        <div className="dialog-row">
          <label>Guide colour</label>
          <button
            type="button"
            className="swatch"
            aria-label="Guide colour"
            data-testid="guide-color"
            style={{ background: toCss(doc.settings.guideColor) }}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setGuideColorAt({ x: rect.left - (PAINT_POPOVER_WIDTH + 10), y: rect.top })
            }}
          />
        </div>
      </PreferenceRow>

      <h4 style={{ margin: '16px 0 8px', fontSize: 12 }}>Selection</h4>
      <PreferenceRow
        name="marquee-mode"
        info={`Dragging a rectangle over the canvas selects whatever falls inside it. “Anything it touches” selects an object the moment the rectangle clips any part of it, so a single stroke through a row picks up the whole row. “Objects fully inside” takes only what the rectangle completely surrounds. Holding ${ALT_LABEL} while you drag uses the other mode for that one selection.`}
      >
        <div className="dialog-row">
          <label>Marquee selects</label>
          <Select
            value={marqueeMode}
            options={[
              { value: 'touch', label: 'Anything it touches' },
              { value: 'enclose', label: 'Objects fully inside' },
            ]}
            onChange={(v) => setMarqueeMode(v as MarqueeMode)}
            title="What a drag-selection has to cover before an object counts as selected"
          />
        </div>
      </PreferenceRow>

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

      {guideColorAt && (
        <PaintPopover
          paint={{ type: 'solid', color: doc.settings.guideColor }}
          anchor={guideColorAt}
          // A guide is a line: it has a colour, not a paint.
          allowGradient={false}
          onChange={(paint, committing) => {
            if (paint.type === 'solid') {
              updateSettings({ guideColor: paint.color }, committing ? undefined : 'guide-color')
            }
          }}
          onClose={() => setGuideColorAt(null)}
        />
      )}
    </DialogShell>
  )
}

/**
 * One preference, with an (i) that opens its explanation.
 *
 * Behind a press rather than a hover: the notes are a sentence or two each, and
 * six of them stacked permanently would bury the settings they describe — while
 * a hover tooltip is unreadable at that length and unreachable by touch.
 */
function PreferenceRow({
  name,
  info,
  children,
}: {
  name: string
  info: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const noteId = `pref-note-${name}`
  return (
    <>
      <div className="pref-row">
        {children}
        <button
          type="button"
          className={`info-button${open ? ' active' : ''}`}
          aria-label={open ? 'Hide explanation' : 'What does this do?'}
          aria-expanded={open}
          aria-controls={noteId}
          data-testid={`info-${name}`}
          onClick={() => setOpen((v) => !v)}
        >
          <InfoIcon size={14} />
        </button>
      </div>
      {open && (
        <p className="pref-note" id={noteId}>
          {info}
        </p>
      )}
    </>
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
