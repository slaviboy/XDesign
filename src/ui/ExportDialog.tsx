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
 * The export dialog.
 *
 * Shows the exact output dimensions before committing, because "export at 2x"
 * is meaningless if you cannot see what that produces. The font and image
 * handling choices are surfaced rather than hidden, since they are the two
 * decisions that determine whether the exported file looks right on someone
 * else's machine.
 *
 * It opens with the settings the last export was made with — see
 * ExportSettings for what that covers and what it deliberately does not.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_SCALE, MIN_SCALE, SCALE_PRESETS, clampScale, defaultExportName, downloadBlob, exportFileSuffix,
  isRasterFormat, resolveExportBounds, runExport, supportsTransparency,
  type ExportArea, type ExportFormat, type ExportRequest,
} from '../export/ExportPipeline'
import {
  QUALITY_MAX, QUALITY_MIN, QUALITY_STEP, initialExportSettings, rememberExportSettings,
  type ExportSettings,
} from '../export/ExportSettings'
import { renderExportPreview, type ExportPreviewImage } from '../export/ExportPreview'
import { HEIF_MAX_PIXELS } from '../export/HeifEncoder'
import { markedForExportIds } from '../history/Commands'
import { artboardOf, artboardIds } from '../document/SceneGraph'
import { closeDialog, notify } from '../state/EditorStore'
import { useDocument, useEditorStore } from '../state/hooks'
import { canEmbed } from '../text/FontEmbedder'
import { toCss, toHex } from '../document/color'
import { NumberField, Select } from './primitives'
import { PaintPopover, PAINT_POPOVER_WIDTH } from './ColorPicker'
import type { ImageHandling, TextHandling } from '../svg/SvgExporter'
import type { DesignDocument, NodeId } from '../document/types'

