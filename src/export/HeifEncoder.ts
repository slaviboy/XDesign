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
 * The main thread's side of the HEIF worker.
 *
 * One worker, started on first use and kept: the encoder takes a moment to
 * instantiate, and a preview re-encodes on every settings change.
 */

import type { HeifRequest, HeifResponse } from '../workers/heif.worker'

export const HEIF_MIME = 'image/heic'

/**
 * The most pixels a HEIF this app writes may have.
 *
 * HEVC's highest level, 6.2, allows 35,651,584 luma samples per picture — 8K
 * is 33 million. The encoder will go past it, with a warning, but it writes one
 * picture rather than a grid of tiles, so a decoder that honours the level
 * refuses the file. Refusing it here is a message the user can act on; a file
 * that will not open elsewhere is not.
 */
export const HEIF_MAX_PIXELS = 35_651_584

type Pending = (response: HeifResponse) => void

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('../workers/heif.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (event: MessageEvent<HeifResponse>) => {
    const response = event.data
    const resolve = pending.get(response.id)
    if (resolve) {
      pending.delete(response.id)
      resolve(response)
    }
    if (!response.ok && response.broken) discard(w, response.error)
  }
  w.onerror = (event) => {
    event.preventDefault()
    discard(w, 'The HEIF encoder could not be started in this browser.')
  }
  worker = w
  return w
}

/**
 * Throw a worker away, answering whatever it still owed.
 *
 * Dropped rather than kept broken, so the next export starts a fresh one —
 * otherwise one image too large for memory would fail every HEIF after it
 * until the page was reloaded.
 */
function discard(w: Worker, error: string): void {
  if (worker === w) worker = null
  w.terminate()
  for (const [id, resolve] of pending) resolve({ id, ok: false, error })
  pending.clear()
}

function send(request: HeifRequest, transfer: Transferable[]): Promise<HeifResponse> {
  return new Promise((resolve) => {
    pending.set(request.id, resolve)
    getWorker().postMessage(request, transfer)
  })
}

/** RGBA pixels to a HEIF file. The pixels' buffer is handed to the worker. */
export async function encodeHeif(image: ImageData): Promise<Blob> {
  const rgba = image.data.buffer as ArrayBuffer
  const response = await send(
    { id: nextId++, op: 'encode', width: image.width, height: image.height, rgba },
    [rgba],
  )
  if (!response.ok) throw new Error(response.error)
  if (response.op !== 'encode') throw new Error('The HEIF encoder answered the wrong question.')
  return new Blob([response.bytes], { type: HEIF_MIME })
}

/** A HEIF file back to pixels, for showing one where the browser cannot. */
export async function decodeHeif(blob: Blob): Promise<ImageData> {
  const bytes = await blob.arrayBuffer()
  const response = await send({ id: nextId++, op: 'decode', bytes }, [bytes])
  if (!response.ok) throw new Error(response.error)
  if (response.op !== 'decode') throw new Error('The HEIF decoder answered the wrong question.')
  return new ImageData(new Uint8ClampedArray(response.rgba), response.width, response.height)
}
