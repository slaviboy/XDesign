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
 * The Image Trace panel.
 *
 * Modelled on Illustrator's, control for control, because the controls are the
 * feature: tracing is a conversation with the picture, and every one of these
 * settings changes the answer. Preset gets you close in one click, View lets
 * you check the result against the source, and Advanced is where a good trace
 * becomes the right one.
 *
 * It takes over the inspector column while a trace is open rather than
 * floating over the canvas. A floating panel would sit on top of the very
 * artwork it is describing, and the inspector is already where this app puts
 * "settings for the thing you selected".
 *
 * Nothing here writes to the document. Every control goes through TraceStore,
 * which re-traces in a worker; only the Trace button commits, and that is one
 * undoable step.
 */

import { type ReactNode } from 'react'
import { useStore } from 'zustand'
import {
  applyTracePreset, currentPresetId, setTraceOptions, setTracePreview,
  setTraceView, traceIsCurrent, traceStore, type TraceSession, type TraceView,
} from '../state/TraceStore'
import { cancelImageTrace, commitImageTrace } from '../history/TraceCommands'
import { TRACE_PRESETS } from '../trace/presets'
import { NumberField, Section, Select } from './primitives'
import { CloseIcon } from './icons'
import { t, type MessageKey } from '../i18n'
import { useLanguage } from '../state/hooks-i18n'
import { useDocumentStore } from '../state/hooks'
import type { TraceMethod, TraceMode, TracePalette, TracePreset } from '../trace/types'

export function ImageTracePanel() {
  const session = useStore(traceStore, (s) => s.session)
  void useLanguage()
  if (!session) return null
  return (
    <div className="inspector-scroll image-trace-panel">
      <Header session={session} />
      <TopSettings session={session} />
      <AdvancedSettings session={session} />
      <TraceInfo session={session} />
      <Footer session={session} />
    </div>
  )
}

/**
 * The panel names the picture it is tracing, and its pixel size.
 *
 * The panel takes over the inspector, so the usual "what am I looking at"
 * answer — the selection name at the top of the properties — is gone while it
 * is open. Its own subtitle puts that back, and the pixel size is the number
 * that explains why one image traces instantly and another takes a second.
 */
