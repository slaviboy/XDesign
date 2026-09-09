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
 * Image Trace, off the main thread.
 *
 * Tracing a photograph is a few hundred milliseconds of pure arithmetic — long
 * enough that doing it on the main thread would freeze every slider in the
 * panel the moment it was touched. So it runs here, and the panel stays live.
 *
 * The worker is deliberately dumb: one request in, one result out, in order.
 * Coalescing (dropping the trace for a slider position the user has already
 * moved past) is the client's job, because only the client knows what the
 * latest request is. A Worker cannot look at its queue while it is busy.
 *
 * The pixel buffer arrives by transfer, not copy — for a 2000×2000 image that
 * is 16 MB that would otherwise be duplicated on every re-trace.
 */

import { traceImage } from '../trace/trace'
import type { RasterData, TraceOptions, TraceResult } from '../trace/types'

export interface TraceRequest {
  id: number
  raster: RasterData
  options: TraceOptions
}

export type TraceResponse =
  | { id: number; ok: true; result: TraceResult; ms: number }
  | { id: number; ok: false; error: string }

self.onmessage = (event: MessageEvent<TraceRequest>) => {
  const { id, raster, options } = event.data
  const started = performance.now()
  try {
    const result = traceImage(raster, options)
    const response: TraceResponse = { id, ok: true, result, ms: performance.now() - started }
    self.postMessage(response)
  } catch (error) {
    const response: TraceResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'trace failed',
    }
    self.postMessage(response)
  }
}
