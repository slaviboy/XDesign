/**
 * The export dialog.
 *
 * Shows the exact output dimensions before committing, because "export at 2x"
 * is meaningless if you cannot see what that produces. The font and image
 * handling choices are surfaced rather than hidden, since they are the two
 * decisions that determine whether the exported file looks right on someone
 * else's machine.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  MAX_SCALE, MIN_SCALE, SCALE_PRESETS, clampScale, downloadBlob, resolveExportBounds, runExport,
  type ExportArea, type ExportFormat,
} from '../export/ExportPipeline'
import { markedForExportIds } from '../history/Commands'
import { artboardOf, artboardIds } from '../document/SceneGraph'
import { closeDialog, notify } from '../state/EditorStore'
import { useDocument, useEditorStore } from '../state/hooks'
import { canEmbed } from '../text/FontEmbedder'
import { NumberField, Select } from './primitives'
import type { ImageHandling, TextHandling } from '../svg/SvgExporter'
import type { NodeId } from '../document/types'

export function ExportDialog() {
  const doc = useDocument()
  const selection = useEditorStore((s) => s.selection)

  const marked = useMemo(() => markedForExportIds(doc), [doc])
  const boards = useMemo(() => artboardIds(doc), [doc])

  const defaultArea: ExportArea =
    selection.length > 0 ? 'selection' : boards.length > 0 ? 'artboard' : 'document'

  const [area, setArea] = useState<ExportArea>(defaultArea)
  const [format, setFormat] = useState<ExportFormat>('png')
  const [scale, setScale] = useState(1)
  const [customScale, setCustomScale] = useState(1)
  const [useCustomScale, setUseCustomScale] = useState(false)
  const [quality, setQuality] = useState(80)
  const [transparent, setTransparent] = useState(true)
  const [imageHandling, setImageHandling] = useState<ImageHandling>('embed')
  const [textHandling, setTextHandling] = useState<TextHandling>('embed-font')
  const [artboardId, setArtboardId] = useState<NodeId>(
    () => (selection[0] ? artboardOf(doc, selection[0]) : null) ?? boards[0] ?? '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveScale = clampScale(useCustomScale ? customScale : scale)

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

  const outputSize = bounds
    ? {
        width: Math.ceil(bounds.width * (format === 'svg' ? 1 : effectiveScale)),
        height: Math.ceil(bounds.height * (format === 'svg' ? 1 : effectiveScale)),
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

  useEffect(() => {
    if (format === 'jpeg') setTransparent(false)
  }, [format])

  const canExport = !!bounds && bounds.width > 0 && bounds.height > 0 && !busy

  const doExport = async () => {
    setBusy(true)
    setError(null)
    try {
      const output = await runExport(doc, {
        format,
        area,
        nodeIds,
        scale: effectiveScale,
        quality: quality / 100,
        background: transparent && format !== 'jpeg' ? null : { r: 255, g: 255, b: 255, a: 1 },
        imageHandling,
        textHandling,
      })
      downloadBlob(output.blob, output.fileName)
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
              ]}
              onChange={(v) => setFormat(v as ExportFormat)}
            />
          </div>

          {format !== 'svg' && (
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
                    if (v === 'custom') setUseCustomScale(true)
                    else {
                      setUseCustomScale(false)
                      setScale(Number(v))
                    }
                  }}
                />
                {useCustomScale && (
                  <NumberField
                    value={customScale}
                    min={MIN_SCALE}
                    max={MAX_SCALE}
                    step={0.1}
                    suffix="×"
                    onChange={setCustomScale}
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
                  type="range" min={20} max={100} step={5} value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 11, minWidth: 34, textAlign: 'right' }}>{quality}%</span>
              </div>
            </div>
          )}

          {format !== 'jpeg' && (
            <div className="dialog-row">
              <label>Background</label>
              <Select
                value={transparent ? 'transparent' : 'white'}
                options={[
                  { value: 'transparent', label: 'Transparent' },
                  { value: 'white', label: 'White' },
                ]}
                onChange={(v) => setTransparent(v === 'transparent')}
              />
            </div>
          )}

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
                  onChange={(v) => setImageHandling(v as ImageHandling)}
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
                  onChange={(v) => setTextHandling(v as TextHandling)}
                />
              </div>
            </>
          )}

          {systemFonts.length > 0 && (
            <div className="multi-note" style={{ marginTop: 10 }}>
              {systemFonts.join(', ')} {systemFonts.length === 1 ? 'is a' : 'are'} system{' '}
              {systemFonts.length === 1 ? 'font' : 'fonts'}. Their bytes are not readable by the
              page, so they are referenced by name and may substitute on another machine.
            </div>
          )}

          <div className="multi-note" style={{ marginTop: 12 }}>
            {outputSize
              ? `Output: ${outputSize.width} × ${outputSize.height}${format === 'svg' ? ' units' : ' px'}`
              : 'Nothing to export for this area.'}
          </div>

          {error && (
            <div className="multi-note" style={{ color: 'var(--error)', marginTop: 6 }}>{error}</div>
          )}
        </div>

        <div className="dialog-footer">
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
      </div>
    </div>
  )
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
