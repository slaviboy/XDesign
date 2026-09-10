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
 * HEIF encoding and decoding, off the main thread.
 *
 * No browser encodes HEIF from a canvas — `toBlob('image/heic')` quietly hands
 * back a PNG everywhere — so this is libheif with the kvazaar HEVC encoder,
 * compiled to WebAssembly (the `elheif` package). The binary is inlined in the
 * package's script, so there is nothing to fetch and it works offline like the
 * rest of the app; it is imported only here, so its ~1.5 MB loads the first
 * time someone exports a HEIF and never before.
 *
 * A worker because encoding is not quick: a 4000×4000 image takes seconds, and
 * that is seconds of a frozen editor on the main thread.
 *
 * Decoding is here for the preview. Only Safari can show a HEIF in an <img>,
 * so the preview decodes the bytes it just made — which also means it shows
 * what the file really looks like after compression, not the picture before it.
 */

import { ensureInitialized, jsDecodeImage, jsEncodeImage } from 'elheif'

export type HeifRequest =
  | { id: number; op: 'encode'; width: number; height: number; rgba: ArrayBuffer }
  | { id: number; op: 'decode'; bytes: ArrayBuffer }

export type HeifResponse =
  | { id: number; ok: true; op: 'encode'; bytes: ArrayBuffer }
  | { id: number; ok: true; op: 'decode'; width: number; height: number; rgba: ArrayBuffer }
  /**
   * `broken` when the library threw rather than reporting an error: an
   * Emscripten abort — running out of memory, most likely — leaves the module
   * unusable, and every later call would fail the same way.
   */
  | { id: number; ok: false; error: string; broken?: boolean }

function run(request: HeifRequest): { response: HeifResponse; transfer: ArrayBuffer[] } {
  const { id } = request
  if (request.op === 'encode') {
    const result = jsEncodeImage(new Uint8Array(request.rgba), request.width, request.height)
    if (result.err) return { response: { id, ok: false, error: result.err }, transfer: [] }
    // A VIEW into the encoder's own memory, not a copy: the next call writes
    // over it, and posting the view would clone the whole heap behind it —
    // tens of megabytes to deliver a file of a few kilobytes. Copy out exactly
    // the file, then hand that over without a second copy.
    const bytes = result.data.slice().buffer
    return { response: { id, ok: true, op: 'encode', bytes }, transfer: [bytes] }
  }

  const result = jsDecodeImage(new Uint8Array(request.bytes))
  const image = result.data[0]
  if (result.err || !image) {
    return { response: { id, ok: false, error: result.err || 'The file holds no image.' }, transfer: [] }
  }
  // The pixels are packed four bytes to a pixel from the start, but the view
  // runs on past the last row into whatever the decoder has next to it —
  // twice the image's length, or seven times for a tiny one. Only the image is
  // taken; ImageData refuses any other length, and rightly.
  const rgba = image.data.slice(0, image.width * image.height * 4).buffer
  return {
    response: { id, ok: true, op: 'decode', width: image.width, height: image.height, rgba },
    transfer: [rgba],
  }
}

self.onmessage = (event: MessageEvent<HeifRequest>) => {
  void ensureInitialized()
    .then(() => run(event.data))
    .catch((error: unknown) => ({
      response: {
        id: event.data.id,
        ok: false as const,
        error: error instanceof Error ? error.message : 'HEIF encoding failed.',
        broken: true,
      },
      transfer: [],
    }))
    .then(({ response, transfer }) => {
      ;(self as unknown as Worker).postMessage(response, transfer)
    })
}
