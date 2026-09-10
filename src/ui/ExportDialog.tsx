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
  hasQuality, isRasterFormat, resolveExportBounds, runExport, supportsTransparency,
  type ExportArea, type ExportFormat, type ExportRequest,
} from '../export/ExportPipeline'
import { canEncodeWebp } from '../export/Rasterizer'
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
  // The option is disabled where WebP cannot be written, so this is only the
  // guard for arriving with it already chosen.
  const webpOk = canEncodeWebp()
  const webpBlocked = format === 'webp' && !webpOk
  const canExport = hasArea && !busy && !heifTooLarge && !webpBlocked

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
          {/* First, because it is the one thing that is different every time. */}
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

          <div className="dialog-row">
            <label>Format</label>
            <Select
              value={format}
              options={[
                { value: 'png', label: 'PNG — lossless raster' },
                { value: 'jpeg', label: 'JPEG — compressed raster' },
                { value: 'svg', label: 'SVG — vector' },
                { value: 'heif', label: 'HEIF — high-efficiency raster' },
                {
                  value: 'webp',
                  label: webpOk
                    ? 'WebP — compressed raster, keeps transparency'
                    : 'WebP — this browser cannot write it',
                  disabled: !webpOk,
                },
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

          {hasQuality(format) && (
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

          {/* Beside the choice it refines, wherever that sits. */}
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

          {webpBlocked && (
            <div className="multi-note" style={{ color: 'var(--error)', marginTop: 2 }}>
              This browser cannot write WebP images. Chrome, Edge and Firefox can.
            </div>
          )}

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
 * A request as a key, holding only what changes the picture.
 *
 * By value, because the dialog rebuilds its request on every render. And
 * without what the format ignores — the name, a quality only JPEG and WebP
 * read, SVG's image and text handling, a raster's scale for SVG — so switching
 * format and back does not throw away a render that is still right.
 */
function previewKey(request: ExportRequest): string {
  const svg = request.format === 'svg'
  return JSON.stringify({
    ...request,
    fileName: undefined,
    quality: hasQuality(request.format) ? request.quality : undefined,
    scale: svg ? undefined : request.scale,
    imageHandling: svg ? request.imageHandling : undefined,
    textHandling: svg ? request.textHandling : undefined,
  })
}

/**
 * The picture without its background, which the preview paints itself.
 *
 * JPEG cannot be see-through, so its stand-in is a lossless, transparent PNG of
 * the same artwork at the same size.
 */
function artworkOf(request: ExportRequest): ExportRequest {
  return supportsTransparency(request.format)
    ? { ...request, background: null }
    : { ...request, format: 'png', background: null }
}

function sameExceptBackground(a: string, b: string): boolean {
  const strip = (key: string) => previewKey({ ...(JSON.parse(key) as ExportRequest), background: null })
  return strip(a) === strip(b)
}

interface Rendered {
  image: ExportPreviewImage
  /** What it was rendered from, as a key. */
  key: string
}

/**
 * The latest render of one request, kept on screen until a newer one lands.
 *
 * Rendered after a pause in the changes, and superseded rather than queued: a
 * result that arrives after the request has moved on is thrown away, so this
 * can never settle on a combination that is no longer selected.
 */
function useRendered(doc: DesignDocument, key: string | null) {
  const [rendered, setRendered] = useState<Rendered | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const url = useRef<string | null>(null)

  useEffect(() => {
    if (!key) return
    let current = true
    const timer = setTimeout(() => {
      renderExportPreview(doc, JSON.parse(key) as ExportRequest).then(
        (image) => {
          if (!current) {
            URL.revokeObjectURL(image.url)
            return
          }
          if (url.current) URL.revokeObjectURL(url.current)
          url.current = image.url
          setRendered({ image, key })
        },
        (e: unknown) => {
          if (!current) return
          setFailure({ key, message: e instanceof Error ? e.message : 'The preview could not be rendered.' })
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
      if (url.current) URL.revokeObjectURL(url.current)
    },
    [],
  )

  return { rendered, failure: failure && failure.key === key ? failure.message : null }
}

/**
 * The file an export would write, shown before it is written.
 *
 * The picture is the export WITHOUT its background, laid over the colour chosen,
 * which the preview paints itself. So ticking the box or dragging through the
 * colour picker repaints behind the artwork at once, where it used to re-run
 * the export and dim the old picture until the new one arrived. For PNG and SVG
 * that is exactly the file; for a lossy format the artwork is compressed as the
 * file compresses it, and the background is the flat colour it is in the file.
 *
 * The file itself is rendered alongside, for its size, and for JPEG it IS the
 * picture once it has caught up: JPEG has no transparency, so it cannot be
 * split the same way. Until it catches up with a new colour, a lossless stand-in
 * over that colour holds its place rather than the old colour, dimmed.
 */
function ExportPreview({ doc, request }: { doc: DesignDocument; request: ExportRequest | null }) {
  const artKey = request ? previewKey(artworkOf(request)) : null
  const fileKey = request ? previewKey(request) : null
  // With no background to lay under it, the artwork is the file.
  const sameRender = artKey === fileKey
  const art = useRendered(doc, artKey)
  const ownFile = useRendered(doc, sameRender ? null : fileKey)
  const file = sameRender ? art : ownFile

  if (!request || !fileKey) {
    return (
      <div className="export-preview" data-testid="export-preview-panel">
        <div className="export-preview-frame">
          <span className="export-preview-status">Nothing to preview.</span>
        </div>
      </div>
    )
  }

  const opaque = !supportsTransparency(request.format)
  const artCurrent = art.rendered?.key === artKey
  const fileCurrent = file.rendered?.key === fileKey
  // JPEG shows the file once it has caught up. Until then, if only the colour
  // has moved, the stand-in over the new colour; for anything else the last
  // file, marked out of date.
  const fileShown =
    opaque &&
    !!file.rendered &&
    (fileCurrent || !(artCurrent && sameExceptBackground(file.rendered.key, fileKey)))
  const stale = fileShown ? !fileCurrent : !artCurrent
  const shown = fileShown ? file.rendered : art.rendered
  const failure = art.failure ?? file.failure

  const bg = request.background
  // JPEG lays a translucent colour over white, and so does its stand-in.
  const backdrop = bg
    ? opaque
      ? `linear-gradient(${toCss(bg)}, ${toCss(bg)}), #ffffff`
      : toCss(bg)
    : undefined
  const bytes = file.rendered?.image.bytes

  return (
    <div className="export-preview" data-testid="export-preview-panel" aria-busy={stale}>
      <div className={`export-preview-frame${stale ? ' pending' : ''}`}>
        {(failure || !shown) && (
          <span className="export-preview-status">{failure ?? 'Rendering preview…'}</span>
        )}
        {/* Stacked in one cell and swapped by visibility, so the change from
            stand-in to file is a swap of two pictures already decoded, never a
            blank frame while one loads. */}
        {!failure && art.rendered && (
          <img
            src={art.rendered.image.url}
            className={fileShown ? 'off' : undefined}
            style={{ background: backdrop }}
            alt="Preview of the exported file"
            data-testid="export-preview-image"
          />
        )}
        {!failure && opaque && file.rendered && (
          <img
            src={file.rendered.image.url}
            className={fileShown ? undefined : 'off'}
            alt="Preview of the exported file"
            data-testid="export-preview-file"
          />
        )}
      </div>
      {shown && !failure && (
        <div className="multi-note">
          {shown.image.reduced
            ? 'Shown smaller than it will be exported.'
            : bytes === undefined
              ? 'File size: …'
              : bytes !== null
                ? `File size: ${formatBytes(bytes)}`
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
