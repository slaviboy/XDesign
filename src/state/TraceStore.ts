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
 * The open Image Trace session.
 *
 * Editor state, not document state: which image is being traced, the panel's
 * settings, and the latest preview are all things that must not dirty the
 * document, must not land in undo history, and must not autosave. Only the
 * final commit — a group of paths replacing the image — touches the document,
 * and that goes through a normal transaction in TraceCommands.
 *
 * There is at most one session. Opening Image Trace for another image, or
 * deleting the one being traced, closes the current session first.
 *
 * The heavy objects — the decoded pixels and the scheduler that feeds them to
 * the worker — live at module level rather than in the store, because nothing
 * renders from them and a 16 MB pixel buffer has no business in a React state
 * diff.
 */

import { createStore } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import { loadRaster, TraceScheduler, type TraceOutcome } from '../trace/TraceClient'
import { DEFAULT_TRACE_OPTIONS, matchingPreset, presetById } from '../trace/presets'
import type { TraceOptions, TraceResult } from '../trace/types'
import type { NodeId } from '../document/types'

/**
 * Illustrator's View menu on the panel. The first three replace the picture
 * with the trace; the last two keep it visible underneath or alone.
 */
export type TraceView = 'result' | 'result-outlines' | 'outlines' | 'outlines-source' | 'source'

export type TraceStatus = 'loading' | 'idle' | 'tracing' | 'error'

export interface TraceSession {
  nodeId: NodeId
  options: TraceOptions
  view: TraceView
  /** Re-trace on every change. Off, the picture stays until Trace is pressed. */
  preview: boolean
  status: TraceStatus
  error: string | null
  result: TraceResult | null
  /** The options `result` was traced with; differs from `options` while a trace is pending. */
  resultOptions: TraceOptions | null
  /** Milliseconds the last trace took. */
  ms: number
  /** Natural pixel size of the image, for the readout. */
  source: { width: number; height: number } | null
}

export interface TraceState {
  session: TraceSession | null
}

export const traceStore = createStore<TraceState>()(
  subscribeWithSelector((): TraceState => ({ session: null })),
)

let scheduler: TraceScheduler | null = null

/** The settings the panel opens with next time — the previous session's, as Illustrator does. */
let lastOptions: TraceOptions = { ...DEFAULT_TRACE_OPTIONS }
let lastView: TraceView = 'result'

function patchSession(patch: Partial<TraceSession>): void {
  const session = traceStore.getState().session
  if (!session) return
  traceStore.setState({ session: { ...session, ...patch } })
}

/**
 * Open the panel for an image. Decodes the pixels, then traces with the last
 * used settings so the first thing the user sees is a result, not a form.
 */
export async function openTraceSession(nodeId: NodeId, dataUrl: string): Promise<void> {
  closeTraceSession()
  traceStore.setState({
    session: {
      nodeId,
      options: { ...lastOptions },
      view: lastView,
      preview: true,
      status: 'loading',
      error: null,
      result: null,
      resultOptions: null,
      ms: 0,
      source: null,
    },
  })

  let raster
  try {
    raster = await loadRaster(dataUrl)
  } catch (error) {
    // The panel may have been closed while the image decoded.
    if (traceStore.getState().session?.nodeId !== nodeId) return
    patchSession({ status: 'error', error: error instanceof Error ? error.message : 'The image could not be read.' })
    return
  }
  if (traceStore.getState().session?.nodeId !== nodeId) return

  scheduler = new TraceScheduler(raster, {
    onStart: () => patchSession({ status: 'tracing' }),
    onResult: (outcome: TraceOutcome, options: TraceOptions) =>
      patchSession({ status: 'idle', error: null, result: outcome.result, resultOptions: options, ms: outcome.ms }),
    onError: (message: string) => patchSession({ status: 'error', error: message }),
  })
  patchSession({ status: 'idle', source: { width: raster.width, height: raster.height } })
  requestTrace()
}

export function closeTraceSession(): void {
  const session = traceStore.getState().session
  if (session) {
    lastOptions = { ...session.options }
    lastView = session.view
  }
  scheduler?.dispose()
  scheduler = null
  traceStore.setState({ session: null })
}

/** Ask for a trace with the session's current options. Latest wins. */
export function requestTrace(): void {
  const session = traceStore.getState().session
  if (!session || !scheduler) return
  scheduler.request({ ...session.options })
}

/**
 * Change settings. With Preview on this re-traces at once; off, the change
 * waits for the Trace button.
 */
export function setTraceOptions(patch: Partial<TraceOptions>): void {
  const session = traceStore.getState().session
  if (!session) return
  const options = normalizeOptions({ ...session.options, ...patch })
  patchSession({ options })
  if (session.preview) requestTrace()
}

export function applyTracePreset(id: string): void {
  const preset = presetById(id)
  if (!preset) return
  setTraceOptions({ ...preset.options })
}

export function setTraceView(view: TraceView): void {
  patchSession({ view })
}

export function setTracePreview(preview: boolean): void {
  const session = traceStore.getState().session
  if (!session) return
  patchSession({ preview })
  // Turning preview on with stale settings should show them, not the old picture.
  if (preview && !sameOptions(session.options, session.resultOptions)) requestTrace()
}

/** The preset the current settings match exactly, or null for "Custom". */
export function currentPresetId(options: TraceOptions): string | null {
  return matchingPreset(options)
}

/** Whether the visible result reflects the current settings. */
export function traceIsCurrent(session: TraceSession): boolean {
  return session.result !== null && sameOptions(session.options, session.resultOptions)
}

/**
 * Wait until a result for the CURRENT options exists, tracing if needed.
 * Resolves null if the session closes or the trace fails.
 */
export function traceForCommit(): Promise<TraceResult | null> {
  const session = traceStore.getState().session
  if (!session) return Promise.resolve(null)
  if (traceIsCurrent(session)) return Promise.resolve(session.result)

  return new Promise((resolve) => {
    const unsubscribe = traceStore.subscribe(
      (s) => s.session,
      (s) => {
        if (!s) {
          unsubscribe()
          resolve(null)
        } else if (s.status === 'error') {
          unsubscribe()
          resolve(null)
        } else if (traceIsCurrent(s)) {
          unsubscribe()
          resolve(s.result)
        }
      },
    )
    requestTrace()
  })
}

function sameOptions(a: TraceOptions | null, b: TraceOptions | null): boolean {
  if (!a || !b) return false
  for (const key of Object.keys(a) as Array<keyof TraceOptions>) {
    if (a[key] !== b[key]) return false
  }
  return true
}

/** Keep every field inside the range the panel promises the engine. */
function normalizeOptions(o: TraceOptions): TraceOptions {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))
  const colorsMax = o.palette === 'limited' ? 30 : 100
  const colorsMin = o.palette === 'limited' ? 2 : 1
  return {
    ...o,
    colors: Math.round(clamp(o.colors, colorsMin, colorsMax)),
    threshold: Math.round(clamp(o.threshold, 1, 255)),
    paths: Math.round(clamp(o.paths, 0, 100)),
    corners: Math.round(clamp(o.corners, 0, 100)),
    noise: Math.round(clamp(o.noise, 1, 100)),
    strokeWidth: clamp(o.strokeWidth, 1, 100),
    // A trace with nothing to create is not a trace: turning Fills off with
    // Strokes already off turns Fills back on, as Illustrator does.
    fills: o.fills || !o.strokes,
  }
}
