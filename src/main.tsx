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
 * Entry point.
 *
 * Font CSS is imported statically: these are @font-face DECLARATIONS, so the
 * browser does not fetch a woff2 until a rendered element actually uses that
 * family. Declaring all of them costs a few KB of CSS, not megabytes of fonts,
 * and the service worker precaches the files so every family stays available
 * offline.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { documentStore } from './state/DocumentStore'
import { initTheme } from './state/theme'
import './styles/tokens.css'
import './styles/fonts'
import './styles/app.css'

// The beforeunload guard reads this; keeping it on window avoids a store
// subscription whose only job is to feed one boolean to an event handler.
documentStore.subscribe((state) => {
  ;(window as unknown as { __xdesignDirty?: boolean }).__xdesignDirty = state.dirty
})

// The inline script in index.html has already set data-theme to avoid a flash;
// this re-applies it and starts following the OS setting when the preference
// is 'system'.
initTheme()

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker so a hard reload with no network still boots.
//
// The path is relative to the DOCUMENT, not to this module: `new URL('sw.js',
// import.meta.url)` would resolve against the hashed chunk in /assets/ and 404.
// A document-relative './sw.js' is also what makes a GitHub Pages project
// subpath work without configuration, and it keeps the worker's scope at the
// app root so it controls every page.
//
// Updates are picked up on the user's next visit rather than applied mid-edit:
// silently swapping the app out from under an unsaved document is
// data-loss-adjacent.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const register = () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      // Without a worker the app still runs; it just loses the offline boot.
    })
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
