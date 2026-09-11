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
 * The main-thread side of Image Trace: pixels in, traced paths out, with the
 * scheduling that makes a live preview feel live.
 *
 * Every slider movement asks for a new trace. A trace takes anywhere from ten
 * milliseconds to a second, and a drag produces dozens of positions a second,
 * so most requests are stale before they could start. The rule here is
 * LATEST WINS: at most one trace runs at a time, at most one is queued behind
 * it, and a new request replaces whatever was queued. The result the caller
 * sees is always for the options it asked for most recently — never a flicker
 * back to an older one — and the worker never falls behind by more than one.
 *
 * If the Worker cannot be constructed (a very old browser, a CSP that forbids
 * workers), tracing falls back to the main thread. Slower, and it freezes the
 * panel during a trace, but it still works — which for an offline tool is the
 * property that matters.
 */

import type { TraceRequest, TraceResponse } from '../workers/trace.worker'
import { FULL_CROP } from '../document/ImageCrop'
import type { ImageCrop } from '../document/types'
import type { RasterData, TraceOptions, TraceResult } from './types'

export interface TraceOutcome {
  result: TraceResult
  /** Wall-clock time the trace itself took, for the panel's readout. */
  ms: number
}

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, (r: TraceResponse) => void>()

/** A pathological input must not leave the panel spinning forever. */
const WORKER_TIMEOUT_MS = 30_000

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/trace.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<TraceResponse>) => {
      const resolve = pending.get(event.data.id)
      if (resolve) {
        pending.delete(event.data.id)
        resolve(event.data)
      }
    }
    worker.onerror = () => {
      workerBroken = true
      for (const [id, resolve] of pending) resolve({ id, ok: false, error: 'worker failed' })
      pending.clear()
      worker?.terminate()
      worker = null
    }
    return worker
  } catch {
    workerBroken = true
    return null
  }
}

/** One trace, wherever it runs. The raster is COPIED before transfer so the caller keeps its buffer. */
async function traceOnce(raster: RasterData, options: TraceOptions): Promise<TraceOutcome> {
  const w = getWorker()
  if (w) {
    const id = nextId++
    const copy = new Uint8ClampedArray(raster.data)
    const request: TraceRequest = {
      id,
      raster: { width: raster.width, height: raster.height, data: copy },
      options,
    }
    const response = await new Promise<TraceResponse>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ id, ok: false, error: 'timed out' })
      }, WORKER_TIMEOUT_MS)
      pending.set(id, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      w.postMessage(request, [copy.buffer])
    })
    if (response.ok) return { result: response.result, ms: response.ms }
    if (response.error !== 'worker failed') throw new Error(response.error)
    // The worker died: fall through to the main thread for this and every later trace.
  }

  const { traceImage } = await import('./trace')
  const started = performance.now()
  const result = traceImage(raster, options)
  return { result, ms: performance.now() - started }
}

// ---------------------------------------------------------------------------
// Latest-wins scheduling
// ---------------------------------------------------------------------------

export interface TraceSchedulerCallbacks {
  onStart(): void
  onResult(outcome: TraceOutcome, options: TraceOptions): void
  onError(message: string): void
}

/**
 * One scheduler per open panel. `request` may be called as often as the UI
 * likes; `callbacks.onResult` fires only for the most recent options, and
 * `onStart` fires once when the queue goes from idle to busy.
 */
export class TraceScheduler {
  private raster: RasterData
  private queued: TraceOptions | null = null
  private running = false
  private disposed = false

  constructor(raster: RasterData, private readonly callbacks: TraceSchedulerCallbacks) {
    this.raster = raster
  }

  request(options: TraceOptions): void {
    if (this.disposed) return
    this.queued = options
    if (!this.running) void this.drain()
  }

  get busy(): boolean {
    return this.running
  }

  dispose(): void {
    this.disposed = true
    this.queued = null
  }

  private async drain(): Promise<void> {
    this.running = true
    this.callbacks.onStart()
    while (this.queued && !this.disposed) {
      const options = this.queued
      this.queued = null
      try {
        const outcome = await traceOnce(this.raster, options)
        // A newer request arrived while this one ran: its result is about to
        // supersede this one, so showing this one would only flicker.
        if (this.disposed) return
        if (!this.queued) this.callbacks.onResult(outcome, options)
      } catch (error) {
        if (this.disposed) return
        if (!this.queued) this.callbacks.onError(error instanceof Error ? error.message : 'trace failed')
      }
    }
    this.running = false
  }
}

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

/**
 * The most pixels a decoded image is kept at.
 *
 * The engine downsamples anything larger anyway, but it does it per trace —
 * whereas this happens once. A 24-megapixel photograph is a 96 MB RGBA buffer
 * that would be copied into the worker on every slider movement, and the trace
 * it produces would be identical to the one from the reduced image. Kept in
 * step with TRACE_MAX_PIXELS in trace.ts, and deliberately duplicated rather
 * than imported: a static import would pull the whole engine into the main
 * bundle, which is precisely what the worker exists to avoid.
 */
const MAX_SOURCE_PIXELS = 2_000_000

/**
 * Decode an image data URL into RGBA pixels, reduced if it is enormous.
 *
 * Data URLs are same-origin, so the canvas is never tainted and getImageData
 * is allowed — the same reason the eyedropper's rasterizer works.
 */
export function loadRaster(dataUrl: string, crop: ImageCrop = FULL_CROP): Promise<RasterData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const natural = { width: img.naturalWidth || 1, height: img.naturalHeight || 1 }
      // Only the kept part of a cropped image is decoded, so the trace is of
      // what is on the canvas — and the size cap below spends its budget on
      // that part rather than on pixels nobody can see.
      const source = {
        x: crop.x * natural.width,
        y: crop.y * natural.height,
        width: Math.max(1, crop.width * natural.width),
        height: Math.max(1, crop.height * natural.height),
      }
      // Whole-number-ish reduction, then rounded up so nothing collapses to 0.
      const fit = Math.min(1, Math.sqrt(MAX_SOURCE_PIXELS / (source.width * source.height)))
      const width = Math.max(1, Math.round(source.width * fit))
      const height = Math.max(1, Math.round(source.height * fit))

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        reject(new Error('This browser could not provide a 2D canvas.'))
        return
      }
      // Smoothing on: a reduction that dropped pixels would alias thin strokes
      // out of existence, and the tracer would then faithfully trace the gaps.
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, source.x, source.y, source.width, source.height, 0, 0, width, height)
      const pixels = ctx.getImageData(0, 0, width, height)
      resolve({ width, height, data: pixels.data })
    }
    img.onerror = () => reject(new Error('The image could not be decoded.'))
    img.src = dataUrl
  })
}
