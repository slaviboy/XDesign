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
 * Preferences, keyboard shortcuts, About, New document, and crash recovery.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { ARTBOARD_PRESETS, createDocument } from '../document/NodeFactory'
import { updateSettings } from '../history/Commands'
import { createArtboardCommand } from '../history/Commands'
import { replaceDocument } from '../state/DocumentStore'
import {
  closeDialog, setEditor, setMarqueeMode, setToolHighlight, setViewport,
  type MarqueeMode, type ToolHighlight,
} from '../state/EditorStore'
import { useDocument, useEditorStore } from '../state/hooks'
import { getStorageEstimate, clearRecent } from '../persistence/IndexedDbStore'
import { supportsFileSystemAccess } from '../persistence/FileSystem'
import { ALT_LABEL, MOD_LABEL } from '../shortcuts/bindings'
import { ShortcutEditor } from './ShortcutEditor'
import { DialogShell } from './DialogShell'
import { LANGUAGES, getLanguage, setLanguage, t, type LanguageCode } from '../i18n'
import { canSpellCheck, isSpellCheckEnabled, setSpellCheckEnabled } from '../text/spellcheck'
import { isRememberingExportSettings, setRememberExportSettings } from '../export/ExportSettings'
import { useLanguage } from '../state/hooks-i18n'
import { InfoIcon } from './icons'
import { NumberField, Select, TextField } from './primitives'
import { PaintPopover, PAINT_POPOVER_WIDTH } from './ColorPicker'
import { toCss } from '../document/color'
import type { GuideDragMode } from '../document/types'
import type { RecoveryOffer } from '../persistence/Autosave'

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

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
  const toolHighlight = useEditorStore((s) => s.toolHighlight)
  const [guideColorAt, setGuideColorAt] = useState<{ x: number; y: number } | null>(null)
  // Re-renders the dialog when the language changes, so the choice takes effect
  // in the panel you made it in.
  void useLanguage()
  const language = getLanguage()
  const [spellCheck, setSpellCheck] = useState(() => isSpellCheckEnabled())
  const [rememberExport, setRememberExport] = useState(() => isRememberingExportSettings())
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => {
    void getStorageEstimate().then(setStorage)
  }, [])

  return (
    <DialogShell
      title={t('prefs.title')}
      onClose={closeDialog}
      footer={<button type="button" className="button primary" onClick={closeDialog}>{t('prefs.done')}</button>}
    >
      <h4 style={{ margin: '0 0 8px', fontSize: 12 }}>{t('prefs.language')}</h4>
      <PreferenceRow
        name="language"
        info="The language the interface is shown in. It is remembered on this computer rather than saved with the document, because it is a fact about you and not about the artwork. Anything a translation has not covered yet falls back to English."
      >
        <div className="dialog-row">
          <label>{t('label.language')}</label>
          <Select
            value={language}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
            onChange={(v) => setLanguage(v as LanguageCode)}
            title={t('label.language')}
          />
        </div>
      </PreferenceRow>

      <PreferenceRow
        name="spellcheck"
        info="Underlines words that are in neither English nor the interface language. The dictionaries ship with the app and work offline. Bulgarian, Chinese and Japanese are not offered: the Bulgarian word list has 2,697 words against a real vocabulary of hundreds of thousands, and Chinese and Japanese put no spaces between words, so there is nothing for a word list to check."
      >
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={spellCheck}
            disabled={!canSpellCheck(language)}
            onChange={(e) => {
              setSpellCheckEnabled(e.target.checked)
              setSpellCheck(e.target.checked)
            }}
          />
          {t('label.spellCheck')}
        </label>
      </PreferenceRow>

      <h4 style={{ margin: '16px 0 8px', fontSize: 12 }}>{t('prefs.canvas')}</h4>
      <PreferenceRow
        name="grid-visible"
        info="Draws a ruled grid over the canvas as a drawing aid. It is never part of the document and never appears in an export."
      >
        <label className="checkbox-row">
          <input type="checkbox" checked={doc.settings.gridVisible} onChange={(e) => updateSettings({ gridVisible: e.target.checked })} />
          {t('label.showGrid')}
        </label>
      </PreferenceRow>
      <PreferenceRow
        name="snap-grid"
        info={`While you drag, an object's edges and centre jump to the nearest grid line once they come within a few pixels of one. Grid size below sets the spacing, and the grid does not have to be visible for this to work.`}
      >
        <label className="checkbox-row">
          <input type="checkbox" checked={doc.settings.snapToGrid} onChange={(e) => updateSettings({ snapToGrid: e.target.checked })} />
          {t('label.snapToGrid')}
        </label>
      </PreferenceRow>
      <PreferenceRow
        name="snap-objects"
        info="Aligns what you are dragging to the edges and centres of everything else, drawing a magenta guide where it lands. Objects win over the grid when both are in range."
      >
        <label className="checkbox-row">
          <input type="checkbox" checked={doc.settings.snapToObjects} onChange={(e) => updateSettings({ snapToObjects: e.target.checked })} />
          {t('label.snapToObjects')}
        </label>
      </PreferenceRow>
      <PreferenceRow
        name="guides-visible"
        info="Shows the guides dragged out from the rulers. Hiding them leaves them in place and still snapping — it only takes them off screen."
      >
        <label className="checkbox-row">
          <input type="checkbox" checked={doc.settings.guidesVisible} onChange={(e) => updateSettings({ guidesVisible: e.target.checked })} />
          {t('label.showGuides')}
        </label>
      </PreferenceRow>
      <PreferenceRow
        name="snap-enabled"
        info={`The master switch over both kinds of snapping above: with it off, neither applies. Holding ${MOD_LABEL} suspends snapping for a single drag without changing this.`}
      >
        <label className="checkbox-row">
          <input type="checkbox" checked={snapEnabled} onChange={(e) => setEditor({ snapEnabled: e.target.checked })} />
          {t('label.snappingEnabled')}
        </label>
      </PreferenceRow>
      <PreferenceRow
        name="grid-size"
        info="The spacing between grid lines, in document units — the same units as the W and H fields."
      >
        <div className="dialog-row" style={{ marginTop: 10 }}>
          <label>{t('label.canvasGridSize')}</label>
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

      <h4 style={{ margin: '16px 0 8px', fontSize: 12 }}>{t('prefs.guides')}</h4>
      <PreferenceRow
        name="guide-drag"
        info="A guide's line lies across the artwork, so dragging it is easy to do by accident when you meant to grab a shape. Restricting it to the handle puts the whole artboard back within reach of the tools; the line still selects the guide either way, and the handle appears on whichever guide is selected."
      >
        <div className="dialog-row">
          <label>{t('label.guidesDragFrom')}</label>
          <Select
            value={doc.settings.guideDragMode}
            options={[
              { value: 'line', label: t('prefs.dragFromLine') },
              { value: 'handle', label: t('prefs.dragFromHandle') },
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
          <label>{t('label.guideColour')}</label>
          <button
            type="button"
            className="swatch"
            aria-label={t('label.guideColour')}
            data-testid="guide-color"
            style={{ background: toCss(doc.settings.guideColor) }}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setGuideColorAt({ x: rect.left - (PAINT_POPOVER_WIDTH + 10), y: rect.top })
            }}
          />
        </div>
      </PreferenceRow>

      <h4 style={{ margin: '16px 0 8px', fontSize: 12 }}>{t('prefs.selection')}</h4>
      <PreferenceRow
        name="marquee-mode"
        info={`Dragging a rectangle over the canvas selects whatever falls inside it. “Anything it touches” selects an object the moment the rectangle clips any part of it, so a single stroke through a row picks up the whole row. “Objects fully inside” takes only what the rectangle completely surrounds. Holding ${ALT_LABEL} while you drag uses the other mode for that one selection.`}
      >
        <div className="dialog-row">
          <label>{t('label.marqueeSelects')}</label>
          <Select
            value={marqueeMode}
            options={[
              { value: 'touch', label: t('prefs.marqueeTouch') },
              { value: 'enclose', label: t('prefs.marqueeEnclose') },
            ]}
            onChange={(v) => setMarqueeMode(v as MarqueeMode)}
            title="What a drag-selection has to cover before an object counts as selected"
          />
        </div>
      </PreferenceRow>

      <PreferenceRow
        name="tool-highlight"
        info="How the toolbar marks the tool you are using. A filled chip behind the icon is unmistakable; tinting the icon alone is quieter and keeps every button the same shape whether or not it is the one in use. It changes nothing but the toolbar."
      >
        <div className="dialog-row">
          <label>{t('label.toolHighlight')}</label>
          <Select
            value={toolHighlight}
            options={[
              { value: 'fill', label: t('prefs.toolHighlightFill') },
              { value: 'tint', label: t('prefs.toolHighlightTint') },
            ]}
            onChange={(v) => setToolHighlight(v as ToolHighlight)}
            title="How the toolbar marks the active tool"
          />
        </div>
      </PreferenceRow>

      <h4 style={{ margin: '16px 0 8px', fontSize: 12 }}>{t('prefs.export')}</h4>
      <PreferenceRow
        name="remember-export"
        info="The Export dialog opens with the choices you last made in it — the format, and for it the scale, quality, background, and how images and text are handled — rather than starting from PNG at 1× every time. They are kept as you change them, so they are there next time whether you exported or pressed Cancel. What to export and the file name are always chosen afresh. Turned off, the dialog starts from PNG and nothing is kept."
      >
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={rememberExport}
            data-testid="remember-export"
            onChange={(e) => {
              setRememberExportSettings(e.target.checked)
              setRememberExport(e.target.checked)
            }}
          />
          {t('label.rememberExport')}
        </label>
      </PreferenceRow>

      <h4 style={{ margin: '16px 0 8px', fontSize: 12 }}>{t('prefs.storage')}</h4>
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
        {t('prefs.clearRecent')}
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
          aria-label={open ? t('prefs.hideExplanation') : t('prefs.whatDoesThisDo')}
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
  void useLanguage()
  return (
    <DialogShell
      title={t('shortcuts.title')}
      width={560}
      onClose={closeDialog}
      footer={<button type="button" className="button primary" onClick={closeDialog}>{t('prefs.done')}</button>}
    >
      <ShortcutEditor />
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