export function ExportDialog() {
  const doc = useDocument()
  const selection = useEditorStore((s) => s.selection)

  const marked = useMemo(() => markedForExportIds(doc), [doc])
  const boards = useMemo(() => artboardIds(doc), [doc])

  const defaultArea: ExportArea =
    selection.length > 0 ? 'selection' : boards.length > 0 ? 'artboard' : 'document'

  const [area, setArea] = useState<ExportArea>(defaultArea)
  const [settings, setSettings] = useState<ExportSettings>(initialExportSettings)
  const update = (patch: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...patch }))
  const {
    format, scale, customScale, useCustomScale, quality, background, imageHandling, textHandling, preview,
  } = settings
  const [artboardId, setArtboardId] = useState<NodeId>(
    () => (selection[0] ? artboardOf(doc, selection[0]) : null) ?? boards[0] ?? '',
  )
  // Null until the name is typed in, so it follows the area until then.
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [colorAt, setColorAt] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveScale = clampScale(useCustomScale ? customScale : scale)
  const raster = isRasterFormat(format)
  // JPEG cannot be see-through, so for JPEG the background is on whatever was
  // chosen for the others, and the checkbox shows it on rather than pretending.
  // The choice itself is kept, so going back to PNG finds it as it was left.
  const backgroundOn = background.enabled || !supportsTransparency(format)

  const nodeIds = useMemo<NodeId[]>(() => {
    switch (area) {
      case 'selection': return [...selection]
      case 'artboard': return artboardId ? [artboardId] : []
      case 'marked': return marked
      default: return []
    }
  }, [area, selection, artboardId, marked])

  const bounds = useMemo(
    () => resolveExportBounds(doc, { area, nodeIds, customBounds: undefined }),
    [doc, area, nodeIds],
  )

  const defaultName = useMemo(() => defaultExportName(doc, { area, nodeIds }), [doc, area, nodeIds])
  const fileName = nameDraft ?? defaultName

  const outputSize = bounds
    ? {
        width: Math.ceil(bounds.width * (raster ? effectiveScale : 1)),
        height: Math.ceil(bounds.height * (raster ? effectiveScale : 1)),
      }
    : null

  // Only bundled fonts can be outlined or embedded; warn before the user finds
  // out from a wrong-looking export.
  const systemFonts = useMemo(() => {
    const names = new Set<string>()
    const visit = (id: NodeId) => {
      const node = doc.nodes[id]
      if (!node) return
      if (node.type === 'text' && !canEmbed(node.textStyle.fontFamily)) {
        names.add(node.textStyle.fontFamily)
      }
      if ('children' in node) for (const c of node.children) visit(c)
    }
    for (const id of nodeIds) visit(id)
    return [...names]
  }, [doc, nodeIds])

  const request = useMemo<ExportRequest>(
    () => ({
      format,
      area,
      nodeIds,
      scale: effectiveScale,
      quality: quality / 100,
      background: backgroundOn ? background.color : null,
      imageHandling,
      textHandling,
      fileName,
    }),
    [
      format, area, nodeIds, effectiveScale, quality, backgroundOn, background.color,
      imageHandling, textHandling, fileName,
    ],
  )

  const hasArea = !!bounds && bounds.width > 0 && bounds.height > 0
  // Said before Export is pressed rather than after: the size is already on
  // screen, so the dialog can tell which scale is too much.
  const heifTooLarge =
    format === 'heif' && !!outputSize && outputSize.width * outputSize.height > HEIF_MAX_PIXELS
  const canExport = hasArea && !busy && !heifTooLarge

  const doExport = async () => {
    setBusy(true)
    setError(null)
    try {
      const output = await runExport(doc, request)
      downloadBlob(output.blob, output.fileName)
      rememberExportSettings(settings)
      for (const warning of output.warnings) notify('warn', warning, undefined, 9000)
      if (output.linkedAssets.length) {
        for (const asset of output.linkedAssets) {
          downloadBlob(await (await fetch(asset.dataUrl)).blob(), asset.fileName)
        }
        notify('info', `Also saved ${output.linkedAssets.length} linked image(s).`)
      }
      notify('success', `Exported ${output.fileName} (${output.width}×${output.height})`)
      closeDialog()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  const openBackgroundPicker = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setColorAt({ x: rect.left - (PAINT_POPOVER_WIDTH + 10), y: rect.top })
  }

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) closeDialog() }}>
      <div className="dialog" style={{ width: 460 }} role="dialog" aria-label="Export">
        <div className="dialog-header">Export</div>
        <div className="dialog-body">
          <div className="dialog-row">
            <label>Area</label>
            <div className="radio-group">
              <RadioOption
                label="Selection" checked={area === 'selection'}
                disabled={selection.length === 0} onChange={() => setArea('selection')}
              />
              <RadioOption
                label="Artboard" checked={area === 'artboard'}
                disabled={boards.length === 0} onChange={() => setArea('artboard')}
              />
              <RadioOption label="Document" checked={area === 'document'} onChange={() => setArea('document')} />
              <RadioOption
                label={`Marked (${marked.length})`} checked={area === 'marked'}
                disabled={marked.length === 0} onChange={() => setArea('marked')}
              />
            </div>
          </div>

          {area === 'artboard' && boards.length > 0 && (
            <div className="dialog-row">
              <label>Which</label>
              <Select
                value={artboardId}
                options={boards.map((id) => ({ value: id, label: doc.nodes[id]?.name ?? id }))}
                onChange={setArtboardId}
              />
            </div>
          )}

          <div className="dialog-row">
            <label>Format</label>
            <Select
              value={format}
              options={[
                { value: 'png', label: 'PNG — lossless raster' },
                { value: 'jpeg', label: 'JPEG — compressed raster' },
                { value: 'svg', label: 'SVG — vector' },
                { value: 'heif', label: 'HEIF — high-efficiency raster' },
              ]}
              onChange={(v) => update({ format: v as ExportFormat })}
            />
          </div>

          {raster && (
            <div className="dialog-row">
              <label>Scale</label>
              <div className="hstack">
                <Select
                  value={useCustomScale ? 'custom' : String(scale)}
                  options={[
                    ...SCALE_PRESETS.map((s) => ({ value: String(s), label: `${s}×` })),
                    { value: 'custom', label: 'Custom…' },
                  ]}
                  onChange={(v) => {
                    if (v === 'custom') update({ useCustomScale: true })
                    else update({ useCustomScale: false, scale: Number(v) })
                  }}
                />
                {useCustomScale && (
                  <NumberField
                    value={customScale}
                    min={MIN_SCALE}
                    max={MAX_SCALE}
                    step={0.1}
                    suffix="×"
                    onChange={(v) => update({ customScale: v })}
                  />
                )}
              </div>
            </div>
          )}

          {format === 'jpeg' && (
            <div className="dialog-row">
              <label>Quality</label>
              <div className="hstack">
                <input
                  type="range" min={QUALITY_MIN} max={QUALITY_MAX} step={QUALITY_STEP} value={quality}
                  onChange={(e) => update({ quality: Number(e.target.value) })}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 11, minWidth: 34, textAlign: 'right' }}>{quality}%</span>
              </div>
            </div>
          )}

          {/* The Fill row's idiom: a box that turns it on, and a swatch that
              opens the picker. Off is transparency, which JPEG does not have. */}
          <div className="dialog-row">
            <label>Background</label>
            <div className="paint-row export-background">
              <input
                type="checkbox"
                className="paint-toggle"
                checked={backgroundOn}
                disabled={!supportsTransparency(format)}
                aria-label="Background enabled"
                data-testid="export-background-toggle"
                title={
                  !supportsTransparency(format)
                    ? 'JPEG has no transparency, so it always has a background'
                    : backgroundOn
                      ? 'Export with a transparent background'
                      : 'Fill the background with a colour'
                }
                onChange={(e) => update({ background: { ...background, enabled: e.target.checked } })}
              />
              <button
                type="button"
                className={`swatch${backgroundOn ? '' : ' off'}`}
                aria-label="Background colour"
                title={toHex(background.color).toUpperCase()}
                data-testid="export-background-color"
                onClick={openBackgroundPicker}
              >
                <span className="swatch-fill" style={{ background: toCss(background.color) }} />
              </button>
              <span className="export-background-value">
                {backgroundOn ? describeColor(background.color) : 'Transparent'}
              </span>
            </div>
          </div>

          {format === 'svg' && (
            <>
              <div className="dialog-row">
                <label>Images</label>
                <Select
                  value={imageHandling}
                  options={[
                    { value: 'embed', label: 'Embed — one portable file' },
                    { value: 'link', label: 'Link — separate image files' },
                  ]}
                  onChange={(v) => update({ imageHandling: v as ImageHandling })}
                />
              </div>
              <div className="dialog-row">
                <label>Text</label>
                <Select
                  value={textHandling}
                  options={[
                    { value: 'embed-font', label: 'Embed font — identical everywhere, stays selectable' },
                    { value: 'reference', label: 'Reference font by name — smallest file' },
                  ]}
                  onChange={(v) => update({ textHandling: v as TextHandling })}
                />
              </div>
            </>
          )}

          <div className="dialog-row">
            <label htmlFor="export-file-name">File name</label>
            <div className="field export-file-name">
              <input
                id="export-file-name"
                type="text"
                value={fileName}
                spellCheck={false}
                data-testid="export-file-name"
                onChange={(e) => setNameDraft(e.target.value)}
                // An emptied field goes back to the default rather than
                // exporting a file with no name.
                onBlur={() => { if (nameDraft !== null && !nameDraft.trim()) setNameDraft(null) }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && canExport) void doExport()
                }}
              />
              {/* Added by the pipeline whatever is typed, so it is shown rather
                  than discovered in the Downloads folder. */}
              <span className="export-file-suffix">{exportFileSuffix(format, effectiveScale)}</span>
            </div>
          </div>

          {format === 'heif' && (
            <div className="multi-note" style={{ marginTop: 2 }}>
              Apple devices open HEIF natively, and Windows with its HEIF and HEVC extensions. Most web
              browsers cannot display it.
            </div>
          )}

          {systemFonts.length > 0 && (
            <div className="multi-note" style={{ marginTop: 10 }}>
              {systemFonts.join(', ')} {systemFonts.length === 1 ? 'is a' : 'are'} system{' '}
              {systemFonts.length === 1 ? 'font' : 'fonts'}. Their bytes are not readable by the
              page, so they are referenced by name and may substitute on another machine.
            </div>
          )}

          {preview && <ExportPreview doc={doc} request={hasArea ? request : null} />}

          <div className="multi-note" style={{ marginTop: 12 }}>
            {outputSize
              ? `Output: ${outputSize.width} × ${outputSize.height}${raster ? ' px' : ' units'}`
              : 'Nothing to export for this area.'}
          </div>

          {heifTooLarge && (
            <div className="multi-note" style={{ color: 'var(--error)', marginTop: 6 }}>
              A HEIF image can have at most {(HEIF_MAX_PIXELS / 1e6).toFixed(1)} million pixels, or it
              will not open elsewhere. Choose a smaller scale.
            </div>
          )}

          {error && (
            <div className="multi-note" style={{ color: 'var(--error)', marginTop: 6 }}>{error}</div>
          )}
        </div>

        <div className="dialog-footer">
          <label className="checkbox-row export-preview-toggle">
            <input
              type="checkbox"
              checked={preview}
              data-testid="export-preview"
              onChange={(e) => update({ preview: e.target.checked })}
            />
            Preview
          </label>
          <button type="button" className="button" onClick={closeDialog}>Cancel</button>
          <button
            type="button"
            className="button primary"
            disabled={!canExport}
            onClick={() => void doExport()}
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>

        {colorAt && (
          <PaintPopover
            paint={{ type: 'solid', color: background.color }}
            anchor={colorAt}
            // A background is one colour: SVG's root has nothing to hang a
            // gradient on that every viewer would agree about.
            allowGradient={false}
            onChange={(paint) => {
              // Choosing a colour is asking for one, so it turns the background
              // on; None is the transparent option said another way.
              if (paint.type === 'solid') update({ background: { enabled: true, color: paint.color } })
              else if (paint.type === 'none') update({ background: { ...background, enabled: false } })
            }}
            onClose={() => setColorAt(null)}
          />
        )}
      </div>
    </div>
  )
}