function Header({ session }: { session: TraceSession }) {
  const busy = session.status === 'tracing' || session.status === 'loading'
  const name = useDocumentStore((s) => s.doc.nodes[session.nodeId]?.name)
  const source = session.source
  return (
    <div className="trace-header">
      <div className="trace-heading">
        <h2 className="trace-title">
          {t('trace.title')}
          {busy && <span className="trace-spinner" aria-hidden="true" />}
        </h2>
        <span className="trace-subtitle truncate" title={name}>
          {name}
          {source ? ` · ${source.width} × ${source.height}` : ''}
        </span>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={t('trace.close')}
        title={t('trace.close')}
        onClick={cancelImageTrace}
      >
        <CloseIcon size={13} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preset, View, Mode, Palette, Colors
// ---------------------------------------------------------------------------

const VIEWS: TraceView[] = ['result', 'result-outlines', 'outlines', 'outlines-source', 'source']

const VIEW_LABELS: Record<TraceView, MessageKey> = {
  result: 'trace.view.result',
  'result-outlines': 'trace.view.resultOutlines',
  outlines: 'trace.view.outlines',
  'outlines-source': 'trace.view.outlinesSource',
  source: 'trace.view.source',
}

function TopSettings({ session }: { session: TraceSession }) {
  const { options } = session
  const preset = currentPresetId(options)

  return (
    <Section>
      <LabelledRow label={t('trace.preset')}>
        <Select
          value={preset ?? CUSTOM}
          title={t('trace.preset')}
          onChange={(id) => id !== CUSTOM && applyTracePreset(id)}
          options={[
            // Only offered while the settings match no preset; picking it back
            // would mean "undo my adjustments", which is what undo is for.
            ...(preset ? [] : [{ value: CUSTOM, label: t('trace.custom') }]),
            ...TRACE_PRESETS.map((p: TracePreset) => ({ value: p.id, label: p.label })),
          ]}
        />
      </LabelledRow>

      <LabelledRow label={t('trace.view')}>
        <Select
          value={session.view}
          title={t('trace.view')}
          onChange={(v) => setTraceView(v as TraceView)}
          options={VIEWS.map((v) => ({ value: v, label: t(VIEW_LABELS[v]) }))}
        />
      </LabelledRow>

      <LabelledRow label={t('trace.mode')}>
        <Select
          value={options.mode}
          title={t('trace.mode')}
          onChange={(mode) => setTraceOptions({ mode: mode as TraceMode })}
          options={[
            { value: 'color', label: t('trace.mode.color') },
            { value: 'grayscale', label: t('trace.mode.grayscale') },
            { value: 'bw', label: t('trace.mode.bw') },
          ]}
        />
      </LabelledRow>

      {options.mode === 'color' && (
        <LabelledRow label={t('trace.palette')}>
          <Select
            value={options.palette}
            title={t('trace.palette')}
            onChange={(palette) => setTraceOptions({ palette: palette as TracePalette })}
            options={[
              { value: 'automatic', label: t('trace.palette.automatic') },
              { value: 'limited', label: t('trace.palette.limited') },
              { value: 'full-tone', label: t('trace.palette.fullTone') },
            ]}
          />
        </LabelledRow>
      )}

      {/* Black and white has no palette to size; it has a threshold instead. */}
      {options.mode === 'bw' ? (
        <TraceSlider
          label={t('trace.threshold')}
          value={options.threshold}
          min={1}
          max={255}
          onChange={(threshold) => setTraceOptions({ threshold })}
        />
      ) : (
        <TraceSlider
          label={options.mode === 'grayscale' ? t('trace.grays') : t('trace.colors')}
          value={options.colors}
          min={options.palette === 'limited' || options.mode === 'grayscale' ? 2 : 1}
          max={options.palette === 'limited' || options.mode === 'grayscale' ? 30 : 100}
          onChange={(colors) => setTraceOptions({ colors })}
        />
      )}
    </Section>
  )
}

/** Sentinel for "these settings are not one of the presets". */
const CUSTOM = '__custom__'

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

function AdvancedSettings({ session }: { session: TraceSession }) {
  const { options } = session
  return (
    <Section title={t('trace.advanced')}>
      <TraceSlider
        label={t('trace.paths')}
        value={options.paths}
        min={0}
        max={100}
        onChange={(paths) => setTraceOptions({ paths })}
      />
      <TraceSlider
        label={t('trace.corners')}
        value={options.corners}
        min={0}
        max={100}
        onChange={(corners) => setTraceOptions({ corners })}
      />
      <TraceSlider
        label={t('trace.noise')}
        value={options.noise}
        min={1}
        max={100}
        onChange={(noise) => setTraceOptions({ noise })}
      />

      <LabelledRow label={t('trace.method')}>
        <Select
          value={options.method}
          title={t('trace.method')}
          onChange={(method) => setTraceOptions({ method: method as TraceMethod })}
          options={[
            { value: 'abutting', label: t('trace.method.abutting') },
            { value: 'overlapping', label: t('trace.method.overlapping') },
          ]}
        />
      </LabelledRow>

      <div className="trace-create-row">
        <span className="trace-label">{t('trace.create')}</span>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={options.fills}
            onChange={(e) => setTraceOptions({ fills: e.target.checked })}
          />
          {t('trace.fills')}
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={options.strokes}
            onChange={(e) => setTraceOptions({ strokes: e.target.checked })}
          />
          {t('trace.strokes')}
        </label>
      </div>

      {/* Only a stroke has a width, and the field would be a puzzle without one. */}
      {options.strokes && (
        <LabelledRow label={t('trace.strokeWidth')}>
          <NumberField
            value={options.strokeWidth}
            min={1}
            max={100}
            step={1}
            precision={1}
            suffix="px"
            title={t('trace.strokeWidth')}
            onChange={(strokeWidth) => setTraceOptions({ strokeWidth })}
          />
        </LabelledRow>
      )}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={options.snapToLines}
          onChange={(e) => setTraceOptions({ snapToLines: e.target.checked })}
        />
        {t('trace.snapCurves')}
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={options.ignoreWhite}
          onChange={(e) => setTraceOptions({ ignoreWhite: e.target.checked })}
        />
        {t('trace.ignoreWhite')}
      </label>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Readout and footer
// ---------------------------------------------------------------------------

/**
 * Paths, anchors and colours — the three numbers that say whether a trace is
 * usable. Twelve thousand anchors is a trace nobody can edit, and the only
 * place that shows before you commit is here.
 */
function TraceInfo({ session }: { session: TraceSession }) {
  const result = session.result
  const stale = !!result && !traceIsCurrent(session)
  return (
    <Section>
      <div className={`trace-info${stale ? ' stale' : ''}`}>
        <Readout label={t('trace.info.paths')} value={result?.paths.length ?? null} />
        <Readout label={t('trace.info.anchors')} value={result?.anchorCount ?? null} />
        <Readout label={t('trace.info.colors')} value={result?.colorCount ?? null} />
      </div>
      {session.status === 'error' && <p className="trace-error">{session.error}</p>}
    </Section>
  )
}

function Readout({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="trace-readout">
      <span className="trace-readout-value">{value === null ? '—' : formatCount(value)}</span>
      <span className="trace-readout-label">{label}</span>
    </div>
  )
}

/** Thousands separated, because 12483 anchors should read as a lot at a glance. */
function formatCount(n: number): string {
  return n.toLocaleString()
}

function Footer({ session }: { session: TraceSession }) {
  const busy = session.status === 'tracing' || session.status === 'loading'
  return (
    <div className="trace-footer">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={session.preview}
          onChange={(e) => setTracePreview(e.target.checked)}
        />
        {t('trace.preview')}
      </label>
      <div className="trace-buttons">
        <button type="button" className="button" onClick={cancelImageTrace}>
          {t('trace.cancel')}
        </button>
        <button
          type="button"
          className="button primary"
          disabled={session.status === 'loading' || session.status === 'error'}
          onClick={() => void commitImageTrace()}
        >
          {busy ? t('trace.tracing') : t('trace.trace')}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared controls
// ---------------------------------------------------------------------------

function LabelledRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="trace-row">
      <span className="trace-label">{label}</span>
      {children}
    </div>
  )
}

/**
 * A slider and a number that mean the same thing.
 *
 * The slider streams while dragged: each intermediate position asks for a
 * trace, and the scheduler drops the ones the drag has already passed. That is
 * what makes a drag feel like a dial on the picture rather than a form field.
 */
function TraceSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="slider-row trace-slider">
      <span className="slider-row-label">{label}</span>
      <input
        type="range"
        className="effect-slider"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={Math.min(max, Math.max(min, value))}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <NumberField
        value={value}
        min={min}
        max={max}
        precision={0}
        title={label}
        onChange={(v) => onChange(v)}
      />
    </div>
  )
}
