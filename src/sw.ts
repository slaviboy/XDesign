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
 * Service worker.
 *
 * Precaches the whole build so the app boots with no network at all. Written by
 * hand (injectManifest mode) rather than generated, so there is no NetworkFirst
 * behaviour we did not ask for: this app makes no network requests at runtime,
 * and anything that misses the cache should fail visibly rather than hang.
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

const CACHE_NAME = 'xdesign-precache-v1'
const MANIFEST = self.__WB_MANIFEST ?? []

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      const urls = MANIFEST.map((entry) => entry.url)

      // Stored via an explicit Request/Response pair rather than cache.add():
      // add() records the response with whatever Vary header the server sent,
      // and the page's own request for the same asset then fails to match it.
      // Re-wrapping the body drops that coupling, so a cache hit depends only
      // on the URL.
      //
      // Fetched in batches so a large precache does not open 175 sockets at
      // once, and individually guarded so one missing asset cannot fail the
      // whole install.
      const BATCH = 12
      for (let i = 0; i < urls.length; i += BATCH) {
        await Promise.all(
          urls.slice(i, i + BATCH).map(async (url) => {
            try {
              const response = await fetch(url, { cache: 'reload' })
              if (!response.ok) return
              await cache.put(new Request(url), await stripVary(response))
            } catch {
              // A single unreachable asset must not abort the install.
            }
          }),
        )
      }
    })(),
  )
})

/** Re-wrap a response without its Vary header, so matching is URL-only. */
async function stripVary(response: Response): Promise<Response> {
  const headers = new Headers(response.headers)
  headers.delete('vary')
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      // ignoreVary matters: without it a cached asset whose response carried a
      // Vary header will not match the page's own request for the same URL, and
      // the app boots to a blank page offline.
      const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true })
      if (cached) return cached

      // A navigation to any route falls back to the app shell.
      if (request.mode === 'navigate') {
        const shell = await caches.match('index.html', { ignoreSearch: true, ignoreVary: true })
        if (shell) return shell
      }

      try {
        const response = await fetch(request)
        if (response.ok && response.type === 'basic') {
          // Runtime-cache anything fetched later (a font used for the first
          // time), so it is available on the next offline boot.
          const cache = await caches.open(CACHE_NAME)
          void stripVary(response.clone()).then((r) => cache.put(new Request(request.url), r))
        }
        return response
      } catch {
        return new Response('Offline and not cached.', { status: 504, statusText: 'Offline' })
      }
    })(),
  )
})

/** Let the page trigger an update when the user opts in. */
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

export {}