/** Hex, with the opacity beside it when there is any to speak of. */
function describeColor(color: ExportSettings['background']['color']): string {
  const hex = toHex(color).toUpperCase()
  return color.a < 1 ? `${hex}  ${Math.round(color.a * 100)}%` : hex
}

/** Long enough that dragging the quality slider renders once, not per step. */
const PREVIEW_DELAY_MS = 250

/**
 * The file an export would write, shown before it is written.
 *
 * Rendered after a pause in the changes, and superseded rather than queued: a
 * result that arrives after the settings have moved on is thrown away, so the
 * picture can never settle on a combination that is no longer selected.
 */
function ExportPreview({ doc, request }: { doc: DesignDocument; request: ExportRequest | null }) {
  const [image, setImage] = useState<ExportPreviewImage | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const shownUrl = useRef<string | null>(null)
  // By value, because the request object is rebuilt on every render of the
  // dialog — and without the name, which changes the file but not the picture.
  const key = request ? JSON.stringify({ ...request, fileName: undefined }) : null

  useEffect(() => {
    if (!key) return
    const wanted = JSON.parse(key) as ExportRequest
    let current = true
    setPending(true)
    const timer = setTimeout(() => {
      renderExportPreview(doc, wanted).then(
        (result) => {
          if (!current) {
            URL.revokeObjectURL(result.url)
            return
          }
          if (shownUrl.current) URL.revokeObjectURL(shownUrl.current)
          shownUrl.current = result.url
          setImage(result)
          setFailure(null)
          setPending(false)
        },
        (e: unknown) => {
          if (!current) return
          setFailure(e instanceof Error ? e.message : 'The preview could not be rendered.')
          setPending(false)
        },
      )
    }, PREVIEW_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [doc, key])

  useEffect(
    () => () => {
      if (shownUrl.current) URL.revokeObjectURL(shownUrl.current)
    },
    [],
  )

  // A picture of an area that no longer exists is not a preview of anything.
  const shown = key !== null && failure === null ? image : null

  return (
    <div className="export-preview" data-testid="export-preview-panel" aria-busy={pending}>
      <div className={`export-preview-frame${pending ? ' pending' : ''}`}>
        {shown ? (
          <img src={shown.url} alt="Preview of the exported file" data-testid="export-preview-image" />
        ) : (
          <span className="export-preview-status">
            {key === null ? 'Nothing to preview.' : (failure ?? 'Rendering preview…')}
          </span>
        )}
      </div>
      {shown && (
        <div className="multi-note">
          {shown.reduced
            ? 'Shown smaller than it will be exported.'
            : shown.bytes !== null
              ? `File size: ${formatBytes(shown.bytes)}`
              : 'Linked images are shown embedded.'}
        </div>
      )}
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function RadioOption({
  label, checked, disabled, onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <label className="radio-option" style={disabled ? { opacity: 0.45 } : undefined}>
      <input type="radio" checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  )
}
